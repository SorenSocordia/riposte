/**
 * The I/O the host bins share: argv, stdin, the default ledger, and opening the ledger (signed when RECEIPTS_KEY names an
 * Ed25519 private key, as in the Claude Code hook). The checks themselves are pure (./codex.ts, ./cursor.ts, ./opencode.ts).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileStore, openLedger } from 'riposte-ai'
import type { LedgerLike } from './common.js'

/**
 * Where receipts go when neither RIPOSTE_LEDGER nor --ledger says: ~/.riposte/receipts.jsonl. To keep one ledger across
 * hosts, point RIPOSTE_LEDGER (or --ledger) at the same file everywhere, including the Claude Code plugin's.
 */
export const defaultLedger = (): string => join(homedir(), '.riposte', 'receipts.jsonl')

export interface HostArgs { hook: boolean; ledger?: string; help?: boolean; error?: string }

export function parseHostArgs(argv: string[]): HostArgs {
  const out: HostArgs = { hook: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--hook') out.hook = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--ledger') { const v = argv[++i]; if (!v || v.startsWith('--')) return { ...out, error: '--ledger needs a file' }; out.ledger = v }
    else return { ...out, error: `unknown argument ${a}` }
  }
  return out
}

export const readStdin = (): string => { try { return readFileSync(0, 'utf8') } catch { return '' } }

/** Opens the ledger at a path; a bad RECEIPTS_KEY throws here, and the caller records "ledger not written". */
export const ledgerOpener = (env: Record<string, string | undefined>) => (path: string): LedgerLike => {
  const signingKey = env.RECEIPTS_KEY ? readFileSync(env.RECEIPTS_KEY, 'utf8') : undefined
  return openLedger(fileStore(path), signingKey ? { signingKey } : {})
}

/**
 * Appends a governance receipt (kind `action_check`, `source: "governance"`) to the ledger at a path, signed when
 * RECEIPTS_KEY names a key. Throws when it cannot: the caller then denies (no receipt, no action).
 */
export const governanceReceiptWriter = (env: Record<string, string | undefined>) => (path: string, body: Record<string, unknown>): unknown => {
  const signingKey = env.RECEIPTS_KEY ? readFileSync(env.RECEIPTS_KEY, 'utf8') : undefined
  return openLedger(fileStore(path), signingKey ? { signingKey } : {}).append('action_check', body)
}
