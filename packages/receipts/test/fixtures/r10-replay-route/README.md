# Replay-route fixtures from a cold review, 2026-10-19

Copied byte for byte. Nothing in this folder was edited after it was copied; each file's sha256 is below. The test that reads
them is `test/http-replay-status.test.ts`.

The finding: the hosted gate's `POST /v1/replay` answered 200 with no `x-verify-exit` header whatever the replay found, so a
client or a proxy that reads only the status took a forged decision for a success. The engine's own `POST /v1/replay` answers
409 when a case diverged and 422 when a case was refused, with the header on every replay answer; this route now does the same.

| file | what it is | from | sha256 |
|---|---|---|---|
| `data/ap1-forged.json` | `verify ap` on the example bill below, with `decision` set to `approve`, `payable` to `true`, `reasons` to `["all checks passed"]` and `not_checked` emptied; the verdict untouched. The test lays these four forged fields over a proof the gate issued for the same bill | the maintainer's reproduction, the evening of 2026-10-19, of a cold reader's file (an AI agent in the role of a subcontractor's controller); the same bytes as the engine's `test/fixtures/r10/data/ap1-forged.json` | `ba046f39f8bd2d20ca5ed200582e7d015b277765865bf42d2501506fd0359bfe` |
| `data/ap-three-way.txt` | the shipped example bill, purchase order and goods receipt in one text (`docs/examples/ap-three-way.txt` in the engine): billed 10 of an item, received 7 | the engine's byte-identical test copy, `test/fixtures/data/ap-three-way.txt` | `763b59f2e90e6aa5a8bfe8aacac4e32b0dc2cad46c0b37cc7dfe6488f46eb597` |

Both files sit in `data/` because they quote the bill's line items word for word, and the export scans machine data, as it
scans the bill itself, as data.
