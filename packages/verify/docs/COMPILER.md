# The standards compiler: schematron → declarative ruleset (2026-10-03)

E-invoice standards already publish their rules in a formal language: CEN EN 16931, Peppol BIS and the national CIUS
profiles (XRechnung, …) ship schematron files. `verify compile-ruleset` reads those files and writes a declarative ruleset
skeleton. Every assert becomes a check that quotes the assert, or an entry in a compile report saying why it could not
be checked. Nothing is dropped. A new national profile becomes a ruleset, a compile report and a bench table the week it
is published, instead of a week of hand translation.

```bash
verify compile-ruleset CEN-EN16931-UBL.sch PEPPOL-EN16931-UBL.sch \
  --structure structure/syntax/ubl-invoice.xml \
  --profile peppol-en16931-compiled --out peppol.compiled.json \
  --against peppol-en16931@0.3.0
# 1138 assert(s): 20 arithmetic, 55 presence, 27 membership, 1036 uncompiled (9 partial) → 156 check(s); lint clean
# against peppol-en16931@0.3.0: 10 reproduced, 1 differ, 1 with no counterpart, 0 unexplained
```

It writes the ruleset, `<out>.compile-report.json` (every assert, its class, its checks or its reason), and with
`--against`, `<out>.comparison.json` and `.md` (a check-by-check comparison with a hand-written ruleset).

## Inputs

| flag | what |
|---|---|
| `<file.sch> …` | one or more schematron files; `<include>`d files are read beside them and hashed as inputs |
| `--structure` | the document structure the XPath is mapped onto: a TSV (`path`, cardinality, BT ids, name, default) or the published structure XML (the VEFA `structure-1` format the Peppol BIS repositories publish), with its `part/*.xml` beside it. A part that cannot be read is reported as a gap |
| `--aliases` | extraction paths per business term, e.g. `{ "terms": { "BT-115": { "paths": ["payable_amount"] }, "BT-117": { "each": ["vat_breakdown"], "paths": ["tax_amount"] } } }`. Without it the paths are made from the BT name and the UBL element name |
| `--scope` | compile only checks whose terms are in a set (`aliases` = the alias file's terms, or `{ "terms": [...] }`): what a given extractor can be held to. A check outside it is an `outside-field-scope` instance |
| `--sources` | file name → where it came from (URL and commit), written into the ruleset's `sources` |
| `--profile`, `--version`, `--name` | the ruleset's id, version and name |

## What each assert becomes

Every assert lands in exactly one class. The counts are in the report and in the ruleset's `compiled_from`.

| class | compiled as | e.g. |
|---|---|---|
| **arithmetic** | a numeric check over amounts, quantities and prices, with the standard's tolerance | BR-CO-10 `BT_106 = sum(BT_131)`, tol 0.005 |
| **presence** | a presence check that **abstains** when the field is absent, never fails (`narrowing: ["presence-abstains"]`) | BR-02 `BT_1 = BT_1` |
| **membership** | a code-list check (`compare: "member"`) or an equality between two fields (`compare: "identifier"`) | BR-CL-04, PEPPOL-EN16931-R051 |
| **uncompiled** | no check; a report entry with its line, test, category and reason | regex, cardinality, dates, absence, per-element rules over repeating groups |

A context that matches several paths (R051's amounts) compiles once per path; an instance the check language cannot
check is listed as uncompiled, and the assert is `partial`. A conjunction compiles one check per conjunct; one that does not
compile makes the assert partial too.

**The readings, stated once** (also `POLICIES` in the code and `policies` in every report):

- cent rounding (`round(x × 100) div 100`) then an exact compare reads the amounts at the cent and allows 0.005;
- `u:slack(exp, val, s)` is `|val − exp| ≤ s`, compared exactly (`exact_tolerance`), its unrounded amounts at full precision;
- `x > c` is two checks, `x >= c` and `x != c`;
- a disjunction whose branches differ only in which optional operands are present collapses to one form, an absent
  operand counted as 0, when the branches cover every presence combination; otherwise the fullest branch compiles alone and
  the check abstains where the other branches would have passed;
- a schematron default (`if (X) then X else K`) is taken only for an optional element; for a mandatory one absence abstains;
- a document sum over a repeating group is a list field (`each`), and the check fails on an element it cannot read;
- a line sum over a group inside the line (its allowances) is read as the line's stated total, and the check abstains when
  the line reports the items instead;
- an assert flagged `warning` or `information` compiles as an advisory check (counsel, never a verdict);
- a rule whose context is an optional element applies only when one of that element's fields is reported;
- the compiler targets the invoice: credit-note alternatives are dropped as absent from an invoice;
- UBL's two-term elements: `cac:AllowanceCharge` is an allowance (ChargeIndicator false) or a charge (true); `cac:TaxTotal` is
  BT-110 (with the breakdown, in the invoice currency) or BT-111. Any other two-term element is read as one combined term;
- **the currency count** (compiler 0.1.1, **added post hoc**, after the corpus run below showed the gap):
  `count(cac:TaxTotal/cbc:TaxAmount[@currencyID = C]) eq 1`, with C the invoice currency (BT-5) or the VAT accounting
  currency (BT-6), is read per dual term. `cac:TaxTotal` occurs at most twice, and each instance is a term, so the count
  holds when the term C selects has currencyID = C and the other term, if reported, does not. For BR-CO-15 these are two
  identifier checks: `BT_110_CURRENCYID = BT_5` (`BR-CO-15:c1.1`) and `BT_111_CURRENCYID != BT_5`, which applies when
  BT-111 is reported (`BR-CO-15:c1.2`). An absent BT-5 or BT-110 currency abstains. An extraction that reports the
  invoice-currency total as BT-111 and the other as BT-110 fails, where the XML count is 1. A count against another
  constant, without the filter, or with a further condition stays uncompiled (cardinality).

Every check records how it reads the standard more narrowly in `narrowing` (e.g. `mandatory-absent-abstains: BT-131 …`,
`branch-collapse: …`, `vacuous-when-absent-abstains: …`, `group-by-mandatory-child: …`).

## Provenance

Every compiled check carries:

- `name`: the assert's text, whitespace collapsed;
- `source`: `{ file, sha256, line, pattern_id, rule_context, assert_id, flag, test, text }`, where `text` is the assert's
  content byte for byte;
- `compiled_from`: `{ compiler: "verify compile-ruleset@0.1.1", class }` (0.1.0 before the currency count);
- `narrowing`: the readings above that apply to it.

Every compiled field carries `term` (BT id, name and UBL path) and `term_key`. The ruleset carries `compiled_from`: the
compiler and its version, every input with its sha256, the counts per file, and the compile report's sha256. These keys are
documentation: never evaluated, hashed with the ruleset like every other byte.

A check from a reading added after 0.1.0 always takes the code `<assert>:<conjunct label>` and never renames or reclassifies
the checks 0.1.0 wrote for the same assert. Recompiling with 0.1.1 leaves every 0.1.0 check unchanged apart from
`compiled_from.compiler`.

## Hand edits: `--diff`

A compiled ruleset is a skeleton. When a person changes it, `verify compile-ruleset --diff <compiled> <edited> --out <file>`
marks every changed or added check and field `hand_edited: true` and lists every edit, removals included, in
`compiled_from.hand_edits`. Running it again on its own output gives the same output.

## The check language it needed (additive; a ruleset without them keeps its bytes)

- `compare: "member"` with `in: [codes]`: a field's value is one of the codes (`=`) or none of them (`!=`), compared as a
  schematron code list compares (whitespace collapsed and trimmed, a value with an inner space never matches, case kept).
- `applies_if: [{ "field": F, "present": true }]`: the check applies only when F is reported (absent → not applicable;
  unreadable → abstain). `applies_if: [{ "any_present": [F, G, …] }]`: when at least one of them is reported.
- `alternatives` on an identifier check: "A or B must be present" is `A = A` with the form `B = B`, chosen by presence.

## Measured (2026-10-03)

**The recompile test.** CEN + Peppol compiled from the schematrons pinned at OpenPEPPOL/peppol-bis-invoice-3 commit
`261c458` (CEN `bdcbb7b7…`, Peppol `5ddf3a2f…`) and compared, check by check, with the hand-written Peppol rulesets:

| hand ruleset | hand checks | reproduced | differ (every difference explained) | no schematron counterpart |
|---|---|---|---|---|
| 0.2.0 | 11 | 8 | 3: R120 (tolerance 0.020001 at the cent vs 0.02 exact at full precision), R051 (one value for every amount vs one check per amount), BR-CO-14 (four rows by position vs a list) | 0 |
| 0.3.0 | 12 | 10 | 1: R051 | 1: R120_SUM, a hand addition stricter than the standard |

Remedies are hand-written and not compiled; the comparison notes them and does not count them.

**Asserts by class** (CEN v1.3.15, Peppol 3.0.20, XRechnung UBL v2.6.0):

| schematron | structure | asserts | arithmetic | presence | membership | uncompiled (partial) |
|---|---|---|---|---|---|---|
| CEN EN16931 UBL | the structure TSV (7 parts missing) | 979 | 17 | 31 | 14 | 917 (3) |
| Peppol BIS 3.0 | the structure TSV | 159 | 3 | 17 | 10 | 129 (2) |
| CEN EN16931 UBL | the complete structure XML | 979 | 17 | 37 | 17 | 908 (7) |
| Peppol BIS 3.0 | the complete structure XML | 159 | 3 | 18 | 10 | 128 (2) |
| XRechnung UBL | the complete structure XML | 56 | 0 | 14 | 6 | 36 (1) |

These are compiler 0.1.1's counts. Compiler 0.1.0 had one more partial assert in each CEN row: BR-CO-15, whose currency count it
left uncompiled. Nothing else moved.

Of CEN's 908 uncompiled, 697 are absence asserts (`UBL-CR-*`: "a UBL invoice should not include …" an element the profile
does not use) and 150 are per-element rules over repeating groups other than the invoice line (the VAT breakdown, document
allowances), which the check language does not iterate.

**A ruleset nobody hand-wrote: XRechnung on 60 rendered e-invoices** (20 clean, 20 with a planted defect, 20 noisy; read by a
blind extractor; prereg sha256 `51d62df9ba8bfbc8d44f57405aa985556713659c1dcbbf7fd2acb90934ce49b9`; not blind: the corpus and its
defects were known; compiler 0.1.0, engine 0.2.0). These are rows of the bench table `xr-einvoice-compiled` in
[BENCH.md](BENCH.md); its prereg, per-document results and the four compiled rulesets ship in `docs/bench/xr-einvoice-compiled/`.
The prereg's bar R1 was missed: one planted defect of a type it did not predict (the invented currency, below) passed.

| arm | planted: caught / abstain / wrong PASS | clean: correct PASS / wrong PASS / false FAIL / abstain | noisy: correct PASS / wrong PASS / false FAIL / abstain |
|---|---|---|---|
| XRechnung rules alone | 0 / 20 / 0 | 0 / 0 / 0 / 20 | 0 / 0 / 0 / 20 |
| EN 16931 + XRechnung | 8 / 12 / 0 | 0 / 0 / 0 / 20 | 0 / 0 / 2 FAIL on misreads / 18 |
| EN 16931 + XRechnung, the extractor's terms only | 8 / 4 / **8** | 17 / 0 / 0 / 3 | 10 / 0 / 2 / 8 |
| CEN + Peppol recompiled, the extractor's terms only | 17 / 3 / 0 | 17 / 0 / 0 / 3 | 10 / 0 / 2 / 8 |

Wilson 95% intervals: 8/20 wrong PASS is [21.9%, 61.3%]; 0/20 is [0%, 16.1%]; 17/20 is [64.0%, 94.8%].

- The planted defects are Peppol-shaped. The XRechnung profile has no line-math rule (that is Peppol's R120), so its four
  line_math defects pass, as predicted. Three currency defects and one invented currency pass because EN 16931 catches them
  through BR-CO-15's `count(cac:TaxTotal/cbc:TaxAmount[@currencyID = BT-5]) eq 1`, a conjunct compiler 0.1.0 left uncompiled
  (cardinality). That was a compiler miss, and the invented currency was not predicted. Compiler 0.1.1 compiles it (below).
- The full profiles require fields this extractor never reads (BT-10, BT-24, the seller's address and contact), so every
  document is held open: they cannot pass, and they still catch the VAT-breakdown and payable defects.
- The recompiled Peppol ruleset, scoped to the extractor's terms, gives the same gate decision as the hand-written 0.2.0 on
  all 60 documents.

**Post hoc: the same run after the currency count (compiler 0.1.1, engine 0.3.0).** This is a regression check on a corpus
and defects already seen, made after the gap was known. It is not a test of the compiler. It was preregistered before any
code: prereg addendum sha256 `197fcb3e268ae6468ed54952f0041b2ec7da35d8bde7644dea647f8f4f239988`. It is not a bench table: the
addendum and the re-run's results are not in this tree, so [BENCH.md](BENCH.md) lists it under "Outside the rule". The extractor and the corpus did not change, and the 60 extractions equal the
first run's.
- **Recompiled only.** The six profiles were recompiled with nothing else changed. The arms' earlier rulesets, re-run on
  engine 0.3.0, give the same decision as the first run on all 60 documents in every arm.
- **What the table shows.** The before figures are from that re-run.

| arm | planted: caught / abstain / wrong PASS, before → after | clean | noisy |
|---|---|---|---|
| XRechnung rules alone | 0 / 20 / 0 → unchanged | unchanged | unchanged |
| EN 16931 + XRechnung | 8 / 12 / 0 → **13 / 7 / 0** | unchanged (0 / 0 / 0 / 20) | unchanged (2 FAIL on misreads / 18) |
| EN 16931 + XRechnung, the extractor's terms only | 8 / 4 / 8 → **13 / 3 / 4** | unchanged (17 / 0 / 0 / 3) | unchanged (10 / 0 / 2 / 8) |
| CEN + Peppol recompiled, the extractor's terms only | 17 / 3 / 0 → unchanged | unchanged | unchanged |

- **The four documents.** Three currency defects and the invented currency now FAIL `BR-CO-15:c1.1`: the invoice currency
  is USD, USD or EUR where the totals are printed in EUR, EUR or GBP, and for the invented currency SEK against EUR.
  - That last one is caught for the wrong reason. The check sees the invented code disagree with the totals; it does not see
    that the code is missing from the page.
  - A fourth currency defect, which had abstained for an unread issue date, now FAILs too.
- **What still passes.** The four remaining wrong PASSes are the line-math defects. EN 16931 and XRechnung have no line-math
  rule.
- **No new wrong PASS** in any arm. Wilson 95%: 4/20 is [8.1%, 41.6%] and 13/20 is [43.3%, 81.9%].
- **No new false FAIL.** The one noisy document whose totals' currency was misread already failed. It now fails
  `BR-CO-15:c1.1` as well.
- **Engine 0.3.0 holds.** A held document reads OPEN when a field it needs was printed but not read: two noisy documents
  with an unreadable payable. Every other hold reads PASS-WITH-OPEN.
  - Three clean templates lack an issue date. They read PASS-WITH-OPEN, not OPEN, because the compiled field's only label is
    the BT name ("Invoice issue date"), which the page does not print ("Issue date"). The engine therefore sees the date as
    absent, not unreadable.

## What it does not do

- **No per-element checks over repeating groups other than the invoice line** (the VAT breakdown's BR-CO-17 and BR-S-08,
  the document allowances' BR-31…BR-38, payment means): the check language iterates the line array only. Numeric presence in
  every element of such a group compiles as a list presence; everything else is uncompiled.
- **No cardinality, uniqueness, absence, regex, date or format tests** (`count()`, `matches()`, `xs:date`, `string-length`).
- **BR-53's currency filter is read only as the term selector.** The compiled check asks that BT-111 be present when BT-6 is,
  not that BT-111's currencyID equal BT-6. (BR-CO-15's currency count compiles since 0.1.1; see the readings above.)
- **No credit notes.** The structure is the invoice's.
- **No XSLT functions beyond a single sequence** (`u:slack` is inlined; check-digit functions are not).
- **Remedies** are not compiled; a check without one gets the remedies its insufficiency implies.
- A presence check passes on any readable value, a misread identifier included.
