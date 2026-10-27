/**
 * What the HTTP server answers (2026-10-05; an outside engineer's findings): `serve` accepted any Host header
 * (DNS rebinding open), parsed a text/plain body as JSON (so any web page could post to it without asking first), and its
 * /v1/openapi.json advertised ledger routes the default server answers 404.
 *
 * Now: `serve` answers only Host names it is bound to (loopback names, the bound address, --allow-host names), else 421; a
 * non-empty body is read only under Content-Type: application/json, else 415; and each server's spec lists the routes it serves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { allowedHostsFor, hostnameOf, isJsonContentType, serve, serveService } from '../src/http/serve'
import { createService } from '../src/http/service'
import { route } from '../src/http/router'
import { OPENAPI, openapiFor, MANAGED_PATHS } from '../src/http/openapi'
import { createLedger } from '../src/ledger/index'

type J = Record<string, unknown>
const quiet = { out: (): void => {}, err: (): void => {} }
const invoice = { invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax_rate: 0, tax: 0, total: 1500 } }

function call(port: number, o: { method?: string; path?: string; host?: string; type?: string; body?: string }): Promise<{ status: number; json: J }> {
  return new Promise((resolve, reject) => {
    const body = o.body === undefined ? undefined : Buffer.from(o.body)
    const headers: Record<string, string | number> = {}
    if (o.host !== undefined) headers.host = o.host
    if (o.type !== undefined) headers['content-type'] = o.type
    if (body) headers['content-length'] = body.length
    const req = request({ host: '127.0.0.1', port, path: o.path ?? '/v1/verify', method: o.method ?? 'POST', headers, setHost: o.host === undefined }, res => {
      let s = ''
      res.on('data', c => { s += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: s ? JSON.parse(s) as J : {} }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('the helpers', () => {
  it('hostnameOf reads the name without port or brackets, lowercased', () => {
    expect(hostnameOf('Example.COM:8080')).toBe('example.com')
    expect(hostnameOf('[::1]:8080')).toBe('::1')
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1')
    expect(hostnameOf('::1')).toBe('::1')
  })
  it('allowedHostsFor: loopback names and the bound address; a wildcard bind adds this machine\'s addresses; --allow-host adds names', () => {
    expect(allowedHostsFor('127.0.0.1')).toEqual(['localhost', '127.0.0.1', '::1'])
    expect(allowedHostsFor('10.0.0.5', ['Riposte.Example.com:443'])).toEqual(['localhost', '127.0.0.1', '::1', '10.0.0.5', 'riposte.example.com'])
    expect(allowedHostsFor('0.0.0.0', [], () => ['192.168.1.20', '127.0.0.1'])).toEqual(['localhost', '127.0.0.1', '::1', '192.168.1.20'])
    expect(allowedHostsFor('::', [], () => ['fe80::1'])).toContain('fe80::1')
  })
  it('isJsonContentType: application/json, with or without parameters; nothing else', () => {
    for (const t of ['application/json', 'Application/JSON; charset=utf-8']) expect(isJsonContentType(t), t).toBe(true)
    for (const t of [undefined, '', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx']) expect(isJsonContentType(t), String(t)).toBe(false)
  })
})

describe('verify serve on 127.0.0.1', () => {
  let server: ReturnType<typeof serve>
  let port = 0
  beforeAll(async () => {
    server = serve(0, { log: quiet, errorCodes: true })
    await new Promise<void>(r => server.on('listening', () => r()))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())) })

  it('answers its own names: 127.0.0.1, localhost and [::1], with any port', async () => {
    for (const host of [`127.0.0.1:${port}`, 'localhost', `[::1]:${port}`]) {
      expect((await call(port, { method: 'GET', path: '/v1/health', host })).status, host).toBe(200)
    }
  })
  it('a Host naming another site is 421, in words, before the body is read', async () => {
    const r = await call(port, { host: `rebind.example.com:${port}`, type: 'application/json', body: JSON.stringify({ extraction: invoice }) })
    expect(r.status).toBe(421)
    expect(r.json.code).toBe('request.host_not_allowed')
    expect(r.json.error).toContain('this server answers only the host names it is bound to (localhost, 127.0.0.1, ::1), not "rebind.example.com:')
    expect((await call(port, { method: 'GET', path: '/v1/health', host: '192.168.1.20' })).status).toBe(421)
  })
  it('a request with no Host header (HTTP/1.0) is 400, in words (2026-10-13: it used to be answered)', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const s = connect(port, '127.0.0.1', () => s.write('GET /v1/health HTTP/1.0\r\n\r\n'))
      let d = ''
      s.on('data', c => { d += c })
      s.on('end', () => resolve(d))
      s.on('error', reject)
    })
    expect(reply.startsWith('HTTP/1.1 400')).toBe(true)
    expect(reply).toContain('request.host_missing')
  })
  it('a body sent as text/plain, as a form, or with no Content-Type is 415, in words; application/json is read', async () => {
    const body = JSON.stringify({ extraction: invoice })
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      const r = await call(port, { ...(type ? { type } : {}), body })
      expect(r.status, String(type)).toBe(415)
      expect(r.json.code).toBe('body.unsupported_media_type')
      expect(r.json.error).toContain('this server reads a request body only when it is sent with Content-Type: application/json')
    }
    expect((await call(port, { type: 'application/json; charset=utf-8', body })).status).toBe(200)
    expect((await call(port, { method: 'GET', path: '/v1/health' })).status).toBe(200) // no body: no type needed
  })
  it('GET /v1/openapi.json lists only the routes this server serves: no book-of-record routes', async () => {
    const r = await call(port, { method: 'GET', path: '/v1/openapi.json' })
    const paths = Object.keys(r.json.paths as J)
    for (const p of MANAGED_PATHS) expect(paths, p).not.toContain(p)
    expect(paths).toContain('/v1/verify')
    expect((r.json.info as { description: string }).description).toContain('This server holds no book of record, so the routes that need one')
    // every route it lists answers something other than a bare 404 (a POST route answers 400 to an empty object)
    for (const p of paths.filter(x => !x.includes('{'))) {
      const op = Object.keys((r.json.paths as Record<string, J>)[p]!)[0]!
      const res = op === 'get' ? route({ method: 'GET', path: p }) : route({ method: 'POST', path: p, body: {} })
      expect(res.json, `${op} ${p}`).not.toEqual({ error: 'not found' })
    }
  })
})

describe('--allow-host, and the managed tier', () => {
  it('a name given with allowHosts is answered; the managed tier applies the same rule', async () => {
    const s = serve(0, { log: quiet, allowHosts: ['riposte.example.com'] })
    await new Promise<void>(r => s.on('listening', () => r()))
    const port = (s.address() as AddressInfo).port
    try {
      expect((await call(port, { method: 'GET', path: '/v1/health', host: 'riposte.example.com' })).status).toBe(200)
      expect((await call(port, { method: 'GET', path: '/v1/health', host: 'other.example.com' })).status).toBe(421)
    } finally { await new Promise<void>(r => s.close(() => r())) }
    const m = serveService(createService(), 0, { log: quiet })
    await new Promise<void>(r => m.on('listening', () => r()))
    const mport = (m.address() as AddressInfo).port
    try {
      expect((await call(mport, { method: 'GET', path: '/v1/health', host: 'rebind.example.com' })).status).toBe(421)
    } finally { await new Promise<void>(r => m.close(() => r())) }
  })
  it('the managed tier lists the book-of-record routes only when it holds a ledger', () => {
    const without = createService().handle({ method: 'GET', path: '/v1/openapi.json' })
    expect(Object.keys((without.json as { paths: J }).paths)).not.toContain('/v1/ledger/stats')
    const withLedger = createService({ ledger: createLedger() }).handle({ method: 'GET', path: '/v1/openapi.json' })
    expect(Object.keys((withLedger.json as { paths: J }).paths)).toEqual(Object.keys(OPENAPI.paths))
    expect(openapiFor({ ledger: true })).toBe(OPENAPI)
  })
})
