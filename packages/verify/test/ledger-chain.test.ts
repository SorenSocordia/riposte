/**
 * The ledger's tamper-evident hash chain. Every record + every review is an immutable append; altering or deleting any
 * past event breaks every hash after it. This is the SEC 17a-4(f) audit-trail alternative / EU AI Act Art 12 property:
 * a complete, time-stamped, provably-unaltered history. Deterministic given an injected clock.
 */
import { describe, it, expect } from 'vitest'
import { verify, createLedger, GENESIS, verifyChain, verifyChainAgainst, type LedgerEvent } from '../src/index'
import { clean, broken, singleLine, FIXED_NOW } from './fixtures/invoices'

const at = (iso: string) => () => new Date(iso)
const build = (clock = at('2026-09-22T00:00:00Z')) => {
  const led = createLedger({ now: clock })
  const vClean = verify(clean, { now: FIXED_NOW })
  const vBroken = verify(broken, { now: FIXED_NOW })
  led.record(vClean, { tenant_id: 't1' })
  led.record(vBroken, { tenant_id: 't1' })
  led.review(vClean.verdict_id, { reviewer_id: 'anna', decision: 'UPHELD' })
  return { led, vClean, vBroken }
}

describe('the chain grows and verifies', () => {
  it('an empty ledger has GENESIS as its head and a valid zero-length chain', () => {
    const led = createLedger({ now: at('2026-09-22T00:00:00Z') })
    expect(led.chainHead()).toBe(GENESIS)
    expect(led.verifyChain()).toMatchObject({ ok: true, length: 0, head: GENESIS })
  })

  it('each record and each review appends one immutable, linked event', () => {
    const { led } = build()
    const evs = led.events()
    expect(evs.map(e => e.type)).toEqual(['RECORD', 'RECORD', 'REVIEW'])
    expect(evs.map(e => e.seq)).toEqual([0, 1, 2])
    expect(evs[0]!.prev_hash).toBe(GENESIS)
    expect(evs[1]!.prev_hash).toBe(evs[0]!.entry_hash) // each links to the prior
    expect(evs[2]!.prev_hash).toBe(evs[1]!.entry_hash)
    expect(led.chainHead()).toBe(evs[2]!.entry_hash)
    expect(led.verifyChain()).toMatchObject({ ok: true, length: 3 })
    expect(led.verifyContent()).toMatchObject({ ok: true, length: 3 })
  })

  it('re-recording overwrites the record map but the chain keeps BOTH appends (the past is immutable)', () => {
    const led = createLedger({ now: at('2026-09-22T00:00:00Z') })
    const v = verify(clean, { now: FIXED_NOW })
    led.record(v, { tenant_id: 't1' })
    led.record(v, { tenant_id: 't1' })
    expect(led.all()).toHaveLength(1)     // one current record per proof
    expect(led.events()).toHaveLength(2)  // but two events in the append-only log
    expect(led.verifyChain().ok).toBe(true)
  })
})

describe('tamper detection', () => {
  it('altering a past event breaks the chain at that index', () => {
    const { led } = build()
    const events = led.events() // a copy
    events[1] = { ...events[1]!, payload_hash: 'deadbeef'.repeat(8) } // simulate a tampered stored event
    const check = verifyChain(events)
    expect(check.ok).toBe(false)
    expect(check.brokenAt).toBe(1)
  })

  it('deleting a middle event breaks the sequence', () => {
    const { led } = build()
    const events = led.events().filter((_, i) => i !== 1)
    const check = verifyChain(events)
    expect(check.ok).toBe(false)
    expect(check.brokenAt).toBe(1) // seq 2 now sits where seq 1 should be
  })

  it('content tampering is caught even when the links are re-forged', () => {
    const { led } = build()
    // Export the independently-verifiable log, then tamper a payload and re-run the content check against it.
    const rows = led.chainJSONL().split('\n').map(l => JSON.parse(l) as LedgerEvent & { payload: unknown })
    const honest = verifyChainAgainst(rows, ev => rows[ev.seq]!.payload)
    expect(honest.ok).toBe(true)
    const tampered = rows.map((r, i) => i === 0 ? { ...r, payload: { ...(r.payload as object), tenant_id: 'evil-corp' } } : r)
    const check = verifyChainAgainst(tampered, ev => tampered[ev.seq]!.payload)
    expect(check.ok).toBe(false)
    expect(check.brokenAt).toBe(0)
    expect(check.reason).toMatch(/payload/)
  })
})

describe('determinism', () => {
  it('the same operations under the same clock produce the identical head hash', () => {
    expect(build().led.chainHead()).toBe(build().led.chainHead())
  })
  it('a different reviewer decision produces a different head (the history is sensitive to content)', () => {
    const a = createLedger({ now: at('2026-09-22T00:00:00Z') })
    const b = createLedger({ now: at('2026-09-22T00:00:00Z') })
    const v = verify(singleLine, { now: FIXED_NOW })
    a.record(v, { tenant_id: 't1' }); b.record(v, { tenant_id: 't1' })
    a.review(v.verdict_id, { reviewer_id: 'x', decision: 'UPHELD' })
    b.review(v.verdict_id, { reviewer_id: 'x', decision: 'OVERTURNED' })
    expect(a.chainHead()).not.toBe(b.chainHead())
  })
})
