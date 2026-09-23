/**
 * The `riposte-claims` command, as a pure function (the bin in ./claims-cli.ts only does I/O).
 *
 *   riposte-claims <transcript.jsonl>               the final message's claims vs the session's tool evidence
 *   riposte-claims <transcript.jsonl> --all-turns   every turn-ending message, audited the same way
 *   riposte-claims < hook-input.json                (no path: reads {"transcript_path": …} from stdin)
 *
 * Prints JSON. Exit: 0 PASS · 1 FAIL (a claim is contradicted) · 2 ABSTAIN (unsupported, or nothing checkable) · 3 usage.
 * With --all-turns the exit code is the worst turn's.
 */
import { checkClaims, checkMessageClaims, findFinalMessage, sessionFromClaudeCodeTranscript, turnEnds, type ClaimsResult } from './claims.js'

export const CLAIMS_USAGE = 'riposte-claims <transcript.jsonl> [--all-turns]  |  riposte-claims --hook [--only-contradicted | --record-only] [--ledger <file>]   (hook JSON on stdin)'
const CODES = { PASS: 0, FAIL: 1, ABSTAIN: 2 } as const

export interface ClaimsArgs { path?: string; allTurns: boolean; hook: boolean; onlyContradicted: boolean; recordOnly: boolean; ledger?: string; help?: boolean; error?: string }
export interface CliResult { code: number; out: string; err: string }

export function parseClaimsArgs(argv: string[]): ClaimsArgs {
  const out: ClaimsArgs = { allTurns: false, hook: false, onlyContradicted: false, recordOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--all-turns') out.allTurns = true
    else if (a === '--hook') out.hook = true
    else if (a === '--only-contradicted') out.onlyContradicted = true
    else if (a === '--record-only') out.recordOnly = true
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
export function auditTurns(jsonl: string): TurnAudit {
  const steps = sessionFromClaudeCodeTranscript(jsonl)
  const ends = turnEnds(steps)
  const audit: TurnAudit = { turns: ends.length, turns_with_claims: 0, outcomes: { PASS: 0, FAIL: 0, ABSTAIN: 0 }, claims: { SUPPORTED: 0, CONTRADICTED: 0, UNSUPPORTED: 0 }, flagged: [] }
  for (const i of ends) {
    const r = checkClaims(steps, i)
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

export interface HookDecision { code: 0 | 1 | 2; stderr: string; result?: ClaimsResult; skipped?: string; wouldBlock?: boolean }
export interface StopHookOptions {
  /** send back only claims that are demonstrably false; unbacked ones are just recorded */
  onlyContradicted?: boolean
  /** never send anything back and never fail: check, record (via --ledger), exit 0. For hosts where a turn must never be forced. */
  recordOnly?: boolean
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
  let result: ClaimsResult
  if (last) {
    const at = findFinalMessage(steps, last)
    result = checkMessageClaims(last, steps, at >= 0 ? at : steps.length)
  } else result = checkClaims(steps)
  const flagged = result.claims.filter((c) => c.status === 'CONTRADICTED' || (!opts.onlyContradicted && c.status === 'UNSUPPORTED'))
  if (!flagged.length) return { code: 0, stderr: '', result, wouldBlock: false }
  if (opts.recordOnly) return { code: 0, stderr: '', result, wouldBlock: true }
  const lines = flagged.map((c) => {
    const ev = c.evidence ? ` [${c.evidence.command ? c.evidence.command.slice(0, 60) : c.evidence.tool}${c.evidence.at ? ` @ ${c.evidence.at}` : ''}]` : ''
    return `• "${c.claim.length > 120 ? `${c.claim.slice(0, 117)}…` : c.claim}" — ${c.status}: ${c.reason}${ev}`
  })
  return {
    code: 2, result, wouldBlock: true,
    stderr: `Before you finish: your final message makes ${flagged.length === 1 ? 'a claim' : 'claims'} this session's tool results don't back.\n${lines.join('\n')}\n` +
      'Run the check now and report what it actually shows, or correct the claim. (Riposte check_claims; it sends a stop back only once.)\n',
  }
}

/** `stdin` is consulted only when no path was given (Claude Code hooks pass {"transcript_path": …} on stdin). */
export function claimsCli(argv: string[], readFile: (path: string) => string, stdin?: string): CliResult {
  const args = parseClaimsArgs(argv)
  if (args.help) return { code: 0, out: '', err: `${CLAIMS_USAGE}\n` }
  if (args.error) return { code: 3, out: '', err: `${args.error}\n${CLAIMS_USAGE}\n` }
  if (args.hook) { const d = stopHook(stdin ?? '', readFile, { onlyContradicted: args.onlyContradicted, recordOnly: args.recordOnly }); return { code: d.code, out: '', err: d.stderr } }
  let path = args.path
  if (!path && stdin?.trim()) {
    try { const hook = JSON.parse(stdin) as { transcript_path?: unknown }; if (typeof hook.transcript_path === 'string') path = hook.transcript_path } catch { /* not hook JSON */ }
  }
  if (!path) return { code: 3, out: '', err: `no transcript given\n${CLAIMS_USAGE}\n` }
  let text: string
  try { text = readFile(path) } catch (e) { return { code: 3, out: '', err: `cannot read ${path}: ${(e as Error).message}\n` } }
  if (args.allTurns) {
    const a = auditTurns(text)
    const code = a.outcomes.FAIL ? 1 : a.outcomes.ABSTAIN ? 2 : a.outcomes.PASS ? 0 : 2
    return { code, out: `${JSON.stringify(a, null, 2)}\n`, err: `${a.turns} turns · ${a.turns_with_claims} with claims · ${a.claims.SUPPORTED} supported · ${a.claims.CONTRADICTED} contradicted · ${a.claims.UNSUPPORTED} unsupported\n` }
  }
  const r = checkClaims(sessionFromClaudeCodeTranscript(text))
  return { code: CODES[r.outcome], out: `${JSON.stringify(r, null, 2)}\n`, err: `${r.outcome}: ${r.reasons.join(' · ')}\n` }
}
