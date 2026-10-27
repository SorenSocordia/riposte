import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import {
  parseExport, matchReplies, runMonitor, renderAttestReport, attestReportJson, signAttestReport, readHostRecord, anchorReplies, readAnchors,
  monitorCli, synthAttestMonth, isAliasFloat, modelMatches, eventsFromClaudeCodeTranscript, attestModels, openLedger, memoryStore, verifyChain, TIERS, tierTable,
  type ParsedExport, type ReplyRef, type MonitorRun, type HostRecord,
} from '../src/index.js'
import { nodeMonitorIo } from '../src/attest-monitor/node-io.js'
import { scoreAgainstTruth } from '../src/attest-monitor/score.js'
import { loadManifest } from '../src/attest-monitor/manifest.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const keys = () => {
  const k = generateKeyPairSync('ed25519')
  return { priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}
const J = (x: unknown) => JSON.stringify(x)

// ── provider exports, strict ────────────────────────────────────────────────────────────────────────────────────────────
const anthResult = (model: string | null, unc: number, out: number, extra: Record<string, unknown> = {}) => ({ model, uncached_input_tokens: unc, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: out, ...extra })
const anthPage = (results: unknown[], start = '2026-09-03T10:00:00Z', end = '2026-09-03T10:01:00Z') => J({ data: [{ starting_at: start, ending_at: end, results }], has_more: false, next_page: null })

describe('provider exports are parsed strictly (fields from the saved public schemas)', () => {
  it('Anthropic usage report: buckets, model, input = uncached + cache read + cache creation', () => {
    const p = parseExport('anthropic-usage-report', J({ data: [{ starting_at: '2026-09-03T10:00:00Z', ending_at: '2026-09-03T10:01:00Z', results: [{ ...anthResult('m-a', 100, 7), cache_read_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 2 } }] }], has_more: false, next_page: null }))
    expect(p.refused).toEqual([])
    expect(p.rows).toEqual([expect.objectContaining({ granularity: 'minute', model: 'm-a', input: 125, output: 7, start: '2026-09-03T10:00:00.000Z' })])
  })
  it('a field the schema does not name is reported and refuses the export until acknowledged', () => {
    const text = anthPage([anthResult('m-a', 1, 1, { speed: 'fast' })])
    const p = parseExport('anthropic-usage-report', text)
    expect(p.unknown_fields).toEqual(['result.speed'])
    expect(p.refused.join(' ')).toMatch(/unknown field .*result\.speed/)
    const ok = parseExport('anthropic-usage-report', text, { acknowledge: ['result.speed'] })
    expect(ok.refused).toEqual([])
    expect(ok.acknowledged).toEqual(['result.speed'])
  })
  it('a field the reader needs that is missing refuses; an export not grouped by model says so', () => {
    const { output_tokens: _drop, ...noOut } = anthResult('m-a', 1, 1)
    expect(parseExport('anthropic-usage-report', anthPage([noOut])).refused.join(' ')).toMatch(/missing output_tokens/)
    expect(parseExport('anthropic-usage-report', anthPage([anthResult(null, 1, 1)])).notes.join(' ')).toMatch(/group_by\[\]=model/)
  })
  it('OpenAI usage: completions results only; other usage kinds refuse', () => {
    const page = (results: unknown[]) => J({ object: 'page', data: [{ object: 'bucket', start_time: 1788429600, end_time: 1788433200, results }], has_more: false, next_page: null })
    const p = parseExport('openai-usage', page([{ object: 'organization.usage.completions.result', input_tokens: 10, output_tokens: 2, num_model_requests: 1, model: 'm-g-2025-04-14' }]))
    expect(p.rows[0]).toMatchObject({ granularity: 'hour', model: 'm-g-2025-04-14', input: 10, output: 2, requests: 1 })
    expect(parseExport('openai-usage', page([{ object: 'organization.usage.embeddings.result', input_tokens: 1, num_model_requests: 1 }])).refused.join(' ')).toMatch(/not a completions usage result/)
  })
  it('OpenAI stored chat completions and Response objects: per request, with ids; content is never read', () => {
    const chat = parseExport('openai-chat-completions', J({ object: 'list', data: [{ id: 'c1', object: 'chat.completion', created: 1788429600, model: 'm-g', choices: [{ message: { content: 'secret' } }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 }, mystery: 1 }], first_id: 'c1', last_id: 'c1', has_more: false }))
    expect(chat.rows[0]).toMatchObject({ granularity: 'request', ids: ['c1'], model: 'm-g', input: 5, output: 6 })
    expect(chat.unknown_fields).toEqual(['completion.mystery'])
    expect(J(chat.rows)).not.toMatch(/secret/)
    const resp = parseExport('openai-responses', [J({ id: 'r1', object: 'response', created_at: 1788429600, model: 'm-g', usage: { input_tokens: 1, output_tokens: 2, input_tokens_details: {}, output_tokens_details: {}, total_tokens: 3 } }), J({ id: 'r2', object: 'response', created_at: 1788429601 })].join('\n'))
    expect(resp.rows.map((r) => r.ids[0])).toEqual(['r1'])
    expect(resp.refused.join(' ')).toMatch(/response 2: missing model/)
  })
  it('OpenRouter generations (wrapped or bare) join on id, request id or upstream id; activity is per day with the permaslug', () => {
    const g = parseExport('openrouter-generations', [J({ data: { id: 'gen-1', request_id: 'req-1', upstream_id: 'up-1', created_at: '2026-09-03T10:00:00+00:00', model: 'v/m', tokens_prompt: 4, tokens_completion: 5, native_tokens_prompt: 6, native_tokens_completion: 7 } }), J({ id: 'gen-2', created_at: '2026-09-03T10:01:00+00:00', model: 'v/m' })].join('\n'))
    expect(g.refused).toEqual([])
    expect(g.rows[0]).toMatchObject({ ids: ['gen-1', 'req-1', 'up-1'], input: 4, output: 5, alt_tokens: { input: 6, output: 7 } })
    const a = parseExport('openrouter-activity', J({ data: [{ date: '2026-09-03', model: 'v/m', model_permaslug: 'v/m-20250301', endpoint_id: 'e', provider_name: 'P', usage: 0, byok_usage_inference: 0, requests: 2, prompt_tokens: 9, completion_tokens: 8, reasoning_tokens: 0, cached_tokens: 0 }] }))
    expect(a.rows[0]).toMatchObject({ granularity: 'day', model: 'v/m', model_alt: 'v/m-20250301', start: '2026-09-03T00:00:00.000Z', end: '2026-09-04T00:00:00.000Z' })
  })
  it('a dashboard CSV has no published columns: refused without a column map, every unmapped column reported', () => {
    const csv = 'Date,Model,Input,Output,Team\n2026-09-03,m-a,10,2,w1\n'
    expect(parseExport('anthropic-console-csv', csv).refused.join(' ')).toMatch(/column map/)
    const map = { granularity: 'day' as const, time: 'Date', model: 'Model', input_tokens: 'Input', output_tokens: 'Output' }
    const p = parseExport('anthropic-console-csv', csv, { columns: map })
    expect(p.unknown_fields).toEqual(['column.Team'])
    const ok = parseExport('anthropic-console-csv', csv, { columns: map, acknowledge: ['column.Team'] })
    expect(ok.rows[0]).toMatchObject({ granularity: 'day', model: 'm-a', input: 10, output: 2 })
    expect(parseExport('openrouter-activity-csv', csv, { columns: { ...map, model: 'Modell' } }).refused.join(' ')).toMatch(/names "Modell", which is not in the file's header/)
  })
})

// ── matching confidence ─────────────────────────────────────────────────────────────────────────────────────────────────
const reqExport = (rows: { id: string; at: string; model: string; i: number; o: number }[]): ParsedExport =>
  parseExport('openrouter-generations', rows.map((r) => J({ id: r.id, created_at: r.at, model: r.model, tokens_prompt: r.i, tokens_completion: r.o })).join('\n'))
const rep = (key: string, x: Partial<ReplyRef>): ReplyRef => ({ key, model: 'v/m', provider: 'openrouter', ...x })

describe('joining replies to export rows, with an explicit confidence', () => {
  it('by request id (1.0), else time window + equal tokens (0.9 unique, 0.6 several of one model, none for mixed models)', () => {
    const ex = reqExport([
      { id: 'gen-1', at: '2026-09-03T10:00:00Z', model: 'v/m', i: 10, o: 1 },
      { id: 'gen-2', at: '2026-09-03T10:02:00Z', model: 'v/m', i: 20, o: 2 },
      { id: 'gen-3', at: '2026-09-03T10:03:00Z', model: 'v/m', i: 30, o: 3 }, { id: 'gen-4', at: '2026-09-03T10:03:30Z', model: 'v/m', i: 30, o: 3 },
      { id: 'gen-5', at: '2026-09-03T10:05:00Z', model: 'v/m', i: 50, o: 5 }, { id: 'gen-6', at: '2026-09-03T10:05:10Z', model: 'w/x', i: 50, o: 5 },
    ])
    const m = matchReplies([
      rep('a', { id: 'gen-1', at: '2026-09-03T10:00:00Z', tokens: { input: 999, output: 9 } }),
      rep('b', { at: '2026-09-03T10:02:30Z', tokens: { input: 20, output: 2 } }),
      rep('c', { at: '2026-09-03T10:03:10Z', tokens: { input: 30, output: 3 } }),
      rep('d', { at: '2026-09-03T10:05:05Z', tokens: { input: 50, output: 5 } }),
      rep('e', { at: '2026-09-03T11:30:00Z', tokens: { input: 20, output: 2 } }), // outside the window: never joined on time alone
    ], [ex]).byReply
    expect(m.get('a')![0]).toMatchObject({ method: 'request_id', confidence: 1, verdict: 'agree' })
    expect(m.get('b')![0]).toMatchObject({ method: 'time_tokens', confidence: 0.9, verdict: 'agree', records: [2] })
    expect(m.get('c')![0]).toMatchObject({ method: 'time_tokens_ambiguous', confidence: 0.6, verdict: 'agree' })
    expect(m.get('d')![0]).toMatchObject({ method: 'ambiguous', confidence: 0, verdict: 'none' })
    expect(m.get('e')).toBeUndefined()
  })
  it('a request-id join that bills another model disagrees', () => {
    const m = matchReplies([rep('a', { id: 'gen-1' })], [reqExport([{ id: 'gen-1', at: '2026-09-03T10:00:00Z', model: 'w/other', i: 1, o: 1 }])]).byReply
    expect(m.get('a')![0]).toMatchObject({ verdict: 'disagree', billed: ['w/other'] })
  })
  it('buckets: exact 0.8 / contained 0.6 at a minute, 0.6 / 0.3 at a day; absent disagrees 0.7; short is one group finding', () => {
    const r = (k: string, at: string, model: string, i: number, o: number): ReplyRef => ({ key: k, at, model, tokens: { input: i, output: o }, provider: 'anthropic' })
    const ex = parseExport('anthropic-usage-report', J({ data: [
      { starting_at: '2026-09-03T10:00:00Z', ending_at: '2026-09-03T10:01:00Z', results: [anthResult('m-a', 30, 3)] },
      { starting_at: '2026-09-03T10:01:00Z', ending_at: '2026-09-03T10:02:00Z', results: [anthResult('m-a', 99, 9)] },
      { starting_at: '2026-09-03T10:02:00Z', ending_at: '2026-09-03T10:03:00Z', results: [anthResult('m-b', 10, 1)] },
      { starting_at: '2026-09-03T10:03:00Z', ending_at: '2026-09-03T10:04:00Z', results: [anthResult('m-a', 5, 1)] },
    ], has_more: false, next_page: null }))
    const { byReply, shortfalls } = matchReplies([
      r('x1', '2026-09-03T10:00:10Z', 'm-a', 10, 1), r('x2', '2026-09-03T10:00:40Z', 'm-a', 20, 2),
      r('y', '2026-09-03T10:01:10Z', 'm-a', 10, 1),
      r('z', '2026-09-03T10:02:10Z', 'm-a', 10, 1),
      r('s1', '2026-09-03T10:03:10Z', 'm-a', 10, 1),
    ], [ex])
    expect(byReply.get('x1')![0]).toMatchObject({ method: 'bucket_exact', confidence: 0.8, verdict: 'agree' })
    expect(byReply.get('y')![0]).toMatchObject({ method: 'bucket_contained', confidence: 0.6, verdict: 'agree' })
    expect(byReply.get('z')![0]).toMatchObject({ method: 'bucket_absent', confidence: 0.7, verdict: 'disagree', billed: ['m-b'] })
    expect(byReply.get('s1')![0]).toMatchObject({ method: 'bucket_short', verdict: 'none' })
    expect(shortfalls).toEqual([expect.objectContaining({ model: 'm-a', replies: ['s1'], used: { input: 10, output: 1 }, billed: { input: 5, output: 1 } })])
    const day = parseExport('openrouter-activity', J({ data: [{ date: '2026-09-03', model: 'v/m', model_permaslug: 'v/m-1', endpoint_id: 'e', provider_name: 'P', usage: 0, byok_usage_inference: 0, requests: 1, prompt_tokens: 10, completion_tokens: 1, reasoning_tokens: 0, cached_tokens: 0 }] }))
    expect(matchReplies([rep('d1', { at: '2026-09-03T08:00:00Z', tokens: { input: 10, output: 1 } })], [day]).byReply.get('d1')![0]).toMatchObject({ method: 'bucket_exact', confidence: 0.6 })
    expect(matchReplies([rep('d2', { at: '2026-09-03T08:00:00Z', tokens: { input: 4, output: 1 } })], [day]).byReply.get('d2')![0]).toMatchObject({ method: 'bucket_contained', confidence: 0.3 })
  })
  it('an export speaks only for its provider: another provider\'s reply is not judged; no provider joins only by id', () => {
    const ex = parseExport('anthropic-usage-report', anthPage([anthResult('m-b', 10, 1)]))
    const at = '2026-09-03T10:00:10Z'
    expect(matchReplies([{ key: 'o', at, model: 'm-a', tokens: { input: 10, output: 1 }, provider: 'openai' }], [ex]).byReply.size).toBe(0)
    expect(matchReplies([{ key: 'n', at, model: 'm-a', tokens: { input: 10, output: 1 } }], [ex]).byReply.size).toBe(0)
    const req = reqExport([{ id: 'gen-1', at, model: 'v/m', i: 1, o: 1 }])
    expect(matchReplies([{ key: 'n', id: 'gen-1', model: 'v/m' }], [req]).byReply.get('n')![0]!.method).toBe('request_id')
    expect(matchReplies([{ key: 'n', at, model: 'v/m', tokens: { input: 1, output: 1 } }], [req]).byReply.size).toBe(0)
  })
})

// ── tiers, causes, findings ─────────────────────────────────────────────────────────────────────────────────────────────
let mid = 0
const ccReply = (model: string, at: string, i = 100, o = 10) => J({ type: 'assistant', timestamp: at, requestId: `req_${++mid}`, message: { id: `msg_${mid}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'never read' }], usage: { input_tokens: i, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: o } } })
const ccRun = (name: string, declared: string, lines: string[], extra: Partial<MonitorRun> = {}): MonitorRun => ({ name, format: 'claude-code', record: readHostRecord('claude-code', lines.join('\n') + '\n'), declared, provider: 'anthropic', ...extra })
const modelCmd = (at: string) => J({ type: 'user', timestamp: at, message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args>x</command-args>' } })

describe('evidence tiers and switch causes', () => {
  it('the tier ladder is defined, each tier saying what it rests on, what it cannot prove and what raises it', () => {
    expect(Object.keys(TIERS)).toEqual(['T0', 'T1', 'T2', 'T3'])
    for (const t of Object.values(TIERS)) for (const k of ['rests_on', 'cannot_prove', 'raise_by'] as const) expect(t[k].length).toBeGreaterThan(10)
    expect(tierTable()).toMatch(/\| T2 \| provider usage export \|/)
  })
  it('T1 from the transcript; T2 when an export agrees; T3 when a signed anchor agrees; every finding says what would raise it', () => {
    const lines = [ccReply('m-a-20250301', '2026-09-03T10:00:10Z', 10, 1), ccReply('m-a-20250301', '2026-09-03T10:05:10Z', 10, 1)]
    const run = ccRun('r', 'm-a-20250301', lines)
    const ex = parseExport('anthropic-usage-report', anthPage([anthResult('m-a-20250301', 10, 1)]))
    const k = keys()
    const ledger = openLedger(memoryStore(), { signingKey: k.priv, now: () => new Date('2026-09-03T10:00:12Z') })
    anchorReplies(ledger, { ...run.record, replies: [run.record.replies[0]!] }, 'r')
    const res = runMonitor({ month: '2026-09', runs: [run], exports: [{ parsed: ex }], anchors: [readAnchors('anchors.jsonl', ledger.entries(), k.pub)] })
    const f = res.runs[0]!.findings
    expect(f.map((x) => x.tier)).toEqual(['T3', 'T1'])
    expect(f[0]!.evidence.map((e) => e.tier)).toEqual(['T1', 'T2', 'T3'])
    expect(f[1]!.raise_by).toBe(TIERS.T1.raise_by)
    expect(res.runs[0]).toMatchObject({ outcome: 'PASS', flags: 0 })
  })
  it('an anchor that disagrees is a contradiction (the record changed after anchoring); a late anchor does not count as T3', () => {
    const k = keys()
    const run0 = ccRun('r', 'm-a', [ccReply('m-a', '2026-09-03T10:00:00Z')])
    const id = run0.record.replies[0]!.id!
    const ledger = openLedger(memoryStore(), { signingKey: k.priv, now: () => new Date('2026-09-03T10:00:05Z') })
    ledger.append('model_reply', { reply_id: id, model: 'm-other' })
    const a = runMonitor({ month: '2026-09', runs: [run0], anchors: [readAnchors('l', ledger.entries(), k.pub)] }).runs[0]!
    expect(a.contradictions).toHaveLength(1)
    expect(a.contradictions[0]!.conflict).toMatch(/changed after it was anchored/)
    const late = openLedger(memoryStore(), { signingKey: k.priv, now: () => new Date('2026-09-04T10:00:00Z') })
    late.append('model_reply', { reply_id: id, model: 'm-a' })
    const b = runMonitor({ month: '2026-09', runs: [run0], anchors: [readAnchors('l', late.entries(), k.pub)] }).runs[0]!
    expect(b.findings[0]).toMatchObject({ tier: 'T1' })
    expect(b.findings[0]!.evidence.find((e) => e.tier === 'T3')).toMatchObject({ verdict: 'late' })
    const wrongKey = readAnchors('l', ledger.entries(), keys().pub)
    expect(wrongKey).toMatchObject({ ok: false })
  })
  it('Codex records the model it asked for: T0 alone (INSUFFICIENT_DATA), T2 with a matching export', () => {
    const rollout = [
      J({ timestamp: '2026-09-03T10:00:00Z', type: 'turn_context', payload: { model: 'm-g', cwd: '/w' } }),
      J({ timestamp: '2026-09-03T10:00:30Z', type: 'token_usage_record', payload: { response_id: 'resp_1', usage: { input_tokens: 7, output_tokens: 3 } } }),
    ].join('\n')
    const run: MonitorRun = { name: 'cx', format: 'codex', record: readHostRecord('codex', rollout), declared: 'm-g', provider: 'openai' }
    const alone = runMonitor({ month: '2026-09', runs: [run] }).runs[0]!
    expect(alone).toMatchObject({ outcome: 'INSUFFICIENT_DATA', flags: 0 })
    expect(alone.findings[0]).toMatchObject({ tier: 'T0', basis: 'host_requested', resolved: null })
    const ex = parseExport('openai-responses', J({ id: 'resp_1', object: 'response', created_at: 1788429630, model: 'm-g-2025-04-14', usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: {}, output_tokens_details: {}, total_tokens: 10 } }))
    const withEx = runMonitor({ month: '2026-09', runs: [run], exports: [{ parsed: ex }] }).runs[0]!
    expect(withEx).toMatchObject({ outcome: 'PASS' })
    expect(withEx.findings[0]).toMatchObject({ tier: 'T2', resolved: 'm-g' })
  })
  it('causes: user_command (announced), host_fallback, unrecorded, alias_float for a floating alias and for snapshot drift', () => {
    const t = (n: number) => `2026-09-03T10:0${n}:00Z`
    const fallback = J({ type: 'system', subtype: 'model_refusal_fallback', timestamp: t(1), original_model: 'm-a', fallback_model: 'm-b' })
    const runs = [
      ccRun('cmd', 'm-a', [ccReply('m-a', t(0)), modelCmd(t(1)), ccReply('m-b', t(2))], { allowed: ['m-a', 'm-b'] }),
      ccRun('fb', 'm-a', [ccReply('m-a', t(0)), fallback, ccReply('m-b', t(2))]),
      ccRun('bare', 'm-a', [ccReply('m-a', t(0)), ccReply('m-b', t(2))]),
      ccRun('latest', 'm-a-latest', [ccReply('m-a-20250301', t(0)), ccReply('m-a-20250815', t(2))]),
      ccRun('drift', 'm-a', [ccReply('m-a-20250301', t(0)), ccReply('m-a-20250815', t(2))]),
    ]
    const res = runMonitor({ month: '2026-09', runs })
    const by = Object.fromEntries(res.runs.map((r) => [r.name, r]))
    expect(by.cmd!.switches[0]).toMatchObject({ cause: 'user_command', announced: true })
    expect(by.cmd!.flags).toBe(0)
    expect(by.fb!.switches[0]).toMatchObject({ cause: 'host_fallback', announced: false })
    expect(by.bare!.switches[0]).toMatchObject({ cause: 'unrecorded', announced: false })
    expect(by.latest!).toMatchObject({ outcome: 'INSUFFICIENT_DATA' })
    expect(by.latest!.switches[0]!.cause).toBe('alias_float')
    expect(by.drift!.switches[0]!.cause).toBe('alias_float')
    expect(by.drift!.violations).toHaveLength(0)
    expect(isAliasFloat(['m-a'], 'm-a', 'm-a-mini')).toBe(false)
    expect(res.per_declared.find((d) => d.declared === 'm-a')!.switches).toMatchObject({ host_fallback: 1, unrecorded: 1, alias_float: 1 })
  })
  it('dated snapshots: YYYYMMDD and YYYY-MM-DD match their base id; other suffixes do not', () => {
    expect(modelMatches('m-g', 'm-g-2025-04-14')).toBe(true)
    expect(modelMatches('m-g', 'm-g-mini-2025-04-14')).toBe(false)
    expect(modelMatches('m-g', 'm-g-2025-04')).toBe(false)
  })
  it('the Claude Code reader yields exactly the events riposte-attest reads (so both agree on every switch)', () => {
    const lines = [ccReply('m-a', '2026-09-03T10:00:00Z'), modelCmd('2026-09-03T10:00:30Z'), ccReply('<synthetic>', '2026-09-03T10:00:40Z'), J({ type: 'system', subtype: 'model_refusal_fallback', original_model: 'm-a', fallback_model: 'm-b' }), ccReply('m-b', '2026-09-03T10:01:00Z')]
    const dup = JSON.parse(lines[0]!); dup.message.usage.output_tokens = 55
    const text = [...lines.slice(0, 1), J(dup), ...lines.slice(1)].join('\n')
    const rec = readHostRecord('claude-code', text)
    expect(rec.events).toEqual(eventsFromClaudeCodeTranscript(text))
    expect(rec.replies[0]!.tokens).toEqual({ input: 100, output: 55 }) // the last entry of a reply carries the final usage
  })
})

// ── report, receipt, lock, CLI ──────────────────────────────────────────────────────────────────────────────────────────
const scratch = () => mkdtempSync(join(tmpdir(), 'attest-monitor-'))
function writeMonth(dir: string, seed: number) {
  const s = synthAttestMonth({ seed })
  for (const [rel, body] of Object.entries(s.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body) }
  writeFileSync(join(dir, 'manifest.json'), J(s.manifest))
  return s
}

describe('the monthly report', () => {
  it('renders deterministically, with every section and a plain statement of what it cannot prove', () => {
    const dir = scratch()
    const s = writeMonth(dir, 5)
    const load = () => loadManifest(s.manifest, (rel) => readFileSync(join(dir, rel)))
    const l = load()
    expect(l.refused).toEqual([])
    const a = runMonitor(l.input), b = runMonitor(load().input)
    expect(renderAttestReport(a)).toBe(renderAttestReport(b))
    expect(attestReportJson(a)).toBe(attestReportJson(b))
    const md = renderAttestReport(a)
    for (const h of ['## Per declared model', '## Evidence tiers', '## Silent switches, with evidence', '## Announced switches', '## Replies from a model that was not declared', '## Records that disagree with the host record', '## Buckets billed short', '## Provider exports used', '## Anchors (T3)', '## What this report cannot prove']) expect(md).toContain(h)
    expect(md).toMatch(/Which weights ran/)
    expect(md).toMatch(/That a provider told the truth/)
    const score = scoreAgainstTruth(a, s.truth)
    expect(score.clean_false_flags).toBe(0)
  })
  it('signs one receipt holding both files\' sha256 onto the ledger; it verifies with the key', () => {
    const k = keys()
    const ledger = openLedger(memoryStore(), { signingKey: k.priv })
    const r = runMonitor({ month: '2026-09', runs: [ccRun('r', 'm-a', [ccReply('m-a', '2026-09-03T10:00:00Z')])] })
    const json = attestReportJson(r), md = renderAttestReport(r)
    const e = signAttestReport(ledger, r, json, md)
    expect(e.kind).toBe('model_attest_report')
    expect(e.body).toMatchObject({ month: '2026-09', report_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), markdown_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(verifyChain(ledger.entries(), { publicKey: k.pub, requireSigned: true }).ok).toBe(true)
  })
})

describe('riposte-attest monitor (CLI)', () => {
  it('synth → run --ledger --key: writes both files, exit 1 on flags, a signed receipt that verifies; refuses under a live lock', () => {
    const dir = scratch()
    const k = keys()
    writeFileSync(join(dir, 'k.pem'), k.priv)
    expect(monitorCli(['synth', '--seed', '5', '--out', join(dir, 'm')], nodeMonitorIo).code).toBe(0)
    const ledgerPath = join(dir, 'receipts.jsonl')
    const r = monitorCli(['run', join(dir, 'm', 'manifest.json'), '--out', join(dir, 'out'), '--ledger', ledgerPath, '--key', join(dir, 'k.pem')], nodeMonitorIo)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/receipt seq 0 .* signed/)
    expect(existsSync(join(dir, 'out', 'attest-report.md')) && existsSync(join(dir, 'out', 'attest-report.json'))).toBe(true)
    const entries = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(verifyChain(entries, { publicKey: k.pub, requireSigned: true }).ok).toBe(true)
    expect(existsSync(`${ledgerPath}.lock`)).toBe(false)
    // another live process holds the ledger: refused, nothing appended
    writeFileSync(`${ledgerPath}.lock`, J({ pid: process.ppid, host: hostname(), started_at: new Date().toISOString() }))
    const locked = monitorCli(['run', join(dir, 'm', 'manifest.json'), '--out', join(dir, 'out2'), '--ledger', ledgerPath, '--key', join(dir, 'k.pem')], nodeMonitorIo)
    expect(locked.code).toBe(3)
    expect(locked.err).toMatch(/lock/i)
    expect(readFileSync(ledgerPath, 'utf8').trim().split('\n')).toHaveLength(1)
  })
  it('refuses a manifest with an unknown key, and an export with an unknown field, naming them', () => {
    const dir = scratch()
    writeMonth(dir, 6)
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    writeFileSync(join(dir, 'bad.json'), J({ ...m, extra: 1 }))
    expect(monitorCli(['run', join(dir, 'bad.json'), '--out', join(dir, 'o')], nodeMonitorIo)).toMatchObject({ code: 3, err: expect.stringMatching(/unknown key "extra"/) })
    const p = join(dir, 'exports', 'openai-usage.json')
    writeFileSync(p, readFileSync(p, 'utf8').replace('"has_more":false', '"has_more":false,"surprise":1'))
    expect(monitorCli(['run', join(dir, 'manifest.json'), '--out', join(dir, 'o')], nodeMonitorIo)).toMatchObject({ code: 3, err: expect.stringMatching(/page\.surprise/) })
  })
  it('parse, anchor and tiers sub-commands', () => {
    const dir = scratch()
    writeMonth(dir, 8)
    const ok = monitorCli(['parse', '--source', 'openrouter-activity', join(dir, 'exports', 'openrouter-activity.json')], nodeMonitorIo)
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toMatchObject({ source: 'openrouter-activity', granularity: 'bucket (1 UTC day)', unknown_fields: [] })
    expect(monitorCli(['parse', '--source', 'anthropic-console-csv', join(dir, 'exports', 'openrouter-activity.json')], nodeMonitorIo).code).toBe(3)
    const k = keys()
    writeFileSync(join(dir, 'k.pem'), k.priv)
    const a = monitorCli(['anchor', join(dir, 'runs', 'run-c01.jsonl'), '--format', 'claude-code', '--run', 'run-c01', '--ledger', join(dir, 'a.jsonl'), '--key', join(dir, 'k.pem')], nodeMonitorIo)
    expect(a.code).toBe(0)
    const again = monitorCli(['anchor', join(dir, 'runs', 'run-c01.jsonl'), '--format', 'claude-code', '--run', 'run-c01', '--ledger', join(dir, 'a.jsonl'), '--key', join(dir, 'k.pem')], nodeMonitorIo)
    expect(JSON.parse(again.out).anchored).toBe(0) // already anchored
    expect(monitorCli(['tiers'], nodeMonitorIo).out).toMatch(/T3: raise by/)
    expect(monitorCli(['nope'], nodeMonitorIo).code).toBe(3)
  })
})

// ── no house terms (the export scan's own term list) ────────────────────────────────────────────────────────────────────
const SCAN = join(HERE, '..', '..', 'riposte-export-scan.mjs')
describe.skipIf(!existsSync(SCAN))('no private vocabulary in the monitor, its docs or its report', () => {
  it('the scan finds nothing in the sources, the doc, a rendered report and the prereg fixtures', async () => {
    const { scanFile } = await import(pathToFileURL(SCAN).href) as { scanFile: (rel: string, buf: Buffer) => string[] }
    const src = join(HERE, '..', 'src')
    const files = [
      ...readdirSync(join(src, 'attest-monitor')).map((f) => [`packages/receipts/src/attest-monitor/${f}`, join(src, 'attest-monitor', f)]),
      ['packages/receipts/src/attest-monitor-command.ts', join(src, 'attest-monitor-command.ts')],
      ['packages/receipts/src/attest-monitor-cli.ts', join(src, 'attest-monitor-cli.ts')],
      ['packages/receipts/ATTEST-MONITOR.md', join(HERE, '..', 'ATTEST-MONITOR.md')],
      ['packages/receipts/test/attest-monitor.test.ts', join(HERE, 'attest-monitor.test.ts')],
      ['packages/receipts/test/attest-monitor-prereg.test.ts', join(HERE, 'attest-monitor-prereg.test.ts')],
      ['packages/receipts/test/fixtures/attest-monitor/PREREG.md', join(HERE, 'fixtures', 'attest-monitor', 'PREREG.md')],
    ].filter(([, abs]) => existsSync(abs!))
    const hits = files.flatMap(([rel, abs]) => scanFile(rel!, readFileSync(abs!)))
    const s = synthAttestMonth({ seed: 9 })
    const r = runMonitor(loadManifest(s.manifest, (rel) => Buffer.from(s.files[rel]!)).input)
    hits.push(...scanFile('packages/receipts/attest-report.md', Buffer.from(renderAttestReport(r))), ...scanFile('packages/receipts/attest-report.json', Buffer.from(attestReportJson(r))))
    for (const [rel, body] of Object.entries(s.files)) hits.push(...scanFile(`packages/receipts/test/fixtures/attest-monitor/x/${rel}`, Buffer.from(body)))
    expect(hits).toEqual([])
    expect(scanFile('packages/receipts/x.md', Buffer.from(['kee', 'per'].join('')))).not.toEqual([]) // the scan is live
  })
})

// keep the HostRecord type import honest
export type _H = HostRecord

describe('model_attest states its evidence tier', () => {
  it('T1 when replies recorded the model; T0 when none did', () => {
    const a = runMonitor({ month: '2026-09', runs: [ccRun('r', 'm-a', [ccReply('m-a', '2026-09-03T10:00:00Z')])] })
    expect(a.runs[0]!.findings[0]!.tier).toBe('T1')
    const one = attestModelsFor([ccReply('m-a', '2026-09-03T10:00:00Z')], 'm-a')
    expect(one).toMatchObject({ evidence_tier: 'T1', evidence_note: expect.stringMatching(/riposte-attest monitor/) })
    expect(attestModelsFor([ccReply('<synthetic>', '2026-09-03T10:00:00Z')], 'm-a')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', evidence_tier: 'T0' })
  })
})
function attestModelsFor(lines: string[], declared: string) {
  return attestModels(eventsFromClaudeCodeTranscript(lines.join('\n') + '\n'), { declared })
}
