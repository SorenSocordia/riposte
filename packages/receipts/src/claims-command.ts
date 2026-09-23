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
import { checkClaims, sessionFromClaudeCodeTranscript, turnEnds, type ClaimsResult } from './claims.js'

export const CLAIMS_USAGE = 'riposte-claims <transcript.jsonl> [--all-turns]'
const CODES = { PASS: 0, FAIL: 1, ABSTAIN: 2 } as const

export interface ClaimsArgs { path?: string; allTurns: boolean; help?: boolean; error?: string }
export interface CliResult { code: number; out: string; err: string }

export function parseClaimsArgs(argv: string[]): ClaimsArgs {
  const out: ClaimsArgs = { allTurns: false }
  for (const a of argv) {
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--all-turns') out.allTurns = true
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

/** `stdin` is consulted only when no path was given (Claude Code hooks pass {"transcript_path": …} on stdin). */
export function claimsCli(argv: string[], readFile: (path: string) => string, stdin?: string): CliResult {
  const args = parseClaimsArgs(argv)
  if (args.help) return { code: 0, out: '', err: `${CLAIMS_USAGE}\n` }
  if (args.error) return { code: 3, out: '', err: `${args.error}\n${CLAIMS_USAGE}\n` }
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
