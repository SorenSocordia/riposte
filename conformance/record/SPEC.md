prototype; no measured accuracy

# Record vectors riposte.record-vectors/0.1.0: spec sheet

This sheet says what the record vectors are, who may run them, how each part is read, what agreement shows and what it does
not. The record tier is what a reader needs to verify the record and never issue it: a strict JSON reader, canonical JSON,
sha256 bindings, Ed25519 over four signed messages, the receipts ledger with its head record, `frag open`, and `workgraph open`
with its store. Before this file, a reader of that tier in another language was compared with the Node tools by running them beside it.
This file holds their answers, frozen, so a reader in any language can be checked with no Node beside it.

| file | what it is |
|---|---|
| `SPEC.md` | this sheet |
| `vectors.json` | the cases and their expected answers, with the fixtures they run on and the test keys that signed them |
| `generate.mjs` | writes `vectors.json` by running every case through the Node packages; `--check` compares the file with this build |
| `check.mjs` | runs the vectors against any JavaScript implementation (`check(impl)`); as a program, against the Node packages |
| `check.py` | the same in Python (`check(impl, cases)`); as a program, against the readers in `../engine_py/record/` |

## What it does

- Every expected answer in `vectors.json` was written by running the case through the Node packages that write the formats:
  the engine (`riposte-verify`), the receipts ledger (`riposte-ai`), `riposte-frag` and `riposte-workgraph`. Nothing in the
  file was typed by hand. The fixtures were written by the same packages: the ledger by the receipts file store, the frags by
  `frag build` over a small tree, the store and the deposits by `workgraph`, the envelopes by `riposte-ledger sign`.
- The `oracle` block names the build that answered by content, never by commit: each package's version, the pin rule over its
  TypeScript sources and over the JavaScript that ran, the sha256 of `generate.mjs` and of `check.mjs`, and the Node.js and
  OpenSSL versions.
- `generate.mjs` writes the same bytes on every run of the same build (the clocks are fixed, the keys come from fixed seeds,
  and Ed25519 signing is deterministic). It refuses to write a file in which a machine path reached an expected answer.

## What it does not do

- It does not re-perform verdicts. A frag whose claim is a verdict is answered as the Node tool answers it, which replays the
  verdict; a reader that does not re-perform that verdict answers can't tell there (exit 2), and is right to.
- It does not cover writing: `rule`, `sign`, `build`, `release`, `init`, `add`, `deposit`, `charter sign`. Their outputs are
  fixtures here, not cases.
- It does not cover `verify --proof`, work-frag chains (`frag open <chain.json>`), `digest --compare`, `open --into`, or the
  HTTP and MCP routes.
- It makes no accuracy claim. The cases are built, each with the answer the Node packages give; they are not a measurement.

## Who may run it

Anyone, offline, with no install: `node conformance/record/check.mjs` (Node.js 20.6 or later, no dependencies) or
`python3 conformance/record/check.py` (Python 3.10 or later, standard library only). A reader in a third language either calls
its own functions from one of the two runners (each takes an implementation as a set of functions and runs each part the
implementation offers) or reads `vectors.json` directly by the rules below. No case needs the network or anyone's private key:
the keys in `keys` are test keys, made from the seeds shown, and sign nothing else.

## What agreement shows

The same maintainers wrote the Node packages, the generator, both runners and the Python readers. A reader that passes every
case agrees with the Node packages on these cases: that is faithfulness, and it is what this file can show. It does not show
the Node packages are right, and a reader written from their sources is not independent of them: a mistake read off a source
can be copied into a port. A reader written by someone else from the format pages and this file alone is the independent
reading the file is published for.

## The parts

A case has a `name` (unique in its part) and an `expect`. A command case (ledger, frag, workgraph) names a `fixture`, a
`change` and an `argv`; the other parts carry their input inline or name it by `source`.

**Fixtures and changes.** `fixtures` maps a name to files: `{ "<path>": { "utf8": text } | { "base64": bytes } }`. A case's
files are its fixture's with its `change` applied, path by path: `null` removes the file, `{ "replace": [a, b] }` swaps the first
`a` in the file's text for `b` (the case is malformed if `a` is absent), anything else is the file's new content. The files
are written to an empty folder, and the command runs with that folder as its working folder. A `source` is
`{ fixture, file, line? }`: the file's text, or its line `line` (counted from 0), read as JSON; or `{ fixture, folder }`.

| part | cases | what a reader does | expect |
|---|---|---|---|
| `canonical` | 15 | parse `text` as JSON and write it canonically (REPLAY.md, "Canonical JSON, exactly") | `canonical`, and `sha256` of its UTF-8 bytes |
| `strict` | 64 | read `text` (or decode `base64` as UTF-8 first) as `reader` reads a file named `file`: `engine` (the hash contract, nesting limit 256) or `workgraph` (SCHEMA.md section 1, nesting limit 64) | `canonical` of the value read, or `refused: { where, message }` (`where` null: no place is named) |
| `hashes` | 30 | compute the sha256 binding `rule` names (below) | the named values |
| `ed25519` | 67 | `raw`: verify `signature` (base64) over `message_hex` under `public_key`; `ledger-entry`, `envelope`, `frag`, `charter`: take the object at `source`, put `signature` and `public_key` in place of its own, and run that format's own check (`issuer`: the key a frag must be signed by) | `valid`; for the object as written, `message_sha256`, the sha256 of the bytes its kind signs |
| `ledger` | 47 | `riposte-ledger verify`, `summary`, `fingerprint` and `verify-signature` | a command's answer (below) |
| `frag` | 25 | `frag open` on a frag folder | a command's answer |
| `workgraph` | 24 | `workgraph open` on a deposited file; `status` and `digest` on its store | a command's answer |

**A command's answer.** `exit` is the exit code; `stream` is where the answer is printed (`stdout` or `stderr`); `head` is that
stream's first lines (two for `frag open`, whose first line is always the prototype line; one otherwise); `stdout` and `stderr`
are both streams whole. A reader that writes the Node tool's words compares all of them; a reader in its own words compares
`exit` and `head`. `threw` means the Node tool stopped with an exception
and printed no verdict line: only `exit` is the contract there (the bin's exit, measured when the file was written).

**The hash rules.**

| rule | input | expect |
|---|---|---|
| `sha256_canonical` | `text` | `sha256` of the canonical JSON of the value (`input_hash`, `extraction_hash`, `remedy_table_hash`) |
| `verdict_id` | `input_hash`, `ruleset { id, version }`, `engine_version`, `remedy_table_hash` (null: an engine that binds none) | `verdict_id`: the first 32 hex of sha256 of `<input_hash>:<id>@<version>:<engine_version>[:<remedy_table_hash>]` |
| `frag_id` | a frag at `source` | `frag_id` (sha256 of canonical `{ lock, claim, proof }`) and `body_sha256` (of the eight signed fields) |
| `entry_hash` | an entry inline (`entry`) or at `source` | `hash`: sha256 of canonical `{ seq, kind, at, body, prev_hash }` |
| `work_frag_id`, `charter_id` | a work frag or a charter at `source` | `id`: without `id` (and, for a charter, without `signatures`) |
| `bundle_sha256` | a deposit at `source` | `bundle_sha256`: the deposit without that member |
| `index_chain` | a store's `index.jsonl` at `source` | `line_sha256` of each line (each the next line's `prev`) and `head_record { bytes, count, head }`, which the store wrote |
| `pin_rule` | a folder of a fixture, `recursive`, `suffix` | `sha256` and `files` by the pin rule (frag SPEC.md, "The pin rule") |
| `key_fingerprint` | `pem` (public, or private: its public half) | `fingerprint`: sha256 of the DER SubjectPublicKeyInfo |

**The four signed messages.** A ledger entry signs its `hash` as UTF-8 text; an envelope signs the canonical JSON of its
`verdict`; a frag signs `riposte:frag:v0\n` followed by the canonical JSON of its eight signed fields; a charter party signs
`riposte:charter:v0\n` followed by the canonical JSON of the charter without `signatures`.

## Behaviour this file pins

These are the Node packages' answers where readers and libraries are known to differ. A reader that differs on one of them
disagrees with the record's writer, and says so; the cases are marked `edge` where they are about the curve.

- **Base64 is read as Node reads it.** A character outside the alphabet is skipped, the URL-safe alphabet is read, padding is
  optional, and a newline after the signature is skipped: each of those signatures verifies. Cut to 63 bytes, given a 65th, all
  zero or empty, it does not.
- **The verification equation is OpenSSL's.** `s` at or past the group order does not verify. A small-order key (the identity
  point) with R the identity and `s = 0` verifies over any message, and so does the identity written with `y = p + 1`; an R
  written with `y = p + 1` does not. These matter only where no key is pinned: a pinned key or fingerprint never matches such
  a key.
- **Keys.** A PEM with CR LF line endings is read; a private key where a public key goes is read as its public half; a key of
  another algorithm never verifies.
- **The two strict readers count nesting differently.** The engine counts the outermost array as level 1 (256 levels read, 257
  refused); the work graph counts it as level 0 (65 read, 66 refused).
- **A ledger line that is JSON `null`** breaks the chain at that entry: "entry N is not a ledger entry (the line is JSON null)",
  exit 1 (until 2026-10-20 the Node verifier stopped with an exception there). A line that is an array or a number breaks the
  chain at that entry too, as "entry N has seq undefined".
- **Text that is not JSON at all** is refused by the engine's reader with V8's reason; that message is the runtime's, not the
  format's.

## At writing (2026-10-20)

```
node conformance/record/check.mjs            passed 272, failures 0   (with --words: 272, 0)
python3 conformance/record/check.py          passed 270, failures 2   (with --words: 266, 6)
```

Every failure of the Python readers is one their own README names. The non-canonical key encoding: the Python check refuses
`y` past `p`, OpenSSL reads it. The frag whose verdict carries a contract, evidence and history: the Python second engine does
not re-perform references, so it answers can't tell (exit 2) where Node re-performs (exit 0). With `--words`, also: the reason
given for text that is not JSON (Python's, not V8's), and the usage texts, which name each program.

## Exit codes

| program | 0 | 1 | 3 |
|---|---|---|---|
| `check.mjs`, `check.py` | every case as expected | at least one was not | `vectors.json` or the implementation cannot be read |
| `generate.mjs` | written | `--check`: a case is not what this build answers | `--check`: `vectors.json` cannot be read |

`generate.mjs --check` writes nothing and compares every case, the `oracle` block aside, with what the build at hand answers.
It also says whether the `oracle` block is the same: it differs in another layout (the published packages' sources name each
other by their published names) or on another build, even when every answer is the same.

## Changing it

A case is changed in `generate.mjs`, never in `vectors.json`; then `node conformance/record/generate.mjs` writes the file, and
both runners are run again. A change to any of the four packages that moves an answer shows in `--check`: either the format
changed, and the file is written again under a new schema version when a reader could tell, or it is a regression.
