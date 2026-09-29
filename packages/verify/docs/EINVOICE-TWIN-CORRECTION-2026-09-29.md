# Published miss: the e-invoice twin said PASS for extracted values it never verified (corrected 2026-09-29)

**Honesty key:** ✓ measured · ⚠ inferred · ◇ hypothesis.
**Status:** fixed in this repository, before the e-invoice twin's first public release. The twin moves to **0.3.0**.

We publish the misses of what we build. The e-invoice twin (`verifyEinvoiceTwin`, XML mode) checks an agent's extracted
invoice values against the invoice's own binding XML, and separately checks the XML's own footing (BR-CO-10/13/15/16 and
the line rule). Up to 0.2.0, its verdict could read **PASS when no extracted value had been verified at all**.

Who was affected: any caller that read `verdict.outcome` from `verifyEinvoiceTwin` at twin 0.1.0 or 0.2.0, or the exit
code of `verify twin-einvoice` (0 = PASS), when every extracted claim abstained, or when no claims were supplied. The
per-claim judgments and the footing results were right throughout; only the verdict's aggregate outcome was wrong.

## What was wrong, and what it did

| # | defect in 0.1.0 / 0.2.0 | effect |
|---|---|---|
| 1 | The verdict counted the footing claims (the document checked against itself) the same as the extracted-value claims. PASS needed only "some claim PASSed and none FAILed", and on a consistent invoice the footing always supplies passing claims. | **False confidence:** an extraction nobody verified read PASS. For example, a single claim that abstained (the element is absent, the field is not mapped, the element is ambiguous, a name differs beyond normalisation) on an internally consistent invoice gave verdict PASS. So did a call with no claims. |

✓ Reproduced on the public fixture `test/fixtures/einvoice/peppol-bis3-invoice.xml`: one claim,
`tax_amount_accounting_currency` (BT-111; the fixture states no BT-6, so the claim abstains with ELEMENT_ABSENT). Coverage
was 7 PASS (all footing), 0 FAIL, 1 abstention, and the verdict was **PASS**. With no claims at all it was also PASS.

How it was found: by the first blind baseline of our sealed certification test set (held out; its items are never used to
build a fix). Its e-invoice ambiguity class, where the right answer is to abstain, read PASS on 8 of 8 items. The cause was
then found on the public fixture above, and this fix was built from that fixture and the class description alone.

## The fix (twin 0.3.0)

The footing proves the document agrees with itself. It says nothing about whether the caller's values are right. The
verdict's outcome is now:

| outcome | when |
|---|---|
| FAIL | any claim FAILs: an extracted value, or the document's own footing (unchanged: an internally inconsistent invoice FAILs even when every extracted value matches it) |
| PASS | nothing FAILs, **and at least one extracted value was verified** (a `TWIN_XML:*` claim PASSed) |
| INSUFFICIENT_DATA | otherwise, including a footing that passes while no extracted value was verified |

- **The verdict names this rule.** Its `aggregation` is `ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES`, a second named rule
  added to the verdict schema (`docs/VERDICT-SCHEMA-v0.md`, rule 3). `ANY_FAIL_FAILS` would say a passing footing is
  enough, so keeping that name would have misdescribed the rule. The footing claims are the `CONSISTENCY` kind, and the
  extracted values are not.
- **The two questions are also answered apart:** `result.outcomes.extraction` (the extracted values alone) and
  `result.outcomes.footing` (the footing alone; `null` when it did not run). Each is FAIL if any of its claims FAILs, else
  PASS if any PASSed, else INSUFFICIENT_DATA.
- **The label follows the rule.** The three field maps (`twin-einvoice-peppol-bis3`, `-zatca-ksa`, `-ksef-fa3`), which are
  the verdict's ruleset, and `EINVOICE_TWIN_VERSION` all go 0.2.0 → **0.3.0**. So does the label for a document the twin
  cannot read (`twin-einvoice`, 0.1.0 → 0.3.0). Every twin verdict_id changes. Bindings, per-claim judgments and the footing
  are unchanged.
- **Replay:** a 0.2.0 verdict still verifies its binding. It is not re-performed by this build, because a check is
  re-performed only under the ruleset that made it (status `STRUCTURE_ONLY`).
- **The book's door** (and the HTTP door, which delegates to it) recomputes that rule exactly. A footing-only PASS is
  refused. So is the same PASS relabelled `ANY_FAIL_FAILS`, because a 0.3.0+ e-invoice verdict must name its own rule. A
  book that already holds a 0.1.0 or 0.2.0 verdict stays valid: that is exactly what the engine issued before this
  correction.
- **Dispute opinions** recompute the outcome under the rule the verdict names.
- **CLI:** `verify twin-einvoice` exits 2 (not 0) when the footing passes and no extracted value was verified.

## What it costs, measured (✓)

- **Real documents:** the E-INVOICE-2 measurement harness was re-run on the same 69 official and published-sample
  documents (Peppol BIS 3.0 and KSeF FA(3)). **No verdict moved** (0 of 69). Every published count is identical: claims
  PASS / FAIL / ABSTAIN, footing PASS / FAIL / ABSTAIN, 2,159 / 2,159 seeded errors caught, tampers FAILed, 0 false FAILs,
  and the source unit tests. ⚠ This is expected by construction: that set's claims are the documents' own mapped values,
  so every document had at least one verified extracted value. The defect only shows when nothing extracted is verified.
- **Synthetic accuracy** (`test/twin-einvoice-accuracy.test.ts`): per-claim judgments are unchanged, so the rates are
  unchanged. `measured_on` changes, because it binds the twin version.
- **The byte-identity goldens** (489 cases, and the 177 e-invoice ruleset cases) are unchanged. They run the declarative
  engine, not the twin.

## What this does not change

- One verified value is still enough for PASS when other extracted values abstain, as in every other verify mode. The
  `judgments` say which values were verified. A caller that needs every extracted value verified should require every
  judgment to be PASS. (`coverage` also counts footing claims, and some footing rules always abstain, such as KSeF's
  P_15 identity, so `coverage.claims_insufficient` is not that test.)
- A document the twin cannot read (not XML, or an unsupported profile) was already INSUFFICIENT_DATA, and still is.
