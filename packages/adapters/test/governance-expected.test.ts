/**
 * 2026-10-04: governance cannot be silently absent where it was set up, and a hook does not inherit RIPOSTE_* settings it does
 * not read: the off-gate's engine failure, no RIPOSTE_GOV_* reaching the hook, and an inherited
 * RIPOSTE_LEDGER_UNLOCKED. The no-marker, no-variable path must stay exactly as it was.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actionCli, codexStopHook, cursorHook, openCodeToolBefore, decideGovernance, type CursorJournal } from '../src/index.js'
import {
  GOV_EXPECTED_ENV, GOV_MARKER_FILE, GOV_MARKER_FORMAT, HOOK_ENV_ACCEPT, defaultMarkerPaths, envStrippedSoFar, governanceExpected, governanceFromEnv,
  recordGovernance, scrubHookEnv, unknownGovKeys, writeGovernanceMarker,
} from '../src/governance.js'
import { ACCEPT, writeOffGate } from '../scripts/off-gate.mjs'

const dir = mkdtempSync(join(tmpdir(), 'riposte-gov-expected-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const fresh = (name: string): string => { const d = join(dir, `${name}-${n++}`); mkdirSync(d, { recursive: true }); return d }
const STRIPPED = Symbol.for('riposte.hook.env_stripped')
afterEach(() => { delete (globalThis as Record<symbol, unknown>)[STRIPPED] })
const writes: { path: string; body: Record<string, unknown> }[] = []
const writer = (path: string, body: Record<string, unknown>) => { writes.push({ path, body }) }
const hookIn = () => JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'mcp__bank__transfer', tool_input: { amount: 500 }, tool_use_id: 't1' })
/** a scratch HOME whose ~/.riposte/governance.json names a receipts ledger */
const homeWithMarker = (): { home: string; receipts: string } => {
  const home = fresh('home')
  const receipts = join(home, 'gov-receipts.jsonl')
  writeGovernanceMarker(join(home, '.riposte'), { host: '*', agent: 'alpha', charter: 'c'.repeat(64), receipts })
  return { home, receipts }
}

describe('governance expected: a marker or RIPOSTE_GOV_EXPECTED', () => {
  it('nothing set and no marker: exactly the old answer', () => {
    const none = [join(fresh('none'), GOV_MARKER_FILE)]
    expect(governanceFromEnv({}, { markerPaths: none })).toEqual({ on: false, problems: [] })
    expect(governanceFromEnv({ PATH: 'p', RIPOSTE_LEDGER: 'x', RIPOSTE_HOOK_MODE: 'block' }, { markerPaths: none })).toEqual({ on: false, problems: [] })
    expect(governanceFromEnv({})).toEqual({ on: false, problems: [] }) // the default paths: beside this module (no marker), no HOME in this env
  })
  it('a marker beside the hook entry, no settings: on, missing, denied governance.config_missing, receipts from the marker', () => {
    const d = fresh('beside')
    const m = writeGovernanceMarker(d, { host: 'codex', agent: 'alpha', receipts: 'gov.jsonl' })
    const body = JSON.parse(readFileSync(m, 'utf8'))
    expect(body).toMatchObject({ format: GOV_MARKER_FORMAT, host: 'codex', agent: 'alpha', receipts: 'gov.jsonl' })
    const g = governanceFromEnv({}, { markerPaths: [m] })
    expect(g).toMatchObject({ on: true, missing: true, receipts: join(d, 'gov.jsonl'), expected: { marker: m } })
    expect(g.config).toBeUndefined()
    expect(g.problems[0]).toMatch(/governance is expected here \(the marker .* says governance is set up here\) but no RIPOSTE_GOV_\* setting reached this process/)
    const v = decideGovernance(g, { tool: 'Bash', input: { command: 'ls' } })
    expect(v).toMatchObject({ decision: 'deny', code: 'governance.config_missing' })
    expect(governanceFromEnv({}, { markerPaths: [m], receiptsFallback: 'host.jsonl' }).receipts).toBe('host.jsonl') // the host's own ledger first
  })
  it('RIPOSTE_GOV_EXPECTED: anything but 0, false, no, off', () => {
    const none = [join(fresh('flag'), GOV_MARKER_FILE)]
    for (const x of ['1', 'yes', 'true', 'on', 'please']) expect(governanceFromEnv({ [GOV_EXPECTED_ENV]: x }, { markerPaths: none })).toMatchObject({ on: true, missing: true })
    for (const x of ['', '  ', '0', 'false', 'NO', 'off']) expect(governanceFromEnv({ [GOV_EXPECTED_ENV]: x }, { markerPaths: none })).toEqual({ on: false, problems: [] })
    expect(governanceExpected({ [GOV_EXPECTED_ENV]: '1' }, none)).toEqual({ why: 'RIPOSTE_GOV_EXPECTED=1' })
  })
  it('a marker that cannot be read or parsed still counts', () => {
    const d = fresh('garbage')
    const m = join(d, GOV_MARKER_FILE)
    writeFileSync(m, '{ not json')
    const g = governanceFromEnv({}, { markerPaths: [m] })
    expect(g).toMatchObject({ on: true, missing: true })
    expect(g.receipts).toBeUndefined()
    expect(g.problems[0]).toMatch(/the marker cannot be read .*it still counts/)
    const r = recordGovernance('claude-code', g, decideGovernance(g, { tool: 'Read' }), writer)
    expect(r.verdict.code).toBe('governance.config_missing')
    expect(r.note).toMatch(/no receipts ledger/) // denied, said on stderr: nowhere to write
  })
  it('the user-level marker in ~/.riposte/ (home from HOME, else USERPROFILE)', () => {
    const { home, receipts } = homeWithMarker()
    expect(defaultMarkerPaths({ HOME: home })).toContain(join(home, '.riposte', GOV_MARKER_FILE))
    expect(defaultMarkerPaths({ USERPROFILE: home })).toContain(join(home, '.riposte', GOV_MARKER_FILE))
    expect(governanceFromEnv({ HOME: home })).toMatchObject({ on: true, missing: true, receipts })
    expect(governanceFromEnv({ HOME: fresh('empty-home') })).toEqual({ on: false, problems: [] })
  })
  it('a RIPOSTE_GOV* name that is not a setting turns governance on, incomplete, naming it', () => {
    const none = [join(fresh('unknown'), GOV_MARKER_FILE)]
    const g = governanceFromEnv({ RIPOSTE_GOVERNANCE_AGENT: 'alpha', RIPOSTE_GOVERNANCE_LEDGER: 'l' }, { markerPaths: none, receiptsFallback: 'r.jsonl' })
    expect(g).toMatchObject({ on: true, receipts: 'r.jsonl' })
    expect(g.missing).toBeUndefined()
    expect(g.problems.slice(0, 2)).toEqual([
      'RIPOSTE_GOVERNANCE_AGENT is not a governance setting (the settings are RIPOSTE_GOV_AGENT, RIPOSTE_GOV_CHARTER, RIPOSTE_GOV_LEDGER, RIPOSTE_GOV_CHECKER, RIPOSTE_GOV_INBOX, RIPOSTE_GOV_RECORDER_KEY, RIPOSTE_GOV_RECEIPTS, RIPOSTE_GOV_TIMEOUT_MS)',
      'RIPOSTE_GOVERNANCE_LEDGER is not a governance setting (the settings are RIPOSTE_GOV_AGENT, RIPOSTE_GOV_CHARTER, RIPOSTE_GOV_LEDGER, RIPOSTE_GOV_CHECKER, RIPOSTE_GOV_INBOX, RIPOSTE_GOV_RECORDER_KEY, RIPOSTE_GOV_RECEIPTS, RIPOSTE_GOV_TIMEOUT_MS)',
    ])
    expect(decideGovernance(g, { tool: 'Read' })).toMatchObject({ decision: 'deny', code: 'governance.config_incomplete' })
    expect(unknownGovKeys({ riposte_gov_agent: 'a' })).toEqual(['riposte_gov_agent']) // a plain object does not read it as the setting
    expect(unknownGovKeys({ RIPOSTE_GOV_AGENT: 'a', RIPOSTE_GOV_EXPECTED: '1', RIPOSTE_GOVX: ' ' })).toEqual([])
  })
})

describe('every host denies governance.config_missing when the marker is there and the settings are not', () => {
  it('Claude Code (actionCli), Codex, Cursor and OpenCode', async () => {
    const { home, receipts } = homeWithMarker()
    const env = { HOME: home }
    const cc = actionCli(['--hook', '--ledger', join(home, 'plugin.jsonl')], env, { stdin: () => hookIn(), readFile: () => { throw new Error('no policy') }, writeReceipt: writer })
    expect([cc.code, JSON.parse(cc.stdout).hookSpecificOutput.permissionDecision]).toEqual([0, 'deny'])
    expect(JSON.parse(cc.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/governance\.config_missing/)
    expect(writes.at(-1)).toMatchObject({ path: join(home, 'plugin.jsonl'), body: { source: 'governance', host: 'claude-code', code: 'governance.config_missing' } })
    const cx = codexStopHook(hookIn(), { env, readFile: () => '', writeReceipt: writer })
    expect([cx.code, JSON.parse(cx.stdout).hookSpecificOutput.permissionDecision]).toEqual([0, 'deny'])
    expect(writes.at(-1)).toMatchObject({ path: receipts, body: { host: 'codex', code: 'governance.config_missing' } })
    const journal: CursorJournal = { read: () => null, append: () => {}, remove: () => {} }
    const cu = cursorHook(JSON.stringify({ hook_event_name: 'preToolUse', conversation_id: 'c1', tool_name: 'Shell', tool_input: { command: 'ls' }, tool_use_id: 'u1' }), { env, journal, writeReceipt: writer })
    expect(JSON.parse(cu.stdout)).toMatchObject({ permission: 'deny', user_message: expect.stringMatching(/governance\.config_missing/) })
    expect(writes.at(-1)).toMatchObject({ path: receipts, body: { host: 'cursor', code: 'governance.config_missing' } })
    await expect(openCodeToolBefore({ tool: 'bash', sessionID: 's', callID: 'c' }, { args: { command: 'ls' } }, { env, writeReceipt: writer })).rejects.toThrow(/governance\.config_missing/)
    expect(writes.at(-1)).toMatchObject({ path: receipts, body: { host: 'opencode', code: 'governance.config_missing' } })
    // and with no marker, each host is as it was
    const bare = { HOME: fresh('bare-home') }
    expect(actionCli(['--hook'], bare, { stdin: () => hookIn(), readFile: () => '' })).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(codexStopHook(hookIn(), { env: bare, readFile: () => '' }).stdout).toBe('')
    expect(cursorHook(JSON.stringify({ hook_event_name: 'preToolUse', conversation_id: 'c1', tool_name: 'Shell', tool_input: {} }), { env: bare, journal }).stdout).toBe('{}\n')
  })
})

describe('inherited RIPOSTE_* settings', () => {
  it('scrubHookEnv removes what this host does not read (any case), keeps the rest, returns names only', () => {
    const env: Record<string, string | undefined> = { PATH: 'p', RIPOSTE_LEDGER_UNLOCKED: '1', RIPOSTE_HOOK_MODE: 'block', RIPOSTE_GOV_AGENT: 'a', RIPOSTE_GOVERNANCE_X: 'y', RIPOSTE_GOV_EXPECTED: '1', riposte_state_dir: 's', RIPOSTE_ACTION_HOOK: 'on', RECEIPTS_KEY: 'k' }
    const removed = scrubHookEnv(env, 'claude-code')
    expect(removed).toEqual(['RIPOSTE_HOOK_MODE', 'RIPOSTE_LEDGER_UNLOCKED', 'riposte_state_dir'])
    expect(Object.keys(env).sort()).toEqual(['PATH', 'RECEIPTS_KEY', 'RIPOSTE_ACTION_HOOK', 'RIPOSTE_GOVERNANCE_X', 'RIPOSTE_GOV_AGENT', 'RIPOSTE_GOV_EXPECTED'])
    expect(envStrippedSoFar()).toEqual(['RIPOSTE_HOOK_MODE', 'RIPOSTE_LEDGER_UNLOCKED', 'riposte_state_dir'])
    const cursorEnv: Record<string, string | undefined> = { RIPOSTE_LEDGER_UNLOCKED: '1', RIPOSTE_HOOK_MODE: 'block', riposte_state_dir: 's', RIPOSTE_ACTION_HOOK: 'on' }
    expect(scrubHookEnv(cursorEnv, 'cursor')).toEqual(['RIPOSTE_ACTION_HOOK', 'RIPOSTE_LEDGER_UNLOCKED'])
    expect(Object.keys(cursorEnv).sort()).toEqual(['RIPOSTE_HOOK_MODE', 'riposte_state_dir'])
    expect(ACCEPT).toEqual([...HOOK_ENV_ACCEPT['claude-code'], GOV_EXPECTED_ENV]) // the off-gate keeps exactly these
  })
  it('the names kept for the receipt are stored sorted, whatever order the environment lists them in', () => {
    // Windows hands a process its environment sorted; Linux keeps the order it was set in. The stored list must not depend on it.
    const S = Symbol.for('riposte.hook.env_stripped')
    const g = globalThis as Record<symbol, unknown>
    const before = g[S]
    try {
      delete g[S]
      scrubHookEnv({ RIPOSTE_LEDGER_UNLOCKED: '1', PATH: 'p', RIPOSTE_HOOK_MODE: 'block' }, 'claude-code')
      expect(g[S]).toEqual(['RIPOSTE_HOOK_MODE', 'RIPOSTE_LEDGER_UNLOCKED'])
    } finally { if (before === undefined) delete g[S]; else g[S] = before }
  })
  it('in-host (the OpenCode plugin runs inside OpenCode): only the unlock is removed; every other RIPOSTE_* setting stays', () => {
    const env: Record<string, string | undefined> = { RIPOSTE_LEDGER_UNLOCKED: '1', riposte_ledger_unlocked: '1', RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_AUTHORITIES: 'a.json', RIPOSTE_HOOK_MODE: 'block', RIPOSTE_GOV_AGENT: 'a', PATH: 'p' }
    expect(scrubHookEnv(env, 'opencode')).toEqual(['RIPOSTE_LEDGER_UNLOCKED', 'riposte_ledger_unlocked'])
    expect(Object.keys(env).sort()).toEqual(['PATH', 'RIPOSTE_ACTION_HOOK', 'RIPOSTE_AUTHORITIES', 'RIPOSTE_GOV_AGENT', 'RIPOSTE_HOOK_MODE'])
    expect(scrubHookEnv({ RIPOSTE_ACTION_HOOK: 'on' }, 'opencode')).toEqual([])
  })
  it('the adapters index re-exports the new helpers', async () => {
    const idx = await import('../src/index.js') as Record<string, unknown>
    for (const k of ['writeGovernanceMarker', 'governanceExpected', 'defaultMarkerPaths', 'unknownGovKeys', 'scrubHookEnv', 'envStrippedSoFar', 'GOV_EXPECTED_ENV', 'GOV_MARKER_FILE', 'GOV_MARKER_FORMAT', 'HOOK_ENV_ACCEPT', 'IN_HOST_HOOKS', 'IN_HOST_STRIP']) expect(idx[k], k).toBeDefined()
    expect(idx.scrubHookEnv).toBe(scrubHookEnv)
  })
  it('governance receipts name what the hook removed (env_stripped), names only', () => {
    const g = governanceFromEnv({ RIPOSTE_GOV_AGENT: 'alpha' }, { markerPaths: [], receiptsFallback: 'r.jsonl', envStripped: ['RIPOSTE_LEDGER_UNLOCKED'] })
    const r = recordGovernance('claude-code', g, decideGovernance(g, { tool: 'Read' }), writer)
    expect(r.receipt).toMatchObject({ code: 'governance.config_incomplete', env_stripped: ['RIPOSTE_LEDGER_UNLOCKED'] })
    const quiet = governanceFromEnv({ RIPOSTE_GOV_AGENT: 'alpha' }, { markerPaths: [], receiptsFallback: 'r.jsonl', envStripped: [] })
    expect(recordGovernance('claude-code', quiet, decideGovernance(quiet, { tool: 'Read' }), writer).receipt).not.toHaveProperty('env_stripped')
  })
})

describe('the off-gate', () => {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
  const gate = (engine?: string): string => {
    const bin = fresh('gate')
    writeOffGate(bin)
    if (engine !== undefined) writeFileSync(join(bin, 'riposte-action.mjs'), engine)
    return bin
  }
  const go = (bin: string, env: Record<string, string>, home = fresh('gate-home')) => spawnSync(process.execPath, [join(bin, 'riposte-action-hook.mjs'), '--hook'], { env: { ...base, HOME: home, USERPROFILE: home, ...env }, encoding: 'utf8', windowsHide: true, input: hookIn() })
  const LOADED = "process.stdout.write('engine loaded')\n"
  it('hands over when governance is expected: a marker beside it, a marker in ~/.riposte, RIPOSTE_GOV_EXPECTED, an unknown RIPOSTE_GOV* name', () => {
    const bin = gate(LOADED)
    expect(go(bin, {}).stdout).toBe('')
    expect(go(bin, { RIPOSTE_GOV_EXPECTED: '1' }).stdout).toBe('engine loaded')
    expect(go(bin, { RIPOSTE_GOV_EXPECTED: 'off' }).stdout).toBe('')
    expect(go(bin, { RIPOSTE_GOVERNANCE_AGENT: 'alpha' }).stdout).toBe('engine loaded')
    expect(go(bin, {}, homeWithMarker().home).stdout).toBe('engine loaded')
    const beside = gate(LOADED)
    writeGovernanceMarker(beside, { host: 'claude-code' })
    expect(go(beside, {}).stdout).toBe('engine loaded')
  })
  it('removes RIPOSTE_* settings the hook does not read before the engine runs, keeps the names, says so for the unlock', () => {
    const bin = gate("process.stdout.write(JSON.stringify({ unlocked: process.env.RIPOSTE_LEDGER_UNLOCKED ?? null, mode: process.env.RIPOSTE_HOOK_MODE ?? null, gov: process.env.RIPOSTE_GOV_AGENT ?? null, policy: process.env.RIPOSTE_ACTION_POLICY ?? null, stripped: globalThis[Symbol.for('riposte.hook.env_stripped')] ?? [] }))\n")
    const r = go(bin, { RIPOSTE_GOV_AGENT: 'alpha', RIPOSTE_LEDGER_UNLOCKED: '1', RIPOSTE_HOOK_MODE: 'block', RIPOSTE_ACTION_POLICY: 'p.json' })
    expect(JSON.parse(r.stdout)).toEqual({ unlocked: null, mode: null, gov: 'alpha', policy: 'p.json', stripped: ['RIPOSTE_HOOK_MODE', 'RIPOSTE_LEDGER_UNLOCKED'] })
    expect(r.stderr).toMatch(/an inherited RIPOSTE_LEDGER_UNLOCKED was ignored; the receipts ledger keeps its single-writer lock/)
    const off = go(bin, { RIPOSTE_LEDGER_UNLOCKED: '1' })
    expect([off.status, off.stdout, off.stderr]).toEqual([0, '', '']) // off stays silent
  })
  it('engine missing or throwing with governance on or expected: the deny JSON on stdout, the reason on stderr, exit 2', () => {
    const missing = gate()
    const r = go(missing, { RIPOSTE_GOV_AGENT: 'alpha' })
    expect(r.status).toBe(2)
    const out = JSON.parse(r.stdout)
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/governance\.engine_unavailable/) })
    expect(r.stderr).toMatch(/governance\.engine_unavailable/)
    const throwing = gate("throw new Error('engine broke')\n")
    writeGovernanceMarker(throwing, {})
    const t = go(throwing, {})
    expect([t.status, JSON.parse(t.stdout).hookSpecificOutput.permissionDecision]).toEqual([2, 'deny'])
    expect(t.stderr).toMatch(/engine broke/)
    // without governance (2026-10-05): in record-only, or under the opt-out RIPOSTE_ACTION_ON_ERROR=open, the old
    // failure (a non-blocking error, nothing on stdout); in mode on the off-gate applies the safest rung itself
    // (test/h15-safest-rung.test.ts holds the consequential/record split on the real bin)
    for (const env of [{ RIPOSTE_ACTION_HOOK: 'record-only' }, { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_ON_ERROR: 'open' }]) {
      const old = go(missing, env)
      expect(old.status).toBe(1)
      expect(old.stdout).toBe('')
      expect(old.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/)
    }
    const held = go(missing, { RIPOSTE_ACTION_HOOK: 'on' })
    expect(held.status).toBe(0)
    expect(held.stderr).toMatch(/governance degraded, policy.error: the hook engine/)
  })
})
