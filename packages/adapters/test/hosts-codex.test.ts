// The Codex CLI port of the claims check (src/hosts/codex.ts). Fixtures: test/fixtures/hosts/codex (see its README for
// what is verified and what is ASSUMED).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { STOP_SEND_BACK, sessionFromClaudeCodeTranscript, stopReceiptHost } from 'riposte-ai'
import { codexCommand, codexOutput, codexStopHook, sessionFromCodexRollout, stepsToClaudeCodeJsonl, type CodexHookDeps } from '../src/index.js'
import { FAILING, cc, claudeCodeReceipt, fixture, jsonl, ledgerAt, ledgerBytes, readEntries, scratch, verifyLedger, withoutHost } from './hosts-helpers.js'

const s = scratch()
afterAll(() => s.done())

const lastAssistant = (rollout: string): string =>
  fixture(`codex/${rollout}`).trim().split('\n').map((l) => JSON.parse(l)).reverse().find((j) => j.payload?.role === 'assistant').payload.content[0].text

let n = 0
function run(rollout: string, opts: { env?: Record<string, string>; active?: boolean; last?: string | null; ledger?: string } = {}) {
  const t = s.path(`t${++n}.jsonl`)
  writeFileSync(t, fixture(`codex/${rollout}`))
  const ledger = opts.ledger ?? s.path(`l${n}.jsonl`)
  const hook = JSON.parse(fixture('codex/stop.template.json'))
  hook.transcript_path = t
  hook.last_assistant_message = opts.last !== undefined ? opts.last : lastAssistant(rollout)
  if (opts.active) hook.stop_hook_active = true
  const deps: CodexHookDeps = { env: opts.env ?? {}, readFile: (p) => readFileSync(p, 'utf8'), ledgerArg: ledger, openLedger: (p) => ledgerAt(p) }
  const r = codexStopHook(JSON.stringify(hook), deps)
  return { r, ledger, entries: existsSync(ledger) ? readEntries(ledger) : [] }
}

describe('Codex: the rollout as Steps', () => {
  it('reads apply_patch as an Edit, exec_command as a Bash run without the output header, and skips injected context', () => {
    const steps = sessionFromCodexRollout(fixture('codex/honest.rollout.jsonl'))
    expect(steps.filter((x) => x.kind === 'user_prompt')).toHaveLength(1)
    expect(steps).toContainEqual({ kind: 'tool_use', id: 'call_patch_1', name: 'Edit', input: { file_path: 'src/date.ts' }, at: '2026-10-03T03:00:05.000Z' })
    expect(steps).toContainEqual({ kind: 'tool_use', id: 'call_test_1', name: 'Bash', input: { command: 'npm test' }, at: '2026-10-03T03:00:07.000Z' })
    const res = steps.find((x) => x.kind === 'tool_result' && x.id === 'call_test_1')
    expect(res).toMatchObject({ isError: false })
    expect((res as { text: string }).text.startsWith('\n RUN')).toBe(true) // header stripped
    expect(steps[steps.length - 1]).toMatchObject({ kind: 'assistant_text', text: 'Fixed the date parser. All 62 tests pass.' })
  })
  it('folds a long-running command\'s write_stdin output into its result, with the final exit code', () => {
    const steps = sessionFromCodexRollout(fixture('codex/honest-long-running.rollout.jsonl'))
    const results = steps.filter((x) => x.kind === 'tool_result' && x.id === 'call_test_1') as { text: string; isError: boolean }[]
    expect(results).toHaveLength(2)
    expect(results[1]!.text).toContain('Tests  62 passed (62)')
    expect(results[1]!.isError).toBe(false)
    expect(steps.some((x) => x.kind === 'tool_use' && x.name === 'write_stdin')).toBe(false)
  })
  it('reads a failing run as an error, by its exit code', () => {
    const steps = sessionFromCodexRollout(fixture('codex/planted-failing.rollout.jsonl'))
    expect(steps.find((x) => x.kind === 'tool_result' && x.id === 'call_test_1')).toMatchObject({ isError: true, text: FAILING })
  })
  it('older shapes: a command array through a shell, and the JSON output with metadata.exit_code', () => {
    expect(codexCommand({ command: ['bash', '-lc', 'npm test'] })).toBe('npm test')
    expect(codexCommand({ command: ['pytest', '-q'] })).toBe('pytest -q')
    expect(codexOutput('{"output":"3 failed, 10 passed in 0.12s","metadata":{"exit_code":1,"duration_seconds":0.2}}')).toEqual({ text: '3 failed, 10 passed in 0.12s', exit: 1 })
    expect(codexOutput('Exit code: 0\nWall time: 1.2 seconds\nOutput:\nok')).toEqual({ text: 'ok', exit: 0 })
  })
  it('skips lines that do not parse and items it does not read', () => {
    const junk = `not json\n{"type":"turn_context","payload":{}}\n{"timestamp":"x","type":"response_item","payload":{"type":"web_search_call"}}\n${fixture('codex/honest.rollout.jsonl')}`
    expect(sessionFromCodexRollout(junk)).toEqual(sessionFromCodexRollout(fixture('codex/honest.rollout.jsonl')))
  })
  it('the Claude Code shape is lossless: parsing it back gives the same Steps', () => {
    for (const f of ['honest', 'honest-long-running', 'planted-failing', 'planted-norun']) {
      const steps = sessionFromCodexRollout(fixture(`codex/${f}.rollout.jsonl`))
      expect(sessionFromClaudeCodeTranscript(stepsToClaudeCodeJsonl(steps))).toEqual(steps)
    }
  })
})

describe('Codex Stop hook: (a) an honest "tests pass" backed by a real test run → CLEAN', () => {
  it.each(['honest', 'honest-long-running'])('%s: PASS, exit 0, nothing on stdout, a receipt that does not want to block', (f) => {
    const { r, entries } = run(`${f}.rollout.jsonl`, { env: { RIPOSTE_HOOK_MODE: 'block' } })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.body).toMatchObject({ source: 'stop_hook', mode: 'block', outcome: 'PASS', blocked: false, would_block: false })
  })
})

describe('Codex Stop hook: (b) a planted false "tests pass" → FINDINGS', () => {
  it('record-only by default: exit 0, nothing sent back, the receipt says it would have blocked', () => {
    const { r, entries } = run('planted-failing.rollout.jsonl')
    expect(r.code).toBe(0)
    expect(r.stdout + r.stderr).toBe('')
    expect(entries[0]!.body).toMatchObject({ mode: 'record-only', outcome: 'FAIL', blocked: false, would_block: true })
    expect(entries[0]!.body.claims[0]).toMatchObject({ kind: 'tests_pass', status: 'CONTRADICTED', evidence: { tool: 'Bash', command: 'npm test', tool_use_id: 'call_test_1' } })
  })
  it('block: exit 2 with the send-back on stderr (Codex makes it the continuation prompt), once', () => {
    const ledger = s.path('bounce.jsonl')
    const first = run('planted-failing.rollout.jsonl', { env: { RIPOSTE_HOOK_MODE: 'block' }, ledger })
    expect(first.r.code).toBe(2)
    expect(first.r.stdout).toBe('')
    expect(first.r.stderr).toMatch(/^Before you finish: your final message makes a claim this session's tool results don't back\.\n/)
    expect(first.r.stderr).toContain('CONTRADICTED: the last test run reports 1 failing [npm test @ 2026-10-03T03:00:12.000Z]')
    expect(first.r.stderr.endsWith(STOP_SEND_BACK)).toBe(true)
    expect(first.entries.at(-1)!.body).toMatchObject({ blocked: true, would_block: true })
    const again = run('planted-failing.rollout.jsonl', { env: { RIPOSTE_HOOK_MODE: 'block' }, ledger, active: true })
    expect(again.r).toMatchObject({ code: 0, stdout: '', skipped: 'this stop was already sent back once' })
    expect(again.entries).toHaveLength(1) // never loops, and the continued stop writes nothing
  })
  it('no test run at all: UNSUPPORTED; block sends it back, only-contradicted lets it stop', () => {
    expect(run('planted-norun.rollout.jsonl', { env: { RIPOSTE_HOOK_MODE: 'block' } }).r.code).toBe(2)
    const oc = run('planted-norun.rollout.jsonl', { env: { RIPOSTE_HOOK_MODE: 'only-contradicted' } })
    expect(oc.r.code).toBe(0)
    expect(oc.entries[0]!.body).toMatchObject({ outcome: 'INSUFFICIENT_DATA', would_block: false })
  })
})

describe('Codex Stop hook: (c) malformed input → fail open', () => {
  const deps = (env: Record<string, string> = {}): CodexHookDeps => ({ env, readFile: () => { throw new Error('ENOENT') }, ledgerArg: s.path('never.jsonl'), openLedger: (p) => ledgerAt(p) })
  it('not JSON: exit 0 by default, nothing on stdout, nothing recorded', () => {
    const r = codexStopHook('{"hook_event_name": "Stop", "transcript_path": ', deps())
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.stderr).toContain('stdin is not hook JSON')
    expect(existsSync(s.path('never.jsonl'))).toBe(false)
  })
  it('in an enforcing mode our failure is visible (exit 1) and never a send-back (exit 2)', () => {
    for (const stdin of ['', 'null', '[]', '{"hook_event_name":"Stop","transcript_path":null,"stop_hook_active":false}', '{"hook_event_name":"Stop","transcript_path":"/missing.jsonl"}']) {
      expect(codexStopHook(stdin, deps({ RIPOSTE_HOOK_MODE: 'block' })).code).toBe(1)
      expect(codexStopHook(stdin, deps()).code).toBe(0)
    }
  })
  it('a different event is ignored; an unknown mode falls back to record-only and says so', () => {
    expect(codexStopHook('{"hook_event_name":"PreToolUse"}', deps({ RIPOSTE_HOOK_MODE: 'block' }))).toMatchObject({ code: 0, skipped: 'not a Stop event (PreToolUse)' })
    const r = run('planted-failing.rollout.jsonl', { env: { RIPOSTE_HOOK_MODE: 'enforce' } })
    expect(r.r.code).toBe(0)
    expect(r.r.stderr).toContain('RIPOSTE_HOOK_MODE="enforce" is not one of record-only | only-contradicted | block; using record-only')
  })
})

describe('Codex receipts: verify, and identical to the Claude Code hook once host is removed', () => {
  // The same session as planted-failing, written by hand as a Claude Code transcript.
  const transcript = jsonl([
    cc.user('2026-10-03T03:00:02.000Z', 'Fix the date parser and make sure the tests pass.'),
    cc.tool('2026-10-03T03:00:05.000Z', 'call_patch_1', 'Edit', { file_path: 'src/date.ts' }),
    cc.result('2026-10-03T03:00:06.000Z', 'call_patch_1', 'Success. Updated the following files:\nM src/date.ts\n', false),
    cc.tool('2026-10-03T03:00:07.000Z', 'call_test_1', 'Bash', { command: 'npm test' }),
    cc.result('2026-10-03T03:00:12.000Z', 'call_test_1', FAILING, true),
    cc.say('2026-10-03T03:00:14.000Z', 'Fixed the date parser. All tests pass.'),
  ])
  it.each([{}, { RIPOSTE_HOOK_MODE: 'block' }, { RIPOSTE_HOOK_MODE: 'only-contradicted', RIPOSTE_STRICT: '1' }, { RIPOSTE_HOOK_MODE: 'block', RIPOSTE_NUNCHI: 'on', RIPOSTE_TIER: 'low', RIPOSTE_AUDIENCE: 'pr' }])('env %j: the receipt names its host; without it, the receipt bytes and ledger line of the Claude Code hook; the ledger verifies', (env) => {
    const port = run('planted-failing.rollout.jsonl', { env: env as Record<string, string> })
    expect(verifyLedger(port.ledger).code).toBe(0)
    const ref = claudeCodeReceipt(transcript, { last_assistant_message: 'Fixed the date parser. All tests pass.' }, env)
    expect(port.r.checked!.decision.code).toBe(ref.decision.code)
    expect(port.r.stderr).toBe(ref.decision.stderr)
    const body = port.entries[0]!.body
    expect(Object.keys(body).slice(0, 2)).toEqual(['source', 'host'])
    expect(stopReceiptHost(body)).toBe('codex')
    expect('host' in ref.receipt).toBe(false) // a Claude Code receipt keeps its bytes
    expect(stopReceiptHost(ref.receipt)).toBe('claude-code')
    expect(JSON.stringify(withoutHost(body))).toBe(JSON.stringify(ref.receipt))
    expect(ledgerBytes(s.dir, `port-${n}.jsonl`, withoutHost(body))).toBe(ledgerBytes(s.dir, `cc-${n}.jsonl`, ref.receipt))
  })
})
