# SEC-MINE: can the miner rediscover the SEC's filer-status threshold from real filings? PRE-REGISTRATION

**Frozen 2026-09-24 ~10:20, before any public-float data is fetched and before the miner has a threshold family.** The freeze
is this file's sha256, recorded in RESULTS-MINE.md.

## The rule to rediscover (documented, not inferred by us)
17 CFR 240.12b-2, effective April 27, 2020 (text read at law.cornell.edu; the SEC's own compliance guide agrees):
- **Large accelerated filer (LAF):** public float ≥ **$700M**, measured on the last business day of the issuer's most
  recently completed second fiscal quarter.
- Hysteresis: an LAF stays LAF until its float falls below **$560M**.
- Other conditions (12 months of reporting, at least one annual report) are sources of label noise, disclosed.

## Data (public; redistribution allowed per sec.gov terms)
- **Labels:** SEC FSDS 2026q1 `sub.txt` (already downloaded; zip sha256 `d18c01c6…`). `afs` for each 10-K is `1-LAF`,
  `2-ACC` or `4-NON`.
- **Public float:** one request to the SEC frames API for `dei:EntityPublicFloat`, USD, instant CY2025Q2 (June 30, 2025).
  The response is saved with its sha256 and matched by CIK.
- **Population:** 10-Ks with `fye = 1231` and `period = 20251231`, whose float instant is exactly June 30, 2025. A float of
  0 or a missing float is excluded and the count reported. Every row links to its filing.

## Method
- **The miner:** `verify mine` plus ONE new grammar family, **"field vs learned constant"**: `X >= c ⇒ positive`, where c is
  learned from the labels.
  - c = the smallest value such that no negative case at or above c counts, with the pre-registered exception tolerance
    below; the data-supported interval is reported.
  - The family is built and unit-tested before the data is fetched. The same judges apply (consistency with tolerance,
    exact-hypergeometric grounding, novelty).
- **Task:** positive = `1-LAF`; negative = `2-ACC` or `4-NON`. Candidate field: public float (plus revenue from NUM as a
  distractor field).
- **The hysteresis band is removed from mining:** rows with float in [$560M, $700M) are excluded, because their label depends
  on the prior year. They are reported separately (what share of them is LAF).
- **Exception tolerance** (for label noise: other conditions, late status changes): `maxApprovedViolationRate = 0.02`, fixed
  now.

## Pass bar (decided now)
- **PASS:**
  1. the miner candles a float threshold whose learned c lies within **±5% of $700M** ($665M–$735M);
  2. the candle's data-supported interval contains $700M;
  3. revenue does not produce a false candle.
- **FAIL:** no float candle, or c outside the band. Reported as-is, with the float/label scatter summary.
- **Also reported:** agreement of the learned rule with `afs` outside the band; the band's LAF share; every disagreement
  listed with its link as a candidate mislabel or a stale status.

## Honest limits
- This rediscovers ONE clean threshold. The accelerated-filer boundary ($75M, with the SRC revenue carve-out at $100M) needs
  a conjunctive rule. That is out of scope here and a later study.
- Reported float is self-reported. The labels are self-reported too.

---

## AMENDMENT A1: 2026-09-24 ~10:45. No float data fetched and no threshold code written yet. Supersedes §Population / Method / Pass bar where they conflict

The text above had sha256 `bb91776d7ee89c43bfdb9ac60061855485feccbecadeba1a963a0c609a04c0cb` when frozen. Two design
errors were found on re-reading, before any outcome data existed:

1. **Circularity.** Removing the band [$560M, $700M) uses the answer to choose the data. Once the band is gone, the
   smallest LAF float above $560M is ≥ $700M by construction. **Replacement: a split on prior-year status, with no
   knowledge of the answer.** This is how 12b-2 is actually written: one rule to enter, one to stay.
   - The prior-year status is the `afs` of the same CIK's FY2024 10-K in SEC FSDS **2025q1** `sub.txt` (form 10-K,
     fye 1231, period 20241231). If there are several, the one with the latest `accepted` wins. That zip's sha256 is recorded.
   - **ENTER:** prior `afs` ≠ `1-LAF`. Expected threshold: **$700M**.
   - **STAY:** prior `afs` = `1-LAF`. Expected threshold: **$560M**.
   - Filers with no matching FY2024 10-K are excluded and counted. This also removes first-year registrants, who cannot
     be LAF under the 12-month condition.
2. **A biased learner.** "The smallest c consistent within tolerance" spends every allowed exception on the negatives
   just below the true cut, so it is biased downward. **Replacement: the constrained minimum-error cut.**
   - Over the decidable cases, sorted by X, c minimises (missed holds + approved violators), subject to approved
     violators ≤ floor(0.02 × decidable approves).
   - Ties go to the cut with fewer approved violators.
   - The data-supported interval [lo, hi) is the range of cuts giving the same partition. The reported c is its midpoint.
   - The judges are unchanged (consistency, exact grounding, novelty).
   - Direction: HOLD = `1-LAF`; APPROVE = any other non-empty `afs`. The family proposes both `X <= c` (large X ⇒ hold)
     and `X >= c` (small X ⇒ hold) for every numeric document field.
3. **Fields:**
   - `float` = dei:EntityPublicFloat, from the frames API `CY2025Q2I` (end date exactly 2025-06-30). Matched by CIK; the
     accession match to the 10-K is reported.
   - `revenue` = the FY2025 value from FSDS 2026q1 NUM: `Revenues`, else `RevenueFromContractWithCustomerExcludingAssessedTax`;
     qtrs 4, ddate 20251231, no segments, no coreg, USD.
   - A zero or missing float excludes the row, and the count is reported. A missing revenue leaves it undecidable for revenue.

### Pass bar (replaces the one above)
- **PRIMARY (ENTER):**
  - the FIRST accepted candle, i.e. the highest coverage, is `float <= c`;
  - its interval [lo, hi) contains **$700,000,000**;
  - hi − lo ≤ **$70M** (10%: the data pins it, not just brackets it).
- **SECONDARY (STAY):** reported, not required for PASS. Same test with **$560,000,000**. Few filers sit near the
  exit cut, so a wide interval there is an honest "brackets but does not pin".
- **Distractor:** every revenue candle is reported with the holds it adds. A revenue candle accepted FIRST in ENTER is a FAIL.
- **Also reported:**
  - agreement of the learned ENTER rule with `afs`, and every disagreement with its EDGAR link (candidate mislabel /
    stale status / other condition);
  - the tolerance used, and the approved violators at c.

---

## LOG (append-only)

- **Clock correction.** The times in the headers above ("~10:20", "~10:45") were my estimates and are wrong. The file
  system has the original text written before 09:40 local, and A1 saved at 09:40:06 local (sha256 `b7e60239…`). The
  order of events is what matters, and it is unchanged: prereg → A1 → code → data.
- **09:46 local. The C family is built and unit-tested; no float data fetched yet.** Code sha256 (first 16):
  - `fcb258f2220ef8bd` src/mine/threshold.ts
  - `a6d4cb1fb44dcb78` src/mine/miner.ts
  - `efadc7c1ee9e8c3e` src/mine/grammar.ts
  - `6043feb0bd658459` test/mine-threshold.test.ts

  The full verify suite: 1,289/1,289 passing, tsc clean.
- **10:14 local. The prior-status labels come from the same 2025q1 zip** (sha256 `4386e7057cc216b6fc729d8f957998acb831d29be7b16f6d8ed0f6b1ab74eba5`). The float frame was fetched at 09:47 local: sha256 `2ee33f34fb934712cfdb4011d283877f5cab3ce0eb25e3f7831e8ec6ab0a7b2c`, 4,287 rows.
- **10:18 local. RESULT, as computed mechanically by sec-mine.mts** (script sha `cf694edc53016bb0…`, results.json sha `d8e5e3822e7172ca…`). Recorded here
  before any exploratory analysis.
  - **ENTER: FAIL.** The first candle is `float <= c`, but c = $874.7M with interval [$868.3M, $881.1M), which does
    not contain $700M. n = 1,599 (85 LAF).
  - **STAY: MISSES** (literal test). c = $556.5M with interval [$555.9M, $557.0M), which does not contain $560M
    (−0.6%). n = 1,403.
  - **Excluded:** 284 no float in the frame; 199 float end date ≠ 2025-06-30; 256 no FY2024 10-K; 333 float of zero.
