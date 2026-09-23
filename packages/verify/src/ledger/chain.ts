/**
 * Tamper-evident hash chain for the ledger — the "book of record" made cryptographically append-only.
 *
 * Every recording and every human review is an EVENT appended to an ordered log. Each event carries the hash of the one
 * before it, so altering or deleting any past event breaks every hash after it. A verifier walks the chain and reports
 * the first break. The single head hash is the value a deployment anchors externally (a daily notarization, an internal
 * witness) to make the whole history provable to a third party.
 *
 * Why this is worth building (verified requirements, records-audit-law agent, 2026-09-22):
 *  - SEC Rule 17a-4(f) — the 2023 amendment added an "audit-trail alternative": a complete, time-stamped, tamper-evident
 *    record that can re-create any prior state IS a compliant substitute for legacy WORM media. A hash chain is exactly that.
 *  - EU AI Act Art 12 — high-risk AI systems must automatically log events over their lifetime for traceability.
 *  - PCAOB AS 1215 / retention — audit documentation must be retained unaltered; a chain proves non-alteration.
 *
 * Pure and dependency-free: reuses the engine's canonical hash. Corrections are new appends, never edits — the past is
 * immutable by construction, which is the whole point.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'

/** The prev_hash of the very first event. A fixed, well-known root so an empty chain has a defined head. */
export const GENESIS = sha256('verify-ledger:genesis:v1')

export type LedgerEventType = 'RECORD' | 'REVIEW'

export interface LedgerEvent {
  /** 0-based position in the append-only log. */
  seq: number
  /** ISO-8601 UTC, from the ledger clock. */
  ts: string
  type: LedgerEventType
  /** The verdict this event concerns. */
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

/**
 * Stronger check: given the events AND a function that returns the original payload for each event, confirm the stored
 * payload_hash still matches the content. This is what catches a tampered verdict body, not just a tampered chain link.
 */
export function verifyChainAgainst(events: readonly LedgerEvent[], payloadOf: (ev: LedgerEvent) => unknown): ChainCheck {
  const structural = verifyChain(events)
  if (!structural.ok) return structural
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (payloadHash(payloadOf(ev)) !== ev.payload_hash) return { ok: false, length: events.length, head: structural.head, brokenAt: i, reason: `payload at ${i} was altered (payload_hash mismatch)` }
  }
  return structural
}
