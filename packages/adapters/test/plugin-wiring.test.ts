/**
 * The Claude Code plugin's hooks.json (plugins/riposte/hooks/hooks.json) registers the action
 * hook. These tests hold the staged wiring to its promises: the Stop hook is byte-for-byte what it was, the action hook is
 * narrow (MCP tools only), it is OFF unless RIPOSTE_ACTION_HOOK says otherwise (and then the engine never loads), and when
 * on it records only to the plugin's own ledger.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS = fileURLToPath(new URL('../../../plugins/riposte/hooks/hooks.json', import.meta.url))
const BIN = fileURLToPath(new URL('../bin/', import.meta.url))
const raw = readFileSync(HOOKS, 'utf8')
const hooks = JSON.parse(raw) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]> }

// The Stop entry exactly as the plugin shipped it (2026-09-23), bytes included.
const STOP_BYTES = `{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \\"\${CLAUDE_PLUGIN_ROOT}/bin/riposte-claims.mjs\\" --hook --from-env --ledger \\"\${CLAUDE_PLUGIN_DATA}/receipts.jsonl\\"",
            "timeout": 15
          }
        ]
      }
    ]`
const ACTION_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/riposte-action-hook.mjs" --hook --ledger "${CLAUDE_PLUGIN_DATA}/receipts.jsonl"'

describe('the plugin hooks.json', () => {
  it('keeps the Stop hook byte-identical', () => {
    expect(raw.startsWith(STOP_BYTES)).toBe(true)
    expect(hooks.hooks.Stop).toHaveLength(1)
  })
  it('registers the action hook on MCP tools only, pointing at the off-gate, with the plugin ledger named explicitly', () => {
    expect(Object.keys(hooks.hooks).sort()).toEqual(['PreToolUse', 'Stop'])
    const pre = hooks.hooks.PreToolUse!
    expect(pre).toHaveLength(1)
    expect(pre[0]!.matcher).toBe('mcp__.*')
    expect(pre[0]!.hooks).toEqual([{ type: 'command', command: ACTION_COMMAND, timeout: 15 }])
    const m = new RegExp(pre[0]!.matcher!)
    for (const t of ['mcp__bank__transfer', 'mcp__plugin_riposte_riposte__ap_gate']) expect(m.test(t), t).toBe(true)
    for (const t of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'Task']) expect(m.test(t), t).toBe(false)
  })
})

describe('the registered command, run the way the plugin runs it', () => {
  // ${CLAUDE_PLUGIN_ROOT}/bin gets the built files; ${CLAUDE_PLUGIN_DATA} is a scratch dir. No RIPOSTE_* from this shell.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
  const input = JSON.stringify({
    session_id: 's-plugin', transcript_path: '/t.jsonl', cwd: '/w', permission_mode: 'default', hook_event_name: 'PreToolUse',
    tool_name: 'mcp__bank__transfer', tool_input: { to_account: '110-234-5678', amount: 500 }, tool_use_id: 'toolu_p1',
  })
  const setup = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-plugin-'))
    const root = join(dir, 'plugin'), data = join(dir, 'data')
    mkdirSync(join(root, 'bin'), { recursive: true }); mkdirSync(data)
    for (const f of files) copyFileSync(join(BIN, f), join(root, 'bin', f))
    const [, script, ...rest] = ACTION_COMMAND.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('${CLAUDE_PLUGIN_DATA}', data).match(/^node "([^"]+)" (--hook) --ledger "([^"]+)"$/)!
    return { dir, data, run: (env: Record<string, string>) => spawnSync(process.execPath, [script!, rest[0]!, '--ledger', rest[1]!], { input, env: { ...base, ...env }, encoding: 'utf8' }) }
  }

  it('OFF by default: with RIPOSTE_ACTION_HOOK unset the gate returns before the engine loads (the engine is not even there)', () => {
    const s = setup(['riposte-action-hook.mjs']) // only the gate: importing the engine would crash
    try {
      for (const env of [{}, { RIPOSTE_ACTION_HOOK: 'off' }, { RIPOSTE_ACTION_HOOK: '' }]) {
        const r = s.run(env)
        expect([r.status, r.stdout, r.stderr]).toEqual([0, '', ''])
      }
      expect(existsSync(join(s.data, 'receipts.jsonl'))).toBe(false)
      const odd = s.run({ RIPOSTE_ACTION_HOOK: 'enforce' })
      expect([odd.status, odd.stdout]).toEqual([0, ''])
      expect(odd.stderr).toMatch(/staying off/)
    } finally { rmSync(s.dir, { recursive: true, force: true }) }
  })

  it('on: a gate hold asks, and the receipt lands in the plugin ledger, never in an inherited RIPOSTE_LEDGER', () => {
    const s = setup(['riposte-action-hook.mjs', 'riposte-action.mjs'])
    try {
      const policy = join(s.dir, 'policy.json')
      writeFileSync(policy, JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'mcp__bank__transfer', level: 'gate', tier: 'severe', set_by: 'controller', sources: { allowed: { amount: [500] } } }] }))
      const house = join(s.dir, 'house-claims-ledger.jsonl')
      const r = s.run({ RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: policy, RIPOSTE_LEDGER: house })
      expect(r.status).toBe(0)
      expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('ask')
      expect(existsSync(house)).toBe(false)
      const kinds = readFileSync(join(s.data, 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { kind: string }).kind)
      expect(kinds).toEqual(['action_check'])
    } finally { rmSync(s.dir, { recursive: true, force: true }) }
  })
})
