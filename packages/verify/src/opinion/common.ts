/**
 * Shared machinery for opinions: the chain premise, the replay premise, evidence-set references, and finalization (the
 * self-verifying rule: an opinion whose premises do not all verify proposes nothing).
 */

import { hashOf } from '../verdict/canonical.js'
import { proofProblem } from '../verdict/channel.js'
import type { Verdict } from '../verdict/schema.js'
import type { SnapshotView } from './snapshot.js'
import {
  OPINION_GENERATOR, OPINION_GENERATOR_VERSION, OPINION_VERSION,
  type Authority, type DissentPoint, type Opinion, type OpinionRef, type OpinionSubject, type OverturnCondition,
  type Precedent, type Premise, type Reading, type Ruling,
} from './types.js'

export const short = (h: string, n = 12): string => (h.length > n ? `${h.slice(0, n)}…` : h)

export function evidenceSet(label: string, ids: readonly string[]): OpinionRef {
  const sorted = [...new Set(ids)].sort()
  return { kind: 'evidence_set', label, count: sorted.length, hash: hashOf(sorted), verdict_ids: sorted }
}

/** A signed decision on the book, as a replayable reference. */
export function decisionRef(kind: 'GRANT' | 'DECLINE' | 'POLICY_REVISION', d: { decision_id: string; seq: number; entry_hash: string }): OpinionRef {
  return { kind: 'decision', decision_kind: kind, decision_id: d.decision_id, seq: d.seq, entry_hash: d.entry_hash }
}

/** P: the book of record is intact (the whole book re-verified by the ledger's own reader). */
export function chainPremise(id: string, view: SnapshotView): Premise {
  const check = 'readDecisionBook (ledger/decisions): every link and payload re-hashed, every event header held to its payload, every signed decision re-verified'
  const c = view.chain
  const scoped = view.scope ? ` This opinion reads only tenant \`${view.scope.tenant_id}\`'s records and decisions; the chain is verified whole because its hashes cover every tenant.` : ''
  if (view.content_verified && c) {
    return {
      id, check, verified: true,
      statement: `The book of record is intact: ${c.length} event(s), every payload re-hashed, every event header held to its payload, every signed decision re-verified; head \`${c.head}\`.${scoped}`,
      refs: [{ kind: 'ledger_head', head: c.head, length: c.length }],
      detail: `content verified; every record cited here was rebuilt from this chain${view.scope ? ` (tenant ${view.scope.tenant_id} only)` : ''}`,
    }
  }
  if (c && !c.ok) {
    return {
      id, check, verified: false,
      statement: `The book of record FAILED its integrity check at event ${c.brokenAt}: ${c.reason}.`,
      refs: [{ kind: 'ledger_head', head: c.head, length: c.length }],
      detail: `chain broken at event ${c.brokenAt}`,
    }
  }
  if (c) {
    return {
      id, check, verified: false,
      statement: 'The chain links are intact, but the payloads were not supplied, so the verdict bodies were not re-hashed.',
      refs: [{ kind: 'ledger_head', head: c.head, length: c.length }],
      detail: 'structural check only; supply the chain export (events with payloads)',
    }
  }
  return {
    id, check, verified: false,
    statement: 'No chain was supplied: the records cannot be shown to be the ledger\'s.',
    refs: [],
    detail: 'no chain; supply the chain export (ledger.chainJSONL())',
  }
}

/**
 * P: every cited verdict earns the VERDICT channel (id re-derives from its inputs, evidenced, deterministic, not generated).
 * With `allowReasoned` (a disputed judgement-tier finding), the verdict must still replay-bind and be evidenced, but its
 * REASONED findings are advisories and the statement says so.
 */
export function replayPremise(id: string, label: string, ids: readonly string[], byId: ReadonlyMap<string, Verdict>, opts: { allowReasoned?: boolean } = {}): Premise {
  const failures: string[] = []
  for (const vid of ids) {
    const v = byId.get(vid)
    if (!v) { failures.push(`${short(vid)}: not on the record`); continue }
    const problem = proofProblem(v, opts)
    if (problem) failures.push(`${short(vid)}: ${problem}`)
  }
  const n = new Set(ids).size
  const what = opts.allowReasoned
    ? 'its id re-derives from input_hash + ruleset@version + engine, it is evidenced, and it is not generated (its judgement-tier findings are advisories, not VERDICT)'
    : 'its id re-derives from input_hash + ruleset@version + engine, it is evidenced, and it is VERDICT-channel (not generated)'
  return {
    id,
    statement: n === 0
      ? `No verdict is cited as ${label}.`
      : n === 1
        ? `The ${label} verdict replays: ${what}.`
        : `Each of the ${n} ${label} verdicts replays: ${what}.`,
    check: opts.allowReasoned ? 'proofProblem (verdict/channel) → deriveVerdictId (protocol/replay)' : 'assertVerdict (verdict/channel) → deriveVerdictId (protocol/replay)',
    refs: n === 0 ? [] : [evidenceSet(label, ids)],
    verified: failures.length === 0,
    detail: failures.length === 0 ? `${n} verdict(s) checked` : `${failures.length} failed: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? '; …' : ''}`,
  }
}

/** A stable anchor for the data an opinion was generated from: the chain head, or a hash of the supplied records. */
export function sourceHashOf(view: SnapshotView): string {
  if (view.chain) return view.chain.head
  return hashOf(view.records.map(r => [r.verdict.verdict_id, r.review?.decision ?? null]).sort())
}

export interface OpinionParts {
  subject: OpinionSubject
  title: string
  question: string
  readings: Reading[]
  authorities: Authority[]
  precedent: Precedent
  ruling: Ruling
  dissent: DissentPoint[]
  overturn: OverturnCondition[]
  premises: Premise[]
}

/** Seal an opinion: judges from premises, the WITHHELD rule, a content-derived id. Deterministic. */
export function finalizeOpinion(p: OpinionParts, source_hash: string): Opinion {
  const failed = p.premises.filter(x => !x.verified)
  const verified = failed.length === 0
  const ruling: Ruling = verified ? p.ruling : {
    disposition: 'WITHHELD',
    favors: null,
    statement: `No ruling is proposed: ${failed.length} premise(s) could not be verified by Riposte's own checks (${failed.map(x => `${x.id}: ${x.detail}`).join('; ')}). An opinion whose premises do not verify proposes nothing.`,
    scope: p.ruling.scope,
    status: 'PROPOSED',
    takes_effect: 'nothing changes',
  }
  const body = {
    opinion_version: OPINION_VERSION,
    channel: 'COUNSEL' as const,
    provenance: { type: 'GENERATED' as const, generator: OPINION_GENERATOR, generator_version: OPINION_GENERATOR_VERSION, source_hash },
    dismissible: true as const,
    subject: p.subject,
    title: p.title,
    question: p.question,
    readings: p.readings,
    authorities: p.authorities,
    precedent: p.precedent,
    ruling,
    dissent: p.dissent,
    overturn: p.overturn,
    premises: p.premises,
    judges: p.premises.map(x => ({ judge: `${x.id} · ${x.check}`, passed: x.verified, detail: x.detail })),
    verified,
  }
  const opinion_id = hashOf(body).slice(0, 32)
  const { opinion_version, channel, provenance, dismissible, ...rest } = body
  return { opinion_version, channel, provenance, dismissible, opinion_id, ...rest }
}

/** Does an opinion still match its own id? (A third party re-derives it from the JSON.) */
export function opinionIntact(o: Opinion): boolean {
  const { opinion_id, ...rest } = o
  return hashOf(rest).slice(0, 32) === opinion_id
}
