/**
 * Verdict Ledger — the system-of-record layer. See ./types.ts for the interface and why it matters (a regulated buyer
 * needs a book of record, not a function; and the overturn rate is the honest real-world accuracy signal).
 */

export { MemoryLedger } from './memory.js'
export type { Ledger, LedgerRecord, LedgerQuery, LedgerStats, Review, ReviewDecision } from './types.js'
export { GENESIS, verifyChain, verifyChainAgainst, entryHash, payloadHash, linkEvent } from './chain.js'
export type { LedgerEvent, LedgerEventType, ChainCheck } from './chain.js'
export { ruleCalibration, renderCalibration } from './calibration.js'
export type { RuleCalibration, CalibrationReport, CalibrationOptions } from './calibration.js'
export { renderTenantReport } from './report.js'
export type { TenantReportOptions } from './report.js'
export { openFileLedger, parseChainJSONL } from './file.js'

import { MemoryLedger } from './memory.js'
import type { Ledger } from './types.js'

/** Create the reference in-memory ledger. Swap for a DB-backed implementation of `Ledger` in production. */
export function createLedger(opts: { now?: () => Date } = {}): Ledger {
  return new MemoryLedger(opts)
}
