/**
 * The package's public surface. verify() and its options live in ./verify.ts; this file only re-exports.
 *
 * A module under src/ that needs verify() imports it from ./verify.js, never from here: this barrel re-exports most of
 * src/, so importing it from inside makes a cycle, and a bundle of one path (the action hook, replay) would pull the whole
 * package in (core-tidy, 2026-09-29). test/barrel-imports.test.ts holds the line.
 */

export {
  verify, verifyBatch, replayView, referenceMultiplicity, assertHashableInputs,
  type Json, type VerifyOptions, type BatchItem, type BatchResult,
} from './verify.js'

// ---------------------------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------------------------

export { ENGINE_VERSION, RULESET, PAY_APP_RULESET_REF, SCHEMA_VERSION } from './version.js'
// Engine 0.1.0 (2026-10-03): the engine versions this build re-performs, and the one a verdict is made under.
export { ENGINE_VERSIONS, engineFor, isRetainedEngine, type EngineVersion } from './version.js'
export { RULESETS, INVOICE_RULESET, PAY_APP_RULESET, resolveRuleset, RULESET_VERSIONS, INVOICE_RULESET_V0_0_1 } from './rulesets/index.js'
export type { Ruleset, RulesetRef } from './rulesets/types.js'
export { MIN_VERDICT_CONFIDENCE } from './verdict/from-report.js'
export { setGavelLogger } from './kernel/validation-gavel.js'
export { setBridgeLogger } from './binding/ontological-bridge.js'
export { canonicalize, hashOf, sha256 } from './verdict/canonical.js'
export { verifyAction, ACTION_RULESET_VERSIONS, resolveActionRuleset, type ActionRuleset, type ProposedAction, type ActionSources, type ApprovedRecord, type VerifyActionOptions } from './action/index.js'
export { compareValues, comparisonFor, comparisonCode, comparisonFromCode, fieldsProblem, sameAsWritten, CURRENCY_SYMBOLS, type FieldType as ActionFieldType, type Comparison as ValueComparison, type Match as ValueMatch } from './action/equivalence.js'
export { actionVersionProblem } from './action/door.js'
export { AGGREGATIONS, aggregateOutcome, gateStatus, gateLabel, gateStatusOpen, hasStruckLoadBearing, heldSuspectClaims, openClaims, holdsAtGate, recordedGateStatus, attachGateStatus, carriesGateStatus, gateHeadline, gateWord, type GateStatus, type GateLabel, type GateStatusOpen, type RecordedGateStatus } from './verdict/aggregation.js'
export { verifyCitations, verifyCitation, renderCitationAudit, LEGAL_REMEDIES, type Citation, type OpinionSources } from './legal/index.js'
// legal@0.1.0 (2026-10-03, opt-in): quotation conventions read and named on the verdict; see src/legal/quotation.ts.
export { LEGAL_RULESET_VERSIONS, resolveLegalRuleset, LEGAL_REMEDIES_V010, LEGAL_REMEDIES_V010_NEAREST, LEGAL_REMEDIES_V020, LEGAL_REMEDIES_V020_ALTERED, type LegalRuleset, type VerifyCitationsOptions } from './legal/index.js'
// 2026-10-05 (engine 0.6.0): the opinion text bound to its cite and recorded; the 0.6.0 remedy tables; `verify citations`
export { LEGAL_REMEDIES_060, LEGAL_REMEDIES_V010_060, LEGAL_REMEDIES_V020_060, LEGAL_REMEDIES_060_NEAREST, LEGAL_REMEDIES_060_ALTERED, LEGAL_REMEDIES_060_UNBOUND, defaultLegalRuleset, PARTIES_ONLY_NOTE, type LegalVerdict, type OpinionText, type OpinionProvenance, type CiteNaming, type BindMode } from './legal/index.js'
export { runCitations, loadOpinionFolder, readCitationsFile } from './legal/cli-citations.js'
export { readQuotation, prepareLegalSource, normalizeLegalText, QUOTATION_LIMITS, meaningOf, lemmaOf, isGuardedWord, conditionWordIn, hasInnerQuotationMarks, type QuotationReading, type LegalPreparedSource, type Alteration, type MeaningProblem } from './legal/quotation.js'
export { verifyInvoiceMatch, splitApLayout, parseTaxPolicy, taxPolicyText, AP_REMEDIES, AP_RULESET, AP_RULESET_V0_1_0, AP_RULESET_VERSIONS, resolveApRuleset, type ApRuleset, type PriorInvoice, type ApDocuments, type ApPolicy, type ApResult, type ApDecision, type VerifyInvoiceMatchOptions } from './ap/index.js'
export { verifyBillMatch, validateApInput, apInputDocuments, apDecisionLabel, apInputIdentity, isApStructured, resolvePointer, resolveApStructuredRuleset, ApInputInvalid, AP_STRUCTURED_RULESET, AP_INPUT_VERSION, AP_INPUT_LIMITS, AP_HOLD_REASONS, type ApStructuredInput, type ApStructuredDocuments, type ApStructuredRuleset, type ApBill, type ApBillLine, type ApPurchaseOrder, type ApPoLine, type ApItemReceipt, type ApReceiptLine, type ApPayment, type ApVendor, type ApMoney, type ApQuantity, type ApModelDecision, type ApHoldReason, type ApInputError, type ApInputErrorCode, type ApInputCheck, type VerifyBillMatchOptions } from './ap/structured.js'
export { AP_INPUT_SCHEMA } from './ap/ap-input-schema.js'
export { structuredFromText } from './ap/from-text.js'
export { readRemittance, AP_REMITTANCE_RULE } from './ap/remittance.js'
export { AP_QTY_TO_DATE_RULE } from './ap/qty-to-date.js'
export { apProofOf } from './ap/structured.js'
export { recomputeLine, minorUnitDigits, adjustmentMarker, apLineMathProblem, AP_LINE_MATH_RULE, type LineMathInput, type LineMathResult } from './ap/line-math.js'
export { parseInvoice, parsePurchaseOrder, parseGoodsReceipt, type ParsedInvoice, type ParsedPo, type InvoiceLine, type PoLine, type ReceiptLine } from './ap/parse.js'
export { verifyDeclarative, declarativeReading, foldIdentifierText, algorithmPinsOf, archiveChecks } from './declarative/evaluate.js'
// 2026-10-04, engine 0.5.0: the choice ledger, archive bytes (docs/CHOICES.md)
export { choiceLedger, archiveChecksV050, type ChoiceLedger, type ArchiveFile } from './declarative/evaluate.js'
export { readNumberTextV020, resolveLocale, LOCALE_TAGS, type NumberLocale } from './declarative/unreadable.js'
// Declarative rulesets by name (2026-10-03): peppol-en16931 → 0.2.0 by default; @0.1.0 kept; e-invoice → the default.
export { DECLARATIVE_RULESETS, DECLARATIVE_DEFAULT_VERSIONS, DECLARATIVE_DOMAIN_DEFAULTS, isDeclarativeRulesetName, resolveDeclarativeRuleset } from './rulesets/declarative.js'
export { PEPPOL_EN16931_V0_2_0 } from './rulesets/peppol-en16931-v020.js'
export { PEPPOL_EN16931_V0_3_0 } from './rulesets/peppol-en16931-v030.js'
export { bindsRemedyTable, verdictIdentity, remedyTableHashOf } from './protocol/verdict-id.js'
export { isDeclarativeRuleset, rulesetIdentity, remedyTableOf, remedyTableHash, type DeclarativeRuleset, type DeclField, type DeclCheck, type DeclLocale, type DeclAlgorithm, type DeclApplicability, type DeclChoice, type ChoiceFill, type SuppliedChoice } from './declarative/types.js'
export { evalExpr, evalExprV040, operandRefs, type OperandRef, type AggFn } from './declarative/expr.js'
// 2026-10-04, engine 0.4.0: named algorithms as pinned procedures (src/algorithms/, docs/RULESETS.md)
export { ALGORITHMS, resolveAlgorithm, algorithmPin, pinProblem, type AlgorithmEntry, type AlgorithmSource } from './algorithms/index.js'
export { sparcVflat, type SparcVflatInputs, type SparcVflatResult } from './algorithms/sparc-vflat.js'
export { rarFit, rarLogF, type RarFitInputs, type RarFitResult, type RarWeighting } from './algorithms/rar-fit.js'
export { type AlgorithmParam } from './algorithms/index.js'
export { QC_SCHEMES, ARGO_QC, qcFlagKey, type QcScheme, type QcFlagMeaning } from './schemes/index.js'
export { lintRuleset, flagsPolicyProblems, type LintResult } from './declarative/lint.js'
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
  canaryRevealsFor, canaryCommitment, CANARY_COMMIT_PREFIX, KeyRegistry, ROLES, ROLE_FOR, isRole, keyFingerprint, legacyKeyFingerprint,
  SampleRefused, deriveSample, chainPeriods, periodAt, nextPeriodEnd, chainClock, periodFrame, recordWorkflow, sampleSeed,
  drawSize, drawStratum, sampleSubject, sampleKey, PERIOD_UNITS, isPeriodUnit, STRATA, SAMPLE_SEED_PREFIX,
  tenantOfWorkflow, decisionTenant, BOOK_DECISION_KINDS, isBookDecisionKind,
  type KeyRegisterDecision, type KeyRevokeDecision, type CanarySealDecision, type CanaryRevealDecision, type ReviewDecisionBody,
  type Signable, type SignedReviewEntry, type AnchorOptions, type Role, type RootKeys, type KeyEntry, type Authorization,
  type PeriodUnit, type PeriodSpan, type Stratum, type SampleRates, type SampleBody, type SampleEntry, type SampleRequest,
  type BookDecision, type BookDecisionKind, type KeyDecision, type CanaryDecision, type KeyDecisionKind, type CanaryDecisionKind,
} from './ledger/index.js'
export { zeroMissN, successLowerBound, describeBound, oneSidedLevel, SIDEDNESS, type Sidedness } from './verdict/bounds.js'
// D-ANCHOR and the read-side verdict door (security fix, 2026-09-28): unanchored decisions have no rung effect; recorded verdicts are re-checked on read.
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
export { serve, serveService, nodeHandler, type TransportOptions } from './http/serve.js'
// 2026-10-05: the Host names a server answers, and the one body type it reads
export { allowedHostsFor, hostnameOf, isJsonContentType, LOOPBACK_NAMES } from './http/serve.js'
// 2026-10-06: what one check may cost `serve` (worker threads under a time, heap and concurrency budget)
export { createCheckPool, resolveBudget, DEFAULT_BUDGET, BUDGET_WORDS, type CheckBudget, type CheckPool } from './http/budget.js'
export { OPENAPI, openapiFor, MANAGED_PATHS } from './http/openapi.js'
export { createService, apiKeyAuth, fixedWindowRateLimiter, type Service, type ServiceOptions, type Authenticator, type AuthResult, type RateLimiter } from './http/service.js'
export { signPayload, createFetchDispatcher, type WebhookTarget, type WebhookEvent, type WebhookDispatcher } from './http/webhooks.js'
export { createClient, VerifyError, type VerifyClient, type ClientOptions, type Transport, type TransportRequest, type TransportResponse } from './sdk/client.js'
export {
  deriveVerdictId, verifyReplay, replayInputProblem, issuedAtProblem, inputIdentity, pinnedRemedyProblem, STRUCTURE_ONLY_NOTE, notReperformedFields, ANNOTATIONS,
  type ReplayCheck, type ReplayStatus, type ReperformResult, type ReplayOptions,
} from './protocol/replay.js'
export {
  replayBundle, replayBundles, replayRequest, REPLAY_REQUEST_LIMIT, bundlesFromText, isReplayBundle, renderCaseReplay, replayReading, renderAnswer, renderGate, renderGateNow, strictProblems, strictNotes, notABundleHint, presentedOf,
  type ReplayCaseOptions, type ReplayBundle, type CaseReplay, type CaseResult, type ReplaySummary, type GateReading, type GateNow,
} from './protocol/replay-case.js'
export {
  REMEDY_KINDS, REMEDY_TRANSFORMS, remediesFor, attachRemedies, withoutRemedies, normalizeDeclaration, remedySpecProblems,
  remedyDeclarationProblems, remedyTableProblems, answerOf, renderRemedies,
  type RemedySpec, type RuleRemedies, type RemedyDeclaration, type RemedyContext, type RemedyTable, type RegisteredTransform,
} from './verdict/remedy.js'
export { assertExtraction, extractionProblem, InputRefused } from './protocol/input.js'
export { decodeUtf8Strict, invalidUtf8Offset, nonFinitePath, assertFiniteNumbers, parseJsonStrict, duplicateKeyPath, duplicateKeyRefusal, HashInputRefused } from './protocol/hash-input.js'
// 2026-10-05: a number that cannot be represented exactly, refused before hashing (text: inexactNumberPath; parsed: unsafeMagnitudePath)
export { numberTextIsExact, inexactNumberPath, inexactNumberRefusal, unsafeMagnitudePath, unsafeMagnitudeRefusal, assertSafeMagnitudes, INEXACT_NUMBER_WORDS } from './protocol/hash-input.js'
export { verdictExit, apExit, exitHeaders, exitLine, type ExitReading, type ApExitInput } from './verdict/exit.js'
export { carriedRulesetNames, carriedDefaultVersion } from './protocol/ruleset-names.js'
export { generateSigningKeypair, signVerdict, verifyEnvelope, verifyEnvelopeText, type SignedVerdict, type EnvelopeCheck } from './protocol/envelope.js'
export { reconcile, type ReconciliationRuleset, type ReconField, type ReconCheck, type ReconcileOptions } from './reconcile/index.js'
export { PRACTITIONER, STRICT, CAPPED, applyTolerancePolicy, toleranceIdentity, toleranceProblem, documentGrain, roundingSteps, cashStepOf, type TolerancePolicy, type RoundingCap } from './tolerance.js'
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
// 2026-10-03: the inputs a verdict's hash binds (one builder for verify(), the evaluator and callers), and a lossless packed verdict
export { verifyInputs, verifyInputHash, type VerifyInputOptions } from './protocol/inputs.js'
export { packVerdict, unpackVerdict, VERDICT_PACK_FORMAT, type PackedVerdict } from './verdict/pack.js'
// T1 (2026-10-03): the extraction contract. A ruleset's extraction schema, generated from its fields block; envelope
// validation and lowering; the fixed canonicalization; two readers (PDF text layer, OCR) and their agreement; the reference
// extractor; quotations read twice for the legal check. docs/EXTRACTION-CONTRACT.md.
export {
  CONTRACT_VERSION, UNREADABLE, isContractEnvelope, lowerContract, rulesetRef,
  type ContractEnvelope, type ContractField, type ContractLine, type ContractValue, type NotPrinted, type Provenance, type SuppliedProvenance, type ArchiveProvenance, type Reading as ContractReading, type Lowered,
} from './extract/contract.js'
export { extractionSchema, validateContract, legalVersionOf, LEGAL_CITATION_FIELDS, type ContractViolation, type ContractRuleset } from './extract/schema.js'
export { validateSchema as validateContractSchema, type JsonSchema, type SchemaViolation } from './extract/jsonschema.js'
export { canonicalText, canonicalLines, canonicalTokens, sameText, detectDecimal, readAmount, readPrice, readQuantity, readRate, readByKind, readCurrencyMark } from './extract/canonical.js'
export { decideField, readingsAgree, alignLines, buildEnvelope, toReading, type LineReading, type EnvelopeInput, type Decided } from './extract/agree.js'
export {
  readTextLayer, ocrPage, renderPage, ocrImage, detectRotation, toRows, rowText, pageCount, pdfJsVersion, readPnm, writePgm, toGrey, rotateGrey, saturatedShare,
  type Word, type PageRead, type Row, type Tools, type OcrSetting, type OcrPageOptions, type Pnm,
} from './extract/readers.js'
export { readLabelled, readLabelledFields, findLabel, valueRun, wordMatch, type FieldReading, type LabelReadOptions } from './extract/labels.js'
export { extractContract, DEFAULT_OCR_A, type ExtractOptions, type ExtractResult, type LayoutReader, type LayoutContext } from './extract/extract.js'
// The standards compiler (T2, 2026-10-03): schematron → declarative ruleset skeleton (docs/COMPILER.md)
export { compileSchematron, COMPILER_ID, COMPILER_VERSION, POLICIES as COMPILER_POLICIES, type CompileOptions as SchematronCompileOptions, type CompileResult, type CompileReport, type AliasFile } from './compile/compile.js'
export { compareWithHand, renderComparison, type Comparison, type CheckComparison } from './compile/compare.js'
export { markHandEdits, type HandEdit } from './compile/diff.js'
export { parseStructureTsv, parseStructureXml, type Structure } from './compile/structure.js'
export { readSchematron, type Schematron, type SchematronAssert } from './compile/schematron.js'
export { parseXPath, XPathError } from './compile/xpath.js'
export {
  readQuotationTwice, pageTokens, alignPointer, locatedWithin, contractSource, contractToCitations,
  type PageToken, type Alignment, type QuotationRead, type LegalContractEnvelope, type LegalContractCitation,
} from './extract/legal.js'
// Engine 0.3.0 (2026-10-03): the evidence ruling (docs/EVIDENCE.md): tiers, the scope line, arbitration (the Salle)
export { scopeOf, attachScope, renderScope, scopeLines, carriesScope, SCOPE_STATEMENTS } from './verdict/scope.js'
export { TIERS, tierRank, betterTier, worseTier, isTier, inferTier, provenanceTier, floorOf, overlayProblems, archiveProvenanceProblems, type EvidenceItem, type EvidenceStrike, type EvidenceOverlay, type ArchiveProvenanceShape } from './declarative/evidence.js'
export type { EvidenceTier, EvidenceFloor, StruckReason, StruckField, StruckProvenance, WouldUnlock, VerdictCounts, Finding as EvidenceFinding, FieldSupport, CaseLink, VerdictScope, ArchiveCheck, AlgorithmPin, ChoiceEntry, ChoiceKind, ChoiceStatus, ChoiceValue, ChoiceSpan, QcBlock, QcValue } from './verdict/schema.js'
export * from './arbitration/index.js'
// The AP stress rows' digest (2026-10-05, after cold review round 4): one function for the stress harness and bench check
export { apPackDigest, checkStress, AP_RULESET_REF, type StressReport } from './bench/stress.js'
