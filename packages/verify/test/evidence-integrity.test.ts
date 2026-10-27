/**
 * Evidence integrity, the book side (2026-09-28): so the evidence behind a grant cannot quietly rot or be gamed.
 *   - VERIFIABLE RANDOM SELECTION: a period's review queue is drawn with a seed fixed by the chain head when the period closed;
 *     anyone re-derives it; a committed SAMPLE that does not re-derive breaks the book.
 *   - SURVEILLANCE: under an autonomy grant a declared fraction of PASSes still goes to a person, and a new miss (or an
 *     untested drawn item) raises an urgent demotion PROPOSAL. It never demotes (the design ruling, property-tested).
 *   - RANDOM-SELECTION-ONLY EVIDENCE, SIGNED REVIEWS, SEGREGATION OF DUTIES, CANARIES (reviewer attention).
 *   - THE KEY REGISTRY: KEY_REGISTER / KEY_REVOKE under a registry root key, roles, rotation, revocation, tenant scope (F-B).
 */
import { describe, it, expect } from 'vitest'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type Verdict } from '../src/index'
import {
  createLedger, MemoryLedger, parseChainJSONL, signDecision, makeGrant, makeReview, makeKeyRegister, makeKeyRevoke,
  readDecisionBook, DecisionRefused, SampleRefused, deriveSample, drawStratum, sampleSeed, chainPeriods, periodAt, recordWorkflow,
  payloadHash, entryHash, GENESIS, canaryCommitment,
  type Ledger, type SignedDecision, type TrustedKeys, type LedgerEvent, type Role, type SampleBody,
} from '../src/ledger/index'
import {
  assessVoiceFromLedger, declineDecision, defaultWorkflowOf, levelRank, lintPolicy, revisePolicy, VOICE_LADDER, ACTION_HANDLING, policyRef,
  policyRevisionDecision as policyRevisionDecisionOf,
  type PromotionPolicy, type TierRequirements, type DemotionProposal, type VoiceAssessment, type VoiceLevel,
} from '../src/verdict/voice'
import { commitDueSamples, reviewQueue, dueSamples, sealCanaries, revealCanaries, reviewsBy, samplingRates, chainOf } from '../src/surveillance/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

// ── deterministic keys, clock, verdicts ────────────────────────────────────────────────────────────────────────────
function keyFromSeed(seedHex: string): { priv: string; pub: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const ROOT = keyFromSeed('a1'.repeat(32))
const OWNER = keyFromSeed('11'.repeat(32))
const LEAD = keyFromSeed('22'.repeat(32))
const AGENT = keyFromSeed('33'.repeat(32))
const AUTHOR = keyFromSeed('44'.repeat(32))
const OWNER2 = keyFromSeed('55'.repeat(32))
const GLOBEX = keyFromSeed('66'.repeat(32))
const TRUSTED: TrustedKeys = { owner: OWNER.pub, 'ap-lead': LEAD.pub, author: AUTHOR.pub }

let clock = 0
const at = (iso: string): void => { clock = Date.parse(iso) }
const tick = (): Date => new Date((clock += 60_000))
/** Jump to 09:00 UTC on the next calendar day. */
const nextDay = (): void => { const d = new Date(clock + 86_400_000); clock = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9) }
const iso = (): string => new Date(clock).toISOString()

const PASSES: Verdict[] = Array.from({ length: 160 }, (_, i) => verify({ ...clean, invoice_number: `EI-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 60 }, (_, i) => verify({ ...broken, invoice_number: `EI-F${i}` }, { now: FIXED_NOW }))
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`

const bars = { advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }
function policy(id: string, extra: Partial<TierRequirements>): PromotionPolicy {
  return { policy_version: 'promotion-policy-v0', policy_id: id, version: '1.0.0', method: 'wilson', sidedness: 'one-sided', tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, ...bars, ...extra }] }
}
const SURV = policy('surv', { sampling: { period: 'day', surveillance_rate: 0.5 } })
const RS = policy('rs', { sampling: { period: 'day', review_rate: 0.5 }, evidence: { random_selection: true } })
const CAN = policy('can', { evidence: { canaries: { min_n: 3, min_catch_rate: 0.5 } } })
const SEG = policy('seg', { evidence: { segregation: true } })
const SIG = policy('sig', { evidence: { signed_reviews: true } })

function grant(level: VoiceLevel, o: { pol: PromotionPolicy; signer?: string; key?: string; wf?: string }): SignedDecision {
  return signDecision(makeGrant({
    workflow_id: o.wf ?? WF, level, consequence_tier: 'low', policy: { policy_id: o.pol.policy_id, version: o.pol.version, hash: hashOfPolicy(o.pol) },
    ...(level === 'autonomy' ? { bounds: 'PO-matched invoices under $5,000' } : {}), signer_id: o.signer ?? 'owner', signed_at: iso(),
  }), o.key ?? OWNER.priv)
}
const hashOfPolicy = (p: PromotionPolicy): string => policyRef(p).hash

const assess = (led: Ledger, pol: PromotionPolicy, extra: { trusted_keys?: TrustedKeys; root_keys?: string[] } = {}): VoiceAssessment =>
  assessVoiceFromLedger(led, WF, pol, { consequence_tier: 'low', ...extra })

function recordAll(led: Ledger, vs: readonly Verdict[], tenant = 'acme'): string[] {
  return vs.map(v => { led.record(v, { tenant_id: tenant }); return v.verdict_id })
}
function reviewAll(led: Ledger, ids: readonly string[], decision: 'UPHELD' | 'OVERTURNED' = 'UPHELD', reviewer = 'ap-lead'): void {
  for (const id of ids) led.review(id, { reviewer_id: reviewer, decision })
}

/** Re-derive every hash from `from` onward, so an edited payload leaves an internally consistent chain (an attacker's best). */
function rehash(events: LedgerEvent[], payloads: unknown[], from: number): void {
  let prev = from === 0 ? GENESIS : events[from - 1]!.entry_hash
  for (let i = from; i < events.length; i++) {
    const ph = payloadHash(payloads[i]); const eh = entryHash(i, prev, ph)
    events[i] = { ...events[i]!, payload_hash: ph, prev_hash: prev, entry_hash: eh }; prev = eh
  }
}

it('the test policies lint clean', () => {
  for (const p of [SURV, RS, CAN, SEG, SIG]) expect(lintPolicy(p)).toMatchObject({ ok: true, errors: [] })
  expect(recordWorkflow({ type: 'RECORD', tenant_id: 'acme', verdict: PASSES[0] })).toBe(WF)
  expect(defaultWorkflowOf({ tenant_id: 'acme', verdict: PASSES[0]! } as never)).toBe(WF) // the ledger's frame key mirrors voice's
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('verifiable random selection: the draw is fixed by the book, and anyone re-derives it', () => {
  function twoDays(): Ledger {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick })
    recordAll(led, PASSES.slice(0, 20)); recordAll(led, FAILS.slice(0, 10))
    nextDay()
    recordAll(led, PASSES.slice(20, 21)) // the first day-2 event closes day 1
    return led
  }
  const DAY1 = '2026-09-01T00:00:00.000Z'

  it('a closed period\'s draw: the seed is the epoch (the day\'s last event), the sizes are ⌈rate × N⌉, and the SAMPLE re-derives', () => {
    const led = twoDays()
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const d = deriveSample(events, payloads, { workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0.25, FAIL: 0.5 } }) as SampleBody
    expect(d).toMatchObject({ period: { unit: 'day', start: DAY1, end: '2026-09-02T00:00:00.000Z' }, frame: { first_seq: 0, last_seq: 29 }, closed_by: 30, population: { PASS: 20, FAIL: 10 } })
    expect(d.epoch).toEqual({ seq: 29, entry_hash: events[29]!.entry_hash })
    expect(d.seed).toBe(sampleSeed(WF, 'day', DAY1, events[29]!.entry_hash))
    expect([d.selected.PASS.length, d.selected.FAIL.length]).toEqual([5, 5])
    const e = led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0.25, FAIL: 0.5 } })
    expect(e.sample).toEqual(d)
    expect(led.events()[e.seq]).toMatchObject({ type: 'SAMPLE', verdict_id: `sample:${WF}:day:${DAY1}` })
    const book = led.decisionBook()
    expect(book.ok).toBe(true)
    expect(book.samples.map(s => s.sample)).toEqual([d])
    // Anyone holding the export re-derives the same queue, and a reopened book is the same book.
    const reopened = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()) })
    expect(reopened.decisionBook().samples).toEqual(book.samples)
    expect(reopened.chainHead()).toBe(led.chainHead())
  })

  it('the door refuses an open period, an empty one, a bad rate, and the same draw twice, appending nothing', () => {
    const led = twoDays()
    const head = led.chainHead()
    const DAY2 = '2026-09-02T00:00:00.000Z'
    expect(() => led.commitSample({ workflow_id: WF, unit: 'day', start: DAY2, rates: { PASS: 0.5, FAIL: 0.5 } })).toThrow(/has not closed/)
    expect(() => led.commitSample({ workflow_id: 'globex/x@1', unit: 'day', start: DAY1, rates: { PASS: 0.5, FAIL: 0.5 } })).toThrow(/nothing to draw/)
    expect(() => led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 1.5, FAIL: 0 } })).toThrow(SampleRefused)
    expect(() => led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0, FAIL: 0 } })).toThrow(/draws something/)
    expect(() => led.commitSample({ workflow_id: WF, unit: 'week' as never, start: DAY1, rates: { PASS: 0.5, FAIL: 0.5 } })).toThrow(/period unit/)
    expect(led.chainHead()).toBe(head)
    led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0.5, FAIL: 0.5 } })
    expect(() => led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0.5, FAIL: 0.5 } })).toThrow(/already committed/)
  })

  it('a doctored queue is caught on read, even when the attacker re-derives every hash', () => {
    const led = twoDays()
    led.commitSample({ workflow_id: WF, unit: 'day', start: DAY1, rates: { PASS: 0.25, FAIL: 0.5 } })
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const si = events.findIndex(e => e.type === 'SAMPLE')
    const s = (payloads[si] as { sample: SampleBody }).sample
    const notDrawn = PASSES.slice(0, 20).map(v => v.verdict_id).find(id => !s.selected.PASS.includes(id))!
    s.selected.PASS = [...s.selected.PASS.slice(1), notDrawn].sort() // swap in an easy item
    rehash(events, payloads, si)
    const bk = readDecisionBook(events, payloads)
    expect(bk).toMatchObject({ ok: false, check: { brokenAt: si } })
    expect(bk.check.reason).toMatch(/does not re-derive from the chain/)
    expect(new MemoryLedger({ seed: { events, payloads } }).verifyContent().ok).toBe(false)
  })

  it('draws are nested across rates, exact in size, and uniform: every item is drawn at about the rate', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${String(i).padStart(3, '0')}`)
    const seed = sampleSeed(WF, 'day', DAY1, 'e'.repeat(64))
    let prev: string[] = []
    for (const rate of [0.1, 0.2, 0.5, 0.9, 1]) {
      const d = drawStratum(ids, seed, 'PASS', rate)
      expect(d).toHaveLength(Math.ceil(rate * 50 - 1e-9))
      expect(prev.every(id => d.includes(id))).toBe(true) // nested
      prev = d
    }
    const hits = new Map(ids.map(id => [id, 0]))
    const SEEDS = 400
    for (let s = 0; s < SEEDS; s++) for (const id of drawStratum(ids, sampleSeed(WF, 'day', DAY1, s.toString(16).padStart(64, '0')), 'PASS', 0.2)) hits.set(id, hits.get(id)! + 1)
    for (const [, h] of hits) { expect(h / SEEDS).toBeGreaterThan(0.1); expect(h / SEEDS).toBeLessThan(0.3) }
  })

  it('periods follow the running maximum of the clock: a clock stepping backwards does not reopen a closed day', () => {
    const ev = (ts: string): LedgerEvent => ({ seq: 0, ts, type: 'RECORD', verdict_id: 'x', payload_hash: '', prev_hash: '', entry_hash: '' })
    const spans = chainPeriods([ev('2026-09-01T10:00:00Z'), ev('2026-09-02T10:00:00Z'), ev('2026-09-01T23:00:00Z'), ev('2026-09-03T01:00:00Z')], 'day')
    expect(spans.map(s => [s.start.slice(0, 10), s.first_seq, s.last_seq, s.closed_by])).toEqual([
      ['2026-09-01', 0, 0, 1], ['2026-09-02', 1, 2, 3], ['2026-09-03', 3, 3, undefined],
    ])
    expect(periodAt(Date.parse('2026-08-15T12:00:00Z'), 'quarter')).toEqual({ start: '2026-07-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' })
  })

  it('samplingRates: review_rate at record/advise, a census at gate, surveillance_rate of PASSes (and every FAIL) at autonomy', () => {
    const t = { sampling: { period: 'day' as const, review_rate: 0.2, surveillance_rate: 0.05 } }
    expect(VOICE_LADDER.map(l => samplingRates(t, l))).toEqual([{ PASS: 0.2, FAIL: 0.2 }, { PASS: 0.2, FAIL: 0.2 }, { PASS: 1, FAIL: 1 }, { PASS: 0.05, FAIL: 1 }])
    expect(samplingRates({}, 'autonomy')).toEqual({ PASS: 0, FAIL: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('surveillance under autonomy: the evidence keeps flowing, and a new miss raises a PROPOSAL, never a demotion', () => {
  it('a drawn post-grant miss raises an URGENT failure-basis demotion proposal while the pooled bound still clears; a decline holds it; the next miss lapses it; an untested item counts', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's grant has effect
    const p1 = recordAll(led, PASSES.slice(0, 10)); reviewAll(led, p1)
    const f1 = recordAll(led, FAILS.slice(0, 5)); reviewAll(led, f1)
    expect(assess(led, SURV).earned).toBe('autonomy')
    led.decide(grant('autonomy', { pol: SURV }))
    const a1 = assess(led, SURV)
    expect([a1.level, a1.earned, a1.proposal]).toEqual(['autonomy', 'autonomy', undefined])
    expect(a1.book!.evidence!.surveillance).toMatchObject({ rate: 0.5, period: 'day', drawn: 0, misses: [], untested: [] })

    nextDay() // day 2: autonomy, twenty PASSes proceed unreviewed
    recordAll(led, PASSES.slice(10, 30))
    nextDay() // day 3: one event closes day 2
    recordAll(led, PASSES.slice(30, 31))
    const committed = commitDueSamples(led, WF, SURV)
    expect(committed.map(e => [e.sample.period.start.slice(0, 10), e.sample.rates])).toEqual([['2026-09-01', { PASS: 0.5, FAIL: 1 }], ['2026-09-02', { PASS: 0.5, FAIL: 1 }]])
    expect(dueSamples(chainOf(led.chainJSONL()), led.decisionBook(), WF, SURV)).toEqual([]) // nothing left to commit
    const queue = reviewQueue(led, WF, SURV)
    expect(queue).toHaveLength(10) // half of day 2's twenty PASSes; day 1's drawn items were already reviewed
    expect(queue.every(q => q.stratum === 'PASS' && q.rung === 'autonomy' && q.due_by === '2026-09-04T00:00:00.000Z')).toBe(true)
    expect(assess(led, SURV).proposal).toBeUndefined() // drawn, not yet due: pending, not a finding

    reviewAll(led, queue.slice(0, 9).map(q => q.verdict_id))
    const missed = queue[9]!.verdict_id
    led.review(missed, { reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: 'paid the wrong remit-to' })
    const a3 = assess(led, SURV)
    expect(a3.level).toBe('autonomy')                                   // a person's decision; never moved
    expect(a3.rungs[2]!.cleared).toBe(true)                              // the pooled bound (1 miss in 20) still clears 30%
    const d3 = a3.proposal as DemotionProposal
    expect(d3).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, basis: 'failure', from: 'autonomy', to: 'gate', earned: 'autonomy' })
    expect(d3.failing_cases).toEqual([{ verdict_id: missed, rung: 'autonomy', outcome: 'PASS', dispute: expect.stringContaining(missed), why: expect.stringMatching(/after the autonomy grant that a person overturned/) }])
    expect(d3.reasons.join(' ')).toMatch(/surveillance: 1 post-grant finding\(s\) under autonomy \(1 overturned, 0 untested\)/)
    expect(a3.book!.evidence!.surveillance).toMatchObject({ drawn: 10, reviewed: 10, pending: 0, misses: [missed] })

    // A person keeps autonomy ("keep it"): recorded, and not re-raised while nothing new counts against the grant.
    led.decide(signDecision(declineDecision(a3, { signer_id: 'owner', signed_at: iso(), reason: 'one miss; vendor master fixed' }), OWNER.priv))
    const a4 = assess(led, SURV)
    expect(a4.proposal).toBeUndefined()
    expect(a4.book!.declined).toMatchObject({ proposal_kind: 'DEMOTION_PROPOSAL' })

    // A person notices another bad PASS (not drawn): evidence against counts wherever it was found. The decline lapses.
    const drawnIds = new Set(queue.map(q => q.verdict_id))
    const other = PASSES.slice(10, 30).map(v => v.verdict_id).find(id => !drawnIds.has(id))!
    led.review(other, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    const a5 = assess(led, SURV)
    expect(a5.level).toBe('autonomy')
    expect(a5.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure' })
    expect(a5.book!.decline_lapsed!.why).toMatch(/1 new failing case/)

    // Day 3's drawn PASS is due by the end of day 4. Nobody reviews it; day 4 closes; it is UNTESTED: a deviation.
    nextDay(); recordAll(led, PASSES.slice(31, 32)); commitDueSamples(led, WF, SURV)
    nextDay(); recordAll(led, PASSES.slice(32, 33))
    const a6 = assess(led, SURV)
    const untested = a6.book!.evidence!.surveillance!.untested
    expect(untested).toEqual([PASSES[30]!.verdict_id])
    expect((a6.proposal as DemotionProposal).failing_cases.find(c => c.verdict_id === untested[0])!.why).toMatch(/untested item is a deviation \(AS 2315 \.40\)/)
    expect(a6.level).toBe('autonomy')
    expect(led.verifyContent().ok).toBe(true)
  })

  it('surveillance never moves the rung, and a re-grant starts the post-grant window afresh (the person saw everything)', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED }) // D-ANCHOR: only an anchored signer's grant has effect
    reviewAll(led, recordAll(led, PASSES.slice(0, 10))); reviewAll(led, recordAll(led, FAILS.slice(0, 5)))
    led.decide(grant('autonomy', { pol: SURV }))
    const bad = recordAll(led, PASSES.slice(10, 11))
    led.review(bad[0]!, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    expect(assess(led, SURV).proposal).toMatchObject({ basis: 'failure' })
    led.decide(grant('autonomy', { pol: SURV })) // a person re-grants knowing it
    const a = assess(led, SURV)
    expect(a.level).toBe('autonomy')
    expect(a.book!.evidence!.surveillance!.misses).toEqual([])
    expect(a.proposal).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('random selection: only drawn reviews count; evidence against counts wherever a person found it', () => {
  function drawnDay(): { led: Ledger; queue: string[]; passes: string[]; fails: string[] } {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick })
    const passes = recordAll(led, PASSES.slice(0, 20)), fails = recordAll(led, FAILS.slice(0, 20))
    nextDay(); recordAll(led, PASSES.slice(20, 21))
    commitDueSamples(led, WF, RS, { consequence_tier: 'low' })
    return { led, queue: reviewQueue(led, WF, RS, { consequence_tier: 'low' }).map(q => q.verdict_id), passes, fails }
  }

  it('hand-picked clean reviews are set aside; drawn ones count once their draw is complete', () => {
    const { led, queue, passes, fails } = drawnDay()
    expect(queue).toHaveLength(20) // ⌈0.5 × 20⌉ PASS + ⌈0.5 × 20⌉ FAIL
    reviewAll(led, [...passes, ...fails]) // a reviewer reviews EVERYTHING, UPHELD
    const a = assess(led, RS)
    const ev = a.book!.evidence!
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', from: 'record', to: 'advise', earned: 'autonomy' }) // drawn evidence carries a promotion
    expect(ev.set_aside).toHaveLength(20)
    expect(ev.set_aside.every(s => !queue.includes(s.verdict_id) && /not drawn by the random selection/.test(s.why))).toBe(true)
    expect(a.rungs.map(r => r.n)).toEqual([10, 10, 10]) // only the drawn half counts
    expect(ev.selection!.draws[0]).toMatchObject({ status: 'complete', reviewed: 20, pending: 0, untested: 0, committed: true })
  })

  it('an easy half reviewed early does not carry a promotion: clean drawn reviews are HELD while the draw is open', () => {
    const { led, queue } = drawnDay()
    const drawnPasses = queue.filter(id => PASSES.some(v => v.verdict_id === id))
    reviewAll(led, drawnPasses) // PASSes only; the drawn FAILs wait
    const a = assess(led, RS)
    expect(a.book!.evidence!.held).toEqual([...drawnPasses].sort())
    expect(a.rungs[2]!.n).toBe(0)
    reviewAll(led, queue.filter(id => !drawnPasses.includes(id)))
    expect(assess(led, RS).rungs[2]!.n).toBe(10)
  })

  it('an overturned review counts even if nobody drew it; a drawn item unreviewed past its deadline is a deviation', () => {
    const { led, queue, fails } = drawnDay()
    const offQueue = fails.find(id => !queue.includes(id))!
    led.review(offQueue, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    const a = assess(led, RS)
    expect(a.rungs[0]).toMatchObject({ n: 1, errors: 1 }) // advise's false-flag rate sees it
    nextDay(); recordAll(led, PASSES.slice(21, 22)) // a day-3 event: day 1's draw was due by the end of day 2
    const b = assess(led, RS)
    expect(b.book!.evidence!.untested.PASS.length + b.book!.evidence!.untested.FAIL.length).toBe(20)
    expect(b.rungs[2]).toMatchObject({ n: 10, errors: 10 })
    expect(b.rungs[2]!.untested).toHaveLength(10)
    expect(b.book!.evidence!.selection!.draws[0]!.status).toBe('overdue')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('canaries: reviewer attention, measured without telling the reviewer', () => {
  const SALT = 'ab'.repeat(16)
  function withCanaries(decideCanary: 'UPHELD' | 'OVERTURNED'): { led: Ledger; canaries: string[] } {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const fails = recordAll(led, FAILS.slice(0, 8)); reviewAll(led, fails)
    const passes = recordAll(led, PASSES.slice(0, 12))
    const canaries = [passes[2]!, passes[5]!, passes[9]!].sort()
    const seal = led.decide(signDecision(sealCanaries({ workflow_id: WF, verdict_ids: canaries, salt: SALT, signer_id: 'author', signed_at: iso() }), AUTHOR.priv))
    expect(JSON.stringify(led.events()[seal.seq]) + JSON.stringify(parseChainJSONL(led.chainJSONL()).payloads[seal.seq])).not.toMatch(new RegExp(canaries.join('|'))) // the label is hidden
    for (const id of passes) led.review(id, { reviewer_id: 'ap-lead', decision: canaries.includes(id) ? decideCanary : 'UPHELD' })
    led.decide(grant('gate', { pol: CAN }))
    const sealEntry = led.decisionBook().canaries.find(c => c.decision_id === seal.decision_id)!
    led.decide(signDecision(revealCanaries(sealEntry as never, { verdict_ids: canaries, salt: SALT, signed_at: iso() }), AUTHOR.priv))
    return { led, canaries }
  }

  it('a rubber-stamping reviewer (every canary UPHELD): attention not shown, no overturn rate counts, a failure-basis proposal', () => {
    const { led, canaries } = withCanaries('UPHELD')
    const a = assess(led, CAN)
    expect(a.book!.evidence!.canaries).toMatchObject({ sealed: 1, revealed: 1, outstanding: 0, reviewed: 3, caught: 0, missed: canaries, lower_bound: 0, requirement: { min_n: 3, min_catch_rate: 0.5, shown: false } })
    expect(a.blockers.join(' ')).toMatch(/reviewer attention is not shown: the 90% one-sided wilson lower bound on the catch rate is 0% \(0\/3 caught\) < floor 50%/)
    expect(a.earned).toBe('record')
    expect(a.level).toBe('gate')
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure' })
  })

  it('an attentive reviewer (every canary caught): attention shown; the canaries are set aside, never counted as misses', () => {
    const { led, canaries } = withCanaries('OVERTURNED')
    const a = assess(led, CAN)
    expect(a.book!.evidence!.canaries).toMatchObject({ reviewed: 3, caught: 3, missed: [], requirement: { shown: true } })
    expect(a.book!.evidence!.canaries!.lower_bound).toBeGreaterThan(0.64)
    expect(a.book!.evidence!.set_aside.map(s => s.verdict_id)).toEqual(canaries)
    expect(a.rungs[2]).toMatchObject({ n: 9, errors: 0 }) // 12 PASSes less 3 canaries; the overturned canaries are not misses
    expect(a.blockers).toEqual([])
  })

  it('a reveal must reproduce its seal: wrong salt, another signer, twice, or an unrecorded id is refused', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const ids = recordAll(led, PASSES.slice(0, 3))
    const seal = led.decide(signDecision(sealCanaries({ workflow_id: WF, verdict_ids: ids, salt: SALT, signer_id: 'author', signed_at: iso() }), AUTHOR.priv))
    const entry = led.decisionBook().canaries[0]! as never
    expect(() => revealCanaries(entry, { verdict_ids: ids, salt: 'cd'.repeat(16), signed_at: iso() })).toThrow(/do not reproduce/)
    const forged = { decision_version: 'decision-v0', kind: 'CANARY_REVEAL', workflow_id: WF, seal: seal.decision_id, verdict_ids: [...ids].sort(), salt: 'cd'.repeat(16), signer_id: 'author', signed_at: iso() } as const
    expect(() => led.decide(signDecision(forged as never, AUTHOR.priv))).toThrow(/do not reproduce seal/)
    expect(() => led.decide(signDecision({ ...forged, salt: SALT, signer_id: 'owner' } as never, OWNER.priv))).toThrow(/only its sealer reveals it/)
    const good = revealCanaries(entry, { verdict_ids: ids, salt: SALT, signed_at: iso() })
    led.decide(signDecision(good, AUTHOR.priv))
    expect(() => led.decide(signDecision({ ...good, signed_at: iso() }, AUTHOR.priv))).toThrow(/already revealed/)
    const ghost = ['0'.repeat(32)]
    const s2 = led.decide(signDecision(sealCanaries({ workflow_id: WF, verdict_ids: ghost, salt: SALT, signer_id: 'author', signed_at: iso() }), AUTHOR.priv))
    expect(() => led.decide(signDecision({ ...good, seal: s2.decision_id, verdict_ids: ghost }, AUTHOR.priv))).toThrow(/must be recorded on the book before it is revealed/)
    expect(canaryCommitment(WF, [...ids].reverse(), SALT)).toBe(canaryCommitment(WF, ids, SALT)) // over the canonical set
    expect(led.verifyContent().ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('segregation of duties: a grant cannot rest on its own signer\'s clean reviews', () => {
  function reviewedByLead(): Ledger {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    reviewAll(led, recordAll(led, PASSES.slice(0, 10))); reviewAll(led, recordAll(led, FAILS.slice(0, 6)))
    return led
  }
  it('the reviewer signs the grant: their clean reviews are set aside for it, and the evidence no longer carries the rung', () => {
    const led = reviewedByLead()
    led.decide(grant('gate', { pol: SEG, signer: 'ap-lead', key: LEAD.priv }))
    const a = assess(led, SEG)
    expect(a.book!.evidence!.segregation).toMatchObject({ signer: 'ap-lead' })
    expect(a.book!.evidence!.segregation!.set_aside).toHaveLength(16)
    expect(a.book!.evidence!.set_aside[0]!.why).toMatch(/segregation of duties: 'ap-lead' signed the grant in force and reviewed this item/)
    expect(a.rungs.map(r => r.n)).toEqual([0, 0, 0])
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'unevidenced' }) // nothing failed; the independent evidence is absent
    expect(reviewsBy(chainOf(led.chainJSONL()).events, chainOf(led.chainJSONL()).payloads, WF, 'ap-lead')).toHaveLength(16)
  })
  it('another person signs: the same reviews carry it; the signer\'s own OVERTURNED reviews always count', () => {
    const led = reviewedByLead()
    led.decide(grant('gate', { pol: SEG }))
    const a = assess(led, SEG)
    expect(a.book!.evidence!.segregation!.set_aside).toEqual([])
    expect(a.book!.evidence!.reviewers).toEqual(['ap-lead'])
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', to: 'autonomy' })
    const led2 = reviewedByLead()
    led2.review(FAILS[0]!.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    led2.decide(grant('gate', { pol: SEG, signer: 'ap-lead', key: LEAD.priv }))
    expect(assess(led2, SEG).rungs[0]).toMatchObject({ n: 1, errors: 1 }) // against interest: it counts
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('signed REVIEWs: a person\'s signed decision, so an agent cannot manufacture evidence', () => {
  const sr = (id: string, decision: 'UPHELD' | 'OVERTURNED', signer = 'ap-lead', key = LEAD.priv) =>
    signDecision(makeReview({ verdict_id: id, decision, procedure: 're-performed', signer_id: signer, signed_at: iso() }), key)

  it('reviewSigned: the REVIEW event carries the signature; the book lists it; a reopened book is the same book', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const [id] = recordAll(led, PASSES.slice(0, 1))
    const r = led.reviewSigned(sr(id!, 'OVERTURNED'))
    expect(r.review).toMatchObject({ reviewer_id: 'ap-lead', decision: 'OVERTURNED' })
    const bk = led.decisionBook()
    expect(bk.signed_reviews).toEqual([expect.objectContaining({ verdict_id: id, tenant_id: 'acme', signer_id: 'ap-lead', decision: 'OVERTURNED', procedure: 're-performed', via: 'trusted_keys' })])
    const reopened = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), trusted_keys: TRUSTED })
    expect(reopened.all()).toEqual(led.all())
    expect(reopened.decisionBook().signed_reviews).toEqual(bk.signed_reviews)
  })

  it('the door refuses a forged, unanchored, misrouted or unrecorded review; a tampered one breaks the book', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const [id] = recordAll(led, PASSES.slice(0, 1))
    expect(() => led.reviewSigned(sr(id!, 'UPHELD', 'ap-lead', AGENT.priv))).toThrow(/not the one anchored to signer 'ap-lead'/)
    expect(() => led.reviewSigned(sr(id!, 'UPHELD', 'agent-7', AGENT.priv))).toThrow(/'agent-7' has no anchored key/)
    expect(() => led.reviewSigned(sr('f'.repeat(32), 'UPHELD'))).toThrow(/not recorded/)
    expect(() => led.decide(sr(id!, 'UPHELD') as never)).toThrow(/append a signed review with reviewSigned/)
    led.reviewSigned(sr(id!, 'UPHELD'))
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const ri = events.findIndex(e => e.type === 'REVIEW')
    ;(payloads[ri] as { review: { decision: string } }).review.decision = 'OVERTURNED' // the stored review no longer matches the signed one
    rehash(events, payloads, ri)
    expect(readDecisionBook(events, payloads, { trusted_keys: TRUSTED }).check.reason).toMatch(/does not match the body its reviewer signed/)
  })

  it('a tier that requires signed reviews sets aside unsigned ones, and anchored signatures count', () => {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, trusted_keys: TRUSTED })
    const passes = recordAll(led, PASSES.slice(0, 10)), fails = recordAll(led, FAILS.slice(0, 6))
    reviewAll(led, passes) // unsigned
    for (const id of fails) led.reviewSigned(sr(id, 'UPHELD'))
    const a = assess(led, SIG)
    expect(a.book!.evidence!.set_aside.filter(s => /an unsigned review/.test(s.why))).toHaveLength(10)
    expect(a.rungs.map(r => r.n)).toEqual([6, 6, 0])
    expect(a.earned).toBe('gate')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the key registry on the book: roles, rotation, revocation, tenant scope, anchored to a registry root key', () => {
  const reg = (subject: string, key: { pub: string }, roles: Role[], o: { by?: { id: string; priv: string }; tenants?: string[] } = {}) =>
    signDecision(makeKeyRegister({ subject_id: subject, public_key: key.pub, roles, ...(o.tenants ? { tenants: o.tenants } : {}), signer_id: o.by?.id ?? 'root', signed_at: iso() }), o.by?.priv ?? ROOT.priv)
  function registry(): Ledger {
    at('2026-09-01T09:00:00Z')
    const led = createLedger({ now: tick, root_keys: [ROOT.pub] })
    reviewAll(led, recordAll(led, PASSES.slice(0, 10))); reviewAll(led, recordAll(led, FAILS.slice(0, 6)))
    led.decide(grant('advise', { pol: SURV })) // the legacy prefix: before the registry, a signer is only unanchored
    led.decide(reg('owner', OWNER, ['grant_signer']))
    led.decide(reg('ap-lead', LEAD, ['reviewer']))
    led.decide(reg('author', AUTHOR, ['policy_author']))
    return led
  }

  it('once in force, trusted keys are read from the book: role holders pass, others are refused (nothing appended)', () => {
    const led = registry()
    led.decide(grant('gate', { pol: SURV }))
    const head = led.chainHead()
    expect(() => led.decide(grant('autonomy', { pol: SURV, signer: 'ap-lead', key: LEAD.priv }))).toThrow(/holds reviewer; this needs the 'grant_signer' role/)
    expect(() => led.decide(grant('autonomy', { pol: SURV, key: AGENT.priv }))).toThrow(/not registered on the book/)
    expect(() => led.decide(reg('agent', AGENT, ['grant_signer'], { by: { id: 'agent', priv: AGENT.priv } }))).toThrow(/root key or a registered 'key_admin'/)
    expect(() => led.decide(reg('agent', AGENT, ['grant_signer'], { by: { id: 'ap-lead', priv: LEAD.priv } }))).toThrow(/root key or a registered 'key_admin'/)
    expect(() => led.decide(reg('owner', OWNER, ['reviewer']))).toThrow(/already registered/)
    expect(() => led.reviewSigned(signDecision(makeReview({ verdict_id: PASSES[0]!.verdict_id, decision: 'UPHELD', signer_id: 'owner', signed_at: iso() }), OWNER.priv))).toThrow(/needs the 'reviewer' role/)
    expect(led.chainHead()).toBe(head)
    led.reviewSigned(signDecision(makeReview({ verdict_id: PASSES[0]!.verdict_id, decision: 'UPHELD', signer_id: 'ap-lead', signed_at: iso() }), LEAD.priv))
    const bk = led.decisionBook()
    expect(bk.ok).toBe(true)
    expect(bk.registry!.keys.map(k => [k.subject_id, k.roles])).toEqual([['owner', ['grant_signer']], ['ap-lead', ['reviewer']], ['author', ['policy_author']]])
    expect(bk.unanchored).toEqual(['owner']) // only the pre-registry grant: the past is read, not rewritten
    expect(bk.signed_reviews[0]!.via).toBe('registry')
    const bare = led.decisionBook({ root_keys: [] })
    expect(bare.registry).toBeUndefined() // without the root the registry anchors nothing, and says so
  })

  it('revocation is prospective and final; rotation is register-new; self-revocation is allowed', () => {
    const led = registry()
    const before = led.decide(grant('gate', { pol: SURV }))
    led.decide(signDecision(makeKeyRevoke({ subject_id: 'owner', public_key: OWNER.pub, reason: 'laptop lost', signer_id: 'root', signed_at: iso() }), ROOT.priv))
    expect(() => led.decide(grant('autonomy', { pol: SURV }))).toThrow(/was revoked at position \d+ \(laptop lost\)/)
    expect(() => led.decide(reg('owner', OWNER, ['grant_signer']))).toThrow(/revoked .* never re-registered/)
    led.decide(reg('owner', OWNER2, ['grant_signer']))
    led.decide(grant('autonomy', { pol: SURV, key: OWNER2.priv }))
    led.decide(signDecision(makeKeyRevoke({ subject_id: 'ap-lead', public_key: LEAD.pub, reason: 'rotating', signer_id: 'ap-lead', signed_at: iso() }), LEAD.priv))
    const bk = led.decisionBook()
    expect(bk.ok).toBe(true) // the grant made before the revocation stays valid
    expect(bk.decisions.map(d => d.decision_id)).toContain(before.decision_id)
    expect(bk.registry!.keys.filter(k => k.revoked).map(k => [k.subject_id, k.revoked!.reason])).toEqual([['owner', 'laptop lost'], ['ap-lead', 'rotating']])
  })

  it('a forged key registration spliced into the chain (every hash re-derived) breaks the book', () => {
    const led = registry()
    led.decide(grant('gate', { pol: SURV }))
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const ki = events.findIndex(e => e.type === 'KEY_REGISTER' && e.verdict_id === 'key:ap-lead')
    const forged = reg('ap-lead', AGENT, ['reviewer', 'grant_signer'], { by: { id: 'root', priv: AGENT.priv } }) // not the root's key
    ;(payloads[ki] as { signed: unknown }).signed = forged
    rehash(events, payloads, ki)
    const bk = readDecisionBook(events, payloads, { root_keys: [ROOT.pub] })
    expect(bk).toMatchObject({ ok: false, check: { brokenAt: ki, reason: expect.stringMatching(/registry root key or a registered 'key_admin'/) } })
  })

  it('F-B: a tenant-scoped key decides only for its own tenants; a tenant key_admin registers only within them', () => {
    const led = registry()
    const DEPUTY = keyFromSeed('77'.repeat(32))
    led.decide(reg('globex-ops', GLOBEX, ['grant_signer'], { tenants: ['globex'] }))
    expect(() => led.decide(grant('gate', { pol: SURV, signer: 'globex-ops', key: GLOBEX.priv }))).toThrow(/scoped to tenant\(s\) globex, not acme/)
    led.decide(grant('gate', { pol: SURV, signer: 'globex-ops', key: GLOBEX.priv, wf: 'globex/invoice@0.0.1' }))
    led.decide(reg('globex-admin', DEPUTY, ['key_admin'], { tenants: ['globex'] }))
    const AGENT2 = keyFromSeed('88'.repeat(32))
    expect(() => led.decide(reg('acme-x', AGENT2, ['grant_signer'], { tenants: ['acme'], by: { id: 'globex-admin', priv: DEPUTY.priv } }))).toThrow(/keeps tenant\(s\) globex only/)
    expect(() => led.decide(reg('any-x', AGENT2, ['grant_signer'], { by: { id: 'globex-admin', priv: DEPUTY.priv } }))).toThrow(/keeps tenant\(s\) globex only/)
    led.decide(reg('globex-rev', AGENT2, ['reviewer'], { tenants: ['globex'], by: { id: 'globex-admin', priv: DEPUTY.priv } }))
    expect(() => led.reviewSigned(signDecision(makeReview({ verdict_id: PASSES[0]!.verdict_id, decision: 'UPHELD', signer_id: 'globex-rev', signed_at: iso() }), AGENT2.priv))).toThrow(/scoped to tenant\(s\) globex, not acme/)
    const GAUTHOR = keyFromSeed('99'.repeat(32))
    led.decide(reg('globex-author', GAUTHOR, ['policy_author'], { tenants: ['globex'] }))
    const rev = revisePolicy(SURV, { version: '1.1.0', method: 'clopper-pearson' }, { revised_by: 'globex-author', revised_at: iso(), reason: 'exact' })
    expect(() => led.decide(signDecision(policyRevisionDecisionOf(rev), GAUTHOR.priv))).toThrow(/cannot sign a deployment-wide act/)
    expect(led.decisionBook().ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('PROPERTY (the design ruling, under every new event): only a person moves the rung, in either direction', () => {
  const PROP = policy('prop', { sampling: { period: 'day', review_rate: 0.5, surveillance_rate: 0.5 }, evidence: { random_selection: true, segregation: true } })
  it('across random interleavings of records, reviews (signed and not), draws, grants, declines, days and forgeries, the rung is exactly the last signed grant', () => {
    expect(lintPolicy(PROP).ok).toBe(true)
    let s = 0
    const rnd = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 0x100000000 }
    const tally = { demote: 0, failure: 0, promote: 0, set_aside: 0, samples: 0, refused: 0, moved: 0, surveil: 0 }
    for (const seed of [1, 2, 3, 4]) {
      s = seed * 104729
      at('2026-09-01T09:00:00Z')
      const led = createLedger({ now: tick, trusted_keys: TRUSTED })
      let expected: VoiceLevel = 'record', prev: VoiceLevel = 'record'
      const recorded: string[] = []
      for (let step = 0; step < 90; step++) {
        const r = rnd()
        let moved = false
        if (r < 0.20) { const v = PASSES[Math.floor(rnd() * PASSES.length)]!; led.record(v, { tenant_id: 'acme' }); recorded.push(v.verdict_id) }
        else if (r < 0.30) { const v = FAILS[Math.floor(rnd() * FAILS.length)]!; led.record(v, { tenant_id: 'acme' }); recorded.push(v.verdict_id) }
        else if (r < 0.38) { if (recorded.length) led.review(recorded[Math.floor(rnd() * recorded.length)]!, { reviewer_id: 'ap-lead', decision: rnd() < 0.12 ? 'OVERTURNED' : 'UPHELD' }) }
        else if (r < 0.58) {
          for (const q of reviewQueue(led, WF, PROP, { consequence_tier: 'low' }).slice(0, 4)) {
            led.reviewSigned(signDecision(makeReview({ verdict_id: q.verdict_id, decision: rnd() < 0.06 ? 'OVERTURNED' : 'UPHELD', signer_id: 'ap-lead', signed_at: iso() }), LEAD.priv))
          }
        }
        else if (r < 0.64) { nextDay() }
        else if (r < 0.70) { tally.samples += commitDueSamples(led, WF, PROP, { consequence_tier: 'low' }).length }
        else if (r < 0.80) {
          const level = VOICE_LADDER[Math.floor(rnd() * 4)]!
          const lead = rnd() < 0.3
          led.decide(grant(level, { pol: PROP, ...(lead ? { signer: 'ap-lead', key: LEAD.priv } : {}) }))
          expected = level; moved = true; tally.moved++
        } else if (r < 0.88) {
          const a = assess(led, PROP)
          if (a.proposal) led.decide(signDecision(declineDecision(a, { signer_id: 'owner', signed_at: iso(), reason: 'keep it' }), OWNER.priv))
        } else {
          expect(() => led.decide(grant(VOICE_LADDER[Math.floor(rnd() * 4)]!, { pol: PROP, key: AGENT.priv }))).toThrow(DecisionRefused); tally.refused++
        }
        const a = assess(led, PROP)
        expect(a.level).toBe(expected)
        expect(a.granted).toBe(expected)
        expect(a.handling).toEqual(ACTION_HANDLING[expected])
        if (!moved) expect(a.level).toBe(prev)
        if (a.proposal?.kind === 'DEMOTION_PROPOSAL') { tally.demote++; if (a.proposal.basis === 'failure') tally.failure++; expect(levelRank(a.proposal.to)).toBe(levelRank(expected) - 1) }
        if (a.proposal?.kind === 'PROMOTION_PROPOSAL') { tally.promote++; expect(levelRank(a.proposal.to)).toBe(levelRank(expected) + 1) }
        if (a.book?.evidence?.set_aside.length) tally.set_aside++
        if (a.book?.evidence?.surveillance) tally.surveil++
        prev = a.level
      }
      expect(led.verifyContent().ok).toBe(true)
      const reopened = new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()), trusted_keys: TRUSTED })
      expect(assess(reopened, PROP).assessment_hash).toBe(assess(led, PROP).assessment_hash)
    }
    // Not vacuous: grants moved it, proposals of both kinds were raised, draws were committed, evidence was set aside.
    expect((['demote', 'failure', 'promote', 'set_aside', 'samples', 'refused', 'moved'] as const).filter(k => tally[k] === 0)).toEqual([])
  })
})
