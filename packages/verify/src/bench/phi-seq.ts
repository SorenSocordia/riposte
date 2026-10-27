/**
 * Φ1: low-discrepancy coverage for seeded property tests.
 *
 * phiSeq(n, d) returns n points in [0,1)^d from the generalized golden (R_d) sequence: x_i = frac(0.5 + i·α), i = 1..n,
 * with α_j = g^(-j) for j = 1..d, where g is the real root greater than 1 of x^(d+1) = x + 1. For d = 1, g is the golden
 * ratio φ ≈ 1.6180339887 (the Kronecker sequence {i/φ}); for d = 2, g is the plastic number ρ ≈ 1.3247179572, so the
 * 2-D sequence steps by (1/ρ, 1/ρ²), not by φ. The property that buys coverage: φ is the real number worst approximated by
 * rationals, so {i·α} never settles into a cycle and never leaves a gap or a cluster. It is coverage, not randomness: where
 * a test needs unpredictability (fuzzing a parser), keep a PRNG.
 *
 * phiSeeded(n, d, seed) shifts the start by a seeded offset per axis, so two seeds give two different but equally even
 * sweeps. starDiscrepancy computes the exact star discrepancy in 1-D and 2-D (the yardstick the addendum names), and
 * mulberry32 is the seeded PRNG the comparison uses. Pure and deterministic.
 *
 * Where it would swap in (not swapped here): test/peppol-v020.test.ts "PROPERTY (500 seeded invoices)" draws two bounded
 * amounts from an LCG; phiSeq(500, 2) would cover that square evenly, with the two categorical choices (which unreadable
 * form each total takes) enumerated as a grid rather than drawn. test/ap-line-math.test.ts's seeded properties are the
 * same shape. Keep the PRNG where a test wants adversarial unpredictability (test/fuzz.test.ts), and keep the old draws
 * beside any swap for one release so the comparison stays visible.
 */

/** The real root greater than 1 of x^(d+1) = x + 1 (φ for d = 1, the plastic number for d = 2). */
export function goldenRoot(d: number): number {
  if (!Number.isInteger(d) || d < 1) throw new RangeError(`dims must be an integer >= 1 (got ${d})`)
  let x = 2
  for (let i = 0; i < 100; i++) {
    const f = x ** (d + 1) - x - 1
    const df = (d + 1) * x ** d - 1
    const nx = x - f / df
    if (Math.abs(nx - x) < 1e-16) { x = nx; break }
    x = nx
  }
  return x
}

const frac = (x: number): number => x - Math.floor(x)

function check(n: number, dims: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be an integer >= 0 (got ${n})`)
  if (!Number.isInteger(dims) || dims < 1) throw new RangeError(`dims must be an integer >= 1 (got ${dims})`)
}

/** The step α for d dimensions: α_j = g^(-j), j = 1..d. */
export function phiAlpha(dims: number): number[] {
  const g = goldenRoot(dims)
  return Array.from({ length: dims }, (_, j) => frac(1 / g ** (j + 1)))
}

/** n points of the R_d sequence in [0,1)^dims, starting at offset 0.5. */
export function phiSeq(n: number, dims = 1): number[][] {
  check(n, dims)
  const a = phiAlpha(dims)
  const out: number[][] = []
  for (let i = 1; i <= n; i++) out.push(a.map(aj => frac(0.5 + i * aj)))
  return out
}

/** A seeded 32-bit PRNG (mulberry32): uniform in [0, 1), the same sequence for the same seed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** n points of the R_d sequence with a seeded start: as evenly spread as phiSeq, different per seed. */
export function phiSeeded(n: number, dims: number, seed: number): number[][] {
  check(n, dims)
  const rand = mulberry32(seed)
  const offset = Array.from({ length: dims }, () => rand())
  const a = phiAlpha(dims)
  const out: number[][] = []
  for (let i = 1; i <= n; i++) out.push(a.map((aj, j) => frac(offset[j]! + i * aj)))
  return out
}

/** n points drawn from a PRNG (Math.random by default), for comparison. */
export function randomPoints(n: number, dims: number, rand: () => number = Math.random): number[][] {
  check(n, dims)
  return Array.from({ length: n }, () => Array.from({ length: dims }, () => rand()))
}

/**
 * The exact star discrepancy D* = sup over anchored boxes [0, x) × … of |count/n − volume|, for 1-D or 2-D points.
 * 2-D: the supremum is attained on the grid of point coordinates and 1; closed boxes give the upper excess, open boxes the
 * lower one. O(n²) after sorting.
 */
export function starDiscrepancy(points: readonly (readonly number[])[]): number {
  const n = points.length
  if (n === 0) return 1
  const d = points[0]!.length
  if (d === 1) {
    const xs = points.map(p => p[0]!).sort((a, b) => a - b)
    let D = 0
    xs.forEach((x, i) => { D = Math.max(D, (i + 1) / n - x, x - i / n) })
    return D
  }
  if (d !== 2) throw new RangeError('starDiscrepancy is exact for 1-D and 2-D points only')
  const pts = points.map(p => [p[0]!, p[1]!] as const).sort((a, b) => a[0] - b[0])
  const ys = [...new Set(pts.map(p => p[1]))].sort((a, b) => a - b)
  const yIndex = new Map(ys.map((y, i) => [y, i]))
  const m = ys.length
  const cnt = new Array<number>(m).fill(0)
  let D = 0
  // sweep x over the distinct x coordinates (and 1); `cnt` holds, by y rank, the points with x strictly below the sweep
  const xs = [...new Set(pts.map(p => p[0]))].sort((a, b) => a - b)
  let next = 0
  const evalAt = (x: number, closedExtra: readonly number[]): void => {
    // open box [0,x) × [0,y): points with x' < x and y' < y; closed box [0,x] × [0,y]: x' <= x and y' <= y
    const extra = new Array<number>(m).fill(0)
    for (const r of closedExtra) extra[r]!++
    let open = 0, closed = 0
    for (let j = 0; j < m; j++) {
      const y = ys[j]!
      // open count with y' < y_j uses ranks < j; closed with y' <= y_j uses ranks <= j
      const openBelow = open
      open += cnt[j]!
      closed += cnt[j]! + extra[j]!
      D = Math.max(D, x * y - openBelow / n, closed / n - x * y)
    }
    D = Math.max(D, x * 1 - open / n) // the open box reaching y = 1
  }
  for (const x of xs) {
    const atX: number[] = []
    while (next < pts.length && pts[next]![0] === x) { atX.push(yIndex.get(pts[next]![1])!); next++ }
    evalAt(x, atX)
    for (const r of atX) cnt[r]!++
  }
  evalAt(1, [])
  return D
}
