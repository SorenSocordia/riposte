// Unit tests of the blind-shipping-1 harness, on tiny fixtures written here (none is data of the run).
//   node --test harness/test/harness.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { barVerdict, citedRules, clopperPearson, digestOf, drawOrder, ledgerAppend, readJson, requireRecorded, RULESET_FILES, scanXml, seedFor, seedFromParts, sha256, textOf, ublRoot } from '../lib.mjs'
import { decimalSum, decimalToken, extractUbl, toJson } from '../einvoice-extract.mjs'
import { applyOperator, OPERATORS, swapAdjacent } from '../einvoice-plant.mjs'
import { select } from '../einvoice-fetch.mjs'
import { firedRules, labelFile, locate } from '../einvoice-validate.mjs'
import { calendarUrl, docketEntriesFromHtml, docketsIn, docketUrl, headAddresses, meritsBriefs, opinionText, usCite } from '../legal-fetch.mjs'
import { format, score } from '../score.mjs'

const INV = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
const CN = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
// a synthetic invoice: two lines, a line allowance and charge, a second tax total in another currency (BT-111)
const SYN = `<?xml version="1.0" encoding="UTF-8"?>
<!-- synthetic fixture for the harness tests -->
<ubl:Invoice xmlns:ubl="${INV}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}">
  <cbc:ID>T-1</cbc:ID>
  <cbc:IssueDate>2026-01-02</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SEK">99.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">21.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxAmount currencyID="EUR">20.00</cbc:TaxAmount></cac:TaxSubtotal>
    <cac:TaxSubtotal><cbc:TaxAmount currencyID="EUR">1.00</cbc:TaxAmount></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">105.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">105.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">126.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">126.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">95.00</cbc:LineExtensionAmount>
    <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">7.50</cbc:Amount></cac:AllowanceCharge>
    <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">2.5</cbc:Amount></cac:AllowanceCharge>
    <cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">5.00</cbc:Amount></cac:AllowanceCharge>
    <cac:Price><cbc:PriceAmount currencyID="EUR">50.00</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">1.00</cbc:Amount></cac:AllowanceCharge></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">10.00</cbc:LineExtensionAmount>
    <cac:Price><cbc:PriceAmount currencyID="EUR">20.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="C62">2</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>
</ubl:Invoice>
`

test('section 7: the intervals reproduce the table\'s "what clears it" column', () => {
  const v = (k, n, bar, kind, size) => barVerdict({ k, n, bar, kind, size }).verdict
  assert.equal(v(2, 150, 0.05, 'low', 150), 'PASS'); assert.notEqual(v(3, 150, 0.05, 'low', 150), 'PASS') // P1
  assert.equal(v(0, 40, 0.10, 'low', 40), 'PASS'); assert.notEqual(v(1, 40, 0.10, 'low', 40), 'PASS') // P2, P3, P4, S3
  assert.equal(v(55, 60, 0.80, 'high', 60), 'PASS'); assert.notEqual(v(54, 60, 0.80, 'high', 60), 'PASS') // S1
  assert.equal(v(85, 200, 0.50, 'low', 200), 'PASS'); assert.notEqual(v(86, 200, 0.50, 'low', 200), 'PASS') // S2, S6
  assert.equal(v(13, 40, 0.50, 'low', 40), 'PASS'); assert.notEqual(v(14, 40, 0.50, 'low', 40), 'PASS') // S4
  assert.equal(v(3, 200, 0.05, 'low', 200), 'PASS'); assert.notEqual(v(4, 200, 0.05, 'low', 200), 'PASS') // S5
  assert.ok(Math.abs(clopperPearson(0, 40).upper - (1 - 0.025 ** (1 / 40))) < 1e-9)
  assert.ok(Math.abs(clopperPearson(40, 40).lower - 0.025 ** (1 / 40)) < 1e-9)
  assert.equal(v(20, 40, 0.10, 'low', 40), 'FAIL')
  assert.equal(v(10, 60, 0.80, 'high', 60), 'FAIL')
  assert.equal(v(0, 39, 0.10, 'low', 40), 'INSUFFICIENT')
  assert.equal(v(null, null, 0.10, 'low', 40), 'DID NOT RUN')
})

test('section 6: the seed is read off the first stamp, and the draw order is fixed by it', async () => {
  const s = await seedFor('einvoice')
  assert.equal(s.seed, seedFromParts(s.imprint, s.serial, 'einvoice'))
  assert.equal(s.seed, sha256(`${s.imprint}:${s.serial}:einvoice`))
  assert.notEqual(s.seed, (await seedFor('legal')).seed)
  const ids = ['a/1.xml', 'a/2.xml', 'b/3.xml', 'b/4.xml']
  assert.deepEqual(drawOrder(s.seed, ids), drawOrder(s.seed, [...ids].reverse()))
  assert.deepEqual(drawOrder('x', ids).slice().sort(), [...ids].sort())
})

test('the scanner reads namespaces by URI and refuses broken markup', () => {
  assert.equal(ublRoot(Buffer.from(SYN)), 'Invoice')
  assert.equal(ublRoot(Buffer.from(String.fromCharCode(0xfeff) + `<CreditNote xmlns="${CN}"/>`)), 'CreditNote')
  assert.equal(ublRoot(Buffer.from(`<x:Invoice xmlns:x="urn:other"/>`)), null)
  assert.equal(ublRoot(Buffer.from('<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>')), null)
  assert.equal(ublRoot(Buffer.from('not xml')), null)
  assert.equal(ublRoot(Buffer.from(`<Invoice xmlns="${INV}"><a></b></Invoice>`)), null)
  const r = scanXml(`<a xmlns="urn:a"><b x="1 &amp; 2">t&lt;u<![CDATA[v]]></b></a>`)
  assert.equal(r.children[0].attrs[0].value, '1 & 2')
  assert.equal(textOf(`<a xmlns="urn:a"><b x="1 &amp; 2">t&lt;u<![CDATA[v]]></b></a>`, r.children[0]), 't<uv')
})

test('the fixed mapping reads the elements the schema names, and nothing else', () => {
  const { extraction: x, root } = extractUbl(SYN)
  assert.equal(root, 'Invoice')
  const j = JSON.parse(toJson(x))
  assert.equal(j.invoice_number, 'T-1'); assert.equal(j.issue_date, '2026-01-02'); assert.equal(j.currency, 'EUR'); assert.equal(j.amount_currency, 'EUR')
  assert.equal(j.tax_amount, 21) // the tax total in the invoice currency, not the SEK one
  assert.deepEqual(j.vat_breakdown, [{ tax_amount: 20 }, { tax_amount: 1 }])
  assert.equal(j.line_extension_amount, 105); assert.equal(j.payable_amount, 126)
  assert.equal(j.allowance_total_amount, undefined) // absent stays absent: the ruleset defaults it
  assert.deepEqual(j.lines[0], { line_extension_amount: 95, invoiced_quantity: 2, price_amount: 50, line_allowance_amount: 10, line_charge_amount: 5 })
  assert.deepEqual(j.lines[1], { line_extension_amount: 10, invoiced_quantity: 1, price_amount: 20, base_quantity: 2 })
  assert.match(toJson(x), /"line_extension_amount": 105\.00/) // the document's digits
  const cn = extractUbl(`<CreditNote xmlns="${CN}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="USD">+.5</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:CreditNoteLine><cbc:CreditedQuantity>3</cbc:CreditedQuantity><cbc:LineExtensionAmount>1,50</cbc:LineExtensionAmount></cac:CreditNoteLine></CreditNote>`)
  const c = JSON.parse(toJson(cn.extraction))
  assert.equal(c.payable_amount, 0.5); assert.equal(c.amount_currency, 'USD'); assert.equal(c.lines[0].invoiced_quantity, 3)
  assert.equal(c.lines[0].line_extension_amount, '1,50') // not a decimal: the engine sees what the document holds
  assert.throws(() => extractUbl('<Order xmlns="urn:x"/>'))
})

test('decimal helpers are exact', () => {
  assert.equal(decimalSum(['7.50', '2.5']), '10.00'); assert.equal(decimalSum(['-1.05', '1']), '-0.05'); assert.equal(decimalSum(['0.1', '0.2']), '0.3')
  assert.equal(decimalToken('+12.'), '12'); assert.equal(decimalToken('.5'), '0.5'); assert.equal(decimalToken('007.10'), '7.10'); assert.equal(decimalToken('1e3'), null)
})

test('planting: each operator changes one value and leaves every other byte alone', () => {
  assert.equal(swapAdjacent('1034.00'), '1043.00'); assert.equal(swapAdjacent('1533.91'), '1533.19'); assert.equal(swapAdjacent('100.00'), null)
  assert.equal(swapAdjacent('10.50'), '10.05'); assert.equal(swapAdjacent('12'), '21'); assert.equal(swapAdjacent('105'), '150')
  const byRule = Object.fromEntries(OPERATORS.map(o => [o.rule, o]))
  const p = applyOperator(byRule['BR-CO-10'], SYN)
  assert.deepEqual(p.change, { element: 'cbc:LineExtensionAmount', old: '105.00', new: '106.00' })
  assert.equal(p.xml.length, SYN.length); assert.equal([...p.xml].filter((ch, i) => ch !== SYN[i]).length, 1)
  assert.equal(applyOperator(byRule['BR-CO-14'], SYN).change.old, '21.00')
  assert.equal(applyOperator(byRule['PEPPOL-EN16931-R120'], SYN).change.new, '96.00')
  assert.equal(applyOperator(byRule['BR-CO-16'], SYN).change.new, '162.00') // 126.00: the fraction has no unequal pair; 126 -> 162
})

test('planting: removals and the cannot-take rule', () => {
  const byRule = Object.fromEntries(OPERATORS.map(o => [o.rule, o]))
  const r = applyOperator(byRule['BR-05'], SYN)
  assert.ok(!r.xml.includes('DocumentCurrencyCode')); assert.equal(r.xml, SYN.replace('  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>\n', ''))
  assert.equal(applyOperator(byRule['BR-03'], r.xml).xml.includes('IssueDate'), false)
  assert.equal(extractUbl(r.xml).extraction.currency, undefined)
  const noTotals = SYN.replace(/<cac:LegalMonetaryTotal>[\s\S]*<\/cac:LegalMonetaryTotal>/, '')
  assert.equal(applyOperator(byRule['BR-CO-13'], noTotals), null)
})

test('selection: UBL roots only, path order, the drop rule and duplicates', () => {
  const file = (path, body) => ({ path, read: () => Buffer.from(body) })
  const inTree = `<Invoice xmlns="${INV}"><cbc:ID xmlns:cbc="${CBC}">IN-TREE</cbc:ID></Invoice>`
  const index = { matches: (buf) => (buf.toString() === inTree ? ['some/fixture.xml'] : []) }
  const s = select([
    { name: 'xr', files: [file('b.xml', `<Invoice xmlns="${INV}"/>`), file('a.xml', `<CreditNote xmlns="${CN}"/>`), file('c.txt', 'plain')] },
    { name: 'en', files: [file('z.xml', inTree), file('y.xml', `<Invoice xmlns="${INV}"/>`)] },
  ], index)
  assert.deepEqual(s.selected.map(x => [x.key, x.id, x.root]), [['N0001', 'en/y.xml', 'Invoice'], ['N0002', 'xr/a.xml', 'CreditNote']])
  assert.deepEqual(s.duplicates.map(d => [d.id, d.duplicate_of]), [['xr/b.xml', 'en/y.xml']])
  assert.deepEqual(s.droppedInTree.map(d => d.id), ['en/z.xml'])
  assert.equal(s.notUbl, 1)
})

test('labels: SVRL fires, the rules each ruleset cites, valid and invalid', () => {
  const svrl = `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl"><svrl:fired-rule context="x"/><svrl:failed-assert id="BR-CO-10" flag="fatal" location="/"><svrl:text>t</svrl:text></svrl:failed-assert><svrl:successful-report id="PEPPOL-EN16931-R001" flag="warning"/></svrl:schematron-output>`
  assert.deepEqual(firedRules(svrl), { 'BR-CO-10': ['fatal'], 'PEPPOL-EN16931-R001': ['warning'] })
  const c3 = citedRules(readJson(RULESET_FILES['0.3.0'])), c2 = citedRules(readJson(RULESET_FILES['0.2.0']))
  const expected = ['BR-02', 'BR-03', 'BR-05', 'BR-15', 'BR-CO-10', 'BR-CO-13', 'BR-CO-14', 'BR-CO-15', 'BR-CO-16', 'PEPPOL-EN16931-R051', 'PEPPOL-EN16931-R120']
  assert.deepEqual(c3.rules, expected); assert.deepEqual(c2.rules, expected)
  assert.equal(c3.byCode.R120_SUM, null); assert.equal(c3.byCode.LINES_SUM_INT, 'BR-CO-10')
  const cites = { '0.3.0': c3.rules, '0.2.0': c2.rules }
  const lab = labelFile({ fired: { 'BR-CO-10': [{ validator: 'cen', flag: 'fatal' }], 'PEPPOL-EN16931-R001': [{ validator: 'peppol', flag: 'fatal' }] }, errors: [] }, cites)
  assert.equal(lab.fires['BR-CO-10'], true); assert.equal(lab.fires['BR-02'], false); assert.equal(lab.valid['0.3.0'], false)
  assert.equal(labelFile({ fired: { 'PEPPOL-EN16931-R001': [] }, errors: [] }, cites).valid['0.3.0'], true) // an uncited rule does not make a file invalid
  assert.equal(labelFile({ fired: {}, errors: [{ validator: 'cen', error: 'x' }] }, cites).decided, false)
  assert.deepEqual(locate(['ubl/xslt/EN16931-UBL-validation.xslt', 'ubl/schematron/EN16931-UBL-validation.sch'], { xslt: /(^|\/)ubl\/xslt\/EN16931-UBL-validation\.xslt?$/i, sch: /x/ }), { kind: 'xslt', path: 'ubl/xslt/EN16931-UBL-validation.xslt' })
  assert.throws(() => locate(['a/PEPPOL-EN16931-UBL.xslt', 'b/PEPPOL-EN16931-UBL.xslt'], { xslt: /PEPPOL-EN16931-UBL\.xslt$/i, sch: /x/ }))
})

test('legal helpers: dockets, merits briefs, citations, opinion texts', () => {
  assert.deepEqual(docketsIn('MONDAY 23-1039 Royal Canin v. Wullschleger\n 23-1122 and 23-1039 again; 22O141 Texas v. New Mexico'), ['23-1039', '23-1122', '22O141'])
  const briefs = meritsBriefs([
    { Text: 'Brief of respondent X in opposition filed.', Links: [{ Description: 'Main Document', DocumentUrl: 'u0' }] },
    { Text: 'Brief of petitioner A filed.', Links: [{ Description: 'Main Document', DocumentUrl: 'u1' }, { Description: 'Proof of Service', DocumentUrl: 'p' }] },
    { Text: 'Brief amicus curiae of B filed.', Links: [{ Description: 'Main Document', DocumentUrl: 'u2' }] },
    { Text: 'Brief of respondents C, et al. filed.', Links: [{ Description: 'Main Document', DocumentUrl: 'u3' }] },
    { Text: 'Reply of petitioner A filed.', Links: [{ Description: 'Main Document', DocumentUrl: 'u4' }] },
  ])
  assert.deepEqual(briefs.map(b => [b.side, b.n, b.url]), [['P', 1, 'u1'], ['R', 1, 'u3']])
  const html = '<table><tr><td>Jan 21 2025</td><td>Brief of petitioner A filed.</td></tr><tr><td></td><td><a href="https://x/a.pdf">Main Document</a> <a href="https://x/p.pdf">Proof of Service</a></td></tr><tr><td>Feb 20 2025</td><td>Brief of respondent B &amp; C filed.</td></tr><tr><td></td><td><a href="https://x/b.pdf">Main Document</a></td></tr></table>'
  const fromHtml = meritsBriefs(docketEntriesFromHtml(html))
  assert.deepEqual(fromHtml.map(b => [b.side, b.url, b.text]), [['P', 'https://x/a.pdf', 'Brief of petitioner A filed.'], ['R', 'https://x/b.pdf', 'Brief of respondent B & C filed.']])
  const rel = docketEntriesFromHtml('<tr><td><span>Mar 3, 2025</span></td><td><span>Brief of respondent D filed.</span></td></tr><tr><td></td><td><a href="/DocketPDF/24/24-1/x.pdf">Main Document</a></td></tr>', docketUrl('24-1'))
  assert.deepEqual(meritsBriefs(rel).map(b => b.url), ['https://www.supremecourt.gov/DocketPDF/24/24-1/x.pdf'])
  assert.equal(docketUrl('24-394'), 'https://www.supremecourt.gov/docket/docketfiles/html/public/24-394.html')
  assert.equal(calendarUrl('October', 2024), 'https://www.supremecourt.gov/oral_arguments/argument_calendars/MonthlyArgumentCalOctober2024.pdf')
  assert.deepEqual([headAddresses().filter(h => h.required).length, headAddresses().filter(h => !h.required).length], [11, 2])
  assert.equal(usCite('347 U. S. 483'), '347 U.S. 483'); assert.equal(usCite('347 U.S. ___'), null); assert.equal(usCite('100 S. Ct. 1'), null)
  const t = opinionText({ name_abbreviation: 'Roe v. Doe', decision_date: '1990-05-01', casebody: { head_matter: 'Syllabus.', opinions: [{ type: 'majority', text: 'Justice X delivered the opinion of the Court.\r\nWords.' }, { type: 'dissent', text: 'Justice Y, dissenting.' }] } }, '400 U.S. 1')
  assert.equal(t.split('\n')[0], 'Roe v. Doe, 400 U.S. 1 (1990)'); assert.ok(t.includes('Justice Y, dissenting.')); assert.ok(!t.includes('\r'))
})

test('the order rule: no engine call until the labels and the planted set are on the ledger', () => {
  const d = mkdtempSync(join(tmpdir(), 'bs1-ledger-'))
  const path = join(d, 'ledger.jsonl'), labels = join(d, 'labels.json'), planted = join(d, 'planted.json')
  writeFileSync(labels, '{"x":1}'); writeFileSync(planted, '[]')
  assert.throws(() => requireRecorded('einvoice', { labels, planted }, { path }), /section 3/)
  ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'labels', sha256: digestOf(labels) }, path)
  ledgerAppend({ arm: 'einvoice', event: 'hashed', kind: 'planted', sha256: digestOf(planted) }, path)
  requireRecorded('einvoice', { labels, planted }, { path })
  writeFileSync(labels, '{"x":2}')
  assert.throws(() => requireRecorded('einvoice', { labels, planted }, { path }), /section 3/) // changed after hashing
  writeFileSync(labels, '{"x":1}')
  ledgerAppend({ arm: 'einvoice', event: 'engine-start' }, path)
  assert.throws(() => requireRecorded('einvoice', { labels, planted }, { path }), /already started/)
  requireRecorded('einvoice', { labels, planted }, { path, restart: true })
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  writeFileSync(path, [lines[0], lines[2], lines[1], lines[3]].join('\n') + '\n')
  assert.throws(() => requireRecorded('einvoice', { labels, planted }, { path }), /chain/)
})

test('scoring: every section 5 count and section 7 verdict from tiny fixtures', () => {
  const lab = (key, valid, fires = {}) => ({ key, decided: true, fires: { 'BR-CO-10': false, 'BR-CO-13': false, ...fires }, valid: { '0.3.0': valid, '0.2.0': valid } })
  const row = (key, kind, version, answer, extra = {}) => ({ key, id: key, kind, ruleset: `peppol-en16931@${version}`, ruleset_named: `peppol-en16931@${version}`, answer, refused: false, fail_codes: [], fail_rules: [], ...extra })
  const einvoice = {
    labels: { files: [lab('N0001', true), lab('N0002', true), lab('N0003', false, { 'BR-CO-13': true }), { key: 'N0004', decided: false, errors: [] }] },
    planted: { kept: [{ key: 'P01', labels: lab('P01', false, { 'BR-CO-10': true }) }] },
    engine: { rows: ['0.3.0', '0.2.0'].flatMap(v => [
      row('N0001', 'natural', v, 'PASS'), row('N0002', 'natural', v, 'FAIL', { fail_codes: ['TAX_EXCL_INT'], fail_rules: ['BR-CO-13'] }),
      row('N0003', 'natural', v, 'FAIL', { fail_codes: ['LINES_SUM_INT'], fail_rules: ['BR-CO-10'] }), row('N0004', 'natural', v, 'CANT_TELL', { refused: true }),
      row('P01', 'planted', v, v === '0.3.0' ? 'PASS' : 'FAIL', v === '0.3.0' ? {} : { fail_codes: ['LINES_SUM_INT'], fail_rules: ['BR-CO-10'] })]) },
  }
  const legal = {
    labels: [{ id: 'q1', label: 'genuine' }, { id: 'q2', label: 'genuine' }, { id: 'q3', label: 'not faithful' }, { id: 'q4', label: 'undecided' }],
    planted: [{ key: 'L01' }],
    engine: { rows: [{ id: 'q1', kind: 'natural', answer: 'PASS' }, { id: 'q2', kind: 'natural', answer: 'CANT_TELL' }, { id: 'q3', kind: 'natural', answer: 'FAIL' }, { id: 'q4', kind: 'natural', answer: 'PASS' }, { id: 'L01', kind: 'planted', answer: 'PASS', refused: false }] },
  }
  const s = score({ einvoice, legal, ap: null })
  const e = s.counts.einvoice['0.3.0']
  assert.deepEqual(e.valid, { n: 2, false_fail: 1, cant_tell: 0, pass: 1 })
  assert.deepEqual(e.invalid, { n: 2, natural: 1, planted: 1, miss: 1, fail: 1, cant_tell: 0 })
  assert.deepEqual(e.wrong_reason.map(w => w.key), ['N0003']) // it names BR-CO-10; the validators fired BR-CO-13
  assert.deepEqual(e.unlabelled, ['N0004'])
  assert.equal(s.counts.einvoice['0.2.0'].invalid.miss, 0)
  assert.deepEqual(s.counts.legal.genuine, { n: 2, false_fail: 0, cant_tell: 1, pass: 1 })
  assert.deepEqual(s.counts.legal.planted_and_not_faithful, { n: 2, planted: 1, not_faithful: 1, miss: 1, fail: 1, cant_tell: 0 })
  assert.deepEqual(s.counts.legal.unlabelled, ['q4'])
  const by = Object.fromEntries([...s.bars, ...s.descriptive].map(b => [b.id, b]))
  assert.equal(by.P1.verdict, 'DID NOT RUN'); assert.equal(by.P3.verdict, 'INSUFFICIENT'); assert.equal(by.P3.k, 1); assert.equal(by.P3.n, 2)
  assert.equal(by['P3 (0.2.0)'].k, 0); assert.equal(s.run, 'NOT PASSED')
  const ap = { bills: Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, decision: i < 80 ? 'person' : i < 140 ? 'hold' : 'pay' })),
    audit: { hold: Array.from({ length: 60 }, (_, i) => ({ id: `h${i}`, label: i < 56 ? 'confirmed' : 'not confirmed' })), pay: Array.from({ length: 151 }, (_, i) => ({ id: `p${i}`, label: i === 150 ? 'undecided' : i < 1 ? 'bad' : 'good' })) },
    seeded: [...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, in_claim: true, decision: 'hold' })), { id: 'o1', in_claim: false, decision: 'pay' }] }
  const t = score({ ap })
  const tb = Object.fromEntries(t.bars.map(b => [b.id, b]))
  assert.deepEqual([tb.P1.k, tb.P1.n, tb.P1.verdict], [1, 150, 'PASS']); assert.deepEqual([tb.P2.k, tb.P2.n, tb.P2.verdict], [0, 40, 'PASS'])
  assert.deepEqual([tb.S1.k, tb.S1.verdict], [56, 'PASS']); assert.deepEqual([tb.S2.k, tb.S2.n, tb.S2.verdict], [80, 200, 'PASS'])
  assert.equal(t.run, 'NOT PASSED'); assert.deepEqual(t.run_because, ['P3 DID NOT RUN', 'P4 DID NOT RUN'])
  const text = format(s)
  assert.match(text, /^SECTION 5: COUNTS/); assert.match(text, /RUN: NOT PASSED/); assert.match(text, /AP {2}DID NOT RUN/)
})
