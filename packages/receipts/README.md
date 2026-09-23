# riposte-ai — receipts for AI agents

Agents decide, act, and say "done." This package checks those things against reality — deterministically, with no model —
returns **PASS / FAIL / ABSTAIN**, and writes every result to a tamper-evident ledger that anyone can verify. It is
independent of the agent, the model, and us.

Built on [`riposte-verify`](../verify), which provides the deterministic checks and signed, replayable verdicts. Apache-2.0.

## What's in it
| piece | what it does |
|---|---|
| `checkDone` / MCP `check_done` | Compares an agent's "done" claim with the **real** state (JSON files). PASS means verified. FAIL means the claim is untrue, and it shows what is actually there. ABSTAIN means it couldn't check, so the claim is not accepted. |
| `apGate` / MCP `ap_gate` | Compares a model's pay/hold decision with a deterministic three-way match (invoice ↔ PO ↔ goods receipt). It returns EXECUTE only when they agree; otherwise REVIEW, with the reason. |
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

## Honest scope
- Deterministic checks decide only what can be recomputed. Everything else ABSTAINS for a person. Coverage is published
  alongside accuracy.
- The AP benchmark is synthetic and templated, so real documents will abstain more often.
- A signature proves that a receipt is untampered and was issued by the key holder. Binding that key to a real identity has
  to happen outside this package.
