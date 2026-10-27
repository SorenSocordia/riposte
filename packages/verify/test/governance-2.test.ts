/**
 * 2026-09-28: dual authorization (D-DUAL), the review queue's tenant wall (F-S2-1), and a surveillance-found
 * failure argued as a demotion (FS4).
 *
 * D-DUAL: a tier may declare `grant_signatures: 2` ("Automated-approval evidence", 2026-09-28, §5.6: autonomy at T3 only with
 * two signatures). A GRANT of autonomy there is on the book and PENDING (no effect, a notice) until a second person co-signs
 * it (GRANT_COSIGN, carried in a GRANT event): anchored, another signer_id, another key. The same key signing twice, two ids
 * on one key, an unanchored co-signer, or a revoked one never counts.
 */
import { describe, it, expect } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type Verdict } from '../src/index'
import { createLedger, parseChainJSONL, type Ledger } from '../src/ledger/index'
import {
  makeGrant, makeCosign, makeKeyRegister, makeKeyRevoke, signDecision, readDecisionBook, grantInForce, grantAt, grantSignatures,
  noEffect, decisionConflict, decisionSubject, decisionEventType,
  type BookDecision, type DecisionEntry, type DecisionPayload, type DeclineDecision, type GrantCosignDecision, type GrantDecision, type SignedDecision, type TrustedKeys,
} from '../src/ledger/decisions'
import { keyFingerprint } from '../src/ledger/registry'
import { linkEvent } from '../src/ledger/chain'
import { readRung, tenantOpinions } from '../src/ledger/report'
import {
  assessVoiceFromLedger, declineDecision, grantForProposal, grantUnderPolicy, lintPolicy, policyRef, revisePolicy, RESEARCH_PROMOTION_POLICY as R,
  type DemotionProposal, type PromotionPolicy, type TierRequirements, type VoiceAssessment, type VoiceLevel,
} from '../src/verdict/voice'
import { commitDueSamples, reviewQueue } from '../src/surveillance/index'
import { promotionOpinion, snapshotOfLedger } from '../src/opinion/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const ALICE = keyFromSeed('b1'.repeat(32))
const BOB = keyFromSeed('b2'.repeat(32))
const MALLORY = keyFromSeed('b3'.repeat(32))
const OWNER = keyFromSeed('11'.repeat(32))

let clock = 0
const at = (iso: string): void => { clock = Date.parse(iso) }
const tick = (): Date => new Date((clock += 60_000))
const nextDay = (): void => { const d = new Date(clock + 86_400_000); clock = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9) }
const iso = (): string => new Date(clock).toISOString()

const PASSES: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...clean, invoice_number: `G2-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 20 }, (_, i) => verify({ ...broken, invoice_number: `G2-F${i}` }, { now: FIXED_NOW }))
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`

const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
const HIGH: TierRequirements = { tier: 'high', description: 'test tier', confidence: 0.9, ...bars, grant_signatures: 2, evidence: { segregation: true } }
const DUAL: PromotionPolicy = { policy_version: 'promotion-policy-v0', policy_id: 'dual-test', version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [HIGH] }
const ROOTED = { root_keys: [ROOT.pub] }

function recordAll(led: Ledger, vs: readonly Verdict[], tenant = 'acme'): string[] {
  return vs.map(v => { led.record(v, { tenant_id: tenant }); return v.verdict_id })
}
const grantOf = (level: VoiceLevel, signer = 'alice', extra: Partial<GrantDecision> = {}): GrantDecision =>
  grantUnderPolicy(DUAL, { workflow_id: WF, level, consequence_tier: 'high', ...(level === 'autonomy' ? { bounds: 'all' } : {}), signer_id: signer, signed_at: iso(), ...extra })
const cosign = (g: DecisionEntry<GrantDecision>, signer: string, key: string): SignedDecision<BookDecision> =>
  signDecision<BookDecision>(makeCosign(g, { signer_id: signer, signed_at: iso() }), key)

/** A registry book (root key): alice and bob are grant signers. carol reviews most PASSes; bob reviews two. */
function registryBook(): { led: Ledger; bobReviewed: string[] } {
  at('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, ...ROOTED })
  for (const [id, k] of [['alice', ALICE], ['bob', BOB]] as const) {
    led.decide(signDecision(makeKeyRegister({ subject_id: id, public_key: k.pub, roles: ['grant_signer'], signer_id: 'root', signed_at: iso() }), ROOT.priv))
  }
  for (const id of recordAll(led, PASSES.slice(0, 12))) led.review(id, { reviewer_id: 'carol', decision: 'UPHELD' })
  const bobReviewed = recordAll(led, PASSES.slice(12, 14))
  for (const id of bobReviewed) led.review(id, { reviewer_id: 'bob', decision: 'UPHELD' })
  for (const id of recordAll(led, FAILS.slice(0, 6))) led.review(id, { reviewer_id: 'carol', decision: 'UPHELD' })
  return { led, bobReviewed }
}

/** Splice a signed decision onto a book as its chain event would carry it, re-linked (an attacker's best). */
function splice(led: Ledger, s: SignedDecision<BookDecision>): { events: ReturnType<typeof parseChainJSONL>['events']; payloads: unknown[]; at: number } {
  const { events, payloads } = parseChainJSONL(led.chainJSONL())
  const recorded_at = new Date(clock + 60_000).toISOString()
  const type = decisionEventType(s.decision.kind)
  const payload: DecisionPayload = { type, recorded_at, signed: s }
  const ev = linkEvent(events.length, events[events.length - 1]!.entry_hash, { ts: recorded_at, type, verdict_id: decisionSubject(s.decision), payload })
  return { events: [...events, ev], payloads: [...payloads, payload], at: events.length }
}

describe('D-DUAL: the policy says how many people sign a grant of autonomy', () => {
  it('lints grant_signatures: an integer 1–5, a warning where autonomy is not grantable, never fewer as consequence rises', () => {
    expect(lintPolicy(DUAL)).toEqual({ ok: true, errors: [] })
    expect(lintPolicy({ ...DUAL, tiers: [{ ...HIGH, grant_signatures: 0 }] }).errors.join(' ')).toMatch(/grant_signatures must be an integer from 1 to 5/)
    expect(lintPolicy({ ...DUAL, tiers: [{ ...HIGH, grant_signatures: 1.5 }] }).ok).toBe(false)
    expect(lintPolicy({ ...DUAL, tiers: [{ ...HIGH, max_rung: 'gate' }] }).warnings?.join(' ')).toMatch(/grant_signatures is never used: it binds a GRANT of autonomy/)
    const lo = { ...HIGH, tier: 'lo' }, hi = { ...HIGH, tier: 'hi', grant_signatures: 1 }
    expect(lintPolicy({ ...DUAL, tiers: [lo, hi] }).errors.join(' ')).toMatch(/burden decreases with consequence: hi needs 1 signature\(s\) on a grant of autonomy, lo 2/)
    const next = revisePolicy(DUAL, { version: '1.1.0', tiers: [{ ...HIGH, grant_signatures: 3 }] }, { revised_by: 'alice', revised_at: iso(), reason: 'three people' })
    expect(next.revision!.changes).toContain('high: grant_signatures 2 → 3')
  })

  it('RESEARCH_PROMOTION_POLICY 0.3.0: T3 autonomy needs two signatures (§5.6), lints clean, and grantUnderPolicy writes the count', () => {
    expect(R.version).toBe('0.3.0')
    expect(R.tiers.map(t => t.grant_signatures ?? 1)).toEqual([1, 1, 2, 1])
    expect(lintPolicy(R)).toEqual({ ok: true, errors: [] })
    expect(R.tiers[2]!.basis).toMatch(/Autonomy only with two signatures/)
    const base = { workflow_id: WF, signer_id: 'alice', signed_at: '2026-09-28T09:00:00Z' }
    expect(grantUnderPolicy(R, { ...base, level: 'autonomy', consequence_tier: 't3-high', bounds: 'all' }).signatures).toBe(2)
    expect(grantUnderPolicy(R, { ...base, level: 'gate', consequence_tier: 't3-high' }).signatures).toBeUndefined() // D-DUAL-SCOPE
    expect(grantUnderPolicy(R, { ...base, level: 'autonomy', consequence_tier: 't1-routine', bounds: 'all' }).signatures).toBeUndefined()
    expect(() => grantUnderPolicy(R, { ...base, level: 'autonomy', consequence_tier: 't3-high', bounds: 'all', signatures: 1 })).toThrow(/requires 2 signatures/)
    expect(() => makeGrant({ ...base, level: 'gate', consequence_tier: 'x', policy: policyRef(R), signatures: 1 })).toThrow(/integer from 2 to 5/)
  })
})

describe('D-DUAL: a grant of autonomy is PENDING until a second person co-signs it', () => {
  it('pending: on the book, of no effect, said; the co-signature puts it in force (a GRANT event), and every reader agrees', () => {
    const { led, bobReviewed } = registryBook()
    const gate = led.decide(signDecision(grantOf('gate'), ALICE.priv))
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    expect(auto.signed.decision.signatures).toBe(2)

    let db = led.decisionBook()
    expect(grantInForce(db.decisions, WF)?.decision_id).toBe(gate.decision_id) // the rung falls back to the grant in force
    const pend = noEffect(db, { workflow_id: WF })
    expect(pend).toEqual([expect.objectContaining({ kind: 'GRANT', decision_id: auto.decision_id, pending: { required: 2, signed_by: ['alice'] } })])
    expect(pend[0]!.notice).toMatch(/is pending: autonomy at tier 'high' needs 2 signatures \(dual authorization\) and has 1 \(alice\); it has no effect \(.* is not moved to autonomy\) until another person co-signs it/)
    expect(readRung(db, led, WF, undefined)).toMatchObject({ from: 'grant', granted: 'gate' })
    let a = assessVoiceFromLedger(led, WF, DUAL)
    expect(a.level).toBe('gate')
    expect(a.book!.no_effect!.map(n => [n.decision_id, n.pending])).toEqual([[auto.decision_id, { required: 2, signed_by: ['alice'] }]])

    // the door checks a decline against the grant in force (gate), not the pending one
    const seen = { calibration_hash: '0'.repeat(64), rungs: [], failing_cases: [], blockers: [] }
    const decline: DeclineDecision = {
      decision_version: 'decision-v0', kind: 'DECLINE', workflow_id: WF, proposal_id: 'p'.repeat(32), proposal_kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy',
      consequence_tier: 'high', policy: policyRef(DUAL), under_grant: gate.decision_id, reason: 'not yet', seen, signer_id: 'alice', signed_at: iso(),
    }
    const entries = [...db.decisions, ...db.canaries, ...db.cosigns] as DecisionEntry<BookDecision>[]
    expect(decisionConflict(decline, entries)).toBeUndefined()
    expect(decisionConflict({ ...decline, under_grant: auto.decision_id }, entries)).toMatch(/grant in force/)

    const co = led.decide(cosign(auto, 'bob', BOB.priv))
    expect(parseChainJSONL(led.chainJSONL()).events[co.seq]!.type).toBe('GRANT') // no new chain event type
    db = led.decisionBook()
    expect(db.cosigns.map(c => c.decision_id)).toEqual([co.decision_id])
    expect(db.decisions.some(e => e.decision_id === co.decision_id)).toBe(false) // a co-signature is not a rung decision
    expect(led.decisions().some(e => e.decision_id === co.decision_id)).toBe(false) // nor on the ledger door's own list
    const g = grantInForce(db.decisions, WF)!
    expect(g.decision_id).toBe(auto.decision_id)
    expect(g.cosigned).toEqual([{ decision_id: co.decision_id, seq: co.seq, signer_id: 'bob', fingerprint: keyFingerprint(BOB.pub) }])
    expect(grantSignatures(g)).toMatchObject({ required: 2, signers: ['alice', 'bob'], complete: true })
    expect(grantAt(db.decisions, WF, co.seq)?.decision_id).toBe(gate.decision_id)   // before the co-signature: gate
    expect(grantAt(db.decisions, WF, co.seq + 1)?.decision_id).toBe(auto.decision_id)
    expect(noEffect(db, { workflow_id: WF })).toEqual([])
    expect(readRung(db, led, WF, undefined)).toMatchObject({ from: 'grant', granted: 'autonomy' })
    a = assessVoiceFromLedger(led, WF, DUAL)
    expect(a.level).toBe('autonomy')
    expect(a.book!.grant).toEqual({ decision_id: auto.decision_id, seq: auto.seq, entry_hash: auto.entry_hash, cosigned_by: [{ decision_id: co.decision_id, seq: co.seq, signer_id: 'bob' }] })
    // segregation: a co-signer signed the grant too, so their own clean reviews are set aside for it
    expect(a.book!.evidence!.segregation).toEqual({ signer: 'alice', cosigners: ['bob'], set_aside: [...bobReviewed].sort() })

    // a reopened book reads the same (the event says GRANT; the signed decision says GRANT_COSIGN)
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    expect(grantInForce(readDecisionBook(events, payloads, ROOTED).decisions, WF)?.decision_id).toBe(auto.decision_id)

    // a step down needs one person (D-DUAL-SCOPE): it is in force at once
    const down = led.decide(signDecision(grantOf('gate'), ALICE.priv))
    expect(grantInForce(led.decisionBook().decisions, WF)?.decision_id).toBe(down.decision_id)
  })

  it('the same key twice, two ids on one key, the grant\'s own signer, or a repeat co-signer never counts', () => {
    at('2026-09-02T09:00:00Z')
    const T: TrustedKeys = { alice: ALICE.pub, alias: ALICE.pub, bob: BOB.pub }
    const led = createLedger({ now: tick, trusted_keys: T })
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    const length = led.decisionBook().check.length
    expect(() => led.decide(cosign(auto, 'alice', ALICE.priv))).toThrow(/signed the grant itself: dual authorization needs a second person/)
    expect(() => led.decide(cosign(auto, 'alias', ALICE.priv))).toThrow(/two ids on one key are one signer/)
    expect(led.decisionBook().check.length).toBe(length) // refused: nothing appended

    // spliced in anyway (re-linked): the book verifies (alias IS anchored), but the co-signature does not count, and says why
    const s = splice(led, cosign(auto, 'alias', ALICE.priv))
    const spliced = readDecisionBook(s.events, s.payloads, { trusted_keys: T })
    expect(spliced.ok).toBe(true)
    expect(grantInForce(spliced.decisions, WF)).toBeUndefined()
    expect(noEffect(spliced, { workflow_id: WF }).map(n => n.kind)).toEqual(['GRANT', 'GRANT_COSIGN'])
    expect(noEffect(spliced, { workflow_id: WF })[1]!.notice).toMatch(/has no effect: it is signed with the key that signed the grant: two ids on one key are one signer/)

    const co = led.decide(cosign(auto, 'bob', BOB.priv))
    expect(grantInForce(led.decisionBook().decisions, WF)?.decision_id).toBe(auto.decision_id)
    clock += 60_000
    expect(() => led.decide(cosign(auto, 'bob', BOB.priv))).toThrow(/bob already co-signed it \(seq \d+\): one person counts once/)
    expect(co.signed.decision).toMatchObject({ kind: 'GRANT_COSIGN', grant: auto.decision_id, level: 'autonomy', workflow_id: WF })
  })

  it('an unanchored co-signer does not count; neither does one whose anchoring is unknown (fail-closed)', () => {
    const { led } = registryBook()
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    const db = led.decisionBook()
    const mal = signDecision<BookDecision>(makeCosign(auto, { signer_id: 'mallory', signed_at: iso() }), MALLORY.priv)
    const entry = (via?: 'unanchored'): DecisionEntry<BookDecision> => ({ seq: db.check.length, entry_hash: 'f'.repeat(64), recorded_at: iso(), decision_id: mal.decision_id, signed: mal, ...(via ? { via } : {}) })
    for (const e of [entry('unanchored'), entry()]) {
      const list = [...db.decisions, e] as DecisionEntry[]
      expect(grantInForce(list, WF)).toBeUndefined()
      expect(noEffect({ decisions: db.decisions, canaries: [], cosigns: [e as DecisionEntry<GrantCosignDecision>] }, { workflow_id: WF }).map(n => n.kind)).toEqual(['GRANT', 'GRANT_COSIGN'])
    }
    // a default book (no anchors): both signatures verify, and neither moves anything; both are said
    at('2026-09-03T09:00:00Z')
    const plain = createLedger({ now: tick })
    const g = plain.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    plain.decide(cosign(g, 'bob', BOB.priv))
    const pdb = plain.decisionBook()
    expect(grantInForce(pdb.decisions, WF)).toBeUndefined()
    expect(noEffect(pdb).map(n => [n.kind, /is not anchored: it has no effect/.test(n.notice)])).toEqual([['GRANT', true], ['GRANT_COSIGN', true]])
  })

  it('a revoked co-signer\'s later co-signature is refused at the door, and spliced in, breaks the book', () => {
    const { led } = registryBook()
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    led.decide(signDecision(makeKeyRevoke({ subject_id: 'bob', public_key: BOB.pub, reason: 'left the company', signer_id: 'root', signed_at: iso() }), ROOT.priv))
    const late = cosign(auto, 'bob', BOB.priv)
    expect(() => led.decide(late)).toThrow(/revoked/)
    const s = splice(led, late)
    const book = readDecisionBook(s.events, s.payloads, ROOTED)
    expect(book).toMatchObject({ ok: false, check: { brokenAt: s.at, reason: expect.stringMatching(/revoked/) } })
    expect(readRung(book, s, WF, undefined)).toMatchObject({ from: 'unread', granted: 'record' })
    expect(grantInForce(led.decisionBook().decisions, WF)).toBeUndefined()
  })

  it('a superseded grant cannot be co-signed; a co-signature must name a grant on the book, at its level', () => {
    const { led } = registryBook()
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    const gate = led.decide(signDecision(grantOf('gate'), ALICE.priv))
    expect(() => led.decide(cosign(auto, 'bob', BOB.priv))).toThrow(/was superseded by GRANT .* only the latest grant for a workflow can be co-signed/)
    const wrongLevel = signDecision<BookDecision>({ ...makeCosign(gate, { signer_id: 'bob', signed_at: iso() }), level: 'autonomy' }, BOB.priv)
    expect(() => led.decide(wrongLevel)).toThrow(/a co-signer signs what the grant says/)
    const s = splice(led, wrongLevel)
    expect(readDecisionBook(s.events, s.payloads, ROOTED)).toMatchObject({ ok: false, check: { brokenAt: s.at, reason: expect.stringMatching(/the co-signature says/) } })
  })

  it('a grant that under-states its tier is pending for every reader that knows the policy (the report, voice, the opinion)', () => {
    const { led } = registryBook()
    const bare = led.decide(signDecision(makeGrant({ workflow_id: WF, level: 'autonomy', consequence_tier: 'high', policy: policyRef(DUAL), bounds: 'all', signer_id: 'alice', signed_at: iso() }), ALICE.priv))
    const db = led.decisionBook()
    // HONEST BOUNDARY: a reader handed no policy honors the count the grant states (one)
    expect(grantInForce(db.decisions, WF)?.decision_id).toBe(bare.decision_id)
    expect(grantInForce(db.decisions, WF, { policies: [DUAL] })).toBeUndefined()
    expect(noEffect(db, { workflow_id: WF, policies: [DUAL] })[0]).toMatchObject({ decision_id: bare.decision_id, pending: { required: 2, signed_by: ['alice'] } })
    expect(readRung(db, led, WF, undefined, undefined, DUAL)).toMatchObject({ from: 'none', granted: 'record' })
    expect(() => assessVoiceFromLedger(led, WF, DUAL)).toThrow(/no in-force GRANT for workflow .* is pending/)
    const op = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: DUAL, workflow_id: WF, consequence_tier: 'high' })
    expect(op.premises.find(p => p.id === 'P8')!.statement).toMatch(/No in-force GRANT .* is pending: autonomy at tier 'high' needs 2 signatures/)
    led.decide(cosign(bare, 'bob', BOB.priv))
    expect(assessVoiceFromLedger(led, WF, DUAL).level).toBe('autonomy')
    const op2 = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: DUAL, workflow_id: WF })
    expect(op2.premises.find(p => p.id === 'P8')!.statement).toMatch(/signed by alice at .* and co-signed by bob \(seq \d+\) \(dual authorization\)/)
  })
})

describe('F-S2-1: a review queue is one tenant\'s', () => {
  const SAMPLED: PromotionPolicy = {
    policy_version: 'promotion-policy-v0', policy_id: 'sampled-g2', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
    tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, ...bars, sampling: { period: 'day', review_rate: 0.5 }, evidence: { random_selection: true } }],
  }
  it('another tenant\'s review of the same verdict id (a shared book) never takes an item off this tenant\'s queue', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick })
    for (const v of [...PASSES.slice(0, 20), ...FAILS.slice(0, 10)]) { led.record(v, { tenant_id: 'acme' }); led.record(v, { tenant_id: 'globex' }) }
    nextDay()
    led.record(PASSES[20]!, { tenant_id: 'acme' })
    commitDueSamples(led, WF, SAMPLED, { consequence_tier: 'low' })
    const before = reviewQueue(led, WF, SAMPLED, { consequence_tier: 'low' })
    expect(before.length).toBeGreaterThan(0)
    const id = before[0]!.verdict_id
    led.review(id, { reviewer_id: 'globex-lead', decision: 'UPHELD' }, { tenant_id: 'globex' })
    expect(reviewQueue(led, WF, SAMPLED, { consequence_tier: 'low' })).toEqual(before) // was: the item vanished (measured)
    led.review(id, { reviewer_id: 'acme-lead', decision: 'UPHELD' }, { tenant_id: 'acme' })
    expect(reviewQueue(led, WF, SAMPLED, { consequence_tier: 'low' }).map(q => q.verdict_id)).toEqual(before.slice(1).map(q => q.verdict_id))
  })
})

/** Autonomy granted; a drawn post-grant PASS a person overturned: a failure-basis demotion while the pooled bound clears. */
const SURV: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'surv-g2', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, ...bars, sampling: { period: 'day', surveillance_rate: 0.5 } }],
}
function surveilledMiss(): { led: Ledger; a: VoiceAssessment } {
  at('2026-09-01T09:00:00Z')
  const led = createLedger({ now: tick, trusted_keys: { owner: OWNER.pub } })
  for (const id of recordAll(led, PASSES.slice(0, 10))) led.review(id, { reviewer_id: 'ap-lead', decision: 'UPHELD' })
  for (const id of recordAll(led, FAILS.slice(0, 5))) led.review(id, { reviewer_id: 'ap-lead', decision: 'UPHELD' })
  led.decide(signDecision(makeGrant({ workflow_id: WF, level: 'autonomy', consequence_tier: 'low', policy: policyRef(SURV), bounds: 'all', signer_id: 'owner', signed_at: iso() }), OWNER.priv))
  nextDay(); recordAll(led, PASSES.slice(10, 30))
  nextDay(); recordAll(led, PASSES.slice(30, 31))
  commitDueSamples(led, WF, SURV)
  const queue = reviewQueue(led, WF, SURV)
  for (const q of queue.slice(0, -1)) led.review(q.verdict_id, { reviewer_id: 'ap-lead', decision: 'UPHELD' })
  led.review(queue[queue.length - 1]!.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: 'paid the wrong remit-to' })
  const a = assessVoiceFromLedger(led, WF, SURV)
  expect([a.level, a.earned, (a.proposal as DemotionProposal).basis]).toEqual(['autonomy', 'autonomy', 'failure'])
  return { led, a }
}

describe('FS4: a surveillance-found failure under autonomy is argued as a demotion, not a retention', () => {
  it('the pooled bound still clears, the failure-basis proposal is argued DEMOTE (urgent); a person\'s decline is argued DEMOTE too', () => {
    const { led, a } = surveilledMiss()
    const op = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: SURV, workflow_id: WF })
    expect(op.subject).toMatchObject({ question_kind: 'DEMOTE', granted: 'autonomy', to: 'gate' })
    expect(op.ruling).toMatchObject({ disposition: 'PROPOSE_DEMOTION', urgent: true, favors: 'B' })
    expect(op.title).toMatch(/^URGENT: step .* down from autonomy to gate\?/)
    expect(op.question).toMatch(/A failing case has turned up since a person granted .* though the pooled record still clears its bars/)
    expect(op.readings[0]!.statement).toMatch(/The pooled record still clears its bars, but a failing case since the grant counts against it/)
    expect(op.readings[0]!.statement).not.toMatch(/does not support it/)

    led.decide(signDecision(declineDecision(a, { signer_id: 'owner', signed_at: iso(), reason: 'a known vendor issue, fixed' }), OWNER.priv))
    const kept = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: SURV, workflow_id: WF })
    expect(kept.subject.question_kind).toBe('DEMOTE')
    expect(kept.ruling).toMatchObject({ disposition: 'DECLINED', favors: 'A' })
    expect(kept.ruling.statement).toMatch(/The pooled record still clears its bars; the failing case\(s\) that person weighed stand against `autonomy`/)
  })
})

describe('D-NO-FLIPFLOP: after a person steps down on a failure, the return is argued from evidence gathered since', () => {
  it('the same day: no re-promotion ask (the pooled record clears, the window does not); fresh evidence since: the ask returns', () => {
    const { led, a } = surveilledMiss()
    const down = led.decide(signDecision(grantForProposal(a.proposal!, { signer_id: 'owner', signed_at: iso() }), OWNER.priv))
    const same = assessVoiceFromLedger(led, WF, SURV)
    expect([same.level, same.earned, same.proposal]).toEqual(['gate', 'autonomy', undefined]) // the pooled record clears; nothing is asked
    expect(same.fresh_window).toMatchObject({ from: 'autonomy', since: { decision_id: down.decision_id, seq: down.seq }, records: 0, rung: { rung: 'autonomy', n: 0, cleared: false } })
    expect(tenantOpinions(led, { voice: { policy: SURV } }).asking.filter(p => p.workflow_id === WF)).toEqual([])
    const op = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: SURV, workflow_id: WF })
    expect(op.ruling.disposition).toBe('NOT_YET')
    expect(op.ruling.statement).toMatch(/stepped it down from `autonomy` after a failing case .* a return needs evidence recorded since: autonomy on that window alone: 0 reviewed PASS verdicts < minimum 8/)
    expect(op.premises.find(p => p.id === 'P7')!.statement).toMatch(/argued from the 0 verdict\(s\) recorded since, alone/)

    nextDay()
    for (const id of recordAll(led, PASSES.slice(31, 40))) led.review(id, { reviewer_id: 'ap-lead', decision: 'UPHELD' })
    const later = assessVoiceFromLedger(led, WF, SURV)
    expect(later.fresh_window).toMatchObject({ from: 'autonomy', records: 9, rung: { rung: 'autonomy', n: 9, errors: 0, cleared: true } })
    expect(later.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'gate', to: 'autonomy' })
    const back = promotionOpinion({ snapshot: snapshotOfLedger(led), policy: SURV, workflow_id: WF })
    expect(back.ruling.disposition).toBe('PROPOSE_PROMOTION')
    expect(back.ruling.statement).toMatch(/Argued from the window since the step down \(GRANT `.*`, seq \d+\) alone: 9 reviewed PASS verdicts ≥ 8/)
  })

  it('a step down with no failing case against the rung leaves the pooled record to argue the return', () => {
    const { led } = registryBook()
    led.decide(signDecision(grantOf('gate'), ALICE.priv))
    const auto = led.decide(signDecision(grantOf('autonomy'), ALICE.priv))
    led.decide(cosign(auto, 'bob', BOB.priv))
    led.decide(signDecision(grantOf('gate'), ALICE.priv)) // a person's own step down; no PASS was overturned
    const a = assessVoiceFromLedger(led, WF, DUAL)
    expect(a.fresh_window).toBeUndefined()
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', to: 'autonomy' })
  })
})
