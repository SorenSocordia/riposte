/**
 * AP payment details, sender domains and pay-application continuity (engine 0.6.0, 2026-10-06), on a cold review's own cases
 * (test/fixtures/ap-cold-review/README.md).
 *
 *   -   a bill whose text asks to change where payment goes, or prints bank-account details, is a person's decision, the
 *       controller clearing it (ap.remittance); an IBAN is never read as a stated total; a sender writing from a look-alike of the
 *       vendor's domain is a near match for the controller and never evidence of identity; an email header (Subject) is never
 *       vendor evidence; a purchase order that names the vendor's domain is compared with the sender's; every approve says what
 *       it did not check.
 *   -   a pay application's scheduled values are compared with last month's (a change needs a change order), a new line is read
 *       as a change order when net change orders account for it, the form's own column D convention for stored materials is read,
 *       and no internal role name reaches the screen.
 *   -   invoiced_quantity_to_date nets a bill line by line; leading zeros of an invoice number count as punctuation; the tax rule
 *       (person, allow, a rate); one phrase, "a look-alike vendor", in the duplicate and vendor reasons.
 *   -   `verify replay` on the file `ap --input` writes replays its proof member.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import { AP_REMEDIES_V060, TEXT_PATH_NOT_CHECKED, apPolicyOf, parseTaxPolicy, splitApLayout, taxNotCheckedText070, taxPolicyText, verifyInvoiceMatch, type ApResult } from '../src/ap/index'
import { apProofOf, verifyBillMatch } from '../src/ap/structured'
import { looseNumber } from '../src/ap/duplicate'
import { BANK_NOT_CHECKED_TEXT, bankNotCheckedText070, readRemittance } from '../src/ap/remittance'
import { domainOf, poDomainOf } from '../src/ap/vendor'
import { formatApReport } from '../src/ap/report'
import { structuredFromText } from '../src/ap/from-text'
import { verify } from '../src/verify'
import { formatPayAppReport } from '../src/rulesets/pay-app/report'
import { cleanScratch, scratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'ap-cold-review')
const NOW = (): Date => new Date('2026-10-06T00:00:00Z')
const text = (name: string): string => readFileSync(join(F, name), 'utf8')
const json = (name: string): any => JSON.parse(readFileSync(join(F, name), 'utf8'))
const layout = (t: string, history: unknown[] | undefined = []) => ({ ...splitApLayout(t)!, ...(history ? { history: history as never } : {}) })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const cli = (argv: string[]) => { let out = '', err = ''; const code = run(argv, { out: (s) => { out += s }, err: (s) => { err += s } }) as number; return { code, out, err } }
afterAll(() => cleanScratch())

describe('payment details on the bill: a person decides, the controller clears it', () => {
  it('the cold review\'s bill (look-alike sender, "our bank details have changed") is a person\'s, for both, never an approve', () => {
    const r = verifyInvoiceMatch(layout(text('ap-bec2.txt')), { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
    const rem = claim(r, 'ap.remittance')!
    expect(rem.outcome).toBe('INSUFFICIENT_DATA')
    expect(rem.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(rem.explanation).toContain('invoice line 23: "Note: our bank details have changed. Please remit to our new account at Evil Bank; details are attached."')
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.remittance: the bill asks to change where payment goes/)
    const v = claim(r, 'ap.vendor')!
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    expect(v.computation?.operands?.vendor_match).toBe('near')
    expect(v.explanation).toContain('a look-alike vendor: aldine-janitorial-payments.co adds "payments" to a name built from Aldine Janitorial\'s')
    expect(r.reasons.some((s) => s.startsWith('also for a person: cannot decide ap.vendor: the bill\'s sender, ar@aldine-janitorial-payments.co'))).toBe(true)
    // the controller clears both, for this verdict only
    const who = (r.verdict.remedies ?? []).filter((m) => m.kind === 'authority')
    expect(who.map((m) => [m.authority, m.claims])).toEqual(expect.arrayContaining([['ap-controller', ['ap.remittance']], ['ap-controller', ['ap.vendor']]]))
    const report = formatApReport(r, { documents: splitApLayout(text('ap-bec2.txt'))! })
    expect(report).toContain('A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found a request to change where payment goes.')
    expect(report).toContain('the AP controller (ap-controller), for ap.remittance, for this verdict only')
  })

  it('an IBAN on a "please remit" line is never a stated total: the total check passes and the bank change is named', () => {
    const r = verifyInvoiceMatch(layout(text('ap-bec.txt')), { now: NOW })
    expect(claim(r, 'ap.total')!.outcome).toBe('PASS')
    expect(claim(r, 'ap.total')!.asserted).toBe(1935.5)
    expect(claim(r, 'ap.remittance')!.explanation).toContain('IBAN GB00 EVIL 0000 0000 0000 00')
    expect(r.decision).toBe('abstain')
  })

  it('what is read, and what is not: a remit-to postal address and words sharing a stem are ordinary', () => {
    expect(readRemittance('Remit to: PO Box 4471, Denver CO 80217. Phone 303-555-0142.')).toEqual([])
    expect(readRemittance('Previous balance on your account: USD 999.99 (not part of this invoice).')).toEqual([])
    expect(readRemittance('- 10 x Wire shelving unit 48 in @ USD 89.00 = USD 890.00')).toEqual([])
    const kinds = (s: string) => readRemittance(s).map((h) => h.kind)
    expect(kinds('Please note our new bank account: details attached.')).toEqual(['change'])
    expect(kinds('We have changed banks; please update your records.')).toEqual(['change'])
    expect(kinds('Please remit to our account at First Bank.')).toEqual(['change'])
    expect(kinds('Routing number 021000021, account number 123456789')).toEqual(['details'])
    expect(kinds('Wire instructions: SWIFT BOFAUS3N')).toEqual(['details'])
  })

  it('a bill without payment text gets no such claim, and the structured path has none', () => {
    const r = verifyInvoiceMatch(layout(text('ap-clean.txt')), { now: NOW })
    expect(claim(r, 'ap.remittance')).toBeUndefined()
    expect(r.decision).toBe('approve')
    const s = verifyBillMatch(json('L1-clean-exact.json'), { now: NOW })
    expect(claim(s, 'ap.remittance')).toBeUndefined()
  })

  it('structured input cannot state payment text or a look-alike sender, so the text reading converts to none', () => {
    expect(structuredFromText(splitApLayout(text('ap-bec2.txt'))!)).toEqual({ ok: false, reason: expect.stringMatching(/look-alike|payment/) })
    expect(structuredFromText(splitApLayout(text('ap-clean.txt'))!).ok).toBe(true)
  })
})

describe('the sender\'s domain against the vendor', () => {
  const clean = text('ap-clean.txt')
  it('a domain built from the vendor\'s name passes, read first; a subject line is never the evidence', () => {
    const r = verifyInvoiceMatch(layout(clean), { now: NOW })
    const v = claim(r, 'ap.vendor')!
    expect(v.outcome).toBe('PASS')
    expect(v.computation?.operands?.read_by).toBe('sender address')
    expect(v.evidence[0]!.value).toBe('ar@aldinejan.com')
  })
  it('one letter off ("aidinejan" for Aldine Janitorial) is a look-alike, a near match for the controller', () => {
    const r = verifyInvoiceMatch(layout(text('ap-homo.txt')), { now: NOW })
    const v = claim(r, 'ap.vendor')!
    expect(v.computation?.operands?.vendor_match).toBe('near')
    expect(v.explanation).toContain('aidinejan.com is one character away from a name built from Aldine Janitorial\'s')
    expect(formatApReport(r)).toContain("found a sender writing from a look-alike of the vendor's domain")
  })
  it('the vendor\'s name as a subdomain of another domain is a look-alike, never the vendor\'s domain', () => {
    expect(domainOf('ar@aldinejan.com.evil.co')).toEqual({ host: 'aldinejan.com.evil.co', registrable: 'evil', sub: ['aldinejan', 'com'], domain: 'evil.co' })
    expect(domainOf('x@shop.co.uk')?.domain).toBe('shop.co.uk')
    const r = verifyInvoiceMatch(layout(clean.replace('ar@aldinejan.com', 'ar@aldinejan.com.evil.co')), { now: NOW })
    expect(claim(r, 'ap.vendor')!.explanation).toContain('appears only as a subdomain of evil.co')
    expect(r.decision).toBe('abstain')
  })
  it('a company-form word beside the name is the vendor\'s own domain ("aldinejanitorialgroup")', () => {
    const r = verifyInvoiceMatch(layout(clean.replace('ar@aldinejan.com', 'ar@aldinejanitorialgroup.com')), { now: NOW })
    expect(claim(r, 'ap.vendor')!.outcome).toBe('PASS')
    expect(r.decision).toBe('approve')
  })
  it('the vendor named only in a subject line, the sender unrelated: a person decides', () => {
    const t = clean.replace('ar@aldinejan.com', 'billing@unrelated-mail.example').replace('Accounts Receivable, Aldine Janitorial', 'Accounts Receivable')
    const r = verifyInvoiceMatch(layout(t), { now: NOW })
    expect(claim(r, 'ap.vendor')!.outcome).toBe('INSUFFICIENT_DATA')
    // engine 0.7.0: with no domain on file, a sender whose domain is not built from the vendor's name is a person's, whatever a
    // line of the bill says
    expect(claim(r, 'ap.vendor')!.explanation).toContain('writes from unrelated-mail.example, which is not built from the purchase order\'s vendor name, Aldine Janitorial')
  })
  describe('a purchase order that names the vendor\'s domain', () => {
    const withDomain = (t: string) => t.replace('PO-49051 | Vendor: Aldine Janitorial | Freight: not allowed', 'PO-49051 | Vendor: Aldine Janitorial | Email: ar@aldinejan.com | Freight: not allowed')
    it('the sender writes from it: the vendor check passes by it', () => {
      expect(poDomainOf('PO-1 | Vendor: X | Email: ar@aldinejan.com')?.domain).toBe('aldinejan.com')
      const r = verifyInvoiceMatch(layout(withDomain(clean)), { now: NOW })
      expect(claim(r, 'ap.vendor')!.computation?.operands?.read_by).toBe('po domain')
      expect(r.decision).toBe('approve')
      expect(r.not_checked[0]).toMatch(/^vendor identity: the sender, ar@aldinejan.com, writes from the domain the purchase order names/)
    })
    it('another domain built from the vendor\'s name is a look-alike of it; an unrelated one is another domain', () => {
      const a = verifyInvoiceMatch(layout(withDomain(clean).replace('ar@aldinejan.com\n', 'ar@aldine-janitorial.com\n')), { now: NOW })
      expect(claim(a, 'ap.vendor')!.computation?.operands?.vendor_match).toBe('near')
      expect(claim(a, 'ap.vendor')!.explanation).toContain('is built from the vendor\'s name, but it is not the domain the purchase order names, aldinejan.com')
      const b = verifyInvoiceMatch(layout(withDomain(clean).replace('ar@aldinejan.com\n', 'ar@invoices.example\n')), { now: NOW })
      expect(claim(b, 'ap.vendor')!.computation?.operands?.vendor_match).toBe('different')
      expect(b.decision).toBe('abstain')
    })
  })
})

describe('every approve says what it did not check', () => {
  it('text path: the vendor\'s identity beyond the match, the bank details, tax', () => {
    // 2026-10-14: pinned to ap-threeway@0.2.0, whose payment line these words are; 0.3.0's (the default from engine 0.7.2) names each
    // sentence that names payment, asserted in ap-announced-change.test.ts
    const r = verifyInvoiceMatch(layout(text('ap-clean.txt')), { now: NOW, ruleset: 'ap-threeway@0.2.0' })
    expect(r.decision).toBe('approve')
    // 2026-10-06: each line says what was compared or scanned, and what was not; none asserts what it did not establish
    expect(r.not_checked).toEqual([
      'vendor identity: matched by the sender\'s address, ar@aldinejan.com (invoice line 8), whose domain is the vendor\'s name run together; no domain for the vendor is on file (none on the purchase order, no sender on a booked bill), so it was compared with names built from the vendor\'s name only, and that this is the vendor\'s own domain, that the sender owns it, and that the vendor record is genuine were not checked',
      // 2026-10-13 (engine 0.7.0): every sentence read, the standing remit-to line named when there is one; tax lines read, and
      // the rate the purchase order states; the path the bill came through, last
      bankNotCheckedText070([]),
      taxNotCheckedText070(null),
      TEXT_PATH_NOT_CHECKED,
    ])
    expect(BANK_NOT_CHECKED_TEXT).toMatch(/^payment redirection: none of the 25 phrasings/) // engine 0.6.0's words, kept for its verdicts
    expect(formatApReport(r)).toMatch(/Not checked:\n {2}- vendor identity: .*\n {2}- payment redirection: .*\n {2}- tax: .*\n {2}- This bill was read from text/)
  })
  it('structured path: the vendor match, the bank details, and tax only where the order states none', () => {
    const r = verifyBillMatch(json('L1-clean-exact.json'), { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.not_checked).toContain('vendor identity: the bill\'s vendor was matched to the purchase order\'s by vendor id; who sent the bill, and whether the vendor record is genuine, were not checked (the structured input carries no sender)')
    expect(r.not_checked).toContain('payment redirection: the structured input has no field for payment instructions or bank details, so where the payment goes was not checked against the vendor master')
    expect(r.not_checked.some((s) => s.startsWith('tax:'))).toBe(false) // the order states a rate, and the tax was checked against it
  })
  it('a hold or a person carries no scope block (the bill is not paid automatically)', () => {
    const r = verifyInvoiceMatch(layout(text('ap-bec2.txt')), { now: NOW })
    expect(r.not_checked.some((s) => s.startsWith('payment redirection:'))).toBe(false)
  })
})

describe('leading zeros, and one phrase for a look-alike vendor', () => {
  it('SES-020417 against booked SES-20417 is the same number apart from a leading zero: a person, both reasons saying "a look-alike vendor"', () => {
    expect(looseNumber('SES-020417')).toBe(looseNumber('SES-20417'))
    expect(looseNumber('INV-000')).toBe('INV0')
    const r = verifyBillMatch(json('B3-dup-typo-vendor-new-id-leading-zero.json'), { now: NOW })
    const d = claim(r, 'ap.duplicate')!
    expect(d.outcome).toBe('INSUFFICIENT_DATA')
    expect(d.explanation).toContain('matches booked invoice SES-20417 (paid 2026-09-02) apart from punctuation, spacing or leading zeros')
    expect(d.explanation).toContain("a look-alike vendor (booked as 'Summit Electrical Supply'; this bill says 'Sumit Electrical Supply'")
    expect(claim(r, 'ap.vendor')!.explanation).toContain('a look-alike vendor, another vendor id (the bill V-2290; the order V-1022)')
    expect(d.explanation).not.toContain('same vendor')
  })
})

describe('invoiced_quantity_to_date nets a bill line by line', () => {
  const b12 = (earlier?: number) => { const x = json('B12-reel-billed-twice-54-of-40.json'); if (earlier !== undefined) x.purchase_order.line_items[0].invoiced_quantity_to_date = earlier; return x }
  it('absent: approved as before, and the gap names the field that closes it', () => {
    const r = verifyBillMatch(b12(), { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.not_checked.find((s) => s.startsWith('quantities per PO line'))).toContain('invoiced_quantity_to_date on each PO line (the quantity earlier bills invoiced on it) lets this bill be netted line by line')
  })
  it('24 already invoiced, 30 on this bill, 40 received: a person decides, the buyer clears it', () => {
    const r = verifyBillMatch(b12(24), { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
    const c = claim(r, 'ap.line[1].billed_to_date')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.explanation).toBe('MC cable 12/2 250ft roll: billed to date would be 54 against 40 received: 24 invoiced earlier on PO line 1 (invoiced_quantity_to_date), 30 on this bill. A person confirms what is still open on the line (an earlier bill credited, or units received and not yet posted) before it is paid')
    expect((r.verdict.remedies ?? []).some((m) => m.authority === 'buyer' && m.claims.includes('ap.line[1].billed_to_date'))).toBe(true)
    expect(r.not_checked.some((s) => s.startsWith('quantities per PO line'))).toBe(false)
    expect(formatApReport(r)).toContain('Open first: the billed-to-date check on line 1 (ap.line[1].billed_to_date) found more billed to date on the line than was received.')
  })
  it('10 already invoiced: 40 of 40, the check passes and the bill is approved', () => {
    const r = verifyBillMatch(b12(10), { now: NOW })
    expect(claim(r, 'ap.line[1].billed_to_date')!.outcome).toBe('PASS')
    expect(r.decision).toBe('approve')
  })
  it('a negative or non-numeric value is refused with its field', () => {
    const x = b12(); x.purchase_order.line_items[0].invoiced_quantity_to_date = -1
    expect(() => verifyBillMatch(x, { now: NOW })).toThrow(/invoiced_quantity_to_date/)
  })
})

describe('the tax rule: person (default), allow, or a rate', () => {
  const silent = (tax: string) => { const x = json('L1-clean-exact.json'); delete x.purchase_order.tax_rate; const lines = x.bill.line_items.reduce((s: number, l: any) => s + Number(l.amount), 0); x.bill.tax = tax; x.bill.amount = (lines + Number(tax)).toFixed(2); return x }
  const base = json('L1-clean-exact.json')
  const linesSum = base.bill.line_items.reduce((s: number, l: any) => s + Number(l.amount), 0)
  const at = (rate: number) => (Math.round(linesSum * rate * 100) / 100).toFixed(2)
  it('the flag reads person, allow, rate:8.25% or rate:0.0825; a bare 8.25 is refused', () => {
    expect(parseTaxPolicy('rate:8.25%')).toEqual({ value: { rate: 0.0825 } })
    expect(parseTaxPolicy('rate:0.0825')).toEqual({ value: { rate: 0.0825 } })
    expect(parseTaxPolicy('rate:8.25')).toHaveProperty('error')
    expect(taxPolicyText({ rate: 0.0825 })).toBe('rate:8.25%')
    expect(apPolicyOf({ tax: 'person' })).toEqual(apPolicyOf()) // the default is never written
  })
  it('person: tax on an order with no tax terms goes to a person, as before', () => {
    expect(verifyBillMatch(silent(at(0.0825)), { now: NOW }).decision).toBe('abstain')
  })
  it('allow: accepted as billed, and the approve says it was not checked against a rate', () => {
    const r = verifyBillMatch(silent(at(0.0825)), { now: NOW, policy: { tax: 'allow' } })
    expect(r.decision).toBe('approve')
    expect(claim(r, 'ap.tax')!.explanation).toContain("this run's tax policy (--tax allow) accepts tax as billed")
    expect(r.not_checked).toContain("tax: accepted as billed under this run's tax policy (--tax allow); it was not checked against a rate")
  })
  it('a rate: the tax checked against it; off by more than the price tolerance, a person (never a hold)', () => {
    const ok = verifyBillMatch(silent(at(0.0825)), { now: NOW, policy: { tax: { rate: 0.0825 } } })
    expect(ok.decision).toBe('approve')
    expect(claim(ok, 'ap.tax')!.explanation).toContain("this run's tax rate, 8.25% (--tax rate:8.25%; the purchase order states no tax terms)")
    const off = verifyBillMatch(silent(at(0.095)), { now: NOW, policy: { tax: { rate: 0.0825 } } })
    expect(off.decision).toBe('abstain')
    expect(claim(off, 'ap.tax')!.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
  })
  it('an order that states its rate is never overridden by the rule', () => {
    const r = verifyBillMatch(json('B6-tax-wrong-rate.json'), { now: NOW, policy: { tax: 'allow' } })
    expect(r.decision).toBe('abstain')
    expect(claim(r, 'ap.tax')!.computation?.operands?.tax_policy).toBeUndefined()
  })
  it('the rule is bound into the verdict\'s inputs; refused on the text path and under an earlier engine', () => {
    const a = verifyBillMatch(silent(at(0.0825)), { now: NOW, policy: { tax: 'allow' } })
    const p = verifyBillMatch(silent(at(0.0825)), { now: NOW })
    expect(a.verdict.input_hash).not.toBe(p.verdict.input_hash)
    expect(() => verifyInvoiceMatch(layout(text('ap-clean.txt')), { policy: { tax: 'allow' } })).toThrow(/applies to structured input \(ap --input\) only/)
    expect(() => verifyBillMatch(silent(at(0.0825)), { policy: { tax: 'allow' }, engine: '0.5.0' })).toThrow(/needs engine 0.6.0/)
    expect(cli(['ap', join(HERE, 'fixtures', 'data', 'ap-three-way.txt'), '--tax', 'allow']).code).toBe(3)
  })
})

describe('replay accepts what ap --input writes', () => {
  it('the proof member is replayed, and the run says so; a file changed after it was written is refused', () => {
    const dir = scratch('m5-')
    const input = join(dir, 'bill.json'), out = join(dir, 'ap-out.json')
    writeFileSync(input, JSON.stringify(json('L1-clean-exact.json')))
    const a = cli(['ap', '--input', input])
    expect(a.code).toBe(0)
    writeFileSync(out, a.out)
    expect(apProofOf(JSON.parse(a.out))?.same).toBe(true)
    const r = cli(['replay', out])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/^verify replay: outcome VERIFIED/)
    expect(r.err).toContain('this file is the output of `ap --input`; its proof member (the verdict and the inputs it was issued on) was replayed')
    const changed = JSON.parse(a.out)
    changed.verdict.outcome = 'FAIL'
    writeFileSync(out, JSON.stringify(changed))
    const c = cli(['replay', out])
    expect(c.code).toBe(1)
    expect(c.err).toContain('the file\'s verdict is not the verdict in its proof member')
  })
})

describe('pay-application continuity with last month', () => {
  const prev = json('payapps/app3.previous.json')
  const check = (doc: any, engine?: string) => verify(doc, { ruleset: 'pay-app', references: { history: [prev] }, now: NOW, ...(engine ? { engine } : {}) })
  const app = (name: string) => json(`payapps/${name}`)
  const open = (v: ReturnType<typeof verify>) => v.claims.filter((c) => c.outcome !== 'PASS').map((c) => `${c.claim_id}:${c.outcome}`)

  it('a scheduled value raised with no change order (PA-B5) is a person\'s, naming the line and the difference, the owner clearing it', () => {
    const v = check(app('PA-B5-sov-inflated-unapproved-CO.json'))
    expect(v.gate_status).toBe('PASS_WITH_OPEN')
    expect(open(v)).toEqual(['line[2].G703_PREV:INSUFFICIENT_DATA'])
    const c = v.claims.find((x) => x.claim_id === 'line[2].G703_PREV')!
    expect(c.explanation).toBe('Line 3\'s scheduled value rose from 96,000 to 121,000 since last month\'s application (by 25,000), and no change order on the application accounts for it; net change orders rose 25,000, from 18,500 to 43,500. A scheduled value changes only by change order: a person confirms the change order before this application is paid')
    // 2026-10-13: the AIA title is printed when the owner is the payer (payer_role owner); otherwise the payer is named as such
    const report = formatPayAppReport(v, { extraction: app('PA-B5-sov-inflated-unapproved-CO.json'), payer_role: 'owner' })
    expect(report).toContain('who may clear it: the owner (owner), for this application only')
    expect(formatPayAppReport(v, { extraction: app('PA-B5-sov-inflated-unapproved-CO.json') })).toContain("who may clear it: the payer's controller (ruling role: owner), for this application only")
  })
  it('the same raise with the change order stated on the application passes, naming it', () => {
    const doc = app('PA-B5-sov-inflated-unapproved-CO.json')
    doc.change_orders = [{ number: 'CO-03', amount: 25000, item_no: '3' }]
    const v = check(doc)
    expect(v.gate_status).toBe('PASS')
    expect(v.claims.find((x) => x.claim_id === 'line[2].G703_PREV')!.explanation).toContain('which change order CO-03 (25,000) stated on the application for item 3 accounts for; that the owner approved the change order is not checked')
  })
  it('stored materials by the form\'s column D heading, and a new change-order line (PA-L1): PASS, naming the reading', () => {
    const v = check(app('PA-L1-app4-CO02-stored-installed.json'))
    expect(v.gate_status).toBe('PASS')
    expect(v.coverage.claims_pass).toBe(49)
    const l4 = v.claims.find((x) => x.claim_id === 'line[3].G703_PREV')!
    expect(l4.explanation).toContain('column D read by the form\'s own heading, "from previous application (D + E)"')
    const l8 = v.claims.find((x) => x.claim_id === 'line[7].G703_PREV')!
    expect(l8.explanation).toContain('line 8 is new this month (item 8, scheduled value 8,000)')
    expect(l8.explanation).toContain('net change orders rose 8,000, from 18,500 to 26,500, which the new line accounts for')
    const report = formatPayAppReport(v, { extraction: app('PA-L1-app4-CO02-stored-installed.json') })
    expect(report).toContain('Previous work: lines 4 and 5 read column D by the form\'s own heading')
    expect(report).toContain('Change order: Line 8 is new this month')
  })
  it('stored materials carried in column D (PA-L2): PASS, naming that reading', () => {
    const v = check(app('PA-L2-app4-previous-includes-stored.json'))
    expect(v.gate_status).toBe('PASS')
    expect(v.claims.find((x) => x.claim_id === 'line[3].G703_PREV')!.explanation).toContain('stored materials included (6,000 stored last month): column D read as last month\'s column G')
  })
  it('a new line net change orders do not account for: a person, in the sentence a controller asked for', () => {
    const doc = app('PA-L1-app4-CO02-stored-installed.json')
    doc.net_change_orders = 18500; doc.original_contract_sum = 420000
    const v = check(doc)
    const c = v.claims.find((x) => x.claim_id === 'line[7].G703_PREV')!
    expect(c.explanation).toMatch(/^Line 8 is new this month \(item 8, scheduled value 8,000\); net change orders did not change, at 18,500: confirm it is a change order/)
    expect(v.claims.find((x) => x.claim_id === 'document.G702_PREV')!.explanation).toContain('The original contract sum (line 1) is 420,000 on this application and was 412,000 on last month\'s')
  })
  it('the errors stay as they were: PA-B1 to PA-B4 FAIL or go to a person on their own finding, PA-L3 passes', () => {
    expect(open(check(app('PA-B1-rebill-certified-ductwork.json')))).toEqual(['line[1].G703_PREV:FAIL'])
    expect(open(check(app('PA-B2-less-previous-understated.json')))).toEqual(['document.G702_PREV:FAIL'])
    expect(open(check(app('PA-B3-retainage-5pct-silent.json')))).toEqual(['document.G702_RATE:INSUFFICIENT_DATA'])
    expect(open(check(app('PA-B4-line-over-100pct.json')))).toEqual(['line[5].G703_CAP:FAIL'])
    expect(check(app('PA-L3-retainage-5pct-stated.json')).gate_status).toBe('PASS')
  })
  it('the shipped sample still passes 44 of 44', () => {
    const ex = join(HERE, '..', 'docs', 'examples')
    const v = verify(JSON.parse(readFileSync(join(ex, 'payapp-g702-g703.json'), 'utf8')), { ruleset: 'pay-app', references: { history: [JSON.parse(readFileSync(join(ex, 'payapp-g702-g703.previous.json'), 'utf8'))] }, now: NOW })
    expect([v.gate_status, v.coverage.claims_pass, v.coverage.claims_total]).toEqual(['PASS', 44, 44])
  })
  it('no internal role name reaches the screen: a new line with no history, and a line with no item number', () => {
    const doc = app('PA-L2-app4-previous-includes-stored.json')
    const none = verify(doc, { ruleset: 'pay-app', now: NOW })
    const r1 = formatPayAppReport(none, { extraction: doc })
    expect(r1).not.toMatch(/PREVIOUS_COMPLETED_TO_DATE|PREVIOUS_EARNED_LESS_RETAINAGE/)
    expect(r1).toContain("Last month's application, as history (--history <last-month.json>): the continuity checks then run.")
    const noItem = app('PA-L2-app4-previous-includes-stored.json'); delete noItem.schedule_of_values[7].item_no
    expect(formatPayAppReport(check(noItem), { extraction: noItem })).not.toMatch(/\b[A-Z]{3,}_[A-Z_]{3,}\b/)
  })
  it('an earlier engine reads as it did: PA-L1 FAILs under 0.5.0', () => {
    expect(check(app('PA-L1-app4-CO02-stored-installed.json'), '0.5.0').outcome).toBe('FAIL')
  })
})

describe('the remedy table', () => {
  it('carries the payment-details and billed-to-date remedies under engine 0.6.0', () => {
    expect(AP_REMEDIES_V060.AP_REMITTANCE?.abstain?.[0]?.authority).toBe('ap-controller')
    expect(AP_REMEDIES_V060.AP_QTY_TO_DATE?.abstain?.[0]?.authority).toBe('buyer')
  })
})
