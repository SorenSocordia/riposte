/**
 * GOVERNANCE-3 (2026-09-29): RULESET_SUCCESSION, a governing policy at a chain position (P-S4-C), and the governed no-effect
 * list in the ledger (the report says why a grant the declared policy does not admit is pending).
 *
 * D-RULESET-BUMP: a new ruleset version is a new workflow, and a grant does not carry over by itself. A person carries it with
 * a signed GRANT on the new workflow that names the grant in force on the old one and carries the library's replay of the old
 * workflow's verdicts under the new ruleset. It goes through every door a GRANT does, and has effect only while it carries.
 */
import { describe, it, expect } from 'vitest'
import { createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { verify, type Verdict } from '../src/index'
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { createLedger, type Ledger } from '../src/ledger/index'
import {
  DECISION_SIGNING_PREFIX, DecisionRefused, makeCosign, makeGrant, makeKeyRegister, signDecision, grantInForce, grantAt,
  noEffect, successionNotice, successionProblem, governedNoEffect,
  type BookDecision, type DecisionEntry, type GrantDecision, type SignedDecision,
} from '../src/ledger/decisions'
import { successionReplay, successionGrant, checkSuccessionReplay } from '../src/ledger/succession'
import { canonicalize, hashOf } from '../src/verdict/canonical'
import { assessVoiceFromLedger, grantUnderPolicy, policyRef, EXAMPLE_PROMOTION_POLICY, type PromotionPolicy, type TierRequirements } from '../src/verdict/voice'
import { createService, apiKeyAuth } from '../src/http/service'
import { reconcileCompleteness, readPopulationCSV } from '../src/reconcile/completeness/index'
import { MAPPING, TRUSTED, OWNER, csvOf, failInvoice } from './fixtures/reconcile/scenario'
import { clean, broken, roundingDrift, FIXED_NOW } from './fixtures/invoices'

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('d1'.repeat(32))
const ALICE = keyFromSeed('d2'.repeat(32))
const BOB = keyFromSeed('d3'.repeat(32))
const CAROL = keyFromSeed('d4'.repeat(32)) // a reviewer, not a grant signer
const DAVE = keyFromSeed('d5'.repeat(32)) // a grant signer for globex only
const MALLORY = keyFromSeed('d6'.repeat(32)) // registered to no one

let clock = 0
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()

const FROM = 'acme/invoice@0.0.1'
const TO = 'acme/invoice@0.1.0'
const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
const HIGH: TierRequirements = { tier: 'high', description: 'test tier', confidence: 0.9, ...bars }
const ONE: PromotionPolicy = { policy_version: 'promotion-policy-v0', policy_id: 'succession-test', version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [HIGH] }
const DUAL: PromotionPolicy = { ...ONE, version: '2.0.0', tiers: [{ ...HIGH, grant_signatures: 2 }] }

type J = Record<string, unknown>
const inputsOf = (x: J) => ({ extraction: x, references: { contract: null, evidence: [], history: [] }, source: null })
const old = (x: J): Verdict => verify(x, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
const cur = (x: J): Verdict => verify(x, { now: FIXED_NOW })
const numbered = (base: J, n: string): J => ({ ...structuredClone(base), invoice_number: n })
const taxNa = (n: string): J => { const x = numbered(clean, n); (x.totals as J).tax = 'n/a'; return x }

/** A registry book: alice and bob sign grants for acme; carol only reviews; dave signs for globex only. */
function registryBook(): { led: Ledger; inputs: Map<string, unknown> } {
  clock = Date.parse('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
  const reg = (id: string, k: { pub: string }, roles: ('grant_signer' | 'reviewer')[], tenants?: string[]): void => {
    led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.pub, roles, ...(tenants ? { tenants } : {}), signer_id: 'root', signed_at: iso() }), ROOT.priv))
  }
  reg('alice', ALICE, ['grant_signer'])
  reg('bob', BOB, ['grant_signer'])
  reg('carol', CAROL, ['reviewer'])
  reg('dave', DAVE, ['grant_signer'], ['globex'])
  return { led, inputs: new Map() }
}

/** Record under the old ruleset (and keep the inputs, as a customer's document store does), reviewed UPHELD. */
function recordOld(b: { led: Ledger; inputs: Map<string, unknown> }, x: J, review: 'UPHELD' | 'OVERTURNED' | null = 'UPHELD'): Verdict {
  const v = old(x)
  b.led.record(v, { tenant_id: 'acme' })
  b.inputs.set(v.verdict_id, inputsOf(x))
  if (review) b.led.review(v.verdict_id, { reviewer_id: 'carol', decision: review }, { tenant_id: 'acme' })
  return v
}

const grantOn = (led: Ledger, d: GrantDecision, key: string): DecisionEntry<GrantDecision> => led.decide(signDecision(d, key)) as DecisionEntry<GrantDecision>
const inForce = (led: Ledger, wf: string, policy?: PromotionPolicy) => grantInForce(led.decisionBook().decisions, wf, policy ? { policies: [policy], governing_policy: policy } : {})
const replayOf = (b: { led: Ledger; inputs: Map<string, unknown> }) => successionReplay(b.led, FROM, TO, { inputs: v => b.inputs.get(v.verdict_id) })

/** A signed body that never went through signDecision (so its own shape check never ran): the door must still refuse it. */
function signRaw(d: J, priv: string): SignedDecision<BookDecision> {
  const body = JSON.parse(canonicalize(d)) as BookDecision
  const key = createPrivateKey(priv)
  return {
    decision: body, alg: 'ed25519', public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    signature: edSign(null, Buffer.from(DECISION_SIGNING_PREFIX + canonicalize(body), 'utf8'), key).toString('base64'), decision_id: hashOf(body).slice(0, 32),
  }
}

describe('RULESET_SUCCESSION: a person carries a grant to a new ruleset version', () => {
  it('carry-forward: the new workflow starts at record, and a signed succession carries the grant, with its replay', () => {
    const b = registryBook()
    for (let i = 0; i < 10; i++) recordOld(b, numbered(clean, `G3-C${i}`))
    const g = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    // D-RULESET-BUMP: nothing carries by itself.
    expect(inForce(b.led, TO)).toBeUndefined()
    const r = replayOf(b)
    expect(r.replay).toMatchObject({ replay_version: 'succession-replay-v0', recorded: 10, reperformed: 10, changed: [] })
    expect(r.replay.through).toBe(b.led.snapshot().events.length)
    expect(r.not_reperformed).toEqual([])
    // Deterministic: the same book and inputs, the same replay.
    expect(hashOf(replayOf(b).replay)).toBe(hashOf(r.replay))
    const d = successionGrant({ from: g, to: TO, replay: r.replay, reason: 'invoice 0.1.0 only tightens; carry gate', signer_id: 'alice', signed_at: iso() }, ONE)
    expect(d).toMatchObject({ kind: 'GRANT', workflow_id: TO, level: 'gate', consequence_tier: 'high', succeeds: { from: FROM, grant: g.decision_id } })
    const e = grantOn(b.led, d, ALICE.priv)
    const db = b.led.decisionBook()
    const carried = grantInForce(db.decisions, TO)!
    expect(carried.decision_id).toBe(e.decision_id)
    expect(carried.replay).toEqual({ matches: true })
    expect(successionProblem(carried, db.decisions)).toBeUndefined()
    expect(inForce(b.led, TO, ONE)?.decision_id).toBe(e.decision_id) // under the governing policy too
    expect(inForce(b.led, FROM)?.decision_id).toBe(g.decision_id) // the old workflow keeps its own grant
    expect(noEffect(db, { workflow_id: TO })).toEqual([])
    expect(successionNotice(carried)).toMatch(new RegExp(`carries ${FROM.replace(/[.@/]/g, m => `\\${m}`)}'s grant .* to acme/invoice@0\\.1\\.0 at gate: the 10 verdict\\(s\\) recorded under .* were replayed under the new ruleset, 10 re-performed, 0 changed$`))
    // Anyone holding the documents re-performs what the signer was shown.
    expect(checkSuccessionReplay(b.led, carried, { inputs: v => b.inputs.get(v.verdict_id) })).toMatchObject({ ok: true, differences: [] })
    // The report says what the grant carries.
    const svc = createService({ ledger: b.led, authenticate: apiKeyAuth({ ka: 'acme' }), voice: { policy: ONE } })
    const md = (svc.handle({ method: 'GET', path: '/v1/ledger/report', headers: { 'x-api-key': 'ka' } }).json as { markdown: string }).markdown
    expect(md).toContain(`carries ${FROM}'s grant`)
  })

  it('refuses an unanchored or unauthorized signer; an unanchored book lists it with no effect', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `G3-U${i}`))
    const g = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const r = replayOf(b).replay
    const by = (signer_id: string) => successionGrant({ from: g, to: TO, replay: r, reason: 'carry', signer_id, signed_at: iso() }, ONE)
    const before = b.led.chainJSONL()
    expect(() => b.led.decide(signDecision(by('mallory'), MALLORY.priv))).toThrow(DecisionRefused) // registered to no one
    expect(() => b.led.decide(signDecision(by('carol'), CAROL.priv))).toThrow(/grant_signer/) // a reviewer's key
    expect(() => b.led.decide(signDecision(by('dave'), DAVE.priv))).toThrow(DecisionRefused) // anchored for globex only
    expect(() => b.led.decide(signDecision(by('alice'), BOB.priv))).toThrow(DecisionRefused) // alice's name, bob's key
    expect(b.led.chainJSONL()).toBe(before)

    // With no anchor at all the door takes a signature, and it moves nothing (D-ANCHOR).
    clock = Date.parse('2026-09-01T09:00:00Z')
    const bare = createLedger({ now: tick })
    const v = old(numbered(clean, 'G3-BARE'))
    bare.record(v, { tenant_id: 'acme' })
    const bg = grantOn(bare, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const br = successionReplay(bare, FROM, TO, { inputs: () => inputsOf(numbered(clean, 'G3-BARE')) }).replay
    const be = grantOn(bare, successionGrant({ from: bg, to: TO, replay: br, reason: 'carry', signer_id: 'alice', signed_at: iso() }, ONE), ALICE.priv)
    const db = bare.decisionBook()
    expect(grantInForce(db.decisions, TO)).toBeUndefined()
    expect(noEffect(db, { workflow_id: TO }).find(n => n.decision_id === be.decision_id)?.notice).toMatch(/is not anchored: it has no effect/)
  })

  it('refuses a missing or malformed replay summary; a replay that does not match the book carries nothing', () => {
    const b = registryBook()
    for (let i = 0; i < 4; i++) recordOld(b, numbered(clean, `G3-M${i}`))
    const g = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const r = replayOf(b).replay
    const base = { workflow_id: TO, level: 'gate' as const, consequence_tier: 'high', policy: policyRef(ONE), signer_id: 'alice', signed_at: iso() }
    expect(() => makeGrant({ ...base, succeeds: { from: FROM, grant: g.decision_id, reason: 'carry' } as never })).toThrow(/carries the replay of the old workflow's verdicts/)
    const before = b.led.chainJSONL()
    // Signed without signDecision's own check: the door refuses it all the same, and appends nothing.
    const raw = { decision_version: 'decision-v0', kind: 'GRANT', ...base, succeeds: { from: FROM, grant: g.decision_id, reason: 'carry' } }
    expect(() => b.led.decide(signRaw(raw, ALICE.priv))).toThrow(/carries the replay/)
    expect(() => b.led.decide(signRaw({ ...raw, succeeds: { ...raw.succeeds, replay: { ...r, changed: 'none' } } }, ALICE.priv))).toThrow(/changed must be an array/)
    expect(() => makeGrant({ ...base, workflow_id: 'acme/pay-app@0.1.0', succeeds: { from: FROM, grant: g.decision_id, reason: 'carry', replay: r } })).toThrow(/same ruleset/)
    expect(() => makeGrant({ ...base, workflow_id: 'globex/invoice@0.1.0', succeeds: { from: FROM, grant: g.decision_id, reason: 'carry', replay: r } })).toThrow(/within a tenant/)
    expect(b.led.chainJSONL()).toBe(before)
    // A well-formed replay that under-counts the book: the door cannot see the chain, so it is appended, and read with no effect.
    const short = successionGrant({ from: g, to: TO, replay: { ...r, recorded: 3, reperformed: 3 }, reason: 'carry', signer_id: 'alice', signed_at: iso() }, ONE)
    const e = grantOn(b.led, short, ALICE.priv)
    const db = b.led.decisionBook()
    expect(db.ok).toBe(true)
    expect(grantInForce(db.decisions, TO)).toBeUndefined()
    const n = noEffect(db, { workflow_id: TO }).find(x => x.decision_id === e.decision_id)
    expect(n?.notice).toMatch(/carries acme\/invoice@0\.0\.1's grant to acme\/invoice@0\.1\.0 and has no effect .*its replay does not match the book: it counts 3 verdict\(s\) recorded under acme\/invoice@0\.0\.1 before event \d+; the book records 4$/)
  })

  it('a succession across a ruleset that flips outcomes shows them, and a loosening needs its own stated reason', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `G3-F${i}`))
    const drift = [recordOld(b, numbered(roundingDrift, 'G3-D1')), recordOld(b, numbered(roundingDrift, 'G3-D2'))]
    const na = recordOld(b, taxNa('G3-NA'))
    const kept = recordOld(b, numbered(clean, 'G3-NOINPUT'))
    b.inputs.delete(kept.verdict_id) // the customer no longer holds this one's documents
    const forged = recordOld(b, numbered(clean, 'G3-OTHER'))
    b.inputs.set(forged.verdict_id, inputsOf(numbered(clean, 'G3-SOMETHING-ELSE'))) // inputs that are not the verdict's
    const g = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const { replay, not_reperformed } = replayOf(b)
    expect(drift.every(v => v.outcome === 'PASS') && na.outcome === 'FAIL').toBe(true) // what 0.0.1 recorded
    const expected = [
      ...drift.map(v => ({ verdict_id: v.verdict_id, from: 'PASS', to: cur(numbered(roundingDrift, 'x')).outcome })),
      { verdict_id: na.verdict_id, from: 'FAIL', to: cur(taxNa('x')).outcome },
    ].sort((x, y) => (x.verdict_id < y.verdict_id ? -1 : 1))
    expect(expected.map(c => c.to)).toEqual(expected.map(c => (c.from === 'PASS' ? 'FAIL' : 'PASS'))) // 0.1.0 holds the drift, reads the junk tax as can't-tell
    expect(replay).toMatchObject({ recorded: 8, reperformed: 6, changed: expected })
    expect(not_reperformed).toEqual([
      { verdict_id: kept.verdict_id, reason: 'no inputs supplied' },
      { verdict_id: forged.verdict_id, reason: 'the inputs supplied are not the ones it was issued on (they do not hash to its input_hash)' },
    ].sort((x, y) => (x.verdict_id < y.verdict_id ? -1 : 1)))
    // FAIL → PASS lets something through that 0.0.1 held: refused without a person's stated reason.
    const input = { from: g, to: TO, replay, reason: 'carry gate to 0.1.0', signer_id: 'alice', signed_at: iso() }
    expect(() => successionGrant(input, ONE)).toThrow(/it loosens/)
    const e = grantOn(b.led, successionGrant({ ...input, loosening_reason: 'a junk tax is not a failed total; a person reviews every held item at gate' }, ONE), ALICE.priv)
    const carried = inForce(b.led, TO, ONE)!
    expect(carried.decision_id).toBe(e.decision_id)
    expect(successionNotice(carried)).toMatch(/8 verdict\(s\) recorded under .* 6 re-performed, 3 changed \(FAIL→PASS 1, PASS→FAIL 2\); 2 not re-performed \(what the new ruleset says of them is unknown\); it loosens 1, accepted by alice: a junk tax/)
  })

  it('D-DUAL carries over: a succession of autonomy at a two-signature tier is pending until a second person co-signs', () => {
    const b = registryBook()
    for (let i = 0; i < 3; i++) recordOld(b, numbered(clean, `G3-A${i}`))
    const g = grantOn(b.led, grantUnderPolicy(DUAL, { workflow_id: FROM, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    b.led.decide(signDecision<BookDecision>(makeCosign(g, { signer_id: 'bob', signed_at: iso() }), BOB.priv))
    expect(inForce(b.led, FROM, DUAL)?.decision_id).toBe(g.decision_id)
    const r = replayOf(b).replay
    // One signature where the carried grant needed two: the door refuses it.
    const { signatures: _two, ...under } = successionGrant({ from: g, to: TO, replay: r, reason: 'carry', signer_id: 'alice', signed_at: iso() }, DUAL)
    expect(() => b.led.decide(signDecision(makeGrant(under), ALICE.priv))).toThrow(/dual authorization carries over/)
    const d = successionGrant({ from: g, to: TO, replay: r, reason: 'carry', signer_id: 'alice', signed_at: iso() }, DUAL)
    expect(d.signatures).toBe(2)
    const e = grantOn(b.led, d, ALICE.priv)
    expect(inForce(b.led, TO, DUAL)).toBeUndefined()
    expect(noEffect(b.led.decisionBook(), { workflow_id: TO })[0]).toMatchObject({ decision_id: e.decision_id, pending: { required: 2, signed_by: ['alice'] } })
    expect(() => b.led.decide(signDecision<BookDecision>(makeCosign(e, { signer_id: 'alice', signed_at: iso() }), ALICE.priv))).toThrow(/second person/)
    b.led.decide(signDecision<BookDecision>(makeCosign(e, { signer_id: 'bob', signed_at: iso() }), BOB.priv))
    expect(inForce(b.led, TO, DUAL)?.decision_id).toBe(e.decision_id)
    // Carrying a lower rung needs one person, as any step down does.
    const gate = successionGrant({ from: g, to: TO, level: 'gate', replay: replayOf(b).replay, reason: 'carry at gate', signer_id: 'alice', signed_at: iso() }, DUAL)
    expect(gate.signatures).toBeUndefined()
  })
})

describe('D-NO-FLIPFLOP holds through a succession', () => {
  /** FROM earned autonomy, then a miss, then a person stepped it down to gate. TO ran in parallel, reviewed, all upheld. */
  function stepDownBook() {
    const b = registryBook()
    for (let i = 0; i < 10; i++) recordOld(b, numbered(clean, `G3-S${i}`))
    for (const x of [...Array.from({ length: 10 }, (_, i) => numbered(clean, `G3-T${i}`)), ...Array.from({ length: 6 }, (_, i) => numbered(broken, `G3-TB${i}`))]) {
      const v = cur(x)
      b.led.record(v, { tenant_id: 'acme' })
      b.led.review(v.verdict_id, { reviewer_id: 'carol', decision: 'UPHELD' }, { tenant_id: 'acme' })
    }
    const up = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'autonomy', consequence_tier: 'high', bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    recordOld(b, numbered(clean, 'G3-MISS'), 'OVERTURNED') // a PASS a person overturned: a miss at autonomy
    const down = grantOn(b.led, grantUnderPolicy(ONE, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso(), note: 'a miss' }), ALICE.priv)
    return { ...b, up, down }
  }

  it('the grant a step down replaced is never carried, and a succession never raises the rung', () => {
    const b = stepDownBook()
    const r = replayOf(b).replay
    const before = b.led.chainJSONL()
    const d = (from: DecisionEntry<GrantDecision>, level?: 'autonomy') => successionGrant({ from, to: TO, replay: r, reason: 'carry', signer_id: 'alice', signed_at: iso(), ...(level ? { level } : {}) }, ONE)
    expect(() => b.led.decide(signDecision(d(b.up), ALICE.priv))).toThrow(/only the grant in force is carried/)
    expect(() => successionGrant({ from: b.down, to: TO, replay: r, reason: 'carry', signer_id: 'alice', signed_at: iso(), level: 'autonomy' }, ONE)).toThrow(/never raises/)
    const raised = { ...d(b.down), level: 'autonomy' as const, bounds: 'all' }
    expect(() => b.led.decide(signDecision(makeGrant(raised), ALICE.priv))).toThrow(/never raises one/)
    expect(b.led.chainJSONL()).toBe(before)
  })

  // The voice patch (verdict/voice.ts `stepDownWindow` → `carriedStepDown`, 2026-09-29) landed: the new workflow's voice argues a
  // return to autonomy from the verdicts recorded since the OLD workflow's failure step down, not from its pooled record
  // (formerly pinned as it.fails).
  it('after a failure step down, the carried workflow does not re-propose autonomy the same day (fresh window since the step down)', () => {
    const b = stepDownBook()
    grantOn(b.led, successionGrant({ from: b.down, to: TO, replay: replayOf(b).replay, reason: 'carry gate', signer_id: 'alice', signed_at: iso() }, ONE), ALICE.priv)
    const a = assessVoiceFromLedger(b.led, TO, ONE, { root_keys: [ROOT.pub] })
    expect(a.granted).toBe('gate')
    expect(a.earned).toBe('autonomy') // the pooled record of the new workflow clears autonomy's bar...
    expect(a.proposal?.kind).not.toBe('PROMOTION_PROPOSAL') // ...but it cannot carry the return by itself
    expect(a.proposal).toBeUndefined()
    expect(a.fresh_window).toMatchObject({ from: 'autonomy', since: { decision_id: b.down.decision_id }, records: 0 })
  })
})

describe('P-S4-C: a governing policy at a chain position (grantAt) and in reconciliation', () => {
  const MOD = EXAMPLE_PROMOTION_POLICY.tiers.find(t => t.tier === 'moderate')!
  const GOV: PromotionPolicy = { ...EXAMPLE_PROMOTION_POLICY, version: '9.0.0', tiers: EXAMPLE_PROMOTION_POLICY.tiers.map(t => (t.tier === 'moderate' ? { ...MOD, grant_signatures: 2 } : t)) }

  it('grantAt skips a grant the governing policy does not admit at that position, and counts only co-signatures before it', () => {
    const b = registryBook()
    const gate = grantOn(b.led, makeGrant({ workflow_id: FROM, level: 'gate', consequence_tier: 'moderate', policy: policyRef(EXAMPLE_PROMOTION_POLICY), signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const auto = grantOn(b.led, makeGrant({ workflow_id: FROM, level: 'autonomy', consequence_tier: 'moderate', bounds: 'all', policy: policyRef(EXAMPLE_PROMOTION_POLICY), signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const cos = b.led.decide(signDecision<BookDecision>(makeCosign(auto, { signer_id: 'bob', signed_at: iso() }), BOB.priv))
    const db = b.led.decisionBook()
    const gov = { policies: [GOV], governing_policy: GOV }
    expect(grantAt(db.decisions, FROM, cos.seq)?.decision_id).toBe(auto.decision_id) // the stated count (one) governs
    expect(grantAt(db.decisions, FROM, cos.seq, gov)?.decision_id).toBe(gate.decision_id) // before bob's signature: pending
    expect(grantAt(db.decisions, FROM, cos.seq + 1, gov)?.decision_id).toBe(auto.decision_id) // after it: in force
  })

  it('reconciliation reads the rung a record was held at under the declared policy', () => {
    let now = Date.parse('2026-09-02T09:00:00Z')
    const led = createLedger({ now: () => new Date((now += 1000)), trusted_keys: TRUSTED })
    const grant = (level: 'gate' | 'autonomy') => led.decide(signDecision(makeGrant({
      workflow_id: FROM, level, consequence_tier: 'moderate', policy: policyRef(EXAMPLE_PROMOTION_POLICY), ...(level === 'autonomy' ? { bounds: 'all' } : {}),
      signer_id: 'owner', signed_at: new Date(now).toISOString(),
    }), OWNER.privateKeyPem))
    const gate = grant('gate')
    const auto = grant('autonomy') // one signature: the declared GOV needs two at 'moderate'
    const x = failInvoice('INV-G3', 'V1', 500)
    led.record(old(x), { tenant_id: 'acme' })
    const pop = readPopulationCSV(csvOf([['P-G3', 'V1', 'INV-G3', '510', 'USD', '2026-09-01', '2026-09-05']]))
    const base = { scope: { tenant_id: 'acme' }, anchors: { trusted_keys: TRUSTED }, extractions: [x] }
    const plain = reconcileCompleteness(pop, led, MAPPING, base)
    const governed = reconcileCompleteness(pop, led, MAPPING, { ...base, policy: GOV })
    expect(plain.exceptions.paid_despite_hold[0]?.hold).toMatchObject({ rung: 'autonomy', grant: { decision_id: auto.decision_id } })
    expect(governed.exceptions.paid_despite_hold[0]?.hold).toMatchObject({ rung: 'gate', grant: { decision_id: gate.decision_id } })
    expect(governed.binds.options_hash).not.toBe(plain.binds.options_hash)
  })
})

describe('the governed no-effect list lives in the ledger', () => {
  it('governedNoEffect says a foreign-policy grant is pending under the declared policy; http/dual.ts says the same', async () => {
    const b = registryBook()
    grantOn(b.led, grantUnderPolicy(DUAL, { workflow_id: FROM, level: 'gate', consequence_tier: 'high', signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const lax = grantOn(b.led, makeGrant({ workflow_id: FROM, level: 'autonomy', consequence_tier: 'high', bounds: 'all', policy: policyRef(ONE), signer_id: 'alice', signed_at: iso() }), ALICE.priv)
    const db = b.led.decisionBook()
    const n = governedNoEffect(db, DUAL).find(x => x.decision_id === lax.decision_id)
    expect(n?.pending).toEqual({ required: 2, signed_by: ['alice'] })
    expect(n?.notice).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures .*: it names policy succession-test@1\.0\.0; it is judged under the governing policy succession-test@2\.0\.0$/)
    expect(governedNoEffect(db, undefined)).toEqual(noEffect(db))
    const { governedRead } = await import('../src/http/dual')
    expect(governedRead(db, DUAL).no_effect()).toEqual(governedNoEffect(db, DUAL))
  })
})
