/**
 * Tamper-evident hash chain for the ledger — the "book of record", on which an edit to the past shows.
 *
 * Every recording and every human review is an EVENT appended to an ordered log. Each event carries the hash of the one
 * before it, so altering or deleting any past event breaks every hash after it, unless the rewriter recomputes them all.
 * A verifier walks the chain and reports the first break. The single head hash is the value a deployment anchors
 * externally (signed checkpoints held by a witness, ../anchor): against those, a recomputed rewrite is caught too.
 *
 * What it is designed to support (requirements checked against primary sources, 2026-09-22; verbs per docs/ANCHORING.md):
 *  - SEC Rule 17a-4(f)(2)(i)(A), the audit-trail alternative to WORM media: a complete, time-stamped audit trail that
 *    permits re-creation of the original record. The chain shows a modification or deletion, and with external anchoring
 *    a recomputed rewrite as well; re-creating the original needs a retained copy of the book. Anchored, the ledger
 *    SUPPORTS a customer's audit-trail approach. Whether a deployment satisfies the rule is the customer's determination.
 *  - EU AI Act: Art. 12 logging binds providers of high-risk systems; a deployer's log duty is Art. 26(6). The book can
 *    support a deployer's records where its use is high-risk.
 *  - PCAOB AS 1215 (the auditor's own documentation, so by analogy): retained, never deleted, additions dated.
 *    Corrections here are appends, and an alteration shows (a recomputed one only against checkpoints).
 *
 * Pure and dependency-free: reuses the engine's canonical hash. Corrections are new appends, never edits: the ledger
 * never rewrites the past, and a rewrite made outside it is detectable, which is the whole point.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'

/** The prev_hash of the very first event. A fixed, well-known root so an empty chain has a defined head. */
export const GENESIS = sha256('verify-ledger:genesis:v1')

/**
 * RECORD and REVIEW concern a verdict (a REVIEW may carry a person's signature: ./decisions.ts). GRANT, DECLINE,
 * POLICY_REVISION, KEY_REGISTER, KEY_REVOKE, CANARY_SEAL and CANARY_REVEAL are a person's signed decisions (./decisions.ts,
 * ./registry.ts). SAMPLE is the mechanical commit of a random review queue (./sampling.ts), re-derived on every read.
 * The header fields (ts, type, verdict_id) are not in entry_hash; the content check (ledger.verifyContent /
 * readDecisionBook) holds each header to its hashed payload, so a relabelled event is caught.
 */
export type LedgerEventType =
  | 'RECORD' | 'REVIEW' | 'GRANT' | 'DECLINE' | 'POLICY_REVISION'
  | 'KEY_REGISTER' | 'KEY_REVOKE' | 'CANARY_SEAL' | 'CANARY_REVEAL' | 'SAMPLE'

export interface LedgerEvent {
  /** 0-based position in the append-only log. */
  seq: number
  /** ISO-8601 UTC, from the ledger clock. */
  ts: string
  type: LedgerEventType
  /** The verdict this event concerns; for any other event, its subject (`workflow:<id>`, `policy:<id>@<v>`, `key:<id>`, `canary:<wf>`, `sample:<wf>:<unit>:<start>`). */
  verdict_id: string
  /** sha256 of the canonical event payload (what actually happened). */
  payload_hash: string
  /** entry_hash of the previous event, or GENESIS for seq 0. */
  prev_hash: string
  /** sha256(seq : prev_hash : payload_hash) — this event's identity, and the next event's prev_hash. */
  entry_hash: string
}

/** Hash of an event's payload (the content whose integrity the chain protects). */
export function payloadHash(payload: unknown): string {
  return hashOf(payload)
}

/** Deterministic hash binding an event to its position and its predecessor. */
export function entryHash(seq: number, prev_hash: string, payload_hash: string): string {
  return sha256(`${seq}:${prev_hash}:${payload_hash}`)
}

/** Build the next event given the current head hash and the next sequence number. */
export function linkEvent(
  seq: number,
  prev_hash: string,
  e: { ts: string; type: LedgerEventType; verdict_id: string; payload: unknown },
): LedgerEvent {
  const payload_hash = payloadHash(e.payload)
  const entry_hash = entryHash(seq, prev_hash, payload_hash)
  return { seq, ts: e.ts, type: e.type, verdict_id: e.verdict_id, payload_hash, prev_hash, entry_hash }
}

export interface ChainCheck {
  ok: boolean
  length: number
  /** The current head hash (last entry_hash, or GENESIS if empty). */
  head: string
  /** 0-based index of the first event that fails, if any. */
  brokenAt?: number
  /** Human-readable reason for the first break. */
  reason?: string
  /**
   * F5b (ledger-scale, 2026-09-28): present when this check did NOT re-hash the whole book. Events 0 … through−1 were
   * content-verified (links, entry hashes, payload hashes) by this process at `verified_at` and held in its memory since;
   * only the events after them were re-hashed now. Absent: every event was re-hashed by this check. A report says "verified
   * through seq N at T". A full re-check (`ledger.verifyContent({ full: true })`) and every reopen from disk re-hash it all.
   */
  reused?: { through: number; verified_at: string }
}

/**
 * A chain held in memory as two parallel arrays: the events and each event's verbatim payload (what `parseChainJSONL`
 * returns, and what `ledger.snapshot()` hands out by reference, with no string in between).
 */
export interface ChainSnapshot {
  events: LedgerEvent[]
  payloads: unknown[]
}

/**
 * A verified prefix of an events array (F5b). Held OFF the array, in a WeakMap keyed by the array's identity (as
 * decisions.ts keeps a ledger's own read), so nothing parsed from JSON or a request body can carry one: only the in-process
 * ledger that verified the content certifies its own chain, and the snapshots it hands out.
 */
export interface VerifiedPrefix {
  /** Events 0 … through−1 were content-verified. */
  through: number
  /** entry_hash of event through−1: the head the prefix ends at. */
  head: string
  /** When (ISO-8601, wall clock). */
  verified_at: string
  /**
   * The event and payload objects that were verified, by reference (the ledger's own append-only arrays, whose first
   * `through` elements never change). An array handed in with any other object at any of those positions is re-hashed.
   * For a disk-backed ledger `payloads` is its payload view (PAYLOAD_VIEW): the store, not each payload, is the identity.
   */
  events: readonly LedgerEvent[]
  payloads: readonly unknown[]
}

/**
 * A payloads array whose elements are read on demand from a store (a disk-backed ledger, ./disk.ts) answers this symbol with
 * the store it reads and the first position its holder has overwritten (Infinity: none). A verified prefix certified over such
 * a view is usable by any view of the SAME store left untouched below the prefix: no per-payload identity check, which would
 * read every payload back from disk. The store itself checks every line it reads against the bytes it read at open.
 */
export const PAYLOAD_VIEW: unique symbol = Symbol('riposte.ledger.payload-view')

/** What a payload view says about itself (see PAYLOAD_VIEW). */
export interface PayloadViewInfo {
  /** The store the view reads (identity). */
  store: object
  /** The first position the view's holder has overwritten or deleted (Infinity: none). */
  pristine: number
}

/** The store behind a payloads array, when it is a view of one (a disk-backed ledger's); undefined for a plain array. */
export function payloadViewOf(payloads: readonly unknown[] | undefined): PayloadViewInfo | undefined {
  if (!payloads || typeof payloads !== 'object') return undefined
  const info = (payloads as unknown as { [PAYLOAD_VIEW]?: PayloadViewInfo })[PAYLOAD_VIEW]
  return info && typeof info === 'object' && info.store ? info : undefined
}

const PREFIX = new WeakMap<readonly LedgerEvent[], VerifiedPrefix>()

/**
 * Certify that `events[0 … through−1]` (with exactly these payload objects) were content-verified. For the ledger's own use
 * (MemoryLedger); deliberately not exported from the package. The trust it encodes is the process's own memory: a payload
 * object mutated in place after it was verified is not re-hashed until a full check.
 */
export function certifyPrefix(events: readonly LedgerEvent[], prefix: VerifiedPrefix): void {
  if (prefix.through <= 0 || prefix.through > events.length) return
  PREFIX.set(events, prefix)
}

/** The verified prefix certified for this events array, if any. */
export function prefixOf(events: readonly LedgerEvent[]): VerifiedPrefix | undefined {
  return PREFIX.get(events)
}

/** Drop the certificate: the next content check re-hashes every event. */
export function forgetPrefix(events: readonly LedgerEvent[]): void {
  PREFIX.delete(events)
}

/**
 * The certified prefix, when it still describes this array: it ends at the head it names, and every event and payload handed
 * in for it is (by identity) the object that was verified. Anything else (an edited copy, other payloads) and the whole chain
 * is re-hashed.
 */
function usablePrefix(events: readonly LedgerEvent[], payloadOf: (ev: LedgerEvent) => unknown, payloads?: readonly unknown[]): VerifiedPrefix | undefined {
  const p = PREFIX.get(events)
  if (!p || p.through <= 0 || p.through > events.length || events[p.through - 1]!.entry_hash !== p.head) return undefined
  const certified = payloadViewOf(p.payloads)
  if (certified) {
    // A disk-backed prefix: the payloads handed in must be a view of the same store, untouched below the prefix.
    const handed = payloadViewOf(payloads)
    if (!handed || handed.store !== certified.store || handed.pristine < p.through) return undefined
    for (let i = 0; i < p.through; i++) if (events[i] !== p.events[i]) return undefined
    return p
  }
  for (let i = 0; i < p.through; i++) if (events[i] !== p.events[i] || payloadOf(events[i]!) !== p.payloads[i]) return undefined
  return p
}

/** How verifyChainAgainst walks (P-G: the book reader rides along the payload walk, so a check reads each payload once). */
export interface ChainWalkOptions {
  /** The payloads array `payloadOf` reads (a disk-backed prefix is usable only when this is a view of its store). */
  payloads?: readonly unknown[]
  /** Called once the structure verifies, before any payload is re-hashed, with the first position that will be re-hashed. */
  onPrefix?: (from: number) => void
  /** Called for each re-hashed event whose payload hash matches, in order, with the payload that was hashed. */
  onVerified?: (i: number, payload: unknown) => void
}

/**
 * Walk an ordered event log and confirm: sequence numbers are dense from 0, each prev_hash links to the prior
 * entry_hash, and each entry_hash recomputes from (seq, prev_hash, payload_hash). Does NOT recompute payload_hash from
 * a re-serialized payload (the events store the hash, not the payload) — pair with `verifyChainAgainst` when you hold
 * the original payloads and want to prove the CONTENT is unaltered too.
 */
export function verifyChain(events: readonly LedgerEvent[]): ChainCheck {
  let prev = GENESIS
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (ev.seq !== i) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `seq ${ev.seq} out of order (expected ${i})` }
    if (ev.prev_hash !== prev) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `prev_hash at ${i} does not link to the previous entry` }
    if (entryHash(ev.seq, ev.prev_hash, ev.payload_hash) !== ev.entry_hash) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `entry_hash at ${i} does not recompute` }
    prev = ev.entry_hash
  }
  return { ok: true, length: events.length, head: prev }
}

/** verifyChain from position `from`, given the (already verified) head before it. */
function verifyChainFrom(events: readonly LedgerEvent[], from: number, head: string): ChainCheck {
  let prev = head
  for (let i = from; i < events.length; i++) {
    const ev = events[i]!
    if (ev.seq !== i) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `seq ${ev.seq} out of order (expected ${i})` }
    if (ev.prev_hash !== prev) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `prev_hash at ${i} does not link to the previous entry` }
    if (entryHash(ev.seq, ev.prev_hash, ev.payload_hash) !== ev.entry_hash) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `entry_hash at ${i} does not recompute` }
    prev = ev.entry_hash
  }
  return { ok: true, length: events.length, head: prev }
}

/**
 * Stronger check: given the events AND a function that returns the original payload for each event, confirm the stored
 * payload_hash still matches the content. This is what catches a tampered verdict body, not just a tampered chain link.
 *
 * F5b: when the events array carries a verified prefix (certifyPrefix: an in-process ledger's own chain, or a snapshot it
 * handed out) whose payloads are the very objects handed in, only the events after it are re-checked and hashed, and the
 * result says so (`reused`). The results for every event after the prefix are identical to a full walk's.
 *
 * `opts` (P-G) lets a reader ride along: `onPrefix` hears where re-hashing starts, `onVerified` each payload that matched. They
 * change nothing in the result, which still names the first structural break, else the first altered payload.
 */
export function verifyChainAgainst(events: readonly LedgerEvent[], payloadOf: (ev: LedgerEvent) => unknown, opts: ChainWalkOptions = {}): ChainCheck {
  const prefix = usablePrefix(events, payloadOf, opts.payloads)
  const from = prefix?.through ?? 0
  const structural = prefix ? verifyChainFrom(events, from, prefix.head) : verifyChain(events)
  if (!structural.ok) return structural
  opts.onPrefix?.(from)
  for (let i = from; i < events.length; i++) {
    const ev = events[i]!
    const payload = payloadOf(ev)
    if (payloadHash(payload) !== ev.payload_hash) return { ok: false, length: events.length, head: structural.head, brokenAt: i, reason: `payload at ${i} was altered (payload_hash mismatch)` }
    opts.onVerified?.(i, payload)
  }
  return prefix ? { ...structural, reused: { through: prefix.through, verified_at: prefix.verified_at } } : structural
}
