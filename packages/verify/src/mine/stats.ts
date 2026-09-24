/**
 * The GROUNDING null for rule mining: exact, with no sampling and no randomness.
 *
 * THE NULL. Say a candidate rule could be evaluated on N cases, H of which are HOLDs, and k of those cases violate it.
 * If the rule had nothing to do with the decisions, the labels would be exchangeable with respect to it. The k violators
 * would then be a uniformly random k-subset of the N cases, and the number of HOLDs among them, X, would follow
 * Hypergeometric(N, H, k):
 *
 *     P(X = x) = C(H, x) · C(N − H, k − x) / C(N, k)
 *
 * THE TEST. A real rule enriches its violators for HOLDs. The one-sided exact p-value (Fisher's exact test) for the h
 * HOLDs observed among the k violators is the upper tail
 *
 *     p = P(X ≥ h) = Σ_{x = h}^{min(k, H)} C(H, x) · C(N − H, k − x) / C(N, k)
 *
 * THE PROTOTYPE'S FORMULA IS THE SPECIAL CASE h = k. When no APPROVE case violates the candidate (the default,
 * maxApprovedViolationRate = 0), every violator is a HOLD. Then P(X ≥ k) = P(X = k) = C(H, k)/C(N, k), which is exactly
 * the Oracle-AP prototype's "all k are holds" formula. It is computed with the prototype's running product, so the
 * default path reproduces the prototype's p-values bit for bit.
 *
 * WHY THE ALL-HOLDS FORMULA IS WRONG WITH EXCEPTIONS. If some violators are approved (h < k), then "all k are holds"
 * did not happen. C(H, k)/C(N, k) is the probability of an event STRICTLY MORE extreme than the one observed, so it
 * understates the p-value (it is anti-conservative) and would ground noise. With exceptions the only valid statistic is
 * the tail P(X ≥ h) above.
 *
 * CAVEATS (the same as the prototype's, stated plainly):
 *  - The p-value is conditional on the violator set. For an L3 candidate, t is chosen FROM THE SAME LABELS (the smallest
 *    consistent grid value), so its p-value is not adjusted for that selection. The family-wise strict gate that is
 *    reported (alpha / number of variants, grid values counted) is the partial correction. Candles are proposals for a
 *    human, never rules on their own.
 *  - The tail is summed in log space, using a log-factorial table built from sums of logs. For N in the thousands the
 *    relative error is about 1e-12, far below any gate.
 */

/** P(all k violators are HOLDs) = C(H,k)/C(N,k). The prototype's running product, kept verbatim so p-values match exactly. */
export function hypergeomAllHolds(N: number, H: number, k: number): number {
  let p = 1
  for (let i = 0; i < k; i++) p *= (H - i) / (N - i)
  return p
}

const logFact: number[] = [0]
function lf(n: number): number {
  for (let i = logFact.length; i <= n; i++) logFact.push(logFact[i - 1]! + Math.log(i))
  return logFact[n]!
}
function logChoose(n: number, r: number): number {
  return lf(n) - lf(r) - lf(n - r)
}

/** P(X ≥ h) for X ~ Hypergeometric(N population, H successes, k draws). Exact sum of the pmf, in log space. */
export function hypergeomUpperTail(N: number, H: number, k: number, h: number): number {
  if (![N, H, k, h].every(Number.isInteger) || N < 0 || H < 0 || H > N || k < 0 || k > N) {
    throw new RangeError(`hypergeomUpperTail: invalid arguments N=${N} H=${H} k=${k} h=${h}`)
  }
  const lo = Math.max(0, k - (N - H)) // X cannot be smaller than this
  const hi = Math.min(k, H) // ... or larger than this
  if (h <= lo) return 1
  if (h > hi) return 0
  const denom = logChoose(N, k)
  let s = 0
  for (let x = h; x <= hi; x++) s += Math.exp(logChoose(H, x) + logChoose(N - H, k - x) - denom)
  return Math.min(1, s)
}

/**
 * The grounding p-value for k violators with h HOLDs among them, when N decidable cases include H HOLDs. It uses the
 * prototype's exact product when h = k (no approved exceptions), and the enrichment tail otherwise.
 */
export function groundingP(N: number, H: number, k: number, h: number): number {
  return h === k ? hypergeomAllHolds(N, H, k) : hypergeomUpperTail(N, H, k, h)
}
