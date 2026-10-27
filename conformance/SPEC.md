# Verdict interchange and conformance suite: spec sheet

This sheet says what this suite does, what it does not, its inputs and outputs, every exit code, and the words it uses. The
suite is two things in the tree: `docs/INTERCHANGE.md` and this folder, `conformance/`. It changes no other file.

## What it does

- **`docs/INTERCHANGE.md`** states the verdict interchange as a standalone protocol: what a verdict and a replay bundle are,
  the canonical JSON rule, the hash binding (`input_hash`, `remedy_table_hash`, `verdict_id`) and the input identity (the
  remedy strip), what is refused before hashing, the exempt set, strict mode, the ruleset and engine labels, `rule_now`, and
  the exit codes. It is written from `packages/verify/docs/REPLAY.md` and `packages/verify/docs/VERDICT-SCHEMA-v0.md`. Where
  it and `REPLAY.md` could be read differently, `REPLAY.md` governs, and `INTERCHANGE.md` says so on its first screen.
- **`conformance/`** holds the conformance suite: the pack (below), 20 vectors with their expected outcomes in one manifest,
  a one-file reference binding verifier in Python (standard library only), and three ways to run the suite as checks.

## What it does not do

- It does not change the engine, its rules, the hash contract or any pinned test.
- The Python verifier binds and does not re-perform a check; its first line says so. It cannot say VERIFIED: the most it says
  is that the binding holds and the outcome was not re-performed (exit 2, on the replay's scale). Only a re-performing
  verifier, such as `node packages/verify/dist/cli.js replay`, says VERIFIED.
- The Python verifier does not check a signed envelope's signature, and it does not bind a declarative ruleset that names
A signed envelope's signature is checked offline by conformance/engine_py/record/ledger.py verify-signature (the words and exit codes of riposte-ledger verify-signature).
`conformance/engine_py/declarative/` re-performs declarative-ruleset verdicts (the e-invoice rulesets) under every retained engine label, byte for byte with the Node engine; same maintainers, so agreement shows faithfulness, not independence.
  pinned algorithms (engine 0.4.0 and later): that identity needs the engine's registry pins (exit 3, named as outside what
  it binds). Its refusal messages name the input and the reason; unlike the engine's, they do not give a JSON path.
- It makes no accuracy claim. The vectors are hand-built cases with stated expected outcomes, not a measurement.
- The vectors do not cover signed envelopes, `--trusted-key`, `--require-ruleset`, packed verdicts, or the HTTP and MCP Envelope signatures and their trusted key, as `riposte-ledger verify-signature` reads them, are covered by `conformance/record/`.
  routes. Nor do they cover keys a file carries outside the verdict and its inputs (named on every replay, refused by
  `--strict`, with `id` and `note` allowed at a bundle's top level), or a folder in which a refused case wins the exit.
  `REPLAY.md` states those rules ("Keys outside the verdict and its inputs", "Two caller keys are allowed", "Exit codes"); the
  engine's own tests (`packages/verify/test/replay-carried-keys.test.ts`, `replay-order-and-folders.test.ts`) and the Python
  second engine's (`conformance/engine_py/test_engine.py`, which replays both in step with the engine) cover them.

## The pack

"The pack" is the verdict bundles shipped in this tree that are used as known-good cases. It is exactly the eight bundles in
`packages/verify/test/fixtures/engine-0.0.1-bundles.json` (engine 0.0.1, file sha256
`5c8d6c1f9f1a50af6925017d84c1c45e471b41d514e9b17489aa2eaf37181453`, as the tree's own test pins it), by their `id`:

| id | ruleset | inputs keys |
|---|---|---|
| `peppol-0.1.0-null-totals` | `peppol-en16931@0.1.0` | `extraction`, `ruleset` |
| `peppol-0.1.0-garbled-totals` | `peppol-en16931@0.1.0` | `extraction`, `ruleset` |
| `peppol-0.1.0-blind-with-source` | `peppol-en16931@0.1.0` | `extraction`, `ruleset`, `source` |
| `peppol-0.2.0-blind-with-source` | `peppol-en16931@0.2.0` | `extraction`, `ruleset`, `source` |
| `peppol-0.2.0-garbled-vat` | `peppol-en16931@0.2.0` | `extraction`, `ruleset` |
| `invoice-builtin-clean` | `invoice@0.1.0` | `extraction`, `references`, `source` |
| `invoice-builtin-garbled-tax` | `invoice@0.1.0` | `extraction`, `references`, `source` |
| `legal-0.0.1` | `legal@0.0.1` | `citations`, `sources` |

The suite reads that file in place and never copies or edits it in the tree (the check runners write each bundle to a
temporary file outside the tree to replay it). No other file in the tree is part of the pack. Vectors 12 and 19 are built
from a copy of the pack bundle `peppol-0.2.0-blind-with-source`, the only kind of pack bundle with a page text.

## The vectors

| id | category | case | engine exit | binding |
|---|---|---|---|---|
| 01 | valid | engine 0.6.0 verdict on `docs/doors/examples/invoice.json`, as issued | 0 | holds |
| 02 | equivalent | 01 with keys reversed at every level, re-indented, CRLF | 0 | holds |
| 03 | equivalent | 01 with `150` as `1.5e2`, `1500` as `1500.0`, `144.42` as `14442e-2` | 0 | holds |
| 04 | tampered | 01 with `outcome` and `gate_status` flipped to FAIL | 1 | holds |
| 05 | tampered | 01 with the total in the inputs changed by one cent | 1 | fails |
| 06 | tampered | 01 with a line amount as the string `"1500.00"` | 1 | fails |
| 07 | tampered | 01 with the last hex digit of `verdict_id` changed | 1 | fails |
| 08 | refused | 01 with `"outcome"` written twice in the verdict | 3 | refused |
| 09 | refused | 01 with a UTF-8 byte-order mark | 3 | refused |
| 10 | refused | 01 with a quantity of `9007199254740993` | 3 | refused |
| 11 | tampered | an engine 0.0.1 FAIL verdict with its remedies deleted; with `--lenient-remedies` | 1; 0 | holds |
| 12 | refused | a raw byte `0xFF` in a page text | 3 | refused |
| 13 | refused | 01 with the total written `1e999` | 3 | refused |
| 14 | refused | 01 with a field nested 300 arrays deep | 3 | refused |
| 15 | refused | 01 with `issued_at` `2026-02-30T10:00:00Z` | 3 | refused |
| 16 | valid | 01 with `issued_at` deleted; with `--strict` | 0; 1 | holds |
| 17 | valid | 01 with the annotation `channel` added, under `--strict`; without it | 1; 0 | holds |
| 18 | tampered | 01 with `gate_status` changed from `PASS_WITH_OPEN` to `PASS` | 1 | holds |
| 19 | tampered | a newline appended to a page text | 1 | fails |
| 20 | equivalent | an extraction carrying `{"b": 1, "10": 2, "9": 3}`; a sorted-keys writer's hash differs | 0 | holds |

## Inputs and outputs

- **Vectors:** `conformance/vectors/<nn>-<name>.json`, each one file as a replay reads it (a bundle, or deliberately broken
  bytes), stored byte for byte. `conformance/.gitattributes` (`vectors/** -text`) keeps git from converting them.
- **Manifest:** `conformance/vectors.json`, one entry per vector: `id`, `file`, `sha256` (of the file's bytes), `category`
  (valid, equivalent, tampered, refused), `what` (one sentence), and `expect`:
  - `args` (optional): flags after `replay <file>` for the main run;
  - `engine_exit` and `engine_says`: the exit code of `node packages/verify/dist/cli.js replay <file> [args]` and a phrase its
    first stderr line contains;
  - `also` (optional): further runs of the same file, each `{ args, engine_exit, engine_says }`;
  - `binding`: what a binding verifier must answer, `holds` (exit 2), `fails` (exit 1) or `refused` (exit 3);
  - when the bundle parses: `recorded_input_hash`, `computed_input_hash` (over the input identity), `recorded_verdict_id`,
    `computed_verdict_id`; vector 20 adds `sorted_keys_input_hash`, what `json.loads` then
    `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` hashes.
- **`conformance/riposte_bind.py`** (the reference binding verifier): `python3 conformance/riposte_bind.py <bundle.json>`.
  A JSON result on stdout (`binding`, `reperformed: false`, the recorded and computed `input_hash` and `verdict_id`,
  `signature_checked`, `reasons`); on stderr, first the line `riposte_bind: binding only: input_hash and verdict_id
  recomputed; the check is not re-performed`, then the answer.
- **`conformance/engine_py/cli.py`** (the replay contract in Python): `python3 conformance/engine_py/cli.py replay <file>`, the
  engine's exit code and first line for what it re-performs, and "structure verified; outcome NOT re-performed" for the rest
  (`conformance/engine_py/SPEC.md`).
- **`conformance/record/`** holds the record tier's vectors (`riposte.record-vectors/0.1.0`, its own SPEC.md): 272 cases in seven parts (the strict readers, canonical JSON, the sha256 bindings, Ed25519 over the four signed messages with edge cases, the receipts ledger and its head record, `frag open`, and `workgraph open` with its store), every answer written by running the case through the Node packages; `check.mjs` and `check.py` run them (Node 272 of 272; the Python record readers 270 of 272, the two differences named in its SPEC).
- **`conformance/patterns/`** holds the pattern dialect riposte.pattern/0.1.0: its spec sheet, a translator for JavaScript and one for Python (standard library), the pinned Unicode 16.0 class table and its generator, the catalogue of rewrites, and `vectors.json` with `check.mjs` and `check.py` (exit 0 every case as expected, 1 a case was not, 3 the vectors or the translator cannot be read).
- **`conformance/check-engine.mjs`**: checks each vector's sha256, runs the built CLI on every run of every vector and on each
  pack bundle, and compares exit codes and phrases. One line per run and a closing count.
- **`conformance/check_binding.py`**: runs `riposte_bind.py` as a separate process on each vector and pack bundle, and
  compares the exit code with the binding answer and the computed values with the manifest (and, for the pack, with the
  recorded values). One line per case and a closing count.
- **`conformance/test/conformance.test.mjs`** (vitest): runs both check scripts, checks the verifier's first line and that
  it does not exit 0, and cross-checks the Python `canonical_json` against the engine's `canonicalize` byte for byte on edge
  cases from `REPLAY.md` (array-index keys, UTF-16 key order, number forms, string escapes, a lone surrogate, `__proto__`).

## How to run the checks

From the repository root, after `npm install --legacy-peer-deps && npm run build` (`ci/SPEC.md` says when the flag can go):

```
node conformance/check-engine.mjs            # 31 of 31 runs as expected (20 vectors in 23 runs, 8 pack bundles); exit 0
python3 conformance/check_binding.py         # 28 of 28 as expected (20 vectors, 8 pack bundles); exit 0
cd conformance && npx vitest run             # 5 tests; exit 0
cd conformance/engine_py && python3 -m unittest test_cli   # 24 tests; the two that run Node skip with "can't tell" below Node 22
```

Vectors 11, 16 and 17 each have a second run, so the engine check makes 23 runs for 20 vectors.

## Exit codes

| program | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `riposte_bind.py` | never | the binding fails: `input_hash` or `verdict_id` does not recompute, an engine 0.2.0 or later verdict carries no `remedy_table_hash`, or a tolerance override cannot be bound | the binding holds; the outcome was not re-performed | refused before hashing (invalid UTF-8, a byte-order mark, nesting past 256, not JSON, a repeated key, a non-finite or inexact number), not a bundle or a verdict, a malformed `issued_at`, pinned algorithms, or a usage error |
| `check-engine.mjs` | every run as expected | at least one was not | | the CLI is not built, or the manifest or the pack cannot be read |
| `check_binding.py` | every case as expected | at least one was not | | the manifest or the pack cannot be read |

The engine's replay (quoted from `REPLAY.md`, not redefined): 0 VERIFIED; 1 FAILED; 2 structure verified, outcome not
re-performed; 3 not a verdict, a usage error, or an input that cannot be read or is refused before hashing.

## Vocabulary

On screen: PASS, FAIL, PASS-WITH-OPEN, can't tell. In JSON: `PASS`, `FAIL`, `PASS_WITH_OPEN` (in `gate_status`),
`INSUFFICIENT_DATA`. Replay results: VERIFIED and FAILED for one verdict; MATCH, DIVERGED, NOT_REPERFORMED and REFUSED per
case in a folder. Binding answers: holds, fails, refused. "Arbitration" names the arbitration feature. The command is spelled
`node packages/verify/dist/cli.js`.
