/**
 * The managed/hosted tier — the stateful service composed around the pure router: auth → rate-limit → verify →
 * auto-record, plus the /v1/ledger/* dashboard reads. The pure core stays untouched; this tests the composition.
 */
import { describe, it, expect } from 'vitest'
import { createService, apiKeyAuth, fixedWindowRateLimiter, createLedger, type HttpRequest } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const verifyReq = (extraction: unknown, headers?: Record<string, string>): HttpRequest =>
  ({ method: 'POST', path: '/v1/verify/declared', body: { extraction, ruleset }, ...(headers ? { headers } : {}) })

describe('auto-record into the ledger', () => {
  it('records every verdict-bearing 200 under the tenant, and serves it back via /v1/ledger/stats', () => {
    const ledger = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const svc = createService({ ledger })
    expect(svc.handle(verifyReq({ subtotal: 100, tax: 10, total: 110 })).status).toBe(200)
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 999 })).status).toBe(200)
    expect(ledger.stats('default')).toMatchObject({ total: 2, by_outcome: { PASS: 1, FAIL: 1, INSUFFICIENT_DATA: 0 } })
    const stats = svc.handle({ method: 'GET', path: '/v1/ledger/stats' })
    expect(stats.status).toBe(200)
    expect((stats.json as { total: number }).total).toBe(2)
  })

  it('records each verdict of a batch response', () => {
    const ledger = createLedger()
    const svc = createService({ ledger })
    const res = svc.handle({ method: 'POST', path: '/v1/verify/batch', body: { items: [
      { extraction: { subtotal: 1, tax: 1, total: 2 }, options: { ruleset } },
    ] } })
    expect(res.status).toBe(200)
    const results = (res.json as { results: Array<{ verdict_id: string }> }).results
    expect(results.length).toBe(1)
    // every verdict in the batch response is recorded under the tenant
    expect(ledger.all().length).toBe(results.length)
  })
})

describe('authentication', () => {
  const keys = { 'hc_live_alice': 'alice', 'hc_live_bob': 'bob' }
  it('rejects a missing/unknown key with 401 and never records it', () => {
    const ledger = createLedger()
    const svc = createService({ ledger, authenticate: apiKeyAuth(keys) })
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 })).status).toBe(401)
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 }, { 'x-api-key': 'nope' })).status).toBe(401)
    expect(ledger.all().length).toBe(0)
  })
  it('routes a valid key to its tenant and records under it', () => {
    const ledger = createLedger()
    const svc = createService({ ledger, authenticate: apiKeyAuth(keys) })
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 }, { 'x-api-key': 'hc_live_alice' })).status).toBe(200)
    expect(ledger.stats('alice').total).toBe(1)
    expect(ledger.stats('bob').total).toBe(0)
  })
  it('leaves public endpoints (health) open', () => {
    const svc = createService({ ledger: createLedger(), authenticate: apiKeyAuth(keys) })
    expect(svc.handle({ method: 'GET', path: '/v1/health' }).status).toBe(200)
  })
})

describe('rate limiting', () => {
  it('429s past the window limit with a retry hint', () => {
    let t = 0
    const svc = createService({ ledger: createLedger(), rateLimiter: fixedWindowRateLimiter({ limit: 1, windowMs: 60000, now: () => t }) })
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 })).status).toBe(200)
    const limited = svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 }))
    expect(limited.status).toBe(429)
    expect((limited.json as { retry_after_seconds: number }).retry_after_seconds).toBe(60)
    t = 60000 // window elapsed
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 })).status).toBe(200)
  })
})

describe('stateful dashboard reads', () => {
  it('serves the book-of-record report and per-rule calibration', () => {
    const ledger = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const svc = createService({ ledger })
    const fail = svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 999 }))
    const verdictId = (fail.json as { verdict_id: string }).verdict_id
    ledger.review(verdictId, { reviewer_id: 'r', decision: 'OVERTURNED' })
    const report = svc.handle({ method: 'GET', path: '/v1/ledger/report' })
    expect(report.status).toBe(200)
    expect((report.json as { markdown: string }).markdown).toMatch(/book of record/)
    const cal = svc.handle({ method: 'GET', path: '/v1/ledger/calibration' })
    expect((cal.json as { rules: unknown[] }).rules.length).toBeGreaterThan(0)
  })
})
