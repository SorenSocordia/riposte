/**
 * The Verdict Ledger (Stage 2) — the book of record.
 *
 * A verifier that returns a verdict is a *function*. A verifier that RECORDS every verdict — with tenant, retention, and
 * the human's later agree/disagree decision — is a *system of record* — what a regulated buyer is
 * required to keep. The ledger also produces the single most honest accuracy signal there is:
 * the **overturn rate** — of the verdicts a human reviewed, how often they overturned us. That number feeds the public
 * Index as a real-world counterpart to the synthetic false-positive / false-negative rates.
 *
 * This module is the primitive + an in-memory implementation. A production deployment plugs a database behind the same
 * `Ledger` interface; the package stays dependency-free (the reference store is a Map, with JSONL serialize/load).
 */

import type { Outcome, Verdict } from '../verdict/schema.js'
import type { ChainCheck, ChainSnapshot, LedgerEvent } from './chain.js'
import type { AnchorOptions, BookDecision, Decision, DecisionBook, DecisionEntry, ReviewDecisionBody, SignedDecision } from './decisions.js'
import type { SampleEntry, SampleRequest } from './sampling.js'

export type ReviewDecision = 'UPHELD' | 'OVERTURNED'

export interface Review {
  reviewer_id: string
  /** ISO-8601 UTC, set from the ledger's clock. */
  decided_at: string
  decision: ReviewDecision
  note?: string
}

export interface LedgerRecord {
  /** The full proof object, with its `ledger` field populated (tenant, retention, reviewer). */
  verdict: Verdict
  tenant_id: string
  recorded_at: string
  retention_until: string
  review?: Review
}

export interface LedgerQuery {
  tenant_id?: string
  outcome?: Outcome
  /** true = only reviewed records; false = only un-reviewed; undefined = all. */
  reviewed?: boolean
  /** ISO-8601 UTC lower bound on recorded_at (inclusive). */
  since?: string
}

export interface LedgerStats {
  total: number
  by_outcome: Record<Outcome, number>
  reviewed: number
  upheld: number
  overturned: number
  /** overturned / reviewed — the real-world disagreement rate. 0 when nothing has been reviewed. */
  overturn_rate: number
}

/** How much of the book a content check re-hashes (F5b). */
export interface ContentCheckOptions {
  /** Re-hash every event, ignoring what this process verified before. */
  full?: boolean
}

export interface Ledger {
  /**
   * Record (or overwrite) a verdict. Stamps recorded_at + retention and populates the verdict's `ledger` field.
   * THE DOOR: only a well-formed VERDICT enters (`assertVerdict`); COUNSEL, a judgement-tier finding, an unbound id or an
   * unevidenced finding throws ChannelViolation and appends nothing.
   */
  record(verdict: Verdict, opts: { tenant_id: string; retention_days?: number }): LedgerRecord
  /**
   * The record of a verdict: that tenant's, or (no tenant given) the tenant that recorded the id most recently. Records are
   * keyed by (tenant, verdict_id): the same document verified by two tenants is two records, and a review never crosses them.
   */
  get(verdict_id: string, tenant_id?: string): LedgerRecord | undefined
  /**
   * A human's agree/disagree decision on a recorded verdict (that tenant's record, or the latest owner's). Sets decided_at
   * from the clock; the REVIEW event names the tenant. Throws if the verdict isn't recorded.
   */
  review(verdict_id: string, review: Omit<Review, 'decided_at'>, opts?: { tenant_id?: string }): LedgerRecord
  query(q?: LedgerQuery): LedgerRecord[]
  stats(tenant_id?: string): LedgerStats
  /** All records, in insertion order. */
  all(): LedgerRecord[]
  /** Newline-delimited JSON of every record (for export / a file-backed store). */
  toJSONL(): string

  // ---- tamper-evident hash chain (see ./chain.ts) ----
  /** The append-only event log: one immutable event per record + per review, each linked to the prior by hash. */
  events(): LedgerEvent[]
  /** The current head hash — the single value to anchor externally (signed witness checkpoints: ../anchor/checkpoint.ts). */
  chainHead(): string
  /** Structural integrity: sequence, prev_hash linkage, and entry_hash recomputation. Cheap; the everyday check. */
  verifyChain(): ChainCheck
  /**
   * Content integrity: also recomputes every stored payload_hash (catching a tampered verdict body, not just a broken link),
   * holds each event header to its hashed payload, and re-verifies every decision's shape, id and signature (and anchoring,
   * when the ledger was given trusted keys).
   *
   * F5b: after a content check, the ledger remembers what it verified, so a later check re-hashes only the events appended
   * since (the result's `reused` says "verified through seq N at T"). `{ full: true }` re-hashes everything; a ledger reopened
   * from disk (or from a chain export) always does, on its first check.
   */
  verifyContent(opts?: ContentCheckOptions): ChainCheck
  /**
   * Newline-delimited JSON of each event WITH its original payload — the exportable, independently-verifiable audit log.
   * ONE string: past a JavaScript string's ceiling (about 40k verdicts) it throws ChainExportTooLarge, naming the streaming
   * paths (`snapshot()`, `writeChainJSONL`, `writeChainFile`), which produce the same bytes. `maxChars` sets a lower cap.
   */
  chainJSONL(opts?: { maxChars?: number }): string
  /**
   * F2: the chain as it stands, by reference, with no string in between: the events and their verbatim payloads (the shape
   * `parseChainJSONL` returns). Point-in-time: later appends do not show in it. The arrays are the caller's (editing them
   * never changes the book); the events are the ledger's own frozen objects; the payload objects are the ledger's own and
   * must not be mutated.
   */
  snapshot(): ChainSnapshot

  // ---- a person's decisions (see ./decisions.ts) ----
  /**
   * Append a person's signed decision (GRANT / DECLINE / POLICY_REVISION; KEY_REGISTER / KEY_REVOKE; CANARY_SEAL /
   * CANARY_REVEAL). THE DOOR: the book itself verifies (nothing is decided on a broken book); well-formed, id derives,
   * signature verifies; the signer is anchored (the registry's role for the kind once it is in force, else trusted keys);
   * key events are authorized by the registry root or a registered key_admin; and it does not contradict the book (a decline
   * answers a proposal under the grant in force; a policy version names one body; a reveal reproduces its seal). Throws
   * DecisionRefused otherwise and appends nothing. A GRANT is the only way a rung moves.
   */
  decide<D extends BookDecision = Decision>(signed: SignedDecision<D>): DecisionEntry<D>
  /** The decisions on the chain, in order (as appended or reopened). `decisionBook()` re-verifies them. */
  decisions(): DecisionEntry[]
  /**
   * Verify the whole book (verifyContent) and read its decisions, signed reviews and committed samples. Pass trusted_keys
   * (a static map) or root_keys (the registry on the book) to anchor signers on read; the ledger's own anchors are the default.
   */
  decisionBook(opts?: AnchorOptions & ContentCheckOptions): DecisionBook

  // ---- evidence integrity (./sampling.ts, ./registry.ts, surveillance/) ----
  /**
   * A person's review as a SIGNED decision (makeReview + signDecision): the REVIEW event carries the signature, so an agent
   * cannot manufacture the evidence a rung rests on. THE DOOR: the signature verifies, the signer is anchored (the registry's
   * `reviewer` role once it is in force, or trusted_keys), and the verdict is recorded. Throws DecisionRefused otherwise and
   * appends nothing. decided_at is the ledger clock; signed_at is the reviewer's claim.
   */
  reviewSigned(signed: SignedDecision<ReviewDecisionBody>): LedgerRecord
  /**
   * Commit the random review queue of one CLOSED calendar period (./sampling.ts). The draw is re-derived from the chain (the
   * seed is the period's last entry_hash), so the committer chooses nothing but the rates, and a reader re-draws at the
   * policy's own rates anyway. Throws SampleRefused for an open or empty period, a bad rate, or a draw already committed.
   */
  commitSample(req: SampleRequest): SampleEntry
}
