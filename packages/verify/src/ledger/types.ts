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
import type { ChainCheck, LedgerEvent } from './chain.js'

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

export interface Ledger {
  /** Record (or overwrite) a verdict. Stamps recorded_at + retention and populates the verdict's `ledger` field. */
  record(verdict: Verdict, opts: { tenant_id: string; retention_days?: number }): LedgerRecord
  get(verdict_id: string): LedgerRecord | undefined
  /** A human's agree/disagree decision on a recorded verdict. Sets decided_at from the clock. Throws if the verdict isn't recorded. */
  review(verdict_id: string, review: Omit<Review, 'decided_at'>): LedgerRecord
  query(q?: LedgerQuery): LedgerRecord[]
  stats(tenant_id?: string): LedgerStats
  /** All records, in insertion order. */
  all(): LedgerRecord[]
  /** Newline-delimited JSON of every record (for export / a file-backed store). */
  toJSONL(): string

  // ---- tamper-evident hash chain (see ./chain.ts) ----
  /** The append-only event log: one immutable event per record + per review, each linked to the prior by hash. */
  events(): LedgerEvent[]
  /** The current head hash — the single value to anchor externally (notarize / witness) to make the history provable. */
  chainHead(): string
  /** Structural integrity: sequence, prev_hash linkage, and entry_hash recomputation. Cheap; the everyday check. */
  verifyChain(): ChainCheck
  /** Content integrity: also recomputes every stored payload_hash, catching a tampered verdict body, not just a broken link. */
  verifyContent(): ChainCheck
  /** Newline-delimited JSON of each event WITH its original payload — the exportable, independently-verifiable audit log. */
  chainJSONL(): string
}
