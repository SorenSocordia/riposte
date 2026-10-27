/**
 * receipts — the checker you don't have to trust, for typed AI decisions.
 *
 *   const { response, gate, receipt } = await guard(transport, request, policy, { checks, flip: true, signingKey })
 *
 * The model decides. Receipts recomputes what can be recomputed (via `verify`), measures whether the decision moves
 * when only the option order moves, returns PROCEED / HOLD / INSUFFICIENT_DATA (can't tell), and signs a replayable receipt of
 * all of it. Receipts written before 2026-10-06 say ABSTAIN for can't tell; readGateOutcome and readCheckOutcome read that word.
 */
import { flipProbe, type FlipOptions, type FlipResult } from './flip.js'
import { gate, type GateChecks, type GatePolicy, type GateResult } from './gate.js'
import { buildReceipt, signReceipt, type DecisionReceipt, type SignedReceipt } from './receipt.js'
import type { SystemOneRequest, SystemOneResponse, Transport } from './systemone.js'

export * from './systemone.js'
export { apGate, apGateOnCheck, type ApGateResult, type ApAction, type ApGateOptions, type ApGateDocuments } from './ap-gate.js'
export {
  makeRuling, signRuling, checkRuling, mandateOf, openRules, rulingShapeProblem, rulingIdOf, authoritiesFromJson, keyFingerprintOf,
  RULING_VERSION, RULING_SIGNING_PREFIX,
  type AuthorityRuling, type SignedRuling, type UnsignedRuling, type Authorities, type RulingCheck, type RulingDecision, type RulingRefusal,
} from './ruling.js'
export { replayCli, replayAgainstLedger, REPLAY_USAGE, type ReplayFs, type LedgerReplay } from './replay-command.js'
export { structuredGateRequest, AP_GATE_DECISIONS, type StructuredGateRequest } from './ap-request.js'
export { checkDone, type DoneClaim, type DoneResult, type DoneOutcome, type Expectation, type ExpectationResult, type StateReader } from './done.js'
export { openLedger, verifyChain, verifyEntry, memoryStore, keyFingerprint, shortKeyFingerprint, entryHash, GENESIS, type Ledger, type LedgerEntry, type LedgerStore, type StoreRepair, type ChainCheck, type ChainPolicy, type EntryCheck, type ReceiptKind } from './ledger.js'
export { orderSchedule, reorder } from './permute.js'
export { flipProbe, recordedTransport, NotRecorded, type FlipOptions, type FlipResult, type RecordedChoice } from './flip.js'
export { gate, readGateOutcome, type GateChecks, type GatePolicy, type GateResult, type GateOutcome } from './gate.js'
export { readCheckOutcome, LEGACY_CANT_TELL, type CheckOutcome } from './outcome.js'
export { buildReceipt, signReceipt, verifyReceipt, RECEIPT_VERSION, type DecisionReceipt, type SignedReceipt, type ReceiptCheck } from './receipt.js'
export { CHECKER_VERSION, CHECKER_IDS, checkerStamp, stamped, type CheckerKind, type CheckerStamp } from './version.js'

export interface GuardOptions {
  checks?: GateChecks
  /** run the flip probe on the deciding question (true = defaults) */
  flip?: boolean | FlipOptions
  /** Ed25519 private key (PEM). If present, the receipt is signed. */
  signingKey?: string
  now?: () => Date
}

export interface GuardResult {
  response: SystemOneResponse
  gate: GateResult
  flip?: Record<string, FlipResult>
  receipt: DecisionReceipt
  signed?: SignedReceipt
}

/** One call: decide, probe, check, gate, receipt. The identity-order answer is the decision of record. */
export async function guard(transport: Transport, request: SystemOneRequest, policy: GatePolicy, opts: GuardOptions = {}): Promise<GuardResult> {
  const response = await transport(request)
  let flip: Record<string, FlipResult> | undefined
  if (opts.flip && request.questions[policy.question]?.type === 'choice') {
    const fo: FlipOptions = typeof opts.flip === 'object' ? opts.flip : {}
    flip = await flipProbe(transport, request, { ...fo, only: [policy.question] })
  }
  const g = gate(request, response, policy, opts.checks, flip)
  const receipt = buildReceipt({ request, response, gate: g, ...(flip ? { flip } : {}), ...(opts.now ? { now: opts.now } : {}) })
  const out: GuardResult = { response, gate: g, receipt }
  if (flip) out.flip = flip
  if (opts.signingKey) out.signed = signReceipt(receipt, opts.signingKey)
  return out
}
export { fileStore, sidecarPathOf, lockPathOf, lockHolder, pidAlive, LedgerStoreError, UNLOCKED_ENV, DEFAULT_LOCK_TIMEOUT_MS, DEFAULT_LOCK_STALE_MS, type FileStore, type FileStoreOptions, type LockOptions, type LockMode } from './file-store.js'
export { hashesOnlyBody, bindProof, receiptForProof, historyOf, sha256Hex, AP_POLICY, HISTORY_MAX, STRUCTURED_PARTS, type ProofBinding } from './ap-receipt.js'
export { parseLedgerTolerant, bindProofs, type ProofBindingLine } from './ledger-command.js'
// The hosted gate (riposte-serve: http.ts, tenant.ts, serve-*.ts) is exported from ./hosted.ts, not here: it is held back from
// the public export until its licence is decided, and nothing public may import it.
export { handleRequest as handleMcpRequest, rootedJsonReader, rootedTextReader, TOOLS as MCP_TOOLS } from './mcp.js'
export { attestModels, modelGate, modelMatches, snapshotDate, snapshotProblem, isFloatingAlias, eventsFromReplies, eventsFromClaudeCodeTranscript, type ModelEvent, type AttestPolicy, type ModelAttestation, type SwitchEvent, type ModelGateResult } from './model-attest.js'
export { attestCli, parseAttestArgs, ATTEST_USAGE } from './attest-command.js'
// the model-switch monitor (2026-10-03): evidence tiers T0 to T3, provider usage exports, a signed monthly report
export { TIERS, TIER_ORDER, tierTable, maxTier, type EvidenceTier, type TierDefinition } from './attest-monitor/tiers.js'
export { readHostRecord, readResponseObject, HOST_FORMATS, type HostFormat, type HostRecord, type HostReply } from './attest-monitor/hosts.js'
export { parseExport, EXPORT_SOURCES, EXPORT_SCHEMAS, CSV_SOURCES, type ExportSource, type ParsedExport, type UsageRow, type CsvColumnMap, type Granularity } from './attest-monitor/exports.js'
export { matchReplies, sameModel, CONFIDENCE, DEFAULT_WINDOW_SECONDS, type Corroboration, type MatchMethod, type ReplyRef, type BucketShortfall } from './attest-monitor/match.js'
export { runMonitor, isAliasFloat, SWITCH_CAUSES, MONITOR_VERSION, type MonitorInput, type MonitorResult, type MonitorRun, type RunResult, type ReplyFinding, type MonitorSwitch, type MonitorSwitchCause, type DeclaredSummary, type Evidence as AttestEvidence, type AnchorSet, type Anchor } from './attest-monitor/monitor.js'
export { renderAttestReport, attestReportJson, signAttestReport, REPORT_VERSION, type ReportReceipt } from './attest-monitor/report.js'
export { anchorReplies, readAnchors, ANCHOR_VERSION } from './attest-monitor/anchor.js'
export { manifestProblems, loadManifest, type AttestManifest } from './attest-monitor/manifest.js'
export { synthAttestMonth, synthKey, SYNTH_VERSION, PLANTS as ATTEST_PLANTS, type Plant as AttestPlant, type SynthTruth as AttestSynthTruth, type RunTruth as AttestRunTruth } from './attest-monitor/synth.js'
export { monitorCli, MONITOR_USAGE, type MonitorIo } from './attest-monitor-command.js'
export { extractClaims, checkClaims, checkMessageClaims, findFinalMessage, parseTestOutput, sessionFromClaudeCodeTranscript, turnEnds, type Step, type ClaimOptions, type ClaimKind, type ClaimStatus, type ClaimCheck, type ClaimsResult, type ExtractedClaim, type Evidence } from './claims.js'
export { claimsCli, parseClaimsArgs, auditTurns, stopHook, stopDecision, stopReceiptHost, hookOptionsFromEnv, stopReceipt, CLAIMS_USAGE, STOP_SEND_BACK, NUNCHI_UNSET_TIER, type TurnAudit, type HookDecision, type HookMode, type StopHookOptions, type NunchiStopOptions } from './claims-command.js'
export { ledgerCli, parseLedger, publicOf, headRecordFor, LEDGER_USAGE, LEDGER_HELP, type LedgerCliIO } from './ledger-command.js'
// 2026-10-05: the head record beside a ledger file, read by riposte-ledger verify and riposte-replay --ledger
export { checkHeadRecord, headRecordPathOf, type HeadRecordCheck, type HeadRecordStatus } from './head-record.js'
// 2026-10-04: arbitration case rows as signed notes under a witnessed head, and `riposte-ledger case`
export {
  ingestCaseLedger, witnessHead, caseRowsFrom, caseRowNotes, checkCaseRows, parseCaseLedger, caseRowSha256, ARBITRATION_SOURCE, HEAD_WITNESSED, WITNESSES_NEEDED, CASE_LEDGER_FORMAT,
  type CaseLedgerRow, type CaseRowNote, type CaseIngest, type CaseIngestCode, type HeadCosign, type HeadCosigner, type HeadWitnessing, type CaseRowsCheck,
} from './arbitration.js'
export { caseCli, loadCustodyDefault, CASE_USAGE, type CaseCliIO, type CustodyApi } from './case-command.js'
export { draftResolution, isTransposition, type ResolutionDraft, type Fact } from './ap-resolve.js'
export {
  deliver, factsFromNotice, factsFromClaims, factsFromDone, factTokens, weightOf, timingOf, DEFAULT_TIERS, SOFTENERS, MOMENTS, AUDIENCES,
  type Delivery, type DeliveryContext, type DeliveryFacts, type DeliveryFinding, type NoticeLike, type Moment, type Audience, type Weight,
} from './nunchi.js'
// 2026-10-03: the shadow pilot (ERP export → structured input → the gate in shadow → signed receipts → the report)
export { pilotCli, PILOT_USAGE } from './pilot-command.js'
export { readExport, detectSource, applyMapping, decodeExportBytes, monthEnd, ExportRefused, SOURCE_IDS, CSV_PRESETS, CSV_TARGETS, MAPPER_SCHEMAS, RECEIPTS_CSV_COLUMNS, EXPORT_LIMITS, type SourceId, type CsvSourceId, type BuyerDecision, type MappedBill, type ExportReading, type ReadOptions, type CsvPreset } from './pilot/mappers.js'
export { readPayApps, PAY_APP_DIR, PAY_APP_DECISIONS, PAY_APP_FIELDS, type MappedPayApp, type PayAppReading } from './pilot/pay-apps.js'
export { ERP_MAPPINGS, erpMappingFile, type ErpMapping } from './pilot/erp-mappings.js'
export { preregTemplate, parsePrereg, freezePrereg, frozenPrereg, lockPathOfPrereg, PreregRefused, PREREG_VERSION, PRIMARY_METRICS, CO_PRIMARY_METRICS, MISS_RATE_REASON, type CoPrimaryMetric, type PreregParams, type PreregLock, type FrozenPrereg } from './pilot/prereg.js'
export { renderPilotReport, recountFromLedger, receiptsThatDisagree, recountFromManifest, auditSheet, readAuditLabels, primaryResult, coPrimaryResult, overallVerdict, exactInterval, csvCell, roleWords, fieldWords, totalWords, clearWords, ReportRefused, AUDIT_COLUMNS, type PilotManifest, type PilotBill, type PilotPayApp, type Disposition, type Recount, type PayAppRecount, type AuditLabels, type PrimaryResult, type CoPrimaryResult } from './pilot/report.js'
export { runShadow, rerenderReport, drawAudit, shadowBody, shadowWords, keyCustody, SHADOW_ACTION, SHADOW_EFFECT, KEY_CHOICE, ShadowRefused, type ShadowOptions, type KeyCustody } from './pilot/shadow.js'
export { synthMonth, writeSynthMonth, synthMonthCsv, taxRuleAnswers, SYNTH_TAX_RATE, APPENDED_LATER_PLANTS, PAYAPP_APPENDED_LATER, vendorVariant, vendorNearMatch, PLANTS, PLANT_EXPECTED, PLANT_ACCEPTS, PLANT_CLEAR_BY, PLANT_GAP, APPENDED_PLANTS, PAYAPP_PLANTS, PAYAPP_APPENDED, PAYAPP_EXPECTED, type Plant, type NearKind, type PayAppPlant, type SynthTruth, type SynthOptions } from './pilot/synth.js'
export { scoreSynth, scoreTable, ScoreRefused, RUNGS, type SynthScore, type ClassScore, type PayAppClassScore } from './pilot/score.js'
// T3 (2026-10-03): the closed loop (propose → verdict with typed remedies → the remedies back as the next instruction → …, at
// most 3 rounds, then a person), its signed rows, the one-bundle replay, and its CLI
export {
  openLoop, loopGate, declarativeReading, editDiscipline, declarativeScope, scopeCovers, flattenPaths, quoteReadsAs, structuredPart, renderInstruction, verifyLoopBundle,
  remedyId, canonicalSha256, LOOP_PROTOCOL, LOOP_ROUND_LIMIT, LOOP_ROW_KINDS, AP_DOC_KEYS,
  // 2026-10-04: remedies re-derived from the pinned ruleset (RT1 F9), and the OPEN reading in words
  rederiveRemedies, openReason, REMEDIES_REDERIVED, type RemedyDerivation,
  type LoopSession, type LoopTask, type LoopProposal, type ApTextProposal, type DeclarativeProposal, type LoopAgent, type AgentModel, type LoopOptions,
  type LoopBundle, type LoopRound, type LoopInstruction, type LoopGateResult, type LoopOutcome, type LoopClose, type RoundResult, type Discipline,
  type VerifyBundle, type RoundReplay, type LoopCheck, type LoopProblem, type SuppliedFrom, type ApDocKey, type GateEffect, type LoopRowKind,
} from './loop.js'
export { loopCli, replayRoundWithCli, replayRoundsWithCli, replayRoundInProcess, defaultVerifyCli, LOOP_USAGE, type LoopCliIo } from './loop-command.js'
// 2026-10-19 (R-L1): the strict line reader, the text reader and the head-record layout, for packages that read a ledger file themselves
export { readLedgerLine, type LineRefusal } from './ledger.js'
export { readLedgerText, type LedgerReadOptions } from './ledger-command.js'
export { ledgerLayout, type LedgerLayout } from './head-record.js'
