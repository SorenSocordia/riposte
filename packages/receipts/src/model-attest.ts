/**
 * Model attestation — which model ACTUALLY answered, reply by reply, and a receipt whenever it changed.
 *
 * The failure it exists for: a run declares one model; a floating alias ("opus", "…-latest") or a host fallback quietly
 * resolves to another; every output downstream is attributed to the model that was declared, not the one that answered.
 * Hosts already record the RESOLVED model on every reply — Anthropic `message.model`, OpenAI `model`, Claude Code transcripts
 * `message.model` — and nobody checks it. This checks it.
 *
 *   attestModels(events, policy)  → PASS | FAIL | ABSTAIN over a run, with every switch listed (announced or silent)
 *   modelGate(pinned, reply)      → PROCEED | HOLD for one reply, at runtime ("don't count an answer from the wrong model")
 *
 *   PASS    — every attested reply came from an expected model, and no switch happened silently
 *   FAIL    — a reply came from a model that was not declared, or the model changed with nothing announcing it
 *   ABSTAIN — nothing to attest against: no reply recorded a model, or the declared model is itself a floating alias
 *
 * A switch is ANNOUNCED when a host-level switch request (e.g. the user's `/model` command) precedes it; otherwise SILENT.
 * Deterministic; no I/O (the transcript text is passed in).
 */

/** One event in a run: a model reply, or a host-level request to switch models (which makes the next change "announced"). */
export type ModelEvent =
  | { type: 'reply'; model: string | null | undefined; at?: string; id?: string }
  | { type: 'switch_requested'; at?: string }

export interface AttestPolicy {
  /** the exact model id this run was declared to use */
  declared?: string
  /** or: any of these exact ids is acceptable (takes precedence over `declared`) */
  allowed?: string[]
  /** FAIL on a model change that nothing announced (default true) */
  failOnSilentSwitch?: boolean
}

export interface SwitchEvent { from: string; to: string; at?: string; reply: number; announced: boolean }

export interface ModelAttestation {
  outcome: 'PASS' | 'FAIL' | 'ABSTAIN'
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
  expected: string[] | null
  reasons: string[]
}

const ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable', 'default', 'auto', 'best', 'latest'])
const PLACEHOLDER = /^<.*>$/

/** A bare tier name or a "-latest" pointer: it floats to whatever the provider serves today, so nothing can be attested against it. */
export function isFloatingAlias(id: string): boolean {
  const s = id.trim().toLowerCase()
  return ALIASES.has(s) || s.endsWith('-latest')
}

/** Exact id, or the same id with a dated snapshot suffix ("claude-sonnet-4-5" ↔ "claude-sonnet-4-5-20250929"). */
export function modelMatches(expected: string, resolved: string): boolean {
  if (expected === resolved) return true
  return resolved.startsWith(`${expected}-`) && /^\d{8}$/.test(resolved.slice(expected.length + 1))
}

const MAX_VIOLATIONS = 20

export function attestModels(events: ModelEvent[], policy: AttestPolicy = {}): ModelAttestation {
  const expected = policy.allowed?.length ? policy.allowed : policy.declared ? [policy.declared] : null
  const out: ModelAttestation = {
    outcome: 'PASS', models: {}, first: null, last: null, replies: 0, switches: [], violations: [], violation_count: 0,
    skipped: 0, expected, reasons: [],
  }
  const floating = (expected ?? []).filter(isFloatingAlias)
  let pendingRequest = false
  for (const e of events) {
    if (e.type === 'switch_requested') { pendingRequest = true; continue }
    const m = typeof e.model === 'string' ? e.model.trim() : ''
    if (!m || PLACEHOLDER.test(m)) { out.skipped++; continue }
    const n = out.replies++
    out.models[m] = (out.models[m] ?? 0) + 1
    if (out.first === null) out.first = m
    if (out.last !== null && m !== out.last) {
      out.switches.push({ from: out.last, to: m, ...(e.at ? { at: e.at } : {}), reply: n, announced: pendingRequest })
      pendingRequest = false
    }
    out.last = m
    if (expected && !floating.length && !expected.some((x) => modelMatches(x, m))) {
      out.violation_count++
      if (out.violations.length < MAX_VIOLATIONS) out.violations.push({ reply: n, model: m, ...(e.at ? { at: e.at } : {}) })
    }
  }

  if (floating.length) {
    out.outcome = 'ABSTAIN'
    out.reasons.push(`declared model ${floating.map((f) => `"${f}"`).join(', ')} is a floating alias — it resolves to whatever is served today, so nothing can be attested against it. Pin an exact model id.`)
    if (out.first) out.reasons.push(`(for the record: replies came from ${Object.keys(out.models).join(', ')})`)
    return out
  }
  if (!out.replies) {
    out.outcome = 'ABSTAIN'
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
    out.reasons.push(`${silent.length} silent model switch${silent.length > 1 ? 'es' : ''} (nothing announced the change): ${silent.slice(0, 3).map((s) => `${s.from} → ${s.to}${s.at ? ` at ${s.at}` : ''}`).join('; ')}${silent.length > 3 ? '; …' : ''}`)
  }
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
export function modelGate(pinned: string, reply: { model?: string | null }): ModelGateResult {
  const m = typeof reply.model === 'string' && reply.model.trim() && !PLACEHOLDER.test(reply.model.trim()) ? reply.model.trim() : null
  if (isFloatingAlias(pinned)) return { action: 'HOLD', model: m, reason: `pinned model "${pinned}" is a floating alias — pin an exact id` }
  if (!m) return { action: 'HOLD', model: null, reason: 'the reply does not say which model produced it' }
  if (!modelMatches(pinned, m)) return { action: 'HOLD', model: m, reason: `reply came from ${m}, not the pinned ${pinned}` }
  return { action: 'PROCEED', model: m, reason: `reply came from ${m}` }
}

/** Plain API replies (Anthropic Messages, OpenAI Chat/Responses — anything with a `model` field), in order. */
export function eventsFromReplies(replies: { model?: string | null; created_at?: string; id?: string }[]): ModelEvent[] {
  return replies.map((r) => ({ type: 'reply', model: r.model, ...(r.created_at ? { at: r.created_at } : {}), ...(r.id ? { id: r.id } : {}) }))
}

const MODEL_COMMAND = /<command-name>\/?model<\/command-name>/

/**
 * A Claude Code session transcript (JSONL). Assistant entries carry the resolved model in `message.model`; one reply can span
 * several entries (one per content block) sharing `message.id`, so replies are de-duplicated by id. A user `/model` command
 * becomes a `switch_requested` event. Only the model, id, timestamp and command tag are read — never message content.
 */
export function eventsFromClaudeCodeTranscript(jsonl: string): ModelEvent[] {
  const out: ModelEvent[] = []
  const seen = new Set<string>()
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let j: Record<string, unknown>
    try { j = JSON.parse(line) } catch { continue }
    const msg = (j.message ?? {}) as Record<string, unknown>
    if (j.type === 'user') {
      const c = msg.content
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).join('') : ''
      if (MODEL_COMMAND.test(text)) out.push({ type: 'switch_requested', ...(typeof j.timestamp === 'string' ? { at: j.timestamp } : {}) })
      continue
    }
    if (j.type !== 'assistant') continue
    const id = typeof msg.id === 'string' ? msg.id : undefined
    if (id) { if (seen.has(id)) continue; seen.add(id) }
    out.push({ type: 'reply', model: typeof msg.model === 'string' ? msg.model : null, ...(typeof j.timestamp === 'string' ? { at: j.timestamp } : {}), ...(id ? { id } : {}) })
  }
  return out
}
