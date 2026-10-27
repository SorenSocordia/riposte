/**
 * 2026-10-05: the BUILT-IN rulesets read strictly under engine 0.6.0 (src/rulesets/strict.ts), closing
 * red-team F6 (garbled amounts coerced), F14 (locale guessed by position, a space group truncated) and F15 (a near-miss key
 * downgraded silently) for `invoice` and `pay-app`; the pay-app wrapped-document message and plain-word findings.
 *
 *   1. strictNumberText: what reads, what is refused, and why
 *   2. invoice: every red-team string reproduces under an engine before 0.6.0 and is refused under 0.6.0; controls still read
 *   3. near-miss keys are refused by name; a refused addend or blank cell is never read as 0
 *   4. pay-app: the same; a wrapped document says where the schedule of values is; FAIL findings in plain words, rule ids kept
 *   5. docs/examples/payapp-g702-g703.json verifies clean against its previous application
 *
 * `under(engine)` hands the engine to the ruleset's compute() and runs its finish() the way verify() does from engine 0.6.0.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verify, INVOICE_RULESET, PAY_APP_RULESET, type Verdict } from '../src/index'
import type { Ruleset } from '../src/rulesets/types'
import { strictNumberText } from '../src/rulesets/strict'
import { plainMoney } from '../src/rulesets/pay-app/index'

const NOW = () => new Date('2026-10-05T00:00:00Z')
type J = Record<string, unknown>
const under = (rs: Ruleset, engine: '0.5.0' | '0.6.0') => (x: J, history?: J[]): Verdict => {
  const seam: Ruleset = { ...rs, compute: (input) => rs.compute({ ...input, engine }) }
  const v = verify(x, { ruleset: seam, now: NOW, engine, ...(history ? { references: { history } } : {}) })
  rs.finish?.(v.claims, { engine })
  return v
}
const inv5 = under(INVOICE_RULESET, '0.5.0'), inv6 = under(INVOICE_RULESET, '0.6.0')
const pay5 = under(PAY_APP_RULESET, '0.5.0'), pay6 = under(PAY_APP_RULESET, '0.6.0')
const claim = (v: Verdict, id: string) => v.claims.find((c) => c.claim_id === id)!
const line = (amount: unknown) => ({ description: 'Widget', quantity: 1, unit_price: typeof amount === 'number' ? amount : 100, amount })

describe('1. strictNumberText', () => {
  it('reads plain, grouped and marked numbers whole', () => {
    for (const [raw, v] of [['1234.56', 1234.56], ['$1,234.56', 1234.56], ['1.234,56 €', 1234.56], ['USD 2,695.00', 2695], ['(12.50)', -12.5], ['0.125', 0.125], ['1234.5678', 1234.5678], ['1,234,567', 1234567]] as const) {
      expect(strictNumberText(raw, 'amount'), raw).toEqual({ ok: true, value: v })
    }
    expect(strictNumberText('8.25%', 'rate')).toEqual({ ok: true, value: 0.0825 })
  })
  it('refuses a garble, an ambiguous grouping and a space group, saying why', () => {
    for (const raw of ['$1OO.O0', '°225.0', 'E 2O', '1,2?5.00']) expect(strictNumberText(raw, 'amount'), raw).toMatchObject({ ok: false, why: 'it holds characters that are not part of a number' })
    for (const raw of ['1 234', '1\u00a0234', '1\u202f234,50']) expect(strictNumberText(raw, 'amount'), raw).toMatchObject({ ok: false, why: expect.stringContaining('space-grouped') })
    for (const raw of ['1.234', '1,234']) expect(strictNumberText(raw, 'amount'), raw).toMatchObject({ ok: false, why: expect.stringContaining('three digits') })
    expect(strictNumberText('1,23', 'amount')).toMatchObject({ ok: false, why: expect.stringContaining('single comma') })
  })
})

describe('2. invoice: F6 and F14 reproduce before 0.6.0 and are refused under it', () => {
  const cases: [string, J, string][] = [
    ['F6 "$1OO.O0" as the total', { invoice_number: 'I-1', line_items: [line(1)], subtotal: 1, total: '$1OO.O0' }, 'document.TOTAL_INT'],
    ['F14 "1 234" as the total', { invoice_number: 'I-2', line_items: [line(1)], subtotal: 1, total: '1 234' }, 'document.TOTAL_INT'],
    ['F14 "1\\u00a0234" as the total', { invoice_number: 'I-3', line_items: [line(1)], subtotal: 1, total: '1\u00a0234' }, 'document.TOTAL_INT'],
    ['F14 "1.234" as the total', { invoice_number: 'I-4', line_items: [line(1234)], subtotal: 1234, total: '1.234' }, 'document.TOTAL_INT'],
    ['F14 "1,23" as the total', { invoice_number: 'I-5', line_items: [line(1.23)], subtotal: 1.23, total: '1,23' }, 'document.TOTAL_INT'],
    ['F6 "$1OO.O0" as a line amount', { invoice_number: 'I-6', line_items: [{ description: 'W', quantity: 1, unit_price: 1, amount: '$1OO.O0' }], subtotal: 1, total: 1 }, 'line[0].MATH_INT'],
  ]
  for (const [label, x, id] of cases) {
    it(label, () => {
      expect(claim(inv5(x), id).outcome, 'engine 0.5.0 coerces it (the red-team finding)').toBe('PASS')
      const c = claim(inv6(x), id)
      expect(c.outcome).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency!.reason).toBe('UNPARSEABLE')
      expect(c.asserted, 'the value as reported, never the guess').toBe(x.total === 1 ? (x.line_items as J[])[0]!.amount : x.total)
    })
  }
  it('F6 "°225.0" as the tax: the expected total is not computed (never 225, never 0)', () => {
    const x = { invoice_number: 'I-7', line_items: [{ description: 'W', quantity: 59, unit_price: 100, amount: 5900 }], subtotal: 5900, tax: '°225.0', total: 6125 }
    expect(claim(inv5(x), 'document.TOTAL_INT').outcome).toBe('PASS')
    const d = claim(inv6(x), 'document.TOTAL_INT').insufficiency!
    expect(d.reason).toBe('UNPARSEABLE')
    expect(d.detail).toContain('tax is "°225.0", which does not read as one number (it holds characters that are not part of a number)')
    expect(d.detail).toContain('never read as 0')
  })
  it('a refused line amount makes the line sum UNPARSEABLE, naming the line and the value', () => {
    const x = { invoice_number: 'I-6', line_items: [{ description: 'W', quantity: 1, unit_price: 1, amount: '$1OO.O0' }], subtotal: 1, total: 1 }
    expect(claim(inv6(x), 'document.SUM_INT').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('line_items[0].amount is "$1OO.O0", which does not read as one number') })
  })
  it('controls still read and decide: a grouped total, a percent rate, JSON numbers', () => {
    const a = inv6({ invoice_number: 'I-8', line_items: [line(1234.56)], subtotal: 1234.56, total: '$1,234.56' })
    expect(claim(a, 'document.TOTAL_INT').outcome).toBe('PASS')
    const b = inv6({ invoice_number: 'I-9', line_items: [line(100)], subtotal: 100, tax: 8.25, tax_rate: '8.25%', total: 108.25 })
    expect([claim(b, 'document.TAX_INT').outcome, claim(b, 'document.TOTAL_INT').outcome]).toEqual(['PASS', 'PASS'])
    const c = inv6({ invoice_number: 'I-10', line_items: [line(100)], subtotal: 100, tax: 10, total: 999 })
    expect(claim(c, 'document.TOTAL_INT').outcome).toBe('FAIL')
  })
})

describe('2b. the document\'s own number format: declared, or settled by its unambiguous values; otherwise ambiguous stays unreadable', () => {
  it('an EU invoice settles its format by "1.250,00": "625,00 €" and "237,50" read (the EU fixture of test/fixtures/invoices.ts still passes)', () => {
    const eu = { invoice_number: 'INV-EU-7', currency: 'EUR', line_items: [{ description: 'Widget', quantity: '2', unit_price: '625,00 €', amount: '1.250,00 €' }], totals: { subtotal: '1.250,00', tax_rate: '19%', tax: '237,50', total: '1.487,50' } }
    const v = inv6(eu)
    expect(['document.SUM_INT', 'document.TAX_INT', 'document.TOTAL_INT', 'line[0].MATH_INT'].map((id) => claim(v, id).outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
  })
  it('"75,000" alone is unreadable, and says how to settle it; declared "number_locale": "en" reads it as 75000', () => {
    const x = { invoice_number: 'R-1', line_items: [{ description: 'Nasi', quantity: 1, unit_price: '75,000', amount: '75,000' }], subtotal: '75,000', total: '75,000' }
    const c = claim(inv6(x), 'document.SUM_INT')
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('nothing in the document settles its number format (declare "number_locale": "en" or "de", or send JSON numbers)') })
    const y = inv6({ ...x, number_locale: 'en' })
    expect([claim(y, 'document.SUM_INT').outcome, claim(y, 'line[0].MATH_INT').outcome]).toEqual(['PASS', 'PASS'])
    expect(claim(y, 'document.SUM_INT').computation!.result).toBe(75000)
    const z = inv6({ ...x, number_locale: 'de' }) // 75,000 in de is 75 with three decimals: still consistent, read as 75
    expect(claim(z, 'document.SUM_INT').computation!.result).toBe(75)
  })
  it('a declared "fr" reads a space group whole ("1 234" is 1234): the explicit grouping rule; undeclared it stays unreadable', () => {
    const x = { invoice_number: 'F-1', line_items: [line(1234)], subtotal: 1234, total: '1 234' }
    expect(claim(inv6(x), 'document.TOTAL_INT').outcome).toBe('INSUFFICIENT_DATA')
    const y = claim(inv6({ ...x, number_locale: 'fr' }), 'document.TOTAL_INT')
    expect([y.outcome, y.asserted]).toEqual(['PASS', 1234])
  })
  it('a document that mixes both formats, or names an unknown format, settles nothing, and says so', () => {
    const mixed = inv6({ invoice_number: 'M-1', line_items: [{ description: 'W', quantity: 1, unit_price: '1,234.50', amount: '1.234,50' }], subtotal: '1,234', total: 1234.5 })
    expect(claim(mixed, 'document.SUM_INT').insufficiency!.reason).toBe('UNPARSEABLE')
    expect(claim(mixed, 'document.TOTAL_INT').insufficiency!.detail).toContain('the document mixes both number formats')
    const unknown = inv6({ invoice_number: 'U-1', line_items: [line(1)], subtotal: 1, total: '1,234', number_locale: 'xx' })
    expect(claim(unknown, 'document.TOTAL_INT').asserted).toBe('1,234')
    expect(claim(unknown, 'document.SUM_INT').outcome).toBe('PASS')
  })
})

describe('3. F15: near-miss keys are refused by name; a refused addend is never 0', () => {
  it('"total " (trailing space): named, UNPARSEABLE, not a bare FIELD_MISSING', () => {
    const x = { invoice_number: 'I-11', line_items: [line(100)], subtotal: 100, tax: 10, 'total ': 999 }
    expect(claim(inv5(x), 'document.TOTAL_INT').insufficiency!.reason).toBe('FIELD_MISSING')
    expect(claim(inv6(x), 'document.TOTAL_INT').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('reported under the key "total ", which is not its path "total"') })
  })
  it('"tax " (trailing space): engine 0.5.0 read the tax as 0 and passed; 0.6.0 refuses to compute the total', () => {
    const x = { invoice_number: 'I-12', line_items: [line(100)], subtotal: 100, 'tax ': 10, total: 100 }
    expect(claim(inv5(x), 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(claim(inv6(x), 'document.TOTAL_INT').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('a refused addend is never read as 0') })
  })
  it('a zero-width space inside a line key, and a near-miss line-array key, are named', () => {
    const v = inv6({ invoice_number: 'I-13', line_items: [{ description: 'W', quantity: 1, unit_price: 5, 'am\u200bount': 5 }], subtotal: 5, total: 5 })
    expect(claim(v, 'line[0].MATH_INT').insufficiency!.detail).toContain('"line_items[0].am\u200bount"')
    const w = inv6({ invoice_number: 'I-14', 'line_items ': [line(5)], subtotal: 5, total: 5 })
    expect(claim(w, 'document.SUM_INT').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('reported under the key "line_items "') })
  })
})

const payapp = (over: J = {}): J => ({
  application_number: 2, original_contract_sum: 95000, net_change_orders: 5000, contract_sum_to_date: 100000,
  schedule_of_values: [
    { item_no: '1', description: 'Mobilization', scheduled_value: 10000, previous: 10000, this_period: 0, materials_stored: 0, completed_to_date: 10000, percent_complete: 100, balance_to_finish: 0, retainage: 1000 },
    { item_no: '2', description: 'Concrete', scheduled_value: 90000, previous: 20000, this_period: 30000, materials_stored: 0, completed_to_date: 50000, percent_complete: '55.6%', balance_to_finish: 40000, retainage: 5000 },
  ],
  total_completed_and_stored: 60000, retainage_rate: '10%', total_retainage: 6000, total_earned_less_retainage: 54000,
  less_previous_certificates: 27000, current_payment_due: 27000, balance_to_finish_including_retainage: 46000, ...over,
})

describe('4. pay-app under engine 0.6.0', () => {
  it('a clean application still passes every footing law', () => {
    expect(pay6(payapp()).outcome).toBe('PASS')
    expect(pay6(payapp()).claims.filter((c) => c.outcome === 'FAIL')).toEqual([])
  })
  it('F6/F14: a garbled payment due and a space-grouped retainage are refused, never 27 or 6', () => {
    const a = payapp({ current_payment_due: '$27,OOO.00' })
    expect(claim(pay5(a), 'document.G702_DUE')).toMatchObject({ outcome: 'FAIL', asserted: 27 })
    expect(claim(pay6(a), 'document.G702_DUE')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', asserted: '$27,OOO.00', insufficiency: { reason: 'UNPARSEABLE' } })
    const b = payapp({ total_retainage: '6 000' })
    expect(claim(pay5(b), 'document.G702_RSUM')).toMatchObject({ outcome: 'FAIL', asserted: 6 })
    expect(claim(pay6(b), 'document.G702_RSUM').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(pay6(b), 'document.G702_EARN').insufficiency!.detail).toContain('total_retainage is "6 000", which does not read as one number')
  })
  it('F15: a near-miss key is named; a refused blank-means-zero cell or line is never read as 0', () => {
    const p = payapp(); delete p.total_retainage; p['total_retainage '] = 6000
    expect(claim(pay6(p), 'document.G702_RSUM').insufficiency!.detail).toContain('reported under the key "total_retainage "')
    const q = payapp({ less_previous_certificates: '27,OOO' })
    expect(claim(pay6(q), 'document.G702_DUE').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('never read as the form\'s blank (0)') })
    const r = payapp(); (r.schedule_of_values as J[])[1]!.this_period = '3O,000'
    expect(claim(pay6(r), 'line[1].G703_TOTAL').insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('schedule_of_values[1].this_period is "3O,000"') })
  })
  it('a wrapped application says where the schedule of values is, on every check, instead of nine "no array"', () => {
    const wrapped = { ruleset: 'pay-app', extraction: payapp(), references: { history: [] } }
    expect(pay5(wrapped).claims.filter((c) => c.insufficiency?.detail.includes('no schedule-of-values array on the extraction')).length).toBeGreaterThan(0)
    const v = pay6(wrapped)
    expect(v.claims.length).toBe(9)
    for (const c of v.claims) {
      expect(c.outcome).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency!.detail).toBe('the extraction looks wrapped: the schedule_of_values array is under "extraction.schedule_of_values"; pass the inner object ("extraction") as the extraction, and its "references" as the references (--history for a previous application)')
    }
    const deep = pay6({ pay_app: { g703: { ...payapp() } } })
    expect(deep.claims[0]!.insufficiency!.detail).toContain('under "pay_app.g703.schedule_of_values"; pass the inner object ("pay_app.g703")')
  })
  it('FAIL findings in plain words, the rule ids and numbers unchanged; engine 0.5.0 keeps "Law of … VIOLATED"', () => {
    const bad = payapp({ total_retainage: 5200, total_earned_less_retainage: 54800, current_payment_due: 27800, balance_to_finish_including_retainage: 45200 })
    const old = claim(pay5(bad), 'document.G702_RSUM')
    expect(old.explanation).toMatch(/^Law of Retainage \(carried\) VIOLATED/)
    const now = claim(pay6(bad), 'document.G702_RSUM')
    expect(now.rule_id).toBe('G702_RSUM')
    expect([now.asserted, now.computation!.result]).toEqual([old.asserted, old.computation!.result])
    expect(now.explanation).toBe('line retainage adds to 6,000 but the total says 5,200')
    const prev = payapp(); (prev.schedule_of_values as J[])[1]!.completed_to_date = 45000
    const cur = payapp(); (cur.schedule_of_values as J[])[1]!.previous = 20000
    expect(claim(pay6(cur, [{ ...prev, application_number: 1 }]), 'line[1].G703_PREV').explanation)
      .toBe('previous on line 2 is 20,000, which does not match last month\'s completed to date for that item, 45,000')
  })
  it('plainMoney groups thousands and shows cents only when there are any', () => {
    expect([plainMoney(6200), plainMoney(6200.5), plainMoney(-1234567.891), plainMoney(0)]).toEqual(['6,200', '6,200.50', '-1,234,567.89', '0'])
  })
})

describe('4b. end to end through plain verify() (src/verify.ts hands the engine to compute() and runs finish())', () => {
  it('the default invoice ruleset: "$1OO.O0" is UNPARSEABLE under the default engine and 1 under engine 0.5.0', () => {
    const x = { invoice_number: 'I-1', line_items: [line(1)], subtotal: 1, total: '$1OO.O0' }
    expect(claim(verify(x, { now: NOW }), 'document.TOTAL_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', asserted: '$1OO.O0' })
    expect(claim(verify(x, { now: NOW, engine: '0.5.0' }), 'document.TOTAL_INT')).toMatchObject({ outcome: 'PASS', asserted: 1 })
  })
  it('pay-app: a wrapped application is named, and a FAIL reads in plain words; engine 0.5.0 unchanged', () => {
    const wrapped = verify({ ruleset: 'pay-app', extraction: payapp() }, { ruleset: 'pay-app', now: NOW })
    expect(wrapped.claims.every((c) => c.insufficiency?.detail.startsWith('the extraction looks wrapped'))).toBe(true)
    const bad = payapp({ total_retainage: 5200, total_earned_less_retainage: 54800, current_payment_due: 27800, balance_to_finish_including_retainage: 45200 })
    expect(claim(verify(bad, { ruleset: 'pay-app', now: NOW }), 'document.G702_RSUM').explanation).toBe('line retainage adds to 6,000 but the total says 5,200')
    expect(claim(verify(bad, { ruleset: 'pay-app', now: NOW, engine: '0.5.0' }), 'document.G702_RSUM').explanation).toMatch(/^Law of Retainage \(carried\) VIOLATED/)
  })
})

describe('5. docs/examples/payapp-g702-g703.json', () => {
  const EX = join(__dirname, '..', 'docs', 'examples')
  const cur = JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.json'), 'utf8')) as J
  const prev = JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.previous.json'), 'utf8')) as J
  it('verifies clean against its previous application under both engines: all 44 checks PASS', () => {
    for (const run of [pay5, pay6]) {
      const v = run(cur, [prev])
      expect(v.outcome).toBe('PASS')
      expect(v.claims.length).toBe(44)
      expect(v.claims.every((c) => c.outcome === 'PASS')).toBe(true)
    }
  })
  it('the previous application is itself clean (its continuity checks are the ones that need history)', () => {
    const v = pay6(prev)
    expect(v.claims.filter((c) => c.outcome === 'FAIL')).toEqual([])
    expect(v.claims.filter((c) => c.outcome === 'INSUFFICIENT_DATA').every((c) => c.insufficiency!.reason === 'REFERENCE_NOT_PROVIDED')).toBe(true)
  })
})
