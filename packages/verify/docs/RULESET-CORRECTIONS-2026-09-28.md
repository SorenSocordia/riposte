# Published miss: the shipped e-invoice rulesets were wrong (corrected 2026-09-28)

**Honesty key:** ✓ measured · ⚠ inferred · ◇ hypothesis.
**Status:** fixed in this release.

We publish the misses of what we ship. Our three e-invoice rulesets (Peppol BIS 3.0, ZATCA, and KSeF FA(3)) shipped as
0.0.1 with six defects. Five of them could FAIL valid invoices, and at least two could PASS invoices with real errors. All three
rulesets are now at **0.1.0**. Every correction below is sourced from the governing specification. Where no source
states a rule, the check now **abstains with its reason** instead of guessing.

Who was affected: anyone who ran these rulesets on extracted JSON (`verify` with `--ruleset
docs/examples/{peppol-en16931,zatca-ksa,ksef-fa3}.ruleset.json`, or `verifyDeclarative`). The e-invoice twin (XML mode,
added 2026-09-28) was protected by overrides for defects 1–3 and 5, and labelled defect 4's verdicts as house recon. It
was not protected from defect 6.

## What was wrong, and what it did

| # | defect in 0.0.1 | rulesets | effect |
|---|---|---|---|
| 1 | KSeF named two fields FA(3) does not have (`P_13_6`, `P_10_Dodatki`) and omitted four it does (`P_13_8`–`P_13_11`). Its `P_15` sum also read `P_13_6`, while FA(3) splits it into `P_13_6_1`/`_2`/`_3`. | KSeF | **False FAIL** of valid invoices with 0%-rated, intra-EU, export, outside-territory, art. 100 ust. 1 pkt 4, domestic reverse-charge or margin-scheme sales. |
| 2 | No `tolerance` declared, so the engine's default uncapped 0.03% relative band applied, and the 0.01 floor let a one-cent break pass. EN 16931 is exact to the cent. | Peppol, ZATCA | **Missed errors:** a one-cent break of BR-CO-10/13/15/16, or 300.00 on a 1,000,000.00 invoice, PASSed. |
| 3 | The line rule had no line allowance or charge term (BT-136 / BT-141). | Peppol, ZATCA | **False FAIL** of every correct line carrying a line discount or charge. **Missed error:** a discount reported but not applied PASSed. |
| 4 | Two KSeF identities had no primary source: `P_15 = Σ P_13_x + Σ P_14_x`, and a line rule that read `P_10` as a per-unit discount. | KSeF | Verdicts resting on a guess: a **false FAIL** wherever P_15 is not that sum (for example the amount remaining on an art. 106f ust. 3 invoice) or P_10 is a per-line amount, and a PASS that means nothing when the guess happens to agree. |
| 5 | `TAX_AMT` (BT-110) defaulted to 0 when not extracted, but BR-CO-15 requires exactly one BT-110. | Peppol, ZATCA | **False FAIL** of BR-CO-15 on any taxed invoice whose extraction omitted the tax total. |
| 6 | Unit prices were read with the `amount` kind, which rounds to the cent before the line rule runs. EN 16931 sets no decimal limit on BT-146, and FA(3) allows 8 decimals on P_9A. | all three | **False FAIL** of correct lines with sub-cent unit prices (for example 1,000 × 0.123 = 123.00 was read as 1,000 × 0.12 = 120.00). The XML twin was exposed here too. |

Defects 1–4 were found while building the e-invoice twin (design note "The e-invoice structured twin", 2026-09-28, §7). Defect 5
turned up while sourcing BR-CO-15. Defect 6 was found by our own pre-registered measurement: it was a **prediction miss**,
disclosed in the ruleset-corrections pre-registration (frozen 2026-09-28 09:35).

## The fixes and their sources

Sources were fetched on 2026-09-28; local copies are in `tmp/einvoice-specs/`. The R120 and BR-CO-15 rule pages were
re-fetched live, and their texts match the local schematron copies character for character.

**Peppol BIS Billing 3.0 (`peppol-en16931` 0.1.0)**
- BR-CO-10, BR-CO-13, BR-CO-15, BR-CO-16 are **exact to the cent**. The CEN schematron compares with
  `round(x * 10 * 10) div 100` and allows no slack. Every amount involved has at most 2 decimals (BR-DEC-09, -10, -11,
  -12, -13, -14, -16, -17, -18, -23). Fix: `tolerance {rel: 0, absCap: 0}`, and each check has `tol` 0.005 (under one
  cent: any one-cent break FAILs, and binary floating-point noise does not). Sources:
  https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/BR-CO-10/ (and `/BR-CO-13/`, `/BR-CO-15/`, `/BR-CO-16/`);
  `rules/sch/CEN-EN16931-UBL.sch` in https://github.com/OpenPEPPOL/peppol-bis-invoice-3.
- BR-CO-15's test begins `every $Currency in cbc:DocumentCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) eq 1) and …`. BT-110 is required,
  so `TAX_AMT` no longer defaults to 0: an extraction without it abstains (`FIELD_MISSING`) on BR-CO-15.
- PEPPOL-EN16931-R120: *"Invoice line net amount MUST equal (Invoiced quantity * (Item net price/item price base
  quantity) + Sum of invoice line charge amount - sum of invoice line allowance amount"*, tested with
  `u:slack(…, 0.02)`. Fix: `LINE_EXT = QTY * PRICE / BASE_QTY + LINE_CHARGE? - LINE_ALLOWANCE?`, with `tol` 0.020001
  (R120's inclusive 0.02, plus a 1e-6 floating-point margin). Source:
  https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/PEPPOL-EN16931-R120/ and `rules/sch/PEPPOL-EN16931-UBL.sch`.
  The allowance and charge totals are read from `line_allowance_amount` / `line_charge_amount` (also `allowance_amount`,
  `charge_amount`, and the `*_total_amount` names). A line that reports them as an item list (`allowance_charges`,
  `AllowanceCharge`, …) **abstains**, and says why. It is never summed as 0.
- Unit price (BT-146) uses the new `price` kind, at full precision. The CEN rules on BT-146 are BR-26 (present) and
  BR-27 (not negative); no BR-DEC rule limits its decimals.

**ZATCA (`zatca-ksa-en16931` 0.1.0)**, from the *Electronic Invoice XML Implementation Standard v1.2*,
https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf
- BR-CO-10/13/15/16 (p.38) are exact to the cent. §10 Rounding (p.29): *"All document level totals shall be rounded to
  two decimals for accounting"*, half-up, on the final results. The fix is the same as Peppol's: rel 0, `tol` 0.005, BT-110 required
  (BR-KSA-EN16931-08, p.67: one tax total with subtotals).
- BR-KSA-EN16931-11 (p.67) is the same identity as R120, including BT-141 − BT-136. **Line tolerance**, §9.3 (pp.17–18):
  *"The result of Item line net amount = ((Item net price (BT-146) ÷ Item price base quantity (BT-149)) × (Invoiced
  Quantity (BT-129)) must be rounded to two decimals, and the allowance/charge amount are also rounded separately."*
  Only the product is rounded, half-up (§10), so BT-131 is at most 0.005 from the exact formula. Fix: `tol` 0.005001
  (0.005 plus the float margin). ⚠ The standard states no validator slack, and the ZATCA SDK's own schematron was not
  obtained, so whether FATOORA accepts more is unverified.

**KSeF FA(3) (`ksef-fa3-pl` 0.1.0)**, from the MF XSD http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd and the MF
*Broszura informacyjna dotycząca struktury logicznej FA(3)* of 2026-03-04,
https://ksef.podatki.gov.pl/media/jknpcymf/broszura-informacyjna-dotyczaca-struktury-logicznej-fa-3-04032026.pdf
- **Field names:** the bucket set is now the XSD's: `P_13_1`–`P_13_5`, `P_13_6_1`/`_2`/`_3`, `P_13_7`–`P_13_11`,
  `P_14_1`–`P_14_5`. `P_13_6` and `P_10_Dodatki` are gone.
- **`GROSS_INT` is a declared abstention.** Neither source states `P_15 = Σ P_13_x + Σ P_14_x`. The XSD and the
  brochure (p.52) define P_15 as *"Kwota należności ogółem"* (total amount due) and name cases where it is something
  else: the payment documented (advance invoices), the amount remaining (art. 106f ust. 3 invoices), and the correction
  (corrective invoices). So every document gets `INSUFFICIENT_DATA` (`OUT_OF_RULESET_SCOPE`: *declared abstention:
  UNSOURCED…*). The formula stays in the ruleset over the full, corrected bucket set, as the candidate for the day a
  source states it.
- **`LINE_NET_INT` is `P_11 = P_8B × P_9A`.** ⚠ This is sourced by worked example, not by a rule. The brochure computes
  it this way in Przykład 22–23 (pp.100–104): *"cena jednostkowa 90 zł, wartość netto 3 sztuk równa się 270 zł"*,
  including negative correction lines. KSeF itself validates only the XSD (⚠ per validator implementers, cited in
  "E-invoicing cross-document math, primary-source verification", 2026-09-22). The line **abstains when `P_10`, `P_9B` or
  `P_11A` is reported**, with its reason: `P_10` (*"Kwoty wszelkich opustów lub obniżek cen… o ile nie zostały one
  uwzględnione w cenie jednostkowej netto"*, pp.90–91) is not stated as per unit or per line, and `P_9B`/`P_11A` mark
  the gross method of art. 106e ust. 7–8, where the gross price and value may replace the net ones (p.90). `P_9A` uses the
  `price` kind (up to 8 decimals, brochure p.6 pt 6). The 0.02 line tolerance is unchanged; it is a house allowance,
  not a spec value.

## What it costs, measured (✓, pre-registered, CONSTRUCTED set)
Harness: `measureRuleset`. Set: `test/fixtures/einvoice-ruleset-corrections-set.ts`, built from the specs to exercise
these defects. **It is not field data, and it over-represents the defects, so these are not field accuracy figures.**
Pinned by `test/ruleset-corrections.test.ts`.

| ruleset | cases | false-alarm (fp) 0.0.1 → 0.1.0 | missed error (fn) 0.0.1 → 0.1.0 | abstain | `measured_on` (0.1.0) |
|---|---|---|---|---|---|
| Peppol | 18 | 5/10 → **0/10** | 5/8 → **0/8** | 0 → 0 | `1fce0044…` |
| ZATCA | 19 | 5/10 → **0/10** | 6/9 → **0/9** | 0 → 0 | `81ce9e51…` |
| KSeF | 17 | 7/13 → **0/13** | 0/4 → **2/4** | 0 → 0 | `aa7d8000…` |

The KSeF missed-error rise is the price of not guessing. A wrong `P_15` is no longer checked in JSON mode: two ERROR
cases that 0.0.1 caught through the unsourced identity now PASS on their lines alone. One of them 0.0.1 caught only
because it also mis-summed the buckets. We would rather say *"not checked"* than FAIL valid invoices, which 0.0.1 did on
7 of 13 clean cases.

## Engine additions (additive; every other ruleset is byte-identical)
`test/declarative-golden.test.ts` still passes all 489 frozen hashes. Its three e-invoice inputs are pinned to the
0.0.1 bytes, as the engine-identity guard it is.
- `abstain: "<why>"` on a check: a **declared abstention**. The check never decides; the detail is
  `declared abstention: <why>`.
- `guard_reason: "<why>"` on a check: appended to the detail of whichever abstain guard fires.
- Field kind `price`: a unit price at full precision. A JSON number or a plain decimal string is exact. A formatted
  string that would have to be rounded is `UNPARSEABLE`, never rounded.
- `sources` on a ruleset: key → URL. It is documentation only (hashed with the ruleset, never evaluated).

## Not fixed here
- ◇ The ZATCA validator's real line slack (the ZATCA SDK schematron was not obtained).
- The meaning of KSeF `P_10`. The lines that report it abstain.
- The one identity the MF brochure *does* state, `DoZaplaty = P_15 + Σ Obciazenia − Σ Odliczenia` (pp.105–106), is
  not yet a check. When the item lists are reported without their sums, it needs a conditional guard to stay honest.
- Allowance and charge **item lists** on a line are not summed, so those lines abstain.
- `docs/examples/purchase-order.ruleset.json` reads `LINE_PRICE` as `amount` too, so it has defect 6. It is outside this
  correction.
