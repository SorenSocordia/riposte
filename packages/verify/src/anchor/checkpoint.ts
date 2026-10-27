/**
 * External anchoring of the book of record: signed CHECKPOINTS of the chain head (2026-09-28).
 *
 * The hash chain (../ledger/chain.ts) makes the book tamper-EVIDENT to anyone holding an earlier copy of it. It does not stop a
 * party with write access from rewriting an old event and recomputing every hash after it: the rewritten chain verifies
 * internally, and nothing inside the book can say otherwise. A checkpoint is the thing held OUTSIDE the book that can:
 *
 *   { length, head, as_of, prev_checkpoint? }  signed by a WITNESS key
 *
 * says "the first `length` events of this book hashed to `head`, and the chain's own clock read `as_of`". Published to storage
 * the book's writer cannot rewrite (a WORM / object-lock bucket the customer controls, an RFC 3161 time-stamp authority, an
 * auditor's inbox), it pins that prefix. A later rewrite of anything before `length`, however self-consistent, no longer
 * reaches the anchored head, and verifyAgainstCheckpoints names the first anchored position it fails at.
 *
 * What a checkpoint proves, and what it does not (docs/ANCHORING.md):
 *   - proves: the anchored prefix is exactly what existed when the checkpoint was made (and, once published with a trusted
 *     time, that it existed by then).
 *   - does not prove: that the recorded content was right, or that nothing was left out before recording (completeness is
 *     reconcile's job), or anything about events after the last checkpoint.
 *
 * Who may witness (WitnessAnchors), strongest first:
 *   witness_keys  witness_id → public key, supplied out of band. The witness is a party WITHOUT write access to the book.
 *   root_keys     a key registered on the book (KEY_REGISTER, under the registry's root key) holding the `witness` role.
 *                 Weaker: the grant of the role lives in the book the checkpoint protects (a rewriter cannot forge a root
 *                 signature, but can drop a later KEY_REVOKE of a compromised witness key). Needs the `witness` role in the
 *                 registry (ROLES); until then no key holds it and this route refuses every checkpoint.
 *   A key that administers the registry is not a witness: the party that manages the book's keys does not also vouch for its history.
 *
 * Deterministic and offline: no network, no clock of its own (as_of is the chain's), Ed25519 over a domain-separated
 * canonical body. The same book and key give byte-identical checkpoints.
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto'
import { canonicalize, sha256 } from '../verdict/canonical.js'
import { GENESIS, payloadHash, verifyChain, verifyChainAgainst, type ChainCheck, type ChainSnapshot, type LedgerEvent } from '../ledger/chain.js'
import { readDecisionBook } from '../ledger/decisions.js'
import { keyFingerprint, type KeyEntry, type RootKeys } from '../ledger/registry.js'
import type { Ledger } from '../ledger/types.js'

export const CHECKPOINT_VERSION = 'riposte-checkpoint/v0'
/** Domain separation: a checkpoint signature can never be replayed as a decision signature, or the reverse. */
export const CHECKPOINT_SIGNING_PREFIX = 'riposte:checkpoint:v0\n'
/** The registry role a book-registered witness key must hold. */
export const WITNESS_ROLE = 'witness'

export interface CheckpointBody {
  checkpoint_version: typeof CHECKPOINT_VERSION
  /** The deployment's name for the book, so one witness store can hold several books. Optional. */
  book_id?: string
  /** Events 0 … length−1 are anchored. */
  length: number
  /** entry_hash of event length−1. */
  head: string
  /** The chain's own clock at `length` (the running maximum of event timestamps), ISO-8601 UTC. Not the witness's clock. */
  as_of: string
  /** checkpoint_id of this book's previous checkpoint: the checkpoints are themselves a chain, so a deleted one shows. */
  prev_checkpoint?: string
  /** Who vouches for it (the witness key's owner). */
  witness_id: string
}

export interface Checkpoint {
  body: CheckpointBody
  alg: 'ed25519'
  /** The witness's Ed25519 public key (SPKI PEM). */
  public_key: string
  /** Ed25519 over CHECKPOINT_SIGNING_PREFIX + canonicalize(body), base64. */
  signature: string
  /** sha256 of canonicalize(body). */
  checkpoint_id: string
}

/** witness_id → SPKI PEM public key(s). */
export type WitnessKeys = Readonly<Record<string, string | readonly string[]>>

export interface WitnessAnchors {
  /** Out-of-band witness keys (the strong mode). A witness_id listed here is judged ONLY against these keys. */
  witness_keys?: WitnessKeys
  /** The book's key-registry root key(s): a key registered on the book with the `witness` role also counts. */
  root_keys?: RootKeys
}

export class CheckpointRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckpointRefused'
  }
}

/** A book: a live ledger, or its chain (events + verbatim payloads, or events alone for a structure-only check). */
export type Book = Ledger | ChainSnapshot | { events: readonly LedgerEvent[]; payloads?: readonly unknown[] }

const isLedger = (b: Book): b is Ledger => typeof (b as Ledger).snapshot === 'function'

function chainOf(book: Book): { events: readonly LedgerEvent[]; payloads?: readonly unknown[] } {
  return isLedger(book) ? book.snapshot() : book
}

// ── the signed body ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The exact bytes a witness signs (and a time-stamp authority is asked to stamp: checkpointDigest). */
export function checkpointMessage(body: CheckpointBody): Buffer {
  return Buffer.from(CHECKPOINT_SIGNING_PREFIX + canonicalize(body), 'utf8')
}

/** sha256 of checkpointMessage: the messageImprint an RFC 3161 time-stamp request carries for this checkpoint. */
export function checkpointDigest(cp: Checkpoint | CheckpointBody): Buffer {
  const body = 'body' in cp ? cp.body : cp
  return Buffer.from(sha256(CHECKPOINT_SIGNING_PREFIX + canonicalize(body)), 'hex')
}

export function checkpointId(body: CheckpointBody): string {
  return sha256(canonicalize(body))
}

const HEX64 = /^[0-9a-f]{64}$/
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const extraKeys = (o: Record<string, unknown>, allowed: readonly string[]): string[] => Object.keys(o).filter(k => !allowed.includes(k)).sort()

/** Why a checkpoint body is malformed (undefined: well-formed). */
export function checkpointBodyProblem(b: unknown): string | undefined {
  if (!isObj(b)) return 'a checkpoint body is an object'
  const extra = extraKeys(b, ['checkpoint_version', 'book_id', 'length', 'head', 'as_of', 'prev_checkpoint', 'witness_id'])
  if (extra.length) return `a checkpoint body carries unknown field(s) ${extra.join(', ')}`
  if (b.checkpoint_version !== CHECKPOINT_VERSION) return `checkpoint_version must be ${CHECKPOINT_VERSION}`
  if (b.book_id !== undefined && (typeof b.book_id !== 'string' || b.book_id.length === 0)) return 'book_id, when present, is a non-empty string'
  if (typeof b.length !== 'number' || !Number.isSafeInteger(b.length) || b.length < 1) return 'length is a positive integer (the number of anchored events)'
  if (typeof b.head !== 'string' || !HEX64.test(b.head)) return 'head is a sha256 hex digest'
  if (typeof b.as_of !== 'string' || !Number.isFinite(Date.parse(b.as_of)) || new Date(Date.parse(b.as_of)).toISOString() !== b.as_of) return 'as_of is an ISO-8601 UTC timestamp (toISOString form)'
  if (b.prev_checkpoint !== undefined && (typeof b.prev_checkpoint !== 'string' || !HEX64.test(b.prev_checkpoint))) return 'prev_checkpoint, when present, is a checkpoint_id'
  if (typeof b.witness_id !== 'string' || b.witness_id.length === 0) return 'witness_id is a non-empty string'
  return undefined
}

/** The signature alone: well-formed, the id derives from the body, Ed25519 verifies. Says nothing about WHO the key is. */
export function verifyCheckpointSignature(cp: unknown): { ok: boolean; reason?: string } {
  const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
  if (!isObj(cp)) return no('not a checkpoint')
  const extra = extraKeys(cp, ['body', 'alg', 'public_key', 'signature', 'checkpoint_id'])
  if (extra.length) return no(`a checkpoint carries unknown field(s) ${extra.join(', ')}`)
  if (cp.alg !== 'ed25519') return no(`unsupported alg: ${String(cp.alg)}`)
  if (typeof cp.public_key !== 'string' || typeof cp.signature !== 'string') return no('a checkpoint carries public_key and signature')
  const problem = checkpointBodyProblem(cp.body)
  if (problem) return no(problem)
  const body = cp.body as unknown as CheckpointBody
  if (cp.checkpoint_id !== checkpointId(body)) return no('checkpoint_id does not derive from the body (altered after signing)')
  let ok = false
  try {
    ok = edVerify(null, checkpointMessage(body), createPublicKey(cp.public_key), Buffer.from(cp.signature, 'base64'))
  } catch (e) {
    return no(`signature verification errored: ${(e as Error).message}`)
  }
  return ok ? { ok: true } : no('signature does not verify: the checkpoint was altered, or the key does not match')
}

/** Sign a checkpoint body with the witness's Ed25519 private key (PKCS8 PEM). Refuses a malformed body. */
export function signCheckpoint(body: CheckpointBody, privateKeyPem: string): Checkpoint {
  const problem = checkpointBodyProblem(body)
  if (problem) throw new CheckpointRefused(problem)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new CheckpointRefused(`a checkpoint is signed with an Ed25519 key, not ${key.asymmetricKeyType}`)
  const clean = JSON.parse(canonicalize(body)) as CheckpointBody
  return {
    body: clean,
    alg: 'ed25519',
    public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    signature: edSign(null, checkpointMessage(clean), key).toString('base64'),
    checkpoint_id: checkpointId(clean),
  }
}

// ── the chain walk ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Walk {
  check: ChainCheck
  /** Events 0 … through−1 verify (links, entry hashes, and payload hashes when payloads were given). */
  through: number
  content: boolean
}

function walk(events: readonly LedgerEvent[], payloads?: readonly unknown[]): Walk {
  const check = payloads ? verifyChainAgainst(events, ev => payloads[ev.seq], { payloads }) : verifyChain(events)
  if (check.ok) return { check, through: events.length, content: payloads !== undefined }
  // verifyChainAgainst stops at the first STRUCTURAL break before hashing any payload: hash the payloads below it here.
  let through = check.brokenAt ?? 0
  if (payloads) for (let i = 0; i < through; i++) if (payloadHash(payloads[i]) !== events[i]!.payload_hash) { through = i; break }
  return { check, through, content: payloads !== undefined }
}

/** The chain's clock (running maximum of event timestamps, ms) at each requested length, in one pass. */
function clocksAt(events: readonly LedgerEvent[], lengths: readonly number[]): Map<number, number | undefined> {
  const want = [...new Set(lengths)].filter(l => l >= 1 && l <= events.length).sort((a, b) => a - b)
  const out = new Map<number, number | undefined>()
  let max: number | undefined
  let k = 0
  for (let i = 0; i < events.length && k < want.length; i++) {
    const t = Date.parse(events[i]!.ts)
    if (Number.isFinite(t) && (max === undefined || t > max)) max = t
    while (k < want.length && want[k] === i + 1) out.set(want[k++]!, max)
  }
  return out
}

const isoOf = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString())

// ── making one ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckpointOptions {
  /** The witness's Ed25519 private key (PKCS8 PEM). */
  key: string
  witness_id: string
  /** Anchor the first `length` events (default: the whole book). */
  length?: number
  /** This book's previous checkpoint: linked by id, and the book must still hold the history it anchored. */
  prev?: Checkpoint
  book_id?: string
}

/**
 * Make a signed checkpoint of a book. The book is verified first (a live ledger's content check; a chain's links and payload
 * hashes), and nothing is signed over a broken one, past its end, or over a history that contradicts `prev`. A witness
 * that checks before it signs is the point: it never extends a rewritten history.
 */
export function checkpoint(book: Book, opts: CheckpointOptions): Checkpoint {
  const chain = chainOf(book)
  const events = chain.events
  const verified = isLedger(book) ? book.verifyContent() : walk(events, chain.payloads).check
  if (!verified.ok) throw new CheckpointRefused(`the book does not verify at position ${verified.brokenAt} (${verified.reason}): a witness signs nothing over a broken book`)
  const length = opts.length ?? events.length
  if (!Number.isSafeInteger(length) || length < 1) throw new CheckpointRefused('length is a positive integer: an empty book has nothing to anchor')
  if (length > events.length) throw new CheckpointRefused(`the book holds ${events.length} events: a checkpoint cannot anchor position ${length}, which it has not reached`)
  if (opts.prev) {
    const p = opts.prev
    const sig = verifyCheckpointSignature(p)
    if (!sig.ok) throw new CheckpointRefused(`prev is not a valid checkpoint: ${sig.reason}`)
    if (p.body.book_id !== opts.book_id) throw new CheckpointRefused(`prev anchors book '${p.body.book_id ?? '(unnamed)'}', not '${opts.book_id ?? '(unnamed)'}'`)
    if (p.body.length > length) throw new CheckpointRefused(`prev anchors ${p.body.length} events: a checkpoint only moves forward (asked for ${length})`)
    const held = events[p.body.length - 1]!.entry_hash
    if (held !== p.body.head) throw new CheckpointRefused(`the book no longer holds the history prev anchored: its head at ${p.body.length} is ${held.slice(0, 12)}…, prev anchored ${p.body.head.slice(0, 12)}… (the anchored prefix was rewritten)`)
  }
  const as_of = isoOf(clocksAt(events, [length]).get(length))
  if (!as_of) throw new CheckpointRefused('the book carries no valid timestamp to anchor as_of')
  const body: CheckpointBody = {
    checkpoint_version: CHECKPOINT_VERSION,
    ...(opts.book_id !== undefined ? { book_id: opts.book_id } : {}),
    length,
    head: events[length - 1]!.entry_hash,
    as_of,
    ...(opts.prev ? { prev_checkpoint: opts.prev.checkpoint_id } : {}),
    witness_id: opts.witness_id,
  }
  return signCheckpoint(body, opts.key)
}

// ── who may witness ──────────────────────────────────────────────────────────────────────────────────────────────────

export type WitnessVia = 'witness_keys' | 'registry'

function outOfBand(keys: WitnessKeys, witness_id: string, pem: string): { ok: boolean; reason?: string } {
  const listed = keys[witness_id]
  const mine = keyFingerprint(pem)
  const anchored = (typeof listed === 'string' ? [listed] : listed ?? []).map(keyFingerprint)
  if (!mine || !anchored.includes(mine)) return { ok: false, reason: `the signing key is not the one anchored to witness '${witness_id}'` }
  return { ok: true }
}

/** Was `pem` registered to `witness_id` with the witness role, and unrevoked, before position `length`? */
function registered(keys: readonly KeyEntry[], witness_id: string, pem: string, length: number): { ok: boolean; reason?: string } {
  const fp = keyFingerprint(pem)
  const e = fp === undefined ? undefined : keys.find(k => k.fingerprint === fp)
  if (!e || e.registered.seq >= length) return { ok: false, reason: `the signing key is neither anchored out of band to witness '${witness_id}' nor registered on the book before position ${length}` }
  if (e.subject_id !== witness_id) return { ok: false, reason: `the signing key is registered to '${e.subject_id}', not '${witness_id}'` }
  if (!(e.roles as readonly string[]).includes(WITNESS_ROLE)) return { ok: false, reason: `'${witness_id}' holds ${e.roles.join(', ')}; a checkpoint needs the '${WITNESS_ROLE}' role (the party that manages the book's keys does not vouch for its history)` }
  if (e.roles.includes('key_admin')) return { ok: false, reason: `'${witness_id}''s key also administers the key registry: a key that manages the book's keys is not an independent witness of its history` }
  if (e.revoked && e.revoked.seq < length) return { ok: false, reason: `the witness key of '${witness_id}' was revoked at position ${e.revoked.seq}; it anchors nothing after that` }
  return { ok: true }
}

// ── checking a book against its checkpoints ──────────────────────────────────────────────────────────────────────────

/**
 * held       the book's first `length` events verify and hash to the anchored head, at the anchored clock.
 * rewritten  they verify internally but reach a different head (or clock): the anchored prefix was rewritten.
 * broken     the book does not verify internally before `length` (edited without recomputing the chain).
 * truncated  the book ends before `length`: anchored events were removed (or this is another book's checkpoint).
 * refused    the checkpoint itself does not count: malformed, altered, or not signed by an anchored witness.
 * unverified signed under the book's own registry, which cannot be read past a break in the book.
 */
export type CheckpointStatus = 'held' | 'rewritten' | 'broken' | 'truncated' | 'refused' | 'unverified'

export interface CheckpointCheck {
  status: CheckpointStatus
  ok: boolean
  checkpoint_id: string
  length: number
  witness_id?: string
  via?: WitnessVia
  reason?: string
  /** The book's own head at `length`, when it reaches that far. */
  book_head?: string
  /** For `rewritten` / `broken`: the rewrite lies in events from … to (from = the last held checkpoint's length, or 0). */
  within?: { from: number; to: number }
}

export interface AnchorReport {
  /** The book verifies through its end, and every checkpoint that counts held. */
  ok: boolean
  length: number
  head: string
  /** Payload hashes were re-checked (false: structure only, no payloads given). */
  content: boolean
  /** Events 0 … verified_through−1 verify internally. */
  verified_through: number
  /** The longest anchored prefix that held (0: none). */
  anchored_through: number
  /** One entry per checkpoint given, sorted by length (then as given). */
  checkpoints: CheckpointCheck[]
  /** The first anchored position that fails (by length). */
  first_failure?: CheckpointCheck
  /** prev_checkpoint ids named by a counted checkpoint but absent from the set: a checkpoint missing from the witness store. */
  gaps: string[]
}

export interface AnchorCheckOptions {
  /** Only this book's checkpoints count; another book's are refused. */
  book_id?: string
}

/**
 * Check a book against independently held checkpoints. A rewrite that recomputes the whole chain verifies internally
 * (verifyChain says ok), and still fails here at the first checkpoint whose prefix it touches. Offline and read-only.
 */
export function verifyAgainstCheckpoints(book: Book, checkpoints: readonly unknown[], anchors: WitnessAnchors, opts: AnchorCheckOptions = {}): AnchorReport {
  const chain = chainOf(book)
  const events = chain.events
  const w = walk(events, chain.payloads)
  const head = events.length ? events[events.length - 1]!.entry_hash : GENESIS

  // 1. Which checkpoints count: signature, book, witness.
  let registryKeys: readonly KeyEntry[] | undefined
  const registryRead = (): readonly KeyEntry[] => {
    if (registryKeys) return registryKeys
    try {
      const upTo = w.through
      const payloads = chain.payloads
      const read = payloads ? readDecisionBook(events.slice(0, upTo), payloads.slice(0, upTo), { root_keys: anchors.root_keys }) : undefined
      registryKeys = read?.registry?.keys ?? []
    } catch {
      registryKeys = []
    }
    return registryKeys
  }
  const indexed = checkpoints.map((cp, i) => ({ cp, i, len: isObj(cp) && isObj(cp.body) && typeof cp.body.length === 'number' ? cp.body.length : 0 }))
  indexed.sort((a, b) => a.len - b.len || a.i - b.i)
  const results: CheckpointCheck[] = []
  const counted: Array<{ cp: Checkpoint; res: CheckpointCheck }> = []
  for (const { cp } of indexed) {
    const id = isObj(cp) && typeof cp.checkpoint_id === 'string' ? cp.checkpoint_id : '(none)'
    const refuse = (reason: string, extra: Partial<CheckpointCheck> = {}): void => {
      results.push({ status: 'refused', ok: false, checkpoint_id: id, length: isObj(cp) && isObj(cp.body) && typeof cp.body.length === 'number' ? cp.body.length : 0, reason, ...extra })
    }
    const sig = verifyCheckpointSignature(cp)
    if (!sig.ok) { refuse(sig.reason!); continue }
    const c = cp as Checkpoint
    const base = { checkpoint_id: c.checkpoint_id, length: c.body.length, witness_id: c.body.witness_id }
    if (opts.book_id !== undefined && c.body.book_id !== opts.book_id) { refuse(`this checkpoint anchors book '${c.body.book_id ?? '(unnamed)'}', not '${opts.book_id}'`, base); continue }
    let via: WitnessVia
    if (anchors.witness_keys?.[c.body.witness_id] !== undefined) {
      const a = outOfBand(anchors.witness_keys, c.body.witness_id, c.public_key)
      if (!a.ok) { refuse(a.reason!, base); continue }
      via = 'witness_keys'
    } else if (anchors.root_keys && anchors.root_keys.length > 0) {
      if (c.body.length > w.through) {
        const res: CheckpointCheck = { status: 'unverified', ok: false, ...base, via: 'registry', reason: `signed under the book's own key registry, which cannot be read past the book's break at position ${w.through}` }
        results.push(res)
        continue
      }
      const a = registered(registryRead(), c.body.witness_id, c.public_key, c.body.length)
      if (!a.ok) { refuse(a.reason!, base); continue }
      via = 'registry'
    } else {
      refuse(`witness '${c.body.witness_id}' is not anchored: supply its key out of band (witness_keys), or the registry root (root_keys)`, base)
      continue
    }
    const res: CheckpointCheck = { status: 'held', ok: true, ...base, via }
    results.push(res)
    counted.push({ cp: c, res })
  }

  // 2. Hold each counted checkpoint to the book: truncation, internal break, head, clock.
  const clocks = clocksAt(events, counted.map(x => x.cp.body.length).filter(l => l <= w.through))
  let lastHeld = 0
  for (const { cp, res } of counted) {
    const L = cp.body.length
    const fail = (status: CheckpointStatus, reason: string, extra: Partial<CheckpointCheck> = {}): void => { res.status = status; res.ok = false; res.reason = reason; Object.assign(res, extra) }
    if (L > events.length) {
      fail('truncated', `the anchored book held ${L} events; this one holds ${events.length}: events ${events.length}…${L - 1} were removed (or this checkpoint is another book's)`)
      continue
    }
    res.book_head = events[L - 1]!.entry_hash
    if (L > w.through) {
      fail('broken', `the book does not verify internally at position ${w.through} (${w.check.reason ?? 'payload altered'}), inside the anchored prefix`, { within: { from: lastHeld, to: L - 1 } })
      continue
    }
    if (res.book_head !== cp.body.head) {
      fail('rewritten', `the anchored prefix was rewritten: the book's first ${L} events verify internally but hash to ${res.book_head.slice(0, 12)}…, not the anchored ${cp.body.head.slice(0, 12)}…; the change lies in events ${lastHeld}…${L - 1}`, { within: { from: lastHeld, to: L - 1 } })
      continue
    }
    const clock = isoOf(clocks.get(L))
    if (clock !== cp.body.as_of) {
      fail('rewritten', `the event timestamps before position ${L} were altered: the chain's clock there reads ${clock ?? '(none)'}, the checkpoint anchored ${cp.body.as_of} (timestamps sit outside entry_hash; the content check holds them to their payloads)`, { within: { from: lastHeld, to: L - 1 } })
      continue
    }
    lastHeld = Math.max(lastHeld, L)
  }

  // 3. The checkpoints' own chain: a counted checkpoint names a predecessor the store no longer holds.
  const ids = new Set(counted.map(x => x.cp.checkpoint_id))
  const gaps = [...new Set(counted.map(x => x.cp.body.prev_checkpoint).filter((p): p is string => p !== undefined && !ids.has(p)))].sort()

  const failures = counted.map(x => x.res).filter(r => !r.ok)
  return {
    ok: w.through === events.length && failures.length === 0,
    length: events.length,
    head,
    content: w.content,
    verified_through: w.through,
    anchored_through: lastHeld,
    checkpoints: results,
    ...(failures.length ? { first_failure: failures[0]! } : {}),
    gaps,
  }
}

/** One checkpoint against a book (verifyAgainstCheckpoints with a single checkpoint). */
export function verifyCheckpoint(cp: unknown, book: Book, anchors: WitnessAnchors, opts: AnchorCheckOptions = {}): CheckpointCheck {
  return verifyAgainstCheckpoints(book, [cp], anchors, opts).checkpoints[0]!
}
