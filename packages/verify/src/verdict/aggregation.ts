/**
 * The named aggregation rules: how a verdict's outcome follows from its claims. A verdict names the rule it actually uses, and
 * every reader that recomputes an outcome (the book's door, a dispute opinion) recomputes with the rule named, never an assumed one.
 *
 *   ANY_FAIL_FAILS                                 FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS
 *   ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES  FAIL if any claim FAILs; else PASS only if a claim of a kind other than
 *                                                  CONSISTENCY PASSed; else INSUFFICIENT_DATA
 *
 * The second (added 2026-09-29) is for a verdict that checks a document against itself (CONSISTENCY claims) as well as the values
 * checked against it: an internal inconsistency still FAILs it, but the document agreeing with itself never stands in for values
 * nobody verified. The e-invoice twin names it since 0.3.0 (its footing claims are CONSISTENCY; its extracted values are not).
 */
import type { Aggregation, ClaimKind, Outcome } from './schema.js'

export const AGGREGATIONS: readonly Aggregation[] = ['ANY_FAIL_FAILS', 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES']

/** The outcome `claims` give under `aggregation`. Deterministic; reads only each claim's outcome and kind. */
export function aggregateOutcome(aggregation: Aggregation, claims: readonly { outcome: Outcome; kind?: ClaimKind }[]): Outcome {
  if (claims.some(c => c.outcome === 'FAIL')) return 'FAIL'
  const passes = aggregation === 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES'
    ? claims.some(c => c.outcome === 'PASS' && c.kind !== 'CONSISTENCY')
    : claims.some(c => c.outcome === 'PASS')
  return passes ? 'PASS' : 'INSUFFICIENT_DATA'
}
