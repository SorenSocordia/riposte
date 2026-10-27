/**
 * Joining host replies to provider usage rows (T2), with an explicit confidence for every join. Nothing is joined on time alone.
 *
 * Per-request exports (OpenRouter generations, OpenAI stored chat completions, OpenAI Response objects):
 *   request_id             the reply's id or request id equals the row's id, request id or upstream id     confidence 1.0
 *   time_tokens            one unclaimed row within the window whose input and output tokens equal the reply's   0.9
 *   time_tokens_ambiguous  several such rows, all naming the same model (the model agrees; the row is unknown)   0.6
 *   ambiguous              several such rows naming different models: no corroboration either way          0
 * Bucket exports (Anthropic usage report, OpenAI usage, OpenRouter activity, dashboard CSVs). All replies on one model in one
 * bucket (across every run of the month) are summed and compared with the bucket's rows for that model:
 *   bucket_exact           the rows' tokens equal the replies' sums (and request counts, when present)   minute 0.8 · hour 0.7 · day 0.6
 *   bucket_contained       the rows' tokens cover the sums (other traffic shares the bucket)              minute 0.6 · hour 0.45 · day 0.3
 *   bucket_short           a row for the model exists but bills fewer tokens than the replies used. No single reply can be
 *                          blamed, so each reply gets no verdict and the group is returned as one shortfall              0.6
 *   bucket_absent          the export covers the bucket, is grouped by model, and bills no usage on it     disagree, 0.7
 * An export speaks only for its own provider's traffic (and account, when both carry a label): time-and-tokens and bucket
 * judgments compare a reply only with exports of the provider the manifest says served it. A request-id join needs no provider.
 * Model names agree when equal, when one is the other with a dated snapshot suffix, or (OpenRouter activity) via the permaslug.
 */
import { modelMatches } from '../model-attest.js'
import { providerOf, type ParsedExport, type UsageRow, type ExportSource, type Granularity, type Provider } from './exports.js'

export interface ReplyRef {
  key: string
  /** the provider (and account) that served the reply, from the manifest. Without a provider, a reply joins only by request id. */
  provider?: Provider; account?: string
  id?: string; request_id?: string; at?: string; model: string | null; tokens?: { input: number; output: number } }

export type MatchMethod = 'request_id' | 'time_tokens' | 'time_tokens_ambiguous' | 'ambiguous' | 'bucket_exact' | 'bucket_contained' | 'bucket_short' | 'bucket_absent'
export interface Corroboration {
  source: ExportSource
  method: MatchMethod
  confidence: number
  verdict: 'agree' | 'disagree' | 'none'
  /** the model(s) the matched rows bill */
  billed: string[]
  /** the matched rows' record numbers in the export */
  records: number[]
  granularity: Granularity
}

export const CONFIDENCE = {
  request_id: 1, time_tokens: 0.9, time_tokens_ambiguous: 0.6, ambiguous: 0,
  bucket_exact: { minute: 0.8, hour: 0.7, day: 0.6 }, bucket_contained: { minute: 0.6, hour: 0.45, day: 0.3 }, bucket_short: 0.6, bucket_absent: 0.7,
} as const

export const DEFAULT_WINDOW_SECONDS = 300

/** A bucket where the provider billed a model for fewer tokens than the host says that model used: a group finding. */
export interface BucketShortfall { source: ExportSource; start: string; end: string; granularity: Granularity; model: string; replies: string[]; used: { input: number; output: number }; billed: { input: number; output: number }; records: number[] }
export interface MatchResult { byReply: Map<string, Corroboration[]>; shortfalls: BucketShortfall[] }

export const sameModel = (a: string | null | undefined, row: Pick<UsageRow, 'model' | 'model_alt'>): boolean => {
  if (!a) return false
  return [row.model, row.model_alt].some((b) => typeof b === 'string' && (a === b || modelMatches(a, b) || modelMatches(b, a)))
}

const tokensEqual = (t: { input: number; output: number } | undefined, r: UsageRow): boolean =>
  Boolean(t) && ((r.input === t!.input && r.output === t!.output) || (Boolean(r.alt_tokens) && r.alt_tokens!.input === t!.input && r.alt_tokens!.output === t!.output))

/** reply key → every corroboration found for it (one per export it matched in), and every bucket shortfall. */
export function matchReplies(replies: readonly ReplyRef[], exports: readonly ParsedExport[], opts: { windowSeconds?: number } = {}): MatchResult {
  const shortfalls: BucketShortfall[] = []
  const out = new Map<string, Corroboration[]>()
  const add = (k: string, c: Corroboration) => { const l = out.get(k); if (l) l.push(c); else out.set(k, [c]) }
  const windowMs = (opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000
  const ordered = [...replies].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.key.localeCompare(b.key))
  for (const ex of exports) {
    const p = providerOf(ex.source)
    const scoped = ordered.filter((r) => r.provider === p && (!ex.account || !r.account || ex.account === r.account))
    const reqRows = ex.rows.filter((r) => r.granularity === 'request')
    const bucketRows = ex.rows.filter((r) => r.granularity !== 'request')
    if (reqRows.length) matchRequests(ordered, scoped, ex.source, reqRows, windowMs, add)
    if (bucketRows.length) matchBuckets(scoped, ex, bucketRows, add, shortfalls)
  }
  return { byReply: out, shortfalls }
}

function matchRequests(replies: readonly ReplyRef[], scoped: readonly ReplyRef[], source: ExportSource, rows: readonly UsageRow[], windowMs: number, add: (k: string, c: Corroboration) => void): void {
  const byId = new Map<string, UsageRow[]>()
  for (const r of rows) for (const id of r.ids) { const l = byId.get(id); if (l) l.push(r); else byId.set(id, [r]) }
  const claimed = new Set<number>()
  const done = new Set<string>()
  const emit = (rep: ReplyRef, method: MatchMethod, matched: UsageRow[]) => {
    const billed = [...new Set(matched.map((r) => r.model ?? '(no model)'))]
    const agree = matched.every((r) => sameModel(rep.model, r))
    const verdict = method === 'ambiguous' ? 'none' : agree ? 'agree' : 'disagree'
    add(rep.key, { source, method, confidence: CONFIDENCE[method] as number, verdict, billed, records: matched.map((r) => r.record), granularity: 'request' })
  }
  for (const rep of replies) {
    const ids = [rep.id, rep.request_id].filter((x): x is string => Boolean(x))
    const hits = [...new Set(ids.flatMap((id) => byId.get(id) ?? []))]
    if (hits.length === 1) { claimed.add(hits[0]!.record); done.add(rep.key); emit(rep, 'request_id', hits) }
  }
  for (const rep of scoped) {
    if (done.has(rep.key) || !rep.at || !rep.tokens) continue
    const t = Date.parse(rep.at)
    const cands = rows.filter((r) => !claimed.has(r.record) && r.at && Math.abs(Date.parse(r.at) - t) <= windowMs && tokensEqual(rep.tokens, r))
    if (!cands.length) continue
    if (cands.length === 1) { claimed.add(cands[0]!.record); emit(rep, 'time_tokens', cands); continue }
    const models = new Set(cands.map((r) => r.model ?? ''))
    emit(rep, models.size === 1 ? 'time_tokens_ambiguous' : 'ambiguous', cands)
  }
}

function matchBuckets(replies: readonly ReplyRef[], ex: ParsedExport, rows: readonly UsageRow[], add: (k: string, c: Corroboration) => void, shortfalls: BucketShortfall[]): void {
  const spans = new Map<string, UsageRow[]>()
  for (const r of rows) { const k = `${r.start}|${r.end}`; const l = spans.get(k); if (l) l.push(r); else spans.set(k, [r]) }
  const grouped = rows.some((r) => r.model !== null)
  // spans sorted by start, for a binary search on each reply's time
  const sorted = [...spans.keys()].map((k) => { const [s, e] = k.split('|'); return { k, s: Date.parse(s!), e: Date.parse(e!) } }).sort((a, b) => a.s - b.s || a.e - b.e)
  const spanOf = (ms: number): string | undefined => {
    let lo = 0, hi = sorted.length - 1, best = -1
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid]!.s <= ms) { best = mid; lo = mid + 1 } else hi = mid - 1 }
    for (let i = best; i >= 0 && i > best - 4; i--) if (sorted[i]!.s <= ms && ms < sorted[i]!.e) return sorted[i]!.k
    return undefined
  }
  const coverS = ex.covers ? Date.parse(ex.covers.start) : NaN, coverE = ex.covers ? Date.parse(ex.covers.end) : NaN
  // replies → (span, model) groups
  const groups = new Map<string, { span: string; model: string; reps: ReplyRef[] }>()
  for (const rep of replies) {
    if (!rep.at || !rep.model) continue
    const ms = Date.parse(rep.at)
    if (Number.isNaN(ms)) continue
    let span = spanOf(ms)
    if (!span) {
      if (!ex.covers || ms < coverS || ms >= coverE || !grouped) continue
      span = `uncovered|${rep.at}` // inside the export's period, in a bucket with no rows at all
    }
    const k = `${span}#${rep.model}`
    const g = groups.get(k)
    if (g) g.reps.push(rep); else groups.set(k, { span, model: rep.model, reps: [rep] })
  }
  for (const g of groups.values()) {
    const inSpan = spans.get(g.span) ?? []
    const gran: Granularity = inSpan[0]?.granularity ?? rows[0]!.granularity
    const key = gran === 'request' ? 'day' : gran
    if (inSpan.length && inSpan.every((r) => r.model === null)) continue // not grouped by model: cannot speak to the model
    const forModel = inSpan.filter((r) => sameModel(g.model, r))
    const emit = (method: MatchMethod, verdict: Corroboration['verdict'], matched: UsageRow[], confidence: number) => {
      const billed = [...new Set((matched.length ? matched : inSpan).map((r) => r.model ?? '(no model)'))]
      for (const rep of g.reps) add(rep.key, { source: ex.source, method, confidence, verdict, billed, records: (matched.length ? matched : inSpan).map((r) => r.record), granularity: gran })
    }
    if (!forModel.length) { emit('bucket_absent', 'disagree', [], CONFIDENCE.bucket_absent); continue }
    const sumIn = g.reps.reduce((a, r) => a + (r.tokens?.input ?? 0), 0)
    const sumOut = g.reps.reduce((a, r) => a + (r.tokens?.output ?? 0), 0)
    const rowIn = forModel.reduce((a, r) => a + (r.input ?? 0), 0)
    const rowOut = forModel.reduce((a, r) => a + (r.output ?? 0), 0)
    const allTokens = g.reps.every((r) => r.tokens)
    const hasIn = forModel.every((r) => r.input !== undefined), hasOut = forModel.every((r) => r.output !== undefined)
    if ((hasIn && rowIn < sumIn) || (hasOut && rowOut < sumOut)) {
      emit('bucket_short', 'none', forModel, CONFIDENCE.bucket_short)
      const [start, end] = inSpan.length ? [inSpan[0]!.start!, inSpan[0]!.end!] : [g.span, g.span]
      shortfalls.push({ source: ex.source, start, end, granularity: gran, model: g.model, replies: g.reps.map((r) => r.key), used: { input: sumIn, output: sumOut }, billed: { input: rowIn, output: rowOut }, records: forModel.map((r) => r.record) })
      continue
    }
    const reqs = forModel.every((r) => r.requests !== undefined) ? forModel.reduce((a, r) => a + (r.requests ?? 0), 0) : undefined
    const exact = allTokens && hasIn && hasOut && rowIn === sumIn && rowOut === sumOut && (reqs === undefined || reqs === g.reps.length)
    if (exact) emit('bucket_exact', 'agree', forModel, CONFIDENCE.bucket_exact[key])
    else emit('bucket_contained', 'agree', forModel, CONFIDENCE.bucket_contained[key])
  }
}
