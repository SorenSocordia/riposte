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
 * prompt. It fails open: its own errors (bad input, unreadable policy, a thrown check) print nothing on stdout, and the
 * tool call proceeds through the host's normal flow, with the error visible (exit 1, "non-blocking error") when enforcing.
 */
import { checkAction, type ActionCheck, type CheckDeps } from './hold.js'
import type { ActionPolicy } from './policy.js'

export type ActionHookMode = 'off' | 'record-only' | 'on'
export const ACTION_HOOK_MODES: readonly ActionHookMode[] = ['off', 'record-only', 'on']

/** Permission modes in which Claude Code shows a person the prompt a hook's "ask" requests. */
export const PROMPTABLE_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto']

export interface ActionHookEnv { mode: ActionHookMode; policy?: string; ledger?: string; problems: string[] }

/**
 * Configuration from the environment (so the plugin is configured without editing it):
 *   RIPOSTE_ACTION_HOOK    off (default) | record-only | on
 *   RIPOSTE_ACTION_POLICY  path to the action policy (required unless off)
 *   RIPOSTE_ACTION_LEDGER  the ledger for action receipts; else the --ledger argument; else NO file (said once on stderr)
 * An unrecognised mode falls back to off and is reported: never guessed into enforcing.
 *
 * DECISION D14 (2026-09-28): action receipts go ONLY where RIPOSTE_ACTION_LEDGER or --ledger explicitly says. There is no
 * implicit fallback to RIPOSTE_LEDGER (the Stop hook's ledger): a shell that inherits a deployment's RIPOSTE_LEDGER would
 * otherwise write test or foreign action receipts into that deployment's book of record (it happened, 09-28).
 */
export function actionHookOptionsFromEnv(env: Record<string, string | undefined>): ActionHookEnv {
  const problems: string[] = []
  const raw = (env.RIPOSTE_ACTION_HOOK ?? '').trim().toLowerCase()
  let mode: ActionHookMode = 'off'
  if (raw) {
    if ((ACTION_HOOK_MODES as readonly string[]).includes(raw)) mode = raw as ActionHookMode
    else problems.push(`RIPOSTE_ACTION_HOOK="${env.RIPOSTE_ACTION_HOOK}" is not one of ${ACTION_HOOK_MODES.join(' | ')}; staying off`)
  }
  const policy = env.RIPOSTE_ACTION_POLICY?.trim() || undefined
  const ledger = env.RIPOSTE_ACTION_LEDGER?.trim() || undefined
  return { mode, ...(policy ? { policy } : {}), ...(ledger ? { ledger } : {}), problems }
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

export interface PreToolUseResult {
  /** 0, or 1 for a visible non-blocking error when enforcing (never 2: Riposte's failures never block the host) */
  code: 0 | 1
  stdout: string
  stderr: string
  decision: HookDecision
  record?: ActionRecord
  skipped?: string
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
 * never fail) or 'on' (deliver). The caller handles 'off' by not calling this at all.
 */
export function preToolUseHook(stdin: string, mode: Exclude<ActionHookMode, 'off'>, deps: PreToolUseDeps): PreToolUseResult {
  const failCode: 0 | 1 = mode === 'on' ? 1 : 0
  const fail = (msg: string): PreToolUseResult => ({ code: failCode, stdout: '', stderr: `riposte-action --hook: ${msg} (failing open: the tool call proceeds through the normal permission flow)\n`, decision: 'none' })
  let hook: Record<string, unknown>
  try {
    const x: unknown = JSON.parse(stdin)
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return fail('stdin is not hook JSON')
    hook = x as Record<string, unknown>
  } catch { return fail('stdin is not hook JSON') }
  if (hook.hook_event_name !== undefined && hook.hook_event_name !== 'PreToolUse') return { code: 0, stdout: '', stderr: '', decision: 'none', skipped: `not a PreToolUse event (${String(hook.hook_event_name)})` }
  if (typeof hook.tool_name !== 'string') return fail('no tool_name in the hook input')
  const input = hook.tool_input
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('tool_input is not an object')
  let check
  try { check = checkAction(deps.policy, { tool: hook.tool_name, arguments: input as Record<string, unknown> }, deps) } catch (e) { return fail(`the check threw: ${(e as Error).message}`) }
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
