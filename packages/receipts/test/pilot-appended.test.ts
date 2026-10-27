/**
 * 2026-10-05: the synthetic month planted only classes the gate already checked, so "67 of 67 caught" was a mirror. It now
 * appends four bill classes the earlier checks never looked at (a bill from another vendor than its PO's, tax on a PO with no
 * tax terms, freight on a PO that does not say, a PO line billed again across bills) and one pay-application class (retainage
 * withheld under the stated rate), each from its own stream, so every earlier bill is unchanged. Also here: the Ramp mapper
 * reads expense lines beside inventory lines; the filled pre-registration holds no literal "<fill:"; the score sorts the
 * report's paid-bill figure; the report says what each stopped paid bill can be, once.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPENDED_PLANTS, PAYAPP_APPENDED, PLANT_GAP, freezePrereg, parsePrereg, preregTemplate, readExport, readPayApps, scoreSynth, scoreTable, synthMonth,
  writeSynthMonth, type PilotManifest,
} from '../src/index.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }

describe('synth: the appended classes', () => {
  // the month as it was on 2026-10-05 (the classes appended on 2026-10-06 are tested in pilot-appended-later.test.ts)
  const full = synthMonth({ month: '2026-09', bills: 300, seed: 11, payApps: 8, appendedLater: false })
  const old = synthMonth({ month: '2026-09', bills: 300, seed: 11, payApps: 8, appended: false, appendedLater: false })

  it('every bill, order and receipt of the month before is unchanged, byte for byte; the appended ones come after', () => {
    expect(full.bills.slice(0, old.bills.length)).toEqual(old.bills)
    expect(full.purchase_orders.slice(0, old.purchase_orders.length)).toEqual(old.purchase_orders)
    expect(full.item_receipts.slice(0, old.item_receipts.length)).toEqual(old.item_receipts)
    for (const [ref, p] of Object.entries(old.truth.planted)) expect(full.truth.planted[ref]).toEqual(p)
    for (const [f, doc] of Object.entries(old.pay_applications!)) expect(full.pay_applications![f]).toEqual(doc)
    expect(old.truth.bills).toBe(300)
  })

  it('three bills per class at 300 bills (one per 100), each labelled in the truth file with what it carries', () => {
    const by = (p: string) => Object.entries(full.truth.planted).filter(([, t]) => t.plant === p)
    for (const p of APPENDED_PLANTS) expect([p, by(p).length]).toEqual([p, 3])
    const bill = (ref: string): any => full.bills.find((b: any) => b.id === ref)
    const po = (id: string): any => full.purchase_orders.find((x: any) => x.id === id)
    for (const [ref, t] of by('vendor_mismatch')) {
      const b = bill(ref)
      expect(b.vendor.id).toBe(t.vendors!.bill.id)
      expect(po(b.purchase_order_id).vendor_id).toBe(t.vendors!.purchase_order.id)
      expect(t.vendors!.bill.id).not.toBe(t.vendors!.purchase_order.id)
      expect(t.expected).toBe('abstain')
    }
    for (const p of ['tax_on_untaxed_po', 'freight_po_silent'] as const) {
      for (const [ref, t] of by(p)) {
        const b = bill(ref)
        expect(b.line_items).toHaveLength(1)
        expect(b.line_items[0]).toMatchObject({ purchase_order_line_item_id: null, memo: t.charge!.memo })
        expect(b.line_items[0].amount.amount).toBe(Math.round(t.charge!.amount * 100))
        const lines = [...b.inventory_line_items, ...b.line_items].reduce((s: number, l: any) => s + l.amount.amount, 0)
        expect(b.amount.amount).toBe(lines) // the total carries the charge: the arithmetic holds
        expect(t.expected).toBe('abstain')
      }
    }
    for (const [ref, t] of by('line_overbilled_across_bills')) {
      const b = bill(ref), earlier = bill(t.overbill!.earlier_bill)
      expect(full.truth.planted[earlier.id]).toBeUndefined() // the earlier bill is a clean one
      expect(full.truth.buyer[earlier.id]).toBe('pay')
      expect(earlier.purchase_order_id).toBe(b.purchase_order_id)
      expect(earlier.inventory_line_items).toHaveLength(1)
      expect(earlier.inventory_line_items[0]).toMatchObject({ purchase_order_line_item_id: t.overbill!.po_line, quantity: t.overbill!.received })
      expect(b.inventory_line_items[0]).toMatchObject({ purchase_order_line_item_id: t.overbill!.po_line, quantity: t.overbill!.billed_now })
      expect(po(b.purchase_order_id).line_items.length).toBeGreaterThanOrEqual(2) // the order has other lines: room left on it
      expect(earlier.issued_at < b.issued_at).toBe(true)
      expect(t.gap).toBe(PLANT_GAP.line_overbilled_across_bills)
      expect(t.accepts).toEqual(['hold_quantity', 'hold_total', 'abstain'])
    }
    expect(full.truth.bills).toBe(Object.keys(full.truth.buyer).length)
    expect(full.truth.bills).toBe(300 + 5 * 3) // four classes, and the clean earlier bill of each billed-again pair
  })

  it('one appended contract per 8 pay applications: it states 10% retainage and withholds 5% on every line, the totals carried through', () => {
    const appended = Object.entries(full.truth.pay_apps!).filter(([, t]) => t.plant && (PAYAPP_APPENDED as readonly string[]).includes(t.plant))
    expect(appended).toHaveLength(1)
    const [file, t] = appended[0]!
    expect(t).toMatchObject({ plant: 'payapp_retainage_under', expected: 'person', retainage: { stated: '10%', withheld_rate: '5%' } })
    const doc: any = full.pay_applications![file]
    expect(doc.retainage_rate).toBe('10%')
    const sov = doc.schedule_of_values as any[]
    for (const l of sov) expect(Math.abs(l.retainage - l.completed_to_date / 20)).toBeLessThan(0.006)
    const sum = sov.reduce((s, l) => s + Math.round(l.retainage * 100), 0) / 100
    expect(Math.abs(doc.total_retainage - sum)).toBeLessThan(0.01 * sov.length)
    expect(Math.abs(doc.total_earned_less_retainage - (doc.total_completed_and_stored - doc.total_retainage))).toBeLessThan(0.006)
    expect(t.retainage!.under_by).toBeCloseTo(doc.total_completed_and_stored / 20, 1)
  })

  it('the export reads clean: no unmapped key, the appended contract and its previous application found', () => {
    const dir = tmp('pilot-appended-')
    writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills: 300, seed: 11, payApps: 8 })
    const r = readExport(join(dir, 'export'), 'ramp', { month: '2026-09' })
    expect([r.unmapped, r.missing]).toEqual([[], []])
    const apps = readPayApps(join(dir, 'export'))
    expect(apps.unmapped).toEqual([])
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'))
    const app = apps.apps.find((a) => truth.pay_apps[a.ref]?.plant === 'payapp_retainage_under')!
    expect(app.previous?.ref).toBe(truth.pay_apps[app.ref].previous)
  })
})

describe('the Ramp mapper reads expense lines beside inventory lines', () => {
  it('a bill with both: every line is on the structured input, the expense line with no PO line (before, it was dropped)', () => {
    const dir = tmp('pilot-ramp-lines-')
    const s = synthMonth({ month: '2026-09', bills: 100, seed: 5 })
    writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills: 100, seed: 5 })
    const r = readExport(join(dir, 'export'), 'ramp', { month: '2026-09' })
    const taxed = Object.entries(s.truth.planted).filter(([, t]) => t.plant === 'tax_on_untaxed_po').map(([ref]) => ref)
    expect(taxed.length).toBe(1)
    const raw: any = s.bills.find((b: any) => b.id === taxed[0])
    const mapped = r.bills.find((b) => b.ref === taxed[0])!
    expect(mapped.problem).toBeUndefined()
    // 2026-10-06 (the tax rule): an expense line whose whole memo names a tax is read as the bill's tax, as a freight
    // memo is read as its freight, so the frozen tax rule can decide it. It is still on the structured input, never dropped:
    // every inventory line is a bill line, and the tax expense line is bill.tax
    const lines = mapped.input!.bill.line_items
    expect(lines).toHaveLength(raw.inventory_line_items.length)
    expect(lines.some((l) => l.description === 'Sales tax')).toBe(false)
    const taxLine = raw.line_items.find((l: any) => l.memo === 'Sales tax')
    expect(mapped.input!.bill.tax).toEqual(taxLine.amount)
  })
})

describe('the filled pre-registration', () => {
  it('holds no literal "<fill:" once every blank is filled (the instruction line no longer carries one)', () => {
    const t = preregTemplate({ buyer: 'Acme', month: '2026-09', source: 'ramp' })
    expect(t).toContain('starts with "fill:"')
    const filled = t.replace(/<fill: the lowest[^>]*>/, '0.85').replace(/<fill: the highest[^>]*>/, '0.05').replace(/<fill: [^>]*>/g, '40')
    expect(filled).not.toContain('<fill:')
    expect(parsePrereg(filled).co_primary).toMatchObject({ bar: 0.05, sample_size: 40 })
    const dir = tmp('pilot-prereg-')
    writeFileSync(join(dir, 'p.md'), filled)
    expect(freezePrereg(join(dir, 'p.md'), () => new Date('2026-10-05T00:00:00Z')).params.buyer).toBe('Acme')
  })
})

describe('the score sorts the report\'s paid-bill figure by the truth file', () => {
  const manifest = (bills: { ref: string; buyer: 'pay' | 'hold' | 'open'; disposition: 'pay' | 'hold' | 'person' }[]): PilotManifest => ({
    month: '2026-09', bills: bills.map((b) => ({ ref: b.ref, buyer: { decision: b.buyer, from: 'status' }, disposition: b.disposition, gated: true, checker_decision: b.disposition === 'pay' ? 'approve' : b.disposition === 'hold' ? 'hold_price' : 'abstain', remedies: [], failed: [], open: [] })),
  } as unknown as PilotManifest)
  it('of the bills the team paid that the gate would stop: planted (caught) and clean (labour), and planted ones both would pay', () => {
    const m = manifest([
      { ref: 'a', buyer: 'pay', disposition: 'pay' }, { ref: 'b', buyer: 'pay', disposition: 'hold' }, { ref: 'c', buyer: 'pay', disposition: 'person' },
      { ref: 'd', buyer: 'pay', disposition: 'person' }, { ref: 'e', buyer: 'pay', disposition: 'pay' }, { ref: 'f', buyer: 'hold', disposition: 'hold' },
    ])
    const truth = { synthetic: true, month: '2026-09', seed: 1, bills: 6, buyer: { a: 'pay', b: 'pay', c: 'pay', d: 'pay', e: 'pay', f: 'hold' }, planted: {
      b: { plant: 'price_over', expected: 'hold_price' }, c: { plant: 'vendor_mismatch', expected: 'abstain' }, e: { plant: 'line_overbilled_across_bills', expected: 'hold_quantity', gap: PLANT_GAP.line_overbilled_across_bills }, f: { plant: 'price_over', expected: 'hold_price' },
    } } as any
    const s = scoreSynth(m, truth)
    expect(s.paid_by_team).toEqual({ bills: 5, stopped: 3, stopped_planted: 2, stopped_clean: 1, planted_paid_by_both: 1 })
    const table = scoreTable(s)
    expect(table.split('\n')[1]).toBe('the report\'s "would have stopped 3 of the 5 bills your team paid", sorted by the truth file: 2 are planted problems the synthetic team paid by mistake (caught), 1 is a good bill held up (labour); 1 planted problem(s) the team paid would have been paid by the gate too')
    expect(table).toContain('<- PAID (a gap the check states, below)')
    expect(table).toContain(`a gap the check states, line_overbilled_across_bills: ${PLANT_GAP.line_overbilled_across_bills}`)
  })
  it('a freight plant\'s right answer follows the run\'s frozen freight rule: a person under "person", paid under "allow"', () => {
    const truth = { synthetic: true, month: '2026-09', seed: 1, bills: 2, buyer: { a: 'pay', b: 'pay' }, planted: {
      a: { plant: 'freight_po_silent', expected: 'abstain', by_freight_rule: { person: 'abstain', allow: 'approve' } },
      b: { plant: 'freight_po_silent', expected: 'abstain', by_freight_rule: { person: 'abstain', allow: 'approve' } },
    } } as any
    const paid = manifest([{ ref: 'a', buyer: 'pay', disposition: 'pay' }, { ref: 'b', buyer: 'pay', disposition: 'pay' }])
    const allow = scoreSynth({ ...paid, freight: 'allow' } as PilotManifest, truth)
    expect(allow.classes.freight_po_silent).toMatchObject({ expected: 'approve', pay: 2, wrong_pay: 0, as_expected: 2 })
    expect(allow.wrong_pay).toBe(0)
    const person = scoreSynth(paid, truth) // a run that records no rule read "person"
    expect(person.classes.freight_po_silent).toMatchObject({ expected: 'abstain', pay: 2, wrong_pay: 2, as_expected: 0 })
  })
})
