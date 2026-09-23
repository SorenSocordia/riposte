/**
 * The Verdict Ledger (Stage 2) — the book of record + the overturn-rate signal. Deterministic given an injected clock.
 */
import { describe, it, expect } from 'vitest'
import { verify, createLedger } from '../src/index'
import { clean, broken, singleLine, FIXED_NOW } from './fixtures/invoices'

const at = (iso: string) => () => new Date(iso)

describe('recording verdicts', () => {
  it('records a verdict with tenant, retention and recorded_at, and populates the verdict ledger field', () => {
    const led = createLedger({ now: at('2026-09-22T00:00:00Z') })
    const v = verify(clean, { now: FIXED_NOW })
    const rec = led.record(v, { tenant_id: 'acme', retention_days: 30 })
    expect(rec.tenant_id).toBe('acme')
    expect(rec.recorded_at).toBe('2026-09-22T00:00:00.000Z')
    expect(rec.retention_until).toBe('2026-10-22T00:00:00.000Z')  // +30 days
    expect(rec.verdict.ledger).toMatchObject({ tenant_id: 'acme', retention_until: '2026-10-22T00:00:00.000Z' })
    expect(led.get(v.verdict_id)?.verdict.outcome).toBe('PASS')
  })

  it('re-recording the same verdict overwrites by verdict_id (one entry per proof)', () => {
    const led = createLedger({ now: at('2026-09-22T00:00:00Z') })
    const v = verify(clean, { now: FIXED_NOW })
    led.record(v, { tenant_id: 'acme' })
    led.record(v, { tenant_id: 'acme' })
    expect(led.all()).toHaveLength(1)
  })
})

describe('human review + the overturn rate', () => {
  const led = createLedger({ now: at('2026-09-22T12:00:00Z') })
  const vClean = verify(clean, { now: FIXED_NOW })       // PASS
  const vBroken = verify(broken, { now: FIXED_NOW })     // FAIL
  const vSingle = verify(singleLine, { now: FIXED_NOW }) // PASS
  led.record(vClean, { tenant_id: 't1' })
  led.record(vBroken, { tenant_id: 't1' })
  led.record(vSingle, { tenant_id: 't1' })

  it('a reviewer decision is recorded and reflected on the verdict ledger field', () => {
    const r = led.review(vBroken.verdict_id, { reviewer_id: 'auditor-7', decision: 'UPHELD', note: 'the tax really is wrong' })
    expect(r.review).toMatchObject({ reviewer_id: 'auditor-7', decision: 'UPHELD', decided_at: '2026-09-22T12:00:00.000Z' })
    expect(r.verdict.ledger?.reviewer).toMatchObject({ id: 'auditor-7', decision: 'UPHELD' })
  })

  it('an overturn is counted; the overturn_rate is overturned / reviewed', () => {
    led.review(vClean.verdict_id, { reviewer_id: 'auditor-7', decision: 'OVERTURNED', note: 'actually a duplicate we knew about' })
    const s = led.stats('t1')
    expect(s.total).toBe(3)
    expect(s.by_outcome).toEqual({ PASS: 2, FAIL: 1, INSUFFICIENT_DATA: 0 })
    expect(s.reviewed).toBe(2)
    expect(s.upheld).toBe(1)
    expect(s.overturned).toBe(1)
    expect(s.overturn_rate).toBe(0.5)
  })

  it('reviewing an unrecorded verdict throws (you cannot review what was never recorded)', () => {
    expect(() => led.review('deadbeef'.repeat(4), { reviewer_id: 'x', decision: 'UPHELD' })).toThrow(/not recorded/)
  })
})

describe('query + export', () => {
  const led = createLedger({ now: at('2026-09-22T00:00:00Z') })
  led.record(verify(clean, { now: FIXED_NOW }), { tenant_id: 'a' })
  led.record(verify(broken, { now: FIXED_NOW }), { tenant_id: 'a' })
  led.record(verify(singleLine, { now: FIXED_NOW }), { tenant_id: 'b' })

  it('filters by tenant and outcome', () => {
    expect(led.query({ tenant_id: 'a' })).toHaveLength(2)
    expect(led.query({ outcome: 'FAIL' })).toHaveLength(1)
    expect(led.query({ tenant_id: 'b', outcome: 'PASS' })).toHaveLength(1)
  })

  it('filters by reviewed state', () => {
    const v = verify(clean, { now: FIXED_NOW })
    expect(led.query({ reviewed: true })).toHaveLength(0)
    led.review(v.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
    expect(led.query({ reviewed: true })).toHaveLength(1)
  })

  it('exports newline-delimited JSON that parses back', () => {
    const lines = led.toJSONL().split('\n')
    expect(lines.length).toBe(led.all().length)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
  })
})
