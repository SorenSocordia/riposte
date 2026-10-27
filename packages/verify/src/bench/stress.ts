/**
 * The AP stress rows under `bench check` (bench-stress/1, `docs/bench/_stress.json`).
 *
 * The AP stress study (BENCHMARK-AP.md) is not a bench table: its protocol's sha256 was never recorded before its run, so
 * its numbers sit outside the bench rule. Its banked rows still make a claim a reader can test: every row carries
 * `checker_sha256`, the sha256 over the AP pack's source files, with the engine version and the AP ruleset, and a fresh run
 * of the harness (`bench/ap/stress.ts`) reproduces the banked files byte for byte. When the AP pack changes and nobody
 * re-banks, that claim breaks without a sound. So `bench check` compares every banked row with what this tree builds, using
 * the one digest function the harness also uses (`apPackDigest`), and fails when they disagree.
 *
 * `_stress.json` names the rows' folder and the AP pack's folder relative to the repository root (the tables directory is
 * `packages/verify/docs/bench`, four levels below it) and lists the banked files. `--stress <dir>` and `--pack <dir>` point
 * the check at another layout.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { AP_RULESET } from '../ap/index.js'
import { ENGINE_VERSION } from '../version.js'

export const STRESS_FORMAT = 'bench-stress/1'

/** The AP pack's source digest: sha256 over "<sha256 of the file>  <name>\n" for every `*.ts` in the folder, sorted by name. */
export function apPackDigest(packDir: string): { sha256: string; files: string[] } {
  const files = readdirSync(packDir).filter(f => f.endsWith('.ts')).sort()
  const list = files.map(f => `${createHash('sha256').update(readFileSync(join(packDir, f))).digest('hex')}  ${f}\n`).join('')
  return { sha256: createHash('sha256').update(list).digest('hex'), files }
}

/** The AP ruleset as a stress row names it. */
export const AP_RULESET_REF = `${AP_RULESET.id}@${AP_RULESET.version}`

export interface StressDeclaration {
  format: typeof STRESS_FORMAT
  title: string
  /** The harness that writes the rows, from the repository root. */
  harness: string
  /** The banked rows' folder, from the repository root. */
  rows: string
  /** The AP pack's source folder, from the repository root. */
  pack: string
  /** The dated record of every re-bank, inside the tables directory. */
  amendment: string
  /** The banked files, by name. */
  files: string[]
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const plainRel = (p: unknown): boolean => typeof p === 'string' && !!p && !/^[\\/]|^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..')
/** A banked holdout file: the only stress rows that ship (development seeds are re-run, never banked). */
export const HOLDOUT_FILE = /^stress-P\d_\w+-holdout\d+\.jsonl$/

/** Every problem with a stress declaration ([] when well formed). */
export function stressProblems(x: unknown): string[] {
  if (!isObj(x) || x.format !== STRESS_FORMAT) return [`not a ${STRESS_FORMAT}`]
  const out: string[] = []
  for (const k of ['title', 'harness', 'rows', 'pack', 'amendment'] as const) if (!plainRel(x[k]) && k !== 'title') out.push(`${k} is a path from the repository root that stays inside it`)
  if (typeof x.title !== 'string' || !x.title.trim()) out.push('title is required')
  if (!Array.isArray(x.files) || !x.files.length) out.push('files lists the banked files')
  else {
    const seen = new Set<string>()
    for (const f of x.files) {
      if (typeof f !== 'string' || !HOLDOUT_FILE.test(f)) { out.push(`files: ${String(f)} is not a banked holdout file name`); continue }
      if (seen.has(f)) out.push(`files: ${f} is listed twice`)
      seen.add(f)
    }
  }
  return out
}

export interface StressOptions {
  /** The banked rows' folder (default: the declaration's, from the repository root). */
  rows?: string
  /** The AP pack's source folder (default: the declaration's, from the repository root). */
  pack?: string
}

export interface StressReport {
  status: 'MATCH' | 'DIFFERS' | 'FAIL'
  /** One line of words for the check's output. */
  detail: string
  files: number
  rows: number
  tree?: { sha256: string; files: string[]; engine: string; ruleset: string }
  /** Each distinct (checker_sha256, engine, ruleset) the banked rows carry, with its row count. */
  banked: { checker_sha256: string; engine_version: string; ruleset: string; rows: number }[]
}

const short = (h: string): string => `${h.slice(0, 8)}…`
const n = (x: number): string => x.toLocaleString('en-US')

/**
 * The stress check for a tables directory: null when the directory declares no stress rows and no folder was given.
 * Otherwise MATCH when every declared file is present, no undeclared holdout file sits beside them, and every row names this
 * tree's AP pack digest, engine version and AP ruleset; DIFFERS when the rows name anything else; FAIL when the declaration,
 * the rows or the pack cannot be read.
 */
export function checkStress(tablesDir: string, o: StressOptions = {}): StressReport | null {
  const declPath = join(tablesDir, '_stress.json')
  const hasDecl = existsSync(declPath)
  if (!hasDecl && o.rows === undefined && o.pack === undefined) return null
  const fail = (detail: string): StressReport => ({ status: 'FAIL', detail, files: 0, rows: 0, banked: [] })
  let decl: StressDeclaration | null = null
  if (hasDecl) {
    let x: unknown
    try { x = JSON.parse(readFileSync(declPath, 'utf8')) } catch (e) { return fail(`_stress.json is not JSON: ${(e as Error).message}`) }
    const p = stressProblems(x)
    if (p.length) return fail(`_stress.json is not a well-formed ${STRESS_FORMAT}: ${p.join('; ')}`)
    decl = x as StressDeclaration
  }
  const root = resolve(tablesDir, '..', '..', '..', '..')
  const shown = (abs: string): string => { const r = relative(root, abs); return r && !r.startsWith('..') && !/^[A-Za-z]:/.test(r) ? r.split(sep).join('/') : abs }
  const rowsDir = o.rows !== undefined ? resolve(o.rows) : decl ? join(root, decl.rows) : null
  const packDir = o.pack !== undefined ? resolve(o.pack) : decl ? join(root, decl.pack) : null
  if (!rowsDir) return fail('no stress rows folder: give --stress <dir>, or declare it in _stress.json')
  if (!packDir) return fail('no AP pack folder: give --pack <the verify package\'s src/ap folder>, or declare it in _stress.json')
  // a declared path resolves against the repository root, taken to be four folders above the tables directory; a copied
  // tables directory has no repository there, so the message says where it looked and which flags point elsewhere
  const fromRoot = (k: 'rows' | 'pack', flag: string): string => (o[k] === undefined && decl
    ? ` (_stress.json names ${decl[k]} from the repository root, which this check takes to be four folders above the tables directory: ${root}. If this tables directory is a copy outside its repository, give --stress <the folder that holds the banked stress files> and --pack <the verify package's src/ap folder>)`
    : `: give ${flag}`)
  if (!existsSync(rowsDir) || !statSync(rowsDir).isDirectory()) return fail(`the stress rows are not at ${shown(rowsDir)}${fromRoot('rows', '--stress <the folder that holds the banked stress files>')}`)
  if (!existsSync(packDir) || !statSync(packDir).isDirectory()) return fail(`the AP pack sources are not at ${shown(packDir)}${fromRoot('pack', '--pack <the verify package\'s src/ap folder>')}`)
  const tree = { ...apPackDigest(packDir), engine: ENGINE_VERSION, ruleset: AP_RULESET_REF }
  if (!tree.files.length) return fail(`${shown(packDir)} holds no AP pack source files (*.ts)`)
  const present = readdirSync(rowsDir).filter(f => HOLDOUT_FILE.test(f)).sort()
  const declared = decl ? [...decl.files].sort() : present
  if (!declared.length) return fail(`no banked stress files in ${shown(rowsDir)}`)
  const missing = declared.filter(f => !present.includes(f))
  const undeclared = present.filter(f => !declared.includes(f))
  if (missing.length) return fail(`${missing.length} declared stress file(s) missing from ${shown(rowsDir)}: ${missing.join(', ')}`)
  if (undeclared.length) return fail(`${undeclared.length} stress file(s) in ${shown(rowsDir)} not declared in _stress.json: ${undeclared.join(', ')}`)
  const banked = new Map<string, { checker_sha256: string; engine_version: string; ruleset: string; rows: number }>()
  const offFiles = new Set<string>()
  let rows = 0
  for (const f of declared) {
    const text = readFileSync(join(rowsDir, f), 'utf8')
    const lines = text.split('\n').filter(l => l.trim())
    if (!lines.length) return fail(`${f} holds no rows`)
    for (const [i, line] of lines.entries()) {
      let r: unknown
      try { r = JSON.parse(line) } catch { return fail(`${f} line ${i + 1} is not JSON`) }
      if (!isObj(r) || typeof r.checker_sha256 !== 'string' || typeof r.engine_version !== 'string' || typeof r.ruleset !== 'string') return fail(`${f} line ${i + 1} does not name its checker_sha256, engine_version and ruleset`)
      const key = `${r.checker_sha256} ${r.engine_version} ${r.ruleset}`
      const b = banked.get(key) ?? { checker_sha256: r.checker_sha256, engine_version: r.engine_version, ruleset: r.ruleset, rows: 0 }
      b.rows++
      banked.set(key, b)
      if (r.checker_sha256 !== tree.sha256 || r.engine_version !== tree.engine || r.ruleset !== tree.ruleset) offFiles.add(f)
      rows++
    }
  }
  const list = [...banked.values()]
  const treeWords = `this tree's AP pack (${tree.files.length} source files in ${shown(packDir)}) hashes to ${short(tree.sha256)} under engine ${tree.engine} and ${tree.ruleset}`
  const base = { files: declared.length, rows, tree, banked: list }
  if (!offFiles.size) {
    return { ...base, status: 'MATCH', detail: `${declared.length} of ${declared.length} banked file(s), ${n(rows)} row(s), carry checker_sha256 ${short(tree.sha256)}, the digest this tree's AP pack builds (${tree.files.length} source files in ${shown(packDir)}), under engine ${tree.engine} and ${tree.ruleset}` }
  }
  const named = list.filter(b => b.checker_sha256 !== tree.sha256 || b.engine_version !== tree.engine || b.ruleset !== tree.ruleset)
    .map(b => `${n(b.rows)} row(s) carry checker_sha256 ${short(b.checker_sha256)} under engine ${b.engine_version} and ${b.ruleset}`).join('; ')
  const where = decl ? ` and record it in docs/bench/${decl.amendment}` : ''
  const harness = decl?.harness ?? 'the stress harness'
  return {
    ...base,
    status: 'DIFFERS',
    detail: `${offFiles.size} of ${declared.length} banked file(s) do not name this tree: ${named}, but ${treeWords}. The pack changed after the rows were banked, so a fresh run of ${harness} will not reproduce them byte for byte. Re-run each seed, show that no decision moved, re-bank on purpose (--bank)${where}.`,
  }
}
