/**
 * The standards compiler's currency count (T2b, 2026-10-03; compiler 0.1.1; added POST HOC, after a corpus run showed the gap).
 *
 * BR-CO-15's conjunct 1, `count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) eq 1` with $Currency the invoice
 * currency (BT-5), was left uncompiled by 0.1.0 (cardinality). cac:TaxTotal occurs at most twice and the compiler reads its
 * instances as two terms (BT-110, BT-111), so the count compiles to two identifier checks:
 *   1. the reading: BT_110_CURRENCYID = BT_5, and BT_111_CURRENCYID != BT_5 when BT-111 is reported
 *   2. additivity: the assert's arithmetic check keeps its code (BR-CO-15) and the assert its class; BR-53 is untouched
 *   3. it runs: a currency that differs from the totals' FAILs, an absent BT-5 abstains, a second total in BT-5 FAILs
 *   4. negative controls (synthetic tests, not the standard's): another constant, no filter, a further condition stay cardinality;
 *      the BT-6 form compiles the mirror image
 * The fixture is a byte-for-byte excerpt of the pinned CEN schematron (test/fixtures/compile/cen-brco15-excerpt.sch, header cites it).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileSchematron, lintRuleset, verifyDeclarative, COMPILER_VERSION, type DeclarativeRuleset, type DeclCheck } from '../src/index'
import { POLICIES } from '../src/compile/compile'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'compile')
const text = (f: string): string => readFileSync(join(FIX, f), 'utf8')
const SCH = 'cen-brco15-excerpt.sch'
const STRUCT = { file: 'structure-excerpt.tsv', text: text('structure-excerpt.tsv') }
const ALIASES = JSON.stringify({
  terms: {
    'BT-5': { paths: ['currency'] }, 'BT-6': { paths: ['tax_currency'] },
    'BT-109': { paths: ['tax_exclusive_amount'] }, 'BT-110': { paths: ['tax_amount'] }, 'BT-112': { paths: ['tax_inclusive_amount'] },
    'BT-111': { paths: ['tax_amount_accounting'] },
    'BT-110/@currencyID': { paths: ['amount_currency'] }, 'BT-111/@currencyID': { paths: ['tax_amount_accounting_currency'] },
  },
})
const compileText = (src: string, extra: Partial<Parameters<typeof compileSchematron>[1]> = {}) =>
  compileSchematron([{ path: join(FIX, SCH), text: src }], { structure: STRUCT, profile: 'brco15-excerpt', ...extra })
const compile = (extra: Partial<Parameters<typeof compileSchematron>[1]> = {}) => compileText(text(SCH), extra)
const check = (rs: DeclarativeRuleset, code: string): DeclCheck => { const c = rs.checks.find(x => x.code === code); if (!c) throw new Error(`no check ${code}`); return c }

describe('1. the reading: count(TaxAmount[@currencyID = BT-5]) eq 1, per dual term', () => {
  const r = compile()
  it('BR-CO-15 compiles whole: conjunct 1 as two identifier checks beside the arithmetic one', () => {
    const e = r.report.entries.find(x => x.assert_id === 'BR-CO-15')!
    expect([e.class, e.partial, e.checks, e.uncompiled]).toEqual(['arithmetic', false, ['BR-CO-15:c1.1', 'BR-CO-15:c1.2', 'BR-CO-15'], []])
    expect(check(r.ruleset, 'BR-CO-15:c1.1')).toMatchObject({ compare: 'identifier', left: 'BT_110_CURRENCYID', op: '=', right: 'BT_5' })
    expect(check(r.ruleset, 'BR-CO-15:c1.2')).toMatchObject({ compare: 'identifier', left: 'BT_111_CURRENCYID', op: '!=', right: 'BT_5', applies_if: [{ any_present: ['BT_111', 'BT_111_CURRENCYID'] }] })
    for (const code of ['BR-CO-15:c1.1', 'BR-CO-15:c1.2']) {
      const c = check(r.ruleset, code)
      expect(c.narrowing!.join(' ')).toMatch(/currency-count: count\(cac:TaxTotal\/cbc:TaxAmount\[@currencyID = BT-5\]\) eq 1 read per dual term/)
      expect(c.narrowing!.join(' ')).toMatch(/where the XML count is 1/)
      expect(c.compiled_from).toEqual({ compiler: `verify compile-ruleset@${COMPILER_VERSION}`, class: 'membership' })
      expect(c.source).toMatchObject({ file: SCH, assert_id: 'BR-CO-15', flag: 'fatal' })
    }
    expect(r.ruleset.fields.BT_110_CURRENCYID!.term_key).toBe('BT-110/@currencyID')
    expect(r.ruleset.fields.BT_111_CURRENCYID!.term_key).toBe('BT-111/@currencyID')
  })
  it('the compiler is 0.1.1, and its policies name the reading and say it was added post hoc', () => {
    expect(COMPILER_VERSION).toBe('0.1.1')
    expect(POLICIES.find(p => p.startsWith('currency-count'))).toMatch(/added post hoc/)
    expect(r.report.policies).toEqual(POLICIES)
  })
  it('lints clean', () => {
    expect(lintRuleset(r.ruleset).errors).toEqual([])
  })
})

describe('2. additivity: what 0.1.0 wrote keeps its code, form and class', () => {
  const rs = compile().ruleset
  it('the arithmetic conjunct is still the check coded BR-CO-15, unchanged', () => {
    const c = check(rs, 'BR-CO-15')
    expect([c.left, c.op, c.right, c.tol, c.compare]).toEqual(['BT_112', '=', 'BT_109 + BT_110', 0.005, undefined])
    expect(c.narrowing).toEqual(['term: BT-110/BT-111 on one UBL element: the cac:TaxTotal with the VAT breakdown, in the invoice currency (BT-110)'])
    expect(c.compiled_from).toEqual({ compiler: `verify compile-ruleset@${COMPILER_VERSION}`, class: 'arithmetic' })
  })
  it('BR-53 (the filter consumed as the term selector) is untouched: one presence check of BT-111 when BT-6 is present', () => {
    expect(rs.checks.filter(c => c.source?.assert_id === 'BR-53').map(c => c.code)).toEqual(['BR-53'])
    expect(check(rs, 'BR-53')).toMatchObject({ left: 'BT_111', right: 'BT_111', applies_if: [{ field: 'BT_6', present: true }], narrowing: ['presence-abstains', 'term: BT-110/BT-111 on one UBL element: the cac:TaxTotal in the VAT accounting currency (BT-111)'] })
  })
  it('the counts: two asserts, nothing uncompiled, nothing partial', () => {
    expect(compile().report.counts[SCH]).toEqual({ asserts: 2, arithmetic: 1, presence: 1, membership: 0, uncompiled: 0, partial: 0 })
  })
})

describe('3. a compiled ruleset that runs', () => {
  const rs = compile({ aliases: { file: 'aliases.json', text: ALIASES } }).ruleset
  const base = { currency: 'EUR', amount_currency: 'EUR', tax_exclusive_amount: 1325, tax_amount: 331.25, tax_inclusive_amount: 1656.25 }
  const run = (x: Record<string, unknown>) => {
    const v = verifyDeclarative(x, rs)
    const claim = (id: string) => v.claims.find(c => c.claim_id === id)
    const na = (id: string) => (v.not_applicable ?? []).some(n => n.claim_id === id)
    return { v, claim, na }
  }
  it('the totals in the invoice currency: c1.1 PASS; no BT-111 reported, so c1.2 does not apply', () => {
    const { claim, na } = run(base)
    expect(claim('document.BR-CO-15:c1.1')?.outcome).toBe('PASS')
    expect(claim('document.BR-CO-15')?.outcome).toBe('PASS')
    expect(na('document.BR-CO-15:c1.2')).toBe(true)
  })
  it('the invoice currency changed, the totals not (the planted currency defect): c1.1 FAILs', () => {
    const { claim, v } = run({ ...base, currency: 'USD' })
    expect(claim('document.BR-CO-15:c1.1')?.outcome).toBe('FAIL')
    expect(v.outcome).toBe('FAIL')
  })
  it('no invoice currency: c1.1 abstains, naming the field', () => {
    const { currency: _c, ...noCurrency } = base
    const c = run(noCurrency).claim('document.BR-CO-15:c1.1')
    expect([c?.outcome, c?.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'FIELD_MISSING'])
  })
  it('a second total: in the invoice currency it FAILs c1.2 (the count would be 2); in another currency it passes', () => {
    expect(run({ ...base, tax_currency: 'SEK', tax_amount_accounting: 3400, tax_amount_accounting_currency: 'EUR' }).claim('document.BR-CO-15:c1.2')?.outcome).toBe('FAIL')
    expect(run({ ...base, tax_currency: 'SEK', tax_amount_accounting: 3400, tax_amount_accounting_currency: 'SEK' }).claim('document.BR-CO-15:c1.2')?.outcome).toBe('PASS')
    const c = run({ ...base, tax_amount_accounting: 3400 }).claim('document.BR-CO-15:c1.2')
    expect([c?.outcome, c?.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'FIELD_MISSING'])
  })
  it('scoped to terms without BT-111, c1.2 is an outside-field-scope instance and BR-CO-15 stays partial', () => {
    const scope = { file: 'scope.json', text: JSON.stringify({ terms: ['BT-5', 'BT-109', 'BT-110', 'BT-112', 'BT-110/@currencyID'] }) }
    const r = compile({ aliases: { file: 'aliases.json', text: ALIASES }, scope })
    const e = r.report.entries.find(x => x.assert_id === 'BR-CO-15')!
    expect([e.class, e.partial, e.checks]).toEqual(['arithmetic', true, ['BR-CO-15:c1.1', 'BR-CO-15']])
    expect(e.uncompiled).toEqual([{ instance: 'c1.2', category: 'outside-field-scope', reason: 'the check reads BT-111/@currencyID, BT-111, outside the field scope' }])
  })
})

describe('4. negative controls (synthetic tests, not the standard\'s)', () => {
  const src = text(SCH)
  const brco15 = src.split('\n').find(l => l.includes('id="BR-CO-15"'))!
  const withTest = (test: string): string => src.replace(brco15, `      <assert id="X-1" flag="fatal" test="${test}">[X-1]-synthetic</assert>`)
  const entry = (test: string) => compileText(withTest(test)).report.entries.find(e => e.assert_id === 'X-1')!
  it('another constant, no currency filter, or a further condition on the counted amount: cardinality, as before', () => {
    for (const t of [
      'every $Currency in cbc:DocumentCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) eq 2)',
      'count(cac:TaxTotal/xs:decimal(cbc:TaxAmount)) eq 1',
      'every $Currency in cbc:DocumentCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency][. &gt; 0])) eq 1)',
    ]) {
      const e = entry(t)
      expect([t, e.class, e.uncompiled[0]?.category]).toEqual([t, 'uncompiled', 'cardinality'])
    }
  })
  it('the VAT accounting currency (BT-6): the mirror image, applying when BT-6 is present', () => {
    const r = compileText(withTest('every $c in cbc:TaxCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$c])) eq 1)'))
    const e = r.report.entries.find(x => x.assert_id === 'X-1')!
    expect([e.class, e.partial, e.checks]).toEqual(['membership', false, ['X-1:1', 'X-1:2']])
    expect(check(r.ruleset, 'X-1:1')).toMatchObject({ left: 'BT_111_CURRENCYID', op: '=', right: 'BT_6', applies_if: [{ field: 'BT_6', present: true }] })
    expect(check(r.ruleset, 'X-1:2')).toMatchObject({ left: 'BT_110_CURRENCYID', op: '!=', right: 'BT_6', applies_if: [{ any_present: ['BT_110', 'BT_110_CURRENCYID'] }, { field: 'BT_6', present: true }] })
  })
})
