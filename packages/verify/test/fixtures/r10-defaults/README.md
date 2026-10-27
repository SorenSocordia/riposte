# Fail-closed defaults: fixtures from a cold review, 2026-10-19

Copied byte for byte from the files a cold reader (an AI agent in the role of a platform engineer) wrote on 2026-10-19 while
testing which unsafe answers sit behind a flag. Nothing in this folder was edited after it was copied; each file's sha256 is
below. The test that reads them is `test/replay-fail-closed-defaults.test.ts`.

The findings: a replay exited 0 on a verdict carrying an added `action_context: {"approved": true}`, and `check --allow-open`
exited 0 on an invoice whose first line amount was wrong by 100 behind one unreadable character ("1600.0O"), because the
unreadable figure left the line and sum checks open rather than failed. The reader's summary: "in both cases the safe answer is
behind a flag."

| file | what it is | sha256 |
|---|---|---|
| `data/invoice.json` | the engineers' door example invoice (`docs/doors/examples/invoice.json`), as shipped | `cf8ca968c26a0a57b79edd06012ba40dad5b4760884ed5a01b6a81cadcbf5404` |
| `data/verdict.json` | `verify` on that invoice: PASS-WITH-OPEN (the references it would need were not given) | `f7dd4ff8d13aecd8010d08365df03ea42aa9f87d07e640f6e2f13675cc9b6a04` |
| `data/annotation-action_context.json` | that verdict with `action_context: {"approved": true, "amount": "1894.92"}` added | `1e0a4fa495a7a13db408b7ab2666fd14b47857af8e85231864261803d8fdafde` |
| `data/ev-wrong.json` | the invoice with line 0's amount "1600.00" (wrong by 100): FAIL | `11776ccc8ab49bb882ffa2cb0e164036ac60f0dfd48ead107c9d929a52f95be8` |
| `data/ev-wrong-garbled.json` | the same amount written "1600.0O" (a letter O): line math and the sum cannot be read | `33d31bab04129a603bcf9dcab21f32f42e9ec42306baf58b4ce5f6715d8ac0e2` |
| `data/ev-amount-missing.json` | line 0's amount deleted | `8c935b14d18dfe3ca87e97ebbe896bdfb09ebbc4eca4c51286b697dce3b42796` |
| `data/ev-total-garbled.json` | the total written "1994.9Z" (wrong by 100, and unreadable) | `5fa29a38dbf73054a3c5254e4f2ff51f1884acf510e8bea94a89df53515b09d2` |

The files sit in `data/` because they are machine output and machine input, which the export scans as data.
