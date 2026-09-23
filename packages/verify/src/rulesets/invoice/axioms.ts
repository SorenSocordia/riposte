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
