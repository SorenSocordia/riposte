/**
 * financial-statement-core v0.2 (docs/examples/financial-statement.ruleset.v0.2.json) — the ruleset that implements
 * the SEC v0.2 addendum (bench/sec/ADDENDUM-V02.md). Synthetic statements shaped like the SEC extraction
 * (frozen-map keys + raw us-gaap tags under `tags`), one per addendum item, including the v0.1 false-alarm patterns the
 * 2026q1 audit found. v0.2 is TUNED on 2026q1; these tests pin its semantics, they are not evidence of its precision.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
const V2 = JSON.parse(readFileSync(join(EX, 'financial-statement.ruleset.v0.2.json'), 'utf8')) as DeclarativeRuleset
const V1 = JSON.parse(readFileSync(join(EX, 'financial-statement.ruleset.json'), 'utf8')) as DeclarativeRuleset
const NOW = () => new Date('2026-09-24T00:00:00Z')
const out = (v: Verdict, code: string) => { const c = v.claims.find(x => x.claim_id === `document.${code}`); if (!c) throw new Error(`no ${code}`); return c }

type Doc = Record<string, unknown> & { tags: Record<string, number> }
// A fully articulated statement set in the extraction's shape: frozen-map keys + the raw tags v0.2 reads.
const clean: Doc = {
  assets: 1000, liabilities: 600, equity: 400, liabilities_and_equity: 1000, current_assets: 300, noncurrent_assets: 700,
  current_liabilities: 250, noncurrent_liabilities: 350, cash: 100,
  revenue: 900, cost_of_goods_sold: 500, gross_profit: 400, operating_expenses: 250, operating_income: 150,
  income_tax_expense: 30, other_comprehensive_income: 10,
  cash_from_operations: 200, cash_from_investing: -80, cash_from_financing: -40, net_change_in_cash: 80,
  beginning_cash: 40, ending_cash: 120, beginning_cash_lag_days: 365,
  tags: {
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: 150,
    ProfitLoss: 120, NetIncomeLoss: 120,
    ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest: 130,
    RestrictedCashCurrent: 20,
  },
}
const withDoc = (over: Record<string, unknown>, tags: Record<string, number> = {}, drop: string[] = []): Doc => {
  const d: Doc = { ...clean, ...over, tags: { ...clean.tags, ...tags } }
  for (const k of drop) { delete d[k]; delete d.tags[k] }
  return d
}
const run = (d: Doc, rs = V2) => verifyDeclarative(d, rs, { now: NOW })
const ALL = ['BS_ACCOUNTING_EQUATION', 'BS_LIAB_AND_EQUITY_TOTAL', 'BS_ASSET_SPLIT', 'BS_LIABILITY_SPLIT', 'IS_GROSS_PROFIT', 'IS_OPERATING_INCOME', 'IS_NET_INCOME', 'IS_COMPREHENSIVE_INCOME', 'CF_NET_CHANGE', 'CF_ENDING_CASH', 'XSTMT_CASH_ARTICULATION']

describe('the v0.2 ruleset file', () => {
  it('lints clean (no errors, no warnings) and keeps the id; v0.1 is untouched', () => {
    const r = lintRuleset(V2)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect([V2.id, V2.version]).toEqual(['financial-statement-core', '0.2.0'])
    expect([V1.id, V1.version, V1.checks.length, V1.tolerance]).toEqual(['financial-statement-core', '0.1.0', 11, { rel: 0.0003, absCap: 2 }])
    expect(V2.checks.map(c => c.code)).toEqual(V1.checks.map(c => c.code))
  })
  it('a fully articulated statement set PASSes all 11 identities', () => {
    const v = run(clean)
    for (const code of ALL) expect(out(v, code).outcome, code).toBe('PASS')
  })
  it('each identity still catches a genuine break', () => {
    const breaks: [string, Doc][] = [
      ['BS_ACCOUNTING_EQUATION', withDoc({ assets: 1050, liabilities_and_equity: 1050, noncurrent_assets: 750 })],
      ['BS_LIAB_AND_EQUITY_TOTAL', withDoc({ liabilities_and_equity: 1100 })],
      ['BS_ASSET_SPLIT', withDoc({ noncurrent_assets: 600 })],
      ['BS_LIABILITY_SPLIT', withDoc({ current_liabilities: 150 })],
      ['IS_GROSS_PROFIT', withDoc({ gross_profit: 300, operating_income: 50 })],
      ['IS_OPERATING_INCOME', withDoc({ operating_income: 200 })],
      ['IS_NET_INCOME', withDoc({}, { ProfitLoss: 160 })],
      ['IS_COMPREHENSIVE_INCOME', withDoc({}, { ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest: 180 })],
      ['CF_NET_CHANGE', withDoc({ net_change_in_cash: 95, ending_cash: 135 }, { RestrictedCashCurrent: 35 })],
      ['CF_ENDING_CASH', withDoc({ beginning_cash: 10 })],
      ['XSTMT_CASH_ARTICULATION', withDoc({ cash: 60 })],
    ]
    for (const [code, d] of breaks) expect(out(run(d), code).outcome, code).toBe('FAIL')
  })
})

describe('item 1 — rounding-aware tolerance', () => {
  it('a statement in millions, with parts one unit off the total, PASSes (v0.1 flagged it: its tolerance capped at USD 2)', () => {
    const d = withDoc({ assets: 11_000_000, current_assets: 4_000_000, noncurrent_assets: 6_000_000, liabilities_and_equity: 11_000_000 })
    expect(out(run(d), 'BS_ASSET_SPLIT').outcome).toBe('PASS')
    expect(out(run(d, V1), 'BS_ASSET_SPLIT').outcome).toBe('FAIL')
    expect(out(run(d), 'BS_ASSET_SPLIT').computation?.tolerance?.abs).toBe(3_000_000)
  })
  it('the same filing one unit further off FAILs', () => {
    const d = withDoc({ assets: 11_000_000, current_assets: 4_000_000, noncurrent_assets: 3_000_000, liabilities_and_equity: 11_000_000 })
    expect(out(run(d), 'BS_ASSET_SPLIT').outcome).toBe('FAIL')
  })
})

describe('item 2 — exception-aware identities', () => {
  it('A = L + E_total + TEMP: noncontrolling and redeemable interests (the WEBTOON / BLACKLINE pattern)', () => {
    const d = withDoc({ assets: 1100, liabilities_and_equity: 1100, noncurrent_assets: 800 }, { MinorityInterest: 60, RedeemableNoncontrollingInterestEquityCarryingAmount: 40 })
    expect(out(run(d, V1), 'BS_ACCOUNTING_EQUATION').outcome).toBe('FAIL')
    const c = out(run(d), 'BS_ACCOUNTING_EQUATION')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.formula).toBe('ASSETS = LIABILITIES + EQUITY + NCI? + TEMP_EQUITY_PARENT? + REDEEMABLE_NCI?')
  })
  it('SPAC temporary equity outside StockholdersEquity (the GLOBA TERRA / WINVEST pattern)', () => {
    const d = withDoc({ assets: 1250, liabilities_and_equity: 1250, noncurrent_assets: 950 }, { TemporaryEquityCarryingAmountAttributableToParent: 250 })
    expect(out(run(d), 'BS_ACCOUNTING_EQUATION').outcome).toBe('PASS')
  })
  it('E_total prefers StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest (the HUNTINGTON pattern), and a temp-equity total over its parts', () => {
    const d = withDoc({ assets: 1137, liabilities_and_equity: 1137, noncurrent_assets: 837 }, { StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: 437, TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests: 100, TemporaryEquityCarryingAmountAttributableToParent: 70, RedeemableNoncontrollingInterestEquityCarryingAmount: 30 })
    const c = out(run(d), 'BS_ACCOUNTING_EQUATION')   // 1137 = 600 + 437 + 100
    expect(c.computation?.formula).toBe('ASSETS = LIABILITIES + EQUITY_INCL_NCI + TEMP_EQUITY_TOTAL')
    expect(c.outcome).toBe('PASS')   // the parts are not added on top of the total
  })
  it('NetChange = CFO + CFI + CFF + FX (the KRAFT HEINZ pattern); discontinued-ops cash is NOT added (addendum A1)', () => {
    const fx = withDoc({ net_change_in_cash: 83, ending_cash: 123 }, { RestrictedCashCurrent: 23, EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents: 3 })
    expect(out(run(fx, V1), 'CF_NET_CHANGE').outcome).toBe('FAIL')
    expect(out(run(fx), 'CF_NET_CHANGE').outcome).toBe('PASS')
    // NetCashProvidedByUsedIn{Operating,Investing,Financing}Activities include discontinued operations by definition, so a
    // filer that also tags the discontinued-ops cash flows still foots on CFO + CFI + CFF alone
    const disc = withDoc({}, { RestrictedCashCurrent: 30, NetCashProvidedByUsedInDiscontinuedOperations: 10, CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations: 12 })
    expect(out(run(disc), 'CF_NET_CHANGE').computation?.formula).toBe('NET_CASH_CHANGE = CFO + CFI + CFF + FX_EFFECT?')
    expect(out(run(disc), 'CF_NET_CHANGE').outcome).toBe('PASS')
    // and adding them a second time would be caught as a footing error, not excused
    const twice = withDoc({ net_change_in_cash: 90, ending_cash: 130 }, { RestrictedCashCurrent: 30, NetCashProvidedByUsedInDiscontinuedOperations: 10 })
    expect(out(run(twice), 'CF_NET_CHANGE').outcome).toBe('FAIL')
  })
  it('NetIncome = Pretax − Tax + EquityMethodIncome + DiscOps: equity-method income is added to the pretax figure that EXCLUDES it', () => {
    const emi = withDoc({}, { IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments: 140, IncomeLossFromEquityMethodInvestments: 10 }, ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'])
    expect(out(run(emi), 'IS_NET_INCOME').outcome).toBe('PASS')
    // the pretax figure that INCLUDES it by definition: equity-method income is not added a second time
    const incl = withDoc({}, { IncomeLossFromEquityMethodInvestments: 10 })
    expect(out(run(incl), 'IS_NET_INCOME').outcome).toBe('PASS')
    expect(out(run(incl), 'IS_NET_INCOME').computation?.formula).toBe('PROFIT_LOSS = PRETAX_INCL_EMI - TAX + DISCOPS_INCOME?')
  })
  it('discontinued operations (the BRINKS / CLEAR CHANNEL pattern), paired with ProfitLoss; NetIncomeLoss pairs with the parent share', () => {
    const d = withDoc({}, { ProfitLoss: 100, NetIncomeLoss: 100, IncomeLossFromDiscontinuedOperationsNetOfTax: -20 })
    expect(out(run(d), 'IS_NET_INCOME').outcome).toBe('PASS')
    const parent = withDoc({}, { NetIncomeLoss: 95, IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity: -25, IncomeLossFromDiscontinuedOperationsNetOfTax: -20 }, ['ProfitLoss'])
    const c = out(run(parent), 'IS_NET_INCOME')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.formula).toBe('NET_INCOME_PARENT = PRETAX_INCL_EMI - TAX + DISCOPS_INCOME_PARENT?')
  })
  it('CI paired consistently: parent CI with NetIncomeLoss even when ProfitLoss is reported (the HUMANA / AON pattern)', () => {
    const d = withDoc({}, { ProfitLoss: 120, NetIncomeLoss: 110, ComprehensiveIncomeNetOfTax: 120, OtherComprehensiveIncomeLossNetOfTax: 10 }, ['ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest'])
    // v0.1 paired CI (parent) with ProfitLoss and flagged it
    expect(out(run({ ...d, net_income: 120, comprehensive_income: 120 }, V1), 'IS_COMPREHENSIVE_INCOME').outcome).toBe('FAIL')
    const c = out(run(d), 'IS_COMPREHENSIVE_INCOME')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.formula).toBe('CI_PARENT = NET_INCOME_PARENT + OCI_PARENT')
  })
})

describe('item 3 — abstain guards', () => {
  it('operating income abstains when an "other operating" line is reported (fixed us-gaap tag list)', () => {
    const d = withDoc({ operating_income: 170 }, { OtherOperatingIncome: 20 })
    const c = out(run(d), 'IS_OPERATING_INCOME')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.detail).toMatch(/OTHER_OPERATING is reported \(tags\.OtherOperatingIncome\)/)
  })
  it('gross profit abstains on an amortisation-in-cost-of-revenue line, or when the two revenue tags disagree', () => {
    expect(out(run(withDoc({ gross_profit: 380, operating_income: 130 }, { CostOfGoodsAndServicesSoldAmortization: 20 })), 'IS_GROSS_PROFIT').outcome).toBe('INSUFFICIENT_DATA')
    expect(out(run(withDoc({}, { Revenues: 900, RevenueFromContractWithCustomerExcludingAssessedTax: 880 })), 'IS_GROSS_PROFIT').insufficiency?.detail).toMatch(/REVENUES_TAG != REVENUE_CONTRACT_TAG holds/)
    expect(out(run(withDoc({}, { Revenues: 900, RevenueFromContractWithCustomerExcludingAssessedTax: 900 })), 'IS_GROSS_PROFIT').outcome).toBe('PASS')
  })
  it('ending cash abstains unless the beginning balance is dated 350–380 days before the period end (the TIPTREE pattern)', () => {
    expect(out(run(withDoc({ beginning_cash_lag_days: 92 })), 'CF_ENDING_CASH').outcome).toBe('INSUFFICIENT_DATA')
    expect(out(run(withDoc({ beginning_cash_lag_days: 731 })), 'CF_ENDING_CASH').outcome).toBe('INSUFFICIENT_DATA')
    expect(out(run(withDoc({}, {}, ['beginning_cash_lag_days'])), 'CF_ENDING_CASH').insufficiency?.detail).toMatch(/BEGINNING_CASH_LAG_DAYS not reported/)
    for (const lag of [350, 364, 366, 380]) expect(out(run(withDoc({ beginning_cash_lag_days: lag })), 'CF_ENDING_CASH').outcome, String(lag)).toBe('PASS')
  })
  it('cash articulation compares restricted-inclusive with restricted-inclusive, and abstains when no restricted-cash component is reported (the KELLY / XEROX pattern)', () => {
    const v1FalseAlarm = run(clean, V1)
    expect(out(v1FalseAlarm, 'XSTMT_CASH_ARTICULATION').outcome).toBe('FAIL')   // 120 (incl. restricted) vs 100 (excl.)
    expect(out(run(clean), 'XSTMT_CASH_ARTICULATION').outcome).toBe('PASS')     // 120 = 100 + 20
    const split = withDoc({}, { RestrictedCashCurrent: 15, RestrictedCashNoncurrent: 5 })
    expect(out(run(split), 'XSTMT_CASH_ARTICULATION').outcome).toBe('PASS')
    const none = withDoc({ cash: 120 }, {}, ['RestrictedCashCurrent'])
    const c = out(run(none), 'XSTMT_CASH_ARTICULATION')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.detail).toMatch(/^no form of XSTMT_CASH_ARTICULATION has all its required operands/)
  })
})
