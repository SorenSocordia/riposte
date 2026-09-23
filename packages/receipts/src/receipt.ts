/**
 * The receipt: one signed, replayable record of a typed decision and what was checked before it was allowed to act.
 *
 * What it binds (VentureBeat's audit list, plus the checks): the exact state + questions + option order sent, the
 * model id, the returned probabilities, the flip-probe evidence, the deterministic verdict id, and the gate outcome
 * with its reasons. `receipt_id` is a hash over all of that EXCEPT `issued_at`, so the same decision replays to the same
 * id; the Ed25519 signature covers the whole body, so altering anything (the outcome included) breaks it.
 *
 * Honest boundary (same as verify's envelope): the signature proves the receipt is untampered and was issued by the
 * key holder. Binding that key to a real identity is an out-of-band anchor.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, hashOf } from 'riposte-verify'
import type { SystemOneRequest, SystemOneResponse } from './systemone.js'
import type { FlipResult } from './flip.js'
import type { GateResult } from './gate.js'

export const RECEIPT_VERSION = 'receipts/0.1'

export interface DecisionReceipt {
  receipt_version: typeof RECEIPT_VERSION
  receipt_id: string
  issued_at: string
  model: string
  /** sha256 of the canonical request (state + questions, option order included) */
  request_hash: string
  /** option order as sent, per choice question — order is part of the prompt, so it is part of the record */
  option_orders: Record<string, string[]>
  answers: SystemOneResponse['answers']
  flip?: Record<string, Pick<FlipResult, 'options' | 'choices' | 'stable' | 'flipRate' | 'maxProbSwing'> & { seed_orders: string[][] }>
  checks?: { verdict_id: string; outcome: string; engine_version: string; ruleset: string }
  gate: { outcome: GateResult['outcome']; reasons: string[]; decided?: string; confidence?: number }
}

export interface SignedReceipt {
  receipt: DecisionReceipt
  alg: 'ed25519'
  public_key: string
  signature: string
}

export interface BuildReceiptInput {
  request: SystemOneRequest
  response: SystemOneResponse
  gate: GateResult
  flip?: Record<string, FlipResult>
  /** injectable clock; the only non-deterministic field, excluded from receipt_id */
  now?: () => Date
}

export function buildReceipt(input: BuildReceiptInput): DecisionReceipt {
  const { request, response, gate, flip } = input
  const option_orders: Record<string, string[]> = {}
  for (const [name, q] of Object.entries(request.questions)) if (q.type === 'choice') option_orders[name] = Object.keys(q.criteria)

  const body: Omit<DecisionReceipt, 'receipt_id' | 'issued_at'> = {
    receipt_version: RECEIPT_VERSION,
    model: response.model,
    request_hash: hashOf(request),
    option_orders,
    answers: response.answers,
    gate: {
      outcome: gate.outcome,
      reasons: gate.reasons,
      ...(gate.decided !== undefined ? { decided: gate.decided } : {}),
      ...(gate.confidence !== undefined ? { confidence: gate.confidence } : {}),
    },
  }
  if (flip) {
    body.flip = Object.fromEntries(Object.entries(flip).map(([k, f]) => [k, {
      options: f.options, choices: f.choices, stable: f.stable, flipRate: f.flipRate, maxProbSwing: f.maxProbSwing, seed_orders: f.orders,
    }]))
  }
  if (gate.verdict) {
    const v = gate.verdict
    body.checks = { verdict_id: v.verdict_id, outcome: v.outcome, engine_version: v.engine_version, ruleset: `${v.ruleset.id}@${v.ruleset.version}` }
  }
  const receipt_id = hashOf(body).slice(0, 32)
  const issued_at = (input.now ?? (() => new Date()))().toISOString()
  return { ...body, receipt_id, issued_at }
}

export function signReceipt(receipt: DecisionReceipt, privateKeyPem: string): SignedReceipt {
  const key = createPrivateKey(privateKeyPem)
  const signature = edSign(null, Buffer.from(canonicalize(receipt), 'utf8'), key).toString('base64')
  const public_key = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()
  return { receipt, alg: 'ed25519', public_key, signature }
}

export interface ReceiptCheck {
  ok: boolean
  signature_ok: boolean
  /** receipt_id re-derives from the body (i.e. the body is internally consistent) */
  id_ok: boolean
  /** when the original request is supplied: it hashes to request_hash */
  request_ok?: boolean
  reason?: string
}

/** Verify a signed receipt with only its embedded public key — no model, no engine, no shared secret. */
export function verifyReceipt(signed: SignedReceipt, request?: SystemOneRequest): ReceiptCheck {
  if (signed.alg !== 'ed25519') return { ok: false, signature_ok: false, id_ok: false, reason: `unsupported alg: ${signed.alg}` }
  let signature_ok = false
  try {
    signature_ok = edVerify(null, Buffer.from(canonicalize(signed.receipt), 'utf8'), createPublicKey(signed.public_key), Buffer.from(signed.signature, 'base64'))
  } catch (e) {
    return { ok: false, signature_ok: false, id_ok: false, reason: `signature verification errored: ${(e as Error).message}` }
  }
  const { receipt_id, issued_at: _issued, ...body } = signed.receipt
  const id_ok = hashOf(body).slice(0, 32) === receipt_id
  const out: ReceiptCheck = { ok: signature_ok && id_ok, signature_ok, id_ok }
  if (request !== undefined) {
    out.request_ok = hashOf(request) === signed.receipt.request_hash
    out.ok = out.ok && out.request_ok
  }
  if (!signature_ok) out.reason = 'signature does not verify — the receipt was altered, or the key does not match'
  else if (!id_ok) out.reason = 'receipt_id does not derive from the receipt body'
  else if (out.request_ok === false) out.reason = 'the supplied request is not the one this receipt records'
  return out
}
