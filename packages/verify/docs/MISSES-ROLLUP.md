# Misses ledger: the rollup

Counts of the rows of the misses ledger ([`MISSES.md`](MISSES.md)) by status and by kind. It is a summary of that file's
own rows, not a measurement: it says how many rows of each kind are open or fixed, not how severe any one row is, and a
row that names a wrong answer counts once however many cases it covers. Generated, never typed, from the ledger the page
lists (`docs/bench/_misses-ledger.json`, sha256 `dc81072aedc68daa028e7a83aa73c899cf68c2426a111b9cdf1a59d10d292e86`).

| kind | open | fixed | all |
|---|---|---|---|
| engine: a wrong answer or a defect in what the engine or a tool of this tree does | 92 | 134 | 226 |
| documentation: a page that is wrong, missing or unclear | 172 | 133 | 305 |
| message: a printed sentence or remedy that is wrong or misleading | 57 | 78 | 135 |
| method, data and study rows: every other kind (a missing measurement, a data or label error, a study outcome, a scope note, a study harness defect) | 226 | 45 | 271 |
| **every row** | **547** | **390** | **937** |

Of these, 647 rows come from the rounds of cold review (tables `cold-review-r1` onward): 333 open, 314 fixed.

**How a kind is grouped** (the ledger's `kind` field as written; the first rule that fits wins):

- engine: `engine`, `kill` (a behaviour shown false), and every kind that names a wrong answer: a wrong pass, a false fail
  or false pass, an abstain, a near miss, a regression, a compiler miss, a field miss;
- documentation: `docs-defect`;
- message: `message-defect`, `misleading-remedy`;
- method, data and study rows: every other kind.

A row is open when it records no fix and fixed when it does (the "fixed by" column of `MISSES.md`).

Regenerate it from the repository root with `node scripts/misses-rollup.mjs`; `node scripts/misses-rollup.mjs --check`
exits 1 when this page no longer matches the ledger.
