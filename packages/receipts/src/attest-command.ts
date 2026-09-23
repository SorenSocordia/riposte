/**
 * The `riposte-attest` command, as a pure function (the bin in ./attest-cli.ts only does I/O).
 *
 *   riposte-attest <transcript.jsonl> [--declared <exact-id>] [--allow <exact-id>]... [--allow-silent-switch]
 *   riposte-attest --declared <exact-id> < hook-input.json        (no path: reads {"transcript_path": …} from stdin)
 *
 * Prints the attestation as JSON. Exit: 0 PASS · 1 FAIL · 2 ABSTAIN · 3 usage error.
 * Reads only the model / id / timestamp / command fields of the transcript, never message content.
 */
import { attestModels, eventsFromClaudeCodeTranscript, type AttestPolicy } from './model-attest.js'

export const ATTEST_USAGE = 'riposte-attest <transcript.jsonl> [--declared <exact-id>] [--allow <exact-id>]... [--allow-silent-switch]'
const CODES = { PASS: 0, FAIL: 1, ABSTAIN: 2 } as const

export interface AttestArgs { path?: string; policy: AttestPolicy; help?: boolean; error?: string }
export interface CliResult { code: number; out: string; err: string }

export function parseAttestArgs(argv: string[]): AttestArgs {
  const out: AttestArgs = { policy: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--declared' || a === '--allow') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) return { ...out, error: `${a} needs a model id` }
      if (a === '--declared') out.policy.declared = v; else (out.policy.allowed ??= []).push(v)
    } else if (a === '--allow-silent-switch') out.policy.failOnSilentSwitch = false
    else if (a.startsWith('--')) return { ...out, error: `unknown option ${a}` }
    else if (out.path) return { ...out, error: 'one transcript at a time' }
    else out.path = a
  }
  return out
}

/** `stdin` is consulted only when no path was given (Claude Code hooks pass {"transcript_path": …} on stdin). */
export function attestCli(argv: string[], readFile: (path: string) => string, stdin?: string): CliResult {
  const args = parseAttestArgs(argv)
  if (args.help) return { code: 0, out: '', err: `${ATTEST_USAGE}\n` }
  if (args.error) return { code: 3, out: '', err: `${args.error}\n${ATTEST_USAGE}\n` }
  let path = args.path
  if (!path && stdin?.trim()) {
    try { const hook = JSON.parse(stdin) as { transcript_path?: unknown }; if (typeof hook.transcript_path === 'string') path = hook.transcript_path } catch { /* not hook JSON */ }
  }
  if (!path) return { code: 3, out: '', err: `no transcript given\n${ATTEST_USAGE}\n` }
  let text: string
  try { text = readFile(path) } catch (e) { return { code: 3, out: '', err: `cannot read ${path}: ${(e as Error).message}\n` } }
  const a = attestModels(eventsFromClaudeCodeTranscript(text), args.policy)
  return { code: CODES[a.outcome], out: `${JSON.stringify(a, null, 2)}\n`, err: `${a.outcome}: ${a.reasons.join(' · ')}\n` }
}
