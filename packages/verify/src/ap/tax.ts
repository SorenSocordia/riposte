/**
 * The tax check (engine 0.6.0, 2026-10-05), structured path only (./structured.ts). Engines up to
 * 0.5.0 have no such claim, and a bill that carries no `tax` field gets none either, so those verdicts are unchanged.
 *
 * Why. A $1,490 tax line on a $9,940 bill, against a purchase order carrying no tax terms, was approved: the total check adds
 * the bill's tax into the total (it checks the bill's arithmetic, not whether the tax is due), and nothing else read the tax.
 *
 * What the purchase order states (riposte.ap-input/0.1.0, additive, optional, 2026-10-05):
 *   purchase_order.tax_rate                a fraction from 0 to 1 (0.0825 is 8.25%); 0 states that no tax is due
 *   purchase_order.line_items[].taxable    false: the line is not taxed; absent or true: taxed, when the order states a rate
 *
 * The claim `ap.tax` (rule AP_TAX), only when the bill carries `tax`:
 *   no tax billed (0)                         PASS, saying so (and the order's rate, when it states one)
 *   a negative tax                            a person decides (AMBIGUOUS_FIELD): a credit or a correction a person reads
 *   tax billed; the order states no tax terms a person decides (FIELD_MISSING), naming the amount. Silent is not zero: an order
 *                                             written without tax terms may still owe tax, so a person, never a hold
 *   tax billed; the order states a rate of 0  FAIL, decided as hold_total (the bill's total carries an amount the order does
 *                                             not allow, as freight the order rules out does): an order that states no tax is
 *                                             due is answered by the buyer, never by a guess
 *   tax billed; the order states a rate       expected = rate × the taxable lines (each bill line whose PO line is not marked
 *                                             taxable: false; a bill line that matches no PO line is counted as taxed). Within
 *                                             rounding of it: PASS. Otherwise a person decides (AMBIGUOUS_REFERENCE), with both
 *                                             figures and the difference
 * Rounding (2026-10-06) is one minor unit per taxable line (a cent each on a USD bill), at least one: a vendor that rounds each
 * line's tax, up or to the nearest, stays inside it. Before, the tax was checked within the price tolerance (2% unless set), so
 * $38.69 of extra tax on a $24,685.00 order taxed at 8.25% was approved; the price tolerance is for unit prices, not tax.
 * Freight is never in the taxable base. Deterministic; no I/O.
 */
import type { ClaimVerdict, Evidence, InsufficiencyReason } from '../verdict/schema.js'
import type { RuleRemedies } from '../verdict/remedy.js'
import { moneyWords } from './words.js'

export const AP_TAX_RULE = { id: 'AP_TAX', name: 'Tax billed is what the purchase order allows' } as const
const FORMULA = 'bill.tax = purchase_order.tax_rate × Σ taxable line amounts (within rounding: one minor unit per taxable line)'

export interface TaxInput {
  /** the bill's tax, in major units */
  tax: number
  /** the order's stated rate (a fraction), or null when it states none */
  rate: number | null
  /**
   * Engine 0.6.0: the run's tax policy (`ap --tax`, a pilot's frozen `tax`), read only when the order states
   * no rate: 'allow' accepts the tax as billed (PASS, saying it was not checked against a rate); { rate } checks the tax against
   * that rate as a stated rate is checked, a person deciding when it is off (never a hold: the order itself states nothing).
   */
  policy?: 'allow' | { rate: number }
  /** each bill line's amount and whether its PO line is taxed (true when unmarked or unmatched) */
  lines: readonly { amount: number; taxable: boolean }[]
  minor_digits: number
  taxEvidence: Evidence
  rateEvidence: Evidence | null
  lineEvidence: readonly Evidence[]
  /**
   * Engine 0.7.0, the text path: the invoice line the tax was read from. A purchase order there states its rate in words
   * ("Tax: 8.25%"), so a tax line on one that states none reads "tax line present, PO states no rate", naming the line.
   */
  textLine?: { line: number; text: string }
}

const pct = (r: number): string => `${Math.round(r * 1e6) / 1e4}%`
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6

export function taxClaim(x: TaxInput): ClaimVerdict {
  const M = (n: number): string => moneyWords(n, x.minor_digits)
  const unit = 10 ** -x.minor_digits
  const base = { claim_id: 'ap.tax', kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: 'tax', rule_id: AP_TAX_RULE.id, rule_name: AP_TAX_RULE.name }
  const evidence = [x.taxEvidence, ...(x.rateEvidence ? [x.rateEvidence] : [])]
  const open = (reason: InsufficiencyReason, detail: string, operands: Record<string, number | string | null>, result: number | null, more: Evidence[] = [], missing?: string[]): ClaimVerdict => ({
    ...base, outcome: 'INSUFFICIENT_DATA', asserted: x.tax, computation: { formula: FORMULA, operands, result }, evidence: [...evidence, ...more],
    insufficiency: { reason, detail, ...(missing ? { missing } : {}) }, locked: false, explanation: detail,
  })
  if (Math.abs(x.tax) < unit / 2) {
    return { ...base, outcome: 'PASS', asserted: x.tax, computation: { formula: FORMULA, operands: { tax: x.tax, tax_rate: x.rate }, result: x.rate === null ? null : 0 }, evidence, locked: true,
      explanation: `No tax is billed${x.rate === null ? '' : `; the purchase order states a tax rate of ${pct(x.rate)}`}.` }
  }
  if (x.tax < 0) return open('AMBIGUOUS_FIELD', `the bill carries a negative tax, ${M(x.tax)}: a credit or a correction a person reads before the bill is paid`, { tax: x.tax, tax_rate: x.rate }, null)
  // 2026-10-06: the run's tax policy, only where the order states no tax terms
  if (x.rate === null && x.policy === 'allow') {
    return { ...base, outcome: 'PASS', asserted: x.tax, computation: { formula: FORMULA, operands: { tax: x.tax, tax_rate: null, tax_policy: 'allow' }, result: null }, evidence, locked: true,
      explanation: `Tax ${M(x.tax)} is billed; the purchase order states no tax terms, and this run's tax policy (--tax allow) accepts tax as billed: it was not checked against a rate.` }
  }
  const byPolicy = x.rate === null && x.policy !== undefined && x.policy !== 'allow'
  if (x.rate === null && !byPolicy && x.textLine) {
    return open('FIELD_MISSING', `tax line present, PO states no rate: tax ${M(x.tax)} is billed (invoice line ${x.textLine.line}, "${x.textLine.text}"), and the purchase order states no tax rate; a person confirms the tax is due on this order before the bill is paid`,
      { tax: x.tax, tax_rate: null }, null, [], ['purchase_order.tax_rate'])
  }
  if (x.rate === null && !byPolicy) {
    return open('FIELD_MISSING', `tax ${M(x.tax)} is billed, and the purchase order states no tax terms (no tax_rate): a person confirms the tax is due on this order before the bill is paid`,
      { tax: x.tax, tax_rate: null }, null, [], ['/purchase_order/tax_rate'])
  }
  if (x.rate === 0) {
    return { ...base, outcome: 'FAIL', asserted: x.tax, computation: { formula: FORMULA, operands: { tax: x.tax, tax_rate: 0 }, result: 0 }, evidence, locked: true, variance: x.tax,
      explanation: `tax ${M(x.tax)} is billed, but the purchase order states a tax rate of 0%: no tax is due on this order` }
  }
  const rate = byPolicy ? (x.policy as { rate: number }).rate : x.rate as number
  /** whose rate: the order's, or the run's (with the flag a reader can find) */
  const whose = byPolicy ? `this run's tax rate, ${pct(rate)} (--tax rate:${pct(rate)}; the purchase order states no tax terms),` : pct(rate)
  const taxable = x.lines.map((l, i) => ({ ...l, i })).filter((l) => l.taxable)
  const baseAmount = r6(taxable.reduce((s, l) => s + l.amount, 0))
  const exact = r6(baseAmount * rate)
  // 2026-10-06: the expected tax to the minor unit, and rounding as the only tolerance (one minor unit per taxable line)
  const expected = r6(Math.round(exact / unit) * unit)
  const allowed = r6(Math.max(taxable.length, 1) * unit)
  const off = r6(x.tax - expected)
  const operands = { tax: x.tax, tax_rate: rate, taxable_lines: baseAmount, exact_tax: exact, rounding: allowed, ...(byPolicy ? { tax_policy: 'rate' } : {}) }
  const more = taxable.map((l) => x.lineEvidence[l.i]!).filter(Boolean)
  const notAll = taxable.length < x.lines.length ? ` (${x.lines.length - taxable.length} line${x.lines.length - taxable.length === 1 ? '' : 's'} marked not taxable left out)` : ''
  const per = `${M(unit)} per taxable line`
  if (Math.abs(off) <= allowed + 1e-9) {
    return { ...base, outcome: 'PASS', asserted: x.tax, computation: { formula: FORMULA, operands, result: r6(expected), tolerance: { abs: allowed } }, evidence: [...evidence, ...more], locked: true,
      explanation: `Tax ${M(x.tax)} is billed: ${whose} of the taxable lines, ${M(baseAmount)}${notAll}, is ${M(expected)}${Math.abs(off) >= unit / 2 ? ` (${off > 0 ? 'over' : 'under'} by ${M(Math.abs(off))}, within rounding: ${per}, ${M(allowed)} on this bill)` : ''}.` }
  }
  return open('AMBIGUOUS_REFERENCE', `tax ${M(x.tax)} is billed, but ${whose} of the taxable lines, ${M(baseAmount)}${notAll}, is ${M(expected)}: ${off > 0 ? 'over' : 'under'} by ${M(Math.abs(off))}, more than rounding allows (${per}, ${M(allowed)} on this bill); a person confirms the tax before the bill is paid`,
    operands, r6(expected), more)
}

/**
 * The structured path's "Not checked" line about tax on an approve (2026-10-06), or null when the tax was checked against
 * the order's own rate. `tax` is the bill's tax (null when it carries none), `rate` the order's stated rate.
 */
export function taxNotChecked(x: { tax: number | null; rate: number | null; policy: 'allow' | { rate: number } | null }): string | null {
  if (x.rate !== null) return null
  if (x.tax === null || x.tax === 0) return 'tax: none is billed, and the purchase order states no tax terms, so whether tax was due was not checked'
  if (x.policy === 'allow') return "tax: accepted as billed under this run's tax policy (--tax allow); it was not checked against a rate"
  if (x.policy !== null) return `tax: checked against this run's tax rate (--tax rate:${pct(x.policy.rate)}), not the purchase order's, which states no tax terms`
  return null
}

/** Remedies for AP_TAX (engine 0.6.0's AP table, ./index.ts AP_REMEDIES_V060). The buyer owns the order's terms. */
export const TAX_REMEDIES: RuleRemedies = {
  fail: [
    { kind: 'authority', authority: 'buyer',
      detail: 'Tax {asserted} is billed on an order whose purchase order states no tax is due (tax rate 0). The buyer may accept the tax for this verdict only (a tax the order did not foresee), or the vendor reissues the bill without it.' },
    { kind: 'missing-operand', operand: { source: 'purchase_order', path: '/purchase_order/tax_rate' },
      detail: 'A purchase order change stating the tax rate that applies: the bill is then checked as a new verdict.' },
  ],
  abstain: [
    { kind: 'missing-operand', operand: { source: 'purchase_order', path: '/purchase_order/tax_rate' }, when: ['FIELD_MISSING'],
      detail: 'The purchase order\'s tax terms (tax_rate, a fraction such as 0.0825 for 8.25%, or 0 when no tax is due): the tax is then checked against them as a new verdict.' },
    { kind: 'authority', authority: 'buyer', when: ['FIELD_MISSING', 'AMBIGUOUS_REFERENCE'],
      detail: 'The buyer confirms the tax billed is due on this order, for this verdict only.' },
    { kind: 'recompute-with', operand: { source: 'invoice', path: '/bill/tax' }, when: ['AMBIGUOUS_REFERENCE'],
      detail: 'Re-read the bill\'s tax; if the vendor applied another rate or base than the order\'s, the vendor reissues the bill.' },
    { kind: 'authority', authority: 'ap-supervisor', when: ['AMBIGUOUS_FIELD'],
      detail: 'A person with AP authority reads the negative tax on the bill (a credit or a correction), for this verdict only.' },
  ],
}
