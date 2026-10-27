# T2 corpus run, pre-registration (2026-10-03; written after the compile and its hand review, before any corpus run)

Sprint prereg: PREREG.md (`fe5cb8c4…eb29`), addendum 1 (`67c0f96f…2af2`). Not blind: I know the corpus, its 20 planted
defects, and X1/R4's earlier results on it (X1 run 1, R4's post-hoc 0.2.0 run). The compiler was not tuned on the corpus;
its alias file maps business terms to the extractor's keys and carries no labels.

## What runs

- **Corpus:** the 60 e-invoice PDFs of `workspace/receipts-spike/einvoice-pdf/corpus/` (20 clean, 20 planted defects,
  20 noisy), read-only. Manifest sha256 pinned by the run receipt.
- **Extractor:** X1's blind extractor, `lib/extract.mjs`, imported unchanged from X1's folder (sha pinned by the receipt).
  Its 60 extractions are compared byte for byte with X1's run 1 (R4 found them identical).
- **Harness:** `tmp/riposte-t2-xr/run-t2.mjs` (sha256 `94eea314…0999`) and `score-t2.mjs` (`efbe8dd8…b59d`), copies of X1's
  run.mjs and score.mjs (kept beside them as run.orig.mjs / score.orig.mjs) with the paths changed, the twin removed, and
  the arms below; RIPOSTE_LEDGER and RIPOSTE_HOOK_MODE stripped from every child; windowsHide on every spawn.
- **Engine:** `products/verify/dist` as rebuilt by this lane (cli.js `4c0b9a5e…fe87`, declarative/evaluate.js `afa10979…0864`).

| arm | ruleset (workspace/receipts-spike/standards-compiler/out/) | sha256 | what it is |
|---|---|---|---|
| xr_cius | xrechnung-cius.ruleset.json | `f6e9cf57…563a` | the XRechnung UBL schematron alone (v2.6.0 pin), complete structure, aliases |
| xr_profile | xrechnung-profile.ruleset.json | `949e5812…0ea4` | CEN EN16931 + XRechnung (the CIUS as validated: core + CIUS rules), unscoped |
| xr_profile_x1scope | xrechnung-profile-x1scope.ruleset.json | `27973e98…4fc4` | the same, compiled with `--scope aliases`: only checks on terms the extractor reads |
| peppol_compiled_x1scope | peppol-compiled-x1scope.ruleset.json | `dc3cf761…6354` | reference: CEN + Peppol recompiled, R4's TSV, scoped the same way |

The CEN file is the one pinned at the Peppol commit (v1.3.15); KoSIT's XRechnung validator bundles its own EN16931
release, so xr_profile approximates the validator's rule set, it is not byte-for-byte KoSIT's.

## Metrics (X1's definitions, kept)

Gate decision from the CLI exit: 0 PASS, 1 FAIL (HELD-SUSPECT books as FAIL), 2 ABSTAIN (PASS-WITH-OPEN). Planted:
caught (FAIL) / abstain / WRONG PASS. Clean and noisy: correct PASS / WRONG PASS (a PASS with a field the arm reads
extracted wrong, or the oracle not PASS) / false FAIL (FAIL where the oracle PASSes) / abstain. Wilson 95% intervals.
Every wrong PASS is reported by document id.

## Predictions (per arm, per defect type; with the reason)

The planted defects are Peppol-shaped: line_math is PEPPOL-EN16931-R120, currency is PEPPOL-EN16931-R051 (BT-5 changed,
the amounts not), vat_subtotal is BR-CO-14, payable is BR-CO-16, missing removes BT-1, BT-2, BT-5 or BT-115.

| arm | line_math (4) | vat_subtotal (4) | payable (4) | currency (4) | missing (4) | clean (20) | noisy (20) |
|---|---|---|---|---|---|---|---|
| xr_cius | 4 abstain | 4 abstain | 4 abstain | 4 abstain | 4 abstain | 20 abstain | 20 abstain |
| xr_profile | 4 abstain | 4 caught | 4 caught | 4 abstain | 4 abstain | 20 abstain | abstain except the FAILs below |
| xr_profile_x1scope | **4 WRONG PASS** | 4 caught | 4 caught | **4 WRONG PASS** | 4 abstain | 17 PASS, 3 abstain (C16, C17, C19) | see below |
| peppol_compiled_x1scope | 4 caught | 4 caught | 4 caught | 4 caught | 4 abstain | 17 PASS, 3 abstain | see below |

Reasons:
- **xr_cius** has no arithmetic and reads BT-10, BT-37/38, BT-41..43, BT-52/53, which the extractor never reports, so every
  document is held open; it cannot PASS and cannot catch a Peppol-shaped defect. None of the planted defects breaks an
  XRechnung (BR-DE) rule as an extraction can show it. Should catch: none. Wrong PASS: 0 (nothing passes).
- **xr_profile** adds EN 16931: BR-CO-14 and BR-CO-16 catch vat_subtotal and payable. It also requires fields the
  extractor never reports (BT-24, BT-3, BT-40, BT-55, BT-10, …), so nothing PASSes.
- **xr_profile_x1scope** is what this extractor can be held to. **line_math: should NOT be caught** (no line-math rule in
  EN 16931 or XRechnung; R120 is Peppol's). **currency: should be caught by the profile and will not be:** in XML, BR-CO-15's
  conjunct `count(cac:TaxTotal/cbc:TaxAmount[@currencyID = BT-5]) eq 1` fails when BT-5 differs from the amounts'
  currency; the compiler leaves that conjunct uncompiled (cardinality), so this is a **compiler miss**, predicted, not a
  profile limit. missing: presence abstains (never FAIL). Clean: the three template documents lack an issue date (BR-03).
- **peppol_compiled_x1scope** catches line_math (R120) and currency (R051, one check per document total, all aliased to the
  totals' currency). X1-D15 (BT-5 absent) abstains: R4's 0.2.0 caught it only because the extractor invented SEK; the
  compiled R051 needs BT-5 and abstains, and the compiled BR-CL-03 accepts SEK as a valid code.
- **Noisy documents** (both scoped arms, from X1 run 1's extraction errors): false FAIL expected on X1-N06 (amount_currency
  read as `CEN`: BR-CL-03 in both arms, R051 in the Peppol arm) and X1-N20 (BR-CO-10; R120 too in the Peppol arm); likely
  on X1-N02, N03, N10 (an optional total missing from the extraction counts as 0, since the compiled labels are the BT names,
  not the renderer's wording); possible WRONG PASS on X1-N07 (invoice number misread, which a presence check passes) and on
  X1-N18 (allowance and charge both missing would cancel in BR-CO-13; held open if BR-CO-14 abstains as in run 1).
  xr_profile: FAIL on the same documents where a decisive check fails, else abstain.

## Bars

- **R1.** Every WRONG PASS on a planted defect is of a type predicted above (line_math or currency in xr_profile_x1scope);
  any other is a miss, reported by id.
- **R2.** No WRONG PASS on a clean document in any arm.
- **R3.** Noisy WRONG PASS only among the candidates named above (N07, N18); any other is a miss, reported by id.
- **R4.** The extractions equal X1 run 1's byte for byte (60/60), or every difference is listed.
- Everything else is descriptive. A compiler fix after this run is post-hoc: labelled, re-run, reported as non-blind.
