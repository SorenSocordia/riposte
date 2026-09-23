# riposte-ai — receipts for AI agents

Agents decide, act, and say "done." This package checks those things against reality — deterministically, with no model —
returns **PASS / FAIL / ABSTAIN**, and writes every result to a tamper-evident ledger that anyone can verify. It is
independent of the agent, the model, and us.

Built on [`riposte-verify`](../verify), which provides the deterministic checks and signed, replayable verdicts. Apache-2.0.

## What's in it
| piece | what it does |
|---|---|
| `checkDone` / MCP `check_done` | Compares an agent's "done" claim with the **real** state (JSON files). PASS means verified. FAIL means the claim is untrue, and it shows what is actually there. ABSTAIN means it couldn't check, so the claim is not accepted. |
| `checkClaims` / MCP `check_claims` / `riposte-claims` | Checks the **prose** claims an agent ends a turn with ("all 62 tests pass", "the build is clean", "committed", "pushed", "created `x`") against what its own tools actually returned in the session. Only the latest relevant result counts, and a later code edit makes it stale. A claim is SUPPORTED, CONTRADICTED (a failing run, a rejected push, a different count) or UNSUPPORTED (never ran). Hedged, negated and quoted sentences are skipped, so it never puts words in the agent's mouth. `--all-turns` audits a whole session. |
| `apGate` / MCP `ap_gate` | Compares a model's pay/hold decision with a deterministic three-way match (invoice ↔ PO ↔ goods receipt). It returns EXECUTE only when they agree; otherwise REVIEW, with the reason. |
| `attestModels` / MCP `model_attest` / `riposte-attest` | Checks which model **actually** answered, reply by reply, using the model id the host recorded (never what the model says about itself), against the model the run declared. It lists every switch as announced (the user asked for it) or silent. FAIL if any reply came from another model or the model changed with nothing announcing it. ABSTAIN if the declared id is a floating alias like `opus` or `…-latest`, because nothing can be attested against an alias. `modelGate` is the per-reply runtime version. |
| `openLedger` / MCP `ledger_verify` | An append-only, hash-chained receipt ledger (JSONL), optionally signed with Ed25519. It detects edits, deletions and reordering. |
| `guard` / `gate` / `flipProbe` | For typed decisions (`/v1/systemone`-style: choice, `noul` probability, score). It recomputes what can be recomputed, abstains on the rest, and probes whether the answer flips when only the order of the options changes. |

## Measured (public data, reproducible — see [`../verify/docs/BENCHMARK-AP.md`](../verify/docs/BENCHMARK-AP.md))
- Distil Labs' AP benchmark, blind and pre-registered: **82/100 decided, 0 wrong**.
- Gating 7 published AI configurations on that benchmark: **111/111 wrong decisions caught, 0 wrong payments executed**.
- Stress (messier invoices, 5 unseen seeds): **0 wrong in 3,000**, with 74–100% still decided automatically.

## Use it from an agent (MCP, stdio)
```json
{ "mcpServers": { "riposte": {
    "command": "node", "args": ["<path>/riposte/packages/receipts/dist/stdio.js"],
    "env": { "RECEIPTS_ROOT": "<the agent's workspace>", "RECEIPTS_KEY": "<optional ed25519 private key .pem>" } } } }
```
It works in any MCP host. `check_done` reads only inside `RECEIPTS_ROOT`, and refuses absolute paths and `..` escapes. The
ledger defaults to `<RECEIPTS_ROOT>/receipts.jsonl`; set `RECEIPTS_LEDGER` to put it elsewhere.

## Is "done" true? (CLI)
```bash
riposte-claims ~/.claude/projects/<project>/<session>.jsonl              # the final message
riposte-claims ~/.claude/projects/<project>/<session>.jsonl --all-turns  # every turn in the session
# from a source checkout: node packages/receipts/dist/claims-cli.js <transcript> [--all-turns]
# exit 0 PASS · 1 FAIL (contradicted) · 2 ABSTAIN (unsupported, or nothing checkable)
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
- **`--ledger`** writes every checked stop to the hash-chained receipt ledger. It is signed if `RECEIPTS_KEY` points at an
  Ed25519 PEM.

## Which model answered? (CLI)
```bash
riposte-attest ~/.claude/projects/<project>/<session>.jsonl --declared claude-opus-4-8
# from a source checkout: node packages/receipts/dist/attest-cli.js <transcript> --declared <id>
# exit 0 PASS · 1 FAIL · 2 ABSTAIN — JSON on stdout: models, every switch (announced or silent), the replies that broke the pin
```
With no path, it reads a Claude Code hook's `{"transcript_path": …}` from stdin. It reads only the model, id, timestamp and
`/model` command fields of the transcript, never message content.

## Honest scope
- Deterministic checks decide only what can be recomputed. Everything else ABSTAINS for a person. Coverage is published
  alongside accuracy.
- The AP benchmark is synthetic and templated, so real documents will abstain more often.
- A signature proves that a receipt is untampered and was issued by the key holder. Binding that key to a real identity has
  to happen outside this package.
