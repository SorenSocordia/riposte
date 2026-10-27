/**
 * Cursor: the claims check on Cursor's agent hooks (https://cursor.com/docs/agent/hooks).
 *
 * Cursor documents `transcript_path` ("Path to the main conversation transcript file (null if transcripts disabled)") but
 * not the transcript's format. So this port does not read it. It reads only payloads Cursor documents, journals them per
 * conversation, and checks the journal at `stop`:
 *   postToolUse          {tool_name, tool_input, tool_output: "JSON-stringified result payload", tool_use_id}
 *                        e.g. tool_name "Shell", tool_input {command}, tool_output "{\"exitCode\":0,\"stdout\":\"…\"}"
 *   postToolUseFailure   {tool_name, tool_input, tool_use_id, error_message, failure_type}
 *   afterFileEdit        {file_path, edits}
 *   afterAgentResponse   {text}  ("Called after the agent has completed an assistant message")
 *   stop                 {status: "completed" | "aborted" | "error", loop_count}; output {followup_message}
 *   sessionEnd           the journal is deleted
 * Every payload also carries conversation_id and generation_id ("changes with every user message").
 *
 * Sending back: a non-empty `followup_message` is submitted as the next user message. Cursor's own cap is `loop_limit`
 * (default 5 per script). Ours is once: no send-back when loop_count > 0, or when this port's previous stop in the
 * conversation already sent one back. The installer also sets loop_limit 1.
 * Every event is answered with JSON on stdout (`{}` when there is nothing to say): Cursor counts "no output" as a failed hook.
 *
 * GOVERNANCE (../governance.ts; OFF unless a RIPOSTE_GOV_* variable is set). Registered on `preToolUse` too ("Called before
 * any tool execution ... Shell, Read, Write, MCP, Task"), the same bin runs the fleet's execution-boundary check and answers
 * `{"permission": "deny", "user_message", "agent_message"}` on a refusal and on any error, `{"permission": "allow"}` on an
 * ALLOW (the docs do not mark `permission` optional for this permission hook, so an empty answer could fail its schema).
 * Register that entry with `failClosed: true`, so a crash or a timeout of the hook process blocks too. With no
 * RIPOSTE_GOV_* set, `preToolUse` is skipped exactly as before (`{}`).
 */
import type { Step } from 'riposte-ai'
import { EDIT_TOOL, SHELL_TOOL, WRITE_TOOL, checkAndRecord, failCode, hostConfig, objectOf, type CheckedStop, type HostConfig, type LedgerLike } from './common.js'
import { decideGovernance, denyReason, governanceFromEnv, recordGovernance, type CheckerRunner, type GovernanceVerdict, type ReceiptWriter } from '../governance.js'

/** One journal line: a normalised Cursor event. `g` is the generation id, `at` when the port received it. */
export type CursorEntry =
  | { k: 'tool'; at: string; g?: string; id: string; name: string; input: Record<string, unknown>; text: string; isError: boolean }
  | { k: 'edit'; at: string; g?: string; path: string }
  | { k: 'text'; at: string; g?: string; text: string }
  | { k: 'stop'; at: string; g?: string; sentBack: boolean; status?: string }

/** Kept from each tool output: the tail, where test and build summaries are. */
export const CURSOR_OUTPUT_TAIL = 64 * 1024

const FILE_TOOLS: Record<string, string> = { write: WRITE_TOOL, edit: EDIT_TOOL, strreplace: EDIT_TOOL, multiedit: EDIT_TOOL, searchreplace: EDIT_TOOL }

function toolStep(name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  if (/^(?:shell|terminal|run_terminal_cmd)$/i.test(name)) return { name: SHELL_TOOL, input: { command: typeof input.command === 'string' ? input.command : '' } }
  const file = FILE_TOOLS[name.toLowerCase()]
  if (file) {
    const p = input.file_path ?? input.path ?? input.target_file ?? input.filePath
    return { name: file, input: typeof p === 'string' ? { file_path: p } : {} }
  }
  return { name, input }
}

const tail = (s: string) => (s.length > CURSOR_OUTPUT_TAIL ? s.slice(-CURSOR_OUTPUT_TAIL) : s)

/** A Cursor tool_output (a JSON string) as text and an error flag. Shell: exitCode, stdout, stderr. Anything else: as given. */
export function cursorToolOutput(raw: unknown): { text: string; isError: boolean } {
  const o = objectOf(raw)
  const parts = ['stdout', 'stderr', 'output', 'result'].map((k) => o[k]).filter((v): v is string => typeof v === 'string' && v.length > 0)
  const text = parts.length ? parts.join('\n') : typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw)
  const exit = typeof o.exitCode === 'number' ? o.exitCode : typeof o.exit_code === 'number' ? o.exit_code : undefined
  return { text: tail(text), isError: exit !== undefined ? exit !== 0 : o.isError === true || o.is_error === true }
}

let seq = 0
/** The journal entry for one Cursor hook payload, or null when the event is not one the check reads. */
export function cursorEntryFromPayload(hook: Record<string, unknown>, now: () => Date = () => new Date()): CursorEntry | null {
  const at = now().toISOString()
  const g = typeof hook.generation_id === 'string' ? { g: hook.generation_id } : {}
  const ev = hook.hook_event_name
  if (ev === 'postToolUse' || ev === 'postToolUseFailure') {
    const id = typeof hook.tool_use_id === 'string' && hook.tool_use_id ? hook.tool_use_id : `cursor-${Date.now()}-${++seq}`
    const step = toolStep(String(hook.tool_name ?? ''), objectOf(hook.tool_input))
    const out = ev === 'postToolUse' ? cursorToolOutput(hook.tool_output) : { text: tail(String(hook.error_message ?? hook.failure_type ?? 'tool failed')), isError: true }
    return { k: 'tool', at, ...g, id, name: step.name, input: step.input, text: out.text, isError: out.isError }
  }
  if (ev === 'afterFileEdit' && typeof hook.file_path === 'string') return { k: 'edit', at, ...g, path: hook.file_path }
  if (ev === 'afterAgentResponse' && typeof hook.text === 'string') return { k: 'text', at, ...g, text: hook.text }
  return null
}

export function parseCursorJournal(text: string): CursorEntry[] {
  const out: CursorEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { const e = JSON.parse(line); if (e && typeof e === 'object' && typeof e.k === 'string') out.push(e as CursorEntry) } catch { /* a torn line */ }
  }
  return out
}

/** A conversation's journal as Steps. A change of generation id is a new user message. */
export function sessionFromCursorJournal(entries: CursorEntry[]): Step[] {
  const steps: Step[] = []
  let gen: string | undefined
  let n = 0
  for (const e of entries) {
    if (e.g && gen !== undefined && e.g !== gen) steps.push({ kind: 'user_prompt', at: e.at })
    if (e.g) gen = e.g
    if (e.k === 'tool') {
      steps.push({ kind: 'tool_use', id: e.id, name: e.name, input: e.input, at: e.at })
      steps.push({ kind: 'tool_result', id: e.id, text: e.text, isError: e.isError, at: e.at })
    } else if (e.k === 'edit') {
      const id = `cursor-edit-${++n}`
      steps.push({ kind: 'tool_use', id, name: EDIT_TOOL, input: { file_path: e.path }, at: e.at })
      steps.push({ kind: 'tool_result', id, text: e.path, isError: false, at: e.at })
    } else if (e.k === 'text') steps.push({ kind: 'assistant_text', text: e.text, at: e.at })
  }
  return steps
}

/** Where a conversation's journal lives: a file name safe on every platform. */
export const journalName = (conversationId: string): string => `${conversationId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'conversation'}.jsonl`

export interface CursorJournal { read(name: string): string | null; append(name: string, line: string): void; remove(name: string): void }

export interface CursorHookDeps {
  env: Record<string, string | undefined>
  journal: CursorJournal
  ledgerArg?: string
  defaultLedger?: string
  openLedger?: (path: string) => LedgerLike
  now?: () => Date
  /** governance (RIPOSTE_GOV_*): the checker runner (default: spawn it) and the receipt writer */
  runChecker?: CheckerRunner
  writeReceipt?: ReceiptWriter
}

export interface CursorHookResult { code: 0 | 1; stdout: string; stderr: string; config?: HostConfig; checked?: CheckedStop; skipped?: string; event?: string; governance?: { verdict: GovernanceVerdict; receipt?: Record<string, unknown> } }

/** Cursor's answer to `preToolUse` for one governance verdict. */
export function cursorPermission(v: GovernanceVerdict): string {
  if (v.decision === 'allow') return `${JSON.stringify({ permission: 'allow' })}\n`
  return `${JSON.stringify({ permission: 'deny', user_message: `Riposte governance denied ${v.tool || 'this call'}: ${v.code}`, agent_message: denyReason(v) })}\n`
}

/**
 * One Cursor hook call, whatever the event. Journals the events the check reads; at `stop`, checks the conversation's
 * journal with the Claude Code hook's decision, writes the receipt, and answers `{"followup_message": …}` only when an
 * enforcing mode flags a claim and this turn has not been sent back yet.
 */
export function cursorHook(stdin: string, deps: CursorHookDeps): CursorHookResult {
  const cfg = hostConfig(deps.env, deps.ledgerArg, deps.defaultLedger)
  const pre = cfg.problems.map((p) => `riposte-cursor: ${p}\n`).join('')
  const now = deps.now ?? (() => new Date())
  const fail = (why: string, event?: string): CursorHookResult => ({ code: failCode(cfg), stdout: '{}\n', stderr: `${pre}riposte-cursor --hook: ${why}\n`, config: cfg, ...(event ? { event } : {}) })
  // governance: receipts to RIPOSTE_GOV_RECEIPTS, else this bin's --ledger (never RIPOSTE_LEDGER or the default ledger)
  const gov = governanceFromEnv(deps.env, { ...(deps.ledgerArg ? { receiptsFallback: deps.ledgerArg } : {}) })
  const governance = (hook: Record<string, unknown> | null, why?: string): CursorHookResult => {
    const v0: GovernanceVerdict = !hook || why
      ? { decision: 'deny', code: 'governance.bad_input', detail: why ?? 'stdin is not hook JSON', agent: gov.config?.agent ?? null, tool: '', call_sha256: null }
      : typeof hook.tool_name !== 'string' || !hook.tool_name
        ? { decision: 'deny', code: 'governance.bad_input', detail: 'no tool_name in the hook input', agent: gov.config?.agent ?? null, tool: '', call_sha256: null }
        : decideGovernance(gov, { tool: hook.tool_name, input: objectOf(hook.tool_input) }, deps.runChecker)
    const rec = recordGovernance('cursor', gov, v0, deps.writeReceipt, {
      ...(typeof hook?.conversation_id === 'string' ? { session_id: hook.conversation_id } : {}), ...(typeof hook?.tool_use_id === 'string' ? { tool_use_id: hook.tool_use_id } : {}),
    })
    return { code: 0, stdout: cursorPermission(rec.verdict), stderr: `${pre}${rec.note ? `riposte-cursor: ${rec.note}\n` : ''}`, config: cfg, event: 'preToolUse', governance: { verdict: rec.verdict, ...(rec.receipt ? { receipt: rec.receipt } : {}) } }
  }
  try {
    let hook: Record<string, unknown>
    try { hook = JSON.parse(stdin) } catch { return gov.on ? governance(null) : fail('stdin is not hook JSON') }
    if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return gov.on ? governance(null) : fail('stdin is not hook JSON')
    const event = typeof hook.hook_event_name === 'string' ? hook.hook_event_name : undefined
    if (event === 'preToolUse' && gov.on) return governance(hook)
    const conv = typeof hook.conversation_id === 'string' && hook.conversation_id ? hook.conversation_id : typeof hook.session_id === 'string' ? hook.session_id : ''
    if (!conv) return fail('no conversation_id in the hook input', event)
    const name = journalName(conv)
    const ok = (extra: Partial<CursorHookResult> = {}): CursorHookResult => ({ code: 0, stdout: '{}\n', stderr: pre, config: cfg, ...(event ? { event } : {}), ...extra })

    if (event === 'sessionEnd') { deps.journal.remove(name); return ok() }
    if (event !== 'stop') {
      const entry = cursorEntryFromPayload(hook, now)
      if (entry) deps.journal.append(name, JSON.stringify(entry))
      return ok(entry ? {} : { skipped: `not an event the check reads (${event ?? 'no hook_event_name'})` })
    }

    // stop
    const entries = parseCursorJournal(deps.journal.read(name) ?? '')
    const g = typeof hook.generation_id === 'string' ? { g: hook.generation_id } : {}
    const status = typeof hook.status === 'string' ? hook.status : undefined
    const record = (sentBack: boolean) => deps.journal.append(name, JSON.stringify({ k: 'stop', at: now().toISOString(), ...g, sentBack, ...(status ? { status } : {}) } satisfies CursorEntry))
    if (status && status !== 'completed') { record(false); return ok({ skipped: `the agent loop ended with status "${status}"` }) }
    const lastStop = [...entries].reverse().find((e) => e.k === 'stop') as Extract<CursorEntry, { k: 'stop' }> | undefined
    const loopCount = typeof hook.loop_count === 'number' ? hook.loop_count : 0
    if (loopCount > 0 || lastStop?.sentBack === true) { record(false); return ok({ skipped: 'this stop was already sent back once' }) }
    const steps = sessionFromCursorJournal(entries)
    if (!steps.some((s) => s.kind === 'assistant_text')) { record(false); return fail('no assistant message journaled for this conversation (are afterAgentResponse and postToolUse registered?)', event) }
    const checked = checkAndRecord({ steps, alreadySentBack: false }, cfg, 'cursor', deps.openLedger)
    const note = checked.note ? `riposte-cursor: ${checked.note}\n` : ''
    const sendBack = checked.decision.code === 2 ? checked.decision.stderr : ''
    record(Boolean(sendBack))
    return {
      code: 0, stdout: `${JSON.stringify(sendBack ? { followup_message: sendBack } : {})}\n`, stderr: `${pre}${note}`, config: cfg, checked, event,
    }
  } catch (e) {
    return fail((e as Error).message)
  }
}
