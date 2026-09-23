/**
 * Webhooks — signed verdict.recorded delivery, fired by the managed service on record. Dispatcher is captured (no
 * network); the fetch dispatcher is tested against an injected fetch.
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { signPayload, createFetchDispatcher, createService, createLedger, type WebhookEvent, type WebhookTarget, type HttpRequest } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const verifyReq = (extraction: unknown): HttpRequest => ({ method: 'POST', path: '/v1/verify/declared', body: { extraction, ruleset } })

describe('signPayload', () => {
  it('is a deterministic HMAC-SHA256 over the body', () => {
    const sig = signPayload('shh', '{"a":1}')
    expect(sig).toBe(`sha256=${createHmac('sha256', 'shh').update('{"a":1}', 'utf8').digest('hex')}`)
    expect(signPayload('shh', '{"a":1}')).toBe(sig)
  })
})

describe('service fires verdict.recorded webhooks', () => {
  it('dispatches one event per recorded verdict to the tenant’s targets', () => {
    const seen: Array<{ event: WebhookEvent; target: WebhookTarget }> = []
    const svc = createService({
      ledger: createLedger(),
      webhooks: { resolve: () => [{ url: 'https://hook.example/x' }], dispatch: (event, target) => { seen.push({ event, target }) } },
    })
    svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 }))
    expect(seen).toHaveLength(1)
    expect(seen[0].event.type).toBe('verdict.recorded')
    expect(seen[0].event.verdict.outcome).toBe('PASS')
    expect(seen[0].target.url).toBe('https://hook.example/x')
  })

  it('fires nothing when the tenant has no targets', () => {
    const seen: unknown[] = []
    const svc = createService({ ledger: createLedger(), webhooks: { resolve: () => [], dispatch: (e) => { seen.push(e) } } })
    svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 }))
    expect(seen).toHaveLength(0)
  })

  it('a throwing dispatcher never breaks the verdict response', () => {
    const svc = createService({ ledger: createLedger(), webhooks: { resolve: () => [{ url: 'x' }], dispatch: () => { throw new Error('boom') } } })
    expect(svc.handle(verifyReq({ subtotal: 1, tax: 1, total: 2 })).status).toBe(200)
  })
})

describe('createFetchDispatcher', () => {
  it('POSTs the signed event to the target URL', async () => {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = []
    const fetch = async (url: string, init?: unknown) => { calls.push({ url, init: init as never }); return { status: 200 } }
    const dispatch = createFetchDispatcher({ fetch })
    const event: WebhookEvent = { type: 'verdict.recorded', tenant_id: 't', verdict: { verdict_id: 'v1' } as never }
    await dispatch(event, { url: 'https://hook.example/y', secret: 'shh' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hook.example/y')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['x-verify-event']).toBe('verdict.recorded')
    expect(calls[0].init.headers['x-verify-signature']).toBe(signPayload('shh', calls[0].init.body))
  })

  it('omits the signature header when no secret is set', async () => {
    const calls: Array<{ init: { headers: Record<string, string> } }> = []
    const fetch = async (_url: string, init?: unknown) => { calls.push({ init: init as never }); return { status: 200 } }
    await createFetchDispatcher({ fetch })({ type: 'verdict.recorded', tenant_id: 't', verdict: { verdict_id: 'v1' } as never }, { url: 'x' })
    expect(calls[0].init.headers['x-verify-signature']).toBeUndefined()
  })
})
