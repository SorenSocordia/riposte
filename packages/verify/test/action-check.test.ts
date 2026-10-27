/**
 * POST /v1/action/check and the MCP action_check tool (2026-09-28): one proposed tool call and its
 * declared sources at a rung → the verify_action verdict, its notice and the disposition the hold adapters deliver, so a
 * Python host can check an action over HTTP without a node subprocess.
 *   - the disposition table (every outcome × every rung) is the adapters' dispositionOf, restated here and held to it;
 *   - stateless (router, MCP): the rung is the request's `level` (default record); `workflow_id` is refused, not ignored;
 *   - managed tier: `workflow_id` reads the rung from the book (GRANT > declared settings > record); a request may restate
 *     it, never change it (409); another tenant's workflow is 404; a book that does not verify is 409;
 *   - the door: the verdict is recorded to the caller's book like any other; the response never changes.
 */
import { describe, it, expect } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import {
  verifyAction, actionNotice, hashOf, makeGrant, signDecision, policyRef, parseChainJSONL, MemoryLedger, createLedger,
  EXAMPLE_PROMOTION_POLICY, ACTION_HANDLING, VOICE_LADDER, type Verdict, type VoiceLevel, type Ledger,
} from '../src/index'
import { actionCheckFromJson, actionDisposition, actionFromJson, levelFromJson, SurfaceInputError, type ActionCheckSurface } from '../src/http/surfaces'
import { route } from '../src/http/router'
import { createService, apiKeyAuth, verdictDoorProblem, type UnrecordedEvent } from '../src/http/service'
import { OPENAPI } from '../src/http/openapi'
import { handleRequest, TOOLS, type JsonRpcRequest } from '../src/mcp/server'

const NOW = () => new Date('2026-09-28T10:00:00Z')
const WIRE = { tool: 'wire_transfer', arguments: { amount: 500, to_account: '110-234-5678' } }
const APPROVED = { allowed: { amount: [500], to_account: ['110-234-5678'] } }
const CASES = {
  PASS: { action: WIRE, sources: APPROVED },
  FAIL: { action: WIRE, sources: { allowed: { amount: [500], to_account: ['999-000-1111'] } } },
  // partially grounded: the amount is allow-listed, the account number has no declared source
  INSUFFICIENT_DATA: { action: WIRE, sources: { allowed: { amount: [500] } } },
} as const
/** The hold adapters' dispositionOf (products/adapters/src/hold.ts), restated: every outcome × rung. */
const TABLE: Record<keyof typeof CASES, Record<VoiceLevel, string>> = {
  PASS: { record: 'proceed', advise: 'proceed', gate: 'review', autonomy: 'proceed' },
  FAIL: { record: 'record', advise: 'surface', gate: 'hold', autonomy: 'hold' },
  INSUFFICIENT_DATA: { record: 'record', advise: 'surface', gate: 'hold', autonomy: 'hold' },
}
const withoutClock = (s: ActionCheckSurface): unknown => ({ ...s, verdict: { ...s.verdict, issued_at: '-' } })

function keyFromSeed(seedHex: string): string {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }).toString()
}
const OWNER = keyFromSeed('11'.repeat(32))
const OWNER_ANCHOR = { owner: createPublicKey(createPrivateKey(OWNER)).export({ type: 'spki', format: 'pem' }).toString() }
const grantOn = (ledger: Ledger, wf: string, level: VoiceLevel): void => {
  ledger.decide(signDecision(makeGrant({
    workflow_id: wf, level, consequence_tier: 'low', policy: policyRef(EXAMPLE_PROMOTION_POLICY),
    ...(level === 'autonomy' ? { bounds: 'wires under $1,000 to allow-listed accounts' } : {}), signer_id: 'owner', signed_at: '2026-09-28T09:40:00Z',
  }), OWNER))
}

describe('the disposition: what one call gets at each rung', () => {
  it('every outcome × every rung is the adapters\' table; holds is true exactly for hold and review', () => {
    for (const [outcome, body] of Object.entries(CASES) as [keyof typeof CASES, (typeof CASES)[keyof typeof CASES]][]) {
      for (const level of VOICE_LADDER) {
        const s = actionCheckFromJson({ ...body, level }, { now: NOW })
        expect(s.verdict.outcome, `${outcome}@${level}`).toBe(outcome)
        expect(s.disposition, `${outcome}@${level}`).toBe(TABLE[outcome][level])
        expect(s.holds).toBe(s.disposition === 'hold' || s.disposition === 'review')
        expect(s).toMatchObject({ surface_version: 'action-check-v0', tool: 'wire_transfer', level, level_source: 'request' })
      }
    }
  })

  it('the verdict is verifyAction\'s, the notice is actionNotice\'s, the call hash is the adapters\'', () => {
    const s = actionCheckFromJson({ ...CASES.FAIL, level: 'gate' }, { now: NOW })
    const v = verifyAction(WIRE, CASES.FAIL.sources, { now: NOW })
    expect(s.verdict).toEqual(v)
    expect(s.notice).toEqual(actionNotice(v, 'gate'))
    expect(s.notice.handling).toEqual(ACTION_HANDLING.gate)
    expect(s.call_hash).toBe(hashOf({ tool: WIRE.tool, arguments: WIRE.arguments }))
    expect(s.notice_markdown).toMatch(/^\*\*HELD for a person\*\* · rung `gate`/)
    expect(s.notice_markdown).toContain(`verify opinion --ledger <chain.jsonl> --dispute ${v.verdict_id}`)
    expect(verdictDoorProblem(s.verdict)).toBeUndefined()
    expect(actionDisposition(s.notice)).toBe('hold')
  })

  it('no level: record, the day-1 default (level_source default)', () => {
    const s = actionCheckFromJson(CASES.FAIL, { now: NOW })
    expect(s).toMatchObject({ level: 'record', level_source: 'default', disposition: 'record', holds: false })
  })

  it('refuses what a caller must supply, and a workflow_id only a book can answer', () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{}, /"action" is required/],
      [{ action: { arguments: {} } }, /"action" is required/],
      [{ action: { tool: 'x', arguments: 5 } }, /"action.arguments" must be an object/],
      [{ action: WIRE, sources: 'all' }, /"sources" must be/],
      [{ action: WIRE, sources: { text: 5 } }, /"sources.text" must be a string/],
      [{ action: WIRE, sources: { allowed: [] } }, /"sources.allowed" must be/],
      [{ action: WIRE, sources: { allowed: { amount: 500 } } }, /"sources.allowed.amount" must be an array/],
      [{ action: WIRE, sources: { allowed: { amount: [{}] } } }, /"sources.allowed.amount" must be an array/],
      [{ action: WIRE, sources: { require: 'amount' } }, /"sources.require" must be an array/],
      [{ action: WIRE, level: 'sovereign' }, /"level" must be one of record, advise, gate, autonomy/],
      [{ action: WIRE, workflow_id: 'acme/payments@1' }, /managed tier/],
    ]
    for (const [body, why] of bad) {
      expect(() => actionCheckFromJson(body), JSON.stringify(body)).toThrow(SurfaceInputError)
      expect(() => actionCheckFromJson(body)).toThrow(why)
    }
    // a missing arguments object is an empty one, as verify_action takes it
    expect(actionFromJson({ action: { tool: 'noop' } }).action).toEqual({ tool: 'noop', arguments: {} })
    expect(levelFromJson(undefined)).toBeUndefined()
  })
})

describe('HTTP and MCP: the same check', () => {
  it('POST /v1/action/check (pure) equals the adapter; 400 on bad input', () => {
    const r = route({ method: 'POST', path: '/v1/action/check', body: { ...CASES.INSUFFICIENT_DATA, level: 'autonomy' } })
    expect(r.status).toBe(200)
    const s = r.json as ActionCheckSurface
    expect(s).toMatchObject({ disposition: 'hold', holds: true, level: 'autonomy' }) // a partially grounded call is held at autonomy
    expect(withoutClock(s)).toEqual(withoutClock(actionCheckFromJson({ ...CASES.INSUFFICIENT_DATA, level: 'autonomy' })))
    expect(route({ method: 'POST', path: '/v1/action/check', body: { action: 5 } }).status).toBe(400)
    const wf = route({ method: 'POST', path: '/v1/action/check', body: { action: WIRE, workflow_id: 'acme/payments@1' } })
    expect(wf.status).toBe(400)
    expect((wf.json as { error: string }).error).toMatch(/managed tier/)
  })

  it('MCP action_check is advertised and returns the same surface as structured content', () => {
    const t = (TOOLS as readonly { name: string; inputSchema: { required: readonly string[]; properties: Record<string, unknown> } }[]).find(x => x.name === 'action_check')!
    expect(t).toBeDefined()
    expect([...t.inputSchema.required]).toEqual(['action'])
    for (const k of ['action', 'sources', 'level']) expect(Object.keys(t.inputSchema.properties)).toContain(k)
    const call = (args: unknown) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'action_check', arguments: args } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent?: ActionCheckSurface; content: { text: string }[] }
    const m = call({ ...CASES.PASS, level: 'gate' })
    expect(m.isError).toBe(false)
    expect(withoutClock(m.structuredContent!)).toEqual(withoutClock(actionCheckFromJson({ ...CASES.PASS, level: 'gate' })))
    expect(m.structuredContent!.disposition).toBe('review')
    const e = call({ action: WIRE, workflow_id: 'acme/payments@1' })
    expect(e.isError).toBe(true)
    expect(e.content[0]!.text).toMatch(/managed tier/)
  })

  it('the OpenAPI entry names the route, its body and its answers', () => {
    const op = (OPENAPI.paths as Record<string, { post?: { requestBody: { content: { 'application/json': { schema: { required: readonly string[] } } } }; responses: Record<string, unknown> } }>)['/v1/action/check']!.post!
    expect([...op.requestBody.content['application/json'].schema.required]).toEqual(['action'])
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '404', '409'])
  })
})

describe('managed tier: the rung is read from the book; the verdict is recorded', () => {
  const WF = 'acme/action@0.0.1'
  const post = (svc: ReturnType<typeof createService>, body: unknown, key = 'ka') => svc.handle({ method: 'POST', path: '/v1/action/check', body, headers: { 'x-api-key': key } })

  it('without a workflow: the request\'s rung (stateless), and the verdict is recorded under the tenant', () => {
    const ledger = createLedger({ now: NOW })
    const svc = createService({ ledger, authenticate: apiKeyAuth({ ka: 'acme' }) })
    const r = post(svc, { ...CASES.FAIL, level: 'advise' })
    expect(r.status).toBe(200)
    const s = r.json as ActionCheckSurface
    expect(s).toMatchObject({ level: 'advise', level_source: 'request', disposition: 'surface' })
    const rec = ledger.get(s.verdict.verdict_id)!
    expect(rec.tenant_id).toBe('acme')
    expect(rec.verdict.outcome).toBe('FAIL')
  })

  it('a workflow with a GRANT: held at the granted rung; restating it is fine; changing it is 409; the call is still recorded', () => {
    const ledger = createLedger({ now: NOW, trusted_keys: OWNER_ANCHOR }) // D-ANCHOR: the owner is anchored, so the grant is in force
    grantOn(ledger, WF, 'gate')
    const svc = createService({ ledger, voice: { settings: () => ({ consequence_tier: 'low', granted: 'record' }) }, authenticate: apiKeyAuth({ ka: 'acme', kb: 'beta' }) })
    const r = post(svc, { ...CASES.FAIL, workflow_id: WF })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ level: 'gate', level_source: 'grant', workflow_id: WF, disposition: 'hold', holds: true })
    expect(ledger.get((r.json as ActionCheckSurface).verdict.verdict_id)?.tenant_id).toBe('acme')
    expect(post(svc, { ...CASES.PASS, workflow_id: WF, level: 'gate' }).json).toMatchObject({ disposition: 'review' })
    const changed = post(svc, { ...CASES.FAIL, workflow_id: WF, level: 'record' })
    expect(changed.status).toBe(409)
    expect((changed.json as { error: string }).error).toMatch(/the rung on record for acme\/action@0\.0\.1 is gate \(a person's signed GRANT on the book\); this request says record/)
    expect(post(svc, { ...CASES.FAIL, workflow_id: WF }, 'kb').status).toBe(404)
    expect(post(svc, { ...CASES.FAIL, workflow_id: 5 }).status).toBe(400)
    expect(post(svc, { action: 5, workflow_id: WF }).status).toBe(400)
  })

  it('D-ANCHOR: an unanchored GRANT has no effect; the call is held at the declared rung, never at the self-signed one', () => {
    const ledger = createLedger({ now: NOW }) // no trusted keys: any valid signature passes the door, and moves nothing
    grantOn(ledger, WF, 'autonomy')
    const svc = createService({ ledger, voice: { settings: () => ({ consequence_tier: 'low', granted: 'record' }) }, authenticate: apiKeyAuth({ ka: 'acme' }) })
    expect(post(svc, { ...CASES.FAIL, workflow_id: WF }).json).toMatchObject({ level: 'record', disposition: 'record', holds: false })
    expect(post(svc, { ...CASES.FAIL, workflow_id: WF, level: 'autonomy' }).status).toBe(409)
  })

  it('no GRANT: the declared settings, else record (nothing granted)', () => {
    const ledger = createLedger({ now: NOW })
    const declared = createService({ ledger, voice: { settings: () => ({ consequence_tier: 'low', granted: 'autonomy', bounds: 'all' }) } })
    expect(declared.handle({ method: 'POST', path: '/v1/action/check', body: { ...CASES.PASS, workflow_id: 'default/action@0.0.1' } }).json)
      .toMatchObject({ level: 'autonomy', level_source: 'declaration', disposition: 'proceed' })
    const none = createService({ ledger })
    expect(none.handle({ method: 'POST', path: '/v1/action/check', body: { ...CASES.FAIL, workflow_id: 'default/action@0.0.1' } }).json)
      .toMatchObject({ level: 'record', level_source: 'none', disposition: 'record' })
    // no ledger at all: the declared settings still name the rung
    const noBook = createService({ voice: { settings: () => ({ consequence_tier: 'low', granted: 'gate' }) } })
    expect(noBook.handle({ method: 'POST', path: '/v1/action/check', body: { ...CASES.FAIL, workflow_id: 'default/action@0.0.1' } }).json)
      .toMatchObject({ level: 'gate', level_source: 'declaration', disposition: 'hold' })
  })

  it('a book that does not verify grants nothing: 409, and nothing is recorded', () => {
    const src = createLedger({ now: NOW })
    grantOn(src, 'default/action@0.0.1', 'autonomy')
    const agentKey = createPublicKey(createPrivateKey(keyFromSeed('33'.repeat(32)))).export({ type: 'spki', format: 'pem' }).toString()
    const ledger = new MemoryLedger({ seed: parseChainJSONL(src.chainJSONL()), trusted_keys: { someone: agentKey } })
    const unrecorded: UnrecordedEvent[] = []
    const svc = createService({ ledger, onUnrecorded: e => unrecorded.push(e) })
    const before = ledger.events().length
    const r = svc.handle({ method: 'POST', path: '/v1/action/check', body: { ...CASES.PASS, workflow_id: 'default/action@0.0.1' } })
    expect(r.status).toBe(409)
    expect((r.json as { error: string }).error).toMatch(/does not verify.*grants nothing/)
    expect(ledger.events().length).toBe(before)
  })

  it('the response is the verdict-bearing surface; only its verdict is recorded (never the notice)', () => {
    const ledger = createLedger({ now: NOW })
    const unrecorded: UnrecordedEvent[] = []
    const svc = createService({ ledger, onUnrecorded: e => unrecorded.push(e) })
    const r = svc.handle({ method: 'POST', path: '/v1/action/check', body: { ...CASES.PASS, level: 'autonomy' } })
    expect(r.status).toBe(200)
    expect(unrecorded).toEqual([])
    expect(ledger.all().map(x => (x.verdict as Verdict).verdict_id)).toEqual([(r.json as ActionCheckSurface).verdict.verdict_id])
  })
})
