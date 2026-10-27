/**
 * The bench table: one fixed format for every declared-accuracy number (bench-table/1).
 *
 * A table carries the prereg it is held to (path, the frozen sha256, every recorded amendment), the run (id, date, engine,
 * ruleset, the results file's sha256), the rows (claim, n, k, rate, a 95% two-sided interval with its method named, the bar
 * as preregistered, the verdict against that bar), the misses beside the hits, and a label saying what kind of run it was.
 * A number without a prereg hash is never written: `emitTable` refuses before a table exists (bench/emit.ts).
 *
 * Labels:
 *   blind        preregistered and run on data the builder had not seen
 *   post-hoc     run after seeing the data it is scored on (a fix, a re-run, a preregistered but not blind measurement)
 *   demo         a constructed demonstration (a handful of cases, thresholds chosen by someone expecting a PASS)
 *   regression   a re-run showing published numbers did not move
 *   transcribed  the run left no machine-readable results; the numbers are typed from its report, named by sha256
 *
 * A row with no preregistered bar is descriptive: its verdict is INSUFFICIENT and its note says so. A row with n = 0 is
 * INSUFFICIENT whatever its bar. A row held to a bar that was written for another run (a post-hoc re-run reusing an earlier
 * run's prereg, `bar.reused_from`) has no verdict of its own: it reads POST-HOC, and its note says whether its counts meet
 * that bar's test. Pure: no clock, no randomness; the same inputs give the same bytes.
 */

import { rateInterval, type BoundMethod } from '../verdict/bounds.js'

export const BENCH_FORMAT = 'bench-table/1'
export const LABELS = ['blind', 'post-hoc', 'demo', 'regression', 'transcribed'] as const
export type BenchLabel = typeof LABELS[number]
export type CiMethod = BoundMethod
export const CI_METHODS: readonly CiMethod[] = ['wilson', 'clopper-pearson']
export type RowVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT' | 'POST-HOC'

/** One recorded hash of the prereg document, in the order it was recorded. */
export interface PreregHash {
  sha256: string
  /** Where the hash is written (a sidecar, a hash list, `file#json.path`, `file:line`), relative to the run's folder. */
  recorded_in: string
  /** The document name the record names, when it names one other than the prereg's own file (a frozen snapshot). */
  doc?: string
  at?: string
  note?: string
  /** The amendment's own words, taken verbatim from a recorded version of the prereg (`text_from` names the lines). */
  text?: string
  /** `<file>:<first>-<last>`: the lines `text` was taken from, in a file whose sha256 is one of the chain's records. */
  text_from?: string
}

export interface PreregRef {
  /** The prereg file, relative to the run's own folder. */
  path: string
  /** The sha256 of the prereg file as read at emission: the version the run is held to. Always a recorded hash. */
  sha256: string
  /** The first recorded hash. */
  frozen_sha256: string
  /** Every recorded hash after the first, up to and including the one the file matches. */
  amendments: PreregHash[]
  /** Hashes recorded after the one the file matches (the file is an earlier version than the last record). */
  later?: PreregHash[]
  /**
   * True when the prereg or a hash list the check reads names a path in the authors' working tree (a lab folder, a parent
   * hop, a drive). Found by the emitter, never typed: the index then notes that the frozen text's paths are historical.
   */
  lab_paths?: true
  /** What third-party timestamps show about the prereg (set when the table is emitted from its in-tree folder). */
  stamp?: PreregStamp
}

/** The day third-party stamping of preregs began. A run before it can only carry the unstamped label. */
export const STAMPING_FROM = '2026-10-05'
/** The label a prereg frozen before stamping began carries when no stamp predates its run (run.json `unstamped`). */
export const UNSTAMPED_LABEL = `unstamped (frozen before ${STAMPING_FROM})`
export const STAMP_STATUSES = ['stamped before the run', UNSTAMPED_LABEL, 'needs stamp', 'stamped after the run'] as const
export type StampStatus = typeof STAMP_STATUSES[number]

/** One RFC 3161 proof in the table's folder, as read from the token (its signature is checked by `verify bench check`). */
export interface StampProof {
  /** The proof file, relative to the folder (`PREREG.md.tsr`). */
  proof: string
  /** The file it covers (the proof's name without `.tsr`); its sha256 is the token's message imprint. */
  covers: string
  /** The time the authority signed, ISO 8601 UTC. */
  gen_time: string
  serial: string
  /** Whether the authority signed before the run began (a date-only run date begins at 00:00Z that day). */
  before_run: boolean
}
export interface PreregStamp { status: StampStatus; proofs: StampProof[] }

/** The instant a run began, from its date: a full timestamp as given, a date alone at 00:00Z (so a same-day stamp never counts). */
export function runStart(date: string): number {
  return Date.parse(/T/.test(date) ? (/(Z|[+-]\d{2}:?\d{2})$/.test(date) ? date : `${date}Z`) : `${date.slice(0, 10)}T00:00:00Z`)
}

/** The stamp status the run date and the proofs give (see STAMP_STATUSES). */
export function stampStatus(runDate: string, proofs: readonly Pick<StampProof, 'before_run'>[]): StampStatus {
  if (proofs.some(p => p.before_run)) return 'stamped before the run'
  if (runDate.slice(0, 10) < STAMPING_FROM) return UNSTAMPED_LABEL
  return proofs.length ? 'stamped after the run' : 'needs stamp'
}

/** A file a hash list in the table's folder names, by its sha256, that is not in the folder in those bytes, and why. */
export interface NotShipped { file: string; sha256: string; reason: string }

/**
 * A file a hash list in the table's folder names that does ship in the folder, but in bytes other than the ones recorded
 * (a comment line that named a private folder was rewritten): both sha256s, and why they differ. The reader cannot check the
 * difference without the original, and the table says so by listing it apart from the files that do not ship at all.
 */
export interface ShippedEdited { file: string; recorded_sha256: string; sha256: string; reason: string }

/**
 * Whether a reader holding this tree can rerun the run end to end: regenerate the per-case results from inputs that ship,
 * with a harness that ships, and compare them with the shipped results. Re-tallying a table from its shipped results
 * (`bench emit`) is not a rerun: every table can do that. `detail` says what reruns, with which command, and what is withheld
 * and why. `identical`, for a run that reruns, says what a rerun reproduces: `bytes` (the shipped results, byte for byte) or
 * `outcomes` (every outcome the table counts, while verdict ids and wording differ, because the engine label a verdict
 * carries does not pin the code until a release does). Written by the maintainers in run.json, never computed.
 */
export const RERUN_VALUES = ['yes', 'partly', 'no'] as const
export const RERUN_IDENTITY = ['bytes', 'outcomes'] as const
export interface Rerun { from_tree: typeof RERUN_VALUES[number]; detail: string; identical?: typeof RERUN_IDENTITY[number] }

/** Problems with a rerun record ([] when well formed). */
export function rerunProblems(x: unknown, at = 'rerun'): string[] {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return [`${at} must be { from_tree, detail }`]
  const r = x as Record<string, unknown>
  const out: string[] = []
  if (!RERUN_VALUES.includes(r.from_tree as Rerun['from_tree'])) out.push(`${at}.from_tree is one of ${RERUN_VALUES.join(', ')}`)
  if (typeof r.detail !== 'string' || !r.detail.trim()) out.push(`${at}.detail says what reruns from this tree and what is withheld, and why`)
  if (r.identical !== undefined) {
    if (!RERUN_IDENTITY.includes(r.identical as NonNullable<Rerun['identical']>)) out.push(`${at}.identical, when given, is one of ${RERUN_IDENTITY.join(', ')}`)
    else if (r.from_tree === 'no') out.push(`${at}.identical says what a rerun reproduces, so a run that does not rerun carries none`)
  }
  const extra = Object.keys(r).filter(k => k !== 'from_tree' && k !== 'detail' && k !== 'identical')
  if (extra.length) out.push(`${at} has unknown field(s): ${extra.join(', ')}`)
  return out
}

/** The words a rerun record prints after "Reruns from this tree:" and in the index's list: the answer, then what it reproduces. */
export function rerunWords(r: Rerun): string {
  if (r.identical === 'bytes') return `${r.from_tree}, byte for byte`
  if (r.identical === 'outcomes') return `${r.from_tree}, with identical outcomes; verdict ids differ until a release pins the engine label`
  return r.from_tree
}

export interface RunRef {
  id: string
  date: string
  engine_version: string | null
  /** id@version, or null where the run used no ruleset of this package. */
  ruleset: string | null
  dist_sha256?: string
  /** The machine-readable results the rows were computed from (absent for a transcribed table). */
  results?: { path: string; sha256: string }
  /** The report a transcribed table's numbers were typed from, by name and sha256. */
  report?: { name: string; sha256: string }
  /** The sha256 of the run spec that mapped results to rows (bench/spec.ts). */
  spec_sha256?: string
  /** Files the folder's hash lists name that do not ship in those bytes (from run.json), each with its sha256 and reason. */
  not_shipped?: NotShipped[]
  /** Files the folder's hash lists name that ship, edited: both sha256s and the reason (from run.json). */
  shipped_edited?: ShippedEdited[]
  /** Whether the run reruns from this tree, and what is withheld (from run.json). */
  rerun?: Rerun
  /**
   * For a table labelled blind: the record its blindness rests on (a hash list's time, a fetch log, a note in the prereg),
   * written by the maintainers in run.json. Every such record in this tree is the authors' own, so the label reads "blind, by
   * the authors' records" and this line names which records.
   */
  blind_basis?: string
}

/** A bar, as the prereg states it (`text`), and the machine test the verdict is computed from (`test`). */
export interface BarTest {
  text: string
  test: Comparison
  /** The fewest cases the prereg decides on: below it the row reads INSUFFICIENT whatever the counts ("INSUFFICIENT if |M| < 20"). */
  min_n?: number
  /**
   * Whose bar this is, when it was written for another run and reused after the fact ("the e-invoice PDF run's prereg"). The
   * row then reads POST-HOC, never PASS or FAIL: a bar written for one run is not a bar of its own for another.
   */
  reused_from?: string
}
export type Field = 'k' | 'n' | 'rate' | 'ci_lo' | 'ci_hi'
export type Op = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
/** `{ k: { eq: 0 } }`, `{ ci_lo: { ge: 0.8 } }`, `{ k: { eq: '$n' } }`, `{ all: [...] }`, `{ any: [...] }`. */
export type Comparison =
  | { all: Comparison[] }
  | { any: Comparison[] }
  | Partial<Record<Field, Partial<Record<Op, number | '$n'>>>>

export interface BenchRow {
  claim: string
  n: number
  k: number
  /** k / n, or null when n = 0. */
  rate: number | null
  /** 95% two-sided interval on k / n by `method`; [0, 1] when n = 0. */
  ci95: [number, number]
  method: CiMethod
  verdict: RowVerdict
  /** The bar as preregistered, or null for a descriptive row. */
  bar: BarTest | null
  note: string
}

export interface BenchMiss {
  id: string
  kind: string
  description: string
  /** True when the miss was found in a post-hoc run or after the blind result was read. */
  post_hoc: boolean
  /** What fixed it and in which version, once fixed. The ledger lets this be added, never changed or removed. */
  fixed_by?: string
  /** The miss's own date, when it differs from the run's. */
  date?: string
}

/**
 * The Φ2 slot (golden-section tuning of one knob). Reserved and validated, not produced here: a
 * tuned value travels with its whole search trace and the held-out set it was tuned on, or the table is refused.
 */
export interface TuningSlot {
  knob: string
  range: [number, number]
  objective: string
  heldout: string
  trace: { x: number; objective: number }[]
  chosen: number
}

export interface BenchTable {
  format: typeof BENCH_FORMAT
  id: string
  title: string
  prereg: PreregRef
  run: RunRef
  rows: BenchRow[]
  misses: BenchMiss[]
  blind: boolean
  label: BenchLabel
  /** Disagreements found at emission (a computed k/n that differs from the run's own report). Printed, never reconciled. */
  findings?: string[]
  tuning?: TuningSlot
  /**
   * Who judged the run's outcomes, as its files show it ("labels from the dataset's own gold answers", "hand-labelled by the
   * harness author", "a separate agent"). The label says whether the DATA was unseen; this says who did the AUDIT.
   */
  audit?: string
  /** What a reader of the folder's hash lists should know (a superseded freeze, a line added later), from the run spec. */
  hash_list_note?: string
}

const R6 = 1e6
/** Outward rounding at 1e-6 (the lower edge down, the upper edge up): float noise can only widen an interval. */
const down6 = (x: number): number => Math.max(0, Math.floor(x * R6 + 1e-9) / R6)
const up6 = (x: number): number => Math.min(1, Math.ceil(x * R6 - 1e-9) / R6)
const round6 = (x: number): number => Math.round(x * R6) / R6

/** The 95% two-sided interval on k / n by the named method (verdict/bounds.ts), rounded outward at 1e-6. */
export function ci95(k: number, n: number, method: CiMethod): [number, number] {
  if (n === 0) return [0, 1]
  const i = rateInterval(k, n, 0.95, method, 'two-sided')
  return [down6(i.lower), up6(i.upper)]
}

function fieldValue(f: Field, v: { k: number; n: number; rate: number | null; ci95: [number, number] }): number | null {
  switch (f) {
    case 'k': return v.k
    case 'n': return v.n
    case 'rate': return v.rate
    case 'ci_lo': return v.ci95[0]
    case 'ci_hi': return v.ci95[1]
  }
}

const OPS: Record<Op, (a: number, b: number) => boolean> = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b,
}
const FIELDS: readonly Field[] = ['k', 'n', 'rate', 'ci_lo', 'ci_hi']

/** Problems with a comparison's shape ([] when well-formed). */
export function comparisonProblems(c: unknown, at = 'test'): string[] {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return [`${at} must be an object`]
  const o = c as Record<string, unknown>
  if ('all' in o || 'any' in o) {
    const key = 'all' in o ? 'all' : 'any'
    if (Object.keys(o).length !== 1) return [`${at}: "${key}" stands alone`]
    const list = o[key]
    if (!Array.isArray(list) || list.length === 0) return [`${at}.${key} must be a non-empty list`]
    return list.flatMap((x, i) => comparisonProblems(x, `${at}.${key}[${i}]`))
  }
  const keys = Object.keys(o)
  if (keys.length === 0) return [`${at} is empty`]
  const out: string[] = []
  for (const k of keys) {
    if (!FIELDS.includes(k as Field)) { out.push(`${at}: unknown field "${k}" (fields: ${FIELDS.join(', ')})`); continue }
    const ops = o[k]
    if (typeof ops !== 'object' || ops === null || Array.isArray(ops) || Object.keys(ops).length === 0) { out.push(`${at}.${k} must name at least one operator`); continue }
    for (const [op, val] of Object.entries(ops as Record<string, unknown>)) {
      if (!(op in OPS)) out.push(`${at}.${k}: unknown operator "${op}" (operators: ${Object.keys(OPS).join(', ')})`)
      else if (!(typeof val === 'number' && Number.isFinite(val)) && val !== '$n') out.push(`${at}.${k}.${op} must be a number or "$n"`)
    }
  }
  return out
}

/** Whether the row's numbers meet the comparison. A comparison on `rate` when n = 0 is not met. */
export function meets(c: Comparison, v: { k: number; n: number; rate: number | null; ci95: [number, number] }): boolean {
  if ('all' in c && Array.isArray((c as { all?: unknown }).all)) return (c as { all: Comparison[] }).all.every(x => meets(x, v))
  if ('any' in c && Array.isArray((c as { any?: unknown }).any)) return (c as { any: Comparison[] }).any.some(x => meets(x, v))
  for (const [f, ops] of Object.entries(c as Record<string, Record<string, number | '$n'>>)) {
    const a = fieldValue(f as Field, v)
    if (a === null) return false
    for (const [op, raw] of Object.entries(ops)) {
      const b = raw === '$n' ? v.n : raw
      if (!OPS[op as Op](a, b)) return false
    }
  }
  return true
}

/**
 * The verdict of a row against its bar: INSUFFICIENT when there is no bar, n = 0, or n is below the bar's minimum; POST-HOC
 * when the bar was written for another run (`reused_from`), whatever the counts.
 */
export function rowVerdict(bar: BarTest | null, v: { k: number; n: number; rate: number | null; ci95: [number, number] }): RowVerdict {
  if (bar === null || v.n === 0) return 'INSUFFICIENT'
  if (bar.min_n !== undefined && v.n < bar.min_n) return 'INSUFFICIENT'
  if (bar.reused_from !== undefined) return 'POST-HOC'
  return meets(bar.test, v) ? 'PASS' : 'FAIL'
}

/** A complete row from claim, counts, method and bar. Refuses (throws) a row whose counts or method are not well-formed. */
export function makeRow(r: { claim: string; n: unknown; k: unknown; method?: unknown; bar?: BarTest | null; note?: string }): BenchRow {
  if (typeof r.claim !== 'string' || !r.claim.trim()) throw new TypeError('a row needs a claim')
  const n = r.n, k = r.k
  if (!Number.isInteger(n) || (n as number) < 0) throw new TypeError(`row "${r.claim}": n must be an integer >= 0 (got ${JSON.stringify(n)})`)
  if (!Number.isInteger(k) || (k as number) < 0 || (k as number) > (n as number)) throw new TypeError(`row "${r.claim}": k must be an integer in [0, n] (got k=${JSON.stringify(k)}, n=${JSON.stringify(n)})`)
  if (r.method === undefined || r.method === null) throw new TypeError(`row "${r.claim}": no CI method named (wilson or clopper-pearson)`)
  if (!CI_METHODS.includes(r.method as CiMethod)) throw new TypeError(`row "${r.claim}": unknown CI method ${JSON.stringify(r.method)} (wilson or clopper-pearson)`)
  const bar = r.bar ?? null
  if (bar !== null) {
    if (typeof bar.text !== 'string' || !bar.text.trim()) throw new TypeError(`row "${r.claim}": a bar needs its preregistered text`)
    const p = comparisonProblems(bar.test)
    if (bar.min_n !== undefined && (!Number.isInteger(bar.min_n) || bar.min_n < 1)) p.push('bar.min_n must be an integer >= 1')
    if (bar.reused_from !== undefined && (typeof bar.reused_from !== 'string' || !bar.reused_from.trim())) p.push('bar.reused_from, when given, names whose bar it is')
    if (p.length) throw new TypeError(`row "${r.claim}": ${p.join('; ')}`)
  }
  const nn = n as number, kk = k as number, method = r.method as CiMethod
  const rate = nn === 0 ? null : round6(kk / nn)
  const ci = ci95(kk, nn, method)
  const v = { k: kk, n: nn, rate: nn === 0 ? null : kk / nn, ci95: ci }
  const verdict = rowVerdict(bar, v)
  const notes: string[] = []
  if (bar === null) notes.push('descriptive: no preregistered bar')
  else if (nn === 0) notes.push('n = 0: nothing to decide')
  else if (bar.min_n !== undefined && nn < bar.min_n) notes.push(`n below the preregistered minimum of ${bar.min_n}`)
  else if (verdict === 'POST-HOC') notes.push(`post-hoc: the bar was written for ${bar.reused_from!.trim()}, not for this run, so the row has no verdict; its counts ${meets(bar.test, v) ? 'meet' : 'do not meet'} that bar's test`)
  if (r.note && r.note.trim()) notes.push(r.note.trim())
  return { claim: r.claim, n: nn, k: kk, rate, ci95: ci, method, verdict, bar, note: notes.join('; ') }
}

const HEX64 = /^[0-9a-f]{64}$/
/** Where an amendment's text was taken from: a file inside the run's folder, and a 1-based inclusive line range. */
export const TEXT_FROM = /^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|:))[^:]+:(\d+)-(\d+)$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Problems with a tuning slot ([] when well-formed): a tuned value never travels without its trace. */
export function tuningProblems(t: unknown): string[] {
  if (!isObj(t)) return ['tuning must be an object']
  const out: string[] = []
  for (const k of ['knob', 'objective', 'heldout'] as const) if (typeof t[k] !== 'string' || !(t[k] as string).trim()) out.push(`tuning.${k} must be named`)
  const range = t.range
  const okRange = Array.isArray(range) && range.length === 2 && range.every(x => typeof x === 'number' && Number.isFinite(x)) && (range[0] as number) < (range[1] as number)
  if (!okRange) out.push('tuning.range must be [low, high] with low < high')
  if (!Array.isArray(t.trace) || t.trace.length === 0) out.push('tuning.trace is empty: a tuned value is reported with its whole search trace, never alone')
  else {
    t.trace.forEach((s, i) => {
      if (!isObj(s) || typeof s.x !== 'number' || typeof s.objective !== 'number' || !Number.isFinite(s.x) || !Number.isFinite(s.objective)) out.push(`tuning.trace[${i}] must be { x, objective }`)
      else if (okRange && (s.x < (range as number[])[0]! || s.x > (range as number[])[1]!)) out.push(`tuning.trace[${i}].x is outside the declared range`)
    })
    if (typeof t.chosen !== 'number' || !t.trace.some(s => isObj(s) && s.x === t.chosen)) out.push('tuning.chosen must be one of the evaluated points in the trace')
  }
  return out
}

/** Problems with a prereg's stamp record ([] when well formed and its status is the one its proofs and run date give). */
export function stampProblems(s: unknown, runDate: string | null): string[] {
  if (!isObj(s)) return ['prereg.stamp must be an object']
  const out: string[] = []
  if (!STAMP_STATUSES.includes(s.status as StampStatus)) out.push(`prereg.stamp.status must be one of: ${STAMP_STATUSES.join('; ')}`)
  if (!Array.isArray(s.proofs)) return [...out, 'prereg.stamp.proofs must be a list']
  const start = runDate ? runStart(runDate) : NaN
  s.proofs.forEach((x, i) => {
    if (!isObj(x) || typeof x.proof !== 'string' || typeof x.covers !== 'string' || typeof x.gen_time !== 'string' || typeof x.serial !== 'string' || typeof x.before_run !== 'boolean') { out.push(`prereg.stamp.proofs[${i}] must be { proof, covers, gen_time, serial, before_run }`); return }
    const t = Date.parse(x.gen_time)
    if (!Number.isFinite(t)) out.push(`prereg.stamp.proofs[${i}].gen_time is not a time`)
    else if (Number.isFinite(start) && (t < start) !== x.before_run) out.push(`prereg.stamp.proofs[${i}].before_run does not follow from its time and the run's date`)
  })
  if (runDate && !out.length && stampStatus(runDate, s.proofs as StampProof[]) !== s.status) out.push(`prereg.stamp.status "${String(s.status)}" is not the one its proofs and the run's date give ("${stampStatus(runDate, s.proofs as StampProof[])}")`)
  return out
}

/** Every problem with a table's shape ([] when it is a well-formed bench-table/1). */
export function tableProblems(t: unknown): string[] {
  if (!isObj(t)) return ['a table must be an object']
  const out: string[] = []
  if (t.format !== BENCH_FORMAT) out.push(`format must be "${BENCH_FORMAT}"`)
  if (typeof t.id !== 'string' || !ID.test(t.id)) out.push('id must be a plain identifier ([A-Za-z0-9._-])')
  if (typeof t.title !== 'string' || !t.title.trim()) out.push('title is required')
  const p = t.prereg
  if (!isObj(p)) out.push('prereg is required: a number without a prereg hash is never written')
  else {
    if (typeof p.path !== 'string' || !p.path) out.push('prereg.path is required')
    for (const k of ['sha256', 'frozen_sha256'] as const) if (typeof p[k] !== 'string' || !HEX64.test(p[k] as string)) out.push(`prereg.${k} must be a sha256`)
    if (!Array.isArray(p.amendments)) out.push('prereg.amendments must be a list')
    else p.amendments.forEach((a, i) => { if (!isObj(a) || typeof a.sha256 !== 'string' || !HEX64.test(a.sha256) || typeof a.recorded_in !== 'string') out.push(`prereg.amendments[${i}] must be { sha256, recorded_in }`) })
    for (const [key, list] of [['amendments', p.amendments], ['later', p.later]] as const) {
      if (!Array.isArray(list)) continue
      list.forEach((a, i) => {
        if (!isObj(a) || (a.text === undefined && a.text_from === undefined)) return
        if (typeof a.text !== 'string' || typeof a.text_from !== 'string' || !TEXT_FROM.test(a.text_from)) out.push(`prereg.${key}[${i}]: an amendment's text travels with text_from "<file>:<first>-<last>"`)
      })
    }
    if (p.lab_paths !== undefined && p.lab_paths !== true) out.push('prereg.lab_paths, when present, is true')
    const chain = [p.frozen_sha256, ...(Array.isArray(p.amendments) ? p.amendments.map(a => (isObj(a) ? a.sha256 : undefined)) : [])]
    if (chain[chain.length - 1] !== p.sha256) out.push('prereg.sha256 must be the last hash of the chain (frozen, then amendments)')
  }
  const r = t.run
  if (!isObj(r)) out.push('run is required')
  else {
    if (typeof r.id !== 'string' || !r.id) out.push('run.id is required')
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(r.date)) out.push('run.date must be an ISO date')
    if (!(r.engine_version === null || typeof r.engine_version === 'string')) out.push('run.engine_version must be a string or null')
    if (!(r.ruleset === null || typeof r.ruleset === 'string')) out.push('run.ruleset must be "id@version" or null')
    if (r.not_shipped !== undefined) {
      if (!Array.isArray(r.not_shipped)) out.push('run.not_shipped must be a list')
      else r.not_shipped.forEach((x, i) => {
        if (!isObj(x) || typeof x.file !== 'string' || !x.file || typeof x.sha256 !== 'string' || !HEX64.test(x.sha256) || typeof x.reason !== 'string' || !x.reason.trim()) out.push(`run.not_shipped[${i}] must be { file, sha256, reason }`)
      })
    }
    if (r.shipped_edited !== undefined) {
      if (!Array.isArray(r.shipped_edited)) out.push('run.shipped_edited must be a list')
      else r.shipped_edited.forEach((x, i) => {
        if (!isObj(x) || typeof x.file !== 'string' || !x.file || typeof x.recorded_sha256 !== 'string' || !HEX64.test(x.recorded_sha256) || typeof x.sha256 !== 'string' || !HEX64.test(x.sha256) || typeof x.reason !== 'string' || !x.reason.trim()) out.push(`run.shipped_edited[${i}] must be { file, recorded_sha256, sha256, reason }`)
        else if (x.recorded_sha256 === x.sha256) out.push(`run.shipped_edited[${i}]: the shipped bytes are the recorded ones, so the file ships unedited`)
      })
    }
    if (r.rerun !== undefined) out.push(...rerunProblems(r.rerun, 'run.rerun'))
    if (r.blind_basis !== undefined && (typeof r.blind_basis !== 'string' || !r.blind_basis.trim())) out.push('run.blind_basis, when given, names the record the label rests on')
    if (r.blind_basis !== undefined && t.label !== 'blind') out.push('run.blind_basis goes with label "blind" only')
  }
  if (isObj(p) && p.stamp !== undefined) out.push(...stampProblems(p.stamp, isObj(r) && typeof r.date === 'string' ? r.date : null))
  if (!LABELS.includes(t.label as BenchLabel)) out.push(`label must be one of ${LABELS.join(', ')}`)
  if (typeof t.blind !== 'boolean') out.push('blind must be true or false')
  if (t.blind === true && t.label !== 'blind') out.push('blind: true goes with label "blind" only')
  if (t.label === 'transcribed' && !(isObj(r) && isObj(r.report))) out.push('a transcribed table names the report its numbers were typed from (run.report)')
  if (t.label !== 'transcribed' && isObj(r) && !isObj(r.results)) out.push('a table that is not transcribed names its machine-readable results (run.results)')
  if (!Array.isArray(t.rows)) out.push('rows must be a list')
  else t.rows.forEach((row, i) => {
    if (!isObj(row)) { out.push(`rows[${i}] must be an object`); return }
    try {
      const re = makeRow({ claim: row.claim as string, n: row.n, k: row.k, method: row.method, bar: (row.bar ?? null) as BarTest | null })
      if (re.rate !== row.rate || re.ci95[0] !== (row.ci95 as number[])?.[0] || re.ci95[1] !== (row.ci95 as number[])?.[1]) out.push(`rows[${i}] ("${String(row.claim)}"): rate or ci95 does not recompute from k, n and method`)
      if (re.verdict !== row.verdict) out.push(`rows[${i}] ("${String(row.claim)}"): verdict ${String(row.verdict)} does not recompute (the bar gives ${re.verdict})`)
    } catch (e) { out.push(`rows[${i}]: ${(e as Error).message}`) }
  })
  if (!Array.isArray(t.misses)) out.push('misses must be a list')
  else {
    const seen = new Set<string>()
    t.misses.forEach((m, i) => {
      if (!isObj(m) || typeof m.id !== 'string' || !m.id || typeof m.kind !== 'string' || !m.kind || typeof m.description !== 'string' || !m.description.trim() || typeof m.post_hoc !== 'boolean') out.push(`misses[${i}] must be { id, kind, description, post_hoc }`)
      else {
        if (seen.has(m.id)) out.push(`misses[${i}]: duplicate id "${m.id}"`)
        seen.add(m.id)
        if (m.fixed_by !== undefined && (typeof m.fixed_by !== 'string' || !m.fixed_by.trim())) out.push(`misses[${i}].fixed_by must be a non-empty string naming the fix and its version`)
        if (m.date !== undefined && (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(m.date))) out.push(`misses[${i}].date must be an ISO date`)
      }
    })
  }
  if (t.tuning !== undefined) out.push(...tuningProblems(t.tuning))
  if (t.audit !== undefined && (typeof t.audit !== 'string' || !t.audit.trim())) out.push('audit, when given, names who judged the outcomes')
  if (t.hash_list_note !== undefined && (typeof t.hash_list_note !== 'string' || !t.hash_list_note.trim())) out.push('hash_list_note, when given, is a sentence about the hash lists')
  return out
}

/** The table's bytes: two-space JSON with a trailing newline (the key order is the object's, built in format order). */
export function tableBytes(t: BenchTable): string {
  return `${JSON.stringify(t, null, 2)}\n`
}
