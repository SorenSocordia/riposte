# Model-switch monitor: pre-registration (synthetic conformance test)

Written and frozen 2026-10-03, before the three seeds below were generated or run. `PREREG.lock.json` beside this file holds
this file's sha256, the sha256 of every monitor source file and of the generator at the moment of freezing, and the time.

## What is tested

`riposte-attest monitor run` over a synthetic month: 22 runs per seed, in all three host formats (Claude Code transcripts,
Codex rollouts, provider-response logs), with six provider exports in their publicly documented shapes (Anthropic usage
report, OpenAI usage, OpenAI stored chat completions, OpenAI Response objects, OpenRouter generations, OpenRouter activity)
and one signed anchor ledger. Every model id is invented.

Per seed, 10 clean runs and 12 planted runs:

| plant | runs | what is planted | expected |
|---|---|---|---|
| clean | 10 | one model throughout, every export consistent | no switch, no flag, PASS |
| announced | 1 | a `/model` command, then a switch to an allowed model | one switch, cause user_command, announced; no flag; PASS |
| host_fallback | 1 | a host fallback entry, then a switch to an undeclared model | one silent switch, cause host_fallback; every later reply not declared; FAIL |
| unrecorded | 2 | a switch with nothing recorded (Claude Code; a provider-response log) | one silent switch, cause unrecorded; every later reply not declared; FAIL |
| alias_float_latest | 1 | declared "...-latest"; the dated snapshot changes | one silent switch, cause alias_float; ABSTAIN |
| alias_float_snapshot | 1 | declared an undated family id; its dated snapshot changes | one silent switch, cause alias_float; no reply counted as not declared; FAIL |
| codex_announced | 1 | a Codex settings change, then the requested model changes (both allowed) | one switch, cause user_command, announced; PASS |
| codex_unrecorded | 1 | the Codex requested model changes with no settings event | one silent switch, cause unrecorded; every later reply not declared; FAIL |
| billing_request | 1 | one reply billed under another model in the per-request export | one disagreeing record; one bucket shortfall in the daily export; FAIL |
| billing_bucket | 1 | one reply billed under another model in the minute-bucket export | one disagreeing record; FAIL |
| announced_undeclared | 1 | a `/model` command, then a switch to an undeclared model | one switch, user_command, announced; every later reply not declared; FAIL |
| anchor_edited | 1 | one reply's model changed in the host log after it was anchored | one disagreeing record; FAIL |

## Seeds

101, 202 and 303, month 2026-09. Development used seeds 5, 6, 7, 8 and 9 only (unit tests and one smoke run). Seeds 101, 202
and 303 had not been generated when this file was frozen.

## Metrics and bars

Primary:
- **P1. Planted switches flagged with their planted cause** (and announced flag): bar **27 of 27** (9 per seed).
- **P2. False flags on clean runs** (any switch, reply counted as not declared, disagreeing record or bucket shortfall): bar
  **0** over 30 clean runs.

Secondary:
- S1. Planted record disagreements flagged (disagreeing records and bucket shortfalls): bar 12 of 12 (4 per seed).
- S2. Flags on planted runs beyond the planted ones: bar 0.
- S3. Runs whose full expectation is met (switches, the three counts and the outcome): reported, 66 expected.
- S4. Replies by evidence tier: reported, no bar.

## Reporting rules

- The first run on these three seeds is the result and is reported as it comes out.
- Anything changed after seeing it is a separate, labelled run, and the first result stays in the report.
- Every number from this test is labelled synthetic wherever it appears.

## What this test does not show

- Nothing about real transcripts or real provider exports. The exports follow the public field lists; real files may carry
  fields or shapes the public schemas do not show, which the parsers would refuse until acknowledged.
- Nothing about accuracy in the field. The generator and the monitor have the same author, so this is a conformance test:
  it checks that the monitor flags what it was designed to flag, with the right cause, and nothing else.
- Nothing about a provider that misreports in both its reply and its billing. No tier below hardware attestation can see that.
