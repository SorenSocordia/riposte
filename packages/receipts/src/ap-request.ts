/**
 * Reading a structured AP gate request (2026-10-03): `{ structured: <AP input>, decision? }`, the same rules the hosted
 * gate applies. The model's decision is `decision` or the input's own `decision` ({ action: pay | hold, reason? }); both
 * present, they must agree. Text documents alongside structured input are refused, and so is top-level `history` (structured
 * input carries `payment_history`). Validation errors are verify's typed errors, each field a JSON Pointer under /structured.
 */
import { apDecisionLabel, apInputDocuments, validateApInput, type ApInputError, type ApStructuredDocuments } from 'riposte-verify'

/** The model decisions a gate takes (a bare `hold` agrees with any hold the checker finds). */
export const AP_GATE_DECISIONS = ['approve', 'hold_no_po', 'hold_quantity', 'hold_price', 'hold_line_math', 'hold_total', 'hold_duplicate', 'hold'] as const

export type StructuredGateRequest =
  | { ok: true; decision: string; docs: ApStructuredDocuments }
  | { ok: false; code: 'request.input_invalid' | 'request.history_invalid' | 'request.decision_invalid'; message: string; errors?: ApInputError[] }

export function structuredGateRequest(b: Record<string, unknown>): StructuredGateRequest {
  if (b.invoice !== undefined || b.purchase_order !== undefined || b.goods_receipt !== undefined || b.layout !== undefined) {
    return { ok: false, code: 'request.input_invalid', message: 'send either "structured" or the text documents ("invoice", "purchase_order", "goods_receipt" or "layout"), not both',
      errors: [{ code: 'ap_input.conflict', field: '/structured', message: 'text documents sent alongside structured input' } as ApInputError] }
  }
  if (b.history !== undefined) return { ok: false, code: 'request.history_invalid', message: 'with "structured", send payment history inside it as "payment_history" (top-level "history" belongs to the text form)' }
  const v = validateApInput(b.structured)
  if (!v.ok) {
    const first = v.errors[0]!
    return { ok: false, code: 'request.input_invalid', message: `the structured AP input does not validate (${v.errors.length} error${v.errors.length === 1 ? '' : 's'}; first: /structured${first.field} ${first.message})`,
      errors: v.errors.map((e) => ({ ...e, field: `/structured${e.field}` })) }
  }
  const inner = v.input.decision ? apDecisionLabel(v.input.decision) : undefined
  const outer = b.decision
  if (outer !== undefined && (typeof outer !== 'string' || !(AP_GATE_DECISIONS as readonly string[]).includes(outer))) {
    return { ok: false, code: 'request.decision_invalid', message: `"decision" must be one of ${AP_GATE_DECISIONS.join(', ')}: the model's decision for this invoice` }
  }
  if (outer === undefined && inner === undefined) return { ok: false, code: 'request.decision_invalid', message: 'no decision: send "decision" or "structured.decision" ({ "action": "pay" | "hold", "reason"? })' }
  if (outer !== undefined && inner !== undefined && outer !== inner) return { ok: false, code: 'request.decision_invalid', message: `"decision" (${outer}) and "structured.decision" (${inner}) disagree: send one, or the same in both` }
  return { ok: true, decision: (outer ?? inner) as string, docs: apInputDocuments(v.input) }
}
