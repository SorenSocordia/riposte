/**
 * Model attestation — which model ACTUALLY answered, reply by reply, and a receipt whenever it changed.
 *
 * The failure it exists for: a run declares one model; a floating alias ("opus", "…-latest") or a host fallback quietly
 * resolves to another; every output downstream is attributed to the model that was declared, not the one that answered.
 * Hosts already record the RESOLVED model on every reply — Anthropic `message.model`, OpenAI `model`, Claude Code transcripts
 * `message.model` — and nobody checks it. This checks it.
 *
 *   attestModels(events, policy)  → PASS | FAIL | INSUFFICIENT_DATA over a run, with every switch listed (announced or silent)
 *   modelGate(pinned, reply)      → PROCEED | HOLD for one reply, at runtime ("don't count an answer from the wrong model")
 *
 *   PASS              — every attested reply came from an expected model, and no switch happened silently
 *   FAIL              — a reply came from a model that was not declared, or the model changed with nothing announcing it
 *   INSUFFICIENT_DATA — can't tell: no reply recorded a model, or the declared model is itself a floating alias (written
 *                       ABSTAIN before 2026-10-06; readCheckOutcome, ./outcome.ts, still reads that)
 *
 * A switch is ANNOUNCED when a host-level switch request (e.g. the user's `/model` command) precedes it; otherwise SILENT.
 * No I/O (the transcript text is passed in). Deterministic, with one clock: a dated snapshot ("gpt-4.1-2025-04-14" under a
 * declared "gpt-4.1") must name a real date no later than its reply (2026-10-04, RT1 F11), judged against the reply's own
 * time when it carries one, else `asOf` (default now).
 */
import type { CheckOutcome } from './outcome.js'

/** One event in a run: a model reply, or a host-level request to switch models (which makes the next change "announced"). */
export type ModelEvent =
  | { type: 'reply'; model: string | null | undefined; at?: string; id?: string }
  | { type: 'switch_requested'; at?: string }
  /** the host itself switched models (e.g. Claude Code's safety-refusal fallback). Recorded, but nobody asked for it. */
  | { type: 'host_switch'; reason: string; from?: string; to?: string; at?: string }
  /** the model the host was asked to run at session start (e.g. a stream's system/init). Used as the pin when none is given. */
  | { type: 'session_model'; model: string; at?: string }

export interface AttestPolicy {
  /** the exact model id this run was declared to use */
  declared?: string
  /** or: any of these exact ids is acceptable (takes precedence over `declared`) */
  allowed?: string[]
  /** FAIL on a model change that nothing announced (default true) */
  failOnSilentSwitch?: boolean
  /** the clock a dated snapshot is judged against for a reply that carries no time of its own (default now) */
  asOf?: string | Date
}

/**
 * Why the model changed:
 * - `user_command`: the user asked (/model). Announced.
 * - `host_fallback`: the host switched on its own (e.g. after a safety refusal). Recorded, but nobody asked for it.
 * - `unrecorded`: nothing in the record explains it.
 * Only `user_command` counts as announced.
 */
export type SwitchCause = 'user_command' | 'host_fallback' | 'unrecorded'
export interface SwitchEvent { from: string; to: string; at?: string; reply: number; announced: boolean; cause: SwitchCause; host_reason?: string }

export interface ModelAttestation {
  outcome: CheckOutcome
  /** resolved model id → number of replies it produced */
  models: Record<string, number>
  first: string | null
  last: string | null
  replies: number
  switches: SwitchEvent[]
  /** replies whose model was not among the expected ids (first few, in order) */
  violations: { reply: number; model: string; at?: string }[]
  violation_count: number
  /** events with no usable model (missing, or a host placeholder such as Claude Code's "<synthetic>") */
  skipped: number
  /** every model change the host itself recorded (e.g. a safety-refusal fallback), including one before the first reply */
  host_switches: { reason: string; from?: string; to?: string; at?: string }[]
  expected: string[] | null
  reasons: string[]
  /**
   * The evidence tier this attestation rests on (2026-10-03): T1 when replies recorded the provider's model field, T0 when
   * none did. A single run never reaches T2 or T3 here: `riposte-attest monitor` adds provider usage exports and signed anchors.
   */
  evidence_tier: 'T0' | 'T1'
  evidence_note: string
  /**
   * (2026-10-04, RT1 F11) Present when an expected id is undated and replies resolved to dated snapshots of it: the evidence of
   * which snapshot answered, how often, and from when. A change between two snapshots is also a switch (silent unless asked for).
   */
  snapshots?: { declared: string; resolved: string; date: string; replies: number; first_at?: string }[]
  /** (2026-10-04) replies whose model is shaped like a snapshot of an expected id but is not one (no real date, or a later date) */
  snapshot_problems?: { reply: number; model: string; at?: string; problem: string }[]
}

const ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable', 'default', 'auto', 'best', 'latest'])
const PLACEHOLDER = /^<.*>$/

/** A bare tier name or a "-latest" pointer: it floats to whatever the provider serves today, so nothing can be attested against it. */
export function isFloatingAlias(id: string): boolean {
  const s = id.trim().toLowerCase()
  return ALIASES.has(s) || s.endsWith('-latest')
}

const SNAPSHOT_SHAPE = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/

/** A snapshot suffix (YYYYMMDD or YYYY-MM-DD) as the calendar date it names (YYYY-MM-DD), or null when it names no real date. */
export function snapshotDate(suffix: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(suffix) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(suffix)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return null
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!
  return d > days ? null : `${m[1]}-${m[2]}-${m[3]}`
}

/** The UTC calendar day of a clock reading (an ISO time, a Date, or ms); now when it is absent or does not parse. */
function dayOf(at: string | number | Date | undefined): string {
  const t = at === undefined ? NaN : at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at)
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString().slice(0, 10)
}

/**
 * Why `resolved` is not a dated snapshot of the undated `expected` although it is shaped like one (2026-10-04, RT1 F11), or
 * undefined: its suffix names no real calendar date ("gpt-4.1-2099-99-99"), or a date after `asOf`, the moment the reply was
 * made (a snapshot cannot answer before it exists; "claude-opus-5-5-20991231"). `asOf` defaults to now.
 */
export function snapshotProblem(expected: string, resolved: string, asOf?: string | number | Date): string | undefined {
  if (expected === resolved || !resolved.startsWith(`${expected}-`)) return undefined
  const suffix = resolved.slice(expected.length + 1)
  if (!SNAPSHOT_SHAPE.test(suffix)) return undefined
  const date = snapshotDate(suffix)
  if (!date) return `${resolved} is shaped like a dated snapshot of ${expected}, but ${suffix} is not a calendar date`
  const day = dayOf(asOf)
  if (date > day) return `${resolved} names a snapshot dated ${date}, after the reply (${day}): no snapshot answers before it exists`
  return undefined
}

/**
 * Exact id, or the same id with a dated snapshot suffix: "claude-sonnet-4-5" ↔ "claude-sonnet-4-5-20250929", and (2026-10-03)
 * the YYYY-MM-DD form "gpt-4.1" ↔ "gpt-4.1-2025-04-14". Nothing looser. Since 2026-10-04 (RT1 F11) the suffix must be a real
 * calendar date no later than `asOf` (the reply's own time when the caller has it; default now), so a fake or future snapshot
 * ("gpt-4.1-2099-99-99", "…-20991231") does not match.
 */
export function modelMatches(expected: string, resolved: string, asOf?: string | number | Date): boolean {
  if (expected === resolved) return true
  return resolved.startsWith(`${expected}-`) && SNAPSHOT_SHAPE.test(resolved.slice(expected.length + 1)) && snapshotProblem(expected, resolved, asOf) === undefined
}

const MAX_VIOLATIONS = 20

export function attestModels(events: ModelEvent[], policy: AttestPolicy = {}): ModelAttestation {
  const sessionModel = events.find((e): e is Extract<ModelEvent, { type: 'session_model' }> => e.type === 'session_model')?.model
  const fromHost = !policy.allowed?.length && !policy.declared && Boolean(sessionModel)
  const expected = policy.allowed?.length ? policy.allowed : policy.declared ? [policy.declared] : sessionModel ? [sessionModel] : null
  const out: ModelAttestation = {
    outcome: 'PASS', models: {}, first: null, last: null, replies: 0, switches: [], violations: [], violation_count: 0,
    skipped: 0, host_switches: [], expected, reasons: [], evidence_tier: 'T0', evidence_note: '',
  }
  const floating = (expected ?? []).filter(isFloatingAlias)
  const tierOf = (): void => {
    out.evidence_tier = out.replies ? 'T1' : 'T0'
    out.evidence_note = out.replies
      ? 'T1: the model field the host recorded for each reply. It cannot show that the provider reported truthfully; a provider usage export (T2) or a signed anchor (T3) raises it: riposte-attest monitor.'
      : 'T0: no reply recorded which model produced it.'
  }
  let pendingRequest = false
  let pendingHost: string | null = null
  const snapshots = new Map<string, NonNullable<ModelAttestation['snapshots']>[number]>()
  const snapshotProblems: NonNullable<ModelAttestation['snapshot_problems']> = []
  for (const e of events) {
    if (e.type === 'switch_requested') { pendingRequest = true; continue }
    if (e.type === 'host_switch') {
      pendingHost = e.reason
      out.host_switches.push({ reason: e.reason, ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}), ...(e.at ? { at: e.at } : {}) })
      continue
    }
    if (e.type === 'session_model') continue
    const m = typeof e.model === 'string' ? e.model.trim() : ''
    if (!m || PLACEHOLDER.test(m)) { out.skipped++; continue }
    const n = out.replies++
    out.models[m] = (out.models[m] ?? 0) + 1
    if (out.first === null) out.first = m
    if (out.last !== null && m !== out.last) {
      const cause: SwitchCause = pendingRequest ? 'user_command' : pendingHost ? 'host_fallback' : 'unrecorded'
      out.switches.push({ from: out.last, to: m, ...(e.at ? { at: e.at } : {}), reply: n, announced: cause === 'user_command', cause, ...(cause === 'host_fallback' ? { host_reason: pendingHost! } : {}) })
      pendingRequest = false
      pendingHost = null
    }
    out.last = m
    // a dated snapshot is judged against the reply's own time when it has one (RT1 F11, 2026-10-04)
    const asOf = e.at !== undefined && Number.isFinite(Date.parse(e.at)) ? e.at : policy.asOf
    if (expected && !floating.length && !expected.some((x) => modelMatches(x, m, asOf))) {
      out.violation_count++
      if (out.violations.length < MAX_VIOLATIONS) out.violations.push({ reply: n, model: m, ...(e.at ? { at: e.at } : {}) })
      const problem = expected.map((x) => snapshotProblem(x, m, asOf)).find((p) => p !== undefined)
      if (problem && snapshotProblems.length < MAX_VIOLATIONS) snapshotProblems.push({ reply: n, model: m, ...(e.at ? { at: e.at } : {}), problem })
    }
    for (const x of expected && !floating.length ? expected : []) {
      if (x === m || !modelMatches(x, m, asOf)) continue
      const key = `${x}\n${m}`
      const s = snapshots.get(key)
      if (s) s.replies++
      else snapshots.set(key, { declared: x, resolved: m, date: snapshotDate(m.slice(x.length + 1))!, replies: 1, ...(e.at ? { first_at: e.at } : {}) })
    }
  }
  if (snapshots.size) out.snapshots = [...snapshots.values()]
  if (snapshotProblems.length) out.snapshot_problems = snapshotProblems

  tierOf()
  if (floating.length) {
    out.outcome = 'INSUFFICIENT_DATA'
    out.reasons.push(`declared model ${floating.map((f) => `"${f}"`).join(', ')} is a floating alias — it resolves to whatever is served today, so nothing can be attested against it. Pin an exact model id.`)
    if (out.first) out.reasons.push(`(for the record: replies came from ${Object.keys(out.models).join(', ')})`)
    return out
  }
  if (!out.replies) {
    out.outcome = 'INSUFFICIENT_DATA'
    out.reasons.push(events.length ? 'no reply recorded which model produced it — cannot attest' : 'no replies to attest')
    return out
  }
  const silent = out.switches.filter((s) => !s.announced)
  if (out.violation_count) {
    out.outcome = 'FAIL'
    const wrong = [...new Set(out.violations.map((v) => v.model))]
    out.reasons.push(`${out.violation_count} of ${out.replies} replies came from ${wrong.join(', ')} — declared ${expected!.join(' | ')}`)
  }
  if (silent.length && policy.failOnSilentSwitch !== false) {
    out.outcome = 'FAIL'
    const host = silent.filter((s) => s.cause === 'host_fallback')
    const bare = silent.filter((s) => s.cause === 'unrecorded')
    const list = (ss: SwitchEvent[]) => `${ss.slice(0, 3).map((s) => `${s.from} → ${s.to}${s.at ? ` at ${s.at}` : ''}`).join('; ')}${ss.length > 3 ? '; …' : ''}`
    if (host.length) out.reasons.push(`${host.length} model switch${host.length > 1 ? 'es' : ''} made by the host, not asked for (${[...new Set(host.map((s) => s.host_reason))].join(', ')}): ${list(host)}`)
    if (bare.length) out.reasons.push(`${bare.length} silent model switch${bare.length > 1 ? 'es' : ''} (nothing announced the change): ${list(bare)}`)
  }
  // RT1 F11 (2026-10-04): name a fake or future snapshot, and a change of snapshot under one undated declaration
  for (const p of (out.snapshot_problems ?? []).slice(0, 3)) out.reasons.push(`reply ${p.reply}: ${p.problem}`)
  const isSnap = (x: string, id: string): boolean => id !== x && id.startsWith(`${x}-`) && SNAPSHOT_SHAPE.test(id.slice(x.length + 1))
  const snapChanges = out.switches.filter((s) => (expected ?? []).some((x) => isSnap(x, s.from) && isSnap(x, s.to)))
  if (snapChanges.length) {
    out.reasons.push(`${snapChanges.length} change${snapChanges.length > 1 ? 's' : ''} of dated snapshot under one declared id (${snapChanges.slice(0, 3).map((s) => `${s.from} → ${s.to}${s.announced ? ' (announced)' : ''}`).join('; ')}): the declared name stayed the same, the model behind it did not`)
  }
  if (out.violation_count && out.host_switches.length && !out.switches.some((s) => s.cause === 'host_fallback')) {
    // the host changed models before any reply on the old one, so there is no between-replies switch to explain it
    out.reasons.push(`the host itself switched models: ${out.host_switches.map((h) => `${h.from ?? '?'} → ${h.to ?? '?'} (${h.reason})`).join('; ')}`)
  }
  if (fromHost && out.outcome !== 'INSUFFICIENT_DATA') out.reasons.push(`(expected model taken from the host's own session start: ${sessionModel})`)
  if (out.outcome === 'PASS') {
    const names = Object.keys(out.models)
    out.reasons.push(names.length === 1
      ? `all ${out.replies} replies came from ${names[0]}${expected ? '' : ' (no declared model — consistency only)'}`
      : `${out.replies} replies across ${names.join(', ')}; every change was announced${expected ? ' and every model was expected' : ''}`)
  }
  if (out.skipped) out.reasons.push(`${out.skipped} event(s) carried no model (missing or placeholder) and were not attested`)
  return out
}

export interface ModelGateResult { action: 'PROCEED' | 'HOLD'; model: string | null; reason: string }

/** Runtime check on one reply: PROCEED only if it came from the pinned model. A floating pin or a missing model is a HOLD. */
export function modelGate(pinned: string, reply: { model?: string | null; at?: string }): ModelGateResult {
  const m = typeof reply.model === 'string' && reply.model.trim() && !PLACEHOLDER.test(reply.model.trim()) ? reply.model.trim() : null
  if (isFloatingAlias(pinned)) return { action: 'HOLD', model: m, reason: `pinned model "${pinned}" is a floating alias — pin an exact id` }
  if (!m) return { action: 'HOLD', model: null, reason: 'the reply does not say which model produced it' }
  if (!modelMatches(pinned, m, reply.at)) {
    const problem = snapshotProblem(pinned, m, reply.at)
    return { action: 'HOLD', model: m, reason: problem ? `reply came from ${m}: ${problem}` : `reply came from ${m}, not the pinned ${pinned}` }
  }
  // the resolved snapshot is the evidence of which model answered under an undated pin
  return { action: 'PROCEED', model: m, reason: m === pinned ? `reply came from ${m}` : `reply came from ${m} (the dated snapshot of the pinned ${pinned})` }
}

/** Plain API replies (Anthropic Messages, OpenAI Chat/Responses — anything with a `model` field), in order. */
export function eventsFromReplies(replies: { model?: string | null; created_at?: string; id?: string }[]): ModelEvent[] {
  return replies.map((r) => ({ type: 'reply', model: r.model, ...(r.created_at ? { at: r.created_at } : {}), ...(r.id ? { id: r.id } : {}) }))
}

/** The user's `/model` command, as the host records it: the entry's text STARTS with the command tag. */
const MODEL_COMMAND = /^\s*<command-name>\/?model<\/command-name>/

/**
 * A Claude Code session transcript (JSONL). Assistant entries carry the resolved model in `message.model`; one reply can span
 * several entries (one per content block) sharing `message.id`, so replies are de-duplicated by id.
 *
 * A `/model` command becomes a `switch_requested` event. The host records it in one of two shapes (both seen in real
 * transcripts): a user entry whose content is a STRING beginning with the command tag, or a `system` entry of subtype
 * `local_command` whose top-level `content` begins with it. Nothing else counts. In particular, tool results and text blocks
 * that merely contain the tag do not count, because an agent controls what its tools print and must not be able to announce
 * its own switch. Only the model, id, timestamp and the command entry are read, never message content.
 */
export function eventsFromClaudeCodeTranscript(jsonl: string): ModelEvent[] {
  const out: ModelEvent[] = []
  const seen = new Set<string>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let j: Record<string, unknown>
    try { j = JSON.parse(line) } catch { continue }
    // 2026-10-19: a line that is JSON but not an object (a bare `null` threw a TypeError here) is not an entry: skipped, as a
    // line that is not JSON is
    if (j === null || typeof j !== 'object' || Array.isArray(j)) continue
    const msg = (j.message ?? {}) as Record<string, unknown>
    const at = typeof j.timestamp === 'string' ? { at: j.timestamp } : {}
    if (j.type === 'system' && j.subtype === 'init' && typeof j.model === 'string') { out.push({ type: 'session_model', model: j.model, ...at }); continue }
    if (j.type === 'system' && j.subtype === 'model_refusal_fallback') {
      const cat = typeof j.api_refusal_category === 'string' ? ` (${j.api_refusal_category})` : ''
      out.push({ type: 'host_switch', reason: `safety-refusal fallback${cat}`, ...(typeof j.original_model === 'string' ? { from: j.original_model } : {}), ...(typeof j.fallback_model === 'string' ? { to: j.fallback_model } : {}), ...at })
      continue
    }
    const command = j.type === 'user' ? msg.content : j.type === 'system' && j.subtype === 'local_command' ? j.content : undefined
    if (command !== undefined) {
      if (typeof command === 'string' && MODEL_COMMAND.test(command)) out.push({ type: 'switch_requested', ...(typeof j.timestamp === 'string' ? { at: j.timestamp } : {}) })
      continue
    }
    if (j.type !== 'assistant') continue
    const id = typeof msg.id === 'string' ? msg.id : undefined
    if (id) { if (seen.has(id)) continue; seen.add(id) }
    out.push({ type: 'reply', model: typeof msg.model === 'string' ? msg.model : null, ...(typeof j.timestamp === 'string' ? { at: j.timestamp } : {}), ...(id ? { id } : {}) })
  }
  return out
}
