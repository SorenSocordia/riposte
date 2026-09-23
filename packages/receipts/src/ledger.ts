/**
 * The receipt ledger — an append-only, hash-chained record of every receipt (decisions, done-checks, model switches…).
 *
 * Each entry commits to the previous entry's hash, so deleting, reordering or editing any past entry breaks every hash after
 * it. Signed entries additionally prove WHO issued them. Storage is injectable (in-memory by default; a JSONL file for the
 * CLI/plugins) so it runs anywhere and tests with no disk.
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
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
  verify(policy?: ChainPolicy): ChainCheck
}

export interface ChainCheck {
  ok: boolean
  length: number
  head: string
  broken_at?: number
  reason?: string
  /** entries carrying a (verified) signature, and entries carrying none */
  signed: number
  unsigned: number
  /** fingerprints of every key that signed an entry. More than one means mixed signers, worth a look even when ok. */
  signers: string[]
}

/**
 * Trust anchors. A hash chain alone proves only that the file is internally consistent. Anyone who rewrites the WHOLE file
 * can recompute every hash, and re-sign every entry with their own key. To detect that, pin at least one of these:
 * - `publicKey`: every signature must come from this key (PEM, SPKI)
 * - `requireSigned`: no unsigned entries (so signatures cannot simply be stripped)
 * - `head`: a hash you recorded earlier (e.g. published). The chain must still contain it, so it grew rather than being rewritten.
 */
export interface ChainPolicy { publicKey?: string; requireSigned?: boolean; head?: string }

/** A short, stable id for a public key: sha256 of its DER (SPKI) encoding, first 16 hex characters. */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

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
    verify: (policy) => verifyChain(store.load(), policy),
  }
}

/**
 * Verify a chain with nothing but sha256 and the public keys: order, links, hashes and signatures. With a ChainPolicy it also
 * checks WHO signed, and against a previously recorded head. Without one, a full rewrite by someone else can still verify.
 */
export function verifyChain(entries: LedgerEntry[], policy: ChainPolicy = {}): ChainCheck {
  let prev = GENESIS
  let signed = 0
  let unsigned = 0
  const signers = new Set<string>()
  let expected: string | null = null
  if (policy.publicKey) {
    try { expected = keyFingerprint(policy.publicKey) } catch { return { ok: false, length: entries.length, head: prev, reason: 'the expected public key could not be read', signed, unsigned, signers: [] } }
  }
  const fail = (i: number, reason: string): ChainCheck => ({ ok: false, length: entries.length, head: prev, broken_at: i, reason, signed, unsigned, signers: [...signers] })
  let anchored = !policy.head
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.seq !== i) return fail(i, `entry ${i} has seq ${e.seq} (reordered or removed entries)`)
    if (e.prev_hash !== prev) return fail(i, `entry ${i} does not follow entry ${i - 1} (chain broken)`)
    if (entryHash(e) !== e.hash) return fail(i, `entry ${i} was altered after it was written`)
    if (e.signature) {
      let ok = false
      let fp = ''
      try {
        ok = edVerify(null, Buffer.from(e.hash, 'utf8'), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, 'base64'))
        fp = keyFingerprint(e.signature.public_key)
      } catch { ok = false }
      if (!ok) return fail(i, `entry ${i} signature does not verify`)
      signers.add(fp)
      signed++
      if (expected && fp !== expected) return fail(i, `entry ${i} is signed by key ${fp}, not the expected ${expected} (re-signed by someone else?)`)
    } else {
      unsigned++
      if (policy.requireSigned) return fail(i, `entry ${i} is not signed (signatures required)`)
    }
    if (policy.head && e.hash === policy.head) anchored = true
    prev = e.hash
  }
  const base = { length: entries.length, head: prev, signed, unsigned, signers: [...signers] }
  if (!anchored) return { ok: false, ...base, reason: `the anchored hash ${policy.head!.slice(0, 16)}… is not in this chain (rewritten or truncated since it was recorded)` }
  return { ok: true, ...base }
}
