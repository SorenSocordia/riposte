# SEC-CHECK addendum: v0.2, validated on the held-out quarter. PRE-REGISTRATION

**Frozen 2026-09-24 ~10:10, before v0.2 is written and before 2025q1 is downloaded.** The freeze is this file's sha256,
recorded in RESULTS-V02.md. v0.2 is **designed from the 2026q1 audit, i.e. tuned on 2026q1, and disclosed as such**. Its
only honest test is the held-out quarter 2025q1. The blind v0.1 result (RESULTS.md) stays the headline for v0.1.

## What v0.2 changes (and only this)
1. **Rounding-aware tolerance.** Per check and filing, the reporting unit U is the largest of {1, 1,000, 100,000, 1,000,000}
   that divides every operand. Tolerance = max(0.0003 × the largest |operand|, U × the number of operands).
2. **Exception-aware identities.** Optional terms count only when the filer reports them; otherwise they are 0.
   - `A = L + E_total + TEMP`: E_total is StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest, else
     StockholdersEquity + MinorityInterest. TEMP is the reported temporary-equity / redeemable-NCI items.
   - `NetChange = CFO + CFI + CFF + FX + DiscOps cash`.
   - `NetIncome = Pretax − Tax + EquityMethodIncome + DiscOps` (ProfitLoss), paired consistently.
   - CI is paired consistently: including NCI with ProfitLoss, or attributable to the parent with NetIncomeLoss and OCI to
     the parent.
3. **Abstain guards** (a check ABSTAINs rather than guessing when):
   - Operating income: any "other operating" line is reported (a fixed tag list, written in the ruleset).
   - Gross profit: an amortisation-in-cost-of-revenue line is reported, or the two revenue tags disagree.
   - Cash articulation: restricted-cash components are not all reported. Otherwise compare restricted-inclusive with
     restricted-inclusive.
   - Ending cash: the beginning-cash date is not 350–380 days before the period end.
4. Nothing else. Same population rule, same tag map, same data source.

## Test
- **Data:** SEC FSDS **2025q1**, downloaded once after this freeze, with its sha256 recorded. Every 10-K.
- **Run v0.1 AND v0.2** on 2025q1 and report both flag-rate tables.
- **Audit:** the same procedure as the blind run:
  - a seeded sample of up to 10 v0.2 FAILs per check, `random.Random(20250101)`;
  - the same taxonomy (T1–T4 plus U; rounding counts as T3);
  - the same automated operationalisation first, then hand labels with written reasons.
- **Primary: v0.2 audited precision, with U counted as a false alarm.**

## Pass bar (decided now)
- **PASS:**
  - v0.2 conservative precision **≥ 50%** over all audited flags;
  - v0.2 keeps **≥ 80%** of v0.1's PASS decisions on BS_LIAB_AND_EQUITY_TOTAL, IS_GROSS_PROFIT and CF_ENDING_CASH (coverage
    must not collapse into abstention).
- **FAIL:** either bar missed. v0.2 is then published as an improvement with its measured precision, not as "fixed".
- **Prediction:** most v0.2 FAILs are T2 filer tagging errors; flag rates on the three structural-heavy checks
  (BS_ACCOUNTING_EQUATION, CF_NET_CHANGE, XSTMT) fall by more than 80%.

---

## AMENDMENT A1: 2026-09-24 ~10:15 local, before 2025q1 was downloaded (no held-out file exists on this machine)

The text above had sha256 `777bfc2803993340f0e4a722ea9dd94b451c8896b7cb51e843c01067bb5d3550` when frozen. The v0.2 build
(logs/agent-outputs/sec-v02-build-2026-09-24-1015.md §7) raised four open points. Decisions:

1. **The "+ DiscOps cash" term in `NetChange` is dropped: a definitional error in the addendum.** The frozen tag map's
   CFO / CFI / CFF are `NetCashProvidedByUsedIn{Operating,Investing,Financing}Activities`. Their official definitions
   (FSDS 2026q1 tag.txt, us-gaap/2024–2026) say "including discontinued operations". Adding
   `NetCashProvidedByUsedInDiscontinuedOperations` or its components counts them twice. v0.2's check is now
   `NetChange = CFO + CFI + CFF + FX?`.
   **Disclosed:** this decision was made after the 2026q1 tuning run had shown the term's cost (55 of 81 FAILs would
   hold without it). It is a tuning-set decision, like all of v0.2. Its justification is the element definitions,
   quoted above.
2. **"Paired consistently" for net income: the builder's reading is accepted.** Equity-method income is added only to
   the pretax element whose definition excludes it. The literal "always add it" reading double-counts, the same kind
   of error as item 1.
3. **Restricted cash: the literal reading stays.** Cash articulation abstains unless a restricted-cash component is
   reported. This costs XSTMT coverage (it is not one of the three coverage-bar checks), and the cost is reported.
4. **Standard us-gaap tags only, no filer-specific tags: kept,** so 2026q1 filers' custom tags do not leak into the test.
   **Disclosed:** 2025q1 holds largely the same filers' prior-year 10-Ks, and all of v0.2 is shaped by 2026q1 filers'
   patterns. So the held-out test is out-of-quarter, not out-of-population. RESULTS-V02 states this in its first
   paragraph.

The pass bar is unchanged.

## LOG (append-only)

- **Clock correction.** The header's "~10:10" was an estimate. The file system has this addendum's original text
  saved at 09:32 local, which is still before v0.2 was written and before any 2025q1 download. A1's "~10:15" was
  also an estimate: A1 was saved before the 10:13 code freeze below.
- **10:13 local. v0.2 code freeze, after A1; 2025q1 not yet downloaded.** The verify suite passes 1,347/1,347
  and tsc is clean. sha256 (first 16):
  - `0c6a45d1c3f0e811` products/verify/src/declarative/expr.ts
  - `669441c8980e24bc` products/verify/src/declarative/types.ts
  - `5928eeb22a402583` products/verify/src/declarative/evaluate.ts
  - `b0aec8eb1be687ac` products/verify/src/declarative/lint.ts
  - `6c683b4afe01adcf` products/verify/docs/examples/financial-statement.ruleset.v0.2.json
  - `a91f2f36ff4279f3` products/verify/docs/examples/financial-statement.ruleset.json
  - `64a2cbb9b9901f42` workspace/receipts-spike/sec-check/sec-run-v02.mts
- **10:14 local. 2025q1 downloaded (after the code freeze above):** https://www.sec.gov/files/dera/data/financial-statement-data-sets/2025q1.zip, sha256 `4386e7057cc216b6fc729d8f957998acb831d29be7b16f6d8ed0f6b1ab74eba5`.
- **10:50 local. VERDICT: FAIL** (precision 12.5% … 18.8%, the bar is 50%; the coverage bar was met at 100/96/100%). The audit agent's report is logs/agent-outputs/sec-v02-heldout-audit-2026-09-24-1020.md. The lead re-derived the seeded sample and recounted the classes; both matched. RESULTS-V02.md sha256 `00dc985dcdc448ea…`.
- **10:55 local.** RESULTS-V02.md was edited for publication: one internal file path in its source list was replaced with a description, and no number changed. New sha256 `182e935261319025…`.
