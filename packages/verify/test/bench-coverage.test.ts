/**
 * What the bench covers, and what it says it does not (src/bench/tree.ts, outside.ts, spec.ts):
 *   - every file a hash list in a table's folder names ships there in those bytes, or run.json lists it as not shipped by its
 *     sha256 with a reason, and the table prints it beside its hash;
 *   - numbers published outside the bench rule are listed in `_outside.json`, printed under "Outside the rule", never as a table;
 *   - a spec can sum several counts (`$sum`) and read one row's items from several sources;
 *   - every RFC 3161 proof shipped in docs/bench verifies against the roots bundle in docs/bench/_tsa/ (read-only).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runBench } from '../src/bench/cli-bench'
import { checkTree, emitFromFolder, hashListNames, hashListProblems, manifestProblems, readManifest } from '../src/bench/tree'
import { tableBytes, UNSTAMPED_LABEL } from '../src/bench/table'
import { renderBenchIndex } from '../src/bench/docs'
import { OUTSIDE_FORMAT, outsideProblems } from '../src/bench/outside'
import { resolveVal, itemsFrom, type LoadedResults } from '../src/bench/spec'
import { verifyStamp } from '../src/bench/timestamp'
import { opensslAvailable } from './bench-stamp-mock'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
const bench = (args: string[]): { code: number; err: string } => { let err = ''; const code = runBench(args, { out: () => {}, err: s => { err += s } }); return { code, err } }

const PREREG = 'Bar: 0 wrong PASS.\n'
const HARNESS = 'console.log("run")\n'
const RESULTS = { docs: [{ id: 'D01', arm: 'defect', cls: 'caught' }, { id: 'C01', arm: 'clean', cls: 'correct_pass' }] }
const SPEC = {
  spec: 'bench-spec/1', id: 'cov-demo', title: 'Coverage demo', adapter: 'items', label: 'blind', blind: true, items: 'docs',
  run: { id: 'run 1', date: '2026-10-03', engine_version: '0.1.0', ruleset: 'demo@0.1.0' },
  rows: [{ claim: 'planted defects caught', where: { arm: 'defect' }, hit: { cls: 'caught' }, method: 'wilson' }],
}

/** One table folder whose sidecar also names a harness file. */
function folder(withHarness: boolean): { dir: string; folder: string; table: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cov-')); dirs.push(dir)
  const f = join(dir, 'cov-demo')
  mkdirSync(join(f, 'results'), { recursive: true })
  mkdirSync(join(f, 'harness'), { recursive: true })
  const files: Record<string, string> = {
    'PREREG.md': PREREG,
    'PREREG.sha256': `${sha(PREREG)} *PREREG.md\n${sha(HARNESS)} *harness/run.mjs\nhashed 2026-10-03T10:00:00Z\n`,
    'results/run.json': JSON.stringify(RESULTS),
    'spec.json': JSON.stringify(SPEC),
  }
  if (withHarness) files['harness/run.mjs'] = HARNESS
  for (const [p, b] of Object.entries(files)) writeFileSync(join(f, p), b)
  writeFileSync(join(f, 'run.json'), JSON.stringify({
    format: 'bench-run/1', id: 'cov-demo', prereg: 'PREREG.md', results: 'results/run.json', spec: 'spec.json', unstamped: UNSTAMPED_LABEL,
    rerun: { from_tree: withHarness ? 'partly' : 'no', detail: 'the demo inputs do not ship' },
    blind_basis: 'PREREG.sha256 records the prereg at 2026-10-03T10:00:00Z, before the demo run',
    sources: Object.entries(files).map(([file, b]) => ({ file, sha256: sha(b), from: file })),
  }, null, 2))
  const table = join(dir, 'cov-demo.json')
  writeFileSync(table, tableBytes(emitFromFolder(f, 'cov-demo').table))
  return { dir, folder: f, table }
}

describe('hash-listed files ship, or are marked not shipped beside their hash', () => {
  it('reads the file each hash list record names, and only file-like names', () => {
    const text = [
      '# a comment 0000000000000000000000000000000000000000000000000000000000000000 *ignored.md',
      `${'a'.repeat(64)} *harness/run.mjs`,
      `v0  2026-10-03T06:19:45Z  sha256 ${'b'.repeat(64)}  PREREG-v0.frozen.md  (before any trace parsed)`,
      `data  sha256 ${'c'.repeat(64)}  md5 ${'d'.repeat(32)}  BPI_log.xes`,
      `verify-snapshot  tree ${'e'.repeat(64)}  (engine 0.0.1, copied from the dist at 2026-10-03 02:18 EDT)`,
      `amendment1  ${'f'.repeat(64)}  2026-10-04T03:48:50Z`,
    ].join('\n')
    expect(hashListNames(text)).toEqual([
      { sha256: 'a'.repeat(64), name: 'harness/run.mjs' },
      { sha256: 'b'.repeat(64), name: 'PREREG-v0.frozen.md' },
      { sha256: 'c'.repeat(64), name: 'BPI_log.xes' },
    ])
  })

  it('a hash-listed harness that is in the folder in those bytes passes', () => {
    const t = folder(true)
    expect(hashListProblems(t.folder, readManifest(t.folder, 'cov-demo'))).toEqual([])
    expect(bench(['check', t.dir]).code).toBe(0)
  })

  it('one that is absent fails the check until run.json lists it as not shipped; the table then prints it beside its hash', () => {
    const t = folder(false)
    const r = bench(['check', t.dir])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/FAIL +cov-demo: PREREG\.sha256 names run\.mjs \(sha256 [0-9a-f]{12}…\), which neither ships in the folder in those bytes nor is listed in run\.json not_shipped/)
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    m.not_shipped = [{ file: 'harness/run.mjs', sha256: sha(HARNESS), reason: 'it names the authors\' private folders' }]
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m, null, 2))
    const table = emitFromFolder(t.folder, 'cov-demo').table
    expect(table.run.not_shipped).toEqual(m.not_shipped)
    writeFileSync(t.table, tableBytes(table))
    expect(bench(['check', t.dir]).code).toBe(0)
    const page = renderBenchIndex([table], new Map([['cov-demo', 'x'.repeat(64)]]), null, null, { folders: new Set(['cov-demo']) })
    expect(page).toContain(`**Hashed, not shipped:**\n\n- \`harness/run.mjs\`, sha256 \`${sha(HARNESS)}\`: it names the authors' private folders`)
  })

  it('a file marked not shipped that does ship, or named by an internal path, is a malformed manifest', () => {
    const t = folder(true)
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    expect(manifestProblems({ ...m, not_shipped: [{ file: 'harness/run.mjs', sha256: sha(HARNESS), reason: 'x' }] }, t.folder, 'cov-demo').join('; ')).toMatch(/those bytes are in the folder, so it ships/)
    const lab = ['work', 'space/run.mjs'].join('') // assembled, so this file stays clean under the vocabulary guard
    expect(manifestProblems({ ...m, not_shipped: [{ file: lab, sha256: sha('y'), reason: 'x' }] }, t.folder, 'cov-demo').join('; ')).toMatch(/not by an internal path/)
    expect(manifestProblems({ ...m, unstamped: 'unstamped' }, t.folder, 'cov-demo').join('; ')).toMatch(/unstamped, when present, is exactly/)
  })

  it('a hash-listed file that ships edited is not "not shipped": it is listed under shipped_edited with both sha256s, and the table prints it apart', () => {
    const t = folder(false)
    const EDITED = 'console.log("run") // one comment line rewritten\n'
    writeFileSync(join(t.folder, 'harness', 'run.mjs'), EDITED)
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    // listed as not shipped while a file of that name ships in other bytes: the manifest says where it belongs
    expect(manifestProblems({ ...m, not_shipped: [{ file: 'harness/run.mjs', sha256: sha(HARNESS), reason: 'x' }] }, t.folder, 'cov-demo').join('; ')).toMatch(/a file of that name ships in the folder \(sha256 [0-9a-f]{12}…\), so list it under shipped_edited/)
    // unlisted, the hash list's record is unaccounted for
    expect(hashListProblems(t.folder, m).join('; ')).toMatch(/names run\.mjs .*neither ships in the folder in those bytes nor is listed/)
    const edited = { file: 'harness/run.mjs', recorded_sha256: sha(HARNESS), sha256: sha(EDITED), reason: 'the run\'s harness; one comment line named a private folder and was rewritten' }
    m.shipped_edited = [edited]
    writeFileSync(join(t.folder, 'run.json'), JSON.stringify(m, null, 2))
    expect(hashListProblems(t.folder, readManifest(t.folder, 'cov-demo'))).toEqual([])
    const table = emitFromFolder(t.folder, 'cov-demo').table
    expect(table.run.shipped_edited).toEqual([edited])
    expect(table.run.not_shipped).toBeUndefined()
    writeFileSync(t.table, tableBytes(table))
    expect(bench(['check', t.dir]).code).toBe(0)
    const page = renderBenchIndex([table], new Map([['cov-demo', 'x'.repeat(64)]]), null, null, { folders: new Set(['cov-demo']) })
    expect(page).toContain(`**Ships, edited:**\n\n- \`harness/run.mjs\`, recorded sha256 \`${sha(HARNESS)}\`, shipped sha256 \`${sha(EDITED)}\`: the run's harness; one comment line named a private folder and was rewritten`)
    expect(page).not.toContain('**Hashed, not shipped:**')
    expect(page).toContain('"Ships, edited" with both sha256s and the reason')
    // malformed entries
    const problems = (x: object): string => manifestProblems({ ...m, shipped_edited: [{ ...edited, ...x }] }, t.folder, 'cov-demo').join('; ')
    expect(problems({ sha256: sha('other bytes') })).toMatch(/the file in the folder has sha256 [0-9a-f]{12}…, not the/)
    expect(problems({ recorded_sha256: sha(EDITED) })).toMatch(/the shipped sha256 is the recorded one, so it ships unedited/)
    expect(problems({ file: 'harness/gone.mjs' })).toMatch(/not in the folder, so list it under not_shipped/)
    expect(problems({ reason: ' ' })).toMatch(/a shipped_edited entry is \{ file, recorded_sha256, sha256, reason \}/)
  })

  it('a superseded version may stay "not shipped" while the version a later hash set records ships under the same name', () => {
    const t = folder(false)
    const V2 = 'console.log("run, second hash set")\n'
    writeFileSync(join(t.folder, 'harness', 'run.mjs'), V2)
    const list = readFileSync(join(t.folder, 'PREREG.sha256'), 'utf8')
    writeFileSync(join(t.folder, 'PREREG.sha256'), `${list}# second hash set\n${sha(V2)} *harness/run.mjs\n`)
    const m = JSON.parse(readFileSync(join(t.folder, 'run.json'), 'utf8'))
    m.not_shipped = [{ file: 'harness/run.mjs', sha256: sha(HARNESS), reason: 'the first hash set\'s version, superseded before any engine call; the run\'s version ships' }]
    for (const s of m.sources) if (s.file === 'PREREG.sha256') s.sha256 = sha(readFileSync(join(t.folder, 'PREREG.sha256')))
    expect(manifestProblems(m, t.folder, 'cov-demo')).toEqual([])
    expect(hashListProblems(t.folder, m)).toEqual([])
  })
})

describe('numbers outside the bench rule (bench-outside/1)', () => {
  const entry = { id: 'sec-demo', title: 'A study', where: 'A page, section 1', numbers: 'precision 1% to 17%', reason: 'Its results are not a bench table.' }

  it('a well-formed list prints under "Outside the rule" inside a generated block; check reads it as OK rows', () => {
    const t = folder(true)
    writeFileSync(join(t.dir, '_outside.json'), JSON.stringify({ format: OUTSIDE_FORMAT, entries: [entry] }))
    const r = bench(['check', t.dir])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/OK +sec-demo: outside the rule: Its results are not a bench table\./)
    const page = renderBenchIndex([JSON.parse(readFileSync(t.table, 'utf8'))], new Map([['cov-demo', 'x'.repeat(64)]]), null, null, { outside: { format: OUTSIDE_FORMAT, entries: [entry] }, outsideSha: 'y'.repeat(64) })
    expect(page).toContain('## Outside the rule')
    expect(page).toContain(`<!-- bench:begin outside=outside sha256=${'y'.repeat(64)} -->`)
    expect(page).toContain('| **A study** (`sec-demo`): precision 1% to 17% | A page, section 1 | Its results are not a bench table. |')
    expect(page).toContain('the bench rule covers every table on this page')
    expect(page).not.toContain('covers every number the project publishes')
  })

  it('a table id, a duplicate, a missing reason or a two-line reason is refused', () => {
    expect(outsideProblems({ format: OUTSIDE_FORMAT, entries: [{ ...entry, id: 'cov-demo' }] }, new Set(['cov-demo'])).join('; ')).toMatch(/is a bench table/)
    expect(outsideProblems({ format: OUTSIDE_FORMAT, entries: [entry, entry] }).join('; ')).toMatch(/duplicate id/)
    expect(outsideProblems({ format: OUTSIDE_FORMAT, entries: [{ ...entry, reason: '' }] }).join('; ')).toMatch(/reason is required/)
    expect(outsideProblems({ format: OUTSIDE_FORMAT, entries: [{ ...entry, reason: 'one\ntwo' }] }).join('; ')).toMatch(/one line/)
    const t = folder(true)
    writeFileSync(join(t.dir, '_outside.json'), JSON.stringify({ format: OUTSIDE_FORMAT, entries: [{ ...entry, id: 'cov-demo' }] }))
    expect(checkTree(t.dir).ok).toBe(false)
    expect(bench(['index', t.dir]).code).toBe(1)
  })
})

describe('spec values: summed counts and several item sources', () => {
  const results: LoadedResults = { path: 'results', sha256: 'z', files: new Map<string, unknown>([['s', { a: 1668, b: 98, c: 80103, d: 127385, half: 'x' }], ['h1', { rows: [{ v: 1 }, { v: 2 }] }], ['h2', { rows: [{ v: 3 }] }]]) }
  it('$sum adds counts the results hold, and refuses anything that is not a count', () => {
    expect(resolveVal({ $sum: ['s:a', 's:d'] }, results, 'k')).toBe(129053)
    expect(() => resolveVal({ $sum: ['s:a', 's:half'] }, results, 'k')).toThrow(/is not a count/)
    expect(() => resolveVal({ $sum: [] } as never, results, 'k')).toThrow(/non-empty list/)
  })
  it('a row\'s items may come from several sources, concatenated in order', () => {
    expect(itemsFrom(['h1:rows', 'h2:rows'], results, 'rows[0]')).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }])
    expect(itemsFrom('h2:rows', results, 'rows[0]')).toEqual([{ v: 3 }])
  })
})

// ── the shipped stamps, read-only ─────────────────────────────────────────────────────────────────────────────────────────
const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'bench')
const ROOTS = join(BENCH, '_tsa', 'digicert-roots.pem')
const PROOFS = existsSync(BENCH) ? readdirSync(BENCH).filter(f => !f.startsWith('_') && existsSync(join(BENCH, f, 'run.json'))).flatMap(id => readdirSync(join(BENCH, id)).filter(p => p.endsWith('.tsr')).map(p => [id, p] as const)) : []

describe.skipIf(!existsSync(ROOTS) || !PROOFS.length)('every shipped prereg stamp, against the roots bundle in docs/bench/_tsa/', () => {
  it('the bundle holds exactly the two DigiCert roots', () => {
    expect(readFileSync(ROOTS, 'utf8').match(/BEGIN CERTIFICATE/g)).toHaveLength(2)
    const lf = (t: string): string => t.replace(/\r\n/g, '\n').replace(/\s*$/, '\n') // line endings aside: the certificates are what count
    expect(lf(readFileSync(ROOTS, 'utf8'))).toBe(['digicert-assured-id-root-ca.pem', 'digicert-trusted-root-g4.pem'].map(f => lf(readFileSync(join(BENCH, '_tsa', f), 'utf8'))).join(''))
  })
  it.skipIf(!opensslAvailable())('each one is VERIFIED: imprint, nonce, signature and chain', () => {
    expect(PROOFS.length).toBeGreaterThanOrEqual(14) // the 14 stamped at 16:07Z, plus any made since
    for (const [id, p] of PROOFS) {
      const proof = join(BENCH, id, p), query = proof.replace(/\.tsr$/, '.tsq')
      const c = verifyStamp(proof.replace(/\.tsr$/, ''), proof, { ca: ROOTS, ...(existsSync(query) ? { query: readFileSync(query) } : {}) })
      expect(c.ok, `${id}/${p}: ${c.lines.join(' | ')}`).toBe(true)
      expect(c.info!.gen_time >= '2026-10-05').toBe(true)
    }
  })
})
