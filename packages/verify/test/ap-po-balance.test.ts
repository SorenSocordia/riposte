/**
 * The PO balance check (engine 0.6.0, 2026-10-05; src/ap/po-balance.ts) and the price tolerance as
 * a parameter (`ap --price-tolerance`, src/ap/index.ts apPolicyOf).
 *
 * A cold reader in the controller's role (cold review round 3) billed 6 of a PO line with 10 received, paid it, then sent a second bill for 7 on the same order: the
 * gate approved it, exit 0, 13 billed against 10 received. Payment-history rows carry an amount and no lines, so the check nets
 * amounts on the order: what is booked on this PO (same vendor), plus this bill's lines, against Σ quantity × unit price.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import { verifyBillMatch, type ApStructuredInput } from '../src/ap/structured'
import { AP_REMEDIES, AP_REMEDIES_V060, apPolicyOf, splitApLayout, verifyInvoiceMatch } from '../src/ap/index'
import type { ApResult } from '../src/ap/index'
import { cleanScratch, scratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
const VENDOR = 'Granite State Electric Supply'

/** The controller's case (cold review round 3, case t4): PO-7001, one line of 10 panelboards at 200.00, all 10 received. */
function bill(o: { invoice?: string; qty?: number; amount?: string; history?: unknown[] | null } = {}): ApStructuredInput {
  const qty = o.qty ?? 7
  const amount = o.amount ?? (qty * 200).toFixed(2)
  const x: Record<string, unknown> = {
    schema: 'riposte.ap-input/0.1.0',
    bill: { invoice_number: o.invoice ?? 'GS-2231', vendor: { name: VENDOR }, purchase_order_number: 'PO-7001', currency: 'USD', amount,
      line_items: [{ purchase_order_line_item_id: 'l1', quantity: qty, unit_price: '200.00', amount }] },
    purchase_order: { id: 'po-7001', purchase_order_number: 'PO-7001', currency: 'USD', freight_allowed: false,
      line_items: [{ id: 'l1', description: '400A panelboard', quantity: 10, unit_price: '200.00' }] },
    item_receipts: [{ purchase_order_id: 'po-7001', line_items: [{ purchase_order_line_item_id: 'l1', quantity: 10 }] }],
  }
  if (o.history !== null) x.payment_history = o.history ?? []
  return x as unknown as ApStructuredInput
}
/** A booked row; po null: the row carries no PO number. */
const row = (invoice: string, amount: string | undefined, po: string | null = 'PO-7001', vendor = VENDOR): Record<string, string> =>
  ({ invoice_number: invoice, vendor, ...(po !== null ? { purchase_order_number: po } : {}), ...(amount !== undefined ? { amount } : {}) })
const go = (x: ApStructuredInput, engine?: string): ApResult => verifyBillMatch(x, { now: NOW, ...(engine ? { engine } : {}) })
const balance = (r: ApResult) => r.verdict.claims.find((c) => c.claim_id === 'ap.po_balance')

describe('cumulative over-billing on one order goes to a person, in words', () => {
  it("the controller's case: 1,200.00 booked + this bill's 1,400.00 against an order of 2,000.00 → a person decides", () => {
    const r = go(bill({ history: [row('GS-2210', '1200.00')] }))
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
    const c = balance(r)!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('already booked 1,200.00 on PO-7001 (GS-2210); this bill 1,400.00; the order totals 2,000.00')
    expect(c.explanation).toContain('2,600.00, 600.00 more than the order')
    expect(c.explanation).toContain('amounts on the order, not quantities on a line')
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.po_balance: billed to date on PO-7001 would be 2,600\.00/)
    expect(c.computation?.operands).toEqual({ po: 'PO-7001', booked: 1200, this_bill: 1400, billed_to_date: 2600, order_total: 2000, booked_invoices: 1 })
    // who may clear it: the buyer, who owns the order; or a change order / credit makes it a new check
    const mine = (r.verdict.remedies ?? []).filter((m) => m.claims.includes('ap.po_balance'))
    expect(mine.map((m) => [m.kind, m.authority ?? m.operand?.source])).toEqual([['authority', 'buyer'], ['missing-operand', 'purchase_order']])
    expect(mine[0]!.detail).toContain('Billed to date on PO-7001 would be 2600')
  })

  it('a clean bill with an empty payment history still approves (the controller\'s case t1)', () => {
    const r = go(bill({ qty: 6, invoice: 'GS-2210' }))
    expect(r.decision).toBe('approve')
    expect(balance(r)!.outcome).toBe('PASS')
    expect(balance(r)!.explanation).toBe('The payment history is empty, so nothing is booked on PO-7001 to net against this bill.')
  })

  it('a booked invoice on ANOTHER order is not counted', () => {
    const r = go(bill({ history: [row('GS-2210', '1200.00', 'PO-7002')] }))
    expect(r.decision).toBe('approve')
    expect(balance(r)!.explanation).toBe('No booked invoice is on PO-7001 (1 booked invoice compared), so there is nothing to net against this bill.')
  })

  it('exactly enough room left on the order → approve; over by one cent → a person decides', () => {
    const exact = go(bill({ qty: 6, history: [row('GS-2210', '800.00')] }))
    expect(exact.decision).toBe('approve')
    expect(balance(exact)!.explanation).toBe('Billed to date on PO-7001 is 2,000.00 of the order\'s 2,000.00: already booked 800.00 on PO-7001 (GS-2210); this bill 1,200.00.')
    const over = go(bill({ qty: 6, history: [row('GS-2210', '800.01')] }))
    expect(over.decision).toBe('abstain')
    expect(balance(over)!.explanation).toContain('2,000.01, 0.01 more than the order')
  })

  it('the PO number is compared without case, spaces or punctuation; several booked invoices are each named with their amount', () => {
    const r = go(bill({ qty: 3, history: [row('GS-2210', '1200.00', 'po 7001'), row('GS-2220', '400.00', 'PO7001')] }))
    expect(r.decision).toBe('abstain')
    expect(balance(r)!.explanation).toContain('already booked 1,600.00 on PO-7001 (GS-2210 1,200.00, GS-2220 400.00); this bill 600.00')
  })

  it('an exact repeat stays hold_duplicate: the bill\'s own invoice number is the duplicate check\'s, not counted again here', () => {
    const r = go(bill({ qty: 6, invoice: 'GS-2210', history: [row('GS-2210', '1200.00')] }))
    expect(r.decision).toBe('hold_duplicate')
    expect(balance(r)!.outcome).toBe('PASS')
  })

  it("another supplier's invoice on the same PO number is not counted; a row with no vendor name is", () => {
    expect(go(bill({ history: [row('ZZ-1', '1200.00', 'PO-7001', 'Harbor Freight Lines')] })).decision).toBe('approve')
    const unknownVendor = go(bill({ history: [{ invoice_number: 'GS-2210', purchase_order_number: 'PO-7001', amount: '1200.00' }] }))
    expect(unknownVendor.decision).toBe('abstain')
  })

  it('a credit booked against the order counts as negative', () => {
    const r = go(bill({ qty: 5, history: [row('GS-2210', '1200.00'), row('CM-0007', '-200.00')] }))
    expect(r.decision).toBe('approve')
    expect(balance(r)!.computation?.operands).toMatchObject({ booked: 1000, this_bill: 1000, billed_to_date: 2000 })
  })

  it('a hold on any other check is still the label: the balance check is last in order', () => {
    const r = go(bill({ qty: 12, history: [row('GS-2210', '1200.00')] }))
    expect(r.decision).toBe('hold_quantity')
    expect(balance(r)!.outcome).toBe('INSUFFICIENT_DATA')
  })
})

describe('what the check cannot count is said, never passed silently', () => {
  it('a booked row of this vendor with no PO number: counted as if on this order; it passes only if the bill fits even then', () => {
    const fits = go(bill({ qty: 6, history: [row('GS-2105', '300.00', null)] }))
    expect(fits.decision).toBe('approve')
    expect(balance(fits)!.explanation).toContain('Booked invoice from this vendor with no PO number (GS-2105 300.00): counted as if on this order, billed to date would be 1,500.00, which still fits.')
    const not = go(bill({ qty: 6, history: [row('GS-2105', '900.00', null)] }))
    expect(not.decision).toBe('abstain')
    const c = balance(not)!
    expect(c.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['/payment_history/0/purchase_order_number'] })
    expect(c.explanation).toContain('booked invoice from this vendor with no PO number (GS-2105 900.00): whether it was billed on PO-7001 is not known')
    expect((not.verdict.remedies ?? []).filter((m) => m.claims.includes('ap.po_balance')).map((m) => m.authority ?? m.operand?.source)).toEqual(['history', 'ap-clerk'])
  })

  it('a row that says it was booked without a PO (no_purchase_order) is on no order and is not counted; with a PO number too it is refused', () => {
    const nonPo = { invoice_number: 'GS-2105', vendor: VENDOR, no_purchase_order: true, amount: '9000.00' }
    const r = go(bill({ qty: 6, history: [nonPo] }))
    expect(r.decision).toBe('approve')
    expect(balance(r)!.explanation).toBe('No booked invoice is on PO-7001 (1 booked invoice compared), so there is nothing to net against this bill.')
    expect(() => go(bill({ qty: 6, history: [{ ...nonPo, purchase_order_number: 'PO-7001' }] }))).toThrow(/carries no purchase_order_number/)
    expect(() => go(bill({ qty: 6, history: [{ ...nonPo, no_purchase_order: 'yes' }] }))).toThrow(/must be true, false, or absent/)
  })

  it('a booked row on this order with no amount: a person decides, naming the field', () => {
    const r = go(bill({ qty: 1, history: [row('GS-2210', undefined)] }))
    expect(r.decision).toBe('abstain')
    expect(balance(r)!.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['/payment_history/0/amount'] })
    expect(balance(r)!.explanation).toContain('booked invoice GS-2210 on PO-7001 carries no amount')
  })

  it("a PO line with no quantity: its amount is the line's value; with neither, the order's total is unknown", () => {
    const withAmount = bill({ qty: 6, history: [row('GS-2210', '800.00')] }) as any
    delete withAmount.purchase_order.line_items[0].quantity
    withAmount.purchase_order.line_items[0].amount = '2000.00'
    expect(go(withAmount).decision).toBe('approve')
    const neither = bill({ qty: 6, history: [row('GS-2210', '800.00')] }) as any
    delete neither.purchase_order.line_items[0].quantity
    const r = go(neither)
    expect(r.decision).toBe('abstain')
    expect(balance(r)!.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['/purchase_order/line_items/0/quantity'] })
  })

  it('without a payment history the check does not run: no claim, and not_checked says why (the duplicate check already sends the bill to a person)', () => {
    const r = go(bill({ history: null }))
    expect(balance(r)).toBeUndefined()
    expect(r.decision).toBe('abstain')
    expect(r.not_checked).toContain('PO balance check: no payment history supplied, so what earlier bills already charged to this order is not known (pass payment_history to enable it)')
  })
})

describe('engines and paths', () => {
  it('engines up to 0.5.0 have no balance check: their verdicts are unchanged (the controller\'s case t4 approves there, as it did)', () => {
    const r = go(bill({ history: [row('GS-2210', '1200.00')] }), '0.5.0')
    expect(balance(r)).toBeUndefined()
    expect(r.decision).toBe('approve')
    expect(AP_REMEDIES.AP_PO_BALANCE).toBeUndefined()
    expect(AP_REMEDIES_V060.AP_PO_BALANCE?.abstain?.length).toBe(4)
  })

  it('the text path nets the same way (history rows with po_number and total)', () => {
    const text = readFileSync(join(HERE, 'fixtures', 'data', 'ap-three-way.txt'), 'utf8')
    const d = splitApLayout(text)!
    const quiet = verifyInvoiceMatch({ ...d, history: [{ invoice_number: 'ZZ-1', po_number: 'PO-1', total: 50 }] }, { now: NOW })
    expect(quiet.verdict.claims.find((c) => c.claim_id === 'ap.po_balance')!.outcome).toBe('PASS')
    const r = verifyInvoiceMatch({ ...d, history: [{ invoice_number: 'AJ-90001', po_number: 'PO-49051', total: 100000 }] }, { now: NOW })
    const c = r.verdict.claims.find((x) => x.claim_id === 'ap.po_balance')!
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toMatch(/^billed to date on PO-49051 would be [\d,]+\.\d\d, [\d,]+\.\d\d more than the order: already booked 100,000\.00 on PO-49051 \(AJ-90001\)/)
    expect(r.decision).toBe('hold_quantity') // the sample's own hold comes first
  })
})

describe('the price tolerance is a parameter of the verdict', () => {
  const t6 = (): ApStructuredInput => { const x = bill({ qty: 6 }) as any; x.bill.line_items[0] = { purchase_order_line_item_id: 'l1', quantity: 6, unit_price: '204.20', amount: '1225.20' }; x.bill.amount = '1225.20'; return x }
  it('2.1% over the PO price holds at the default 2%, approves at 3%, and the hold names the tolerance', () => {
    const held = go(t6())
    expect(held.decision).toBe('hold_price')
    expect(held.reasons[0]).toBe('400A panelboard: invoiced 204.2, PO 200 (max 204.0000 at the 2% price tolerance) — over tolerance.')
    const ok = verifyBillMatch(t6(), { now: NOW, policy: { price_tolerance: 0.03 } })
    expect(ok.decision).toBe('approve')
    expect(ok.verdict.input_hash).not.toBe(held.verdict.input_hash) // the tolerance is an input: it moves the verdict id
  })
  it('apPolicyOf fills the defaults and refuses a tolerance that is not a finite number of at least 0', () => {
    expect(apPolicyOf()).toEqual({ price_tolerance: 0.02, total_tolerance: 0.005 })
    expect(apPolicyOf({ price_tolerance: 0.05 })).toEqual({ price_tolerance: 0.05, total_tolerance: 0.005 })
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => apPolicyOf({ price_tolerance: bad })).toThrow(/finite number of at least 0/)
    expect(() => verifyBillMatch(t6(), { policy: { price_tolerance: Number.NaN } })).toThrow(/price_tolerance/)
  })
})

describe('the ap command', () => {
  afterAll(() => cleanScratch())
  let n = 0
  const dir = scratch('po-balance-')
  const file = (x: unknown): string => { const p = join(dir, `bill-${n++}.json`); writeFileSync(p, JSON.stringify(x)); return p }
  const cli = (argv: string[]) => { let out = '', err = ''; const code = run(argv, { out: (s) => { out += s }, err: (s) => { err += s } }) as number; return { code, out, err } }

  it("the controller's case exits 2 and the block names the booked invoice and the order", () => {
    const r = cli(['ap', '--input', file(bill({ history: [row('GS-2210', '1200.00')] }))])
    expect(r.code).toBe(2)
    expect(r.err).toContain('A PERSON DECIDES. Open first: the PO balance check (ap.po_balance) found more billed on the order than it totals.')
    expect(r.err).toContain('already booked 1,200.00 on PO-7001 (GS-2210); this bill 1,400.00; the order totals 2,000.00')
    expect(r.err).toContain('the buyer (buyer), for ap.po_balance, for this verdict only')
  })

  it('--price-tolerance moves the hold, the proof carries it, and a bad value is a usage error', () => {
    const x = bill({ qty: 6 }) as any
    x.bill.line_items[0] = { purchase_order_line_item_id: 'l1', quantity: 6, unit_price: '204.20', amount: '1225.20' }; x.bill.amount = '1225.20'
    const f = file(x)
    expect(cli(['ap', '--input', f]).code).toBe(1)
    for (const v of ['0.03', '3%']) {
      const r = cli(['ap', '--input', f, '--price-tolerance', v])
      expect(r.code, v).toBe(0)
      expect(JSON.parse(r.out).proof.inputs.policy).toEqual({ price_tolerance: 0.03, total_tolerance: 0.005 })
    }
    for (const bad of ['-0.1', '1.5', 'abc']) expect(cli(['ap', '--input', f, '--price-tolerance', bad]).code, bad).toBe(3)
    expect(cli(['ap', '--input', f, '--price-tolerance', '0.03', '--price-tolerance', '0.04']).err).toContain('--price-tolerance given twice')
    expect(cli(['ap', '--help']).err).toContain('--price-tolerance <fraction>')
  })

  it('two inputs on stdin are refused', () => {
    expect(cli(['ap', '-', '--history', '-']).err).toContain('only one input can be read from stdin (-)')
  })

  const DIST = join(HERE, '..', 'dist', 'cli.js')
  it.skipIf(!existsSync(DIST))('--history - reads the booked invoices from stdin (built CLI)', () => {
    const layout = join(HERE, 'fixtures', 'data', 'ap-three-way.txt')
    const r = spawnSync(process.execPath, [DIST, 'ap', layout, '--history', '-'], { input: '[{"invoice_number":"AJ-90001","po_number":"PO-49051","total":100000}]', encoding: 'utf8' })
    expect(r.status).toBe(1) // the sample's own hold_quantity comes first; the balance claim is in the verdict
    expect(r.stderr).toContain('the buyer (buyer), for ap.po_balance, for this verdict only')
    const c = JSON.parse(r.stdout).verdict.claims.find((x: { claim_id: string }) => x.claim_id === 'ap.po_balance')
    expect(c.explanation).toContain('already booked 100,000.00 on PO-49051 (AJ-90001)')
  })
})
