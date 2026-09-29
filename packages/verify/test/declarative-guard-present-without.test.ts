/**
 * The declarative guard `abstain_if_present_without` (E-INVOICE-2, 2026-09-28): abstain when an item list is reported
 * without the stated total the identity reads in its place, because the engine never sums a nested list. Additive: the
 * two goldens (declarative-golden*.test.ts) pin that rulesets without it are byte-identical.
 */
import { describe, it, expect } from 'vitest'
import { verifyDeclarative, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'

const RS: DeclarativeRuleset = {
  id: 'present-without', version: '1', lineArrayKeys: ['lines'],
  fields: {
    DUE: { paths: ['due'] }, TOTAL: { paths: ['total'] },
    CHARGES_SUM: { paths: ['charges_sum'] }, CHARGES: { paths: ['charges'], kind: 'string' },
    FEE: { paths: ['fee'], default: 0 },
    L_NET: { paths: ['net'], line: true }, L_GROSS: { paths: ['gross'], line: true }, L_ITEMS: { paths: ['items'], kind: 'string', line: true }, L_ITEMS_SUM: { paths: ['items_sum'], line: true },
  },
  checks: [
    { code: 'DUE_INT', left: 'DUE', op: '=', right: 'TOTAL + CHARGES_SUM? + FEE', tol: 0.005, abstain_if_present_without: [{ present: 'CHARGES', without: 'CHARGES_SUM' }], guard_reason: 'the stated sum stands in for the items' },
    { code: 'LINE_INT', scope: 'line', left: 'L_GROSS', op: '=', right: 'L_NET + L_ITEMS_SUM?', tol: 0.005, abstain_if_present_without: [{ present: 'L_ITEMS', without: 'L_ITEMS_SUM' }] },
  ],
}
const run = (x: Record<string, unknown>): Verdict => verifyDeclarative(x, RS, { now: () => new Date(0) })
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)!

describe('abstain_if_present_without', () => {
  it('fires only when the list is reported and its stated total is not; the reason is appended', () => {
    const c = claim(run({ due: 105, total: 100, charges: [{ kwota: 5 }] }), 'document.DUE_INT')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toEqual({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'guard abstain_if_present_without: CHARGES is reported (charges) without CHARGES_SUM; the identity reads CHARGES_SUM in its place. Reason: the stated sum stands in for the items' })
    expect(claim(run({ due: 105, total: 100, charges: [{ kwota: 5 }], charges_sum: 5 }), 'document.DUE_INT').outcome).toBe('PASS')
    expect(claim(run({ due: 106, total: 100, charges: [{ kwota: 5 }], charges_sum: 5 }), 'document.DUE_INT').outcome).toBe('FAIL')
    expect(claim(run({ due: 100, total: 100 }), 'document.DUE_INT').outcome).toBe('PASS') // no list, no sum: the optional term is 0
  })
  it('a `without` that is present but unparseable does not satisfy it; a defaulted `present` does not trigger it', () => {
    expect(claim(run({ due: 105, total: 100, charges: 'x', charges_sum: 'n/a' }), 'document.DUE_INT').insufficiency!.reason).toBe('UNPARSEABLE') // the optional term itself abstains first
    const guarded: DeclarativeRuleset = { ...RS, checks: [{ code: 'D', left: 'DUE', op: '=', right: 'TOTAL', abstain_if_present_without: [{ present: 'FEE', without: 'CHARGES_SUM' }] }] }
    expect(verifyDeclarative({ due: 100, total: 100 }, guarded).claims[0]!.outcome).toBe('PASS') // FEE is only defaulted
    expect(verifyDeclarative({ due: 100, total: 100, fee: 0 }, guarded).claims[0]!.outcome).toBe('INSUFFICIENT_DATA') // FEE reported, CHARGES_SUM not
    expect(verifyDeclarative({ due: 100, total: 100, fee: 0, charges_sum: 'n/a' }, guarded).claims[0]!.outcome).toBe('INSUFFICIENT_DATA')
  })
  it('works per line', () => {
    const v = run({ due: 1, total: 1, lines: [{ net: 10, gross: 12, items: ['a'], items_sum: 2 }, { net: 10, gross: 12, items: ['a'] }, { net: 10, gross: 10 }] })
    expect(['line[0].LINE_INT', 'line[1].LINE_INT', 'line[2].LINE_INT'].map(id => claim(v, id).outcome)).toEqual(['PASS', 'INSUFFICIENT_DATA', 'PASS'])
  })
  it('lint: shape, known roles, scope; counts as a guard for guard_reason; marks both roles used', () => {
    expect(lintRuleset(RS)).toEqual({ ok: true, errors: [], warnings: [] })
    const bad = (g: unknown, scope?: 'line') => lintRuleset({ ...RS, checks: [{ code: 'X', left: 'DUE', op: '=', right: 'TOTAL', ...(scope ? { scope, left: 'L_GROSS', right: 'L_NET' } : {}), abstain_if_present_without: g }] }).errors
    expect(bad([])).toEqual(['check[0] (X): "abstain_if_present_without" must be a non-empty array of { present, without } role names'])
    expect(bad([{ present: 'CHARGES' }])).toHaveLength(1)
    expect(bad([{ present: 'GHOST', without: 'CHARGES_SUM' }])).toEqual(['check[0] (X)."abstain_if_present_without": unknown role "GHOST"'])
    expect(bad([{ present: 'L_ITEMS', without: 'L_ITEMS_SUM' }])[0]).toMatch(/document-scope check cannot name the per-line field "L_ITEMS"/)
    expect(bad([{ present: 'CHARGES', without: 'CHARGES_SUM' }], 'line')[0]).toMatch(/line-scope check can only name line fields/)
  })
})
