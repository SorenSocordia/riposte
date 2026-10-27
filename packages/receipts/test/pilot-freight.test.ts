/**
 * The shadow pilot's freight rule (2026-10-05).
 *
 * A cold reader (an AI agent) reading the package as a controller: "Ramp has no freight_allowed field. So every freighted bill from a Ramp
 * export goes to a person ... Freight is on most of our material bills." The rule is now a pre-registration field, frozen before
 * the run like the price tolerance: "person" (the default, as before) or "allow" (freight on a purchase order that does not say
 * is added to the total). It is set by `prereg init --freight`, used for every bill, recorded in each receipt, bound into each
 * verdict's inputs when "allow", and a run asked for another rule is refused. A Ramp bill's freight arrives as an expense line
 * with no PO line; one such line whose whole memo is a freight charge's name is read as the bill's freight (src/pilot/mappers.ts).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freezePrereg, parsePrereg, preregFreight, preregTemplate } from '../src/pilot/prereg.js'
import { pilotCli, readFreight } from '../src/pilot-command.js'
import { runShadow, ShadowRefused } from '../src/pilot/shadow.js'
import { writeSynthMonth } from '../src/pilot/synth.js'
import { readExport } from '../src/pilot/mappers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', 'tmp', 'vitest')
const made: string[] = []
const tmp = (p: string): string => { mkdirSync(ROOT, { recursive: true }); const d = mkdtempSync(join(ROOT, p)); made.push(d); return d }
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const T0 = (): Date => new Date('2026-10-03T08:00:00Z')

const filled = (o: Parameters<typeof preregTemplate>[0] = {}): string => preregTemplate({ buyer: 'Synthetic Co.', month: '2026-09', source: 'ramp', ...o })
  .replace(/<fill: the lowest precision[^>]*>/, '0.85').replace(/<fill: how many would-holds[^>]*>/, '40')
  .replace(/<fill: the highest miss rate[^>]*>/, '0.05').replace(/<fill: how many would-pays[^>]*>/, '20')
/** A frozen prereg; `freight` undefined keeps the template's value, null removes the field (a prereg written before it). */
function prereg(dir: string, freight?: 'allow' | 'person' | null, name = 'PREREG.md'): string {
  const p = join(dir, name)
  let text = filled(freight === 'allow' || freight === 'person' ? { freight } : {})
  if (freight === null) text = text.replace(/\n {2}"freight": "person",/, '')
  writeFileSync(p, text)
  freezePrereg(p, () => new Date('2026-10-03T07:00:00Z'))
  return p
}

describe('the pre-registration registers the freight rule', () => {
  it('the template writes "person", or the rule it is given, with a section saying what it does', () => {
    expect(preregTemplate()).toContain('"freight": "person",')
    expect(preregTemplate({ freight: 'allow' })).toContain('"freight": "allow",')
    expect(preregTemplate()).toContain("## The check's freight rule")
  })
  it('another value is refused; a prereg written before the field reads "person"', () => {
    expect(() => parsePrereg(filled().replace('"freight": "person"', '"freight": "sometimes"'))).toThrow(/"freight" is "person"/)
    expect(preregFreight(parsePrereg(filled().replace(/\n {2}"freight": "person",/, '')))).toBe('person')
    expect(preregFreight(parsePrereg(filled({ freight: 'allow' })))).toBe('allow')
  })
  it('a filled prereg holds no blank marker anywhere, the instructions included', () => {
    expect(filled()).not.toContain('<fill:')
  })
  it('prereg init --freight takes allow or person; anything else is a usage error', () => {
    const d = tmp('fr-init-')
    expect(pilotCli(['prereg', 'init', join(d, 'a.md'), '--freight', 'allow']).code).toBe(0)
    expect(readFileSync(join(d, 'a.md'), 'utf8')).toContain('"freight": "allow",')
    expect(pilotCli(['prereg', 'init', join(d, 'b.md'), '--freight', 'maybe']).code).toBe(3)
    expect(readFreight('person')).toBe('person')
    expect(readFreight('yes')).toMatch(/--freight "yes" is allow/)
    expect(pilotCli(['--help']).err).toContain('[--freight allow|person]')
  })
})

describe('a Ramp freight line, and the run under the frozen rule', () => {
  /** A synthetic month in which one bill the gate would pay gains a freight expense line, its total raised to match. */
  const month = (): { dir: string; exportDir: string; ref: string } => {
    const dir = tmp('fr-run-')
    const exportDir = join(dir, 'export')
    writeSynthMonth(exportDir, join(dir, 'truth.json'), { month: '2026-09', bills: 60, seed: 3 })
    const probe = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, undefined, 'PROBE.md'), out: join(dir, 'probe'), now: T0 })
    const pay = probe.manifest.bills.find((b) => b.disposition === 'pay')!
    const file = join(exportDir, 'bills.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const bills = (Array.isArray(raw) ? raw : raw.data) as Record<string, any>[]
    const b = bills.find((x) => x.id === pay.ref)!
    b.line_items = [...(b.line_items ?? []), { id: `${b.id}_freight`, amount: { amount: 8500, currency_code: 'USD', minor_unit_conversion_rate: 100 }, memo: 'Freight' }]
    b.amount = { ...b.amount, amount: b.amount.amount + 8500 }
    writeFileSync(file, JSON.stringify(raw))
    return { dir, exportDir, ref: pay.ref }
  }
  const receipt = (out: string, ref: string) => {
    const m = JSON.parse(readFileSync(join(out, 'pilot-run.json'), 'utf8'))
    return m.bills.find((x: { ref: string }) => x.ref === ref)
  }

  it('one expense line whose memo is a freight charge\'s name is read as the bill\'s freight, and the export notes say so', () => {
    const { exportDir, ref } = month()
    const r = readExport(exportDir, 'ramp', { month: '2026-09' })
    const b = r.bills.find((x) => x.ref === ref)!
    expect(b.input?.bill.freight).toEqual({ amount: 8500, currency_code: 'USD', minor_unit_conversion_rate: 100 })
    expect(b.input?.bill.line_items.some((l) => l.description === 'Freight')).toBe(false)
    expect(r.notes.some((n) => /^freight: \d+ bill\(s\) carry one expense line with no PO line whose whole memo is a freight charge's name/.test(n))).toBe(true) // the month's own freight plants count too
  })

  it('only a memo that is a freight charge\'s name is freight; a memo that mentions shipping stays a line no PO line matches', () => {
    const { exportDir, ref } = month()
    const file = join(exportDir, 'bills.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const b = ((Array.isArray(raw) ? raw : raw.data) as Record<string, any>[]).find((x) => x.id === ref)!
    for (const [memo, freight] of [['Shipping container rental', false], ['Shipping & Handling.', true], ['Inbound freight charges', true], ['Delivery charge', true]] as const) {
      b.line_items[b.line_items.length - 1].memo = memo
      writeFileSync(file, JSON.stringify(raw))
      const got = readExport(exportDir, 'ramp', { month: '2026-09' }).bills.find((x) => x.ref === ref)!.input!.bill
      expect(got.freight !== undefined, memo).toBe(freight)
    }
  })

  it('"person" sends the freighted bill to a person; "allow" pays it; each receipt records the rule, and the proof binds "allow"', () => {
    const { dir, exportDir, ref } = month()
    const person = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir), out: join(dir, 'person'), now: T0 })
    const allow = runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, 'allow', 'ALLOW.md'), out: join(dir, 'allow'), now: T0, freight: 'allow', storeDocuments: true })
    expect(receipt(person.out, ref).disposition).toBe('person')
    expect(receipt(allow.out, ref).disposition).toBe('pay')
    const gated = (out: string) => readFileSync(join(out, 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'ap_gate')
    expect(new Set(gated(person.out).map((e) => e.body.shadow.freight))).toEqual(new Set(['person']))
    expect(new Set(gated(allow.out).map((e) => e.body.shadow.freight))).toEqual(new Set(['allow']))
    const first = readdirSync(join(allow.out, 'proofs')).sort()[0]!
    expect(JSON.parse(readFileSync(join(allow.out, 'proofs', first), 'utf8')).inputs.policy).toEqual({ price_tolerance: 0.02, total_tolerance: 0.005, freight: 'allow' })
  })

  it('a run asked for another rule than the prereg froze is refused, before anything is written', () => {
    const { dir, exportDir } = month()
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir), out: join(dir, 'run'), now: T0, freight: 'allow' }))
      .toThrow(/froze the freight rule "person"; this run was asked for "allow"/)
    expect(() => runShadow({ keyHere: true, exportDir, month: '2026-09', preregPath: prereg(dir, null, 'OLD.md'), out: join(dir, 'run2'), now: T0, freight: 'allow' }))
      .toThrow(ShadowRefused)
  })
})
