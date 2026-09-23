/**
 * The receipt ledger — an append-only, hash-chained record of every receipt (decisions, done-checks, model switches…).
 *
 * Each entry commits to the previous entry's hash, so deleting, reordering or editing any past entry breaks every hash after
 * it. Signed entries additionally prove WHO issued them. Storage is injectable (in-memory by default; a JSONL file for the
 * CLI/plugins) so it runs anywhere and tests with no disk.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, sha256 } from 'riposte-verify'

export type ReceiptKind = 'decision' | 'ap_gate' | 'done_check' | 'claims_check' | 'model_attest' | 'model_switch' | 'compaction' | 'note'

export interface LedgerEntry {
  seq: number
  kind: ReceiptKind
  at: string
  /** the receipt body (any JSON) */
  body: unknown
  prev_hash: string
  /** sha256(canonical({seq, kind, at, body, prev_hash})) */
  hash: string
  signature?: { alg: 'ed25519'; public_key: string; sig: string }
}

export interface LedgerStore { load(): LedgerEntry[]; append(e: LedgerEntry): void }

export function memoryStore(seed: LedgerEntry[] = []): LedgerStore {
  const entries = [...seed]
  return { load: () => [...entries], append: (e) => { entries.push(e) } }
}

const GENESIS = '0'.repeat(64)
const entryHash = (e: Pick<LedgerEntry, 'seq' | 'kind' | 'at' | 'body' | 'prev_hash'>): string =>
  sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }))

export interface Ledger {
  append(kind: ReceiptKind, body: unknown): LedgerEntry
  entries(): LedgerEntry[]
  verify(): ChainCheck
}

export interface ChainCheck { ok: boolean; length: number; head: string; broken_at?: number; reason?: string }

export function openLedger(store: LedgerStore = memoryStore(), opts: { signingKey?: string; now?: () => Date } = {}): Ledger {
  const now = opts.now ?? (() => new Date())
  return {
    append(kind, body) {
      const all = store.load()
      const prev = all[all.length - 1]
      const partial = { seq: all.length, kind, at: now().toISOString(), body, prev_hash: prev ? prev.hash : GENESIS }
      const hash = entryHash(partial)
      const entry: LedgerEntry = { ...partial, hash }
      if (opts.signingKey) {
        const key = createPrivateKey(opts.signingKey)
        entry.signature = { alg: 'ed25519', public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(), sig: edSign(null, Buffer.from(hash, 'utf8'), key).toString('base64') }
      }
      store.append(entry)
      return entry
    },
    entries: () => store.load(),
    verify: () => verifyChain(store.load()),
  }
}

/** Verify a chain with nothing but sha256 + the embedded public keys. */
export function verifyChain(entries: LedgerEntry[]): ChainCheck {
  let prev = GENESIS
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.seq !== i) return { ok: false, length: entries.length, head: prev, broken_at: i, reason: `entry ${i} has seq ${e.seq} (reordered or removed entries)` }
    if (e.prev_hash !== prev) return { ok: false, length: entries.length, head: prev, broken_at: i, reason: `entry ${i} does not follow entry ${i - 1} (chain broken)` }
    if (entryHash(e) !== e.hash) return { ok: false, length: entries.length, head: prev, broken_at: i, reason: `entry ${i} was altered after it was written` }
    if (e.signature) {
      let ok = false
      try { ok = edVerify(null, Buffer.from(e.hash, 'utf8'), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, 'base64')) } catch { ok = false }
      if (!ok) return { ok: false, length: entries.length, head: prev, broken_at: i, reason: `entry ${i} signature does not verify` }
    }
    prev = e.hash
  }
  return { ok: true, length: entries.length, head: prev }
}
