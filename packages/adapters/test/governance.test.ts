/**
 * Governance at the execution boundary: every host's pre-tool point asks the fleet's checker before a tool call runs,
 * and denies on a refusal and on any error. OFF (nothing changes) unless RIPOSTE_GOV_* configures it. These tests use a
 * stand-in checker (test/fixtures/governance/fake-checker.mjs) and stub runners: the adapters do not depend on the checker's
 * package. The end-to-end run with the real checker is the tabletop (governance tabletop 3).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { canonicalize, generateSigningKeypair, sha256 } from 'riposte-verify'
import { verifyLoopBundle, replayRoundInProcess } from 'riposte-ai'
import {
  GOV_ENV_KEYS, actionCli, apStandIn, callSha256, checkerArgs, checkerEnv, codexStopHook, cursorHook, decideGovernance, decideGovernanceAsync,
  governanceFromEnv, governanceHook, openCodeToolBefore, GovernanceDenied, preToolUseHook, parseActionPolicy, recordGovernance, runLoop, spawnChecker,
  spawnCheckerAsync, type CheckerRun, type CursorJournal,
} from '../src/index.js'
import { GOV_KEYS, writeOffGate } from '../scripts/off-gate.mjs'

const dir = mkdtempSync(join(tmpdir(), 'riposte-gov-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const FAKE = fileURLToPath(new URL('./fixtures/governance/fake-checker.mjs', import.meta.url))
let n = 0
/** A spec file for the fake checker (passed as RIPOSTE_GOV_LEDGER). */
const spec = (mode: string, extra: Record<string, unknown> = {}): string => { const p = join(dir, `spec-${n++}.json`); writeFileSync(p, JSON.stringify({ mode, ...extra })); return p }
const ENV = (mode: string, extra: Record<string, string> = {}): Record<string, string> => ({
  RIPOSTE_GOV_AGENT: 'alpha', RIPOSTE_GOV_CHARTER: 'c'.repeat(64), RIPOSTE_GOV_LEDGER: spec(mode), RIPOSTE_GOV_CHECKER: FAKE,
  RIPOSTE_GOV_RECEIPTS: join(dir, 'receipts.jsonl'), RIPOSTE_GOV_TIMEOUT_MS: '3000', ...extra,
})
const run = (status: number | null, stdout: string, more: Partial<CheckerRun> = {}) => (): CheckerRun => ({ status, stdout, stderr: '', ms: 3, ...more })
const answer = (x: Record<string, unknown>) => `${JSON.stringify(x)}\n`
const writes: { path: string; body: Record<string, unknown> }[] = []
const writer = (path: string, body: Record<string, unknown>) => { writes.push({ path, body }) }
const hookIn = (extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'mcp__bank__transfer', tool_input: { amount: 500 }, tool_use_id: 't1', ...extra })

describe('configuration', () => {
  it('off when no RIPOSTE_GOV_* is set; on with any; a partial configuration names what is missing', () => {
    expect(governanceFromEnv({})).toEqual({ on: false, problems: [] })
    expect(governanceFromEnv({ RIPOSTE_GOV_AGENT: '  ', RIPOSTE_LEDGER: 'x' })).toEqual({ on: false, problems: [] })
    const p = governanceFromEnv({ RIPOSTE_GOV_AGENT: 'alpha', RIPOSTE_GOV_RECEIPTS: 'r.jsonl' })
    expect(p.on).toBe(true)
    expect(p.config).toBeUndefined()
    expect(p.receipts).toBe('r.jsonl')
    expect(p.problems).toEqual(['RIPOSTE_GOV_CHARTER is not set', 'RIPOSTE_GOV_LEDGER is not set', 'RIPOSTE_GOV_CHECKER is not set'])
    const full = governanceFromEnv(ENV('allow', { RIPOSTE_GOV_RECEIPTS: '' }), { receiptsFallback: 'plugin-data/receipts.jsonl' })
    expect(full.config?.receipts).toBe('plugin-data/receipts.jsonl')
    expect(governanceFromEnv(ENV('allow', { RIPOSTE_GOV_RECEIPTS: '' })).problems).toEqual(['no receipts ledger: set RIPOSTE_GOV_RECEIPTS (or give the host its --ledger)'])
    expect(governanceFromEnv(ENV('allow', { RIPOSTE_GOV_TIMEOUT_MS: '5s' })).problems[0]).toMatch(/RIPOSTE_GOV_TIMEOUT_MS/)
    expect(GOV_KEYS).toEqual([...GOV_ENV_KEYS]) // the off-gate hands over on exactly these
  })
  it('the checker gets this agent, the charter, the files and the call; none of the hosts\' RIPOSTE_* settings', () => {
    const cfg = governanceFromEnv(ENV('allow', { RIPOSTE_GOV_INBOX: 'inbox.jsonl', RIPOSTE_GOV_RECORDER_KEY: 'rec.pem' })).config!
    const sha = callSha256('Bash', { command: 'ls' })
    expect(sha).toBe(sha256(canonicalize({ tool: 'Bash', input: { command: 'ls' } })))
    expect(checkerArgs(cfg, 'Bash', sha)).toEqual([FAKE, 'may-act', '--agent', 'alpha', '--charter', 'c'.repeat(64), '--ledger', cfg.ledger, '--inbox', 'inbox.jsonl', '--recorder-key', 'rec.pem', '--tool', 'Bash', '--call-sha256', sha, '--json'])
    expect(Object.keys(checkerEnv({ PATH: 'p', RIPOSTE_LEDGER: 'x', RIPOSTE_GOV_AGENT: 'a', RECEIPTS_KEY: 'k' }))).toEqual(['PATH'])
  })
})

describe('the decision fails closed', () => {
  const gov = governanceFromEnv(ENV('allow'))
  const call = { tool: 'mcp__bank__transfer', input: { amount: 500 } }
  it('ALLOW needs exit 0, an ALLOW answer, and this agent', () => {
    expect(decideGovernance(gov, call, run(0, answer({ decision: 'ALLOW', agent: 'alpha', detail: 'ok' })))).toMatchObject({ decision: 'allow', code: 'ok', agent: 'alpha', call_sha256: callSha256(call.tool, call.input) })
    expect(decideGovernance(gov, call, run(0, answer({ decision: 'ALLOW', agent: 'alpha', go: [{ go_id: 'g1' }] }))).go).toEqual(['g1'])
  })
  it('every other answer denies, with a code', () => {
    const cases: [ReturnType<typeof run>, string][] = [
      [run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'hold.standing', detail: 'held', holds: [{ id: 'h1' }] })), 'hold.standing'],
      [run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'go.required', detail: 'needs a GO' })), 'go.required'],
      [run(null, '', { timedOut: true }), 'governance.checker_timeout'],
      [run(null, '', { error: 'spawn ENOENT' }), 'governance.checker_failed'],
      [run(7, '', { stderr: 'boom' }), 'governance.checker_failed'],
      [run(0, 'not json\n'), 'governance.checker_output'],
      [run(0, answer({ decision: 'ALLOW', agent: 'beta' })), 'governance.checker_output'],
      [run(1, answer({ decision: 'ALLOW', agent: 'alpha' })), 'governance.checker_output'],
      [run(0, answer({ decision: 'MAYBE', agent: 'alpha' })), 'governance.checker_output'],
      [() => { throw new Error('runner blew up') }, 'governance.error'],
    ]
    for (const [r, code] of cases) expect(decideGovernance(gov, call, r).code, code).toBe(code)
    expect(decideGovernance(gov, call, cases[0]![0]).holds).toEqual(['h1'])
    expect(decideGovernance(governanceFromEnv({ RIPOSTE_GOV_AGENT: 'alpha' }), call).code).toBe('governance.config_incomplete')
    expect(decideGovernance(governanceFromEnv(ENV('allow', { RIPOSTE_GOV_CHECKER: join(dir, 'no-such-checker.js') })), call).code).toBe('governance.checker_failed')
    expect(decideGovernance(gov, { tool: '' }).code).toBe('governance.bad_input')
    expect(decideGovernance(gov, { tool: 'X', call_sha256: 'nothex' }).code).toBe('governance.bad_input')
  })
  it('the real spawn: a stand-in checker answers, refuses, crashes, prints garbage, and hangs past the timeout (killed)', async () => {
    const d = (mode: string, extra: Record<string, string> = {}) => decideGovernance(governanceFromEnv(ENV(mode, extra)), call, spawnChecker)
    expect(d('allow').decision).toBe('allow')
    expect(d('refuse').code).toBe('hold.standing')
    expect(d('crash').code).toBe('governance.checker_failed')
    expect(d('garbage').code).toBe('governance.checker_output')
    expect(d('wrong-agent').code).toBe('governance.checker_output')
    expect(d('nonsense').code).toBe('ledger.unreadable')
    const t0 = Date.now()
    const hung = d('sleep', { RIPOSTE_GOV_TIMEOUT_MS: '700' })
    expect([hung.code, Date.now() - t0 < 10_000]).toEqual(['governance.checker_timeout', true])
    const a = await decideGovernanceAsync(governanceFromEnv(ENV('allow-go')), call, spawnCheckerAsync)
    expect([a.decision, a.go]).toEqual(['allow', ['f'.repeat(64)]])
    const ah = await decideGovernanceAsync(governanceFromEnv(ENV('sleep', { RIPOSTE_GOV_TIMEOUT_MS: '700' })), call, spawnCheckerAsync)
    expect(ah.code).toBe('governance.checker_timeout')
  })
  it('no receipt, no action: an ALLOW that cannot be recorded becomes a DENY', () => {
    const v = decideGovernance(gov, call, run(0, answer({ decision: 'ALLOW', agent: 'alpha' })))
    expect(recordGovernance('claude-code', gov, v, undefined).verdict.code).toBe('governance.receipt_unwritten')
    const got: Record<string, unknown>[] = []
    const failing = (_p: string, b: Record<string, unknown>) => { if (b.decision === 'allow') throw new Error('disk full'); got.push(b) }
    const r = recordGovernance('claude-code', gov, v, failing)
    expect([r.verdict.decision, r.verdict.code, got.map((b) => b.code)]).toEqual(['deny', 'governance.receipt_unwritten', ['governance.receipt_unwritten']])
    const ok = recordGovernance('codex', gov, v, writer, { session_id: 's', tool_use_id: 't' })
    expect(ok.receipt).toMatchObject({ source: 'governance', host: 'codex', agent: 'alpha', tool: 'mcp__bank__transfer', decision: 'allow', code: 'ok', session_id: 's', tool_use_id: 't' })
  })
})

describe('Claude Code: governance runs first and fails closed', () => {
  const POLICY = JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'mcp__bank__transfer', level: 'gate', tier: 'severe', set_by: 'controller', sources: { allowed: { amount: [500] } } }] })
  const policy = parseActionPolicy(POLICY)
  it('a refusal denies before the policy check; an ALLOW hands the call to the policy check', () => {
    const govDeny = { gov: governanceFromEnv(ENV('x')), run: run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'hold.standing', detail: 'held' })), writeReceipt: writer }
    const d = preToolUseHook(hookIn(), 'on', { policy, readText: () => '', governance: govDeny })
    expect([d.code, d.decision, d.record]).toEqual([0, 'deny', undefined])
    const out = JSON.parse(d.stdout)
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/hold\.standing/)
    const govAllow = { ...govDeny, run: run(0, answer({ decision: 'ALLOW', agent: 'alpha' })) }
    const a = preToolUseHook(hookIn(), 'on', { policy, readText: () => '', governance: govAllow })
    expect(JSON.parse(a.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
    expect(a.governance?.verdict?.decision).toBe('allow')
    // an undeclared tool: the policy skips it, governance still checked it
    const u = preToolUseHook(hookIn({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'on', { policy, readText: () => '', governance: govDeny })
    expect(u.decision).toBe('deny')
  })
  it('input it cannot read denies; a non-PreToolUse event is skipped', () => {
    const g = { gov: governanceFromEnv(ENV('allow')), writeReceipt: writer }
    expect(governanceHook('not json', g)).toMatchObject({ denied: true, verdict: { code: 'governance.bad_input' } })
    expect(governanceHook(JSON.stringify({ hook_event_name: 'PreToolUse' }), g)).toMatchObject({ denied: true, verdict: { code: 'governance.bad_input' } })
    expect(governanceHook(JSON.stringify({ hook_event_name: 'Stop' }), g)).toMatchObject({ denied: false, stdout: '' })
  })
  it('actionCli: with the action hook off, governance alone; with no RIPOSTE_GOV_*, exactly as before', () => {
    const files: Record<string, string> = { 'policy.json': POLICY }
    const io = (stdin: string) => ({ stdin: () => stdin, readFile: (p: string) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]! }, runChecker: run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'go.required', detail: 'x' })), writeReceipt: writer })
    const off = actionCli(['--hook', '--ledger', 'plugin.jsonl'], ENV('x', { RIPOSTE_GOV_RECEIPTS: '' }), io(hookIn()))
    expect(off.code).toBe(0)
    expect(JSON.parse(off.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(writes[writes.length - 1]).toMatchObject({ path: 'plugin.jsonl', body: { source: 'governance', host: 'claude-code', code: 'go.required' } })
    // a missing policy: governance still runs first and denies on its own refusal
    const noPolicy = actionCli(['--hook'], { ...ENV('x'), RIPOSTE_ACTION_HOOK: 'on' }, io(hookIn()))
    expect([noPolicy.code, JSON.parse(noPolicy.stdout).hookSpecificOutput.permissionDecision]).toEqual([0, 'deny'])
    expect(JSON.parse(noPolicy.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/go\.required/)
    // governance ALLOWS and the policy is missing (2026-10-05): the policy's safest rung holds the transfer itself
    const allowIo = (stdin: string) => ({ ...io(stdin), runChecker: run(0, answer({ decision: 'ALLOW', agent: 'alpha' })) })
    const held = actionCli(['--hook'], { ...ENV('x'), RIPOSTE_ACTION_HOOK: 'on' }, allowIo(hookIn()))
    expect([held.code, JSON.parse(held.stdout).hookSpecificOutput.permissionDecisionReason]).toEqual([0, expect.stringContaining('policy.missing')])
    // no governance: off is exactly as before; a missing policy is now the safest rung (under the opt-out, the old output)
    expect(actionCli(['--hook'], {}, io(hookIn()))).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(JSON.parse(actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'on' }, io(hookIn())).stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    const open = actionCli(['--hook'], { RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_ON_ERROR: 'open' }, io(hookIn()))
    expect([open.code, open.stdout]).toEqual([1, ''])
    expect(open.stderr).toContain('riposte-action --hook: RIPOSTE_ACTION_HOOK=on but no RIPOSTE_ACTION_POLICY is set (failing open: nothing is checked)\n')
  })
})

describe('Codex, Cursor, OpenCode', () => {
  it('Codex PreToolUse: the documented deny on stdout under governance; skipped as before without it; Stop untouched', () => {
    const deps = (env: Record<string, string>) => ({ env, readFile: () => '', runChecker: run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'hold.standing', detail: 'held' })), writeReceipt: writer })
    const r = codexStopHook(hookIn(), deps(ENV('x')))
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/hold\.standing/) } })
    expect(writes[writes.length - 1]!.body).toMatchObject({ host: 'codex', code: 'hold.standing' })
    expect(codexStopHook('garbage', deps(ENV('x'))).stdout).toMatch(/"permissionDecision":"deny"/)
    const before = codexStopHook(hookIn(), deps({}))
    expect([before.code, before.stdout, before.skipped]).toEqual([0, '', 'not a Stop event (PreToolUse)'])
    const stop = codexStopHook(JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }), deps(ENV('x')))
    expect([stop.code, stop.stdout, stop.skipped]).toEqual([0, '', 'this stop was already sent back once'])
  })
  it('Cursor preToolUse: permission deny or allow under governance; {} as before without it', () => {
    const journal: CursorJournal = { read: () => null, append: () => {}, remove: () => {} }
    const deps = (env: Record<string, string>, r: ReturnType<typeof run>) => ({ env, journal, runChecker: r, writeReceipt: writer })
    const input = JSON.stringify({ hook_event_name: 'preToolUse', conversation_id: 'c1', tool_name: 'Shell', tool_input: { command: 'rm -rf build' }, tool_use_id: 'u1' })
    const deny = cursorHook(input, deps(ENV('x'), run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'go.required', detail: 'x' }))))
    expect(JSON.parse(deny.stdout)).toMatchObject({ permission: 'deny', user_message: expect.stringMatching(/go\.required/), agent_message: expect.stringMatching(/Do not retry/) })
    const allow = cursorHook(input, deps(ENV('x'), run(0, answer({ decision: 'ALLOW', agent: 'alpha' }))))
    expect(JSON.parse(allow.stdout)).toEqual({ permission: 'allow' })
    expect(writes[writes.length - 1]!.body).toMatchObject({ host: 'cursor', decision: 'allow', session_id: 'c1', tool_use_id: 'u1' })
    expect(JSON.parse(cursorHook('{bad', deps(ENV('x'), run(0, ''))).stdout).permission).toBe('deny')
    const before = cursorHook(input, deps({}, run(0, '')))
    expect([before.code, before.stdout]).toEqual([0, '{}\n'])
  })
  it('OpenCode tool.execute.before: resolves on ALLOW, throws on a refusal and on a missing receipts ledger', async () => {
    const env = ENV('x')
    await expect(openCodeToolBefore({ tool: 'bash', sessionID: 's', callID: 'c' }, { args: { command: 'ls' } }, { env, run: async () => run(0, answer({ decision: 'ALLOW', agent: 'alpha' }))(), writeReceipt: writer })).resolves.toMatchObject({ decision: 'allow' })
    await expect(openCodeToolBefore({ tool: 'bash' }, { args: {} }, { env, run: async () => run(1, answer({ decision: 'REFUSE', agent: 'alpha', code: 'hold.standing', detail: 'held' }))(), writeReceipt: writer })).rejects.toBeInstanceOf(GovernanceDenied)
    await expect(openCodeToolBefore({ tool: 'bash' }, { args: {} }, { env: { ...env, RIPOSTE_GOV_RECEIPTS: '' }, run: async () => run(0, answer({ decision: 'ALLOW', agent: 'alpha' }))() })).rejects.toThrow(/governance\.config_incomplete/)
    await expect(openCodeToolBefore({}, { args: {} }, { env, writeReceipt: writer })).rejects.toThrow(/governance\.bad_input/)
  })
  it('the OpenCode plugin returns exactly its old hooks without RIPOSTE_GOV_*, and tool.execute.before with it', async () => {
    const plugin = (await import('../src/hosts/opencode-plugin.js')).RipostePlugin
    const client = { session: { messages: async () => ({ data: [] }), promptAsync: async () => ({}) } }
    const saved = { ...process.env }
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith('RIPOSTE_')) delete process.env[k]
      expect(Object.keys(await plugin({ client }))).toEqual(['event'])
      Object.assign(process.env, ENV('refuse'))
      const hooks = await plugin({ client }) as Record<string, (i: unknown, o: unknown) => Promise<void>>
      expect(Object.keys(hooks)).toEqual(['event', 'tool.execute.before'])
      await expect(hooks['tool.execute.before']!({ tool: 'bash', sessionID: 's', callID: 'c' }, { args: { command: 'ls' } })).rejects.toThrow(/hold\.standing/)
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })
})

describe('the loop driver checks before each round', () => {
  const { privateKeyPem, publicKeyPem } = generateSigningKeypair()
  const INVOICE = 'Subject: Example Vendor invoice EV-10001\n\nPlease find our invoice EV-10001 against your order PO-70001:\n\n- 4 x WIDGET BOX @ USD 10.00 = USD 40.00\n- 2 x GADGET @ USD 25.00 = USD 50.00\n\nTotal due: USD 90.00\n'
  const REC = 'PURCHASE ORDER (ERP)\nPO-70001 | Vendor: Example Vendor | Freight: not allowed\n1. Widget box | qty 4 | unit USD 10.00\n2. Gadget | qty 2 | unit USD 25.00\n\nGOODS RECEIPT (ERP) for PO-70001\n1. Widget box | received 4\n2. Gadget | received 2'
  const task = { kind: 'ap-text' as const, item_id: 'EV-10001', input_sha256: createHash('sha256').update(INVOICE, 'utf8').digest('hex') }
  const opts = { signingKey: privateKeyPem, structuredSources: { 'erp:EV-10001': REC } }
  it('a refusal closes the loop HELD-FOR-HUMAN before the round is submitted; the bundle still replays', async () => {
    const seen: string[] = []
    const r = await runLoop(task, apStandIn(INVOICE, { 'EV-10001': REC }), opts, (c) => { seen.push(`${c.tool}#${c.round}:${c.proposal_sha256.slice(0, 8)}`); return { decision: 'deny', code: 'hold.standing', detail: 'held by op-a', agent: 'alpha', tool: c.tool, call_sha256: c.proposal_sha256 } })
    expect(r.closed).toMatchObject({ outcome: 'HELD-FOR-HUMAN', rounds_used: 0 })
    expect(r.closed.reason).toMatch(/governance: hold\.standing/)
    expect(r.rounds).toEqual([{ round: 1, refused: true, governance: 'hold.standing', remedies: 0 }])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^loop\.submit#1:/)
    const v = await verifyLoopBundle(r.bundle, { replayRound: replayRoundInProcess, policy: { publicKey: publicKeyPem, requireSigned: true } })
    expect(v.problems).toEqual([])
  })
  it('an ALLOW every round: the same outcome as without governance; a throwing check denies', async () => {
    let calls = 0
    const allow = await runLoop(task, apStandIn(INVOICE, { 'EV-10001': REC }), opts, (c) => { calls++; return { decision: 'allow', code: 'ok', detail: '', agent: 'alpha', tool: c.tool, call_sha256: c.proposal_sha256 } })
    const plain = await runLoop(task, apStandIn(INVOICE, { 'EV-10001': REC }), opts)
    expect([allow.closed.outcome, allow.closed.rounds_used, calls]).toEqual([plain.closed.outcome, plain.closed.rounds_used, plain.closed.rounds_used])
    const thrown = await runLoop(task, apStandIn(INVOICE, { 'EV-10001': REC }), opts, () => { throw new Error('checker gone') })
    expect(thrown.closed.reason).toMatch(/governance\.error/)
  })
})

describe('the plugin off-gate', () => {
  it('hands over to the engine when a RIPOSTE_GOV_* variable is set, even with the action hook off', () => {
    const bin = join(dir, 'gate')
    mkdirSync(bin, { recursive: true })
    writeOffGate(bin)
    writeFileSync(join(bin, 'riposte-action.mjs'), "process.stdout.write('engine loaded')\n")
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
    const go = (env: Record<string, string>) => spawnSync(process.execPath, [join(bin, 'riposte-action-hook.mjs'), '--hook'], { env: { ...base, ...env }, encoding: 'utf8', windowsHide: true })
    expect(go({}).stdout).toBe('')
    expect(go({ RIPOSTE_ACTION_HOOK: 'off' }).stdout).toBe('')
    expect(go({ RIPOSTE_GOV_AGENT: 'alpha' }).stdout).toBe('engine loaded')
    expect(go({ RIPOSTE_ACTION_HOOK: 'off', RIPOSTE_GOV_LEDGER: 'x' }).stdout).toBe('engine loaded')
    expect(go({ RIPOSTE_GOV_AGENT: '   ' }).stdout).toBe('')
    expect(existsSync(join(bin, 'riposte-action-hook.mjs'))).toBe(true)
    expect(readFileSync(join(bin, 'riposte-action-hook.mjs'), 'utf8')).toMatch(/RIPOSTE_GOV/)
  })
})

