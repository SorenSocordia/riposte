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
import type { RemedySpec, RemedyTable } from '../../verdict/remedy.js'

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

/**
 * Remedies, declared next to the laws (2026-10-02; docs/REMEDIES.md). Read from what actually makes each law fail: a pay
 * application is kicked back for its arithmetic, corrected by the contractor, or certified at a corrected amount by the
 * person who certifies it (the architect, on AIA G702). Overbilling past a line's scheduled value is answered by a change
 * order or a corrected application, never by a ruling. Can't-tell claims take the remedies their insufficiency implies
 * (verdict/remedy.ts), except the bare percent below.
 */
const certifier = (what: string): RemedySpec => ({ kind: 'authority', authority: 'certifier',
  detail: `The person who certifies the application (the architect, on AIA G702) may certify ${what} for this application only.` })

export const PAY_APP_REMEDIES: RemedyTable = {
  G703_TOTAL: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'COMPLETED_TO_DATE', path: 'line[{line}].completed_to_date' },
        detail: 'Line {line}: previous + this period + stored materials is {expected}; column G says {asserted}. Re-read columns D, E, F and G; if the application is wrong, the contractor corrects it.' },
      certifier('the amount the line\'s arithmetic supports'),
    ],
  },
  G703_BAL: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'BALANCE_TO_FINISH', path: 'line[{line}].balance_to_finish' },
        detail: 'Line {line}: scheduled value − completed to date is {expected}; column H says {asserted}. Re-read columns C, G and H.' },
      certifier('the corrected balance'),
    ],
  },
  G703_PCT: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'PERCENT_COMPLETE', path: 'line[{line}].percent_complete' },
        detail: 'Line {line}: completed ÷ scheduled value is {expected}; the percent column says {asserted}. Re-read columns C, G and the percent.' },
    ],
    abstain: [
      { kind: 'transform', transform: 'declare-unit', operand: { source: 'pay-app', role: 'PERCENT_COMPLETE', path: 'line[{line}].percent_complete' }, when: ['AMBIGUOUS_UNIT'],
        detail: 'Line {line}: the percent complete is a bare number between 0 and 1, which reads two ways (that many percent, or that fraction of the whole). Send it as a whole number (45) or with a percent sign ("45%").' },
    ],
  },
  G703_CAP: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'contract', role: 'SCHEDULED_VALUE', path: 'line[{line}].scheduled_value' },
        detail: 'Line {line} bills {asserted} to date against a scheduled value of {expected}. An approved change order raising this line\'s scheduled value is the lawful way to bill more; the application is then checked as a new verdict.' },
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'COMPLETED_TO_DATE', path: 'line[{line}].completed_to_date' },
        detail: 'Otherwise the contractor bills no more than the scheduled value on line {line}.' },
    ],
  },
  G703_PREV: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'history', role: 'PREVIOUS_COMPLETED_TO_DATE' },
        detail: 'Line {line} says {asserted} from previous applications; the previous application shows {expected} completed to date. Supply the previous application as certified, if another one is the previous.' },
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'WORK_PREVIOUS', path: 'line[{line}].previous' },
        detail: 'Otherwise correct column D of line {line} to the previous application\'s completed to date.' },
    ],
  },
  G702_CSUM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'CONTRACT_SUM_TO_DATE', path: 'contract_sum_to_date' },
        detail: 'Original contract sum + net change orders is {expected}; line 3 says {asserted}. Re-read lines 1, 2 and 3.' },
      { kind: 'missing-operand', operand: { source: 'contract', role: 'NET_CHANGE_ORDERS', path: 'net_change_orders' },
        detail: 'If a change order is approved but missing from line 2, supply it: the application is then checked as a new verdict.' },
    ],
  },
  G702_SOV: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'CONTRACT_SUM_TO_DATE', path: 'contract_sum_to_date' },
        detail: 'The scheduled values sum to {expected}; line 3 says {asserted}. A schedule line missing from the extraction, or a change order not yet distributed into the schedule, is the usual cause.' },
      certifier('against the schedule as it stands'),
    ],
  },
  G702_DONE: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'TOTAL_COMPLETED_STORED', path: 'total_completed_and_stored' },
        detail: 'Column G sums to {expected}; line 4 says {asserted} (off by {variance}). Re-read line 4 and every line\'s column G.' },
      certifier('the amount the continuation sheet supports'),
    ],
  },
  G702_RSUM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'RETAINAGE_TOTAL', path: 'total_retainage' },
        detail: 'The line retainage sums to {expected}; line 5 says {asserted}. Re-read line 5 and column I.' },
      certifier('the retainage the lines support'),
    ],
  },
  G702_RATE: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'contract', role: 'RETAINAGE_RATE', path: 'retainage_rate' },
        detail: 'Line 4 × the retainage rate is {expected}; line 5 says {asserted}. Contracts often retain at another rate on stored materials, or less after a milestone: supply the retainage terms that apply.' },
      { kind: 'authority', authority: 'owner',
        detail: 'The owner may accept the retainage as stated, for this application only.' },
    ],
  },
  G702_EARN: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'TOTAL_EARNED_LESS_RETAINAGE', path: 'total_earned_less_retainage' },
        detail: 'Line 4 − line 5 is {expected}; line 6 says {asserted}. Re-read lines 4, 5 and 6.' },
      certifier('the amount lines 4 and 5 support'),
    ],
  },
  G702_DUE: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'CURRENT_PAYMENT_DUE', path: 'current_payment_due' },
        detail: 'Line 6 − line 7 is {expected}; the payment due (line 8) says {asserted}. Re-read lines 6, 7 and 8.' },
      certifier('the payment lines 6 and 7 support'),
    ],
  },
  G702_BAL: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'BALANCE_INCL_RETAINAGE', path: 'balance_to_finish_including_retainage' },
        detail: 'Line 3 − line 6 is {expected}; line 9 says {asserted}. Re-read lines 3, 6 and 9.' },
      certifier('the corrected balance'),
    ],
  },
  G702_PREV: {
    fail: [
      { kind: 'missing-operand', operand: { source: 'history', role: 'PREVIOUS_EARNED_LESS_RETAINAGE' },
        detail: 'Line 7 says {asserted}; the previous application\'s total earned less retainage is {expected}. Line 7 follows what was previously certified, which can differ from what was applied for: supply the previous application as certified.' },
      { kind: 'recompute-with', operand: { source: 'pay-app', role: 'PREVIOUS_CERTIFICATES', path: 'less_previous_certificates' },
        detail: 'Otherwise correct line 7 to the previous certificate.' },
    ],
  },
}

/** A remedy whose words name a continuation-sheet line, counting it as a person does ({position}: line[3] reads "line 4"). */
const countedFromOne = (s: RemedySpec): RemedySpec => ({ ...s, detail: s.detail.replace(/\b([Ll]ine) \{line\}/g, '$1 {position}') })

/**
 * The remedy table engine 0.6.0 answers from (2026-10-05). Under 0.6.0 a FAILed line claim says its line as a
 * person counts it ("previous on line 4 is ..."), so its remedies must too: every detail that said "line {line}" (the index,
 * "line 3") says "line {position}". Operand paths keep {line}, the index into the array. Engines up to 0.5.0 keep
 * PAY_APP_REMEDIES: their claims name no line of their own, and "line 3" there agrees with the claim id line[3], so their
 * verdict ids and remedies re-perform byte for byte. Only the G702 document rules' fixed line numbers (lines 1 to 9 of the
 * form) are left as written: those are the form's own line numbers, not array positions. Later the same day:
 * G702_RATE gains can't-tell remedies (RATE_ABSTAIN_V060), so 0.6.0 pay-app verdict ids moved again.
 */
const V060_COUNTED: RemedyTable = Object.fromEntries(Object.entries(PAY_APP_REMEDIES).map(([rule, r]) => [rule, {
  ...(r.fail ? { fail: r.fail.map(countedFromOne) } : {}),
  ...(r.abstain ? { abstain: r.abstain.map(countedFromOne) } : {}),
}]))

/**
 * G702_RATE's can't-tell remedies under engine 0.6.0 (2026-10-05). From 0.6.0 the stated retainage rate is read
 * as a ceiling (index.ts compute): retainage under it that the lines' own retainage (column I) accounts for passes, naming each
 * line that retains less; retainage under it that the application's figures do not account for is a person's decision
 * (AMBIGUOUS_REFERENCE), answered by the owner or by the lines' retainage; no rate and no column I (FIELD_MISSING), by the rate.
 */
/*
 * 2026-10-05: the stated rate applies, and a line retains less only where the application says so (index.ts
 * retainageV060). The AMBIGUOUS_REFERENCE missing-operand remedy names those statements: it said column I alone settled it,
 * which no longer holds. This moved the 0.6.0 pay-app remedy_table_hash, and so its verdict ids (repinned by hand).
 */
/*
 * 2026-10-06: the remedies name the G702's own split (lines 5a and 5b: one rate on completed work, another on stored material),
 * which the application states as retainage_rate { completed_work, stored_materials } (index.ts statedSplit). A cold reader
 * could not find where to supply it. This moved the 0.6.0 pay-app remedy_table_hash, and so its verdict ids (repinned by hand).
 */
const RATE_FAIL_V060: RemedySpec = { kind: 'missing-operand', operand: { source: 'contract', role: 'RETAINAGE_RATE', path: 'retainage_rate' },
  detail: 'Line 4 × the retainage rate is {expected}; line 5 says {asserted}. Contracts often retain at another rate on stored materials (the G702\'s lines 5a and 5b: retainage_rate as { "completed_work": "10%", "stored_materials": "0%" }), or less after a milestone (reduced_retainage_rate): supply the retainage terms that apply.' }
const RATE_ABSTAIN_V060: RemedySpec[] = [
  { kind: 'authority', authority: 'owner', when: ['AMBIGUOUS_REFERENCE'],
    detail: 'The owner confirms the retainage terms allow the lower retainage on this application (a reduction after a milestone, or on completed work), for this application only.' },
  { kind: 'missing-operand', operand: { source: 'pay-app', role: 'RETAINAGE_RATE', path: 'reduced_retainage_rate' }, when: ['AMBIGUOUS_REFERENCE'],
    detail: 'Where the application states the lower retainage: the G702\'s own split, one rate on completed work and another on stored materials (retainage_rate as { "completed_work": "10%", "stored_materials": "0%" }, lines 5a and 5b); the reduced rate it states for the period (reduced_retainage_rate, with reduced_retainage_items naming the lines it covers); or each such line\'s own rate (retainage_rate on the schedule line), with every line\'s retainage (column I) adding up to the total retainage: the retainage is then read again, as a new verdict.' },
  { kind: 'missing-operand', operand: { source: 'contract', role: 'RETAINAGE_RATE', path: 'retainage_rate' }, when: ['FIELD_MISSING'],
    detail: 'The retainage rate (retainage_rate, for example "10%"), or each schedule line\'s retainage (column I): the retainage is then checked as a new verdict.' },
]

/*
 * 2026-10-06: the continuity checks' can't-tell remedies. G703_PREV and G702_PREV now also read a line new this
 * month, a changed scheduled value, the form's own column D convention and the original contract sum (index.ts continuityOf,
 * previousReading); a person decides when the application does not account for a change, and the owner answers it. Before,
 * these claims took the remedies their insufficiency implies, which printed the internal role name ("supply
 * PREVIOUS_COMPLETED_TO_DATE: the rule cannot run without it") and named no one. This moved the 0.6.0 pay-app remedy_table_hash,
 * and so its verdict ids (repinned by hand).
 */
const LAST_MONTH: RemedySpec = { kind: 'missing-operand', operand: { source: 'history' }, when: ['REFERENCE_NOT_PROVIDED'],
  detail: 'Last month\'s application, as history (--history <last-month.json>): the continuity checks then run.' }
const PREV_ABSTAIN_V060: RemedySpec[] = [
  // 2026-10-06: also the change order the application itself marks pending or unapproved (index.ts unapprovedMark)
  { kind: 'authority', authority: 'owner', when: ['AMBIGUOUS_REFERENCE'],
    detail: 'The owner confirms what line {position} carries over from last month\'s application, or approves the change order it bills (a change order the application marks pending or unapproved, a line renumbered since, or which of two lines with one item number is this one), for this application only.' },
  { kind: 'missing-operand', operand: { source: 'pay-app', path: 'change_orders' }, when: ['AMBIGUOUS_REFERENCE'],
    detail: 'The change order that accounts for it, stated on the application (change_orders: its number, amount and item_no; or change_order_amount on the line), or last month\'s application as certified, if another one is the previous: the application is then checked as a new verdict.' },
  LAST_MONTH,
  { kind: 'missing-operand', operand: { source: 'history' }, when: ['FIELD_MISSING', 'UNPARSEABLE'],
    detail: 'Last month\'s application with line {position}\'s item number and its completed to date (column G), readable: the line\'s previous work is then compared with it.' },
]
const PREV_DOC_ABSTAIN_V060: RemedySpec[] = [
  { kind: 'authority', authority: 'owner', when: ['AMBIGUOUS_REFERENCE'],
    detail: 'The owner confirms the contract sum carried over from last month\'s application (a change order that changed it, or a line one removed), for this application only.' },
  LAST_MONTH,
  { kind: 'missing-operand', operand: { source: 'history' }, when: ['FIELD_MISSING', 'UNPARSEABLE'],
    detail: 'Last month\'s application with its total earned less retainage (line 6), readable: line 7 is then compared with it.' },
]

export const PAY_APP_REMEDIES_V060: RemedyTable = {
  ...V060_COUNTED,
  G702_RATE: { ...V060_COUNTED.G702_RATE, fail: [RATE_FAIL_V060, ...(V060_COUNTED.G702_RATE!.fail ?? []).slice(1)], abstain: RATE_ABSTAIN_V060 },
  G703_PREV: { ...V060_COUNTED.G703_PREV, abstain: PREV_ABSTAIN_V060 },
  G702_PREV: { ...V060_COUNTED.G702_PREV, abstain: PREV_DOC_ABSTAIN_V060 },
}
