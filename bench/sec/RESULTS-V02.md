# SEC-CHECK v0.2: RESULTS on the held-out quarter (2025q1)

**Verdict: FAIL.** v0.2 met the coverage bar but missed the precision bar. On the held-out quarter it cut flag
volume by 90% while keeping 96–100% of v0.1's PASS decisions. Still, only **12.5%** of its audited flags (18.8% if every
unresolved flag is counted as correct) are errors in the filed data; the bar was 50%. **Across both audits, 166
flags, it found no genuine accounting inconsistency (T1).** Every correct flag was a filer tagging error (T2).

**Read this first: what "held-out" means here.** v0.2 was designed from the audit of 2026q1 (tuned, and disclosed as
such). 2025q1 holds largely the same companies' prior-year 10-Ks. So this test is out-of-quarter, not
out-of-population: 11 of the 80 audited rows are filers that also appeared in the 2026q1 audit sample.

- Pre-registration: `ADDENDUM-V02.md`. Original sha256 `777bfc28…`. Amendment A1 dropped a discontinued-ops cash term,
  which double counts per the us-gaap element definitions. The log records the code freeze (10:13 local) before the
  2025q1 download (10:14 local).
- Data: SEC Financial Statement Data Sets **2025q1** (zip sha256 `4386e705…`),
  <https://www.sec.gov/files/dera/data/financial-statement-data-sets/2025q1.zip>.
- Ruleset: `financial-statement-core@0.2.0`. The v0.2 code and ruleset are frozen; their hashes are in the addendum log.
- Re-run: `sec-run-v02.mts 2025q1`, `audit_sample_v02.py` (seed 20250101), `audit-v02.mts`, `audit-assist-v02.mts`,
  `manual-labels-2025q1-v02.json`, `audit_final_v02.py`.
- The audit was done by a separate agent, with every deviation listed in
  its audit report, kept with the lab notes. The lead re-derived the seeded sample and recounted
  the classes independently; both matched.

## 1. Flag rates, every 10-K in 2025q1 (v0.1 → v0.2)

| check | v0.1 FAIL | v0.1 flag rate | v0.2 FAIL | v0.2 flag rate |
|---|---|---|---|---|
| BS_ACCOUNTING_EQUATION | 1080 | 31.83% | 111 | 3.11% |
| BS_LIAB_AND_EQUITY_TOTAL | 0 | 0.00% | 0 | 0.00% |
| BS_ASSET_SPLIT | 4 | 1.63% | 2 | 0.82% |
| BS_LIABILITY_SPLIT | 1 | 0.33% | 0 | 0.00% |
| IS_GROSS_PROFIT | 13 | 1.17% | 8 | 0.75% |
| IS_OPERATING_INCOME | 19 | 2.55% | 14 | 2.00% |
| IS_NET_INCOME | 380 | 13.10% | 71 | 2.45% |
| IS_COMPREHENSIVE_INCOME | 60 | 4.68% | 50 | 2.49% |
| CF_NET_CHANGE | 1368 | 45.34% | 25 | 0.83% |
| CF_ENDING_CASH | 58 | 2.27% | 43 | 1.69% |
| XSTMT_CASH_ARTICULATION | 1290 | 49.27% | 95 | 8.85% |
| **total FAILs** | **4,273** | | **419** | |

**Coverage bar:** v0.2 must keep at least 80% of v0.1's PASS decisions on the three named checks. **Met.**
- BS_LIAB_AND_EQUITY_TOTAL: 100%.
- IS_GROSS_PROFIT: 96.0% of the same filings.
- CF_ENDING_CASH: 100%.

**Caveat on the flag-rate cuts:** the XSTMT drop is mostly abstention. Only about 4% of v0.1's XSTMT PASSes are still
PASS, because the check now requires a reported restricted-cash component (A1 item 3).

## 2. Precision audit (seeded sample: up to 10 v0.2 FAILs per check, `random.Random(20250101)`)

| check | audited | T1 | T2 | T3 | T4 | U | precision (U false … U correct) |
|---|---|---|---|---|---|---|---|
| BS_ACCOUNTING_EQUATION | 10 | 0 | 2 | 8 | 0 | 0 | 20% … 20% |
| BS_ASSET_SPLIT | 2 | 0 | 2 | 0 | 0 | 0 | 100% … 100% |
| CF_ENDING_CASH | 10 | 0 | 0 | 9 | 1 | 0 | 0% … 0% |
| CF_NET_CHANGE | 10 | 0 | 1 | 9 | 0 | 0 | 10% … 10% |
| IS_COMPREHENSIVE_INCOME | 10 | 0 | 1 | 1 | 3 | 5 | 10% … 60% |
| IS_GROSS_PROFIT | 8 | 0 | 0 | 6 | 2 | 0 | 0% … 0% |
| IS_NET_INCOME | 10 | 0 | 2 | 5 | 3 | 0 | 20% … 20% |
| IS_OPERATING_INCOME | 10 | 0 | 0 | 10 | 0 | 0 | 0% … 0% |
| XSTMT_CASH_ARTICULATION | 10 | 0 | 2 | 8 | 0 | 0 | 20% … 20% |
| **all** | **80** | **0** | **10** | **56** | **9** | **5** | **12.5% … 18.8%** |

**Robustness:**
- No alternative reading the auditor computed exceeds 21.5%.
- Six of the T2 labels have no precedent in the blind audit. They include one amount tagged with two mutually
  exclusive elements (Summit, Claritev, Cipher). If all six were ruled false alarms, precision would fall to
  5.0% … 11.2%.
- The FAIL does not depend on any single judgment call.
- Every audited row, with its class, reason and EDGAR link, is in `audit-final-2025q1-v02.jsonl` and the audit report.

**Predictions:**
- "Most v0.2 FAILs are T2": **wrong**. Structural exceptions (T3) are 56 of 80.
- "Flag rates on the three structural-heavy checks fall by more than 80%": **confirmed**. The falls were −90.2%, −98.2%
  and −82.0%.

## 3. What it means

1. **The filed statements are almost always arithmetically consistent.** In 166 audited flags across two quarters and
   two ruleset versions there is **no genuine accounting inconsistency**. The correct flags are tagging errors: a
   subtotal on the wrong element, one amount under two exclusive elements, tax including discontinued operations. So on
   this evidence, a footing check on *filed* XBRL is a low-precision tagging-error detector, not an accounting-error
   detector.
2. **What's left after v0.2 is mostly legitimate presentation.** Cash in disposal groups and discontinued operations
   (7 of the 10 CF_ENDING_CASH flags), preferred-dividend presentation of comprehensive income, and filer-specific
   operating lines. v0.2 handles none of these, by design: its tag lists are standard-only (A1 item 4).
3. **For the product:**
   - The honest claim for financial statements is **abstain-heavy consistency checking, whose FAILs mean "look here",
     not "this is wrong"**.
   - The precise use of these identities is checking an AI's *extraction* of a statement against the statement's own
     arithmetic. There the extraction introduces the errors and the source is the ground truth.
   - That is a different test, with known ground truth, and it is the next pre-registration on this track. Filed-data
     precision is not.
4. **Published as a field result.** v0.1's blind miss and v0.2's held-out miss both go out with the numbers above.
