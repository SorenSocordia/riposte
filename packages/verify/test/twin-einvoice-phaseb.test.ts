/**
 * E-INVOICE-2 Phase B (engineering note "The e-invoice twin on official samples", 2026-09-28): the twin's footing changes made
 * AFTER the blind real-sample measurement (Phase A), so they are TUNED, never blind.
 *  - UBL line allowances / charges (BT-136 / BT-141) are passed through to the built-in line rule instead of abstaining.
 *  - The twin no longer overrides Peppol's R120 slack to exactly 0.02, which FAILed lines the spec accepts (floats).
 *  - KSeF lines hand the ruleset P_9B and P_11A too, so its own guard and sourced reason decide; stale texts are gone.
 * Every document here is CONSTRUCTED for the test; none is a published sample.
 */
import { describe, it, expect } from 'vitest'
import { verifyEinvoiceTwin, einvoiceVerdictInput, type EinvoiceConsistency } from '../src/twin-einvoice/index'

const OPTS = { now: () => new Date(0) }
const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'
const PEPPOL_HEAD = '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>'
const ZATCA_HEAD = '<cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>'
const ac = (charge: string, amount: string | null, extra = ''): string =>
  `<cac:AllowanceCharge><cbc:ChargeIndicator>${charge}</cbc:ChargeIndicator>${amount === null ? '' : `<cbc:Amount currencyID="EUR">${amount}</cbc:Amount>`}${extra}</cac:AllowanceCharge>`
const line = (qty: string, ext: string, price: string, acs = '', priceExtra = ''): string =>
  `<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">${ext}</cbc:LineExtensionAmount>${acs}<cac:Price><cbc:PriceAmount currencyID="EUR">${price}</cbc:PriceAmount>${priceExtra}</cac:Price></cac:InvoiceLine>`
const invoice = (head: string, lines: string): string => `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}>${head}${lines}</Invoice>`
const lineRule = (xml: string, i = 0): EinvoiceConsistency => {
  const k = verifyEinvoiceTwin(xml, [], OPTS).consistency.find((c) => c.scope === `line[${i}]`)
  if (!k) throw new Error('no line rule')
  return k
}

describe('Peppol R120 at its own inclusive slack (the 0.02 override is gone)', () => {
  it('a line exactly 0.02 off PASSes whichever way the binary rounding falls; 0.03 off FAILs', () => {
    for (const [ext, price] of [['0.07', '0.05'], ['0.05', '0.07'], ['1.12', '1.10'], ['10.02', '10.00']] as const) {
      expect(lineRule(invoice(PEPPOL_HEAD, line('1', ext, price))).outcome, `${ext} vs ${price}`).toBe('PASS')
    }
    expect(lineRule(invoice(PEPPOL_HEAD, line('1', '0.08', '0.05')))).toMatchObject({ rule_id: 'PEPPOL-EN16931-R120', outcome: 'FAIL' })
  })
  it('the footing names the shipped ruleset with no twin override', () => {
    const k = lineRule(invoice(PEPPOL_HEAD, line('1', '5.00', '5.00')))
    expect(k.footing).toBe('peppol-en16931@0.1.0, strict (rel 0)')
    expect(k.claim.computation?.tolerance).toEqual({ abs: 0.020001 })
  })
})

describe('UBL line allowances and charges (BT-136 / BT-141) are passed through, not abstained on', () => {
  // 10 × 10.00 − 30 + 10 + 10 = 90.00
  const acs = ac('false', '30') + ac('true', '10') + ac('true', '10')
  it('the line rule decides with Σ BT-141 − Σ BT-136, and cites every amount', () => {
    const ok = lineRule(invoice(PEPPOL_HEAD, line('10', '90.00', '10', acs)))
    expect(ok.outcome).toBe('PASS')
    expect(ok.operands.map((o) => `${o.term}=${o.value}`)).toEqual(['BT-131=90', 'BT-129=10', 'BT-146=10', 'BT-136=30', 'BT-141=10', 'BT-141=10'])
    expect(ok.operands.find((o) => o.term === 'BT-136')!.xpath).toBe('/Invoice/cac:InvoiceLine/cac:AllowanceCharge[1]/cbc:Amount')
    expect(ok.claim.evidence.filter((e) => e.locator.kind === 'span')).toHaveLength(6)
    expect(lineRule(invoice(PEPPOL_HEAD, line('10', '89.98', '10', acs))).outcome).toBe('PASS') // 0.02: inside R120's slack
    expect(lineRule(invoice(PEPPOL_HEAD, line('10', '89.97', '10', acs)))).toMatchObject({ outcome: 'FAIL', claim: { variance: -0.03 } })
    expect(lineRule(invoice(PEPPOL_HEAD, line('10', '100.00', '10', acs))).outcome).toBe('FAIL') // the allowance and charges are not ignored
  })
  it('a price-level allowance (cac:Price/cac:AllowanceCharge, BT-147) is not a line allowance', () => {
    const priceAc = '<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">2.00</cbc:Amount><cbc:BaseAmount currencyID="EUR">12.00</cbc:BaseAmount></cac:AllowanceCharge>'
    expect(lineRule(invoice(PEPPOL_HEAD, line('3', '30.00', '10.00', '', priceAc))).outcome).toBe('PASS')
  })
  it('abstains, with the reason, when an allowance/charge cannot be read (R120 itself would silently skip it)', () => {
    const cases: [string, RegExp][] = [
      [ac('TRUE', '10'), /ChargeIndicator "TRUE"/],
      [ac('1', '10'), /ChargeIndicator "1"/],
      [ac('false', null), /0 cbc:Amount elements/],
      [ac('false', '10', '<cbc:Amount currencyID="EUR">10</cbc:Amount>'), /2 cbc:Amount elements/],
      [ac('false', 'ten'), /not a valid amount/],
    ]
    for (const [a, why] of cases) {
      const k = lineRule(invoice(PEPPOL_HEAD, line('1', '10.00', '10.00', a)))
      expect(k.outcome).toBe('ABSTAIN')
      expect(k.detail).toMatch(why)
      expect(k.claim.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    }
  })
  it('ZATCA BR-KSA-EN16931-11 takes the same terms, at its own 0.005 (only the product is rounded)', () => {
    const z = (ext: string): EinvoiceConsistency => lineRule(invoice(ZATCA_HEAD, line('4', ext, '25.00', ac('false', '15.00'))))
    expect(z('85.00')).toMatchObject({ rule_id: 'BR-KSA-EN16931-11', outcome: 'PASS' })
    expect(z('85.01').outcome).toBe('FAIL')
    expect(z('85.00').operands.find((o) => o.term === 'BT-136')).toMatchObject({ value: 15 })
  })
})

describe('KSeF lines: the ruleset\'s own guard decides (P_9B / P_11A are passed through)', () => {
  const KSEF = (lineXml: string): string => `<?xml version="1.0" encoding="UTF-8"?><Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek><Fa><KodWaluty>PLN</KodWaluty><P_15>123.00</P_15><FaWiersz><NrWierszaFa>1</NrWierszaFa>${lineXml}</FaWiersz></Fa></Faktura>`
  const rule = (lineXml: string): EinvoiceConsistency => verifyEinvoiceTwin(KSEF(lineXml), [], OPTS).consistency.find((c) => c.house_code === 'LINE_NET_INT')!
  it('a plain line decides; the rule text is the built-in identity without P_10', () => {
    const k = rule('<P_8B>2</P_8B><P_9A>50.00</P_9A><P_11>100.00</P_11>')
    expect(k.outcome).toBe('PASS')
    expect(k.claim.rule_name).toMatch(/^P_11 = P_8B × P_9A \(house identity/)
    expect(k.claim.rule_name).not.toMatch(/P_9A − P_10/)
  })
  it('P_9B, P_11A and P_10 each make the line abstain with the ruleset\'s sourced reason', () => {
    for (const extra of ['<P_9B>61.50</P_9B>', '<P_11A>123.00</P_11A>', '<P_10>5.00</P_10>']) {
      const k = rule(`<P_8B>2</P_8B><P_9A>50.00</P_9A>${extra}<P_11>100.00</P_11>`)
      expect(k.outcome).toBe('ABSTAIN')
      expect(k.detail).toMatch(/^guard abstain_if_present: P_(9B|11A|10) is reported/)
      expect(k.detail).toMatch(/Reason: P_10 \(discounts not already in the net unit price\)/)
    }
  })
  it('GROSS_INT carries the ruleset\'s declared abstention, not a stale twin text', () => {
    const g = verifyEinvoiceTwin(KSEF('<P_8B>2</P_8B><P_9A>50.00</P_9A><P_11>100.00</P_11>'), [], OPTS).consistency.find((c) => c.house_code === 'GROSS_INT')!
    expect(g.outcome).toBe('ABSTAIN')
    expect(g.detail).toMatch(/^declared abstention: UNSOURCED/)
    expect(g.claim.rule_name).not.toMatch(/does not declare/)
  })
})

describe('BT-111 binds only with BT-6, and the footing ruleset version is bound into the verdict (map 0.2.0)', () => {
  const T = (withBt6: boolean): string => invoice(`${PEPPOL_HEAD}${withBt6 ? '<cbc:TaxCurrencyCode>SEK</cbc:TaxCurrencyCode>' : ''}`,
    '<cac:TaxTotal><cbc:TaxAmount currencyID="SEK">10</cbc:TaxAmount></cac:TaxTotal>')
  const claim = [{ id: 'a', field: 'tax_amount_accounting_currency', value: 10 }]
  it('a tax total without subtotals and no TaxCurrencyCode is not BT-111 (PEPPOL-EN16931-R054): the claim abstains', () => {
    const j = verifyEinvoiceTwin(T(false), claim, OPTS).judgments[0]!
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_ELEMENT' })
    expect(j.detail).toMatch(/states no VAT accounting currency \(BT-6.*PEPPOL-EN16931-R054/)
    expect(verifyEinvoiceTwin(T(true), claim, OPTS).judgments[0]).toMatchObject({ outcome: 'PASS', binding: { term: 'BT-111' } })
  })
  it('the verdict input names the footing ruleset id@version (so a ruleset change moves the verdict_id)', () => {
    expect(einvoiceVerdictInput('x', 'ksef-fa3', [], {})).toMatchObject({ map: 'twin-einvoice-ksef-fa3@0.3.0', footing: 'ksef-fa3-pl@0.2.0' })
    expect(einvoiceVerdictInput('x', 'peppol-bis3', [], {})).toMatchObject({ footing: 'peppol-en16931@0.1.0' })
    expect(einvoiceVerdictInput('x', 'peppol-bis3', [], { consistency: false })).toMatchObject({ footing: null })
  })
})
