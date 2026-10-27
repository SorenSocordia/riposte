# Replay fixtures from a cold review, 2026-10-19

Copied byte for byte from the files written while a cold reader (an AI agent in the role of a subcontractor's controller) tried to
make a replay say something untrue on 2026-10-19, and from the maintainer's reproduction of the same finding that evening. Nothing
in this folder was edited after it was copied; each file's sha256 is below. The test that reads them is
`test/replay-ap-derived-fields.test.ts`.

The finding: the output of `verify ap` carries, beside its verdict, the decision a person acts on (`decision`, `payable`,
`grounding`, `reasons`, `not_checked`). A replay re-performed the verdict and compared it byte for byte, but it compared none of
those fields, so a hold rewritten to "approve, all checks passed" replayed "outcome VERIFIED", exit 0, under `--strict`.

| file | what it is | from | sha256 |
|---|---|---|---|
| `data/ap1.json` | `verify ap` on the shipped example bill (`docs/examples/ap-three-way.txt`; the test copy is `test/fixtures/data/ap-three-way.txt`, byte-identical): HOLD, hold_quantity | the maintainer's reproduction | `0d896bab5d099a08e85dbb1023b78b96ecec21d4ac30869ce55475023444dca3` |
| `data/ap1-forged.json` | `data/ap1.json` with `decision` set to `approve`, `payable` to `true`, `reasons` to `["all checks passed"]` and `not_checked` emptied; the verdict untouched | the maintainer's reproduction of the reader's file | `ba046f39f8bd2d20ca5ed200582e7d015b277765865bf42d2501506fd0359bfe` |
| `E-dup-exact.json` | a structured bill (`verify ap --input`) that is an exact duplicate of a booked invoice | the reader's file | `0f1f590a3767a47d370ad3f108fbbe9ec3c88860381965bbc92e2464641793c4` |
| `E-dup-exact.out.json` | `verify ap --input E-dup-exact.json`: HOLD, hold_duplicate, with its proof member | the reader's file | `0e41a5f5460e7f336aa58521fdc9c9a93db7001867c32fe4022406ffaaaa5816` |
| `E-forged.json` | `E-dup-exact.out.json` with `decision` set to `approve`, `payable` to `true` and `reasons` to `["all checks passed"]`; the verdict and the proof untouched | the reader's file | `475d1e0e52c21fadba341fed95a3a05a8037fcc97a8d38cd4e542ca8ced541d4` |
| `payapp-P4.json` | a G702/G703 pay application whose payment due is 1,000 over its own figures | the reader's file | `aea20a674c65de2dec52dca3ec4b46b081b661aa9ecb0c30b82859b03b15cda4` |
| `payapp-P4.verdict.json` | `verify payapp-P4.json --ruleset pay-app --history docs/examples/payapp-g702-g703.previous.json`: FAIL | the reader's file | `8a512626190b1f5d6edbec858fa2b21ddbaa61f78f62ed82051aa914ac4187dc` |
| `legal-bundle1.json` | a legal quotation bundle (`verify citations … --bundle <file>`): FAIL | a second cold reader's file (legal operations role) | `2220f6fc45af5ab76b25c927b89a1be0ae4c6bdcc2e51b9900bad8e894cab159` |
| `legal-bundle-tamper-headline.json` | `legal-bundle1.json` with its verdict's `outcome` and `gate_status` rewritten FAIL to PASS | the same reader's file | `45c2300f581e8fff570cfece0604771dd3c4a1e1329434c7717aec5267164ebe` |

The two results of the example bill sit in `data/` because their explanations quote the bill's line items word for word, and
the export scans machine output, as it scans the bill itself, as data.

The pay-application and legal files are guards: those commands write a bare verdict (or a bundle of a verdict and its inputs), so
every field a person reads is inside the verdict and is compared. They pin that no derived field sits outside the comparison.
