/**
 * OpenAI Codex CLI: the claims check on Codex's `Stop` hook.
 *
 * The hook (https://developers.openai.com/codex/hooks, "Stop"; wire schema codex-rs/hooks/schema/generated/
 * stop.command.input.schema.json) gets one JSON object on stdin: session_id, transcript_path (string | null), cwd,
 * hook_event_name "Stop", model, turn_id, permission_mode, stop_hook_active ("Whether this turn was already continued by
 * Stop") and last_assistant_message (string | null). Exit 0 with nothing on stdout lets the turn end. Exit 2 with a reason on
 * stderr "tells Codex to continue and automatically creates a new continuation prompt", the same as Claude Code's exit 2.
 * Any other exit is a failed hook run that does not block.
 *
 * transcript_path is the session's rollout file (core/src/hook_runtime.rs uses the thread's `rollout_path`). The docs warn
 * that "the transcript format isn't a stable interface for hooks and may change over time", so this adapter reads only the
 * persisted response items it needs and ignores everything else:
 *   {"timestamp": "...", "type": "response_item", "payload": {...}}     (codex-rs/history/src/lib.rs, RolloutLine)
 * with payload.type (codex-rs/protocol/src/models.rs, ResponseItem):
 *   message (role assistant: content[].type "output_text") · function_call {name, arguments: JSON string, call_id}
 *   function_call_output {call_id, output: string | content items} · custom_tool_call {name, input, call_id}
 *   custom_tool_call_output · local_shell_call {call_id, action: {type: "exec", command: [...]}}
 * The shell tool is `exec_command` {cmd}. Its output starts with a header (core/src/tools/context.rs):
 *   "Wall time: … seconds\nProcess exited with code N\nOutput:\n…", or "Process running with session ID N" when the
 *   command is still running; `write_stdin` {session_id} then returns the rest, ending with the exit code.
 * The exit code lives only in that text: the rollout does not persist ExecCommandEnd (rollout/src/policy.rs).
 *
 * GOVERNANCE (../governance.ts; OFF unless a RIPOSTE_GOV_* variable is set). Registered on Codex's `PreToolUse` event too,
 * the same bin runs the fleet's execution-boundary check before every tool call and denies with the documented PreToolUse
 * shape (`hookSpecificOutput.permissionDecision: "deny"` on stdout, exit 0), on a refusal and on any error. Codex documents
 * that a PreToolUse hook that errors or times out does not block, so the deny is always an explicit answer. With no
 * RIPOSTE_GOV_* set, a PreToolUse event is skipped exactly as before.
 */
import type { Step } from 'riposte-ai'
import { EDIT_TOOL, SHELL_TOOL, checkAndRecord, failCode, hostConfig, objectOf, patchFiles, type CheckedStop, type HostConfig, type LedgerLike } from './common.js'
import { governanceFromEnv, governanceHook, type CheckerRunner, type GovernanceHookResult, type ReceiptWriter } from '../governance.js'

const SHELL_FUNCTIONS = /^(?:exec_command|shell|shell_command|container\.exec|local_shell)$/
const PATCH_FAILED = /apply_patch verification failed|apply_patch handler received invalid patch input|failed to parse apply_patch|apply_patch is unavailable/i

/** The command a shell call ran, as one string ("bash -lc 'npm test'" → "npm test"). */
export function codexCommand(args: Record<string, unknown>): string | undefined {
  if (typeof args.cmd === 'string') return args.cmd
  const c = args.command
  if (typeof c === 'string') return c
  if (Array.isArray(c) && c.length && c.every((x) => typeof x === 'string')) {
    const a = c as string[]
    if (a.length >= 3 && /(?:^|[\\/])(?:ba|z|da|k)?sh(?:\.exe)?$|(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(a[0]!) && /^-(?:l?c|Command)$/i.test(a[1]!)) return a.slice(2).join(' ')
    return a.join(' ')
  }
  return undefined
}

/** A tool output's text, exit code (if the text carries one), whether the command is still running, and the body. */
export function codexOutput(raw: unknown): { text: string; exit?: number; running?: string; success?: boolean } {
  let text = ''
  let success: boolean | undefined
  if (typeof raw === 'string') text = raw
  else if (Array.isArray(raw)) text = raw.map((x) => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).filter(Boolean).join('\n')
  else if (raw && typeof raw === 'object') { // older rollouts: {content, success}
    const o = raw as { content?: unknown; success?: unknown }
    if (typeof o.content === 'string') text = o.content
    if (typeof o.success === 'boolean') success = o.success
  }
  // older shell tool: the output is a JSON string {"output": "...", "metadata": {"exit_code": N}}
  if (/^\s*\{/.test(text)) {
    const j = objectOf(text)
    const meta = objectOf(j.metadata)
    if (typeof j.output === 'string') return { text: j.output, ...(typeof meta.exit_code === 'number' ? { exit: meta.exit_code } : {}), ...(success !== undefined ? { success } : {}) }
  }
  const exitM = text.match(/^Process exited with code (-?\d+)\s*$/m) ?? text.match(/^Exit code: (-?\d+)\s*$/m)
  const running = text.match(/^Process running with session ID (\S+)\s*$/m)?.[1]
  let body = text
  if (/^(?:Chunk ID:|Wall time:|Exit code:)/.test(text)) {
    const i = text.indexOf('\nOutput:\n')
    if (i >= 0) body = text.slice(i + '\nOutput:\n'.length)
    else if (/\nOutput:\s*$/.test(text)) body = ''
  }
  return { text: body, ...(exitM ? { exit: Number(exitM[1]) } : {}), ...(running ? { running } : {}), ...(success !== undefined ? { success } : {}) }
}

/**
 * A Codex rollout (JSONL) as the claims checker's Steps. Shell calls become `Bash` runs with the command as one string,
 * apply_patch becomes one `Edit` per touched file, and a long-running command's later `write_stdin` output is folded into
 * the original call's result. User prompts are the user messages that are not injected context (`<environment_context>` and
 * the like, which start with "<"). Lines that do not parse, and items it does not read, are skipped.
 */
export function sessionFromCodexRollout(jsonl: string): Step[] {
  const steps: Step[] = []
  const shellCalls = new Set<string>() // call ids of shell runs
  const patchCalls = new Map<string, string[]>() // call id → the Edit step ids it stands for
  const sessions = new Map<string, string>() // running process session id → the shell call that started it
  const stdinCalls = new Map<string, string>() // write_stdin call id → the shell call it continues
  const output = new Map<string, string>() // shell call id → output so far
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let j: Record<string, unknown>
    try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'response_item' || !j.payload || typeof j.payload !== 'object') continue
    const p = j.payload as Record<string, unknown>
    const stamp = typeof j.timestamp === 'string' ? { at: j.timestamp } : {}
    const callId = typeof p.call_id === 'string' ? p.call_id : typeof p.id === 'string' ? p.id : undefined

    if (p.type === 'message' && Array.isArray(p.content)) {
      const parts = (p.content as Record<string, unknown>[]).filter((c) => c && typeof c.text === 'string')
      if (p.role === 'assistant') {
        for (const c of parts) if (c.type === 'output_text' || c.type === 'text') steps.push({ kind: 'assistant_text', text: c.text as string, ...(typeof p.id === 'string' ? { message_id: p.id } : {}), ...stamp })
      } else if (p.role === 'user') {
        const t = parts.map((c) => c.text as string).join('\n').trim()
        if (t && !t.startsWith('<')) steps.push({ kind: 'user_prompt', ...stamp })
      }
      continue
    }

    const patch = (id: string, text: string) => {
      const files = patchFiles(text)
      const ids = files.map((_, i) => (files.length === 1 ? id : `${id}#${i + 1}`))
      files.forEach((f, i) => steps.push({ kind: 'tool_use', id: ids[i]!, name: EDIT_TOOL, input: { file_path: f }, ...stamp }))
      patchCalls.set(id, ids)
    }

    if ((p.type === 'function_call' || p.type === 'custom_tool_call') && callId) {
      const name = String(p.name ?? '')
      if (p.type === 'custom_tool_call' && name === 'apply_patch' && typeof p.input === 'string') { patch(callId, p.input); continue }
      const args = p.type === 'function_call' ? objectOf(p.arguments) : { input: p.input }
      if (name === 'apply_patch' && typeof args.input === 'string') { patch(callId, args.input); continue }
      if (name === 'write_stdin') {
        const orig = sessions.get(String(args.session_id ?? ''))
        if (orig) stdinCalls.set(callId, orig)
        continue
      }
      if (SHELL_FUNCTIONS.test(name)) {
        const command = codexCommand(args)
        if (command !== undefined) {
          if (/^\s*apply_patch\b/.test(command) && /\*\*\* Begin Patch/.test(command)) { patch(callId, command); continue }
          shellCalls.add(callId)
          steps.push({ kind: 'tool_use', id: callId, name: SHELL_TOOL, input: { command }, ...stamp })
          continue
        }
      }
      steps.push({ kind: 'tool_use', id: callId, name, input: args, ...stamp })
      continue
    }

    if (p.type === 'local_shell_call' && callId) {
      const action = objectOf(p.action)
      const command = codexCommand(action)
      if (command !== undefined) { shellCalls.add(callId); steps.push({ kind: 'tool_use', id: callId, name: SHELL_TOOL, input: { command }, ...stamp }) }
      continue
    }

    if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && callId) {
      const o = codexOutput(p.output)
      const patchIds = patchCalls.get(callId)
      if (patchIds) {
        const failed = o.success === false || PATCH_FAILED.test(o.text) || (o.exit !== undefined && o.exit !== 0)
        for (const id of patchIds) steps.push({ kind: 'tool_result', id, text: o.text, isError: failed, ...stamp })
        continue
      }
      const target = shellCalls.has(callId) ? callId : stdinCalls.get(callId)
      if (target) {
        const text = (output.get(target) ?? '') + (output.has(target) && o.text ? '\n' : '') + o.text
        output.set(target, text)
        if (o.running) sessions.set(o.running, target)
        const isError = o.exit !== undefined ? o.exit !== 0 : o.success === false
        steps.push({ kind: 'tool_result', id: target, text, isError, ...stamp })
        continue
      }
      steps.push({ kind: 'tool_result', id: callId, text: o.text, isError: o.success === false || (o.exit !== undefined && o.exit !== 0), ...stamp })
    }
  }
  return steps
}

export interface CodexHookDeps {
  env: Record<string, string | undefined>
  readFile: (path: string) => string
  ledgerArg?: string
  defaultLedger?: string
  openLedger?: (path: string) => LedgerLike
  /** governance (RIPOSTE_GOV_*): the checker runner (default: spawn it) and the receipt writer */
  runChecker?: CheckerRunner
  writeReceipt?: ReceiptWriter
}

export interface CodexHookResult { code: 0 | 1 | 2; stdout: string; stderr: string; config?: HostConfig; checked?: CheckedStop; skipped?: string; governance?: GovernanceHookResult }

/**
 * Codex `Stop` hook. Nothing on stdout, ever (Codex reads stdout on exit 0 as JSON, and empty means "let it stop").
 * Exit 2 (an enforcing mode, a flagged claim, not yet continued) puts the Claude Code hook's send-back on stderr, which
 * Codex turns into the continuation prompt. stop_hook_active true → exit 0, unchecked: it never sends back twice.
 */
export function codexStopHook(stdin: string, deps: CodexHookDeps): CodexHookResult {
  const cfg = hostConfig(deps.env, deps.ledgerArg, deps.defaultLedger)
  const pre = cfg.problems.map((p) => `riposte-codex: ${p}\n`).join('')
  const fail = (why: string): CodexHookResult => ({ code: failCode(cfg), stdout: '', stderr: `${pre}riposte-codex --hook: ${why}\n`, config: cfg })
  // governance: receipts to RIPOSTE_GOV_RECEIPTS, else this bin's --ledger (never RIPOSTE_LEDGER or the default ledger)
  const gov = governanceFromEnv(deps.env, { ...(deps.ledgerArg ? { receiptsFallback: deps.ledgerArg } : {}) })
  const governance = (input: string): CodexHookResult => {
    const g = governanceHook(input, { gov, host: 'codex', ...(deps.runChecker ? { run: deps.runChecker } : {}), ...(deps.writeReceipt ? { writeReceipt: deps.writeReceipt } : {}) })
    return { code: 0, stdout: g.stdout, stderr: `${pre}${g.stderr}`, config: cfg, governance: g }
  }
  try {
    let hook: Record<string, unknown>
    try { hook = JSON.parse(stdin) } catch { return gov.on ? governance(stdin) : fail('stdin is not hook JSON') }
    if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return gov.on ? governance(stdin) : fail('stdin is not hook JSON')
    if (hook.hook_event_name === 'PreToolUse' && gov.on) return governance(stdin)
    if (hook.hook_event_name !== undefined && hook.hook_event_name !== 'Stop') return { code: 0, stdout: '', stderr: pre, config: cfg, skipped: `not a Stop event (${String(hook.hook_event_name)})` }
    if (hook.stop_hook_active === true) return { code: 0, stdout: '', stderr: pre, config: cfg, skipped: 'this stop was already sent back once' }
    if (typeof hook.transcript_path !== 'string' || !hook.transcript_path) return fail('no transcript_path in the hook input (Codex passes null when the session has no transcript)')
    let steps: Step[]
    try { steps = sessionFromCodexRollout(deps.readFile(hook.transcript_path)) } catch (e) { return fail(`cannot read the transcript: ${(e as Error).message}`) }
    const last = typeof hook.last_assistant_message === 'string' ? hook.last_assistant_message : null
    const checked = checkAndRecord({ steps, lastMessage: last, alreadySentBack: false }, cfg, 'codex', deps.openLedger)
    const note = checked.note ? `riposte-codex: ${checked.note}\n` : ''
    const code = checked.decision.code === 2 ? 2 : checked.decision.code === 1 ? failCode(cfg) : 0
    return { code, stdout: '', stderr: `${pre}${note}${checked.decision.stderr}`, config: cfg, checked }
  } catch (e) {
    return fail((e as Error).message)
  }
}
