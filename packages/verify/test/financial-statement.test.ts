/**
 * Financial-statement articulation — proves the declarative engine generalizes to a genuinely different shape than
 * invoices: the universal GAAP/IFRS identities (Assets = Liabilities + Equity; statement footing; cash articulation
 * across the cash-flow and balance-sheet statements). These are definitional accounting identities, not fetched vendor
 * rules — honest to encode. The specific XBRL-US DQC 196-rule set is being sourced separately for expansion.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, lintRuleset, measureRuleset, type DeclarativeRuleset, type LabeledCase, type Verdict } from '../src/index'

const FS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'financial-statement.ruleset.json'), 'utf8'),
) as DeclarativeRuleset
const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}; have ${v.claims.map(x => x.claim_id).join(', ')}`); return c }

// A fully-articulated, internally-consistent set of statements.
const clean = {
  assets: 1000, liabilities: 600, equity: 400, liabilities_and_equity: 1000,
  current_assets: 300, noncurrent_assets: 700,
  current_liabilities: 250, noncurrent_liabilities: 350,
  cash: 120,
  revenue: 900, cost_of_goods_sold: 500, gross_profit: 400,
  operating_expenses: 250, operating_income: 150,
  pretax_income: 150, income_tax_expense: 30, net_income: 120,
  other_comprehensive_income: 10, comprehensive_income: 130,
  cash_from_operations: 200, cash_from_investing: -80, cash_from_financing: -40, net_change_in_cash: 80,
  beginning_cash: 40, ending_cash: 120,
}

describe('the financial-statement ruleset is well-formed', () => {
  it('passes the linter', () => {
    const r = lintRuleset(FS)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('a fully-articulated statement set PASSes every identity', () => {
  it('balance sheet, income statement, cash flow, and the cross-statement cash tie all hold', () => {
    const v = verify(clean, { ruleset: FS, now: NOW })
    expect(v.ruleset.id).toBe('financial-statement-core')
    for (const code of ['BS_ACCOUNTING_EQUATION', 'BS_LIAB_AND_EQUITY_TOTAL', 'BS_ASSET_SPLIT', 'BS_LIABILITY_SPLIT', 'IS_GROSS_PROFIT', 'IS_OPERATING_INCOME', 'IS_NET_INCOME', 'IS_COMPREHENSIVE_INCOME', 'CF_NET_CHANGE', 'CF_ENDING_CASH', 'XSTMT_CASH_ARTICULATION']) {
      expect(claim(v, `document.${code}`).outcome, code).toBe('PASS')
    }
    expect(v.outcome).toBe('PASS')
  })
})

describe('a broken accounting equation FAILs on the right identity', () => {
  it('Assets ≠ Liabilities + Equity → BS_ACCOUNTING_EQUATION FAIL with variance', () => {
    const v = verify({ ...clean, assets: 1050 }, { ruleset: FS, now: NOW }) // assets overstated by 50
    const c = claim(v, 'document.BS_ACCOUNTING_EQUATION')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(50)
    expect(v.outcome).toBe('FAIL')
  })
})

describe('the cross-statement cash articulation catches a mismatch', () => {
  it('ending cash (cash-flow) ≠ cash (balance sheet) → XSTMT FAIL', () => {
    const v = verify({ ...clean, cash: 130 }, { ruleset: FS, now: NOW }) // BS cash disagrees with CF ending cash
    expect(claim(v, 'document.XSTMT_CASH_ARTICULATION').outcome).toBe('FAIL')
  })
})

describe('missing components abstain, never guess', () => {
  it('a statement with no cash-flow section → those checks are INSUFFICIENT_DATA, not FAIL', () => {
    const bsOnly = { assets: 1000, liabilities: 600, equity: 400, current_assets: 300, noncurrent_assets: 700, current_liabilities: 250, noncurrent_liabilities: 350 }
    const v = verify(bsOnly, { ruleset: FS, now: NOW })
    expect(claim(v, 'document.BS_ACCOUNTING_EQUATION').outcome).toBe('PASS')
    expect(claim(v, 'document.CF_NET_CHANGE').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'document.IS_GROSS_PROFIT').outcome).toBe('INSUFFICIENT_DATA')
  })
})

describe('measured accuracy on a labeled statement set', () => {
  it('mints a DeclaredAccuracy for the financial-statement domain', () => {
    const cases: LabeledCase[] = [
      { label: 'CLEAN', extraction: clean },
      { label: 'CLEAN', extraction: { ...clean, revenue: 1000, cost_of_goods_sold: 600, gross_profit: 400 } }, // still foots
      { label: 'ERROR', extraction: { ...clean, assets: 1050 } },
      { label: 'ERROR', extraction: { ...clean, net_income: 200 } }, // net income ≠ pretax − tax
    ]
    const m = measureRuleset(FS, cases)
    expect(m.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 0 })
    expect(m.accuracy.domain).toBe('financial-statement')
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
  })
})
