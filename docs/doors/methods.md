# Methods reviewers: what failed first, then the numbers

For reviewers weighing what the numbers on these pages can carry. Accuracy is published beside coverage, runs labelled
blind, by the authors' records, are kept apart from tuned ones, and every miss stays in a ledger. Nothing here yet measures
the shipping versions on documents the maintainers have not seen: that run is preregistered and has not begun
([below](#not-yet-measured-the-versions-that-ship-on-unseen-documents)).

## Read in this order

1. **[The misses ledger](../../packages/verify/docs/MISSES.md)**: every miss from every bench table, dated; the misses of
   two studies outside the bench rule (the AP stress development seeds, the three SEC studies); and the defects logged in
   each round of cold review, where cold readers (AI agents that had not worked on this tree) read it in a buyer's or a
   reviewer's role. A fix note saying "the front page" describes the README on that date; those passages now live here.
   [The rollup](../../packages/verify/docs/MISSES-ROLLUP.md) counts its rows by status and by kind (engine, documentation,
   message, the rest), generated from the same rows by `node scripts/misses-rollup.mjs`.
2. **[Runs the tool refused, and tables withdrawn](../../packages/verify/docs/BENCH.md#runs-the-tool-refused-and-tables-withdrawn)**:
   the runs whose numbers the bench tool will not print, and two tables withdrawn because their preregistrations cannot ship.
3. **[Outside the rule](../../packages/verify/docs/BENCH.md#outside-the-rule)**: every published number that is not a bench
   table, with the reason, including every number for the default legal rules (legal@0.4.0, legal@0.5.0, legal@0.5.1,
   legal@0.5.2 and legal@0.5.3, all post-hoc), the SEC studies, the mined rules and the AP headline below.
4. **[The bench tables](../../packages/verify/docs/BENCH.md)**: counts, interval, preregistered bar and tier on each row; a
   Stamp line and a **Reruns from this tree** line on each table.

**First command:** reproduce the AP headline run byte for byte.

```bash
npx tsx bench/ap/bench.ts --run 1
```

It writes to a new folder under `bench/ap/reruns/`, never over the shipped results, and ends with "compare: IDENTICAL to the
shipped results/run-1.jsonl (byte for byte)". `node packages/verify/dist/cli.js bench check packages/verify/docs/bench`
re-tallies every table, and exits 4 while any table reads NEEDS STAMP (`--allow-unstamped` accepts them knowingly).

## The bench rule, the tiers, and what reruns

- **The rule.** A table is printed only against a preregistration whose sha256 was recorded. The tool checks that the
  record exists, not when it was made: a record's time is the authors' own.
- **The tiers.** Blind, by the authors' records: by the authors' own hash times, fetch logs and prereg notes, the builders
  had not seen the data before the run. No third party has confirmed that for any table, and each blind table on BENCH.md
  names the record it rests on. Post-hoc: scored on data already seen. Demo: a constructed demonstration. Regression: a
  re-run showing nothing moved. Transcribed: typed from a report that left no machine-readable results.
- **A reused bar.** A row held to a bar written for another run has no verdict of its own: its verdict cell reads
  "post-hoc (no bar of its own; … reused)". The first row of `r4-peppol-posthoc`, held to the e-invoice PDF run's bar,
  reads that way; its counts are unchanged.
- **Re-tally, rerun.** Each table's folder, `packages/verify/docs/bench/<id>/`, holds its preregistration byte for byte and
  its per-case results. `bench check` counts each table again from them: a faithful count, not a reproduction. A rerun
  regenerates the results from inputs and a harness that ship. One table reruns with identical outcomes (`legal-blind-2`,
  160 of 160; verdict ids identical: 0 of 20, because today's build is engine 0.7.2, not the 0.6.0 build the run used), one partly
  (`ap-stress-development`), and the other 20 re-tally only; BENCH.md lists each with its reason, near the top. The AP
  headline run, its audit and the stress rows rerun from [`bench/ap`](../../bench/ap).
- **Hashed, not shipped; ships, edited.** A hash-listed file that cannot ship is listed with its sha256 and the reason: a
  harness naming private paths, a public data set not redistributed, an engine build, or a per-case file too large (the BPI
  Challenge 2019 table ships a summary only). A hash-listed file that ships in other bytes is listed under "Ships, edited"
  with both sha256s and the reason: three files in `legal-blind-2` and `legal-blind-2-030`, each with one or two comment
  lines rewritten because they named a private folder. The originals do not ship, so the difference cannot be checked here.
- **Append-only.** Regenerating the misses ledger refuses to drop or change a row; the only change it accepts is a note of
  what fixed it. Someone who can edit this tree can still remove a row by editing a table's folder, the table and the ledger
  together. Nothing outside the authors' control anchors the ledger yet: no signed release, and no public CI history. The
  suite runs in the maintainer's own CI on GitHub-hosted runners (Ubuntu and Windows); that history is not public yet.

## The stamps, and who labelled

- **Preregistration timing is recorded by the authors.** No table's preregistration carries a third-party timestamp made
  before its run. Their stamps were made by DigiCert's timestamp authority on 2026-10-05, each after its run: they show each
  text existed by then, not that it came first. The one stamp made before a run is on the preregistered blind run below
  (2026-10-14), which has not begun. To check one with OpenSSL, follow
  [`_tsa/README.md`](../../packages/verify/docs/bench/_tsa/README.md): pass the token's certificates as `-untrusted`.
- **The rule from 2026-10-05:** every preregistration is stamped before its run. `legal-blind-2-030` broke it (run at 17:50
  UTC, stamped 81 minutes later). `legal-blind-2` ran that day before the first stamp existed and was stamped 221 minutes
  after. Eight tables that record misses only carry a scope note in the prereg's place, written after the events, which
  reads NEEDS STAMP until stamped. The AP headline run's preregistration has no recorded hash, so the bench tool will not
  print it as a preregistered result: it sits in its own tier, "transcribed; provenance archived; prereg unhashed".
- **No person hand-labelled a case** in the AP, purchase-log, e-invoice or legal audits. The AP audit scores model decisions
  against the benchmark's own gold labels. The purchase-log, e-invoice and legal audits were done by an AI agent, the same
  one that built or ran each harness, so none is independent of it. The second SEC study's audit was done by a separate AI
  agent; the first SEC study's files do not say whether a person or an agent made its labels.

## The accounts-payable numbers

Distil Labs' benchmark (Apache-2.0): 100 synthetic, templated invoices arriving as emails, each with a purchase order and a
goods receipt; a model decides pay or hold, and a payment goes through only when the model and the frozen bench script
([`threeway-v1.frozen.ts`](../../bench/ap/threeway-v1.frozen.ts)) agree. The first two rows measure that script, not the
shipped `ap` command, which carries two wording rules tuned on these 100 invoices; the stress row runs the shipped AP pack.

| what was measured | tier | result | 95% interval (Wilson) |
|---|---|---|---|
| The frozen script on the 100 cases | transcribed; provenance archived; prereg unhashed | 0 wrong of 82 decided (82% coverage); 18 to a person, 13 of them invoices that should have been paid | wrong 0.0% to 4.5% · coverage 73.3% to 88.3% · should-pay sent to a person (13 of 32) 25.5% to 57.7% |
| Distil's 7 published model configurations gated by the script: 700 decisions | a consequence of the row above; not independent trials | all 111 wrong decisions went to a person (87 by disagreement, 24 because the script could not tell); 0 wrong of 487 auto-executed | caught 96.7% to 100.0% · by disagreement 69.8% to 85.0% · wrong auto-executions 0.0% to 0.8% |
| Stress: 30 correlated perturbations of the same 100 cases, five fixed seeds | generated by the parser's authors; not unseen data | 0 wrong of 2,755 decided; 2,755 of 3,000 decided | wrong 0.0% to 0.14%, assuming an independence these variants lack · coverage 90.8% to 92.8% |

- **Run 1 is blind by the authors' records only.** By their file times the benchmark data was on disk at 12:33:54 UTC, the
  prereg was created at 12:47:22, run 1's results were written at 12:49:17, and the frozen checker file at 12:49:55, after
  the results. The FREEZE line inside a prereg whose sha256 was never recorded is the only record that the checker was
  frozen first ([provenance](../../packages/verify/docs/bench/ap-blind/PROVENANCE.md)).
- **The stress seeds** are files named holdout1–holdout5, run after four development seeds (default, fresh1–fresh3). They
  are not a holdout: two re-banks followed changes to the AP pack made with their results in view (the vendor check on
  2026-10-06; the emailed-bill readings on 2026-10-13, after a first run on these seeds moved 120 decisions). They were re-banked
  eleven times as the AP pack and the engine changed, the last on 2026-10-13, for the engine 0.7.1 label only; no banked
  decision or count moved, and `bench check` fails when the rows and the pack disagree
  ([amendment](../../packages/verify/docs/bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md)).
  The generator differs from its written protocol in three disclosed ways ([BENCHMARK-AP.md](../../packages/verify/docs/BENCHMARK-AP.md)).
- **The one AP study on real data,** BPI Challenge 2019 (labelled blind by the authors' records), compares counts of invoice
  and goods-receipt messages per purchase-order item, not money. It agreed with the company's log on 61.7% of 209,254
  decided items (descriptive, no bar), mostly items it passed that were not held: of the 81,771 decided items the company
  held, it flagged 1,668, about 2.0% ([BENCH.md](../../packages/verify/docs/BENCH.md#three-way-match-on-a-real-purchase-log-bpi-challenge-2019)).

## Other results, including the failures

**Real SEC filings** ([`BENCHMARK-SEC.md`](../../packages/verify/docs/BENCHMARK-SEC.md), harness in [`bench/sec`](../../bench/sec)):
three studies on every 10-K in two quarters of the SEC's Financial Statement Data Sets, each published whether it passed or
not, all outside the rule. The preregistrations ship byte for byte and their hashes match; that each was written before its
data was downloaded rests on the authors' records.

| study | tier | result |
|---|---|---|
| Footing identities on filed statements (4,262 10-Ks) | blind by the authors' records, preregistered | precision **1–17%**: a field miss, published |
| Redesigned v0.2 on a held-out quarter | held-out data, preregistered; designed from the first study's audit | flag volume **−90%** with coverage kept, but precision **12.5–18.8%** against a 50% bar: **FAIL** |
| Mining the SEC's filer-status rule from labels alone (3,002 filers) | preregistered | right field every time; exit threshold within **0.6%**; entry threshold off: **FAIL** by the preregistered test |

In 166 audited flags there was no genuine accounting error: every correct flag was a number filed under the wrong XBRL
element. Who audited is stated above ("The stamps, and who labelled"): no person is recorded as having labelled them. The v0.2 audit's sample and counts were re-derived by a separate AI agent run by the same maintainers.

**Rules learned from labels** ([`BENCHMARK-MINE.md`](../../packages/verify/docs/BENCHMARK-MINE.md); outside the rule). From
the same 100 synthetic AP invoices, labelled only paid or held, the `mine` command selected all 4 of the policy's rules with
0 false rules, explaining all 68 holds; enforcing them agrees with the labels on 100 of 100 (tier: in-sample). It chose from
candidate forms, a field schema and a tolerance grid written by people who knew the policy, and the grid held the 2% answer.
Its preregistration is cited by hash, not public, and its timing rests on the authors' files.

## Not yet measured: the versions that ship, on unseen documents

A blind run of the versions that ship (engine 0.7.1, its AP pack, the default Peppol ruleset 0.3.0 and the default legal rule,
legal@0.5.3) on documents the maintainers have not seen, labelled by a person independent of the harness, is preregistered in
[`blind-shipping-1/PREREG.md`](../../packages/verify/docs/bench/blind-shipping-1/PREREG.md). It is hashed, and DigiCert's
timestamp authority signed it at 2026-10-14T01:55:28Z, before any of its data exists. The run has not begun. It pins the
engine and pilot sources by hash, so a later source change needs an amendment, hashed and stamped before any data is
touched. Until it runs, no number on these pages measures the shipped defaults on unseen documents. The same engine is also
exercised on published astrophysics and earth-science datasets as a stress test of the method (tables `sci-r0` to `sci-r3`);
those tables are not product claims.
