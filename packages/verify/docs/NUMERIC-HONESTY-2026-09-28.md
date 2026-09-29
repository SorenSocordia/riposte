# Published miss: five ways our numbers were not quite honest (corrected 2026-09-28)

**Honesty key:** ✓ measured · ⚠ inferred · ◇ hypothesis.
**Status:** fixed in this repository. The built-in invoice ruleset is now **0.1.0**. 0.0.1 stays resolvable
(`resolveRuleset('invoice@0.0.1')`) so verdicts issued under it can be re-performed.

We publish the misses of what we ship. Riposte's promise is honest numbers: a PASS means the arithmetic holds, a FAIL means
it does not, and "could not compare" is never either one. Five defects broke that promise in small ways:
- one (R6) came from our own red team;
- one (D-TOL-ID) came from our replay work;
- two surfaced during engine work on real receipts;
- one was found by the property test written for this correction.

Every change below was pre-registered before it was measured, and the misses of that pre-registration are published
here too.

Who was affected: anyone who ran the built-in invoice ruleset (`verify <doc>`, `verify()` with no ruleset or
`'invoice'`), anyone who passed a tolerance override to `verify()` or `verifyDeclarative()`, and (for defect 3) the pay-app
ruleset. The declarative e-invoice rulesets were not affected by defects 1, 3, 4 or 5.

## What was wrong, and what it did

| # | defect | where | effect |
|---|---|---|---|
| 1 | **R6.** The invoice default tolerance was a 0.03% relative band with no absolute cap, so the amount it forgave grew with the document. | invoice 0.0.1 | **Missed errors:** a $2,500 overcharge on a $10M line PASSed as "rounding", and 0.03% of $1B forgives $300,000. The variance was shown, but the outcome a gate acts on was PASS. |
| 2 | **D-TOL-ID.** `input_hash` did not commit to a tolerance override. | `verify()`, `verifyDeclarative()` | **Identity:** one `verdict_id` could carry two outcomes, because the same document under the default and under an override got the same id. A replay could not tell which policy a verdict was issued under. |
| 3 | The kernel's `=` compared a string with a number and FAILed ("n/a ≠ 10"). Its `!=` would have PASSed the same pair. | kernel (every built-in ruleset) | **False FAIL:** an amount that does not parse ("n/a", "Rp. 91,000", a list) FAILed instead of abstaining. That breaks our first rule: could-not-compare is not FAIL. |
| 4 | Unit prices were rounded to the cent before the line check ("0.125" → 0.13). | invoice (unit price, contract rate) | **False FAIL:** 1,000 × 0.125 = 125.00 read as 1,000 × 0.13 = 130.00. **Missed error:** a wrong line amount of 130.00 matched the rounded price and PASSed. |
| 5 | A tax, service charge or discount that was present but did not parse was read as absent, that is, as 0. | invoice 0.0.1 | **False FAIL:** a correct total FAILed when the tax said "n/a". A subtotal present but unparseable was also labelled "missing" instead of "unparseable". |

## The fixes

**1. A rounding cap on the invoice band (invoice 0.1.0).**
- A money FAIL is treated as rounding only when |variance| ≤ max(floor, min(0.03% × |expected|, **U × k + S/2**)):
  - **U** is the document's grain: 1 when every amount its recompute claims assert is a whole number, otherwise 0.01.
    U is never read above 1. A round number is not a rounded one, and a grain read from round numbers would be the
    attacker's to choose (it would reopen R6 on a document written in thousands).
  - **k** is the claim's rounding steps: the reported operands on its receipt, plus one per line for TAX_INT (a tax can
    be rounded line by line and then summed).
  - **S** is a cash step, for the grand total only: the largest of {100, 50, 10, 5} × U that divides the stated total.
    A payable total rounded to the nearest 100 rupiah, 0.05 franc or whole krona is rounding.
- The cap only tightens. No claim that FAILs under 0.0.1 PASSes under 0.1.0. This is pinned by a 1,500-invoice property test.
- 0.1.0 forgives **rounding, not materiality.** A deployment that wants a materiality band declares one as an override
  (`tolerance: {rel, absCap}`), and fix 2 makes the verdict_id commit to it.
- A FAIL the old band would have forgiven says so: *"Not treated as rounding: |variance| 2500 is within 0.03% of
  10000000 but above the rounding cap 1 × 3 steps = 3 (the most rounding can produce on this claim)."*

**2. The tolerance override is part of the input identity.**
- When an override is given, `input_hash` includes its effective form (`rel`, `absCap`, `rounding`, `roundingCap`). Without
  an override, the hash is exactly what it was.
- Replay folds a restated `--tolerance` into the inputs, so an override verdict can still be re-performed. A verdict issued
  before this change (its hash does not include the override) still binds, and still re-performs with the override
  restated. Its identity fields are carried and listed as not re-derived.
- A standing property test covers it: every option that can change an outcome (tolerance, ruleset and version,
  references, source) gives its own `verdict_id`; producer and clock do not.

**3. Mixed kinds are a type mismatch.** `=` and `!=` between a string, a number, a date, a list or a boolean report "Type
mismatch … so they could not be compared". Rule 1 turns that into INSUFFICIENT_DATA (UNPARSEABLE) with the reason, for
example *"CLAIMED_AMOUNT is the text "n/a", VERIFIED_AMOUNT is a number"*. A property test runs every mixed pair through
the kernel, and puts junk into every money field of a correct invoice: nothing FAILs.

**4. Unit prices at full precision.** Unit price and contract rate are read by `normalizePrice`: the same parse as
currency amounts (symbols, locale, signs), never rounded to the cent. Currency totals keep `normalizeAmount` and its cent
rounding, and the declarative engine is untouched (it already had the `price` kind).

**5. Present-but-unparseable is never 0.** In 0.1.0, a junk tax, service charge or discount makes the expected total
UNPARSEABLE, naming the field. A junk subtotal or tax rate is labelled UNPARSEABLE, not missing.

## What it costs, measured (✓, pre-registered)
Four sets, run before and after on the same build path; deterministic, no model calls.

| set | before (invoice 0.0.1) | after (invoice 0.1.0) | what moved |
|---|---|---|---|
| CORD-95: 95 real Indonesian receipts (CC-BY-4.0). **TUNED** (below) | PASS 64 · FAIL 11 · abstain 20 | PASS 66 · FAIL 9 · abstain 20 | 2 false FAILs became honest abstentions (fix 3); see the per-receipt list below. |
| Synthetic Index (11 labelled cases) | 0 false alarms · 0 missed | **1 false alarm** · 0 missed | `rounding-drift` (below). |
| Invoice test fixtures (12) | — | — | nothing |
| Constructed probes (12) | — | — | the R6 variants now FAIL; the "n/a" and sub-cent cases now abstain or decide correctly |

**Every CORD-95 number here is TUNED, never blind.** CORD-95 is the set the invoice default's 0.03% band was originally
set on, and this correction was also adjusted on it (the cash step below). A blind number needs receipts that neither
touched. Each CORD-95 verdict that moved, with the reason:

| receipt | before (0.0.1) | after (0.1.0) | why |
|---|---|---|---|
| `cord-13` | FAIL (SUM_INT) | PASS; SUM_INT abstains UNPARSEABLE | its subtotal was extracted as a list, `["46.636","46.636"]`. A list against a number could not be compared (fix 3). |
| `cord-17` | FAIL (TOTAL_INT) | PASS; TOTAL_INT abstains UNPARSEABLE | its total is written `"Rp. 91,000"`, which does not parse. Text against a number could not be compared (fix 3). |
| `cord-0` | PASS | PASS (unchanged at hand-back) | the rounding cap as first pre-registered FAILed its TOTAL_INT: 1,346,000 + 144,695 + 100,950 = 1,591,645 against a stated 1,591,600, a 45-rupiah cash rounding to the nearest 100. The cash step (S/2 = 50 on the grand total) restores the PASS. |

The rounding cap itself (fix 1) changes **no** CORD-95 verdict as shipped. Its only effect on CORD-95 was `cord-0` in the
first run, and that is what the cash step was added for.

**The misses of the pre-registration, published:**
- **A false FAIL on a real receipt, before the cash step.** The cap as first pre-registered (U × k, without the cash step)
  FAILed `cord-0`, 1 of 95 real receipts, and our pre-registered rule classed it as a design miss. We added the cash step
  (S/2 on the grand total) under a second pre-registration, and it moved exactly that one claim back.
- **A new false alarm on the synthetic Index.** The frozen `rounding-drift` case is labelled CLEAN: its lines foot to
  1,750.10 against a stated subtotal of 1,750.50. The label encodes a materiality rule (a practitioners' 0.05%), not
  rounding: two cent-exact lines cannot round to 40 cents. 0.1.0 FAILs it. We keep the label frozen and publish the false
  alarm, rather than relabel a benchmark after seeing the result.
- **A prediction we got wrong in the safe direction.** We predicted that a wrong line of 130.00 at a unit price of 0.125
  would "stay FAIL". It had been a **false PASS** all along (0.13 × 1,000 = 130.00), and fix 4 is what catches it.

**What did not move:**
- **The accounts-payable headline is unaffected, by construction.** The AP checker (the frozen blind checker, and the
  production AP pack) never reads the invoice ruleset, its tolerance, the kernel or the bridge. We re-ran it anyway, as
  proof:
  - the blind run's per-case output on the new build is byte-identical to the published run (82 of 100 decided, 0 wrong);
  - the audit of 7 published AI configurations still catches 111 of 111 wrong decisions, with 0 wrong auto-payments.
- **The declarative golden.** 5 of its 489 hashes move, all of them `fs-v01/synthetic/*/verify-override` cases, which pass
  a tolerance override. The move is identity-only: with the old `input_hash` and `verdict_id` put back, each of the 5 hashes to its
  old value. No other case moved, and the 177-case e-invoice golden did not move.

## Replay and version notes
- **Invoice 0.0.1 is retained, not rewritten.** It differs from 0.1.0 in two rules (defects 1 and 5), and replays those
  exactly. Its verdicts re-perform under 0.0.1 (`verify replay` picks the version the verdict names).
- ⚠ **Fixes 3 and 4 are engine fixes, and the engine version label did not move.** An old verdict whose input hit them (a
  string/number comparison, or a unit price with more than two decimals) re-performs to a different outcome under this
  build, and replay reports it as FAILED at `outcome`. On our 130-case measurement that is 8 cases, every one of them
  a false FAIL or a false PASS being corrected. We will move the engine label at the next release.
- **A new ruleset version is a new workflow, and an earned rung does not carry over by itself.** A workflow is named
  `<tenant>/<ruleset>@<version>`.
  - A grant earned under `invoice@0.0.1` does not apply to `invoice@0.1.0`. The new workflow starts at *record* until a
    person grants it.
  - Two rules decide this. Only a person moves a rung. And the evidence behind a grant was gathered under the old rules,
    so the rules do not quietly adjust what counts as earned.
  - This holds even though 0.1.0 only tightens: every claim that FAILs under 0.0.1 still FAILs under 0.1.0.
- **Carrying a grant forward will be an explicit, signed act (designed, not built).** A person signs a
  *ruleset-succession* decision naming:
  - the old and the new workflow;
  - the anchored grant in force on the old one;
  - a level no higher than that grant's, and no higher than the policy allows.

  Before it can be signed, the library re-performs the old workflow's recorded verdicts under the new ruleset and attaches
  the difference: how many verdicts changed, in which direction, and which ones. So the person signs knowing which past
  PASSes the new rules would have held. It follows the same doors as a grant:
  - an unanchored signer has no effect;
  - a tier that requires two signatures requires them here too;
  - surveillance continues;
  - any miss under the new workflow is an urgent demotion.

  Nothing carries automatically.

## Not fixed here
- **(b) the lone `d.ddd`.** A lone "1.250" still reads as 1,250 everywhere. On CORD-95, 28 receipts carry such amounts, and
  none of them shows a decimal mark anywhere (1–2 digits after a separator). So reading the document as a whole, rather
  than each value, would keep every current CORD reading, and would let a document that writes "12.50" elsewhere read
  "1.250" as 1.25. The design is written up; it is not built.
- "Rp. 91,000" (a currency prefix ending in a period) does not parse. It now abstains instead of FAILing.
- The declarative engine's fallback tolerance (for a ruleset that declares none) is still the uncapped 0.03%.
  - The shipped `purchase-order` example declares none, so it runs on that fallback.
  - `financial-statement` v0.2 declares `absCap: 0`, an uncapped relative band, by choice.
  - Both are R6's class of problem on the declarative side, and both are queued with their own pre-registration: the
    golden pins their current bytes.
- An unparseable unit price makes MATH_INT abstain with a reason that names the missing evidence reference, not the
  unparseable price.
