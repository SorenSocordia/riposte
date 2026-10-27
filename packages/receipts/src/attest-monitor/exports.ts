/**
 * Provider usage exports, parsed strictly for the model-switch monitor (T2 evidence).
 *
 * Every field list below was taken from the provider's PUBLIC schema, saved raw before this code was written:
 *   Anthropic  Usage & Cost Admin API, GET /v1/organizations/usage_report/messages (docs.claude.com: "similar to the information
 *              available in the Usage and Cost pages of the Claude Console"). Time buckets of 1m, 1h or 1d; no request ids.
 *   OpenAI     openai-openapi spec: GET /v1/organization/usage/completions (UsageResponse → UsageTimeBucket →
 *              UsageCompletionsResult; buckets, no request ids), GET /v1/chat/completions (ChatCompletionList; stored completions
 *              only, per request, with ids), and Response objects (GET /v1/responses/{id}; per request, with ids).
 *   OpenRouter openapi.json: GET /api/v1/generation (GenerationResponse.data; per request, with ids) and GET /api/v1/activity
 *              (ActivityItem; per UTC day, model and endpoint).
 * The dashboards' CSV downloads (Claude Console, OpenAI usage page, OpenRouter Activity page) have no published column list,
 * so they are read only through a column map the caller writes. No column name is guessed.
 *
 * Strict: a field the schema does not name is reported as unknown, and the monitor refuses the export until each one is
 * acknowledged. A field this reader needs that is missing refuses the export. Only ids, times, model names, token and request
 * counts are read; message content in a per-request export is never read.
 */
import { readPopulationCSV } from 'riposte-verify'

export const EXPORT_SOURCES = [
  'anthropic-usage-report', 'openai-usage', 'openai-chat-completions', 'openai-responses', 'openrouter-generations', 'openrouter-activity',
  'anthropic-console-csv', 'openai-dashboard-csv', 'openrouter-activity-csv',
] as const
export type ExportSource = (typeof EXPORT_SOURCES)[number]
export const CSV_SOURCES: readonly ExportSource[] = ['anthropic-console-csv', 'openai-dashboard-csv', 'openrouter-activity-csv']

export type Granularity = 'request' | 'minute' | 'hour' | 'day'

export const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const
export type Provider = (typeof PROVIDERS)[number]
/** The provider whose traffic an export speaks for. An export says nothing about replies another provider served. */
export const providerOf = (s: ExportSource): Provider => (s.startsWith('anthropic') ? 'anthropic' : s.startsWith('openrouter') ? 'openrouter' : 'openai')

export interface UsageRow {
  source: ExportSource
  /** 1-based record number in the export (bucket results are numbered in file order) */
  record: number
  granularity: Granularity
  /** ids this row can be joined on (request id, generation id, upstream id) */
  ids: string[]
  /** request time (per-request rows) */
  at?: string
  /** bucket bounds (bucket rows): start inclusive, end exclusive */
  start?: string
  end?: string
  /** the model the provider billed; null when the export was not grouped by model */
  model: string | null
  /** another name the provider gives the same row's model (OpenRouter's permaslug) */
  model_alt?: string
  input?: number
  output?: number
  /** a second token reading of the same request (OpenRouter's native counts) */
  alt_tokens?: { input: number; output: number }
  requests?: number
}

export interface SchemaInfo { doc: string; verified: string; assumed: string[] }

export interface ParsedExport {
  source: ExportSource
  /** a label for the provider account the export came from (from the manifest); runs with another account label are not compared */
  account?: string
  rows: UsageRow[]
  /** fields the public schema does not name, as "<where>.<field>" */
  unknown_fields: string[]
  /** unknown fields the caller acknowledged (still listed in the report) */
  acknowledged: string[]
  /** why this export cannot be used as given; empty when usable */
  refused: string[]
  notes: string[]
  schema: SchemaInfo
  /** the period the export covers, for bucket exports (first bucket start, last bucket end) */
  covers?: { start: string; end: string }
}

/** For the dashboards' CSV downloads: which column holds what. Every other column must be acknowledged. */
export interface CsvColumnMap {
  granularity: Granularity
  time: string
  model: string
  input_tokens?: string
  output_tokens?: string
  requests?: string
  request_id?: string
}

export interface ParseOptions { columns?: CsvColumnMap; acknowledge?: readonly string[] }

const ANTHROPIC_DOC = 'https://docs.claude.com/en/api/admin-api/usage-cost/get-messages-usage-report'
const OPENAI_DOC = 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml'
const OPENROUTER_DOC = 'https://openrouter.ai/openapi.json'

const F = {
  anthropicPage: ['data', 'has_more', 'next_page'],
  anthropicBucket: ['starting_at', 'ending_at', 'results'],
  anthropicResult: ['account_id', 'api_key_id', 'cache_creation', 'cache_read_input_tokens', 'context_window', 'inference_geo', 'model', 'output_tokens', 'server_tool_use', 'service_account_id', 'service_tier', 'uncached_input_tokens', 'workspace_id'],
  anthropicCacheCreation: ['ephemeral_1h_input_tokens', 'ephemeral_5m_input_tokens'],
  openaiPage: ['object', 'data', 'has_more', 'next_page'],
  openaiBucket: ['object', 'start_time', 'end_time', 'results'],
  openaiResult: ['api_source', 'object', 'input_tokens', 'input_cached_tokens', 'input_cache_write_tokens', 'input_cache_write_12h_tokens', 'input_uncached_tokens', 'output_tokens', 'input_text_tokens', 'output_text_tokens', 'input_cached_text_tokens', 'input_audio_tokens', 'input_cached_audio_tokens', 'output_audio_tokens', 'input_image_tokens', 'input_cached_image_tokens', 'output_image_tokens', 'num_model_requests', 'project_id', 'user_id', 'api_key_id', 'model', 'batch', 'service_tier'],
  openaiChatList: ['object', 'data', 'first_id', 'last_id', 'has_more'],
  openaiChat: ['id', 'choices', 'created', 'model', 'metadata', 'service_tier', 'system_fingerprint', 'object', 'usage', 'moderation'],
  openaiChatUsage: ['completion_tokens', 'prompt_tokens', 'total_tokens', 'completion_tokens_details', 'prompt_tokens_details'],
  openaiResponse: ['metadata', 'top_logprobs', 'temperature', 'top_p', 'user', 'safety_identifier', 'prompt_cache_key', 'prompt_cache_retention', 'previous_response_id', 'model', 'background', 'max_tool_calls', 'text', 'tools', 'tool_choice', 'prompt', 'service_tier', 'truncation', 'id', 'object', 'status', 'access_programs', 'created_at', 'completed_at', 'error', 'incomplete_details', 'output', 'reasoning', 'instructions', 'output_text', 'usage', 'prompt_cache_options', 'prompt_cache_diagnostics', 'moderation', 'parallel_tool_calls', 'conversation', 'max_output_tokens'],
  openaiResponseUsage: ['input_tokens', 'input_tokens_details', 'output_tokens', 'output_tokens_details', 'total_tokens'],
  openrouterGeneration: ['api_type', 'app_id', 'cache_discount', 'cancelled', 'created_at', 'data_region', 'external_user', 'finish_reason', 'generation_time', 'http_referer', 'id', 'is_byok', 'latency', 'model', 'moderation_latency', 'native_finish_reason', 'native_tokens_cached', 'native_tokens_completion', 'native_tokens_completion_images', 'native_tokens_prompt', 'native_tokens_reasoning', 'num_fetches', 'num_input_audio_prompt', 'num_media_completion', 'num_media_prompt', 'num_search_results', 'origin', 'preset_id', 'provider_name', 'provider_responses', 'request_id', 'response_cache_source_id', 'router', 'service_tier', 'session_id', 'streamed', 'tokens_completion', 'tokens_prompt', 'total_cost', 'upstream_id', 'upstream_inference_cost', 'usage', 'user_agent', 'web_search_engine', 'workspace_id'],
  openrouterActivity: ['byok_usage_inference', 'cached_tokens', 'completion_tokens', 'date', 'endpoint_id', 'model', 'model_permaslug', 'prompt_tokens', 'provider_name', 'reasoning_tokens', 'requests', 'usage', 'workspace_id'],
} as const

export const EXPORT_SCHEMAS: Record<ExportSource, SchemaInfo & { granularity: string; reads: string }> = {
  'anthropic-usage-report': { doc: ANTHROPIC_DOC, verified: 'every field name (page, bucket, result, cache_creation)', assumed: ['input tokens are uncached + cache read + both cache-creation counts, compared with the transcript\'s input + cache counts'], granularity: 'bucket (1m, 1h or 1d)', reads: 'starting_at, ending_at, model, uncached_input_tokens, cache_read_input_tokens, cache_creation, output_tokens' },
  'openai-usage': { doc: OPENAI_DOC, verified: 'every field name (UsageResponse, UsageTimeBucket, UsageCompletionsResult)', assumed: ['the bucket width is read from the bucket bounds'], granularity: 'bucket (1m, 1h or 1d)', reads: 'start_time, end_time, model, input_tokens, output_tokens, num_model_requests' },
  'openai-chat-completions': { doc: OPENAI_DOC, verified: 'every field name (ChatCompletionList, the chat completion object, CompletionUsage)', assumed: [], granularity: 'request (stored completions only)', reads: 'id, created, model, usage.prompt_tokens, usage.completion_tokens' },
  'openai-responses': { doc: OPENAI_DOC, verified: 'every top-level field name of the Response object, and ResponseUsage', assumed: ['the file is a JSON array or JSONL of Response objects as retrieved one by one (there is no list endpoint)'], granularity: 'request', reads: 'id, created_at, model, usage.input_tokens, usage.output_tokens' },
  'openrouter-generations': { doc: OPENROUTER_DOC, verified: 'every field name of GenerationResponse.data', assumed: ['the file is a JSON array or JSONL of GET /generation answers (or their data objects)', 'a reply matches on either the normalized or the native token counts'], granularity: 'request', reads: 'id, request_id, upstream_id, created_at, model, tokens_prompt, tokens_completion, native_tokens_prompt, native_tokens_completion' },
  'openrouter-activity': { doc: OPENROUTER_DOC, verified: 'every field name of ActivityItem', assumed: ['a reply\'s model may equal either the slug or the permaslug'], granularity: 'bucket (1 UTC day)', reads: 'date, model, model_permaslug, prompt_tokens, completion_tokens, requests' },
  'anthropic-console-csv': { doc: 'no published column list', verified: 'nothing: read through your column map', assumed: ['every column, by your map'], granularity: 'as your map says', reads: 'the columns your map names' },
  'openai-dashboard-csv': { doc: 'no published column list', verified: 'nothing: read through your column map', assumed: ['every column, by your map'], granularity: 'as your map says', reads: 'the columns your map names' },
  'openrouter-activity-csv': { doc: 'https://openrouter.ai/docs/cookbook/administration/activity-export (says the export exists; lists no columns)', verified: 'nothing: read through your column map', assumed: ['every column, by your map'], granularity: 'as your map says', reads: 'the columns your map names' },
}

const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)
const int = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && /^\d+$/.test(x.trim()) ? Number(x.trim()) : undefined)
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
const iso = (x: unknown): string | undefined => {
  if (typeof x === 'number' && Number.isFinite(x)) return new Date(x * 1000).toISOString()
  const s = str(x)
  if (!s) return undefined
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
const widthOf = (start: string, end: string): Granularity => {
  const ms = Date.parse(end) - Date.parse(start)
  return ms <= 60_000 ? 'minute' : ms <= 3_600_000 ? 'hour' : 'day'
}
const GRAN_MS: Record<Exclude<Granularity, 'request'>, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }

class Collector {
  unknown = new Set<string>()
  refused: string[] = []
  check(o: Record<string, unknown>, known: readonly string[], where: string): void { for (const k of Object.keys(o)) if (!known.includes(k)) this.unknown.add(`${where}.${k}`) }
  need(o: Record<string, unknown>, keys: readonly string[], where: string, record: number): boolean {
    const miss = keys.filter((k) => !(k in o))
    if (miss.length) { if (this.refused.length < 20) this.refused.push(`${where} ${record}: missing ${miss.join(', ')}`); return false }
    return true
  }
}

/** A JSON value, or JSONL lines, as a list of top-level values. */
function values(text: string): unknown[] {
  const t = text.replace(/^﻿/, '').trim()
  if (!t) return []
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : [v] } catch { /* JSONL */ }
  return t.split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) } catch { throw new Error(`line ${i + 1} is not JSON`) } })
}

export function parseExport(source: ExportSource, text: string, opts: ParseOptions = {}): ParsedExport {
  const schema = EXPORT_SCHEMAS[source]
  if (!schema) throw new Error(`unknown export source ${String(source)}: one of ${EXPORT_SOURCES.join(', ')}`)
  const c = new Collector()
  const rows: UsageRow[] = []
  const notes: string[] = []
  let covers: ParsedExport['covers']
  const cover = (start: string, end: string) => { covers = { start: covers && covers.start < start ? covers.start : start, end: covers && covers.end > end ? covers.end : end } }
  let vals: unknown[] = []
  if (!CSV_SOURCES.includes(source)) {
    try { vals = values(text) } catch (e) { c.refused.push(`not JSON or JSONL: ${(e as Error).message}`) }
  }

  if (source === 'anthropic-usage-report') {
    let rec = 0
    for (const page of vals) {
      if (!isObj(page) || !Array.isArray(page.data)) { c.refused.push('expected a usage report page { data: [...] } (or an array of pages)'); break }
      c.check(page, F.anthropicPage, 'page')
      for (const b of page.data) {
        if (!isObj(b)) { c.refused.push('a bucket is not an object'); continue }
        c.check(b, F.anthropicBucket, 'bucket')
        const start = iso(b.starting_at), end = iso(b.ending_at)
        if (!start || !end || !Array.isArray(b.results)) { c.refused.push(`bucket ${b.starting_at ?? '?'}: needs starting_at, ending_at and results`); continue }
        cover(start, end)
        for (const r of b.results) {
          rec++
          if (!isObj(r)) { c.refused.push(`result ${rec} is not an object`); continue }
          c.check(r, F.anthropicResult, 'result')
          if (!c.need(r, ['model', 'uncached_input_tokens', 'cache_read_input_tokens', 'output_tokens'], 'result', rec)) continue
          const cc = isObj(r.cache_creation) ? r.cache_creation : {}
          c.check(cc, F.anthropicCacheCreation, 'result.cache_creation')
          rows.push({ source, record: rec, granularity: widthOf(start, end), ids: [], start, end, model: str(r.model) ?? null,
            input: (int(r.uncached_input_tokens) ?? 0) + (int(r.cache_read_input_tokens) ?? 0) + (int(cc.ephemeral_5m_input_tokens) ?? 0) + (int(cc.ephemeral_1h_input_tokens) ?? 0),
            output: int(r.output_tokens) ?? 0 })
        }
      }
    }
    if (rows.length && rows.every((r) => r.model === null)) notes.push('no row names a model: export with group_by[]=model, or this export cannot corroborate which model answered')
  } else if (source === 'openai-usage') {
    let rec = 0
    for (const page of vals) {
      if (!isObj(page) || !Array.isArray(page.data)) { c.refused.push('expected a usage page { object: "page", data: [...] } (or an array of pages)'); break }
      c.check(page, F.openaiPage, 'page')
      for (const b of page.data) {
        if (!isObj(b)) { c.refused.push('a bucket is not an object'); continue }
        c.check(b, F.openaiBucket, 'bucket')
        const start = iso(b.start_time), end = iso(b.end_time)
        if (!start || !end || !Array.isArray(b.results)) { c.refused.push(`bucket ${b.start_time ?? '?'}: needs start_time, end_time and results`); continue }
        cover(start, end)
        for (const r of b.results) {
          rec++
          if (!isObj(r)) { c.refused.push(`result ${rec} is not an object`); continue }
          if (r.object !== 'organization.usage.completions.result') { c.refused.push(`result ${rec} is ${JSON.stringify(r.object)}, not a completions usage result (export /v1/organization/usage/completions)`); continue }
          c.check(r, F.openaiResult, 'result')
          if (!c.need(r, ['input_tokens', 'output_tokens', 'num_model_requests'], 'result', rec)) continue
          rows.push({ source, record: rec, granularity: widthOf(start, end), ids: [], start, end, model: str(r.model) ?? null, input: int(r.input_tokens) ?? 0, output: int(r.output_tokens) ?? 0, requests: int(r.num_model_requests) ?? 0 })
        }
      }
    }
    if (rows.length && rows.every((r) => r.model === null)) notes.push('no row names a model: export with group_by=model, or this export cannot corroborate which model answered')
  } else if (source === 'openai-chat-completions') {
    let rec = 0
    for (const page of vals) {
      if (!isObj(page) || page.object !== 'list' || !Array.isArray(page.data)) { c.refused.push('expected a chat completion list { object: "list", data: [...] } (or an array of them)'); break }
      c.check(page, F.openaiChatList, 'list')
      for (const x of page.data) {
        rec++
        if (!isObj(x)) { c.refused.push(`completion ${rec} is not an object`); continue }
        c.check(x, F.openaiChat, 'completion')
        if (!c.need(x, ['id', 'created', 'model'], 'completion', rec)) continue
        const u = isObj(x.usage) ? x.usage : undefined
        if (u) c.check(u, F.openaiChatUsage, 'completion.usage')
        rows.push({ source, record: rec, granularity: 'request', ids: [String(x.id)], ...(iso(x.created) ? { at: iso(x.created) } : {}), model: str(x.model) ?? null, ...(u ? { input: int(u.prompt_tokens), output: int(u.completion_tokens) } : {}) })
      }
    }
  } else if (source === 'openai-responses') {
    let rec = 0
    for (const x of vals) {
      rec++
      if (!isObj(x) || x.object !== 'response') { c.refused.push(`record ${rec} is not a Response object (object: "response")`); continue }
      c.check(x, F.openaiResponse, 'response')
      if (!c.need(x, ['id', 'created_at', 'model'], 'response', rec)) continue
      const u = isObj(x.usage) ? x.usage : undefined
      if (u) c.check(u, F.openaiResponseUsage, 'response.usage')
      rows.push({ source, record: rec, granularity: 'request', ids: [String(x.id)], ...(iso(x.created_at) ? { at: iso(x.created_at) } : {}), model: str(x.model) ?? null, ...(u ? { input: int(u.input_tokens), output: int(u.output_tokens) } : {}) })
    }
  } else if (source === 'openrouter-generations') {
    let rec = 0
    for (const v of vals) {
      rec++
      const x = isObj(v) && isObj(v.data) && Object.keys(v).length === 1 ? v.data : v
      if (!isObj(x)) { c.refused.push(`record ${rec} is not a generation object`); continue }
      c.check(x, F.openrouterGeneration, 'generation')
      if (!c.need(x, ['id', 'created_at', 'model'], 'generation', rec)) continue
      const ids = [x.id, x.request_id, x.upstream_id].map(str).filter((s): s is string => Boolean(s))
      const nIn = int(x.native_tokens_prompt), nOut = int(x.native_tokens_completion)
      rows.push({ source, record: rec, granularity: 'request', ids, ...(iso(x.created_at) ? { at: iso(x.created_at) } : {}), model: str(x.model) ?? null,
        ...(int(x.tokens_prompt) !== undefined ? { input: int(x.tokens_prompt), output: int(x.tokens_completion) } : {}),
        ...(nIn !== undefined && nOut !== undefined ? { alt_tokens: { input: nIn, output: nOut } } : {}) })
    }
  } else if (source === 'openrouter-activity') {
    let rec = 0
    for (const page of vals) {
      if (!isObj(page) || !Array.isArray(page.data)) { c.refused.push('expected an activity answer { data: [...] }'); break }
      for (const k of Object.keys(page)) if (k !== 'data') c.unknown.add(`answer.${k}`)
      for (const x of page.data) {
        rec++
        if (!isObj(x)) { c.refused.push(`item ${rec} is not an object`); continue }
        c.check(x, F.openrouterActivity, 'item')
        if (!c.need(x, ['date', 'model', 'prompt_tokens', 'completion_tokens', 'requests'], 'item', rec)) continue
        const start = iso(x.date)
        if (!start) { c.refused.push(`item ${rec}: date ${JSON.stringify(x.date)} is not YYYY-MM-DD`); continue }
        const end = new Date(Date.parse(start) + GRAN_MS.day).toISOString()
        cover(start, end)
        rows.push({ source, record: rec, granularity: 'day', ids: [], start, end, model: str(x.model) ?? null, ...(str(x.model_permaslug) ? { model_alt: str(x.model_permaslug) } : {}), input: int(x.prompt_tokens) ?? 0, output: int(x.completion_tokens) ?? 0, requests: int(x.requests) ?? 0 })
      }
    }
    notes.push('activity rows are per UTC day: they corroborate that a model was billed that day, not which reply it served')
  } else {
    const map = opts.columns
    if (!map) c.refused.push(`${source}: the provider publishes no column list for this download, so it is read only through a column map (columns: { granularity, time, model, input_tokens, output_tokens, requests?, request_id? }). Nothing is guessed.`)
    else {
      let pop: ReturnType<typeof readPopulationCSV> | undefined
      try { pop = readPopulationCSV(text.replace(/^﻿/, '')) } catch (e) { c.refused.push(`not a readable CSV: ${(e as Error).message}`) }
      if (pop) {
        const cols = pop.columns ?? []
        const mapped = [map.time, map.model, map.input_tokens, map.output_tokens, map.requests, map.request_id].filter((x): x is string => Boolean(x))
        for (const m of mapped) if (!cols.includes(m)) c.refused.push(`the column map names "${m}", which is not in the file's header`)
        for (const col of cols) if (!mapped.includes(col)) c.unknown.add(`column.${col}`)
        if (!(['request', 'minute', 'hour', 'day'] as const).includes(map.granularity)) c.refused.push(`columns.granularity must be request, minute, hour or day (got ${JSON.stringify(map.granularity)})`)
        if (!c.refused.length) {
          for (const r of pop.rows) {
            const v = r.values
            const t = iso(v[map.time])
            if (!t) { if (c.refused.length < 20) c.refused.push(`row ${r.row}: ${map.time} ${JSON.stringify(v[map.time])} is not a date or time`); continue }
            const base = { source, record: r.row, granularity: map.granularity, model: str(v[map.model]) ?? null,
              ...(map.input_tokens ? { input: int(v[map.input_tokens]) } : {}), ...(map.output_tokens ? { output: int(v[map.output_tokens]) } : {}), ...(map.requests ? { requests: int(v[map.requests]) } : {}) }
            const id = map.request_id ? str(v[map.request_id]) : undefined
            if (map.granularity === 'request') rows.push({ ...base, ids: id ? [id] : [], at: t })
            else {
              const ms = GRAN_MS[map.granularity]
              const start = new Date(Math.floor(Date.parse(t) / ms) * ms).toISOString()
              const end = new Date(Date.parse(start) + ms).toISOString()
              cover(start, end)
              rows.push({ ...base, ids: [], start, end })
            }
          }
        }
      }
    }
  }

  const unknown = [...c.unknown].sort()
  const ack = new Set(opts.acknowledge ?? [])
  const blocking = unknown.filter((u) => !ack.has(u))
  const refused = [...c.refused]
  if (blocking.length) refused.push(`unknown field${blocking.length > 1 ? 's' : ''} (not in the provider's published schema; check each, then acknowledge it): ${blocking.join(', ')}`)
  return { source, rows, unknown_fields: unknown, acknowledged: unknown.filter((u) => ack.has(u)), refused, notes, schema: { doc: schema.doc, verified: schema.verified, assumed: schema.assumed }, ...(covers ? { covers } : {}) }
}
