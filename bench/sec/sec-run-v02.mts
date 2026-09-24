/**
 * SEC-CHECK v0.2 run (ADDENDUM-V02.md): financial-statement-core v0.1.0 AND v0.2.0 over every 10-K of one quarter of the
 * SEC Financial Statement Data Sets, on the SAME extraction.
 *
 *   npx tsx bench/sec/sec-run-v02.mts [quarter]     (default 2026q1)
 *
 * Data: data/<quarter>/ (sub.txt, num.txt, <quarter>.zip), or data/ itself when data/<quarter>.zip sits there (2026q1's
 * layout). Either way the run aborts unless ≥ 99% of the 10-K rows in sub.txt were filed inside that quarter, so one
 * quarter's files can never be read as another's. This script downloads nothing.
 *
 * Extraction = sec-run.mts's, unchanged (the frozen PREREG tag map, same population and context rules), plus:
 *   - `tags`: every us-gaap tag the v0.2 ruleset names in a `tags.<Tag>` field path (NCI, temporary equity, FX effect,
 *     discontinued-operations cash and income, equity-method income, the "other operating" lines, restricted-cash
 *     components, amortisation in cost of revenue, the second revenue tag, the paired net-income / CI / OCI / pretax
 *     tags). The tag list is read from the ruleset, so it lives in one place. Value = the consolidated USD fact at
 *     ddate = period with qtrs = 4 (flows), else qtrs = 0 (instants).
 *   - `beginning_cash_lag_days`: days between the period end and the date of the beginning-cash fact the frozen map chose.
 * v0.1 reads only the frozen-map keys, so it sees exactly what the blind run saw (verified row by row against
 * results.jsonl when that file exists for the quarter).
 *
 * Writes results-<quarter>-v02.jsonl (one row per filing: both rulesets' outcomes, v0.2's form or abstain reason),
 * fails-<quarter>-v02.jsonl (one row per v0.2 FAIL, for the audit) and summary-<quarter>-v02.json (both flag-rate tables
 * side by side, transitions, coverage retention, v0.2 abstain reasons, interpretation diagnostics).
 * It never touches sec-run.mts, results.jsonl, fails.jsonl, summary.json, audit-*, RESULTS.md, PREREG or ADDENDUM.
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative } from 'riposte-verify'

const HERE = dirname(fileURLToPath(import.meta.url))
const QUARTER = process.argv[2] ?? '2026q1'
if (!/^\d{4}q[1-4]$/.test(QUARTER)) throw new Error(`quarter must look like 2026q1 (got "${QUARTER}")`)
const DATA = existsSync(join(HERE, 'data', QUARTER, 'num.txt')) ? join(HERE, 'data', QUARTER)
  : existsSync(join(HERE, 'data', `${QUARTER}.zip`)) && existsSync(join(HERE, 'data', 'num.txt')) ? join(HERE, 'data')
  : null
if (!DATA) throw new Error(`no extracted data for ${QUARTER}: expected data/${QUARTER}/num.txt, or data/${QUARTER}.zip with its files in data/. This script downloads nothing.`)
const EXAMPLES = join(HERE, '..', '..', 'packages', 'verify', 'docs', 'examples')
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
const V01_PATH = join(EXAMPLES, 'financial-statement.ruleset.json'), V02_PATH = join(EXAMPLES, 'financial-statement.ruleset.v0.2.json')
const V01 = JSON.parse(readFileSync(V01_PATH, 'utf8')), V02 = JSON.parse(readFileSync(V02_PATH, 'utf8'))
const TUNING = QUARTER === '2026q1'

// ── the frozen tag map (PREREG), verbatim from sec-run.mts ──────────────────────────────────────────────────────────────
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
// ── the v0.2 tag list: every `tags.<Tag>` field path in the v0.2 ruleset ───────────────────────────────────────────────
const V02_TAGS: string[] = [...new Set(Object.values(V02.fields as Record<string, { paths: string[] }>).flatMap(f => f.paths).filter(p => p.startsWith('tags.')).map(p => p.slice('tags.'.length)))]
const WANT = new Set([...MAP.flatMap(([, tags]) => tags), ...V02_TAGS])

// ── SUB: the 10-K population (+ the quarter-membership guard) ─────────────────────────────────────────────────────────
function tsv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
  const cols = head!.split('\t')
  return rows.map((r) => { const v = r.split('\t'); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])) })
}
const subs = new Map<string, Record<string, string>>()
for (const s of tsv(join(DATA, 'sub.txt'))) if (s.form === '10-K') subs.set(s.adsh!, s)
{
  const y = QUARTER.slice(0, 4), q = Number(QUARTER.slice(5))
  const lo = `${y}${String(3 * q - 2).padStart(2, '0')}01`, hi = `${y}${String(3 * q).padStart(2, '0')}31`
  const inside = [...subs.values()].filter((s) => s.filed! >= lo && s.filed! <= hi).length
  if (subs.size === 0 || inside / subs.size < 0.99) throw new Error(`${DATA}/sub.txt does not look like ${QUARTER}: only ${inside}/${subs.size} 10-Ks filed ${lo}–${hi}`)
}

// ── NUM: stream, keep what either ruleset needs ─────────────────────────────────────────────────────────────────────
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

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const link = (cik: string, adsh: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, '')}/`
const days = (a: string, b: string): number => (Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8)) - Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8))) / 86_400_000
type Claim = { rule_id: string; outcome: string; explanation?: string; variance?: number; computation?: { formula: string; operands: { left: number; right: number }; tolerance?: { abs?: number } }; insufficiency?: { reason: string; detail: string } }
/** v0.2 abstain reason, bucketed: which guard, no applicable form, or a missing / unparseable operand. */
const reasonKey = (c: Claim): string => {
  const d = c.insufficiency?.detail ?? ''
  let m: RegExpMatchArray | null
  if ((m = d.match(/^guard abstain_if_present: (\S+) is reported/))) return `guard abstain_if_present(${m[1]})`
  if ((m = d.match(/^guard abstain_unless_all_present: (.+) not reported/))) return `guard abstain_unless_all_present(${m[1]})`
  if ((m = d.match(/^guard abstain_if: (.+?) holds/))) return `guard abstain_if(${m[1]})`
  if (d.startsWith('no form of')) return 'no applicable form (required operands absent)'
  return c.insufficiency?.reason ?? 'unknown'
}
type Tally = { PASS: number; FAIL: number; INSUFFICIENT_DATA: number }
const blank = (): Tally => ({ PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 })
const CODES: string[] = V01.checks.map((c: { code: string }) => c.code)
const t01: Record<string, Tally> = {}, t02: Record<string, Tally> = {}
const transitions: Record<string, Record<string, number>> = {}
const abstainReasons: Record<string, Record<string, number>> = {}
const forms: Record<string, Record<string, number>> = {}
for (const c of CODES) { t01[c] = blank(); t02[c] = blank(); transitions[c] = {}; abstainReasons[c] = {}; forms[c] = {} }
const diag = { emi_reported_with_pretax_incl_emi_decided: 0, xstmt_no_restricted_component_but_ending_equals_bs_cash: 0, cf_net_change_fail_with_discops_term: 0, cf_net_change_fail_that_would_hold_without_discops_term: 0 }

// ── per filing: one extraction → v0.1 and v0.2 ────────────────────────────────────────────────────────────────────────
const results: string[] = [], fails: string[] = []
for (const [adsh, s] of subs) {
  const byTag = facts.get(adsh) ?? new Map<string, Fact[]>()
  const period = s.period!
  const ex: Record<string, number> = {}
  const src: Record<string, string> = {}
  let beginDate: string | undefined
  for (const [key, tags, ctx] of MAP) {
    for (const tag of tags) {
      const fs = byTag.get(tag) ?? []
      let f: Fact | undefined
      if (ctx === 'instant') f = fs.find((x) => x.ddate === period && x.qtrs === '0')
      else if (ctx === 'flow') f = fs.find((x) => x.ddate === period && x.qtrs === '4')
      else f = fs.filter((x) => x.qtrs === '0' && x.ddate < period).sort((a, b) => b.ddate.localeCompare(a.ddate))[0]
      if (f) { ex[key] = f.value; src[key] = `${tag}@${f.ddate}/q${f.qtrs}`; if (ctx === 'prior_instant') beginDate = f.ddate; break }
    }
  }
  const tagVals: Record<string, number> = {}
  for (const tag of V02_TAGS) {
    const fs = byTag.get(tag) ?? []
    const f = fs.find((x) => x.ddate === period && x.qtrs === '4') ?? fs.find((x) => x.ddate === period && x.qtrs === '0')
    if (f) tagVals[tag] = f.value
  }
  const extraction: Record<string, unknown> = { ...ex, ...(beginDate ? { beginning_cash_lag_days: days(period, beginDate) } : {}), tags: tagVals }
  const v1 = verifyDeclarative(extraction as never, V01), v2 = verifyDeclarative(extraction as never, V02)
  const c1: Record<string, string> = {}, c2: Record<string, string> = {}, note2: Record<string, string> = {}
  for (const c of v1.claims as unknown as Claim[]) { c1[c.rule_id] = c.outcome; t01[c.rule_id]![c.outcome as keyof Tally]++ }
  for (const c of v2.claims as unknown as Claim[]) {
    const code = c.rule_id
    c2[code] = c.outcome
    t02[code]![c.outcome as keyof Tally]++
    const tr = `${c1[code]}>${c.outcome}`; transitions[code]![tr] = (transitions[code]![tr] ?? 0) + 1
    if (c.outcome === 'INSUFFICIENT_DATA') { const k = reasonKey(c); abstainReasons[code]![k] = (abstainReasons[code]![k] ?? 0) + 1; note2[code] = c.insufficiency?.detail ?? '' }
    else { const f = c.computation?.formula ?? ''; forms[code]![f] = (forms[code]![f] ?? 0) + 1; note2[code] = f }
    if (c.outcome === 'FAIL') fails.push(JSON.stringify({ ruleset: `${V02.id}@${V02.version}`, check: code, adsh, cik: s.cik, name: s.name, afs: s.afs, prevrpt: s.prevrpt, period, link: link(s.cik!, adsh), formula: c.computation?.formula, left: c.computation?.operands.left, right: c.computation?.operands.right, variance: c.variance, tolerance: c.computation?.tolerance?.abs, explanation: c.explanation ?? '', v01_outcome: c1[code], fields: ex, sources: src, beginning_cash_lag_days: extraction.beginning_cash_lag_days, tags: tagVals }))
  }
  // interpretation diagnostics (counts only; see the build report)
  const ni = (v2.claims as unknown as Claim[]).find((c) => c.rule_id === 'IS_NET_INCOME')!
  if (ni.outcome !== 'INSUFFICIENT_DATA' && /PRETAX_INCL_EMI/.test(ni.computation?.formula ?? '') && tagVals.IncomeLossFromEquityMethodInvestments !== undefined) diag.emi_reported_with_pretax_incl_emi_decided++
  const rc = ['RestrictedCash', 'RestrictedCashAndCashEquivalents', 'RestrictedCashCurrent', 'RestrictedCashAndCashEquivalentsAtCarryingValue', 'RestrictedCashNoncurrent', 'RestrictedCashAndCashEquivalentsNoncurrent'].some((t) => tagVals[t] !== undefined)
  if (!rc && ex.ending_cash !== undefined && ex.cash !== undefined && ex.ending_cash === ex.cash) diag.xstmt_no_restricted_component_but_ending_equals_bs_cash++
  const cf = (v2.claims as unknown as Claim[]).find((c) => c.rule_id === 'CF_NET_CHANGE')!
  if (cf.outcome === 'FAIL' && /DISCOPS/.test(cf.computation?.formula ?? '')) {
    const disc = ['NetCashProvidedByUsedInDiscontinuedOperations', 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInInvestingActivitiesDiscontinuedOperations', 'CashProvidedByUsedInFinancingActivitiesDiscontinuedOperations']
    const total = tagVals.NetCashProvidedByUsedInDiscontinuedOperations ?? disc.slice(1).reduce((a, t) => a + (tagVals[t] ?? 0), 0)
    if (disc.some((t) => tagVals[t] !== undefined && tagVals[t] !== 0)) {
      diag.cf_net_change_fail_with_discops_term++
      if (Math.abs((cf.variance ?? 0) + total) <= (cf.computation?.tolerance?.abs ?? 0)) diag.cf_net_change_fail_that_would_hold_without_discops_term++
    }
  }
  results.push(JSON.stringify({ adsh, cik: s.cik, name: s.name, afs: s.afs, prevrpt: s.prevrpt, period, link: link(s.cik!, adsh), fields: ex, sources: src, beginning_cash_lag_days: extraction.beginning_cash_lag_days, tags: tagVals, checks_v01: c1, checks_v02: c2, v02_form_or_reason: note2 }))
}

// ── v0.1 regression: on the blind quarter, v0.1 must reproduce results.jsonl row by row ─────────────────────────────
let regression: { compared: number; mismatched_filings: number; mismatches: string[] } | string = 'not applicable (no blind-run results.jsonl for this quarter)'
if (TUNING && existsSync(join(HERE, 'results.jsonl'))) {
  const blind = new Map(readFileSync(join(HERE, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l); return [r.adsh as string, r.checks as Record<string, string>] }))
  const mism: string[] = []
  let compared = 0
  for (const line of results) {
    const r = JSON.parse(line)
    const b = blind.get(r.adsh)
    compared++
    if (!b || JSON.stringify(b) !== JSON.stringify(r.checks_v01)) mism.push(r.adsh)
  }
  regression = { compared, mismatched_filings: mism.length + [...blind.keys()].filter((k) => !subs.has(k)).length, mismatches: mism.slice(0, 20) }
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const rate = (t: Tally) => (t.PASS + t.FAIL ? +(t.FAIL / (t.PASS + t.FAIL)).toFixed(4) : null)
const per_check = Object.fromEntries(CODES.map((code) => {
  const a = t01[code]!, b = t02[code]!
  const kept = transitions[code]!['PASS>PASS'] ?? 0
  const ra = rate(a), rb = rate(b)
  return [code, {
    v01: { ...a, flag_rate: ra }, v02: { ...b, flag_rate: rb },
    flag_rate_change: ra && rb !== null ? +((rb - ra) / ra).toFixed(4) : null,
    v01_pass_kept_by_v02: { same_filing_still_pass: a.PASS ? +(kept / a.PASS).toFixed(4) : null, pass_count_ratio: a.PASS ? +(b.PASS / a.PASS).toFixed(4) : null },
    transitions_v01_to_v02: transitions[code], v02_abstain_reasons: abstainReasons[code], v02_forms_decided: forms[code],
  }]
}))
const summary = {
  quarter: QUARTER, data_dir: DATA.replace(HERE, '.'),
  tuning_set: TUNING ? 'YES. v0.2 was designed from the 2026q1 audit of v0.1 (ADDENDUM-V02.md). v0.2 numbers on this quarter are NOT evidence of anything; the only honest test is the held-out quarter.' : 'no (held-out)',
  prereg_sha256: sha(join(HERE, 'PREREG-SEC-CHECK.md')), addendum_sha256: sha(join(HERE, 'ADDENDUM-V02.md')),
  data_zip_sha256: existsSync(join(DATA, `${QUARTER}.zip`)) ? sha(join(DATA, `${QUARTER}.zip`)) : null,
  rulesets: { v01: `${V01.id}@${V01.version}`, v01_file_sha256: sha(V01_PATH), v02: `${V02.id}@${V02.version}`, v02_file_sha256: sha(V02_PATH) },
  v02_tags_extracted: V02_TAGS.length,
  filings_10k: subs.size, num_rows_scanned: scanned, num_rows_kept: kept,
  v01_regression_vs_blind_results: regression,
  per_check,
  pass_bar_coverage_checks: Object.fromEntries(['BS_LIAB_AND_EQUITY_TOTAL', 'IS_GROSS_PROFIT', 'CF_ENDING_CASH'].map((c) => [c, per_check[c]!.v01_pass_kept_by_v02])),
  structural_checks_flag_rate_change: Object.fromEntries(['BS_ACCOUNTING_EQUATION', 'CF_NET_CHANGE', 'XSTMT_CASH_ARTICULATION'].map((c) => [c, per_check[c]!.flag_rate_change])),
  interpretation_diagnostics: diag,
}
writeFileSync(join(HERE, `results-${QUARTER}-v02.jsonl`), results.join('\n') + '\n')
writeFileSync(join(HERE, `fails-${QUARTER}-v02.jsonl`), fails.join('\n') + (fails.length ? '\n' : ''))
writeFileSync(join(HERE, `summary-${QUARTER}-v02.json`), JSON.stringify(summary, null, 2) + '\n')

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(2)}%`)
const lines = [`# ${QUARTER}${TUNING ? ' (TUNING SET: v0.2 was designed on this quarter)' : ''}: ${subs.size} 10-Ks`, '',
  '| check | v0.1 PASS | v0.1 FAIL | v0.1 abstain | v0.1 flag rate | v0.2 PASS | v0.2 FAIL | v0.2 abstain | v0.2 flag rate |', '|---|---|---|---|---|---|---|---|---|',
  ...CODES.map((c) => { const a = t01[c]!, b = t02[c]!; return `| ${c} | ${a.PASS} | ${a.FAIL} | ${a.INSUFFICIENT_DATA} | ${pct(rate(a))} | ${b.PASS} | ${b.FAIL} | ${b.INSUFFICIENT_DATA} | ${pct(rate(b))} |` })]
console.log(lines.join('\n'))
console.log(JSON.stringify({ v01_regression_vs_blind_results: regression, pass_bar_coverage_checks: summary.pass_bar_coverage_checks, structural_checks_flag_rate_change: summary.structural_checks_flag_rate_change, interpretation_diagnostics: diag }, null, 1))
