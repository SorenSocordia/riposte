# riposte-adapters

**Hold adapters: the delivery surface for the gate and autonomy rungs.** Riposte's engine decides whether an agent's proposed
tool call is grounded (`verify_action`) and what its rung does with the result (`actionNotice`). These adapters deliver that
decision in each host's own vocabulary. They never re-derive it.

By design: **record** and **advise** *surface* a FAIL or ABSTAIN, and **gate** and **autonomy**
*hold* it until a person resolves it. Only a person moves a rung.

| disposition | when | Claude Code (PreToolUse) | LangGraph (`wrap_tool_call`) | OpenAI Agents |
|---|---|---|---|---|
| `hold` | FAIL/ABSTAIN at gate or autonomy | `ask`: the permission prompt *is* the hold. `deny` when nobody can be asked or on a repeat | `interrupt()`, or an error ToolMessage (`hold="reject"`) | `needs_approval` → pause; or the guardrail's `raise_exception` / `reject_content` |
| `review` | PASS at gate | `ask` | `interrupt()` | as `hold` |
| `surface` | FAIL/ABSTAIN at advise | notice as `additionalContext` + `systemMessage`; no permission decision | tool runs; notice appended for the agent + `on_notice` | `allow` with the notice in `output_info` + `on_notice` |
| `record` | FAIL/ABSTAIN at record | nothing in-flow; written to the ledger | tool runs; `on_notice` | `allow` |
| `proceed` / `pass-through` | PASS, or an undeclared tool | nothing | tool runs | `allow` |

Two rules hold on every host:
- **It never loops.** A repeat of an identical held call gets a firm refusal with a no-retry instruction, not a second
  prompt or pause.
- **It fails open.** If Riposte's own check errors (bad input, no policy, engine down), the call proceeds through the host's
  normal flow and the error is reported. Riposte's failures never hold the host hostage.

Riposte only ever **narrows**. It never returns Claude Code's `allow` (so it can't widen the host's own permission rules) and
never its `defer` (which pauses a headless run).

## The action policy (a person writes it)
```json
{ "policy_version": "riposte-action-policy-v0",
  "tiers": ["low", "moderate", "high", "severe"],
  "audience": "solo",
  "actions": [
    { "tool": "mcp__bank__transfer", "workflow": "ap.transfer", "level": "gate", "tier": "severe", "set_by": "controller@example.com",
      "sources": { "allowed": { "to_account": ["220-000-1111"], "currency": ["USD"] }, "require": ["to_account", "amount", "currency"] } } ] }
```
- `level` is the rung a person set.
- `tier` is the declared consequence tier. The delivery weight follows it, and the top tier is the values floor: plain words, spoken now.
- `sources` says where values must come from: allow-lists, or `text` / `text_file` for distinctive strings. Numbers need an allow-list.
- Undeclared tools pass through.
- See `examples/action-policy.example.json`. Validate with `riposte-action --lint --policy <file>`.

## One guard on top of verify
`verifyAction` is deliberately strict: it grounds every value or it abstains. `actionNotice` aggregates with the engine-wide
rule, under which a verdict PASSes when some claims can't run. For a partially grounded action, verify says INSUFFICIENT_DATA
while its notice said PASS / PROCEED. At autonomy, the ungrounded account number would have gone straight through.
`checkAction` never delivers an outcome softer than the verdict's own, and it records when that guard applied (`guard`).

## Claude Code: a PreToolUse hook *mode* (off by default)
```bash
npm run build          # bin/riposte-action.mjs (engine bundled from source) + bin/riposte-action-hook.mjs (the off-gate)
```
The Claude Code plugin registers it in `plugins/riposte/hooks/hooks.json` (OFF by default). `npm run build:plugin` bundles
both files into the plugin's `bin/` and checks that every file the plugin's hooks point at exists
(`scripts/check-plugin.mjs`). `test/plugin-wiring.test.ts` holds the entry to the text below.
```json
"PreToolUse": [{ "matcher": "mcp__.*", "hooks": [{ "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/riposte-action-hook.mjs\" --hook --ledger \"${CLAUDE_PLUGIN_DATA}/receipts.jsonl\"",
  "timeout": 15 }] }]
```
| env | values |
|---|---|
| `RIPOSTE_ACTION_HOOK` | `off` (default) · `record-only` (check and record `would_decision`, print nothing) · `on` |
| `RIPOSTE_ACTION_POLICY` | path to the action policy (required unless off) |
| `RIPOSTE_ACTION_LEDGER` | receipts ledger, else `--ledger`, else **no file** (one stderr line says so, and the loop guard then has no memory of earlier holds). `RIPOSTE_LEDGER` is never used for action receipts: an inherited Stop-hook ledger would otherwise collect foreign receipts (D14). The loop guard reads this ledger. |

Measured on one Windows machine: a bare `node` start takes 45 ms. Off costs 51 ms per call (the gate exits before the engine
loads), and on costs about 65 ms per call, receipt included (p50 of 30 interleaved spawns). The bin bundles only the engine
modules the check uses (`scripts/narrow-engine.mjs`), not the packages' barrels. Keep the `matcher` narrow.

## Python: LangGraph and OpenAI Agents
The Python package (`python/riposte_adapters`, no required dependencies) calls the bundled engine through
`NodeChecker(policy)`, which runs `node bin/riposte-action.mjs --check`. Override the path with `RIPOSTE_ACTION_CLI`.
```python
from riposte_adapters import NodeChecker, RiposteToolMiddleware, riposte_tool_input_guardrail, riposte_needs_approval
checker = NodeChecker("policy.json")

# LangChain v1 / LangGraph (a checkpointer is required for interrupt; hold="reject" otherwise)
agent = create_agent(model, tools=[transfer], middleware=[RiposteToolMiddleware(checker)], checkpointer=InMemorySaver())
# resume a held call: agent.invoke(Command(resume={"type": "approve"}), cfg)   anything else declines it

# OpenAI Agents SDK: pause for a person in-run, with the guardrail recording (enforce=False, so approval isn't overridden)
@function_tool(needs_approval=riposte_needs_approval(checker, "transfer"),
               tool_input_guardrails=[riposte_tool_input_guardrail(checker, enforce=False)])
def transfer(to_account: str, amount: float) -> str: ...
# or guardrail-only: tool_input_guardrails=[riposte_tool_input_guardrail(checker)]   (hold → the run halts)
```

## Host APIs these were built against (fetched 2026-09-28)
- **Claude Code hooks**: https://code.claude.com/docs/en/hooks. Sections used: "PreToolUse input", "PreToolUse decision control"
  (`permissionDecision` allow/deny/ask/defer; the reason is shown to the user for ask and to Claude for deny; `additionalContext`;
  precedence `deny > defer > ask > allow`), "Other exit codes" (non-blocking, the action proceeds), and "Timeouts" (a timed-out
  command hook doesn't block the tool call).
  Also https://code.claude.com/docs/en/headless ("In a -p run with no host, these requests are denied either way").
- **LangChain v1 / LangGraph**:
  - `libs/langchain_v1/langchain/agents/middleware/types.py`: `AgentMiddleware.wrap_tool_call(request, handler) -> ToolMessage | Command`, and `awrap_tool_call`.
  - `langgraph/prebuilt/tool_node.py`: `ToolCallRequest.tool_call` = {name, args, id}.
  - https://docs.langchain.com/oss/python/langchain/middleware/custom (short-circuit by not calling the handler).
  - https://docs.langchain.com/oss/python/langgraph/interrupts (`interrupt`, `Command(resume=…)`, checkpointer, the node restarts on resume).
- **OpenAI Agents SDK**:
  - `src/agents/tool_guardrails.py`: `tool_input_guardrail`, `ToolGuardrailFunctionOutput.allow / reject_content / raise_exception`.
  - `src/agents/tool_context.py`: `tool_name`, `tool_arguments`.
  - `docs/guardrails.md`: FunctionTool only; input guardrails run after approval.
  - `docs/human_in_the_loop.md`: async `needs_approval(ctx, params, call_id)`.

## Tests
```bash
npm test          # TypeScript: policy, dispositions, the guard, the Claude Code hook (never allow/defer, loop guard, fail open), CLI
npm run test:py   # Python: core bridge + both adapters against contract fakes, and the real engine end to end
```
`python/tests/test_real_hosts.py` drives full runs of the **real** host libraries with scripted fake models, and it skips when
they aren't installed. It passed 9/9 with langchain 1.4.2, langgraph 1.2.12 and openai-agents 0.22.3.

## Honest scope
- ✓ The Claude Code hook's stdin/stdout contract is tested, and the bundled bin was run end to end from a shell.
  ✓ In a live headless Claude Code session (3 runs, one model), it held a gated call: the call was denied and the tool never
  ran, while the control call ran.
- ◇ Under `bypassPermissions` a hook's `ask` is not documented, so a hold there is a `deny`. That's a deliberate choice, not a
  measured behaviour.
- ◇ LangGraph `interrupt` inside `wrap_tool_call` is exercised with `InMemorySaver` only, not with a durable checkpointer or parallel tool calls.
- ◇ OpenAI Agents: hosted tools, handoffs and `Agent.as_tool()` don't pass through tool guardrails (the SDK's own scope).
