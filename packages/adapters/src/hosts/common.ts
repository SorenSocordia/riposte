/**
 * Host ports of the claims check: OpenAI Codex CLI, Cursor and OpenCode.
 *
 * The Claude Code Stop hook (receipts `riposte-claims --hook`) checks the claims an agent ends a turn with ("all tests pass",
 * "the build is clean", "committed", "pushed", "created `x`") against what its own tools returned in the session. Each host
 * port here does the same at that host's end-of-turn event:
 *
 *   1. a transcript adapter (./codex.ts, ./cursor.ts, ./opencode.ts) turns the host's own record into the checker's Steps;
 *   2. the Steps go to receipts' `stopDecision`, the function the Claude Code `stopHook` calls once it has read its
 *      transcript, so the decision, the send-back wording and the "send back once" rule are the Claude Code hook's, by
 *      construction;
 *   3. the receipt is the one the Claude Code hook writes (`stopReceipt`, stamped by the claims checker) with one more key,
 *      `host` ("codex" · "cursor" · "opencode"), so the ledger says where a stop came from. Remove `host` and the bytes are
 *      the Claude Code hook's for the same claim. It is appended to a hash-chained ledger the same way, so
 *      `riposte-ledger verify` reads every host's receipts alike.
 *
 * Only two things differ per host: how its record is read, and how it is told to keep going (Codex: exit 2 with the reason
 * on stderr; Cursor: a `followup_message`; OpenCode: a prompt sent into the session).
 *
 * The contract, on every host:
 * - Record-only by default. With RIPOSTE_HOOK_MODE unset it checks, records `would_block`, and never sends a turn back.
 *   `only-contradicted` sends back only demonstrably false claims; `block` also sends back unbacked ones.
 * - It sends a stop back at most once. Each host's own "this turn was already continued" signal is honoured, and where the
 *   host has none, the port remembers its own last send-back.
 * - It fails open. Its own errors never block the host: in record-only it exits 0; in an enforcing mode it reports a visible,
 *   non-blocking error (exit 1), exactly like the Claude Code hook.
 * - The same environment: RIPOSTE_HOOK_MODE, RIPOSTE_STRICT, RIPOSTE_LEDGER, RIPOSTE_NUNCHI (+ RIPOSTE_TIER, RIPOSTE_AUDIENCE),
 *   RECEIPTS_KEY.
 */
import { hookOptionsFromEnv, stamped, stopDecision, stopReceipt, type HookDecision, type HookMode, type Step, type StopHookOptions } from 'riposte-ai'

/** Canonical tool names the claims checker recognises. Each adapter maps its host's tool ids onto these. */
export const SHELL_TOOL = 'Bash'
export const EDIT_TOOL = 'Edit'
export const WRITE_TOOL = 'Write'

/**
 * The Steps of a session in the Claude Code transcript shape (JSONL), lossless for everything the claims checker reads:
 * `sessionFromClaudeCodeTranscript(stepsToClaudeCodeJsonl(s))` gives back `s`. One line per step. The decision no longer
 * goes through it (see decideHostStop); it stays so a host session can be audited with `riposte-claims --all-turns`.
 */
export function stepsToClaudeCodeJsonl(steps: Step[]): string {
  const lines = steps.map((s) => {
    const ts = s.at ? { timestamp: s.at } : {}
    if (s.kind === 'assistant_text') return { type: 'assistant', ...ts, message: { ...(s.message_id ? { id: s.message_id } : {}), role: 'assistant', content: [{ type: 'text', text: s.text }] } }
    if (s.kind === 'tool_use') return { type: 'assistant', ...ts, message: { role: 'assistant', content: [{ type: 'tool_use', id: s.id, name: s.name, input: s.input }] } }
    if (s.kind === 'tool_result') return { type: 'user', ...ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: s.id, content: s.text, is_error: s.isError }] } }
    return { type: 'user', ...ts, message: { role: 'user', content: '(user prompt)' } }
  })
  return lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '')
}

/** A host's end-of-turn moment, normalised. */
export interface HostSession {
  steps: Step[]
  /** the final message as the host reports it at the hook, when it does (the record can lag it) */
  lastMessage?: string | null
  /** this turn was already sent back once (the host's own flag, or the port's memory) */
  alreadySentBack: boolean
}

/**
 * The Claude Code Stop hook's decision, on a host's session: receipts' `stopDecision`, the function `stopHook` itself calls
 * once it has read a Claude Code transcript (2026-10-03). A turn already sent back is let through unchecked, as `stopHook`
 * does for `stop_hook_active`.
 */
export function decideHostStop(session: HostSession, opts: StopHookOptions): HookDecision {
  if (session.alreadySentBack) return { code: 0, stderr: '', skipped: 'this stop was already sent back once' }
  return stopDecision(session.steps, typeof session.lastMessage === 'string' ? session.lastMessage : null, opts)
}

/** The hosts these ports run on, as written in a receipt's `host` key. A receipt without one is Claude Code's. */
export type HostName = 'codex' | 'cursor' | 'opencode'

/**
 * The receipt body for a checked stop: the Claude Code hook's (`stopReceipt`, stamped by the claims checker) plus `host`
 * right after `source`. Remove `host` and the bytes are the Claude Code hook's for the same claim; a Claude Code receipt
 * carries no `host` and keeps its bytes (receipts `stopReceiptHost` reads a missing one as "claude-code").
 */
export function hostReceipt(d: HookDecision, mode: string, strict: boolean, host: HostName): Record<string, unknown> {
  return stamped('claims_check', stopReceipt(d, mode, strict, host))
}

export interface HostConfig { mode: HookMode; opts: StopHookOptions; ledger?: string; problems: string[] }

/**
 * Hook configuration, with the Claude Code hook's semantics (`riposte-claims --hook --from-env`): RIPOSTE_HOOK_MODE and the
 * rest from the environment, record-only unless told otherwise. The ledger is RIPOSTE_LEDGER, else `--ledger`, else the
 * port's default.
 */
export function hostConfig(env: Record<string, string | undefined>, ledgerArg?: string, defaultLedger?: string): HostConfig {
  const e = hookOptionsFromEnv(env)
  const ledger = e.ledger ?? ledgerArg ?? defaultLedger
  return { mode: e.mode, opts: e.opts, ...(ledger ? { ledger } : {}), problems: e.problems }
}

/** Our own failure: never blocks. Record-only promises silence (0); an enforcing mode makes it visible (1, non-blocking). */
export const failCode = (cfg: HostConfig): 0 | 1 => (cfg.opts.recordOnly ? 0 : 1)

export interface LedgerLike { append(kind: 'claims_check', body: unknown): unknown }

export interface CheckedStop { decision: HookDecision; receipt?: Record<string, unknown>; note?: string }

/** Decide, and append the receipt when the message made a checkable claim (the Claude Code hook's rule). */
export function checkAndRecord(session: HostSession, cfg: HostConfig, host: HostName, openLedger?: (path: string) => LedgerLike): CheckedStop {
  const decision = decideHostStop(session, cfg.opts)
  if (!decision.result?.claims.length) return { decision }
  const receipt = hostReceipt(decision, cfg.mode, cfg.opts.strict === true, host)
  if (!cfg.ledger || !openLedger) return { decision, receipt }
  try {
    openLedger(cfg.ledger).append('claims_check', receipt)
    return { decision, receipt }
  } catch (e) {
    return { decision, receipt, note: `ledger not written: ${(e as Error).message}` }
  }
}

// ── shared parsing helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The files a patch in the `*** Begin Patch` format touches (Codex `apply_patch`, OpenCode `apply_patch`): added, updated
 * and moved-to files. Deletions are left out, so a deletion can never back a "created `x`" claim.
 */
export function patchFiles(patch: string): string[] {
  const out: string[] = []
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/gm)) out.push(m[1]!)
  return [...new Set(out)]
}

/** A JSON string parsed to an object, or {} (host tool arguments arrive as strings). */
export function objectOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch { return {} }
}

/** Epoch milliseconds or an ISO string as ISO, else undefined. */
export function isoOf(t: unknown): string | undefined {
  if (typeof t === 'string' && t.trim()) return t
  if (typeof t === 'number' && Number.isFinite(t)) { const d = new Date(t); return Number.isNaN(d.getTime()) ? undefined : d.toISOString() }
  return undefined
}
