# Rulesets: how the engine grows, and the rules it carries

> One engine, one verdict schema, one binding layer. What changes per document type is a **ruleset**: a folder under
> `src/rulesets/<id>/` and one line in `src/rulesets/index.ts`, or a JSON file in the declarative format below. Nothing else
> has to learn about the new document.

**If you came for a ruleset's accuracy rather than to write one:**
- AP three-way match: [`BENCHMARK-AP.md`](BENCHMARK-AP.md).
- Peppol BIS 3.0 / EN 16931: "Declared accuracy, side by side" under "Peppol BIS 3.0 / EN 16931" below.
- Legal quotations: [`LEGAL.md`](LEGAL.md).
- Every miss of every ruleset, including the open ones: [`MISSES.md`](MISSES.md). Every bench table: [`BENCH.md`](BENCH.md).

**How to read this page.** It states the rules as they stand. Each ruleset has its own version, separate from the engine's,
and every verdict names both (the glossary at the repository root, `docs/GLOSSARY.md`, "Engine version vs ruleset version").
The build carries every earlier engine, and a replay re-performs a verdict under the engine and the ruleset version it names,
so where a rule depends on the engine, the line says which engines read it that way. When each rule arrived, what it replaced
and what the change measured is in `CHANGELOG.md`: the version entries, and "The rulesets' record" at its end.

## Versions and defaults

| ruleset | versions carried | what a new verdict uses when none is named |
|---|---|---|
| `invoice` (built in) | 0.0.1, 0.1.0 | 0.1.0 |
| `pay-app` (built in) | 0.0.1 | 0.0.1 |
| `ap-threeway` (the AP gate on an emailed bill) | 0.1.0, 0.2.0, 0.3.0, 0.4.0 | 0.3.0 under engine 0.7.2 and later; 0.2.0 under engines 0.6.0 to 0.7.1; 0.4.0 is selectable (engine 0.7.0 or later) and not yet a default ([`AP-INPUT.md`](AP-INPUT.md)) |
| `ap-structured` (the AP gate on structured input) | 0.1.0 | 0.1.0 ([`AP-INPUT.md`](AP-INPUT.md)) |
| `peppol-en16931` (declarative, carried by name) | 0.1.0, 0.2.0, 0.3.0 | 0.3.0 under engine 0.6.0 and later; 0.2.0 under engines 0.1.0 to 0.5.0 |
| `e-invoice` (a name, not a ruleset) | | `peppol-en16931` at its default version |
| `legal` | 0.0.1, 0.1.0, 0.2.0, 0.3.0, 0.4.0, 0.5.0, 0.5.1, 0.5.2, 0.5.3, 0.5.4, 0.5.5 | 0.5.4 under engine 0.7.2 and later; 0.5.3 under engine 0.7.1; 0.5.2 under engines 0.6.0 and 0.7.0; 0.0.1 before; 0.5.5 is selectable from engine 0.7.2 and becomes the default at the next engine label ([`LEGAL.md`](LEGAL.md)) |

A named version is issued as named. A replay never uses a default: a bare name on `verify replay` means the version the
verdict names. A carried id at a version the build does not carry is refused, naming the versions it does. The carried
Peppol rulesets are verbatim copies of their files under `docs/examples/` (a test compares each to its file and pins the
file's sha256), so a verdict made under a name is the verdict made under the file, byte for byte. The command line takes a
name wherever it takes a ruleset file (`--ruleset peppol-en16931` to verify, lint, measure and replay); HTTP
`/v1/verify/declared`, `/v1/ruleset/lint` and `/v1/ruleset/measure` and MCP `verify_declared` take it as the `ruleset` string.

## The shape (`src/rulesets/types.ts`)

| Piece | What it is | Invoice example | Pay-app example |
|---|---|---|---|
| `id` / `version` / `domain` | Named on every verdict; part of `verdict_id`. Rulesets version independently of the engine. | `invoice@0.1.0` | `pay-app@0.0.1` |
| `ontology` | Field names → roles, with `roleKinds` (how each role normalizes) and `lineArrayKeys` (what the per-line array is called). Amount roles have fuzzy matching **off**. | `totals.subtotal`, `line_items[*].amount` | `schedule_of_values[*].completed_to_date`, `summary.total_retainage` |
| `axioms` | The laws: kernel predicates comparing two roles with a tolerance. The **stated** figure is always the left operand, so `asserted` is what the document says and `variance` is stated − expected. | `SUM_INT`, `TOTAL_INT`, `TAX_INT` | `G703_TOTAL` … `G702_PREV` (14) |
| `lineCodes` / `documentCodes` | Which laws run per line and which once per document. | 4 / 4 (plus the duplicate check) | 5 / 9 |
| `compute()` | Binds the **computed roles** (Σ, +, −, ×, ÷) with provenance naming their operands, inheriting the *lowest* operand confidence; reports what could not be computed and *why* (a string → `FIELD_MISSING`; an object → its own reason, e.g. `AMBIGUOUS_UNIT`, `AMBIGUOUS_REFERENCE`); returns extra operand evidence to attach to claims. | `LINE_ITEMS_SUM`, `EXPECTED_GRAND_TOTAL` | `SOV_COMPLETED_SUM`, `EXPECTED_CURRENT_PAYMENT_DUE`, `PREVIOUS_COMPLETED_TO_DATE` (from history) |
| `kindByCode` / `fieldByCode` | The vocabulary the verdict speaks in: RECOMPUTE / CROSS_REFERENCE / CONSISTENCY, and the caller's field name each law is "about". | `TOTAL_INT → 'total'` | `G702_DUE → 'current_payment_due'` |
| `referenceRoles` | Which roles come from `contract`, `evidence`, `history`. Drives honesty rule 2: a missing reference is not the extraction's fault. | contract + evidence roles | history roles only |
| `ambiguityGuards` | Honesty rule 4: `[law, reference role]` pairs; can't tell when the reference offers several candidates and none matched the line. | `RATE_SUP ↔ RATE_CONTRACTED` | none (history matching is by item number inside `compute`) |
| `finish()` | Optional: words a claim's explanation in the ruleset's own terms after the honesty passes; never an outcome, a value or an id. | the checks in a controller's words | the form's words |
| `remedyByCode` | The remedies next to the laws (below, "Remedies"). | `INVOICE_REMEDIES` | `PAY_APP_REMEDIES` |

## The four axes a ruleset can use

1. **Self**: the document's own arithmetic (always available).
2. **References**: contract / PO / receipt (`references.contract`, `references.evidence`).
3. **History**: prior documents of the same kind (`references.history`): the previous pay application, prior invoices. Bound with
   `source: 'history'` and a path into the caller's document (`history[0].schedule_of_values[1].completed_to_date`).
4. **Source text**: the page text, checked verbatim (`QUOTE_MATCH` claims with span locators): required passages, the caller's
   quotes and values, and the legal ruleset.

## Adding a ruleset: the checklist

1. `src/rulesets/<id>/ontology.ts`: every real-world field name you have seen, as `fieldPath` / `alternativePaths`. `fuzzyMatch: false` on every amount. Declare `roleKinds` for every role and `lineArrayKeys`.
2. `src/rulesets/<id>/axioms.ts`: one law per line of the form, stated figure on the left, tolerance stated and justified in a comment.
3. `src/rulesets/<id>/index.ts`: `compute()`; decide, per computed role, what "absent" means (a blank cell that is zero by the form's convention → 0 *and the formula says so*; anything else → an absence with a reason). Never guess a match: by identifier or not at all.
4. New roles → `UniversalRole` in `src/kernel/types.ts` (documented, one line each). New `RulesetRef` → `src/version.ts`.
5. One line in `src/rulesets/index.ts`; the `ruleset` option type in `src/index.ts`.
6. Tests: golden fixtures (`test/fixtures/<id>.ts`) with a clean, a broken (one error per law you care about), a first/edge case, an alternate vocabulary; outcome tests; add the fixtures to `schema-invariants` and `determinism/replay`; a seeded fuzzer.
7. Pre-register the ruleset's claims before measuring anything (`docs/PREREGISTERED-CLAIMS.md`).

A change to how a ruleset reads a document is a new ruleset version, or is gated on a new engine version, so a verdict issued
before it re-performs exactly as it was issued.

## Honesty rules every ruleset inherits

Could-not-compare → `UNPARSEABLE`, not FAIL · missing reference → `REFERENCE_NOT_PROVIDED` · no verdict on a fuzzy-matched field (`AMBIGUOUS_FIELD`) · no verdict against an ambiguous reference (`AMBIGUOUS_REFERENCE`). A ruleset may add its own refusals through `compute()`'s absence reasons (pay-app: `AMBIGUOUS_UNIT` for a bare percent in (0, 1]).

## How a ruleset reads numbers

**Declarative rulesets** read strictly under engine 0.1.0 and later, unless the ruleset turns it off:

- **Absent vs unreadable** (`"distinguish_unreadable"`, on unless the ruleset says `false`). An absent field is one the
  document does not carry; an unreadable one is printed but was not read. Only the first takes its `default`. A field reported
  as `null`, `""` or the marker `"UNREADABLE"` (any case) is unreadable. The checks that read an unreadable field abstain
  `UNPARSEABLE`, naming every unreadable operand, so two unreadable totals can never cancel into a PASS. Absent with no label
  in the source text (or no source text at all) stays absent, and an optional total takes its default, as EN 16931 reads an
  omitted BT-107 / 108 / 113 / 114.
- **Strict numbers** (`"strict_numbers"`, on unless the ruleset says `false`). A money, price or quantity string that does
  not read strictly as one number is unreadable, never coerced: `"°225.0"` is not 225 and `"1,2?5.00"` is not 12. A whole,
  well-formed CJK numeral (`十一万`, `1万2千`) is a numeral.
- **The number grammar** (engine 0.2.0 and later). `"1.234"` and `"1,234"` are unreadable unless the ruleset declares a
  `"locale"`; `"1,23"` reads only under a locale that declares the decimal comma; `"1 234"` only under a locale that declares
  the space grouping (`fr`); `"0.125"` reads as 0.125 (a group starting with 0 is never a thousands group); `"−330.00"` (U+2212)
  is -330; a price keeps full precision (`"€1,234.567"` is 1234.567); `"3.335"` as a price or quantity is unreadable unless a
  locale is declared. `"locale"` is `en` (`.` and `,`), `de` (`,` and `.`), `fr` (`,` and a space), `ch` (`.` and `'`), or
  `{ "decimal": "." | ",", "group": "," | "." | " " | "'" | "" }`; with a locale, exactly its marks are read. JSON numbers are
  never affected.
- **Identifiers** (engine 0.2.0 and later) compare after NFKC, with format characters and every kind of space removed
  (`"EU\u200BR"` and `"ＥＵＲ"` are `"EUR"`); look-alikes across scripts are not folded (`"ЕUR"` with a Cyrillic `Е` is not
  `"EUR"`). An identifier key ignores punctuation, except that a run of punctuation between two digits becomes one separator:
  `PO-1001` = `PO1001`, `INV/2026/001` = `INV-2026-001`, while `12-3` ≠ `1-23`.
- **A near-miss key** (engine 0.2.0 and later): a key such as `"payable_amount "` is unreadable, naming the key, never a
  default.

`"distinguish_unreadable": false` and `"strict_numbers": false` together bring back engine 0.0.1's lenient reading, for a
ruleset that needs it.

**The built-in rulesets** (`invoice`, `pay-app`) read strictly under engine 0.6.0 and later (`src/rulesets/strict.ts`): a
money, price, quantity or rate value that arrives as text must read as exactly one number, in the document's own number
format.

1. **Declared.** A top-level `"number_locale"` on the extraction names the format: `"en"` (1,234.56), `"de"` (1.234,56), `"fr"`
   (1 234,56) or `"ch"` (1'234.56). Only that format's marks are read.
2. **Settled by the document.** Otherwise the document's own text values settle it, when some value that reads without any
   format reads in exactly one of en and de (`"1,234.56"`, `"0.125"` and `"1,250,000"` are en; `"1.250,00"` is de), and no value
   reads in only the other. An ambiguous value is never its own evidence, so a lone `"1,23"` settles nothing.
3. **Neither.** An ambiguous value stays unreadable, and its reason says how to settle it.

| text | no format settled | `en` | `de` |
|---|---|---|---|
| `1234.56`, `$1,234.56`, `USD 2,695.00`, `(12.50)`, `0.125`, `8.25%` (a rate) | the number | the number | unreadable |
| `1.234,56 €` | the number | unreadable | the number |
| `$1OO.O0`, `°225.0`, `E 2O`, `1,2?5.00`, `40,000.` | unreadable: characters that are not part of a number | unreadable | unreadable |
| `1 234`, also with a no-break or thin space | unreadable: only a declared `fr` reads a space group | unreadable | unreadable |
| `1.234`, `1,234`, `75,000` | unreadable: a thousands group or three decimals | 1.234, 1234, 75000 | 1234, 1.234, 75 |
| `1,23`, `625,00` | unreadable: a decimal comma or a thousands mark | unreadable | 1.23, 625 |

An unreadable value keeps its raw text as the bound value. Every check that needs it abstains `UNPARSEABLE`, and the claim's
`asserted` is the value as reported, never a guess. A refused addend (tax, service charge, discount) or a refused
blank-means-zero cell on a pay app (columns D, E, F; line 2; line 7) is never read as 0. JSON numbers are not text, so they are
untouched; a price or quantity written as text with exactly three decimals (`"3.335"`) is unreadable, so send JSON numbers. A
field reported under a key that differs from one of the ruleset's paths only by spaces or invisible characters (`"total "`,
`"tax "`, `"line_items "`) is refused by name, never a bare `FIELD_MISSING` and never a fuzzy guess. A verdict of engine 0.5.0
or earlier is re-performed with the general normalizer that engine used.

## The declarative format

A declarative ruleset is a JSON file: `id`, `version`, `fields`, `checks`, and the keys below. `verify lint <ruleset>` checks
every key; `verify extract-schema <ruleset>` writes the extraction schema it reads ([EXTRACTION-CONTRACT.md](EXTRACTION-CONTRACT.md)).
A key no ruleset uses changes nothing: a ruleset that uses none of them gets byte-identical verdicts, which two golden tests
pin (`test/declarative-golden.test.ts`, 489 results; `test/declarative-golden-einvoice-v010.test.ts`, 177).

**Fields.**

| key | where | behaviour |
|---|---|---|
| `kind` | a field | `amount` (rounds to the cent), `price` (a unit price at full precision: a JSON number is taken exactly, and so is a plain decimal string such as `"3.335"`; any other string that the amount parser would have to round is `UNPARSEABLE`), `quantity`, `rate`, `bool` (1/0 in expressions), `identifier`, `string`. A price, a quantity, a rate and a bool are not operands for rounding inference. |
| `paths`, `default` | a field | where the field is read (the first present wins) and the value an absent field takes. A `default` value never counts as reported. |
| `labels` | a document field | read only under `distinguish_unreadable` and with source text: a field absent from the extraction while one of its labels heads a source line is unreadable (printed, not read). A label heads a line when the line, whitespace collapsed and case folded, starts with it and the next character is not a letter or digit; a line whose rest is lower-case words with no digit is a heading, not the row. It only ever moves a check toward can't tell. |
| `term`, `term_key` | a field | documentation: the business term (`"BT-115 Amount due for payment (cac:LegalMonetaryTotal/cbc:PayableAmount)"`). An unreadable operand's remedy names it, with the field path, the value as reported and the source line (and page) that prints it. A correction filed as a structured document is read by it ([EVIDENCE.md](EVIDENCE.md)). |
| `each` | a list field | `[array paths]` with `paths` relative to each element, read through `sum(ROLE)`. |
| `line_computed` | the ruleset | `{ ROLE: expression }`: a per-line role, usable in a line check or summed at document scope. |
| `hand_edited` | a field | documentation: a person changed it after compiling. |

**Checks.**

| key | where | behaviour |
|---|---|---|
| `left`, `op`, `right`, `tol` | a check | the comparison; `op` is `= != < <= > >=`. A numeric check compares at `tol` unless rounding inference widens it. |
| `compare: "identifier"` | a check | normalised id-set equality (the identifier key above). The claim shows the normalised ids. |
| `compare: "member"`, `in: [codes]` | a check | `left` names one identifier or string field; `=` holds iff every value is one of the codes, `!=` iff none is. Compared as a schematron code list compares: NFKC, format characters removed, whitespace collapsed and trimmed, a value with an inner space never matches, case kept. A CONSISTENCY claim; `right` documents the list. |
| `ROLE?` | any numeric expression | an optional term: its value when reported, 0 when absent. A check decides when its required operands (those written without `?`) are present; a required operand that is absent gives `FIELD_MISSING`. An optional term that is present but unparseable gives `UNPARSEABLE`, never 0. A form made only of optional terms, none reported, abstains. `sum(X?)`, `abs?(…)` and a free-standing `?` are errors; a role written both as `X` and `X?` is required. |
| `alternatives` | a check | ordered fallback forms of the same identity (`[{ "left", "right" }, …]`), the primary first. The first form whose required operands are all present is evaluated; forms are chosen by what is present, **never by which one passes**. If none applies, the check abstains `FIELD_MISSING`, naming what each form lacks. On an identifier check, "A or B must be present" is `A = A` with the form `B = B`. |
| `abstain_unless_all_present`, `abstain_if_present`, `abstain_if`, `abstain_if_present_without` | a check | guards, run after the form is chosen and before the comparison. Any listed role not reported gives `FIELD_MISSING` (or `UNPARSEABLE`); any listed role reported (a `default` does not count; present-but-unparseable does) gives `OUT_OF_RULESET_SCOPE`; a condition `{ "left", "op", "right", "tol"? }` that holds gives `OUT_OF_RULESET_SCOPE` (exact unless `tol`; a condition with an absent operand does not fire); `{ "present", "without" }` fires when `present` is reported and `without` is not (for an identity that reads a stated total in place of a list the engine never sums). Every detail starts with `guard <name>:`. A "fixed tag list" field named in `abstain_if_present` fires on any of its paths. |
| `guard_reason` | a check | appended to a guard's detail (`<guard detail>. Reason: <why>`), typically the cited source. |
| `abstain` | a check | declared abstention: the check never decides; it abstains `OUT_OF_RULESET_SCOPE` (`declared abstention: <why>`) on every document, before anything else is read. For an identity the governing spec does not source: the gap shows in every verdict. Lint warns. |
| `applies_if` | a check | `[ { "left", "op", "right", "tol"? } \| { "field", "in": [...] } \| { "field", "not_in": [...] } \| { "field", "present": true } \| { "any_present": [...] } \| { "neighbour": "prev" \| "next" } ]`, decided before the missing-field test; every condition must hold. When one does not, the check makes no claim and the verdict lists it under `not_applicable`. When a condition cannot be evaluated (its field absent or unreadable), the check abstains (`cannot tell whether this applies: …`): it is never skipped on a guess. |
| `exact_tolerance` | a check | the difference rounded to 9 decimal places, then compared with `tol`. |
| `fail_if_unreadable` | a check | `[roles]`: an unreadable operand FAILs the check, named, instead of abstaining. |
| `advisory` | a check | the check makes no claim; a failure becomes an `advisories` entry on the verdict: counsel, never a verdict, never read by a gate. |
| `support` | a numeric check | `{ "field", "max_of" }`: the point a model is evaluated at, and the measured line field it must not pass (below, "Choices"). |
| `rounding` | a check or the ruleset | `"infer"` or `"none"` (below, "Rounding inference"); a check's setting overrides the ruleset's `tolerance.rounding`. |
| `remedy` | a check | what lawfully answers the check when it does not PASS (below, "Remedies"). |
| `narrowing`, `source`, `compiled_from`, `hand_edited` | a check | documentation a compiled check carries: never evaluated, hashed with the ruleset. |

**The ruleset.**

| key | behaviour |
|---|---|
| `tolerance` | `{ "rel": 0.0003, "absCap": 0, "rounding": "infer" }`: the relative band, its cap and rounding inference. |
| `distinguish_unreadable`, `strict_numbers`, `locale` | the reading above ("How a ruleset reads numbers"). |
| `held_suspect` | `false` turns suspicion off: a struck field stays struck as `unreadable`, without the `suspect` flag ([EVIDENCE.md](EVIDENCE.md)). |
| `require_contract` | `true`: the engine reads only an extraction-contract envelope that validates against the ruleset's schema; anything else is refused, no check runs, and the one claim `contract.EXTRACTION_CONTRACT` abstains naming the first violation (code and JSON Pointer). Without it, an envelope is lowered to the fields' first paths and checked as usual. No shipped ruleset sets it. |
| `quotes` | `[ { "id", "quote", "label"?, "applies_if"?, "remedy"? } ]`: required passages, each a `QUOTE_MATCH` claim `source.<id>` checked verbatim against the source text when it is supplied (`--source`, HTTP and MCP `source`). Without the source text an applicable passage abstains `REFERENCE_NOT_PROVIDED`. The source text, when given, is part of the input the verdict is bound to; the caller's own quotes and values (`--quotes <file.json>`) run too. |
| `sources` | `{ "KEY": "https://…" }`: the primary sources the ruleset cites; documentation, hashed with the ruleset, so a changed citation is a changed ruleset. |
| `row_sets` | `{ NAME: [conditions] }`: a named set of rows (the conditions are `applies_if` shapes). |
| `algorithms` | `{ ROLE: { "algorithm", "inputs", "output"?, "choice"?, "params"? } }`: a document-scope role computed by a named, pinned procedure (below). |
| `choices` | the choice slots (below, "Choices"). |
| `provenance_kinds` | `["page", "archive"]`: the extraction schema also accepts archive provenance ([EVIDENCE.md](EVIDENCE.md)). |
| `compiled_from` | documentation: the compiler, its version, every input with its sha256, the counts, the report's sha256, `hand_edits`. |

**Expressions** (engine 0.4.0 and later for every form after `sum(R)`): `+ - * /`, `abs`, `sum(R)`, `sqrt(x)` (rounded to 9
decimal places; `x < 0` has no value, and the claim abstains `OUT_OF_RULESET_SCOPE`, `no value: sqrt of a negative value …`,
never NaN), `median(R)`, `min(R)`, `max(R)`, `count(R)` over every row of a line field or line-computed role or every element of
a list field, `fn(R, SET)` and `sum(R, SET)` over the rows of a named row set, `prev(R)` and `next(R)` (R on the row before or
after), and `doc.R` (the document's value of R inside a row: a document field, a computed role or an algorithm role).
Arithmetic is IEEE-754 binary64, and an aggregate reads the rows in row order: `median` sorts ascending (an even count takes
`(a + b) / 2`), rounded to 9 decimal places; `min`, `max` and every algorithm output to 9 decimal places; `count` is an exact
integer; `sum` adds left to right and rounds to 4 decimal places. Arithmetic that is not finite has no value. A sum of a
per-line product (`sum(qty*price)`) is not expressible; write it as a line-computed role and sum that.

**An aggregate is computed whole or not at all.** It has no value when a selected row's value is unreadable (the claim abstains
`UNPARSEABLE`, naming the row; the verdict strikes exactly that field), absent (`FIELD_MISSING`) or without a value
(`OUT_OF_RULESET_SCOPE`); when a row's membership cannot be decided (`membership in SET is unknown`); or when the line array
is absent. On an empty selection, `count` is 0, and `sum`, `median`, `min` and `max` have no value. A row outside the set
never matters.

**Neighbours.** `prev(R)` on the first row and `next(R)` on the last have no value; the claim abstains `OUT_OF_RULESET_SCOPE`
with a detail that starts `no_neighbour:`. A check about pairs of rows says `applies_if: [{ "neighbour": "prev" }]`, so the
first row is not applicable and a clean table reads PASS, not PASS-WITH-OPEN.

**Order of evaluation.** Line-computed roles are evaluated role by role, each over every row, so `prev()` or `next()` may read
a field or an earlier line-computed role. Then come the algorithms, then the computed roles in order. A line-computed role that
reads a computed or algorithm role through `doc.` is evaluated after the computed roles, and only checks may read it; lint
refuses a computed role, an algorithm input or a row set that reads it. A row-set condition reads document fields through
`doc.`, never computed roles.

**Not expressible yet:** an aggregate inside a row check (read it through `doc.` and a computed role); an aggregate over the
rows of a list field by a set; `fail_if_unreadable` for an operand read only through an aggregate, `prev()`, `next()` or `doc.`;
rounding inference over aggregate operands; strict `<` and `>` on the radius of a table (two checks, `>=` and `!=`).

### Rounding inference

For each check and document, when its rounding is `"infer"`:

- **Operands** are the amount-kind values the evaluated form uses, as reported. Absent optional terms, `default` values, and
  `bool`, `rate`, `quantity` and `price` fields do not count. Computed roles are expanded into their own operands, and
  `sum(ROLE)` contributes every line's value.
- **The unit U** is the largest of {1, 1 000, 100 000, 1 000 000} that divides every operand.
- **The tolerance** is `max(tol floor, rel × largest |operand|, U × number of operands)`. When no unit exists (amounts with
  cents), the unit term is 0. `absCap`, when above 0, caps only the relative term.
- **A claim decided this way is final**: the separate relative-band pass does not run on it again. The claim carries
  `computation.tolerance = { abs: <tolerance>, rel }`, and its explanation states U, the operand count and the largest operand.

Lint understands the rounding options, optional terms, guards and alternatives: unknown roles, scope rules (line versus
document), malformed options, numeric-only options on identifier checks, and a form made only of optional terms (a warning). It
reports an expression with an invalid character instead of throwing. The reconciliation layer (`src/reconcile`) shares the
parser, so `ROLE?` parses there, but every role it references is required.

### Named algorithms

A published procedure is a claim like any other, so a ruleset that relies on one relies on that procedure, as its source
states it, in exactly those bytes of code (`src/algorithms/`). A registry entry carries an id and a version (a changed
procedure is a new version, never an edit); its source (the citation, the DOI, the URL, the sha256 of the fetched PDF and of
the fetched text, the verbatim quote and its sha256, and the reading taken where the text is loose); and its implementation,
one file of deterministic code pinned by `implementation_sha256` (the sha256 of the file with CRLF folded to LF, recomputed by a
test).

The ruleset names an entry by ref. The ruleset's input identity carries each named entry's pin, so a verdict's `input_hash`, and
so its `verdict_id`, moves when the implementation or the source does. The verdict lists the pins (`algorithms`). Replay
refuses, naming both hashes, a verdict whose pin this build's registry does not carry byte for byte. An algorithm role with an
unreadable input row abstains `UNPARSEABLE`, naming the row; the procedure's own refusal abstains `OUT_OF_RULESET_SCOPE` with
its reason. The entries:

- **`sparc.vflat@1`**: the flat rotation velocity V_f of Lelli, McGaugh & Schombert 2016, ApJL 816, L14, Section 2.2 (DOI
  10.3847/2041-8205/816/1/L14). The rows are taken in the table's order and must have strictly increasing radius. The procedure
  starts with the mean of the two outermost velocities; while the next velocity inward lies within 5% of the running mean, it is
  included and the mean recomputed over every included velocity (summed outermost first). The first failure stops it. A failure
  at the first test, fewer than three points, or a radius that is not strictly increasing returns no value with the reason.
  Inputs `rad`, `v`; outputs `vflat` (the default), `n_used`, `r_inner`. The registry carries the paper's quote.
- **`rar.fit@1`**: the one-parameter fit of the radial acceleration relation, g_obs = g_bar / (1 − e^−sqrt(g_bar/g†)), by
  weighted orthogonal distance regression in log space (Gauss-Newton inner steps, all rows together, at most 60; Brent's bounded
  minimiser on ln g† over [ln 0.01, ln 100], xatol 1e-8). The paper (McGaugh, Lelli & Schombert 2016, PRL 117, 201101) states
  neither the weights nor the solver, so the weights are a parameter: `weighting`, `errors` or `unweighted`, from a choice slot.

### Choices

A published number is a statement made from data through choices the data does not fix. Engine 0.5.0 and later make the
choices part of the ruleset and part of the verdict.

| key | where | what it means |
|---|---|---|
| `"choices": [{ "id", "kind", "load_bearing", "default"?, "not_applicable"?, "governs"?, "name"? }]` | the ruleset | the slots. `kind`: weights, flags, ratio, units, model_form, algorithm, tolerance, selection. `default`: `{ "value", "source" }`, the value supplied when the document states none, and where it comes from |
| `"choices": { "ID": { "value", "stated": true, "span": { "page" \| "section", "quote" } } \| { "unstated": true } }` | the claim document (top level of the extraction or envelope) | the author states the slot with a quoted span, or the document is marked silent on it |
| option `supplied_choices: { ID: { value, source } }` | the call (`verify --supplied-choices <file>`) | the judge supplies a value; it is bound into the inputs |
| `"choice": "ID"`, `"params": { "name": "ID" }` | an `algorithms` entry | the algorithm slot the role computes for, and each parameter from a slot |

- **Resolution.** A well-formed stated fill is `stated`. Else the judge's value, then the ruleset's default, is `supplied`, with
  its source and who supplied it. Else the slot is `unstated` and has no value. A slot with `not_applicable` says why and never
  counts. A stated fill without a quote and a page or section is not a statement: the slot resolves as if the document were
  silent, and the ledger entry says why.
- **What a value does.** A number is a document role named by the slot id (`UPS_DISK`; `doc.UPS_DISK` in a row). An algorithm
  slot linked with `choice`: a resolved value other than the ref the ruleset computes with leaves the role without a value
  (`OUT_OF_RULESET_SCOPE`, `choice_mismatch: …`); the engine never computes another procedure in the document's name. A slot
  stated with a registry ref is checked against the registry's pinned quote. An algorithm parameter comes only from a slot
  (`params`), so every free parameter is on the ledger. A flags slot's value is a policy for per-value quality flags
  ([EVIDENCE.md](EVIDENCE.md)). `governs` names checks that depend on a slot the engine cannot see (a selection, a model form).
- **The gate.** A check that depends on a slot with no value abstains before anything else (`FIELD_MISSING`, detail
  `choice_unstated: …`, `missing` the slots), with a remedy to state the choice with a quoted span or to supply it as the judge.
  Dependency is transitive: expressions, conditions, guards, row sets, computed and line-computed roles, algorithm inputs, links
  and parameters, `support`, and `governs`.
- **The ledger** is on every declarative verdict (`choices`), and `counts.stated_rate` = stated / load-bearing (null when nothing
  is load-bearing). Choices enter the verdict's identity: another supplied value is another verdict.
- **Beyond the data.** A check with `support` whose point lies past the largest measured value makes no claim: the verdict
  carries an advisory with `beyond_data: true`, the computed values and the two support numbers. A point the engine cannot
  evaluate makes the check abstain.
- **Lint** checks the shapes, unique ids (a slot id is a role name), `governs` codes, `not_applicable` slots (never
  load-bearing, never a default), algorithm links and parameters, `support`, flags policies against their scheme, and that a
  slot a check depends on is declared load-bearing; a load-bearing slot nothing depends on is a warning.
- **Not done:** the engine does not compute uncertainties itself (it would need `tan()` and `log10()`); a selection or a model
  form is enforced only through `governs` and guards; the judge's values are not signed.

## What each engine reads

A verdict names its engine, and a replay re-performs it under that engine's reading, so every row below is in force for the
verdicts of its engine and every later one. `CHANGELOG.md` has each engine's entry.

| engine | what it reads that the one before did not |
|---|---|
| 0.1.0 | declarative rulesets read strictly by default (absent vs unreadable; strict numbers); `peppol-en16931` by name |
| 0.2.0 | every verdict binds its remedy table (`remedy_table_hash`, part of `verdict_id`); the number grammar, identifiers and near-miss keys above; `each`, `line_computed`, `exact_tolerance`, `fail_if_unreadable`, `advisory`. Its verdicts also held a value whose one-character reading would fail a check as HELD-SUSPECT, booked as a FAIL; from 0.3.0 that is a flag, never a FAIL, and a 0.2.0 verdict keeps the 0.2.0 reading on replay |
| 0.3.0 | struck fields, the evidence ladder and the scope line ([EVIDENCE.md](EVIDENCE.md)): a field seen and not read is listed under `struck` with its provenance, the checks it would unlock under `would_unlock`; suspect is a flag counted in `counts.suspect` and the gate reads OPEN; every verdict states the worst evidence tier its computed checks rest on and ends with the scope line |
| 0.4.0 | the expression forms after `sum(R)`, `row_sets`, `algorithms`, `provenance_kinds` |
| 0.5.0 | choices, `support` |
| 0.6.0 | the built-in rulesets read strictly; `peppol-en16931` resolves to 0.3.0; pay-app explanations in the form's words; the legal wrapper (a text bound to its cite, provenance, wording; [`LEGAL.md`](LEGAL.md)); `gate_status` on every verdict |
| 0.7.0 | the AP gate's reading of an emailed bill ([`AP-INPUT.md`](AP-INPUT.md)) |
| 0.7.1 | invoice explanations in a controller's words (below); `legal@0.5.3` the default |
| 0.7.2 | `ap-threeway@0.3.0` and `legal@0.5.4` the defaults ([`AP-INPUT.md`](AP-INPUT.md), [`LEGAL.md`](LEGAL.md)) |

Every engine takes an `engine` option for replay (`verify`, `verifyDeclarative`, the AP and structured AP checks,
`verifyAction`, `verifyCitations`, `reconcile`, both twins); a verdict made with it names that version.

## The built-in rulesets

**Invoice** (`src/rulesets/invoice/`). Always runs: `SUM_INT` (the line amounts add up to the subtotal), `TOTAL_INT` (total =
subtotal + tax − discount, plus any service charge), `TAX_INT` (tax = subtotal × tax rate), and per line `MATH_INT` (amount =
quantity × unit price); the duplicate checks `DUP_PROHIB` and `DUP_NEAR` when the caller supplies prior invoice numbers. Runs
only with a reference (else can't tell, `REFERENCE_NOT_PROVIDED`): `RATE_SUP`, `AMT_CAP` and `TIME_ORD` against a contract or
PO, `QTY_MATCH` against a delivery record. Its rounding bands are on the engineers' page ("The invoice tolerances"). Under every
engine after 0.7.0 each explanation says what was checked and the figures ("total = subtotal + tax − discount: 1,894.92
computed, 1,894.92 on the invoice, the same to the cent"; a FAIL names both figures and the difference); a check that could not
run says what it was not given; no explanation names a line (the claim id does) or the kernel's rule name, which stays in
`rule_name`. Earlier engines keep the kernel's text ("Law of the Bottom Line: All predicates satisfied.").

**Pay application** (`src/rulesets/pay-app/`, AIA G702/G703): the 14 laws of the form, line by line and on the summary, with
last month's application as history. From engine 0.6.0 a FAIL reads in the words of the form ("line retainage adds to 6,200
but the total says 5,200"), every number and rule id unchanged; a check that could not run says what the application lacks; a
pay application handed over inside another object is named ("the extraction looks wrapped …"). The rewording runs in
`finish()`, so only a claim that is still FAIL after the honesty passes is reworded. `docs/examples/payapp-g702-g703.json` and
`payapp-g702-g703.previous.json` pass all 44 checks:

```sh
verify docs/examples/payapp-g702-g703.json --ruleset pay-app --history docs/examples/payapp-g702-g703.previous.json
```

**Accounts payable** (`ap-threeway`, `ap-structured`): the three-way match and the gate's decision. The input, the checks and
the gate are in [`AP-INPUT.md`](AP-INPUT.md); its accuracy in [`BENCHMARK-AP.md`](BENCHMARK-AP.md).

**Legal quotations** (`legal`): the rule, its versions, how the default is chosen and its declared accuracy are in
[`LEGAL.md`](LEGAL.md).

## Peppol BIS 3.0 / EN 16931

Rule texts are quoted from the CEN and
Peppol schematrons of https://github.com/OpenPEPPOL/peppol-bis-invoice-3 at commit `261c458` (the full commit hash is in
the root `NOTICE`, each file's sha256 in the ruleset's `sources`).
0.2.0 and 0.3.0 carry typed remedies (re-read the operands; if they are read correctly, only a corrected invoice from the seller clears a
fatal rule).

| check | rule | source | 0.2.0 reads | 0.3.0 reads | on a miss |
|---|---|---|---|---|---|
| `LINES_SUM_INT` | BR-CO-10: BT-106 = Σ BT-131 | CEN-SCH | exact to the cent | the same | FAIL |
| `TAX_EXCL_INT` | BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108 | CEN-SCH | exact to the cent | the same | FAIL |
| `TAX_INCL_INT` | BR-CO-15: BT-112 = BT-109 + BT-110 | CEN-SCH | exact to the cent | the same | FAIL |
| `PAYABLE_INT` | BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114 | CEN-SCH | exact to the cent | the same | FAIL |
| `LINE_MATH_INT` | PEPPOL-EN16931-R120: BT-131 = BT-129 × (BT-146 / BT-149) + Σ BT-141 − Σ BT-136 | PEPPOL-SCH | line net at the cent, slack 0.020001 | line net at full precision, slack exactly 0.02 | FAIL |
| `R120_SUM` | Σ over lines of the R120 deviation ≤ 0.02 (stricter than the standard) | (none) | none | an advisory stating the summed deviation and the line count; `"advisory": false` makes it a FAIL | counsel |
| `BR02_PRESENT` | BR-02: an Invoice shall have an Invoice number (BT-1) | CEN-SCH | presence only | the same | can't tell (`FIELD_MISSING`) |
| `BR03_PRESENT` | BR-03: an Invoice shall have an Invoice issue date (BT-2) | CEN-SCH | presence only | the same | can't tell |
| `BR05_PRESENT` | BR-05: an Invoice shall have an Invoice currency code (BT-5) | CEN-SCH | presence only | the same | can't tell |
| `BR15_PRESENT` | BR-15: an Invoice shall have the Amount due for payment (BT-115) | CEN-SCH | presence only | the same | can't tell |
| `R051_CURRENCY` | PEPPOL-EN16931-R051: all currencyID attributes equal BT-5, except BT-111 | PEPPOL-SCH | the totals' currency = BT-5 | the same | FAIL |
| `BRCO14_VAT_SUM` | BR-CO-14: BT-110 = Σ BT-117 | CEN-SCH | up to four VAT rows by position, exact to the cent; a fifth row or a row without its tax amount: can't tell | every row (`VBD_TAX`, a list field); a row without a readable tax amount FAILs, named | FAIL |

0.1.0 has the first five checks, without remedies; it is kept byte for byte so its verdicts replay. A presence check passes on
any readable value: it does not tell a misread invoice number from the right one. Where the rulesets are narrower than the
schematron: a presence check abstains where the schematron fails, because an extraction cannot tell "not on the invoice" from
"not read"; R051 checks one value, the currency the totals are printed in, where the schematron tests every amount's
`currencyID`; 0.2.0's BR-CO-14 reads at most four VAT rows by position, and both abstain when no row was read, where the
schematron passes `or not(cac:TaxSubtotal)`. BR-CO-14's cent rounding agrees with the schematron's `round(sum × 100) div 100`
whenever BR-DEC-13 and BR-DEC-20 hold (at most two decimals on BT-110 and BT-117). A line amount in another currency than the
totals is not caught.

**Declared accuracy, side by side** (`measureRuleset`, which scores the raw outcome; constructed, hand-labelled sets, not
field data):

| labelled set | ruleset | tp | tn | fp | fn | can't tell | fp rate | fn rate | measured_on |
|---|---|---|---|---|---|---|---|---|---|
| the existing four cases (`test/peppol-accuracy.test.ts`) | 0.1.0 | 2 | 2 | 0 | 0 | 0 | 0% | 0% | `be0abbad21a29b43…` |
| the existing four cases | 0.2.0 | 2 | 2 | 0 | 0 | 0 | 0% | 0% | `9883ba9294523e25…` |
| seven cases with the new classes, constructed after the rules | 0.1.0 | 2 | 2 | 0 | 3 | 0 | 0% | 60% | `2c77257d5091ef4e…` |
| seven cases with the new classes, constructed after the rules | 0.2.0 | 4 | 2 | 0 | 1 | 0 | 0% | 20% | `c795d971db33b7c6…` |

The 0.2.0 "miss" on the seven cases is the invoice without a number: its presence check abstains, so the raw outcome is PASS
while the gate reading holds it (PASS-WITH-OPEN). On the four existing cases the gate reading also differs: they predate BT-1,
BT-2, the totals' currency and the VAT breakdown, so 0.2.0 holds their two clean invoices open where 0.1.0 passes them. Every
Peppol miss, open or closed, is in [MISSES.md](MISSES.md).

## The demos

- `docs/examples/rotation-curve.ruleset.json` (`rotation-curve-sparc@0.1.0`) reads one galaxy's SPARC rotmod table and its
  Table1 row and checks the units, the distance cross-reference and the names, that radius increases, that at least 5 rows lie
  beyond 10 kpc, and three claims fixed before the numbers were computed: flat within 10 km/s of the median beyond 10 kpc; Vobs
  − V_bar ≥ 30 km/s at every row beyond 10 kpc, with V_bar from `sqrt`; and `sparc.vflat@1` replays the published Vflat within
  1 km/s. On NGC 3198 every claim computes and PASSes (largest deviation 7; smallest baryonic excess 58.3755; V_f 150.087 from 23
  rows against the published 150.1), at evidence floor E1.
- `docs/examples/rotation-curve.v0.2.json` (`rotation-curve-sparc@0.2.0`) adds choice slots: the mass-to-light ratios (stated
  from the SPARC paper), the V_f algorithm, the flat model past the rows and G (supplied), quality flags (not applicable). On NGC
  3198 its in-data model check PASSes and its check at twice the last radius is reported as counsel; `stated_rate` 0.6.
- `docs/examples/rar-sparc.ruleset.json` (`rar-sparc@0.1.0`): the fit over the relation's points. The paper states the
  procedure, the ratios and the selection and not the weights: `stated_rate` 0.8. g† 1.0989 against 1.20 ± 0.10 FAILs; the rms,
  0.1329 against 0.13 ± 0.02, PASSes; with the judge supplying `unweighted`, g† is 1.1363 and PASSes, under another verdict id.

Each is a demo, never a benchmark. No SPARC data ships with the product (SPARC states no licence), so the tests use synthetic
tables.

## Compiled rulesets: `verify compile-ruleset`

`verify compile-ruleset <file.sch> … --structure <tsv | xml> --out <ruleset.json>` reads schematron files and writes a
declarative ruleset skeleton and a compile report: every assert is an arithmetic, presence or membership check quoting its text
and citing `source: {file, sha256, line, pattern_id, rule_context, assert_id, flag}`, or an uncompiled entry with its reason.
Nothing is dropped.

**Recompiled Peppol, against the hand rulesets.** Compiled from the same pinned CEN and Peppol schematrons and compared check
by check (`--against`): against 0.2.0, 8 of 11 checks are reproduced (same assert, operands, operator, tolerance and readings)
and 3 differ, each explained (R120's tolerance and precision, R051's one value for every amount, BR-CO-14's positional rows);
against 0.3.0, 10 of 12 are reproduced, R051 differs, and `R120_SUM` has no schematron counterpart (a hand addition, stricter
than the standard). Scoped to one extractor's fields, the compiled ruleset gives the same gate decision as the hand-written 0.2.0
on all 60 documents of the e-invoice PDF test.

BR-CO-15's currency count compiles to `BT_110_CURRENCYID = BT_5` (`BR-CO-15:c1.1`), plus
`BT_111_CURRENCYID != BT_5` when BT-111 is reported (`BR-CO-15:c1.2`). `verify compile-ruleset --diff <compiled> <edited> --out
<file>` marks every check or field a person changed after compiling `hand_edited: true` and lists the edits, removals included,
in `compiled_from.hand_edits`. The readings the compiler applies, its limits and how its output compares with the hand-written
Peppol rulesets are in [COMPILER.md](COMPILER.md).

## Remedies next to the rules

A rule declares what lawfully answers it when it does not PASS (`docs/REMEDIES.md`). A built-in ruleset declares a table next to
its laws (`remedyByCode`; the invoice, pay-app, AP three-way and legal tables). A declarative check declares a `remedy`:

```json
{ "code": "CAP", "left": "TOTAL", "op": "<=", "right": "LIMIT",
  "remedy": {
    "fail":    [{ "kind": "authority", "authority": "budget-owner", "detail": "Over the limit by {variance}." }],
    "abstain": [{ "kind": "missing-operand", "operand": { "source": "po", "role": "LIMIT", "path": "limit" },
                  "when": ["FIELD_MISSING"], "detail": "The PO limit." }] } }
```

A bare remedy, or a list of them, is read as the FAIL remedies. `detail` and `operand.path` may name the claim's facts in
braces: `{asserted}` `{expected}` `{variance}` `{field}` `{line}` `{claim}` `{rule}` `{missing}` `{reason}` and `{op:ROLE}`. A
remedy prints an identifier as the document wrote it and an amount-only check's `{asserted}` / `{expected}` / `{variance}` as
money (`330,000.00`). Lint checks every remedy: a known kind, a detail, an operand where the kind needs one, a registered transform
name, a role for an authority, and `when` only on can't-tell remedies. A remedy is set aside from the ruleset's input identity
(`rulesetIdentity`), so declaring or editing one does not move `input_hash`; from engine 0.2.0 the remedy table a verdict was
answered from is bound by `remedy_table_hash`, so it moves `verdict_id`, and a replay re-derives the remedies from the ruleset
this build carries and FAILs, naming the check, when a bundle's ruleset carries others. A check that declares none still answers:
its can't-tell implies a remedy (the missing field, a re-read, a unit to declare), and its FAIL says `none` (the finding
stands).

## Mining a ruleset from labelled decisions (`src/mine`)

When a customer has past approve/hold decisions but no written policy, `verify mine` proposes the rules. It takes a case table
(`{ id, label, fields, lines? }` per line of a JSONL file) and a schema that types each field (`qty` · `money` · `bool` · `id` ·
`ids`, with arithmetic roles `price`/`amount`/`total`/`extra` and a `source` per document). From these it generates a grammar and
judges every candidate: CONSISTENCY (no approved case violates it), then GROUNDING (exact hypergeometric, ≥ 5 hold violators,
p ≤ 0.01), then NOVELTY (greedy by coverage, ≥ 3 new holds). The survivors are **candles**, proposals for a person to ratify;
every death goes to the **morgue** with its cause. `--ap` runs Distil-style AP cases through the AP parser first
(`apCasesToTable`). `--max-approved-violation-rate r` tolerates approved exceptions, and grounding then uses the enrichment tail
P(X ≥ holds among violators) (`src/mine/stats.ts`). `--ruleset-out` compiles the candles into a declarative ruleset that
`verify <doc> --ruleset` enforces; a candle that needs a sum of a per-line product is listed under `not_expressible`, never
approximated, and the compiled ruleset is marked `complete: false`. On the Distil AP set it reproduces the preregistered
prototype bit for bit (4/4 policy rules, 0 false candles, price t = 2%, 68/68 holds explained), and the compiled ruleset agrees
with the gold decision on 100/100.

## Candidates, in the order the demand data ranks them

invoice ✔ · pay-app ✔ · paystub / bank-statement running balance (fraud pre-screen) · freight bill vs rate agreement · financial-statement footing · legal cite-check (needs the source-text axis).
