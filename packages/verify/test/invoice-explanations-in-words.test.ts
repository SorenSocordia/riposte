/**
 * The invoice ruleset's explanations in a controller's words (2026-10-13; a cold reader's finding, 2026-10-12): the TOTAL_INT
 * claim said "Law of the Bottom Line: All predicates satisfied.", the kernel's name for the rule, in output a controller reads.
 * Under this engine every invoice explanation says what was checked ("total = subtotal + tax − discount") and the figures, a
 * check that could not run names what it was not given, and no explanation carries a rule's kernel name ("Law of …"), the
 * words "predicates" or "VIOLATED", or a binding role written in capitals. The rule's name stays in `rule_name`. A verdict of
 * an earlier engine keeps the text it was issued with and replays byte for byte.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, type Verdict } from '../src/index'
import { run, type CliIO } from '../src/cli'
import { cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
afterAll(() => cleanScratch())
type J = Record<string, any>

const invoice = JSON.parse(readFileSync(join(FX, 'invoice.json'), 'utf8')) as J
const JARGON = /\bLaw of\b|predicates|VIOLATED|missing bindings|\b[A-Z]+_[A-Z_]+\b/
const explanations = (v: Verdict): string[] => v.claims.map(c => String(c.explanation))

/** The door invoice and the reader's doctored copies: a wrong total, a wrong line amount, a contract to check rates against. */
function cases(): { name: string; v: Verdict }[] {
  const total = structuredClone(invoice); total.totals.total = Number(total.totals.total) + 5
  const line = structuredClone(invoice); line.line_items[0].amount = Number(line.line_items[0].amount) + 3
  const tax = structuredClone(invoice); tax.totals.tax = Number(tax.totals.tax) + 2
  const rounding = structuredClone(invoice); rounding.totals.tax = Number(rounding.totals.tax) + 0.01 // within the rounding band: a PASS
  const contract = { effective_date: '2026-01-01', expiration_date: '2026-12-31', max_amount: 1000, line_items: [{ description: invoice.line_items[0].description, unit_price: 100 }] }
  const evidence = [{ line_items: [{ description: invoice.line_items[0].description, quantity: 9 }] }]
  const dated = { ...structuredClone(invoice), dates: { service_date: '2027-03-01' } }
  return [
    { name: 'door', v: verify(invoice) },
    { name: 'total+5', v: verify(total) },
    { name: 'line0+3', v: verify(line) },
    { name: 'tax+2', v: verify(tax) },
    { name: 'tax+0.01 (rounding)', v: verify(rounding) },
    { name: 'contract', v: verify(invoice, { references: { contract } }) },
    { name: 'contract+evidence+date', v: verify(dated, { references: { contract, evidence } }) },
  ]
}

describe('this engine\'s invoice explanations', () => {
  it('TOTAL_INT says what was checked and the figures', () => {
    const c = verify(invoice).claims.find(x => x.rule_id === 'TOTAL_INT')!
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toContain('total = subtotal + tax − discount')
    expect(c.explanation).toContain('1,894.92')
    expect(c.explanation).not.toMatch(JARGON)
    expect(c.rule_name).toBe('Law of the Bottom Line') // the name stays an identifier
  })
  it('a FAIL names both figures and the difference', () => {
    const bad = structuredClone(invoice); bad.totals.total = Number(bad.totals.total) + 5
    const c = verify(bad).claims.find(x => x.rule_id === 'TOTAL_INT')!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toContain('total = subtotal + tax − discount')
    expect(c.explanation).toContain('1,899.92')
    expect(c.explanation).toContain('1,894.92')
    expect(c.explanation).toContain('5.00')
  })
  it('SUM_INT names the computed line sum as computed and the stated subtotal as the invoice\u0027s (2026-10-13: found by the Python second engine\u0027s port)', () => {
    const bad = structuredClone(invoice); bad.line_items[0].amount = Number(bad.line_items[0].amount) + 3 // the lines now sum to 3.00 more than the stated subtotal
    const c = verify(bad).claims.find(x => x.rule_id === 'SUM_INT')!
    expect(c.outcome).toBe('FAIL')
    const lines = Number(bad.line_items.reduce((s: number, l: J) => s + Number(l.amount), 0).toFixed(2)), stated = Number(bad.totals.subtotal)
    expect(c.explanation).toContain('subtotal = the sum of the line amounts: 1,753.50 computed, but the invoice says 1,750.50') // the lines are the computed figure
    expect(c.explanation).toContain('3.00')  })
  it('no explanation in any case carries a kernel name, "predicates", "VIOLATED" or a capitalised role', () => {
    for (const { name, v } of cases()) {
      for (const e of explanations(v)) expect(e, `${name}: ${e}`).not.toMatch(JARGON)
    }
  })
  it('a PASS within the rounding band keeps the rounding sentence and says the check in words', () => {
    const r = structuredClone(invoice); r.totals.tax = Number(r.totals.tax) + 0.01
    const c = verify(r).claims.find(x => x.rule_id === 'TAX_INT')!
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/^Within tolerance \(.*\): treated as rounding, not error\. tax = subtotal × tax rate: 144\.4163 computed, 144\.43 on the invoice\.$/)
  })
  it('a quantity is written as a count, not as money', () => {
    const evidence = [{ line_items: [{ description: invoice.line_items[0].description, quantity: 9 }] }]
    const c = verify(invoice, { references: { evidence } }).claims.find(x => x.claim_id === 'line[0].QTY_MATCH')!
    expect(c.explanation).toBe('quantity billed = quantity delivered does not hold: 10 on the invoice, 9 on the delivery record')
  })
  it('a check that could not run says what it was not given, in words', () => {
    const c = verify(invoice).claims.find(x => x.claim_id === 'line[0].RATE_SUP')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.explanation).toMatch(/^Can't tell whether the unit price is within the contract's rate: /)
  })
})

describe('an earlier engine\'s verdict keeps its words', () => {
  it('engine 0.6.0 still writes the kernel\'s text', () => {
    const c = verify(invoice, { engine: '0.6.0' }).claims.find(x => x.rule_id === 'TOTAL_INT')!
    expect(c.explanation).toBe('Law of the Bottom Line: All predicates satisfied.')
  })
  it('the reader\'s engine 0.6.0 verdict replays VERIFIED, byte for byte', () => {
    let out = '', err = ''
    const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
    expect(run(['replay', join(FX, 'verdict.json'), '--extraction', join(FX, 'invoice.json')], io)).toBe(0)
    expect(err.split('\n')[0]).toMatch(/^verify replay: outcome VERIFIED: /)
    expect(JSON.parse(out).outcome_verified).toBe(true)
  })
})
