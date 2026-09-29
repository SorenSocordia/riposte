/**
 * The package's public surface. verify() and its options live in ./verify.ts; this file only re-exports.
 *
 * A module under src/ that needs verify() imports it from ./verify.js, never from here: this barrel re-exports most of
 * src/, so importing it from inside makes a cycle, and a bundle of one path (the action hook, replay) would pull the whole
 * package in (core-tidy, 2026-09-29). test/barrel-imports.test.ts holds the line.
 */

export {
  verify, verifyBatch, replayView, referenceMultiplicity,
  type Json, type VerifyOptions, type BatchItem, type BatchResult,
} from './verify.js'

// ---------------------------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------------------------

export { ENGINE_VERSION, RULESET, PAY_APP_RULESET_REF, SCHEMA_VERSION } from './version.js'
export { RULESETS, INVOICE_RULESET, PAY_APP_RULESET, resolveRuleset, RULESET_VERSIONS, INVOICE_RULESET_V0_0_1 } from './rulesets/index.js'
export type { Ruleset, RulesetRef } from './rulesets/types.js'
export { MIN_VERDICT_CONFIDENCE } from './verdict/from-report.js'
export { setGavelLogger } from './kernel/validation-gavel.js'
export { setBridgeLogger } from './binding/ontological-bridge.js'
export { canonicalize, hashOf, sha256 } from './verdict/canonical.js'
export { verifyAction, type ProposedAction, type ActionSources, type ApprovedRecord, type VerifyActionOptions } from './action/index.js'
export { AGGREGATIONS, aggregateOutcome } from './verdict/aggregation.js'
export { verifyCitations, verifyCitation, renderCitationAudit, type Citation, type OpinionSources } from './legal/index.js'
export { verifyInvoiceMatch, splitApLayout, AP_RULESET, type PriorInvoice, type ApDocuments, type ApPolicy, type ApResult, type ApDecision, type VerifyInvoiceMatchOptions } from './ap/index.js'
export { parseInvoice, parsePurchaseOrder, parseGoodsReceipt, type ParsedInvoice, type ParsedPo, type InvoiceLine, type PoLine, type ReceiptLine } from './ap/parse.js'
export { verifyDeclarative } from './declarative/evaluate.js'
export { isDeclarativeRuleset, type DeclarativeRuleset, type DeclField, type DeclCheck } from './declarative/types.js'
export { evalExpr } from './declarative/expr.js'
export { lintRuleset, type LintResult } from './declarative/lint.js'
export { measureRuleset, renderMeasurement, type LabeledCase, type RulesetMeasurement } from './declarative/measure.js'
export { attachDeclaredAccuracy } from './verdict/accuracy.js'
export {
  channelOf, assertVerdict, proofProblem, stampVerdictChannel, serializeVerdict, renderVerdict, makeCounsel, isCounsel,
  counselFromCandle, counselFromReport, counselFromReasoned, advisoriesFromVerdict, renderCounsel, renderChanneled,
  serializeChanneled, ChannelViolation, STRENGTHS,
  type Channel, type Counsel, type CounselInput, type JudgeResult, type GeneratedProvenance, type Strength, type ReasonedOptions,
} from './verdict/channel.js'
export {
  actionNotice, renderActionNotice, verdictFindings, renderFindings, disputeCommand, ACTION_HANDLING,
  type ActionNotice, type ActionHandling, type Finding, type VerdictFindings,
} from './verdict/notices.js'
export { normalQuantile, binomialCdf, wilsonInterval, clopperPearsonInterval, rateInterval, type BoundMethod, type Interval } from './verdict/bounds.js'
export {
  workflowCalibrations, workflowCalibration, defaultWorkflowOf, lintPolicy, revisePolicy, assessVoice, assessRung, policyRef,
  calibrationIntact, consecutiveErrorsToBreach, errorsInHorizonToBreach, cleanReviewsToClear, levelRank, VOICE_LADDER, RUNGS,
  RUNG_METRIC, EXAMPLE_PROMOTION_POLICY,
  type VoiceLevel, type Rung, type RungMetric, type WorkflowCalibration, type WorkflowCalibrationOptions, type RungBar,
  type TierRequirements, type PromotionPolicy, type PolicyRef, type PolicyRevision, type PolicyLint, type Grant,
  type WorkflowDeclaration, type RungAssessment, type PromotionProposal, type DemotionProposal, type VoiceProposal,
  type FailingCase, type VoiceAssessment,
} from './verdict/voice.js'
export {
  promotionOpinion, disputeOpinion, renderOpinion, opinionJSON, openSnapshot, snapshotOfLedger, snapshotFromChainJSONL,
  opinionIntact, OPINION_VERSION, defaultOwnsWorkflow,
  disputeRuling, signRuling, verifySignedRuling, rulingProblem, rulingId, rulingBookJSONL, parseRulingBook,
  RULING_SIGNING_PREFIX, LAW_RULINGS,
  statuteFromRulings, statuteCounsel, statuteIntact, statuteMineFiles, STATUTE_VERSION, STATUTE_GENERATOR,
  type PromotionOpinionInput, type DisputeOpinionInput, type LedgerSnapshot, type SnapshotView, type SnapshotOptions,
  type Opinion, type OpinionRef,
  type OpinionSubject, type Premise, type Reading, type CitedCell, type Authority, type Precedent, type PrecedentEntry,
  type Ruling, type Disposition, type DissentPoint, type DissentTopic, type OverturnCondition,
  type OpinionScope, type DecisionCite, type DeclinedBy,
  type DisputeRuling, type SignedRuling, type LawRuling, type RulingCheck, type OpinionParams,
  type Statute, type StatuteInput, type StatuteRow, type StatuteCell,
} from './opinion/index.js'
export { createLedger, MemoryLedger, type Ledger, type LedgerRecord, type LedgerQuery, type LedgerStats, type Review, type ReviewDecision } from './ledger/index.js'
export { GENESIS, verifyChain, verifyChainAgainst, entryHash, payloadHash, linkEvent, type LedgerEvent, type LedgerEventType, type ChainCheck } from './ledger/index.js'
export { ruleCalibration, renderCalibration, type RuleCalibration, type CalibrationReport, type CalibrationOptions } from './ledger/index.js'
export { renderTenantReport, type TenantReportOptions } from './ledger/index.js'
export { openFileLedger, parseChainJSONL } from './ledger/index.js'
// Ledger at scale (2026-09-28): snapshot by reference, streamed export and reopen, torn-tail recovery.
export {
  ChainExportTooLarge, CHAIN_EXPORT_MAX_CHARS, readChainFile, repairTornTail, chainLines, writeChainJSONL, writeChainFile,
  TornTailError, LedgerFileCorrupt, LedgerReadOnly, LedgerFileChanged, PAYLOAD_VIEW, payloadViewOf,
  type ChainSnapshot, type ContentCheckOptions, type FileLedger, type FileLedgerOptions, type ChainFile, type TornTail,
  type RepairReport, type ChainSource, type PayloadViewInfo, type ChainWalkOptions,
} from './ledger/index.js'
export {
  signDecision, verifySignedDecision, decisionProblem, decisionId, decisionSubject, decisionConflict, makeGrant,
  readDecisionBook, grantInForce, declinesFor, revisionsOf, isDecisionKind, DecisionRefused, DECISION_KINDS,
  DECISION_LEVELS, DECISION_SIGNING_PREFIX,
  type Decision, type DecisionKind, type GrantDecision, type DeclineDecision, type DeclineEvidence, type PolicyRevisionDecision,
  type SignedDecision, type TrustedKeys, type DecisionEntry, type DecisionPayload, type DecisionBook, type DecisionCheck,
} from './ledger/index.js'
export { verdictDoorProblem, isRecordableVerdict, type VoiceConfig, type UnrecordedEvent } from './http/service.js'
export {
  voiceSurface, voiceFromJson, opinionFromJson, twinFromJson, snapshotFromJson, policyFromJson, declarationFromJson, bookStatus,
  SurfaceInputError, TWIN_MAP_VERSIONS, TWIN_MAP_STATUS, TWIN_RULESETS, reconcileFromJson, populationFromJson, rootKeysFromJson, anchorsFromJson, actionCheckFromJson, actionDisposition, actionFromJson, levelFromJson, trustedKeysFromJson,
  grantSettings,
  type ActionCheckSurface, type ActionDisposition, type ReconcileSurface, type ReconcileContext, type TwinMapStatus,
  type VoiceSurface, type OpinionSurface, type OpinionContext, type BookStatus, type WorkflowSettings,
} from './http/surfaces.js'
export {
  tenantOpinions, renderOpinionsSection, monthPeriod, readRung, readVoiceBook, bookRefusal, declarationsOverridden, isBookSettings,
  type BookSettings, type RungRead, type OverriddenDeclaration, type DeclinedProposal,
  type TenantOpinions, type OpenProposal, type WorkflowVoiceRow, type NoticeRow, type WorkflowNotices, type RungNotices, type ReportPeriod,
} from './ledger/report.js'
export {
  assessVoiceFromLedger, declineDecision, declineStanding, grantForProposal, policyRevisionDecision, isBookDeclaration,
  RESEARCH_PROMOTION_POLICY, RESEARCH_REPORT, dollarBar, grantUnderPolicy, declineOnBook,
  type BookDeclaration, type ChainExport, type BookCitation, type DeclineCitation, type StandingDecline,
  type SamplingPlan, type EvidenceRequirements,
} from './verdict/voice.js'
// Evidence integrity (2026-09-28): key registry + roles, signed reviews, verifiable sampling, canaries, tenancy.
export {
  verifySignature, makeReview, makeKeyRegister, makeKeyRevoke, authorizeSigner, registryOf, grantAt, canarySealsFor,
  canaryRevealsFor, canaryCommitment, CANARY_COMMIT_PREFIX, KeyRegistry, ROLES, ROLE_FOR, isRole, keyFingerprint,
  SampleRefused, deriveSample, chainPeriods, periodAt, nextPeriodEnd, chainClock, periodFrame, recordWorkflow, sampleSeed,
  drawSize, drawStratum, sampleSubject, sampleKey, PERIOD_UNITS, isPeriodUnit, STRATA, SAMPLE_SEED_PREFIX,
  tenantOfWorkflow, decisionTenant, BOOK_DECISION_KINDS, isBookDecisionKind,
  type KeyRegisterDecision, type KeyRevokeDecision, type CanarySealDecision, type CanaryRevealDecision, type ReviewDecisionBody,
  type Signable, type SignedReviewEntry, type AnchorOptions, type Role, type RootKeys, type KeyEntry, type Authorization,
  type PeriodUnit, type PeriodSpan, type Stratum, type SampleRates, type SampleBody, type SampleEntry, type SampleRequest,
  type BookDecision, type BookDecisionKind, type KeyDecision, type CanaryDecision, type KeyDecisionKind, type CanaryDecisionKind,
} from './ledger/index.js'
export { zeroMissN, successLowerBound, describeBound, oneSidedLevel, SIDEDNESS, type Sidedness } from './verdict/bounds.js'
// D-ANCHOR + R3 (security fix, 2026-09-28): unanchored decisions have no rung effect; recorded verdicts are re-checked on read.
export { isAnchored, noEffect, noEffectNotice, ANCHOR_HINT, recordedVerdictProblem, carryOwnRead, governingProblem, type NoEffect } from './ledger/decisions.js'
// D-DUAL + D-GOVERNING-POLICY surfaces (2026-09-28): the declared policy judges every grant; the second signature.
export { governedRead, governedSignatures, governing, type GovernedRead } from './http/dual.js'
export { cosignFromJson, type CosignSurface } from './http/cosign.js'
export {
  auditEvidence, auditApplies, samplingRates, chainOf, reviewsBy, dueSamples, commitDueSamples, reviewQueue, sealCanaries,
  revealCanaries, newSalt,
  type EvidenceAdjustment, type EvidenceCitation, type PeriodDraw, type QueueItem,
} from './surveillance/index.js'
export { route, type HttpRequest, type HttpResponse } from './http/router.js'
export { serve, serveService, nodeHandler } from './http/serve.js'
export { OPENAPI } from './http/openapi.js'
export { createService, apiKeyAuth, fixedWindowRateLimiter, type Service, type ServiceOptions, type Authenticator, type AuthResult, type RateLimiter } from './http/service.js'
export { signPayload, createFetchDispatcher, type WebhookTarget, type WebhookEvent, type WebhookDispatcher } from './http/webhooks.js'
export { createClient, VerifyError, type VerifyClient, type ClientOptions, type Transport, type TransportRequest, type TransportResponse } from './sdk/client.js'
export {
  deriveVerdictId, verifyReplay, replayInputProblem, STRUCTURE_ONLY_NOTE,
  type ReplayCheck, type ReplayStatus, type ReperformResult, type ReplayOptions,
} from './protocol/replay.js'
export { assertExtraction, extractionProblem, InputRefused } from './protocol/input.js'
export { generateSigningKeypair, signVerdict, verifyEnvelope, type SignedVerdict, type EnvelopeCheck } from './protocol/envelope.js'
export { reconcile, type ReconciliationRuleset, type ReconField, type ReconCheck, type ReconcileOptions } from './reconcile/index.js'
export { PRACTITIONER, STRICT, CAPPED, applyTolerancePolicy, toleranceIdentity, documentGrain, roundingSteps, cashStepOf, type TolerancePolicy, type RoundingCap } from './tolerance.js'
export { normalizePrice } from './binding/forensic-normalizer.js'
export {
  mine, compileRuleset, caseToExtraction, apCasesToTable, AP_MINE_SCHEMA, MINE_VERSION, DEFAULT_T_GRID,
  buildGrammar, validateSchema, validateCaseTable, resolveMineOptions, parseJsonl, caseTableFromRows,
  tally, learnT, judgeConsistency, judgeGrounding, judgeNovelty, hypergeomAllHolds, hypergeomUpperTail, groundingP,
  learnConst, constSpec, type LearnedConst, type LearnConstResult, mineRules,
  type MineSchema, type MineFieldSpec, type MineFieldType, type MineCase, type CaseTable, type ExcludedCase, type MineOptions,
  type MineReport, type JudgedCandidate, type CandidateSpec, type Candidate, type Fate, type CompiledRuleset, type CompileOptions, type DistilApCase,
} from './mine/index.js'
export { verifyCellCitations, parseTableText, parseCellNumber, tableScale, headerDate, type CellCitation, type CellCitationOptions, type TextTable, type TextTableRow } from './tables/index.js'
export {
  verifyAgainstSource, verifyQuote, verifyValueInText, prepareSource, matchQuote, matchValue,
  type QuoteAssertion, type ValueAssertion,
} from './textmatch/index.js'
export * from './twin/index.js'
export * from './twin-einvoice/index.js'
export type * from './verdict/schema.js'
// Completeness reconciliation (2026-09-28): does the book cover the population the customer paid from?
export {
  reconcileCompleteness, effectiveCompletenessMapping, completenessReportIntact, renderCompletenessReport, COMPLETENESS_BOUNDARY,
  readPopulation, readPopulationCSV, readPopulationJSONL, populationFromRows, populationRowsHash, PopulationRefused, CompletenessRefused,
  type CompletenessMapping, type CompletenessOptions, type CompletenessReport, type EffectiveMapping, type RenderCompletenessOptions,
  type Population, type PopulationRow, type CsvDelimiter, type BookInput, type BookChain, type PopulationClass, type BookClass,
  type MatchedItem, type HoldInfo, type BypassedItem, type AmbiguousGroup, type OrphanItem, type UnkeyedItem, type UnreadableItem,
  type FieldDifference, type BookSource, type AmountFormat, type DateFormat, type KeyRules,
} from './reconcile/completeness/index.js'
// External anchoring (2026-09-28): signed checkpoints of the chain head, held outside the book; a rewrite that re-verifies
// internally is caught against them.
export {
  checkpoint, signCheckpoint, verifyCheckpoint, verifyAgainstCheckpoints, verifyCheckpointSignature, checkpointBodyProblem,
  checkpointMessage, checkpointDigest, checkpointId, CheckpointRefused, CHECKPOINT_VERSION, CHECKPOINT_SIGNING_PREFIX, WITNESS_ROLE,
  fileWitness, dirWitness, readWitnessFile, readWitnessDir, latestCheckpoint, WitnessStoreCorrupt,
  verifyTimestampToken, verifyCheckpointTimestamp,
  type Checkpoint, type CheckpointBody, type CheckpointOptions, type CheckpointCheck, type CheckpointStatus, type AnchorReport,
  type AnchorCheckOptions, type WitnessAnchors, type WitnessKeys, type WitnessVia, type Book as AnchorBook,
  type CheckpointWriter, type PublishReceipt, type TimestampTrust, type TimestampCheck,
} from './anchor/index.js'
// Ruleset succession + governed reads (2026-09-29): a person carries a grant across a ruleset version, with a replay attached.
export {
  successionProblem, successionNotice, rulesetWorkflow, loosens, governedNoEffect, governedNotices, inadmissibleGrants, governingRead,
  type Succession, type SuccessionReplay, type SuccessionChange, type SuccessionOutcome,
} from './ledger/decisions.js'
export {
  successionReplay, checkSuccessionReplay, successionGrant,
  type SuccessionReplayOptions, type SuccessionReplayResult, type SuccessionInput,
} from './ledger/succession.js'
// Calibration facts in the index (2026-09-29, P-J): calibration reads without parsing every verdict.
export { recordFacts, recordFactsAt, evidenceMark, RECORD_FACTS, type VerdictFacts, type RecordFacts, type EvidenceMark } from './ledger/index.js'
export { successionFromJson, type SuccessionSurface } from './http/succession.js'
