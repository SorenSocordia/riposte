/**
 * The gate: a typed decision is allowed to ACT only when (1) the deterministic checks on the data it acted on pass,
 * (2) the decision is confident, and (3) — when probed — it does not flip under option reordering.
 *
 * Three outcomes, never conflated:
 *   PROCEED           — every check that ran passed and the decision is in the allowed set.
 *   HOLD              — something is demonstrably wrong (a check FAILed, or the model decided against the action).
 *   INSUFFICIENT_DATA — nothing is proven wrong, but there is not enough to act on (missing evidence, low confidence, or a
 *                       decision that moves with the prompt layout). The honest "can't tell", routed to a person.
 *
 * Before 2026-10-06 the third outcome was written ABSTAIN. A receipt that says so still verifies byte for byte (its signature
 * covers what it holds) and reads as INSUFFICIENT_DATA (readGateOutcome); nothing here writes it any more.
 *
 * "Jev is not a calculator" (TypeSafe's own docs). The gate is where the arithmetic goes.
 */
import { verify, gateStatus, gateStatusOpen, openClaims, type GateStatusOpen, type Json, type Verdict, type VerifyOptions } from 'riposte-verify'
import { decisionConfidence, type SystemOneRequest, type SystemOneResponse } from './systemone.js'
import type { FlipResult } from './flip.js'

export type GateOutcome = 'PROCEED' | 'HOLD' | 'INSUFFICIENT_DATA'

/** A gate outcome as any receipt wrote it: the older ABSTAIN reads as INSUFFICIENT_DATA; anything else unknown is undefined. */
export function readGateOutcome(x: unknown): GateOutcome | undefined {
  if (x === 'PROCEED' || x === 'HOLD' || x === 'INSUFFICIENT_DATA') return x
  if (x === 'ABSTAIN') return 'INSUFFICIENT_DATA'
  return undefined
}

export interface GatePolicy {
  /** the question whose answer authorizes the action */
  question: string
  /** answers that authorize it (choice keys; for noul use 'yes' / 'no') */
  allow: string[]
  /** minimum decision confidence to act. Default 0.8. */
  minConfidence?: number
  /** when a flip probe is supplied, answer INSUFFICIENT_DATA if the deciding question is unstable. Default true. */
  requireStable?: boolean
  /** when verify returns INSUFFICIENT_DATA for the document, answer INSUFFICIENT_DATA. Default true. (The option keeps its name.) */
  abstainOnInsufficient?: boolean
  /**
   * when verify returns PASS with a deterministic check that could not run (gateStatus PASS-WITH-OPEN), answer INSUFFICIENT_DATA.
   * Default false (2026-10-03): the built-in invoice ruleset cannot check every reference the caller did not send (contract, evidence,
   * history), so a strict reading would hold nearly every invoice; turn it on when every check of the ruleset is required.
   */
  holdOnOpen?: boolean
}

export interface GateChecks {
  /** the extracted data the decision acted on — recomputed deterministically by verify */
  extraction: Json
  options?: VerifyOptions
}

export interface GateResult {
  outcome: GateOutcome
  reasons: string[]
  decided?: string
  confidence?: number
  verdict?: Verdict
  /** the checked verdict's gate reading (verify's gateStatusOpen), when there was one: OPEN is always INSUFFICIENT_DATA (2026-10-04) */
  status?: GateStatusOpen
}

export function gate(
  request: SystemOneRequest,
  response: SystemOneResponse,
  policy: GatePolicy,
  checks?: GateChecks,
  flip?: Record<string, FlipResult>,
): GateResult {
  const reasons: string[] = []
  const hold: string[] = []
  const cantTell: string[] = []

  let verdict: Verdict | undefined
  let status: GateStatusOpen | undefined
  if (checks) {
    verdict = verify(checks.extraction, checks.options ?? {})
    status = gateStatusOpen(verdict)
    if (verdict.outcome === 'FAIL') {
      for (const c of verdict.claims) if (c.outcome === 'FAIL') hold.push(`check FAILED — ${c.field}: ${c.explanation}`)
    } else if (status === 'OPEN') {
      // OPEN (2026-10-04): a struck load-bearing field is neither PASS nor FAIL, so it is can't tell whatever holdOnOpen says
      const fields = (verdict.struck ?? []).map((s) => `${s.field} (${s.reason})`)
      cantTell.push(`OPEN: ${fields.join(', ') || 'a load-bearing field'} ${fields.length === 1 ? 'is' : 'are'} struck; it resolves by evidence`)
    } else if (verdict.outcome === 'INSUFFICIENT_DATA' && (policy.abstainOnInsufficient ?? true)) {
      cantTell.push('checks could not verify the document (INSUFFICIENT_DATA)')
    } else if (policy.holdOnOpen === true && gateStatus(verdict) === 'PASS-WITH-OPEN') {
      // An open check is can't tell (2026-10-03): under ANY_FAIL_FAILS the verdict PASSes on the checks that ran, but a check that
      // could not run is not a check that held.
      const open = openClaims(verdict)
      cantTell.push(`PASS-WITH-OPEN: ${open.length} check${open.length === 1 ? '' : 's'} could not run (${open.map((c) => c.claim_id).join(', ')})`)
    }
  }

  const q = request.questions[policy.question]
  const a = response.answers[policy.question]
  let decided: string | undefined
  let confidence: number | undefined
  if (!q || !a) {
    cantTell.push(`no answer for the deciding question "${policy.question}"`)
  } else {
    decided = a.type === 'choice' ? a.choice : a.type === 'noul' ? (a.noul >= 0.5 ? 'yes' : 'no') : String(a.score)
    confidence = decisionConfidence(a)
    if (!policy.allow.includes(decided)) hold.push(`model decided "${decided}", which does not authorize the action`)
    const min = policy.minConfidence ?? 0.8
    if (confidence === undefined) cantTell.push('decision carries no confidence')
    else if (confidence < min) cantTell.push(`decision confidence ${confidence.toFixed(3)} < ${min}`)
    const fr = flip?.[policy.question]
    if (fr && (policy.requireStable ?? true) && !fr.stable) {
      cantTell.push(`decision flips under option reordering (${fr.choices.join(' / ')}; flip rate ${(fr.flipRate * 100).toFixed(0)}%)`)
    }
  }

  // HOLD dominates can't tell: a demonstrated failure is a stronger fact than a missing one.
  const outcome: GateOutcome = hold.length ? 'HOLD' : cantTell.length ? 'INSUFFICIENT_DATA' : 'PROCEED'
  reasons.push(...hold, ...cantTell)
  if (outcome === 'PROCEED') reasons.push('all checks that ran passed; decision confident and in the allowed set')
  const out: GateResult = { outcome, reasons }
  if (decided !== undefined) out.decided = decided
  if (confidence !== undefined) out.confidence = confidence
  if (verdict) out.verdict = verdict
  if (status !== undefined) out.status = status
  return out
}
