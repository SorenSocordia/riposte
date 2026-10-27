/**
 * rar.fit@1: the weighted orthogonal-distance fit of the radial acceleration relation, g_obs = F(g_bar) = g_bar / (1 - e^-sqrt(g_bar/g†)),
 * with one parameter, g†. The registry entry (./index.ts) carries the quoted source and the reading. THIS FILE IS THE
 * IMPLEMENTATION: its bytes (line ends folded to LF) are pinned by `implementation_sha256` in ./index.ts, a test recomputes that
 * hash, and a verdict made with this procedure carries the pin. A changed procedure is a new version (rar.fit@2), never an edit.
 *
 * The procedure, as read (a port of SCI-R1's preregistered solver: logF, dlogF_dx, inner_gn, wodr_fit):
 *  - in log space, x = log10 g_bar and y = log10 g_obs, the model is y = logF(x; b) = x - log10(1 - e^-s), s = sqrt(10^x / (b·1e-10));
 *  - the objective is the orthogonal-distance chi-square, Σ_i min over t_i of ((y_i - logF(t_i))/σy_i)² + ((t_i - x_i)/σx_i)²;
 *  - the inner minimum over every t_i is taken by Gauss-Newton (ODRPACK's inner step), all rows together, from t = x, at most 60
 *    steps, stopping when the largest step is below 1e-13;
 *  - the outer minimum over ln b is taken by Brent's bounded method on [ln 0.01, ln 100] with xatol 1e-8, as SciPy's
 *    minimize_scalar(method='bounded') does it;
 *  - σ: with the weighting 'errors' the σx and σy series as given (1σ, in dex); with 'unweighted' every σ is 1;
 *  - the curvature error is sqrt(2 / chi²''), chi²'' by a central difference at h = 1e-3 b.
 * Deterministic: fixed iteration counts, no randomness, sums taken left to right in row order.
 */

export interface RarFitInputs {
  /** log10 g_bar per row */
  x: readonly number[]
  /** log10 g_obs per row */
  y: readonly number[]
  /** 1σ of x per row, in dex */
  sx: readonly number[]
  /** 1σ of y per row, in dex */
  sy: readonly number[]
}

export type RarWeighting = 'errors' | 'unweighted'

export type RarFitResult =
  | { ok: true; outputs: { g_dagger: number; rms_v: number; chi2: number; sd_curvature: number; n_used: number } }
  | { ok: false; reason: string }

const LOWER = Math.log(0.01)
const UPPER = Math.log(100.0)
const XATOL = 1e-8
const INNER_STEPS = 60
const INNER_STOP = 1e-13
const MAXFUN = 500

/** log10 g_obs predicted from x = log10 g_bar, with g† = b × 1e-10. */
export function rarLogF(x: number, b: number): number {
  const s = Math.sqrt(Math.pow(10, x) / (b * 1e-10))
  return x - Math.log10(-Math.expm1(-s))
}

function dlogF(t: number, b: number): number {
  const s = Math.sqrt(Math.pow(10, t) / (b * 1e-10))
  const E = Math.exp(-s)
  const D = -Math.expm1(-s)
  return 1.0 - (E * s) / (2.0 * D)
}

/** The orthogonal-distance chi-square at b: every row's inner minimum, all rows stepped together. */
function chi2At(x: readonly number[], y: readonly number[], sx: readonly number[], sy: readonly number[], b: number): number {
  const n = x.length
  const t = x.slice()
  for (let k = 0; k < INNER_STEPS; k++) {
    let step = 0
    for (let i = 0; i < n; i++) {
      const wy = 1.0 / (sy[i]! * sy[i]!)
      const wx = 1.0 / (sx[i]! * sx[i]!)
      const ti = t[i]!
      const F = rarLogF(ti, b)
      const Fp = dlogF(ti, b)
      const next = ((y[i]! - F + Fp * ti) * Fp * wy + x[i]! * wx) / (Fp * Fp * wy + wx)
      const d = Math.abs(next - ti)
      if (d > step) step = d
      t[i] = next
    }
    if (step < INNER_STOP) break
  }
  let chi2 = 0
  for (let i = 0; i < n; i++) {
    const a = (y[i]! - rarLogF(t[i]!, b)) / sy[i]!
    const c = (t[i]! - x[i]!) / sx[i]!
    chi2 += a * a + c * c
  }
  return chi2
}

/** Brent's bounded minimiser of f on [lo, hi] (as SciPy's minimize_scalar(method='bounded') implements it). */
function brentBounded(f: (u: number) => number, lo: number, hi: number, xatol: number): { x: number; fx: number; converged: boolean } {
  const sqrtEps = Math.sqrt(2.2e-16)
  const goldenMean = 0.5 * (3.0 - Math.sqrt(5.0))
  let a = lo, b = hi
  let fulc = a + goldenMean * (b - a)
  let nfc = fulc, xf = fulc
  let rat = 0.0, e = 0.0
  let x = xf
  let fx = f(x)
  let num = 1
  let ffulc = fx, fnfc = fx
  let xm = 0.5 * (a + b)
  let tol1 = sqrtEps * Math.abs(xf) + xatol / 3.0
  let tol2 = 2.0 * tol1
  const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0)
  while (Math.abs(xf - xm) > tol2 - 0.5 * (b - a)) {
    let golden = true
    if (Math.abs(e) > tol1) {
      golden = false
      let r = (xf - nfc) * (fx - ffulc)
      let q = (xf - fulc) * (fx - fnfc)
      let p = (xf - fulc) * q - (xf - nfc) * r
      q = 2.0 * (q - r)
      if (q > 0.0) p = -p
      q = Math.abs(q)
      r = e
      e = rat
      if (Math.abs(p) < Math.abs(0.5 * q * r) && p > q * (a - xf) && p < q * (b - xf)) {
        rat = (p + 0.0) / q
        x = xf + rat
        if (x - a < tol2 || b - x < tol2) {
          const si = sign(xm - xf) + (xm - xf === 0 ? 1 : 0)
          rat = tol1 * si
        }
      } else golden = true
    }
    if (golden) {
      e = xf >= xm ? a - xf : b - xf
      rat = goldenMean * e
    }
    const si = sign(rat) + (rat === 0 ? 1 : 0)
    x = xf + si * Math.max(Math.abs(rat), tol1)
    const fu = f(x)
    num += 1
    if (fu <= fx) {
      if (x >= xf) a = xf
      else b = xf
      fulc = nfc; ffulc = fnfc
      nfc = xf; fnfc = fx
      xf = x; fx = fu
    } else {
      if (x < xf) a = x
      else b = x
      if (fu <= fnfc || nfc === xf) {
        fulc = nfc; ffulc = fnfc
        nfc = x; fnfc = fu
      } else if (fu <= ffulc || fulc === xf || fulc === nfc) {
        fulc = x; ffulc = fu
      }
    }
    xm = 0.5 * (a + b)
    tol1 = sqrtEps * Math.abs(xf) + xatol / 3.0
    tol2 = 2.0 * tol1
    if (num >= MAXFUN) return { x: xf, fx, converged: false }
  }
  return { x: xf, fx, converged: true }
}

export function rarFit(inputs: RarFitInputs, weighting: RarWeighting): RarFitResult {
  const { x, y } = inputs
  const n = x.length
  if (y.length !== n || inputs.sx.length !== n || inputs.sy.length !== n) return { ok: false, reason: `the input series differ in length (x ${n}, y ${y.length}, sx ${inputs.sx.length}, sy ${inputs.sy.length})` }
  if (n < 2) return { ok: false, reason: `the fit needs at least two rows; it has ${n}` }
  if (weighting !== 'errors' && weighting !== 'unweighted') return { ok: false, reason: `the weighting is ${JSON.stringify(weighting)}; this procedure takes errors or unweighted` }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) return { ok: false, reason: `row ${i} is not a finite number` }
    if (weighting === 'errors' && !(inputs.sx[i]! > 0 && inputs.sy[i]! > 0 && Number.isFinite(inputs.sx[i]!) && Number.isFinite(inputs.sy[i]!))) return { ok: false, reason: `row ${i} has a σ that is not a positive finite number (sx ${inputs.sx[i]}, sy ${inputs.sy[i]}), so it cannot weight the fit` }
  }
  const ones = new Array<number>(n).fill(1)
  const sx = weighting === 'errors' ? inputs.sx : ones
  const sy = weighting === 'errors' ? inputs.sy : ones
  const chi2 = (lb: number): number => chi2At(x, y, sx, sy, Math.exp(lb))
  const r = brentBounded(chi2, LOWER, UPPER, XATOL)
  if (!r.converged) return { ok: false, reason: `the outer minimiser did not converge in ${MAXFUN} evaluations` }
  const b = Math.exp(r.x)
  if (b < 0.01 * 1.001 || b > 100.0 / 1.001) return { ok: false, reason: `the fit sits at the solver's bound (g† ${b} × 1e-10), so it is not a minimum` }
  const h = 1e-3 * b
  const c0 = chi2(Math.log(b))
  const curv = (chi2(Math.log(b + h)) - 2 * c0 + chi2(Math.log(b - h))) / (h * h)
  const sd = curv > 0 ? Math.sqrt(2.0 / curv) : Number.NaN
  let ss = 0
  for (let i = 0; i < n; i++) { const d = y[i]! - rarLogF(x[i]!, b); ss += d * d }
  return { ok: true, outputs: { g_dagger: b, rms_v: Math.sqrt(ss / n), chi2: c0, sd_curvature: sd, n_used: n } }
}
