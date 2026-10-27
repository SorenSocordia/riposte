/**
 * Payment redirection on every channel, sender domains read from the vendor's name, tax to the cent, the billed-to-date figures
 * settling a possible resubmission, and pay-application approval and retainage terms (engine 0.6.0, 2026-10-06), on a cold
 * reader's own cases (test/fixtures/ap-redirection/README.md).
 *
 *   -   An emailed bill that says to pay by Zelle to a Gmail address was approved, and its "Not checked" block said no line of
 *       the bill asked to change where payment goes. Every payment channel a controller has seen is now a phrasing on one list
 *       (PAYMENT_REDIRECTION), a line matching any of them is a person's decision for the controller, and an approve says only
 *       what was scanned: none of the listed phrasings matched; a wording not on the list is not caught.
 *   -   A sender from aldine-jan.com, aldinejan.co or a Gmail address was approved for "Aldine Janitorial": a hyphen the name
 *       lacks, an ending one letter off .com and a free-mail provider now go to a person, with no "Email:" field needed.
 *   -   Tax is checked to the cent against a stated rate (rounding only), the price tolerance is for prices.
 *   -   invoiced_quantity_to_date settles an equal-amount "possible resubmission".
 *   -   A change-order line marked pending owner approval is PASS-WITH-OPEN for the owner; the G702's 5a/5b retainage split is
 *       read from retainage_rate { completed_work, stored_materials }; a rate given as any other object is refused by name.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BANK_NOT_CHECKED_TEXT, PAYMENT_REDIRECTION, bankNotCheckedText070, readRemittance } from '../src/ap/remittance'
import { endingOffCom, freeMailOf } from '../src/ap/vendor'
import { splitApLayout, verifyInvoiceMatch, type ApDocuments, type ApResult, type PriorInvoice } from '../src/ap/index'
import { verifyBillMatch } from '../src/ap/structured'
import { structuredFromText } from '../src/ap/from-text'
import { formatApReport } from '../src/ap/report'
import { verify } from '../src/verify'
import { InputRefused } from '../src/protocol/input'
import { formatPayAppReport } from '../src/rulesets/pay-app/report'
import { run } from '../src/cli'
import { cleanScratch, scratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'ap-redirection')
const NOW = (): Date => new Date('2026-10-06T00:00:00Z')
const raw = (name: string): string => readFileSync(join(F, 'text', name), 'utf8')
const docs = (t: string, history: PriorInvoice[] = []): ApDocuments => ({ ...splitApLayout(t)!, history })
const T = (name: string, history: PriorInvoice[] = []): ApResult => verifyInvoiceMatch(docs(raw(name), history), { now: NOW })
const json = (p: string): any => JSON.parse(readFileSync(join(F, p), 'utf8'))
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const controller = (r: ApResult, id: string): boolean => (r.verdict.remedies ?? []).some((m) => m.kind === 'authority' && m.authority === 'ap-controller' && m.claims.includes(id))
const clean = raw('T1-legit-clean.txt')
const withLine = (line: string): ApResult => verifyInvoiceMatch(docs(clean.replace('Total due: USD 1,935.50\n', `Total due: USD 1,935.50\n${line}\n`)), { now: NOW })
const fromSender = (address: string, poExtra = '', history: PriorInvoice[] = []): ApResult =>
  verifyInvoiceMatch(docs(clean.replace('From: ar@aldinejan.com', `From: ${address}`).replace('| Freight: not allowed', `| Freight: not allowed${poExtra}`), history), { now: NOW })

describe('the cold reader\'s emailed bills: every redirection goes to a person, the controller clears it', () => {
  it('T5 (Zelle to a Gmail address): a person decides, the line quoted; never the sentence that no line asks to change where payment goes', () => {
    const r = T('T5-zelle-to-gmail.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.remittance')!
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('invoice line 21: "For faster processing please send payment by Zelle to billing.aldine@gmail.com"')
    expect(c.computation?.operands?.phrasings).toBe('Zelle; an email address named as the payee')
    expect(controller(r, 'ap.remittance')).toBe(true)
    const out = formatApReport(r, { documents: splitApLayout(raw('T5-zelle-to-gmail.txt'))! })
    expect(out).toContain('A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found where to send payment outside the vendor master')
    expect(out).not.toMatch(/no line of the bill asks/)
  })
  it('T4 (pay online at a link), T6 (aldine-jan.com), T7 (aldinejan.co), T8 (a Gmail sender): each a person, for the controller', () => {
    const t4 = T('T4-pay-by-link.txt')
    expect(t4.decision).toBe('abstain')
    expect(claim(t4, 'ap.remittance')!.explanation).toContain('invoice line 21: "To avoid delays please pay online at https://pay.aldinejan-billing.com/inv/AJ-97466"')
    const t6 = T('T6-hyphen-domain.txt'), t7 = T('T7-tld-swap-co.txt'), t8 = T('T8-gmail-sender.txt')
    for (const [r, words] of [
      [t6, 'aldine-jan.com writes a name built from Aldine Janitorial\'s with a hyphen the vendor\'s name does not carry ("aldine-jan")'],
      [t7, 'aldinejan.co is a name built from Aldine Janitorial\'s under .co, one letter off .com'],
      [t8, 'writes from a free-mail address (gmail.com), which anyone can open in any name; no domain or email for Aldine Janitorial is on file'],
    ] as const) {
      expect([r.decision, r.payable]).toEqual(['abstain', false])
      expect(claim(r, 'ap.vendor')!.explanation).toContain(words)
      expect(controller(r, 'ap.vendor')).toBe(true)
    }
    expect(claim(t8, 'ap.vendor')!.computation?.operands?.vendor_match).toBe('free-mail')
    expect(formatApReport(t8)).toContain('found a sender writing from a free-mail address')
  })
  it('the legitimate bills: T1 and T11 approve; T12 (ACH printed) and T2, T3, T10, T13 go to a person', () => {
    for (const n of ['T1-legit-clean.txt', 'T11-legit-remit-po-box.txt']) expect(T(n).decision, n).toBe('approve')
    for (const n of ['T2-bank-change-acct-ending.txt', 'T3-bank-change-soft-no-numbers.txt', 'T10-po-names-email-tld-swap.txt', 'T12-legit-ach-on-every-bill.txt', 'T13-lookalike-aidinejan.txt']) expect(T(n).decision, n).toBe('abstain')
  })
  it('T9 (sent from a billing platform, signed by the vendor): a person, until a booked bill puts the platform\'s address on file', () => {
    // engine 0.7.0: with no domain on file, a sender whose domain is not built from the vendor's name goes to a person; the
    // signature naming the vendor is written by whoever sends the bill, and counts for nothing
    const r = T('T9-legit-billing-platform.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(claim(r, 'ap.vendor')!.explanation).toContain('invoices@billtrust.com, writes from billtrust.com, which is not built from the purchase order\'s vendor name, Aldine Janitorial')
    const filed = T('T9-legit-billing-platform.txt', [{ invoice_number: 'AJ-90001', vendor: 'Aldine Janitorial', po_number: 'PO-40001', total: 500, sender: 'invoices@billtrust.com' }])
    expect(filed.decision).toBe('approve')
  })
  it('no approve on any of the thirteen carries a sentence about the bill it did not establish', () => {
    for (const n of readdirSync(join(F, 'text'))) {
      const r = T(n)
      for (const s of r.not_checked) expect(s, n).not.toMatch(/no line of the bill asks|none is billed/)
    }
  })
})

describe('the "Not checked" block says what was scanned, and what was not', () => {
  it('names the count of listed phrasings, says a wording not on the list is not caught, and that bank details are not inputs', () => {
    // 2026-10-14: pinned to ap-threeway@0.2.0, whose payment line bankNotCheckedText070 writes; 0.3.0's is asserted in ap-announced-change.test.ts
    const r = verifyInvoiceMatch(docs(raw('T1-legit-clean.txt'), []), { now: NOW, ruleset: 'ap-threeway@0.2.0' })
    expect(r.decision).toBe('approve')
    const line = r.not_checked.find((s) => s.startsWith('payment redirection:'))!
    // 2026-10-13 (engine 0.7.0): every sentence is read too; the listed phrasings are still named, with their count
    expect(line).toBe(bankNotCheckedText070([]))
    expect(line).toContain(`the ${PAYMENT_REDIRECTION.length} phrasings listed in docs/AP-INPUT.md were scanned`)
    expect(line).toContain('a wording the reading does not parse is not caught')
    expect(line).toContain('the vendor\'s bank details are not part of the inputs')
    expect(BANK_NOT_CHECKED_TEXT).toContain('a wording not on that list is not caught') // engine 0.6.0's words, kept for its verdicts
    expect(r.not_checked.find((s) => s.startsWith('tax:'))).toBe('tax: no line of the bill was read as tax (every amount on it was read as a line, the total or freight), and the purchase order states no tax rate; tax included in a price is not read, so whether tax was due was not checked')
  })
  it('docs/AP-INPUT.md lists every phrasing, in its own words, so the count the block names is the list a reader finds', () => {
    const doc = readFileSync(join(HERE, '..', 'docs', 'AP-INPUT.md'), 'utf8').replace(/\s+/g, ' ')
    for (const p of PAYMENT_REDIRECTION) expect(doc, p.label).toContain(p.label)
  })
})

describe('each listed phrasing, and what is not a redirection', () => {
  const EXAMPLES: Record<string, string> = {
    'a statement that bank, payment or remittance details have changed': 'Our banking details have been updated.',
    'new, changed, updated or revised bank, payment or remittance details, instructions, account or address': 'See our revised payment instructions.',
    '"new account" (a new bank, banking, checking or business account)': 'Please use our new checking account.',
    '"we have changed banks" (changed, switched or moved banks or accounts, or a banking relationship)': 'We recently moved our banking relationship.',
    '"change of bank", "change in payment details" and the like': 'Notice of change of bank.',
    '"please update", "note" or "use" our (new) bank, payment, remittance, wire or ACH details': 'Please update our remittance on file.',
    '"updated remittance"': 'Updated remittance enclosed.',
    'payments directed, redirected or routed elsewhere ("direct all future payments to ...")': 'Kindly direct all future payments to the account below.',
    '"remit to" on a line that also names an account, a bank, an IBAN, a wire, ACH, a routing number, a web address or an email address': 'Remit to: payments@aldinejan.com',
    'an IBAN (the word, or an IBAN-shaped number)': 'GB00 EVIL 0000 0000 0000 00',
    'a routing, ABA or transit number': 'Routing number 021000021',
    'an account number, or an account ending in digits': 'acct ending 4471',
    'a SWIFT or BIC code': 'SWIFT: BOFAUS3N',
    'a sort code': 'Sort code 20-00-00',
    'wire or ACH transfer, instructions or details ("ACH:" included)': 'Wire instructions attached.',
    Zelle: 'We accept Zelle.',
    Venmo: 'Venmo is fine.',
    PayPal: 'Pay by PayPal.',
    'Cash App, or a $cashtag': 'Cash App: $AldineAR',
    'Western Union or MoneyGram': 'MoneyGram accepted.',
    'cryptocurrency (bitcoin, BTC, Ethereum, USDT, USDC, a crypto wallet)': 'We take bitcoin.',
    'a web address on a line about paying ("pay online at https://...", "payment portal: ...")': 'Pay online at www.aldinejan-pay.com',
    '"pay by link", "payment link", "click here to pay" and the like': 'Click here to pay.',
    'an email address named as the payee ("send payment to billing@...")': 'Send payment to billing.aldine@outlook.com',
    'a phone number named as the payee ("send payment to 713-555-0100")': 'Please send payment to 713-555-0144.',
  }
  it('one example per phrasing matches it', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(PAYMENT_REDIRECTION.map((p) => p.label).sort())
    for (const [label, line] of Object.entries(EXAMPLES)) expect(readRemittance(line)[0]?.matched ?? [], label).toContain(label)
  })
  it('and any of them on a bill is a person\'s decision', () => {
    for (const line of Object.values(EXAMPLES)) expect(withLine(line).decision, line).toBe('abstain')
  })
  it('ordinary lines are not: a remit-to post office box with a phone, a remittance advice, questions, a web footer, terms, a tool tether', () => {
    for (const line of [
      'Remit to: PO Box 4471, Denver CO 80217. Phone 303-555-0142.',
      'Please email remittance advice to ar@aldinejan.com.',
      'Payment questions? Email ar@aldinejan.com or call 713-555-0100.',
      'www.aldinejan.com',
      'Payment terms: Net 30. Thank you for your business.',
      'Note: tool tether sets ship next week.',
      'We moved our accounts receivable team to Houston.',
    ]) {
      expect(readRemittance(line), line).toEqual([])
      expect(withLine(line).decision, line).toBe('approve')
    }
  })
})

describe('the sender against the vendor, with or without a domain on file', () => {
  it('no domain on file: the name run together passes; a hyphen the name carries passes; .net passes; a scanning slip is read back', () => {
    expect(fromSender('ar@aldinejan.com').decision).toBe('approve')
    expect(fromSender('ar@aldinejan.net').decision).toBe('approve')
    expect(fromSender('ar@aldinejan.ocm').decision).toBe('approve')
    // a scanning slip that moves the dot reads back to .com; a swap within ".co" never makes it pass
    expect(fromSender('ar@aldineja.ncom').decision).toBe('approve')
    expect(fromSender('ar@aldinejanc.om').decision).toBe('approve')
    const pw = verifyInvoiceMatch(docs(clean.replace('From: ar@aldinejan.com', 'From: ar@pryce-webb.com').replaceAll('Aldine Janitorial', 'Pryce-Webb Supply')), { now: NOW })
    expect(pw.decision).toBe('approve')
    // engine 0.7.0: a hyphen the name does not carry is a look-alike, where the name has a space between two words or before a
    // company-form word too ("gulfcoast-supply.com" was the cheapest domain a fraudster could buy for "Gulf Coast Supply")
    expect(fromSender('ar@aldine-janitorial.com').decision).toBe('abstain')
    expect(fromSender('ar@aldinejanitorial-group.com').decision).toBe('abstain')
    // ... and the domain on file settles it
    expect(fromSender('ar@aldine-janitorial.com', ' | Email: ar@aldine-janitorial.com').decision).toBe('approve')
  })
  it('a hyphen the name lacks, an ending one letter off .com, the name plus another word, a free-mail provider: a person', () => {
    for (const a of ['ar@aldine-jan.com', 'ar@aldinejan.cm', 'ar@aldinejan.co', 'ar@aldinejan-billing.com', 'ar@aldinejanitorial-ar.com', 'aldine.ar@outlook.com', 'ar.aldine@yahoo.co.uk']) expect(fromSender(a).decision, a).toBe('abstain')
    expect([endingOffCom('co'), endingOffCom('cm'), endingOffCom('om'), endingOffCom('con'), endingOffCom('net'), endingOffCom('ocm'), endingOffCom('co.uk')]).toEqual([true, true, true, true, false, false, false])
    expect([freeMailOf('x@gmail.com'), freeMailOf('x@yahoo.co.uk'), freeMailOf('x@me.com'), freeMailOf('x@aldinejan.com')]).toEqual(['gmail.com', 'yahoo.co.uk', 'me.com', null])
  })
  it('the purchase order names a free-mail address: only that address passes', () => {
    expect(fromSender('aldine.ar@gmail.com', ' | Email: aldine.ar@gmail.com').decision).toBe('approve')
    expect(fromSender('aldine.billing@gmail.com', ' | Email: aldine.ar@gmail.com').decision).toBe('abstain')
  })
  it('a booked bill\'s sender puts the vendor\'s domain on file: the same domain passes, another ending is a look-alike', () => {
    const h: PriorInvoice[] = [{ invoice_number: 'AJ-90001', vendor: 'Aldine Janitorial', po_number: 'PO-40001', total: 500, sender: 'ar@aldinejan.com' }]
    const same = fromSender('ar@aldinejan.com', '', h)
    expect(same.decision).toBe('approve')
    expect(claim(same, 'ap.vendor')!.explanation).toBe("The invoice's sender, ar@aldinejan.com, writes from aldinejan.com, the domain booked invoice AJ-90001 came from for Aldine Janitorial (invoice line 8).")
    expect(same.not_checked[0]).toBe('vendor identity: the sender, ar@aldinejan.com, writes from the domain booked invoice AJ-90001 came from; that the email was not forged, and that the vendor record is genuine, were not checked')
    const net = fromSender('ar@aldinejan.net', '', h)
    expect(net.decision).toBe('abstain')
    expect(claim(net, 'ap.vendor')!.explanation).toContain('aldinejan.net is the domain booked invoice AJ-90001 came from, aldinejan.com, under another ending (.net, not .com)')
    // the PO's own field wins over the history
    expect(fromSender('ar@aldinejan.net', ' | Email: ar@aldinejan.net', h).decision).toBe('approve')
  })
  it('a domain on file with two neighbouring letters swapped is a look-alike, both domains named; engine 0.6.0 read the swap back', () => {
    const h: PriorInvoice[] = [{ invoice_number: 'AJ-90001', vendor: 'Aldine Janitorial', po_number: 'PO-40001', total: 500, sender: 'ar@aldinejan.com' }]
    const booked = fromSender('ar@aldinjean.com', '', h)
    expect(booked.decision).toBe('abstain')
    expect(claim(booked, 'ap.vendor')!.insufficiency!.detail).toContain('(a look-alike vendor: aldinjean.com is the domain booked invoice AJ-90001 came from, aldinejan.com, with two neighbouring letters swapped)')
    const po = fromSender('ar@aldinejan.ocm', ' | Email: ar@aldinejan.com')
    expect(po.decision).toBe('abstain')
    expect(claim(po, 'ap.vendor')!.insufficiency!.detail).toContain('aldinejan.ocm is the domain the purchase order names, aldinejan.com, with two neighbouring letters swapped')
    // the exact domain still passes, and a swap in the part before the @ is not the domain
    expect(fromSender('ar@aldinejan.com', ' | Email: ar@aldinejan.com').decision).toBe('approve')
    expect(fromSender('ra@aldinejan.com', ' | Email: ar@aldinejan.com').decision).toBe('approve')
    // engine 0.6.0 verdicts replay as they were issued: the swap was read back as a scanning slip
    const old = verifyInvoiceMatch(docs(clean.replace('From: ar@aldinejan.com', 'From: ar@aldinjean.com'), h), { now: NOW, engine: '0.6.0' })
    expect(old.decision).toBe('approve')
  })
  it('structured input cannot state a redirection line or a free-mail sender, so the text reading converts to none', () => {
    expect(structuredFromText(splitApLayout(raw('T5-zelle-to-gmail.txt'))!)).toEqual({ ok: false, reason: expect.stringMatching(/payment-redirection/) })
    expect(structuredFromText(splitApLayout(raw('T8-gmail-sender.txt'))!)).toEqual({ ok: false, reason: expect.stringMatching(/free-mail/) })
    expect(structuredFromText(splitApLayout(clean)!).ok).toBe(true)
  })
})

describe('tax to the cent against a stated rate', () => {
  it('F10: 38.69 of extra tax goes to a person, naming the difference; L9\'s two cents still approve; F9\'s 1.9% price creep is the price tolerance', () => {
    const f10 = verifyBillMatch(json('ap/F10-tax-overcharged-1.9pct.json'), { now: NOW })
    expect(f10.decision).toBe('abstain')
    expect(f10.reasons[0]).toBe('cannot decide ap.tax: tax 2,075.20 is billed, but 8.25% of the taxable lines, 24,685.00, is 2,036.51: over by 38.69, more than rounding allows (0.01 per taxable line, 0.03 on this bill); a person confirms the tax before the bill is paid')
    const l9 = verifyBillMatch(json('ap/L9-tax-rounded-per-line.json'), { now: NOW })
    expect(l9.decision).toBe('approve')
    expect(claim(l9, 'ap.tax')!.explanation).toBe('Tax 2,036.53 is billed: 8.25% of the taxable lines, 24,685.00, is 2,036.51 (over by 0.02, within rounding: 0.01 per taxable line, 0.03 on this bill).')
    expect(verifyBillMatch(json('ap/F9-price-creep-1.9pct-every-line.json'), { now: NOW }).decision).toBe('approve')
    expect(verifyBillMatch(json('ap/F9-price-creep-1.9pct-every-line.json'), { now: NOW, policy: { price_tolerance: 0 } }).decision).toBe('hold_price')
  })
})

describe('invoiced_quantity_to_date settles an equal-amount possible resubmission', () => {
  it('L3: 20 invoiced earlier + 20 on this bill = 40 of 40 received: approve, naming the quantities', () => {
    const r = verifyBillMatch(json('ap/L3-second-partial-with-history.json'), { now: NOW })
    expect(r.decision).toBe('approve')
    const d = claim(r, 'ap.duplicate')!
    expect(d.outcome).toBe('PASS')
    expect(d.computation?.operands?.resubmission_settled_by).toBe('invoiced_quantity_to_date')
    expect(r.reasons[0]).toBe('Same vendor, same PO (PO-7740) and same total (6256.85) as booked invoice SES-20417, under a different number, but not a resubmission by the purchase order\'s own figures: MC cable 12/2 250ft roll: 20 invoiced earlier on PO line 1 + 20 on this bill = 40 of 40 received (invoiced_quantity_to_date). This bill bills units received and not yet invoiced.')
  })
  it('no earlier bill recorded, no field, or past what was received: a person decides, as before', () => {
    const at = (q: number | undefined) => { const x = json('ap/L3-second-partial-with-history.json'); if (q === undefined) delete x.purchase_order.line_items[0].invoiced_quantity_to_date; else x.purchase_order.line_items[0].invoiced_quantity_to_date = q; return verifyBillMatch(x, { now: NOW }) }
    expect(at(0).decision).toBe('abstain')
    expect(at(undefined).decision).toBe('abstain')
    expect(at(30).decision).toBe('abstain')
    expect(claim(at(0), 'ap.duplicate')!.explanation).toMatch(/^possible resubmission/)
  })
})

describe('pay applications: an unapproved change order, and the G702\'s own retainage split', () => {
  const prev = JSON.parse(readFileSync(join(HERE, '..', 'docs', 'examples', 'payapp-g702-g703.previous.json'), 'utf8'))
  const pay = (doc: unknown) => verify(doc as never, { ruleset: 'pay-app', references: { history: [prev] }, now: NOW })
  it('P5: a change-order line marked "(pending owner approval)" is PASS-WITH-OPEN, naming it, the owner clearing it', () => {
    const doc = json('payapp/P5-unapproved-co-billed.json')
    const v = pay(doc)
    expect(v.gate_status).toBe('PASS_WITH_OPEN')
    const c = v.claims.find((x) => x.claim_id === 'line[7].G703_PREV')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.explanation).toBe('Line 8 is marked unapproved ("pending owner approval" in its description, "Change order 02: added VAV boxes (pending owner approval)") and bills 11,000 to date: a change the owner has not approved is not payable on this application. The owner approves the change order, or the line waits until it is approved, before this application is paid')
    expect(formatPayAppReport(v, { extraction: doc, payer_role: 'owner' })).toContain('who may clear it: the owner (owner), for this application only')
    const st = json('payapp/P5-unapproved-co-billed.json'); st.schedule_of_values[7].description = 'Change order 02: added VAV boxes'; st.schedule_of_values[7].status = 'Pending'
    expect(pay(st).gate_status).toBe('PASS_WITH_OPEN')
    const ok = json('payapp/P5-unapproved-co-billed.json'); ok.schedule_of_values[7].description = 'Change order 02: added VAV boxes (approved)'
    expect(pay(ok).gate_status).toBe('PASS')
  })
  it('P10: 10% on completed work and 0% on stored material, stated as the split, passes, naming both parts', () => {
    const v = pay(json('payapp/P10-legit-10pct-work-0pct-stored-object.json'))
    expect([v.gate_status, v.coverage.claims_pass]).toEqual(['PASS', 44])
    const c = v.claims.find((x) => x.rule_id === 'G702_RATE')!
    expect(c.explanation).toBe("The total retainage is the application's own split, lines 5a and 5b: 10% of completed work, 261,475 (line 4 less stored materials), is 26,147.50, and 0% of stored materials, 13,350, is 0.")
    expect(c.computation?.formula).toBe('line 5 = 5a: rate × completed work (line 4 less Σ column F) + 5b: rate × stored materials (Σ column F)')
  })
  it('P10b: one 10% rate stated, stored material retained at 0%: a person, and what would settle it names the split', () => {
    const doc = json('payapp/P10b-legit-10pct-work-0pct-stored-rate-kept.json')
    const v = pay(doc)
    expect(v.gate_status).toBe('PASS_WITH_OPEN')
    expect(formatPayAppReport(v, { extraction: doc })).toContain('retainage_rate as { "completed_work": "10%", "stored_materials": "0%" }, lines 5a and 5b')
  })
  it('the split over or under what was retained: more retained FAILs, less goes to a person', () => {
    const more = json('payapp/P10-legit-10pct-work-0pct-stored-object.json'); more.retainage_rate = { completed_work: '5%', stored_materials: '0%' }
    const m = pay(more)
    expect(m.outcome).toBe('FAIL')
    expect(m.claims.find((x) => x.rule_id === 'G702_RATE')!.explanation).toBe("the application's own split, lines 5a and 5b, gives 13,073.75, but the total retainage says 26,147.50: more retained than the split allows")
    const less = json('payapp/P10-legit-10pct-work-0pct-stored-object.json'); less.retainage_rate = { completed_work: '10%', stored_materials: '10%' }
    expect(pay(less).gate_status).toBe('PASS_WITH_OPEN')
  })
  it('a rate given as any other object, an array, or a split whose part does not read is refused by name (exit 3)', () => {
    for (const [rate, words] of [
      [{ work: '10%', stored: '0%' }, 'retainage_rate is an object ({"work":"10%","stored":"0%"}), where a rate is expected'],
      [[0.1, 0], 'retainage_rate is an array ([0.1,0]), where a rate is expected'],
      [{ completed_work: '10%', stored_materials: 'none' }, 'retainage_rate.stored_materials is "none", which does not read as a rate'],
    ] as const) {
      const doc = json('payapp/P10-legit-10pct-work-0pct-stored-object.json'); doc.retainage_rate = rate
      expect(() => pay(doc)).toThrow(InputRefused)
      expect(() => pay(doc)).toThrow(words)
    }
    const doc = json('payapp/P10-legit-10pct-work-0pct-stored-object.json'); doc.schedule_of_values[0].retainage_rate = { completed_work: '10%' }
    expect(() => pay(doc)).toThrow(/schedule_of_values\[0\]\.retainage_rate is an object/)
  })
  it('the command line exits 3 on a rate object of another shape, naming it; the split itself exits 0; an earlier engine reads as before', () => {
    const doc = json('payapp/P10-legit-10pct-work-0pct-stored-object.json'); doc.retainage_rate = { work: '10%' }
    expect(() => verify(doc, { ruleset: 'pay-app', references: { history: [prev] }, now: NOW, engine: '0.5.0' })).not.toThrow()
    const dir = scratch('redirection-')
    const bad = join(dir, 'bad-rate.json')
    writeFileSync(bad, JSON.stringify(doc))
    const history = join(HERE, '..', 'docs', 'examples', 'payapp-g702-g703.previous.json')
    const cli = (file: string) => { let err = ''; const code = run([file, '--ruleset', 'pay-app', '--history', history], { out: () => {}, err: (s: string) => { err += s } }); return { code, err } }
    const refused = cli(bad)
    expect(refused.code).toBe(3)
    expect(refused.err).toContain('verify: input refused: verify: retainage_rate is an object ({"work":"10%"}), where a rate is expected')
    expect(cli(join(F, 'payapp', 'P10-legit-10pct-work-0pct-stored-object.json')).code).toBe(0)
  })
})
