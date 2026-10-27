/**
 * Thin node:http transport around the pure router. `verify serve` runs the verifier as a JSON HTTP service — no framework, no
 * dependencies. Body is read, parsed, routed; the response is JSON.
 *
 *   verify serve [--port N] [--host ADDRESS]       (in a source checkout: node packages/verify/dist/cli.js serve)
 *
 * BIND (2026-10-05): 127.0.0.1 by default, this machine only. The pure core has no authentication, so any other host is
 * taken only when given, and the server prints a warning line saying anyone who can reach the port can call it.
 *
 * WHAT IT ANSWERS (2026-10-05; an outside engineer found any Host header accepted and a text/plain body parsed
 * as JSON, which together let any web page drive the server through DNS rebinding or a plain form post):
 *   - HOST: `serve` and `serveService` answer only a Host header naming a loopback name (localhost, 127.0.0.1, ::1), the
 *     address bound, any address of this machine for a wildcard bind, or a name given with --allow-host (allowedHostsFor).
 *     Any other is 421, before the body is read. A request with no Host header is 400, in words, on every HTTP version
 *     (2026-10-13: an HTTP/1.0 request with none used to be answered, while the engineers' page said only those names were).
 *   - BODY TYPE: a non-empty body is read only when sent with Content-Type: application/json (parameters allowed); any
 *     other type, or none, is 415 with words. A page on another site can send text/plain or a form without asking first; it
 *     cannot send application/json to another origin without the browser asking the server, which this server never grants
 *     (it sends no CORS headers). 2026-10-13: a charset other than utf-8 is 415 too, "send UTF-8 (charset=<x> is not
 *     accepted)" (charset=utf-16 used to be accepted and its body read as UTF-8); no charset means UTF-8.
 *
 * TRANSPORT LIMITS (2026-09-28): the transport, not a proxy in front of it, bounds the bytes one request may send and how long
 * it may take to send them. What a request costs once it has arrived is the check budget's (below).
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
 *   - Malformed JSON is a 400, and so is JSON nested more than 256 levels deep ("nesting too deep, limit 256"). A throw
 *     anywhere past the parse (a router, a service, an unserializable result) is a 500 for that request only.
 *
 * CHECK BUDGET (2026-10-06; ./budget.ts): `serve` reads, routes and checks every POST in a worker thread, under a time limit
 * (60 s by default), a heap limit (512 MiB) and a limit on checks at once (2) and waiting (16). A check past its time or heap is
 * stopped and answered 413, "input too large to check within the service's budget; run it with the command line", with
 * x-verify-exit 2; only its worker ends, and the process and every other request stay up. GET requests are answered on this
 * thread, so /v1/health answers while a check runs. `--check-timeout-ms`, `--check-heap-mb` and `--check-workers` raise them.
 * `serveService` runs the caller's service on this thread, as before (a managed tier holds state, such as an idempotency
 * record, that relies on one request at a time): the work its routes do is the service's to bound.
 */

import { createServer, type IncomingMessage, type ServerResponse, type IncomingHttpHeaders } from 'node:http'
import { networkInterfaces } from 'node:os'
import { route, type HttpRequest, type HttpResponse } from './router.js'
import type { Service } from './service.js'
import { answerBody, coderFor, type RequestMeta } from './answer.js'
import { createCheckPool, budgetFromEnv, resolveBudget, type CheckBudget, type CheckPool } from './budget.js'

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
 * How the transport words its own refusals. `errorCodes` (2026-10-03, opt-in, for a service whose answers carry stable codes,
 * like receipts' hosted gate) adds `code` to the transport's bodies: `body.too_large` (413), `body.invalid_json` (400),
 * `internal` (500). Off by default: verify's own bodies are unchanged. 2026-10-05 adds three 400s, read under the
 * hash contract: `body.invalid_utf8` (the byte offset named), `body.duplicate_key` (a key repeated in one object, its JSON path
 * named) and `body.non_finite_number` (1e999, its JSON path named). A byte-order mark stays `body.invalid_json`, with its own words.
 * 2026-10-05 adds `body.inexact_number`: a number whose text does not read back as written (9007199254740993),
 * its JSON path named, with the words "a number that cannot be represented exactly; write amounts as strings with two decimals".
 * 2026-10-06 adds `body.too_deep` (400, "nesting too deep, limit 256"), and, from the check budget, `budget.exceeded` (413) and
 * `budget.busy` (503).
 */
export interface TransportOptions {
  errorCodes?: boolean
  /**
   * The check pool (2026-10-06; ./budget.ts): when given, every POST is read, routed by the pure core and answered in one of its
   * workers, under its budget, instead of by `dispatch` on this thread; every other method is still `dispatch`'s. `serve` sets it.
   * The pool closes when the server does.
   */
  checks?: CheckPool
  /**
   * The Host names this server answers (2026-10-05; DNS rebinding): a request whose Host header names any
   * other host is answered 421 with words, before its body is read. Hostnames only, compared without case and without a port;
   * an IPv6 literal without its brackets. 2026-10-13: a request with no Host header is 400 with words (`request.host_missing`),
   * on HTTP/1.0 as on HTTP/1.1; it used to be answered.
   * Absent: every Host is answered (a handler built for a caller's own server). `serve` and `serveService` always set it
   * (allowedHostsFor).
   */
  allowedHosts?: readonly string[]
}

/** A Host header's hostname: lowercase, no port, no IPv6 brackets ("[::1]:8080" → "::1", "Example.COM:80" → "example.com"). */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase()
  if (h.startsWith('[')) { const end = h.indexOf(']'); return end > 0 ? h.slice(1, end) : h }
  const colons = h.split(':').length - 1
  return colons === 1 ? h.slice(0, h.indexOf(':')) : h // more than one colon: a bare IPv6 literal, no port
}

/** The loopback names every server answers: what a program on this machine writes to reach it. */
export const LOOPBACK_NAMES: readonly string[] = ['localhost', '127.0.0.1', '::1']

/**
 * The Host names a server bound to `host` answers: the loopback names, the address it was bound to, any names the operator
 * allowed (`--allow-host`, for a proxy that forwards the public name), and, for a wildcard bind (0.0.0.0 or ::), every address
 * of this machine's interfaces (`interfaceAddresses`, os.networkInterfaces() by default).
 */
export function allowedHostsFor(host: string, extra: readonly string[] = [], interfaceAddresses: () => string[] = localAddresses): string[] {
  const bound = hostnameOf(host)
  const wildcard = bound === '0.0.0.0' || bound === '::'
  return [...new Set([...LOOPBACK_NAMES, ...(wildcard ? interfaceAddresses() : [bound]), ...extra.map(hostnameOf)])]
}

/** Every address of this machine's network interfaces (lowercase). */
function localAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) out.push(a.address.toLowerCase().replace(/%.*$/, ''))
  return out
}

/** A body is read as JSON only under this media type (2026-10-05): `application/json`, parameters (charset) allowed. */
export function isJsonContentType(v: string | undefined): boolean {
  if (v === undefined) return false
  return v.split(';')[0]!.trim().toLowerCase() === 'application/json'
}

/**
 * The charset a Content-Type names, lowercased and unquoted, or undefined when it names none (2026-10-13). The body is read as
 * UTF-8 whatever the header says, so a charset other than utf-8 is refused (415) rather than read as UTF-8.
 */
export function charsetOf(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  for (const p of v.split(';').slice(1)) {
    const eq = p.indexOf('=')
    if (eq < 0 || p.slice(0, eq).trim().toLowerCase() !== 'charset') continue
    return p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1').toLowerCase()
  }
  return undefined
}

/**
 * Build a node:http handler from any `(HttpRequest) => HttpResponse`: the pure router by default, or a Service. The body is
 * capped while it streams (413); malformed JSON is 400; a throw past the parse is a 500 for this request only. Exactly one
 * response is written per request, whatever the client does after it.
 */
export function nodeHandler(dispatch: (req: HttpRequest) => HttpResponse, limits: TransportLimits = {}, transport: TransportOptions = {}) {
  const lim = resolveLimits(limits)
  const coded = coderFor(transport.errorCodes)
  const checks = transport.checks
  const allowed = transport.allowedHosts ? new Set(transport.allowedHosts.map(hostnameOf)) : undefined
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

    /** Write one answer whose body is already JSON text (a check worker's), once. */
    const sendText = (status: number, text: string, extra: Record<string, string> = {}): void => {
      if (done) return
      done = true
      chunks = []
      try {
        res.writeHead(status, { 'content-type': 'application/json', ...extra })
        res.end(text)
      } catch { /* the client is gone; nothing to answer */ }
    }
    const send = (status: number, body: unknown, extra: Record<string, string> = {}): void => {
      if (done) return
      let text: string
      try {
        text = JSON.stringify(body)
        if (typeof text !== 'string') throw new TypeError('not serializable')
      } catch {
        status = 500
        text = JSON.stringify(coded('internal', { error: 'internal error: the response could not be serialized' }))
      }
      sendText(status, text, extra)
    }

    /** Stop reading and drop the connection (node answers nothing more on it). */
    const hangUp = (): void => {
      const r = req as IncomingMessage & { destroy?: () => void }
      if (typeof r.destroy === 'function') r.destroy()
      else if (typeof req.pause === 'function') req.pause()
    }

    // 2026-10-05: a Host this server is not bound to is refused before anything else (DNS rebinding: a page on another
    // site that points its own name at this machine). 421, words, and the connection closes; nothing of the body is read.
    if (allowed !== undefined) {
      const hh = (req.headers as IncomingHttpHeaders | undefined)?.host
      // 2026-10-13: no Host header at all is refused too, on every HTTP version (the HTTP/1.1 rule node applies by itself
      // answered with no words, and an HTTP/1.0 request with none was answered): 400, in words, before the body is read
      if (typeof hh !== 'string' || hh.trim() === '') {
        send(400, coded('request.host_missing', {
          error: `this server answers only a request whose Host header names one of the host names it is bound to (${[...allowed].join(', ')}); this request has no Host header. Send one: an HTTP/1.1 client sends it by itself, and an HTTP/1.0 client must add it (Host: 127.0.0.1)`,
        }), { connection: 'close' })
        if (typeof req.pause === 'function') req.pause()
        return
      }
      if (!allowed.has(hostnameOf(hh))) {
        send(421, coded('request.host_not_allowed', {
          error: `this server answers only the host names it is bound to (${[...allowed].join(', ')}), not ${JSON.stringify(hh)}: a request addressed to another name is refused, so a page on another site that points its own name at this machine cannot call it. Use one of those names, or start the server with --allow-host <name> for a proxy that forwards that name`,
        }), { connection: 'close' })
        if (typeof req.pause === 'function') req.pause()
        return
      }
    }

    // A declared length over the cap is refused before a byte of body is read. When the rest would run past what is
    // drained, the connection closes after the answer and nothing more is read.
    const declared = declaredLength(req)
    if (declared !== undefined && declared > cap) {
      if (declared > lim.drainBytes) {
        send(413, coded('body.too_large', tooLarge(cap, path)), { connection: 'close' })
        if (typeof req.pause === 'function') req.pause()
        return
      }
      send(413, coded('body.too_large', tooLarge(cap, path)))
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
        send(413, coded('body.too_large', tooLarge(cap, path)))
        drained = 0
        return
      }
      chunks.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c)
    })
    // The client went away mid-request: drop what was read; there is no one to answer.
    req.on('error', () => { done = true; chunks = [] })
    req.on('end', () => {
      if (done) return
      const bytes = Buffer.concat(chunks)
      chunks = []
      if (bytes.length > 0) {
        // 2026-10-05: a body is read as JSON only when it says it is. A page on another site can send text/plain (or a
        // form) to this machine without asking first; it cannot send application/json without the browser asking the server.
        const ct = (req.headers as IncomingHttpHeaders | undefined)?.['content-type']
        if (!isJsonContentType(typeof ct === 'string' ? ct : undefined)) {
          send(415, coded('body.unsupported_media_type', {
            error: `this server reads a request body only when it is sent with Content-Type: application/json (this one was sent with ${typeof ct === 'string' && ct.trim() !== '' ? JSON.stringify(ct) : 'no Content-Type'}). Send that header (curl: -H 'Content-Type: application/json') and the same body`,
          }))
          return
        }
        // 2026-10-13: the body is read as UTF-8 whatever the header says, so another charset is refused, not misread
        const cs = charsetOf(typeof ct === 'string' ? ct : undefined)
        if (cs !== undefined && cs !== 'utf-8') {
          send(415, coded('body.unsupported_charset', {
            error: `send UTF-8 (charset=${cs} is not accepted): this server reads a request body as UTF-8 JSON only. Re-encode the body as UTF-8 and send it with Content-Type: application/json (or application/json; charset=utf-8)`,
          }))
          return
        }
      }
      const meta: RequestMeta = { method: req.method ?? 'GET', path: routed, headers: headersOf(req) }
      // 2026-10-06: with a check pool, a POST is read, routed and checked in a worker, under the pool's budget, so this thread
      // stays free to answer every other request; a request withdrawn by its client before a worker takes it never runs.
      if (checks && meta.method === 'POST') {
        // The socket carries nothing while a worker checks, so the idle timeout is suspended until the answer is written (the
        // pool's own budget bounds the wait), then restored for the kept-alive socket.
        const socket = (req as IncomingMessage & { socket?: { setTimeout?: (ms: number) => unknown } }).socket
        socket?.setTimeout?.(0)
        const restore = (): void => { socket?.setTimeout?.(lim.idleTimeoutMs) }
        const pending = checks.runBytes(meta, bytes, transport.errorCodes === true)
        res.once?.('close', () => { if (!done) pending.cancel() })
        pending.answer.then(
          a => { sendText(a.status, a.text, a.headers ?? {}); restore() },
          () => { send(500, coded('internal', { error: 'internal error' })); restore() },
        )
        return
      }
      // 2026-10-05: the body is read under the hash contract (protocol/hash-input.ts), as the CLI reads a file. Invalid
      // UTF-8 used to become U+FFFD and a number past the double range Infinity (hashed as null); a key repeated in one object
      // kept only its last value. Each is a 400 naming where, never a verdict (./answer.ts).
      const r = answerBody(bytes, meta, dispatch, coded)
      send(r.status, r.json, r.headers ?? {})
    })
  }
}

export interface ServeOptions extends TransportLimits, TransportOptions {
  /**
   * The interface to bind. Default 127.0.0.1, this machine only (2026-10-05: it used to be node's default, every interface,
   * and the pure core has no authentication). Any other address is taken as given and announced with a warning line.
   */
  host?: string
  /**
   * Host names answered besides the loopback names and `host` itself (2026-10-05): the public name a proxy forwards, say.
   * Every other Host is answered 421 (allowedHostsFor). `verify serve --allow-host <name>`, repeatable.
   */
  allowHosts?: readonly string[]
  /** Where the listening line (out) and the warning (err) go. Default: process stdout and stderr. */
  log?: { out: (s: string) => void; err: (s: string) => void }
  /**
   * What one check may cost (2026-10-06; ./budget.ts DEFAULT_BUDGET): `serve` runs every POST in a worker under it. Ignored by
   * `serveService`, which runs its service on this thread.
   */
  budget?: CheckBudget
}

/** The interface `serve` and `serveService` bind when no host is given: loopback, this machine only. */
export const DEFAULT_HOST = '127.0.0.1'

/** Only this machine can reach `host`: localhost, 127.0.0.0/8, ::1 (and its IPv4-mapped form). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return h === 'localhost' || h === '::1' || /^(::ffff:)?127(\.\d{1,3}){3}$/.test(h)
}

/**
 * What `serve` prints once listening: the address (stdout), and, off loopback, a warning (stderr) that the pure core has no
 * authentication. `managed`: the managed tier (serveService), which authenticates every request, so no warning.
 */
export function listeningLines(host: string, port: number, managed = false): { out: string; warn?: string } {
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`
  const loop = isLoopbackHost(host)
  if (managed) return { out: `verify managed service listening on ${url}${loop ? ', this machine only' : ''}\n` }
  const out = `verify HTTP server listening on ${url}${loop ? ', this machine only. It has no authentication: any program on this machine can call it.' : '. It has no authentication.'}\n`
  if (loop) return { out }
  const where = host === '0.0.0.0' || host === '::' ? 'every network interface of this machine' : `${host}, beyond this machine`
  return { out, warn: `warning: listening on ${where}, with no authentication: anyone who can reach port ${port} can call this server. Put an authenticating proxy in front of it, or bind ${DEFAULT_HOST}.\n` }
}

/** A node:http server around `dispatch` with the transport limits applied (not yet listening). */
export function createHttpServer(dispatch: (req: HttpRequest) => HttpResponse, opts: TransportLimits = {}, transport: TransportOptions = {}): ReturnType<typeof createServer> {
  const lim = resolveLimits(opts)
  const server = createServer({
    requestTimeout: lim.requestTimeoutMs,
    headersTimeout: lim.headersTimeoutMs,
    keepAliveTimeout: lim.keepAliveTimeoutMs,
    connectionsCheckingInterval: lim.timeoutCheckIntervalMs,
    // 2026-10-13: a server that answers only named hosts refuses a request with no Host header itself, in words, on every HTTP
    // version (nodeHandler); node's own HTTP/1.1 rule would answer it first with a bare 400
    ...(transport.allowedHosts ? { requireHostHeader: false } : {}),
  }, nodeHandler(dispatch, lim, transport))
  // An idle socket is destroyed (no 'timeout' listener: node's default is to destroy it).
  server.setTimeout(lim.idleTimeoutMs)
  // The check pool's workers stop with the server.
  if (transport.checks) { const pool = transport.checks; server.on('close', () => { void pool.close() }) }
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

const PROCESS_LOG = { out: (s: string): void => { process.stdout.write(s) }, err: (s: string): void => { process.stderr.write(s) } }

/** Listen on `host` (default 127.0.0.1) and print where, from the address actually bound (so port 0 prints the real port). */
function listenAndSay(server: ReturnType<typeof createServer>, port: number, host: string, managed: boolean, log: NonNullable<ServeOptions['log']>): void {
  server.listen(port, host, () => {
    const a = server.address()
    const bound = a !== null && typeof a === 'object' ? a : { address: host, port }
    const l = listeningLines(bound.address, bound.port, managed)
    log.out(l.out)
    if (l.warn) log.err(l.warn)
  })
}

/**
 * The pure core over HTTP: no authentication, bound to 127.0.0.1 unless `opts.host` says otherwise. Every POST is checked in a
 * worker thread under `opts.budget` (2026-10-06; ./budget.ts).
 */
export function serve(port = Number(process.env.PORT ?? 8080), opts: ServeOptions = {}): ReturnType<typeof createServer> {
  const { host, errorCodes, log, allowHosts, budget, ...limits } = opts
  const bind = host ?? DEFAULT_HOST
  const checks = createCheckPool(budget)
  const server = createHttpServer(route, limits, { ...(errorCodes !== undefined ? { errorCodes } : {}), allowedHosts: allowedHostsFor(bind, allowHosts), checks })
  listenAndSay(server, port, bind, false, log ?? PROCESS_LOG)
  return server
}

/**
 * Serve the stateful managed tier (auth + rate-limit + auto-record) around the pure core; bound to 127.0.0.1 by default. The
 * service runs on this thread (`opts.budget` does not apply): the work its routes do is the service's to bound.
 */
export function serveService(service: Service, port = Number(process.env.PORT ?? 8080), opts: ServeOptions = {}): ReturnType<typeof createServer> {
  const { host, errorCodes, log, allowHosts, budget: _budget, ...limits } = opts
  const bind = host ?? DEFAULT_HOST
  const server = createHttpServer(req => service.handle(req), limits, { ...(errorCodes !== undefined ? { errorCodes } : {}), allowedHosts: allowedHostsFor(bind, allowHosts) })
  listenAndSay(server, port, bind, true, log ?? PROCESS_LOG)
  return server
}

/** The help `runServe` prints when its caller gives none (the CLI passes its own `serve` block, which names the installed binary). */
export const SERVE_HELP = `serve [--port N] [--host ADDRESS] [--allow-host NAME]... [--check-timeout-ms N] [--check-heap-mb N] [--check-workers N] [--max-body BYTES]
    the engine's pure core as a JSON HTTP service (OpenAPI 3.1 at GET /v1/openapi.json), until stopped. --port: default
    $PORT, else 8080 (0 picks a free port, printed when listening). --host: default 127.0.0.1, this machine only; any
    other address, such as 0.0.0.0, prints a warning, because the server has no authentication: anyone who can reach the
    port can call it. A request is answered only when its Host header names localhost, 127.0.0.1, ::1 or the --host
    address (for 0.0.0.0 or ::, any address of this machine); else 421, and a request with no Host header is 400.
    --allow-host adds a name, such as the public name a proxy forwards. A request body is read only when sent with
    Content-Type: application/json, as UTF-8 (a charset other than utf-8 is 415).
    Each POST is checked in a worker thread under a budget: --check-timeout-ms (default 60000), --check-heap-mb (default
    512) and --check-workers (checks at once, default 2; up to 16 more wait, each at most the time budget, then 503). A
    check past its time or heap is stopped and answered 413, "input too large to check within the service's budget; run it
    with the command line", with x-verify-exit 2; the server stays up. The environment can set them too (VERIFY_CHECK_TIMEOUT_MS, VERIFY_CHECK_HEAP_MB,
    VERIFY_CHECK_WORKERS); a flag wins.
    The request body is counted as it streams and capped before it is parsed: 4 MiB (4194304 bytes) by default, 32 MiB on
    the four routes that carry a whole document (/v1/twin, /v1/opinion, /v1/reconcile, /v1/succession/replay); past the cap
    the answer is 413, naming the cap. --max-body BYTES (a positive whole number) sets the 4 MiB default, as the environment
    variable VERIFY_MAX_BODY_BYTES does (the flag wins); neither changes the four routes' 32 MiB.
    POST /v1/replay sets x-verify-exit to the replay's exit, as \`verify replay\` on a folder gives it (0 every case matched,
    1 one diverged, 2 one was not re-performed, 3 one was refused), and its status to match: 409 when one diverged, 422 when
    one was refused, else 200.
    Exit 3 a usage error, or the port could not be bound`

export interface RunServeOptions {
  log?: NonNullable<ServeOptions['log']>
  env?: Record<string, string | undefined>
  /** the help text for --help and usage errors (default SERVE_HELP) */
  help?: string
  /** called with 3 when the port cannot be bound (default: sets process.exitCode) */
  setExitCode?: (code: number) => void
}

/**
 * `verify serve [--port N] [--host ADDRESS]` (2026-10-05): the documented way to start the HTTP server. Returns the exit code
 * when it does not start (help: 0; a usage error: 3), or the listening server; a failure to bind sets process.exitCode 3.
 */
export function runServe(argv: string[], opts: RunServeOptions = {}): { code: number; server?: ReturnType<typeof createServer> } {
  const log = opts.log ?? PROCESS_LOG
  const env = opts.env ?? process.env
  const help = opts.help ?? SERVE_HELP
  const usage = (msg: string): { code: number } => { log.err(`verify serve: ${msg}\n${help}\n`); return { code: 3 } }
  let port: string | undefined = env.PORT
  let host: string | undefined
  const allowHosts: string[] = []
  /** --check-timeout-ms, --check-heap-mb, --check-workers (2026-10-06), by the budget field each sets */
  const BUDGET_FLAGS: Readonly<Record<string, keyof CheckBudget>> = { '--check-timeout-ms': 'timeoutMs', '--check-heap-mb': 'heapMb', '--check-workers': 'workers' }
  const flagged: CheckBudget = {}
  /** --max-body (2026-10-13): the default request-body cap, in bytes; the environment's VERIFY_MAX_BODY_BYTES when absent */
  let maxBody: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '-h' || a === '--help') { log.err(`${help}\n`); return { code: 0 } }
    if (a === '--port' || a === '--host' || a === '--allow-host' || a === '--max-body' || a in BUDGET_FLAGS) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--') || v.trim() === '') return usage(`${a} needs a value`)
      if (a === '--port') port = v
      else if (a === '--host') host = v
      else if (a === '--allow-host') allowHosts.push(v)
      else if (a === '--max-body') {
        // the bounds resolveLimits enforces on maxBodyBytes: a positive whole number of bytes
        if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1) return usage(`--max-body takes a positive whole number of bytes (the default is 4194304, 4 MiB), not ${JSON.stringify(v)}`)
        maxBody = Number(v)
      } else {
        if (!/^\d+$/.test(v) || Number(v) < 1) return usage(`${a} must be a positive whole number, not ${JSON.stringify(v)}`)
        flagged[BUDGET_FLAGS[a]!] = Number(v)
      }
      continue
    }
    return usage(`unknown argument ${JSON.stringify(a)}`)
  }
  const n = port === undefined || port === '' ? 8080 : /^\d+$/.test(port) ? Number(port) : NaN
  if (!Number.isSafeInteger(n) || n < 0 || n > 65535) return usage(`the port must be a whole number from 0 to 65535, not ${JSON.stringify(port)}`)
  let limits: TransportLimits
  let budget: CheckBudget
  try {
    limits = { ...limitsFromEnv(env), ...(maxBody !== undefined ? { maxBodyBytes: maxBody } : {}) }
    resolveLimits(limits)
    budget = { ...budgetFromEnv(env), ...flagged }
    resolveBudget(budget)
  } catch (e) { return usage((e as Error).message) }
  const server = serve(n, { ...limits, ...(host !== undefined ? { host } : {}), ...(allowHosts.length ? { allowHosts } : {}), budget, log })
  server.on('error', (e: NodeJS.ErrnoException) => {
    log.err(`verify serve: cannot listen on ${host ?? DEFAULT_HOST}:${n}: ${e.code === 'EADDRINUSE' ? 'the port is in use' : e.code === 'EACCES' ? 'not allowed (a port below 1024 may need privileges)' : e.message}\n`)
    if (opts.setExitCode) opts.setExitCode(3)
    else process.exitCode = 3
  })
  return { code: 0, server }
}

// `node dist/http/serve.js` still starts the server, on 127.0.0.1 like `verify serve`; `verify serve --host` is the way to bind elsewhere.
if (process.argv[1] && (process.argv[1].endsWith('serve.js') || process.argv[1].endsWith('serve.ts'))) serve(undefined, { ...limitsFromEnv(), budget: budgetFromEnv() })
