/**
 * Credence-gated voice — how far a workflow's agents may be trusted, measured from the book of record and DECIDED by a person.
 *
 * The rungs (how one action is handled; ACTION_HANDLING in notices.ts):
 *   record    quiet entry: every verdict is logged; a FAIL/ABSTAIN is recorded and surfaced as a notice with its evidence
 *             and a dispute path. Nothing is held. The day-1 audit report.
 *   advise    the same, surfaced prominently in-flow to the person and the agent; strong advisories live here. Nothing is held.
 *   gate      a FAIL/ABSTAIN HOLDS that action until a person resolves it. PASSes still get human review.
 *   autonomy  PASSes proceed unreviewed inside the declared bounds. A FAIL/ABSTAIN is still HELD.
 * At EVERY rung, every FAIL is shown with its evidence and can be disputed. Intercepting the tool call in-flow (the
 * verify_action adapters) is a delivery surface for the gate/autonomy holds, not a rung of its own.
 *
 * What each rung must show (per workflow, from human-reviewed verdicts on the ledger):
 *   advise, gate   the FALSE-FLAG rate: FAIL verdicts a person overturned / FAIL verdicts reviewed.
 *   autonomy       the FALSE-PASS rate: PASS verdicts a person overturned / PASS verdicts reviewed.
 * A rung is supported when n ≥ the declared minimum AND the declared one-sided upper confidence bound is ≤ the declared bar.
 * Support is cumulative.
 *
 * DESIGN RULING (2026-09-28): the rung changes ONLY by a person's decision, in either direction.
 *   1. Riposte PROPOSES. When the evidence supports the rung above what a person granted, it raises a PROMOTION PROPOSAL.
 *      When the evidence stops supporting the granted rung, it raises a DEMOTION PROPOSAL: the same format, with the
 *      failing cases listed for dispute, flagged urgent when something went wrong (basis 'failure') and a standing notice
 *      when the record simply does not yet support the grant (basis 'unevidenced'). One rung at a time, both ways. The
 *      effective rung is always exactly what a person granted; assessVoice never changes it (property-tested).
 *   2. Stable settings, no dynamic difficulty. The policy (method, tiers, bars, minimums, confidence) is declared data,
 *      fixed at grant time and versioned. Nothing here tunes it. A person adjusts the weighting at a review with
 *      revisePolicy(): a new version that records who, when, why, what changed, and the hash of the version it supersedes.
 *      A grant names the policy version and consequence tier it was made under; assessing it under any other settings is
 *      refused.
 *   3. The burden of proof scales with consequence: lintPolicy rejects a policy whose burden ever decreases as the
 *      consequence rises.
 *
 * Honesty guards: evidence that spans ruleset/engine versions supports nothing (the accuracy.ts precedent); a calibration
 * that no longer matches its own hash supports nothing; COUNSEL and judgement-tier (REASONED) findings are never counted as
 * VERDICT evidence. Pure and deterministic: records + declaration + policy in, the same assessment out.
 *
 * THE BOOK OF RECORD (2026-09-28): a person's decisions are signed ledger events (ledger/decisions.ts). Pass a
 * BookDeclaration ({ workflow_id, book }) and assessVoice reads the rung, tier, bounds and policy version from the GRANT in
 * force on a verified book, never from a flag; a person's standing DECLINE holds the proposal back until the evidence
 * changes (declineStanding); the assessment cites the grant it would amend. A book that does not verify (a tampered,
 * mis-signed or unanchored decision) grants nothing and is refused. D-ANCHOR (2026-09-28): on a verified book, only an
 * ANCHORED signer's decision has effect; an unanchored GRANT or DECLINE is cited under `book.no_effect` with its notice and
 * moves nothing, in either direction. The flag path (a WorkflowDeclaration with `granted`) is unchanged, byte for byte.
 *
 * EVIDENCE INTEGRITY (2026-09-28): so the evidence behind a grant cannot quietly rot or be gamed. A policy tier may
 * declare, fixed at grant like everything else: a sampling plan (random review draws from the book, and SURVEILLANCE under
 * autonomy, so the false-PASS evidence keeps flowing and a demotion PROPOSAL can fire on a new miss), random-selection-only
 * evidence, signed reviews, segregation of duties, reviewer-attention canaries, and a highest grantable rung (max_rung). The
 * book path applies them (surveillance/evidence.ts); the flag path cannot (it has no book), and never did. lintPolicy flags
 * a minimum that can never clear its own bar, and every bound says its sidedness. A demotion proposal is classified by
 * `basis`: 'failure' (a miss, an untested drawn item, an integrity or attention failure) or 'unevidenced' (granted above what
 * the book supports, and nothing has gone wrong).
 *
 * DUAL AUTHORIZATION (D-DUAL, design ruling 2026-09-28): a tier may declare `grant_signatures` (default 1). A GRANT of
 * autonomy at such a tier is in force only once that many people have signed it: its signer and anchored co-signers
 * (GRANT_COSIGN, ledger/decisions.ts) on distinct keys. Until then it is on the book, PENDING, of no effect, and cited under
 * `book.no_effect` with its notice. grantUnderPolicy writes the tier's count into the grant (`signatures`).
 */

import type { Ledger, LedgerRecord } from '../ledger/types.js'
import type { LedgerEvent } from '../ledger/chain.js'
import { ruleCalibration, type RuleCalibration } from '../ledger/calibration.js'
import {
  readDecisionBook, grantInForce, grantAt, grantSignatures, declinesFor, revisionsOf, makeGrant, decisionProblem, DecisionRefused, noEffect, MAX_SIGNATURES,
  type DecisionBook, type DecisionEntry, type DeclineDecision, type GrantDecision, type NoEffect, type PolicyRevisionDecision, type TrustedKeys,
} from '../ledger/decisions.js'
import type { Outcome } from './schema.js'
import { hashOf } from './canonical.js'
import { describeBound, rateInterval, zeroMissN, type BoundMethod, type Sidedness } from './bounds.js'
import { PERIOD_LENGTH_RANK, isPeriodUnit, recordWorkflow, type PeriodUnit } from '../ledger/sampling.js'
import { evidenceMark, recordFacts, recordFactsAt, type VerdictFacts } from '../ledger/disk.js'
import { tenantOfWorkflow, type RootKeys } from '../ledger/registry.js'
import { auditApplies, auditEvidence, type EvidenceAdjustment, type EvidenceCitation } from '../surveillance/evidence.js'
import { ACTION_HANDLING, disputeCommand, type ActionHandling } from './notices.js'

export type VoiceLevel = 'record' | 'advise' | 'gate' | 'autonomy'
export type Rung = Exclude<VoiceLevel, 'record'>
export const VOICE_LADDER: readonly VoiceLevel[] = ['record', 'advise', 'gate', 'autonomy']
export const RUNGS: readonly Rung[] = ['advise', 'gate', 'autonomy']
export type RungMetric = 'false_flag_rate' | 'false_pass_rate'
export const RUNG_METRIC: Readonly<Record<Rung, RungMetric>> = { advise: 'false_flag_rate', gate: 'false_flag_rate', autonomy: 'false_pass_rate' }

export const levelRank = (l: VoiceLevel): number => VOICE_LADDER.indexOf(l)

export { ACTION_HANDLING, type ActionHandling }

// ── per-workflow calibration (from the ledger) ───────────────────────────────────────────────────────────────────────

export interface WorkflowCalibration {
  calibration_version: 'workflow-calibration-v0'
  workflow_id: string
  window: { since?: string; until?: string; first_recorded_at?: string; last_recorded_at?: string }
  /** The distinct `ruleset@version · engine X` the evidence spans. More than one: the evidence supports nothing. */
  versions: string[]
  records: number
  by_outcome: Record<Outcome, number>
  reviewed: Record<Outcome, number>
  overturned: Record<Outcome, number>
  /** Verdict ids, sorted: the replayable evidence behind every rate. */
  evidence: {
    reviewed_pass: string[]
    reviewed_fail: string[]
    /** PASS verdicts a person overturned: the check said PASS and the person said it was wrong (the misses). */
    false_pass: string[]
    /** FAIL verdicts a person overturned: false alarms. */
    false_fail: string[]
  }
  /** Records left out of the evidence, and why. */
  excluded: { verdict_id: string; why: string }[]
  /** Per-rule breakdown (the ledger's ruleCalibration) over this workflow's reviewed records. */
  rules: RuleCalibration[]
  /** hashOf(everything above). assessVoice re-derives it; a calibration that no longer matches supports nothing. */
  calibration_hash: string
}

export interface WorkflowCalibrationOptions {
  /** Key a record to its workflow. Default `${tenant_id}/${ruleset.id}@${ruleset.version}`. Return undefined to skip a record. */
  workflowOf?: (rec: LedgerRecord) => string | undefined
  /** Inclusive lower bound on recorded_at (ISO-8601). */
  since?: string
  /** Exclusive upper bound on recorded_at (ISO-8601). */
  until?: string
}

/** The default workflow key: one tenant, one ruleset version. A new ruleset version is a new workflow with a fresh record. */
export function defaultWorkflowOf(rec: LedgerRecord): string {
  const v = recordFacts(rec) ?? rec.verdict // P-J: a disk-backed book's index answers without reading the verdict
  return `${rec.tenant_id}/${v.ruleset.id}@${v.ruleset.version}`
}

const zero = (): Record<Outcome, number> => ({ PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 })

/**
 * One record in a calibration, and its facts from the book's index when it keeps them (P-J). The calibration reads
 * `f ?? rec.verdict`: the same values in either mode. A disk-backed book answers from its index, so only a reviewed verdict is
 * read in full (per rule); a record without facts is read when counted, and its verdict is never held.
 */
interface Counted { rec: LedgerRecord; f: VerdictFacts | undefined }

function buildCalibration(workflow_id: string, recs: Counted[], excluded: { verdict_id: string; why: string }[], opts: WorkflowCalibrationOptions): WorkflowCalibration {
  const by_outcome = zero(), reviewed = zero(), overturned = zero()
  const reviewed_pass: string[] = [], reviewed_fail: string[] = [], false_pass: string[] = [], false_fail: string[] = []
  const versions = new Set<string>()
  let first: string | undefined, last: string | undefined
  for (const { rec, f } of recs) {
    const v = f ?? rec.verdict
    by_outcome[v.outcome]++
    versions.add(`${v.ruleset.id}@${v.ruleset.version} · engine ${v.engine_version}`)
    if (first === undefined || rec.recorded_at < first) first = rec.recorded_at
    if (last === undefined || rec.recorded_at > last) last = rec.recorded_at
    if (!rec.review) continue
    const over = rec.review.decision === 'OVERTURNED'
    reviewed[v.outcome]++
    if (over) overturned[v.outcome]++
    if (v.outcome === 'PASS') { reviewed_pass.push(v.verdict_id); if (over) false_pass.push(v.verdict_id) }
    if (v.outcome === 'FAIL') { reviewed_fail.push(v.verdict_id); if (over) false_fail.push(v.verdict_id) }
  }
  const window: WorkflowCalibration['window'] = {
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.until !== undefined ? { until: opts.until } : {}),
    ...(first !== undefined ? { first_recorded_at: first } : {}),
    ...(last !== undefined ? { last_recorded_at: last } : {}),
  }
  const body: Omit<WorkflowCalibration, 'calibration_hash'> = {
    calibration_version: 'workflow-calibration-v0',
    workflow_id,
    window,
    versions: [...versions].sort(),
    records: recs.length,
    by_outcome,
    reviewed,
    overturned,
    evidence: {
      reviewed_pass: reviewed_pass.sort(),
      reviewed_fail: reviewed_fail.sort(),
      false_pass: false_pass.sort(),
      false_fail: false_fail.sort(),
    },
    excluded: [...excluded].sort((a, b) => a.verdict_id.localeCompare(b.verdict_id) || a.why.localeCompare(b.why)),
    // A person's review is involved: each reviewed verdict is read in full (the rule ids and names are in its claims).
    rules: ruleCalibration(recs.flatMap(c => (c.rec.review ? [c.rec] : []))).rules,
  }
  return { ...body, calibration_hash: hashOf(body) }
}

/** Why a recorded object (a verdict, or its facts: P-J) is not VERDICT evidence (generated, or judgement-tier findings), or undefined. */
function notVerdictEvidence(v: unknown): string | undefined {
  const mark = evidenceMark(v)
  if (mark === 'COUNSEL') return 'COUNSEL on the ledger: generated material is never VERDICT evidence'
  if (mark === 'REASONED') return 'carries judgement-tier (REASONED) findings: those are advisories (COUNSEL), never VERDICT evidence'
  return undefined
}

/**
 * Per-workflow calibration for every workflow in the records, sorted by workflow id. Only the verdicts a person reviewed
 * carry an agree/disagree signal; the rest are counted as volume. Deterministic.
 */
export function workflowCalibrations(records: readonly LedgerRecord[], opts: WorkflowCalibrationOptions = {}): WorkflowCalibration[] {
  return calibrate(records, opts)
}

/** The calibrations of the records' workflows (`only`: that workflow's alone, the others never read). */
function calibrate(records: readonly LedgerRecord[], opts: WorkflowCalibrationOptions, only?: string): WorkflowCalibration[] {
  const keyOf = opts.workflowOf ?? defaultWorkflowOf
  const groups = new Map<string, Map<string, Counted>>()
  const excluded = new Map<string, { verdict_id: string; why: string }[]>()
  const ex = (k: string, verdict_id: string, why: string): void => {
    const list = excluded.get(k) ?? []
    list.push({ verdict_id, why })
    excluded.set(k, list)
  }
  for (const rec of records) {
    if (opts.since !== undefined && rec.recorded_at < opts.since) continue
    if (opts.until !== undefined && rec.recorded_at >= opts.until) continue
    let key: string | undefined
    try { key = keyOf(rec) } catch { key = undefined }
    if (key === undefined || (only !== undefined && key !== only)) continue
    if (!groups.has(key)) groups.set(key, new Map())
    const f = recordFacts(rec) // P-J: the index's facts, or the verdict itself (the same values)
    const v = f ?? rec.verdict
    const id = String((v as { verdict_id?: unknown } | undefined)?.verdict_id ?? '')
    const why = notVerdictEvidence(v)
    if (why) { ex(key, id, why); continue }
    const g = groups.get(key)!
    if (g.has(id)) ex(key, id, 'duplicate record for the same verdict_id; the later record is used (the ledger overwrite rule)')
    g.set(id, { rec, f })
  }
  for (const k of excluded.keys()) if (!groups.has(k)) groups.set(k, new Map())
  return [...groups.keys()].sort().map(k => buildCalibration(k, [...groups.get(k)!.values()], excluded.get(k) ?? [], opts))
}

/** The calibration of one workflow (an empty record when the workflow has no verdicts yet). Only its own records are read. */
export function workflowCalibration(records: readonly LedgerRecord[], workflow_id: string, opts: WorkflowCalibrationOptions = {}): WorkflowCalibration {
  return calibrate(records, opts, workflow_id)[0] ?? buildCalibration(workflow_id, [], [], opts)
}

// ── the declared, versioned promotion policy ─────────────────────────────────────────────────────────────────────────

export interface RungBar {
  /** Minimum reviewed items in the rung's denominator (thin samples are not evidence). */
  min_n: number
  /** The upper confidence bound on the rung's error rate must be at or below this. */
  max_error: number
}

/**
 * Where the reviews come from (surveillance/evidence.ts). Draws are fixed by the book (ledger/sampling.ts: the seed is the
 * chain head when the period closed), at these declared rates, for the rung in force: review_rate at record / advise, a census
 * at gate (every PASS goes to a person, every FAIL is held), surveillance_rate of PASSes at autonomy. Fixed at grant; never tuned.
 */
export interface SamplingPlan {
  /** The calendar period of every draw (UTC). A drawn item is due by the end of the NEXT period; unreviewed after that, it is a deviation. */
  period: PeriodUnit
  /** Before autonomy: the fraction of PASS and FAIL verdicts drawn for review each period (AS 2315 .39). */
  review_rate?: number
  /** Under an autonomy grant: the fraction of PASSes still drawn for human review each period (surveillance). */
  surveillance_rate?: number
}

/** What a tier's evidence must be to count (surveillance/evidence.ts). Absent: every review counts (the v0 behaviour). */
export interface EvidenceRequirements {
  /** Only reviews of items drawn by the random selection count; clean reviews of hand-picked items are set aside (AS 2315 .39). */
  random_selection?: boolean
  /** Only a person's signed review, by a key anchored to them, counts (in either direction). */
  signed_reviews?: boolean
  /** A grant cannot rest on its own signer's clean reviews (COSO GenAI p.13). */
  segregation?: boolean
  /** Reviewer attention: at least min_n reviewed canaries, and the policy's lower bound on the catch rate ≥ min_catch_rate. */
  canaries?: { min_n: number; min_catch_rate: number }
}

export interface TierRequirements {
  /** The consequence tier's name, e.g. 'low' or 'severe'. */
  tier: string
  /** What puts a workflow in this tier (dollars, reversibility), in words. Quoted in opinions. */
  description: string
  /** Confidence level of the bound, e.g. 0.95 (one-sided: see PromotionPolicy.sidedness). */
  confidence: number
  /** Metric: false-flag rate (overturned FAIL / reviewed FAIL). */
  advise: RungBar
  /** Metric: false-flag rate, a stricter bar than advise. */
  gate: RungBar
  /** Metric: false-PASS rate (overturned PASS / reviewed PASS). Never applied above max_rung. */
  autonomy: RungBar
  /** The highest rung a person may grant at this tier (absent: autonomy). E.g. 'gate' where insurers condition coverage on a callback. */
  max_rung?: VoiceLevel
  /** Random review draws and post-grant surveillance. */
  sampling?: SamplingPlan
  /** What the evidence must be to count. */
  evidence?: EvidenceRequirements
  /**
   * Dual authorization (D-DUAL): how many people must sign a GRANT of autonomy at this tier before it is in force (absent: 1).
   * The grant's signer and `grant_signatures - 1` co-signers (GRANT_COSIGN), each anchored, on distinct keys. Fixed at grant.
   */
  grant_signatures?: number
  /** Where the numbers come from (a standard, a report section), quoted in opinions. */
  basis?: string
}

export interface PolicyRef { policy_id: string; version: string; hash: string }

/** A person's adjustment of the weighting at a review: recorded, versioned, chained to the version it supersedes. */
export interface PolicyRevision {
  supersedes: PolicyRef
  revised_by: string
  revised_at: string
  reason: string
  /** What changed, in words (computed by revisePolicy). */
  changes: string[]
}

export interface PromotionPolicy {
  policy_version: 'promotion-policy-v0'
  policy_id: string
  version: string
  /** The declared confidence method for every bound. */
  method: BoundMethod
  /**
   * The sidedness of every bound. v0 assesses against a ONE-SIDED upper bound (the audit-sampling convention); declare it so
   * every published number says which it is. Absent: read as one-sided, and lintPolicy warns. 'two-sided' is refused.
   */
  sidedness?: Sidedness
  /** Ascending order of consequence. The burden of proof may never decrease along this order (lintPolicy enforces it). */
  tiers: TierRequirements[]
  /** Present on every version after the first: the person's recorded revision. */
  revision?: PolicyRevision
}

/**
 * ◇ ILLUSTRATIVE ONLY — not ratified by any deployment, not calibrated against a real deployment. It exists so the machinery
 * can be exercised and read. A deployment declares its own policy; the bars are a business and risk decision, not ours.
 * Note what the severe tier implies: with 0 misses, a 0.1% bar at 99% one-sided Wilson needs 5,407 reviewed PASSes.
 *
 * FIXED 2026-09-28 (research §5.1): severe.autonomy.min_n was 2,000, which can never clear its own
 * bar (the zero-miss n is 5,407 under this policy's one-sided Wilson; 4,603 exact), so the stated minimum was not the real
 * one. It is now the zero-miss n, and the sidedness is declared. VERSION 0.2.0 (design ruling, 2026-09-28): a changed
 * body never keeps an old label, so the fix ships as 0.2.0. 0.1.0 names the earlier body (severe min_n 2,000, sidedness
 * undeclared).
 * The research-grounded tiers are RESEARCH_PROMOTION_POLICY, below.
 */
export const EXAMPLE_PROMOTION_POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0',
  policy_id: 'example-illustrative',
  version: '0.2.0',
  method: 'wilson',
  sidedness: 'one-sided',
  tiers: [
    { tier: 'low', description: 'reversible and small (e.g. under $1,000; undone by a credit note)', confidence: 0.9, advise: { min_n: 20, max_error: 0.3 }, gate: { min_n: 50, max_error: 0.15 }, autonomy: { min_n: 100, max_error: 0.03 } },
    { tier: 'moderate', description: 'reversible with effort (e.g. $1,000 to $10,000)', confidence: 0.95, advise: { min_n: 30, max_error: 0.25 }, gate: { min_n: 100, max_error: 0.1 }, autonomy: { min_n: 300, max_error: 0.01 } },
    { tier: 'high', description: 'hard to reverse or large (e.g. over $10,000, or data leaving the company)', confidence: 0.95, advise: { min_n: 50, max_error: 0.2 }, gate: { min_n: 200, max_error: 0.05 }, autonomy: { min_n: 600, max_error: 0.005 } },
    { tier: 'severe', description: 'irreversible (e.g. a wire to a new account, a filed statement)', confidence: 0.99, advise: { min_n: 100, max_error: 0.1 }, gate: { min_n: 400, max_error: 0.03 }, autonomy: { min_n: 5407, max_error: 0.001 } },
  ],
}

/** The research report every RESEARCH_PROMOTION_POLICY row cites, by title and date. */
export const RESEARCH_REPORT = 'Automated-approval evidence standards, research note, 2026-09-28'

/**
 * Research-grounded consequence tiers (2026-09-28): the §2 table of the automated-approval evidence report, as a lintable
 * policy. Every row cites it. What is sourced (✓) and what is a proposal (◇) is said per row, in `basis`:
 *   ✓ the method is EXACT one-sided binomial (Clopper-Pearson), the basis of audit attribute-sampling tables (§2 (d));
 *   ✓ the autonomy anchor is AS 2315's 5% tolerable deviation at 90–95% confidence (.34, fn 9), with min_n = the zero-miss n
 *     for the bar (§2 (e): 45 at 90%, 59 at 95%, 299 at 1% / 95%), so the minimum and the bar can never contradict;
 *   ◇ the operative autonomy bar is in dollars, min(5%, tolerable misstatement ÷ $ flow) (§2 (c)): the 5% here is the
 *     ceiling; a deployment derives its own with dollarBar() and records a person's revision (revisePolicy);
 *   ✓ the top tier is NOT grantable beyond gate (§2 T4, §5.1): insurers condition coverage on a callback or dual human
 *     authorization (⚠ secondary), and IMDA lists payments as irreversible (✓);
 *   ◇ advise / gate (false-flag) bars have no regulatory anchor (§2 (f)): product choices, kept monotone;
 *   ◇ the sampling rates are sized (see each row) so one period's surveillance at the worked example's volume re-establishes
 *     the tier's zero-miss n; review_rate is a pace choice.
 *   ✓ T3 autonomy only with two signatures (§2 T3, §5.6: dual authorization; COSO pp.12–13 "multi-party approval"):
 *     grant_signatures 2 (D-DUAL). VERSION 0.2.0: adding it changed the body, and a changed body never keeps an old label;
 *     0.1.0 names the earlier body (T3 with one signature, segregation only). VERSION 0.3.0 (2026-09-29): every row's basis
 *     now cites the report by title and date, and T3 calls 99% a deployment option. Wording only, but the body changed,
 *     so the label did too; 0.2.0 names the earlier wording.
 * Illustrative until a person ratifies it for a deployment.
 */
export const RESEARCH_PROMOTION_POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0',
  policy_id: 'research-consequence-tiers',
  version: '0.3.0',
  method: 'clopper-pearson',
  sidedness: 'one-sided',
  tiers: [
    {
      tier: 't1-routine',
      description: 'Routine and reversible: small, undone by a credit memo, an existing vendor with an unchanged remit-to, a binding twin present (PO + receipt, e-invoice XML, iXBRL). E.g. auto-approve PO-matched invoice lines within the ERP tolerance and under a per-item cap.',
      confidence: 0.9,
      advise: { min_n: 7, max_error: 0.3 },
      gate: { min_n: 15, max_error: 0.15 },
      autonomy: { min_n: 45, max_error: 0.05 },
      max_rung: 'autonomy',
      sampling: { period: 'quarter', review_rate: 0.1, surveillance_rate: 0.025 },
      evidence: { random_selection: true, signed_reviews: true },
      basis: `${RESEARCH_REPORT} §2 row T1. ✓ Autonomy: 5% tolerable deviation at 90% one-sided (AS 2315 .34, fn 9); min_n 45 = the exact zero-miss n (§1.2). ◇ Operative bar min(5%, TM ÷ $flow) (AS 2315 .18/.35 concept). ◇ advise/gate: product choices (§2 (f)). ◇ Surveillance 2.5% a quarter: at 2,000 PASSes a quarter one draw re-establishes n = 45 (§2 T1 "Quarterly fresh random re-performance sample ≥ the T1 n"; AS 2201 .61, .B33; COSO p.13 "Periodically re-perform"). ✓ Random selection (AS 2315 .39) and signed, attributable reviews (§4.5). FAR 13.402 (small, reversible, monitored).`,
    },
    {
      tier: 't2-material',
      description: 'Material, reversible with effort: larger amounts where recovery needs a vendor clawback, still below the insured\'s dual-authorization threshold. E.g. PO-matched invoices up to that threshold; e-invoice approvals (Peppol / ZATCA / KSeF twin).',
      confidence: 0.95,
      advise: { min_n: 11, max_error: 0.25 },
      gate: { min_n: 29, max_error: 0.1 },
      autonomy: { min_n: 59, max_error: 0.05 },
      max_rung: 'autonomy',
      sampling: { period: 'month', review_rate: 0.1, surveillance_rate: 0.03 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true },
      basis: `${RESEARCH_REPORT} §2 row T2. ✓ Autonomy: 5% at 95% one-sided (AS 2315 .34, fn 9); min_n 59 = the exact zero-miss n (§1.2; AS 2315 .41's "60 items"). ◇ Operative bar min(5%, TM ÷ $flow): e.g. $25k TM on $5M a quarter → 0.5% → 598 (dollarBar). ✓ Reviewer pool independent of the signer (SEC 33-8810 pp.27–28 objectivity; COSO p.13 SoD). ◇ Surveillance 3% a month: ~60 a quarter at 2,000 PASSes, ≥ n = 59 (§2 T2 "monthly random re-performance sample").`,
    },
    {
      tier: 't3-high',
      description: 'High: postings to material GL accounts or reconciliations, payments near the dual-authorization threshold, data sent to a known outside counterparty. E.g. auto-post a reconciliation match; auto-accept an extracted value into a filing workpaper.',
      confidence: 0.95,
      advise: { min_n: 14, max_error: 0.2 },
      gate: { min_n: 59, max_error: 0.05 },
      autonomy: { min_n: 299, max_error: 0.01 },
      max_rung: 'autonomy',
      sampling: { period: 'month', review_rate: 0.2, surveillance_rate: 0.15 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true, canaries: { min_n: 14, min_catch_rate: 0.8 } },
      grant_signatures: 2,
      basis: `${RESEARCH_REPORT} §2 row T3. ✓ Exact one-sided 95% (◇ 99% a deployment option); the bar is $-derived and ≤ T2's, e.g. 1% → min_n 299 (§1.2). ✓ Segregation and locked configuration (COSO pp.12–13; MAS 3.10–3.11 draft; SR 26-2 effective challenge). ◇ Canaries: 14 reviewed with none missed puts the exact 95% lower bound on the catch rate at 80.7% (IMDA §2.2.2 "A low rate may signal rubber-stamping"). ◇ Surveillance 15% a month: ~300 a quarter at 2,000 PASSes, ≥ n = 299 (§2 T3 "Monthly random re-performance"). ✓ Autonomy only with two signatures, process owner and control function (§2 T3 "Two signers", §5.6; COSO pp.12–13 multi-party approval): grant_signatures 2, so a GRANT of autonomy is in force only when a second anchored grant signer co-signs it on another key.`,
    },
    {
      tier: 't4-irreversible',
      description: 'Irreversible or insurer-conditioned: a wire or instant payment, a new or changed payee, a vendor bank-detail change, a regulatory filing, data deletion. Every action is held for a person.',
      confidence: 0.95,
      advise: { min_n: 29, max_error: 0.1 },
      gate: { min_n: 99, max_error: 0.03 },
      autonomy: { min_n: 299, max_error: 0.01 },
      max_rung: 'gate',
      sampling: { period: 'month', review_rate: 0.3 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true, canaries: { min_n: 14, min_catch_rate: 0.8 } },
      basis: `${RESEARCH_REPORT} §2 row T4 and §5.1. ✓ Highest grantable rung: gate (autonomy is not grantable; its bar is never applied and repeats T3's only to keep the table monotone). ⚠ Crime / social-engineering endorsements condition coverage on callback or dual human authorization (Ward and Smith, secondary); ✓ IMDA MGF Agentic §2.2.2 "Irreversible actions … making payments"; ✓ COSO "segregating GenAI assistance from authoritative decisioning"; ⚠ UCC 4A-202(a). ◇ Review the T4 list against the current endorsements at every renewal.`,
    },
  ],
}

/**
 * ◇ The operative autonomy bar in dollars (research §2 (c)): min(ceiling, tolerable misstatement ÷ $ flow), and the zero-miss
 * n it implies at the declared method and confidence. A proposal, not a standard: AS 2315 .18/.35 give the concept
 * (tolerable misstatement; deviations yield misstatements at a lower rate), not the formula. A person puts the result into the
 * policy with revisePolicy (recorded, versioned); nothing reads it automatically.
 */
export function dollarBar(input: { tolerable_misstatement: number; dollar_flow: number; confidence: number; method: BoundMethod; sidedness?: Sidedness; ceiling?: number }): { bar: number; zero_miss_n: number; formula: string } {
  const ceiling = input.ceiling ?? 0.05
  if (!(input.tolerable_misstatement > 0) || !(input.dollar_flow > 0)) throw new RangeError('tolerable_misstatement and dollar_flow must be positive amounts for the same period')
  if (!(ceiling > 0 && ceiling < 1)) throw new RangeError('the ceiling must be in (0, 1)')
  const ratio = input.tolerable_misstatement / input.dollar_flow
  const bar = Math.min(ceiling, ratio)
  const sided = input.sidedness ?? 'one-sided'
  return {
    bar,
    zero_miss_n: zeroMissN(bar, input.confidence, input.method, sided),
    formula: `min(${pct(ceiling)}, ${input.tolerable_misstatement} ÷ ${input.dollar_flow} = ${pct(ratio)}) = ${pct(bar)} at ${describeBound(input.confidence, input.method, sided)}`,
  }
}

export interface PolicyLint {
  ok: boolean
  errors: string[]
  /** Not wrong, but not what it says: a minimum that can never clear its own bar, an undeclared sidedness. Present only when any. */
  warnings?: string[]
}

const isObjLike = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const validRate = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1
const capOf = (t: TierRequirements): VoiceLevel => t.max_rung ?? 'autonomy'

/**
 * Validate a promotion policy: well-formed bars, a burden of proof that never decreases with consequence (bars, confidence,
 * the highest grantable rung, the sampling plan and the evidence requirements), a well-formed revision. Warns (does not fail)
 * when a declared minimum can never clear its own bar at the declared confidence and sidedness: the real minimum is the
 * zero-miss n, so the stated burden is not the true one (research §5.1: severe's 2,000 against a true 4,603–5,407).
 */
export function lintPolicy(policy: PromotionPolicy): PolicyLint {
  const errors: string[] = []
  const warnings: string[] = []
  const p = policy as unknown as Record<string, unknown>
  if (!p || typeof p !== 'object') return { ok: false, errors: ['policy must be an object'] }
  if (policy.policy_version !== 'promotion-policy-v0') errors.push(`policy_version must be 'promotion-policy-v0'`)
  if (typeof policy.policy_id !== 'string' || !policy.policy_id) errors.push('policy_id is required')
  if (typeof policy.version !== 'string' || !policy.version) errors.push('version is required')
  if (policy.method !== 'wilson' && policy.method !== 'clopper-pearson') errors.push(`method must be 'wilson' or 'clopper-pearson'`)
  if (policy.sidedness === undefined) warnings.push(`sidedness is not declared: every bound is read as one-sided (the v0 convention). Declare sidedness: 'one-sided' so every number this policy produces says which it is`)
  else if (policy.sidedness === 'two-sided') errors.push(`sidedness 'two-sided' is not assessable: every bar is tested against a one-sided upper bound. A two-sided figure at confidence c equals the one-sided figure at 1 − (1 − c)/2; declare that confidence instead`)
  else if (policy.sidedness !== 'one-sided') errors.push(`sidedness must be 'one-sided'`)
  const methodOk = policy.method === 'wilson' || policy.method === 'clopper-pearson'
  if (policy.revision !== undefined) {
    const r = policy.revision
    if (!r || !r.supersedes || !r.revised_by || !r.revised_at || !r.reason) errors.push('a revision records supersedes, revised_by, revised_at and reason')
    else {
      if (r.supersedes.policy_id !== policy.policy_id) errors.push('a revision supersedes a version of the same policy_id')
      if (r.supersedes.version === policy.version) errors.push('a revision must carry a new version')
      if (!Array.isArray(r.changes) || r.changes.length === 0) errors.push('a revision must record what changed')
    }
  }
  if (!Array.isArray(policy.tiers) || policy.tiers.length === 0) {
    errors.push('tiers must be a non-empty array, in ascending order of consequence')
    return { ok: false, errors }
  }
  const seen = new Set<string>()
  policy.tiers.forEach((t, i) => {
    const at = `tiers[${i}]${t && typeof t.tier === 'string' ? ` (${t.tier})` : ''}`
    if (!t || typeof t.tier !== 'string' || !t.tier) { errors.push(`${at}: tier name is required`); return }
    if (seen.has(t.tier)) errors.push(`${at}: duplicate tier name`)
    seen.add(t.tier)
    if (!(typeof t.confidence === 'number' && t.confidence >= 0.5 && t.confidence < 1)) errors.push(`${at}: confidence must be in [0.5, 1)`)
    for (const r of RUNGS) {
      const b = t[r]
      if (!b || !Number.isInteger(b.min_n) || b.min_n < 1) errors.push(`${at}.${r}: min_n must be an integer ≥ 1`)
      if (!b || !(typeof b.max_error === 'number' && b.max_error > 0 && b.max_error < 1)) errors.push(`${at}.${r}: max_error must be in (0, 1)`)
    }
    if (t.gate && t.advise && (t.gate.min_n < t.advise.min_n || t.gate.max_error > t.advise.max_error)) {
      errors.push(`${at}: the gate bar must be at least as strict as the advise bar (same metric, more authority)`)
    }
    if (t.max_rung !== undefined && !(RUNGS as readonly string[]).includes(t.max_rung)) errors.push(`${at}: max_rung must be advise, gate or autonomy`)
    const cap = RUNGS.includes(capOf(t) as Rung) ? capOf(t) : 'autonomy'
    if (t.sampling !== undefined) {
      const sp = t.sampling as unknown as Record<string, unknown>
      if (!isObjLike(sp)) errors.push(`${at}.sampling must be an object { period, review_rate?, surveillance_rate? }`)
      else {
        if (!isPeriodUnit(sp.period)) errors.push(`${at}.sampling.period must be day, month or quarter`)
        if (sp.review_rate !== undefined && !validRate(sp.review_rate)) errors.push(`${at}.sampling.review_rate must be in (0, 1]`)
        if (sp.surveillance_rate !== undefined && !validRate(sp.surveillance_rate)) errors.push(`${at}.sampling.surveillance_rate must be in (0, 1]`)
        if (sp.review_rate === undefined && sp.surveillance_rate === undefined) errors.push(`${at}.sampling draws nothing: declare review_rate and/or surveillance_rate`)
        if (sp.surveillance_rate !== undefined && cap !== 'autonomy') warnings.push(`${at}.sampling.surveillance_rate is never used: autonomy is not grantable at this tier (max_rung ${cap})`)
      }
    }
    if (t.evidence !== undefined) {
      const ev = t.evidence as unknown as Record<string, unknown>
      if (!isObjLike(ev)) errors.push(`${at}.evidence must be an object`)
      else {
        for (const k of ['random_selection', 'signed_reviews', 'segregation']) if (ev[k] !== undefined && typeof ev[k] !== 'boolean') errors.push(`${at}.evidence.${k} must be true or false`)
        const c = ev.canaries as Record<string, unknown> | undefined
        if (c !== undefined && (!isObjLike(c) || !Number.isInteger(c.min_n) || (c.min_n as number) < 1 || !(typeof c.min_catch_rate === 'number' && c.min_catch_rate > 0 && c.min_catch_rate < 1))) {
          errors.push(`${at}.evidence.canaries is { min_n: an integer ≥ 1, min_catch_rate: in (0, 1) }`)
        }
        if (ev.random_selection === true && t.sampling?.review_rate === undefined) errors.push(`${at}.evidence.random_selection needs sampling.review_rate: only drawn reviews count, so something must be drawn`)
      }
    }
    if (t.basis !== undefined && typeof t.basis !== 'string') errors.push(`${at}.basis must be words`)
    if (t.grant_signatures !== undefined) {
      if (!Number.isInteger(t.grant_signatures) || t.grant_signatures < 1 || t.grant_signatures > MAX_SIGNATURES) errors.push(`${at}.grant_signatures must be an integer from 1 to ${MAX_SIGNATURES} (the people who sign a GRANT of autonomy)`)
      else if (t.grant_signatures > 1 && cap !== 'autonomy') warnings.push(`${at}.grant_signatures is never used: it binds a GRANT of autonomy, which is not grantable at this tier (max_rung ${cap})`)
    }
    // The unreachable-bar check: a minimum below the zero-miss n is inert (it can never clear its own bar).
    const confOk = typeof t.confidence === 'number' && t.confidence >= 0.5 && t.confidence < 1
    if (methodOk && confOk && policy.sidedness !== 'two-sided') {
      for (const r of RUNGS) {
        const b = t[r]
        if (!b || !Number.isInteger(b.min_n) || !(b.max_error > 0 && b.max_error < 1) || levelRank(r) > levelRank(cap)) continue
        const z = zeroMissN(b.max_error, t.confidence, policy.method, 'one-sided')
        if (b.min_n < z) warnings.push(`${at}.${r}: min_n ${b.min_n} can never clear its own bar: with 0 misses, the ${describeBound(t.confidence, policy.method)} upper bound first reaches ${pct(b.max_error)} at n = ${z}. The real minimum is ${z}; declare it (the zero-miss n) so the stated burden is the true one`)
      }
      const c = t.evidence?.canaries
      if (c && Number.isInteger(c.min_n) && c.min_catch_rate > 0 && c.min_catch_rate < 1) {
        const z = zeroMissN(1 - c.min_catch_rate, t.confidence, policy.method, 'one-sided')
        if (c.min_n < z) warnings.push(`${at}.evidence.canaries: min_n ${c.min_n} can never show a ${pct(c.min_catch_rate)} catch rate: even with every canary caught, the ${describeBound(t.confidence, policy.method)} lower bound first reaches it at n = ${z}`)
      }
    }
  })
  for (let i = 1; i < policy.tiers.length; i++) {
    const lo = policy.tiers[i - 1]!, hi = policy.tiers[i]!
    if (!lo || !hi) continue
    if (hi.confidence < lo.confidence) errors.push(`burden decreases with consequence: ${hi.tier} confidence ${hi.confidence} < ${lo.tier} ${lo.confidence}`)
    const hiCap = capOf(hi), loCap = capOf(lo)
    for (const r of RUNGS) {
      if (!lo[r] || !hi[r]) continue
      if (levelRank(r) > levelRank(hiCap)) continue // not grantable at the higher tier: an infinite burden, never lower
      if (hi[r].min_n < lo[r].min_n) errors.push(`burden decreases with consequence: ${hi.tier}.${r} min_n ${hi[r].min_n} < ${lo.tier}.${r} ${lo[r].min_n}`)
      if (hi[r].max_error > lo[r].max_error) errors.push(`burden decreases with consequence: ${hi.tier}.${r} max_error ${hi[r].max_error} > ${lo.tier}.${r} ${lo[r].max_error}`)
    }
    if (levelRank(hiCap) > levelRank(loCap)) errors.push(`burden decreases with consequence: ${hi.tier} may be granted up to ${hiCap}, ${lo.tier} only up to ${loCap}`)
    const le = lo.evidence ?? {}, he = hi.evidence ?? {}
    for (const k of ['random_selection', 'signed_reviews', 'segregation'] as const) {
      if (le[k] === true && he[k] !== true) errors.push(`burden decreases with consequence: ${lo.tier} requires ${k} and ${hi.tier} does not`)
    }
    if (le.canaries && (!he.canaries || he.canaries.min_n < le.canaries.min_n || he.canaries.min_catch_rate < le.canaries.min_catch_rate)) {
      errors.push(`burden decreases with consequence: ${hi.tier}'s reviewer-attention requirement is weaker than ${lo.tier}'s`)
    }
    const ls = lo.sampling, hs = hi.sampling
    if (ls?.review_rate !== undefined && (hs?.review_rate === undefined || hs.review_rate < ls.review_rate)) errors.push(`burden decreases with consequence: ${hi.tier} draws fewer reviews than ${lo.tier}`)
    if (hiCap === 'autonomy' && loCap === 'autonomy' && (hi.grant_signatures ?? 1) < (lo.grant_signatures ?? 1)) {
      errors.push(`burden decreases with consequence: ${hi.tier} needs ${hi.grant_signatures ?? 1} signature(s) on a grant of autonomy, ${lo.tier} ${lo.grant_signatures ?? 1}`)
    }
    if (hiCap === 'autonomy' && loCap === 'autonomy' && ls?.surveillance_rate !== undefined && (hs?.surveillance_rate === undefined || hs.surveillance_rate < ls.surveillance_rate)) {
      errors.push(`burden decreases with consequence: ${hi.tier} surveils autonomy less than ${lo.tier}`)
    }
    if (ls && hs && isPeriodUnit(ls.period) && isPeriodUnit(hs.period) && PERIOD_LENGTH_RANK[hs.period] > PERIOD_LENGTH_RANK[ls.period]) {
      errors.push(`burden decreases with consequence: ${hi.tier} re-tests every ${hs.period}, less often than ${lo.tier}'s ${ls.period}`)
    }
  }
  return { ok: errors.length === 0, errors, ...(warnings.length ? { warnings } : {}) }
}

export function policyRef(policy: PromotionPolicy): PolicyRef {
  return { policy_id: policy.policy_id, version: policy.version, hash: hashOf(policy) }
}

function describeChanges(prior: PromotionPolicy, next: PromotionPolicy): string[] {
  const out: string[] = []
  if (prior.method !== next.method) out.push(`method ${prior.method} → ${next.method}`)
  if ((prior.sidedness ?? null) !== (next.sidedness ?? null)) out.push(`sidedness ${prior.sidedness ?? '(undeclared)'} → ${next.sidedness ?? '(undeclared)'}`)
  const before = new Map(prior.tiers.map(t => [t.tier, t]))
  const after = new Map(next.tiers.map(t => [t.tier, t]))
  for (const t of prior.tiers) if (!after.has(t.tier)) out.push(`tier '${t.tier}' removed`)
  for (const t of next.tiers) {
    const b = before.get(t.tier)
    if (!b) { out.push(`tier '${t.tier}' added`); continue }
    if (b.description !== t.description) out.push(`${t.tier}: description changed`)
    if (b.confidence !== t.confidence) out.push(`${t.tier}: confidence ${b.confidence} → ${t.confidence}`)
    for (const r of RUNGS) {
      if (b[r].min_n !== t[r].min_n) out.push(`${t.tier}.${r}: min_n ${b[r].min_n} → ${t[r].min_n}`)
      if (b[r].max_error !== t[r].max_error) out.push(`${t.tier}.${r}: max_error ${b[r].max_error} → ${t[r].max_error}`)
    }
    if ((b.max_rung ?? 'autonomy') !== (t.max_rung ?? 'autonomy')) out.push(`${t.tier}: max_rung ${b.max_rung ?? 'autonomy'} → ${t.max_rung ?? 'autonomy'}`)
    if (hashOf(b.sampling ?? null) !== hashOf(t.sampling ?? null)) out.push(`${t.tier}: sampling ${JSON.stringify(b.sampling ?? null)} → ${JSON.stringify(t.sampling ?? null)}`)
    if (hashOf(b.evidence ?? null) !== hashOf(t.evidence ?? null)) out.push(`${t.tier}: evidence ${JSON.stringify(b.evidence ?? null)} → ${JSON.stringify(t.evidence ?? null)}`)
    if ((b.grant_signatures ?? 1) !== (t.grant_signatures ?? 1)) out.push(`${t.tier}: grant_signatures ${b.grant_signatures ?? 1} → ${t.grant_signatures ?? 1}`)
    if ((b.basis ?? null) !== (t.basis ?? null)) out.push(`${t.tier}: basis changed`)
  }
  if (prior.tiers.map(t => t.tier).join('|') !== next.tiers.map(t => t.tier).join('|') && out.length === 0) out.push('tier order changed')
  return out
}

/**
 * A person adjusts the weighting at a review. Returns a NEW policy version that records the revision (who, when, why, what
 * changed, and the hash of the version it supersedes). The prior version is untouched: grants made under it still name
 * it, and are assessed under it until a person re-grants under the new one. Throws on a revision that changes nothing,
 * reuses the version, lacks a person or a reason, or lints dirty.
 */
export function revisePolicy(
  prior: PromotionPolicy,
  next: { version: string; method?: BoundMethod; sidedness?: Sidedness; tiers?: TierRequirements[] },
  by: { revised_by: string; revised_at: string; reason: string },
): PromotionPolicy {
  if (!by.revised_by || !by.revised_at || !by.reason) throw new Error('a policy revision is a person\'s recorded decision: it needs revised_by, revised_at and reason')
  if (!next.version || next.version === prior.version) throw new Error(`a revision must carry a new version (prior is ${prior.version})`)
  const candidate: PromotionPolicy = {
    policy_version: 'promotion-policy-v0',
    policy_id: prior.policy_id,
    version: next.version,
    method: next.method ?? prior.method,
    ...((next.sidedness ?? prior.sidedness) !== undefined ? { sidedness: next.sidedness ?? prior.sidedness } : {}),
    tiers: structuredClone(next.tiers ?? prior.tiers),
  }
  const changes = describeChanges(prior, candidate)
  if (changes.length === 0) throw new Error('a revision must change something (method, a tier, a bar, a minimum or a confidence)')
  const revised: PromotionPolicy = {
    ...candidate,
    revision: { supersedes: policyRef(prior), revised_by: by.revised_by, revised_at: by.revised_at, reason: by.reason, changes },
  }
  const lint = lintPolicy(revised)
  if (!lint.ok) throw new Error(`the revised policy does not lint: ${lint.errors.join('; ')}`)
  return revised
}

// ── the assessment ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A person's grant: the rung, who set it, when, and the settings (policy version, consequence tier) it was made under. */
export interface Grant {
  level: VoiceLevel
  signer_id: string
  signed_at: string
  policy: PolicyRef
  consequence_tier: string
  note?: string
}

export interface WorkflowDeclaration {
  workflow_id: string
  /** The declared consequence tier (a name in the policy). The burden of proof follows it. */
  consequence_tier: string
  /** The rung a person granted. The effective rung is ALWAYS this; only a person changes it. */
  granted: VoiceLevel
  /** The bounds autonomy acts within, in words (e.g. "PO-matched invoices under $5,000"). Quoted in proposals. */
  bounds?: string
  /** The person's grant record. When present, the assessment must run under exactly the settings it names. */
  grant?: Grant
}

export interface RungAssessment {
  rung: Rung
  metric: RungMetric
  /** Reviewed items in the denominator. */
  n: number
  /** Overturned among them. */
  errors: number
  /** errors / n, or null when n = 0. */
  point: number | null
  lower: number
  upper: number
  confidence: number
  method: BoundMethod
  /** Every bound says which it is (v0: always one-sided). */
  sidedness: Sidedness
  bar: RungBar
  cleared: boolean
  reason: string
  /** The overturned verdict ids behind `errors` (the counter-cases), and any untested drawn items counted as deviations. */
  counter_cases: string[]
  /** Drawn items never reviewed by their deadline, counted as deviations (AS 2315 .40). Present only when any. */
  untested?: string[]
}

/** A case behind a demotion proposal, listed so a person can dispute it. */
export interface FailingCase {
  verdict_id: string
  /** The rung whose bar it counts against. */
  rung: Rung
  /** A PASS a person overturned (a miss) or a FAIL a person overturned (a false alarm). */
  outcome: 'PASS' | 'FAIL'
  /** The dispute path for this single case. */
  dispute: string
  /** Why it counts, when it is not a plain overturned verdict (an untested drawn item; a post-grant surveillance finding). */
  why?: string
}

interface ProposalBody {
  status: 'PROPOSED'
  requires_human_signature: true
  /** Deterministic: first 32 hex of sha256 over the proposal body. */
  proposal_id: string
  workflow_id: string
  consequence_tier: string
  bounds?: string
  from: VoiceLevel
  to: VoiceLevel
  /** What the evidence supports. One rung is proposed at a time; a person may decide a larger step. */
  earned: VoiceLevel
  /** The evidence for every rung up to the higher of from/to. */
  rungs: RungAssessment[]
  policy: PolicyRef
  calibration_hash: string
}

export interface PromotionProposal extends ProposalBody {
  kind: 'PROMOTION_PROPOSAL'
  urgent: false
}

export interface DemotionProposal extends ProposalBody {
  kind: 'DEMOTION_PROPOSAL'
  /**
   * True exactly when `basis` is 'failure': evidence OF failure is urgent. An unevidenced demotion is a standing notice, never
   * urgent (DECISION D-UNEVIDENCED; E4 flipped 2026-09-28 once the report, CLI, surfaces and opinion all read `basis`).
   */
  urgent: boolean
  /**
   * 'failure'      evidence OF failure: a failing case (an overturned verdict against the grant, an untested drawn item, a
   *                post-grant surveillance finding), or an integrity or reviewer-attention failure. Urgent.
   * 'unevidenced'  an ABSENCE of evidence: granted above what the book supports, and nothing has gone wrong (too few reviews,
   *                evidence voided by a version change, requirements not yet met). A standing notice, not an alarm: the
   *                setting stays as a person set it.
   */
  basis: 'failure' | 'unevidenced'
  /** Why the granted rung is no longer supported. */
  reasons: string[]
  /** The overturned verdicts that count against the unsupported rungs, each with its dispute path. */
  failing_cases: FailingCase[]
}

export type VoiceProposal = PromotionProposal | DemotionProposal

export interface VoiceAssessment {
  assessment_version: 'voice-v0'
  workflow_id: string
  consequence_tier: string
  bounds?: string
  /** What a person granted. */
  granted: VoiceLevel
  /** The effective rung. ALWAYS equal to `granted`: only a person changes it. */
  level: VoiceLevel
  /** The highest rung the evidence supports (cumulative). 'record' when blocked. */
  earned: VoiceLevel
  grant?: Grant
  /** How an action is handled at the effective rung: FAIL/ABSTAIN surfaced or held, where a PASS goes. Every FAIL disputable. */
  handling: ActionHandling
  rungs: RungAssessment[]
  /** Evidence-level problems (mixed versions, an altered calibration): the evidence then supports nothing. */
  blockers: string[]
  /** A promotion (evidence supports more) or an urgent demotion (evidence no longer supports the grant). Never applied here. */
  proposal?: VoiceProposal
  policy: PolicyRef
  calibration_hash: string
  /** Present when the rung was read from the book of record (a BookDeclaration): what it was read from, and what it cites. */
  book?: BookCitation
  /**
   * D-NO-FLIPFLOP: present when the grant in force is a person's step down from a rung after a failing case against it. A
   * return to that rung is argued from the evidence recorded SINCE the step down, alone; the pooled record is still shown
   * (`earned`, `rungs`) but cannot carry the return by itself.
   */
  fresh_window?: FreshWindow
  assessment_hash: string
}

/**
 * D-NO-FLIPFLOP (design ruling 2026-09-28, forkable): after a person steps a workflow down from rung R on a failure, a
 * proposal to return to R needs evidence gathered after that decision. The window is this workflow's verdicts recorded after
 * the step-down GRANT; the rung a return proposes must clear its own bar (min_n counted from the step down) on the window alone.
 */
export interface FreshWindow {
  /** The rung the person stepped down from. */
  from: VoiceLevel
  /** The step-down GRANT: the window is what was recorded after it. */
  since: { decision_id: string; seq: number }
  /** This workflow's verdicts recorded since the step down. */
  records: number
  /** The rung a return proposes, assessed on the window alone. Present when the pooled record would propose it. */
  rung?: RungAssessment
}

// ── the book of record: the rung read from a person's signed decisions ─────────────────────────────────────────────────

/** A chain export: events + their verbatim payloads (ledger.chainJSONL() parsed, or a file ledger's contents). */
export interface ChainExport { events: LedgerEvent[]; payloads: unknown[] }

/**
 * Read the rung from the book of record instead of a flag. The GRANT in force for the workflow sets the rung, the consequence
 * tier, the bounds and the policy version. With no GRANT on the book the rung is record, and `consequence_tier` names the
 * tier the evidence is measured against. A `granted` flag, if one is passed too, must agree with the book or is refused.
 */
export interface BookDeclaration {
  workflow_id: string
  book: Ledger | ChainExport
  /** Only when nothing is granted yet. When a grant is in force its tier governs, and a different one here is refused. */
  consequence_tier?: string
  /** Anchor signers to people on read (signer_id → public key). A decision signed by another key makes the book refuse. */
  trusted_keys?: TrustedKeys
  /** The registry's root key(s): the key registry on the book anchors every signer once it is in force (ledger/registry.ts). */
  root_keys?: RootKeys
}

export interface DeclineCitation {
  decision_id: string
  seq: number
  entry_hash: string
  signer_id: string
  signed_at: string
  reason: string
  proposal_kind: 'PROMOTION_PROPOSAL' | 'DEMOTION_PROPOSAL'
  /** The proposal the person declined (its id at the time). */
  declined_proposal_id: string
  /** Why it stands, or why it lapsed. */
  why: string
}

/** A person's decline that still stands: the proposal the evidence raises now is held back, not re-raised. */
export interface StandingDecline extends DeclineCitation {
  /** The proposal the evidence raises now, which the decline holds back. */
  suppressed_proposal_id: string
  /** What would re-raise it. */
  re_raise_when: string
}

export interface BookCitation {
  /** The head and length of the verified chain the rung was read from. */
  head: string
  length: number
  /**
   * The GRANT in force (the decision an opinion's ruling would amend). Absent: nothing granted, the rung is record.
   * `cosigned_by`: D-DUAL, the co-signatures that put it in force (present only when any).
   */
  grant?: { decision_id: string; seq: number; entry_hash: string; cosigned_by?: { decision_id: string; seq: number; signer_id: string }[] }
  /** A person's standing "no" to the proposal the evidence would raise. Present only when it still stands. */
  declined?: StandingDecline
  /** A person's "no" that no longer stands because the evidence changed; the proposal is raised again. */
  decline_lapsed?: DeclineCitation
  /** Later versions of the assessed policy recorded on the book. The grant stands under its own version until a person re-grants. */
  superseded_by?: { policy: PolicyRef; decision_id: string; seq: number; lints: boolean }[]
  /** Signers whose key is not anchored to a person (no trusted_keys supplied). Their decisions are signed, not identified. */
  unanchored_signers?: string[]
  /**
   * D-ANCHOR: the unanchored decisions on the book for this workflow (and revisions of this policy), each with its notice.
   * They are on the book and have NO effect: the rung is the last anchored grant, and an unanchored decline holds nothing
   * back. Present only when any.
   */
  no_effect?: NoEffect[]
  /**
   * The evidence audit (surveillance/evidence.ts), present when the tier declares sampling or evidence requirements, or the
   * book carries canaries for the workflow: what was drawn, what counts, what was set aside and why, surveillance findings.
   */
  evidence?: EvidenceCitation
}

export function isBookDeclaration(d: WorkflowDeclaration | BookDeclaration): d is BookDeclaration {
  return !!d && typeof d === 'object' && (d as { book?: unknown }).book !== undefined
}

export const pct = (x: number): string => `${Number((x * 100).toPrecision(3))}%`

function rungEvidence(cal: WorkflowCalibration, rung: Rung, adj?: EvidenceAdjustment): { n: number; errors: number; counter: string[]; noun: string; untested: string[] } {
  const passMetric = RUNG_METRIC[rung] === 'false_pass_rate'
  const reviewed = passMetric ? cal.evidence.reviewed_pass : cal.evidence.reviewed_fail
  const wrong = passMetric ? cal.evidence.false_pass : cal.evidence.false_fail
  const noun = passMetric ? 'reviewed PASS verdicts' : 'reviewed FAIL verdicts'
  if (!adj) return { n: reviewed.length, errors: wrong.length, counter: wrong, noun, untested: [] }
  const out = new Set(adj.set_aside.map(x => x.verdict_id))
  const held = new Set(adj.held)
  const counted = reviewed.filter(id => !out.has(id) && !held.has(id))
  const misses = wrong.filter(id => !out.has(id))
  const untested = passMetric ? adj.untested.PASS : adj.untested.FAIL
  return { n: counted.length + untested.length, errors: misses.length + untested.length, counter: [...misses, ...untested].sort(), noun, untested: [...untested] }
}

/**
 * Assess one rung against a tier's bar. Exported for the opinion renderer's what-if arithmetic. `sidedness` is always
 * one-sided in v0 (said explicitly in the result); `adj` is the book's evidence audit (surveillance/evidence.ts), if any.
 */
export function assessRung(rung: Rung, cal: WorkflowCalibration, tier: TierRequirements, method: BoundMethod, sidedness: Sidedness = 'one-sided', adj?: EvidenceAdjustment): RungAssessment {
  const { n, errors, counter, noun, untested } = rungEvidence(cal, rung, adj)
  const bar = tier[rung]
  const { lower, upper } = rateInterval(errors, n, tier.confidence, method, sidedness)
  const bound = `${pct(tier.confidence)} ${method} upper bound (${sidedness}) ${pct(upper)} (${errors}/${n})`
  const cap = tier.max_rung ?? 'autonomy'
  let cleared = false, reason: string
  if (levelRank(rung) > levelRank(cap)) reason = `not grantable at tier '${tier.tier}': its highest grantable rung is ${cap}`
  else if (n < bar.min_n) reason = `${n} ${noun} < minimum ${bar.min_n}`
  else if (upper > bar.max_error) reason = `${bound} > bar ${pct(bar.max_error)}`
  else { cleared = true; reason = `${n} ${noun} ≥ ${bar.min_n}; ${bound} ≤ bar ${pct(bar.max_error)}` }
  return {
    rung, metric: RUNG_METRIC[rung], n, errors, point: n === 0 ? null : errors / n, lower, upper, confidence: tier.confidence, method, sidedness,
    bar: { ...bar }, cleared, reason, counter_cases: [...counter], ...(untested.length ? { untested } : {}),
  }
}

/** Does this calibration still match its own hash? */
export function calibrationIntact(cal: WorkflowCalibration): boolean {
  const { calibration_hash, ...body } = cal
  return hashOf(body) === calibration_hash
}

/**
 * The workflow's voice: the effective rung (always what a person granted), what the evidence supports, and a proposal
 * when the two differ: a PROMOTION PROPOSAL one rung up, or an urgent DEMOTION PROPOSAL one rung down with the failing
 * cases listed for dispute. It never changes the rung itself. Pure and deterministic; the policy is read, never written.
 * Throws on an invalid policy, an undeclared tier, a mismatched workflow, or a grant made under other settings.
 *
 * Two ways to say what a person granted:
 *   - a BookDeclaration ({ workflow_id, book }): the rung is READ FROM THE BOOK OF RECORD, the GRANT in force on a verified
 *     chain of signed decisions. A standing DECLINE holds its proposal back; the assessment cites the grant (`book`). A book
 *     that does not verify is refused (a tampered or mis-signed book grants nothing).
 *   - a WorkflowDeclaration with `granted` (the flag path, unchanged): the caller states the rung.
 */
export function assessVoice(calibration: WorkflowCalibration, declaration: WorkflowDeclaration | BookDeclaration, policy: PromotionPolicy): VoiceAssessment {
  if (isBookDeclaration(declaration)) return assessFromBook(calibration, declaration, policy)
  const out = assessCore(calibration, declaration, policy)
  return { ...out, assessment_hash: hashOf(out) }
}

function readBook(book: Ledger | ChainExport, trusted_keys: TrustedKeys | undefined, root_keys?: RootKeys): DecisionBook {
  const opts = { ...(trusted_keys ? { trusted_keys } : {}), ...(root_keys ? { root_keys } : {}) }
  if (book && typeof (book as Ledger).decisionBook === 'function') return (book as Ledger).decisionBook(opts)
  const c = book as ChainExport
  if (!c || !Array.isArray(c.events) || !Array.isArray(c.payloads)) throw new Error('book must be a Ledger or a chain export { events, payloads }')
  return readDecisionBook(c.events, c.payloads, opts)
}

function assessFromBook(calibration: WorkflowCalibration, bd: BookDeclaration, policy: PromotionPolicy): VoiceAssessment {
  if (typeof bd.workflow_id !== 'string' || !bd.workflow_id) throw new Error('a book declaration names its workflow_id')
  const book = readBook(bd.book, bd.trusted_keys, bd.root_keys)
  if (!book.ok) {
    const at = book.check.brokenAt !== undefined ? ` at event ${book.check.brokenAt}` : ''
    throw new Error(`the book of record does not verify${at} (${book.check.reason ?? 'unknown'}): a tampered, mis-signed or unanchored book grants nothing, and no rung can be read from it`)
  }
  const wf = bd.workflow_id
  const flag = (bd as { granted?: unknown }).granted
  // D-ANCHOR: the grant in force is the latest ANCHORED one; an unanchored decision is on the book, said, and of no effect.
  // D-DUAL: and fully signed, under this policy's tier when the grant was made under it; a pending one is said too.
  const reading = { policies: [policy], governing_policy: policy } // D-GOVERNING-POLICY: the declared policy judges every grant
  const g = grantInForce(book.decisions, wf, reading)
  const inert = noEffect(book, { workflow_id: wf, policy_id: policy.policy_id, ...reading })
  const inertGrants = inert.filter(n => n.kind === 'GRANT')
  const unanchoredWhy = inertGrants.length ? ` ${inertGrants.map(n => n.notice).join('; ')}.` : ''
  const noGrant = inertGrants.some(n => n.pending) ? 'in-force ' : inertGrants.length ? 'anchored ' : ''
  let decl: WorkflowDeclaration
  if (g) {
    const gd = g.signed.decision
    if (bd.consequence_tier !== undefined && bd.consequence_tier !== gd.consequence_tier) {
      throw new Error(`the grant in force (${g.decision_id}, seq ${g.seq}) was made at consequence tier '${gd.consequence_tier}', not '${bd.consequence_tier}'. Settings are fixed at grant time; re-declaring the tier is a person's re-grant`)
    }
    if (flag !== undefined && flag !== gd.level) {
      throw new Error(`the rung is read from the book of record: the grant in force (${g.decision_id}, seq ${g.seq}) is ${gd.level}, not ${String(flag)}. A flag cannot override a person's signed grant`)
    }
    decl = {
      workflow_id: wf,
      consequence_tier: gd.consequence_tier,
      granted: gd.level,
      ...(gd.bounds !== undefined ? { bounds: gd.bounds } : {}),
      grant: { level: gd.level, signer_id: gd.signer_id, signed_at: gd.signed_at, policy: { ...gd.policy }, consequence_tier: gd.consequence_tier, ...(gd.note !== undefined ? { note: gd.note } : {}) },
    }
  } else {
    if (bd.consequence_tier === undefined) {
      throw new Error(`no ${noGrant}GRANT for workflow ${wf} is on the book, and no consequence_tier was declared: nothing is granted (the rung is record), but the burden of proof needs a declared tier to measure against.${unanchoredWhy}`)
    }
    if (flag !== undefined && flag !== 'record') {
      throw new Error(`the rung is read from the book of record: no ${noGrant}GRANT for workflow ${wf} is on it, so the rung is record, not ${String(flag)}. Only a person's signed grant moves it.${unanchoredWhy}`)
    }
    decl = { workflow_id: wf, consequence_tier: bd.consequence_tier, granted: 'record' }
  }

  // The evidence audit: only when the tier declares sampling / evidence requirements or the book carries canaries for this
  // workflow. Otherwise the assessment is exactly the pre-audit one.
  const lint = lintPolicy(policy)
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join('; ')}`)
  const tierReq = policy.tiers.find(t => t.tier === decl.consequence_tier)
  let audit: { adjustment: EvidenceAdjustment; citation: EvidenceCitation } | undefined
  const chainNow = (): ChainExport => (typeof (bd.book as Ledger).snapshot === 'function' ? (bd.book as Ledger).snapshot() : (bd.book as ChainExport)) // P-B: by reference
  const fresh = g && calibration.workflow_id === wf ? stepDownWindow(g, book, chainNow, calibration, reading) : undefined
  if (tierReq && calibration.workflow_id === wf && auditApplies(tierReq, book, wf)) {
    const chain = chainNow()
    audit = auditEvidence({
      workflow_id: wf, events: chain.events, payloads: chain.payloads, book, tier: tierReq, method: policy.method,
      sidedness: policy.sidedness ?? 'one-sided', calibration, ...(g ? { grant: g } : {}), policy,
    })
  }
  const out = assessCore(calibration, decl, policy, audit?.adjustment, fresh)
  const citation: BookCitation = { head: book.check.head, length: book.check.length }
  if (g) {
    const cosigned = grantSignatures(g, book.decisions, reading).cosigns
    citation.grant = { decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash, ...(cosigned.length ? { cosigned_by: cosigned.map(c => ({ decision_id: c.decision_id, seq: c.seq, signer_id: c.signer_id })) } : {}) }
  }

  if (out.proposal) {
    const p = out.proposal
    const binding = declinesFor(book.decisions, wf).filter(e => declineBinds(e.signed.decision, p, g?.decision_id))
    const last = binding[binding.length - 1]
    if (last) {
      const d = last.signed.decision
      const standing = declineStanding(d, p, out.blockers)
      const cite: DeclineCitation = {
        decision_id: last.decision_id, seq: last.seq, entry_hash: last.entry_hash, signer_id: d.signer_id, signed_at: d.signed_at,
        reason: d.reason, proposal_kind: d.proposal_kind, declined_proposal_id: d.proposal_id, why: standing.why,
      }
      if (standing.stands) {
        citation.declined = { ...cite, suppressed_proposal_id: p.proposal_id, re_raise_when: standing.re_raise_when }
        delete out.proposal
      } else {
        citation.decline_lapsed = cite
      }
    }
  }

  const later = revisionsOf(book.decisions, policy.policy_id).filter(e => e.signed.decision.supersedes.hash === out.policy.hash)
  if (later.length) {
    citation.superseded_by = later.map(e => ({ policy: { ...e.signed.decision.policy }, decision_id: e.decision_id, seq: e.seq, lints: lintPolicy(e.signed.decision.policy_body).ok }))
  }
  if (book.unanchored.length) citation.unanchored_signers = [...book.unanchored]
  if (inert.length) citation.no_effect = inert
  if (audit) citation.evidence = audit.citation

  const final: Omit<VoiceAssessment, 'assessment_hash'> = { ...out, book: citation }
  return { ...final, assessment_hash: hashOf(final) }
}

/** Does a person's decline answer this proposal (same workflow, direction, rungs, tier, policy, and grant in force)? */
function declineBinds(d: DeclineDecision, p: VoiceProposal, grantId: string | undefined): boolean {
  return d.workflow_id === p.workflow_id && d.proposal_kind === p.kind && d.from === p.from && d.to === p.to
    && d.consequence_tier === p.consequence_tier && d.policy.hash === p.policy.hash && (d.under_grant ?? null) === (grantId ?? null)
}

/**
 * Does a person's decline still stand against the proposal the evidence raises now? "Until the evidence changes", made
 * precise and direction-aware (DECISION 2026-09-28; the fork point is here):
 *   DEMOTION   stands until the case AGAINST the grant grows: a failing case the person did not see (a new overturned verdict
 *              counting against the granted rung) or a new evidence blocker. Clean reviews never re-raise it; the person
 *              already weighed every case listed, and re-raising on the same cases is the nag the ruling forbids.
 *   PROMOTION  stands until a fresh sample accrues on the proposed rung's metric: at least that rung's own min_n reviewed
 *              items since the decline (the policy's own number, not a new knob).
 * Pure: the decline, the proposal and the current blockers in; the same answer out.
 */
export function declineStanding(d: DeclineDecision, p: VoiceProposal, blockers: readonly string[]): { stands: boolean; why: string; re_raise_when: string } {
  if (p.kind === 'DEMOTION_PROPOSAL') {
    const seenCases = new Set(d.seen.failing_cases)
    const seenBlockers = new Set(d.seen.blockers)
    const newCases = p.failing_cases.map(c => c.verdict_id).filter(id => !seenCases.has(id)).sort()
    const newBlockers = blockers.filter(b => !seenBlockers.has(b))
    const re_raise_when = 'a new failing case (a verdict a person overturns that counts against the granted rung) or a new evidence blocker. Clean reviews never re-raise it; a person may re-grant at any time'
    if (newCases.length || newBlockers.length) {
      const parts = [
        ...(newCases.length ? [`${newCases.length} new failing case(s) (${newCases.join(', ')})`] : []),
        ...(newBlockers.length ? [`${newBlockers.length} new blocker(s)`] : []),
      ]
      return { stands: false, why: `the evidence against the grant changed since the decline: ${parts.join('; ')}`, re_raise_when }
    }
    return { stands: true, why: `no new failing case or blocker since ${d.signer_id} declined it at ${d.signed_at} (${d.seen.failing_cases.length} failing case(s) seen)`, re_raise_when }
  }
  const target = p.to as Rung
  const now = p.rungs.find(r => r.rung === target)
  const seenN = d.seen.rungs.find(r => r.rung === target)?.n ?? 0
  const min = now?.bar.min_n ?? 1
  const fresh = Math.max(0, (now?.n ?? 0) - seenN)
  const noun = RUNG_METRIC[target] === 'false_pass_rate' ? 'reviewed PASS verdict(s)' : 'reviewed FAIL verdict(s)'
  if (fresh >= min) {
    return { stands: false, why: `${fresh} fresh ${noun} since the decline ≥ ${target}'s min_n ${min}: a fresh sample the size the policy itself requires`, re_raise_when: `already met (${fresh} ≥ ${min})` }
  }
  return {
    stands: true,
    why: `${fresh} of ${min} fresh ${noun} since ${d.signer_id} declined it at ${d.signed_at}`,
    re_raise_when: `${min - fresh} more ${noun}: a fresh sample of ${target}'s own min_n (${min}) since the decline`,
  }
}

/**
 * A person's "no" to the proposal on an assessment, as a DECLINE decision (sign it with signDecision, append it with
 * ledger.decide). Records the evidence the person saw, so the proposal is held back until that evidence changes. When the
 * assessment was read from the book, the decline names the grant in force; the ledger's door refuses a decline that does not.
 */
export function declineDecision(a: VoiceAssessment, by: { signer_id: string; signed_at: string; reason: string; note?: string }): DeclineDecision {
  const p = a.proposal
  if (!p) throw new Error('there is no proposal on this assessment to decline')
  const d: DeclineDecision = {
    decision_version: 'decision-v0',
    kind: 'DECLINE',
    workflow_id: p.workflow_id,
    proposal_id: p.proposal_id,
    proposal_kind: p.kind,
    from: p.from,
    to: p.to,
    consequence_tier: p.consequence_tier,
    policy: { ...p.policy },
    ...(a.book?.grant ? { under_grant: a.book.grant.decision_id } : {}),
    reason: by.reason,
    seen: {
      calibration_hash: p.calibration_hash,
      rungs: p.rungs.map(r => ({ rung: r.rung, n: r.n, errors: r.errors })),
      failing_cases: p.kind === 'DEMOTION_PROPOSAL' ? p.failing_cases.map(c => c.verdict_id).sort() : [],
      blockers: [...a.blockers].sort(),
    },
    signer_id: by.signer_id,
    signed_at: by.signed_at,
    ...(by.note !== undefined ? { note: by.note } : {}),
  }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/**
 * A person's "yes" to a proposal, as a GRANT of the proposed rung under the proposal's own settings (answers = its id). With
 * `policy` (the proposal's own, by hash), the grant carries its tier's signature count (D-DUAL), as grantUnderPolicy does.
 */
export function grantForProposal(p: VoiceProposal, by: { signer_id: string; signed_at: string; bounds?: string; note?: string }, policy?: PromotionPolicy): GrantDecision {
  const bounds = by.bounds ?? p.bounds
  if (policy && hashOf(policy) !== p.policy.hash) throw new DecisionRefused(`the proposal was made under ${p.policy.policy_id}@${p.policy.version}, not ${policy.policy_id}@${policy.version}`)
  const signatures = policy ? tierSignatures(policy, p.consequence_tier, p.to) : 1
  return makeGrant({
    workflow_id: p.workflow_id, level: p.to, consequence_tier: p.consequence_tier, policy: { ...p.policy },
    ...(bounds !== undefined ? { bounds } : {}), answers: p.proposal_id, signer_id: by.signer_id, signed_at: by.signed_at,
    ...(by.note !== undefined ? { note: by.note } : {}), ...(signatures > 1 ? { signatures } : {}),
  })
}

/** How many people a tier requires on a GRANT of `level` (D-DUAL): its grant_signatures for autonomy, one otherwise. */
export function tierSignatures(policy: PromotionPolicy, consequence_tier: string, level: VoiceLevel): number {
  if (level !== 'autonomy') return 1
  return policy.tiers.find(t => t.tier === consequence_tier)?.grant_signatures ?? 1
}

/** revisePolicy's record as a POLICY_REVISION decision (signed by the reviser). Refuses a policy that is not a clean revision. */
export function policyRevisionDecision(revised: PromotionPolicy): PolicyRevisionDecision {
  if (!revised.revision) throw new Error('not a revision: build it with revisePolicy (a person\'s recorded, versioned change)')
  const lint = lintPolicy(revised)
  if (!lint.ok) throw new Error(`the revised policy does not lint: ${lint.errors.join('; ')}`)
  const r = revised.revision
  const d: PolicyRevisionDecision = {
    decision_version: 'decision-v0',
    kind: 'POLICY_REVISION',
    policy: policyRef(revised),
    supersedes: { ...r.supersedes },
    reason: r.reason,
    changes: [...r.changes],
    policy_body: structuredClone(revised),
    signer_id: r.revised_by,
    signed_at: r.revised_at,
  }
  const problem = decisionProblem(d)
  if (problem) throw new DecisionRefused(problem)
  return d
}

/**
 * The whole loop from one ledger: calibrate the workflow from the ledger's own records, read the rung from its own book of
 * decisions, assess. `consequence_tier` is needed only while nothing is granted.
 */
export function assessVoiceFromLedger(
  ledger: Ledger,
  workflow_id: string,
  policy: PromotionPolicy,
  opts: { consequence_tier?: string; trusted_keys?: TrustedKeys; root_keys?: RootKeys; calibration?: WorkflowCalibrationOptions } = {},
): VoiceAssessment {
  const cal = workflowCalibration(ledger.all(), workflow_id, opts.calibration)
  return assessVoice(cal, {
    workflow_id,
    book: ledger,
    ...(opts.consequence_tier !== undefined ? { consequence_tier: opts.consequence_tier } : {}),
    ...(opts.trusted_keys ? { trusted_keys: opts.trusted_keys } : {}),
    ...(opts.root_keys ? { root_keys: opts.root_keys } : {}),
  }, policy)
}

/**
 * A GRANT made under a policy, refused the same way on every surface (CLI, MCP, HTTP). The policy lints, the
 * tier is declared, the rung is grantable at that tier (max_rung), then makeGrant (well-formed, bounds on autonomy). The
 * grant names the policy by hash: the settings are fixed from here.
 */
export function grantUnderPolicy(policy: PromotionPolicy, input: Omit<GrantDecision, 'decision_version' | 'kind' | 'policy'>): GrantDecision {
  const lint = lintPolicy(policy)
  if (!lint.ok) throw new DecisionRefused(`the policy does not lint: ${lint.errors.join('; ')}`)
  const tier = policy.tiers.find(t => t.tier === input.consequence_tier)
  if (!tier) throw new DecisionRefused(`consequence tier ${JSON.stringify(input.consequence_tier)} is not declared in policy ${policy.policy_id}@${policy.version} (tiers: ${policy.tiers.map(t => t.tier).join(', ')})`)
  const cap = tier.max_rung ?? 'autonomy'
  if (levelRank(input.level) > levelRank(cap)) {
    throw new DecisionRefused(`tier '${tier.tier}' caps the grantable rung at ${cap}: ${input.level} is not grantable at this tier${tier.basis ? ` (${tier.basis.split('. ')[0]})` : ''}`)
  }
  // D-DUAL: the tier's signature count is written into the grant; a grant may ask for more people, never fewer.
  const needed = tierSignatures(policy, tier.tier, input.level)
  if (input.signatures !== undefined && input.signatures < needed) {
    throw new DecisionRefused(`tier '${tier.tier}' requires ${needed} signatures on a GRANT of ${input.level} (dual authorization); this grant states ${input.signatures}`)
  }
  const signatures = Math.max(needed, input.signatures ?? 1)
  const { signatures: _stated, ...rest } = input
  return makeGrant({ ...rest, policy: policyRef(policy), ...(signatures > 1 ? { signatures } : {}) })
}

/**
 * A person's "no", checked against the book as it stands. Re-derives the assessment from the ledger itself and
 * refuses unless the live proposal is exactly the one named (an assessment passed around can be recomputed by a forger; the
 * book cannot). Returns the DECLINE to sign and append.
 */
export function declineOnBook(
  ledger: Ledger,
  workflow_id: string,
  policy: PromotionPolicy,
  proposal_id: string,
  by: { signer_id: string; signed_at: string; reason: string; note?: string },
  opts: { consequence_tier?: string; trusted_keys?: TrustedKeys; root_keys?: RootKeys; calibration?: WorkflowCalibrationOptions } = {},
): DeclineDecision {
  const a = assessVoiceFromLedger(ledger, workflow_id, policy, opts)
  if (!a.proposal) throw new DecisionRefused(`there is no open proposal on ${workflow_id} as the book stands (head ${a.book?.head.slice(0, 12)}…): nothing to decline`)
  if (a.proposal.proposal_id !== proposal_id) {
    throw new DecisionRefused(`the book's open proposal on ${workflow_id} is ${a.proposal.proposal_id}, not ${proposal_id}: the evidence has moved since it was read. Read the book again and decide on what it shows now`)
  }
  return declineDecision(a, by)
}

/** The assessment itself, unhashed (shared by the flag path and the book path). */
function assessCore(calibration: WorkflowCalibration, declaration: WorkflowDeclaration, policy: PromotionPolicy, adj?: EvidenceAdjustment, fresh?: StepDown): Omit<VoiceAssessment, 'assessment_hash'> {
  const lint = lintPolicy(policy)
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join('; ')}`)
  if (!VOICE_LADDER.includes(declaration.granted)) throw new Error(`granted must be one of ${VOICE_LADDER.join(', ')}`)
  if (declaration.workflow_id !== calibration.workflow_id) throw new Error(`the declaration is for ${declaration.workflow_id} but the calibration is for ${calibration.workflow_id}`)
  const tier = policy.tiers.find(t => t.tier === declaration.consequence_tier)
  if (!tier) throw new Error(`consequence tier ${JSON.stringify(declaration.consequence_tier)} is not declared in policy ${policy.policy_id}@${policy.version} (tiers: ${policy.tiers.map(t => t.tier).join(', ')})`)
  const cap = tier.max_rung ?? 'autonomy'
  if (levelRank(declaration.granted) > levelRank(cap)) {
    throw new Error(`tier '${tier.tier}' of ${policy.policy_id}@${policy.version} caps the grantable rung at ${cap}: ${declaration.granted} is not grantable at this tier. A person re-grants at ${cap} or below`)
  }
  const pref = policyRef(policy)
  const g = declaration.grant
  if (g !== undefined) {
    if (!g.signer_id || !g.signed_at) throw new Error('a grant is a person\'s decision: it needs signer_id and signed_at')
    if (g.level !== declaration.granted) throw new Error(`the grant is for ${g.level} but the declaration says ${declaration.granted}`)
    if (g.policy.hash !== pref.hash) {
      throw new Error(`the grant was made under policy ${g.policy.policy_id}@${g.policy.version} (${g.policy.hash.slice(0, 12)}…), not ${pref.policy_id}@${pref.version} (${pref.hash.slice(0, 12)}…). Settings are fixed at grant time: assess under the grant's policy, or have a person revise the policy (revisePolicy) and re-grant under it`)
    }
    if (g.consequence_tier !== declaration.consequence_tier) {
      throw new Error(`the grant was made at consequence tier '${g.consequence_tier}', not '${declaration.consequence_tier}'. Settings are fixed at grant time; re-declaring the tier is a person's re-grant`)
    }
  }

  const blockers: string[] = []
  const failureBlockers: string[] = []
  if (!calibrationIntact(calibration)) {
    const b = 'the calibration does not match its own hash (altered after it was computed); its evidence supports nothing'
    blockers.push(b)
    failureBlockers.push(b)
  }
  if (calibration.versions.length > 1) {
    blockers.push(`the evidence spans ${calibration.versions.length} ruleset/engine versions (${calibration.versions.join('; ')}); a version change changes behaviour, so the old record no longer describes it (the declared_accuracy precedent). Start a fresh record per version`)
  }

  if (adj) { blockers.push(...adj.blockers); failureBlockers.push(...adj.failure_blockers) }
  const rungs = RUNGS.map(r => assessRung(r, calibration, tier, policy.method, policy.sidedness ?? 'one-sided', adj))
  let earned: VoiceLevel = 'record'
  if (blockers.length === 0) {
    for (const r of rungs) {
      if (!r.cleared) break
      earned = r.rung
    }
  }
  const gi = levelRank(declaration.granted), ei = levelRank(earned)

  const out: Omit<VoiceAssessment, 'assessment_hash'> = {
    assessment_version: 'voice-v0',
    workflow_id: calibration.workflow_id,
    consequence_tier: tier.tier,
    ...(declaration.bounds !== undefined ? { bounds: declaration.bounds } : {}),
    granted: declaration.granted,
    level: declaration.granted,
    earned,
    ...(g ? { grant: { ...g, policy: { ...g.policy } } } : {}),
    handling: ACTION_HANDLING[declaration.granted],
    rungs,
    blockers,
    policy: pref,
    calibration_hash: calibration.calibration_hash,
  }

  const common = {
    status: 'PROPOSED' as const,
    requires_human_signature: true as const,
    workflow_id: calibration.workflow_id,
    consequence_tier: tier.tier,
    ...(declaration.bounds !== undefined ? { bounds: declaration.bounds } : {}),
    from: declaration.granted,
    earned,
    policy: pref,
    calibration_hash: calibration.calibration_hash,
  }
  // Surveillance (surveillance/evidence.ts): under an autonomy grant, a post-grant miss or an untested drawn PASS raises the
  // demotion PROPOSAL even while the pooled bound still clears. It never moves the rung (a person decides).
  const trigger = adj && declaration.granted === 'autonomy' ? adj.surveillance_cases : []
  // D-NO-FLIPFLOP: after a step down on a failure, a return is argued from the window since the step down, alone.
  const returning = fresh && ei > gi && levelRank(VOICE_LADDER[gi + 1] as VoiceLevel) <= levelRank(fresh.from)
  const windowRung = returning ? assessRung(VOICE_LADDER[gi + 1] as Rung, windowOf(calibration, fresh.ids), tier, policy.method, policy.sidedness ?? 'one-sided', adj) : undefined
  if (fresh) out.fresh_window = { from: fresh.from, since: { ...fresh.since }, records: fresh.records, ...(windowRung ? { rung: windowRung } : {}) }
  if (ei > gi && (!windowRung || windowRung.cleared)) {
    const to = VOICE_LADDER[gi + 1] as VoiceLevel
    const body: Omit<PromotionProposal, 'proposal_id'> = { kind: 'PROMOTION_PROPOSAL', urgent: false, ...common, to, rungs: rungs.filter(r => levelRank(r.rung) <= levelRank(to)) }
    out.proposal = { ...body, proposal_id: hashOf(body).slice(0, 32) }
  } else if (ei < gi || trigger.length) {
    const to = VOICE_LADDER[gi - 1] as VoiceLevel
    const unsupported = rungs.filter(r => levelRank(r.rung) > ei && levelRank(r.rung) <= gi)
    const failing = rungs.filter(r => levelRank(r.rung) <= gi && !r.cleared)
    const untestedIds = new Set([...(adj?.untested.PASS ?? []), ...(adj?.untested.FAIL ?? [])])
    const UNTESTED = 'drawn for review and still unreviewed when the next period closed: an untested item is a deviation (AS 2315 .40); reviewing it resolves this case'
    const seen = new Set<string>()
    const failing_cases: FailingCase[] = []
    for (const r of failing) {
      for (const id of r.counter_cases) {
        if (seen.has(id)) continue
        seen.add(id)
        failing_cases.push({ verdict_id: id, rung: r.rung, outcome: r.metric === 'false_pass_rate' ? 'PASS' : 'FAIL', dispute: disputeCommand(id), ...(untestedIds.has(id) ? { why: UNTESTED } : {}) })
      }
    }
    for (const id of trigger) {
      if (seen.has(id)) continue
      seen.add(id)
      failing_cases.push({
        verdict_id: id, rung: 'autonomy', outcome: 'PASS', dispute: disputeCommand(id),
        why: untestedIds.has(id) ? UNTESTED : 'a PASS recorded after the autonomy grant that a person overturned (surveillance): the pooled bound may still clear, but a miss under autonomy is shown at once',
      })
    }
    const surveillanceReason = trigger.length
      ? [`surveillance: ${trigger.length} post-grant finding(s) under autonomy (${trigger.filter(id => !untestedIds.has(id)).length} overturned, ${trigger.filter(id => untestedIds.has(id)).length} untested)`]
      : []
    // DECISION D-UNEVIDENCED (2026-09-28; fork: here): evidence OF failure is urgent; an ABSENCE of evidence is a
    // standing notice. Flipped 2026-09-28: `urgent` is exactly basis === 'failure'.
    const basis: DemotionProposal['basis'] = failing_cases.length > 0 || failureBlockers.length > 0 ? 'failure' : 'unevidenced'
    const body: Omit<DemotionProposal, 'proposal_id'> = {
      kind: 'DEMOTION_PROPOSAL', urgent: basis === 'failure', basis, ...common, to,
      rungs: rungs.filter(r => levelRank(r.rung) <= gi),
      reasons: [...blockers, ...unsupported.filter(r => !r.cleared).map(r => `${r.rung}: ${r.reason}`), ...surveillanceReason],
      failing_cases,
    }
    out.proposal = { ...body, proposal_id: hashOf(body).slice(0, 32) }
  }
  return out
}

/** A failure step down (D-NO-FLIPFLOP), as assessCore reads it: the rung left, the GRANT, and the window's verdict ids. */
interface StepDown { from: VoiceLevel; since: { decision_id: string; seq: number }; records: number; ids: ReadonlySet<string> }

/**
 * Is the grant in force a person's step down from a higher rung, made after a failing case against that rung? (DECISION
 * D-NO-FLIPFLOP-FAILURE, fork: here.) The failing case is read from the book: a verdict of this workflow that a person has
 * overturned on the left rung's metric (a PASS for autonomy, a FAIL for advise and gate), reviewed before the step down.
 * A step down with no such case (an unevidenced one, or a person's own choice) leaves the pooled record to argue the return.
 */
function stepDownWindow(g: DecisionEntry<GrantDecision>, book: DecisionBook, chainNow: () => ChainExport, cal: WorkflowCalibration, reading: { policies: PromotionPolicy[] }): StepDown | undefined {
  if (g.signed.decision.succeeds) return carriedStepDown(g, book, chainNow, reading)
  const wf = g.signed.decision.workflow_id
  const prev = grantAt(book.decisions, wf, g.seq, reading)
  if (!prev || levelRank(prev.signed.decision.level) <= levelRank(g.signed.decision.level)) return undefined
  const from = prev.signed.decision.level
  const wrong = new Set(RUNG_METRIC[from as Rung] === 'false_pass_rate' ? cal.evidence.false_pass : cal.evidence.false_fail)
  if (wrong.size === 0) return undefined
  const tenant = tenantOfWorkflow(wf)
  const { events, payloads } = chainNow()
  let failure = false
  const ids = new Set<string>()
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (ev.type === 'REVIEW' && i < g.seq && wrong.has(ev.verdict_id)) {
      const t = (payloads[i] as { tenant_id?: unknown } | undefined)?.tenant_id
      if (t === undefined || t === tenant) failure = true
    } else if (ev.type === 'RECORD' && i > g.seq && recordWorkflow(recordFactsAt(payloads, i) ?? payloads[i]) === wf) ids.add(ev.verdict_id) // P-J: no parse
  }
  return failure ? { from, since: { decision_id: g.decision_id, seq: g.seq }, records: ids.size, ids } : undefined
}

/**
 * D-NO-FLIPFLOP through a RULESET_SUCCESSION (ledger/decisions.ts `succeeds`). A succession carries the grant in force on the
 * old workflow; when that grant (followed back through earlier successions) is a person's step down made after a failing
 * case on the old workflow, a return to the rung it left is argued from the NEW workflow's verdicts recorded since that step
 * down, alone. The failing case is read from the old workflow's record: one of its verdicts whose latest review before the
 * step down overturned it on the left rung's metric (a PASS for autonomy, a FAIL for advise and gate).
 */
function carriedStepDown(g: DecisionEntry<GrantDecision>, book: DecisionBook, chainNow: () => ChainExport, reading: { policies: PromotionPolicy[] }): StepDown | undefined {
  const wf = g.signed.decision.workflow_id
  let c: DecisionEntry<GrantDecision> = g
  for (let hop = 0; hop < 16; hop++) {
    const s = c.signed.decision.succeeds
    if (!s) return undefined
    const next = book.decisions.find(e => e.decision_id === s.grant && e.signed.decision.kind === 'GRANT') as DecisionEntry<GrantDecision> | undefined
    if (!next) return undefined
    c = next
    const cw = c.signed.decision.workflow_id
    const prev = grantAt(book.decisions, cw, c.seq, reading)
    if (!prev || levelRank(prev.signed.decision.level) <= levelRank(c.signed.decision.level)) continue
    const from = prev.signed.decision.level
    const wrongOutcome = RUNG_METRIC[from as Rung] === 'false_pass_rate' ? 'PASS' : 'FAIL'
    const tenant = tenantOfWorkflow(cw)
    const { events, payloads } = chainNow()
    const outcome = new Map<string, unknown>()
    const latest = new Map<string, unknown>()
    const ids = new Set<string>()
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type === 'RECORD') {
        const p = recordFactsAt(payloads, i) ?? payloads[i] // P-J: a disk-backed book's index answers, without a parse
        const w = recordWorkflow(p)
        if (i < c.seq && w === cw && !outcome.has(ev.verdict_id)) outcome.set(ev.verdict_id, (p as { verdict?: { outcome?: unknown } }).verdict?.outcome)
        else if (i > c.seq && w === wf) ids.add(ev.verdict_id)
      } else if (ev.type === 'REVIEW' && i < c.seq && outcome.has(ev.verdict_id)) {
        const q = payloads[i] as { tenant_id?: unknown; review?: { decision?: unknown } } | undefined
        if (q?.tenant_id === undefined || q.tenant_id === tenant) latest.set(ev.verdict_id, q?.review?.decision)
      }
    }
    const failure = [...latest].some(([id, d]) => d === 'OVERTURNED' && outcome.get(id) === wrongOutcome)
    if (failure) return { from, since: { decision_id: c.decision_id, seq: c.seq }, records: ids.size, ids }
  }
  return undefined
}

/** The calibration's evidence restricted to the window's verdicts (the step down's; D-NO-FLIPFLOP). */
function windowOf(cal: WorkflowCalibration, ids: ReadonlySet<string>): WorkflowCalibration {
  const keep = (xs: readonly string[]): string[] => xs.filter(id => ids.has(id))
  const e = cal.evidence
  return { ...cal, evidence: { reviewed_pass: keep(e.reviewed_pass), reviewed_fail: keep(e.reviewed_fail), false_pass: keep(e.false_pass), false_fail: keep(e.false_fail) } }
}

// ── what-if arithmetic (what would overturn it; what it would take) ──────────────────────────────────────────────────

const CAP = 10_000_000

/** Smallest j ≥ 0 such that the upper bound after j MORE errors in j more reviews exceeds the bar (0 = already over). */
export function consecutiveErrorsToBreach(errors: number, n: number, bar: number, confidence: number, method: BoundMethod): number {
  const over = (j: number): boolean => rateInterval(errors + j, n + j, confidence, method).upper > bar
  if (over(0)) return 0
  let hi = 1
  while (!over(hi)) { hi *= 2; if (hi > CAP) return CAP }
  let lo = Math.floor(hi / 2)
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (over(mid)) hi = mid; else lo = mid }
  return hi
}

/** Smallest m in [0, horizon] such that m errors among the next `horizon` reviews push the upper bound over the bar; null if none do. */
export function errorsInHorizonToBreach(errors: number, n: number, horizon: number, bar: number, confidence: number, method: BoundMethod): number | null {
  const over = (m: number): boolean => rateInterval(errors + m, n + horizon, confidence, method).upper > bar
  if (!over(horizon)) return null
  let lo = -1, hi = horizon
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (over(mid)) hi = mid; else lo = mid }
  return hi
}

/** Smallest c ≥ 0 such that c more reviews with ZERO errors would clear the bar (n + c ≥ min_n and upper ≤ max_error); null past the cap. */
export function cleanReviewsToClear(errors: number, n: number, bar: RungBar, confidence: number, method: BoundMethod): number | null {
  const ok = (c: number): boolean => n + c >= bar.min_n && rateInterval(errors, n + c, confidence, method).upper <= bar.max_error
  if (ok(0)) return 0
  let hi = 1
  while (!ok(hi)) { hi *= 2; if (hi > CAP) return null }
  let lo = Math.floor(hi / 2)
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid }
  return hi
}
