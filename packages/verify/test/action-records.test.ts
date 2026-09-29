/**
 * Record-bound grounding for agent actions (`sources.records`, PRODUCT-FIX-1, 2026-09-29). Synthetic, public fixtures only.
 *
 * Per-argument allow-lists ground each value on its own, so the amount approved for invoice A paid to the account of
 * invoice B passes: mix-and-match. With approved RECORDS, the arguments the records name are grounded only when they all
 * equal ONE record. The documented rule (src/action/index.ts): a full match PASSes; values no single record carries FAIL;
 * a partial tuple (a record-named argument missing) abstains. Without records nothing changes (action@0.0.1, same bytes).
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, type ActionSources, type ProposedAction, type Verdict } from '../src/index'
import { actionCheckFromJson, SurfaceInputError } from '../src/http/surfaces'
import { route } from '../src/http/router'
import { recordedVerdictProblem } from '../src/ledger/decisions'
import { verdictDoorProblem } from '../src/http/service'
import { verifyReplay } from '../src/protocol/replay'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const INVOICE_A = { amount: 500, to_account: '220-000-1111', reference: 'INV-A-0001' }
const INVOICE_B = { amount: 900, to_account: '330-000-2222', reference: 'INV-B-0002' }
const RECORDS: ActionSources = { records: [INVOICE_A, INVOICE_B] }
const pay = (args: Record<string, unknown>): ProposedAction => ({ tool: 'pay_invoice', arguments: args })
const MIXED = pay({ amount: 500, to_account: '330-000-2222', reference: 'INV-A-0001' }) // A's amount and reference, B's account
const byArg = (v: Verdict): Record<string, string> => Object.fromEntries(v.claims.map(c => [c.field, c.outcome]))

describe('the mix-and-match: each value approved, the combination not', () => {
  it('per-argument allow-lists pass it (the gap)', () => {
    const lists: ActionSources = { allowed: { amount: [500, 900], to_account: ['220-000-1111', '330-000-2222'], reference: ['INV-A-0001', 'INV-B-0002'] } }
    expect(verifyAction(MIXED, lists, NOW).outcome).toBe('PASS')
  })
  it('records refuse it: every record-named argument FAILs, and the explanation names the closest record and where it differs', () => {
    const v = verifyAction(MIXED, RECORDS, NOW)
    expect(v.outcome).toBe('FAIL')
    expect(byArg(v)).toEqual({ amount: 'FAIL', to_account: 'FAIL', reference: 'FAIL' })
    expect(v.claims.every(c => c.rule_id === 'GROUNDED_RECORD' && c.evidence.length === 1)).toBe(true)
    expect(v.claims[0]!.explanation).toMatch(/No approved record carries amount = 500, to_account = "330-000-2222", reference = "INV-A-0001" together\. Closest approved record: records\[0\] \(2 of 3 agree; it has to_account = "220-000-1111"\)/)
  })
})

describe('the documented rule', () => {
  it('a correct tuple PASSes, each claim citing the one record it equals', () => {
    const v = verifyAction(pay({ amount: 900, to_account: '330-000-2222', reference: 'INV-B-0002' }), RECORDS, NOW)
    expect(v.outcome).toBe('PASS')
    expect(v.claims.map(c => c.evidence[0]!.locator)).toEqual(['amount', 'to_account', 'reference'].map(k => ({ kind: 'field', source: 'contract', path: `records[1].${k}` })))
  })
  it('values compare as allow-list values do: "900" and 900 are the same approved value', () => {
    expect(verifyAction(pay({ amount: '900', to_account: '330-000-2222', reference: 'INV-B-0002' }), RECORDS, NOW).outcome).toBe('PASS')
  })
  it('a value no record carries FAILs', () => {
    expect(verifyAction(pay({ amount: 5000, to_account: '220-000-1111', reference: 'INV-A-0001' }), RECORDS, NOW).outcome).toBe('FAIL')
  })
  it('a partial tuple abstains, even when a record agrees with every value given: a record is never grounded piecewise', () => {
    const v = verifyAction(pay({ amount: 500, to_account: '220-000-1111' }), RECORDS, NOW)
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    expect(byArg(v)).toEqual({ amount: 'INSUFFICIENT_DATA', to_account: 'INSUFFICIENT_DATA', reference: 'INSUFFICIENT_DATA' })
    expect(v.claims.every(c => c.insufficiency?.reason === 'FIELD_MISSING' && c.insufficiency.missing?.join() === 'reference')).toBe(true)
  })
  it('a partial tuple whose given values no record carries together still FAILs them (the missing ones abstain)', () => {
    const v = verifyAction(pay({ amount: 500, to_account: '330-000-2222' }), RECORDS, NOW)
    expect(v.outcome).toBe('FAIL')
    expect(byArg(v)).toEqual({ amount: 'FAIL', to_account: 'FAIL', reference: 'INSUFFICIENT_DATA' })
  })
  it('record-named arguments are consequential even when `require` leaves them out', () => {
    const v = verifyAction(MIXED, { ...RECORDS, require: ['amount'] }, NOW)
    expect(byArg(v)).toEqual({ amount: 'FAIL', to_account: 'FAIL', reference: 'FAIL' })
  })
  it('arguments the records do not name keep their per-argument grounding', () => {
    const v = verifyAction(pay({ ...INVOICE_A, memo: 'October run' }), { ...RECORDS, text: 'Payment memo: October run' }, NOW)
    expect(byArg(v)).toEqual({ amount: 'PASS', to_account: 'PASS', reference: 'PASS', memo: 'PASS' })
    expect(v.claims.find(c => c.field === 'memo')!.rule_id).toBe('GROUNDED')
  })
  it('an allow-list on a record-named argument must also admit the value', () => {
    const v = verifyAction(pay(INVOICE_A), { ...RECORDS, allowed: { to_account: ['330-000-2222'] } }, NOW)
    expect(v.outcome).toBe('FAIL')
    expect(v.claims.find(c => c.field === 'to_account')).toMatchObject({ outcome: 'FAIL', rule_id: 'GROUNDED' })
  })
  it('an empty record list approves nothing: every consequential argument FAILs', () => {
    const v = verifyAction(pay(INVOICE_A), { records: [] }, NOW)
    expect(v.outcome).toBe('FAIL')
    expect(byArg(v)).toEqual({ amount: 'FAIL', to_account: 'FAIL', reference: 'FAIL' })
  })
})

describe('additive: identity and the doors', () => {
  it('without records nothing changes (action@0.0.1); with records the verdict names action@0.1.0', () => {
    expect(verifyAction(pay(INVOICE_A), { allowed: { amount: [500] } }, NOW).ruleset).toEqual({ id: 'action', version: '0.0.1', domain: 'action' })
    expect(verifyAction(pay(INVOICE_A), RECORDS, NOW).ruleset).toEqual({ id: 'action', version: '0.1.0', domain: 'action' })
  })
  it('record verdicts pass both doors and re-perform under replay', () => {
    for (const action of [MIXED, pay(INVOICE_B), pay({ amount: 500 })]) {
      const v = verifyAction(action, RECORDS, NOW)
      const x = JSON.parse(JSON.stringify(v))
      expect([recordedVerdictProblem(x), verdictDoorProblem(x)]).toEqual([undefined, undefined])
      expect(verifyReplay(v, { action, sources: RECORDS })).toMatchObject({ ok: true, status: 'REPERFORMED' })
    }
  })
})

describe('POST /v1/action/check carries records', () => {
  it('the mix-and-match holds at gate; the correct tuple goes to review', () => {
    expect(actionCheckFromJson({ action: MIXED, sources: RECORDS, level: 'gate' }, NOW)).toMatchObject({ disposition: 'hold', verdict: { outcome: 'FAIL' } })
    expect(actionCheckFromJson({ action: pay(INVOICE_B), sources: RECORDS, level: 'gate' }, NOW)).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS' } })
    const res = route({ method: 'POST', path: '/v1/action/check', body: { action: MIXED, sources: RECORDS, level: 'autonomy' } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ disposition: 'hold', holds: true })
  })
  it('refuses records it cannot use rather than guessing: empty, an empty record, a non-scalar value, records naming different arguments', () => {
    for (const [records, msg] of [
      [[], /non-empty array/],
      [[{}], /\[0\] must be a non-empty object/],
      [[{ amount: [500] }], /\[0\]\.amount must be a string or a number/],
      [[INVOICE_A, { amount: 900, to_account: '330-000-2222' }], /\[1\] names amount, to_account, but \[0\] names amount, reference, to_account/],
      ['INV-A', /non-empty array/],
    ] as const) {
      expect(() => actionCheckFromJson({ action: MIXED, sources: { records } })).toThrow(SurfaceInputError)
      expect(() => actionCheckFromJson({ action: MIXED, sources: { records } })).toThrow(msg)
      expect(route({ method: 'POST', path: '/v1/action/check', body: { action: MIXED, sources: { records } } }).status).toBe(400)
    }
  })
})
