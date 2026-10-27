# A short function, 0 wrong of 82 decided: deterministic checks on a public AP benchmark

*Riposte benchmark note · 2026-09-23, restated 2026-10-05 · everything here re-runs from the files it cites*

**The headline, stated in full:** on a synthetic, templated 100-case benchmark, 0 wrong of 82 decided (Wilson 95% upper
bound ≈ 4.5%) at 82% coverage. It is not a bench table: its prereg's sha256 was never recorded, so [BENCH.md](BENCH.md)
lists it under "Rows outside the bench rule", with its archived provenance.

## The claim we tested
Distil Labs published an accounts-payable benchmark (Apache-2.0): 100 invoices that arrive as **free-text emails**, each with its
ERP purchase order and goods receipt, a gold pay/hold decision, and a gold "what's wrong and where." Their policy is four checks,
in order: the PO number matches; no line bills more than was received; no unit price is more than 2% over the PO; the total adds
up (freight only if the PO allows it). Their README concludes:

> "Invoices arrive as email text in the vendor's own style: abbreviated or reworded item names, lines in a different order than
> the PO, stray amounts such as a previous balance. That is why this is a job for a model and not for a short function."

We tested the short function.

## What we built
A deterministic checker — about 250 lines, no model, no training, no GPU, no network. It reads the email, matches invoice lines
to PO lines (abbreviation-aware: "GREASE CART 14OZ" ↔ "Machine grease cartridge 14 oz"; spec numbers must agree), runs the four
checks, and **abstains** — hands the invoice to a person — whenever it cannot read something unambiguously. It is built to
abstain rather than guess. Where it did guess, in the stress study's development rounds, a fix made it abstain (Result 3).
Those five wrong decisions are rows in [MISSES.md](MISSES.md), table `ap-stress-development`.

## How we kept ourselves honest, and where that falls short
- **Read this before the prereg's first line.** [`bench/ap/PREREG.md`](../../../bench/ap/PREREG.md) opens "frozen
  2026-09-23 ~08:55, before any run". That time is our own estimate, typed into the file. 08:55 local is 12:55 UTC, about six
  minutes after run 1's results were written (12:49:17 UTC), so the header's own time does not support "before any run".
  The file times say the prereg was created at 12:47:22 UTC and last written half a second before run 1's results
  ([`bench/ap-blind/PROVENANCE.md`](bench/ap-blind/PROVENANCE.md), "The order of events those times give"). No sha256 of the prereg was recorded,
  so nothing outside our own machine shows which text existed before the run. For the tier this means: the run is not a
  bench table, it is not preregistered in any checkable sense, and its numbers sit under "Rows outside the bench rule" as
  "transcribed; provenance archived; prereg unhashed". The frozen file stays as it is; this paragraph and a note beside it
  ([`bench/ap/PREREG.NOTE.md`](../../../bench/ap/PREREG.NOTE.md)) carry the correction.
- **Metrics and reporting rules were written down before the run** (`bench/ap/PREREG.md`). That file's sha256 was not
  recorded anywhere before the run. Our own bench tool therefore refuses to count this run as a bench table, and we do
  not call it pre-registered. The provenance that does exist is archived, with its own sha256: file creation and write
  times, and dated log lines ([`bench/ap-blind/PROVENANCE.md`](bench/ap-blind/PROVENANCE.md)). All of it comes from our own machine. By those file
  times, the prereg was last written half a second before run 1's results.
- By the authors' record, the checker was developed against three examples (the README's two and one test case), then
  frozen. A reader cannot verify this. The benchmark data was on disk about 13 minutes before the prereg was created, and
  the prereg says the label distribution and the gold field schema were seen
  ([`bench/ap/PREREG.md`](../../../bench/ap/PREREG.md), lines 14-17).
- The checker's sha256, `d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51`, was recorded before the run:
  in the prereg's FREEZE line and on every result row. The FREEZE line calls the checker `threeway.ts`, its name then. The
  frozen checker ships as `bench/ap/threeway-v1.frozen.ts` and hashes to `d1ad333f…`. By the authors' file times it was
  written to disk 38 seconds after run 1's results, as a copy of the checker that produced them: the sha256 on every run-1
  row is what ties the two. The `bench/ap/threeway.ts` in the tree is the tuned run-2 checker (sha256 `6c334ee6…`), not
  the frozen one.
- The **first run is the headline**, reported as-is. Anything fixed after seeing it is a separate, labelled run.
- **Labels:** right and wrong are Distil's own gold answers. Nobody here labelled a case.

## Result 1: run 1, blind by our own records only
"Blind" here rests on our own file times, archived in [`bench/ap-blind/PROVENANCE.md`](bench/ap-blind/PROVENANCE.md)
("The order of events those times give"): the benchmark data was on disk at 12:33:54 UTC, the prereg was created at
12:47:22, run 1's results were written at 12:49:17, and the frozen checker file was written at 12:49:55, after the
results. The only record that the checker was frozen before the run is the FREEZE line inside a prereg whose sha256 was
never recorded. No third party saw any of it.

| | decided | **wrong decisions** | right decision | right on all six fields | abstained |
|---|---|---|---|---|---|
| deterministic checker (frozen; blind by our own records only) | 82 / 100 | **0** | 82 / 100 | 82 / 100 | 18 |

Wilson 95% intervals, the method the bench tables use:
- wrong among decided: 0 of 82, 0.0% to 4.5%;
- coverage: 82 of 100 decided, 73.3% to 88.3%;
- should-pay invoices sent to a person: 13 of 32, 25.5% to 57.7%. That is the delay cost on good bills. The other 5
  abstentions were invoices that should have been held on the total.

Every decided invoice was exactly right, including the failing item and both disagreeing values. The 18 abstentions were two
wordings it had never seen — totals written as "Amount payable: USD 4,013.95. Terms net 30." and POs saying "Freight: may be added
by the vendor." It declined rather than guess — including declining to read the "30" in "net 30" as the total.

After adding those two wording rules (**tuned on the test set — disclosed, not the headline**): 100 / 100 decided, 0 wrong.

For reference, from Distil's README (not re-run by us): Jev 0.79 on the decision and it cannot produce the six-field answer;
their fine-tuned Qwen3.5-4B 0.98 / 0.97 (its errors: "slips in the running sum"); hosted reasoning models 0.96–1.00.

## Result 2 — the audit: every published AI decision, gated by the frozen checker
Distil also published each model's per-invoice decisions. We gated them with the frozen checker: **an invoice is paid
automatically only if the model and the checker agree; otherwise a person looks.** No model was called by us.

| AI configuration (Distil's published runs) | wrong decisions | wrong **approvals** (bad invoice paid) | caught | wrong auto-payments | auto-paid |
|---|---|---|---|---|---|
| Jev — single question | 23 | 11 | 23 / 23 | **0** | 63 |
| Jev — one question per check | 25 | 12 | 25 / 25 | **0** | 63 |
| Jev — one question per line & check | 16 | 15 | 16 / 16 | **0** | 71 |
| Gemini 3.5 Flash Lite | 24 | 8 | 24 / 24 | **0** | 63 |
| GPT-5.6 Luna | 19 | 9 | 19 / 19 | **0** | 67 |
| GLM-5.3 (high) | 4 | 2 | 4 / 4 | **0** | 78 |
| GPT-5.6 Luna (high reasoning) | 0 | 0 | — | **0** | 82 |

There were 111 wrong decisions across seven published configurations. 57 of them approved an invoice that should have been
held. Every one went to a person, in two ways:
- **87** because the checker decided and disagreed with the model;
- **24** only because the checker abstained on that invoice, so it would have gone to a person whatever the model said.

**This is a consequence of Result 1, not separate evidence.** A checker that made no wrong decision cannot auto-execute a
wrong one by agreeing with it. No wrong decision would have been auto-executed in any configuration: 0 wrong of 487
auto-executed decisions, with a Wilson 95% upper bound of 0.8%. The seven configurations share the same 100 invoices, so those are not
independent trials. 63–82% of invoices needed no person.

**Confidence.** Only the single-question Jev configuration states a confidence on its rows. `audit.ts` counts it two ways:
- 9 of its 23 wrong decisions carried a confidence of at least 0.90; 3 carried at least 0.99;
- of its 11 wrong approvals, 3 carried a confidence of at least 0.99, and 4 an approve probability of at least 0.99.

An earlier version of this note said "nine of Jev's at 0.99 confidence". That mixed the 0.90 count with the 0.99 threshold.

## Result 3 — stress: correlated variants of the same 100 invoices
We perturbed every invoice in meaning-preserving ways: shuffled lines, reworded items, reformatted numbers ("$1 555.63"),
OCR-style letter noise, table and prose layouts, and all at once. What this is and is not:
- **These are 30 correlated perturbations of the same 100 cases, by the parser's authors, not unseen data.** We wrote the
  generator, including its synonym table, and the production pack under test carries the two wording rules tuned on these
  100 invoices.
- **The parser was hardened first on four development seeds**, `default`, `fresh1`, `fresh2` and `fresh3`. They produced
  five wrong decisions, all false holds: two on the default seed, then one on each fresh seed, all three the same case. Two
  fixes followed, both making the parser abstain instead of guessing. The five fixed seeds, named
  `holdout1` to `holdout5`, are new random draws of the same generator, run after both fixes. We called them holdout
  seeds until the third amendment below: the AP pack's vendor check was then changed with these seeds' results in view,
  so they no longer meet the definition of a holdout. They are fixed seeds, and the file names keep the old word. The record of the
  development rounds, and the stress protocol written before them, are in [`bench/ap-blind/PROVENANCE.md`](bench/ap-blind/PROVENANCE.md).
  The five wrong decisions are rows in [MISSES.md](MISSES.md), table `ap-stress-development`. Re-run on engine 0.6.0 on
  2026-10-05, all four development seeds give 0 wrong.
- **Fixed-seed result:** 0 wrong of 2,755 decided (of 3,000 perturbed invoices). The Wilson 95% upper bound is 0.14%, but it
  assumes independent trials, which these variants are not, and the seeds are not a holdout (see above).
- **Re-banked eleven times** under a pack that kept changing after the seeds first ran: four times on 2026-10-05 (the first
  amendment; then the second amendment, which made the harness send an empty payment history, and two digest-only re-banks
  at 18:55Z and 19:25Z), at 00:18Z on 2026-10-06, after a cold review found that the banked files no longer reproduced on
  the released tree, at 06:07Z that day, digest only, at 08:35Z that day, digest only, after a comment-only edit, and at 11:45Z that day,
  digest only, after the AP pack gained its payment-redirection, sender-domain and tax checks; then three times on 2026-10-13,
  under engine 0.7.0, then digest only, then for the engine 0.7.1 label only (the seventh to ninth amendments). The first
  2026-10-13 re-bank followed corrections to the AP pack's readings made after a first run on these seeds moved 120 decisions
  (5 of them wrong), so it too was reached with these seeds' results in view. No banked decision and no count moved (the
  first six amendments are below; all nine are in the record linked at the end of this section). The
  generator that ran also differs from the written stress protocol in three ways (P2, P4, P5), listed in the provenance
  archive.

| perturbation (fixed seeds, 5 seeds × 100) | decided automatically | wrong |
|---|---|---|
| shuffled line order · reworded items · table/prose layouts | 100% | 0 |
| number formatting | 81–85% | 0 |
| OCR letter noise | 87–96% | 0 |
| everything at once | 74–85% | 0 |

When it can't read something unambiguously, it hands the invoice to a person instead of guessing — which is why coverage drops
on the messiest inputs while the error count doesn't move.

**Re-banked under engine 0.6.0, by six explained amendments (2026-10-05 and 2026-10-06).** The shipped stress files were first
written on 2026-09-23. Since then the production pack gained a fifth check, duplicate detection, and under engine 0.6.0 a bill
sent with no payment history is held for a person. So a fresh run no longer matched the shipped files byte for byte.
- **First amendment.** The files were re-run as they stood. No decision moved; each row gained a reason saying the duplicate
  check did not run.
- **Second amendment.** The benchmark's invoices have no payment history by construction, so the harness now sends an empty
  one (`history: []`): known, and empty. The duplicate check runs and finds nothing to compare. Re-running all five holdout
  seeds again changed no decision and no perturbed invoice in any of the 3,000 rows: still 0 wrong of 2,755 decided. The 841
  approved rows now read "all checks passed; the payment history supplied is empty, so the duplicate check had no booked
  invoice to compare", and the other 2,159 drop the no-history line.

- **Third amendment (2026-10-06, 00:18Z).** In cold review round 4 a methods reviewer ran a holdout seed on the released
  tree and got six files that differed from the shipped ones: the AP pack had changed (eleven source files, where the last
  re-bank had nine) and nobody had re-banked. The seeds were re-banked under the pack this tree builds (thirteen files). No
  decision moved: still 0 wrong of 2,755 decided. The reasons of the 417 rows held on the total and the 539 held on price
  changed wording. During that round a trial run had moved 13 decisions to a person, because OCR-style noise turned "From:"
  into "Frmo:" and the new vendor check found no sender; the pack was then changed to allow one swapped pair of letters
  there, so "no decision moved" was reached with these seeds' results in view.
- **Fourth amendment (2026-10-06, 06:07Z).** The pack gained two files (fifteen in all): a request to change payment details
  goes to the controller, and a PO line's quantity already invoiced is netted when the input carries it. Re-run, nothing
  moved but the digest: no decision, no reason, no other field. The seeds were run on that pack before the re-bank, and one
  vendor-check threshold was set after five of the 100 base invoices were flagged, so this too is reproduction, not
  independent evidence.
- **Fifth amendment (2026-10-06, 08:35Z).** Comments in the pack's files were rewritten (comment hygiene, no behaviour).
  The digest moved, because it is over the files' bytes; nothing else did: no decision, no reason, no other field, and a
  fresh run is identical, 30 of 30.
- **Sixth amendment (2026-10-06, 11:45Z).** The pack changed in behaviour: payment redirection on every channel a
  controller has seen, free-mail and look-alike sender domains, tax to the cent, and a resubmission settled by the netted
  quantities. Re-run after the last change to the pack and to the shared engine code it calls, nothing moved but the
  digest: no decision, no reason, no other field, and a fresh run is identical, 30 of 30. The seeds were not built to
  contain the cases the new checks catch, so this shows the rows reproduce, not that the checks work.

The re-banked rows also carry the engine version, the ruleset, and `checker_sha256`, a sha256 over the AP pack's source files.
`bench check` now reads every banked row and fails when its `checker_sha256`, engine or ruleset is not what the tree builds,
so a later change that is not re-banked is caught. The record, with every file's sha256 before and after, is
[`bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md`](bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md).
`stress.ts` never writes into `results/` unless asked to re-bank, and it compares every fresh file with the shipped one.

## What this does and doesn't show
- **Shows, on this benchmark:** on 100 synthetic, templated invoices from one source, the arithmetic and matching in accounts
  payable needed no model. The part that needs judgment is *reading unfamiliar layouts*, and the checker said exactly which
  invoices those were instead of guessing. That is the "hybrid" Distil's own FAQ proposes ("a model extracts the numbers, code
  checks them"), built and measured here.
- **Doesn't show:** real-world performance. These invoices are synthetic and templated; real ones would raise the abstention
  rate. Abstaining is the safe way to fail — a person looks — but it has a cost, and we'll publish it on real documents next.
- **Doesn't claim:** beating the best hosted models on accuracy. The claim is 0 wrong of 82 decided on these 100 invoices.
  On these 100 invoices, a gate built on the frozen checker auto-executed no wrong decision (Result 2), with a replayable
  proof of every decision, at no model cost. It is not a claim about a gate on other invoices, and it does not measure the
  shipped `ap` command, which carries the two wording rules tuned on this set.

## Re-run it
From the repository root, after `npm install --legacy-peer-deps && npm run build` (details: [`bench/ap/README.md`](../../../bench/ap/README.md)):
- Blind run + scoring: `npx tsx bench/ap/bench.ts --run 1` (checker `bench/ap/threeway-v1.frozen.ts`, hash above)
- Disclosed tuned run: `npx tsx bench/ap/bench.ts --run 2`
- Audit: `npx tsx bench/ap/audit.ts`
- Stress: `npx tsx bench/ap/stress.ts --seed holdout1` … `holdout5`
- Production pack (with the disclosed wording rules): `packages/verify/src/ap/` · CLI `riposte-verify ap` · MCP `verify_invoice_match`
- Data: `distil-labs/invoice-processing-pipeline` (Apache-2.0) — `data/invoice_cases.jsonl`, `benchmarking/results/decider/*.jsonl`
