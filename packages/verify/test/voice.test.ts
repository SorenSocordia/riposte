/**
 * Credence-gated voice: per-workflow calibration from the ledger → a declared, versioned policy → what the evidence supports,
 * and a PROPOSAL when that differs from what a person granted. The design ruling (2026-09-28) is the spec:
 *   - the rung changes ONLY by a person's decision: assessVoice never moves it, in either direction (property-tested);
 *   - when the evidence stops supporting the granted rung: an URGENT DEMOTION PROPOSAL, symmetric with promotion, with the
 *     failing cases listed for dispute; one rung at a time, both ways;
 *   - stable settings: the policy is fixed at grant time and versioned; nothing tunes it; a person's revision is recorded;
 *   - each rung carries its own action handling (FAIL/ABSTAIN surfaced at record/advise, held at gate/autonomy);
 *   - the burden of proof scales with the declared consequence tier; pure and deterministic.
 */
import { describe, it, expect } from 'vitest'
import {
  workflowCalibration, workflowCalibrations, assessVoice, assessRung, lintPolicy, calibrationIntact, levelRank, revisePolicy,
  policyRef, consecutiveErrorsToBreach, errorsInHorizonToBreach, cleanReviewsToClear, EXAMPLE_PROMOTION_POLICY, VOICE_LADDER,
  ACTION_HANDLING, type Grant, type DemotionProposal,
  type LedgerRecord, type Outcome, type ReviewDecision, type Verdict, type PromotionPolicy, type VoiceLevel, type WorkflowCalibration,
} from '../src/index'

interface RecOpts { tenant?: string; version?: string; engine?: string; at?: string }
function rec(id: string, outcome: Outcome, decision?: ReviewDecision, o: RecOpts = {}): LedgerRecord {
  const claims = outcome === 'FAIL' ? [{ rule_id: 'SUM_INT', rule_name: 'Law of Footing', outcome: 'FAIL' }] : [{ rule_id: 'SUM_INT', rule_name: 'Law of Footing', outcome }]
  return {
    verdict: { verdict_id: id, outcome, ruleset: { id: 'invoice', version: o.version ?? '0.0.1', domain: 'invoice' }, engine_version: o.engine ?? '0.0.1', claims } as unknown as Verdict,
    tenant_id: o.tenant ?? 'acme',
    recorded_at: o.at ?? '2026-09-01T00:00:00Z',
    retention_until: '2033-09-01T00:00:00Z',
    ...(decision ? { review: { reviewer_id: 'r', decided_at: '2026-09-02T00:00:00Z', decision } } : {}),
  }
}

/** A synthetic book: `pass` reviewed PASSes (the first `passOver` overturned), `fail` reviewed FAILs (the first `failOver` overturned). */
function book(o: { pass: number; fail: number; passOver?: number; failOver?: number; unreviewed?: number } & RecOpts): LedgerRecord[] {
  const out: LedgerRecord[] = []
  const pad = (i: number): string => String(i).padStart(5, '0')
  for (let i = 0; i < o.pass; i++) out.push(rec(`${o.tenant ?? 'acme'}-p${pad(i)}`, 'PASS', i < (o.passOver ?? 0) ? 'OVERTURNED' : 'UPHELD', o))
  for (let i = 0; i < o.fail; i++) out.push(rec(`${o.tenant ?? 'acme'}-f${pad(i)}`, 'FAIL', i < (o.failOver ?? 0) ? 'OVERTURNED' : 'UPHELD', o))
  for (let i = 0; i < (o.unreviewed ?? 0); i++) out.push(rec(`${o.tenant ?? 'acme'}-u${pad(i)}`, 'PASS', undefined, o))
  return out
}

const WF = 'acme/invoice@0.0.1'
const P = EXAMPLE_PROMOTION_POLICY
const decl = (granted: VoiceLevel, tier = 'low', extra = {}) => ({ workflow_id: WF, consequence_tier: tier, granted, ...extra })

describe('workflowCalibration', () => {
  it('counts reviewed and overturned per outcome, and lists the evidence ids (sorted)', () => {
    const cal = workflowCalibration(book({ pass: 5, fail: 4, passOver: 1, failOver: 2, unreviewed: 3 }), WF)
    expect(cal.records).toBe(12)
    expect(cal.by_outcome).toEqual({ PASS: 8, FAIL: 4, INSUFFICIENT_DATA: 0 })
    expect(cal.reviewed).toEqual({ PASS: 5, FAIL: 4, INSUFFICIENT_DATA: 0 })
    expect(cal.overturned).toEqual({ PASS: 1, FAIL: 2, INSUFFICIENT_DATA: 0 })
    expect(cal.evidence.false_pass).toEqual(['acme-p00000'])
    expect(cal.evidence.false_fail).toEqual(['acme-f00000', 'acme-f00001'])
    expect(cal.evidence.reviewed_pass).toEqual([...cal.evidence.reviewed_pass].sort())
    expect(cal.rules[0]).toMatchObject({ rule_id: 'SUM_INT', reviewed: 4, overturned: 2 }) // the ledger's own per-rule signal rides along
    expect(calibrationIntact(cal)).toBe(true)
  })

  it('keys workflows by tenant and ruleset version by default: a new version starts a fresh record', () => {
    const recs = [...book({ pass: 3, fail: 0 }), ...book({ pass: 2, fail: 0, tenant: 'globex' }), rec('v2-a', 'PASS', 'UPHELD', { version: '0.0.2' })]
    expect(workflowCalibrations(recs).map(c => [c.workflow_id, c.records])).toEqual([
      ['acme/invoice@0.0.1', 3], ['acme/invoice@0.0.2', 1], ['globex/invoice@0.0.1', 2],
    ])
    expect(workflowCalibration(recs, 'nobody/x@1').records).toBe(0) // an empty record, not an error
  })

  it('respects the evidence window and a custom workflow key', () => {
    const recs = [rec('a', 'PASS', 'UPHELD', { at: '2026-08-01T00:00:00Z' }), rec('b', 'PASS', 'UPHELD', { at: '2026-09-01T00:00:00Z' }), rec('c', 'PASS', 'UPHELD', { at: '2026-10-01T00:00:00Z' })]
    const cal = workflowCalibration(recs, WF, { since: '2026-08-15T00:00:00Z', until: '2026-10-01T00:00:00Z' })
    expect(cal.evidence.reviewed_pass).toEqual(['b'])
    expect(cal.window).toMatchObject({ since: '2026-08-15T00:00:00Z', until: '2026-10-01T00:00:00Z', first_recorded_at: '2026-09-01T00:00:00Z' })
    const byCell = workflowCalibrations(recs, { workflowOf: r => (r.verdict.verdict_id === 'a' ? undefined : 'cell/IS.Revenue') })
    expect(byCell.map(c => [c.workflow_id, c.records])).toEqual([['cell/IS.Revenue', 2]])
  })

  it('is order-independent (same records, any order → same calibration hash)', () => {
    const recs = book({ pass: 20, fail: 10, passOver: 1, failOver: 3 })
    const a = workflowCalibration(recs, WF), b = workflowCalibration([...recs].reverse(), WF)
    expect(b.calibration_hash).toBe(a.calibration_hash)
  })
})

describe('lintPolicy: the burden of proof never decreases as consequence rises', () => {
  it('the example policy lints clean', () => {
    expect(lintPolicy(P)).toEqual({ ok: true, errors: [] })
  })
  it('rejects a laxer bar on a higher tier, a laxer gate than advise, and malformed bars', () => {
    const lax: PromotionPolicy = structuredClone(P)
    lax.tiers[3]!.autonomy.max_error = 0.05 // severe laxer than high
    expect(lintPolicy(lax).errors.join(' ')).toMatch(/burden decreases with consequence: severe\.autonomy max_error/)
    const fewer: PromotionPolicy = structuredClone(P)
    fewer.tiers[2]!.gate.min_n = 10
    expect(lintPolicy(fewer).errors.join(' ')).toMatch(/gate bar must be at least as strict as the advise bar/)
    const conf: PromotionPolicy = structuredClone(P)
    conf.tiers[1]!.confidence = 0.8
    expect(lintPolicy(conf).errors.join(' ')).toMatch(/moderate confidence 0.8 < low 0.9/)
    const bad: PromotionPolicy = structuredClone(P)
    bad.tiers[0]!.advise.min_n = 0
    bad.tiers[0]!.advise.max_error = 1.5
    ;(bad as { method: string }).method = 'vibes'
    const e = lintPolicy(bad).errors.join(' ')
    expect(e).toMatch(/min_n must be an integer/)
    expect(e).toMatch(/max_error must be in \(0, 1\)/)
    expect(e).toMatch(/method must be/)
    expect(lintPolicy({ ...P, tiers: [] }).ok).toBe(false)
    expect(lintPolicy({ ...P, tiers: [P.tiers[0]!, P.tiers[0]!] }).errors.join(' ')).toMatch(/duplicate tier/)
  })
})

describe('assessVoice', () => {
  const strong = book({ pass: 400, fail: 120, passOver: 0, failOver: 2 }) // clears every rung at 'low' and 'moderate'

  it('an empty record earns nothing and proposes nothing', () => {
    const a = assessVoice(workflowCalibration([], WF), decl('record'), P)
    expect(a).toMatchObject({ earned: 'record', level: 'record', blockers: [] })
    expect(a.proposal).toBeUndefined()
    expect(a.rungs.map(r => r.reason)).toEqual(['0 reviewed FAIL verdicts < minimum 20', '0 reviewed FAIL verdicts < minimum 50', '0 reviewed PASS verdicts < minimum 100'])
  })

  it('NEVER self-promotes: with evidence for autonomy and nothing granted, it stays at record and proposes ONE rung', () => {
    const a = assessVoice(workflowCalibration(strong, WF), decl('record'), P)
    expect(a.earned).toBe('autonomy')
    expect(a.level).toBe('record')
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', urgent: false, status: 'PROPOSED', requires_human_signature: true, from: 'record', to: 'advise', earned: 'autonomy' })
    expect(a.proposal!.rungs.map(r => r.rung)).toEqual(['advise'])
    expect(a.proposal!.proposal_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('PROPERTY (the ruling): across a grid of evidence, every granted rung and two tiers, the rung is EXACTLY what a person granted, in either direction', () => {
    let promotions = 0, demotions = 0
    for (const pass of [0, 50, 150, 700]) for (const fail of [0, 30, 120]) for (const passOver of [0, 1, 5, 40]) for (const failOver of [0, 3, 30]) {
      const cal = workflowCalibration(book({ pass, fail, passOver: Math.min(passOver, pass), failOver: Math.min(failOver, fail) }), WF)
      for (const granted of VOICE_LADDER) for (const tier of ['low', 'high']) {
        const a = assessVoice(cal, decl(granted, tier), P)
        expect(a.level).toBe(granted)                       // never changed on its own, up OR down
        expect(a.granted).toBe(granted)
        expect(ACTION_HANDLING[granted]).toBeDefined()
        expect(a.handling).toEqual(ACTION_HANDLING[granted])  // the granted rung's handling, whatever the evidence says
        const gi = levelRank(granted), ei = levelRank(a.earned)
        if (ei > gi) {
          promotions++
          expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', urgent: false, from: granted, status: 'PROPOSED', requires_human_signature: true })
          expect(levelRank(a.proposal!.to)).toBe(gi + 1)      // one rung up
        } else if (ei < gi) {
          demotions++
          expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', from: granted, status: 'PROPOSED', requires_human_signature: true })
          // Security fix (2026-09-28): was `urgent: true` on every demotion; urgent is now exactly basis === 'failure'.
          expect((a.proposal as { urgent: boolean; basis: string }).urgent).toBe((a.proposal as { basis: string }).basis === 'failure')
          expect(levelRank(a.proposal!.to)).toBe(gi - 1)      // one rung down: symmetric
        } else {
          expect(a.proposal).toBeUndefined()
        }
      }
    }
    expect(promotions).toBeGreaterThan(50)
    expect(demotions).toBeGreaterThan(50)
  })

  it('evidence that stops supporting the grant raises an URGENT DEMOTION PROPOSAL (one rung, failing cases listed for dispute); the rung stays', () => {
    const a = assessVoice(workflowCalibration(book({ pass: 400, fail: 120, passOver: 9, failOver: 2 }), WF), decl('autonomy'), P)
    expect(a.earned).toBe('gate')
    expect(a.level).toBe('autonomy')                         // a person's decision; not moved
    expect(a.handling).toMatchObject({ PASS: 'ACT_WITHIN_BOUNDS', FAIL: 'HOLD', INSUFFICIENT_DATA: 'HOLD' }) // autonomy's handling, still in force
    const d = a.proposal as DemotionProposal
    expect(d).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'autonomy', to: 'gate', earned: 'gate' })
    expect(d.reasons.join(' ')).toMatch(/autonomy: 90% wilson upper bound .* > bar 3%/)
    expect(d.failing_cases).toHaveLength(9)                   // the 9 overturned PASSes
    expect(d.failing_cases.every(c => c.rung === 'autonomy' && c.outcome === 'PASS')).toBe(true)
    expect(d.failing_cases[0]!.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${d.failing_cases[0]!.verdict_id}`)
  })

  it('a demotion is one rung at a time even when the evidence supports much less; the person may decide a larger step', () => {
    const a = assessVoice(workflowCalibration(book({ pass: 10, fail: 5 }), WF), decl('autonomy'), P) // supports only record
    expect(a.earned).toBe('record')
    expect(a.level).toBe('autonomy')
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', from: 'autonomy', to: 'gate', earned: 'record' })
    expect((a.proposal as DemotionProposal).failing_cases).toEqual([]) // the shortfall is volume: nothing to dispute
  })

  it('stable settings: a grant is assessed only under the policy version and tier it was made under', () => {
    const cal = workflowCalibration(strong, WF)
    const grant: Grant = { level: 'gate', signer_id: 'ap-lead', signed_at: '2026-09-28T09:00:00Z', policy: policyRef(P), consequence_tier: 'low' }
    const a = assessVoice(cal, decl('gate', 'low', { grant }), P)
    expect(a.grant).toEqual(grant)
    expect(a.level).toBe('gate')
    const v2 = revisePolicy(P, { version: '0.3.0', tiers: P.tiers.map(t => (t.tier === 'low' ? { ...t, autonomy: { min_n: 150, max_error: 0.03 } } : t)) }, { revised_by: 'ap-lead', revised_at: '2026-10-01T09:00:00Z', reason: 'quarterly review' })
    expect(() => assessVoice(cal, decl('gate', 'low', { grant }), v2)).toThrow(/Settings are fixed at grant time/)
    expect(() => assessVoice(cal, decl('gate', 'moderate', { grant }), P)).toThrow(/grant was made at consequence tier 'low'/)
    expect(() => assessVoice(cal, decl('advise', 'low', { grant }), P)).toThrow(/grant is for gate/)
    expect(() => assessVoice(cal, decl('gate', 'low', { grant: { ...grant, signer_id: '' } }), P)).toThrow(/person's decision/)
    const regranted: Grant = { ...grant, policy: policyRef(v2), signed_at: '2026-10-01T10:00:00Z' } // the person moves the workflow onto v2
    expect(assessVoice(cal, decl('gate', 'low', { grant: regranted }), v2).policy.version).toBe('0.3.0')
  })

  it('no dynamic difficulty: assessment reads the policy and never writes it (deep-frozen), and the policy hash is unchanged', () => {
    const frozen: PromotionPolicy = structuredClone(P)
    const deepFreeze = (o: unknown): void => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) } }
    deepFreeze(frozen)
    const before = policyRef(frozen).hash
    for (const g of VOICE_LADDER) assessVoice(workflowCalibration(book({ pass: 400, fail: 120, passOver: 9, failOver: 2 }), WF), decl(g), frozen)
    expect(policyRef(frozen).hash).toBe(before)
  })

  it('the burden scales with consequence: the same record earns autonomy at low but not at high', () => {
    const cal = workflowCalibration(book({ pass: 400, fail: 250, passOver: 1, failOver: 3 }), WF)
    expect(assessVoice(cal, decl('record', 'low'), P).earned).toBe('autonomy')
    const high = assessVoice(cal, decl('record', 'high'), P)
    expect(high.earned).toBe('gate')
    expect(high.rungs[2]!.reason).toMatch(/400 reviewed PASS verdicts < minimum 600/)
    expect(assessVoice(cal, decl('record', 'severe'), P).earned).toBe('advise')
  })

  it('the dispatch illustration (3 misses in 415 PASSes) does not clear a 0.5% bar: its 95% upper bound is ~1.79%', () => {
    const tight: PromotionPolicy = { ...P, tiers: [{ ...P.tiers[2]!, autonomy: { min_n: 400, max_error: 0.005 } }] }
    const a = assessVoice(workflowCalibration(book({ pass: 415, fail: 250, passOver: 3, failOver: 2 }), WF), decl('gate', 'high'), tight)
    expect(a.rungs[2]!.cleared).toBe(false)
    expect(a.rungs[2]!.upper).toBeGreaterThan(0.0179)
    expect(a.proposal).toBeUndefined()
  })

  it('the declared method matters: Clopper-Pearson demands more clean evidence than Wilson at the same bar', () => {
    const cp: PromotionPolicy = { ...P, method: 'clopper-pearson' }
    const cal = workflowCalibration(book({ pass: 100, fail: 60 }), WF) // 0 misses in 100 PASSes at the 'low' tier (3% at 90%)
    expect(assessVoice(cal, decl('gate'), P).earned).toBe('autonomy')    // Wilson upper ≈ 1.6%
    expect(assessVoice(cal, decl('gate'), cp).earned).toBe('autonomy')   // CP upper ≈ 2.3%, still under 3%
    const thin = workflowCalibration(book({ pass: 120, fail: 60, passOver: 1 }), WF) // 1 miss in 120
    expect(assessVoice(thin, decl('gate'), P).rungs[2]!.cleared).toBe(true)   // Wilson ≈ 2.75%
    expect(assessVoice(thin, decl('gate'), cp).rungs[2]!.cleared).toBe(false) // CP ≈ 3.24%
  })

  it('voids evidence that spans versions, or a calibration altered after it was computed', () => {
    const mixed = workflowCalibration([...strong, rec('new-engine', 'PASS', 'UPHELD', { engine: '0.0.2' })], WF)
    const m = assessVoice(mixed, decl('record'), P)
    expect(m.earned).toBe('record')
    expect(m.blockers.join(' ')).toMatch(/spans 2 ruleset\/engine versions/)
    expect(m.proposal).toBeUndefined()
    const cal = workflowCalibration(book({ pass: 400, fail: 120, passOver: 9 }), WF)
    const doctored: WorkflowCalibration = { ...cal, evidence: { ...cal.evidence, false_pass: [] } } // hide the misses, keep the hash
    const d = assessVoice(doctored, decl('gate'), P)
    expect(d.blockers.join(' ')).toMatch(/does not match its own hash/)
    expect(d.earned).toBe('record')
    expect(d.level).toBe('gate') // not moved: an urgent proposal says why
    expect(d.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', urgent: true, from: 'gate', to: 'advise' })
    expect((d.proposal as DemotionProposal).reasons.join(' ')).toMatch(/does not match its own hash/)
  })

  it('refuses malformed questions: an undeclared tier, a mismatched workflow, an invalid policy', () => {
    const cal = workflowCalibration(strong, WF)
    expect(() => assessVoice(cal, decl('record', 'catastrophic'), P)).toThrow(/not declared in policy/)
    expect(() => assessVoice(cal, { ...decl('record'), workflow_id: 'other' }, P)).toThrow(/declaration is for other/)
    expect(() => assessVoice(cal, decl('record'), { ...P, tiers: [] })).toThrow(/invalid promotion policy/)
    expect(() => assessVoice(cal, decl('boss' as VoiceLevel), P)).toThrow(/granted must be one of/)
  })

  it('is deterministic: same inputs, same assessment and proposal ids', () => {
    const a = assessVoice(workflowCalibration(strong, WF), decl('advise'), P)
    const b = assessVoice(workflowCalibration([...strong].reverse(), WF), decl('advise'), P)
    expect(b.assessment_hash).toBe(a.assessment_hash)
    expect(b.proposal!.proposal_id).toBe(a.proposal!.proposal_id)
    expect(a.proposal!.to).toBe('gate')
  })
})

describe('revisePolicy: a person adjusts the weighting at a review, and the change is recorded and versioned', () => {
  const by = { revised_by: 'cfo', revised_at: '2026-10-01T09:00:00Z', reason: 'review: holds were costing more than misses' }
  it('records who, when, why, what changed, and the hash of the version it supersedes; the prior version is untouched', () => {
    const priorHash = policyRef(P).hash
    const v2 = revisePolicy(P, { version: '0.3.0', method: 'clopper-pearson', tiers: P.tiers.map(t => (t.tier === 'high' ? { ...t, gate: { min_n: 250, max_error: 0.05 } } : t)) }, by)
    expect(v2.version).toBe('0.3.0')
    expect(v2.revision).toMatchObject({ supersedes: { policy_id: P.policy_id, version: '0.2.0', hash: priorHash }, revised_by: 'cfo', reason: by.reason })
    expect(v2.revision!.changes).toEqual(['method wilson → clopper-pearson', 'high.gate: min_n 200 → 250'])
    expect(lintPolicy(v2).ok).toBe(true)
    expect(policyRef(P).hash).toBe(priorHash)
    expect(P.revision).toBeUndefined()
    const v3 = revisePolicy(v2, { version: '0.4.0', method: 'wilson' }, by)
    expect(v3.revision!.supersedes.hash).toBe(policyRef(v2).hash) // a chain of versions
  })
  it('refuses a revision that changes nothing, reuses the version, lacks a person or a reason, or lowers the burden with consequence', () => {
    expect(() => revisePolicy(P, { version: '0.3.0' }, by)).toThrow(/must change something/)
    expect(() => revisePolicy(P, { version: '0.2.0', method: 'clopper-pearson' }, by)).toThrow(/new version/)
    expect(() => revisePolicy(P, { version: '0.3.0', method: 'clopper-pearson' }, { ...by, revised_by: '' })).toThrow(/person's recorded decision/)
    expect(() => revisePolicy(P, { version: '0.3.0', method: 'clopper-pearson' }, { ...by, reason: '' })).toThrow(/person's recorded decision/)
    expect(() => revisePolicy(P, { version: '0.3.0', tiers: P.tiers.map(t => (t.tier === 'severe' ? { ...t, autonomy: { min_n: 10, max_error: 0.5 } } : t)) }, by)).toThrow(/does not lint.*burden decreases/)
    const forged: PromotionPolicy = { ...P, version: '0.3.0', revision: { supersedes: policyRef(P), revised_by: 'x', revised_at: 't', reason: 'r', changes: [] } }
    expect(lintPolicy(forged).errors.join(' ')).toMatch(/must record what changed/)
  })
})

describe('what-if arithmetic agrees with the assessment itself', () => {
  const tier = P.tiers[0]!
  it('consecutiveErrorsToBreach: j more misses demote, j − 1 do not', () => {
    for (const [pass, over] of [[130, 0], [300, 2], [1000, 10]] as const) {
      const j = consecutiveErrorsToBreach(over, pass, tier.autonomy.max_error, tier.confidence, 'wilson')
      const after = (extra: number) => assessRung('autonomy', workflowCalibration(book({ pass: pass + extra, fail: 0, passOver: over + extra }), WF), tier, 'wilson').cleared
      expect(after(0)).toBe(true)
      expect(after(j - 1)).toBe(true)
      expect(after(j)).toBe(false)
    }
  })
  it('errorsInHorizonToBreach and cleanReviewsToClear are the smallest such counts', () => {
    const bar = tier.autonomy.max_error, c = tier.confidence
    const m = errorsInHorizonToBreach(0, 130, 100, bar, c, 'wilson')!
    expect(assessRung('autonomy', workflowCalibration(book({ pass: 230, fail: 0, passOver: m }), WF), tier, 'wilson').cleared).toBe(false)
    expect(assessRung('autonomy', workflowCalibration(book({ pass: 230, fail: 0, passOver: m - 1 }), WF), tier, 'wilson').cleared).toBe(true)
    const k = cleanReviewsToClear(2, 60, tier.autonomy, c, 'wilson')!
    expect(assessRung('autonomy', workflowCalibration(book({ pass: 60 + k, fail: 0, passOver: 2 }), WF), tier, 'wilson').cleared).toBe(true)
    expect(assessRung('autonomy', workflowCalibration(book({ pass: 59 + k, fail: 0, passOver: 2 }), WF), tier, 'wilson').cleared).toBe(false)
  })
})
