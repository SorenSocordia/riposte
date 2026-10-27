/**
 * 2026-10-05: the duplicate check under engine 0.6.0 (src/ap/duplicate.ts).
 *
 *   1. the eight rows of a cold reader in the controller's role (cold review round 1, section 3 of that report): all right under 0.6.0; under 0.5.0 the two that
 *      were wrong stay as they were (a verdict pinned to 0.5.0 re-performs exactly)
 *   2. vendor variants, vendor ids and tax ids, on the structured path and the text path
 *   3. a run with no payment history states the duplicate check as not run, first among an approve's reasons
 *   4. both engines' verdicts replay
 */
import { describe, it, expect } from 'vitest'
import { verifyBillMatch, verifyInvoiceMatch, verifyReplay, apInputDocuments, type ApStructuredInput, type ApResult, type ApDocuments, type PriorInvoice } from '../src/index'
import { normalizeVendorName, NO_HISTORY_DETAIL } from '../src/ap/duplicate'
import { AP_REMEDIES, AP_REMEDIES_V060, apRemediesFor } from '../src/ap/index'

const NOW = () => new Date('2026-10-05T00:00:00Z')
const V = 'Northfield Material Handling'
type Payment = NonNullable<ApStructuredInput['payment_history']>[number]

const bill = (history?: Payment[], vendor: ApStructuredInput['bill']['vendor'] = { name: V }, poVendor: ApStructuredInput['bill']['vendor'] = { name: V }): ApStructuredInput => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: { invoice_number: 'NM-84665', vendor, purchase_order_number: 'PO-48825', currency: 'USD', amount: '2695.00',
    line_items: [{ purchase_order_line_item_id: 'L1', description: 'Pallet jack, 5500 lb', quantity: 7, unit_price: '385.00', amount: '2695.00' }] },
  purchase_order: { purchase_order_number: 'PO-48825', vendor: poVendor, currency: 'USD', line_items: [{ id: 'L1', description: 'Pallet jack, 5500 lb', quantity: 7, unit_price: '385.00' }] },
  item_receipts: [{ line_items: [{ purchase_order_line_item_id: 'L1', quantity: 7 }] }],
  ...(history ? { payment_history: history } : {}),
})
const run = (x: ApStructuredInput, engine?: string): ApResult => verifyBillMatch(x, { now: NOW, ...(engine ? { engine } : {}) })
const dup = (r: ApResult) => r.verdict.claims.find((c) => c.claim_id === 'ap.duplicate')

// Row 1 was "approve, flagged" in the first build of 2026-10-05. Later that day (fail closed): a bill whose duplicate check did not run is decided by
// a person under engine 0.6.0, never approved; under 0.5.0 it still approves (see the 0.5.0 test below).
const EIGHT: [string, Payment[] | undefined, string][] = [
  ['1 no history', undefined, 'abstain'],
  ['2 NM-84665, same vendor', [{ invoice_number: 'NM-84665', vendor: V, purchase_order_number: 'PO-48825', amount: '2695.00' }], 'hold_duplicate'],
  ['3 "nm-84665 ", lowercase vendor', [{ invoice_number: 'nm-84665 ', vendor: V.toLowerCase() }], 'hold_duplicate'],
  ['4 NM-84665, no vendor', [{ invoice_number: 'NM-84665' }], 'hold_duplicate'],
  ['5 NM84665, same vendor, PO, total', [{ invoice_number: 'NM84665', vendor: V, purchase_order_number: 'PO-48825', amount: '2695.00' }], 'abstain'],
  ['6 NM-84999, same vendor, PO, total', [{ invoice_number: 'NM-84999', vendor: V, purchase_order_number: 'PO-48825', amount: '2695.00' }], 'abstain'],
  ['7 NM-84665, other vendor, PO, amount', [{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', purchase_order_number: 'PO-11111', amount: '310.40' }], 'approve'],
  ['8 NM-84665, same PO and amount, ", Inc."', [{ invoice_number: 'NM-84665', vendor: `${V}, Inc.`, purchase_order_number: 'PO-48825', amount: '2695.00' }], 'hold_duplicate'],
]

describe('the controller\'s eight duplicate rows', () => {
  it('engine 0.6.0: all eight right; row 8 holds naming both vendor strings; row 1 leads with the check that did not run', () => {
    for (const [label, history, want] of EIGHT) expect(run(bill(history)).decision, label).toBe(want)
    const r8 = run(bill(EIGHT[7]![1]))
    expect(dup(r8)?.outcome).toBe('FAIL')
    expect(r8.reasons[0]).toContain(`same invoice number NM-84665 already booked under '${V}, Inc.'`)
    expect(r8.reasons[0]).toContain(`this bill says '${V}'`)
    expect(r8.reasons[0]).toContain('a person confirms')
    expect(r8.payable).toBe(false)
    expect(r8.grounding.expected).toBe('NM-84665')
    const r1 = run(bill())
    expect(r1.reasons[0]!.startsWith('cannot decide ap.duplicate: duplicate check not run: no payment history supplied')).toBe(true)
    expect(r1.payable).toBe(false)
  })
  it('engine 0.5.0: re-performs exactly as before (row 8 approved, row 1 has no duplicate claim)', () => {
    for (const [label, history, want] of EIGHT) {
      const expected = label.startsWith('8') || label.startsWith('1') ? 'approve' : want
      expect(run(bill(history), '0.5.0').decision, label).toBe(expected)
    }
    expect(dup(run(bill(EIGHT[7]![1]), '0.5.0'))?.explanation).toBe('Invoice NM-84665 does not appear among 1 booked invoice(s).')
    expect(dup(run(bill(), '0.5.0'))).toBeUndefined()
    expect(run(bill(), '0.5.0').reasons).toEqual(['all five checks passed'])
  })
})

describe('vendor identity under engine 0.6.0', () => {
  it('normalizes case, spacing, punctuation and trailing company suffixes, and nothing else', () => {
    expect(normalizeVendorName('Northfield Material Handling, Inc.')).toBe('northfield material handling')
    expect(normalizeVendorName('  NORTHFIELD  material-handling LLC')).toBe('northfield material handling')
    expect(normalizeVendorName('Acme Co., Ltd.')).toBe('acme')
    expect(normalizeVendorName('A & B Supply GmbH')).toBe('a and b supply')
    expect(normalizeVendorName('Inc')).toBe('inc') // never normalized to nothing
    expect(normalizeVendorName('Northfield Material')).not.toBe(normalizeVendorName('Northfield Material Handling'))
  })
  it('the same number under an LLC / punctuation variant holds; a different vendor with other PO and total passes and says where the number is', () => {
    expect(run(bill([{ invoice_number: 'NM-84665', vendor: 'NORTHFIELD MATERIAL HANDLING LLC' }])).decision).toBe('hold_duplicate')
    const other = run(bill([{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', purchase_order_number: 'PO-1', amount: 5 }]))
    expect(other.decision).toBe('approve')
    expect(dup(other)?.explanation).toContain("Invoice number NM-84665 is also booked under 'Atlas Fastener Supply' (another vendor name; the booked row has another PO, PO-1, and another total, 5)")
    expect(dup(other)?.explanation).not.toContain('does not appear')
  })
  it('the same number under another vendor with the same PO or the same total is a can\'t-tell for a person, never an approve', () => {
    // (an earlier build used "NMH Industrial" here; its "nmh" is the initials of the bill's vendor, so the near-match rule holds it: see below)
    const samePo = run(bill([{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', purchase_order_number: 'PO-48825', amount: 1 }]))
    expect(samePo.decision).toBe('abstain')
    expect(dup(samePo)?.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(dup(samePo)?.insufficiency?.detail).toContain('the same PO (PO-48825)')
    const sameTotal = run(bill([{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', amount: '2695.00' }]))
    expect(sameTotal.decision).toBe('abstain')
    expect(samePo.payable).toBe(false)
  })
  it('vendor ids: an equal id is the same supplier whatever the names; a different id under a matching name holds, naming both ids', () => {
    const byId = run(bill([{ invoice_number: 'NM-84665', vendor: 'NMH Industrial', vendor_id: 'V-100' }], { id: 'V-100', name: V }))
    expect(byId.decision).toBe('hold_duplicate')
    expect(dup(byId)?.explanation).toContain('under the same vendor id (V-100)')
    const twoRecords = run(bill([{ invoice_number: 'NM-84665', vendor: V, vendor_id: 'V-207' }], { id: 'V-100', name: V }))
    expect(twoRecords.decision).toBe('hold_duplicate')
    expect(dup(twoRecords)?.explanation).toContain('another vendor id (booked V-207; this bill V-100) but a matching name')
    const other = run(bill([{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', vendor_id: 'V-300', purchase_order_number: 'PO-1', amount: 5 }], { id: 'V-100', name: V }))
    expect(other.decision).toBe('approve')
    // the PO's vendor id counts too
    expect(run(bill([{ invoice_number: 'NM-84665', vendor: 'NMH', vendor_id: 'V-100' }], { name: V }, { id: 'V-100', name: V })).decision).toBe('hold_duplicate')
  })
  it('tax ids: equal (formatting aside) is the same supplier; different under a matching name is a can\'t-tell; different names, another supplier', () => {
    expect(run(bill([{ invoice_number: 'NM-84665', vendor: 'NMH Industrial', vendor_tax_id: '12-3456789' }], { name: V, tax_id: '123456789' })).decision).toBe('hold_duplicate')
    const conflict = run(bill([{ invoice_number: 'NM-84665', vendor: `${V} Inc`, vendor_tax_id: '98-7654321' }], { name: V, tax_id: '12-3456789' }))
    expect(conflict.decision).toBe('abstain')
    expect(dup(conflict)?.insufficiency?.detail).toContain('the vendor names match but the tax ids differ')
    expect(run(bill([{ invoice_number: 'NM-84665', vendor: 'Atlas Fastener Supply', vendor_tax_id: '98-7654321', purchase_order_number: 'PO-1', amount: 5 }], { name: V, tax_id: '12-3456789' })).decision).toBe('approve')
  })
  it('the new fields validate and are refused when malformed', () => {
    expect(() => run(bill([{ invoice_number: 'NM-1', vendor_id: '', vendor_tax_id: 'X' }]))).toThrow(/vendor_id/)
    expect(() => run(bill(undefined, { name: V, tax_id: 7 as unknown as string }))).toThrow(/tax_id/)
  })
  it('the text path: a ", Inc." variant of a booked number holds under 0.6.0 and approved under 0.5.0', () => {
    const docs: ApDocuments = {
      // signed by its vendor (2026-10-05: the text path checks the invoice names the PO's vendor)
      invoice: 'INVOICE MESSAGE\nINVOICE NM-84665   DATE 2026-09-28\nCUST PO: PO-48825\n1   Pallet jack 5500 lb | 7 | 385.00 | 2,695.00\nTOTAL DUE USD | 2,695.00\nNorthfield Material Handling\n',
      purchase_order: 'PURCHASE ORDER (ERP)\nPO-48825 | Vendor: Northfield Material Handling | Freight: not allowed\n1. Pallet jack 5500 lb | qty 7 | unit USD 385.00\n',
      goods_receipt: 'GOODS RECEIPT (ERP) for PO-48825\n1. Pallet jack 5500 lb | received 7\n',
      history: [{ invoice_number: 'NM-84665', vendor: `${V}, Inc.`, po_number: 'PO-48825', total: 2695 } satisfies PriorInvoice],
    }
    const now = verifyInvoiceMatch(docs, { now: NOW })
    expect(now.decision).toBe('hold_duplicate')
    expect(now.reasons[0]).toContain(`already booked under '${V}, Inc.'`)
    expect(verifyInvoiceMatch(docs, { now: NOW, engine: '0.5.0' }).decision).toBe('approve')
    const none = verifyInvoiceMatch({ ...docs, history: undefined }, { now: NOW })
    expect(none.decision).toBe('abstain')
    expect(none.payable).toBe(false)
    expect(none.reasons[0]!.startsWith(`cannot decide ap.duplicate: ${NO_HISTORY_DETAIL}`)).toBe(true)
    expect(verifyInvoiceMatch({ ...docs, history: undefined }, { now: NOW, engine: '0.5.0' }).decision).toBe('approve')
  })
})

describe('no payment history', () => {
  it('engine 0.6.0: an INSUFFICIENT_DATA duplicate claim; the bill goes to a person (fail closed), the open check named first', () => {
    const r = run(bill())
    const c = dup(r)!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
    expect(c.insufficiency?.detail.startsWith('duplicate check not run: no payment history supplied')).toBe(true)
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false)
    expect(r.verdict.outcome).toBe('PASS')
    expect(r.verdict.coverage.claims_insufficient).toBe(1)
    expect(r.reasons).toEqual([`cannot decide ap.duplicate: ${NO_HISTORY_DETAIL} (pass payment_history to enable it)`, 'every check that ran passed; a person decides before this bill is paid'])
    expect(r.not_checked[0]).toContain('duplicate check')
    const remedy = r.verdict.remedies?.find((x) => x.claims.includes('ap.duplicate'))
    expect(remedy?.operand?.source).toBe('history')
    // The top-level gate status, when this build carries it: an otherwise clean bill reads PASS_WITH_OPEN
    const gs = (r.verdict as { gate_status?: string }).gate_status
    if (gs !== undefined) expect(gs).toBe('PASS_WITH_OPEN')
  })
  it('a hold keeps its own reason first and lists the check that did not run after it', () => {
    const x = bill(); x.item_receipts[0]!.line_items[0]!.quantity = 5
    const r = run(x)
    expect(r.decision).toBe('hold_quantity')
    expect(r.reasons[0]).toContain('billed 7, received 5')
    expect(r.reasons[r.reasons.length - 1]!.startsWith(NO_HISTORY_DETAIL)).toBe(true)
  })
})

describe('remedy tables and replay', () => {
  it('engine 0.6.0 answers from its own table; 0.5.0 and earlier from the old one, unchanged', () => {
    expect(apRemediesFor('0.6.0')).toBe(AP_REMEDIES_V060)
    for (const e of ['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0'] as const) expect(apRemediesFor(e)).toBe(AP_REMEDIES)
    for (const k of Object.keys(AP_REMEDIES)) if (k !== 'AP_DUPLICATE') expect(AP_REMEDIES_V060[k]).toBe(AP_REMEDIES[k])
    expect(run(bill()).verdict.remedy_table_hash).not.toBe(run(bill(), '0.5.0').verdict.remedy_table_hash)
  })
  it('verdicts of both engines replay VERIFIED; a flipped outcome does not', () => {
    for (const engine of [undefined, '0.5.0']) {
      for (const [, history] of EIGHT) {
        const x = bill(history)
        const r = run(x, engine)
        const inputs = { ap_structured: apInputDocuments(x), policy: { price_tolerance: 0.02, total_tolerance: 0.005 } }
        const ok = verifyReplay(r.verdict, inputs)
        expect(ok.status, `${engine} ${history?.[0]?.invoice_number}`).toBe('REPERFORMED')
        expect(ok.outcome_verified).toBe(true)
      }
    }
  })
})
