/**
 * The C family: a numeric document field compared with a constant that is LEARNED from the labels (opt-in:
 * MineOptions.thresholds).
 *
 *   'high'  `X <= c`   large X violates (and so explains HOLDs):  "a public float of $700M or more ⇒ large accelerated"
 *   'low'   `c <= X`   small X violates
 *
 * THE LEARNER is the constrained minimum-error cut. Sort the decidable cases by X; each cut between two adjacent
 * distinct values splits them into violators and the rest. Choose the cut that minimises
 *     (HOLDs that do not violate) + (APPROVEs that do)
 * subject to CONSISTENCY: the approved violators are at most floor(rate × decidable approves). Ties go to the cut with
 * fewer approved violators. (Two cuts with equal error and equal approved violators would be the same partition.) With
 * rate 0 and separable data this is the tightest consistent cut. With exceptions it does NOT spend the allowed
 * exceptions just to move the cut, which is the downward bias of "the smallest consistent c".
 *
 * c is the midpoint between the two adjacent observed values. Any c in that gap gives the same partition, and the gap
 * is reported as the data-supported interval. The spec's eps is 0: a learned constant has no rounding band of its own.
 *
 * CAVEAT (as for L3's t, stated plainly): c is chosen FROM THE SAME LABELS, so the grounding p-value is conditional on
 * the selection and optimistic. The family counts as one variant in the reported strict gate, which is only a partial
 * correction. A C candle is a proposal for a human. The interval, not the p-value, is the evidence of where the cut is.
 */

import type { PreparedCase } from './grammar.js'
import { allowedApproved } from './judges.js'

export interface LearnedConst {
  c: number
  /** the adjacent observed values on either side of the cut (see JudgedCandidate.interval) */
  lo: number
  hi: number
  /** approved violators at the cut, and HOLDs the cut misses */
  approved: number
  missed: number
}

export type LearnConstResult = { ok: true; learned: LearnedConst } | { ok: false; fate: 'VOID' | 'INCONSISTENT'; detail: string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function learnConst(field: string, dir: 'high' | 'low', cases: readonly PreparedCase[], rate: number): LearnConstResult {
  // distinct values ascending, with HOLD / APPROVE counts at each
  const at = new Map<number, { h: number; a: number }>()
  let H = 0, A = 0
  for (const c of cases) {
    const x = num(c.fields[field])
    if (x === null) continue
    const e = at.get(x) ?? { h: 0, a: 0 }
    at.set(x, e)
    if (c.hold) { e.h++; H++ } else { e.a++; A++ }
  }
  const vals = [...at.keys()].sort((a, b) => a - b)
  if (vals.length < 2) return { ok: false, fate: 'VOID', detail: vals.length ? 'fewer than two distinct values: no cut to learn' : 'no case could evaluate it (values missing)' }
  const m = allowedApproved(rate, A)
  // cut j (1..n-1): 'high' → violators are the values at index >= j; 'low' → violators at index < j.
  // prefix sums over the ascending values
  const n = vals.length
  const hBelow: number[] = [0], aBelow: number[] = [0]
  for (let i = 0; i < n; i++) { const e = at.get(vals[i]!)!; hBelow.push(hBelow[i]! + e.h); aBelow.push(aBelow[i]! + e.a) }
  let best: { j: number; err: number; approved: number; missed: number } | null = null
  for (let j = 1; j < n; j++) {
    const approved = dir === 'high' ? A - aBelow[j]! : aBelow[j]!
    if (approved > m) continue
    const missed = dir === 'high' ? hBelow[j]! : H - hBelow[j]!
    const err = missed + approved
    if (!best || err < best.err || (err === best.err && approved < best.approved)) best = { j, err, approved, missed }
  }
  if (!best) return { ok: false, fate: 'INCONSISTENT', detail: rate > 0 ? `every cut makes more than ${m} approved case(s) violate it (rate ${rate})` : 'approved cases violate it at every cut' }
  const lo = vals[best.j - 1]!, hi = vals[best.j]!
  const mid = lo + (hi - lo) / 2
  // adjacent doubles can round the midpoint onto an endpoint; then take the endpoint that keeps the partition
  const c = lo < mid && mid < hi ? mid : dir === 'high' ? lo : hi
  return { ok: true, learned: { c, lo, hi, approved: best.approved, missed: best.missed } }
}
