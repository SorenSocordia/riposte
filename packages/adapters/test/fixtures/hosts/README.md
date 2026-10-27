# Host fixtures for the claims-check ports

Each host has the same scenarios: an honest "All 62 tests pass." backed by a passing test run (`honest`), a planted false
"All tests pass." after a failing run (`planted-failing`) or with no test run at all (`planted-norun`), and the turn after a
send-back (`after-sendback`). Malformed payloads are built inline in the tests.

None of these was captured from a live session: no Codex, Cursor or OpenCode install was available when they were written.
Each was written from the host's published shapes. Where a shape could only be read from documentation or source, and a
live build could still differ, the fixture is labelled **ASSUMED** below, with what would confirm it.

## Codex CLI (`codex/`)
- `stop.template.json`: the Stop hook input. **Verified** against the generated wire schema
  `codex-rs/hooks/schema/generated/stop.command.input.schema.json` (main branch, fetched 2026-10-03): every required field
  is present, with the declared types.
- `*.rollout.jsonl`: the session rollout that `transcript_path` points to. **ASSUMED.** The line shape
  (`{timestamp, type: "response_item", payload}`), the response items (`message`, `function_call`, `function_call_output`,
  `custom_tool_call`, `custom_tool_call_output`) and the `exec_command` output header ("Wall time: …", "Process exited with
  code N", "Process running with session ID N", "Output:") were read from Codex's source on its main branch
  (`codex-rs/history/src/lib.rs`, `codex-rs/protocol/src/models.rs`, `codex-rs/core/src/tools/context.rs`). Codex's docs say
  the transcript format "isn't a stable interface for hooks and may change over time". **Would confirm:** one rollout file
  from a real Codex session that ran a test command, read with `sessionFromCodexRollout`.

## Cursor (`cursor/`)
- `*.events.json`: the hook payloads in the order the port receives them. The common fields, `postToolUse`
  (`tool_output` as a JSON string with `exitCode` and `stdout`), `afterFileEdit`, `afterAgentResponse` and `stop`
  (`status`, `loop_count`) are **verified** against https://cursor.com/docs/agent/hooks (saved 2026-10-02).
- **ASSUMED:** (1) a shell command that exits non-zero arrives as `postToolUse` with its `exitCode`, not as
  `postToolUseFailure` (the port handles both); (2) `afterAgentResponse` for the final message arrives before `stop`;
  (3) `loop_count` counts this conversation's automatic follow-ups, so 1 means the turn was already sent back. **Would
  confirm:** the payloads of one real Cursor agent turn that ran a failing test, logged by a hook that echoes its stdin.

## OpenCode (`opencode/`)
- `*.messages.json`: what `client.session.messages({ path: { id } })` returns, `Array<{ info, parts }>`. **Verified**
  against the v1 SDK types (`packages/sdk/js/src/gen/types.gen.ts`: UserMessage, AssistantMessage, TextPart, ToolPart,
  ToolStateCompleted) and the built-in tools (`packages/opencode/src/tool/shell.ts`: tool id `bash`, `metadata.exit`;
  `edit.ts` / `write.ts`: `filePath`) on the dev branch, fetched 2026-10-03.
- **ASSUMED:** the plugin running inside OpenCode's Bun runtime (these tests run under Node), and the send-back marker
  (`metadata.riposte` on the prompt's text part) surviving the round trip; the port also recognises a send-back by its
  closing line, so it does not depend on that. **Would confirm:** one real OpenCode session with the plugin installed and
  RIPOSTE_HOOK_MODE=block, ending on a false "tests pass".
