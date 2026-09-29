import { describe, expect, it } from 'vitest'
import { actionNotice, verifyAction, EXAMPLE_PROMOTION_POLICY, type Verdict } from 'riposte-verify'
import {
  AUDIENCES, DEFAULT_TIERS, MOMENTS, SOFTENERS, checkDone, deliver, factTokens, factsFromClaims, factsFromDone, factsFromNotice, timingOf, weightOf,
  type Audience, type ClaimsResult, type DeliveryFacts, type Moment,
} from '../src/index.js'

const at = (iso: string) => () => new Date(iso)
const LEVELS = ['record', 'advise', 'gate', 'autonomy'] as const
const TIERS = [...DEFAULT_TIERS, 'not-a-declared-tier']

// Three real verdicts from the engine: a FAIL (an account outside the approved set), an ABSTAIN (no value has a declared
// source) and a PASS (every value grounded).
const transfer = { tool: 'mcp__bank__transfer', arguments: { to_account: '110-234-5678', amount: 500, memo: 'INV-1042' } }
const failV = verifyAction(transfer, { allowed: { to_account: ['220-000-1111'], amount: [500], memo: ['INV-1042'] } }, { now: at('2026-09-28T09:00:00Z') })
const abstainV = verifyAction(transfer, {}, { now: at('2026-09-28T09:00:00Z') })
const passV = verifyAction(transfer, { allowed: { to_account: ['110-234-5678'], amount: [500], memo: ['INV-1042'] } }, { now: at('2026-09-28T09:00:00Z') })

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The frame of a message: its text with every fact removed. Tact lives only here. */
function frameOf(text: string, facts: DeliveryFacts): string {
  let t = text
  for (const tok of [...factTokens(facts)].sort((a, b) => b.length - a.length)) t = t.split(tok).join(' ')
  return t
}
const softenersIn = (frame: string) => SOFTENERS.filter((w) => new RegExp(`\\b${escape(w)}\\b`, 'i').test(frame))

function everyRegister(facts: DeliveryFacts, fn: (d: ReturnType<typeof deliver>, ctx: { moment: Moment; tier: string; audience: Audience }) => void) {
  for (const moment of MOMENTS) for (const tier of TIERS) for (const audience of AUDIENCES) fn(deliver(facts, { moment, tier, audience }), { moment, tier, audience })
}

describe('nunchi: the facts never flex', () => {
  it('the engine gives a FAIL, an ABSTAIN and a PASS to deliver', () => {
    expect([failV.outcome, abstainV.outcome, passV.outcome]).toEqual(['FAIL', 'INSUFFICIENT_DATA', 'PASS'])
  })

  for (const [name, v] of [['FAIL', failV], ['ABSTAIN', abstainV], ['PASS', passV]] as [string, Verdict][]) {
    for (const level of LEVELS) {
      it(`${name} at ${level}: the same facts and facts_hash in all ${MOMENTS.length * TIERS.length * AUDIENCES.length} registers, every fact verbatim in the text`, () => {
        const notice = actionNotice(v, level)
        const facts = factsFromNotice(notice, `tool ${transfer.tool}`)
        const frozen = structuredClone(facts)
        const hashes = new Set<string>()
        everyRegister(facts, (d) => {
          expect(d.facts).toEqual(frozen)
          hashes.add(d.facts_hash)
          expect(d.facts.action).toBe(notice.action) // delivery never changes what happens to the action
          for (const tok of factTokens(facts)) expect(d.text, `missing fact "${tok}" in ${d.audience}/${d.weight}/${d.moment}`).toContain(tok)
        })
        expect(hashes.size).toBe(1)
        expect(facts).toEqual(frozen) // not mutated by delivery
      })
    }
  }

  it('the same verdict always yields the same facts: re-issued later, the facts hash is unchanged', () => {
    const again = verifyAction(transfer, { allowed: { to_account: ['220-000-1111'], amount: [500], memo: ['INV-1042'] } }, { now: at('2027-01-01T00:00:00Z') })
    expect(again.issued_at).not.toBe(failV.issued_at)
    expect(again.verdict_id).toBe(failV.verdict_id)
    const a = deliver(factsFromNotice(actionNotice(failV, 'gate'), 's'), { moment: 'pre-action', tier: 'low' })
    const b = deliver(factsFromNotice(actionNotice(again, 'gate'), 's'), { moment: 'mid-flow', tier: 'severe', audience: 'auditor' })
    expect(b.facts_hash).toBe(a.facts_hash)
    expect(b.facts).toEqual(a.facts)
  })

  it('is deterministic: the same inputs give the same delivery, byte for byte', () => {
    const f = factsFromNotice(actionNotice(failV, 'advise'), 'tool x')
    for (const audience of AUDIENCES) {
      const a = deliver(f, { moment: 'done-claim', tier: 'high', audience })
      const b = deliver(structuredClone(f), { moment: 'done-claim', tier: 'high', audience })
      expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    }
  })

  it('carries every finding with its evidence and its own dispute path', () => {
    const f = factsFromNotice(actionNotice(failV, 'gate'), 'tool mcp__bank__transfer')
    expect(f.findings).toHaveLength(1)
    const x = f.findings[0]!
    expect(x).toMatchObject({ id: 'arg.to_account', status: 'FAIL', field: 'to_account' })
    expect(x.evidence[0]).toContain('contract:allowed.to_account')
    expect(x.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${failV.verdict_id} --claim arg.to_account`)
    const ab = factsFromNotice(actionNotice(abstainV, 'gate'), 's')
    expect(ab.outcome).toBe('ABSTAIN')
    expect(ab.findings[0]!.statement).toMatch(/^REFERENCE_NOT_PROVIDED: /)
  })
})

describe('nunchi: weight scales with the declared consequence tier', () => {
  it('maps the example policy tiers low → light, moderate → standard, high → heavy, severe → the floor', () => {
    expect(DEFAULT_TIERS).toEqual(EXAMPLE_PROMOTION_POLICY.tiers.map((t) => t.tier))
    expect(DEFAULT_TIERS.map((t) => weightOf(t).weight)).toEqual(['light', 'standard', 'heavy', 'floor'])
  })
  it('works for any declared tier list; the top tier is always the floor', () => {
    expect(['a', 'b', 'c'].map((t) => weightOf(t, ['a', 'b', 'c']).weight)).toEqual(['light', 'standard', 'floor'])
    expect(['a', 'b'].map((t) => weightOf(t, ['a', 'b']).weight)).toEqual(['light', 'floor'])
    expect(weightOf('only', ['only']).weight).toBe('floor')
    expect(['t1', 't2', 't3', 't4', 't5'].map((t) => weightOf(t, ['t1', 't2', 't3', 't4', 't5']).weight)).toEqual(['light', 'standard', 'standard', 'heavy', 'floor'])
  })
  it('treats an undeclared tier as the top tier: unknown stakes are spoken plainly', () => {
    expect(weightOf('nope')).toEqual({ weight: 'floor', rank: -1, of: 4, known: false })
    const d = deliver(factsFromNotice(actionNotice(failV, 'advise'), 's'), { moment: 'mid-flow', tier: 'nope' })
    expect(d.floor).toBe(true)
    expect(d.timing.speak).toBe('now')
    expect(d.text).toContain('undeclared')
  })
})

describe('nunchi: the values floor', () => {
  const cases: [string, Verdict, typeof LEVELS[number]][] = [['FAIL', failV, 'gate'], ['FAIL', failV, 'advise'], ['ABSTAIN', abstainV, 'autonomy'], ['ABSTAIN', abstainV, 'advise']]
  for (const [name, v, level] of cases) {
    it(`${name} at ${level}, top tier: no softening in any audience or moment`, () => {
      const f = factsFromNotice(actionNotice(v, level), 'tool mcp__bank__transfer')
      for (const moment of MOMENTS) for (const audience of AUDIENCES) {
        const d = deliver(f, { moment, tier: 'severe', audience })
        expect(d.floor).toBe(true)
        expect(softenersIn(frameOf(d.text, f)), `${audience}/${moment}`).toEqual([])
      }
    })
  }
  it('below the floor there is tact for people (solo, PR), and never for the auditor', () => {
    const f = factsFromNotice(actionNotice(failV, 'advise'), 'tool mcp__bank__transfer')
    for (const tier of ['low', 'moderate', 'high']) {
      for (const audience of ['solo', 'pr'] as const) expect(softenersIn(frameOf(deliver(f, { moment: 'pre-action', tier, audience }).text, f)).length, `${audience}/${tier}`).toBeGreaterThan(0)
      expect(softenersIn(frameOf(deliver(f, { moment: 'pre-action', tier, audience: 'auditor' }).text, f))).toEqual([])
    }
  })
  it('the plain statement is the same sentence at every weight; tact only prefixes it', () => {
    const f = factsFromNotice(actionNotice(failV, 'gate'), 'tool mcp__bank__transfer')
    const plain = 'Held for a person: tool mcp__bank__transfer, outcome FAIL (1 finding). It stays held until a person resolves it.'
    for (const tier of DEFAULT_TIERS) for (const audience of AUDIENCES) expect(deliver(f, { moment: 'pre-action', tier, audience }).text).toContain(plain)
  })
})

describe('nunchi: timing', () => {
  it('a HOLD is spoken now, even mid-flow and at the lightest tier', () => {
    const f = factsFromNotice(actionNotice(failV, 'gate'), 's')
    expect(f.action).toBe('HOLD')
    for (const moment of MOMENTS) expect(deliver(f, { moment, tier: 'low' }).timing.speak).toBe('now')
  })
  it('at the record rung nothing is said in-flow: the finding goes on the record, at any moment and tier', () => {
    const f = factsFromNotice(actionNotice(failV, 'record'), 's')
    expect(f.in_flow).toBe(false)
    for (const moment of MOMENTS) for (const tier of DEFAULT_TIERS) expect(deliver(f, { moment, tier }).timing.speak).toBe('on-record')
  })
  it('at advise, a mid-flow finding waits for the next boundary; the "done" claim and pre-action speak now', () => {
    const f = factsFromNotice(actionNotice(failV, 'advise'), 's')
    expect(f.action).toBe('SURFACE')
    expect(deliver(f, { moment: 'mid-flow', tier: 'moderate' }).timing.speak).toBe('at-boundary')
    expect(deliver(f, { moment: 'done-claim', tier: 'moderate' }).timing.speak).toBe('now')
    expect(deliver(f, { moment: 'pre-action', tier: 'moderate' }).timing.speak).toBe('now')
  })
  it('at the top tier the tact of waiting drops: mid-flow speaks now', () => {
    const f = factsFromNotice(actionNotice(failV, 'advise'), 's')
    expect(timingOf(f, 'mid-flow', true).speak).toBe('now')
    expect(deliver(f, { moment: 'mid-flow', tier: 'severe' }).timing.speak).toBe('now')
  })
})

describe('nunchi: audience formats of the same notice', () => {
  const f = factsFromNotice(actionNotice(failV, 'gate'), 'tool mcp__bank__transfer')
  it('solo is terminal text; PR is Markdown with a findings table; auditor is a keyed record with the facts hash', () => {
    const solo = deliver(f, { moment: 'pre-action', tier: 'high', audience: 'solo' })
    const pr = deliver(f, { moment: 'pre-action', tier: 'high', audience: 'pr' })
    const aud = deliver(f, { moment: 'pre-action', tier: 'high', audience: 'auditor' })
    expect(solo.text.startsWith('RIPOSTE (high consequence): ')).toBe(true)
    expect(solo.text).not.toContain('|---|')
    expect(pr.text.startsWith('### Riposte (high consequence): ')).toBe(true)
    expect(pr.text).toContain('| status | finding | field |')
    expect(aud.text.startsWith('RIPOSTE NOTICE\n')).toBe(true)
    expect(aud.text).toContain(`facts_hash: ${aud.facts_hash}`)
    expect(new Set([solo.text, pr.text, aud.text]).size).toBe(3)
    expect(new Set([solo.facts_hash, pr.facts_hash, aud.facts_hash]).size).toBe(1)
  })
  it('refuses an unknown moment or audience rather than guessing', () => {
    expect(() => deliver(f, { moment: 'whenever' as Moment, tier: 'low' })).toThrow(RangeError)
    expect(() => deliver(f, { moment: 'pre-action', tier: 'low', audience: 'cfo' as Audience })).toThrow(RangeError)
  })
})

describe('nunchi: the "done" moment (closing claims and done checks)', () => {
  const claims: ClaimsResult = {
    outcome: 'FAIL',
    reasons: ['1 contradicted'],
    claims: [
      { kind: 'tests_pass', claim: 'All tests pass.', status: 'CONTRADICTED', reason: 'the latest test run failed (3 failed)', evidence: { tool: 'Bash', command: 'npm test', excerpt: 'Tests 3 failed | 118 passed', at: '2026-09-28T09:10:00Z' } },
      { kind: 'pushed', claim: 'Pushed to origin.', status: 'UNSUPPORTED', reason: 'no push in this session' },
      { kind: 'build_ok', claim: 'The build is clean.', status: 'SUPPORTED', reason: 'tsc exited 0' },
    ],
  }
  it('closing claims: contradicted → FAIL, unsupported → ABSTAIN, supported omitted; facts invariant across registers', () => {
    const f = factsFromClaims(claims, { action: 'HOLD' })
    expect(f.findings.map((x) => [x.id, x.status])).toEqual([['tests_pass#0', 'FAIL'], ['pushed#1', 'ABSTAIN']])
    expect(f.findings[0]!.evidence[0]).toBe('Bash: npm test @ 2026-09-28T09:10:00Z: Tests 3 failed | 118 passed')
    const hashes = new Set<string>()
    everyRegister(f, (d) => { hashes.add(d.facts_hash); for (const tok of factTokens(f)) expect(d.text).toContain(tok) })
    expect(hashes.size).toBe(1)
  })
  it('done checks against the real state', () => {
    const r = checkDone({ claim: 'Saved the payment for INV-1042', expectations: [{ source: 'payments.json', path: 'INV-1042.amount', equals: 500 }] }, () => ({ 'INV-1042': { amount: 50 } }))
    const f = factsFromDone(r)
    expect(f).toMatchObject({ source: 'done', outcome: 'FAIL', action: 'SURFACE' })
    expect(f.findings[0]!.evidence[0]).toMatch(/^payments\.json observed [0-9a-f]{64}$/)
    everyRegister(f, (d) => { for (const tok of factTokens(f)) expect(d.text).toContain(tok) })
  })
})
