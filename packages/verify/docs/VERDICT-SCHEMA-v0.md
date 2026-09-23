# Verdict schema — v0 (2026-09-22; revised 00:50 to match `src/verdict/schema.ts`)

> The verdict is the product. Everything else is plumbing. This schema is designed so that a verdict emitted today can be **replayed and re-audited** in three years, and so that Stage 2 (the Verdict Ledger) and Stage 3 (agentic argument-truth) need *additive* fields only — never a breaking change.
>
> **Source of truth is the TypeScript in `src/verdict/schema.ts`.** This document explains the rules behind it.

## Design rules

1. **A verdict is a proof object, not a score.** It carries everything needed to reproduce itself: inputs (by hash), the exact rules that fired, the computation performed, the operands consulted with their provenance, and the versions of everything.
2. **Three outcomes, never a fourth.** `PASS` (the check ran and held) · `FAIL` (the check ran and did not hold) · `INSUFFICIENT_DATA` (the check *could not run* — the inputs did not permit a determination). **FAIL and INSUFFICIENT_DATA are different verdicts and are never conflated.** "Proven wrong" ≠ "couldn't tell."
3. **Every claim gets its own verdict.** The document-level outcome is an aggregation over per-claim verdicts and the aggregation rule is named (`ANY_FAIL_FAILS`: FAIL if any claim FAILs; else INSUFFICIENT_DATA if *no* claim could run; else PASS — a PASS with partial coverage is honest, and `coverage` says how partial).
4. **Tier is explicit.** Each claim declares *how* it was reached: `DETERMINISTIC` (recompute / exact match — cannot be hallucinated) or, later, `REASONED` (the hybrid overreach tier — an audited opinion, labeled as such). v0 emits only `DETERMINISTIC`. **A REASONED verdict is never presented as DETERMINISTIC**, and the consumer never infers tier.
5. **Determinism is a contract.** Same `input_hash` + same `ruleset.version` + same `engine_version` → byte-identical verdict **except `issued_at`**, the one field allowed to carry a clock (injectable for tests). `verdict_id` is therefore **derived** (`sha256(input_hash:ruleset@version:engine)`), not a ULID. `replayView(verdict)` returns the comparable projection.
6. **Provenance points into the input, never at it.** v0's input is *structured, already-extracted JSON*, so each piece of evidence carries a **field locator** — `source` (invoice / contract / evidence / computed) + `path` — plus the normalized value, the original value when it differed, the normalization log (e.g. `european_format_converted`), and the binding confidence (100 exact path · 95 alternative path · 75 fuzzy alias — only exact/alternative can lock). Character-span locators are reserved for the later source-document mode.

## Three honesty rules enforced on top of the kernel

- A kernel `FAIL` whose only failing predicates are *could-not-compare* (type mismatch, operand missing, wrong shape) becomes **`INSUFFICIENT_DATA / UNPARSEABLE`.** The data wasn't proven wrong; it couldn't be compared.
- A kernel `INSUFFICIENT_DATA` whose missing roles are *all* contract-side (or all evidence-side) **while the caller supplied no such reference** becomes **`INSUFFICIENT_DATA / REFERENCE_NOT_PROVIDED`.** The extraction is not at fault; the check simply needs a document it wasn't given.
- **A verdict is never issued on a guessed field.** Binding confidence is exact path 100 · alternative path 95 · fuzzy alias search 75. After every operand is on the receipt — including the operands *behind* computed roles, which inherit the **lowest** confidence of their inputs — any PASS/FAIL resting on an operand below **90** becomes **`INSUFFICIENT_DATA / AMBIGUOUS_FIELD`**, with the guessed operand still shown so the developer can name it properly. (Found by the first test run: the engine's alias table lets "subtotal" reach `totals.total`; without this rule a footing check could FAIL against a number that was never on the invoice.)

## Rulesets and the history axis (added 02:30)

The verdict's `ruleset {id, version, domain}` names the document type's law package (`docs/RULESETS.md`); `verdict_id` includes it, so the same input under different rules is a different verdict. `references.history` counts prior documents of the same kind (the previous pay application; prior invoices); evidence bound from them carries `source: 'history'` and a path into the caller's document (`history[0].schedule_of_values[1].completed_to_date`), role `REFERENCE`. `variance` is **signed**: asserted − expected (a stated total below its recomputation is negative).

## Insufficiency reasons

`FIELD_MISSING` · `UNPARSEABLE` · `AMBIGUOUS_UNIT` (currency mismatch, unknown scaling) · `AMBIGUOUS_FIELD` (found only by fuzzy name-matching) · `AMBIGUOUS_REFERENCE` (the reference offers several candidates — e.g. many rates — and none could be matched to this line; honesty rule 4) · `SPAN_NOT_FOUND` (source-document mode) · `OUT_OF_RULESET_SCOPE` · `REFERENCE_NOT_PROVIDED`. Every `INSUFFICIENT_DATA` claim carries one, with a `detail` sentence and the `missing` roles when applicable. For computed roles (`LINE_ITEMS_SUM`, `EXPECTED_GRAND_TOTAL`, `EXPECTED_TAX_AMOUNT`) the detail names *which operand* was absent.

## Non-negotiables (tested as schema invariants)

- `evidence` may be empty **only** on `INSUFFICIENT_DATA`. A `PASS` or `FAIL` with no evidence is a schema violation, not a verdict.
- `insufficiency` is present **iff** `outcome === 'INSUFFICIENT_DATA'`.
- `tier` is stated by the producer and cannot be upgraded after the fact.
- `declared_accuracy` is *measured on a public, preregistered set* or it is absent. It is never estimated.
- `replayable` is literally `true` — the field asserts the contract for this verdict.

## Shape (abridged — see `src/verdict/schema.ts`)

```
Verdict {
  schema_version 'v0' · verdict_id (deterministic) · issued_at (ISO-8601 UTC; the only volatile field)
  engine_version · ruleset {id, version, domain} · input_hash · replayable: true
  document { extraction_hash, producer?, line_items } · references { contract: bool, evidence: n }
  outcome · aggregation 'ANY_FAIL_FAILS' · claims: ClaimVerdict[]
  coverage { claims_total, claims_checked, claims_pass, claims_fail, claims_insufficient }
  declared_accuracy? · ledger? (Stage 2) · action_context? (Stage 3)
}
ClaimVerdict {
  claim_id ("document.TOTAL_INT", "line[3].MATH_INT") · kind (RECOMPUTE | QUOTE_MATCH | CROSS_REFERENCE | CONSISTENCY)
  tier · outcome · field · asserted · rule_id · rule_name
  computation? { formula, operands (by role), result, tolerance? }
  evidence: Evidence[] · insufficiency? · variance? · locked · explanation
}
Evidence { locator {kind:'field', source, path} | {kind:'span',…} · value · original? · normalizations? · confidence · role }
```

## What v1 will add (so v0 doesn't paint us into a corner)

- `REASONED` tier live for the overreach flag (hybrid), with its own declared accuracy measured separately from the deterministic tier.
- Multi-document `CROSS_REFERENCE` across `source_hash`es and span locators (documents checked against documents).
- `AMBIGUOUS_UNIT` abstention on currency mismatch / "in thousands" scaling.
- Ledger population (Stage 2) and `action_context` population (Stage 3) — both already reserved.
