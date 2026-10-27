# Riposte for Claude Code

One install gives your agent:
- a **Stop hook** that checks the claims it ends a turn with ("all tests pass", "the build is clean", "committed", "pushed",
  "created `x`") against what its own tools actually returned in the session, and writes a receipt;
- the **MCP tools** `check_done`, `ap_gate`, `replay_receipt`, `model_attest`, `check_claims`, `ledger_verify` and
  `loop_round` (what each takes and returns is in its own description, printed by `tools/list`; the gate they serve is the
  [agents page](../../docs/doors/agents.md));
- a **tamper-evident receipt ledger** (hash-chained JSONL, optionally Ed25519-signed);
- a **PreToolUse action hook** registered on every tool call, **off** until you turn it on (see [below](#the-action-hook-off-by-default)).

## Install from this repository alone

Everything the plugin runs is in this folder, built: `bin/` and `hosts/` need no `npm install` and no build. What follows is
the exact line for each host, and whether it has been run.

**Claude Code, as a plugin** (hooks and MCP server together). From the public repository, or from a clone:

```bash
claude plugin marketplace add SorenSocordia/riposte      # or: claude plugin marketplace add /path/to/riposte
claude plugin install riposte@riposte                    # -s project or -s local scopes it to one project; default: user
```

Run here: `claude plugin validate plugins/riposte` and `claude plugin validate .` (the marketplace manifest) both pass. An
install of this plugin at local scope on one machine resolved `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}` and
`${CLAUDE_PLUGIN_DATA}`: `check_done` read a file by its path relative to the project root, and its receipt landed in the
plugin's data directory as `receipts.jsonl`. Those three variables are the ones Claude Code documents for a plugin's
`.mcp.json` and hooks. Not run here: the marketplace line against the public repository on a fresh machine.

**Claude Code, the MCP server alone** (no hooks, nothing started on a tool call), for yourself only:

```bash
claude mcp add riposte -e RECEIPTS_ROOT=/path/to/your/workspace -e RECEIPTS_LEDGER=/path/to/receipts.jsonl -- node /path/to/riposte/plugins/riposte/bin/riposte-mcp.mjs
```

or for a project, a `.mcp.json` at the project root:

```json
{ "mcpServers": { "riposte": { "type": "stdio", "command": "node",
    "args": ["/path/to/riposte/plugins/riposte/bin/riposte-mcp.mjs"],
    "env": { "RECEIPTS_ROOT": "/path/to/your/workspace", "RECEIPTS_LEDGER": "/path/to/receipts.jsonl" } } } }
```

Use absolute paths: in a project's own `.mcp.json`, Claude Code sets `CLAUDE_PROJECT_DIR` in the server's environment rather
than expanding it in the file. Not run here as a host install; the server itself was driven with the hand-written session
below.

**Codex CLI, Cursor, OpenCode** (the claims check and, if you want it, governance): the files and the lines are in
[`hosts/README.md`](hosts/README.md). Not run here: none of the three hosts is installed on the machine this was written on.
Each port's behaviour is covered by the smoke run below, which feeds each one its host's recorded event shapes.

**Any MCP host, or no host.** The server is JSON-RPC 2.0, one message per line on stdin and stdout, so a shell can drive it.
From the repository root, with no install:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node plugins/riposte/bin/riposte-mcp.mjs
```

prints the seven tools and creates no file. A session that calls a tool writes its receipt to `RECEIPTS_LEDGER`, else
`receipts.jsonl` under `RECEIPTS_ROOT`, else under the working directory; `check_done` reads only inside `RECEIPTS_ROOT`
(absolute paths and `..` are refused). Run here, from a clone with nothing built: `initialize`, `tools/list`, `ap_gate` with
a structured bill (EXECUTE, PAY, status PASS, the proof returned in `structuredContent.proof`), `check_done` with a true
claim (PASS) and a false one (FAIL: `deploy.version is "1.2.0", not "1.3.0"`); three receipts on the ledger,
`node bin/riposte-ledger.mjs verify` OK, and `node bin/riposte-replay.mjs --ledger … --proof …` MATCH, bound to entry 0.

**Is the Stop hook writing?** It is record-only and fails open by default, so a quiet install looks the same as one that
never ran. Check once: the ledger at `${CLAUDE_PLUGIN_DATA}/receipts.jsonl` (Claude Code's plugin data directory for
`riposte`) should gain a line per end of turn; `node bin/riposte-ledger.mjs verify <that file>` reads it.

**Check the folder itself**: `node scripts/check-plugin.mjs` (every file the hooks and `.mcp.json` point at is present,
no bundle changed since the build), `npm run check:plugin` (runs each registered command once against each host's recorded
event shapes) and `node scripts/check-plugin.mjs --reproduce` (rebuilds every bundle from the sources and compares byte for
byte; needs the root `npm install --legacy-peer-deps` for the pinned esbuild). All three pass on a fresh clone.

## The two hooks it registers
| hook | runs on | by default |
|---|---|---|
| `Stop` | every end of turn | **on, record-only**: it checks the turn's closing claims and writes a receipt; it never sends a turn back until you set `RIPOSTE_HOOK_MODE` |
| `PreToolUse` | every tool call (matcher `.*`: MCP tools, Bash, Edit, Write alike) | **off**: it still starts one `node` process per tool call (about 51 ms on one Windows machine), then exits before its engine loads, prints nothing and records nothing, until you set `RIPOSTE_ACTION_HOOK` |

Both point at files in this plugin's `bin/` (`riposte-claims.mjs`, `riposte-action-hook.mjs` with its engine
`riposte-action.mjs`), and the MCP server at `bin/riposte-mcp.mjs`. They ship built, because a marketplace install copies
this folder alone. The install lines, host by host, are [above](#install-from-this-repository-alone).

## It measures before it enforces
By default the Stop hook is **record-only**. It never sends a turn back and never fails. It checks every stop and records what it
would have done (`would_block`), so you can read the ledger before you decide to enforce anything. Configure it with
environment variables, for example in the `env` block of your settings:

| variable | values |
|---|---|
| `RIPOSTE_HOOK_MODE` | `record-only` (default) · `only-contradicted` (send back only claims that are demonstrably false) · `block` (also send back unbacked ones) |
| `RIPOSTE_STRICT` | `1`: "done / fixed / implemented" then needs a passing test run after the last code edit |
| `RIPOSTE_LEDGER` | the Stop hook's ledger file (default: the plugin's data directory, `receipts.jsonl`). Never used for action receipts. |
| `RECEIPTS_KEY` | path to an Ed25519 private key (PEM). Entries get signed. |
| `RIPOSTE_NUNCHI` | `off` (default): the default messages, byte for byte · `on` (also `1`, `true`, `yes`): a sent-back stop is worded for its consequence tier and audience. It changes how the stop is said, never whether it is sent back, and the receipt gains a `nunchi` key with the hash of the facts it delivered. |
| `RIPOSTE_TIER` | with `RIPOSTE_NUNCHI=on`: `low` · `moderate` · `high` · `severe`. Unset (or any other value) counts as the top tier: plain words, no softening. |
| `RIPOSTE_AUDIENCE` | with `RIPOSTE_NUNCHI=on`: `solo` (default, terminal lines) · `pr` (Markdown with a findings table) · `auditor` (a keyed record with the facts hash) |

`RIPOSTE_TIER` and `RIPOSTE_AUDIENCE` do nothing without `RIPOSTE_NUNCHI=on`. Whatever the wording, the facts are the same:
every finding, with its evidence, in every tier and audience.

In any enforcing mode, a stop is sent back **at most once** (`stop_hook_active`), and the hook's own failures never block the
agent.

## The action hook: off by default
The plugin registers a `PreToolUse` hook on every tool (matcher `.*`, a regex; MCP tools, Bash, Edit and Write alike). Until
you set `RIPOSTE_ACTION_HOOK`, it exits before its engine loads, prints nothing and records nothing. When on, it checks each
call to a tool that your **action policy** declares: is every value the call would send grounded in a declared source?
- At the `gate` and `autonomy` levels (set in the policy), a FAIL or a can't tell is **held for a person**: Claude Code's permission prompt. When nobody
  can be asked (`dontAsk`, `bypassPermissions`), or the same call was already held in this session, the call is denied with
  the reason and an instruction not to retry. At `gate`, a PASS also goes to the prompt, for review.
- At `advise`, the finding is shown to you and added to the agent's context, and the call runs. At `record`, it is only recorded.
- Tools the policy doesn't declare pass through. The hook never allows anything Claude Code wouldn't allow on its own.
- **A broken setup holds what moves money, and lets the rest run.** If the policy is missing, unreadable or invalid,
  `RIPOSTE_ACTION_HOOK` is misspelled, or the hook input is malformed, a consequential call (one the policy sets at `gate`
  or `autonomy`; with no readable rule, a tool whose name moves money or files something, such as `mcp__bank__transfer`)
  is denied with the problem and its fix, for example `RIPOSTE_ACTION_HOOK 'onn' is not one of off/record-only/on; did you
  mean on?`. Every other call runs, with a `governance degraded` receipt. Check the setup once, after installing or after any
  change, with `node bin/riposte-action.mjs --doctor`: it prints what the hook does on each declared action and exits 1 if
  the hook would run degraded. `RIPOSTE_ACTION_ON_ERROR=open` restores the old fail-open behaviour; every call it affects
  prints a line saying so and records `on_error: "open"`.

| variable | values |
|---|---|
| `RIPOSTE_ACTION_HOOK` | `off` (default) · `record-only` (check and record what it would have done, `would_decision`; print nothing) · `on`. Any other value is a setup error, never off: consequential calls are held until it is fixed |
| `RIPOSTE_ACTION_ON_ERROR` | `hold` (default) · `open`: on a setup error, fail open as before (loud, and recorded on every receipt it affects) |
| `RIPOSTE_ACTION_POLICY` | path to the action policy (required unless off). Example: [`packages/adapters/examples/action-policy.example.json`](../../packages/adapters/examples/action-policy.example.json). Check one with `node bin/riposte-action.mjs --lint --policy <file>`. |
| `RIPOSTE_ACTION_LEDGER` | where action receipts go. Default: the plugin's data directory, `receipts.jsonl`, which the hook is given with `--ledger` (the same file the Stop hook and the MCP tools use by default). `RIPOSTE_LEDGER` is never used for action receipts. The hook's repeat guard reads this ledger. |

What it costs, measured on one Windows machine (median of 30 interleaved runs): a bare `node` start takes 45 ms. With the hook
off, each tool call pays one node start through the gate, 51 ms. With it on, about 65 ms, receipt included.

Why the off check runs inside Node and not in the hook's command line: off means more than an unset `RIPOSTE_ACTION_HOOK`.
The hook is also on when governance is configured or expected (a `RIPOSTE_GOV*` setting, or a `governance.json` beside the
hook or in `~/.riposte/`), and then it must deny every call if its engine cannot load. That test lives in one place, the
hook's own code. A second copy in the command line would run under whatever shell the host uses, and a copy that read the
settings differently would switch governance off without a word. If one node start per tool call is too much for your
policy, do not install the plugin: register the MCP server (`.mcp.json`) and, if you want it, the `Stop` hook command from
`hooks/hooks.json` in your own settings. Neither starts anything on a tool call.

## The executables
`bin/` holds self-contained bundles generated by `npm run build:plugin` from `packages/verify`, `packages/receipts` and
`packages/adapters`, and they are committed: the plugin works straight from a marketplace install. `bin/BUILD.json` records
each bundle's sha256 and the engine and checker versions it was built from. `node scripts/check-plugin.mjs` checks that every
file `hooks/hooks.json` and `.mcp.json` point at is there, that no bundle changed since the build, and that the build is
not older than the sources; `npm run check:plugin` also runs each registered command once. The repository's export refuses
to publish a plugin that fails this check.

**Rebuild the bundles yourself and compare.** The build is reproducible: the same sources give the same bytes on any machine,
so you do not have to trust the committed bundles. In a fresh checkout:

```bash
npm install --legacy-peer-deps                # installs the pinned esbuild (package.json: exact version)
node scripts/check-plugin.mjs --reproduce     # rebuilds every bundle into tmp/ and compares; exit 0 = byte for byte
```

It rebuilds every file `bin/BUILD.json` lists, and `bin/BUILD.json` itself, and compares each with the committed file. Exit 1
names each file that differs, and each source file that differs. Exit 2 means it cannot compare here: no esbuild installed, or
not the version `bin/BUILD.json` names. You can also run `npm run build:plugin` and check with `git diff` that nothing in
`plugins/riposte/` changed. `bin/BUILD.json` records the esbuild version and a digest of the sources. That digest is the sha256
of `bin/BUILD-SOURCES.txt`, which lists every source file the bundles were built from with its sha256, in the format
`sha256sum` prints, so `sha256sum -c` from the repository root checks the list against your checkout. The build pins
everything that would otherwise vary: the esbuild version, the TypeScript settings that change emitted code, the module path
comments, and the files' modification time. It records no time and no machine path.

The same commands work from a shell:
- `node bin/riposte-claims.mjs <transcript> --all-turns` audits a whole session.
- `node bin/riposte-attest.mjs <transcript> --declared <model-id>` checks which model actually answered.
- `node bin/riposte-ledger.mjs verify <ledger> --key <issuer.pub.pem>` verifies a ledger against the issuer's public key.
- `node bin/riposte-ledger.mjs rule <ledger> --verdict <id> --by <role> --decision allow|deny --note "…" --key <you.pem>` records
  a person's signed ruling on one verdict. `ap_gate` honours it only when that key is pinned for the role (`RIPOSTE_AUTHORITIES`).
- `node bin/riposte-replay.mjs <bundle.json | cases.jsonl | folder>` or `--ledger <ledger> --entry <seq>` re-performs a verdict
  and prints its answer (PASS / FAIL / INSUFFICIENT_DATA; for AP the gate's decision first) and its remedies, or the field
  where it diverges. A verdict whose remedies were deleted is refused. `ap_gate` receipts store hashes and offsets by default, so replay one with the proof the tool returned
  (`structuredContent.proof`): `--ledger <ledger> --proof <proof.json>` checks it belongs to the receipt, then re-performs it.
- `node bin/riposte-action.mjs --check --policy <file>` checks one proposed call (`{"tool": …, "arguments": {…}}` on stdin).
- `node bin/riposte-action.mjs --doctor` checks the action hook's setup from the same environment the hook reads.
