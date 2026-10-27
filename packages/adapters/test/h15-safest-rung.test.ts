/**
 * 2026-10-05, the policy-error ruling: on a policy or equipment error the action hook fails to the
 * SAFEST rung. Consequential calls are held with a typed denial that names the fix; record-and-advise calls proceed with a
 * `governance degraded` receipt; a doctor verb checks the setup; a loud, logged opt-out restores the old fail-open behaviour;
 * document errors keep their path (claude-code.test.ts pins those, unchanged).
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryStore, openLedger } from 'riposte-ai'
import {
  actionCli, classify, consequentialWord, countPriorHolds, didYouMean, doctor, lintActionPolicy, notOneOf, onErrorFromEnv, preToolUseHook,
  parseActionPolicy, readPolicyLoosely, CONSEQUENTIAL_WORDS, HOOK_ENV_ACCEPT, GOV_EXPECTED_ENV, type CliIo, type DegradedRecord,
} from '../src/index.js'
import { ACCEPT, WORDS } from '../scripts/off-gate.mjs'

const now = () => new Date('2026-10-05T09:00:00Z')
const POLICY = (rules: { tool: string; level: string; tier?: string }[]) => JSON.stringify({
  policy_version: 'riposte-action-policy-v0',
  actions: rules.map((r) => ({ tool: r.tool, level: r.level, tier: r.tier ?? 'severe', set_by: 'controller', sources: { allowed: { to_account: ['110-234-5678'], amount: [500] } } })),
})
const GATE_TRANSFER_ADVISE_NOTE = POLICY([{ tool: 'mcp__bank__transfer', level: 'gate' }, { tool: 'mcp__crm__note', level: 'advise', tier: 'low' }])
const call = (tool: string, input: unknown = { to_account: '110-234-5678', amount: 500 }, over: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: 's-h15', permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'tu-1', ...over })

/** actionCli over an in-memory ledger; `files` maps paths to text (a missing path throws ENOENT, as readFileSync does). */
function hook(env: Record<string, string>, stdin: string, files: Record<string, string> = {}) {
  const ledger = openLedger(memoryStore())
  const io: CliIo = {
    stdin: () => stdin,
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: no such file or directory, open '${p}'`); return files[p]! },
    openLedger: () => ledger, now,
  }
  const r = actionCli(['--hook'], { RIPOSTE_ACTION_LEDGER: 'actions.jsonl', ...env }, io)
  const rows = ledger.entries().map((e) => e.body as DegradedRecord)
  const out = r.stdout ? JSON.parse(r.stdout) : undefined
  return { ...r, rows, decision: out?.hookSpecificOutput?.permissionDecision as string | undefined, reason: out?.hookSpecificOutput?.permissionDecisionReason as string | undefined, out }
}
const ON = { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: 'p.json' }

describe('the class of a call', () => {
  it('a readable rule decides: gate/autonomy consequential, record/advise record-and-advise, an unreadable rung the strictest', () => {
    const full = readPolicyLoosely(POLICY([{ tool: 'a', level: 'gate' }, { tool: 'b', level: 'autonomy' }, { tool: 'c', level: 'advise' }, { tool: 'd', level: 'record' }]), true)
    expect(['a', 'b', 'c', 'd', 'Read'].map((t) => classify(t, full).cls)).toEqual(['consequential', 'consequential', 'record-advise', 'record-advise', 'pass-through'])
    const partial = readPolicyLoosely(POLICY([{ tool: 'mcp__x__go', level: 'gaet' }, { tool: 'mcp__crm__note', level: 'advise' }]))
    expect(partial.readable).toBe('partial')
    expect(classify('mcp__x__go', partial)).toMatchObject({ cls: 'consequential', from: expect.stringContaining('"gaet"') })
    expect(classify('mcp__crm__note', partial).cls).toBe('record-advise')
    // not in a partial policy: the name decides
    expect(classify('mcp__bank__transfer', partial).cls).toBe('consequential')
    expect(classify('Read', partial).cls).toBe('record-advise')
  })
  it('with no readable policy the name decides; an unreadable tool is the strictest unless the policy declares nothing consequential', () => {
    const none = readPolicyLoosely(undefined)
    expect(['mcp__bank__transfer', 'payInvoice', 'mcp__erp__apply_credit', 'submit_filing', 'file_claim', 'Read', 'read_file', 'Bash', 'Edit'].map((t) => classify(t, none).cls))
      .toEqual(['consequential', 'consequential', 'consequential', 'consequential', 'consequential', 'record-advise', 'record-advise', 'record-advise', 'record-advise'])
    expect(consequentialWord('mcp__bank__transfer')).toBe('transfer')
    expect(classify(undefined, none).cls).toBe('consequential')
    expect(classify(undefined, readPolicyLoosely(POLICY([{ tool: 'n', level: 'advise' }]), true)).cls).toBe('record-advise')
    expect(classify(undefined, readPolicyLoosely(GATE_TRANSFER_ADVISE_NOTE, true)).cls).toBe('consequential')
  })
  it('did you mean: the ruling\'s own example, and no guess when nothing is close', () => {
    expect(notOneOf('mode', 'gaet', ['record', 'advise', 'gate'])).toBe("mode 'gaet' is not one of record/advise/gate; did you mean gate?")
    expect(didYouMean('onn', ['off', 'record-only', 'on'])).toBe('on')
    expect(didYouMean('recordonly', ['off', 'record-only', 'on'])).toBe('record-only')
    expect(didYouMean('enforce', ['off', 'record-only', 'on'])).toBeUndefined()
    const lint = lintActionPolicy(JSON.parse(POLICY([{ tool: 't', level: 'gaet' }])))
    expect(lint.errors[0]).toMatch(/level must be one of .*; got 'gaet', did you mean gate\?/)
  })
})

describe('the safest rung, through the CLI (mode on)', () => {
  it('an unreadable policy file: the transfer is DENIED with the typed fix; a Read PROCEEDS with a governance degraded receipt', () => {
    const t = hook(ON, call('mcp__bank__transfer'))
    expect([t.code, t.decision]).toEqual([0, 'deny'])
    expect(t.reason).toMatch(/^Riposte held this mcp__bank__transfer call: governance degraded, policy\.unreadable: the action policy p\.json cannot be read \(ENOENT/)
    expect(t.reason).toContain('Fix: restore p.json, or point RIPOSTE_ACTION_POLICY at the policy file')
    expect(t.reason).toContain('riposte-action --doctor')
    expect(t.out.systemMessage).toMatch(/governance degraded \(policy\.unreadable\)/)
    expect(t.rows).toEqual([expect.objectContaining({ source: 'pre_tool_use', governance: 'degraded', code: 'policy.unreadable', class: 'consequential', decision: 'deny', would_decision: 'deny', held: false, on_error: 'hold', tool: 'mcp__bank__transfer', session_id: 's-h15', tool_use_id: 'tu-1' })])
    expect(t.rows[0]!.call_hash).toMatch(/^[0-9a-f]{64}$/)
    const r = hook(ON, call('Read', { file_path: 'notes.md' }))
    expect([r.code, r.stdout, r.decision]).toEqual([0, '', undefined])
    expect(r.stderr).toMatch(/governance degraded, policy\.unreadable: .*this call proceeds on the record until it is fixed/)
    expect(r.rows).toEqual([expect.objectContaining({ governance: 'degraded', class: 'record-advise', decision: 'none', would_decision: 'none', tool: 'Read' })])
  })
  it('no policy set: policy.missing, same split', () => {
    const t = hook({ RIPOSTE_ACTION_HOOK: 'on' }, call('mcp__bank__transfer'))
    expect(t.decision).toBe('deny')
    expect(t.rows[0]).toMatchObject({ code: 'policy.missing', fix: 'set RIPOSTE_ACTION_POLICY to the action policy file (or set RIPOSTE_ACTION_HOOK=off)' })
    expect(hook({ RIPOSTE_ACTION_HOOK: 'on' }, call('Grep', { pattern: 'x' })).decision).toBeUndefined()
  })
  it('a misspelled rung in the policy: the ruling\'s sentence, and the rule\'s own tool is held even though its name moves nothing', () => {
    const files = { 'p.json': POLICY([{ tool: 'mcp__ops__go', level: 'gaet' }, { tool: 'mcp__crm__note', level: 'advise', tier: 'low' }]) }
    const t = hook(ON, call('mcp__ops__go'), files)
    expect(t.decision).toBe('deny')
    expect(t.reason).toContain("policy.invalid: the action policy p.json is invalid: actions[0] (mcp__ops__go): rung 'gaet' is not one of record/advise/gate/autonomy; did you mean gate?")
    // the advise rule still reads: it proceeds on the record
    const n = hook(ON, call('mcp__crm__note', { text: 'hi' }), files)
    expect([n.decision, n.rows[0]?.class, n.rows[0]?.class_from]).toEqual([undefined, 'record-advise', "the policy's rule for mcp__crm__note sets rung advise"])
  })
  it('a misspelled mode (RIPOSTE_ACTION_HOOK=enforce / onn) is not off: the declared transfer is held; an undeclared tool passes untouched', () => {
    const files = { 'p.json': GATE_TRANSFER_ADVISE_NOTE }
    const e = hook({ RIPOSTE_ACTION_HOOK: 'enforce', RIPOSTE_ACTION_POLICY: 'p.json' }, call('mcp__bank__transfer'), files)
    expect(e.decision).toBe('deny')
    expect(e.reason).toContain("policy.mode_invalid: RIPOSTE_ACTION_HOOK 'enforce' is not one of off/record-only/on.")
    expect(e.rows[0]).toMatchObject({ mode: 'invalid', mode_raw: 'enforce', code: 'policy.mode_invalid', class: 'consequential' })
    const o = hook({ RIPOSTE_ACTION_HOOK: 'onn', RIPOSTE_ACTION_POLICY: 'p.json' }, call('mcp__bank__transfer'), files)
    expect(o.reason).toContain("RIPOSTE_ACTION_HOOK 'onn' is not one of off/record-only/on; did you mean on?")
    const u = hook({ RIPOSTE_ACTION_HOOK: 'enforce', RIPOSTE_ACTION_POLICY: 'p.json' }, call('Bash', { command: 'ls' }), files)
    expect([u.code, u.stdout, u.rows.length]).toEqual([0, '', 0])
    // the advise rule proceeds on the record
    expect(hook({ RIPOSTE_ACTION_HOOK: 'enforce', RIPOSTE_ACTION_POLICY: 'p.json' }, call('mcp__crm__note', { text: 'x' }), files).rows[0]).toMatchObject({ class: 'record-advise', decision: 'none' })
  })
  it('malformed hook input: no tool name → strictest; a declared tool with a non-object input → its rule; stdin unreadable → strictest', () => {
    const files = { 'p.json': GATE_TRANSFER_ADVISE_NOTE }
    expect(hook(ON, '{garbage', files).decision).toBe('deny')
    expect(hook(ON, JSON.stringify({ hook_event_name: 'PreToolUse' }), files).rows[0]).toMatchObject({ code: 'policy.bad_input', class: 'consequential' })
    expect(hook(ON, call('mcp__bank__transfer', 'to_account=999'), files).decision).toBe('deny')
    expect(hook(ON, call('mcp__crm__note', 'text'), files)).toMatchObject({ decision: undefined, rows: [expect.objectContaining({ class: 'record-advise', code: 'policy.bad_input' })] })
    const ledger = openLedger(memoryStore())
    const io: CliIo = { stdin: () => { throw new Error('EPIPE') }, readFile: () => GATE_TRANSFER_ADVISE_NOTE, openLedger: () => ledger, now }
    const r = actionCli(['--hook'], { ...ON, RIPOSTE_ACTION_LEDGER: 'a.jsonl' }, io)
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain('policy.bad_input: the hook input is not a PreToolUse call this hook can read (stdin cannot be read: EPIPE)')
  })
  it('a check that throws is policy.error, held by the rule\'s class', () => {
    const policy = parseActionPolicy(GATE_TRANSFER_ADVISE_NOTE)
    const r = preToolUseHook(call('mcp__bank__transfer'), 'on', { policy, now: () => { throw new Error('clock broke') } })
    expect(r.decision).toBe('deny')
    expect(r.record).toMatchObject({ code: 'policy.error', problem: 'the policy check failed: clock broke', class: 'consequential' })
  })
  it('record-only delivers nothing, and records the would-deny', () => {
    const t = hook({ RIPOSTE_ACTION_HOOK: 'record-only', RIPOSTE_ACTION_POLICY: 'p.json' }, call('mcp__bank__transfer'))
    expect([t.code, t.stdout]).toEqual([0, ''])
    expect(t.stderr).toMatch(/record-only: this call would be held/)
    expect(t.rows[0]).toMatchObject({ mode: 'record-only', decision: 'none', would_decision: 'deny', class: 'consequential' })
  })
  it('a degraded hold is not a hold for a person: the loop guard does not count it, so the healthy check still asks', () => {
    const t = hook(ON, call('mcp__bank__transfer'))
    expect(countPriorHolds(t.rows.map((body) => ({ kind: 'action_check', body })), 's-h15', t.rows[0]!.call_hash!)).toBe(0)
  })
})

describe('the opt-out: RIPOSTE_ACTION_ON_ERROR=open, loud and logged', () => {
  it('restores the old fail-open result (exit 1 when on, nothing on stdout), prints a line saying so, and the receipt names it', () => {
    const t = hook({ ...ON, RIPOSTE_ACTION_ON_ERROR: 'open' }, call('mcp__bank__transfer'))
    expect([t.code, t.stdout]).toEqual([1, ''])
    expect(t.stderr).toMatch(/failing open: nothing is checked/)
    expect(t.stderr).toMatch(/RIPOSTE_ACTION_ON_ERROR=open: failing OPEN on policy\.unreadable, as the operator chose/)
    expect(t.rows[0]).toMatchObject({ on_error: 'open', decision: 'none', would_decision: 'deny', class: 'consequential' })
    const m = hook({ RIPOSTE_ACTION_HOOK: 'enforce', RIPOSTE_ACTION_POLICY: 'p.json', RIPOSTE_ACTION_ON_ERROR: 'OPEN' }, call('mcp__bank__transfer'), { 'p.json': GATE_TRANSFER_ADVISE_NOTE })
    expect([m.code, m.stdout]).toEqual([0, ''])
    expect(m.stderr).toMatch(/staying off/)
    expect(m.rows[0]).toMatchObject({ on_error: 'open', code: 'policy.mode_invalid' })
  })
  it('a misspelled opt-out is reported and read as hold', () => {
    expect(onErrorFromEnv({ RIPOSTE_ACTION_ON_ERROR: 'opne' })).toEqual({ onError: 'hold', problem: "RIPOSTE_ACTION_ON_ERROR 'opne' is not one of hold/open; did you mean open?; reading it as hold (the default)" })
    const t = hook({ ...ON, RIPOSTE_ACTION_ON_ERROR: 'opne' }, call('mcp__bank__transfer'))
    expect(t.decision).toBe('deny')
    expect(t.stderr).toMatch(/did you mean open\?/)
  })
})

describe('the doctor', () => {
  const io = (files: Record<string, string>) => ({ readFile: (p: string) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]! } })
  it('a healthy setup: exit 0, every declared action with what it does normally and on a policy error', () => {
    const r = actionCli(['--doctor'], { ...ON, RIPOSTE_ACTION_LEDGER: 'a.jsonl' }, { stdin: () => '', ...io({ 'p.json': GATE_TRANSFER_ADVISE_NOTE }) })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('mcp__bank__transfer  rung gate, tier severe, consequential')
    expect(r.stdout).toContain('on a policy error: held (deny), the denial names the fix')
    expect(r.stdout).toContain('mcp__crm__note  rung advise, tier low, record-advise')
    expect(r.stdout).toContain('undeclared tools: tools the policy does not declare pass through untouched')
    expect(r.stdout).toMatch(/healthy: the hook will apply the policy as written\n$/)
  })
  it('catches a misspelled mode and a misspelled rung, exits 1, and names each fix', () => {
    const m = doctor({ RIPOSTE_ACTION_HOOK: 'onn', RIPOSTE_ACTION_POLICY: 'p.json' }, io({ 'p.json': GATE_TRANSFER_ADVISE_NOTE }))
    expect(m.healthy).toBe(false)
    expect(m.text).toContain("policy.mode_invalid: RIPOSTE_ACTION_HOOK 'onn' is not one of off/record-only/on; did you mean on?")
    const g = actionCli(['--doctor', '--json'], { ...ON }, { stdin: () => '', ...io({ 'p.json': POLICY([{ tool: 'mcp__bank__pay', level: 'gaet' }]) }) })
    expect(g.code).toBe(1)
    const rep = JSON.parse(g.stdout)
    expect(rep.problems[0].problem).toContain("rung 'gaet' is not one of record/advise/gate/autonomy; did you mean gate?")
    expect(rep.actions[0]).toMatchObject({ tool: 'mcp__bank__pay', class: 'consequential' })
  })
  it('the opt-out and a missing ledger are loud warnings, not failures', () => {
    const d = doctor({ ...ON, RIPOSTE_ACTION_ON_ERROR: 'open' }, io({ 'p.json': GATE_TRANSFER_ADVISE_NOTE }))
    expect(d.healthy).toBe(true)
    expect(d.text).toMatch(/WARNINGS \(2\)/)
    expect(d.text).toContain('RIPOSTE_ACTION_ON_ERROR=open is set: on a policy error the hook FAILS OPEN')
  })
  it('off with no policy is healthy and says what off costs', () => {
    expect(doctor({}, io({}))).toMatchObject({ healthy: true })
    expect(doctor({}, io({})).text).toContain('off: the hook does nothing (one node start per call)')
  })
})

describe('the off-gate and the scrub keep the opt-out; the word lists agree', () => {
  it('ACCEPT carries RIPOSTE_ACTION_ON_ERROR, and the off-gate\'s WORDS are CONSEQUENTIAL_WORDS', () => {
    expect(HOOK_ENV_ACCEPT['claude-code']).toContain('RIPOSTE_ACTION_ON_ERROR')
    expect(ACCEPT).toEqual([...HOOK_ENV_ACCEPT['claude-code'], GOV_EXPECTED_ENV])
    expect(WORDS).toEqual([...CONSEQUENTIAL_WORDS])
  })
})

describe('the built bins (bin/riposte-action-hook.mjs through bin/riposte-action.mjs)', () => {
  const bin = fileURLToPath(new URL('../bin/riposte-action-hook.mjs', import.meta.url))
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
  const spawn = (file: string, env: Record<string, string>, input: string) => spawnSync(process.execPath, [file, '--hook'], { input, env: { ...base, ...env }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const decision = (stdout: string) => { try { return JSON.parse(stdout).hookSpecificOutput?.permissionDecision } catch { return undefined } }
  it('unreadable policy and misspelled mode: the transfer is denied (exit 0), a Read proceeds, each with a receipt; the opt-out logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-h15-'))
    try {
      const ledger = join(dir, 'actions.jsonl')
      const env = { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: join(dir, 'missing.json'), RIPOSTE_ACTION_LEDGER: ledger }
      const t = spawn(bin, env, call('mcp__bank__transfer'))
      expect([t.status, decision(t.stdout)]).toEqual([0, 'deny'])
      const r = spawn(bin, env, call('Read', { file_path: 'x' }))
      expect([r.status, r.stdout]).toEqual([0, ''])
      const policy = join(dir, 'p.json'); writeFileSync(policy, GATE_TRANSFER_ADVISE_NOTE)
      const m = spawn(bin, { RIPOSTE_ACTION_HOOK: 'enforce', RIPOSTE_ACTION_POLICY: policy, RIPOSTE_ACTION_LEDGER: ledger }, call('mcp__bank__transfer'))
      expect([m.status, decision(m.stdout)]).toEqual([0, 'deny'])
      const o = spawn(bin, { ...env, RIPOSTE_ACTION_ON_ERROR: 'open' }, call('mcp__bank__transfer'))
      expect([o.status, o.stdout]).toEqual([1, ''])
      expect(o.stderr).toMatch(/failing OPEN on policy\.unreadable/)
      const rows = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l).body)
      expect(rows.map((b) => [b.code, b.class, b.decision, b.on_error])).toEqual([
        ['policy.unreadable', 'consequential', 'deny', 'hold'], ['policy.unreadable', 'record-advise', 'none', 'hold'],
        ['policy.mode_invalid', 'consequential', 'deny', 'hold'], ['policy.unreadable', 'consequential', 'none', 'open'],
      ])
      // off (unset) is still off: nothing read, nothing written
      const off = spawn(bin, { RIPOSTE_ACTION_POLICY: join(dir, 'missing.json'), RIPOSTE_ACTION_LEDGER: join(dir, 'off.jsonl') }, call('mcp__bank__transfer'))
      expect([off.status, off.stdout, off.stderr, existsSync(join(dir, 'off.jsonl'))]).toEqual([0, '', '', false])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('the engine bundle missing in mode on (no governance): the off-gate itself holds the transfer and lets a Read run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-h15-gate-'))
    try {
      copyFileSync(bin, join(dir, 'riposte-action-hook.mjs')) // the off-gate alone, no engine beside it
      const policy = join(dir, 'p.json'); writeFileSync(policy, GATE_TRANSFER_ADVISE_NOTE)
      const env = { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: policy }
      const t = spawn(join(dir, 'riposte-action-hook.mjs'), env, call('mcp__bank__transfer'))
      expect([t.status, decision(t.stdout)]).toEqual([0, 'deny'])
      expect(JSON.parse(t.stdout).hookSpecificOutput.permissionDecisionReason).toContain('policy.error: the hook engine (riposte-action.mjs) did not load')
      const r = spawn(join(dir, 'riposte-action-hook.mjs'), env, call('Read', { file_path: 'x' }))
      expect([r.status, r.stdout]).toEqual([0, ''])
      expect(r.stderr).toMatch(/this call proceeds/)
      // record-only, or the opt-out: a failed engine fails the way it always did (exit 1, no decision)
      expect(spawn(join(dir, 'riposte-action-hook.mjs'), { ...env, RIPOSTE_ACTION_HOOK: 'record-only' }, call('mcp__bank__transfer'))).toMatchObject({ status: 1, stdout: '' })
      expect(spawn(join(dir, 'riposte-action-hook.mjs'), { ...env, RIPOSTE_ACTION_ON_ERROR: 'open' }, call('mcp__bank__transfer'))).toMatchObject({ status: 1, stdout: '' })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
