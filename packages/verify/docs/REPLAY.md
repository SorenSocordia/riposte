# Replay: what it re-performs, what it hashes, what it does not compare

`verify replay` checks a verdict you were handed. Its `verdict_id` binds the verdict to its inputs. With the inputs, the check
is run again by this build's engine, under the engine version the verdict names, and the new verdict is compared with the
presented one byte for byte. This page is the contract an independent verifier needs: what a replay is given, how the inputs
are hashed, which fields are not compared, the order of the lines it prints and what each exit code means. It states the rules
of this build; every rule holds for the verdicts of every engine the build carries (`verify --version` lists them),
except where a line says otherwise. When each rule arrived, and what it replaced, is in `CHANGELOG.md`, "How the replay contract
changed".

## The identity chain

```
input_hash        = sha256( UTF-8 bytes of canonical_json(inputs) )                        64 hex characters
remedy_table_hash = sha256( UTF-8 bytes of canonical_json(remedy table) )                  engine 0.2.0 and later
verdict_id        = first 32 hex characters of
                    sha256( "<input_hash>:<ruleset.id>@<ruleset.version>:<engine_version>[:<remedy_table_hash>]" )
document.extraction_hash = sha256( UTF-8 bytes of canonical_json(the extraction) )         declarative and built-in engines
source_hash       = sha256( UTF-8 bytes of the page text )                                  on every quote span
```

The verdict id is 128 bits of a sha256, by design: it is an identifier, and the full 256-bit `input_hash` beside it is what
binds the inputs. The outcome is not in the id. A verdict with its outcome flipped keeps a valid id, which is why a replay
re-performs the check instead of trusting the id.

`inputs` is the object `verifyInputs(extraction, options)` builds (`src/protocol/inputs.ts`), the same builder the engines
hash with. A bundle carries this object as its `inputs`.

- **A built-in ruleset** (`invoice`, `pay-app`): `{ extraction, references: { contract, evidence, history }, source,
  tolerance? }`. An absent reference is `contract: null`, `evidence: []`, `history: []`. `source` is `null` without page text.
- **A declarative ruleset**: `{ extraction, ruleset, source?, tolerance?, evidence?, supplied_choices?, archive_files? }`,
  where `ruleset` is the ruleset with its declared remedies set aside.
- **`source`**, when given, is an object, never the bare text: `{ "text": "<the page text>", "quotes"?: [...], "values"?: [...] }`.
- **`tolerance`**, when an override was given, is its identity: `{ "rel", "absCap", "rounding"?, "roundingCap"?: { "perLine":
  [...], "cashStep": [...] } }`, each list as given (an absent list is `[]`). See "The tolerance override" below.

## What a replay is given

- **A verdict**, with the flags that rebuild its inputs (`--extraction` with `--ruleset`, `--source`, `--quotes` and the
  others the verdict was made with, or `--inputs`). Without any of them it is checked for structure only (exit 2), and the
  line names the flags it needs; with some of them but not all, the replay names the ones left out (exit 3) before any hash
  is compared.
- **A signed envelope** (below, "Signatures and the trusted key"), with the same flags.
- **A bundle**, `{ "verdict": <verdict or envelope>, "inputs": <its inputs>, "options"?: { "tolerance", "document" } }`. It
  carries its own inputs, so the replay takes no input flag. A `.json` file holds one bundle, a `.jsonl` file one per line,
  and a folder's `.json` and `.jsonl` files are replayed case by case, each on its own inputs (a folder inside it is named,
  with the command that replays it, and is not walked).
- **The output of `ap --input`**: its `proof` member (the verdict and the inputs it was issued on) is replayed, and the file's
  own verdict must be that proof's verdict (exit 1 when it is not). The decision beside the verdict is compared too (below,
  "The decision beside an AP verdict").
- **The output of `ap` on an emailed bill.** The output of `ap` on an emailed bill carries, as its `read` member, the sha256
  of the text and of the payment history it read (never the documents) and the policy it was made under, so `replay
  result.json --source bill.txt --history history.json` (or `--invoice`, `--po` and `--receipt` for a bill read from three
  files) re-performs it from those files. A file left out is named, exit 3, and a file that is not the one the result was read
  from is a failed replay, exit 1, named before any hash is compared; `AP-INPUT.md`, "Running it", has the recipe. When the
  replay is not given those files, it compares nothing `read` records, so it names `read` as carried, not checked. When it is
  given them, the decision beside the verdict is compared too (next paragraph).

**The decision beside an AP verdict.** The output of `ap` carries, beside its verdict, what the AP gate decides on it:
`decision`, `payable`, `grounding`, `reasons` and `not_checked`, and, when `--allow-open` was given, `exit` and `allow_open`.
These are what a person acts on, so once the verdict re-performs, a replay derives each of them again from the verdict's own
inputs, under the verdict's engine and ruleset, and compares it with the file's (canonical JSON against canonical JSON). The
five must all be present, `exit` and `allow_open` come as a pair, and the output of `ap` holds no other key: not beside its
members, not inside `read`, not inside `proof`. Any field that differs, is missing, or is a key `ap` never writes fails the
replay, exit 1, with or without `--strict`. The first line names the fields (``FAILED: the outcome re-performed
byte-identical, but the file is not what `ap` wrote for it: decision, payable, reasons, not_checked``), one line under it per
field says what the file states and what the verdict derives (`decision: the file states "approve"; the verdict,
re-performed, derives "hold_quantity"`), and the last line says what the re-performed verdict decides. The JSON says
`status` `FAILED` and lists the differences in `ap_result`. A bundle (`{ verdict, inputs }`) need not state these fields;
when it states any of them beside an AP verdict (`ap-threeway` or `ap-structured`), those are compared the same way, and one
that differs fails the replay (`DIVERGED` in a folder, over HTTP and over MCP, at the field's name). A field that was
compared is not named as carried. A genuine file replays exactly as it did, with nothing added to its JSON or its lines.

**Keys outside the verdict and its inputs.** A key a bundle or a signed envelope does not define (beside a bundle's
`verdict`, `inputs` and `options`, an `options` key the replay does not read, beside a signed envelope's four members, or
beside the four members of an envelope that is a bundle's verdict) is refused before anything is hashed (2026-10-19): exit 3,
the first line `verify replay: input refused: the bundle carries a key its format does not define: <keys> (…)`,
`unknown_keys` in the JSON, a REFUSED case in a folder, 422 over `POST /v1/replay`. `--allow-unknown-keys` reads such a key as
before: every replay names it on the line under its first line (`carried, not checked: <keys>`, and `carried_not_checked` in
the JSON), the next line says the flag was given (`allow_unknown_keys: "stated"` in the JSON), and `--strict` refuses it (exit
1, `outside keys under --strict: <keys>`). Beside an AP verdict whose inputs the gate reads, the gate's fields a bundle states
are compared, not refused. Beside the members `ap` writes, a key the command never writes fails the replay once the verdict
re-performs (above), and is carried, not checked, when it was not re-performed. A bare verdict carries none: every key in it
is compared.

**Two caller keys are allowed.** `id` and `note` at a bundle's top level are named on every replay as
`carried (allowed): id, note` (`carried_allowed` in the JSON), are never checked, and `--strict` does not refuse them; anywhere
else (beside a signed envelope's members, in `options`, beside `ap`'s output) they are outside keys like any other.

## The hash contract

### Canonical JSON, exactly

`canonical_json` is `canonicalize` in `src/verdict/canonical.ts`. An independent verifier must reproduce it byte for byte:

- **No whitespace.** The output is `JSON.stringify` of a normalized copy, with no indentation.
- **Arrays keep their order.** An `undefined` element becomes `null`.
- **Object keys.** A property whose value is `undefined` is dropped. The remaining keys are written in this order:
  1. every key that is an **array index**, in ascending numeric order. An array index is a string of decimal digits with no
     leading zero (or `"0"` itself) whose value is at most 4294967294. So `"9"` comes before `"10"`.
  2. every other key, sorted by **UTF-16 code unit** (JavaScript's default string sort). `"-1"`, `"01"`, `"4294967295"`,
     `"B"` and `"a"` are in this group, in that order.

  Example: `{"b":1,"10":2,"9":3}` is written `{"9":3,"10":2,"b":1}`. A literal "keys sorted" implementation, Python's
  `json.dumps(sort_keys=True)` and RFC 8785 (JCS) all write `{"10":2,"9":3,"b":1}` and get a different hash. Apart from this
  key order, the output matches RFC 8785, with one more exception: a lone surrogate, which RFC 8785 rejects, is written as a
  `\uDXXX` escape.
- **Numbers** are written as JavaScript writes a double (ECMAScript Number-to-String, the shortest form that reads back
  exactly): `6125.0` is written `6125`, `1e21` is written `1e+21`, `-0` is written `0`.
- **Strings** are written with `JSON.stringify`'s escaping: `"` and `\`, control characters as `\b \f \n \r \t` or `\u00XX`,
  and a lone surrogate as `\uDXXX`. Everything else is the character itself, encoded as UTF-8 for hashing.
- **Other values.** A `Date` is written as its ISO-8601 string. A bigint is written as its decimal string. A function or a
  symbol is written as `null`. None of these can come from a JSON file.
- **A key named `__proto__`** is data, kept like any other key.

### What counts as the same input

The hash is taken over the inputs **as parsed**, not over the file's bytes. So these are the same input, and replay as
VERIFIED, by design:

- the same JSON with its keys in another order, minified or indented, with CRLF or LF line endings between tokens;
- `6125`, `6125.0`, `6.125e3` and `612500e-2`: every spelling of one decimal, when that decimal is exactly the number it
  reads as;
- a string written with an escape (`"\u004f"`) or as the character itself (`"O"`).

These are different inputs, and a replay refuses them on the binding: a string `"6125.00"` against the number `6125`, any
change to a string's characters, and any change to the page text, byte for byte. That includes its line endings, a trailing
newline and a byte-order mark.

A key written twice in one JSON object is neither: it is refused (next section), because two JSON readers can disagree about
which of the two values the document holds. So is a number whose text names a decimal no double holds, such as
`6125.0000000000001` or `9007199254740993`: the hash would bind the rounded number, not the one written.

### What is refused before hashing (every engine)

Six kinds of input cannot be hashed faithfully, so they are refused before any engine sees them, with the place named. The
command line refuses them when it reads a file (exit 3). The same refusals hold at every other entry point: `verify()`
itself and the HTTP and MCP servers refuse them too (a library caller gets `InputRefused`, HTTP a 400, MCP an error).

- **Text that is not valid UTF-8.** Every text and JSON file is decoded with a fatal UTF-8 decoder
  (`src/protocol/hash-input.ts`): an invalid byte is refused with its offset (`the bytes at offset 31 (FF 0A 49 73) are not a
  UTF-8 character`), never replaced with U+FFFD, so two files that differ only in their invalid bytes can never share a hash.
  A byte-order mark at the start of a text file is valid UTF-8 and is kept as U+FEFF.
- **A JSON number past the double range.** `JSON.parse` reads `1e999` as `Infinity`, and canonical JSON writes every
  non-finite number as `null`, so `1e999`, `-1e999` and `null` would share one `input_hash`. Such a file is refused with the
  JSON path (`the number at $.payable_amount is not finite`). `verify()` refuses a non-finite number (`Infinity`,
  `-Infinity`, `NaN`) anywhere `input_hash` covers (the extraction, the references, the source, the tolerance, the judge's
  choice values, the archive files), under every engine version. `verifyDeclarative`, called directly, refuses it from engine
  0.6.0; under an earlier engine it reads the number as that engine did. A replay whose inputs hold one FAILS on the binding.
- **A JSON number that cannot be represented exactly.** `JSON.parse` reads `9007199254740993` as `9007199254740992`, so a
  bill with that unit price and an amount of `9007199254740992` would pass its line check, and the verdict would record a
  figure the file does not hold. Such a number is refused with its JSON path and the words "a number that cannot be
  represented exactly; write amounts as strings with two decimals" (`the number at $.line_items[0].unit_price
  (9007199254740993) is a number that cannot be represented exactly; …`). In a replay the advice is the one true of a replay,
  "re-issue the verdict with the amount as a string; a replay of the existing verdict cannot change its input": a string is a
  different input from the number the verdict was bound to, so the replay of that verdict could never match. The rule
  compares two decimals: the one the number's text names, and the one canonical JSON writes for the double it reads as (the
  shortest text that reads back as that double). Each is reduced to its sign, its significant digits and its exponent; a
  number is accepted when they are equal. So `6125`, `6125.0`, `6.125e3`, `0.1`, `0.30000000000000004` and `-0` are accepted
  (zero of either sign is zero), and `9007199254740993`, `0.10000000000000001` (17 significant digits; it reads as `0.1`),
  `123456789012345678901` and `1e-400` (it reads as `0`) are refused. A number past the double range keeps its own refusal
  (above). The CLI, a folder or `.jsonl` of bundles, the HTTP body (a 400 with code `body.inexact_number` when error codes
  are on) and the MCP line are read this way. A library caller hands `verify()` numbers already parsed, with no text left to
  compare, so from engine 0.6.0 `verify()` and `verifyDeclarative()` refuse any number whose magnitude is past
  9007199254740991 (2^53 − 1), naming its path with the same words: past it a double cannot hold every whole number, so the
  value may already have been rounded. A library caller that parses JSON itself can call `parseJsonStrict` (exported) to get
  the text rule too. A number written as a string is hashed as its characters, never rounded; from engine 0.6.0 a string
  amount with more digits than a double holds (`"9007199254740993.00"`) is read as not a number, so every check that needs it
  answers can't tell (`INSUFFICIENT_DATA`, UNPARSEABLE) instead of judging the rounded figure. Amounts written with two
  decimals up to 13 digits before the point always read exactly.
- **A key repeated in one JSON object.** `JSON.parse` keeps the last value, so a signed envelope with `"outcome":"FAIL"`
  written before its real `"outcome":"PASS"` would verify as signed while any reader that keeps the first key (or rejects
  duplicates) saw FAIL. The text is refused with the JSON path of the first repeated key (`the key "outcome" appears twice in
  one object (at $.verdict.outcome)`). The CLI, a folder or `.jsonl` of bundles, the HTTP body and the MCP line are all read
  this way; a library caller holding the envelope's text calls `verifyEnvelopeText`.
- **JSON nested more than 256 levels deep.** No document, verdict or ruleset nests that deep, and the readers that walk an
  input would overflow their stack on it. Such text is refused before it is parsed, naming the character where the deepest
  level opens (`nesting too deep, limit 256: an object or array opens more than 256 levels down (at character 284)`), at the
  same entry points (HTTP code `body.too_deep`).
- **A JSON file that starts with a byte-order mark** is refused with `file starts with a UTF-8 byte-order mark; remove it`.

These refusals apply to every engine version, because such an input never produced a faithful hash under any of them: a
verdict issued on one of them does not replay, because its input is refused. Two parts of the number rule apply from engine
0.6.0 only, because they change what an engine reads rather than what can be hashed: the library's refusal of a parsed
number past 2^53 − 1, and reading a string amount with too many digits as not a number. A verdict that names an earlier
engine re-performs exactly as it was issued.

### The tolerance override

A rounding-tolerance override is part of the input (its identity is hashed; see the inputs above). Its shape is checked
strictly wherever a verdict is issued or replayed: `rel` and `absCap` are finite numbers of at least 0,
`roundingCap.perLine` and `roundingCap.cashStep` are arrays of rule-id strings, `rounding` is `"infer"` or `"none"`, and no
other key is present. So `"perLine": "TAX_INT"` (a string) is refused, naming `tolerance.roundingCap.perLine`: it would hash
alike with `["T","A","X","_","I","N","T"]` (its characters), which the engine reads differently.

## What a replay does not compare (the exempt set)

Everything in the presented verdict is compared with the re-performed one, except:

| field | why it is not compared | how it is reported | under `--strict` |
|---|---|---|---|
| `issued_at` | the one field allowed to vary between runs; it must still be an ISO-8601 timestamp (`2026-10-05T16:03:24.839Z`): a malformed one is refused, exit 3, with or without `--strict` | "issued_at aside" on every match; when it is missing, "the verdict carries no issued_at", with or without `--strict` | fails when it is missing |
| `channel`, `ledger`, `declared_accuracy`, `action_context`, `case` | added after the engine: a channel stamp, a ledger stamp, a measured accuracy, the action a check was asked about, the arbitration link of a re-verdict | named on every run | fails |
| `document.producer` | the caller's label for the extractor; it is carried into the re-run as given and the body is compared with it in place, so a producer the engine would not write (anything but a string) diverges | named on every run | reported as a note, never failed |
| `remedies`, only for a verdict of engine 0.0.1 or 0.1.0 that carries none, and only with `--lenient-remedies` | those engines did not bind their remedy table; with the flag the remedies are re-derived | `remedies absent; re-derived` | fails |

Keys outside the verdict are not in this table: they are not part of the verdict, and a replay refuses them by default (above,
"Keys outside the verdict and its inputs"). An annotation is not compared, but its members are held to its declared shape
(2026-10-19): `action_context` is `{ tool_name, call_id, argument_path }`, `case` is `{ case_id, prior_verdict_id, move_id }`,
`ledger` is `{ tenant_id, retention_until, reviewer }` (the reviewer `{ id, decided_at, decision, note }`), and
`declared_accuracy` is its six measured fields. Any other member (`action_context.approved`) is refused, exit 3, named, with
or without `--strict`; `--allow-unknown-keys` does not reach it, and removing the member (annotations sit outside what the
verdict_id binds) lets the verdict replay.

**Deleted remedies are refused by default.** A verdict of engine 0.0.1 or 0.1.0 that carries no remedies, where the engine
re-derives some, fails the replay at `remedies` (exit 1; `DIVERGED` in a folder): "the verdict carries no remedies; the
engine re-derives 1 remedy for it (engine 0.0.1); a replayed verdict must carry what it said". A bundle is a file its holder
has whole, so a missing list is an edit, not a verdict issued before remedies existed. For a verdict that really was issued
before remedies existed, `--lenient-remedies` compares its core and reports the re-derived remedies, and `--strict` still
fails it. The HTTP and MCP replay routes take the default.

From engine 0.2.0 a verdict binds its remedy table (`remedy_table_hash`), so deleting its remedies is a divergence at
`remedies`, never a match, with or without the flag.

How each mode reports the exempt fields:

- **One verdict.** The first stderr line of a match ends `Not re-performed (not the engine's output): case,
  document.producer.`, and the JSON lists them in `reperformed.annotations`.
- **A folder or a .jsonl of bundles.** Each matching case prints `not re-performed (not the engine's output): …` under its
  line, and the summary JSON lists them by case in `fields_not_reperformed`; the keys a case carries outside the verdict are
  listed the same way, in `carried_not_checked`, and the allowed caller keys in `carried_allowed`. Each case's own JSON is
  unchanged.
- **`--strict`.** A match fails (exit 1) when it carries an annotation (`channel`, `ledger`, `declared_accuracy`,
  `action_context`, `case`), when its remedies were re-derived (`--lenient-remedies`), when its envelope key is not pinned with `--trusted-key`, or
  when `issued_at` is missing. It also fails when the file carries a key outside the verdict and its inputs, other than the two
  allowed caller keys (`outside keys under --strict: <keys>`). It lists why: `strict.problems` for one verdict, `strict_problems` per case and `strict_failed`
  in a folder. `document.producer` does not fail it: strict reports the label (`strict.notes`, `strict_notes` per case),
  because neither `input_hash` nor `verdict_id` binds it and only a signature by a pinned key does.

## Signatures and the trusted key

A signed envelope is `{ "verdict", "alg": "ed25519", "public_key", "signature" }`, the signature over the canonical JSON of the
verdict. The envelope carries its own public key, so a valid signature proves only that the holder of that key issued the
verdict. It does not say who that is.

`--trusted-key <k>` pins the key. `k` is one of:

- a public key file: a PEM block, or `verify keygen`'s JSON output;
- an inline PEM, typed as `--trusted-key "$(cat alice.pub.pem)"` or `--trusted-key="$(cat alice.pub.pem)"` (a value that starts
  with `-----BEGIN ` is read as a key, never as an option);
- the 64-hex key fingerprint: sha256 over the bytes of the key's DER-encoded SubjectPublicKeyInfo, written in lowercase hex.
  `openssl pkey -pubin -in alice.pub.pem -outform DER | sha256sum` prints the same value. Every replay of an envelope prints
  it in full on stderr (`signing key fingerprint <64 hex>`), the JSON carries it as `envelope.key_fingerprint`, and
  `riposte-ledger fingerprint` prints the same value for the same key, so one key has one fingerprint in a runbook. A shorter
  prefix is refused, because a forger can generate keys until one matches a short prefix (12 hex digits are 48 bits of
  work); only the whole value pins a key. `riposte-ledger fingerprint --short` shows the first 16 characters for display,
  never as a pin. The older fingerprint form, sha256 of the base64 text of the DER, is still accepted by `--trusted-key` in
  this release, with a note naming the fingerprint to pin instead (and `envelope.older_fingerprint_form: true` in the JSON);
  nothing prints it.

With it:

- an envelope signed by the trusted key replays as before, and the first line says `by the trusted key`;
- an envelope signed by any other key FAILS (exit 1), even when its signature is valid;
- a verdict with no signature FAILS (exit 1).

When the key is pinned by the older fingerprint form, the first line still says `by the trusted key`, and the note comes
second.

A private key is refused: the trusted key is the public half.

## A verdict under an older rule version

A replay re-performs a verdict under the rule version the verdict names, so a verdict issued under an older rule replays
VERIFIED even when today's default rule would read the same inputs differently. Three things tell the relying party.

- **The VERIFIED line names the rule version:** `re-performed with legal (ruleset legal@0.0.1, engine 0.6.0)`.
- **Today's reading, for a legal verdict.** When today's default legal rule reads the same inputs differently, a line under
  the headline says how, and the JSON carries it as `rule_now`:
  `under today's default legal@<version> this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not PASS`. A
  verdict with several quotations reads `under today's default legal@<version> the verdict reads <gate>, not <gate>; N of M
  quotations read differently:`, then one line per quotation that moved (at most ten). A verdict of an older engine adds
  ` (engine <this build's engine>)` after the rule. In a folder the line sits under the case's line. An AP proof of an older
  engine carries the same kind of line for the gate's decision: `under engine <this build's engine> this would read …`.
- **Today's reading, for a declarative or built-in verdict.** The same line for a `peppol-en16931`, `invoice` or `pay-app`
  verdict made under an older rule or engine, read under today's default version of its ruleset and this engine:
  `under today's default peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN; 2 checks read
  differently:`, then one line per check that reads differently, a check the older rule did not have marked "the recorded rule
  has no such check". The JSON carries it as `rule_now`, with `noun`.
- **`--require-ruleset <id>@>=<version>`**, repeatable, says which rule versions the relying party accepts. A verdict that
  names that ruleset at an older version FAILS, exit 1, with the reason, although it re-performs byte-identical under its
  own rule; the FAILED line is the first line the replay prints, and in a folder the count of such cases leads the case
  lines, each such case is marked REQUIRED, and the count closes them too. A requirement that matches no verdict is noted and
  does not fail. Quote the value in a shell (`--require-ruleset 'legal@>=0.4.0'`): an unquoted `>` is a redirect, and a value
  cut at `@` is refused, exit 3.

## The order of the lines

- **One verdict.** The first line is the replay's answer: `outcome VERIFIED: …`, `FAILED: …`, `structure verified; outcome
  NOT re-performed …` or `input refused: …`. Only a `--require-ruleset` failure is printed before it (above). Under the first
  line come, in this order: the note for a key pinned by the older fingerprint form, the keys carried outside the verdict and
  its inputs, a `--require-ruleset` that applies to no verdict here, then the signing key's fingerprint. When the decision
  beside an AP verdict differs, the lines naming each field come straight under the first line, and the line saying what the
  re-performed verdict decides is last.
- **Which failure is named.** A replay checks in its own order: refusals before hashing, then the signature and the trusted
  key, then the binding (`verdict_id`, `input_hash`), then the outcome, then the remedies, then the decision beside an AP
  verdict, and it names the first failure it meets, so a verdict whose remedies were deleted and whose outcome was changed
  fails at `outcome`. A `--strict` problem is listed only for a verdict whose outcome re-performed byte-identical and whose AP
  fields, if it has them, are the ones it derives.
- **A folder or a .jsonl.** Each case's line comes first, with what it carries and what was not re-performed indented under
  it; the older-fingerprint note follows the case lines, and the summary line is last.

## Exit codes

| exit | one verdict | a folder or .jsonl |
|---|---|---|
| 0 | VERIFIED: re-performed and byte-identical | every case MATCHes |
| 1 | FAILED: the binding, the re-performed outcome, the remedies (deleted from an engine-0.0.1 or 0.1.0 verdict, without `--lenient-remedies`), the decision beside an AP verdict (a field that differs, is missing, or is a key `ap` never writes), the signature, the trusted key, `--strict`, or `--require-ruleset` | a case DIVERGED (at the verdict, or at an AP field its bundle states), a `--strict` failure, or a case under a rule older than `--require-ruleset` accepts |
| 2 | structure verified; the outcome was not re-performed (no inputs, or nothing here re-performs them) | none diverged, some were not re-performed |
| 3 | not a verdict (or one whose `issued_at` is not a timestamp), a usage error, an input that cannot be read or is refused before hashing (a repeated key, a key a bundle or envelope does not define, an annotation member its shape does not declare), or an input the verdict names was left out | a case was refused (not a bundle, not JSON, refused before hashing, a key its bundle does not define) |

In a folder or a .jsonl a refused case wins: the exit is 3 whenever any case was refused, whatever its siblings did, because
a case that cannot be read must never be hidden by a sibling's exit 1; otherwise 1 when a case diverged or failed, then 2,
then 0.

The exit reports the replay, not the verdict: a verdict that reads FAIL or PASS-WITH-OPEN and re-performs byte-identical
replays VERIFIED, exit 0, and its own outcome is in the output. `POST /v1/replay` gives the same exit in its `x-verify-exit`
header, and a status that follows it, so a client or a proxy that reads only the status never takes a forgery for a success:
409 when a case diverged (exit 1: what the request presents conflicts with what its own inputs re-perform to), 422 when a
case was refused (exit 3; a refused case wins, so a batch with a diverged and an unreadable case is 422, never 200); a bundle with a key its format does not define is such a case, and the route has no way to allow it, and 200
when every case matched or none diverged and some were not re-performed (exit 0 or 2). The body is the same summary whatever
the status. A request that names no bundle is 400, with no `x-verify-exit`. The MCP tool `replay_proof` marks its result as
an error when a case diverged or was refused.

## Messages

- **A changed input** reads `FAILED: input_hash does not match the supplied inputs`, then `recorded <hash> (in the verdict)`
  and `computed <hash> (from the inputs given here)`, then the input that disagrees where the verdict records one: the
  extraction (`document.extraction_hash`), whether page text was given, the page text (its sha256 on quote evidence), the
  quotes, the ruleset id@version; for a legal verdict the citations, for an AP verdict the invoice or the bill. When only the
  page text can be at fault, it says to check line endings, a trailing newline and a byte-order mark. The JSON carries
  `recorded_input_hash` and `computed_input_hash`; `expected_input_hash` is the computed one (its name predates the labels).
- **A missing input** names the flags the verdict needs, and the ones left out (exit 3), before any hash is compared.
- **A changed decision beside an AP verdict** reads ``FAILED: the outcome re-performed byte-identical, but the file is not
  what `ap` wrote for it: <fields> (the file was changed after it was written; each is below)``, then one line per field:
  `decision: the file states "approve"; the verdict, re-performed, derives "hold_quantity"`, `reasons: absent from the file;
  the verdict, re-performed, derives [...]`, or ``approved: the file states true; `ap` never writes this key`` (a value longer
  than 160 characters is cut, and the JSON's `ap_result.differences` holds it whole), then `what the re-performed verdict
  decides: HOLD (gate: hold_quantity) · verdict FAIL: 1 of 13 checks failed` (exit 1). In a folder, over HTTP and over MCP the
  case DIVERGES at the field, and its reason holds the same words on one line.
- **Deleted remedies** read `FAILED: the verdict carries no remedies; the engine re-derives 1 remedy for it (engine 0.0.1); a
  replayed verdict must carry what it said`, then the flag for a verdict issued before remedies existed (exit 1).
- **A bare verdict in a folder** is refused with the single-verdict command to run instead, with its flags. A folder inside the
  folder is named, with the command that replays it, and is not walked.
- **A match** reads `outcome VERIFIED: re-performed with legal (ruleset legal@0.0.1, engine 0.6.0) and byte-identical,
  issued_at aside.` The line names the ruleset and the version that decided the outcome, beside the engine.
  A verdict with no `issued_at` ends `and byte-identical; the verdict carries no issued_at (every verdict records when it was
  issued; --strict fails it).` instead, with or without `--strict`; in a folder the same words follow its MATCH line.
- **The headline** after a match is the gate status: `PASS`, `PASS-WITH-OPEN: 3 of 13 checks could not run`, `FAIL: 2 of 13
  checks failed` or `INSUFFICIENT_DATA`, never a bare PASS when a check could not run (`docs/VERDICT-SCHEMA-v0.md`, gate_status).
  For an AP proof the gate's decision comes first: `APPROVE`, `HOLD (…)` or `A PERSON DECIDES`. The closing lines of an engine
  0.3.0 or later verdict state its scope; on an AP proof, whose gate decision is printed, the last of them reads `This
  re-performs the check; the APPROVE or HOLD line is the gate's decision on it.` where other verdicts read `This is a check,
  not a decision.` The verdict's own `scope` block is not changed.
- **Streams.** The JSON goes to stdout; every line a person reads (the headline, the remedies, a refusal) goes to stderr. The
  JSON's `answer` is `PASS`, `FAIL` or `INSUFFICIENT_DATA`.
