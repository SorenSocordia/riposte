/**
 * Surfaces for earned voice, opinions and the structured twin (wave 2, SURFACES lane):
 *  - MCP tools voice_assess / opinion_render / verify_twin, equal to the core calls they wrap (deterministic, no clock);
 *  - HTTP POST /v1/opinion, POST /v1/twin, GET /v1/voice/{workflow} (managed tier), tenant-scoped;
 *  - THE DOOR: only a well-formed VERDICT enters the book over HTTP; COUNSEL never, however it is dressed;
 *  - the OpenAPI spec does not lie: every path it names is served, and every path served is named.
 * Over a real book of record (real verify() verdicts through the real ledger) and synthetic inline-XBRL.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleRequest, TOOLS, type JsonRpcRequest } from '../src/mcp/server'
import { route, type HttpRequest, type HttpResponse } from '../src/http/router'
import { createService, verdictDoorProblem, isRecordableVerdict, apiKeyAuth, type UnrecordedEvent, type VoiceConfig } from '../src/http/service'
import { OPENAPI } from '../src/http/openapi'
import {
  EXAMPLE_PROMOTION_POLICY, ACTION_HANDLING, VOICE_LADDER, assessVoice, workflowCalibration, promotionOpinion, disputeOpinion,
  snapshotOfLedger, opinionIntact, serializeVerdict, ChannelViolation, makeCounsel, verify, verifyAgainstTwin, createLedger,
  defaultWorkflowOf, parseTwinPresentation, FS_CORE_TWIN_MAP_V02, type Verdict, type Opinion, type VoiceLevel, type Ledger,
} from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'
import { clean, broken, noSubtotal, FIXED_NOW } from './fixtures/invoices'

const P = EXAMPLE_PROMOTION_POLICY
const BOUNDS = 'PO-matched invoices under $1,000'

interface ToolResult { isError: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] }
const tool = (name: string, args: unknown): ToolResult =>
  handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as JsonRpcRequest)!.result as ToolResult
const post = (path: string, body: unknown): HttpResponse => route({ method: 'POST', path, body })

/** 130 clean PASSes (all upheld) and 60 FAILs (2 overturned): earns autonomy at the 'low' tier. */
const strongBook = (): ReturnType<typeof buildLedger> => buildLedger({ passes: 130, fails: 60, failOverturned: 2 })

// Synthetic inline XBRL: one Assets fact, 1,234,567 × 10^3.
const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"'
const CTX = '<xbrli:context id="i24"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period></xbrli:context>'
const UNIT = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'
const HTML = `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
  + `<div style="display:none"><ix:header><ix:resources>${CTX}${UNIT}</ix:resources></ix:header></div>`
  + '<table><tr><td>Total assets</td><td><ix:nonFraction name="us-gaap:Assets" contextRef="i24" unitRef="usd" decimals="-3" scale="3" format="ixt:num-dot-decimal">1,234,567</ix:nonFraction></td></tr></table></body></html>'
const PASS_CLAIMS = [{ id: 'a', field: 'assets', value: 1_234_567_000 }]
const FAIL_CLAIMS = [{ id: 'a', field: 'assets', value: 1_234_000_000 }]
const ABSTAIN_CLAIMS = [{ id: 'w', field: 'widgets', value: 1 }]
const withoutClock = (v: Verdict): Omit<Verdict, 'issued_at'> => { const { issued_at: _t, ...rest } = v; return rest }

// ── MCP ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('MCP: the three new tools are advertised with honest schemas', () => {
  it('voice_assess, opinion_render and verify_twin are listed; every required key is a declared property', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JsonRpcRequest)!.result as { tools: typeof TOOLS }
    const byName = new Map(res.tools.map(t => [t.name as string, t]))
    for (const [name, required] of [['voice_assess', ['ledger', 'policy', 'workflow_id']], ['opinion_render', ['ledger']], ['verify_twin', ['html', 'period_end', 'claims']]] as const) {
      const t = byName.get(name) as { inputSchema: { type: string; properties: Record<string, unknown>; required: readonly string[] }; description: string } | undefined
      expect(t, name).toBeDefined()
      expect(t!.inputSchema.type).toBe('object')
      expect([...t!.inputSchema.required]).toEqual([...required])
      for (const k of t!.inputSchema.required) expect(Object.keys(t!.inputSchema.properties)).toContain(k)
    }
    expect(byName.get('opinion_render')!.description).toMatch(/COUNSEL/)
    expect(byName.get('voice_assess')!.description).toMatch(/ALWAYS the rung a person granted/)
  })
})

describe('MCP voice_assess: the rung a person granted, and any open proposal', () => {
  it('a strong record at gate: the rung stays gate; a PROMOTION to autonomy is proposed; the assessment is assessVoice verbatim', () => {
    const { ledger } = strongBook()
    const r = tool('voice_assess', { ledger: ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate', bounds: BOUNDS })
    expect(r.isError).toBe(false)
    const s = r.structuredContent as Record<string, unknown> & { assessment: { assessment_hash: string }; open_proposal: Record<string, unknown> }
    expect(s).toMatchObject({ level: 'gate', granted: 'gate', earned: 'autonomy', declared: true, verified: true, handling: ACTION_HANDLING.gate })
    expect(s.open_proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy', urgent: false, requires_human_signature: true })
    const direct = assessVoice(workflowCalibration(ledger.all(), WF()), { workflow_id: WF(), consequence_tier: 'low', granted: 'gate', bounds: BOUNDS }, P)
    expect(s.assessment.assessment_hash).toBe(direct.assessment_hash)
    expect((s.open_proposal as { proposal_id: string }).proposal_id).toBe(direct.proposal!.proposal_id)
    expect((s.book as { content_verified: boolean; head: string }).head).toBe(ledger.chainHead())
  })

  it('the effective rung is ALWAYS the granted one, at every rung', () => {
    const { ledger } = strongBook()
    const chain = ledger.chainJSONL()
    for (const granted of VOICE_LADDER) {
      const s = tool('voice_assess', { ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low', granted }).structuredContent as { level: VoiceLevel; granted: VoiceLevel }
      expect(s.level).toBe(granted)
      expect(s.granted).toBe(granted)
    }
  })

  it('a weak record at gate: an URGENT demotion proposal, one rung down, with its failing cases and their dispute paths', () => {
    const { ledger, failIds } = buildLedger({ passes: 10, fails: 5, failOverturned: 1 })
    const s = tool('voice_assess', { ledger: ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate' }).structuredContent as { level: string; open_proposal: { kind: string; urgent: boolean; to: string; failing_cases: { verdict_id: string; dispute: string }[] } }
    expect(s.level).toBe('gate')
    expect(s.open_proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'gate', to: 'advise' })
    expect(s.open_proposal.failing_cases.map(f => f.verdict_id)).toEqual([failIds[0]])
    expect(s.open_proposal.failing_cases[0]!.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${failIds[0]}`)
  })

  it('a chain whose content was altered: nothing is proposed (withheld), and the book says why', () => {
    const { ledger } = strongBook()
    const lines = ledger.chainJSONL().split('\n')
    lines[3] = lines[3]!.replace('"PASS"', '"FAIL"')
    const s = tool('voice_assess', { ledger: lines.join('\n'), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate' }).structuredContent as { verified: boolean; open_proposal: unknown; note: string; book: { content_verified: boolean; broken_at: number } }
    expect(s.verified).toBe(false)
    expect(s.book.content_verified).toBe(false)
    expect(s.book.broken_at).toBe(3)
    expect(s.open_proposal).toBeNull()
    expect(s.note).toMatch(/Withheld/)
  })

  it('refuses what a person must supply: no policy (there is no default), a policy that does not lint, no workflow, an undeclared tier', () => {
    const chain = strongBook().ledger.chainJSONL()
    const base = { ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low' }
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...base, policy: undefined }, /policy.*no default/],
      [{ ...base, policy: { ...P, tiers: [] } }, /does not lint/],
      [{ ...base, workflow_id: undefined }, /workflow_id/],
      [{ ...base, consequence_tier: 'galactic' }, /not declared in policy/],
      [{ ...base, granted: 'sovereign' }, /granted/],
      [{ ...base, ledger: 42 }, /chain export/],
    ]
    for (const [args, msg] of cases) {
      const r = tool('voice_assess', args)
      expect(r.isError, JSON.stringify(msg)).toBe(true)
      expect(r.content[0]!.text).toMatch(msg)
    }
  })

  it('is deterministic: the same book and settings give byte-identical output', () => {
    const chain = strongBook().ledger.chainJSONL()
    const args = { ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'advise' }
    expect(JSON.stringify(tool('voice_assess', args).structuredContent)).toBe(JSON.stringify(tool('voice_assess', args).structuredContent))
  })
})

describe('MCP opinion_render: the courtroom opinion, COUNSEL never VERDICT', () => {
  it('argues a proposal from voice_assess: the structured content IS promotionOpinion, the text is its Markdown', () => {
    const { ledger } = strongBook()
    const chain = ledger.chainJSONL()
    const proposal = (tool('voice_assess', { ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate', bounds: BOUNDS }).structuredContent as { open_proposal: unknown }).open_proposal
    const r = tool('opinion_render', { ledger: chain, policy: P, proposal })
    expect(r.isError).toBe(false)
    const op = r.structuredContent as unknown as Opinion
    const direct = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, proposal: proposal as never })
    expect(op.opinion_id).toBe(direct.opinion_id)
    expect(JSON.stringify(op)).toBe(JSON.stringify(direct))
    expect(opinionIntact(op)).toBe(true)
    expect(op).toMatchObject({ channel: 'COUNSEL', verified: true, dismissible: true })
    expect(op.ruling).toMatchObject({ disposition: 'PROPOSE_PROMOTION', status: 'PROPOSED' })
    expect(r.content[0]!.text).toMatch(/^# Opinion: Promote/)
    expect(r.content[0]!.text).toContain('## The ruling and its scope')
    expect(() => serializeVerdict(op)).toThrow(ChannelViolation)
  })

  it('format json returns the opinion JSON as text; the workflow form argues whatever the evidence poses', () => {
    const { ledger } = strongBook()
    const r = tool('opinion_render', { ledger: ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'autonomy', format: 'json' })
    const op = JSON.parse(r.content[0]!.text) as Opinion
    expect(op.opinion_id).toBe((r.structuredContent as unknown as Opinion).opinion_id)
    expect(op.ruling.disposition).toBe('RETAIN')
  })

  it('a dispute of one recorded FAIL: the structured content IS disputeOpinion (UPHOLD)', () => {
    const { ledger, failIds } = strongBook()
    const r = tool('opinion_render', { ledger: ledger.chainJSONL(), dispute: { verdict_id: failIds[10] } })
    const op = r.structuredContent as unknown as Opinion
    expect(JSON.stringify(op)).toBe(JSON.stringify(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[10]! })))
    expect(op.subject.kind).toBe('DISPUTE')
    expect(op.ruling.disposition).toBe('UPHOLD')
  })

  it('a doctored proposal is WITHHELD: an opinion whose premises do not verify proposes nothing', () => {
    const { ledger } = strongBook()
    const chain = ledger.chainJSONL()
    const proposal = (tool('voice_assess', { ledger: chain, policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate' }).structuredContent as { open_proposal: Record<string, unknown> }).open_proposal
    const r = tool('opinion_render', { ledger: chain, policy: P, proposal: { ...proposal, earned: 'autonomy', calibration_hash: 'f'.repeat(64) } })
    expect(r.isError).toBe(false)
    const op = r.structuredContent as unknown as Opinion
    expect(op.verified).toBe(false)
    expect(op.ruling.disposition).toBe('WITHHELD')
  })

  it('one question per opinion, and the inputs a question needs', () => {
    const { ledger, failIds } = strongBook()
    const chain = ledger.chainJSONL()
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ policy: P, workflow_id: WF(), consequence_tier: 'low' }, /"ledger" is required/],
      [{ ledger: chain, dispute: { verdict_id: failIds[0] }, workflow_id: WF() }, /one question per opinion/],
      [{ ledger: chain, dispute: { verdict_id: 'nope' } }, /not on the supplied book of record/],
      [{ ledger: chain, dispute: 'nope' }, /dispute.*verdict_id/],
      [{ ledger: chain, workflow_id: WF(), consequence_tier: 'low' }, /"policy" is required/],
      [{ ledger: chain, policy: P, proposal: {}, workflow_id: WF() }, /proposal.*defines the question/],
      [{ ledger: chain, dispute: { verdict_id: failIds[0] }, format: 'pdf' }, /format/],
    ]
    for (const [args, msg] of cases) {
      const r = tool('opinion_render', args)
      expect(r.isError, String(msg)).toBe(true)
      expect(r.content[0]!.text).toMatch(msg)
    }
  })
})

describe('MCP verify_twin: the CLI verb as a tool', () => {
  const OPTS = { periodEnd: '2024-12-31' }
  it('PASS / FAIL / ABSTAIN equal verifyAgainstTwin (same verdict_id, same judgments; only issued_at is a clock)', () => {
    for (const [claims, outcome] of [[PASS_CLAIMS, 'PASS'], [FAIL_CLAIMS, 'FAIL'], [ABSTAIN_CLAIMS, 'INSUFFICIENT_DATA']] as const) {
      const r = tool('verify_twin', { html: HTML, period_end: '2024-12-31', claims })
      expect(r.isError).toBe(false)
      const got = r.structuredContent as unknown as ReturnType<typeof verifyAgainstTwin>
      const direct = verifyAgainstTwin(HTML, claims, OPTS)
      expect(got.verdict.outcome).toBe(outcome)
      expect(withoutClock(got.verdict)).toEqual(withoutClock(direct.verdict))
      expect(got.judgments).toEqual(direct.judgments)
      expect(got.twin).toEqual(direct.twin)
      expect(isRecordableVerdict(got.verdict)).toBe(true)
    }
  })

  it('map 0.2.0 without a presentation linkbase abstains NO_PRESENTATION_LINKBASE rather than guess', () => {
    const got = tool('verify_twin', { html: HTML, period_end: '2024-12-31', claims: PASS_CLAIMS, map_version: '0.2.0' }).structuredContent as unknown as ReturnType<typeof verifyAgainstTwin>
    expect(got.verdict.ruleset.version).toBe('0.2.0')
    expect(got.judgments[0]).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_PRESENTATION_LINKBASE' })
  })

  it('map 0.2.0 with the filing\'s presentation binds statement-anchored, exactly as the judge does directly', () => {
    const loc = (c: string): string => `<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2024/elts/us-gaap-2024.xsd#us-gaap_${c}" xlink:label="loc_${c}"/>`
    const pre = '<?xml version="1.0" encoding="utf-8"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">'
      + `<link:presentationLink xlink:type="extended" xlink:role="http://abc.example.com/role/BalanceSheets">${loc('Assets')}</link:presentationLink></link:linkbase>`
    const fs = '<?xml version="1.0" encoding="utf-8"?><FilingSummary><MyReports><Report instance="abc-20241231.htm"><HtmlFileName>R2.htm</HtmlFileName>'
      + '<LongName>0000002 - Statement - Consolidated Balance Sheets</LongName><ReportType>Sheet</ReportType><Role>http://abc.example.com/role/BalanceSheets</Role>'
      + '<ShortName>Consolidated Balance Sheets</ShortName><MenuCategory>Statements</MenuCategory><Position>2</Position></Report></MyReports></FilingSummary>'
    const got = tool('verify_twin', { html: HTML, period_end: '2024-12-31', claims: PASS_CLAIMS, map_version: '0.2.0', presentation: { pre, filing_summary: fs } }).structuredContent as unknown as ReturnType<typeof verifyAgainstTwin>
    const direct = verifyAgainstTwin(HTML, PASS_CLAIMS, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V02, presentation: parseTwinPresentation({ pre, filingSummary: fs }) })
    expect(got.judgments[0]).toMatchObject({ outcome: 'PASS', reason: 'MATCH' })
    expect(withoutClock(got.verdict)).toEqual(withoutClock(direct.verdict))
    expect(got.twin.presentation).toMatchObject({ source: 'filing-summary', statement_roles: 1 })
  })

  it('refuses malformed input, and a presentation the map would silently ignore', () => {
    const base = { html: HTML, period_end: '2024-12-31', claims: PASS_CLAIMS }
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...base, html: undefined }, /"html" is required/],
      [{ ...base, period_end: '12/31/2024' }, /YYYY-MM-DD/],
      [{ ...base, claims: [{ id: 'a', field: 'assets', value: '1' }] }, /claims\[0\]/],
      [{ ...base, tolerance: -1 }, /tolerance/],
      [{ ...base, map_version: '9.9.9' }, /map_version/],
      [{ ...base, presentation: { pre: '<x/>' } }, /presentation.*0\.2\.0/],
    ]
    for (const [args, msg] of cases) {
      const r = tool('verify_twin', args)
      expect(r.isError, String(msg)).toBe(true)
      expect(r.content[0]!.text).toMatch(msg)
    }
  })
})

// ── HTTP, the pure router ────────────────────────────────────────────────────────────────────────────────────────────

describe('HTTP (pure router): POST /v1/twin, POST /v1/opinion, GET /v1/voice', () => {
  it('POST /v1/twin → 200 {verdict, judgments, twin}; malformed → 400 with the reason', () => {
    const r = post('/v1/twin', { html: HTML, period_end: '2024-12-31', claims: FAIL_CLAIMS })
    expect(r.status).toBe(200)
    const j = r.json as ReturnType<typeof verifyAgainstTwin>
    expect(j.verdict.outcome).toBe('FAIL')
    expect(j.judgments[0]).toMatchObject({ outcome: 'FAIL', reason: 'MISMATCH' })
    const bad = post('/v1/twin', { html: HTML, claims: FAIL_CLAIMS })
    expect(bad.status).toBe(400)
    expect((bad.json as { error: string }).error).toMatch(/period_end/)
  })

  it('POST /v1/opinion over a supplied chain → 200 {opinion, markdown}, equal to the MCP tool', () => {
    const { ledger } = strongBook()
    const body = { ledger: ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'gate', bounds: BOUNDS }
    const r = post('/v1/opinion', body)
    expect(r.status).toBe(200)
    const j = r.json as { opinion: Opinion; markdown: string }
    expect(j.opinion.opinion_id).toBe((tool('opinion_render', body).structuredContent as unknown as Opinion).opinion_id)
    expect(j.markdown).toMatch(/^# Opinion:/)
    expect(post('/v1/opinion', { policy: P }).status).toBe(400)
    expect((post('/v1/opinion', { ledger: ledger.chainJSONL(), dispute: { verdict_id: 'nope' } }).json as { error: string }).error).toMatch(/not on the supplied book/)
  })

  it('GET /v1/voice/{workflow} is the managed tier\'s: the pure core says so', () => {
    const r = route({ method: 'GET', path: '/v1/voice/acme%2Finvoice%400.0.1' })
    expect(r.status).toBe(404)
    expect((r.json as { error: string }).error).toMatch(/managed tier/)
  })
})

// ── THE DOOR ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the HTTP door: only a well-formed VERDICT enters the book; COUNSEL never', () => {
  const v = verify(clean, { now: FIXED_NOW })
  const vb = verify(broken, { now: FIXED_NOW })
  const counsel = makeCounsel({
    kind: 'SUGGESTION', title: 'Consider checking the freight line', body: 'A generated suggestion.',
    provenance: { type: 'GENERATED', generator: 'test', generator_version: '0', source_hash: v.input_hash },
    judges: [{ judge: 'GROUNDING', passed: true, detail: 'test' }],
  })

  it('every verdict the HTTP routes produce passes the door', () => {
    const produced: unknown[] = [
      post('/v1/verify', { extraction: clean }).json,
      post('/v1/verify', { extraction: broken }).json,
      post('/v1/verify', { extraction: noSubtotal }).json,
      post('/v1/verify/declared', { extraction: { subtotal: 1, tax: 1, total: 2 }, ruleset: { id: 't', version: '1', domain: 'test', fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } }, checks: [{ code: 'T', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }] } }).json,
      post('/v1/verify/action', { action: { tool: 'wire', arguments: { to: '9' } }, sources: { allowed: { to: ['1'] } } }).json,
      post('/v1/verify/citations', { citations: [{ id: 'a', case_name: 'X', quote: 'the sky is blue' }], sources: { X: 'the court found the sky is blue that day' } }).json,
      ...(post('/v1/verify/batch', { items: [{ extraction: clean }, { extraction: broken }] }).json as { results: unknown[] }).results,
      ...[PASS_CLAIMS, FAIL_CLAIMS, ABSTAIN_CLAIMS].map(claims => (post('/v1/twin', { html: HTML, period_end: '2024-12-31', claims }).json as { verdict: unknown }).verdict),
    ]
    for (const x of produced) expect(verdictDoorProblem(x), JSON.stringify((x as { ruleset?: unknown }).ruleset)).toBeUndefined()
  })

  it('refuses COUNSEL and generated material however it is dressed', () => {
    const opinion = promotionOpinion({ snapshot: snapshotOfLedger(strongBook().ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } })
    const dressed: [string, unknown, RegExp][] = [
      ['a counsel item', counsel, /COUNSEL/],
      ['counsel wearing verdict fields', { ...counsel, verdict_id: v.verdict_id, claims: v.claims, outcome: v.outcome }, /COUNSEL/],
      ['a verdict tagged COUNSEL', { ...v, channel: 'COUNSEL' }, /COUNSEL/],
      ['a verdict with a GENERATED provenance', { ...v, provenance: { type: 'GENERATED', generator: 'x', generator_version: '0', source_hash: 'y' } }, /GENERATED/],
      ['a verdict marked dismissible', { ...v, dismissible: true }, /COUNSEL/],
      ['an opinion', opinion, /COUNSEL/],
      ['an opinion given a verdict_id', { ...opinion, verdict_id: v.verdict_id, claims: v.claims, outcome: v.outcome }, /COUNSEL/],
    ]
    for (const [what, x, msg] of dressed) expect(verdictDoorProblem(x), what).toMatch(msg)
  })

  it('refuses a malformed or unbound proof object', () => {
    const reasoned = structuredClone(v)
    reasoned.claims[0]!.tier = 'REASONED'
    const abstaining = [noSubtotal, clean, broken].map(x => verify(x, { now: FIXED_NOW })).find(x => x.claims.some(c => c.outcome === 'INSUFFICIENT_DATA'))
    expect(abstaining, 'a fixture verdict with an abstaining claim').toBeDefined()
    const noExplain = structuredClone(abstaining!)
    delete noExplain.claims.find(c => c.outcome === 'INSUFFICIENT_DATA')!.insufficiency
    const unevidenced = structuredClone(vb)
    unevidenced.claims.find(c => c.outcome === 'FAIL')!.evidence = []
    const bad: [string, unknown, RegExp][] = [
      ['null', null, /not a verdict/],
      ['an array', [v], /not a verdict/],
      ['an id that does not derive from its inputs', { ...v, verdict_id: 'f'.repeat(32) }, /not bound to its inputs/],
      ['a judgement-tier finding', reasoned, /judgement-tier/],
      ['a fourth outcome', { ...v, outcome: 'MAYBE' }, /never a fourth/],
      ['an outcome its claims do not give', { ...vb, outcome: 'PASS' }, /does not follow from its claims/],
      ['coverage that does not recount', { ...v, coverage: { ...v.coverage, claims_pass: v.coverage.claims_pass + 1 } }, /coverage/],
      ['an abstention without an explanation', noExplain, /without an explained insufficiency/],
      ['a FAIL without evidence', unevidenced, /without evidence/],
      ['another schema', { ...v, schema_version: 'v9' }, /schema_version/],
      ['another aggregation', { ...v, aggregation: 'MAJORITY' }, /ANY_FAIL_FAILS/],
    ]
    for (const [what, x, msg] of bad) expect(verdictDoorProblem(x), what).toMatch(msg)
    // a verdict already stamped VERDICT is still a verdict
    expect(verdictDoorProblem({ ...v, channel: 'VERDICT' })).toBeUndefined()
  })

  it('end to end: whatever the core returns, only real verdicts are recorded; refusals are reported and never change the response', () => {
    const ledger = createLedger({ now: () => new Date('2026-09-28T00:00:00Z') })
    const refused: UnrecordedEvent[] = []
    const disguised = { ...counsel, verdict_id: v.verdict_id, claims: v.claims, outcome: v.outcome }
    const replies: Record<string, unknown> = {
      '/x/counsel': disguised,
      '/x/batch': { results: [vb, counsel, { ...v, outcome: 'PASS', coverage: { ...v.coverage, claims_total: 99 } }] },
      '/x/twin': { verdict: { ...v, channel: 'COUNSEL' }, judgments: [] },
    }
    const svc = createService({ ledger, router: req => ({ status: 200, json: replies[req.path] }), onUnrecorded: e => refused.push(e) })
    const res = svc.handle({ method: 'POST', path: '/x/counsel', body: {} })
    expect(res.json).toBe(disguised)
    svc.handle({ method: 'POST', path: '/x/batch', body: {} })
    svc.handle({ method: 'POST', path: '/x/twin', body: {} })
    expect(ledger.all().map(r => r.verdict.verdict_id)).toEqual([vb.verdict_id])
    expect(refused.map(e => e.path)).toEqual(['/x/counsel', '/x/batch', '/x/batch', '/x/twin'])
    expect(refused[0]).toMatchObject({ tenant_id: 'default', verdict_id: v.verdict_id })
    expect(refused[0]!.problem).toMatch(/COUNSEL/)
    // an observer that throws never breaks the service
    const loud = createService({ ledger: createLedger(), router: () => ({ status: 200, json: disguised }), onUnrecorded: () => { throw new Error('boom') } })
    expect(loud.handle({ method: 'POST', path: '/x', body: {} }).status).toBe(200)
  })

  it('a ledger that refuses a verdict at its own door is reported, not thrown', () => {
    const inner = createLedger()
    const strict: Ledger = { ...inner, all: () => inner.all(), record: () => { throw new ChannelViolation('refused at ledger.record') } } as Ledger
    const refused: UnrecordedEvent[] = []
    const svc = createService({ ledger: strict, onUnrecorded: e => refused.push(e) })
    expect(svc.handle({ method: 'POST', path: '/v1/verify', body: { extraction: clean } }).status).toBe(200)
    expect(refused[0]!.problem).toMatch(/the ledger refused it: refused at ledger.record/)
  })

  it('twin verdicts are recorded to the caller\'s book like any other verdict', () => {
    const ledger = createLedger()
    const svc = createService({ ledger, authenticate: apiKeyAuth({ k: 'acme' }) })
    const r = svc.handle({ method: 'POST', path: '/v1/twin', body: { html: HTML, period_end: '2024-12-31', claims: FAIL_CLAIMS }, headers: { 'x-api-key': 'k' } })
    const id = (r.json as { verdict: Verdict }).verdict.verdict_id
    expect(ledger.get(id)?.tenant_id).toBe('acme')
    expect(defaultWorkflowOf(ledger.get(id)!)).toBe('acme/twin-xbrl-fs-core@0.1.0')
  })
})

// ── the managed tier: voice and opinions over the tenant's own book ──────────────────────────────────────────────────

describe('managed tier: GET /v1/voice/{workflow} and POST /v1/opinion, scoped to the tenant', () => {
  const ACME = WF('acme'), BETA = WF('beta')
  const SETTINGS: Record<string, { consequence_tier: string; granted: VoiceLevel; bounds?: string }> = {
    [ACME]: { consequence_tier: 'low', granted: 'gate', bounds: BOUNDS },
    [BETA]: { consequence_tier: 'low', granted: 'gate' },
    'acme/misdeclared@1': { consequence_tier: 'galactic', granted: 'advise' },
  }
  const voice: VoiceConfig = { policy: P, settings: (_t, wf) => SETTINGS[wf] }
  function shared() {
    const a = strongBook()
    const b = buildLedger({ ledger: a.ledger, tenant: 'beta', passes: 10, fails: 5, failOverturned: 1 })
    const svc = createService({ ledger: a.ledger, voice, authenticate: apiKeyAuth({ ka: 'acme', kb: 'beta' }) })
    return { ledger: a.ledger, acme: a, beta: b, svc }
  }
  const get = (svc: ReturnType<typeof createService>, path: string, key: string) => svc.handle({ method: 'GET', path, headers: { 'x-api-key': key } })
  const postAs = (svc: ReturnType<typeof createService>, path: string, body: unknown, key: string) => svc.handle({ method: 'POST', path, body, headers: { 'x-api-key': key } })

  it('the rung on record and the open proposal, URL-encoded or not; equal to voice_assess over the same book', () => {
    const { ledger, svc } = shared()
    const r = get(svc, `/v1/voice/${encodeURIComponent(ACME)}`, 'ka')
    expect(r.status).toBe(200)
    const s = r.json as { tenant_id: string; level: string; open_proposal: { kind: string; proposal_id: string } }
    expect(s).toMatchObject({ tenant_id: 'acme', level: 'gate', declared: true, verified: true })
    expect(s.open_proposal.kind).toBe('PROMOTION_PROPOSAL')
    const mcp = tool('voice_assess', { ledger: ledger.chainJSONL(), policy: P, workflow_id: ACME, ...SETTINGS[ACME] }).structuredContent as { open_proposal: { proposal_id: string } }
    expect(s.open_proposal.proposal_id).toBe(mcp.open_proposal.proposal_id)
    expect((get(svc, `/v1/voice/${ACME}`, 'ka').json as typeof s).open_proposal.proposal_id).toBe(s.open_proposal.proposal_id)
    const beta = get(svc, `/v1/voice/${encodeURIComponent(BETA)}`, 'kb').json as { open_proposal: { kind: string; urgent: boolean } }
    expect(beta.open_proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true })
  })

  it('another tenant\'s workflow is not found, and nothing about it is returned', () => {
    const { svc } = shared()
    const r = get(svc, `/v1/voice/${encodeURIComponent(ACME)}`, 'kb')
    expect(r.status).toBe(404)
    expect(Object.keys(r.json as object)).toEqual(['error'])
    expect(get(svc, `/v1/voice/${encodeURIComponent(ACME)}`, 'nokey').status).toBe(401)
  })

  it('an undeclared workflow is at record and nothing is weighed; misdeclared settings are 409; bad encoding 400', () => {
    const { svc } = shared()
    const u = get(svc, `/v1/voice/${encodeURIComponent('acme/other@9')}`, 'ka')
    expect(u.status).toBe(200)
    expect(u.json).toMatchObject({ level: 'record', declared: false, earned: null, open_proposal: null, assessment: null })
    expect((u.json as { note: string }).note).toMatch(/day-1 default/)
    const m = get(svc, `/v1/voice/${encodeURIComponent('acme/misdeclared@1')}`, 'ka')
    expect(m.status).toBe(409)
    expect((m.json as { error: string }).error).toMatch(/galactic/)
    expect(get(svc, '/v1/voice/%E0%A4%A', 'ka').status).toBe(400)
  })

  it('without a declared policy every workflow is at the rung on record, and nothing is proposed', () => {
    const { ledger } = strongBook()
    const svc = createService({ ledger, voice: { settings: () => ({ consequence_tier: 'low', granted: 'advise' }) }, authenticate: apiKeyAuth({ ka: 'acme' }) })
    const r = get(svc, `/v1/voice/${encodeURIComponent(WF())}`, 'ka')
    expect(r.json).toMatchObject({ level: 'advise', earned: null, open_proposal: null })
    expect((r.json as { note: string }).note).toMatch(/No promotion policy/)
  })

  it('POST /v1/opinion without a ledger reads the tenant\'s own book under the settings on record', () => {
    const { ledger, svc } = shared()
    const r = postAs(svc, '/v1/opinion', { workflow_id: ACME }, 'ka')
    expect(r.status).toBe(200)
    const op = (r.json as { opinion: Opinion }).opinion
    expect(op.ruling.disposition).toBe('PROPOSE_PROMOTION')
    expect(op.verified).toBe(true)
    // the same opinion a caller gets by supplying the chain and the same settings (stateless), read under the caller's
    // tenant scope as the managed tier reads it (SW1, 2026-09-28)
    const stateless = post('/v1/opinion', { ledger: ledger.chainJSONL(), policy: P, workflow_id: ACME, ...SETTINGS[ACME], tenant_id: 'acme' })
    expect((stateless.json as { opinion: Opinion }).opinion.opinion_id).toBe(op.opinion_id)
    // restating the settings on record is fine; changing them is not
    expect(postAs(svc, '/v1/opinion', { workflow_id: ACME, granted: 'gate', consequence_tier: 'low' }, 'ka').status).toBe(200)
    const changed = postAs(svc, '/v1/opinion', { workflow_id: ACME, granted: 'autonomy' }, 'ka')
    expect(changed.status).toBe(409)
    expect((changed.json as { error: string }).error).toMatch(/settings on record/)
    // a proposal from GET /v1/voice argues the same question
    const proposal = (get(svc, `/v1/voice/${encodeURIComponent(ACME)}`, 'ka').json as { open_proposal: unknown }).open_proposal
    expect((postAs(svc, '/v1/opinion', { proposal }, 'ka').json as { opinion: Opinion }).opinion.verified).toBe(true)
  })

  it('tenant walls: another tenant\'s workflow or verdict is 404; a dispute on a shared book is served scoped, never leaked', () => {
    const { svc, acme, beta, ledger } = shared()
    expect(postAs(svc, '/v1/opinion', { workflow_id: ACME }, 'kb').status).toBe(404)
    expect(postAs(svc, '/v1/opinion', { dispute: { verdict_id: acme.failIds[0] } }, 'kb').status).toBe(404)
    // SW1 (2026-09-28): the opinion takes the caller's tenant scope, so the shared-book 409 is lifted.
    const d = postAs(svc, '/v1/opinion', { dispute: { verdict_id: beta.failIds[0] } }, 'kb')
    expect(d.status).toBe(200)
    const op = (d.json as { opinion: Opinion }).opinion
    expect(JSON.stringify(op)).toBe(JSON.stringify(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: beta.failIds[0]!, scope: { tenant_id: 'beta' } })))
    for (const id of acme.failIds) expect(JSON.stringify(op)).not.toContain(id)
  })

  it('a dispute on a single-tenant book is served (the verdict is the caller\'s, and so is every precedent)', () => {
    const { ledger, failIds } = strongBook()
    const svc = createService({ ledger, voice, authenticate: apiKeyAuth({ ka: 'acme' }) })
    const r = postAs(svc, '/v1/opinion', { dispute: { verdict_id: failIds[10] } }, 'ka')
    expect(r.status).toBe(200)
    const op = (r.json as { opinion: Opinion }).opinion
    // the managed tier reads under the caller's tenant scope (SW1, 2026-09-28)
    expect(JSON.stringify(op)).toBe(JSON.stringify(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[10]!, scope: { tenant_id: 'acme' } })))
  })

  it('a caller-supplied chain stays stateless in the managed tier; a voice question with no policy anywhere is 400', () => {
    const { ledger } = strongBook()
    const svc = createService({ ledger, authenticate: apiKeyAuth({ ka: 'acme' }) })
    const own = postAs(svc, '/v1/opinion', { ledger: ledger.chainJSONL(), policy: P, workflow_id: WF(), consequence_tier: 'low', granted: 'record' }, 'ka')
    expect(own.status).toBe(200)
    const none = postAs(svc, '/v1/opinion', { workflow_id: WF(), consequence_tier: 'low' }, 'ka')
    expect(none.status).toBe(400)
    expect((none.json as { error: string }).error).toMatch(/policy/)
    expect(ledger.all().length).toBe(190) // an opinion is never recorded
  })

  it('GET /v1/ledger/report carries this month\'s opinions for the caller\'s tenant only', () => {
    const a = strongBook()
    buildLedger({ ledger: a.ledger, tenant: 'beta', passes: 10, fails: 5, failOverturned: 1 })
    const svc = createService({ ledger: a.ledger, voice, authenticate: apiKeyAuth({ ka: 'acme' }), now: () => new Date('2026-09-15T12:00:00Z') })
    const md = (get(svc, '/v1/ledger/report', 'ka').json as { markdown: string }).markdown
    expect(md).toContain('## Opinions: what Riposte is asking for (2026-09)')
    expect(md).toContain(`**Promotion** \`${ACME}\``)
    expect(md).not.toContain('beta/')
  })
})

// ── the spec does not lie ────────────────────────────────────────────────────────────────────────────────────────────

describe('the OpenAPI spec does not lie', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = (f: string): string => readFileSync(join(here, '..', 'src', 'http', f), 'utf8')

  it('every path the router or the service serves is in the spec, and nothing else is', () => {
    const served = new Set<string>()
    for (const f of ['router.ts', 'service.ts']) {
      for (const m of src(f).matchAll(/'(\/v1\/[A-Za-z0-9/._-]*)'/g)) served.add(m[1]!.endsWith('/') ? `${m[1]}{workflow}` : m[1]!) // GET /v1/voice/ and /v1/queue/ take a workflow id
    }
    expect([...served].sort()).toEqual(Object.keys(OPENAPI.paths).sort())
  })

  it('every operation the spec names answers (a configured managed tier; never the router\'s bare "not found")', () => {
    const ledger = buildLedger({ tenant: 'default', passes: 3, fails: 2 }).ledger
    const svc = createService({ ledger, voice: { policy: P, settings: () => ({ consequence_tier: 'low', granted: 'record' }) } })
    for (const [path, ops] of Object.entries(OPENAPI.paths)) {
      for (const method of Object.keys(ops)) {
        const req: HttpRequest = { method: method.toUpperCase(), path: path.replace('{workflow}', encodeURIComponent('default/invoice@0.0.1')), ...(method === 'post' ? { body: {} } : {}) }
        const r = svc.handle(req)
        expect(r.status, `${method} ${path}`).not.toBe(404)
        expect(r.status, `${method} ${path}`).toBeLessThan(500)
      }
    }
  })
})
