/**
 * The published AP table, checked byte for byte as a test (2026-10-03; it was `pair.ts --check` in the Distil pairing
 * example only). BENCHMARK-AP.md's Result 2 table is reprinted from the blind checker's recorded run against Distil Labs'
 * seven published decider files, exactly as the example computes it, and must appear in the document verbatim.
 *
 * The inputs are test/fixtures/distil-published-table.json (per invoice: the recorded run's outcome and decision, each
 * decider's prediction and gold label), with the sha256 of each source file. When the sources are present (the public tree's
 * bench/ap, two levels up; or RIPOSTE_BENCH_AP_RUN1 + RIPOSTE_BENCH_AP_DECIDERS), the fixture is re-derived from them too.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
interface TableFixture { checker_sha256: string; sources: Record<string, string>; run1: Record<string, [string, string | null]>; deciders: Record<string, Record<string, [string, string | null]>> }
const FX = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'distil-published-table.json'), 'utf8')) as TableFixture
const GOLD = new Map(readFileSync(join(ROOT, 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map(l => { const r = JSON.parse(l) as { id: string; decision: string }; return [r.id, r.decision] as const }))

/** Distil's published configurations in BENCHMARK-AP.md's order, with the labels it prints (as the pairing example has them). */
const PUBLISHED: [string, string][] = [
  ['jev-single', 'Jev — single question'], ['jev-checks', 'Jev — one question per check'], ['jev-lines', 'Jev — one question per line & check'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite'], ['gpt-5.6-luna', 'GPT-5.6 Luna'], ['glm-5.3-high', 'GLM-5.3 (high)'],
  ['gpt-5.6-luna-high', 'GPT-5.6 Luna (high reasoning)'],
]
const HEAD = ['| AI configuration (Distil\'s published runs) | wrong decisions | wrong **approvals** (bad invoice paid) | caught | wrong auto-payments | auto-paid |', '|---|---|---|---|---|---|']
const isRight = (decision: string, g: string | undefined): boolean => decision === g || (decision === 'hold' && g !== undefined && g.startsWith('hold_'))

function publishedTable(fx: Pick<TableFixture, 'run1' | 'deciders'>): string[] {
  const rows: string[] = []
  for (const [name, label] of PUBLISHED) {
    const s = fx.deciders[name]
    if (!s) continue
    let wrong = 0, wrongApprove = 0, caught = 0, auto = 0, wrongAuto = 0
    for (const [id, [decision, gold]] of Object.entries(s)) {
      const right = isRight(decision, gold ?? GOLD.get(id))
      if (!right) { wrong++; if (decision === 'approve') wrongApprove++ }
      const c = fx.run1[id]
      const agree = c !== undefined && c[0] === 'DECIDED' && c[1] === decision
      if (agree) { auto++; if (!right) wrongAuto++ } else if (!right) caught++
    }
    rows.push(`| ${label} | ${wrong} | ${wrongApprove} | ${wrong ? `${caught} / ${wrong}` : '—'} | **${wrongAuto}** | ${auto} |`)
  }
  return [...HEAD, ...rows]
}

describe('BENCHMARK-AP.md Result 2, reprinted from the recorded run', () => {
  it('the table the recorded run gives appears in BENCHMARK-AP.md byte for byte (9 lines), with zero wrong auto-payments in every row', () => {
    const table = publishedTable(FX)
    expect(table).toHaveLength(9)
    const doc = readFileSync(join(ROOT, 'docs', 'BENCHMARK-AP.md'), 'utf8')
    expect(doc.includes(table.join('\n'))).toBe(true)
    for (const row of table.slice(2)) expect(row).toContain('| **0** |')
  })

  it('a changed decision moves the table, so the check can fail (one wrong approval auto-paid)', () => {
    const fx = JSON.parse(JSON.stringify(FX)) as TableFixture
    const id = Object.keys(fx.run1).find(k => fx.run1[k]![0] === 'DECIDED' && fx.run1[k]![1] !== 'approve')!
    fx.deciders['jev-single']![id] = ['approve', fx.deciders['jev-single']![id]![1]]
    fx.run1[id] = ['DECIDED', 'approve']
    const doc = readFileSync(join(ROOT, 'docs', 'BENCHMARK-AP.md'), 'utf8')
    expect(doc.includes(publishedTable(fx).join('\n'))).toBe(false)
  })

  // The sources, when present: the public tree's bench/ap (two levels above this package), or the two env paths.
  const run1Path = process.env.RIPOSTE_BENCH_AP_RUN1 ?? join(ROOT, '..', '..', 'bench', 'ap', 'results', 'run-1.jsonl')
  const decDir = process.env.RIPOSTE_BENCH_AP_DECIDERS ?? join(ROOT, '..', '..', 'bench', 'ap', 'data', 'distil', 'results')
  const present = existsSync(run1Path) && existsSync(decDir)
  it.runIf(present)('the fixture is what the source files say (each file\'s sha256, and every value re-derived)', () => {
    const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
    const run1Bytes = readFileSync(run1Path)
    expect(sha(run1Bytes)).toBe(FX.sources['bench/ap/results/run-1.jsonl'])
    const run1: TableFixture['run1'] = {}
    for (const l of run1Bytes.toString('utf8').trim().split('\n')) { const r = JSON.parse(l); expect(r.checker_sha256).toBe(FX.checker_sha256); run1[r.id] = [r.got.outcome, r.got.decision] }
    expect(run1).toEqual(FX.run1)
    const deciders: TableFixture['deciders'] = {}
    for (const f of readdirSync(decDir).filter(f => /^decider__.*\.jsonl$/.test(f)).sort()) {
      const b = readFileSync(join(decDir, f))
      expect([f, sha(b)]).toEqual([f, FX.sources[`bench/ap/data/distil/results/${f}`]])
      const name = f.replace(/^decider__|\.jsonl$/g, '')
      deciders[name] = {}
      for (const l of b.toString('utf8').trim().split('\n')) { const r = JSON.parse(l); deciders[name]![r.id] = [r.prediction, r.gold ?? null] }
    }
    expect(deciders).toEqual(FX.deciders)
  })
})
