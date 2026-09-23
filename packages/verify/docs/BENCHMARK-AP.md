# A short function, zero wrong payments: deterministic checks on a public AP benchmark

*Riposte benchmark note · 2026-09-23 · everything here re-runs from the files it cites*

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
checks, and **abstains** — hands the invoice to a person — whenever it cannot read something unambiguously. It never guesses.

## How we kept ourselves honest
- **Pre-registered** metrics and reporting rules before any run (`bench/ap/PREREG.md`).
- Developed against **three examples only** (the README's two and one test case), then **frozen** — sha256
  `d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51` — before touching the other 97.
- The **first run is the headline**, reported as-is. Anything fixed after seeing it is a separate, labelled run.

## Result 1 — the blind run
| | decided | **wrong decisions** | right decision | right on all six fields | abstained |
|---|---|---|---|---|---|
| deterministic checker (blind, frozen) | 82 / 100 | **0** | 82 / 100 | 82 / 100 | 18 |

Every decided invoice was exactly right, including the failing item and both disagreeing values. The 18 abstentions were two
wordings it had never seen — totals written as "Amount payable: USD 4,013.95. Terms net 30." and POs saying "Freight: may be added
by the vendor." It declined rather than guess — including declining to read the "30" in "net 30" as the total.

After adding those two wording rules (**tuned on the test set — disclosed, not the headline**): 100 / 100 decided, 0 wrong.

For reference, from Distil's README (not re-run by us): Jev 0.79 on the decision and it cannot produce the six-field answer;
their fine-tuned Qwen3.5-4B 0.98 / 0.97 (its errors: "slips in the running sum"); hosted reasoning models 0.96–1.00.

## Result 2 — the audit: every published AI decision, gated by the blind checker
Distil also published each model's per-invoice decisions. We gated them with the blind checker: **an invoice is paid
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

**111 wrong decisions across seven published configurations — 57 of them approvals of an invoice that should have been held
(nine of Jev's at 0.99 confidence). The blind checker caught all 111. Zero wrong payments went through automatically in any
configuration; 63–82% of invoices still needed no human.**

## Result 3 — stress: messier invoices than the benchmark
We perturbed every invoice in meaning-preserving ways — shuffled lines, reworded items, reformatted numbers ("$1 555.63"),
OCR-style letter noise, table and prose layouts, and all at once. The checker was hardened against separate stress seeds, then
validated on **five brand-new random seeds it had never seen: 0 wrong decisions in 3,000 perturbed invoices.**

| perturbation (holdout, 5 seeds × 100) | decided automatically | wrong |
|---|---|---|
| shuffled line order · reworded items · table/prose layouts | 100% | 0 |
| number formatting | 81–85% | 0 |
| OCR letter noise | 87–96% | 0 |
| everything at once | 74–85% | 0 |

When it can't read something unambiguously, it hands the invoice to a person instead of guessing — which is why coverage drops
on the messiest inputs while the error count doesn't move.

## What this does and doesn't show
- **Shows:** the arithmetic and matching in accounts payable don't need a model. The part that needs judgment is *reading
  unfamiliar layouts* — and a deterministic checker can say exactly which invoices those are instead of guessing. That is the
  "hybrid" Distil's own FAQ proposes ("a model extracts the numbers, code checks them"), built and measured.
- **Doesn't show:** real-world performance. These invoices are synthetic and templated; real ones would raise the abstention
  rate. Abstaining is the safe way to fail — a person looks — but it has a cost, and we'll publish it on real documents next.
- **Doesn't claim:** beating the best hosted models on accuracy. The claim is zero wrong auto-payments with a replayable proof
  of every decision, at no model cost.

## Re-run it
From the repository root, after `npm install && npm run build` (details: [`bench/ap/README.md`](../../../bench/ap/README.md)):
- Blind run + scoring: `npx tsx bench/ap/bench.ts --run 1` (checker `bench/ap/threeway-v1.frozen.ts`, hash above)
- Disclosed tuned run: `npx tsx bench/ap/bench.ts --run 2`
- Audit: `npx tsx bench/ap/audit.ts`
- Stress: `npx tsx bench/ap/stress.ts --seed holdout1` … `holdout5`
- Production pack (with the disclosed wording rules): `packages/verify/src/ap/` · CLI `riposte-verify ap` · MCP `verify_invoice_match`
- Data: `distil-labs/invoice-processing-pipeline` (Apache-2.0) — `data/invoice_cases.jsonl`, `benchmarking/results/decider/*.jsonl`
