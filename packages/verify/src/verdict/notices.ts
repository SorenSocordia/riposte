/**
 * Per-action notices — what happens to one action's FAIL or ABSTAIN, by rung (design ruling, 2026-09-28, as
 * corrected 08:35: *"the human should be made aware of what fails in case they want to dispute"*: awareness at every rung,
 * holding only where the rung holds).
 *
 *   rung       FAIL / ABSTAIN                                              PASS
 *   record     recorded + surfaced as a notice (evidence, dispute path)    unchanged (Riposte does not intervene)
 *   advise     surfaced prominently in-flow to the person and the agent    unchanged
 *   gate       HELD until a person resolves it                             human review
 *   autonomy   HELD until a person resolves it                             proceeds unreviewed within the declared bounds
 *
 * AT EVERY RUNG: every FAIL is shown to the person with the evidence it rests on and a dispute path for that single
 * finding. The findings and their dispute paths do not depend on the rung; only the handling does. Intercepting the tool
 * call in-flow (the verify_action adapters) is a DELIVERY SURFACE for the gate and autonomy holds, not a rung of its own.
 *
 * Only DETERMINISTIC findings count. Judgement-tier (REASONED) findings are advisories (COUNSEL, channel.ts): shown with
 * their evidence and a dispute path, and never held. For every v0 verdict (all DETERMINISTIC), the notice's outcome is the
 * verdict's outcome.
 */

import type { ClaimVerdict, Evidence, Insufficiency, Outcome, Value, Verdict } from './schema.js'
import type { VoiceLevel } from './voice.js'

/** The dispute path for one verdict (and optionally one claim) on the book of record. */
export const disputeCommand = (verdict_id: string, claim_id?: string): string =>
  `verify opinion --ledger <chain.jsonl> --dispute ${verdict_id}${claim_id !== undefined ? ` --claim ${claim_id}` : ''}`

/** How one action is handled at a rung. */
export interface ActionHandling {
  /** A FAIL is SURFACED (shown, not held) or HELD until a person resolves it. */
  FAIL: 'SURFACE' | 'HOLD'
  /** An ABSTAIN (INSUFFICIENT_DATA) likewise. */
  INSUFFICIENT_DATA: 'SURFACE' | 'HOLD'
  /** Where a PASS goes: UNCHANGED (Riposte does not intervene), HUMAN_REVIEW, or ACT_WITHIN_BOUNDS. */
  PASS: 'UNCHANGED' | 'HUMAN_REVIEW' | 'ACT_WITHIN_BOUNDS'
  /** How findings reach people: a notice on the record, or prominently in-flow to the person and the agent. */
  delivery: 'notice' | 'in-flow'
  /** Literally true at every rung: every FAIL is shown with its evidence and can be disputed. */
  every_fail_disputable: true
}

export const ACTION_HANDLING: Readonly<Record<VoiceLevel, ActionHandling>> = {
  record: { FAIL: 'SURFACE', INSUFFICIENT_DATA: 'SURFACE', PASS: 'UNCHANGED', delivery: 'notice', every_fail_disputable: true },
  advise: { FAIL: 'SURFACE', INSUFFICIENT_DATA: 'SURFACE', PASS: 'UNCHANGED', delivery: 'in-flow', every_fail_disputable: true },
  gate: { FAIL: 'HOLD', INSUFFICIENT_DATA: 'HOLD', PASS: 'HUMAN_REVIEW', delivery: 'in-flow', every_fail_disputable: true },
  autonomy: { FAIL: 'HOLD', INSUFFICIENT_DATA: 'HOLD', PASS: 'ACT_WITHIN_BOUNDS', delivery: 'in-flow', every_fail_disputable: true },
}

export interface Finding {
  claim_id: string
  rule_id: string
  rule_name: string
  outcome: 'FAIL' | 'INSUFFICIENT_DATA'
  field: string
  asserted: Value
  /** The recomputed / reference value, when the check ran. */
  expected?: Value
  variance?: number
  explanation: string
  /** The cells the finding rests on. Never empty for a FAIL (schema invariant). */
  evidence: Evidence[]
  insufficiency?: Insufficiency
  /** The dispute path for this single finding. */
  dispute: string
}

/** The rung-free part of a notice: what failed or could not run, with evidence and dispute paths. */
export interface VerdictFindings {
  verdict_id: string
  /** The outcome over DETERMINISTIC findings (ANY_FAIL_FAILS). Equals the verdict's outcome for every v0 verdict. */
  outcome: Outcome
  /** Every deterministic FAIL, then every deterministic abstention, in claim order. */
  findings: Finding[]
  /** Judgement-tier (REASONED) findings on this verdict: advisories, never held. Surface them via advisoriesFromVerdict. */
  advisories: number
  /** Dispute the whole verdict. */
  dispute: string
}

export interface ActionNotice extends VerdictFindings {
  /** The rung the action ran under. */
  level: VoiceLevel
  handling: ActionHandling
  /** HOLD: a person resolves it before the action proceeds. SURFACE: shown, not held. PROCEED: every check that ran held. */
  action: 'HOLD' | 'SURFACE' | 'PROCEED'
}

function findingOf(v: Verdict, c: ClaimVerdict): Finding {
  return {
    claim_id: c.claim_id,
    rule_id: c.rule_id,
    rule_name: c.rule_name,
    outcome: c.outcome as 'FAIL' | 'INSUFFICIENT_DATA',
    field: c.field,
    asserted: c.asserted,
    // A boolean computation result is a rule's pass/fail bit (e.g. GROUNDED), not a value the claim should have had.
    // Rendering it as "expected false" misled (delivery-lane finding F2, 2026-09-28), so only real values are "expected".
    ...(c.computation && typeof c.computation.result !== 'boolean' ? { expected: c.computation.result } : {}),
    ...(c.variance !== undefined ? { variance: c.variance } : {}),
    explanation: c.explanation,
    evidence: c.evidence.map(e => ({ ...e })),
    ...(c.insufficiency ? { insufficiency: { ...c.insufficiency } } : {}),
    dispute: disputeCommand(v.verdict_id, c.claim_id),
  }
}

/** Every deterministic FAIL and abstention on a verdict, with evidence and dispute paths. Independent of any rung. */
export function verdictFindings(verdict: Verdict): VerdictFindings {
  const det = verdict.claims.filter(c => c.tier === 'DETERMINISTIC')
  const reasoned = verdict.claims.filter(c => c.tier !== 'DETERMINISTIC' && (c.outcome === 'PASS' || c.outcome === 'FAIL')).length
  const fail = det.some(c => c.outcome === 'FAIL')
  const checked = det.filter(c => c.outcome !== 'INSUFFICIENT_DATA').length
  const aggregated: Outcome = fail ? 'FAIL' : checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  // Never softer than the verdict's own deterministic outcome (fixed 2026-09-28, delivery-lane finding F1). Some producers
  // are stricter than this aggregation: `verifyAction` returns INSUFFICIENT_DATA when ANY value is ungrounded ("execute
  // only when every value is grounded"). A partially grounded transfer (the amount allow-listed, the account number with
  // no source) used to read PASS / PROCEED here, and at autonomy the ungrounded account number went through. The
  // invariant this module documents, "for every all-deterministic verdict, the notice's outcome is the verdict's
  // outcome", now holds by construction. For mixed verdicts, judgement never hardens a notice (COUNSEL never holds), but
  // a deterministic abstention still does.
  const rank: Record<Outcome, number> = { PASS: 0, INSUFFICIENT_DATA: 1, FAIL: 2 }
  const allDet = det.length === verdict.claims.length
  const detInsufficient = det.some(c => c.outcome === 'INSUFFICIENT_DATA')
  const floor: Outcome = allDet ? verdict.outcome : (verdict.outcome === 'INSUFFICIENT_DATA' && detInsufficient ? 'INSUFFICIENT_DATA' : 'PASS')
  const outcome: Outcome = rank[floor] > rank[aggregated] ? floor : aggregated
  return {
    verdict_id: verdict.verdict_id,
    outcome,
    findings: [...det.filter(c => c.outcome === 'FAIL'), ...det.filter(c => c.outcome === 'INSUFFICIENT_DATA')].map(c => findingOf(verdict, c)),
    advisories: reasoned,
    dispute: disputeCommand(verdict.verdict_id),
  }
}

/** The notice for one action at a rung: the same findings at every rung; the handling is the rung's. */
export function actionNotice(verdict: Verdict, level: VoiceLevel): ActionNotice {
  const handling = ACTION_HANDLING[level]
  if (!handling) throw new RangeError(`unknown rung ${JSON.stringify(level)} (record | advise | gate | autonomy)`)
  const f = verdictFindings(verdict)
  const action: ActionNotice['action'] = f.outcome === 'PASS' ? 'PROCEED' : handling[f.outcome] === 'HOLD' ? 'HOLD' : 'SURFACE'
  return { ...f, level, handling, action }
}

const val = (v: Value | undefined): string => (v === undefined ? '—' : JSON.stringify(v))

function evidenceLine(e: Evidence): string {
  const where = e.locator.kind === 'field' ? `${e.locator.source}:${e.locator.path}` : `span ${e.locator.source_hash.slice(0, 12)}…[${e.locator.start}..${e.locator.end}]`
  const orig = e.original !== undefined ? ` (read as ${val(e.original)})` : ''
  return `  - \`${where}\` = ${val(e.value)}${orig} · confidence ${e.confidence}`
}

/** The findings as Markdown lines: each FAIL with its evidence and its own dispute path, then each abstention. */
export function renderFindings(f: VerdictFindings): string[] {
  const L: string[] = []
  for (const x of f.findings.filter(y => y.outcome === 'FAIL')) {
    L.push(`- ✗ **${x.rule_name}** (\`${x.claim_id}\`) on \`${x.field}\`: ${x.explanation}`)
    if (x.expected !== undefined) L.push(`  - asserted ${val(x.asserted)} · expected ${val(x.expected)}${x.variance !== undefined ? ` · variance ${x.variance}` : ''}`)
    L.push(...x.evidence.map(evidenceLine))
    L.push(`  - dispute this finding: \`${x.dispute}\``)
  }
  for (const x of f.findings.filter(y => y.outcome === 'INSUFFICIENT_DATA')) {
    L.push(`- ⚠ **${x.rule_name}** (\`${x.claim_id}\`) could not run: ${x.insufficiency?.reason ?? 'INSUFFICIENT_DATA'}: ${x.insufficiency?.detail ?? x.explanation}`)
    L.push(`  - dispute this finding: \`${x.dispute}\``)
  }
  if (f.advisories > 0) L.push(`- ${f.advisories} judgement-tier finding(s) on this verdict are advisories (COUNSEL): shown with their evidence, never held.`)
  return L
}

/** The notice as Markdown: the handling at this rung first, then every finding with its evidence and dispute path. */
export function renderActionNotice(n: ActionNotice): string {
  const what = n.outcome === 'FAIL' ? 'a check FAILed' : 'the checks could not decide (ABSTAIN)'
  const head = n.action === 'HOLD'
    ? `**HELD for a person** · rung \`${n.level}\` · verdict \`${n.verdict_id}\` · ${what}. It stays held until a person resolves it.`
    : n.action === 'SURFACE'
      ? `**${n.outcome === 'FAIL' ? 'FAIL' : 'ABSTAIN'}: surfaced, not held** · rung \`${n.level}\` (${n.handling.delivery === 'in-flow' ? 'shown in-flow to the person and the agent' : 'a notice on the record'}) · verdict \`${n.verdict_id}\` · ${what}. Dispute it if you disagree.`
      : `**PROCEED** · rung \`${n.level}\` · verdict \`${n.verdict_id}\` · every deterministic check that ran held (a PASS here: ${n.handling.PASS === 'ACT_WITHIN_BOUNDS' ? 'proceeds unreviewed within the declared bounds' : n.handling.PASS === 'HUMAN_REVIEW' ? 'goes to human review' : 'Riposte does not intervene'}).`
  return [head, '', ...renderFindings(n), '', `Dispute the whole verdict: \`${n.dispute}\``, ''].join('\n')
}
