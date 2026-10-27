/**
 * Evidence integrity, the policy side (2026-09-28): sidedness said everywhere, the unreachable-bar check, the fixed
 * example policy, the research-grounded consequence tiers (each row cited, min_n derived, the top tier non-grantable beyond
 * gate), the dollar bar (◇), a grant refused the same way on every surface, and the D-UNEVIDENCED classification of a
 * demotion proposal (evidence OF failure vs an absence of evidence). The design rulings stand throughout: only a person
 * moves a rung; settings are fixed at grant; nothing here tunes a policy.
 */
import { describe, it, expect } from 'vitest'
import {
  rateInterval, zeroMissN, successLowerBound, describeBound, oneSidedLevel, wilsonInterval,
} from '../src/verdict/bounds'
import {
  lintPolicy, assessVoice, workflowCalibration, revisePolicy, policyRef, dollarBar, grantUnderPolicy, levelRank,
  EXAMPLE_PROMOTION_POLICY as P, RESEARCH_PROMOTION_POLICY as R, RESEARCH_REPORT, VOICE_LADDER, RUNGS,
  type PromotionPolicy, type DemotionProposal, type VoiceLevel,
} from '../src/verdict/voice'
import { DecisionRefused } from '../src/ledger/decisions'
import type { LedgerRecord, Outcome, ReviewDecision, Verdict } from '../src/index'

// ── a synthetic record, as in voice.test.ts ────────────────────────────────────────────────────────────────────────
function rec(id: string, outcome: Outcome, decision?: ReviewDecision, o: { engine?: string } = {}): LedgerRecord {
  return {
    verdict: { verdict_id: id, outcome, ruleset: { id: 'invoice', version: '0.0.1', domain: 'invoice' }, engine_version: o.engine ?? '0.0.1', claims: [{ rule_id: 'SUM_INT', rule_name: 'Law of Footing', outcome }] } as unknown as Verdict,
    tenant_id: 'acme', recorded_at: '2026-09-01T00:00:00Z', retention_until: '2033-09-01T00:00:00Z',
    ...(decision ? { review: { reviewer_id: 'r', decided_at: '2026-09-02T00:00:00Z', decision } } : {}),
  }
}
function book(o: { pass: number; fail: number; passOver?: number; failOver?: number }): LedgerRecord[] {
  const out: LedgerRecord[] = []
  const pad = (i: number): string => String(i).padStart(5, '0')
  for (let i = 0; i < o.pass; i++) out.push(rec(`p${pad(i)}`, 'PASS', i < (o.passOver ?? 0) ? 'OVERTURNED' : 'UPHELD'))
  for (let i = 0; i < o.fail; i++) out.push(rec(`f${pad(i)}`, 'FAIL', i < (o.failOver ?? 0) ? 'OVERTURNED' : 'UPHELD'))
  return out
}
const WF = 'acme/invoice@0.0.1'

describe('bounds: sidedness is a declared parameter, and the zero-miss n is the real minimum', () => {
  it('✓ reproduces the research table: exact (Clopper-Pearson) and Wilson zero-miss n, one-sided', () => {
    const cp = 'clopper-pearson' as const
    // research §1.2 table (exact one-sided binomial, computed with scipy there; re-derived here in-product)
    expect(zeroMissN(0.05, 0.9, cp)).toBe(45)
    expect(zeroMissN(0.05, 0.95, cp)).toBe(59)
    expect(zeroMissN(0.025, 0.95, cp)).toBe(119)
    expect(zeroMissN(0.02, 0.95, cp)).toBe(149)
    expect(zeroMissN(0.01, 0.95, cp)).toBe(299)
    expect(zeroMissN(0.005, 0.95, cp)).toBe(598)
    expect(zeroMissN(0.001, 0.99, cp)).toBe(4603)
    // its Wilson column
    expect([zeroMissN(0.05, 0.9, 'wilson'), zeroMissN(0.05, 0.95, 'wilson'), zeroMissN(0.02, 0.95, 'wilson'), zeroMissN(0.01, 0.95, 'wilson'), zeroMissN(0.005, 0.95, 'wilson'), zeroMissN(0.001, 0.99, 'wilson')])
      .toEqual([32, 52, 133, 268, 539, 5407])
    // AS 2315 .41's worked example: 0 deviations in 60 items puts the 95% upper bound under 5%
    expect(rateInterval(0, 60, 0.95, cp).upper).toBeLessThan(0.05)
  })

  it('the zero-miss n is exactly the boundary: n clears, n − 1 does not', () => {
    for (const [bar, conf, m] of [[0.05, 0.9, 'clopper-pearson'], [0.01, 0.95, 'wilson'], [0.3, 0.9, 'wilson'], [0.001, 0.99, 'clopper-pearson']] as const) {
      const z = zeroMissN(bar, conf, m)
      expect(rateInterval(0, z, conf, m).upper).toBeLessThanOrEqual(bar)
      expect(rateInterval(0, z - 1, conf, m).upper).toBeGreaterThan(bar)
    }
  })

  it('the research side finding, reproduced: 3/2,000 is 0.375% one-sided and 0.440% two-sided; two-sided = one-sided at 1 − (1 − c)/2', () => {
    const one = rateInterval(3, 2000, 0.95, 'wilson').upper
    const two = rateInterval(3, 2000, 0.95, 'wilson', 'two-sided').upper
    expect(one).toBeCloseTo(0.003747, 5)
    expect(two).toBeCloseTo(0.004401, 5)
    expect(two).toBe(wilsonInterval(3, 2000, oneSidedLevel(0.95, 'two-sided')).upper)
    expect(oneSidedLevel(0.95, 'two-sided')).toBeCloseTo(0.975, 12)
    expect(rateInterval(3, 415, 0.95, 'wilson').upper).toBeCloseTo(0.01795, 4) // the dispatch's 1.79% was one-sided
    expect(describeBound(0.95, 'clopper-pearson')).toBe('95% one-sided clopper-pearson')
    expect(() => rateInterval(1, 10, 0.95, 'wilson', 'sideways' as never)).toThrow(/unknown sidedness/)
  })

  it('successLowerBound (a catch rate) is 1 − the upper bound on the miss rate, and never rounds up', () => {
    expect(successLowerBound(14, 14, 0.95, 'clopper-pearson')).toBeGreaterThanOrEqual(0.8)
    expect(successLowerBound(13, 13, 0.95, 'clopper-pearson')).toBeLessThan(0.8)
    expect(successLowerBound(0, 0, 0.95, 'wilson')).toBe(0)
    for (const [k, n] of [[3, 10], [9, 10], [50, 60]] as const) {
      expect(successLowerBound(k, n, 0.9, 'wilson')).toBeLessThanOrEqual(k / n)
      expect(successLowerBound(k, n, 0.9, 'clopper-pearson')).toBe(Math.max(0, 1 - rateInterval(n - k, n, 0.9, 'clopper-pearson').upper))
    }
  })
})

describe('lintPolicy: the unreachable-bar check, and sidedness made explicit', () => {
  it('the example policy is fixed: it lints with no errors and no warnings, and severe.autonomy.min_n is its zero-miss n', () => {
    expect(lintPolicy(P)).toEqual({ ok: true, errors: [] })
    expect(P.sidedness).toBe('one-sided')
    const severe = P.tiers.find(t => t.tier === 'severe')!
    expect(severe.autonomy.min_n).toBe(zeroMissN(severe.autonomy.max_error, severe.confidence, P.method))
    expect(severe.autonomy.min_n).toBe(5407)
  })

  it('flags the research finding: severe min_n 2,000 can never clear 0.1% at 99% (the true minimum is 5,407 Wilson, 4,603 exact)', () => {
    const old: PromotionPolicy = structuredClone(P)
    old.tiers[3]!.autonomy.min_n = 2000
    const l = lintPolicy(old)
    expect(l.ok).toBe(true) // a warning, not an error: the real burden is HIGHER than stated, never lower
    expect(l.warnings!.join(' ')).toMatch(/tiers\[3\] \(severe\)\.autonomy: min_n 2000 can never clear its own bar: .*99% one-sided wilson upper bound first reaches 0\.1% at n = 5407/)
    const exact = lintPolicy({ ...old, method: 'clopper-pearson' })
    expect(exact.warnings!.join(' ')).toMatch(/min_n 2000 can never clear its own bar: .*at n = 4603/)
  })

  it('an undeclared sidedness is read as one-sided and warned; two-sided is refused (every bar is tested one-sided)', () => {
    const { sidedness: _drop, ...bare } = P
    expect(lintPolicy(bare as PromotionPolicy)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/sidedness is not declared/)] })
    expect(lintPolicy({ ...P, sidedness: 'two-sided' }).errors.join(' ')).toMatch(/'two-sided' is not assessable.*1 − \(1 − c\)\/2/)
    expect(lintPolicy({ ...P, sidedness: 'three-sided' as never }).ok).toBe(false)
  })

  it('the new tier fields lint: rates in (0, 1], a known period, well-formed canaries, random selection needs a review rate', () => {
    const t = structuredClone(P.tiers[0]!)
    const bad = (tier: object): string => lintPolicy({ ...P, tiers: [{ ...t, ...tier } as never] }).errors.join(' ')
    expect(bad({ sampling: { period: 'fortnight', review_rate: 0.1 } })).toMatch(/period must be day, month or quarter/)
    expect(bad({ sampling: { period: 'day', review_rate: 1.5 } })).toMatch(/review_rate must be in \(0, 1\]/)
    expect(bad({ sampling: { period: 'day' } })).toMatch(/draws nothing/)
    expect(bad({ evidence: { canaries: { min_n: 0, min_catch_rate: 0.8 } } })).toMatch(/canaries is \{ min_n/)
    expect(bad({ evidence: { random_selection: true } })).toMatch(/random_selection needs sampling\.review_rate/)
    expect(bad({ max_rung: 'record' })).toMatch(/max_rung must be advise, gate or autonomy/)
    expect(bad({ evidence: { segregation: 'yes' } })).toMatch(/segregation must be true or false/)
  })

  it('the burden never decreases with consequence, now also for max_rung, evidence requirements and sampling', () => {
    const two = (lo: object, hi: object): string => lintPolicy({ ...P, tiers: [{ ...P.tiers[0]!, ...lo } as never, { ...P.tiers[1]!, ...hi } as never] }).errors.join(' ')
    expect(two({ max_rung: 'gate' }, {})).toMatch(/moderate may be granted up to autonomy, low only up to gate/)
    expect(two({ evidence: { segregation: true } }, {})).toMatch(/low requires segregation and moderate does not/)
    expect(two({ evidence: { canaries: { min_n: 20, min_catch_rate: 0.9 } } }, { evidence: { canaries: { min_n: 20, min_catch_rate: 0.8 } } })).toMatch(/reviewer-attention requirement is weaker/)
    expect(two({ sampling: { period: 'month', review_rate: 0.2 } }, { sampling: { period: 'month', review_rate: 0.1 } })).toMatch(/moderate draws fewer reviews than low/)
    expect(two({ sampling: { period: 'month', surveillance_rate: 0.1 } }, { sampling: { period: 'month', surveillance_rate: 0.05 } })).toMatch(/surveils autonomy less/)
    expect(two({ sampling: { period: 'month', review_rate: 0.1 } }, { sampling: { period: 'quarter', review_rate: 0.1 } })).toMatch(/re-tests every quarter, less often than low's month/)
  })

  it('a person\'s revision records changes to the new fields (so a sampling-only revision is a real revision)', () => {
    const by = { revised_by: 'controller', revised_at: '2026-10-01T09:00:00Z', reason: 'add surveillance' }
    const v2 = revisePolicy(P, { version: '0.3.0', tiers: P.tiers.map(t => (t.tier === 'severe' ? { ...t, sampling: { period: 'month' as const, surveillance_rate: 0.05 } } : t)) }, by)
    expect(v2.revision!.changes).toEqual(['severe: sampling null → {"period":"month","surveillance_rate":0.05}'])
    expect(v2.sidedness).toBe('one-sided') // carried
    const v3 = revisePolicy(v2, { version: '0.4.0', tiers: v2.tiers.map(t => (t.tier === 'severe' ? { ...t, max_rung: 'gate' as const } : t)) }, by)
    expect(v3.revision!.changes).toEqual(['severe: max_rung autonomy → gate'])
  })
})

describe('RESEARCH_PROMOTION_POLICY: the research table as a lintable policy', () => {
  it('lints clean with no warnings; exact one-sided; four tiers in ascending consequence', () => {
    expect(lintPolicy(R)).toEqual({ ok: true, errors: [] })
    expect(R).toMatchObject({ method: 'clopper-pearson', sidedness: 'one-sided' })
    expect(R.tiers.map(t => t.tier)).toEqual(['t1-routine', 't2-material', 't3-high', 't4-irreversible'])
  })

  it('every min_n is DERIVED (the zero-miss n for its bar at its confidence), so the minimum and the bar can never contradict', () => {
    for (const t of R.tiers) {
      for (const r of RUNGS) expect({ tier: t.tier, rung: r, min_n: t[r].min_n }).toEqual({ tier: t.tier, rung: r, min_n: zeroMissN(t[r].max_error, t.confidence, R.method) })
      if (t.evidence?.canaries) expect(t.evidence.canaries.min_n).toBe(zeroMissN(1 - t.evidence.canaries.min_catch_rate, t.confidence, R.method))
    }
  })

  it('the audit-sampling anchor: autonomy at 5% for T1 (90%) and T2 (95%), with 45 and 59 clean reviews; T3 at 1% needs 299', () => {
    const [t1, t2, t3] = R.tiers
    expect([t1!.confidence, t1!.autonomy]).toEqual([0.9, { min_n: 45, max_error: 0.05 }])
    expect([t2!.confidence, t2!.autonomy]).toEqual([0.95, { min_n: 59, max_error: 0.05 }])
    expect(t3!.autonomy).toEqual({ min_n: 299, max_error: 0.01 })
  })

  it('every row cites the research report, and marks what is a proposal (◇)', () => {
    for (const t of R.tiers) {
      expect(t.basis).toContain(RESEARCH_REPORT)
      expect(t.basis).toMatch(/§2 row T[1-4]/)
    }
    expect(R.tiers[0]!.basis).toMatch(/◇ Operative bar min\(5%, TM ÷ \$flow\)/)
    expect(R.tiers[1]!.basis).toMatch(/◇ Operative bar/)
    expect(RESEARCH_REPORT).toBe('Automated-approval evidence standards, research note, 2026-09-28')
  })

  it('the top tier is not grantable beyond gate: no autonomy grant, no autonomy proposal, and the rung says why', () => {
    const t4 = R.tiers[3]!
    expect(t4.max_rung).toBe('gate')
    const cal = workflowCalibration(book({ pass: 2000, fail: 400 }), WF) // clears every bar, autonomy included
    const a = assessVoice(cal, { workflow_id: WF, consequence_tier: 't4-irreversible', granted: 'gate' }, R)
    expect(a.earned).toBe('gate')
    expect(a.proposal).toBeUndefined() // nothing above gate is ever proposed here
    expect(a.rungs[2]).toMatchObject({ rung: 'autonomy', cleared: false, reason: "not grantable at tier 't4-irreversible': its highest grantable rung is gate" })
    expect(() => assessVoice(cal, { workflow_id: WF, consequence_tier: 't4-irreversible', granted: 'autonomy' }, R)).toThrow(/caps the grantable rung at gate: autonomy is not grantable/)
    const t3 = assessVoice(cal, { workflow_id: WF, consequence_tier: 't3-high', granted: 'gate' }, R)
    expect(t3.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', to: 'autonomy' }) // T3 still may
  })

  it('every rung says its sidedness, in the field and in the words', () => {
    const a = assessVoice(workflowCalibration(book({ pass: 100, fail: 60, passOver: 9 }), WF), { workflow_id: WF, consequence_tier: 't1-routine', granted: 'record' }, R)
    for (const r of a.rungs) expect(r.sidedness).toBe('one-sided')
    expect(a.rungs[2]!.reason).toMatch(/90% clopper-pearson upper bound \(one-sided\) [\d.]+% \(9\/100\) > bar 5%/)
  })
})

describe('dollarBar (◇ research §2 (c)): min(5%, tolerable misstatement ÷ $ flow), and the n it implies', () => {
  it('the research worked example: $25k on $5M a quarter → 0.5% → 598 clean reviews at 95% exact', () => {
    expect(dollarBar({ tolerable_misstatement: 25_000, dollar_flow: 5_000_000, confidence: 0.95, method: 'clopper-pearson' })).toEqual({
      bar: 0.005, zero_miss_n: 598, formula: 'min(5%, 25000 ÷ 5000000 = 0.5%) = 0.5% at 95% one-sided clopper-pearson',
    })
    expect(dollarBar({ tolerable_misstatement: 1_000_000, dollar_flow: 5_000_000, confidence: 0.9, method: 'clopper-pearson' })).toMatchObject({ bar: 0.05, zero_miss_n: 45 }) // capped at the 5% ceiling
    expect(() => dollarBar({ tolerable_misstatement: 0, dollar_flow: 1, confidence: 0.95, method: 'wilson' })).toThrow(/positive/)
  })
})

describe('grantUnderPolicy: one refusal for every surface', () => {
  const base = { workflow_id: WF, signer_id: 'controller', signed_at: '2026-09-28T09:00:00Z' }
  it('refuses a policy that does not lint, an undeclared tier, and a rung above the tier\'s max_rung; else a grant naming the policy by hash', () => {
    expect(() => grantUnderPolicy({ ...R, tiers: [] }, { ...base, level: 'advise', consequence_tier: 't1-routine' })).toThrow(DecisionRefused)
    expect(() => grantUnderPolicy(R, { ...base, level: 'advise', consequence_tier: 'catastrophic' })).toThrow(/not declared/)
    expect(() => grantUnderPolicy(R, { ...base, level: 'autonomy', consequence_tier: 't4-irreversible', bounds: 'all' })).toThrow(/caps the grantable rung at gate/)
    expect(() => grantUnderPolicy(R, { ...base, level: 'autonomy', consequence_tier: 't1-routine' })).toThrow(/must state the bounds/)
    const g = grantUnderPolicy(R, { ...base, level: 'gate', consequence_tier: 't4-irreversible' })
    expect(g).toMatchObject({ kind: 'GRANT', level: 'gate', policy: policyRef(R) })
  })
})

describe('D-UNEVIDENCED: a demotion proposal says whether it is evidence OF failure or an absence of evidence', () => {
  const decl = (granted: VoiceLevel) => ({ workflow_id: WF, consequence_tier: 'low', granted })
  it('absence: granted above what the book supports, nothing overturned → basis unevidenced (a standing notice)', () => {
    const a = assessVoice(workflowCalibration(book({ pass: 10, fail: 5 }), WF), decl('autonomy'), P)
    const d = a.proposal as DemotionProposal
    expect(d).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'unevidenced', failing_cases: [] })
    expect(a.level).toBe('autonomy') // never moved
    const fresh = assessVoice(workflowCalibration([], WF), decl('gate'), P) // a day-1 grant: nothing has gone wrong
    expect((fresh.proposal as DemotionProposal).basis).toBe('unevidenced')
  })

  it('failure: overturned verdicts against the grant, or an altered calibration → basis failure', () => {
    const a = assessVoice(workflowCalibration(book({ pass: 400, fail: 120, passOver: 9, failOver: 2 }), WF), decl('autonomy'), P)
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure' })
    const cal = workflowCalibration(book({ pass: 400, fail: 120 }), WF)
    const doctored = { ...cal, records: cal.records + 1 }
    expect(assessVoice(doctored, decl('gate'), P).proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'failure' })
  })

  it('a version change voids the old evidence: that is an absence (unevidenced), not a failure', () => {
    const recs = [...book({ pass: 400, fail: 120 }), rec('new-engine', 'PASS', 'UPHELD', { engine: '0.0.2' })]
    const a = assessVoice(workflowCalibration(recs, WF), decl('gate'), P)
    expect(a.blockers.join(' ')).toMatch(/spans 2 ruleset\/engine versions/)
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', basis: 'unevidenced' })
  })

  it('PROPERTY: every demotion proposal carries a basis, it is failure exactly when a failing case (or failure blocker) exists, and urgent is exactly basis === failure', () => {
    let failure = 0, unevidenced = 0
    for (const pass of [0, 30, 150, 700]) for (const fail of [0, 30, 120]) for (const passOver of [0, 1, 40]) for (const failOver of [0, 3, 30]) {
      const cal = workflowCalibration(book({ pass, fail, passOver: Math.min(passOver, pass), failOver: Math.min(failOver, fail) }), WF)
      for (const granted of VOICE_LADDER) {
        const a = assessVoice(cal, decl(granted), P)
        expect(a.level).toBe(granted)
        if (a.proposal?.kind !== 'DEMOTION_PROPOSAL') continue
        expect(a.proposal.urgent).toBe(a.proposal.basis === 'failure') // security fix (2026-09-28): was toBe(true) before
        expect(a.proposal.basis).toBe(a.proposal.failing_cases.length > 0 ? 'failure' : 'unevidenced')
        expect(levelRank(a.proposal.to)).toBe(levelRank(granted) - 1)
        if (a.proposal.basis === 'failure') failure++; else unevidenced++
      }
    }
    expect(failure).toBeGreaterThan(20)
    expect(unevidenced).toBeGreaterThan(20)
  })
})
