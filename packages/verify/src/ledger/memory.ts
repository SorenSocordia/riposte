/**
 * Reference in-memory Ledger. Deterministic given an injected clock. A production store (Postgres, DynamoDB, an
 * append-only log) implements the same `Ledger` interface; nothing else in the product changes.
 */

import type { Outcome, Verdict } from '../verdict/schema.js'
import { GENESIS, linkEvent, verifyChain, verifyChainAgainst, type ChainCheck, type LedgerEvent, type LedgerEventType } from './chain.js'
import type { Ledger, LedgerQuery, LedgerRecord, LedgerStats, Review } from './types.js'

const DEFAULT_RETENTION_DAYS = 2555 // ~7 years — a common financial/legal record-retention floor.

function emptyOutcomes(): Record<Outcome, number> {
  return { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }
}

export class MemoryLedger implements Ledger {
  private readonly records = new Map<string, LedgerRecord>()
  private readonly now: () => Date
  /** Append-only event log + a parallel array of each event's original payload (immutable across overwrites). */
  private readonly chain: LedgerEvent[] = []
  private readonly chainPayloads: unknown[] = []

  private readonly onAppend?: (event: LedgerEvent, payload: unknown) => void

  constructor(opts: { now?: () => Date; seed?: { events: LedgerEvent[]; payloads: unknown[] }; onAppend?: (event: LedgerEvent, payload: unknown) => void } = {}) {
    this.now = opts.now ?? (() => new Date())
    this.onAppend = opts.onAppend
    if (opts.seed) this.hydrate(opts.seed.events, opts.seed.payloads)
  }

  /**
   * Restore state from a previously-exported chain (see `chainJSONL`) WITHOUT re-hashing — the events carry their verbatim
   * hashes, so a reopened ledger has the identical head and passes verifyContent(). Records are rebuilt by replaying the
   * payloads; no new events are appended.
   */
  private hydrate(events: LedgerEvent[], payloads: unknown[]): void {
    for (let i = 0; i < events.length; i++) {
      this.chain.push(events[i]!)
      this.chainPayloads.push(payloads[i])
      const p = payloads[i] as { type: LedgerEventType; tenant_id?: string; recorded_at?: string; retention_until?: string; verdict?: Verdict; verdict_id?: string; review?: Review }
      if (p.type === 'RECORD' && p.verdict) {
        this.records.set(p.verdict.verdict_id, { verdict: p.verdict, tenant_id: p.tenant_id!, recorded_at: p.recorded_at!, retention_until: p.retention_until! })
      } else if (p.type === 'REVIEW' && p.verdict_id && p.review) {
        const rec = this.records.get(p.verdict_id)
        if (rec) this.records.set(p.verdict_id, { ...rec, review: p.review, verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(p.review) } } })
      }
    }
  }

  /** Append one event, linking it to the current head. The payload is retained verbatim for content verification/export. */
  private append(type: LedgerEventType, verdict_id: string, payload: unknown, ts: string): LedgerEvent {
    const seq = this.chain.length
    const prev = seq === 0 ? GENESIS : this.chain[seq - 1]!.entry_hash
    const ev = linkEvent(seq, prev, { ts, type, verdict_id, payload })
    this.chain.push(ev)
    this.chainPayloads.push(payload)
    this.onAppend?.(ev, payload)
    return ev
  }

  record(verdict: Verdict, opts: { tenant_id: string; retention_days?: number }): LedgerRecord {
    const recordedAt = this.now()
    const retentionDays = opts.retention_days ?? DEFAULT_RETENTION_DAYS
    const retention_until = new Date(recordedAt.getTime() + retentionDays * 86400_000).toISOString()
    const recorded_at = recordedAt.toISOString()
    const existing = this.records.get(verdict.verdict_id)
    const stored: Verdict = {
      ...verdict,
      ledger: { tenant_id: opts.tenant_id, retention_until, ...(existing?.review ? { reviewer: this.reviewerOf(existing.review) } : {}) },
    }
    const rec: LedgerRecord = { verdict: stored, tenant_id: opts.tenant_id, recorded_at, retention_until, ...(existing?.review ? { review: existing.review } : {}) }
    this.records.set(verdict.verdict_id, rec)
    this.append('RECORD', verdict.verdict_id, { type: 'RECORD', tenant_id: opts.tenant_id, recorded_at, retention_until, verdict: stored }, recorded_at)
    return rec
  }

  get(verdict_id: string): LedgerRecord | undefined {
    return this.records.get(verdict_id)
  }

  review(verdict_id: string, review: Omit<Review, 'decided_at'>): LedgerRecord {
    const rec = this.records.get(verdict_id)
    if (!rec) throw new Error(`cannot review verdict ${verdict_id}: not recorded`)
    const full: Review = { ...review, decided_at: this.now().toISOString() }
    const updated: LedgerRecord = {
      ...rec,
      review: full,
      verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(full) } },
    }
    this.records.set(verdict_id, updated)
    this.append('REVIEW', verdict_id, { type: 'REVIEW', verdict_id, review: full }, full.decided_at)
    return updated
  }

  private reviewerOf(r: Review): { id: string; decided_at: string; decision: 'UPHELD' | 'OVERTURNED'; note?: string } {
    return { id: r.reviewer_id, decided_at: r.decided_at, decision: r.decision, ...(r.note !== undefined ? { note: r.note } : {}) }
  }

  query(q: LedgerQuery = {}): LedgerRecord[] {
    return this.all().filter(r => {
      if (q.tenant_id !== undefined && r.tenant_id !== q.tenant_id) return false
      if (q.outcome !== undefined && r.verdict.outcome !== q.outcome) return false
      if (q.reviewed === true && !r.review) return false
      if (q.reviewed === false && r.review) return false
      if (q.since !== undefined && r.recorded_at < q.since) return false
      return true
    })
  }

  stats(tenant_id?: string): LedgerStats {
    const rows = tenant_id === undefined ? this.all() : this.query({ tenant_id })
    const by_outcome = emptyOutcomes()
    let reviewed = 0, upheld = 0, overturned = 0
    for (const r of rows) {
      by_outcome[r.verdict.outcome]++
      if (r.review) {
        reviewed++
        if (r.review.decision === 'OVERTURNED') overturned++
        else upheld++
      }
    }
    return { total: rows.length, by_outcome, reviewed, upheld, overturned, overturn_rate: reviewed === 0 ? 0 : overturned / reviewed }
  }

  all(): LedgerRecord[] {
    return [...this.records.values()]
  }

  toJSONL(): string {
    return this.all().map(r => JSON.stringify(r)).join('\n')
  }

  // ---- tamper-evident hash chain ----

  events(): LedgerEvent[] {
    return this.chain.map(e => ({ ...e }))
  }

  chainHead(): string {
    return this.chain.length === 0 ? GENESIS : this.chain[this.chain.length - 1]!.entry_hash
  }

  verifyChain(): ChainCheck {
    return verifyChain(this.chain)
  }

  verifyContent(): ChainCheck {
    return verifyChainAgainst(this.chain, ev => this.chainPayloads[ev.seq])
  }

  chainJSONL(): string {
    return this.chain.map((e, i) => JSON.stringify({ ...e, payload: this.chainPayloads[i] })).join('\n')
  }
}
