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
 * Provisional: 0.05% is the practitioners' number, not yet measured on our own held-out corpus (roadmap 1.4). It is a
 * per-ruleset default and a per-call override, never baked into an axiom.
 */

import type { ClaimVerdict } from './verdict/schema.js'
import { round4 } from './verdict/from-report.js'

export interface TolerancePolicy {
  /** Relative band as a fraction of the expected magnitude (0.0005 = 0.05%). 0 = strict. */
  rel: number
  /**
   * Absolute CAP on the rounding band, in the document's units. The relative band is for rounding, and rounding is
   * bounded by cents-per-line — NOT by a percentage of a huge total. Without a cap, 0.05% of a $10M invoice would forgive
   * a $5,000 error. The band never exceeds this. Default $1.00 (covers cumulative cent-rounding on a normal invoice).
   */
  absCap: number
}

/**
 * Default for invoices: a 0.03% relative rounding band over the rule's floor, no absolute cap.
 * 0.03% forgives real cross-currency rounding (rupiah receipts round to ~0.003% of total; cent-rounding is far smaller)
 * while catching material errors that a looser 0.05% band would hide (a red-team break: $4,900 on a $10M invoice = 0.049%,
 * now caught). `absCap` (in the document's units) is available for single-currency deployments that want a hard ceiling;
 * a currency-aware per-line tolerance is the rigorous long-term fix (roadmap).
 */
export const PRACTITIONER: TolerancePolicy = { rel: 0.0003, absCap: 0 }
/** Strict: no relative band. Every cent counts (construction pay apps — GCs kick back on cents). */
export const STRICT: TolerancePolicy = { rel: 0, absCap: 0 }

/**
 * Apply the policy to a claim list in place:
 *  - stamp `computation.tolerance.rel` on every numeric claim (transparency: the reviewer sees the band that was used);
 *  - reclassify a numeric FAIL to PASS when |variance| ≤ max(absFloor, rel × |expected|), labelling it as rounding.
 */
export function applyTolerancePolicy(claims: ClaimVerdict[], policy: TolerancePolicy): void {
  if (policy.rel <= 0) return
  for (const c of claims) {
    const comp = c.computation
    if (!comp || typeof comp.result !== 'number') continue
    const absFloor = comp.tolerance?.abs ?? 0.01
    comp.tolerance = { abs: absFloor, rel: policy.rel }
    if (c.outcome !== 'FAIL' || typeof c.variance !== 'number') continue
    // The relative band is capped: a difference above the cap is a real error, however small a fraction of the total.
    const cap = policy.absCap > 0 ? policy.absCap : Infinity
    const eff = Math.max(absFloor, Math.min(policy.rel * Math.abs(comp.result), cap))
    if (Math.abs(c.variance) <= eff + 1e-9) {
      c.outcome = 'PASS'
      c.locked = false
      c.explanation = `Within tolerance (|variance| ${round4(Math.abs(c.variance))} ≤ ${round4(eff)} = min(${round4(policy.rel * 100)}% of ${comp.result}, cap $${policy.absCap}), floor $${absFloor}): treated as rounding, not error. ${c.explanation}`
    }
  }
}
