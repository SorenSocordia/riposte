# Provenance archive: AP three-way match on a public benchmark, blind run 1 (2026-09-23)

Tier: **transcribed; provenance archived; prereg unhashed.** This file is the archive. Its sha256 is recorded in
`docs/bench/_provenance.json` and printed in `docs/BENCH.md`, and `verify bench check docs/bench` verifies it.

## Why this archive exists

The run's preregistration (`bench/ap/PREREG.md`) was written before the run, but its sha256 was not recorded anywhere
before the run. The bench tool therefore refuses to print the run as a bench table. A hash taken today would prove the
text from today on, never that it came before the run, so no hash of that prereg is taken now, here or anywhere. This
file collects the provenance that does exist, so a reader can weigh the run for what it is.

Every time below comes from the authors' own machine: file-system creation and modification times, and the authors' own
logs. None of it is third-party, and none of it can rule out a file that was edited or backdated. Times are UTC; the
machine's local time was UTC−4.

## The run's files

The checker's hash was recorded before the run: the prereg's FREEZE line names it, and every row of `results/run-1.jsonl`
carries it.

| file (in `bench/ap/`) | bytes | created | last written | sha256 |
|---|---|---|---|---|
| `PREREG.md` (the authors' original) | 2982 | 2026-09-23T12:47:22.056Z | 2026-09-23T12:49:17.155Z | not recorded, on purpose (see above) |
| `threeway-v1.frozen.ts` (the frozen checker) | 14991 | 2026-09-23T12:49:55.374Z | 2026-09-23T12:49:55.374Z | `d1ad333f5728761224acae9927f1a61e123b3a149ecb8bae5092836492584a51` |
| `results/run-1.jsonl` (blind run, headline) | 121866 | 2026-09-23T12:49:17.658Z | 2026-09-23T12:49:17.658Z | `fff841f4b3fe66496a4f00f59e190a5a66c4e5c81ec2e25917b07b112f25348a` |
| `threeway.ts` (tuned checker, disclosed run 2) | 15800 | 2026-09-23T12:50:02.705Z | 2026-09-23T12:50:02.706Z | `6c334ee6695855a59bfdf8dcf10256bfa66fd94c1fe24926e7a7c8240d28eee0` |
| `results/run-2.jsonl` (disclosed tuned run) | 123197 | 2026-09-23T12:50:04.932Z | 2026-09-23T12:50:04.932Z | `68a393e7f30d7701900b243a622679622c51fe41b42f758e941344ab4f4c3151` |
| `data/distil/invoice_cases.jsonl` (the benchmark) | 191130 | 2026-09-23T12:33:54.422Z | 2026-09-23T12:33:54.762Z | `c6ffc9b9c41b8a5adfb65de2c60b4c5e4c595f6b46944351b51217dda9df4b02` |

The public `bench/ap/PREREG.md` differs from the authors' original on one line only. Line 5 named the authors' local
folder for the data; the public copy names `data/distil/` there and marks the edit "[path updated for this repository]".
Every other byte is the original's.

Files that are not shipped, with their times:
- the benchmark's README, downloaded 2026-09-23T12:45:46Z;
- the development check, which runs the checker on the three allowed examples only: created 2026-09-23T12:48:56.278Z;
- the authors' results write-up: created 2026-09-23T12:50:31Z, last written 2026-09-23T13:14:26Z, sha256
  `d981ecf035322d8888d93621107f46f6159d2bbd379a31c7ee87e933d5afc191`;
- the seven published decider files, downloaded 2026-09-23T13:13:48Z to 13:13:52Z, after run 1 (the audit uses them).

## The order of events those times give

1. 12:33:54 the benchmark data arrives.
2. 12:45:46 the benchmark's README arrives.
3. 12:47:22 `PREREG.md` is created.
4. 12:48:56 the development check is created.
5. 12:49:17.155 `PREREG.md` is written for the last time. Its FREEZE line names the checker's sha256 `d1ad333f…`.
6. 12:49:17.658 `results/run-1.jsonl` is written, 0.503 seconds later. Every row carries the checker sha256 `d1ad333f…`.
7. 12:49:55 `threeway-v1.frozen.ts` is written: the checker as frozen, whose sha256 equals the one on every run-1 row.
8. 12:50:02 `threeway.ts` is rewritten with the two wording rules; 12:50:04 `results/run-2.jsonl` (the disclosed tuned run).
9. 13:13:48 to 13:13:52 the published decider files arrive, for the audit.

What these show: the prereg file was created about two minutes before run 1 and written for the last time half a second
before run 1's results. The prereg's header gives its own time as "~08:55" local, which is 12:55 UTC, about six minutes
after the file's last write; that header time is an estimate. The checker that produced run 1 is the frozen file, by
hash. What they do not show: any earlier text of the prereg (none is kept), or that nobody edited the prereg after
reading results. No third party saw the prereg before the run.

## Dated log lines that mention the run

None of these logs ship. Each is named by its file name and its sha256 as read on 2026-10-05, so the authors can
produce it. Quotes are exact excerpts; "…" marks omitted text.

- **A buyers-research note, written before the data arrived.** `receipts-buyers-2026-09-23-0820.md`, last written
  2026-09-23T12:30:36Z, sha256 `19cdf09eebcec26dce8cdb4d1c4391a01539d512f1944d29e33cc6701ea3e7aa`, line 29:
  > On pay/hold, which is the PO-number match, quantity ≤ received, price ≤ 2% over PO, and total adds up, **Jev scored 0.79** against 0.98 for a fine-tuned 4B model.

  It shows the benchmark had been identified before 12:33, when its data arrived.
- **The day's session log.** `session-state.json`, a living file (sha256 `2eceb89386b5db667af08a3591fb5b0e169db3b9c8d85e4edab8289398056e49`
  as read at 2026-10-05T13:49Z). Its entries for 2026-09-23 carry no clock times, only their order. Entry 32:
  > NEW HEADLINE CANDIDATE: Distil Labs AP pay/hold benchmark (Apache-2.0, 100 free-text invoice cases + ERP; Jev 0.79, fine-tuned 4B 0.98 decision / 0.97 grounded) = verify's native checks.

  Entry 33, the next one:
  > AP BENCH (Distil Labs public AP benchmark, Apache-2.0, 100 free-text invoices; prereg + frozen checker hash): RUN 1 BLIND = 82/100 decided, 0 WRONG, 82/82 exact incl. six-field grounding, 18 abstained (unseen wording: 'Amount payable', 'Freight: may be added by the vendor'). RUN 2 DISCLOSED test-set-tuned (2 general wording fixes) = 100/100 decision + 100/100 six-field, 0 wrong. …

  Entry 34:
  > AP AUDIT (the novelty): using Distil's PUBLISHED per-case outputs for 7 AI configs … — 111 wrong pay/hold decisions total, 57 of them wrong APPROVALS (bad invoice paid; Jev-single had 9 wrong at >=0.90 confidence). Gate 'auto-execute only if model == blind run-1 checker' caught 111/111, ZERO wrong auto-executions in every config, 63-82% auto-executed, 18-37% to human. …
- **The authors' results write-up** (sha256 above), audit table, the single-question row:
  > | Jev, single question | 77 | 23 | 11 (9 of the 23 wrong at ≥0.90 confidence) | 23/23 | 63 | 0 | 37 |

  The public benchmark note later printed this as "nine of Jev's at 0.99 confidence". That was a transcription error:
  the threshold was 0.90, and the nine are wrong decisions of any kind, not wrong approvals. `bench/ap/audit.ts` now
  prints the count under each definition.
- **A planning cross-reference.** `SEASON-HARNESS-XREF-2026-09-23.md`, last written 2026-09-23T14:50:39Z, sha256
  `3fdd6f7c618953f603d9c8f253ec577200f8573a0501bf4dbde86fb4c903ead2`, line 37:
  > **measured**: blind 82/100, 0 wrong; audit 111/111 caught
- **A plan.** `FOUR-WEEK-PLAN-2026-09-23.md`, last written 2026-09-23T14:57:22Z, sha256
  `80d3d0076e64e4e1d40e717f1ec81dd59d71a20eac312c1f7effbada39d6342a`, line 45:
  > - **H3 AP audit:** DONE — blind 82/100 decided, 0 wrong; 111/111 published AI errors caught, 0 wrong payments.

## The stress study's protocol, which never shipped

The stress study has its own preregistration, also never hashed. It was created and last written at
2026-09-23T15:12:03Z. The stress script was created at 15:13:57Z, and the holdout result files were written from
15:41:28Z to 15:41:32Z. Here it is in full, exactly, except one lab folder name, shown in brackets:

````text
# H4 STRESS TEST — PRE-REGISTRATION (frozen 2026-09-23 ~11:20, before any perturbed run)

**Question:** when the invoices get messier than the benchmark's templates, does the AP checker stay at ZERO WRONG and just
abstain more — or does it start making mistakes? This is the promise everything else rests on: *when unsure, abstain; never lie.*

**Checker under test:** the production pack `[the verify package's src/ap/]` (includes the two disclosed run-2 wording rules), called via
`verifyInvoiceMatch(splitApLayout(input))`. It is NOT modified during or after this test; any fix is a separate, labelled round.

**Base set:** the 100 Distil Labs cases (Apache-2.0). Each perturbation is applied to every case, deterministically (seeded), to the
INVOICE text only (the ERP purchase order and goods receipt stay structured — they come from a system, not a vendor). Gold labels
are unchanged, because every perturbation is meaning-preserving by construction:
- **P1 line order:** invoice lines shuffled (seeded).
- **P2 vendor wording:** item names rewritten by a fixed abbreviation/synonym table (e.g. "unit"→"u.", "inch"→"in", uppercase,
  dropped vowels on long words), applied only to item-name tokens, never to numbers.
- **P3 number formatting:** thousands separators removed or changed to spaces; currency code moved (USD before/after/"$").
- **P4 OCR noise:** in NON-numeric characters only: random letter swaps (l↔1 NOT allowed; letters only), doubled spaces, dropped
  punctuation, 3% of letters. Numbers are never touched (a changed number would change the gold answer).
- **P5 layout:** line items rendered as a table ("|" separated), or as "qty x item at price" prose, alternating by case.
- **P6 all of the above** combined.

**Metrics per perturbation (full set of 100):** wrong decisions (decided AND ≠ gold) · correct · abstained · six-field correct.

**Pre-registered expectations and kill criteria:**
- PASS (thesis holds): wrong decisions = 0 on every perturbation; abstention may rise.
- WARN: 1–2 wrong decisions on any perturbation → publish them, analyse, fix in a labelled round.
- KILL the "never wrong" headline: ≥3 wrong decisions on any single perturbation, or ≥5 across all → the claim becomes
  "rarely wrong, with published misses", and the product copy changes accordingly.
- Coverage is NOT a pass/fail criterion (abstaining is the designed failure), but it is published.
````

The header's "~11:20" local is 15:20 UTC, eight minutes after the file's last write; it is an estimate.

Where the generator that ran (`bench/ap/stress.ts`) differs from this text:
- P2 maps "unit" to "U" (uppercase, no full stop), not "u.", and applies a table entry about 80% of the time.
- P4 swaps two adjacent characters in about 12% of the tokens longer than three characters, rather than touching 3% of
  letters. It doubles about 5% of the spaces between words and drops trailing punctuation from about 5% of tokens. Tokens
  that contain a digit or a hyphen are never altered.
- P5 picks table or prose for each case at random from the case's seed, rather than alternating.

**The development seeds.** The authors' stress write-up (sha256 `6e041c5571f6673b50c2bb2f7f0358755a07053aac094a488179431f669115e9`,
written 2026-09-23T15:15:44Z, not shipped) records how the parser was hardened before the holdout:
1. Round 1 ran the default seed. It gave two wrong decisions, both false holds: OCR noise turned "Shipping" into
   "Shippign", and the unrecognised amount was ignored. Verdict per the stress prereg: WARN.
2. Fix 1 made any unclassified money amount abstain. Three fresh seeds, `fresh1`, `fresh2` and `fresh3`, then gave one
   wrong decision each, the same case: a space-grouped total, "$1 555.63", was read as 555.63.
3. Fix 2 read a space-grouped amount after a currency marker as one number and made an unanchored one abstain. All
   earlier seeds were replayed with 0 wrong.
4. The holdout seeds `holdout1` to `holdout5` ran last, and are the shipped stress results.

So the parser was hardened on four seeds (`default`, `fresh1`, `fresh2`, `fresh3`), each covering the same 100 cases
under the same six perturbation kinds. The holdout seeds are new random draws of the same generator over the same 100
cases, written by the parser's authors: they are correlated variants, not unseen data.

## Who built the checker (added 2026-10-05)

The files do not record it. The checker's own header, the prereg, the authors' results write-up and the dated log lines
above say what was built and when, but none of them says whether a person or an AI agent wrote `threeway-v1.frozen.ts`.
The bench tables' runs say who built and audited them on each table; this run's records do not. What the files do record
is the speed: the prereg was created at 12:47:22, the checker frozen by 12:49:17 (its sha256 is in the prereg's last
write), and run 1 written half a second later.
