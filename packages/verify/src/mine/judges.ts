/**
 * The judges. This is the rule-mining gauntlet, and its logic is identical to the pre-registered Oracle-AP prototype's
 * (docs/BENCHMARK-MINE.md):
 *
 *   1. CONSISTENCY: no APPROVE case violates the candidate. With maxApprovedViolationRate = r > 0, at most a fraction r
 *      of the decidable APPROVE cases may. Otherwise the candidate dies INCONSISTENT. For an L3 candidate, t is the smallest
 *      grid value that passes this judge. If none passes, it dies INCONSISTENT "at every t".
 *   2. GROUNDING: at least `minHoldViolators` HOLD violators, and an exact p ≤ maxP (stats.ts). No violators = VOID.
 *      Too few, or p too large = BASE_RATE.
 *   3. NOVELTY: the grounded candidates are taken greedily, in descending order of HOLD coverage (ties broken by grammar
 *      order). A candidate becomes a CANDLE only if it explains at least `minNewHolds` holds that no already-accepted
 *      candle explains. Otherwise it dies REDUNDANT.
 *
 * With r = 0 every violator of a surviving candidate is a HOLD. So "HOLD violators" and "violators" coincide, and each
 * judge reduces exactly to the prototype's.
 */

import { groundingP } from './stats.js'
import { violated, type PreparedCase } from './grammar.js'
import type { CandidateSpec } from './types.js'

export interface Tally {
  /** cases the candidate can be evaluated on (its null's N) */
  decidable: number
  /** HOLD cases among them (its null's H) */
  decidableHolds: number
  /** violating case ids, all labels, in table order */
  violators: string[]
  /** violating HOLD case ids, in table order */
  holdViolators: string[]
  /** violating APPROVE cases */
  approved: number
}

export function tally(spec: CandidateSpec, cases: readonly PreparedCase[], t = 0): Tally {
  const out: Tally = { decidable: 0, decidableHolds: 0, violators: [], holdViolators: [], approved: 0 }
  for (const c of cases) {
    const v = violated(spec, c, t)
    if (v === null) continue
    out.decidable++
    if (c.hold) out.decidableHolds++
    if (!v) continue
    out.violators.push(c.id)
    if (c.hold) out.holdViolators.push(c.id)
    else out.approved++
  }
  return out
}

/** How many approved violators the rate allows among nApproved decidable approvals. */
export const allowedApproved = (rate: number, nApproved: number): number => Math.floor(rate * nApproved + 1e-9)

/** Judge 1, CONSISTENCY. With rate 0 this is the prototype's "zero approved violators". */
export function judgeConsistency(t: Tally, rate: number): { ok: true } | { ok: false; detail: string } {
  const nA = t.decidable - t.decidableHolds
  if (t.approved <= allowedApproved(rate, nA)) return { ok: true }
  return { ok: false, detail: rate > 0 ? `${t.approved} approved case(s) violate it (${t.approved}/${nA} > max rate ${rate})` : `${t.approved} approved case(s) violate it` }
}

/** The smallest t in the grid (ascending) at which the candidate passes CONSISTENCY, or undefined if there is none. */
export function learnT(spec: CandidateSpec, cases: readonly PreparedCase[], grid: readonly number[], rate: number): number | undefined {
  return grid.find((tt) => judgeConsistency(tally(spec, cases, tt), rate).ok)
}

export interface GroundingGates { minHoldViolators: number; maxP: number }

/** Judge 2, GROUNDING against the exact hypergeometric null (enrichment tail when approved exceptions exist). */
export function judgeGrounding(t: Tally, g: GroundingGates): { fate: 'VOID' | 'BASE_RATE' | 'GROUNDED'; p: number; detail: string } {
  const k = t.violators.length, h = t.holdViolators.length
  if (k === 0) return { fate: 'VOID', p: 1, detail: t.decidable === 0 ? 'no case could evaluate it (values missing)' : 'no case violates it (always true here)' }
  const p = groundingP(t.decidable, t.decidableHolds, k, h)
  if (h < g.minHoldViolators || p > g.maxP) {
    const detail = t.approved === 0
      ? `k=${k}, p=${p.toExponential(2)} (gate k>=${g.minHoldViolators}, p<=${g.maxP})`
      : `k=${k} (${h} holds, ${t.approved} approved), p=${p.toExponential(2)} (gate holds>=${g.minHoldViolators}, p<=${g.maxP})`
    return { fate: 'BASE_RATE', p, detail }
  }
  return { fate: 'GROUNDED', p, detail: '' }
}

export interface NoveltyInput { index: number; id: string; holdViolators: readonly string[] }
export interface NoveltyDecision { index: number; fate: 'CANDLE' | 'REDUNDANT'; detail: string; newHolds: number }

/** Judge 3, NOVELTY: greedy by HOLD coverage (grammar order breaks ties). Returns the decisions in acceptance order. */
export function judgeNovelty(grounded: readonly NoveltyInput[], minNewHolds: number): { decisions: NoveltyDecision[]; covered: Set<string> } {
  const order = [...grounded].sort((a, b) => b.holdViolators.length - a.holdViolators.length || a.index - b.index)
  const covered = new Set<string>()
  const accepted: NoveltyInput[] = []
  const decisions: NoveltyDecision[] = []
  for (const j of order) {
    const fresh = j.holdViolators.filter((v) => !covered.has(v))
    if (fresh.length >= minNewHolds) {
      decisions.push({ index: j.index, fate: 'CANDLE', detail: `explains ${fresh.length} new hold(s)`, newHolds: fresh.length })
      accepted.push(j)
      for (const v of j.holdViolators) covered.add(v)
    } else {
      const by = accepted.map((a) => ({ a, o: j.holdViolators.filter((v) => a.holdViolators.includes(v)).length })).sort((x, y) => y.o - x.o)[0]
      decisions.push({ index: j.index, fate: 'REDUNDANT', detail: `only ${fresh.length} new hold(s); covered by ${by?.a.id ?? '-'}`, newHolds: fresh.length })
    }
  }
  return { decisions, covered }
}
