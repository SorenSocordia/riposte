/**
 * SEC-CHECK v0.2 HELD-OUT precision audit (ADDENDUM-V02.md §Test; taxonomy T1–T4 + U from PREREG-SEC-CHECK.md), applied
 * to the seeded sample of v0.2 FAILs on 2025q1 in audit-sample-2025q1-v02.jsonl (audit_sample_v02.py, Random(20250101)).
 *
 *   npx tsx bench/sec/audit-v02.mts
 *
 * Operationalisation = audit.mts's (the blind v0.1 audit), unchanged in structure and order:
 *  1. Pull every consolidated USD fact (empty coreg/segments) of each sampled filing from num.txt.
 *  2. gap = left − right of the failed identity, from the values the run used.
 *  3. T4 (our extraction): the identity holds if one operand takes the NEXT tag of its own priority list, or another
 *     standard tag for the same concept that the filing reports.
 *  4. T3 (structural exception): the gap equals ± one, or the ± sum of two, of the check's known exception items.
 *  5. T2 (filer tagging): the gap is consistent with a scale error (one operand ×1000 or ÷1000) or a sign error (one
 *     operand negated).
 *  6. Otherwise UNEXPLAINED → reviewed by hand (audit-assist-v02.mts + manual-labels-2025q1-v02.json).
 *
 * ── EVERY DIFFERENCE FROM audit.mts, AND WHY ───────────────────────────────────────────────────────────────────────────
 *  D1 Inputs/outputs: audit-sample-2025q1-v02.jsonl, data/2025q1/num.txt → audit-results-2025q1-v02.jsonl (+ an
 *     untouched copy audit-results-2025q1-v02.auto.jsonl; audit.mts's .auto copy was made by hand, same content idea).
 *  D2 IDENTITIES ARE v0.2's (task item a). The identity audited per row is the exact form v0.2 evaluated, read from the
 *     row's `formula` (e.g. "ASSETS = LIABILITIES + EQUITY_INCL_NCI + TEMP_EQUITY_PARENT? + REDEEMABLE_NCI?"). Operand
 *     values are resolved from the row's `fields`/`tags` through the v0.2 ruleset's own field paths (first present wins;
 *     an absent `ROLE?` is 0 and not an operand). Self-check: the recomputed left/right must equal the row's left/right
 *     and the formula must be one of the check's forms in the ruleset, else the script aborts.
 *  D3 TOLERANCE IS v0.2's (task item a): U = largest of {1e6, 1e5, 1e3, 1} dividing every REPORTED operand of the form
 *     (no unit if any operand has cents); tol = max(0.01, round4(0.0003 × largest |operand|), U × number of reported
 *     operands) — ruleset notes + build report §2.1. Self-check: must reproduce the row's recorded tolerance.
 *     audit.mts computed ONE tolerance per row (from the original operands) and used it for every test. Here:
 *       - T2 uses that single row tolerance, as audit.mts did (recomputing on a ×1000 operand would inflate the
 *         tolerance 1000× and admit spurious "scale errors" = more flags counted CORRECT = the non-conservative reading).
 *       - T4 and T3 use max(row tolerance, v0.2's tolerance recomputed on the amended operand set). The amended
 *         identity is what v0.2 would evaluate; taking the max is the CONSERVATIVE reading (more false alarms admitted,
 *         i.e. fewer flags counted correct), as the task requires for ambiguous mechanical rules.
 *  D4 T4 candidate tags, per operand role of the form:
 *       (i) "the next tag of its own priority list" = every other tag in the role's v0.2 field-path list (for v0.1 roles
 *           that is the frozen PREREG map's list, for new roles the ruleset's `tags.<Tag>` list), and
 *      (ii) audit.mts's ALT list for the v0.1 concept the role stands for, VERBATIM (ALT below is copied unchanged).
 *           Role → concept: EQUITY and EQUITY_INCL_NCI → equity; PROFIT_LOSS and NET_INCOME_PARENT → net_income;
 *           PRETAX_INCL_EMI and PRETAX_EXCL_EMI → pretax_income; CI_INCL_NCI and CI_PARENT → comprehensive_income; the
 *           v0.1 roles → their own frozen key. OCI_PARENT, NCI, TEMP_*, REDEEMABLE_NCI, EQUITY_METHOD_INCOME, DISCOPS_*,
 *           FX_EFFECT, RESTRICTED_CASH_* have no v0.1 concept, so only (i) applies.
 *     Context for a candidate: audit.mts's rule for (ii) (instant for assets/liabilities/equity/liabilities_and_equity/
 *     cash/ending_cash, else flow); for (i) `tags.` candidates, the extraction's own rule (flow at period, else instant
 *     at period) so the value is exactly what v0.2 would have read. BEGINNING_CASH (prior instant) gets no candidates,
 *     as in audit.mts (ALT had no beginning_cash entry and its frozen list has one tag).
 *     Swapping a role for a tag that v0.2 pairs in ANOTHER form (e.g. PROFIT_LOSS → NetIncomeLoss, OCI_PARENT → total
 *     OCI) is allowed and counts as T4 (the pairing = our mapping's pick). This is the conservative reading.
 *     NOT added: "another whole v0.2 form holds" (multi-operand swaps). audit.mts's T4 is single-operand; that evidence
 *     is printed by audit-assist-v02.mts for the hand labels instead.
 *  D5 T3 exception lists = audit.mts's, MINUS what v0.2 already handles (task item b). Ambiguity: "handled" at check
 *     level (any v0.2 form of the check names the tag) vs row level (the tag is an operand of the form v0.2 actually
 *     evaluated for this row). CONSERVATIVE reading chosen = ROW LEVEL: drop only (1) the tags that are operands of the
 *     evaluated form (adding them again double-counts, so they cannot explain the FAIL) and (2) the abstain-guard tags
 *     (COGS_AMORTIZATION for IS_GROSS_PROFIT; OTHER_OPERATING for IS_OPERATING_INCOME), which are absent in every v0.2
 *     FAIL by construction (dropping them is a no-op). A tag named by another v0.2 form but not in this row's form stays
 *     (e.g. MinorityInterest when EQUITY_INCL_NCI was used; IncomeLossFromEquityMethodInvestments when the incl-EMI
 *     pretax tag was used; an unused restricted-cash or FX tag). The check-level reading is computed too and every row
 *     whose class would differ is printed and recorded as `class_checklevel_drop` (sensitivity, not the result).
 *     Discontinued-operations cash tags STAY in CF_NET_CHANGE's list: v0.2 does not handle them (A1 dropped the term).
 *  D6 The T3 exception lookup context is kept IDENTICAL to audit.mts (per check: instant for the BS checks,
 *     CF_ENDING_CASH and XSTMT; flow otherwise). Known quirk carried over unchanged: CF_ENDING_CASH's FX-effect tags are
 *     flows but are looked up as instants, so they can never match automatically; as in the blind audit, such rows
 *     fall through to the hand labels (the assist searches flows for CF_ENDING_CASH).
 *  D7 T2 iterates every REPORTED operand of the v0.2 form (left, required and present optional terms); audit.mts
 *     iterated left + the fixed v0.1 right fields. Same ×1000 / ÷1000 / negated tests, same `value !== 0` guard.
 *  D8 Output rows carry formula, tolerance and the two T3 readings in addition to audit.mts's fields.
 *  D9 T2 ambiguity guard (CONSERVATIVE reading; found on the first run of this script, before any hand label): with
 *     optional terms, "operand ÷1000" can close the identity only because operand/1000 falls inside the tolerance, i.e.
 *     the test is then the same test as "the operand does not belong in the identity at all" (a structural or
 *     pairing question, not evidence of a scale error). Rule: a scale/sign match is NOT attributed to T2 when setting
 *     that operand to 0 also closes the identity (fixed row tolerance); the row stays UNEXPLAINED for the hand labels.
 *     The audit.mts-identical result (no guard) is recorded per row as `class_mechanical_t2` and reported.
 */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RULESET_PATH = join(HERE, '..', '..', 'packages', 'verify', 'docs', 'examples', 'financial-statement.ruleset.v0.2.json')
const rulesetRaw = readFileSync(RULESET_PATH)
const rulesetSha = createHash('sha256').update(rulesetRaw).digest('hex')
if (!rulesetSha.startsWith('6c683b4afe01adcf')) throw new Error(`v0.2 ruleset sha256 ${rulesetSha} is not the frozen 6c683b4afe01adcf…`)
const V02 = JSON.parse(rulesetRaw.toString('utf8')) as {
  fields: Record<string, { paths: string[] }>
  checks: { code: string; left: string; right: string; alternatives?: { left: string; right: string }[]; abstain_if_present?: string[] }[]
}
const sample = readFileSync(join(HERE, 'audit-sample-2025q1-v02.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const need = new Set(sample.map((s) => s.adsh))

type Fact = { ddate: string; qtrs: string; value: number }
const facts = new Map<string, Map<string, Fact[]>>()
const rl = createInterface({ input: createReadStream(join(HERE, 'data', '2025q1', 'num.txt'), 'utf8'), crlfDelay: Infinity })
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

// ── audit.mts's per-check context + exception lists (VERBATIM; the per-row drop of D5 is applied below) ───────────────
const I = 'instant', F = 'flow'
const CHECKS: Record<string, { ctx: string; exceptions: string[] }> = {
  BS_ACCOUNTING_EQUATION: { ctx: I, exceptions: ['MinorityInterest', 'RedeemableNoncontrollingInterestEquityCarryingAmount', 'TemporaryEquityCarryingAmountAttributableToParent', 'TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests', 'RedeemableNoncontrollingInterestEquityCommonCarryingAmount', 'CommitmentsAndContingencies', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  BS_LIAB_AND_EQUITY_TOTAL: { ctx: I, exceptions: [] },
  BS_ASSET_SPLIT: { ctx: I, exceptions: ['AssetsHeldForSaleCurrent', 'AssetsHeldForSaleNoncurrent', 'DisposalGroupIncludingDiscontinuedOperationAssets'] },
  BS_LIABILITY_SPLIT: { ctx: I, exceptions: ['LiabilitiesOfDisposalGroupIncludingDiscontinuedOperation', 'LiabilitiesSubjectToCompromise'] },
  IS_GROSS_PROFIT: { ctx: F, exceptions: ['CostOfGoodsAndServicesSoldDepreciationAndAmortization', 'DepreciationDepletionAndAmortization', 'OtherCostOfOperatingRevenue'] },
  IS_OPERATING_INCOME: { ctx: F, exceptions: ['OtherOperatingIncomeExpenseNet', 'GainLossOnDispositionOfAssets', 'AssetImpairmentCharges', 'RestructuringCharges', 'OtherOperatingIncome', 'GainLossOnSaleOfPropertyPlantEquipment', 'GoodwillImpairmentLoss'] },
  IS_NET_INCOME: { ctx: F, exceptions: ['IncomeLossFromEquityMethodInvestments', 'IncomeLossFromDiscontinuedOperationsNetOfTax', 'IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity', 'NetIncomeLossAttributableToNoncontrollingInterest', 'IncomeLossFromEquityMethodInvestmentsNetOfDividendsOrDistributions', 'IncomeLossFromDiscontinuedOperationsNetOfTaxIncludingPortionAttributableToNoncontrollingInterest'] },
  IS_COMPREHENSIVE_INCOME: { ctx: F, exceptions: ['ComprehensiveIncomeNetOfTaxAttributableToNoncontrollingInterest', 'NetIncomeLossAttributableToNoncontrollingInterest', 'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToNoncontrollingInterest', 'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToParent'] },
  CF_NET_CHANGE: { ctx: F, exceptions: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'EffectOfExchangeRateOnCashAndCashEquivalents', 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInInvestingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInFinancingActivitiesDiscontinuedOperations', 'NetCashProvidedByUsedInDiscontinuedOperations', 'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations'] },
  CF_ENDING_CASH: { ctx: I, exceptions: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'EffectOfExchangeRateOnCashAndCashEquivalents', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsDisposalGroupIncludingDiscontinuedOperations'] },
  XSTMT_CASH_ARTICULATION: { ctx: I, exceptions: ['RestrictedCash', 'RestrictedCashCurrent', 'RestrictedCashNoncurrent', 'RestrictedCashAndCashEquivalentsAtCarryingValue', 'RestrictedCashAndCashEquivalentsNoncurrent', 'RestrictedCashAndInvestmentsCurrent', 'CashAndCashEquivalentsInDisposalGroup', 'DisposalGroupIncludingDiscontinuedOperationCashAndCashEquivalents', 'RestrictedCashAndCashEquivalents'] },
}
// T4: other standard tags a filer may use for the same field (audit.mts's ALT, VERBATIM)
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
// the frozen PREREG tag map's priority lists (verbatim from sec-run.mts / sec-run-v02.mts), for D4(i) on v0.1 roles
const MAP: Record<string, string[]> = {
  assets: ['Assets'], liabilities: ['Liabilities'], equity: ['StockholdersEquity'], liabilities_and_equity: ['LiabilitiesAndStockholdersEquity'],
  current_assets: ['AssetsCurrent'], noncurrent_assets: ['AssetsNoncurrent'], current_liabilities: ['LiabilitiesCurrent'], noncurrent_liabilities: ['LiabilitiesNoncurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'], revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
  cost_of_goods_sold: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'], gross_profit: ['GrossProfit'], operating_expenses: ['OperatingExpenses'], operating_income: ['OperatingIncomeLoss'],
  pretax_income: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  income_tax_expense: ['IncomeTaxExpenseBenefit'], net_income: ['ProfitLoss', 'NetIncomeLoss'], other_comprehensive_income: ['OtherComprehensiveIncomeLossNetOfTax'],
  comprehensive_income: ['ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest', 'ComprehensiveIncomeNetOfTax'],
  cash_from_operations: ['NetCashProvidedByUsedInOperatingActivities'], cash_from_investing: ['NetCashProvidedByUsedInInvestingActivities'], cash_from_financing: ['NetCashProvidedByUsedInFinancingActivities'],
  net_change_in_cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'CashAndCashEquivalentsPeriodIncreaseDecrease'],
  ending_cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], beginning_cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
}
// D4(ii): v0.2 role → the v0.1 concept (ALT key) it stands for
const CONCEPT: Record<string, string> = { EQUITY_INCL_NCI: 'equity', PROFIT_LOSS: 'net_income', NET_INCOME_PARENT: 'net_income', PRETAX_INCL_EMI: 'pretax_income', PRETAX_EXCL_EMI: 'pretax_income', CI_INCL_NCI: 'comprehensive_income', CI_PARENT: 'comprehensive_income' }
const conceptOf = (role: string): string | undefined => CONCEPT[role] ?? (MAP[V02.fields[role]!.paths[0]!] ? V02.fields[role]!.paths[0] : undefined)
const V01_INSTANT = ['assets', 'liabilities', 'equity', 'liabilities_and_equity', 'cash', 'ending_cash']

// ── v0.2 formula parsing and tolerance ─────────────────────────────────────────────────────────────────────────────
type Term = { role: string; sign: 1 | -1; optional: boolean }
const parseForm = (formula: string): { left: string; right: Term[] } => {
  const [l, r] = formula.split(' = ')
  const right: Term[] = []
  for (const m of (' + ' + r!).matchAll(/([+-])\s*([A-Z_]+)(\?)?/g)) right.push({ role: m[2]!, sign: m[1] === '-' ? -1 : 1, optional: m[3] === '?' })
  return { left: l!.trim(), right }
}
const round4 = (x: number) => Math.round(x * 1e4) / 1e4
const UNITS = [1_000_000, 100_000, 1_000, 1]
function v02tol(ops: number[]): { tol: number; unit: number } {
  const unit = ops.every((x) => Number.isInteger(x)) ? UNITS.find((u) => ops.every((x) => x % u === 0))! : 0
  return { tol: Math.max(0.01, round4(0.0003 * Math.max(...ops.map(Math.abs))), unit * ops.length), unit }
}
const FORMS: Record<string, string[]> = {}
for (const c of V02.checks) FORMS[c.code] = [c, ...(c.alternatives ?? [])].map((f) => `${f.left} = ${f.right}`)
// every tag named by any role of any form / guard of a check (for the check-level sensitivity reading of D5)
const tagsOfRole = (role: string): string[] => V02.fields[role]!.paths.flatMap((p) => p.startsWith('tags.') ? [p.slice(5)] : (MAP[p] ?? []))
const CHECK_LEVEL_HANDLED: Record<string, Set<string>> = {}
for (const c of V02.checks) {
  const roles = new Set<string>()
  for (const f of FORMS[c.code]!) { const p = parseForm(f); roles.add(p.left); p.right.forEach((t) => roles.add(t.role)) }
  for (const g of c.abstain_if_present ?? []) roles.add(g)
  CHECK_LEVEL_HANDLED[c.code] = new Set([...roles].flatMap(tagsOfRole))
}
const GUARD_TAGS: Record<string, string[]> = Object.fromEntries(V02.checks.map((c) => [c.code, (c.abstain_if_present ?? []).flatMap(tagsOfRole)]))

type Row = Record<string, unknown>
const out: Row[] = []
const selfcheck: string[] = []
for (const s of sample) {
  const c = CHECKS[s.check]!
  const m = facts.get(s.adsh) ?? new Map<string, Fact[]>()
  const at = (tag: string, ctx: string): number | undefined => {
    const fs = m.get(tag) ?? []
    return (ctx === 'flow' ? fs.find((f) => f.ddate === s.period && f.qtrs === '4') : fs.find((f) => f.ddate === s.period && f.qtrs === '0'))?.value
  }
  const atExtraction = (tag: string) => at(tag, 'flow') ?? at(tag, 'instant') // sec-run-v02.mts's rule for `tags.` values
  // resolve a v0.2 role exactly as the engine does: first present path
  const resolve = (role: string): { value?: number; tag?: string } => {
    for (const p of V02.fields[role]!.paths) {
      if (p.startsWith('tags.')) { const t = p.slice(5); if (s.tags[t] !== undefined) return { value: s.tags[t], tag: t } }
      else if (s.fields[p] !== undefined) return { value: s.fields[p], tag: String(s.sources[p]).split('@')[0] }
    }
    return {}
  }
  if (!FORMS[s.check]!.includes(s.formula)) throw new Error(`${s.adsh} ${s.check}: formula "${s.formula}" is not a v0.2 form of this check`)
  const form = parseForm(s.formula)
  // operands: [role, sign (left = +1 on the left side), value, tag]; absent optional terms are not operands
  const L = resolve(form.left)
  if (L.value === undefined) throw new Error(`${s.adsh}: left ${form.left} unresolved`)
  const terms = form.right.map((t) => ({ ...t, ...resolve(t.role) }))
  for (const t of terms) if (!t.optional && t.value === undefined) throw new Error(`${s.adsh}: required ${t.role} unresolved`)
  const present = terms.filter((t) => t.value !== undefined) as (Term & { value: number; tag: string })[]
  type Ops = { left: number; right: { role: string; sign: number; value: number }[] }
  const base: Ops = { left: L.value, right: present.map((t) => ({ role: t.role, sign: t.sign, value: t.value })) }
  const sumR = (o: Ops) => o.right.reduce((a, t) => a + t.sign * t.value, 0)
  const opsList = (o: Ops) => [o.left, ...o.right.map((t) => t.value)]
  const left = base.left, right = sumR(base), gap = left - right
  const { tol } = v02tol(opsList(base))
  if (Math.abs(left - s.left) > 1e-6 || Math.abs(right - s.right) > 1e-6) selfcheck.push(`${s.adsh} ${s.check}: recomputed ${left}/${right} vs row ${s.left}/${s.right}`)
  if (Math.abs(tol - s.tolerance) > 1e-6) selfcheck.push(`${s.adsh} ${s.check}: tolerance ${tol} vs row ${s.tolerance}`)
  const closeFixed = (g: number) => Math.abs(g) <= tol
  const closeAmended = (o: Ops) => Math.abs(o.left - sumR(o)) <= Math.max(tol, v02tol(opsList(o)).tol)
  let cls = 'UNEXPLAINED', why = ''

  // T4: one operand takes another tag of its own list, or an ALT tag of its concept (D4)
  const roles = [{ role: form.left, side: 'left' as const, tag: L.tag }, ...terms.map((t) => ({ role: t.role, side: 'right' as const, tag: t.tag }))]
  outer: for (const r of roles) {
    if (r.role === 'BEGINNING_CASH') continue
    const own = V02.fields[r.role]!.paths.flatMap((p) => p.startsWith('tags.') ? [[p.slice(5), 'x'] as const] : (MAP[p] ?? []).map((t) => [t, V01_INSTANT.includes(p) ? I : F] as const))
    const concept = conceptOf(r.role)
    const alt = (concept ? ALT[concept] ?? [] : []).map((t) => [t, V01_INSTANT.includes(concept!) ? I : F] as const)
    const seen = new Set<string>()
    for (const [tag, ctx] of [...own, ...alt]) {
      if (seen.has(tag) || tag === r.tag) continue
      seen.add(tag)
      const v = ctx === 'x' ? atExtraction(tag) : at(tag, ctx)
      const cur = r.side === 'left' ? base.left : base.right.find((t) => t.role === r.role)?.value
      if (v === undefined || v === cur) continue
      let o: Ops
      if (r.side === 'left') o = { ...base, left: v }
      else if (cur !== undefined) o = { left: base.left, right: base.right.map((t) => t.role === r.role ? { ...t, value: v } : t) }
      else o = { left: base.left, right: [...base.right, { role: r.role, sign: form.right.find((t) => t.role === r.role)!.sign, value: v }] }
      if (closeAmended(o)) { cls = 'T4'; why = `holds with ${r.role} = ${tag} (${v}) instead of v0.2's pick (${cur ?? 'absent'}${r.tag ? ` from ${r.tag}` : ''})`; break outer }
    }
  }

  // T3: ± one exception item, or the ± sum of two, closes the gap (D5: row-level drop; D6: audit.mts's context)
  const t3 = (exceptions: string[]): [string, string] | null => {
    const ex = exceptions.map((t) => [t, at(t, c.ctx === 'instant' ? 'instant' : 'flow')] as const).filter(([, v]) => v !== undefined) as [string, number][]
    const withExtra = (...xs: [number, number][]) => ({ left: base.left, right: [...base.right, ...xs.map(([sg, v]) => ({ role: 'EXCEPTION', sign: sg, value: v }))] })
    for (let i = 0; i < ex.length; i++) {
      for (const si of [1, -1]) {
        if (closeAmended(withExtra([si, ex[i]![1]]))) return ['T3', `gap ${gap} = ${si > 0 ? '+' : '−'}${ex[i]![0]} (${ex[i]![1]})`]
        for (let j = i + 1; j < ex.length; j++) for (const sj of [1, -1]) {
          if (closeAmended(withExtra([si, ex[i]![1]], [sj, ex[j]![1]]))) return ['T3', `gap ${gap} = ${si > 0 ? '+' : '−'}${ex[i]![0]} ${sj > 0 ? '+' : '−'}${ex[j]![0]}`]
        }
      }
    }
    return null
  }
  const operandTags = new Set([L.tag, ...present.map((t) => t.tag)])
  const guard = new Set(GUARD_TAGS[s.check] ?? [])
  const exRow = c.exceptions.filter((t) => !operandTags.has(t) && !guard.has(t))
  const exCheck = c.exceptions.filter((t) => !CHECK_LEVEL_HANDLED[s.check]!.has(t))
  let t3check: [string, string] | null = null
  if (cls === 'UNEXPLAINED') {
    const r = t3(exRow); if (r) { cls = r[0]; why = r[1] }
    t3check = t3(exCheck)
  }

  // T2: scale or sign error in one reported operand (fixed row tolerance, as audit.mts)
  const t2 = (guard: boolean): [string, string] | null => {
    for (const r of roles) {
      const isLeft = r.side === 'left'
      const cur = isLeft ? base.left : base.right.find((t) => t.role === r.role)?.value
      if (cur === undefined || cur === 0) continue
      const withValue = (x: number): Ops => isLeft ? { ...base, left: x } : { left: base.left, right: base.right.map((t) => t.role === r.role ? { ...t, value: x } : t) }
      for (const [label, fx] of [['×1000', 1000], ['÷1000', 0.001], ['negated', -1]] as const) {
        const o = withValue(cur * fx)
        if (!closeFixed(o.left - sumR(o))) continue
        const z = withValue(0)
        if (guard && closeFixed(z.left - sumR(z))) continue // D9: indistinguishable from "the operand does not belong"
        return ['T2', `holds if ${r.role} (${r.tag}) is ${label} (a scale/sign tagging error)`]
      }
    }
    return null
  }
  let clsMech = cls, whyMech = ''
  if (cls === 'UNEXPLAINED') {
    const r = t2(true); if (r) { cls = r[0]; why = r[1] }
    const rm = t2(false); if (rm) { clsMech = rm[0]; whyMech = rm[1] }
  }
  // the check-level sensitivity class (only differs from `class` when the row-level T3 fired and the check-level did not)
  let clsCheck = cls
  if (cls === 'T3' && !t3check) { const r = t2(true); clsCheck = r ? 'T2' : 'UNEXPLAINED' }

  out.push({ check: s.check, adsh: s.adsh, name: s.name, link: s.link, prevrpt: s.prevrpt, period: s.period, v01_outcome: s.v01_outcome, formula: s.formula, left, right, gap, tolerance: tol, class: cls, why, class_checklevel_drop: clsCheck, class_mechanical_t2: clsMech, ...(clsMech !== cls ? { why_mechanical_t2: whyMech } : {}) })
}
if (selfcheck.length) { console.error('SELF-CHECK FAILED:\n' + selfcheck.join('\n')); process.exit(1) }
console.log(`self-check: ${sample.length} rows, recomputed left/right/tolerance match the v0.2 run exactly; ruleset sha256 ${rulesetSha.slice(0, 16)}`)
const body = out.map((o) => JSON.stringify(o)).join('\n') + '\n'
writeFileSync(join(HERE, 'audit-results-2025q1-v02.jsonl'), body)
writeFileSync(join(HERE, 'audit-results-2025q1-v02.auto.jsonl'), body)
const tally: Record<string, Record<string, number>> = {}
for (const o of out) { const t = (tally[o.check as string] ??= { T1: 0, T2: 0, T3: 0, T4: 0, UNEXPLAINED: 0 }); t[o.class as string]!++ }
console.log(JSON.stringify(tally, null, 1))
for (const o of out.filter((x) => x.class !== 'UNEXPLAINED')) console.log(`${o.class} ${o.check} ${o.adsh} ${String(o.name).slice(0, 30)}: ${o.why}`)
for (const o of out.filter((x) => x.class !== x.class_checklevel_drop)) console.log(`SENSITIVITY (check-level T3 drop) ${o.check} ${o.adsh}: ${o.class} → ${o.class_checklevel_drop}`)
for (const o of out.filter((x) => x.class !== x.class_mechanical_t2)) console.log(`SENSITIVITY (D9 guard off = audit.mts-identical T2) ${o.check} ${o.adsh}: ${o.class} → ${o.class_mechanical_t2}: ${o.why_mechanical_t2}`)
for (const o of out.filter((x) => x.class === 'UNEXPLAINED')) console.log(`UNEXPLAINED ${o.check} ${o.adsh} ${String(o.name).slice(0, 30)} gap=${o.gap} left=${o.left} right=${o.right} tol=${o.tolerance}`)
