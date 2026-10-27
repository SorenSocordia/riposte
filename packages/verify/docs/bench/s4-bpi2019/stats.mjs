// Small, dependency-free statistics used by score.mjs (PREREG §7, §8).
export const Z95 = 1.959963984540054

/** Wilson score interval for x successes of n. */
export function wilson(x, n, z = Z95) {
  if (n === 0) return { p: null, lo: null, hi: null }
  const p = x / n, z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

/** Relative risk of the outcome in group 1 (a of a+b) vs group 2 (c of c+d), 95% CI by the log method. */
export function relativeRisk(a, b, c, d, z = Z95) {
  if (a + b === 0 || c + d === 0 || a === 0 || c === 0) return { rr: null, lo: null, hi: null }
  const rr = a / (a + b) / (c / (c + d))
  const se = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
  return { rr, lo: Math.exp(Math.log(rr) - z * se), hi: Math.exp(Math.log(rr) + z * se) }
}

/** mulberry32 PRNG: deterministic floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform sample of k items without replacement: partial Fisher-Yates over a copy (input order must be fixed). */
export function sample(items, k, rand) {
  const a = items.slice()
  const m = Math.min(k, a.length)
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rand() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, m)
}
