/**
 * The shadow pilot's tax rule, the freeze warning on a sample that cannot clear its bar, and the CSV mapping's invoiced quantity
 * per PO line (2026-10-06).
 *
 * A cold reader in the role of a controller at a mechanical and electrical subcontractor: "Every supply-house bill we get carries
 * sales tax, so every one of them is a person's job in a pilot"; "I froze sample_size 2 ... prereg freeze accepted both without a
 * word"; "Job-cost ERPs keep invoiced quantity per PO line, so accept that field in the input."
 *   - `tax` is a pre-registration field, like the freight rule: "person" (the default), "allow" or "rate:8.25%", set by
 *     `prereg init --tax`, used for every bill, recorded in each receipt, bound into each verdict's inputs (never for "person"),
 *     and a run asked for another rule is refused.
 *   - `prereg freeze` warns, in words, when a registered sample cannot clear its bar even at its best; it freezes as written.
 *   - A generic CSV export may carry `invoiced_quantity` on purchase-order lines: the quantity invoiced before the month. Each bill
 *     is netted against it plus the earlier bills of the month on the line (a held bill left out).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freezePrereg, parsePrereg, preregTax, preregTemplate, preregWarnings, type PreregParams } from '../src/pilot/prereg.js'
import { pilotCli, readTax } from '../src/pilot-command.js'
import { runShadow, ShadowRefused } from '../src/pilot/shadow.js'
import { readExport } from '../src/pilot/mappers.js'
import { writeSynthMonth } from '../src/pilot/synth.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', 'tmp', 'vitest')
const made: string[] = []
const tmp = (p: string): string => { mkdirSync(ROOT, { recursive: true }); const d = mkdtempSync(join(ROOT, p)); made.push(d); return d }
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const T0 = (): Date => new Date('2026-10-06T08:00:00Z')

const filled = (o: Parameters<typeof preregTemplate>[0] = {}, s = { holds: 40, pays: 75 }): string => preregTemplate({ buyer: 'Synthetic Co.', month: '2026-09', source: 'generic-csv', ...o })
  .replace(/<fill: the lowest precision[^>]*>/, '0.85').replace(/<fill: how many would-holds[^>]*>/, String(s.holds))
  .replace(/<fill: the highest miss rate[^>]*>/, '0.05').replace(/<fill: how many would-pays[^>]*>/, String(s.pays))
function prereg(dir: string, tax?: string, name = 'PREREG.md'): string {
  const p = join(dir, name)
  writeFileSync(p, filled(tax !== undefined ? { tax } : {}))
  freezePrereg(p, () => new Date('2026-10-06T07:00:00Z'))
  return p
}

/** A small generic-csv month: a cable line billed 24 then 30 against 40 received, and a taxed bill on a PO with no tax terms. */
function exportDir(dir: string, o: { invoicedQuantity?: boolean; heldFirst?: boolean } = {}): string {
  const x = join(dir, 'export')
  mkdirSync(x, { recursive: true })
  writeFileSync(join(x, 'bills.csv'), [
    'ref,invoice_number,vendor,date,currency,total,tax,po,status,item,description,quantity,rate,amount',
    `B-1,SES-1001,Summit Electrical Supply,2026-09-03,USD,240.00,,PO-1,${o.heldFirst ? 'held' : 'paid'},MC-250,MC cable 250ft roll,24,10.00,240.00`,
    'B-2,SES-1002,Summit Electrical Supply,2026-09-10,USD,300.00,,PO-1,,MC-250,MC cable 250ft roll,30,10.00,300.00',
    'B-3,SES-1003,Summit Electrical Supply,2026-09-12,USD,541.25,41.25,PO-2,,PNL-200,Panelboard 200A,5,100.00,500.00',
  ].join('\n') + '\n')
  writeFileSync(join(x, 'purchase_orders.csv'), [
    `ref,number,vendor,currency,item,description,quantity,rate,amount${o.invoicedQuantity ? ',invoiced_quantity' : ''}`,
    `po-1,PO-1,Summit Electrical Supply,USD,MC-250,MC cable 250ft roll,60,10.00,600.00${o.invoicedQuantity ? ',0' : ''}`,
    `po-2,PO-2,Summit Electrical Supply,USD,PNL-200,Panelboard 200A,5,100.00,500.00${o.invoicedQuantity ? ',' : ''}`,
  ].join('\n') + '\n')
  writeFileSync(join(x, 'item_receipts.csv'), [
    'ref,number,po,date,item,quantity',
    'r-1,GR-1,PO-1,2026-09-02,MC-250,40',
    'r-2,GR-2,PO-2,2026-09-11,PNL-200,5',
  ].join('\n') + '\n')
  return x
}

describe('the pre-registration registers the tax rule', () => {
  it('the template writes "person", or the rule it is given, with a section saying what it does', () => {
    expect(preregTemplate()).toContain('"tax": "person",')
    expect(preregTemplate({ tax: 'rate:8.25%' })).toContain('"tax": "rate:8.25%",')
    expect(preregTemplate()).toContain("## The check's tax rule")
  })
  it('another value is refused; a prereg written before the field reads "person"; a rate reads as the gate\'s policy', () => {
    expect(() => parsePrereg(filled().replace('"tax": "person"', '"tax": "sometimes"'))).toThrow(/"tax" is "person"/)
    expect(preregTax(parsePrereg(filled().replace(/\n {2}"tax": "person",/, '')))).toBe('person')
    expect(preregTax(parsePrereg(filled({ tax: 'rate:8.25%' })))).toEqual({ rate: 0.0825 })
    expect(preregTax(parsePrereg(filled({ tax: 'allow' })))).toBe('allow')
  })
  it('prereg init --tax takes person, allow or rate:<pct>; anything else is a usage error', () => {
    const d = tmp('tax-init-')
    expect(pilotCli(['prereg', 'init', join(d, 'a.md'), '--tax', 'rate:8.25%']).code).toBe(0)
    expect(readFileSync(join(d, 'a.md'), 'utf8')).toContain('"tax": "rate:8.25%",')
    expect(pilotCli(['prereg', 'init', join(d, 'b.md'), '--tax', '8.25']).code).toBe(3)
    expect(readTax('rate:0.0825')).toEqual({ text: 'rate:8.25%' })
    expect(pilotCli(['--help']).err).toContain('[--tax person|allow|rate:<pct>]')
  })
})

describe('prereg freeze warns when a registered sample cannot clear its bar', () => {
  const params = (holds: number, pays: number): PreregParams => parsePrereg(filled({}, { holds, pays }))
  it('2 audited would-holds for a 0.85 bar, and 2 would-pays for 0.05: both named, with the fewest that could', () => {
    const w = preregWarnings(params(2, 2))
    expect(w).toHaveLength(2)
    expect(w[0]).toMatch(/^primary\.sample_size is 2: even if every one of the 2 audited would-holds is confirmed, the lower bound of the 95% interval is 0\.158, under the bar of 0\.85, so hold_precision cannot pass with this sample; \d+ is the fewest that could$/)
    expect(w[1]).toMatch(/^co_primary\.sample_size is 2: even if none of the 2 audited would-pays is a bad bill, the upper bound of the 95% interval is 0\.842, over the bar of 0\.05, so the miss rate cannot pass with this sample; 72 is the fewest that could$/)
  })
  it('40 and 75 can clear 0.85 and 0.05: no warning', () => {
    expect(preregWarnings(params(40, 75))).toEqual([])
  })
  it('the CLI freezes as written and says so on stderr', () => {
    const d = tmp('tax-freeze-')
    const p = join(d, 'P.md')
    writeFileSync(p, filled({}, { holds: 2, pays: 2 }))
    const r = pilotCli(['prereg', 'freeze', p, '--now', '2026-10-06T07:00:00Z'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('warning: primary.sample_size is 2:')
    expect(r.err).toContain('Frozen as written: a larger sample needs a new pre-registration')
  })
})

describe('the run under the frozen tax rule', () => {
  it('person: the taxed bill on a PO with no tax terms goes to a person, as before; the receipt records the rule', () => {
    const d = tmp('tax-run-')
    const r = runShadow({ keyHere: true, source: 'generic-csv', exportDir: exportDir(d), month: '2026-09', preregPath: prereg(d), out: join(d, 'run'), now: T0 })
    const b3 = r.manifest.bills.find((b) => b.ref === 'B-3')!
    expect(b3.disposition).toBe('person')
    expect(r.manifest.tax).toBe('person')
    const receipts = readFileSync(join(d, 'run', 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(receipts.filter((e) => e.kind === 'ap_gate').every((e) => e.body.shadow.tax === 'person')).toBe(true)
  })
  it('allow: the taxed bill pays, the rule is bound into its verdict\'s inputs, and its record says so', () => {
    const d = tmp('tax-allow-')
    const r = runShadow({ keyHere: true, source: 'generic-csv', storeDocuments: true, exportDir: exportDir(d), month: '2026-09', preregPath: prereg(d, 'allow'), out: join(d, 'run'), now: T0 })
    const b3 = r.manifest.bills.find((b) => b.ref === 'B-3')!
    expect(b3.disposition).toBe('pay')
    const receipts = readFileSync(join(d, 'run', 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const e = receipts.find((x) => x.kind === 'ap_gate' && x.seq === b3.seq)
    expect(e.body.shadow.tax).toBe('allow')
    expect(e.body.proof.inputs.policy.tax).toBe('allow')
  })
  it('rate:8.25%: 41.25 on 500.00 is the rate, and the bill pays', () => {
    const d = tmp('tax-rate-')
    const r = runShadow({ keyHere: true, source: 'generic-csv', exportDir: exportDir(d), month: '2026-09', preregPath: prereg(d, 'rate:8.25%'), out: join(d, 'run'), now: T0 })
    expect(r.manifest.bills.find((b) => b.ref === 'B-3')!.disposition).toBe('pay')
    expect(r.manifest.tax).toBe('rate:8.25%')
  })
  it('a run asked for another rule than the frozen one is refused before anything is written', () => {
    const d = tmp('tax-refuse-')
    expect(() => runShadow({ keyHere: true, source: 'generic-csv', tax: 'allow', exportDir: exportDir(d), month: '2026-09', preregPath: prereg(d), out: join(d, 'run'), now: T0 }))
      .toThrow(ShadowRefused)
    expect(() => runShadow({ keyHere: true, source: 'generic-csv', tax: 'allow', exportDir: exportDir(d), month: '2026-09', preregPath: prereg(d, undefined, 'P2.md'), out: join(d, 'run2'), now: T0 }))
      .toThrow(/the prereg froze the tax rule "person"; this run was asked for "allow"/)
  })
})

describe('a Ramp tax line', () => {
  it('one expense line whose whole memo names a tax is the bill\'s tax, so the frozen tax rule decides it', () => {
    const d = tmp('tax-ramp-')
    const x = join(d, 'export')
    writeSynthMonth(x, join(d, 'truth.json'), { month: '2026-09', bills: 120, seed: 11 })
    const truth = JSON.parse(readFileSync(join(d, 'truth.json'), 'utf8')) as { planted: Record<string, { plant: string }> }
    const taxed = Object.entries(truth.planted).filter(([, t]) => t.plant === 'tax_on_untaxed_po').map(([ref]) => ref)
    expect(taxed.length).toBeGreaterThan(0)
    const r = readExport(x, 'ramp', { month: '2026-09' })
    for (const ref of taxed) {
      const b = r.bills.find((y) => y.ref === ref)!
      expect(b.input!.bill.tax, ref).toBeDefined()
      expect(b.input!.bill.line_items.some((l) => l.description === 'Sales tax'), ref).toBe(false)
    }
    expect(r.notes.some((n) => n.startsWith('tax: '))).toBe(true)
    const rampPrereg = (name: string, tax?: string): string => {
      const p = join(d, name)
      writeFileSync(p, filled({ source: 'ramp', ...(tax ? { tax } : {}) }))
      freezePrereg(p, () => new Date('2026-10-06T07:00:00Z'))
      return p
    }
    const person = runShadow({ keyHere: true, exportDir: x, month: '2026-09', preregPath: rampPrereg('P1.md'), out: join(d, 'run1'), now: T0 })
    const allow = runShadow({ keyHere: true, exportDir: x, month: '2026-09', preregPath: rampPrereg('P2.md', 'allow'), out: join(d, 'run2'), now: T0 })
    for (const ref of taxed) expect(person.manifest.bills.find((b) => b.ref === ref)!.disposition, ref).toBe('person')
    expect(allow.manifest.bills.filter((b) => taxed.includes(b.ref) && b.disposition === 'pay').length).toBeGreaterThan(0)
  })
})

describe('the CSV mapping\'s invoiced quantity per PO line', () => {
  it('without the column, no bill carries invoiced_quantity_to_date (the gap is named by the check)', () => {
    const d = tmp('iq-none-')
    const r = readExport(exportDir(d), 'generic-csv', { month: '2026-09' })
    expect(r.bills.every((b) => b.input!.purchase_order.line_items.every((l) => l.invoiced_quantity_to_date === undefined))).toBe(true)
  })
  it('with it: each bill carries the quantity invoiced before it (the opening figure plus earlier bills of the month on the line)', () => {
    const d = tmp('iq-col-')
    const r = readExport(exportDir(d, { invoicedQuantity: true }), 'generic-csv', { month: '2026-09' })
    const of = (ref: string) => r.bills.find((b) => b.ref === ref)!.input!.purchase_order.line_items[0]!.invoiced_quantity_to_date
    expect(of('B-1')).toBe(0)
    expect(of('B-2')).toBe(24)
    expect(of('B-3')).toBeUndefined() // the PO line's cell is empty: not stated
    expect(r.notes.some((n) => n.startsWith('invoiced_quantity: '))).toBe(true)
    const held = readExport(exportDir(tmp('iq-held-'), { invoicedQuantity: true, heldFirst: true }), 'generic-csv', { month: '2026-09' })
    expect(held.bills.find((b) => b.ref === 'B-2')!.input!.purchase_order.line_items[0]!.invoiced_quantity_to_date).toBe(0)
  })
  it('in the run, the second cable bill (54 billed against 40 received) goes to a person instead of paying', () => {
    const d = tmp('iq-run-')
    const r = runShadow({ keyHere: true, source: 'generic-csv', exportDir: exportDir(d, { invoicedQuantity: true }), month: '2026-09', preregPath: prereg(d), out: join(d, 'run'), now: T0 })
    const b2 = r.manifest.bills.find((b) => b.ref === 'B-2')!
    expect(b2.disposition).toBe('person')
    expect(b2.why).toMatch(/billed to date would be 54 against 40 received: 24 invoiced earlier on PO line 1/)
    const plain = runShadow({ keyHere: true, source: 'generic-csv', exportDir: exportDir(tmp('iq-plain-')), month: '2026-09', preregPath: prereg(tmp('iq-plain-p-')), out: join(tmp('iq-plain-o-'), 'run'), now: T0 })
    expect(plain.manifest.bills.find((b) => b.ref === 'B-2')!.disposition).toBe('pay') // the disclosed gap, without the column
  })
})
