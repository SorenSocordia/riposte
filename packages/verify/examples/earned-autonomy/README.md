# Earned autonomy, end to end, on real data

An AI agent extracts values from 10-K filings. Each value is checked against the filing's own iXBRL, every verdict goes on a
hash-chained book, and the agent's right to act without a person is earned from reviewed evidence, one rung at a time. Only a
person moves the rung, in either direction. This example runs the whole loop in one deterministic script. You can run it
yourself and get the same book, byte for byte.

```bash
npx tsx examples/earned-autonomy/demo.ts            # the full narrative, with the opinion, the report and the reconciliation
npx tsx examples/earned-autonomy/demo.ts --brief    # the narrative without the long documents
npx tsx examples/earned-autonomy/demo.ts --keep     # keep the book, the postings file and the rendered documents
npx vitest run test/e2e-earned-autonomy.test.ts     # the same run, asserted (pins the final book's sha256)
```

It makes no model calls and uses no network and no randomness. It runs in about 15 seconds, writes only to a temp
directory, and deletes that directory at the end unless you pass `--keep`. The demo keys exist only in memory.

## What it walks through

| step | what happens | the numbers (this run) |
|---|---|---|
| (a) keys | A root key registers a **controller** (role `grant_signer`) and a **reviewer** (role `reviewer`). The extraction agent's key is registered to no one. | 3 keys, 2 registrations |
| (b) record | 20 real filings. Each extracted value becomes one claim and one verdict against the filing's iXBRL, recorded at rung `record`. | 327 verdicts: 264 PASS · 27 FAIL · 36 ABSTAIN |
| (c) reviews | The reviewer signs a review of every PASS and every FAIL (Ed25519, procedure `re-performed`). | 291 reviews: 0 misses, 1 false flag |
| (d) assessment | The voice assessment, with one-sided Wilson and Clopper-Pearson bounds, and the promotion opinion in courtroom form. | autonomy: 0/264, CP 90% upper 0.87% ≤ 5% |
| (e) grants | The controller answers each proposal with a signed GRANT: record → advise → gate → autonomy. | the book reads `autonomy` |
| (f) surveillance | Six more filings under autonomy. After the month closes, the book commits a verifiable draw (the seed comes from the chain head at the close), and the reviewer works the queue. One drawn PASS is overturned (**synthetic**, see below). | drew 8 of 76 PASS, 11 of 11 FAIL; urgent failure-basis demotion proposal |
| (g) decision | The controller accepts the proposal with a signed GRANT back to gate. | the book reads `gate` |
| (h) report | The tenant report, read from the book. | |
| (i) completeness | November's postings are reconciled against the book: did every accepted value go through the check? | 76 matched · 1 paid despite hold · 1 bypassed |
| attacks | A self-grant by the agent; the same grant spliced into a copy of the book; a forged outcome replayed; a torn last line. | all four fail (below) |
| (j) the book | The book is verified end to end (links, payload hashes, every signature, grant, review and draw), and every verdict is re-performed. | 754 events; 436/436 re-performed |

The attacks:
- **Self-grant (door).** The agent signs itself a GRANT to autonomy, and the book refuses it: its key is not registered.
  Nothing is appended.
- **Self-grant (splice).** The same grant is appended to a copy of the book that was opened with no anchors. The reader with
  the root key then refuses the whole copy (it fails closed), so no rung is read from it.
- **Forged outcome.** A FAIL is rewritten as a self-consistent PASS. Replayed against the real filing, it fails, and the
  replay names `outcome`. Replayed without the filing, it reports `STRUCTURE_ONLY`: a hash or a signature is not a
  re-performance.
- **Torn tail.** Half a line is appended, as a crash mid-write would leave it. The book opens read-only, every event
  before the torn line verifies, and appends are refused until the tail is repaired.

## What is real, and what is synthetic

**Real** (the CREDENCE-2 benchmark, 2026-09-28):
- 96 fresh 2025-Q2 10-K filings, pre-registered. The demo uses the 26 filings of the benchmark's audit sample plus the
  next one in the same sha256 order.
- The agents' extracted values (claude-sonnet-5 and claude-haiku-4-5-20251001).
- The twin verdicts (`twin-xbrl-fs-core@0.2.0`).
- The gold labels.

`data/fixture.json.gz` holds the parsed filings. `build-fixture.ts` builds it from the benchmark and proves the reduction
changes nothing:
- every one of the 436 items gives the same verdict from the stored twin as from the full filing, byte for byte;
- every item's outcome equals the benchmark's own twin outcome.

The source files' sha256 prefixes are printed in step (b). One whole filing is kept as text, so `verifyReplay` re-performs
from the filing's real bytes.

**The reviewer is a stand-in.** The reviewer's decisions are the benchmark's gold labels. An independent *model* reader
read each printed statement blind, and its readings were then adjudicated. That is not a human review. The engine cannot
tell who holds a key, so the opinion and the report say "human review" for any review the registered reviewer's key signed.

**Synthetic, and labelled wherever it appears:**
- the clock (Oct–Dec 2026);
- the demo keys (derived from published labels; never use them);
- the tenant;
- the posting population;
- the two planted population rows: a held FAIL posted anyway, and a real extracted value posted without ever being checked;
- the one post-grant miss. The benchmark has no gold-wrong value that twin v0.2 passed (0 of 340 audited auto-accepts), so
  the demo overturns the first PASS the draw selected. It stands for a filer error that is printed and tagged alike, which
  no twin can see. Its gold label says it is correct.

**The policy is a declaration, not a finding.** The bars come from the research consequence-tier table:
- T1 (routine): 5% at 90% one-sided, n ≥ 45;
- T3 (high): 1% at 95%, n ≥ 299.

The deployment declares this workflow `routine`. Under `high`, the same evidence earns only `advise`: 27 reviewed FAILs are
fewer than the 59 the gate bar needs, and 264 PASSes are fewer than 299. The demo prints both.

## Versions it pins

| | |
|---|---|
| engine | `0.0.1` |
| verdict schema | `v0` |
| twin | `twin-xbrl-fs-core@0.2.0` |
| opinion | `opinion-v0` |
| policy | `demo-10k-face-values@1.0.0` |

The twin is the **statement-anchored** map v0.2, the one the benchmark pre-registered and passed. The library's default
map is v0.1, and v0.2.1 is not used: its held-out pre-registration failed. The test pins the fixture's sha256 and the
final book's sha256, `10d15faa…`. If an intended change moves either, read the narrative again before you re-pin. (It was
`d227a3bb…` until typed remedies were added on 2026-10-02: the book records verdicts, and a non-PASS verdict now carries its
remedies. A test switches remedies off and gets `d227a3bb…` back, byte for byte.)

## What it does not show

- **A human reviewer.** See above.
- **Canaries** (sealed known-bad items that measure reviewer attention). The research tier T3 calls for them; this demo has
  none.
- **Random selection before the grant.** The pre-grant review is a census, so there is nothing to select. After the grant,
  selection is on the book and can be re-derived.
- **Dual signatures on autonomy grants.** The policy asks for one signer.
- **An externally anchored head.** The head is printed; notarizing it is up to the deployment.
- **Something the report does today.** The same day the controller steps the workflow down, the report proposes promoting
  it back. The step-down restarts the post-grant window, and the pooled bound (1 miss in 272) still clears the bar. The
  demo prints this instead of hiding it.

## Rebuilding the fixture

```bash
npx tsx examples/earned-autonomy/build-fixture.ts --bench <path to the CREDENCE-2 benchmark directory>
```

The build checks every file against the benchmark's manifest hashes. It refuses to write the fixture if any item's verdict
differs between the stored twin and the full filing.
