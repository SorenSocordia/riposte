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
import { CAPPED, PRACTITIONER } from '../../tolerance.js'
import { INVOICE_AXIOMS, INVOICE_REMEDIES } from './axioms.js'
import { INVOICE_ONTOLOGY } from './ontology.js'
import { computed, num, round4, type AbsenceMap, type ComputeInput, type ComputeOutput, type Ruleset } from '../types.js'
import { documentFormat, nearMissArrayKey, refuseNearMissKeys, strictenBindings, type Refusals } from '../strict.js'
import { engineAtLeast } from '../../version.js'
import { explainInWords } from './words.js'

export { INVOICE_AXIOMS, INVOICE_REMEDIES, CURRENCY_TOLERANCE, registerInvoiceAxioms } from './axioms.js'
export { INVOICE_ONTOLOGY } from './ontology.js'

function operandEvidence(bindings: Partial<Record<UniversalRole, BoundValue>>, roles: UniversalRole[]): Evidence[] {
  const out: Evidence[] = []
  for (const r of roles) {
    const b = bindings[r]
    if (b) out.push(evidenceFromBinding(r, b))
  }
  return out
}

/** Bound, but not a number: present and unparseable. Never the same thing as absent. */
function unparseable(b: BoundValue | undefined): boolean {
  return b !== undefined && b.value !== null && b.value !== undefined && num(b) === null
}

const shown = (b: BoundValue | undefined): string => {
  const s = JSON.stringify(b?.value) ?? String(b?.value)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/**
 * `readsJunkAsAbsent` is 0.0.1's behaviour, kept for replay: a tax, service charge or discount that was present but would
 * not parse was read as absent → 0, so a correct total could FAIL on "n/a". From 0.1.0 it makes the expected total
 * UNPARSEABLE instead (could-not-compare is not FAIL).
 */
function makeCompute(readsJunkAsAbsent: boolean): (input: ComputeInput) => ComputeOutput {
  return input => compute(input, readsJunkAsAbsent)
}

function compute({ docCtx, lineCtxs, extraction, engine }: ComputeInput, readsJunkAsAbsent: boolean): ComputeOutput {
  const docAbsence: AbsenceMap = {}
  const lineAbsence: AbsenceMap[] = lineCtxs.map(() => ({}))
  const attach: Record<string, Evidence[]> = {}

  // Engine 0.6.0 (2026-10-05): read strictly (../strict.ts). A value that does not read
  // as one number keeps its raw text (every check on it abstains UNPARSEABLE); a near-miss key is refused by name. Below 0.6.0
  // (and for a caller that names no engine) nothing here runs and the refusals are empty, so the code reads exactly as before.
  const strict = engine !== undefined && engineAtLeast(engine, '0.6.0')
  const refusedDoc: Refusals = {}
  const refusedLines: Refusals[] = lineCtxs.map(() => ({}))
  if (strict) {
    const lineKey = (INVOICE_ONTOLOGY.lineArrayKeys ?? ['line_items']).find(k => Array.isArray(extraction[k]))
    const near = refuseNearMissKeys(extraction, docCtx, lineCtxs, INVOICE_ONTOLOGY, lineKey)
    const format = documentFormat(extraction, [docCtx, ...lineCtxs], INVOICE_ONTOLOGY)
    Object.assign(refusedDoc, near.doc, strictenBindings(docCtx, INVOICE_ONTOLOGY, undefined, format))
    lineCtxs.forEach((ctx, i) => Object.assign(refusedLines[i]!, near.lines[i], strictenBindings(ctx, INVOICE_ONTOLOGY, i, format)))
    Object.assign(docAbsence, near.doc)
    near.lines.forEach((r, i) => Object.assign(lineAbsence[i]!, r))
  }
  const refusedDetail = (r: Refusals, role: keyof Refusals): string | undefined => { const a = r[role]; return a === undefined ? undefined : typeof a === 'string' ? a : a.detail }

  // Per line: the operands behind MATH_INT's computed total (rate × qty) belong on the receipt too.
  const lineAmounts: BoundValue[] = []
  const lineProblems: string[] = []
  let lineRefused = false
  lineCtxs.forEach((ctx, i) => {
    attach[`line[${i}].MATH_INT`] = operandEvidence(ctx.bindings, ['RATE_APPLIED', 'CLAIMED_QUANTITY'])
    const amt = ctx.bindings.CLAIMED_AMOUNT
    const why = refusedDetail(refusedLines[i]!, 'CLAIMED_AMOUNT')
    if (why !== undefined) { lineRefused = true; lineProblems.push(`line_items[${i}]: ${why}`) }
    else if (amt && num(amt) !== null) lineAmounts.push({ ...amt, field: amt.field.replace('[*]', `[${i}]`) })
    else lineProblems.push(`line_items[${i}]: amount missing or unparseable`)
  })

  // LINE_ITEMS_SUM = Σ line amounts (only when every line contributed a number — otherwise the sum would lie)
  const lineCount = Array.isArray(extraction.line_items) ? extraction.line_items.length : 0
  const misKeyed = strict && lineCount === 0 ? nearMissArrayKey(extraction, INVOICE_ONTOLOGY.lineArrayKeys ?? ['line_items']) : undefined
  if (misKeyed !== undefined) docAbsence.LINE_ITEMS_SUM = { reason: 'UNPARSEABLE', detail: `the line items were reported under the key ${JSON.stringify(misKeyed)}, which differs from "line_items" only by spaces or invisible characters: not read (correct the key and run the check again)` }
  else if (lineCount === 0) docAbsence.LINE_ITEMS_SUM = 'no line_items array on the extraction'
  else if (lineRefused) docAbsence.LINE_ITEMS_SUM = { reason: 'UNPARSEABLE', detail: lineProblems.join('; ') }
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
  const subtotalJunk = !readsJunkAsAbsent && unparseable(B.SUBTOTAL)
  // (engine 0.6.0: a refused value's own reason, which says why it does not read, is appended; empty below 0.6.0)
  const why = (role: keyof Refusals): string => { const d = refusedDetail(refusedDoc, role); return d === undefined ? '' : `: ${d}` }
  const subtotalAbsence = subtotalJunk
    ? { reason: 'UNPARSEABLE' as const, detail: `SUBTOTAL is present but is not a number (${shown(B.SUBTOTAL)})${why('SUBTOTAL')}` }
    : refusedDoc.SUBTOTAL ?? 'SUBTOTAL not present on the extraction'
  const junk = readsJunkAsAbsent ? [] : (['TAX_AMOUNT', 'SERVICE_CHARGE', 'DISCOUNT_AMOUNT'] as const).filter(r => unparseable(B[r]))
  // Engine 0.6.0: an addend refused by a near-miss key is not absent, so it is never read as 0 (empty below 0.6.0)
  const misKeyedAddends = (['TAX_AMOUNT', 'SERVICE_CHARGE', 'DISCOUNT_AMOUNT'] as const).filter(r => !B[r] && refusedDoc[r] !== undefined)
  if (subtotal === null || !B.SUBTOTAL) {
    docAbsence.EXPECTED_GRAND_TOTAL = subtotalAbsence
  } else if (misKeyedAddends.length > 0) {
    docAbsence.EXPECTED_GRAND_TOTAL = { reason: 'UNPARSEABLE', detail: `${misKeyedAddends.map(r => refusedDetail(refusedDoc, r)).join('; ')}; so the expected total cannot be computed (a refused addend is never read as 0)` }
  } else if (junk.length > 0) {
    docAbsence.EXPECTED_GRAND_TOTAL = {
      reason: 'UNPARSEABLE',
      detail: `${junk.map(r => `${r} (${shown(B[r])})`).join(', ')} present but not a number${junk.some(r => refusedDoc[r] !== undefined) ? ` (${junk.map(r => refusedDetail(refusedDoc, r)).filter(Boolean).join('; ')})` : ''}, so the expected total cannot be computed (it is never read as 0)`,
    }
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
  if (subtotal === null || !B.SUBTOTAL) docAbsence.EXPECTED_TAX_AMOUNT = subtotalAbsence
  else if (!readsJunkAsAbsent && unparseable(B.TAX_RATE)) docAbsence.EXPECTED_TAX_AMOUNT = { reason: 'UNPARSEABLE', detail: `TAX_RATE is present but is not a number (${shown(B.TAX_RATE)})${why('TAX_RATE')}` }
  else if (rate === null || !B.TAX_RATE) docAbsence.EXPECTED_TAX_AMOUNT = refusedDoc.TAX_RATE ?? 'TAX_RATE not present on the extraction'
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
  remedyByCode: INVOICE_REMEDIES,
  referenceRoles: {
    contract: ['RATE_CONTRACTED', 'CONTRACTED_LIMIT', 'CONTRACT_START', 'CONTRACT_END'],
    evidence: ['ACTUAL_QUANTITY', 'VERIFIED_AMOUNT', 'EVIDENCE_DESCRIPTION'],
    history: [],
  },
  computedRoles: ['LINE_ITEMS_SUM', 'EXPECTED_GRAND_TOTAL', 'EXPECTED_TAX_AMOUNT', 'LINE_ITEM_TOTAL', 'EXPECTED_TOTAL'],
  // Rounding policy (0.1.0): a 0.03% band over the $0.01 floor, capped at what rounding can produce on the claim (U × k,
  // see src/tolerance.ts). A penny never false-alarms; $2,500 on a $10M line is never "rounding".
  defaultTolerance: CAPPED,
  ambiguityGuards: [['RATE_SUP', 'RATE_CONTRACTED'], ['AMT_CAP', 'CONTRACTED_LIMIT']],
  compute: makeCompute(false),
  // every engine after 0.7.0 (2026-10-13): explanations in a controller's words, never the kernel's rule names (./words.ts)
  finish: (claims, ctx) => explainInWords(claims, ctx.engine),
}

/**
 * Invoice ruleset 0.0.1, retained so a verdict issued under it can be re-performed. It differs from 0.1.0 in two rules. Its
 * tolerance: the 0.03% band was uncapped, so the amount it forgave grew with the document (a red-team case: $2,500 on a $10M
 * line PASSed as rounding). And it read a tax, service charge or discount that would not parse as 0. Never the default;
 * resolve it as 'invoice@0.0.1'.
 */
export const INVOICE_RULESET_V0_0_1: Ruleset = { ...INVOICE_RULESET, version: '0.0.1', defaultTolerance: PRACTITIONER, compute: makeCompute(true) }

export default INVOICE_RULESET
