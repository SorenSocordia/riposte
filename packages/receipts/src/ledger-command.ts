/**
 * The `riposte-ledger` command, as a pure function (the bin in ./ledger-cli.ts only does I/O).
 *
 *   riposte-ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>]
 *   riposte-ledger summary <ledger.jsonl>
 *   riposte-ledger fingerprint <key.pem>              (public or private key → the fingerprint and public PEM to pin)
 *
 * Exit: 0 ok · 1 the chain does not verify · 3 usage / unreadable input.
 * A chain alone cannot detect a whole-file rewrite. `verify` without --key, --require-signed or --head prints a warning.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { keyFingerprint, verifyChain, type ChainPolicy, type LedgerEntry } from './ledger.js'

export const LEDGER_USAGE = [
  'riposte-ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>]',
  'riposte-ledger summary <ledger.jsonl>',
  'riposte-ledger fingerprint <key.pem>',
].join('\n')

export interface CliResult { code: number; out: string; err: string }

export function parseLedger(text: string): LedgerEntry[] {
  return text.split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l) as LedgerEntry } catch { throw new Error(`line ${i + 1} is not JSON`) }
  })
}

/** Public PEM + fingerprint from a PEM that holds either a public or a private key. */
export function publicOf(pem: string): { public_key: string; fingerprint: string } {
  let pub: string
  try { pub = createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString() } catch {
    pub = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString()
  }
  return { public_key: pub, fingerprint: keyFingerprint(pub) }
}

export function ledgerCli(argv: string[], readFile: (path: string) => string): CliResult {
  const [cmd, file, ...rest] = argv
  const usage = (msg?: string): CliResult => ({ code: msg ? 3 : 0, out: '', err: `${msg ? `${msg}\n` : ''}${LEDGER_USAGE}\n` })
  if (!cmd || cmd === '--help' || cmd === '-h') return usage()
  if (!file) return usage(`${cmd} needs a file`)
  let text: string
  try { text = readFile(file) } catch (e) { return { code: 3, out: '', err: `cannot read ${file}: ${(e as Error).message}\n` } }

  if (cmd === 'fingerprint') {
    try { const p = publicOf(text); return { code: 0, out: `${JSON.stringify(p, null, 2)}\n`, err: `fingerprint ${p.fingerprint}\n` } } catch (e) { return { code: 3, out: '', err: `not a key: ${(e as Error).message}\n` } }
  }

  let entries: LedgerEntry[]
  try { entries = parseLedger(text) } catch (e) { return { code: 3, out: '', err: `${file}: ${(e as Error).message}\n` } }

  if (cmd === 'summary') {
    const kinds: Record<string, number> = {}
    for (const e of entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
    const c = verifyChain(entries)
    const s = { entries: entries.length, kinds, first_at: entries[0]?.at ?? null, last_at: entries[entries.length - 1]?.at ?? null, head: c.head, chain_ok: c.ok, signed: c.signed, unsigned: c.unsigned, signers: c.signers, ...(c.reason ? { reason: c.reason } : {}) }
    return { code: c.ok ? 0 : 1, out: `${JSON.stringify(s, null, 2)}\n`, err: '' }
  }

  if (cmd !== 'verify') return usage(`unknown command ${cmd}`)
  const policy: ChainPolicy = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--require-signed') policy.requireSigned = true
    else if (a === '--key' || a === '--head') {
      const v = rest[++i]
      if (!v) return usage(`${a} needs a value`)
      if (a === '--head') policy.head = v
      else {
        try { policy.publicKey = publicOf(readFile(v)).public_key } catch (e) { return { code: 3, out: '', err: `cannot use key ${v}: ${(e as Error).message}\n` } }
      }
    } else return usage(`unknown option ${a}`)
  }
  const c = verifyChain(entries, policy)
  const anchored = Boolean(policy.publicKey || policy.requireSigned || policy.head)
  const warn = anchored ? '' : 'note: no trust anchor given (--key, --require-signed or --head). This proves the file is internally consistent, not that nobody rewrote all of it.\n'
  const line = c.ok
    ? `OK: ${c.length} entries, head ${c.head.slice(0, 16)}… · ${c.signed} signed (${c.signers.join(', ') || 'no keys'}) · ${c.unsigned} unsigned\n`
    : `BROKEN at entry ${c.broken_at ?? '-'}: ${c.reason}\n`
  return { code: c.ok ? 0 : 1, out: `${JSON.stringify(c, null, 2)}\n`, err: line + warn }
}
