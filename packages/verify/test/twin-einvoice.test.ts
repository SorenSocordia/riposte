/**
 * E-invoice structured-twin mode (src/twin-einvoice): CONSTRUCTED fixtures only (test/fixtures/einvoice/*.xml,
 * XSD-valid against UBL 2.1 and KSeF FA(3); parties and numbers fictitious). Covers the XML reader, profile
 * detection, every PASS / FAIL diagnosis / ABSTAIN reason, the XML's own footing (BR-CO-*), evidence spans,
 * determinism and replay, and the embedded house rulesets against the shipped JSON files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyEinvoiceTwin, einvoiceVerdictInput, parseXml, XmlParseError, detectProfile, EINVOICE_MAPS, SOURCES,
  HOUSE_PEPPOL_RULESET, HOUSE_ZATCA_RULESET, HOUSE_KSEF_RULESET, PEPPOL_TWIN_FOOTING, PEPPOL_LINE_SLACK,
  type EinvoiceClaim, type EinvoiceJudgment,
} from '../src/twin-einvoice/index'
import { verifyReplay } from '../src/protocol/replay'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (f: string): string => readFileSync(join(HERE, 'fixtures', 'einvoice', f), 'utf8')
const example = (f: string): unknown => JSON.parse(readFileSync(join(HERE, '..', 'docs', 'examples', f), 'utf8'))
const PEPPOL = fixture('peppol-bis3-invoice.xml')
const ZATCA = fixture('zatca-standard-invoice.xml')
const KSEF = fixture('ksef-fa3-invoice.xml')
const OPTS = { now: () => new Date('2026-09-28T12:00:00Z') }

const judge = (xml: string, claims: EinvoiceClaim[]): EinvoiceJudgment[] => verifyEinvoiceTwin(xml, claims, OPTS).judgments
const one = (xml: string, field: string, value: number | string, extra: Partial<EinvoiceClaim> = {}): EinvoiceJudgment =>
  judge(xml, [{ id: field, field, value, ...extra }])[0]!
/** Replace exactly one occurrence (a tampered copy of a fixture). */
const tamper = (xml: string, from: string, to: string): string => {
  const i = xml.indexOf(from)
  if (i < 0 || xml.indexOf(from, i + 1) >= 0) throw new Error(`tamper: "${from}" must occur exactly once`)
  return xml.slice(0, i) + to + xml.slice(i + from.length)
}

describe('the embedded house rulesets are the shipped JSON files (drift guard)', () => {
  it('all three are verbatim; the twin runs the shipped Peppol ruleset unchanged (E-INVOICE-2 dropped the 0.02 override)', () => {
    expect(HOUSE_ZATCA_RULESET).toEqual(example('zatca-ksa.ruleset.json'))
    expect(HOUSE_KSEF_RULESET).toEqual(example('ksef-fa3.ruleset.json'))
    expect(HOUSE_PEPPOL_RULESET).toEqual(example('peppol-en16931.ruleset.json'))
    expect(PEPPOL_TWIN_FOOTING).toBe(HOUSE_PEPPOL_RULESET)
    expect(PEPPOL_LINE_SLACK).toBe(0.020001) // R120's inclusive 0.02 + the ruleset's 1e-6 float margin
  })
})

describe('the maps: every entry cites a primary source and a term', () => {
  it('declares a source key, a term, an XPath and a kind for every field', () => {
    for (const map of Object.values(EINVOICE_MAPS)) {
      expect(map.fields.length).toBeGreaterThan(10)
      for (const f of map.fields) {
        expect(SOURCES[f.source], `${map.id} ${f.field}`).toBeTruthy()
        expect(f.term.length).toBeGreaterThan(0)
        expect(f.xpath.startsWith(map.profile === 'ksef-fa3' ? '/Faktura/' : '/Invoice/')).toBe(true)
      }
      const keys = map.fields.map((f) => `${f.scope}:${f.field}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
  it('does not map what its source does not state: ZATCA has no BT-9 / BT-10 / BT-30; KSeF has no BT-style VAT id', () => {
    const z = EINVOICE_MAPS['zatca-ksa'].fields.map((f) => f.field)
    for (const f of ['due_date', 'buyer_reference', 'seller_legal_registration_id', 'seller_electronic_address']) expect(z).not.toContain(f)
    expect(EINVOICE_MAPS['ksef-fa3'].fields.map((f) => f.field)).not.toContain('seller_vat_id')
  })
})

describe('the XML reader', () => {
  it('resolves namespaces, decodes entities and CDATA, and records exact spans', () => {
    const src = '<?xml version="1.0"?><!-- c --><a:r xmlns:a="urn:A" xmlns="urn:D"><b x = \'1\'>x &amp; y &#65;<![CDATA[<z>]]></b><c/></a:r>'
    const r = parseXml(src)
    expect(r).toMatchObject({ local: 'r', ns: 'urn:A' })
    const b = r.children[0]!
    expect(b).toMatchObject({ local: 'b', ns: 'urn:D', attrs: { x: '1' }, text: 'x & y A<z>' })
    expect(src.slice(b.inner.start, b.inner.end)).toBe('x &amp; y &#65;<![CDATA[<z>]]>')
    expect(src.slice(b.span.start, b.span.end)).toBe('<b x = \'1\'>x &amp; y &#65;<![CDATA[<z>]]></b>')
    expect(r.children[1]).toMatchObject({ local: 'c', ns: 'urn:D', text: '' })
  })
  it('rejects what it does not support rather than guessing', () => {
    for (const bad of [
      '<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>', // DTD / entity expansion
      '<r>&nbsp;</r>', // unknown entity
      '<r><a></b></r>', // mismatched
      '<r><a></r>', // unclosed / mismatched
      '<p:r/>', // unbound prefix
      '<r/><s/>', // two roots
      '<r a="1" a="2"/>', // duplicate attribute
      'not xml',
    ]) expect(() => parseXml(bad), bad).toThrow(XmlParseError)
  })
})

describe('profile detection from the document\'s own markers', () => {
  it('recognises the three profiles', () => {
    expect(detectProfile(parseXml(PEPPOL)).profile).toBe('peppol-bis3')
    expect(detectProfile(parseXml(ZATCA)).profile).toBe('zatca-ksa')
    expect(detectProfile(parseXml(KSEF)).profile).toBe('ksef-fa3')
  })
  it('abstains on documents it does not map, and on non-XML', () => {
    const plainUbl = tamper(PEPPOL, 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0', 'urn:cen.eu:en16931:2017')
    expect(one(plainUbl, 'invoice_number', 'NW-2026-00417')).toMatchObject({ outcome: 'ABSTAIN', reason: 'UNSUPPORTED_PROFILE' })
    const fa2 = tamper(KSEF, 'xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"', 'xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/"')
    expect(one(fa2, 'invoice_number', 'FV/2026/03/0117')).toMatchObject({ outcome: 'ABSTAIN', reason: 'UNSUPPORTED_PROFILE' })
    const cn = '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>'
    expect(one(cn, 'invoice_number', 'X').detail).toMatch(/CreditNote: not mapped/)
    expect(one('%PDF-1.7 binary', 'invoice_number', 'X')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_TWIN' })
  })
  it('a forced profile overrides detection', () => {
    const plainUbl = tamper(PEPPOL, 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0', 'urn:cen.eu:en16931:2017')
    expect(verifyEinvoiceTwin(plainUbl, [{ id: 'n', field: 'invoice_number', value: 'NW-2026-00417' }], { ...OPTS, profile: 'peppol-bis3' }).judgments[0]!.outcome).toBe('PASS')
  })
})

describe('Peppol BIS 3.0: PASS on the values the invoice states', () => {
  const claims: EinvoiceClaim[] = [
    { id: 'c1', field: 'invoice_number', value: 'NW-2026-00417' },
    { id: 'c2', field: 'issue_date', value: '2026-03-14' },
    { id: 'c3', field: 'due_date', value: '2026-04-13' },
    { id: 'c4', field: 'currency', value: 'eur' },
    { id: 'c5', field: 'seller_name', value: 'Nordlicht Werkzeuge GmbH' },
    { id: 'c6', field: 'seller_vat_id', value: 'DE 123 456 789' },
    { id: 'c7', field: 'buyer_name', value: 'TULPENVELD LOGISTIEK B.V.' },
    { id: 'c8', field: 'buyer_vat_id', value: 'NL987654321B01' },
    { id: 'c9', field: 'sum_of_line_net_amount', value: 1306.5 },
    { id: 'c10', field: 'tax_exclusive_amount', value: '1289.00' },
    { id: 'c11', field: 'tax_amount', value: 244.91, currency: 'EUR' },
    { id: 'c12', field: 'tax_inclusive_amount', value: 1533.91 },
    { id: 'c13', field: 'payable_amount', value: 1034 },
    { id: 'c14', field: 'lines[1].net_amount', value: 136.5 },
    { id: 'c15', field: 'lines[2].item_name', value: 'Digital caliper & case' },
    { id: 'c16', field: 'vat_breakdown[0].rate', value: 19 },
    { id: 'c17', field: 'purchase_order_reference', value: 'PO-45120' },
    { id: 'c18', field: 'rounding_amount', value: 0.09 },
  ]
  const r = verifyEinvoiceTwin(PEPPOL, claims, OPTS)
  it('every claim PASSes, with the concrete XPath of its binding element', () => {
    expect(r.judgments.map((j) => `${j.field}:${j.outcome}`)).toEqual(claims.map((c) => `${c.field}:PASS`))
    const by = Object.fromEntries(r.judgments.map((j) => [j.field, j]))
    expect(by['lines[1].net_amount']!.binding!.xpath).toBe('/Invoice/cac:InvoiceLine[2]/cbc:LineExtensionAmount')
    expect(by.tax_amount!.binding!.xpath).toBe('/Invoice/cac:TaxTotal/cbc:TaxAmount')
    expect(by.seller_vat_id!.binding!.xpath).toBe('/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID')
    expect(by.seller_vat_id!.normalizations).toEqual(['whitespace_removed', 'case_folded'])
    expect(by.payable_amount!.binding).toMatchObject({ term: 'BT-115', raw: '1034.00', value: 1034, currency: 'EUR', source: 'PEPPOL-SYNTAX' })
  })
  it('the verdict PASSes, evidence spans point at the element content in the exact XML that was hashed', () => {
    expect(r.verdict.outcome).toBe('PASS')
    expect(r.verdict.ruleset).toEqual({ id: 'twin-einvoice-peppol-bis3', version: '0.3.0', domain: 'e-invoice' }) // map 0.3.0 (PRODUCT-FIX-1: the outcome rule)
    for (const c of r.verdict.claims.filter((x) => x.kind === 'CROSS_REFERENCE')) {
      const span = c.evidence[0]!.locator as { kind: 'span'; source_hash: string; start: number; end: number }
      expect(span.source_hash).toBe(r.twin.sha256)
      expect(PEPPOL.slice(span.start, span.end).replace(/&amp;/g, '&')).toBe(c.evidence[0]!.original) // original = decoded content
      expect(c.evidence[1]!.locator).toMatchObject({ kind: 'field', source: 'evidence' })
    }
  })
})

describe('FAIL, with the diagnosis first-match-wins', () => {
  it('wrong amount: UNLOCATED; sign; scale; transposed digits; another element\'s value', () => {
    expect(one(PEPPOL, 'payable_amount', 1043.5)).toMatchObject({ outcome: 'FAIL', reason: 'MISMATCH', diagnosis: 'UNLOCATED' })
    expect(one(PEPPOL, 'payable_amount', -1034)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SIGN' })
    expect(one(PEPPOL, 'payable_amount', 103400)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SCALE' })
    expect(one(PEPPOL, 'payable_amount', 1304)).toMatchObject({ outcome: 'FAIL', diagnosis: 'TRANSPOSITION' })
    const vat = one(PEPPOL, 'tax_amount', 1289) // the net total given as the VAT total
    expect(vat).toMatchObject({ outcome: 'FAIL', diagnosis: 'OTHER_FIELD' })
    expect(vat.matches!.map((m) => m.term)).toEqual(['BT-109']) // document-scope candidates (a breakdown is not searched for a document field)
  })
  it('a matching amount in the wrong currency', () => {
    expect(one(PEPPOL, 'payable_amount', 1034, { currency: 'USD' })).toMatchObject({ outcome: 'FAIL', diagnosis: 'CURRENCY' })
    expect(one(KSEF, 'P_15', 1770, { currency: 'EUR' })).toMatchObject({ outcome: 'FAIL', diagnosis: 'CURRENCY' }) // KSeF: KodWaluty
    expect(one(KSEF, 'P_15', 1770, { currency: 'pln' }).outcome).toBe('PASS')
  })
  it('wrong date: day/month swapped; another date of the invoice; elsewhere', () => {
    expect(one(PEPPOL, 'delivery_date', '2026-10-03')).toMatchObject({ outcome: 'FAIL', diagnosis: 'DAY_MONTH_SWAP' })
    const d = one(PEPPOL, 'issue_date', '2026-04-13') // the due date read as the issue date
    expect(d).toMatchObject({ outcome: 'FAIL', diagnosis: 'OTHER_FIELD' })
    expect(d.matches![0]).toMatchObject({ term: 'BT-9', field: 'due_date' })
    expect(one(PEPPOL, 'issue_date', '2026-03-15')).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
  it('swapped buyer / seller: names and identifiers', () => {
    expect(one(PEPPOL, 'seller_name', 'Tulpenveld Logistiek B.V.')).toMatchObject({ outcome: 'FAIL', diagnosis: 'SWAPPED_PARTY' })
    expect(one(PEPPOL, 'buyer_vat_id', 'DE123456789')).toMatchObject({ outcome: 'FAIL', diagnosis: 'SWAPPED_PARTY' })
    expect(one(ZATCA, 'seller_vat_id', '300987654300003')).toMatchObject({ outcome: 'FAIL', diagnosis: 'SWAPPED_PARTY' })
    expect(one(KSEF, 'buyer_nip', '1234567890')).toMatchObject({ outcome: 'FAIL', diagnosis: 'SWAPPED_PARTY' })
    expect(one(KSEF, 'seller_name', 'Hurtownia Mazowsze S.A.')).toMatchObject({ outcome: 'FAIL', diagnosis: 'SWAPPED_PARTY' })
  })
  it('identifiers: a transposition, and an unrelated value', () => {
    expect(one(PEPPOL, 'invoice_number', 'NW-2026-00471')).toMatchObject({ outcome: 'FAIL', diagnosis: 'TRANSPOSITION' })
    expect(one(PEPPOL, 'invoice_number', 'NW-2026-00418')).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
  it('a FAIL claim carries the variance and still cites the binding element', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [{ id: 'p', field: 'payable_amount', value: 1043.5 }], OPTS)
    const c = r.verdict.claims[0]!
    expect(c).toMatchObject({ outcome: 'FAIL', rule_id: 'TWIN_XML:BT-115', variance: 9.5 })
    expect(c.evidence.length).toBeGreaterThan(0)
    expect(r.verdict.outcome).toBe('FAIL')
  })
})

describe('ABSTAIN, always with the reason', () => {
  it('NOT_MAPPED: a field the profile does not map (never guessed)', () => {
    expect(one(PEPPOL, 'payment_terms', 'net 30')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_MAPPED' })
    expect(one(ZATCA, 'due_date', '2026-03-05')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_MAPPED' })
    expect(one(KSEF, 'seller_vat_id', 'PL1234567890')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_MAPPED' })
    expect(one(PEPPOL, 'lines[0].vat_amount', 180.5)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_MAPPED' }) // a ZATCA-only line field
  })
  it('ELEMENT_ABSENT: a mapped element the invoice does not carry, or a line that does not exist', () => {
    expect(one(PEPPOL, 'tax_amount_accounting_currency', 244.91)).toMatchObject({ outcome: 'ABSTAIN', reason: 'ELEMENT_ABSENT' })
    expect(one(PEPPOL, 'lines[3].net_amount', 10)).toMatchObject({ outcome: 'ABSTAIN', reason: 'ELEMENT_ABSENT' })
    expect(one(KSEF, 'P_13_3', 0)).toMatchObject({ outcome: 'ABSTAIN', reason: 'ELEMENT_ABSENT' }) // absence proves nothing
  })
  it('VALUE_UNPARSEABLE: ambiguous layouts are not guessed', () => {
    expect(one(PEPPOL, 'issue_date', '14/03/2026')).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
    expect(one(PEPPOL, 'issue_date', '2026-02-30')).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
    expect(one(PEPPOL, 'payable_amount', '1.034,00')).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
    expect(one(PEPPOL, 'payable_amount', Number.NaN)).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
    expect(one(PEPPOL, 'vat_breakdown[0].rate', 0.19)).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' }) // fraction vs percent
    expect(one(PEPPOL, 'vat_breakdown[0].rate', 21)).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
  it('TEXT_VARIANT: a name that is not the element and not the counterparty (e.g. the trading name) is not judged', () => {
    const j = one(PEPPOL, 'seller_name', 'Nordlicht')
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'TEXT_VARIANT' })
    expect(j.binding!.term).toBe('BT-27')
    expect(one(PEPPOL, 'seller_trading_name', 'Nordlicht').outcome).toBe('PASS')
  })
  it('BINDING_UNPARSEABLE and AMBIGUOUS_ELEMENT: the invoice itself cannot bind the field', () => {
    expect(one(tamper(PEPPOL, '<cbc:PayableAmount currencyID="EUR">1034.00<', '<cbc:PayableAmount currencyID="EUR">1.034,00<'), 'payable_amount', 1034))
      .toMatchObject({ outcome: 'ABSTAIN', reason: 'BINDING_UNPARSEABLE' })
    const twoTotals = tamper(PEPPOL, '<cac:LegalMonetaryTotal>', '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">1.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">1.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">1.00</cbc:TaxAmount></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal>')
    expect(one(twoTotals, 'tax_amount', 244.91)).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_ELEMENT' })
    expect(one(twoTotals, 'vat_breakdown[0].tax_amount', 244.91)).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_ELEMENT' })
    // BT-110 must be in the document currency (CEN BR-CO-15's selector); a breakdown total in another currency disagrees
    const wrongCur = tamper(PEPPOL, '<cbc:TaxAmount currencyID="EUR">244.91</cbc:TaxAmount>\n    <cac:TaxSubtotal>', '<cbc:TaxAmount currencyID="SEK">244.91</cbc:TaxAmount>\n    <cac:TaxSubtotal>')
    expect(one(wrongCur, 'tax_amount', 244.91)).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_ELEMENT' })
  })
  it('an abstention is never a flag: the verdict is INSUFFICIENT_DATA when nothing could be checked', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [{ id: 'x', field: 'payment_terms', value: 'net 30' }], { ...OPTS, consistency: false })
    expect(r.verdict.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.verdict.claims[0]!.insufficiency).toMatchObject({ reason: 'OUT_OF_RULESET_SCOPE' })
    expect(r.verdict.claims[0]!.insufficiency!.detail).toMatch(/^NOT_MAPPED: /)
  })
})

describe('ZATCA: its own profile, two tax totals, KSA line fields', () => {
  it('BT-110 binds the tax total WITH the breakdown, BT-111 the one without (BR-KSA-EN16931-08 / -09)', () => {
    const by = Object.fromEntries(judge(ZATCA, [
      { id: 'a', field: 'tax_amount', value: 162 },
      { id: 'b', field: 'tax_amount_accounting_currency', value: 162 },
    ]).map((j) => [j.field, j]))
    expect(by.tax_amount).toMatchObject({ outcome: 'PASS', binding: { term: 'BT-110', xpath: '/Invoice/cac:TaxTotal[2]/cbc:TaxAmount' } })
    expect(by.tax_amount_accounting_currency).toMatchObject({ outcome: 'PASS', binding: { term: 'BT-111', xpath: '/Invoice/cac:TaxTotal[1]/cbc:TaxAmount' } })
  })
  it('KSA fields: UUID, issue time, supply date, line VAT and line amount with VAT; Arabic seller name', () => {
    const js = judge(ZATCA, [
      { id: 'a', field: 'uuid', value: '6f0c5a4e-2d1b-4c7e-9a3f-1b2c3d4e5f60' },
      { id: 'b', field: 'issue_time', value: '14:22:08' },
      { id: 'c', field: 'supply_date', value: '2026-02-03' },
      { id: 'd', field: 'lines[0].vat_amount', value: 150 },
      { id: 'e', field: 'lines[0].amount_with_vat', value: 1150 },
      { id: 'f', field: 'seller_name', value: 'شركة النخبة للتجارة' },
      { id: 'g', field: 'payable_amount', value: 1242, currency: 'SAR' },
    ])
    expect(js.map((j) => j.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    expect(js[3]!.binding).toMatchObject({ term: 'KSA-11', source: 'ZATCA-DD', xpath: '/Invoice/cac:InvoiceLine[1]/cac:TaxTotal/cbc:TaxAmount' })
    expect(one(ZATCA, 'lines[0].vat_amount', 1000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'OTHER_FIELD' }) // the line net as its VAT
  })
})

describe('KSeF FA(3): native field codes and the shared names', () => {
  it('PASS on the header, parties, buckets, total and lines', () => {
    const js = judge(KSEF, [
      { id: 'a', field: 'invoice_number', value: 'FV/2026/03/0117' },
      { id: 'b', field: 'issue_date', value: '2026-03-02' },
      { id: 'c', field: 'supply_date', value: '2026-02-27' },
      { id: 'd', field: 'seller_nip', value: '1234567890' },
      { id: 'e', field: 'buyer_name', value: 'hurtownia  mazowsze s.a.' },
      { id: 'f', field: 'P_13_1', value: 1000 },
      { id: 'g', field: 'P_14_2', value: 40 },
      { id: 'h', field: 'P_15', value: 1770 },
      { id: 'i', field: 'lines[1].P_11', value: 500 },
      { id: 'j', field: 'lines[0].quantity', value: 10 },
      { id: 'k', field: 'lines[0].P_12', value: '23' },
    ])
    expect(js.map((j) => j.outcome)).toEqual(Array(11).fill('PASS'))
    expect(js[8]!.binding).toMatchObject({ xpath: '/Faktura/Fa/FaWiersz[2]/P_11', source: 'KSEF-XSD' })
  })
  it('FAIL: VAT given as net (OTHER_FIELD), net total given as the total due', () => {
    expect(one(KSEF, 'P_14_1', 1000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'OTHER_FIELD' })
    expect(one(KSEF, 'P_15', 1500)).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
})

describe('the XML\'s own footing (consistency): house rulesets under the spec rule ids', () => {
  it('the three fixtures foot, including the Peppol line with a line allowance (BT-136 passed through: 2 × 120.00 − 20.00)', () => {
    const p = verifyEinvoiceTwin(PEPPOL, [], OPTS).consistency
    expect(Object.fromEntries(p.map((k) => [k.claim_id, k.outcome]))).toEqual({
      'xml.document.BR-CO-10': 'PASS', 'xml.document.BR-CO-13': 'PASS', 'xml.document.BR-CO-15': 'PASS', 'xml.document.BR-CO-16': 'PASS',
      'xml.line[0].PEPPOL-EN16931-R120': 'PASS', 'xml.line[1].PEPPOL-EN16931-R120': 'PASS', 'xml.line[2].PEPPOL-EN16931-R120': 'PASS',
    })
    expect(p.find((k) => k.claim_id === 'xml.line[2].PEPPOL-EN16931-R120')!.operands.map((o) => o.term)).toContain('BT-136')
    expect(p.every((k) => k.provenance === 'SPEC')).toBe(true)
    const z = verifyEinvoiceTwin(ZATCA, [], OPTS).consistency
    expect(z.map((k) => `${k.rule_id}:${k.outcome}`)).toEqual(['BR-CO-10:PASS', 'BR-CO-13:PASS', 'BR-CO-15:PASS', 'BR-CO-16:PASS', 'BR-KSA-EN16931-11:PASS', 'BR-KSA-EN16931-11:PASS'])
    const k = verifyEinvoiceTwin(KSEF, [], OPTS).consistency
    // ruleset 0.1.0 (2026-09-28 corrections): GROSS_INT is a declared abstention (no primary source states the identity)
    // ruleset 0.2.0 (E-INVOICE-2): DoZaplaty is checked when Rozliczenie is present; this fixture has none, so it abstains
    expect(k.map((c) => `${c.rule_id}:${c.outcome}:${c.provenance}`)).toEqual(['KSEF-HOUSE:GROSS_INT:ABSTAIN:HOUSE_RECON', 'FA3-XSD:DoZaplaty:ABSTAIN:SPEC', 'KSEF-HOUSE:LINE_NET_INT:PASS:HOUSE_RECON', 'KSEF-HOUSE:LINE_NET_INT:PASS:HOUSE_RECON'])
  })
  it('an internally inconsistent invoice FAILs with the BR-CO id, even when the agent read it exactly', () => {
    const bad = tamper(PEPPOL, '<cbc:PayableAmount currencyID="EUR">1034.00<', '<cbc:PayableAmount currencyID="EUR">1134.00<')
    const r = verifyEinvoiceTwin(bad, [{ id: 'p', field: 'payable_amount', value: 1134 }], OPTS)
    expect(r.judgments[0]!.outcome).toBe('PASS') // the agent read the invoice correctly
    const k = r.consistency.find((c) => c.rule_id === 'BR-CO-16')!
    expect(k).toMatchObject({ outcome: 'FAIL', claim: { kind: 'CONSISTENCY', variance: 100 } })
    expect(k.operands.map((o) => o.term)).toEqual(['BT-115', 'BT-112', 'BT-113', 'BT-114'])
    expect(r.verdict.outcome).toBe('FAIL')
    expect(r.verdict.claims.find((c) => c.claim_id === 'xml.document.BR-CO-16')!.evidence[0]!.locator).toMatchObject({ kind: 'span', source_hash: r.twin.sha256 })
  })
  it('runs STRICT: a 0.05 break on BR-CO-15 FAILs (the engine\'s default 0.03% band would have forgiven it)', () => {
    let bad = tamper(PEPPOL, '<cbc:TaxInclusiveAmount currencyID="EUR">1533.91<', '<cbc:TaxInclusiveAmount currencyID="EUR">1533.96<')
    bad = tamper(bad, '<cbc:PayableAmount currencyID="EUR">1034.00<', '<cbc:PayableAmount currencyID="EUR">1034.05<')
    const k = verifyEinvoiceTwin(bad, [], OPTS).consistency
    expect(k.find((c) => c.rule_id === 'BR-CO-15')).toMatchObject({ outcome: 'FAIL', claim: { variance: 0.05 } })
    expect(k.find((c) => c.rule_id === 'BR-CO-16')!.outcome).toBe('PASS')
  })
  it('a broken line FAILs its line rule; BR-CO-10 catches the sum', () => {
    const bad = tamper(PEPPOL, '<cbc:LineExtensionAmount currencyID="EUR">136.50<', '<cbc:LineExtensionAmount currencyID="EUR">163.50<')
    const k = verifyEinvoiceTwin(bad, [], OPTS).consistency
    expect(k.find((c) => c.claim_id === 'xml.line[1].PEPPOL-EN16931-R120')!.outcome).toBe('FAIL')
    expect(k.find((c) => c.rule_id === 'BR-CO-10')!.outcome).toBe('FAIL')
  })
  it('BR-CO-15 abstains when BT-110 cannot be bound (the built-in ruleset would default it to 0)', () => {
    const wrongCur = tamper(PEPPOL, '<cbc:TaxAmount currencyID="EUR">244.91</cbc:TaxAmount>\n    <cac:TaxSubtotal>', '<cbc:TaxAmount currencyID="SEK">244.91</cbc:TaxAmount>\n    <cac:TaxSubtotal>')
    expect(verifyEinvoiceTwin(wrongCur, [], OPTS).consistency.find((c) => c.rule_id === 'BR-CO-15')!.outcome).toBe('ABSTAIN')
  })
  it('KSeF: GROSS_INT abstains (declared in ruleset 0.1.0), even on a broken total; P_10 lines abstain', () => {
    const broken = verifyEinvoiceTwin(tamper(KSEF, '<P_15>1770.00</P_15>', '<P_15>1870.00</P_15>'), [], OPTS).consistency[0]!
    expect(broken).toMatchObject({ rule_id: 'KSEF-HOUSE:GROSS_INT', outcome: 'ABSTAIN' })
    expect(broken.detail).toMatch(/^declared abstention: UNSOURCED/)
    const zeroRated = tamper(KSEF, '<P_15>1770.00</P_15>', '<P_13_6_1>200.00</P_13_6_1><P_15>1970.00</P_15>')
    const g = verifyEinvoiceTwin(zeroRated, [], OPTS).consistency[0]!
    expect(g).toMatchObject({ outcome: 'ABSTAIN' })
    expect(g.detail).toMatch(/^declared abstention: UNSOURCED/) // the ruleset's own reason (E-INVOICE-2 dropped the moot twin override)
    const disc = tamper(KSEF, '<P_9A>100.00</P_9A>\n      <P_11>1000.00</P_11>', '<P_9A>110.00</P_9A>\n      <P_10>10.00</P_10>\n      <P_11>1000.00</P_11>')
    expect(verifyEinvoiceTwin(disc, [], OPTS).consistency.find((c) => c.scope === 'line[0]')).toMatchObject({ rule_id: 'KSEF-HOUSE:LINE_NET_INT', outcome: 'ABSTAIN' })
  })
  it('consistency can be turned off; it never runs on an unmapped document', () => {
    expect(verifyEinvoiceTwin(PEPPOL, [], { ...OPTS, consistency: false }).consistency).toEqual([])
    expect(verifyEinvoiceTwin('<r/>', [], OPTS).consistency).toEqual([])
  })
})

describe('the verdict: a standard verify proof object', () => {
  const claims: EinvoiceClaim[] = [
    { id: 'x.number', field: 'invoice_number', value: 'NW-2026-00417' },
    { id: 'x.payable', field: 'payable_amount', value: 1043.5 },
    { id: 'x.terms', field: 'payment_terms', value: 'net 30' },
  ]
  const r = verifyEinvoiceTwin(PEPPOL, claims, OPTS)
  it('aggregates under its named rule with coverage; evidence on PASS / FAIL, insufficiency on abstain', () => {
    expect(r.verdict.outcome).toBe('FAIL')
    expect(r.verdict.aggregation).toBe('ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES') // twin 0.3.0 (PRODUCT-FIX-1)
    expect(r.verdict.coverage).toEqual({ claims_total: 10, claims_checked: 9, claims_pass: 8, claims_fail: 1, claims_insufficient: 1 }) // line 3's R120 now decides (E-INVOICE-2)
    for (const c of r.verdict.claims) {
      if (c.outcome === 'INSUFFICIENT_DATA') { expect(c.evidence).toEqual([]); expect(c.insufficiency!.detail.length).toBeGreaterThan(0) }
      else expect(c.evidence.length).toBeGreaterThan(0)
    }
    expect(r.verdict.document.line_items).toBe(3)
    expect(r.twin).toMatchObject({ profile: 'peppol-bis3', lines: 3 })
  })
  it('is deterministic: byte-identical on rerun; verdict_id ignores the clock; replay binds the inputs', () => {
    expect(JSON.stringify(verifyEinvoiceTwin(PEPPOL, claims, OPTS))).toBe(JSON.stringify(r))
    const later = verifyEinvoiceTwin(PEPPOL, claims, { now: () => new Date('2031-01-01T00:00:00Z') })
    expect(later.verdict.verdict_id).toBe(r.verdict.verdict_id)
    expect(later.verdict.issued_at).not.toBe(r.verdict.issued_at)
    expect(verifyEinvoiceTwin(PEPPOL, [{ ...claims[0]!, value: 'NW-2026-00418' }, ...claims.slice(1)], OPTS).verdict.verdict_id).not.toBe(r.verdict.verdict_id)
    expect(verifyEinvoiceTwin(PEPPOL + ' ', claims, OPTS).verdict.verdict_id).not.toBe(r.verdict.verdict_id) // a different document
    expect(verifyReplay(r.verdict, einvoiceVerdictInput(r.twin.sha256, 'peppol-bis3', claims, OPTS))).toMatchObject({ ok: true, id_ok: true, input_ok: true })
    expect(verifyReplay(r.verdict, einvoiceVerdictInput(r.twin.sha256, 'peppol-bis3', claims, { tolerance: 1 })).ok).toBe(false)
  })
})
