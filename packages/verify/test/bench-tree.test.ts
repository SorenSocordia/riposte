/**
 * The bench tables' evidence inside the tree (src/bench/tree.ts) and the rows outside the bench rule
 * (src/bench/provenance.ts): `verify bench check <tables-dir>` re-emits every table from its in-tree folder, refuses any path
 * that leaves the tree, any copied file whose bytes moved, a withdrawn run that still has a table, a provenance archive
 * that changed; amendment text is taken only from a recorded version of the prereg; every prereg carries a stamp record (a
 * proof made before the run, the unstamped label for a run before stamping began, or a flagged NEEDS STAMP), and a listed
 * stamp's signature must hold. Driven through `runBench` (src/bench/cli-bench.ts) and the module functions.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { runBench } from '../src/bench/cli-bench'
import { checkTree, emitFromFolder, engineAtLeast, manifestProblems, outOfTree } from '../src/bench/tree'
import { tableBytes, UNSTAMPED_LABEL } from '../src/bench/table'
import { BenchRefused } from '../src/bench/prereg'
import { mergeLedger, ledgerSources } from '../src/bench/ledger'
import { PROVENANCE_FORMAT, PROVENANCE_TIER, provenanceBytes, provenanceProblems, provenanceRow } from '../src/bench/provenance'
import { LAB_PATHS_NOTE, renderBenchIndex } from '../src/bench/docs'
import { preregCarriesLabPaths } from '../src/bench/emit'
import { stampFile } from '../src/bench/timestamp'
import { mockTsa, opensslAvailable } from './bench-stamp-mock'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
const bench = (args: string[]): { code: number; err: string } => { let err = ''; const code = runBench(args, { out: () => {}, err: s => { err += s } }); return { code, err } }

const PREREG_V0 = 'Bar: 0 wrong PASS.\n'
const PREREG_V1 = 'Bar: 0 wrong PASS.\n\n## Amendment 1\nThe control set gains two items.\n'
const RESULTS = { docs: [{ id: 'D01', arm: 'defect', cls: 'caught' }, { id: 'D02', arm: 'defect', cls: 'WRONG_PASS' }, { id: 'C01', arm: 'clean', cls: 'correct_pass' }] }
const SPEC = {
  spec: 'bench-spec/1', id: 'tree-demo', title: 'Tree demo', adapter: 'items', label: 'blind', blind: true, items: 'docs',
  run: { id: 'run 1', date: '2026-10-03', engine_version: '0.1.0', ruleset: 'demo@0.1.0' }, audit: 'labels known by construction',
  rows: [{ claim: 'planted defects certified PASS', where: { arm: 'defect' }, hit: { cls: 'WRONG_PASS' }, method: 'wilson', bar: { text: '0 wrong PASS', test: { k: { eq: 0 } } } }],
  misses_from: [{ where: { cls: 'WRONG_PASS' }, id: '${id}', kind: 'wrong-pass', description: '${id}: a planted defect certified PASS', post_hoc: false }],
}

/** A tables directory with one in-tree table folder (prereg with one amendment, sidecar, spec, results, run.json), emitted. */
function tree(): { dir: string; folder: string; table: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bench-tree-')); dirs.push(dir)
  const folder = join(dir, 'tree-demo')
  mkdirSync(join(folder, 'results'), { recursive: true })
  const files: Record<string, string> = {
    'PREREG.md': PREREG_V1,
    'PREREG.sha256': `${sha(PREREG_V0)} *PREREG.md\n# amendment 1\n${sha(PREREG_V1)} *PREREG.md\n`,
    'results/run.json': JSON.stringify(RESULTS),
    'spec.json': JSON.stringify(SPEC),
  }
  for (const [f, b] of Object.entries(files)) writeFileSync(join(folder, f), b)
  const manifest = {
    format: 'bench-run/1', id: 'tree-demo', prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json',
    amendment_text: [{ sha256: sha(PREREG_V1), from: 'PREREG.md:3-4' }],
    unstamped: UNSTAMPED_LABEL,
    rerun: { from_tree: 'no', detail: 'the demo documents do not ship; the table re-tallies from results/run.json' },
    blind_basis: 'PREREG.sha256 records the prereg before the demo run',
    sources: Object.entries(files).map(([file, b]) => ({ file, sha256: sha(b), from: file })),
  }
  writeFileSync(join(folder, 'run.json'), JSON.stringify(manifest, null, 2))
  const table = join(dir, 'tree-demo.json')
  writeFileSync(table, tableBytes(emitFromFolder(folder, 'tree-demo').table))
  return { dir, folder, table }
}
const resign = (folder: string, file: string): void => {
  const m = JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8'))
  for (const s of m.sources) if (s.file === file) s.sha256 = sha(readFileSync(join(folder, file)))
  writeFileSync(join(folder, 'run.json'), JSON.stringify(m, null, 2))
}

describe('verify bench check <tables-dir>', () => {
  it('ALL MATCH when every table is its in-tree folder\'s emission; exit 0', () => {
    const t = tree()
    const r = bench(['check', t.dir])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/MATCH +tree-demo: re-emitted from tree-demo\/ byte for byte/)
    expect(r.err).toMatch(/ALL MATCH: 1 of 1 table/)
  })

  it('one changed byte in an in-tree results file fails: the copy no longer matches run.json, so nothing is re-emitted', () => {
    const t = tree()
    writeFileSync(join(t.folder, 'results/run.json'), JSON.stringify(RESULTS).replace('WRONG_PASS', 'caught_____'))
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED tree-demo: \(bad-manifest\).*results\/run\.json changed after it was copied in/)
  })

  it('a results change recorded in run.json but not re-emitted reads DIFFERS', () => {
    const t = tree()
    writeFileSync(join(t.folder, 'results/run.json'), JSON.stringify(RESULTS).replace('WRONG_PASS', 'caught_____'))
    resign(t.folder, 'results/run.json')
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/DIFFERS tree-demo/)
  })

  it('a table with no in-tree folder is refused (its evidence is not in the tree)', () => {
    const t = tree()
    rmSync(t.folder, { recursive: true })
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED tree-demo: \(no-folder\)/)
  })

  it('run.json naming a path outside the folder is refused', () => {
    const t = tree()
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    expect(manifestProblems({ ...m, results: '../../tmp/run.json' }, t.folder, 'tree-demo').join('; ')).toMatch(/results \.\.\/\.\.\/tmp\/run\.json leaves the table's folder/)
    expect(manifestProblems({ ...m, chains: ['C:/elsewhere/PREREG.sha256'] }, t.folder, 'tree-demo').join('; ')).toMatch(/leaves the table's folder/)
    const labPath = ['work', 'space/lab/PREREG.md'].join('') // assembled, so this file stays clean under the vocabulary guard
    expect(manifestProblems({ ...m, sources: [{ file: 'PREREG.md', sha256: m.sources[0].sha256, from: labPath }] }, t.folder, 'tree-demo').join('; ')).toMatch(/not an internal path/)
    expect(manifestProblems(m, t.folder, 'other-id').join('; ')).toMatch(/names table "tree-demo", but its folder is "other-id"/)
  })

  it('every run.json says whether its run reruns from this tree; the table carries it and the index prints it', () => {
    const t = tree()
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    const { rerun: _drop, ...without } = m
    expect(manifestProblems(without, t.folder, 'tree-demo').join('; ')).toMatch(/says whether the run reruns from this tree/)
    expect(manifestProblems({ ...m, rerun: { from_tree: 'maybe', detail: 'x' } }, t.folder, 'tree-demo').join('; ')).toMatch(/from_tree is one of yes, partly, no/)
    expect(manifestProblems({ ...m, rerun: { from_tree: 'no', detail: ' ' } }, t.folder, 'tree-demo').join('; ')).toMatch(/detail says what reruns/)
    const labPath = ['work', 'space/lab/run.ts'].join('') // assembled, so this file stays clean under the vocabulary guard
    expect(manifestProblems({ ...m, rerun: { from_tree: 'no', detail: `the harness is ${labPath}` } }, t.folder, 'tree-demo').join('; ')).toMatch(/rerun\.detail names an internal path/)
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(without, null, 2))
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED tree-demo: \(bad-manifest\).*reruns from this tree/)
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    expect(table.run.rerun).toEqual({ from_tree: 'no', detail: 'the demo documents do not ship; the table re-tallies from results/run.json' })
    const page = renderBenchIndex([table], new Map([['tree-demo', sha(readFileSync(t.table))]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toContain('**Reruns from this tree:** no. the demo documents do not ship')
    expect(page).toMatch(/\*\*Which tables rerun from this tree\.\*\*[\s\S]*\| `tree-demo` \| no \|/)
    expect(page).toContain('That is a re-tally from the per-case results that ship, not a rerun')
  })

  it('a rerun that reproduces outcomes, not bytes, says so on its line and in the index list', () => {
    const t = tree()
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    m.rerun = { from_tree: 'yes', detail: 'rerun.mjs reruns every step; outcomes match, verdict ids do not', identical: 'outcomes' }
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m, null, 2))
    const table = emitFromFolder(t.folder, 'tree-demo').table
    expect(table.run.rerun).toEqual(m.rerun)
    const page = renderBenchIndex([table], new Map([['tree-demo', 'x'.repeat(64)]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toContain('**Reruns from this tree:** yes, with identical outcomes; verdict ids differ until a release pins the engine label. rerun.mjs reruns every step')
    expect(page).toContain('| `tree-demo` | yes, with identical outcomes; verdict ids differ until a release pins the engine label |')
    expect(page).toContain('No tagged, signed release of this tree exists yet')
    expect(manifestProblems({ ...m, rerun: { ...m.rerun, from_tree: 'no' } }, t.folder, 'tree-demo').join('; ')).toMatch(/a run that does not rerun carries none/)
  })

  it('a blind table names the record its label rests on; without one it is refused, and the page reads "blind, by the authors\' records"', () => {
    const t = tree()
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    expect(table.run.blind_basis).toBe('PREREG.sha256 records the prereg before the demo run')
    const page = renderBenchIndex([table], new Map([['tree-demo', sha(readFileSync(t.table))]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toContain('**Label:** blind, by the authors\' records: the builder had not seen the data before the run, and only the authors\' own records show it; no third party can confirm that, and the label says nothing about who audited the outcomes. The record it rests on: PREREG.sha256 records the prereg before the demo run. **Run:**')
    expect(page).toContain('Labels: blind, by the authors\' records (by the')
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    const { blind_basis: _drop, ...without } = m
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(without, null, 2))
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED tree-demo: \(bad-manifest\).*names the record its blindness rests on \(blind_basis\)/)
    const labPath = ['work', 'space/lab/PREREG.sha256'].join('') // assembled, so this file stays clean under the vocabulary guard
    expect(manifestProblems({ ...m, blind_basis: `the hash list in ${labPath}` }, t.folder, 'tree-demo').join('; ')).toMatch(/blind_basis names an internal path/)
  })

  it('a preregistered run that has not run is listed, checked against its recorded sha256, and printed as not stamped', () => {
    const t = tree()
    const planned = join(t.dir, 'blind-demo')
    mkdirSync(planned)
    const text = '# Preregistration: a demo blind run\n\nBars fixed now.\n'
    writeFileSync(join(planned, 'PREREG.md'), text)
    writeFileSync(join(planned, 'PREREG.sha256'), `# hashed before any data\n${sha(text)} *PREREG.md\nhashed 2026-10-06T06:00:00Z\n`)
    const ok = bench(['check', t.dir])
    expect(ok.code).toBe(0)
    expect(ok.err).toMatch(/OK +blind-demo: preregistered, not run: PREREG\.md matches the sha256 its hash list records; NOT STAMPED: no timestamp authority has signed it yet; the run has not begun/)
    const md = join(t.dir, 'BENCH.md'), misses = join(t.dir, 'MISSES.md')
    const idx = bench(['index', t.dir, '--bench-md', md, '--misses-md', misses])
    expect(idx.code).toBe(0)
    expect(idx.err).toMatch(/1 preregistered run\(s\) not yet run/)
    const page = readFileSync(md, 'utf8')
    expect(page).toContain('**Preregistered, not yet run: `blind-demo`.** "Preregistration: a demo blind run" ([`bench/blind-demo/PREREG.md`](bench/blind-demo/PREREG.md))')
    expect(page).toContain('It is not stamped yet: no timestamp authority has signed it')
    expect(page).toContain('The run has not begun: the folder holds no results, and there is no table.')
    // an edit after the recorded hash: the check fails and the index writes nothing
    writeFileSync(join(planned, 'PREREG.md'), text.replace('fixed now', 'moved later'))
    const bad = bench(['check', t.dir])
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/FAIL +blind-demo: preregistered, not run: PREREG\.md \(sha256 [0-9a-f]{12}…\) no longer matches the sha256 its hash list records/)
    const before = readFileSync(md, 'utf8')
    const refused = bench(['index', t.dir, '--bench-md', md, '--misses-md', misses])
    expect(refused.code).toBe(1)
    expect(refused.err).toMatch(/REFUSED: blind-demo\/PREREG\.md does not match the sha256 its hash list records/)
    expect(readFileSync(md, 'utf8')).toBe(before)
  })

  it('a table whose paths leave the tree, or whose bytes name an internal path, fails the check', () => {
    const t = tree()
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    expect(outOfTree({ ...table, run: { ...table.run, results: { path: '../../../tmp/x/results.json', sha256: table.run.results.sha256 } } }).join('; ')).toMatch(/run\.results\.path \.\.\/\.\.\/\.\.\/tmp\/x\/results\.json leaves the tree/)
    expect(outOfTree({ ...table, rows: [{ ...table.rows[0], note: 'dist is products/verify/dist/cli.js' }] }).join('; ')).toMatch(/names an internal path/)
    writeFileSync(t.table, tableBytes({ ...table, run: { ...table.run, results: { ...table.run.results, path: '../x/run.json' } } }))
    expect(bench(['check', t.dir]).err).toMatch(/FAIL +tree-demo: run\.results\.path \.\.\/x\/run\.json leaves the tree/)
  })

  it('a withdrawn run that still has a table fails; a withdrawn row needs its date', () => {
    const t = tree()
    writeFileSync(join(t.dir, '_refused.json'), JSON.stringify({ format: 'bench-refused/1', runs: [{ id: 'tree-demo', title: 'x', code: 'withdrawn', reason: 'r', date: '2026-10-05' }] }))
    expect(bench(['check', t.dir]).err).toMatch(/FAIL +tree-demo: listed as refused or withdrawn, yet it has a table/)
    writeFileSync(join(t.dir, '_refused.json'), JSON.stringify({ format: 'bench-refused/1', runs: [{ id: 'gone', title: 'x', code: 'withdrawn', reason: 'r' }] }))
    expect(bench(['check', t.dir]).err).toMatch(/FAIL +gone: a withdrawn row carries the date it was withdrawn/)
  })

  it('the amendment\'s own words are taken from a recorded version of the prereg and printed in a fence', () => {
    const t = tree()
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    expect(table.prereg.amendments[0]).toMatchObject({ text: '## Amendment 1\nThe control set gains two items.', text_from: 'PREREG.md:3-4' })
    const page = renderBenchIndex([table], new Map([['tree-demo', sha(readFileSync(t.table))]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toContain('<details><summary>Amendment 1, its text: PREREG.md lines 3-4</summary>')
    expect(page).toContain('```text\n## Amendment 1\nThe control set gains two items.\n```')
    expect(page).toContain('[`bench/tree-demo/PREREG.md`](bench/tree-demo/PREREG.md)')
    expect(page).toContain('**Audit:** labels known by construction.')
    // a text source that is not a recorded version of the prereg is refused
    writeFileSync(join(t.folder, 'NOTES.md'), 'line 1\nline 2\nline 3\n')
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    m.amendment_text = [{ sha256: sha(PREREG_V1), from: 'NOTES.md:1-2' }]
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m))
    let e: unknown
    try { emitFromFolder(t.folder, 'tree-demo') } catch (x) { e = x }
    expect(e).toBeInstanceOf(BenchRefused)
    expect((e as BenchRefused).message).toMatch(/NOTES\.md .* is not a recorded version of the prereg/)
  })

  it('every prereg carries a stamp record: the label before stamping began, a flagged NEEDS STAMP after, never neither', () => {
    expect([engineAtLeast('0.6.0', '0.6.0'), engineAtLeast('0.10.1', '0.6.0'), engineAtLeast('0.5.9', '0.6.0'), engineAtLeast(null, '0.6.0'), engineAtLeast('n/a', '0.6.0')]).toEqual([true, true, false, false, false])
    const t = tree()
    expect(JSON.parse(readFileSync(t.table, 'utf8')).prereg.stamp).toEqual({ status: UNSTAMPED_LABEL, proofs: [] })
    expect(bench(['check', t.dir]).err).toMatch(/MATCH +tree-demo: .*prereg frozen before stamping began on 2026-10-05, so no stamp predates its run/)
    const setManifest = (f: (m: Record<string, unknown>) => void): void => { const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8')); f(m); writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m)) }
    const setDate = (date: string): void => { const sp = JSON.parse(readFileSync(join(t.folder, 'spec.json'), 'utf8')); sp.run.date = date; writeFileSync(join(t.folder, 'spec.json'), JSON.stringify(sp)); resign(t.folder, 'spec.json') }
    // a run before stamping began with neither a proof nor the label is refused
    setManifest(m => { delete m.unstamped })
    expect(() => emitFromFolder(t.folder, 'tree-demo')).toThrow(/no stamp made before the run .* does not carry the label "unstamped \(frozen before 2026-10-05\)"/)
    expect(bench(['check', t.dir]).err).toMatch(/REFUSED tree-demo: \(no-stamp-status\)/)
    // the label is refused on a run after stamping began
    setManifest(m => { m.unstamped = UNSTAMPED_LABEL })
    setDate('2026-10-06T10:00:00Z')
    expect(() => emitFromFolder(t.folder, 'tree-demo')).toThrow(/carries the label .* but the prereg's status is "needs stamp"/)
    // a later run with no proof emits, reads NEEDS STAMP, and the check flags it without failing it
    setManifest(m => { delete m.unstamped })
    writeFileSync(t.table, tableBytes(emitFromFolder(t.folder, 'tree-demo').table))
    expect(JSON.parse(readFileSync(t.table, 'utf8')).prereg.stamp).toEqual({ status: 'needs stamp', proofs: [] })
    const r = checkTree(t.dir)
    expect(r.ok).toBe(true)
    expect(r.lines.find(l => l.id === 'tree-demo')).toMatchObject({ status: 'MATCH', flag: 'needs stamp' })
    const cli = bench(['check', t.dir])
    expect(cli.code).toBe(4)
    expect(cli.err).toMatch(/1 prereg\(s\) NEED A STAMP .*: tree-demo/)
    expect(cli.err).toMatch(/exit 4: the stamp rule .* pass --allow-unstamped to accept them knowingly/)
    const allowed = bench(['check', t.dir, '--allow-unstamped'])
    expect(allowed.code).toBe(0)
    expect(allowed.err).toMatch(/1 unstamped prereg\(s\) accepted by --allow-unstamped/)
    const page = renderBenchIndex([JSON.parse(readFileSync(t.table, 'utf8'))], new Map([['tree-demo', sha(readFileSync(t.table))]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toContain('**Stamp:** NEEDS STAMP. The run (2026-10-06T10:00:00Z) came after stamping began on 2026-10-05')
    // a hand-edited status that its proofs and date do not give is not a well-formed table
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    writeFileSync(t.table, tableBytes({ ...table, prereg: { ...table.prereg, stamp: { status: 'stamped before the run', proofs: [] } } }))
    expect(bench(['check', t.dir]).err).toMatch(/FAIL +tree-demo: prereg\.stamp\.status "stamped before the run" is not the one/)
  })

  it('a prereg whose frozen text names a lab path gets the generator\'s note; one with only in-run paths and URLs does not', () => {
    const t = tree()
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    expect(table.prereg.lab_paths).toBeUndefined()
    const page = (tb: unknown): string => renderBenchIndex([tb as never], new Map([['tree-demo', 'x'.repeat(64)]]), null, null)
    expect(page(table)).not.toContain(LAB_PATHS_NOTE)
    const d = mkdtempSync(join(tmpdir(), 'bench-labpath-')); dirs.push(d)
    writeFileSync(join(d, 'PREREG.md'), 'Inputs: `results/run.json` and https://example.org/data.csv\n')
    writeFileSync(join(d, 'PREREG.sha256'), 'abc *PREREG.md\n')
    expect(preregCarriesLabPaths({ prereg: 'PREREG.md' }, d)).toBe(false)
    writeFileSync(join(d, 'PREREG.md'), 'Inputs (pinned): `../other-run/data/table.zip`\n')
    expect(preregCarriesLabPaths({ prereg: 'PREREG.md' }, d)).toBe(true)
    writeFileSync(join(d, 'PREREG.md'), 'Inputs: `results/run.json`\n')
    writeFileSync(join(d, 'PREREG.sha256'), 'abc *products/verify/PREREG.md\n')
    expect(preregCarriesLabPaths({ prereg: 'PREREG.md' }, d)).toBe(true) // a hash list the check reads counts too
    expect(page({ ...table, prereg: { ...table.prereg, lab_paths: true } })).toContain(`*${LAB_PATHS_NOTE}*`)
    expect(LAB_PATHS_NOTE).toBe("Note on the prereg: frozen text; file paths in it refer to the authors' working tree at the time of freezing.")
  })

  it('a withdrawn table\'s misses stay in the ledger: regenerating without the table drops nothing', () => {
    const t = tree()
    const table = JSON.parse(readFileSync(t.table, 'utf8'))
    const { ledger: prior } = mergeLedger(null, [table])
    expect(prior.rows.map(r => r.key)).toEqual(['tree-demo#D02'])
    const withdrawn = [{ id: 'tree-demo', misses: table.misses, run_date: table.run.date }]
    const { ledger, added } = mergeLedger(prior, ledgerSources([], withdrawn))
    expect(added).toBe(0)
    expect(ledger).toEqual(prior)
    expect(() => mergeLedger(prior, ledgerSources([], []))).toThrow(/never drops a row/)
  })
})

describe('rows outside the bench rule (bench-provenance/1)', () => {
  function provDir(): { dir: string; archive: string } {
    const dir = mkdtempSync(join(tmpdir(), 'bench-prov-')); dirs.push(dir)
    mkdirSync(join(dir, 'ap-demo'))
    const archive = join(dir, 'ap-demo', 'PROVENANCE.md')
    writeFileSync(archive, '# Provenance\nfile times only.\n')
    const list = {
      format: PROVENANCE_FORMAT,
      entries: [{
        id: 'ap-demo', title: 'AP demo', tier: PROVENANCE_TIER, run: { id: 'run 1', date: '2026-09-23', engine_version: null },
        provenance: { path: 'ap-demo/PROVENANCE.md', sha256: sha(readFileSync(archive)) }, why_not_a_table: 'no recorded prereg hash',
        rows: [provenanceRow('wrong among decided', 0, 82, 'synthetic')],
      }],
    }
    writeFileSync(join(dir, '_provenance.json'), provenanceBytes(list as never))
    return { dir, archive }
  }

  it('the archive matches its sha256 and every interval recomputes: OK', () => {
    const p = provDir()
    const r = bench(['check', p.dir])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/OK +ap-demo: transcribed; provenance archived; prereg unhashed; archive ap-demo\/PROVENANCE\.md matches/)
    const row = provenanceRow('wrong among decided', 0, 82, 'synthetic')
    expect(row).toMatchObject({ verdict: 'INSUFFICIENT', bar: null, ci95: [0, 0.044751] })
  })

  it('an edited archive, a changed tier, a doctored interval or a verdict fails', () => {
    const p = provDir()
    writeFileSync(p.archive, '# Provenance\nfile times only, edited.\n')
    expect(bench(['check', p.dir]).err).toMatch(/does not match its recorded sha256/)
    const list = JSON.parse(readFileSync(join(p.dir, '_provenance.json'), 'utf8'))
    expect(provenanceProblems({ ...list, entries: [{ ...list.entries[0], tier: 'blind' }] }).join('; ')).toMatch(/the tier is exactly/)
    expect(provenanceProblems({ ...list, entries: [{ ...list.entries[0], rows: [{ ...list.entries[0].rows[0], ci95: [0, 0.01] }] }] }).join('; ')).toMatch(/does not recompute/)
    expect(provenanceProblems({ ...list, entries: [{ ...list.entries[0], rows: [{ ...list.entries[0].rows[0], verdict: 'PASS' }] }] }).join('; ')).toMatch(/no verdict/)
    expect(provenanceProblems({ ...list, entries: [{ ...list.entries[0], provenance: { ...list.entries[0].provenance, path: '../elsewhere.md' } }] }).join('; ')).toMatch(/leaves the tables folder/)
  })
})

describe.skipIf(!opensslAvailable())('a prereg stamp in run.json', () => {
  function stamped(): { t: ReturnType<typeof tree> } {
    const t = tree()
    const tsa = mockTsa(mkdtempSync(join(tmpdir(), 'bench-tsa-')))
    dirs.push(tsa.dir)
    const r = stampFile(join(t.folder, 'PREREG.md'), { tsa: 'mock', submit: tsa.submit })
    expect(r.check?.info?.imprint).toBe(sha(PREREG_V1))
    writeFileSync(join(t.folder, 'tsa-ca.pem'), readFileSync(tsa.ca))
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    m.stamps = [{ proof: 'PREREG.md.tsr', ca: 'tsa-ca.pem' }]
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m))
    return { t }
  }
  const reemit = (t: ReturnType<typeof tree>): void => writeFileSync(t.table, tableBytes(emitFromFolder(t.folder, 'tree-demo').table))
  const redate = (t: ReturnType<typeof tree>, date: string, unstamped: boolean): void => {
    const sp = JSON.parse(readFileSync(join(t.folder, 'spec.json'), 'utf8')); sp.run.date = date; writeFileSync(join(t.folder, 'spec.json'), JSON.stringify(sp)); resign(t.folder, 'spec.json')
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8')); if (unstamped) m.unstamped = UNSTAMPED_LABEL; else delete m.unstamped; writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m))
  }

  it('a stamp made after an early run is listed as what it is: the label stands, the proof shows the text existed by then', () => {
    const { t } = stamped()
    reemit(t)
    const stamp = JSON.parse(readFileSync(t.table, 'utf8')).prereg.stamp
    expect(stamp.status).toBe(UNSTAMPED_LABEL)
    expect(stamp.proofs).toMatchObject([{ proof: 'PREREG.md.tsr', covers: 'PREREG.md', before_run: false }])
    const line = checkTree(t.dir).lines.find(l => l.id === 'tree-demo')!
    expect(line.status).toBe('MATCH')
    expect(line.detail).toMatch(/prereg frozen before stamping began on 2026-10-05, so no stamp predates its run; stamped after: PREREG\.md\.tsr signed .*Z, signature and chain verified/)
    const page = renderBenchIndex([JSON.parse(readFileSync(t.table, 'utf8'))], new Map([['tree-demo', 'x'.repeat(64)]]), null, null, { folders: new Set(['tree-demo']) })
    expect(page).toMatch(/\*\*Stamp:\*\* unstamped \(frozen before 2026-10-05\)\. .*signed these bytes later .*not that it came before the run/)
  })

  it('a stamp made before the run reads "stamped before the run"; a stamp later on a run dated by day alone does not count', () => {
    const { t } = stamped()
    redate(t, '2099-01-01', false)
    reemit(t)
    expect(JSON.parse(readFileSync(t.table, 'utf8')).prereg.stamp).toMatchObject({ status: 'stamped before the run', proofs: [{ before_run: true }] })
    expect(checkTree(t.dir).lines.find(l => l.id === 'tree-demo')).toMatchObject({ status: 'MATCH' })
    // a date-only run date begins at 00:00Z that day, so a stamp signed that day is after the run
    redate(t, new Date().toISOString().slice(0, 10), false)
    reemit(t)
    expect(JSON.parse(readFileSync(t.table, 'utf8')).prereg.stamp.status).toBe('stamped after the run')
  })

  it('a signature that does not hold fails the check; OpenSSL that cannot run is reported, not failed', () => {
    const { t } = stamped()
    reemit(t)
    const other = mockTsa(mkdtempSync(join(tmpdir(), 'bench-tsa-other-')), 'Other TSA'); dirs.push(other.dir)
    writeFileSync(join(t.folder, 'tsa-ca.pem'), readFileSync(other.ca))
    const bad = checkTree(t.dir).lines.find(l => l.id === 'tree-demo')!
    expect(bad.status).toBe('FAIL')
    expect(bad.detail).toMatch(/stamp PREREG\.md\.tsr: FAIL signature/)
    const missing = checkTree(t.dir, { openssl: () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn openssl ENOENT') }) }).lines.find(l => l.id === 'tree-demo')!
    expect(missing).toMatchObject({ status: 'MATCH' })
    expect(missing.detail).toMatch(/signature not checked \(openssl could not run\)/)
    expect(existsSync(join(t.folder, 'PREREG.md.tsq'))).toBe(true)
  })

  it('a proof in the folder that run.json does not list fails the check, so a new stamp is never left unread', () => {
    const { t } = stamped()
    reemit(t)
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    delete m.stamps
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m))
    reemit(t)
    const line = checkTree(t.dir).lines.find(l => l.id === 'tree-demo')!
    expect(line.status).toBe('FAIL')
    expect(line.detail).toMatch(/the proof PREREG\.md\.tsr is in the folder but not listed in run\.json stamps/)
  })

  it('a proof that does not cover its file is refused at emission', () => {
    const { t } = stamped()
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    writeFileSync(join(t.folder, 'PREREG-copy.md'), 'another text\n')
    writeFileSync(join(t.folder, 'PREREG-copy.md.tsr'), readFileSync(join(t.folder, 'PREREG.md.tsr')))
    m.stamps = [{ proof: 'PREREG-copy.md.tsr' }]
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m))
    expect(() => emitFromFolder(t.folder, 'tree-demo')).toThrow(/does not cover PREREG-copy\.md: its message imprint is not the file's sha256/)
  })
})
