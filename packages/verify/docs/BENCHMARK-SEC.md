# Riposte on real SEC filings: three pre-registered studies, results as they fell

All three studies use the SEC's public **Financial Statement Data Sets** (FSDS), the XBRL facts of every 10-K, and the
SEC's XBRL frames API. Each was pre-registered before its data was downloaded. The pre-registrations, results, scripts and
audit labels are in [`bench/sec/`](../../../bench/sec/). **Two of the three missed their pre-registered bar.** They are
published anyway, with the reasons.

| study | question | verdict |
|---|---|---|
| SEC-CHECK v0.1 (blind) | Do 11 accounting identities, run on every 10-K in a quarter, flag real inconsistencies? | **Low precision (1–17%)**, published as a field miss |
| SEC-CHECK v0.2 (held-out) | Does a version redesigned from that audit reach ≥ 50% precision on a new quarter without losing coverage? | **FAIL**: precision 12.5–18.8%; coverage bar met |
| SEC-MINE | From filer-status labels alone, can the rule miner rediscover the SEC's large-accelerated-filer thresholds? | **ENTER FAIL, STAY MISSES** (exit cut within 0.6%) |

## Data

- FSDS quarters: <https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets>. The SEC's terms
  allow redistribution.
  - `2026q1.zip`, sha256 `d18c01c615da8f5cd46273b0dacaeee5b1163f4089171da0f84153a5f3c362f6`: 4,262 10-Ks. The blind
    run, and the tuning set for v0.2.
  - `2025q1.zip`, sha256 `4386e7057cc216b6fc729d8f957998acb831d29be7b16f6d8ed0f6b1ab74eba5`: the held-out quarter,
    downloaded after v0.2's code was frozen.
- Public float: <https://data.sec.gov/api/xbrl/frames/dei/EntityPublicFloat/USD/CY2025Q2I.json> (4,287 rows, sha256
  `2ee33f34fb934712cfdb4011d283877f5cab3ce0eb25e3f7831e8ec6ab0a7b2c`).
- The SEC requires a User-Agent with a contact address for automated downloads.

## 1–2. SEC-CHECK: footing identities on filed statements

**Ruleset:** [`financial-statement.ruleset.json`](examples/financial-statement.ruleset.json) (v0.1) and
[`financial-statement.ruleset.v0.2.json`](examples/financial-statement.ruleset.v0.2.json). v0.2 adds a rounding-aware
tolerance, optional terms, check alternatives and abstain guards. All are standard features of the declarative format; see
[`RULESETS.md`](RULESETS.md).

**Audit taxonomy, fixed before the data:**
- **T1:** a genuine inconsistency.
- **T2:** a filer tagging error (scale, sign or wrong element).
- **T3:** a structural exception the identity doesn't allow for.
- **T4:** our extraction error.
- **U:** unresolved.

Precision is (T1 + T2) / audited, reported with U counted both ways.

| | FAILs | audited | T1 | T2 | T3 | T4 | U | precision |
|---|---|---|---|---|---|---|---|---|
| v0.1, 2026q1 (blind) | 4,284 | 86 | 0 | 1 | 47 | 24 | 14 | 1% … 17% |
| v0.2, 2025q1 (held-out) | 419 | 80 | 0 | 10 | 56 | 9 | 5 | 12.5% … 18.8% |

- **v0.2 cut flag volume by 90%** on the held-out quarter (4,273 v0.1 FAILs → 419). It kept 100% / 96% / 100% of v0.1's
  PASS decisions on the three coverage checks. The precision bar (≥ 50%) was still missed.
- **Across 166 audited flags, no genuine accounting inconsistency was found.** Every correct flag was a tagging error: a
  subtotal on the wrong element, one amount under two mutually exclusive elements, tax that includes discontinued
  operations. What remains after v0.2 is mostly legitimate presentation: cash held in disposal groups, comprehensive
  income after preferred dividends, filer-specific operating lines.
- **What this means for use:**
  - Footing checks on *filed* XBRL are a low-precision tagging-error detector. A FAIL there means "look here", not "this
    is wrong".
  - These identities are meant for checking an AI's *extraction* of a statement against the statement's own arithmetic.
    There the source document is the ground truth, and errors come from the extraction.
  - That needs a different benchmark, with known ground truth; it is not this one.
- **Honest limits:**
  - v0.2 was designed from the v0.1 audit, i.e. tuned on 2026q1.
  - 2025q1 is out-of-quarter, not out-of-population: largely the same companies' prior-year filings.

Full results: [`bench/sec/RESULTS.md`](../../../bench/sec/RESULTS.md) (blind) and
[`bench/sec/RESULTS-V02.md`](../../../bench/sec/RESULTS-V02.md) (held-out). Every audited flag is listed with its EDGAR
link and reason.

## 3. SEC-MINE: rediscovering a filing rule from outcomes

**The rule to find:** 17 CFR 240.12b-2 (the large accelerated filer, LAF).
- A company **enters** LAF status with a public float of **$700M** or more.
- It **stays** LAF until the float falls below **$560M**.

**Setup:**
- The miner (`riposte-verify mine --thresholds`) sees 3,002 calendar-year 10-K filers: each one's reported float and
  revenue, and whether its filing says LAF. It does not see the rule.
- The filers are split by prior-year status into ENTER and STAY, because the regulation has one threshold for each.

| cohort | n | learned cut | data-supported interval | statute | verdict |
|---|---|---|---|---|---|
| ENTER | 1,599 | $874.7M | [$868.3M, $881.1M) | $700M | **FAIL** |
| STAY | 1,403 | $556.5M | [$555.9M, $557.0M) | $560M | **MISSES** (−0.6%; the rules differ on one filer) |

**What went right:**
- Both times, the miner chose public float as the first rule.
- It rejected revenue, a correlated distractor.

**What went wrong:**
- **ENTER:** 37 filers above $700M are not LAF. That is 2.4% of the approvals, more than the pre-registered 2% tolerance
  allowed, so the $700M cut was infeasible.
- **STAY:** the pre-registered test asked whether the gap between two adjacent observations contains the statutory value.
  A single filer still labelled LAF at $557.0M moved that gap off $560M.

**Exploratory, after the verdict was recorded:**
- The regulation's fourth LAF condition excludes companies eligible for smaller-reporting-company status under the revenue
  test. It explains 11 of the 38 disagreements.
- Most of the rest are filers' float-tagging scale errors (a $239.8 **billion** float for a company worth a few hundred
  million) and special entities (a Federal Home Loan Bank, crypto ETF trusts).
- The single-constant grammar found the right field. The constant was pulled off by a second, conjunctive rule that is
  written in the regulation.

**Next:** a conjunctive rule family and a disagreement-count judge, tested on a fresh year. Full results:
[`bench/sec/RESULTS-MINE.md`](../../../bench/sec/RESULTS-MINE.md).

## Re-run it

From the repository root, after `npm install && npm run build`, download the quarters into `bench/sec/data/` (see
[`bench/sec/README.md`](../../../bench/sec/README.md)), then:
- Blind run: `npx tsx bench/sec/sec-run.mts`, then `python bench/sec/audit_sample.py`, `npx tsx bench/sec/audit.mts` and
  `npx tsx bench/sec/audit-assist.mts`.
- Held-out: `npx tsx bench/sec/sec-run-v02.mts 2025q1`, then `python bench/sec/audit_sample_v02.py`,
  `npx tsx bench/sec/audit-v02.mts`, `npx tsx bench/sec/audit-assist-v02.mts` and `python bench/sec/audit_final_v02.py`.
- Mining: `npx tsx bench/sec/sec-mine.mts`, then `npx tsx bench/sec/sec-mine-explore.mts`.

The hand labels (`manual-labels*.json`) and the published outputs are in `bench/sec/results/`.
