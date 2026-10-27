# The model-switch monitor (`riposte-attest monitor`, `riposte-attest-monitor`)

A month of host records and provider usage exports in; out comes a signed report of which model answered each recorded reply,
on what evidence, and every model switch with its cause. It is for anyone whose contract, policy or audit names a model:
compliance and vendor-risk teams, and deployers who must show that the model they declared is the model that ran.

Offline. Nothing is sent anywhere. From any record it reads only ids, times, model fields, token counts and command tags,
never message content.

## Evidence tiers

Every finding names the tier it rests on and what would raise it.

| tier | name | rests on | cannot prove | raised by |
|---|---|---|---|---|
| T0 | declared only | the model the run was declared, or the host was asked, to use | anything about which model answered | a host transcript with the provider's model field (T1), or a provider export (T2) |
| T1 | host-recorded per reply | the provider's per-message `model` field, as the host transcript recorded it | that the provider reported truthfully, or that the transcript was not edited later | a provider export (T2), or an anchor written as the reply happened (T3) |
| T2 | provider usage export | the provider's own usage or billing rows that match the reply and name the model billed | that the provider's records are true | an anchor, or a signed provider attestation (T3) |
| T3 | signed record | a host record anchored in a signed receipt ledger when the reply happened | which weights ran (only hardware attestation speaks to that) | nothing higher in this ladder |

A reply is counted at the highest tier that agrees with it. A record that disagrees is never averaged away: it is a flag.

## What it reads

### Host records (per reply)

| `format` | what it is | model read | tier | how the format is known |
|---|---|---|---|---|
| `claude-code` | a Claude Code session transcript (JSONL) | `message.model` per reply; `message.id`, `requestId`, `timestamp`, `message.usage` | T1 | not publicly documented; the fields were observed in real transcripts. One reply can span several entries; the last entry's usage is taken as final (ASSUMED) |
| `codex` | a Codex CLI rollout file (JSONL) | `turn_context.payload.model`: the model Codex **asked for**, not the one that answered | T0 unless corroborated | Codex's open source (`RolloutItem`, `TurnContextItem`, `TokenUsageRecord`); its docs say the format "may change". A `thread_settings_applied` event that changes the model announces the next switch (ASSUMED) |
| `api-log` | your own log of provider responses (JSONL): the response object as returned, or `{ at, request_id, response }` | the response's `model` | T1 | the providers' response shapes (Anthropic Messages, OpenAI chat completion and Response objects, OpenRouter's OpenAI-shaped completion) |

### Provider exports (T2)

Field lists were taken from the public schemas and saved raw before the parsers were written. A field the schema does not
name refuses the export until you acknowledge it. A field the parser needs that is missing refuses it. Nothing is guessed.

| `source` | export | granularity | fields read | schema |
|---|---|---|---|---|
| `anthropic-usage-report` | Admin API `GET /v1/organizations/usage_report/messages`, grouped by model | 1m, 1h or 1d buckets | `starting_at`, `ending_at`, `model`, `uncached_input_tokens`, `cache_read_input_tokens`, `cache_creation`, `output_tokens` | verified: [docs.claude.com](https://docs.claude.com/en/api/admin-api/usage-cost/get-messages-usage-report). Input compared as uncached + cache read + cache creation (ASSUMED) |
| `openai-usage` | `GET /v1/organization/usage/completions`, grouped by model | 1m, 1h or 1d buckets | `start_time`, `end_time`, `model`, `input_tokens`, `output_tokens`, `num_model_requests` | verified: [openai-openapi](https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml) |
| `openai-chat-completions` | `GET /v1/chat/completions` (stored completions only) | per request | `id`, `created`, `model`, `usage.prompt_tokens`, `usage.completion_tokens` | verified: openai-openapi |
| `openai-responses` | Response objects, retrieved one by one (`GET /v1/responses/{id}`) | per request | `id`, `created_at`, `model`, `usage.input_tokens`, `usage.output_tokens` | verified: openai-openapi. The file layout (array or JSONL) is ours (ASSUMED) |
| `openrouter-generations` | `GET /api/v1/generation` answers | per request | `id`, `request_id`, `upstream_id`, `created_at`, `model`, normalized and native token counts | verified: [openapi.json](https://openrouter.ai/openapi.json). Either token reading may match (ASSUMED) |
| `openrouter-activity` | `GET /api/v1/activity` | per UTC day, model and endpoint | `date`, `model`, `model_permaslug`, `prompt_tokens`, `completion_tokens`, `requests` | verified: openapi.json |
| `anthropic-console-csv`, `openai-dashboard-csv`, `openrouter-activity-csv` | the dashboards' CSV downloads | as your map says | the columns your map names | no published column list, so read only through a column map you write; every other column must be acknowledged |

Check one export on its own: `riposte-attest monitor parse --source <id> <file> [--columns map.json] [--acknowledge <field>]`.

## The manifest

```json
{
  "month": "2026-09",
  "deployer": "Example Co.",
  "runs": [
    { "name": "support-bot", "path": "runs/support.jsonl", "format": "api-log", "provider": "anthropic", "declared": "claude-sonnet-4-5-20250929" },
    { "name": "coding", "path": "runs/rollout.jsonl", "format": "codex", "provider": "openai", "declared": "gpt-5-codex", "allowed": ["gpt-5-codex", "gpt-5-codex-mini"] }
  ],
  "exports": [
    { "source": "anthropic-usage-report", "path": "exports/usage-2026-09.json" },
    { "source": "openai-responses", "path": "exports/responses.jsonl" }
  ],
  "anchors": [{ "ledger": "anchors.jsonl", "public_key": "anchor.pub.pem" }]
}
```

- `declared` is the exact model id the run was declared to use; `allowed` lists every acceptable id instead.
- `provider` says whose exports speak for this run. An export never judges a reply another provider served; a run without a
  provider is corroborated only by request id.
- `account` on a run and an export keeps two accounts of one provider apart.
- Optional: `match_window_seconds` (default 300), `anchor_lag_seconds` (default 3600).

## Matching, with a stated confidence

Nothing is joined on time alone.

| method | when | confidence | verdict |
|---|---|---|---|
| `request_id` | the reply's id or request id equals the row's id, request id or upstream id | 1.0 | agree or disagree on the model |
| `time_tokens` | exactly one unclaimed row in the window with equal input and output tokens | 0.9 | agree or disagree |
| `time_tokens_ambiguous` | several such rows, all billing one model | 0.6 | agree or disagree |
| `ambiguous` | several such rows billing different models | 0 | none |
| `bucket_exact` | the bucket's rows for the model equal the sums of the replies on it (and the request count) | 0.8 minute, 0.7 hour, 0.6 day | agree |
| `bucket_contained` | the rows cover the sums (other traffic shares the bucket) | 0.6 minute, 0.45 hour, 0.3 day | agree |
| `bucket_absent` | the export covers the bucket, is grouped by model, and bills nothing on the reply's model | 0.7 | disagree |
| `bucket_short` | the rows bill the model for fewer tokens than its replies used | 0.6 | no verdict per reply; one group finding |

Model names agree when equal, when one is the other with a dated snapshot (`-20250929` or `-2025-04-14`), or through
OpenRouter's permaslug.

## Switch causes

| cause | meaning | announced |
|---|---|---|
| `user_command` | the user asked (Claude Code `/model`; a Codex settings change) | yes |
| `host_fallback` | the host switched on its own and recorded it (for example a safety-refusal fallback) | no |
| `unrecorded` | nothing in the record explains the change | no |
| `alias_float` | the declared id names a family, not one model: a floating alias (`…-latest`), or an undated id whose dated snapshot changed between replies | no |

An announced switch to a model that was not declared still counts every later reply as not declared.

## The monthly report

```
riposte-attest monitor run manifest.json --out report/ --ledger receipts.jsonl --key signing-key.pem
```

- `report/attest-report.md`: per declared model, the replies by tier, how many an export corroborated, coverage (replies with
  any evidence beyond the declaration over replies recorded), switches by cause, every silent switch with the evidence before
  and after it, replies from a model that was not declared, records that disagree with the host's, bucket shortfalls, the
  exports used (with their assumptions and acknowledged fields), anchors, and what the report cannot prove.
- `report/attest-report.json`: the same, with every reply's finding, its evidence and what would raise it.
- One `model_attest_report` receipt on the ledger holding both files' sha256, signed, written under the ledger's single-writer
  lock (a ledger another live process holds is refused). Check it with
  `riposte-ledger verify receipts.jsonl --key signing-key.pub.pem --require-signed`.

Exit codes: 0 report written with no flags · 1 report written with flags · 3 refused (manifest, export or lock), nothing
guessed.

## T3: anchoring replies as they happen

```
riposte-attest monitor anchor <transcript.jsonl> --format claude-code --run <name> --ledger anchors.jsonl --key anchor-key.pem
```

Run it after each turn (for example from a Stop hook). It writes each new reply's id and recorded model as a signed
`model_reply` receipt. At month end the monitor reads the anchors with your public key. An anchor that agrees lifts the reply
to T3. One that disagrees means the host record changed after it was anchored. An anchor written more than an hour after its
reply does not count.

## The pre-registered synthetic test

**Synthetic.** Invented model ids, a generated month, no real transcript or export. The pre-registration
(`test/fixtures/attest-monitor/PREREG.md`) was frozen before its three seeds were generated. It plants switches of every cause,
alias floats, announced switches, and records that disagree with the host's, across all three host formats and six export
shapes. The first run is the result:

| metric (3 seeds, 66 runs, 1,207 replies) | bar | first run |
|---|---|---|
| P1. planted switches flagged with their planted cause | 27 of 27 | 27 of 27 |
| P2. false flags on clean runs | 0 on 30 runs | 0 |
| S1. planted record disagreements flagged | 12 of 12 | 12 of 12 |
| S2. flags on planted runs beyond the planted ones | 0 | 0 |
| S3. runs whose full expectation was met | reported | 66 of 66 |

After the first run, three of the frozen source files changed in ways the test does not score. The report gained a
bucket-shortfall line and section, with one per-model count behind them. `model_attest` gained its evidence-tier key. The
test was re-run on the same recorded seeds with the same result; `PREREG.lock.json` still holds the hashes as frozen.

This is a conformance test: the monitor and the generator have the same author, so it shows the monitor flags what it was
built to flag, with the right cause, and nothing else. It is not a field accuracy figure. Regenerate any month with
`riposte-attest monitor synth --seed <n> --out <dir>`.

## What it cannot prove

- Which weights ran. Every tier rests on records; none observes the serving hardware.
- That a provider told the truth. A provider that serves another model and writes the declared name in both its reply and
  its billing passes every check, because T1 and T2 then agree with each other.
- Anything about requests the host did not record.
- Which reply a bucket row served, or anything outside an export's filter (an export limited to some keys reads as absence).
- Which model answered a Codex reply on the host record alone.
