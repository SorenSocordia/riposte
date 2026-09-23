import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import type { ClaimVerdict, Verdict } from '../src/index'
import {
  FIXED_NOW, clean, broken, eu, noSubtotal, singleLine, singleLineOutOfTerm,
  contractOk, contractOverRate, evidenceOk, evidenceShort, withPriorIds, withNoPriorIds,
} from './fixtures/invoices'

const claim = (v: Verdict, id: string): ClaimVerdict => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have: ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}
const run = (ex: Record<string, unknown>, references?: { contract?: Record<string, unknown>; evidence?: Record<string, unknown>[] }) =>
  verify(ex, { now: FIXED_NOW, references })

describe('single-document coherence (no references)', () => {
  it('clean invoice: PASS, footing + per-line math run, cross-document checks abstain honestly', () => {
    const v = run(clean)
    expect(v.outcome).toBe('PASS')
    expect(v.coverage).toEqual({ claims_total: 13, claims_checked: 5, claims_pass: 5, claims_fail: 0, claims_insufficient: 8 })

    for (const id of ['document.SUM_INT', 'document.TOTAL_INT', 'document.TAX_INT', 'line[0].MATH_INT', 'line[1].MATH_INT']) {
      expect(claim(v, id).outcome, id).toBe('PASS')
    }
    for (const id of ['line[0].RATE_SUP', 'line[0].AMT_CAP', 'line[1].RATE_SUP', 'line[1].AMT_CAP', 'document.TIME_ORD']) {
      const c = claim(v, id)
      expect(c.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, id).toBe('REFERENCE_NOT_PROVIDED')
    }
    for (const id of ['line[0].QTY_MATCH', 'line[1].QTY_MATCH']) {
      expect(claim(v, id).insufficiency?.reason, id).toBe('REFERENCE_NOT_PROVIDED')
      expect(claim(v, id).insufficiency?.detail, id).toMatch(/evidence/i)
    }
    expect(claim(v, 'document.DUP_PROHIB').insufficiency?.reason).toBe('FIELD_MISSING')
  })

  it('SUM_INT receipt lists every line amount as evidence with provenance, plus the computed sum and the stated subtotal', () => {
    const c = claim(run(clean), 'document.SUM_INT')
    const paths = c.evidence.map(e => e.locator.kind === 'field' ? e.locator.path : '')
    expect(paths).toContain('line_items[0].amount')
    expect(paths).toContain('line_items[1].amount')
    expect(paths).toContain('totals.subtotal')
    expect(c.computation?.operands).toEqual({ LINE_ITEMS_SUM: 1750.5, SUBTOTAL: 1750.5 })
    // the invoice ruleset stamps its rounding policy (0.05% band over the $0.01 floor) on the receipt
    expect(c.computation?.tolerance).toEqual({ abs: 0.01, rel: 0.0003 })
  })

  it('broken invoice: FAIL with each error blamed on exactly the right number, and locked', () => {
    const v = run(broken)
    expect(v.outcome).toBe('FAIL')
    expect(v.coverage.claims_fail).toBe(3)

    const sum = claim(v, 'document.SUM_INT')
    expect(sum.outcome).toBe('FAIL')
    expect(sum.locked).toBe(true)
    expect(sum.variance).toBe(24.5)

    const tax = claim(v, 'document.TAX_INT')
    expect(tax.outcome).toBe('FAIL')
    expect(tax.locked).toBe(true)
    expect(tax.variance).toBeCloseTo(5.5837, 3)
    expect(tax.computation?.operands.EXPECTED_TAX_AMOUNT).toBe(144.4163)

    const line1 = claim(v, 'line[1].MATH_INT')
    expect(line1.outcome).toBe('FAIL')
    expect(line1.locked).toBe(true)
    expect(line1.variance).toBe(24.5)

    // The bottom line coheres with the stated (wrong) subtotal + tax — checks are independent.
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('PASS')
  })

  it('European formatting and percent rates normalize with an audit trail', () => {
    const v = run(eu)
    expect(v.outcome).toBe('PASS')
    expect(claim(v, 'document.SUM_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TAX_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')

    const sub = claim(v, 'document.SUM_INT').evidence.find(e => e.locator.kind === 'field' && e.locator.path === 'totals.subtotal')
    expect(sub?.value).toBe(1250)
    expect(sub?.original).toBe('1.250,00')
    expect(sub?.normalizations).toContain('european_format_converted')

    const rate = claim(v, 'document.TAX_INT').evidence.find(e => e.locator.kind === 'field' && e.locator.path === 'totals.tax_rate')
    expect(rate?.value).toBe(0.19)
    expect(rate?.original).toBe('19%')
    expect(rate?.normalizations).toContain('percent_to_fraction')
  })

  it('missing subtotal: footing checks abstain with FIELD_MISSING that names the absent operand — never a guess', () => {
    const v = run(noSubtotal)
    for (const id of ['document.SUM_INT', 'document.TOTAL_INT', 'document.TAX_INT']) {
      const c = claim(v, id)
      expect(c.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, id).toBe('FIELD_MISSING')
      expect(c.insufficiency?.detail, id).toMatch(/subtotal/i)
      expect(c.insufficiency?.missing, id).toBeDefined()
    }
    expect(claim(v, 'line[0].MATH_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS') // the checks that could run, passed; coverage says how many could
    expect(v.coverage.claims_checked).toBe(1)
  })

  it('duplicate detection runs only when the caller supplies prior ids', () => {
    expect(claim(run(withNoPriorIds), 'document.DUP_PROHIB').outcome).toBe('PASS')
    const dup = claim(run(withPriorIds), 'document.DUP_PROHIB')
    expect(dup.outcome).toBe('FAIL')
    expect(dup.evidence.some(e => e.locator.kind === 'field' && e.locator.path === 'prior_invoice_ids')).toBe(true)
  })
})

describe('cross-document checks (references supplied)', () => {
  it('contract satisfied: RATE_SUP, AMT_CAP, TIME_ORD PASS', () => {
    const v = run(singleLine, { contract: contractOk })
    expect(v.references.contract).toBe(true)
    expect(claim(v, 'line[0].RATE_SUP').outcome).toBe('PASS')
    expect(claim(v, 'line[0].AMT_CAP').outcome).toBe('PASS')
    expect(claim(v, 'document.TIME_ORD').outcome).toBe('PASS')
    expect(claim(v, 'line[0].QTY_MATCH').insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
    expect(v.outcome).toBe('PASS')
  })

  it('rate above contract: RATE_SUP FAILs, locked, variance = rate delta × quantity', () => {
    const v = run(singleLine, { contract: contractOverRate })
    const c = claim(v, 'line[0].RATE_SUP')
    expect(c.outcome).toBe('FAIL')
    expect(c.locked).toBe(true)
    expect(c.variance).toBe(100)
    expect(c.evidence.some(e => e.role === 'REFERENCE' && e.locator.kind === 'field' && e.locator.source === 'contract')).toBe(true)
    expect(v.outcome).toBe('FAIL')
  })

  it('invoice dated outside the contract term: TIME_ORD FAILs', () => {
    const v = run(singleLineOutOfTerm, { contract: contractOk })
    const c = claim(v, 'document.TIME_ORD')
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.operands.EVENT_DATE).toBe('2027-02-01')
  })

  it('evidence agrees: QTY_MATCH PASS; evidence short: QTY_MATCH FAIL with variance 2', () => {
    expect(claim(run(singleLine, { evidence: [evidenceOk] }), 'line[0].QTY_MATCH').outcome).toBe('PASS')
    const c = claim(run(singleLine, { evidence: [evidenceShort] }), 'line[0].QTY_MATCH')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(2)
  })

  // multi-rate contracts: see test/contract-ambiguity.test.ts (honesty rule 4)
})
