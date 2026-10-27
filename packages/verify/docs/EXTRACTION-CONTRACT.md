# The extraction contract (0.1)

verify is strong once the fields exist. It is only as good as whatever reads the page and hands the fields over. The
extraction contract is the pre-pass an extractor must satisfy before verify reads its output, when a ruleset asks for it.

It has four rules:

1. **The ruleset's own field terms.** An extraction fills the terms of the ruleset's `fields` block (for Peppol, `PAYABLE`,
   `TAX_EXCL` and the rest, each carrying its BT number), never free-form keys. The schema is generated from the ruleset, so
   a new ruleset gets its schema for free.
2. **Provenance on every value.** Each value carries `{page, line, raw, reader}`: where it was read, the exact string read,
   and which reader read it.
3. **Two readings; a disagreement is unreadable.** The reference extractor reads every field twice. When the readings
   disagree, the value is `"UNREADABLE"` with both readings kept. No third reader breaks a tie.
4. **Nothing invents.** A field the page does not print is absent. Its key is left out and `not_printed` names the labels
   searched. It is never guessed, and a currency is read off the page or not at all.

## The schema

```bash
verify extract-schema peppol-en16931            # JSON Schema (draft 2020-12) for that ruleset's extraction
verify extract-schema ./my-ruleset.json         # any declarative ruleset
verify extract-schema legal                     # the legal citation check's citation parts
verify extract-schema peppol-en16931 --validate envelope.json   # check an envelope; exit 1 lists the violations
```

The library has the same functions: `extractionSchema(ruleset)` and `validateContract(envelope, ruleset)`.

An envelope looks like this:

```json
{
  "extraction_contract": "0.1",
  "ruleset": "peppol-en16931@0.2.0",
  "document": { "sha256": "…", "pages": 1, "route": "born-digital", "readers": ["pdf-text-layer", "ocr-a"] },
  "fields": {
    "PAYABLE": { "value": 8350, "provenance": { "page": 1, "line": 31, "raw": "8,350.00", "reader": "pdf-text-layer+ocr-a",
      "line_text": "Amount due for payment EUR 8,350.00",
      "readings": [ { "reader": "pdf-text-layer", "raw": "8,350.00" }, { "reader": "ocr-a", "raw": "8,350.00" } ] } },
    "TAX_EXCL": { "value": "UNREADABLE", "provenance": { "page": 1, "line": 29, "raw": "8,O00.00", "reader": "ocr-a+ocr-b",
      "readings": [ { "reader": "ocr-a", "raw": "8,O00.00", "note": "does not read strictly as a number" }, { "reader": "ocr-b", "raw": "8,000.00" } ] } }
  },
  "not_printed": { "PREPAID": { "labels_searched": ["Paid amount", "Prepaid amount", "Amount paid"] } },
  "lines": [ { "fields": { "LINE_EXT": { "value": 4000, "provenance": { "page": 1, "line": 14, "raw": "4,000.00", "reader": "pdf-text-layer+ocr-a" } } },
               "not_printed": { "BASE_QTY": { "labels_searched": [] } } } ]
}
```

What the schema requires:

- **One property per field term**, typed by the field's kind. Amount, price, quantity and rate values are numbers.
  Identifier and string values are non-blank strings. A bool is `true` or `false`. Any kind may instead be the marker
  `"UNREADABLE"`.
- **A provenance object on every value**, with `page` and `line` (1-based integers), `raw` (a string) and `reader`.
- **The readings that were seen**, on an `"UNREADABLE"` value.
- **Every field accounted for**: either read, or named in `not_printed`.
- **No unknown term.** A misspelt term is refused, not ignored.

The legal ruleset's citation parts work the same way. The `quote` and `proposition` are read off the page. The `cite`,
`case_name` and `source_key` come from a citation resolver, so they may carry `{ "reader": "supplied", "source": "…" }`
instead of a page and line.

### List fields (2026-10-03)

A ruleset field with `each` reads every element of a list (Peppol 0.3.0's `VBD_TAX`: every VAT breakdown row's tax amount).
Under the contract it is an array: one item per element, in printed order, each item its own `{ value, provenance }` (an
`"UNREADABLE"` item keeps its readings, like any field), at least one item. A list the page does not print is named in
`not_printed`. Lowering puts each item at the field's first path inside its element of the list's first array path:

```json
"VBD_TAX": [ { "value": 300, "provenance": { "page": 1, "line": 30, "raw": "300.00", "reader": "pdf-text-layer+ocr-a" } },
             { "value": 31.25, "provenance": { "page": 1, "line": 31, "raw": "31.25", "reader": "pdf-text-layer+ocr-a" } } ]
→ "vat_breakdown": [ { "tax_amount": 300 }, { "tax_amount": 31.25 } ]
```

A ruleset without a list field gets exactly the schema it got before (Peppol 0.1.0 and 0.2.0, the legal rulesets and every
other example: byte-identical). The reference extractor does not read lists yet: for a list field it writes `not_printed`.

### Archive provenance (2026-10-04, engine 0.4.0)

A value read from a file an archive serves (a published table, a data product) carries archive provenance instead of a page
and line:

```json
"VFLAT_T1": { "value": 150.1, "provenance": { "kind": "archive", "url": "https://astroweb.case.edu/SPARC/SPARC_Lelli2016c.mrt",
  "retrieved_at": "2026-10-04T02:59:41.504Z", "sha256": "5aa0501f…8243", "reader": "sparc-table1 split on whitespace (…)",
  "raw": "150.1", "locator": "line 152, field 16 (Vflat)" } }
```

`member` and `container_sha256` name a file inside a container (a zip member). `archive_checksum`
(`{ "algorithm": "md5" | "sha1" | "sha256" | "sha512", "value", "published_at"? }`) is the checksum the archive itself
publishes for the file, when it publishes one. The engine reads archive provenance as E1 and states `checksum_verified` only
from bytes it hashed itself (docs/EVIDENCE.md, "Archive provenance").

The generated schema accepts archive provenance only when the ruleset lists it: `"provenance_kinds": ["page", "archive"]`.
Without that key every schema is byte-identical to what it was. Without `require_contract` an envelope with archive provenance
is lowered like any other.

## The ruleset flag: `require_contract`

`"require_contract": true` in a declarative ruleset (default off; engine 0.1.0) makes verify read only an envelope that
validates against that ruleset's schema. Anything else is refused.

- **No check runs.** The verdict is INSUFFICIENT_DATA with one claim, `contract.EXTRACTION_CONTRACT`.
- **The insufficiency names the first violation**: its code, its JSON Pointer, and what is wrong.
- **A typed remedy says what to hand over instead**, for example
  `missing-operand extraction (/fields/TAX_AMT/provenance)`.

Without the flag, an envelope is still accepted. It is lowered to the extraction the checks read: each value goes to its
field's first path, and `"UNREADABLE"` stays the marker, so the checks that read it abstain. Nothing else moves. A plain
extraction is read exactly as before, and its verdict is bound to the same input hash. Engine 0.0.1 neither reads the flag
nor lowers an envelope, so every verdict issued under it replays byte for byte.

An `"UNREADABLE"` value's provenance reaches its remedy. The abstention names the page and line where the value is printed,
even when no source text was supplied.

## Canonicalization

This section is about how two readings of a string are compared. How an extraction is hashed is a different rule, written out in
`docs/REPLAY.md` ("The hash contract"): the extraction is hashed as parsed JSON, with keys in a fixed order and numbers as
doubles, so key order, whitespace and `6125` against `6125.0` do not change the hash, while any change to a string does. An
extraction file that is not valid UTF-8, that starts with a byte-order mark, or that holds a number past the double range
(`1e999`) is refused before hashing.

Two readings of a string agree when they are equal after this fixed list of folds, and only these:

- Unicode NFC.
- Soft hyphens (U+00AD) removed. A soft hyphen followed by whitespace marks a line end, and the two halves join.
- Line-break hyphenation: a hyphen ending a line, after a letter, before a line that starts with a lower-case letter.
- Curly quotes and primes become `'` and `"`.
- Typographic dashes become `-`.
- The ligatures ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ become their letters, and `…` becomes `...`.
- Whitespace runs become one space.

There is no case folding and no character repair: `1O0` is not `100`. Two numbers agree when both read strictly (engine
0.1.0's rule, the page's own decimal separator, exactly two decimals for an amount, valid grouping) and are equal.

## The reference extractor

`extractContract(pdf, ruleset, options)` reads a PDF into an envelope.

- **A born-digital page** (20 or more text-layer words) is read from its text layer (pdfjs-dist) and by OCR (Tesseract
  through poppler's `pdftoppm`).
- **A scan** is read by OCR at two settings, turned upright once.
- **Labelled document fields** are found by the ruleset's `labels`. A label must head its row segment and be maximal, so
  "VAT total in accounting currency" is never "VAT total".
- **Layout-specific fields** (line-item tables, breakdown rows) come from a `LayoutReader` the caller supplies.
- **It also returns what `verify --source --quotes` takes**: the first reader's text, and the raw strings of the agreed
  values. verify then checks that every value handed over is printed verbatim.

For the legal check, `readQuotationTwice(pointer, textLayer, ocr, names)` reads a quotation. The pointer marks which
passage; the value is what the page prints there. A quotation that cannot be read the same way twice is withheld from the
check (`contractToCitations`), never handed over as a guess. Opinion texts are canonicalized and recorded with their
reader and sha256.

The readers have dependencies the checks do not:

- **pdfjs-dist** is an optional peer dependency (`npm i pdfjs-dist`).
- **`tesseract` and `pdftoppm`** are found by option, else by `VERIFY_TESSERACT` and `VERIFY_PDFTOPPM`, else on `PATH`.
- **Every child process** is spawned hidden, one at a time, and its temporary files are removed.

## What it guarantees

- An extraction verified under `require_contract` names every value's page, line, raw string and reader.
- It accounts for every field of the ruleset.
- Within the contract's rules, it marks as `UNREADABLE` every value its two readings disagreed on.
- verify never applies a ruleset default to a value marked unreadable. Two unreadable totals cannot cancel into a PASS.
- A field the page does not print stays absent. A currency is the page's, or absent.

## What it does not guarantee

- **Two readings of one image are not independent.** When both readings make the same mistake, the contract hands over
  a wrong value. Two OCR passes over the same scanned image share its blemishes. The benchmark below found exactly that
  under ink stamps: both settings read a stamped `1` as `7`. Agreement lowers the error rate; it does not remove it.
- **Handwriting** is not read.
- **Stamps over text**: colour dropout helps only with coloured ink on a scan. A black stamp hides what it covers.
- **Multi-column layouts and tables** are read only as well as the `LayoutReader` reads them.
- **Real inbox variety** is unmeasured until a pilot. The measured corpus is synthetic renderings of public samples.
- **Presence checks** pass on any agreed value, even a template placeholder or a misread identifier.
- **Line-break hyphenation is ambiguous.** `fact-` at a line end before `intensive` canonicalizes to `factintensive`.
- **Reference texts (opinions) are not read twice.**
- **A quotation the text layer cannot locate is withheld.** This happens when a page's reading order interleaves columns or
  footnotes; it costs decisions, not correctness.

## Measured (T1, 2026-10-03; prereg sha256 `dddf1421…bfb9a`; not blind: the corpora's earlier results were known)

These are the first frozen run's results on the e-invoice PDF corpus (60 renderings), Peppol 0.2.0. The baseline is the
earlier extractor on the same documents under the same engine.

| | baseline extractor | contract extractor |
|---|---|---|
| planted defects: wrong PASS (hard bar 0) | 0/20 | **0/20** |
| planted defects: caught / abstain | 17 / 3 | 16 / 4 |
| clean: correct PASS | 17/20 | 20/20 (3 rest on a template placeholder passing a presence check) |
| noisy: correct PASS / false FAIL / abstain | 10 / 2 / 8 | **9 / 4 / 7** (miss: false FAIL rose) |
| envelopes satisfying their schema | n/a | 60/60 |

The misses are listed by document in the run's own report. On three stamped scans, both settings misread the same digits.
On one two-column page, the two readings disagreed.

On 58 legal citations under legal@0.0.1, with each quotation read twice off the court's decision:

| | quotation as transcribed | read twice under the contract |
|---|---|---|
| known-bad citations: PASS (hard bar 0) | 0/20 | **0/20** |
| genuine quotations: false FAIL | 11 | 7 |
| genuine quotations: correct PASS | 6/20 | 3/20 |
| quotations withheld as unreadable | n/a | 18/58 |

Contract runs are safer and less decisive. A located window may drop up to two of the quotation's words, which hands the
check a shorter passage; one known-bad item ran that way and still failed. Closing that gap is open work.
