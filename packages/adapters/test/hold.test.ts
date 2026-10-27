import { describe, expect, it } from 'vitest'
import { actionNotice, verifyAction, VOICE_LADDER } from 'riposte-verify'
import { factTokens } from 'riposte-ai'
import { checkAction, dispositionOf, guardNotice, lintActionPolicy, parseActionPolicy, ruleFor, type ActionPolicy } from '../src/index.js'

const now = () => new Date('2026-09-28T09:00:00Z')
const transfer = { tool: 'mcp__bank__transfer', arguments: { to_account: '110-234-5678', amount: 500 } }
const policyAt = (level: string, allowed: Record<string, (string | number)[]> | undefined, tier = 'severe'): ActionPolicy =>
  parseActionPolicy(JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'mcp__bank__transfer', level, tier, set_by: 'controller', ...(allowed ? { sources: { allowed } } : {}) }] }))

const GROUNDED = { to_account: ['110-234-5678'], amount: [500] }
const WRONG_ACCOUNT = { to_account: ['220-000-1111'], amount: [500] }

describe('policy', () => {
  it('accepts a well-formed policy and finds its rules by exact tool name', () => {
    const p = policyAt('gate', GROUNDED)
    expect(ruleFor(p, 'mcp__bank__transfer')?.level).toBe('gate')
    expect(ruleFor(p, 'mcp__bank__transfer_v2')).toBeUndefined()
  })
  it('refuses rather than guesses: bad version, unknown rung, undeclared tier, duplicate tool, both text and text_file', () => {
    const bad = lintActionPolicy({
      policy_version: 'v9', audience: 'cfo',
      actions: [
        { tool: 't', level: 'autopilot', tier: 'low' },
        { tool: 't', level: 'gate', tier: 'catastrophic' },
        { tool: 'u', level: 'gate', tier: 'low', sources: { text: 'x', text_file: 'y', allowed: { a: [{}] } } },
      ],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/policy_version/)
    expect(bad.errors.join('\n')).toMatch(/audience/)
    expect(bad.errors.join('\n')).toMatch(/level must be one of record \| advise \| gate \| autonomy/)
    expect(bad.errors.join('\n')).toMatch(/declared twice/)
    expect(bad.errors.join('\n')).toMatch(/tier must be one of the declared tiers/)
    expect(bad.errors.join('\n')).toMatch(/not both/)
    expect(bad.errors.join('\n')).toMatch(/allowed must map/)
    expect(() => parseActionPolicy('{nope')).toThrow(/not JSON/)
  })
  it('honours a deployment\'s own tier names', () => {
    expect(lintActionPolicy({ policy_version: 'riposte-action-policy-v0', tiers: ['sandbox', 'prod'], actions: [{ tool: 't', level: 'gate', tier: 'prod' }] }).ok).toBe(true)
    expect(lintActionPolicy({ policy_version: 'riposte-action-policy-v0', tiers: ['sandbox', 'prod'], actions: [{ tool: 't', level: 'gate', tier: 'severe' }] }).ok).toBe(false)
  })
})

describe('dispositions follow the rung (the design ruling): record/advise surface, gate/autonomy hold', () => {
  const table: Record<string, Record<string, string>> = {
    FAIL: { record: 'record', advise: 'surface', gate: 'hold', autonomy: 'hold' },
    INSUFFICIENT_DATA: { record: 'record', advise: 'surface', gate: 'hold', autonomy: 'hold' },
    PASS: { record: 'proceed', advise: 'proceed', gate: 'review', autonomy: 'proceed' },
  }
  const allowedFor = { FAIL: WRONG_ACCOUNT, INSUFFICIENT_DATA: undefined, PASS: GROUNDED }
  for (const outcome of ['FAIL', 'INSUFFICIENT_DATA', 'PASS'] as const) {
    for (const level of VOICE_LADDER) {
      it(`${outcome} at ${level} → ${table[outcome]![level]}`, () => {
        const r = checkAction(policyAt(level, allowedFor[outcome]), transfer, { now })
        if (!r.matched) throw new Error('expected a declared action')
        expect(r.disposition).toBe(table[outcome]![level])
        expect(r.delivery.facts.outcome).toBe(outcome)
        expect(r.guard).toBeUndefined()
        for (const tok of factTokens(r.delivery.facts)) expect(r.delivery.text).toContain(tok)
      })
    }
  }
  it('an undeclared tool passes through untouched', () => {
    expect(checkAction(policyAt('gate', GROUNDED), { tool: 'Bash', arguments: { command: 'rm -rf build' } })).toEqual({ matched: false, tool: 'Bash', disposition: 'pass-through' })
  })
})

describe('THE GUARD: never deliver an outcome softer than the verdict', () => {
  // The amount is on an allow-list; the account number has no declared source.
  const partial = { amount: [500] }
  it('the hole is closed in verify itself (F1, fixed 2026-09-28): the notice is never softer than the verdict', () => {
    const v = verifyAction(transfer, { allowed: partial }, { now })
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    const n = actionNotice(v, 'gate')
    expect([n.outcome, n.action]).toEqual(['INSUFFICIENT_DATA', 'HOLD'])
    expect(dispositionOf(actionNotice(v, 'autonomy'))).toBe('hold') // before the fix this read "proceed"
    expect(guardNotice(v, n)).toEqual({ notice: n }) // the guard is now a no-op belt
  })
  for (const [level, want] of [['record', 'record'], ['advise', 'surface'], ['gate', 'hold'], ['autonomy', 'hold']] as const) {
    it(`partially grounded at ${level} → ${want}, with the guard stated`, () => {
      const r = checkAction(policyAt(level, partial), transfer, { now })
      if (!r.matched) throw new Error('expected a declared action')
      expect(r.disposition).toBe(want)
      expect(r.notice.outcome).toBe('INSUFFICIENT_DATA')
      expect(r.guard).toBeUndefined() // verify is strict itself since F1 was fixed (09-28); the guard stays as a belt
      expect(r.delivery.facts.findings.map((f) => [f.id, f.status])).toEqual([['arg.to_account', 'INSUFFICIENT_DATA']])
    })
  }
  it('leaves an agreeing notice alone', () => {
    const v = verifyAction(transfer, { allowed: WRONG_ACCOUNT }, { now })
    const n = actionNotice(v, 'gate')
    expect(guardNotice(v, n)).toEqual({ notice: n })
  })
})

describe('sources, determinism', () => {
  it('reads a text_file through the injected reader; an unreadable one is a stated problem and an abstention, not a crash', () => {
    const p = parseActionPolicy(JSON.stringify({ policy_version: 'riposte-action-policy-v0', actions: [{ tool: 'send', level: 'gate', tier: 'low', sources: { text_file: 'src.txt', require: ['to'] } }] }))
    const ok = checkAction(p, { tool: 'send', arguments: { to: 'Acme Holdings Ltd' } }, { now, readText: () => 'Pay Acme Holdings Ltd per the contract.' })
    expect(ok.matched && ok.disposition).toBe('review')
    const missing = checkAction(p, { tool: 'send', arguments: { to: 'Acme Holdings Ltd' } }, { now, readText: () => { throw new Error('ENOENT') } })
    if (!missing.matched) throw new Error('expected a declared action')
    expect(missing.disposition).toBe('hold')
    expect(missing.problems[0]).toMatch(/could not be read \(ENOENT\)/)
  })
  it('is deterministic: the same call gives the same verdict id, call hash, facts hash and text', () => {
    const a = checkAction(policyAt('gate', WRONG_ACCOUNT), transfer, { now })
    const b = checkAction(policyAt('gate', WRONG_ACCOUNT), { tool: transfer.tool, arguments: { amount: 500, to_account: '110-234-5678' } }, { now: () => new Date('2030-01-01T00:00:00Z') })
    if (!a.matched || !b.matched) throw new Error('expected declared actions')
    expect(b.verdict.verdict_id).toBe(a.verdict.verdict_id)
    expect(b.call_hash).toBe(a.call_hash)
    expect(b.delivery.facts_hash).toBe(a.delivery.facts_hash)
    expect(b.delivery.text).toBe(a.delivery.text)
  })
  it('the top tier speaks plainly and now; a light tier at advise waits for the boundary only mid-flow', () => {
    const hi = checkAction(policyAt('gate', WRONG_ACCOUNT, 'severe'), transfer, { now })
    const lo = checkAction(policyAt('advise', WRONG_ACCOUNT, 'low'), transfer, { now, moment: 'mid-flow' })
    if (!hi.matched || !lo.matched) throw new Error('expected declared actions')
    expect([hi.delivery.floor, hi.delivery.timing.speak]).toEqual([true, 'now'])
    expect([lo.delivery.weight, lo.delivery.timing.speak]).toEqual(['light', 'at-boundary'])
  })
})
