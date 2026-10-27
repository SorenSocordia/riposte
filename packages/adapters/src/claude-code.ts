/**
 * Claude Code: a PreToolUse hook MODE of the Riposte plugin. OFF by default.
 *
 * Host contract (Claude Code hooks reference, https://code.claude.com/docs/en/hooks, fetched 2026-09-28):
 *   - input on stdin: common fields (session_id, transcript_path, cwd, permission_mode, hook_event_name…) plus
 *     `tool_name`, `tool_input`, `tool_use_id` ("PreToolUse input").
 *   - decision on stdout, exit 0: `hookSpecificOutput.permissionDecision` "allow" | "deny" | "ask" | "defer", with
 *     `permissionDecisionReason` ("For "allow" and "ask", shown to the user but not Claude. For "deny", shown to Claude")
 *     and `additionalContext` ("String added to Claude's context alongside the tool result") ("PreToolUse decision control").
 *   - "Other exit codes": with empty stdout, a non-blocking error; "the action proceeds".
 *   - "Timeouts": "A timed-out command, http, or mcp_tool hook doesn't block the tool call."
 *   - headless: "In a -p run with no host, these requests are denied either way" (headless docs, "Turn off permission
 *     prompts in unattended runs").
 *
 * How the disposition (hold.ts) is delivered:
 *   hold     → "ask": the permission prompt IS "held until a person resolves it". The reason (the notice) is shown to the
 *              person. When nobody can be asked (permission_mode dontAsk / bypassPermissions), or this exact call was
 *              already held once in this session, → "deny" with a no-retry instruction to Claude. Never "allow".
 *   review   → "ask" (PASS at gate: a person reviews it before it runs); a repeat of an already-reviewed call → "deny".
 *   surface  → no permission decision (the host's own permission flow is untouched) + the notice as additionalContext for
 *              Claude and a systemMessage for the person.
 *   record, proceed, pass-through → no output at all. The host's permission flow decides, exactly as without Riposte.
 *
 * Riposte only ever NARROWS: it never returns "allow" (it cannot widen what the host's own permission rules allow), and it
 * never returns "defer" (which pauses a headless run).
 *
 * It never loops: it never forces a turn to continue (unlike a Stop hook, a PreToolUse denial ends that tool call), and a
 * repeat of an identical held call in the same session gets a firm deny with a no-retry instruction instead of a second
 * prompt.
 *
 * POLICY ERRORS FAIL TO THE SAFEST RUNG (2026-10-05, ./degraded.ts; this reverses the old "fails open" rule). When the
 * policy cannot be applied (bad input, a missing, unreadable or invalid policy, a misspelled mode, a thrown check), a
 * consequential call (a gate or autonomy rule; with no readable rule, a tool name that moves money or files something) is
 * denied with a typed reason that names the fix, and any other call proceeds with a `governance degraded` receipt. Never
 * exit 2: the deny is a decision. RIPOSTE_ACTION_ON_ERROR=open restores the old fail-open behaviour, loudly.
 *
 * GOVERNANCE (./governance.ts; OFF unless a RIPOSTE_GOV_* variable is set). When configured, the fleet's execution-boundary
 * check runs first, before the action policy and for EVERY tool call, declared or not. Unlike the policy check it fails
 * CLOSED: a refusal (a standing hold, a missing GO) and any error deny the call ("deny", exit 0), with a receipt row. An
 * ALLOW prints nothing and hands the call on to the policy check, so governance, too, only ever narrows.
 */
import { checkAction, type ActionCheck, type CheckDeps } from './hold.js'
import type { ActionPolicy } from './policy.js'
import { governanceHook, type GovernanceDeps, type GovernanceHookResult } from './governance.js'
import { hashOf } from 'riposte-verify'
import {
  classify, degradedDenyText, openLine, problemBadInput, problemError, readPolicyLoosely,
  type CallClass, type DegradedCode, type OnError, type PolicyProblem, type PolicyReading,
} from './degraded.js'

export type ActionHookMode = 'off' | 'record-only' | 'on'
export const ACTION_HOOK_MODES: readonly ActionHookMode[] = ['off', 'record-only', 'on']

/** Permission modes in which Claude Code shows a person the prompt a hook's "ask" requests. */
export const PROMPTABLE_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto']

/** `invalid`: RIPOSTE_ACTION_HOOK is set to something else (`modeRaw`). That is a policy error, not off: ./degraded.ts. */
export interface ActionHookEnv { mode: ActionHookMode | 'invalid'; modeRaw?: string; policy?: string; ledger?: string; problems: string[] }

/**
 * Configuration from the environment (so the plugin is configured without editing it):
 *   RIPOSTE_ACTION_HOOK    off (default) | record-only | on
 *   RIPOSTE_ACTION_POLICY  path to the action policy (required unless off)
 *   RIPOSTE_ACTION_LEDGER  the ledger for action receipts; else the --ledger argument; else NO file (said once on stderr)
 * An unrecognised mode is `invalid` (2026-10-05): a policy error that enforces the safest rung (./degraded.ts), never off and
 * never guessed into a mode. RIPOSTE_ACTION_ON_ERROR=open restores the old reading (stay off), loudly.
 *
 * DECISION (2026-09-28): action receipts go ONLY where RIPOSTE_ACTION_LEDGER or --ledger explicitly says. There is no
 * implicit fallback to RIPOSTE_LEDGER (the Stop hook's ledger): a shell that inherits a deployment's RIPOSTE_LEDGER would
 * otherwise write test or foreign action receipts into that deployment's book of record (it happened, 09-28).
 */
export function actionHookOptionsFromEnv(env: Record<string, string | undefined>): ActionHookEnv {
  const problems: string[] = []
  const raw = (env.RIPOSTE_ACTION_HOOK ?? '').trim().toLowerCase()
  let mode: ActionHookEnv['mode'] = 'off'
  let modeRaw: string | undefined
  if (raw) {
    if ((ACTION_HOOK_MODES as readonly string[]).includes(raw)) mode = raw as ActionHookMode
    else { mode = 'invalid'; modeRaw = (env.RIPOSTE_ACTION_HOOK ?? '').trim() }
  }
  const policy = env.RIPOSTE_ACTION_POLICY?.trim() || undefined
  const ledger = env.RIPOSTE_ACTION_LEDGER?.trim() || undefined
  return { mode, ...(modeRaw !== undefined ? { modeRaw } : {}), ...(policy ? { policy } : {}), ...(ledger ? { ledger } : {}), problems }
}

/**
 * The one stderr line when a checked call has nowhere to be recorded (no RIPOSTE_ACTION_LEDGER, no --ledger). Said once
 * per checked call, never for an undeclared tool, never when off. `inherited` is set when RIPOSTE_LEDGER is present, so a
 * deployer sees that it was deliberately not used.
 */
export function noLedgerNote(inherited: boolean): string {
  return `riposte-action: no action ledger (set RIPOSTE_ACTION_LEDGER or --ledger): this receipt was recorded to no file, and the loop guard has no memory of earlier holds${inherited ? '; RIPOSTE_LEDGER is not used for action receipts' : ''}\n`
}

export interface PreToolUseDeps extends CheckDeps {
  policy: ActionPolicy
  /** How many times this exact call (session, call hash) was already held for a person. From the ledger; 0 when unknown. */
  priorHolds?: (sessionId: string, callHash: string) => number
  /** the governance check, when RIPOSTE_GOV_* configures one: it runs first and fails closed */
  governance?: GovernanceDeps
  /** on a policy error: hold (default, the safest rung) or open (the operator's opt-out, RIPOSTE_ACTION_ON_ERROR=open) */
  onError?: OnError
}

export type HookDecision = 'none' | 'ask' | 'deny' | 'surface'

/** What the CLI appends to the ledger for a checked call (kind 'action_check'). */
export interface ActionRecord {
  source: 'pre_tool_use'
  mode: Exclude<ActionHookMode, 'off'>
  session_id?: string
  tool_use_id?: string
  tool: string
  call_hash: string
  workflow: string
  level: string
  tier: string
  set_by?: string
  disposition: ActionCheck['disposition']
  /** what was delivered to the host ('none' in record-only) */
  decision: HookDecision
  /** what would have been delivered when enforcing */
  would_decision: HookDecision
  /** true when the call was actually held for a person (ask or deny on a hold or review). The loop guard counts these. */
  held: boolean
  repeat: boolean
  permission_mode?: string
  guard?: string
  problems: string[]
  facts_hash: string
  verdict: ActionCheck['verdict']
}

/**
 * What the CLI appends (kind 'action_check') when the policy could not be applied to a call: the `governance degraded`
 * receipt (./degraded.ts). `held` is always false: the loop guard counts holds for a person, and this is a hold until the
 * operator fixes the setup, so a later, healthy check of the same call still asks.
 */
export interface DegradedRecord {
  source: 'pre_tool_use'
  governance: 'degraded'
  /** as configured; `invalid` is a misspelled RIPOSTE_ACTION_HOOK (`mode_raw`) */
  mode: Exclude<ActionHookMode, 'off'> | 'invalid'
  mode_raw?: string
  code: DegradedCode
  problem: string
  fix: string
  class: CallClass
  class_from: string
  tool?: string
  call_hash?: string
  session_id?: string
  tool_use_id?: string
  permission_mode?: string
  on_error: OnError
  /** what was delivered: deny for a held consequential call, else none (record-only and the opt-out deliver nothing) */
  decision: HookDecision
  /** what the safest rung delivers when enforcing */
  would_decision: HookDecision
  held: false
}

export interface PreToolUseResult {
  /** 0, or 1 for a visible non-blocking error under the fail-open opt-out (never 2: a deny is a decision, exit 0) */
  code: 0 | 1
  stdout: string
  stderr: string
  decision: HookDecision
  record?: ActionRecord | DegradedRecord
  skipped?: string
  /** the governance check's result, when one ran */
  governance?: GovernanceHookResult
}

const NO_RETRY = 'This call is held for a person. Do not retry it. Tell the person what is held and why; they resolve it (or dispute the finding with the command above).'

/** The hook's decision for one checked call, before mode is applied. Pure. */
export function plan(check: ActionCheck, ctx: { permission_mode?: string; prior: number }): { decision: HookDecision; repeat: boolean; output?: Record<string, unknown> } {
  const text = check.delivery.text.trimEnd()
  const d = check.disposition
  if (d === 'hold' || d === 'review') {
    const repeat = ctx.prior > 0
    const promptable = ctx.permission_mode === undefined || PROMPTABLE_MODES.includes(ctx.permission_mode)
    const what = d === 'hold' ? 'held' : 'sent for review'
    const context = `Riposte ${what} this ${check.tool} call for a person (rung ${check.notice.level}, verdict ${check.verdict.verdict_id}, outcome ${check.delivery.facts.outcome}). If the person approves, it runs; if not, do not retry it.`
    if (!repeat && promptable) {
      return { decision: 'ask', repeat, output: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: text, additionalContext: context } } }
    }
    const why = repeat
      ? `Already ${what} once in this session: Riposte will not ask again for this exact call.`
      : `No person can be asked in permission mode "${ctx.permission_mode}", so the call does not run.`
    return {
      decision: 'deny', repeat,
      output: {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${why}\n${text}\n${NO_RETRY}` },
        systemMessage: `Riposte ${what} ${check.tool} (verdict ${check.verdict.verdict_id}): ${why}`,
      },
    }
  }
  if (d === 'surface') {
    return { decision: 'surface', repeat: false, output: { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text }, systemMessage: text } }
  }
  return { decision: 'none', repeat: false }
}

/**
 * The PreToolUse hook for one call. `mode` is 'record-only' (check and record what would have happened; print nothing,
 * never fail) or 'on' (deliver). The caller handles 'off' by not calling this at all (with governance configured, it
 * calls governanceHook alone).
 *
 * With `deps.governance`, the governance check runs first, for every tool call: a denial is returned at once ("deny", exit
 * 0) and the policy check never runs; an ALLOW goes on to the policy check, its receipt and notes kept on the result.
 */
export function preToolUseHook(stdin: string, mode: Exclude<ActionHookMode, 'off'>, deps: PreToolUseDeps): PreToolUseResult {
  if (!deps.governance?.gov.on) return policyHook(stdin, mode, deps)
  const g = governanceHook(stdin, deps.governance)
  if (g.denied) return { code: 0, stdout: g.stdout, stderr: g.stderr, decision: 'deny', governance: g }
  const r = policyHook(stdin, mode, deps)
  return { ...r, stderr: g.stderr + r.stderr, governance: g }
}

/** The action-policy check for one call (the hook as it was before governance). */
function policyHook(stdin: string, mode: Exclude<ActionHookMode, 'off'>, deps: PreToolUseDeps): PreToolUseResult {
  const failCode: 0 | 1 = mode === 'on' ? 1 : 0
  // A policy error on this call: the safest rung (./degraded.ts), or under the opt-out the old fail-open result.
  const fail = (msg: string, problem: PolicyProblem): PreToolUseResult => degradedHook(stdin, {
    problem, mode, reading: readPolicyLoosely(JSON.stringify(deps.policy), true), onError: deps.onError ?? 'hold',
    legacy: { code: failCode, stderr: `riposte-action --hook: ${msg} (failing open: the tool call proceeds through the normal permission flow)\n` },
  })
  let hook: Record<string, unknown>
  try {
    const x: unknown = JSON.parse(stdin)
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return fail('stdin is not hook JSON', problemBadInput('stdin is not hook JSON'))
    hook = x as Record<string, unknown>
  } catch { return fail('stdin is not hook JSON', problemBadInput('stdin is not hook JSON')) }
  if (hook.hook_event_name !== undefined && hook.hook_event_name !== 'PreToolUse') return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: `not a PreToolUse event (${String(hook.hook_event_name)})` }
  if (typeof hook.tool_name !== 'string') return fail('no tool_name in the hook input', problemBadInput('no tool_name in the hook input'))
  // an undeclared tool passes through untouched, whatever its input (the policy has nothing to say about it)
  const toolName = hook.tool_name
  if (!deps.policy.actions.some((a) => a.tool === toolName)) return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: 'not a declared action' }
  const input = hook.tool_input
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('tool_input is not an object', problemBadInput('tool_input is not an object'))
  let check
  try { check = checkAction(deps.policy, { tool: toolName, arguments: input as Record<string, unknown> }, deps) } catch (e) { return fail(`the check threw: ${(e as Error).message}`, problemError((e as Error).message)) }
  if (!check.matched) return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: 'not a declared action' }

  const session = typeof hook.session_id === 'string' ? hook.session_id : undefined
  const permission_mode = typeof hook.permission_mode === 'string' ? hook.permission_mode : undefined
  let prior = 0
  if (session && deps.priorHolds) {
    try { prior = deps.priorHolds(session, check.call_hash) } catch { prior = 0 }
  }
  const p = plan(check, { ...(permission_mode !== undefined ? { permission_mode } : {}), prior })
  const enforcing = mode === 'on'
  const decision: HookDecision = enforcing ? p.decision : 'none'
  const record: ActionRecord = {
    source: 'pre_tool_use', mode,
    ...(session ? { session_id: session } : {}),
    ...(typeof hook.tool_use_id === 'string' ? { tool_use_id: hook.tool_use_id } : {}),
    tool: check.tool, call_hash: check.call_hash, workflow: check.workflow, level: check.rule.level, tier: check.rule.tier,
    ...(check.rule.set_by ? { set_by: check.rule.set_by } : {}),
    disposition: check.disposition, decision, would_decision: p.decision,
    held: enforcing && (decision === 'ask' || decision === 'deny'), repeat: p.repeat,
    ...(permission_mode !== undefined ? { permission_mode } : {}),
    ...(check.guard ? { guard: check.guard } : {}),
    problems: check.problems, facts_hash: check.delivery.facts_hash, verdict: check.verdict,
  }
  const stderr = check.problems.map((x) => `riposte-action: ${x}\n`).join('')
  return { code: 0, stdout: enforcing && p.output ? `${JSON.stringify(p.output)}\n` : '', stderr, decision, record }
}

export interface DegradedOptions {
  problem: PolicyProblem
  /** the configured mode; `invalid` (a misspelled mode) enforces the safest rung */
  mode: Exclude<ActionHookMode, 'off'> | 'invalid'
  modeRaw?: string
  /** what the policy text still says (./degraded.ts readPolicyLoosely) */
  reading: PolicyReading
  onError: OnError
  /** the old fail-open result for this error: what RIPOSTE_ACTION_ON_ERROR=open restores */
  legacy: { code: 0 | 1; stderr: string }
}

/**
 * One call while the action policy cannot be applied (./degraded.ts). `stdin` is undefined when it could not be read.
 * Consequential: deny with the typed fix (enforcing), or record the would-deny (record-only). Record-and-advise: proceed,
 * with the degraded receipt. A valid policy that does not declare the tool: pass through, as always. Pure.
 */
export function degradedHook(stdin: string | undefined, o: DegradedOptions): PreToolUseResult {
  let hook: Record<string, unknown> = {}
  if (stdin !== undefined) {
    try { const x: unknown = JSON.parse(stdin); if (x !== null && typeof x === 'object' && !Array.isArray(x)) hook = x as Record<string, unknown> } catch { /* unreadable: no tool */ }
  }
  if (hook.hook_event_name !== undefined && hook.hook_event_name !== 'PreToolUse') return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: `not a PreToolUse event (${String(hook.hook_event_name)})` }
  const tool = typeof hook.tool_name === 'string' ? hook.tool_name : undefined
  const c = classify(tool, o.reading)
  if (c.cls === 'pass-through') return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: 'not a declared action' }
  const input = hook.tool_input
  const p = o.problem
  const enforcing = o.mode !== 'record-only'
  const would: HookDecision = c.cls === 'consequential' ? 'deny' : 'none'
  const open = o.onError === 'open'
  const decision: HookDecision = open || !enforcing ? 'none' : would
  let call_hash: string | undefined
  if (tool !== undefined && input !== null && typeof input === 'object' && !Array.isArray(input)) { try { call_hash = hashOf({ tool, arguments: input }) } catch { call_hash = undefined } }
  const record: DegradedRecord = {
    source: 'pre_tool_use', governance: 'degraded', mode: o.mode, ...(o.modeRaw !== undefined ? { mode_raw: o.modeRaw } : {}),
    code: p.code, problem: p.problem, fix: p.fix, class: c.cls, class_from: c.from,
    ...(tool !== undefined ? { tool } : {}), ...(call_hash ? { call_hash } : {}),
    ...(typeof hook.session_id === 'string' ? { session_id: hook.session_id } : {}),
    ...(typeof hook.tool_use_id === 'string' ? { tool_use_id: hook.tool_use_id } : {}),
    ...(typeof hook.permission_mode === 'string' ? { permission_mode: hook.permission_mode } : {}),
    on_error: o.onError, decision, would_decision: would, held: false,
  }
  if (open) return { code: o.legacy.code, stdout: '', stderr: o.legacy.stderr + openLine(p.code), decision, record }
  const what = c.cls === 'consequential' ? (enforcing ? 'this call is held' : 'record-only: this call would be held') : 'this call proceeds on the record'
  const stderr = `riposte-action: governance degraded, ${p.code}: ${p.problem}; ${what} until it is fixed. Fix: ${p.fix}. Check: riposte-action --doctor\n`
  if (decision !== 'deny') return { code: 0, stdout: '', stderr, decision, record }
  const output = {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: degradedDenyText(tool, p, c) },
    systemMessage: `Riposte: governance degraded (${p.code}). ${tool ?? 'This tool call'} is held until the operator fixes it: ${p.fix}. Check the setup with riposte-action --doctor.`,
  }
  return { code: 0, stdout: `${JSON.stringify(output)}\n`, stderr, decision, record }
}

/** The loop guard's lookup over ledger entries: how often this exact call was actually held in this session. */
export function countPriorHolds(entries: readonly { kind: string; body: unknown }[], sessionId: string, callHash: string): number {
  let n = 0
  for (const e of entries) {
    if (e.kind !== 'action_check') continue
    const b = e.body as Partial<ActionRecord> | null
    if (b && b.session_id === sessionId && b.call_hash === callHash && b.held === true) n++
  }
  return n
}
