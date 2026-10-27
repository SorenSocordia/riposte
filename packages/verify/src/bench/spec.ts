/**
 * The run spec (bench-spec/1): how one run's results become a bench table's rows and misses. A spec is data, written beside
 * the run, never in this package: it names the adapter (the run's shape), the label, the run's identity, and per row the
 * claim, the CI method, the bar as the prereg states it, and how n and k are counted from the results.
 *
 *   rows[].where / rows[].hit   items adapter: n = items matching `where`, k = those also matching `hit`
 *   rows[].items                the item source(s) for a row: one `<file>:<json.path>`, or a list whose items are concatenated
 *   rows[].n / rows[].k         a number, or { "$from": "<file>:<json.path>" } (summary adapter), or a literal (transcribed),
 *                               or { "$sum": ["<file>:<json.path>", …] } (the sum of several counts the results hold)
 *   rows[].reported             what the run's own report states ({ k, n }): a computed count that differs is a finding
 *   misses[]                    misses as the run's audit lists them (kind, description, post_hoc, fixed_by)
 *   misses_from[]               misses generated from the items: one per item matching `where`, `${path}` templates
 *
 * A where-clause is an object of path → expected value: a scalar (equality; a number and its decimal string are equal), a
 * list (membership), or an operator object ($ne, $in, $nin, $exists, $re, $gt, $ge, $lt, $le); `$or` / `$and` take lists.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { BenchRefused, displayPath, sha256Bytes } from './prereg.js'
import { CI_METHODS, LABELS, comparisonProblems, tuningProblems, type BarTest, type BenchLabel, type BenchMiss, type CiMethod, type TuningSlot } from './table.js'

export const SPEC_FORMAT = 'bench-spec/1'
export const ADAPTER_NAMES = ['items', 'summary', 'transcribed', 'native'] as const
export type AdapterName = typeof ADAPTER_NAMES[number]

export type Val = string | number | null | { $from: string } | { $sum: string[] }
export type Where = Record<string, unknown>

export interface RowSpec {
  claim: string
  method: CiMethod
  bar?: BarTest | null
  note?: string
  /** Item source(s) for this row (default: the spec's `items`); a list's items are concatenated, in order. */
  items?: string | string[]
  where?: Where
  hit?: Where
  n?: Val
  k?: Val
  reported?: { k?: number; n?: number }
}

export interface MissFromSpec {
  items?: string | string[]
  where?: Where
  id: string
  kind: string
  description: string
  post_hoc: boolean
  fixed_by?: string
}

export interface RunSpec {
  spec: typeof SPEC_FORMAT
  id: string
  title: string
  adapter: AdapterName
  label: BenchLabel
  blind: boolean
  /** A results directory's files, by name (`summary: "results/summary.json"`). A single results file is named `main`. */
  files?: Record<string, string>
  /** The default item source: `<file>:<json.path>`, `<json.path>` (main), or `<file>:` (the file's root). */
  items?: string
  /** Read bare NaN / Infinity (Python's json) as null. Off unless the spec says so. */
  json_nan?: boolean
  run: { id: string; date: string; engine_version?: Val; ruleset?: Val; dist_sha256?: Val }
  rows: RowSpec[]
  misses?: BenchMiss[]
  misses_from?: MissFromSpec[]
  tuning?: TuningSlot
  /** Who judged the outcomes, as the run's files show it (carried into the table as `audit`). */
  audit?: string
  /** What a reader of the folder's hash lists should know (a superseded freeze, a line added later), printed beside the prereg. */
  hash_list_note?: string
}

/** The results a run left, parsed, with the sha256 a table records. */
export interface LoadedResults {
  path: string
  sha256: string
  files: Map<string, unknown>
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** A path's segments: `a.b[0].c` → a, b, 0, c; a key holding dots is quoted: `by_config["gpt-5.6"].n`. */
export function pathSegments(path: string): string[] {
  const out: string[] = []
  const re = /\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|([^.[\]]+)/g
  for (const m of path.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]!))
  return out
}

/** The value at a dotted path (`a.b[0].c`, `a.b.0.c`, `a["key.with.dots"]`); the whole value for ''. */
export function getPath(o: unknown, path: string): unknown {
  if (!path) return o
  let cur = o
  for (const k of pathSegments(path)) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur) && /^\d+$/.test(k)) cur = cur[Number(k)]
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[k]
    else return undefined
  }
  return cur
}

/** Python's json writes NaN / Infinity bare; with the spec's `json_nan`, they read as null (no value), and only then. */
const nanToNull = (t: string): string => t.replace(/(?<=[:,[]\s*)-?(?:NaN|Infinity)(?=\s*[,}\]])/g, 'null')

function parseFile(abs: string, shown: string, nan = false): unknown {
  const raw = readFileSync(abs, 'utf8')
  const text = nan ? nanToNull(raw) : raw
  const ext = extname(abs).toLowerCase()
  try {
    if (ext === '.json') return JSON.parse(text)
    if (ext === '.jsonl') return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as unknown)
    if (ext === '.tsv') {
      const lines = text.split(/\r?\n/).filter(l => l.length)
      const head = (lines[0] ?? '').split('\t')
      return lines.slice(1).map(l => { const c = l.split('\t'); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ''])) })
    }
  } catch (e) { throw new BenchRefused('bad-results', `${shown} does not parse: ${(e as Error).message}`) }
  throw new BenchRefused('bad-results', `${shown}: results are read from .json, .jsonl or .tsv (got ${ext || 'no extension'})`)
}

/** Load a results file (named `main`) or a results directory (its files named by the spec). */
export function loadResults(path: string, spec: Pick<RunSpec, 'files' | 'json_nan'> | null, cwd: string): LoadedResults {
  const nan = spec?.json_nan === true
  const abs = resolve(cwd, path)
  const shown = displayPath(path, cwd)
  if (!existsSync(abs)) throw new BenchRefused('no-results', `the results ${shown} do not exist`)
  const files = new Map<string, unknown>()
  if (statSync(abs).isDirectory()) {
    const named = spec?.files
    if (!named || !Object.keys(named).length) throw new BenchRefused('no-results', `${shown} is a directory: the spec must name the files read from it (files)`)
    const lines: string[] = []
    for (const [name, rel] of Object.entries(named).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const f = join(abs, rel)
      if (!existsSync(f) || statSync(f).isDirectory()) throw new BenchRefused('no-results', `${shown}/${rel} (results file "${name}") does not exist`)
      files.set(name, parseFile(f, `${shown}/${rel}`, nan))
      lines.push(`${sha256Bytes(readFileSync(f))}  ${rel.split('\\').join('/')}`)
    }
    return { path: shown, sha256: sha256Bytes(`${lines.sort().join('\n')}\n`), files }
  }
  files.set('main', parseFile(abs, shown, nan))
  return { path: shown, sha256: sha256Bytes(readFileSync(abs)), files }
}

/** `<file>:<path>` → [file, path]; a bare path is in `main`. */
export function splitSource(src: string, files: Map<string, unknown>): [string, string] {
  const i = src.indexOf(':')
  if (i > 0 && files.has(src.slice(0, i))) return [src.slice(0, i), src.slice(i + 1)]
  return ['main', src]
}

/** A spec value: a literal, the value `$from` names in the results, or the sum of the counts `$sum` names. */
export function resolveVal(v: Val | undefined, results: LoadedResults | null, at: string): unknown {
  const from = isObj(v) ? (v as Record<string, unknown>).$from : undefined
  if (typeof from === 'string') {
    if (!results) throw new BenchRefused('bad-spec', `${at}: "$from" needs machine-readable results`)
    const [file, path] = splitSource(from, results.files)
    const val = getPath(results.files.get(file), path)
    if (val === undefined) throw new BenchRefused('bad-spec', `${at}: ${from} is not in the results`)
    return val
  }
  if (isObj(v) && '$sum' in v) {
    const list = (v as { $sum: unknown }).$sum
    if (!Array.isArray(list) || !list.length || !list.every(x => typeof x === 'string')) throw new BenchRefused('bad-spec', `${at}: "$sum" takes a non-empty list of "<file>:<json.path>" sources`)
    let total = 0
    for (const src of list as string[]) {
      const x = resolveVal({ $from: src }, results, at)
      if (!Number.isInteger(x) || (x as number) < 0) throw new BenchRefused('bad-spec', `${at}: ${src} is not a count (got ${JSON.stringify(x)}); "$sum" adds counts only`)
      total += x as number
    }
    return total
  }
  return v
}

/** The items one source, or a list of sources (concatenated in order), names. */
export function itemsFrom(src: string | string[], results: LoadedResults, at: string): unknown[] {
  return (Array.isArray(src) ? src : [src]).flatMap(s => itemsAt(s, results, at))
}

/**
 * The items a source names: a list of records; an object whose values are all records (each item then carries its key as
 * `_key`); or one record on its own (a single claim's result), as a list of one.
 */
export function itemsAt(src: string, results: LoadedResults, at: string): unknown[] {
  const [file, path] = splitSource(src, results.files)
  if (!results.files.has(file)) throw new BenchRefused('bad-spec', `${at}: no results file named "${file}"`)
  const v = getPath(results.files.get(file), path)
  if (Array.isArray(v)) return v
  if (isObj(v) && Object.keys(v).length && Object.values(v).every(isObj)) return Object.entries(v).map(([k, rec]) => ({ _key: k, ...(rec as Record<string, unknown>) }))
  if (isObj(v)) return [v]
  throw new BenchRefused('bad-spec', `${at}: ${src} is not a list, an object of records, or a record`)
}

const loose = (a: unknown, b: unknown): boolean =>
  a === b || ((typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'string' || typeof b === 'boolean') && String(a) === String(b))

/** Whether an item matches a where-clause (see the module comment). An empty clause matches everything. */
export function matches(item: unknown, where: Where | undefined): boolean {
  if (!where) return true
  for (const [key, want] of Object.entries(where)) {
    if (key === '$or') { if (!Array.isArray(want) || !want.some(w => matches(item, w as Where))) return false; continue }
    if (key === '$and') { if (!Array.isArray(want) || !want.every(w => matches(item, w as Where))) return false; continue }
    const got = getPath(item, key)
    if (Array.isArray(want)) { if (!want.some(w => loose(got, w))) return false; continue }
    if (isObj(want) && Object.keys(want).some(k => k.startsWith('$'))) {
      for (const [op, arg] of Object.entries(want)) {
        const num = Number(got), a = Number(arg)
        const ok =
          op === '$ne' ? !loose(got, arg)
            : op === '$in' ? Array.isArray(arg) && arg.some(w => loose(got, w))
              : op === '$nin' ? Array.isArray(arg) && !arg.some(w => loose(got, w))
                : op === '$exists' ? (arg ? got !== undefined && got !== null && got !== '' : got === undefined || got === null || got === '')
                  : op === '$re' ? typeof arg === 'string' && got !== undefined && got !== null && new RegExp(arg).test(String(got))
                    : op === '$gt' ? got !== '' && Number.isFinite(num) && num > a
                      : op === '$ge' ? got !== '' && Number.isFinite(num) && num >= a
                        : op === '$lt' ? got !== '' && Number.isFinite(num) && num < a
                          : op === '$le' ? got !== '' && Number.isFinite(num) && num <= a
                            : (() => { throw new BenchRefused('bad-spec', `unknown where operator ${op}`) })()
        if (!ok) return false
      }
      continue
    }
    if (!loose(got, want)) return false
  }
  return true
}

/** `${path}` replaced by the item's value at that path (lists joined with ", "; absent as ""). */
export function interpolate(template: string, item: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, p: string) => {
    const v = getPath(item, p.trim())
    if (v === undefined || v === null) return ''
    if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Every problem with a spec's shape ([] when well-formed). */
export function specProblems(s: unknown): string[] {
  if (!isObj(s)) return ['a spec must be an object']
  const out: string[] = []
  if (s.spec !== SPEC_FORMAT) out.push(`spec must be "${SPEC_FORMAT}"`)
  if (typeof s.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.id)) out.push('id must be a plain identifier')
  if (typeof s.title !== 'string' || !s.title.trim()) out.push('title is required')
  if (!ADAPTER_NAMES.includes(s.adapter as AdapterName)) out.push(`adapter must be one of ${ADAPTER_NAMES.join(', ')}`)
  if (!LABELS.includes(s.label as BenchLabel)) out.push(`label must be one of ${LABELS.join(', ')}`)
  if (typeof s.blind !== 'boolean') out.push('blind must be true or false')
  if (s.adapter === 'transcribed' && s.label !== 'transcribed') out.push('the transcribed adapter goes with label "transcribed"')
  if (s.label === 'transcribed' && s.adapter !== 'transcribed') out.push('label "transcribed" goes with the transcribed adapter')
  if (!isObj(s.run) || typeof s.run.id !== 'string' || typeof s.run.date !== 'string') out.push('run must name id and date')
  if (!Array.isArray(s.rows)) out.push('rows must be a list (empty for a misses-only table)')
  else s.rows.forEach((r, i) => {
    const at = `rows[${i}]`
    if (!isObj(r) || typeof r.claim !== 'string' || !r.claim.trim()) { out.push(`${at} needs a claim`); return }
    if (r.method === undefined) out.push(`${at} ("${r.claim}"): no CI method named (wilson or clopper-pearson)`)
    else if (!CI_METHODS.includes(r.method as CiMethod)) out.push(`${at} ("${r.claim}"): unknown CI method ${JSON.stringify(r.method)}`)
    if (r.bar !== undefined && r.bar !== null) {
      if (!isObj(r.bar) || typeof r.bar.text !== 'string' || !r.bar.text.trim()) out.push(`${at}.bar needs its preregistered text`)
      else {
        out.push(...comparisonProblems(r.bar.test, `${at}.bar.test`))
        if (r.bar.reused_from !== undefined && (typeof r.bar.reused_from !== 'string' || !r.bar.reused_from.trim())) out.push(`${at}.bar.reused_from, when given, names whose bar it is (the row then has no verdict of its own)`)
      }
    }
    if (r.items !== undefined && !(typeof r.items === 'string' || (Array.isArray(r.items) && r.items.length > 0 && r.items.every(x => typeof x === 'string')))) out.push(`${at}.items must be a source or a non-empty list of sources`)
    const counted = r.where !== undefined || r.hit !== undefined
    if (s.adapter === 'summary' && counted) out.push(`${at}: the summary adapter reads n and k, it counts no items (no where/hit)`)
    if (s.adapter === 'transcribed' && (counted || isObj(r.n) || isObj(r.k))) out.push(`${at}: a transcribed row carries literal n and k`)
    if (!counted && (r.n === undefined || r.k === undefined)) out.push(`${at} ("${r.claim}"): needs where/hit or n and k`)
    if (counted && s.adapter !== 'items') out.push(`${at}: where/hit belong to the items adapter`)
  })
  if (s.misses !== undefined && !Array.isArray(s.misses)) out.push('misses must be a list')
  if (s.misses_from !== undefined) {
    if (!Array.isArray(s.misses_from)) out.push('misses_from must be a list')
    else if (s.adapter !== 'items') out.push('misses_from belongs to the items adapter')
    else s.misses_from.forEach((m, i) => {
      if (!isObj(m) || typeof m.id !== 'string' || typeof m.kind !== 'string' || typeof m.description !== 'string' || typeof m.post_hoc !== 'boolean') out.push(`misses_from[${i}] must be { where, id, kind, description, post_hoc }`)
    })
  }
  if (s.tuning !== undefined) out.push(...tuningProblems(s.tuning))
  if (s.audit !== undefined && (typeof s.audit !== 'string' || !s.audit.trim())) out.push('audit, when given, names who judged the outcomes')
  if (s.hash_list_note !== undefined && (typeof s.hash_list_note !== 'string' || !s.hash_list_note.trim())) out.push('hash_list_note, when given, is a sentence about the hash lists')
  return out
}

/** Read and check a spec file; its sha256 travels in the table. */
export function readSpec(path: string, cwd: string): { spec: RunSpec; sha256: string } {
  const abs = resolve(cwd, path)
  if (!existsSync(abs)) throw new BenchRefused('bad-spec', `the spec ${displayPath(path, cwd)} does not exist`)
  const bytes = readFileSync(abs)
  let s: unknown
  try { s = JSON.parse(bytes.toString('utf8')) } catch (e) { throw new BenchRefused('bad-spec', `${displayPath(path, cwd)} is not JSON: ${(e as Error).message}`) }
  const p = specProblems(s)
  if (p.length) {
    const code = p.some(x => x.startsWith('tuning')) ? 'tuning-without-trace' : p.some(x => /no CI method/.test(x)) ? 'no-ci-method' : 'bad-spec'
    throw new BenchRefused(code, `${displayPath(path, cwd)}: ${p.join('; ')}`)
  }
  return { spec: s as RunSpec, sha256: sha256Bytes(bytes) }
}

/** The tables a directory holds (`*.json` other than the ledger and the refusal list), sorted by file name. */
export function listTableFiles(dir: string): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort()
}
