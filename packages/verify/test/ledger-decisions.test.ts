/**
 * A person's decisions as signed ledger events (wave 2, ledger lane, 2026-09-28). The design ruling is the spec:
 *   - ONLY A PERSON MOVES A RUNG, BOTH WAYS. The rung is read from the book of record (the GRANT in force), never a flag;
 *     nothing an agent can do (record, review, assess, forge, tamper, pass a flag) moves it. Property-tested.
 *   - GRANT (rung, policy version hash, tier, bounds, who, when), DECLINE (a "keep it" that is not re-raised until the
 *     evidence changes) and POLICY_REVISION (who, when, why, what changed, the superseded hash) are Ed25519-signed, appended
 *     to the hash chain, and re-verified by verifyContent().
 *   - The flag path keeps working, unchanged; the book path is the flag path plus a citation.
 */
import { describe, it, expect, afterEach } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { verify, openSnapshot, snapshotOfLedger, signVerdict, generateSigningKeypair, type Verdict } from '../src/index'
import {
  createLedger, openFileLedger, parseChainJSONL, MemoryLedger, signDecision, verifySignedDecision, decisionProblem, decisionId,
  makeGrant, readDecisionBook, DecisionRefused, DECISION_LEVELS, DECISION_SIGNING_PREFIX, payloadHash, entryHash, GENESIS,
  type Ledger, type GrantDecision, type SignedDecision, type TrustedKeys, type LedgerEvent,
} from '../src/ledger/index'
import {
  assessVoice, assessVoiceFromLedger, declineDecision, declineStanding, grantForProposal, policyRevisionDecision, revisePolicy,
  workflowCalibration, policyRef, lintPolicy, levelRank, VOICE_LADDER, EXAMPLE_PROMOTION_POLICY, ACTION_HANDLING,
  type PromotionPolicy, type VoiceAssessment, type VoiceLevel,
} from '../src/verdict/voice'
import { canonicalize } from '../src/verdict/canonical'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

// ── deterministic keys (a fixed 32-byte seed → the same Ed25519 key every run) ──────────────────────────────────────────
function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = keyFromSeed('11'.repeat(32))
const LEAD = keyFromSeed('22'.repeat(32))
const AGENT = keyFromSeed('33'.repeat(32))
const TRUSTED: TrustedKeys = { owner: OWNER.publicKeyPem, 'ap-lead': [LEAD.publicKeyPem] }

/** A small, lint-clean policy so promotions and demotions both happen within a few dozen reviews. ◇ illustrative only. */
const TINY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'tiny-test', version: '1.0.0', method: 'wilson',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const WF = 'acme/invoice@0.0.1'

let clock = Date.parse('2026-09-28T09:00:00Z')
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()

const PASSES: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...clean, invoice_number: `DP-${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))
const FAILS: Verdict[] = Array.from({ length: 40 }, (_, i) => verify({ ...broken, invoice_number: `DF-${i}` }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))

function grant(level: VoiceLevel, o: { signer?: string; key?: string; policy?: PromotionPolicy; tier?: string; bounds?: string; at?: string } = {}): SignedDecision<GrantDecision> {
  const d = makeGrant({
    workflow_id: WF, level, consequence_tier: o.tier ?? 'low', policy: policyRef(o.policy ?? TINY),
    ...(level === 'autonomy' || o.bounds !== undefined ? { bounds: o.bounds ?? 'PO-matched invoices under $5,000' } : {}),
    signer_id: o.signer ?? 'owner', signed_at: o.at ?? '2026-09-28T09:00:00Z',
  })
  return signDecision(d, o.key ?? OWNER.privateKeyPem)
}

/** Record `n` PASS / FAIL verdicts from the pools (starting at `from`) and review them, the first `over` OVERTURNED. */
function evidence(led: Ledger, o: { passes?: number; fails?: number; passOver?: number; failOver?: number; from?: number }): void {
  const from = o.from ?? 0
  for (let i = 0; i < (o.passes ?? 0); i++) { const v = PASSES[from + i]!; led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: i < (o.passOver ?? 0) ? 'OVERTURNED' : 'UPHELD' }) }
  for (let i = 0; i < (o.fails ?? 0); i++) { const v = FAILS[from + i]!; led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: i < (o.failOver ?? 0) ? 'OVERTURNED' : 'UPHELD' }) }
}

const assess = (led: Ledger, extra: { trusted_keys?: TrustedKeys } = {}): VoiceAssessment =>
  assessVoiceFromLedger(led, WF, TINY, { consequence_tier: 'low', ...extra })

const paths: string[] = []
const tmpPath = (): string => { const p = join(tmpdir(), `verify-decisions-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`); paths.push(p); return p }
afterEach(() => { for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p) })

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('signed decisions: sign, verify, refuse', () => {
  it('a signed GRANT verifies; its id is deterministic; the rung ladder mirrors VOICE_LADDER', () => {
    const s = grant('gate')
    expect(verifySignedDecision(s)).toEqual({ ok: true, anchored: false })
    expect(verifySignedDecision(s, { trusted_keys: TRUSTED })).toEqual({ ok: true, anchored: true })
    expect(s.decision_id).toBe(decisionId(s.decision))
    expect(grant('gate').decision_id).toBe(s.decision_id)                  // same decision, same id
    expect(grant('gate').signature).toBe(s.signature)                      // Ed25519 is deterministic for a fixed key
    expect([...DECISION_LEVELS]).toEqual([...VOICE_LADDER])
  })

  it('domain separation: a signature over the bare canonical body (or a verdict envelope\'s) never passes as a decision', () => {
    const s = grant('gate')
    const bare = edSign(null, Buffer.from(canonicalize(s.decision), 'utf8'), createPrivateKey(OWNER.privateKeyPem)).toString('base64')
    expect(verifySignedDecision({ ...s, signature: bare }).ok).toBe(false)
    const env = signVerdict(PASSES[0]!, OWNER.privateKeyPem)
    expect(verifySignedDecision({ ...s, signature: env.signature }).ok).toBe(false)
    expect(DECISION_SIGNING_PREFIX).toBe('riposte:decision:v0\n')
  })

  it('tampering is caught: an edited rung, a re-derived id, a swapped key', () => {
    const s = grant('advise')
    const edited = structuredClone(s); (edited.decision as GrantDecision).level = 'gate'
    expect(verifySignedDecision(edited)).toMatchObject({ ok: false, reason: expect.stringMatching(/decision_id does not derive/) })
    edited.decision_id = decisionId(edited.decision)
    expect(verifySignedDecision(edited)).toMatchObject({ ok: false, reason: expect.stringMatching(/signature does not verify/) })
    expect(verifySignedDecision({ ...s, public_key: AGENT.publicKeyPem })).toMatchObject({ ok: false, reason: expect.stringMatching(/signature does not verify/) })
    expect(verifySignedDecision({ ...s, alg: 'rsa' }).ok).toBe(false)
    expect(verifySignedDecision({ ...s, extra: 1 }).ok).toBe(false)
  })

  it('anchoring: with trusted keys, only the key anchored to the signer passes', () => {
    const agentAsOwner = grant('autonomy', { key: AGENT.privateKeyPem })
    expect(verifySignedDecision(agentAsOwner)).toEqual({ ok: true, anchored: false }) // signed, but by whom?
    expect(verifySignedDecision(agentAsOwner, { trusted_keys: TRUSTED })).toMatchObject({ ok: false, reason: expect.stringMatching(/not the one anchored to signer 'owner'/) })
    const stranger = grant('gate', { signer: 'agent-7', key: AGENT.privateKeyPem })
    expect(verifySignedDecision(stranger, { trusted_keys: TRUSTED })).toMatchObject({ ok: false, reason: expect.stringMatching(/'agent-7' has no anchored key/) })
    expect(verifySignedDecision(grant('gate', { signer: 'ap-lead', key: LEAD.privateKeyPem }), { trusted_keys: TRUSTED })).toEqual({ ok: true, anchored: true })
  })

  it('refuses malformed decisions: unknown fields, no person, no zone, autonomy without bounds, a wrong-way decline, a revision that disagrees with its body', () => {
    const g = grant('gate').decision
    expect(decisionProblem({ ...g, extra: 1 })).toMatch(/unknown field\(s\) extra/)
    expect(decisionProblem({ ...g, signer_id: ' ' })).toMatch(/needs signer_id/)
    expect(decisionProblem({ ...g, signed_at: '2026-09-28' })).toMatch(/ISO-8601/)
    expect(decisionProblem({ ...g, level: 'overlord' })).toMatch(/level must be one of/)
    expect(() => makeGrant({ workflow_id: WF, level: 'autonomy', consequence_tier: 'low', policy: policyRef(TINY), signer_id: 'owner', signed_at: '2026-09-28T09:00:00Z' })).toThrow(/must state the bounds/)
    expect(() => signDecision({ ...g, policy: { ...g.policy, hash: 'x' } } as GrantDecision, OWNER.privateKeyPem)).toThrow(DecisionRefused)
    const decline = { decision_version: 'decision-v0', kind: 'DECLINE', workflow_id: WF, proposal_id: 'p', proposal_kind: 'DEMOTION_PROPOSAL', from: 'gate', to: 'autonomy', consequence_tier: 'low', policy: policyRef(TINY), reason: 'keep it', seen: { calibration_hash: 'a'.repeat(64), rungs: [], failing_cases: [], blockers: [] }, signer_id: 'owner', signed_at: '2026-09-28T09:00:00Z' }
    expect(decisionProblem(decline)).toMatch(/one rung down/)
    expect(decisionProblem({ ...decline, to: 'advise', reason: '' })).toMatch(/needs a reason/)
    expect(decisionProblem({ ...decline, to: 'advise' })).toBeUndefined()
    const revised = revisePolicy(TINY, { version: '1.1.0', method: 'clopper-pearson' }, { revised_by: 'owner', revised_at: '2026-09-28T10:00:00Z', reason: 'exact bounds' })
    const rd = policyRevisionDecision(revised)
    expect(decisionProblem(rd)).toBeUndefined()
    expect(decisionProblem({ ...rd, reason: 'something else' })).toMatch(/policy_body\.revision must record exactly this decision/)
    expect(decisionProblem({ ...rd, policy: { ...rd.policy, hash: 'b'.repeat(64) } })).toMatch(/does not match policy_body/)
    expect(() => policyRevisionDecision(TINY)).toThrow(/not a revision/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the ledger door for decisions (ledger.decide)', () => {
  it('appends a GRANT as a signed chain event: subject, ledger clock, content-verified, decisions() lists it', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 2 })
    const e = led.decide(grant('gate'))
    const ev = led.events()[e.seq]!
    expect(ev).toMatchObject({ type: 'GRANT', verdict_id: `workflow:${WF}`, ts: e.recorded_at, entry_hash: e.entry_hash })
    expect(led.chainHead()).toBe(e.entry_hash)
    expect(led.verifyContent()).toMatchObject({ ok: true, length: 5 })
    expect(led.decisions().map(d => d.decision_id)).toEqual([e.decision_id])
    const book = led.decisionBook()
    expect(book).toMatchObject({ ok: true, unanchored: [] })
    expect(book.decisions[0]!.signed.decision).toMatchObject({ kind: 'GRANT', level: 'gate', signer_id: 'owner' })
    expect(led.all()).toHaveLength(2) // a decision changes no record
  })

  it('refuses (and appends nothing for) a forged, tampered or unanchored decision', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const head = led.chainHead()
    const tampered = grant('advise'); (tampered.decision as GrantDecision).level = 'autonomy'; (tampered.decision as GrantDecision).bounds = 'all'; tampered.decision_id = decisionId(tampered.decision)
    for (const bad of [grant('autonomy', { key: AGENT.privateKeyPem }), grant('gate', { signer: 'agent-7', key: AGENT.privateKeyPem }), tampered, { hello: 'world' } as unknown as SignedDecision]) {
      expect(() => led.decide(bad)).toThrow(DecisionRefused)
    }
    expect(led.chainHead()).toBe(head)
    expect(led.events()).toHaveLength(0)
  })

  it('a caller mutating its object after decide() cannot reach the book', () => {
    const led = createLedger({ now: tick })
    const s = grant('advise')
    led.decide(s)
    ;(s.decision as GrantDecision).level = 'autonomy'
    expect(led.decisionBook().decisions[0]!.signed.decision).toMatchObject({ level: 'advise' })
    expect(led.verifyContent().ok).toBe(true)
  })

  it('a DECLINE must answer a proposal under the grant in force; a policy version names one body', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { fails: 5, failOver: 0 })
    const a0 = assess(led) // nothing granted: advise is earned → a promotion proposal from record
    expect(a0.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise' })
    const staleDecline = signDecision(declineDecision(a0, { signer_id: 'owner', signed_at: '2026-09-28T09:10:00Z', reason: 'not yet' }), OWNER.privateKeyPem)
    const g = led.decide(grant('record'))
    expect(() => led.decide(staleDecline)).toThrow(/names no grant|grant in force/)
    const fromGate = declineDecision(assess(led), { signer_id: 'owner', signed_at: '2026-09-28T09:11:00Z', reason: 'not yet' })
    expect(fromGate.under_grant).toBe(g.decision_id)
    expect(() => led.decide(signDecision({ ...fromGate, from: 'gate', to: 'autonomy' }, OWNER.privateKeyPem))).toThrow(/runs from record, not gate/)
    expect(() => led.decide(signDecision(fromGate, OWNER.privateKeyPem))).not.toThrow()

    const rev = policyRevisionDecision(revisePolicy(TINY, { version: '1.1.0', method: 'clopper-pearson' }, { revised_by: 'owner', revised_at: '2026-09-28T10:00:00Z', reason: 'exact bounds' }))
    led.decide(signDecision(rev, OWNER.privateKeyPem))
    const rival = policyRevisionDecision(revisePolicy(TINY, { version: '1.1.0', tiers: [{ ...TINY.tiers[0]!, confidence: 0.95 }] }, { revised_by: 'owner', revised_at: '2026-09-28T10:05:00Z', reason: 'other' }))
    expect(() => led.decide(signDecision(rival, OWNER.privateKeyPem))).toThrow(/already on the book/)
    const underRival = grant('advise', { policy: rival.policy_body })
    expect(() => led.decide(underRival)).toThrow(/names another body under the same version/)
    expect(led.verifyContent().ok).toBe(true)
  })

  it('a file ledger persists decisions; a reopened book verifies with the same head, and survives a second reopen', () => {
    const path = tmpPath()
    const led = openFileLedger(path, { now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 3, fails: 3 })
    led.decide(grant('advise'))
    const a1 = assess(led, { trusted_keys: TRUSTED })
    const reopened = openFileLedger(path, { trusted_keys: TRUSTED })
    expect(reopened.chainHead()).toBe(led.chainHead())
    expect(reopened.verifyContent().ok).toBe(true)
    expect(reopened.decisionBook().decisions).toEqual(led.decisionBook().decisions)
    expect(assess(reopened, { trusted_keys: TRUSTED }).assessment_hash).toBe(a1.assessment_hash)
    expect(openSnapshot(snapshotOfLedger(reopened))).toMatchObject({ content_verified: true, source: 'chain' }) // the opinion's reader tolerates decision events
    // The opinion's rebuild ignores decision events and agrees with the ledger on every record it defines (it does not refresh
    // verdict.ledger.reviewer on a REVIEW; the ledger does: a pre-existing, opinion-side difference, noted for its owner).
    const core = (r: { verdict: Verdict; tenant_id: string; recorded_at: string; review?: unknown }) => ({ id: r.verdict.verdict_id, outcome: r.verdict.outcome, tenant: r.tenant_id, at: r.recorded_at, review: r.review })
    expect(openSnapshot(snapshotOfLedger(reopened)).records.map(core)).toEqual(reopened.all().map(core))
  })

  it('an attacker who rewrites a GRANT on disk and re-hashes the whole chain is still caught (the signature)', () => {
    const path = tmpPath()
    const led = openFileLedger(path, { now: tick })
    evidence(led, { passes: 2 })
    led.decide(grant('advise'))
    evidence(led, { fails: 1, from: 10 })
    const { events, payloads } = parseChainJSONL(readFileSync(path, 'utf8'))
    const gi = events.findIndex(e => e.type === 'GRANT')
    ;(payloads[gi] as { signed: { decision: GrantDecision } }).signed.decision.level = 'autonomy'
    ;(payloads[gi] as { signed: { decision: GrantDecision } }).signed.decision.bounds = 'everything'
    // Re-derive every hash from the edited payload onward, so the chain itself is internally consistent again.
    let prev = gi === 0 ? GENESIS : events[gi - 1]!.entry_hash
    for (let i = gi; i < events.length; i++) {
      const ph = payloadHash(payloads[i]); const eh = entryHash(i, prev, ph)
      events[i] = { ...events[i]!, payload_hash: ph, prev_hash: prev, entry_hash: eh }; prev = eh
    }
    writeFileSync(path, events.map((e, i) => JSON.stringify({ ...e, payload: payloads[i] })).join('\n') + '\n')
    const forged = openFileLedger(path)
    expect(forged.verifyChain().ok).toBe(true)                              // the links are whole
    expect(forged.verifyContent()).toMatchObject({ ok: false, brokenAt: gi }) // but the decision is not the person's
    expect(forged.verifyContent().reason).toMatch(/decision_id does not derive|signature does not verify/)
    expect(() => assess(forged)).toThrow(/does not verify .* grants nothing/)
  })

  it('a relabelled event header is caught (type and subject are not in entry_hash; the content check holds them to the payload)', () => {
    const led = createLedger({ now: tick })
    evidence(led, { passes: 1 })
    led.decide(grant('advise'))
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const relabelled: LedgerEvent[] = events.map(e => (e.type === 'GRANT' ? { ...e, type: 'REVIEW' } : e))
    expect(readDecisionBook(relabelled, payloads)).toMatchObject({ ok: false, check: { brokenAt: 2, reason: expect.stringMatching(/labelled REVIEW but its hashed payload is GRANT/) } })
    const resubjected = events.map(e => (e.type === 'GRANT' ? { ...e, verdict_id: 'workflow:elsewhere' } : e))
    expect(readDecisionBook(resubjected, payloads).check.reason).toMatch(/header \(subject, ts\) does not match/)
    const reRecord = events.map((e, i) => (i === 0 ? { ...e, verdict_id: 'f'.repeat(32) } : e))
    expect(readDecisionBook(reRecord, payloads).check.reason).toMatch(/does not match its hashed RECORD payload/)
    expect(new MemoryLedger({ seed: { events: relabelled, payloads } }).verifyContent().ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('assessVoice reads the rung from the book of record', () => {
  it('nothing granted: the rung is record; the tier must be declared', () => {
    const led = createLedger({ now: tick })
    evidence(led, { passes: 2 })
    const a = assess(led)
    expect(a).toMatchObject({ granted: 'record', level: 'record', book: { length: 4 } })
    expect(a.book!.grant).toBeUndefined()
    expect(() => assessVoiceFromLedger(led, WF, TINY)).toThrow(/no GRANT .* no consequence_tier/)
  })

  it('the GRANT in force sets the rung, tier, bounds and policy, and the assessment cites it (the decision an opinion would amend)', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6 })
    const e = led.decide(grant('autonomy', { bounds: 'PO-matched invoices under $5,000' }))
    const a = assessVoiceFromLedger(led, WF, TINY) // no tier needed once a grant is in force
    expect(a).toMatchObject({ granted: 'autonomy', level: 'autonomy', consequence_tier: 'low', bounds: 'PO-matched invoices under $5,000' })
    expect(a.grant).toEqual({ level: 'autonomy', signer_id: 'owner', signed_at: '2026-09-28T09:00:00Z', policy: policyRef(TINY), consequence_tier: 'low' })
    expect(a.book!.grant).toEqual({ decision_id: e.decision_id, seq: e.seq, entry_hash: e.entry_hash })
    // D-ANCHOR (security fix): was `unanchored_signers: ['owner']` on an unanchored ledger, where the grant still took effect.
    // An unanchored grant now has no effect (test/security-anchor.test.ts), so this grant is read on an anchored book.
    expect(a.book!.unanchored_signers).toBeUndefined()
    expect(a.book!.no_effect).toBeUndefined()
  })

  it('the book path is the flag path plus a citation: identical rung, evidence and proposal', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6, failOver: 2 })
    led.decide(grant('gate'))
    const viaBook = assess(led)
    const cal = workflowCalibration(led.all(), WF)
    const viaFlag = assessVoice(cal, { workflow_id: WF, consequence_tier: 'low', granted: 'gate', grant: viaBook.grant! }, TINY)
    const { book: _b, assessment_hash: _h1, ...restBook } = viaBook
    const { assessment_hash: _h2, ...restFlag } = viaFlag
    expect(restBook).toEqual(restFlag)
    expect('book' in viaFlag).toBe(false)
    expect(viaBook.proposal?.kind).toBe('DEMOTION_PROPOSAL')
  })

  it('a flag cannot override the book; the book cannot be assessed under other settings', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 3 })
    led.decide(grant('advise'))
    const cal = workflowCalibration(led.all(), WF)
    expect(() => assessVoice(cal, { workflow_id: WF, book: led, granted: 'autonomy' } as never, TINY)).toThrow(/A flag cannot override a person's signed grant/)
    expect(assessVoice(cal, { workflow_id: WF, book: led, granted: 'advise' } as never, TINY).level).toBe('advise')
    expect(() => assessVoice(cal, { workflow_id: WF, book: led, consequence_tier: 'severe' }, TINY)).toThrow(/Settings are fixed at grant time/)
    expect(() => assessVoice(cal, { workflow_id: WF, book: led }, EXAMPLE_PROMOTION_POLICY)).toThrow(/Settings are fixed at grant time/)
    const empty = createLedger({ now: tick })
    expect(() => assessVoice(workflowCalibration([], WF), { workflow_id: WF, book: empty, consequence_tier: 'low', granted: 'gate' } as never, TINY)).toThrow(/the rung is record, not gate/)
  })

  it('a chain export reads exactly like the live ledger (same assessment hash)', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 4, fails: 4, failOver: 1 })
    led.decide(grant('gate'))
    const cal = workflowCalibration(led.all(), WF)
    const live = assessVoice(cal, { workflow_id: WF, book: led }, TINY)
    // D-ANCHOR: a bare chain export carries no anchors, so the reader names them (the live ledger uses its own).
    const exported = assessVoice(cal, { workflow_id: WF, book: parseChainJSONL(led.chainJSONL()), trusted_keys: TRUSTED }, TINY)
    expect(exported.assessment_hash).toBe(live.assessment_hash)
    expect(() => assessVoice(cal, { workflow_id: WF, book: { events: [] } as never }, TINY)).toThrow(/book must be a Ledger or a chain export/)
  })

  it('a POLICY_REVISION on the book is cited; the grant stands under its own version until a person re-grants', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6 })
    led.decide(grant('gate'))
    const revised = revisePolicy(TINY, { version: '1.1.0', method: 'clopper-pearson' }, { revised_by: 'owner', revised_at: '2026-09-28T10:00:00Z', reason: 'exact bounds for small samples' })
    const re = led.decide(signDecision(policyRevisionDecision(revised), OWNER.privateKeyPem))
    const a = assess(led)
    expect(a.level).toBe('gate')
    expect(a.policy).toEqual(policyRef(TINY))
    expect(a.book!.superseded_by).toEqual([{ policy: policyRef(revised), decision_id: re.decision_id, seq: re.seq, lints: true }])
    expect(re.signed.decision).toMatchObject({ supersedes: policyRef(TINY), changes: ['method wilson → clopper-pearson'], reason: 'exact bounds for small samples', signer_id: 'owner' })
    expect(() => assessVoiceFromLedger(led, WF, revised)).toThrow(/Settings are fixed at grant time/)
    led.decide(grant('gate', { policy: revised, at: '2026-09-28T10:05:00Z' }))
    const b = assessVoiceFromLedger(led, WF, revised)
    expect(b).toMatchObject({ level: 'gate', policy: policyRef(revised) })
    expect(b.book!.superseded_by).toBeUndefined()
    expect(lintPolicy(revised).ok).toBe(true)
  })

  it('a person moves the rung both ways, and only by a signed grant', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6 })
    const seen: VoiceLevel[] = []
    for (const level of ['autonomy', 'advise', 'gate', 'record'] as VoiceLevel[]) { led.decide(grant(level)); seen.push(assess(led).level) }
    expect(seen).toEqual(['autonomy', 'advise', 'gate', 'record'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('DECLINE: a person\'s "keep it" is recorded, and not re-raised until the evidence changes', () => {
  it('an urgent demotion, declined: held back while nothing new counts against the grant; re-raised on a new failing case', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    evidence(led, { passes: 9, fails: 6, failOver: 2 })
    led.decide(grant('gate'))
    const a1 = assess(led)
    expect(a1.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'gate', to: 'advise' })
    const failing = (a1.proposal as { failing_cases: { verdict_id: string }[] }).failing_cases.map(c => c.verdict_id).sort()
    const dec = declineDecision(a1, { signer_id: 'owner', signed_at: '2026-09-28T11:00:00Z', reason: 'keep it: both were credit notes, a known class' })
    expect(dec.seen.failing_cases).toEqual(failing)
    const de = led.decide(signDecision(dec, OWNER.privateKeyPem))

    const a2 = assess(led)
    expect(a2.proposal).toBeUndefined()                                   // not re-raised
    expect(a2.level).toBe('gate')                                         // and the rung never moved
    expect(a2.earned).toBe(a1.earned)
    expect(a2.book!.declined).toMatchObject({ decision_id: de.decision_id, seq: de.seq, signer_id: 'owner', proposal_kind: 'DEMOTION_PROPOSAL', declined_proposal_id: a1.proposal!.proposal_id, suppressed_proposal_id: a1.proposal!.proposal_id, reason: expect.stringMatching(/credit notes/) })
    expect(a2.book!.declined!.re_raise_when).toMatch(/new failing case/)

    evidence(led, { fails: 2, from: 20 })                                 // two more clean (UPHELD) FAIL reviews: 2/8, still short of gate
    const a3 = assess(led)
    expect(a3.proposal).toBeUndefined()                                   // clean reviews never re-raise a declined demotion
    expect(a3.book!.declined!.suppressed_proposal_id).not.toBe(a1.proposal!.proposal_id) // the evidence grew, the case against did not

    evidence(led, { fails: 1, failOver: 1, from: 30 })                    // a NEW overturned FAIL
    const a4 = assess(led)
    expect(a4.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true })
    expect(a4.book!.declined).toBeUndefined()
    expect(a4.book!.decline_lapsed).toMatchObject({ decision_id: de.decision_id, why: expect.stringMatching(new RegExp(`1 new failing case\\(s\\) \\(${FAILS[30]!.verdict_id}\\)`)) })
    expect(a4.level).toBe('gate')
  })

  it('a promotion, declined: held back until a fresh sample of the proposed rung\'s own min_n accrues', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { fails: 3 })
    const a1 = assess(led)
    expect(a1.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise' })
    led.decide(signDecision(declineDecision(a1, { signer_id: 'owner', signed_at: '2026-09-28T11:00:00Z', reason: 'not until month-end close' }), OWNER.privateKeyPem))
    evidence(led, { fails: 2, from: 3 })
    const a2 = assess(led)
    expect(a2.proposal).toBeUndefined()
    expect(a2.book!.declined!.why).toMatch(/2 of 3 fresh reviewed FAIL verdict\(s\)/)
    expect(a2.book!.declined!.re_raise_when).toMatch(/1 more reviewed FAIL/)
    evidence(led, { fails: 1, from: 5 })
    const a3 = assess(led)
    expect(a3.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', to: 'advise' })
    expect(a3.book!.decline_lapsed!.why).toMatch(/3 fresh reviewed FAIL verdict\(s\) since the decline ≥ advise's min_n 3/)
    expect(a3.level).toBe('record')
  })

  it('a re-grant voids the declines made under the old grant; a person\'s "yes" is a grant that answers the proposal', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6, failOver: 2 })
    led.decide(grant('gate'))
    const a1 = assess(led)
    led.decide(signDecision(declineDecision(a1, { signer_id: 'owner', signed_at: '2026-09-28T11:00:00Z', reason: 'keep it' }), OWNER.privateKeyPem))
    expect(assess(led).proposal).toBeUndefined()
    led.decide(grant('gate', { at: '2026-09-28T12:00:00Z' }))           // a fresh grant at the same rung
    const a2 = assess(led)
    expect(a2.proposal?.kind).toBe('DEMOTION_PROPOSAL')                  // the old "keep it" does not carry over
    const yes = led.decide(signDecision(grantForProposal(a2.proposal!, { signer_id: 'owner', signed_at: '2026-09-28T12:05:00Z' }), OWNER.privateKeyPem))
    expect(yes.signed.decision).toMatchObject({ kind: 'GRANT', level: 'advise', answers: a2.proposal!.proposal_id })
    expect(assess(led).level).toBe('advise')
  })

  it('declineStanding is pure and direction-aware', () => {
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's decision has effect
    evidence(led, { passes: 9, fails: 6, failOver: 2 })
    led.decide(grant('gate'))
    const a = assess(led)
    const d = declineDecision(a, { signer_id: 'owner', signed_at: '2026-09-28T11:00:00Z', reason: 'keep it' })
    expect(declineStanding(d, a.proposal!, a.blockers).stands).toBe(true)
    expect(declineStanding(d, a.proposal!, ['a new blocker']).stands).toBe(false)
    expect(declineStanding({ ...d, seen: { ...d.seen, failing_cases: [] } }, a.proposal!, a.blockers)).toMatchObject({ stands: false, why: expect.stringMatching(/2 new failing case/) })
    expect(() => declineDecision({ ...a, proposal: undefined } as VoiceAssessment, { signer_id: 'k', signed_at: '2026-09-28T11:00:00Z', reason: 'r' })).toThrow(/no proposal/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('PROPERTY (the design ruling, on the book of record): only a person moves the rung, in either direction', () => {
  it('across random interleavings of evidence, reviews, grants, declines, forgeries and tampering, the rung is exactly the last signed grant', () => {
    let s = 0
    const rnd = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 0x100000000 }
    const tally = { promote: 0, demote: 0, up: 0, down: 0, declined: 0, refused: 0, suppressed: 0 }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      s = seed * 7919
      const led = createLedger({ now: tick, trusted_keys: TRUSTED })
      let expected: VoiceLevel = 'record'
      let prev: VoiceLevel = 'record'
      const recorded: string[] = []
      for (let step = 0; step < 70; step++) {
        const r = rnd()
        let moved = false
        if (r < 0.25) {
          const v = PASSES[Math.floor(rnd() * PASSES.length)]!; led.record(v, { tenant_id: 'acme' }); recorded.push(v.verdict_id)
        } else if (r < 0.45) {
          const v = FAILS[Math.floor(rnd() * FAILS.length)]!; led.record(v, { tenant_id: 'acme' }); recorded.push(v.verdict_id)
        } else if (r < 0.75) {
          if (recorded.length) led.review(recorded[Math.floor(rnd() * recorded.length)]!, { reviewer_id: 'ap-lead', decision: rnd() < 0.15 ? 'OVERTURNED' : 'UPHELD' })
        } else if (r < 0.83) {
          const level = VOICE_LADDER[Math.floor(rnd() * 4)]!
          const signer = rnd() < 0.5 ? 'owner' : 'ap-lead'
          led.decide(grant(level, { signer, key: signer === 'owner' ? OWNER.privateKeyPem : LEAD.privateKeyPem, at: iso() }))
          if (levelRank(level) > levelRank(expected)) tally.up++
          if (levelRank(level) < levelRank(expected)) tally.down++
          expected = level; moved = true
        } else if (r < 0.90) {
          const a = assess(led)
          if (a.proposal) { led.decide(signDecision(declineDecision(a, { signer_id: 'ap-lead', signed_at: iso(), reason: 'keep it' }), LEAD.privateKeyPem)); tally.declined++ }
        } else if (r < 0.95) {
          const level = VOICE_LADDER[Math.floor(rnd() * 4)]!                     // an agent forges a grant with its own key
          expect(() => led.decide(grant(level, { key: AGENT.privateKeyPem, at: iso() }))).toThrow(DecisionRefused); tally.refused++
        } else {
          const t = grant('autonomy', { at: iso() }); (t.decision as GrantDecision).consequence_tier = 'severe' // tampered after signing
          expect(() => led.decide(t)).toThrow(DecisionRefused); tally.refused++
          const cal = workflowCalibration(led.all(), WF)                          // an agent passes a flag: refused unless it agrees
          const other = VOICE_LADDER.find(l => l !== expected)!
          expect(() => assessVoice(cal, { workflow_id: WF, book: led, consequence_tier: 'low', granted: other } as never, TINY)).toThrow(/the rung is read from the book of record/)
        }
        const a = assess(led)
        expect(a.level).toBe(expected)
        expect(a.granted).toBe(expected)
        expect(a.handling).toEqual(ACTION_HANDLING[expected])
        if (!moved) expect(a.level).toBe(prev)                                    // nothing but a person's grant moved it
        if (a.proposal?.kind === 'PROMOTION_PROPOSAL') { tally.promote++; expect(levelRank(a.proposal.to)).toBe(levelRank(expected) + 1) }
        // E4 (security fix): `urgent` was true on every demotion; it is now exactly basis === 'failure'.
        if (a.proposal?.kind === 'DEMOTION_PROPOSAL') { tally.demote++; expect(levelRank(a.proposal.to)).toBe(levelRank(expected) - 1); expect(a.proposal.urgent).toBe(a.proposal.basis === 'failure') }
        if (a.book!.declined) tally.suppressed++
        prev = a.level
      }
      expect(led.verifyContent().ok).toBe(true)
      const reopened = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), trusted_keys: TRUSTED })
      expect(assess(reopened).assessment_hash).toBe(assess(led).assessment_hash)
    }
    // Not vacuous: both proposal kinds were raised, the rung moved both ways, declines held proposals back, forgeries were refused.
    expect(tally.promote).toBeGreaterThan(0)
    expect(tally.demote).toBeGreaterThan(0)
    expect(tally.up).toBeGreaterThan(0)
    expect(tally.down).toBeGreaterThan(0)
    expect(tally.declined).toBeGreaterThan(0)
    expect(tally.suppressed).toBeGreaterThan(0)
    expect(tally.refused).toBeGreaterThan(0)
  })
})

describe('the Ed25519 envelope and the decision signer share keys', () => {
  it('a keypair from generateSigningKeypair signs decisions', () => {
    const k = generateSigningKeypair()
    const s = signDecision(makeGrant({ workflow_id: WF, level: 'advise', consequence_tier: 'low', policy: policyRef(TINY), signer_id: 'p', signed_at: '2026-09-28T09:00:00+02:00' }), k.privateKeyPem)
    expect(verifySignedDecision(s, { trusted_keys: { p: k.publicKeyPem } })).toEqual({ ok: true, anchored: true })
  })
})
