# BPI Challenge 2019, value-level three-way reconciliation: PRE-REGISTRATION

*v0 written 2026-10-03 ~02:25 EDT, before the log finished downloading and before any trace was parsed. Hashed on save; the
hash is recorded in `PREREG-HASHES.txt` and in the sprint report. Amendments are APPEND-ONLY sections below the v0 line, each
hashed on save. The scored run uses the harness frozen after the last amendment.*

## 1. Data
- **BPI Challenge 2019** (van Dongen, 2019), 4TU.ResearchData, DOI `10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1`. One file,
  `BPI_Challenge_2019.xes`, 728,558,522 bytes, supplied md5 `4eb909242351193a61e1c15b9c3cc814` (from the 4TU API record, saved
  raw as `SOURCE-4tu-article.json`). The sha256 is recorded on download (Amendment A).
- **Licence:** the API record's licence field reads `{"value":1,"name":"CC BY 4.0","url":"https://creativecommons.org/licenses/by/4.0/"}`.
- **What the data is.** A real purchase-to-pay *event log* from one multinational coatings company: one case per purchase-order
  item (the description states 251,734 cases, 1,595,923 events, 42 activities). Monetary values are anonymized "using a linear
  translation respecting 0, i.e. addition of multiple invoices for a single item should still lead to the original item worth
  (although there may be small rounding errors for numerical reasons)" (description, quoted raw).
- **The dataset's own compliance rule** (description, quoted raw): "Overall, for each line item, the amounts of the line item, the
  goods receipt messages (if applicable) and the invoices have to match for the process to be compliant."

## 2. What this test is, and is not
- **Not an invoice-reading number.** Nothing is extracted from a document. The log carries values per event; it carries no
  quantities and no unit prices.
- **Therefore verify's text ruleset `ap-threeway` (units billed ≤ units received; unit price ≤ PO × 1.02; line math; total) cannot
  be applied as published.** What is tested is the value-level three-way core, run through verify's own cross-document
  reconciliation layer (`reconcile`, "document-level scalar coherence (the 3-way-match core)" in its source header), under a
  reconciliation ruleset declared here: **`bpi-threeway-value@1.0.0`**. The library is a frozen snapshot of
  `products/verify/dist` (tree hash recorded in the report); nothing under `products/` is edited.
- The number answers: on real procurement data, does this deterministic reconciliation raise flags that a person reading the raw
  events confirms are real, how much of the log can it decide, and does it line up with the company's own block/clear behaviour.

## 3. Unit, dev slice, scored set
- **Unit:** one case (purchase item). Case attributes come from the trace; values from the events.
- **Dev slice (disclosed, excluded from every scored metric):** the first 1,500 traces in file order. Used only to (a) hand-check
  the parser on the first 1,000 events and (b) settle the open mapping questions in §5 by the decision procedures written there.
- **Schema pass (disclosed):** before the dev slice, one pass over the whole file collects ONLY activity names, attribute keys
  with their types, and the distinct values of the categorical case attributes (Item Category, Item Type, Document Type, the two
  flags). No counts, no values, no per-case information.
- **Scored set:** every trace after the first 1,500.

## 4. Categories (from the description, quoted raw where it defines them)
- **3-way, invoice after GR:** "indicated by both the GR-based flag and the Goods Receipt flags set to true".
- **3-way, invoice before GR:** "indicated by the GR-based IV flag set to false and the Goods Receipt flags set to true"; invoices
  "are blocked until goods are received ... Invoices should only be cleared if goods are received and the value matches".
- **2-way:** "indicated by both the GR-based flag and the Goods Receipt flags set to false"; "the value of the invoice should match
  the value at creation (in full or partially until PO value is consumed)".
- **Consignment:** "GR indicator is set to true but the GR IV flag is set to false and also we know by item type (consignment) that
  we do not expect an invoice against this item."
- The category used is the trace's `Item Category` attribute. If it disagrees with the category implied by the two flags (and Item
  Type for consignment), the item ABSTAINS (`CATEGORY_CONFLICT`). An unknown category string ABSTAINS.

## 5. Mapping from XES to the three documents, and the open questions
Per item the harness builds three JSON documents for `reconcile`: `po { value }`, `receipt { value }`, `invoice { value }`,
plus a `log` record kept outside the verdict (clearing, blocks, cancellations; used only for the secondary analysis in §8).
- `po.value` = the PO item's net value at log end.
- `receipt.value` = net goods-receipt value at log end (receipts minus receipt cancellations).
- `invoice.value` = net invoiced value at log end (invoice receipts, plus subsequent invoices if they carry value, minus
  invoice cancellations).

**Open questions, settled on the dev slice only, by these procedures, recorded in Amendment A before the scored run:**
- **Q1 value semantics.** The event attribute carrying money (expected name "Cumulative net worth (EUR)") is either the value of
  that event, or a running item total. Procedure: in dev-slice items with two or more goods-receipt events, compare per-event
  values with the creation value. If the per-event values sum to (or towards) the creation value, values are per event and are
  summed; if they rise monotonically to it, they are running totals and the last value (or differences) is used. Recorded with
  the case ids that decided it.
- **Q2 receipt activities.** Which activities add or remove receipt value (goods receipt; whether a service entry sheet carries
  receipt value of its own or is followed by a goods receipt). Procedure: read dev-slice service items; count a service entry
  sheet as receipt only if goods-receipt events are absent where the sheet appears.
- **Q3 invoice activities.** Which activities add or remove invoiced value without double counting (the buyer's invoice receipt
  vs. the vendor-side "creates invoice" event; subsequent invoices; debit memos; cancellations). Procedure: in dev-slice items, check
  whether the vendor-side event and the invoice receipt carry the same value for the same invoice; if so only the invoice
  receipt counts.
- **Q4 PO value.** Creation value, updated by price or quantity change events if those carry the new item value. Procedure: read
  every dev-slice item with a change event.
- **Q5 exact strings.** Activity names and category strings, copied from the schema pass.
- **Q6 clearing value.** Whether a clearing event carries the cleared invoice value (needed for §8 only).
- **Never guess.** Any activity whose value role the amendment cannot settle is listed there; if such an event carries a non-zero
  value in an item, the checks it could affect ABSTAIN (`UNMAPPED_VALUE_EVENT`).

## 6. The ruleset `bpi-threeway-value@1.0.0` (run through verify `reconcile`)
| check | applies to | expression | meaning |
|---|---|---|---|
| `R0_CONSIGNMENT_NO_INVOICE` | consignment | `inv = 0` | "we do not expect an invoice against this item" |
| `R1_INVOICED_LE_RECEIVED` | both 3-way categories | `inv <= gr` | billed more than was received |
| `R2_INVOICED_LE_ORDERED` | both 3-way, 2-way | `inv <= po * 1.02` | billed more than ordered, beyond the AP ruleset's published 2% price tolerance |

- Tolerance: verify `reconcile`'s defaults (per-check absolute floor 0.01; relative 0.0003 of the larger side), which absorb the
  anonymization's rounding.
- Checks are "≤", not "=": an item still partly delivered or partly invoiced at the end of the log is open, not wrong. Over-billing
  is what an AP gate holds.
- **Item decision** (stricter than verify's aggregate outcome, which is also recorded): FAIL if any applicable check FAILs; PASS if
  every applicable check PASSes; otherwise ABSTAIN with verify's insufficiency reason or the harness's abstain reason.
- **In scope for a decision:** items with at least one invoice-value event. Items with none are `NOT_INVOICED` (nothing to check);
  they count in the all-items denominator only.
- Abstain reasons pre-registered: `CATEGORY_CONFLICT`, `NO_PO_VALUE` (no creation value, or ≤ 0), `UNMAPPED_VALUE_EVENT`, and any
  verify insufficiency (`FIELD_MISSING`, `UNPARSEABLE`, ...).
- Remedies: verify attaches its typed remedies to every non-PASS claim; they are recorded per item as issued.

## 7. Primary metric and the bar
- **Audited precision of FAIL flags.** A seeded uniform random sample of **200** scored FAIL items (all of them if fewer), drawn
  without replacement by mulberry32 seeded with the first 8 hex digits of the FINAL frozen prereg sha256 read as an unsigned
  integer.
- **Auditor:** Claude Opus 5.5 (`claude-opus-5-5`), the same agent that wrote the harness. **This is an agent audit, labelled as
  one; it is not independent of the harness author.**
- **Audit protocol.** For each sampled item the auditor reads a dump of the raw trace (case attributes; every event in file order
  with activity, timestamp, value, resource) that does NOT show the harness's computed operands, writes one or two lines of what
  the events show, and labels it:
  - **CONFIRMED**: reading every receipt, invoice, cancellation, reversal, change and clearing in the trace, the invoiced value at
    log end genuinely exceeds the received value (3-way) or the ordered value beyond 2% (3-way, 2-way), or a consignment item
    carries invoiced value.
  - **FALSE**: the excess disappears under a reading of events the harness ignored or misread, or the flag rests on a mapping
    artifact.
  - **UNCLEAR**: the raw events cannot settle it. UNCLEAR counts as not confirmed.
- **Precision** = CONFIRMED / audited. **Interval:** Wilson score, 95%.
- **Bar: PASS if the Wilson 95% lower bound is ≥ 0.80; FAIL otherwise.** (From the build map's card S4.)

## 8. Secondary and tertiary (reported, no pass bar)
- **Coverage** = decided (PASS + FAIL) / scored items in scope (≥ 1 invoice-value event). Beside it: decided / all scored items.
- **Abstain rate** and its reasons, over scored items in scope.
- **Flag rate by category** = FAIL / decided, per category (tertiary).
- **Agreement with the log's own behaviour** (the question the sprint was set). Per decided item, `LOG_HELD` = the trace holds a
  payment-block event, or an invoice cancellation, or invoiced value not cleared by log end; `LOG_CLEAN` otherwise. Exact activity
  names fixed in Amendment A. Reported: the 2×2 of harness FAIL/PASS × LOG_HELD/LOG_CLEAN, agreement, and the relative risk of
  LOG_HELD given FAIL vs PASS with a 95% CI (log method). **Predicted direction: RR > 1.** Also reported: FAIL items the log
  cleared in full with no block or cancellation (candidates the company's own controls let through), with case ids.
- **Miss audit:** 50 scored PASS items drawn by the same PRNG family (seed + 1), audited by the same protocol for a mismatch the
  harness missed. Reported as a count with case ids, not as a rate claim.
- **Determinism:** the scored run twice; the per-item results file must be byte-identical (sha256 recorded).

## 9. Reporting rules
- The first full run of the frozen harness on the scored set is the headline, reported as-is.
- Any mapping or rule change made after seeing scored outcomes is a disclosed, tuned run, labelled as tuned, with the blind number
  beside it. Never the headline.
- A FAIL against the bar is published the same way as a PASS.
- Published either way, in `RESULTS.md`: every number with the command that re-runs it; the full audited sample (case id, label,
  one line each); every FALSE and UNCLEAR flag and every miss found; what the number does and does not say.

---
*(end of v0; amendments below are append-only)*

## Amendment A (2026-10-03 ~03:10 EDT): after the schema pass and the dev slice, before any scored trace is parsed

**A1. Data received.** `BPI_Challenge_2019.xes`, 728,558,522 bytes, md5 `4eb909242351193a61e1c15b9c3cc814` (equals the supplied
md5), **sha256 `af63bc687fc4152f2123b05c3af7772b37ef3fce2d3f67f812666c9e356baae7`**.

**A2. Schema pass** (`results/schema.json`): 42 activities, matching the description. Event attributes are only
`concept:name`, `time:timestamp`, `Cumulative net worth (EUR)`, `User`, `org:resource`. No quantity, no unit price, no
per-event amount other than that one value attribute. Category strings as in §4; Item Types Consignment, Limit, Service,
Standard, Subcontracting, Third-party.

**A3. Q1 answered, and it retires the v0 design.** The value attribute is the item's net worth repeated on every event: **1,477
of the 1,500 dev traces carry one single value on every event** (`dev-probe.mjs`). Example: case `2000000014_00001` has five
goods receipts, five invoice receipts and five clearings, every one at 17,414.00, the creation value. Neither reading in §5 Q1
holds (the values neither sum to nor climb to the creation value). The 23 traces whose values vary do so on receipt, invoice,
service-entry, block-removal and cancellation events, and not consistently (case `2000000030_00001`: two receipts at 549.00,
then invoices at 549.00 and 1,098.00). **So the money on receipts and invoices cannot be reconstructed from this file, and the
v0 value ruleset `bpi-threeway-value@1.0.0` (R0/R1/R2 on amounts) cannot be computed.** It is retired here, before any scored
outcome is seen. That is a finding about the data and is published as one.

**A4. Replacement design: `bpi-threeway-messages@1.0.0`, a message-level three-way match, still through verify `reconcile`.**
The log does carry the messages themselves: goods receipts, invoice receipts, their cancellations, clearings.
- `receipt.messages` = #`Record Goods Receipt` − #`Cancel Goods Receipt`. Where a trace has no `Record Goods Receipt`,
  #`Record Service Entry Sheet` stands in (Q2: on the dev slice, service items post a goods receipt and a service entry sheet in
  the same minute, e.g. `2000000001_00001`, `2000000002_00001`; no dev trace has a sheet without a receipt).
- `invoice.messages` = #`Record Invoice Receipt` − #`Cancel Invoice Receipt` (Q3: `Vendor creates invoice` and `Vendor creates
  debit memo` are vendor-side events, not postings; their counts differ from the invoice-receipt counts in 69 dev traces, so
  they are not the same messages and are not counted).
- `Record Subsequent Invoice` / `Cancel Subsequent Invoice` adjust a posted invoice and need no receipt of their own; they count
  only for consignment.
- **`R1M_INVOICES_LE_RECEIPTS`** (both 3-way categories): `inv <= gr`, exact on integers (ruleset tolerance rel 0, abs 0.01).
  "Every posted invoice receipt has a goods-receipt message."
- **`R0M_CONSIGNMENT_NO_INVOICE`** (consignment): net invoice receipts + net subsequent invoices `= 0`.
- **2-way items ABSTAIN `NO_AMOUNTS_FOR_TWO_WAY`**: their only leg is invoice amount vs PO value, and no invoice amount exists.
  (The dev slice holds no 2-way item.)
- The value attribute is not an operand. It is reported only: each item's creation value, and the share of items whose value
  is constant.
- Q4 (PO value updates) and Q6 (clearing value) are moot.
- **Abstain rules:** `CATEGORY_CONFLICT`; `NO_AMOUNTS_FOR_TWO_WAY`; `TIMESTAMP_FORMAT` (a timestamp not in the file's ISO UTC
  form, which would break ordering); `TRUNCATED` (no `Create Purchase Order Item`, or a receipt / invoice / cancellation /
  clearing dated before it); `NEGATIVE_NET` (an operand the category uses is below zero; the dev slice showed `Cancel Subsequent
  Invoice` with no `Record Subsequent Invoice` in 7 traces, so subsequent-invoice nets are checked only for consignment).
- **In scope:** at least one `Record Invoice Receipt` or `Record Subsequent Invoice`.
- **Remedies:** verify's reconciliation rulesets declare none, so a FAIL carries verify's `none` remedy ("the finding stands").
  Recorded per item as issued.
- Each document carries the case id, so every verdict id binds to its item.

**A5. `LOG_HELD` fixed (§8).** A `Set Payment Block` or `Remove Payment Block` event (dev: 392 traces show a removal and only 2 a
set; blocks are mostly set by the system without an event, so a removal is the evidence a block existed); or a `Cancel Invoice
Receipt`; or uncleared: #`Record Invoice Receipt` > #`Clear Invoice` (dev: clearings equal gross invoice receipts in 1,300 of
1,404 invoiced traces; a cancelled invoice's reversal is cleared against it, e.g. `2000000071_00001`, `4507000322_00030`).

**A6. Audit protocol re-specified for message-level flags.** The v0 label (invoiced *value* exceeds received value) cannot be
judged on this file. Each sampled FAIL gets two labels:
- **Primary (the bar applies):** **CONFIRMED** if, reading every event, more invoice receipts stand than goods receipts at the end
  of the log after every cancellation and reversal, and no event the harness ignores accounts for the excess. **FALSE** if such
  an event or artifact accounts for it: a receipt recorded under another activity, one invoice logged twice, a truncated
  history. **UNCLEAR** if the raw events cannot settle it, for example two invoice receipts by one user in the same minute that
  may be one document. UNCLEAR counts as not confirmed.
- **Secondary (descriptive, no bar):** does the trace show a reason a clerk would accept for invoices outnumbering receipts?
  **VISIBLE_REASON** (a vendor debit memo, a PO quantity or price change, or the extra invoice still unpaid at log end) or
  **NO_VISIBLE_REASON**. Without per-event amounts, partial invoicing against one receipt cannot be told from over-billing, so
  NO_VISIBLE_REASON is not a finding of over-billing.
- **Miss audit** (§8, 50 PASS items): **MISSED** if the events show an invoice receipt with no goods receipt to match that the
  harness netted away, otherwise **OK**, or **UNCLEAR**.

**A7. Unchanged:** the primary metric (audited precision of FAIL flags, 200 sampled, Wilson 95%), the bar (**PASS iff the lower
bound ≥ 0.80**), the auditor (Claude Opus 5.5, an agent audit, not independent of the harness author), the secondaries, the
determinism check, the reporting rules. The seed is the first 8 hex digits of the sha256 of `PREREG-final.frozen.md`, a copy of
this file as of this amendment.

**A8. Dev-slice outcomes seen (disclosed).** On the first 1,500 traces the frozen harness gives 1,404 invoiced items, 10 FAIL,
1,394 PASS, 0 ABSTAIN. All 10 FAIL items are `LOG_HELD`. I read four of them (traces 670, 673 and 683 in full, 942 in part);
the other six I saw only as event counts. Those 10 are excluded from every scored number.

**A9. What the scored number can and cannot say.** It is a message-level fact about a real purchase-to-pay log: posted invoices
that outnumber goods receipts. It is not a money-level match, not an invoice-reading number, and not a measure of
over-billing. The log-agreement table is the only external check: whether the company's own system blocked, cancelled or left
unpaid the items the check flags.

**A10. Freeze.** Harness files (`run.mjs`, `mapping.mjs`, `xes.mjs`, `score.mjs`, `stats.mjs`, `dump.mjs`) and the verify snapshot
are hashed in `PREREG-HASHES.txt` before the scored run.
