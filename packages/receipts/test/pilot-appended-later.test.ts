/**
 * The synthetic month's classes appended on 2026-10-06, for the checks the gate gained that day: a paid bill
 * re-sent with a leading zero in its invoice number; tax at exactly 8.25% and at 9.5% on a PO with no tax terms, with what each
 * tax rule makes of it (by_tax_rule, on the earlier tax plants too); a pay application whose scheduled value rose with no change
 * order; and two legitimate applications the gate must pay (a new change-order line; stored materials written as the form's
 * column D says). Each comes from its own stream after everything before it, so every earlier bill and application is what it
 * was. The same month can be written in generic CSV columns, with each PO line's invoiced quantity, where a line billed again
 * across bills is caught. Not planted here: a request to change bank details and a look-alike sender, which only the emailed-bill
 * path reads (structured exports carry no free text for them).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPENDED_LATER_PLANTS, PAYAPP_APPENDED_LATER, SYNTH_TAX_RATE, pilotCli, readExport, readPayApps, scoreSynth, synthMonth, synthMonthCsv, taxRuleAnswers,
  writeSynthMonth, type PilotManifest, type SynthTruth,
} from '../src/index.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
const OPTS = { month: '2026-09', bills: 300, seed: 11, payApps: 8 }

describe('synth: the classes appended on 2026-10-06', () => {
  const full = synthMonth(OPTS)
  const before = synthMonth({ ...OPTS, appendedLater: false })

  it('every bill, order, receipt and application of the month before is unchanged; the new ones come after', () => {
    expect(full.bills.slice(0, before.bills.length)).toEqual(before.bills)
    expect(full.purchase_orders.slice(0, before.purchase_orders.length)).toEqual(before.purchase_orders)
    expect(full.item_receipts.slice(0, before.item_receipts.length)).toEqual(before.item_receipts)
    for (const [f, doc] of Object.entries(before.pay_applications!)) expect(full.pay_applications![f]).toEqual(doc)
    for (const [ref, p] of Object.entries(before.truth.planted)) expect(full.truth.planted[ref]).toEqual(p)
    expect(full.truth.bills).toBe(before.truth.bills + 4 * 3) // three classes, and the paid original of each re-sent bill
  })

  it('three bills per class at 300 bills, each labelled with what it carries', () => {
    const by = (p: string) => Object.entries(full.truth.planted).filter(([, t]) => t.plant === p)
    for (const p of APPENDED_LATER_PLANTS) expect([p, by(p).length]).toEqual([p, 3])
    const bill = (ref: string): any => full.bills.find((b: any) => b.id === ref)
    for (const [ref, t] of by('duplicate_leading_zero')) {
      const b = bill(ref), original = bill(t.repeats!.bill)
      expect(full.truth.planted[original.id]).toBeUndefined()
      expect(full.truth.buyer[original.id]).toBe('pay')
      expect(b.invoice_number).toBe(t.repeats!.sent_as)
      expect(b.invoice_number).toBe(String(original.invoice_number).replace('-', '-0'))
      expect([b.vendor, b.purchase_order_id, b.amount]).toEqual([original.vendor, original.purchase_order_id, original.amount])
      expect(original.issued_at < b.issued_at).toBe(true)
      expect(t).toMatchObject({ expected: 'abstain', accepts: ['abstain', 'hold_duplicate', 'hold_total'], clear_by: 'ap-clerk' })
    }
    for (const [p, rate] of [['tax_at_rate', SYNTH_TAX_RATE], ['tax_off_rate', 0.095]] as const) {
      for (const [ref, t] of by(p)) {
        const b = bill(ref)
        const sub = b.inventory_line_items.reduce((s: number, l: any) => s + l.amount.amount, 0)
        expect(b.line_items).toEqual([expect.objectContaining({ purchase_order_line_item_id: null, memo: 'Sales tax', amount: expect.objectContaining({ amount: Math.round(sub * rate) }) })])
        expect(t.by_tax_rule).toEqual({ person: 'abstain', allow: 'approve', 'rate:8.25%': p === 'tax_at_rate' ? 'approve' : 'abstain' })
      }
    }
    // the earlier tax plants carry what each rule makes of them too (the bills are unchanged)
    for (const [, t] of by('tax_on_untaxed_po')) expect(Object.keys(t.by_tax_rule!)).toEqual(['person', 'allow', 'rate:8.25%'])
  })

  // 2026-10-06: the truth file answers as the gate checks, to the cent (one cent per taxable line), never within the price tolerance
  it('taxRuleAnswers: 8.25% of the lines to the cent, one cent of rounding per taxable line, pays under the rate rule; anything else is a person', () => {
    expect(taxRuleAnswers(825, 10000)).toEqual({ person: 'abstain', allow: 'approve', 'rate:8.25%': 'approve' })
    expect(taxRuleAnswers(826, 10000, 1)['rate:8.25%']).toBe('approve') // a cent over, one taxable line
    expect(taxRuleAnswers(827, 10000, 1)['rate:8.25%']).toBe('abstain') // two cents over, one taxable line
    expect(taxRuleAnswers(827, 10000, 3)['rate:8.25%']).toBe('approve') // two cents over, three taxable lines
    expect(taxRuleAnswers(840, 10000, 3)['rate:8.25%']).toBe('abstain') // 1.8% over: within the price tolerance, not rounding
    expect(taxRuleAnswers(950, 10000)['rate:8.25%']).toBe('abstain')
  })

  it('one contract per pay-application class, each consistent on its own; the change is the one its class says', () => {
    const later = Object.entries(full.truth.pay_apps!).filter(([, t]) => t.plant && (PAYAPP_APPENDED_LATER as readonly string[]).includes(t.plant))
    expect(later.map(([, t]) => [t.plant, t.expected])).toEqual([['payapp_sov_raised', 'person'], ['payapp_new_co_line', 'pay'], ['payapp_stored_formD', 'pay']])
    for (const [file, t] of later) {
      const cur: any = full.pay_applications![file], prev: any = full.pay_applications![t.previous]
      for (const doc of [cur, prev]) {
        for (const l of doc.schedule_of_values) expect(Math.abs(l.completed_to_date - (l.previous + l.this_period + l.materials_stored))).toBeLessThan(0.006)
        expect(Math.abs(doc.contract_sum_to_date - (doc.original_contract_sum + doc.net_change_orders))).toBeLessThan(0.006)
        const g = doc.schedule_of_values.reduce((s: number, l: any) => s + l.completed_to_date, 0)
        expect(Math.abs(doc.total_completed_and_stored - g)).toBeLessThan(0.01 * doc.schedule_of_values.length)
      }
      expect(cur.less_previous_certificates).toBeCloseTo(prev.total_earned_less_retainage, 2)
      const n = prev.schedule_of_values.length
      if (t.plant === 'payapp_sov_raised') {
        const L = cur.schedule_of_values[t.change!.line - 1], P = prev.schedule_of_values[t.change!.line - 1]
        expect(cur.schedule_of_values).toHaveLength(n)
        expect(L.scheduled_value - P.scheduled_value).toBeCloseTo(t.change!.by!, 2)
        expect(cur.net_change_orders - prev.net_change_orders).toBeCloseTo(t.change!.by!, 2)
      }
      if (t.plant === 'payapp_new_co_line') {
        expect(cur.schedule_of_values).toHaveLength(n + 1)
        const L = cur.schedule_of_values[n]
        expect(L).toMatchObject({ previous: 0, materials_stored: 0, scheduled_value: t.change!.scheduled_value })
        expect(cur.net_change_orders).toBeCloseTo(t.change!.scheduled_value!, 2)
      }
      if (t.plant === 'payapp_stored_formD') {
        const j = t.change!.line - 1, L = cur.schedule_of_values[j], P = prev.schedule_of_values[j]
        expect(P.materials_stored).toBeCloseTo(t.change!.stored_last_month!, 2)
        expect(P.materials_stored).toBeGreaterThan(0)
        expect(L.previous).toBeCloseTo(P.previous + P.this_period, 2) // column D as the form's heading says: last month's D + E
        expect(L.materials_stored).toBe(0)
        expect(L.this_period).toBeGreaterThanOrEqual(P.materials_stored) // installed this month
      }
    }
  })
})

describe('the same month in generic CSV columns', () => {
  it('reads clean as generic-csv, carries each PO line\'s invoiced quantity, and says what reads differently there', () => {
    const dir = tmp('pilot-csv-')
    const t = writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { ...OPTS, format: 'generic-csv' })
    expect(t.format).toBe('generic-csv')
    const r = readExport(join(dir, 'export'), 'generic-csv', { month: '2026-09' })
    expect([r.unmapped, r.missing]).toEqual([[], []])
    expect(r.notes.join(' ')).toContain('invoiced_quantity')
    const ramp = synthMonth(OPTS)
    expect(r.bills.length).toBe(ramp.bills.length) // every bill of the export, as the Ramp shape holds them (shadow keeps the month's)
    expect(readPayApps(join(dir, 'export')).apps.length).toBeGreaterThan(0)
    const csv = synthMonthCsv(ramp)
    expect(csv.files['purchase_orders.csv'].split('\n')[0]).toBe('ref,number,vendor,currency,line_id,item,description,quantity,rate,amount,invoiced_quantity')
    for (const [ref, p] of Object.entries(csv.truth.planted)) {
      if (p.plant === 'line_overbilled_across_bills') expect([p.expected, p.gap]).toEqual(['abstain', undefined])
      else if (p.plant === 'freight_po_silent') expect(p.by_freight_rule).toEqual({ person: 'abstain', allow: 'abstain' })
      else expect(p).toEqual(ramp.truth.planted[ref])
    }
  })

  it('end to end on 100 bills: every planted bill stopped, the line billed again caught, no clean bill stopped', () => {
    const dir = tmp('pilot-csv-e2e-')
    expect(pilotCli(['synth', '--out', dir, '--month', '2026-09', '--bills', '100', '--seed', '5', '--format', 'generic-csv']).code).toBe(0)
    const pf = join(dir, 'PREREG.md')
    expect(pilotCli(['prereg', 'init', pf, '--buyer', 'Synthetic Co.', '--month', '2026-09', '--source', 'generic-csv']).code).toBe(0)
    const fill = (s: string) => s.replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.8').replace('<fill: how many would-holds a person audits, e.g. 40>', '10')
      .replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', '0.05').replace('<fill: how many would-pays a person audits, e.g. 75>', '10')
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(pf, fill(readFileSync(pf, 'utf8')))
    expect(pilotCli(['prereg', 'freeze', pf, '--now', '2026-10-06T07:00:00Z']).code).toBe(0)
    const s = pilotCli(['shadow', '--export', join(dir, 'export'), '--source', 'generic-csv', '--month', '2026-09', '--prereg', pf, '--out', join(dir, 'run'), '--key-here', '--now', '2026-10-06T08:00:00Z'])
    expect(s.code).toBe(0)
    const manifest = JSON.parse(readFileSync(join(dir, 'run', 'pilot-run.json'), 'utf8')) as PilotManifest
    const truth = JSON.parse(readFileSync(join(dir, 'synthetic-truth.json'), 'utf8')) as SynthTruth
    const sc = scoreSynth(manifest, truth)
    expect([sc.wrong_pay, sc.clean_stopped, sc.unmatched]).toEqual([0, 0, []])
    expect(sc.classes.line_overbilled_across_bills).toMatchObject({ planted: 1, pay: 0 })
    expect(sc.classes.duplicate_leading_zero).toMatchObject({ planted: 1, pay: 0, as_expected: 1 })
  })
})

describe('the score: a legitimate application is expected to pay', () => {
  it('paying it is right; holding it is labour, counted with the clean applications', () => {
    const truth = { synthetic: true, month: '2026-09', seed: 1, bills: 0, planted: {}, buyer: {},
      pay_apps: {
        'a.json': { plant: null, expected: 'pay', buyer: 'pay', previous: 'p.json' },
        'b.json': { plant: 'payapp_new_co_line', expected: 'pay', buyer: 'pay', previous: 'p.json' },
        'c.json': { plant: 'payapp_stored_formD', expected: 'pay', buyer: 'pay', previous: 'p.json' },
        'd.json': { plant: 'payapp_sov_raised', expected: 'person', buyer: 'pay', previous: 'p.json' },
      } } as unknown as SynthTruth
    const app = (ref: string, disposition: 'pay' | 'hold' | 'person') => ({ ref, disposition, failed: [] })
    const m = { month: '2026-09', bills: [], pay_apps: [app('a.json', 'pay'), app('b.json', 'pay'), app('c.json', 'person'), app('d.json', 'pay')] } as unknown as PilotManifest
    const s = scoreSynth(m, truth)
    expect(s.pay_apps).toMatchObject({ wrong_pay: 1, clean_stopped: 1, good: 3 })
    expect(s.pay_apps!.classes.payapp_new_co_line!.wrong_pay).toBe(0)
    expect(s.pay_apps!.classes.payapp_sov_raised!.wrong_pay).toBe(1)
  })
})
