/**
 * OpenCode: the claims check as an OpenCode plugin on `session.idle` (https://opencode.ai/docs/plugins/).
 *
 * A plugin is a module whose exported functions each receive { client, project, directory, worktree, $ } and return hooks.
 * The `event` hook receives every bus event as { event: { type, properties } }; `session.idle` carries
 * properties.sessionID (SDK types.gen.ts, EventSessionIdle). The plugin's `client` is the v1 SDK client
 * (packages/plugin/src/index.ts imports createOpencodeClient from "@opencode-ai/sdk"):
 *   client.session.messages({ path: { id } })      → { data: Array<{ info: Message, parts: Part[] }> }
 *   client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text }] } })   sends a prompt, returns at once
 * Message: info.role "user" | "assistant", info.id, info.time.{created, completed}. Parts in order:
 *   TextPart {type "text", text, synthetic?, time?} · ToolPart {type "tool", callID, tool, state}
 *   state: {status "completed", input, output, metadata, time: {start, end}} | {status "error", input, error, time}
 *   | pending | running. Built-in tools (packages/opencode/src/tool/): "bash" {command} with metadata.exit = the exit
 *   code, "edit" / "write" {filePath}, "apply_patch" {patchText}.
 *
 * Sending back = a prompt into the session, marked so the next idle knows: it never sends back twice in a row (the last
 * user message is a send-back → that turn is not sent back again), and each assistant message is checked once.
 *
 * GOVERNANCE (../governance.ts; OFF unless a RIPOSTE_GOV_* variable is set). The plugin then also returns a
 * `tool.execute.before` hook (input { tool, sessionID, callID }, output { args }): it runs the fleet's execution-boundary
 * check before every tool call and THROWS on a refusal or any error, which is how an OpenCode plugin blocks a tool (the
 * docs' ".env protection" example). With no RIPOSTE_GOV_* set at plugin load, the plugin returns exactly the hooks it did.
 */
import { STOP_SEND_BACK, type Step } from 'riposte-ai'
import { EDIT_TOOL, SHELL_TOOL, WRITE_TOOL, checkAndRecord, failCode, hostConfig, isoOf, objectOf, patchFiles, type CheckedStop, type HostConfig, type LedgerLike } from './common.js'
import { decideGovernanceAsync, denyReason, governanceFromEnv, recordGovernance, type CheckerRunnerAsync, type GovernanceVerdict, type ReceiptWriter } from '../governance.js'

export interface OpenCodeMessage { info: Record<string, unknown>; parts: Record<string, unknown>[] }

/** The line every send-back ends with, in every wording (receipts STOP_SEND_BACK): how a send-back is recognised. */
const SEND_BACK_MARK = STOP_SEND_BACK.trim()

const textOfParts = (parts: Record<string, unknown>[]): string =>
  parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text as string).join('\n')

/** True when a user message is one of this port's send-backs. */
export function isSendBack(m: OpenCodeMessage): boolean {
  return m.info?.role === 'user' && (m.parts ?? []).some((p) => p?.type === 'text' && ((p.metadata as Record<string, unknown> | undefined)?.riposte === 'send-back' || (typeof p.text === 'string' && p.text.includes(SEND_BACK_MARK))))
}

/** An OpenCode session's messages as Steps. */
export function sessionFromOpenCodeMessages(messages: OpenCodeMessage[]): Step[] {
  const steps: Step[] = []
  for (const m of messages) {
    const info = m?.info ?? {}
    const parts = Array.isArray(m?.parts) ? m.parts : []
    const time = objectOf(info.time)
    if (info.role === 'user') {
      if (textOfParts(parts.filter((p) => p.synthetic !== true)).trim()) steps.push({ kind: 'user_prompt', ...(isoOf(time.created) ? { at: isoOf(time.created)! } : {}) })
      continue
    }
    if (info.role !== 'assistant') continue
    const msgAt = isoOf(time.completed) ?? isoOf(time.created)
    for (const p of parts) {
      if (p?.type === 'text' && typeof p.text === 'string' && p.ignored !== true) {
        const at = isoOf(objectOf(p.time).end) ?? msgAt
        steps.push({ kind: 'assistant_text', text: p.text, ...(typeof info.id === 'string' ? { message_id: info.id } : {}), ...(at ? { at } : {}) })
        continue
      }
      if (p?.type !== 'tool' || typeof p.callID !== 'string') continue
      const state = objectOf(p.state)
      const input = objectOf(state.input)
      const st = objectOf(state.time)
      const useAt = isoOf(st.start) ?? msgAt
      const resAt = isoOf(st.end) ?? msgAt
      const done = state.status === 'completed' || state.status === 'error'
      const resultText = state.status === 'error' ? String(state.error ?? 'tool failed') : typeof state.output === 'string' ? state.output : ''
      const exit = objectOf(state.metadata).exit
      const isError = state.status === 'error' || (typeof exit === 'number' && exit !== 0)
      const tool = String(p.tool ?? '')
      const uses: { id: string; name: string; input: Record<string, unknown> }[] = []
      if (tool === 'bash' || tool === 'shell') uses.push({ id: p.callID, name: SHELL_TOOL, input: { command: typeof input.command === 'string' ? input.command : '' } })
      else if (tool === 'apply_patch' && typeof input.patchText === 'string') {
        const files = patchFiles(input.patchText)
        files.forEach((f, i) => uses.push({ id: files.length === 1 ? p.callID as string : `${p.callID}#${i + 1}`, name: EDIT_TOOL, input: { file_path: f } }))
      } else if ((tool === 'edit' || tool === 'write' || tool === 'multiedit') && typeof input.filePath === 'string') uses.push({ id: p.callID, name: tool === 'write' ? WRITE_TOOL : EDIT_TOOL, input: { file_path: input.filePath } })
      else uses.push({ id: p.callID, name: tool, input })
      for (const u of uses) steps.push({ kind: 'tool_use', ...u, ...(useAt ? { at: useAt } : {}) })
      if (done) for (const u of uses) steps.push({ kind: 'tool_result', id: u.id, text: resultText, isError, ...(resAt ? { at: resAt } : {}) })
    }
  }
  return steps
}

export interface OpenCodeIdleDeps {
  env: Record<string, string | undefined>
  messages: () => Promise<OpenCodeMessage[]>
  sendBack: (text: string) => Promise<void>
  /** assistant message ids already checked by this plugin instance */
  checked: Set<string>
  ledgerArg?: string
  defaultLedger?: string
  openLedger?: (path: string) => LedgerLike
}

export interface OpenCodeIdleResult { code: 0 | 1; config: HostConfig; checked?: CheckedStop; sentBack: boolean; skipped?: string; error?: string; problems: string[] }

/**
 * One `session.idle`. Never throws: an error is returned (and the plugin logs it); nothing is sent back. In record-only
 * nothing is ever sent; in an enforcing mode a flagged claim is sent back once with promptAsync.
 */
export async function openCodeIdle(deps: OpenCodeIdleDeps): Promise<OpenCodeIdleResult> {
  const cfg = hostConfig(deps.env, deps.ledgerArg, deps.defaultLedger)
  const base = { config: cfg, problems: cfg.problems, sentBack: false }
  try {
    const messages = await deps.messages()
    if (!Array.isArray(messages)) return { ...base, code: failCode(cfg), error: 'session.messages returned no list' }
    let lastAssistant = -1
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.info?.role === 'assistant') { lastAssistant = i; break }
    if (lastAssistant < 0) return { ...base, code: 0, skipped: 'no assistant message in the session' }
    const id = String(messages[lastAssistant]!.info.id ?? `#${lastAssistant}`)
    if (deps.checked.has(id)) return { ...base, code: 0, skipped: 'this assistant message was already checked' }
    deps.checked.add(id)
    let lastUser = -1
    for (let i = lastAssistant - 1; i >= 0; i--) if (messages[i]?.info?.role === 'user') { lastUser = i; break }
    if (lastUser >= 0 && isSendBack(messages[lastUser]!)) return { ...base, code: 0, skipped: 'this stop was already sent back once' }
    const steps = sessionFromOpenCodeMessages(messages.slice(0, lastAssistant + 1))
    const checked = checkAndRecord({ steps, alreadySentBack: false }, cfg, 'opencode', deps.openLedger)
    if (checked.decision.code === 2) {
      try { await deps.sendBack(checked.decision.stderr) } catch (e) { return { ...base, code: failCode(cfg), checked, error: `send-back failed: ${(e as Error).message}` } }
      return { ...base, code: 0, checked, sentBack: true, ...(checked.note ? { error: checked.note } : {}) }
    }
    return { ...base, code: 0, checked, ...(checked.note ? { error: checked.note } : {}) }
  } catch (e) {
    return { ...base, code: failCode(cfg), error: (e as Error).message }
  }
}

/** A governance denial, thrown from `tool.execute.before` to block the tool. Its message is the reason OpenCode shows. */
export class GovernanceDenied extends Error {
  readonly verdict: GovernanceVerdict
  constructor(v: GovernanceVerdict) {
    super(denyReason(v))
    this.name = 'GovernanceDenied'
    this.verdict = v
  }
}

export interface OpenCodeGovernanceDeps {
  env: Record<string, string | undefined>
  run?: CheckerRunnerAsync
  writeReceipt?: ReceiptWriter
}

/**
 * The governance check for one OpenCode `tool.execute.before`: resolves with the verdict on ALLOW; throws GovernanceDenied
 * on a refusal and on any error (no receipts ledger, a checker that fails, input it cannot read). The configuration is read
 * on every call; nothing is cached.
 */
export async function openCodeToolBefore(input: { tool?: unknown; sessionID?: unknown; callID?: unknown } | undefined, output: { args?: unknown } | undefined, deps: OpenCodeGovernanceDeps): Promise<GovernanceVerdict> {
  const gov = governanceFromEnv(deps.env)
  const tool = typeof input?.tool === 'string' ? input.tool : ''
  const v0: GovernanceVerdict = tool
    ? await decideGovernanceAsync(gov, { tool, input: output?.args ?? {} }, deps.run)
    : { decision: 'deny', code: 'governance.bad_input', detail: 'tool.execute.before named no tool', agent: gov.config?.agent ?? null, tool: '', call_sha256: null }
  const rec = recordGovernance('opencode', gov, v0, deps.writeReceipt, {
    ...(typeof input?.sessionID === 'string' ? { session_id: input.sessionID } : {}), ...(typeof input?.callID === 'string' ? { tool_use_id: input.callID } : {}),
  })
  if (rec.verdict.decision !== 'allow') throw new GovernanceDenied(rec.verdict)
  return rec.verdict
}

/** The send-back as an OpenCode prompt body: one text part, marked as Riposte's. */
export const sendBackBody = (text: string) => ({ parts: [{ type: 'text' as const, text, metadata: { riposte: 'send-back' } }] })
