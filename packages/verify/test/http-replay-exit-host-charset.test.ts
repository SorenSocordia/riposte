/**
 * What `verify serve` answers (2026-10-13; a cold reader's HTTP probes, 2026-10-12):
 *   1. POST /v1/replay sets x-verify-exit as /v1/verify does (0 match, 1 diverged, 2 not re-performed, 3 refused); it used to
 *      answer a DIVERGED replay with 200 and no header, so a caller wired to the header failed open. A bad request is 400.
 *      2026-10-19 (a cold reader, engineer's role): the status follows the exit too, so a proxy or a client that reads only
 *      the status never takes a forgery for a success: 409 when a case diverged, 422 when a case was refused, 200 otherwise.
 *   2. A request with no Host header is 400, in words, on HTTP/1.0 and HTTP/1.1 alike (an HTTP/1.0 request used to be answered).
 *   3. A body sent with a charset other than utf-8 is 415, "send UTF-8 (charset=<x> is not accepted)" (charset=utf-16 used to
 *      be accepted and read as UTF-8); a body that is not UTF-8 is 400 and names the encoding.
 *   4. The request-body cap: `serve --help` states it, and `--max-body <bytes>` sets the 4 MiB default.
 * The server runs on an ephemeral port and stops after the tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, runServe, SERVE_HELP } from '../src/http/serve'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
const quiet = { out: (): void => {}, err: (): void => {} }
type J = Record<string, any>

function call(port: number, o: { path?: string; method?: string; type?: string; body?: Buffer | string }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const body = o.body === undefined ? undefined : Buffer.isBuffer(o.body) ? o.body : Buffer.from(o.body)
    const headers: Record<string, string | number> = {}
    if (o.type !== undefined) headers['content-type'] = o.type
    if (body) headers['content-length'] = body.length
    const req = request({ host: '127.0.0.1', port, path: o.path ?? '/v1/verify', method: o.method ?? 'POST', headers }, res => {
      let s = ''
      res.on('data', c => { s += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: s }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
/** A request written by hand on a socket (no Host header unless the text has one); the whole answer as text. */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => s.write(text))
    let d = ''
    s.on('data', c => { d += c })
    s.on('end', () => resolve(d))
    s.on('error', reject)
    setTimeout(() => { s.destroy(); resolve(d) }, 8000)
  })
}
/** The JSON body of a reply read off the socket (an HTTP/1.1 reply comes chunked: the object between its outer braces). */
const bodyOf = (reply: string): J => { const b = reply.slice(reply.indexOf('\r\n\r\n') + 4); return JSON.parse(b.slice(b.indexOf('{'), b.lastIndexOf('}') + 1)) as J }

describe('verify serve', () => {
  let server: ReturnType<typeof serve>
  let port = 0
  beforeAll(async () => {
    server = serve(0, { log: quiet, errorCodes: true })
    await new Promise<void>(r => server.on('listening', () => r()))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())) })

  describe('1. POST /v1/replay sets x-verify-exit', () => {
    const replay = (body: unknown) => call(port, { path: '/v1/replay', type: 'application/json', body: JSON.stringify(body) })
    it('a diverged replay (the reader\'s b-outcome-flip.json): 409, x-verify-exit 1, the summary in the body', async () => {
      const r = await replay({ bundle: JSON.parse(readFileSync(join(FX, 'b-outcome-flip.json'), 'utf8')) })
      expect(r.status).toBe(409)
      expect((JSON.parse(r.text) as J).summary.diverged).toBe(1)
      expect(r.headers['x-verify-exit']).toBe('1')
    })
    it('a match 200 and 0, not re-performed 200 and 2, refused 422 and 3', async () => {
      const ok = JSON.parse(readFileSync(join(FX, 'b-extra-top.json'), 'utf8')) as J
      // 2026-10-19: the reader's file carries `extra`, a key the bundle format does not define, so as filed it is refused
      // (422, x-verify-exit 3); without that key it is the genuine bundle, which matches
      const asFiled = await replay({ bundle: ok })
      expect([asFiled.status, asFiled.headers['x-verify-exit']]).toEqual([422, '3'])
      delete ok.extra
      const matched = await replay({ bundle: ok })
      expect([matched.status, matched.headers['x-verify-exit']]).toEqual([200, '0'])
      const notReperformed = await replay({ bundle: { verdict: ok.verdict } })
      expect([notReperformed.status, notReperformed.headers['x-verify-exit']]).toEqual([200, '2'])
      const refused = await replay({ bundles: [42] })
      expect(refused.status).toBe(422)
      expect(refused.headers['x-verify-exit']).toBe('3')
      expect((JSON.parse(refused.text) as J).summary.refused).toBe(1)
    })
    it('a batch of one diverged and one refused case is 422 (a refused case wins the exit), never 200', async () => {
      const flip = JSON.parse(readFileSync(join(FX, 'b-outcome-flip.json'), 'utf8')) as J
      const r = await replay({ bundles: [flip, 42] })
      expect(r.status).toBe(422)
      expect(r.headers['x-verify-exit']).toBe('3')
    })
    it('a request that names no bundle is 400 and carries no exit', async () => {
      const r = await replay({ nothing: true })
      expect(r.status).toBe(400)
      expect(r.headers['x-verify-exit']).toBeUndefined()
    })
  })

  describe('2. no Host header: 400, in words, on every HTTP version', () => {
    it('HTTP/1.0 with no Host is 400 naming the rule (it used to be answered)', async () => {
      const reply = await raw(port, 'GET /v1/health HTTP/1.0\r\n\r\n')
      expect(reply.startsWith('HTTP/1.1 400')).toBe(true)
      const b = bodyOf(reply)
      expect(b.code).toBe('request.host_missing')
      expect(b.error).toContain('this server answers only a request whose Host header names')
    })
    it('HTTP/1.1 with no Host is the same 400, with the same words', async () => {
      const reply = await raw(port, 'GET /v1/health HTTP/1.1\r\nConnection: close\r\n\r\n')
      expect(reply.startsWith('HTTP/1.1 400')).toBe(true)
      expect(bodyOf(reply).code).toBe('request.host_missing')
    })
    it('a Host this server answers is still answered', async () => {
      const reply = await raw(port, `GET /v1/health HTTP/1.0\r\nHost: 127.0.0.1:${port}\r\n\r\n`)
      expect(reply.startsWith('HTTP/1.1 200')).toBe(true)
    })
  })

  describe('3. the body must be UTF-8', () => {
    const inv = readFileSync(join(FX, 'invoice.json'), 'utf8')
    const body = `{"extraction":${inv}}`
    it('charset=utf-16 is 415, "send UTF-8 (charset=utf-16 is not accepted)" (it used to be read as UTF-8)', async () => {
      const r = await call(port, { type: 'application/json; charset=utf-16', body })
      expect(r.status).toBe(415)
      expect((JSON.parse(r.text) as J).code).toBe('body.unsupported_charset')
      expect((JSON.parse(r.text) as J).error).toContain('send UTF-8 (charset=utf-16 is not accepted)')
    })
    it('charset=utf-8, "UTF-8" quoted, or no charset is read', async () => {
      for (const type of ['application/json; charset=utf-8', 'application/json; charset="UTF-8"', 'application/json']) {
        expect((await call(port, { type, body })).status, type).toBe(200)
      }
    })
    it('a UTF-16 body sent as application/json is 400 and names the encoding', async () => {
      const r = await call(port, { type: 'application/json', body: Buffer.from('{"extraction":{"invoice_number":"A"}}', 'utf16le') })
      expect(r.status).toBe(400)
      expect((JSON.parse(r.text) as J).error).toMatch(/UTF-16/)
      expect((JSON.parse(r.text) as J).error).toMatch(/send UTF-8/)
    })
    it('bytes that are not UTF-8 are 400 and say so', async () => {
      const r = await call(port, { type: 'application/json', body: Buffer.concat([Buffer.from('{"extraction":{"a":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}')]) })
      expect(r.status).toBe(400)
      expect((JSON.parse(r.text) as J).error).toContain('UTF-8')
    })
  })
})

describe('4. the request-body cap', () => {
  it('serve --help states the cap beside the time and heap budget, and the flag that sets it', () => {
    for (const s of ['4 MiB', '32 MiB', '--max-body', '/v1/twin', '/v1/succession/replay', 'VERIFY_MAX_BODY_BYTES']) expect(SERVE_HELP, s).toContain(s)
  })
  it('--max-body <bytes> sets the default cap; a body past it is 413 naming the cap', async () => {
    const r = runServe(['--port', '0', '--max-body', '64'], { log: quiet, env: {} })
    expect(r.code).toBe(0)
    const s = r.server!
    await new Promise<void>(res => s.on('listening', () => res()))
    try {
      const port = (s.address() as AddressInfo).port
      const big = await call(port, { type: 'application/json', body: JSON.stringify({ extraction: { pad: 'x'.repeat(200) } }) })
      expect(big.status).toBe(413)
      expect((JSON.parse(big.text) as J).max_body_bytes).toBe(64)
    } finally { await new Promise<void>(res => s.close(() => res())) }
  })
  it('--max-body takes a positive whole number of bytes, else exit 3', () => {
    let err = ''
    const log = { out: (): void => {}, err: (x: string): void => { err += x } }
    for (const v of ['0', '-5', '4MiB', '1.5']) {
      err = ''
      expect(runServe(['--max-body', v], { log, env: {} }).code, v).toBe(3)
      expect(err, v).toContain('--max-body')
    }
  })
})
