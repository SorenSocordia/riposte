/**
 * Reference in-memory Ledger. Deterministic given an injected clock. A production store (Postgres, DynamoDB, an
 * append-only log) implements the same `Ledger` interface; nothing else in the product changes.
 *
 * SCALE (ledger-scale lane, 2026-09-28). Measured before: a book stopped working at about 40k verdicts, because every
 * whole-book read went through ONE string, and every read re-hashed the whole book. Now:
 *   F2   `snapshot()` hands out the chain by reference (point-in-time arrays of the ledger's own objects), with no string
 *        in between; `chainJSONL()` stays for small books and throws ChainExportTooLarge (named) past one string's ceiling.
 *   F5b  after a content check, the verified prefix is remembered (chain.ts certifyPrefix), so a later check re-hashes only
 *        the events appended since, and says so (`check.reused`: "verified through seq N at T"). A check of an unchanged
 *        book returns the same verified read. `{ full: true }` re-hashes everything; a reopened ledger always does, first.
 *   F5c  the door's decision list, the key registry and the committed-sample keys are kept incrementally (indexed once per
 *        appended event), instead of re-walking and cloning the chain on every decide / reviewSigned / commitSample.
 * THE TRUST F5b ADDS, stated: between checks, the process's own memory. The chain arrays are private at runtime (#), the
 * events are frozen, and an event or payload handed in as a different object is re-hashed; a payload object mutated IN
 * PLACE after it was verified is not seen until a full check.
 *
 * DISK (ledger-disk, 2026-09-28): the heap held every payload (~22 KB per verdict), so memory was the ceiling (≈270k verdicts
 * in a 6 GB heap). Given a DiskPayloads store (openFileLedger(path, { payloads: 'disk' })), every RECORD payload stays in the
 * book's file and is read back on demand (./disk.ts); the heap keeps the events and, per record, a compact index entry (where
 * its verdict is, tenant, times, outcome, review). `get` / `all` / `query` hand out records whose `verdict` is read when it is
 * read; `stats` reads the index alone. Every result, head and byte is the heap mode's.
 * P-G: the book reader (decisions.ts) is kept and fed only the events appended since the last read, so an incremental check
 * costs O(new events) in both modes; `{ full: true }` and every reopen read the whole book.
 * P-J: a disk-mode record also carries how to read its calibration facts from the store's index (`recordFacts(rec)`, disk.ts),
 * so a calibration over the whole book reads no verdict it does not need.
 */

import { constants as bufferConstants } from 'node:buffer'
import type { Outcome, Verdict } from '../verdict/schema.js'
import { assertVerdict } from '../verdict/channel.js'
import {
  GENESIS, certifyPrefix, forgetPrefix, linkEvent, prefixOf, verifyChain,
  type ChainCheck, type ChainSnapshot, type LedgerEvent, type LedgerEventType,
} from './chain.js'
import { canonicalize, hashOf } from '../verdict/canonical.js'
import {
  DecisionRefused, authorizeSigner, decisionConflict, decisionEventType, decisionSubject, decisionTenant, dropBookReaders, isBookDecisionKind, isDecisionKind, keepBookReaders, readDecisionBook,
  shareBookReaders, verifySignature,
  type AnchorOptions, type BookDecision, type Decision, type DecisionBook, type DecisionEntry, type DecisionPayload, type ReviewDecisionBody, type SignedDecision, type TrustedKeys,
} from './decisions.js'
import { KeyRegistry, type RootKeys } from './registry.js'
import { SampleRefused, deriveSample, sampleKey, sampleSubject, type SampleBody, type SampleEntry, type SamplePayload, type SampleRequest } from './sampling.js'
import type { ContentCheckOptions, Ledger, LedgerQuery, LedgerRecord, LedgerStats, Review } from './types.js'
import { DiskPayloads, LedgerFileChanged, RECORD_FACTS, type LineRef, type VerdictFacts } from './disk.js'

const DEFAULT_RETENTION_DAYS = 2555 // ~7 years — a common financial/legal record-retention floor.

/** The longest string this runtime can build (V8 on 64-bit: 2^29 − 24 characters). A one-string chain export stops here. */
export const CHAIN_EXPORT_MAX_CHARS: number = bufferConstants.MAX_STRING_LENGTH

/** Thrown by `chainJSONL()` when the export would not fit in one string: it names the streaming paths (same bytes). */
export class ChainExportTooLarge extends Error {
  /** Events on the book. */
  readonly events: number
  /** The event at which the export passed the limit. */
  readonly at: number
  /** The character limit it passed. */
  readonly limit: number
  constructor(events: number, at: number, limit: number) {
    super(
      `the chain export does not fit in one string: the book has ${events} events and the export passes ${limit} characters at event ${at}. ` +
      'Stream it instead (the same bytes): writeChainJSONL(ledger, stream) or writeChainFile(ledger, path); or read the chain by reference with ledger.snapshot()',
    )
    this.name = 'ChainExportTooLarge'
    this.events = events
    this.at = at
    this.limit = limit
  }
}

function emptyOutcomes(): Record<Outcome, number> {
  return { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }
}

/** A record's identity: (tenant, verdict id). The same document verified by two tenants gives one verdict id and TWO records. */
const rk = (tenant_id: string, verdict_id: string): string => `${tenant_id}\u0000${verdict_id}`

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Where a ledger keeps its payloads: the heap (the default), or a DiskPayloads store (./disk.ts). */
interface PayloadStore {
  readonly length: number
  /** Event i's payload. */
  at(i: number): unknown
  /** Keep the next event's payload (the file ledger says where its line is, for a payload that stays on disk; P-J: the event lends its id and time). */
  push(payload: unknown, line?: LineRef, event?: LedgerEvent): void
  /** The ledger's own payloads as the array its readers take (heap: the array itself; disk: a live view). */
  readonly own: unknown[]
  /** Forget anything cached (a full check reads the store afresh). */
  forget?(): void
}

class HeapPayloads implements PayloadStore {
  readonly own: unknown[] = []
  get length(): number { return this.own.length }
  at(i: number): unknown { return this.own[i] }
  push(payload: unknown): void { this.own.push(payload) }
}

/** Where a disk-mode record keeps its index entry: a non-enumerable symbol slot (never in JSON, a spread or a structured clone). */
const SLIM = Symbol('ledger.record-index')

/**
 * A record whose verdict stays on disk: what the index keeps instead of the verdict. The verdict is rebuilt, when read, exactly
 * as the heap mode holds it: the RECORD payload's verdict, its `ledger` field restamped from the review it carried, and from a
 * later REVIEW.
 */
interface Slim {
  /** Position of the RECORD event (its payload holds the verdict). */
  at: number
  tenant_id: string
  recorded_at: string
  retention_until: string
  outcome: Outcome
  /** The review in force (LedgerRecord.review). */
  review?: Review
  /** The review the RECORD carried from the same tenant's earlier record (a re-RECORD keeps the earlier review). */
  carried?: Review
  /** A REVIEW followed the RECORD: the verdict's `ledger` names `review`. */
  after?: true
  /** Whether the payload's verdict is the record's own (its `ledger` hashes as the at-record field): learned on first read. */
  own?: boolean
}

export class MemoryLedger implements Ledger {
  /**
   * Records keyed by (tenant, verdict_id). F-A (opinion lane, 2026-09-28): keyed by verdict id alone, a second tenant's
   * RECORD of the same verdict id inherited the first tenant's review, wrote that reviewer and note into its own payload on
   * the chain, and replaced the first tenant's record. A review now never crosses tenants.
   */
  private readonly records = new Map<string, LedgerRecord>()
  /** Disk mode: the records' index entries (the verdicts stay in the book's file). */
  readonly #slims = new Map<string, Slim>()
  readonly #disk: boolean
  readonly #tenants = new Map<string, string>()
  /** Disk mode: the one getter / setter every handed-out record shares (no closure per record: ~100 B a record, not ~470). */
  readonly #verdictAccessor: PropertyDescriptor
  /** P-J: a handed-out record's facts from the store's index, while its verdict is still the one the ledger hands out. */
  readonly #factsOf: (rec: object) => VerdictFacts | undefined
  /** verdict id → the tenant that recorded it most recently (what `get(id)` and an untargeted `review(id)` address). */
  private readonly latestOwner = new Map<string, string>()
  /** Every verdict id recorded (the door's `recorded` set for a canary reveal), kept as records are appended. */
  readonly #recorded = new Set<string>()
  private readonly now: () => Date
  /**
   * Append-only event log (each event frozen) + a parallel array of each event's original payload (immutable across
   * overwrites). Private at runtime (#): the verified prefix (F5b) relies on nothing outside this class replacing an element.
   */
  readonly #chain: LedgerEvent[] = []
  readonly #payloads: PayloadStore

  private readonly onAppend?: (event: LedgerEvent, payload: unknown) => LineRef | void
  /** signer_id → anchored public key(s). When set, only a decision signed by the signer's anchored key passes the door. */
  private readonly trustedKeys?: TrustedKeys
  /** The registry's root key(s). When set, the key registry on the book anchors every signer once it is in force (registry.ts). */
  private readonly rootKeys?: RootKeys

  /** F5b: the last verified read under the ledger's own anchors, and the chain it was read at. */
  #bookCache?: { length: number; head: string; book: DecisionBook }
  /** F5c: the door's decision list (as the chain holds them: no `via`), the key registry and committed sample keys, indexed up to #indexed. */
  readonly #doorList: DecisionEntry<BookDecision>[] = []
  readonly #registry: KeyRegistry
  readonly #sampleKeys = new Map<string, number>()
  #indexed = 0

  /**
   * `onAppend` persists each event before it joins the in-memory book (the file ledger writes its line there): when it
   * throws, nothing is appended and no record changes, so memory never runs ahead of the store. With `payloads` (a DiskPayloads
   * store, from openFileLedger's disk mode), `onAppend` returns where a RECORD's line was written, and `replay` streams the
   * existing book in (event, payload, line) instead of a `seed`.
   */
  constructor(opts: {
    now?: () => Date; seed?: { events: LedgerEvent[]; payloads: unknown[] }; onAppend?: (event: LedgerEvent, payload: unknown) => LineRef | void; trusted_keys?: TrustedKeys; root_keys?: RootKeys
    payloads?: DiskPayloads; replay?: (feed: (event: LedgerEvent, payload: unknown, line?: LineRef) => void) => void
  } = {}) {
    this.now = opts.now ?? (() => new Date())
    this.onAppend = opts.onAppend
    this.#payloads = opts.payloads ?? new HeapPayloads()
    this.#disk = opts.payloads !== undefined
    const verdictOf = (s: Slim): Verdict => this.#verdictOf(s)
    this.#verdictAccessor = {
      get(this: { [SLIM]: Slim }): Verdict { return verdictOf(this[SLIM]) },
      set(this: object, v: Verdict): void { Object.defineProperty(this, 'verdict', { value: v, writable: true, enumerable: true, configurable: true }) },
      enumerable: true, configurable: true,
    }
    const store = opts.payloads
    const getter = this.#verdictAccessor.get
    this.#factsOf = rec => (Object.getOwnPropertyDescriptor(rec, 'verdict')?.get === getter ? store?.verdictFactsAt((rec as { [SLIM]: Slim })[SLIM].at) : undefined)
    keepBookReaders(this.#chain, this.#payloads.own)
    if (opts.trusted_keys) this.trustedKeys = opts.trusted_keys
    if (opts.root_keys && opts.root_keys.length) {
      new KeyRegistry(opts.root_keys) // refuses, at open, a root that is not an Ed25519 public key
      this.rootKeys = [...opts.root_keys]
    }
    this.#registry = new KeyRegistry(this.rootKeys)
    if (opts.seed) this.hydrate(opts.seed.events, opts.seed.payloads)
    opts.replay?.((ev, payload, line) => this.#replay(ev, payload, line))
  }

  /**
   * Restore state from a previously-exported chain (see `chainJSONL`) WITHOUT re-hashing — the events carry their verbatim
   * hashes, so a reopened ledger has the identical head and passes verifyContent(). Records are rebuilt by replaying the
   * payloads under the SAME rules the live methods apply (a re-RECORD keeps the earlier review, as record() does); no new
   * events are appended. The door is not re-applied: the past is immutable, and a chain written before the door still
   * opens (the read side — voice, opinions — excludes anything the door would now refuse). Decision events (GRANT,
   * DECLINE, POLICY_REVISION, KEY_*, CANARY_*) and SAMPLE events change no record; they live on the chain and are read (and
   * re-verified) by decisionBook(). A signed REVIEW replays exactly as an unsigned one (its `review` has the same shape).
   * Nothing here is verified: the first content check of a reopened ledger re-hashes every event (F5b).
   */
  private hydrate(events: LedgerEvent[], payloads: unknown[]): void {
    for (let i = 0; i < events.length; i++) this.#replay(events[i]!, payloads[i])
  }

  /** Replay one event of an existing book (hydrate, or the disk mode's streamed reopen): see hydrate. */
  #replay(event: LedgerEvent, payload: unknown, line?: LineRef): void {
    // The ledger keeps its own frozen copy of each event: a caller holding the seed cannot reach the book through it.
    const ev = Object.freeze({ ...event })
    const at = this.#chain.length
    this.#chain.push(ev)
    this.#payloads.push(payload, line, ev)
    const p = (payload ?? {}) as { type?: LedgerEventType; tenant_id?: string; recorded_at?: string; retention_until?: string; verdict?: Verdict; verdict_id?: string; review?: Review }
    if (p.type === 'RECORD' && p.verdict) {
      // FIX (2026-09-28): a re-RECORD of a reviewed verdict used to drop the review on reopen. record() carries it, so
      // replay must too, or a reopened ledger reports fewer reviews (and a different overturn rate) than the live one.
      // F-A: only the SAME tenant's earlier review is carried, and the record's `verdict.ledger` is rebuilt from that
      // review. A chain written before the fix may carry another tenant's reviewer in this payload: the payload stays
      // (the past is immutable, and its hash is on the chain), but the record never shows it.
      const tenant = p.tenant_id!
      const id = p.verdict.verdict_id === ev.verdict_id ? ev.verdict_id : p.verdict.verdict_id // one copy of the id in the heap
      if (this.#disk) {
        const prior = this.#slims.get(rk(tenant, id))
        this.#slims.set(rk(tenant, id), {
          at, tenant_id: this.#intern(tenant), recorded_at: p.recorded_at === ev.ts ? ev.ts : p.recorded_at!, retention_until: p.retention_until!, outcome: p.verdict.outcome,
          ...(prior?.review ? { review: prior.review, carried: prior.review } : {}),
        })
      } else {
        const prior = this.records.get(rk(tenant, id))
        const ledgerField = { tenant_id: tenant, retention_until: p.retention_until!, ...(prior?.review ? { reviewer: this.reviewerOf(prior.review) } : {}) }
        const verdict = hashOf(p.verdict.ledger ?? null) === hashOf(ledgerField) ? p.verdict : { ...p.verdict, ledger: ledgerField }
        this.records.set(rk(tenant, id), {
          verdict, tenant_id: tenant, recorded_at: p.recorded_at!, retention_until: p.retention_until!,
          ...(prior?.review ? { review: prior.review } : {}),
        })
      }
      this.latestOwner.set(id, tenant)
      this.#recorded.add(id)
    } else if (p.type === 'REVIEW' && p.verdict_id && p.review) {
      // A REVIEW names its tenant since F-A; a legacy one reviewed the verdict's latest owner (the only record there was).
      const tenant = p.tenant_id ?? this.latestOwner.get(p.verdict_id)
      if (this.#disk) {
        const s = tenant !== undefined ? this.#slims.get(rk(tenant, p.verdict_id)) : undefined
        if (s) this.#slims.set(rk(s.tenant_id, p.verdict_id), { ...s, review: p.review, after: true })
      } else {
        const rec = tenant !== undefined ? this.records.get(rk(tenant, p.verdict_id)) : undefined
        if (rec) this.records.set(rk(rec.tenant_id, p.verdict_id), { ...rec, review: p.review, verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(p.review) } } })
      }
    }
  }

  #intern(tenant: string): string {
    const known = this.#tenants.get(tenant)
    if (known !== undefined) return known
    this.#tenants.set(tenant, tenant)
    return tenant
  }

  /** Disk mode: a slim record's verdict, rebuilt exactly as the heap mode holds it (hydrate / record / review). */
  #verdictOf(s: Slim): Verdict {
    const pv = (this.#payloads.at(s.at) as { verdict: Verdict }).verdict
    const atRecord = { tenant_id: s.tenant_id, retention_until: s.retention_until, ...(s.carried ? { reviewer: this.reviewerOf(s.carried) } : {}) }
    s.own ??= hashOf(pv.ledger ?? null) === hashOf(atRecord) // the payload's bytes are fixed (digest-checked): learned once
    const v = s.own ? pv : { ...pv, ledger: atRecord }
    return s.after ? { ...v, ledger: { tenant_id: s.tenant_id, retention_until: s.retention_until, reviewer: this.reviewerOf(s.review!) } } : v
  }

  /** Disk mode: a record whose `verdict` is read from the book's file when it is read (never held by the ledger). */
  #lazy(s: Slim): LedgerRecord {
    const rec = {} as LedgerRecord
    Object.defineProperty(rec, SLIM, { value: s })
    Object.defineProperty(rec, RECORD_FACTS, { value: this.#factsOf }) // P-J: its calibration facts, without its verdict
    Object.defineProperty(rec, 'verdict', this.#verdictAccessor)
    rec.tenant_id = s.tenant_id
    rec.recorded_at = s.recorded_at
    rec.retention_until = s.retention_until
    if (s.review) rec.review = s.review
    return rec
  }

  /**
   * Append one event, linking it to the current head. The payload is retained verbatim for content verification/export.
   * The store (onAppend) is written FIRST: if it throws, the event never joins the book.
   */
  private append(type: LedgerEventType, verdict_id: string, payload: unknown, ts: string): LedgerEvent {
    const seq = this.#chain.length
    const prev = seq === 0 ? GENESIS : this.#chain[seq - 1]!.entry_hash
    const ev = Object.freeze(linkEvent(seq, prev, { ts, type, verdict_id, payload }))
    const line = this.onAppend?.(ev, payload)
    this.#chain.push(ev)
    this.#payloads.push(payload, line || undefined, ev)
    return ev
  }

  /**
   * F5c: bring the door's indexes up to the head: the decision list (each entry as the chain holds it), the key registry
   * (folded exactly as decisions.ts registryOf replays it) and the committed sample keys. O(events appended since).
   */
  #index(): void {
    for (let i = this.#indexed; i < this.#chain.length; i++) {
      const ev = this.#chain[i]!
      if (ev.type === 'SAMPLE') {
        const s = (this.#payloads.at(i) as SamplePayload | undefined)?.sample as SampleBody | undefined
        if (isObj(s) && isObj(s.period) && isObj(s.rates)) {
          const key = sampleKey(s)
          if (!this.#sampleKeys.has(key)) this.#sampleKeys.set(key, i)
        }
        continue
      }
      if (!isBookDecisionKind(ev.type)) continue // a RECORD's payload (on disk in the disk mode) is never read here
      const signed = (this.#payloads.at(i) as DecisionPayload | undefined)?.signed
      if (!signed) continue
      this.#doorList.push({ seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: ev.ts, decision_id: signed.decision_id, signed })
      const d = isObj(signed.decision) ? signed.decision : undefined
      if (this.#registry.rooted && d && (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') && !this.#registry.keyEventProblem(ev.seq, d, signed.public_key)) {
        this.#registry.apply(ev.seq, signed.decision_id, d)
      }
    }
    this.#indexed = this.#chain.length
  }

  /**
   * THE DOOR: only a well-formed VERDICT enters the book of record (`assertVerdict`: not generated, verdict-shaped,
   * replayable, bound to its inputs, every PASS/FAIL evidenced and DETERMINISTIC). COUNSEL can never be recorded as a
   * VERDICT. A refusal throws ChannelViolation and appends nothing. The stored bytes of an admitted verdict are unchanged.
   */
  record(verdict: Verdict, opts: { tenant_id: string; retention_days?: number }): LedgerRecord {
    assertVerdict(verdict)
    const recordedAt = this.now()
    const retentionDays = opts.retention_days ?? DEFAULT_RETENTION_DAYS
    const retention_until = new Date(recordedAt.getTime() + retentionDays * 86400_000).toISOString()
    const recorded_at = recordedAt.toISOString()
    const existing = this.#disk ? this.#slims.get(rk(opts.tenant_id, verdict.verdict_id)) : this.records.get(rk(opts.tenant_id, verdict.verdict_id)) // F-A: the same tenant's earlier record only
    const stored: Verdict = {
      ...verdict,
      ledger: { tenant_id: opts.tenant_id, retention_until, ...(existing?.review ? { reviewer: this.reviewerOf(existing.review) } : {}) },
    }
    const rec: LedgerRecord = { verdict: stored, tenant_id: opts.tenant_id, recorded_at, retention_until, ...(existing?.review ? { review: existing.review } : {}) }
    const ev = this.append('RECORD', verdict.verdict_id, { type: 'RECORD', tenant_id: opts.tenant_id, recorded_at, retention_until, verdict: stored }, recorded_at)
    if (this.#disk) {
      this.#slims.set(rk(opts.tenant_id, verdict.verdict_id), {
        at: ev.seq, tenant_id: this.#intern(opts.tenant_id), recorded_at: ev.ts, retention_until, outcome: verdict.outcome,
        ...(existing?.review ? { review: existing.review, carried: existing.review } : {}), own: true,
      })
    } else {
      this.records.set(rk(opts.tenant_id, verdict.verdict_id), rec)
    }
    this.latestOwner.set(verdict.verdict_id, opts.tenant_id)
    this.#recorded.add(verdict.verdict_id)
    return rec
  }

  get(verdict_id: string, tenant_id?: string): LedgerRecord | undefined {
    const tenant = tenant_id ?? this.latestOwner.get(verdict_id)
    if (tenant === undefined) return undefined
    if (!this.#disk) return this.records.get(rk(tenant, verdict_id))
    const s = this.#slims.get(rk(tenant, verdict_id))
    return s && this.#lazy(s)
  }

  review(verdict_id: string, review: Omit<Review, 'decided_at'>, opts: { tenant_id?: string } = {}): LedgerRecord {
    const rec = this.get(verdict_id, opts.tenant_id)
    if (!rec) throw new Error(`cannot review verdict ${verdict_id}${opts.tenant_id !== undefined ? ` for tenant ${opts.tenant_id}` : ''}: not recorded`)
    return this.applyReview(rec, verdict_id, { ...review, decided_at: this.now().toISOString() })
  }

  private applyReview(rec: LedgerRecord, verdict_id: string, full: Review, signed?: SignedDecision<ReviewDecisionBody>): LedgerRecord {
    if (this.#disk) {
      const key = rk(rec.tenant_id, verdict_id)
      const s = this.#slims.get(key)!
      this.append('REVIEW', verdict_id, { type: 'REVIEW', verdict_id, tenant_id: rec.tenant_id, review: full, ...(signed ? { signed } : {}) }, full.decided_at)
      const next: Slim = { ...s, review: full, after: true }
      this.#slims.set(key, next)
      return this.#lazy(next)
    }
    const updated: LedgerRecord = {
      ...rec,
      review: full,
      verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(full) } },
    }
    // The REVIEW names the tenant whose record it reviews (F-A), so a replay never attributes it to another tenant.
    this.append('REVIEW', verdict_id, { type: 'REVIEW', verdict_id, tenant_id: rec.tenant_id, review: full, ...(signed ? { signed } : {}) }, full.decided_at)
    this.records.set(rk(rec.tenant_id, verdict_id), updated)
    return updated
  }

  /** The key registry at the head (kept incrementally, F5c; the read side re-verifies it in full). */
  private registry(): KeyRegistry {
    this.#index()
    return this.#registry
  }

  /** THE DOOR for a person's signed review: verified, anchored (the `reviewer` role once the registry is in force), recorded. */
  reviewSigned(signed: SignedDecision<ReviewDecisionBody>): LedgerRecord {
    const sig = verifySignature(signed)
    if (!sig.ok) throw new DecisionRefused(sig.reason ?? 'the review does not verify')
    const clean = JSON.parse(canonicalize(signed)) as SignedDecision<ReviewDecisionBody>
    const d = clean.decision
    if (d.kind !== 'REVIEW') throw new DecisionRefused(`reviewSigned takes a signed REVIEW, not a ${String(d.kind)} (use decide)`)
    const rec = this.get(d.verdict_id, d.tenant_id)
    if (!rec) throw new DecisionRefused(`cannot review verdict ${d.verdict_id}${d.tenant_id !== undefined ? ` for tenant ${d.tenant_id}` : ''}: not recorded`)
    const auth = authorizeSigner(this.registry(), this.#chain.length, 'REVIEW', d.signer_id, clean.public_key, this.trustedKeys, rec.tenant_id)
    if (!auth.ok) throw new DecisionRefused(auth.reason ?? 'the reviewer is not anchored')
    const full: Review = { reviewer_id: d.signer_id, decision: d.decision, decided_at: this.now().toISOString(), ...(d.note !== undefined ? { note: d.note } : {}) }
    return this.applyReview(rec, d.verdict_id, full, clean)
  }

  /** THE DOOR for a random review queue: re-derived from the chain; refused when open, empty, malformed or already committed. */
  commitSample(req: SampleRequest): SampleEntry {
    const body = deriveSample(this.#chain, this.#payloads.own, req)
    if ('problem' in body) throw new SampleRefused(body.problem)
    const key = sampleKey(body)
    this.#index()
    const prior = this.#sampleKeys.get(key)
    if (prior !== undefined) throw new SampleRefused(`this draw is already committed (seq ${prior}): one queue per workflow, period and rates`)
    const recorded_at = this.now().toISOString()
    const payload: SamplePayload = { type: 'SAMPLE', recorded_at, sample: body }
    const ev = this.append('SAMPLE', sampleSubject(body), payload, recorded_at)
    return { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at, sample: structuredClone(body) }
  }

  private reviewerOf(r: Review): { id: string; decided_at: string; decision: 'UPHELD' | 'OVERTURNED'; note?: string } {
    return { id: r.reviewer_id, decided_at: r.decided_at, decision: r.decision, ...(r.note !== undefined ? { note: r.note } : {}) }
  }

  query(q: LedgerQuery = {}): LedgerRecord[] {
    if (this.#disk) {
      // The index answers every filter; only the matching records are handed out (their verdicts read when read).
      const out: LedgerRecord[] = []
      for (const s of this.#slims.values()) {
        if (q.tenant_id !== undefined && s.tenant_id !== q.tenant_id) continue
        if (q.outcome !== undefined && s.outcome !== q.outcome) continue
        if (q.reviewed === true && !s.review) continue
        if (q.reviewed === false && s.review) continue
        if (q.since !== undefined && s.recorded_at < q.since) continue
        out.push(this.#lazy(s))
      }
      return out
    }
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
    const by_outcome = emptyOutcomes()
    let reviewed = 0, upheld = 0, overturned = 0
    if (this.#disk) {
      let total = 0
      for (const s of this.#slims.values()) {
        if (tenant_id !== undefined && s.tenant_id !== tenant_id) continue
        total++
        by_outcome[s.outcome]++
        if (s.review) {
          reviewed++
          if (s.review.decision === 'OVERTURNED') overturned++
          else upheld++
        }
      }
      return { total, by_outcome, reviewed, upheld, overturned, overturn_rate: reviewed === 0 ? 0 : overturned / reviewed }
    }
    const rows = tenant_id === undefined ? this.all() : this.query({ tenant_id })
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
    if (this.#disk) return Array.from(this.#slims.values(), s => this.#lazy(s))
    return [...this.records.values()]
  }

  toJSONL(): string {
    return this.all().map(r => JSON.stringify(r)).join('\n')
  }

  // ---- tamper-evident hash chain ----

  events(): LedgerEvent[] {
    return this.#chain.map(e => ({ ...e }))
  }

  chainHead(): string {
    return this.#chain.length === 0 ? GENESIS : this.#chain[this.#chain.length - 1]!.entry_hash
  }

  verifyChain(): ChainCheck {
    return verifyChain(this.#chain)
  }

  /**
   * Payload hashes, event headers against their hashed payloads, and every decision re-verified (readDecisionBook). After a
   * check, only the events appended since are re-hashed (F5b; the result's `reused` says so); `{ full: true }` re-hashes all.
   */
  verifyContent(opts: ContentCheckOptions = {}): ChainCheck {
    return this.decisionBook(opts.full ? { full: true } : {}).check
  }

  /**
   * The chain as ONE string (lines joined by '\n', no final newline). Past `maxChars` (default: the runtime's string ceiling)
   * it throws ChainExportTooLarge instead of a RangeError, naming the streaming paths that write the same bytes.
   */
  chainJSONL(opts: { maxChars?: number } = {}): string {
    const limit = Math.min(opts.maxChars ?? CHAIN_EXPORT_MAX_CHARS, CHAIN_EXPORT_MAX_CHARS)
    const n = this.#chain.length
    const lines = new Array<string>(n)
    let chars = 0
    for (let i = 0; i < n; i++) {
      const line = JSON.stringify({ ...this.#chain[i]!, payload: this.#payloads.at(i) })
      chars += line.length + (i > 0 ? 1 : 0)
      if (chars > limit) throw new ChainExportTooLarge(n, i, limit)
      lines[i] = line
    }
    return lines.join('\n')
  }

  /**
   * F2: the chain as it stands now, by reference: fresh arrays (the caller may edit its copy; the book never changes) holding
   * the ledger's own event objects (frozen) and payload objects (not to be mutated). When this ledger has verified a prefix,
   * the snapshot carries that certificate (chain.ts), so a reader of it (readDecisionBook, openSnapshot) re-hashes only what
   * came after; a copy edited at any verified position is re-hashed in full.
   */
  snapshot(): ChainSnapshot {
    const events = this.#chain.slice()
    // Disk mode: a point-in-time view of the store (payloads read on demand), not a copy of every payload.
    const payloads = this.#disk ? (this.#payloads as DiskPayloads).view(events.length) : this.#payloads.own.slice()
    const p = prefixOf(this.#chain)
    if (p) certifyPrefix(events, p)
    shareBookReaders(this.#chain, events) // P-G: a reader of the snapshot resumes from this ledger's book reader
    return { events, payloads }
  }

  // ---- a person's decisions (./decisions.ts) ----

  /**
   * THE DOOR for decisions: verified; anchored (the registry's role once it is in force, else trusted keys, else unanchored);
   * key events authorized by the root or a key_admin; consistent with the book; else refused, appending nothing.
   */
  decide<D extends BookDecision = Decision>(signed: SignedDecision<D>): DecisionEntry<D> {
    const sig = verifySignature(signed)
    if (!sig.ok) throw new DecisionRefused(sig.reason ?? 'the decision does not verify')
    // Stored as a normalized copy: later mutation of the caller's object cannot reach the book, and the signature (over the
    // canonical body) still verifies.
    const clean = JSON.parse(canonicalize(signed)) as SignedDecision<BookDecision>
    const d = clean.decision
    if (!isBookDecisionKind(d.kind)) throw new DecisionRefused(`a ${String(d.kind)} is not a decision event: append a signed review with reviewSigned`)
    // N5 (CLI lane, 2026-09-28): nothing is decided on a book that does not verify. Every caller gets the refusal, not
    // only the ones that dry-run first. (F5b: re-hashes only what was appended since the last check.)
    const whole = this.decisionBook()
    if (!whole.ok) {
      const at = whole.check.brokenAt !== undefined ? ` at event ${whole.check.brokenAt}` : ''
      throw new DecisionRefused(`the book does not verify${at} (${whole.check.reason ?? 'unknown'}): nothing is decided on a broken book`)
    }
    const seq = this.#chain.length
    const reg = this.registry()
    if (d.kind === 'KEY_REGISTER' || d.kind === 'KEY_REVOKE') {
      const kp = reg.keyEventProblem(seq, d, clean.public_key)
      if (kp) throw new DecisionRefused(kp)
    } else {
      const auth = authorizeSigner(reg, seq, d.kind, d.signer_id, clean.public_key, this.trustedKeys, decisionTenant(d))
      if (!auth.ok) throw new DecisionRefused(auth.reason ?? 'the signer is not anchored')
    }
    // P1 (security-fix, D-ANCHOR): on an anchored ledger a decline is checked against the ANCHORED grant in force, what every
    // reader's proposal is made under, so the door reads the verified entries (they carry `via`). `whole` is the check above
    // (F5b: cached or incremental), so this costs no further walk of the book. DECISION P1-SCOPE (ledger-scale; fork: here):
    // with no anchors at all nothing on the book has effect for any reader, and the door checks the book AS WRITTEN (its own
    // list, no `via`), so an unanchored copy still takes a well-formed decision as a signature.
    const anchored = this.trustedKeys !== undefined || this.rootKeys !== undefined
    // D-DUAL (governance-2): the signing key goes in too, so a co-signature's key checks (two ids on one key) run at the door.
    const conflict = decisionConflict(d, anchored ? [...whole.decisions, ...whole.canaries, ...whole.cosigns] as DecisionEntry<BookDecision>[] : this.#doorList, this.#recorded, clean.public_key)
    if (conflict) throw new DecisionRefused(conflict)
    const recorded_at = this.now().toISOString()
    // D-DUAL-EVENT (governance-2): every decision rides in its own event type, except a GRANT_COSIGN, which rides in a GRANT
    // event (no new chain event type); its signed decision says GRANT_COSIGN.
    const type = decisionEventType(clean.decision.kind)
    const payload: DecisionPayload = { type, recorded_at, signed: clean }
    const ev = this.append(type, decisionSubject(clean.decision), payload, recorded_at)
    return { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at, decision_id: clean.decision_id, signed: structuredClone(clean) } as DecisionEntry<BookDecision> as DecisionEntry<D>
  }

  decisions(): DecisionEntry[] {
    this.#index()
    const out: DecisionEntry[] = []
    for (const e of this.#doorList) {
      if (!isDecisionKind(e.signed.decision.kind)) continue // a GRANT_COSIGN rides in a GRANT event but is not a rung decision
      out.push({ ...e, signed: structuredClone(e.signed) as SignedDecision<Decision> })
    }
    return out
  }

  /**
   * Verify the book and read it (readDecisionBook). F5b: under the ledger's own anchors, an unchanged book returns its last
   * verified read (its check's `reused` covers every event); otherwise only the events appended since the last verified read
   * are re-hashed. `full: true` forgets what was verified and re-hashes everything. Explicit anchors read afresh (the hash
   * layer still reuses the verified prefix: anchors do not change a hash).
   */
  decisionBook(opts: AnchorOptions & ContentCheckOptions = {}): DecisionBook {
    const explicit = opts.trusted_keys !== undefined || opts.root_keys !== undefined
    const trusted_keys = opts.trusted_keys ?? this.trustedKeys
    const root_keys = opts.root_keys ?? this.rootKeys
    if (opts.full) {
      forgetPrefix(this.#chain)
      dropBookReaders(this.#chain)
      this.#payloads.forget?.()
      this.#bookCache = undefined
    }
    const length = this.#chain.length
    const head = this.chainHead()
    const hit = explicit ? undefined : this.#bookCache
    if (hit && hit.length === length && hit.head === head) return structuredClone(hit.book)
    let book: DecisionBook
    try {
      book = readDecisionBook(this.#chain, this.#payloads.own, { ...(trusted_keys ? { trusted_keys } : {}), ...(root_keys ? { root_keys } : {}) })
    } catch (e) {
      // Disk mode: a line changed on disk since it was read. The book this process holds is not the file's: it does not verify.
      if (!(e instanceof LedgerFileChanged)) throw e
      forgetPrefix(this.#chain)
      this.#bookCache = undefined
      return { ok: false, check: { ok: false, length, head, brokenAt: e.seq, reason: e.message }, decisions: [], keys: [], canaries: [], cosigns: [], unanchored: [], samples: [], signed_reviews: [] }
    }
    if (book.ok && length > 0) {
      // Wall-clock time, not the ledger clock: a read must not advance an injected clock (every later timestamp would move).
      const verified_at = new Date().toISOString()
      certifyPrefix(this.#chain, { through: length, head, verified_at, events: this.#chain, payloads: this.#payloads.own })
      if (!explicit) this.#bookCache = { length, head, book: structuredClone({ ...book, check: { ...book.check, reused: { through: length, verified_at } } }) }
    }
    return book
  }
}
