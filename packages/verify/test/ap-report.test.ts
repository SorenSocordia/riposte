/**
 * 2026-10-05: the AP decision in plain words (src/ap/report.ts), the block the CLI prints beside the
 * JSON. Rendering only: the result is unchanged by it.
 */
import { describe, it, expect } from 'vitest'
import { verifyInvoiceMatch, verifyBillMatch, apInputDocuments, canonicalize, type ApDocuments, type ApStructuredInput } from '../src/index'
import { formatApReport } from '../src/ap/report'

const NOW = () => new Date('2026-10-05T00:00:00Z')
const docs: ApDocuments = {
  // signed by its vendor (2026-10-05: the text path checks the invoice names the PO's vendor)
  invoice: 'INVOICE MESSAGE\nINVOICE AJ-97466   DATE 2026-09-28\nCUST PO: PO-49051\n1   GREASE CART 14OZ | 10 | 6.95 | 69.50\nTOTAL DUE USD | 69.50\nRidgeline Supply\n',
  purchase_order: 'PURCHASE ORDER (ERP)\nPO-49051 | Vendor: Ridgeline Supply | Freight: not allowed\n1. Machine grease cartridge 14 oz | qty 10 | unit USD 6.95\n',
  goods_receipt: 'GOODS RECEIPT (ERP) for PO-49051\n1. Machine grease cartridge 14 oz | received 7\n',
}

describe('formatApReport', () => {
  it('a hold: the decision, the reason, and the exact lines it read from each document', () => {
    const r = verifyInvoiceMatch(docs, { now: NOW })
    const before = canonicalize(r)
    const s = formatApReport(r, { documents: docs })
    expect(canonicalize(r)).toBe(before)
    const lines = s.split('\n')
    expect(lines[0]).toBe('HOLD: hold_quantity. Do not pay.')
    expect(lines[1]).toBe('Invoice AJ-97466 · PO PO-49051')
    expect(s).toContain('billed 10, received 7')
    expect(s).toContain('Grounding: item "Machine grease cartridge 14 oz", billed 10, received 7') // the reason's word, not "expected"
    expect(s).not.toContain('expected 7')
    expect(s).toContain('invoice, line 4: "1 GREASE CART 14OZ | 10 | 6.95 | 69.50"')
    expect(s).toContain('goods receipt, line 2: "1. Machine grease cartridge 14 oz | received 7"')
    expect(s).toMatch(/Checks: \d+ passed, 1 failed, 1 could not run\./)
    expect(s.endsWith('The full verdict is the JSON on stdout.\n')).toBe(true)
  })
  it('a bill with no payment history: a person decides, the duplicate check named first, the lines the other checks read shown', () => {
    const x: ApStructuredInput = {
      schema: 'riposte.ap-input/0.1.0',
      bill: { invoice_number: 'NM-84665', vendor: { name: 'Northfield Material Handling' }, purchase_order_number: 'PO-48825', currency: 'USD', amount: '2695.00',
        line_items: [{ purchase_order_line_item_id: 'L1', description: 'Pallet jack', quantity: 7, unit_price: '385.00', amount: '2695.00' }] },
      purchase_order: { purchase_order_number: 'PO-48825', currency: 'USD', line_items: [{ id: 'L1', unit_price: '385.00' }] },
      item_receipts: [{ line_items: [{ purchase_order_line_item_id: 'L1', quantity: 7 }] }],
    }
    const s = formatApReport(verifyBillMatch(x, { now: NOW }), { documents: apInputDocuments(x), jsonNote: '' })
    const lines = s.split('\n')
    expect(lines[0]).toBe('A PERSON DECIDES. Open first: the duplicate check (ap.duplicate) did not run. Do not pay this bill automatically.')
    expect(lines[3]).toMatch(/^ {2}- cannot decide ap\.duplicate: duplicate check not run: no payment history supplied/)
    expect(s).toContain('Lines read (the open check read none; these are the lines the checks that ran read):')
    expect(s).toContain('invoice /bill/line_items/0/quantity = 7')
    expect(s).toContain('What would settle it:\n  - The payment history')
    expect(s).not.toContain('JSON on stdout')
    // the same bill against a known, empty book approves, and its block still shows the lines read
    const a = formatApReport(verifyBillMatch({ ...x, payment_history: [] }, { now: NOW }), { documents: apInputDocuments({ ...x, payment_history: [] }) })
    expect(a.split('\n')[0]).toBe('APPROVE. Every check that ran passed.')
    expect(a).toContain('the payment history supplied is empty')
    // 2026-10-05: both vendors print first on every answer; this PO names none, and the block says so
    expect(a).toContain('Lines read:\n  - invoice /bill/vendor = "Northfield Material Handling"\n  - purchase order /purchase_order/vendor = none (the purchase order names no vendor)\n  - invoice /bill/invoice_number = "NM-84665"')
  })
  it('a hold says who may clear it, from the verdict\'s own remedies', () => {
    const r = verifyInvoiceMatch(docs, { now: NOW })
    expect(formatApReport(r, { documents: docs })).toMatch(/Who may clear it:\n {2}- the buyer \(buyer\), for ap\.line\[1\]\.quantity, for this verdict only/)
  })
  it('a structured hold quotes JSON Pointers with the values read', () => {
    const x: ApStructuredInput = {
      schema: 'riposte.ap-input/0.1.0',
      bill: { invoice_number: 'NM-1', vendor: { name: 'V' }, purchase_order_number: 'PO-1', amount: 100, line_items: [{ purchase_order_line_item_id: 'L1', quantity: 10, unit_price: 10, amount: 100 }] },
      purchase_order: { purchase_order_number: 'PO-1', line_items: [{ id: 'L1', unit_price: 10 }] },
      item_receipts: [{ line_items: [{ purchase_order_line_item_id: 'L1', quantity: 8 }] }],
      payment_history: [],
    }
    const s = formatApReport(verifyBillMatch(x, { now: NOW }), { documents: apInputDocuments(x) })
    expect(s.split('\n')[0]).toBe('HOLD: hold_quantity. Do not pay.')
    expect(s).toContain('invoice /bill/line_items/0/quantity = 10')
    expect(s).toContain('item receipt /item_receipts/0/line_items/0/quantity = 8')
  })
})
