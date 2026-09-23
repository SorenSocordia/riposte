# AP benchmark harness

This directory reproduces every number in [`packages/verify/docs/BENCHMARK-AP.md`](../../packages/verify/docs/BENCHMARK-AP.md),
starting from Distil Labs' public accounts-payable benchmark (Apache-2.0; see `data/distil/LICENSE`).

Run everything from the repository root after `npm install && npm run build`.

## 1. The blind run: the headline

```bash
npx tsx bench/ap/bench.ts --run 1 --out /tmp/run-1.jsonl
sha256sum bench/ap/threeway-v1.frozen.ts     # d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51
cmp /tmp/run-1.jsonl bench/ap/results/run-1.jsonl && echo identical
```

- The metrics, the reporting rules and the development set (three examples) were fixed before any run. They are recorded in
  [`PREREG.md`](PREREG.md).
- `threeway-v1.frozen.ts` is the checker exactly as it was frozen, byte for byte. The prereg calls it `threeway.ts` because
  that was its name at freeze time. Every row of `results/run-1.jsonl` carries its sha256.
- Result: 82 of 100 decided, **0 wrong**, and every decided case right on all six fields. 18 abstained.

## 2. The disclosed tuned run

```bash
npx tsx bench/ap/bench.ts --run 2 --out /tmp/run-2.jsonl
```

`threeway.ts` adds the two wording rules found in run 1's abstentions ("Amount payable: …" totals, and "Freight: may be added
by the vendor"). It scores 100/100 with 0 wrong, **but it was tuned on the test set**. It is a ceiling, not the headline.

## 3. The audit: every published model decision, gated by the blind checker

```bash
npx tsx bench/ap/audit.ts
```

This reads Distil's own per-invoice decisions (`data/distil/results/decider__*.jsonl`) and `results/run-1.jsonl`. No model is
called. The gate: pay automatically only when the model and the blind checker agree; otherwise a person decides. Result: 111
wrong decisions across the 7 configurations, all 111 caught, and **0 wrong automatic payments**.

## 4. Stress: messier invoices than the benchmark

```bash
npx tsx bench/ap/stress.ts --seed holdout1      # … holdout5; each writes results/stress-<perturbation>-holdout<N>.jsonl
```

Each run perturbs only the invoice text, in ways that keep its meaning, then calls the production AP pack
(`verifyInvoiceMatch` in `riposte-verify`) unmodified. The perturbations:
- shuffled line order
- reworded item names
- number formatting
- OCR-style letter noise
- table and prose layouts
- all of these at once

Gold labels don't change, because number *values* are never touched. Every row carries the perturbed invoice text.

- The parser was hardened against other seeds first. The five `holdout` seeds were then run once, after hardening, and those
  are the published results: **0 wrong in 3,000 perturbed invoices**, with 74–100% decided automatically depending on the
  perturbation.
- Known limitation: the generator finds item lines using the pack's own `parseInvoice` on the *unperturbed* text. Gold
  labels are independent of the parser, but which lines get perturbed is not.

## Files

| | |
|---|---|
| `PREREG.md` | pre-registration, frozen before run 1 |
| `threeway-v1.frozen.ts` | the blind checker (sha256 `d1ad333f…`) |
| `threeway.ts` | the disclosed test-set-tuned checker (run 2) |
| `bench.ts` · `audit.ts` · `stress.ts` | the harness |
| `results/` | per-case outputs for runs 1 and 2 and the holdout stress seeds |
| `data/distil/` | Distil Labs' cases and published decider outputs, with their licence |
