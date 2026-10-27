/**
 * The shadow pilot's price tolerance (2026-10-05) and its payment history for the PO balance check.
 *
 * A cold reader in the controller's role (cold review round 3): "The 2% price tolerance is fixed for anyone using the command line or the pilot ... I expected it to
 * be a pilot parameter, because copper wire on an electrical bill moves more than 2%." It is now a pre-registration field,
 * frozen before the run, set by `prereg init --price-tolerance`, used for every bill, recorded in each receipt, and a run asked
 * for another is refused. And each payment-history row names the order it was booked against, so engine 0.6.0's PO balance
 * check can net earlier bills on the same order (verify docs/AP-INPUT.md).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freezePrereg, parsePrereg, preregPriceTolerance, preregTemplate, PreregRefused } from '../src/pilot/prereg.js'
import { pilotCli, readPriceTolerance } from '../src/pilot-command.js'
import { runShadow, ShadowRefused } from '../src/pilot/shadow.js'
import { writeSynthMonth } from '../src/pilot/synth.js'
import { readExport } from '../src/pilot/mappers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', 'tmp', 'vitest')
const made: string[] = []
const tmp = (p: string): string => { mkdirSync(ROOT, { recursive: true }); const d = mkdtempSync(join(ROOT, p)); made.push(d); return d }
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const T0 = (): Date => new Date('2026-10-03T08:00:00Z')

/** A frozen prereg; `tol` undefined keeps the template's value, null removes the field (a prereg written before it). */
function prereg(dir: string, tol?: number | null, name = 'PREREG.md'): string {
  const p = join(dir, name)
  let text = preregTemplate({ buyer: 'Synthetic Co.', month: '2026-09', source: 'ramp', ...(typeof tol === 'number' ? { priceTolerance: tol } : {}) })
    .replace('<fill: the lowest precision that counts as a pass, e.g. 0.85>', '0.85').replace('<fill: how many would-holds a person audits, e.g. 40>', '40')
    .replace('<fill: the highest miss rate that counts as a pass, e.g. 0.05>', '0.05').replace('<fill: how many would-pays a person audits, e.g. 75>', '20')
  if (tol === null) text = text.replace(/\n {2}"price_tolerance": [\d.]+,/, '')
  writeFileSync(p, text)
  freezePrereg(p, () => new Date('2026-10-03T07:00:00Z'))
  return p
}

describe('the pre-registration registers the price tolerance', () => {
  it('the template writes 0.02, or the value it is given; the field is frozen with the rest', () => {
    expect(preregTemplate()).toContain('"price_tolerance": 0.02,')
    expect(preregTemplate({ priceTolerance: 0.05 })).toContain('"price_tolerance": 0.05,')
    expect(preregTemplate()).toContain("## The check's price tolerance")
  })
  it('a number in quotes, or out of 0 to 1, is refused with the fix; a prereg written before the field reads 0.02', () => {
    const base = (v: string): string => preregTemplate({ buyer: 'B', month: '2026-09', source: 'ramp' }).replace('"price_tolerance": 0.02', `"price_tolerance": ${v}`)
      .replace(/<fill: [^>]*precision[^>]*>/, '0.85').replace(/<fill: how many would-holds[^>]*>/, '40').replace(/<fill: the highest miss rate[^>]*>/, '0.05').replace(/<fill: how many would-pays[^>]*>/, '20')
    expect(() => parsePrereg(base('"0.05"'))).toThrow(/remove the quotes around 0\.05/)
    expect(() => parsePrereg(base('1.5'))).toThrow(PreregRefused)
    expect(preregPriceTolerance(parsePrereg(base('0.05')))).toBe(0.05)
    expect(preregPriceTolerance(parsePrereg(base('0.02').replace(/\n {2}"price_tolerance": 0\.02,/, '')))).toBe(0.02)
  })
  it('prereg init --price-tolerance takes a fraction or a percent; anything else is a usage error', () => {
    const d = tmp('tol-init-')
    expect(pilotCli(['prereg', 'init', join(d, 'a.md'), '--price-tolerance', '5%']).code).toBe(0)
    expect(readFileSync(join(d, 'a.md'), 'utf8')).toContain('"price_tolerance": 0.05,')
    expect(pilotCli(['prereg', 'init', join(d, 'b.md'), '--price-tolerance', 'lots']).code).toBe(3)
    expect(readPriceTolerance('0.035')).toBe(0.035)
    expect(readPriceTolerance('-1')).toMatch(/not a fraction from 0 to 1/)
    expect(pilotCli(['--help']).err).toContain('--price-tolerance <fraction>')
  })
})

describe('the run checks every bill under the frozen tolerance and records it', () => {
  const month = (): { dir: string; exportDir: string } => {
    const dir = tmp('tol-run-')
    writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills: 120, seed: 3 })
    return { dir, exportDir: join(dir, 'export') }
  }
  const holds = (out: string): number => readFileSync(join(out, 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.body?.checker_decision === 'hold_price').length

  it('a wider tolerance holds fewer bills on price; each receipt and its proof carry the tolerance', () => {
    const { dir, exportDir } = month()
    const narrow = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir), out: join(dir, 'narrow'), now: T0, storeDocuments: true })
    const wide = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, 0.1, 'WIDE.md'), out: join(dir, 'wide'), now: T0, priceTolerance: 0.1 })
    expect(holds(narrow.out)).toBeGreaterThan(0)
    expect(holds(wide.out)).toBeLessThan(holds(narrow.out)) // the planted price plants run 3% to 8% over
    const gated = readFileSync(join(wide.out, 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'ap_gate')
    expect(gated.length).toBeGreaterThan(0)
    expect(new Set(gated.map((e) => e.body.shadow.price_tolerance))).toEqual(new Set([0.1]))
    const first = readdirSync(join(narrow.out, 'proofs')).sort()[0]!
    expect(JSON.parse(readFileSync(join(narrow.out, 'proofs', first), 'utf8')).inputs.policy).toEqual({ price_tolerance: 0.02, total_tolerance: 0.005 })
  })

  it('a run asked for another tolerance than the prereg froze is refused, before anything is written', () => {
    const { dir, exportDir } = month()
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir), out: join(dir, 'run'), now: T0, priceTolerance: 0.05 }))
      .toThrow(/froze a price tolerance of 0\.02; this run was asked for 0\.05/)
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, null, 'OLD.md'), out: join(dir, 'run2'), now: T0, priceTolerance: 0.05 }))
      .toThrow(ShadowRefused)
  })
})

describe('the payment history names the order each paid bill was booked against', () => {
  it('every history row carries its PO number, or says it was booked without one', () => {
    const dir = tmp('tol-hist-')
    writeSynthMonth(join(dir, 'export'), join(dir, 'truth.json'), { month: '2026-09', bills: 120, seed: 3 })
    const r = readExport(join(dir, 'export'), 'ramp', { month: '2026-09' })
    const rows = r.bills.flatMap((b) => b.input?.payment_history ?? [])
    expect(rows.length).toBeGreaterThan(0)
    for (const h of rows) expect(Boolean(h.purchase_order_number) !== (h.no_purchase_order === true), JSON.stringify(h)).toBe(true)
    expect(rows.some((h) => h.no_purchase_order === true)).toBe(true) // the month's paid bills with no PO
  })
})
