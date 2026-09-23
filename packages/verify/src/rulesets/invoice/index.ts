/**
 * RULESET: commercial invoice — the default.
 *
 * Always runs (single-document coherence):
 *   SUM_INT   Σ line amounts = subtotal
 *   TOTAL_INT total = subtotal + tax − discount
 *   TAX_INT   tax = subtotal × rate
 *   MATH_INT  per line: amount = unit_price × quantity
 *   DUP_PROHIB when the caller supplies prior_invoice_ids
 * Runs only when references are supplied (else INSUFFICIENT_DATA / REFERENCE_NOT_PROVIDED):
 *   RATE_SUP, AMT_CAP, TIME_ORD  (contract / PO)      QTY_MATCH  (evidence: receipt / delivery / ticket)
 */

import type { BoundValue, UniversalRole } from '../../kernel/types.js'
import { duplicateClaims } from '../../dedup.js'
import { evidenceFromBinding } from '../../verdict/from-report.js'
import type { Evidence } from '../../verdict/schema.js'
import { RULESET as INVOICE_REF } from '../../version.js'
import { INVOICE_AXIOMS } from './axioms.js'
import { INVOICE_ONTOLOGY } from './ontology.js'
import { computed, num, round4, type AbsenceMap, type ComputeInput, type ComputeOutput, type Ruleset } from '../types.js'

export { INVOICE_AXIOMS, CURRENCY_TOLERANCE, registerInvoiceAxioms } from './axioms.js'
export { INVOICE_ONTOLOGY } from './ontology.js'

function operandEvidence(bindings: Partial<Record<UniversalRole, BoundValue>>, roles: UniversalRole[]): Evidence[] {
  const out: Evidence[] = []
  for (const r of roles) {
    const b = bindings[r]
    if (b) out.push(evidenceFromBinding(r, b))
  }
  return out
}

function compute({ docCtx, lineCtxs, extraction }: ComputeInput): ComputeOutput {
  const docAbsence: AbsenceMap = {}
  const lineAbsence: AbsenceMap[] = lineCtxs.map(() => ({}))
  const attach: Record<string, Evidence[]> = {}

  // Per line: the operands behind MATH_INT's computed total (rate × qty) belong on the receipt too.
  const lineAmounts: BoundValue[] = []
  const lineProblems: string[] = []
  lineCtxs.forEach((ctx, i) => {
    attach[`line[${i}].MATH_INT`] = operandEvidence(ctx.bindings, ['RATE_APPLIED', 'CLAIMED_QUANTITY'])
    const amt = ctx.bindings.CLAIMED_AMOUNT
    if (amt && num(amt) !== null) lineAmounts.push({ ...amt, field: amt.field.replace('[*]', `[${i}]`) })
    else lineProblems.push(`line_items[${i}]: amount missing or unparseable`)
  })

  // LINE_ITEMS_SUM = Σ line amounts (only when every line contributed a number — otherwise the sum would lie)
  const lineCount = Array.isArray(extraction.line_items) ? extraction.line_items.length : 0
  if (lineCount === 0) docAbsence.LINE_ITEMS_SUM = 'no line_items array on the extraction'
  else if (lineProblems.length > 0) docAbsence.LINE_ITEMS_SUM = lineProblems.join('; ')
  else {
    const sum = round4(lineAmounts.reduce((acc, b) => acc + (b.value as number), 0))
    docCtx.bindings.LINE_ITEMS_SUM = computed(sum, `Σ(${lineAmounts.map(b => b.field).join(' + ')})`, lineAmounts)
    attach['document.SUM_INT'] = lineAmounts.map(b => evidenceFromBinding('CLAIMED_AMOUNT', b))
  }

  // EXPECTED_GRAND_TOTAL = SUBTOTAL + TAX_AMOUNT − DISCOUNT_AMOUNT (absent tax/discount → 0, recorded)
  const B = docCtx.bindings
  const subtotal = num(B.SUBTOTAL)
  const tax = num(B.TAX_AMOUNT)
  const discount = num(B.DISCOUNT_AMOUNT)
  const service = num(B.SERVICE_CHARGE)
  if (subtotal === null || !B.SUBTOTAL) {
    docAbsence.EXPECTED_GRAND_TOTAL = 'SUBTOTAL not present on the extraction'
  } else {
    const notes: string[] = []
    if (tax === null) notes.push('TAX_AMOUNT absent → 0')
    if (service === null) notes.push('SERVICE_CHARGE absent → 0')
    if (discount === null) notes.push('DISCOUNT_AMOUNT absent → 0')
    const ops = [
      B.SUBTOTAL,
      ...(tax !== null && B.TAX_AMOUNT ? [B.TAX_AMOUNT] : []),
      ...(service !== null && B.SERVICE_CHARGE ? [B.SERVICE_CHARGE] : []),
      ...(discount !== null && B.DISCOUNT_AMOUNT ? [B.DISCOUNT_AMOUNT] : []),
    ]
    // A discount reduces the total by its MAGNITUDE — receipts store it either as a positive number or a negative one
    // (CORD `discount_price: "-9,545"`); subtracting a negative would wrongly add it. Reduce by |discount| either way.
    B.EXPECTED_GRAND_TOTAL = computed(
      round4(subtotal + (tax ?? 0) + (service ?? 0) - Math.abs(discount ?? 0)),
      `SUBTOTAL + TAX_AMOUNT + SERVICE_CHARGE − |DISCOUNT_AMOUNT|${notes.length ? ` (${notes.join('; ')})` : ''}`,
      ops,
    )
  }
  attach['document.TOTAL_INT'] = operandEvidence(B, ['SUBTOTAL', 'TAX_AMOUNT', 'SERVICE_CHARGE', 'DISCOUNT_AMOUNT'])

  // EXPECTED_TAX_AMOUNT = SUBTOTAL × TAX_RATE (sub-cent precision; the one-cent tolerance absorbs either rounding convention)
  const rate = num(B.TAX_RATE)
  if (subtotal === null || !B.SUBTOTAL) docAbsence.EXPECTED_TAX_AMOUNT = 'SUBTOTAL not present on the extraction'
  else if (rate === null || !B.TAX_RATE) docAbsence.EXPECTED_TAX_AMOUNT = 'TAX_RATE not present on the extraction'
  else B.EXPECTED_TAX_AMOUNT = computed(round4(subtotal * rate), 'SUBTOTAL × TAX_RATE', [B.SUBTOTAL, B.TAX_RATE])
  attach['document.TAX_INT'] = operandEvidence(B, ['SUBTOTAL', 'TAX_RATE'])

  // Exact + near duplicate detection (DUP_PROHIB / DUP_NEAR) — self-contained, not a gavel predicate.
  const claims = duplicateClaims(B.DOCUMENT_ID, B.PRIOR_CLAIM_IDS)

  return { docAbsence, lineAbsence, attach, claims }
}

export const INVOICE_RULESET: Ruleset = {
  ...INVOICE_REF,
  name: 'Commercial invoice',
  ontology: INVOICE_ONTOLOGY,
  axioms: INVOICE_AXIOMS,
  lineCodes: ['MATH_INT', 'RATE_SUP', 'AMT_CAP', 'QTY_MATCH'],
  // DUP_PROHIB + DUP_NEAR are produced by compute() (self-contained), not the gavel — so they are NOT listed here.
  documentCodes: ['SUM_INT', 'TOTAL_INT', 'TAX_INT', 'TIME_ORD'],
  kindByCode: {
    SUM_INT: 'RECOMPUTE', TOTAL_INT: 'RECOMPUTE', TAX_INT: 'RECOMPUTE', MATH_INT: 'RECOMPUTE',
    RATE_SUP: 'CROSS_REFERENCE', AMT_CAP: 'CROSS_REFERENCE', TIME_ORD: 'CROSS_REFERENCE', QTY_MATCH: 'CROSS_REFERENCE',
    DUP_PROHIB: 'CONSISTENCY',
  },
  fieldByCode: {
    SUM_INT: 'subtotal', TOTAL_INT: 'total', TAX_INT: 'tax', MATH_INT: 'amount',
    RATE_SUP: 'unit_price', AMT_CAP: 'amount', TIME_ORD: 'service_date', QTY_MATCH: 'quantity', DUP_PROHIB: 'invoice_number',
  },
  referenceRoles: {
    contract: ['RATE_CONTRACTED', 'CONTRACTED_LIMIT', 'CONTRACT_START', 'CONTRACT_END'],
    evidence: ['ACTUAL_QUANTITY', 'VERIFIED_AMOUNT', 'EVIDENCE_DESCRIPTION'],
    history: [],
  },
  computedRoles: ['LINE_ITEMS_SUM', 'EXPECTED_GRAND_TOTAL', 'EXPECTED_TAX_AMOUNT', 'LINE_ITEM_TOTAL', 'EXPECTED_TOTAL'],
  // Practitioner rounding policy: tolerate up to 0.05% of the compared magnitude (over the $0.01 floor) — a penny never false-alarms.
  defaultTolerance: { rel: 0.0003, absCap: 0 }, // 0.03% band, no cap (see src/tolerance.ts): forgives real rounding across currencies, catches material errors
  ambiguityGuards: [['RATE_SUP', 'RATE_CONTRACTED'], ['AMT_CAP', 'CONTRACTED_LIMIT']],
  compute,
}

export default INVOICE_RULESET
