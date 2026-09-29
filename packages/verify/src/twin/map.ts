/**
 * The declared concept map: which binding fact each extracted field means. This is where a field's DEFINITION lives
 * (the concept layer), next to its period layer. The scale and sign layers come from the fact itself (`scale`, `sign`).
 *
 * FS_CORE_TWIN_MAP is the frozen SEC-CHECK tag map (priority order, verbatim), the definition the extraction
 * prompt's 25 keys were written from. Declaring it once, here, makes the shared definition explicit: a scorer that
 * reads the same map from the same filing is NOT independent of a judge that uses it (see CREDENCE-1 §7).
 */

/**
 * instant        an instant within the period tolerance of the period end (balance-sheet date)
 * FY             a duration ending within the tolerance of the period end, 350–380 days long (the fiscal year)
 * prior_instant  the latest instant 350–380 days before the period end (the start of the fiscal year)
 */
export type TwinPeriod = 'instant' | 'FY' | 'prior_instant'

export interface TwinFieldMap {
  field: string
  /** the workflow cell (statement × field family) this field belongs to, for per-cell calibration */
  cell: string
  /** local names in the map's namespace, in priority order: the first one the twin reports in the period binds */
  concepts: readonly string[]
  period: TwinPeriod
  /**
   * (v0.2.1) the field is an endpoint of the cash-flow statement's cash roll (start + change = end), with `change` the
   * field whose binding is the period's net change. When the face statement presents several lines of the field's
   * concept family with different values, the roll decides which one is the field's line.
   */
  roll?: TwinRoll
}

export interface TwinRoll {
  position: 'start' | 'end'
  change: string
}

/**
 * document   (v0.1) a field's concepts bind anywhere in the document, first concept in priority order
 * statement  (v0.2) only concepts the filing's presentation linkbase places on a face statement can bind; needs
 *            `TwinOptions.presentation` (else every claim ABSTAINs with NO_PRESENTATION_LINKBASE)
 */
export type TwinBindingMode = 'document' | 'statement'
/**
 * exact     (v0.1) PASS iff |value| equals the most precise fact of the binding concept and period (± tolerance)
 * decimals  (v0.2) PASS iff |value| equals ANY consistent duplicate of that fact (± tolerance), e.g. the statement's
 *           figure in thousands when a note repeats it to the dollar; a value that differs but lies inside the binding
 *           fact's own declared rounding (0.5 × 10^−decimals) is ABSTAIN (ROUNDED_BINDING), never a FAIL
 */
export type TwinMatchingMode = 'exact' | 'decimals'
/**
 * map             (v0.1, v0.2) a field binds only the concepts the map lists
 * scope-variants  (v0.2.1) a field's family also holds each listed concept's us-gaap scope variants (the concept's
 *                 name + a SCOPE_VARIANT_SUFFIXES suffix), at lower priority than every listed concept; a statement-
 *                 anchored map binds whichever family member the linkbase places on the face. For a `roll` field the
 *                 statement's own cash roll decides between face lines that disagree; when it cannot, ABSTAIN
 *                 (AMBIGUOUS_LINE)
 */
export type TwinFamilyMode = 'map' | 'scope-variants'
/**
 * diagnose  (v0.1, v0.2) SCALE is only a diagnosis of a FAIL on a bound value
 * anchored  (v0.2.1) also: a claim that is EXACTLY a power of ten (10^±3/6/9) times an anchored figure FAILs with
 *           SCALE even where the field does not bind. Anchored = a face line of the field's concept family, or the
 *           field's own concept reported off the face (NOT_ON_STATEMENT) at a value the face statement prints. Never
 *           applied to a value that is not anchored.
 */
export type TwinScaleMode = 'diagnose' | 'anchored'

/**
 * us-gaap names a concept's superset-scope variant by appending one of these to its local name. In us-gaap 2024–2026
 * (the SEC's FSDS tag.txt) the fields mapped here have two:
 * CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations (the
 * 2025 taxonomy relabels the plain concept "…, Continuing Operation" and its net change "…, Including … Discontinued
 * Operation", so 2025 filers tag the cash-flow roll's endpoints with the variant) and
 * CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations. Suffixed names the taxonomy does not define
 * never occur in a filing and so never bind. Components ("…DisposalGroupIncludingDiscontinuedOperations", the disposal
 * group's own share) and subset variants ("…ContinuingOperations") are NOT scope variants.
 */
export const SCOPE_VARIANT_SUFFIXES = ['IncludingDisposalGroupAndDiscontinuedOperations', 'IncludingDiscontinuedOperations'] as const

export interface TwinConceptMap {
  /** doubles as the verdict's ruleset id / version / domain */
  id: string
  version: string
  domain: string
  /** the taxonomy the concepts belong to (only US-GAAP is supported by this version) */
  taxonomy: 'us-gaap'
  fields: readonly TwinFieldMap[]
  /** default 'document' (v0.1) */
  binding?: TwinBindingMode
  /** default 'exact' (v0.1) */
  matching?: TwinMatchingMode
  /** default 'map' (v0.1, v0.2) */
  family?: TwinFamilyMode
  /** default 'diagnose' (v0.1, v0.2) */
  scale?: TwinScaleMode
  /**
   * the reading of the presentation linkbase a statement-anchored map requires (parseTwinPresentation's `links`);
   * default 'v0.2'. A map that requires 'strict' ABSTAINs every claim (NO_PRESENTATION_LINKBASE) on any other reading.
   */
  links?: 'v0.2' | 'strict'
}

/** The concepts a field can bind under a map, in priority order: the listed concepts, then (scope-variants) their variants. */
export function twinFieldConcepts(map: TwinConceptMap, fm: TwinFieldMap): readonly string[] {
  if ((map.family ?? 'map') !== 'scope-variants') return fm.concepts
  return [...fm.concepts, ...fm.concepts.flatMap((c) => SCOPE_VARIANT_SUFFIXES.map((s) => `${c}${s}`))]
}

export const FS_CORE_TWIN_MAP: TwinConceptMap = {
  id: 'twin-xbrl-fs-core',
  version: '0.1.0',
  domain: 'financial-statements',
  taxonomy: 'us-gaap',
  fields: [
    { field: 'assets', cell: 'BS.totals', concepts: ['Assets'], period: 'instant' },
    { field: 'liabilities', cell: 'BS.totals', concepts: ['Liabilities'], period: 'instant' },
    { field: 'equity', cell: 'BS.totals', concepts: ['StockholdersEquity'], period: 'instant' },
    { field: 'liabilities_and_equity', cell: 'BS.totals', concepts: ['LiabilitiesAndStockholdersEquity'], period: 'instant' },
    { field: 'current_assets', cell: 'BS.current', concepts: ['AssetsCurrent'], period: 'instant' },
    { field: 'current_liabilities', cell: 'BS.current', concepts: ['LiabilitiesCurrent'], period: 'instant' },
    { field: 'noncurrent_assets', cell: 'BS.noncurrent', concepts: ['AssetsNoncurrent'], period: 'instant' },
    { field: 'noncurrent_liabilities', cell: 'BS.noncurrent', concepts: ['LiabilitiesNoncurrent'], period: 'instant' },
    { field: 'cash', cell: 'BS.cash', concepts: ['CashAndCashEquivalentsAtCarryingValue'], period: 'instant' },
    { field: 'revenue', cell: 'IS.revenue', concepts: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'], period: 'FY' },
    { field: 'cost_of_goods_sold', cell: 'IS.revenue', concepts: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'], period: 'FY' },
    { field: 'gross_profit', cell: 'IS.revenue', concepts: ['GrossProfit'], period: 'FY' },
    { field: 'operating_expenses', cell: 'IS.operating', concepts: ['OperatingExpenses'], period: 'FY' },
    { field: 'operating_income', cell: 'IS.operating', concepts: ['OperatingIncomeLoss'], period: 'FY' },
    { field: 'pretax_income', cell: 'IS.bottom', concepts: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'], period: 'FY' },
    { field: 'income_tax_expense', cell: 'IS.bottom', concepts: ['IncomeTaxExpenseBenefit'], period: 'FY' },
    { field: 'net_income', cell: 'IS.bottom', concepts: ['ProfitLoss', 'NetIncomeLoss'], period: 'FY' },
    { field: 'other_comprehensive_income', cell: 'CI', concepts: ['OtherComprehensiveIncomeLossNetOfTax'], period: 'FY' },
    { field: 'comprehensive_income', cell: 'CI', concepts: ['ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest', 'ComprehensiveIncomeNetOfTax'], period: 'FY' },
    { field: 'cash_from_operations', cell: 'CF.activities', concepts: ['NetCashProvidedByUsedInOperatingActivities'], period: 'FY' },
    { field: 'cash_from_investing', cell: 'CF.activities', concepts: ['NetCashProvidedByUsedInInvestingActivities'], period: 'FY' },
    { field: 'cash_from_financing', cell: 'CF.activities', concepts: ['NetCashProvidedByUsedInFinancingActivities'], period: 'FY' },
    { field: 'net_change_in_cash', cell: 'CF.cash', concepts: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'CashAndCashEquivalentsPeriodIncreaseDecrease'], period: 'FY' },
    { field: 'ending_cash', cell: 'CF.cash', concepts: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], period: 'instant' },
    { field: 'beginning_cash', cell: 'CF.cash', concepts: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], period: 'prior_instant' },
  ],
}

/**
 * Twin v0.2 (CREDENCE-2): the SAME 25 fields, concepts, priorities, periods and cells as v0.1, bound through the
 * filing's own presentation linkbase (statement-anchored) and matched decimals-aware. Select it by passing it as
 * `TwinOptions.map` together with `TwinOptions.presentation`; v0.1 (FS_CORE_TWIN_MAP) stays the default.
 */
export const FS_CORE_TWIN_MAP_V02: TwinConceptMap = {
  ...FS_CORE_TWIN_MAP,
  version: '0.2.0',
  binding: 'statement',
  matching: 'decimals',
}

/**
 * Twin v0.2.1 (TWIN-V021): v0.2 (statement-anchored, decimals-aware; the same 25 fields, listed concepts, priorities,
 * periods and cells) plus
 *   family 'scope-variants'  a field also binds its listed concepts' us-gaap scope variants when the face presents them
 *                            (the Lodging Fund class: the printed ending-cash line is the …IncludingDisposalGroup… concept)
 *   roll                     ending_cash / beginning_cash are the endpoints of the cash roll over net_change_in_cash
 *   scale 'anchored'         an exact power-of-ten error against an anchored figure FAILs (SCALE) even where the field
 *                            does not bind (the Kinetic Seas class)
 *   links 'strict'           the presentation must be read with parseTwinPresentation(…, { links: 'strict' }) (a
 *                            self-closing presentationLink no longer swallows the next statement)
 * v0.2 is unchanged (CREDENCE-2's results are bound to it); v0.1 stays the default.
 */
export const FS_CORE_TWIN_MAP_V021: TwinConceptMap = {
  ...FS_CORE_TWIN_MAP_V02,
  version: '0.2.1',
  family: 'scope-variants',
  scale: 'anchored',
  links: 'strict',
  fields: FS_CORE_TWIN_MAP.fields.map((f): TwinFieldMap =>
    f.field === 'ending_cash' ? { ...f, roll: { position: 'end', change: 'net_change_in_cash' } }
      : f.field === 'beginning_cash' ? { ...f, roll: { position: 'start', change: 'net_change_in_cash' } }
        : f),
}
