/**
 * riposte-adapters: the delivery surface for the gate and autonomy rungs.
 *
 * By design, record and advise SURFACE a FAIL or a can't tell (INSUFFICIENT_DATA); gate and autonomy HOLD it until a
 * person resolves it. verify decides (verify_action + actionNotice); these adapters deliver the decision in each host's
 * own vocabulary and never re-derive it. The Python adapters (LangGraph, OpenAI Agents) live in ./python and call the
 * `riposte-action --check` bin.
 */
export { ACTION_POLICY_VERSION, lintActionPolicy, parseActionPolicy, ruleFor, type ActionPolicy, type ActionRule, type ActionRuleSources, type PolicyLintResult } from './policy.js'
export { checkAction, guardNotice, dispositionOf, DISPOSITIONS, type ActionCheck, type ActionCheckResult, type CheckDeps, type Disposition, type ProposedCall } from './hold.js'
export {
  preToolUseHook, plan, actionHookOptionsFromEnv, countPriorHolds, noLedgerNote, ACTION_HOOK_MODES, PROMPTABLE_MODES,
  type ActionHookMode, type ActionHookEnv, type ActionRecord, type HookDecision, type PreToolUseDeps, type PreToolUseResult,
  degradedHook, type DegradedRecord, type DegradedOptions,
} from './claude-code.js'
// The action policy's safest rung on a policy or equipment error (2026-10-05), and the doctor
export {
  classify, consequentialWord, toolWords, readPolicyLoosely, didYouMean, editDistance, notOneOf, onErrorFromEnv, rungProblems, degradedDenyText,
  problemMissing, problemUnreadable, problemInvalid, problemMode, problemBadInput, problemError, openLine,
  CONSEQUENTIAL_WORDS, ON_ERROR_ENV, ON_ERROR_VALUES, DOCTOR_COMMAND,
  type CallClass, type Classified, type DegradedCode, type OnError, type PolicyProblem, type PolicyReading,
} from './degraded.js'
export { doctor, type DoctorReport, type DoctorRow, type DoctorIo } from './doctor.js'
export { actionCli, parseActionArgs, ACTION_USAGE, type CliIo, type CliOut, type LedgerLike } from './cli.js'
// Governance at the execution boundary (2026-10-03): the fleet's may-act check before every tool call, in every host,
// OFF unless RIPOSTE_GOV_* configures it, and then fail-closed
export {
  governanceFromEnv, decideGovernance, decideGovernanceAsync, verdictFromRun, checkerArgs, checkerEnv, spawnChecker, spawnCheckerAsync, callSha256,
  governanceReceipt, recordGovernance, governanceHook, governanceDenyOutput, denyReason, GOV_ENV_KEYS, DEFAULT_GOV_TIMEOUT_MS,
  type GovernanceEnv, type GovernanceConfig, type GovernanceCall, type GovernanceVerdict, type GovernanceHost, type GovernanceDeps, type GovernanceHookResult,
  type CheckerRun, type CheckerRunner, type CheckerRunnerAsync, type ReceiptWriter,
  // 2026-10-04: governance expected (the marker), and the hooks' inherited-settings strip
  writeGovernanceMarker, governanceExpected, defaultMarkerPaths, unknownGovKeys, scrubHookEnv, envStrippedSoFar, GOV_EXPECTED_ENV, GOV_MARKER_FILE,
  GOV_MARKER_FORMAT, HOOK_ENV_ACCEPT, IN_HOST_HOOKS, IN_HOST_STRIP, type GovernanceExpectation,
} from './governance.js'
// Host ports of the claims check (the Claude Code Stop hook's decision and receipt on Codex, Cursor and OpenCode)
export {
  stepsToClaudeCodeJsonl, decideHostStop, hostReceipt, hostConfig, checkAndRecord, patchFiles, SHELL_TOOL, EDIT_TOOL, WRITE_TOOL,
  type HostSession, type HostConfig, type CheckedStop,
} from './hosts/common.js'
export { sessionFromCodexRollout, codexStopHook, codexCommand, codexOutput, type CodexHookDeps, type CodexHookResult } from './hosts/codex.js'
export {
  cursorHook, cursorPermission, cursorEntryFromPayload, cursorToolOutput, parseCursorJournal, sessionFromCursorJournal, journalName, CURSOR_OUTPUT_TAIL,
  type CursorEntry, type CursorJournal, type CursorHookDeps, type CursorHookResult,
} from './hosts/cursor.js'
export { sessionFromOpenCodeMessages, openCodeIdle, openCodeToolBefore, GovernanceDenied, isSendBack, sendBackBody, type OpenCodeMessage, type OpenCodeIdleDeps, type OpenCodeIdleResult, type OpenCodeGovernanceDeps } from './hosts/opencode.js'
// Riposte verdicts as eval-platform scores (Langfuse, Braintrust; the Inspect scorer is Python and calls bin/riposte-score.mjs)
export {
  checkOutput, extractionFromOutput, verifyCall, proofOf, summaryOf, riposteMetadata, riposteRef, replayCommand, defaultProofFile, BUILTIN_RULESETS,
  type Answer, type CheckRequest, type CheckResult, type Finding, type ProofOptions, type References, type ReplayBundle, type RiposteProof, type RulesetChoice,
} from './scorers/core.js'
export { langfuseScores, postLangfuseScores, type LangfuseScoreBody, type LangfuseTarget, type LangfuseOptions, type LangfuseClientLike, type LangfuseSink } from './scorers/langfuse.js'
export { braintrustScore, riposteBraintrustScorer, type BraintrustScore, type BraintrustScorerArgs, type BraintrustScorerOptions } from './scorers/braintrust.js'
export { scoreCommand, SCORE_USAGE } from './scorers/score-command.js'
// Findings as SARIF 2.1.0 (code-scanning alerts) and the command the GitHub Action runs
export {
  toSarif, sarifCounts, sarifSummary, locateClaim, jsonPositions, pathSteps, regionOf, nodeRegion, rawOffset, walk, resultMessage, SARIF_SCHEMA_URI,
  type SarifItem, type SarifOptions, type SarifCounts, type SarifLog, type SarifRegion,
} from './sarif.js'
export { sarifCommand, parseSarifArgs, globRegex, matchFiles, asInputs, SARIF_USAGE, type SarifArgs, type FailOn } from './sarif-command.js'
// The closed loop (T3, 2026-10-03): run an agent against the gate (receipts' loop), the verdict's remedies returned as its next
// instruction, at most 3 rounds; deterministic stand-in agents (no model) and the riposte-loop-run command
export { runLoop, LOOP_TOOL, type LoopAgentImpl, type NextContext, type LoopRun, type LoopGovernance, type LoopRoundCall } from './loop/driver.js'
export {
  apStandIn, apStandInNext, recordedThenStandIn, rereadStandIn, naiveRecompute, rereadTargets, erpKeyFor, setPath, valueAt,
  AP_STANDIN_ID, REREAD_STANDIN_ID, NAIVE_RECOMPUTE_ID, type Reading,
} from './loop/standins.js'
export { loopRunCli, LOOP_RUN_USAGE, type LoopRunIo } from './loop/command.js'
