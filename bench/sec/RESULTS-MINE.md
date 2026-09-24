# SEC-MINE results: can the miner rediscover the SEC's large-accelerated-filer thresholds from real filings?

**Pre-registered verdicts: ENTER FAIL, STAY MISSES.** Both are reported as the frozen text defines them. The miner
picked the right field both times. On the exit side, its learned constant is within 0.6% of the statutory $560M. On the
entry side, its constant was pushed up to $875M: 37 real-world exceptions sat above $700M, and the pre-registered
tolerance allowed only 30. Everything from "Why ENTER failed" onward is exploratory (after the verdict was recorded).

- Pre-registration: `PREREG-SEC-MINE.md`. The original sha256 is `bb91776d…`. Amendment A1 (before any data) is sha256
  `b7e60239…`. The append-only log records the code freeze (09:46), the data fetches, and the verdict **before** any
  exploratory analysis.
- Script: `sec-mine.mts`. Output: `sec-mine-results.json` and the case tables `sec-mine-cases-{ENTER,STAY}.jsonl` (one row
  per filer with its EDGAR link).
- Engine: `verify mine --thresholds` (the C family, `src/mine/threshold.ts`). It was built and unit-tested before any
  float data was fetched.

## Data (all public, from sec.gov)

| input | source | sha256 |
|---|---|---|
| FY2025 filer status (labels) | FSDS 2026q1 `sub.txt` (`afs`) | `dc5b5849…` |
| FY2025 revenue (distractor) | FSDS 2026q1 `num.txt` | `8dbbdcf1…` |
| FY2024 filer status (prior-year split) | FSDS 2025q1 `sub.txt`, zip `4386e705…` | `99b34664…` |
| public float at 2025-06-30 | frames API `dei/EntityPublicFloat/USD/CY2025Q2I` (4,287 rows) | `2ee33f34…` |

**Population:**
- 4,074 calendar-year FY2025 10-Ks.
- 3,002 kept.
- Excluded:
  - 333 float of zero;
  - 284 no float in the frame;
  - 256 no FY2024 10-K;
  - 199 float date ≠ 2025-06-30.
- 2,734 of the 3,002 kept rows (91%) have a float accession equal to the 10-K itself.

## Results (mechanical, as frozen)

| cohort | n | LAF | first candle | learned c | data-supported interval | statutory | verdict |
|---|---|---|---|---|---|---|---|
| ENTER (prior year not LAF) | 1,599 | 85 | `float <= c` | **$874.7M** | [$868.3M, $881.1M) | $700M | **FAIL** (interval misses it) |
| STAY (prior year LAF) | 1,403 | 1,349 | `float <= c` | **$556.5M** | [$555.9M, $557.0M) | $560M | **MISSES** (literal test; −0.6%) |

- **Distractor (revenue):**
  - ENTER: no revenue candle (both directions BASE_RATE).
  - STAY: the only revenue candidate that grounded was REDUNDANT, adding 1 new hold.
  - The float field was chosen first in both cohorts, as the pass bar requires.
- **Grounding:** ENTER float candle p = 1.8e-64 (59 of 85 LAF explained, 29 approved violators). STAY float candle
  p = 2.0e-85 (1,340 of 1,349 explained, 1 approved violator). These p-values are conditional on a cut chosen from the
  same labels (disclosed in `threshold.ts`), so they are optimistic.

## Why STAY "missed" (exploratory)

The exit rule is sharp in the data:
- 63 former LAFs report a float below $560M, and 53 of them dropped to ACC or NON.
- 10 still carry a LAF label:
  - 3 look like float-tagging scale errors: Monarch Casino $1.2M, PTC Therapeutics $3.4M, Ares Management $326.7M;
  - 7 are near-misses or special entities: MidCap Financial $170.0M, US Natural Gas Fund $360.5M, Shutterstock
    $453.5M, Core Laboratories $498.9M, iShares S&P GSCI Trust $549.4M, Tootsie Roll $550.1M, and Bausch + Lomb $557.0M.
- Above the learned cut, all but one of the 1,341 filers stayed LAF. The one is Repay Holdings: a $399.7 **billion**
  float, which is itself a scale error.

The learned cut falls between Xencor ($555.9M, ACC) and Bausch + Lomb ($557.0M, still LAF). No approved filer lies
between $557.0M and $560M, so the learner can count Bausch + Lomb as correctly caught at no cost. **The learned rule and
the statute disagree on exactly one filer.** The pre-registered test used the gap between the two nearest observations.
That gap is only $1.05M wide, so one self-reported label just under the line moved the interval off $560M.
**Lesson for the next pre-registration:** judge "the learned rule and the statutory rule disagree on at most k filers",
not "the interval contains the constant".

## Why ENTER failed (exploratory)

Label mix by float in ENTER:
- Below $700M: 1 LAF out of 1,478 filers.
- $700M–$1B: 32 LAF, 9 not.
- Above $1B: 52 LAF, 28 not.

At the statutory cut, **37 non-LAF filers sit above $700M**, 2.4% of the 1,514 approvals. The frozen tolerance was 2%,
which allows 30. The $700M cut was therefore **infeasible under the pre-registered consistency limit**, and the learner
was forced up to the lowest cut with ≤ 30 exceptions ($874.7M). The tolerance, fixed before the data, was too tight for
the real exception rate.

The 37 exceptions are real. 12b-2's LAF definition has a fourth condition. From the text, read 2026-09-24 at
law.cornell.edu/cfr/text/17/240.12b-2:
- "(iv) The issuer is not eligible to use the requirements for smaller reporting companies under the revenue test".
- The SRC revenue test counts "annual revenues … as of the most recently completed fiscal year for which audited
  financial statements are available", i.e. **FY2024** at the June 2025 determination.

Adding that condition, approximated as FY2024 revenue < $100M ⇒ not LAF (script `sec-mine-explore.mts`), cuts the
statute's disagreements from 38 to 27. What remains:
- **Filer float-tagging errors**, e.g. Crawford & Co. reporting a $239.8 **billion** float, Civista Bancshares
  $351 billion, Forrester $114 billion, Lion Copper & Gold $45 billion, LandBridge **$1.7 million** as LAF;
- **special entities** (Federal Home Loan Bank, crypto and commodity ETF trusts, a non-traded REIT);
- **pre-revenue companies whose FY2024 revenue isn't tagged** `Revenues`/`RevenueFromContract…` (likely under $100M, so
  likely also condition (iv)).

So the single-field grammar found the right field, and the constant was dragged by a second, conjunctive rule that it
cannot express. That rule is written in the regulation, and the miner's misfit points straight at it.

## What this does and doesn't show

- **Shows:**
  - From labels and numbers alone, the miner picks the statutory field in both cohorts.
  - It rejects a correlated distractor.
  - It recovers the exit threshold to within 0.6%.
  - Its residuals are the filings a human should look at: tagging errors, special entities and a real second rule.
- **Doesn't show:** that the single-constant grammar recovers the entry threshold. It did not.
- **Next (a new pre-registration on a fresh year, never this data):**
  - a conjunctive family, `float >= c1 AND prior-year revenue >= c2`;
  - a judge that counts disagreements rather than interval containment;
  - tested on FY2024 labels (FSDS 2025q1 10-Ks), FY2023 revenue, and the `CY2024Q2I` float frame.
