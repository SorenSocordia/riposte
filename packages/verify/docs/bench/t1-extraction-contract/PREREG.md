# T1 pre-registration: the extraction contract (2026-10-03)

Written 2026-10-03 at about 14:05 local, BEFORE any code for this sprint exists and before any contract reader has touched
a corpus document. This file is hashed into `PREREG.sha256` before the first line of code. The first corpus run of the
frozen extractor (`out/c1`) is the headline. Anything changed after seeing it is a separate run labelled TUNED and never
replaces the c1 numbers.

**Not blind.** I have read X1's and X2's reports, RESULTS files and per-document outcomes (which documents abstained and why,
the noise kinds, D15, N18, the soft hyphen in CT11). The design below is informed by them. What is held back is the run: no
contract reader is run on any X1 corpus PDF or X2 decision PDF before the freeze in §8.

## 1. The question

Every miss this week originated between the page and the fields (N18's unreadable totals, D15's invented currency, X2's soft
hyphens and line-break hyphenation). If every extractor must hand verify fields that (a) use the ruleset's own field terms,
(b) carry provenance, (c) were read two ways and agreed, and (d) were never guessed, does verify's verdict get safer and
more decisive on the same corpora? Concretely: does the planted/known-bad wrong-PASS count stay 0, do the noisy abstentions
fall, does correct PASS rise, and does false FAIL stay where it was?

## 2. What is built (products/verify, opt-in)

1. **Schema per ruleset, generated.** `extract-schema <ruleset>` (CLI verb `verify extract-schema`, exported as
   `riposte-verify extract-schema`) emits a JSON Schema (draft 2020-12) for one ruleset's extraction:
   - one property per field term of the ruleset's `fields` block (the role names: `PAYABLE`, `TAX_EXCL`, ...; each
     property's description carries the field's `term`, e.g. "BT-115 Amount due for payment");
   - document fields under `fields`, line fields under `lines[]`;
   - each value typed by field kind (amount/price/quantity/rate: a number or the marker `"UNREADABLE"`; identifier and
     string: a non-blank string or the marker; bool: a boolean or the marker);
   - a required provenance object per field;
   - every field accounted for: present, or named in `not_printed` with the labels searched;
   - no unknown field terms (a misspelt term is refused, not ignored).
   The legal ruleset has no `fields` block; its citation parts (`quote`, `proposition`, `cite`, `case_name`,
   `source_key`) are declared once in the extract module and get the same treatment.
2. **`require_contract: true`**, a new opt-in declarative ruleset flag (default OFF this sprint, E1's flag precedent). With it,
   verify refuses an extraction that does not validate against the ruleset's generated schema: no check runs, the verdict is
   INSUFFICIENT_DATA, and a typed remedy names the first violation (its JSON Pointer and what is wrong). Without the flag
   nothing about verify's reading moves. A contract envelope handed to a ruleset without the flag is lowered to the
   extraction shape the ruleset reads (engine 0.1.0 only; engine 0.0.1 never sees an envelope), so verdicts already issued
   keep their bytes.
3. **Provenance per field.** Every value carries `{page, line, raw, reader}`: `raw` is the exact string the reader read,
   `reader` names the reader (or both readers, when two agreed). An UNREADABLE value keeps both readings. A legal reference
   key the page does not print (`cite`, `case_name`, `source_key` come from the citation resolver) carries
   `{reader: "supplied", source}` instead; that is the only provenance shape without a page.
4. **Two readers; disagreement marks UNREADABLE** (§4). No third reader breaks a tie.
5. **Nothing invents** (§5).

## 3. Readers (fixed now)

- **Text layer:** pdfjs-dist 5.4.296 (`getTextContent`), words split from text items as X1's extractor does.
- **OCR:** poppler 25.07.0 `pdftoppm` renders the page; Tesseract 5.4.0 (LSTM, `eng`) reads it (`tsv` word boxes). Tesseract's
  own line grouping (block.paragraph.line) gives rows on OCR; text-layer rows are clustered by baseline (X1's rule).
- **Which two:** a page whose text layer carries 20 or more words is *born-digital*: its readers are the text layer and
  OCR-A. A page with fewer is a *scan*: its readers are OCR-A and OCR-B.
- **OCR-A** = 300 dpi, `--psm 6`. On a scan, orientation is detected first (`--psm 0`) and the page is turned upright before
  both OCR settings, identically.
- **OCR-B** and any page preprocessing (candidates fixed now: dropping saturated colour ink, e.g. a red stamp, by reading the
  page's lightest channel; a higher render resolution; `--psm 4`) are chosen on the **dev set only** (§8) and frozen in
  `FREEZE.md` before the first corpus run. Whatever is chosen applies to every page of its class, never per document.
- Every child process (pdftoppm, tesseract) is spawned with `windowsHide: true`, `RIPOSTE_LEDGER` and `RIPOSTE_HOOK_MODE`
  stripped from its environment, one at a time, and its temporary files are removed.

## 4. Canonicalization and agreement (fixed now)

**Canonicalization** (applied identically to every reading before comparison, and to reference texts handed to verify):
Unicode NFC; soft hyphen U+00AD removed (a soft hyphen at a line end joins the two lines' words); line-break hyphenation
(a hyphen ending a line, directly after a letter, followed by a line starting with a lower-case letter, is removed and the
words joined); curly quotes and primes to straight `'` and `"`; typographic dashes (U+2010–U+2015, U+2212) to `-`; the
ligatures ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ to their letters; the ellipsis character to `...`; every whitespace run to one space, trimmed.
Nothing else (no case folding, no character repair such as O→0 or l→1).

**Numbers** (amount, price, quantity, rate kinds): a reading is a number only if its raw string reads strictly by E1's rule
(`isStrictNumberTextV010`) AND by the document's own decimal separator (detected per reader, as X1 does: the separator most
amounts on the page use; amounts need exactly two decimals; grouping must be valid). Two numeric readings agree iff both
parse and are equal.
**Strings** (identifier, string kinds): agree iff equal after canonicalization.

**Per field, per document:**
| reader 1 | reader 2 | contract value |
|---|---|---|
| value v | value v (agrees) | v, provenance from reader 1 with both readings recorded |
| value v | value w ≠ v | `"UNREADABLE"`, both readings kept |
| value | label found, value does not parse | `"UNREADABLE"`, both readings kept |
| value | label not found | `"UNREADABLE"`, both readings kept (printed per one reader) |
| label found, unparseable | label found, unparseable | `"UNREADABLE"`, both readings kept |
| label not found | label not found | ABSENT: key omitted, `not_printed` lists the labels searched |

Line items are aligned between readers by their printed line id, else by position; a line one reader has and the other
does not has every field UNREADABLE. VAT breakdown rows align by position.

**Legal quotations** (X2): the item's manifest string is a *pointer* (which passage), not the value. Each reader's words for
the decision PDF are aligned to it (semi-global token alignment over canonical tokens: every pointer token aligned, the page
window free; match 0, substitution 1, gap 1; a skipped page token that is a 1–3 digit number or sits in the top or bottom 7%
of the page costs 0, as a line number, footnote call or running header). The text layer's window is located iff its cost is
at most max(2, 10% of the pointer's tokens). Its reading is the window's tokens minus skipped artifacts, the first and last
token trimmed to the pointer's token when they contain it (opening/closing quote marks). OCR-A reads the window's page(s) and
is aligned to the text layer's reading the same way. Agreement iff the two readings' canonical tokens are identical. The
value handed to verify is the agreed reading. Not located, or disagreement, makes the quotation UNREADABLE: the legal check
is not handed a guess, and the item is recorded as ABSTAIN (contract: unreadable quotation), with both readings.

**Reference texts** (the opinions, X2): not fields, so not dual-read this sprint. They are X2's stored texts (pdftotext for
CourtListener PDFs, CAP's JSON text), canonicalized as above and recorded with reader and sha256. This is a stated limit.

## 5. Nothing invents (fixed now)

- A field no reader finds is ABSENT with a `not_printed` note listing the labels searched. It is never guessed, never filled
  from another row, never defaulted by the extractor (verify alone applies a ruleset `default`, and only to an absent field).
- **Labels** are the ruleset's own `labels` (Peppol 0.2.0's lists, R4's: BT names plus common printed phrasings). The X1
  renderer prints every document-level phrasing already on those lists, so **no label is added**. A label must head its row
  segment (start of the row, or after a gap of more than 15 pt) and be maximal (a following lower-case word continues a
  longer label, so it is not a match): "VAT total in accounting currency" is never "VAT total", and "currency" inside a row is
  never the "Currency" label. OCR tolerance: a label word of 5 or more characters may differ by one edit (X1's rule).
- **Currency:** BT-5 (`DOC_CURRENCY`) only from its own labelled row; the totals' currency (`AMOUNT_CURRENCY`) only from an ISO
  code or an unambiguous symbol (€ → EUR, £ → GBP; `$`, `¥` and others are ambiguous and read as nothing) printed on the
  amount-due row, else on the other totals rows, never from the "VAT total in accounting currency" row (BT-111, R051's
  exception). Totals rows carrying two different codes make `AMOUNT_CURRENCY` UNREADABLE. Otherwise it is ABSENT.
- **Layout-specific readers** (line-item table, two-column "Line N:" blocks, VAT breakdown table) live in the workspace as a
  plugin for the X1 renderer's two layouts, ported from X1's extractor with its published TUNED fixes T1b and T2 (T3 is
  subsumed by the contract). Their column and row phrasings are the X1 renderer's (`lib/render.mjs`): `#`, `Item`, `Qty`,
  `Unit`, `Price`, `Per`, `Allow.`, `Charge`, `Net`, `VAT`; `Line <id>:`, `Qty:`, `Price:`, `Per:`, `Allow.:`, `Charge:`,
  `Net:`; `VAT breakdown`, `Category`, `Rate`, `Taxable amount`, `VAT amount`, `Taxable:`, `VAT:`. T1b and T2 were found on
  this corpus, so the contract run is not independent of them.

## 6. Runs

All runs use the verify build as it stands when frozen (dist recorded in FREEZE.md), `RIPOSTE_LEDGER`/`RIPOSTE_HOOK_MODE`
stripped.

**X1 (60 PDFs, manifest sha256 `c6807187e43961303f9541b821b0da787e300c97661f8c44c75ed5bab44c8021`, read-only).** Harness =
copies of X1's `run.mjs`, `score.mjs`, `lib/compare.mjs` in `workspace/receipts-spike/extraction-contract/`, with paths
changed and the extractor swapped; the copies are diffed in the report.
- **c1 (headline):** contract extractor → envelope → validated against `extract-schema peppol-en16931` → lowered → verify CLI
  `--ruleset peppol-en16931` (0.2.0 by name, engine defaults) `--source <reader-1 page text, canonical> --quotes <the raw
  strings of agreed fields> --gate`. Oracle = the same CLI on the printed truth. Decisions and classes exactly as X1's
  PREREG §3 (gate reading; wrong PASS, correct PASS, false FAIL, abstain), using 0.2.0 alone (R4 showed 0.2.0 alone equals
  X1's shipped+supplement decision for decision).
- **B0 (baseline, same verify):** X1's blind run-1 extractions, sources and quotes, as stored in X1's `out/run1/extract/`,
  re-verified under the same build and ruleset. B0 isolates the extractor: same engine, same ruleset, same protocol.
- **Contract consistency:** every c1 envelope through a copy of 0.2.0 carrying `require_contract: true` must give the same
  decision as c1; every B0 extraction through that copy must be refused (ABSTAIN, typed remedy naming the first violation).

**X2 (58 items, manifest sha256 `f23c549714d166e05a6cd14c62b4a180aaf992d75142aaf62719da7d61492938`, read-only).**
- **c1:** for each item, the quotation (or proposition) is read off the decision PDF by the two readers (§4); `cite`,
  `case_name`, `source_key` are supplied keys; the reference text is canonicalized (§4). `verifyCitations` through the built
  library, `legal@0.0.1` (the default). An UNREADABLE quotation is recorded ABSTAIN without a call.
- **B0:** X2's manifest as stored (its quote strings, its reference texts) under the same build and `legal@0.0.1`.
- Sets: known-bad (20), controls (20), supplementary (18), as X2.

## 7. Bars

| id | bar | kind |
|---|---|---|
| H1 | X1 planted: wrong PASS = 0/20 under c1 | **hard** |
| H2 | X2 known-bad: PASS = 0/20 under c1 (supplementary 18 reported the same way) | **hard** |
| H3 | X1 noisy arm: of X1's 8 noisy abstentions (run 1, shipped: N02, N03, N06, N07, N10, N11, N14, N18), at least 4 are correct decisions under c1 | target |
| H4 | X1 noisy arm: correct PASS under c1 > B0; abstentions under c1 < B0 | target |
| H5 | false FAIL does not rise anywhere: X1 clean and noise c1 ≤ B0 each; X2 controls FAIL on genuine quotations c1 ≤ B0 (X2's audit classes) | target |
| H6 | every c1 envelope (60) validates against its generated schema; the `require_contract` copy gives c1's decision on 60/60 and refuses 60/60 B0 extractions | target |
| H7 | D15: `DOC_CURRENCY` is ABSENT or UNREADABLE, never a value; D15's decision does not rest on an invented currency | target |
| H8 | X2: fabricated 5/5 and propositions 2/2 abstain | target |
| E | verify suite green; `tsc --noEmit` clean; dist rebuilt; export dry run ends `scan clean`; every bundle under `workspace/receipts-spike/*/results/bundles/` (and `tmp/riposte-x2b/results/bundles/`) replays byte-identical | engineering |

Wrong PASS on X1's clean and noise arms has no numeric bar: any count above 0 is a headline miss, reported by document id.

## 8. Development and freeze

- Code is developed on synthetic documents only: X1's `dev/` set (3 synthetic invoices × 5 modes, rendered by X1's renderer,
  never corpus bases) plus synthetic legal pages I render in `dev/` here (quotations with line-break hyphenation, soft
  hyphens, curly quotes, running headers, line numbers). No corpus PDF is opened by contract code before the freeze.
- OCR-B and preprocessing (§3) are chosen on the dev set by one rule: the setting under which the most dev fields agree with
  the dev truth, with 0 agreed wrong values; ties go to the simpler setting.
- `FREEZE.md` records the sha256 of every `products/verify/src/extract/*` file, the built `dist/` files the run uses, the
  workspace plugin and harness files, and the chosen settings. The c1 harness checks those hashes at start and at end and
  refuses to run on a mismatch.

## 9. Predictions (written before any code, so a miss is visible)

- **H1, H2 hold.** The contract only moves fields toward UNREADABLE or toward a value both readers agree on.
- **Clean arm (X1):** text layer and OCR-A agree on nearly every field of a born-digital page: 20/20 decided, with the
  template placeholders `#issue_date#` (C16, C17, C19) now read as identifiers by both readers, so BR-03's presence check
  passes and those three move from ABSTAIN to PASS. That would be a correct PASS under X1's definition (the printed truth is
  the placeholder). It is reported as a presence-only pass on a template, not as an improvement in reading.
- **Planted arm:** 16 caught, 4 abstain (the four missing-field documents, D15 now abstaining on an ABSENT BT-5).
- **Noisy arm:** two-column 5/5 decided; stamp: some of the 5 become correct PASS only if colour dropout recovers the stamped
  value on both OCR settings, otherwise they stay ABSTAIN with UNREADABLE named; low resolution: the strictest arm, where
  the two settings may disagree more than one reader failed before, so abstentions there may rise; rotated: 4 or 5 correct
  PASS, N20's 1→4 misread becomes UNREADABLE if the two settings disagree (false FAIL → ABSTAIN) or stays a false FAIL if
  both misread it the same way. My guess for H3: met narrowly (4 or 5 of 8), carried by the stamp documents. H4 likely met
  on correct PASS; abstentions may not fall overall if low resolution gets worse.
- **X2:** B0 reproduces X2's blind outcomes. Under c1 most quotations are read identically by both readers; some longer ones
  (footnote calls, section signs, italics) disagree and abstain. Decisions move only toward ABSTAIN; the soft hyphen in
  CT11's reference text is removed but CT11 still FAILs under legal@0.0.1 (its ellipsis and nested marks remain). H5 for X2
  holds trivially if moves are only toward ABSTAIN.

## 10. Reporting rules

- Every number with its command; c1 is the headline; tables report Wilson 95% intervals as X1 and R4 did.
- The field-move list: every (document, field) that moved between B0 and c1 — wrong value → UNREADABLE, absent → value,
  correct value → UNREADABLE, any wrong value in c1 — by id. X2: every quotation whose value differs from the manifest
  string, and every reference text canonicalization changed.
- D15's status stated on its own line.
- A wrong PASS is reported by document id, never averaged away.
- Misses printed in the same tables as hits.
