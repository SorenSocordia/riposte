/**
 * Φ1 (src/bench/phi-seq.ts): the golden / plastic-number sequences cover [0,1)^d more evenly than a seeded PRNG, measured
 * by exact star discrepancy at n = 500 (bar B5). The ratio is reported on the console, not barred.
 */
import { describe, it, expect } from 'vitest'
import { goldenRoot, phiAlpha, phiSeq, phiSeeded, mulberry32, randomPoints, starDiscrepancy } from '../src/bench/phi-seq'

const N = 500
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const median = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return (b[9]! + b[10]!) / 2 }

describe('the constants', () => {
  it('d = 1 steps by the golden ratio; d = 2 by the plastic number', () => {
    expect(goldenRoot(1)).toBeCloseTo((1 + Math.sqrt(5)) / 2, 14)
    expect(goldenRoot(2)).toBeCloseTo(1.324717957244746, 14)
    const r = goldenRoot(2)
    const [a1, a2] = phiAlpha(2)
    expect(a1).toBeCloseTo(1 / r, 15)
    expect(a2).toBeCloseTo(1 / (r * r), 15)
    expect(() => goldenRoot(0)).toThrow(RangeError)
  })

  it('points lie in [0,1)^d, deterministically; a seed shifts the start', () => {
    const p = phiSeq(1000, 3)
    expect(p.every(x => x.length === 3 && x.every(c => c >= 0 && c < 1))).toBe(true)
    expect(phiSeq(10, 2)).toEqual(phiSeq(10, 2))
    expect(phiSeeded(10, 2, 7)).toEqual(phiSeeded(10, 2, 7))
    expect(phiSeeded(10, 2, 7)).not.toEqual(phiSeeded(10, 2, 8))
    expect(() => phiSeq(-1, 2)).toThrow(RangeError)
  })
})

describe('exact star discrepancy', () => {
  it('equals a brute-force evaluation over the box grid', () => {
    for (const seed of [3, 7, 11]) {
      const pts = randomPoints(15, 2, mulberry32(seed))
      const gx = [...pts.map(p => p[0]!), 1], gy = [...pts.map(p => p[1]!), 1]
      let best = 0
      for (const x of gx) for (const y of gy) {
        const open = pts.filter(p => p[0]! < x && p[1]! < y).length
        const closed = pts.filter(p => p[0]! <= x && p[1]! <= y).length
        best = Math.max(best, x * y - open / 15, closed / 15 - x * y)
      }
      expect(starDiscrepancy(pts)).toBeCloseTo(best, 12)
    }
    expect(starDiscrepancy([[0.5]])).toBe(0.5)
  })
})

describe('B5: phi-seq covers more evenly than a PRNG at n = 500', () => {
  it('2-D: below every one of 20 seeded draws, and below a Math.random draw', () => {
    const phi = starDiscrepancy(phiSeq(N, 2))
    const prng = SEEDS.map(s => starDiscrepancy(randomPoints(N, 2, mulberry32(s))))
    for (const d of prng) expect(phi).toBeLessThan(d)
    expect(phi).toBeLessThan(starDiscrepancy(randomPoints(N, 2)))
    console.log(`phi-seq 2-D D* ${phi.toFixed(5)}; seeded PRNG median ${median(prng).toFixed(5)}, min ${Math.min(...prng).toFixed(5)}; ratio ${(median(prng) / phi).toFixed(2)}x`)
  })

  it('1-D: below every one of the same 20 seeded draws', () => {
    const phi = starDiscrepancy(phiSeq(N, 1))
    const prng = SEEDS.map(s => starDiscrepancy(randomPoints(N, 1, mulberry32(s))))
    for (const d of prng) expect(phi).toBeLessThan(d)
    console.log(`phi-seq 1-D D* ${phi.toFixed(5)}; seeded PRNG median ${median(prng).toFixed(5)}; ratio ${(median(prng) / phi).toFixed(2)}x`)
  })

  it('phiSeeded, seeds 1..20: each below the PRNG median', () => {
    const prngMedian = median(SEEDS.map(s => starDiscrepancy(randomPoints(N, 2, mulberry32(s)))))
    for (const s of SEEDS) expect(starDiscrepancy(phiSeeded(N, 2, s))).toBeLessThan(prngMedian)
  })
})
