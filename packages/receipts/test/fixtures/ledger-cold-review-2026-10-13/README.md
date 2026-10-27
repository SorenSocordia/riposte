# Receipt ledger fixtures, from a cold review, 2026-10-13

Copied byte for byte from the reviewer's own working folder, `mytests/ledger/`, which a cold reader (an AI agent, in a
security-minded engineer's role) wrote while trying to break this tree on 2026-10-13. Nothing here was edited after it was
copied. The reader wrote a signed five-entry ledger with the receipts file store (`receipts.jsonl`, its head record beside it),
then ran `attack.mjs` and `attack2.mjs`, which wrote one `case-*` folder per attack: a variant of the ledger and, where the
attack kept one, a head record (the original, or one recomputed to match the variant). The scripts are kept as the record of
what was done; they import the reader's build by a relative path and do not run from here. The reader's private test key is
not copied: nothing here needs it. `test/ledger-repeated-key.test.ts` reads these files.

| file | what it is | sha256 |
|---|---|---|
| `receipts.jsonl` | the genuine ledger: five `ap_gate` entries, each signed by the key in `pub.pem`; entry 2 holds `"decision":"HOLD"` | `ab7bc22c838c8f39b2bee7e8cddc0ff25d6ae020fe61047fb6d2789491d2b7b6` |
| `receipts.jsonl.head.json` | its head record: 5 entries, 2632 bytes | `2055f7ac56a58cd5e4a579a91811021002b137459393d9713ece89971fcae9c0` |
| `pub.pem` | the public half of the reader's test key | `c6f9c3f834a5173db15f634ffe8d645388a83a127beef791ebe276b9cc609493` |
| `case-dupkey-conflict/receipts.jsonl` | entry 2 rewritten as `"decision":"EXECUTE","decision":"HOLD"`; every hash and signature as written (attack2.mjs) | `af43633d22dcf8cfad29561bd181ea0ce2e3ca54565ff6c414b0d2dbf4b6a4f2` |
| `case-dup_key_in_entry_line/receipts.jsonl` | entry 1 rewritten with `"seq":1,"seq":1` (attack.mjs) | `d0350c36474d0076ef748824b4895fe3e5dd810b8386d3558f546aec689c6d11` |
| `attack.mjs` | the reader's script: edits, reorders, deletions, tail cuts, rewrites with every hash recomputed (unsigned, and re-signed with a second key), a torn tail, a repeated key | `9c258e0fa77076cbdc57d5aacd73321b892f61849a74de7cef5293b4ad19f15f` |
| `attack2.mjs` | the reader's script for `case-dupkey-conflict` | `9a5689112fa1ad0157c63cb9d0b219f1de55791bc060a8ef9d479f497c38d9fd` |

The other sixteen `case-*` folders are the rest of `attack.mjs`'s cases, one per folder, named as the script names them.

The test key signs nothing but these files.
