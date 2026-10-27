# Receipt ledger fixtures, from a cold review, 2026-10-12

Copied byte for byte from the files a cold reader (an AI agent, in a security-minded engineer's role) wrote while trying to
break this tree on 2026-10-12. Nothing here was edited after it was copied. The reader wrote a signed five-entry ledger with
the receipts file store, then made the variants below from it; each `.head.json` is the head record the store wrote for the
five-entry ledger, copied beside each variant. `test/ledger-tails-and-broken-chain.test.ts` reads them.

| file | what it is | sha256 |
|---|---|---|
| `receipts.jsonl` | the genuine ledger: five entries, each signed by the key in `k.pub.pem` | `d25281136150ef2ff29fc696b60e58e8d22107e8c472cb0d39bf7d0fa6d1c60e` |
| `edit.jsonl` | entry 2's body edited (`amount` 102 → 999), every hash left as written | `56c835b36f2da009042135b9356e9202039af81ec455e71fc41e3b9d65d08eac` |
| `torn.jsonl` | four whole entries, then the first 40 characters of entry 4, then a newline | `30e00c2066616cc974992bbdb9ab6c92c0109561ecb85e9b7e4c6c6d020fffc8` |
| `nonl.jsonl` | `receipts.jsonl` with its final newline removed: five whole entries, no newline after the last | `6c879beee3b627341416504dd5247ce38b03527a3e034402109294556cf15338` |
| `*.jsonl.head.json` | the five-entry ledger's head record | `a40608bbbf459b4a681c89ca29341ffa3ee9b510a18a76ad757ae11b3f9d7022` |
| `k.pub.pem` | the public half of the reader's test key | `55e79f055df8962bca6df83575f929a635cdb0a77052516616cb1d7f53816a35` |

The test key signs nothing but these files.
