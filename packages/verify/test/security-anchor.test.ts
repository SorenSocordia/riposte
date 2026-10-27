/**
 * SECURITY FIX, D-ANCHOR (2026-09-28). The red team (redteam/r4-unanchored-self-grant.redteam.ts) showed that on a
 * default book (no trusted_keys, no root key) any key that could append to the book moved a rung: an agent generated its
 * own key, signed a GRANT of its workflow to autonomy, and readRung honored it. The design ruling is "only a person moves a
 * rung, in either direction". A signature proves a key holder; anchoring (trusted_keys, or a root key and its registry) is
 * what binds a key to a person. So an UNANCHORED decision stays on the book (it verifies, it is listed, every reader says
 * so) and has NO effect on the rung, in either direction.
 *
 * These are the PoC's BROKEN cases turned into regressions, plus: the mirror attack (a self-signed DECLINE), mixed books,
 * the registry path (a revoked key), canaries (the mirror attack by another door), snapshots, and the HELD door.
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type Verdict } from '../src/index'
import { createLedger, parseChainJSONL, MemoryLedger, type Ledger } from '../src/ledger/index'
import {
  makeGrant, makeKeyRegister, makeKeyRevoke, signDecision, readDecisionBook, grantInForce, declinesFor, revisionsOf, canarySealsFor, canaryRevealsFor,
  isAnchored, noEffect, noEffectNotice, decisionConflict, decisionSubject, DecisionRefused, ANCHOR_HINT,
  type BookDecision, type DecisionEntry, type DecisionPayload, type GrantDecision, type SignedDecision,
} from '../src/ledger/decisions'
import { linkEvent } from '../src/ledger/chain'
import { readRung, tenantOpinions } from '../src/ledger/report'
import {
  assessVoiceFromLedger, declineDecision, policyRef, policyRevisionDecision, revisePolicy, type PromotionPolicy, type VoiceLevel,
} from '../src/verdict/voice'
import { openSnapshot, snapshotOfLedger, snapshotFromChainJSONL, promotionOpinion } from '../src/opinion/index'
import { sealCanaries, revealCanaries } from '../src/surveillance/canary'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

// ── deterministic keys (a fixed 32-byte seed → the same Ed25519 key every run; nothing touches the disk) ────────────────
function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = keyFromSeed('11'.repeat(32))
const AGENT = keyFromSeed('33'.repeat(32)) // the attacker: an autonomous agent with its own self-generated key
const ROOT = keyFromSeed('a1'.repeat(32))
const TRUSTED = { owner: OWNER.pub }

const TINY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'tiny-anchor', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const WF = 'acme/invoice@0.0.1'

let clock = Date.parse('2026-09-28T09:00:00Z')
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()

const PASSES: Verdict[] = Array.from({ length: 30 }, (_, i) => verify({ ...clean, invoice_number: `SA-P${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))
const FAILS: Verdict[] = Array.from({ length: 30 }, (_, i) => verify({ ...broken, invoice_number: `SA-F${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))

function grant(level: VoiceLevel, o: { signer?: string; key?: string } = {}): SignedDecision<GrantDecision> {
  return signDecision(makeGrant({
    workflow_id: WF, level, consequence_tier: 'low', policy: policyRef(TINY), ...(level === 'autonomy' ? { bounds: 'all' } : {}),
    signer_id: o.signer ?? 'owner', signed_at: iso(),
  }), o.key ?? OWNER.priv)
}
const selfGrant = (level: VoiceLevel): SignedDecision<GrantDecision> => grant(level, { signer: 'attacker', key: AGENT.priv })

/** Record and review verdicts from the pools: the first `over` of each kind OVERTURNED. */
function evidence(led: Ledger, o: { passes?: number; fails?: number; failOver?: number; from?: number }): string[] {
  const ids: string[] = []
  const from = o.from ?? 0
  for (let i = 0; i < (o.passes ?? 0); i++) { const v = PASSES[from + i]!; led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: 'UPHELD' }); ids.push(v.verdict_id) }
  for (let i = 0; i < (o.fails ?? 0); i++) { const v = FAILS[from + i]!; led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: i < (o.failOver ?? 0) ? 'OVERTURNED' : 'UPHELD' }); ids.push(v.verdict_id) }
  return ids
}
const reg = (subject: string, key: { pub: string }, roles: ('key_admin' | 'policy_author' | 'reviewer' | 'grant_signer')[]) =>
  signDecision(makeKeyRegister({ subject_id: subject, public_key: key.pub, roles, signer_id: 'root', signed_at: iso() }), ROOT.priv)

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('an unanchored self-grant is on the book and has no effect (the PoC\'s BROKEN cases, as regressions)', () => {
  it('a self-grant to autonomy on a default book: accepted as a signature, listed, and the rung does not move', () => {
    const led = createLedger({ now: tick })
    evidence(led, { passes: 3 })
    const e = led.decide(selfGrant('autonomy')) // the door still records a validly signed decision; it is only not a person's
    const db = led.decisionBook()
    expect(db.ok).toBe(true)
    expect(db.unanchored).toEqual(['attacker'])
    expect(db.decisions.map(d => d.via)).toEqual(['unanchored'])
    expect(grantInForce(db.decisions, WF)).toBeUndefined()
    // was (the PoC): readRung(...).granted === 'autonomy', from 'grant'
    const rr = readRung(db, led, WF, undefined)
    expect(rr).toMatchObject({ from: 'none', granted: 'record' })
    expect(rr.grant).toBeUndefined()
    // the loud, specific notice
    const signed_at = e.signed.decision.signed_at
    const notice = `GRANT \`${e.decision_id.slice(0, 12)}\` by attacker at ${signed_at} (seq ${e.seq}) is not anchored: it has no effect (${WF} is not moved to autonomy); ${ANCHOR_HINT}`
    expect(ANCHOR_HINT).toBe('anchor the signer with --trusted-keys / --root-keys')
    expect(noEffect(db, { workflow_id: WF })).toEqual([{ decision_id: e.decision_id, seq: e.seq, kind: 'GRANT', signer_id: 'attacker', signed_at, workflow_id: WF, notice }])
    expect(noEffectNotice(db.decisions[0]!)).toBe(notice)
    // the assessment runs at record and cites the notice; with no tier declared it says why, loudly
    const a = assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' })
    expect(a).toMatchObject({ granted: 'record', level: 'record' })
    expect(a.book!.grant).toBeUndefined()
    expect(a.book!.no_effect).toEqual([{ decision_id: e.decision_id, seq: e.seq, kind: 'GRANT', signer_id: 'attacker', signed_at, workflow_id: WF, notice }])
    expect(() => assessVoiceFromLedger(led, WF, TINY)).toThrow(new RegExp(`no anchored GRANT for workflow ${WF} is on the book.*is not anchored: it has no effect.*--trusted-keys / --root-keys`))
    // and the report's row reads record, with no grant cited
    const row = tenantOpinions(led, { voice: { policy: TINY, book: led } }).workflows.find(w => w.workflow_id === WF)!
    expect(row).toMatchObject({ granted: 'record', rung_from: 'none' })
    expect(row.grant).toBeUndefined()
  })

  it('a self-grant to record from a gate does not remove the hold: the rung stays gate', () => {
    // End to end, on a default deployment whose gate is DECLARED: the self-grant to record falls through to the declaration.
    const led = createLedger({ now: tick })
    evidence(led, { fails: 2 })
    led.decide(selfGrant('record'))
    const db = led.decisionBook()
    expect(readRung(db, led, WF, { consequence_tier: 'low', granted: 'gate' })).toMatchObject({ from: 'declaration', granted: 'gate' })
    // With an ANCHORED gate: an anchored book refuses the foreign grant at the door (HELD, below), and a spliced one breaks
    // the book, so "anchored gate, then an unanchored grant" never verifies end to end. The library holds it anyway.
    const anchored = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(anchored, { fails: 2, from: 10 })
    anchored.decide(grant('gate'))
    const gate = anchored.decisionBook().decisions[0]!
    const attackerRecord = { ...db.decisions[0]!, seq: gate.seq + 1 }
    expect([gate.via, attackerRecord.via]).toEqual(['trusted_keys', 'unanchored'])
    const mixed = [gate, attackerRecord]
    expect(grantInForce(mixed, WF)).toBe(gate)
    expect(readRung({ ...anchored.decisionBook(), decisions: mixed }, anchored, WF, undefined)).toMatchObject({ from: 'grant', granted: 'gate' })
  })

  it('the mirror attack: a self-signed DECLINE holds back no proposal', () => {
    const led = createLedger({ now: tick })
    evidence(led, { fails: 5 })
    const a1 = assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' })
    expect(a1.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise' })
    const d = led.decide(signDecision(declineDecision(a1, { signer_id: 'attacker', signed_at: iso(), reason: 'keep the person out of it' }), AGENT.priv))
    const a2 = assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' })
    expect(a2.proposal?.proposal_id).toBe(a1.proposal!.proposal_id) // it stands
    expect(a2.book!.declined).toBeUndefined()
    expect(a2.book!.no_effect!.map(n => [n.kind, n.decision_id])).toEqual([['DECLINE', d.decision_id]])
    expect(a2.book!.no_effect![0]!.notice).toMatch(/^DECLINE `[0-9a-f]{12}` by attacker at .* is not anchored: it has no effect \(it holds back no proposal on acme\/invoice@0\.0\.1\); anchor the signer/)
    expect(declinesFor(led.decisionBook().decisions, WF)).toEqual([])
  })

  it('the mirror attack on a demotion: an unanchored DECLINE of an anchored grant\'s demotion is never read', () => {
    // An anchored gate whose record has failed, and an attacker's decline bound to it. On a verifying book the pair cannot
    // exist (the anchored door refuses the attacker); read from entries, the decline is not the book's.
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 9, fails: 6, failOver: 4, from: 5 })
    led.decide(grant('gate'))
    const a = assessVoiceFromLedger(led, WF, TINY)
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure', urgent: true })
    const forged = signDecision(declineDecision(a, { signer_id: 'attacker', signed_at: iso(), reason: 'keep it' }), AGENT.priv)
    expect(() => led.decide(forged)).toThrow(DecisionRefused)
    const copy = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), now: tick }) // an unanchored copy of the book
    const dec = copy.decide(forged) // takes it, as a signature
    const unanchoredDecline = copy.decisionBook().decisions.find(e => e.decision_id === dec.decision_id)!
    expect(unanchoredDecline.via).toBe('unanchored')
    expect(declinesFor([...led.decisionBook().decisions, unanchoredDecline], WF)).toEqual([])
  })

  it('mixed on the registry path: a legacy unanchored autonomy grant moves nothing; the anchored gate after it governs', () => {
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    evidence(led, { passes: 9, fails: 6 })
    const legacy = led.decide(selfGrant('autonomy')) // the legacy prefix: before the registry, a signer is only unanchored
    led.decide(reg('owner', OWNER, ['grant_signer']))
    let a = assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' })
    expect(a.level).toBe('record') // was autonomy: the legacy grant took effect
    expect(a.book!.no_effect!.map(n => n.decision_id)).toEqual([legacy.decision_id])
    const g = led.decide(grant('gate'))
    a = assessVoiceFromLedger(led, WF, TINY)
    expect(a.level).toBe('gate')
    expect(a.book!.grant!.decision_id).toBe(g.decision_id)
    expect(led.decisionBook().decisions.map(e => [e.signed.decision.signer_id, e.via])).toEqual([['attacker', 'unanchored'], ['owner', 'registry']])
  })

  it('the registry path: a revoked key\'s later decisions have no effect (refused at the door; a splice breaks the book)', () => {
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    evidence(led, { passes: 9, fails: 6 })
    led.decide(reg('owner', OWNER, ['grant_signer']))
    led.decide(grant('gate'))
    led.decide(signDecision(makeKeyRevoke({ subject_id: 'owner', public_key: OWNER.pub, reason: 'laptop lost', signer_id: 'root', signed_at: iso() }), ROOT.priv))
    const late = grant('autonomy') // signed with the revoked key
    expect(() => led.decide(late)).toThrow(/was revoked at position \d+ \(laptop lost\)/)
    expect(assessVoiceFromLedger(led, WF, TINY).level).toBe('gate')
    // a rewriter splices it in anyway, re-linked: the book does not verify, so it grants nothing (and never reads autonomy)
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const recorded_at = new Date(clock + 60_000).toISOString()
    const payload: DecisionPayload = { type: 'GRANT', recorded_at, signed: late as unknown as SignedDecision<BookDecision> }
    const ev = linkEvent(events.length, events[events.length - 1]!.entry_hash, { ts: recorded_at, type: 'GRANT', verdict_id: decisionSubject(late.decision), payload })
    const book = readDecisionBook([...events, ev], [...payloads, payload], { root_keys: [ROOT.pub] })
    expect(book).toMatchObject({ ok: false, check: { brokenAt: events.length, reason: expect.stringMatching(/revoked/) } })
    expect(readRung(book, { events: [...events, ev], payloads: [...payloads, payload] }, WF, undefined)).toMatchObject({ from: 'unread', granted: 'record' })
  })

  it('an unanchored POLICY_REVISION is not read as a version of the policy', () => {
    const led = createLedger({ now: tick })
    const revised = revisePolicy(TINY, { version: '1.1.0', method: 'clopper-pearson' }, { revised_by: 'attacker', revised_at: iso(), reason: 'looser' })
    const e = led.decide(signDecision(policyRevisionDecision(revised), AGENT.priv))
    const db = led.decisionBook()
    expect(revisionsOf(db.decisions, TINY.policy_id)).toEqual([])
    expect(noEffect(db, { policy_id: TINY.policy_id }).map(n => [n.kind, n.decision_id])).toEqual([['POLICY_REVISION', e.decision_id]])
    expect(noEffect(db, { policy_id: TINY.policy_id })[0]!.notice).toMatch(/tiny-anchor@1\.1\.0 is not read as a version of the policy/)
    // the door still holds the version label to one body, whoever wrote it (the book as written)
    const rival = revisePolicy(TINY, { version: '1.1.0', tiers: [{ ...TINY.tiers[0]!, confidence: 0.95 }] }, { revised_by: 'owner', revised_at: iso(), reason: 'other' })
    expect(() => led.decide(signDecision(policyRevisionDecision(rival), OWNER.priv))).toThrow(/already on the book/)
  })

  it('canaries: an unanchored seal and reveal set nothing aside (the mirror attack by another door); an anchored one does', () => {
    const salt = 'ab'.repeat(16)
    const run = (anchored: boolean) => {
      const led = createLedger({ now: tick, ...(anchored ? { trusted_keys: TRUSTED } : {}) })
      const ids = evidence(led, { fails: 5, failOver: 2, from: 20 })
      const overturned = ids.slice(0, 2).sort()
      const [signer, key] = anchored ? ['owner', OWNER.priv] : ['attacker', AGENT.priv]
      const seal = led.decide(signDecision(sealCanaries({ workflow_id: WF, verdict_ids: overturned, salt, signer_id: signer, signed_at: iso() }), key))
      led.decide(signDecision(revealCanaries(seal, { verdict_ids: overturned, salt, signed_at: iso() }), key))
      return { led, a: assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' }) }
    }
    const un = run(false)
    const advise = (x: typeof un) => x.a.rungs.find(r => r.rung === 'advise')!
    expect([advise(un).n, advise(un).errors]).toEqual([5, 2]) // the two overturned FAILs still count
    expect(canarySealsFor(un.led.decisionBook().canaries, WF)).toEqual([])
    expect(canaryRevealsFor(un.led.decisionBook().canaries, WF)).toEqual([])
    expect(un.a.book!.no_effect!.map(n => n.kind)).toEqual(['CANARY_SEAL', 'CANARY_REVEAL'])
    const an = run(true)
    expect([advise(an).n, advise(an).errors]).toEqual([3, 0]) // an anchored reveal sets its canaries aside, as designed
    expect(an.a.book!.no_effect).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('HELD: anchored books refuse a foreign decision at the door', () => {
  it('trusted_keys: a self-generated key is refused and nothing is appended', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 2 })
    const head = led.chainHead()
    expect(() => led.decide(selfGrant('autonomy'))).toThrow(DecisionRefused)
    expect(() => led.decide(grant('autonomy', { key: AGENT.priv }))).toThrow(/not the one anchored to signer 'owner'/) // impersonation
    expect(led.chainHead()).toBe(head)
  })

  it('the registry: once in force, an unregistered key is refused', () => {
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    led.decide(reg('owner', OWNER, ['grant_signer']))
    expect(() => led.decide(selfGrant('autonomy'))).toThrow(/not registered on the book/)
    expect(() => led.decide(grant('autonomy', { key: AGENT.priv }))).toThrow(/not registered on the book/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('who reads what: every reader selects through the anchored selectors', () => {
  it('isAnchored: trusted_keys and the registry anchor; unanchored and unknown (no via) do not', () => {
    expect(isAnchored({ via: 'trusted_keys' })).toBe(true)
    expect(isAnchored({ via: 'registry' })).toBe(true)
    expect(isAnchored({ via: 'unanchored' })).toBe(false)
    expect(isAnchored({})).toBe(false)
    // the ledger door's own list carries no `via`: the rung selectors give it no effect
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const e = led.decide(grant('gate'))
    expect(e.via).toBeUndefined()
    expect(grantInForce([e as DecisionEntry], WF)).toBeUndefined()
    expect(grantInForce(led.decisionBook().decisions, WF)?.decision_id).toBe(e.decision_id)
  })

  it('snapshots: a live ledger\'s snapshot carries its own anchors; a chain export or a JSON copy carries none', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 9, fails: 6 })
    led.decide(grant('gate'))
    const live = snapshotOfLedger(led)
    expect(openSnapshot(live).decisions.map(d => d.via)).toEqual(['trusted_keys'])
    expect(promotionOpinion({ snapshot: live, policy: TINY, workflow_id: WF }).subject).toMatchObject({ granted: 'gate', rung_source: 'BOOK' })
    // no JSON body can claim a ledger's anchors: the carried read is held off the object
    for (const bare of [snapshotFromChainJSONL(led.chainJSONL()), JSON.parse(JSON.stringify(live)), structuredClone(live)]) {
      expect(openSnapshot(bare).decisions.map(d => d.via)).toEqual(['unanchored'])
      expect(promotionOpinion({ snapshot: bare, policy: TINY, workflow_id: WF, consequence_tier: 'low' }).subject).toMatchObject({ granted: 'record' })
    }
    // explicit anchors always win over the carried read
    expect(openSnapshot(live, { trusted_keys: { someone: AGENT.pub } }).content_verified).toBe(false)
    // the carried read applies only to the exact bytes it was made from: edit the carried arrays and it no longer applies
    evidence(led, { passes: 1, from: 29 })
    const edited = snapshotOfLedger(led)
    expect(openSnapshot(edited).decisions.map(d => d.via)).toEqual(['trusted_keys'])
    edited.events!.pop(); edited.payloads!.pop()
    expect(openSnapshot(edited).decisions.map(d => d.via)).toEqual(['unanchored'])
  })

  it('the door, handed readDecisionBook\'s entries, checks a decline against the ANCHORED grant in force', () => {
    // A root-keyed book whose legacy prefix holds an unanchored grant, and a person's decline of the record → advise
    // promotion the readers raise (made under no grant). With `via`, the door agrees with the readers.
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    led.decide(selfGrant('autonomy'))
    led.decide(reg('owner', OWNER, ['grant_signer']))
    evidence(led, { fails: 5, from: 25 })
    const a = assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low' })
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record' })
    const d = declineDecision(a, { signer_id: 'owner', signed_at: iso(), reason: 'not yet' })
    expect(d.under_grant).toBeUndefined()
    const db = led.decisionBook()
    expect(decisionConflict(d, [...db.decisions, ...db.canaries])).toBeUndefined()
    expect(() => led.decide(signDecision(d, OWNER.priv))).not.toThrow() // (folded into decide() on 2026-09-28)
  })
})
