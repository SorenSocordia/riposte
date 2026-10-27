prototype; no measured accuracy

# Readers of the record in Python: spec sheet

This folder reads the record's formats in Python 3.10 or later, standard library only: the receipts ledger, frag folders, and
the work graph (its frags, charters, deposited files and stores, and its conformance cases). Each reader is written from the Node
package that writes the format, follows that package's order and words, and is compared with it byte for byte where the Node
tool is built. Nothing here writes to a ledger, a record or a store.

**What agreement shows, and what it does not.** The same maintainers wrote these readers from the Node packages' sources and
pages. When the two agree on every byte, the readers are faithful to the Node tools. It does not show the two are independent: a
mistake read off the Node source can be copied into the port.

**What a stranger can do with it, offline.** With Python and these files, and no Node, no install and no network: verify a
receipts ledger's hash chain, every Ed25519 signature on it (verified here in pure Python) and its head record, pinned to a key
or a head they hold; open a frag folder and check its id, its signature, its cover sentence, its place in the record and its pins
against a tree; open a deposited work graph and re-derive every id, signature, status and line of prose in it; and run the work
graph's conformance cases against a second implementation of the format.

## What each reader answers

| file | reads | answers like | what it does not do |
|---|---|---|---|
| `ledger.py` | a receipts ledger (`*.jsonl`) and its head record (`<ledger>.head.json`); a signed verdict envelope | `riposte-ledger verify`, `summary`, `fingerprint`, `verify-signature` (`packages/receipts`) | `rule`, `sign` and `case` (they write); `verify --proof` (the binding of a proof to its receipt) is refused, exit 3, by name |
| `frag.py` | a frag folder (`riposte.frag/0.1.0`): `frag.json`, `cover.txt`, `bundle.json`, the record `frags/frags.jsonl`, `ISSUER.json`, a tree's pinned folders | `frag open` (`packages/frag`) | a bench table is never re-emitted here (can't tell, exit 2, naming the bench tool's command); a verdict is replayed with the Python second engine (`../engine.py`) when its ruleset is `invoice@0.1.0`, and is can't tell otherwise; the AP pack's and the legal rule's pins are compared by folder digest, since their versions are computed by the Node engine's code; work-frag chains (`riposte.work-chain/0.1.0`) are `frag open`'s |
| `workgraph.py` | work frags, charters, a deposited file (`riposte.workgraph/0.1.0`), a store's index chain and its head record (`index.jsonl.head.json`) | `workgraph open`, `status`, `digest`, `charter check` (`packages/workgraph`); the functions `canonicalize`, `frag_id`, `validate`, `map_finding`, `read_gates`, `statuses`, `states` | `init`, `add`, `invalidate`, `check`, `deposit`, `open --into`, `charter parse`, `charter sign`, `digest --compare` (they write, or compare a file the command wrote) |
| `check.py` | `packages/workgraph/conformance/work-frags.json` | `packages/workgraph/conformance/check.mjs`: canonical pairs, accepted frags and their ids, refusals and their codes, effects, gate readings, statuses, container states | |
| `forecast.py` | a forecast commit and reveal (`riposte.forecast/0.1.0`), an OpenTimestamps proof's header, and `conformance/record/vectors-forecast-0.1.0.json` | `frag forecast verify` (`packages/frag`, `docs/FORECAST.md`), its words, its `--json` bytes and its exit codes | whether a Bitcoin block commits to the proof's digest, and that block's time: an OpenTimestamps verifier says that, and its time is passed with `--attested`; `seal` and `read` (they write, or read the network) |
python conformance/record/check.py                                # the frozen record vectors, no Node needed (conformance/record/SPEC.md)
| `strict.py` | (shared) | the engine's strict JSON reader, `parseJsonStrict` (`packages/verify/src/protocol/hash-input.ts`), in its order and its sentences | text that is not JSON at all is refused with Python's reason, not V8's |
| `ed25519.py` | (shared) | Ed25519 verification (RFC 8032, section 6, under its BSD licence: see the file's NOTICE), keys in PEM, the key fingerprint (sha256 over the DER public key) | it is slow (milliseconds a signature) and not constant-time; it handles public data and test keys |

Canonical JSON, sha256, and the JavaScript number and string forms are imported unchanged from `../../riposte_bind.py`;
`JSON.stringify(v, null, 2)` and `String(v)` from `../engine.py`. A frag's verdict claim is replayed by `../engine.py`'s own
replay. Nothing here forks them.

Where the Python reader cannot say what the Node tool says, it says less, never more: it answers can't tell (exit 2) where the
Node tool re-performs a bench table or a ruleset the Python engine does not carry, and never says "re-performed" for them.

## How to run it

From the repository root (`python3` where Python 3 is installed under that name):

```
python conformance/engine_py/record/ledger.py verify frags/frags.jsonl --key <issuer public key.pem> --head <hash>
python conformance/engine_py/record/frag.py open frags/engine/0.7.0/closed --tree .
python conformance/engine_py/record/workgraph.py open packages/workgraph/test/fixtures/graph-50.workgraph.json
python conformance/engine_py/record/check.py                       # 78 passed, 0 failures; exit 0
python conformance/engine_py/record/forecast.py verify <commit.json> <reveal.json> [--ots <proof.ots>] [--attested <ISO time>] [--closed <ISO time>] [--outcome yes|no] [--json]
python conformance/engine_py/record/forecast.py vectors            # the forecast vectors: 91 passed, 0 failures; exit 0
python -m unittest discover -s conformance/engine_py/record        # the tests, beside the code
```

## Exit codes (each the Node tool's)

| program | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `ledger.py verify` | verified | not verified: a broken chain (first line `BROKEN: chain`), a line the strict reader refuses, a signature that does not verify or is not the `--key`'s, a cut or rewrite the head record shows, no head record without `--no-sidecar`, a `--head` not in the chain, a torn tail | | a usage error, a file that cannot be read or is not UTF-8, a line before the last that is not JSON, or what this reader does not do (named) | |
| `ledger.py summary` | the chain and the head record hold | either does not | | as above | |
| `ledger.py verify-signature` | the signature verifies (and is the trusted key's when one is given) | it does not, another key signed it, or the file carries no envelope | | a usage error, a file that cannot be read or is not a verdict | |
| `frag.py open` | intact and re-performed | intact and re-performed; the verdict is FAIL | intact; something cannot be told here | not a frag, or a usage error | `FRAG TAMPERED OR NOT AS RECORDED` |
| `workgraph.py open` | intact | | intact; something cannot be told here | not a deposited file, or a usage error | `DEPOSIT TAMPERED OR NOT AS WRITTEN` |
| `workgraph.py status`, `digest` | read | refused: `store_tampered` and the other codes of SCHEMA.md section 12 | | a usage error | |
| `workgraph.py charter check` | every party signed | refused | a party named but not signed | a usage error | |
| `check.py` | no failures | at least one failure | | the cases file cannot be found or read | |

Usage text is each program's own: it names what this folder does, so it is the one place the words are not the Node tool's.

## The comparison with the Node tools

The tests compare each reader with its Node tool when the tool is built, and are skipped with "can't tell" when it is not (or
when no Node 20 or later is found). A tool is looked for under `$RIPOSTE_NODE_PACKAGES` (a folder holding `verify/`, `receipts/`,
`frag/` and `workgraph/`, each built to `dist/`), then at `packages/<name>/dist/` under the repository root, then at
`<name>/dist/` beside this repository's folder (the development layout). `$RIPOSTE_NODE` names the node executable. In the
development layout the frag package resolves `verify` and `receipts` through a resolve hook handed to node as a `data:` URL;
nothing is linked on disk (`nodetools.py`).

What the tests hold, by file:

- `test_ed25519.py`: RFC 8032's test vectors 1 to 3 (key, signature, verification); a changed byte, an `s` past the group order
  and a `y` past p refused; every signature of the receipts package's cold-review ledger verified, and its key's fingerprint the
  one `riposte-ledger fingerprint` prints.
- `test_strict.py`: the engine's refusal sentences, and every edge case read the way the engine's `parseJsonStrict` reads it,
  words included.
- `test_ledger.py`: every first line of `riposte-ledger verify` on ledgers signed in the test, and the reviewer ledgers of
  2026-10-12 and 2026-10-13 (`packages/receipts/test/fixtures/`) through both readers: exit, stdout and stderr byte for byte.
- `test_workgraph.py`: the strict reader's refusals with their characters counted as JavaScript counts them, V8's reading of
  ISO times, a store written by SCHEMA.md section 9's rules and each tampering named, the fixture deposit; and, against the
  `workgraph` command, `status`, `status --json`, `open`, `open --json` and `digest --detail` of every frag of stores the
  command built from the conformance graphs, byte for byte.
- `test_check.py`: 78 passed and no failures, the same count `check.mjs` gives the Node package.
- `test_forecast.py`: forecasts sealed in the test and re-performed for every exit; the forecast vectors; and, against the
  `frag forecast verify` command, the same exit and the same bytes (the sheet and `--json`) for each.
- `test_frag.py`: frags signed in the test (a PASS-WITH-OPEN verdict, a FAIL verdict, a verdict whose outcome was changed before
  it was signed, and each kind of tampering), the published frags, and `frags/engine/0.7.0/closed`, which reads TAMPERED against
  a tree whose changelog no longer carries the sentence it quotes, as the Node tool reads it.

## Where the readers and the Node tools can differ (kept, and named)

- A line of a ledger that is JSON `null`: both name it as a broken chain at that entry, in the same words (the Node verifier threw
  there until 2026-10-20).
- The reason given for text that is not JSON at all is Python's, not V8's.
- Ed25519: this checks the group equation on decoded points (RFC 8032, section 5.1.7) where OpenSSL compares an encoding; they can
  differ on crafted encodings no signer produces. A key of another algorithm is refused by name here, where Node reads it.
- `frag open --json`: a pin row of the AP pack or the legal rule that differs shows the digest without the version Node prints.

## Vocabulary

On screen, as the Node tools write them: OK, BROKEN, NOT VERIFIED and TORN TAIL for a ledger; intact and
`FRAG TAMPERED OR NOT AS RECORDED` for a frag; intact and `DEPOSIT TAMPERED OR NOT AS WRITTEN` for a deposit; PASS, FAIL,
PASS-WITH-OPEN and can't tell for a verdict or a gate reading; ok, wrong, stale and cleared for a frag's status; needs you, ready
for review and working for a task, a run or a branch. Codes are SCHEMA.md section 12's.
