# SEC-CHECK: the financial-statement checker on real SEC filings. PRE-REGISTRATION

**Frozen 2026-09-24 ~09:40, before any SEC data is downloaded.** The freeze is this file's sha256, recorded in RESULTS.md.
Data and results are published with links. Lab iterations stay private per the house FGC ruling; the blind result is
published as-is.

## Question
On a full quarter of **real 10-K filings**, how often does the unmodified `financial-statement-core` ruleset (v0.1.0,
`docs/examples/financial-statement.ruleset.json`, 11 DQC-aligned identities) flag an inconsistency? When it does, how often
is the flag right?

## Data
- SEC **Financial Statement Data Sets**, quarter **2026q1** (the quarter with the most calendar-year 10-Ks). SUB and NUM
  tables, downloaded once as the official ZIP, with its sha256 recorded.
  - Terms: "may be copied or further distributed … without the SEC's permission".
  - Requests carry a declared User-Agent. Only the bulk ZIP is fetched; there is no crawling.
- **Held-out quarter for a later validation: 2025q1.** It is not downloaded until the blind run and its audit are complete.
- **Population:** every SUB row with `form = 10-K`. Values: NUM rows for that `adsh` with empty `coreg`, empty or absent
  `segments` (consolidated), and `uom = USD`.
  - Instants (`qtrs = 0`) are taken at `ddate = period`.
  - Annual flows (`qtrs = 4`) are taken at `ddate = period`.
  - Beginning cash is the instant at the prior fiscal year end (the latest `ddate` < period, `qtrs = 0`, same tag).

## Frozen tag map (the first tag present wins; if none is present, the field is absent and its checks ABSTAIN)
| field | tags, in priority order |
|---|---|
| ASSETS | Assets |
| LIABILITIES | Liabilities |
| EQUITY | StockholdersEquity |
| LIAB_AND_EQUITY | LiabilitiesAndStockholdersEquity |
| CURRENT_ASSETS / NONCURRENT_ASSETS | AssetsCurrent / AssetsNoncurrent |
| CURRENT_LIABILITIES / NONCURRENT_LIABILITIES | LiabilitiesCurrent / LiabilitiesNoncurrent |
| CASH_BS | CashAndCashEquivalentsAtCarryingValue |
| REVENUE | Revenues, RevenueFromContractWithCustomerExcludingAssessedTax |
| COGS | CostOfRevenue, CostOfGoodsAndServicesSold |
| GROSS_PROFIT | GrossProfit |
| OPEX | OperatingExpenses |
| OPERATING_INCOME | OperatingIncomeLoss |
| PRETAX_INCOME | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest, IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments |
| TAX | IncomeTaxExpenseBenefit |
| NET_INCOME | ProfitLoss, NetIncomeLoss |
| OCI | OtherComprehensiveIncomeLossNetOfTax |
| COMPREHENSIVE_INCOME | ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest, ComprehensiveIncomeNetOfTax |
| CFO / CFI / CFF | NetCashProvidedByUsedInOperatingActivities / …InvestingActivities / …FinancingActivities |
| NET_CASH_CHANGE | CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect, CashAndCashEquivalentsPeriodIncreaseDecrease |
| ENDING_CASH / BEGINNING_CASH | CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (at period / at prior year end) |

## Outcomes
- **Primary (per check, v0.1 as-is):** PASS / FAIL / ABSTAIN counts over the population, and the flag rate = FAIL /
  (PASS + FAIL).
- **Precision audit:** a seeded random sample of **up to 10 FAILs per check** (`random.Random(20260924)` over FAIL rows
  sorted by adsh, per check). Each is classified with the taxonomy below, using the filing's own values plus its EDGAR link:
  - **T1 genuine inconsistency:** the filed values violate an identity that should hold for this filer (correct flag).
  - **T2 filer tagging error:** a scale (×1000), sign or wrong-element error in the filing. The data IS internally
    inconsistent, so the flag is correct, but it is a tagging error, not an accounting error.
  - **T3 structural exception:** the identity legitimately doesn't hold for this filer (e.g. noncontrolling interest or
    temporary equity outside StockholdersEquity; FX effect on cash; restricted cash; discontinued operations). **False
    alarm.**
  - **T4 our extraction error:** the wrong period, context or tag picked by our mapping. **False alarm, and our bug.**
  - **Precision = (T1 + T2) / audited.** It is reported per check, with every audited FAIL listed with its link and class.
- **Cross-check:** the share of FAILs whose submission has `prevrpt = 1` (later amended), compared with the PASS rows'
  share. This is descriptive only.

## Expectations (written now; misses are reported)
- `BS_LIAB_AND_EQUITY_TOTAL` has the highest precision (the balance sheet must balance), and most of its FAILs will be T2.
- `BS_ACCOUNTING_EQUATION`, `IS_NET_INCOME`, `CF_NET_CHANGE` and `XSTMT_CASH_ARTICULATION` have LOW precision, dominated by
  T3 (NCI, discontinued ops, FX, restricted cash).
- ABSTAIN is common, because many filers don't tag Liabilities, AssetsNoncurrent, OperatingExpenses or GrossProfit.

## What comes after (NOT part of this blind run)
- A disclosed v0.2 that ABSTAINs when exception tags are present (NCI, temporary equity, FX effect, restricted cash,
  discontinued ops) is written only after this audit.
- v0.2 is validated on the held-out 2025q1, with the same sampling and taxonomy, under its own frozen addendum.
- **The blind v0.1 numbers stay the headline of this document**, whatever they are.
