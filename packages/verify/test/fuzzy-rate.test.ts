/**
 * A fuzzy-matched RATE must not launder into a confident per-line math check.
 * The vendored bridge computes VERIFIED_AMOUNT = rate × qty; that computed value inherits the rate's
 * confidence (patched from a hard-coded 100), and the MATH_INT receipt carries the rate itself, so
 * honesty rule 3 abstains either way.
 */
import { describe, it, expect } from 'vitest'
import { verify, MIN_VERDICT_CONFIDENCE } from '../src/index'
import { FIXED_NOW, fuzzyRate } from './fixtures/invoices'

describe('fuzzy rate → per-line math abstains', () => {
  it('MATH_INT abstains with AMBIGUOUS_FIELD and the computed verified amount carries the fuzzy confidence', () => {
    const v = verify(fuzzyRate, { now: FIXED_NOW })
    const c = v.claims.find(x => x.claim_id === 'line[0].MATH_INT')
    expect(c).toBeDefined()
    expect(c!.outcome).toBe('INSUFFICIENT_DATA')
    expect(c!.insufficiency?.reason).toBe('AMBIGUOUS_FIELD')
    expect(c!.locked).toBe(false)

    // the rate operand is on the receipt at fuzzy confidence
    const rate = c!.evidence.find(e => e.locator.kind === 'field' && e.locator.path === 'fuzzy')
    expect(rate?.confidence).toBeLessThan(MIN_VERDICT_CONFIDENCE)

    // and the bridge's computed VERIFIED_AMOUNT (rate × qty) inherited it — no hard-coded 100
    const computedVerified = c!.evidence.find(e => e.role === 'CONTEXT')
    expect(computedVerified).toBeDefined()
    expect(computedVerified!.confidence).toBeLessThan(MIN_VERDICT_CONFIDENCE)
  })

  it('the exact document-level fields on the same invoice still verify', () => {
    const v = verify(fuzzyRate, { now: FIXED_NOW })
    expect(v.claims.find(x => x.claim_id === 'document.SUM_INT')?.outcome).toBe('PASS')
    expect(v.claims.find(x => x.claim_id === 'document.TOTAL_INT')?.outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})
