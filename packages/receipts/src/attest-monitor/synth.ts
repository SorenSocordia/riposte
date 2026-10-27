/**
 * A synthetic month for the model-switch monitor's pre-registered test: host records in all three formats, provider exports in
 * the six publicly documented shapes, and a signed anchor ledger, with planted switches, alias floats, announced switches and
 * record disagreements. Deterministic from the seed (the anchor key too). Every model id is invented ("model-alpha-20250301",
 * "vendor-a/model-delta"): nothing here says anything about any real provider or model.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { openLedger, memoryStore } from '../ledger.js'
import { readHostRecord } from './hosts.js'
import { anchorReplies } from './anchor.js'
import type { MonitorSwitchCause } from './monitor.js'
import type { AttestManifest } from './manifest.js'
import type { Provider } from './exports.js'

export const SYNTH_VERSION = 'riposte.attest-synth/0.1.0'

export const PLANTS = ['clean', 'announced', 'host_fallback', 'unrecorded', 'alias_float_latest', 'alias_float_snapshot', 'codex_announced', 'codex_unrecorded', 'billing_request', 'billing_bucket', 'announced_undeclared', 'anchor_edited'] as const
export type Plant = (typeof PLANTS)[number]

export interface RunTruth {
  run: string
  plant: Plant
  /**
   * `outcome` keeps the word the pre-registered seeds were frozen with (fixtures/attest-monitor PREREG.lock.json): ABSTAIN for
   * can't tell, so the generator still reproduces the recorded truth files byte for byte. It is a planted label, not an answer;
   * the scorer reads it as INSUFFICIENT_DATA (readCheckOutcome), the monitor's own word since 2026-10-06.
   */
  expected: { switches: { cause: MonitorSwitchCause; announced: boolean }[]; violations: number; contradictions: number; bucket_shortfalls: number; outcome: 'PASS' | 'FAIL' | 'ABSTAIN' }
}
export interface SynthTruth { synth_version: string; seed: number; month: string; runs: RunTruth[] }
export interface SynthMonth { files: Record<string, string>; manifest: AttestManifest; truth: SynthTruth }

const A1 = 'model-alpha-20250301', A1B = 'model-alpha-20250815', B1 = 'model-beta-20250301'
const G = 'model-gamma-2025-04-14', G2 = 'model-gamma-2025-08-06', GM = 'model-gamma-mini-2025-04-14'
const D = 'vendor-a/model-delta', E = 'vendor-b/model-epsilon'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** An Ed25519 key derived from a seed (PKCS#8 prefix + 32 bytes), so a synthetic anchor ledger is reproducible. */
export function synthKey(seed: number): { privatePem: string; publicPem: string } {
  const raw = createHash('sha256').update(`attest-synth-key:${seed}`).digest()
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privatePem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}

interface Reply { at: string; model: string; billed: string; input: number; cacheW: number; cacheR: number; output: number; id: string; req: string; keepId: boolean }

interface RunSpec {
  name: string; plant: Plant; format: 'claude-code' | 'codex' | 'api-log'; provider: Provider; declared: string; allowed?: string[]
  /** models per reply before and after the switch point (null: no switch) */
  before: string; after?: string; switchAt?: number
  /** inserted before the switch reply */
  marker?: 'model_command' | 'fallback' | 'settings'
  anchored?: boolean
}

const SPECS: RunSpec[] = [
  { name: 'run-c01', plant: 'clean', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1 },
  { name: 'run-c02', plant: 'clean', format: 'claude-code', provider: 'anthropic', declared: 'model-alpha', before: A1 },
  { name: 'run-c03', plant: 'clean', format: 'api-log', provider: 'openai', declared: G, before: G },
  { name: 'run-c04', plant: 'clean', format: 'api-log', provider: 'openai', declared: G, before: G },
  { name: 'run-c05', plant: 'clean', format: 'api-log', provider: 'openrouter', declared: D, before: D },
  { name: 'run-c06', plant: 'clean', format: 'api-log', provider: 'openrouter', declared: D, before: D },
  { name: 'run-c07', plant: 'clean', format: 'codex', provider: 'openai', declared: 'model-gamma', before: 'model-gamma' },
  { name: 'run-c08', plant: 'clean', format: 'codex', provider: 'openai', declared: 'model-gamma', before: 'model-gamma' },
  { name: 'run-c09', plant: 'clean', format: 'api-log', provider: 'anthropic', declared: B1, before: B1, anchored: true },
  { name: 'run-c10', plant: 'clean', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1, anchored: true },
  { name: 'run-p01', plant: 'announced', format: 'claude-code', provider: 'anthropic', declared: A1, allowed: [A1, B1], before: A1, after: B1, marker: 'model_command' },
  { name: 'run-p02', plant: 'host_fallback', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1, after: B1, marker: 'fallback' },
  { name: 'run-p03', plant: 'unrecorded', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1, after: B1 },
  { name: 'run-p04', plant: 'unrecorded', format: 'api-log', provider: 'openai', declared: G, before: G, after: GM },
  { name: 'run-p05', plant: 'alias_float_latest', format: 'claude-code', provider: 'anthropic', declared: 'model-alpha-latest', before: A1, after: A1B },
  { name: 'run-p06', plant: 'alias_float_snapshot', format: 'api-log', provider: 'openai', declared: 'model-gamma', before: G, after: G2 },
  { name: 'run-p07', plant: 'codex_announced', format: 'codex', provider: 'openai', declared: 'model-gamma', allowed: ['model-gamma', 'model-gamma-mini'], before: 'model-gamma', after: 'model-gamma-mini', marker: 'settings' },
  { name: 'run-p08', plant: 'codex_unrecorded', format: 'codex', provider: 'openai', declared: 'model-gamma', before: 'model-gamma', after: 'model-gamma-mini' },
  { name: 'run-p09', plant: 'billing_request', format: 'api-log', provider: 'openrouter', declared: D, before: D },
  { name: 'run-p10', plant: 'billing_bucket', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1 },
  { name: 'run-p11', plant: 'announced_undeclared', format: 'claude-code', provider: 'anthropic', declared: A1, before: A1, after: B1, marker: 'model_command' },
  { name: 'run-p12', plant: 'anchor_edited', format: 'api-log', provider: 'anthropic', declared: B1, before: B1, anchored: true },
]

/** The model a provider bills for a requested or reported model. */
const billedFor = (m: string): string => (m === 'model-gamma' ? G : m === 'model-gamma-mini' ? GM : m)

export function synthAttestMonth(o: { seed: number; month?: string }): SynthMonth {
  const month = o.month ?? '2026-09'
  const r = rng(o.seed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')
  const files: Record<string, string> = {}
  const truth: RunTruth[] = []
  const all: { spec: RunSpec; replies: Reply[] }[] = []
  const key = synthKey(o.seed)
  let anchorNow = new Date(`${month}-01T00:00:00Z`)
  const anchorLedger = openLedger(memoryStore(), { signingKey: key.privatePem, now: () => anchorNow })

  SPECS.forEach((spec, i) => {
    const n = int(12, 24)
    const switchAt = spec.after ? int(4, n - 4) : undefined
    const day = String(i + 1).padStart(2, '0')
    const t0 = Date.parse(`${month}-${day}T${String(int(8, 14)).padStart(2, '0')}:00:00Z`)
    const replies: Reply[] = []
    for (let k = 0; k < n; k++) {
      const model = switchAt !== undefined && k >= switchAt ? spec.after! : spec.before
      const input = int(400, 18000), output = int(40, 1800)
      const cacheW = spec.provider === 'anthropic' ? int(0, 2000) : 0, cacheR = spec.provider === 'anthropic' ? int(0, 6000) : 0
      const idp = spec.provider === 'anthropic' ? 'msg_' : spec.provider === 'openrouter' ? 'gen-' : spec.format === 'codex' ? 'resp_' : 'chatcmpl-'
      replies.push({ at: new Date(t0 + k * 60_000 + int(0, 50) * 1000).toISOString(), model, billed: billedFor(model), input, cacheW, cacheR, output, id: `${idp}${hex(20)}`, req: `req_${hex(20)}`, keepId: !(spec.name === 'run-c06' && r() < 0.3) })
    }
    // plants on billing and anchors
    let edited: number | undefined
    if (spec.plant === 'billing_request') replies[int(2, n - 3)]!.billed = E
    if (spec.plant === 'billing_bucket') replies[int(2, n - 3)]!.billed = B1
    if (spec.plant === 'anchor_edited') { edited = int(2, n - 3); replies[edited]!.model = A1; replies[edited]!.billed = A1 }
    const text = (rs: Reply[]) => hostText(spec, rs, switchAt)
    if (spec.anchored) {
      const rec = readHostRecord(spec.format, text(replies))
      for (const rep of rec.replies) {
        anchorNow = new Date(Date.parse(rep.at!) + 2000)
        anchorReplies(anchorLedger, { ...rec, replies: [rep] }, spec.name)
      }
    }
    if (edited !== undefined) replies[edited]!.model = B1 // the host log is edited after anchoring; billing and anchor still say A1
    files[`runs/${spec.name}.jsonl`] = text(replies)
    all.push({ spec, replies })

    const after = switchAt === undefined ? 0 : n - switchAt
    const expectedViolations = (spec.plant === 'host_fallback' || spec.plant === 'unrecorded' || spec.plant === 'codex_unrecorded' || spec.plant === 'announced_undeclared') ? after : 0
    const sw: RunTruth['expected']['switches'] = !spec.after ? [] : [{
      cause: spec.marker === 'model_command' || spec.marker === 'settings' ? 'user_command' : spec.marker === 'fallback' ? 'host_fallback' : spec.plant.startsWith('alias_float') ? 'alias_float' : 'unrecorded',
      announced: spec.marker === 'model_command' || spec.marker === 'settings',
    }]
    const contradictions = spec.plant === 'billing_request' || spec.plant === 'billing_bucket' || spec.plant === 'anchor_edited' ? 1 : 0
    const shortfalls = spec.plant === 'billing_request' ? 1 : 0
    const flags = sw.filter((s) => !s.announced).length + expectedViolations + contradictions + shortfalls
    truth.push({ run: spec.name, plant: spec.plant, expected: { switches: sw, violations: expectedViolations, contradictions, bucket_shortfalls: shortfalls, outcome: spec.plant === 'alias_float_latest' ? 'ABSTAIN' : flags ? 'FAIL' : 'PASS' } })
  })

  // provider exports
  const by = (p: Provider, fmt?: RunSpec['format']) => all.filter((x) => x.spec.provider === p && (!fmt || x.spec.format === fmt)).flatMap((x) => x.replies.map((rep) => ({ spec: x.spec, rep })))
  const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000)
  // Anthropic usage report: 1m buckets grouped by model, one page per active day, empty minutes included
  {
    const reps = by('anthropic')
    const days = [...new Set(reps.map((x) => x.rep.at.slice(0, 10)))].sort()
    const pages = days.map((d) => {
      const today = reps.filter((x) => x.rep.at.startsWith(d))
      const first = Math.min(...today.map((x) => Math.floor(Date.parse(x.rep.at) / 60_000))), last = Math.max(...today.map((x) => Math.floor(Date.parse(x.rep.at) / 60_000)))
      const data = []
      for (let m = first; m <= last; m++) {
        const inMin = today.filter((x) => Math.floor(Date.parse(x.rep.at) / 60_000) === m)
        const models = [...new Set(inMin.map((x) => x.rep.billed))].sort()
        data.push({ starting_at: new Date(m * 60_000).toISOString().replace('.000Z', 'Z'), ending_at: new Date((m + 1) * 60_000).toISOString().replace('.000Z', 'Z'), results: models.map((model) => {
          const xs = inMin.filter((x) => x.rep.billed === model)
          const extra = r() < 0.25 ? int(100, 3000) : 0 // other traffic sharing the bucket
          return { api_key_id: null, account_id: null, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: xs.reduce((a, x) => a + x.rep.cacheW, 0) }, cache_read_input_tokens: xs.reduce((a, x) => a + x.rep.cacheR, 0), context_window: null, inference_geo: null, model, output_tokens: xs.reduce((a, x) => a + x.rep.output, 0) + extra, server_tool_use: { web_search_requests: 0 }, service_account_id: null, service_tier: null, uncached_input_tokens: xs.reduce((a, x) => a + x.rep.input, 0) + extra, workspace_id: null }
        }) })
      }
      return { data, has_more: false, next_page: null }
    })
    files['exports/anthropic-usage-report.json'] = `${JSON.stringify(pages)}\n`
  }
  // OpenAI usage: 1h buckets grouped by model (api-log and Codex replies)
  {
    const reps = by('openai')
    const hours = [...new Set(reps.map((x) => Math.floor(Date.parse(x.rep.at) / 3_600_000)))].sort((a, b) => a - b)
    const data = hours.map((h) => {
      const inH = reps.filter((x) => Math.floor(Date.parse(x.rep.at) / 3_600_000) === h)
      const models = [...new Set(inH.map((x) => x.rep.billed))].sort()
      return { object: 'bucket', start_time: h * 3600, end_time: (h + 1) * 3600, results: models.map((model) => {
        const xs = inH.filter((x) => x.rep.billed === model)
        return { object: 'organization.usage.completions.result', input_tokens: xs.reduce((a, x) => a + x.rep.input, 0), output_tokens: xs.reduce((a, x) => a + x.rep.output, 0), input_cached_tokens: 0, num_model_requests: xs.length, project_id: null, user_id: null, api_key_id: null, model, batch: null, service_tier: null }
      }) }
    })
    files['exports/openai-usage.json'] = `${JSON.stringify({ object: 'page', data, has_more: false, next_page: null })}\n`
  }
  // OpenAI stored chat completions (api-log runs; about one in ten not stored) and Response objects (Codex runs)
  {
    const chat = by('openai', 'api-log').filter(() => r() >= 0.1).map(({ rep }) => ({ id: rep.id, object: 'chat.completion', created: sec(rep.at), model: rep.billed, choices: [], usage: { prompt_tokens: rep.input, completion_tokens: rep.output, total_tokens: rep.input + rep.output }, service_tier: 'default' }))
    files['exports/openai-chat-completions.json'] = `${JSON.stringify({ object: 'list', data: chat, first_id: chat[0]?.id ?? null, last_id: chat[chat.length - 1]?.id ?? null, has_more: false })}\n`
    const resp = by('openai', 'codex').map(({ rep }) => ({ id: rep.id, object: 'response', created_at: sec(rep.at), status: 'completed', model: rep.billed, output: [], usage: { input_tokens: rep.input, input_tokens_details: { cached_tokens: 0 }, output_tokens: rep.output, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: rep.input + rep.output }, error: null, incomplete_details: null, instructions: null, tools: [], parallel_tool_calls: true, metadata: {}, tool_choice: 'auto', temperature: 1, top_p: 1 }))
    files['exports/openai-responses.jsonl'] = resp.map((x) => JSON.stringify(x)).join('\n') + '\n'
  }
  // OpenRouter generations (per request) and activity (per day and model)
  {
    const reps = by('openrouter')
    files['exports/openrouter-generations.jsonl'] = reps.map(({ rep }) => JSON.stringify({ data: { id: rep.id, created_at: rep.at.replace('Z', '+00:00'), model: rep.billed, provider_name: rep.billed === D ? 'VendorA' : 'VendorB', tokens_prompt: rep.input, tokens_completion: rep.output, native_tokens_prompt: rep.input, native_tokens_completion: rep.output, total_cost: 0, streamed: false, cancelled: false } })).join('\n') + '\n'
    const keys = [...new Set(reps.map((x) => `${x.rep.at.slice(0, 10)}|${x.rep.billed}`))].sort()
    files['exports/openrouter-activity.json'] = `${JSON.stringify({ data: keys.map((k) => {
      const [date, model] = k.split('|') as [string, string]
      const xs = reps.filter((x) => x.rep.at.startsWith(date) && x.rep.billed === model)
      return { date, model, model_permaslug: `${model}-20250301`, endpoint_id: `ep-${model.length}`, provider_name: model === D ? 'VendorA' : 'VendorB', usage: 0, byok_usage_inference: 0, requests: xs.length, prompt_tokens: xs.reduce((a, x) => a + x.rep.input, 0), completion_tokens: xs.reduce((a, x) => a + x.rep.output, 0), reasoning_tokens: 0, cached_tokens: 0 }
    }) })}\n`
  }
  files['anchors/anchors.jsonl'] = anchorLedger.entries().map((e) => JSON.stringify(e)).join('\n') + '\n'
  files['anchors/anchor.pub.pem'] = key.publicPem

  const manifest: AttestManifest = {
    month, deployer: 'Synthetic Co. (generated, not a customer)',
    runs: SPECS.map((s) => ({ name: s.name, path: `runs/${s.name}.jsonl`, format: s.format, provider: s.provider, declared: s.declared, ...(s.allowed ? { allowed: s.allowed } : {}) })),
    exports: [
      { source: 'anthropic-usage-report', path: 'exports/anthropic-usage-report.json' },
      { source: 'openai-usage', path: 'exports/openai-usage.json' },
      { source: 'openai-chat-completions', path: 'exports/openai-chat-completions.json' },
      { source: 'openai-responses', path: 'exports/openai-responses.jsonl' },
      { source: 'openrouter-generations', path: 'exports/openrouter-generations.jsonl' },
      { source: 'openrouter-activity', path: 'exports/openrouter-activity.json' },
    ],
    anchors: [{ ledger: 'anchors/anchors.jsonl', public_key: 'anchors/anchor.pub.pem' }],
  }
  return { files, manifest, truth: { synth_version: SYNTH_VERSION, seed: o.seed, month, runs: truth } }
}

function hostText(spec: RunSpec, rs: Reply[], switchAt: number | undefined): string {
  const L: string[] = []
  const at = (k: number, ds = -5) => new Date(Date.parse(rs[k]!.at) + ds * 1000).toISOString()
  if (spec.format === 'claude-code') {
    rs.forEach((rep, k) => {
      if (k === switchAt && spec.marker === 'model_command') L.push(JSON.stringify({ type: 'user', timestamp: at(k), message: { role: 'user', content: `<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>${spec.after}</command-args>` } }))
      if (k === switchAt && spec.marker === 'fallback') L.push(JSON.stringify({ type: 'system', subtype: 'model_refusal_fallback', timestamp: at(k), original_model: spec.before, fallback_model: spec.after }))
      L.push(JSON.stringify({ type: 'user', timestamp: at(k, -20), message: { role: 'user', content: 'synthetic prompt' } }))
      const usage = (out: number) => ({ input_tokens: rep.input, cache_creation_input_tokens: rep.cacheW, cache_read_input_tokens: rep.cacheR, output_tokens: out })
      const entry = (out: number) => JSON.stringify({ type: 'assistant', timestamp: rep.at, requestId: rep.req, message: { id: rep.id, type: 'message', role: 'assistant', model: rep.model, content: [{ type: 'text', text: 'synthetic reply' }], usage: usage(out) } })
      if (k % 2 === 0) L.push(entry(1)) // a reply spanning two entries; the last one carries the final usage
      L.push(entry(rep.output))
    })
  } else if (spec.format === 'codex') {
    L.push(JSON.stringify({ timestamp: at(0, -60), type: 'session_meta', payload: { id: `thread-${spec.name}`, model_provider: 'openai' } }))
    L.push(JSON.stringify({ timestamp: at(0, -59), type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: spec.before, model_provider_id: 'openai' } } }))
    rs.forEach((rep, k) => {
      if (k === switchAt && spec.marker === 'settings') L.push(JSON.stringify({ timestamp: at(k, -30), type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: spec.after, model_provider_id: 'openai' } } }))
      L.push(JSON.stringify({ timestamp: at(k, -10), type: 'turn_context', payload: { turn_id: `turn-${k}`, cwd: '/work', approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' }, model: rep.model } }))
      L.push(JSON.stringify({ timestamp: rep.at, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'synthetic reply' }] } }))
      L.push(JSON.stringify({ timestamp: rep.at, type: 'token_usage_record', payload: { thread_id: `thread-${spec.name}`, turn_id: `turn-${k}`, session_id: `s-${spec.name}`, root_turn_id: `turn-${k}`, response_id: rep.id, usage: { input_tokens: rep.input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: rep.output, reasoning_output_tokens: 0, total_tokens: rep.input + rep.output } } }))
    })
  } else {
    rs.forEach((rep) => {
      if (spec.provider === 'anthropic') L.push(JSON.stringify({ at: rep.at, request_id: rep.req, response: { id: rep.id, type: 'message', role: 'assistant', model: rep.model, content: [], stop_reason: 'end_turn', usage: { input_tokens: rep.input, cache_creation_input_tokens: rep.cacheW, cache_read_input_tokens: rep.cacheR, output_tokens: rep.output } } }))
      else {
        const body = { ...(rep.keepId ? { id: rep.id } : {}), object: 'chat.completion', created: Math.floor(Date.parse(rep.at) / 1000), model: rep.model, choices: [], usage: { prompt_tokens: rep.input, completion_tokens: rep.output, total_tokens: rep.input + rep.output } }
        L.push(JSON.stringify(spec.provider === 'openrouter' ? { at: rep.at, response: body } : body))
      }
    })
  }
  return L.join('\n') + '\n'
}
