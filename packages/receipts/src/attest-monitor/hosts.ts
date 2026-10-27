/**
 * Host records, read for the model-switch monitor: one reply per provider response, with what the host recorded about it.
 *
 *   claude-code  A Claude Code session transcript (JSONL). The host's record format is not publicly documented. The fields read
 *                were observed in real transcripts: `message.model`, `message.id`, the top-level `requestId` and `timestamp`,
 *                `message.usage` (input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens). The model
 *                is the provider's per-message field: T1. Commands and fallbacks are read exactly as `eventsFromClaudeCodeTranscript`
 *                reads them, so the monitor and `riposte-attest` agree on every switch.
 *   codex        A Codex CLI rollout file (JSONL; the format comes from Codex's source and "may change"). Codex records the model
 *                it ASKED for on each turn (`turn_context.payload.model`), not the model the provider says answered, so a Codex
 *                reply rests on T0 unless a usage export or an anchor corroborates it. One reply per `token_usage_record`
 *                (its `response_id` and `usage`); rollouts without them count assistant messages instead. A
 *                `thread_settings_applied` event that changes the model announces the next switch (ASSUMED: Codex emits it when
 *                the user changes the model; its source says successful settings updates emit it).
 *   api-log      Your own log of provider responses (JSONL): each line is a response object as the provider returned it
 *                (Anthropic Messages `type: "message"`, OpenAI `chat.completion` or `response`, OpenRouter's OpenAI-shaped
 *                completion), or an envelope { at, request_id?, response }. The model is the provider's field: T1.
 *
 * Only ids, timestamps, model fields, token counts and command tags are read, never message content.
 */
import type { ModelEvent } from '../model-attest.js'

export const HOST_FORMATS = ['claude-code', 'codex', 'api-log'] as const
export type HostFormat = (typeof HOST_FORMATS)[number]

export interface HostReply {
  /** order among all reply events of the record (0-based) */
  index: number
  id?: string
  request_id?: string
  at?: string
  /** the model the provider reported (provider_field) or the host asked for (host_requested); null when none was recorded */
  model: string | null
  basis: 'provider_field' | 'host_requested'
  tokens?: { input: number; output: number }
  /** 1-based line in the record file */
  line: number
}

export interface HostRecord {
  format: HostFormat
  replies: HostReply[]
  /** the events attestModels reads, in order; reply events are the replies above, in the same order */
  events: ModelEvent[]
  notes: string[]
  /** lines that did not parse or had an unknown shape (api-log only refuses them; the others skip host bookkeeping lines) */
  rejected: { line: number; reason: string }[]
}

const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)
const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const s = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined)
const MODEL_COMMAND = /^\s*<command-name>\/?model<\/command-name>/

export function readHostRecord(format: HostFormat, text: string): HostRecord {
  if (format === 'claude-code') return readClaudeCode(text)
  if (format === 'codex') return readCodex(text)
  if (format === 'api-log') return readApiLog(text)
  throw new Error(`unknown host format ${String(format)}: one of ${HOST_FORMATS.join(', ')}`)
}

function lines(text: string): { line: number; j: Record<string, any> | null }[] {
  return text.split('\n').map((l, i) => ({ line: i + 1, raw: l.replace(/\r$/, '') })).filter((x) => x.raw.trim())
    .map(({ line, raw }) => { try { const j = JSON.parse(raw); return { line, j: isObj(j) ? j : null } } catch { return { line, j: null } } })
}

function readClaudeCode(text: string): HostRecord {
  const out: HostRecord = { format: 'claude-code', replies: [], events: [], notes: [], rejected: [] }
  const byId = new Map<string, HostReply>()
  for (const { line, j } of lines(text)) {
    if (!j) { out.rejected.push({ line, reason: 'not a JSON object' }); continue }
    const msg = isObj(j.message) ? j.message : {}
    const at = s(j.timestamp)
    if (j.type === 'system' && j.subtype === 'init' && typeof j.model === 'string') { out.events.push({ type: 'session_model', model: j.model, ...(at ? { at } : {}) }); continue }
    if (j.type === 'system' && j.subtype === 'model_refusal_fallback') {
      const cat = typeof j.api_refusal_category === 'string' ? ` (${j.api_refusal_category})` : ''
      out.events.push({ type: 'host_switch', reason: `safety-refusal fallback${cat}`, ...(s(j.original_model) ? { from: j.original_model } : {}), ...(s(j.fallback_model) ? { to: j.fallback_model } : {}), ...(at ? { at } : {}) })
      continue
    }
    const command = j.type === 'user' ? msg.content : j.type === 'system' && j.subtype === 'local_command' ? j.content : undefined
    if (command !== undefined) {
      if (typeof command === 'string' && MODEL_COMMAND.test(command)) out.events.push({ type: 'switch_requested', ...(at ? { at } : {}) })
      continue
    }
    if (j.type !== 'assistant') continue
    const id = s(msg.id)
    const u = isObj(msg.usage) ? msg.usage : undefined
    // ASSUMED: one reply spans several entries sharing message.id; the LAST entry's usage is the final count.
    const tokens = u ? { input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), output: n(u.output_tokens) } : undefined
    if (id && byId.has(id)) { if (tokens) byId.get(id)!.tokens = tokens; continue }
    const r: HostReply = {
      index: out.replies.length, line, basis: 'provider_field', model: typeof msg.model === 'string' ? msg.model : null,
      ...(id ? { id } : {}), ...(s(j.requestId) ? { request_id: j.requestId } : {}), ...(at ? { at } : {}), ...(tokens ? { tokens } : {}),
    }
    if (id) byId.set(id, r)
    out.replies.push(r)
    out.events.push({ type: 'reply', model: r.model, ...(at ? { at } : {}), ...(id ? { id } : {}) })
  }
  return out
}

function readCodex(text: string): HostRecord {
  const out: HostRecord = { format: 'codex', replies: [], events: [], notes: ['Codex records the model it asked for on each turn, not the model the provider reports: its replies rest on T0 unless corroborated.'], rejected: [] }
  const ls = lines(text)
  const hasUsage = ls.some(({ j }) => j?.type === 'token_usage_record')
  if (!hasUsage) out.notes.push('no token_usage_record lines: one reply per assistant message (no response ids or token counts to match on).')
  let current: string | null = null
  let settingsModel: string | null = null
  let sawSession = false
  for (const { line, j } of ls) {
    if (!j) { out.rejected.push({ line, reason: 'not a JSON object' }); continue }
    const p = isObj(j.payload) ? j.payload : {}
    const at = s(j.timestamp)
    if (j.type === 'turn_context' && typeof p.model === 'string') {
      if (!sawSession) { out.events.push({ type: 'session_model', model: p.model, ...(at ? { at } : {}) }); sawSession = true }
      current = p.model
      continue
    }
    if (j.type === 'event_msg' && p.type === 'thread_settings_applied' && isObj(p.thread_settings) && typeof p.thread_settings.model === 'string') {
      const m = p.thread_settings.model as string
      if (settingsModel !== null && m !== settingsModel) out.events.push({ type: 'switch_requested', ...(at ? { at } : {}) })
      settingsModel = m
      continue
    }
    const isReply = hasUsage ? j.type === 'token_usage_record' : j.type === 'response_item' && p.type === 'message' && p.role === 'assistant'
    if (!isReply) continue
    const u = isObj(p.usage) ? p.usage : undefined
    const id = s(p.response_id)
    // ASSUMED: Codex's input_tokens already counts cached input (it mirrors the OpenAI usage object it came from).
    const tokens = u ? { input: n(u.input_tokens), output: n(u.output_tokens) } : undefined
    const r: HostReply = { index: out.replies.length, line, basis: 'host_requested', model: current, ...(id ? { id } : {}), ...(at ? { at } : {}), ...(tokens ? { tokens } : {}) }
    out.replies.push(r)
    out.events.push({ type: 'reply', model: r.model, ...(at ? { at } : {}), ...(id ? { id } : {}) })
  }
  return out
}

/** One provider response object → id, time, model, tokens; or why it is not one. */
export function readResponseObject(x: Record<string, any>): { id?: string; at?: string; model: string | null; tokens?: { input: number; output: number } } | string {
  const u = isObj(x.usage) ? x.usage : undefined
  if (x.type === 'message' && x.role === 'assistant') { // Anthropic Messages
    return { ...(s(x.id) ? { id: x.id } : {}), model: s(x.model) ?? null, ...(u ? { tokens: { input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), output: n(u.output_tokens) } } : {}) }
  }
  if (x.object === 'chat.completion') { // OpenAI Chat Completions; OpenRouter answers in this shape too
    return { ...(s(x.id) ? { id: x.id } : {}), ...(typeof x.created === 'number' ? { at: new Date(x.created * 1000).toISOString() } : {}), model: s(x.model) ?? null, ...(u ? { tokens: { input: n(u.prompt_tokens), output: n(u.completion_tokens) } } : {}) }
  }
  if (x.object === 'response') { // OpenAI Responses
    return { ...(s(x.id) ? { id: x.id } : {}), ...(typeof x.created_at === 'number' ? { at: new Date(x.created_at * 1000).toISOString() } : {}), model: s(x.model) ?? null, ...(u ? { tokens: { input: n(u.input_tokens), output: n(u.output_tokens) } } : {}) }
  }
  return 'not a provider response object this log reader knows (Anthropic message, OpenAI chat.completion or response)'
}

function readApiLog(text: string): HostRecord {
  const out: HostRecord = { format: 'api-log', replies: [], events: [], notes: [], rejected: [] }
  for (const { line, j } of lines(text)) {
    if (!j) { out.rejected.push({ line, reason: 'not a JSON object' }); continue }
    const envelope = isObj(j.response)
    const r = readResponseObject(envelope ? j.response : j)
    if (typeof r === 'string') { out.rejected.push({ line, reason: r }); continue }
    const at = envelope && s(j.at) ? j.at as string : r.at
    const reqId = envelope ? s(j.request_id) : undefined
    const rep: HostReply = { index: out.replies.length, line, basis: 'provider_field', model: r.model, ...(r.id ? { id: r.id } : {}), ...(reqId ? { request_id: reqId } : {}), ...(at ? { at } : {}), ...(r.tokens ? { tokens: r.tokens } : {}) }
    out.replies.push(rep)
    out.events.push({ type: 'reply', model: rep.model, ...(at ? { at } : {}), ...(rep.id ? { id: rep.id } : {}) })
  }
  return out
}
