/**
 * Verdict Ledger — the system-of-record layer. See ./types.ts for the interface and why it matters (a regulated buyer
 * needs a book of record, not a function; and the overturn rate is the honest real-world accuracy signal).
 */

export { MemoryLedger, ChainExportTooLarge, CHAIN_EXPORT_MAX_CHARS } from './memory.js'
export type { Ledger, LedgerRecord, LedgerQuery, LedgerStats, Review, ReviewDecision, ContentCheckOptions } from './types.js'
export { GENESIS, verifyChain, verifyChainAgainst, entryHash, payloadHash, linkEvent, PAYLOAD_VIEW, payloadViewOf } from './chain.js'
export type { LedgerEvent, LedgerEventType, ChainCheck, ChainSnapshot, ChainWalkOptions, PayloadViewInfo } from './chain.js'
export { LedgerFileChanged, RECORD_FACTS, recordFacts, recordFactsAt, evidenceMark } from './disk.js'
export type { VerdictFacts, RecordFacts, EvidenceMark } from './disk.js'
export { ruleCalibration, renderCalibration } from './calibration.js'
export type { RuleCalibration, CalibrationReport, CalibrationOptions } from './calibration.js'
export { renderTenantReport } from './report.js'
export type { TenantReportOptions } from './report.js'
export {
  openFileLedger, parseChainJSONL, readChainFile, repairTornTail, chainLines, writeChainJSONL, writeChainFile, TornTailError, LedgerFileCorrupt,
  LedgerReadOnly,
} from './file.js'
export type { FileLedger, FileLedgerOptions, ChainFile, TornTail, RepairReport, ChainSource } from './file.js'
export {
  signDecision, verifySignedDecision, verifySignature, decisionProblem, decisionId, decisionSubject, decisionConflict, makeGrant, readDecisionBook,
  grantInForce, grantAt, declinesFor, revisionsOf, canarySealsFor, canaryRevealsFor, isDecisionKind, DecisionRefused, DECISION_KINDS, DECISION_LEVELS,
  DECISION_SIGNING_PREFIX, CANARY_COMMIT_PREFIX, canaryCommitment, makeReview, makeKeyRegister, makeKeyRevoke, authorizeSigner, registryOf,
  BOOK_DECISION_KINDS, isBookDecisionKind, decisionTenant,
} from './decisions.js'
export type {
  Decision, DecisionKind, GrantDecision, DeclineDecision, DeclineEvidence, PolicyRevisionDecision, SignedDecision, TrustedKeys,
  DecisionEntry, DecisionPayload, DecisionBook, DecisionCheck, KeyRegisterDecision, KeyRevokeDecision, CanarySealDecision,
  CanaryRevealDecision, ReviewDecisionBody, Signable, SignedReviewEntry, AnchorOptions, BookDecision, BookDecisionKind, KeyDecision,
  CanaryDecision, KeyDecisionKind, CanaryDecisionKind,
} from './decisions.js'
export { KeyRegistry, ROLES, ROLE_FOR, isRole, keyFingerprint, tenantOfWorkflow } from './registry.js'
export type { Role, RootKeys, KeyEntry, Authorization, SignedKind } from './registry.js'
export {
  PERIOD_UNITS, PERIOD_LENGTH_RANK, STRATA, SAMPLE_SEED_PREFIX, SampleRefused, isPeriodUnit, periodAt, nextPeriodEnd, chainClock,
  chainPeriods, periodFrame, recordWorkflow, sampleSeed, drawSize, drawStratum, deriveSample, sampleSubject, sampleKey,
} from './sampling.js'
export type { PeriodUnit, PeriodSpan, Stratum, SampleRates, SampleBody, SamplePayload, SampleEntry, SampleRequest } from './sampling.js'

import { MemoryLedger } from './memory.js'
import type { Ledger } from './types.js'
import type { TrustedKeys } from './decisions.js'
import type { RootKeys } from './registry.js'

/**
 * Create the reference in-memory ledger. Swap for a DB-backed implementation of `Ledger` in production. With `trusted_keys`
 * (signer_id → public key), only a decision signed by the key anchored to its signer passes the door. With `root_keys` (the
 * registry's root public key), the key registry on the book (KEY_REGISTER / KEY_REVOKE) anchors every signer once it is in force.
 */
export function createLedger(opts: { now?: () => Date; trusted_keys?: TrustedKeys; root_keys?: RootKeys } = {}): Ledger {
  return new MemoryLedger(opts)
}
