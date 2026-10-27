/**
 * `verify bench emit | index | check` through the CLI's own `run()` (src/cli.ts → src/bench/cli-bench.ts): exit codes, what
 * is written, and that a refusal writes nothing.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { run } from '../src/cli'
import { findBareFigures, blocksOf } from '../src/bench/marker'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
function cli(args: string[]): { code: number; out: string; err: string } {
  let out = '', err = ''
  const code = run(args, { out: s => { out += s }, err: s => { err += s } })
  return { code, out, err }
}

function fixture(): { d: string; spec: string; prereg: string; results: string; tables: string } {
  const d = mkdtempSync(join(tmpdir(), 'bench-cli-')); dirs.push(d)
  writeFileSync(join(d, 'PREREG.md'), 'Bar: 0 wrong PASS.\n')
  writeFileSync(join(d, 'PREREG.sha256'), `${sha('Bar: 0 wrong PASS.\n')} *PREREG.md\n`)
  writeFileSync(join(d, 'results.json'), JSON.stringify({ docs: [{ id: 'D01', arm: 'defect', cls: 'caught' }, { id: 'D02', arm: 'defect', cls: 'WRONG_PASS' }, { id: 'C01', arm: 'clean', cls: 'correct_pass' }] }))
  writeFileSync(join(d, 'spec.json'), JSON.stringify({
    spec: 'bench-spec/1', id: 'cli-demo', title: 'CLI demo', adapter: 'items', label: 'blind', blind: true, items: 'docs',
    run: { id: 'run 1', date: '2026-10-03', engine_version: '0.1.0', ruleset: 'demo@0.1.0' },
    rows: [{ claim: 'planted defects certified PASS', where: { arm: 'defect' }, hit: { cls: 'WRONG_PASS' }, method: 'wilson', bar: { text: '0 wrong PASS', test: { k: { eq: 0 } } } }],
    misses_from: [{ where: { cls: 'WRONG_PASS' }, id: '${id}', kind: 'wrong-pass', description: '${id}: a planted defect certified PASS (ruleset gap)', post_hoc: false }],
  }))
  mkdirSync(join(d, 'tables'))
  return { d, spec: join(d, 'spec.json'), prereg: join(d, 'PREREG.md'), results: join(d, 'results.json'), tables: join(d, 'tables') }
}

describe('verify bench emit', () => {
  it('writes the table and summarizes it; exit 0', () => {
    const f = fixture()
    const out = join(f.tables, 'cli-demo.json')
    const r = cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', out])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/cli-demo: 1 row\(s\) \(PASS 0 · FAIL 1 · INSUFFICIENT 0\), 1 miss\(es\), label blind/)
    const t = JSON.parse(readFileSync(out, 'utf8'))
    expect(t.rows[0]).toMatchObject({ k: 1, n: 2, verdict: 'FAIL', method: 'wilson' })
  })

  it('a row held to another run\'s bar is counted apart in the summary, never as PASS', () => {
    const f = fixture()
    const spec = JSON.parse(readFileSync(f.spec, 'utf8'))
    spec.label = 'post-hoc'; spec.blind = false
    spec.rows[0].bar.reused_from = 'an earlier run\'s prereg'
    writeFileSync(f.spec, JSON.stringify(spec))
    const out = join(f.tables, 'cli-demo.json')
    const r = cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', out])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/cli-demo: 1 row\(s\) \(PASS 0 · FAIL 0 · INSUFFICIENT 0 · POST-HOC 1 \(another run's bar, no verdict\)\), 1 miss\(es\), label post-hoc/)
    expect(JSON.parse(readFileSync(out, 'utf8')).rows[0].verdict).toBe('POST-HOC')
  })

  it('refuses without a recorded prereg hash: exit 1, nothing written', () => {
    const f = fixture()
    rmSync(join(f.d, 'PREREG.sha256'))
    const out = join(f.tables, 'cli-demo.json')
    const r = cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', out])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED \(no-recorded-hash\)/)
    expect(existsSync(out)).toBe(false)
  })

  it('usage errors exit 3', () => {
    const f = fixture()
    expect(cli(['bench', 'emit', f.prereg, f.results]).code).toBe(3)
    expect(cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--bogus', 'x']).code).toBe(3)
    expect(cli(['bench', 'tune']).code).toBe(3)
    expect(cli(['bench', '--help']).code).toBe(0)
  })
})

describe('verify bench check', () => {
  it('MATCH when the table is its run\'s current emission, DIFFERS otherwise', () => {
    const f = fixture()
    const out = join(f.tables, 'cli-demo.json')
    expect(cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', out]).code).toBe(0)
    const ok = cli(['bench', 'check', out, f.prereg, f.results, '--spec', f.spec])
    expect(ok.code).toBe(0)
    expect(ok.err).toMatch(/MATCH/)
    writeFileSync(out, readFileSync(out, 'utf8').replace('"k": 1', '"k": 0'))
    const bad = cli(['bench', 'check', out, f.prereg, f.results, '--spec', f.spec])
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/DIFFERS/)
  })
})

describe('verify bench index', () => {
  it('generates the index page and the ledger page; every figure sits in a block naming its JSON', () => {
    const f = fixture()
    expect(cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', join(f.tables, 'cli-demo.json')]).code).toBe(0)
    const bench = join(f.d, 'BENCH.md'), misses = join(f.d, 'MISSES.md')
    const r = cli(['bench', 'index', f.tables, '--bench-md', bench, '--misses-md', misses])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/1 table\(s\), 0 refused or withdrawn run\(s\), 0 provenance row set\(s\), 0 outside-the-rule row\(s\); ledger 1 row\(s\) \(1 added, 0 newly fixed\)/)
    for (const page of [bench, misses]) {
      const text = readFileSync(page, 'utf8')
      expect(findBareFigures(text)).toEqual([])
      expect(blocksOf(text).problems).toEqual([])
    }
    const block = blocksOf(readFileSync(bench, 'utf8')).blocks[0]!
    expect(block).toMatchObject({ kind: 'table', id: 'cli-demo', sha256: sha(readFileSync(join(f.tables, 'cli-demo.json'))) })
    const ledgerBlock = blocksOf(readFileSync(misses, 'utf8')).blocks[0]!
    expect(ledgerBlock.sha256).toBe(sha(readFileSync(join(f.tables, '_misses-ledger.json'))))
    expect(readFileSync(misses, 'utf8')).toMatch(/\| 2026-10-03 \| `cli-demo` \| D02 \| wrong-pass \| D02: a planted defect certified PASS \(ruleset gap\) \| no \| open \|/)
  })

  it('refuses to drop a ledger row: exit 1, the ledger and pages untouched', () => {
    const f = fixture()
    const table = join(f.tables, 'cli-demo.json')
    expect(cli(['bench', 'emit', f.prereg, f.results, '--spec', f.spec, '--out', table]).code).toBe(0)
    expect(cli(['bench', 'index', f.tables]).code).toBe(0)
    const ledger = join(f.tables, '_misses-ledger.json')
    const before = readFileSync(ledger, 'utf8')
    rmSync(table)
    const r = cli(['bench', 'index', f.tables, '--misses-md', join(f.d, 'MISSES.md')])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED \(drop\): miss cli-demo#D02/)
    expect(readFileSync(ledger, 'utf8')).toBe(before)
    expect(existsSync(join(f.d, 'MISSES.md'))).toBe(false)
  })
})
