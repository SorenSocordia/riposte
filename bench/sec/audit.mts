/**
 * SEC-CHECK precision audit (PREREG-SEC-CHECK.md, taxonomy T1–T4), applied to the seeded sample in audit-sample.jsonl.
 *
 *   npx tsx bench/sec/audit.mts
 *
 * Operationalisation (written before looking at any sampled filing's other facts):
 *  1. Pull every consolidated USD fact (empty coreg/segments) of each sampled filing from num.txt.
 *  2. gap = left − right of the failed identity, from the values the run used.
 *  3. T4 (our extraction): the identity holds if one field takes the NEXT tag of its own frozen priority list, or another
 *     standard tag for the same concept that the filing reports (listed per field below).
 *  4. T3 (structural exception): the gap equals ± one, or the ± sum of two, of the check's known exception items.
 *  5. T2 (filer tagging): the gap is consistent with a scale error (one operand ×1000 or ÷1000) or a sign error (one
 *     operand negated).
 *  6. Otherwise UNEXPLAINED. These are reviewed by hand against the EDGAR filing, and are T1 unless the filing shows otherwise.
 * Tolerance = the ruleset's own: max(2, 0.0003 × largest operand).
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sample = readFileSync(join(HERE, 'audit-sample.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const need = new Set(sample.map((s) => s.adsh))

type Fact = { ddate: string; qtrs: string; value: number }
const facts = new Map<string, Map<string, Fact[]>>()
const rl = createInterface({ input: createReadStream(join(HERE, 'data', 'num.txt'), 'utf8'), crlfDelay: Infinity })
let cols: string[] | null = null
for await (const line of rl) {
  if (!cols) { cols = line.split('\t'); continue }
  const v = line.split('\t')
  if (!need.has(v[0]!)) continue
  const r = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']))
  if (r.uom !== 'USD' || r.coreg !== '' || (r.segments ?? '') !== '' || r.value === '') continue
  const m = facts.get(r.adsh!) ?? new Map<string, Fact[]>(); facts.set(r.adsh!, m)
  const a = m.get(r.tag!) ?? []; m.set(r.tag!, a); a.push({ ddate: r.ddate!, qtrs: r.qtrs!, value: Number(r.value) })
}

// per check: [left field, right fields with signs], exception tags (context), alternative tags per field (T4)
const I = 'instant', F = 'flow'
const CHECKS: Record<string, { left: string; right: [string, 1 | -1][]; ctx: string; exceptions: string[] }> = {
  BS_ACCOUNTING_EQUATION: { left: 'assets', right: [['liabilities', 1], ['equity', 1]], ctx: I, exceptions: ['MinorityInterest', 'RedeemableNoncontrollingInterestEquityCarryingAmount', 'TemporaryEquityCarryingAmountAttributableToParent', 'TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests', 'RedeemableNoncontrollingInterestEquityCommonCarryingAmount', 'CommitmentsAndContingencies', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  BS_LIAB_AND_EQUITY_TOTAL: { left: 'assets', right: [['liabilities_and_equity', 1]], ctx: I, exceptions: [] },
  BS_ASSET_SPLIT: { left: 'assets', right: [['current_assets', 1], ['noncurrent_assets', 1]], ctx: I, exceptions: ['AssetsHeldForSaleCurrent', 'AssetsHeldForSaleNoncurrent', 'DisposalGroupIncludingDiscontinuedOperationAssets'] },
  BS_LIABILITY_SPLIT: { left: 'liabilities', right: [['current_liabilities', 1], ['noncurrent_liabilities', 1]], ctx: I, exceptions: ['LiabilitiesOfDisposalGroupIncludingDiscontinuedOperation', 'LiabilitiesSubjectToCompromise'] },
  IS_GROSS_PROFIT: { left: 'gross_profit', right: [['revenue', 1], ['cost_of_goods_sold', -1]], ctx: F, exceptions: ['CostOfGoodsAndServicesSoldDepreciationAndAmortization', 'DepreciationDepletionAndAmortization', 'OtherCostOfOperatingRevenue'] },
  IS_OPERATING_INCOME: { left: 'operating_income', right: [['gross_profit', 1], ['operating_expenses', -1]], ctx: F, exceptions: ['OtherOperatingIncomeExpenseNet', 'GainLossOnDispositionOfAssets', 'AssetImpairmentCharges', 'RestructuringCharges', 'OtherOperatingIncome', 'GainLossOnSaleOfPropertyPlantEquipment', 'GoodwillImpairmentLoss'] },
  IS_NET_INCOME: { left: 'net_income', right: [['pretax_income', 1], ['income_tax_expense', -1]], ctx: F, exceptions: ['IncomeLossFromEquityMethodInvestments', 'IncomeLossFromDiscontinuedOperationsNetOfTax', 'IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity', 'NetIncomeLossAttributableToNoncontrollingInterest', 'IncomeLossFromEquityMethodInvestmentsNetOfDividendsOrDistributions', 'IncomeLossFromDiscontinuedOperationsNetOfTaxIncludingPortionAttributableToNoncontrollingInterest'] },
  IS_COMPREHENSIVE_INCOME: { left: 'comprehensive_income', right: [['net_income', 1], ['other_comprehensive_income', 1]], ctx: F, exceptions: ['ComprehensiveIncomeNetOfTaxAttributableToNoncontrollingInterest', 'NetIncomeLossAttributableToNoncontrollingInterest', 'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToNoncontrollingInterest', 'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToParent'] },
  CF_NET_CHANGE: { left: 'net_change_in_cash', right: [['cash_from_operations', 1], ['cash_from_investing', 1], ['cash_from_financing', 1]], ctx: F, exceptions: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'EffectOfExchangeRateOnCashAndCashEquivalents', 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInInvestingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInFinancingActivitiesDiscontinuedOperations', 'NetCashProvidedByUsedInDiscontinuedOperations', 'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations'] },
  CF_ENDING_CASH: { left: 'ending_cash', right: [['beginning_cash', 1], ['net_change_in_cash', 1]], ctx: I, exceptions: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'EffectOfExchangeRateOnCashAndCashEquivalents', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsDisposalGroupIncludingDiscontinuedOperations'] },
  XSTMT_CASH_ARTICULATION: { left: 'ending_cash', right: [['cash', 1]], ctx: I, exceptions: ['RestrictedCash', 'RestrictedCashCurrent', 'RestrictedCashNoncurrent', 'RestrictedCashAndCashEquivalentsAtCarryingValue', 'RestrictedCashAndCashEquivalentsNoncurrent', 'RestrictedCashAndInvestmentsCurrent', 'CashAndCashEquivalentsInDisposalGroup', 'DisposalGroupIncludingDiscontinuedOperationCashAndCashEquivalents', 'RestrictedCashAndCashEquivalents'] },
}
// T4: other standard tags a filer may use for the same field (includes the frozen map's own lower-priority tags)
const ALT: Record<string, string[]> = {
  equity: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'PartnersCapital', 'MembersEquity', 'PartnersCapitalIncludingPortionAttributableToNoncontrollingInterest'],
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  cost_of_goods_sold: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  net_income: ['ProfitLoss', 'NetIncomeLoss', 'IncomeLossFromContinuingOperations'],
  operating_expenses: ['OperatingExpenses', 'CostsAndExpenses', 'OperatingCostsAndExpenses'],
  pretax_income: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  comprehensive_income: ['ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest', 'ComprehensiveIncomeNetOfTax'],
  net_change_in_cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseExcludingExchangeRateEffect', 'CashAndCashEquivalentsPeriodIncreaseDecrease', 'CashAndCashEquivalentsPeriodIncreaseDecreaseExcludingExchangeRateEffect'],
  ending_cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndCashEquivalentsAtCarryingValue'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'Cash', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
}

const out: Record<string, unknown>[] = []
for (const s of sample) {
  const c = CHECKS[s.check]!
  const m = facts.get(s.adsh) ?? new Map<string, Fact[]>()
  const at = (tag: string, ctx: string): number | undefined => {
    const fs = m.get(tag) ?? []
    return (ctx === 'flow' ? fs.find((f) => f.ddate === s.period && f.qtrs === '4') : fs.find((f) => f.ddate === s.period && f.qtrs === '0'))?.value
  }
  const f = s.fields as Record<string, number>
  const val = (k: string) => f[k] ?? 0
  const rightSum = (ff: Record<string, number>) => c.right.reduce((a, [k, sg]) => a + sg * (ff[k] ?? 0), 0)
  const left = val(c.left), right = rightSum(f)
  const gap = left - right
  const tol = Math.max(2, 0.0003 * Math.max(Math.abs(left), ...c.right.map(([k]) => Math.abs(val(k)))))
  const close = (g: number) => Math.abs(g) <= tol
  let cls = 'UNEXPLAINED', why = ''
  // T4: an alternative tag for one field closes the identity
  outer: for (const field of [c.left, ...c.right.map(([k]) => k)]) {
    for (const tag of ALT[field] ?? []) {
      const ctx = ['assets', 'liabilities', 'equity', 'liabilities_and_equity', 'cash', 'ending_cash'].includes(field) ? 'instant' : 'flow'
      const alt = at(tag, ctx)
      if (alt === undefined || alt === f[field]) continue
      const ff = { ...f, [field]: alt }
      if (close(ff[c.left]! - rightSum(ff))) { cls = 'T4'; why = `holds with ${field} = ${tag} (${alt}) instead of the frozen map's pick (${f[field]})`; break outer }
    }
  }
  // T3: ± one exception item, or the ± sum of two, closes the gap
  if (cls === 'UNEXPLAINED') {
    const ex = c.exceptions.map((t) => [t, at(t, c.ctx === 'instant' ? 'instant' : 'flow')] as const).filter(([, v]) => v !== undefined) as [string, number][]
    search: for (let i = 0; i < ex.length; i++) {
      for (const si of [1, -1]) {
        if (close(gap - si * ex[i]![1])) { cls = 'T3'; why = `gap ${gap} = ${si > 0 ? '+' : '−'}${ex[i]![0]} (${ex[i]![1]})`; break search }
        for (let j = i + 1; j < ex.length; j++) for (const sj of [1, -1]) {
          if (close(gap - si * ex[i]![1] - sj * ex[j]![1])) { cls = 'T3'; why = `gap ${gap} = ${si > 0 ? '+' : '−'}${ex[i]![0]} ${sj > 0 ? '+' : '−'}${ex[j]![0]}`; break search }
        }
      }
    }
  }
  // T2: scale or sign error in one operand
  if (cls === 'UNEXPLAINED') {
    for (const field of [c.left, ...c.right.map(([k]) => k)]) {
      for (const [label, fx] of [['×1000', 1000], ['÷1000', 0.001], ['negated', -1]] as const) {
        const ff = { ...f, [field]: val(field) * fx }
        if (val(field) !== 0 && close(ff[c.left]! - rightSum(ff))) { cls = 'T2'; why = `holds if ${field} is ${label} (a scale/sign tagging error)`; break }
      }
      if (cls === 'T2') break
    }
  }
  out.push({ check: s.check, adsh: s.adsh, name: s.name, link: s.link, prevrpt: s.prevrpt, left, right, gap, class: cls, why })
}
writeFileSync(join(HERE, 'audit-results.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n')
const tally: Record<string, Record<string, number>> = {}
for (const o of out) { const t = (tally[o.check as string] ??= { T1: 0, T2: 0, T3: 0, T4: 0, UNEXPLAINED: 0 }); t[o.class as string]!++ }
console.log(JSON.stringify(tally, null, 1))
for (const o of out.filter((x) => x.class === 'UNEXPLAINED')) console.log(`UNEXPLAINED ${o.check} ${o.adsh} ${String(o.name).slice(0, 30)} gap=${o.gap} left=${o.left} right=${o.right}`)
