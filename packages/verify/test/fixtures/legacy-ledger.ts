/**
 * A ledger written BEFORE the door (assertVerdict at ledger.record, 2026-09-28). The door now refuses COUNSEL and
 * judgement-tier findings, but a chain written before it still opens (the past is immutable), so the read side (voice
 * calibration, opinions) must still exclude them. This helper appends a raw RECORD (and optional REVIEW) straight onto a
 * copy of the chain, exactly as a pre-door ledger would have written it, and reopens it: the only way such an item can
 * reach a book today.
 */
import { MemoryLedger } from '../../src/ledger/memory'
import { parseChainJSONL } from '../../src/ledger/file'
import { GENESIS, linkEvent, type LedgerEvent, type LedgerEventType } from '../../src/ledger/chain'
import type { Ledger, Review } from '../../src/ledger/types'

export function withLegacyRecord(
  ledger: Ledger,
  item: unknown,
  o: { tenant_id: string; at?: string; review?: Omit<Review, 'decided_at'>; now?: () => Date },
): Ledger {
  const { events, payloads } = parseChainJSONL(ledger.chainJSONL())
  const at = o.at ?? '2026-09-27T00:00:00.000Z'
  const push = (type: LedgerEventType, verdict_id: string, payload: unknown): void => {
    const seq = events.length
    const prev = seq === 0 ? GENESIS : (events[seq - 1] as LedgerEvent).entry_hash
    events.push(linkEvent(seq, prev, { ts: at, type, verdict_id, payload }))
    payloads.push(payload)
  }
  const id = (item as { verdict_id: string }).verdict_id
  const retention_until = new Date(Date.parse(at) + 2555 * 86400_000).toISOString()
  push('RECORD', id, { type: 'RECORD', tenant_id: o.tenant_id, recorded_at: at, retention_until, verdict: { ...(item as object), ledger: { tenant_id: o.tenant_id, retention_until } } })
  if (o.review) push('REVIEW', id, { type: 'REVIEW', verdict_id: id, review: { ...o.review, decided_at: at } })
  return new MemoryLedger({ seed: { events, payloads }, ...(o.now ? { now: o.now } : {}) })
}
