/**
 * HTTP surface (the "run it as a service" layer). We test the pure router; serve.ts is a thin node:http wrapper.
 */
import { describe, it, expect } from 'vitest'
import { route } from '../src/http/router'
import { clean, broken } from './fixtures/invoices'

const post = (path: string, body: unknown) => route({ method: 'POST', path, body })

describe('meta endpoints', () => {
  it('GET /v1/health returns ok + engine version', () => {
    const r = route({ method: 'GET', path: '/v1/health' })
    expect(r.status).toBe(200)
    expect((r.json as Record<string, unknown>).status).toBe('ok')
    expect((r.json as Record<string, unknown>).engine_version).toBeTruthy()
  })
  it('GET /v1/openapi.json returns a 3.1 spec describing the endpoints', () => {
    const r = route({ method: 'GET', path: '/v1/openapi.json' })
    expect(r.status).toBe(200)
    const spec = r.json as { openapi: string; paths: Record<string, unknown> }
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/v1/verify', '/v1/verify/declared', '/v1/verify/action', '/v1/verify/citations']))
  })
})

describe('POST /v1/verify', () => {
  it('verifies a clean invoice → 200 PASS', () => {
    const r = post('/v1/verify', { extraction: clean })
    expect(r.status).toBe(200)
    expect((r.json as { outcome: string }).outcome).toBe('PASS')
  })
  it('a broken invoice → FAIL', () => {
    expect((post('/v1/verify', { extraction: broken }).json as { outcome: string }).outcome).toBe('FAIL')
  })
  it('missing extraction → 400', () => {
    expect(post('/v1/verify', {}).status).toBe(400)
  })
})

describe('POST /v1/verify/declared', () => {
  const PO = {
    id: 'po', version: '0.0.1', lineArrayKeys: ['items'],
    fields: { AMT: { paths: ['amount'], kind: 'amount', line: true }, SUB: { paths: ['subtotal'] } },
    computed: { SUM: 'sum(AMT)' },
    checks: [{ code: 'SUM_INT', left: 'SUM', op: '=', right: 'SUB' }],
  }
  it('verifies a document against a declarative ruleset over HTTP', () => {
    const r = post('/v1/verify/declared', { extraction: { items: [{ amount: 100 }, { amount: 50 }], subtotal: 150 }, ruleset: PO })
    expect(r.status).toBe(200)
    expect((r.json as { outcome: string }).outcome).toBe('PASS')
  })
  it('an invalid ruleset → 400', () => {
    expect(post('/v1/verify/declared', { extraction: {}, ruleset: { nope: true } }).status).toBe(400)
  })
})

describe('POST /v1/verify/action and /citations', () => {
  it('grounds an action (account not in allow-list → FAIL)', () => {
    const r = post('/v1/verify/action', { action: { tool: 'wire', arguments: { to: '9' } }, sources: { allowed: { to: ['1'] } } })
    expect(r.status).toBe(200)
    expect((r.json as { outcome: string }).outcome).toBe('FAIL')
  })
  it('cite-checks a quote against a supplied opinion', () => {
    const r = post('/v1/verify/citations', { citations: [{ id: 'a', case_name: 'X', quote: 'the sky is blue' }], sources: { X: 'the court found the sky is blue that day' } })
    expect((r.json as { outcome: string }).outcome).toBe('PASS')
  })
})

describe('routing errors', () => {
  it('unknown path → 404; non-POST verify → 404', () => {
    expect(post('/v1/nope', {}).status).toBe(404)
    expect(route({ method: 'GET', path: '/v1/verify' }).status).toBe(404)
  })
})
