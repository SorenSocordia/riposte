/**
 * Typed SDK client — driven against the in-process router/service (the transport is injected), which proves the client's
 * request/response shapes line up with the real endpoints without binding a port.
 */
import { describe, it, expect } from 'vitest'
import { createClient, createService, createLedger, route, apiKeyAuth, VerifyError, type Transport } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const routeTransport: Transport = async (req) => route({ method: req.method, path: req.path, body: req.body, headers: req.headers })

describe('SDK over the pure router', () => {
  const client = createClient({ transport: routeTransport })

  it('health()', async () => {
    expect((await client.health()).status).toBe('ok')
  })

  it('verifyDeclared() returns a typed Verdict', async () => {
    const v = await client.verifyDeclared({ subtotal: 100, tax: 10, total: 110 }, ruleset)
    expect(v.verdict_id).toMatch(/./)
    expect(v.outcome).toBe('PASS')
  })

  it('measureRuleset() returns a measured accuracy', async () => {
    const m = await client.measureRuleset(ruleset, [
      { extraction: { subtotal: 1, tax: 1, total: 2 }, label: 'CLEAN' },
      { extraction: { subtotal: 1, tax: 1, total: 9 }, label: 'ERROR' },
    ])
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
  })

  it('throws VerifyError on a 4xx', async () => {
    await expect(client.verifyDeclared({ subtotal: 1 }, {} as DeclarativeRuleset)).rejects.toBeInstanceOf(VerifyError)
    await client.verifyDeclared({ subtotal: 1 }, {} as DeclarativeRuleset).catch((e: VerifyError) => expect(e.status).toBe(400))
  })
})

describe('SDK over the managed service', () => {
  it('auto-records via the client and reads stats back', async () => {
    const ledger = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const svc = createService({ ledger })
    const client = createClient({ transport: async (req) => svc.handle({ method: req.method, path: req.path, body: req.body, headers: req.headers }) })
    await client.verifyDeclared({ subtotal: 100, tax: 10, total: 110 }, ruleset)
    expect((await client.ledgerStats()).total).toBe(1)
  })

  it('carries the api key and is rejected without it', async () => {
    const svc = createService({ ledger: createLedger(), authenticate: apiKeyAuth({ 'k-alice': 'alice' }) })
    const transport: Transport = async (req) => svc.handle({ method: req.method, path: req.path, body: req.body, headers: req.headers })

    const anon = createClient({ transport })
    await expect(anon.verifyDeclared({ subtotal: 1, tax: 1, total: 2 }, ruleset)).rejects.toMatchObject({ status: 401 })

    const alice = createClient({ transport, apiKey: 'k-alice' })
    const v = await alice.verifyDeclared({ subtotal: 1, tax: 1, total: 2 }, ruleset)
    expect(v.outcome).toBe('PASS')
  })
})
