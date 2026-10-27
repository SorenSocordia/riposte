/**
 * A preregistered run that has not run pins the build it will test (cold review round 10, 2026-10-19: the shipped blind
 * prereg pinned engine 0.7.1 and legal@0.5.3, four of its source digests no longer matched the tree, its own stop rule forbade
 * the run, and `bench check` said OK). `bench check <tables-dir>` reads the prereg's pin tables (`| what | version | pin |`,
 * section 2 and every amendment after it, row by row), recomputes each digest the way the prereg defines it (sha256 over
 * "<sha256 of the file>  <path>\n" per file, sorted by path), compares each version with what this build resolves to, and
 * prints `STALE PINS <id>: …` for any that moved. Noted, not refused: exit 4, like NEED A STAMP, unless --strict-pins.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runBench } from '../src/bench/cli-bench'
import { checkTree, plannedRuns, preregPins, THIS_BUILD } from '../src/bench/tree'
import { renderBenchIndex } from '../src/bench/docs'
import { ENGINE_VERSION } from '../src/version'
import { AP_RULESET_REF } from '../src/bench/stress'
import { defaultLegalRuleset } from '../src/legal/index'

const VERIFY = join(dirname(fileURLToPath(import.meta.url)), '..')
const BENCH = join(VERIFY, 'docs', 'bench')
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const bench = (args: string[]): { code: number; err: string } => { let err = ''; const code = runBench(args, { out: () => {}, err: s => { err += s } }); return { code, err } }
const LEGAL = `legal@${defaultLegalRuleset().version}`

function walk(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const f of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${f}` : f
    if (statSync(join(dir, r)).isDirectory()) out.push(...walk(dir, r)); else out.push(r)
  }
  return out
}
const digest = (dir: string, files: string[]): string => sha([...files].sort().map(f => `${sha(readFileSync(join(dir, f)))}  ${f}\n`).join(''))

/** A repository laid out as the public tree, with one preregistered run (`blind-demo`) whose pins are computed on it. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'bench-pins-')); dirs.push(root)
  const tables = join(root, 'packages', 'verify', 'docs', 'bench')
  const src = join(root, 'packages', 'verify', 'src')
  for (const d of [tables, join(src, 'ap'), join(src, 'legal'), join(src, 'deep', 'er'), join(root, 'packages', 'verify', 'docs', 'examples')]) mkdirSync(d, { recursive: true })
  const files: Record<string, string> = {
    'packages/verify/src/version.ts': 'export const v = 1\n',
    'packages/verify/src/deep/er/x.ts': 'export const x = 1\n',
    'packages/verify/src/ap/a.ts': 'export const a = 1\n',
    'packages/verify/src/ap/b.ts': 'export const b = 2\n',
    'packages/verify/src/ap/README.md': 'not a source file\n',
    'packages/verify/src/legal/l.ts': 'export const l = 1\n',
    'packages/verify/docs/examples/rs.json': '{"ruleset":"demo"}\n',
  }
  for (const [f, b] of Object.entries(files)) writeFileSync(join(root, f), b)
  const pins = () => ({
    engine: digest(src, walk(src)), engineFiles: walk(src).length,
    ap: digest(join(src, 'ap'), ['a.ts', 'b.ts']),
    legal: digest(join(src, 'legal'), ['l.ts']),
    rs: sha(readFileSync(join(root, 'packages/verify/docs/examples/rs.json'))),
  })
  const write = (body: string): void => {
    const folder = join(tables, 'blind-demo')
    mkdirSync(folder, { recursive: true })
    const text = `# Preregistration: a pinned demo run\n\n${body}\nBars fixed now.\n`
    writeFileSync(join(folder, 'PREREG.md'), text)
    writeFileSync(join(folder, 'PREREG.sha256'), `# hashed before any data\n${sha(text)} *PREREG.md\n`)
  }
  const section2 = (o: { engine?: string; engineSha?: string; ap?: string; legal?: string } = {}): string => {
    const p = pins()
    return [
      '## 2. What is tested', '',
      '| what | version | pin |', '|---|---|---|',
      `| engine (\`riposte-verify\`) | ${o.engine ?? ENGINE_VERSION} | every file under \`packages/verify/src/\`, recursively: \`${o.engineSha ?? p.engine}\` (${p.engineFiles} files) |`,
      `| AP pack (\`packages/verify/src/ap/\`, \`*.ts\` at its top level) | ruleset ${o.ap ?? AP_RULESET_REF} | \`${p.ap}\` (2 files); \`bench check\` prints its first eight characters |`,
      `| e-invoice ruleset, scored beside it | demo@0.0.1 | \`packages/verify/docs/examples/rs.json\`, sha256 \`${p.rs}\` |`,
      `| legal rule, the default under this engine | ${o.legal ?? LEGAL} | \`packages/verify/src/legal/*.ts\` at its top level: \`${p.legal}\` (1 files) |`,
      '',
    ].join('\n')
  }
  return { root, tables, src, pins, write, section2 }
}

describe('a preregistration\'s pins are read from its own tables', () => {
  it('section 2 and each amendment after it, row by row: a later full digest overrides, an "unchanged" row keeps the earlier pin, a row with no path inherits it', () => {
    const r = repo()
    const p = r.pins()
    const amendment = [
      '## Amendment 1 (the pins of the shipped tree)', '',
      '| what | version | pin (over the shipped tree) |', '|---|---|---|',
      `| engine (\`riposte-verify\`) | ${ENGINE_VERSION} | every file under \`packages/verify/src/\`, recursively: \`${p.engine}\` (${p.engineFiles} files) |`,
      `| AP pack (\`packages/verify/src/ap/\`, \`*.ts\` at its top level) | ruleset ${AP_RULESET_REF} | \`${p.ap.slice(0, 8)}…\`, unchanged |`,
      `| legal rule, the default under this engine | ${LEGAL} | \`${p.legal}\` (1 files), unchanged |`,
      '',
    ].join('\n')
    const text = `${r.section2({ engineSha: 'a'.repeat(64) })}\n${amendment}`
    const pins = preregPins(text)
    expect(pins.map(x => [x.label, x.mode, x.path, x.sha256.slice(0, 8)])).toEqual([
      ['engine', 'recursive', 'packages/verify/src', p.engine.slice(0, 8)],
      ['AP pack', 'top', 'packages/verify/src/ap', p.ap.slice(0, 8)],
      ['e-invoice ruleset', 'file', 'packages/verify/docs/examples/rs.json', p.rs.slice(0, 8)],
      ['legal rule', 'top', 'packages/verify/src/legal', p.legal.slice(0, 8)],
    ])
    r.write(text)
    const c = bench(['check', r.tables])
    expect(c.code).toBe(0)
    expect(c.err).toMatch(/OK +blind-demo: preregistered, not run: .*; pins: 4 of 4 match this tree/)
    expect(c.err).not.toMatch(/STALE PINS/)
  })

  it('a prereg with no pin table gets no pin words and no line', () => {
    const r = repo()
    r.write('No pins here.\n')
    const c = bench(['check', r.tables])
    expect(c.code).toBe(0)
    expect(c.err).not.toMatch(/pins:|STALE PINS/)
  })
})

describe('bench check names a prereg whose pins no longer match the tree it sits in', () => {
  it('an older engine label pinned: STALE PINS names both; exit 4, noted not refused; --strict-pins refuses with exit 1', () => {
    const r = repo()
    r.write(r.section2({ engine: '0.0.1' }))
    const c = bench(['check', r.tables])
    expect(c.code).toBe(4)
    expect(c.err).toContain(`verify bench check: STALE PINS blind-demo: engine 0.0.1 pinned, tree ${ENGINE_VERSION}\n`)
    expect(c.err).toMatch(/ALL MATCH/)
    expect(c.err).toMatch(/exit 4: 1 preregistration\(s\) pin a build other than this tree/)
    expect(bench(['check', r.tables, '--allow-unstamped']).code).toBe(4)
    const strict = bench(['check', r.tables, '--strict-pins'])
    expect(strict.code).toBe(1)
    expect(strict.err).toMatch(/REFUSED by --strict-pins: 1 preregistration\(s\) pin a build other than this tree: blind-demo/)
  })

  it('a rule version this build no longer resolves to by default is named the same way; a file pinned beside the default is held to its bytes only', () => {
    const r = repo()
    r.write(r.section2({ legal: 'legal@0.0.1', ap: 'ruleset ap-threeway@0.0.9' }))
    const c = bench(['check', r.tables])
    expect(c.code).toBe(4)
    expect(c.err).toContain(`STALE PINS blind-demo: ap-threeway@0.0.9 pinned, tree ${AP_RULESET_REF}; legal@0.0.1 pinned, tree ${LEGAL}\n`)
    expect(c.err).not.toMatch(/demo@0\.0\.1 pinned/)
  })

  it('a source that moved after the pin: the digest pair is named, with the file counts when they differ', () => {
    const r = repo()
    const before = r.pins()
    r.write(r.section2())
    writeFileSync(join(r.src, 'deep', 'er', 'x.ts'), 'export const x = 2\n')
    writeFileSync(join(r.src, 'deep', 'y.ts'), 'export const y = 3\n')
    const after = r.pins()
    const c = bench(['check', r.tables])
    expect(c.code).toBe(4)
    expect(c.err).toContain(`STALE PINS blind-demo: engine sources ${before.engine.slice(0, 8)}… (${before.engineFiles} files) pinned, tree ${after.engine.slice(0, 8)}… (${after.engineFiles} files)\n`)
    expect(c.err).toMatch(/pins: 3 of 4 match this tree/)
  })

  it('pinned folders that are not under the tree (a copied tables directory): versions are still compared, the sources are named as not recomputed, and --pins-root points at the tree', () => {
    const r = repo()
    r.write(r.section2({ engine: '0.0.1' }))
    const copy = mkdtempSync(join(tmpdir(), 'bench-pins-copy-')); dirs.push(copy)
    cpSync(r.tables, copy, { recursive: true })
    const c = bench(['check', copy])
    expect(c.code).toBe(4)
    expect(c.err).toMatch(new RegExp(`STALE PINS blind-demo: engine 0\\.0\\.1 pinned, tree ${ENGINE_VERSION.replace(/\./g, '\\.')}; not recomputed here, because the pinned paths are not under .+ \\(give --pins-root <the tree's root>\\): engine sources, AP pack sources, e-invoice ruleset file, legal rule sources\\n`))
    const rooted = bench(['check', copy, '--pins-root', r.root])
    expect(rooted.code).toBe(4)
    expect(rooted.err).toContain(`STALE PINS blind-demo: engine 0.0.1 pinned, tree ${ENGINE_VERSION}\n`)
    // every pin matching, only the sources unrecomputed: no STALE line, the OK line says what was not checked, exit 0
    r.write(r.section2())
    const copy2 = mkdtempSync(join(tmpdir(), 'bench-pins-copy2-')); dirs.push(copy2)
    cpSync(r.tables, copy2, { recursive: true })
    const quiet = bench(['check', copy2])
    expect(quiet.code).toBe(0)
    expect(quiet.err).toMatch(/pins: 0 of 4 recomputed here \(the pinned paths are not under this tree\); the versions they name match this build/)
    expect(quiet.err).not.toMatch(/STALE PINS/)
  })

  it('--strict-pins and --pins-root apply only to bench check <tables-dir>', () => {
    const r = bench(['check', 'x.json', 'PREREG.md', '--spec', 's.json', '--strict-pins'])
    expect(r.code).toBe(3)
    expect(r.err).toMatch(/--strict-pins apply only to bench check <tables-dir>/)
  })

  it('the index page says, from the versions alone, that a planned run\'s pins moved', () => {
    const r = repo()
    r.write(r.section2({ engine: '0.0.1', legal: 'legal@0.0.1' }))
    const planned = plannedRuns(r.tables)
    expect(planned[0]!.stale_versions).toEqual([`engine 0.0.1 pinned, tree ${ENGINE_VERSION}`, `legal@0.0.1 pinned, tree ${LEGAL}`])
    const pageText = renderBenchIndex([], new Map(), null, null, { planned })
    expect(pageText).toContain(`Its version pins no longer match this tree: engine 0.0.1 pinned, tree ${ENGINE_VERSION}; legal@0.0.1 pinned, tree ${LEGAL}. \`bench check\` prints every pin that moved on a STALE PINS line.`)
  })
})

describe('the shipped blind-shipping-1 prereg', () => {
  it('its pins are read from section 2 and its latest amendment, and bench check flags it exactly when one of its versions differs from this build', () => {
    const text = readFileSync(join(BENCH, 'blind-shipping-1', 'PREREG.md'), 'utf8')
    const pins = preregPins(text)
    expect(pins.map(p => p.label)).toEqual(['engine', 'AP pack', 'e-invoice ruleset (the default under this engine)', 'e-invoice ruleset (scored beside it)', 'legal rule', 'pilot tool'])
    // 2026-10-27: Amendment 7 re-pinned the engine to c3e9b09d… (held-tables support); the latest amendment's engine row overrides section 2's and Amendment 1's (Amendment 6, 2026-10-20: the tree after the citations index and the ledger's null-line answer)
    expect(pins[0]!.sha256.startsWith('c3e9b09d')).toBe(true)
    const planned = plannedRuns(BENCH).find(p => p.id === 'blind-shipping-1')!
    const versionMoved = planned.stale_versions.length > 0
    const line = checkTree(BENCH).lines.find(l => l.id === 'blind-shipping-1')!
    expect(line.status).toBe('OK')
    if (versionMoved) expect(line.flag).toBe('stale pins')
    expect(THIS_BUILD.engine).toBe(ENGINE_VERSION)
  })
})
