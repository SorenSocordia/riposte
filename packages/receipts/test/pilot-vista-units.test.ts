/**
 * The Vista draft reads units (2026-10-06): a controller's wire is priced per thousand feet, and the draft left Vista's UM on its
 * ignore list and per-hundred and per-thousand rows unconverted, so every price check on them was wrong; and `mappings --erp
 * vista --out` printed one line, though the pilot page promised the draft's notes.
 *
 *   - price_per (Vista's ECM on the bill, CurECM on the PO line): C and M rates become a price per unit; a value that is none
 *     of E, C or M sends the bill to a person, naming it; a blank one reads as each unless the line's own amount says otherwise.
 *   - unit (Vista's UM): a bill line in another unit of measure than its PO line sends the bill to a person, naming both.
 *   - the drafted mapping file carries its notes; the dry run and `mappings --out` print them.
 * Every export here is synthetic, in Vista's published column names; none is a real export.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotCli, readExport, applyMapping, CSV_PRESETS, ERP_MAPPINGS, erpMappingFile } from '../src/index.js'
import { pricePerDivisor } from '../src/pilot/mappers.js'

const dirs: string[] = []
const tmp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const vista = ERP_MAPPINGS.find((e) => e.id === 'vista')!
const mapping = (): Record<string, unknown> => JSON.parse(erpMappingFile(vista))

/** A one-bill Vista-shaped export: the bill line and the PO line priced as given. */
function exportOf(o: { units: number; unitCost: number; ecm: string; gross: number; um?: string; poCost: number; poEcm: string; poUm?: string; recvd?: number }): string {
  const d = tmp('pilot-vista-units-')
  writeFileSync(join(d, 'bills.csv'), `KeyID,Vendor,APRef,InvDate,InvTotal,PO,Line,POItem,Description,UM,Units,UnitCost,ECM,GrossAmt\n900,4410,INV-311,2026-09-14,${o.gross},PO-77,1,1,THHN 12 AWG copper,${o.um ?? 'LF'},${o.units},${o.unitCost},${o.ecm},${o.gross}\n`)
  writeFileSync(join(d, 'purchase_orders.csv'), `KeyID,PO,Vendor,POItem,Description,UM,CurUnits,CurUnitCost,CurECM,CurCost\n501,PO-77,4410,1,THHN 12 AWG copper,${o.poUm ?? 'LF'},${o.units},${o.poCost},${o.poEcm},${o.gross}\n`)
  writeFileSync(join(d, 'item_receipts.csv'), `KeyID,PO,POItem,RecvdDate,Receiver#,RecvdUnits\n77,PO-77,1,2026-09-10,R-9,${o.recvd ?? o.units}\n`)
  return d
}

describe('the Vista draft reads the price unit and the unit of measure', () => {
  it('the draft maps ECM, CurECM and UM, and UM is no longer ignored', () => {
    const m = mapping() as { columns: Record<string, Record<string, string>>; ignore: string[]; notes: string[] }
    expect(m.columns.bills).toMatchObject({ price_per: 'ECM', unit: 'UM' })
    expect(m.columns.purchase_orders).toMatchObject({ price_per: 'CurECM', unit: 'UM' })
    expect(m.ignore).not.toContain('UM')
    expect(m.notes).toEqual(vista.notes)
    expect(() => applyMapping(CSV_PRESETS['generic-csv'], m)).not.toThrow()
  })

  it('E, C and M (and their words) divide the rate; anything else is not a price unit', () => {
    expect([pricePerDivisor('E'), pricePerDivisor('c'), pricePerDivisor('M'), pricePerDivisor('per thousand'), pricePerDivisor('1000')]).toEqual([1, 100, 1000, 1000, 1000])
    expect(pricePerDivisor('LF')).toBeNull()
  })

  it('wire priced per thousand feet: 2,000 ft at 450.00 per M is 0.45 a foot, and the bill is checked per foot', () => {
    const r = readExport(exportOf({ units: 2000, unitCost: 450, ecm: 'M', gross: 900, poCost: 450, poEcm: 'M' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect([r.unmapped, r.missing]).toEqual([[], []])
    const b = r.bills[0]!
    expect(b.problem).toBeUndefined()
    expect(b.input!.bill.line_items[0]!.unit_price).toBe(0.45)
    expect(b.input!.purchase_order.line_items[0]!.unit_price).toBe(0.45)
    expect(r.notes.some((n) => n.startsWith('price_per (column CurECM of purchase_orders.csv, ECM of bills.csv)'))).toBe(true)
    expect(r.notes.some((n) => n.startsWith('mapping note: UnitCost and CurUnitCost are per ECM unit'))).toBe(true)
  })

  it('per hundred: 300 at 12.00 per C is 0.12 each', () => {
    const r = readExport(exportOf({ units: 300, unitCost: 12, ecm: 'C', gross: 36, poCost: 12, poEcm: 'C' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(r.bills[0]!.input!.bill.line_items[0]!.unit_price).toBe(0.12)
  })

  it('a price unit that is not E, C or M sends the bill to a person, naming it', () => {
    const r = readExport(exportOf({ units: 2000, unitCost: 450, ecm: 'X', gross: 900, poCost: 450, poEcm: 'M' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(r.bills[0]!.input).toBeUndefined()
    expect(r.bills[0]!.problem).toBe('bill line 1: the line prices per "X" (column ECM), which is not E (each), C (per hundred) or M (per thousand): not converted, never guessed; a person reads the line')
    const p = readExport(exportOf({ units: 2000, unitCost: 450, ecm: 'M', gross: 900, poCost: 450, poEcm: 'Q' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(p.bills[0]!.problem).toBe('bill line 1 bills PO line 1, and PO PO-77 line 1 prices per "Q" (column CurECM), which is not E (each), C (per hundred) or M (per thousand): not converted, never guessed; a person reads the line')
  })

  it('a blank price unit reads as each, unless the line\'s amount says it was per thousand: then a person', () => {
    const each = readExport(exportOf({ units: 100, unitCost: 13, ecm: '', gross: 1300, poCost: 13, poEcm: '' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(each.bills[0]!.input!.bill.line_items[0]!.unit_price).toBe(13)
    const per = readExport(exportOf({ units: 2000, unitCost: 450, ecm: '', gross: 900, poCost: 450, poEcm: 'M' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(per.bills[0]!.problem).toContain('states no price unit (column ECM is blank), and its amount is quantity × rate / 1000: priced per thousand?')
  })

  it('units of measure that differ between the bill line and its PO line send the bill to a person, naming both', () => {
    const r = readExport(exportOf({ units: 2000, unitCost: 450, ecm: 'M', gross: 900, um: 'FT', poCost: 450, poEcm: 'M', poUm: 'LF' }), 'generic-csv', { month: '2026-09', mapping: mapping() })
    expect(r.bills[0]!.problem).toBe('bill line 1 is in FT and the PO line it bills (1) is in LF: units of measure differ, not converted; a person reads the line')
  })
})

describe('the drafted mapping carries its notes', () => {
  it('mappings --erp vista --out writes them into the file and prints them', () => {
    const d = tmp('pilot-vista-notes-')
    const r = pilotCli(['mappings', '--erp', 'vista', '--out', join(d, 'vista.json')])
    expect(r.code).toBe(0)
    const file = JSON.parse(readFileSync(join(d, 'vista.json'), 'utf8')) as { notes: string[] }
    expect(file.notes).toEqual(vista.notes)
    expect(r.err).toContain('notes (also in the file, under "notes"):')
    for (const n of vista.notes) expect(r.err).toContain(`  - ${n}`)
    expect(r.err).toContain('per hundred')
    expect(r.err).toContain('Retainage')
  })

  it('a mapping file\'s notes must be a list of sentences', () => {
    expect(() => applyMapping(CSV_PRESETS['generic-csv'], { notes: 'one' })).toThrow(/mapping\.notes: a list of sentences/)
    expect(() => applyMapping(CSV_PRESETS['generic-csv'], { notes: ['fine'] })).not.toThrow()
  })
})
