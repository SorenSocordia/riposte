/**
 * Determinism — pre-registered claim W2: same input + ruleset + engine → byte-identical verdict (except issued_at).
 * Any non-identical replay is a kill (and a bug).
 */
import { describe, it, expect } from 'vitest'
import { verify, replayView, canonicalize } from '../../src/index'
import { ALL_STANDALONE, FIXED_NOW, reverseKeysDeep, singleLine, contractOk, evidenceOk } from '../fixtures/invoices'
import { ALL_PAY_APPS, cleanApp, prevApp } from '../fixtures/pay-apps'

// Pre-registered claim W2 names 10,000 replays across the golden corpus; ALL_STANDALONE × REPLAYS meets it.
const REPLAYS = 1250
// The second ruleset replays too (fewer per fixture — the claim is already met above; this guards the ruleset host).
const PAY_APP_REPLAYS = 250

describe('determinism (W2) — pay-app ruleset', () => {
  for (const [name, ex] of ALL_PAY_APPS) {
    it(`${name}: ${PAY_APP_REPLAYS} replays are byte-identical, key order and clock do not matter`, () => {
      const opts = { ruleset: 'pay-app' as const, now: FIXED_NOW, references: { history: [prevApp] } }
      const first = JSON.stringify(replayView(verify(ex, opts)))
      for (let i = 0; i < PAY_APP_REPLAYS; i++) {
        expect(JSON.stringify(replayView(verify(JSON.parse(JSON.stringify(ex)), opts)))).toBe(first)
      }
      const shuffled = verify(reverseKeysDeep(ex), { ...opts, references: { history: [reverseKeysDeep(prevApp)] } })
      expect(JSON.stringify(replayView(shuffled))).toBe(first)
      const later = verify(ex, { ...opts, now: () => new Date('2030-06-15T12:34:56Z') })
      expect(JSON.stringify(replayView(later))).toBe(first)
    })
  }

  it('the ruleset participates in the verdict id: same input, different rules → different verdict', () => {
    const a = verify(cleanApp, { now: FIXED_NOW })
    const b = verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW })
    expect(a.input_hash).toBe(b.input_hash)
    expect(a.verdict_id).not.toBe(b.verdict_id)
  })

  it('history participates in the input hash and the verdict id', () => {
    const none = verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW })
    const withHistory = verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW, references: { history: [prevApp] } })
    expect(none.verdict_id).not.toBe(withHistory.verdict_id)
    expect(none.document.extraction_hash).toBe(withHistory.document.extraction_hash)
  })
})

describe('determinism (W2)', () => {
  for (const [name, ex] of ALL_STANDALONE) {
    it(`${name}: ${REPLAYS} replays are byte-identical`, () => {
      const first = JSON.stringify(replayView(verify(ex, { now: FIXED_NOW })))
      for (let i = 0; i < REPLAYS; i++) {
        const again = JSON.stringify(replayView(verify(JSON.parse(JSON.stringify(ex)), { now: FIXED_NOW })))
        expect(again).toBe(first)
      }
    })

    it(`${name}: object key order does not change the verdict or its id`, () => {
      const a = verify(ex, { now: FIXED_NOW })
      const b = verify(reverseKeysDeep(ex), { now: FIXED_NOW })
      expect(b.verdict_id).toBe(a.verdict_id)
      expect(b.input_hash).toBe(a.input_hash)
      expect(JSON.stringify(replayView(b))).toBe(JSON.stringify(replayView(a)))
    })

    it(`${name}: only issued_at varies with the clock`, () => {
      const a = verify(ex, { now: () => new Date('2026-01-01T00:00:00Z') })
      const b = verify(ex, { now: () => new Date('2030-06-15T12:34:56Z') })
      expect(a.issued_at).not.toBe(b.issued_at)
      expect(JSON.stringify(replayView(a))).toBe(JSON.stringify(replayView(b)))
    })
  }

  it('references participate in the input hash and the verdict id', () => {
    const none = verify(singleLine, { now: FIXED_NOW })
    const withContract = verify(singleLine, { now: FIXED_NOW, references: { contract: contractOk } })
    const withEvidence = verify(singleLine, { now: FIXED_NOW, references: { evidence: [evidenceOk] } })
    expect(new Set([none.verdict_id, withContract.verdict_id, withEvidence.verdict_id]).size).toBe(3)
    expect(none.document.extraction_hash).toBe(withContract.document.extraction_hash)
  })

  it('canonicalization is key-order independent and drops undefined', () => {
    expect(canonicalize({ b: 1, a: [3, { d: 2, c: 1 }] })).toBe(canonicalize({ a: [3, { c: 1, d: 2 }], b: 1 }))
    expect(canonicalize({ a: 1, u: undefined })).toBe(canonicalize({ a: 1 }))
    expect(canonicalize(new Date('2026-09-22T00:00:00Z'))).toBe('"2026-09-22T00:00:00.000Z"')
  })
})
