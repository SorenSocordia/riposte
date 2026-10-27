# SEC studies: the misses, as transcribed

The misses the three SEC studies report in their results files (sha256 in `REPORTS.sha256`).

| miss | kind | description |
|---|---|---|
| check-v01-precision | field-miss | SEC-CHECK v0.1, blind, 2026q1: eleven footing identities run on every 10-K flagged 4,284 FAILs; of 86 audited, 1 was a correct flag (a filer tagging error) and none a genuine inconsistency, a precision of 1% to 17% with the 14 unresolved counted both ways. On filed statements the identities are a low-precision tagging-error detector (bench/sec/RESULTS.md) |
| check-v01-prediction | prediction | SEC-CHECK v0.1: the preregistered expectation that BS_LIAB_AND_EQUITY_TOTAL would fail mostly as filer tagging errors was wrong: its single FAIL of 4,118 decided was presentation rounding, and the balance sheet balances in every filing (bench/sec/RESULTS.md) |
| check-v01-taxonomy | method | SEC-CHECK v0.1: presentation rounding was not in the preregistered audit taxonomy; the audit counted it as a structural exception, a false alarm, which is the conservative direction (bench/sec/RESULTS.md) |
| check-v02-precision | hypothesis not met | SEC-CHECK v0.2, held-out 2025q1: precision 12.5% to 18.8% on 80 audited of 419 FAILs, against the preregistered bar of at least 50%: FAIL. The coverage bar was met. v0.2 was designed from the v0.1 audit (bench/sec/RESULTS-V02.md) |
| mine-enter | hypothesis not met | SEC-MINE, ENTER cohort (1,599 filers): the learned public-float cut was $874.7M against the statute's $700M: FAIL. 37 filers above $700M are not labelled large accelerated filers, 2.4% of the approvals, more than the preregistered 2% tolerance allowed (bench/sec/RESULTS-MINE.md) |
| mine-stay | hypothesis not met | SEC-MINE, STAY cohort (1,403 filers): the learned cut was $556.5M against the statute's $560M: MISSES, 0.6% off. The preregistered test asked whether the gap between two adjacent observations contains the statutory value, and one filer still labelled large accelerated at $557.0M moved that gap off $560M (bench/sec/RESULTS-MINE.md) |
