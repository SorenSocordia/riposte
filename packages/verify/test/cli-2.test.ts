/**
 * CLI-2 (Riposte recursion, wave 6, 2026-09-28), end to end through run(argv, io) on real temp files:
 *   - R1, replay truth: `verify replay` / verifyReplay never say the OUTCOME is verified unless the check was re-performed.
 *     With the inputs, the engine for the verdict's ruleset runs again and the recomputed verdict is byte-compared (the
 *     first differing field is named); without them the answer is "structure verified; outcome NOT re-performed" (exit 2).
 *     The red-team R1 PoC's BROKEN cases are regressions here.
 *   - SW4: `verify opinion --from-book`, `verify rule`, `verify statute`.
 *   - The evidence-integrity verbs: `sample commit`, `queue`, `review --sign`, `key register|revoke`, `canary seal|reveal`,
 *     `policy lint`, `--root-keys`; `grant` through grantUnderPolicy; `decline` through declineOnBook (C6/N4 closed).
 *   - Twin v0.2 flags (`--ruleset 0.1|0.2|0.2.1 --pre --filing-summary --schema`), N2 (`mine --ruleset-out` never
 *     overwrites) and D-DECLINED-COPY ("Kept at <rung> by <person>, <date>; stands until …" / "Not now: …").
 * Every grant here is signed by an ANCHORED key (--trusted-keys / --root-keys): under D-ANCHOR an unanchored one moves nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { run, type CliIO } from '../src/cli'
import {
  verify, verifyAction, verifyReplay, deriveVerdictId, hashOf, signVerdict, generateSigningKeypair, createLedger, stampVerdictChannel,
  reconcile, verifyEinvoiceTwin, disputeOpinion, disputeRuling, verifySignedRuling, promotionOpinion, opinionJSON, statuteFromRulings,
  snapshotFromChainJSONL, parseRulingBook, parseChainJSONL, readDecisionBook, MemoryLedger, lintPolicy, reviewQueue, commitDueSamples,
  verifyAgainstTwin, parseTwinPresentation, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021, EXAMPLE_PROMOTION_POLICY,
  RESEARCH_PROMOTION_POLICY, policyRef, ENGINE_VERSION, einvoiceVerdictInput,
  type Verdict, type PromotionPolicy, type TierRequirements, type ReconciliationRuleset, type Ledger,
} from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'
import { OWNER, LEAD, AGENT, TRUSTED, TINY, keyFromSeed } from './fixtures/opinion-book'
import { clean, broken, roundingDrift, FIXED_NOW } from './fixtures/invoices'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUTHOR = keyFromSeed('55'.repeat(32))
const ROOT = keyFromSeed('a1'.repeat(32))

// ── files and IO ─────────────────────────────────────────────────────────────────────────────────────────────────────
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'verify-cli-2-'))
  dirs.push(d)
  return d
}
function put(dir: string, name: string, content: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}
/** Run and return { code, out, err }. */
function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  const io = cap()
  const code = run(argv, io)
  return { code, out: io.out_(), err: io.err_(), json: () => JSON.parse(io.out_()) }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('R1, replay truth: the outcome is verified only when the check is re-performed', () => {
  // The red-team PoC's forgery: SAME inputs (so the same verdict_id), a self-consistent FAIL where the engine says PASS.
  const action = { tool: 'transfer', arguments: { amount: 500 } }
  const sources = { allowed: { amount: [500] } }
  const genuine = verifyAction(action, sources, { now: FIXED_NOW })
  const forged: Verdict = {
    ...genuine, outcome: 'FAIL',
    claims: [{
      claim_id: 'arg.amount', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'amount', asserted: 500, rule_id: 'GROUNDED',
      rule_name: 'Value grounded in an approved set', computation: { formula: 'value ∈ allowed', operands: { value: 500 }, result: false },
      evidence: [{ locator: { kind: 'field', source: 'contract', path: 'allowed.amount' }, value: 500, confidence: 100, role: 'REFERENCE' }],
      locked: true, explanation: 'FORGED: this value was NOT approved.',
    }],
    coverage: { claims_total: 1, claims_checked: 1, claims_pass: 0, claims_fail: 1, claims_insufficient: 0 },
  }

  it('R1 regression (library): the forgery with its real inputs is re-performed and FAILS at `outcome`', () => {
    expect(forged.verdict_id).toBe(genuine.verdict_id) // the id commits to the inputs only: the premise of the attack
    const r = verifyReplay(forged, { action, sources })
    expect(r).toMatchObject({ ok: false, id_ok: true, input_ok: true, outcome_verified: false, status: 'FAILED', reperformed: { engine: 'action', identical: false, first_difference: 'outcome' } })
    expect(r.reason).toMatch(/the re-performed verdict differs from the presented one at `outcome`/)
    // the genuine one re-performs byte-identical
    expect(verifyReplay(genuine, { action, sources })).toMatchObject({ ok: true, outcome_verified: true, status: 'REPERFORMED', reperformed: { engine: 'action', identical: true } })
  })

  it('R1 regression (library): without inputs the binding is all that holds, and it never reads as an outcome attestation', () => {
    const r = verifyReplay(forged)
    expect(r).toMatchObject({ id_ok: true, outcome_verified: false, status: 'STRUCTURE_ONLY' })
    expect(r.not_reperformed).toMatch(/^structure verified; outcome NOT re-performed: no inputs were supplied/)
    expect(r.reperformed).toBeUndefined()
  })

  it('R1 regression (CLI): the forgery alone exits 2 (was 0); with --inputs it exits 1 naming the field; the genuine one exits 0', () => {
    const d = scratch()
    const inputs = put(d, 'inputs.json', { action, sources })
    const alone = go(['replay', put(d, 'forged.json', forged)])
    expect(alone.code).toBe(2)
    expect(alone.json()).toMatchObject({ status: 'STRUCTURE_ONLY', outcome_verified: false })
    expect(alone.err).toMatch(/structure verified; outcome NOT re-performed.*Exit 2/)
    const withInputs = go(['replay', put(d, 'forged2.json', forged), '--inputs', inputs])
    expect(withInputs.code).toBe(1)
    expect(withInputs.err).toMatch(/verify replay: FAILED: the re-performed verdict differs from the presented one at `outcome`/)
    const real = go(['replay', put(d, 'genuine.json', genuine), '--inputs', inputs])
    expect(real.code).toBe(0)
    expect(real.err).toMatch(/outcome VERIFIED: re-performed with action/)
  })

  it('verify() verdicts: --extraction builds the inputs from the documents (the flags `verify <doc>` takes)', () => {
    const d = scratch()
    const doc = put(d, 'broken.json', broken)
    const contract = { rates: [{ role: 'Consulting', rate: 150 }] }
    const v = verify(broken, { now: FIXED_NOW })
    expect(v.outcome).toBe('FAIL')
    expect(go(['replay', put(d, 'v.json', v), '--extraction', doc]).code).toBe(0)
    // a self-consistent PASS for the same document: the recomputation disagrees, and says where first
    const flipped = { ...v, outcome: 'PASS', coverage: { ...v.coverage, claims_fail: 0, claims_pass: v.coverage.claims_checked } }
    const f = go(['replay', put(d, 'flipped.json', flipped), '--extraction', doc])
    expect(f.code).toBe(1)
    expect(f.json().reperformed).toMatchObject({ engine: 'verify:invoice', identical: false, first_difference: 'outcome' })
    // a quiet edit to one claim's words is caught too, by path
    const i = v.claims.findIndex(c => c.outcome === 'FAIL')
    const reworded = { ...v, claims: v.claims.map((c, k) => (k === i ? { ...c, explanation: 'nothing to see' } : c)) }
    expect(go(['replay', put(d, 'reworded.json', reworded), '--extraction', doc]).json().reperformed.first_difference).toBe(`claims[${i}].explanation`)
    // references are part of the binding: the same flags, or it is not this verdict's input
    const vc = verify(broken, { references: { contract }, now: FIXED_NOW })
    const cp = put(d, 'contract.json', contract)
    expect(go(['replay', put(d, 'vc.json', vc), '--extraction', doc, '--contract', cp]).code).toBe(0)
    const missing = go(['replay', put(d, 'vc2.json', vc), '--extraction', doc])
    expect(missing.code).toBe(1)
    expect(missing.json()).toMatchObject({ input_ok: false, status: 'FAILED' })
  })

  it('a declarative ruleset file is part of the inputs; a ruleset flag that is not the verdict\'s is refused', () => {
    const d = scratch()
    const rs = { id: 't', version: '1.0.0', domain: 'test', fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } }, checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }] }
    const doc = { subtotal: 100, tax: 10, total: 110 }
    const v = verify(doc, { ruleset: rs as never, now: FIXED_NOW })
    const vp = put(d, 'v.json', v)
    expect(go(['replay', vp, '--extraction', put(d, 'doc.json', doc), '--ruleset', put(d, 'rs.json', rs)]).json()).toMatchObject({ status: 'REPERFORMED', reperformed: { engine: 'declarative' } })
    expect(go(['replay', vp, '--extraction', put(d, 'doc2.json', doc), '--ruleset', put(d, 'rs2.json', rs), '--contract', put(d, 'c.json', {})]).code).toBe(3)
    const inv = verify(clean, { now: FIXED_NOW })
    const wrong = go(['replay', put(d, 'inv.json', inv), '--extraction', put(d, 'clean.json', clean), '--ruleset', 'pay-app'])
    expect(wrong.code).toBe(3)
    expect(wrong.err).toMatch(/--ruleset pay-app is not the verdict's ruleset \(invoice\)/)
  })

  // F-C2-1 / D-TOL-ID (fixed 2026-09-28). This test used to assert "...and not the id": that line encoded the bug (one
  // verdict_id, two outcomes). The override is now part of the input identity, so it changes the id and must be restated.
  it('a rounding override the verdict was issued under must be restated: input_hash commits to it', () => {
    const d = scratch()
    const strict = verify(roundingDrift, { tolerance: { rel: 0, absCap: 0 }, now: FIXED_NOW })
    const lenient = { rel: 0.0005, absCap: 0 } // a materiality band: forgives the 40 cents that invoice 0.1.0 does not
    expect(strict.outcome).not.toBe(verify(roundingDrift, { tolerance: lenient, now: FIXED_NOW }).outcome) // the override changes the outcome...
    expect(strict.verdict_id).not.toBe(verify(roundingDrift, { tolerance: lenient, now: FIXED_NOW }).verdict_id) // ...and so the id
    expect(strict.verdict_id).not.toBe(verify(roundingDrift, { now: FIXED_NOW }).verdict_id) // an override is never the default's id
    const vp = put(d, 'strict.json', strict)
    const doc = put(d, 'doc.json', roundingDrift)
    const unstated = go(['replay', vp, '--extraction', doc])
    expect(unstated.code).toBe(1)
    expect(unstated.err).toMatch(/If it was issued under a rounding-tolerance override, restate it/)
    expect(go(['replay', vp, '--extraction', doc, '--tolerance', '{"rel":0,"absCap":0}']).code).toBe(0)
    expect(go(['replay', vp, '--extraction', doc, '--tolerance', '{"rel":0.0005,"absCap":0}']).code).toBe(1) // not the override it was issued under
    expect(go(['replay', vp, '--extraction', doc, '--tolerance', '{"rel":-1}']).code).toBe(3)
  })

  it('annotations added after the engine (the book\'s, a channel stamp) are named and not re-performed; the rest is', () => {
    const d = scratch()
    const led = createLedger({ now: FIXED_NOW })
    const v = verify(clean, { now: FIXED_NOW })
    led.record(v, { tenant_id: 'acme' })
    const onBook = stampVerdictChannel(led.get(v.verdict_id)!.verdict)
    const r = go(['replay', put(d, 'v.json', onBook), '--extraction', put(d, 'doc.json', clean)])
    expect(r.code).toBe(0)
    expect(r.json().reperformed.annotations).toEqual(['channel', 'ledger'])
    expect(r.err).toMatch(/Not re-performed \(not the engine's output\): channel, ledger/)
  })

  it('never "verified" when nothing here can re-perform it: another engine version, an unknown input shape', () => {
    const v = verify(clean, { now: FIXED_NOW })
    const old = { ...v, engine_version: '0.0.0-old', verdict_id: deriveVerdictId(v.input_hash, v.ruleset, '0.0.0-old') }
    const inputs = { extraction: clean, references: { contract: null, evidence: [], history: [] }, source: null }
    expect(verifyReplay(old, inputs)).toMatchObject({ ok: true, input_ok: true, outcome_verified: false, status: 'STRUCTURE_ONLY' })
    expect(verifyReplay(old, inputs).not_reperformed).toMatch(new RegExp(`issued by engine 0\\.0\\.0-old; this is engine ${ENGINE_VERSION.replace(/\./g, '\\.')}`))
    const odd = { foo: 1 }
    const shaped = { ...v, input_hash: hashOf(odd), verdict_id: deriveVerdictId(hashOf(odd), v.ruleset, v.engine_version) }
    const r = verifyReplay(shaped, odd)
    expect(r).toMatchObject({ ok: true, input_ok: true, outcome_verified: false, status: 'STRUCTURE_ONLY' })
    expect(r.not_reperformed).toMatch(/no engine in this build takes inputs shaped \{ foo \}/)
  })

  it('a signed envelope: the signature is checked, and the outcome is still verified only by re-performing it', () => {
    const d = scratch()
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict(genuine, privateKeyPem)
    const inputs = put(d, 'inputs.json', { action, sources })
    const bare = go(['replay', put(d, 'env.json', env)])
    expect(bare.code).toBe(2)
    expect(bare.json().envelope).toMatchObject({ alg: 'ed25519', signature_ok: true })
    expect(bare.err).toMatch(/The envelope's signature verifies .* anchor the key to its holder out of band/)
    expect(go(['replay', put(d, 'env2.json', env), '--inputs', inputs]).code).toBe(0)
    const tampered = go(['replay', put(d, 'env3.json', { ...env, verdict: forged }), '--inputs', inputs])
    expect(tampered.code).toBe(1)
    expect(tampered.json().envelope.signature_ok).toBe(false)
  })

  it('the other engines re-perform from their own inputs: reconcile, the e-invoice twin (with its XML)', () => {
    const RS = JSON.parse(readFileSync(join(HERE, '..', 'docs', 'examples', 'four-way-match.ruleset.json'), 'utf8')) as ReconciliationRuleset
    const documents = { po: { approved_amount: 1000 }, invoice: { payable_amount: 1000 }, receipt: { received_amount: 1000 }, payment: { amount: 1000 } }
    expect(verifyReplay(reconcile(documents, RS, { now: FIXED_NOW }), { documents, ruleset: RS })).toMatchObject({ status: 'REPERFORMED', reperformed: { engine: 'reconcile' } })

    const d = scratch()
    const xmlPath = join(HERE, 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml')
    const xml = readFileSync(xmlPath, 'utf8')
    const claims = [{ id: 'c1', field: 'payable_amount', value: 1034 }]
    const r = verifyEinvoiceTwin(xml, claims, { now: FIXED_NOW })
    const inputs = put(d, 'inputs.json', einvoiceVerdictInput(r.twin.sha256, r.twin.profile, claims))
    const vp = put(d, 'v.json', r.verdict)
    const noDoc = go(['replay', vp, '--inputs', inputs])
    expect(noDoc.code).toBe(2)
    expect(noDoc.json().not_reperformed).toMatch(/commit to the XML by its sha256, not its text: supply the XML/)
    const withDoc = go(['replay', vp, '--inputs', inputs, '--document', xmlPath])
    expect(withDoc.code).toBe(0)
    expect(withDoc.json().reperformed).toMatchObject({ engine: 'twin-einvoice', identical: true })
    // another document under the same inputs: its bytes are not the hashed ones
    const other = go(['replay', vp, '--inputs', inputs, '--document', put(d, 'other.xml', xml.replace('1034', '1035'))])
    expect(other.code).toBe(1)
    expect(other.json().reperformed.first_difference).toBe('input_hash')
  })

  it('usage: one way to give the inputs; document flags need --extraction; one verdict', () => {
    const d = scratch()
    const vp = put(d, 'v.json', genuine)
    const ip = put(d, 'i.json', { action, sources })
    expect(go(['replay', vp, '--inputs', ip, '--extraction', ip]).code).toBe(3)
    expect(go(['replay', vp, '--contract', ip]).err).toMatch(/--contract build verify\(\)'s inputs with --extraction/)
    expect(go(['replay', vp, vp]).err).toMatch(/unexpected argument/)
    expect(go(['replay', vp, '--inptus', ip]).err).toMatch(/unknown option\(s\) --inptus/)
    expect(go(['replay']).code).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A tiny synthetic filing (the twin-v02 test's shape): a statement line, and a higher-priority concept only in a note.
const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"'
const ctx = '<xbrli:context id="I24"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2024-12-31</xbrli:instant></xbrli:period></xbrli:context>'
const nf = (name: string, text: string, scale = '3', decimals = '-3'): string => `<td><ix:nonFraction name="${name}" contextRef="I24" unitRef="usd" decimals="${decimals}" scale="${scale}" format="ixt:num-dot-decimal">${text}</ix:nonFraction></td>`
const HTML = `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body><div style="display:none"><ix:header><ix:resources>${ctx}<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit></ix:resources></ix:header></div><table>`
  + `<tr><td>Total assets</td>${nf('us-gaap:Assets', '1,234,567')}</tr><tr><td>Assets (note)</td>${nf('us-gaap:Assets', '1,234,567,123', '0', '0')}</tr></table></body></html>`
const PRE = '<?xml version="1.0" encoding="utf-8"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">'
  + '<link:presentationLink xlink:type="extended" xlink:role="http://abc.example.com/role/BalanceSheets"><link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2024/elts/us-gaap-2024.xsd#us-gaap_Assets" xlink:label="loc_Assets"/></link:presentationLink></link:linkbase>'
const FSUM = '<?xml version="1.0" encoding="utf-8"?><FilingSummary><MyReports><Report instance="abc-20241231.htm"><HtmlFileName>R2.htm</HtmlFileName><LongName>0000002 - Statement - Consolidated Balance Sheets</LongName><ReportType>Sheet</ReportType><Role>http://abc.example.com/role/BalanceSheets</Role><ShortName>Consolidated Balance Sheets</ShortName><MenuCategory>Statements</MenuCategory><Position>2</Position></Report></MyReports></FilingSummary>'

describe('verify twin --ruleset 0.1|0.2|0.2.1 --pre --filing-summary --schema (CREDENCE-2 in the CLI)', () => {
  const claims = [{ id: 'a', field: 'assets', value: 1234567000 }]
  function files(): { d: string; html: string; claims: string; pre: string; fs: string } {
    const d = scratch()
    return { d, html: put(d, 'f.htm', HTML), claims: put(d, 'claims.json', claims), pre: put(d, 'f_pre.xml', PRE), fs: put(d, 'FilingSummary.xml', FSUM) }
  }
  const base = (f: ReturnType<typeof files>): string[] => ['twin', '--html', f.html, '--period-end', '2024-12-31', '--claims', f.claims]
  const strip = (r: { verdict: Verdict }): unknown => ({ ...r, verdict: { ...r.verdict, issued_at: '' } })

  it('the default is v0.1, unchanged: the same result as the library\'s default map', () => {
    const f = files()
    const r = go(base(f))
    expect(strip(r.json())).toEqual(strip(JSON.parse(JSON.stringify(verifyAgainstTwin(HTML, claims, { periodEnd: '2024-12-31' })))))
    expect(r.json().verdict.ruleset).toMatchObject({ id: FS_CORE_TWIN_MAP.id, version: FS_CORE_TWIN_MAP.version })
  })

  it('--ruleset 0.2 without a linkbase: every claim ABSTAINs NO_PRESENTATION_LINKBASE, exit 2', () => {
    const f = files()
    const r = go([...base(f), '--ruleset', '0.2'])
    expect(r.code).toBe(2)
    expect(r.json().judgments.map((j: { outcome: string; reason: string }) => [j.outcome, j.reason])).toEqual([['ABSTAIN', 'NO_PRESENTATION_LINKBASE']])
    expect(r.err).toMatch(/no presentation linkbase was read .* every claim abstains \(NO_PRESENTATION_LINKBASE\)/)
  })

  it('--ruleset 0.2 / 0.2.1 with the linkbase: the library\'s statement-anchored result, byte for byte', () => {
    const f = files()
    for (const [v, map, links] of [['0.2', FS_CORE_TWIN_MAP_V02, 'v0.2'], ['0.2.1', FS_CORE_TWIN_MAP_V021, 'strict']] as const) {
      const r = go([...base(f), '--ruleset', v, '--pre', f.pre, '--filing-summary', f.fs])
      const lib = verifyAgainstTwin(HTML, claims, { periodEnd: '2024-12-31', map, presentation: parseTwinPresentation({ pre: PRE, filingSummary: FSUM }, { links }) })
      expect(strip(r.json())).toEqual(strip(JSON.parse(JSON.stringify(lib))))
      expect(r.code).toBe(lib.verdict.outcome === 'PASS' ? 0 : lib.verdict.outcome === 'FAIL' ? 1 : 2)
      expect(r.json().twin.presentation).not.toBeNull()
    }
  })

  it('a replayed v0.2 twin verdict re-performs with its document and linkbase', () => {
    const f = files()
    const r = go([...base(f), '--ruleset', '0.2', '--pre', f.pre, '--filing-summary', f.fs]).json()
    const vp = put(f.d, 'v.json', r.verdict)
    const inputs = put(f.d, 'inputs.json', { twin_sha256: r.twin.sha256, period_end: '2024-12-31', period_tolerance_days: 7, tolerance: 0.5, map: `${FS_CORE_TWIN_MAP_V02.id}@${FS_CORE_TWIN_MAP_V02.version}`, claims, presentation_sha256: r.twin.presentation.sha256 })
    expect(go(['replay', vp, '--inputs', inputs]).json().not_reperformed).toMatch(/supply the iXBRL document/)
    expect(go(['replay', vp, '--inputs', inputs, '--document', f.html]).json().not_reperformed).toMatch(/binds through the filing's presentation linkbase/)
    expect(go(['replay', vp, '--inputs', inputs, '--document', f.html, '--pre', f.pre, '--filing-summary', f.fs]).json()).toMatchObject({ status: 'REPERFORMED', reperformed: { engine: 'twin' } })
  })

  it('usage: linkbase flags belong to v0.2+; an unknown map version is refused', () => {
    const f = files()
    expect(go([...base(f), '--pre', f.pre]).err).toMatch(/--pre belongs to the statement-anchored twin/)
    expect(go([...base(f), '--ruleset', '0.1', '--schema', f.pre]).code).toBe(3)
    expect(go([...base(f), '--ruleset', '0.3']).err).toMatch(/--ruleset must be one of 0\.1, 0\.2, 0\.2\.1/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('N2: verify mine --ruleset-out never writes over a file', () => {
  it('refuses an existing path (exit 1, the file untouched), writes a fresh one, and refuses it the second time', () => {
    const d = scratch()
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, label: 'approve', fields: { total: 100 + i, limit: 500 } })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, label: 'hold', fields: { total: 600 + i, limit: 500 } })),
    ]
    const cases = put(d, 'cases.jsonl', rows.map(r => JSON.stringify(r)).join('\n'))
    const schema = put(d, 'schema.json', { approve: 'approve', fields: { total: { type: 'money' }, limit: { type: 'money' } } })
    const taken = put(d, 'taken.json', 'mine')
    const r = go(['mine', cases, '--schema', schema, '--ruleset-out', taken])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/REFUSED: .*taken\.json already exists: a compiled ruleset is never written over a file/)
    expect(readFileSync(taken, 'utf8')).toBe('mine')
    const fresh = join(d, 'mined.json')
    const ok = go(['mine', cases, '--schema', schema, '--ruleset-out', fresh])
    expect(ok.code, ok.err).toBe(0)
    expect(existsSync(fresh)).toBe(true)
    const again = readFileSync(fresh, 'utf8')
    expect(go(['mine', cases, '--schema', schema, '--ruleset-out', fresh]).code).toBe(1)
    expect(readFileSync(fresh, 'utf8')).toBe(again)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A book on disk: TINY's evidence (12 clean PASS, 8 FAIL), the owner's anchored GRANT of `level`, the policy and keys. */
function tinyBook(level: 'gate' | 'advise' | 'autonomy' | null = 'gate'): { d: string; chain: string; policy: string; trusted: string; owner: string; lead: string; agent: string; ledger: Ledger } {
  const d = scratch()
  const ledger = createLedger({ now: freshClockAt('2026-09-01T00:00:00Z'), trusted_keys: TRUSTED })
  buildLedger({ ledger, passes: 12, fails: 8 })
  const b = {
    d, ledger, chain: '', policy: put(d, 'tiny.json', TINY), trusted: put(d, 'trusted.json', TRUSTED),
    owner: put(d, 'owner.pem', OWNER.privateKeyPem), lead: put(d, 'lead.pem', LEAD.privateKeyPem), agent: put(d, 'agent.pem', AGENT.privateKeyPem),
  }
  b.chain = put(d, 'chain.jsonl', ledger.chainJSONL())
  if (level) {
    const g = go(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--workflow', WF(), '--level', level, '--tier', 'low', '--policy', b.policy, '--trusted-keys', b.trusted, '--signed-at', '2026-09-28T09:00:00Z', ...(level === 'autonomy' ? ['--bounds', 'all'] : [])])
    expect(g.code, g.err).toBe(0)
  }
  return b
}
function freshClockAt(iso: string): () => Date {
  let ms = Date.parse(iso)
  return () => new Date((ms += 60_000))
}

describe('SW4: verify opinion --from-book', () => {
  it('reads the rung from the GRANT in force and cites it: the library\'s opinion, byte for byte', () => {
    const b = tinyBook('gate')
    const r = go(['opinion', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted, '--json'])
    expect(r.code, r.err).toBe(0)
    const lib = promotionOpinion({ snapshot: snapshotFromChainJSONL(readFileSync(b.chain, 'utf8')), policy: TINY, workflow_id: WF(), trusted_keys: TRUSTED })
    expect(r.out).toBe(`${opinionJSON(lib)}\n`)
    expect(r.json().subject).toMatchObject({ kind: 'PROMOTION', granted: 'gate', rung_source: 'BOOK' })
    expect(r.json().subject.amends.decision_id).toMatch(/^[0-9a-f]{32}$/)
    const md = go(['opinion', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted])
    expect(md.out).toMatch(/\*\*Amends:\*\* GRANT `[0-9a-f]{12}…`/)
  })

  it('without the anchors the GRANT moves nothing (D-ANCHOR): the opinion never reads it as the rung', () => {
    const b = tinyBook('gate')
    const r = go(['opinion', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low', '--json'])
    const lib = promotionOpinion({ snapshot: snapshotFromChainJSONL(readFileSync(b.chain, 'utf8')), policy: TINY, workflow_id: WF(), consequence_tier: 'low' })
    expect(r.out).toBe(`${opinionJSON(lib)}\n`)
    expect(r.json().subject.granted).not.toBe('gate')
    // the voice read says so on stderr, with the library's own notice (never silently record)
    const v = go(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tier', 'low'])
    expect(v.code).toBe(0)
    expect(v.err).toMatch(/verify voice: note: GRANT `[0-9a-f]{12}` by owner .* is not anchored: it has no effect/)
  })

  it('--tenant scopes the opinion to one tenant (the library\'s scope)', () => {
    const b = tinyBook('gate')
    const r = go(['opinion', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--tenant', 'acme', '--trusted-keys', b.trusted, '--json'])
    const lib = promotionOpinion({ snapshot: snapshotFromChainJSONL(readFileSync(b.chain, 'utf8')), policy: TINY, workflow_id: WF(), scope: { tenant_id: 'acme' }, trusted_keys: TRUSTED })
    expect(r.out).toBe(`${opinionJSON(lib)}\n`)
    expect(r.json().subject.tenant_id).toBe('acme')
  })

  it('a flag never overrides the book: --granted/--proposal/--dispute with --from-book are usage errors; --workflow is required', () => {
    const b = tinyBook('gate')
    const common = ['opinion', '--from-book', '--ledger', b.chain, '--policy', b.policy]
    expect(go([...common, '--workflow', WF(), '--granted', 'autonomy']).err).toMatch(/--from-book reads the rung.*--granted cannot be passed with it/)
    expect(go([...common, '--workflow', WF(), '--dispute', 'x']).code).toBe(3)
    expect(go([...common, '--workflow', WF(), '--proposal', b.policy]).code).toBe(3)
    expect(go(common).err).toMatch(/--from-book needs --policy <policy\.json> and --workflow <id>/)
    expect(go([...common, '--workflow', WF(), '--surface']).err).toMatch(/unknown option\(s\) --surface/)
  })
})

describe('SW4: verify rule → rulings.jsonl → verify statute', () => {
  it('a person rules on a disputed FAIL (one JSON line, anchored); the statute re-verifies every ruling: the library\'s, byte for byte', () => {
    const b = tinyBook(null)
    const text = readFileSync(b.chain, 'utf8')
    const fails = b.ledger.all().filter(r => r.verdict.outcome === 'FAIL').map(r => r.verdict.verdict_id)
    const lines: string[] = []
    for (const [i, id] of fails.slice(0, 3).entries()) {
      const r = go(['rule', '--ledger', b.chain, '--dispute', id!, '--ruling', i === 0 ? 'SET_ASIDE' : 'STANDS', '--reason', 'reviewed against the PO',
        '--key', b.lead, '--signer', 'ap-lead', '--signed-at', `2026-09-28T10:0${i}:00Z`, '--trusted-keys', b.trusted])
      expect(r.code, r.err).toBe(0)
      expect(r.out.trim().split('\n')).toHaveLength(1) // one line: `verify rule … >> rulings.jsonl`
      const signed = r.json()
      expect(verifySignedRuling(signed, { trusted_keys: TRUSTED })).toMatchObject({ ok: true, anchored: true })
      const op = disputeOpinion({ snapshot: snapshotFromChainJSONL(text), verdict_id: id!, trusted_keys: TRUSTED })
      expect(signed.ruling).toEqual(disputeRuling(op, { ruling: i === 0 ? 'SET_ASIDE' : 'STANDS', reason: 'reviewed against the PO', signer_id: 'ap-lead', signed_at: `2026-09-28T10:0${i}:00Z` }))
      lines.push(r.out.trim())
    }
    const rule = JSON.parse(lines[0]!).ruling.rule_id as string
    // an agent key signing as the lead: refused (the trusted keys anchor the lead's key only)
    const forged = go(['rule', '--ledger', b.chain, '--dispute', fails[3]!, '--ruling', 'STANDS', '--reason', 'x', '--key', b.agent, '--signer', 'ap-lead', '--trusted-keys', b.trusted])
    expect(forged.code).toBe(1)
    expect(forged.err).toMatch(/REFUSED: the signing key is not the one anchored to signer 'ap-lead'/)

    const rulings = put(b.d, 'rulings.jsonl', `${lines.join('\n')}\n`)
    const rowsOut = join(b.d, 'rows.jsonl'), schemaOut = join(b.d, 'schema.json')
    const s = go(['statute', '--ledger', b.chain, '--rulings', rulings, '--rule', rule, '--domain', 'invoice', '--trusted-keys', b.trusted, '--rows-out', rowsOut, '--schema-out', schemaOut])
    expect(s.code, s.err).toBe(0)
    const lib = statuteFromRulings({ snapshot: snapshotFromChainJSONL(text), rulings: parseRulingBook(readFileSync(rulings, 'utf8')), rule_id: rule, domain: 'invoice', trusted_keys: TRUSTED })
    expect(s.json().statute).toEqual(JSON.parse(JSON.stringify(lib)))
    expect(s.json().statute.rows).toHaveLength(3)
    expect(Array.isArray(s.json().counsel)).toBe(true)
    expect(s.err).toMatch(/3 ruling row\(s\) on .* each COUNSEL/)
    expect(readFileSync(rowsOut, 'utf8').trim().split('\n')).toHaveLength(3)
    // the case table is never written over a file
    expect(go(['statute', '--ledger', b.chain, '--rulings', rulings, '--rule', rule, '--domain', 'invoice', '--rows-out', rowsOut, '--schema-out', join(b.d, 's2.json')]).code).toBe(1)
  })

  it('refusals and usage: a bad ruling word, a verdict not on the book, an unverified book, a half-given table', () => {
    const b = tinyBook(null)
    const id = b.ledger.all().find(r => r.verdict.outcome === 'FAIL')!.verdict.verdict_id
    const common = ['--key', b.lead, '--signer', 'ap-lead', '--reason', 'r']
    expect(go(['rule', '--ledger', b.chain, '--dispute', id, '--ruling', 'MAYBE', ...common]).err).toMatch(/--ruling must be one of STANDS, SET_ASIDE/)
    expect(go(['rule', '--ledger', b.chain, '--dispute', 'f'.repeat(32), '--ruling', 'STANDS', ...common]).code).toBe(1)
    // --root-keys reaches the dispute opinion (root_keys on DisputeOpinionInput): read, never refused or ignored
    expect(go(['rule', '--ledger', b.chain, '--dispute', id, '--ruling', 'STANDS', ...common, '--root-keys', put(b.d, 'r.pub.pem', ROOT.publicKeyPem)]).code).toBe(0)
    const rulings = put(b.d, 'rulings.jsonl', '')
    const lines = readFileSync(b.chain, 'utf8').split('\n')
    const ev = JSON.parse(lines[0]!); ev.payload.tenant_id = 'mallory'; lines[0] = JSON.stringify(ev)
    const bad = put(b.d, 'bad.jsonl', lines.join('\n'))
    expect(go(['statute', '--ledger', bad, '--rulings', rulings, '--rule', 'SUM_INT', '--domain', 'invoice']).code).toBe(1)
    expect(go(['statute', '--ledger', b.chain, '--rulings', rulings, '--rule', 'SUM_INT', '--domain', 'invoice', '--rows-out', join(b.d, 'x.jsonl')]).err).toMatch(/--rows-out and --schema-out go together/)
    expect(go(['statute', '--ledger', b.chain, '--rulings', rulings, '--rule', 'SUM_INT', '--domain', 'invoice', '--outcome', 'MAYBE']).code).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PASSES: Verdict[] = Array.from({ length: 21 }, (_, i) => verify({ ...clean, invoice_number: `C2-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 20 }, (_, i) => verify({ ...broken, invoice_number: `C2-F${i}` }, { now: FIXED_NOW }))
const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
const RS: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'rs', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, ...bars, sampling: { period: 'day', review_rate: 0.5 }, evidence: { random_selection: true } } as TierRequirements],
}
const EI_TRUSTED = { owner: OWNER.publicKeyPem, 'ap-lead': LEAD.publicKeyPem, author: AUTHOR.publicKeyPem }

/** Day 1: 20 PASS + 20 FAIL recorded; day 2: one more PASS (day 1 is closed, so its draw is due). */
function drawBook(): { d: string; chain: string; policy: string; trusted: string; lead: string; agent: string; author: string; owner: string } {
  const d = scratch()
  const tick = freshClockAt('2026-09-01T09:00:00Z')
  let day2 = false
  const led = createLedger({ now: () => (day2 ? new Date(Date.parse('2026-09-02T09:00:00Z')) : tick()) })
  for (const v of [...PASSES.slice(0, 20), ...FAILS]) led.record(v, { tenant_id: 'acme' })
  day2 = true
  led.record(PASSES[20]!, { tenant_id: 'acme' })
  return {
    d, chain: put(d, 'chain.jsonl', led.chainJSONL()), policy: put(d, 'rs.json', RS), trusted: put(d, 'trusted.json', EI_TRUSTED),
    lead: put(d, 'lead.pem', LEAD.privateKeyPem), agent: put(d, 'agent.pem', AGENT.privateKeyPem), author: put(d, 'author.pem', AUTHOR.privateKeyPem), owner: put(d, 'owner.pem', OWNER.privateKeyPem),
  }
}
const EWF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`
const bookOf = (path: string, anchors: { trusted_keys?: typeof EI_TRUSTED; root_keys?: string[] } = {}): MemoryLedger => new MemoryLedger({ seed: parseChainJSONL(readFileSync(path, 'utf8')), ...anchors })

describe('evidence integrity: sample commit, queue, review --sign', () => {
  it('commits the due draw (the library\'s, on the same book), then nothing is due; the queue is the library\'s queue', () => {
    const b = drawBook()
    const expected = commitDueSamples(bookOf(b.chain), EWF, RS, { consequence_tier: 'low' })
    const r = go(['sample', 'commit', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'])
    expect(r.code, r.err).toBe(0)
    expect(r.json().count).toBeGreaterThan(0)
    expect(r.json().committed.map((e: { sample: unknown }) => e.sample)).toEqual(expected.map(e => e.sample))
    expect(readDecisionBook(parseChainJSONL(readFileSync(b.chain, 'utf8')).events, parseChainJSONL(readFileSync(b.chain, 'utf8')).payloads).ok).toBe(true)
    // each SAMPLE event carries the ledger's own clock, which can close the next period: commit until nothing is due
    let again = go(['sample', 'commit', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'])
    for (let i = 0; i < 3 && again.json().count > 0; i++) again = go(['sample', 'commit', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'])
    expect(again.code).toBe(0)
    expect(again.json().count).toBe(0)
    expect(again.err).toMatch(/nothing due/)
    const q = go(['queue', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'])
    expect(q.code).toBe(0)
    expect(q.json().items).toEqual(JSON.parse(JSON.stringify(reviewQueue(bookOf(b.chain), EWF, RS, { consequence_tier: 'low' }))))
    expect(q.json().count).toBeGreaterThan(0)
  })

  it('a person reviews a queued item as a SIGNED decision; the queue shrinks; an agent key and an unrecorded verdict are refused', () => {
    const b = drawBook()
    go(['sample', 'commit', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'])
    const queue = go(['queue', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low']).json().items as { verdict_id: string }[]
    const first = queue[0]!.verdict_id
    const sign = (key: string, signer: string, verdict: string): string[] => ['review', '--sign', '--ledger', b.chain, '--key', key, '--signer', signer, '--verdict', verdict, '--decision', 'UPHELD', '--procedure', 're-performed', '--trusted-keys', b.trusted, '--signed-at', '2026-09-02T10:00:00Z']
    const r = go(sign(b.lead, 'ap-lead', first))
    expect(r.code, r.err).toBe(0)
    expect(r.json()).toMatchObject({ reviewed: { verdict_id: first, tenant_id: 'acme', review: { decision: 'UPHELD' } }, anchored: true })
    const after = go(['queue', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low']).json().items as { verdict_id: string }[]
    expect(after.map(q => q.verdict_id)).toEqual(queue.slice(1).map(q => q.verdict_id))
    const before = readFileSync(b.chain, 'utf8')
    expect(go(sign(b.agent, 'ap-lead', queue[1]!.verdict_id)).code).toBe(1)
    expect(go(sign(b.lead, 'ap-lead', 'f'.repeat(32))).code).toBe(1)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
    expect(go(['review', '--ledger', b.chain, '--key', b.lead, '--signer', 'ap-lead', '--verdict', first, '--decision', 'UPHELD']).err).toMatch(/pass --sign/)
    expect(go([...sign(b.lead, 'ap-lead', first).filter(t => t !== 'UPHELD' && t !== '--decision'), '--decision', 'MEH']).code).toBe(3)
  })

  it('usage: `verify sample` needs `commit`; a missing workflow is named', () => {
    const b = drawBook()
    expect(go(['sample', '--ledger', b.chain]).err).toMatch(/the verb is `verify sample commit`/)
    expect(go(['sample', 'commit', '--ledger', b.chain, '--policy', b.policy]).err).toMatch(/needs --workflow/)
    expect(go(['queue', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF]).code).toBe(1) // no grant and no tier: the library says why
  })
})

describe('the key registry: verify key register | revoke, and --root-keys on the readers', () => {
  it('the root registers a reviewer; a registered key reviews under --root-keys; revoked, it signs nothing more', () => {
    const b = drawBook()
    const root = put(b.d, 'root.pem', ROOT.privateKeyPem)
    const rootPub = put(b.d, 'root.pub.pem', ROOT.publicKeyPem)
    const leadPub = put(b.d, 'lead.pub.pem', LEAD.publicKeyPem)
    const reg = go(['key', 'register', '--ledger', b.chain, '--root', root, '--subject', 'ap-lead', '--public-key', leadPub, '--roles', 'reviewer', '--signed-at', '2026-09-02T09:30:00Z'])
    expect(reg.code, reg.err).toBe(0)
    expect(reg.json()).toMatchObject({ anchored: true, appended: { signed: { decision: { kind: 'KEY_REGISTER', subject_id: 'ap-lead', roles: ['reviewer'], signer_id: 'root' } } } })
    expect(reg.err).toMatch(/Every reader must anchor with --root-keys/)
    const id = PASSES[0]!.verdict_id
    const review = (key: string, signer: string): ReturnType<typeof go> => go(['review', '--sign', '--ledger', b.chain, '--key', key, '--signer', signer, '--verdict', id, '--decision', 'UPHELD', '--root-keys', rootPub, '--signed-at', '2026-09-02T10:00:00Z'])
    expect(review(b.lead, 'ap-lead').code).toBe(0)
    expect(review(b.agent, 'agent-7').code).toBe(1) // not registered: the registry is in force
    // the book reads under the root; the readers take --root-keys
    expect(go(['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', EWF, '--tier', 'low', '--root-keys', rootPub]).code).toBe(0)
    const rev = go(['key', 'revoke', '--ledger', b.chain, '--root', root, '--root-keys', rootPub, '--subject', 'ap-lead', '--public-key', leadPub, '--reason', 'rotated to a hardware key'])
    expect(rev.code, rev.err).toBe(0)
    expect(rev.err).not.toMatch(/Every reader must anchor/)
    expect(review(b.lead, 'ap-lead').code).toBe(1) // revoked: prospectively, it signs nothing more
  })

  it('refusals and usage: a root that is not the anchored root, a private key as --root-keys, bad roles, one signer', () => {
    const b = drawBook()
    const root = put(b.d, 'root.pem', ROOT.privateKeyPem)
    const other = put(b.d, 'other.pub.pem', OWNER.publicKeyPem)
    const leadPub = put(b.d, 'lead.pub.pem', LEAD.publicKeyPem)
    const common = ['--ledger', b.chain, '--subject', 'ap-lead', '--public-key', leadPub, '--roles', 'reviewer']
    expect(go(['key', 'register', ...common, '--root', root, '--root-keys', other]).err).toMatch(/the --root key is not one of --root-keys/)
    expect(go(['key', 'register', ...common, '--root', root, '--root-keys', root]).err).toMatch(/holds a PRIVATE key: --root-keys takes the root's PUBLIC key/)
    expect(go(['key', 'register', ...common.map(t => (t === 'reviewer' ? 'reviewer,admin' : t)), '--root', root]).err).toMatch(/--roles is a comma list of key_admin, policy_author, reviewer, grant_signer/)
    expect(go(['key', 'register', ...common, '--root', root, '--key', b.lead]).code).toBe(3)
    expect(go(['key', 'register', ...common, '--key', b.lead, '--signer', 'ap-lead']).err).toMatch(/--root-keys <root\.pub\.pem>/)
    expect(go(['key', 'register', ...common, '--root', root, '--public-key', b.lead]).code).toBe(3) // a private key where the public one goes
    expect(go(['key', 'rotate']).err).toMatch(/the verbs are `verify key register` and `verify key revoke`/)
  })
})

describe('canaries: verify canary seal | reveal', () => {
  it('seals known-bad items (the book shows only a commitment; the secret file holds the ids and salt), then the sealer reveals them', () => {
    const b = drawBook()
    const ids = PASSES.slice(0, 2).map(v => v.verdict_id)
    const secret = join(b.d, 'canary-secret.json')
    const seal = go(['canary', 'seal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--workflow', EWF, '--verdicts', ids.join(','), '--secret-out', secret, '--trusted-keys', b.trusted, '--signed-at', '2026-09-02T09:10:00Z'])
    expect(seal.code, seal.err).toBe(0)
    expect(seal.json().appended.signed.decision.kind).toBe('CANARY_SEAL')
    for (const id of ids) {
      expect(seal.out).not.toContain(id)
      expect(readFileSync(b.chain, 'utf8')).not.toContain(`"${id}"]`) // no canary id in the seal
    }
    const s = JSON.parse(readFileSync(secret, 'utf8'))
    expect(s).toMatchObject({ workflow_id: EWF, verdict_ids: [...ids].sort() })
    expect(s.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(seal.err).toMatch(/KEEP IT SECRET until the reveal/)
    // never over the secret: the old seal could never be revealed
    expect(go(['canary', 'seal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--workflow', EWF, '--verdicts', ids[0]!, '--secret-out', secret, '--trusted-keys', b.trusted]).code).toBe(1)
    // only the sealer reveals
    expect(go(['canary', 'reveal', '--ledger', b.chain, '--key', b.lead, '--signer', 'ap-lead', '--secret', secret, '--trusted-keys', b.trusted]).err).toMatch(/the seal was made by 'author': only its sealer reveals it/)
    const reveal = go(['canary', 'reveal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--secret', secret, '--trusted-keys', b.trusted, '--signed-at', '2026-09-03T09:00:00Z'])
    expect(reveal.code, reveal.err).toBe(0)
    expect(reveal.json().appended.signed.decision).toMatchObject({ kind: 'CANARY_REVEAL', verdict_ids: [...ids].sort() })
    expect(go(['canary', 'reveal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--secret', secret, '--trusted-keys', b.trusted]).code).toBe(1) // once per seal
  })

  it('a refused seal leaves no secret behind; usage errors', () => {
    const b = drawBook()
    const secret = join(b.d, 's.json')
    const refused = go(['canary', 'seal', '--ledger', b.chain, '--key', b.agent, '--signer', 'author', '--workflow', EWF, '--verdicts', PASSES[0]!.verdict_id, '--secret-out', secret, '--trusted-keys', b.trusted])
    expect(refused.code).toBe(1)
    expect(existsSync(secret)).toBe(false)
    expect(go(['canary', 'seal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--workflow', EWF, '--secret-out', secret]).err).toMatch(/needs --verdicts/)
    expect(go(['canary', 'reveal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--secret', secret, '--workflow', EWF]).err).toMatch(/--workflow belongs to canary seal/)
    expect(go(['canary', 'peek']).code).toBe(3)
  })
})

describe('verify policy lint: errors AND warnings', () => {
  it('a clean policy exits 0; an unreachable bar warns (exit 0); an error exits 1', () => {
    const d = scratch()
    const okLint = go(['policy', 'lint', '--policy', put(d, 'p.json', EXAMPLE_PROMOTION_POLICY)])
    expect(okLint.code).toBe(0)
    expect(okLint.json()).toEqual(JSON.parse(JSON.stringify(lintPolicy(EXAMPLE_PROMOTION_POLICY))))
    const warned = { ...TINY, method: 'clopper-pearson' as const }
    const w = go(['policy', 'lint', '--policy', put(d, 'w.json', warned)])
    expect(w.code).toBe(lintPolicy(warned).ok ? 0 : 1)
    expect((lintPolicy(warned).warnings ?? []).length).toBeGreaterThan(0)
    expect(w.err).toMatch(/verify policy lint: warning: /)
    const bad = go(['policy', 'lint', '--policy', put(d, 'bad.json', { ...TINY, method: 'vibes' })])
    expect(bad.code).toBe(1)
    expect(bad.err).toMatch(/verify policy lint: error: method must be/)
    expect(go(['policy', '--policy', put(d, 'x.json', TINY)]).err).toMatch(/the verb is `verify policy lint`/)
    expect(go(['policy', 'lint']).code).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const P = EXAMPLE_PROMOTION_POLICY
const MISSES = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2, prefix: 'c2miss' })
const BASE = buildLedger({ passes: 130, fails: 60, failOverturned: 2, prefix: 'c2base' })
function bigBook(text: string): { d: string; chain: string; policy: string; trusted: string; owner: string } {
  const d = scratch()
  return { d, chain: put(d, 'chain.jsonl', text), policy: put(d, 'p.json', P), trusted: put(d, 't.json', { owner: OWNER.publicKeyPem }), owner: put(d, 'k.pem', OWNER.privateKeyPem) }
}
const grantP = (b: ReturnType<typeof bigBook>, level: string, extra: string[] = []): string[] =>
  ['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--workflow', WF(), '--level', level, '--tier', 'low', '--policy', b.policy, '--trusted-keys', b.trusted, '--signed-at', '2026-09-28T09:40:00Z', ...extra]
const voiceP = (b: ReturnType<typeof bigBook>): string[] => ['voice', '--from-book', '--ledger', b.chain, '--policy', b.policy, '--workflow', WF(), '--trusted-keys', b.trusted]

describe('verify decline through declineOnBook (C6/N4 closed), in the product\'s own words (D-DECLINED-COPY)', () => {
  it('a kept demotion: "Kept at <rung> by <person>, <date>; stands until …", on decline and on every later read', () => {
    const b = bigBook(MISSES.ledger.chainJSONL())
    expect(go(grantP(b, 'autonomy', ['--bounds', 'all'])).code).toBe(0)
    const v = go(voiceP(b))
    expect(v.code).toBe(2)
    const proposal = v.json().assessment.proposal
    const d = go(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--policy', b.policy, '--workflow', WF(), '--proposal', proposal.proposal_id,
      '--reason', 'one vendor, since fixed', '--signed-at', '2026-09-28T09:50:00Z', '--trusted-keys', b.trusted])
    expect(d.code, d.err).toBe(0)
    expect(d.json().appended.signed.decision).toMatchObject({ kind: 'DECLINE', proposal_id: proposal.proposal_id, from: 'autonomy', to: 'gate' })
    expect(d.err).toMatch(/verify decline: Kept at autonomy by owner, 2026-09-28T09:50:00Z; stands until a new failing case/)
    const later = go(voiceP(b))
    expect(later.code).toBe(0)
    expect(later.err).toMatch(/verify voice: Kept at autonomy by owner, 2026-09-28T09:50:00Z; stands until /)
  })

  it('a declined promotion: "Not now: <person>, <date>; re-raises when …"', () => {
    const b = bigBook(BASE.ledger.chainJSONL())
    expect(go(grantP(b, 'gate')).code).toBe(0)
    const v = go(voiceP(b))
    const proposal = v.json().assessment.proposal
    expect(proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy' })
    const d = go(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--policy', b.policy, '--assessment', put(b.d, 'v.json', v.out),
      '--reason', 'not before the audit', '--signed-at', '2026-09-28T09:55:00Z', '--trusted-keys', b.trusted])
    expect(d.code, d.err).toBe(0)
    expect(d.err).toMatch(/verify decline: Not now: owner, 2026-09-28T09:55:00Z; re-raises when /)
  })

  it('a forger\'s re-hashed assessment never becomes the signed decline: the book\'s proposal is what is signed', () => {
    const b = bigBook(MISSES.ledger.chainJSONL())
    go(grantP(b, 'autonomy', ['--bounds', 'all']))
    const v = go(voiceP(b)).json()
    // doctor it (drop five failing cases) and re-hash it, as anyone can: the hash check alone would pass it
    const a = structuredClone(v.assessment)
    a.proposal.failing_cases = a.proposal.failing_cases.slice(0, 1)
    const { assessment_hash: _h, ...body } = a
    a.assessment_hash = hashOf(body)
    const d = go(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--policy', b.policy, '--assessment', put(b.d, 'forged.json', { assessment: a }),
      '--reason', 'r', '--signed-at', '2026-09-28T09:50:00Z', '--trusted-keys', b.trusted])
    expect(d.code, d.err).toBe(0)
    expect(d.json().appended.signed.decision.seen.failing_cases).toHaveLength(6) // what the book shows, not the forger's one
    // a proposal id the book does not raise is refused, with the book byte-identical
    const before = readFileSync(b.chain, 'utf8')
    const r = go(['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--policy', b.policy, '--workflow', WF(), '--proposal', '0'.repeat(32), '--reason', 'r', '--trusted-keys', b.trusted])
    expect(r.code).toBe(1)
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
  })

  it('usage: --policy is required; the proposal is named once', () => {
    const b = bigBook(MISSES.ledger.chainJSONL())
    const common = ['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--reason', 'r']
    expect(go([...common, '--workflow', WF(), '--proposal', 'x']).err).toMatch(/needs --policy/)
    expect(go([...common, '--policy', b.policy, '--workflow', WF(), '--proposal', 'x', '--assessment', b.policy]).err).toMatch(/name the proposal once/)
    expect(go([...common, '--policy', b.policy, '--workflow', WF()]).err).toMatch(/--workflow <id> --proposal <proposal_id>/)
  })
})

describe('verify grant through grantUnderPolicy: a tier\'s max_rung is honored', () => {
  it('a tier that caps at gate refuses autonomy (exit 1, the book byte-identical)', () => {
    const b = bigBook(BASE.ledger.chainJSONL())
    const policy = put(b.d, 'research.json', RESEARCH_PROMOTION_POLICY)
    const capped = RESEARCH_PROMOTION_POLICY.tiers.find(t => t.max_rung === 'gate')!
    const before = readFileSync(b.chain, 'utf8')
    const r = go(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--workflow', WF(), '--level', 'autonomy', '--bounds', 'all', '--tier', capped.tier, '--policy', policy, '--trusted-keys', b.trusted])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(new RegExp(`REFUSED: tier '${capped.tier}' caps the grantable rung at gate`))
    expect(readFileSync(b.chain, 'utf8')).toBe(before)
    expect(go(['grant', '--ledger', b.chain, '--key', b.owner, '--signer', 'owner', '--workflow', WF(), '--level', 'gate', '--tier', capped.tier, '--policy', policy, '--trusted-keys', b.trusted]).code).toBe(0)
    expect(policyRef(RESEARCH_PROMOTION_POLICY).policy_id).toBe(RESEARCH_PROMOTION_POLICY.policy_id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('nothing throws out of run(), and hostile input never reaches the book (the new verbs)', () => {
  it('every new verb × junk inputs: a code in {0,1,2,3}, never a throw, the book unchanged', () => {
    const b = drawBook()
    const original = readFileSync(b.chain, 'utf8')
    const junk = [put(b.d, 'null.json', 'null'), put(b.d, 'arr.json', '[]'), put(b.d, 'num.json', '5'), put(b.d, 'bad.json', '{not json'), put(b.d, 'empty.json', ''), b.d]
    const argvs: string[][] = []
    for (const j of junk) {
      argvs.push(
        ['replay', j], ['replay', j, '--inputs', j], ['replay', j, '--extraction', j], ['replay', j, '--tolerance', j], ['replay', j, '--document', j],
        ['opinion', '--from-book', '--ledger', j, '--policy', j, '--workflow', 'w'], ['opinion', '--from-book', '--ledger', b.chain, '--policy', j, '--workflow', EWF, '--root-keys', j],
        ['rule', '--ledger', j, '--dispute', 'x', '--ruling', 'STANDS', '--reason', 'r', '--key', j, '--signer', 's'],
        ['rule', '--ledger', b.chain, '--dispute', 'x', '--ruling', 'STANDS', '--reason', 'r', '--key', j, '--signer', 's', '--inputs', j],
        ['statute', '--ledger', b.chain, '--rulings', j, '--rule', 'R', '--domain', 'd'], ['statute', '--ledger', j, '--rulings', j, '--rule', 'R', '--domain', 'd', '--inputs', j],
        ['sample', 'commit', '--ledger', b.chain, '--policy', j, '--workflow', EWF], ['sample', 'commit', '--ledger', j, '--policy', b.policy, '--workflow', EWF, '--tier', 'low'],
        ['queue', '--ledger', b.chain, '--policy', j, '--workflow', EWF], ['queue', '--ledger', j, '--policy', b.policy, '--workflow', EWF, '--root-keys', j],
        ['review', '--sign', '--ledger', b.chain, '--key', j, '--signer', 's', '--verdict', 'v', '--decision', 'UPHELD'],
        ['key', 'register', '--ledger', b.chain, '--root', j, '--subject', 's', '--public-key', j, '--roles', 'reviewer'],
        ['key', 'revoke', '--ledger', b.chain, '--key', j, '--signer', 's', '--root-keys', j, '--subject', 's', '--public-key', j, '--reason', 'r'],
        ['canary', 'seal', '--ledger', b.chain, '--key', j, '--signer', 's', '--workflow', EWF, '--verdicts', j, '--secret-out', join(b.d, 'never.json')],
        ['canary', 'reveal', '--ledger', b.chain, '--key', b.author, '--signer', 'author', '--secret', j],
        ['policy', 'lint', '--policy', j],
        ['decline', '--ledger', b.chain, '--key', b.owner, '--signer', 's', '--policy', j, '--workflow', EWF, '--proposal', 'p', '--reason', 'r'],
        ['twin', '--html', j, '--period-end', '2024-12-31', '--claims', j, '--ruleset', '0.2', '--pre', j],
        ['mine', j, '--schema', j, '--ruleset-out', join(b.d, 'never-mined.json')],
      )
    }
    for (const argv of argvs) {
      let code: number | undefined
      expect(() => { code = run(argv, cap()) }, argv.join(' ')).not.toThrow()
      expect([0, 1, 2, 3], argv.join(' ')).toContain(code)
    }
    expect(readFileSync(b.chain, 'utf8')).toBe(original)
    expect(existsSync(join(b.d, 'never.json'))).toBe(false)
  })
})
