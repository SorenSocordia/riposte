/**
 * SURFACES-4 (2026-09-28): dual authorization at every surface that reads a rung, the second signature at the command line
 * and over MCP, and a tenant-scoped completeness report that names nothing of another tenant.
 *
 * S4-DUAL-GOVERN: a deployment's declared policy governs every GRANT on its book. A grant of autonomy that names another
 * policy (by hash), or a hash nobody holds, or omits its signature count, is still judged against the declared tier's
 * grant_signatures: until a second anchored person co-signs it, it is PENDING, has no effect on the rung (the rung falls back
 * to the grant in force before it), and its notice is returned. The first describe block is the regression: on the code
 * before this change, a hand-built grant naming another policy read as autonomy on POST /v1/action/check.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { verify, type Verdict } from '../src/index'
import { createLedger, type Ledger } from '../src/ledger/index'
import {
  makeGrant, makeCosign, makeKeyRegister, makeKeyRevoke, signDecision, readDecisionBook, grantInForce, governingProblem,
  type BookDecision, type DecisionEntry, type GrantDecision, type SignedDecision,
} from '../src/ledger/decisions'
import { parseChainJSONL } from '../src/ledger/file'
import { grantUnderPolicy, policyRef, type PromotionPolicy, type TierRequirements, type VoiceLevel } from '../src/verdict/voice'
import { createService, apiKeyAuth } from '../src/http/service'
import { handleRequest } from '../src/mcp/server'
import { run, type CliIO } from '../src/cli'
import { reconcileCompleteness, readPopulationCSV, type CompletenessReport } from '../src/reconcile/completeness/index'
import { MAPPING, buildScenario } from './fixtures/reconcile/scenario'
import { clean, FIXED_NOW } from './fixtures/invoices'

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('c1'.repeat(32))
const ALICE = keyFromSeed('c2'.repeat(32))
const BOB = keyFromSeed('c3'.repeat(32))
const MALLORY = keyFromSeed('c4'.repeat(32))
const CAROL = keyFromSeed('c5'.repeat(32))
const GLOBEX = keyFromSeed('c6'.repeat(32))

let clock = 0
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()

const PASSES: Verdict[] = Array.from({ length: 12 }, (_, i) => verify({ ...clean, invoice_number: `S4-P${i}` }, { now: FIXED_NOW }))
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`

const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
const HIGH: TierRequirements = { tier: 'high', description: 'test tier', confidence: 0.9, ...bars, grant_signatures: 2 }
const DUAL: PromotionPolicy = { policy_version: 'promotion-policy-v0', policy_id: 'dual-test', version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [HIGH] }
const { grant_signatures: _two, ...HIGH_ONE } = HIGH
/** The same tiers with no second signature: a policy the deployment never declared. */
const LAX: PromotionPolicy = { ...DUAL, version: '0.9.0', tiers: [HIGH_ONE] }

/** A registry book: alice and bob are anchored grant signers; alice holds a gate grant under the declared policy. */
function book(): Ledger {
  clock = Date.parse('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
  for (const [id, k] of [['alice', ALICE], ['bob', BOB]] as const) {
    led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.pub, roles: ['grant_signer'], signer_id: 'root', signed_at: iso() }), ROOT.priv))
  }
  for (const v of PASSES) { led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'carol', decision: 'UPHELD' }) }
  led.decide(signDecision(grantUnderPolicy(DUAL, { workflow_id: WF, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv))
  return led
}
/** A single signer's GRANT of autonomy, hand-built (makeGrant, not grantUnderPolicy): it states no signature count. */
const handGrant = (policy: PromotionPolicy | { policy_id: string; version: string; hash: string }): GrantDecision => makeGrant({
  workflow_id: WF, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso(),
  policy: 'tiers' in policy ? policyRef(policy) : policy,
})
const ACTION = { tool: 'pay', arguments: { amount: 10 } }
const svcOf = (led: Ledger, policy: PromotionPolicy | null = DUAL) =>
  createService({ ledger: led, authenticate: apiKeyAuth({ ka: 'acme', kg: 'globex' }), ...(policy ? { voice: { policy } } : {}) })
const check = (led: Ledger, policy: PromotionPolicy | null = DUAL) =>
  svcOf(led, policy).handle({ method: 'POST', path: '/v1/action/check', body: { workflow_id: WF, action: ACTION }, headers: { 'x-api-key': 'ka' } })
const cosignOf = (g: DecisionEntry<GrantDecision>, signer: string, key: string): SignedDecision<BookDecision> =>
  signDecision<BookDecision>(makeCosign(g, { signer_id: signer, signed_at: iso() }), key)
const lastGrant = (led: Ledger): DecisionEntry<GrantDecision> =>
  led.decisionBook().decisions.filter(e => e.signed.decision.kind === 'GRANT').at(-1) as DecisionEntry<GrantDecision>

describe('S4-DUAL-GOVERN: the action check holds a single-signed autonomy grant pending under the declared policy', () => {
  for (const [name, ref] of [
    ['names the declared policy but states no count', () => DUAL],
    ['names another policy (a laxer one) by hash', () => LAX],
    ['names a policy hash nobody holds', () => ({ policy_id: 'dual-test', version: '1.0.0', hash: '0'.repeat(64) })],
  ] as const) {
    it(`a hand-built grant that ${name} has no effect: the rung stays gate, and the pending grant is named`, () => {
      const led = book()
      const e = led.decide(signDecision(handGrant(ref()), ALICE.priv)) as DecisionEntry<GrantDecision>
      const r = check(led)
      expect(r.status).toBe(200)
      const j = r.json as { level: VoiceLevel; level_source: string; no_effect?: { decision_id: string; pending?: { required: number; signed_by: string[] }; notice: string }[] }
      expect(j.level).toBe('gate')
      expect(j.level_source).toBe('grant')
      const n = j.no_effect?.find(x => x.decision_id === e.decision_id)
      expect(n?.pending).toEqual({ required: 2, signed_by: ['alice'] })
      expect(n?.notice).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures/)
    })
  }
})

describe('D-GOVERNING-POLICY (library): grantInForce({ governing_policy }) judges every grant by the declared policy', () => {
  const read = (led: Ledger) => led.decisionBook()
  it('a grant naming a laxer policy is pending under the governing policy until co-signed; without it the stated count governs', () => {
    const led = book()
    const gate = lastGrant(led)
    const e = led.decide(signDecision(handGrant(LAX), ALICE.priv)) as DecisionEntry<GrantDecision>
    const db = read(led)
    expect(grantInForce(db.decisions, WF)?.decision_id).toBe(e.decision_id) // the pinned boundary: no policy, the stated count
    expect(grantInForce(db.decisions, WF, { policies: [DUAL] })?.decision_id).toBe(e.decision_id) // known by hash: LAX is not DUAL
    expect(grantInForce(db.decisions, WF, { governing_policy: DUAL })?.decision_id).toBe(gate.decision_id)
    expect(governingProblem(e, [...db.decisions, ...db.cosigns], DUAL)).toBe("autonomy at tier 'high' needs 2 signatures under the governing policy dual-test@1.0.0 (dual authorization) and has 1")
    led.decide(cosignOf(e, 'bob', BOB.priv))
    const after = read(led)
    expect(governingProblem(after.decisions.find(x => x.decision_id === e.decision_id) as DecisionEntry<GrantDecision>, [...after.decisions, ...after.cosigns], DUAL)).toBeUndefined()
    expect(grantInForce(after.decisions, WF, { governing_policy: DUAL })?.decision_id).toBe(e.decision_id)
    // The action check says the grant in force names another policy.
    const r = check(led).json as { level: VoiceLevel; notices?: string[] }
    expect(r.level).toBe('autonomy')
    expect(r.notices).toEqual([expect.stringMatching(/is in force: it names policy dual-test@0\.9\.0; it is judged under the governing policy dual-test@1\.0\.0$/)])
  })

  it('a tier the governing policy does not declare, or a rung above its max_rung, has no effect even when fully signed', () => {
    const led = book()
    const gate = lastGrant(led)
    const other = led.decide(signDecision(makeGrant({ workflow_id: WF, level: 'gate', consequence_tier: 'other', policy: policyRef(LAX), signer_id: 'alice', signed_at: iso() }), ALICE.priv)) as DecisionEntry<GrantDecision>
    const db = read(led)
    expect(governingProblem(other, db.decisions, DUAL)).toBe("tier 'other' is not declared in the governing policy dual-test@1.0.0")
    expect(grantInForce(db.decisions, WF, { governing_policy: DUAL })?.decision_id).toBe(gate.decision_id)
    const CAPPED: PromotionPolicy = { ...DUAL, version: '1.1.0', tiers: [{ ...HIGH, max_rung: 'gate' }] }
    const e = led.decide(signDecision(handGrant(DUAL), ALICE.priv)) as DecisionEntry<GrantDecision>
    led.decide(cosignOf(e, 'bob', BOB.priv))
    const after = read(led)
    expect(grantInForce(after.decisions, WF, { governing_policy: DUAL })?.decision_id).toBe(e.decision_id)
    expect(governingProblem(e, after.decisions, CAPPED)).toBe("the governing policy dual-test@1.1.0 caps tier 'high' at gate")
    expect(grantInForce(after.decisions, WF, { governing_policy: CAPPED })?.decision_id).toBe(gate.decision_id)
    // The surface says why it has no effect (not pending: a co-signature cannot fix it), and that it names another policy.
    const j = check(led, CAPPED).json as { level: VoiceLevel; no_effect?: { decision_id: string; pending?: unknown; notice: string }[] }
    expect(j.level).toBe('gate')
    const n = j.no_effect?.find(x => x.decision_id === e.decision_id)
    expect(n?.pending).toBeUndefined()
    expect(n?.notice).toMatch(/has no effect under the governing policy .*caps tier 'high' at gate: it names policy dual-test@1\.0\.0; it is judged under the governing policy dual-test@1\.1\.0$/)
  })
})

describe('S4-DUAL-GOVERN: pending until co-signed, then in force, on every managed surface', () => {
  it('the foreign-policy grant: bob co-signs it through POST /v1/grant/cosign, and the action check reads autonomy', () => {
    const led = book()
    const e = led.decide(signDecision(handGrant(LAX), ALICE.priv)) as DecisionEntry<GrantDecision>
    const svc = svcOf(led)
    const post = (path: string, body: unknown, key = 'ka') => svc.handle({ method: 'POST', path, body, headers: { 'x-api-key': key } })
    // Refused, nothing appended: the grant's own signer (409 at the door), and another tenant's caller (404).
    const before = led.chainJSONL()
    expect(post('/v1/grant/cosign', cosignOf(e, 'alice', ALICE.priv)).status).toBe(409)
    expect(post('/v1/grant/cosign', cosignOf(e, 'bob', BOB.priv), 'kg').status).toBe(404)
    expect(led.chainJSONL()).toBe(before)
    // Bob's signature counts: 2 of 2 under the declared policy, and the grant is in force.
    const ok = post('/v1/grant/cosign', cosignOf(e, 'bob', BOB.priv))
    expect(ok.status).toBe(200)
    const j = ok.json as { grant: { signatures: { required: number; signers: string[]; complete: boolean }; in_force: boolean }; no_effect: unknown[] }
    expect(j.grant.signatures).toMatchObject({ required: 2, signers: ['alice', 'bob'], complete: true })
    expect(j.grant.in_force).toBe(true)
    expect(j.no_effect).toEqual([])
    const r = post('/v1/action/check', { workflow_id: WF, action: ACTION })
    expect((r.json as { level: VoiceLevel }).level).toBe('autonomy')
    expect((r.json as { no_effect?: unknown }).no_effect).toBeUndefined()
  })

  it('without a declared policy the count the grant states governs (the library read, unchanged)', () => {
    const led = book()
    led.decide(signDecision(handGrant(LAX), ALICE.priv))
    expect((check(led, null).json as { level: VoiceLevel }).level).toBe('autonomy')
  })

  it('a grant made through grantUnderPolicy states its count: pending on the action check, GET /v1/voice and the report', () => {
    const led = book()
    const d = grantUnderPolicy(DUAL, { workflow_id: WF, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() })
    expect(d.signatures).toBe(2)
    const e = led.decide(signDecision(d, ALICE.priv))
    const svc = svcOf(led)
    const get = (path: string) => svc.handle({ method: 'GET', path, headers: { 'x-api-key': 'ka' } })
    expect((check(led).json as { level: VoiceLevel }).level).toBe('gate')
    const v = get(`/v1/voice/${encodeURIComponent(WF)}`)
    expect(v.status).toBe(200)
    const vj = v.json as { level: VoiceLevel; no_effect: { decision_id: string; pending?: unknown; notice: string }[] }
    expect(vj.level).toBe('gate')
    expect(vj.no_effect.find(n => n.decision_id === e.decision_id)?.pending).toEqual({ required: 2, signed_by: ['alice'] })
    const md = (get('/v1/ledger/report').json as { markdown: string }).markdown
    expect(md).toMatch(/⚠ GRANT `[0-9a-f]{12}` by alice .* is pending: autonomy at tier 'high' needs 2 signatures/)
  })

  it('GET /v1/voice and GET /v1/queue never read the foreign-policy grant as autonomy', () => {
    const led = book()
    led.decide(signDecision(handGrant(LAX), ALICE.priv))
    const svc = svcOf(led)
    const v = svc.handle({ method: 'GET', path: `/v1/voice/${encodeURIComponent(WF)}`, headers: { 'x-api-key': 'ka' } })
    // Either the rung reads gate with the grant pending, or the read is refused (409): never autonomy.
    if (v.status === 200) expect((v.json as { level: VoiceLevel }).level).toBe('gate')
    else expect(v.status).toBe(409)
    const q = svc.handle({ method: 'GET', path: `/v1/queue/${encodeURIComponent(WF)}`, headers: { 'x-api-key': 'ka' } })
    expect([200, 409]).toContain(q.status)
  })

  // P-S4-R applied (09-28): the report's rung reader passes the governing policy, so a foreign-policy grant no longer reads
  // as autonomy in the rung table.
  it('the report does not read a foreign-policy single-signed grant as autonomy (P-S4-R)', () => {
    const led = book()
    led.decide(signDecision(handGrant(LAX), ALICE.priv))
    const md = (svcOf(led).handle({ method: 'GET', path: '/v1/ledger/report', headers: { 'x-api-key': 'ka' } }).json as { markdown: string }).markdown
    expect(md).not.toMatch(new RegExp(`\\| \`${WF.replace(/[.@/]/g, m => `\\${m}`)}\` \\| autonomy \\|`))
  })
  // The governed no-effect list moved into ledger/ (decisions.ts governedNoEffect, 2026-09-29), and the report's grants block
  // renders it: the report SAYS why the foreign-policy grant is pending (formerly pinned as it.fails).
  it('the report says the foreign-policy grant is pending, with the signature requirement', () => {
    const led = book()
    led.decide(signDecision(handGrant(LAX), ALICE.priv))
    const md = (svcOf(led).handle({ method: 'GET', path: '/v1/ledger/report', headers: { 'x-api-key': 'ka' } }).json as { markdown: string }).markdown
    expect(md).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures/)
  })
})

describe('MCP grant_cosign: the unsigned body to sign, or a signed one through the door on a chain export', () => {
  type ToolReply = { result: { isError: boolean; structuredContent?: any; content: { text: string }[] } }
  const call = (args: Record<string, unknown>) => handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'grant_cosign', arguments: args } }) as unknown as ToolReply

  it('lists the tool; returns the unsigned GRANT_COSIGN; appends a counted one; refuses one that would not count', () => {
    const list = handleRequest({ jsonrpc: '2.0', id: 0, method: 'tools/list' }) as unknown as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map(t => t.name)).toContain('grant_cosign')
    const led = book()
    const e = led.decide(signDecision(handGrant(LAX), ALICE.priv)) as DecisionEntry<GrantDecision>
    const ledger = led.chainJSONL()
    const anchors = { root_keys: [ROOT.pub] }
    const u = call({ ledger, ...anchors, grant: e.decision_id.slice(0, 12), signer_id: 'bob', signed_at: '2026-09-02T09:00:00.000Z', policy: DUAL })
    expect(u.result.isError).toBe(false)
    expect(u.result.structuredContent.unsigned).toEqual(makeCosign(e, { signer_id: 'bob', signed_at: '2026-09-02T09:00:00.000Z' }))
    expect(u.result.structuredContent.grant).toMatchObject({ in_force: false, signatures: { required: 2, complete: false } })
    expect(u.result.structuredContent.no_effect[0].pending).toEqual({ required: 2, signed_by: ['alice'] })
    const signed = signDecision<BookDecision>(u.result.structuredContent.unsigned, BOB.priv)
    const a = call({ ledger, ...anchors, cosign: signed, policy: DUAL })
    expect(a.result.isError, a.result.content[0]!.text).toBe(false)
    expect(a.result.structuredContent.grant).toMatchObject({ in_force: true, signatures: { required: 2, signers: ['alice', 'bob'], complete: true } })
    // The line to append makes a book that verifies, on which the co-signature counts and the grant is stamped with it.
    const c = parseChainJSONL(`${ledger.trimEnd()}\n${a.result.structuredContent.line}\n`)
    const after = readDecisionBook(c.events, c.payloads, anchors)
    expect(after.ok).toBe(true)
    expect(after.cosigns.map(x => x.signed.decision.signer_id)).toEqual(['bob'])
    expect(after.decisions.find(x => x.decision_id === e.decision_id)?.cosigned?.map(x => x.signer_id)).toEqual(['bob'])
    // Refused: the grant's own signer; a grant that is not on the book.
    const own = call({ ledger, ...anchors, cosign: cosignOf(e, 'alice', ALICE.priv) })
    expect(own.result.isError).toBe(true)
    expect(own.result.content[0]!.text).toMatch(/the co-signature is refused/)
    expect(call({ ledger, ...anchors, grant: 'ab'.repeat(8), signer_id: 'bob' }).result.isError).toBe(true)
  })
})

// ── the command line ────────────────────────────────────────────────────────────────────────────────────────────────
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scratch(): string { const d = mkdtempSync(join(tmpdir(), 'verify-surfaces-4-')); dirs.push(d); return d }
function put(dir: string, name: string, content: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let o = '', e = ''
  const io: CliIO = { out: x => { o += x }, err: x => { e += x } }
  const code = run(argv, io)
  return { code, out: o, err: e, json: () => JSON.parse(o) }
}

describe('verify grant --cosign: the second signature at the command line', () => {
  /** A trusted-keys book: alice, bob, and al2 (alice's key under another id); carol has no anchored key. */
  function trustedBook() {
    const d = scratch()
    clock = Date.parse('2026-09-01T09:00:00Z')
    const trusted = { alice: ALICE.pub, bob: BOB.pub, al2: ALICE.pub }
    const led = createLedger({ now: tick, trusted_keys: trusted })
    for (const v of PASSES) led.record(v, { tenant_id: 'acme' })
    return {
      chain: put(d, 'book.jsonl', led.chainJSONL()), policy: put(d, 'policy.json', DUAL), trusted: put(d, 'trusted.json', trusted),
      keys: { alice: put(d, 'alice.pem', ALICE.priv), bob: put(d, 'bob.pem', BOB.priv), carol: put(d, 'carol.pem', CAROL.priv) },
    }
  }
  type B = ReturnType<typeof trustedBook>
  const grantArgs = (b: B) => ['grant', '--ledger', b.chain, '--key', b.keys.alice, '--signer', 'alice', '--workflow', WF, '--level', 'autonomy', '--bounds', 'all', '--tier', 'high', '--policy', b.policy, '--trusted-keys', b.trusted, '--signed-at', '2026-09-02T09:00:00.000Z']
  const cosignArgs = (b: B, id: string, key: string, signer: string) =>
    ['grant', '--cosign', id, '--ledger', b.chain, '--key', key, '--signer', signer, '--policy', b.policy, '--signed-at', '2026-09-02T10:00:00.000Z', '--trusted-keys', b.trusted]

  it('a GRANT at a two-signature tier is pending (said on stderr, with the co-sign command); the second person brings it into force', () => {
    const b = trustedBook()
    const g = go(grantArgs(b))
    expect(g.code, g.err).toBe(0)
    const id = (g.json() as { appended: { decision_id: string } }).appended.decision_id
    expect(g.err).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures/)
    expect(g.err).toContain(`verify grant --cosign ${id}`)
    const c = go(cosignArgs(b, id.slice(0, 12), b.keys.bob, 'bob'))
    expect(c.code, c.err).toBe(0)
    const j = c.json() as { grant: { signatures: { required: number; signers: string[]; complete: boolean }; in_force: boolean } }
    expect(j.grant.signatures).toMatchObject({ required: 2, signers: ['alice', 'bob'], complete: true })
    expect(j.grant.in_force).toBe(true)
    expect(c.err).toMatch(/2 of 2 signature\(s\) \(alice, bob\): in force/)
  })

  it('refuses the same signer id, the same key under another id, and an unanchored co-signer: exit 1, the book byte-identical', () => {
    const b = trustedBook()
    const id = (go(grantArgs(b)).json() as { appended: { decision_id: string } }).appended.decision_id
    const bytes = readFileSync(b.chain)
    for (const [key, signer, why] of [
      [b.keys.alice, 'alice', /REFUSED: this co-signature would not count: alice signed the grant itself/],
      [b.keys.alice, 'al2', /REFUSED: this co-signature would not count: it is signed with the key that signed the grant/],
      [b.keys.carol, 'carol', /REFUSED: signer 'carol' has no anchored key/],
    ] as const) {
      const r = go(cosignArgs(b, id, key, signer))
      expect(r.code, `${signer}: ${r.err}`).toBe(1)
      expect(r.err).toMatch(why)
      expect(readFileSync(b.chain).equals(bytes)).toBe(true)
    }
    // Usage: a co-signature restates only what the grant says.
    expect(go([...cosignArgs(b, id, b.keys.bob, 'bob'), '--level', 'gate']).code).toBe(3)
    expect(readFileSync(b.chain).equals(bytes)).toBe(true)
  })

  it('refuses a revoked co-signer on a registry book (--root-keys): exit 1, the book byte-identical', () => {
    const d = scratch()
    clock = Date.parse('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    for (const [id, k] of [['alice', ALICE], ['mallory', MALLORY]] as const) {
      led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.pub, roles: ['grant_signer'], signer_id: 'root', signed_at: iso() }), ROOT.priv))
    }
    const g = led.decide(signDecision(grantUnderPolicy(DUAL, { workflow_id: WF, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv))
    led.decide(signDecision(makeKeyRevoke({ subject_id: 'mallory', public_key: MALLORY.pub, reason: 'left the company', signer_id: 'root', signed_at: iso() }), ROOT.priv))
    const chain = put(d, 'book.jsonl', led.chainJSONL())
    const bytes = readFileSync(chain)
    const r = go(['grant', '--cosign', g.decision_id, '--ledger', chain, '--key', put(d, 'mallory.pem', MALLORY.priv), '--signer', 'mallory', '--root-keys', put(d, 'root.pub.pem', ROOT.pub), '--signed-at', '2026-09-02T10:00:00.000Z'])
    expect(r.code, r.err).toBe(1)
    expect(r.err).toMatch(/revoked/i)
    expect(readFileSync(chain).equals(bytes)).toBe(true)
  })
})

describe('P-S3-R1: a tenant-scoped completeness report names nothing of another tenant, and the CLI and the hosted slice agree', () => {
  it('on a shared book: CLI --tenant acme and POST /v1/reconcile (acme) are the same report, byte for byte', () => {
    const S = buildScenario()
    clock = Date.parse('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick })
    for (const [name, v] of Object.entries(S.verdicts)) led.record(v, { tenant_id: name === 'X1' ? 'globex' : 'acme' })
    // Each tenant's own GRANT, signed by its own person (unanchored here: both are listed, each only to its own tenant).
    const wf = `${S.verdicts.X1!.ruleset.id}@${S.verdicts.X1!.ruleset.version}`
    led.decide(signDecision(makeGrant({ workflow_id: `acme/${wf}`, level: 'gate', consequence_tier: 'high', policy: policyRef(DUAL), signer_id: 'acme-cfo', signed_at: iso() }), ALICE.priv))
    led.decide(signDecision(makeGrant({ workflow_id: `globex/${wf}`, level: 'gate', consequence_tier: 'high', policy: policyRef(DUAL), signer_id: 'globex-cfo', signed_at: iso() }), GLOBEX.priv))
    const lib = (tenant?: string): CompletenessReport =>
      reconcileCompleteness(readPopulationCSV(S.csv), led, MAPPING, { ...(tenant ? { scope: { tenant_id: tenant } } : {}), extractions: S.extractions })
    // Unscoped, the operator's report is the whole book, as before.
    expect(lib().book.tenants).toEqual(['acme', 'globex'])
    expect(lib().book.unanchored_signers).toEqual(['acme-cfo', 'globex-cfo'])
    const own = lib('acme')
    expect(own.book).toMatchObject({ tenants: ['acme'], unanchored_signers: ['acme-cfo'], out_of_scope: 0 })
    expect(own.book.unanchored_grants.map(g => g.signer_id)).toEqual(['acme-cfo'])
    const d = scratch()
    const cli = go(['reconcile', '--ledger', put(d, 'book.jsonl', led.chainJSONL()), '--population', put(d, 'pop.csv', S.csv), '--mapping', put(d, 'mapping.json', MAPPING), '--extractions', put(d, 'x.json', S.extractions), '--tenant', 'acme'])
    expect([0, 2], cli.err).toContain(cli.code)
    const hosted = svcOf(led, null).handle({
      method: 'POST', path: '/v1/reconcile', headers: { 'x-api-key': 'ka' },
      body: { population: { format: 'csv', base64: Buffer.from(S.csv).toString('base64') }, mapping: MAPPING, extractions: S.extractions },
    })
    expect(hosted.status).toBe(200)
    const h = (hosted.json as { report: CompletenessReport }).report
    expect(cli.json()).toEqual(own)
    expect(h.report_hash).toBe(own.report_hash)
    expect(h).toEqual(own)
    for (const text of [cli.out, JSON.stringify(hosted.json)]) {
      expect(text).not.toContain('globex')
      expect(text).not.toContain(S.verdicts.X1!.verdict_id)
    }
  })
})
