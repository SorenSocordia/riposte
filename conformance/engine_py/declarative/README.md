prototype; no measured accuracy

# The declarative ruleset format, interpreted in Python

This folder is a second implementation of the engine's declarative ruleset format, in Python with the standard library only.
A declarative ruleset is data: fields with their paths and kinds, computed roles, checks over expressions, guards, applicability,
rounding, required passages. The e-invoice rulesets (Peppol BIS 3.0 / EN 16931, ZATCA, KSeF) are written in it, so an
interpreter of the format re-performs that whole domain: it issues the verdict the Node engine issues, byte for byte, and it
replays a stored verdict by running the check again and comparing the result with the presented one.

**What agreement shows, and what it does not.** The same maintainers wrote this interpreter from the Node engine's sources;
each module names the source file it follows. When the two agree on every byte, the port is faithful to the Node engine. It
does not show the two are independent: a mistake read off the Node source can be copied into the port.

**What it reuses.** The canonical JSON, the sha256, `input_hash`, `verdict_id`, the remedy table's hash and the reader under the
hash contract are `conformance/riposte_bind.py`'s, imported unchanged. The two-space JSON writer, the key order, the carried and
allowed keys of a replay file, the exempt set, the first difference, the case lines and the folder exit are
`conformance/engine_py/engine.py`'s, imported unchanged. Nothing here edits either file.

**What it adds.** What the invoice engine did not need: the JavaScript semantics the format's bytes depend on (`jsrt.py`: how
JavaScript writes and rounds numbers, trims text, slices UTF-16, matches `\s` and Unicode classes); the number readers
(`numread.py`, from `binding/forensic-normalizer.ts`, `declarative/unreadable.ts`, `rulesets/strict.ts`,
`protocol/hash-input.ts`); the expression language in both grammars (`expr.py`, from `declarative/expr.ts`); the source-text
axis (`textmatch.py`, from `textmatch/`); typed remedies (`remedies.py`, from `verdict/remedy.ts`); the evaluator
(`interpret.py`, from `declarative/evaluate.ts`, with `tolerance.ts`, `verdict/scope.ts` and `verdict/aggregation.ts`); lint
(`lint.py`, from `declarative/lint.ts`); reconciliation (`reconcile.py`, from `reconcile/index.ts`, which shares the expression
language). engine.py has private ports of the amount, quantity and rate readers for the invoice path; `numread.py` does not import
them, because two of their patterns use Python's `\s` rather than JavaScript's and their rounding raises on an infinite value,
which a declarative field written as text can reach.

## How to run it

From the repository root:

```
python3 conformance/engine_py/declarative/issue.py <extraction.json> --ruleset peppol-en16931@0.3.0 --issued-at 2026-10-20T00:00:00.000Z
python3 conformance/engine_py/declarative/replay.py <bundle.json | cases.jsonl | folder>
python3 conformance/engine_py/declarative/replay.py <verdict.json> --extraction <file> --ruleset <name | file> [--source <file>] [--quotes <file>]
python3 -m unittest discover -s conformance/engine_py/declarative
```

Where Python 3 is installed as `python`, use that name. Python 3.10 or later.

| command | reads | writes |
|---|---|---|
| `issue.py <extraction.json> --ruleset <r> [--source <txt>] [--quotes <json>] [--engine <v>] [--issued-at <ts>] [--producer <label>] [--allow-open]` | one extraction, a ruleset by name or file, page text and quotes when given | the verdict on stdout, exactly as `node packages/verify/dist/cli.js <extraction.json> --ruleset <r>` writes it; the headline on stderr |
| `replay.py <bundle.json> [--strict] [--lenient-remedies] [--allow-unknown-keys]` | one bundle (`{ verdict, inputs, options? }`) | a JSON result on stdout; on stderr VERIFIED, FAILED (the first differing field named), not re-performed, or refused |
| `replay.py <folder | cases.jsonl>` | a folder's `.json` and `.jsonl` files in name order, or one `.jsonl` | the summary JSON on stdout; one line per case (MATCH, DIVERGED, NOT_REPERFORMED, REFUSED) and the summary line on stderr |
| `replay.py <verdict.json> --extraction <file> --ruleset <r> [--source <file>] [--quotes <file>]` | a bare verdict and the files it is bound to | as for one bundle |

`--ruleset` takes what the Node command line takes: `peppol-en16931` (the default version of the engine label: 0.3.0 from engine
0.6.0, 0.2.0 before), `peppol-en16931@0.1.0`, `@0.2.0`, `@0.3.0`, `e-invoice`, or the path of a ruleset JSON file. The carried
rulesets are byte-for-byte copies of the Node package's `docs/examples` files, in `rulesets/`; the tests pin each copy's sha256 and
compare it with the Node file. A name nobody carries, and a carried name at a version not carried, are refused in the Node
loader's words.

## Exit codes

| program | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `issue.py` (the engine's `check` scale, `verdict/exit.ts`) | PASS: every check ran and held | FAIL, or a claim held as suspect (engine 0.2.0) | PASS-WITH-OPEN, OPEN or INSUFFICIENT_DATA (`--allow-open`: 0 when every open check waits on a reference or a field the document does not carry, with no field struck) | refused, a usage error, or outside what this build re-performs (named) |
| `replay.py` (the replay scale, `docs/INTERCHANGE.md` section 13) | VERIFIED: re-performed and byte-identical, `issued_at` and the annotations aside | FAILED: the binding, a divergence, deleted remedies, or `--strict` | structure verified; the outcome not re-performed (named) | refused: not a verdict, refused before hashing, a key the bundle format does not define (unless `--allow-unknown-keys`), a signed envelope, or a usage error |
| `replay.py` on a folder or a `.jsonl` | every case MATCHes | a case diverged or failed `--strict`, and none was refused | none refused or diverged; some not re-performed | a case was refused, whatever its siblings did |

## What it re-performs

Every engine label the Node build retains, 0.0.1 to 0.7.2, read as each reads: the lenient reading of 0.0.1; absent versus
unreadable and strict numbers from 0.1.0; the remedy table in the id, numbers read whole, folded identifiers, near-miss keys and
held-suspect claims from 0.2.0; struck fields, the evidence floor and the scope block from 0.3.0; the table grammar
(`sqrt`, `median`, `min`, `max`, `count`, row sets, `prev`, `next`, `doc.`) from 0.4.0; the choice list and its counts from 0.5.0
(empty for a ruleset that declares no slots); `gate_status`, the exact-number and figure-character readings from 0.6.0. Every
check kind (number, identifier, member), optional terms, alternatives, the four abstain guards, declared abstention, applicability,
exact tolerance, `fail_if_unreadable`, advisory checks, rounding inference, list fields, line-computed roles, labels in the source
text, required passages and the caller's quotes and values.

## What it does not re-perform

Refused by name (`issue.py` exit 3; `replay.py` exit 2, structure verified), never guessed: a ruleset with pinned `algorithms`;
a ruleset that declares choice slots, and a check's measured `support`, under engine 0.5.0 and later; `require_contract`, and an
extraction-contract envelope, from engine 0.1.0; an arbitration evidence overlay; the judge's supplied choices; archive files; a
declared accuracy; a signed envelope (its signature is not checked here); every built-in ruleset (`invoice@0.1.0` is
`conformance/engine_py/engine.py`'s). None of the e-invoice rulesets uses the first six.

Known limits, stated:

- Unicode tables come from the Python runtime (Unicode 13.0 on Python 3.10, 15.0 on 3.12); Node carries its own. A character
  assigned after 13.0 (a newer script's digits, a newer currency sign) may be classed differently on 3.10.
- A file that is not valid JSON is refused with the Python reader's description of the error, not V8's.
- A role named like a property every JavaScript object has (`constructor`, `toString`) is read as an ordinary role here.
- A malformed ruleset that the Node evaluator would crash on (a field that is `null`) is read here, or refused by name.
- A value written past 9007199254740991 in a caller's `values` list is formatted with Python's integer grouping.

It makes no network call, starts no server, and reads no file but the ones it is given and its own folder's. It measures no
accuracy: agreement with the Node engine says nothing about whether either engine's verdict is right for an invoice.

## The comparison, and how it was measured

`test_declarative.py` reproduces the Node package's two byte-identity goldens (every one of their 489 and 177 pinned hashes),
pins the carried rulesets, checks the loader's refusals, the number readers and the expression grammars, issues and replays
verdicts (a flipped outcome, a changed input, a key the format does not define, deleted remedies, a carried ruleset with other
remedies), and has teeth: a cent added to every amount, or a reworded remedy, makes a replay fail while `input_hash` and
`verdict_id` stay the same. With the Node build present it also compares whole verdicts with the Node library on the e-invoice
golden inputs and the labelled e-invoice extractions, runs both command lines on the same files, and has each engine replay the
other's verdict. The tests that need the Node build or its fixtures are skipped with "can't tell" when they are absent.

`fixtures/golden_inputs.json` and `fixtures/einvoice_labelled.json` are the inputs of the Node package's TypeScript fixtures,
written as JSON by `record_inputs.ts` (run with the Node package's `tsx`, from its folder). The labelled extractions leave out a
line's item name, which no carried ruleset reads. `node_run.mjs` runs the Node library
over a list of cases for the byte comparison.

## Vocabulary

On screen: PASS, FAIL, PASS-WITH-OPEN, can't tell. In JSON: `PASS`, `FAIL`, `PASS_WITH_OPEN` (in `gate_status`),
`INSUFFICIENT_DATA`. A replay says VERIFIED or FAILED; a folder replay says MATCH, DIVERGED, NOT_REPERFORMED or REFUSED per case.
