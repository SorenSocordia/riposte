/**
 * What one check may cost the HTTP service (2026-10-06). The transport (./serve.ts) bounds the BYTES of a request; this bounds
 * its WORK. An outside engineer sent one in-cap request to POST /v1/verify/citations (a 9 KB quotation against a 460 KB text):
 * it held the only thread for 29 s, so /v1/health waited 26.6 s, and a 3.48 MB request, under the route's 4 MiB cap, ran the
 * process out of heap and killed it. The check ran on the thread that answers every request, with no limit but the machine's.
 *
 * `verify serve` now runs every POST in a pool of worker threads, each check under three limits:
 *   - TIME: `timeoutMs` of wall clock from the moment a worker starts the check (default 60 s). Past it the worker is stopped.
 *   - MEMORY: `heapMb` of heap per worker (default 512 MiB, V8's old generation). Past it the runtime stops the worker.
 *   - CONCURRENCY: `workers` checks at once (default 2); at most `maxQueue` requests (default 16) holding at most `maxQueuedBytes`
 *     of body (default 64 MiB) wait for a worker, each for at most `timeoutMs`; past any of these, 503 with Retry-After, in
 *     words.
 * A check stopped by its time or memory limit is answered 413 with "input too large to check within the service's budget; run
 * it with the command line", and the headers `x-verify-gate: INSUFFICIENT_DATA` and `x-verify-exit: 2`, so a caller that wires
 * the answer to an action fails closed. It is never a verdict: a verdict depends only on its inputs, and this answer depends on
 * the machine. The command line has no budget and answers the same input with the verdict. Only the worker ends; the thread
 * that answers requests, and every other request, stay up, and the next check gets a fresh worker. GET requests (health, the
 * OpenAPI description) are answered on the transport's own thread, so they answer while a check runs.
 */

import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { RequestMeta } from './answer.js'
import type { CheckAnswer, CheckJob } from './check-worker.js'
import type { HttpRequest } from './router.js'

/** What one check may cost. Every field is optional; see DEFAULT_BUDGET. */
export interface CheckBudget {
  /** Wall clock one check may run, in ms, counted from the moment a worker starts it. */
  timeoutMs?: number
  /** Heap one worker may use, in MiB (V8's old generation). */
  heapMb?: number
  /** Checks that run at once, each in its own worker thread. */
  workers?: number
  /** Requests that may wait for a worker. Past it: 503. */
  maxQueue?: number
  /** Body bytes the waiting requests may hold between them. Past it: 503. */
  maxQueuedBytes?: number
}

export const DEFAULT_BUDGET: Readonly<Required<CheckBudget>> = Object.freeze({
  timeoutMs: 60_000,
  heapMb: 512,
  workers: 2,
  maxQueue: 16,
  maxQueuedBytes: 64 * 1024 * 1024,
})

/** The budget with the defaults filled in, checked (each a positive integer; at least 32 MiB of heap). */
export function resolveBudget(b: CheckBudget = {}): Required<CheckBudget> {
  const r: Required<CheckBudget> = { ...DEFAULT_BUDGET, ...b }
  for (const k of ['timeoutMs', 'heapMb', 'workers', 'maxQueue', 'maxQueuedBytes'] as const) {
    if (!Number.isSafeInteger(r[k]) || r[k] < 1) throw new RangeError(`${k} must be a positive integer, not ${String(r[k])}`)
  }
  if (r.heapMb < 32) throw new RangeError(`heapMb must be at least 32 (MiB), not ${r.heapMb}`)
  return r
}

/** The budget from the environment: VERIFY_CHECK_TIMEOUT_MS, VERIFY_CHECK_HEAP_MB, VERIFY_CHECK_WORKERS. */
export function budgetFromEnv(env: Record<string, string | undefined> = process.env): CheckBudget {
  const out: CheckBudget = {}
  const int = (k: string): number | undefined => {
    const v = env[k]
    if (v === undefined || v === '') return undefined
    if (!/^\d+$/.test(v)) throw new RangeError(`${k} must be a positive integer, not ${JSON.stringify(v)}`)
    return Number(v)
  }
  const t = int('VERIFY_CHECK_TIMEOUT_MS'), h = int('VERIFY_CHECK_HEAP_MB'), w = int('VERIFY_CHECK_WORKERS')
  if (t !== undefined) out.timeoutMs = t
  if (h !== undefined) out.heapMb = h
  if (w !== undefined) out.workers = w
  return out
}

/** The words every answer to a check stopped by its budget carries. */
export const BUDGET_WORDS = "input too large to check within the service's budget; run it with the command line"

/** An answer the pool gives, its body serialized (the worker's own, or one of the pool's refusals). */
export type PoolAnswer = Omit<CheckAnswer, 'id'>

/** A check handed to the pool: its answer, and a way to withdraw it while it still waits for a worker. */
export interface PendingCheck { answer: Promise<PoolAnswer>; cancel(): void }

export interface CheckPool {
  /** Read, route and answer a request's body in a worker. */
  runBytes(meta: RequestMeta, bytes: Uint8Array | undefined, errorCodes: boolean): PendingCheck
  /** Route a request already read, in a worker (a managed tier's call into the pure core). */
  runRequest(req: HttpRequest, errorCodes: boolean): PendingCheck
  /** Stop every worker; checks still waiting are answered 503. */
  close(): Promise<void>
  /** How many workers are up, how many checks run, how many wait. */
  stats(): { workers: number; running: number; queued: number }
  readonly budget: Readonly<Required<CheckBudget>>
}

/** Where the worker's code is: the built file beside this one, or, running from source, the TypeScript file through tsx. */
function workerEntry(): { url: URL; execArgv: string[] } {
  const here = import.meta.url
  if (here.endsWith('.ts')) {
    const require = createRequire(here)
    return { url: new URL('./check-worker.ts', here), execArgv: ['--import', pathToFileURL(require.resolve('tsx/esm')).href] }
  }
  return { url: new URL('./check-worker.js', here), execArgv: [] }
}

interface Job { id: number; message: CheckJob; bytes: number; errorCodes: boolean; resolve: (a: PoolAnswer) => void; done: boolean }
interface Slot { worker: Worker; ready: boolean; job: Job | undefined; timer: NodeJS.Timeout | undefined }

const json = (status: number, body: object, headers?: Record<string, string>): PoolAnswer => ({ status, text: JSON.stringify(body), ...(headers ? { headers } : {}) })
const coded = (errorCodes: boolean, code: string, body: object): object => (errorCodes ? { ...body, code } : body)

/**
 * Another worker script for the pool, speaking the same messages as ./check-worker.ts (a `{ ready: true }` first, then one
 * CheckAnswer per CheckJob). For the pool's own tests, which need a check that is slow or large on demand, whatever the
 * engine's own costs; `serve` always uses the check worker.
 */
export interface WorkerEntry { url: URL; execArgv?: string[] }

/**
 * A pool of check workers under `budget` (resolveBudget). Workers start on demand and are replaced after one is stopped. They
 * do not keep the process alive on their own (a pending check always has an open socket that does).
 */
export function createCheckPool(budget: CheckBudget = {}, opts: { entry?: WorkerEntry } = {}): CheckPool {
  const b = resolveBudget(budget)
  const slots: Slot[] = []
  const queue: Job[] = []
  let queuedBytes = 0
  let nextId = 1
  let closed = false

  const finish = (job: Job, a: PoolAnswer): void => { if (job.done) return; job.done = true; job.resolve(a) }

  const overBudget = (job: Job, kind: 'time' | 'memory'): PoolAnswer => {
    const why = kind === 'time'
      ? `the check ran past ${b.timeoutMs} ms and was stopped`
      : `the check needed more than ${b.heapMb} MiB of memory and was stopped`
    return json(413, coded(job.errorCodes, 'budget.exceeded', {
      outcome: 'INSUFFICIENT_DATA',
      error: `${BUDGET_WORDS}: ${why}. This is not a verdict. The command line checks the same input with no budget; a server started with a larger budget (--check-timeout-ms, --check-heap-mb) may answer it too`,
      budget: { exceeded: kind, timeout_ms: b.timeoutMs, heap_mb: b.heapMb },
    }), { 'x-verify-gate': 'INSUFFICIENT_DATA', 'x-verify-exit': '2' })
  }

  const crashed = (job: Job, detail: string): PoolAnswer => json(500, coded(job.errorCodes, 'internal', { error: `internal error: the check stopped before it answered (${detail})` }))

  function spawn(): Slot {
    const entry = opts.entry ?? workerEntry()
    const worker = new Worker(entry.url, { execArgv: entry.execArgv ?? [], resourceLimits: { maxOldGenerationSizeMb: b.heapMb } })
    worker.unref()
    const slot: Slot = { worker, ready: false, job: undefined, timer: undefined }
    let lastError: (Error & { code?: string }) | undefined
    worker.on('message', (m: CheckAnswer | { ready: true }) => {
      if ('ready' in m) { slot.ready = true; pump(); return }
      const job = slot.job
      if (!job || m.id !== job.id) return
      clearTimeout(slot.timer)
      slot.job = undefined
      const { id: _id, ...a } = m
      finish(job, a)
      pump()
    })
    worker.on('error', (e: Error & { code?: string }) => { lastError = e })
    worker.on('exit', () => {
      clearTimeout(slot.timer)
      const i = slots.indexOf(slot)
      if (i >= 0) slots.splice(i, 1)
      const job = slot.job
      slot.job = undefined
      if (job) {
        if (closed) finish(job, json(503, coded(job.errorCodes, 'budget.busy', { error: 'the server stopped before the check answered' })))
        else if (lastError?.code === 'ERR_WORKER_OUT_OF_MEMORY') finish(job, overBudget(job, 'memory'))
        else finish(job, crashed(job, lastError ? lastError.message : 'the worker exited'))
      } else if (!slot.ready && lastError) {
        // the worker never started (its file is missing, or it failed to load): the requests waiting for one cannot be checked
        for (const q of queue.splice(0)) { queuedBytes -= q.bytes; finish(q, crashed(q, `the check worker could not start: ${lastError.message}`)) }
      }
      pump()
    })
    slots.push(slot)
    return slot
  }

  function start(slot: Slot, job: Job): void {
    slot.job = job
    slot.timer = setTimeout(() => {
      if (slot.job !== job) return
      finish(job, overBudget(job, 'time'))
      void slot.worker.terminate() // 'exit' removes the slot; the next check gets a fresh worker
    }, b.timeoutMs)
    slot.timer.unref()
    const transfer = job.message.kind === 'bytes' && job.message.bytes ? [job.message.bytes.buffer as ArrayBuffer] : []
    slot.worker.postMessage(job.message, transfer)
  }

  function pump(): void {
    if (closed) return
    while (queue.length > 0) {
      const idle = slots.find(s => s.ready && s.job === undefined)
      if (idle) {
        const job = queue.shift()!
        queuedBytes -= job.bytes
        if (job.done) continue
        start(idle, job)
        continue
      }
      // a worker still starting will take the next job when it is ready; start one more while under the limit
      const starting = slots.filter(s => !s.ready).length
      if (slots.length < b.workers && starting < queue.length) { spawn(); continue }
      return
    }
  }

  function submit(message: CheckJob, bytes: number, errorCodes: boolean): PendingCheck {
    let resolve!: (a: PoolAnswer) => void
    const answer = new Promise<PoolAnswer>(r => { resolve = r })
    const job: Job = { id: message.id, message, bytes, errorCodes, resolve, done: false }
    if (closed) {
      finish(job, json(503, coded(errorCodes, 'budget.busy', { error: 'the server is stopping; no check was run' })))
      return { answer, cancel: () => {} }
    }
    const running = slots.filter(s => s.job !== undefined).length
    if (queue.length >= b.maxQueue || queuedBytes + bytes > b.maxQueuedBytes) {
      finish(job, json(503, coded(errorCodes, 'budget.busy', {
        error: `the server is busy: ${running} check(s) running and ${queue.length} waiting, the most it holds (${b.workers} at once; ${b.maxQueue} waiting, or ${b.maxQueuedBytes} bytes of waiting bodies). Nothing was checked; try again shortly`,
      }), { 'retry-after': '1' }))
      return { answer, cancel: () => {} }
    }
    queue.push(job)
    queuedBytes += bytes
    // a request waits for a worker at most one check's time; then it is answered 503 and never runs, so no request is held
    // longer than about twice the time budget
    const waited = setTimeout(() => {
      const i = queue.indexOf(job)
      if (i < 0) return
      queue.splice(i, 1)
      queuedBytes -= job.bytes
      finish(job, json(503, coded(errorCodes, 'budget.busy', {
        error: `the server is busy: this request waited ${b.timeoutMs} ms for a free worker (${b.workers} at once) and was not checked; try again shortly`,
      }), { 'retry-after': '1' }))
    }, b.timeoutMs)
    waited.unref()
    pump()
    return {
      answer,
      cancel: () => {
        // withdrawn while it waits (the client went away): it never runs. A check already running finishes within its budget.
        const i = queue.indexOf(job)
        if (i >= 0) { queue.splice(i, 1); queuedBytes -= job.bytes; job.done = true }
        clearTimeout(waited)
      },
    }
  }

  return {
    budget: b,
    runBytes(meta, bytes, errorCodes) {
      // a fresh copy the worker takes over (transferred, not cloned): the transport's buffer may share memory with others
      const own = bytes && bytes.length > 0 ? new Uint8Array(bytes) : undefined
      return submit({ id: nextId++, kind: 'bytes', meta, bytes: own, errorCodes }, own?.length ?? 0, errorCodes)
    },
    runRequest(req, errorCodes) {
      return submit({ id: nextId++, kind: 'request', req, errorCodes }, 0, errorCodes)
    },
    async close() {
      closed = true
      for (const q of queue.splice(0)) finish(q, json(503, coded(q.errorCodes, 'budget.busy', { error: 'the server is stopping; no check was run' })))
      queuedBytes = 0
      await Promise.all(slots.splice(0).map(s => { clearTimeout(s.timer); return s.worker.terminate() }))
    },
    stats() {
      return { workers: slots.length, running: slots.filter(s => s.job !== undefined).length, queued: queue.length }
    },
  }
}
