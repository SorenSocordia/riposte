/**
 * Payloads on disk (ledger-disk, 2026-09-28): the store behind `openFileLedger(path, { payloads: 'disk' })`.
 *
 * Measured before: a book held every verdict in the heap (~22 KB per verdict), so a 6 GB heap stopped at ≈270k verdicts, and
 * a mid-size AP department's year (~1M) did not fit. Here the heap holds the events and a compact index, and every RECORD
 * payload (the verdict, the only big one) stays in the book's own file: this store remembers where its line is (offset,
 * length) and the sha256 of the line's bytes as they were read or written, and reads it back on demand. Every other payload
 * (reviews, decisions, samples: small and few) stays in the heap. The file format does not change.
 *
 * THE TRUST, stated: every payload served is the one whose bytes this process read at open (or wrote on append). A line read
 * back from the file is checked against the sha256 of those bytes, and a line changed on disk since throws LedgerFileChanged
 * (named) instead of being served: the book a reader sees is the book this process opened, as in the heap mode. Bytes still in
 * the read-ahead window or the small parsed cache are served as read (they are those bytes); a full check (`{ full: true }`)
 * drops both and reads the file. A payload object handed out and then mutated in place stays mutated only while it sits in the
 * parsed cache (the heap mode's stated boundary, narrower).
 *
 * Readers take the payloads as an array: `view()` is an Array (a Proxy over one) whose elements are read on demand. It answers
 * PAYLOAD_VIEW (chain.ts) with its store, so a verified prefix certified over the store needs no per-payload identity check.
 * Walking it reads each payload once; holding every element of it (`slice()`, `Array.from`) reads the whole book into the heap,
 * which is what this mode exists to avoid. A view cannot be structuredClone'd (a Proxy); copy the elements you need.
 *
 * P-J (2026-09-29): THE CALIBRATION FACTS. The readers that calibrate over a whole book (voice.ts workflowCalibrations, the
 * sampling frame, the report) read a handful of facts per verdict, but a read back costs a JSON.parse of the whole line (~150 µs
 * for 12.9 KB). So the index also keeps each RECORD's facts, learned when its payload is parsed at open (or written): the
 * verdict id, tenant, recorded_at, retention_until, outcome, ruleset id and version, engine version, and whether the verdict is
 * VERDICT evidence. Records sharing tenant, outcome, ruleset, engine and evidence mark share one interned class, so a record
 * costs ~28 B. `recordFacts(rec)` and `recordFactsAt(payloads, i)` hand them out as stubs with the verdict's and the payload's
 * own field names, so a reader takes `recordFacts(rec) ?? rec.verdict` (or `recordFactsAt(payloads, i) ?? payloads[i]`) and
 * reads the same values in either mode; a book in the heap answers undefined (its verdicts are in memory). A reader still reads
 * the full verdict where a person's review is involved. The facts are the bytes this process read (the digest's trust), and a
 * RECORD whose facts are not plain values has none: its readers read it in full.
 */

import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import { PAYLOAD_VIEW, payloadViewOf, type PayloadViewInfo } from './chain.js'
import type { Outcome } from '../verdict/schema.js'
import { channelOf } from '../verdict/channel.js'

/** A line of the book that changed on disk after this process read (or wrote) it: never served, never silently re-read. */
export class LedgerFileChanged extends Error {
  readonly path: string
  /** The event whose line changed. */
  readonly seq: number
  /** Where its line starts. */
  readonly offset: number
  constructor(path: string, seq: number, offset: number, why: string) {
    super(
      `the book at ${path} changed on disk after this process read it: the line of event seq ${seq} (byte ${offset}) ${why}. ` +
      'A book of record is append-only. Reopen it to check what the file holds now (the first check of a reopened book re-hashes every event), and treat the file as tampered until you know why.',
    )
    this.name = 'LedgerFileChanged'
    this.path = path
    this.seq = seq
    this.offset = offset
  }
}

/** Where one event's line lives in the book file, and the sha256 of its bytes (no newline) as read or written. */
export interface LineRef {
  offset: number
  length: number
  digest: Buffer
}

/** The payloads that stay on disk: a RECORD's (the verdict). Everything else is small and stays in the heap. */
export const onDiskPayload = (p: unknown): boolean =>
  p !== null && typeof p === 'object' && !Array.isArray(p) && (p as { type?: unknown }).type === 'RECORD'

/** sha256 of a line's bytes. */
export const lineDigest = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest()

const WINDOW = 4 << 20
/** A read within this distance past the last one is sequential: read a window ahead instead of one line. */
const SEQUENTIAL_GAP = 64 << 10

/** A position in an array, from a property key ("0", "17"; not "01", "1.5", "-1"). */
function arrayIndex(k: string | symbol): number | undefined {
  if (typeof k !== 'string' || k.length === 0 || k.length > 15) return undefined
  const c0 = k.charCodeAt(0)
  if (c0 < 48 || c0 > 57 || (c0 === 48 && k.length > 1)) return undefined
  for (let j = 1; j < k.length; j++) {
    const c = k.charCodeAt(j)
    if (c < 48 || c > 57) return undefined
  }
  return Number(k)
}

const HOLE = Symbol('deleted')

// ── P-J: the calibration facts, kept in the index ──────────────────────────────────────────────────────────────────────

/** Whether a verdict is VERDICT evidence, or why not: generated material (COUNSEL) or judgement-tier findings (REASONED). */
export type EvidenceMark = 'VERDICT' | 'COUNSEL' | 'REASONED'

/** Where a facts stub keeps its evidence mark: a key no verdict has. */
const MARK = Symbol('ledger.evidence-mark')

/**
 * Whether a verdict is VERDICT evidence (the calibration and the sampling frame share this): generated material never is, nor
 * is a verdict carrying a judgement-tier (REASONED) PASS or FAIL. A facts stub answers from the mark its index learned.
 */
export function evidenceMark(v: unknown): EvidenceMark {
  const known = v !== null && typeof v === 'object' ? (v as { [MARK]?: EvidenceMark })[MARK] : undefined
  if (known !== undefined) return known
  if (channelOf(v) === 'COUNSEL') return 'COUNSEL'
  const claims = (v as { claims?: { tier?: string; outcome?: string }[] } | undefined)?.claims
  return Array.isArray(claims) && claims.some(c => c && c.tier === 'REASONED' && (c.outcome === 'PASS' || c.outcome === 'FAIL')) ? 'REASONED' : 'VERDICT'
}

/**
 * P-J: a verdict as a calibration reads it, without the verdict: a stub with the verdict's own field names (and its evidence
 * mark, read by evidenceMark). It carries these fields only; anything else is read from the verdict.
 */
export interface VerdictFacts {
  readonly verdict_id: string
  readonly outcome: Outcome
  readonly ruleset: { readonly id: string; readonly version: string }
  readonly engine_version: string
}

/** P-J: a RECORD payload as a calibration reads it: a stub with the payload's own field names. */
export interface RecordFacts {
  readonly type: 'RECORD'
  readonly tenant_id: string
  readonly recorded_at: string
  readonly retention_until: string
  readonly verdict: VerdictFacts
}

/** What records sharing tenant, outcome, ruleset, engine and evidence mark have in common (interned: a few per book). */
interface FactClass {
  readonly tenant_id: string
  readonly outcome: Outcome
  readonly ruleset: { readonly id: string; readonly version: string }
  readonly engine_version: string
  readonly mark: EvidenceMark
}

const OUTCOMES: ReadonlySet<unknown> = new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA'])

const verdictStub = (c: FactClass, verdict_id: string): VerdictFacts =>
  ({ verdict_id, outcome: c.outcome, ruleset: c.ruleset, engine_version: c.engine_version, [MARK]: c.mark }) as VerdictFacts

/**
 * Where a record handed out by a store keeps how to read its facts without its verdict: a function of the record, in a
 * non-enumerable slot (never in JSON, a spread or a structured clone). It answers undefined once the record's verdict is not
 * the one the store hands out (a caller replaced it).
 */
export const RECORD_FACTS: unique symbol = Symbol('riposte.ledger.record-facts')

/**
 * P-J: a record's verdict as a calibration reads it, from the index of the store that handed the record out (a disk-backed
 * book: no read of the file). Undefined otherwise: a book in the heap holds the verdict, so read it. Readers take
 * `recordFacts(rec) ?? rec.verdict` and read the same values in either mode.
 */
export function recordFacts(rec: unknown): VerdictFacts | undefined {
  const f = rec !== null && typeof rec === 'object' ? (rec as { [RECORD_FACTS]?: unknown })[RECORD_FACTS] : undefined
  return typeof f === 'function' ? (f as (r: object) => VerdictFacts | undefined)(rec as object) : undefined
}

/**
 * P-J: event i's RECORD payload as a calibration reads it, from a disk-backed book's index: no read of the file. Undefined for a
 * book in the heap (its payload is in memory: read it), a position past the view or edited by its holder, and a payload that
 * is not a RECORD or whose facts are not plain values. Readers take `recordFactsAt(payloads, i) ?? payloads[i]`.
 */
export function recordFactsAt(payloads: readonly unknown[], i: number): RecordFacts | undefined {
  const info = payloadViewOf(payloads)
  return info && info.store instanceof DiskPayloads && i < info.pristine && i < payloads.length ? info.store.factsAt(i) : undefined
}

export class DiskPayloads {
  readonly path: string
  #n = 0
  #off = new Float64Array(1024)
  /** Line length; 0: the payload is in the heap (#resident). */
  #len = new Uint32Array(1024)
  #digest = Buffer.alloc(1024 * 32)
  readonly #resident = new Map<number, unknown>()
  readonly #cache = new Map<number, unknown>()
  readonly #cacheMax: number
  #fd: number | undefined
  #win = Buffer.alloc(0)
  #winStart = 0
  #winEnd = 0
  /** The ledger's own payloads: a live view (its length follows the book). */
  readonly own: unknown[]
  /** Lines read back from disk (cache misses). */
  reads = 0
  /** P-J: each position's fact class (0: none: not a RECORD, or one read in full), and a RECORD's own strings (shared, not copied). */
  #cls = new Uint32Array(1024)
  readonly #classes: FactClass[] = []
  readonly #classKeys = new Map<string, number>()
  readonly #ids: (string | undefined)[] = []
  readonly #recordedAt: (string | undefined)[] = []
  readonly #retention: (string | undefined)[] = []

  constructor(path: string, opts: { cache?: number } = {}) {
    this.path = path
    this.#cacheMax = Math.max(1, opts.cache ?? 256)
    this.own = this.view()
  }

  get length(): number {
    return this.#n
  }

  /**
   * Keep the next event's payload: on disk at `line` (a RECORD's), or in the heap. A RECORD's calibration facts are learned here
   * (P-J), from the payload as parsed at open or as written; `event` lends its verdict id and time, so neither is held twice.
   */
  push(payload: unknown, line?: LineRef, event?: { verdict_id: string; ts: string }): void {
    if (this.#n === this.#len.length) {
      const cap = this.#n * 2
      const off = new Float64Array(cap); off.set(this.#off); this.#off = off
      const len = new Uint32Array(cap); len.set(this.#len); this.#len = len
      const dig = Buffer.alloc(cap * 32); this.#digest.copy(dig); this.#digest = dig
      const cls = new Uint32Array(cap); cls.set(this.#cls); this.#cls = cls
    }
    const i = this.#n++
    const onDisk = line !== undefined && line.length > 0
    if (onDisk) {
      this.#off[i] = line.offset
      this.#len[i] = line.length
      line.digest.copy(this.#digest, i * 32)
    } else {
      this.#len[i] = 0
      this.#resident.set(i, payload)
    }
    this.#learn(i, onDisk ? payload : undefined, event)
  }

  /** P-J: a RECORD's calibration facts, when every one is a plain value (else none: its readers read it in full). */
  #learn(i: number, payload: unknown, event?: { verdict_id: string; ts: string }): void {
    const p = payload as { type?: unknown; tenant_id?: unknown; recorded_at?: unknown; retention_until?: unknown; verdict?: unknown } | null | undefined
    const v = (p !== null && typeof p === 'object' ? p.verdict : undefined) as { verdict_id?: unknown; outcome?: unknown; ruleset?: unknown; engine_version?: unknown } | null | undefined
    const r = (v !== null && typeof v === 'object' ? v.ruleset : undefined) as { id?: unknown; version?: unknown } | null | undefined
    if (
      !p || p.type !== 'RECORD' || typeof p.tenant_id !== 'string' || typeof p.recorded_at !== 'string' || typeof p.retention_until !== 'string'
      || !v || Array.isArray(v) || typeof v.verdict_id !== 'string' || !OUTCOMES.has(v.outcome) || typeof v.engine_version !== 'string'
      || !r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.version !== 'string'
    ) {
      this.#cls[i] = 0
      this.#ids[i] = this.#recordedAt[i] = this.#retention[i] = undefined
      return
    }
    const mark = evidenceMark(v)
    const key = JSON.stringify([p.tenant_id, v.outcome, r.id, r.version, v.engine_version, mark])
    let k = this.#classKeys.get(key)
    if (k === undefined) {
      this.#classes.push(Object.freeze({ tenant_id: p.tenant_id, outcome: v.outcome as Outcome, ruleset: Object.freeze({ id: r.id, version: r.version }), engine_version: v.engine_version, mark }))
      k = this.#classes.length
      this.#classKeys.set(key, k)
    }
    this.#cls[i] = k
    this.#ids[i] = event && event.verdict_id === v.verdict_id ? event.verdict_id : v.verdict_id
    this.#recordedAt[i] = event && event.ts === p.recorded_at ? event.ts : p.recorded_at
    this.#retention[i] = p.retention_until
  }

  /** P-J: event i's RECORD payload as a calibration reads it, from the index (no read of the file); undefined when it has none. */
  factsAt(i: number): RecordFacts | undefined {
    const k = i >= 0 && i < this.#n ? this.#cls[i]! : 0
    if (k === 0) return undefined
    const c = this.#classes[k - 1]!
    return { type: 'RECORD', tenant_id: c.tenant_id, recorded_at: this.#recordedAt[i]!, retention_until: this.#retention[i]!, verdict: verdictStub(c, this.#ids[i]!) }
  }

  /** P-J: event i's verdict as a calibration reads it, from the index; undefined when it has none. */
  verdictFactsAt(i: number): VerdictFacts | undefined {
    const k = i >= 0 && i < this.#n ? this.#cls[i]! : 0
    return k === 0 ? undefined : verdictStub(this.#classes[k - 1]!, this.#ids[i]!)
  }

  /** Event i's payload: from the heap, the read cache, or its line (checked against its digest, then parsed). */
  at(i: number): unknown {
    if (!(i >= 0 && i < this.#n)) return undefined
    if (this.#len[i] === 0) return this.#resident.get(i)
    const hit = this.#cache.get(i)
    if (hit !== undefined) {
      this.#cache.delete(i)
      this.#cache.set(i, hit)
      return hit
    }
    const p = this.#load(i)
    this.#cache.set(i, p)
    if (this.#cache.size > this.#cacheMax) this.#cache.delete(this.#cache.keys().next().value as number)
    return p
  }

  /** Forget the read cache and the read-ahead window: the next read of every payload comes from the file (a full check). */
  forget(): void {
    this.#cache.clear()
    this.#winStart = this.#winEnd = 0
  }

  /** Release the read handle (the next read opens it again). Idempotent. */
  close(): void {
    if (this.#fd === undefined) return
    const fd = this.#fd
    this.#fd = undefined
    this.#winStart = this.#winEnd = 0
    closeSync(fd)
  }

  #load(i: number): unknown {
    const offset = this.#off[i]!
    const length = this.#len[i]!
    const bytes = this.#bytes(i, offset, length)
    if (lineDigest(bytes).compare(this.#digest, i * 32, i * 32 + 32) !== 0) throw new LedgerFileChanged(this.path, i, offset, 'no longer holds the bytes it held')
    this.reads++
    return (JSON.parse(bytes.toString('utf8').trim()) as { payload?: unknown }).payload
  }

  /** The bytes of one line: from the read-ahead window, else read (a window ahead when the reads run in order). */
  #bytes(i: number, offset: number, length: number): Buffer {
    if (offset >= this.#winStart && offset + length <= this.#winEnd) return this.#win.subarray(offset - this.#winStart, offset - this.#winStart + length)
    const sequential = this.#winEnd > 0 && offset >= this.#winEnd && offset - this.#winEnd <= SEQUENTIAL_GAP
    const size = sequential ? Math.max(length, WINDOW) : length
    if (this.#win.length < size) this.#win = Buffer.allocUnsafe(size)
    this.#fd ??= openSync(this.path, 'r')
    let got = 0
    while (got < size) {
      const n = readSync(this.#fd, this.#win, got, size - got, offset + got)
      if (n <= 0) break
      got += n
    }
    this.#winStart = offset
    this.#winEnd = offset + got
    if (got < length) {
      this.#winStart = this.#winEnd = 0
      throw new LedgerFileChanged(this.path, i, offset, 'is cut short (the file is shorter than when it was read)')
    }
    return this.#win.subarray(0, length)
  }

  /**
   * An array of payloads 0 … length−1 read on demand (no argument: the live book). The holder may edit its copy (set, delete,
   * push, a shorter length): edits stay in the view, never reach the book, and mark it touched from that position (PAYLOAD_VIEW).
   */
  view(length?: number): unknown[] {
    const edits = new Map<number, unknown>()
    let len = length
    const size = (): number => len ?? this.#n
    const info: PayloadViewInfo = { store: this, pristine: Infinity }
    const touch = (i: number): void => { if (i < info.pristine) info.pristine = i }
    const read = (i: number): unknown => {
      if (i >= size()) return undefined
      if (edits.has(i)) {
        const v = edits.get(i)
        return v === HOLE ? undefined : v
      }
      return this.at(i)
    }
    const present = (i: number): boolean => i < size() && edits.get(i) !== HOLE
    return new Proxy<unknown[]>([], {
      get(t, k, r) {
        if (k === PAYLOAD_VIEW) return info
        if (k === 'length') return size()
        const i = arrayIndex(k)
        return i === undefined ? Reflect.get(t, k, r) : read(i)
      },
      set(t, k, v) {
        if (k === 'length') {
          const n = Number(v)
          if (!Number.isInteger(n) || n < 0) throw new RangeError('Invalid array length')
          if (n < size()) touch(n)
          for (const j of [...edits.keys()]) if (j >= n) edits.delete(j)
          len = n
          return true
        }
        const i = arrayIndex(k)
        if (i === undefined) return Reflect.set(t, k, v)
        touch(i)
        edits.set(i, v)
        if (i >= size()) len = i + 1
        return true
      },
      deleteProperty(t, k) {
        const i = arrayIndex(k)
        if (i === undefined) return Reflect.deleteProperty(t, k)
        if (i < size()) {
          touch(i)
          edits.set(i, HOLE)
        }
        return true
      },
      has(t, k) {
        if (k === 'length') return true
        const i = arrayIndex(k)
        return i === undefined ? Reflect.has(t, k) : present(i)
      },
      getOwnPropertyDescriptor(t, k) {
        if (k === 'length') return { value: size(), writable: true, enumerable: false, configurable: false }
        const i = arrayIndex(k)
        if (i === undefined) return Reflect.getOwnPropertyDescriptor(t, k)
        return present(i) ? { value: read(i), writable: true, enumerable: true, configurable: true } : undefined
      },
      defineProperty(t, k, d) {
        const i = arrayIndex(k)
        if (i === undefined || k === 'length') return Reflect.defineProperty(t, k, d)
        touch(i)
        edits.set(i, d.value)
        if (i >= size()) len = i + 1
        return true
      },
      ownKeys() {
        const keys: string[] = []
        for (let i = 0, n = size(); i < n; i++) if (present(i)) keys.push(String(i))
        keys.push('length')
        return keys
      },
    })
  }
}
