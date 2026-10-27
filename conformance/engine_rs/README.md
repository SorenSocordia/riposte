prototype; no measured accuracy

# A reader of the record in Rust (it verifies; it never issues): spec sheet

This folder reads the record's formats in Rust: canonical JSON, the two strict JSON readers, the sha256 bindings, Ed25519 over
the four signed messages, the receipts ledger with its head record, `frag open`, and a deposited work graph with its store. It
is the record tier and nothing more: it verifies, and it never issues, signs or re-performs. Where the Node tools re-perform a
claim, this reader says it cannot tell (exit 2) and never says "re-performed".

It is written from the Python readers beside it (`../engine_py/record/`), which follow the Node packages that write the formats,
and it is checked against the frozen record vectors (`../record/vectors.json`, riposte.record-vectors/0.1.0) with no Node and no
Python beside it.

## What agreement shows, and what it does not

The same maintainers wrote the Node packages, the vectors, the Python readers and this crate, and this crate was written from the
Python readers' sources. When it agrees with the vectors, it is faithful to the Node packages on those cases. It is not an
independent reading: a mistake read off a source can be copied into a port. A reader written by someone else from the format
pages and the vectors alone is the independent reading the vectors are published for.

## The vectors

```
cargo test                 # every case of the 272; the named ones listed with their reasons; both counts printed
cargo vectors              # the same as a program (exit 0: every case outside the named list passes)
cargo vectors-words        # and each command's whole stdout and stderr compared as well
```

At writing (2026-10-26, rustc 1.93.0 on Windows):

```
canonical 15, strict 64, hashes 30, ed25519 67, ledger 47, frag 20, workgraph 24
272 cases; passed 267, named (not supported) 5, failures 0
```

The five named cases are each a claim the Node tool re-performs, and they are listed in `src/vectors.rs` (`NAMED`):

| case (part `frag`) | Node answers | this reader answers | why |
|---|---|---|---|
| a release frag: intact and re-performed | 0 | 2 | whether an engine label is closed below an open one is the engine's to say; this reader carries no engine |
| the issuer pinned by a key file given on the command line | 0 | 2 | the same release claim |
| a pin that differs from the tree: noted, not tampering | 0 | 2 | the same release claim |
| a verdict frag that replays PASS (with a contract, evidence and history) | 0 | 2 | the verdict is not replayed here |
| a verdict frag that replays FAIL | 1 | 2 | the verdict is not replayed here; exit 1 would say a replayed FAIL |

A named case that starts to pass fails the test, so the list cannot go stale silently. The case "a verdict frag that replays
PASS-WITH-OPEN" passes on its exit and first lines (2, "intact; some of it cannot be told here."), for another reason than Node's:
here the verdict was not replayed; there it replayed to PASS-WITH-OPEN. Its later lines say which.

With the whole streams compared, 83 of the 91 passing command cases agree byte for byte on stdout and stderr (the JSON objects
`verify`, `summary` and `verify-signature` print included). The 8 that differ: 2 usage texts, which name this program; 6 where this
reader says it cannot tell what Node re-performed. Of the strict reader's 64 refusal sentences, 62 agree word for word; the 2
others are the reason given for text that is not JSON at all, which is the runtime's (V8's), not the format's.

## How byte parity is kept

- **Strings are UTF-16 code units** (`json::JStr`), as JavaScript holds them: a lone surrogate is data and is written `\udxxx`;
  keys sort by code unit, so a surrogate pair sorts before U+FFFF.
- **Numbers are doubles** read by Rust's correctly rounded parser, and written by ECMAScript's Number-to-String: the shortest
  digits that read back exactly (Rust's own shortest round-trip digits), placed by the specification's rules (`1e+21`, `1e-7`,
  `0.000001`, `-0` as `0`).
- **Canonical JSON** (array-index keys first, numerically, then every other key by code unit), `JSON.stringify` compact and with
  an indent of two, and `JSON.parse`'s handling of a repeated key (its first place, its last value) are written by hand. No JSON
  library is used, so no library's choices can move a byte.
- **The strict readers** follow the engine's `parseJsonStrict` (nesting counted from 1, limit 256) and the work graph's
  `parseStrict` (counted from 0, limit 64), in their order and their sentences, with characters counted in UTF-16 code units.

## Ed25519

Verification is ed25519-dalek's `verify` (not `verify_strict`), which is the equation OpenSSL uses and the vectors pin: a key's
y is read mod p (the identity written with y = p + 1 verifies with R the identity and s = 0, over any message), s at or past the
group order is refused, and R is compared by its encoding (an R written with y = p + 1 never matches). There is no small-order
check: a pinned key or fingerprint is what excludes such keys, as it is for Node. Signatures are read as Node reads base64 (a
character outside the alphabet skipped, the URL-safe alphabet read, padding optional, a trailing newline skipped). A PEM with CR
LF line endings is read, a private key where a public key goes is read as its public half (the public key is derived; nothing is
signed), and a key of another algorithm never verifies.

## The commands

```
riposte-record-cli ledger verify <ledger.jsonl> [--key <public.pem>] [--require-signed] [--head <hash>] [--no-sidecar]
riposte-record-cli ledger summary <ledger.jsonl> [--no-sidecar]
riposte-record-cli ledger fingerprint <key.pem> [--short]
riposte-record-cli ledger verify-signature <envelope.json | bundle.json> [--trusted-key <public.pem | 64-hex>]
riposte-record-cli frag open <frag folder> [--tree <repository root>] [--record <frags.jsonl>] [--issuer <ISSUER.json | key.pem>]
riposte-record-cli workgraph open <file.workgraph.json> [--json]
riposte-record-cli workgraph status [--json] [--store <dir>]
riposte-record-cli workgraph digest <id> [--detail] [--store <dir>]
riposte-record-cli workgraph charter check <charter.json>
```

| program | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `ledger verify` | verified | not verified: `BROKEN: chain`, a line the strict reader refuses, a signature that does not verify or is not the `--key`'s, a cut or rewrite the head record shows, no head record without `--no-sidecar`, a `--head` not in the chain, a torn tail | | a usage error, a file that cannot be read or is not UTF-8, a line before the last that is not JSON, or what this reader does not do (named) | |
| `ledger summary` | the chain and the head record hold | either does not | | as above | |
| `ledger verify-signature` | the signature verifies (and is the trusted key's when one is given) | it does not, another key signed it, or the file carries no envelope | | a usage error, a file that cannot be read or is not a verdict | |
| `frag open` | never given here: every frag kind (bench, verdict, release) carries a claim this reader does not re-perform | | intact; something cannot be told here | not a frag, or a usage error | `FRAG TAMPERED OR NOT AS RECORDED` |
| `workgraph open` | intact | | intact; something cannot be told here | not a deposited file, or a usage error | `DEPOSIT TAMPERED OR NOT AS WRITTEN` |
| `workgraph status`, `digest` | read | refused: `store_tampered` and the other codes of the work graph's SCHEMA.md section 12 | | a usage error | |
| `workgraph charter check` | every party signed | refused | a party named but not signed | a usage error | |

Not here: `rule`, `sign`, `case`, `build`, `release`, `init`, `add`, `deposit`, `charter sign` (they write); `verify --proof`;
work-frag chains (`frag open <chain.json>`); `frag open --json`; `digest --compare`; `open --into`.

## The C ABI and WebAssembly

`include/riposte_record.h` (written by hand; no header generator was at hand) declares, each over buffers:

- `riposte_verify_frag(ptr, len)`: one frag.json. 2 the id and the signature verify by the key it carries, 3 not a frag, 4 tampered.
- `riposte_verify_frag_issued(ptr, len, issuer_ptr, issuer_len)`: the same with the issuer's key. 0 the issuer signed it.
- `riposte_verify_ledger(ledger, len, head, head_len, key, key_len, require_signed)`: `ledger verify`'s exit code; a NULL head
  record is `--no-sidecar`, a NULL key pins none.
- `riposte_record_abi_version()`, and `riposte_alloc` / `riposte_free` for a host without an allocator.

`cargo build --release` writes the shared library (`riposte_record.dll` with `riposte_record.dll.lib`, `libriposte_record.so` or
`.dylib`) and the static one. `tests/c/smoke.c` is a C caller; on Windows it was compiled with MSVC 19.29 against the import
library and run on the vectors' own fixtures: frag 2, frag with the issuer 0, ledger with its head record and key 0, ledger with
one bit flipped 1.

For WebAssembly, the same library builds as `riposte_record.wasm` with one command once the target is installed:

```
rustup target add wasm32-unknown-unknown
cargo wasm        # = cargo build --release --lib --target wasm32-unknown-unknown
```

The buffer functions need no filesystem; the file-reading commands do, so they are for native builds. The WebAssembly build was
not run when this sheet was written (the target was not installed on the machine that wrote it).

## Where this reader and the Node tools can differ (kept, and named)

- The reason given for text that is not JSON at all is this reader's own, not V8's.
- Usage texts name this program.
- Where Node re-performs a release, a verdict or a bench table, this reader answers can't tell (exit 2).
- A failed read is reported in Node's words for the common cases (ENOENT, EISDIR, EACCES); other operating-system errors in Rust's.

## Later, and not done here

- The verify core (canonical JSON, the strict readers, Ed25519, the ledger over a buffer, a frag.json over a buffer) uses no
  filesystem; splitting it into a `no_std` + `alloc` crate, apart from the commands, is the step that would let a zero-knowledge
  VM that runs ordinary Rust prove a verification. Its proof would have to be checked against these vectors before it is called
  equivalent to a run.
- `frag open --json` and the work-frag chains.

## Licence

Apache-2.0, as the rest of this folder (`SPDX-License-Identifier: Apache-2.0` in each file). The dependencies, read from their
own manifests: sha2, digest, block-buffer, crypto-common, typenum, cpufeatures, cfg-if, ed25519 and signature (MIT or
Apache-2.0); generic-array (MIT); ed25519-dalek, curve25519-dalek and subtle (BSD-3-Clause), whose notices a binary distribution
carries.
