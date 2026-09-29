import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VOICE_LADDER } from 'riposte-verify'
import { memoryStore, openLedger } from 'riposte-ai'
import { actionCli, actionHookOptionsFromEnv, countPriorHolds, parseActionPolicy, preToolUseHook, type CliIo } from '../src/index.js'

const now = () => new Date('2026-09-28T09:00:00Z')
const POLICY_JSON = (level: string, allowed: Record<string, (string | number)[]>, tier = 'severe') =>
  JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'mcp__bank__transfer', level, tier, set_by: 'controller', sources: { allowed } }] })
const GROUNDED = { to_account: ['110-234-5678'], amount: [500] }
const WRONG = { to_account: ['220-000-1111'], amount: [500] }
const hookInput = (over: Record<string, unknown> = {}) => JSON.stringify({
  session_id: 'sess-1', transcript_path: '/t.jsonl', cwd: '/w', permission_mode: 'default', hook_event_name: 'PreToolUse',
  tool_name: 'mcp__bank__transfer', tool_input: { to_account: '110-234-5678', amount: 500 }, tool_use_id: 'toolu_01', ...over,
})
const run = (level: string, allowed: Record<string, (string | number)[]>, over: Record<string, unknown> = {}, prior = 0, mode: 'on' | 'record-only' = 'on') =>
  preToolUseHook(hookInput(over), mode, { policy: parseActionPolicy(POLICY_JSON(level, allowed)), now, priorHolds: () => prior })
const out = (r: { stdout: string }) => (r.stdout ? JSON.parse(r.stdout) : undefined)

describe('configuration: OFF by default', () => {
  it('is off unless RIPOSTE_ACTION_HOOK says otherwise; an unknown mode stays off and says so', () => {
    expect(actionHookOptionsFromEnv({}).mode).toBe('off')
    const bad = actionHookOptionsFromEnv({ RIPOSTE_ACTION_HOOK: 'enforce' })
    expect(bad.mode).toBe('off')
    expect(bad.problems[0]).toMatch(/staying off/)
    // D14: RIPOSTE_LEDGER (the Stop hook's book) is never an implicit home for action receipts
    expect(actionHookOptionsFromEnv({ RIPOSTE_ACTION_HOOK: ' On ', RIPOSTE_ACTION_POLICY: 'p.json', RIPOSTE_LEDGER: 'l.jsonl' })).toEqual({ mode: 'on', policy: 'p.json', problems: [] })
    expect(actionHookOptionsFromEnv({ RIPOSTE_ACTION_LEDGER: 'a.jsonl', RIPOSTE_LEDGER: 'b.jsonl' }).ledger).toBe('a.jsonl')
    expect(actionHookOptionsFromEnv({ RIPOSTE_LEDGER: 'b.jsonl' }).ledger).toBeUndefined()
  })
  it('off: the CLI returns before reading stdin or the policy', () => {
    const io: CliIo = { stdin: () => { throw new Error('read stdin') }, readFile: () => { throw new Error('read a file') } }
    expect(actionCli(['--hook'], {}, io)).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'off' }, io).code).toBe(0)
  })
})

describe('gate and autonomy HOLD: "ask" puts the call in front of a person', () => {
  for (const level of ['gate', 'autonomy']) {
    it(`FAIL at ${level} → ask, the notice shown to the person, a no-retry note for Claude`, () => {
      const r = run(level, WRONG)
      expect(r.code).toBe(0)
      expect(r.decision).toBe('ask')
      const o = out(r)
      expect(o.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'ask' })
      expect(o.hookSpecificOutput.permissionDecisionReason).toContain('Held for a person: tool mcp__bank__transfer, outcome FAIL')
      expect(o.hookSpecificOutput.permissionDecisionReason).toContain('arg.to_account')
      expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/verify opinion --ledger <chain\.jsonl> --dispute [0-9a-f]{32} --claim arg\.to_account/)
      expect(o.hookSpecificOutput.additionalContext).toMatch(/do not retry it/)
      expect(r.record).toMatchObject({ disposition: 'hold', decision: 'ask', would_decision: 'ask', held: true, repeat: false, level, tier: 'severe', set_by: 'controller', session_id: 'sess-1', tool_use_id: 'toolu_01' })
    })
  }
  it('an ungrounded account number at gate is held (verify itself, since F1), not reviewed as a PASS', () => {
    const r = run('gate', { amount: [500] })
    expect(r.decision).toBe('ask')
    expect(r.record?.disposition).toBe('hold')
    expect(r.record?.guard).toBeUndefined() // verify is strict itself since F1 was fixed (09-28); the guard stays as a belt
  })
  it('PASS at gate → ask for review (a person reviews PASSes at gate)', () => {
    const r = run('gate', GROUNDED)
    expect(r.decision).toBe('ask')
    expect(out(r).hookSpecificOutput.additionalContext).toMatch(/sent for review/)
    expect(r.record?.disposition).toBe('review')
  })
})

describe('it never loops', () => {
  it('a repeat of an identical held call in the same session gets a firm deny, not a second prompt', () => {
    const r = run('gate', WRONG, {}, 1)
    expect(r.decision).toBe('deny')
    const o = out(r)
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/^Already held once in this session: Riposte will not ask again/)
    expect(o.hookSpecificOutput.permissionDecisionReason).toMatch(/Do not retry it\./)
    expect(o.systemMessage).toMatch(/Riposte held mcp__bank__transfer/)
    expect(r.record?.repeat).toBe(true)
  })
  for (const mode of ['dontAsk', 'bypassPermissions', 'someFutureMode']) {
    it(`when nobody can be asked (permission_mode ${mode}), a hold is a deny`, () => {
      const r = run('autonomy', WRONG, { permission_mode: mode })
      expect(r.decision).toBe('deny')
      expect(out(r).hookSpecificOutput.permissionDecisionReason).toMatch(/No person can be asked/)
    })
  }
  it('the loop guard counts only actual holds in the same session for the same call', () => {
    const led = openLedger(memoryStore(), { now })
    const policy = POLICY_JSON('gate', WRONG)
    const io: CliIo = { stdin: () => hookInput(), readFile: () => policy, openLedger: () => led, now }
    const env = { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: 'p.json', RIPOSTE_ACTION_LEDGER: 'l.jsonl' }
    const first = actionCli(['--hook'], env, io)
    const second = actionCli(['--hook'], env, io)
    const otherSession = actionCli(['--hook'], env, { ...io, stdin: () => hookInput({ session_id: 'sess-2' }) })
    const otherCall = actionCli(['--hook'], env, { ...io, stdin: () => hookInput({ tool_input: { to_account: '110-234-5678', amount: 501 } }) })
    expect([first, second, otherSession, otherCall].map((r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecision)).toEqual(['ask', 'deny', 'ask', 'ask'])
    expect(led.entries().map((e) => e.kind)).toEqual(['action_check', 'action_check', 'action_check', 'action_check'])
    expect(led.verify().ok).toBe(true)
    const h = (led.entries()[0]!.body as { call_hash: string }).call_hash
    expect(countPriorHolds(led.entries(), 'sess-1', h)).toBe(2)
    expect(countPriorHolds(led.entries(), 'sess-3', h)).toBe(0)
  })
})

describe('record and advise SURFACE; nothing else is touched', () => {
  it('advise FAIL → the notice in-flow (additionalContext + systemMessage), no permission decision at all', () => {
    const r = run('advise', WRONG)
    expect(r.decision).toBe('surface')
    const o = out(r)
    expect(o.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(o.hookSpecificOutput.additionalContext).toContain('FAIL')
    expect(o.systemMessage).toBe(o.hookSpecificOutput.additionalContext)
  })
  it('record FAIL → recorded, nothing printed; autonomy PASS and advise PASS → nothing printed', () => {
    for (const [level, allowed] of [['record', WRONG], ['autonomy', GROUNDED], ['advise', GROUNDED], ['record', GROUNDED]] as const) {
      const r = run(level, allowed)
      expect(r.stdout, level).toBe('')
      expect(r.code).toBe(0)
      expect(r.record).toBeDefined()
    }
  })
  it('an undeclared tool: no output, no record', () => {
    const r = run('gate', WRONG, { tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(r).toMatchObject({ code: 0, stdout: '', skipped: 'not a declared action' })
    expect(r.record).toBeUndefined()
  })
  it('Riposte only narrows: across every rung, outcome and permission mode it never says "allow" or "defer"', () => {
    const seen = new Set<string>()
    for (const level of VOICE_LADDER) for (const allowed of [GROUNDED, WRONG, { amount: [500] }, {}]) for (const pm of ['default', 'auto', 'dontAsk', 'bypassPermissions', 'acceptEdits', 'plan']) for (const prior of [0, 1]) {
      const r = run(level, allowed, { permission_mode: pm }, prior)
      const d = r.stdout ? out(r).hookSpecificOutput.permissionDecision : undefined
      seen.add(String(d))
      expect(['ask', 'deny', undefined]).toContain(d)
    }
    expect([...seen].sort()).toEqual(['ask', 'deny', 'undefined'])
  })
})

describe('record-only measures before it enforces', () => {
  it('prints nothing and records what it would have done', () => {
    const r = run('gate', WRONG, {}, 0, 'record-only')
    expect(r).toMatchObject({ code: 0, stdout: '', decision: 'none' })
    expect(r.record).toMatchObject({ mode: 'record-only', decision: 'none', would_decision: 'ask', held: false })
  })
})

describe('it fails open', () => {
  it('bad input: nothing on stdout; a visible non-blocking error (exit 1) when on, silent (exit 0) in record-only; never exit 2', () => {
    const policy = parseActionPolicy(POLICY_JSON('gate', WRONG))
    for (const stdin of ['not json', '[]', JSON.stringify({ hook_event_name: 'PreToolUse' }), JSON.stringify({ tool_name: 'x', tool_input: 'nope' })]) {
      const on = preToolUseHook(stdin, 'on', { policy })
      const ro = preToolUseHook(stdin, 'record-only', { policy })
      expect([on.code, on.stdout, ro.code, ro.stdout]).toEqual([1, '', 0, ''])
      expect(on.stderr).toMatch(/failing open/)
    }
  })
  it('a missing or invalid policy fails open, visibly when on', () => {
    const io: CliIo = { stdin: () => hookInput(), readFile: () => '{"policy_version":"nope","actions":[]}' }
    expect(actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'on' }, io)).toMatchObject({ code: 1, stdout: '' })
    const bad = actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: 'p.json' }, io)
    expect(bad).toMatchObject({ code: 1, stdout: '' })
    expect(bad.stderr).toMatch(/invalid.*failing open/)
    expect(actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'record-only', RIPOSTE_ACTION_POLICY: 'p.json' }, io)).toMatchObject({ code: 0, stdout: '' })
  })
  it('a ledger that cannot be opened does not stop the hold (it falls back to asking)', () => {
    const io: CliIo = { stdin: () => hookInput(), readFile: () => POLICY_JSON('gate', WRONG), openLedger: () => { throw new Error('EACCES') }, now }
    const r = actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: 'p.json', RIPOSTE_ACTION_LEDGER: 'l.jsonl' }, io)
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
    expect(r.stderr).toMatch(/ledger not opened \(EACCES\)/)
  })
  it('a non-PreToolUse event is ignored', () => {
    const r = run('gate', WRONG, { hook_event_name: 'PostToolUse' })
    expect(r).toMatchObject({ code: 0, stdout: '', decision: 'none' })
  })
})

describe('--check and --lint (the bridge the Python adapters use)', () => {
  const io = (stdin: string, policy = POLICY_JSON('gate', WRONG)): CliIo => ({ stdin: () => stdin, readFile: () => policy, now })
  it('--check prints the full check as JSON', () => {
    const r = actionCli(['--check', '--policy', 'p.json'], {}, io(JSON.stringify({ tool: 'mcp__bank__transfer', arguments: { to_account: '110-234-5678', amount: 500 } })))
    expect(r.code).toBe(0)
    const c = JSON.parse(r.stdout)
    expect(c).toMatchObject({ matched: true, disposition: 'hold', workflow: 'mcp__bank__transfer', notice: { action: 'HOLD', level: 'gate' }, delivery: { floor: true, audience: 'solo' } })
    expect(actionCli(['--check', '--policy', 'p.json', '--audience', 'auditor'], {}, io(JSON.stringify({ tool: 'mcp__bank__transfer', arguments: { to_account: '1', amount: 500 } }))).stdout).toContain('RIPOSTE NOTICE')
    expect(JSON.parse(actionCli(['--check', '--policy', 'p.json'], {}, io(JSON.stringify({ tool: 'other', arguments: {} }))).stdout)).toEqual({ matched: false, tool: 'other', disposition: 'pass-through' })
  })
  it('--check refuses malformed input with exit 3', () => {
    expect(actionCli(['--check', '--policy', 'p.json'], {}, io('{"arguments":{}}')).code).toBe(3)
    expect(actionCli(['--check', '--policy', 'p.json'], {}, io('{"tool":"t","arguments":[]}')).code).toBe(3)
    expect(actionCli(['--check', '--policy', 'p.json', '--moment', 'later'], {}, io('{}')).code).toBe(3)
    expect(actionCli(['--check'], {}, io('{}')).code).toBe(3)
    expect(actionCli(['--check', '--lint', '--policy', 'p'], {}, io('{}')).code).toBe(3)
  })
  it('--lint', () => {
    expect(actionCli(['--lint', '--policy', 'p.json'], {}, io('')).code).toBe(0)
    const bad = actionCli(['--lint', '--policy', 'p.json'], {}, io('', '{"policy_version":"riposte-action-policy-v0","actions":[{"tool":"t","level":"up","tier":"low"}]}'))
    expect(bad.code).toBe(1)
    expect(bad.stderr).toMatch(/level must be one of/)
  })
})

describe('D14: action receipts go only where a ledger is named explicitly', () => {
  const NOTE = /^riposte-action: no action ledger \(set RIPOSTE_ACTION_LEDGER or --ledger\): this receipt was recorded to no file/m
  const count = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).length
  const tracked = (stdin = hookInput()) => {
    const opened: string[] = []
    const led = openLedger(memoryStore(), { now })
    const io: CliIo = { stdin: () => stdin, readFile: () => POLICY_JSON('gate', WRONG), openLedger: (p) => { opened.push(p); return led }, now }
    return { io, opened, led }
  }
  const ON = { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: 'p.json' }

  it('an inherited RIPOSTE_LEDGER is never opened; the hold still happens; stderr says so exactly once', () => {
    const { io, opened } = tracked()
    const r = actionCli(['--hook'], { ...ON, RIPOSTE_LEDGER: '/house/claims-ledger.jsonl' }, io)
    expect(opened).toEqual([])
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
    expect(count(r.stderr, NOTE)).toBe(1)
    expect(r.stderr).toMatch(/the loop guard has no memory of earlier holds; RIPOSTE_LEDGER is not used for action receipts\n$/)
  })
  it('with no ledger anywhere: the same single note, without the RIPOSTE_LEDGER clause', () => {
    const { io, opened } = tracked()
    const r = actionCli(['--hook'], ON, io)
    expect(opened).toEqual([])
    expect(count(r.stderr, NOTE)).toBe(1)
    expect(r.stderr).not.toMatch(/RIPOSTE_LEDGER is not used/)
  })
  it('record-only with no ledger: prints nothing on stdout, exit 0, one note', () => {
    const { io } = tracked()
    const r = actionCli(['--hook'], { ...ON, RIPOSTE_ACTION_HOOK: 'record-only', RIPOSTE_LEDGER: 'x.jsonl' }, io)
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(count(r.stderr, NOTE)).toBe(1)
  })
  it('--ledger is used when RIPOSTE_ACTION_LEDGER is unset; RIPOSTE_ACTION_LEDGER wins over --ledger; no note either way', () => {
    const a = tracked()
    const ra = actionCli(['--hook', '--ledger', 'plugin-data/receipts.jsonl'], { ...ON, RIPOSTE_LEDGER: 'house.jsonl' }, a.io)
    expect(a.opened).toEqual(['plugin-data/receipts.jsonl'])
    expect(a.led.entries().map((e) => e.kind)).toEqual(['action_check'])
    expect(ra.stderr).not.toMatch(NOTE)
    const b = tracked()
    actionCli(['--hook', '--ledger', 'plugin-data/receipts.jsonl'], { ...ON, RIPOSTE_ACTION_LEDGER: 'explicit.jsonl', RIPOSTE_LEDGER: 'house.jsonl' }, b.io)
    expect(b.opened).toEqual(['explicit.jsonl'])
  })
  it('an undeclared tool or an off hook says nothing about ledgers', () => {
    const { io } = tracked(hookInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }))
    expect(actionCli(['--hook'], { ...ON, RIPOSTE_LEDGER: 'house.jsonl' }, io)).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(actionCli(['--hook'], { RIPOSTE_LEDGER: 'house.jsonl' }, tracked().io)).toEqual({ code: 0, stdout: '', stderr: '' })
  })

  it('the built bin (the incident path): an inherited RIPOSTE_LEDGER file is never created; RIPOSTE_ACTION_LEDGER is', () => {
    const bin = fileURLToPath(new URL('../bin/riposte-action-hook.mjs', import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), 'riposte-d14-'))
    try {
      const policy = join(dir, 'policy.json')
      writeFileSync(policy, POLICY_JSON('gate', WRONG))
      const house = join(dir, 'house-claims-ledger.jsonl')
      const action = join(dir, 'action-ledger.jsonl')
      // a clean env: nothing RIPOSTE_* leaks in from the shell that runs the tests
      const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
      const run = (env: Record<string, string>) => spawnSync(process.execPath, [bin, '--hook'], { input: hookInput(), env: { ...base, RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: policy, ...env }, encoding: 'utf8' })
      const r1 = run({ RIPOSTE_LEDGER: house })
      expect(r1.status).toBe(0)
      expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
      expect(count(r1.stderr, NOTE)).toBe(1)
      expect(existsSync(house)).toBe(false)
      const r2 = run({ RIPOSTE_LEDGER: house, RIPOSTE_ACTION_LEDGER: action })
      expect(r2.status).toBe(0)
      expect(r2.stderr).not.toMatch(NOTE)
      expect(existsSync(house)).toBe(false)
      const lines = readFileSync(action, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string })
      expect(lines.map((l) => l.kind)).toEqual(['action_check'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
