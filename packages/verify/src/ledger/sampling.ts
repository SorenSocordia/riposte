/**
 * Verifiable random selection — which verdicts a person must review, drawn from the book itself (2026-09-28,
 * evidence-integrity lane).
 *
 * The problem it answers (AS 2315 .39: "Sample items should be selected in such a way that the sample can be expected to be
 * representative of the population … all items in the population should have an opportunity to be selected"): an overturn
 * rate built from reviews someone CHOSE to do is not evidence. Here nobody chooses.
 *
 *   PERIODS    The chain is cut into calendar periods (UTC day / month / quarter) by the RUNNING MAXIMUM of its event
 *              timestamps, so every event belongs to exactly one period even if a clock steps backwards. A period is CLOSED
 *              once a later event exists (`closed_by`). Nobody picks the frame: the calendar does.
 *   EPOCH      The last event of the period: the chain head at the moment the period closed.
 *   SEED       sha256 over the domain prefix, the workflow, the period, and the EPOCH's entry_hash. Fixed by the chain; no
 *              party supplies it, so no party can pick a favourable one.
 *   FRAME      Every RECORD in the period whose verdict belongs to the workflow (the default key tenant/ruleset@version),
 *              split into strata by outcome (PASS, FAIL). Generated material (COUNSEL, judgement-tier findings) is never in it.
 *   DRAW       Per stratum, rank the frame by sha256(seed:stratum:verdict_id) and take the first ⌈rate × N⌉ (bottom-k: a
 *              uniform random subset without replacement). The draws are NESTED across rates (a higher rate's selection
 *              contains a lower rate's), so a reader can re-derive the selection at the policy's own rate whatever rate a
 *              committed sample declared.
 *
 * A SAMPLE event commits the drawn queue to the book (the door re-derives it and refuses any mismatch; readDecisionBook
 * re-derives it on every read). Anyone holding the chain export re-derives the same selection, byte for byte.
 *
 * HONEST BOUNDARY: the seed is only as unpredictable as the period's last event. A party who controls what is written at the
 * very end of a period (a malicious book-writer) could grind that event before the period closes; a reviewer, an agent
 * recording through the door, or anyone reading the book cannot. Mixing an external beacon declared in the policy (a public
 * randomness round, or the head anchored externally at the period's close) removes that residue; it is the next stone, not
 * built here (an OPTIONAL beacon would itself be a choice, so it has to be policy-mandated to help).
 */

import { canonicalize, sha256 } from '../verdict/canonical.js'
import type { LedgerEvent } from './chain.js'
import { evidenceMark, recordFactsAt } from './disk.js'

export type PeriodUnit = 'day' | 'month' | 'quarter'
export const PERIOD_UNITS: readonly PeriodUnit[] = ['day', 'month', 'quarter']
export const isPeriodUnit = (u: unknown): u is PeriodUnit => PERIOD_UNITS.includes(u as PeriodUnit)
/** Longest first: a higher consequence tier may not re-test less often than a lower one (lintPolicy). */
export const PERIOD_LENGTH_RANK: Readonly<Record<PeriodUnit, number>> = { day: 0, month: 1, quarter: 2 }

export type Stratum = 'PASS' | 'FAIL'
export const STRATA: readonly Stratum[] = ['PASS', 'FAIL']

export const SAMPLE_SEED_PREFIX = 'riposte:sample-seed:v0\n'

const iso = (ms: number): string => new Date(ms).toISOString()

/** The calendar period (UTC) containing `ms`: [start, end). */
export function periodAt(ms: number, unit: PeriodUnit): { start: string; end: string } {
  const d = new Date(ms)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  if (unit === 'day') {
    const s = Date.UTC(y, m, d.getUTCDate())
    return { start: iso(s), end: iso(s + 86_400_000) }
  }
  if (unit === 'month') return { start: iso(Date.UTC(y, m, 1)), end: iso(Date.UTC(y, m + 1, 1)) }
  const q = Math.floor(m / 3) * 3
  return { start: iso(Date.UTC(y, q, 1)), end: iso(Date.UTC(y, q + 3, 1)) }
}

/** The end of the calendar period that follows the one starting at `start`: a drawn item's review deadline. */
export function nextPeriodEnd(start: string, unit: PeriodUnit): string {
  const cur = periodAt(Date.parse(start), unit)
  return periodAt(Date.parse(cur.end), unit).end
}

export interface PeriodSpan {
  unit: PeriodUnit
  start: string
  end: string
  /** Chain positions of the period's first and last events (the last is the EPOCH). */
  first_seq: number
  last_seq: number
  /** Position of the first event of a later period: present once the period is closed. */
  closed_by?: number
}

/** The chain's clock: the running maximum of its timestamps (ms), or undefined for an empty chain. */
export function chainClock(events: readonly LedgerEvent[]): number | undefined {
  let max: number | undefined
  for (const ev of events) {
    const t = Date.parse(ev.ts)
    if (Number.isFinite(t) && (max === undefined || t > max)) max = t
  }
  return max
}

/** Partition the chain into calendar periods by the running maximum of its timestamps. Deterministic. */
export function chainPeriods(events: readonly LedgerEvent[], unit: PeriodUnit): PeriodSpan[] {
  const out: PeriodSpan[] = []
  let max = -Infinity
  for (let i = 0; i < events.length; i++) {
    const t = Date.parse(events[i]!.ts)
    if (Number.isFinite(t) && t > max) max = t
    if (!Number.isFinite(max)) continue // no usable time yet: belongs to no period
    const p = periodAt(max, unit)
    const last = out[out.length - 1]
    if (last && last.start === p.start) { last.last_seq = i; continue }
    if (last) last.closed_by = i
    out.push({ unit, start: p.start, end: p.end, first_seq: i, last_seq: i })
  }
  return out
}

interface RecordPayloadLike {
  type?: unknown
  tenant_id?: unknown
  verdict?: { verdict_id?: unknown; outcome?: unknown; ruleset?: { id?: unknown; version?: unknown }; claims?: unknown }
}

/** The default workflow key (mirrors voice.ts defaultWorkflowOf; a test pins them equal). */
export function recordWorkflow(p: unknown): string | undefined {
  const q = p as RecordPayloadLike
  const r = q?.verdict?.ruleset
  if (!q || q.type !== 'RECORD' || typeof q.tenant_id !== 'string' || !r || typeof r.id !== 'string' || typeof r.version !== 'string') return undefined
  return `${q.tenant_id}/${r.id}@${r.version}`
}

/** Generated material and judgement-tier findings are never VERDICT evidence (voice.ts reads the same mark), so never in a frame. */
function isEvidence(v: unknown): boolean {
  return evidenceMark(v) === 'VERDICT'
}

/**
 * The frame of one period for one workflow: verdict ids per stratum (latest RECORD in the period decides), sorted. P-J: a
 * disk-backed book's RECORDs are read from its index (`recordFactsAt`), so a frame reads no verdict.
 */
export function periodFrame(events: readonly LedgerEvent[], payloads: readonly unknown[], workflow_id: string, span: PeriodSpan): Record<Stratum, string[]> {
  const latest = new Map<string, Stratum | undefined>()
  for (let i = span.first_seq; i <= span.last_seq; i++) {
    if (events[i]?.type !== 'RECORD') continue
    const p = (recordFactsAt(payloads, i) ?? payloads[i]) as RecordPayloadLike
    if (recordWorkflow(p) !== workflow_id) continue
    const v = p.verdict!
    if (typeof v.verdict_id !== 'string') continue
    const o = v.outcome
    latest.set(v.verdict_id, isEvidence(v) && (o === 'PASS' || o === 'FAIL') ? o : undefined)
  }
  const out: Record<Stratum, string[]> = { PASS: [], FAIL: [] }
  for (const [id, s] of latest) if (s) out[s].push(id)
  out.PASS.sort(); out.FAIL.sort()
  return out
}

/** The seed of a period's draw: fixed by the chain head at the period's close (the epoch). */
export function sampleSeed(workflow_id: string, unit: PeriodUnit, start: string, epoch_hash: string): string {
  return sha256(SAMPLE_SEED_PREFIX + canonicalize({ workflow_id, unit, start, epoch_hash }))
}

/** How many of N a rate draws: ⌈rate × N⌉ (at least one when rate > 0 and N > 0), float noise absorbed. */
export function drawSize(rate: number, n: number): number {
  if (!(rate > 0) || n <= 0) return 0
  return Math.min(n, Math.ceil(rate * n - 1e-9))
}

/** Bottom-k draw of one stratum: rank ids by sha256(seed:stratum:id), take ⌈rate × N⌉, return them sorted. Nested in rate. */
export function drawStratum(ids: readonly string[], seed: string, stratum: Stratum, rate: number): string[] {
  const k = drawSize(rate, ids.length)
  if (k === 0) return []
  return ids
    .map(id => ({ id, key: sha256(`${seed}:${stratum}:${id}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1))
    .slice(0, k)
    .map(x => x.id)
    .sort()
}

export interface SampleRates { PASS: number; FAIL: number }

export interface SampleBody {
  sample_version: 'sample-v0'
  workflow_id: string
  period: { unit: PeriodUnit; start: string; end: string }
  /** The period's chain positions; the population is the workflow's RECORDs among them. */
  frame: { first_seq: number; last_seq: number }
  /** The last event of the period: the chain head when it closed. Its entry_hash seeds the draw. */
  epoch: { seq: number; entry_hash: string }
  /** The first event of a later period: the proof the period had closed before the draw. */
  closed_by: number
  seed: string
  /** The fraction drawn per stratum (the policy tier's, for the rung in force when the period closed). */
  rates: SampleRates
  population: { PASS: number; FAIL: number }
  /** The drawn verdict ids per stratum, sorted: the review queue. */
  selected: { PASS: string[]; FAIL: string[] }
}

export interface SamplePayload { type: 'SAMPLE'; recorded_at: string; sample: SampleBody }

export interface SampleEntry { seq: number; entry_hash: string; recorded_at: string; sample: SampleBody }

/** The event header's subject for a SAMPLE (never a verdict id). */
export function sampleSubject(s: { workflow_id: string; period: { unit: PeriodUnit; start: string } }): string {
  return `sample:${s.workflow_id}:${s.period.unit}:${s.period.start}`
}

/** One key per (workflow, period, rates): the door refuses a second commit of the same draw. */
export function sampleKey(s: { workflow_id: string; period: { unit: PeriodUnit; start: string }; rates: SampleRates }): string {
  return `${s.workflow_id}|${s.period.unit}|${s.period.start}|${s.rates.PASS}|${s.rates.FAIL}`
}

export interface SampleRequest { workflow_id: string; unit: PeriodUnit; start: string; rates: SampleRates }

/** Thrown at the door when a sample cannot be drawn (period open or empty, bad rate) or is already committed. Appends nothing. */
export class SampleRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SampleRefused'
  }
}

const validRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 1

/**
 * Derive the sample for one closed period from the chain alone. Returns the body, or the reason it cannot be drawn: an
 * unknown unit, a bad rate, a period with no events or not yet closed, or nothing to draw. Deterministic: the same chain,
 * the same body, for anyone.
 */
export function deriveSample(events: readonly LedgerEvent[], payloads: readonly unknown[], req: SampleRequest, spans?: readonly PeriodSpan[]): SampleBody | { problem: string } {
  if (typeof req.workflow_id !== 'string' || !req.workflow_id) return { problem: 'a sample names its workflow_id' }
  if (!isPeriodUnit(req.unit)) return { problem: `period unit must be one of ${PERIOD_UNITS.join(', ')}` }
  if (!req.rates || !validRate(req.rates.PASS) || !validRate(req.rates.FAIL)) return { problem: 'rates.PASS and rates.FAIL must be fractions in [0, 1]' }
  if (req.rates.PASS === 0 && req.rates.FAIL === 0) return { problem: 'a sample draws something: at least one rate must be above 0' }
  // `spans` lets a reader that re-derives many samples partition the chain once per unit (closed spans never change).
  const span = (spans ?? chainPeriods(events, req.unit)).find(s => s.start === req.start)
  if (!span) return { problem: `no event on the book falls in the ${req.unit} starting ${req.start}` }
  if (span.closed_by === undefined) return { problem: `the ${req.unit} starting ${req.start} has not closed (no later event on the book yet): its epoch, and so its draw, is not fixed` }
  const frame = periodFrame(events, payloads, req.workflow_id, span)
  if (frame.PASS.length + frame.FAIL.length === 0) return { problem: `nothing to draw: no PASS or FAIL verdict of ${req.workflow_id} was recorded in that ${req.unit}` }
  const epoch = events[span.last_seq]!
  const seed = sampleSeed(req.workflow_id, req.unit, span.start, epoch.entry_hash)
  return {
    sample_version: 'sample-v0',
    workflow_id: req.workflow_id,
    period: { unit: req.unit, start: span.start, end: span.end },
    frame: { first_seq: span.first_seq, last_seq: span.last_seq },
    epoch: { seq: epoch.seq, entry_hash: epoch.entry_hash },
    closed_by: span.closed_by,
    seed,
    rates: { PASS: req.rates.PASS, FAIL: req.rates.FAIL },
    population: { PASS: frame.PASS.length, FAIL: frame.FAIL.length },
    selected: { PASS: drawStratum(frame.PASS, seed, 'PASS', req.rates.PASS), FAIL: drawStratum(frame.FAIL, seed, 'FAIL', req.rates.FAIL) },
  }
}
