/**
 * The HTTP transport bounds what one request may cost (red-team R2, fixed 2026-09-28, SURFACES-2 lane).
 *
 * The R2 PoC (redteam/r2-http-transport-dos.redteam.ts) showed nodeHandler buffering a body of any size before parsing,
 * routing or authenticating it. Its two BROKEN cases are here as the fixed behaviour (413, and nothing past the cap is kept),
 * its HELD case stays held, and the rest pins the other transport guarantees: a declared Content-Length over the cap is
 * refused before any body is read, per-route caps for the two routes that carry a whole document or book, malformed JSON is
 * a 400, a crash past the parse is a 500 for that request only, and slow clients (headers, body, idle) are cut off.
 *
 * The fake-stream cases drive nodeHandler directly, as the PoC does. The socket cases bind 127.0.0.1 on a random port and
 * close every server they start.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import {
  nodeHandler, createHttpServer, resolveLimits, bodyLimitFor, limitsFromEnv, DEFAULT_LIMITS, MiB, type TransportLimits,
} from '../src/http/serve'
import { route, type HttpRequest, type HttpResponse } from '../src/http/router'
import { clean } from './fixtures/invoices'

// ── the fake stream (the PoC's harness, plus a count of how many answers were written) ────────────────────────────────
function fakeReq(method: string, url: string, headers: Record<string, string> = {}) {
  const r = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string>; paused: boolean; destroyed: boolean; pause(): void; destroy(): void }
  r.method = method; r.url = url; r.headers = headers; r.paused = false; r.destroyed = false
  r.pause = () => { r.paused = true }
  r.destroy = () => { r.destroyed = true }
  return r
}
function fakeRes() {
  return {
    statusCode: 0, body: '', headers: {} as Record<string, string>, writes: 0,
    writeHead(s: number, h: Record<string, string> = {}) { this.statusCode = s; this.headers = h; this.writes++; return this },
    end(b?: string) { if (b) this.body = b },
  }
}
function drive(
  method: string, url: string, chunks: Buffer[], o: { headers?: Record<string, string>; limits?: TransportLimits; dispatch?: (r: HttpRequest) => HttpResponse } = {},
): { status: number; body: string; writes: number; paused: boolean; destroyed: boolean; headers: Record<string, string>; seen: HttpRequest[] } {
  const seen: HttpRequest[] = []
  const dispatch = o.dispatch ?? ((r: HttpRequest) => { seen.push(r); return route(r) })
  const req = fakeReq(method, url, o.headers ?? {})
  const res = fakeRes()
  nodeHandler(dispatch, o.limits)(req as never, res as never)
  for (const c of chunks) req.emit('data', c)
  req.emit('end')
  return { status: res.statusCode, body: res.body, writes: res.writes, paused: req.paused, destroyed: req.destroyed, headers: res.headers, seen }
}
const inChunks = (raw: Buffer, size = 65536): Buffer[] => {
  const out: Buffer[] = []
  for (let i = 0; i < raw.length; i += size) out.push(raw.subarray(i, i + size))
  return out
}

describe('R2 fixed: the body is capped while it streams (fake stream, as the PoC drives it)', () => {
  it('was BROKEN: a 6 MB body is refused with 413 at the 4 MiB default, never parsed or routed', () => {
    const raw = Buffer.from(JSON.stringify({ extraction: { note: 'x'.repeat(6 * 1024 * 1024) } }), 'utf8')
    let routed = 0
    const r = drive('POST', '/v1/verify', inChunks(raw), { dispatch: req => { routed++; return route(req) } })
    expect(r.status).toBe(413)
    expect(JSON.parse(r.body)).toMatchObject({ max_body_bytes: 4 * MiB })
    expect(JSON.parse(r.body).error).toMatch(/request body too large: \/v1\/verify accepts at most 4194304 bytes/)
    expect(routed).toBe(0)
    expect(r.writes).toBe(1) // exactly one answer, whatever the client sends after it
    expect(r.destroyed).toBe(true) // ~2 MB past the cap: more than the 256 KiB drain allowance, so the connection is dropped
  })

  it('just past the cap, the rest is drained (read, never kept) so the client can finish and read the 413', () => {
    const limits = { maxBodyBytes: 1000, drainBytes: 5000 }
    const within = drive('POST', '/v1/verify', inChunks(Buffer.alloc(4000, 0x20), 500), { limits })
    expect([within.status, within.writes, within.destroyed, within.paused]).toEqual([413, 1, false, false])
    const past = drive('POST', '/v1/verify', inChunks(Buffer.alloc(9000, 0x20), 500), { limits })
    expect([past.status, past.writes, past.destroyed]).toEqual([413, 1, true])
    // A declared length that fits the drain allowance is answered at once and drained; one past it closes at once.
    const smallDeclared = drive('POST', '/v1/verify', inChunks(Buffer.alloc(3000, 0x20), 500), { limits, headers: { 'content-length': '3000' } })
    expect([smallDeclared.status, smallDeclared.headers.connection, smallDeclared.paused, smallDeclared.destroyed]).toEqual([413, undefined, false, false])
    const bigDeclared = drive('POST', '/v1/verify', [], { limits, headers: { 'content-length': '6000' } })
    expect([bigDeclared.status, bigDeclared.headers.connection, bigDeclared.paused]).toEqual([413, 'close', true])
  })

  it('was BROKEN: 130 × 64 KB of whitespace (8.5 MB) is refused at the cap, not concatenated until memory runs out', () => {
    const chunk = Buffer.alloc(64 * 1024, 0x20)
    const r = drive('POST', '/v1/verify', Array.from({ length: 130 }, () => chunk))
    expect(r.status).toBe(413)
    expect(r.writes).toBe(1)
  })

  it('HELD (unchanged): a deeply nested body under the cap is a 400, not a crash', () => {
    const depth = 200_000
    const raw = `{"extraction":{"a":${'['.repeat(depth)}1${']'.repeat(depth)}}}`
    expect(drive('POST', '/v1/verify', [Buffer.from(raw, 'utf8')]).status).toBe(400)
  })

  it('a declared Content-Length over the cap is refused before a byte of body is read', () => {
    const r = drive('POST', '/v1/verify', [], { headers: { 'content-length': String(4 * MiB + 1) } })
    expect(r.status).toBe(413)
    expect(r.headers.connection).toBe('close')
    expect(r.paused).toBe(true)
    // …and the handler answered at once: a later body and end change nothing.
    const req = fakeReq('POST', '/v1/verify', { 'content-length': String(10 * MiB) })
    const res = fakeRes()
    nodeHandler(route)(req as never, res as never)
    expect(res.statusCode).toBe(413)
    req.emit('data', Buffer.from('{}')); req.emit('end')
    expect(res.writes).toBe(1)
  })

  it('the cap is exact and configurable: cap bytes pass, cap + 1 is 413', () => {
    const limits = { maxBodyBytes: 1024 }
    const body = (n: number): Buffer => {
      const pad = n - JSON.stringify({ extraction: clean, p: '' }).length
      return Buffer.from(JSON.stringify({ extraction: clean, p: 'x'.repeat(pad) }), 'utf8')
    }
    expect(body(1024).length).toBe(1024)
    expect(drive('POST', '/v1/verify', inChunks(body(1024), 100), { limits }).status).toBe(200)
    expect(drive('POST', '/v1/verify', inChunks(body(1025), 100), { limits }).status).toBe(413)
  })

  it('per-route caps: POST /v1/twin and /v1/opinion carry a whole filing or book (32 MiB); every other route is 4 MiB', () => {
    const five = Buffer.from(JSON.stringify({ html: 'x'.repeat(5 * MiB), period_end: 'not-a-date', claims: [] }), 'utf8')
    const twin = drive('POST', '/v1/twin', inChunks(five))
    expect(twin.status).toBe(400) // read and routed: the twin refuses the bad date, not the size
    expect(JSON.parse(twin.body).error).toMatch(/period_end/)
    expect(drive('POST', '/v1/twin/?x=1', inChunks(five)).status).toBe(400) // the cap follows the routed path
    expect(drive('POST', '/v1/verify', inChunks(five)).status).toBe(413)
    expect(drive('POST', '/v1/opinion', inChunks(five)).status).toBe(400)
    expect(bodyLimitFor(DEFAULT_LIMITS, '/v1/twin')).toBe(32 * MiB)
    expect(bodyLimitFor(DEFAULT_LIMITS, '/v1/opinion?a=b')).toBe(32 * MiB)
    expect(bodyLimitFor(DEFAULT_LIMITS, '/v1/verify/batch')).toBe(4 * MiB)
    expect(bodyLimitFor({ maxBodyBytes: 10, routeMaxBodyBytes: { '/v1/twin': 20 } }, '/v1/twin')).toBe(20)
  })

  it('malformed JSON is a 400 and the handler answers the next request as before', () => {
    const r = drive('POST', '/v1/verify', [Buffer.from('{"extraction": {')])
    expect(r.status).toBe(400)
    expect(JSON.parse(r.body)).toEqual({ error: 'invalid JSON body' })
    expect(drive('POST', '/v1/verify', [Buffer.from(JSON.stringify({ extraction: clean }))]).status).toBe(200)
  })

  it('a throw past the parse is a 500 for that request only (a router, a service, an unserializable result)', () => {
    const boom = drive('POST', '/v1/verify', [Buffer.from('{}')], { dispatch: () => { throw new Error('secret internals') } })
    expect(boom.status).toBe(500)
    expect(JSON.parse(boom.body)).toEqual({ error: 'internal error' }) // the message is not echoed
    const big = drive('GET', '/x', [], { dispatch: () => ({ status: 200, json: { n: 1n } }) })
    expect(big.status).toBe(500)
    expect(JSON.parse(big.body).error).toMatch(/could not be serialized/)
    const cyc: Record<string, unknown> = {}; cyc.self = cyc
    expect(drive('GET', '/x', [], { dispatch: () => ({ status: 200, json: cyc }) }).status).toBe(500)
    expect(drive('GET', '/v1/health', []).status).toBe(200)
  })

  it('a client that errors mid-body is dropped: no answer is written, nothing is routed', () => {
    const req = fakeReq('POST', '/v1/verify')
    const res = fakeRes()
    let routed = 0
    nodeHandler(r => { routed++; return route(r) })(req as never, res as never)
    req.emit('data', Buffer.from('{"extr'))
    req.emit('error', new Error('ECONNRESET'))
    req.emit('end')
    expect([res.writes, routed]).toEqual([0, 0])
  })

  it('the path, headers and parsed body reach the dispatcher unchanged (query stripped, headers lower-cased)', () => {
    const r = drive('POST', '/v1/verify?x=1', [Buffer.from(JSON.stringify({ extraction: clean }))], { headers: { 'X-Api-Key': 'k' } })
    expect(r.seen).toHaveLength(1)
    expect(r.seen[0]).toMatchObject({ method: 'POST', path: '/v1/verify', body: { extraction: clean }, headers: { 'x-api-key': 'k' } })
  })
})

describe('limits are checked', () => {
  it('resolveLimits fills the defaults and refuses nonsense', () => {
    expect(resolveLimits()).toMatchObject({ maxBodyBytes: 4 * MiB, requestTimeoutMs: 30_000, headersTimeoutMs: 10_000, idleTimeoutMs: 30_000 })
    expect(resolveLimits({ routeMaxBodyBytes: { '/v1/mine': 8 } }).routeMaxBodyBytes).toEqual({ '/v1/twin': 32 * MiB, '/v1/opinion': 32 * MiB, '/v1/reconcile': 32 * MiB, '/v1/succession/replay': 32 * MiB, '/v1/mine': 8 })
    expect(() => resolveLimits({ maxBodyBytes: 0 })).toThrow(/positive integer/)
    expect(() => resolveLimits({ maxBodyBytes: 1.5 })).toThrow(/positive integer/)
    expect(() => resolveLimits({ routeMaxBodyBytes: { '/v1/twin': -1 } })).toThrow(/routeMaxBodyBytes/)
    expect(() => resolveLimits({ idleTimeoutMs: -1 })).toThrow(/non-negative/)
    expect(() => resolveLimits({ drainBytes: -1 })).toThrow(/drainBytes/)
    expect(() => resolveLimits({ headersTimeoutMs: 5_000, requestTimeoutMs: 1_000 })).toThrow(/must not exceed requestTimeoutMs/)
    expect(() => nodeHandler(route, { maxBodyBytes: -5 })).toThrow(RangeError)
  })

  it('limitsFromEnv reads the VERIFY_* variables and refuses a non-integer', () => {
    expect(limitsFromEnv({})).toEqual({})
    expect(limitsFromEnv({ VERIFY_MAX_BODY_BYTES: '1048576', VERIFY_REQUEST_TIMEOUT_MS: '20000', VERIFY_HEADERS_TIMEOUT_MS: '5000', VERIFY_IDLE_TIMEOUT_MS: '0' }))
      .toEqual({ maxBodyBytes: 1048576, requestTimeoutMs: 20000, headersTimeoutMs: 5000, idleTimeoutMs: 0 })
    expect(() => limitsFromEnv({ VERIFY_MAX_BODY_BYTES: '4MB' })).toThrow(/VERIFY_MAX_BODY_BYTES/)
  })
})

// ── a real server on 127.0.0.1, a random port ─────────────────────────────────────────────────────────────────────────
const servers: ReturnType<typeof createHttpServer>[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections()
    await new Promise<void>(resolve => s.close(() => resolve()))
  }
})

async function start(limits: TransportLimits = {}, dispatch: (r: HttpRequest) => HttpResponse = route): Promise<number> {
  const s = createHttpServer(dispatch, limits)
  servers.push(s)
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()))
  return (s.address() as AddressInfo).port
}

function call(port: number, method: string, path: string, body?: Buffer | string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, res => {
      const parts: Buffer[] = []
      res.on('data', c => parts.push(c as Buffer))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }))
    })
    req.on('error', reject)
    if (body !== undefined) req.end(body)
    else req.end()
  })
}

/**
 * Stream `total` bytes in chunks with no Content-Length (chunked). Resolves with the status the server answered, or -1 when
 * the server dropped the connection first (past the drain allowance: the refusal working, not a test failure).
 */
function streamChunked(port: number, path: string, total: number): Promise<number> {
  return new Promise(resolve => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'content-type': 'application/json' } }, res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', () => resolve(-1))
    const chunk = Buffer.alloc(64 * 1024, 0x20)
    let sent = 0
    const pump = (): void => {
      while (sent < total) {
        sent += chunk.length
        if (!req.write(chunk)) { req.once('drain', pump); return }
      }
      req.end()
    }
    pump()
  })
}

/** Open a raw socket, write `text`, and resolve with what the server wrote before closing it (and how long it took). */
function rawUntilClosed(port: number, text: string): Promise<{ reply: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const sock = connect(port, '127.0.0.1', () => { if (text) sock.write(text) })
    const parts: Buffer[] = []
    sock.on('data', c => parts.push(c))
    sock.on('error', () => { /* a reset after the server's answer is a close */ })
    sock.on('close', () => resolve({ reply: Buffer.concat(parts).toString('utf8'), ms: Date.now() - t0 }))
    setTimeout(() => { sock.destroy(); reject(new Error('the server never closed the socket')) }, 8_000)
  })
}

describe('the transport on a real socket (127.0.0.1, random port)', () => {
  it('a declared 5 MiB body to /v1/verify is 413; the server answers the next request', async () => {
    const port = await start()
    const five = Buffer.alloc(5 * MiB, 0x20)
    const r = await call(port, 'POST', '/v1/verify', five, { 'content-type': 'application/json', 'content-length': String(five.length) }).catch(() => ({ status: -1, body: '' }))
    // The answer is 413; on some platforms the client sees the reset of the unread body first. Never 200/400.
    expect([413, -1]).toContain(r.status)
    expect((await call(port, 'GET', '/v1/health')).status).toBe(200)
  })

  it('a small declared body over a small cap is answered 413 with the reason', async () => {
    const port = await start({ maxBodyBytes: 100 })
    const body = JSON.stringify({ extraction: clean })
    const r = await call(port, 'POST', '/v1/verify', body, { 'content-type': 'application/json' })
    expect(r.status).toBe(413)
    expect(JSON.parse(r.body)).toMatchObject({ max_body_bytes: 100 })
  })

  it('a chunked stream with no Content-Length just past the cap is answered 413 (the rest drained); the server stays up', async () => {
    const port = await start({ maxBodyBytes: 256 * 1024 })
    expect(await streamChunked(port, '/v1/verify', 384 * 1024)).toBe(413)
    expect((await call(port, 'POST', '/v1/verify', JSON.stringify({ extraction: clean }), { 'content-type': 'application/json' })).status).toBe(200)
  })

  it('a chunked stream far past the cap is refused (413, or dropped past the drain allowance), never routed', async () => {
    let routed = 0
    const port = await start({ maxBodyBytes: 256 * 1024 }, req => { routed++; return route(req) })
    expect([413, -1]).toContain(await streamChunked(port, '/v1/verify', 8 * MiB))
    expect(routed).toBe(0)
    expect((await call(port, 'GET', '/v1/health')).status).toBe(200)
  })

  it('malformed JSON is 400 and a crashing dispatcher is 500; the process and the server stay up', async () => {
    let n = 0
    const port = await start({}, req => { if (req.path === '/boom') { n++; throw new Error('kaboom') } return route(req) })
    expect((await call(port, 'POST', '/v1/verify', '{"extraction":')).status).toBe(400)
    const boom = await call(port, 'POST', '/boom', '{}')
    expect([boom.status, JSON.parse(boom.body)]).toEqual([500, { error: 'internal error' }])
    expect(n).toBe(1)
    expect((await call(port, 'GET', '/v1/health')).status).toBe(200)
  })

  it('slowloris: headers that never finish are cut off at headersTimeoutMs', async () => {
    const port = await start({ headersTimeoutMs: 300, requestTimeoutMs: 600, timeoutCheckIntervalMs: 50 })
    const r = await rawUntilClosed(port, 'POST /v1/verify HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Slow: ')
    expect(r.ms).toBeLessThan(3_000)
    expect(r.reply === '' || /^HTTP\/1\.1 408/.test(r.reply)).toBe(true)
  })

  it('a body that stalls is cut off at requestTimeoutMs (408), before it is ever routed', async () => {
    let routed = 0
    const port = await start({ headersTimeoutMs: 200, requestTimeoutMs: 500, timeoutCheckIntervalMs: 50 }, req => { routed++; return route(req) })
    const r = await rawUntilClosed(port, 'POST /v1/verify HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"extrac')
    expect(r.ms).toBeLessThan(3_000)
    expect(r.reply === '' || /^HTTP\/1\.1 408/.test(r.reply)).toBe(true)
    expect(routed).toBe(0)
  })

  it('an idle socket that sends nothing is closed at idleTimeoutMs', async () => {
    const port = await start({ requestTimeoutMs: 0, headersTimeoutMs: 0, idleTimeoutMs: 300 })
    const r = await rawUntilClosed(port, '')
    expect(r.ms).toBeGreaterThanOrEqual(250)
    expect(r.ms).toBeLessThan(3_000)
  })
})
