/**
 * Confidence bounds on an error rate (k errors in n reviewed items) — the arithmetic behind earned voice.
 *
 * Two declared methods, both one-sided at the stated confidence level unless a two-sided figure is asked for explicitly
 * (the `sidedness` parameter; every assessment in this product is one-sided, and says so):
 *   'wilson'           the Wilson score bound (closed form; the dispatch's example method).
 *   'clopper-pearson'  the exact binomial bound (bisection on the binomial CDF; more conservative, never anti-conservative;
 *                      the basis of audit attribute-sampling tables).
 *
 * Pure and deterministic: no randomness, fixed iteration counts, and results rounded OUTWARD at 1e-12 (the upper bound up,
 * the lower bound down), so float noise can only make a bound more cautious, never less. With n = 0 the honest interval
 * is [0, 1]: no evidence rules nothing out.
 */

export type BoundMethod = 'wilson' | 'clopper-pearson'

export interface Interval {
  /** One-sided lower bound at the confidence level. */
  lower: number
  /** One-sided upper bound at the confidence level: the error rate the data cannot rule out. */
  upper: number
}

// Wichura's AS241 (PPND16), accurate to about 1e-16.
const A = [3.3871328727963666080e0, 1.3314166789178437745e2, 1.9715909503065514427e3, 1.3731693765509461125e4, 4.5921953931549871457e4, 6.7265770927008700853e4, 3.3430575583588128105e4, 2.5090809287301226727e3]
const B = [1, 4.2313330701600911252e1, 6.8718700749205790830e2, 5.3941960214247511077e3, 2.1213794301586595867e4, 3.9307895800092710610e4, 2.8729085735721942674e4, 5.2264952788528545610e3]
const C = [1.42343711074968357734e0, 4.63033784615654529590e0, 5.76949722146069140550e0, 3.64784832476320460504e0, 1.27045825245236838258e0, 2.41780725177450611770e-1, 2.27238449892691845833e-2, 7.74545014278341407640e-4]
const D = [1, 2.05319162663775882187e0, 1.67638483018380384940e0, 6.89767334985100004550e-1, 1.48103976427480074590e-1, 1.51986665636164571966e-2, 5.47593808499534494600e-4, 1.05075007164441684324e-9]
const E = [6.65790464350110377720e0, 5.46378491116411436990e0, 1.78482653991729133580e0, 2.96560571828504891230e-1, 2.65321895265761230930e-2, 1.24266094738807843860e-3, 2.71155556874348757815e-5, 2.01033439929228813265e-7]
const F = [1, 5.99832206555887937690e-1, 1.36929880922735805310e-1, 1.48753612908506148525e-2, 7.86869131145613259100e-4, 1.84631831751005468180e-5, 1.42151175831644588870e-7, 2.04426310338993978564e-15]

function poly(c: readonly number[], x: number): number {
  let s = 0
  for (let i = c.length - 1; i >= 0; i--) s = s * x + (c[i] as number)
  return s
}

/** The standard normal quantile Φ⁻¹(p), for 0 < p < 1 (AS241). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs 0 < p < 1 (got ${p})`)
  const q = p - 0.5
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q
    return (q * poly(A, r)) / poly(B, r)
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p))
  let val: number
  if (r <= 5) {
    r -= 1.6
    val = poly(C, r) / poly(D, r)
  } else {
    r -= 5
    val = poly(E, r) / poly(F, r)
  }
  return q < 0 ? -val : val
}

/** P(X ≤ k) for X ~ Binomial(n, p), summed in log space (no underflow for large n). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0
  if (k >= n) return 1
  if (p <= 0) return 1
  if (p >= 1) return 0
  const lp = Math.log(p), lq = Math.log1p(-p)
  let lt = n * lq
  const terms: number[] = [lt]
  let max = lt
  for (let i = 0; i < k; i++) {
    lt += Math.log(n - i) - Math.log(i + 1) + lp - lq
    terms.push(lt)
    if (lt > max) max = lt
  }
  let s = 0
  for (const t of terms) s += Math.exp(t - max)
  return Math.min(1, Math.exp(max + Math.log(s)))
}

const ITER = 200
const up = (x: number): number => Math.min(1, Math.ceil(x * 1e12) / 1e12)
const down = (x: number): number => Math.max(0, Math.floor(x * 1e12) / 1e12)

function check(k: number, n: number, confidence: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a non-negative integer (got ${n})`)
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError(`k must be an integer in [0, n] (got k=${k}, n=${n})`)
  if (!(confidence >= 0.5 && confidence < 1)) throw new RangeError(`confidence must be in [0.5, 1) (got ${confidence})`)
}

/** One-sided Wilson score bounds at `confidence` (z = Φ⁻¹(confidence)). */
export function wilsonInterval(k: number, n: number, confidence: number): Interval {
  check(k, n, confidence)
  if (n === 0) return { lower: 0, upper: 1 }
  const z = normalQuantile(confidence)
  const ph = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = ph + z2 / (2 * n)
  const half = z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n))
  return {
    lower: k === 0 ? 0 : down((centre - half) / denom),
    upper: k === n ? 1 : up((centre + half) / denom),
  }
}

/** One-sided exact (Clopper-Pearson) bounds at `confidence`: P(X ≤ k | upper) = 1 − confidence; P(X ≥ k | lower) = 1 − confidence. */
export function clopperPearsonInterval(k: number, n: number, confidence: number): Interval {
  check(k, n, confidence)
  if (n === 0) return { lower: 0, upper: 1 }
  const alpha = 1 - confidence
  let upper = 1
  if (k < n) {
    let lo = 0, hi = 1
    for (let i = 0; i < ITER; i++) {
      const mid = (lo + hi) / 2
      if (binomialCdf(k, n, mid) > alpha) lo = mid
      else hi = mid
    }
    upper = up(hi)
  }
  let lower = 0
  if (k > 0) {
    let lo = 0, hi = 1
    for (let i = 0; i < ITER; i++) {
      const mid = (lo + hi) / 2
      if (binomialCdf(k - 1, n, mid) > confidence) lo = mid
      else hi = mid
    }
    lower = down(lo)
  }
  return { lower, upper }
}

// ── sidedness, made explicit (2026-09-28) ────────────────────────────────────────────────────
//
// Every bound in this product has always been ONE-SIDED at the stated confidence (the audit-sampling convention: AS 2315
// fn 9 speaks of "a 5 percent to 10 percent risk of assessing control risk too low", one tail). Research for this product found two
// public demo numbers that silently mixed sidedness (≈0.44% for 3/2,000 is two-sided z = 1.96; one-sided it is 0.375%).
// So sidedness is now a declared parameter everywhere a number is produced. A TWO-SIDED interval at confidence c puts
// (1 − c)/2 in each tail, so each of its edges equals the ONE-SIDED edge at confidence 1 − (1 − c)/2.

export type Sidedness = 'one-sided' | 'two-sided'
export const SIDEDNESS: readonly Sidedness[] = ['one-sided', 'two-sided']

/** The one-sided confidence whose edge equals the edge of a `sidedness` interval at `confidence`. */
export function oneSidedLevel(confidence: number, sidedness: Sidedness): number {
  if (sidedness === 'one-sided') return confidence
  if (sidedness === 'two-sided') return 1 - (1 - confidence) / 2
  throw new RangeError(`unknown sidedness ${JSON.stringify(sidedness)} (declare 'one-sided' or 'two-sided')`)
}

/** The declared method's interval, at the declared sidedness (default one-sided: every assessment in this product). */
export function rateInterval(k: number, n: number, confidence: number, method: BoundMethod, sidedness: Sidedness = 'one-sided'): Interval {
  const c = oneSidedLevel(confidence, sidedness)
  if (method === 'wilson') return wilsonInterval(k, n, c)
  if (method === 'clopper-pearson') return clopperPearsonInterval(k, n, c)
  throw new RangeError(`unknown bound method ${JSON.stringify(method)} (declare 'wilson' or 'clopper-pearson')`)
}

/** "95% one-sided wilson": the words that must travel with every bound. */
export function describeBound(confidence: number, method: BoundMethod, sidedness: Sidedness = 'one-sided'): string {
  return `${Number((confidence * 100).toPrecision(3))}% ${sidedness} ${method}`
}

const N_CAP = 1_000_000_000

/**
 * The ZERO-MISS n: the fewest reviewed items, all clean, whose upper bound on the error rate is at or below `bar`. No smaller
 * sample can ever clear the bar, whatever it shows, so a declared minimum below this number is inert (lintPolicy flags it).
 * This is the attribute-sampling table's "sample size for zero expected deviations": 45 at 5% / 90%, 59 at 5% / 95%, 299 at
 * 1% / 95%, 4,603 at 0.1% / 99% (exact, one-sided); Wilson needs 5,407 for that last one.
 */
export function zeroMissN(bar: number, confidence: number, method: BoundMethod, sidedness: Sidedness = 'one-sided'): number {
  if (!(bar > 0 && bar < 1)) throw new RangeError(`bar must be in (0, 1) (got ${bar})`)
  const ok = (n: number): boolean => rateInterval(0, n, confidence, method, sidedness).upper <= bar
  let hi = 1
  while (!ok(hi)) { hi *= 2; if (hi > N_CAP) throw new RangeError(`no n ≤ ${N_CAP} clears ${bar} at ${describeBound(confidence, method, sidedness)}`) }
  let lo = Math.floor(hi / 2) // ok(lo) is false (or lo = 0)
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid }
  return hi
}

/**
 * The LOWER bound on a success rate (e.g. a reviewer's catch rate on seeded canaries): `caught` of `n`. Both methods are
 * symmetric, so it is 1 − the upper bound on the miss rate (n − caught of n), and it inherits that bound's outward rounding
 * (the lower bound can only come out lower, never higher). n = 0: no evidence, a lower bound of 0.
 */
export function successLowerBound(caught: number, n: number, confidence: number, method: BoundMethod, sidedness: Sidedness = 'one-sided'): number {
  if (n === 0) return 0
  return Math.max(0, 1 - rateInterval(n - caught, n, confidence, method, sidedness).upper)
}
