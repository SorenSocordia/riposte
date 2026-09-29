/**
 * riposte-adapters: the delivery surface for the gate and autonomy rungs.
 *
 * By design, record and advise SURFACE a FAIL or ABSTAIN; gate and autonomy HOLD it until a
 * person resolves it. verify decides (verify_action + actionNotice); these adapters deliver the decision in each host's
 * own vocabulary and never re-derive it. The Python adapters (LangGraph, OpenAI Agents) live in ./python and call the
 * `riposte-action --check` bin.
 */
export { ACTION_POLICY_VERSION, lintActionPolicy, parseActionPolicy, ruleFor, type ActionPolicy, type ActionRule, type ActionRuleSources, type PolicyLintResult } from './policy.js'
export { checkAction, guardNotice, dispositionOf, DISPOSITIONS, type ActionCheck, type ActionCheckResult, type CheckDeps, type Disposition, type ProposedCall } from './hold.js'
export {
  preToolUseHook, plan, actionHookOptionsFromEnv, countPriorHolds, noLedgerNote, ACTION_HOOK_MODES, PROMPTABLE_MODES,
  type ActionHookMode, type ActionHookEnv, type ActionRecord, type HookDecision, type PreToolUseDeps, type PreToolUseResult,
} from './claude-code.js'
export { actionCli, parseActionArgs, ACTION_USAGE, type CliIo, type CliOut, type LedgerLike } from './cli.js'
