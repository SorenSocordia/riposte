/**
 * 2026-10-05: the duplicate check's near-match vendors and the AP decision's fail-closed rule, under engine 0.6.0.
 *
 *   1. the cases of a cold reader in the controller's role (cold review round 2): a one-letter typo, an abbreviation, initials as a trading name, with the same invoice
 *      number, hold for the controller whatever the PO and total say; the explanation names both vendor strings and why they
 *      look alike, and says only what the booked row carries
 *   2. an unrelated vendor with the same number still approves, and the approve says where the number is booked
 *   3. nearVendorBasis: what looks alike and what does not
 *   4. ids and tax ids: they decide first, as before
 *   5. fail closed: payable is true exactly on an approve, an approve stands only on a verdict that reads PASS, every abstain is
 *      payable false; engine 0.5.0 re-performs as it did
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyBillMatch, verifyInvoiceMatch, verifyReplay, splitApLayout, apInputDocuments, type ApStructuredInput, type ApResult, type ApDocuments } from '../src/index'
import { nearVendorBasis } from '../src/ap/duplicate'
import { formatApReport } from '../src/ap/report'
import { abstainsOnlyForMissingHistory } from '../src/ap/decide'

const NOW = () => new Date('2026-10-05T00:00:00Z')
const S = 'Summit Electrical Supply'
type Payment = NonNullable<ApStructuredInput['payment_history']>[number]

/** The controller's bill: SES-10422 from Summit Electrical Supply on PO-2210, 4,875.00. */
const bill = (history?: Payment[], vendor: ApStructuredInput['bill']['vendor'] = { name: S }): ApStructuredInput => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: { invoice_number: 'SES-10422', vendor, purchase_order_number: 'PO-2210', currency: 'USD', amount: '4875.00',
    line_items: [
      { purchase_order_line_item_id: 'l1', quantity: 10, unit_price: '212.50', amount: '2125.00' },
      { purchase_order_line_item_id: 'l2', quantity: 50, unit_price: '31.00', amount: '1550.00' },
      { purchase_order_line_item_id: 'l3', quantity: 20, unit_price: '60.00', amount: '1200.00' },
    ] },
  purchase_order: { id: 'po-2210', purchase_order_number: 'PO-2210', currency: 'USD', freight_allowed: false,
    line_items: [
      { id: 'l1', description: 'MC cable 12/2 250 ft roll', quantity: 10, unit_price: '212.50' },
      { id: 'l2', description: 'EMT conduit 3/4 in x 10 ft', quantity: 50, unit_price: '31.00' },
      { id: 'l3', description: '20A 1P breaker', quantity: 20, unit_price: '60.00' },
    ] },
  item_receipts: [{ purchase_order_id: 'po-2210', line_items: [
    { purchase_order_line_item_id: 'l1', quantity: 10 }, { purchase_order_line_item_id: 'l2', quantity: 50 }, { purchase_order_line_item_id: 'l3', quantity: 20 }] }],
  ...(history ? { payment_history: history } : {}),
})
const booked = (o: Partial<Payment>): Payment => ({ invoice_number: 'SES-10422', vendor: `${S}, Inc.`, purchase_order_number: 'PO-2210', amount: '4875.00', paid_at: '2026-09-12', ...o })
const run = (x: ApStructuredInput, engine?: string): ApResult => verifyBillMatch(x, { now: NOW, ...(engine ? { engine } : {}) })
const dup = (r: ApResult) => r.verdict.claims.find((c) => c.claim_id === 'ap.duplicate')!
const authorities = (r: ApResult) => (r.verdict.remedies ?? []).filter((m) => m.kind === 'authority' && m.claims.includes('ap.duplicate')).map((m) => m.authority)

// the controller's rows: label, the booked row, and the decision before look-alike names were read
const CONTROLLER: [string, Payment, string][] = [
  ['a typo, same PO and total', booked({ vendor: 'Sumit Electrical Supply' }), 'abstain'],
  ['an abbreviation, same PO and total', booked({ vendor: 'Summit Elec. Supply' }), 'abstain'],
  ['a typo, the row carries no PO or amount', booked({ vendor: 'Sumit Electrical Supply', purchase_order_number: null, amount: null }), 'approve'],
  ['a typo, same total, no PO', booked({ vendor: 'Sumit Electrical Supply', purchase_order_number: null }), 'abstain'],
  ['a typo, same PO, total off', booked({ vendor: 'Sumit Electrical Supply', amount: '4900.00' }), 'abstain'],
  ['a typo, other PO, total off', booked({ vendor: 'Sumit Electrical Supply', purchase_order_number: 'PO-2211', amount: '4900.00' }), 'approve'],
  ['initials ("SES Electrical"), other PO, total off', booked({ vendor: 'SES Electrical', purchase_order_number: 'PO-2211', amount: '4900.00' }), 'approve'],
]

describe('near-match vendors: the controller\'s cases hold for the controller', () => {
  for (const [label, row] of CONTROLLER) {
    it(`${label}: hold_duplicate, both vendor strings named, authority ap-controller`, () => {
      const r = run(bill([row]))
      expect(r.decision).toBe('hold_duplicate')
      expect(r.payable).toBe(false)
      const c = dup(r)
      expect(c.outcome).toBe('FAIL')
      expect(c.computation?.operands).toMatchObject({ vendor_match: 'near', booked_vendor: row.vendor, bill_vendor: S })
      expect(c.explanation).toContain(`already booked under '${row.vendor}'`)
      expect(c.explanation).toContain(`this bill says '${S}'`)
      expect(c.explanation).toMatch(/the names look alike: /)
      expect(c.explanation).toContain('the controller confirms')
      expect(authorities(r)).toEqual(['ap-controller'])
      expect(r.verdict.gate_status).toBe('FAIL')
    })
  }
  it('the explanation says why the names look alike, in the words of the case', () => {
    expect(dup(run(bill([CONTROLLER[0]![1]]))).explanation).toContain("they differ by one character ('sumit' against 'summit')")
    expect(dup(run(bill([CONTROLLER[1]![1]]))).explanation).toContain("'elec' abbreviates 'electrical'")
    expect(dup(run(bill([CONTROLLER[6]![1]]))).explanation).toContain("'ses' is the initials of 'summit electrical supply'")
  })
  it('the booked row is described only as far as it carries a PO and an amount (an earlier sentence claimed both)', () => {
    const h = dup(run(bill([CONTROLLER[2]![1]]))).explanation
    expect(h).toContain('the booked row carries no PO or amount to compare')
    expect(h).not.toMatch(/another PO|another total/)
    expect(dup(run(bill([CONTROLLER[3]![1]]))).explanation).toContain('the booked row has the same total, 4875, and carries no PO to compare')
    expect(dup(run(bill([CONTROLLER[4]![1]]))).explanation).toContain('the booked row has the same PO, PO-2210, and another total, 4900')
    expect(dup(run(bill([CONTROLLER[5]![1]]))).explanation).toContain('the booked row has another PO, PO-2211, and another total, 4900')
  })
  it('a "d/b/a" trading name on either side, and a word left off, hold too', () => {
    for (const vendor of ['Acme Holdings LLC d/b/a Summit Electrical Supply', 'Acme Holdings dba Summit Electric Supply', 'Summit Electrical']) {
      const r = run(bill([booked({ vendor, purchase_order_number: 'PO-9', amount: '1.00' })]))
      expect(r.decision, vendor).toBe('hold_duplicate')
    }
    const r = run(bill([booked({ vendor: S, purchase_order_number: 'PO-9', amount: '1.00' })], { name: 'Acme Holdings LLC DBA Summit Electrical Supply' }))
    expect(r.decision).toBe('hold_duplicate')
    expect(dup(r).explanation).toContain('a trading name ("d/b/a") on one side is the other name')
  })
  it('the text path holds the same way', () => {
    const docs: ApDocuments = {
      invoice: 'INVOICE MESSAGE\nINVOICE SES-10422   DATE 2026-09-28\nCUST PO: PO-2210\n1   MC cable 12/2 250 ft roll | 10 | 212.50 | 2,125.00\nTOTAL DUE USD | 2,125.00\n',
      purchase_order: 'PURCHASE ORDER (ERP)\nPO-2210 | Vendor: Summit Electrical Supply | Freight: not allowed\n1. MC cable 12/2 250 ft roll | qty 10 | unit USD 212.50\n',
      goods_receipt: 'GOODS RECEIPT (ERP) for PO-2210\n1. MC cable 12/2 250 ft roll | received 10\n',
      history: [{ invoice_number: 'SES-10422', vendor: 'Sumit Electrical Supply', po_number: 'PO-2211', total: 4900 }],
    }
    const r = verifyInvoiceMatch(docs, { now: NOW })
    expect(r.decision).toBe('hold_duplicate')
    expect(r.reasons[0]).toContain("they differ by one character ('sumit' against 'summit')")
    expect(verifyInvoiceMatch(docs, { now: NOW, engine: '0.5.0' }).decision).toBe('approve')
  })
  it('engine 0.5.0 re-performs its own decisions exactly (a verdict pinned to it replays)', () => {
    for (const [label, row, before] of CONTROLLER) {
      const r = run(bill([row]), '0.5.0')
      // 0.5.0 compares lower-cased names only, so every row here reads as another supplier: it never had the abstains 0.6.0 adds
      expect(r.decision, label).toBe('approve')
      expect(['approve', 'abstain']).toContain(before)
    }
  })
  it('a near-match hold replays REPERFORMED', () => {
    for (const [, row] of CONTROLLER) {
      const x = bill([row])
      const r = run(x)
      const ok = verifyReplay(r.verdict, { ap_structured: apInputDocuments(x), policy: { price_tolerance: 0.02, total_tolerance: 0.005 } })
      expect(ok.status).toBe('REPERFORMED')
      expect(ok.outcome_verified).toBe(true)
    }
  })
})

describe('an unrelated vendor with the same number', () => {
  const G = booked({ vendor: 'Apex Plumbing Wholesale', purchase_order_number: 'PO-9999', amount: '312.00' })
  it('approves, and the plain-English block says where the number is booked, never "including the duplicate check"', () => {
    const r = run(bill([G]))
    expect(r.decision).toBe('approve')
    expect(r.payable).toBe(true)
    expect(r.reasons[0]).toContain("Invoice number SES-10422 is also booked under 'Apex Plumbing Wholesale' (another vendor name; the booked row has another PO, PO-9999, and another total, 312)")
    expect(r.reasons.join(' ')).not.toContain('including the duplicate check')
    const block = formatApReport(r, { documents: apInputDocuments(bill([G])) })
    expect(block).toContain("is also booked under 'Apex Plumbing Wholesale'")
    expect(block).not.toContain('including the duplicate check')
  })
  it('a booked row with no PO and no amount is said to carry none, not "another PO and another total"', () => {
    const r = run(bill([booked({ vendor: 'Apex Plumbing Wholesale', purchase_order_number: null, amount: null })]))
    expect(r.decision).toBe('approve')
    expect(r.reasons[0]).toContain('the booked row carries no PO or amount to compare')
    expect(r.reasons[0]).not.toMatch(/another PO|another total/)
  })
  it('an empty payment history approves and says it was empty; a history without the number keeps the plain reason', () => {
    expect(run(bill([])).reasons).toEqual(['all checks passed; the payment history supplied is empty, so the duplicate check had no booked invoice to compare'])
    expect(run(bill([booked({ invoice_number: 'SES-99999', vendor: 'Apex Plumbing Wholesale' })])).reasons).toEqual(['all checks passed, including the duplicate check'])
  })
})

describe('nearVendorBasis', () => {
  const near: [string, string, RegExp][] = [
    ['Sumit Electrical Supply', S, /one character \('sumit' against 'summit'\)/],
    ['Summit Electrcial Supply', S, /one character/], // two neighbours swapped
    ['Summitt Electricl Supply', S, /two characters/],
    ['Summit Elec. Supply', S, /'elec' abbreviates 'electrical'/],
    ['Pemberton Lab Gl.', 'Pemberton Lab Glass', /'gl' abbreviates 'glass'/], // a last word cut short, two others equal
    ['Pemberton Lab G.', 'Pemberton Lab Glass', /'g' abbreviates 'glass'/],
    ['Summit Elec Sply', S, /'elec' abbreviates 'electrical', 'sply' abbreviates 'supply'/],
    ['Northfield Matl Handling Intl', 'Northfield Material Handling International', /'matl' abbreviates 'material', 'intl' abbreviates 'international'/],
    ['SES Electrical', S, /'ses' is the initials of 'summit electrical supply'/],
    ['SES', S, /'ses' is the initials/],
    ['SE Supply', S, /'se' is the initials of 'summit electrical'/],
    ['BOA Supply', 'Bank of America', /'boa' is the initials of 'bank of america'/],
    ['Summit Electrical', S, /'summit electrical' is 'summit electrical supply' without 'supply'/],
    ['Summit', S, /'summit' is 'summit electrical supply' without 'electrical supply'/],
    ['Acme Holdings d/b/a Summit Electrical Supply', S, /trading name \("d\/b\/a"\) on one side is the other name: 'summit electrical supply'/],
    ['Acme Holdings, D.B.A. Sumit Electrical', 'Summit Electrical', /trading name .* looks like the other name: they differ by one character/],
  ]
  for (const [a, b, why] of near) it(`"${a}" looks like "${b}"`, () => { expect(nearVendorBasis(a, b)).toMatch(why); expect(nearVendorBasis(b, a)).not.toBeNull() })
  const apart: [string, string][] = [
    ['Apex Plumbing Wholesale', S],
    ['Atlas Fastener Supply', 'Northfield Material Handling'],
    ['Acme', 'Acne'], // four letters: no edit is small enough
    ['Summit Electrical Supply', 'Summit Mechanical Contractors'],
    ['Delta Tool Rental', 'Delta Air Lines'],
    ['Northern Pipe', 'Southern Pipe'],
    ['Summit Electrical Services', 'Summit Electrical Supply'], // two equal words, but neither third word is a cut of the other
  ]
  for (const [a, b] of apart) it(`"${a}" does not look like "${b}"`, () => { expect(nearVendorBasis(a, b)).toBeNull(); expect(nearVendorBasis(b, a)).toBeNull() })
  it('names that are the same after normalizing are a variant, not a near match', () => {
    expect(nearVendorBasis(`${S}, Inc.`, S)).toBeNull()
    expect(nearVendorBasis('SUMMIT ELECTRICAL SUPPLY', S)).toBeNull()
  })
})

describe('ids and tax ids decide first, as before', () => {
  it('another vendor id under names that look alike holds, naming both ids', () => {
    const r = run(bill([booked({ vendor: 'Sumit Electrical Supply', vendor_id: 'V-207', purchase_order_number: 'PO-1', amount: 1 })], { id: 'V-100', name: S }))
    expect(r.decision).toBe('hold_duplicate')
    expect(dup(r).explanation).toContain('another vendor id (booked V-207; this bill V-100) under names that look alike')
  })
  it('the same vendor id is the same supplier; another vendor id under unlike names is another supplier', () => {
    expect(run(bill([booked({ vendor: 'Apex Plumbing Wholesale', vendor_id: 'V-100' })], { id: 'V-100', name: S })).decision).toBe('hold_duplicate')
    expect(run(bill([booked({ vendor: 'Apex Plumbing Wholesale', vendor_id: 'V-300', purchase_order_number: 'PO-1', amount: 1 })], { id: 'V-100', name: S })).decision).toBe('approve')
  })
  it('two tax ids under names that look alike are a conflict a person resolves, exactly as matching names are', () => {
    const r = run(bill([booked({ vendor: 'Sumit Electrical Supply', vendor_tax_id: '98-7654321', purchase_order_number: 'PO-1', amount: 1 })], { name: S, tax_id: '12-3456789' }))
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
    expect(dup(r).insufficiency?.detail).toContain('the vendor names look alike (they differ by one character')
    expect(dup(r).insufficiency?.detail).toContain('but the tax ids differ (booked 98-7654321; this bill 123456789)') // the bill's tax id as compared
  })
})

describe('near-match is only ever stricter: a seeded property', () => {
  // deterministic generator: a typo, an abbreviation, the initials, a d/b/a, or a word left off, of a three-word vendor name
  const FIRST = ['Summit', 'Northfield', 'Ridgeline', 'Granite', 'Cascade', 'Harbor', 'Liberty', 'Pioneer', 'Keystone', 'Redwood', 'Frontier', 'Meridian']
  const MID = ['Electrical', 'Material', 'Mechanical', 'Industrial', 'Plumbing', 'Equipment', 'Fastener', 'Lumber', 'Concrete', 'Hardware']
  const LAST = ['Supply', 'Handling', 'Distribution', 'Services', 'Wholesale', 'Products', 'Rentals', 'Solutions']
  let seed = 20261005
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const typo = (w: string): string => { const i = 1 + rnd(w.length - 2); return rnd(2) ? w.slice(0, i) + w.slice(i + 1) : w.slice(0, i) + w[i] + w.slice(i) }
  const variants = (f: string, m: string, l: string): string[] => [
    `${typo(f)} ${m} ${l}`, `${f} ${typo(m)} ${l}`, `${f} ${m.slice(0, 4)}. ${l}`, `${f[0]}${m[0]}${l[0]} ${m}`, `Acme Holdings dba ${f} ${m} ${l}`, `${f} ${m}`, `${f} ${m} ${l.slice(0, 2)}.`,
  ]
  it('350 look-alike names on the same invoice number, any PO and total: never approved, always held for the controller', () => {
    let held = 0
    for (let k = 0; k < 50; k++) {
      const f = FIRST[rnd(FIRST.length)]!, m = MID[rnd(MID.length)]!, l = LAST[rnd(LAST.length)]!
      for (const v of variants(f, m, l)) {
        const po = rnd(3) === 0 ? 'PO-2210' : `PO-${1000 + rnd(9000)}`
        const amount = rnd(3) === 0 ? '4875.00' : `${100 + rnd(9000)}.00`
        const r = run(bill([booked({ vendor: v, purchase_order_number: rnd(5) === 0 ? null : po, amount: rnd(5) === 0 ? null : amount })], { name: `${f} ${m} ${l}` }))
        expect(r.decision, `${v} vs ${f} ${m} ${l}`).toBe('hold_duplicate')
        expect(authorities(r)).toEqual(['ap-controller'])
        held++
      }
    }
    expect(held).toBe(350)
  })
})

describe('fail closed: one answer per bill under engine 0.6.0', () => {
  const CASES = readFileSync(join(__dirname, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
    .map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
  const invariant = (r: ApResult, label: string) => {
    expect(r.payable, label).toBe(r.decision === 'approve')
    if (r.decision === 'approve') expect(r.verdict.gate_status, label).toBe('PASS')
    if (r.verdict.gate_status === 'PASS_WITH_OPEN') expect(r.decision, label).toBe('abstain')
  }
  it('the 100 public benchmark bills, with and without a payment history: payable exactly on approve, approve only on PASS', () => {
    let toPerson = 0
    for (const c of CASES) {
      const d = splitApLayout(c.input)!
      const known = verifyInvoiceMatch({ ...d, history: [] }, { now: NOW })
      invariant(known, `${c.id} history []`)
      expect(known.decision, c.id).toBe(c.decision) // the three-way match on a known, empty book: as the benchmark labels it
      const none = verifyInvoiceMatch(d, { now: NOW })
      invariant(none, `${c.id} no history`)
      if (c.decision === 'approve') {
        toPerson++
        expect(none.decision, c.id).toBe('abstain')
        expect(none.reasons[0], c.id).toMatch(/^cannot decide ap\.duplicate: duplicate check not run/)
      } else expect(none.decision, c.id).toBe(c.decision) // a hold or an abstain is unchanged
    }
    expect(toPerson).toBe(32)
  })
  it('the controller\'s no-history bill: A PERSON DECIDES naming the duplicate check first, lines read still shown', () => {
    const x = bill()
    const r = run(x)
    expect(r).toMatchObject({ decision: 'abstain', payable: false })
    expect(r.verdict.gate_status).toBe('PASS_WITH_OPEN')
    const block = formatApReport(r, { documents: apInputDocuments(x) })
    const lines = block.split('\n')
    expect(lines[0]).toBe('A PERSON DECIDES. Open first: the duplicate check (ap.duplicate) did not run. Do not pay this bill automatically.')
    expect(lines[3]).toMatch(/^ {2}- cannot decide ap\.duplicate: duplicate check not run/)
    expect(block).toContain('Lines read (the open check read none; these are the lines the checks that ran read):')
    expect(block).toContain('invoice /bill/line_items/0/quantity = 10')
    expect(block).toContain('What would settle it:')
  })
  it('a bill the model says to pay changes nothing: the decision never reads the model', () => {
    const p = bill(); p.decision = { action: 'pay', confidence: 0.99 }
    expect(run(p)).toMatchObject({ decision: 'abstain', payable: false })
  })
  it('abstainsOnlyForMissingHistory: true only when the duplicate check, for want of a history, is the one open check', () => {
    expect(abstainsOnlyForMissingHistory(run(bill()))).toBe(true)
    expect(abstainsOnlyForMissingHistory(run(bill([])))).toBe(false) // an approve
    expect(abstainsOnlyForMissingHistory(run(bill([CONTROLLER[5]![1]])))).toBe(false) // a look-alike vendor: a hold
    expect(abstainsOnlyForMissingHistory(run(bill([booked({ invoice_number: 'SES10422', vendor: S })])))).toBe(false) // ambiguous number
    const noReceipt = bill(); noReceipt.item_receipts[0]!.line_items.pop() // a line with no receipt: REFERENCE_NOT_PROVIDED too
    const r = run(noReceipt)
    expect(r.decision).toBe('abstain')
    expect(r.verdict.claims.some((c) => c.claim_id !== 'ap.duplicate' && c.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED')).toBe(true)
    expect(abstainsOnlyForMissingHistory(r)).toBe(false)
    const eur = bill(); eur.bill.currency = 'EUR'
    expect(abstainsOnlyForMissingHistory(run(eur))).toBe(false)
    const short = bill(); short.item_receipts[0]!.line_items[0]!.quantity = 9 // a hold, with no history
    expect(abstainsOnlyForMissingHistory(run(short))).toBe(false)
  })
  it('engine 0.5.0 keeps its decisions and its null payable on an abstain', () => {
    expect(run(bill(), '0.5.0')).toMatchObject({ decision: 'approve', payable: true })
    const x = bill(); x.bill.currency = 'EUR'
    const r = run(x, '0.5.0')
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBeNull()
    expect(run(x).payable).toBe(false)
  })
})

describe('a last word cut short (found by the synthetic month, 2026-10-05)', () => {
  // "Pemberton Lab Glass" booked, "Pemberton Lab Gl." on the repeat, same invoice number: approved before (with its own PO and
  // total) or sent to a clerk (with the same total); a hold for the controller now
  const pem = (po: string, amount: string): ApStructuredInput => ({
    schema: 'riposte.ap-input/0.1.0',
    bill: { invoice_number: 'PEM-10195', vendor: { name: 'Pemberton Lab Gl.' }, purchase_order_number: 'PO-77', currency: 'USD', amount: '600.00',
      line_items: [{ purchase_order_line_item_id: 'l1', quantity: 10, unit_price: '60.00', amount: '600.00' }] },
    purchase_order: { purchase_order_number: 'PO-77', currency: 'USD', line_items: [{ id: 'l1', quantity: 10, unit_price: '60.00' }] },
    item_receipts: [{ line_items: [{ purchase_order_line_item_id: 'l1', quantity: 10 }] }],
    payment_history: [{ invoice_number: 'PEM-10195', vendor: 'Pemberton Lab Glass', purchase_order_number: po, amount }],
  })
  it('with its own PO and total, and with the same total: hold_duplicate, cleared by the controller', () => {
    for (const [po, amount] of [['PO-12', '915.00'], ['PO-12', '600.00']] as const) {
      const r = run(pem(po, amount))
      expect(r.decision, `${po} ${amount}`).toBe('hold_duplicate')
      expect(authorities(r)).toEqual(['ap-controller'])
      expect(dup(r).explanation).toContain("'gl' abbreviates 'glass'")
    }
  })
})
