# Rulesets — how the engine grows

> One engine, one verdict schema, one binding layer. What changes per document type is a **ruleset**: a folder under
> `src/rulesets/<id>/` and one line in `src/rulesets/index.ts`. Nothing else has to learn about the new document.

## The shape (`src/rulesets/types.ts`)

| Piece | What it is | Invoice example | Pay-app example |
|---|---|---|---|
| `id` / `version` / `domain` | Named on every verdict; part of `verdict_id`. Rulesets version independently of the engine. | `invoice@0.0.1` | `pay-app@0.0.1` |
| `ontology` | Field names → roles, with `roleKinds` (how each role normalizes) and `lineArrayKeys` (what the per-line array is called). Amount roles have fuzzy matching **off**. | `totals.subtotal`, `line_items[*].amount` | `schedule_of_values[*].completed_to_date`, `summary.total_retainage` |
| `axioms` | The laws — kernel predicates comparing two roles with a tolerance. The **stated** figure is always the left operand so `asserted` is what the document says and `variance` is stated − expected. | `SUM_INT`, `TOTAL_INT`, `TAX_INT` | `G703_TOTAL` … `G702_PREV` (14) |
| `lineCodes` / `documentCodes` | Which laws run per line vs once per document. | 4 / 5 | 5 / 9 |
| `compute()` | Binds the **computed roles** (Σ, +, −, ×, ÷) with provenance naming their operands, inheriting the *lowest* operand confidence; reports what could not be computed and *why* (a string → `FIELD_MISSING`; an object → its own reason, e.g. `AMBIGUOUS_UNIT`, `AMBIGUOUS_REFERENCE`); returns extra operand evidence to attach to claims. | `LINE_ITEMS_SUM`, `EXPECTED_GRAND_TOTAL` | `SOV_COMPLETED_SUM`, `EXPECTED_CURRENT_PAYMENT_DUE`, `PREVIOUS_COMPLETED_TO_DATE` (from history) |
| `kindByCode` / `fieldByCode` | The vocabulary the verdict speaks in: RECOMPUTE / CROSS_REFERENCE / CONSISTENCY, and the caller's field name each law is "about". | `TOTAL_INT → 'total'` | `G702_DUE → 'current_payment_due'` |
| `referenceRoles` | Which roles come from `contract`, `evidence`, `history`. Drives honesty rule 2: missing reference ≠ the extraction's fault. | contract + evidence roles | history roles only |
| `ambiguityGuards` | Honesty rule 4: `[law, reference role]` pairs — abstain when the reference offers several candidates and none matched the line. | `RATE_SUP ↔ RATE_CONTRACTED` | none (history matching is by item number inside `compute`) |

## The four axes a ruleset can use

1. **Self** — the document's own arithmetic (always available).
2. **References** — contract / PO / receipt (`references.contract`, `references.evidence`).
3. **History** — prior documents of the same kind (`references.history`): the previous pay application, prior invoices. Bound with `source: 'history'` and a path into the caller's document (`history[0].schedule_of_values[1].completed_to_date`).
4. **Source text** — reserved: `QUOTE_MATCH` claims with span locators (does the extracted value appear at the cited span). Same primitive the legal corpus needs.

## Adding a ruleset — the checklist

1. `src/rulesets/<id>/ontology.ts` — every real-world field name you have seen, as `fieldPath` / `alternativePaths`. `fuzzyMatch: false` on every amount. Declare `roleKinds` for every role and `lineArrayKeys`.
2. `src/rulesets/<id>/axioms.ts` — one law per line of the form, stated figure on the left, tolerance stated and justified in a comment.
3. `src/rulesets/<id>/index.ts` — `compute()`; decide, per computed role, what "absent" means (a blank cell that is zero by the form's convention → 0 *and the formula says so*; anything else → an absence with a reason). Never guess a match: by identifier or not at all.
4. New roles → `UniversalRole` in `src/kernel/types.ts` (documented, one line each). New `RulesetRef` → `src/version.ts`.
5. One line in `src/rulesets/index.ts`; the `ruleset` option type in `src/index.ts`.
6. Tests: golden fixtures (`test/fixtures/<id>.ts`) with a clean, a broken (one error per law you care about), a first/edge case, an alternate vocabulary; outcome tests; add the fixtures to `schema-invariants` and `determinism/replay`; a seeded fuzzer.
7. Pre-register the ruleset's claims before measuring anything (`docs/PREREGISTERED-CLAIMS.md`).

## Honesty rules every ruleset inherits

Could-not-compare → `UNPARSEABLE`, not FAIL · missing reference → `REFERENCE_NOT_PROVIDED` · no verdict on a fuzzy-matched field (`AMBIGUOUS_FIELD`) · no verdict against an ambiguous reference (`AMBIGUOUS_REFERENCE`). A ruleset may add its own refusals through `compute()`'s absence reasons (pay-app: `AMBIGUOUS_UNIT` for a bare percent in (0, 1]).

## Mining a ruleset from labelled decisions (`src/mine`, 2026-09-24)

When a customer has past approve/hold decisions but no written policy, `verify mine` proposes the rules. It takes a case
table (`{ id, label, fields, lines? }` per line of a JSONL file) plus a schema that types each field (`qty` · `money` ·
`bool` · `id` · `ids`, with arithmetic roles `price`/`amount`/`total`/`extra` and a `source` per document). From these
it generates a grammar and judges every candidate against the Oracle-AP gauntlet: CONSISTENCY (no approved case violates
it) → GROUNDING (exact hypergeometric, ≥ 5 hold violators, p ≤ 0.01) → NOVELTY (greedy by coverage, ≥ 3 new holds).
The survivors are **candles**: proposals for a person to ratify. Every death goes to the **morgue** with its cause.
`--ap` runs Distil-style AP cases through the AP parser first (`apCasesToTable`). `--max-approved-violation-rate r`
tolerates approved exceptions, and grounding then uses the enrichment tail P(X ≥ holds among violators) (see
`src/mine/stats.ts`). `--ruleset-out` compiles the candles into a declarative ruleset that `verify <doc> --ruleset`
enforces.

Regression anchor: on the Distil AP set it reproduces the preregistered prototype bit for bit (4/4 policy rules, 0 false
candles, price t = 2%, 68/68 holds explained), and the compiled ruleset agrees with the gold decision on 100/100.

**Declarative-format additions (additive; every existing ruleset behaves as before):** field kinds `bool` (1/0 in
expressions, e.g. `sum(AMT) + FREIGHT * FREIGHT_ALLOWED`) and `identifier`, plus `compare: "identifier"` checks
(normalised id-set equality, e.g. "the invoice cites exactly the PO's number"). **Not expressible yet:** a sum of a
per-line product (`sum(qty*price)`). A candle that needs one is listed under `not_expressible` and left out, never
approximated, and the compiled ruleset is marked `complete: false`.

## Exception-aware, rounding-aware checks (2026-09-24)

Four more declarative additions, added for `financial-statement-core` v0.2 (`docs/examples/financial-statement.ruleset.v0.2.json`,
the implementation of the SEC v0.2 addendum, `bench/sec/ADDENDUM-V02.md` in the public repository). They are generic. They are additive: a ruleset that
uses none of them produces **byte-identical** verdicts, lint results and expression values. `test/declarative-golden.test.ts`
pins this with 489 hashes (real 10-K rows plus every example ruleset, reconcile, lint and expressions), frozen from the
engine as it was before these features.

| Feature | Syntax | Semantics |
|---|---|---|
| **Rounding-aware tolerance** | `"tolerance": { "rel": 0.0003, "absCap": 0, "rounding": "infer" }` on the ruleset; `"rounding": "infer" \| "none"` on a check overrides it | See "Rounding inference" below. |
| **Optional terms** | `ROLE?` in any numeric expression, e.g. `"CFO + CFI + CFF + FX_EFFECT?"` | Takes the role's value when it is reported, and counts as 0 when absent. A check decides when its **required** operands (those written without `?`) are present. A required operand that is absent abstains, as before (`FIELD_MISSING`). An optional term that is present but unparseable abstains (`UNPARSEABLE`) and is never read as 0. A form made only of optional terms, none of them reported, abstains. The `?` must follow the name directly. `sum(X?)`, `abs?(…)` and a free-standing `?` are errors. A role written both as `X` and `X?` is required. |
| **Abstain guards** | `"abstain_if_present": [ROLE…]`, `"abstain_unless_all_present": [ROLE…]`, `"abstain_if": [{ "left", "op", "right", "tol"? }]` (op: `= != < <= > >=`) | `abstain_unless_all_present`: any listed role not reported gives `FIELD_MISSING` (or `UNPARSEABLE`). `abstain_if_present`: any listed role reported (a `default` value does not count; present-but-unparseable does) gives `OUT_OF_RULESET_SCOPE`. `abstain_if`: any condition that holds gives `OUT_OF_RULESET_SCOPE`. The comparison is exact unless `tol` is set, and a condition with an absent operand does not fire. Every detail starts with `guard <name>:`. Guards run after the form is chosen, so a check already missing a field keeps its `FIELD_MISSING` reason, and before the comparison. They work on identifier checks and per line. A "fixed tag list" is a field whose `paths` are the tags (first present wins); naming that field in `abstain_if_present` fires on any of them. |
| **Check alternatives** | `"alternatives": [{ "left", "right" }, …]` | Ordered fallback forms of the same identity: the primary `left`/`right` first, then each alternative. The first form whose required operands are all present is evaluated. `op`, `tol`, guards and rounding are shared. Forms are chosen by what is present, **never by which one passes**: a failing primary is not rescued. If no form applies, the check abstains with `FIELD_MISSING`, naming what each form lacks. Use it for consistent pairing ("CI including NCI with ProfitLoss, else the parent's with NetIncomeLoss"), for "X, else Y + Z", and for "a reported total, else its parts". Numeric checks only. |

**Rounding inference.** This rule is ADDENDUM-V02 item 1, generalised. For each check and document:

- **Operands** are the amount-kind values the evaluated form uses, as reported. These do not count: absent optional terms, `default` values, and `bool`, `rate` and `quantity` fields. Computed roles are expanded into their own operands, and `sum(ROLE)` contributes every line's value.
- **The unit U** is the largest of {1, 1 000, 100 000, 1 000 000} that divides every operand.
- **The tolerance** is `max(tol floor, rel × largest |operand|, U × number of operands)`.
- **When no unit exists** (amounts with cents), the unit term is 0, so invoices keep the floor-plus-relative behaviour.
- **`absCap`**, if > 0, caps only the relative term.
- **A claim decided this way is final.** The separate relative-band pass (`applyTolerancePolicy`) does not run on it again. The claim carries `computation.tolerance = { abs: <tolerance>, rel }`, and its explanation states U, the operand count and the largest operand.

Lint understands all four: unknown roles, scope rules (line versus document), malformed options, numeric-only options on
identifier checks, and a warning for a form made only of optional terms. It also no longer *throws* on an expression
containing an invalid character: it reports it. That was a pre-existing crash. The reconciliation layer (`src/reconcile`)
shares the parser, so `ROLE?` parses there, but it has **no** optional semantics: reconcile treats every referenced role
as required.

## Candidates, in the order the demand data ranks them (2026-09-22)

invoice ✔ · pay-app ✔ · paystub / bank-statement running balance (fraud pre-screen) · freight bill vs rate agreement · financial-statement footing · legal cite-check (needs the source-text axis).
