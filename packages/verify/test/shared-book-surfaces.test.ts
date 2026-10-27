/**
 * 2026-09-28: the shared-book 409 on POST /v1/opinion is lifted. The opinion takes the caller's
 * tenant scope (opinion/snapshot.ts): the chain is verified whole, but precedent, evidence and grants are the caller's own.
 *   - managed tier: a dispute on a book shared with another tenant is served (200), equal to the scoped disputeOpinion, and
 *     its JSON holds no other tenant's reviewer id, note or verdict id; another tenant's verdict is still 404;
 *   - stateless (router, MCP opinion_render): an optional `tenant_id` reads one tenant of a shared chain export;
 *   - the managed tier refuses a request `tenant_id` other than the caller's.
 * The book is sharedBook() from test/opinion-scope.test.ts, rebuilt here (a test file is not importable).
 */
import { describe, it, expect } from 'vitest'
import { verify, createLedger, disputeOpinion, snapshotOfLedger, promotionOpinion, type Ledger, type Opinion } from '../src/index'
import { createService, apiKeyAuth, NOT_THE_TENANTS } from '../src/http/service'
import { route } from '../src/http/router'
import { opinionFromJson } from '../src/http/surfaces'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { broken, FIXED_NOW } from './fixtures/invoices'
import { buildLedger, freshClock, WF } from './fixtures/voice-ledger'
import { TINY } from './fixtures/opinion-book'

const GLOBEX_REVIEWER = 'globex-controller'
const GLOBEX_NOTE = 'GLOBEX-CONFIDENTIAL: vendor dispute, see counsel memo'

/** acme: 10 FAILs, 9 reviewed UPHELD, the 10th unreviewed (the one disputed). globex: 10 FAILs, 6 OVERTURNED with a private note. */
function sharedBook(): { ledger: Ledger; acmeFails: string[]; globexFails: string[] } {
  const ledger = createLedger({ now: freshClock() })
  const acme = buildLedger({ ledger, tenant: 'acme', passes: 2, fails: 10, reviewedFails: 9 })
  const globexFails: string[] = []
  for (let i = 0; i < 10; i++) {
    const v = verify({ ...broken, invoice_number: `globex-F${i}` }, { now: FIXED_NOW })
    ledger.record(v, { tenant_id: 'globex' })
    ledger.review(v.verdict_id, { reviewer_id: GLOBEX_REVIEWER, decision: i < 6 ? 'OVERTURNED' : 'UPHELD', note: GLOBEX_NOTE })
    globexFails.push(v.verdict_id)
  }
  return { ledger, acmeFails: acme.failIds, globexFails }
}
const leaksGlobex = (x: unknown, ids: readonly string[]): boolean => {
  const s = JSON.stringify(x)
  return s.includes(GLOBEX_REVIEWER) || s.includes('GLOBEX-CONFIDENTIAL') || ids.some(id => s.includes(id))
}

describe('POST /v1/opinion on a shared book: served, scoped to the caller', () => {
  const { ledger, acmeFails, globexFails } = sharedBook()
  const target = acmeFails[9]!
  const svc = createService({ ledger, authenticate: apiKeyAuth({ ka: 'acme', kg: 'globex' }) })
  const post = (body: unknown, key = 'ka') => svc.handle({ method: 'POST', path: '/v1/opinion', body, headers: { 'x-api-key': key } })

  it('a dispute is 200 and IS the scoped disputeOpinion; nothing of the other tenant is quoted', () => {
    const r = post({ dispute: { verdict_id: target, claim_id: 'document.SUM_INT' } })
    expect(r.status).toBe(200)
    const { opinion, markdown } = r.json as { opinion: Opinion; markdown: string }
    const scoped = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, claim_id: 'document.SUM_INT', scope: { tenant_id: 'acme' } })
    expect(JSON.stringify(opinion)).toBe(JSON.stringify(scoped))
    expect(opinion.ruling.disposition).toBe('UPHOLD') // acme's own 9 upheld reviews
    expect(opinion.subject).toMatchObject({ tenant_id: 'acme' })
    expect(leaksGlobex(r.json, globexFails)).toBe(false)
    expect(markdown).not.toContain('GLOBEX')
    // the control: unscoped, the same question cites globex and flips to REFER (the leak the 409 used to prevent)
    const unscoped = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, claim_id: 'document.SUM_INT' })
    expect(unscoped.ruling.disposition).toBe('REFER')
    expect(leaksGlobex(unscoped, globexFails)).toBe(true)
  })

  it('globex gets its own scope, and another tenant\'s verdict is still 404 with nothing but an error', () => {
    const g = post({ dispute: { verdict_id: globexFails[9]! } }, 'kg')
    expect(g.status).toBe(200)
    expect(JSON.stringify(g.json)).not.toContain(acmeFails[0]!)
    const foreign = post({ dispute: { verdict_id: globexFails[0]! } })
    expect(foreign.status).toBe(404)
    expect(Object.keys(foreign.json as object)).toEqual(['error'])
  })

  it('a request may restate its own tenant_id, never another\'s', () => {
    expect(post({ dispute: { verdict_id: target }, tenant_id: 'acme' }).status).toBe(200)
    const other = post({ dispute: { verdict_id: target }, tenant_id: 'globex' })
    expect(other.status).toBe(400)
    expect((other.json as { error: string }).error).toMatch(/never read under another tenant's scope/)
  })

  it('the scoped refusals the service answers 404 are the library\'s own words', () => {
    let dispute = '', promotion = ''
    try { disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: globexFails[0]!, scope: { tenant_id: 'acme' } }) } catch (e) { dispute = (e as Error).message }
    try { promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF('globex'), consequence_tier: 'low', scope: { tenant_id: 'acme' } }) } catch (e) { promotion = (e as Error).message }
    expect(dispute).toMatch(NOT_THE_TENANTS)
    expect(promotion).toMatch(NOT_THE_TENANTS)
    expect('the policy does not lint').not.toMatch(NOT_THE_TENANTS)
  })
})

describe('stateless: tenant_id reads one tenant of a shared chain export', () => {
  const { ledger, acmeFails, globexFails } = sharedBook()
  const chain = ledger.chainJSONL()
  const target = acmeFails[9]!
  const scoped = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, scope: { tenant_id: 'acme' } })

  it('POST /v1/opinion (pure) and MCP opinion_render equal the scoped opinion', () => {
    const r = route({ method: 'POST', path: '/v1/opinion', body: { ledger: chain, dispute: { verdict_id: target }, tenant_id: 'acme' } })
    expect(r.status).toBe(200)
    expect(JSON.stringify((r.json as { opinion: Opinion }).opinion)).toBe(JSON.stringify(scoped))
    const m = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'opinion_render', arguments: { ledger: chain, dispute: { verdict_id: target }, tenant_id: 'acme' } } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent: Opinion }
    expect(m.isError).toBe(false)
    expect(JSON.stringify(m.structuredContent)).toBe(JSON.stringify(scoped))
    expect(leaksGlobex(m.structuredContent, globexFails)).toBe(false)
    // without tenant_id: unscoped, exactly as before
    expect(JSON.stringify(opinionFromJson({ ledger: chain, dispute: { verdict_id: target } }).opinion)).toBe(JSON.stringify(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target })))
  })

  it('refuses an empty tenant_id, and a verdict outside the named tenant', () => {
    expect(() => opinionFromJson({ ledger: chain, dispute: { verdict_id: target }, tenant_id: '' })).toThrow(/"tenant_id" must be a tenant id/)
    expect(() => opinionFromJson({ ledger: chain, dispute: { verdict_id: globexFails[0]! }, tenant_id: 'acme' })).toThrow(NOT_THE_TENANTS)
  })
})
