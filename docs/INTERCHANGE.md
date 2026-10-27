# Verdict interchange

This page states, as one protocol, what a party needs to exchange a Riposte verdict and check it without the
engine's source code: the objects, the canonical JSON rule, the hash binding, what is refused before hashing, what a replay
does not compare, strict mode, the ruleset and engine labels, `rule_now`, and the exit codes. It is written from the replay
contract, [`packages/verify/docs/REPLAY.md`](../packages/verify/docs/REPLAY.md), and the verdict schema,
[`packages/verify/docs/VERDICT-SCHEMA-v0.md`](../packages/verify/docs/VERDICT-SCHEMA-v0.md). **Where this page and
`REPLAY.md` could be read differently, `REPLAY.md` governs.** It is written for engine 0.7.1, an open label: a verdict issued
under it can still change on a later 0.7.1 build (root `README.md`, "Install").

The conformance suite for this page is [`conformance/`](../conformance/SPEC.md).

## 1. Two kinds of verifier

A verdict binds its inputs, not its outcome (section 4). So there are two levels of checking, and a verifier says which
one it performs.

- **A binding verifier** recomputes `input_hash` from the inputs and `verdict_id` from the identity parts (section 4). It can
  say that the verdict names these inputs, these rules and this engine. It cannot say the outcome is right: a verdict with
  its outcome flipped keeps a valid id. Its best answer is the replay's exit 2, "structure verified; the outcome was not
  re-performed".
- **A re-performing verifier** also runs the check again, under the ruleset version and the engine version the verdict
  names, and compares the new verdict with the presented one byte for byte, outside the exempt set (section 7). Only it can
  answer VERIFIED (exit 0). The engine's replay command is one: `node packages/verify/dist/cli.js replay <bundle.json>`.

A reference binding verifier in Python, one file and the standard library only, is `conformance/riposte_bind.py`
(`python3 conformance/riposte_bind.py <bundle.json>`). It applies the refusals of section 5, the remedy strip of section 4,
a restated tolerance override and the `issued_at` check, and it does not check an envelope's signature. A declarative
ruleset that names pinned algorithms is outside what it binds (exit 3).

## 2. The objects

- **A verdict** is the JSON object the engine writes (`VERDICT-SCHEMA-v0.md`, "Shape"). The fields this protocol reads to
  bind it are `verdict_id`, `input_hash`, `ruleset` (`id`, `version`), `engine_version` and, from engine 0.2.0,
  `remedy_table_hash`. A verdict that lacks one of `verdict_id`, `input_hash`, `ruleset {id, version}` or `engine_version`
  as a string is not a verdict for replay.
- **A replay bundle** is `{ "verdict": <verdict or envelope>, "inputs": <its inputs>, "options"?: { "tolerance", "document" } }`.
  It carries its own inputs. Other keys are the holder's metadata. A re-performing verifier compares none of them: it names
  them on every run as carried, not checked, and strict mode refuses them (section 8); so do a key in `options` other than
  those two and a key beside a signed envelope's four members. Two caller keys at a bundle's top level, `id` and `note`, are
  allowed: named on every run as `carried (allowed): id, note`, never compared, and not refused in strict mode. Bundles travel one per `.json` file, one per line in a `.jsonl`
  file, or as the `*.json` and `*.jsonl` files of a folder. An array of bundles in one `.json` file is not a bundle form
  (`REPLAY.md` names none; the engine refuses it, exit 3).
- **A signed envelope** is `{ "verdict", "alg": "ed25519", "public_key", "signature" }`, the signature over the canonical
  JSON of the verdict (section 3). It may stand where a bundle's `verdict` stands.

## 3. Canonical JSON

`canonical_json(x)` is the one byte string every party writes for a parsed JSON value `x`. A verifier reproduces it byte for
byte:

- **No whitespace.** No indentation and no spaces between tokens.
- **Arrays keep their order.** An `undefined` element is written `null` (it cannot come from a JSON file).
- **Object keys.** A property whose value is `undefined` is dropped. The remaining keys are written in this order:
  1. every key that is an **array index**, in ascending numeric order. An array index is a string of decimal digits with no
     leading zero (or `"0"` itself) whose value is at most 4294967294. So `"9"` comes before `"10"`.
  2. every other key, sorted by **UTF-16 code unit**. `"-1"`, `"01"`, `"4294967295"`, `"B"` and `"a"` are in this group, in
     that order.

  `{"b":1,"10":2,"9":3}` is written `{"9":3,"10":2,"b":1}`. A plain sorted-keys writer (Python's
  `json.dumps(sort_keys=True)`) and RFC 8785 (JCS) both write `{"10":2,"9":3,"b":1}` and get a different hash. Apart from
  this key order the output matches RFC 8785, with one more exception: a lone surrogate, which RFC 8785 rejects, is written
  as a `\uDXXX` escape.
- **Numbers** are written as JavaScript writes a double, the shortest form that reads back exactly: `6125.0` is written
  `6125`, `1e21` is written `1e+21`, `-0` is written `0`.
- **Strings** are escaped as JavaScript's `JSON.stringify` escapes them: `"` and `\`, the control characters as
  `\b \f \n \r \t` or `\u00XX`, and a lone surrogate as `\uDXXX`. Every other character is itself, encoded as UTF-8 for
  hashing.
- **A key named `__proto__`** is data, kept like any other key.

## 4. The hash binding

```
input_hash        = sha256( UTF-8 bytes of canonical_json(inputs) )                        64 hex characters
remedy_table_hash = sha256( UTF-8 bytes of canonical_json(remedy table) )                  engine 0.2.0 and later
verdict_id        = first 32 hex characters of
                    sha256( "<input_hash>:<ruleset.id>@<ruleset.version>:<engine_version>[:<remedy_table_hash>]" )
document.extraction_hash = sha256( UTF-8 bytes of canonical_json(the extraction) )         declarative and built-in engines
source_hash       = sha256( UTF-8 bytes of the page text )                                  on every quote span
```

- The bracketed fourth part is present exactly when the verdict's engine binds its remedy table: engine 0.2.0 and later.
  A verdict of engine 0.0.1 or 0.1.0 derives its id from the first three parts. A verdict of engine 0.2.0 or later that
  carries no `remedy_table_hash` does not replay.
- **A binding verifier takes `remedy_table_hash` as the verdict carries it.** The remedy table of a built-in ruleset is
  the engine's, not part of the inputs, so only a re-performing verifier re-derives the remedies the hash covers.
- `verdict_id` is 128 bits of a sha256, by design: an identifier. The full 256-bit `input_hash` beside it is what binds the
  inputs. The outcome is not in the id.
- **The inputs** are the object the engine hashed, and a bundle carries it as `inputs`:
  - a built-in ruleset (`invoice`, `pay-app`): `{ extraction, references: { contract, evidence, history }, source,
    tolerance? }`, an absent reference written `contract: null`, `evidence: []`, `history: []`, and `source: null` without
    page text;
  - a declarative ruleset: `{ extraction, ruleset, source?, tolerance?, evidence?, supplied_choices?, archive_files? }`,
    where `ruleset` is the ruleset with its declared remedies set aside;
  - **the remedy strip (the engine's input identity).** Setting the remedies aside means exactly this: in the ruleset, the
    `remedy` key is removed from each entry of `checks` and of `quotes` that has one, and every other key is kept. A bundle
    may carry the ruleset with its remedies in place; a verifier applies the strip before hashing. (In the pack,
    `peppol-0.2.0-blind-with-source` and `peppol-0.2.0-garbled-vat` carry a `remedy` key on 11 of their `checks`, and
    reproduce their `input_hash` only after the strip.)
  - a legal verdict (ruleset `legal`): `{ citations, sources }`, hashed as carried;
  - `source`, when given, is an object, never the bare text: `{ "text": "<the page text>", "quotes"?: [...], "values"?: [...] }`;
  - `tolerance`, when an override was given, is its identity: `{ "rel", "absCap", "rounding"?, "roundingCap"?: { "perLine":
    [...], "cashStep": [...] } }`, each list as given, an absent list written `[]` (section 6).
- **Algorithm pins (engine 0.4.0 and later).** When a declarative ruleset names pinned algorithms, its identity carries
  their pins, so `input_hash` binds the implementation and the quoted source of each. A party recomputing such an
  `input_hash` needs the pins; the verdict carries them in `algorithms`.

## 5. What is one input, and what is refused

The hash is taken over the inputs **as parsed**, not over a file's bytes.

**The same input** (replays VERIFIED, by design): the same JSON with its keys in another order, minified or indented, with
CRLF or LF line endings between tokens; `6125`, `6125.0`, `6.125e3` and `612500e-2`, when that decimal is exactly the number
it reads as; a string written with an escape (`"\u004f"`) or as the character (`"O"`).

**A different input** (a replay FAILS on the binding): a string `"6125.00"` against the number `6125`; any change to a
string's characters; any change to the page text, byte for byte, its line endings, a trailing newline and a byte-order mark
included.

**Refused before hashing** (every engine version, from 2026-10-05; the command line exits 3 and names the place). These
cannot be hashed faithfully, so no verdict binds them:

| input | refusal names |
|---|---|
| text that is not valid UTF-8 (a fatal decoder; a byte-order mark at the start of a text file is valid and kept as U+FEFF) | the byte offset |
| a JSON number past the double range (`1e999`, `-1e999`) | the JSON path: `the number at $.payable_amount is not finite` |
| a JSON number whose text names a decimal no double holds (`9007199254740993`, `0.10000000000000001`, `1e-400`) | the JSON path and the words "a number that cannot be represented exactly; write amounts as strings with two decimals" |
| a key written twice in one JSON object | the JSON path of the first repeated key: `the key "outcome" appears twice in one object (at $.verdict.outcome)` |
| JSON nested more than 256 levels deep (from 2026-10-06) | the character where the deepest level opens |
| a JSON file that starts with a UTF-8 byte-order mark | `file starts with a UTF-8 byte-order mark; remove it` |

The exactness rule compares two decimals: the one the number's text names, and the one canonical JSON writes for the double
it reads as. Each is reduced to its sign, its significant digits and its exponent; the number is accepted when they are
equal. So `6125`, `6125.0`, `6.125e3`, `0.1`, `0.30000000000000004` and `-0` are accepted. A number written as a string is
hashed as its characters, never rounded.

Two further parts of the number rule apply from engine 0.6.0 only, because they change what the engine reads: a library
caller's parsed number past 2^53 − 1 in magnitude is refused, and a string amount with more digits than a double holds is
read as not a number (the checks that need it answer can't tell, `INSUFFICIENT_DATA`). A verdict that names an earlier engine
re-performs exactly as it was issued.

## 6. The tolerance override

A rounding-tolerance override is part of the input. Wherever a verdict is issued or replayed its shape is checked strictly
(from 2026-10-05): `rel` and `absCap` are finite numbers of at least 0, `roundingCap.perLine` and `roundingCap.cashStep` are
arrays of rule-id strings, `rounding` is `"infer"` or `"none"`, and no other key is present. A valid override hashes exactly
as it did before that date.

## 7. Re-performance and the exempt set

A re-performing verifier compares everything in the presented verdict with the re-performed one, except:

| field | why | under strict mode |
|---|---|---|
| `issued_at` | the one field allowed to vary between runs; it must still be an ISO-8601 timestamp, or the verdict is refused (exit 3) | fails when it is missing |
| `channel`, `ledger`, `declared_accuracy`, `action_context`, `case` | added after the engine: a channel stamp, a ledger stamp, a measured accuracy, the action a check was asked about, the arbitration link of a re-verdict | fails |
| `document.producer` | the caller's label for the extractor; carried into the re-run as given and compared in place, so a producer that is not a string diverges | reported as a note, never failed |
| `remedies`, only for a verdict of engine 0.0.1 or 0.1.0 that carries none, and only with `--lenient-remedies` | those engines did not bind their remedy table | fails |

Every match names the fields it did not re-perform. `gate_status` (engine 0.6.0) is a pure function of the verdict and is
re-derived and compared like any engine output; a doctored `gate_status` diverges.

**Deleted remedies are refused by default.** A verdict of engine 0.0.1 or 0.1.0 that carries no remedies, where the engine
re-derives some, fails at `remedies` (exit 1). Where the engine re-derives none, as for the three engine 0.0.1 verdicts of
the pack that carry no remedies, a verdict carrying none is what that engine issued, and it replays. From engine 0.2.0 the remedy table is bound by `remedy_table_hash`, so deleting
remedies is a divergence with or without the flag.

## 8. Strict mode

`--strict` fails a match (exit 1) when it carries an annotation (`channel`, `ledger`, `declared_accuracy`, `action_context`,
`case`), when its remedies were re-derived, when its envelope's key is not pinned with `--trusted-key`, or when `issued_at`
is missing. It also fails when the file carries a key outside the verdict and its inputs (section 2), other than a bundle's
two allowed caller keys `id` and `note`, naming it: `outside
keys under --strict: <keys>`. It lists why (`strict.problems` for one verdict; `strict_problems` per case and `strict_failed` in a folder).
`document.producer` does not fail it; it is reported (`strict.notes`, `strict_notes` per case), because neither
`input_hash` nor `verdict_id` binds it.

## 9. Signatures and the pinned key

An envelope carries its own public key, so a valid signature proves only that the holder of that key issued the verdict.
`--trusted-key <k>` pins the key, by a public key file, an inline PEM, or the full 64-hex fingerprint (sha256 over the DER
bytes of the key's SubjectPublicKeyInfo, lowercase hex). A shorter prefix is refused. With a pinned key, an envelope signed by
any other key, and a verdict with no signature, FAIL (exit 1). A private key is refused.

## 10. Ruleset and engine labels

- **The ruleset label** is `ruleset.id@ruleset.version`, and **the engine label** is `engine_version`. Both are inside
  `verdict_id`, so the same inputs under another rule or another engine are another verdict.
- A re-performing verifier runs the check under the ruleset version and the engine version the verdict names, never under
  today's defaults. A verdict issued under an older rule can therefore replay VERIFIED while today's rule would read the same
  inputs differently. A match names both: `re-performed with legal (ruleset legal@0.0.1, engine 0.6.0)`.
- **Accepting only some rule versions** is the relying party's statement: `--require-ruleset <id>@>=<version>`, repeatable.
  A verdict that names that ruleset at an older version FAILS (exit 1) although it re-performs byte-identical. A requirement
  that matches no verdict is noted and does not fail. Quote the value in a shell: `--require-ruleset 'legal@>=0.4.0'`.

## 11. `rule_now`: today's reading

When today's default version of a verdict's ruleset, under this engine, reads the same inputs differently, the replay says
so beside the match, and the JSON carries it as `rule_now`. It is a reading, not a re-issue: the verdict still replays as it
was issued.

- A legal verdict: `under today's default legal@<version> this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not
  PASS`, or, with several quotations, the verdict's gate under today's rule and one line per quotation that moved (at most ten).
- A declarative or built-in verdict (`peppol-en16931`, `invoice`, `pay-app`; from 2026-10-06): `under today's default
  peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN; 2 checks read differently:`, then one line per
  check, with `noun` in the JSON.
- A verdict of an older engine adds ` (engine <this build's engine>)` after the rule. An AP proof of an older engine carries
  the same kind of line for the gate's decision: `under engine <this build's engine> this would read …`.

## 12. Outcome and gate

A verdict has three outcomes: `PASS`, `FAIL`, `INSUFFICIENT_DATA`. A gate reads four, and from engine 0.6.0 the verdict
records the reading as `gate_status`, the key right after `outcome`:

| on screen | `gate_status` | meaning |
|---|---|---|
| PASS | `PASS` | every check ran and held |
| PASS-WITH-OPEN | `PASS_WITH_OPEN` (`outcome` stays `PASS`) | every check that ran held, but at least one could not run |
| FAIL | `FAIL` | a check found a figure or quotation that does not agree |
| can't tell | `INSUFFICIENT_DATA` | no check could run |

Anything that acts on money reads `gate_status`, not only `outcome`. A verdict of an earlier engine carries no `gate_status`;
a reader recomputes it from the claims.

## 13. Exit codes

The replay's exit codes, as `REPLAY.md` defines them:

| exit | one verdict | a folder or `.jsonl` |
|---|---|---|
| 0 | VERIFIED: re-performed and byte-identical | every case MATCHes |
| 1 | FAILED: the binding, the re-performed outcome, the remedies, the signature, the trusted key, `--strict`, or `--require-ruleset` | a case DIVERGED, a `--strict` failure, or a case under a rule older than `--require-ruleset` accepts |
| 2 | structure verified; the outcome was not re-performed | none diverged, some were not re-performed |
| 3 | not a verdict (or one whose `issued_at` is not a timestamp), a usage error, an input that cannot be read or is refused before hashing, or an input the verdict names was left out | a case was refused |

In a folder or a `.jsonl`, a refused case wins: the exit is 3 whenever a case was refused, whatever the other cases did, so a
case that cannot be read is never hidden behind another's exit 1. A binding verifier (section 1) uses the same scale and never
exits 0.

## 14. Streams

The JSON goes to stdout; every line a person reads (the headline, the remedies, a refusal) goes to stderr. The JSON's
`answer` is `PASS`, `FAIL` or `INSUFFICIENT_DATA`.

## 15. The gate for agents

The gate an agent calls ([the agents page](doors/agents.md)) emits the same verdict and the same proof the engine's commands
emit, and nothing else: the MCP tools `ap_gate` (the plugin's server) and `verify` (the gate server) return
`{ "verdict", "inputs" }` as section 2 defines a replay bundle, with the verdict's `scope` block and its `gate_status`. A
host that keeps that proof needs no gate, no ledger and no network to check it later: `node packages/verify/dist/cli.js
replay proof.json`, the gate server's `replay` tool, the plugin's `replay_receipt` and `POST /v1/replay` all re-perform it
under the ruleset and engine labels it names and compare byte for byte, outside the exempt set of section 7, and a proof
whose inputs changed by one figure fails at `input_hash`, naming the field. The same proof replays MATCH through each of
them, with the same `verdict_id`, because each runs the same engine on the same canonical bytes (section 3). The ledger
the plugin's server writes adds a receipt per answer, hash-chained; an `ap_gate` receipt stores the verdict's hash and id,
the input hash and each document's sha256 and length, so a kept proof binds to its receipt before it is re-performed. The
ledger is checked offline the same way (`riposte-ledger verify`, with a pinned key or a recorded head as the trust anchor).
