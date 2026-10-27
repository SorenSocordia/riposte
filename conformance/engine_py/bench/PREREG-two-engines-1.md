# Preregistration: the Node engine and the Python engine answer the same replays (two-engines-1)

Written 2026-10-20, before any run this file governs. The file is hashed in `PREREG-two-engines-1.sha256` beside it, with the
pins file `PINS-two-engines-1.json` and the harness `run-two-engines.mjs`. It is not yet stamped: the run may not start until a
timestamp authority has signed this file's sha256 (`PREREG-two-engines-1.md.tsr` beside it). Anything changed after the stamp
is an amendment (section 11), written, hashed and stamped before the run, or it does not count. The first run is the
headline; anything run after it is a separate, labelled run and never replaces it.

Prototype. The Python replay (`conformance/engine_py/cli.py`) has no measured agreement until this run is stamped and run.

## 1. Why this run exists

The replay contract (`packages/verify/docs/REPLAY.md`) says what a replay prints first and how it exits, for every answer it
gives. The Node engine implements it. A second implementation in another language, run on the same files with the same flags,
either gives the same first line and exit code or it does not; where it does not, one of the two is wrong, or the contract
leaves the answer open. Each disagreement is a finding to publish: a defect in the Python engine, an ambiguity in
`REPLAY.md`, or a defect in the Node engine. This run measures that agreement row by row.

**What agreement shows, and what it does not.** The same maintainers wrote the Python engine, from the Node engine's sources
and pages. Agreement shows the port is faithful; it does not show the two are independent, since a mistake read off the Node
source can be copied into the port. Nothing here measures whether either engine's verdict is right about a document: the run
compares replay answers, not verdicts against the world.

## 2. What is tested (fixed now)

The build under test is the tree these pins name. Each folder digest is computed the way
`packages/verify/docs/bench/blind-shipping-1/PREREG.md` section 2 defines it: sha256 over the text formed by one line
`<sha256 of the file>  <path>\n` per file, sorted by path, with paths relative to the folder named and written with `/`.
`PINS-two-engines-1.json` holds the same values for the harness to read.

| what | version | pin |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `66a645e738a7a40483b59e2094cee5f6d40a09d08849adc763f2fb973d149ad8` (218 files), over the exported tree of 10:36 local on 2026-10-20 (the tree after the legal citation readers' one-pass rewrites and the citation length bound of that morning; `blind-shipping-1`'s Amendment 5 records the same value) |
| Python engine | invoice@0.1.0 re-performed; the replay contract of 2026-10-19 | every file under `conformance/engine_py/`, recursively, except `bench/` and any `__pycache__/`: `41a95efae6721ef953655ab6ae28e61642ef38ee84a906a6b44c186d925bbbc0` (43 files) |
| binding verifier, imported by the Python engine | canonical JSON, sha256, the identity chain | `conformance/riposte_bind.py`, sha256 `d8b4113d662463c7c03bd86ec32535c7f15aeb4c03e89b5fa51162051761e94d` |
| harness | two-engines-1 | `conformance/engine_py/bench/run-two-engines.mjs`, sha256 `98eb87217099411b2499063b7b22e618343bd174e500e99105b404d078e08076` |
| whetstone development rows, the bytes replayed | 150 rows, 477 checks | the harness's digest of each row's id, file kind, text, key files and each mode's flags (expectations left out): `998c7b1c11a73356ce03f75549074ad95f3dba75d77490d9dcd18dbe8b9bc898` (150 rows) |
| whetstone held-out seals | 50 rows | `whetstone/HELDOUT.sha256`, sha256 `3c6054518484333686fb4368555775ddb8463ccea222440c3bb4688bd9391658`; `whetstone/HELDOUT-2.sha256`, sha256 `5a176ee7bb515901429b22fb3b2c6090286b9ed96f256edf38df538d85aeba89` |
| conformance vectors | 20 vectors, 23 runs | `conformance/vectors.json`, sha256 `c5c5923cd2ef30043e62d886b12dbfc6464fd53763533b0e1ca91a9515ba0b1b` (each vector file is held to the sha256 the manifest records) |
| engine 0.0.1 pack | 8 bundles | `packages/verify/test/fixtures/engine-0.0.1-bundles.json`, sha256 `5c8d6c1f9f1a50af6925017d84c1c45e471b41d514e9b17489aa2eaf37181453` |

Recorded beside the pins, not digests: the row files as they stood when this file was hashed, `whetstone/mutations.json`
sha256 `b59513f1522b5253832c88943167eef4b71c8f6773a1beb8fb78c60d36182c8e` and `whetstone/mutations-2.json` sha256 `97f96a7bea0d190e78bc5688d074bed9a5c7fab1053641727c599bb76d0eb86b` (section 10 says why a move in these
alone does not stop the run); Node `v25.2.1` and Python `3.10.16` on Windows, the versions the run uses (V8 words its JSON
errors differently before Node 22, so a run under another Node major is a different run).

The Python engine runs through `conformance/engine_py/shim.mjs` (inside the Python engine's pin), which starts Python on
`cli.py` with the same arguments and passes its exit code and both streams through. It loads two folders beside it when they
are there: `record/ed25519.py` (an Ed25519 verifier) and `declarative/replay.py` (a reader of declarative rulesets). Whatever
the pinned tree holds is what is tested.

## 3. Who does what

- **The maintainers** wrote both engines, the harness and this file. They stamp this file, make the exported tree the run uses
  (section 6), and run one command. An AI agent may type the commands for them; it is one of the maintainers' tools, and the
  published result says so.
- There is no labeller: the Node engine's own output is what the Python engine is compared with, row by row. The whetstone's
  expectations (`expect` in each row, `AMENDMENTS.json`) are a separate contract with their own amendments and are not read.

## 4. The data

Three arms, all already in the tree:

- **A. The whetstone corpus.** Every row of `whetstone/mutations.json` and `whetstone/mutations-2.json` (150 development rows,
  477 checks) and of `whetstone/HELDOUT.json` and `whetstone/HELDOUT-2.json` (50 held-out rows; their checks are counted by the
  harness at run time from the sealed files), in every mode its row names, with that mode's flags. The rows are written out and
  spawned as `whetstone/run.mjs` spawns them: `node <cli> replay <file> ...flags` from the repository root, `{aux}` read as the
  row's key-file folder. `AMENDMENTS.json` is not applied: no amendment changes a mode's flags (18 of the 64 carry flags, each
  the same on both sides, checked 2026-10-20), and expectations are not compared.
- **B. The conformance vectors.** Every run `conformance/vectors.json` lists (20 vectors, 23 runs; `check-engine.mjs`'s set).
- **C. The engine 0.0.1 pack.** Each of the 8 bundles of `packages/verify/test/fixtures/engine-0.0.1-bundles.json`, written as
  `{ verdict, inputs }`, as `check-engine.mjs` writes it, replayed with no flag.

**What the author has seen (section 9 has the record).** The development rows' descriptions and texts were read while the
Python engine was built. Ten development rows were replayed by both engines in a dry run; no other whetstone row was replayed
by both engines before this file was hashed. The held-out files were never opened by the author; the dry run does not read
them. Arms B and C were compared during development (B in full; C through constructed copies), so they are not blind and are
reported apart from arm A.

**A fourth arm, declared and not run unless pinned.** The e-invoice golden bundles the declarative reader covers are not in this
run. If that reader and a bundle set for it land before the stamp, an amendment written before the stamp adds them as arm D with
their pins; otherwise arm D does not run, and the result says so.

## 5. What is counted

- **A check** is one file replayed with one set of flags by both engines, in the same working folder.
- **The first line** is an engine's first stderr line that is not blank, as `whetstone/run.mjs` reads it.
- **Agreement**: the two exit codes are equal, and the two first lines are equal byte for byte after one normalization: where a
  line names its own program's command to type (`node <path>/cli.js` for the Node engine, `python3 <path>/cli.py` for the Python
  engine, each as the harness computes it), that text reads `<command>`. Nothing else is normalized.
- **Each check is classed** by the harness as one of:
  - `agree`;
  - `python-scope`, outside the Python engine's declared scope: the Python engine's first line (for a folder or a `.jsonl`, the
    line under its first) names one of its own limits, and the Node engine's first line is an answer only re-performing can
    give. The limits are the phrases `this build re-performs invoice@0.1.0 only`, `outside what this build re-performs`,
    `overrides are not re-performed by this build yet`, `whose registry this build does not carry`, `the declarative reader
    beside this build` and `can't tell here`. The Node answers are a first line starting `verify replay: outcome VERIFIED`,
    `verify replay: FAILED: the re-performed verdict differs`, `verify replay: FAILED: the verdict carries no remedies`, `MATCH `
    or `DIVERGED `;
  - `disagree`, every other check.
- **The audit after the run.** Every check that is not `agree` (both `python-scope` and `disagree`) is read by hand and classed:
  (a) a defect in the Python engine; (b) an ambiguity in `REPLAY.md`, where both readings are defensible from its text (a finding
  for `REPLAY.md`); (c) a defect in the Node engine, where the Node line contradicts `REPLAY.md` (a finding for the engine);
  (d) outside the Python engine's declared scope (which confirms the mechanical class, or overturns it); (e) other, described.
- **Not compared**: stderr lines after the first, and the JSON on stdout. Each is recorded by its sha256, and the count of checks
  whose whole stderr and whose stdout are byte-identical is reported as description, not as a result.
- **Secondary**: wall time per engine, total and median per check, with `--jobs 1`. The Python engine is timed through the shim,
  so each of its checks includes one extra Node start.

## 6. The run

1. Make an exported tree of this lab after the stamp, with the exporter, and build it (`npm install --legacy-peer-deps && npm
   run build` at its root). The export holds back `whetstone/HELDOUT.json` and `whetstone/HELDOUT-2.json`; copy both into its
   `whetstone/` from the lab (the harness checks each against its seal).
2. From that tree's root, detached (the run takes longer than ten minutes):
   `node conformance/engine_py/bench/run-two-engines.mjs > two-engines-1.run.log 2>&1`, then move the log into
   `conformance/engine_py/bench/results/` beside what the harness writes there.
3. The harness recomputes every pin of section 2 on that tree and refuses to replay anything (exit 4) when one differs. It
   writes `results/checks.jsonl` (one line per check: both exit codes, both first lines, the sha256 of both streams, both wall
   times, the class), `results/RUN.json` (the counts by arm, split, family and mode; the pins found; the versions) and
   `results/DISAGREEMENTS.md` (every check that is not `agree`, both first lines, and an empty column for the audit).

## 7. The outcome and the predictions

- **Primary**: the number of checks that agree, of all checks, and the list of every check that does not, with both first
  lines. Reported overall, by arm, by split (arm A's development and held-out rows apart, the ten dry-run rows marked), by
  family and by mode.
- **Secondary**: the same count with the `python-scope` checks set aside, and the wall times.
- **Predictions, stated before the run** (the counts are the result, not a bar): the `python-scope` class holds every legal
  row that the Node engine re-performs (the Python engine has no legal reader), and no Peppol row while the declarative reader
  is in the pinned tree; the `disagree` class holds at most 2% of all checks.

## 8. What is published, pass or fail

Within 14 days of the run, in this folder, whatever the outcome: this file, its stamp, the pins file, the harness, the results
with the audit column filled, and one bench row ("two engines, two languages: N of M replay checks give the same exit code and
first line"), with the `python-scope` count and every disagreement beside it. Each audit class (b) is filed against
`REPLAY.md`, each class (c) against the engine, each class (a) as a kept miss of the Python engine. A run that did not happen,
and why, is published the same way.

## 9. The development record (before this file was hashed)

- **Conformance vectors**: 23 of 23 runs agreed on exit code and first line (lab build of 2026-10-20 00:54, whose sources had
  not moved since the export the engine pin is computed over).
- **Constructed files** (written by the author, not the corpus): 127 replays. Before the declarative reader was wired in, 122
  agreed, 4 were legal or Peppol verdicts the Python engine did not re-perform, and 1 was a line naming each program's own
  command (section 5's normalization); of the 122, 104 were byte-identical on every stderr line and on stdout. After it was
  wired in, 124 agreed (the 2 Peppol replays joined), 2 legal replays and the command line remained.
- **The dry run**, ten development rows, the first of each family of the first half and of the second half's two own families:
  `outside.channel-name.door-invoice`, `inside.annotation-action-context.peppol-0.1.0-garbled-totals`,
  `words.answer-fail.legal-0.0.1`, `confusable.allowance-fullwidth.peppol-0.1.0-garbled-totals`,
  `issued-at.arabic-digits.legal-0.0.1`, `signature.envelope-in-envelope.peppol-0.2.0-blind-with-source`,
  `appended.array-bare-verdicts.invoice-builtin-clean`, `layout.blank-lines-no-final-newline.peppol-0.2.0-blind-with-source`,
  `trusted-key.equals-form.invoice-builtin-clean`, `lenient-remedies.carries-none-lenient.legal-0.0.1`; 26 checks. The first
  dry run: 22 agreed, 4 were classed outside the Python engine's scope. One of those four (both modes of
  `issued-at.arabic-digits.legal-0.0.1`) was a Python defect: an `issued_at` written in Arabic-Indic digits, which the engine
  refuses (JavaScript's `\d` is 0-9) and Python's `\d` read as a timestamp. It was fixed before this file was hashed, and the
  scope rule, which had filed it as scope, was tightened to section 5's. The second dry run: 24 agreed, 2 outside scope (both
  modes of the Peppol layout row), 0 other. The third, after the declarative reader (`declarative/replay.py`) was wired into
  `cli.py`: 26 of 26 agreed, 24 of them byte-identical on every stderr line and on stdout. The same digit defect was in the
  binding verifier the conformance suite ships (`conformance/riposte_bind.py`), which `engine.py` imports; it is fixed there
  too (the last item below).
- **`engine.py`'s own replay** carried a key a bundle does not define where the engine, since 2026-10-19, refuses it; a run of
  the Python engine's tests on Linux found the two disagreeing. Before this file was hashed, `engine.py` was brought to the same
  contract (the refusal, `--allow-unknown-keys`, annotation members held to their shapes), its tests were updated to the Node
  engine's measured output, and `cli.py` now calls `engine.py`'s code for those refusals. The dry run after it: 26 of 26 agreed.
- **One command, two names.** `engine.py replay` now answers through `cli.py`'s implementation (its exit code and lines, under its
  own program name), so the two Python commands give one answer: on the vector runs and constructed files above, each agreed
  with the Node replay on 117 of 119 (the 2 others: two replays of a legal verdict, outside scope), where `engine.py replay` alone had agreed on
  43. In the same pass, places where Python's regular expressions read text differently from JavaScript's were fixed in
  `engine.py` and `conformance/riposte_bind.py`, each with a test on the Node engine's measured answer: `$` matching before a
  final newline (an array-index key `"5\n"` and so the canonical key order and `input_hash`; a repeated key's path; an
  `issued_at`), `\s` taking U+001C, and `Math.round` of an infinity. The dry run after it: 26 of 26 agreed.

## 10. Stop rules

- **Before the run.** If any pin of section 2 differs from the tree the run uses, nothing runs. The maintainers write an
  amendment with the new pins, hashed and stamped before the run, or abandon this file and say so. One exception, fixed now:
  `whetstone/mutations.json` or `mutations-2.json` may move while the bytes they replay do not (the whetstone's expectations are
  revised in place); the run then proceeds, held to the replayed-bytes digest, and the result names the file that moved.
- **During the run.** It runs once. No engine, harness or corpus change is made between the stamp and its last check. A crash of
  the harness stops it; it may restart once from the beginning on the same tree, and the restart is reported.
- **After the run.** A disagreement is reported, never patched in place. Any change to either engine after the stamp is a new
  run (`two-engines-2`) under a new hash, and this run stays the headline. There is no look at any count before the last check.

## 11. Amendments

An amendment is a dated section appended to this file, with its reason, hashed into `PREREG-two-engines-1.sha256` and stamped
before the run. After the run starts, nothing in this file changes; a change of mind is reported beside the result as what it
is.

---
sha256 of everything above this line (the body, as written before any governed run): `d7bc77ebdbef674fd4739d263a94efb5c70c6616c7f37c65eb96c805bdc1b9b8`, hashed 2026-10-20T14:38:31Z.
