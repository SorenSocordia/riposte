/**
 * Record-bound allow-lists in the action policy (`sources.records`, 2026-09-29): an action is grounded only when its
 * record-named arguments all equal ONE approved record, so an amount approved for one invoice paid to another invoice's
 * account is held. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAction, lintActionPolicy, parseActionPolicy, type ActionCheck } from '../src/index.js'

const now = () => new Date('2026-09-29T12:00:00Z')
const INVOICE_A = { amount: 500, to_account: '220-000-1111' }
const INVOICE_B = { amount: 900, to_account: '330-000-2222' }
const POLICY = (level: string, records: unknown = [INVOICE_A, INVOICE_B]) => JSON.stringify({
  policy_version: 'riposte-action-policy-v0',
  actions: [{ tool: 'mcp__bank__pay_invoice', level, tier: 'severe', set_by: 'controller', sources: { records } }],
})
const pay = (args: Record<string, unknown>) => ({ tool: 'mcp__bank__pay_invoice', arguments: args })
const MIXED = { amount: 500, to_account: '330-000-2222' } // A's amount, B's account
const check = (level: string, args: Record<string, unknown>) => checkAction(parseActionPolicy(POLICY(level)), pay(args), { now }) as ActionCheck

describe('the policy declares records', () => {
  it('accepts approved records and refuses ones it cannot use: empty, an empty record, a non-scalar value, different arguments', () => {
    expect(lintActionPolicy(JSON.parse(POLICY('gate'))).ok).toBe(true)
    for (const [records, msg] of [
      [[], /records must be a non-empty array/],
      [[{}], /records \[0\] must be a non-empty object/],
      [[{ amount: { value: 500 } }], /records \[0\]\.amount must be a string or a number/],
      [[INVOICE_A, { amount: 900 }], /records \[1\] names amount, but \[0\] names amount, to_account: every record must name the same arguments/],
    ] as const) {
      const lint = lintActionPolicy(JSON.parse(POLICY('gate', records)))
      expect(lint.ok).toBe(false)
      expect(lint.errors.join('\n')).toMatch(msg)
    }
  })
})

describe('checkAction holds the mix-and-match', () => {
  it('at gate: the mix-and-match is held (FAIL), the correct tuple goes to review, a partial tuple is held (INSUFFICIENT_DATA)', () => {
    expect([check('gate', MIXED).disposition, check('gate', MIXED).verdict.outcome]).toEqual(['hold', 'FAIL'])
    expect([check('gate', INVOICE_B).disposition, check('gate', INVOICE_B).verdict.outcome]).toEqual(['review', 'PASS'])
    expect([check('gate', { amount: 500 }).disposition, check('gate', { amount: 500 }).verdict.outcome]).toEqual(['hold', 'INSUFFICIENT_DATA'])
  })
  it('at autonomy the correct tuple proceeds and the mix-and-match does not', () => {
    expect(check('autonomy', INVOICE_A).disposition).toBe('proceed')
    expect(check('autonomy', MIXED).disposition).toBe('hold')
  })
  it('the notice names the record-bound rule and the closest record', () => {
    const c = check('gate', MIXED)
    expect(c.notice.findings.map((f) => f.rule_id)).toEqual(['GROUNDED_RECORD', 'GROUNDED_RECORD'])
    expect(c.notice.findings[0]!.explanation).toMatch(/Closest approved record: records\[0\]/)
  })
})

describe('the built bin carries records (the path the hosts run)', () => {
  it('holds the mix-and-match and lets the correct tuple through to review', () => {
    const bin = fileURLToPath(new URL('../bin/riposte-action-hook.mjs', import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), 'riposte-records-'))
    try {
      const policy = join(dir, 'policy.json')
      writeFileSync(policy, POLICY('gate'))
      const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_')))
      const run = (tool_input: Record<string, unknown>) => spawnSync(process.execPath, [bin, '--hook'], {
        input: JSON.stringify({ session_id: 's', transcript_path: '/t.jsonl', cwd: '/w', permission_mode: 'default', hook_event_name: 'PreToolUse', tool_name: 'mcp__bank__pay_invoice', tool_input, tool_use_id: 'toolu_01' }),
        env: { ...base, RIPOSTE_ACTION_HOOK: 'on', RIPOSTE_ACTION_POLICY: policy }, encoding: 'utf8',
      })
      const held = run(MIXED)
      expect(held.status).toBe(0)
      const reason = JSON.parse(held.stdout).hookSpecificOutput.permissionDecisionReason as string
      expect(reason).toContain('Held for a person: tool mcp__bank__pay_invoice, outcome FAIL')
      expect(reason).toContain('No approved record carries amount = 500, to_account = "330-000-2222" together')
      const ok = run(INVOICE_B)
      expect(ok.status).toBe(0)
      expect(JSON.parse(ok.stdout).hookSpecificOutput.permissionDecisionReason).not.toContain('outcome FAIL')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
