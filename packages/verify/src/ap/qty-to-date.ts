/**
 * The billed-to-date check (engine 0.6.0, 2026-10-06), structured path only (./structured.ts).
 * Engines up to 0.5.0 have no such claim, and a purchase-order line that carries no invoiced_quantity_to_date gets none either,
 * so those verdicts are unchanged.
 *
 * Why. One cable line was billed 24, then 30, against 40 ordered and 40 received: 54 billed, and the second bill was approved
 * with exit 0. The quantity check compares each bill with what was received, and payment-history rows carry an amount, not
 * lines, so earlier bills could only be netted against the order's total. Job-cost ERPs keep the quantity already invoiced on
 * each PO line; the input can now carry it:
 *
 *   purchase_order.line_items[].invoiced_quantity_to_date   the quantity invoiced on this PO line by EARLIER bills, not counting
 *                                                           this one (riposte.ap-input/0.1.0, additive, optional)
 *
 * The claim `ap.line[L].billed_to_date` (rule AP_QTY_TO_DATE), only on a PO line that carries the field, that this bill bills,
 * and whose quantity check could compare (the bill states a quantity and the line has a goods receipt):
 *   earlier + this bill ≤ received   PASS, naming the three figures
 *   earlier + this bill > received   a person decides (AMBIGUOUS_REFERENCE): "billed to date would be 54 against 40 received:
 *                                    24 invoiced earlier on PO line 1, 30 on this bill"; the buyer clears it. Never a FAIL: the
 *                                    field's own meaning (earlier bills only, or this one too) is the ERP's, and a person reads it
 * When this bill alone bills more than was received, the quantity check holds it (hold_quantity) first, as before.
 * Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import type { RuleRemedies } from '../verdict/remedy.js'

export const AP_QTY_TO_DATE_RULE = { id: 'AP_QTY_TO_DATE', name: 'Billed to date within units received' } as const
const FORMULA = "invoiced_quantity_to_date + this bill's quantity ≤ quantity received"

const n6 = (x: number): number => Math.round(x * 1e6) / 1e6

export function qtyToDateClaim(x: {
  /** the claim-id prefix of the PO line, `ap.line[L]` */
  prefix: string
  /** the PO line's 1-based position */
  L: number
  /** the item a clerk sees */
  name: string
  earlier: number
  this_bill: number
  received: number
  evidence: readonly Evidence[]
}): ClaimVerdict {
  const billed = n6(x.earlier + x.this_bill)
  const base = { claim_id: `${x.prefix}.billed_to_date`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: `line[${x.L}].quantity`, rule_id: AP_QTY_TO_DATE_RULE.id, rule_name: AP_QTY_TO_DATE_RULE.name }
  const computation = { formula: FORMULA, operands: { invoiced_to_date: x.earlier, this_bill: x.this_bill, received: x.received, billed_to_date: billed }, result: x.received }
  if (billed <= x.received + 1e-9) {
    return { ...base, outcome: 'PASS', asserted: billed, computation, evidence: [...x.evidence], locked: true,
      explanation: `${x.name}: billed to date ${billed} of ${x.received} received (${x.earlier} invoiced earlier on PO line ${x.L}, ${x.this_bill} on this bill).` }
  }
  const detail = `${x.name}: billed to date would be ${billed} against ${x.received} received: ${x.earlier} invoiced earlier on PO line ${x.L} (invoiced_quantity_to_date), ${x.this_bill} on this bill. A person confirms what is still open on the line (an earlier bill credited, or units received and not yet posted) before it is paid`
  return { ...base, outcome: 'INSUFFICIENT_DATA', asserted: billed, computation, evidence: [...x.evidence],
    insufficiency: { reason: 'AMBIGUOUS_REFERENCE', detail }, locked: false, variance: n6(billed - x.received), explanation: detail }
}

/** The not_checked words for a billed PO line whose earlier bills' quantity is not in the input (the per-line netting gap). */
export const QTY_TO_DATE_FIELD = 'invoiced_quantity_to_date'

/** Remedies for AP_QTY_TO_DATE (engine 0.6.0's AP table, ./index.ts AP_REMEDIES_V060). The buyer owns the order. */
export const QTY_TO_DATE_REMEDIES: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'buyer', when: ['AMBIGUOUS_REFERENCE'],
      detail: 'Billed to date on this PO line would be {asserted} against {expected} received. The buyer confirms what is still open on the line (an earlier bill credited or voided, or units received and not yet posted), for this verdict only.' },
    { kind: 'missing-operand', operand: { source: 'goods_receipt' }, when: ['AMBIGUOUS_REFERENCE'],
      detail: 'A goods receipt for the units billed beyond what was received, or a credit against an earlier bill on the line: the bill is then checked as a new verdict.' },
  ],
}
