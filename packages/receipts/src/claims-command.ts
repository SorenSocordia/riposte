/**
 * The `riposte-claims` command, as a pure function (the bin in ./claims-cli.ts only does I/O).
 *
 *   riposte-claims <transcript.jsonl>               the final message's claims vs the session's tool evidence
 *   riposte-claims <transcript.jsonl> --all-turns   every turn-ending message, audited the same way
 *   riposte-claims < hook-input.json                (no path: reads {"transcript_path": …} from stdin)
 *
 * Prints JSON. Exit: 0 PASS · 1 FAIL (a claim is contradicted) · 2 INSUFFICIENT_DATA, can't tell (unsupported, or nothing
 * checkable) · 3 usage.
 * With --all-turns the exit code is the worst turn's.
 */
import { checkClaims, checkMessageClaims, findFinalMessage, sessionFromClaudeCodeTranscript, turnEnds, type ClaimsResult, type Step } from './claims.js'
import { AUDIENCES, deliver, factsFromClaims, type Audience, type Delivery, type DeliveryFacts } from './nunchi.js'

export const CLAIMS_USAGE = 'riposte-claims <transcript.jsonl> [--all-turns] [--strict]  |  riposte-claims --hook [--strict] [--only-contradicted | --record-only] [--ledger <file>]   (hook JSON on stdin)'
const CODES = { PASS: 0, FAIL: 1, INSUFFICIENT_DATA: 2 } as const

export interface ClaimsArgs { path?: string; allTurns: boolean; hook: boolean; onlyContradicted: boolean; recordOnly: boolean; strict: boolean; fromEnv?: boolean; ledger?: string; help?: boolean; error?: string }
export interface CliResult { code: number; out: string; err: string }

export function parseClaimsArgs(argv: string[]): ClaimsArgs {
  const out: ClaimsArgs = { allTurns: false, hook: false, onlyContradicted: false, recordOnly: false, strict: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--all-turns') out.allTurns = true
    else if (a === '--hook') out.hook = true
    else if (a === '--only-contradicted') out.onlyContradicted = true
    else if (a === '--record-only') out.recordOnly = true
    else if (a === '--strict') out.strict = true
    else if (a === '--from-env') out.fromEnv = true
    else if (a === '--ledger') { const v = argv[++i]; if (!v || v.startsWith('--')) return { ...out, error: '--ledger needs a file' }; out.ledger = v }
    else if (a.startsWith('--')) return { ...out, error: `unknown option ${a}` }
    else if (out.path) return { ...out, error: 'one transcript at a time' }
    else out.path = a
  }
  return out
}

export interface TurnAudit {
  turns: number
  turns_with_claims: number
  outcomes: Record<ClaimsResult['outcome'], number>
  claims: { SUPPORTED: number; CONTRADICTED: number; UNSUPPORTED: number }
  /** every claim that was not supported, with when it was made */
  flagged: { at?: string; kind: string; status: string; claim: string; reason: string }[]
}

/** Audit every turn-ending message of a session (turns with no checkable claims are counted, not scored). */
export function auditTurns(jsonl: string, opts: { strict?: boolean } = {}): TurnAudit {
  const steps = sessionFromClaudeCodeTranscript(jsonl)
  const ends = turnEnds(steps)
  const audit: TurnAudit = { turns: ends.length, turns_with_claims: 0, outcomes: { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }, claims: { SUPPORTED: 0, CONTRADICTED: 0, UNSUPPORTED: 0 }, flagged: [] }
  for (const i of ends) {
    const r = checkClaims(steps, i, { strict: opts.strict === true })
    if (!r.claims.length) continue
    audit.turns_with_claims++
    audit.outcomes[r.outcome]++
    for (const c of r.claims) {
      audit.claims[c.status]++
      if (c.status !== 'SUPPORTED') audit.flagged.push({ ...(r.final_message_at ? { at: r.final_message_at } : {}), kind: c.kind, status: c.status, claim: c.claim, reason: c.reason })
    }
  }
  return audit
}

export interface HookDecision {
  code: 0 | 1 | 2; stderr: string; result?: ClaimsResult; skipped?: string; wouldBlock?: boolean
  /** only with the Nunchi opt-in: how the "done" moment was delivered (the facts, their hash, timing, weight, audience) */
  delivery?: Delivery
}

/**
 * The Nunchi opt-in for the Stop hook (RIPOSTE_NUNCHI=on). It changes HOW a sent-back stop is worded, never WHETHER a stop
 * is sent back: the exit code and the silence of a silent stop are exactly the default's.
 */
export interface NunchiStopOptions {
  /** the declared consequence tier (a name in nunchi's DEFAULT_TIERS). Unset or unknown → the top tier (plain words). */
  tier?: string
  audience?: Audience
}

export interface StopHookOptions {
  /** send back only claims that are demonstrably false; unbacked ones are just recorded */
  onlyContradicted?: boolean
  /** never send anything back and never fail: check, record (via --ledger), exit 0. For hosts where a turn must never be forced. */
  recordOnly?: boolean
  /** strict policy: "done / fixed / implemented" needs a passing test run after the last code edit (see ClaimOptions) */
  strict?: boolean
  /** opt-in: word the send-back through Nunchi (the delivery layer). Absent = the default message, byte for byte. */
  nunchi?: NunchiStopOptions
}

/** The instruction every sent-back stop ends with, in every wording. */
export const STOP_SEND_BACK = 'Run the check now and report what it actually shows, or correct the claim. (Riposte check_claims; it sends a stop back only once.)\n'

/** The tier name used when RIPOSTE_TIER is unset. Undeclared, so Nunchi treats it as the top tier: plain words. */
export const NUNCHI_UNSET_TIER = 'unset'

/** The "done" moment through Nunchi. A sent-back stop is SURFACEd in-flow (to the agent, once); it is never held for a person. */
function doneDelivery(result: ClaimsResult, n: NunchiStopOptions, action: DeliveryFacts['action'] | undefined, in_flow: boolean): Delivery {
  return deliver(factsFromClaims(result, { ...(action ? { action } : {}), in_flow }), { moment: 'done-claim', tier: n.tier ?? NUNCHI_UNSET_TIER, audience: n.audience ?? 'solo' })
}

/**
 * Stop-hook mode (Claude Code: exit 2 blocks stopping and hands stderr back to the agent; exit 0 lets it stop; any other
 * non-zero is a non-blocking error the user sees).
 *
 * - Blocks (2) when a closing claim is CONTRADICTED, or UNSUPPORTED unless `onlyContradicted`. The agent gets one specific
 *   instruction: run the check and report what it shows, or correct the claim.
 * - Never bounces twice. If this stop was already sent back once (`stop_hook_active`), it lets the agent stop.
 * - Uses `last_assistant_message` when the host provides it (the transcript can lag the final message). Evidence is the
 *   transcript up to that message, or all of it if the message is not in the transcript yet.
 * - Our own failure (unreadable input) → 1: visible to the user, never holds the agent hostage.
 */
export function stopHook(stdin: string, readFile: (path: string) => string, opts: StopHookOptions = {}): HookDecision {
  const fail = opts.recordOnly ? 0 : 1 // record-only never fails loudly: a broken check must not interrupt the host
  let hook: { transcript_path?: unknown; stop_hook_active?: unknown; last_assistant_message?: unknown }
  try { hook = JSON.parse(stdin) } catch { return { code: fail, stderr: 'riposte-claims --hook: stdin is not hook JSON\n' } }
  if (hook.stop_hook_active === true) return { code: 0, stderr: '', skipped: 'this stop was already sent back once' }
  if (typeof hook.transcript_path !== 'string') return { code: fail, stderr: 'riposte-claims --hook: no transcript_path in the hook input\n' }
  let steps
  try { steps = sessionFromClaudeCodeTranscript(readFile(hook.transcript_path)) } catch (e) { return { code: fail, stderr: `riposte-claims --hook: cannot read the transcript: ${(e as Error).message}\n` } }
  const last = typeof hook.last_assistant_message === 'string' && hook.last_assistant_message.trim() ? hook.last_assistant_message : null
  return stopDecision(steps, last, opts)
}

/**
 * The Stop decision on a session already in hand (2026-10-03): host-neutral. `steps` are the session's tool calls and
 * messages (receipts' Step shape) and `lastMessage` the final assistant message, when the host passes it. stopHook reads a
 * Claude Code transcript and calls this; a Codex, Cursor or OpenCode port calls it with its own steps, without writing them
 * out as a Claude Code transcript first. The decision is the same function either way, byte for byte.
 */
export function stopDecision(steps: Step[], lastMessage: string | null, opts: StopHookOptions = {}): HookDecision {
  const last = typeof lastMessage === 'string' && lastMessage.trim() ? lastMessage : null
  let result: ClaimsResult
  const policy = { strict: opts.strict === true }
  if (last) {
    const at = findFinalMessage(steps, last)
    result = checkMessageClaims(last, steps, at >= 0 ? at : steps.length, undefined, policy)
  } else result = checkClaims(steps, undefined, policy)
  const flagged = result.claims.filter((c) => c.status === 'CONTRADICTED' || (!opts.onlyContradicted && c.status === 'UNSUPPORTED'))
  const n = opts.nunchi
  // With the opt-in, a silent stop stays silent: its delivery goes on the record only (in_flow false → timing on-record).
  if (!flagged.length) return { code: 0, stderr: '', result, wouldBlock: false, ...(n && result.claims.length ? { delivery: doneDelivery(result, n, undefined, false) } : {}) }
  if (opts.recordOnly) return { code: 0, stderr: '', result, wouldBlock: true, ...(n ? { delivery: doneDelivery(result, n, 'SURFACE', false) } : {}) }
  if (n) {
    const delivery = doneDelivery(result, n, 'SURFACE', true)
    return { code: 2, result, wouldBlock: true, delivery, stderr: `${delivery.text.endsWith('\n') ? delivery.text : `${delivery.text}\n`}${STOP_SEND_BACK}` }
  }
  const lines = flagged.map((c) => {
    const ev = c.evidence ? ` [${c.evidence.command ? c.evidence.command.slice(0, 60) : c.evidence.tool}${c.evidence.at ? ` @ ${c.evidence.at}` : ''}]` : ''
    return `• "${c.claim.length > 120 ? `${c.claim.slice(0, 117)}…` : c.claim}" — ${c.status}: ${c.reason}${ev}`
  })
  return {
    code: 2, result, wouldBlock: true,
    stderr: `Before you finish: your final message makes ${flagged.length === 1 ? 'a claim' : 'claims'} this session's tool results don't back.\n${lines.join('\n')}\n` +
      STOP_SEND_BACK,
  }
}

export type HookMode = 'record-only' | 'only-contradicted' | 'block'
const MODES: readonly HookMode[] = ['record-only', 'only-contradicted', 'block']

/**
 * Hook configuration from the environment, so a plugin can be configured without editing it:
 * - RIPOSTE_HOOK_MODE: record-only (default) | only-contradicted | block
 * - RIPOSTE_STRICT: 1 or true
 * - RIPOSTE_LEDGER: a file path
 * - RIPOSTE_NUNCHI: on (opt-in) | off (default): word a sent-back stop through Nunchi. With it, RIPOSTE_TIER (a consequence
 *   tier: low | moderate | high | severe; unset = the top tier, plain words) and RIPOSTE_AUDIENCE (solo | pr | auditor).
 * The default is the one that never forces a turn. An unrecognised mode falls back to it and is reported, never guessed.
 */
export function hookOptionsFromEnv(env: Record<string, string | undefined>): { mode: HookMode; opts: StopHookOptions; ledger?: string; problems: string[] } {
  const problems: string[] = []
  const raw = (env.RIPOSTE_HOOK_MODE ?? '').trim().toLowerCase()
  let mode: HookMode = 'record-only'
  if (raw) {
    if ((MODES as readonly string[]).includes(raw)) mode = raw as HookMode
    else problems.push(`RIPOSTE_HOOK_MODE="${env.RIPOSTE_HOOK_MODE}" is not one of ${MODES.join(' | ')}; using record-only`)
  }
  const strict = /^(?:1|true|yes)$/i.test((env.RIPOSTE_STRICT ?? '').trim())
  const rawN = (env.RIPOSTE_NUNCHI ?? '').trim().toLowerCase()
  let nunchi: NunchiStopOptions | undefined
  if (/^(?:on|1|true|yes)$/.test(rawN)) {
    const tier = env.RIPOSTE_TIER?.trim() || undefined
    const rawA = (env.RIPOSTE_AUDIENCE ?? '').trim().toLowerCase()
    let audience: Audience = 'solo'
    if (rawA) {
      if ((AUDIENCES as readonly string[]).includes(rawA)) audience = rawA as Audience
      else problems.push(`RIPOSTE_AUDIENCE="${env.RIPOSTE_AUDIENCE}" is not one of ${AUDIENCES.join(' | ')}; using solo`)
    }
    nunchi = { ...(tier ? { tier } : {}), audience }
  } else if (rawN && !/^(?:off|0|false|no)$/.test(rawN)) problems.push(`RIPOSTE_NUNCHI="${env.RIPOSTE_NUNCHI}" is not on or off; staying off (the default messages)`)
  const opts: StopHookOptions = { recordOnly: mode === 'record-only', onlyContradicted: mode === 'only-contradicted', strict, ...(nunchi ? { nunchi } : {}) }
  const ledger = env.RIPOSTE_LEDGER?.trim() || undefined
  return { mode, opts, ...(ledger ? { ledger } : {}), problems }
}

/**
 * The body of the 'claims_check' receipt the Stop hook writes. Without the Nunchi opt-in it is exactly what the hook has
 * always written; with it, one more key (`nunchi`) ties the receipt to the delivered facts by hash.
 */
export function stopReceipt(d: HookDecision, mode: string, strict: boolean, host?: string): Record<string, unknown> {
  const x = d.delivery
  return {
    // `host` (2026-10-03): which agent host stopped (codex, cursor, opencode…). Written only when given, so a Claude Code
    // receipt keeps its bytes; a receipt without it is read as 'claude-code' (stopReceiptHost).
    source: 'stop_hook', ...(host !== undefined ? { host } : {}), mode, strict, blocked: d.code === 2, would_block: d.wouldBlock === true, ...d.result,
    ...(x ? { nunchi: { delivery_version: x.delivery_version, facts_hash: x.facts_hash, moment: x.moment, speak: x.timing.speak, weight: x.weight, floor: x.floor, tier: x.tier.name, audience: x.audience } } : {}),
  }
}

/** `stdin` is consulted only when no path was given (Claude Code hooks pass {"transcript_path": …} on stdin). */
export function claimsCli(argv: string[], readFile: (path: string) => string, stdin?: string): CliResult {
  const args = parseClaimsArgs(argv)
  if (args.help) return { code: 0, out: '', err: `${CLAIMS_USAGE}\n` }
  if (args.error) return { code: 3, out: '', err: `${args.error}\n${CLAIMS_USAGE}\n` }
  if (args.hook) { const d = stopHook(stdin ?? '', readFile, { onlyContradicted: args.onlyContradicted, recordOnly: args.recordOnly, strict: args.strict }); return { code: d.code, out: '', err: d.stderr } }
  let path = args.path
  if (!path && stdin?.trim()) {
    try { const hook = JSON.parse(stdin) as { transcript_path?: unknown }; if (typeof hook.transcript_path === 'string') path = hook.transcript_path } catch { /* not hook JSON */ }
  }
  if (!path) return { code: 3, out: '', err: `no transcript given\n${CLAIMS_USAGE}\n` }
  let text: string
  try { text = readFile(path) } catch (e) { return { code: 3, out: '', err: `cannot read ${path}: ${(e as Error).message}\n` } }
  if (args.allTurns) {
    const a = auditTurns(text, { strict: args.strict })
    const code = a.outcomes.FAIL ? 1 : a.outcomes.INSUFFICIENT_DATA ? 2 : a.outcomes.PASS ? 0 : 2
    return { code, out: `${JSON.stringify(a, null, 2)}\n`, err: `${a.turns} turns · ${a.turns_with_claims} with claims · ${a.claims.SUPPORTED} supported · ${a.claims.CONTRADICTED} contradicted · ${a.claims.UNSUPPORTED} unsupported\n` }
  }
  const r = checkClaims(sessionFromClaudeCodeTranscript(text), undefined, { strict: args.strict })
  return { code: CODES[r.outcome], out: `${JSON.stringify(r, null, 2)}\n`, err: `${r.outcome}: ${r.reasons.join(' · ')}\n` }
}

/** The host a stop receipt came from: its `host`, or 'claude-code' for a receipt written without one (2026-10-03). */
export function stopReceiptHost(receipt: unknown): string {
  const h = receipt !== null && typeof receipt === 'object' ? (receipt as { host?: unknown }).host : undefined
  return typeof h === 'string' && h.length > 0 ? h : 'claude-code'
}
