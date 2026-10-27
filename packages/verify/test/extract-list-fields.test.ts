/**
 * The extraction contract for list fields (T2, 2026-10-03; T1's open gap): a ruleset field with `each` (Peppol 0.3.0's every
 * VAT breakdown row) gets an array schema whose items each carry a value and its provenance, and an envelope's list is
 * lowered to the list's array path, one element per item. A ruleset without a list field keeps the schema it had: its bytes
 * are pinned below (sha256 of `verify extract-schema` before this change).
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractionSchema, validateContract, lowerContract, verifyDeclarative, type DeclarativeRuleset, type ContractEnvelope } from '../src/index'

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
const load = (f: string): DeclarativeRuleset => JSON.parse(readFileSync(join(EX, f), 'utf8')) as DeclarativeRuleset
const v03 = load('peppol-en16931.ruleset.v0.3.json')
const sha = (x: unknown): string => createHash('sha256').update(`${JSON.stringify(x, null, 2)}\n`, 'utf8').digest('hex')
const prov = (line: number, raw: string) => ({ page: 1, line, raw, reader: 'pdf-text-layer+ocr-a' })

/** A valid 0.3.0 envelope: every document field read or named not printed, two VAT rows, two lines. */
function envelope(rows: unknown[]): ContractEnvelope {
  const fields: Record<string, unknown> = {
    SUM_LINE_NET: { value: 1300, provenance: prov(20, '1,300.00') }, TAX_EXCL: { value: 1325, provenance: prov(22, '1,325.00') },
    CHARGE: { value: 25, provenance: prov(21, '25.00') }, TAX_AMT: { value: 331.25, provenance: prov(23, '331.25') },
    TAX_INCL: { value: 1656.25, provenance: prov(24, '1,656.25') }, PAYABLE: { value: 1656.25, provenance: prov(25, '1,656.25') },
    INVOICE_NUMBER: { value: 'A1', provenance: prov(2, 'A1') }, ISSUE_DATE: { value: '2026-10-01', provenance: prov(3, '2026-10-01') },
    DOC_CURRENCY: { value: 'EUR', provenance: prov(4, 'EUR') }, AMOUNT_CURRENCY: { value: 'EUR', provenance: prov(20, 'EUR') },
    VBD_TAX: rows,
  }
  const not_printed = Object.fromEntries(['ALLOWANCE', 'PREPAID', 'ROUNDING'].map(r => [r, { labels_searched: [] }]))
  const line = (q: number, p: number, n: number, l: number) => ({ fields: { LINE_EXT: { value: n, provenance: prov(l, String(n)) }, LINE_NET_EXACT: { value: n, provenance: prov(l, String(n)) }, QTY: { value: q, provenance: prov(l, String(q)) }, PRICE: { value: p, provenance: prov(l, String(p)) } }, not_printed: Object.fromEntries(['BASE_QTY', 'LINE_ALLOWANCE', 'LINE_CHARGE', 'LINE_ALLOWANCE_CHARGE_LIST'].map(r => [r, { labels_searched: [] }])) })
  return { extraction_contract: '0.1', ruleset: 'peppol-en16931@0.3.0', fields, not_printed, lines: [line(7, 400, 2800, 10), line(-3, 500, -1500, 11)] } as unknown as ContractEnvelope
}

describe('list fields under the extraction contract', () => {
  it('the schema: an array of fields, one per element, each with its provenance; at least one item', () => {
    const p = (extractionSchema(v03) as { properties: { fields: { properties: Record<string, Record<string, unknown>> } } }).properties.fields.properties.VBD_TAX!
    expect(p).toMatchObject({ type: 'array', minItems: 1, items: { $ref: '#/$defs/field_number' }, 'x-kind': 'amount', 'x-each': ['vat_breakdown', 'VatBreakdown', 'tax_subtotals', 'TaxSubtotal'], 'x-paths': ['tax_amount', 'TaxAmount'] })
  })
  it('a valid envelope validates; an item without provenance, or an empty list, does not', () => {
    expect(validateContract(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 31.25, provenance: prov(31, '31.25') }]), v03)).toEqual([])
    const noProv = validateContract(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 31.25 }]), v03)
    expect(noProv[0]).toMatchObject({ code: 'contract.provenance', pointer: '/fields/VBD_TAX/1/provenance' })
    expect(validateContract(envelope([]), v03)[0]).toMatchObject({ pointer: '/fields/VBD_TAX' })
    // an UNREADABLE item needs its readings, like any field
    expect(validateContract(envelope([{ value: 'UNREADABLE', provenance: prov(30, '3O0.00') }]), v03)[0]).toMatchObject({ code: 'contract.provenance', pointer: '/fields/VBD_TAX/0/provenance/readings' })
  })
  it('lowering puts each item at the field path inside its element, with its provenance', () => {
    const lowered = lowerContract(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 31.25, provenance: prov(31, '31.25') }]), v03)
    expect(lowered.extraction.vat_breakdown).toEqual([{ tax_amount: 300 }, { tax_amount: 31.25 }])
    expect(lowered.provenance.get('vat_breakdown[1].tax_amount')).toMatchObject({ line: 31, raw: '31.25' })
  })
  it('0.3.0 reads an envelope with VAT rows as it reads the same plain extraction: BR-CO-14 passes, and fails on a wrong row', () => {
    const ok = verifyDeclarative(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 31.25, provenance: prov(31, '31.25') }]) as never, v03)
    expect(ok.claims.find(c => c.claim_id === 'document.BRCO14_VAT_SUM')!.outcome).toBe('PASS')
    const bad = verifyDeclarative(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 41.25, provenance: prov(31, '41.25') }]) as never, v03)
    expect(bad.claims.find(c => c.claim_id === 'document.BRCO14_VAT_SUM')!.outcome).toBe('FAIL')
  })
  it('an UNREADABLE row fails BR-CO-14 (fail_if_unreadable), naming the row', () => {
    const v = verifyDeclarative(envelope([{ value: 300, provenance: prov(30, '300.00') }, { value: 'UNREADABLE', provenance: { ...prov(31, '3l.25'), readings: [{ reader: 'pdf-text-layer', raw: '3l.25' }, { reader: 'ocr-a', raw: '31.25' }] } }]) as never, v03)
    const c = v.claims.find(x => x.claim_id === 'document.BRCO14_VAT_SUM')!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/vat_breakdown\[1\]\.tax_amount/)
  })
  it('a ruleset without a list field gets exactly the schema it got before', () => {
    // 2026-10-03 added ONE optional property to the provenance definition, `tier` (E1/E2/E3). Removed again, every schema
    // gives T2's pinned bytes exactly, so nothing else moved; the new bytes are pinned beside them.
    const withoutTier = (x: unknown): unknown => { const c = structuredClone(x) as { $defs: { provenance: { properties: Record<string, unknown> } } }; delete c.$defs.provenance.properties.tier; return c }
    const pins: [unknown, string, string][] = [
      [extractionSchema(load('peppol-en16931.ruleset.json')), '77f783f09d780277ec13c17ecfa9b391c7230c6d8691ae65436fc2746d727f4f', '8b622540088d8773d3f2798f0fefdaed90f3373adf32dd11c464c9788dce2c93'],
      [extractionSchema(load('peppol-en16931.ruleset.v0.2.json')), '57885a069b25c2f0d2b55431ed2270c6b1cde1417fc3a4ebf83d0a0bc4cc758b', 'f54917150c268b7c346c61114f2e07a6ac52ad1e5fbb753313c19dfca74d21d0'],
      // 2026-10-05: a bare 'legal' now means the engine's default rule (legal@0.3.0 under engine 0.6.0 from 2026-10-05), so the 0.0.1 pin names its version.
      [extractionSchema('legal@0.0.1'), '5e6245572fac15244091680e4d0ef05611375a5b63329a6f8eec2ca237000cb3', '4733200dcdbfb0a983e7d313552bbe3a64eddff6ecccea57969881e564a4e650'],
      [extractionSchema('legal@0.2.0'), '0721573be2237fb61b893b3abfd3b1f6e459d38d028320d49801f24b904f13bc', '09446891b709c5804a39df41f3cf8da67ec45a2e4b647aff708cb49a392f33ed'],
    ]
    for (const [schema, t2, v1b] of pins) {
      expect(sha(withoutTier(schema))).toBe(t2)
      expect(sha(schema)).toBe(v1b)
    }
    // 2026-10-05 (engine 0.6.0): a bare 'legal' is the engine default rule's schema (legal@0.3.0 from 2026-10-05; see docs/LEGAL.md 'How the default is chosen').
    // then to 0.3.0, 0.4.0 and 0.5.0 later the same day
    expect(sha(extractionSchema('legal'))).toBe(sha(extractionSchema('legal@0.5.4'))) // 0.5.1, then 0.5.2, on 2026-10-06; 0.5.3 on 2026-10-13; 0.5.4 on 2026-10-14
  })
})
