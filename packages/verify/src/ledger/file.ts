/**
 * File-backed Ledger — the book of record persisted to disk so it survives a restart, with the tamper-evident hash chain
 * preserved verbatim across reopen. Dependency-free (node:fs only): the chain is a JSONL file, one event per line, and a
 * reopened ledger rehydrates to the identical head hash (so `verifyContent()` still passes). For a single-node deployment
 * this IS the system of record; a larger deployment swaps a DB-backed `Ledger` behind the same interface.
 *
 * SCALE (ledger-scale lane, 2026-09-28):
 *   F4b  a reopen STREAMS the file (8 MiB chunks, split on newline bytes) instead of reading it into one string, which
 *        failed past ~645 MiB (≈40k verdicts). The parse is the same as parseChainJSONL's, line for line.
 *   F4a  appends go through ONE held file descriptor (opened on the first append, `writeSync` per event, `close()` or
 *        `using` to release it) instead of opening and closing the file per event. The bytes are identical.
 *   F2   writeChainJSONL / writeChainFile stream a chain export (the same bytes as `chainJSONL()`) without one giant string.
 *
 * DURABILITY POLICY (stated, unchanged by the held fd): an event's line is handed to the operating system before `record()`
 * (or review / decide / commitSample) returns, so a crash of THIS PROCESS never loses a returned event. By default nothing
 * is fsync'ed (as appendFileSync never did): a power loss or an OS crash can lose the last events the OS had not flushed,
 * and can leave the last line torn. `fsync: true` calls fsyncSync after every event, so a returned event is on stable
 * storage (at the cost of one flush per event). Either way a torn last line never bricks the book (R5, below).
 *
 * R5 (red team, 2026-09-28): a crash mid-append leaves a partial last line. It used to make the WHOLE book unopenable.
 * Now a reopen detects it (the last non-blank line does not parse; a legitimate export whose last line merely lacks its
 * newline is not torn) and opens the book READ-ONLY: every event before the torn line reads and verifies, the torn bytes stay
 * on disk untouched, and any append throws TornTailError, which tells the operator what to do. `repairTornTail(path)` backs
 * the file up, truncates it to the last whole line, and records what it removed. An unparseable line anywhere BEFORE the
 * last is not a torn tail: it is corruption (LedgerFileCorrupt), and the book does not open.
 *
 * DISK (ledger-disk, 2026-09-28): `openFileLedger(path, { payloads: 'disk' })` keeps every RECORD payload in this file instead
 * of the heap (./disk.ts): the reopen streams the book once, keeps the events and a compact index, and remembers where each
 * verdict's line is and the sha256 of its bytes; readers read verdicts back on demand, checked against those digests. The
 * bytes on disk, the torn-tail and corruption rules and the durability policy above are exactly the heap mode's.
 */

import {
  appendFileSync, closeSync, constants as fsConstants, copyFileSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, truncateSync, writeSync,
} from 'node:fs'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { MemoryLedger } from './memory.js'
import { DiskPayloads, lineDigest, onDiskPayload, type LineRef } from './disk.js'
import type { Ledger } from './types.js'
import type { ChainSnapshot, LedgerEvent } from './chain.js'
import type { TrustedKeys } from './decisions.js'
import type { RootKeys } from './registry.js'

/** Parse an exported chainJSONL (see `Ledger.chainJSONL`) into events + their verbatim payloads. */
export function parseChainJSONL(text: string): { events: LedgerEvent[]; payloads: unknown[] } {
  const events: LedgerEvent[] = []
  const payloads: unknown[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    const { payload, ...event } = JSON.parse(s) as LedgerEvent & { payload: unknown }
    events.push(event as LedgerEvent)
    payloads.push(payload)
  }
  return { events, payloads }
}

// ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a book's last line is torn: an append that did not finish (a crash mid-write). */
export interface TornTail {
  /** Byte offset where the torn line starts (everything before it is whole lines). */
  offset: number
  /** Bytes from `offset` to the end of the file. */
  bytes: number
  /** 1-based line number of the torn line. */
  line: number
  /** seq of the last whole event before it (undefined: none). */
  last_good_seq?: number
  /** Why it does not parse. */
  reason: string
}

/** A book whose last line is torn. Nothing was dropped: the book is read-only until `repairTornTail(path)`. */
export class TornTailError extends Error {
  readonly path: string
  readonly torn: TornTail
  constructor(path: string, torn: TornTail, cause?: unknown) {
    const after = torn.last_good_seq !== undefined ? `after event seq ${torn.last_good_seq}` : 'before any whole event'
    super(
      `the book at ${path} ends in a torn line (line ${torn.line}, ${torn.bytes} bytes at byte ${torn.offset}, ${after}): an append did not finish ` +
      '(a crash mid-write). Nothing was dropped: every event before it still reads and verifies, and the book is READ-ONLY. ' +
      `To append again, run repairTornTail(${JSON.stringify(path)}): it backs the file up, truncates it to the last whole line, and records the bytes it removed.`,
      cause !== undefined ? { cause } : undefined,
    )
    this.name = 'TornTailError'
    this.path = path
    this.torn = torn
  }
}

/** An unparseable line BEFORE the last one: not a torn tail but corruption. The book does not open; repair will not touch it. */
export class LedgerFileCorrupt extends Error {
  readonly path: string
  readonly line: number
  readonly offset: number
  constructor(path: string, line: number, offset: number, reason: string) {
    super(
      `the book at ${path} is corrupt: line ${line} (byte ${offset}) does not parse (${reason}), and whole lines follow it. ` +
      'That is not a torn last line (repairTornTail refuses it): restore the book from a backup, and treat the file as tampered until you know why.',
    )
    this.name = 'LedgerFileCorrupt'
    this.path = path
    this.line = line
    this.offset = offset
  }
}

/** An append to a book that was opened read-only (or whose store fell behind): nothing was appended. */
export class LedgerReadOnly extends Error {
  readonly path: string
  constructor(path: string, why: string) {
    super(`the book at ${path} is read-only (${why}): nothing was appended`)
    this.name = 'LedgerReadOnly'
    this.path = path
  }
}

// ── the streamed read (F4b) ──────────────────────────────────────────────────────────────────────────────────────────

export interface ChainFile extends ChainSnapshot {
  /** File size in bytes. */
  bytes: number
  /** Whether the file ends with a newline (a chain export does not: N1). */
  endsWithNewline: boolean
  /** Present when the last line is torn (only with `allowTornTail`). `events` holds every whole event before it. */
  torn?: TornTail
}

const NL = 10

/**
 * Stream a chain file: the same events and payloads as `parseChainJSONL(readFileSync(path, 'utf8'))`, without ever holding
 * the file as one string. Throws LedgerFileCorrupt for an unparseable line followed by whole ones. A torn LAST line throws
 * TornTailError, unless `allowTornTail`, which returns the whole events before it and says where the torn line is.
 */
export function readChainFile(path: string, opts: { allowTornTail?: boolean; chunkBytes?: number } = {}): ChainFile {
  const read = scanChainFile(path, opts.chunkBytes)
  if (read.torn && !opts.allowTornTail) throw new TornTailError(path, read.torn)
  return read
}

function scanChainFile(path: string, chunkBytes?: number): ChainFile {
  const events: LedgerEvent[] = []
  const payloads: unknown[] = []
  const tail = scanLines(path, (event, payload) => { events.push(event); payloads.push(payload) }, chunkBytes)
  return { events, payloads, bytes: tail.bytes, endsWithNewline: tail.endsWithNewline, ...(tail.torn ? { torn: tail.torn } : {}) }
}

/** What a scan leaves besides its events: where the file ends, and a torn last line. */
interface ScanTail {
  bytes: number
  endsWithNewline: boolean
  torn?: TornTail
  lastSeq?: number
}

/**
 * The streamed scan (F4b), one whole line at a time: `onEntry` gets each event, its payload, and the line's raw bytes (valid
 * only during the call) and byte offset. The torn-tail and corruption rules are R5's (see readChainFile).
 */
function scanLines(path: string, onEntry: (event: LedgerEvent, payload: unknown, raw: Buffer, offset: number) => void, chunkBytes = 8 * 1024 * 1024): ScanTail {
  let lineNo = 0
  let lastSeq: number | undefined
  let bad: { line: number; offset: number; reason: string } | undefined
  const onLine = (b: Buffer, start: number, end: number, offset: number): void => {
    lineNo++
    const s = b.toString('utf8', start, end).trim()
    if (!s) return
    if (bad) throw new LedgerFileCorrupt(path, bad.line, bad.offset, bad.reason)
    let parsed: LedgerEvent & { payload: unknown }
    try {
      parsed = JSON.parse(s) as LedgerEvent & { payload: unknown }
    } catch (e) {
      bad = { line: lineNo, offset, reason: (e as Error).message }
      return
    }
    const { payload, ...event } = parsed
    lastSeq = (event as LedgerEvent).seq
    onEntry(event as LedgerEvent, payload, b.subarray(start, end), offset)
  }
  const fd = openSync(path, 'r')
  let pos = 0
  let lastByte = -1
  try {
    const buf = Buffer.allocUnsafe(Math.max(1, chunkBytes))
    let carry: Buffer[] = []
    let carryStart = 0
    let n: number
    while ((n = readSync(fd, buf, 0, buf.length, pos)) > 0) {
      lastByte = buf[n - 1]!
      let start = 0
      let nl: number
      while ((nl = buf.indexOf(NL, start)) !== -1 && nl < n) {
        if (carry.length) {
          const line = Buffer.concat([...carry, buf.subarray(start, nl)])
          onLine(line, 0, line.length, carryStart)
          carry = []
        } else {
          onLine(buf, start, nl, pos + start)
        }
        start = nl + 1
      }
      if (start < n) {
        if (!carry.length) carryStart = pos + start
        carry.push(Buffer.from(buf.subarray(start, n)))
      }
      pos += n
    }
    if (carry.length) {
      const line = Buffer.concat(carry)
      onLine(line, 0, line.length, carryStart)
    }
  } finally {
    closeSync(fd)
  }
  const torn: TornTail | undefined = bad
    ? { offset: bad.offset, bytes: pos - bad.offset, line: bad.line, ...(lastSeq !== undefined ? { last_good_seq: lastSeq } : {}), reason: bad.reason }
    : undefined
  return { bytes: pos, endsWithNewline: lastByte === NL, ...(torn ? { torn } : {}), ...(lastSeq !== undefined ? { lastSeq } : {}) }
}

// ── the file ledger ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface FileLedgerOptions {
  now?: () => Date
  trusted_keys?: TrustedKeys
  root_keys?: RootKeys
  /** Never write: every append throws LedgerReadOnly, and no write handle is ever opened. */
  readOnly?: boolean
  /** fsync after every event (see DURABILITY POLICY above). Default false: the OS flushes, as appendFileSync did. */
  fsync?: boolean
  /**
   * Where the verdicts live once the book is open. 'memory' (the default): every payload in the heap (~22 KB per verdict).
   * 'disk': every RECORD payload stays in this file and is read back on demand, checked against the bytes read at open (a
   * line changed since throws LedgerFileChanged); the heap keeps the events and a compact index (~1 KB per verdict).
   */
  payloads?: 'memory' | 'disk'
  /** Disk mode: how many recently read payloads to keep parsed (default 256). */
  cache?: number
}

/** A file-backed ledger: the Ledger, plus where it lives, whether it can be written, and its write handle's release. */
export interface FileLedger extends Ledger {
  readonly path: string
  /** Set when the book's last line is torn (R5): the book is read-only until repairTornTail(path). */
  readonly torn: TornTail | undefined
  /** True when opened read-only, or when the book has a torn tail. */
  readonly readOnly: boolean
  /** Where the verdicts live: in the heap, or read back from this file on demand. */
  readonly payloads: 'memory' | 'disk'
  /** Release the write handle, and the disk mode's read handle (the next append or read opens it again). Idempotent. */
  close(): void
  [Symbol.dispose](): void
}

/** The write side of a file ledger: one held descriptor, the lazy N1 newline, and the states that refuse a write. */
class AppendStore {
  fd: number | undefined
  constructor(
    readonly path: string,
    public size: number,
    public needsNewline: boolean,
    public torn: TornTail | undefined,
    readonly readOnly: boolean,
    readonly fsync: boolean,
    public lastSeq: number | undefined,
  ) {}

  /** Stale: a line reached the file but its fsync failed, so memory is behind the file. Reopen to continue. */
  stale: string | undefined

  /** Append the event's line. `locate`: say where it landed (the disk mode keeps a RECORD's payload there). */
  write(event: LedgerEvent, payload: unknown, locate = false): LineRef | undefined {
    if (this.torn) throw new TornTailError(this.path, this.torn)
    if (this.readOnly) throw new LedgerReadOnly(this.path, 'opened with readOnly')
    if (this.stale) throw new LedgerReadOnly(this.path, this.stale)
    const lead = this.needsNewline ? 1 : 0
    const buf = Buffer.from((this.needsNewline ? '\n' : '') + JSON.stringify({ ...event, payload }) + '\n', 'utf8')
    if (this.fd === undefined) this.fd = openSync(this.path, 'a')
    let off = 0
    try {
      while (off < buf.length) off += writeSync(this.fd, buf, off, buf.length - off)
    } catch (e) {
      // How much of the line reached the file: what the writes reported, or (a store that wrote and then failed) the size.
      let landed = off
      try { landed = Math.max(off, fstatSync(this.fd).size - this.size) } catch { /* keep what the writes reported */ }
      if (landed > 0) {
        // Part of the line is on disk: that IS a torn tail. Refuse every later append until it is repaired.
        this.torn = { offset: this.size, bytes: landed, line: -1, ...(this.lastSeq !== undefined ? { last_good_seq: this.lastSeq } : {}), reason: `a write failed after ${landed} of ${buf.length} bytes: ${(e as Error).message}` }
        throw new TornTailError(this.path, this.torn, e)
      }
      throw e
    }
    const line = locate ? { offset: this.size + lead, length: buf.length - lead - 1, digest: lineDigest(buf.subarray(lead, buf.length - 1)) } : undefined
    this.size += buf.length
    this.needsNewline = false
    if (this.fsync) {
      try {
        fsyncSync(this.fd)
      } catch (e) {
        this.stale = `event seq ${event.seq} reached the file but its fsync failed (${(e as Error).message}); reopen the book to continue`
        throw e
      }
    }
    this.lastSeq = event.seq
    return line
  }

  close(): void {
    if (this.fd === undefined) return
    const fd = this.fd
    this.fd = undefined
    closeSync(fd)
  }
}

/** A ledger dropped without close() still releases its write handle (and the disk mode's read handle) when collected. */
const RELEASE = new FinalizationRegistry<{ close(): void }>(store => {
  try { store.close() } catch { /* already gone */ }
})

/** The disk mode's store, and the streamed reopen that fills it (run inside the ledger's constructor). */
interface DiskOpen {
  store: DiskPayloads
  replay?: (feed: (event: LedgerEvent, payload: unknown, line?: LineRef) => void) => void
}

type FileLedgerClass = new (path: string, seed: ChainSnapshot | undefined, store: AppendStore, opts: FileLedgerOptions, disk?: DiskOpen) => FileLedger
let fileLedgerClass: FileLedgerClass | undefined

/**
 * The file ledger class, built on first use: this module and memory.ts sit in an import cycle (through the opinion layer),
 * so a subclass of MemoryLedger cannot be evaluated when this module loads.
 */
function FileBackedLedger(): FileLedgerClass {
  return fileLedgerClass ??= class extends MemoryLedger implements FileLedger {
    readonly path: string
    readonly payloads: 'memory' | 'disk'
    readonly #store: AppendStore
    readonly #disk: DiskPayloads | undefined

    constructor(path: string, seed: ChainSnapshot | undefined, store: AppendStore, opts: FileLedgerOptions, disk?: DiskOpen) {
      super({
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.trusted_keys ? { trusted_keys: opts.trusted_keys } : {}),
        ...(opts.root_keys ? { root_keys: opts.root_keys } : {}),
        ...(seed ? { seed } : {}),
        ...(disk ? { payloads: disk.store, ...(disk.replay ? { replay: disk.replay } : {}) } : {}),
        onAppend: disk ? (event, payload) => store.write(event, payload, onDiskPayload(payload)) : (event, payload) => { store.write(event, payload) },
      })
      this.path = path
      this.payloads = disk ? 'disk' : 'memory'
      this.#store = store
      this.#disk = disk?.store
      RELEASE.register(this, store, this)
      if (disk) RELEASE.register(this, disk.store, this)
    }

    get torn(): TornTail | undefined { return this.#store.torn }
    get readOnly(): boolean { return this.#store.readOnly || this.#store.torn !== undefined }

    close(): void {
      this.#store.close()
      this.#disk?.close()
    }

    [Symbol.dispose](): void {
      this.close()
    }
  }
}

/**
 * Open (or create) a file-backed ledger at `path`. Existing history is streamed in and its chain restored verbatim; every new
 * record/review/decision is appended as one JSONL line as it happens, through one held file descriptor. With `trusted_keys`,
 * only a decision signed by the key anchored to its signer passes the door; with `root_keys`, the key registry on the book
 * anchors signers once it is in force.
 *
 * A book whose last line is torn opens READ-ONLY (`torn` says where; any append throws TornTailError); a book with an
 * unparseable line before its last throws LedgerFileCorrupt. Nothing is verified at open: the first content check of the
 * reopened ledger re-hashes every event (F5b never carries across a reopen).
 */
export function openFileLedger(path: string, opts: FileLedgerOptions = {}): FileLedger {
  if (opts.payloads === 'disk') return openDiskLedger(path, opts)
  const read = existsSync(path) ? scanChainFile(path) : undefined
  const dir = dirname(path)
  if (dir && dir !== '.' && !opts.readOnly) mkdirSync(dir, { recursive: true })
  // N1 (CLI lane, 2026-09-28): `chainJSONL()` has no final newline. Appending onto such an export would fuse the last event
  // and the first new one onto one line, and the book would stop parsing. The missing newline is written lazily, before the
  // first append, so merely opening a book never changes its bytes.
  const needsNewline = read !== undefined && read.bytes > 0 && !read.endsWithNewline
  const lastSeq = read && read.events.length ? read.events[read.events.length - 1]!.seq : undefined
  const store = new AppendStore(path, read?.bytes ?? 0, needsNewline, read?.torn, !!opts.readOnly, !!opts.fsync, lastSeq)
  return new (FileBackedLedger())(path, read ? { events: read.events, payloads: read.payloads } : undefined, store, opts)
}

/**
 * The disk mode's open: the same scan, streamed straight into the ledger (no array of payloads is ever built). Each RECORD's
 * line is located (offset, length, sha256 of its bytes) and its payload dropped once its record is indexed; every other
 * payload is kept. The write side starts where the scan ended, with the same N1 newline and R5 torn-tail state.
 */
function openDiskLedger(path: string, opts: FileLedgerOptions): FileLedger {
  const exists = existsSync(path)
  const dir = dirname(path)
  if (dir && dir !== '.' && !opts.readOnly) mkdirSync(dir, { recursive: true })
  const store = new AppendStore(path, 0, false, undefined, !!opts.readOnly, !!opts.fsync, undefined)
  const disk = new DiskPayloads(path, opts.cache !== undefined ? { cache: opts.cache } : {})
  let tail: ScanTail | undefined
  const replay = exists
    ? (feed: (event: LedgerEvent, payload: unknown, line?: LineRef) => void): void => {
      tail = scanLines(path, (event, payload, raw, offset) => feed(event, payload, onDiskPayload(payload) ? { offset, length: raw.length, digest: lineDigest(raw) } : undefined))
    }
    : undefined
  const ledger = new (FileBackedLedger())(path, undefined, store, opts, { store: disk, ...(replay ? { replay } : {}) })
  if (tail) {
    store.size = tail.bytes
    store.needsNewline = tail.bytes > 0 && !tail.endsWithNewline
    store.torn = tail.torn
    store.lastSeq = tail.lastSeq
  }
  return ledger
}

// ── repair (R5) ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RepairReport {
  /** False when there was nothing to repair (the last line is whole). */
  repaired: boolean
  path: string
  /** Why nothing was done, when repaired is false. */
  note?: string
  /** When repaired: the untouched copy of the book as it was, the size it was cut to, and exactly what was removed. */
  backup?: string
  repaired_at?: string
  truncated_to_bytes?: number
  removed?: { offset: number; bytes: number; line: number; sha256: string; base64: string; reason: string }
  /** The whole events kept, and the seq of the last one. */
  events_kept?: number
  last_good_seq?: number
  /** Where this report was appended (one JSON line per repair). */
  log?: string
}

/**
 * Repair a torn last line (R5): back the book up (`<path>.torn-<time>.bak`, never overwriting), truncate it to the end of
 * its last whole line, and append what was removed (bytes, sha256, base64) to `<path>.repairs.jsonl`. Run it with the book
 * closed. Refuses a book whose unparseable line is not the last (LedgerFileCorrupt: that is corruption, not a crash). A book
 * whose last line is whole is left untouched.
 */
export function repairTornTail(path: string, opts: { now?: () => Date } = {}): RepairReport {
  const read = scanChainFile(path) // throws LedgerFileCorrupt for a bad line that is not the last
  if (!read.torn) return { repaired: false, path, note: 'the last line is whole: nothing to repair' }
  const t = read.torn
  const repaired_at = (opts.now?.() ?? new Date()).toISOString()
  const backup = `${path}.torn-${repaired_at.replace(/[:.]/g, '-')}.bak`
  copyFileSync(path, backup, fsConstants.COPYFILE_EXCL)
  const removedBytes = Buffer.alloc(t.bytes)
  const fd = openSync(path, 'r')
  try {
    let off = 0
    while (off < t.bytes) {
      const n = readSync(fd, removedBytes, off, t.bytes - off, t.offset + off)
      if (n <= 0) break
      off += n
    }
  } finally {
    closeSync(fd)
  }
  truncateSync(path, t.offset)
  const log = `${path}.repairs.jsonl`
  const report: RepairReport = {
    repaired: true, path, backup, repaired_at, truncated_to_bytes: t.offset,
    removed: { offset: t.offset, bytes: t.bytes, line: t.line, sha256: createHash('sha256').update(removedBytes).digest('hex'), base64: removedBytes.toString('base64'), reason: t.reason },
    events_kept: read.events.length, ...(t.last_good_seq !== undefined ? { last_good_seq: t.last_good_seq } : {}), log,
  }
  appendFileSync(log, JSON.stringify(report) + '\n')
  return report
}

// ── the streamed export (F2) ─────────────────────────────────────────────────────────────────────────────────────────

/** A chain to export: a ledger (its snapshot) or a snapshot. */
export type ChainSource = Pick<Ledger, 'snapshot'> | ChainSnapshot

function snapshotOf(src: ChainSource): ChainSnapshot {
  return typeof (src as Pick<Ledger, 'snapshot'>).snapshot === 'function' ? (src as Pick<Ledger, 'snapshot'>).snapshot() : (src as ChainSnapshot)
}

/** Each line of the chain export (one event with its payload, as JSON), in order, without newlines. */
export function* chainLines(src: ChainSource): Generator<string> {
  const { events, payloads } = snapshotOf(src)
  for (let i = 0; i < events.length; i++) yield JSON.stringify({ ...events[i]!, payload: payloads[i] })
}

const BATCH_CHARS = 1 << 20

/**
 * Stream the chain export to a writable (a file stream, an HTTP response): exactly the bytes `chainJSONL()` would return
 * (lines joined by '\n', no final newline), never as one string. Honors backpressure (waits for 'drain'); does not end the
 * stream (the caller owns it). Resolves with the event and byte counts.
 */
export async function writeChainJSONL(src: ChainSource, out: NodeJS.WritableStream): Promise<{ events: number; bytes: number }> {
  let batch: string[] = []
  let chars = 0
  let bytes = 0
  let events = 0
  const flush = async (): Promise<void> => {
    if (!batch.length) return
    const chunk = batch.join('')
    batch = []
    chars = 0
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (!out.write(chunk)) await once(out, 'drain')
  }
  for (const line of chainLines(src)) {
    const s = events++ > 0 ? '\n' + line : line
    batch.push(s)
    chars += s.length
    if (chars >= BATCH_CHARS) await flush()
  }
  await flush()
  return { events, bytes }
}

/**
 * Write the chain export to a file (the same bytes as `chainJSONL()`), streamed. Refuses to overwrite an existing file
 * unless `flag: 'w'` (the default 'wx' never replaces a book).
 */
export function writeChainFile(src: ChainSource, path: string, opts: { flag?: 'wx' | 'w' } = {}): { events: number; bytes: number } {
  const dir = dirname(path)
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
  const fd = openSync(path, opts.flag ?? 'wx')
  let bytes = 0
  let events = 0
  try {
    let batch: string[] = []
    let chars = 0
    const flush = (): void => {
      if (!batch.length) return
      const buf = Buffer.from(batch.join(''), 'utf8')
      batch = []
      chars = 0
      let off = 0
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
      bytes += buf.length
    }
    for (const line of chainLines(src)) {
      const s = events++ > 0 ? '\n' + line : line
      batch.push(s)
      chars += s.length
      if (chars >= BATCH_CHARS) flush()
    }
    flush()
  } finally {
    closeSync(fd)
  }
  return { events, bytes }
}
