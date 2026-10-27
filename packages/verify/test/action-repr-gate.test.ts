/**
 * The action gate must not hold a right value written differently (action@0.2.0, 2026-09-29). Synthetic, public fixtures only.
 *
 * The public description of the v2 certification set's `representation` class: "as clean, but the amount is written in the
 * other exact form of the same number (a JSON number vs its two-decimal string: 980.5 vs "980.50")". Under 0.1.0 the gate
 * compared as text and held every such call. Here: the class PASSes under 0.2.0; the label moves only where the decision does;
 * 0.1.0 stays selectable and byte-identical; declared types admit their stated forms; the planted classes stay caught.
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, type ActionSources, type ProposedAction, type Verdict } from '../src/index'
import { resolveActionRuleset, ACTION_RULESET_VERSIONS } from '../src/action/index'
import { actionCheckFromJson } from '../src/http/surfaces'
import { route } from '../src/http/router'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import type { ActionCheckSurface } from '../src/http/surfaces'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const INVOICE_A = { amount: 980.5, to_account: '220-000-1111', reference: 'INV-A-0001' }
const INVOICE_B = { amount: 1200, to_account: '330-000-2222', reference: 'INV-B-0002' }
const RECORDS: ActionSources = { records: [INVOICE_A, INVOICE_B] }
const pay = (args: Record<string, unknown>): ProposedAction => ({ tool: 'pay_invoice', arguments: args })
const byArg = (v: Verdict): Record<string, string> => Object.fromEntries(v.claims.map(c => [c.field, c.outcome]))
const OLD = { ...NOW, ruleset: 'action@0.1.0' }

describe('the representation class: the amount in the other exact form PASSes', () => {
  it('a JSON number approved, the two-decimal string proposed: PASS under 0.2.0, held under 0.1.0', () => {
    const call = pay({ ...INVOICE_A, amount: '980.50' })
    expect(verifyAction(call, RECORDS, OLD).outcome).toBe('FAIL')
    const v = verifyAction(call, RECORDS, NOW)
    expect(v.outcome).toBe('PASS')
    expect(v.ruleset).toEqual({ id: 'action', version: '0.2.0', domain: 'action' })
    const c = v.claims.find(x => x.field === 'amount')!
    expect(c.evidence).toEqual([{ locator: { kind: 'field', source: 'contract', path: 'records[0].amount' }, value: '980.5', original: 980.5, normalizations: ['number and numeral'], confidence: 100, role: 'REFERENCE' }])
    expect(c.computation).toEqual({ formula: 'values ≡ one approved record', operands: { value: '980.50', record: 0, approved: 980.5, type: 'undeclared', required: ['amount', 'to_account', 'reference'] }, result: true })
    expect(c.explanation).toMatch(/in approved records\[0\], which writes it 980\.5: the same value written another way \(number and numeral\)\.$/)
  })
  it('the other way round: a two-decimal string approved, the JSON number proposed', () => {
    const records = { records: [{ ...INVOICE_A, amount: '980.50' }, { ...INVOICE_B, amount: '1200.00' }] }
    expect(verifyAction(pay({ ...INVOICE_B, amount: 1200 }), records, NOW)).toMatchObject({ outcome: 'PASS', ruleset: { version: '0.2.0' } })
    expect(verifyAction(pay({ ...INVOICE_A, amount: 980.5 }), records, NOW)).toMatchObject({ outcome: 'PASS', ruleset: { version: '0.2.0' } })
  })
  it('with allow-lists that contain every record\'s value, with require, and with the text the agent read', () => {
    const sources: ActionSources = { ...RECORDS, allowed: { amount: [980.5, 1200], to_account: ['220-000-1111', '330-000-2222'] }, require: ['amount'], text: 'Pay invoice INV-A-0001. Memo: October run' }
    const v = verifyAction(pay({ ...INVOICE_A, amount: '980.50', memo: 'October run' }), sources, NOW)
    expect(v.outcome).toBe('PASS')
    expect(byArg(v)).toEqual({ amount: 'PASS', to_account: 'PASS', reference: 'PASS' }) // require names amount; records add the rest
  })
  it('an allow-list alone (no records) admits the other form too, and cites the entry it matched', () => {
    const v = verifyAction(pay({ amount: '1200.00' }), { allowed: { amount: [980.5, 1200] } }, NOW)
    expect(v).toMatchObject({ outcome: 'PASS', ruleset: { version: '0.2.0' } })
    expect(v.claims[0]!.evidence[0]).toMatchObject({ locator: { path: 'allowed.amount[1]' }, value: '1200', original: 1200 })
    expect(v.claims[0]!.computation!.operands).toEqual({ value: '1200.00', approved: 1200, type: 'undeclared', required: ['amount'] })
  })
})

describe('the label: 0.2.0 exactly where the typed comparison decides differently', () => {
  const inputs: [ProposedAction, ActionSources][] = [
    [pay(INVOICE_A), RECORDS], [pay({ ...INVOICE_A, to_account: '330-000-2222' }), RECORDS], [pay({ amount: 980.5 }), RECORDS],
    [pay({ amount: 500, to_account: '110-234-5678' }), { allowed: { to_account: ['110-111-1111'] } }], [pay({ amount: 500 }), {}],
    [pay({ vendor: 'Acme Corp' }), { text: 'Invoice from Acme Corp.' }], [pay({ amount: '900' }), { allowed: { amount: [900] } }],
  ]
  it('where it decides the same, the verdict is 0.1.0\'s byte for byte (0.0.1 without records, 0.1.0 with them)', () => {
    for (const [a, s] of inputs) expect(JSON.stringify(verifyAction(a, s, NOW))).toBe(JSON.stringify(verifyAction(a, s, OLD)))
    expect(verifyAction(pay(INVOICE_A), RECORDS, NOW).ruleset.version).toBe('0.1.0')
    expect(verifyAction(pay({ amount: 500 }), {}, NOW).ruleset.version).toBe('0.0.1')
  })
  it('a match as written wins: an allow-list holding both forms cites the one equal as written, and the label does not move', () => {
    const v = verifyAction(pay({ amount: '980.50' }), { allowed: { amount: [980.5, '980.50'] } }, NOW)
    expect(v.ruleset.version).toBe('0.0.1')
    expect(v.claims[0]!.explanation).toBe('"980.50" is one of the 2 approved values for amount.')
  })
  it('a record equal as written wins over an earlier one equal in another form', () => {
    const records = { records: [{ amount: 980.5, reference: 'R-1' }, { amount: '980.50', reference: 'R-1' }] }
    const v = verifyAction(pay({ amount: '980.50', reference: 'R-1' }), records, NOW)
    expect(v.ruleset.version).toBe('0.1.0')
    expect(v.claims[0]!.evidence[0]!.locator).toEqual({ kind: 'field', source: 'contract', path: 'records[1].amount' })
  })
  it('the same input, two rules: same input_hash, different verdict_id', () => {
    const call = pay({ ...INVOICE_A, amount: '980.50' })
    const a = verifyAction(call, RECORDS, OLD), b = verifyAction(call, RECORDS, NOW)
    expect(a.input_hash).toBe(b.input_hash)
    expect(a.verdict_id).not.toBe(b.verdict_id)
  })
})

describe('versions: 0.1.0 selectable, unknown refused', () => {
  it('resolves the current rule, each retained version, and a ref; refuses anything else', () => {
    expect(resolveActionRuleset()).toEqual({ id: 'action', version: '0.2.0', domain: 'action' })
    expect(resolveActionRuleset('action').version).toBe('0.2.0')
    expect(resolveActionRuleset('action@0.1.0').version).toBe('0.1.0')
    expect(resolveActionRuleset({ id: 'action', version: '0.0.1' }).version).toBe('0.0.1')
    expect(ACTION_RULESET_VERSIONS.map(v => v.version)).toEqual(['0.2.0', '0.1.0', '0.0.1'])
    for (const r of ['action@0.3.0', 'invoice@0.2.0', 'action@']) expect(() => resolveActionRuleset(r)).toThrow(/unknown action ruleset/)
    expect(() => verifyAction(pay(INVOICE_A), RECORDS, { ...NOW, ruleset: 'action@9.9.9' })).toThrow(/unknown action ruleset "action@9.9.9"/)
  })
  it('0.1.0 and 0.0.1 select the same earlier rule, which names 0.0.1 without records and 0.1.0 with them', () => {
    const call = pay({ ...INVOICE_A, amount: '980.50' })
    for (const r of ['action@0.1.0', 'action@0.0.1']) {
      expect(verifyAction(call, RECORDS, { ...NOW, ruleset: r }).ruleset.version).toBe('0.1.0')
      expect(verifyAction(call, { allowed: { amount: [980.5] } }, { ...NOW, ruleset: r }).ruleset.version).toBe('0.0.1')
    }
  })
})

describe('the planted classes stay caught, in any written form', () => {
  const clean = (amount: unknown) => verifyAction(pay({ ...INVOICE_A, amount }), RECORDS, NOW)
  it('scale, sign and a value no record carries FAIL', () => {
    for (const amount of ['9805.00', 9805, '98.05', 98.05, '98050.00', '-980.50', -980.5, '980.51', 980.51]) expect(clean(amount).outcome, JSON.stringify(amount)).toBe('FAIL')
  })
  it('another record\'s value FAILs (the mix-and-match), with the closest record counted under the typed comparison', () => {
    const v = verifyAction(pay({ ...INVOICE_A, amount: '980.50', to_account: '330-000-2222' }), RECORDS, NOW)
    expect(v.outcome).toBe('FAIL')
    expect(byArg(v)).toEqual({ amount: 'FAIL', to_account: 'FAIL', reference: 'FAIL' })
    expect(v.claims[0]!.explanation).toMatch(/Closest approved record: records\[0\] \(2 of 3 agree; it has to_account = "220-000-1111"\)/)
  })
  it('a leading zero on an account is another account', () => {
    expect(verifyAction(pay({ ...INVOICE_A, to_account: '0220-000-1111' }), RECORDS, NOW).outcome).toBe('FAIL')
    expect(verifyAction(pay({ id: 12345 }), { allowed: { id: ['0012345'] } }, NOW).outcome).toBe('FAIL')
  })
  it('a partial tuple still abstains, now also when its given values match only in another form', () => {
    const v = verifyAction(pay({ amount: '980.50', to_account: '220-000-1111' }), RECORDS, NOW)
    expect(verifyAction(pay({ amount: '980.50', to_account: '220-000-1111' }), RECORDS, OLD).outcome).toBe('FAIL')
    expect(v).toMatchObject({ outcome: 'INSUFFICIENT_DATA', ruleset: { version: '0.2.0' } })
    expect(byArg(v)).toEqual({ amount: 'INSUFFICIENT_DATA', to_account: 'INSUFFICIENT_DATA', reference: 'INSUFFICIENT_DATA' })
  })
  it('two strings are not compared as numbers unless the field says so; a text field compares as written', () => {
    const records = { records: [{ ...INVOICE_A, amount: '980.5' }] }
    expect(verifyAction(pay({ ...INVOICE_A, amount: '980.50' }), records, NOW).outcome).toBe('FAIL')
    expect(verifyAction(pay({ ...INVOICE_A, amount: '980.50' }), { ...records, fields: { amount: { type: 'amount' } } }, NOW).outcome).toBe('PASS')
    expect(verifyAction(pay({ ...INVOICE_A, amount: '980.50' }), { ...RECORDS, fields: { amount: { type: 'text' } } }, NOW)).toMatchObject({ outcome: 'FAIL', ruleset: { version: '0.1.0' } })
  })
  it('text still never grounds a bare number, in any form', () => {
    expect(verifyAction(pay({ amount: '4,250.00' }), { text: 'Amount due: $4,250.00', fields: { amount: { type: 'amount', currency: 'USD' } } }, NOW).outcome).toBe('INSUFFICIENT_DATA')
  })
})

describe('declared types, end to end', () => {
  const RECS = { records: [{ amount: 4250, reference: 'INV-A-0001', due: '2026-04-03', rate: 0.125 }, { amount: 900, reference: 'INV-B-0002', due: '2026-05-01', rate: 0.1 }] }
  const FIELDS: ActionSources['fields'] = { amount: { type: 'amount', currency: 'USD' }, reference: { type: 'identifier', case_insensitive: true }, due: { type: 'date', order: 'DMY' }, rate: { type: 'rate', unit: 'fraction' } }
  it('every argument in another form its type admits: PASS, each claim naming its comparison', () => {
    const v = verifyAction(pay({ amount: '$4,250.00', reference: 'inv-a-0001', due: '03/04/2026', rate: '12.5%' }), { ...RECS, fields: FIELDS }, NOW)
    expect(v).toMatchObject({ outcome: 'PASS', ruleset: { version: '0.2.0' } })
    expect(v.claims.map(c => c.computation!.operands.type)).toEqual(['amount:USD', 'identifier:case', 'date:DMY', 'rate:fraction'])
    expect(v.claims.map(c => c.evidence[0]!.normalizations)).toEqual([['same amount', 'thousands separators', 'currency USD'], ['case'], ['date format'], ['percent and fraction']])
  })
  it('without the declarations the same call is held, and the wrong reading of a date or unit is another value', () => {
    expect(verifyAction(pay({ amount: '$4,250.00', reference: 'inv-a-0001', due: '03/04/2026', rate: '12.5%' }), RECS, NOW).outcome).toBe('FAIL')
    expect(verifyAction(pay({ amount: 4250, reference: 'INV-A-0001', due: '04/03/2026', rate: 0.125 }), { ...RECS, fields: FIELDS }, NOW).outcome).toBe('FAIL')
    expect(verifyAction(pay({ amount: 4250, reference: 'INV-A-0001', due: '2026-04-03', rate: 12.5 }), { ...RECS, fields: FIELDS }, NOW).outcome).toBe('FAIL')
    expect(verifyAction(pay({ amount: '€4,250.00', reference: 'INV-A-0001', due: '2026-04-03', rate: 0.125 }), { ...RECS, fields: FIELDS }, NOW).outcome).toBe('FAIL')
  })
  it('an invalid declaration compares as written: it can only fail', () => {
    const v = verifyAction(pay({ amount: '4250.00', reference: 'INV-A-0001', due: '2026-04-03', rate: 0.125 }), { ...RECS, fields: { amount: { type: 'amount', currency: 'dollars' } as never } }, NOW)
    expect(v).toMatchObject({ outcome: 'FAIL', ruleset: { version: '0.1.0' } })
  })
})

describe('the surfaces carry it unchanged (no field declarations needed for the class)', () => {
  const call = pay({ ...INVOICE_A, amount: '980.50' })
  it('POST /v1/action/check and /v1/verify/action: a clean call in the other form is no longer held at gate', () => {
    expect(actionCheckFromJson({ action: call, sources: RECORDS, level: 'gate' }, NOW)).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS', ruleset: { version: '0.2.0' } } })
    const r = route({ method: 'POST', path: '/v1/action/check', body: { action: call, sources: RECORDS, level: 'autonomy' } })
    expect(r.json).toMatchObject({ disposition: 'proceed', holds: false })
    expect(route({ method: 'POST', path: '/v1/verify/action', body: { action: call, sources: RECORDS } }).json).toMatchObject({ outcome: 'PASS' })
  })
  it('MCP action_check', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'action_check', arguments: { action: call, sources: RECORDS, level: 'gate' } } } as JsonRpcRequest)!.result as { structuredContent: ActionCheckSurface }
    expect(res.structuredContent).toMatchObject({ disposition: 'review', verdict: { outcome: 'PASS', ruleset: { version: '0.2.0' } } })
  })
})
