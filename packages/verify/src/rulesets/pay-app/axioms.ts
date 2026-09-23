/**
 * Construction pay application (AIA G702 / G703) — the laws of the form.
 *
 * G703 continuation sheet, per schedule-of-values line (columns A–I):
 *   G703_TOTAL  G = D + E + F        total completed and stored to date = previous + this period + stored
 *   G703_BAL    H = C − G            balance to finish
 *   G703_PCT    G ÷ C = % complete   (tolerance ½ of one percent — the column is printed rounded)
 *   G703_CAP    G ≤ C                no line is billed past its scheduled value
 *   G703_PREV   D = previous application's G for the same item   (needs the previous application — history)
 *
 * G702 application and certificate for payment (lines 1–9):
 *   G702_CSUM   line 3 = line 1 + line 2      contract sum to date = original + net change orders
 *   G702_SOV    line 3 = Σ column C           the schedule of values must add up to the contract sum
 *   G702_DONE   line 4 = Σ column G           total completed & stored must equal the continuation sheet
 *   G702_RSUM   line 5 = Σ column I           total retainage must equal the sum of line retainage (when lines carry it)
 *   G702_RATE   line 5 = line 4 × rate        retainage must equal the stated percentage of completed work
 *   G702_EARN   line 6 = line 4 − line 5      total earned less retainage
 *   G702_DUE    line 8 = line 6 − line 7      current payment due
 *   G702_BAL    line 9 = line 3 − line 6      balance to finish, including retainage
 *   G702_PREV   line 7 = previous application's line 6           (history)
 *
 * The predicate engine compares two bound roles; every right-hand side above is bound as a COMPUTED role by the
 * ruleset's compute() with provenance naming its operands. The STATED figure is always on the left, so the
 * verdict's `asserted` is what the document says and `variance` is stated − expected.
 *
 * Siteline (2026): "15% of our pay apps were kicked back for math errors" — each kick-back a full billing cycle.
 * Every one of those is one of the fourteen lines above.
 */

import type { ComputationalAxiom } from '../../kernel/types.js'

/** One cent. */
export const CURRENCY_TOLERANCE = 0.01
/** Half of one percent, as a fraction: the % column on a G703 is printed rounded to a whole percent. */
export const PERCENT_TOLERANCE = 0.005

const D = ['pay-app']

function law(
  code: string, id: string, name: string, statement: string, formal: string,
  left: ComputationalAxiom['predicates'][number]['leftRole'],
  operator: ComputationalAxiom['predicates'][number]['operator'],
  right: ComputationalAxiom['predicates'][number]['rightRole'],
  tolerance: number,
  severity: ComputationalAxiom['severity'],
): ComputationalAxiom {
  return {
    id, shortCode: code, name, axiomStatement: statement, formalForm: formal,
    predicates: [{ leftRole: left, operator, rightRole: right, tolerance, description: statement }],
    requiredRoles: right ? [left, right] : [left],
    combinationLogic: 'AND', detectableBy: 'PRECOMPUTE', severity, applicableDomains: D,
  }
}

// ---------------------------------------------------------------- G703 — per line
export const G703_TOTAL = law('G703_TOTAL', 'ax-payapp-g703-total', 'Law of the Continuation Sheet',
  'Total completed and stored to date must equal previous work plus this period plus stored materials',
  'G = D + E + F', 'COMPLETED_TO_DATE', '=', 'EXPECTED_COMPLETED_TO_DATE', CURRENCY_TOLERANCE, 'high')

export const G703_BAL = law('G703_BAL', 'ax-payapp-g703-balance', 'Law of the Balance to Finish',
  'Balance to finish must equal scheduled value minus total completed and stored',
  'H = C − G', 'BALANCE_TO_FINISH', '=', 'EXPECTED_BALANCE_TO_FINISH', CURRENCY_TOLERANCE, 'medium')

export const G703_PCT = law('G703_PCT', 'ax-payapp-g703-percent', 'Law of the Percentage',
  'Percent complete must equal total completed and stored divided by scheduled value',
  '% = G ÷ C', 'PERCENT_COMPLETE', '=', 'EXPECTED_PERCENT_COMPLETE', PERCENT_TOLERANCE, 'low')

export const G703_CAP = law('G703_CAP', 'ax-payapp-g703-cap', 'Law of No Overbilling',
  'Total completed and stored to date may not exceed the scheduled value',
  'G ≤ C', 'COMPLETED_TO_DATE', '<=', 'SCHEDULED_VALUE', CURRENCY_TOLERANCE, 'critical')

export const G703_PREV = law('G703_PREV', 'ax-payapp-g703-previous', 'Law of Continuity',
  'Work completed from previous applications must equal the previous application\'s total completed and stored for the same item',
  'D = G(previous application)', 'WORK_PREVIOUS', '=', 'PREVIOUS_COMPLETED_TO_DATE', CURRENCY_TOLERANCE, 'high')

// ---------------------------------------------------------------- G702 — document
export const G702_CSUM = law('G702_CSUM', 'ax-payapp-g702-contract-sum', 'Law of the Contract Sum',
  'Contract sum to date must equal the original contract sum plus net change by change orders',
  'line 3 = line 1 + line 2', 'CONTRACT_SUM_TO_DATE', '=', 'EXPECTED_CONTRACT_SUM_TO_DATE', CURRENCY_TOLERANCE, 'high')

export const G702_SOV = law('G702_SOV', 'ax-payapp-g702-sov', 'Law of the Schedule of Values',
  'The scheduled values on the continuation sheet must sum to the contract sum to date',
  'line 3 = Σ C', 'CONTRACT_SUM_TO_DATE', '=', 'SOV_SCHEDULED_SUM', CURRENCY_TOLERANCE, 'high')

export const G702_DONE = law('G702_DONE', 'ax-payapp-g702-completed', 'Law of the Carried Total',
  'Total completed and stored to date must equal the sum of the continuation sheet\'s column G',
  'line 4 = Σ G', 'TOTAL_COMPLETED_STORED', '=', 'SOV_COMPLETED_SUM', CURRENCY_TOLERANCE, 'critical')

export const G702_RSUM = law('G702_RSUM', 'ax-payapp-g702-retainage-sum', 'Law of Retainage (carried)',
  'Total retainage must equal the sum of line-level retainage',
  'line 5 = Σ I', 'RETAINAGE_TOTAL', '=', 'SOV_RETAINAGE_SUM', CURRENCY_TOLERANCE, 'high')

export const G702_RATE = law('G702_RATE', 'ax-payapp-g702-retainage-rate', 'Law of Retainage (rate)',
  'Total retainage must equal the stated retainage percentage of total completed and stored',
  'line 5 = line 4 × rate', 'RETAINAGE_TOTAL', '=', 'EXPECTED_RETAINAGE_TOTAL', CURRENCY_TOLERANCE, 'high')

export const G702_EARN = law('G702_EARN', 'ax-payapp-g702-earned', 'Law of Earnings',
  'Total earned less retainage must equal total completed and stored minus total retainage',
  'line 6 = line 4 − line 5', 'TOTAL_EARNED_LESS_RETAINAGE', '=', 'EXPECTED_EARNED_LESS_RETAINAGE', CURRENCY_TOLERANCE, 'critical')

export const G702_DUE = law('G702_DUE', 'ax-payapp-g702-due', 'Law of the Payment Due',
  'Current payment due must equal total earned less retainage minus previous certificates for payment',
  'line 8 = line 6 − line 7', 'CURRENT_PAYMENT_DUE', '=', 'EXPECTED_CURRENT_PAYMENT_DUE', CURRENCY_TOLERANCE, 'critical')

export const G702_BAL = law('G702_BAL', 'ax-payapp-g702-balance', 'Law of the Balance (including retainage)',
  'Balance to finish including retainage must equal contract sum to date minus total earned less retainage',
  'line 9 = line 3 − line 6', 'BALANCE_INCL_RETAINAGE', '=', 'EXPECTED_BALANCE_INCL_RETAINAGE', CURRENCY_TOLERANCE, 'medium')

export const G702_PREV = law('G702_PREV', 'ax-payapp-g702-previous', 'Law of the Previous Certificate',
  'Previous certificates for payment must equal the previous application\'s total earned less retainage',
  'line 7 = line 6(previous application)', 'PREVIOUS_CERTIFICATES', '=', 'PREVIOUS_EARNED_LESS_RETAINAGE', CURRENCY_TOLERANCE, 'high')

export const PAY_APP_LINE_AXIOMS: readonly ComputationalAxiom[] = [G703_TOTAL, G703_BAL, G703_PCT, G703_CAP, G703_PREV]
export const PAY_APP_DOCUMENT_AXIOMS: readonly ComputationalAxiom[] = [
  G702_CSUM, G702_SOV, G702_DONE, G702_RSUM, G702_RATE, G702_EARN, G702_DUE, G702_BAL, G702_PREV,
]
export const PAY_APP_AXIOMS: readonly ComputationalAxiom[] = [...PAY_APP_LINE_AXIOMS, ...PAY_APP_DOCUMENT_AXIOMS]
