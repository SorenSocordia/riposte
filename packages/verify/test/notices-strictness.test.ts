/**
 * A notice is never softer than its verdict (fixed 2026-09-28). A partially grounded
 * action — the amount allow-listed, the account number with no declared source — is INSUFFICIENT_DATA by
 * `verifyAction` ("execute only when every value is grounded"). It must not read PASS / PROCEED at any rung.
 * Also: a boolean rule bit is never rendered as "expected false".
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, actionNotice, verdictFindings, renderFindings } from '../src/index'

const now = () => new Date('2026-09-28T09:00:00Z')
const transfer = { tool: 'mcp__bank__transfer', arguments: { to_account: '110-234-5678', amount: 500 } }

describe('a notice is never softer than its verdict', () => {
  const partial = verifyAction(transfer, { allowed: { amount: [500] } }, { now })
  it('the producer says INSUFFICIENT_DATA, and so does the notice, at every rung', () => {
    expect(partial.outcome).toBe('INSUFFICIENT_DATA')
    expect(verdictFindings(partial).outcome).toBe('INSUFFICIENT_DATA')
    for (const level of ['record', 'advise', 'gate', 'autonomy'] as const) {
      const n = actionNotice(partial, level)
      expect(n.outcome).toBe('INSUFFICIENT_DATA')
      expect(n.action).not.toBe('PROCEED')
    }
    expect(actionNotice(partial, 'autonomy').action).toBe('HOLD')
    expect(actionNotice(partial, 'gate').action).toBe('HOLD')
  })
  it('a fully grounded action still proceeds, and a wrong one still FAILs', () => {
    const ok = verifyAction(transfer, { allowed: { to_account: ['110-234-5678'], amount: [500] } }, { now })
    expect(ok.outcome).toBe('PASS')
    expect(actionNotice(ok, 'autonomy').action).toBe('PROCEED')
    const wrong = verifyAction(transfer, { allowed: { to_account: ['220-000-1111'], amount: [500] } }, { now })
    expect(wrong.outcome).toBe('FAIL')
    expect(actionNotice(wrong, 'autonomy').action).toBe('HOLD')
  })
  it('for every all-deterministic verdict, the notice outcome IS the verdict outcome', () => {
    for (const allowed of [{ amount: [500] }, { to_account: ['110-234-5678'], amount: [500] }, { to_account: ['x'], amount: [1] }, {}]) {
      const v = verifyAction(transfer, { allowed }, { now })
      expect(verdictFindings(v).outcome).toBe(v.outcome)
    }
  })
})

describe('boolean rule bits are not rendered as "expected"', () => {
  it('a grounding miss never reads "expected false"', () => {
    const wrong = verifyAction(transfer, { allowed: { to_account: ['220-000-1111'], amount: [500] } }, { now })
    const text = renderFindings(verdictFindings(wrong)).join('\n')
    expect(text).not.toMatch(/expected (true|false)/)
  })
})
