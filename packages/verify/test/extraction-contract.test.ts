/**
 * The extraction contract (T1, 2026-10-03): the pre-pass every extractor must satisfy before verify will read its output,
 * when a ruleset asks for it.
 *
 *   1. schema per ruleset, generated from its fields block (and the legal ruleset's citation parts)
 *   2. provenance per field is required; every field is accounted for; no unknown term
 *   3. require_contract: a ruleset with the flag refuses what breaks the contract, with a typed remedy naming the first violation;
 *      a valid envelope gives the verdict its lowering gives; without the flag nothing about existing inputs moves
 *   4. two readers: agreement, disagreement (UNREADABLE with both readings), absence (not_printed)
 *   5. canonicalization: the fixed list, and nothing beyond it
 *   6. nothing invents: labels head their row and are maximal; currency only from the page
 *   7. an UNREADABLE value's provenance reaches its remedy (page and line)
 *   8. legal: quotations read by pointer alignment; an UNREADABLE quotation is withheld from the check
 *   9. readers: PNM handling (pure), and the PDF text layer when pdfjs-dist is installed
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyDeclarative, verifyInputHash, lintRuleset, gateStatus, type DeclarativeRuleset, type Verdict,
  extractionSchema, validateContract, lowerContract, isContractEnvelope, CONTRACT_VERSION, UNREADABLE,
  canonicalText, canonicalLines, sameText, readAmount, readCurrencyMark, detectDecimal,
  decideField, buildEnvelope, alignLines, readLabelled, findLabel, readLabelledFields, pageTokens, alignPointer, contractToCitations,
  readPnm, writePgm, toGrey, rotateGrey, saturatedShare, toRows, readTextLayer,
  type ContractEnvelope, type FieldReading, type Row, type Word, type PageRead,
} from '../src/index'
import { run } from '../src/cli'

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
const V2 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.2.json'), 'utf8')) as DeclarativeRuleset
const NOW = () => new Date('2026-10-03T00:00:00Z')
const SHY = String.fromCharCode(0x00ad)
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)

// a clean invoice in the extraction shape 0.2.0 reads
const CLEAN = {
  invoice_number: 'INV-2026-001', issue_date: '2026-10-01', currency: 'EUR', amount_currency: 'EUR',
  line_extension_amount: 300, tax_exclusive_amount: 300, tax_amount: 75, tax_inclusive_amount: 375, payable_amount: 375,
  vat_breakdown: [{ tax_amount: 75 }],
  lines: [{ invoiced_quantity: 2, price_amount: 50, line_extension_amount: 100 }, { invoiced_quantity: 1, price_amount: 200, line_extension_amount: 200 }],
}
const getPath = (o: unknown, p: string): unknown => p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce<unknown>((x, k) => (x !== null && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)
/** An envelope for `ex`: every field at its first path read (with a stub provenance), every other field named not_printed. */
function envelopeFrom(ex: Record<string, unknown>, rs: DeclarativeRuleset): ContractEnvelope {
  const prov = (v: unknown, line: number) => ({ page: 1, line, raw: String(v), reader: 'reader-a+reader-b', readings: [{ reader: 'reader-a', raw: String(v) }, { reader: 'reader-b', raw: String(v) }] })
  const env: ContractEnvelope = { extraction_contract: CONTRACT_VERSION, ruleset: `${rs.id}@${rs.version}`, fields: {}, not_printed: {} }
  let line = 1
  for (const [role, f] of Object.entries(rs.fields)) {
    if (f.line) continue
    const v = getPath(ex, f.paths[0]!)
    if (v === undefined) env.not_printed![role] = { labels_searched: f.labels ?? [] }
    else env.fields[role] = { value: v as number | string, provenance: prov(v, line++) }
  }
  const lines = (ex.lines as Record<string, unknown>[] | undefined) ?? []
  env.lines = lines.map(l => {
    const out: { fields: ContractEnvelope['fields']; not_printed: Record<string, { labels_searched: string[] }> } = { fields: {}, not_printed: {} }
    for (const [role, f] of Object.entries(rs.fields)) {
      if (!f.line) continue
      const v = getPath(l, f.paths[0]!)
      if (v === undefined) out.not_printed[role] = { labels_searched: [] }
      else out.fields[role] = { value: v as number, provenance: prov(v, line++) }
    }
    return out
  })
  return env
}
const FLAGGED: DeclarativeRuleset = { ...structuredClone(V2), require_contract: true }

describe('1. the schema is generated from the ruleset', () => {
  it('Peppol 0.2.0: one property per field term, typed by kind, described by its BT term; line fields under lines[]', () => {
    const s = extractionSchema(V2) as Record<string, any>
    const doc = Object.keys(V2.fields).filter(r => !V2.fields[r]!.line)
    const line = Object.keys(V2.fields).filter(r => V2.fields[r]!.line)
    expect(Object.keys(s.properties.fields.properties)).toEqual(doc)
    expect(Object.keys(s.$defs.line.properties.fields.properties)).toEqual(line)
    expect(s.properties.ruleset).toEqual({ const: 'peppol-en16931@0.2.0' })
    expect(s.properties.fields.properties.PAYABLE.$ref).toBe('#/$defs/field_number')
    expect(s.properties.fields.properties.PAYABLE.description).toMatch(/^BT-115 Amount due for payment/)
    expect(s.properties.fields.properties.INVOICE_NUMBER.$ref).toBe('#/$defs/field_text')
    expect(s.$defs.provenance.required).toEqual(['page', 'line', 'raw', 'reader'])
    expect(s.properties.fields.additionalProperties).toBe(false)
    expect(s.allOf).toHaveLength(doc.length) // every document field accounted for
  })
  it('a new ruleset gets its schema for free', () => {
    const rs: DeclarativeRuleset = { id: 'mini', version: '1.0.0', fields: { TOTAL: { paths: ['total'] }, REF: { paths: ['ref'], kind: 'identifier' }, AMT: { paths: ['amount'], line: true } }, checks: [{ code: 'SUM', left: 'TOTAL', op: '=', right: 'sum(AMT)' }] }
    const s = extractionSchema(rs) as Record<string, any>
    expect(Object.keys(s.properties.fields.properties)).toEqual(['TOTAL', 'REF'])
    expect(Object.keys(s.$defs.line.properties.fields.properties)).toEqual(['AMT'])
    expect(s.$id).toBe(`urn:verify:extraction-contract:${CONTRACT_VERSION}:mini@1.0.0`)
  })
  it('the legal ruleset: citation parts; quote and proposition read off the page, the resolver keys may be supplied', () => {
    const s = extractionSchema('legal@0.0.1') /* 2026-10-05: a bare 'legal' is now the engine default (0.2.0 from 0.6.0); these fixtures are 0.0.1 envelopes */ as Record<string, any>
    expect(Object.keys(s.$defs.citation.properties.fields.properties)).toEqual(['quote', 'proposition', 'cite', 'case_name', 'source_key'])
    expect(s.$defs.citation.properties.fields.properties.quote.$ref).toBe('#/$defs/field_text')
    expect(s.$defs.citation.properties.fields.properties.cite.$ref).toBe('#/$defs/field_text_supplied')
    expect(s.properties.ruleset).toEqual({ const: 'legal@0.0.1' })
    expect(() => extractionSchema('invoice')).toThrow(/no extraction contract/)
  })
  it('CLI: verify extract-schema prints the schema; --validate checks an envelope', () => {
    const out: string[] = [], err: string[] = []
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }
    expect(run(['extract-schema', 'peppol-en16931'], io)).toBe(0)
    // 2026-10-05: under engine 0.6.0 the bare name resolves to peppol-en16931@0.3.0, the version MISSES F4 and F8 were fixed in; engines 0.1.0 to 0.5.0 resolve it to 0.2.0, and a replay re-performs under the version the verdict names.
    expect(JSON.parse(out.join('')).$id).toBe('urn:verify:extraction-contract:0.1:peppol-en16931@0.3.0')
    expect(run(['extract-schema'], io)).toBe(3)
  })
})

describe('2. provenance is required; every field is accounted for; no unknown term', () => {
  it('a valid envelope has no violation', () => {
    expect(validateContract(envelopeFrom(CLEAN, V2), V2)).toEqual([])
  })
  it('a field without provenance is named', () => {
    const env = envelopeFrom(CLEAN, V2)
    delete (env.fields.PAYABLE as { provenance?: unknown }).provenance
    const v = validateContract(env, V2)
    expect(v[0]).toMatchObject({ code: 'contract.provenance', pointer: '/fields/PAYABLE/provenance' })
  })
  it('provenance without page, line, raw or reader is named', () => {
    const env = envelopeFrom(CLEAN, V2)
    delete (env.fields.PAYABLE!.provenance as { line?: unknown }).line
    expect(validateContract(env, V2)[0]).toMatchObject({ code: 'contract.provenance', pointer: '/fields/PAYABLE/provenance/line' })
  })
  it('a field neither read nor named in not_printed is named', () => {
    const env = envelopeFrom(CLEAN, V2)
    delete env.not_printed!.PREPAID
    const v = validateContract(env, V2)
    expect(v.map(x => x.code)).toEqual(['contract.unaccounted'])
    expect(v[0]!.pointer).toBe('/fields/PREPAID')
  })
  it('an unknown term is refused, not ignored; a wrong kind is named; the marker needs its readings', () => {
    const env = envelopeFrom(CLEAN, V2)
    ;(env.fields as Record<string, unknown>).PAYABLE_AMT = env.fields.PAYABLE
    expect(validateContract(env, V2).some(x => x.code === 'contract.unknown_term' && x.pointer === '/fields/PAYABLE_AMT')).toBe(true)
    const e2 = envelopeFrom(CLEAN, V2)
    e2.fields.PAYABLE!.value = '375.00'
    expect(validateContract(e2, V2)[0]).toMatchObject({ code: 'contract.invalid_value', pointer: '/fields/PAYABLE/value' })
    const e3 = envelopeFrom(CLEAN, V2)
    e3.fields.PAYABLE = { value: UNREADABLE, provenance: { page: 1, line: 9, raw: '3?5', reader: 'a+b' } }
    expect(validateContract(e3, V2)[0]).toMatchObject({ code: 'contract.provenance', pointer: '/fields/PAYABLE/provenance/readings' })
  })
  it('not an envelope at all', () => {
    expect(validateContract(CLEAN, V2)[0]!.code).toBe('contract.not_envelope')
    expect(validateContract({ ...envelopeFrom(CLEAN, V2), ruleset: 'peppol-en16931@0.1.0' }, V2)[0]!.code).toBe('contract.ruleset')
  })
})

describe('3. require_contract (opt-in, default off)', () => {
  it('lints as a boolean', () => {
    expect(lintRuleset(FLAGGED).ok).toBe(true)
    expect(lintRuleset({ ...FLAGGED, require_contract: 'yes' }).errors).toContain('"require_contract" must be true or false')
  })
  it('refuses an extraction that is not an envelope: no check runs, a typed remedy names the violation', () => {
    const v = verifyDeclarative(CLEAN, FLAGGED, { now: NOW })
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    expect(gateStatus(v)).not.toBe('PASS')
    expect(v.claims.map(c => c.claim_id)).toEqual(['contract.EXTRACTION_CONTRACT'])
    expect(claim(v, 'contract.EXTRACTION_CONTRACT')!.insufficiency!.detail).toMatch(/^contract\.not_envelope/)
    expect(v.remedies?.[0]).toMatchObject({ kind: 'missing-operand', operand: { source: 'extraction', path: '/' } })
  })
  it('refuses an envelope that breaks the contract, naming the first violation and its pointer', () => {
    const env = envelopeFrom(CLEAN, V2)
    delete (env.fields.TAX_AMT as { provenance?: unknown }).provenance
    const v = verifyDeclarative(env as unknown as Record<string, unknown>, FLAGGED, { now: NOW })
    expect(v.claims).toHaveLength(1)
    expect(v.claims[0]!.insufficiency!.detail).toContain('/fields/TAX_AMT/provenance')
    expect(v.remedies?.[0]?.operand).toEqual({ source: 'extraction', path: '/fields/TAX_AMT/provenance' })
  })
  it('a valid envelope gives the verdict its lowering gives (claims and outcome), bound to the envelope', () => {
    const env = envelopeFrom(CLEAN, V2) as unknown as Record<string, unknown>
    const viaFlag = verifyDeclarative(env, FLAGGED, { now: NOW })
    const plain = verifyDeclarative(CLEAN, V2, { now: NOW })
    expect(plain.outcome).toBe('PASS')
    expect(viaFlag.outcome).toBe('PASS')
    expect(viaFlag.claims.map(c => [c.claim_id, c.outcome])).toEqual(plain.claims.map(c => [c.claim_id, c.outcome]))
    expect(viaFlag.input_hash).toBe(verifyInputHash(env, { ruleset: FLAGGED }))
    expect(viaFlag.input_hash).not.toBe(plain.input_hash)
  })
  it('without the flag an envelope is lowered (engine 0.1.0); a plain extraction is untouched; engine 0.0.1 never lowers', () => {
    const env = envelopeFrom(CLEAN, V2) as unknown as Record<string, unknown>
    expect(isContractEnvelope(env)).toBe(true)
    expect(verifyDeclarative(env, V2, { now: NOW }).outcome).toBe('PASS')
    const plain = verifyDeclarative(CLEAN, V2, { now: NOW })
    expect(plain.input_hash).toBe(verifyInputHash(CLEAN, { ruleset: V2 }))
    const old = verifyDeclarative(env, V2, { now: NOW, engine: '0.0.1' })
    expect(old.outcome).not.toBe('PASS') // 0.0.1 reads the envelope as a plain object: nothing at the fields' paths
    expect(verifyDeclarative(CLEAN, FLAGGED, { now: NOW, engine: '0.0.1' }).claims.some(c => c.claim_id === 'contract.EXTRACTION_CONTRACT')).toBe(false)
  })
  it('lowering puts each value at its first path; UNREADABLE stays the marker; ABSENT stays absent', () => {
    const env = envelopeFrom(CLEAN, V2)
    env.fields.TAX_EXCL = { value: UNREADABLE, provenance: { page: 1, line: 23, raw: 'E ten', reader: 'a+b', readings: [{ reader: 'a', raw: 'E ten' }, { reader: 'b', raw: null, note: 'label not found' }] } }
    const { extraction, provenance } = lowerContract(env, V2)
    expect(extraction.tax_exclusive_amount).toBe(UNREADABLE)
    expect(extraction.payable_amount).toBe(375)
    expect((extraction.vat_breakdown as { tax_amount: number }[])[0]!.tax_amount).toBe(75)
    expect('prepaid_amount' in extraction).toBe(false)
    expect((extraction.lines as unknown[]).length).toBe(2)
    expect(provenance.get('tax_exclusive_amount')).toMatchObject({ line: 23 })
    expect(provenance.get('lines[1].price_amount')).toMatchObject({ raw: '200' })
  })
})

const R = (reader: string, status: FieldReading['status'], value?: number | string, raw?: string, line = 5): FieldReading =>
  ({ status, ...(value !== undefined ? { value } : {}), ...(raw !== undefined ? { raw } : {}), ...(status !== 'not_found' ? { page: 1, line } : {}), reader })

describe('4. two readers: agreement marks a value, disagreement UNREADABLE, absence not_printed', () => {
  const names: [string, string] = ['text-layer', 'ocr-a']
  const F = { labels: ['Amount due for payment'] }
  it('agreement: the value, with both readings', () => {
    const d = decideField(F, R('text-layer', 'value', 8350, '8,350.00'), R('ocr-a', 'value', 8350, '8,350.00'), names)
    expect(d.field!.value).toBe(8350)
    expect((d.field!.provenance as { readings: unknown[] }).readings).toHaveLength(2)
    expect((d.field!.provenance as { reader: string }).reader).toBe('text-layer+ocr-a')
  })
  it('disagreement: UNREADABLE, both readings kept, no third reader', () => {
    const d = decideField(F, R('text-layer', 'value', 8350, '8,350.00'), R('ocr-a', 'value', 8850, '8,850.00'), names)
    expect(d.field!.value).toBe(UNREADABLE)
    expect((d.field!.provenance as { readings: { raw: string }[] }).readings.map(r => r.raw)).toEqual(['8,350.00', '8,850.00'])
  })
  it('a value against unparseable, or against not found, is UNREADABLE', () => {
    expect(decideField(F, R('text-layer', 'value', 1, '1,00'), R('ocr-a', 'unparseable', undefined, '1.0O'), names).field!.value).toBe(UNREADABLE)
    expect(decideField(F, R('text-layer', 'value', 1, '1,00'), R('ocr-a', 'not_found'), names).field!.value).toBe(UNREADABLE)
    expect(decideField(F, R('text-layer', 'not_found'), R('ocr-a', 'value', 1, '1,00'), names).field!.value).toBe(UNREADABLE)
  })
  it('both not found: ABSENT, with the labels searched', () => {
    const d = decideField(F, R('text-layer', 'not_found'), R('ocr-a', 'not_found'), names)
    expect(d.field).toBeUndefined()
    expect(d.not_printed).toEqual({ labels_searched: ['Amount due for payment'] })
  })
  it('strings agree after canonicalization only', () => {
    expect(decideField({}, R('a', 'value', 'O’Brien & Co'), R('b', 'value', "O'Brien  & Co"), names).field!.value).toBe('O’Brien & Co')
    expect(decideField({}, R('a', 'value', 'INV-0O1'), R('b', 'value', 'INV-001'), names).field!.value).toBe(UNREADABLE)
  })
  it('lines align by id when both read the same ids, else by position; a one-sided line is UNREADABLE throughout', () => {
    const L = (id: string, v: number) => ({ id, fields: new Map([['LINE_EXT', R('x', 'value', v, String(v))]]) })
    expect(alignLines([L('1', 1), L('2', 2)], [L('2', 2), L('1', 1)]).map(([a, b]) => [a?.id, b?.id])).toEqual([['1', '1'], ['2', '2']])
    expect(alignLines([L('A', 1), L('B', 2)], [L('A', 1), L('8', 2)]).map(([a, b]) => [a?.id, b?.id])).toEqual([['A', 'A'], ['B', '8']])
    const env = buildEnvelope({ ruleset: V2, names, doc1: new Map(), doc2: new Map(), lines1: [L('1', 100)], lines2: [L('1', 100), L('2', 200)] })
    expect(env.lines).toHaveLength(2)
    expect(env.lines![1]!.fields.LINE_EXT!.value).toBe(UNREADABLE)
    expect(env.lines![0]!.fields.LINE_EXT!.value).toBe(100)
    expect(validateContract(env, V2).filter(v => v.pointer.startsWith('/lines'))).toEqual([])
  })
})

describe('5. canonicalization: the fixed list, nothing else', () => {
  it('soft hyphens, line-break hyphenation, curly quotes, dashes, ligatures, ellipsis, whitespace, NFC', () => {
    expect(canonicalText(`con${SHY}\ntain`)).toBe('contain')
    expect(canonicalText(`con${SHY} tain`)).toBe('contain')
    expect(canonicalText(`plain${SHY}text`)).toBe('plaintext')
    expect(canonicalText('exam-\nple')).toBe('example')
    expect(canonicalText('Smith-\nJones')).toBe('Smith- Jones') // an upper-case next line keeps the hyphen
    expect(canonicalText('“quoted” ‘single’ it’s')).toBe(`"quoted" 'single' it's`)
    expect(canonicalText('1990–1999 — note')).toBe('1990-1999 - note')
    expect(canonicalText('ﬁnal ﬂow')).toBe('final flow')
    expect(canonicalText('and so…')).toBe('and so...')
    expect(canonicalText('  a \t b \n c  ')).toBe('a b c')
    expect(canonicalText('Cafe' + String.fromCharCode(0x0301))).toBe('Café')
  })
  it('no case folding and no character repair', () => {
    expect(sameText('Invoice', 'invoice')).toBe(false)
    expect(sameText('1O0', '100')).toBe(false)
    expect(sameText('', '')).toBe(false)
  })
  it('canonicalLines keeps line and page breaks', () => {
    expect(canonicalLines('a  b\n C-\nD\fx')).toBe('a b\nC-\nD\fx')
    expect(canonicalLines('exam-\nple\nnext')).toBe('example\nnext')
  })
  it('numbers read strictly, by the document decimal separator', () => {
    expect(readAmount('1,234.56', '.')).toBe(1234.56)
    expect(readAmount('1.234,56', ',')).toBe(1234.56)
    expect(readAmount('1234.56', ',')).toBeNull() // the wrong separator for this document
    expect(readAmount('1,2?4.00', '.')).toBeNull()
    expect(readAmount('°225.00', '.')).toBeNull()
    expect(readAmount('225.0', '.')).toBeNull() // an amount has exactly two decimals
    expect(detectDecimal(['1.234,56', '12,00', '7.5'])).toBe(',')
  })
})

const W = (t: string, x0: number, x1: number, y = 100): Word => ({ t, x0, x1, yTop: y - 9, yBot: y, line: null })
const row = (line: number, ...ws: Word[]): Row => ({ page: 1, line, words: ws })

describe('6. nothing invents', () => {
  it('a label must head its row segment and be maximal', () => {
    expect(findLabel([W('VAT', 300, 318), W('total', 320, 340), W('EUR', 462, 480), W('225.00', 520, 555)], 'VAT total', false)).toEqual({ start: 0, end: 1 })
    expect(findLabel([W('VAT', 300, 318), W('total', 320, 340), W('in', 343, 350), W('accounting', 353, 400), W('currency', 403, 440), W('SEK', 462, 480)], 'VAT total', false)).toBeUndefined()
    expect(findLabel([W('VAT', 300, 318), W('total', 320, 340), W('in', 343, 350), W('accounting', 353, 400), W('currency', 403, 440)], 'Currency', false)).toBeUndefined()
    expect(findLabel([W('Seller', 40, 70), W('Currency:', 200, 245), W('EUR', 260, 280)], 'Currency', false)).toEqual({ start: 1, end: 1 })
  })
  it('a page that prints no currency row gives no currency: DOC_CURRENCY is ABSENT, never read from the accounting row', () => {
    const rows = [
      row(1, W('Invoice', 40, 70), W('number:', 72, 105), W('INV-9', 140, 170)),
      row(2, W('VAT', 300, 318), W('total', 320, 340), W('EUR', 462, 480), W('225.00', 520, 555)),
      row(3, W('VAT', 300, 318), W('total', 320, 340), W('in', 343, 350), W('accounting', 353, 400), W('currency', 403, 440), W('SEK', 462, 480), W('2,452.28', 515, 555)),
    ]
    const o = { reader: 'text-layer', ocr: false, decimal: '.' as const }
    const got = readLabelledFields(rows, V2, o)
    expect(got.get('DOC_CURRENCY')!.status).toBe('not_found')
    expect(got.get('TAX_AMT')).toMatchObject({ status: 'value', value: 225, raw: '225.00', currency: 'EUR', line: 2 })
    const env = buildEnvelope({ ruleset: V2, names: ['a', 'b'], doc1: got, doc2: readLabelledFields(rows, V2, { ...o, reader: 'b' }) })
    expect(env.fields.DOC_CURRENCY).toBeUndefined()
    expect(env.not_printed!.DOC_CURRENCY).toMatchObject({ labels_searched: ['Invoice currency code', 'Currency'] })
  })
  it('a printed label whose value does not read is unparseable, never repaired', () => {
    const rows = [row(1, W('Total', 300, 320), W('without', 323, 352), W('VAT', 354, 370), W('EUR', 462, 480), W('1,2?8.99', 515, 555))]
    expect(readLabelled(rows, V2.fields.TAX_EXCL!, { reader: 'ocr-a', ocr: true, decimal: '.' })).toMatchObject({ status: 'unparseable', raw: '1,2?8.99' })
  })
  it('currency marks: an ISO code or an unambiguous symbol, nothing else', () => {
    expect(readCurrencyMark('EUR')).toBe('EUR')
    expect(readCurrencyMark('€')).toBe('EUR')
    expect(readCurrencyMark('£')).toBe('GBP')
    expect(readCurrencyMark('$')).toBeNull()
    expect(readCurrencyMark('Eur')).toBeNull()
  })
})

describe('7. an UNREADABLE value carries where it is printed to its remedy', () => {
  it('without source text, the remedy names the page line from the envelope provenance', () => {
    const env = envelopeFrom(CLEAN, V2)
    env.fields.TAX_EXCL = { value: UNREADABLE, provenance: { page: 1, line: 23, raw: 'E ten', reader: 'ocr-a+ocr-b', line_text: 'Total without VAT EUR E ten', readings: [{ reader: 'ocr-a', raw: 'E ten' }, { reader: 'ocr-b', raw: 'EUR', note: 'does not read strictly' }] } }
    const v = verifyDeclarative(env as unknown as Record<string, unknown>, V2, { now: NOW })
    const c = claim(v, 'document.TAX_EXCL_INT')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency!.reason).toBe('UNPARSEABLE')
    expect(c.insufficiency!.detail).toContain('line 23 of the source text: "Total without VAT EUR E ten"')
    expect(JSON.stringify(v.remedies)).toContain('line 23')
  })
})

describe('8. legal: a quotation read by pointer, withheld when unreadable', () => {
  const page = (words: [string, number, number][], height = 792): PageRead => ({ page: 1, reader: 'tl', width: 612, height, words: words.map(([t, x, y]) => ({ t, x0: x, x1: x + t.length * 5, yTop: y - 9, yBot: y, line: null })) })
  it('hyphenation and line numbers between the halves of a word are read through; artifacts cost nothing', () => {
    const p = page([['3', 40, 200], ['held', 72, 200], ['that', 100, 200], ['a', 130, 200], ['com-', 140, 200], ['4', 40, 224], ['plaint', 72, 224], ['must', 110, 224], ['Page', 280, 780], ['2', 310, 780]])
    const toks = pageTokens([p])
    expect(toks.map(t => t.t)).toEqual(['3', 'held', 'that', 'a', 'complaint', 'must', 'Page', '2'])
    expect(toks.find(t => t.t === 'Page')!.artifact).toBe(true)
    const a = alignPointer(['that', 'a', 'complaint', 'must'], toks)!
    expect(a.cost).toBe(0)
    expect(a.reading).toEqual(['that', 'a', 'complaint', 'must'])
  })
  it('the edge tokens are trimmed to the quotation (its own quote marks)', () => {
    const toks = pageTokens([page([['the', 72, 300], ['court', 90, 300], ['said', 120, 300], ['"we', 150, 300], ['so', 170, 300], ['hold."', 185, 300]])])
    const a = alignPointer(['we', 'so', 'hold.'], toks)!
    expect(a.reading).toEqual(['we', 'so', 'hold.'])
    expect(a.raw).toBe('"we so hold."')
  })
  it('an UNREADABLE quotation is withheld from the check, with its readings', () => {
    const got = contractToCitations({
      extraction_contract: CONTRACT_VERSION, ruleset: 'legal@0.0.1',
      citations: [
        { id: 'C1', fields: { quote: { value: 'we so hold', provenance: { page: 1, line: 2, raw: 'we so hold', reader: 'tl+ocr-a' } }, cite: { value: '1 U.S. 1', provenance: { reader: 'supplied', source: 'resolver' } } }, not_printed: { proposition: { labels_searched: [] } } },
        { id: 'C2', fields: { quote: { value: UNREADABLE, provenance: { page: 3, line: 9, raw: 'appeal1 without', reader: 'tl+ocr-a', readings: [{ reader: 'tl', raw: 'appeal without' }, { reader: 'ocr-a', raw: 'appeal! without', note: 'reads differently' }] } } }, not_printed: { proposition: { labels_searched: [] } } },
      ],
      sources: { '1 U.S. 1': { text: 'and so we so hold today', provenance: { reader: 'pdftotext', sha256: '0'.repeat(64) } } },
    })
    expect(got.citations).toEqual([{ id: 'C1', cite: '1 U.S. 1', quote: 'we so hold' }])
    expect(got.withheld.map(w => [w.id, w.field, w.readings.length])).toEqual([['C2', 'quote', 2]])
    expect(got.sources['1 U.S. 1']).toBe('and so we so hold today')
  })
  it('the legal envelope validates against the legal schema', () => {
    const env = { extraction_contract: CONTRACT_VERSION, ruleset: 'legal@0.0.1', citations: [{ id: 'C1', fields: { quote: { value: 'x y', provenance: { page: 1, line: 1, raw: 'x y', reader: 'a+b' } }, cite: { value: '1 U.S. 1', provenance: { reader: 'supplied', source: 'resolver' } } }, not_printed: { proposition: { labels_searched: [] } } }] }
    // 2026-10-05: the envelope names legal@0.0.1, so it is validated against that version's schema (a bare 'legal' is now the engine default, 0.2.0).
    expect(validateContract(env, 'legal@0.0.1')).toEqual([])
    const bad = structuredClone(env) as any
    bad.citations[0].fields.quote.provenance = { reader: 'supplied', source: 'resolver' }
    expect(validateContract(bad, 'legal@0.0.1')[0]!.code).toBe('contract.provenance')
  })
})

describe('9. readers', () => {
  it('PNM: read, write, dropout of colour ink, rotation', () => {
    // a 2×1 P6 image: one red-stamp pixel over white (198, 94, 92), one black text pixel under the stamp (127, 23, 20)
    const head = new TextEncoder().encode('P6\n2 1\n255\n')
    const buf = new Uint8Array([...head, 198, 94, 92, 127, 23, 20])
    const img = readPnm(buf)
    expect([img.width, img.height, img.channels]).toEqual([2, 1, 3])
    expect(saturatedShare(img)).toBe(1)
    expect(Array.from(toGrey(img, true, 170).data)).toEqual([255, 0]) // the stamp fades, the print stays black
    expect(Array.from(toGrey(img, false).data)).toEqual([125, 54])
    const g = { width: 2, height: 3, channels: 1 as const, data: new Uint8Array([1, 2, 3, 4, 5, 6]) }
    expect(Array.from(rotateGrey(g, 90).data)).toEqual([5, 3, 1, 6, 4, 2])
    expect(Array.from(rotateGrey(g, 180).data)).toEqual([6, 5, 4, 3, 2, 1])
    expect(Array.from(rotateGrey(g, 270).data)).toEqual([2, 4, 6, 1, 3, 5])
    expect(readPnm(writePgm(g)).data).toEqual(g.data)
  })
  it('rows: OCR words by their line key, text-layer words by baseline', () => {
    const p: PageRead = { page: 1, reader: 'x', width: 600, height: 800, words: [W('b', 50, 60, 101), W('a', 10, 20, 100), W('c', 10, 20, 120)] }
    expect(toRows(p).map(r => r.words.map(w => w.t).join(' '))).toEqual(['a b', 'c'])
  })
  it('the PDF text layer, when pdfjs-dist is installed', async () => {
    let pdfjs = true
    try { await import('pdfjs-dist/legacy/build/pdf.mjs' as string) } catch { pdfjs = false }
    if (!pdfjs) return
    // a one-page PDF with one line of Helvetica text, built here with its cross-reference offsets
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    const stream = 'BT /F1 12 Tf 72 700 Td (Amount due for payment EUR 8,350.00) Tj ET'
    let pdf = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
    offs.push(pdf.length); pdf += `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    const xref = pdf.length
    pdf += `xref\n0 6\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const pages = await readTextLayer(new TextEncoder().encode(pdf))
    expect(pages).toHaveLength(1)
    const rows = toRows(pages[0]!)
    expect(rows.map(r => r.words.map(w => w.t).join(' '))).toEqual(['Amount due for payment EUR 8,350.00'])
    expect(readLabelled(rows, V2.fields.PAYABLE!, { reader: 'pdf-text-layer', ocr: false, decimal: '.' })).toMatchObject({ status: 'value', value: 8350, raw: '8,350.00', currency: 'EUR', page: 1, line: 1 })
  })
})
