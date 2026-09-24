# SEC-CHECK: RESULTS (blind v0.1 run, 2026-09-24)

- **Pre-registration:** PREREG-SEC-CHECK.md, sha256 `dfb646fba4c0303b40f28a32b22f59bf501de7c316c06090e55409edced4832d` (frozen before any download).
- **Data:** SEC Financial Statement Data Sets **2026q1** (sha256 `d18c01c615da8f5cd46273b0dacaeee5b1163f4089171da0f84153a5f3c362f6`), <https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets>. Terms: "may be copied or further distributed … without the SEC's permission".
- **Ruleset:** `financial-statement-core@0.1.0`, unmodified. **Population:** 4262 10-K filings. Re-run: `sec-run.mts`, `audit_sample.py`, `audit.mts`, `audit-assist.mts`, `manual-labels.json`.

## 1. Flag rates (every 10-K in the quarter)

| check | PASS | FAIL | abstain | flag rate |
|---|---|---|---|---|
| BS_ACCOUNTING_EQUATION | 2310 | 1164 | 788 | 33.51% |
| BS_LIAB_AND_EQUITY_TOTAL | 4117 | 1 | 144 | 0.02% |
| BS_ASSET_SPLIT | 277 | 3 | 3982 | 1.07% |
| BS_LIABILITY_SPLIT | 322 | 2 | 3938 | 0.62% |
| IS_GROSS_PROFIT | 1102 | 13 | 3147 | 1.17% |
| IS_OPERATING_INCOME | 733 | 21 | 3508 | 2.79% |
| IS_NET_INCOME | 2485 | 368 | 1409 | 12.90% |
| IS_COMPREHENSIVE_INCOME | 1138 | 58 | 3066 | 4.85% |
| CF_NET_CHANGE | 1598 | 1329 | 1335 | 45.40% |
| CF_ENDING_CASH | 2407 | 66 | 1789 | 2.67% |
| XSTMT_CASH_ARTICULATION | 1293 | 1259 | 1710 | 49.33% |

## 2. Precision audit (a seeded sample: up to 10 FAILs per check; taxonomy T1–T4 as pre-registered)

| check | audited | T1 genuine | T2 filer tagging | T3 structural | T4 our extraction | U unresolved | precision (U as false … U as correct) |
|---|---|---|---|---|---|---|---|
| BS_ACCOUNTING_EQUATION | 10 | 0 | 0 | 5 | 3 | 2 | 0% … 20% |
| BS_ASSET_SPLIT | 3 | 0 | 1 | 2 | 0 | 0 | 33% … 33% |
| BS_LIABILITY_SPLIT | 2 | 0 | 0 | 2 | 0 | 0 | 0% … 0% |
| BS_LIAB_AND_EQUITY_TOTAL | 1 | 0 | 0 | 1 | 0 | 0 | 0% … 0% |
| CF_ENDING_CASH | 10 | 0 | 0 | 5 | 1 | 4 | 0% … 40% |
| CF_NET_CHANGE | 10 | 0 | 0 | 10 | 0 | 0 | 0% … 0% |
| IS_COMPREHENSIVE_INCOME | 10 | 0 | 0 | 2 | 5 | 3 | 0% … 30% |
| IS_GROSS_PROFIT | 10 | 0 | 0 | 7 | 2 | 1 | 0% … 10% |
| IS_NET_INCOME | 10 | 0 | 0 | 7 | 3 | 0 | 0% … 0% |
| IS_OPERATING_INCOME | 10 | 0 | 0 | 6 | 0 | 4 | 0% … 40% |
| XSTMT_CASH_ARTICULATION | 10 | 0 | 0 | 0 | 10 | 0 | 0% … 0% |
| **all** | **86** | | | | | | **1% … 17%** |

## 3. What it means (the blind result, published as the pre-registration requires)
- **The shipped ruleset raises false alarms on real filings.** Of 86 audited flags, **1** is a real inconsistency in the filed data: PPL tagged AssetsNoncurrent on a subtotal that excludes its USD 36.1bn of PP&E. **Up to 14** more are unresolved (U). The rest are false alarms.
- **Why the false alarms happen**, in order of frequency:
  - **structural exceptions** the identities don't allow for: noncontrolling and redeemable interests, and SPAC temporary equity (A ≠ L + E); FX effects and discontinued operations in cash flows; restricted cash (ASU 2016-18); and operating lines outside OperatingExpenses (royalties, subsidies, staking, other operating income);
  - **our own concept pairing:** restricted-cash-inclusive totals against exclusive balance-sheet cash, and revenue/COGS tag priority;
  - **presentation rounding:** statements reported in thousands or millions, where the parts sum one unit off the total. The ruleset's tolerance caps at USD 2.
- **Predictions vs outcome:**
  - Predicted: low precision, dominated by T3, for the equation, net-income and cash-flow checks. That was confirmed.
  - Predicted: BS_LIAB_AND_EQUITY_TOTAL fails mostly as T2. That was wrong. Its single FAIL (of 4,118 decided) was rounding. The balance sheet balances in every filing.
  - **Rounding was not in the pre-registered taxonomy.** It is counted as T3 (a false alarm), which is the conservative direction.
- **What the product must do instead:** abstain rather than raise false alarms.
  1. Rounding-aware tolerance, with the reporting unit inferred from the values.
  2. Exception-aware identities: add NCI, temporary equity, FX and discontinued-operations terms when they are reported, and abstain when an unexplained other operating line exists.
  3. Consistent restricted-cash pairing.
  That is v0.2. Per the pre-registration it is validated ONLY on the held-out quarter 2025q1, which has not yet been downloaded, under its own frozen addendum.

## 4. Every audited flag (link, class, reason)

| check | filing | class | reason |
|---|---|---|---|
| BS_ACCOUNTING_EQUATION | [HUNTINGTON BANCSHARES INC /MD/](https://www.sec.gov/Archives/edgar/data/49196/000004919626000015/) | T4 | holds with equity = StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest (24379000000) instead of the frozen map's pick (24342000000) |
| BS_ACCOUNTING_EQUATION | [DOUGLAS ELLIMAN INC.](https://www.sec.gov/Archives/edgar/data/1878897/000187889726000007/) | T4 | holds with equity = StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest (183278000) instead of the frozen map's pick (183950000) |
| BS_ACCOUNTING_EQUATION | [GLOBA TERRA ACQUISITION CORP](https://www.sec.gov/Archives/edgar/data/2043766/000114036126011428/) | T3 | gap 178380953 = +TemporaryEquityCarryingAmountAttributableToParent (178380953) |
| BS_ACCOUNTING_EQUATION | [WEBTOON ENTERTAINMENT INC.](https://www.sec.gov/Archives/edgar/data/1997859/000199785926000028/) | T3 | gap 57820000 = +MinorityInterest +RedeemableNoncontrollingInterestEquityCarryingAmount |
| BS_ACCOUNTING_EQUATION | [STAGWELL INC](https://www.sec.gov/Archives/edgar/data/876883/000087688326000010/) | U | gap 42.942m; no single reported line matches (likely noncontrolling / redeemable interests under a custom tag). Not resolved |
| BS_ACCOUNTING_EQUATION | [AFFILIATED MANAGERS GROUP, INC.](https://www.sec.gov/Archives/edgar/data/1004434/000162828026008665/) | U | gap 1.1837bn; no single line matches (likely redeemable non-controlling interests). Not resolved |
| BS_ACCOUNTING_EQUATION | [OXLEY BRIDGE ACQUISITION LTD](https://www.sec.gov/Archives/edgar/data/2034313/000121390026036390/) | T3 | SPAC: gap = AssetsHeldInTrustNoncurrent (258,227,025) = the Class A shares subject to redemption, i.e. temporary equity outside StockholdersEquity |
| BS_ACCOUNTING_EQUATION | [WINVEST ACQUISITION CORP.](https://www.sec.gov/Archives/edgar/data/1854463/000149315226013671/) | T3 | gap 3184646 = +TemporaryEquityCarryingAmountAttributableToParent (3184646) |
| BS_ACCOUNTING_EQUATION | [BLACKLINE, INC.](https://www.sec.gov/Archives/edgar/data/1666134/000162828026011915/) | T3 | gap 39121000 = +RedeemableNoncontrollingInterestEquityCarryingAmount (39121000) |
| BS_ACCOUNTING_EQUATION | [VICTORIA'S SECRET & CO.](https://www.sec.gov/Archives/edgar/data/1856437/000185643726000004/) | T4 | holds with equity = StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest (910000000) instead of the frozen map's pick (856000000) |
| BS_ASSET_SPLIT | [PPL CORP](https://www.sec.gov/Archives/edgar/data/922224/000092222426000008/) | T2 | AssetsNoncurrent is tagged on a subtotal that excludes PropertyPlantAndEquipmentNet (gap = PP&E, 36.132bn): a wrong-element tagging error, so the filed data is inconsiste |
| BS_ASSET_SPLIT | [AUTOLIV INC](https://www.sec.gov/Archives/edgar/data/1034670/000119312526058162/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 1,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| BS_ASSET_SPLIT | [EVE HOLDING, INC.](https://www.sec.gov/Archives/edgar/data/1823652/000155485526000300/) | T3 | ROUNDING: all values are multiples of 1,000; /gap/ 1,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| BS_LIABILITY_SPLIT | [TEVA PHARMACEUTICAL INDUSTRIES LTD](https://www.sec.gov/Archives/edgar/data/818686/000119312526034532/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 1,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| BS_LIABILITY_SPLIT | [GENERAL MOTORS CO](https://www.sec.gov/Archives/edgar/data/1467858/000146785826000013/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 1,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| BS_LIAB_AND_EQUITY_TOTAL | [TWINLAB CONSOLIDATED HOLDINGS, INC](https://www.sec.gov/Archives/edgar/data/1590695/000175392626000426/) | T3 | ROUNDING: all values are multiples of 1,000; /gap/ 1,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| CF_ENDING_CASH | [INTERNATIONAL FLAVORS & FRAGRANCES](https://www.sec.gov/Archives/edgar/data/51253/000005125326000006/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 2,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| CF_ENDING_CASH | [BEYONDSPRING INC.](https://www.sec.gov/Archives/edgar/data/1677940/000117184326001908/) | U | gap 8.773m; no single line matches (a beginning-cash period pick is suspect). Not resolved |
| CF_ENDING_CASH | [CALLAWAY GOLF CO](https://www.sec.gov/Archives/edgar/data/837465/000083746526000010/) | U | gap 5.0m; no single line matches. Not resolved |
| CF_ENDING_CASH | [SCIENTIFIC INDUSTRIES INC](https://www.sec.gov/Archives/edgar/data/87802/000165495426003102/) | T3 | gap = EffectOfExchangeRateOnCash… (38,700): the reported net change excludes the FX effect |
| CF_ENDING_CASH | [TIPTREE INC.](https://www.sec.gov/Archives/edgar/data/1393726/000139372626000009/) | U | gap 30.24m; the beginning cash we picked (544,000) is implausibly small: a likely T4 period pick. Not resolved |
| CF_ENDING_CASH | [PLUG POWER INC](https://www.sec.gov/Archives/edgar/data/1093691/000110465926022286/) | T4 | gap = RestrictedCashPeriodIncreaseDecreaseTotal (209.572m): our map paired a net change excluding restricted cash with totals including it |
| CF_ENDING_CASH | [SL INVESTMENT FUND II LLC](https://www.sec.gov/Archives/edgar/data/2028686/000119312526091861/) | T3 | gap = EffectOfForeignExchangeRateOnCash… (11,000): FX effect |
| CF_ENDING_CASH | [OCCIDENTAL PETROLEUM CORP /DE/](https://www.sec.gov/Archives/edgar/data/797468/000162828026009059/) | U | gap -34m; no single line matches. Not resolved |
| CF_ENDING_CASH | [RESTAURANT BRANDS INTERNATIONAL IN](https://www.sec.gov/Archives/edgar/data/1618756/000161875626000017/) | T3 | gap = the cash change of a disposal group / discontinued operations (66m) |
| CF_ENDING_CASH | [PARTNERS GROUP LENDING FUND, LLC](https://www.sec.gov/Archives/edgar/data/1938649/000139834426005654/) | T3 | gap = EffectOfExchangeRateOnCash… (-122,000): FX effect |
| CF_NET_CHANGE | [FORD MOTOR CREDIT CO LLC](https://www.sec.gov/Archives/edgar/data/38009/000003800926000010/) | T3 | gap 281000000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations (281000000) |
| CF_NET_CHANGE | [KRAFT HEINZ CO](https://www.sec.gov/Archives/edgar/data/1637459/000163745926000009/) | T3 | gap 80000000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (80000000) |
| CF_NET_CHANGE | [LIVEWIRE GROUP, INC.](https://www.sec.gov/Archives/edgar/data/1898795/000189879526000028/) | T3 | gap -36000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (-36000) |
| CF_NET_CHANGE | [KRATOS DEFENSE & SECURITY SOLUTION](https://www.sec.gov/Archives/edgar/data/1069258/000106925826000013/) | T3 | gap 1000000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations (1000000) |
| CF_NET_CHANGE | [CARDLYTICS, INC.](https://www.sec.gov/Archives/edgar/data/1666071/000166607126000010/) | T3 | gap 259000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (259000) |
| CF_NET_CHANGE | [SOUTHWEST GAS HOLDINGS, INC.](https://www.sec.gov/Archives/edgar/data/1692115/000169211526000062/) | T3 | gap = FX effect including the disposal group (-127,000) |
| CF_NET_CHANGE | [GLOBE LIFE INC.](https://www.sec.gov/Archives/edgar/data/320335/000032033526000090/) | T3 | gap -5342000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (-5342000) |
| CF_NET_CHANGE | [WARBY PARKER INC.](https://www.sec.gov/Archives/edgar/data/1504776/000150477626000006/) | T3 | gap 457000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (457000) |
| CF_NET_CHANGE | [GOGO INC.](https://www.sec.gov/Archives/edgar/data/1537054/000119312526082487/) | T3 | gap 168000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (168000) |
| CF_NET_CHANGE | [Q2 HOLDINGS, INC.](https://www.sec.gov/Archives/edgar/data/1410384/000141038426000006/) | T3 | gap 49000 = +EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents (49000) |
| IS_COMPREHENSIVE_INCOME | [HUMANA INC](https://www.sec.gov/Archives/edgar/data/49071/000004907126000009/) | T4 | holds with net_income = NetIncomeLoss (1188000000) instead of the frozen map's pick (1203000000) |
| IS_COMPREHENSIVE_INCOME | [FOCUS UNIVERSAL INC.](https://www.sec.gov/Archives/edgar/data/1590418/000168316826002503/) | U | gap = preferred stock accretion (453,334): comprehensive income appears to be presented after accretion. Could be element misuse (T2) or a presentation choice (T3); not r |
| IS_COMPREHENSIVE_INCOME | [AON PLC](https://www.sec.gov/Archives/edgar/data/315293/000162828026008116/) | T4 | holds with net_income = NetIncomeLoss (3695000000) instead of the frozen map's pick (3750000000) |
| IS_COMPREHENSIVE_INCOME | [MARRIOTT VACATIONS WORLDWIDE CORP](https://www.sec.gov/Archives/edgar/data/1524358/000152435826000010/) | T4 | holds with net_income = NetIncomeLoss (-308000000) instead of the frozen map's pick (-307000000) |
| IS_COMPREHENSIVE_INCOME | [A10 NETWORKS, INC.](https://www.sec.gov/Archives/edgar/data/1580808/000158080826000014/) | U | gap ≈ an OCI component (unrealised holding gain 367,000, within one rounding unit): the tagged OCI total may be a subtotal. Not resolved |
| IS_COMPREHENSIVE_INCOME | [WESTERN ALLIANCE BANCORPORATION](https://www.sec.gov/Archives/edgar/data/1212545/000162828026010336/) | T4 | holds with net_income = NetIncomeLoss (969000000) instead of the frozen map's pick (990600000) |
| IS_COMPREHENSIVE_INCOME | [ASTEC INDUSTRIES INC](https://www.sec.gov/Archives/edgar/data/792987/000079298726000011/) | T3 | gap -100000 = −ComprehensiveIncomeNetOfTaxAttributableToNoncontrollingInterest (100000) |
| IS_COMPREHENSIVE_INCOME | [CROWDSTRIKE HOLDINGS, INC.](https://www.sec.gov/Archives/edgar/data/1535527/000153552726000010/) | T4 | holds with net_income = NetIncomeLoss (-162502000) instead of the frozen map's pick (-161165000) |
| IS_COMPREHENSIVE_INCOME | [DIAMONDBACK ENERGY, INC.](https://www.sec.gov/Archives/edgar/data/1539838/000153983826000010/) | U | gap 116m; no single line matches (likely NCI). Not resolved |
| IS_COMPREHENSIVE_INCOME | [AMERICOLD REALTY TRUST](https://www.sec.gov/Archives/edgar/data/1455863/000162828026012274/) | T3 | gap -236000 = −ComprehensiveIncomeNetOfTaxAttributableToNoncontrollingInterest (236000) |
| IS_GROSS_PROFIT | [MOLSON COORS BEVERAGE CO](https://www.sec.gov/Archives/edgar/data/24545/000002454526000006/) | T4 | holds with revenue = RevenueFromContractWithCustomerIncludingAssessedTax (11140800000) instead of the frozen map's pick (13040300000) |
| IS_GROSS_PROFIT | [KNOWLES CORP](https://www.sec.gov/Archives/edgar/data/1587523/000158752326000005/) | U | gap -4.4m; no single line matches. Not resolved |
| IS_GROSS_PROFIT | [BONK, INC.](https://www.sec.gov/Archives/edgar/data/1760903/000149315226014015/) | T4 | gap = crypto revenue (RevenueOnDigitalAssets 1,812,352) included in gross profit but not in the revenue tag our map picked |
| IS_GROSS_PROFIT | [ALTRIA GROUP, INC.](https://www.sec.gov/Archives/edgar/data/764180/000076418026000017/) | T3 | gap -3140000000 = −OtherCostOfOperatingRevenue (3140000000) |
| IS_GROSS_PROFIT | [INDIVIOR PHARMACEUTICALS, INC.](https://www.sec.gov/Archives/edgar/data/1625297/000162828026012237/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 1,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| IS_GROSS_PROFIT | [INSIGHT MOLECULAR DIAGNOSTICS INC.](https://www.sec.gov/Archives/edgar/data/1642380/000164238026000004/) | T3 | gap = amortisation of acquired intangibles in cost of revenue (7,000): COGS is presented excluding amortisation |
| IS_GROSS_PROFIT | [CORMEDIX INC.](https://www.sec.gov/Archives/edgar/data/1410098/000121390026023889/) | T3 | gap = amortisation of intangibles (13.872m): COGS is presented excluding amortisation |
| IS_GROSS_PROFIT | [BOSTON SCIENTIFIC CORP](https://www.sec.gov/Archives/edgar/data/885725/000088572526000010/) | T3 | ROUNDING: all values are multiples of 1,000,000; /gap/ 1,000,000 ≤ 3 units (presentation rounding; not in the pre-registered taxonomy → counted as a false alarm) |
| IS_GROSS_PROFIT | [CRITEO S.A.](https://www.sec.gov/Archives/edgar/data/1576427/000157642726000014/) | T3 | gap -125237000 = −OtherCostOfOperatingRevenue (125237000) |
| IS_GROSS_PROFIT | [GROUP 1 AUTOMOTIVE INC](https://www.sec.gov/Archives/edgar/data/1031203/000103120326000064/) | T3 | ROUNDING: values are multiples of 100,000 (reported in tenths of a million); gap = one unit |
| IS_NET_INCOME | [DIXIE GROUP INC](https://www.sec.gov/Archives/edgar/data/29332/000002933226000018/) | T4 | holds with net_income = IncomeLossFromContinuingOperations (-7275000) instead of the frozen map's pick (-7615000) |
| IS_NET_INCOME | [EMPERY DIGITAL INC.](https://www.sec.gov/Archives/edgar/data/1829794/000168316826002333/) | T4 | holds with net_income = IncomeLossFromContinuingOperations (-148570842) instead of the frozen map's pick (-150052486) |
| IS_NET_INCOME | [ORION S.A.](https://www.sec.gov/Archives/edgar/data/1609804/000162828026008601/) | T3 | gap 500000 = +IncomeLossFromEquityMethodInvestments (500000) |
| IS_NET_INCOME | [HINES GLOBAL INCOME TRUST, INC.](https://www.sec.gov/Archives/edgar/data/1585101/000162828026022047/) | T3 | gap = income tax on the sale of real estate (23.333m), presented outside IncomeTaxExpenseBenefit |
| IS_NET_INCOME | [CONSTELLATION ENERGY CORP](https://www.sec.gov/Archives/edgar/data/1868275/000186827526000032/) | T3 | gap -1000000 = +IncomeLossFromEquityMethodInvestments (-1000000) |
| IS_NET_INCOME | [OMEGA HEALTHCARE INVESTORS INC](https://www.sec.gov/Archives/edgar/data/888491/000088849126000008/) | T3 | gap -218000 = +IncomeLossFromEquityMethodInvestments (-218000) |
| IS_NET_INCOME | [VULCAN MATERIALS CO](https://www.sec.gov/Archives/edgar/data/1396009/000162828026009546/) | T3 | gap -4500000 = +IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity (-4500000) |
| IS_NET_INCOME | [VERIS RESIDENTIAL, INC.](https://www.sec.gov/Archives/edgar/data/924901/000162828026010572/) | T4 | holds with net_income = IncomeLossFromContinuingOperations (74826000) instead of the frozen map's pick (78941000) |
| IS_NET_INCOME | [BRINKS CO](https://www.sec.gov/Archives/edgar/data/78890/000007889026000010/) | T3 | gap -400000 = +IncomeLossFromDiscontinuedOperationsNetOfTax (-400000) |
| IS_NET_INCOME | [CLEAR CHANNEL OUTDOOR HOLDINGS, IN](https://www.sec.gov/Archives/edgar/data/1334978/000133497826000010/) | T3 | gap 128486000 = +IncomeLossFromDiscontinuedOperationsNetOfTax (128486000) |
| IS_OPERATING_INCOME | [OXFORD INDUSTRIES INC](https://www.sec.gov/Archives/edgar/data/75288/000007528826000026/) | T3 | gap = RoyaltiesAndOtherOperatingIncome (15.779m), outside OperatingExpenses |
| IS_OPERATING_INCOME | [SIMPSON MANUFACTURING CO., INC.](https://www.sec.gov/Archives/edgar/data/920371/000162828026012920/) | U | gap 15.437m; no single line matches. Not resolved |
| IS_OPERATING_INCOME | [STEPAN CO](https://www.sec.gov/Archives/edgar/data/94049/000119312526074976/) | U | gap 9.65m; the nearest line (an FX cash effect, 9.63m) is a coincidence, not an explanation. Not resolved |
| IS_OPERATING_INCOME | [TITAN MACHINERY INC.](https://www.sec.gov/Archives/edgar/data/1409171/000162828026022376/) | U | gap -4.032m; no single line matches. Not resolved |
| IS_OPERATING_INCOME | [LEATT CORP](https://www.sec.gov/Archives/edgar/data/1456189/000106299326001584/) | T3 | gap = ProductRoyaltyIncome (381,757), outside OperatingExpenses |
| IS_OPERATING_INCOME | [60 DEGREES PHARMACEUTICALS, INC.](https://www.sec.gov/Archives/edgar/data/1946563/000155485526000467/) | T3 | gap = RevenueNotFromContractWithCustomerOther (403,624), outside gross profit and OperatingExpenses |
| IS_OPERATING_INCOME | [MICROVAST HOLDINGS, INC.](https://www.sec.gov/Archives/edgar/data/1760689/000162828026018264/) | T3 | gap = SubsidyIncome (3.142m), outside OperatingExpenses |
| IS_OPERATING_INCOME | [SHIMMICK CORP](https://www.sec.gov/Archives/edgar/data/1887944/000119312526105064/) | U | gap 1.583m; no single line matches. Not resolved |
| IS_OPERATING_INCOME | [SHARPS TECHNOLOGY INC.](https://www.sec.gov/Archives/edgar/data/1737995/000149315226014261/) | T3 | gap = StakingRevenueNet (6,805,009), outside gross profit |
| IS_OPERATING_INCOME | [TECNOGLASS INC.](https://www.sec.gov/Archives/edgar/data/1534675/000149315226008465/) | T3 | gap = OtherOperatingIncomeLoss (5.641m), outside OperatingExpenses |
| XSTMT_CASH_ARTICULATION | [KELLY SERVICES INC](https://www.sec.gov/Archives/edgar/data/55135/000005513526000053/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [XEROX HOLDINGS CORP](https://www.sec.gov/Archives/edgar/data/1770450/000177045026000009/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [KRONOS WORLDWIDE INC](https://www.sec.gov/Archives/edgar/data/1257640/000110465926025219/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [BUTTERFLY NETWORK, INC.](https://www.sec.gov/Archives/edgar/data/1804176/000180417626000009/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [SOTERA HEALTH CO](https://www.sec.gov/Archives/edgar/data/1822479/000182247926000015/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [BAUSCH HEALTH COMPANIES INC.](https://www.sec.gov/Archives/edgar/data/885590/000088559026000023/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [BAXTER INTERNATIONAL INC](https://www.sec.gov/Archives/edgar/data/10456/000162828026007733/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [SS INNOVATIONS INTERNATIONAL, INC.](https://www.sec.gov/Archives/edgar/data/1676163/000121390026025440/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [QUANTERIX CORP](https://www.sec.gov/Archives/edgar/data/1503274/000150327426000013/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
| XSTMT_CASH_ARTICULATION | [POSTAL REALTY TRUST, INC.](https://www.sec.gov/Archives/edgar/data/1759774/000162828026011212/) | T4 | restricted cash: the cash-flow total includes restricted cash, the balance-sheet tag excludes it (ASU 2016-18); the frozen map pairs them, so the gap is structural/our pa |
