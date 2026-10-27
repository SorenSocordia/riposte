# riposte-adapters

**Hold adapters: the delivery surface for the gate and autonomy rungs.** Riposte's engine decides whether an agent's proposed
tool call is grounded (`verify_action`) and what its rung does with the result (`actionNotice`). These adapters deliver that
decision in each host's own vocabulary. They never re-derive it.

By design: **record** and **advise** *surface* a FAIL or INSUFFICIENT_DATA (can't tell), and **gate** and **autonomy**
*hold* it until a person resolves it. Only a person moves a rung.

| disposition | when | Claude Code (PreToolUse) | LangGraph (`wrap_tool_call`) | OpenAI Agents |
|---|---|---|---|---|
| `hold` | FAIL/INSUFFICIENT_DATA at gate or autonomy | `ask`: the permission prompt *is* the hold. `deny` when nobody can be asked or on a repeat | `interrupt()`, or an error ToolMessage (`hold="reject"`) | `needs_approval` → pause; or the guardrail's `raise_exception` / `reject_content` |
| `review` | PASS at gate | `ask` | `interrupt()` | as `hold` |
| `surface` | FAIL/INSUFFICIENT_DATA at advise | notice as `additionalContext` + `systemMessage`; no permission decision | tool runs; notice appended for the agent + `on_notice` | `allow` with the notice in `output_info` + `on_notice` |
| `record` | FAIL/INSUFFICIENT_DATA at record | nothing in-flow; written to the ledger | tool runs; `on_notice` | `allow` |
| `proceed` / `pass-through` | PASS, or an undeclared tool | nothing | tool runs | `allow` |

Three rules hold on every host:
- **It never loops.** A repeat of an identical held call gets a firm refusal with a no-retry instruction, not a second
  prompt or pause.
- **A broken setup fails to the safest rung, not open.** If the action policy itself cannot be applied (the policy file is
  missing, unreadable or invalid, `RIPOSTE_ACTION_HOOK` is misspelled, the hook input is malformed, or the engine cannot
  run), a **consequential** call is held until the setup is fixed. Consequential means the policy's rule for the tool is
  `gate` or `autonomy`, or, when no rule can be read, the tool's name moves money or files something (pay, transfer,
  apply, submit, file…). The denial is typed and names the fix, for example:
  `RIPOSTE_ACTION_HOOK 'onn' is not one of off/record-only/on; did you mean on?`. **Every other call proceeds**, with a
  `governance degraded` receipt on the action ledger.
- **Friction lands on the operator once, never on the user per transaction.** `riposte-action --doctor` checks the setup at
  install and prints what the hook does on each class of call. The first held call names the fix. A **document error** (a
  FAIL or a can't-tell on the call's own values) is not a setup error: it keeps its rung, exactly as in the table above.

The operator can opt out: `RIPOSTE_ACTION_ON_ERROR=open` restores the old fail-open behaviour. It is loud on purpose. Every
call it affects prints a line saying consequential calls are not held, and its receipt records `on_error: "open"`.

Riposte only ever **narrows**. It never returns Claude Code's `allow` (so it can't widen the host's own permission rules) and
never its `defer` (which pauses a headless run).

**Governance** (a fleet's holds and signed GOs, checked at the execution boundary) **fails closed** on every call, declared
or not, whatever the action policy's state. It is off unless `RIPOSTE_GOV_*` configures it; see
[Governance at the execution boundary](#governance-at-the-execution-boundary-srcgovernancets-every-host).

## When the setup is broken: the safest rung (`src/degraded.ts`, `src/doctor.ts`)
| what is wrong | code | consequential call (`on`, or a misspelled mode) | any other call | `record-only` |
|---|---|---|---|---|
| no `RIPOSTE_ACTION_POLICY` | `policy.missing` | denied; the reason names the fix | runs; degraded receipt | nothing delivered; the receipt records the would-deny |
| policy file unreadable | `policy.unreadable` | denied | runs; degraded receipt | as above |
| policy invalid (a misspelled rung: `rung 'gaet' is not one of record/advise/gate/autonomy; did you mean gate?`) | `policy.invalid` | denied | runs; degraded receipt | as above |
| `RIPOSTE_ACTION_HOOK` not off, record-only or on | `policy.mode_invalid` | denied | runs; degraded receipt | (a misspelling is never read as record-only) |
| hook input malformed (not JSON, no `tool_name`, `tool_input` not an object) | `policy.bad_input` | denied | runs; degraded receipt | as above |
| the check throws, or the engine bundle does not load | `policy.error` | denied | runs (no receipt without the engine) | as above |

- **Which class.** The policy's own rule decides whenever its text can be read, even if it is invalid elsewhere. An
  unreadable rung counts as the strictest. A valid policy that does not declare the tool lets it pass untouched, as always.
  Only when no rule can be read does the tool's name decide (`CONSEQUENTIAL_WORDS`). A call whose tool cannot be read at all
  is consequential, unless a readable policy declares no gate or autonomy action.
- **Held means denied, not asked.** A degraded hold is a Claude Code `deny` (exit 0, never exit 2): it waits for the
  operator to fix the setup, not for a person to click through each call. The degraded receipt has `held: false`, so the
  loop guard still asks on the first healthy check of the same call.
- **The receipt** (`action_check`, `governance: "degraded"`): the code, the problem, the fix, the class and how it was
  decided, the tool and call hash, what was delivered and what the safest rung would deliver, and `on_error`.
- **The doctor.** `riposte-action --doctor [--policy <file>] [--json]` reads the same environment as the hook. It exits 0
  when the hook will apply the policy as written and 1 when it would run degraded, and lists every declared action with
  what happens normally and on a setup error. The opt-out and a missing ledger are printed as warnings.
- **Python adapters** take the same rung: a failed check holds a consequential call (LangGraph refuses it without an
  interrupt; the OpenAI guardrail delivers it like any hold; `needs_approval` can only pause) and lets any other call run.
  `RIPOSTE_ACTION_ON_ERROR=open` or `safe_check(..., on_policy_error="open")` restores fail-open.

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
`verifyAction` is deliberately strict: it grounds every value or answers can't tell (INSUFFICIENT_DATA). `actionNotice` aggregates with the engine-wide
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
"PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/riposte-action-hook.mjs\" --hook --ledger \"${CLAUDE_PLUGIN_DATA}/receipts.jsonl\"",
  "timeout": 15 }] }]
```
| env | values |
|---|---|
| `RIPOSTE_ACTION_HOOK` | `off` (default) · `record-only` (check and record `would_decision`, print nothing) · `on`. Anything else is a setup error (`policy.mode_invalid`): the safest rung, never off |
| `RIPOSTE_ACTION_ON_ERROR` | `hold` (default: the safest rung on a setup error) · `open` (the old fail-open, loud and logged) |
| `RIPOSTE_ACTION_POLICY` | path to the action policy (required unless off) |
| `RIPOSTE_ACTION_LEDGER` | receipts ledger, else `--ledger`, else **no file** (one stderr line says so, and the loop guard then has no memory of earlier holds). `RIPOSTE_LEDGER` is never used for action receipts: an inherited Stop-hook ledger would otherwise collect foreign receipts (D14). The loop guard reads this ledger. |

Measured on one Windows machine: a bare `node` start takes 45 ms. Off costs 51 ms per call (the gate exits before the engine
loads), and on costs about 65 ms per call, receipt included (p50 of 30 interleaved spawns). The bin bundles only the engine
modules the check uses (`scripts/narrow-engine.mjs`), not the packages' barrels. The plugin's matcher is `.*` (2026-10-04):
every tool, so governance sees Bash and Edit too, and every call pays the off-gate's one node start. `.*` is a regex; a
literal `*` is not one.

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
npm test          # TypeScript: policy, dispositions, the guard, the Claude Code hook (never allow/defer, loop guard), the safest rung on a broken setup and the doctor (test/h15-safest-rung.test.ts), CLI
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

## The claims check on Codex, Cursor and OpenCode (`src/hosts/`)
The Claude Code Stop hook checks the claims an agent ends a turn with against the session's own tool results. These ports run
it at each host's end-of-turn event. A transcript adapter turns the host's record into the checker's steps. The steps are
handed to receipts' `stopDecision`, the function `stopHook` itself calls once it has read a Claude Code transcript. The
receipt is the one that hook writes (`stopReceipt`, stamped) plus a `host` key: `codex`, `cursor` or `opencode`. So the
decision, the send-back wording and the "once" rule are the Claude Code hook's. With `host` removed, the receipt bytes are
too; this is tested byte for byte in `test/hosts-*.test.ts`. Claude Code's own receipts carry no `host`.

| host | event | adapter | bin (`npm run build`) |
|---|---|---|---|
| Codex CLI | `Stop` (exit 2 + stderr continues the turn) | `sessionFromCodexRollout`: the rollout at `transcript_path` | `bin/riposte-codex.mjs --hook` |
| Cursor | `postToolUse`, `postToolUseFailure`, `afterFileEdit`, `afterAgentResponse` journaled; checked at `stop` (`followup_message`) | `sessionFromCursorJournal` | `bin/riposte-cursor.mjs --hook` |
| OpenCode | plugin `event` hook, `session.idle` (`promptAsync` sends back) | `sessionFromOpenCodeMessages`: `client.session.messages` | `bin/riposte-opencode.js` (one export) |

Record-only by default (`RIPOSTE_HOOK_MODE`, the same values as the Claude Code hook), at most one send-back per turn, and
the port's own errors never block the host. The ledger is `RIPOSTE_LEDGER`, else `--ledger`, else `~/.riposte/receipts.jsonl`.
The Claude Code plugin ships the three files with their installer snippets in `plugins/riposte/hosts/`. Fixture provenance,
and which host shapes are assumed rather than captured from a live session: `test/fixtures/hosts/README.md`.

## Scorers: Riposte verdicts inside Langfuse, Braintrust and Inspect (`src/scorers/`, `python/riposte_adapters/inspect_scorer.py`)
Eval platforms grade with judges. These adapters put the deterministic verdict inside them as the platform's own score
object. Each score carries the verdict id and the command that re-performs the check, so anyone looking at the score can
re-run it. By default the replay bundle (`{ verdict, inputs }`) travels in the score's metadata. Save `metadata.riposte.proof`
as the file `metadata.riposte.proof_file` names, then run `metadata.riposte.replay` (`riposte-verify replay riposte-proof-<id>.json`).

| answer | Langfuse | Braintrust | Inspect |
|---|---|---|---|
| PASS | `riposte` CATEGORICAL `"PASS"` + `riposte_pass` BOOLEAN `1` | `score: 1` | `CORRECT` |
| FAIL | `"FAIL"` + BOOLEAN `0` | `score: 0` | `INCORRECT` |
| INSUFFICIENT_DATA (can't tell) | `"INSUFFICIENT_DATA"` only: **no boolean is sent** | `score: null` (skipped) | `NOANSWER`, reason `insufficient_data`; or `Score.unscored()` with `abstain="unscored"` |
| not a document (refused) | not sent: there is no verdict | `score: null`, `metadata.riposte.refused` | `NOANSWER`, reason `invalid_response_format` |

Can't tell is never rendered as a 0 or a fail. An older verdict or score that says ABSTAIN, the older word, reads as INSUFFICIENT_DATA. Two platform facts shape that:
- **Inspect's `accuracy()` counts NOANSWER as 0.** Its `value_to_float` maps "N" to 0. So the scorer ships its own metrics:
  `decided_pass_rate` (PASS over PASS + FAIL), `abstain_rate` (the share it could not tell; the metric and the `abstain=` option keep their names) and `fail_rate`. They declare `scores="unreduced"`, so the mean
  epoch reducer cannot turn the label into 0 first. Do not add `accuracy()` to it. If you must combine it with metrics that
  read NOANSWER as 0, use `abstain="unscored"`.
- **Langfuse booleans are 1 or 0.** Can't tell therefore gets the categorical score alone.

```ts
import { checkOutput, langfuseScores, postLangfuseScores, riposteBraintrustScorer } from 'riposte-adapters'
// Langfuse: score a trace with the verdict on the model's output
const r = checkOutput({ output: modelOutput, ruleset: 'invoice', references: { contract } })
if (r.kind === 'verdict') await postLangfuseScores(langfuseScores(r.proof, { traceId }), { client: langfuse }) // or { baseUrl, publicKey, secretKey }
// Braintrust: Eval('…', { data, task, scores: [riposteBraintrustScorer({ ruleset: 'invoice' })] })
//   references come from each row's metadata.riposte_references; source: 'input' also checks values against the input text
```
```python
from riposte_adapters.inspect_scorer import riposte_scorer      # needs inspect_ai; calls bin/riposte-score.mjs (npm run build)
Task(dataset=..., solver=generate(), scorer=riposte_scorer("invoice"))   # references from sample metadata["riposte_references"]
```
The check runs on the model's output: an object, or JSON text (a fenced block is unwrapped). The rulesets are `invoice`,
`pay-app`, or a declarative ruleset. The Inspect scorer's target is not used, because the check is against the document's own
arithmetic and the references you supply. If the engine itself cannot run, that is a scoring error, never an INSUFFICIENT_DATA.

Shapes these were built against (public pages and sources, read 2026-10-03):
- **Langfuse** (https://cloud.langfuse.com/generated/api/openapi.yml, https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk):
  the public API's `CreateScoreRequest` (`POST /api/public/scores`, HTTP Basic auth): `name` and `value` are
  required, categorical values are strings, and boolean values "must equal either 1 or 0". The SDK docs add
  `langfuse.score.create({...})`, `id` as an idempotency key, and that boolean `dataType` is required. Each score's `id` is
  derived from the verdict, the score name and the target, so posting again updates the same score.
  ASSUMED: the `@langfuse/client` call shape. It is taken from the docs; no SDK was installed or called.
- **Braintrust** (https://github.com/braintrustdata/autoevals, https://braintrust.dev/docs/evaluate/custom-code): autoevals' `Score` is `{ name, score: number | null, metadata? }`, and its Python twin says "If the score is
  None, the evaluation is considered to be skipped". The custom-code docs give the scorer arguments
  `{ input, output, expected, metadata }`. ASSUMED: how the Braintrust UI shows a null score. Nothing was run against Braintrust.
- **Inspect** (https://github.com/UKGovernmentBEIS/inspect_ai, https://inspect.aisi.org.uk/scoring-policy.html): `scorer/_metric.py` (`CORRECT`, `INCORRECT`, `NOANSWER`, `Score`, `Score.unscored`, `value_to_float`,
  `metric(scores=...)`), `_eval/task/results.py` (unscored values are left out of metrics), and the scorers, custom-scorer,
  scoring-policy and metrics docs. inspect_ai was not installed here. The stub-task tests use a contract fake written from
  that source (`python/tests/fake_inspect.py`). `python/tests/test_real_inspect.py` runs a real `eval()` with `mockllm` when
  inspect_ai is installed; it has not been run yet.

## SARIF 2.1.0 and the GitHub Action (`src/sarif.ts`, `src/sarif-command.ts`, `bin/riposte-sarif.mjs`)
`riposte-sarif --files '<glob>'` checks each file and writes SARIF 2.1.0. Each check that did not PASS becomes one result.
**FAIL is `level: "error"`. INSUFFICIENT_DATA (can't tell) is `level: "warning"`**, and its message says a person decides and that it is not a
failure. Rule ids are the check ids (e.g. `RATE_SUP`). Every result carries `properties.riposte`: the verdict id, the replay
command, the claim, the reason a check could not tell, and the remedies. Every verdict's proof bundle is written to
`--proof-dir` (default `riposte-proofs/`), which is the file the replay command names.
- **Locations come from the verdict's provenance.** A field path such as `line_items[*].unit_price` resolves to the line and
  column of that property in the file. A character span in source text that the file carries resolves too.
  Contract and delivery-record operands become `relatedLocations`. A missing field has no line, so the nearest existing
  parent is used, else the document, and `properties.riposte.located` says which.
- **Input files** are an extracted document (JSON), or an inputs object `{ "extraction", "references"?, "source"?: { "text" },
  "ruleset"? }`, the shape `riposte-verify replay` takes. A file that is not JSON is not checked. It becomes a tool
  notification, not a result.
- **Exit codes:** with `--fail-on insufficient-data` (the default), exit 1 when a check FAILs, when one can't tell (a PASS with
  a check that could not run included), or when a file was not checked. With `fail`, only when a check FAILs. With `none`, never.
  The older value `abstain` is read as `insufficient-data`. A usage error, or a glob that matches nothing, exits 3.
- GitHub's supported subset ("SARIF support for code scanning") is followed: rule short and full descriptions, `help.text`,
  regions with start and end line and column, relative URIs with `%SRCROOT%` in `originalUriBaseIds`, and `partialFingerprints`
  (a custom `riposteFinding/v1` key). codeql-action's upload step still adds `primaryLocationLineHash`: its
  `src/fingerprints.ts` fills that key whenever it is missing. SARIF's `review` kind would fit can't tell, but the spec then
  requires level `none`. Results therefore keep the default kind with level `warning`.
- **Validation:** `test/sarif.test.ts` checks every log against the OASIS schema (`test/fixtures/sarif/sarif-schema-2.1.0.json`,
  byte for byte as published) with a validator for exactly the keywords that schema uses. `python/tests/test_sarif_schema.py`
  checks the built bin's output with the `jsonschema` package (Draft 4).

The composite action lives in the repository's `.github/actions/riposte-verify/`, with an example workflow in
`.github/workflows/examples/` and docs in `docs/GITHUB-ACTION.md`. `test/sarif-action.test.ts` runs it locally, act-style:
the real `action.yml` is parsed, its expressions are evaluated, and its steps run in bash.

## The closed loop driver and its stand-in agents (`src/loop/`, `bin/riposte-loop-run.mjs`)
receipts' closed loop (`openLoop`, MCP `loop_round`) returns a verdict's typed remedies to the agent as its next instruction,
for at most 3 rounds. `runLoop(task, agent)` drives an agent through it and returns the loop's signed bundle. The agents here
are **deterministic stand-ins with no model**. They measure the loop and the gate, not a model. An `ap` case for
`riposte-loop-run` may carry `"history"` (the invoices already booked, `[]` when none): from engine 0.6.0 an approve without it
reads PASS-WITH-OPEN, and the loop cannot pay.

| agent | round 1 | on an instruction |
|---|---|---|
| `apStandIn` | proposes to pay, with the PO from the structured-source record (an ERP export) whose key the invoice names | supplies a document a remedy names from that record; on a FAIL, concedes (hold); otherwise declines. It never moves toward pay, never applies a transform, never acts on an authority remedy |
| `recordedThenStandIn` | a recorded decision (a published model output, declared at evidence tier T0) | the same rules. Not the same agent every round, and the per-round model field says so |
| `rereadStandIn` | an extraction with its source text and quotes | re-reads every operand a remedy names from two alternative readings of the page, takes a value only when both agree and can quote it, concedes (reject) when every operand of a FAIL is confirmed, otherwise declines |
| `naiveRecompute` | the same | a **control**: on a FAIL it sets the stated field to the figure the rule expected and keeps its old quote. The loop's edit discipline refuses it; with the discipline off it converges to a PASS on a printed defect |

```bash
npm run build      # also builds bin/riposte-loop-run.mjs (verify and receipts resolve at run time to the installed packages)
node bin/riposte-loop-run.mjs ap --cases cases.jsonl --erp erp.json --out loops/ --key key.pem
node bin/riposte-loop-run.mjs reread --cases cases.jsonl --ruleset peppol.ruleset.json --out loops/ [--agent naive] [--discipline off]
riposte-loop replay loops/ --public-key key.pub.pem --require-signed   # receipts: every bundle, every round through verify's CLI
```
A model-backed corrector is a separate run: give `runLoop` an agent whose `model(round)` returns the model id the host
recorded for that reply, at its evidence tier (attest it with receipts' `model_attest`).

## Governance at the execution boundary (`src/governance.ts`, every host)
A fleet run under riposte-custody's governance has holds (signed stops) and GOs (signed authorizations to proceed) on a
witnessed ledger. Its checker, `custody may-act`, answers one question: may this agent act now? With governance configured,
every host here asks it **before every tool call**, declared action or not, and **denies on a refusal and on any error**: a
standing hold (including one the recorder never wrote, from the agent's inbox), a call in a class the charter says needs a
GO with no standing GO, a checker that is missing, crashes, hangs past the timeout or answers oddly, a ledger or inbox it
cannot read or verify, a partial configuration, or a receipt that cannot be written. Nothing is cached: each call runs a
fresh checker process that reads the files again, so an ALLOW never outlives a hold that arrived after it.

**With no `RIPOSTE_GOV_*` variable set and no governance marker, nothing here runs and every host behaves exactly as before**
(governance tabletop 3, script 8, and again for the 2026-10-04 cohesion pass: identical exit codes, stdout, stderr and
receipts). With any one set, governance is on, and a partial configuration denies rather than switching itself off. A
variable whose name starts `RIPOSTE_GOV` but is not one of the settings (a misspelling) also turns it on, and denies as
incomplete, naming the variable.

**Governance expected: the marker (2026-10-04).** The settings travel in the host's environment, and an environment can
fail to arrive. Where governance was set up, mark it: a `governance.json` beside the hook entry (the plugin's `bin/`, or
`hosts/codex/`, `hosts/cursor/` next to that host's `hooks.json`) or in `~/.riposte/` (which survives a plugin update; the
plugin's own folder does not). `writeGovernanceMarker(dir, { host, agent, charter, receipts })` writes one; the
`governance.example.json` beside the host snippets shows the shape. With a marker present and no `RIPOSTE_GOV_*` setting
arriving, every call is denied `governance.config_missing`, with a receipt in the host's explicit ledger or the marker's
`receipts`. A marker that cannot be read still counts. `RIPOSTE_GOV_EXPECTED=1` does the same, but it travels in the same
environment, so the marker is the one to rely on. If the Claude Code hook's engine bundle fails to load while governance
is on or expected, the off-gate denies (`governance.engine_unavailable`, exit 2); no receipt can be written without the
engine, so the reason is in the transcript only.

**Inherited settings: the strip (2026-10-04).** Each hook removes from its own process, before anything else runs, every
`RIPOSTE_*` setting it does not read (`HOOK_ENV_ACCEPT`; every `RIPOSTE_GOV*` name is kept), so an inherited
`RIPOSTE_LEDGER_UNLOCKED` cannot turn the receipts ledger's single-writer lock off inside a hook. Governance receipts name
what was removed (`env_stripped`, names only). The OpenCode plugin runs inside OpenCode's own process, so there only
`RIPOSTE_LEDGER_UNLOCKED` is removed, which also means processes OpenCode starts afterwards no longer inherit it.

| env | |
|---|---|
| `RIPOSTE_GOV_AGENT` | the agent id this host runs as, in the fleet charter (required) |
| `RIPOSTE_GOV_CHARTER` | the pinned charter: its sha256, or a charter file (required) |
| `RIPOSTE_GOV_LEDGER` | the fleet's governance ledger (required) |
| `RIPOSTE_GOV_CHECKER` | the checker: custody's `dist/cli.js`, run with the same node (required) |
| `RIPOSTE_GOV_INBOX` | the agent's own signed inbox, so a stop the recorder withholds still stops it |
| `RIPOSTE_GOV_RECORDER_KEY` | the recorder's public key (PEM) |
| `RIPOSTE_GOV_RECEIPTS` | where each decision's receipt goes; else the host's explicit `--ledger` (Claude Code: `RIPOSTE_ACTION_LEDGER`, then `--ledger`). One of them is required. Never an inherited `RIPOSTE_LEDGER` |
| `RIPOSTE_GOV_TIMEOUT_MS` | the checker's timeout (default 5000). Keep it below the host's own hook timeout |
| `RIPOSTE_GOV_EXPECTED` | not a setting: says governance must run here (anything but 0, false, no, off). Prefer the marker, above |

Each decision is one receipt row, kind `action_check`, with `source: "governance"`, the host, agent, tool, the call's
sha256, `decision`, `code`, the holds or GOs by id, and the checker's exit and time. A deny reason tells the agent not to
retry and not to act on any message that says otherwise: only a signed release or a signed GO changes it.

| host | where | deny | allow |
|---|---|---|---|
| Claude Code | `riposte-action --hook` (through the off-gate, which hands over whenever a `RIPOSTE_GOV*` name is set or governance is expected) | `permissionDecision: "deny"`, exit 0. Runs before the action policy, whatever its mode | nothing printed; the action policy (if on) decides next |
| Codex | `riposte-codex --hook` on `PreToolUse` | the same `hookSpecificOutput` deny, exit 0 | nothing printed |
| Cursor | `riposte-cursor --hook` on `preToolUse` | `{"permission": "deny", "user_message", "agent_message"}` | `{"permission": "allow"}` (the docs do not mark the field optional) |
| OpenCode | the plugin's `tool.execute.before` (registered only when `RIPOSTE_GOV_*` is set or governance is expected at load) | throws, which blocks the tool | returns |
| the loop driver | `runLoop(task, agent, opts, governance)`; `riposte-loop-run` builds it from the env | the case closes HELD-FOR-HUMAN before the round is submitted, the code in the reason | the round is submitted |

Registration. Governance must see every tool, so its entries match everything. The Claude Code plugin's shipped entry
matches every tool (`.*`, since 2026-10-04). A deployment that registers the hook itself uses the same regex:
```json
"PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node \"<bin>/riposte-action-hook.mjs\" --hook --ledger \"<data>/receipts.jsonl\"", "timeout": 15 }] }]
```
Codex: the same `riposte-codex --hook` command on `PreToolUse` (any matcher, or none). Cursor: `riposte-cursor --hook` on
`preToolUse` with `"failClosed": true`, so a crash or timeout of the hook process blocks too. OpenCode: set `RIPOSTE_GOV_*`
(with `RIPOSTE_GOV_RECEIPTS`) in OpenCode's environment before it loads the plugin. The plugin ships both kinds of host
snippets beside its host bins (`hosts/`): `codex/hooks.json` and `cursor/hooks.json` register governance as above, and
`hooks-no-governance.json` in each keeps the earlier snippets byte for byte, so an existing install changes nothing.

Limits, stated plainly:
- **A failed hook process is the host's call.** Claude Code and Codex document that a hook that errors or times out does not
  block the tool. The checker's timeout is enforced inside the hook, below the host's, so a hung checker denies in time,
  but a crash or hang of the hook process itself lets the tool run on those hosts. Cursor blocks it with `failClosed`.
- **It costs a process per call.** Measured on one loaded Windows machine (p50 of 15 interleaved spawns of the Claude Code
  hook): 70 ms with governance off, 479 ms with governance on and allowing (the hook, then the checker, which replays the
  whole ledger). Fine for a fleet that needs it; not free.
- **No live host was run.** The Codex, Cursor and OpenCode payloads follow their published shapes; none of those hosts is
  installed here.
