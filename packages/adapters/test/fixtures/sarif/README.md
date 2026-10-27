# SARIF and scorer fixtures

All names, numbers and texts are invented.

| file | layout | expected |
|---|---|---|
| `clean-invoice.json` | inputs (`extraction` + `references`) | PASS: every check runs and holds |
| `invoice-over-contract.json` | inputs | FAIL: billed at 165 an hour against a contracted 150 (`RATE_SUP`) |
| `payapp-retainage.json` | inputs, `"ruleset": "pay-app"` with the prior application as history | FAIL: the summary under-withholds retainage |
| `invoice-missing-totals.json` | the extraction itself | can't tell (INSUFFICIENT_DATA): no subtotal, tax or total, and no references, so no check can run |

The first three are the playground's first three canned examples, rewritten as files. The playground's other two use the
three-way-match and citation engines, which `riposte-sarif` does not run. `sarif-schema-2.1.0.json` is the OASIS SARIF 2.1.0
schema (errata 01), byte for byte as published at
https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json.
