/**
 * Engine 0.6.0, 2026-10-05: the vendor check, the tax check, the per-line netting note, stated
 * totals on the text path and freight as a policy (`ap --freight allow|person`). Fixtures: an outside reviewer's own cases,
 * kept as written (test/fixtures/ap-outside-review/README.md).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, verifyBillMatch, splitApLayout, validateApInput, apInputDocuments, type ApStructuredInput, type ApDocuments, type ApResult } from '../src/index'
import { parseInvoice } from '../src/ap/parse'
import { formatApReport } from '../src/ap/report'
import { compareVendors, readInvoiceVendor } from '../src/ap/vendor'
import { run as cli } from '../src/cli'
import { verifyReplay } from '../src/index'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'ap-outside-review')
const NOW = () => new Date('2026-10-05T00:00:00Z')
const bill = (name: string): ApStructuredInput => JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8'))
const text = (name: string, history: ApDocuments['history'] = []): ApDocuments => ({ ...splitApLayout(readFileSync(join(FX, `${name}.txt`), 'utf8'))!, history })
const s = (x: ApStructuredInput, o: Parameters<typeof verifyBillMatch>[1] = {}): ApResult => verifyBillMatch(x, { now: NOW, ...o })
const t = (d: ApDocuments, o: Parameters<typeof verifyInvoiceMatch>[1] = {}): ApResult => verifyInvoiceMatch(d, { now: NOW, ...o })
const claim = (r: ApResult, id: string) => r.verdict.claims.find((c) => c.claim_id === id)
const report = (r: ApResult, documents: Parameters<typeof formatApReport>[1]['documents']): string => formatApReport(r, { documents })

describe('the bill\'s vendor against the purchase order\'s vendor (structured)', () => {
  it('the reviewer\'s 06: a bill from Apex against Summit\'s PO goes to a person, naming both vendors', () => {
    const r = s(bill('06-wrong-vendor'))
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toBe('cannot decide ap.vendor: the bill is from Apex Industrial Holdings; the order was placed with Summit Electrical Supply (another vendor name): a person confirms who sent this bill, and that it is payable on this order, before it is paid')
    const c = claim(r, 'ap.vendor')!
    expect([c.outcome, c.insufficiency?.reason, c.rule_id]).toEqual(['INSUFFICIENT_DATA', 'AMBIGUOUS_REFERENCE', 'AP_VENDOR_MATCH'])
    expect((r.verdict.remedies ?? []).find((m) => m.claims.includes('ap.vendor') && m.kind === 'authority')?.authority).toBe('ap-controller')
  })

  it('the console names the open check and prints both vendors first in "Lines read"', () => {
    const x = bill('06-wrong-vendor')
    const out = report(s(x), apInputDocuments(x))
    expect(out.split('\n')[0]).toBe("A PERSON DECIDES. Open first: the vendor check (ap.vendor) found that the bill is from another vendor than the purchase order's. Do not pay this bill automatically.")
    expect(out).toContain('Lines read:\n  - invoice /bill/vendor/name = "Apex Industrial Holdings"\n  - purchase order /purchase_order/vendor/name = "Summit Electrical Supply"\n')
  })

  it('on an approve too, both vendors are the first lines read', () => {
    const x = bill('01-clean')
    const r = s(x)
    expect(r.decision).toBe('approve')
    expect(claim(r, 'ap.vendor')!.explanation).toBe("The bill is from the purchase order's vendor, Summit Electrical Supply.")
    expect(report(r, apInputDocuments(x))).toContain('Lines read:\n  - invoice /bill/vendor/name = "Summit Electrical Supply"\n  - purchase order /purchase_order/vendor/name = "Summit Electrical Supply"\n')
  })

  it('the duplicate check\'s ladder: tax id, then vendor id, then the normalized name, then the near-match rules', () => {
    const one = (b: object, p: object) => compareVendors({ name: null, id: null, tax_id: null, ...b }, { name: null, id: null, tax_id: null, ...p }).match
    expect(one({ name: 'Apex', tax_id: '84-1234567' }, { name: 'Summit', tax_id: '841234567' })).toBe('same') // one legal entity
    expect(one({ name: 'Summit Electrical Supply', tax_id: '84-1' }, { name: 'Summit Electrical Supply', tax_id: '84-2' })).toBe('conflict')
    expect(one({ name: 'Summit Electrical Supply', id: 'V-2' }, { name: 'Summit Electrical Supply', id: 'V-1' })).toBe('records')
    expect(one({ id: 'V-1' }, { id: 'V-1', name: 'Summit' })).toBe('same')
    expect(one({ name: 'Summit Electrical Supply, Inc.' }, { name: 'Summit Electrical Supply' })).toBe('variant')
    expect(one({ name: 'Sumit Electrical Supply' }, { name: 'Summit Electrical Supply' })).toBe('near')
    expect(one({ name: 'Apex Industrial Holdings' }, { name: 'Summit Electrical Supply' })).toBe('different')
    expect(one({ name: 'Summit' }, { id: 'V-1' })).toBe('unknown')
  })

  it('PASS only on one supplier: a variant name passes; a look-alike, two vendor records and a tax-id conflict go to a person', () => {
    const with_ = (b: object, p: object) => { const x = bill('01-clean'); x.bill.vendor = b; x.purchase_order.vendor = p; return s(x) }
    expect(with_({ name: 'Summit Electrical Supply, Inc.' }, { name: 'Summit Electrical Supply' }).decision).toBe('approve')
    expect(with_({ name: 'Sumit Electrical Supply' }, { name: 'Summit Electrical Supply' }).decision).toBe('abstain')
    expect(with_({ name: 'Summit Electrical Supply', id: 'V-2' }, { name: 'Summit Electrical Supply', id: 'V-1' }).reasons[0]).toContain('two vendor records under one name (the bill V-2; the order V-1)')
    expect(with_({ name: 'Summit Electrical Supply', tax_id: '84-1' }, { name: 'Summit Electrical Supply', tax_id: '84-2' }).reasons[0]).toContain('the names match but the tax ids differ')
  })

  it('a PO that names no vendor: the check does not run, says so in not_checked, and the bill is decided on the rest', () => {
    const x = bill('01-clean'); delete x.purchase_order.vendor
    const r = s(x)
    expect(claim(r, 'ap.vendor')).toBeUndefined()
    expect(r.decision).toBe('approve')
    expect(r.not_checked).toContain("vendor check: the purchase order names no vendor, so the bill's vendor was not compared with it")
    expect(report(r, apInputDocuments(x))).toContain('  - purchase order /purchase_order/vendor = none (the purchase order names no vendor)')
  })

  it('a bill that names no vendor against a PO that does: a person decides (FIELD_MISSING)', () => {
    const x = bill('01-clean'); x.bill.vendor = {}
    const c = claim(s(x), 'ap.vendor')!
    expect([c.outcome, c.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'FIELD_MISSING'])
  })

  it('a hold on another check still names the open vendor check, after the hold\'s own reason', () => {
    const x = bill('03-exact-dup'); x.bill.vendor = { name: 'Apex Industrial Holdings' }
    const r = s(x)
    expect(r.decision).toBe('hold_duplicate')
    expect(r.reasons.at(-1)).toMatch(/^also for a person: cannot decide ap\.vendor: the bill is from Apex Industrial Holdings/)
  })

  it('engines up to 0.5.0 have no vendor check: the reviewer\'s 06 approved there, and still does', () => {
    const r = s(bill('06-wrong-vendor'), { engine: '0.5.0' })
    expect(claim(r, 'ap.vendor')).toBeUndefined()
    expect(r.decision).toBe('approve')
  })
})

describe('the text path reads whether the invoice names the PO\'s vendor', () => {
  // 2026-10-06: an email header line is never vendor evidence (the words say so), and t3's "remit to our new bank
  // account" line is now a person's decision of its own (ap.remittance), named first; the vendor check is still open on it
  // 2026-10-13 (engine 0.7.0): with no domain on file, the sender's domain not built from the vendor's name is the finding
  const VENDOR_T3 = "cannot decide ap.vendor: the bill's sender, billing@apex-holdings.example, writes from apex-holdings.example, which is not built from the purchase order's vendor name, Summit Electrical Supply, and no domain for Summit Electrical Supply is on file (an \"Email:\" or \"Domain:\" field on the purchase order, or the sender of a booked bill, settles which domain is the vendor's); a line of the bill or its signature naming the vendor is written by whoever sends it, so it is not evidence of who sent the bill: a person confirms who sent this bill, and that it is payable on this order, before it is paid"
  it('the reviewer\'s t3b (no bank line) and t3 (a bank-account line): both go to a person for the vendor, not by luck', () => {
    for (const name of ['t3b-wrong-vendor-no-bank-line', 't3-wrong-vendor-sneaky-line']) {
      const r = t(text(name))
      expect(r.decision, name).toBe('abstain')
      if (name.startsWith('t3b')) expect(r.reasons[0], name).toBe(VENDOR_T3)
      else {
        expect(r.reasons[0], name).toMatch(/^cannot decide ap\.remittance: the bill asks to change where payment goes \(invoice line 14: "Please remit to our new bank account ending 9921\."\)/)
        expect(r.reasons, name).toContain(`also for a person: ${VENDOR_T3}`)
      }
      expect(claim(r, 'ap.total')!.outcome, name).toBe('PASS') // "account ending 9921" is not a stated total
    }
  })

  it('the PO\'s vendor named on a line, or a sender writing from a domain built from the name, passes', () => {
    expect(t(text('t5-legit-footer')).decision).toBe('approve')
    // 2026-10-06: the sender's address is read first (the stronger evidence); the footer naming the vendor would pass too
    expect(claim(t(text('t5-legit-footer')), 'ap.vendor')!.explanation).toBe("The invoice's sender, ar@summitelec.example, writes from a domain built from the purchase order's vendor name, Summit Electrical Supply (invoice line 2).")
    const t5 = text('t5-legit-footer')
    // 2026-10-13 (engine 0.7.0): a sender from another domain, signed with the vendor's name, is a person's (the signature does
    // not count); with no sender at all, the signature still does not, and a body line naming the vendor does
    expect(claim(t({ ...t5, invoice: t5.invoice.replace('ar@summitelec.example', 'ar@billing-service.example') }), 'ap.vendor')!.computation?.operands?.vendor_match).toBe('not-built')
    const noSender = t5.invoice.replace('From: ar@summitelec.example\n', '')
    expect(claim(t({ ...t5, invoice: noSender }), 'ap.vendor')!.outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(t({ ...t5, invoice: noSender.replace('Hi AP team,', 'Hi AP team, from Summit Electrical Supply.') }), 'ap.vendor')!.explanation).toBe("The invoice names the purchase order's vendor, Summit Electrical Supply (invoice line 4).")
    expect(claim(t(text('t2-table-layout')), 'ap.vendor')!.explanation).toBe("The invoice's sender, ar@summitelec.example, writes from a domain built from the purchase order's vendor name, Summit Electrical Supply (invoice line 2).")
  })

  it('one swapped pair of letters (a scanning slip) is read; a dropped or changed letter (a look-alike) is not', () => {
    expect(readInvoiceVendor('Kind regards,\nSummti Electrical Supply\n', 'Summit Electrical Supply').by).toBe('name')
    expect(readInvoiceVendor('Kind regards,\nSumit Electrical Supply\n', 'Summit Electrical Supply').by).toBe(null)
    expect(readInvoiceVendor('Frmo: ar@summitelec.example\n', 'Summit Electrical Supply').by).toBe('sender address')
    expect(readInvoiceVendor('From: arh@allamsupply.com\n', 'Hallam Warehouse Supply').by).toBe('sender address') // a swap across "@"
    expect(readInvoiceVendor('From: ar@sumitelec.example\n', 'Summit Electrical Supply').by).toBe(null)
    expect(readInvoiceVendor('From: billing@apex-holdings.example\n', 'Summit Electrical Supply').by).toBe(null)
  })

  it('a PO with no "Vendor:" field: the text path\'s check does not run, and says so', () => {
    const d = text('t5-legit-footer'); d.purchase_order = d.purchase_order.replace(' | Vendor: Summit Electrical Supply', '')
    const r = t(d)
    expect(claim(r, 'ap.vendor')).toBeUndefined()
    expect(r.not_checked).toContain("vendor check: the purchase order names no vendor, so the bill's vendor was not compared with it")
  })

  it('the 100 Distil invoices all name their PO\'s vendor: the check passes on every one', () => {
    const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { input: string })
    const open = cases.filter((c) => claim(t({ ...splitApLayout(c.input)!, history: [] }), 'ap.vendor')?.outcome !== 'PASS')
    expect(open.length).toBe(0)
  })
})

describe('a stated total is an amount on a total line, never an account, phone or ZIP number', () => {
  it('under engine 0.6.0 the bank-account line is not a total; under 0.5.0 the reading is as it was', () => {
    const inv = 'Total due: USD 7,500.00\nPlease remit to our new bank account ending 9921.\nRemit to: PO Box 4471, Denver CO 80217. Phone 303 555 0142.\n'
    expect(parseInvoice(inv, { strictTotals: true }).totals.map((x) => x.value)).toEqual([7500])
    expect(parseInvoice(inv).totals.map((x) => x.value)).toEqual([7500, 9921])
    expect(claim(t(text('t3-wrong-vendor-sneaky-line'), { engine: '0.5.0' }), 'ap.total')!.insufficiency?.detail).toBe('several different stated totals (7500, 9921)')
  })
  it('a total written as a bare number still reads, and a please-remit line with an amount is a total', () => {
    expect(parseInvoice('TOTAL DUE | 3,704\n', { strictTotals: true }).totals.map((x) => x.value)).toEqual([3704])
    expect(parseInvoice('Please remit USD 1,250.00 by 10/15\n', { strictTotals: true }).totals.map((x) => x.value)).toEqual([1250])
    expect(parseInvoice('Total due on invoice #4471: $7,500.00\n', { strictTotals: true }).totals.map((x) => x.value)).toEqual([7500])
    expect(parseInvoice('Balance due: call 303.555.0142\n', { strictTotals: true }).totals).toEqual([])
  })
})

describe('tax billed against the purchase order\'s tax terms (structured)', () => {
  it('the reviewer\'s 07: $1,490 tax on a PO with no tax terms goes to a person, naming the amount', () => {
    const x = bill('07-inflated-tax')
    const r = s(x)
    expect([r.decision, r.payable]).toEqual(['abstain', false])
    expect(r.reasons[0]).toBe('cannot decide ap.tax: tax 1,490.00 is billed, and the purchase order states no tax terms (no tax_rate): a person confirms the tax is due on this order before the bill is paid')
    const out = report(r, apInputDocuments(x))
    expect(out).toContain('Tax: 1,490.00 billed; the purchase order states no tax terms.')
    expect(out).toContain('What would settle it:\n  - The purchase order\'s tax terms (tax_rate')
  })

  it('a PO that states a rate of 0: any tax holds as hold_total (silent is a person; stated zero is a hold)', () => {
    const x = bill('07-inflated-tax'); x.purchase_order.tax_rate = 0
    const r = s(x)
    expect(r.decision).toBe('hold_total')
    expect(r.reasons[0]).toBe('tax 1,490.00 is billed, but the purchase order states a tax rate of 0%: no tax is due on this order')
    expect(r.grounding).toMatchObject({ invoiced: 1490, expected: 0 })
  })

  // 2026-10-06: tax to the cent, rounding (one minor unit per taxable line) the only tolerance; the price tolerance is for prices
  it('a PO that states a rate: rate × taxable lines, within rounding, passes, and the tax prints on the approve', () => {
    const x = bill('07-inflated-tax'); x.purchase_order.tax_rate = 0.15 // 15% of 9,940.00 is 1,491.00
    x.bill.tax = '1491.00'; x.bill.amount = '11431.00'
    const r = s(x)
    expect(r.decision).toBe('approve')
    expect(claim(r, 'ap.tax')!.explanation).toBe('Tax 1,491.00 is billed: 15% of the taxable lines, 9,940.00, is 1,491.00.')
    expect(report(r, apInputDocuments(x))).toContain('Tax: 1,491.00 billed; 15% of the taxable lines (9,940.00) is 1,491.00.')
    // 1,490.00 is within 2% of 1,491.00, and was approved before: a dollar under is more than rounding allows
    const u = bill('07-inflated-tax'); u.purchase_order.tax_rate = 0.15
    const under = s(u)
    expect(under.decision).toBe('abstain')
    expect(under.reasons[0]).toContain('under by 1.00, more than rounding allows (0.01 per taxable line, 0.03 on this bill)')
    x.purchase_order.tax_rate = 0.0825 // 820.05 expected: 1,491.00 is over by 670.95
    const o = s(x)
    expect(o.decision).toBe('abstain')
    expect(o.reasons[0]).toContain('over by 670.95, more than rounding allows')
  })

  it('rounding: a vendor that rounds each line\'s tax stays inside one cent per taxable line; a cent more goes to a person', () => {
    const x = bill('07-inflated-tax'); x.purchase_order.tax_rate = 0.15
    x.bill.tax = '1491.03'; x.bill.amount = '11431.03'
    const r = s(x)
    expect(r.decision).toBe('approve')
    expect(claim(r, 'ap.tax')!.explanation).toBe('Tax 1,491.03 is billed: 15% of the taxable lines, 9,940.00, is 1,491.00 (over by 0.03, within rounding: 0.01 per taxable line, 0.03 on this bill).')
    x.bill.tax = '1491.04'; x.bill.amount = '11431.04'
    expect(s(x).decision).toBe('abstain')
  })

  it('a PO line marked taxable: false is left out of the base', () => {
    const x = bill('07-inflated-tax'); x.purchase_order.tax_rate = 0.2; x.purchase_order.line_items[0]!.taxable = false // 20% of 4,140.00 is 828.00
    x.bill.tax = '828.00'; x.bill.amount = '10768.00'
    const r = s(x)
    expect(r.decision).toBe('approve')
    expect(claim(r, 'ap.tax')!.explanation).toContain('20% of the taxable lines, 4,140.00 (1 line marked not taxable left out), is 828.00')
  })

  it('every approve prints the tax, and a bill that carries none says so', () => {
    const x = bill('01-clean')
    expect(report(s(x), apInputDocuments(x))).toContain('\nTax: none billed.\n')
    // 2026-10-06: what was read, never a universal "none"
    expect(report(t(text('t5-legit-footer')), text('t5-legit-footer'))).toContain('\nTax: no amount on the invoice was read as tax (every amount on it was read as a line, the total or freight).\n')
  })

  it('the schema states the fields, and refuses a percent written as a bare number', () => {
    const x = bill('07-inflated-tax'); (x.purchase_order as Record<string, unknown>).tax_rate = 8.25
    const v = validateApInput(x)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.errors[0]).toMatchObject({ code: 'ap_input.out_of_range', field: '/purchase_order/tax_rate' })
    const y = bill('07-inflated-tax'); (y.purchase_order.line_items[0] as Record<string, unknown>).taxable = 'yes'
    const w = validateApInput(y)
    expect(w.ok).toBe(false)
  })

  it('a bill that carries no tax field gets no tax claim, so the verdicts of bills without tax are unchanged in shape', () => {
    expect(claim(s(bill('01-clean')), 'ap.tax')).toBeUndefined()
  })
})

describe('"Not checked" names the per-line netting gap whenever an earlier bill is booked on the PO', () => {
  it('the reviewer\'s 05: approve stands (amounts fit the order), and the answer says per-line netting was not done', () => {
    const r = s(bill('05-partial-overbill'))
    expect(r.decision).toBe('approve')
    // 2026-10-06: the note names the field that closes the gap
    expect(r.not_checked).toContain("quantities per PO line across bills: booked invoice SES-20417 on PO-7740 carries an amount, not lines, so this bill's quantities were compared with what was received, not netted against what that bill already billed on each line (the PO balance check nets amounts on the order only). invoiced_quantity_to_date on each PO line (the quantity earlier bills invoiced on it) lets this bill be netted line by line")
  })
  it('nothing booked on the order: no such note', () => {
    expect(s(bill('01-clean')).not_checked.some((n) => n.startsWith('quantities per PO line'))).toBe(false)
  })
})

describe('freight as a policy: ap --freight allow|person', () => {
  it('person, the default, sends freight on a PO that does not say to a person, as before; allow adds it to the total', () => {
    const x = bill('17-freight-po-silent')
    const p = s(x)
    expect(p.decision).toBe('abstain')
    const a = s(x, { policy: { freight: 'allow' } })
    expect(a.decision).toBe('approve')
    const total = claim(a, 'ap.total')!
    expect(total.computation?.operands).toMatchObject({ freight_policy: 'allow', freight_allowed: null })
    expect(total.explanation).toContain("which the PO does not address and the run's freight policy allows")
    expect(report(a, apInputDocuments(x))).toContain("Freight: 85.00 billed; the purchase order does not say whether freight is allowed, and this run's freight policy (--freight allow) allows it.")
  })

  it('a PO that says no is never overridden', () => {
    expect(s(bill('08-freight'), { policy: { freight: 'allow' } }).decision).toBe('hold_total')
  })

  it('the default hashes as before: "person" stated is the same verdict as no policy; "allow" is another verdict id', () => {
    const x = bill('01-clean')
    expect(s(x, { policy: { freight: 'person' } }).verdict.verdict_id).toBe(s(x).verdict.verdict_id)
    expect(s(x, { policy: { freight: 'allow' } }).verdict.verdict_id).not.toBe(s(x).verdict.verdict_id)
  })

  it('refused under an earlier engine, and for any other value', () => {
    expect(() => s(bill('01-clean'), { engine: '0.5.0', policy: { freight: 'allow' } })).toThrow(/needs engine 0.6.0/)
    expect(() => s(bill('01-clean'), { policy: { freight: 'yes' as 'allow' } })).toThrow(/policy.freight must be "allow" or "person"/)
  })

  it('the text path reads the same policy', () => {
    const d = text('t5-legit-footer')
    d.purchase_order = d.purchase_order.replace('Freight: not allowed', 'Freight: see terms')
    d.invoice = d.invoice.replace('Total due: USD 7,500.00', 'Freight: USD 85.00\n\nTotal due: USD 7,585.00')
    expect(t(d).decision).toBe('abstain')
    expect(t(d, { policy: { freight: 'allow' } }).decision).toBe('approve')
  })

  it('the CLI binds it into the proof, and the proof replays', () => {
    let out = '', err = ''
    const code = cli(['ap', '--input', join(FX, '17-freight-po-silent.json'), '--freight', 'allow'], { out: (x) => { out += x }, err: (x) => { err += x } })
    expect(code).toBe(0)
    const res = JSON.parse(out)
    expect(res.proof.inputs.policy).toEqual({ price_tolerance: 0.02, total_tolerance: 0.005, freight: 'allow' })
    expect(verifyReplay(res.proof.verdict, res.proof.inputs).status).toBe('REPERFORMED')
    let e2 = ''
    expect(cli(['ap', '--input', join(FX, '01-clean.json'), '--freight', 'maybe'], { out: () => {}, err: (x) => { e2 += x } })).toBe(3)
    expect(e2).toContain('--freight "maybe"')
  })
})
