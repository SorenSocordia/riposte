// The Cursor port of the claims check (src/hosts/cursor.ts). Fixtures: test/fixtures/hosts/cursor (see its README for
// what is verified and what is ASSUMED).
import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { STOP_SEND_BACK, sessionFromClaudeCodeTranscript, stopReceiptHost } from 'riposte-ai'
import { cursorHook, cursorToolOutput, parseCursorJournal, sessionFromCursorJournal, stepsToClaudeCodeJsonl, type CursorHookDeps, type CursorJournal } from '../src/index.js'
import { FAILING, cc, claudeCodeReceipt, fixtureJson, jsonl, ledgerAt, ledgerBytes, readEntries, scratch, tickingClock, verifyLedger, withoutHost } from './hosts-helpers.js'

const s = scratch()
afterAll(() => s.done())

type Payload = Record<string, unknown>
function memoryJournal(): CursorJournal & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return { files, read: (n) => files.get(n) ?? null, append: (n, l) => files.set(n, `${files.get(n) ?? ''}${l}\n`), remove: (n) => { files.delete(n) } }
}

let n = 0
/** Feed events through the hook as Cursor would, one process per event; the results, the journal and the ledger. */
function session(events: Payload[], env: Record<string, string> = {}, j = memoryJournal(), ledger = s.path(`c${++n}.jsonl`), clock = tickingClock('2026-10-03T03:00:00.000Z')) {
  const deps: CursorHookDeps = { env, journal: j, ledgerArg: ledger, openLedger: (p) => ledgerAt(p), now: clock }
  const results = events.map((e) => cursorHook(JSON.stringify(e), deps))
  return { results, stop: results[results.length - 1]!, journal: j, ledger, entries: existsSync(ledger) ? readEntries(ledger) : [] }
}
const events = (f: string) => fixtureJson<Payload[]>(`cursor/${f}.events.json`)

describe('Cursor: the journal as Steps', () => {
  it('a Shell postToolUse is a Bash run with its exit code; afterFileEdit is an Edit; afterAgentResponse is the reply', () => {
    const r = session(events('honest').slice(0, 3))
    const entries = parseCursorJournal([...r.journal.files.values()][0]!)
    const steps = sessionFromCursorJournal(entries)
    expect(steps.map((x) => x.kind)).toEqual(['tool_use', 'tool_result', 'tool_use', 'tool_result', 'assistant_text'])
    expect(steps[0]).toMatchObject({ name: 'Edit', input: { file_path: '/work/app/src/date.ts' } })
    expect(steps[2]).toMatchObject({ id: 'tool_test_1', name: 'Bash', input: { command: 'npm test' } })
    expect(steps[3]).toMatchObject({ isError: false })
    expect(sessionFromClaudeCodeTranscript(stepsToClaudeCodeJsonl(steps))).toEqual(steps)
  })
  it('tool_output: stdout and stderr, exitCode decides the error; a non-JSON output is kept as text', () => {
    expect(cursorToolOutput('{"exitCode":1,"stdout":"a","stderr":"b"}')).toEqual({ text: 'a\nb', isError: true })
    expect(cursorToolOutput('plain words')).toEqual({ text: 'plain words', isError: false })
  })
  it('a new generation id is a new user message', () => {
    const steps = sessionFromCursorJournal(parseCursorJournal([
      '{"k":"text","at":"t1","g":"g1","text":"one"}', '{"k":"text","at":"t2","g":"g2","text":"two"}',
    ].join('\n')))
    expect(steps.map((x) => x.kind)).toEqual(['assistant_text', 'user_prompt', 'assistant_text'])
  })
  it('every event is answered with JSON on stdout (Cursor counts no output as a failed hook)', () => {
    for (const r of session(events('planted-failing')).results) expect(() => JSON.parse(r.stdout)).not.toThrow()
  })
})

describe('Cursor: (a) an honest "tests pass" backed by a real test run → CLEAN', () => {
  it('PASS at stop: {} on stdout, exit 0, a receipt that does not want to block', () => {
    const r = session(events('honest'), { RIPOSTE_HOOK_MODE: 'block' })
    expect(r.stop).toMatchObject({ code: 0, stdout: '{}\n', stderr: '' })
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]!.body).toMatchObject({ source: 'stop_hook', mode: 'block', outcome: 'PASS', blocked: false, would_block: false })
  })
})

describe('Cursor: (b) a planted false "tests pass" → FINDINGS', () => {
  it('record-only by default: {} (no follow-up), the receipt says it would have blocked', () => {
    const r = session(events('planted-failing'))
    expect(r.stop).toMatchObject({ code: 0, stdout: '{}\n' })
    expect(r.entries[0]!.body).toMatchObject({ mode: 'record-only', outcome: 'FAIL', blocked: false, would_block: true })
    expect(r.entries[0]!.body.claims[0]).toMatchObject({ status: 'CONTRADICTED', evidence: { tool: 'Bash', command: 'npm test', tool_use_id: 'tool_test_1' } })
  })
  it('block: a followup_message with the send-back, once; the follow-up turn is never sent back again', () => {
    const j = memoryJournal()
    const ledger = s.path('cursor-bounce.jsonl')
    const first = session(events('planted-failing'), { RIPOSTE_HOOK_MODE: 'block' }, j, ledger)
    const out = JSON.parse(first.stop.stdout)
    expect(out.followup_message).toMatch(/^Before you finish: your final message makes a claim this session's tool results don't back\.\n/)
    expect(out.followup_message.endsWith(STOP_SEND_BACK)).toBe(true)
    expect(first.entries.at(-1)!.body).toMatchObject({ blocked: true })
    // Cursor reports the follow-up turn's stop with loop_count 1
    const second = session(events('after-sendback'), { RIPOSTE_HOOK_MODE: 'block' }, j, ledger, tickingClock('2026-10-03T03:05:00.000Z'))
    expect(second.stop).toMatchObject({ code: 0, stdout: '{}\n', skipped: 'this stop was already sent back once' })
    expect(second.entries).toHaveLength(1)
  })
  it('even if loop_count reads 0, the port remembers its own send-back and does not send twice', () => {
    const j = memoryJournal()
    session(events('planted-failing'), { RIPOSTE_HOOK_MODE: 'block' }, j)
    const again = events('after-sendback').map((e) => (e.hook_event_name === 'stop' ? { ...e, loop_count: 0 } : e))
    expect(session(again, { RIPOSTE_HOOK_MODE: 'block' }, j).stop).toMatchObject({ stdout: '{}\n', skipped: 'this stop was already sent back once' })
  })
  it('no test run at all: UNSUPPORTED; block sends it back, only-contradicted does not', () => {
    expect(JSON.parse(session(events('planted-norun'), { RIPOSTE_HOOK_MODE: 'block' }).stop.stdout).followup_message).toContain('UNSUPPORTED')
    const oc = session(events('planted-norun'), { RIPOSTE_HOOK_MODE: 'only-contradicted' })
    expect(oc.stop.stdout).toBe('{}\n')
    expect(oc.entries[0]!.body).toMatchObject({ outcome: 'INSUFFICIENT_DATA', would_block: false })
  })
  it('an aborted or errored loop is not checked; sessionEnd deletes the journal', () => {
    const ev = events('planted-failing').map((e) => (e.hook_event_name === 'stop' ? { ...e, status: 'aborted' } : e))
    const r = session(ev, { RIPOSTE_HOOK_MODE: 'block' })
    expect(r.stop).toMatchObject({ stdout: '{}\n', skipped: 'the agent loop ended with status "aborted"' })
    expect(r.entries).toHaveLength(0)
    cursorHook(JSON.stringify({ ...ev[0], hook_event_name: 'sessionEnd', reason: 'completed' }), { env: {}, journal: r.journal })
    expect(r.journal.files.size).toBe(0)
  })
})

describe('Cursor: (c) malformed input → fail open', () => {
  const deps = (env: Record<string, string> = {}): CursorHookDeps => ({ env, journal: memoryJournal(), ledgerArg: s.path('never.jsonl'), openLedger: (p) => ledgerAt(p) })
  it('not JSON, no conversation id, or an empty journal at stop: {} and exit 0 by default; exit 1 when enforcing; never a follow-up', () => {
    for (const stdin of ['', '{"hook_event_name":"stop"', '[]', '{"hook_event_name":"stop","status":"completed","loop_count":0}', '{"hook_event_name":"stop","conversation_id":"c-empty","status":"completed","loop_count":0}']) {
      const quiet = cursorHook(stdin, deps())
      expect(quiet).toMatchObject({ code: 0, stdout: '{}\n' })
      const loud = cursorHook(stdin, deps({ RIPOSTE_HOOK_MODE: 'block' }))
      expect(loud).toMatchObject({ code: 1, stdout: '{}\n' })
    }
    expect(existsSync(s.path('never.jsonl'))).toBe(false)
  })
  it('a journal write that throws never escapes', () => {
    const broken: CursorJournal = { read: () => null, append: () => { throw new Error('EACCES') }, remove: () => undefined }
    const r = cursorHook(JSON.stringify(events('honest')[1]), { env: {}, journal: broken })
    expect(r).toMatchObject({ code: 0, stdout: '{}\n' })
    expect(r.stderr).toContain('EACCES')
  })
})

describe('Cursor receipts: verify, and identical to the Claude Code hook once host is removed', () => {
  // planted-failing through the port with a clock ticking from 03:00:00: edit @00, test @01, reply @02, stop @03.
  const transcript = jsonl([
    cc.tool('2026-10-03T03:00:00.000Z', 'cursor-edit-1', 'Edit', { file_path: '/work/app/src/date.ts' }),
    cc.result('2026-10-03T03:00:00.000Z', 'cursor-edit-1', '/work/app/src/date.ts', false),
    cc.tool('2026-10-03T03:00:01.000Z', 'tool_test_1', 'Bash', { command: 'npm test' }),
    cc.result('2026-10-03T03:00:01.000Z', 'tool_test_1', FAILING, true),
    cc.say('2026-10-03T03:00:02.000Z', 'Fixed the date parser. All tests pass.'),
  ])
  it.each([{}, { RIPOSTE_HOOK_MODE: 'block' }, { RIPOSTE_HOOK_MODE: 'only-contradicted', RIPOSTE_STRICT: '1' }, { RIPOSTE_HOOK_MODE: 'block', RIPOSTE_NUNCHI: 'on', RIPOSTE_TIER: 'low', RIPOSTE_AUDIENCE: 'pr' }])('env %j: the receipt names its host; without it, the receipt bytes and ledger line of the Claude Code hook; the ledger verifies', (env) => {
    const port = session(events('planted-failing'), env as Record<string, string>)
    expect(verifyLedger(port.ledger).code).toBe(0)
    const ref = claudeCodeReceipt(transcript, {}, env)
    const sentBack = port.stop.stdout === '{}\n' ? '' : JSON.parse(port.stop.stdout).followup_message
    expect(sentBack).toBe(ref.decision.code === 2 ? ref.decision.stderr : '')
    const body = port.entries[0]!.body
    expect(Object.keys(body).slice(0, 2)).toEqual(['source', 'host'])
    expect(stopReceiptHost(body)).toBe('cursor')
    expect('host' in ref.receipt).toBe(false) // a Claude Code receipt keeps its bytes
    expect(stopReceiptHost(ref.receipt)).toBe('claude-code')
    expect(JSON.stringify(withoutHost(body))).toBe(JSON.stringify(ref.receipt))
    expect(ledgerBytes(s.dir, `cport-${n}.jsonl`, withoutHost(body))).toBe(ledgerBytes(s.dir, `ccc-${n}.jsonl`, ref.receipt))
  })
})
