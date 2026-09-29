/**
 * CLI-3 (2026-09-29): `verify succession` (RULESET_SUCCESSION at the command line: the replay printed before signing,
 * --dry-run, --check, and every refusal leaving the book byte-identical), reconciliation under a governing policy
 * (`verify reconcile --policy`, POST /v1/reconcile), and the read-only succession surface (POST /v1/succession/replay, MCP
 * succession_replay).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { run, type CliIO } from '../src/cli'
import { verify, type Verdict } from '../src/index'
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { createLedger, MemoryLedger, parseChainJSONL, type Ledger } from '../src/ledger/index'
import {
  makeCosign, makeGrant, makeKeyRegister, signDecision, grantInForce,
  type BookDecision, type DecisionEntry, type GrantDecision,
} from '../src/ledger/decisions'
import { successionReplay, successionGrant } from '../src/ledger/succession'
import { grantUnderPolicy, policyRef, EXAMPLE_PROMOTION_POLICY, type PromotionPolicy, type TierRequirements } from '../src/verdict/voice'
import { route } from '../src/http/router'
import { createService, apiKeyAuth } from '../src/http/service'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { MAPPING, TRUSTED, OWNER, csvOf, failInvoice } from './fixtures/reconcile/scenario'
import { clean, roundingDrift, FIXED_NOW } from './fixtures/invoices'

// ── keys, policies, the book ─────────────────────────────────────────────────────────────────────────────────────────
function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('c1'.repeat(32))
const ALICE = keyFromSeed('c2'.repeat(32))
const BOB = keyFromSeed('c3'.repeat(32))
const CAROL = keyFromSeed('c4'.repeat(32)) // a reviewer, not a grant signer
const MALLORY = keyFromSeed('c6'.repeat(32)) // registered to no one

let clock = 0
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()
const AT = '2026-09-29T04:30:00.000Z'

const FROM = 'acme/invoice@0.0.1'
const TO = 'acme/invoice@0.1.0'
const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
const HIGH: TierRequirements = { tier: 'high', description: 'test tier', confidence: 0.9, ...bars }
const ONE: PromotionPolicy = { policy_version: 'promotion-policy-v0', policy_id: 'cli-3-test', version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [HIGH] }
const DUAL: PromotionPolicy = { ...ONE, version: '2.0.0', tiers: [{ ...HIGH, grant_signatures: 2 }] }

type J = Record<string, unknown>
type Book = { led: Ledger; inputs: Map<string, unknown> }
const inputsOf = (x: J) => ({ extraction: x, references: { contract: null, evidence: [], history: [] }, source: null })
const old = (x: J): Verdict => verify(x, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
const cur = (x: J): Verdict => verify(x, { now: FIXED_NOW })
const numbered = (base: J, n: string): J => ({ ...structuredClone(base), invoice_number: n })
const taxNa = (n: string): J => { const x = numbered(clean, n); (x.totals as J).tax = 'n/a'; return x }

/** A registry book: alice and bob sign grants for acme; carol only reviews. */
function registryBook(): Book {
  clock = Date.parse('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
  const reg = (id: string, k: { pub: string }, roles: ('grant_signer' | 'reviewer')[]): void => {
    led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.pub, roles, signer_id: 'root', signed_at: iso() }), ROOT.priv))
  }
  reg('alice', ALICE, ['grant_signer'])
  reg('bob', BOB, ['grant_signer'])
  reg('carol', CAROL, ['reviewer'])
  return { led, inputs: new Map() }
}
function recordOld(b: Book, x: J, review: 'UPHELD' | 'OVERTURNED' = 'UPHELD'): Verdict {
  const v = old(x)
  b.led.record(v, { tenant_id: 'acme' })
  b.inputs.set(v.verdict_id, inputsOf(x))
  b.led.review(v.verdict_id, { reviewer_id: 'carol', decision: review }, { tenant_id: 'acme' })
  return v
}
const grantOn = (led: Ledger, d: GrantDecision, key: string): DecisionEntry<GrantDecision> => led.decide(signDecision(d, key)) as DecisionEntry<GrantDecision>
const gateOn = (b: Book, policy = ONE): DecisionEntry<GrantDecision> =>
  grantOn(b.led, grantUnderPolicy(policy, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
const replayOf = (b: Book) => successionReplay(b.led, FROM, TO, { inputs: v => b.inputs.get(v.verdict_id) })

// ── files and IO ─────────────────────────────────────────────────────────────────────────────────────────────────────
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'verify-cli-3-'))
  dirs.push(d)
  return d
}
function put(dir: string, name: string, content: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}
function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let o = '', e = ''
  const io: CliIO = { out: s => { o += s }, err: s => { e += s } }
  const code = run(argv, io)
  return { code, out: o, err: e, json: () => JSON.parse(o) }
}
const inputsJsonl = (m: Map<string, unknown>): string => [...m].map(([verdict_id, inputs]) => JSON.stringify({ verdict_id, inputs })).join('\n') + '\n'

/** The book, keys, policy and inputs on disk, and the succession's arguments. */
function files(b: Book, policy = ONE) {
  const d = scratch()
  const book = put(d, 'book.jsonl', b.led.chainJSONL())
  const f = {
    d, book,
    root: put(d, 'root.pub.pem', ROOT.pub),
    alice: put(d, 'alice.pem', ALICE.priv), bob: put(d, 'bob.pem', BOB.priv), carol: put(d, 'carol.pem', CAROL.priv), mallory: put(d, 'mallory.pem', MALLORY.priv),
    policy: put(d, 'policy.json', policy),
    inputs: put(d, 'inputs.jsonl', inputsJsonl(b.inputs)),
    bytes: () => readFileSync(book),
  }
  const args = (o: { signer?: string; key?: string } = {}): string[] => [
    'succession', '--ledger', book, '--from', FROM, '--to', TO, '--inputs', f.inputs, '--reason', 'invoice 0.1.0 only tightens; carry the rung',
    '--signer', o.signer ?? 'alice', ...(o.key ? ['--key', o.key] : []), '--policy', f.policy, '--root-keys', f.root, '--signed-at', AT,
  ]
  return { ...f, args }
}
const reread = (path: string): MemoryLedger => new MemoryLedger({ seed: parseChainJSONL(readFileSync(path, 'utf8')), root_keys: [ROOT.pub] })
const governed = (p: PromotionPolicy) => ({ policies: [p], governing_policy: p })

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verify succession: the replay is printed before anything is signed', () => {
  it('--dry-run prints the replay and the GRANT it would sign (the library\'s, exactly) and appends nothing', () => {
    const b = registryBook()
    for (let i = 0; i < 10; i++) recordOld(b, numbered(clean, `C3-D${i}`))
    const g = gateOn(b)
    const f = files(b)
    const before = f.bytes()
    const dry = go([...f.args(), '--dry-run'])
    expect(dry.code, dry.err).toBe(0)
    const r = replayOf(b)
    const j = dry.json()
    expect(j).toMatchObject({ dry_run: true, carries: { decision_id: g.decision_id, workflow_id: FROM, level: 'gate', seq: g.seq }, door: 'not asked (no --key)' })
    expect(j.replay).toEqual(r.replay)
    expect(j.not_reperformed).toEqual([])
    expect(j.grant).toEqual(successionGrant({ from: g, to: TO, replay: r.replay, reason: 'invoice 0.1.0 only tightens; carry the rung', signer_id: 'alice', signed_at: AT }, ONE))
    expect(dry.err).toContain(`replay under ${TO}: 10 verdict(s) recorded under ${FROM}, 10 re-performed, 0 changed`)
    expect(dry.err).toMatch(/dry run: nothing is signed or appended/)
    // With the key, the door is asked on a copy: it would take it. Still nothing appended.
    const keyed = go([...f.args({ key: f.alice }), '--dry-run'])
    expect(keyed.code, keyed.err).toBe(0)
    expect(keyed.json().door).toBe('takes it')
    expect(f.bytes().equals(before)).toBe(true)
  })

  it('signs it through the door: in force on the new workflow, said; --check re-performs it, and names a difference', () => {
    const b = registryBook()
    for (let i = 0; i < 10; i++) recordOld(b, numbered(clean, `C3-S${i}`))
    const g = gateOn(b)
    const f = files(b)
    const res = go(f.args({ key: f.alice }))
    expect(res.code, res.err).toBe(0)
    const j = res.json()
    expect(j).toMatchObject({ anchored: true, in_force: true, appended: { signed: { decision: { kind: 'GRANT', workflow_id: TO, level: 'gate', succeeds: { from: FROM, grant: g.decision_id } } } } })
    const id = j.appended.decision_id as string
    const led = reread(f.book)
    expect(grantInForce(led.decisionBook().decisions, TO, governed(ONE))?.decision_id).toBe(id)
    expect(grantInForce(led.decisionBook().decisions, FROM, governed(ONE))?.decision_id).toBe(g.decision_id) // the old workflow keeps its grant
    expect(res.err).toContain(`carries ${FROM}'s grant`)
    // Anyone holding the documents re-performs what alice signed.
    const ok = go(['succession', '--check', id.slice(0, 16), '--ledger', f.book, '--inputs', f.inputs])
    expect(ok.code, ok.err).toBe(0)
    expect(ok.json()).toMatchObject({ decision_id: id, ok: true, differences: [], book: { matches: true } })
    expect(ok.err).toMatch(/OK: this build re-performs the replay alice signed, byte for byte/)
    // Without one verdict's documents, the re-performance differs, and says how.
    const fewer = new Map([...b.inputs].slice(1))
    const short = go(['succession', '--check', id, '--ledger', f.book, '--inputs', put(f.d, 'fewer.jsonl', inputsJsonl(fewer))])
    expect(short.code).toBe(1)
    expect(short.err).toMatch(/DIFFERS from the replay alice signed/)
    expect(short.err).toContain('reperformed: signed 10, re-performed 9')
    // --check signs nothing: the signing flags are usage errors; a grant with no succession has no replay to check.
    expect(go(['succession', '--check', id, '--ledger', f.book, '--inputs', f.inputs, '--from', FROM]).code).toBe(3)
    const plain = go(['succession', '--check', g.decision_id, '--ledger', f.book, '--inputs', f.inputs])
    expect(plain.code).toBe(1)
    expect(plain.err).toMatch(/carries no succession/)
  })

  it('a ruleset that flips outcomes: every change is listed with its direction; a loosening is refused without its reason', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `C3-F${i}`))
    const drift = [recordOld(b, numbered(roundingDrift, 'C3-D1')), recordOld(b, numbered(roundingDrift, 'C3-D2'))]
    const na = recordOld(b, taxNa('C3-NA'))
    const kept = recordOld(b, numbered(clean, 'C3-NOINPUT'))
    b.inputs.delete(kept.verdict_id) // the customer no longer holds this one's documents
    gateOn(b)
    expect(cur(numbered(roundingDrift, 'x')).outcome).toBe('FAIL')
    const f = files(b)
    const before = f.bytes()
    const dry = go([...f.args(), '--dry-run'])
    expect(dry.code).toBe(1) // the real run would be refused: a dry run says so
    expect(dry.err).toContain('7 verdict(s) recorded under acme/invoice@0.0.1, 6 re-performed, 3 changed (FAIL→PASS 1, PASS→FAIL 2); 1 not re-performed')
    for (const v of drift) expect(dry.err).toContain(`PASS→FAIL ${v.verdict_id}\n`)
    expect(dry.err).toContain(`FAIL→PASS ${na.verdict_id} (loosens)`)
    expect(dry.err).toContain(`not re-performed ${kept.verdict_id}: no inputs supplied`)
    expect(dry.err).toMatch(/REFUSED: .*loosens/)
    expect(go(f.args({ key: f.alice })).code).toBe(1)
    expect(f.bytes().equals(before)).toBe(true)
    const signed = go([...f.args({ key: f.alice }), '--loosening-reason', 'a junk tax is not a failed total; a person reviews every held item at gate'])
    expect(signed.code, signed.err).toBe(0)
    expect(signed.json().not_reperformed).toEqual([{ verdict_id: kept.verdict_id, reason: 'no inputs supplied' }])
    expect(signed.err).toMatch(/3 changed \(FAIL→PASS 1, PASS→FAIL 2\); 1 not re-performed .*; it loosens 1, accepted by alice: a junk tax/)
  })
})

describe('verify succession: every refusal leaves the book byte-identical', () => {
  it('unanchored or unauthorized signers, nothing to carry, a replay of nothing, another ruleset, usage', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `C3-R${i}`))
    gateOn(b)
    const f = files(b)
    const before = f.bytes()
    const refusedWith = (argv: string[], re: RegExp): void => {
      const r = go(argv)
      expect(r.code, r.err).toBe(1)
      expect(r.err).toMatch(re)
    }
    refusedWith(f.args({ signer: 'mallory', key: f.mallory }), /REFUSED/) // a key registered to no one
    refusedWith(f.args({ signer: 'carol', key: f.carol }), /grant_signer/) // a reviewer's key
    refusedWith(f.args({ signer: 'alice', key: f.bob }), /REFUSED/) // alice's name, bob's key
    const with_ = (flag: string, value: string): string[] => { const a = f.args({ key: f.alice }); a[a.indexOf(flag) + 1] = value; return a }
    refusedWith(with_('--from', 'acme/invoice@0.0.0'), /nothing is granted on acme\/invoice@0\.0\.0/)
    // Inputs that are not the verdicts' own: nothing binds, so nothing is re-performed.
    const wrong = new Map([...b.inputs].map(([id], i) => [id, inputsOf(numbered(clean, `OTHER-${i}`))]))
    refusedWith(with_('--inputs', put(f.d, 'wrong.jsonl', inputsJsonl(wrong))), /re-performed none of the 3 verdict\(s\)/)
    // A version this build does not hold (and no --ruleset): each verdict says why; a replay of nothing is refused.
    const unheld = go(with_('--to', 'acme/invoice@9.9.9'))
    expect(unheld.code).toBe(1)
    expect(unheld.err).toContain('this build holds no ruleset invoice@9.9.9')
    refusedWith(with_('--to', 'acme/pay-app@0.1.0'), /same ruleset/)
    expect(go(f.args({ key: f.alice }).filter((x, i, a) => x !== '--root-keys' && a[i - 1] !== '--root-keys')).code).toBe(3) // no anchors
    expect(go(f.args()).code).toBe(3) // no --key and no --dry-run
    expect(go([...f.args({ key: f.alice }), '--level', 'max']).code).toBe(3)
    expect(go([...f.args({ key: f.alice }), '--levle', 'gate']).code).toBe(3)
    expect(f.bytes().equals(before)).toBe(true)
  })

  it('D-NO-FLIPFLOP: after a failure step down, the grant it replaced is never carried and the rung is never raised', () => {
    const b = registryBook()
    for (let i = 0; i < 10; i++) recordOld(b, numbered(clean, `C3-P${i}`))
    const up = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    recordOld(b, numbered(clean, 'C3-MISS'), 'OVERTURNED') // a PASS a person overturned: a miss at autonomy
    const down = gateOn(b)
    const f = files(b)
    const before = f.bytes()
    // The person reviewed the autonomy grant; a step down landed since. --grant pins what they reviewed.
    const pinned = go([...f.args({ key: f.alice }), '--grant', up.decision_id.slice(0, 12)])
    expect(pinned.code).toBe(1)
    expect(pinned.err).toMatch(/the grant in force on acme\/invoice@0\.0\.1 is GRANT .* \(gate, seq \d+\), not [0-9a-f]{12}: only the grant in force is carried/)
    const raised = go([...f.args({ key: f.alice }), '--level', 'autonomy'])
    expect(raised.code).toBe(1)
    expect(raised.err).toMatch(/never raises/)
    expect(f.bytes().equals(before)).toBe(true)
    // Carrying the step down itself is lawful: gate goes to the new workflow.
    const ok = go([...f.args({ key: f.alice }), '--grant', down.decision_id.slice(0, 12)])
    expect(ok.code, ok.err).toBe(0)
    expect(ok.json()).toMatchObject({ in_force: true, carries: { decision_id: down.decision_id, level: 'gate' }, appended: { signed: { decision: { level: 'gate' } } } })
  })

  it('D-DUAL carries over: autonomy at a two-signature tier is appended pending, with the co-sign command; a co-sign puts it in force', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `C3-A${i}`))
    const g = grantOn(b.led, grantUnderPolicy(DUAL, { workflow_id: FROM, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    b.led.decide(signDecision<BookDecision>(makeCosign(g, { signer_id: 'bob', signed_at: iso() }), BOB.priv))
    const f = files(b, DUAL)
    const res = go(f.args({ key: f.alice }))
    expect(res.code, res.err).toBe(0)
    expect(res.json()).toMatchObject({ in_force: false, appended: { signed: { decision: { level: 'autonomy', signatures: 2 } } } })
    const id = res.json().appended.decision_id as string
    expect(res.err).toMatch(/pending/)
    expect(res.err).toContain(`verify grant --cosign ${id}`)
    const co = go(['grant', '--cosign', id, '--ledger', f.book, '--key', f.bob, '--signer', 'bob', '--root-keys', f.root, '--policy', f.policy, '--signed-at', AT])
    expect(co.code, co.err).toBe(0)
    expect(co.err).toMatch(/2 of 2 signature\(s\) \(alice, bob\): in force/)
    expect(grantInForce(reread(f.book).decisionBook().decisions, TO, governed(DUAL))?.decision_id).toBe(id)
  })
})

describe('reconciliation under the declared policy (P-S4-C): CLI --policy, POST /v1/reconcile, the managed tier', () => {
  // The declared policy: two signatures on autonomy from 'moderate' up (so it lints: the burden never decreases).
  const GOV: PromotionPolicy = { ...EXAMPLE_PROMOTION_POLICY, version: '9.0.0', tiers: EXAMPLE_PROMOTION_POLICY.tiers.map(t => (t.tier === 'low' ? t : { ...t, grant_signatures: 2 })) }

  it('a single-signed autonomy grant naming a looser policy does not make a hold read as autonomy', () => {
    let now = Date.parse('2026-09-02T09:00:00Z')
    const led = createLedger({ now: () => new Date((now += 1000)), trusted_keys: TRUSTED })
    const grant = (level: 'gate' | 'autonomy') => led.decide(signDecision(makeGrant({
      workflow_id: FROM, level, consequence_tier: 'moderate', policy: policyRef(EXAMPLE_PROMOTION_POLICY), ...(level === 'autonomy' ? { bounds: 'all' } : {}),
      signer_id: 'owner', signed_at: new Date(now).toISOString(),
    }), OWNER.privateKeyPem))
    const gate = grant('gate')
    const auto = grant('autonomy') // one signature: the declared GOV needs two at 'moderate'
    const x = failInvoice('INV-C3', 'V1', 500)
    led.record(old(x), { tenant_id: 'acme' })
    const csv = csvOf([['P-C3', 'V1', 'INV-C3', '510', 'USD', '2026-09-01', '2026-09-05']])
    const d = scratch()
    const argv = ['reconcile', '--ledger', put(d, 'book.jsonl', led.chainJSONL()), '--population', put(d, 'pop.csv', csv), '--mapping', put(d, 'mapping.json', MAPPING),
      '--extractions', put(d, 'x.json', [x]), '--tenant', 'acme', '--trusted-keys', put(d, 'keys.json', TRUSTED)]
    const holdOf = (report: any) => report.exceptions.paid_despite_hold[0]?.hold
    const plain = go(argv)
    expect(plain.code, plain.err).toBe(2)
    expect(holdOf(plain.json())).toMatchObject({ rung: 'autonomy', grant: { decision_id: auto.decision_id } })
    const gov = go([...argv, '--policy', put(d, 'gov.json', GOV)])
    expect(gov.code, gov.err).toBe(2)
    expect(holdOf(gov.json())).toMatchObject({ rung: 'gate', grant: { decision_id: gate.decision_id } })
    expect(go([...argv, '--policy', put(d, 'bad.json', { ...GOV, tiers: 'none' })]).code).toBe(3)
    // Stateless HTTP and MCP: the same report as the CLI, byte for byte, under the same policy.
    const body = { ledger: led.chainJSONL(), population: { format: 'csv', text: csv }, mapping: MAPPING, extractions: [x], tenant_id: 'acme', trusted_keys: TRUSTED, policy: GOV }
    const stateless = route({ method: 'POST', path: '/v1/reconcile', body })
    expect(stateless.status).toBe(200)
    expect((stateless.json as { report: unknown }).report).toEqual(gov.json())
    const mcp = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reconcile_completeness', arguments: { ...body, format: 'json' } } } as JsonRpcRequest)
    expect(holdOf((mcp!.result as { structuredContent: unknown }).structuredContent)).toMatchObject({ rung: 'gate' })
    // The managed tier reads under its own declared policy (voice.policy), and a request never substitutes one.
    const svc = (policy?: PromotionPolicy) => createService({ ledger: led, authenticate: apiKeyAuth({ ka: 'acme' }), ...(policy ? { voice: { policy } } : {}) })
    const hosted = (s: ReturnType<typeof svc>, extra: J = {}) => s.handle({ method: 'POST', path: '/v1/reconcile', headers: { 'x-api-key': 'ka' }, body: { population: { format: 'csv', text: csv }, mapping: MAPPING, extractions: [x], ...extra } })
    const managed = hosted(svc(GOV))
    expect(managed.status).toBe(200)
    expect(holdOf((managed.json as { report: unknown }).report)).toMatchObject({ rung: 'gate', grant: { decision_id: gate.decision_id } })
    expect(holdOf((hosted(svc()).json as { report: unknown }).report)).toMatchObject({ rung: 'autonomy' })
    const substituted = hosted(svc(GOV), { policy: EXAMPLE_PROMOTION_POLICY })
    expect(substituted.status).toBe(400)
    expect(JSON.stringify(substituted.json)).toMatch(/a request never substitutes its own/)
  })
})

describe('POST /v1/succession/replay and MCP succession_replay: read-only, the same replay', () => {
  it('the replay, the unsigned GRANT, and a signed succession re-performed; the MCP tool says the same', () => {
    const b = registryBook()
    for (let i = 0; i < 4; i++) recordOld(b, numbered(clean, `C3-H${i}`))
    const g = gateOn(b)
    const inputs = [...b.inputs].map(([verdict_id, inputs]) => ({ verdict_id, inputs }))
    const base = { ledger: b.led.chainJSONL(), inputs, root_keys: ROOT.pub }
    const r = replayOf(b)
    const res = route({ method: 'POST', path: '/v1/succession/replay', body: { ...base, from: FROM, to: TO, policy: ONE, signer_id: 'alice', reason: 'carry', signed_at: AT } })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    expect(res.json).toMatchObject({ surface_version: 'succession-replay-v0', from: FROM, to: TO, carries: { decision_id: g.decision_id, level: 'gate' }, loosens: 0, replay: r.replay, not_reperformed: [] })
    expect((res.json as { unsigned: unknown }).unsigned).toEqual(successionGrant({ from: g, to: TO, replay: r.replay, reason: 'carry', signer_id: 'alice', signed_at: AT }, ONE))
    const mcp = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'succession_replay', arguments: { ...base, from: FROM, to: TO, policy: ONE, signer_id: 'alice', reason: 'carry', signed_at: AT } } } as JsonRpcRequest)
    expect((mcp!.result as { structuredContent: unknown }).structuredContent).toEqual(res.json)
    // Signed offline and appended: the surface re-performs it.
    const e = grantOn(b.led, (res.json as { unsigned: GrantDecision }).unsigned, ALICE.priv)
    const check = route({ method: 'POST', path: '/v1/succession/replay', body: { ...base, ledger: b.led.chainJSONL(), check: e.decision_id } })
    expect(check.status, JSON.stringify(check.json)).toBe(200)
    expect(check.json).toMatchObject({ from: FROM, to: TO, check: { decision_id: e.decision_id, ok: true, differences: [], book: { matches: true } } })
    // Refusals are 400s: check with the signing fields; a raised rung.
    expect(route({ method: 'POST', path: '/v1/succession/replay', body: { ...base, check: e.decision_id, from: FROM } }).status).toBe(400)
    const raised = route({ method: 'POST', path: '/v1/succession/replay', body: { ...base, from: FROM, to: TO, policy: ONE, signer_id: 'alice', reason: 'carry', level: 'autonomy' } })
    expect(raised.status).toBe(400)
    expect(JSON.stringify(raised.json)).toMatch(/never raises/)
  })
})
