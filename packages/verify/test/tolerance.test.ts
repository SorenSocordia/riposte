/**
 * Tolerance as a stated policy (leg 1.11): a penny (or a sub-0.05% rounding drift) is not an error, but a real gap still
 * FAILs — and the variance stays visible either way. The policy is per-ruleset and per-call, never baked into an axiom.
 */
import { describe, it, expect } from 'vitest'
import { verify, STRICT } from '../src/index'
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { FIXED_NOW, roundingDrift, roundingTooBig, broken } from './fixtures/invoices'
import { cleanApp } from './fixtures/pay-apps'

const claim = (v: ReturnType<typeof verify>, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found`)
  return c
}

describe('rounding tolerance (invoice: 0.03% band over the $0.01 floor)', () => {
  // Invoice 0.0.1 (retained for replay): the uncapped band forgave a 40-cent drift. Pinned under 0.0.1 on 2026-09-28.
  it('invoice@0.0.1: a 40-cent drift on a ~$1750 subtotal is treated as rounding: SUM_INT PASSes but the variance is still shown', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    const c = claim(v, 'document.SUM_INT')
    expect(c.outcome).toBe('PASS')
    expect(c.variance).toBe(-0.4)                      // the cents are NOT hidden
    expect(c.locked).toBe(false)
    expect(c.explanation).toMatch(/within tolerance/i)
    expect(c.computation?.tolerance).toEqual({ abs: 0.01, rel: 0.0003 })
    expect(v.outcome).toBe('PASS')
  })

  // Invoice 0.1.0: two cent-exact lines cannot round to a 40-cent gap. The band forgives rounding, not materiality
  // (docs/NUMERIC-HONESTY-2026-09-28.md); a deployment that wants 40 cents forgiven declares an override.
  it('invoice@0.1.0: the same 40-cent drift FAILs, because rounding cannot produce it (cap 0.01 × 3 steps), and says so', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW })
    expect(v.ruleset.version).toBe('0.1.0')
    const c = claim(v, 'document.SUM_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(-0.4)
    expect(c.explanation).toContain('Not treated as rounding: |variance| 0.4 is within 0.03% of 1750.5 but above the rounding cap 0.01 × 3 steps = 0.03')
    expect(v.outcome).toBe('FAIL')
    // A materiality band is a declared override, and the verdict_id commits to it (D-TOL-ID).
    const lenient = verify(roundingDrift, { now: FIXED_NOW, tolerance: { rel: 0.0003, absCap: 0 } })
    expect(claim(lenient, 'document.SUM_INT').outcome).toBe('PASS')
    expect(lenient.verdict_id).not.toBe(v.verdict_id)
  })

  it('a $2.00 gap on the same invoice is above the band: a real FAIL', () => {
    const v = verify(roundingTooBig, { now: FIXED_NOW })
    const c = claim(v, 'document.SUM_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(-2)
    expect(v.outcome).toBe('FAIL')
  })

  it('a per-call STRICT override turns the 40-cent drift back into a FAIL (a knob, not a constant)', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW, tolerance: STRICT })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('FAIL')
  })

  it('the big obvious errors in the broken fixture are nowhere near the band — still FAIL', () => {
    const v = verify(broken, { now: FIXED_NOW })
    expect(claim(v, 'document.SUM_INT').outcome).toBe('FAIL')
    expect(claim(v, 'document.TAX_INT').outcome).toBe('FAIL')
  })

  it('RED-TEAM regression: a $4,900 error on a $10M invoice is a real error, not "rounding" (band is 0.03%, not 0.05%)', () => {
    const bigError = {
      invoice_number: 'BIG', currency: 'USD',
      line_items: [{ description: 'x', quantity: 1, unit_price: 9995100, amount: 9995100 }],
      totals: { subtotal: 10000000, tax_rate: 0, tax: 0, total: 10000000 },
    }
    const c = claim(verify(bigError, { now: FIXED_NOW }), 'document.SUM_INT')
    expect(c.outcome).toBe('FAIL')       // 4,900 / 10,000,000 = 0.049% > 0.03%
    expect(c.variance).toBe(-4900)
  })
})

describe('pay-app is strict by default (GCs kick back on cents)', () => {
  it('the pay-app ruleset does not stamp a relative band, and its percent tolerance is untouched', () => {
    const v = verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW })
    // percentage claim keeps its own 0.005 tolerance, no rel band added
    expect(claim(v, 'line[1].G703_PCT').computation?.tolerance).toEqual({ abs: 0.005 })
    // a money claim keeps the strict $0.01 floor with no rel band
    expect(claim(v, 'document.G702_DONE').computation?.tolerance).toEqual({ abs: 0.01 })
  })
})
