/**
 * A replay says when today's default rule reads an older verdict's inputs differently, for every ruleset (2026-10-06;
 * src/protocol/rule-now.ts), and the replay's failure lines lead (cold review round 6, an outside engineer).
 *
 *  - The engineer changed a shipped e-invoice extraction's amount currency to USD on a EUR invoice and issued it under the still
 *    selectable peppol-en16931@0.1.0: PASS-WITH-OPEN. Its replay printed "outcome VERIFIED ... byte-identical", exit 0, with no
 *    warning, though today's default peppol-en16931@0.3.0 FAILs it on the currency. The replay still re-performs it under its
 *    own rule (exit 0) and now adds the labelled line "under today's default peppol-en16931@0.3.0 this invoice reads FAIL
 *    (currency)"; the JSON carries it as rule_now.
 *  - `--require-ruleset` printed the VERIFIED line first and failed after it; the FAILED line now leads.
 *  - A verdict with one added field diverged with a hint about rounding-tolerance overrides, which cannot add a field; the
 *    hint now appears only where an override can move the difference.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, verifyDeclarative, verifyReplay } from '../src/index'
import { resolveDeclarativeRuleset } from '../src/rulesets/declarative'
import { todayReading, renderTodayReading, checkLabel } from '../src/protocol/rule-now'
import { run, type CliIO } from '../src/cli'

const dir = mkdtempSync(join(tmpdir(), 'rule-now-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const NOW = () => new Date('2026-10-06T00:00:00Z')

/** The engineer's peppol-usd.json: the shipped N18 snippet with amount_currency changed to USD on a EUR invoice. */
const PEPPOL_USD = {
  invoice_number: 'Snippet1', issue_date: '2017-11-13', due_date: '2017-12-01', currency: 'EUR', seller_name: 'SupplierOfficialName Ltd', buyer_name: 'Buyer Official Name',
  line_extension_amount: 5900, tax_inclusive_amount: 7125, prepaid_amount: 1000, payable_amount: 6125, amount_currency: 'USD',
  lines: [
    { id: '1', item_name: 'item name', invoiced_quantity: 10, price_amount: 410, line_extension_amount: 4000, base_quantity: 1, line_allowance_amount: 101, line_charge_amount: 1 },
    { id: '2', item_name: 'item name', invoiced_quantity: 10, price_amount: 200, line_extension_amount: 1000, base_quantity: 2 },
    { id: '3', item_name: 'item name', invoiced_quantity: 10, price_amount: 100, line_extension_amount: 900, line_allowance_amount: 101, line_charge_amount: 1 },
  ],
  vat_breakdown: [{ rate: 25, taxable_amount: 4900, tax_amount: 1225, row: 1 }, { category: 'E', rate: 0, taxable_amount: 1000, tax_amount: 0, row: 2 }],
}

function go(argv: string[]): { code: number; out: string; err: string } {
  let out = '', err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err }
}

describe('today\'s default reading, for a declarative ruleset', () => {
  const old = resolveDeclarativeRuleset('peppol-en16931@0.1.0')!
  const v = verifyDeclarative(PEPPOL_USD, old, { now: NOW })
  const inputs = { extraction: PEPPOL_USD, ruleset: old }

  it('a check label from a rule id', () => {
    expect([checkLabel('R051_CURRENCY'), checkLabel('BRCO14_VAT_SUM'), checkLabel('LINE_MATH_INT'), checkLabel(undefined)]).toEqual(['currency', 'vat sum', 'line math', undefined])
  })
  it('the 0.1.0 verdict reads PASS-WITH-OPEN; under today\'s default 0.3.0 the invoice reads FAIL (currency)', () => {
    expect(v.gate_status).toBe('PASS_WITH_OPEN')
    const r = todayReading(v, inputs)!
    expect(r).toMatchObject({ ruleset: 'peppol-en16931@0.3.0', noun: 'invoice', gate: 'FAIL', gate_recorded: 'PASS_WITH_OPEN' })
    expect(r.claims).toContainEqual({ claim_id: 'document.R051_CURRENCY', was: null, now: 'FAIL', why: 'currency' })
    const lines = renderTodayReading(r, v.engine_version)
    expect(lines[0]).toMatch(/^under today's default peppol-en16931@0\.3\.0 this invoice reads FAIL \(currency\), not PASS-WITH-OPEN; \d checks read differently:$/)
    expect(lines).toContain('  document.R051_CURRENCY reads FAIL (currency); the recorded rule has no such check')
  })
  it('a verdict under today\'s default, by this engine, has no such reading', () => {
    const today = resolveDeclarativeRuleset('peppol-en16931')!
    expect(todayReading(verifyDeclarative(PEPPOL_USD, today, { now: NOW }), { extraction: PEPPOL_USD, ruleset: today })).toBeUndefined()
  })
  it('the replay itself is unchanged: re-performed under 0.1.0, byte-identical', () => {
    expect(verifyReplay(v, inputs).status).toBe('REPERFORMED')
  })
})

describe('today\'s default reading, for a built-in ruleset under an older engine', () => {
  it('an engine-0.5.0 invoice verdict whose total "$1OO.O0" today\'s engine refuses says so', () => {
    const x = { invoice_number: 'I-1', line_items: [{ description: 'W', quantity: 1, unit_price: 1, amount: 1 }], subtotal: 1, total: '$1OO.O0' }
    const v = verify(x, { now: NOW, engine: '0.5.0' })
    const r = todayReading(v, { extraction: x, references: { contract: null, evidence: [], history: [] }, source: null })
    expect(r).toBeDefined()
    expect(r!.engine).toBe('0.7.2')
    expect(renderTodayReading(r!, '0.5.0')[0]).toContain('(engine 0.7.2)')
    expect(r!.claims.some(c => c.claim_id === 'document.TOTAL_INT' && c.now === 'INSUFFICIENT_DATA')).toBe(true)
  })
})

describe('the command line', () => {
  const old = resolveDeclarativeRuleset('peppol-en16931@0.1.0')!
  const v = verifyDeclarative(PEPPOL_USD, old, { now: NOW })
  const vf = join(dir, 'v010.json'), xf = join(dir, 'peppol-usd.json')
  writeFileSync(vf, JSON.stringify(v))
  writeFileSync(xf, JSON.stringify(PEPPOL_USD))

  it('replay: VERIFIED, exit 0, and the line about today\'s default rule; rule_now in the JSON', () => {
    const r = go(['replay', vf, '--extraction', xf, '--ruleset', 'peppol-en16931@0.1.0'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('outcome VERIFIED')
    expect(r.err).toContain("under today's default peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN")
    expect(JSON.parse(r.out).rule_now).toMatchObject({ ruleset: 'peppol-en16931@0.3.0', gate: 'FAIL' })
  })
  it('--require-ruleset: the FAILED line leads, then VERIFIED; exit 1', () => {
    const r = go(['replay', vf, '--extraction', xf, '--ruleset', 'peppol-en16931@0.1.0', '--require-ruleset', 'peppol-en16931@>=0.2.0'])
    expect(r.code).toBe(1)
    const lines = r.err.trim().split('\n')
    expect(lines[0]).toMatch(/^verify replay: FAILED: the verdict was issued under peppol-en16931@0\.1\.0, older than/)
    expect(lines[1]).toContain('outcome VERIFIED')
  })
  it('a field added to a verdict diverges at that field, with no hint about tolerance overrides', () => {
    const x = { invoice_number: 'I-2', line_items: [{ description: 'W', quantity: 2, unit_price: '50.00', amount: '100.00' }], totals: { subtotal: '100.00', total: '100.00' } }
    const verdict = verify(x, { now: NOW }) as unknown as Record<string, unknown>
    const ef = join(dir, 'extra.json'), ix = join(dir, 'inv.json')
    writeFileSync(ef, JSON.stringify({ ...verdict, approved_by: 'someone' }))
    writeFileSync(ix, JSON.stringify(x))
    const r = go(['replay', ef, '--extraction', ix])
    expect(r.code).toBe(1)
    expect(r.err).toContain('differs from the presented one at `approved_by`')
    expect(r.err).not.toContain('rounding-tolerance')
  })
})
