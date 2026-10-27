/**
 * SURFACES-2 (2026-09-28): the evidence behind a rung, the reviewer's queue, and twin v0.2 over MCP and HTTP.
 *   - voice_assess / GET /v1/voice/{workflow} carry `basis` (the open demotion's: failure = urgent, unevidenced = a standing
 *     notice) and `evidence` (the book's evidence audit, assessment.book.evidence), each equal to what the library says;
 *   - GET /v1/queue/{workflow} (managed tier): the reviewer's queue, reviewQueue verbatim, tenant-scoped, honest when
 *     nothing is drawn, 409 on a book that does not verify;
 *   - verify_twin / POST /v1/twin take CREDENCE-2 §7's flat fields (ruleset, pre, filing_summary, schema) with the same
 *     mapping as the nested form, and refuse two ways of saying one thing that disagree.
 * Real verify() verdicts through the real ledger; anchored keys (D-ANCHOR: an unanchored decision has no rung effect).
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import {
  verify, createLedger, MemoryLedger, parseChainJSONL, commitDueSamples, reviewQueue, assessVoiceFromLedger, policyRef,
  verifyAgainstTwin, parseTwinPresentation, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, lintPolicy,
  type Ledger, type Verdict, type PromotionPolicy,
} from '../src/index'
import { createService, apiKeyAuth, type Service } from '../src/http/service'
import { route, type HttpResponse } from '../src/http/router'
import { OPENAPI } from '../src/http/openapi'
import { voiceSurface, reviewQueueSurface, twinFromJson, TWIN_RULESETS } from '../src/http/surfaces'
import { openSnapshot, snapshotOfLedger } from '../src/opinion/index'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'
import { buildLedger, freshClock, WF } from './fixtures/voice-ledger'
import { OWNER, AGENT, TRUSTED, TINY, grant } from './fixtures/opinion-book'

interface ToolResult { isError: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] }
const tool = (name: string, args: unknown): ToolResult =>
  handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as JsonRpcRequest)!.result as ToolResult
const get = (svc: Service, path: string, key = 'ka'): HttpResponse => svc.handle({ method: 'GET', path, headers: { 'x-api-key': key } })
const auth = apiKeyAuth({ ka: 'acme', kg: 'globex' })

// ── a sampled book: a clock that crosses days, so periods close and draws are made ─────────────────────────────────────
let clock = 0
const at = (iso: string): void => { clock = Date.parse(iso) }
const tick = (): Date => new Date((clock += 60_000))
const nextDay = (): void => { const d = new Date(clock + 86_400_000); clock = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9) }

const PASSES: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...clean, invoice_number: `S2-P${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))
const FAILS: Verdict[] = Array.from({ length: 20 }, (_, i) => verify({ ...broken, invoice_number: `S2-F${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))

/** TINY's bars with a daily review draw that alone counts (random selection): evidence is audited on the book. */
const SAMPLED: PromotionPolicy = {
  ...TINY, policy_id: 'sampled-test',
  tiers: [{ ...TINY.tiers[0]!, sampling: { period: 'day', review_rate: 0.5 }, evidence: { random_selection: true } }],
}

/** acme: 20 PASS + 10 FAIL on day 1, one PASS on day 2 (closing day 1), and day 1's draw committed. globex records alongside. */
function sampledBook(): Ledger {
  at('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, trusted_keys: TRUSTED })
  for (const v of [...PASSES.slice(0, 20), ...FAILS.slice(0, 10)]) led.record(v, { tenant_id: 'acme' })
  for (const v of PASSES.slice(30, 35)) led.record(v, { tenant_id: 'globex' })
  nextDay()
  led.record(PASSES[20]!, { tenant_id: 'acme' })
  commitDueSamples(led, WF(), SAMPLED, { consequence_tier: 'low' })
  return led
}
const declaredLow = (_t: string, wf: string) => (wf.startsWith('acme/') ? { consequence_tier: 'low', granted: 'record' as const } : undefined)

it('the test policy lints clean', () => {
  expect(lintPolicy(SAMPLED)).toMatchObject({ ok: true, errors: [] })
})

describe('voice carries basis and the book\'s evidence audit', () => {
  it('GET /v1/voice: `evidence` is assessment.book.evidence, equal to assessVoiceFromLedger\'s; `basis` null without a demotion', () => {
    const led = sampledBook()
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED, settings: declaredLow } })
    const r = get(svc, `/v1/voice/${encodeURIComponent(WF())}`)
    expect(r.status).toBe(200)
    const s = r.json as Record<string, unknown> & { assessment: { book: { evidence: unknown } } }
    const direct = assessVoiceFromLedger(led, WF(), SAMPLED, { consequence_tier: 'low' })
    expect(direct.book!.evidence).toBeDefined()
    expect(s.evidence).toEqual(direct.book!.evidence)
    expect(s.evidence).toEqual(s.assessment.book.evidence)
    expect(s.evidence).toMatchObject({ tier: 'low', requirements: { random_selection: true }, selection: { period: 'day' } })
    expect(s.basis).toBeNull()
    expect(s.open_proposal).toBeNull()
  })

  it('a declared rung (no book to audit) has evidence null; the same shape on every path', () => {
    const { ledger } = buildLedger({ passes: 4, fails: 4 })
    const s = voiceSurface(openSnapshot(snapshotOfLedger(ledger)), WF(), { consequence_tier: 'low', granted: 'record' }, TINY)
    expect([s.evidence, s.basis]).toEqual([null, null])
    const undeclared = voiceSurface(openSnapshot(snapshotOfLedger(ledger)), WF(), undefined, TINY)
    expect([undeclared.evidence, undeclared.basis, undeclared.assessment]).toEqual([null, null, null])
  })

  it('an unevidenced grant: basis `unevidenced` (open_proposal.basis), a standing notice; MCP from_book equals GET /v1/voice', () => {
    const ledger = createLedger({ now: freshClock(), trusted_keys: TRUSTED })
    buildLedger({ ledger, passes: 2, fails: 2 })
    ledger.decide(grant(WF(), 'advise'))
    const svc = createService({ ledger, authenticate: auth, voice: { policy: TINY } })
    const s = get(svc, `/v1/voice/${encodeURIComponent(WF())}`).json as Record<string, unknown> & { open_proposal: { kind: string; basis: string } }
    expect(s.open_proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'unevidenced' })
    expect(s.basis).toBe('unevidenced')
    expect(s.note).toMatch(/A standing notice, not an alarm/)
    const m = tool('voice_assess', { ledger: ledger.chainJSONL(), policy: TINY, workflow_id: WF(), from_book: true, trusted_keys: TRUSTED })
    expect(m.isError).toBe(false)
    const { tenant_id: _t, ...http } = s
    expect(m.structuredContent).toEqual(http)
  })

  it('a miss under the grant: basis `failure`, the urgent one', () => {
    const ledger = createLedger({ now: freshClock(), trusted_keys: TRUSTED })
    buildLedger({ ledger, passes: 12, fails: 8, passOverturned: 4 })
    ledger.decide(grant(WF(), 'autonomy'))
    const s = voiceSurface(openSnapshot(snapshotOfLedger(ledger)), WF(), { book: ledger }, TINY)
    expect(s.open_proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure', urgent: true })
    expect(s.basis).toBe('failure')
  })
})

describe('D-ANCHOR on the surfaces: a chain export carries no anchors; an unanchored decision is said, never silently record', () => {
  /** A book whose evidence clears autonomy under TINY, with the owner's GRANT of gate (the ledger anchors the owner). */
  const granted = (): Ledger => {
    const ledger = createLedger({ now: freshClock(), trusted_keys: TRUSTED })
    buildLedger({ ledger, passes: 12, fails: 8 })
    ledger.decide(grant(WF(), 'gate'))
    return ledger
  }

  it('voice_assess from_book: without keys the GRANT has no effect and says so; trusted_keys put it in force', () => {
    const chain = granted().chainJSONL()
    const bare = tool('voice_assess', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, consequence_tier: 'low' })
    expect(bare.isError).toBe(false)
    const s = bare.structuredContent as { level: string; no_effect: { kind: string; signer_id: string; notice: string }[]; note: string }
    expect(s.level).toBe('record')
    expect(s.no_effect).toHaveLength(1)
    expect(s.no_effect[0]).toMatchObject({ kind: 'GRANT', signer_id: 'owner', workflow_id: WF() })
    expect(s.no_effect[0]!.notice).toMatch(/is not anchored: it has no effect \(acme\/invoice@0\.0\.1 is not moved to gate\); anchor the signer with --trusted-keys \/ --root-keys/)
    expect(s.note).toContain(s.no_effect[0]!.notice)
    // with nothing to weigh (no tier), the notice is still said
    expect((tool('voice_assess', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true }).structuredContent as { note: string }).note).toMatch(/Nothing is granted on the book.*is not anchored: it has no effect/)
    const anchored = tool('voice_assess', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, trusted_keys: TRUSTED }).structuredContent as { level: string; no_effect: unknown[]; note?: string }
    expect([anchored.level, anchored.no_effect]).toEqual(['gate', []])
    expect(anchored.note ?? '').not.toMatch(/not anchored/)
  })

  it('GET /v1/voice on a ledger that anchors no one: a self-signed GRANT is named with its notice, and the rung stays record', () => {
    const ledger = createLedger({ now: freshClock() })
    buildLedger({ ledger, passes: 12, fails: 8 })
    ledger.decide(grant(WF(), 'autonomy', { key: AGENT.privateKeyPem, signer: 'agent-7' }))
    const svc = createService({ ledger, authenticate: auth, voice: { policy: TINY, settings: declaredLow } })
    const s = get(svc, `/v1/voice/${encodeURIComponent(WF())}`).json as { level: string; no_effect: { notice: string }[]; note: string }
    expect(s.level).toBe('record')
    expect(s.no_effect.map(n => n.notice)).toEqual([expect.stringMatching(/^GRANT `[0-9a-f]{12}` by agent-7 .* is not anchored: it has no effect \(acme\/invoice@0\.0\.1 is not moved to autonomy\)/)])
    expect(s.note).toContain(s.no_effect[0]!.notice)
  })

  it('anchors are refused where nothing reads them: the declared path, and a request to the managed tier\'s own book', () => {
    const chain = granted().chainJSONL()
    const flag = tool('voice_assess', { ledger: chain, policy: TINY, workflow_id: WF(), consequence_tier: 'low', granted: 'record', trusted_keys: TRUSTED })
    expect(flag.isError).toBe(true)
    expect(flag.content[0]!.text).toMatch(/only "from_book": true reads/)
    for (const bad of [{ root_keys: 5 }, { root_keys: [] }, { trusted_keys: 'x' }]) {
      const r = tool('voice_assess', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, ...bad })
      expect(r.isError, JSON.stringify(bad)).toBe(true)
    }
    const svc = createService({ ledger: granted(), authenticate: auth, voice: { policy: TINY } })
    const r = svc.handle({ method: 'POST', path: '/v1/opinion', body: { workflow_id: WF(), trusted_keys: TRUSTED }, headers: { 'x-api-key': 'ka' } })
    expect(r.status).toBe(400)
    expect((r.json as { error: string }).error).toMatch(/carries its own anchors, and a request never adds to them/)
    // the managed tier's own book is anchored already: the grant is in force without any request keys
    const ok = svc.handle({ method: 'POST', path: '/v1/opinion', body: { workflow_id: WF() }, headers: { 'x-api-key': 'ka' } })
    expect(ok.status).toBe(200)
    expect((ok.json as { opinion: { subject: { granted: string } } }).opinion.subject.granted).toBe('gate')
  })

  it('opinion_render / POST /v1/opinion over a chain export: the anchors pass through; without them the refusal names the unanchored GRANT', () => {
    const chain = granted().chainJSONL()
    const bare = tool('opinion_render', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true })
    expect(bare.isError).toBe(true)
    expect(bare.content[0]!.text).toMatch(/is not anchored: it has no effect/)
    const withTier = tool('opinion_render', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, consequence_tier: 'low', format: 'json' })
    expect(withTier.isError).toBe(false)
    expect(withTier.structuredContent).toMatchObject({ subject: { granted: 'record', rung_source: 'BOOK' } })
    expect(JSON.stringify(withTier.structuredContent)).toMatch(/is not anchored: it has no effect/)
    const anchored = tool('opinion_render', { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, trusted_keys: TRUSTED })
    expect(anchored.isError).toBe(false)
    expect(anchored.structuredContent).toMatchObject({ verified: true, subject: { granted: 'gate', rung_source: 'BOOK' } })
    const http = route({ method: 'POST', path: '/v1/opinion', body: { ledger: chain, policy: TINY, workflow_id: WF(), from_book: true, trusted_keys: TRUSTED } })
    expect(http.status).toBe(200)
    expect((http.json as { opinion: unknown }).opinion).toEqual(anchored.structuredContent)
  })
})

describe('GET /v1/queue/{workflow}: the reviewer\'s queue on the tenant\'s book', () => {
  it('is reviewQueue verbatim, under the declared tier, with the policy it was drawn under', () => {
    const led = sampledBook()
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED, settings: declaredLow } })
    const r = get(svc, `/v1/queue/${encodeURIComponent(WF())}`)
    expect(r.status).toBe(200)
    const want = reviewQueue(led, WF(), SAMPLED, { consequence_tier: 'low' })
    expect(want.length).toBe(15) // ⌈0.5 × 20⌉ PASS + ⌈0.5 × 10⌉ FAIL drawn from day 1, none reviewed yet
    expect(r.json).toEqual({
      tenant_id: 'acme', surface_version: 'review-queue-v0', workflow_id: WF(), policy: policyRef(SAMPLED), consequence_tier: 'low',
      items: want, count: 15,
    })
    // a raw workflow id works as well as an encoded one, as on /v1/voice
    expect(get(svc, `/v1/queue/${WF()}`).json).toEqual(r.json)
  })

  it('shrinks as a person reviews the drawn items, and follows a GRANT\'s tier when one is in force', () => {
    const led = sampledBook()
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED, settings: declaredLow } })
    const first = (get(svc, `/v1/queue/${encodeURIComponent(WF())}`).json as { items: { verdict_id: string }[] }).items
    for (const q of first.slice(0, 5)) led.review(q.verdict_id, { reviewer_id: 'ap-lead', decision: 'UPHELD' })
    const after = get(svc, `/v1/queue/${encodeURIComponent(WF())}`).json as { count: number; items: { verdict_id: string }[] }
    expect(after.count).toBe(first.length - 5)
    expect(after.items).toEqual(first.slice(5))
    led.decide(grant(WF(), 'advise', { policy: SAMPLED }))
    const granted = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED } }) // no declaration: the grant's tier
    expect(get(granted, `/v1/queue/${encodeURIComponent(WF())}`).json).toMatchObject({ consequence_tier: 'low', count: after.count })
  })

  it('tenant-walled: another tenant\'s workflow is 404 with nothing but the error; globex sees only its own', () => {
    const led = sampledBook()
    const svc = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED, settings: declaredLow } })
    const r = get(svc, `/v1/queue/${encodeURIComponent(WF())}`, 'kg')
    expect(r.status).toBe(404)
    expect(Object.keys(r.json as object)).toEqual(['error'])
    const own = get(svc, `/v1/queue/${encodeURIComponent(WF('globex'))}`, 'kg')
    expect(own.status).toBe(200)
    expect(own.json).toMatchObject({ tenant_id: 'globex', count: 0, items: [], note: expect.stringMatching(/no consequence tier is declared/) })
    expect(get(svc, `/v1/queue/${encodeURIComponent(WF())}`, 'nope').status).toBe(401)
  })

  it('honest when nothing is drawn: no policy, no tier, a tier without a sampling plan', () => {
    const led = sampledBook()
    const noPolicy = createService({ ledger: led, authenticate: auth })
    expect(get(noPolicy, `/v1/queue/${encodeURIComponent(WF())}`).json).toMatchObject({ policy: null, count: 0, note: expect.stringMatching(/No promotion policy is declared/) })
    const noTier = createService({ ledger: led, authenticate: auth, voice: { policy: SAMPLED } })
    expect(get(noTier, `/v1/queue/${encodeURIComponent(WF())}`).json).toMatchObject({ count: 0, note: expect.stringMatching(/no consequence tier is declared/) })
    const unsampled = createService({ ledger: led, authenticate: auth, voice: { policy: TINY, settings: declaredLow } })
    expect(get(unsampled, `/v1/queue/${encodeURIComponent(WF())}`).json).toMatchObject({ consequence_tier: 'low', count: 0, note: expect.stringMatching(/declares no sampling plan/) })
  })

  it('409 on a book that does not verify, or a tier the policy does not declare; 400 on a bad id; the pure router points at the managed tier', () => {
    const led = sampledBook()
    led.decide(grant(WF(), 'advise', { policy: SAMPLED }))
    const reanchored = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), trusted_keys: { someone: AGENT.publicKeyPem } })
    const broken = createService({ ledger: reanchored, authenticate: auth, voice: { policy: SAMPLED } })
    const r = get(broken, `/v1/queue/${encodeURIComponent(WF())}`)
    expect(r.status).toBe(409)
    expect((r.json as { error: string }).error).toMatch(/does not verify.*grants nothing/)
    const badTier = createService({ ledger: sampledBook(), authenticate: auth, voice: { policy: SAMPLED, settings: () => ({ consequence_tier: 'nope', granted: 'record' }) } })
    expect(get(badTier, `/v1/queue/${encodeURIComponent(WF())}`)).toMatchObject({ status: 409, json: { error: expect.stringMatching(/tier 'nope' is not declared/) } })
    expect(get(broken, '/v1/queue/%E0%A4%A').status).toBe(400)
    expect(get(broken, '/v1/queue/').status).toBe(404) // no id: not a route
    const pure = route({ method: 'GET', path: `/v1/queue/${encodeURIComponent(WF())}` })
    expect(pure.status).toBe(404)
    expect((pure.json as { error: string }).error).toMatch(/served by the managed tier/)
  })

  it('reviewQueueSurface throws on a broken book (never an empty queue) and is in the spec', () => {
    const led = sampledBook()
    led.decide(grant(WF(), 'advise', { policy: SAMPLED }))
    const reanchored = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), trusted_keys: { someone: AGENT.publicKeyPem } })
    expect(() => reviewQueueSurface(reanchored, WF(), SAMPLED)).toThrow(/does not verify/)
    expect(OPENAPI.paths).toHaveProperty(['/v1/queue/{workflow}', 'get'])
    expect(Object.keys(OPENAPI.paths['/v1/queue/{workflow}'].get.responses)).toEqual(['200', '400', '401', '404', '409'])
  })
})

// ── twin v0.2 over MCP / HTTP: CREDENCE-2 §7's flat fields ──────────────────────────────────────────────────────────────
const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"'
const CTX = '<xbrli:context id="i24"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period></xbrli:context>'
const UNIT = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'
const HTML = `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
  + `<div style="display:none"><ix:header><ix:resources>${CTX}${UNIT}</ix:resources></ix:header></div>`
  + '<table><tr><td>Total assets</td><td><ix:nonFraction name="us-gaap:Assets" contextRef="i24" unitRef="usd" decimals="-3" scale="3" format="ixt:num-dot-decimal">1,234,567</ix:nonFraction></td></tr></table></body></html>'
const CLAIMS = [{ id: 'a', field: 'assets', value: 1_234_567_000 }]
const loc = (c: string): string => `<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2024/elts/us-gaap-2024.xsd#us-gaap_${c}" xlink:label="loc_${c}"/>`
const PRE = '<?xml version="1.0" encoding="utf-8"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">'
  + `<link:presentationLink xlink:type="extended" xlink:role="http://abc.example.com/role/BalanceSheets">${loc('Assets')}</link:presentationLink></link:linkbase>`
const FS = '<?xml version="1.0" encoding="utf-8"?><FilingSummary><MyReports><Report instance="abc-20241231.htm"><HtmlFileName>R2.htm</HtmlFileName>'
  + '<LongName>0000002 - Statement - Consolidated Balance Sheets</LongName><ReportType>Sheet</ReportType><Role>http://abc.example.com/role/BalanceSheets</Role>'
  + '<ShortName>Consolidated Balance Sheets</ShortName><MenuCategory>Statements</MenuCategory><Position>2</Position></Report></MyReports></FilingSummary>'
const BASE = { html: HTML, period_end: '2024-12-31', claims: CLAIMS }
const NOW = { now: () => new Date('2026-09-28T12:00:00Z') }

describe('twin v0.2 flat fields (ruleset, pre, filing_summary, schema): the CLI flags as JSON', () => {
  it('ruleset 0.2 + pre + filing_summary binds statement-anchored, exactly as the judge does directly and as the nested form', () => {
    const flat = twinFromJson({ ...BASE, ruleset: '0.2', pre: PRE, filing_summary: FS }, NOW)
    const nested = twinFromJson({ ...BASE, map_version: '0.2.0', presentation: { pre: PRE, filing_summary: FS } }, NOW)
    const direct = verifyAgainstTwin(HTML, CLAIMS, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V02, presentation: parseTwinPresentation({ pre: PRE, filingSummary: FS }), ...NOW })
    expect(flat).toEqual(direct)
    expect(nested).toEqual(direct)
    expect(flat.judgments[0]).toMatchObject({ outcome: 'PASS', reason: 'MATCH' })
    expect(flat.verdict.ruleset.version).toBe('0.2.0')
    // the same through MCP and HTTP (all but the verdict's clock)
    const clockless = (x: unknown): unknown => { const r = structuredClone(x) as { verdict: { issued_at?: string } }; delete r.verdict.issued_at; return r }
    const m = tool('verify_twin', { ...BASE, ruleset: '0.2', pre: PRE, filing_summary: FS })
    expect(m.isError).toBe(false)
    expect(clockless(m.structuredContent)).toEqual(clockless(direct))
    const h = route({ method: 'POST', path: '/v1/twin', body: { ...BASE, ruleset: '0.2.0', pre: PRE, filing_summary: FS } })
    expect(h.status).toBe(200)
    expect(clockless(h.json)).toEqual(clockless(direct))
  })

  it('ruleset 0.2 with no linkbase abstains NO_PRESENTATION_LINKBASE (CREDENCE-2 §7), never guesses', () => {
    const r = twinFromJson({ ...BASE, ruleset: '0.2' }, NOW)
    expect(r.judgments.map(j => [j.outcome, j.reason])).toEqual([['INSUFFICIENT_DATA', 'NO_PRESENTATION_LINKBASE']])
    expect(r.verdict.outcome).toBe('INSUFFICIENT_DATA')
    // a filing summary alone is not a linkbase
    expect(twinFromJson({ ...BASE, ruleset: '0.2', filing_summary: FS }, NOW).judgments[0]).toMatchObject({ outcome: 'INSUFFICIENT_DATA', reason: 'NO_PRESENTATION_LINKBASE' })
  })

  it('ruleset 0.1 is the default map, byte for byte', () => {
    const def = twinFromJson(BASE, NOW)
    expect(twinFromJson({ ...BASE, ruleset: '0.1' }, NOW)).toEqual(def)
    expect(twinFromJson({ ...BASE, ruleset: '0.1.0', map_version: '0.1.0' }, NOW)).toEqual(def)
    expect(def).toEqual(verifyAgainstTwin(HTML, CLAIMS, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP, ...NOW }))
    expect(TWIN_RULESETS).toEqual({ '0.1': '0.1.0', '0.1.0': '0.1.0', '0.2': '0.2.0', '0.2.0': '0.2.0', '0.2.1': '0.2.1' })
  })

  it('refuses two ways of saying one thing that disagree, both forms at once, texts the map would not read, and bad types', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...BASE, ruleset: '0.2', map_version: '0.1.0' }, /"ruleset" 0\.2 is map 0\.2\.0, but "map_version" says 0\.1\.0/],
      [{ ...BASE, ruleset: '0.3' }, /"ruleset" must be one of 0\.1, 0\.1\.0, 0\.2, 0\.2\.0/],
      [{ ...BASE, ruleset: 2 }, /"ruleset" must be a string/],
      [{ ...BASE, ruleset: '0.2', pre: PRE, presentation: { pre: PRE } }, /arrive one way.*"pre"/],
      [{ ...BASE, ruleset: '0.1', pre: PRE }, /"pre" is read only by statement-anchored maps/],
      [{ ...BASE, pre: PRE, schema: '<xsd/>' }, /"pre", "schema" are read only by statement-anchored maps/],
      [{ ...BASE, ruleset: '0.2', pre: 5 }, /"pre" must be a string/],
    ]
    for (const [args, re] of cases) {
      expect(() => twinFromJson(args), JSON.stringify(Object.keys(args))).toThrow(re)
      const h = route({ method: 'POST', path: '/v1/twin', body: args })
      expect(h.status).toBe(400)
      expect(tool('verify_twin', args).isError).toBe(true)
    }
    // null flat texts are "not supplied", as in the nested form
    expect(twinFromJson({ ...BASE, ruleset: '0.1', pre: null }, NOW)).toEqual(twinFromJson(BASE, NOW))
  })

  it('the MCP tool and the OpenAPI spec describe the new fields', () => {
    const t = (handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JsonRpcRequest)!.result as { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] }).tools
    const twin = t.find(x => x.name === 'verify_twin')!
    expect(Object.keys(twin.inputSchema.properties)).toEqual(expect.arrayContaining(['ruleset', 'pre', 'filing_summary', 'schema', 'map_version', 'presentation']))
    const spec = OPENAPI.paths['/v1/twin'].post.requestBody.content['application/json'].schema.properties as Record<string, unknown>
    expect(Object.keys(spec)).toEqual(expect.arrayContaining(['ruleset', 'pre', 'filing_summary', 'schema']))
  })
})

describe('the voice tool advertises basis and evidence', () => {
  it('voice_assess says what it returns', () => {
    const t = (handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JsonRpcRequest)!.result as { tools: { name: string; description: string }[] }).tools
    expect(t.find(x => x.name === 'voice_assess')!.description).toMatch(/Returns basis .* evidence/)
    expect(OWNER.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/) // the fixture keys are the anchored ones (D-ANCHOR)
  })
})
