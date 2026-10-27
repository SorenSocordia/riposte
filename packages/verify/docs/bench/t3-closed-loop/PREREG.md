# T3 closed loop: pre-registration (2026-10-03, written before any loop code)

Lane T3. Writer: an Opus 5.5 agent whose own first reply recorded `model: claude-opus-5-5` (message
`msg_011CffhFStJwnYhtWz9mqZ89`). This file is hashed into `PREREG.sha256` before the loop code is written. Anything changed
after the first corpus run is labelled post-hoc and re-run non-blind.

## 1. What is measured

A loop protocol, `riposte-loop/v1`, built in `products/receipts` (records, bundle, replay) and driven from
`products/adapters` (the driver and the stand-in agents). One **round** is one proposal from the agent and one verdict from
the gate. If the verdict does not execute the proposal, the verdict's typed remedies are rendered into the agent's next
instruction, byte for byte. The **round limit is 3**, counted in verdicts issued. Every round is recorded on a signed,
hash-chained ledger and the whole loop is replayable as one bundle.

## 2. The gate (unchanged products; read and called, never edited)

- **AP.** receipts `apGate` over verify `verifyInvoiceMatch`, ruleset as the verify dist names it (`ap-threeway`), policy
  `{ price_tolerance: 0.02, total_tolerance: 0.005 }`, the three text documents. The gate either executes (effect PAY or
  HOLD) or sends the item to review.
- **Peppol.** verify `verifyDeclarative` with `peppol-en16931` 0.2.0
  (`products/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256
  `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`), with the proposal's source text and quotes. The gate
  reads verify's `gateStatus`. It executes an `accept` only on PASS. It executes a `reject` only on FAIL. Everything else
  goes to review.
- **Engine pins.** The sha256 of the verify dist files the run loads is recorded at the start and end of each run. Drift
  during a run is reported. Another lane is editing verify today, so the pins are the record of which engine ran.

## 3. Outcomes (`loop.close`)

| outcome | when |
|---|---|
| CONVERGED-PASS | a round's gate executes the agent's pay/accept proposal |
| CONVERGED-FAIL | a round's gate executes the agent's hold/reject proposal |
| HELD-FOR-HUMAN | nothing executed within 3 rounds; or the agent declines to propose again (it has no lawful action); or its next proposal breaks the edit discipline (refused, not gated) |

`rounds_used` is the number of verdicts issued.

## 4. Edit discipline (the loop's own check, applied between rounds)

- **Scope.** A value may change from round n to round n+1 only inside the scope of round n's remedies.
  - Declarative documents: the scope is the fields bound to every operand role of every claim a remedy answers, read from
    the ruleset's check expressions, plus the remedy's own operand path.
  - AP: the scope is the document a remedy names as its operand source (`purchase_order`, `goods_receipt`, `invoice`).
  - The agent's decision may always change.
- **Provenance.**
  - Declarative: every changed or added value carries a quote that is found verbatim in that round's source text and
    reads as the value. For a number, a token in the quote parses strictly to it under either decimal convention. For a
    string, the quote contains it.
  - AP: a supplied document names where it came from (`supplied_from`: source, key, sha256), and its text hashes to that
    sha256. The bundle carries the structured-source record, so a replay re-checks the hash.
- A proposal that breaks the discipline is refused and not gated. The loop closes HELD-FOR-HUMAN, naming the field.

## 5. The stand-in agents (deterministic, no model)

**No model runs in any arm.** These are stand-ins. A model-backed corrector is a separate run with per-reply attestation:
the resolved model id per round, from the provider's per-message `model` field. **It is not run here**: no
`ANTHROPIC_API_KEY` is configured in this environment, as checked before this file was written.

Every round's `loop.proposal` row records the agent's model as follows:
- `model: null`, `evidence_tier: "none"`, plus the program id and the sha256 of its source, for deterministic rounds;
- the publisher's configuration name at evidence tier T0 (declared by Distil Labs, not attested by us), for recorded
  decisions.

### A. AP stand-in, `t3-standin-ap@1` (arm AP-L, 100 items)

**Round 1.** Decision `approve`. Documents:
- the invoice: the case text before `PURCHASE ORDER (ERP)`, per verify `splitApLayout`;
- the purchase order: from the ERP record (`erp.json`). The record is found by the one ERP key that appears verbatim in
  the invoice text; with zero or several such keys, nothing is looked up;
- the goods receipt: absent (empty).

**On a returned instruction, the first rule that applies:**
1. A remedy names, as its operand source, a document absent from the proposal, and the ERP record has it: supply that
   document only, recording `supplied_from`. The decision is unchanged.
2. The verdict FAILs, i.e. the checker decides a hold: concede with decision `hold`.
3. Otherwise decline: no new proposal.

**Never:** switch toward `approve`, apply a transform (`cap-at-received` needs the payer's policy, which is not granted
here), or act on an authority remedy.

### B. AP hybrid, recorded decision then stand-in (arm AP-R, 7 configurations × 100)

- **Round 1** is a published configuration's recorded decision (`results/decider__*.jsonl`, Apache-2.0), with all three
  documents from `splitApLayout`.
- **Rounds 2 and later** use rules 2 and 3 of agent A. Rule 1 cannot fire, because every document is present.
- **This arm is not "the same agent" in every round.** Round 1 is a recorded model output and later rounds are the
  stand-in. The per-round model field records exactly that.

### C. Peppol stand-in, `t3-standin-peppol@1` (arm PE-S, 60 items)

**Round 1.** Decision `accept`. The proposal:
- the extraction: X1's frozen blind extraction (`einvoice-pdf/out/run1/extract/<id>.extraction.json`, produced before
  this prereg by `lib/extract.mjs`, sha256 `470fb728…`);
- the source: its text (`.txt`);
- the quotes: its raw strings (`.quotes.json`).

**On a returned instruction:**
1. **Targets.** For every `missing-operand` or `recompute-with` remedy whose operand source is `e-invoice`, the targets
   are the fields bound to every operand role of every claim it answers. Document roles are read at document scope, line
   roles at that line, and VAT roles per row.
2. **Re-read.** Each target is re-read from two alternative readings of the same PDF:
   - R2: OCR at 400 dpi with `--psm 6`;
   - R3: OCR at 300 dpi with `--psm 4`.

   Both use pdftoppm, Tesseract 5.4 with orientation from OSD, and X1's frozen parser `parseWords`. For text-layer
   documents these readings are independent of the round-1 reading. For scanned documents they are different settings of
   the same engine. Lines are matched across readings by a unique line id, and VAT rows by position. An ambiguous match
   is not read.
3. **Accept.** A re-read value is accepted only when R2 and R3 both read it and agree exactly. If it differs from the
   current value, or the current value is absent or unreadable:
   - it is set, with its quote: the R2 raw string for header and total fields, or the R2 row text for line and VAT
     fields;
   - the R2 and R3 texts are appended to the source as pages separated by form feeds.
4. **Concede.** The verdict is FAIL, and every target of every failing claim was re-read and confirmed (R2 = R3 = the
   current value): decision `reject`, with the extraction unchanged.
5. **Decline.** Nothing changed and nothing was conceded: no new proposal.

**Never:** compute a field from other fields, take a value from a single reading, or use the base XML.

### D. Control, `t3-naive-recompute@1` (arm PE-N, 60 items × 2)

This is the brief's literal example of a recompute corrector, run as a declared control.
- **Round 1** is as in C.
- **On a FAIL**, for every failing claim, it sets the stated field (the remedy's operand path) to the claim's `expected`
  value, keeps the old quotes, and keeps the decision `accept`.
- **Otherwise** it declines.

It runs twice: with the edit discipline ON (the loop as built) and with it OFF (the check disabled, to measure what it
holds back).

## 6. Corpora (labels used ONLY to score, never by an agent)

**AP: Distil Labs `invoice-processing-pipeline`** (Apache-2.0), local copy `workspace/receipts-spike/data/distil/`:

| file | sha256 |
|---|---|
| `invoice_cases.jsonl` (100 cases, gold decision) | `c6ffc9b9c41b8a5adfb65de2c60b4c5e4c595f6b46944351b51217dda9df4b02` |
| `erp.json` | `0d03294081e923dfd799499b9c4cd2c60c433df02f000df4b7f7e158b8edb2a0` |
| `decider__gemini-3.5-flash-lite.jsonl` | `2ff1d8b3…` |
| `decider__glm-5.3-high.jsonl` | `b0ed7993…` |
| `decider__gpt-5.6-luna.jsonl` | `608b583f…` |
| `decider__gpt-5.6-luna-high.jsonl` | `eaf1d8ac…` |
| `decider__jev-checks.jsonl` | `7e316389…` |
| `decider__jev-lines.jsonl` | `59590742…` |
| `decider__jev-single.jsonl` | `05b009b1…` |

The agents never read the gold fields (`decision`, `invoice`, `grounding`, `kind`, `reasoning`).

**Peppol: X1's e-invoice PDF corpus** (60 PDFs; manifest sha256
`c6807187e43961303f9541b821b0da787e300c97661f8c44c75ed5bab44c8021`):
- **arms:** clean 20, planted 20, noise 20;
- **labels:** `expected` is `NOT_PASS` for planted items and `PASS_IF_ORACLE_PASSES` for the rest;
- **the oracle:** the manifest's `truth_extraction` through the same 0.2.0 gate, without source text.

## 7. Scoring

**AP:**

| gold | correct | wrong |
|---|---|---|
| `approve` | CONVERGED-PASS | CONVERGED-FAIL (a false hold) |
| any hold | CONVERGED-FAIL | **CONVERGED-PASS (a WRONG PASS)** |

**Peppol:**

| expected | correct | wrong |
|---|---|---|
| `NOT_PASS` | CONVERGED-FAIL | **CONVERGED-PASS (a WRONG PASS)** |
| `PASS_IF_ORACLE_PASSES`, oracle passes | CONVERGED-PASS | CONVERGED-FAIL (a false FAIL) |
| `PASS_IF_ORACLE_PASSES`, oracle does not pass | not CONVERGED-PASS | CONVERGED-PASS (a wrong PASS) |

In addition, every CONVERGED-PASS item's accepted extraction is compared with the printed truth (`truth_extraction`). Any
numeric field that differs is listed by item and field, as a PASS on a value the page does not print.

**HELD-FOR-HUMAN is an abstention.** It is never scored correct, and never wrong.

**Per arm, the report gives:**
- n, and counts of each outcome split correct/wrong;
- rounds-to-PASS (1, 2, 3);
- the fraction of PASS-expected items that converge to a correct PASS;
- PASS precision;
- the fraction HELD;
- wrong PASS with a Wilson 95% interval (verify's `wilsonInterval`).

## 8. The bar

1. **HARD: wrong PASS = 0** in arms AP-L, AP-R (all seven configurations), PE-S and PE-N with discipline ON. Any wrong PASS
   is reported by item id and fails the sprint. It is never averaged away. PE-N with discipline OFF is a control and is
   expected to show wrong PASSes. It demonstrates that the measurement can see one; it is not part of the bar.
2. **Replay.** Every loop bundle in every arm replays:
   - the chain verifies;
   - every round's verify bundle MATCHes through `node products/verify/dist/cli.js replay`;
   - every returned instruction carries that round's remedies byte for byte;
   - the edit discipline re-derives the same result;
   - the top hash equals the chain head.

   Any divergence is named by round.
3. **Tamper controls.** At least three tampered bundles must each be detected and named by round:
   - one byte of a returned remedy changed;
   - a proposal value changed;
   - a row removed.

## 9. Predictions (stated now; not bars)

- **AP-L.**
  - Approve-gold items converge to PASS in round 2 (supply the goods receipt, then pay).
  - Hold-gold items converge to FAIL within 3 rounds (supply, FAIL, concede), or are held at the limit.
  - Items are held where the ERP key is not found exactly once in the invoice text.
- **AP-R.**
  - Every round-1 agreement executes in round 1.
  - Every published wrong approval becomes CONVERGED-FAIL in round 2.
  - A published hold that the checker does not share as a hold is HELD, because the stand-in never moves toward pay.
- **PE-S.**
  - Round 1 equals R4's post-hoc 0.2.0 decisions on the same extractions.
  - Planted FAILs converge to FAIL in round 2 when both re-reads confirm.
  - Stamped values stay HELD.
  - Some low-resolution or rotated items may converge to PASS on agreeing re-reads.
- **PE-N.**
  - OFF: wrong PASS on most of the 16 planted arithmetic, VAT-subtotal and currency defects.
  - ON: 0, because every changed value lacks a quote that reads as it.

## 10. Disclosures

- **Prior knowledge of round 1.** Before writing this, I read X1's and R4's reports, which describe round-1 outcomes on
  this corpus: which items abstain or FAIL, and why.
- **How the rules were designed.** The corrector rules come from the ruleset's own remedy declarations. They were probed
  on X1's synthetic development invoices and on synthetic AP text I wrote, not on corpus items.
- **The AP gate is not blind here.** The production AP engine carries two wording rules tuned on this set (BENCHMARK-AP
  run 2). The gate's decisions on it are therefore not a blind accuracy result. What this run measures is the loop: whether
  remedy-driven correction can produce a wrong PASS, and how often it converges.
- **When the code is frozen.** The loop and corrector code is frozen before the first corpus run. Its sha256 values go into
  each run receipt.
