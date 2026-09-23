# AP three-way-match bench on Distil Labs' public benchmark — PRE-REGISTRATION (frozen 2026-09-23 ~08:55, before any run)

**Data:** `distil-labs/invoice-processing-pipeline` (Apache-2.0, pushed 2026-09-22), `data/invoice_cases.jsonl` — 100 free-text
invoice emails with their ERP purchase order + goods receipt, gold decision (approve / hold_no_po / hold_quantity / hold_price /
hold_total) and gold six-field grounding. Local copy: `data/distil/` [path updated for this repository].

**Their claim under test (README, "The policy at step 2"):** "Invoices arrive as email text in the vendor's own style:
abbreviated or reworded item names, lines in a different order than the PO, stray amounts such as a previous balance. That is
why this is a job for a model and not for a short function."

**Our system:** a deterministic function — no model, no training, no GPU — that parses the email, matches lines, runs the four
policy checks in order, and ABSTAINS (routes to a human) whenever parsing or line matching is ambiguous. It never guesses.

## What the parser was developed against (disclosed)
Only: the README's two documented examples (NM-84665, HW-80031 — these MAY also be test cases) and case T001 (seen while
inspecting the file format). No other case's text or answer is examined before the frozen run. The label *distribution*
(32 approve / 14 hold_no_po / 19 hold_quantity / 19 hold_price / 16 hold_total) and the gold field *schema* were seen.

## Metrics (all over the FULL 100; abstentions are NOT counted correct)
- **2a decision accuracy** = correct decisions / 100.
- **2b six-field accuracy** = all six fields right / 100 (decision, invoice_number, po_number, item, invoiced, expected;
  numbers compared at 0.005, strings exact).
- **coverage** = decided (non-abstain) / 100.
- **wrong decisions** = decided AND wrong. THE number that matters: an AP gate that is wrong is worse than one that abstains.
- **selective accuracy** = correct / decided.

## Baselines (quoted from their README, not re-run)
Jev 0.79 on 2a (average of three prompt styles; best style 0.84); cannot produce 2b. Fine-tuned Qwen3.5-4B 0.98 (2a) / 0.97 (2b).
Hosted reasoning models 0.96–1.00 ("Those models score 96 to 100 here"). Untuned Qwen3.5-4B 0.41 / 0.12.

## Reporting rules
- The FIRST run of the frozen checker is the headline run, reported as-is, errors included.
- Any fix made after seeing run-1 results is a disclosed run 2 ("tuned on the test set"), never presented as the headline.
- We will NOT claim to "beat" hosted reasoning models; the honest comparison is: zero-model, zero-cost, deterministic,
  exact failing field, and wrong-decision count vs the fine-tuned model's 2–3 arithmetic slips.
- If run 1 has more wrong decisions than the fine-tuned 4B's (2 on 2a), say so plainly.

## FREEZE
threeway.ts frozen at sha256 `d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51` (2026-09-23, before run 1). Dev check passed on the 3 allowed examples only.
