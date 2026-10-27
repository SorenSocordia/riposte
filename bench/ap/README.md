# AP benchmark harness

This directory reproduces every number in [`packages/verify/docs/BENCHMARK-AP.md`](../../packages/verify/docs/BENCHMARK-AP.md),
starting from Distil Labs' public accounts-payable benchmark (Apache-2.0; see `data/distil/LICENSE`).

Run everything from the repository root after `npm install --legacy-peer-deps && npm run build` (plain `npm install`
works under npm 11.6.2 and fails under npm 10.9.x).

**Before you read `PREREG.md`.** Its first line says "frozen 2026-09-23 ~08:55, before any run". That time is the authors'
estimate, typed into the file: 08:55 local is 12:55 UTC, about six minutes after run 1's results were written (12:49:17 UTC).
By the file times the prereg was last written half a second before run 1, but its sha256 was never recorded, so nothing
outside the authors' machine shows which text existed first. The run is therefore not preregistered in any checkable sense
and is not a bench table. The frozen file is left as it is; [`PREREG.NOTE.md`](PREREG.NOTE.md) beside it says this in full.

## 1. The headline run (run 1 of the frozen check)

```bash
npx tsx bench/ap/bench.ts --run 1
sha256sum bench/ap/threeway-v1.frozen.ts     # d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51
```

The first command writes to a new folder under `bench/ap/reruns/`, never over the shipped results, and ends with "compare:
IDENTICAL to the shipped results/run-1.jsonl (byte for byte)". `--out <file>` writes elsewhere; a path inside `results/` is
refused. The second command prints the frozen checker's sha256.

- The order of events (the data, the prereg, the run, the frozen file) rests on the authors' file times, set out in
  [`PROVENANCE.md`](../../packages/verify/docs/bench/ap-blind/PROVENANCE.md).
- The metrics, the reporting rules and the development set (three examples) are recorded in [`PREREG.md`](PREREG.md). By
  the authors' record they were fixed before any run. The prereg's sha256 was not recorded before the run, so the bench
  tool does not count the run as preregistered; the provenance that does exist is archived in
  [`PROVENANCE.md`](../../packages/verify/docs/bench/ap-blind/PROVENANCE.md).
- `threeway-v1.frozen.ts` is the checker exactly as it was frozen, byte for byte (sha256 `d1ad333f…`). The prereg's FREEZE
  line (`PREREG.md`, line 39) calls it `threeway.ts`, its name at freeze time. The `threeway.ts` in this folder is the
  tuned run-2 checker (sha256 `6c334ee6…`), not the frozen one.
- By the authors' file times, `threeway-v1.frozen.ts` was written to disk 38 seconds after run 1's results (12:49:55
  against 12:49:17.658 UTC), as a copy of the checker that had produced them. Every row of `results/run-1.jsonl` carries
  the checker's sha256, and that hash is what ties the frozen file to the run.
- Result: 82 of 100 decided, **0 wrong**, and every decided case right on all six fields. 18 went to a person.

## 2. The disclosed tuned run

```bash
npx tsx bench/ap/bench.ts --run 2
```

Like run 1, it writes to a new folder under `bench/ap/reruns/` and compares with the shipped `results/run-2.jsonl`.

`threeway.ts` adds the two wording rules found in run 1's abstentions ("Amount payable: …" totals, and "Freight: may be added
by the vendor"). It scores 100/100 with 0 wrong, **but it was tuned on the test set**. It is a ceiling, not the headline.

## 3. The audit: every published model decision, gated by the frozen checker

```bash
npx tsx bench/ap/audit.ts
```

This reads Distil's own per-invoice decisions (`data/distil/results/decider__*.jsonl`) and `results/run-1.jsonl`. No model is
called. The gate: pay automatically only when the model and the frozen checker agree; otherwise a person decides. Result: 111
wrong decisions across the 7 configurations, all 111 caught, and **0 wrong automatic payments**.

## 4. Stress: messier invoices than the benchmark

```bash
npx tsx bench/ap/stress.ts --seed holdout1      # … holdout5
```

Each seed writes its six files to a new folder under `bench/ap/reruns/`, never into `results/`, and compares each file
byte for byte with the shipped `results/stress-<perturbation>-holdout<N>.jsonl`. Only `--bank` writes into `results/`, to
re-bank on purpose.

Each run perturbs only the invoice text, in ways that keep its meaning, then calls the production AP pack
(`verifyInvoiceMatch` in `riposte-verify`) unmodified. The perturbations:
- shuffled line order
- reworded item names
- number formatting
- OCR-style letter noise
- table and prose layouts
- all of these at once

Gold labels don't change, because number *values* are never touched. Every row carries the perturbed invoice text.

- The parser was hardened first on four development seeds, `default`, `fresh1`, `fresh2` and `fresh3`. They gave five
  wrong decisions, all false holds, and the two fixes both make the parser send the bill to a person instead of guessing. The five are rows
  in [`MISSES.md`](../../packages/verify/docs/MISSES.md) (table `ap-stress-development`); the development rounds are
  recorded in the provenance archive, and no diff of the fixes ships. Re-run on engine 0.6.0, the four development seeds
  give 0 wrong. The five fixed seeds (files named `holdout1` to `holdout5`) were then run once, after hardening, and those are the published results: **0 wrong of 2,755 decided** (of 3,000 perturbed invoices), with 74–100% decided automatically
  depending on the perturbation. They are correlated variants of the same 100 cases, not unseen data. They were re-banked
  eight times as the AP pack changed, one time with the harness sending an empty payment history (`history: []`: the
  invoices have none by construction), four times on 2026-10-06: once after a cold review found the banked files no
  longer reproduced, once more, digest only, when the pack gained its payment-details and billed-to-date checks, again,
  digest only, after a comment-only edit to the pack's files, and again, digest only, when the pack gained its
  payment-redirection, sender-domain and tax checks. No decision
  moved, and `bench check` now fails when the rows and the pack disagree. The re-bank after the cold review followed a
  change to the vendor check made with these seeds' results in view, so the seeds are no longer a holdout: they are fixed
  seeds, and the file names keep the old word
  (`packages/verify/docs/bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md`, third to sixth amendments).
- Known limitation: the generator finds item lines using the pack's own `parseInvoice` on the *unperturbed* text. Gold
  labels are independent of the parser, but which lines get perturbed is not.

## Files

| | |
|---|---|
| `PREREG.md` | pre-registration, by the authors' file times last written before run 1; its sha256 was not recorded, and its header's own time ("~08:55") falls after run 1 (read `PREREG.NOTE.md` first) |
| `PREREG.NOTE.md` | the correction to the prereg's header, beside the frozen file |
| `threeway-v1.frozen.ts` | the frozen checker of run 1 (sha256 `d1ad333f…`), called `threeway.ts` in the prereg's FREEZE line |
| `threeway.ts` | the disclosed test-set-tuned checker of run 2 (sha256 `6c334ee6…`), not the frozen one |
| `bench.ts` · `audit.ts` · `stress.ts` | the harness |
| `results/` | per-case outputs for runs 1 and 2 and the five fixed stress seeds (files named `holdout1` to `holdout5`) |
| `data/distil/` | Distil Labs' cases and published decider outputs, with their licence |
