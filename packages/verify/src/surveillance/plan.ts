/**
 * Running the draws — what to commit, what to review, by when (2026-09-28, evidence-integrity lane).
 *
 * The selection itself is fixed by the chain (ledger/sampling.ts); these helpers only say which closed periods still lack a
 * committed SAMPLE at the policy's rates (dueSamples / commitDueSamples: the scheduled step a deployment runs, e.g. daily),
 * and what a reviewer's queue holds (reviewQueue: every drawn, still-unreviewed item, with its deadline). Revealed canaries
 * are never queued as new work; sealed ones are in the queue like any other item (that is the point of sealing them).
 *
 * The rates are the policy tier's, for the rung in force when each period closed (evidence.ts samplingRates). Nothing here
 * tunes them: the tier is the grant's (or, with nothing granted, the one the caller declares). The rung in force is read
 * under the policy (D-DUAL: a pending grant is not in force).
 *
 * F-S2-1 (2026-09-28): a queue is one tenant's. Only the workflow's own tenant's reviews take an item off it, so another
 * tenant's review of the same verdict id (a shared book) never hides an item from the tenant it was drawn for.
 */

import type { Ledger } from '../ledger/types.js'
import { hashOf } from '../verdict/canonical.js'
import { canaryRevealsFor, grantAt, grantInForce, type DecisionBook } from '../ledger/decisions.js'
import { tenantOfWorkflow } from '../ledger/registry.js'
import {
  chainPeriods, drawStratum, nextPeriodEnd, periodFrame, sampleKey, sampleSeed, STRATA,
  type SampleEntry, type SampleRequest, type Stratum,
} from '../ledger/sampling.js'
import type { LedgerEvent } from '../ledger/chain.js'
import type { PromotionPolicy, TierRequirements, VoiceLevel } from '../verdict/voice.js'
import { samplingRates } from './evidence.js'

export interface PlanOptions {
  /** The tier to draw under while nothing is granted (a grant in force names its own). */
  consequence_tier?: string
}

function tierFor(book: DecisionBook, workflow_id: string, policy: PromotionPolicy, opts: PlanOptions): TierRequirements {
  const g = grantInForce(book.decisions, workflow_id, { policies: [policy], governing_policy: policy }) // D-GOVERNING-POLICY
  const name = g?.signed.decision.consequence_tier ?? opts.consequence_tier
  if (name === undefined) throw new Error(`no GRANT for ${workflow_id} is on the book and no consequence_tier was declared: the draw rates follow the tier`)
  if (g && opts.consequence_tier !== undefined && opts.consequence_tier !== name) {
    throw new Error(`the grant in force is at tier '${name}', not '${opts.consequence_tier}': settings are fixed at grant`)
  }
  if (g && g.signed.decision.policy.hash !== hashOf(policy)) {
    throw new Error(`the grant in force was made under ${g.signed.decision.policy.policy_id}@${g.signed.decision.policy.version}, not ${policy.policy_id}@${policy.version}: the draw rates are the grant's policy's`)
  }
  const tier = policy.tiers.find(t => t.tier === name)
  if (!tier) throw new Error(`tier '${name}' is not declared in policy ${policy.policy_id}@${policy.version}`)
  return tier
}

/** Every closed period with something to draw that has no SAMPLE on the book at the policy's rates yet, oldest first. */
export function dueSamples(chain: { events: readonly LedgerEvent[]; payloads: readonly unknown[] }, book: DecisionBook, workflow_id: string, policy: PromotionPolicy, opts: PlanOptions = {}): SampleRequest[] {
  const tier = tierFor(book, workflow_id, policy, opts)
  if (!tier.sampling) return []
  const unit = tier.sampling.period
  const committed = new Set(book.samples.map(e => sampleKey(e.sample)))
  const out: SampleRequest[] = []
  for (const span of chainPeriods(chain.events, unit)) {
    if (span.closed_by === undefined) continue
    const rung: VoiceLevel = grantAt(book.decisions, workflow_id, span.last_seq + 1, { policies: [policy], governing_policy: policy })?.signed.decision.level ?? 'record'
    const rates = samplingRates(tier, rung)
    if (rates.PASS === 0 && rates.FAIL === 0) continue
    const frame = periodFrame(chain.events, chain.payloads, workflow_id, span)
    if (frame.PASS.length + frame.FAIL.length === 0) continue
    const req: SampleRequest = { workflow_id, unit, start: span.start, rates }
    if (!committed.has(sampleKey({ workflow_id, period: { unit, start: span.start }, rates }))) out.push(req)
  }
  return out
}

/** The scheduled step: commit every due sample to the ledger (each one re-derived and checked by the door). */
export function commitDueSamples(ledger: Ledger, workflow_id: string, policy: PromotionPolicy, opts: PlanOptions = {}): SampleEntry[] {
  const book = ledger.decisionBook()
  if (!book.ok) throw new Error(`the book does not verify (${book.check.reason ?? 'unknown'}): no sample is drawn from a broken book`)
  const chain = ledger.snapshot() // P-C: the chain by reference (no string ceiling at scale)
  return dueSamples(chain, book, workflow_id, policy, opts).map(req => ledger.commitSample(req))
}

export interface QueueItem {
  verdict_id: string
  stratum: Stratum
  period_start: string
  /** Review by then: after it, an unreviewed drawn item is a deviation (AS 2315 .40). */
  due_by: string
  /** The rung in force when the period closed (a census at gate; surveillance at autonomy). */
  rung: VoiceLevel
}

/** A reviewer's queue: every drawn item not yet reviewed, oldest period first. Revealed canaries are not queued. */
export function reviewQueue(ledger: Ledger, workflow_id: string, policy: PromotionPolicy, opts: PlanOptions = {}): QueueItem[] {
  const book = ledger.decisionBook()
  if (!book.ok) throw new Error(`the book does not verify (${book.check.reason ?? 'unknown'})`)
  const tier = tierFor(book, workflow_id, policy, opts)
  if (!tier.sampling) return []
  const { events, payloads } = ledger.snapshot() // P-C
  const canaries = new Set(canaryRevealsFor(book.canaries, workflow_id).flatMap(r => r.signed.decision.verdict_ids))
  // F-S2-1: the workflow's own tenant's reviews only (a workflow id without a tenant prefix reads every record, as before).
  const tenant = tenantOfWorkflow(workflow_id)
  const reviewed = new Set(ledger.all().filter(r => r.review && (tenant === undefined || r.tenant_id === tenant)).map(r => r.verdict.verdict_id))
  const unit = tier.sampling.period
  const out: QueueItem[] = []
  const seen = new Set<string>()
  for (const span of chainPeriods(events, unit)) {
    if (span.closed_by === undefined) continue
    const rung: VoiceLevel = grantAt(book.decisions, workflow_id, span.last_seq + 1, { policies: [policy], governing_policy: policy })?.signed.decision.level ?? 'record'
    const rates = samplingRates(tier, rung)
    const frame = periodFrame(events, payloads, workflow_id, span)
    const seed = sampleSeed(workflow_id, unit, span.start, events[span.last_seq]!.entry_hash)
    const due_by = nextPeriodEnd(span.start, unit)
    for (const s of STRATA) {
      for (const id of drawStratum(frame[s], seed, s, rates[s])) {
        if (seen.has(id)) continue
        seen.add(id)
        if (reviewed.has(id) || canaries.has(id)) continue
        out.push({ verdict_id: id, stratum: s, period_start: span.start, due_by, rung })
      }
    }
  }
  return out
}
