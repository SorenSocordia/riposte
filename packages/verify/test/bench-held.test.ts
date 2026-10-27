/**
 * Tables held from a tree (bench/held.ts, `docs/bench/_held.json`): the list's shape; the misses ledger keeps a held table's rows
 * as recorded and in place, so its bytes are the same whether the table ships or is held; MISSES.md marks those rows and changes
 * nothing else in them; BENCH.md lists the held tables by name with no numbers; `bench index` and `bench check` read the list.
 * The last block holds tables of the shipped tree itself and checks that the ledger's rows, and their order, do not move.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import { HELD_FILE, HELD_FORMAT, HELD_MARK, heldIds, heldProblems, readHeld, type HeldList } from '../src/bench/held'
import { asLedger, ledgerBytes, ledgerSources, mergeLedger, type Ledger, type LedgerSource } from '../src/bench/ledger'
import { renderBenchIndex, renderMisses, withdrawnLabels, type RefusedList } from '../src/bench/docs'
import { blocksOf, findBareFigures } from '../src/bench/marker'
import { listTableFiles } from '../src/bench/spec'
import type { BenchTable } from '../src/bench/table'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
const list = (...ids: string[]): HeldList => ({ format: HELD_FORMAT, tables: ids.map(id => ({ id, reason: 'not yet published' })) })
const src = (id: string, misses: string[]): LedgerSource => ({ id, run: { date: '2026-10-04' }, misses: misses.map(m => ({ id: m, kind: 'data-defect', description: `${m}: a defect in ${id}`, post_hoc: false })) })

/** The rows of a MISSES.md page's ledger block, as printed lines. */
function ledgerLines(page: string): string[] {
  const b = blocksOf(page).blocks.find(x => x.kind === 'ledger')!
  return page.split('\n').slice(b.from + 2, b.to - 1)
}
/** A row as it prints with its table held: the mark after the table's id, nothing else changed. */
const marked = (line: string, table: string): string => line.replace(`| \`${table}\` |`, `| \`${table}\` (${HELD_MARK}) |`)

describe('the held list', () => {
  it('a well-formed list has no problems; a table cannot be both held and in the directory', () => {
    expect(heldProblems(list('sci-x'), new Set(['doc-a']))).toEqual([])
    expect(heldProblems(list('sci-x'), new Set(['sci-x'])).join()).toMatch(/sci-x is held, but sci-x\.json is in the directory/)
    expect(heldProblems(list('sci-x'), new Set(), new Set(['sci-x'])).join()).toMatch(/sci-x is held, but its folder is in the directory/)
  })

  it('refuses a bad shape, a repeated id, an empty reason and a reason that carries a figure', () => {
    expect(heldProblems({ tables: [] }, new Set())).toHaveLength(1)
    expect(heldProblems(list('a', 'a'), new Set()).join()).toMatch(/a is listed twice/)
    expect(heldProblems({ format: HELD_FORMAT, tables: [{ id: 'a', reason: ' ' }] }, new Set()).join()).toMatch(/names no reason/)
    for (const reason of ['held until 3/4 of it is checked', 'held at 50% done']) {
      expect(heldProblems({ format: HELD_FORMAT, tables: [{ id: 'a', reason }] }, new Set()).join()).toMatch(/carries a figure/)
    }
  })

  it('a directory with no list has none; a list that is not JSON is a problem', () => {
    const d = mkdtempSync(join(tmpdir(), 'bench-held-')); dirs.push(d)
    expect(readHeld(d, new Set())).toEqual({ held: null, problems: [] })
    writeFileSync(join(d, HELD_FILE), '{ not json')
    expect(readHeld(d, new Set()).problems.join()).toMatch(/is not JSON/)
  })
})

describe('the ledger with a held table', () => {
  const A = src('doc-a', ['a1', 'a2']), S = src('sci-x', ['s1', 's2', 's3']), B = src('doc-b', ['b1'])
  const prior = mergeLedger(null, [A, S, B]).ledger // the held table's rows sit in the middle

  it('keeps the held table\'s rows as recorded and in place: the ledger\'s bytes are the same with the table present or held', () => {
    const on = mergeLedger(prior, [A, S, B])
    const off = mergeLedger(prior, [A, B], new Set(['sci-x']))
    expect(ledgerBytes(off.ledger)).toBe(ledgerBytes(on.ledger))
    expect(ledgerBytes(off.ledger)).toBe(ledgerBytes(prior))
    expect(off.ledger.rows.map(r => r.key)).toEqual(prior.rows.map(r => r.key))
    expect([on.added, off.added]).toEqual([0, 0])
  })

  it('without the list the same absence is a dropped row, and refuses', () => {
    expect(() => mergeLedger(prior, [A, B])).toThrow(/sci-x#s1 .* is in the ledger but in no table: the ledger never drops a row/)
  })

  it('a table both held and among the tables refuses', () => {
    expect(() => mergeLedger(prior, [A, S, B], new Set(['sci-x']))).toThrow(/sci-x are declared held but are among the tables/)
  })

  it('a new miss of a present table is still appended after every prior row', () => {
    const off = mergeLedger(prior, [A, src('doc-b', ['b1', 'b2'])], new Set(['sci-x']))
    expect(off.ledger.rows.map(r => r.key)).toEqual([...prior.rows.map(r => r.key), 'doc-b#b2'])
    expect(off.added).toBe(1)
  })
})

describe('MISSES.md with a held table', () => {
  const prior = mergeLedger(null, [src('doc-a', ['a1']), src('sci-x', ['s1', 's2']), src('doc-b', ['b1'])]).ledger
  const s = 'a'.repeat(64)

  it('prints every row in the same order; a held row differs only by the mark after its table id', () => {
    const on = ledgerLines(renderMisses(prior, s))
    const off = ledgerLines(renderMisses(prior, s, new Map(), new Set(['sci-x'])))
    expect(off).toHaveLength(on.length)
    prior.rows.forEach((r, i) => {
      if (r.table === 'sci-x') { expect(off[i]).not.toBe(on[i]); expect(off[i]).toBe(marked(on[i]!, 'sci-x')) } else expect(off[i]).toBe(on[i])
    })
  })

  it('says what the mark means, keeps every figure in its block, and with no held table reads as before', () => {
    const page = renderMisses(prior, s, new Map(), new Set(['sci-x']))
    expect(page).toContain(`A row marked "${HELD_MARK}" belongs to a table held from this tree`)
    expect(findBareFigures(page)).toEqual([])
    expect(blocksOf(page).problems).toEqual([])
    expect(renderMisses(prior, s, new Map(), new Set())).toBe(renderMisses(prior, s))
    expect(renderMisses(prior, s, new Map(), new Set(['no-rows-here']))).toBe(renderMisses(prior, s))
  })
})

describe('BENCH.md with held tables', () => {
  it('lists each held table by name, as held, with no numbers', () => {
    const page = renderBenchIndex([], new Map(), null, null, { held: list('sci-x', 'sci-y') })
    expect(page).toContain('## Held tables')
    expect(page).toContain('| `sci-x` | held: not yet published |')
    expect(page).toContain('| `sci-y` | held: not yet published |')
    expect(findBareFigures(page)).toEqual([])
    const section = page.slice(page.indexOf('## Held tables')).split(/\n## /)[0]!
    expect(section.replace(/`[^`]*`/g, '')).not.toMatch(/\d/)
    expect(page).toContain('they are held from this tree, listed under "Held tables" with no numbers')
  })

  it('with no list, no held section, and the page is the one written before the list existed', () => {
    const page = renderBenchIndex([], new Map(), null, null, {})
    expect(page).not.toContain('Held tables')
    expect(renderBenchIndex([], new Map(), null, null, { held: null })).toBe(page)
  })
})

describe('bench index and bench check read the held list', () => {
  const cli = (args: string[]): { code: number; err: string } => {
    let err = ''
    const code = run(args, { out: () => {}, err: x => { err += x } })
    return { code, err }
  }
  /** One emitted table with one miss, indexed once, so the ledger holds its row. */
  function indexed(): { d: string; tables: string; table: string; ledger: string } {
    const d = mkdtempSync(join(tmpdir(), 'bench-held-cli-')); dirs.push(d)
    writeFileSync(join(d, 'PREREG.md'), 'Bar: 0 wrong PASS.\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('Bar: 0 wrong PASS.\n')} *PREREG.md\n`)
    writeFileSync(join(d, 'results.json'), JSON.stringify({ docs: [{ id: 'D01', arm: 'defect', cls: 'caught' }, { id: 'D02', arm: 'defect', cls: 'WRONG_PASS' }, { id: 'C01', arm: 'clean', cls: 'correct_pass' }] }))
    writeFileSync(join(d, 'spec.json'), JSON.stringify({
      spec: 'bench-spec/1', id: 'cli-demo', title: 'CLI demo', adapter: 'items', label: 'blind', blind: true, items: 'docs',
      run: { id: 'run 1', date: '2026-10-03', engine_version: '0.1.0', ruleset: 'demo@0.1.0' },
      rows: [{ claim: 'planted defects certified PASS', where: { arm: 'defect' }, hit: { cls: 'WRONG_PASS' }, method: 'wilson', bar: { text: '0 wrong PASS', test: { k: { eq: 0 } } } }],
      misses_from: [{ where: { cls: 'WRONG_PASS' }, id: '${id}', kind: 'wrong-pass', description: '${id}: a planted defect certified PASS (ruleset gap)', post_hoc: false }],
    }))
    const tables = join(d, 'tables'); mkdirSync(tables)
    const table = join(tables, 'cli-demo.json')
    expect(run(['bench', 'emit', join(d, 'PREREG.md'), join(d, 'results.json'), '--spec', join(d, 'spec.json'), '--out', table], { out: () => {}, err: () => {} })).toBe(0)
    expect(cli(['bench', 'index', tables]).code).toBe(0)
    return { d, tables, table, ledger: join(tables, '_misses-ledger.json') }
  }

  it('index keeps a held table\'s row byte for byte, marks it, and lists the table; check reports it held', () => {
    const f = indexed()
    const before = readFileSync(f.ledger, 'utf8')
    rmSync(f.table)
    writeFileSync(join(f.tables, HELD_FILE), JSON.stringify(list('cli-demo'), null, 2))
    const bench = join(f.d, 'BENCH.md'), misses = join(f.d, 'MISSES.md')
    const r = cli(['bench', 'index', f.tables, '--bench-md', bench, '--misses-md', misses])
    expect(r.code, r.err).toBe(0)
    expect(r.err).toMatch(/0 table\(s\).*ledger 1 row\(s\) \(0 added, 0 newly fixed\); 1 table\(s\) held from this tree, their rows kept/)
    expect(readFileSync(f.ledger, 'utf8')).toBe(before)
    expect(readFileSync(misses, 'utf8')).toContain(`| 2026-10-03 | \`cli-demo\` (${HELD_MARK}) | D02 |`)
    expect(readFileSync(bench, 'utf8')).toContain('| `cli-demo` | held: not yet published |')
    const c = cli(['bench', 'check', f.tables])
    expect(c.err).toMatch(/OK\s+cli-demo: held from this tree \(_held\.json\): no table and no folder here/)
  })

  it('index refuses a list that holds a table still in the directory, and writes nothing', () => {
    const f = indexed()
    const before = readFileSync(f.ledger, 'utf8')
    writeFileSync(join(f.tables, HELD_FILE), JSON.stringify(list('cli-demo')))
    const r = cli(['bench', 'index', f.tables, '--misses-md', join(f.d, 'MISSES.md')])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED: _held\.json: .*cli-demo is held, but cli-demo\.json is in the directory/)
    expect(readFileSync(f.ledger, 'utf8')).toBe(before)
    expect(existsSync(join(f.d, 'MISSES.md'))).toBe(false)
    const c = cli(['bench', 'check', f.tables])
    expect(c.code).toBe(1)
    expect(c.err).toMatch(/FAIL\s+_held: .*cli-demo\.json is in the directory/)
  })
})

// The shipped tree: hold tables that are here (the `sci-` tables when present; otherwise the first two with misses) and check
// that the ledger regenerates to the same bytes, with every row in the same order, and that MISSES.md changes only by the mark.
const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'bench')
describe.skipIf(!existsSync(join(BENCH, '_misses-ledger.json')))('on the shipped tree, holding tables moves no ledger row', () => {
  const tables = listTableFiles(BENCH).map(f => JSON.parse(readFileSync(join(BENCH, f), 'utf8')) as BenchTable)
  const raw = readFileSync(join(BENCH, '_misses-ledger.json'))
  const ledger: Ledger = asLedger(JSON.parse(raw.toString('utf8')))
  const fileHeld = heldIds(readHeld(BENCH, new Set(tables.map(t => t.id))).held)
  const refusedPath = join(BENCH, '_refused.json')
  const refused = existsSync(refusedPath) ? (JSON.parse(readFileSync(refusedPath, 'utf8')) as RefusedList) : null
  const withdrawn = (refused?.runs ?? []).filter(r => r.code === 'withdrawn')
  const sci = tables.filter(t => t.id.startsWith('sci-')).map(t => t.id)
  const hold = sci.length ? sci : tables.filter(t => t.misses.length).slice(0, 2).map(t => t.id)
  const both = new Set([...fileHeld, ...hold])

  it('the ledger\'s bytes, rows and order are the same with those tables present and held', () => {
    expect(hold.length).toBeGreaterThan(0)
    const present = mergeLedger(ledger, ledgerSources(tables, withdrawn), fileHeld)
    const held = mergeLedger(ledger, ledgerSources(tables.filter(t => !hold.includes(t.id)), withdrawn), both)
    expect(ledgerBytes(present.ledger)).toBe(raw.toString('utf8'))
    expect(ledgerBytes(held.ledger)).toBe(raw.toString('utf8'))
    expect(held.ledger.rows.map(r => r.key)).toEqual(ledger.rows.map(r => r.key))
  })

  it('MISSES.md differs only by the mark, on exactly the held tables\' rows', () => {
    const labels = withdrawnLabels(refused)
    const on = ledgerLines(renderMisses(ledger, sha(raw), labels, fileHeld))
    const off = ledgerLines(renderMisses(ledger, sha(raw), labels, both))
    expect(off).toHaveLength(on.length)
    let n = 0
    ledger.rows.forEach((r, i) => {
      if (hold.includes(r.table)) { n++; expect(off[i]).toBe(marked(on[i]!, r.table)) } else expect(off[i]).toBe(on[i])
    })
    expect(n).toBe(ledger.rows.filter(r => hold.includes(r.table)).length)
    expect(n).toBeGreaterThan(0)
  })
})
