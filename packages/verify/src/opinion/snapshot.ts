/**
 * A read-only view of the book of record for an opinion. The opinion does not take records on trust: given the chain
 * (events + their verbatim payloads, i.e. `ledger.chainJSONL()` or a file ledger), it verifies the WHOLE book with the
 * ledger's own reader (`readDecisionBook`: every link and payload re-hashed, every event header held to its hashed payload,
 * every signed decision re-verified) and REBUILDS the records from it, so every record the opinion cites is provably the
 * ledger's. Records supplied without a chain are usable, but every premise resting on them is marked unverified.
 *
 * THE TENANT SCOPE (2026-09-28): on a hosted book shared by several tenants, `openSnapshot(s, { scope })` still verifies
 * the whole chain (its hashes cover every tenant) but keeps only the tenant's own records and decisions. A REVIEW event is
 * attributed to the tenant that owned the verdict when it was reviewed (the tenant of the latest RECORD before it), so a
 * verdict id two tenants both recorded never carries one tenant's review into the other's view. Every opinion built on a
 * scoped view (precedent, evidence, counter-cases, the grant it cites) is the tenant's by construction.
 *
 * ANCHORING (D-ANCHOR, 2026-09-28): only an anchored signer's decision has effect, so the view reads the book with anchors.
 * Pass `trusted_keys` / `root_keys`, or take the snapshot in-process with `snapshotOfLedger(ledger)`: its events carry the
 * ledger's OWN read (its own trusted keys or root key), held off the object (a WeakMap on the events array), so no JSON body
 * can claim it. Explicit anchors, when given, win.
 */

import { payloadViewOf, verifyChain, type ChainCheck, type LedgerEvent } from '../ledger/chain.js'
import { RECORD_FACTS, recordFactsAt, type VerdictFacts } from '../ledger/disk.js'
import { carryOwnRead, isAnchored, readDecisionBook, type DecisionEntry, type TrustedKeys } from '../ledger/decisions.js'
import { parseChainJSONL } from '../ledger/file.js'
import type { RootKeys } from '../ledger/registry.js'
import type { Ledger, LedgerRecord, Review } from '../ledger/types.js'
import type { Verdict } from '../verdict/schema.js'
import type { OpinionRef, OpinionScope } from './types.js'

export interface LedgerSnapshot {
  /** The append-only events (ledger.events() or a chain export). */
  events?: LedgerEvent[]
  /** The verbatim payloads, parallel to events. With them the chain's CONTENT is verified and records are rebuilt from it. */
  payloads?: unknown[]
  /** Records, for when no chain is at hand. Ignored when payloads are supplied. Premises resting on them are unverified. */
  records?: LedgerRecord[]
}

export interface SnapshotOptions {
  /** Read only one tenant's records and decisions (a shared, multi-tenant book). The chain is still verified whole. */
  scope?: OpinionScope
  /** Anchor decision signers to people on read (signer_id → public key). A decision signed by another key fails the book. */
  trusted_keys?: TrustedKeys
  /** The registry's root key(s): the key registry on the book anchors every signer once it is in force (ledger/registry.ts). */
  root_keys?: RootKeys
}

export interface SnapshotView {
  /** The records the opinion may cite: every record on the book, or the scoped tenant's only. */
  records: LedgerRecord[]
  /** 'chain' = rebuilt from a content-verified chain; 'records' = supplied as-is (not verifiable). */
  source: 'chain' | 'records'
  /** The chain check that ran (the whole book when payloads were supplied, structural when only events were), or null. */
  chain: ChainCheck | null
  /** True only when the whole book was re-verified (payloads, headers, signed decisions) and is intact. */
  content_verified: boolean
  /**
   * The signed decisions the opinion may cite (GRANT / DECLINE / POLICY_REVISION), in chain order; the scoped tenant's only.
   * Empty unless verified. Each carries `via`: only anchored ones have effect (D-ANCHOR).
   */
  decisions: DecisionEntry[]
  /** Signers of those decisions whose key is not anchored to a person, sorted: their decisions have no effect. */
  unanchored: string[]
  /** The tenant scope, when the view is scoped. */
  scope?: { tenant_id: string }
  /** Does this workflow belong to the view? (Always true when unscoped.) */
  ownsWorkflow(workflow_id: string): boolean
  /** The latest RECORD and REVIEW event for a verdict (in scope). */
  eventsFor(verdict_id: string): { record?: LedgerEvent; review?: LedgerEvent }
  /** A verdict reference carrying its ledger events (when known). */
  refOf(verdict_id: string): OpinionRef
}

/**
 * Snapshot a live ledger through its own exportable chain (events + payloads). The exported events carry the ledger's OWN
 * read of them (its trusted keys or root key; ledger/decisions.ts carryOwnRead), so every reader of this snapshot honors
 * exactly the decisions the ledger itself honors (D-ANCHOR), unless it is handed anchors of its own.
 */
export function snapshotOfLedger(ledger: Ledger): LedgerSnapshot {
  // P-A (ledger-scale): the chain by reference, not one exported string (no string ceiling at scale); the snapshot carries
  // the ledger's verified prefix, so openSnapshot re-hashes only the tail.
  const s = ledger.snapshot()
  carryOwnRead(s.events, ledger.decisionBook())
  return s
}

/** Snapshot a chain export (`ledger.chainJSONL()` / a file ledger's contents). */
export function snapshotFromChainJSONL(text: string): LedgerSnapshot {
  return parseChainJSONL(text)
}

/** The default ownership rule: the default workflow keyer names workflows `<tenant_id>/<ruleset>@<version>`. */
export function defaultOwnsWorkflow(tenant_id: string): (workflow_id: string) => boolean {
  return (workflow_id: string) => workflow_id.startsWith(`${tenant_id}/`)
}

const reviewerOf = (r: Review): NonNullable<NonNullable<Verdict['ledger']>['reviewer']> =>
  ({ id: r.reviewer_id, decided_at: r.decided_at, decision: r.decision, ...(r.note !== undefined ? { note: r.note } : {}) })

interface Rebuilt { records: LedgerRecord[]; lastRecord: Map<string, LedgerEvent>; lastReview: Map<string, LedgerEvent> }

/**
 * P-I (ledger-disk): what a rebuilt record keeps instead of its verdict when the payloads are read on demand (a disk-backed
 * book): where the verdict is, and how the rebuild restamps its `ledger` (the scope's carried review; the last REVIEW, which
 * replaces `ledger` whole, so only the last one matters). Held in a non-enumerable symbol slot: never in JSON, a spread or a
 * structured clone.
 */
interface HeldVerdict {
  payloads: readonly unknown[]
  at: number
  scoped: boolean
  carried?: Review
  reviewed?: { tenant_id: string; retention_until: string; review: Review }
}
const HELD = Symbol('opinion.held-verdict')

/** The one getter every held record shares (no closure per record): the verdict exactly as the plain rebuild holds it. */
function heldVerdict(this: { [HELD]: HeldVerdict }): Verdict {
  const h = this[HELD]
  const v = (h.payloads[h.at] as { verdict: Verdict }).verdict
  const atRecord = h.scoped && v.ledger
    ? { ...v, ledger: { tenant_id: v.ledger.tenant_id, retention_until: v.ledger.retention_until, ...(h.carried ? { reviewer: reviewerOf(h.carried) } : {}) } }
    : v
  return h.reviewed ? { ...atRecord, ledger: { tenant_id: h.reviewed.tenant_id, retention_until: h.reviewed.retention_until, reviewer: reviewerOf(h.reviewed.review) } } : atRecord
}
function setVerdict(this: object, v: Verdict): void {
  Object.defineProperty(this, 'verdict', { value: v, writable: true, enumerable: true, configurable: true })
}
/** P-J: a held record's calibration facts from the store's index (no read of the file), while its verdict is the held one. */
function heldFacts(rec: object): VerdictFacts | undefined {
  if (Object.getOwnPropertyDescriptor(rec, 'verdict')?.get !== heldVerdict) return undefined
  const h = (rec as { [HELD]: HeldVerdict })[HELD]
  return recordFactsAt(h.payloads, h.at)?.verdict
}

/** A record whose verdict is read when it is read: the same value, keys and key order as the plain record. */
function heldRecord(held: HeldVerdict, rest: Omit<LedgerRecord, 'verdict'>): LedgerRecord {
  const rec = {} as LedgerRecord
  Object.defineProperty(rec, HELD, { value: held })
  Object.defineProperty(rec, RECORD_FACTS, { value: heldFacts })
  Object.defineProperty(rec, 'verdict', { get: heldVerdict, set: setVerdict, enumerable: true, configurable: true })
  return Object.assign(rec, rest)
}

/**
 * Rebuild records by replaying the chain's payloads, under the live ledger's own rules: a re-RECORD keeps the earlier
 * review, and a REVIEW refreshes `verdict.ledger.reviewer` (as MemoryLedger.review and hydrate do).
 *
 * With a tenant, only that tenant's stream is replayed: its RECORDs, and the REVIEWs made while it owned the verdict (the
 * owner is the tenant of the latest RECORD of that verdict id before the REVIEW). A re-RECORD keeps only the tenant's OWN
 * earlier review. The live ledger keys records by verdict id alone, so there a re-RECORD by another tenant inherits the
 * first tenant's review (and writes that reviewer, note included, into its RECORD payload's verdict.ledger); a scoped view
 * never does: its verdict.ledger.reviewer is rebuilt from the tenant's own review.
 */
function rebuild(events: readonly LedgerEvent[], payloads: readonly unknown[], tenant?: string): Rebuilt {
  // P-I (ledger-disk): a disk-backed book's payloads are read on demand (a payload view). Its records hold each verdict by
  // position, read when read, so rebuilding a large book never pulls every verdict into the heap. Plain arrays: unchanged.
  const lazy = payloadViewOf(payloads) !== undefined
  const recs = new Map<string, LedgerRecord>()
  const owner = new Map<string, string>()
  const lastRecord = new Map<string, LedgerEvent>()
  const lastReview = new Map<string, LedgerEvent>()
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    // P-J: a disk-backed book's RECORD is read from its index (the facts the rebuild reads, same names): no parse.
    const p = (recordFactsAt(payloads, i) ?? payloads[i]) as { type?: string; tenant_id?: string; recorded_at?: string; retention_until?: string; verdict?: Verdict; verdict_id?: string; review?: Review }
    if (!p || typeof p !== 'object') continue
    if (p.type === 'RECORD' && p.verdict) {
      const id = p.verdict.verdict_id
      const t = p.tenant_id ?? ''
      owner.set(id, t)
      if (tenant !== undefined && t !== tenant) continue
      const prior = recs.get(id)
      if (lazy) {
        const carried = prior?.review
        recs.set(id, heldRecord(
          { payloads, at: i, scoped: tenant !== undefined, ...(carried ? { carried } : {}) },
          { tenant_id: t, recorded_at: p.recorded_at ?? '', retention_until: p.retention_until ?? '', ...(carried ? { review: carried } : {}) },
        ))
        lastRecord.set(id, ev)
        continue
      }
      // Scoped: the live ledger stamps a re-RECORD with the reviewer it inherited, even another tenant's (and their note).
      // The tenant's view carries only the tenant's own reviewer.
      const verdict = tenant !== undefined && p.verdict.ledger
        ? { ...p.verdict, ledger: { tenant_id: p.verdict.ledger.tenant_id, retention_until: p.verdict.ledger.retention_until, ...(prior?.review ? { reviewer: reviewerOf(prior.review) } : {}) } }
        : p.verdict
      recs.set(id, {
        verdict, tenant_id: t, recorded_at: p.recorded_at ?? '', retention_until: p.retention_until ?? '',
        ...(prior?.review ? { review: prior.review } : {}),
      })
      lastRecord.set(id, ev)
    } else if (p.type === 'REVIEW' && p.verdict_id && p.review) {
      if (tenant !== undefined && owner.get(p.verdict_id) !== tenant) continue
      const rec = recs.get(p.verdict_id)
      if (!rec) continue
      const held = lazy ? (rec as unknown as { [HELD]?: HeldVerdict })[HELD] : undefined
      if (held) {
        const reviewed = { tenant_id: rec.tenant_id, retention_until: rec.retention_until, review: p.review }
        recs.set(p.verdict_id, heldRecord({ ...held, reviewed }, { tenant_id: rec.tenant_id, recorded_at: rec.recorded_at, retention_until: rec.retention_until, review: p.review }))
        lastReview.set(p.verdict_id, ev)
        continue
      }
      recs.set(p.verdict_id, {
        ...rec,
        review: p.review,
        verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: reviewerOf(p.review) } },
      })
      lastReview.set(p.verdict_id, ev)
    }
  }
  return { records: [...recs.values()], lastRecord, lastReview }
}

export function openSnapshot(s: LedgerSnapshot, opts: SnapshotOptions = {}): SnapshotView {
  const events = s.events ?? []
  const tenant = opts.scope?.tenant_id
  const owns = opts.scope ? (opts.scope.owns_workflow ?? defaultOwnsWorkflow(opts.scope.tenant_id)) : () => true
  let chain: ChainCheck | null = null
  let content_verified = false
  let records: LedgerRecord[]
  let source: SnapshotView['source']
  let decisions: DecisionEntry[] = []
  let lastRecord = new Map<string, LedgerEvent>()
  let lastReview = new Map<string, LedgerEvent>()
  if (s.events && s.payloads && s.payloads.length === events.length) {
    const book = readDecisionBook(events, s.payloads, { ...(opts.trusted_keys ? { trusted_keys: opts.trusted_keys } : {}), ...(opts.root_keys?.length ? { root_keys: opts.root_keys } : {}) })
    chain = book.check
    content_verified = book.ok
    const r = rebuild(events, s.payloads, tenant)
    records = r.records
    lastRecord = r.lastRecord
    lastReview = r.lastReview
    source = 'chain'
    // A POLICY_REVISION is the deployment's (the policy every tenant is assessed under); GRANT and DECLINE are a workflow's.
    decisions = book.decisions.filter(e => e.signed.decision.kind === 'POLICY_REVISION' || owns(e.signed.decision.workflow_id))
  } else {
    if (s.events) chain = verifyChain(events)
    records = (s.records ?? []).filter(r => tenant === undefined || r.tenant_id === tenant)
    source = 'records'
    const ids = new Set(records.map(r => r.verdict.verdict_id))
    for (const ev of events) {
      if (!ids.has(ev.verdict_id)) continue
      if (ev.type === 'RECORD') lastRecord.set(ev.verdict_id, ev)
      else if (ev.type === 'REVIEW') lastReview.set(ev.verdict_id, ev)
    }
  }
  const unanchored = [...new Set(decisions.filter(e => !isAnchored(e)).map(e => e.signed.decision.signer_id))].sort()
  const eventsFor = (id: string): { record?: LedgerEvent; review?: LedgerEvent } => {
    const record = lastRecord.get(id), review = lastReview.get(id)
    return { ...(record ? { record } : {}), ...(review ? { review } : {}) }
  }
  const refOf = (id: string): OpinionRef => {
    const { record, review } = eventsFor(id)
    return {
      kind: 'verdict',
      verdict_id: id,
      ...(record ? { record_event: { seq: record.seq, entry_hash: record.entry_hash } } : {}),
      ...(review ? { review_event: { seq: review.seq, entry_hash: review.entry_hash } } : {}),
    }
  }
  return {
    records, source, chain, content_verified, decisions, unanchored,
    ...(tenant !== undefined ? { scope: { tenant_id: tenant } } : {}),
    ownsWorkflow: owns, eventsFor, refOf,
  }
}
