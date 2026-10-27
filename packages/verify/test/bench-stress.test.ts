/**
 * The AP stress rows under `bench check` (src/bench/stress.ts): the digest is the stress harness's own formula; a tables
 * directory that declares stress rows (_stress.json) passes only when every banked row names the AP pack digest, engine and
 * ruleset the tree builds; a changed pack, a row from another engine, a missing or undeclared file, or rows that cannot be
 * found fail with words; and the exit codes a release step reads are 0 (all match), 1 (any DIFFERS or failure), 3 (usage).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apPackDigest, AP_RULESET_REF, checkStress, HOLDOUT_FILE, STRESS_FORMAT, stressProblems, type StressDeclaration } from '../src/bench/stress'
import { runBench } from '../src/bench/cli-bench'
import { renderBenchIndex } from '../src/bench/docs'
import type { BenchTable } from '../src/bench/table'
import { AP_RULESET } from '../src/ap/index'
import { ENGINE_VERSION } from '../src/version'

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function bench(argv: string[]): { code: number; err: string } {
  let err = ''
  const code = runBench(argv, { out: () => {}, err: (s) => { err += s } })
  return { code, err }
}

/** A repository laid out as the public tree: packages/verify/docs/bench (tables), packages/verify/src/ap, bench/ap/results. */
function repo(): { root: string; tables: string; pack: string; rows: string; write: (digest?: string, engine?: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'bench-stress-'))
  dirs.push(root)
  const tables = join(root, 'packages', 'verify', 'docs', 'bench')
  const pack = join(root, 'packages', 'verify', 'src', 'ap')
  const rows = join(root, 'bench', 'ap', 'results')
  for (const d of [tables, pack, rows]) mkdirSync(d, { recursive: true })
  writeFileSync(join(pack, 'index.ts'), 'export const a = 1\n')
  writeFileSync(join(pack, 'decide.ts'), 'export const b = 2\n')
  writeFileSync(join(pack, 'README.md'), 'not a source file\n')
  const files = ['stress-P1_order-holdout1.jsonl', 'stress-P2_wording-holdout1.jsonl']
  const decl: StressDeclaration = { format: STRESS_FORMAT, title: 'demo stress rows', harness: 'bench/ap/stress.ts', rows: 'bench/ap/results', pack: 'packages/verify/src/ap', amendment: 'ap-blind/AMENDMENT.md', files }
  writeFileSync(join(tables, '_stress.json'), `${JSON.stringify(decl, null, 2)}\n`)
  const write = (digest = apPackDigest(pack).sha256, engine = ENGINE_VERSION): void => {
    for (const f of files) writeFileSync(join(rows, f), [1, 2, 3].map(i => JSON.stringify({ id: `T00${i}`, got: 'approve', engine_version: engine, ruleset: AP_RULESET_REF, checker_sha256: digest })).join('\n') + '\n')
  }
  write()
  return { root, tables, pack, rows, write }
}

describe('the AP pack digest', () => {
  it('is the stress harness\'s formula: sha256 over "<sha256>  <name>\\n" for each *.ts, sorted by name', () => {
    const r = repo()
    const names = readdirSync(r.pack).filter(f => f.endsWith('.ts')).sort()
    const expected = sha(names.map(f => `${sha(readFileSync(join(r.pack, f)))}  ${f}\n`).join(''))
    expect(apPackDigest(r.pack)).toEqual({ sha256: expected, files: ['decide.ts', 'index.ts'] })
    expect(AP_RULESET_REF).toBe(`${AP_RULESET.id}@${AP_RULESET.version}`)
  })
})

describe('bench check over declared stress rows', () => {
  it('a directory that declares no stress rows gets no stress check', () => {
    const d = mkdtempSync(join(tmpdir(), 'bench-stress-none-')); dirs.push(d)
    expect(checkStress(d)).toBeNull()
    expect(bench(['check', d])).toMatchObject({ code: 0 })
  })

  it('rows that name the tree\'s digest, engine and ruleset MATCH, and the check exits 0', () => {
    const r = repo()
    const s = checkStress(r.tables)!
    expect(s).toMatchObject({ status: 'MATCH', files: 2, rows: 6 })
    expect(s.detail).toMatch(/^2 of 2 banked file\(s\), 6 row\(s\), carry checker_sha256 [0-9a-f]{8}…, the digest this tree's AP pack builds \(2 source files in packages\/verify\/src\/ap\)/)
    const cli = bench(['check', r.tables])
    expect(cli.code).toBe(0)
    expect(cli.err).toMatch(/MATCH +stress: 2 of 2 banked file/)
    expect(cli.err).toMatch(/ALL MATCH: 0 of 0 table\(s\) .*; stress rows: 2 of 2 file\(s\) carry the AP pack digest this tree builds/)
  })

  it('a changed AP pack makes every row DIFFER: exit 1, both digests named, and what to do', () => {
    const r = repo()
    const banked = apPackDigest(r.pack).sha256
    writeFileSync(join(r.pack, 'decide.ts'), 'export const b = 3\n')
    const now = apPackDigest(r.pack).sha256
    const s = checkStress(r.tables)!
    expect(s.status).toBe('DIFFERS')
    expect(s.detail).toContain(`6 row(s) carry checker_sha256 ${banked.slice(0, 8)}…`)
    expect(s.detail).toContain(`hashes to ${now.slice(0, 8)}…`)
    expect(s.detail).toMatch(/Re-run each seed, show that no decision moved, re-bank on purpose \(--bank\) and record it in docs\/bench\/ap-blind\/AMENDMENT\.md/)
    const cli = bench(['check', r.tables])
    expect(cli.code).toBe(1)
    expect(cli.err).toMatch(/DIFFERS stress: 2 of 2 banked file/)
    expect(cli.err).toMatch(/NOT ALL MATCH: .*; stress rows: DIFFERS/)
    // re-banked under the new digest, it matches again
    r.write(now)
    expect(checkStress(r.tables)!.status).toBe('MATCH')
  })

  it('a row banked under another engine version DIFFERS even with the same digest', () => {
    const r = repo()
    r.write(undefined, '0.0.1')
    const s = checkStress(r.tables)!
    expect(s.status).toBe('DIFFERS')
    expect(s.detail).toMatch(/under engine 0\.0\.1 and/)
  })

  it('a missing declared file, an undeclared holdout file, or rows that cannot be found FAIL with words; --stress and --pack point elsewhere', () => {
    const r = repo()
    rmSync(join(r.rows, 'stress-P2_wording-holdout1.jsonl'))
    expect(checkStress(r.tables)).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/1 declared stress file\(s\) missing from bench\/ap\/results: stress-P2_wording-holdout1\.jsonl/) })
    r.write()
    writeFileSync(join(r.rows, 'stress-P3_numbers-holdout1.jsonl'), readFileSync(join(r.rows, 'stress-P1_order-holdout1.jsonl')))
    expect(checkStress(r.tables)).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/not declared in _stress\.json: stress-P3_numbers-holdout1\.jsonl/) })
    rmSync(join(r.rows, 'stress-P3_numbers-holdout1.jsonl'))
    // development-seed files beside them are not banked rows and are not read
    writeFileSync(join(r.rows, 'stress-P1_order-fresh1.jsonl'), 'not read\n')
    expect(checkStress(r.tables)!.status).toBe('MATCH')
    // moved: the default location fails, the flags find them
    const elsewhere = join(r.root, 'moved')
    mkdirSync(elsewhere)
    for (const f of readdirSync(r.rows)) writeFileSync(join(elsewhere, f), readFileSync(join(r.rows, f)))
    rmSync(r.rows, { recursive: true })
    const lost = bench(['check', r.tables])
    expect(lost.code).toBe(1)
    expect(lost.err).toMatch(/FAIL +stress: the stress rows are not at bench\/ap\/results \(_stress\.json names bench\/ap\/results from the repository root, which this check takes to be four folders above the tables directory: .*If this tables directory is a copy outside its repository, give --stress <the folder that holds the banked stress files> and --pack/)
    expect(lost.err).toMatch(/stress rows: FAIL \(see the stress line above; on a copied tables directory give --stress and --pack\)/)
    expect(bench(['check', r.tables, '--stress', elsewhere, '--pack', r.pack]).code).toBe(0)
    // a tables directory copied out of its repository: the message names where it looked and the two flags
    const copy = join(r.root, 'mytests', 'benchcopy')
    mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(r.tables)) if (!statSync(join(r.tables, f)).isDirectory()) writeFileSync(join(copy, f), readFileSync(join(r.tables, f)))
    expect(checkStress(copy)!.detail).toMatch(/four folders above the tables directory: .*give --stress .* and --pack/)
    expect(checkStress(copy, { rows: elsewhere, pack: r.pack })!.status).toBe('MATCH')
    expect(bench(['check', r.tables, '--stress', elsewhere, '--pack', join(r.root, 'nowhere')]).err).toMatch(/the AP pack sources are not at nowhere: give --pack/)
  })

  it('the tables-directory flags are refused on the single-table form, and a malformed declaration fails', () => {
    const r = repo()
    expect(bench(['check', 't.json', 'PREREG.md', '--spec', 'spec.json', '--allow-unstamped']).code).toBe(3)
    expect(bench(['check', 't.json', 'PREREG.md', '--spec', 'spec.json', '--stress', r.rows]).err).toMatch(/--stress apply only to bench check <tables-dir>/)
    expect(bench(['check', r.tables, '--allow-unstamped', '--allow-unstamped']).code).toBe(3)
    expect(stressProblems({ format: STRESS_FORMAT, title: 't', harness: 'h.ts', rows: '../out', pack: 'p', amendment: 'a.md', files: ['x.jsonl'] })).toEqual([
      'rows is a path from the repository root that stays inside it',
      'files: x.jsonl is not a banked holdout file name',
    ])
    writeFileSync(join(r.tables, '_stress.json'), '{"format":"bench-stress/1"}')
    expect(checkStress(r.tables)).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/_stress\.json is not a well-formed bench-stress\/1/) })
  })
})

const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'bench')
const SHIPPED = ['legal-blind-2-030', 'legal-blind-2', 'cold-review-r4', 'x1-einvoice-pdf']
describe.skipIf(!SHIPPED.every(id => existsSync(join(BENCH, `${id}.json`))))('the stamp rule\'s exceptions on the index page', () => {
  const tables = SHIPPED.map(id => JSON.parse(readFileSync(join(BENCH, `${id}.json`), 'utf8')) as BenchTable)
  const page = renderBenchIndex(tables, new Map(tables.map(t => [t.id, 'x'.repeat(64)])), null, null, { folders: new Set(SHIPPED) })
  it('the rule says it is not met everywhere, and lists each exception with its times', () => {
    expect(page).toContain('Every preregistration is to be stamped by a timestamp authority before its run. This tree does not meet the rule everywhere yet')
    expect(page).toMatch(/- `legal-blind-2-030` broke the rule: its run \(2026-10-05T17:50:41Z\) came after stamping began, and its prereg was stamped at 2026-10-05T19:12:24Z, 81 minutes after the run\./)
    // a run that day but before the first stamp in the tree is not called a breach
    expect(page).toMatch(/- `legal-blind-2` ran on the day the rule began \(2026-10-05T14:26:10Z\), before the first stamp in this tree \(2026-10-05T16:07:\d\dZ\)/)
    // cold-review-r4 recorded misses only and read NEEDS STAMP until 2026-10-14, when its SCOPE.md was stamped (after the run,
    // and registered in its run.json on 2026-10-19); the page now says so plainly and no shipped table reads NEEDS STAMP
    expect(page).toMatch(/- `cold-review-r4` broke the rule: its run \(2026-10-05\) came after stamping began, and its prereg was stamped at 2026-10-14T17:53:58Z, after the run\. Its table reads "stamped after the run"/)
    expect(page).not.toMatch(/record misses only/)
    expect(page).toContain('exits 4 while any table reads NEEDS STAMP, so a CI step can enforce the rule; `--allow-unstamped` accepts them knowingly and exits 0')
  })
  it('a tree that meets the rule prints no exception list', () => {
    const clean = renderBenchIndex([tables[3]!], new Map([[tables[3]!.id, 'x'.repeat(64)]]), null, null, {})
    expect(clean).toContain('Every preregistration is to be stamped by a timestamp authority before its run.\nA stamp is made with')
    expect(clean).not.toContain('Where this tree does not meet the rule')
  })
})

describe.skipIf(!existsSync(join(BENCH, '_stress.json')))('the shipped stress declaration', () => {
  const decl = JSON.parse(readFileSync(join(BENCH, '_stress.json'), 'utf8')) as StressDeclaration
  it('is well formed and names the stress amendment that ships beside the tables', () => {
    expect(stressProblems(decl)).toEqual([])
    expect(existsSync(join(BENCH, decl.amendment))).toBe(true)
  })
  // in the public tree the rows sit where the declaration says; elsewhere this is skipped
  const rows = resolve(BENCH, '..', '..', '..', '..', decl.rows)
  it.skipIf(!existsSync(rows))('lists exactly the banked holdout files in the rows folder', () => {
    expect(readdirSync(rows).filter(f => HOLDOUT_FILE.test(f)).sort()).toEqual([...decl.files].sort())
  })
})
