/**
 * What one check may cost `verify serve` (2026-10-06; src/http/budget.ts).
 *
 * An outside engineer's 467 KB request to POST /v1/verify/citations (a 9 KB repetitive quotation against a 460 KB text) held the
 * server's only thread for 29 s, and a 3.48 MB one ran the process out of heap and killed it. These pin the fix: every POST is
 * checked in a worker thread; past its time or heap budget the worker is stopped and the answer is 413 "input too large to check
 * within the service's budget; run it with the command line" with x-verify-exit 2; /v1/health answers while a check runs; the
 * process survives and the next check gets a fresh worker; past the queue the answer is 503. The limits are driven through a
 * stand-in worker that spins or allocates on request; the engineer's request shape is built here and sent to the real worker.
 *
 * Every server binds 127.0.0.1 on a random port and is closed, with its workers, after its test.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve, runServe, createHttpServer } from '../src/http/serve'
import { route } from '../src/http/router'
import { createCheckPool, resolveBudget, budgetFromEnv, DEFAULT_BUDGET, BUDGET_WORDS, type CheckBudget } from '../src/http/budget'
import { clean } from './fixtures/invoices'

const quiet = { out: () => {}, err: () => {} }
const servers: ReturnType<typeof createHttpServer>[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())) }
})

async function start(budget: CheckBudget, errorCodes = true): Promise<number> {
  const s = serve(0, { log: quiet, budget, errorCodes })
  servers.push(s)
  await new Promise<void>(r => s.on('listening', () => r()))
  return (s.address() as AddressInfo).port
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; json: Record<string, unknown>; ms: number }
function call(port: number, method: string, path: string, body?: unknown): Promise<Reply> {
  const t0 = performance.now()
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json' } }, res => {
      const parts: Buffer[] = []
      res.on('data', c => parts.push(c as Buffer))
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8')
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json: text ? JSON.parse(text) as Record<string, unknown> : {}, ms: performance.now() - t0 })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body))
    else req.end()
  })
}

/**
 * The engineer's shape: a repetitive quotation (counting by sevens) against a long repetitive text (counting by ones), so it is
 * never found verbatim and the search for the nearest passage is costly in time and memory.
 */
function costlyCitations(quotePhrases = 450, sourcePhrases = 23_000): unknown {
  const phrase = (n: number): string => `the court held that ${n}`
  const quote = Array.from({ length: quotePhrases }, (_, i) => phrase(i * 7)).join(' ')
  const text = `Makarova v. United States, 201 F.3d 110\n${Array.from({ length: sourcePhrases }, (_, i) => phrase(i % 2000)).join(' ')}.`
  return { citations: [{ id: 'X1', cite: '201 F.3d 110', case_name: 'Makarova v. United States', source_key: '201 F.3d 110', quote }], sources: { '201 F.3d 110': text } }
}

describe('the check budget', () => {
  it('defaults and reading: 60 s, 512 MiB, 2 workers, 16 waiting; the environment and resolveBudget refuse what is not a positive integer', () => {
    expect(DEFAULT_BUDGET).toMatchObject({ timeoutMs: 60_000, heapMb: 512, workers: 2, maxQueue: 16 })
    expect(budgetFromEnv({ VERIFY_CHECK_TIMEOUT_MS: '5000', VERIFY_CHECK_HEAP_MB: '256', VERIFY_CHECK_WORKERS: '4' })).toEqual({ timeoutMs: 5000, heapMb: 256, workers: 4 })
    expect(() => budgetFromEnv({ VERIFY_CHECK_TIMEOUT_MS: '5s' })).toThrow(/VERIFY_CHECK_TIMEOUT_MS must be a positive integer/)
    expect(() => resolveBudget({ workers: 0 })).toThrow(/workers must be a positive integer/)
    expect(() => resolveBudget({ heapMb: 16 })).toThrow(/heapMb must be at least 32/)
  })

  it('verify serve takes --check-timeout-ms, --check-heap-mb and --check-workers; a bad value is a usage error (exit 3)', async () => {
    const errs: string[] = []
    const log = { out: () => {}, err: (s: string) => { errs.push(s) } }
    expect(runServe(['--check-timeout-ms', 'soon'], { log, env: {} }).code).toBe(3)
    expect(errs.join('')).toContain('--check-timeout-ms must be a positive whole number, not "soon"')
    expect(runServe(['--check-heap-mb', '8'], { log, env: {} }).code).toBe(3)
    expect(errs.join('')).toContain('heapMb must be at least 32')
    expect(runServe(['--check-workers'], { log, env: {} }).code).toBe(3)
    const r = runServe(['--port', '0', '--check-timeout-ms', '9000', '--check-heap-mb', '256', '--check-workers', '1'], { log, env: { VERIFY_CHECK_TIMEOUT_MS: '1000' } })
    expect(r.code).toBe(0)
    servers.push(r.server!)
    await new Promise<void>(res => r.server!.on('listening', () => res()))
  })

  it('a check runs in a worker: the same verdict as before, with its exit headers', async () => {
    const port = await start({})
    const r = await call(port, 'POST', '/v1/verify', { extraction: clean })
    expect(r.status).toBe(200)
    expect(r.json.outcome).toBeDefined()
    expect(r.headers['x-verify-exit']).toBeDefined()
    const h = await call(port, 'GET', '/v1/health')
    expect(h.status).toBe(200)
  })

  // The time, memory and queue limits are tested through a stand-in worker (test/fixtures/budget-worker.mjs) that spins or
  // allocates on request, so these tests hold whatever the engine's own checks cost (the legal matcher that showed the problem
  // has since been bounded). The real check worker is tested above and below.
  const STAND_IN = { url: new URL('./fixtures/budget-worker.mjs', import.meta.url) }
  async function startStandIn(budget: CheckBudget): Promise<number> {
    const s = createHttpServer(route, {}, { errorCodes: true, checks: createCheckPool(budget, { entry: STAND_IN }) })
    servers.push(s)
    await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))
    return (s.address() as AddressInfo).port
  }

  it('past its time budget a check is stopped: 413 in words, x-verify-exit 2, never a verdict; /v1/health answers while it runs', async () => {
    const port = await startStandIn({ timeoutMs: 1_500 })
    await call(port, 'POST', '/v1/verify', {}) // the worker is up before the clock starts
    let answered = false
    const slow = call(port, 'POST', '/v1/verify/citations', { spin_ms: 20_000 }).then(r => { answered = true; return r })
    await new Promise(r => setTimeout(r, 200))
    const during: number[] = []
    for (let i = 0; i < 5; i++) {
      const h = await call(port, 'GET', '/v1/health')
      expect(h.status).toBe(200)
      if (!answered) during.push(h.ms)
      await new Promise(r => setTimeout(r, 100))
    }
    expect(during.length).toBeGreaterThan(0) // health answered while the check was still running
    expect(Math.max(...during)).toBeLessThan(500)
    const r = await slow
    expect(r.status).toBe(413)
    expect(r.headers['x-verify-gate']).toBe('INSUFFICIENT_DATA')
    expect(r.headers['x-verify-exit']).toBe('2')
    expect(r.json.code).toBe('budget.exceeded')
    expect(r.json.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.json.verdict_id).toBeUndefined()
    expect(String(r.json.error)).toContain(BUDGET_WORDS)
    expect(String(r.json.error)).toContain('the check ran past 1500 ms and was stopped')
    expect(r.json.budget).toEqual({ exceeded: 'time', timeout_ms: 1500, heap_mb: 512 })
  })

  it('past its heap budget the worker is stopped and the process stays up: the next check gets a fresh worker', async () => {
    const port = await startStandIn({ timeoutMs: 30_000, heapMb: 64 })
    const r = await call(port, 'POST', '/v1/verify/citations', { allocate: true })
    expect(r.status).toBe(413)
    expect(r.json.budget).toMatchObject({ exceeded: 'memory', heap_mb: 64 })
    expect(String(r.json.error)).toContain('the check needed more than 64 MiB of memory and was stopped')
    expect((await call(port, 'GET', '/v1/health')).status).toBe(200)
    const next = await call(port, 'POST', '/v1/verify', {})
    expect(next.status).toBe(200)
    expect(next.json).toEqual({ ok: true, path: '/v1/verify' })
  })

  it('a check that runs longer than the idle-socket timeout still gets its answer (the socket is quiet while a worker checks)', async () => {
    const s = createHttpServer(route, { idleTimeoutMs: 1_000 }, { errorCodes: true, checks: createCheckPool({ timeoutMs: 10_000 }, { entry: STAND_IN }) })
    servers.push(s)
    await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))
    const port = (s.address() as AddressInfo).port
    const r = await call(port, 'POST', '/v1/verify', { spin_ms: 2_500 })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true, path: '/v1/verify' })
  })

  it('past the queue: 503 with Retry-After, in words, and nothing checked', async () => {
    const port = await startStandIn({ timeoutMs: 1_000, workers: 1, maxQueue: 1 })
    await call(port, 'POST', '/v1/verify', {})
    const a = call(port, 'POST', '/v1/verify', { spin_ms: 5_000 })
    await new Promise(r => setTimeout(r, 200))
    const b = call(port, 'POST', '/v1/verify', { spin_ms: 5_000 })
    await new Promise(r => setTimeout(r, 200))
    const c = await call(port, 'POST', '/v1/verify', {})
    expect(c.status).toBe(503)
    expect(c.headers['retry-after']).toBe('1')
    expect(c.json.code).toBe('budget.busy')
    expect(String(c.json.error)).toContain('the server is busy: 1 check(s) running and 1 waiting')
    expect((await a).status).toBe(413)
    // b ran once a was stopped (413), or waited past one check's time for the fresh worker (503): either way it was bounded
    expect([413, 503]).toContain((await b).status)
  })

  it('the cold reviewer\'s request shape, on the real check worker, answers without holding the server', async () => {
    // a repetitive quotation against a long repetitive text: 29 s on the server's only thread before the budget; now in a worker
    const port = await start({})
    const r = call(port, 'POST', '/v1/verify/citations', costlyCitations(150, 8_000))
    const h = await call(port, 'GET', '/v1/health')
    expect(h.status).toBe(200)
    expect(h.ms).toBeLessThan(500)
    const x = await r
    expect([200, 413]).toContain(x.status) // a verdict, or the budget's answer: never a crash, never a stalled health check
  })

  it('a body the hash contract refuses is a 400 from the worker, in the same words: nesting too deep, limit 256', async () => {
    const port = await start({})
    const deep = `{"extraction":{"invoice_number":"X","junk":${'['.repeat(300)}${']'.repeat(300)}}}`
    const r = await call(port, 'POST', '/v1/verify', deep)
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('body.too_deep')
    expect(String(r.json.error)).toContain('the request body: nesting too deep, limit 256')
    const dup = await call(port, 'POST', '/v1/verify', '{"extraction":{"a":1,"a":2}}')
    expect(dup.status).toBe(400)
    expect(dup.json.code).toBe('body.duplicate_key')
    expect((await call(port, 'POST', '/v1/verify', '{"extraction":')).json.code).toBe('body.invalid_json')
  })

  it('a pool closed with its server answers what still waits with 503 and stops its workers', async () => {
    const pool = createCheckPool({ workers: 1 })
    const p = pool.runBytes({ method: 'POST', path: '/v1/verify', headers: {} }, Buffer.from(JSON.stringify({ extraction: clean })), true)
    await pool.close()
    const a = await p.answer
    expect([200, 503]).toContain(a.status)
    expect(pool.stats()).toEqual({ workers: 0, running: 0, queued: 0 })
    const after = await pool.runBytes({ method: 'POST', path: '/v1/verify', headers: {} }, undefined, true).answer
    expect(after.status).toBe(503)
  })
})
