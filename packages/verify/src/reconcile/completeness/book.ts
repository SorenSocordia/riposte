/**
 * The book side of a completeness reconciliation: the chain is verified WHOLE with the ledger's own reader
 * (`readDecisionBook`: every link and payload re-hashed, every event header held to its payload, every signed decision
 * re-verified) before a single record is read, and nothing is reconciled against a book that does not verify.
 *
 * Records are rebuilt from the chain under the live ledger's rules: keyed by (tenant, verdict id) (F-A), a re-RECORD keeps
 * the same tenant's earlier review, and a REVIEW names its tenant (a legacy REVIEW without one reviews the latest owner).
 * Every RECORD position is kept, because the rung that governs a verdict is the GRANT in force when it was recorded.
 */

import { parseChainJSONL } from '../../ledger/file.js'
import { readDecisionBook, decisionTenant, type AnchorOptions, type DecisionEntry } from '../../ledger/decisions.js'
import type { LedgerEvent } from '../../ledger/chain.js'
import type { Ledger, Review } from '../../ledger/types.js'
import type { Verdict } from '../../verdict/schema.js'
import { proofProblem } from '../../verdict/channel.js'
import { CompletenessRefused } from './types.js'

/** A chain export: the events and their verbatim payloads (`parseChainJSONL(ledger.chainJSONL())`, or a file ledger's lines). */
export interface BookChain { events: LedgerEvent[]; payloads: unknown[] }

/** The book to reconcile: a live Ledger, or a chain export. */
export type BookInput = Ledger | BookChain

export interface BookRecordView {
  tenant_id: string
  verdict_id: string
  /** The default workflow key: `<tenant>/<ruleset id>@<ruleset version>` (the key GRANTs name). */
  workflow_id: string
  verdict: Verdict
  first_record: { seq: number; entry_hash: string; recorded_at: string }
  record: { seq: number; entry_hash: string; recorded_at: string }
  /** Every RECORD of this (tenant, verdict), in chain order. */
  record_seqs: number[]
  /** The latest review, and when the first one was made. */
  review?: { decision: 'UPHELD' | 'OVERTURNED'; reviewer_id: string; decided_at: string; seq: number; first_decided_at: string }
  /** Why this record is not a VERDICT (and so never the control operating), if it is not. */
  not_verdict?: string
}

export interface BookView {
  head: string
  length: number
  unanchored: string[]
  decisions: DecisionEntry[]
  records: BookRecordView[]
  /**
   * The signers of a tenant's own signed acts: its decisions, co-signatures and canaries (by the workflow they name) and its
   * signed reviews. A report scoped to a tenant names only these among the book's unanchored signers.
   */
  signersOf(tenant_id: string): Set<string>
}

const isLedger = (b: BookInput): b is Ledger => typeof (b as Ledger).chainJSONL === 'function'

/** Read and verify the book. Throws CompletenessRefused when it does not verify. */
export function readBook(input: BookInput, anchors: AnchorOptions = {}): BookView {
  // By reference, never through the one-string export (which refuses past ~40k verdicts): LEDGER-SCALE patch P-D.
  const chain: BookChain = isLedger(input) ? (input.snapshot ? input.snapshot() : parseChainJSONL(input.chainJSONL())) : input
  if (!chain || !Array.isArray(chain.events) || !Array.isArray(chain.payloads)) {
    throw new CompletenessRefused('the book must be a Ledger or a chain export { events, payloads }')
  }
  const db = readDecisionBook(chain.events, chain.payloads, anchors)
  if (!db.ok) {
    const at = db.check.brokenAt !== undefined ? ` at event ${db.check.brokenAt}` : ''
    throw new CompletenessRefused(`the book does not verify${at} (${db.check.reason ?? 'unknown'}): nothing is reconciled against a broken book`)
  }
  const recs = new Map<string, BookRecordView>()
  const latestOwner = new Map<string, string>()
  const rk = (t: string, id: string): string => `${t}\u0000${id}`
  for (let i = 0; i < chain.events.length; i++) {
    const ev = chain.events[i]!
    const p = chain.payloads[i] as { type?: string; tenant_id?: string; recorded_at?: string; verdict?: Verdict; verdict_id?: string; review?: Review } | null
    if (!p || typeof p !== 'object') continue
    if (p.type === 'RECORD' && p.verdict && typeof p.verdict.verdict_id === 'string') {
      const tenant = String(p.tenant_id ?? '')
      const id = p.verdict.verdict_id
      const at = { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: p.recorded_at ?? ev.ts }
      const prior = recs.get(rk(tenant, id))
      const r = p.verdict.ruleset
      const workflow_id = `${tenant}/${r?.id}@${r?.version}`
      const problem = proofProblem(p.verdict)
      recs.set(rk(tenant, id), {
        tenant_id: tenant, verdict_id: id, workflow_id, verdict: p.verdict,
        first_record: prior?.first_record ?? at, record: at, record_seqs: [...(prior?.record_seqs ?? []), ev.seq],
        ...(prior?.review ? { review: prior.review } : {}),
        ...(problem ? { not_verdict: problem } : {}),
      })
      latestOwner.set(id, tenant)
    } else if (p.type === 'REVIEW' && typeof p.verdict_id === 'string' && p.review) {
      const tenant = p.tenant_id ?? latestOwner.get(p.verdict_id)
      const rec = tenant !== undefined ? recs.get(rk(tenant, p.verdict_id)) : undefined
      if (!rec) continue
      rec.review = {
        decision: p.review.decision, reviewer_id: p.review.reviewer_id, decided_at: p.review.decided_at, seq: ev.seq,
        first_decided_at: rec.review?.first_decided_at ?? p.review.decided_at,
      }
    }
  }
  const signersOf = (tenant_id: string): Set<string> => {
    const out = new Set<string>()
    for (const e of [...db.decisions, ...db.cosigns, ...db.canaries]) if (decisionTenant(e.signed.decision) === tenant_id) out.add(e.signed.decision.signer_id)
    for (const e of db.signed_reviews) if (e.tenant_id === tenant_id) out.add(e.signer_id)
    return out
  }
  return { head: db.check.head, length: db.check.length, unanchored: [...db.unanchored], decisions: db.decisions, records: [...recs.values()], signersOf }
}
