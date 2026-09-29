/**
 * Thin node:http transport around the pure router. `verify-serve` (or `node dist/http/serve.js`) runs the verifier as a
 * JSON HTTP service — no framework, no dependencies. Body is read, parsed, routed; the response is JSON.
 *
 *   PORT=8080 node dist/http/serve.js
 *
 * TRANSPORT LIMITS (2026-09-28, red-team R2): the transport, not a proxy in front of it, bounds what one request may cost.
 *   - The request body is counted WHILE it streams, before anything is buffered past the cap, parsed or routed (so before
 *     auth, which runs inside the managed tier). Past the cap the answer is 413 and nothing more is kept: up to `drainBytes`
 *     more are read and discarded so the client can finish and read the answer, then the connection is dropped. A declared
 *     Content-Length over the cap is refused before a byte of body is read. The default cap is 4 MiB; the four routes
 *     that carry a whole document, book or population by design (POST /v1/twin: a filing's inline-XBRL; POST /v1/opinion:
 *     a chain export; POST /v1/reconcile: a payment register, and a chain export when stateless; POST
 *     /v1/succession/replay: a chain export and the documents its verdicts were issued on) default to 32 MiB
 *     (measured: 97 real 10-K/10-Q primary documents in the CREDENCE-2 bench, largest 9.1 MB).
 *   - Slow clients are cut off: the headers must arrive within `headersTimeoutMs` (slowloris), the whole request within
 *     `requestTimeoutMs` (node answers 408), and a socket idle for `idleTimeoutMs` is closed.
 *   - Malformed JSON is a 400. A throw anywhere past the parse (a router, a service, an unserializable result) is a 500 for
 *     that request only: the process and every other request stay up.
 */

import { createServer, type IncomingMessage, type ServerResponse, type IncomingHttpHeaders } from 'node:http'
import { route, type HttpRequest, type HttpResponse } from './router.js'
import type { Service } from './service.js'

/** What one request may cost the transport. Every field is optional; see DEFAULT_LIMITS. */
export interface TransportLimits {
  /** Request-body bytes, counted as they stream. Past it: 413, and nothing more of the body is kept. */
  maxBodyBytes?: number
  /** Per-path caps (the path without its query or trailing slash) for routes that carry a whole document or book. */
  routeMaxBodyBytes?: Readonly<Record<string, number>>
  /**
   * After a 413, up to this many more body bytes are read and discarded (never kept) so the client can finish sending and
   * read the answer; past it the connection is closed. A declared length that would run past it is closed at once.
   */
  drainBytes?: number
  /** The whole request (headers and body) must arrive within this (node `requestTimeout`; 408). 0 disables. */
  requestTimeoutMs?: number
  /** The headers must arrive within this (node `headersTimeout`; slowloris). At most requestTimeoutMs. */
  headersTimeoutMs?: number
  /** A socket with no activity this long is closed (node `server.timeout`). 0 disables. */
  idleTimeoutMs?: number
  /** How long a kept-alive socket waits for its next request (node `keepAliveTimeout`). */
  keepAliveTimeoutMs?: number
  /** How often node checks the request and headers deadlines (node `connectionsCheckingInterval`). */
  timeoutCheckIntervalMs?: number
}

export const MiB = 1024 * 1024

export const DEFAULT_LIMITS: Readonly<Required<TransportLimits>> = Object.freeze({
  maxBodyBytes: 4 * MiB,
  routeMaxBodyBytes: Object.freeze({ '/v1/twin': 32 * MiB, '/v1/opinion': 32 * MiB, '/v1/reconcile': 32 * MiB, '/v1/succession/replay': 32 * MiB }),
  drainBytes: 256 * 1024,
  requestTimeoutMs: 30_000,
  headersTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
  keepAliveTimeoutMs: 5_000,
  timeoutCheckIntervalMs: 1_000,
})

/** The limits with the defaults filled in, checked (a cap is a positive integer; a timeout a non-negative one). */
export function resolveLimits(limits: TransportLimits = {}): Required<TransportLimits> {
  const r: Required<TransportLimits> = {
    ...DEFAULT_LIMITS, ...limits,
    routeMaxBodyBytes: { ...DEFAULT_LIMITS.routeMaxBodyBytes, ...(limits.routeMaxBodyBytes ?? {}) },
  }
  const cap = (name: string, v: number): void => {
    if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer (bytes), not ${String(v)}`)
  }
  cap('maxBodyBytes', r.maxBodyBytes)
  for (const [p, v] of Object.entries(r.routeMaxBodyBytes)) cap(`routeMaxBodyBytes[${JSON.stringify(p)}]`, v)
  if (!Number.isSafeInteger(r.drainBytes) || r.drainBytes < 0) throw new RangeError(`drainBytes must be a non-negative integer (bytes), not ${String(r.drainBytes)}`)
  for (const k of ['requestTimeoutMs', 'headersTimeoutMs', 'idleTimeoutMs', 'keepAliveTimeoutMs'] as const) {
    if (!Number.isSafeInteger(r[k]) || r[k] < 0) throw new RangeError(`${k} must be a non-negative integer (ms), not ${String(r[k])}`)
  }
  if (!Number.isSafeInteger(r.timeoutCheckIntervalMs) || r.timeoutCheckIntervalMs < 1) throw new RangeError(`timeoutCheckIntervalMs must be a positive integer (ms), not ${String(r.timeoutCheckIntervalMs)}`)
  if (r.requestTimeoutMs > 0 && r.headersTimeoutMs > r.requestTimeoutMs) {
    throw new RangeError(`headersTimeoutMs (${r.headersTimeoutMs}) must not exceed requestTimeoutMs (${r.requestTimeoutMs}): the headers are part of the request`)
  }
  return r
}

/** The path a request is routed and capped by: no query string, no trailing slash. */
const pathOf = (url: string | undefined): string => ((url ?? '/').split('?')[0] as string).replace(/\/+$/, '') || '/'

/** The body cap for a path: its own, if it carries one, else the default. */
export function bodyLimitFor(limits: TransportLimits, url: string): number {
  const r = limits.routeMaxBodyBytes ?? DEFAULT_LIMITS.routeMaxBodyBytes
  const own = r[pathOf(url)]
  return own ?? limits.maxBodyBytes ?? DEFAULT_LIMITS.maxBodyBytes
}

const headersOf = (req: IncomingMessage): Record<string, string | undefined> => {
  const h: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.headers as IncomingHttpHeaders)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
  return h
}

/** The declared Content-Length, when it is a plain non-negative integer (node's parser has already refused a malformed one). */
const declaredLength = (req: IncomingMessage): number | undefined => {
  const v = (req.headers as IncomingHttpHeaders | undefined)?.['content-length']
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return undefined
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : undefined
}

const tooLarge = (cap: number, path: string): { error: string; max_body_bytes: number } => ({
  error: `request body too large: ${path} accepts at most ${cap} bytes (the transport stops reading past it)`,
  max_body_bytes: cap,
})

/**
 * Build a node:http handler from any `(HttpRequest) => HttpResponse`: the pure router by default, or a Service. The body is
 * capped while it streams (413); malformed JSON is 400; a throw past the parse is a 500 for this request only. Exactly one
 * response is written per request, whatever the client does after it.
 */
export function nodeHandler(dispatch: (req: HttpRequest) => HttpResponse, limits: TransportLimits = {}) {
  const lim = resolveLimits(limits)
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = pathOf(req.url)
    const cap = bodyLimitFor(lim, req.url ?? '/')
    /** The path the dispatcher sees, as before: the URL without its query string (the router strips trailing slashes itself). */
    const routed = (req.url ?? '/').split('?')[0] as string
    let done = false
    let chunks: Buffer[] = []
    let size = 0
    /** Past the cap: bytes read and discarded since the 413 (undefined until then). */
    let drained: number | undefined
    let hungUp = false

    const send = (status: number, body: unknown, extra: Record<string, string> = {}): void => {
      if (done) return
      done = true
      chunks = []
      let text: string
      try {
        text = JSON.stringify(body)
        if (typeof text !== 'string') throw new TypeError('not serializable')
      } catch {
        status = 500
        text = JSON.stringify({ error: 'internal error: the response could not be serialized' })
      }
      try {
        res.writeHead(status, { 'content-type': 'application/json', ...extra })
        res.end(text)
      } catch { /* the client is gone; nothing to answer */ }
    }

    /** Stop reading and drop the connection (node answers nothing more on it). */
    const hangUp = (): void => {
      const r = req as IncomingMessage & { destroy?: () => void }
      if (typeof r.destroy === 'function') r.destroy()
      else if (typeof req.pause === 'function') req.pause()
    }

    // A declared length over the cap is refused before a byte of body is read. When the rest would run past what is
    // drained, the connection closes after the answer and nothing more is read.
    const declared = declaredLength(req)
    if (declared !== undefined && declared > cap) {
      if (declared > lim.drainBytes) {
        send(413, tooLarge(cap, path), { connection: 'close' })
        if (typeof req.pause === 'function') req.pause()
        return
      }
      send(413, tooLarge(cap, path))
      drained = 0
    }

    req.on('data', (c: Buffer | string) => {
      const n = typeof c === 'string' ? Buffer.byteLength(c, 'utf8') : c.length
      if (drained !== undefined) {
        // After the 413: discard (keep nothing), so the client can finish and read the answer; past the allowance, hang up.
        drained += n
        if (drained > lim.drainBytes && !hungUp) { hungUp = true; hangUp() }
        return
      }
      if (done) return
      size += n
      if (size > cap) {
        send(413, tooLarge(cap, path))
        drained = 0
        return
      }
      chunks.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c)
    })
    // The client went away mid-request: drop what was read; there is no one to answer.
    req.on('error', () => { done = true; chunks = [] })
    req.on('end', () => {
      if (done) return
      let body: unknown
      const raw = Buffer.concat(chunks).toString('utf8')
      chunks = []
      if (raw.length > 0) {
        try { body = JSON.parse(raw) } catch { send(400, { error: 'invalid JSON body' }); return }
      }
      let r: HttpResponse
      try {
        r = dispatch({ method: req.method ?? 'GET', path: routed, body, headers: headersOf(req) } satisfies HttpRequest)
      } catch {
        // A crash in the router or the service answers this request only; the process and every other request stay up.
        send(500, { error: 'internal error' })
        return
      }
      send(r.status, r.json)
    })
  }
}

export interface ServeOptions extends TransportLimits {
  /** The interface to bind (default: all interfaces, as node's listen). Tests bind 127.0.0.1. */
  host?: string
}

/** A node:http server around `dispatch` with the transport limits applied (not yet listening). */
export function createHttpServer(dispatch: (req: HttpRequest) => HttpResponse, opts: TransportLimits = {}): ReturnType<typeof createServer> {
  const lim = resolveLimits(opts)
  const server = createServer({
    requestTimeout: lim.requestTimeoutMs,
    headersTimeout: lim.headersTimeoutMs,
    keepAliveTimeout: lim.keepAliveTimeoutMs,
    connectionsCheckingInterval: lim.timeoutCheckIntervalMs,
  }, nodeHandler(dispatch, lim))
  // An idle socket is destroyed (no 'timeout' listener: node's default is to destroy it).
  server.setTimeout(lim.idleTimeoutMs)
  return server
}

/** Transport limits from the environment (VERIFY_MAX_BODY_BYTES, VERIFY_REQUEST_TIMEOUT_MS, VERIFY_HEADERS_TIMEOUT_MS, VERIFY_IDLE_TIMEOUT_MS). */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): TransportLimits {
  const out: TransportLimits = {}
  const int = (k: string): number | undefined => {
    const v = env[k]
    if (v === undefined || v === '') return undefined
    if (!/^\d+$/.test(v)) throw new RangeError(`${k} must be a non-negative integer, not ${JSON.stringify(v)}`)
    return Number(v)
  }
  const body = int('VERIFY_MAX_BODY_BYTES'), reqT = int('VERIFY_REQUEST_TIMEOUT_MS'), hdrT = int('VERIFY_HEADERS_TIMEOUT_MS'), idle = int('VERIFY_IDLE_TIMEOUT_MS')
  if (body !== undefined) out.maxBodyBytes = body
  if (reqT !== undefined) out.requestTimeoutMs = reqT
  if (hdrT !== undefined) out.headersTimeoutMs = hdrT
  if (idle !== undefined) out.idleTimeoutMs = idle
  return out
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  nodeHandler(route)(req, res)
}

export function serve(port = Number(process.env.PORT ?? 8080), opts: ServeOptions = {}): ReturnType<typeof createServer> {
  const { host, ...limits } = opts
  const server = createHttpServer(route, limits)
  const listening = (): void => { process.stdout.write(`verify HTTP server listening on :${port}\n`) }
  if (host !== undefined) server.listen(port, host, listening)
  else server.listen(port, listening)
  return server
}

/** Serve the stateful managed tier (auth + rate-limit + auto-record) around the pure core. */
export function serveService(service: Service, port = Number(process.env.PORT ?? 8080), opts: ServeOptions = {}): ReturnType<typeof createServer> {
  const { host, ...limits } = opts
  const server = createHttpServer(req => service.handle(req), limits)
  const listening = (): void => { process.stdout.write(`verify managed service listening on :${port}\n`) }
  if (host !== undefined) server.listen(port, host, listening)
  else server.listen(port, listening)
  return server
}

if (process.argv[1] && (process.argv[1].endsWith('serve.js') || process.argv[1].endsWith('serve.ts'))) serve(undefined, limitsFromEnv())
