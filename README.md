# Riposte

**Parry the claim. Answer with proof.**

AI agents decide, act, and report "done." Riposte checks those things against the documents and the real state —
deterministically, with no model in the loop — and answers **PASS**, **FAIL**, or **ABSTAIN** (it can't verify, so a person
decides). Every answer carries a replayable proof, and every result can be written to a hash-chained, signed ledger that
anyone can verify without trusting us.

It is independent of the agent, the model, and the model vendor: the same input gives the same verdict, byte for byte.

## Measured on someone else's benchmark

Distil Labs published an accounts-payable benchmark (Apache-2.0): invoices that arrive as free-text emails, checked against a
purchase order and a goods receipt. Their conclusion: *"That is why this is a job for a model and not for a short
function."* We tested the short function.

| | result |
|---|---|
| Blind, pre-registered run (checker frozen after seeing 3 of the 100 cases) | 82 / 100 decided · **0 wrong** · 18 handed to a person |
| Gating the 7 AI configurations Distil published | 111 / 111 wrong decisions caught · **0 wrong auto-payments** · 63–82% needed no person |
| Stress: meaning-preserving perturbations, 5 unseen seeds | **0 wrong in 3,000** · 74–100% decided automatically |

The full write-up is [`packages/verify/docs/BENCHMARK-AP.md`](packages/verify/docs/BENCHMARK-AP.md). Every number re-runs from
[`bench/ap`](bench/ap).

## Rules that write themselves

Someone has to write the rules. Unless the rules can be learned. From the same 100 invoices, labelled only *paid* or
*held*, `verify mine` rediscovered **all 4 of the policy's rules, with 0 false rules**. That includes the 2% price tolerance,
learned from the labels with the interval the data supports. The 4 rules explain all 68 holds, and every rejected candidate
is recorded with its cause of death. The rules compile into an ordinary ruleset: enforcing them, `verify` agrees with the
gold decision on 100 of 100 invoices. The method was pre-registered before the miner was written. Write-up:
[`BENCHMARK-MINE.md`](packages/verify/docs/BENCHMARK-MINE.md). **This is on synthetic data. Real-data tests are next.**

**Honest scope:** the benchmark is synthetic and templated, and real invoices will abstain more often. Abstaining is the designed
way to fail, because a person looks at it. Coverage is always published next to accuracy.

## What's here

| | what it does |
|---|---|
| [`packages/verify`](packages/verify) · `riposte-verify` | **The engine.** Deterministic post-extraction checks: recompute, cross-reference, quote-match. Built-in rulesets cover invoices, AIA pay applications, the AP three-way match and legal citations, and you can define any other document type in JSON. Each verdict is a proof object with per-operand provenance, a deterministic verdict id, an optional Ed25519 signature, and engine-free replay. Available as a CLI, over HTTP (OpenAPI 3.1), over MCP, and as a library. **`verify mine`** learns rules from labelled history and compiles them into a ruleset. |
| [`packages/receipts`](packages/receipts) · `riposte-ai` | **The layer agents call.** `check_done` compares an agent's "done" with the real state. `ap_gate` compares a model's pay/hold decision with the deterministic three-way match and executes only when they agree. `check_claims` checks the claims an agent ends a turn with ("tests pass", "pushed") against what its tools actually returned. `model_attest` checks which model actually answered, reply by reply, against the one the run declared, and flags silent switches. It also includes a hash-chained, signed receipt ledger and option-order flip probes for typed decisions. Ships as an MCP server and a CLI. |
| [`bench/ap`](bench/ap) | **The benchmark harness:** the frozen blind checker, the disclosed tuned checker, the audit of published model decisions, the stress generator, and every per-case result. |

## Install in Claude Code (one plugin)

```bash
claude plugin marketplace add SorenSocordia/riposte
claude plugin install riposte@riposte            # -s project or -s local to scope it to one project
```

It adds a Stop hook that checks the agent's closing claims against its own tool results, the MCP tools, and a receipt ledger.
**It is record-only by default**: it measures and never forces a turn until you set `RIPOSTE_HOOK_MODE`. See
[`plugins/riposte`](plugins/riposte).

## Quick start (from source; not yet on npm)

```bash
git clone https://github.com/SorenSocordia/riposte.git && cd riposte
npm install
npm run build
npm test
```

Check an invoice against its purchase order and goods receipt:

```bash
node packages/verify/dist/cli.js ap packages/verify/docs/examples/ap-three-way.txt
# → hold_quantity: "Machine grease cartridge 14 oz" billed 10, received 7 — with the exact lines it read. Exit 1 (hold).
```

Give an agent receipts (any MCP host):

```json
{ "mcpServers": { "riposte": {
    "command": "node", "args": ["<path>/riposte/packages/receipts/dist/stdio.js"],
    "env": { "RECEIPTS_ROOT": "<the agent's workspace>" } } } }
```

Re-run the benchmark:

```bash
npx tsx bench/ap/bench.ts --run 1              # the blind run — checker sha256 d1ad333f…, 82 decided, 0 wrong
npx tsx bench/ap/audit.ts                      # gate every published model decision
npx tsx bench/ap/stress.ts --seed holdout1     # … through holdout5
```

## Principles

- **Deterministic.** The same input, ruleset and engine version always produce the same verdict id, byte for byte.
- **Abstain, never guess.** A value that can't be read unambiguously comes back as *can't tell*, with the reason.
- **Independent.** No model calls and no network at runtime. It runs on-prem or air-gapped.
- **Published error.** Accuracy is reported alongside coverage, and blind runs are kept separate from tuned ones.

## License

Apache-2.0. Third-party data and its licences are listed in [`NOTICE`](NOTICE).
