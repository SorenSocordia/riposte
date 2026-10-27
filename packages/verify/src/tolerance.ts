/**
 * Tolerance as a STATED POLICY, not a hidden constant.
 *
 * The market told us plainly: a checker that flags a penny is turned off in a week. Two independent practitioners who
 * hand-audited thousands of invoices converged on the same rule — tolerate up to **max($0.02, 0.05% of the total)** and
 * treat that as rounding, not error. So tolerance here has two parts:
 *
 *   - the ABSOLUTE floor each rule already carries (a rule's own `predicate.tolerance`: $0.01 for currency, 0.005 for a
 *     percentage) — the kernel applies this when it decides PASS/FAIL;
 *   - a RELATIVE band `rel × |expected|` layered on top by this policy, which the kernel does not do.
 *
 * A money FAIL whose |variance| falls within `max(absFloor, rel × |expected|)` is reclassified PASS and labelled as
 * rounding — the variance stays visible so a reviewer sees the cents; nothing is hidden. Because the relative band is a
 * fraction of the compared magnitude, it does NOTHING to percentage claims (whose magnitude is a fraction < 1) — they
 * keep their own 0.005 tolerance untouched. A ruleset opts in with a non-zero `rel`; `rel = 0` is strict (every cent counts).
 *
 * The relative band alone grows with the document: 0.03% of $10M forgives $3,000, which is not rounding. So a policy can
 * CAP the band at what rounding can actually produce on the claim (`roundingCap`, added 2026-09-28 for invoice ruleset
 * 0.1.0): U × k, where U is the document's grain (the unit it rounds to) and k the number of rounding steps behind the
 * claim. The cap only ever tightens: it never turns a FAIL into a PASS. It forgives rounding, not materiality; a deployment
 * that wants a materiality band declares one as an override, and the verdict's input identity commits to that override.
 *
 * Provisional: 0.05% is the practitioners' number, not yet measured on our own held-out corpus (roadmap 1.4). It is a
 * per-ruleset default and a per-call override, never baked into an axiom.
 */

import type { ClaimVerdict } from './verdict/schema.js'
import { round4 } from './verdict/from-report.js'

/** How the rounding cap counts a claim's rounding steps. */
export interface RoundingCap {
  /**
   * Rule ids whose claim can absorb one rounding per document line on top of its own operands: a tax may be rounded line
   * by line and then summed, so the invoice ruleset lists TAX_INT.
   */
  perLine?: readonly string[]
  /**
   * Rule ids whose STATED value may have been rounded once to a cash step (added 2026-09-28, tuned on a real receipt): a
   * payable total rounded to the nearest 100 rupiah, 0.05 franc or whole krona. The step S is the largest of
   * {100, 50, 10, 5} × U that divides the stated value, and the cap gains S/2. The invoice ruleset lists TOTAL_INT.
   */
  cashStep?: readonly string[]
}

export interface TolerancePolicy {
  /** Relative band as a fraction of the expected magnitude (0.0005 = 0.05%). 0 = strict. */
  rel: number
  /**
   * Absolute CAP on the relative band, in the document's units. 0 = no fixed cap. A fixed cap is currency-blind (one unit
   * of rupiah is not one unit of dinar); `roundingCap` is the cap that follows the document.
   */
  absCap: number
  /**
   * Cap the relative band at U × k, the most rounding can produce on the claim:
   *  - U, the document's grain: 1 when every amount its recompute claims assert is a whole number, else 0.01. Never above
   *    1: a round number is not a rounded one, and a grain read from round numbers would be the attacker's to choose;
   *  - k, the claim's rounding steps: the reported (not computed) numeric operands on its receipt, plus one per line for
   *    the rules listed in `perLine`;
   *  - plus half a cash step, for the rules listed in `cashStep`.
   * Absent = no such cap (such a policy behaves exactly as before, byte for byte).
   */
  roundingCap?: RoundingCap
}

/** Default for invoice ruleset 0.0.1: a 0.03% relative band over the rule's floor, uncapped (2026-09-28). */
export const PRACTITIONER: TolerancePolicy = { rel: 0.0003, absCap: 0 }
/**
 * Default for invoices from ruleset 0.1.0 (2026-09-28): the same 0.03% band, capped at what rounding can produce (U × k).
 * 0.03% forgives real rounding across currencies (rupiah receipts round to ~0.003% of total); the cap stops the band from
 * growing with the document ($2,500 on a $10M line is not rounding).
 */
export const CAPPED: TolerancePolicy = { rel: 0.0003, absCap: 0, roundingCap: { perLine: ['TAX_INT'], cashStep: ['TOTAL_INT'] } }
/** Strict: no relative band. Every cent counts (construction pay apps — GCs kick back on cents). */
export const STRICT: TolerancePolicy = { rel: 0, absCap: 0 }

/**
 * Why `t` is not a tolerance override the engines can read exactly as its identity hashes it, or undefined when it is one
 * (2026-10-05; a cold reader's Collision A, cold review round 2). The shape is checked strictly, because the identity below and
 * the engine must read the same thing: `{ rel, absCap, roundingCap?: { perLine?, cashStep? }, rounding? }`, where rel and absCap
 * are finite numbers ≥ 0, perLine and cashStep are arrays of rule-id strings, rounding is 'infer' or 'none' (the declarative
 * engine's mode), and no other key is present. Before this check, `perLine: "TAX_INT"` (a string) and `perLine: ["T","A","X",
 * "_","I","N","T"]` (its characters) hashed alike, while the engine's `.includes()` read them differently: one verdict_id named
 * a PASS and a FAIL. Every input that issued a verdict before passes unchanged: the engines never read anything else.
 */
export function toleranceProblem(t: unknown): string | undefined {
  const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
  const shape = '{ "rel": <number ≥ 0>, "absCap": <number ≥ 0>, "roundingCap"?: { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }, "rounding"?: "infer" | "none" }'
  if (!isObj(t)) return `tolerance must be an object ${shape}`
  const extra = Object.keys(t).filter(k => !['rel', 'absCap', 'roundingCap', 'rounding'].includes(k))
  if (extra.length) return `tolerance carries ${extra.map(k => JSON.stringify(k)).join(', ')}, which no engine reads (so its identity would not commit to it); the shape is ${shape}`
  for (const k of ['rel', 'absCap'] as const) {
    const v = t[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `tolerance.${k} must be a finite number ≥ 0 (got ${typeof v === 'number' ? String(v) : JSON.stringify(v) ?? typeof v})`
  }
  if (t.rounding !== undefined && t.rounding !== 'infer' && t.rounding !== 'none') return `tolerance.rounding must be "infer" or "none" (got ${JSON.stringify(t.rounding) ?? typeof t.rounding})`
  if (t.roundingCap !== undefined) {
    const rc = t.roundingCap
    if (!isObj(rc)) return `tolerance.roundingCap must be an object { "perLine"?: [<rule id>...], "cashStep"?: [<rule id>...] }`
    const extraRc = Object.keys(rc).filter(k => k !== 'perLine' && k !== 'cashStep')
    if (extraRc.length) return `tolerance.roundingCap carries ${extraRc.map(k => JSON.stringify(k)).join(', ')}, which no engine reads; it takes "perLine" and "cashStep"`
    for (const k of ['perLine', 'cashStep'] as const) {
      const v = rc[k]
      if (v === undefined) continue
      if (!Array.isArray(v)) return `tolerance.roundingCap.${k} must be an array of rule-id strings, such as ["TAX_INT"] (got ${typeof v === 'string' ? `the string ${JSON.stringify(v)}` : JSON.stringify(v) ?? typeof v}): a string would be read one character at a time by the hash but as one id by the engine`
      const bad = v.findIndex(x => typeof x !== 'string')
      if (bad >= 0) return `tolerance.roundingCap.${k}[${bad}] must be a rule-id string (got ${JSON.stringify(v[bad]) ?? typeof v[bad]})`
    }
  }
  return undefined
}

/**
 * The part of a tolerance override that can change an outcome, in a stable shape: what a verdict's input identity
 * commits to when an override is given (D-TOL-ID). `rounding` is the declarative engine's rounding-aware mode.
 * The rule-id lists keep their type (2026-10-05): an array is copied as it was, byte for byte as before; anything
 * else (a string, which toleranceProblem refuses wherever a verdict is issued) is kept as given, so it can never hash like the
 * array of its characters.
 */
export function toleranceIdentity(t: TolerancePolicy & { rounding?: string }): Record<string, unknown> {
  const list = (x: unknown): unknown => (Array.isArray(x) ? [...x] : x === undefined ? [] : x)
  return {
    rel: t.rel,
    absCap: t.absCap,
    ...(t.rounding !== undefined ? { rounding: t.rounding } : {}),
    ...(t.roundingCap !== undefined ? {
      roundingCap: { perLine: list(t.roundingCap.perLine), cashStep: list(t.roundingCap.cashStep) },
    } : {}),
  }
}

/** The document's grain: 1 when every amount its recompute claims assert is a whole number, else 0.01 (and 0.01 when none do). */
export function documentGrain(claims: readonly ClaimVerdict[]): number {
  let any = false
  for (const c of claims) {
    if (c.kind !== 'RECOMPUTE' || typeof c.asserted !== 'number' || !Number.isFinite(c.asserted)) continue
    any = true
    if (Math.abs(c.asserted - Math.round(c.asserted)) > 1e-9) return 0.01
  }
  return any ? 1 : 0.01
}

/** A claim's own rounding steps: the reported (not computed) numeric operands on its receipt. */
export function roundingSteps(claim: ClaimVerdict): number {
  let k = 0
  for (const e of claim.evidence) {
    if (e.locator.kind === 'field' && e.locator.source !== 'computed' && typeof e.value === 'number') k++
  }
  return k
}

/** The cash step a stated value sits on: the largest of {100, 50, 10, 5} × U that divides it, or 0. */
export function cashStepOf(stated: unknown, grain: number): number {
  if (typeof stated !== 'number' || !Number.isFinite(stated)) return 0
  for (const m of [100, 50, 10, 5]) {
    const s = m * grain
    const q = stated / s
    if (Math.abs(q - Math.round(q)) < 1e-9) return round4(s)
  }
  return 0
}

function lineCount(claims: readonly ClaimVerdict[]): number {
  const lines = new Set<string>()
  for (const c of claims) {
    const m = /^line\[(\d+)\]\./.exec(c.claim_id)
    if (m) lines.add(m[1] as string)
  }
  return lines.size
}

/**
 * Apply the policy to a claim list in place:
 *  - stamp `computation.tolerance.rel` on every numeric claim (transparency: the reviewer sees the band that was used);
 *  - reclassify a numeric FAIL to PASS when |variance| ≤ max(absFloor, rel × |expected|), capped as the policy says,
 *    labelling it as rounding.
 */
export function applyTolerancePolicy(claims: ClaimVerdict[], policy: TolerancePolicy): void {
  if (policy.rel <= 0) return
  const rc = policy.roundingCap
  const grain = rc ? documentGrain(claims) : 0
  const lines = rc?.perLine?.length ? lineCount(claims) : 0
  for (const c of claims) {
    const comp = c.computation
    if (!comp || typeof comp.result !== 'number') continue
    const absFloor = comp.tolerance?.abs ?? 0.01
    comp.tolerance = { abs: absFloor, rel: policy.rel }
    if (c.outcome !== 'FAIL' || typeof c.variance !== 'number') continue
    // The relative band is capped: a difference above the cap is a real error, however small a fraction of the total.
    const cap = policy.absCap > 0 ? policy.absCap : Infinity
    if (!rc) {
      const eff = Math.max(absFloor, Math.min(policy.rel * Math.abs(comp.result), cap))
      if (Math.abs(c.variance) <= eff + 1e-9) {
        c.outcome = 'PASS'
        c.locked = false
        c.explanation = `Within tolerance (|variance| ${round4(Math.abs(c.variance))} ≤ ${round4(eff)} = min(${round4(policy.rel * 100)}% of ${comp.result}, cap $${policy.absCap}), floor $${absFloor}): treated as rounding, not error. ${c.explanation}`
      }
      continue
    }
    const relBand = Math.min(policy.rel * Math.abs(comp.result), cap)
    const k = roundingSteps(c) + (rc.perLine?.includes(c.rule_id) ? lines : 0)
    const step = rc.cashStep?.includes(c.rule_id) ? cashStepOf(c.asserted, grain) : 0
    const roundCap = round4(grain * k + step / 2)
    const eff = Math.max(absFloor, Math.min(relBand, roundCap))
    const v = round4(Math.abs(c.variance))
    const capText = `rounding cap ${grain} × ${k} step${k === 1 ? '' : 's'}${step > 0 ? ` + half a cash step of ${step}` : ''} = ${roundCap}${policy.absCap > 0 ? `, cap ${policy.absCap}` : ''}`
    if (Math.abs(c.variance) <= eff + 1e-9) {
      c.outcome = 'PASS'
      c.locked = false
      c.explanation = `Within tolerance (|variance| ${v} ≤ ${round4(eff)} = min(${round4(policy.rel * 100)}% of ${comp.result}, ${capText}), floor ${absFloor}): treated as rounding, not error. ${c.explanation}`
    } else if (Math.abs(c.variance) <= Math.max(absFloor, relBand) + 1e-9) {
      // Say why the relative band alone would have forgiven it and the cap did not: rounding cannot produce this much.
      c.explanation = `${c.explanation} Not treated as rounding: |variance| ${v} is within ${round4(policy.rel * 100)}% of ${comp.result} but above the ${capText} (the most rounding can produce on this claim).`
    }
  }
}
