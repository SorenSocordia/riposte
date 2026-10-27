# Pre-registration: the live gate over Distil's published decisions

Frozen 2026-10-03, before `pair.ts` gated any published model decision through the library's checker. Its sha256 is recorded in
the run log. Anything changed after that is a new, labelled run.

## What is already published, and stays as published

The audit table in `packages/verify/docs/BENCHMARK-AP.md` (Result 2) gated Distil's seven published configurations with the
BLIND, frozen checker (sha256 `d1ad333f…`, recorded in `bench/ap/results/run-1.jsonl`): 111 wrong decisions, 111 caught, 0 wrong
auto-payments. `pair.ts` reprints that table from the recorded run and checks it against the document byte for byte. No number
in it is recomputed or changed.

## What this run adds, and why it is labelled

`pair.ts` also gates every published decision through the library itself (`apGate` from `riposte-ai`, the checker
`ap-threeway@0.2.0`), the way an integrator would, and writes a receipt for each. That checker is NOT blind on this set:
- it carries the two wording rules added after the blind run, tuned on these 100 invoices (the disclosed run 2: 100/100, 0 wrong);
- verify's regression test (`packages/verify/test/ap.test.ts`) has it deciding all 100 invoices exactly as the gold label.

So these numbers show how the gate behaves when the checker is right. They are not an accuracy result, must never be compared
with the blind 82/100, and are printed under that label.

## Predictions (fixed before the run)

Wrong and correct counts are Distil's, from their published files (wrong decisions 23, 25, 16, 24, 19, 4, 0 in the order of
the published table).

1. **Primary.** Zero wrong auto-executions in each of the seven configurations.
2. Every wrong decision goes to a person: caught equals wrong in every configuration (111 in all).
3. Auto-executed equals the number of correct decisions: 77, 75, 84, 76, 81, 96, 100, in the published table's order.
   Nothing goes to a person because the checker abstained.
4. Gating through the structured path (`--path structured`, each invoice converted from the text parser's own reading) gives
   the same matrix as the text path.
5. Flip stability: not measured for any configuration. Distil published one answer per invoice, under one option order, and
   the probe needs at least two orders. The column says so.

## What counts as a miss

Any prediction that does not hold is reported as observed, next to its prediction, with the invoices involved. A wrong
auto-execution would be the headline of this run, not a footnote.
