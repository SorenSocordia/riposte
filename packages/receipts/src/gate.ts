/**
 * The gate: a typed decision is allowed to ACT only when (1) the deterministic checks on the data it acted on pass,
 * (2) the decision is confident, and (3) — when probed — it does not flip under option reordering.
 *
 * Three outcomes, never conflated:
 *   PROCEED — every check that ran passed and the decision is in the allowed set.
 *   HOLD    — something is demonstrably wrong (a check FAILed, or the model decided against the action).
 *   ABSTAIN — nothing is proven wrong, but there is not enough to act on (missing evidence, low confidence, or a
 *             decision that moves with the prompt layout). The honest "can't tell", routed to a human.
 *
 * "Jev is not a calculator" (TypeSafe's own docs). The gate is where the arithmetic goes.
 */
import { verify, type Json, type Verdict, type VerifyOptions } from 'riposte-verify'
import { decisionConfidence, type SystemOneRequest, type SystemOneResponse } from './systemone.js'
import type { FlipResult } from './flip.js'

export type GateOutcome = 'PROCEED' | 'HOLD' | 'ABSTAIN'

export interface GatePolicy {
  /** the question whose answer authorizes the action */
  question: string
  /** answers that authorize it (choice keys; for noul use 'yes' / 'no') */
  allow: string[]
  /** minimum decision confidence to act. Default 0.8. */
  minConfidence?: number
  /** when a flip probe is supplied, abstain if the deciding question is unstable. Default true. */
  requireStable?: boolean
  /** when verify returns INSUFFICIENT_DATA for the document, abstain. Default true. */
  abstainOnInsufficient?: boolean
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
  const abstain: string[] = []

  let verdict: Verdict | undefined
  if (checks) {
    verdict = verify(checks.extraction, checks.options ?? {})
    if (verdict.outcome === 'FAIL') {
      for (const c of verdict.claims) if (c.outcome === 'FAIL') hold.push(`check FAILED — ${c.field}: ${c.explanation}`)
    } else if (verdict.outcome === 'INSUFFICIENT_DATA' && (policy.abstainOnInsufficient ?? true)) {
      abstain.push('checks could not verify the document (INSUFFICIENT_DATA)')
    }
  }

  const q = request.questions[policy.question]
  const a = response.answers[policy.question]
  let decided: string | undefined
  let confidence: number | undefined
  if (!q || !a) {
    abstain.push(`no answer for the deciding question "${policy.question}"`)
  } else {
    decided = a.type === 'choice' ? a.choice : a.type === 'noul' ? (a.noul >= 0.5 ? 'yes' : 'no') : String(a.score)
    confidence = decisionConfidence(a)
    if (!policy.allow.includes(decided)) hold.push(`model decided "${decided}", which does not authorize the action`)
    const min = policy.minConfidence ?? 0.8
    if (confidence === undefined) abstain.push('decision carries no confidence')
    else if (confidence < min) abstain.push(`decision confidence ${confidence.toFixed(3)} < ${min}`)
    const fr = flip?.[policy.question]
    if (fr && (policy.requireStable ?? true) && !fr.stable) {
      abstain.push(`decision flips under option reordering (${fr.choices.join(' / ')}; flip rate ${(fr.flipRate * 100).toFixed(0)}%)`)
    }
  }

  // HOLD dominates ABSTAIN: a demonstrated failure is a stronger fact than a missing one.
  const outcome: GateOutcome = hold.length ? 'HOLD' : abstain.length ? 'ABSTAIN' : 'PROCEED'
  reasons.push(...hold, ...abstain)
  if (outcome === 'PROCEED') reasons.push('all checks that ran passed; decision confident and in the allowed set')
  const out: GateResult = { outcome, reasons }
  if (decided !== undefined) out.decided = decided
  if (confidence !== undefined) out.confidence = confidence
  if (verdict) out.verdict = verdict
  return out
}
