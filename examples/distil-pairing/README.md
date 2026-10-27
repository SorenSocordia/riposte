# Distil pairing: a model decides, code checks, only agreement executes

Distil Labs published an accounts-payable benchmark: 100 invoices that arrive as free-text emails, each with its purchase order
and goods receipt, plus every model decision from seven AI configurations. The FAQ in their repository describes the design
this example runs:

> "A hybrid (a model extracts the numbers, code checks them) is a reasonable design"

> "Route `hold_total` decisions and invoices above a threshold to a person, or recompute the sum in code from the model's own
> reasoning lines."

(Distil Labs, `invoice-processing-pipeline`, README FAQ, Apache-2.0.)

This example takes a model's pay or hold decision for each invoice and gates it through Riposte's deterministic three-way
match. No model is called.

| the model says | the check says | what happens |
|---|---|---|
| pay | approve | executes: pay |
| hold (any reason, or the same reason) | the same hold | executes: hold |
| anything | something else | a person decides |
| anything | can't tell (abstains) | a person decides |

## Run it

From the repository root, after `npm install --legacy-peer-deps && npm run build`:

```sh
npx tsx examples/distil-pairing/pair.ts --check
npx tsx examples/distil-pairing/pair.ts --check --now 2026-10-03T00:00:00Z --out pairing-out --sign
npx tsx examples/distil-pairing/pair.ts --decisions examples/distil-pairing/decisions/format-example.json
```

`--check` compares the published table with `packages/verify/docs/BENCHMARK-AP.md`, byte for byte, and exits 1 if they differ.
`--now` fixes the clock, so verdict ids and receipt hashes repeat run to run. `--out` writes each configuration's receipt
ledger. `--sign` signs every receipt with a key made for that run. `--help` lists the rest.

## What it prints

### 1. The published table

This is the audit table from `BENCHMARK-AP.md` (Result 2). It comes from the blind, frozen checker's recorded run
(`bench/ap/results/run-1.jsonl`, checker sha256 `d1ad333f…`) set against each published decision. No other checker recomputes
it, and no number in it is new.

```
| AI configuration (Distil's published runs) | wrong decisions | wrong **approvals** (bad invoice paid) | caught | wrong auto-payments | auto-paid |
|---|---|---|---|---|---|
| Jev — single question | 23 | 11 | 23 / 23 | **0** | 63 |
| Jev — one question per check | 25 | 12 | 25 / 25 | **0** | 63 |
| Jev — one question per line & check | 16 | 15 | 16 / 16 | **0** | 71 |
| Gemini 3.5 Flash Lite | 24 | 8 | 24 / 24 | **0** | 63 |
| GPT-5.6 Luna | 19 | 9 | 19 / 19 | **0** | 67 |
| GLM-5.3 (high) | 4 | 2 | 4 / 4 | **0** | 78 |
| GPT-5.6 Luna (high reasoning) | 0 | 0 | — | **0** | 82 |

check: these lines are BENCHMARK-AP.md's Result 2 table, byte for byte (9 lines)
```

The column the benchmark note calls "auto-paid" counts the invoices that needed no person: those paid and those held
automatically.

### 2. The live gate

Next, every published decision goes through the library itself (`apGate` from `riposte-ai`), the way an integrator would call
it. Each one gets a receipt.

**This part is not blind.** The library's checker (`ap-threeway@0.2.0`) carries the two wording rules that were added after the
blind run, tuned on these same 100 invoices: the disclosed run 2, 100 of 100 decided, 0 wrong. These numbers show how the gate
behaves when its checker is right. They are not an accuracy result. Its predictions were frozen before the first run, in
[PREREG.md](PREREG.md).

```
| configuration | gated | executed: pay | executed: hold | to a person: check disagrees | to a person: check abstains | to a person: flips | wrong decisions | caught | wrong auto-executions | flip stability |
|---|---|---|---|---|---|---|---|---|---|---|
| Jev — single question | 100 | 22 | 55 | 23 | 0 | 0 | 23 | 23 / 23 | **0** | not measured: 1 order published |
| Jev — one question per check | 100 | 26 | 49 | 25 | 0 | 0 | 25 | 25 / 25 | **0** | n/a: yes/no questions, no option order |
| Jev — one question per line & check | 100 | 32 | 52 | 16 | 0 | 0 | 16 | 16 / 16 | **0** | n/a: yes/no questions, no option order |
| Gemini 3.5 Flash Lite | 100 | 21 | 55 | 24 | 0 | 0 | 24 | 24 / 24 | **0** | n/a: labels only, no typed answer |
| GPT-5.6 Luna | 100 | 23 | 58 | 19 | 0 | 0 | 19 | 19 / 19 | **0** | n/a: labels only, no typed answer |
| GLM-5.3 (high) | 100 | 30 | 66 | 4 | 0 | 0 | 4 | 4 / 4 | **0** | n/a: labels only, no typed answer |
| GPT-5.6 Luna (high reasoning) | 100 | 32 | 68 | 0 | 0 | 0 | 0 | — | **0** | n/a: labels only, no typed answer |

receipts (hashes only: no invoice text; one per gated decision, in memory; unsigned):
  jev-single             100 entries · chain verified · signed 0 · head 6ecc844f8297e9e7…
  ...
  the first three of jev-single:
    #0 T001 EXECUTE HOLD model=hold_quantity check=hold_quantity verdict=402cf106511890018d2d86b830ff5888 hash=3b99e459395ff60f…
    #1 T002 REVIEW HUMAN_REVIEW model=approve check=hold_total verdict=e62f5d9e8af1525c2f7656cfdf8b16a1 hash=eaa5141ed9fe21a8…
    #2 T003 EXECUTE PAY model=approve check=approve verdict=f319866ce0521a9fe94da53f68467a1b hash=ac1f6051fab7a35f…

structured path (each invoice converted from the text parser's own reading, ruleset ap-structured@0.1.0): the same action, effect and checker decision on all 700 gated decisions

pre-registered predictions (PREREG.md), on the 7 published configurations:
  1. zero wrong auto-executions in each: held (0, 0, 0, 0, 0, 0, 0)
  2. every wrong decision to a person: held (caught 111 of 111)
  3. executed = correct decisions, none abstained: held (77/77, 75/75, 84/84, 76/76, 81/81, 96/96, 100/100)
  4. the structured path gives the same matrix: held
  5. flip stability not measured: held (...)
```

The excerpt above was run with `--now 2026-10-03T00:00:00Z`.

- **Receipts.** Each receipt holds hashes, rule ids, outcomes, offsets and remedy kinds, never invoice text. One entry per
  decision goes on a hash-chained ledger, and the chain is verified at the end. Each also names its configuration and
  benchmark case.
- **The structured path.** The same decisions are also gated through structured input (`packages/verify/docs/AP-INPUT.md`). Each
  invoice is converted from the text parser's own reading, and every gated decision is compared. Pass `--path text` to skip
  this.

## Your own decider

Pass `--decisions <file>`, once per configuration. A file is JSON:

```json
{
  "configuration": "my-model-v3",
  "decisions": [
    { "id": "T001", "decision": "hold_quantity", "confidence": 0.92 },
    { "id": "T002", "action": "pay" },
    { "id": "T003", "action": "hold", "reason": "hold_price" }
  ]
}
```

- `id` is the benchmark case id.
- `decision` is one of `approve`, `hold_no_po`, `hold_quantity`, `hold_price`, `hold_total`, `hold_line_math`,
  `hold_duplicate`, or a bare `hold`. A bare hold agrees with any hold the check finds.
- Instead of `decision`, a file may give `action` (`pay` or `hold`) with an optional `reason`.

A Distil decider `.jsonl` file is read as published. `decisions/format-example.json` shows the format on three invoices.
Those three decisions were written by hand and are not any model's output.

## The flip probe

A typed decision that changes when only the order of its options changes is a decision about the prompt's layout, not about
the invoice. The probe (`flipProbe` in `riposte-ai`) asks the same choice question with the options reordered and reports
whether the decision moves. With a probe result, the gate sends an unstable decision to a person even when the check agrees
("to a person: flips").

Distil published one answer per invoice under one option order, and the probe needs at least two. So the column says
"not measured" for Jev's single-question run. Jev's other two runs ask yes/no questions, which have no option order. The other
models' files hold labels only.

To measure stability, record your decider's answers under the probe's six orders and pass them as `--flip-recorded <file>`.
Each line of the file is one answer:

```json
{"configuration": "jev-single", "id": "T001", "order": ["approve","hold_no_po","hold_quantity","hold_price","hold_total"], "answer": {"type": "choice", "choice": "hold_quantity", "probabilities": {"approve": 0.01, "hold_no_po": 0, "hold_quantity": 0.99, "hold_price": 0, "hold_total": 0}}}
```

These are the six orders, the first being the identity (seed `receipts/flip/v1`):

```
["approve","hold_no_po","hold_quantity","hold_price","hold_total"]
["hold_total","hold_price","hold_quantity","hold_no_po","approve"]
["hold_quantity","approve","hold_total","hold_price","hold_no_po"]
["hold_quantity","approve","hold_no_po","hold_price","hold_total"]
["hold_price","hold_total","hold_no_po","hold_quantity","approve"]
["hold_quantity","hold_no_po","approve","hold_price","hold_total"]
```

The recorded answers are replayed offline (`recordedTransport`). An order with no recording leaves that invoice unmeasured: the
probe never fills in a missing answer.

## What this does not show

- **Real-world performance.** The invoices are synthetic and templated, and real ones would send more to a person.
- **Any accuracy number for the live gate.** Its checker was tuned on these invoices. The blind number is Result 1 of
  `BENCHMARK-AP.md`: 82 of 100 decided, 0 wrong.
- **Option-order stability for any of the published configurations.** It was not measured.
