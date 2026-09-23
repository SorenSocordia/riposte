/**
 * verify_action — the provenance gate (leg 1.13). Proves an agent's proposed values are grounded in an approved source
 * before execution. The canonical case: the model invents a transfer destination; the schema check passes; we don't.
 */
import { describe, it, expect } from 'vitest'
import { verifyAction } from '../src/index'
import type { Verdict } from '../src/index'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

describe('grounding against an allow-list', () => {
  it('the Jay299792458 case: a transfer to an account NOT in the approved set FAILs, locked, and blocks execution', () => {
    const v = verifyAction(
      { tool: 'transfer', arguments: { amount: 500, to_account: '110-234-5678' } },
      { allowed: { to_account: ['110-111-1111', '110-222-2222'] }, require: ['to_account'] },
      { now: NOW },
    )
    const c = claim(v, 'arg.to_account')
    expect(c.outcome).toBe('FAIL')
    expect(c.locked).toBe(true)
    expect(c.explanation).toMatch(/no approved source|not in the approved/i)
    expect(v.outcome).toBe('FAIL')
    expect(v.ruleset.id).toBe('action')
  })

  it('a value that IS in the approved set is grounded → PASS', () => {
    const v = verifyAction(
      { tool: 'transfer', arguments: { to_account: '110-222-2222' } },
      { allowed: { to_account: ['110-111-1111', '110-222-2222'] } },
      { now: NOW },
    )
    expect(claim(v, 'arg.to_account').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('grounding against the source document', () => {
  const doc = 'Invoice INV-9 from Acme Corp. Amount due: $4,250.00. Remit to account ending 2222.'

  it('RED-TEAM regression: a bare NUMBER appearing in free source text does NOT ground an action value (no false locked PASS)', () => {
    // The digits 4250 appear in the source, but "a number appears somewhere in the text" is not provenance.
    const v = verifyAction({ tool: 'pay', arguments: { amount: 4250 } }, { text: doc, require: ['amount'] }, { now: NOW })
    const c = claim(v, 'arg.amount')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.locked).toBe(false)
    expect(c.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
  })

  it('RED-TEAM regression: a hallucinated wire grounds off nothing — the classic break stays closed', () => {
    const v = verifyAction(
      { tool: 'wire', arguments: { amount: 2500, to_account: 987654 } },
      { text: 'Please ship 2500 units of part #987654 to the warehouse.' },
      { now: NOW },
    )
    expect(claim(v, 'arg.amount').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'arg.to_account').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'arg.amount').locked).toBe(false)
    expect(v.outcome).toBe('INSUFFICIENT_DATA')  // the gate blocks: PASS requires every value grounded
  })

  it('a distinctive STRING found verbatim in the source is reasonable grounding → PASS', () => {
    const v = verifyAction({ tool: 'pay', arguments: { vendor: 'Acme Corp' } }, { text: doc, require: ['vendor'] }, { now: NOW })
    expect(claim(v, 'arg.vendor').outcome).toBe('PASS')
    expect(claim(v, 'arg.vendor').evidence[0]!.locator.kind).toBe('span')
  })

  it('a string NOT in the source abstains (never a false FAIL)', () => {
    const v = verifyAction({ tool: 'pay', arguments: { vendor: 'Globex Corporation' } }, { text: doc, require: ['vendor'] }, { now: NOW })
    expect(claim(v, 'arg.vendor').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'arg.vendor').insufficiency?.reason).toBe('SPAN_NOT_FOUND')
  })
})

describe('no source declared for a value', () => {
  it('abstains with REFERENCE_NOT_PROVIDED — nobody declared where the value comes from', () => {
    const v = verifyAction({ tool: 'transfer', arguments: { amount: 500 } }, {}, { now: NOW })
    const c = claim(v, 'arg.amount')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
  })
})

describe('aggregation and determinism', () => {
  it('PASS requires EVERY required value grounded; one ungrounded value blocks the whole action', () => {
    const v = verifyAction(
      { tool: 'transfer', arguments: { amount: 4250, to_account: '110-999-9999' } },
      { allowed: { amount: [4250], to_account: ['110-111-1111'] } },
      { now: NOW },
    )
    expect(claim(v, 'arg.amount').outcome).toBe('PASS')       // in the approved set
    expect(claim(v, 'arg.to_account').outcome).toBe('FAIL')   // not in allow-list
    expect(v.outcome).toBe('FAIL')
  })

  it('the ruleset and inputs fix the verdict id; the proof replays byte-identically except issued_at', () => {
    const args = [{ tool: 'transfer', arguments: { amount: 500, to_account: '110-222-2222' } }, { allowed: { to_account: ['110-222-2222'] } }] as const
    const a = verifyAction(args[0], args[1], { now: NOW })
    const b = verifyAction(args[0], args[1], { now: () => new Date('2030-01-01T00:00:00Z') })
    expect(a.verdict_id).toBe(b.verdict_id)
    const drop = (v: Verdict) => JSON.stringify({ ...v, issued_at: '' })
    expect(drop(a)).toBe(drop(b))
    // a different proposed value → a different verdict id
    const c = verifyAction({ tool: 'transfer', arguments: { amount: 501, to_account: '110-222-2222' } }, args[1], { now: NOW })
    expect(c.verdict_id).not.toBe(a.verdict_id)
  })
})
