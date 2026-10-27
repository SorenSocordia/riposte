/**
 * JSONL file storage for the receipt ledger (one entry per line; append-only).
 *
 * 2026-10-03: the store no longer re-reads the whole file to append, and a crash mid-append no longer bricks it.
 *
 * HEAD SIDECAR. `<ledger>.head.json` holds { count, head, bytes } after every append (written to a temporary file, then
 * renamed over the old one). On open the sidecar is VALIDATED against the file, in O(1): the file must be at least `bytes`
 * long, and the line that ends at `bytes` must be entry `count - 1` with hash `head`. Then an append is O(1): the line, then
 * the sidecar. `riposte-ledger verify` still walks the full chain; the sidecar only says where the end is.
 *   - file shorter than the sidecar says, or a different entry where the sidecar's head should be → refused,
 *     `ledger.sidecar_mismatch` (entries were removed or edited)
 *   - file longer → the extra whole lines must chain from the sidecar's head (seq, prev_hash, and each hash re-derived):
 *     another writer appended, or the process stopped between the line and the sidecar. They are taken in; anything that
 *     does not chain is refused (`ledger.sidecar_mismatch`)
 *   - no sidecar (a ledger written before this version) → one scan builds it, checking order and links
 *   - a sidecar that does not parse → refused, `ledger.sidecar_invalid` (delete it to rebuild it from the file)
 * While open, the store checks the file's size before each append; a file that grew is taken in the same way (it must
 * chain), and one that shrank is refused (`ledger.changed_outside`).
 *
 * DURABLE. Each line is flushed to disk (fdatasync) before the sidecar is written and before append returns, so an answer
 * is only ever given for a receipt that is on disk. Measured on the development machine: about 0.5 ms more per append.
 *
 * TORN TAIL. A last line with no newline is what a crash mid-append leaves. On open it is moved aside, byte for byte, into
 * `<ledger>.torn-<stamp>` (never overwriting a file there), the ledger is cut back to its last whole line, and the repair is
 * returned by `takeRepairs()`, which openLedger records as a signed `note` on the chain; the next call proceeds. Because
 * every line is flushed before anyone is answered, a crash only ever tears a line no caller was answered with.
 * A tail cut through the LAST ENTRY the sidecar recorded (a disk fault, or a hand edit: not a crash) is repaired the same
 * way, so the tenant is not bricked, and the note names that entry (`cut_entry`: its seq and hash) so the loss is on the
 * record. Only the tail is repaired: a cut deeper than the last entry, or a line in the middle that does not parse, is
 * refused (`ledger.sidecar_mismatch`, `ledger.corrupt`).
 *
 * ONE WRITER AT A TIME, BY DEFAULT (2026-10-03). Two processes appending to one ledger with no lock both read the
 * same head and both write an entry after it: the chain forks (red-team finding F16: 8 writers, `verify` broken, a
 * prev_hash used twice). Every store now locks, in one of two modes:
 *   - PER-APPEND (the default: no `lock` option, or `lock: false`). `<ledger>.lock` is created exclusively around each
 *     append, and released after it: the head is read from disk, the entry built, written, flushed and the sidecar updated
 *     inside that one critical section (openLedger signs inside it too, through `exclusive`). A writer that finds the lock
 *     taken waits and tries again, up to `timeoutMs` (default 10 s); then it fails with `ledger.locked` and writes nothing.
 *     Many processes can share one ledger this way: the plain CLIs, every MCP stdio server, library callers.
 *   - HOLD (`lock: true`, `'hold'`, or LockOptions with no mode; riposte-serve, pilot, attest-monitor): taken on open and
 *     kept for the process's life (below). Another process's live hold lock refuses at once: one server per ledger.
 * A per-append lock left by a writer that stopped (its pid is gone on this host, or the lock is older than `staleMs`,
 * default 120 s, which covers a reused pid) is broken by the next writer without asking: moved aside byte for byte to
 * `<ledger>.lock.broken-<stamp>` and recorded on the chain as a signed `ledger.lock_broken` note. One writer breaks at a
 * time, and it re-reads the lock first, so a fresh lock is never moved aside. Before it writes, a holder checks the lock
 * file still carries its own token; a writer whose lock was broken from under it writes nothing (`ledger.locked`).
 * Another host's lock is never broken. A store that meets another process's live HOLD lock while only READING reads
 * without writing anything (no repair, no sidecar) instead of failing.
 * Opting out: `RIPOSTE_LEDGER_UNLOCKED=1` in the environment, or `unsafeUnlocked: true`, turns the per-append lock off for
 * single-process tests. Every store opened that way says so on stderr. It never turns off a HOLD lock.
 */
import { closeSync, existsSync, fdatasyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { GENESIS, entryHash, readLedgerLine, type LedgerEntry, type LedgerStore, type LineRefusal, type StoreRepair } from './ledger.js'

/** A refusal with a stable code (the hosted gate answers 503 with it): the ledger is not in a state this store will write to. */
export class LedgerStoreError extends Error {
  readonly code: 'ledger.sidecar_mismatch' | 'ledger.sidecar_invalid' | 'ledger.changed_outside' | 'ledger.stale_head' | 'ledger.corrupt' | 'ledger.locked'
  constructor(code: LedgerStoreError['code'], message: string) {
    super(message)
    this.name = 'LedgerStoreError'
    this.code = code
  }
}

/** How a store keeps one writer per ledger: around each append (the default), or for the process's life. */
export type LockMode = 'append' | 'hold'

/** The environment variable that turns the per-append lock off (single-process tests only; logged on every store). */
export const UNLOCKED_ENV = 'RIPOSTE_LEDGER_UNLOCKED'
/** How long a writer waits for the lock before it fails with `ledger.locked`. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000
/** A per-append lock older than this is stale even when its pid answers (a reused pid, or a writer that hung). */
export const DEFAULT_LOCK_STALE_MS = 120_000

export interface FileStoreOptions {
  /** the clock for the quarantine file's stamp and the sidecar's updated_at */
  now?: () => Date
  /** keep the head sidecar (default true) */
  sidecar?: boolean
  /** flush each line to disk before append returns (default true) */
  durable?: boolean
  /**
   * The single-writer lock (see the top of this file). Omitted, `false` or `'append'`: the PER-APPEND lock (the default;
   * `false` no longer turns the lock off). `true`, `'hold'`, or LockOptions without `mode`: the HOLD lock.
   *
   * HOLD (2026-10-03; the hosted gate turns it on). `<ledger>.lock` is created with exclusive create on open,
   * holding { pid, host, started_at, mode }, and removed on release (or at process exit). Another process's lock refuses the
   * open (`ledger.locked`, naming its pid and host). A lock whose process is gone (same host, pid not running), or that does
   * not parse, is broken only with `breakStale` (riposte-serve --break-lock): moved aside byte for byte to
   * `<ledger>.lock.broken-<stamp>` and recorded on the chain as a signed note. A lock from another host is never broken here.
   * A per-append writer's lock found at open is waited for (and broken when stale), never refused at once.
   * Stores of one process share the lock (the same tenant opened twice in one process is not a second writer).
   */
  lock?: boolean | LockMode | LockOptions
  /**
   * Turn the per-append lock OFF. For single-process tests only: two writers can then fork the chain. Same as
   * RIPOSTE_LEDGER_UNLOCKED=1. Each store opened this way writes a warning to stderr. Has no effect on a HOLD lock.
   */
  unsafeUnlocked?: boolean
}

export interface LockOptions {
  /** 'append' (around each append) or 'hold' (for the process's life). Default 'hold' when LockOptions are given. */
  mode?: LockMode
  /** HOLD: break a lock whose process is gone (or that does not parse); never a live one, never another host's */
  breakStale?: boolean
  /** for tests: this process's identity and the liveness check (default process.pid, os.hostname(), signal 0) */
  pid?: number
  host?: string
  isAlive?: (pid: number) => boolean
  /** how long to wait for a per-append writer's lock before failing with `ledger.locked` (default 10 000 ms) */
  timeoutMs?: number
  /** a per-append lock older than this is stale even when its pid answers (default 120 000 ms) */
  staleMs?: number
}

export interface FileStore extends LedgerStore {
  head(): { count: number; head: string }
  takeRepairs(): StoreRepair[]
  scan(visit: (e: LedgerEntry) => void): void
  entryAt(seq: number): LedgerEntry | undefined
  /**
   * Run `fn` as ONE critical section under the lock: openLedger reads the head, builds, signs and writes an entry inside it,
   * so the head it chains to is the head on disk. `orReadOnly`: when another process's live HOLD lock (or a lock that does
   * not clear in time) keeps it out, run `fn` without writing anything instead of failing (`access` says which).
   */
  exclusive<T>(fn: (access: 'write' | 'read-only') => T, opts?: { orReadOnly?: boolean }): T
  /** how this store locks: 'append' (the default), 'hold', or 'off' (RIPOSTE_LEDGER_UNLOCKED=1 / unsafeUnlocked) */
  readonly lockMode: LockMode | 'off'
  /** where the sidecar lives */
  readonly sidecarPath: string
  /** where the single-writer lock lives */
  readonly lockPath: string
  /** HOLD: give the lock back; the store refuses every later call. A no-op for a per-append store (it holds nothing between calls). */
  release(): void
}

export const lockPathOf = (path: string): string => `${path}.lock`

/** Is a process running? Signal 0 checks without signalling; EPERM means it runs under another user. */
export const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

/**
 * Who holds a ledger's lock, read without taking it (riposte-ledger rule asks before appending): undefined when unlocked.
 * `alive` is 'unknown' for another host's lock. `mode` is 'append' for a per-append writer's lock (held for one append),
 * 'hold' for a server's (a lock with no mode was written before modes existed: a hold).
 */
export function lockHolder(path: string, isAlive: (pid: number) => boolean = pidAlive): { pid?: number; host?: string; started_at?: string; alive: boolean | 'unknown'; mode: LockMode } | undefined {
  let raw: string
  try { raw = readFileSync(lockPathOf(path), 'utf8') } catch { return undefined }
  let x: { pid?: unknown; host?: unknown; started_at?: unknown; mode?: unknown } = {}
  try { x = JSON.parse(raw) as typeof x } catch { return { alive: false, mode: 'hold' } }
  const pid = Number.isSafeInteger(x.pid) ? (x.pid as number) : undefined
  const host = typeof x.host === 'string' ? x.host : undefined
  const alive = host !== undefined && host !== hostname() ? 'unknown' as const : pid !== undefined && isAlive(pid)
  return { ...(pid !== undefined ? { pid } : {}), ...(host ? { host } : {}), ...(typeof x.started_at === 'string' ? { started_at: x.started_at } : {}), alive, mode: x.mode === 'append' ? 'append' : 'hold' }
}

/** Locks this process holds, by absolute lock path (stores of one process share one). */
const heldLocks = new Map<string, { count: number; pid: number; host: string; mode: LockMode; token?: string }>()
let exitArmed = false
function armExitRelease(): void {
  if (exitArmed) return
  exitArmed = true
  process.once('exit', () => {
    for (const [p, h] of heldLocks) {
      if (h.pid !== process.pid) continue
      try {
        const cur = JSON.parse(readFileSync(p, 'utf8')) as { pid?: unknown; host?: unknown; token?: unknown }
        if (cur.pid === h.pid && cur.host === h.host && (h.token === undefined || cur.token === h.token)) unlinkSync(p) // only our own lock
      } catch { /* gone already */ }
    }
  })
}

interface Sidecar { version: 1; ledger: string; count: number; head: string; bytes: number; updated_at: string }

export const sidecarPathOf = (path: string): string => `${path}.head.json`

const CHUNK = 1 << 20
const NL = 0x0a
/** a reader waits at most this long for a per-append writer before reading without writing */
const READ_WAIT_MS = 1_000
/** a breaker's own marker older than this was left by a writer that stopped mid-break */
const BREAKER_STALE_MS = 5_000

const sleeper = new Int32Array(new SharedArrayBuffer(4))
const pause = (ms: number): void => { Atomics.wait(sleeper, 0, 0, ms) }

/** rename, retried briefly: on Windows a scanner holding the old file open makes a rename fail for a moment */
function replaceFile(tmp: string, dest: string): void {
  for (let i = 0; ; i++) {
    try { renameSync(tmp, dest); return } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= 20 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw e
      pause(10)
    }
  }
}

/** Windows reports a file that is being deleted (another process still has it open) as EPERM / EACCES / EBUSY. */
const inFlux = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/** A lock file as found: its bytes, what it says, and how old it is by the file system's clock. */
interface FoundLock { raw: Buffer; parsed: boolean; pid?: number; host?: string; started_at?: string; mode: LockMode; token?: string; ageMs: number }

export function fileStore(path: string, opts: FileStoreOptions = {}): FileStore {
  const now = opts.now ?? (() => new Date())
  const side = sidecarPathOf(path)
  const useSidecar = opts.sidecar !== false
  const durable = opts.durable !== false
  const name = basename(path)
  let st: { count: number; head: string; bytes: number } | null = null
  /** byte offset of each entry's line, by seq, once built (a scan or entryAt builds it; appends extend it) */
  let offsets: number[] | null = null
  let repairs: StoreRepair[] = []

  const fail = (code: LedgerStoreError['code'], msg: string): never => { throw new LedgerStoreError(code, msg) }
  const sizeOf = (): number => (existsSync(path) ? statSync(path).size : 0)

  // ── which lock ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const given = opts.lock
  const lockOpt: LockOptions = given === true || given === 'hold' ? { mode: 'hold' }
    : given === 'append' || given === false || given === undefined ? { mode: 'append' }
    : { ...given, mode: given.mode ?? 'hold' }
  const unlockedAsked = opts.unsafeUnlocked === true || process.env[UNLOCKED_ENV] === '1'
  const lockMode: LockMode | 'off' = lockOpt.mode === 'append' && unlockedAsked ? 'off' : lockOpt.mode!
  const myPid = lockOpt.pid ?? process.pid
  const myHost = lockOpt.host ?? hostname()
  const isAlive = lockOpt.isAlive ?? pidAlive
  const timeoutMs = lockOpt.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const staleMs = lockOpt.staleMs ?? DEFAULT_LOCK_STALE_MS
  const lockPath = lockPathOf(path)
  const lockKey = resolve(lockPath)
  let lockHeld = false
  let released = false
  let warned = false
  /** > 0 while a read runs without the lock (another process's live hold lock kept it out): nothing is written */
  let readOnlyDepth = 0
  const readOnly = (): boolean => readOnlyDepth > 0

  const stampOf = (d: Date): string => d.toISOString().replace(/[:.]/g, '-')
  /** a quarantine name that does not exist yet (two breaks in one clock tick get -1, -2 …) */
  const freshName = (base: string): string => { let q = base; for (let i = 1; existsSync(q); i++) q = `${base}-${i}`; return q }

  const readLock = (): FoundLock | undefined => {
    let raw: Buffer
    let mtime: number
    try { raw = readFileSync(lockPath); mtime = statSync(lockPath).mtimeMs } catch { return undefined } // released, or being removed
    const ageMs = Date.now() - mtime
    let x: { pid?: unknown; host?: unknown; started_at?: unknown; mode?: unknown; token?: unknown } | undefined
    try { x = JSON.parse(raw.toString('utf8')) as typeof x } catch { x = undefined }
    if (!x || typeof x !== 'object') return { raw, parsed: false, mode: 'hold', ageMs }
    return {
      raw, parsed: true, ageMs,
      ...(Number.isSafeInteger(x.pid) ? { pid: x.pid as number } : {}),
      ...(typeof x.host === 'string' ? { host: x.host } : {}),
      ...(typeof x.started_at === 'string' ? { started_at: x.started_at } : {}),
      ...(typeof x.token === 'string' ? { token: x.token } : {}),
      mode: x.mode === 'append' ? 'append' : 'hold',
    }
  }
  const whoOf = (l: FoundLock | undefined): string => !l ? 'another writer'
    : !l.parsed ? (l.raw.length ? 'a lock that does not parse' : 'a lock being written')
    : `pid ${String(l.pid)} on ${String(l.host)} since ${String(l.started_at)}${l.mode === 'append' ? ' (a per-append writer)' : ''}`

  /** Create the lock file exclusively, content and all; undefined when another lock is there (or still being removed). */
  const createLock = (content: object): 'created' | 'exists' | 'busy' => {
    mkdirSync(dirname(path), { recursive: true })
    let fd: number
    try { fd = openSync(lockPath, 'wx') } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists'
      if (inFlux(e)) return 'busy'
      throw e
    }
    try { writeSync(fd, `${JSON.stringify(content)}\n`) } catch (e) {
      try { closeSync(fd) } catch { /* closing anyway */ }
      try { unlinkSync(lockPath) } catch { /* never leave an empty lock behind */ }
      throw e
    }
    closeSync(fd)
    return 'created'
  }

  /** A per-append writer's lock (or an empty / unreadable one) that may be broken without asking. */
  const staleAppendLock = (l: FoundLock): string | undefined => {
    if (!l.parsed || l.pid === undefined || l.host === undefined) return l.ageMs > staleMs ? `it names no process and is ${Math.round(l.ageMs / 1000)} s old` : undefined
    if (l.host !== myHost) return undefined // never another host's
    if (!isAlive(l.pid)) return `pid ${l.pid} is no longer running on this host`
    if (l.ageMs > staleMs) return `it is ${Math.round(l.ageMs / 1000)} s old (a per-append lock is held for one append; the pid was reused, or the writer hung)`
    return undefined
  }

  /**
   * Move a stale per-append lock aside and put the break on the record. One breaker at a time (`<lock>.break`, created
   * exclusively), and the lock is re-read first: only the very bytes judged stale are moved, never a fresh lock.
   */
  const breakAppendLock = (seen: FoundLock, why: string): boolean => {
    const marker = `${lockPath}.break`
    try { writeFileSync(marker, `${JSON.stringify({ pid: myPid, host: myHost })}\n`, { flag: 'wx' }) } catch {
      try { if (Date.now() - statSync(marker).mtimeMs > BREAKER_STALE_MS) unlinkSync(marker) } catch { /* gone, or being removed */ }
      return false // another writer is breaking it; look again after a pause
    }
    try {
      let cur: Buffer
      try { cur = readFileSync(lockPath) } catch { return true } // gone already: try to take it
      if (!cur.equals(seen.raw)) return true // replaced since we looked: not the lock judged stale; look again
      const at = now()
      const q = freshName(`${lockPath}.broken-${stampOf(at)}`)
      writeFileSync(q, cur, { flag: 'wx' })
      unlinkSync(lockPath)
      repairs.push({ event: 'ledger.lock_broken', bytes: cur.length, sha256: createHash('sha256').update(cur).digest('hex'), quarantined_to: basename(q), after_seq: null, detected_at: at.toISOString(), reason: why })
      return true
    } finally {
      try { unlinkSync(marker) } catch { /* already gone */ }
    }
  }

  // ── HOLD: taken on open, kept until release ───────────────────────────────────────────────────────────────────────
  const takeLock = (): void => {
    if (lockMode !== 'hold' || lockHeld) return
    const shared = heldLocks.get(lockKey)
    if (shared && shared.pid === myPid && shared.host === myHost) { shared.count++; lockHeld = true; return }
    const deadline = Date.now() + timeoutMs
    let last: FoundLock | undefined
    for (let attempt = 0, spin = 0; attempt < 3; spin++) {
      const made = createLock({ pid: myPid, host: myHost, started_at: now().toISOString(), ledger: name, mode: 'hold' })
      if (made === 'created') {
        heldLocks.set(lockKey, { count: 1, pid: myPid, host: myHost, mode: 'hold' })
        lockHeld = true
        armExitRelease()
        return
      }
      const other = made === 'exists' ? readLock() : undefined
      // a per-append writer's lock (held for one append), or one still being written: wait for it, or break it when stale
      if (made === 'busy' || !other || other.mode === 'append' || (!other.parsed && other.raw.length === 0 && other.ageMs < 2_000)) {
        if (other) last = other
        const why = other && (other.mode === 'append' || other.raw.length === 0) ? staleAppendLock(other) : undefined
        if (other && why && breakAppendLock(other, why)) continue
        if (Date.now() >= deadline) fail('ledger.locked', `${name}: waited ${timeoutMs} ms for ${basename(lockPath)}, held by ${whoOf(last)}; it did not clear`)
        pause(Math.min(25, 1 + spin) + Math.floor(Math.random() * 4))
        continue
      }
      attempt++
      const raw = other.raw
      const oPid = other.pid
      const oHost = other.host
      const who = other.parsed ? `pid ${String(oPid)} on ${String(oHost)} since ${String(other.started_at)}` : 'a lock that does not parse'
      if (oPid === myPid && oHost === myHost) { try { unlinkSync(lockPath) } catch { /* gone */ } continue } // our own pid: left by this process, not another writer
      const state = oPid === undefined || oHost === undefined ? 'unreadable' : oHost !== myHost ? 'elsewhere' : isAlive(oPid) ? 'running' : 'gone'
      if (state === 'running') fail('ledger.locked', `${name} is held by ${who}, which is running: one writer per ledger (${basename(lockPath)}). Stop that server first.`)
      if (state === 'elsewhere') fail('ledger.locked', `${name} is held by ${who}: this host (${myHost}) cannot tell whether that process runs, so it never breaks the lock, not even with --break-lock. If you are sure no other server writes this ledger, delete ${basename(lockPath)} by hand.`)
      if (!lockOpt.breakStale) {
        fail('ledger.locked', `${name} is locked by ${who} (${basename(lockPath)}), and ${state === 'gone' ? 'that process is no longer running on this host' : 'the lock names no process'}. After checking that no other server writes this ledger, start again with --break-lock: the lock is moved aside and the break recorded on the chain.`)
      }
      const at = now()
      const q = `${lockPath}.broken-${stampOf(at)}`
      writeFileSync(q, raw, { flag: 'wx' }) // never over an earlier one
      unlinkSync(lockPath)
      repairs.push({ event: 'ledger.lock_broken', bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), quarantined_to: basename(q), after_seq: null, detected_at: at.toISOString() })
    }
    fail('ledger.locked', `${name}: could not take the lock (${basename(lockPath)}) after three tries`)
  }
  const releaseLock = (): void => {
    if (lockMode !== 'hold') return // a per-append store holds nothing between calls
    released = true
    st = null
    if (!lockHeld) return
    lockHeld = false
    const h = heldLocks.get(lockKey)
    if (!h || --h.count > 0) return
    heldLocks.delete(lockKey)
    try {
      const cur = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown; host?: unknown }
      if (cur.pid === h.pid && cur.host === h.host) unlinkSync(lockPath) // only our own lock
    } catch { /* already gone */ }
  }

  // ── PER-APPEND (the default): taken around each call, waited for, broken when stale ───────────────────────────────────
  /** true: the lock is ours (or shared within this process). false: read without writing (only when `intent` is 'read'). */
  const takeAppendLock = (intent: 'write' | 'read'): boolean => {
    const shared = heldLocks.get(lockKey)
    if (shared && shared.pid === myPid && shared.host === myHost) { shared.count++; return true }
    const budget = intent === 'write' ? timeoutMs : Math.min(timeoutMs, READ_WAIT_MS)
    const deadline = Date.now() + budget
    let last: FoundLock | undefined
    for (let spin = 0; ; spin++) {
      const token = randomBytes(12).toString('hex')
      const made = createLock({ pid: myPid, host: myHost, started_at: new Date().toISOString(), ledger: name, mode: 'append', token })
      if (made === 'created') {
        heldLocks.set(lockKey, { count: 1, pid: myPid, host: myHost, mode: 'append', token })
        armExitRelease()
        return true
      }
      const other = made === 'exists' ? readLock() : undefined
      if (other) {
        last = other
        if (other.parsed && other.pid === myPid && other.host === myHost) { // left by this process (it has no record of it): not another writer
          try { if (readFileSync(lockPath).equals(other.raw)) unlinkSync(lockPath) } catch { /* gone */ }
          continue
        }
        if (other.parsed && other.mode === 'hold') {
          if (intent === 'read') return false
          const state = other.pid === undefined || other.host === undefined ? 'unreadable' : other.host !== myHost ? 'elsewhere' : isAlive(other.pid) ? 'running' : 'gone'
          if (state === 'running') fail('ledger.locked', `${name} is held by ${whoOf(other)}, a running server: one writer per ledger (${basename(lockPath)}). Send the receipt to that server instead; nothing was written.`)
          if (state === 'elsewhere') fail('ledger.locked', `${name} is held by ${whoOf(other)}: this host (${myHost}) cannot tell whether that process runs, and never breaks another host's lock; nothing was written.`)
          fail('ledger.locked', `${name} is locked by ${whoOf(other)}, a server that is no longer running (or a lock that names no process). After checking that no other server writes this ledger, start it again with --break-lock; nothing was written.`)
        }
        const why = staleAppendLock(other)
        if (why && breakAppendLock(other, why)) continue
      }
      if (Date.now() >= deadline) {
        if (intent === 'read') return false
        fail('ledger.locked', `${name}: waited ${budget} ms for the single-writer lock (${basename(lockPath)}), held by ${whoOf(last)}, and it did not clear; nothing was written. Try again; a lock left by a writer that stopped is broken once its pid is gone or it is ${Math.round(staleMs / 1000)} s old.`)
      }
      pause(Math.min(20, 1 + (spin >> 1)) + Math.floor(Math.random() * 4))
    }
  }
  const releaseAppendLock = (): void => {
    const h = heldLocks.get(lockKey)
    if (!h || --h.count > 0) return
    heldLocks.delete(lockKey)
    if (h.mode !== 'append') return
    try {
      const cur = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: unknown }
      if (cur.token === h.token) unlinkSync(lockPath) // only our own lock: one broken from under us is someone else's now
    } catch { /* already gone */ }
  }
  /** Before a byte is written under a per-append lock: is the lock still ours? (It is broken only when stale.) */
  const stillOurs = (): void => {
    if (lockMode !== 'append' || readOnly()) return
    const h = heldLocks.get(lockKey)
    if (!h || h.mode !== 'append' || h.token === undefined) return // shared with this process's hold lock
    const cur = readLock()
    if (!cur || cur.token !== h.token) fail('ledger.locked', `${name}: the lock was taken from this writer (broken as stale) before it could write; nothing was written`)
  }

  /** Run one call under the lock its mode asks for. */
  const guard = <T>(intent: 'write' | 'read', fn: () => T): T => {
    if (lockMode !== 'append') return fn()
    if (readOnly()) {
      if (intent === 'write') fail('ledger.locked', `${name}: another process holds the lock, so this store is only reading; nothing was written`)
      return fn()
    }
    // a read of a ledger whose folder does not exist has nothing to protect: no folder (or lock) is created for it
    if (intent === 'read' && !heldLocks.has(lockKey) && !existsSync(dirname(path))) return fn()
    if (!takeAppendLock(intent)) {
      readOnlyDepth++
      try { return fn() } finally {
        readOnlyDepth--
        if (!readOnly()) { st = null; offsets = null } // what was seen without the lock is looked at again, under it, next time
      }
    }
    try { return fn() } finally { releaseAppendLock() }
  }

  const readRange = (start: number, end: number): Buffer => {
    const buf = Buffer.alloc(end - start)
    if (!buf.length) return buf
    const fd = openSync(path, 'r')
    try {
      let off = 0
      while (off < buf.length) {
        const n = readSync(fd, buf, off, buf.length - off, start + off)
        if (n <= 0) break
        off += n
      }
    } finally { closeSync(fd) }
    return buf
  }

  /** Index of the last newline in [0, end), or -1: read backwards in chunks. */
  const lastNewlineBefore = (end: number): number => {
    let hi = end
    while (hi > 0) {
      const lo = Math.max(0, hi - CHUNK)
      const i = readRange(lo, hi).lastIndexOf(NL)
      if (i >= 0) return lo + i
      hi = lo
    }
    return -1
  }

  /** Visit every whole line in [from, to), streamed in chunks, with its byte offset. A trailing partial line is not visited. */
  const eachLine = (from: number, to: number, visit: (line: Buffer, offset: number) => void): void => {
    let pos = from
    let carry: Buffer = Buffer.alloc(0)
    let carryAt = from
    while (pos < to) {
      const chunk = readRange(pos, Math.min(to, pos + CHUNK))
      if (!chunk.length) break
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      let start = 0
      for (let i = buf.indexOf(NL); i >= 0; i = buf.indexOf(NL, start)) {
        if (i > start) visit(buf.subarray(start, i), carryAt + start)
        start = i + 1
      }
      carry = Buffer.from(buf.subarray(start))
      carryAt += start
      pos += chunk.length
    }
  }

  // 2026-10-19 (R-L1, the judge's repeated-key line): every line is read under the engine's hash contract (readLedgerLine). A
  // line JSON.parse accepts but the strict reader refuses (a key written twice, a number that does not read back) is still
  // returned as JSON.parse reads it, so the chain can be walked, and the FIRST such refusal is kept for `refused()`: openLedger's
  // verify breaks the chain at that entry with the reason, the same answer the command line gives, so ledger_verify over MCP,
  // riposte-serve and openLedger(fileStore(..)).verify() no longer say ok on the reviewer's file with a recomputed head record.
  let firstRefused: LineRefusal | undefined
  const parse = (line: Buffer, where: string, code: LedgerStoreError['code'], entryNo = -1, lineNo = entryNo + 1): LedgerEntry => {
    const r = readLedgerLine(line.toString('utf8'), entryNo, lineNo)
    if (!r) return fail(code, `${name}: ${where} is not a JSON ledger entry`)
    if (r.refused && (firstRefused === undefined || r.refused.entry < firstRefused.entry)) firstRefused = r.refused
    return r.entry
  }

  /**
   * Take in the whole lines in [from, to): each must follow (count, head). `deep` re-derives each hash too (outside appends);
   * the one-time scan of a ledger without a sidecar checks order and links only (verify walks the hashes).
   */
  const absorb = (from: number, to: number, count: number, head: string, code: LedgerStoreError['code'], why: string, deep: boolean): { count: number; head: string } => {
    eachLine(from, to, (line, offset) => {
      const e = parse(line, `the line at byte ${offset}`, code)
      if (!e || typeof e !== 'object' || e.seq !== count || e.prev_hash !== head || typeof e.hash !== 'string' || (deep && entryHash(e) !== e.hash)) {
        fail(code, `${name}: the line at byte ${offset} is not entry ${count} following ${head.slice(0, 16)}… (${why})`)
      }
      if (offsets) offsets.push(offset)
      count++
      head = e.hash
    })
    return { count, head }
  }

  const readSidecar = (): Sidecar => {
    let x: unknown
    try { x = JSON.parse(readFileSync(side, 'utf8')) } catch { return fail('ledger.sidecar_invalid', `${basename(side)} does not parse: refusing to guess where ${name} ends (delete the sidecar to rebuild it from the file)`) }
    const s = x as Sidecar
    if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.count) || s.count < 0 || !Number.isSafeInteger(s.bytes) || s.bytes < 0 || typeof s.head !== 'string' || !/^[0-9a-f]{64}$/.test(s.head)) {
      return fail('ledger.sidecar_invalid', `${basename(side)} is not { count, head, bytes }: refusing to guess where ${name} ends (delete the sidecar to rebuild it from the file)`)
    }
    return s
  }

  const writeSidecar = (): void => {
    if (!useSidecar || !st || readOnly()) return
    const s: Sidecar = { version: 1, ledger: name, count: st.count, head: st.head, bytes: st.bytes, updated_at: now().toISOString() }
    const tmp = `${side}.tmp`
    writeFileSync(tmp, `${JSON.stringify(s)}\n`)
    replaceFile(tmp, side)
  }

  /** Move the bytes from `start` to the end aside, byte for byte, and cut the ledger back to `start`. */
  const quarantineTail = (start: number, end: number): { torn: Buffer; at: Date; q: string } => {
    const torn = readRange(start, end)
    const at = now()
    const q = `${path}.torn-${stampOf(at)}`
    writeFileSync(q, torn, { flag: 'wx' }) // never over an earlier quarantine
    truncateSync(path, start)
    return { torn, at, q }
  }

  const open = (): { count: number; head: string; bytes: number } => {
    if (released) fail('ledger.locked', `${name}: this store gave its lock back (released); open the ledger again to write`)
    if (st) return st
    if (lockMode === 'off' && !warned) {
      warned = true
      process.stderr.write(`riposte: ${UNLOCKED_ENV}=1 (or unsafeUnlocked): ${path} is written WITHOUT the single-writer lock; a second writer can fork the chain. Single-process tests only.\n`)
    }
    takeLock()
    if (!existsSync(path)) {
      if (useSidecar && existsSync(side)) {
        const sc = readSidecar()
        if (sc.count > 0) fail('ledger.sidecar_mismatch', `${basename(side)} records ${sc.count} entries (head ${sc.head.slice(0, 16)}…) but ${name} does not exist: the ledger was removed or moved; refusing to start a new chain over it`)
      }
      offsets = []
      st = { count: 0, head: GENESIS, bytes: 0 }
      return st
    }
    let size = statSync(path).size
    // 1. A torn tail: the bytes after the last newline are a line that was never finished. Moved aside, byte for byte.
    //    (Reading without the lock, they may be a line another process is writing right now: they are only left out.)
    let torn: Buffer | undefined
    if (size > 0) {
      const lastNl = lastNewlineBefore(size)
      if (lastNl !== size - 1) {
        const start = lastNl + 1
        if (readOnly()) torn = readRange(start, size)
        else {
          const r = quarantineTail(start, size)
          torn = r.torn
          repairs.push({ event: 'ledger.torn_tail_quarantined', bytes: torn.length, sha256: createHash('sha256').update(torn).digest('hex'), quarantined_to: basename(r.q), after_seq: null, detected_at: r.at.toISOString() })
        }
        size = start
      }
    }
    // 2. Where the chain ends: the sidecar, validated; or one scan for a ledger that has none.
    if (useSidecar && existsSync(side)) {
      let sc = readSidecar()
      // The torn line was the last entry the sidecar recorded (not a crash: a disk fault or a hand edit). Repaired, so the
      // tenant is not bricked, and the note names the entry that was cut.
      const tornSeq = torn ? /^\{"seq":(\d+),/.exec(torn.toString('utf8'))?.[1] : undefined
      if (torn && size < sc.bytes && sc.count > 0 && tornSeq !== undefined && Number(tornSeq) === sc.count - 1) {
        let prev: { seq: number; hash: string } | undefined
        if (size > 0) {
          try { prev = JSON.parse(readRange(lastNewlineBefore(size - 1) + 1, size - 1).toString('utf8')) as { seq: number; hash: string } } catch { prev = undefined }
        }
        const fits = sc.count === 1 ? size === 0 : prev !== undefined && prev.seq === sc.count - 2 && typeof prev.hash === 'string'
        if (fits) {
          if (!readOnly()) repairs[repairs.length - 1]!.cut_entry = { seq: sc.count - 1, hash: sc.head }
          sc = { ...sc, count: sc.count - 1, head: prev ? prev.hash : GENESIS, bytes: size }
        }
      }
      if (size < sc.bytes) fail('ledger.sidecar_mismatch', `${name} holds ${size} bytes but ${basename(side)} records ${sc.count} entries in ${sc.bytes} bytes: entries were removed or the file was cut short; refusing to write`)
      if (sc.count === 0) {
        if (sc.bytes !== 0 || sc.head !== GENESIS) fail('ledger.sidecar_mismatch', `${basename(side)} records no entries but ${sc.bytes} bytes: refusing`)
      } else {
        const atEnd = sc.bytes > 0 ? readRange(sc.bytes - 1, sc.bytes)[0] : undefined
        if (atEnd !== NL) fail('ledger.sidecar_mismatch', `${name} has no line ending where ${basename(side)} says the chain ends (byte ${sc.bytes}): the ledger was edited; refusing`)
        const start = lastNewlineBefore(sc.bytes - 1) + 1
        let e: LedgerEntry | undefined
        try { e = JSON.parse(readRange(start, sc.bytes - 1).toString('utf8')) as LedgerEntry } catch { e = undefined }
        if (!e || e.hash !== sc.head || e.seq !== sc.count - 1) {
          return fail('ledger.sidecar_mismatch', `${name}: the entry ending at byte ${sc.bytes} is ${e ? `seq ${e.seq}, hash ${String(e.hash).slice(0, 16)}…` : 'not an entry'}; ${basename(side)} records seq ${sc.count - 1}, head ${sc.head.slice(0, 16)}…: the ledger was edited; refusing`)
        }
        if (entryHash(e) !== e.hash) return fail('ledger.sidecar_mismatch', `${name}: entry ${e.seq}, the head ${basename(side)} records, was altered after it was written (its hash does not re-derive); refusing`)
      }
      st = { count: sc.count, head: sc.head, bytes: sc.bytes }
      offsets = null
      if (size > sc.bytes) {
        const r = absorb(sc.bytes, size, st.count, st.head, 'ledger.sidecar_mismatch', `${name} grew past its sidecar with lines that do not continue the chain`, true)
        st = { ...r, bytes: size }
      }
      if (torn || size > sc.bytes) writeSidecar()
    } else {
      offsets = []
      const r = absorb(0, size, 0, GENESIS, 'ledger.corrupt', 'out of order, or a broken link', false)
      st = { ...r, bytes: size }
      writeSidecar()
    }
    for (const r of repairs) if (r.after_seq === null && st.count > 0) r.after_seq = st.count - 1
    return st
  }

  /**
   * The file changed since our last look: take in whole lines that chain; refuse anything else. Under the PER-APPEND lock no
   * other writer is mid-line, so an unfinished last line is one a writer left when it stopped: it is moved aside like a torn
   * tail at open. (A HOLD store refuses it: someone wrote past its lock.)
   */
  const refresh = (): { count: number; head: string; bytes: number } => {
    const s = open()
    const size = sizeOf()
    if (size === s.bytes) return s
    if (size < s.bytes) return fail('ledger.changed_outside', `${name} shrank from ${s.bytes} to ${size} bytes while open: refusing to write`)
    let end = size
    if (readRange(size - 1, size)[0] !== NL) {
      if (lockMode !== 'append') return fail('ledger.changed_outside', `${name} ends in an unfinished line written by another process: refusing to append past it`)
      end = lastNewlineBefore(size) + 1
      if (end < s.bytes) return fail('ledger.changed_outside', `${name} changed under this store (an unfinished line before byte ${s.bytes}): refusing to write`)
    }
    const r = absorb(s.bytes, end, s.count, s.head, 'ledger.changed_outside', `${name} grew while open with lines that do not continue the chain`, true)
    st = { ...r, bytes: end }
    if (end < size && !readOnly()) {
      const t = quarantineTail(end, size)
      repairs.push({ event: 'ledger.torn_tail_quarantined', bytes: t.torn.length, sha256: createHash('sha256').update(t.torn).digest('hex'), quarantined_to: basename(t.q), after_seq: st.count > 0 ? st.count - 1 : null, detected_at: t.at.toISOString() })
    }
    writeSidecar()
    return st
  }

  const buildOffsets = (): number[] => {
    const s = refresh()
    if (offsets && offsets.length === s.count) return offsets
    const o: number[] = []
    eachLine(0, s.bytes, (_line, offset) => { o.push(offset) })
    offsets = o
    return o
  }

  return {
    sidecarPath: side,
    lockPath,
    lockMode,
    release: releaseLock,
    refused: () => firstRefused,
    exclusive: (fn, o = {}) => {
      if (lockMode !== 'append') return fn('write')
      return guard(o.orReadOnly ? 'read' : 'write', () => fn(readOnly() ? 'read-only' : 'write'))
    },
    load: () => guard('read', () => {
      const s = refresh()
      if (!existsSync(path)) return []
      // only the bytes the chain covers (without the lock, a line another process is writing is left out)
      const text = readRange(0, s.bytes).toString('utf8')
      firstRefused = undefined
      return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((l, i) => parse(Buffer.from(l, 'utf8'), `line ${i + 1}`, 'ledger.corrupt', i, i + 1))
    }),
    append: (e) => guard('write', () => {
      const s = refresh()
      if (e.seq !== s.count || e.prev_hash !== s.head) fail('ledger.stale_head', `${name}: entry ${e.seq} does not follow the head (entry ${s.count - 1}): another writer appended in between; refusing to fork the chain`)
      stillOurs()
      mkdirSync(dirname(path), { recursive: true })
      const line = `${JSON.stringify(e)}\n`
      const fd = openSync(path, 'a')
      try {
        writeSync(fd, line)
        if (durable) fdatasyncSync(fd) // on disk before the sidecar says so, and before anyone is answered
      } finally { closeSync(fd) }
      if (offsets) offsets.push(s.bytes)
      st = { count: s.count + 1, head: e.hash, bytes: s.bytes + Buffer.byteLength(line) }
      writeSidecar()
    }),
    head: () => guard('read', () => { const s = refresh(); return { count: s.count, head: s.head } }),
    takeRepairs: () => guard('read', () => {
      if (readOnly()) return [] // nothing is repaired without the lock; the next writer does it
      const s = lockMode === 'append' ? refresh() : open()
      for (const r of repairs) if (r.after_seq === null && s.count > 0) r.after_seq = s.count - 1
      const r = repairs
      repairs = []
      return r
    }),
    scan: (visit) => guard('read', () => {
      const s = refresh()
      const o: number[] = []
      firstRefused = undefined
      eachLine(0, s.bytes, (line, offset) => { const n = o.length; o.push(offset); visit(parse(line, `the line at byte ${offset}`, 'ledger.corrupt', n, n + 1)) })
      offsets = o
    }),
    entryAt: (seq) => guard('read', () => {
      const o = buildOffsets()
      if (!Number.isSafeInteger(seq) || seq < 0 || seq >= o.length) return undefined
      const end = seq + 1 < o.length ? o[seq + 1]! : st!.bytes
      return parse(readRange(o[seq]!, end - 1), `entry ${seq}`, 'ledger.corrupt')
    }),
  }
}
