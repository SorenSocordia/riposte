/**
 * Confidence bounds on an error rate — the arithmetic earned voice rests on. Checked against closed forms, exact binomial
 * sums, and an exact coverage computation (no simulation, no randomness).
 */
import { describe, it, expect } from 'vitest'
import { normalQuantile, binomialCdf, wilsonInterval, clopperPearsonInterval, rateInterval } from '../src/index'

const choose = (n: number, k: number): number => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r }

describe('normalQuantile (AS241)', () => {
  it('matches known quantiles to 1e-12', () => {
    expect(normalQuantile(0.5)).toBe(0)
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 12)
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536269514722, 12)
    expect(normalQuantile(0.99)).toBeCloseTo(2.3263478740408408, 12)
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232306167813, 12)
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959963984540054, 12)
    expect(normalQuantile(1e-10)).toBeCloseTo(-6.361340902404056, 9)
  })
  it('rejects p outside (0, 1)', () => {
    expect(() => normalQuantile(0)).toThrow(RangeError)
    expect(() => normalQuantile(1)).toThrow(RangeError)
  })
})

describe('binomialCdf', () => {
  it('equals the direct sum on small cases, and handles the edges', () => {
    for (const [k, n, p] of [[0, 10, 0.3], [3, 10, 0.3], [7, 20, 0.45], [2, 50, 0.01]] as const) {
      let direct = 0
      for (let i = 0; i <= k; i++) direct += choose(n, i) * p ** i * (1 - p) ** (n - i)
      expect(binomialCdf(k, n, p)).toBeCloseTo(direct, 12)
    }
    expect(binomialCdf(-1, 10, 0.5)).toBe(0)
    expect(binomialCdf(10, 10, 0.5)).toBe(1)
    expect(binomialCdf(3, 10, 0)).toBe(1)
    expect(binomialCdf(3, 10, 1)).toBe(0)
    expect(binomialCdf(0, 100_000, 0.01)).toBeGreaterThanOrEqual(0) // no underflow crash at large n
  })
})

describe('Clopper-Pearson (exact)', () => {
  it('k = 0 has the closed form 1 − α^(1/n); k = n has lower α^(1/n) and upper 1', () => {
    for (const n of [1, 10, 100, 415, 5000]) {
      const iv = clopperPearsonInterval(0, n, 0.95)
      expect(iv.lower).toBe(0)
      expect(iv.upper).toBeCloseTo(1 - 0.05 ** (1 / n), 10)
      expect(iv.upper).toBeGreaterThanOrEqual(1 - 0.05 ** (1 / n)) // rounded outward, never inward
      const full = clopperPearsonInterval(n, n, 0.95)
      expect(full.upper).toBe(1)
      expect(full.lower).toBeCloseTo(0.05 ** (1 / n), 10)
    }
  })

  it('covers: for a true rate p0, the exact probability the upper bound falls below p0 is at most α', () => {
    for (const [n, p0] of [[500, 0.01], [120, 0.05], [2000, 0.002]] as const) {
      let miss = 0
      // the upper bound rises with k, so the k whose bound falls below p0 are a prefix
      for (let k = 0; k <= n; k++) {
        if (clopperPearsonInterval(k, n, 0.95).upper >= p0) break
        miss += binomialCdf(k, n, p0) - binomialCdf(k - 1, n, p0)
      }
      expect(miss).toBeLessThanOrEqual(0.05 + 1e-12)
    }
  })
})

describe('Wilson', () => {
  it('n = 0 is the honest [0, 1]; k = 0 has lower 0', () => {
    expect(wilsonInterval(0, 0, 0.95)).toEqual({ lower: 0, upper: 1 })
    expect(wilsonInterval(0, 50, 0.95).lower).toBe(0)
  })
  it('the upper bound falls as clean evidence grows, and rises with errors', () => {
    let prev = 1
    for (const n of [10, 50, 100, 500, 1000, 5000]) {
      const u = wilsonInterval(0, n, 0.95).upper
      expect(u).toBeLessThan(prev)
      prev = u
    }
    expect(wilsonInterval(3, 415, 0.95).upper).toBeGreaterThan(wilsonInterval(2, 415, 0.95).upper)
  })
  it('the dispatch illustration: 3 misses in 415 has a 95% upper bound near 1.79%, far above a 0.5% bar', () => {
    const u = wilsonInterval(3, 415, 0.95).upper
    expect(u).toBeGreaterThan(0.0179)
    expect(u).toBeLessThan(0.018)
  })
  it('Clopper-Pearson is the more conservative at k = 0', () => {
    for (const n of [20, 100, 600, 2000]) expect(clopperPearsonInterval(0, n, 0.95).upper).toBeGreaterThan(wilsonInterval(0, n, 0.95).upper)
  })
})

describe('rateInterval', () => {
  it('dispatches on the declared method and rejects bad input', () => {
    expect(rateInterval(1, 100, 0.95, 'wilson')).toEqual(wilsonInterval(1, 100, 0.95))
    expect(rateInterval(1, 100, 0.95, 'clopper-pearson')).toEqual(clopperPearsonInterval(1, 100, 0.95))
    expect(() => rateInterval(1, 100, 0.95, 'bayes' as never)).toThrow(/unknown bound method/)
    expect(() => rateInterval(5, 4, 0.95, 'wilson')).toThrow(RangeError)
    expect(() => rateInterval(1.5, 4, 0.95, 'wilson')).toThrow(RangeError)
    expect(() => rateInterval(1, 4, 1, 'wilson')).toThrow(RangeError)
  })
})
