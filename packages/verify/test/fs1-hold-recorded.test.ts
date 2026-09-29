/**
 * FS1 (security-review finding, fixed 2026-09-28): the hosted tier held a partially grounded action but recorded
 * nothing, because the HTTP door recomputed ANY_FAIL_FAILS exactly and refused verifyAction's legitimate INSUFFICIENT_DATA.
 * The audit trail then lost exactly the holds (reconciliation would read held-then-paid as BYPASSED, not PAID DESPITE HOLD).
 */
import { describe, it, expect } from 'vitest'
import { createLedger } from '../src/index'
import { createService, apiKeyAuth, type UnrecordedEvent } from '../src/http/service'
import type { ActionCheckSurface } from '../src/http/surfaces'

const NOW = () => new Date('2026-09-28T10:00:00Z')
const WIRE = { tool: 'wire_transfer', arguments: { amount: 500, to_account: '110-234-5678' } }
// the amount is allow-listed; the account number has no declared source
const PARTIAL = { action: WIRE, sources: { allowed: { amount: [500] } } }

describe('a held, partially grounded action is on the book of record (FS1)', () => {
  it('POST /v1/action/check at gate: HOLD, and the verdict is recorded (nothing reported unrecorded)', () => {
    const ledger = createLedger({ now: NOW })
    const unrecorded: UnrecordedEvent[] = []
    const svc = createService({ ledger, authenticate: apiKeyAuth({ ka: 'acme' }), onUnrecorded: (e: UnrecordedEvent) => { unrecorded.push(e) } } as Parameters<typeof createService>[0])
    const r = svc.handle({ method: 'POST', path: '/v1/action/check', body: { ...PARTIAL, level: 'gate' }, headers: { 'x-api-key': 'ka' } })
    expect(r.status).toBe(200)
    const s = r.json as ActionCheckSurface
    expect(s.verdict.outcome).toBe('INSUFFICIENT_DATA')
    expect(s.disposition).toBe('hold')
    const rec = ledger.get(s.verdict.verdict_id)
    expect(rec?.verdict.outcome).toBe('INSUFFICIENT_DATA')
    expect(rec?.tenant_id).toBe('acme')
    expect(unrecorded).toEqual([])
  })
})
