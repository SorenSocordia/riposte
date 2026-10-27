/**
 * sparc.vflat@1: the flat rotation velocity V_f of Lelli, McGaugh & Schombert 2016, ApJL 816, L14, Section 2.2.
 * The registry entry (./index.ts) carries the quoted source and the reading. THIS FILE IS THE IMPLEMENTATION: its bytes (line
 * ends folded to LF) are pinned by `implementation_sha256` in ./index.ts, a test recomputes that hash, and a verdict made with
 * this procedure carries the pin. Change a byte here and the pin moves: every verdict made with the old bytes then refuses to
 * replay. A changed procedure is a new version (sparc.vflat@2), never an edit of this one.
 *
 * The procedure, as read: the rows are ordered by strictly increasing radius. Start with the mean of the two outermost
 * velocities. While the next velocity inward lies within 5% of the running mean (|V - mean| / mean <= 0.05), include it and
 * recompute the mean over every included velocity; stop at the first velocity that does not. The mean is summed outermost
 * first, left to right. A curve whose first test fails is rejected (the source rejects it), as is a curve of fewer than three
 * points or one whose radius is not strictly increasing.
 */

export interface SparcVflatInputs {
  /** galactocentric radius per row, in the table's order */
  rad: readonly number[]
  /** observed rotation velocity per row, in the table's order */
  v: readonly number[]
}

export type SparcVflatResult =
  | { ok: true; outputs: { vflat: number; n_used: number; r_inner: number } }
  | { ok: false; reason: string }

/** The 5% flatness condition of the source's eq. (2). */
const FLAT_FRACTION = 0.05

export function sparcVflat(inputs: SparcVflatInputs): SparcVflatResult {
  const { rad, v } = inputs
  const n = v.length
  if (rad.length !== n) return { ok: false, reason: `the radius and velocity series differ in length (${rad.length} and ${n})` }
  if (n < 3) return { ok: false, reason: `the curve has ${n} point${n === 1 ? '' : 's'}; the procedure needs at least three (the source keeps only curves flat over at least three velocity points)` }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(rad[i] as number) || !Number.isFinite(v[i] as number)) return { ok: false, reason: `row ${i} is not a finite number` }
  }
  for (let i = 1; i < n; i++) {
    if (!((rad[i] as number) > (rad[i - 1] as number))) return { ok: false, reason: `the radius is not strictly increasing at row ${i} (${rad[i - 1]} then ${rad[i]}), so the outermost points are not defined` }
  }
  const included: number[] = [v[n - 1] as number, v[n - 2] as number]
  const meanOf = (xs: readonly number[]): number => { let s = 0; for (const x of xs) s += x; return s / xs.length }
  for (let k = n - 3; k >= 0; k--) {
    const mean = meanOf(included)
    if (!(mean > 0)) return { ok: false, reason: `the running mean is ${mean}, not positive, so the fractional condition is undefined` }
    const frac = Math.abs((v[k] as number) - mean) / mean
    if (!(frac <= FLAT_FRACTION)) {
      if (k === n - 3) return { ok: false, reason: `the first test fails: row ${k} (radius ${rad[k]}) differs from the mean of the two outermost points by a fraction ${Number(frac.toFixed(4))} > ${FLAT_FRACTION}; the source rejects such a curve` }
      break
    }
    included.push(v[k] as number)
  }
  return { ok: true, outputs: { vflat: meanOf(included), n_used: included.length, r_inner: rad[n - included.length] as number } }
}
