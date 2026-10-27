/**
 * The receipt ledger — an append-only, hash-chained record of every receipt (decisions, done-checks, model switches…).
 *
 * Each entry commits to the previous entry's hash, so deleting, reordering or editing any past entry breaks every hash after
 * it. Signed entries additionally prove WHO issued them. Storage is injectable (in-memory by default; a JSONL file for the
 * CLI/plugins) so it runs anywhere and tests with no disk.
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, duplicateKeyPath, HashInputRefused, parseJsonStrict, sha256 } from 'riposte-verify'

export type ReceiptKind = 'decision' | 'ap_gate' | 'done_check' | 'claims_check' | 'action_check' | 'model_attest' | 'model_switch' | 'compaction' | 'note' | 'ruling' | 'pay_app_check'
  /** 2026-10-03: a reply's id and recorded model, anchored as it happens (T3); and a signed monthly attestation report */
  | 'model_reply' | 'model_attest_report'
  /** 2026-10-03 (T3): the closed loop's rows (./loop.ts), on a loop's own chain */
  | 'loop.open' | 'loop.proposal' | 'loop.verdict' | 'loop.remedy_returned' | 'loop.close'

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

/**
 * A repair the store made when it opened (2026-10-03): a torn last line (a crash mid-append) moved aside, byte for byte,
 * into a quarantine file next to the ledger. openLedger records each one as a signed `note` on the chain, once, so the
 * repair is on the record and `riposte-ledger verify` reports it. Never silent, and never a rewrite of a committed entry:
 * the torn bytes were never a whole line, so no caller was ever answered with them.
 */
export interface StoreRepair {
  /**
   * 'ledger.torn_tail_quarantined': a torn last line moved aside. 'ledger.lock_broken' (2026-10-03): a single-writer lock
   * whose process is gone, broken on the operator's --break-lock; its bytes are moved aside the same way, never deleted.
   */
  event: 'ledger.torn_tail_quarantined' | 'ledger.lock_broken'
  /** how many bytes were moved aside, and their sha256 */
  bytes: number
  sha256: string
  /** the quarantine file's name, beside the ledger (`<ledger>.torn-<stamp>`) */
  quarantined_to: string
  /** the last whole entry before the torn bytes (null: none) */
  after_seq: number | null
  detected_at: string
  /**
   * Present when the cut went through an entry the store had already recorded as written (not a crash, which only tears a
   * line nobody was answered with: a disk fault or a hand edit). That entry is lost from the file; its seq and hash say which.
   */
  cut_entry?: { seq: number; hash: string }
  /** 'ledger.lock_broken' of a per-append writer's lock (2026-10-03): why it was judged stale (its pid gone, or its age) */
  reason?: string
}

export interface LedgerStore {
  load(): LedgerEntry[]
  append(e: LedgerEntry): void
  /** The chain's length and head hash in O(1), when the store keeps them (the file store: a sidecar validated on open). */
  head?(): { count: number; head: string }
  /** Repairs made when the store opened; each is returned once (openLedger records it as a note). */
  takeRepairs?(): StoreRepair[]
  /** Every entry in order, without holding the whole file in memory. */
  scan?(visit: (e: LedgerEntry) => void): void
  /**
   * The first line the strict reader refused during the last load or scan (2026-10-19; readLedgerLine): the store still
   * returns JSON.parse's reading so the chain can be walked, and verify breaks the chain at that entry with the reason.
   */
  refused?(): LineRefusal | undefined
  /** One entry by its seq, without loading the rest. */
  entryAt?(seq: number): LedgerEntry | undefined
  /**
   * Run `fn` as ONE critical section under the store's single-writer lock (2026-10-03; the file store). openLedger
   * reads the head, builds, signs and writes each entry inside it, so two processes never chain to the same head.
   * `orReadOnly`: if the lock is out of reach (another process's server holds it), run `fn` with nothing written.
   */
  exclusive?<T>(fn: (access: 'write' | 'read-only') => T, opts?: { orReadOnly?: boolean }): T
}

export function memoryStore(seed: LedgerEntry[] = []): LedgerStore {
  const entries = [...seed]
  return {
    load: () => [...entries],
    append: (e) => { entries.push(e) },
    head: () => ({ count: entries.length, head: entries.length ? entries[entries.length - 1]!.hash : GENESIS }),
    scan: (visit) => { for (const e of entries) visit(e) },
    entryAt: (seq) => entries[seq],
  }
}

export const GENESIS = '0'.repeat(64)
/** The hash an entry commits to: sha256 over the canonical JSON of {seq, kind, at, body, prev_hash}. */
export const entryHash = (e: Pick<LedgerEntry, 'seq' | 'kind' | 'at' | 'body' | 'prev_hash'>): string =>
  sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }))

/**
 * A ledger line that JSON.parse reads but the engine's strict reader refuses (2026-10-19; a cold reviewer's entry rewritten as
 * `"decision":"EXECUTE","decision":"HOLD"` verified with the pinned key). JSON.parse keeps the last of a repeated key, so the
 * entry's hash re-derived over HOLD and its signature verified, while a reader that keeps the first value saw EXECUTE. A number
 * whose text does not read back as written (`9007199254740993`, read as 9007199254740992) is the same disagreement. The entry
 * is not one document, so the chain breaks there. `entry` is its position, `line` its line among the file's lines, `path` the
 * JSON path the strict reader names.
 */
export interface LineRefusal { entry: number; line: number; path: string; reason: string }

/**
 * Read one ledger line as the engine reads a replay bundle (verify's parseJsonStrict, unchanged): `{ entry }` when it reads one
 * way; `{ entry, refused }` when JSON.parse reads it and the strict reader refuses it (a key written twice in one object, a
 * number that does not read back as written, nesting past the engine's limit): `entry` is then JSON.parse's reading, so the
 * rest of the chain can still be walked; undefined when the line is not JSON at all. The receipts store writes each line with
 * JSON.stringify, which never repeats a key and writes every number as it reads back, so a line it wrote always reads one way.
 */
export function readLedgerLine(text: string, entry: number, line: number): { entry: LedgerEntry; refused?: LineRefusal } | undefined {
  try { return { entry: parseJsonStrict(text, `line ${line}`) as LedgerEntry } } catch (e) {
    if (!(e instanceof HashInputRefused)) return undefined
    let loose: LedgerEntry
    try { loose = JSON.parse(text) as LedgerEntry } catch { return undefined } // a byte-order mark, or not JSON either
    const dup = duplicateKeyPath(text)
    const detail = dup
      ? `line ${line}: the key ${JSON.stringify(dup.key)} appears twice in one object (at ${dup.path}). JSON keeps the last, so the entry's ` +
        'hash and signature cover that value, while a reader that keeps the first sees the other. The receipts store writes every key ' +
        'once, so something else wrote this line'
      : e.message
    return { entry: loose, refused: { entry, line, path: dup ? dup.path : e.where, reason: `entry ${entry} cannot be read one way: ${detail}` } }
  }
}

export interface Ledger {
  append(kind: ReceiptKind, body: unknown): LedgerEntry
  entries(): LedgerEntry[]
  verify(policy?: ChainPolicy): ChainCheck
  /** The chain's length and head (O(1) on a store that keeps them). */
  head(): { count: number; head: string }
  /** Every entry in order (streamed when the store can). */
  scan(visit: (e: LedgerEntry) => void): void
  /** One entry by seq. */
  entryAt(seq: number): LedgerEntry | undefined
  /** Whether entries are signed (a signing key is configured). */
  readonly signed: boolean
}

export interface ChainCheck {
  /** every check below holds: the chain, the signatures, and the anchored head when one was given */
  ok: boolean
  /**
   * The hash chain's own answer, and nothing else (2026-10-05): every entry's seq is its position, its
   * prev_hash is the entry before's hash, and its hash re-derives from what it holds. A wrong key or a missing head does not
   * make it false; those have their own fields.
   */
  chain_ok: boolean
  /** every signature present verifies over its entry's hash, and a pinned key (or require-signed) is satisfied by every entry */
  signatures_ok: boolean
  /** the anchored head (ChainPolicy.head) is in the chain; present only when one was given */
  anchor_ok?: boolean
  length: number
  head: string
  /** the first entry that fails any check (the chain's before a signature's at the same entry), and why */
  broken_at?: number
  reason?: string
  /** entries carrying a (verified) signature, and entries carrying none */
  signed: number
  unsigned: number
  /** fingerprints of every key that signed an entry. More than one means mixed signers, worth a look even when ok. */
  signers: string[]
  /** Torn tails quarantined on open, as recorded on the chain (present only when there are any). */
  repairs?: { seq: number; bytes: number; sha256: string; quarantined_to: string; after_seq: number | null; cut_entry?: { seq: number; hash: string } }[]
}

/**
 * Trust anchors. A hash chain alone proves only that the file is internally consistent. Anyone who rewrites the WHOLE file
 * can recompute every hash, and re-sign every entry with their own key. To detect that, pin at least one of these:
 * - `publicKey`: every entry must carry a valid signature by this key (PEM, SPKI). Since 2026-10-05 an unsigned entry fails
 *   too, as verifyEntry already did: otherwise a rewrite with its signatures stripped passed a pinned key.
 * - `requireSigned`: no unsigned entries (so signatures cannot simply be stripped); implied by `publicKey`
 * - `head`: a hash you recorded earlier (e.g. published). The chain must still contain it, so it grew rather than being rewritten.
 * None of them catches a clean cut at the tail on its own except `head` (the entries left are still signed and chained):
 * `riposte-ledger verify` also reads the head record beside a ledger file (./head-record.ts), which catches a cut that left
 * the record behind.
 */
export interface ChainPolicy { publicKey?: string; requireSigned?: boolean; head?: string }

/**
 * A public key's fingerprint: sha256 over the bytes of its DER-encoded SubjectPublicKeyInfo, 64 hex (2026-10-05).
 * The one derivation: `verify replay` prints and pins the same value (verify's keyFingerprint), and it equals
 * `openssl pkey -pubin -in key.pub.pem -outform DER | sha256sum`. Until 2026-10-05 the ledger printed its first 16 hex characters;
 * a prefix is never a pin (a key can be ground to match a short prefix), so verify compares the whole value.
 */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

/**
 * The first 16 hex characters of keyFingerprint, for display only (`riposte-ledger fingerprint --short`), and for the records
 * that already name a key by it (a custody charter's roster); never what verify pins.
 */
export function shortKeyFingerprint(publicKeyPem: string): string {
  return keyFingerprint(publicKeyPem).slice(0, 16)
}

export function openLedger(store: LedgerStore = memoryStore(), opts: { signingKey?: string; now?: () => Date } = {}): Ledger {
  const now = opts.now ?? (() => new Date())
  // The signing key is parsed once, not on every append (2026-10-03). A key that does not parse throws here, at open.
  const key = opts.signingKey ? createPrivateKey(opts.signingKey) : undefined
  const publicPem = key ? createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString() : undefined
  const headOf = (): { count: number; head: string } => {
    if (store.head) return store.head()
    const all = store.load()
    return { count: all.length, head: all.length ? all[all.length - 1]!.hash : GENESIS }
  }
  const write = (kind: ReceiptKind, body: unknown): LedgerEntry => {
    const h = headOf()
    const partial = { seq: h.count, kind, at: now().toISOString(), body, prev_hash: h.head }
    const hash = entryHash(partial)
    const entry: LedgerEntry = { ...partial, hash }
    if (key) entry.signature = { alg: 'ed25519', public_key: publicPem!, sig: edSign(null, Buffer.from(hash, 'utf8'), key).toString('base64') }
    store.append(entry)
    return entry
  }
  // One critical section per append: the head is read, the entry built, signed and written under the store's lock.
  const atomically = <T>(fn: (access: 'write' | 'read-only') => T, orReadOnly = false): T =>
    store.exclusive ? store.exclusive(fn, orReadOnly ? { orReadOnly: true } : undefined) : fn('write')
  // Put any repair the store made on the record (a signed note per quarantined torn tail or broken lock), before the entry.
  const drain = (): void => { for (const r of store.takeRepairs?.() ?? []) write('note', { ...r }) }
  // On first use: open the store and record its repairs. A read the lock keeps out reads without writing, and tries again later.
  let ready = false
  const init = (): void => {
    if (ready) return
    atomically((access) => { drain(); if (access === 'write') ready = true }, true)
  }
  return {
    append(kind, body) { return atomically(() => { drain(); ready = true; return write(kind, body) }) },
    entries: () => { init(); return store.load() },
    verify: (policy) => { init(); const entries = store.load(); return verifyChain(entries, policy, { refused: store.refused?.() }) },
    head: () => { init(); return headOf() },
    scan: (visit) => { init(); if (store.scan) store.scan(visit); else for (const e of store.load()) visit(e) },
    entryAt: (seq) => { init(); return store.entryAt ? store.entryAt(seq) : store.load()[seq] },
    signed: Boolean(key),
  }
}

/**
 * Verify a chain with nothing but sha256 and the public keys: order, links, hashes and signatures. With a ChainPolicy it also
 * checks WHO signed, and against a previously recorded head. Without one, a full rewrite by someone else can still verify.
 */
/** What verifyEntry found about one entry on its own. */
export interface EntryCheck { ok: boolean; signed: boolean; signer?: string; reason?: string }

/**
 * Verify ONE entry on its own (a receipt handed back by the hosted gate, 2026-10-02): its hash re-derives from what it holds,
 * and its signature, when present, verifies over that hash. With `publicKey` it must be that key's; with `requireSigned` an
 * unsigned entry fails. It says nothing about the entries around it: for the chain, verifyChain the whole ledger.
 */
export function verifyEntry(e: LedgerEntry, policy: { publicKey?: string; requireSigned?: boolean } = {}): EntryCheck {
  if (!e || typeof e !== 'object' || typeof e.hash !== 'string') return { ok: false, signed: false, reason: 'not a ledger entry' }
  let derived: string
  try { derived = entryHash(e) } catch { return { ok: false, signed: false, reason: 'the entry could not be hashed' } }
  if (derived !== e.hash) return { ok: false, signed: Boolean(e.signature), reason: 'the entry was altered after it was written (its hash does not re-derive)' }
  if (!e.signature) {
    return policy.requireSigned || policy.publicKey ? { ok: false, signed: false, reason: 'the entry is not signed' } : { ok: true, signed: false }
  }
  let ok = false
  let fp = ''
  try {
    ok = edVerify(null, Buffer.from(e.hash, 'utf8'), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, 'base64'))
    fp = keyFingerprint(e.signature.public_key)
  } catch { ok = false }
  if (!ok) return { ok: false, signed: true, reason: 'the signature does not verify' }
  if (policy.publicKey) {
    let expected: string
    try { expected = keyFingerprint(policy.publicKey) } catch { return { ok: false, signed: true, signer: fp, reason: 'the expected public key could not be read' } }
    if (fp !== expected) return { ok: false, signed: true, signer: fp, reason: `signed by key ${fp}, not the expected ${expected}` }
  }
  return { ok: true, signed: true, signer: fp }
}

/**
 * `read.refused` (2026-10-19): the first line of the file the strict reader refused (readLedgerLine). The chain breaks at that
 * entry with its reason, as an edited entry does: what the line holds is not one document, so its hash cannot be said to
 * re-derive from it. Entries parsed by a caller that read no text (the stores, a bundle) carry none.
 */
export function verifyChain(entries: LedgerEntry[], policy: ChainPolicy = {}, read: { refused?: Pick<LineRefusal, 'entry' | 'reason'> } = {}): ChainCheck {
  let signed = 0
  let unsigned = 0
  const signers = new Set<string>()
  let expected: string | null = null
  if (policy.publicKey) {
    try { expected = keyFingerprint(policy.publicKey) } catch {
      return { ok: false, chain_ok: false, signatures_ok: false, ...(policy.head ? { anchor_ok: false } : {}), length: entries.length, head: GENESIS, reason: 'the expected public key could not be read', signed, unsigned, signers: [] }
    }
  }
  // 2026-10-05: every entry is read, and the chain, the signatures and the anchor are answered apart, so an
  // intact chain checked against the wrong key reads chain_ok: true, signatures_ok: false. The first failure of any kind, in
  // entry order (the chain's before a signature's at the same entry), is still `broken_at` and `reason`. `head` is the hash of
  // the last entry the chain holds up to (the whole file when the chain is intact).
  let chainAt: { i: number; reason: string } | undefined
  let sigAt: { i: number; reason: string } | undefined
  let head = GENESIS
  let prev = GENESIS
  let anchored = !policy.head
  const repairs: NonNullable<ChainCheck['repairs']> = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    // 2026-10-20: a line that is JSON null is one value read one way, so the line reader passes it; it is not an entry. The
    // chain breaks there in words (it used to throw reading .seq of null, with no verdict line), as the Python reader says it.
    if (e === null) { chainAt ??= { i, reason: `entry ${i} is not a ledger entry (the line is JSON null)` }; unsigned++; continue }
    if (chainAt === undefined) {
      if (read.refused?.entry === i) chainAt = { i, reason: read.refused.reason }
      else if (e.seq !== i) chainAt = { i, reason: `entry ${i} has seq ${e.seq} (reordered or removed entries)` }
      else if (e.prev_hash !== prev) chainAt = { i, reason: `entry ${i} does not follow entry ${i - 1} (chain broken)` }
      else if (entryHash(e) !== e.hash) chainAt = { i, reason: `entry ${i} was altered after it was written` }
      else head = e.hash
    }
    prev = e.hash
    if (e.signature) {
      let ok = false
      let fp = ''
      try {
        ok = edVerify(null, Buffer.from(e.hash, 'utf8'), createPublicKey(e.signature.public_key), Buffer.from(e.signature.sig, 'base64'))
        fp = keyFingerprint(e.signature.public_key)
      } catch { ok = false }
      if (!ok) sigAt ??= { i, reason: `entry ${i} signature does not verify` }
      else {
        signers.add(fp)
        signed++
        if (expected && fp !== expected) sigAt ??= { i, reason: `entry ${i} is signed by key ${fp}, not the expected ${expected} (re-signed by someone else?)` }
      }
    } else {
      unsigned++
      if (policy.requireSigned) sigAt ??= { i, reason: `entry ${i} is not signed (signatures required)` }
      else if (expected) sigAt ??= { i, reason: `entry ${i} is not signed, and a pinned key needs every entry signed by it (an unsigned entry could have been written by anyone)` }
    }
    if (policy.head && e.hash === policy.head && (chainAt === undefined || chainAt.i > i)) anchored = true
    const b = e.body as Record<string, unknown> | null
    if (chainAt === undefined && e.kind === 'note' && b && typeof b === 'object' && b.event === 'ledger.torn_tail_quarantined') {
      const cut = b.cut_entry as { seq?: unknown; hash?: unknown } | undefined
      repairs.push({
        seq: i, bytes: Number(b.bytes), sha256: String(b.sha256), quarantined_to: String(b.quarantined_to), after_seq: typeof b.after_seq === 'number' ? b.after_seq : null,
        ...(cut && typeof cut === 'object' && typeof cut.seq === 'number' && typeof cut.hash === 'string' ? { cut_entry: { seq: cut.seq, hash: cut.hash } } : {}),
      })
    }
  }
  const first = chainAt !== undefined && (sigAt === undefined || chainAt.i <= sigAt.i) ? chainAt : sigAt
  const anchorReason = anchored ? undefined : `the anchored hash ${policy.head!.slice(0, 16)}… is not in this chain (rewritten or truncated since it was recorded)`
  const base = {
    chain_ok: chainAt === undefined, signatures_ok: sigAt === undefined, ...(policy.head ? { anchor_ok: anchored } : {}),
    length: entries.length, head, signed, unsigned, signers: [...signers], ...(repairs.length ? { repairs } : {}),
  }
  if (first) return { ok: false, ...base, broken_at: first.i, reason: first.reason }
  if (anchorReason) return { ok: false, ...base, reason: anchorReason }
  return { ok: true, ...base }
}
