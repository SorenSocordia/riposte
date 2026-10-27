/**
 * The standards compiler (T2, 2026-10-03): schematron → declarative ruleset skeleton.
 *
 *   1. accounting: every assert lands in exactly one class, and every uncompiled one carries a category and a reason
 *   2. arithmetic: cent rounding, branch collapse with absent optional totals as 0, list sums, u:slack exactly, strict >
 *   3. presence and membership: presence-abstains, any-of presence, code lists, equality per amount path
 *   4. provenance: every check quotes its assert byte for byte and cites file, sha256, line, pattern, context, id, flag
 *   5. determinism, lint, and a compiled ruleset that runs: PASS on a clean invoice, FAIL on a wrong payable
 *   6. the recompile comparison against the shipped hand rulesets (0.2.0, 0.3.0), and its negative controls
 *   7. --diff: hand edits are marked hand_edited and listed
 *   8. the readers: XML (lines, verbatim content, entities), XPath, the structure XML with includes
 *   9. the CLI verb
 * The fixtures are byte-for-byte excerpts of the pinned CEN and Peppol schematrons (test/fixtures/compile, headers cite them).
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileSchematron, compareWithHand, markHandEdits, parseXPath, XPathError, readSchematron, parseStructureTsv, parseStructureXml,
  lintRuleset, verifyDeclarative, COMPILER_VERSION, type DeclarativeRuleset, type DeclCheck,
} from '../src/index'
import { parseXml } from '../src/compile/xml'
import { run } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'compile')
const EX = join(HERE, '..', 'docs', 'examples')
const text = (f: string): string => readFileSync(join(FIX, f), 'utf8')
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const INPUTS = ['cen-excerpt.sch', 'peppol-excerpt.sch'].map(f => ({ path: join(FIX, f), text: text(f) }))
const STRUCT = { file: 'structure-excerpt.tsv', text: text('structure-excerpt.tsv') }
const ALIASES = JSON.stringify({
  lineArrayKeys: ['lines'],
  terms: {
    'BT-1': { paths: ['invoice_number'] }, 'BT-2': { paths: ['issue_date'] }, 'BT-5': { paths: ['currency'] }, 'BT-106': { paths: ['line_extension_amount'] },
    'BT-107': { paths: ['allowance_total_amount'] }, 'BT-108': { paths: ['charge_total_amount'] }, 'BT-109': { paths: ['tax_exclusive_amount'] },
    'BT-110': { paths: ['tax_amount'] }, 'BT-112': { paths: ['tax_inclusive_amount'] }, 'BT-113': { paths: ['prepaid_amount'] },
    'BT-114': { paths: ['payable_rounding_amount'] }, 'BT-115': { paths: ['payable_amount'] }, 'BT-131': { paths: ['line_extension_amount'] },
    'BT-129': { paths: ['invoiced_quantity'] }, 'BT-146': { paths: ['price_amount'] }, 'BT-149': { paths: ['base_quantity'] },
    'BT-117': { each: ['vat_breakdown'], paths: ['tax_amount'] },
  },
})
const compile = (extra: Partial<Parameters<typeof compileSchematron>[1]> = {}) => compileSchematron(INPUTS, { structure: STRUCT, profile: 'excerpt-compiled', ...extra })
const check = (rs: DeclarativeRuleset, code: string): DeclCheck => { const c = rs.checks.find(x => x.code === code); if (!c) throw new Error(`no check ${code}`); return c }

describe('1. accounting: every assert exactly once', () => {
  const r = compile()
  it('counts add up per file, and the report lists every assert', () => {
    expect(r.report.entries.length).toBe(35)
    for (const [file, c] of Object.entries(r.report.counts)) {
      expect(c.arithmetic + c.presence + c.membership + c.uncompiled).toBe(c.asserts)
      expect(r.report.entries.filter(e => e.file === file).length).toBe(c.asserts)
    }
    expect(r.report.counts['cen-excerpt.sch']).toEqual({ asserts: 30, arithmetic: 6, presence: 12, membership: 1, uncompiled: 11, partial: 0 })
    expect(r.report.counts['peppol-excerpt.sch']).toEqual({ asserts: 5, arithmetic: 2, presence: 0, membership: 2, uncompiled: 1, partial: 1 })
  })
  it('an uncompiled assert carries a category and a reason, and makes no check', () => {
    const cats = Object.fromEntries(r.report.entries.filter(e => e.class === 'uncompiled').map(e => [e.assert_id, e.uncompiled[0]!.category]))
    expect(cats['BR-29']).toBe('date')
    expect(cats['BR-DEC-09']).toBe('format')
    expect(cats['UBL-CR-001']).toBe('absence')
    expect(cats['PEPPOL-EN16931-R100']).toBe('cardinality')
    for (const e of r.report.entries.filter(x => x.class === 'uncompiled')) {
      expect(e.checks).toEqual([])
      expect(e.uncompiled.length).toBeGreaterThan(0)
      for (const u of e.uncompiled) { expect(u.category).toMatch(/\S/); expect(u.reason).toMatch(/\S/) }
    }
    // the compiled ruleset carries the counts and the report's hash
    const cf = (r.ruleset as unknown as { compiled_from: { report_sha256: string; total: unknown } }).compiled_from
    expect(cf.report_sha256).toBe(sha(r.reportText))
    expect(cf.total).toEqual(r.report.total)
  })
  it('a partial assert names the instances it left out (R051: amounts that repeat, and line amounts against a document field)', () => {
    const e = r.report.entries.find(x => x.assert_id === 'PEPPOL-EN16931-R051')!
    expect(e.partial).toBe(true)
    expect(e.checks.length).toBe(9)
    expect(e.uncompiled.map(u => u.category).sort()).toEqual(['document-term-in-line-check', 'per-element-group', 'per-element-group', 'per-element-group', 'per-element-group'])
  })
})

describe('2. arithmetic', () => {
  const rs = compile().ruleset
  it('BR-CO-10: the sum of the line nets, cent rounding as tol 0.005', () => {
    const c = check(rs, 'BR-CO-10')
    expect([c.left, c.op, c.right, c.tol]).toEqual(['BT_106', '=', 'sum(BT_131)', 0.005])
  })
  it('BR-CO-13 and BR-CO-16: four presence branches collapse to one form, an absent optional total counted as 0', () => {
    expect([check(rs, 'BR-CO-13').left, check(rs, 'BR-CO-13').right]).toEqual(['BT_109', 'BT_106 + BT_108 - BT_107'])
    expect([check(rs, 'BR-CO-16').left, check(rs, 'BR-CO-16').right]).toEqual(['BT_115', 'BT_112 - BT_113 + BT_114'])
    for (const r of ['BT_107', 'BT_108', 'BT_113', 'BT_114']) expect(rs.fields[r]!.default).toBe(0)
    expect(check(rs, 'BR-CO-13').narrowing!.join(' ')).toMatch(/branch-collapse/)
  })
  it('BR-CO-11: branches that do not cover every combination compile the fullest one alone, every operand required', () => {
    const c = check(rs, 'BR-CO-11')
    expect([c.left, c.right]).toEqual(['BT_107_REQUIRED', 'sum(BT_92_LIST)'])
    expect(rs.fields.BT_107_REQUIRED!.default).toBeUndefined()
    expect(c.narrowing!.join(' ')).toMatch(/other-branches-abstain/)
  })
  it('BR-CO-14: every VAT breakdown row as a list field, failing on a row it cannot read; the vacuous branch abstains', () => {
    const c = check(rs, 'BR-CO-14')
    expect([c.left, c.right, c.tol, c.fail_if_unreadable]).toEqual(['BT_110', 'sum(BT_117_LIST)', 0.005, ['BT_117_LIST']])
    expect(rs.fields.BT_117_LIST!.each).toEqual(['vat_breakdown', 'TaxSubtotal', 'tax_subtotals'])
    expect(c.narrowing!.join(' ')).toMatch(/vacuous-when-absent-abstains/)
  })
  it('PEPPOL-EN16931-R120: u:slack compiles to an exact 0.02, the line net at full precision, defaults only for optional elements', () => {
    const c = check(rs, 'PEPPOL-EN16931-R120')
    expect([c.scope, c.left, c.op, c.right, c.tol, c.exact_tolerance]).toEqual(['line', 'BT_131_EXACT', '=', 'BT_129 * BT_146 / BT_149 + SUM_BT_141? - SUM_BT_136?', 0.02, true])
    expect(rs.fields.BT_131_EXACT!.kind).toBe('price')
    expect(rs.fields.BT_149!.default).toBe(1)
    expect(rs.fields.BT_129!.default).toBeUndefined() // mandatory: absence abstains, never the schematron's 1
    expect(c.abstain_if_present).toEqual(['ITEMS_ALLOWANCECHARGE'])
    expect(c.narrowing!.join(' ')).toMatch(/mandatory-absent-abstains: BT-131/)
  })
  it('PEPPOL-EN16931-R121: x > 0 is two checks (>= and !=), applying when the base quantity is present', () => {
    const a = check(rs, 'PEPPOL-EN16931-R121:1'), b = check(rs, 'PEPPOL-EN16931-R121:2')
    expect([a.op, b.op, a.exact_tolerance, b.exact_tolerance]).toEqual(['>=', '!=', true, true])
    expect(a.applies_if).toEqual([{ field: 'BT_149_REQUIRED', present: true }])
  })
})

describe('3. presence and membership', () => {
  const rs = compile().ruleset
  it('a presence assert abstains when the field is absent, and says so', () => {
    expect(check(rs, 'BR-02')).toMatchObject({ compare: 'identifier', left: 'BT_1', op: '=', right: 'BT_1', narrowing: ['presence-abstains'] })
    expect(check(rs, 'BR-15')).toMatchObject({ left: 'BT_115', right: 'BT_115', tol: 0.005, narrowing: ['presence-abstains'] })
  })
  it('BR-CO-25: one of two fields, applying when the amount due is positive', () => {
    expect(check(rs, 'BR-CO-25')).toMatchObject({ compare: 'identifier', left: 'BT_9', right: 'BT_9', alternatives: [{ left: 'BT_20', right: 'BT_20' }], applies_if: [{ left: 'BT_115', op: '>', right: '0' }] })
  })
  it('BR-CL-04: the code list in the schematron, every code of it', () => {
    const c = check(rs, 'BR-CL-04')
    expect(c.compare).toBe('member')
    expect(c.in!.length).toBe(179)
    expect(c.in).toContain('EUR')
    expect(c.in).not.toContain(' ')
  })
  it('PEPPOL-EN16931-R051: one equality per amount path that occurs once; an optional total applies only when reported', () => {
    expect(check(rs, 'PEPPOL-EN16931-R051:BT-115')).toMatchObject({ compare: 'identifier', left: 'BT_115_CURRENCYID', right: 'BT_5' })
    expect(check(rs, 'PEPPOL-EN16931-R051:BT-107').applies_if).toEqual([{ any_present: ['BT_107_REQUIRED'] }])
  })
})

describe('4. provenance: the assert, quoted byte for byte', () => {
  const rs = compile().ruleset
  it('every check cites file, sha256, line, pattern, context, id and flag, and its text is the file\'s own', () => {
    for (const c of rs.checks) {
      const s = c.source!
      const src = text(s.file)
      expect(s.sha256).toBe(sha(src))
      const line = src.split('\n')[s.line - 1]!
      expect(line).toContain('<assert')
      expect(src).toContain(`>${s.text}</assert>`)
      expect(s.rule_context).toBeTruthy()
      expect(typeof s.flag).toBe('string')
      expect(c.compiled_from).toMatchObject({ compiler: `verify compile-ruleset@${COMPILER_VERSION}` })
      expect(c.name).toBe(s.text!.replace(/\s+/g, ' ').trim())
    }
    expect(check(rs, 'BR-CO-10').source!.text).toBe('[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).')
    expect(check(rs, 'BR-CO-10').source).toMatchObject({ file: 'cen-excerpt.sch', pattern_id: 'UBL-model', rule_context: 'cac:LegalMonetaryTotal', assert_id: 'BR-CO-10', flag: 'fatal' })
  })
})

describe('5. determinism, lint, and a compiled ruleset that runs', () => {
  it('compiling twice gives the same bytes', () => {
    const a = compile(), b = compile()
    expect(JSON.stringify(a.ruleset)).toBe(JSON.stringify(b.ruleset))
    expect(a.reportText).toBe(b.reportText)
  })
  it('lints clean', () => {
    const l = lintRuleset(compile().ruleset)
    expect(l.errors).toEqual([])
    expect(l.ok).toBe(true)
  })
  it('with aliases: a clean invoice passes the arithmetic, a wrong payable fails BR-CO-16, a missing number abstains', () => {
    const rs = compile({ aliases: { file: 'aliases.json', text: ALIASES } }).ruleset
    const clean = {
      invoice_number: 'A1', issue_date: '2026-10-01', currency: 'EUR', line_extension_amount: 1300, charge_total_amount: 25,
      tax_exclusive_amount: 1325, tax_amount: 331.25, tax_inclusive_amount: 1656.25, payable_amount: 1656.25,
      lines: [{ invoiced_quantity: 7, price_amount: 400, line_extension_amount: 2800 }, { invoiced_quantity: -3, price_amount: 500, line_extension_amount: -1500 }],
      vat_breakdown: [{ tax_amount: 331.25 }],
    }
    const v = verifyDeclarative(clean, rs)
    const out = (id: string): string | undefined => v.claims.find(c => c.claim_id === id)?.outcome
    for (const id of ['document.BR-CO-10', 'document.BR-CO-13', 'document.BR-CO-14', 'document.BR-CO-16', 'line[0].PEPPOL-EN16931-R120', 'line[1].PEPPOL-EN16931-R120', 'document.BR-02']) expect([id, out(id)]).toEqual([id, 'PASS'])
    const bad = verifyDeclarative({ ...clean, payable_amount: 1756.25 }, rs)
    expect(bad.claims.find(c => c.claim_id === 'document.BR-CO-16')?.outcome).toBe('FAIL')
    const { invoice_number: _n, ...noNumber } = clean
    const nn = verifyDeclarative(noNumber, rs)
    expect(nn.claims.find(c => c.claim_id === 'document.BR-02')?.insufficiency?.reason).toBe('FIELD_MISSING')
  })
})

describe('6. the recompile comparison against the shipped hand rulesets', () => {
  const r = compile()
  const v02 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.2.json'), 'utf8')) as DeclarativeRuleset
  const v03 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.3.json'), 'utf8')) as DeclarativeRuleset
  const verdict = (c: ReturnType<typeof compareWithHand>, code: string) => c.checks.find(x => x.hand_code === code)!
  it('0.3.0: the totals, R120 and BR-CO-14 are reproduced; R051 differs, explained; R120_SUM has no counterpart', () => {
    const c = compareWithHand(r.ruleset, v03, r.report)
    // the excerpt stops before BR-CO-15, so TAX_INCL_INT has nothing to match here (the full recompile reproduces it)
    expect(verdict(c, 'TAX_INCL_INT').differences[0]!.explanation).toMatch(/no assert BR-CO-15 in the compiled inputs/)
    for (const code of ['LINES_SUM_INT', 'TAX_EXCL_INT', 'PAYABLE_INT', 'LINE_MATH_INT', 'BRCO14_VAT_SUM', 'BR02_PRESENT', 'BR03_PRESENT', 'BR05_PRESENT', 'BR15_PRESENT']) expect([code, verdict(c, code).verdict]).toEqual([code, 'reproduced'])
    expect(verdict(c, 'R051_CURRENCY').verdict).toBe('differs')
    expect(verdict(c, 'R051_CURRENCY').differences[0]!.explanation).toMatch(/one value .* for every amount's currencyID/)
    expect(verdict(c, 'R120_SUM').verdict).toBe('no-counterpart')
    expect(c.summary.unexplained).toBe(0)
  })
  it('0.2.0: R120 differs in tolerance and precision, BR-CO-14 in its positional rows, each explained', () => {
    const c = compareWithHand(r.ruleset, v02, r.report)
    const r120 = verdict(c, 'LINE_MATH_INT')
    expect(r120.verdict).toBe('differs')
    expect(r120.differences.map(d => d.aspect).sort()).toEqual(['reading of BT-131', 'tolerance'])
    expect(r120.differences.find(d => d.aspect === 'tolerance')!.explanation).toMatch(/u:slack compares decimals exactly/)
    expect(verdict(c, 'BRCO14_VAT_SUM').differences[0]!.explanation).toMatch(/by position/)
    expect(c.summary).toMatchObject({ hand_checks: 11, reproduced: 7, differs: 4, unexplained: 0 })
  })
  it('negative controls: a changed operand or tolerance in the hand check is caught', () => {
    const mutated = JSON.parse(JSON.stringify(v03)) as DeclarativeRuleset
    mutated.checks.find(x => x.code === 'TAX_EXCL_INT')!.right = 'SUM_LINE_NET + ALLOWANCE + CHARGE'
    mutated.checks.find(x => x.code === 'PAYABLE_INT')!.tol = 0.01
    const c = compareWithHand(r.ruleset, mutated, r.report)
    expect(verdict(c, 'TAX_EXCL_INT').verdict).toBe('differs')
    expect(verdict(c, 'TAX_EXCL_INT').differences.map(d => d.aspect)).toContain('operands')
    expect(verdict(c, 'PAYABLE_INT').differences.map(d => d.aspect)).toEqual(['tolerance'])
    const noDefault = JSON.parse(JSON.stringify(v03)) as DeclarativeRuleset
    delete noDefault.fields.ALLOWANCE!.default
    expect(verdict(compareWithHand(r.ruleset, noDefault, r.report), 'TAX_EXCL_INT').differences.map(d => d.aspect)).toEqual(['absent BT-107'])
  })
})

describe('7. --diff marks hand edits', () => {
  const compiled = compile().ruleset
  it('a changed check, an added check, a removed check and a changed field are marked and listed', () => {
    const edited = JSON.parse(JSON.stringify(compiled)) as DeclarativeRuleset
    edited.checks.find(c => c.code === 'BR-CO-10')!.tol = 0.01
    edited.checks = edited.checks.filter(c => c.code !== 'BR-02')
    edited.checks.push({ code: 'MY_RULE', left: 'BT_115', op: '>=', right: '0', tol: 0 })
    edited.fields.BT_115!.paths = ['amount_due', ...edited.fields.BT_115!.paths]
    const { ruleset, edits } = markHandEdits(compiled, edited)
    expect(edits).toEqual([
      { kind: 'check', id: 'BR-CO-10', change: 'changed', keys: ['tol'] },
      { kind: 'check', id: 'MY_RULE', change: 'added' },
      { kind: 'check', id: 'BR-02', change: 'removed' },
      { kind: 'field', id: 'BT_115', change: 'changed', keys: ['paths'] },
    ])
    expect(ruleset.checks.find(c => c.code === 'BR-CO-10')!.hand_edited).toBe(true)
    expect(ruleset.checks.find(c => c.code === 'MY_RULE')!.hand_edited).toBe(true)
    expect(ruleset.checks.find(c => c.code === 'BR-CO-13')!.hand_edited).toBeUndefined()
    expect(ruleset.fields.BT_115!.hand_edited).toBe(true)
    expect((ruleset.compiled_from as { hand_edits: unknown[] }).hand_edits).toEqual(edits)
    expect(lintRuleset(ruleset).ok).toBe(true)
    // idempotent: the markers it writes are not edits
    expect(markHandEdits(compiled, ruleset).edits).toEqual(edits)
  })
})

describe('8. the readers', () => {
  it('XML: line numbers, byte-exact content, entities, CDATA, namespaces by URI', () => {
    const src = '<?xml version="1.0"?>\n<s:a xmlns:s="urn:x">\n  <s:b k="&lt;1&amp;2">x &gt; y<c/></s:b>\n  <![CDATA[<raw>]]>\n</s:a>'
    const root = parseXml(src)
    expect([root.local, root.ns]).toEqual(['a', 'urn:x'])
    const b = root.children.find(c => c.type === 'element')!
    expect(b.type === 'element' && [b.line, b.attrs.k, src.slice(b.innerStart, b.innerEnd)]).toEqual([3, '<1&2', 'x &gt; y<c/>'])
    expect(root.children.some(c => c.type === 'text' && c.text === '<raw>')).toBe(true)
    expect(() => parseXml('<a><b></a>')).toThrow(/does not close/)
  })
  it('XPath: the shapes schematron uses parse; garbage does not', () => {
    for (const x of [
      'u:slack($lineExtensionAmount, ($quantity * ($priceAmount div $baseQuantity)) + $chargesTotal - $allowancesTotal, 0.02)',
      "(xs:decimal(child::cbc:TaxAmount)= round((sum(cac:TaxSubtotal/xs:decimal(cbc:TaxAmount)) * 10 * 10)) div 100) or not(cac:TaxSubtotal)",
      "every $Currency in cbc:DocumentCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) eq 1)",
      "xs:decimal(cbc:LineExtensionAmount) = xs:decimal(round(sum(//(cac:InvoiceLine|cac:CreditNoteLine)/xs:decimal(cbc:LineExtensionAmount)) * 10 * 10) div 100)",
      "some $code in tokenize('49 59', '\\s') satisfies normalize-space(cbc:PaymentMeansCode) = $code",
      "if (/ubl-invoice:Invoice) then (if (cbc:InvoicedQuantity) then xs:decimal(cbc:InvoicedQuantity) else 1) else 1",
      '.[@mimeCode = \'application/pdf\' or @mimeCode = \'image/png\']', '(/ubl:Invoice | /cn:CreditNote)[$isCVD]', 'cbc:X castable as xs:date',
    ]) expect(() => parseXPath(x)).not.toThrow()
    expect(() => parseXPath('cbc:X = = 1')).toThrow(XPathError)
  })
  it('the schematron reader keeps lets, functions and every assert', () => {
    const s = readSchematron('peppol-excerpt.sch', text('peppol-excerpt.sch'))
    expect(s.asserts.map(a => a.assert_id)).toEqual(['PEPPOL-EN16931-R051', 'PEPPOL-EN16931-R120', 'PEPPOL-EN16931-R121', 'PEPPOL-EN16931-R100', 'PEPPOL-EN16931-R101'])
    expect(s.lets.map(l => l.name)).toEqual(['documentCurrencyCode'])
    expect(s.functions.get('u:slack')!.params).toEqual(['exp', 'val', 'slack'])
    expect(s.asserts[1]!.rule_lets.map(l => l.name)).toEqual(['lineExtensionAmount', 'quantity', 'priceAmount', 'baseQuantity', 'allowancesTotal', 'chargesTotal'])
  })
  it('the structure: a TSV, or the published XML with its parts; a part it cannot read is a gap', () => {
    const tsv = parseStructureTsv(text('structure-excerpt.tsv'))
    expect(tsv.root).toBe('Invoice')
    expect(tsv.rows.get('/Invoice/cac:TaxTotal/cbc:TaxAmount')!.terms).toEqual(['BT-110', 'BT-111'])
    const xml = '<Structure xmlns="urn:fdc:difi.no:2017:vefa:structure-1"><Document><Term>ubl:Invoice</Term>' +
      '<Element><Term>cbc:ID</Term><Name>Invoice number</Name><Reference type="BUSINESS_TERM">BT-1</Reference></Element>' +
      '<Include>part/totals.xml</Include><Include>part/missing.xml</Include></Document></Structure>'
    const part = '<Element xmlns="urn:fdc:difi.no:2017:vefa:structure-1"><Term>cac:LegalMonetaryTotal</Term><Element cardinality="0..1"><Term>cbc:PrepaidAmount</Term><Name>Paid amount</Name><Reference type="BUSINESS_TERM">BT-113</Reference><Attribute usage="Optional"><Term>currencyID</Term></Attribute></Element></Element>'
    const s = parseStructureXml(xml, h => (h === 'part/totals.xml' ? part : undefined))
    expect(s.rows.get('/Invoice/cbc:ID')).toMatchObject({ terms: ['BT-1'], card: { min: 1, max: 1 } })
    expect(s.rows.get('/Invoice/cac:LegalMonetaryTotal/cbc:PrepaidAmount')).toMatchObject({ terms: ['BT-113'], card: { min: 0, max: 1 } })
    expect(s.rows.get('/Invoice/cac:LegalMonetaryTotal/cbc:PrepaidAmount/@currencyID')!.card).toEqual({ min: 0, max: 1 })
    expect(s.gaps).toEqual(['/Invoice/<include part/missing.xml NOT FETCHED>'])
  })
})

describe('9. the CLI verb', () => {
  it('compile-ruleset writes the ruleset, the report and the comparison; --diff marks edits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vcomp-'))
    try {
      const out = join(dir, 'r.json')
      const err: string[] = []
      const io = { out: (s: string) => void s, err: (s: string) => void err.push(s) }
      const code = run(['compile-ruleset', join(FIX, 'cen-excerpt.sch'), join(FIX, 'peppol-excerpt.sch'), '--structure', join(FIX, 'structure-excerpt.tsv'), '--profile', 'cli-excerpt', '--out', out, '--against', join(EX, 'peppol-en16931.ruleset.v0.3.json')], io)
      expect(err.join('')).toMatch(/35 assert\(s\): 8 arithmetic, 12 presence, 3 membership, 12 uncompiled .*lint clean/)
      expect(err.join('')).toMatch(/against peppol-en16931@0\.3\.0: 9 reproduced, 2 differ, 1 with no counterpart, 0 unexplained/)
      expect(code).toBe(0)
      for (const f of ['r.json', 'r.compile-report.json', 'r.comparison.json', 'r.comparison.md']) expect(existsSync(join(dir, f))).toBe(true)
      const rs = JSON.parse(readFileSync(out, 'utf8')) as DeclarativeRuleset
      expect(rs.id).toBe('cli-excerpt')
      rs.checks[0]!.tol = 0.5
      const edited = join(dir, 'edited.json'), marked = join(dir, 'marked.json')
      writeFileSync(edited, JSON.stringify(rs))
      expect(run(['compile-ruleset', '--diff', out, edited, '--out', marked], io)).toBe(0)
      expect((JSON.parse(readFileSync(marked, 'utf8')) as DeclarativeRuleset).checks[0]!.hand_edited).toBe(true)
      expect(run(['compile-ruleset', '--out', out], io)).toBe(3)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
