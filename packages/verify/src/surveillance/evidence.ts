/**
 * The evidence audit — which reviews a rung may rest on, read from the book (2026-09-28, evidence-integrity lane).
 *
 * The design rulings bind this module: only a person moves a rung (nothing here changes one; it narrows what counts as
 * evidence and can make a demotion PROPOSAL fire); settings are fixed at grant (every requirement below is declared in the
 * policy tier the grant names, and nothing here tunes it); judgement is COUNSEL (nothing here is a verdict); every FAIL can
 * be disputed (each case this audit raises carries its verdict id).
 *
 * What it does, per tier requirement (voice.ts TierRequirements):
 *
 *   sampling           Re-draws every closed period's random review queue from the chain (ledger/sampling.ts) at the
 *                      POLICY's own rates for the rung in force when the period closed: review_rate before autonomy, a census
 *                      at gate (the rung's own handling sends every PASS and FAIL to a person), surveillance_rate for PASSes
 *                      under autonomy. A drawn item still unreviewed when the NEXT period closes is UNTESTED: a deviation
 *                      (AS 2315 .40: "he should ordinarily consider those selected items to be deviations").
 *   random_selection   Only reviews of drawn items count toward a rung (AS 2315 .39). A clean review of an item nobody drew
 *                      is set aside; so is a clean review whose period's draw is still open (it counts once the draw is
 *                      complete, or its deadline passes and the rest are deviations), so an easy half reviewed early cannot
 *                      carry a promotion. An OVERTURNED review counts wherever a person made it: evidence AGAINST is never
 *                      set aside for how it was found (AS 2201 .47 Note: less evidence supports "not effective").
 *   signed_reviews     Only a person's SIGNED review, by a key anchored to them (the registry's `reviewer` role, or
 *                      trusted_keys), counts, in either direction: an agent can manufacture neither a clean record nor a slap.
 *   segregation        A grant cannot rest on its own signer's clean reviews (COSO GenAI p.13: separate configuring and
 *                      approving from reviewing). They are set aside for that grant; the signer's OVERTURNED reviews count.
 *   canaries           Revealed canaries are never evidence about the workflow (set aside whatever the tier says). With the
 *                      requirement declared, the reviewers' catch rate on them (reviews by the sealer excluded: they knew)
 *                      must show attention: n ≥ min_n and the policy's own lower bound ≥ min_catch_rate. Otherwise no
 *                      overturn rate counts as evidence (IMDA MGF Agentic §2.2.2: "A low rate may signal rubber-stamping").
 *   surveillance       Under an AUTONOMY grant at a tier that declares surveillance_rate: every PASS recorded after the grant
 *                      that a person overturned (drawn or not), and every drawn post-grant PASS left untested, is a failing
 *                      case that raises the (urgent, failure-basis) demotion PROPOSAL, even while the pooled bound still
 *                      clears. The pooled bound is dominated by the pre-grant sample; without this, a new miss under
 *                      autonomy would stay invisible for a long time (research §5.3: "the evidence freezes at autonomy").
 *
 * Pure and deterministic: the chain, its verified book, the calibration and the tier in; the same adjustment out.
 */

import type { LedgerEvent } from '../ledger/chain.js'
import {
  canaryRevealsFor, canarySealsFor, grantAt, grantSignatures, type DecisionBook, type DecisionEntry, type GrantDecision, type SignedReviewEntry,
} from '../ledger/decisions.js'
import { keyFingerprint } from '../ledger/registry.js'
import {
  chainClock, chainPeriods, drawStratum, nextPeriodEnd, periodFrame, recordWorkflow, sampleSeed, STRATA,
  type PeriodUnit, type SampleRates, type Stratum,
} from '../ledger/sampling.js'
import { recordFactsAt } from '../ledger/disk.js'
import { describeBound, successLowerBound, type BoundMethod, type Sidedness } from '../verdict/bounds.js'
import type { EvidenceRequirements, PromotionPolicy, SamplingPlan, TierRequirements, VoiceLevel, WorkflowCalibration } from '../verdict/voice.js'

// ── the adjustment voice.ts applies, and the citation it carries ────────────────────────────────────────────────────

export interface SetAside { verdict_id: string; why: string }

export interface EvidenceAdjustment {
  /** Reviews that do not count toward any rung, and why. Removed from both the denominator and the misses. */
  set_aside: SetAside[]
  /** Drawn items never reviewed by their deadline: deviations (AS 2315 .40), per stratum. They add to n AND to the errors. */
  untested: { PASS: string[]; FAIL: string[] }
  /** Clean reviews of drawn items whose period's draw is still open: not counted yet (they count once the draw completes). */
  held: string[]
  /** Evidence-level problems the audit adds (voice.ts blockers). */
  blockers: string[]
  /** Of those, the ones that are evidence OF FAILURE (reviewers missed canaries), not an absence of evidence. */
  failure_blockers: string[]
  /** Under an autonomy grant with surveillance: post-grant misses and untested drawn PASSes. Each raises the demotion proposal. */
  surveillance_cases: string[]
}

export interface PeriodDraw {
  start: string
  end: string
  /** When its drawn items fall due: the end of the next period. */
  due_by: string
  /** The rung in force when the period closed, and the rates the policy gives it. */
  rung: VoiceLevel
  rates: SampleRates
  seed: string
  population: { PASS: number; FAIL: number }
  drawn: { PASS: number; FAIL: number }
  reviewed: number
  pending: number
  untested: number
  /** A SAMPLE on the book commits this exact draw (the queue was published). */
  committed: boolean
  status: 'complete' | 'open' | 'overdue'
}

export interface EvidenceCitation {
  tier: string
  requirements: EvidenceRequirements & { sampling?: SamplingPlan; max_rung?: VoiceLevel }
  selection?: { period: PeriodUnit; draws: PeriodDraw[]; not_yet_closed: number }
  surveillance?: {
    grant: string
    since_seq: number
    rate: number
    period: PeriodUnit
    drawn: number
    reviewed: number
    pending: number
    /** PASSes recorded after the grant that a person overturned (drawn or not). */
    misses: string[]
    /** Drawn post-grant PASSes left unreviewed past their deadline. */
    untested: string[]
  }
  canaries?: {
    sealed: number
    revealed: number
    /** Seals not yet revealed: their items read as ordinary work until then. */
    outstanding: number
    reviewed: number
    caught: number
    /** Canaries a reviewer UPHELD. A reviewer may dispute a canary's label with its sealer. */
    missed: string[]
    lower_bound: number
    bound: string
    /** Present when the tier declares the requirement. */
    requirement?: { min_n: number; min_catch_rate: number; shown: boolean }
  }
  /** `cosigners`: D-DUAL, the grant's co-signers, whose own clean reviews are set aside too (present only when any). */
  segregation?: { signer: string; cosigners?: string[]; set_aside: string[] }
  set_aside: SetAside[]
  held: string[]
  untested: { PASS: string[]; FAIL: string[] }
  /** Who the counted evidence rests on (reviewer ids, sorted). At a segregated tier, the grant's signer is not among them. */
  reviewers: string[]
  notes: string[]
}

// ── the policy's draw rates for a rung ──────────────────────────────────────────────────────────────────────────────

/**
 * The fraction of each stratum a period draws for review, from the tier's declared sampling plan and the rung in force when
 * the period closed. record / advise: review_rate (discretionary review, so it must be drawn). gate: a census (the rung
 * sends every PASS to a person and holds every FAIL). autonomy: surveillance_rate of PASSes; every FAIL is still held (a
 * census). No plan: nothing is drawn.
 */
export function samplingRates(tier: Pick<TierRequirements, 'sampling'>, rung: VoiceLevel): SampleRates {
  const s = tier.sampling
  if (!s) return { PASS: 0, FAIL: 0 }
  if (rung === 'gate') return { PASS: 1, FAIL: 1 }
  if (rung === 'autonomy') return { PASS: s.surveillance_rate ?? 0, FAIL: 1 }
  const r = s.review_rate ?? 0
  return { PASS: r, FAIL: r }
}

// ── reading the chain ───────────────────────────────────────────────────────────────────────────────────────────────

interface LatestReview { seq: number; reviewer_id: string; decision: 'UPHELD' | 'OVERTURNED'; signed?: SignedReviewEntry }

/** Parse a ledger's chain export (chainJSONL) without importing the file module. */
export function chainOf(jsonl: string): { events: LedgerEvent[]; payloads: unknown[] } {
  const events: LedgerEvent[] = [], payloads: unknown[] = []
  for (const line of jsonl.split('\n')) {
    const s = line.trim()
    if (!s) continue
    const { payload, ...ev } = JSON.parse(s) as LedgerEvent & { payload: unknown }
    events.push(ev as LedgerEvent)
    payloads.push(payload)
  }
  return { events, payloads }
}

const tk = (tenant: string, id: string): string => `${tenant}\u0000${id}`

/**
 * The latest review and RECORD position of every (tenant, verdict id), as the ledger attributes them (F-A: a REVIEW names
 * its tenant; a legacy one reviewed the id's latest owner). `forWorkflow` resolves an id for one workflow's tenant, so one
 * tenant's review is never read into another's evidence.
 */
function latestReviews(events: readonly LedgerEvent[], payloads: readonly unknown[], book: DecisionBook, workflow_id: string): {
  review: (id: string) => LatestReview | undefined
  recordSeq: (id: string) => number | undefined
} {
  const signedAt = new Map(book.signed_reviews.map(r => [r.seq, r]))
  const reviews = new Map<string, LatestReview>()
  const recordSeq = new Map<string, number>()
  const latestOwner = new Map<string, string>()
  let wfTenant: string | undefined
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    const p = (recordFactsAt(payloads, i) ?? payloads[i]) as { tenant_id?: unknown; review?: { reviewer_id?: string; decision?: string } } // P-J: no parse
    if (ev.type === 'RECORD') {
      const tenant = typeof p?.tenant_id === 'string' ? p.tenant_id : ''
      recordSeq.set(tk(tenant, ev.verdict_id), i)
      latestOwner.set(ev.verdict_id, tenant)
      if (wfTenant === undefined && recordWorkflow(p) === workflow_id) wfTenant = tenant
      continue
    }
    if (ev.type !== 'REVIEW') continue
    const tenant = typeof p?.tenant_id === 'string' ? p.tenant_id : latestOwner.get(ev.verdict_id)
    if (tenant === undefined || !recordSeq.has(tk(tenant, ev.verdict_id))) continue
    const r = p?.review
    if (!r || (r.decision !== 'UPHELD' && r.decision !== 'OVERTURNED')) continue
    const signed = signedAt.get(i)
    reviews.set(tk(tenant, ev.verdict_id), { seq: i, reviewer_id: String(r.reviewer_id ?? ''), decision: r.decision, ...(signed ? { signed } : {}) })
  }
  // With the default workflow key the tenant is the workflow's; with a custom key, the id's latest owner (the v0 reading).
  const key = (id: string): string => tk(wfTenant ?? latestOwner.get(id) ?? '', id)
  return { review: id => reviews.get(key(id)), recordSeq: id => recordSeq.get(key(id)) }
}

/** A signed review that counts: signed, and by a key anchored to the reviewer (the registry's role, or trusted_keys). */
const anchoredSigned = (r: LatestReview | undefined): boolean => !!r?.signed && r.signed.via !== 'unanchored'

// ── the audit ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EvidenceAuditInput {
  workflow_id: string
  events: readonly LedgerEvent[]
  payloads: readonly unknown[]
  /** The verified book (readDecisionBook). */
  book: DecisionBook
  tier: TierRequirements
  method: BoundMethod
  sidedness: Sidedness
  calibration: WorkflowCalibration
  /** The GRANT in force (absent: nothing granted, the rung is record). */
  grant?: DecisionEntry<GrantDecision>
  /** The policy assessed under: the rung in force when each period closed is read under its tiers (D-DUAL: grantAt). */
  policy?: PromotionPolicy
}

/** Does the audit have anything to do for this tier and book? (If not, the assessment is exactly the pre-audit one.) */
export function auditApplies(tier: TierRequirements, book: DecisionBook, workflow_id: string): boolean {
  const e = tier.evidence
  return !!tier.sampling || !!(e && (e.random_selection || e.signed_reviews || e.segregation || e.canaries))
    || canarySealsFor(book.canaries, workflow_id).length > 0
}

export function auditEvidence(input: EvidenceAuditInput): { adjustment: EvidenceAdjustment; citation: EvidenceCitation } {
  const { workflow_id: wf, events, payloads, book, tier, calibration: cal, grant } = input
  const reading = input.policy ? { policies: [input.policy], governing_policy: input.policy } : {} // D-GOVERNING-POLICY (grantAt honors it: P-S4-C)
  const req = tier.evidence ?? {}
  const confidence = tier.confidence
  const lr = latestReviews(events, payloads, book, wf)
  const reviews = { get: lr.review }
  const recordSeq = { get: lr.recordSeq }
  const overturned = new Set([...cal.evidence.false_pass, ...cal.evidence.false_fail])
  const reviewed = [...cal.evidence.reviewed_pass, ...cal.evidence.reviewed_fail].sort()
  const setAside = new Map<string, string>()
  const aside = (id: string, why: string): void => { if (!setAside.has(id)) setAside.set(id, why) }
  const blockers: string[] = [], failure_blockers: string[] = [], notes: string[] = []

  // ── canaries: never evidence about the workflow; the attention test ──────────────────────────────────────────────
  const seals = canarySealsFor(book.canaries, wf)
  const reveals = canaryRevealsFor(book.canaries, wf)
  const canaryIds = new Set<string>()
  const sealerOf = new Map<string, string>()
  for (const r of reveals) for (const id of r.signed.decision.verdict_ids) { canaryIds.add(id); sealerOf.set(id, r.signed.decision.signer_id) }
  for (const id of reviewed) if (canaryIds.has(id)) aside(id, 'a revealed canary: a known-bad item seeded to measure reviewer attention, never evidence about the workflow')
  let canaryCitation: EvidenceCitation['canaries'] | undefined
  if (seals.length || req.canaries) {
    let n = 0, caught = 0
    const missed: string[] = []
    for (const id of [...canaryIds].sort()) {
      const r = reviews.get(id)
      if (!r || r.reviewer_id === sealerOf.get(id)) continue // unreviewed (spent), or reviewed by the person who sealed it
      if (req.signed_reviews && !anchoredSigned(r)) continue
      n++
      if (r.decision === 'OVERTURNED') caught++
      else missed.push(id)
    }
    const lower = successLowerBound(caught, n, confidence, input.method, input.sidedness)
    const revealedSeals = new Set(reveals.map(r => r.signed.decision.seal))
    canaryCitation = {
      sealed: seals.length, revealed: reveals.length, outstanding: seals.filter(s => !revealedSeals.has(s.decision_id)).length,
      reviewed: n, caught, missed, lower_bound: lower, bound: `${describeBound(confidence, input.method, input.sidedness)} lower bound`,
    }
    if (req.canaries) {
      const shown = n >= req.canaries.min_n && lower >= req.canaries.min_catch_rate
      canaryCitation.requirement = { min_n: req.canaries.min_n, min_catch_rate: req.canaries.min_catch_rate, shown }
      if (!shown) {
        const what = n < req.canaries.min_n
          ? `${n} reviewed canar${n === 1 ? 'y' : 'ies'} < minimum ${req.canaries.min_n}`
          : `the ${describeBound(confidence, input.method, input.sidedness)} lower bound on the catch rate is ${pct(lower)} (${caught}/${n} caught) < floor ${pct(req.canaries.min_catch_rate)}`
        const b = `reviewer attention is not shown: ${what}. Until it is, no overturn rate counts as evidence (IMDA MGF Agentic §2.2.2: a low override rate may signal rubber-stamping)`
        blockers.push(b)
        if (missed.length) failure_blockers.push(b)
      }
    }
  }

  // ── signed reviews ───────────────────────────────────────────────────────────────────────────────────────────────
  if (req.signed_reviews) {
    let unanchored = 0
    for (const id of reviewed) {
      if (setAside.has(id)) continue
      const r = reviews.get(id)
      if (anchoredSigned(r)) continue
      if (r?.signed) unanchored++
      aside(id, r?.signed
        ? 'signed by a key not anchored to a person (read the book with root_keys or trusted_keys): a signature proves the key holder, not the reviewer'
        : 'an unsigned review: this tier counts only a person\'s signed review, so an agent cannot manufacture the evidence')
    }
    if (unanchored) notes.push(`${unanchored} signed review(s) could not be tied to a person: the book was read without an anchor for their keys`)
  }

  // ── segregation of duties ────────────────────────────────────────────────────────────────────────────────────────
  let segregation: EvidenceCitation['segregation'] | undefined
  if (req.segregation && grant) {
    const signer = grant.signed.decision.signer_id
    const fp = keyFingerprint(grant.signed.public_key)
    const own: string[] = []
    for (const id of reviewed) {
      if (setAside.has(id)) continue
      const r = reviews.get(id)
      if (!r || r.decision !== 'UPHELD') continue
      if (r.reviewer_id === signer || (fp !== undefined && r.signed?.fingerprint === fp)) {
        own.push(id)
        aside(id, `segregation of duties: '${signer}' signed the grant in force and reviewed this item; a grant cannot rest on its signer's own clean reviews (COSO GenAI p.13)`)
      }
    }
    // D-DUAL: a co-signer signed the grant too, so their own clean reviews are set aside by the same rule.
    const cosigns = grantSignatures(grant, book.decisions, reading).cosigns
    for (const c of cosigns) {
      for (const id of reviewed) {
        if (setAside.has(id)) continue
        const r = reviews.get(id)
        if (!r || r.decision !== 'UPHELD') continue
        if (r.reviewer_id === c.signer_id || (c.fingerprint !== '' && r.signed?.fingerprint === c.fingerprint)) {
          own.push(id)
          aside(id, `segregation of duties: '${c.signer_id}' co-signed the grant in force and reviewed this item; a grant cannot rest on its signers' own clean reviews (COSO GenAI p.13)`)
        }
      }
    }
    own.sort()
    segregation = { signer, ...(cosigns.length ? { cosigners: cosigns.map(c => c.signer_id) } : {}), set_aside: own }
  }

  // ── the draws ────────────────────────────────────────────────────────────────────────────────────────────────────
  const held: string[] = []
  const untested: { PASS: string[]; FAIL: string[] } = { PASS: [], FAIL: [] }
  const drawnInfo = new Map<string, { stratum: Stratum; start: string; open: boolean; overdue: boolean; surveillance: boolean }>()
  let selection: EvidenceCitation['selection'] | undefined
  const counts = (r: LatestReview | undefined): boolean => !!r && (!req.signed_reviews || anchoredSigned(r))
  if (tier.sampling) {
    const unit = tier.sampling.period
    const spans = chainPeriods(events, unit)
    const clock = chainClock(events)
    const draws: PeriodDraw[] = []
    let notClosed = 0
    let population = 0
    for (const span of spans) {
      if (span.closed_by === undefined) { notClosed++; continue }
      const epoch = events[span.last_seq]!
      const rung: VoiceLevel = grantAt(book.decisions, wf, span.last_seq + 1, reading)?.signed.decision.level ?? 'record'
      const rates = samplingRates(tier, rung)
      const frame = periodFrame(events, payloads, wf, span)
      population += frame.PASS.length + frame.FAIL.length
      if (rates.PASS === 0 && rates.FAIL === 0) continue
      const seed = sampleSeed(wf, unit, span.start, epoch.entry_hash)
      const due_by = nextPeriodEnd(span.start, unit)
      const overdue = clock !== undefined && clock >= Date.parse(due_by)
      const drawn: Record<Stratum, string[]> = { PASS: [], FAIL: [] }
      for (const s of STRATA) drawn[s] = drawStratum(frame[s], seed, s, rates[s]).filter(id => !canaryIds.has(id) && !drawnInfo.has(id))
      let rev = 0, pend = 0, unt = 0
      const open = STRATA.some(s => drawn[s].some(id => !counts(reviews.get(id))))
      for (const s of STRATA) {
        for (const id of drawn[s]) {
          const surveilled = s === 'PASS' && rung === 'autonomy' && (tier.sampling.surveillance_rate ?? 0) > 0
          drawnInfo.set(id, { stratum: s, start: span.start, open: open && !overdue, overdue, surveillance: surveilled })
          if (counts(reviews.get(id))) rev++
          else if (overdue) { unt++; if (req.random_selection || surveilled) untested[s].push(id) }
          else pend++
        }
      }
      const committed = book.samples.some(e => e.sample.workflow_id === wf && e.sample.period.unit === unit && e.sample.period.start === span.start
        && e.sample.rates.PASS === rates.PASS && e.sample.rates.FAIL === rates.FAIL)
      draws.push({
        start: span.start, end: span.end, due_by, rung, rates, seed,
        population: { PASS: frame.PASS.length, FAIL: frame.FAIL.length }, drawn: { PASS: drawn.PASS.length, FAIL: drawn.FAIL.length },
        reviewed: rev, pending: pend, untested: unt, committed, status: pend + unt === 0 ? 'complete' : overdue ? 'overdue' : 'open',
      })
    }
    selection = { period: unit, draws, not_yet_closed: notClosed }
    const uncommitted = draws.filter(d => !d.committed).length
    if (uncommitted) notes.push(`${uncommitted} closed period(s) have no SAMPLE committed on the book at the policy's rates: the draw is still fixed by the chain and re-derived here, but the queue was never published (commit it with ledger.commitSample)`)
    if (req.random_selection && population === 0 && reviewed.length > 0) {
      blockers.push(`random selection is required, but the sampling frame (the default workflow key, tenant/ruleset@version, over closed ${unit}s) holds none of this workflow's records: no review can qualify`)
    }
  }

  // ── random selection: what the draws let count ──────────────────────────────────────────────────────────────────
  if (req.random_selection) {
    for (const id of reviewed) {
      if (setAside.has(id)) continue
      if (overturned.has(id)) continue // evidence against counts wherever a person found it
      const d = drawnInfo.get(id)
      if (!d) { aside(id, 'not drawn by the random selection: a clean review of an item a person chose to review is not evidence (AS 2315 .39)'); continue }
      if (d.open) held.push(id)
    }
  }

  // ── surveillance under autonomy ──────────────────────────────────────────────────────────────────────────────────
  let surveillance: EvidenceCitation['surveillance'] | undefined
  const surveillance_cases: string[] = []
  if (grant && grant.signed.decision.level === 'autonomy') {
    const rate = tier.sampling?.surveillance_rate ?? 0
    if (rate > 0 && tier.sampling) {
      const since = grant.seq
      const after = (id: string): boolean => (recordSeq.get(id) ?? -1) > since
      const misses = cal.evidence.false_pass.filter(id => after(id) && !setAside.has(id)).sort()
      const unt = untested.PASS.filter(after).sort()
      let drawn = 0, rev = 0, pend = 0
      for (const [id, d] of drawnInfo) {
        if (d.stratum !== 'PASS' || !after(id)) continue
        drawn++
        if (counts(reviews.get(id))) rev++
        else if (!d.overdue) pend++
      }
      surveillance = { grant: grant.decision_id, since_seq: since, rate, period: tier.sampling.period, drawn, reviewed: rev, pending: pend, misses, untested: unt }
      surveillance_cases.push(...new Set([...misses, ...unt]))
      surveillance_cases.sort()
    } else {
      notes.push('no surveillance_rate is declared at this tier: once PASSes proceed unreviewed under autonomy, the false-PASS evidence stops growing and no new miss can raise a proposal (research §5.3)')
    }
  }

  const counted = reviewed.filter(id => !setAside.has(id) && !held.includes(id))
  const reviewers = [...new Set(counted.map(id => reviews.get(id)?.reviewer_id).filter((x): x is string => !!x))].sort()
  const set_aside = [...setAside].map(([verdict_id, why]) => ({ verdict_id, why })).sort((a, b) => a.verdict_id.localeCompare(b.verdict_id))
  untested.PASS.sort(); untested.FAIL.sort(); held.sort()
  const adjustment: EvidenceAdjustment = { set_aside, untested, held, blockers, failure_blockers, surveillance_cases }
  const citation: EvidenceCitation = {
    tier: tier.tier,
    requirements: { ...structuredClone(req), ...(tier.sampling ? { sampling: { ...tier.sampling } } : {}), ...(tier.max_rung ? { max_rung: tier.max_rung } : {}) },
    ...(selection ? { selection } : {}),
    ...(surveillance ? { surveillance } : {}),
    ...(canaryCitation ? { canaries: canaryCitation } : {}),
    ...(segregation ? { segregation } : {}),
    set_aside, held: [...held], untested: { PASS: [...untested.PASS], FAIL: [...untested.FAIL] }, reviewers, notes,
  }
  return { adjustment, citation }
}

const pct = (x: number): string => `${Number((x * 100).toPrecision(3))}%`

/**
 * Before a person signs a GRANT at a segregated tier: the verdicts of this workflow whose latest review is theirs (by id).
 * The book would set those clean reviews aside for their grant, so the evidence may no longer carry it.
 */
export function reviewsBy(events: readonly LedgerEvent[], payloads: readonly unknown[], workflow_id: string, reviewer_id: string): string[] {
  const wfOf = new Map<string, string | undefined>()
  const latest = new Map<string, string>()
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (ev.type === 'RECORD') { wfOf.set(ev.verdict_id, recordWorkflow(recordFactsAt(payloads, i) ?? payloads[i])); continue } // P-J
    if (ev.type !== 'REVIEW') continue
    const r = (payloads[i] as { review?: { reviewer_id?: string } })?.review
    if (r?.reviewer_id !== undefined) latest.set(ev.verdict_id, r.reviewer_id)
  }
  return [...latest].filter(([id, who]) => who === reviewer_id && wfOf.get(id) === workflow_id).map(([id]) => id).sort()
}
