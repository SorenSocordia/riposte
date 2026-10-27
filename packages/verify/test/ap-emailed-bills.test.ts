/**
 * Emailed bills from a cold review (2026-10-12; test/fixtures/ap-emailed-bills/README.md), the text path's answers to them:
 *
 *   -   the sender is the address inside the angle brackets, never a display name shaped like an address; a display name that
 *       is another address than the sender's goes to a person, naming both, and every vendor sentence an approve prints is true
 *       of the bill;
 *   -   a signature line is not vendor evidence: with no domain on file, a sender whose domain is not built from the vendor's
 *       name goes to a person; a hyphen the vendor's name does not carry is a look-alike;
 *   -   payment-instruction sentences are read as sentences (a verb of sending, paying, remitting, mailing, wiring, directing or
 *       updating with an account, an institution, an address, a lockbox, a link or an assignee as its object; a change or an
 *       attachment about where money goes), the listed phrasings kept as a fast path;
 *   -   a partial bill is ordinary when each billed line matches a PO line; a billed line that matches none is named; a tax line
 *       is read and checked against the rate the PO states; a line match needs the PO line's item word on the bill line;
 *   -   a number one suffix away from a booked one says "a bill with a similar number is booked", never "already in the books";
 *   -   every approve names its path, and an emailed-bill result replays from its text and history files.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitApLayout, verifyInvoiceMatch, type ApDocuments, type ApResult, type PriorInvoice } from '../src/ap/index'
import { formatApReport } from '../src/ap/report'
import { readRemittance } from '../src/ap/remittance'
import { headNoun, lineNamesItem } from '../src/ap/parse'
import { run } from '../src/cli'
import { cleanScratch, scratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'ap-emailed-bills')
const NOW = (): Date => new Date('2026-10-12T00:00:00Z')
const txt = (name: string): string => readFileSync(join(F, name), 'utf8')
const hist = (name: string): PriorInvoice[] => JSON.parse(readFileSync(join(F, name), 'utf8')) as PriorInvoice[]
const docsOf = (text: string, history: PriorInvoice[] = []): ApDocuments => ({ ...splitApLayout(text)!, history })
const bill = (name: string, history = 'hist-empty.json'): ApResult => verifyInvoiceMatch(docsOf(txt(name), hist(history)), { now: NOW })
const fromText = (text: string, history: PriorInvoice[] = []): ApResult => verifyInvoiceMatch(docsOf(text, history), { now: NOW })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const clean = txt('t01-clean.txt')
/** the clean bill with its remit-to and questions lines replaced by `line` */
const withLine = (line: string): ApResult => fromText(clean.replace('Remit to: PO Box 4471, Houston TX 77210. Phone 713-555-0142.\nPayment questions? Email ar@gulfcoastsupply.com.\n', `${line}\n`))
const everything = (r: ApResult): string[] => [...r.reasons, ...r.not_checked, ...r.verdict.claims.map((c) => c.explanation)]

/** The bill's own sender addresses, read independently of the engine: the address in angle brackets (or [mailto:]) on each From line, else the bare address. */
function realSenders(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (!/^\s*From:/i.test(line)) continue
    const br = /<([^<>\s]+@[^<>\s]+)>|\[mailto:([^\]\s]+)\]/i.exec(line)
    if (br) { out.push((br[1] ?? br[2])!.toLowerCase()); continue }
    for (const m of line.replace(/"[^"]*"/g, ' ').matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) out.push(m[0].toLowerCase())
  }
  return out
}

describe('the sender is the address in angle brackets, never the display name', () => {
  it('a display name shaped like the vendor\'s address over another sender goes to a person, naming both (f08)', () => {
    for (const name of ['f08-displayspoof.txt', 'f08-displayspoof-onfile.txt']) {
      const r = bill(name)
      expect([r.decision, r.payable], name).toEqual(['abstain', false])
      const v = claim(r, 'ap.vendor')!
      expect(v.outcome, name).toBe('INSUFFICIENT_DATA')
      expect(v.explanation, name).toContain('the From line shows billing@gulfcoastsupply.com but the message was sent from ar.dept@outlook-mailer.net')
      expect(r.reasons[0], name).toMatch(/^cannot decide ap\.vendor: /)
      for (const s of everything(r)) expect(s, name).not.toMatch(/matched by the sender's address, billing@gulfcoastsupply\.com|the sender, billing@gulfcoastsupply\.com, writes from/)
      expect(formatApReport(r, { documents: splitApLayout(txt(name))! }), name).toContain('found a From line whose display name is another address than the sender\'s')
    }
  })
  it('a display name that is a name, or the same address, is read as before, and the approve names the real address', () => {
    for (const from of ['From: "Gulf Coast Billing" <billing@gulfcoastsupply.com>', 'From: billing@gulfcoastsupply.com <billing@gulfcoastsupply.com>', 'From: Gulf Coast Billing [mailto:billing@gulfcoastsupply.com]']) {
      const r = fromText(clean.replace('From: billing@gulfcoastsupply.com', from))
      expect(r.decision, from).toBe('approve')
      expect(r.not_checked[0], from).toMatch(/^vendor identity: matched by the sender's address, billing@gulfcoastsupply\.com \(invoice line 8\)/)
    }
  })
  it('every vendor sentence an approve prints names only addresses the bill was sent from', () => {
    const names = ['t01-clean.txt', 'f01-factoring.txt', 'f02-attached.txt', 'f03-callus.txt', 'f04-newaddr.txt', 'f05-lockbox.txt', 'f05-lockbox-onfile.txt', 'f06-portal.txt', 'f07-otherdomain.txt',
      'f07-otherdomain-onfile.txt', 'f08-displayspoof.txt', 'f08-displayspoof-onfile.txt', 'f09-plural.txt', 'f10-hyphen.txt', 'f11-wrongitem.txt', 'f12-labor.txt', 'l01-achfooter.txt',
      'l02-extraline.txt', 'l03-secondpartial.txt', 'l04-reordered.txt', 'l05-salestax.txt', 'l06-tax.txt']
    let approves = 0
    for (const name of names) {
      const r = bill(name)
      if (r.decision !== 'approve') continue
      approves++
      const senders = realSenders(txt(name))
      const vendorWords = [claim(r, 'ap.vendor')!.explanation, ...r.not_checked.filter((s) => s.startsWith('vendor identity:'))]
      for (const s of vendorWords) for (const m of s.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) expect(senders, `${name}: ${s}`).toContain(m[0].toLowerCase())
    }
    expect(approves).toBeGreaterThan(0)
  })
})

describe('a signature line is not vendor evidence; a hyphen the name lacks is a look-alike', () => {
  it('f07: a sender whose domain is not built from the vendor\'s name, no domain on file, signed with the vendor\'s name: a person', () => {
    const r = bill('f07-otherdomain.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const v = claim(r, 'ap.vendor')!
    expect(v.explanation).toContain('the bill\'s sender, accounts@gcs-remit.net, writes from gcs-remit.net, which is not built from the purchase order\'s vendor name, Gulf Coast Supply')
    expect(v.explanation).toContain('no domain for Gulf Coast Supply is on file')
    expect(v.explanation).toContain('a line of the bill or its signature naming the vendor is written by whoever sends it')
    expect(formatApReport(r)).toContain('found a sender writing from a domain not built from the vendor\'s name')
    // with the vendor's email on the purchase order it was already a person's decision
    expect(bill('f07-otherdomain-onfile.txt').decision).toBe('abstain')
  })
  it('with no sender at all, a signature naming the vendor does not count; a body line naming it still does', () => {
    const noSender = clean.replace('From: ap@keystonemech.example\n', '').replace('From: billing@gulfcoastsupply.com\n', '')
    const sig = fromText(noSender)
    expect(sig.decision).toBe('abstain')
    expect(claim(sig, 'ap.vendor')!.explanation).toContain('the signature')
    const body = fromText(noSender.replace('Hello,', 'Hello from Gulf Coast Supply,'))
    expect(body.decision).toBe('approve')
    expect(claim(body, 'ap.vendor')!.explanation).toBe("The invoice names the purchase order's vendor, Gulf Coast Supply (invoice line 9).")
  })
  it('f10: gulfcoast-supply.com is a look-alike naming the hyphen, as gulfcoastsupplies.com is (f09)', () => {
    const r = bill('f10-hyphen.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const v = claim(r, 'ap.vendor')!
    expect(v.computation?.operands?.vendor_match).toBe('near')
    expect(v.explanation).toContain('gulfcoast-supply.com writes a name built from Gulf Coast Supply\'s with a hyphen the vendor\'s name does not carry ("gulfcoast-supply")')
    expect(bill('f09-plural.txt').decision).toBe('abstain')
    // a hyphen the vendor's own name carries is still the vendor's
    const pw = fromText(clean.replace('From: billing@gulfcoastsupply.com', 'From: billing@pryce-webb.com').replaceAll('Gulf Coast Supply', 'Pryce-Webb Supply'))
    expect(pw.decision).toBe('approve')
    // a domain on file settles a hyphenated domain
    expect(fromText(clean.replace('From: billing@gulfcoastsupply.com', 'From: billing@gulfcoast-supply.com').replace('| Freight: not allowed', '| Email: billing@gulfcoast-supply.com | Freight: not allowed')).decision).toBe('approve')
  })
  it('the domain on file with two neighbouring letters swapped is a look-alike, as the hyphen is, naming both domains', () => {
    // f07-otherdomain-onfile.txt, sent from gulfcoastsuplpy.com against the purchase order's billing@gulfcoastsupply.com
    const swapped = txt('f07-otherdomain-onfile.txt').replace('From: accounts@gcs-remit.net', 'From: accounts@gulfcoastsuplpy.com')
    const r = fromText(swapped)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const v = claim(r, 'ap.vendor')!
    expect(v.computation?.operands?.vendor_match).toBe('near')
    expect(v.explanation).toContain('(a look-alike vendor: gulfcoastsuplpy.com is the domain the purchase order names, gulfcoastsupply.com, with two neighbouring letters swapped)')
    // the domain on file as written still passes
    expect(fromText(swapped.replace('accounts@gulfcoastsuplpy.com', 'accounts@gulfcoastsupply.com')).decision).toBe('approve')
    // engine 0.6.0 read the swap back as a scanning slip, and its verdicts replay as issued
    expect(verifyInvoiceMatch(docsOf(swapped), { now: NOW, engine: '0.6.0' }).decision).toBe('approve')
  })
})

describe('payment-instruction sentences are read as sentences', () => {
  it('f01, f02, f04, f05 (and f05 with the vendor\'s email on the PO): a person, for the controller, as a change of where payment goes', () => {
    for (const name of ['f01-factoring.txt', 'f02-attached.txt', 'f04-newaddr.txt', 'f05-lockbox.txt', 'f05-lockbox-onfile.txt']) {
      const r = bill(name)
      expect([r.decision, r.payable], name).toEqual(['abstain', false])
      expect(r.reasons[0], name).toMatch(/^cannot decide ap\.remittance: the bill asks to change where payment goes \(invoice line 20: /)
      expect(claim(r, 'ap.remittance')!.computation?.operands?.found, name).toBe('a request to change payment details')
      expect(formatApReport(r), name).toContain('A PERSON DECIDES. Open first: the payment-details check (ap.remittance) found a request to change where payment goes')
    }
  })
  it('l01 (ACH details printed, "Remittance details unchanged"): still a person, and the reason says the details were printed, not changed', () => {
    const r = bill('l01-achfooter.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    const c = claim(r, 'ap.remittance')!
    expect(c.computation?.operands?.found).toBe('bank-account details')
    expect(c.explanation).toMatch(/^the bill prints bank-account details \(invoice line 20: "ACH: Frost Bank, routing 114000093, account ending 4471\. Remittance details unchanged\."\); no sentence of it was read as asking to change them/)
  })
  it('sentences no listed phrasing matches, about where money goes: each a person', () => {
    for (const line of [
      'Please direct this payment to the updated instructions attached and disregard the ones on file.',
      'Going forward, send all checks to 77 Elm St, Dallas TX 75201.',
      'Your payment should now be made to Bayside Capital Funding, PO Box 1234, Dallas TX 75201.',
      'Our remit-to address has moved to PO Box 99812, Dallas TX 75399.',
      'Please mail your check to our account at Frost Bank.',
      'This invoice has been sold to Lone Star Receivables LLC; remit to them.',
    ]) {
      expect(withLine(line).decision, line).toBe('abstain')
      expect(claim(withLine(line), 'ap.remittance'), line).toBeDefined()
    }
  })
  it('a standing remit-to address, a payee that is the vendor, terms and questions are not: the clean bill approves', () => {
    for (const line of [
      'Remit to: PO Box 4471, Houston TX 77210. Phone 713-555-0142.',
      'Please remit payment to Gulf Coast Supply, PO Box 4471, Houston TX 77210.',
      'Make checks payable to Gulf Coast Supply.',
      'Payment is due within 30 days of the invoice date.',
      'Please reference the invoice number on your payment.',
      'Payment questions? Email ar@gulfcoastsupply.com or call 713-555-0100.',
      'Thank you for your prompt payment.',
    ]) {
      expect(readRemittance(line, { sentences: true, vendor: 'Gulf Coast Supply' }), line).toEqual([])
      expect(withLine(line).decision, line).toBe('approve')
    }
  })
  it('the approve\'s "Not checked" line names what was read: every sentence, the listed phrasings, and the standing remit-to line', () => {
    const r = bill('t01-clean.txt')
    expect(r.decision).toBe('approve')
    const line = r.not_checked.find((s) => s.startsWith('payment redirection:'))!
    expect(line).toContain('every sentence of the bill was read for an instruction about where payment goes')
    expect(line).toContain('the 25 phrasings listed in docs/AP-INPUT.md')
    expect(line).toContain('invoice line 20 was read as the vendor\'s standing remit-to postal address')
    expect(line).toContain('the vendor\'s bank details are not part of the inputs')
  })
})

describe('partial bills, an extra line, and the item a line bills', () => {
  it('l03: one of two PO lines billed, the other booked earlier: approve, saying it is partial', () => {
    for (const h of ['hist-partial.json', 'hist-empty.json']) {
      const r = bill('l03-secondpartial.txt', h)
      expect([r.decision, r.payable], h).toEqual(['approve', true])
      expect(r.reasons, h).toContain('partial: 1 of 2 purchase-order lines billed; 1 line open')
      expect(r.not_checked, h).toContain('PO line 1 (3/4 in EMT conduit, 10 ft) is not billed on this bill: nothing to check against it')
      expect(everything(r).join('\n'), h).not.toMatch(/invoice line\(s\) but the PO has/)
    }
    // the same bill against a history where the whole order is booked: more billed than the order, a person
    const rebill = bill('d05-rebill.txt', 'hist-paid.json')
    expect(rebill.decision).toBe('abstain')
    expect(rebill.reasons[0]).toMatch(/^cannot decide ap\.po_balance: billed to date on PO-7731 would be 10,164\.80/)
  })
  it('l02: a fuel-surcharge line the PO does not carry is named, never the quantity check on line 1', () => {
    const r = bill('l02-extraline.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.bill_line\[3\]\.quantity: invoice line 17, "FUEL SURCHARGE", matches no purchase-order line/)
    expect(claim(r, 'ap.line[1].quantity')!.outcome).toBe('PASS')
    const out = formatApReport(r, { documents: splitApLayout(txt('l02-extraline.txt'))! })
    expect(out).not.toMatch(/the quantity check on line 1/)
    expect(out).toContain('found a bill line that matches no purchase-order line')
  })
  it('f11: a set-screw connector billed against the conduit line goes to a person naming both descriptions', () => {
    const r = bill('f11-wrongitem.txt')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toContain('"3/4 EMT SET SCREW CONNECTOR"')
    expect(r.reasons[0]).toContain('"3/4 in EMT conduit, 10 ft"')
    expect(r.reasons[0]).toContain('the item word "conduit" is not on it')
  })
  it('f12 (a labor line) goes to a person naming the line; l04 (lines reordered) approves', () => {
    const f12 = bill('f12-labor.txt')
    expect(f12.decision).toBe('abstain')
    expect(f12.reasons[0]).toContain('LABOR HRS FOREMAN OT')
    expect(bill('l04-reordered.txt').decision).toBe('approve')
  })
  it('the item word: the PO line\'s head noun, read through abbreviations', () => {
    expect(['3/4 in EMT conduit, 10 ft', 'Machine grease cartridge 14 oz', 'Hand truck, 600 lb capacity', 'Bubble wrap roll 300 mm', '200A panelboard', 'Wire shelving unit 48 in'].map(headNoun))
      .toEqual(['conduit', 'cartridge', 'truck', 'roll', 'panelboard', 'shelving'])
    expect(lineNamesItem('GREASE CART 14OZ', 'Machine grease cartridge 14 oz')).toBe(true)
    expect(lineNamesItem('BUBBLE WRAP 300MM RL', 'Bubble wrap roll 300 mm')).toBe(true)
    expect(lineNamesItem('PNLBRD 200A', '200A panelboard')).toBe(true)
    // a compound, and another word of the description that says what the item is, count; sizes and family codes never do
    expect(lineNamesItem('HANDTRUCK 600LB', 'Hand truck, 600 lb capacity')).toBe(true)
    expect(lineNamesItem('2 inch by 27 foot ratchet tie-down', 'Ratchet strap 2 in x 27 ft')).toBe(true)
    expect(lineNamesItem('3/4 EMT SET SCREW CONNECTOR', '3/4 in EMT conduit, 10 ft')).toBe(false)
  })
})

describe('the 100 public Distil cases read as engine 0.6.0 read them', () => {
  it('decision, reasons and every claim outcome, with no history and with an empty one', () => {
    const before = JSON.parse(readFileSync(join(HERE, 'fixtures', 'ap-distil-0.6.0', 'readings.json'), 'utf8')) as { cases: { id: string; none: unknown; empty: unknown }[] }
    const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')
    const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string })
    expect(cases.length).toBe(100)
    cases.forEach((c, k) => {
      const docs = splitApLayout(c.input)!
      for (const [key, h] of [['none', undefined], ['empty', []]] as const) {
        const r = verifyInvoiceMatch(h ? { ...docs, history: h } : docs, { now: NOW })
        expect({ decision: r.decision, reasons_sha256: sha(r.reasons), claims: r.verdict.claims.map((x) => `${x.claim_id} ${x.outcome}`) }, `${c.id} ${key}`).toEqual(before.cases[k]![key])
      }
    })
  })
})

describe('tax lines on the text path', () => {
  it('l05, l06: the tax line is read; the PO states no rate, so a person', () => {
    for (const name of ['l05-salestax.txt', 'l06-tax.txt']) {
      const r = bill(name)
      expect([r.decision, r.payable], name).toEqual(['abstain', false])
      expect(r.reasons[0], name).toMatch(/^cannot decide ap\.tax: tax line present, PO states no rate: tax 432\.70 is billed \(invoice line 18/)
      expect(claim(r, 'ap.total')!.outcome, name).toBe('PASS')
      expect(everything(r).join('\n'), name).not.toMatch(/is not a line item, the total, freight, or a known stray/)
    }
  })
  it('a PO that states its rate: checked to the cent, as the structured path checks it', () => {
    const taxed = txt('l05-salestax.txt').replace('| Freight: not allowed', '| Tax: 8.25% | Freight: not allowed')
    const ok = fromText(taxed)
    expect(ok.decision).toBe('approve')
    expect(claim(ok, 'ap.tax')!.explanation).toBe('Tax 432.70 is billed: 8.25% of the taxable lines, 5,244.80, is 432.70.')
    const over = fromText(taxed.replace('Sales tax 8.25%: USD 432.70', 'Sales tax 8.25%: USD 440.00').replace('Total due: USD 5,677.50', 'Total due: USD 5,684.80'))
    expect(over.decision).toBe('abstain')
    expect(over.reasons[0]).toContain('over by 7.30')
    expect(fromText(txt('l06-tax.txt').replace('| Freight: not allowed', '| Tax: 0% | Freight: not allowed')).decision).toBe('hold_total')
  })
})

describe('near-number duplicates', () => {
  it('d02: a suffixed number is the possible-resubmission row, naming the booked bill as a similar number', () => {
    const r = bill('d02-suffix.txt', 'hist-paid.json')
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.duplicate: possible resubmission: a bill with a similar number is booked: GCS-20417 \(paid 2026-09-20\), same vendor, same PO \(PO-7731\) and same total/)
    expect(r.reasons[0]).toContain('GCS-20417A')
    for (const s of everything(r)) expect(s).not.toMatch(/already in the books/)
  })
  it('d03: an unclear number names the near match it almost made', () => {
    const r = bill('d03-subjtypo.txt', 'hist-paid.json')
    expect(r.decision).toBe('abstain')
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.duplicate: invoice number unclear: the bill reads GCS-20471 \(invoice line 3\) and GCS-20417 \(invoice lines 9, 13\), so the duplicate check cannot run; GCS-20417 is booked \(paid 2026-09-20\)/)
  })
  it('d01: the booked number itself is held, in the words it had', () => {
    const r = bill('d01-exact.txt', 'hist-paid.json')
    expect(r.decision).toBe('hold_duplicate')
    expect(r.reasons[0]).toBe('Invoice GCS-20417 is already in the books (paid 2026-09-20). Paying it again would be a duplicate payment.')
  })
})

describe('wording, the path an approve came through, and the replay of an emailed bill', () => {
  it('the history line reads "payment history: 0 entries"', () => {
    const out = formatApReport(bill('t01-clean.txt'), { documents: splitApLayout(clean)! })
    expect(out).toContain('payment history: 0 entries')
    expect(out).not.toContain('payment history history')
  })
  it('an emailed-text approve carries the fixed sentence under "Not checked"; the headline keeps its shape and the next line names the path', () => {
    const r = bill('t01-clean.txt')
    expect(r.not_checked[r.not_checked.length - 1]).toBe('This bill was read from text; the structured path is the product and this path is a convenience with the limits listed.')
    let err = ''
    const code = run(['ap', join(F, 't01-clean.txt'), '--history', join(F, 'hist-empty.json')], { out: () => {}, err: (s: string) => { err += s } })
    expect(code).toBe(0)
    // the headline is the one scripts parse, byte for byte as before; the path is its own labelled line
    expect(err.split('\n').slice(0, 2)).toEqual(['verify ap: APPROVE · verdict PASS: 11 of 11 checks ran and held', 'read from: emailed text'])
    let err2 = ''
    run(['ap', '--input', join(HERE, 'fixtures', 'ap-cold-review', 'L1-clean-exact.json')], { out: () => {}, err: (s: string) => { err2 += s } })
    expect(err2.split('\n')[0]).toMatch(/^verify ap: [A-Z ]+(?:\([a-z_]+\))?(?:, exit 0 by --allow-open)? · verdict /)
    expect(err2.split('\n')).toContain('read from: structured input')
  })
  it('the result carries the sha256 of the text and the history; replay re-performs it from those two files, and names a missing one', () => {
    const dir = scratch('emailed-replay-')
    let out = ''
    expect(run(['ap', join(F, 't01-clean.txt'), '--history', join(F, 'hist-empty.json')], { out: (s: string) => { out += s }, err: () => {} })).toBe(0)
    const result = JSON.parse(out) as { read: { text_sha256: string; history_sha256: string } }
    expect(result.read.text_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.read.history_sha256).toMatch(/^[0-9a-f]{64}$/)
    const file = join(dir, 't01.json')
    writeFileSync(file, out)
    const replay = (...args: string[]) => { let e = '', o = ''; const code = run(['replay', file, ...args], { out: (s: string) => { o += s }, err: (s: string) => { e += s } }); return { code, e, o } }
    const ok = replay('--source', join(F, 't01-clean.txt'), '--history', join(F, 'hist-empty.json'))
    expect(ok.code, ok.e).toBe(0)
    expect(ok.e).toMatch(/outcome VERIFIED/)
    const none = replay()
    expect(none.code).toBe(3)
    expect(none.e).toContain('--source')
    expect(none.e).toContain('--history')
    const half = replay('--source', join(F, 't01-clean.txt'))
    expect(half.code).toBe(3)
    expect(half.e).toContain('--history')
    const other = replay('--source', join(F, 'f08-displayspoof.txt'), '--history', join(F, 'hist-empty.json'))
    expect(other.code).toBe(1)
    expect(other.e).toContain('is not the text this result was read from')
  })
  it('a result given on stdin (replay -) is read once: an emailed bill with its files, and a structured bill alone, both re-perform', () => {
    const DIST_CLI = join(HERE, '..', 'dist', 'cli.js')
    const env = { ...process.env }
    delete env.VITEST
    const ap = (...a: string[]) => spawnSync(process.execPath, [DIST_CLI, 'ap', ...a], { encoding: 'utf8', env, windowsHide: true }).stdout
    const replay = (input: string, ...a: string[]) => spawnSync(process.execPath, [DIST_CLI, 'replay', '-', ...a], { input, encoding: 'utf8', env, windowsHide: true })
    const emailed = replay(ap(join(F, 't01-clean.txt'), '--history', join(F, 'hist-empty.json')), '--source', join(F, 't01-clean.txt'), '--history', join(F, 'hist-empty.json'))
    expect(emailed.status, emailed.stderr).toBe(0)
    const structured = replay(ap('--input', join(HERE, 'fixtures', 'ap-cold-review', 'L1-clean-exact.json')))
    expect(structured.status, structured.stderr).toBe(0)
  })
})

describe('engine 0.6.0 reads an emailed bill as it did, so its verdicts replay byte for byte', () => {
  const old = (name: string, history = 'hist-empty.json'): ApResult => verifyInvoiceMatch(docsOf(txt(name), hist(history)), { now: NOW, engine: '0.6.0' })
  it('the display name read as a sender (f08), a hyphen at a space (f10) and a signature line (f07) approved', () => {
    for (const name of ['f08-displayspoof.txt', 'f10-hyphen.txt', 'f07-otherdomain.txt']) expect(old(name).decision, name).toBe('approve')
    expect(old('f08-displayspoof.txt').not_checked[0]).toMatch(/^vendor identity: matched by the sender's address, billing@gulfcoastsupply\.com \(invoice line 8\)/)
  })
  it('only the 25 phrasings were scanned (f01, f05 approved); a partial bill, a tax line and a suffixed number could not be decided', () => {
    for (const name of ['f01-factoring.txt', 'f05-lockbox.txt']) expect(old(name).decision, name).toBe('approve')
    expect(old('l03-secondpartial.txt', 'hist-partial.json').reasons[0]).toBe('cannot decide ap.line[1].quantity: read 1 invoice line(s) but the PO has 2')
    expect(old('l05-salestax.txt').reasons[0]).toMatch(/^cannot decide ap\.total: an amount on the invoice/)
    expect(old('d02-suffix.txt', 'hist-paid.json').reasons[0]).toBe('cannot decide ap.duplicate: invoice number unclear, so the duplicate check cannot run')
  })
  it('an approve carried three scope lines, the path sentence not among them', () => {
    const r = old('t01-clean.txt')
    expect(r.decision).toBe('approve')
    expect(r.not_checked.map((s) => s.split(':')[0])).toEqual(['vendor identity', 'payment redirection', 'tax'])
  })
  it('a 0.7.0 verdict and a 0.6.0 verdict of one bill differ in engine and id, and each replays under its own engine', () => {
    const now = verifyInvoiceMatch(docsOf(txt('t01-clean.txt'), hist('hist-empty.json')), { now: NOW, engine: '0.7.0' }), then = old('t01-clean.txt')
    expect([now.verdict.engine_version, then.verdict.engine_version]).toEqual(['0.7.0', '0.6.0'])
    expect(now.verdict.verdict_id).not.toBe(then.verdict.verdict_id)
  })
})
