prototype; no measured accuracy

# A second engine in Python for one ruleset: spec sheet

This folder is a second implementation of ONE built-in ruleset of the engine, `invoice@0.1.0`, written in Python with the
standard library only. It issues a verdict from an extraction, and it replays a verdict it is handed: it runs the check
again under the engine version the verdict names and compares the result byte for byte. Its aim is the Node engine's
verdict on every byte: the same checks, the same reasons, the same `input_hash` and the same `verdict_id`. In the terms of
`docs/INTERCHANGE.md`, section 1, it is a re-performing verifier, so it can answer VERIFIED, not only "structure verified".

**What agreement shows, and what it does not.** The same maintainers wrote this engine from the Node engine's sources and
pages; the rule table below quotes the sentence each rule follows. When the two engines agree on every byte, the port is
faithful to the Node engine. It does not show the two are independent: a mistake read off the Node source can be copied
into the port.

**The ruleset: `invoice@0.1.0`.** It is the built-in invoice ruleset, the one the engineers' door example uses
(`docs/doors/examples/invoice.json`, an extraction) and the one 18 of the 20 conformance vectors are issued under. The
structured AP input (`riposte.ap-input/0.1.0`) belongs to another ruleset, `ap-structured@0.1.0`, which this folder does
not implement.

**The samples it is checked on** are the door example and the two `invoice` bundles in
`packages/verify/test/fixtures/engine-0.0.1-bundles.json` (`invoice-builtin-clean`, `invoice-builtin-garbled-tax`), which
are engine 0.0.1 verdicts.

**Which Python.** Python 3, standard library only; nothing to install. The commands below say `python`. Where Python 3 is
installed as `python3`, use that name (the programs' own usage lines spell it `python3`). The comparisons need the Node
engine built first: `npm install --legacy-peer-deps && npm run build` at the repository root writes
`packages/verify/dist/cli.js` (`ci/SPEC.md` says when the flag can go).

## What it does

- **`engine.py issue <extraction.json>`** reads the extraction under the hash contract, binds the ruleset's fields, runs its
  checks, applies the ruleset's tolerance policy and the engine's honesty rules, derives the remedies, and writes the verdict
  to stdout exactly as `node packages/verify/dist/cli.js <extraction.json>` writes it (two-space indented JSON and a newline).
  The headline goes to stderr. `--issued-at <timestamp>` fixes the one field allowed to vary between runs, so two runs can be
  compared byte for byte. `--engine <version>` issues under an earlier engine label (the engine's own `engine` option, which
  its replay uses); `--producer <label>` records the extractor's label as `document.producer`.
- **`engine.py replay <bundle.json | cases.jsonl | folder> [--strict] [--lenient-remedies]`** replays a bundle (`{ verdict,
  inputs, options? }`), in the order and the words of the engine's replay (`packages/verify/src/protocol/replay.ts`,
  `protocol/replay-case.ts`, `src/cli.ts`): the refusals before hashing (exit 3); the binding, `verdict_id` then `input_hash`,
  through `riposte_bind.check_bundle` (FAILED, exit 1); then the check re-performed under the engine version the verdict names,
  with its `document.producer` and its references and source as carried, and the result compared with the presented verdict
  byte for byte in canonical JSON, `issued_at` and the five annotations aside. It says VERIFIED (exit 0), or FAILED at the first
  differing field (exit 1), and applies the deleted-remedies rule, `--lenient-remedies` and `--strict` as `REPLAY.md` states
  them. On the line under its first, whatever the first line says, it names the keys the file carries outside the verdict and
  its inputs (`carried, not checked: <keys>`), then the caller keys `id` and `note` a bundle carries at its top level
  (`carried (allowed): id, note`); `--strict` refuses the first kind (exit 1, `outside keys under --strict: <keys>`) and allows
  the second. A JSON result goes to stdout (status, the recorded and computed ids, the first difference, `carried_not_checked`,
  `carried_allowed`, and `strict` under `--strict`); the lines a person reads go to stderr.
- **A folder or a `.jsonl` of bundles.** Given a folder (its `.json` and `.jsonl` files in name order; a folder inside it is
  named and not walked) or a `.jsonl` file (one bundle per line, each case named `<file>#<line>`), `replay` replays each case
  on its own inputs and writes what the engine's folder replay writes: the summary JSON on stdout (the counts, one entry per
  case, and by case the fields not re-performed, `carried_not_checked`, `carried_allowed` and, under `--strict`,
  `strict_failed`), and on stderr one line per case with what it carries and its remedies indented under it, then the summary
  line. A refused case wins the exit: 3 whenever any case was refused, else 1 when a case diverged or failed `--strict`, else 2
  when a case was not re-performed, else 0.
- **Engine labels.** Every label the Node build retains, 0.0.1 to 0.7.2. On the invoice path the engine reads the label in
  seven places, and this build follows each:

  | engine label | what it changes on the invoice path |
  |---|---|
  | 0.0.1, 0.1.0 | the base: `verdict_id` from three parts, no `remedy_table_hash`, no scope block, no `gate_status`; a figure written as text is read through the lenient parsers (`binding/forensic-normalizer.ts`), which this build ports: `"°144.42"` reads as 144.42 |
  | 0.2.0 | the remedy table is bound into `verdict_id` (`protocol/verdict-id.ts`) |
  | 0.3.0 | the scope block closes the verdict (`verdict/scope.ts`) |
  | 0.4.0, 0.5.0 | nothing but the label, and the ids it enters |
  | 0.6.0 | `gate_status` (`verdict/aggregation.ts`), the strict reading (`rulesets/strict.ts`), the can't-tell wording (`verdict/cant-tell.ts`) and the refusal of a number past 2^53 − 1 (`verify.ts`) |
  | 0.7.0 | nothing but the label, and the ids it enters (it changed the accounts-payable reading) |
  | 0.7.1 | each explanation in a controller's words (`rulesets/invoice/words.ts`): what was checked and the figures (`total = subtotal + tax − discount: 1,894.92 computed, 1,894.92 on the invoice, the same to the cent.`), a FAIL with both figures and the difference, a check that could not run with what it was not given; the rule's name stays in `rule_name`, and no outcome, value, evidence, insufficiency or remedy moves |
  | 0.7.2 | nothing but the label, and the ids it enters (it changed the accounts-payable and legal defaults) |

  The replay rules that came with 0.7.1 (the carried keys, the allowed caller keys, `--strict` refusing an outside key, a
  refused case winning in a folder, and the advice for a number that cannot be represented exactly) are not tied to a label:
  they apply to a verdict of every label, as in the engine.
- **Hashing.** `input_hash`, `remedy_table_hash` and `verdict_id` come from `canonical_json`, `sha256_hex`, `bound_inputs` and
  `derive_verdict_id` imported from `conformance/riposte_bind.py`, unchanged; the reader is its `read_json_bytes`, with one
  addition in this folder: a repeated key is refused with its JSON path, as the engine words it (`protocol/hash-input.ts`). The
  remedy table is carried here as data and checked against the hash every engine 0.6.0, 0.7.0 and 0.7.1 `invoice@0.1.0`
  verdict carries.
- **`compare.py`** runs both engines' `issue` on the same extractions (by default the door example), the Python one under the
  engine label the Node verdict carries, and compares the two stdouts byte for byte and the two exit codes. A label this build
  does not carry is refused by name.
- **`sweep.py`** replays every `invoice@0.1.0` conformance vector (each run the manifest lists, with its flags) and the two
  `invoice` pack bundles in both engines, and checks the exit code, the manifest's phrase on each engine's first line, and the
  computed `input_hash` and `verdict_id`; it also re-issues both pack verdicts under engine 0.0.1 with this engine alone and
  checks each against the recorded verdict, byte for byte in canonical JSON.

- **The record's formats.** The receipts ledger, frag folders and the work graph are read by the readers in record/ (record/README.md): written from the Node packages, compared with them byte for byte where they are built, standard library only, Ed25519 verified in pure Python.

## `cli.py replay`: the replay contract of 2026-10-19

`python3 conformance/engine_py/cli.py replay <bundle.json | verdict.json |
envelope.json | cases.jsonl | folder> [--strict] [--trusted-key <k>] [--lenient-remedies] [--allow-unknown-keys]` follows
`REPLAY.md` in the engine's order and prints the engine's first line and exit code for every answer it gives: the refusals
before hashing in the engine's words (JSON syntax errors in V8's words, as Node 22 and later print them), a key a bundle or a
signed envelope does not define (refused; `--allow-unknown-keys` carries it), an annotation member outside its declared shape,
the binding, the signature (with `record/ed25519.py` beside it; without it, "can't tell here"), `--trusted-key`, the outcome
re-performed for invoice@0.1.0 (and, with `declarative/replay.py` beside it, declarative and reconciliation verdicts), the
remedies and `--strict`. A verdict it does not re-perform reads "structure verified; outcome NOT re-performed", exit 2. It takes
none of the engine's flags that build inputs from documents or set a rule floor, and says so (exit 3). `engine.py replay` keeps
the contract of 2026-10-13. `shim.mjs` runs it behind a Node command line; `test_cli.py` holds it to the engine's words;
`bench/PREREG-two-engines-1.md` preregisters the comparison of the two engines on the whetstone corpus, the vectors and the pack.

## How to run it

From the repository root:

```
python conformance/engine_py/compare.py                  # the door example in both engines: IDENTICAL, exit 0
python conformance/engine_py/sweep.py                    # every invoice@0.1.0 vector and both pack bundles: exit 0
python conformance/engine_py/engine.py issue docs/doors/examples/invoice.json --issued-at 2026-01-01T00:00:00.000Z
cd conformance/engine_py && python -m unittest           # the tests, beside the code
```

## What it does not do

What this build does not re-perform is never guessed: `issue` refuses it (exit 3, naming what is outside), and `replay` says
the structure was verified and the outcome not re-performed (exit 2, naming why), as the engine's own replay says of a verdict
it cannot re-perform. Outside this build:

- references that supply something a check reads (a contract object, evidence or history objects), page text (`source.text`),
  and a tolerance override; references and source carried as `null` / `[]` are hashed and replayed as carried;
- from engine 0.6.0, a numeric field written as text (the strict reading) and a key holding spaces or invisible characters in
  the first three levels (the engine refuses such a key only when it folds onto a ruleset path; this build refuses every one,
  which is stricter than the engine and never a different verdict);
- a text value the bridge would hand to the JavaScript `Date` parser (a date in none of the forms the engine's normalizer
  reads itself: ISO, ISO with a time, `MM/DD/YYYY` and `DD/MM/YYYY`, `DD-MM-YYYY`, `Sep 15, 2026`), a date written as a number
  (read in the local time zone), and a CJK numeral date;
- a signed envelope (its signature is checked by record/ledger.py, not here),
and every built-in ruleset but `invoice@0.1.0` (a declarative ruleset is re-performed by `conformance/engine_py/declarative/`;
its README states what it does and does not re-perform);
- an extraction that is not a JSON object;
- three things the engine's replay prints: today's reading of a verdict under an older rule or engine (`rule_now`), the note
  `--strict` gives on `document.producer`, and, in a folder, the command to type instead for a case that is not a bundle. The
  reason given for a refusal or a failed binding is in this build's own words (its reader's and the binding verifier's), which
  can be shorter than the engine's.

It makes no network call, starts no server, and reads no file but the ones it is given and its own folder's (`sweep.py` also
reads the manifest and the pack, and writes each pack bundle to a temporary file outside the tree, removed after use). It
measures no accuracy: agreement with the Node engine says nothing about whether either engine's verdict is right for a bill.

## Inputs and outputs

| command | reads | writes |
|---|---|---|
| `python conformance/engine_py/engine.py issue <extraction.json> [--issued-at <ts>] [--engine <v>] [--producer <label>]` | one extraction (a JSON object) | the verdict on stdout; the headline on stderr |
| `python conformance/engine_py/engine.py replay <bundle.json> [--strict] [--lenient-remedies]` | one bundle, or a bare verdict | a JSON result on stdout; on stderr the first line (VERIFIED, FAILED, refused, or not re-performed), the keys carried outside the verdict and the allowed caller keys, and the headline |
| `python conformance/engine_py/engine.py replay <folder \| cases.jsonl> [--strict] [--lenient-remedies]` | a folder's `.json` and `.jsonl` files, or one `.jsonl` file | the summary JSON on stdout; one line per case (MATCH, DIVERGED, NOT_REPERFORMED or REFUSED) and the summary line on stderr |
| `python conformance/engine_py/compare.py [<extraction.json> ...]` | each extraction (default: the door example); runs both engines | one line per extraction (`IDENTICAL`, `DIFFERS` with the first differing line, or `REFUSED` naming the engine), a closing count |
| `python conformance/engine_py/sweep.py` | `conformance/vectors.json`, the vectors, the pack | one line per run (`AS EXPECTED` or `NOT AS EXPECTED` with the reasons), a closing count |
| `cd conformance/engine_py && python -m unittest` | the tests in `test_engine.py` | unittest's report |

## Exit codes

| program | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `engine.py issue` (the engine's `check` scale) | PASS: every check ran and held | FAIL | PASS-WITH-OPEN or can't tell (`INSUFFICIENT_DATA`) | refused: not readable under the hash contract, not an extraction, a usage error, or outside what this build re-performs (named) |
| `engine.py replay` (the engine's replay scale, `docs/INTERCHANGE.md` section 13) | VERIFIED: re-performed and byte-identical | FAILED: the binding, the re-performed verdict (DIVERGED, the first field named), deleted remedies, or `--strict` (a key outside the verdict and its inputs among its reasons) | structure verified; the outcome not re-performed (no inputs, or outside this build, named) | not a verdict, a malformed `issued_at`, refused before hashing, a signed envelope, or a usage error |
| `engine.py replay` on a folder or a `.jsonl` | every case MATCHes | a case DIVERGED, or a `--strict` failure, and none was refused | none was refused, diverged or failed `--strict`; some were not re-performed | a case was refused (not a bundle, not JSON, refused before hashing, a signed envelope), whatever its siblings did; or nothing to replay |
| `compare.py` | every extraction IDENTICAL | at least one DIFFERS | can't tell: the Node CLI is not built | a usage error, or an extraction either engine refused |
| `sweep.py` | every run as expected | at least one was not | can't tell: the Node CLI is not built | the manifest or the pack cannot be read |

A divergence exits 1 everywhere here. `replay` reports DIVERGED as the engine's own replay does (exit 1); exit 4 is kept for
the containers and gates built around verdicts (a dossier, the gate server), not for an engine. `compare.py` and `sweep.py`
are comparison tools and use the scale of the conformance suite's own check scripts (`check-engine.mjs`, `check_binding.py`:
1 when a case is not as expected), so every program in `conformance/` reads the same way.

## The rules it implements, and the engine sentence each follows

Sources are quoted from the tree. "Implemented" means implemented here and exercised against the Node engine by `compare.py`,
`sweep.py` or a unit test. "Bound only when supplied" means the rule runs here exactly as in the engine, but the references it
needs are outside this build, so on every input it accepts the rule answers can't tell (`REFERENCE_NOT_PROVIDED`), as the
engine does when no reference is supplied.

| rule | what it checks | the engine sentence it follows | status |
|---|---|---|---|
| `SUM_INT` | Σ line amounts = subtotal | "The line item amounts must sum to the stated subtotal" (`rulesets/invoice/axioms.ts`); "LINE_ITEMS_SUM = Σ line amounts (only when every line contributed a number — otherwise the sum would lie)" (`rulesets/invoice/index.ts`) | implemented |
| `TOTAL_INT` | total = subtotal + tax + service charge − \|discount\| | "The stated grand total must equal subtotal plus tax minus discount" (`axioms.ts`); "A discount reduces the total by its MAGNITUDE" and "absent tax/discount → 0, recorded" (`index.ts`) | implemented |
| `TAX_INT` | tax = subtotal × tax rate | "The stated tax amount must equal the subtotal multiplied by the stated tax rate" (`axioms.ts`) | implemented |
| `MATH_INT` | per line: amount = unit price × quantity | "Claimed amount must equal calculated/verified amount" (`kernel/axiom-registry.ts`); "VERIFIED_AMOUNT = LINE_ITEM_TOTAL (invoice rate × invoice qty)" (`binding/ontological-bridge.ts`) | implemented |
| `RATE_SUP` | per line: unit price ≤ contracted rate | "A claimed rate cannot exceed the contracted rate" (`axiom-registry.ts`) | bound only when supplied |
| `AMT_CAP` | per line: amount ≤ contracted limit | "Claimed amount cannot exceed contracted maximum" (`axiom-registry.ts`) | bound only when supplied |
| `TIME_ORD` | service date within the contract term | "Service date must fall within contract effective period" (`axiom-registry.ts`); the service date is read as "v5.0: Implements MIN(service_date) logic for TIME_ORD accuracy" describes (`ontological-bridge.ts` extractDateValue) | the service date implemented; the contract term bound only when supplied |
| `QTY_MATCH` | per line: quantity = delivered quantity | "Claimed quantity must match verified quantity from evidence" (`axiom-registry.ts`) | bound only when supplied |
| `DUP_PROHIB` | the invoice number is not in `prior_invoice_ids` | "The field being ABSENT ("I didn't check") is INSUFFICIENT; an EMPTY array ("here is my history: none") is a valid PASS." (`src/dedup.ts`) | implemented |
| `DUP_NEAR` | no prior number normalizes to this one | "normalized collision that is NOT exact → FAIL: surfaced for a human before payment." (`src/dedup.ts`, on `DUP_NEAR`) | implemented |
| binding | each field from its path (confidence 100), an alternative path (95), or the fuzzy alias search (75) | "Binding confidence is exact path 100 · alternative path 95 · fuzzy alias search 75." (`VERDICT-SCHEMA-v0.md`, honesty rules) | implemented |
| amounts | a money figure read to the cent; a unit price at full precision; a tax rate as a fraction | "A currency amount: parsed (locale, symbols, signs) and rounded to the cent." and "A unit price or rate in money units, at FULL precision" (`binding/forensic-normalizer.ts`) | implemented: JSON numbers under every engine, text under engines before 0.6.0 |
| dates | a date read to its ISO calendar date | "Normalize date to ISO-8601 format (YYYY-MM-DD)" (`forensic-normalizer.ts` normalizeDate) | implemented, but the JavaScript `Date` fallback is outside (above) |
| strict reading | a figure written as text read strictly, engine 0.6.0 | "Under engine 0.6.0 a built-in ruleset's compute() runs this pass first" (`rulesets/strict.ts`) | outside: refused as named, never guessed |
| tolerance | a FAIL within the rounding band reads PASS, labelled as rounding | "Each arithmetic check ... treats one cent as rounding, and a larger difference too while it is within 0.03% of the expected figure and at most one cent per figure the check reads ... The tax check allows one more cent per line; the total check, half a cash step" (`docs/doors/engineers.md`, "The invoice tolerances"); `CAPPED` (`src/tolerance.ts`) | implemented |
| honesty rule 1 | a FAIL that could not compare is can't tell, `UNPARSEABLE` | "A kernel `FAIL` whose only failing predicates are *could-not-compare* ... becomes **`INSUFFICIENT_DATA / UNPARSEABLE`.**" (`VERDICT-SCHEMA-v0.md`) | implemented |
| honesty rule 2 | a missing reference is `REFERENCE_NOT_PROVIDED` | "A kernel `INSUFFICIENT_DATA` whose missing roles are *all* contract-side (or all evidence-side) **while the caller supplied no such reference** becomes **`INSUFFICIENT_DATA / REFERENCE_NOT_PROVIDED`.**" (`VERDICT-SCHEMA-v0.md`) | implemented |
| honesty rule 3 | no verdict on a guessed field | "any PASS/FAIL resting on an operand below **90** becomes **`INSUFFICIENT_DATA / AMBIGUOUS_FIELD`**" (`VERDICT-SCHEMA-v0.md`) | implemented |
| can't tell in words | an open claim never reads "VIOLATED", engine 0.6.0 | "a check that could not run never reads "… VIOLATED"; it says can't tell, in words" (`src/verify.ts`) | implemented |
| explanations in words | each explanation says the check and its figures, engine 0.7.1 | "each invoice explanation says what was checked ("total = subtotal + tax − discount") and the figures; a FAIL names both figures and the difference; a check that could not run says what it was not given, in words. The rule's kernel name stays in `rule_name`, an identifier." (`rulesets/invoice/words.ts`) | implemented |
| aggregation | `ANY_FAIL_FAILS` | "FAIL if any claim FAILs; else INSUFFICIENT_DATA if *no* claim could run; else PASS" (`VERDICT-SCHEMA-v0.md`, design rule 3) | implemented |
| `gate_status` | PASS, PASS_WITH_OPEN, FAIL, INSUFFICIENT_DATA, right after `outcome`, engine 0.6.0 | "from engine 0.6.0 the verdict records the reading as `gate_status`, the key right after `outcome`" (`docs/INTERCHANGE.md`, section 12) | implemented |
| remedies | typed remedies for every non-PASS claim, merged | "every non-PASS claim carries typed remedies, declared by the rule next to its predicate ... and derived from the claim's own insufficiency when the rule declares none" (`src/verdict/remedy.ts`) | implemented |
| scope | the closing scope block, engine 0.3.0 | "Every verdict, of every engine, ends with the same facts, generated from the verdict and never typed" and "A verdict of an engine before 0.3.0 carries none and gets none" (`src/verdict/scope.ts`) | implemented |
| `input_hash` | sha256 of the canonical inputs | "`input_hash = sha256( UTF-8 bytes of canonical_json(inputs) )`" and "**A built-in ruleset** (`invoice`, `pay-app`): `{ extraction, references: { contract, evidence, history }, source, tolerance? }`" (`REPLAY.md`) | implemented (imported) |
| `remedy_table_hash`, `verdict_id` | the identity chain; the remedy table from engine 0.2.0 | "`verdict_id = first 32 hex characters of sha256( "<input_hash>:<ruleset.id>@<ruleset.version>:<engine_version>[:<remedy_table_hash>]" )`" and "`remedy_table_hash = sha256( UTF-8 bytes of canonical_json(remedy table) )                  engine 0.2.0 and later`" (`REPLAY.md`) | implemented (imported) |
| refusals | what is refused before hashing | "Six kinds of input cannot be hashed faithfully, so they are refused before any engine sees them" (`REPLAY.md`); "from engine 0.6.0 `verify()` ... refuse any number whose magnitude is past 9007199254740991" (`REPLAY.md`) | implemented (the reader imported; the repeated key's path added here) |
| replay | re-performed under the engine the verdict names, compared byte for byte, the exempt set aside | "With the inputs, the check is run again by this build's engine, under the engine version the verdict names, and the new verdict is compared with the presented one byte for byte." (`REPLAY.md`) | implemented |
| deleted remedies | an engine 0.0.1 or 0.1.0 verdict without remedies fails unless `--lenient-remedies` | "**Deleted remedies are refused by default (from 2026-10-05).**" (`REPLAY.md`) | implemented |
| `--strict` | an annotation, re-derived remedies, a missing `issued_at`, or a key outside the verdict and its inputs fails a match | "A match fails (exit 1) when it carries an annotation (`channel`, `ledger`, `declared_accuracy`, `action_context`, `case`), when its remedies were re-derived (`--lenient-remedies`), when its envelope key is not pinned with `--trusted-key`, or when `issued_at` is missing. It also fails when the file carries a key outside the verdict and its inputs, other than the two allowed caller keys (`outside keys under --strict: <keys>`)." (`REPLAY.md`) | implemented (an envelope is outside) |
| carried keys | a key outside the verdict and its inputs is named on every replay | "A key a file carries outside the verdict and its inputs (beside a bundle's `verdict`, `inputs` and `options`, an `options` key the replay does not read, beside a signed envelope's four members, or beside the members `ap` writes) is carried, not checked: every replay names it on the line under its first line (`carried, not checked: <keys>`, and `carried_not_checked` in the JSON), and `--strict` refuses it" (`REPLAY.md`) | implemented (the replay is never given the files an `ap` output's `read` records, so `read` is always named) |
| allowed caller keys | `id` and `note` at a bundle's top level | "`id` and `note` at a bundle's top level are named on every replay as `carried (allowed): id, note` (`carried_allowed` in the JSON), are never checked, and `--strict` does not refuse them" (`REPLAY.md`) | implemented |
| a refused case wins | the exit of a folder or a `.jsonl` | "In a folder or a .jsonl a refused case wins: the exit is 3 whenever any case was refused, whatever its siblings did, because a case that cannot be read must never be hidden by a sibling's exit 1; otherwise 1 when a case diverged or failed, then 2, then 0." (`REPLAY.md`) | implemented |
| a number that cannot be represented exactly | the advice a replay gives with the refusal | "In a replay the advice is the one true of a replay, "re-issue the verdict with the amount as a string; a replay of the existing verdict cannot change its input"" (`REPLAY.md`) | implemented |

## The comparison has teeth

A changed check tolerance in this engine must make the full-byte comparison fail, while `input_hash` and `verdict_id` stay
the same, exactly as `REPLAY.md` derives them (from the inputs, the ruleset label, the engine version and the remedy table; a
check's own tolerance is in none of them). `test_engine.py` `TeethTest` pins it. It changes TAX_INT's tolerance from one cent
to two in this engine, and then:

- the door example's verdict keeps vector 01's `input_hash` and `verdict_id`, and its canonical bytes differ, first at
  `claims[2].computation.tolerance.abs`;
- this engine's replay of vector 01 FAILS (exit 1) at that field, with the computed ids equal to the recorded ones;
- its bytes differ from the Node engine's stdout for the same extraction, and are identical again once the tolerance is
  restored.

## Tests

Python `unittest`, standard library only, beside the code: `cd conformance/engine_py && python -m unittest`. They need no
install. The tests that need the Node engine (`AgainstNodeTest`, `ReplayAgainstNodeTest`, `SweepTest`, and one teeth test)
are skipped with "can't tell" when `packages/verify/dist/cli.js` is not built. `SweepTest` also issues the door example, a
figure written as text with a date, a failing total, a tax one cent over and a line amount found by a near match under every
engine label 0.0.1 to 0.7.1 here, and has the Node engine's replay re-perform each (VERIFIED, exit 0). `AgainstNodeTest`
compares sixteen extractions that reach every way an explanation is worded with the Node engine's verdicts, byte for byte.
`ReplayAgainstNodeTest` replays one bundle carrying outside and allowed keys, and a folder holding a match, a divergence, a
refused case and a bundle with carried keys, in both engines, with and without `--strict`: the folder's stdout is identical
byte for byte, and its stderr too once each program's name is set aside. Two files a cold reader wrote on 2026-10-12 are read
in place from `packages/verify/test/fixtures/core-cold-review-2026-10-12/` (a legal bundle with a key `extra`, a signed
envelope with a key `issued_note`): this build re-performs neither, and names each one's outside key all the same.

## Vocabulary

On screen: PASS, FAIL, PASS-WITH-OPEN, can't tell. In JSON: `PASS`, `FAIL`, `PASS_WITH_OPEN` (in `gate_status`),
`INSUFFICIENT_DATA`. A replay says VERIFIED or FAILED, and DIVERGED is the engine's word for a re-performed verdict that differs.
A folder replay says MATCH, DIVERGED, NOT_REPERFORMED or REFUSED per case. A key outside the verdict and its inputs is
"carried, not checked"; `id` and `note` at a bundle's top level are "carried (allowed)".
A comparison says IDENTICAL, DIFFERS or REFUSED per extraction; the sweep says AS EXPECTED or NOT AS EXPECTED per run; either
says can't tell when it cannot run. The engine's command is spelled `node packages/verify/dist/cli.js`.
