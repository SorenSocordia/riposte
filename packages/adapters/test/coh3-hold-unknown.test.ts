/**
 * 2026-10-04: the hold guard (src/hold.ts, bundled into every bin) turned a
 * verdict outcome outside PASS / INSUFFICIENT_DATA / FAIL into SURFACE at the gate rung, so the call ran. It now holds at every
 * rung, and the guard text (which goes on the action_check receipt) names the outcome. The last case wraps verify's
 * verifyAction to return such an outcome, so it runs through checkAction as the hook does.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'

const ctl = vi.hoisted(() => ({ outcome: undefined as string | undefined }))
// by path, not by package name: the path is the same in this workshop and in the published tree (where the package is
// riposte-verify), and it is the module the 'verify' alias loads, so the mock applies to the code under test either way
vi.mock('../../verify/src/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../verify/src/index.ts')>()
  return { ...real, verifyAction: ((...a: Parameters<typeof real.verifyAction>) => { const v = real.verifyAction(...a); return ctl.outcome ? { ...v, outcome: ctl.outcome } : v }) as typeof real.verifyAction }
})
const { actionNotice, verifyAction } = await import('../../verify/src/index.ts')
const { checkAction, dispositionOf, guardNotice, parseActionPolicy } = await import('../src/index.js')
afterEach(() => { ctl.outcome = undefined })

const transfer = { tool: 'mcp__bank__transfer', arguments: { to_account: '999', amount: 1, currency: 'USD' } }
const sources = { allowed: { to_account: ['111'] }, require: ['to_account'] }

describe('fail closed: an outcome outside the three holds', () => {
  it('outcome "OPEN" with a PASS / PROCEED notice at gate → hold (it was surface); the real FAIL still holds', () => {
    const v = verifyAction(transfer, sources)
    const n = actionNotice(v, 'gate')
    expect(dispositionOf(guardNotice(v, n).notice)).toBe('hold')
    const odd = guardNotice({ ...v, outcome: 'OPEN' } as never, { ...n, outcome: 'PASS', action: 'PROCEED' } as never)
    expect(dispositionOf(odd.notice)).toBe('hold')
    expect(odd.guard).toMatch(/the verdict reads "OPEN".*held at every rung, so this action is HOLD at rung gate/)
  })

  it('holds at every rung, for an unknown outcome on the verdict or on the notice, and for an unknown action', () => {
    const v = verifyAction(transfer, sources)
    for (const level of ['record', 'advise', 'gate', 'autonomy'] as const) {
      const n = actionNotice(v, level)
      expect(dispositionOf(guardNotice({ ...v, outcome: 'SOMETHING_NEW' } as never, n).notice), level).toBe('hold')
      expect(dispositionOf(guardNotice(v, { ...n, outcome: 'SOMETHING_NEW' } as never).notice), level).toBe('hold')
    }
    expect(dispositionOf({ ...actionNotice(v, 'record'), action: 'WAVE_THROUGH' } as never)).toBe('hold')
  })

  it('through checkAction (the hook\'s path): disposition hold, and the guard that goes on the receipt names the outcome', () => {
    const policy = parseActionPolicy(JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'mcp__bank__transfer', level: 'advise', tier: 'severe', set_by: 'controller', sources }] }))
    const before = checkAction(policy, transfer)
    expect(before.matched && before.disposition).toBe('surface') // a real FAIL at advise is surfaced, not held: unchanged
    ctl.outcome = 'OPEN'
    const r = checkAction(policy, transfer)
    expect(r.matched && r.disposition).toBe('hold')
    expect(r.matched && r.guard).toMatch(/the verdict reads "OPEN"/)
  })
})
