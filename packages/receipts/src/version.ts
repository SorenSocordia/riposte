/**
 * Which checker wrote a receipt, and which build of it. Every decision receipt and every check this package appends to the
 * ledger names both (`checker: { id, version }`, added 2026-09-29), so a calibration record can count each version on its
 * own: a new version earns its own record.
 *
 * Additive. A receipt written before carries no `checker`, and it verifies byte for byte as before, because its id, hash
 * and signature cover exactly what it holds (test/checker-stamp.test.ts replays such a ledger). Notes, compactions and
 * model switches are not checks, so they carry none.
 *
 * A test asserts CHECKER_VERSION === package.json.version, the way verify's ENGINE_VERSION is pinned.
 */
export const CHECKER_VERSION = '0.0.1'

/** One id per check this package performs. */
export const CHECKER_IDS = {
  decision: 'riposte.receipts.gate',
  claims_check: 'riposte.receipts.claims',
  done_check: 'riposte.receipts.done',
  ap_gate: 'riposte.receipts.ap-gate',
  model_attest: 'riposte.receipts.model-attest',
} as const

export type CheckerKind = keyof typeof CHECKER_IDS

export interface CheckerStamp { id: string; version: string }

export function checkerStamp(kind: CheckerKind): CheckerStamp {
  return { id: CHECKER_IDS[kind], version: CHECKER_VERSION }
}

/** A check's ledger body plus the checker that wrote it: one more key, everything else unchanged. */
export function stamped<T extends object>(kind: CheckerKind, body: T): T & { checker: CheckerStamp } {
  return { ...body, checker: checkerStamp(kind) }
}
