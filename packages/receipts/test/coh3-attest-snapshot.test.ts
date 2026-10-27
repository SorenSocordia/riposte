/**
 * 2026-10-04: RT1 F11, the attest snapshot. A declaration on an undated id ("gpt-4.1") matched ANY dated suffix, a fake
 * or future one included. A snapshot must now name a real calendar date no later than its reply; the resolved snapshot is
 * recorded as evidence; a change of snapshot under one declaration is named. Model ids here are illustrative strings.
 */
import { describe, it, expect } from 'vitest'
import { attestModels, eventsFromReplies, modelGate, modelMatches, snapshotDate, snapshotProblem } from '../src/index.js'

describe('dated snapshots must be real and not later than the reply', () => {
  it('B4.1/B4.2: real past dates match; a non-date, an impossible day and a future date do not', () => {
    expect(modelMatches('gpt-4.1', 'gpt-4.1-2025-04-14')).toBe(true)
    expect(modelMatches('gpt-4.1', 'gpt-4.1-2099-99-99')).toBe(false)
    expect(modelMatches('gpt-4.1', 'gpt-4.1-2025-02-30')).toBe(false)
    expect(modelMatches('claude-opus-5-5', 'claude-opus-5-5-20991231')).toBe(false)
    expect(modelMatches('m', 'm-20240229')).toBe(true)
    expect(modelMatches('m', 'm-20230229')).toBe(false)
    expect(modelMatches('model-a', 'model-a')).toBe(true)
    expect(modelMatches('gpt-4.1-2025-04-14', 'gpt-4.1-2025-08-06')).toBe(false)
    // judged against the reply's own time
    expect(modelMatches('m', 'm-2025-08-06', '2025-08-05T23:00:00Z')).toBe(false)
    expect(modelMatches('m', 'm-2025-08-06', '2025-08-06T00:00:01Z')).toBe(true)
    expect(snapshotDate('20250414')).toBe('2025-04-14')
    expect(snapshotDate('2025-0414')).toBe(null)
    expect(snapshotProblem('gpt-4.1', 'gpt-4.1-2099-99-99')).toMatch(/not a calendar date/)
    expect(snapshotProblem('m', 'm-20991231', '2026-10-04T00:00:00Z')).toMatch(/dated 2099-12-31, after the reply \(2026-10-04\)/)
    expect(snapshotProblem('m', 'm-mini')).toBeUndefined()
  })

  it('B4.3: attestModels records the snapshot evidence, fails a future snapshot, and names a snapshot change', () => {
    const ok = attestModels(eventsFromReplies([{ model: 'gpt-4.1-2025-04-14', created_at: '2026-09-01T10:00:00Z' }, { model: 'gpt-4.1-2025-04-14', created_at: '2026-09-01T10:01:00Z' }]), { declared: 'gpt-4.1' })
    expect(ok.outcome).toBe('PASS')
    expect(ok.snapshots).toEqual([{ declared: 'gpt-4.1', resolved: 'gpt-4.1-2025-04-14', date: '2025-04-14', replies: 2, first_at: '2026-09-01T10:00:00Z' }])
    const future = attestModels(eventsFromReplies([{ model: 'gpt-4.1-2026-12-01', created_at: '2026-09-01T10:00:00Z' }]), { declared: 'gpt-4.1' })
    expect(future.outcome).toBe('FAIL')
    expect(future.violation_count).toBe(1)
    expect(future.snapshot_problems?.[0]?.problem).toMatch(/dated 2026-12-01, after the reply \(2026-09-01\)/)
    expect(future.reasons.join('\n')).toMatch(/reply 0: gpt-4\.1-2026-12-01 names a snapshot dated 2026-12-01/)
    const drift = attestModels(eventsFromReplies([{ model: 'gpt-4.1-2025-04-14', created_at: '2026-09-01T10:00:00Z' }, { model: 'gpt-4.1-2025-08-06', created_at: '2026-09-02T10:00:00Z' }]), { declared: 'gpt-4.1' })
    expect(drift.outcome).toBe('FAIL')
    expect(drift.switches).toHaveLength(1)
    expect(drift.snapshots?.map((s) => s.resolved)).toEqual(['gpt-4.1-2025-04-14', 'gpt-4.1-2025-08-06'])
    expect(drift.reasons.join('\n')).toMatch(/1 change of dated snapshot under one declared id \(gpt-4\.1-2025-04-14 → gpt-4\.1-2025-08-06\)/)
    // an exact declaration carries no snapshot keys: its attestation body is what it was
    const exact = attestModels(eventsFromReplies([{ model: 'model-a' }]), { declared: 'model-a' })
    expect('snapshots' in exact || 'snapshot_problems' in exact).toBe(false)
  })

  it('modelGate names the snapshot it proceeded on, and holds a future one', () => {
    expect(modelGate('gpt-4.1', { model: 'gpt-4.1-2025-04-14' })).toMatchObject({ action: 'PROCEED', reason: 'reply came from gpt-4.1-2025-04-14 (the dated snapshot of the pinned gpt-4.1)' })
    expect(modelGate('gpt-4.1', { model: 'gpt-4.1-2099-12-31' }).action).toBe('HOLD')
    expect(modelGate('gpt-4.1', { model: 'gpt-4.1-2026-10-01', at: '2026-09-30T12:00:00Z' }).reason).toMatch(/after the reply/)
  })
})
