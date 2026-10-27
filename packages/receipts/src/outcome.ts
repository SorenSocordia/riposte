/**
 * The one word for can't tell (2026-10-06). The agent tools (check_done, check_claims, model_attest), the Stop hook's checks,
 * the decision gate and the model-switch monitor used to answer ABSTAIN where a verdict answers INSUFFICIENT_DATA. They now
 * answer INSUFFICIENT_DATA in JSON and "can't tell" in words, like every verdict.
 *
 * ABSTAIN is still READ. A receipt, a ledger entry or a planted truth written before says ABSTAIN and means exactly
 * INSUFFICIENT_DATA; these readers map it, so an old receipt reads as the same answer. Nothing in this package writes it.
 */

/** A check's answer: PASS, FAIL, or can't tell. */
export type CheckOutcome = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

/** The older word for can't tell, read from receipts and inputs written before 2026-10-06; never written. */
export const LEGACY_CANT_TELL = 'ABSTAIN'

/** A check's answer as written anywhere, old or new: ABSTAIN reads as INSUFFICIENT_DATA; anything else unknown is undefined. */
export function readCheckOutcome(x: unknown): CheckOutcome | undefined {
  if (x === 'PASS' || x === 'FAIL' || x === 'INSUFFICIENT_DATA') return x
  if (x === LEGACY_CANT_TELL) return 'INSUFFICIENT_DATA'
  return undefined
}
