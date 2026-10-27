# riposte-ai — receipts for AI agents

AI agents decide, act, and say "done." This package checks those claims against what can be checked: the state a claim
names, the agent's own tool results, and a deterministic re-check of a pay/hold decision. It uses no model, returns
**PASS / FAIL / INSUFFICIENT_DATA** (INSUFFICIENT_DATA: it can't tell, so a person decides; the older word ABSTAIN, in a receipt written before 2026-10-06, is still read the same), and can write every result to a hash-chained,
optionally signed ledger. Anyone can check the ledger for edits; detecting a rewrite of the whole file also needs the
issuer's public key or a head hash recorded earlier. It is independent of the agent and the model.

Built on [`riposte-verify`](../verify), which provides the deterministic checks and signed, replayable verdicts. Apache-2.0.

## What's in it
| piece | what it does |
|---|---|
| `checkDone` / MCP `check_done` | Compares an agent's "done" claim with the **real** state (JSON files). PASS means verified. FAIL means the claim is untrue, and it shows what is actually there. INSUFFICIENT_DATA means it couldn't check, so the claim is not accepted. |
| `checkClaims` / MCP `check_claims` / `riposte-claims` | Checks the **prose** claims an agent ends a turn with ("all 62 tests pass", "the build is clean", "committed", "pushed", "created `x`") against what its own tools actually returned in the session. Only the latest relevant result counts, and a later code edit makes it stale. A claim is SUPPORTED, CONTRADICTED (a failing run, a rejected push, a different count) or UNSUPPORTED (never ran). Hedged, negated and quoted sentences are skipped, so it never puts words in the agent's mouth. `--all-turns` audits a whole session. |
| `draftResolution` (also in `ap_gate`'s response) | **The generative half.** When the check holds an invoice, it writes what a controller would send. That is a credit memo request for unreceived units, a rebill at the PO price, or a corrected-invoice request, with a **short-pay figure** where the policy allows one ("we will pay 1,913.15 now and hold 22.35"). It also flags a PO number that looks like two transposed digits. **Every number in a draft is a recorded fact** with its source (a document line, or "computed from" named facts). That is enforced by a test over every benchmark invoice. Abstentions get no letter, only the reasons. |
| `apGate` / MCP `ap_gate` | Compares a model's pay/hold decision with a deterministic three-way match (invoice ↔ PO ↔ goods receipt). It returns EXECUTE only when they agree; otherwise REVIEW, with the reason and the verdict's **typed remedies** (what would lawfully clear it: a goods receipt, a PO change, the buyer). Its receipt stores **hashes and offsets, not the documents**; the replayable proof comes back to the caller (`structuredContent.proof`), and `store_documents: true` (or `RECEIPTS_STORE_DOCUMENTS=1`) puts the documents and the proof on the ledger instead. Give `history` (invoices already booked) to run the duplicate check. The library `apGate` also takes **structured input**: a bill, its PO and its item receipts as JSON ([`../verify/docs/AP-INPUT.md`](../verify/docs/AP-INPUT.md)); the MCP tool takes the texts. A bare `hold` from the model agrees with any hold the check finds. |
| `riposte-ledger rule` / `checkRuling` | An **authority ruling**: a person's Ed25519-signed decision (allow or deny) on ONE verdict, covering the exact rule ids their role's authority remedies name there. `ap_gate` honours it only when its key is pinned for the role (`RIPOSTE_AUTHORITIES`), only for the verdict it names, and only once. It never changes the verdict and never waives a later check. No MCP tool writes one. See [`../verify/docs/REMEDIES.md`](../verify/docs/REMEDIES.md). |
| `riposte-replay` | Re-performs a proof bundle (`{ verdict, inputs }`), a `.jsonl` or a folder of them, or a receipt on a ledger: `--ledger <file> --entry <seq>` when the receipt stored its proof, `--ledger <file> --proof <proof.json>` for a hashes-only receipt (the proof must bind to it first: its verdict hashes to the receipt's `verdict_sha256`, and the documents' hashes match). It prints MATCH (with the answer, for AP the gate's decision first, and the remedies) or DIVERGED (with the field). |
| `attestModels` / MCP `model_attest` / `riposte-attest` | Checks which model **actually** answered, reply by reply, using the model id the host recorded (never what the model says about itself), against the model the run declared. It lists every switch as announced (the user asked for it) or silent. FAIL if any reply came from another model or the model changed with nothing announcing it. INSUFFICIENT_DATA if the declared id is a floating alias like `opus` or `…-latest`, because nothing can be attested against an alias. `modelGate` is the per-reply runtime version. Every result states its evidence tier (T1: the model field the host recorded). `riposte-attest monitor` runs it over a month with provider usage exports and signed anchors, which raise a reply to T2 or T3 (below). |
| `openLedger` / MCP `ledger_verify` / `riposte-ledger` | An append-only, hash-chained receipt ledger (JSONL), optionally signed with Ed25519. It detects edits, deletions and reordering **inside** the file. Detecting a **whole-file rewrite** takes a trust anchor: the expected signing key, required signatures, or a head hash you recorded earlier. The report always lists who signed. The file store keeps a head sidecar (`<ledger>.head.json`) so an append does not re-read the file, flushes each line to disk, moves a torn last line (a crash mid-append) to `<ledger>.torn-<stamp>` with a signed note on the chain, and refuses a file that no longer matches its sidecar. |
| `guard` / `gate` / `flipProbe` | For typed decisions (`/v1/systemone`-style: choice, `noul` probability, score). It recomputes what can be recomputed, answers INSUFFICIENT_DATA (can't tell) on the rest, and probes whether the answer flips when only the order of the options changes. |

## Measured (public synthetic data, reproducible; see [`../verify/docs/BENCHMARK-AP.md`](../verify/docs/BENCHMARK-AP.md))
- Distil Labs' AP benchmark of 100 synthetic, templated invoices, blind run of the check: **82/100 decided, 0 wrong**
  (95% Wilson interval for the error rate among decided: 0 to 4.5%). 18 went to a person, 13 of them invoices that should
  have been paid. Its preregistration has no recorded hash, so the bench tool does not list it as preregistered.
- What follows for the 7 model configurations Distil published (700 decisions): 487 executed automatically, none wrongly,
  and all 111 wrong model decisions went to a person (87 because the check disagreed, 24 because it could not tell). This
  is a consequence of the first result, not separate evidence.
- Stress: 30 perturbed variants of each of the same 100 cases, run with rules tuned on those cases: 2,755 of 3,000 decided,
  0 wrong. The variants are correlated, so this shows robustness, not new accuracy.

## Use it from an agent (MCP, stdio)
```json
{ "mcpServers": { "riposte": {
    "command": "node", "args": ["<path>/riposte/packages/receipts/dist/stdio.js"],
    "env": { "RECEIPTS_ROOT": "<the agent's workspace>", "RECEIPTS_KEY": "<optional ed25519 private key .pem>" } } } }
```
It works in any MCP host. `check_done` reads only inside `RECEIPTS_ROOT`, and refuses absolute paths and `..` escapes. The
ledger defaults to `<RECEIPTS_ROOT>/receipts.jsonl`; set `RECEIPTS_LEDGER` to put it elsewhere. Set `RIPOSTE_AUTHORITIES` to a
JSON file mapping each role to its pinned public key(s) (`{ "buyer": "buyer.pub.pem" }`) for `ap_gate` to honour signed
rulings; unset, every ruling is refused.

## Verify a ledger against a pinned key or a recorded head (CLI)
```bash
riposte-ledger fingerprint signing-key.pem                  # the public key + fingerprint to publish or pin
riposte-ledger verify receipts.jsonl --key issuer.pub.pem --require-signed --head <hash you recorded earlier>
riposte-ledger summary receipts.jsonl                       # counts by kind, time range, head, signers
riposte-ledger rule receipts.jsonl --verdict <id> --by buyer --decision allow --note "…" --key buyer.pem   # a signed ruling on one verdict
riposte-ledger verify receipts.jsonl --proof proof.json      # does the proof you kept belong to its receipt? (verdict hash, documents)
riposte-replay --ledger receipts.jsonl --entry <seq>         # re-perform the proof a receipt carries (documents stored)
riposte-replay --ledger receipts.jsonl --proof proof.json    # bind the proof you kept to its hashes-only receipt, then re-perform it
# from a source checkout: node packages/receipts/dist/ledger-cli.js …   · exit 0 ok · 1 broken · 3 usage
```
The JSON `verify` prints on stdout agrees with its exit code: `"ok"` is true exactly when it exits 0, `"reason"` names what
failed first (a broken chain, a cut the head record shows, a torn tail, a proof that does not bind), and `"chain_ok"` is the
hash chain's own answer. A CI step can read either.
A hash chain proves the file is internally consistent. It does **not** prove that nobody rewrote all of it and re-signed it
with their own key. `verify` says so when you give it no anchor, and it always lists which keys signed. Pin the issuer's key,
require signatures, or check against a head hash you recorded (for example, one published daily), and a rewrite fails at the
first forged entry.

## Is "done" true? (CLI)
```bash
riposte-claims ~/.claude/projects/<project>/<session>.jsonl              # the final message
riposte-claims ~/.claude/projects/<project>/<session>.jsonl --all-turns  # every turn in the session
# from a source checkout: node packages/receipts/dist/claims-cli.js <transcript> [--all-turns]
# exit 0 PASS · 1 FAIL (contradicted) · 2 INSUFFICIENT_DATA (unsupported, or nothing checkable)
```
Each claim comes back with its evidence: the command, when it ran, and the lines of output that decided it.

### As a Claude Code Stop hook
```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command",
    "command": "node <path>/riposte/packages/receipts/dist/claims-cli.js --hook --ledger <path>/receipts.jsonl" } ] } ] } }
```
When the agent tries to finish with a claim its tools don't back, the hook sends it back **once** (exit 2) with the claim,
the reason and the evidence: *"All 500 tests pass." — CONTRADICTED: claims 500, the last run shows 92 passing.* The agent then
has to run the check or correct the claim.
- **It never bounces twice.** A stop that was already sent back once goes through (`stop_hook_active`).
- **It never holds the agent hostage.** If the hook itself fails (unreadable input), it exits 1, which the user sees and which
  doesn't block.
- **It uses `last_assistant_message` when the host provides it,** because the transcript can lag the final message.
- **`--only-contradicted`** sends back only claims that are demonstrably false. Unbacked claims are then just recorded.
- **`--strict`** makes "done" mean tested. An assertive "done / fixed / implemented / resolved / works now" needs a
  **passing test run after the last code edit**. It only counts when the agent is the subject: "bugs that you fixed" and "I'll
  be notified when it's done" are not its claims. Off by default, because it's meant for coding agents rather than
  conversation.
- **`--record-only`** never sends anything back and never fails. Every stop is checked and receipted, with `would_block` noting
  what full mode would have done. Use it where a turn must never be forced, or to measure before you enforce.
- **`--ledger`** writes every checked stop to the hash-chained receipt ledger. It is signed if `RECEIPTS_KEY` points at an
  Ed25519 PEM.

## Which model answered? (CLI)
```bash
riposte-attest ~/.claude/projects/<project>/<session>.jsonl --declared claude-opus-4-8
# from a source checkout: node packages/receipts/dist/attest-cli.js <transcript> --declared <id>
# exit 0 PASS · 1 FAIL · 2 INSUFFICIENT_DATA — JSON on stdout: models, every switch (announced or silent), the replies that broke the pin
```
With no path, it reads a Claude Code hook's `{"transcript_path": …}` from stdin. It reads only the model, id, timestamp and
`/model` command fields of the transcript, never message content.

## Which model answered, over a month? (the model-switch monitor)

`riposte-attest monitor run <manifest.json> --out <dir> --ledger <receipts.jsonl> --key <key.pem>` (also the bin
`riposte-attest-monitor`) reads a month of host records (Claude Code transcripts, Codex rollouts, your own provider-response logs)
and provider usage exports (Anthropic usage report, OpenAI usage, stored chat completions and Response objects, OpenRouter
generations and activity, or a dashboard CSV through your column map). Every reply is attested at an evidence tier: T0 declared
only, T1 the provider's model field in the host record, T2 the provider's own usage rows, T3 a signed anchor written as the reply
happened. Every switch gets a cause (user_command, host_fallback, unrecorded, alias_float), and a provider record that disagrees
with the host record is a flag. The monthly report is signed onto the ledger. Exports are parsed strictly: unknown fields refuse
until acknowledged. See [ATTEST-MONITOR.md](ATTEST-MONITOR.md).

## Run one closed month in shadow (CLI)

`riposte-pilot` reads a closed month from your AP export (Ramp, Xero, QuickBooks Online, or a CSV), checks every bill against its
PO and item receipts without executing anything, and checks the month's G702/G703 pay applications against last month's. It
signs a hashes-only receipt per bill and per application. The report opens with the cost to your team: how many of the bills you
paid it would have stopped. Then it lists every hold in words, with the vendor, the amount, what is wrong and who may clear it,
and gives the numbers you pre-register and freeze before the run: how many would-holds are real problems, and how many
would-pays are bad bills. `--hashes-only` keeps the report and audit sheet to ids and rule names. Offline; documents never leave
your machine. Nothing is executed: every receipt says what the gate *would* have done at the top level (`WOULD_PAY`,
`WOULD_HOLD`, `WOULD_REVIEW`, with `executed: false`). Receipts written before 2026-10-05 carry the live gate's words with
`executed: false` nested; there, too, they mean *would have*. A run refuses to start until you choose who holds the signing key:
`--key` signs with yours, `--key-dir` keeps a run's own key outside the output folder, `--key-here` puts it beside the receipts.
No construction ERP export has been verified. A drafted Vista mapping and a one-page guide to mapping your own export
([HOW-TO-MAP.md](HOW-TO-MAP.md)) are the way in. See [PILOT.md](PILOT.md).

## Honest scope
- Deterministic checks decide only what can be recomputed. Everything else is INSUFFICIENT_DATA (can't tell), for a person. Coverage is published
  alongside accuracy.
- The AP benchmark is synthetic and templated. How often real bills go to a person has not been measured; the shadow pilot
  measures it on one closed month of your own ([PILOT.md](PILOT.md)).
- A signature proves that a receipt is untampered and was issued by the key holder. Binding that key to a real identity has
  to happen outside this package.
