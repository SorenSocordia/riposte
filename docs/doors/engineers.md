# Engineers: try to break it

Every verdict carries a hash of its inputs and the labels of its ruleset and engine versions. A replay re-runs the check with
the open-source engine, no model, on your machine, and compares the canonical JSON byte for byte: it proves the verdict is
what this engine gives on these inputs, not that the inputs match the document. Report a break or a security issue to
kill@fragarachlabs.com; [`SECURITY.md`](../../SECURITY.md) says what happens to a report.

## First command: make a verdict, then replay it

```bash
node packages/verify/dist/cli.js docs/doors/examples/invoice.json > verdict.json
node packages/verify/dist/cli.js replay verdict.json --extraction docs/doors/examples/invoice.json
```

The first command writes the verdict and exits 2: the invoice reads PASS-WITH-OPEN, because 8 of its 13 checks need a
contract, a delivery receipt, dates or the list of invoices already processed, and it was given none of them. The replay
prints "outcome VERIFIED: re-performed … and byte-identical, issued_at aside", naming the ruleset and version that decided
the outcome, and exits 0. Copy the invoice, change one figure in the copy, replay against the copy, and it refuses, exit 1.

- A replay of a verdict made under an older rule or engine (legal, e-invoice, invoice, pay application) says how today's
  default rule reads the same inputs, when that differs (`rule_now` in the JSON). `--require-ruleset '<ruleset>@>=<version>'`
  fails such a verdict, exit 1, and its FAILED line is printed first.
- [`REPLAY.md`](../../packages/verify/docs/REPLAY.md) is the hash contract: what the input hash covers, how inputs are made
  canonical, what is refused before hashing, which verdict fields a replay does not compare, signatures and the exit codes.
- **On one build** the same input gives the same verdict, byte for byte apart from `issued_at`; the build carries every
  earlier engine's rules (`--version` lists them). **Across builds** the same input, ruleset and engine version give the same
  verdict id under every closed label: every engine below the one this tree builds ([`CHANGELOG.md`](../../packages/verify/CHANGELOG.md)
  defines "closed" and "released", says which labels are closed, and lists the 0.0.1 exceptions). **The engine this tree builds
  (the first version `--version` prints) is open:** its verdicts can still change. No version is released yet.

## Reading the output

- **What a command produces goes to stdout; the words about it go to stderr.** The verdict's JSON, or a table or report you
  asked for, on stdout; the headline, the lines it read, the remedies and any refusal on stderr. `citations` prints its
  JSON on stdout only with `--json`.
- **Key on `gate_status`, not `outcome`.** An `outcome` of `PASS` can carry `gate_status` `PASS_WITH_OPEN` (on screen
  `PASS-WITH-OPEN`). `check`, `ap`, `citations` and `twin-einvoice` fail closed: only a clean PASS exits 0. The stated
  opt-out, `check --allow-open`, exits 0 on a PASS-WITH-OPEN whose open checks each wait on a reference not given
  or a field the document does not carry, and says so on stderr; an open check whose figure is there but unreadable
  ("1600.0O"), ambiguous or out of scope, or a struck field, stays exit 2, named.
- **Refused before hashing, exit 3:** a key repeated in one object, a number that cannot be represented exactly
  (`9007199254740993`), text that is not valid UTF-8, JSON nested more than 256 levels deep ("nesting too deep, limit 256"), and,
  at the citations check, a cite, case name, source key or text key longer than 1,024 characters (`400` over HTTP, a tool error
  over MCP). Write amounts as strings with two decimals.
- **Can't tell rather than guess.** A figure that cannot be read unambiguously comes back as can't tell, with the reason: a
  lone "1,500" or "1.500" unless the extraction declares `number_locale`, a document that writes figures both as "1,500.00"
  and as "1.500,00" or in two scripts of digits, a stray no-break space. The `ap` command's emailed-bill input still reads
  its figures in US style; other known exceptions are open rows in the misses ledger. A remedy never changes a verdict, and
  a ruling covers one verdict only.

## What the engine reads itself

It trusts the extraction: a misread that is consistent with itself can pass. It reads text itself in two places. The `ap`
command's emailed-bill input: the labelled lines of a forwarded invoice email, and whether it names the PO's vendor, quoted
under "Lines read". An arbitration case (`node packages/verify/dist/cli.js case move`;
[`EVIDENCE.md`](../../packages/verify/docs/EVIDENCE.md)): the one disputed field, from the document a party files. A PDF is
read twice, from its text layer and by OCR, with tools you install (the optional `pdfjs-dist` package, Tesseract and
pdftoppm), and a value the two readings disagree on is unreadable.

## The invoice tolerances

Each arithmetic check (a line's quantity times its price, the lines against the subtotal, the tax, the total) treats one
cent as rounding, and a larger difference too while it is within 0.03% of the expected figure and at most one cent per figure
the check reads (one unit when all amounts are whole numbers). The tax check allows one more cent per line; the total check,
half a cash step (5, 10, 50 or 100 cents) when the stated total sits on one. Anything larger is a FAIL, and a difference
treated as rounding stays in the verdict with its arithmetic. The bands apply check by check, so a cent added to every line,
and carried into the subtotal and the total, passes every check. The command line always uses these bands; the library's
`tolerance` option sets others, and the input hash records them.

## Signatures and the receipt ledger

- **A verdict is not signed by default.** The library's `signVerdict` wraps it in an Ed25519 envelope
  ([QUICKSTART](../../packages/verify/QUICKSTART.md#proofs-you-dont-have-to-trust-us-for)); from the command line
  `riposte-ledger sign <verdict.json | proof.json> --key <private.pem>` does the same and prints the issuer fingerprint, and
  `riposte-ledger verify-signature <file> [--trusted-key <public.pem | 64-hex>]` checks it offline (`riposte-ledger --help`, "Signing"). The envelope carries its own public key, so a valid signature only says that key signed.
- **Pin the issuer's key:** `replay … --trusted-key <the issuer's public key or its full fingerprint>` fails (exit 1) on an
  envelope signed by any other key, and on an unsigned verdict. The fingerprint is sha256 of the key's DER bytes, as
  `riposte-ledger fingerprint` prints it. A key a bundle or a signed envelope does not define, and a member an annotation's
  declared shape does not have (`action_context.approved`), are refused before anything is hashed (exit 3), each named; a
  bundle's own `id` and `note` are allowed, named as `carried (allowed)`. `--allow-unknown-keys` reads such a key as before
  (named `carried, not checked: <keys>`, the exit unchanged) and says it was given. `--strict` also fails on what was not
  re-performed (an annotation, an unpinned key), on a missing `issued_at` and on a carried key, and notes the issuer's
  `document.producer` label. Deleted remedies are refused, exit 1.
  The output of `ap` is replayed whole: its decision, `payable`, grounding, reasons and not-checked list are derived again from
  the re-performed verdict, and a field that differs, or a key `ap` never writes, fails the replay (exit 1) with or without `--strict`.
- **The receipt ledger is hash-chained and can be signed.** The chain catches an edit, a deletion or a reordering inside
  the file; a pinned key (`riposte-ledger verify --key`) also catches a forged or re-hashed entry. Neither catches a clean
  cut at the end of the file. `riposte-ledger verify` reads the head record kept beside the ledger and refuses a file cut shorter
  than it says, or a missing record; `--no-sidecar` verifies without it and says so. Whoever can rewrite the file can
  rewrite the record, so the real guard is a head hash you recorded somewhere you control, checked with `--head`. Read `ok`,
  its JSON's first key: true exactly when it exits 0, with `reason` naming what failed. `chain_ok`, `signatures_ok` and
  `anchor_ok` are kept apart, so an entry whose body was edited shows `signatures_ok: true` (a signature covers the hash the
  entry records) beside `chain_ok: false`, and the first line reads `BROKEN: chain`. A last line that is not a whole entry is
  a torn tail (exit 1, and the words say how to repair it); a whole last entry with no newline after it verifies, with a note.
  `riposte-ledger --help` lists what each exit means.

## The server, the network and the GitHub Action

- **The engine's checks make no network calls.** Three things can, each only when you use it: `bench stamp <file> --tsa
  <url>` sends one file's sha256 to the timestamp authority you name; the library's webhook dispatcher, once an integrator
  wires it into the HTTP service in code (nothing shipped does); the typed SDK client, to the address its caller gives.
- **The HTTP server** (`node packages/verify/dist/cli.js serve`, OpenAPI 3.1) runs only when you start it, on 127.0.0.1,
  port 8080 unless you give `--port`. It answers only a Host header naming this machine's loopback names or its bound
  address (`--allow-host` adds one), else 421, and a request with no Host header is 400. It reads a body only as
  `Content-Type: application/json`, in UTF-8, else 415 (a charset other than utf-8 is refused: "send UTF-8"). Each
  request is checked in a worker thread under a budget: 60 s and 512 MiB per check, two at once. A check past it is answered
  413, "input too large to check within the service's budget; run it with the command line", with `x-verify-exit: 2`, and
  the server stays up. `--check-timeout-ms`, `--check-heap-mb` and `--check-workers` raise it. A request body is counted
  as it streams and capped before it is parsed: past the cap the answer is 413, naming the cap. The cap is 4 MiB, and 32 MiB
  on the four routes that carry a whole document by design (`/v1/twin`, `/v1/opinion`, `/v1/reconcile`,
  `/v1/succession/replay`). `--max-body <bytes>`, or the environment variable `VERIFY_MAX_BODY_BYTES` (the flag wins), sets
  the 4 MiB default, not the four routes' 32 MiB; `serve --help` says the same. `POST /v1/replay` answers the replay's exit in
  `x-verify-exit` (0 match, 1 diverged, 2 not re-performed, 3 refused), and its status follows it: 409 when a case diverged,
  422 when a case was refused, 200 otherwise, so a client or a proxy that reads only the status never takes a forgery for a
  success. It has no authentication:
  `--host 0.0.0.0`, or any other address, puts it on the network and prints a warning, so put an authenticating proxy in
  front of it first ([DEPLOY.md](../../packages/verify/docs/DEPLOY.md#run-it)). It runs on-prem or air-gapped.
- **The [GitHub Action](../GITHUB-ACTION.md)** checks extracted documents in your repository and uploads findings as
  code-scanning alerts (SARIF 2.1.0), each with the command that replays its proof. By default its step fails on a FAIL, on
  can't tell and on a file it could not check (`fail-on: insufficient-data`); `fail-on: fail` loosens it to FAILs only. Pin
  it by commit SHA: the example workflow writes `REPLACE_WITH_COMMIT_SHA` where the commit goes, so a copy does not run
  until you pin it.
- **The hosted bill gate is not in this repository.** The bill gate over HTTP (`POST /v1/ap/gate`) is meant to be hosted by
  the publisher, and its server is held back from this repository until its licence is decided. Nothing in this repository
  runs it, calls it or needs it, and nothing here sends your documents anywhere. Where that hosted gate runs, a receipt keeps
  hashes and offsets only by default, and a customer's API key opts in to storing the documents (`store_documents: true`
  in its keys file). The MCP `ap_gate` tool has the same default and the same opt-in, per call, on your own ledger. The gate
  server in `packages/gate-server` runs on your machine over stdin and stdout, and keeps nothing between calls.
- **The suite runs in the maintainer's own CI on GitHub-hosted runners (Ubuntu and Windows); that history is not public
  yet.** `npm test` runs every package's suite, ends with one line per package, and exits non-zero if any failed
  ([QUICKSTART](../../packages/verify/QUICKSTART.md#what-npm-test-does) says what it runs). The install on a fresh copy
  adds about 70 packages (the exact number depends on the registry); on 2026-10-13 it printed "found 0 vulnerabilities";
  run `npm audit` for today's answer. Plain `npm install` works under npm 11.6.2 and fails under npm 10.9.x;
  `npm install --legacy-peer-deps` installs under both (`ci/SPEC.md`, "The install"). esbuild is build-time only, to bundle the plugin and hook executables.

## What is in the repository

| | what it does |
|---|---|
| [`packages/verify`](../../packages/verify) · `riposte-verify` | **The engine.** Deterministic checks on an extraction, built-in rulesets (invoices, AIA pay applications, the AP three-way match, verbatim legal quotations) and JSON-defined ones; a CLI, the HTTP server, MCP and a library. Its `mine` command proposes rules from labelled history. |
| [`packages/receipts`](../../packages/receipts) · `riposte-ai` | **The layer an AI agent calls.** `ap_gate` returns EXECUTE only when a model's pay/hold decision agrees with the three-way match. `check_done` and `check_claims` compare what an agent says with what its tools returned. `model_attest` checks which model answered, reply by reply: since 2026-10-04 a dated snapshot must carry a real date no later than its reply, and a change of snapshot under one undated name is reported (before that, an undated name matched any dated snapshot: row F11 of the misses ledger). Also the receipt ledger, signed authority rulings, receipt replay and the shadow pilot. |
| [`bench/ap`](../../bench/ap), [`bench/sec`](../../bench/sec) | The AP and SEC benchmark harnesses, preregistrations and per-case results ([methods page](methods.md)). |

## The Claude Code plugin

```bash
claude plugin marketplace add SorenSocordia/riposte
claude plugin install riposte@riposte            # -s project or -s local to scope it to one project
```

It adds the MCP tools, a receipt ledger and a Stop hook that checks the agent's closing claims against its own tool results,
record-only until you set `RIPOSTE_HOOK_MODE`. A PreToolUse hook is off until you set `RIPOSTE_ACTION_HOOK`, yet starts Node
once per tool call, because governance settings can turn it on and it must then deny every call if it cannot load. To
avoid that, register only the MCP server and the Stop hook yourself ([plugins/riposte](../../plugins/riposte/README.md#the-action-hook-off-by-default)).

**Related work.** [OpenAPPA](https://github.com/archestra-ai/OpenAPPA) (MIT; Kravchenko et al., arXiv 2607.24625) checks,
before a tool call is dispatched, what an agent may move and to whom: APPA decides whether an agent may act, and Riposte
checks what it did. Riposte's typed remedies borrow APPA's repair taxonomy; the two can run together.
