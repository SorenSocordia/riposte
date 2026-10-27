/**
 * Ambiguous number spellings answer can't tell, with the reason (2026-10-06; src/rulesets/strict.ts, src/declarative/evaluate.ts).
 *
 * An outside engineer (cold review round 6) read, under engine 0.6.0's built-in invoice ruleset: "1,500" as 1500 at confidence
 * 100; "1.500" as 1.5; one invoice writing "1.500,00" beside "1,500.00" as 1500 twice, and its arithmetic PASSed; full-width digits
 * and a trailing no-break space accepted. The published API description said "Never guesses". Each now leaves the checks that need
 * the figure at INSUFFICIENT_DATA (UNPARSEABLE), naming why; the unambiguous spellings keep reading; a declared number_locale reads
 * a lone three-digit group. The declarative path (engine 0.6.0) refuses the same characters and the same mixed document. Engines
 * before 0.6.0 read exactly as before.
 */
import { describe, it, expect } from 'vitest'
import { verify, verifyDeclarative, type Verdict } from '../src/index'
import { strictNumberText, figureCharacterProblem, formatOfTexts } from '../src/rulesets/strict'
import { resolveDeclarativeRuleset } from '../src/rulesets/declarative'

const NOW = () => new Date('2026-10-06T00:00:00Z')
type J = Record<string, unknown>
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)!
const inv = (x: J): Verdict => verify(x, { now: NOW })
const doc = (amount: string, extra: J = {}): J => ({ invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: '150.00', amount }], totals: { subtotal: '1500.00', total: '1500.00' }, ...extra })

describe('strictNumberText: what an ambiguous spelling says', () => {
  it('a lone three-digit group reads only under a declared format, never one the other figures settle', () => {
    const en = formatOfTexts(['150.00', '1500.00'], undefined)
    expect(en.source).toBe('settled')
    for (const raw of ['1,500', '1.500', '$1,500']) {
      const r = strictNumberText(raw, 'amount', en)
      expect(r.ok, raw).toBe(false)
      expect((r as { why: string }).why).toContain('one separator followed by three digits is a thousands group or three decimals, and only a declared format settles which; the document\'s other figures are written in en')
    }
    expect(strictNumberText('1,500', 'amount', formatOfTexts([], 'en'))).toEqual({ ok: true, value: 1500 })
    expect(strictNumberText('1.500', 'price', formatOfTexts([], 'en'))).toEqual({ ok: true, value: 1.5 })
    expect(strictNumberText('1.500', 'amount', formatOfTexts([], 'de'))).toEqual({ ok: true, value: 1500 })
  })
  it('the unambiguous spellings keep reading: "1,500.00", "1500.00", "1.500,00", "0.125", "1,250,000"', () => {
    for (const [raw, v] of [['1,500.00', 1500], ['1500.00', 1500], ['1.500,00', 1500], ['0.125', 0.125], ['1,250,000', 1250000]] as const) {
      expect(strictNumberText(raw, 'amount'), raw).toEqual({ ok: true, value: v })
    }
  })
  it('a document that writes both formats settles nothing and reads none of its figures with a "." or ","', () => {
    const mixed = formatOfTexts(['1.500,00', '1,500.00'], undefined)
    expect(mixed).toEqual({ source: 'mixed', note: 'the document mixes both number formats ("1,500.00" and "1.500,00")' })
    expect(strictNumberText('1.500,00', 'amount', mixed)).toMatchObject({ ok: false, why: expect.stringContaining('the document mixes both number formats ("1,500.00" and "1.500,00"), so what its "." and "," mean is not settled') })
    expect(strictNumberText('1500', 'amount', mixed)).toEqual({ ok: true, value: 1500 })
  })
  it('digits other than 0-9, spaces other than the ordinary one outside a grouping, and invisible characters are refused, named', () => {
    // a figure wholly in one script of digits is not refused here (a Japanese or Arabic invoice); two scripts in one figure are
    expect(figureCharacterProblem('\uFF11\uFF15\uFF10\uFF10.\uFF10\uFF10')).toBeUndefined()
    expect(figureCharacterProblem('\u0661\u0665\u0660\u0660')).toBeUndefined()
    expect(figureCharacterProblem('1\uFF15\uFF10\uFF10.00')).toContain('it mixes the digits 0-9 and full-width digits ("1", U+0031; "\uFF15", U+FF15)')
    expect(figureCharacterProblem('1500.00\u00A0')).toContain('a no-break space (U+00A0)')
    expect(figureCharacterProblem('\u200B1500.00')).toContain('a zero-width space (U+200B)')
    expect(figureCharacterProblem('1500.00')).toBeUndefined()
    expect(figureCharacterProblem('$ 1,500.00 USD')).toBeUndefined()
    // a no-break space BETWEEN digits is a space grouping, which the grouping rule decides (refused undeclared, read under "fr")
    expect(figureCharacterProblem('1\u00A0234,50')).toBeUndefined()
    expect(strictNumberText('1\u00A0234', 'amount')).toMatchObject({ ok: false, why: expect.stringContaining('space-grouped') })
    expect(strictNumberText('1\u202F234,50', 'amount', formatOfTexts([], 'fr'))).toEqual({ ok: true, value: 1234.5 })
  })
})

describe('the built-in invoice ruleset (engine 0.6.0): the engineer\'s invoices', () => {
  it('"1.500,00" beside "1,500.00": every figure with a separator is can\'t tell, and the arithmetic no longer PASSes', () => {
    const v = inv({ invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: '150.00', amount: '1.500,00' }], totals: { subtotal: '1,500.00', total: '1,500.00' } })
    for (const id of ['document.SUM_INT', 'document.TOTAL_INT', 'line[0].MATH_INT']) expect(claim(v, id).outcome, id).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'document.SUM_INT').insufficiency!.detail).toContain('the document mixes both number formats')
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
  })
  it('"1.500" with "1500.00" elsewhere: not read as 1.5 any more; the line says why', () => {
    const v = inv({ invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 1, unit_price: '1.500', amount: '1.500' }], totals: { subtotal: '1500.00', total: '1500.00' } })
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'document.SUM_INT').insufficiency!.detail).toContain('line_items[0].amount is "1.500", which does not read as one number (one separator followed by three digits')
  })
  it('"1,500" is can\'t tell; with "number_locale": "en" it reads 1500 and the invoice checks', () => {
    expect(claim(inv(doc('1,500')), 'line[0].MATH_INT').outcome).toBe('INSUFFICIENT_DATA')
    const v = inv(doc('1,500', { number_locale: 'en' }))
    expect([claim(v, 'document.SUM_INT').outcome, claim(v, 'line[0].MATH_INT').outcome]).toEqual(['PASS', 'PASS'])
  })
  it('full-width digits and a trailing no-break space: can\'t tell, named; "1500.00" and a consistent European invoice still read', () => {
    // the engineer's case: one full-width figure in an invoice whose other figures use 0-9
    const fw = claim(inv(doc('\uFF11\uFF15\uFF10\uFF10.\uFF10\uFF10')), 'document.SUM_INT').insufficiency!.detail
    expect(fw).toContain('the document writes its figures in more than one script of digits')
    expect(fw).toContain('and this figure is written in full-width digits')
    // a document written wholly in full-width digits reads (test/i18n.test.ts pins a Japanese invoice the same way)
    const ja = inv({ invoice_number: 'JP-2', line_items: [{ description: 'C', quantity: '\uFF12', unit_price: '\uFF15\uFF10\uFF10', amount: '\uFF11\uFF10\uFF10\uFF10' }], totals: { subtotal: '\uFF11\uFF10\uFF10\uFF10', total: '\uFF11\uFF10\uFF10\uFF10' } })
    expect(claim(ja, 'document.SUM_INT').outcome).toBe('PASS')
    expect(claim(inv(doc('1500.00\u00A0')), 'document.SUM_INT').insufficiency!.detail).toContain('a no-break space (U+00A0)')
    expect(claim(inv(doc('1500.00')), 'line[0].MATH_INT').outcome).toBe('PASS')
    const eu = inv({ invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: '150,00', amount: '1.500,00' }], totals: { subtotal: '1.500,00', total: '1.500,00' } })
    expect([claim(eu, 'document.SUM_INT').outcome, claim(eu, 'line[0].MATH_INT').outcome]).toEqual(['PASS', 'PASS'])
  })
  it('engine 0.5.0 reads them as it always did (its verdicts re-perform)', () => {
    const v = verify({ invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: '150.00', amount: '1.500,00' }], totals: { subtotal: '1,500.00', total: '1,500.00' } }, { now: NOW, engine: '0.5.0' })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')
  })
})

describe('the declarative path (engine 0.6.0): the same characters and the same mixed document', () => {
  const ruleset = resolveDeclarativeRuleset('peppol-en16931')!
  const base: J = {
    invoice_number: 'S1', issue_date: '2017-11-13', currency: 'EUR', amount_currency: 'EUR', seller_name: 'S', buyer_name: 'B',
    line_extension_amount: '100.00', tax_exclusive_amount: '100.00', tax_inclusive_amount: '125.00', payable_amount: '125.00',
    lines: [{ id: '1', item_name: 'x', invoiced_quantity: 1, price_amount: '100.00', line_extension_amount: '100.00' }],
    vat_breakdown: [{ category: 'S', rate: 25, taxable_amount: '100.00', tax_amount: '25.00' }],
  }
  const unreadableDetails = (v: Verdict): string => v.claims.map(c => c.insufficiency?.detail ?? '').join(' | ')
  it('a full-width figure is unreadable, the character named; under engine 0.5.0 it is read as before', () => {
    const x = { ...base, payable_amount: '\uFF11\uFF12\uFF15.\uFF10\uFF10' }
    const v6 = verifyDeclarative(x, ruleset, { now: NOW, engine: '0.6.0' })
    expect(unreadableDetails(v6)).toContain('the document writes its figures in more than one script of digits')
    expect(unreadableDetails(v6)).toContain('and this figure is written in full-width digits')
    const r5 = resolveDeclarativeRuleset('peppol-en16931', '0.5.0')!
    const v5 = verifyDeclarative(x, r5, { now: NOW, engine: '0.5.0' })
    expect(unreadableDetails(v5)).not.toContain('more than one script of digits')
  })
  it('a document that writes "1,000.00" and "1.000,00" reads none of its figures with a separator', () => {
    const x = { ...base, line_extension_amount: '1,000.00', tax_exclusive_amount: '1.000,00' }
    const v = verifyDeclarative(x, ruleset, { now: NOW, engine: '0.6.0' })
    expect(unreadableDetails(v)).toContain('the document mixes both number formats')
  })
})
