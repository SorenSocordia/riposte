/**
 * SEC-CHECK blind run (PREREG-SEC-CHECK.md, frozen sha256 dfb646fb…): the UNMODIFIED financial-statement-core ruleset
 * (v0.1.0) over every 10-K in the SEC Financial Statement Data Sets 2026q1.
 *
 *   npx tsx bench/sec/sec-run.ts
 *
 * Streams num.txt (~560 MB). Keeps consolidated (empty coreg, empty segments) USD values for the frozen tag map only.
 * Writes results.jsonl (one row per filing: link, fields, per-check outcome), fails.jsonl (one row per FAIL), summary.json.
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative } from 'riposte-verify'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data')
const RULESET = JSON.parse(readFileSync(join(HERE, '..', '..', 'packages', 'verify', 'docs', 'examples', 'financial-statement.ruleset.json'), 'utf8'))
const PREREG_SHA = createHash('sha256').update(readFileSync(join(HERE, 'PREREG-SEC-CHECK.md'))).digest('hex')

// ── the frozen tag map (PREREG): field -> [extraction key, tags in priority order, context] ─────────────────────────────
type Ctx = 'instant' | 'flow' | 'prior_instant'
const MAP: [string, string[], Ctx][] = [
  ['assets', ['Assets'], 'instant'],
  ['liabilities', ['Liabilities'], 'instant'],
  ['equity', ['StockholdersEquity'], 'instant'],
  ['liabilities_and_equity', ['LiabilitiesAndStockholdersEquity'], 'instant'],
  ['current_assets', ['AssetsCurrent'], 'instant'],
  ['noncurrent_assets', ['AssetsNoncurrent'], 'instant'],
  ['current_liabilities', ['LiabilitiesCurrent'], 'instant'],
  ['noncurrent_liabilities', ['LiabilitiesNoncurrent'], 'instant'],
  ['cash', ['CashAndCashEquivalentsAtCarryingValue'], 'instant'],
  ['revenue', ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'], 'flow'],
  ['cost_of_goods_sold', ['CostOfRevenue', 'CostOfGoodsAndServicesSold'], 'flow'],
  ['gross_profit', ['GrossProfit'], 'flow'],
  ['operating_expenses', ['OperatingExpenses'], 'flow'],
  ['operating_income', ['OperatingIncomeLoss'], 'flow'],
  ['pretax_income', ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'], 'flow'],
  ['income_tax_expense', ['IncomeTaxExpenseBenefit'], 'flow'],
  ['net_income', ['ProfitLoss', 'NetIncomeLoss'], 'flow'],
  ['other_comprehensive_income', ['OtherComprehensiveIncomeLossNetOfTax'], 'flow'],
  ['comprehensive_income', ['ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest', 'ComprehensiveIncomeNetOfTax'], 'flow'],
  ['cash_from_operations', ['NetCashProvidedByUsedInOperatingActivities'], 'flow'],
  ['cash_from_investing', ['NetCashProvidedByUsedInInvestingActivities'], 'flow'],
  ['cash_from_financing', ['NetCashProvidedByUsedInFinancingActivities'], 'flow'],
  ['net_change_in_cash', ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'CashAndCashEquivalentsPeriodIncreaseDecrease'], 'flow'],
  ['ending_cash', ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], 'instant'],
  ['beginning_cash', ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], 'prior_instant'],
]
const WANT = new Set(MAP.flatMap(([, tags]) => tags))

// ── SUB: the 10-K population ─────────────────────────────────────────────────────────────────────────────────────────────
function tsv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
  const cols = head!.split('\t')
  return rows.map((r) => { const v = r.split('\t'); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])) })
}
const subs = new Map<string, Record<string, string>>()
for (const s of tsv(join(DATA, 'sub.txt'))) if (s.form === '10-K') subs.set(s.adsh!, s)

// ── NUM: stream, keep what the map needs ────────────────────────────────────────────────────────────────────────────────
type Fact = { ddate: string; qtrs: string; value: number }
const facts = new Map<string, Map<string, Fact[]>>() // adsh -> tag -> facts
const rl = createInterface({ input: createReadStream(join(DATA, 'num.txt'), 'utf8'), crlfDelay: Infinity })
let cols: string[] | null = null, scanned = 0, kept = 0
for await (const line of rl) {
  if (!cols) { cols = line.split('\t'); continue }
  scanned++
  const v = line.split('\t')
  const adsh = v[0]!, tag = v[1]!
  if (!WANT.has(tag) || !subs.has(adsh)) continue
  const row = Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']))
  if (row.uom !== 'USD' || (row.coreg ?? '') !== '' || (row.segments ?? '') !== '' || row.value === '') continue
  const byTag = facts.get(adsh) ?? new Map<string, Fact[]>()
  facts.set(adsh, byTag)
  const arr = byTag.get(tag) ?? []
  byTag.set(tag, arr)
  arr.push({ ddate: row.ddate!, qtrs: row.qtrs!, value: Number(row.value) })
  kept++
}

// ── per filing: extraction → the unmodified ruleset → outcomes ─────────────────────────────────────────────────────────
const link = (cik: string, adsh: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, '')}/`
const results: string[] = [], fails: string[] = []
const summary: Record<string, { PASS: number; FAIL: number; INSUFFICIENT_DATA: number }> = {}
for (const [adsh, s] of subs) {
  const byTag = facts.get(adsh) ?? new Map<string, Fact[]>()
  const period = s.period!
  const ex: Record<string, number> = {}
  const src: Record<string, string> = {}
  for (const [key, tags, ctx] of MAP) {
    for (const tag of tags) {
      const fs = byTag.get(tag) ?? []
      let f: Fact | undefined
      if (ctx === 'instant') f = fs.find((x) => x.ddate === period && x.qtrs === '0')
      else if (ctx === 'flow') f = fs.find((x) => x.ddate === period && x.qtrs === '4')
      else f = fs.filter((x) => x.qtrs === '0' && x.ddate < period).sort((a, b) => b.ddate.localeCompare(a.ddate))[0]
      if (f) { ex[key] = f.value; src[key] = `${tag}@${f.ddate}/q${f.qtrs}`; break }
    }
  }
  const verdict = verifyDeclarative(ex as never, RULESET)
  const checks: Record<string, string> = {}
  for (const c of verdict.claims) {
    const code = String(c.rule_id)
    checks[code] = c.outcome
    summary[code] ??= { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }
    summary[code][c.outcome as 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA']++
    if (c.outcome === 'FAIL') fails.push(JSON.stringify({ check: code, adsh, cik: s.cik, name: s.name, afs: s.afs, prevrpt: s.prevrpt, period, link: link(s.cik!, adsh), explanation: (c as { explanation?: string }).explanation ?? '', fields: ex, sources: src }))
  }
  results.push(JSON.stringify({ adsh, cik: s.cik, name: s.name, afs: s.afs, prevrpt: s.prevrpt, period, link: link(s.cik!, adsh), fields: ex, sources: src, checks }))
}
writeFileSync(join(HERE, 'results.jsonl'), results.join('\n') + '\n')
writeFileSync(join(HERE, 'fails.jsonl'), fails.join('\n') + (fails.length ? '\n' : ''))
const out = {
  prereg_sha256: PREREG_SHA, data_zip_sha256: createHash('sha256').update(readFileSync(join(DATA, '2026q1.zip'))).digest('hex'),
  ruleset: `${RULESET.id}@${RULESET.version}`, filings_10k: subs.size, num_rows_scanned: scanned, num_rows_kept: kept,
  per_check: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { ...v, flag_rate: v.PASS + v.FAIL ? +(v.FAIL / (v.PASS + v.FAIL)).toFixed(4) : null }])),
}
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
