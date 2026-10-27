/**
 * The bench page states nothing it cannot derive from the tree (cold review round 10, 2026-10-19: the page said "engine 0.6.0,
 * the label today's build carries, is still open" from a literal in the generator, and `bench check` reproduced the false
 * sentence byte for byte). The open engine label is the version file's ENGINE_VERSION; the closed labels are the ones below
 * it in ENGINE_VERSIONS, dated by the changelog's "closed on" lines; a changelog that calls the open label closed, or whose
 * summary sentence disagrees with the version file, refuses. The AP stress rows' re-bank history is read from the amendment
 * file `_stress.json` names, through its last entry. The default legal rule this build issues new verdicts under is listed
 * under "Outside the rule", or the page says it is not. docs.ts carries no engine version as a literal.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineLabels, rebankHistory, renderBenchIndex, type IndexExtras } from '../src/bench/docs'
import { runBench } from '../src/bench/cli-bench'
import type { BenchTable } from '../src/bench/table'
import type { OutsideList } from '../src/bench/outside'
import type { StressDeclaration } from '../src/bench/stress'
import { ENGINE_VERSION, ENGINE_VERSIONS } from '../src/version'
import { defaultLegalRuleset } from '../src/legal/index'

const VERIFY = join(dirname(fileURLToPath(import.meta.url)), '..')
const BENCH = join(VERIFY, 'docs', 'bench')
const BENCH_MD = join(VERIFY, 'docs', 'BENCH.md')
const CHANGELOG = join(VERIFY, 'CHANGELOG.md')
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const bench = (args: string[]): { code: number; err: string } => { let err = ''; const code = runBench(args, { out: () => {}, err: s => { err += s } }); return { code, err } }

/** One shipped table that reruns from the tree, so the page prints its rerun paragraph (where the engine label sits). */
const table = JSON.parse(readFileSync(join(BENCH, 'legal-blind-2.json'), 'utf8')) as BenchTable
const page = (extras: IndexExtras = {}): string => renderBenchIndex([table], new Map([[table.id, 'x'.repeat(64)]]), null, null, { folders: new Set([table.id]), ...extras })

describe('the engine labels on the bench page come from the tree', () => {
  it('docs.ts writes no engine version as a literal', () => {
    const src = readFileSync(join(VERIFY, 'src', 'bench', 'docs.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const hits = src.split('\n').map((l, i) => `${i + 1}: ${l.trim()}`).filter(l => /(?<![\w.])\d+\.\d+\.\d+(?![\w.])/.test(l.replace(/^\d+: /, '')))
    expect(hits).toEqual([])
  })

  it('the open label is ENGINE_VERSION; the closed ones are those below it in ENGINE_VERSIONS, dated by the changelog', () => {
    const labels = engineLabels(readFileSync(CHANGELOG, 'utf8'))
    expect(labels.open).toBe(ENGINE_VERSION)
    expect(labels.closed).toEqual(ENGINE_VERSIONS.slice(0, ENGINE_VERSIONS.indexOf(ENGINE_VERSION)))
    expect(labels.dated.length).toBeGreaterThan(0)
    for (const d of labels.dated) { expect(labels.closed).toContain(d.version); expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/) }
    const p = page({ engine: labels })
    expect(p).toContain(`Engine ${ENGINE_VERSION}, the label today's build carries, is open;`)
    expect(p).not.toMatch(/\d+\.\d+\.\d+, the label today's build carries, is still open/)
    // with no changelog the version file alone still states it
    expect(page()).toContain(`Engine ${ENGINE_VERSION}, the label today's build carries, is open;`)
  })

  it('a different version file moves the sentence with it: nothing in it is typed', () => {
    const cl = '**1.1.0 closed on 2027-01-02, when 2.0.0 was opened above it; 2.0.0 is open.**\n\nEngines 1.0.0 to 1.1.0\nare closed; 2.0.0, the label this tree builds, is open.\n'
    const p = page({ engine: engineLabels(cl, { versions: ['1.0.0', '1.1.0', '2.0.0'], open: '2.0.0' }) })
    expect(p).toContain('Engine 2.0.0, the label today\'s build carries, is open; engines 1.0.0 to 1.1.0 are closed (1.1.0 on 2027-01-02).')
    const one = page({ engine: engineLabels(null, { versions: ['1.0.0', '2.0.0'], open: '2.0.0' }) })
    expect(one).toContain('Engine 2.0.0, the label today\'s build carries, is open; engine 1.0.0 is closed.')
  })

  it('a changelog that calls the open label closed, or disagrees with the version file, refuses, and bench index writes nothing', () => {
    expect(() => engineLabels(`**${ENGINE_VERSION} closed on 2026-10-20, when 9.9.9 was opened above it.**\n`)).toThrow(/closed on 2026-10-20, but it is the label this build carries/)
    expect(() => engineLabels('**0.0.0 closed on 2026-10-20.**\n')).toThrow(/no such label below/)
    expect(() => engineLabels('Engines 0.0.1 to 0.6.0\nare closed; 0.7.0, the label this tree builds, is open.\n')).toThrow(/but the version file says/)
    const root = mkdtempSync(join(tmpdir(), 'bench-labels-')); dirs.push(root)
    const tables = join(root, 'packages', 'verify', 'docs', 'bench')
    mkdirSync(tables, { recursive: true })
    writeFileSync(join(root, 'packages', 'verify', 'CHANGELOG.md'), `# changelog\n\n**${ENGINE_VERSION} closed on 2026-10-20, when 9.9.9 was opened above it.**\n`)
    const md = join(root, 'BENCH.md'), misses = join(root, 'MISSES.md')
    const r = bench(['index', tables, '--bench-md', md, '--misses-md', misses])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED \(page-stale\): CHANGELOG\.md says/)
    for (const f of [md, misses, join(tables, '_misses-ledger.json')]) expect(existsSync(f), f).toBe(false)
  })
})

describe('the re-bank history of the AP stress rows is read from the amendment file', () => {
  const decl: StressDeclaration = { format: 'bench-stress/1', title: 'demo', harness: 'bench/ap/stress.ts', rows: 'bench/ap/results', pack: 'packages/verify/src/ap', amendment: 'ap-blind/AMENDMENT.md', files: ['stress-P1_order-holdout1.jsonl'] }
  const text = [
    '# Amendment to the stress results, 2026-10-05: re-banked under engine 1',
    '', 'Body.', '',
    '**Re-bank, 2026-10-05 18:55Z (same protocol, digest only).** The digest moved.',
    '',
    '## Second amendment, 2026-10-06 00:18Z (20:18 EDT on 2026-10-05): re-banked after a review',
    '', 'Body.', '',
    '## Third amendment, 2026-10-14: re-banked, digest only',
    '', '| file | sha256 |', '|---|---|', '',
  ].join('\n')

  it('counts every amendment and every dated re-bank inside one, by date, and names the last two', () => {
    const h = rebankHistory(text)
    expect(h.amendments).toBe(3)
    expect(h.rebanks.map(r => r.date)).toEqual(['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-14'])
    expect(h.rebanks.map(r => r.title)).toEqual([
      'Amendment to the stress results, 2026-10-05: re-banked under engine 1',
      'Re-bank, 2026-10-05 18:55Z (same protocol, digest only)',
      'Second amendment, 2026-10-06 00:18Z (20:18 EDT on 2026-10-05): re-banked after a review',
      'Third amendment, 2026-10-14: re-banked, digest only',
    ])
    const p = page({ stress: decl, stressAmendment: text })
    expect(p).toContain('**Re-bank history, from that file.** The rows were re-banked 4 times over 3 amendments: 2 on 2026-10-05, 1 on 2026-10-06, 1 on 2026-10-14.')
    expect(p).toContain('The last two: "Second amendment, 2026-10-06 00:18Z (20:18 EDT on 2026-10-05): re-banked after a review"; "Third amendment, 2026-10-14: re-banked, digest only".')
  })

  it('a typed count elsewhere on the page that disagrees with the file is called out, not left to contradict it', () => {
    const provenance = { format: 'bench-provenance/1', entries: [{ id: 'p', title: 'P', tier: 'transcribed; provenance archived; prereg unhashed', run: { id: 'r', date: '2026-10-05', engine_version: null }, provenance: { path: 'ap-blind/P.md', sha256: 'a'.repeat(64) }, why_not_a_table: 'w', rows: [{ claim: 'stress rows (re-banked three times under a pack that kept changing)', k: 0, n: 10, rate: 0, ci95: [0, 0.28], method: 'wilson', verdict: 'INSUFFICIENT', bar: null, note: '' }] }] }
    const stale = page({ stress: decl, stressAmendment: text, provenance: provenance as never, provenanceSha: 'b'.repeat(64) })
    expect(stale).toContain('Typed text further down this page says the rows were re-banked three times; the amendment file records 4 re-banks')
    const right = JSON.parse(JSON.stringify(provenance).replace('three times', 'four times'))
    expect(page({ stress: decl, stressAmendment: text, provenance: right, provenanceSha: 'b'.repeat(64) })).not.toContain('Typed text further down this page')
  })

  it('on the shipped tree the history reaches the last re-bank in the file, and BENCH.md carries it', () => {
    const shipped = JSON.parse(readFileSync(join(BENCH, '_stress.json'), 'utf8')) as StressDeclaration
    const h = rebankHistory(readFileSync(join(BENCH, shipped.amendment), 'utf8'))
    const last = h.rebanks.at(-1)!
    expect(h.rebanks.length).toBeGreaterThanOrEqual(h.amendments)
    expect(readFileSync(BENCH_MD, 'utf8')).toContain(`"${last.title}"`)
  })
})

describe('the default legal rule is listed under "Outside the rule", or the page says it is not', () => {
  const v = defaultLegalRuleset().version
  const base: OutsideList = { format: 'bench-outside/1', entries: [{ id: 'other', title: 'Something else', where: 'X.md', numbers: '1 of 2', reason: 'a reason' }] }

  it('a list with no row for it says so in a generated line; a row for it, or a table under it, clears the line', () => {
    const missing = page({ outside: base, outsideSha: 'y'.repeat(64) })
    expect(missing).toContain(`**Not on this list:** \`legal@${v}\`, the default legal rule this build issues new verdicts under, has no row here and no table`)
    const listed: OutsideList = { ...base, entries: [...base.entries, { id: 'legal-default', title: `legal@${v}, the default legal rule, post-hoc`, where: 'LEGAL.md', numbers: 'n', reason: 'r' }] }
    expect(page({ outside: listed, outsideSha: 'y'.repeat(64) })).not.toContain('**Not on this list:**')
    const near: OutsideList = { ...base, entries: [...base.entries, { id: 'legal-near', title: `legal@${v}9, a later rule`, where: 'LEGAL.md', numbers: 'n', reason: 'r' }] }
    expect(page({ outside: near, outsideSha: 'y'.repeat(64) })).toContain('**Not on this list:**')
    const tabled = { ...table, run: { ...table.run, ruleset: `legal@${v}` } } as BenchTable
    expect(renderBenchIndex([tabled], new Map([[table.id, 'x'.repeat(64)]]), null, null, { outside: base, outsideSha: 'y'.repeat(64) })).not.toContain('**Not on this list:**')
  })

  it('the shipped BENCH.md names the default legal rule', () => {
    expect(readFileSync(BENCH_MD, 'utf8')).toContain(`legal@${v}`)
  })
})
