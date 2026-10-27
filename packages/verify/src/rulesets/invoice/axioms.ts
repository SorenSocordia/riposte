/**
 * Invoice footing axioms — the headline checks.
 *
 * Document-level coherence: do the numbers on this invoice, AS EXTRACTED, agree with each other?
 *
 * The predicate engine compares two bound roles. Arithmetic compositions are therefore bound as
 * COMPUTED roles by the entry point (src/index.ts), each with provenance naming its operands:
 *   LINE_ITEMS_SUM       = Σ line_items[i].CLAIMED_AMOUNT
 *   EXPECTED_GRAND_TOTAL = SUBTOTAL + TAX_AMOUNT − DISCOUNT_AMOUNT   (absent tax/discount → 0, recorded)
 *   EXPECTED_TAX_AMOUNT  = SUBTOTAL × TAX_RATE
 *
 * These verdicts are about the EXTRACTION's coherence, not the paper's. If a developer's extractor
 * produced a grand total that exceeds the subtotal with no tax or discount extracted, that is a real
 * FAIL of the data as given — the extraction does not cohere — and the evidence trail says exactly why.
 *
 * Tolerance: CURRENCY_TOLERANCE (one cent) absorbs a single rounding step (half-up vs banker's on a
 * computed tax; cents-rounded line amounts summed). It does not absorb "in thousands" scaling or
 * cross-currency mixes — those are normalizer/abstention concerns, not footing failures.
 */

import type { ComputationalAxiom } from '../../kernel/types.js'
import type { AxiomRegistry } from '../../kernel/axiom-registry.js'
import type { RemedyTable } from '../../verdict/remedy.js'

/** One cent. Documented per-rule in the ruleset and emitted in each verdict's computation.tolerance. */
export const CURRENCY_TOLERANCE = 0.01

/**
 * AX-SUM_INT: Law of Footing
 * The line items must sum to the stated subtotal.
 */
export const SUM_INTEGRITY: ComputationalAxiom = {
  id: 'ax-inv-sum-int',
  shortCode: 'SUM_INT',
  name: 'Law of Footing',
  axiomStatement: 'The line item amounts must sum to the stated subtotal',
  formalForm: 'Σ line_items[i].amount = subtotal',
  predicates: [
    {
      leftRole: 'LINE_ITEMS_SUM',
      operator: '=',
      rightRole: 'SUBTOTAL',
      tolerance: CURRENCY_TOLERANCE,
      description: 'Sum of line item amounts must equal the stated subtotal',
    },
  ],
  requiredRoles: ['LINE_ITEMS_SUM', 'SUBTOTAL'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['invoice'],
}

/**
 * AX-TOTAL_INT: Law of the Bottom Line
 * The stated grand total must equal subtotal + tax − discount.
 */
export const TOTAL_INTEGRITY: ComputationalAxiom = {
  id: 'ax-inv-total-int',
  shortCode: 'TOTAL_INT',
  name: 'Law of the Bottom Line',
  axiomStatement: 'The stated grand total must equal subtotal plus tax minus discount',
  formalForm: 'grand_total = subtotal + tax − discount',
  predicates: [
    {
      leftRole: 'GRAND_TOTAL',
      operator: '=',
      rightRole: 'EXPECTED_GRAND_TOTAL',
      tolerance: CURRENCY_TOLERANCE,
      description: 'Stated grand total must equal the computed subtotal + tax − discount',
    },
  ],
  requiredRoles: ['GRAND_TOTAL', 'EXPECTED_GRAND_TOTAL'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: ['invoice'],
}

/**
 * AX-TAX_INT: Law of the Levy
 * The stated tax must equal subtotal × rate (within one rounding step).
 */
export const TAX_INTEGRITY: ComputationalAxiom = {
  id: 'ax-inv-tax-int',
  shortCode: 'TAX_INT',
  name: 'Law of the Levy',
  axiomStatement: 'The stated tax amount must equal the subtotal multiplied by the stated tax rate',
  formalForm: 'tax = subtotal × tax_rate',
  predicates: [
    {
      leftRole: 'TAX_AMOUNT',
      operator: '=',
      rightRole: 'EXPECTED_TAX_AMOUNT',
      tolerance: CURRENCY_TOLERANCE,
      description: 'Stated tax must equal subtotal × rate within one cent',
    },
  ],
  requiredRoles: ['TAX_AMOUNT', 'EXPECTED_TAX_AMOUNT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['invoice'],
}

/** The invoice ruleset's document-level axioms, in evaluation order. */
export const INVOICE_AXIOMS: readonly ComputationalAxiom[] = [
  SUM_INTEGRITY,
  TOTAL_INTEGRITY,
  TAX_INTEGRITY,
]

/** Short codes of every axiom the invoice ruleset evaluates (document-level + the engine's per-line core). */
export const INVOICE_CORE_CODES: readonly string[] = [
  'SUM_INT', 'TOTAL_INT', 'TAX_INT',          // document-level footing (this file)
  'MATH_INT',                                 // per line: amount = rate × qty
  'RATE_SUP', 'AMT_CAP', 'TIME_ORD',          // cross-document, need a contract reference
  'QTY_MATCH',                                // cross-document, needs evidence
  'DUP_PROHIB',                               // needs prior_claim_ids supplied
]

/** Register the invoice axioms into a registry instance (idempotent — register() overwrites by id). */
export function registerInvoiceAxioms(registry: AxiomRegistry): void {
  for (const axiom of INVOICE_AXIOMS) registry.register(axiom)
}

/**
 * Remedies, declared next to the laws (2026-10-02; docs/REMEDIES.md). What lawfully answers each rule's FAIL, read from what
 * actually makes it fail. Can't-tell claims take the remedies their own insufficiency implies (verdict/remedy.ts) unless a
 * rule declares its own. A remedy never changes a verdict: re-reading or supplying an operand is a new check, and a ruling
 * covers this verdict only.
 */
export const INVOICE_REMEDIES: RemedyTable = {
  SUM_INT: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', role: 'SUBTOTAL', path: 'subtotal' },
        detail: 'The line amounts sum to {asserted}; the subtotal says {expected} (the lines are off by {variance}). Re-read the subtotal and every line amount: a dropped, doubled or misread line is the usual cause.' },
      { kind: 'authority', authority: 'ap-supervisor',
        detail: 'If the document itself does not foot, a person with AP authority may rule to proceed on it as stated, or send it back to the vendor for a corrected one. The ruling covers this verdict only.' },
    ],
  },
  TOTAL_INT: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', role: 'GRAND_TOTAL', path: 'total' },
        detail: 'Subtotal + tax + service charge − discount is {expected}; the total says {asserted} (off by {variance}). Re-read the total, the tax, any service charge and any discount.' },
      { kind: 'missing-operand', operand: { source: 'invoice', role: 'SERVICE_CHARGE', path: 'service_charge' },
        detail: 'A charge the total includes but the extraction did not carry (shipping, handling, a fee) closes the gap only if the document states it: extract it as service_charge.' },
      { kind: 'transform', transform: 'tax-inclusive-subtotal', operand: { source: 'invoice', role: 'SUBTOTAL', path: 'subtotal' },
        detail: 'If the document says its prices include tax, read the subtotal as tax-inclusive, so the tax is not added twice.' },
      { kind: 'authority', authority: 'ap-supervisor',
        detail: 'A person with AP authority may rule to pay the total as stated, or send the invoice back. The ruling covers this verdict only.' },
    ],
  },
  TAX_INT: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', role: 'TAX_AMOUNT', path: 'tax' },
        detail: 'Subtotal × tax rate is {expected}; the tax says {asserted}. Re-read the tax and the rate.' },
      { kind: 'authority', authority: 'tax-reviewer',
        detail: 'The rule taxes the whole subtotal at one rate. Exempt lines, several rates or another taxable base are outside it: a person with tax authority rules, for this verdict only.' },
    ],
  },
  MATH_INT: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'invoice', path: 'line_items[{line}]' },
        detail: 'Line {line}: unit price × quantity is {expected}; the amount says {asserted}. Re-read the quantity, unit price and amount. A line discount or another unit of measure is the usual cause; if the document is wrong, the vendor reissues it.' },
      { kind: 'authority', authority: 'ap-supervisor',
        detail: 'A person with AP authority may accept line {line} as stated, for this verdict only.' },
    ],
  },
  RATE_SUP: {
    fail: [
      { kind: 'authority', authority: 'contract-owner',
        detail: 'Billed at {op:RATE_APPLIED} against the contracted {op:RATE_CONTRACTED}. The contract owner may approve the difference for this verdict only; that sets no new rate.' },
      { kind: 'missing-operand', operand: { source: 'contract', role: 'RATE_CONTRACTED' },
        detail: 'A contract amendment at the billed rate, supplied as the contract reference: the invoice is then checked as a new verdict.' },
    ],
  },
  AMT_CAP: {
    fail: [
      { kind: 'authority', authority: 'budget-owner',
        detail: 'The amount {asserted} is over the contracted limit {expected}. The budget owner may approve the overrun for this verdict only.' },
      { kind: 'missing-operand', operand: { source: 'contract', role: 'CONTRACTED_LIMIT' },
        detail: 'An amendment raising the limit, supplied as the contract reference: the invoice is then checked as a new verdict.' },
    ],
  },
  TIME_ORD: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'contract', role: 'CONTRACT_END' },
        detail: 'The service date {asserted} is outside the contract term. An extension or renewal that covers it, supplied as the contract reference, is checked as a new verdict.' },
      { kind: 'authority', authority: 'contract-owner',
        detail: 'The contract owner may approve work outside the term, for this verdict only.' },
    ],
  },
  QTY_MATCH: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'evidence', role: 'ACTUAL_QUANTITY' },
        detail: 'Billed {asserted}; the delivery evidence shows {expected}. Evidence for the remaining units (a later delivery ticket or receipt) is checked as a new verdict.' },
      { kind: 'authority', authority: 'buyer',
        detail: 'The buyer may approve paying units the evidence does not show, for this verdict only.' },
    ],
  },
  DUP_PROHIB: {
    abstain: [
      { kind: 'missing-operand', operand: { source: 'history', role: 'PRIOR_CLAIM_IDS', path: 'prior_invoice_ids' }, when: ['FIELD_MISSING'],
        detail: 'The invoice numbers already processed (prior_invoice_ids; an empty list means none), and the invoice number itself, so the duplicate check can run.' },
    ],
    fail: [
      { kind: 'authority', authority: 'ap-controller',
        detail: 'Invoice {asserted} is already in the history. Paying it again is lawful only if the earlier booking was voided or credited: the controller rules, for this verdict only.' },
    ],
  },
  DUP_NEAR: {
    fail: [
      { kind: 'authority', authority: 'ap-clerk',
        detail: 'A prior invoice number differs from {asserted} only by formatting or a revision suffix. A person confirms this is a new invoice, not a re-issue, for this verdict only.' },
    ],
  },
}
