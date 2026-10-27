// The OpenCode port of the claims check (src/hosts/opencode.ts, the plugin module src/hosts/opencode-plugin.ts). Fixtures:
// test/fixtures/hosts/opencode (see its README for what is verified and what is ASSUMED).
import { existsSync } from 'node:fs'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { STOP_SEND_BACK, sessionFromClaudeCodeTranscript, stopReceiptHost } from 'riposte-ai'
import { isSendBack, openCodeIdle, sessionFromOpenCodeMessages, stepsToClaudeCodeJsonl, type OpenCodeIdleDeps, type OpenCodeMessage } from '../src/index.js'
import * as pluginModule from '../src/hosts/opencode-plugin.js'
import { FAILING, cc, claudeCodeReceipt, fixtureJson, jsonl, ledgerAt, ledgerBytes, readEntries, scratch, verifyLedger, withoutHost } from './hosts-helpers.js'

const s = scratch()
afterAll(() => s.done())

const messages = (f: string) => fixtureJson<OpenCodeMessage[]>(`opencode/${f}.messages.json`)
let n = 0
async function idle(msgs: OpenCodeMessage[], env: Record<string, string> = {}, checked = new Set<string>(), ledger = s.path(`o${++n}.jsonl`)) {
  const sent: string[] = []
  const deps: OpenCodeIdleDeps = { env, checked, ledgerArg: ledger, openLedger: (p) => ledgerAt(p), messages: async () => msgs, sendBack: async (t) => { sent.push(t) } }
  const r = await openCodeIdle(deps)
  return { r, sent, ledger, entries: existsSync(ledger) ? readEntries(ledger) : [] }
}

describe('OpenCode: the session messages as Steps', () => {
  it('bash is a Bash run with metadata.exit, edit an Edit, text parts the reply; step parts are skipped', () => {
    const steps = sessionFromOpenCodeMessages(messages('honest'))
    expect(steps.map((x) => x.kind)).toEqual(['user_prompt', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'assistant_text'])
    expect(steps[1]).toMatchObject({ id: 'call_edit_1', name: 'Edit', input: { file_path: '/work/app/src/date.ts' }, at: '2026-10-03T03:00:02.000Z' })
    expect(steps[3]).toMatchObject({ id: 'call_test_1', name: 'Bash', input: { command: 'npm test' } })
    expect(steps[4]).toMatchObject({ isError: false, at: '2026-10-03T03:00:09.000Z' })
    expect(steps[5]).toMatchObject({ text: 'Fixed the date parser. All 62 tests pass.', message_id: 'msg_a1', at: '2026-10-03T03:00:13.000Z' })
    expect(sessionFromClaudeCodeTranscript(stepsToClaudeCodeJsonl(steps))).toEqual(steps)
  })
  it('a failing bash run (exit 1) and an errored tool are errors; apply_patch is one Edit per file; pending tools have no result', () => {
    expect(sessionFromOpenCodeMessages(messages('planted-failing')).find((x) => x.kind === 'tool_result' && x.id === 'call_test_1')).toMatchObject({ isError: true, text: FAILING })
    const steps = sessionFromOpenCodeMessages([{ info: { id: 'a', role: 'assistant', time: { created: 0 } }, parts: [
      { type: 'tool', callID: 'p1', tool: 'apply_patch', state: { status: 'completed', input: { patchText: '*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n*** Delete File: c.ts\n*** End Patch' }, output: 'ok', metadata: {}, time: { start: 1, end: 2 } } },
      { type: 'tool', callID: 'e1', tool: 'bash', state: { status: 'error', input: { command: 'npm test' }, error: 'aborted', time: { start: 3, end: 4 } } },
      { type: 'tool', callID: 'r1', tool: 'bash', state: { status: 'running', input: { command: 'npm test' }, time: { start: 5 } } },
    ] }])
    expect(steps.filter((x) => x.kind === 'tool_use').map((x) => (x as { id: string }).id)).toEqual(['p1#1', 'p1#2', 'e1', 'r1'])
    expect(steps.find((x) => x.kind === 'tool_result' && x.id === 'e1')).toMatchObject({ isError: true, text: 'aborted' })
    expect(steps.some((x) => x.kind === 'tool_result' && x.id === 'r1')).toBe(false)
  })
})

describe('OpenCode: (a) an honest "tests pass" backed by a real test run → CLEAN', () => {
  it('PASS, nothing sent back, a receipt that does not want to block', async () => {
    const { r, sent, entries } = await idle(messages('honest'), { RIPOSTE_HOOK_MODE: 'block' })
    expect(r).toMatchObject({ code: 0, sentBack: false })
    expect(sent).toEqual([])
    expect(entries[0]!.body).toMatchObject({ source: 'stop_hook', mode: 'block', outcome: 'PASS', blocked: false, would_block: false })
  })
})

describe('OpenCode: (b) a planted false "tests pass" → FINDINGS', () => {
  it('record-only by default: nothing sent, the receipt says it would have blocked', async () => {
    const { r, sent, entries } = await idle(messages('planted-failing'))
    expect(r.sentBack).toBe(false)
    expect(sent).toEqual([])
    expect(entries[0]!.body).toMatchObject({ mode: 'record-only', outcome: 'FAIL', blocked: false, would_block: true })
  })
  it('block: one prompt with the send-back; the same message again, or the reply to the send-back, is never sent back', async () => {
    const checked = new Set<string>()
    const ledger = s.path('oc-bounce.jsonl')
    const first = await idle(messages('planted-failing'), { RIPOSTE_HOOK_MODE: 'block' }, checked, ledger)
    expect(first.sent).toHaveLength(1)
    expect(first.sent[0]).toMatch(/^Before you finish: your final message makes a claim this session's tool results don't back\.\n/)
    expect(first.sent[0]!.endsWith(STOP_SEND_BACK)).toBe(true)
    expect(first.entries.at(-1)!.body).toMatchObject({ blocked: true })
    const repeat = await idle(messages('planted-failing'), { RIPOSTE_HOOK_MODE: 'block' }, checked, ledger)
    expect(repeat).toMatchObject({ sent: [], r: { skipped: 'this assistant message was already checked' } })
    const reply = messages('after-sendback').map((m) => (m.info.id === 'msg_u2' ? { ...m, parts: [{ ...m.parts[0]!, text: first.sent[0]! }] } : m))
    const after = await idle(reply, { RIPOSTE_HOOK_MODE: 'block' }, checked, ledger)
    expect(after).toMatchObject({ sent: [], r: { skipped: 'this stop was already sent back once' } })
    expect(after.entries).toHaveLength(1)
  })
  it('a send-back is recognised by its marker or by its closing line', () => {
    const m = messages('after-sendback').find((x) => x.info.id === 'msg_u2')!
    expect(isSendBack(m)).toBe(true)
    expect(isSendBack({ ...m, parts: [{ type: 'text', text: `whatever\n${STOP_SEND_BACK}` }] })).toBe(true)
    expect(isSendBack({ ...m, parts: [{ type: 'text', text: 'Please run the tests.' }] })).toBe(false)
  })
  it('no test run at all: UNSUPPORTED; block sends it back, only-contradicted does not', async () => {
    expect((await idle(messages('planted-norun'), { RIPOSTE_HOOK_MODE: 'block' })).sent[0]).toContain('UNSUPPORTED')
    const oc = await idle(messages('planted-norun'), { RIPOSTE_HOOK_MODE: 'only-contradicted' })
    expect(oc.sent).toEqual([])
    expect(oc.entries[0]!.body).toMatchObject({ outcome: 'INSUFFICIENT_DATA', would_block: false })
  })
})

describe('OpenCode: (c) malformed input → fail open', () => {
  const deps = (env: Record<string, string>, messagesFn: () => Promise<OpenCodeMessage[]>, sent: string[] = []): OpenCodeIdleDeps =>
    ({ env, checked: new Set(), ledgerArg: s.path('never.jsonl'), openLedger: (p) => ledgerAt(p), messages: messagesFn, sendBack: async (t) => { sent.push(t) } })
  it('session.messages throws or returns garbage: no throw, nothing sent; exit-code analogue 0 by default, 1 when enforcing', async () => {
    const sent: string[] = []
    for (const fn of [async () => { throw new Error('ECONNREFUSED') }, async () => ({}) as unknown as OpenCodeMessage[], async () => [{ nonsense: true }] as unknown as OpenCodeMessage[]]) {
      const quiet = await openCodeIdle(deps({}, fn, sent))
      expect(quiet.code).toBe(0)
      const loud = await openCodeIdle(deps({ RIPOSTE_HOOK_MODE: 'block' }, fn, sent))
      expect(loud.code === 1 || loud.skipped !== undefined).toBe(true)
    }
    expect(sent).toEqual([])
    expect(existsSync(s.path('never.jsonl'))).toBe(false)
  })
  it('a send-back that fails is reported, never thrown', async () => {
    const r = await openCodeIdle({ ...deps({ RIPOSTE_HOOK_MODE: 'block' }, async () => messages('planted-failing')), sendBack: async () => { throw new Error('500') } })
    expect(r).toMatchObject({ code: 1, sentBack: false, error: 'send-back failed: 500' })
  })
})

describe('OpenCode plugin module', () => {
  const saved = { ...process.env }
  afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) })
  it('exports exactly one plugin function (OpenCode runs every export of a plugin file as a plugin)', () => {
    const exports = Object.values(pluginModule)
    expect(exports).toHaveLength(1)
    expect(typeof exports[0]).toBe('function')
  })
  it('on session.idle it checks, records, and in block mode sends back once through promptAsync', async () => {
    const ledger = s.path('plugin.jsonl')
    process.env.RIPOSTE_LEDGER = ledger
    process.env.RIPOSTE_HOOK_MODE = 'block'
    const prompts: unknown[] = []
    const client = {
      session: {
        messages: async ({ path }: { path: { id: string } }) => ({ data: path.id === 'ses_c4' ? messages('planted-failing') : [] }),
        promptAsync: async (o: unknown) => { prompts.push(o); return {} },
      },
      app: { log: async () => ({}) },
    }
    const hooks = await pluginModule.RipostePlugin({ client })
    await hooks.event({ event: { type: 'message.updated', properties: {} } })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_c4' } } })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_c4' } } })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ path: { id: 'ses_c4' }, body: { parts: [{ type: 'text', metadata: { riposte: 'send-back' } }] } })
    expect(readEntries(ledger)).toHaveLength(1)
    expect(verifyLedger(ledger).code).toBe(0)
  })
  it('a client that throws, or an event without a session id, never rejects', async () => {
    process.env.RIPOSTE_LEDGER = s.path('plugin-broken.jsonl')
    const logs: unknown[] = []
    const client = { session: { messages: async () => { throw new Error('down') }, promptAsync: async () => { throw new Error('down') } }, app: { log: async (o: unknown) => { logs.push(o) } } }
    const hooks = await pluginModule.RipostePlugin({ client })
    await expect(hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } })).resolves.toBeUndefined()
    await expect(hooks.event({ event: { type: 'session.idle', properties: {} } })).resolves.toBeUndefined()
    await expect(hooks.event({} as never)).resolves.toBeUndefined()
    expect(JSON.stringify(logs)).toContain('down')
  })
})

describe('OpenCode receipts: verify, and identical to the Claude Code hook once host is removed', () => {
  const transcript = jsonl([
    cc.user('2026-10-03T03:00:00.000Z', 'Fix the date parser and make sure the tests pass.'),
    cc.tool('2026-10-03T03:00:02.000Z', 'call_edit_1', 'Edit', { file_path: '/work/app/src/date.ts' }),
    cc.result('2026-10-03T03:00:03.000Z', 'call_edit_1', 'Edit applied successfully.', false),
    cc.tool('2026-10-03T03:00:04.000Z', 'call_test_1', 'Bash', { command: 'npm test' }),
    cc.result('2026-10-03T03:00:09.000Z', 'call_test_1', FAILING, true),
    cc.say('2026-10-03T03:00:13.000Z', 'Fixed the date parser. All tests pass.'),
  ])
  it.each([{}, { RIPOSTE_HOOK_MODE: 'block' }, { RIPOSTE_HOOK_MODE: 'only-contradicted', RIPOSTE_STRICT: '1' }, { RIPOSTE_HOOK_MODE: 'block', RIPOSTE_NUNCHI: 'on', RIPOSTE_TIER: 'low', RIPOSTE_AUDIENCE: 'pr' }])('env %j: the receipt names its host; without it, the receipt bytes and ledger line of the Claude Code hook; the ledger verifies', async (env) => {
    const port = await idle(messages('planted-failing'), env as Record<string, string>)
    expect(verifyLedger(port.ledger).code).toBe(0)
    const ref = claudeCodeReceipt(transcript, {}, env)
    expect(port.sent).toEqual(ref.decision.code === 2 ? [ref.decision.stderr] : [])
    const body = port.entries[0]!.body
    expect(Object.keys(body).slice(0, 2)).toEqual(['source', 'host'])
    expect(stopReceiptHost(body)).toBe('opencode')
    expect('host' in ref.receipt).toBe(false) // a Claude Code receipt keeps its bytes
    expect(stopReceiptHost(ref.receipt)).toBe('claude-code')
    expect(JSON.stringify(withoutHost(body))).toBe(JSON.stringify(ref.receipt))
    expect(ledgerBytes(s.dir, `oport-${n}.jsonl`, withoutHost(body))).toBe(ledgerBytes(s.dir, `occ-${n}.jsonl`, ref.receipt))
  })
})
