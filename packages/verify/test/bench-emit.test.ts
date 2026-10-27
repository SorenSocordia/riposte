/**
 * `emitTable` (src/bench/emit.ts) and the four run-shape adapters: items, summary, transcribed, native. Each fixture is a
 * small run folder written to a temporary directory: a prereg with its sidecar, results, and a spec.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { emitTable } from '../src/bench/emit'
import { BenchRefused } from '../src/bench/prereg'
import { makeRow, tableBytes, tableProblems } from '../src/bench/table'
import { renderBenchIndex } from '../src/bench/docs'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const refusal = (f: () => unknown): string => { try { f(); return 'no refusal' } catch (e) { return e instanceof BenchRefused ? `${e.code}: ${e.message}` : `other: ${(e as Error).message}` } }

/** A run folder with a hashed prereg; returns its path. */
function runFolder(files: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), 'bench-emit-')); dirs.push(d)
  writeFileSync(join(d, 'PREREG.md'), 'Bar: 0 PASS on the known-bad items.\n')
  writeFileSync(join(d, 'PREREG.sha256'), `${sha('Bar: 0 PASS on the known-bad items.\n')} *PREREG.md\n`)
  for (const [name, v] of Object.entries(files)) {
    const p = join(d, ...name.split('/'))
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 1))
  }
  return d
}

const ITEMS = {
  engine_version: '0.0.1',
  rows: [
    { id: 'KB01', set: 'known-bad', outcome: 'ABSTAIN', reason: 'SPAN_NOT_FOUND' },
    { id: 'KB02', set: 'known-bad', outcome: 'FAIL', reason: null },
    { id: 'CT01', set: 'control', outcome: 'FAIL', reason: null, note: 'a trailing period' },
    { id: 'CT02', set: 'control', outcome: 'PASS', reason: null },
    { id: 'CT03', set: 'control', outcome: 'PASS', reason: null },
  ],
}
const itemsSpec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  spec: 'bench-spec/1', id: 'demo-items', title: 'Items demo', adapter: 'items', label: 'blind', blind: true, items: 'rows',
  run: { id: 'run-blind', date: '2026-10-03', engine_version: { $from: 'engine_version' }, ruleset: 'legal@0.0.1' },
  rows: [
    { claim: 'known-bad certified PASS', where: { set: 'known-bad' }, hit: { outcome: 'PASS' }, method: 'wilson', bar: { text: '0 PASS on the known-bad items', test: { k: { eq: 0 } } }, reported: { k: 0, n: 2 } },
    { claim: 'controls PASS', where: { set: 'control' }, hit: { outcome: 'PASS' }, method: 'wilson', reported: { k: 3, n: 3 } },
  ],
  misses_from: [{ where: { set: 'control', outcome: 'FAIL' }, id: '${id}', kind: 'false-fail', description: '${id}: FAIL on a genuine quotation (${note})', post_hoc: false, fixed_by: 'X2b / legal@0.1.0' }],
  misses: [{ id: 'P3', kind: 'prediction', description: 'prediction 3 was wrong: KB01 abstained', post_hoc: false }],
  ...over,
})

describe('the items adapter', () => {
  it('counts n and k per row, computes verdicts, generates misses, and records every hash', () => {
    const d = runFolder({ 'results/run.json': ITEMS, 'spec.json': itemsSpec() })
    const { table, findings } = emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', cwd: d })
    expect(tableProblems(table)).toEqual([])
    expect(table.prereg).toMatchObject({ path: 'PREREG.md', frozen_sha256: sha('Bar: 0 PASS on the known-bad items.\n'), amendments: [] })
    expect(table.run).toMatchObject({ id: 'run-blind', engine_version: '0.0.1', ruleset: 'legal@0.0.1', results: { path: 'results/run.json' } })
    expect(table.run.results!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(table.rows.map(r => [r.claim, r.k, r.n, r.verdict, r.method])).toEqual([
      ['known-bad certified PASS', 0, 2, 'PASS', 'wilson'],
      ['controls PASS', 2, 3, 'INSUFFICIENT', 'wilson'],
    ])
    expect(table.misses).toEqual([
      { id: 'P3', kind: 'prediction', description: 'prediction 3 was wrong: KB01 abstained', post_hoc: false },
      { id: 'CT01', kind: 'false-fail', description: 'CT01: FAIL on a genuine quotation (a trailing period)', post_hoc: false, fixed_by: 'X2b / legal@0.1.0' },
    ])
    // the report said 3 of 3 controls PASS; the results say 2 of 3: printed, kept, never reconciled
    expect(findings).toEqual(['"controls PASS": computed 2 of 3 from the results; the run\'s report states 3 of 3'])
    expect(table.findings).toEqual(findings)
    expect(table.rows[1]!.note).toMatch(/differs from the report \(3 of 3\)/)
  })

  it('emits the same bytes twice (no clock, no randomness)', () => {
    const d = runFolder({ 'results/run.json': ITEMS, 'spec.json': itemsSpec() })
    const a = tableBytes(emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', cwd: d }).table)
    const b = tableBytes(emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', cwd: d }).table)
    expect(a).toBe(b)
  })

  it('reads JSONL and TSV items, and where-operators', () => {
    const jsonl = ITEMS.rows.map(r => JSON.stringify(r)).join('\n')
    const tsv = 'id\tset\toutcome\n' + ITEMS.rows.map(r => `${r.id}\t${r.set}\t${r.outcome}`).join('\n') + '\n'
    for (const [file, items] of [['r.jsonl', ''], ['r.tsv', '']] as const) {
      const d = runFolder({ [file]: file.endsWith('.jsonl') ? jsonl : tsv, 'spec.json': itemsSpec({ items: items, run: { id: 'r', date: '2026-10-03', engine_version: '0.0.1' }, rows: [{ claim: 'not PASS', where: { outcome: { $ne: 'PASS' } }, hit: { id: { $re: '^CT' } }, method: 'clopper-pearson' }], misses_from: [] }) })
      const { table } = emitTable({ prereg: 'PREREG.md', results: file, spec: 'spec.json', cwd: d })
      expect(table.rows[0]).toMatchObject({ n: 3, k: 1, method: 'clopper-pearson' })
    }
  })
})

describe('the summary adapter, over a results directory', () => {
  it('reads n and k at JSON paths in named files', () => {
    const d = runFolder({
      'results/summary.json': { audit: { n: 200, confirmed: 196 }, counts: { decided: 209254, inScope: 209975 } },
      'results/labels.json': { auditor: 'harness author' },
      'spec.json': {
        spec: 'bench-spec/1', id: 'demo-summary', title: 'Summary demo', adapter: 'summary', label: 'blind', blind: true,
        files: { summary: 'summary.json', labels: 'labels.json' },
        run: { id: 'run-blind', date: '2026-10-03', engine_version: '0.0.1', ruleset: 'bpi-threeway-value@1.0.0' },
        rows: [
          { claim: 'audited precision', n: { $from: 'summary:audit.n' }, k: { $from: 'summary:audit.confirmed' }, method: 'wilson', bar: { text: 'Wilson lower bound >= 0.80', test: { ci_lo: { ge: 0.8 } } }, reported: { k: 196, n: 200 } },
          { claim: 'coverage in scope', n: { $from: 'summary:counts.inScope' }, k: { $from: 'summary:counts.decided' }, method: 'wilson' },
        ],
        misses: [{ id: 'A-1', kind: 'audited-false', description: 'one flag read FALSE on audit: a mapping gap', post_hoc: false }],
      },
    })
    const { table, findings } = emitTable({ prereg: 'PREREG.md', results: 'results', spec: 'spec.json', cwd: d })
    expect(findings).toEqual([])
    expect(table.rows[0]).toMatchObject({ k: 196, n: 200, rate: 0.98, verdict: 'PASS' })
    expect(table.rows[0]!.ci95[0]).toBeCloseTo(0.9497, 4)
    expect(table.rows[1]!.verdict).toBe('INSUFFICIENT')
    expect(table.run.results!.path).toBe('results')
  })

  it('refuses a directory whose files the spec does not name, and a missing file', () => {
    const d = runFolder({ 'results/summary.json': {}, 'spec.json': { spec: 'bench-spec/1', id: 's', title: 'S', adapter: 'summary', label: 'blind', blind: true, run: { id: 'r', date: '2026-10-03' }, rows: [] } })
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results', spec: 'spec.json', cwd: d }))).toMatch(/^no-results: .*must name the files/)
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'nowhere.json', spec: 'spec.json', cwd: d }))).toMatch(/^no-results: the results nowhere.json do not exist/)
  })
})

describe('the transcribed adapter', () => {
  const spec = { spec: 'bench-spec/1', id: 'demo-transcribed', title: 'Red team findings', adapter: 'transcribed', label: 'transcribed', blind: false, run: { id: 'red team', date: '2026-10-03', engine_version: null, ruleset: null }, rows: [], misses: [{ id: 'F1', kind: 'S0', description: 'a bracket swapping a modal PASSes', post_hoc: false, fixed_by: 'FIX-V / legal@0.2.0' }] }
  it('names its report by sha256 and records misses only', () => {
    const d = runFolder({ 'spec.json': spec, 'report.md': '# findings\n' })
    const { table } = emitTable({ prereg: 'PREREG.md', spec: 'spec.json', report: 'report.md', cwd: d })
    expect(table.label).toBe('transcribed')
    expect(table.run.report).toEqual({ name: 'report.md', sha256: sha('# findings\n') })
    expect(table.run.results).toBeUndefined()
    expect(table.rows).toEqual([])
    expect(tableProblems(table)).toEqual([])
  })
  it('prints a misses-only table with its scope note in the prereg\'s place and no engine claim; a table with rows keeps "Prereg"', () => {
    const d = runFolder({ 'spec.json': spec, 'report.md': '# findings\n' })
    const { table } = emitTable({ prereg: 'PREREG.md', spec: 'spec.json', report: 'report.md', cwd: d })
    const page = renderBenchIndex([table], new Map([[table.id, 'x'.repeat(64)]]), null, null)
    expect(page).toContain('**Scope note, in the prereg\'s place:** `PREREG.md`')
    expect(page).toContain('**Engine:** no numbers: this table records misses only. Each miss carries its own date.')
    expect(page).not.toContain('the run used its own scripts')
    expect(page).toContain('No rows: this table records misses only.')
    const withRows = { ...table, label: 'post-hoc' as const, rows: [makeRow({ claim: 'c', n: 2, k: 1, method: 'wilson' })], run: { ...table.run, results: { path: 'r.json', sha256: 'y'.repeat(64) } } }
    const page2 = renderBenchIndex([withRows], new Map([[table.id, 'x'.repeat(64)]]), null, null)
    expect(page2).toContain('**Prereg:** `PREREG.md`')
    expect(page2).not.toContain('Scope note')
  })
  it('refuses without the report, and refuses results it does not read', () => {
    const d = runFolder({ 'spec.json': spec, 'r.json': {} })
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', spec: 'spec.json', cwd: d }))).toMatch(/^no-report/)
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', spec: 'spec.json', results: 'r.json', report: 'r.json', cwd: d }))).toMatch(/^bad-spec/)
  })
})

describe('the native adapter', () => {
  it('takes rows from results already in the draft form', () => {
    const d = runFolder({
      'native.json': { rows: [{ claim: 'scripts as predicted', n: 8, k: 8, method: 'wilson', bar: { text: 'every script as predicted', test: { k: { eq: '$n' } } } }] },
      'spec.json': { spec: 'bench-spec/1', id: 'demo-native', title: 'Native', adapter: 'native', label: 'demo', blind: false, run: { id: 'tabletop', date: '2026-10-03', engine_version: '0.3.0' }, rows: [] },
    })
    const { table } = emitTable({ prereg: 'PREREG.md', results: 'native.json', spec: 'spec.json', cwd: d })
    expect(table.rows[0]).toMatchObject({ verdict: 'PASS', k: 8, n: 8 })
  })
  it('refuses a native row that names no CI method', () => {
    const d = runFolder({ 'native.json': { rows: [{ claim: 'x', n: 8, k: 8 }] }, 'spec.json': { spec: 'bench-spec/1', id: 'n', title: 'N', adapter: 'native', label: 'demo', blind: false, run: { id: 'r', date: '2026-10-03' }, rows: [] } })
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'native.json', spec: 'spec.json', cwd: d }))).toMatch(/^no-ci-method/)
  })
})

describe('refusals: nothing is emitted', () => {
  it('without a recorded prereg hash, before the results are even read', () => {
    const d = runFolder({ 'results/run.json': ITEMS, 'spec.json': itemsSpec() })
    rmSync(join(d, 'PREREG.sha256'))
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', cwd: d }))).toMatch(/^no-recorded-hash/)
  })
  it('a spec row without a CI method; k > n; a malformed bar; a tuned value without its trace', () => {
    const noMethod = itemsSpec({ rows: [{ claim: 'x', where: {}, hit: {} }] })
    const d = runFolder({ 'results/run.json': ITEMS, 'a.json': noMethod, 'b.json': itemsSpec({ adapter: 'summary', items: undefined, misses_from: undefined, rows: [{ claim: 'x', n: 2, k: 3, method: 'wilson' }] }), 'c.json': itemsSpec({ rows: [{ claim: 'x', where: {}, method: 'wilson', bar: { text: 't', test: { k: { approx: 0 } } } }] }), 'd.json': itemsSpec({ tuning: { knob: 'k', range: [0, 1], objective: 'o', heldout: 'h', trace: [], chosen: 0.5 } }) })
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'a.json', cwd: d }))).toMatch(/^no-ci-method/)
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'b.json', cwd: d }))).toMatch(/^bad-row: .*k must be an integer in \[0, n\]/)
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'c.json', cwd: d }))).toMatch(/^bad-spec: .*unknown operator/)
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'd.json', cwd: d }))).toMatch(/^tuning-without-trace/)
  })
  it('a label that over-claims: blind: true on a post-hoc run', () => {
    const d = runFolder({ 'results/run.json': ITEMS, 'spec.json': itemsSpec({ label: 'post-hoc' }) })
    expect(refusal(() => emitTable({ prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', cwd: d }))).toMatch(/^bad-table: .*blind: true goes with label "blind" only/)
  })
})
