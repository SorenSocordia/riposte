import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attestModels, modelGate, modelMatches, isFloatingAlias, eventsFromReplies, eventsFromClaudeCodeTranscript,
  attestCli, handleMcpRequest, openLedger, memoryStore, rootedJsonReader, rootedTextReader,
} from '../src/index.js'

// A Claude Code-shaped transcript: one reply can span several entries (one per content block) sharing message.id.
let n = 0
const reply = (model: string, blocks = 1, at = `2026-09-23T10:${String(n).padStart(2, '0')}:00Z`): string[] => {
  const id = `msg_${++n}`
  return Array.from({ length: blocks }, (_, b) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model, role: 'assistant', content: [{ type: 'text', text: `block ${b} (content is never read)` }] } }))
}
const user = (text: string) => JSON.stringify({ type: 'user', timestamp: '2026-09-23T10:00:00Z', message: { role: 'user', content: text } })
const modelCommand = () => user('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>claude-sonnet-4-5</command-args>')
const noise = () => JSON.stringify({ type: 'system', subtype: 'info' })
const transcript = (...lines: (string | string[])[]) => lines.flat().join('\n') + '\n'
const attest = (t: string, policy = {}) => attestModels(eventsFromClaudeCodeTranscript(t), policy)

describe('model attestation — which model actually answered', () => {
  it('a steady run on the declared model PASSes; replies are counted once however many blocks they span', () => {
    const t = transcript(user('hi'), reply('claude-opus-4-8', 3), noise(), reply('claude-opus-4-8', 2), reply('claude-opus-4-8'))
    const a = attest(t, { declared: 'claude-opus-4-8' })
    expect(a).toMatchObject({ outcome: 'PASS', replies: 3, models: { 'claude-opus-4-8': 3 }, switches: [], violation_count: 0 })
  })

  it('a run pinned to one model but silently served by another FAILs, naming the replies and the switch', () => {
    const t = transcript(reply('claude-opus-4-8'), reply('claude-opus-5'), reply('claude-opus-5'))
    const a = attest(t, { declared: 'claude-opus-4-8' })
    expect(a.outcome).toBe('FAIL')
    expect(a.violation_count).toBe(2)
    expect(a.violations.map((v) => v.model)).toEqual(['claude-opus-5', 'claude-opus-5'])
    expect(a.switches).toEqual([expect.objectContaining({ from: 'claude-opus-4-8', to: 'claude-opus-5', reply: 1, announced: false })])
    expect(a.reasons.join(' ')).toMatch(/2 of 3 replies came from claude-opus-5 — declared claude-opus-4-8/)
    expect(a.reasons.join(' ')).toMatch(/silent model switch/)
  })

  it('a wholly wrong model from the first reply FAILs even with no switch at all', () => {
    const a = attest(transcript(reply('claude-opus-5'), reply('claude-opus-5')), { declared: 'claude-opus-4-8' })
    expect(a).toMatchObject({ outcome: 'FAIL', switches: [], violation_count: 2 })
  })

  it('a switch the user asked for (/model) is ANNOUNCED — PASS when both models are allowed', () => {
    const t = transcript(reply('claude-opus-4-8'), modelCommand(), reply('claude-sonnet-4-5'))
    const a = attest(t, { allowed: ['claude-opus-4-8', 'claude-sonnet-4-5'] })
    expect(a.outcome).toBe('PASS')
    expect(a.switches).toEqual([expect.objectContaining({ from: 'claude-opus-4-8', to: 'claude-sonnet-4-5', announced: true })])
    expect(a.reasons[0]).toMatch(/every change was announced and every model was expected/)
  })

  it('announced is not the same as allowed: an announced switch to an undeclared model still FAILs', () => {
    const a = attest(transcript(reply('claude-opus-4-8'), modelCommand(), reply('claude-sonnet-4-5')), { declared: 'claude-opus-4-8' })
    expect(a.outcome).toBe('FAIL')
    expect(a.switches[0]!.announced).toBe(true)
    expect(a.reasons.join(' ')).not.toMatch(/silent/)
  })

  it('an announcement covers ONE switch, not every later one', () => {
    const t = transcript(reply('a-1'), modelCommand(), reply('b-1'), reply('c-1'))
    const a = attest(t, { failOnSilentSwitch: true })
    expect(a.switches.map((s) => s.announced)).toEqual([true, false])
    expect(a.outcome).toBe('FAIL')
  })

  it('a floating alias cannot be attested against — ABSTAIN, and say what actually answered', () => {
    for (const declared of ['opus', 'Sonnet', 'claude-3-5-sonnet-latest']) {
      const a = attest(transcript(reply('claude-opus-5')), { declared })
      expect(a.outcome).toBe('ABSTAIN')
      expect(a.reasons[0]).toMatch(/floating alias/)
      expect(a.reasons[1]).toMatch(/claude-opus-5/)
    }
  })

  it('dated snapshots match their base id; other suffixes do not', () => {
    expect(modelMatches('claude-sonnet-4-5', 'claude-sonnet-4-5-20250929')).toBe(true)
    expect(modelMatches('claude-sonnet-4-5', 'claude-sonnet-4-5')).toBe(true)
    expect(modelMatches('claude-sonnet-4-5', 'claude-sonnet-4-5-thinking')).toBe(false)
    expect(modelMatches('claude-opus-4', 'claude-opus-4-8')).toBe(false) // "4-8" is a different model, not a date
    expect(attest(transcript(reply('claude-sonnet-4-5-20250929')), { declared: 'claude-sonnet-4-5' }).outcome).toBe('PASS')
    expect(isFloatingAlias('claude-opus-4-8')).toBe(false)
  })

  it('host placeholders ("<synthetic>") and model-less entries are skipped, never a switch', () => {
    const t = transcript(reply('claude-opus-4-8'), reply('<synthetic>'), reply('claude-opus-4-8'))
    const a = attest(t, { declared: 'claude-opus-4-8' })
    expect(a).toMatchObject({ outcome: 'PASS', replies: 2, skipped: 1, switches: [] })
    expect(a.reasons.join(' ')).toMatch(/1 event\(s\) carried no model/)
  })

  it('nothing to attest → ABSTAIN, never PASS', () => {
    expect(attest(transcript(user('hi'), noise())).outcome).toBe('ABSTAIN')
    expect(attest(transcript(reply('<synthetic>'))).outcome).toBe('ABSTAIN')
    expect(attestModels([]).reasons[0]).toMatch(/no replies/)
  })

  it('with no declared model it checks consistency only: one model PASSes, a silent change FAILs unless allowed', () => {
    expect(attest(transcript(reply('m-1'), reply('m-1'))).reasons[0]).toMatch(/consistency only/)
    const t = transcript(reply('m-1'), reply('m-2'))
    expect(attest(t).outcome).toBe('FAIL')
    expect(attest(t, { failOnSilentSwitch: false }).outcome).toBe('PASS')
  })

  it('works on plain API replies (anything with a `model` field) and is deterministic', () => {
    const replies = [{ model: 'gpt-5.6-luna', id: 'r1' }, { model: 'gpt-5.6-luna', id: 'r2' }, { model: 'gpt-5.6-luna-mini', id: 'r3' }]
    const a = attestModels(eventsFromReplies(replies), { declared: 'gpt-5.6-luna' })
    expect(a).toMatchObject({ outcome: 'FAIL', violation_count: 1 })
    expect(JSON.stringify(attestModels(eventsFromReplies(replies), { declared: 'gpt-5.6-luna' }))).toBe(JSON.stringify(a))
  })

  it('the runtime gate: PROCEED only on the pinned model', () => {
    expect(modelGate('claude-opus-4-8', { model: 'claude-opus-4-8' }).action).toBe('PROCEED')
    expect(modelGate('claude-opus-4-8', { model: 'claude-opus-5' })).toMatchObject({ action: 'HOLD', reason: expect.stringMatching(/not the pinned/) })
    expect(modelGate('opus', { model: 'claude-opus-5' })).toMatchObject({ action: 'HOLD', reason: expect.stringMatching(/floating alias/) })
    expect(modelGate('claude-opus-4-8', {}).action).toBe('HOLD')
    expect(modelGate('claude-opus-4-8', { model: '<synthetic>' }).action).toBe('HOLD')
  })
})

describe('riposte-attest CLI', () => {
  const files: Record<string, string> = {
    'steady.jsonl': transcript(reply('claude-opus-4-8'), reply('claude-opus-4-8')),
    'breach.jsonl': transcript(reply('claude-opus-4-8'), reply('claude-opus-5')),
  }
  const read = (p: string) => { const f = files[p]; if (f === undefined) throw new Error('ENOENT'); return f }

  it('exit 0 PASS · 1 FAIL · 2 ABSTAIN · 3 usage', () => {
    expect(attestCli(['steady.jsonl', '--declared', 'claude-opus-4-8'], read).code).toBe(0)
    const fail = attestCli(['breach.jsonl', '--declared', 'claude-opus-4-8'], read)
    expect(fail.code).toBe(1)
    expect(JSON.parse(fail.out).switches).toHaveLength(1)
    expect(fail.err).toMatch(/^FAIL: /)
    expect(attestCli(['steady.jsonl', '--declared', 'opus'], read).code).toBe(2)
    expect(attestCli(['--declared'], read).code).toBe(3)
    expect(attestCli(['missing.jsonl'], read)).toMatchObject({ code: 3, err: expect.stringMatching(/cannot read/) })
    expect(attestCli(['a.jsonl', 'b.jsonl'], read).code).toBe(3)
    expect(attestCli(['--help'], read)).toMatchObject({ code: 0, err: expect.stringMatching(/riposte-attest/) })
  })

  it('--allow is repeatable; --allow-silent-switch relaxes only the silent-switch rule', () => {
    expect(attestCli(['breach.jsonl', '--allow', 'claude-opus-4-8', '--allow', 'claude-opus-5'], read).code).toBe(1) // silent
    expect(attestCli(['breach.jsonl', '--allow', 'claude-opus-4-8', '--allow', 'claude-opus-5', '--allow-silent-switch'], read).code).toBe(0)
  })

  it('as a hook: no path → the transcript_path from the hook JSON on stdin', () => {
    expect(attestCli(['--declared', 'claude-opus-4-8'], read, JSON.stringify({ transcript_path: 'breach.jsonl', hook_event_name: 'Stop' })).code).toBe(1)
    expect(attestCli(['--declared', 'claude-opus-4-8'], read, 'not json').code).toBe(3)
  })
})

describe('MCP model_attest', () => {
  const root = mkdtempSync(join(tmpdir(), 'receipts-attest-'))
  writeFileSync(join(root, 'session.jsonl'), transcript(reply('claude-opus-4-8'), reply('claude-opus-5')))
  const ledger = openLedger(memoryStore(), { now: () => new Date('2026-09-23T00:00:00Z') })
  const deps = { ledger, read: rootedJsonReader(root), readText: rootedTextReader(root) }
  const call = (args: unknown) => (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'model_attest', arguments: args } }, deps) as { result: { structuredContent: Record<string, unknown>; isError: boolean; content: { text: string }[] } }).result

  it('is listed', () => {
    const list = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, deps) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toContain('model_attest')
  })

  it('attests a transcript under the workspace root and writes a receipt', () => {
    const r = call({ transcript: 'session.jsonl', declared: 'claude-opus-4-8' })
    expect(r.structuredContent).toMatchObject({ outcome: 'FAIL', violation_count: 1, receipt: { seq: 0 } })
    expect(ledger.entries()[0]).toMatchObject({ kind: 'model_attest', body: { source: 'transcript:session.jsonl', outcome: 'FAIL' } })
  })

  it('attests plain API replies', () => {
    expect(call({ replies: [{ model: 'm-1' }, { model: 'm-1' }], declared: 'm-1' }).structuredContent).toMatchObject({ outcome: 'PASS' })
  })

  it('refuses transcripts outside the root, and bad args are tool errors — not crashes', () => {
    const esc = call({ transcript: '../../etc/passwd', declared: 'x' })
    expect(esc.isError).toBe(true)
    expect(esc.content[0]!.text).toMatch(/escapes the workspace root/)
    expect(call({ declared: 'x' }).isError).toBe(true)
    const noText = (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'model_attest', arguments: { transcript: 'session.jsonl' } } }, { ledger, read: deps.read }) as { result: { isError: boolean } }).result
    expect(noText.isError).toBe(true)
    expect(ledger.verify()).toMatchObject({ ok: true })
  })
})
