# Riposte's claims check on Codex, Cursor and OpenCode

The Claude Code plugin's Stop hook checks the claims an agent ends a turn with ("all tests pass", "the build is clean",
"committed", "pushed", "created `x`") against what its own tools returned in the session. These ports run the same check
at each host's end-of-turn event. They make the same decision, word a send-back the same way, and write the same receipt to
the same kind of ledger, so `riposte-ledger verify` reads every host's receipts alike. The one addition is a `host` key
(`codex`, `cursor` or `opencode`), so the ledger says where each stop came from. Without it, a port's receipt is byte for byte
the Claude Code hook's for the same claim. Claude Code's own receipts carry no `host` and keep their bytes.

| file (built by `npm run build:plugin`) | host | install |
|---|---|---|
| `codex/riposte-codex.mjs` | OpenAI Codex CLI, `Stop` hook (and `PreToolUse` for governance) | merge `codex/hooks-no-governance.json` (the claims check alone) or `codex/hooks.json` (with governance, below) into `~/.codex/hooks.json` (or `<repo>/.codex/hooks.json`), then trust it in `/hooks` |
| `cursor/riposte-cursor.mjs` | Cursor agent hooks | merge `cursor/hooks-no-governance.json` (the claims check alone) or `cursor/hooks.json` (with governance, below) into `~/.cursor/hooks.json` (or `<project>/.cursor/hooks.json`) |
| `opencode/riposte.js` | OpenCode plugin | copy it into `.opencode/plugins/` (one project) or `~/.config/opencode/plugins/` (every project) |

Copy this `hosts/` folder somewhere stable first, then replace `RIPOSTE_HOSTS_DIR` in the snippets with its absolute path.
Each file is self-contained and needs only Node 20 or later (OpenCode loads its plugin with its own runtime).

## The same contract on every host
- **Record-only by default.** With `RIPOSTE_HOOK_MODE` unset, it checks every stop and records `would_block`, but never sends a
  turn back and never fails. `only-contradicted` sends back only demonstrably false claims. `block` also sends back unbacked
  ones.
- **At most once.** A turn that was already sent back is let through.
- **Fails open.** The port's own errors never block the host. In record-only it exits 0. In an enforcing mode it reports a
  visible, non-blocking error.
- **The same variables** as the Claude Code plugin: `RIPOSTE_HOOK_MODE`, `RIPOSTE_STRICT`, `RIPOSTE_LEDGER`, `RIPOSTE_NUNCHI`
  (with `RIPOSTE_TIER` and `RIPOSTE_AUDIENCE`) and `RECEIPTS_KEY`. See the plugin's README.
- **The ledger** is `RIPOSTE_LEDGER`, else `--ledger <file>`, else `~/.riposte/receipts.jsonl`. To keep one ledger for every
  host, point all of them at the same file, including the Claude Code plugin's.

## What each port can and cannot see
| host | the end-of-turn event | how a turn is sent back | what the port reads | what it cannot see |
|---|---|---|---|---|
| Codex | `Stop`: `transcript_path`, `stop_hook_active`, `last_assistant_message` | exit 2 with the reason on stderr; Codex makes it the next prompt | the session rollout: shell runs with their exit codes, `apply_patch` edits, the final message | a rollout format change: Codex calls the transcript format unstable, so a change shows up as unbacked claims, never as a block of its own. Sessions without a transcript are not checked. |
| Cursor | `stop`: `status`, `loop_count` | `followup_message`, submitted as the next user message | a per-conversation journal built from `postToolUse` (exit code and output), `postToolUseFailure`, `afterFileEdit` and `afterAgentResponse` | Cursor's transcript (its format is not documented), and any tool call made while the hooks were not installed. The journal keeps the last 64 KB of each tool output. It lives in `RIPOSTE_STATE_DIR`, else `cursor-journal/` beside the ledger, and is deleted at `sessionEnd`. |
| OpenCode | `session.idle` | a prompt sent into the session (`promptAsync`), marked as Riposte's | the session's messages: `bash` runs with `metadata.exit`, `edit` / `write` / `apply_patch`, the final text | anything not in the session's messages. It runs inside OpenCode, and its errors go to OpenCode's log. |

Each port maps its host's tool names onto the checker's: shell runs are `Bash`, file edits are `Edit` or `Write`, so a receipt
reads the same whichever host wrote it, apart from its `host`. The command itself is kept as the host recorded it.

## Governance: the fleet's execution-boundary check before every tool call (optional)

The same bins can ask a fleet's execution-boundary check before every tool call, and deny on a refusal and on any error. It
is off unless `RIPOSTE_GOV_*` configures it (see the adapters README). Two sets of snippets ship, so nothing changes for an
existing install:

| host | with governance | without governance (the earlier snippets, byte for byte) |
|---|---|---|
| Codex | `codex/hooks.json`: `PreToolUse` and `Stop` | `codex/hooks-no-governance.json`: `Stop` only |
| Cursor | `cursor/hooks.json`: `preToolUse` with `"failClosed": true`, plus every event below | `cursor/hooks-no-governance.json` |
| OpenCode | the same `opencode/riposte.js`: it adds `tool.execute.before` when governance is configured or expected | the same file |

- **Cursor's `failClosed: true`** makes a crash, a timeout, a non-zero exit or no output of the `preToolUse` hook block the
  tool call. Without it, Cursor lets the call through on a hook failure.
- **Codex and Claude Code** let a tool call run when the hook process itself crashes, cannot start or times out. The hook
  denies explicitly on every error it can see, but a hook process that dies is the host's call. Keep the hook timeout
  (15 s here) above `RIPOSTE_GOV_TIMEOUT_MS` (5 s by default).
- **OpenCode** skips a plugin that fails to load, so every tool call then runs.
- **Inherited settings.** The Codex and Cursor bins remove every `RIPOSTE_*` setting they do not read before anything runs,
  so an inherited `RIPOSTE_LEDGER_UNLOCKED` cannot turn the receipts ledger's lock off. The OpenCode plugin runs inside
  OpenCode's own process, so it removes only `RIPOSTE_LEDGER_UNLOCKED`, and processes OpenCode starts afterwards no longer
  inherit it.

**Mark governance as expected.** The `RIPOSTE_GOV_*` settings travel in the host's environment, and an environment can fail
to arrive. Where governance is set up, put a `governance.json` beside the bin (`codex/` or `cursor/`, next to that host's
`hooks.json`) or in `~/.riposte/`, shaped like `governance.example.json` here. Then a hook that gets no `RIPOSTE_GOV_*`
setting denies every call (`governance.config_missing`) instead of running without governance, and writes the denial to the
marker's `receipts` ledger. For OpenCode use `~/.riposte/governance.json`: OpenCode loads the files in its plugins folder
at startup, so do not put the marker there. `RIPOSTE_GOV_EXPECTED=1` does the same as a marker, but it travels in the same
environment, so it catches settings dropped one by one, not an environment lost whole: prefer the marker. Delete the
marker only to take governance down on purpose.
