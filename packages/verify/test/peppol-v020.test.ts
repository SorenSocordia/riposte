/**
 * Peppol BIS Billing 3.0 / EN 16931, ruleset 0.2.0 (2026-10-03): the e-invoice PDF test found the shipped 0.1.0
 * PASSing 11 of 20 planted defects, every one a gap in the rules (no BR-CO-14, no currency check, no presence checks), and an
 * unreadable optional total silently read as 0. 0.2.0 merges the e-invoice PDF run's pre-registered supplement and tells an unreadable field
 * from an absent one (`distinguish_unreadable`). 0.1.0 stays in place, unchanged, so every verdict issued under it keeps its
 * id and replays.
 *
 *   1. the rule table: 0.1.0's five checks carried over unchanged, six new ones, each citing its published rule id
 *   2. the planted classes the 0.1.0 ruleset missed now FAIL or abstain, with typed remedies
 *   3. DeclaredAccuracy, 0.1.0 and 0.2.0 side by side (measureRuleset), on the existing labelled set and a constructed one
 *   4. UNREADABLE: the stamped-scan case's shape (X1-N18): two unreadable totals can never cancel into a PASS
 *   5. an unreadable operand's remedy names the field, the value as reported and the source line that prints it
 *   6. a 0.2.0 verdict issued with --source replays byte-identical from the CLI
 *   7. lint of the new keys; a ruleset without the flag behaves exactly as before
 *
 * Engine 0.1.0 (2026-10-03) made the flag's two readings the default for every declarative ruleset. The tests below that
 * describe how a ruleset WITHOUT the flag reads say which engine they mean: engine 0.0.1 (`engine: '0.0.1'`), which a verdict
 * naming it is still re-performed by. The new defaults are tested in test/engine-defaults.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateStatus, holdsAtGate, lintRuleset, measureRuleset, verifyDeclarative, type DeclarativeRuleset, type LabeledCase, type Verdict } from '../src/index'
import { run } from '../src/cli'

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
const V1_PATH = join(EX, 'peppol-en16931.ruleset.json')
const V2_PATH = join(EX, 'peppol-en16931.ruleset.v0.2.json')
const V1 = JSON.parse(readFileSync(V1_PATH, 'utf8')) as DeclarativeRuleset
const V2 = JSON.parse(readFileSync(V2_PATH, 'utf8')) as DeclarativeRuleset
const NOW = () => new Date('2026-10-03T00:00:00Z')
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)

// ── The stamped-scan case (X1-N18; values from OpenPEPPOL snippet 1, text as the OCR read the rendered page) ────────────
// A stamp hides the document allowance and charge (200.00 each, which cancel in BR-CO-13), the total without VAT and the
// VAT total. The extractor left out what it could not parse strictly.
const N18_TEXT = [
  'INVOICE', 'Invoice number: Snippet1', 'Issue date: 2017-11-13', 'Due date: 2017-12-01', 'Currency: EUR',
  'Seller: SupplierOfficialName Ltd', 'Buyer: Buyer Official Name', 'Line items',
  '# = =Item Qty Unit Price Per Allow. Charge Net VAT',
  '1 item name 10 XBX 410.00 1 101.00 1.00 4,000.00 S 25%', '2 item name 10 C62 200.00 2 - - 1,000.00 E0%',
  '3 item name 10 C62 100.00 - 101.00 1.00 900.00 S 25%',
  'Document allowances and charges', 'Charge Cleaning 200.00 S 25%', 'Allowance Discount 200.00 S 25%',
  'VAT breakdown', 'Category Rate Taxable amount VAT amount', 'S) 25% 4,900.00 1,225.00', 'E 0% 1,000.00 0.00',
  'Sum of line net amounts EUR 5,900.00', 'Document allowances EUR 20', 'Document charges EU 20 —E', 'Total without VAT E ten',
  'VAT total i °225.0', 'VAT total in accounting currency Ss 324.00', 'Total with VAT EUR 7,125.00', 'Paid amount EUR 1,000.00',
  'Amount due for payment EUR 6,125.00',
].join('\n')
const N18_BLIND = {
  invoice_number: 'Snippet1', issue_date: '2017-11-13', due_date: '2017-12-01', currency: 'EUR',
  seller_name: 'SupplierOfficialName Ltd', buyer_name: 'Buyer Official Name',
  line_extension_amount: 5900, tax_inclusive_amount: 7125, prepaid_amount: 1000, payable_amount: 6125, amount_currency: 'EUR',
  lines: [
    { id: '1', item_name: 'item name', invoiced_quantity: 10, price_amount: 410, line_extension_amount: 4000, base_quantity: 1, line_allowance_amount: 101, line_charge_amount: 1 },
    { id: '2', item_name: 'item name', invoiced_quantity: 10, price_amount: 200, line_extension_amount: 1000, base_quantity: 2 },
    { id: '3', item_name: 'item name', invoiced_quantity: 10, price_amount: 100, line_extension_amount: 900, line_allowance_amount: 101, line_charge_amount: 1 },
  ],
  vat_breakdown: [{ rate: 25, taxable_amount: 4900, tax_amount: 1225, row: 1 }, { category: 'E', rate: 0, taxable_amount: 1000, tax_amount: 0, row: 2 }],
}
/** The shape that makes the cancellation dangerous: the total without VAT and the VAT total WERE read, so BR-CO-13 can run. */
const N18_SHAPE = { ...N18_BLIND, tax_exclusive_amount: 5900, tax_amount: 1225 }

/** A compliant invoice carrying every field 0.2.0 reads. */
const CLEAN = {
  invoice_number: 'INV-2026-001', issue_date: '2026-01-15', currency: 'EUR', amount_currency: 'EUR',
  lines: [{ line_extension_amount: 1500, invoiced_quantity: 10, price_amount: 150 }, { line_extension_amount: 100, invoiced_quantity: 4, price_amount: 25 }],
  line_extension_amount: 1600, tax_exclusive_amount: 1600, tax_amount: 320, tax_inclusive_amount: 1920, payable_amount: 1920,
  vat_breakdown: [{ row: 1, tax_amount: 300 }, { row: 2, tax_amount: 20 }],
}

describe('1. the 0.2.0 rule table', () => {
  it('lints clean, with no warnings; 0.1.0 is untouched at the sha256 the e-invoice PDF test pinned', () => {
    expect(lintRuleset(V2)).toEqual({ ok: true, errors: [], warnings: [] })
    expect(createHash('sha256').update(readFileSync(V1_PATH)).digest('hex')).toBe('0a3cd5a52e6a835a8649ac8fa831bce47906ae77e5be2bdb85a70d1a9a0cd81c')
    expect([V1.id, V1.version, V2.id, V2.version]).toEqual(['peppol-en16931', '0.1.0', 'peppol-en16931', '0.2.0'])
  })

  it('carries 0.1.0\'s five checks unchanged (only typed remedies added, which are not part of the input identity) and its fields\' paths, kinds and defaults', () => {
    const strip = ({ remedy: _r, ...c }: Record<string, unknown>) => c
    for (const c of V1.checks) expect(strip(V2.checks.find(x => x.code === c.code) as never)).toEqual(c)
    for (const [role, f] of Object.entries(V1.fields)) {
      const g = V2.fields[role]!
      expect({ paths: g.paths, kind: g.kind, line: g.line, default: g.default }).toEqual({ paths: f.paths, kind: f.kind, line: f.line, default: f.default })
    }
    expect([V1.tolerance, V1.lineArrayKeys]).toEqual([V2.tolerance, V2.lineArrayKeys])
  })

  it('adds six checks, each naming its published rule id and the pinned schematron it is read from, each with a typed remedy', () => {
    const added = V2.checks.filter(c => !V1.checks.some(x => x.code === c.code))
    const table = added.map(c => [c.code, /^(BR-02|BR-03|BR-05|BR-15|PEPPOL-EN16931-R051|BR-CO-14):/.exec(c.name ?? '')?.[1], /\[(CEN-SCH|PEPPOL-SCH)\b/.exec(c.name ?? '')?.[1], c.remedy !== undefined])
    expect(table).toEqual([
      ['BR02_PRESENT', 'BR-02', 'CEN-SCH', true], ['BR03_PRESENT', 'BR-03', 'CEN-SCH', true], ['BR05_PRESENT', 'BR-05', 'CEN-SCH', true],
      ['BR15_PRESENT', 'BR-15', 'CEN-SCH', true], ['R051_CURRENCY', 'PEPPOL-EN16931-R051', 'PEPPOL-SCH', true], ['BRCO14_VAT_SUM', 'BR-CO-14', 'CEN-SCH', true],
    ])
    expect(V2.sources!['CEN-SCH']).toContain('sha256 bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331')
    expect(V2.sources!['PEPPOL-SCH']).toContain('sha256 5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d')
  })

  it('a compliant invoice is a clean PASS at the gate under 0.2.0 (every new check runs and passes)', () => {
    const v = verifyDeclarative(CLEAN, V2, { now: NOW })
    expect([v.outcome, gateStatus(v), v.claims.filter(c => c.outcome !== 'PASS').map(c => c.claim_id)]).toEqual(['PASS', 'PASS', []])
  })
})

describe('2. the planted classes 0.1.0 PASSed now FAIL or abstain', () => {
  const cases: [string, Record<string, unknown>, string, 'FAIL' | 'INSUFFICIENT_DATA'][] = [
    ['VAT subtotal (BR-CO-14)', { ...CLEAN, vat_breakdown: [{ row: 1, tax_amount: 300 }, { row: 2, tax_amount: 120 }] }, 'document.BRCO14_VAT_SUM', 'FAIL'],
    ['currency (R051)', { ...CLEAN, amount_currency: 'USD' }, 'document.R051_CURRENCY', 'FAIL'],
    ['no invoice number (BR-02)', { ...CLEAN, invoice_number: undefined }, 'document.BR02_PRESENT', 'INSUFFICIENT_DATA'],
    ['no issue date (BR-03)', { ...CLEAN, issue_date: undefined }, 'document.BR03_PRESENT', 'INSUFFICIENT_DATA'],
    ['no currency code (BR-05)', { ...CLEAN, currency: undefined }, 'document.BR05_PRESENT', 'INSUFFICIENT_DATA'],
  ]
  for (const [name, doc, id, want] of cases) {
    it(`${name}: 0.1.0 is a clean PASS; 0.2.0 ${want === 'FAIL' ? 'FAILs' : 'holds at the gate'} on ${id}`, () => {
      const d = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
      const v1 = verifyDeclarative(d, V1, { now: NOW })
      expect([v1.outcome, gateStatus(v1)]).toEqual(['PASS', 'PASS'])
      const v2 = verifyDeclarative(d, V2, { now: NOW })
      expect(claim(v2, id)?.outcome).toBe(want)
      expect(holdsAtGate(gateStatus(v2))).toBe(true)
      // the typed remedy answers the claim
      const r = v2.remedies!.filter(x => x.claims.includes(id))
      if (want === 'FAIL') expect(r.map(x => x.kind)).toEqual(['recompute-with', 'missing-operand'])
      else expect(r.map(x => [x.kind, x.operand?.path])).toEqual([['missing-operand', id === 'document.BR02_PRESENT' ? 'invoice_number' : id === 'document.BR03_PRESENT' ? 'issue_date' : 'currency']])
    })
  }

  it('the R051 remedy names both codes as the document wrote them, and the BR-CO-14 remedy the stated and summed VAT', () => {
    const r051 = verifyDeclarative({ ...CLEAN, amount_currency: 'usd' }, V2, { now: NOW }).remedies!.find(x => x.clears.includes('R051_CURRENCY'))!
    expect(r051.detail).toContain('the totals are stated in usd, the invoice currency code is EUR')
    const vat = verifyDeclarative({ ...CLEAN, tax_amount: 330, tax_inclusive_amount: 1930, payable_amount: 1930 }, V2, { now: NOW })
    expect(claim(vat, 'document.BRCO14_VAT_SUM')).toMatchObject({ outcome: 'FAIL', asserted: 330, variance: 10 })
    expect(vat.remedies!.find(x => x.kind === 'recompute-with' && x.clears.includes('BRCO14_VAT_SUM'))!.detail).toContain('BT-110 (330.00)')
    expect(vat.remedies!.find(x => x.kind === 'recompute-with' && x.clears.includes('BRCO14_VAT_SUM'))!.detail).toContain('they sum to 320.00')
  })

  it('BR-CO-14 abstains rather than guess on a fifth VAT row, or a row whose tax amount was not read', () => {
    const five = verifyDeclarative({ ...CLEAN, vat_breakdown: [1, 2, 3, 4, 5].map(row => ({ row, tax_amount: 64 })) }, V2, { now: NOW })
    expect(claim(five, 'document.BRCO14_VAT_SUM')?.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    const gap = verifyDeclarative({ ...CLEAN, vat_breakdown: [{ row: 1, tax_amount: 300 }, { row: 2 }] }, V2, { now: NOW })
    expect(claim(gap, 'document.BRCO14_VAT_SUM')?.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
  })
})

describe('3. DeclaredAccuracy, 0.1.0 and 0.2.0 side by side (measureRuleset: the raw outcome, as it always has)', () => {
  // The existing labelled set, verbatim from test/peppol-accuracy.test.ts (constructed, hand-labelled; not field data).
  const existing: LabeledCase[] = [
    { label: 'CLEAN', extraction: { currency: 'EUR', lines: [{ line_extension_amount: 1500, invoiced_quantity: 10, price_amount: 150 }, { line_extension_amount: 100, invoiced_quantity: 4, price_amount: 25 }], line_extension_amount: 1600, tax_exclusive_amount: 1600, tax_amount: 320, tax_inclusive_amount: 1920, payable_amount: 1920 } },
    { label: 'CLEAN', extraction: { currency: 'EUR', lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, allowance_total_amount: 50, charge_total_amount: 30, tax_exclusive_amount: 980, tax_amount: 196, tax_inclusive_amount: 1176, prepaid_amount: 176, payable_rounding_amount: 0, payable_amount: 1000 } },
    { label: 'ERROR', extraction: { currency: 'EUR', lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 200, tax_inclusive_amount: 1200, payable_amount: 9999 } },
    { label: 'ERROR', extraction: { currency: 'EUR', lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 200, tax_inclusive_amount: 1500, payable_amount: 1500 } },
  ]
  it('the existing labelled set: the same rates under both versions; each bound to its own version by measured_on', () => {
    const m1 = measureRuleset(V1, existing), m2 = measureRuleset(V2, existing)
    expect(m1.accuracy).toEqual({ domain: 'e-invoice', ruleset_version: '0.1.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: 'be0abbad21a29b43d88ac4e1b880519a4a4ee8381ec6031603680ad4db9f25c2' })
    expect(m2.accuracy).toEqual({ domain: 'e-invoice', ruleset_version: '0.2.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: '9883ba9294523e25bc5a89682b2c179dc19b19e6ef0e1f57bbdedc564f50c5d2' })
    for (const m of [m1, m2]) expect(m.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 0, abstain: 0, total: 4 })
    // The gate reading differs: the set predates BT-1, BT-2, the totals' currency and the VAT breakdown, so 0.2.0 holds its
    // two clean invoices open (PASS-WITH-OPEN) where 0.1.0 passes them.
    expect(existing.map(c => gateStatus(verifyDeclarative(c.extraction, V1)))).toEqual(['PASS', 'PASS', 'FAIL', 'FAIL'])
    expect(existing.map(c => gateStatus(verifyDeclarative(c.extraction, V2)))).toEqual(['PASS-WITH-OPEN', 'PASS-WITH-OPEN', 'FAIL', 'FAIL'])
  })

  // CONSTRUCTED after the rules were written (not blind): the existing set completed with the fields 0.2.0 reads, plus one
  // invoice per class the e-invoice PDF test planted that 0.1.0 does not read.
  const full = (e: Record<string, unknown>, vat: number[]): Record<string, unknown> => ({ invoice_number: 'INV-1', issue_date: '2026-01-15', amount_currency: 'EUR', ...e, vat_breakdown: vat.map((t, i) => ({ row: i + 1, tax_amount: t })) })
  const constructed: LabeledCase[] = [
    { label: 'CLEAN', extraction: full(existing[0]!.extraction, [320]) },
    { label: 'CLEAN', extraction: full(existing[1]!.extraction, [96, 100]) },
    { label: 'ERROR', extraction: full(existing[2]!.extraction, [200]) },
    { label: 'ERROR', extraction: full(existing[3]!.extraction, [200]) },
    { label: 'ERROR', extraction: full(existing[0]!.extraction, [300, 0]) }, // BR-CO-14: 320 stated, 300 summed
    { label: 'ERROR', extraction: { ...full(existing[0]!.extraction, [320]), amount_currency: 'USD' } }, // R051
    { label: 'ERROR', extraction: { ...full(existing[0]!.extraction, [320]), invoice_number: undefined } }, // BR-02
  ]
  it('a constructed set with the new classes: 0.1.0 misses 3 of 5 errors; 0.2.0 FAILs 4 and holds the fifth open at the gate, which the raw outcome counts as a miss', () => {
    const cases = JSON.parse(JSON.stringify(constructed)) as LabeledCase[]
    const m1 = measureRuleset(V1, cases), m2 = measureRuleset(V2, cases)
    expect(m1.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 3, abstain: 0, total: 7 })
    expect(m2.metrics).toMatchObject({ tp: 4, tn: 2, fp: 0, fn: 1, abstain: 0, total: 7 })
    expect([m1.accuracy.fn_rate, m2.accuracy.fn_rate]).toEqual([0.6, 0.2])
    expect([m1.accuracy.measured_on, m2.accuracy.measured_on]).toEqual(['2c77257d5091ef4e2f48d8ce41be571caa29705f12283db8ec9dc78f7cb572c5', 'c795d971db33b7c6f6d81177c9cc2775d01de8e9cc46fde614e2904baba7b037'])
    // the "miss" is the missing invoice number: its presence check abstains, so the raw outcome is PASS, and the gate holds it
    const g = cases.map(c => gateStatus(verifyDeclarative(c.extraction, V2)))
    expect(g).toEqual(['PASS', 'PASS', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'PASS-WITH-OPEN'])
    expect(cases.map(c => gateStatus(verifyDeclarative(c.extraction, V1)))).toEqual(['PASS', 'PASS', 'FAIL', 'FAIL', 'PASS', 'PASS', 'PASS'])
  })
})

describe('4. UNREADABLE: two unreadable totals can never cancel into a PASS (the stamped-scan shape)', () => {
  const tex = (v: Verdict) => claim(v, 'document.TAX_EXCL_INT')

  it('0.1.0 under engine 0.0.1, the gap as published: an absent or null allowance and charge read as 0, and BR-CO-13 PASSes on two wrong inputs', () => {
    for (const d of [N18_SHAPE, { ...N18_SHAPE, allowance_total_amount: null, charge_total_amount: null }]) {
      const v = verifyDeclarative(d, V1, { now: NOW, engine: '0.0.1' })
      expect(tex(v)?.outcome).toBe('PASS')
    }
  })

  // every way an extraction can say "seen, not read", for the allowance and the charge, with and without the page text
  const reps: [string, unknown][] = [['null', null], ['blank', ''], ['marker', 'UNREADABLE'], ['marker, lower case', ' unreadable '], ['garbled', '°20'], ['garbled, letter O', 'E 2O']]
  for (const [an, a] of reps) for (const [cn, c] of reps) for (const withSource of [false, true]) {
    it(`0.2.0: allowance ${an}, charge ${cn}, ${withSource ? 'with' : 'without'} source text → BR-CO-13 abstains, naming both; the gate holds`, () => {
      const v = verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: a, charge_total_amount: c }, V2, { now: NOW, engine: '0.1.0', ...(withSource ? { source: { text: N18_TEXT } } : {}) })
      expect(tex(v)).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['ALLOWANCE', 'CHARGE'] } })
      expect([v.outcome, gateStatus(v), holdsAtGate(gateStatus(v))]).toEqual(['PASS', 'PASS-WITH-OPEN', true])
    })
  }

  it('a garbled string is not a number under 0.2.0: under engine 0.0.1, 0.1.0\'s lenient normalizer reads "°20" as 20 on both sides, and they cancel into a PASS', () => {
    const d = { ...N18_SHAPE, allowance_total_amount: '°20', charge_total_amount: '°20' }
    expect(tex(verifyDeclarative(d, V1, { now: NOW, engine: '0.0.1' }))).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 5900, right: 5900 } } })
    expect(tex(verifyDeclarative(d, V2, { now: NOW }))).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['ALLOWANCE', 'CHARGE'] } })
    // what still reads as a number under the 0.2.0 ruleset (engine 0.1.0's reading; engine 0.2.0 refuses a lone decimal comma
    // without a declared locale, fixv-redteam): plain and formatted amounts, a currency mark, a sign or parentheses
    for (const s of ['200', '200.00', '1,200.00', '1.200,00', 'EUR 200.00', '€ 200,00', '(200.00)']) {
      const v = verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: s, charge_total_amount: s }, V2, { now: NOW, engine: '0.1.0' })
      expect(tex(v)?.outcome).not.toBe('INSUFFICIENT_DATA')
    }
  })

  it('0.2.0: absent from the extraction but printed on the page (the blind extractor left them out): unreadable by label, never 0', () => {
    const v = verifyDeclarative(N18_SHAPE, V2, { now: NOW, source: { text: N18_TEXT } })
    expect(tex(v)).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['ALLOWANCE', 'CHARGE'] } })
    // engine 0.6.0: the detail says why the printed figure was not read; engine 0.5.0 keeps its bytes
    expect(tex(v)!.insufficiency!.detail).toBe('ALLOWANCE is printed but no value was read: the label "Document allowances" heads line 21 of the source text: "Document allowances EUR 20"; the line prints "20": an amount needs two decimals, so "20" is read as not strict, never as 20.00; CHARGE is printed but no value was read: the label "Document charges" heads line 22 of the source text: "Document charges EU 20 —E"; the line prints "20": an amount needs two decimals, so "20" is read as not strict, never as 20.00')
    expect(tex(verifyDeclarative(N18_SHAPE, V2, { now: NOW, source: { text: N18_TEXT }, engine: '0.5.0' }))!.insufficiency!.detail).toBe('ALLOWANCE is printed but no value was read: the label "Document allowances" heads line 21 of the source text: "Document allowances EUR 20"; CHARGE is printed but no value was read: the label "Document charges" heads line 22 of the source text: "Document charges EU 20 —E"')
    expect(gateStatus(v)).toBe('PASS-WITH-OPEN')
  })

  it('0.2.0, the blind extraction as it was: the total without VAT and the VAT total are named unreadable too, each at its printed line', () => {
    const v = verifyDeclarative(N18_BLIND, V2, { now: NOW, source: { text: N18_TEXT } })
    const open = v.claims.filter(c => c.outcome !== 'PASS').map(c => [c.claim_id, c.insufficiency?.reason, c.insufficiency?.missing])
    expect(open).toEqual([
      ['document.TAX_EXCL_INT', 'UNPARSEABLE', ['TAX_EXCL', 'ALLOWANCE', 'CHARGE']],
      ['document.TAX_INCL_INT', 'UNPARSEABLE', ['TAX_EXCL', 'TAX_AMT']],
      ['document.BRCO14_VAT_SUM', 'UNPARSEABLE', ['TAX_AMT']],
    ])
  })

  it('the boundary, stated: absent with no label on the page, or no page text at all, is absent, and an optional total takes 0 (EN 16931 reads an omitted BT-107/108 as 0)', () => {
    expect(tex(verifyDeclarative(N18_SHAPE, V2, { now: NOW }))?.outcome).toBe('PASS')
    const noRows = N18_TEXT.split('\n').filter(l => !/^Document (allowances|charges) E/.test(l)).join('\n')
    expect(tex(verifyDeclarative(N18_SHAPE, V2, { now: NOW, source: { text: noRows } }))?.outcome).toBe('PASS')
  })

  it('a section heading is not the row: "Document allowances and charges" alone does not make the allowance unreadable', () => {
    const text = 'Document allowances and charges\nTotal without VAT EUR 5,900.00'
    const v = verifyDeclarative(N18_SHAPE, V2, { now: NOW, source: { text } })
    expect(tex(v)?.outcome).toBe('PASS')
  })

  it('PROPERTY (500 seeded invoices): whatever the amounts, two unreadable totals never give BR-CO-13 a PASS under 0.2.0', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const unreadable = [null, '', 'UNREADABLE', '#,##', undefined]
    let checked = 0
    for (let i = 0; i < 500; i++) {
      const net = Math.round(rnd() * 1e6) / 100, x = Math.round(rnd() * 1e5) / 100
      const a = unreadable[Math.floor(rnd() * unreadable.length)], c = unreadable[Math.floor(rnd() * unreadable.length)]
      const text = `Sum of line net amounts EUR ${net}\nDocument allowances EUR ##\nDocument charges EUR ##\nTotal without VAT EUR ${net}`
      const doc = { line_extension_amount: net, lines: [{ line_extension_amount: net, invoiced_quantity: 1, price_amount: net }], tax_exclusive_amount: net, allowance_total_amount: a, charge_total_amount: c, x }
      const v = verifyDeclarative(doc, V2, { now: NOW, source: { text } })
      expect(tex(v)?.outcome).toBe('INSUFFICIENT_DATA')
      checked++
    }
    expect(checked).toBe(500)
  })
})

describe('5. an unreadable operand\'s remedy names the field, the value as reported, and the line that prints it', () => {
  it('printed but not read: missing-operand, naming role, path, BT term and the source line', () => {
    const v = verifyDeclarative(N18_SHAPE, V2, { now: NOW, source: { text: N18_TEXT }, engine: '0.2.0' })
    const r = v.remedies!.filter(x => x.claims.includes('document.TAX_EXCL_INT'))
    expect(r.map(x => [x.kind, x.operand])).toEqual([
      ['missing-operand', { source: 'e-invoice', role: 'ALLOWANCE', path: 'allowance_total_amount' }],
      ['missing-operand', { source: 'e-invoice', role: 'CHARGE', path: 'charge_total_amount' }],
    ])
    expect(r[0]!.detail).toBe('supply ALLOWANCE (allowance_total_amount), BT-107 Sum of allowances on document level (cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount): unreadable at line 21 of the source text: "Document allowances EUR 20"; no value was read. Read it off the document and run the check again')
  })

  it('reported unreadable: the value as reported and the path it was reported at; a garbled value is located on the page by its raw string', () => {
    const v = verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: null, charge_total_amount: '°20' }, V2, { now: NOW, source: { text: `${N18_TEXT}\nCharges °20` }, engine: '0.2.0' })
    const r = v.remedies!.filter(x => x.claims.includes('document.TAX_EXCL_INT'))
    expect(r[0]!.detail).toBe('supply ALLOWANCE (allowance_total_amount), BT-107 Sum of allowances on document level (cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount): unreadable; reported as null. Read it off the document and run the check again')
    expect(r[1]!.detail).toBe('supply CHARGE (charge_total_amount), BT-108 Sum of charges on document level (cac:LegalMonetaryTotal/cbc:ChargeTotalAmount): unreadable at line 29 of the source text: "Charges °20"; reported as "°20". Read it off the document and run the check again')
  })

  it('a page break in the source text gives the page; a line operand names its own line', () => {
    const v = verifyDeclarative({ ...N18_SHAPE, tax_amount: undefined }, V2, { now: NOW, source: { text: `Page one\fItems\nVAT total EUR ###` } })
    expect(v.remedies!.find(x => x.operand?.role === 'TAX_AMT')!.detail).toContain('unreadable at page 2, line 2 of the source text: "VAT total EUR ###"')
    const lines = N18_SHAPE.lines.map((l, i) => (i === 2 ? { ...l, line_charge_amount: null } : l))
    const lv = verifyDeclarative({ ...N18_SHAPE, lines }, V2, { now: NOW })
    expect(claim(lv, 'line[2].LINE_MATH_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['LINE_CHARGE'] } })
    expect(lv.remedies!.find(x => x.claims.includes('line[2].LINE_MATH_INT'))!.operand).toEqual({ source: 'e-invoice', role: 'LINE_CHARGE', path: 'lines[2].line_charge_amount' })
  })

  it('a field simply missing names its path and term too; 0.1.0\'s remedies under engine 0.0.1 keep their old wording (a verdict issued under it replays)', () => {
    const v2 = verifyDeclarative({ ...CLEAN, tax_exclusive_amount: undefined }, V2, { now: NOW })
    expect(v2.remedies!.find(x => x.operand?.role === 'TAX_EXCL')!.detail).toBe('supply TAX_EXCL (tax_exclusive_amount), BT-109 Invoice total amount without VAT (cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount): the rule cannot run without it')
    const v1 = verifyDeclarative({ ...CLEAN, tax_exclusive_amount: undefined, allowance_total_amount: 'UNREADABLE' }, V1, { now: NOW, engine: '0.0.1' })
    expect(v1.remedies!.map(x => x.detail)).toContain('supply TAX_EXCL: the rule cannot run without it')
    expect(v1.remedies!.find(x => x.operand?.role === 'ALLOWANCE')!.kind).toBe('recompute-with')
  })
})

describe('6. a 0.2.0 verdict issued with --source replays byte-identical from the CLI', () => {
  it('issue with --source --quotes --gate, then `verify replay` re-performs it; changing one source byte is refused on the binding; dropping --source is named as a usage error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r4-peppol-replay-'))
    const p = (n: string) => join(dir, n)
    writeFileSync(p('doc.json'), JSON.stringify(N18_SHAPE)); writeFileSync(p('src.txt'), N18_TEXT)
    writeFileSync(p('q.json'), JSON.stringify([{ id: 'invoice_number', quote: 'Snippet1' }, { id: 'payable_amount', quote: '6,125.00' }]))
    let out = '', err = ''
    expect(run([p('doc.json'), '--ruleset', V2_PATH, '--source', p('src.txt'), '--quotes', p('q.json'), '--gate'], { out: s => { out += s }, err: s => { err += s } })).toBe(2)
    // Engine 0.3.0 (the CLI's engine): the printed-but-unread totals are struck fields, so the gate reads OPEN (was PASS-WITH-OPEN)
    expect(err).toContain('verify: OPEN:')
    writeFileSync(p('verdict.json'), out)
    const issued = JSON.parse(out) as Verdict
    expect([issued.ruleset.version, issued.references.source]).toEqual(['0.2.0', true])
    let rOut = ''
    expect(run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', V2_PATH, '--source', p('src.txt'), '--quotes', p('q.json')], { out: s => { rOut += s }, err: () => {} })).toBe(0)
    const r = JSON.parse(rOut) as { status: string; id_ok: boolean; input_ok: boolean; reperformed: { identical: boolean } }
    expect([r.status, r.id_ok, r.input_ok, r.reperformed.identical]).toEqual(['REPERFORMED', true, true, true])
    writeFileSync(p('src2.txt'), N18_TEXT.replace('Amount due for payment', 'Amount due for paymenT'))
    expect(run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', V2_PATH, '--source', p('src2.txt'), '--quotes', p('q.json')], { out: () => {}, err: () => {} })).toBe(1)
    // 2026-10-04: leaving out inputs the verdict names is a usage error, named in one line before any
    // hash is compared (exit 3). It used to be exit 1, "input_hash does not match", the words a forged binding gets.
    let dropErr = ''
    expect(run(['replay', p('verdict.json'), '--extraction', p('doc.json'), '--ruleset', V2_PATH], { out: () => {}, err: s => { dropErr += s } })).toBe(3)
    expect(dropErr).toBe('verify replay: this verdict was issued with page text, quotes and an external extraction under ruleset peppol-en16931@0.2.0: pass --extraction <file>, --ruleset peppol-en16931@0.2.0 (or its file), --source <file> and --quotes <file>; this call leaves out --source and --quotes\n')
  })

  it('the same document under 0.1.0 keeps its verdict id from before this change under engine 0.0.1, and replays', () => {
    const v = verifyDeclarative(N18_SHAPE, V1, { now: NOW, engine: '0.0.1' })
    const again = verifyDeclarative(N18_SHAPE, V1, { now: NOW, engine: '0.0.1' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(v))
    expect(v.verdict_id).toBe(V1_N18_ID)
  })
})

describe('7. lint of the new keys; a ruleset without the flag behaves exactly as before', () => {
  const base: DeclarativeRuleset = { id: 'mini', version: '1.0.0', fields: { A: { paths: ['a'], default: 0 }, T: { paths: ['t'] }, L: { paths: ['l'], line: true } }, checks: [{ code: 'C', left: 'T', op: '=', right: 'A + sum(L)' }] }
  it('labels on a line field, a non-boolean flag and an empty term are errors; labels with the flag turned off are a warning', () => {
    expect(lintRuleset({ ...base, distinguish_unreadable: true, fields: { ...base.fields, L: { paths: ['l'], line: true, labels: ['Line'] } } }).errors).toEqual(['field "L": "labels" are read for document fields only (this is a line field)'])
    expect(lintRuleset({ ...base, distinguish_unreadable: 'yes' as never }).errors).toEqual(['"distinguish_unreadable" must be true or false'])
    expect(lintRuleset({ ...base, fields: { ...base.fields, A: { paths: ['a'], term: ' ' } } }).errors).toEqual(['field "A": "term" must be a non-empty string'])
    // 2026-10-03: labels are read unless the ruleset turns absent-vs-unreadable off (the engine 0.1.0 default is on)
    expect(lintRuleset({ ...base, distinguish_unreadable: false, fields: { ...base.fields, A: { paths: ['a'], default: 0, labels: ['Allowance'] } } }).warnings).toContain('field "A": "labels" are not read: the ruleset sets "distinguish_unreadable": false')
    expect(lintRuleset({ ...base, fields: { ...base.fields, A: { paths: ['a'], default: 0, labels: ['Allowance'] } } }).warnings.filter(w => w.includes('labels'))).toEqual([])
  })
  it('under engine 0.0.1, without the flag, null and "" are absent (the default applies) and labels are ignored, so the verdict is byte-identical to the same ruleset without labels', () => {
    const doc = { a: null, t: 10, line_items: [{ l: 10 }] }
    const E = { now: NOW, engine: '0.0.1' }
    const plain = verifyDeclarative(doc, base, E)
    expect(claim(plain, 'document.C')?.outcome).toBe('PASS')
    const labelled = verifyDeclarative(doc, { ...base, fields: { ...base.fields, A: { paths: ['a'], default: 0, labels: ['Allowance'] } } }, { ...E, source: { text: 'Allowance ##' } })
    expect(claim(labelled, 'document.C')?.outcome).toBe('PASS')
    const strict = verifyDeclarative(doc, { ...base, distinguish_unreadable: true }, E)
    expect(claim(strict, 'document.C')?.insufficiency?.reason).toBe('UNPARSEABLE')
  })
})

/** The 0.1.0 verdict id for the stamped-scan shape, computed by the engine before this change (backup build, 2026-10-03; engine 0.0.1). */
const V1_N18_ID = '89c4dc4280555c16548a4a5ce425c5cc'
