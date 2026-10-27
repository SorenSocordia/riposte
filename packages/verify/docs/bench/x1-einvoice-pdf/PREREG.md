# X1 pre-registration: e-invoice PDFs, extraction first, then the deterministic check

Written 2026-10-03, after the corpus was rendered and BEFORE any extraction or verify run on it. This file is hashed; the hash
is recorded in `PREREG.sha256` and in the sprint report. The first run (`out/run1`) is the headline. Anything changed after
seeing it is a separate, labelled run and never replaces the blind number.

## 1. The question
When an e-invoice arrives as a rendered PDF and an extractor (the step a model does in the real-world path) reads the fields
first, does verify's deterministic Peppol BIS Billing 3.0 / EN 16931 check still catch the planted defects? And how often does
extraction noise turn into a **wrong PASS** (the dangerous case) rather than an **ABSTAIN** (the designed case)?

## 2. What runs (fixed now)
- **Corpus**: `corpus/manifest.json` (sha256 `c6807187e43961303f9541b821b0da787e300c97661f8c44c75ed5bab44c8021`), 60 PDFs rendered
  deterministically (each rendered twice, byte-identical) per `corpus/render-receipt.json` (sha256
  `1fefac4cccb98873ccbf8cfd745fa5fe5171d552cda7dc39ba036f3dff632a71`). 27 public Peppol BIS 3.0 UBL Invoice samples are the bases
  (OpenPEPPOL examples and snippets, three CIRF MIT PEF templates); the truth of every PDF is its UBL plus the declared
  perturbation. 20 clean, 20 with one planted defect, 20 with rendering noise.
- **Extractor (frozen before the manifest existed)**: `lib/extract.mjs` sha256 `470fb72882fd280d378bc75a05742b5bdb25dcda8a72fb07c3b8636e3a11576b`.
  The text layer is read with pdfjs-dist 5.4.296. A page without one goes through poppler at 300 dpi, then Tesseract 5.4.0 (LSTM OCR, CPU),
  then a deterministic label-anchored parser with the strict-parse safety rule. It was developed only on `dev/` (three
  synthetic invoices × five modes), and a determinism check showed two runs byte-identical. **No language model runs:** the
  Qwen3.5-0.8B server on :8791 exposes only `/health` and `/decide` (scoring), with no completion route
  (`workspace/jev-spike/serve.py` lines 107–111). The model-extraction step is **NOT RUN** in this sprint.
- **Rulesets**: (P) the SHIPPED `products/verify/docs/examples/peppol-en16931.ruleset.json` 0.1.0 (sha256
  `0a3cd5a52e6a835a8649ac8fa831bce47906ae77e5be2bdb85a70d1a9a0cd81c`), unchanged; (S) the X1 supplement
  `rulesets/x1-supplement.ruleset.json` 0.1.0 (sha256 `af4956020143fdc92fd3f26ee1ce8c60ebb72a506f6fb7e3cbe69f1ea8a6c607`). The supplement was written
  now, before the run, from the schematron text: BR-02, BR-03, BR-05, BR-15 presence, PEPPOL-EN16931-R051 currency, and BR-CO-14
  VAT sum. It is a house supplement, not a shipped ruleset.
- **Engine**: verify's CLI `products/verify/dist/cli.js` (sha256 `60d9d0f737cd33305c85447441c87d153aedb6c2c22cef96761a773482d8c522`),
  read-only, run as `verify <extraction.json> --ruleset <r> --source <extracted text> --quotes <raw strings> --gate`.
  `run.mjs` also pins the dist files it uses at start and end and reports any drift.
- **Harness**: `run.mjs` sha256 `82e533959b23462caae11f52d30a1308f3c09f9bb806c98cde5eace0c9cc885c`, `score.mjs` sha256
  `103df3794cffabc204e089686990d2b6f36050a1a3ac0d08bab9e1a0c2149264`.

## 3. Definitions
- **Decision** = the gate reading (CLI `--gate` exit): 0 PASS · 1 FAIL · 2 ABSTAIN (PASS-WITH-OPEN or INSUFFICIENT_DATA).
  The **primary** decision uses the shipped ruleset (P) alone. The **secondary** decision combines P and S: FAIL if either
  fails; otherwise ABSTAIN if either abstains; otherwise PASS.
- **Oracle** = the same CLI on the printed truth (a perfect extraction of the same PDF).
- **Planted arm**: FAIL = caught · ABSTAIN = abstain (a person looks) · PASS = **wrong PASS**. The cause of each wrong PASS
  is "ruleset gap" if the oracle also PASSes. Otherwise it is "extraction error".
- **Clean and noise arms** (truth: a valid invoice). PASS is a **wrong PASS** if any field the ruleset reads was extracted
  wrong, was invented, or is missing where the ruleset substitutes a default that differs from the truth. PASS is also a
  wrong PASS if the oracle does not PASS. Every other PASS is a correct PASS. FAIL while the oracle PASSes is a **false
  FAIL**. ABSTAIN is an abstain.
- **Coverage** = decided (PASS or FAIL) / documents. **FAIL precision** = FAILs on planted documents / all FAILs.
- **Twin secondary** (the build-map X1 card): `verify twin-einvoice <base UBL> --claims <extracted values>` per document.
  On the clean and noise arms, a claim is correct if its value equals the printed truth (= the UBL). The card's bar is
  false FAILs on correct claims under 2%. On the planted arm, the twin is judged on whether it flags the planted field,
  because the PDF disagrees with its own XML there.
- Intervals: Wilson 95%.

## 4. Bars
- **B1 (primary, the lead's bar): 0 wrong PASS on the 20 planted defects**, under the shipped ruleset. The same count is
  reported under P+S.
- **B2: no bar.** ABSTAIN rate on the noisy third is reported with coverage.
- **B3 (card): twin false FAILs on correct claims < 2%.**
- Wrong PASS on the clean and noise arms has no numeric bar. Any count above zero is reported as a headline miss with
  its cause.

## 5. Predictions (written before the run, so a miss is visible)
- Shipped ruleset on the planted arm:
  - **Caught**: line_math 4/4 and payable 4/4.
  - **Wrong PASS from ruleset gaps**: vat_subtotal 0/4 caught (no BR-CO-14 check), currency 0/4 caught (no currency
    check), and missing BT-1, BT-2, BT-5 PASS, about 11 in all.
  - **Abstain**: missing BT-115.
  - So I expect **B1 to fail for the shipped ruleset**.
- P+S on the planted arm: 0 wrong PASS. The four missing-field documents abstain, and the other 16 are caught.
- Clean arm: 20/20 correct PASS. It is a vector text layer read by a template extractor, so it is an upper bound, not a
  generalisation claim.
- Noise arm:
  - Two-column: 5/5 correct PASS.
  - Raster (15): mostly ABSTAIN. A few false FAILs are possible, from partial occlusion leaving a strictly parseable wrong
    number.
  - Wrong PASS: I expect 0, but this is the open question.
- Twin: 0 false FAILs on correct claims.

## 6. Reporting rules
- Every number comes with its command. The first run is the headline, as is.
- **Hand audit**: every FAIL, and every PASS on the noisy third. I read the PDF and compare it with the extracted JSON.
  Every wrong PASS is listed with its cause.
- If the extractor or a ruleset is changed after the run, that run is labelled TUNED and the blind numbers stay as the
  headline.
- Licence: the derived PDFs stay in this private workspace and are never exported. Planted defects exist only in derived
  PDFs; no UBL file was modified.
