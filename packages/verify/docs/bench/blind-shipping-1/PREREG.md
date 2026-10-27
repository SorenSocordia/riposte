# Preregistration: one blind run of the versions that ship (blind-shipping-1)

Written 2026-10-06, before any document in this run exists in the maintainers' hands and before any engine call on one. The
file is hashed in `PREREG.sha256` beside it. It is not yet stamped: the run may not start until a timestamp authority has
signed this file's sha256 (`PREREG.md.tsr` beside it) and the harness block of section 9 has been hashed and stamped too.
Anything changed after the stamp is an amendment (section 11): written, hashed and stamped before any data is touched, or
it does not count. The first run is the headline. Anything run after it is a separate, labelled run and never replaces it.

## 1. Why this run exists

Every accuracy number in this tree measures something other than what ships. The legal blind set measured legal@0.2.0 on
10 known-bad and 10 genuine quotations. The e-invoice blind run measured ruleset 0.1.0 and failed its primary bar. The
purchase-log study measured engine 0.0.1. The AP stress seeds stopped being a holdout when the AP pack was changed with
their results in view. The shipped defaults have post-hoc numbers or none. No result here was stamped before its run, and
every audit was done by the maintainers or by AI agents they ran. This run measures the versions that ship, on documents the maintainers
have not seen, with labels from a person independent of the harness, stamped before the data is touched.

## 2. What is tested (fixed now)

The build under test is the one this tree builds from the sources pinned here. Each digest is computed the way
`packages/verify/src/bench/stress.ts` computes the AP pack's (`apPackDigest`): sha256 over the text formed by one line
`<sha256 of the file>  <path>\n` per file, sorted by path, with paths relative to the folder named and written with `/`.

| what | version | pin |
|---|---|---|
| engine (`riposte-verify`) | 0.7.1 | every file under `packages/verify/src/`, recursively: `a01d117b8ea963fe78f67602e337fc5266b0a14c8015f2a8ee4c047a86b31c90` (216 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.2.0 | `bf1606f3d9b26852d27cbccc82bf7a3d68478948ea105a989c5bf9ffcbaa4bba` (16 files); `bench check` prints its first eight characters |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7` |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d` |
| legal rule, the default under this engine | legal@0.5.3 | `packages/verify/src/legal/*.ts` at its top level: `f483d5f02a5eae63bef8292d69c5d5ebf34dbdfb7db1df3b1a7fd641ffd0cf38` (6 files) |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `172175e7ac5e710df417b801dd8535c881fcde0103d16846fc84036c08fbe1af` (64 files) |

The e-invoice default is 0.3.0, not 0.2.0: under engine 0.7.1 a bare `peppol-en16931` reads 0.3.0
(`packages/verify/src/rulesets/declarative.ts`), and 0.3.0 has no table of its own. Both are scored on the same documents;
0.3.0's numbers are the headline for the e-invoice arm.

Before the first engine call the runner recomputes every pin on the tree it runs and records the output. If any pin differs,
the run does not start (section 10).

## 3. Who does what

- **The maintainers** wrote the engine, the rules and this file. They stamp this file, write the harness block (section 9),
  obtain the data after the stamp, and run the commands. An AI agent may type the commands for them; it is one of the
  maintainers' tools, and the published result says so.
- **The labeller** is a person, not an AI agent. The labeller has not written or run any part of the engine, the rules or the
  harness, and is not paid by the outcome. For the AP arm the natural labeller is the partner's AP lead or an outside
  accountant; for the legal arm, a paralegal or attorney who does not work for the maintainers; for the e-invoice arm, anyone
  who can run the official validators of section 4.2. One person may label more than one arm. Each labeller is named in the
  result, or, if they decline, described by role, and the result says they declined.
- If the only available labeller for an arm is one of the maintainers, the arm still runs, and its result opens with
  "labelled by an author, not independently". That arm then cannot support the word "independent".
- **Order, which no one may change.** The labeller makes every label and every planted case before seeing any engine output
  on that arm's data. The labels and the planted set are hashed, and the hashes recorded on the run's ledger, before the
  first engine call on that arm. The maintainers do not see the labels, the planted cases or the planted set's selection
  before that hash is recorded.

## 4. The data, which the maintainers have not seen

Nothing below is in the maintainers' hands when this file is hashed. Each source is obtained after the stamp. The selection
rules are fixed now, so the maintainers choose no document. Any document whose sha256 equals a file anywhere in this tree is
dropped before the run and the count of dropped files is reported.

### 4.1 AP: a partner's closed month

- **Source.** One closed month of a partner's accounts payable, supplied under a written data agreement: every vendor bill
  with its purchase order, receipts and payment history as the partner's ERP exports them, and the partner's own disposition
  of each bill (paid, held, rejected, and why). The partner is named in the result unless it declines; then the result says
  so. The maintainers may read the export's header row, and no data row, to write the column mapping; the mapping is part of
  the harness block (section 9) and is hashed and stamped before any bill is run.
- **Size.** The most recent closed month. If the shadow run yields fewer than 150 bills the gate would pay automatically or
  fewer than 30 it would hold, the month before it is added, then the one before that, up to three months in all; the
  months are added before any label exists. If three months are not enough, the bars that cannot be cleared read
  INSUFFICIENT.
- **Seeded bills.** The labeller makes seeded bad bills from copies of real bills drawn by the seed of section 6, one
  operator each: 40 inside the claim, in equal numbers per operator inside it (rounded up), and five for each operator
  outside it. The operators:
  1. a resubmitted duplicate: the same vendor, total and lines, the invoice number changed only by punctuation, spacing or a
     leading zero;
  2. one unit price above the purchase order's by more than the frozen price tolerance;
  3. one line's quantity above the quantity received;
  4. a stated total that is not the sum of the lines plus the tax and freight the order allows;
  5. freight billed on an order that does not allow it;
  6. a bill against another vendor's purchase order;
  7. a remittance change: the bill asks for payment to a new bank account, from a sender address that is a look-alike of the
     vendor's name;
  8. a second bill for a line already billed in full, so the two bills together exceed the quantity received.
  Operators 1 to 7 are inside the claim if the shipped pages at the stamp name them as checked on the input path the run uses
  (the payment-details check reads emailed text only, so on structured input operator 7 is outside it); operator 8 is inside
  it only if the input carries the quantity invoiced to date. The harness block records, from the shipped pages, which
  operators are inside the claim. Seeded bills outside the claim are reported, case by case, and count toward no bar.
- **Pay applications** in the partner's month are checked and reported in their own section, case by case. They count
  toward no bar.

### 4.2 E-invoices: public test instances not used in this tree

- **Sources.** Two public repositories, at the latest release tag on the day of the stamp, recorded with its commit hash by
  the labeller before any file is read:
  - `itplr-kosit/xrechnung-testsuite` (GitHub; test instances of the XRechnung standard; Apache-2.0);
  - `ConnectingEurope/eInvoicing-EN16931` (GitHub; the EN 16931 validation artefacts and their test files).
  Neither repository's instance documents are used anywhere in this tree; the e-invoice PDF run drew its bases from the
  OpenPeppol BIS 3.0 repository and three PEF templates, and documents from those sources are excluded here.
- **Selection.** Every file whose root element is a UBL 2.1 `Invoice` or `CreditNote`
  (`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2` or `…:CreditNote-2`), in path order, excluding files whose
  sha256 equals a file in this tree. No file is chosen by hand.
- **Labels.** The labeller runs the official validators on each file: the CEN/TC 434 EN 16931 UBL schematron from the second
  repository and the OpenPeppol BIS Billing 3.0 schematron (repository `OpenPeppol/peppol-bis-invoice-3`), each at its
  latest release tag on the day of the stamp, recorded with its commit hash. For each file and each rule the ruleset cites,
  the label is "fires" or "does not fire". A file is **valid** for a ruleset when no rule it cites fires, and **invalid**
  when at least one does.
- **Planted.** The labeller alters copies of 40 valid files drawn by the seed of section 6, one change each, five of each,
  each aimed at a rule peppol-en16931@0.3.0 cites: the sum of line net amounts changed (BR-CO-10); the total without VAT
  changed (BR-CO-13); the VAT total changed (BR-CO-14); the total with VAT changed (BR-CO-15); the payable amount changed by
  two swapped adjacent digits (BR-CO-16); one line's net amount changed against its quantity and price
  (PEPPOL-EN16931-R120); the invoice currency removed (BR-05); the issue date removed (BR-03). The labeller then runs the validators on each
  planted file and keeps it only if the intended rule fires; a planted file whose change the validators do not see is
  replaced by the next draw.
- **The extraction.** Each file's extraction is built from its XML by a fixed mapping (section 9), field by field from the
  UBL element that `node packages/verify/dist/cli.js extract-schema peppol-en16931@0.3.0` names for each field. This arm
  measures the ruleset on a correct reading of the document, not an extractor.

### 4.3 Legal: filed briefs and the opinions they quote

- **Source.** The merits briefs (the brief for the petitioner and the brief for the respondent) in the cases argued in
  October Term 2024, taken in the order of the argument calendars published at supremecourt.gov, from the first session on,
  as PDFs from the public docket there. The opinions they quote are taken from the Caselaw Access Project's static files (static.case.law), each fetched by its official citation, with
  its URL, time and sha256 recorded.
- **Eligible quotations.** In each brief's Argument section: a quotation of 10 or more words in double quotation marks,
  attributed by the next citation to a U.S. Reports opinion (`<volume> U.S. <page>`) whose majority opinion the Caselaw
  Access Project serves. At most 25 per brief, the first 25 in page order. A quotation whose cited opinion the Project does
  not serve is not eligible; the count is reported.
- **Size.** Briefs are added in calendar order until 200 genuine quotations (section 5) are labelled.
- **The citations file.** The labeller types each eligible quotation into the citations JSON the engine reads (`id`, `cite`,
  `case_name`, `quote`, `source_key`), exactly as printed in the brief, brackets, ellipses and parentheticals included, by
  the written protocol in the harness block. Typing errors are the labeller's to find; a quotation found mistyped before the
  run is corrected and the correction is listed.
- **Planted.** The labeller alters copies of 40 genuine quotations drawn by the seed of section 6, one change each, five of
  each: a word changed; a word dropped; a word inserted; a bracket that changes the meaning; an ellipsis over a negation or
  a limitation; a quotation cut where the opinion's sentence goes on to reverse or limit it; words from a dissent or the
  syllabus attributed to the majority; the right words attributed to another case's citation.

## 5. What is counted

Each engine answer is PASS, FAIL or can't tell (PASS-WITH-OPEN, INSUFFICIENT_DATA, a person decides, or an exit 3 refusal,
which is listed).

- **AP.** On the natural month, through the shipped pilot tool (`riposte-pilot`): the gate's decision per bill (pay
  automatically, hold, a person decides). **hold_precision** is, of an audit sample of the bills the gate would hold, the
  share the labeller confirms are real problems. **miss_rate** is, of an audit sample of the bills the gate would pay
  automatically, the share the labeller finds bad. **person share** is, of all bills, the share sent to a person. On the
  seeded bills: **seeded approvals** is the number of in-claim seeded bills the gate would pay automatically.
- **E-invoices.** For each ruleset: on valid files, **false FAIL** (a FAIL) and **can't tell**; on invalid files (natural and
  planted), **miss** (a PASS). A FAIL on an invalid file that names a rule the validators did not fire is counted and listed
  as a wrong reason.
- **Legal.** A quotation is **genuine** when the labeller finds the quoted words in the majority opinion as quoted, under the
  conventions the brief states (brackets, ellipses, "(cleaned up)", "(citation omitted)", "(emphasis added)" and the like),
  and **not faithful** otherwise; a natural quotation that is not faithful is reported case by case and joins the planted
  set's denominator. On genuine quotations: **false FAIL** and **can't tell**. On planted and not-faithful quotations:
  **miss** (a PASS). A PASS that prints the sentence's continuation, or any other note, is still a PASS.

## 6. Seeds and samples

Every draw the labeller makes (the AP bills to seed, the e-invoice files to plant, the legal quotations to plant) sorts the
eligible items by the sha256 of `<seed>:<item id>` and takes them in that order, where the seed is the sha256 of
`<this file's sha256>:<the stamp's serial number>:<arm>`. The seed is derived from the first stamp's bytes; anyone could
request several stamps of the same bytes and pick one, so the order rule, stamp before any data exists, is what makes the
seed unchoosable in practice. An item that cannot take its operator is skipped for the next. The AP audit samples are drawn by `riposte-pilot`
itself after the shadow run, from the seed it records on the ledger. The audit sizes are 60 bills the gate would hold (all of them if fewer) and 150 bills it would pay automatically (all if fewer).

## 7. The bars

Every interval is Clopper-Pearson, 95%, two-sided. A bar on a rate that should be low passes when the upper bound is at or
below it, fails when the lower bound is above it, and is INCONCLUSIVE otherwise. A bar on a rate that should be high passes
when the lower bound is at or above it, fails when the upper bound is below it, and is INCONCLUSIVE otherwise. A bar whose
sample is smaller than the size given reads INSUFFICIENT.

| # | arm | measure | bar | size | what clears it |
|---|---|---|---|---|---|
| P1 | AP | miss_rate | upper bound at or below 0.05 | 150 audited | 2 or fewer bad bills among 150 |
| P2 | AP | seeded approvals (in claim) | upper bound at or below 0.10 | 40 in-claim seeded bills | 0 approved |
| P3 | e-invoice | miss on invalid files, 0.3.0 | upper bound at or below 0.10 | at least 40 invalid files | 0 PASS among 40 |
| P4 | legal | miss on planted and not-faithful quotations | upper bound at or below 0.10 | at least 40 | 0 PASS among 40 |
| S1 | AP | hold_precision | lower bound at or above 0.80 | 60 audited | 55 or more confirmed among 60 |
| S2 | AP | person share | upper bound at or below 0.50 | every bill in the run, at least 200 | 85 or fewer among 200 |
| S3 | e-invoice | false FAIL on valid files, 0.3.0 | upper bound at or below 0.10 | at least 40 valid files | 0 FAIL among 40 |
| S4 | e-invoice | can't tell on valid files, 0.3.0 | upper bound at or below 0.50 | at least 40 valid files | 13 or fewer among 40 |
| S5 | legal | false FAIL on genuine quotations | upper bound at or below 0.05 | 200 | 3 or fewer among 200 |
| S6 | legal | can't tell on genuine quotations | upper bound at or below 0.50 | 200 | 85 or fewer among 200 |

P1 to P4 are primary: the run passes only if all four pass. S1 to S6 are secondary and are reported with their verdicts.
peppol-en16931@0.2.0's numbers on the same files are reported beside 0.3.0's, under the same bars, as descriptive rows.
Nothing else is a bar. Every other count is descriptive.

## 8. What is published, pass or fail

Within 14 days of the run's last engine call, in this folder and on the bench page, whatever the outcome:
- this file, its stamp, the harness block and its stamp, and the run's ledger;
- one bench table emitted from this folder by `bench emit`, with every bar above and its verdict, and every miss in the
  misses ledger;
- per case: the engine's answer, the label, and for the e-invoice and legal arms the input files (the e-invoice instances
  under their own licences; the briefs by URL and sha256; the opinion texts from the Caselaw Access Project, which are public
  domain; the citations file and the planted cases);
- for the AP arm, the partner's documents stay with the partner. Their sha256s are published, the per-case answers and labels
  are published with identifying fields replaced by stable tokens, and a third party may audit the originals under the data
  agreement. If the partner refuses even that, the AP arm's result says so and its numbers are labelled "not reproducible
  by a third party".
- An arm that did not run, and why.
The front page's numbers for the versions under test cite this table, and say plainly if a primary bar failed.

## 9. The harness block (written after this file, before any data is touched)

Before any data is touched the maintainers write, and hash into `PREREG.sha256` as a second block, then stamp:
- the AP column mapping (from the export's header row only) and the frozen pilot pre-registration (`riposte-pilot prereg
  init` then `freeze`) with these parameters: price tolerance 0.02; freight `person`; tax as the partner states its own rule
  in writing before the run, else `person`; hold_precision primary with the bar and size of S1; miss_rate co-primary with
  the bar and size of P1;
- the record of which seeded AP operators are inside the claim, quoting the shipped pages;
- the e-invoice mapping script (UBL to the extraction, section 4.2) and the command that runs each ruleset on each file;
- the legal transcription protocol for the labeller and the command that runs the citations check;
- one scoring script that reads the engine outputs and the labels and prints every count in section 5 and every verdict in
  section 7, and nothing else.
Each script implements exactly the rules above. If one is found not to after the run, the first run's numbers stay as the
headline, and a corrected run is a separate, post-hoc table.

## 10. Stop rules

- **Before any data is touched.** If any pin in section 2 differs from the tree that ships, nothing runs. The maintainers
  either write an amendment with the new pins, hashed and stamped before data is touched, or abandon this file and say so.
- **Data that does not arrive.** An arm whose data is not in hand 90 days after the stamp does not run, and the result says
  so. The other arms run.
- **During the run.** Each arm runs once. No engine, rule or harness change is made between the stamp and the arm's last
  engine call. A document the engine refuses (exit 3) counts as can't tell and is listed. A crash of the harness stops the
  arm; the arm may restart once from the beginning with the same files, and the restart is reported.
- **Labels.** A case the labeller cannot decide is left unlabelled, listed, and kept out of every denominator. There is no
  interim look at any count before every label of that arm is hashed.

## 11. Amendments

An amendment is a dated section appended to this file, with its reason, hashed into `PREREG.sha256` and stamped before any
data is touched. After data is touched, nothing in this file changes; a change of mind is reported beside the result as what
it is.

## Amendment 1 (2026-10-14, before any data; the pins of the shipped tree)

**Reason.** The refill of 2026-10-13 computed the engine and pilot-tool pins over the maintainer's working copy of the sources, not over
the tree as it ships. The table names `packages/verify/src/` and `packages/receipts/src/`, which are the shipped tree's paths: the export
rewrites a few source lines (the package names) and holds back five files of the pilot tool that await a licence decision, so the
shipped digests differ. A cold reader recomputing the pins on the shipped tree found the engine pin and the pilot-tool pin wrong and
the AP pack, legal and ruleset pins right. The table is corrected here, computed the way section 2 defines, over the exported tree
that the signed release will tag. Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.1 | every file under `packages/verify/src/`, recursively: `abdefc8740dcb1edf53a9647c8166d7772f06288f27f0f0075a4e6c672c51881` (216 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.2.0 | `bf1606f3d9b26852d27cbccc82bf7a3d68478948ea105a989c5bf9ffcbaa4bba` (16 files), unchanged |
| e-invoice rulesets | peppol-en16931@0.3.0 and @0.2.0 | unchanged (`20e0d12f…`, `c0e1ae6c…`) |
| legal rule, the default under this engine | legal@0.5.3 | `f483d5f02a5eae63bef8292d69c5d5ebf34dbdfb7db1df3b1a7fd641ffd0cf38` (6 files), unchanged |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `6790e0bd6069d2fb1a340237243063cea6695213687d67f51570d3d23a0fb29b` (59 files) |

The runner's pin check (section 3) reads this table where the two rows differ from section 2's. Hashed into `PREREG.sha256` and to be
stamped by the maintainer before any data is touched; the earlier stamp (2026-10-14T01:55:28Z, over sha256 9dafea26…) stays beside it as
the record of the first filing.

## Amendment 2 (2026-10-19, before any data; the pins of the tree that ships after the repairs of 2026-10-19)

**Reason.** Two cold-review rounds of 2026-10-19 read this file against the tree and found that four of its six pins no longer match
it, so its own stop rule (section 10) forbids the run. Nothing in this file has run. Since Amendment 1 the shipped tree moved: the
engine label is 0.7.2, under which the AP ruleset default is ap-threeway@0.3.0 and the legal rule default is legal@0.5.4; the pilot
tool's sources changed at the same version (replay re-derives the decision fields from the re-performed verdict; ledger lines are read
strictly); the e-invoice rulesets did not change. legal@0.5.5 (2026-10-19) exists, selectable, not the default under 0.7.2; this file
measures the defaults and does not measure it. The table is recomputed here the way section 2 defines, over the exported tree of the
release check of 2026-10-19, by the same code `bench check --pins-root` uses; `bench check` now prints a STALE PINS line for any planned
run whose pins moved, so this cannot pass unnoticed again. If any pinned source moves again before data is touched, a further amendment
re-pins it, hashed and stamped before data as this one is. Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `11a314e3aef83dfbafb22e6ddecb6771e52a9bea1ccbc49ad1e58e480aa9e17f` (217 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `70cba0d1d3913cfe324c49da2c206cd38bed35aabc705bb1c005e93523ef114d` (16 files) |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `cdf25c79dff0395e1c661be04b2cebaf986037b26c18e1f562c406684599ba2c` (6 files) |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `3efd2e1384fd8e9f1a92f32a6f2b747bc097f038a6aa0c274f898a548fcb33aa` (59 files) |

The runner's pin check (section 3) reads this table. Hashed into `PREREG.sha256` and to be stamped by the maintainer before any data is
touched; the stamps of the first filing (2026-10-14T01:55:28Z, over sha256 9dafea26…) and of Amendment 1 (2026-10-14T10:30:34Z, over
sha256 95a60959…) stay beside it as `PREREG.md.filing-1.*` and `PREREG.md.filing-2.*`.

## Amendment 3 (2026-10-20, before any data; the pins of the tree after the same night's repairs)

**Reason.** Amendment 2 was stamped at 03:13Z on the tree as it stood after the day's four repairs. The same night's hardening work
moved two of its six pins and no default: the AP pack gained ap-threeway@0.4.0 as a selectable ruleset (six cold readers' bills that
approved under 0.3.0 go to a person under it; 0.3.0 stays the default under engine 0.7.2 and its verdicts re-perform byte for byte), and
the engine's replay reader now fails closed by default (a key a bundle or envelope does not define is refused; an annotation member
outside its declared shape is refused; `--allow-open` accepts only checks that wait on a reference or a missing field) and `verify ap
--ruleset` is passed on where it was read and dropped. None of this changes what a bill or a quotation is held to under the defaults
this file measures. The legal rule's sources and the e-invoice rulesets did not move. The pilot tool's exported sources did not move
either: its hosted route changed in the lab, but that file is held back from the shipped tree pending a licence decision, so the digest
over `packages/receipts/src/` is the same 59 files. Nothing in this file has run; no data has been touched. The table is recomputed the
way section 2 defines, over the export of this tree made at 00:59 local on 2026-10-20, by the same code `bench check --pins-root` uses.
Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `244903b89f5a1064f0720fac2c2f05f89c4d610ffda1f537df4ecebdb3af5c47` (217 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033` (16 files; the default is 0.3.0, and 0.4.0 is selectable inside the same files) |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `cdf25c79dff0395e1c661be04b2cebaf986037b26c18e1f562c406684599ba2c` (6 files), unchanged |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `3efd2e1384fd8e9f1a92f32a6f2b747bc097f038a6aa0c274f898a548fcb33aa` (59 files), unchanged |

The runner's pin check (section 3) reads this table. Hashed into `PREREG.sha256` and to be stamped by the maintainer before any data is
touched; the stamps of the first filing, of Amendment 1 and of Amendment 2 (2026-10-20T03:13:11Z, over sha256 b809da85…) stay beside it
as `PREREG.md.filing-1.*`, `PREREG.md.filing-2.*` and `PREREG.md.filing-3.*`.

## Amendment 4 (2026-10-20, before any data; the pins of the tree after the citation reader's rewrite)

**Reason.** Amendment 3 was stamped at 05:56Z. Later that morning an audit of the packs' patterns found that the legal citation reader
(the regular expressions that read reporter citations and database numbers off a caller's citation text) backtracked exponentially: a
volume and 28 capitals took 7.6 seconds, doubling with each capital, so one such citation could hold the service. The two patterns were
replaced by readers that make one pass and return what the patterns returned, match for match and group for group, proven on 179,375
strings drawn from the tree and 1,960,972 generated ones; every legal brief in the tree re-issued under each legal rule gives
byte-identical verdicts (2,266 of 2,266). No rule version changes and no verdict moves; the engine's and the legal rule's source digests
move because the source text did. The AP pack, the e-invoice rulesets and the pilot tool's exported sources did not move. Nothing in
this file has run; no data has been touched. The table is recomputed the way section 2 defines, over the export of this tree made at
06:50 local on 2026-10-20 (2,402 files), by the same code `bench check --pins-root` uses. Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `5abf0e1875c46edf362d08e9e326dbfb20c539f530bc3100daf1a36ee88e00d0` (217 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033` (16 files), unchanged |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `ea0dd6b396c8d0170ce1cda80250c567a48a1eb93367bba1239e8228f2e927a8` (6 files; the citation reader rewritten, every verdict byte-identical) |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `3efd2e1384fd8e9f1a92f32a6f2b747bc097f038a6aa0c274f898a548fcb33aa` (59 files), unchanged |

The runner's pin check (section 3) reads this table. Hashed into `PREREG.sha256` and to be stamped by the maintainer before any data is
touched; the stamps of the first filing and of Amendments 1 to 3 (Amendment 3: 2026-10-20T05:56:03Z, over sha256 d9a4f31c…) stay beside
it as `PREREG.md.filing-1.*` to `PREREG.md.filing-4.*`.

## Amendment 5 (2026-10-20, before any data; the pins after the citation length bound and the remaining one-pass readers)

**Reason.** Amendment 4 (written that morning, not yet stamped) pinned the tree after the first two citation patterns were rewritten.
The same morning the other seven readers of a citation's text (a closing parenthetical, a pin after a comma, a pin after "at", the
volume-reporter-page reading, the split of a case name into its parties, the trim before a reporter citation, the short-form pattern)
were made one-pass the same way, and a citation length bound of 1,024 characters was placed at the three doors (HTTP, MCP, the command
line), refusing before any pattern or hash runs; the longest genuine citation in this tree is 122 characters. No rule version changes
and no verdict moves: every legal brief in the tree through every door under all eleven legal rules gives byte-identical answers
(6,666 of 6,666); the engine's and the legal rule's source digests move because the source text did (one new file, `legal/cite-bound.ts`,
so the legal folder holds seven files and the engine 218). The AP pack, the e-invoice rulesets and the pilot tool's exported sources did
not move. Nothing in this file has run; no data has been touched. The table is recomputed the way section 2 defines, over the export of
this tree made at 10:36 local on 2026-10-20, by the same code `bench check --pins-root` uses. Amendment 4's text stays above as the
record of the tree between the two rewrites; it was never stamped, so no filing is set aside for it. Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `66a645e738a7a40483b59e2094cee5f6d40a09d08849adc763f2fb973d149ad8` (218 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033` (16 files), unchanged |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `6742628f508310dfbd6910ce1274e3f10170e285789edd4bce2dd49e8a674a26` (7 files; the citation readers one-pass and the length bound, every verdict byte-identical) |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `3efd2e1384fd8e9f1a92f32a6f2b747bc097f038a6aa0c274f898a548fcb33aa` (59 files), unchanged |

The runner's pin check (section 3) reads this table. Hashed into `PREREG.sha256` and to be stamped by the maintainer before any data is
touched; the stamps of the first filing and of Amendments 1 to 3 stay beside it as `PREREG.md.filing-1.*` to `PREREG.md.filing-4.*`.

## Amendment 6 (2026-10-20, before any data; the pins after the citations index and the ledger's null-line answer)

**Reason.** Amendment 5 was stamped at 15:52Z. The same afternoon two more repairs moved pinned sources, neither a rule change and
neither a verdict: the citations check now reads a brief once per request instead of once per citation (four thousand citations went
from twenty seconds to a tenth of one; 9,020 answers through every door under all eleven legal rules and 374,280 generated verdicts are
byte-identical), and the pilot tool's ledger reader answers a line that is not a ledger entry (JSON `null`, an array, a number) with
"BROKEN: chain" and the entry named, where it threw an exception with no verdict line; an `--entry` given as a hash prefix no longer
throws past such a line. The AP pack and the e-invoice rulesets did not move. Nothing in this file has run; no data has been touched.
The table is recomputed the way section 2 defines, over the export of this tree made at 16:10 local on 2026-10-20, by the same code
`bench check --pins-root` uses. Nothing else in this file changes.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `44f0e4586ed7db778808e16dc60ad16d01f6d028d901b3da3e85f25b72344364` (218 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033` (16 files), unchanged |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `67a32c8f9bbf2a61229ecfb89c991b72f41670bb216ebfd8abe932fbead45d67` (7 files; the citations indexed once per brief, every verdict byte-identical) |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `c823d5361155a31d1e9a81572de4e12c2a1edda1237fcadb7335efa36b58ce88` (59 files; a line that is not a ledger entry is named, never thrown on) |

The runner's pin check (section 3) reads this table. Hashed into `PREREG.sha256` and to be stamped by the maintainer before any data is
touched; the stamps of the first filing and of Amendments 1 to 3 and 5 (Amendment 5: 2026-10-20T15:52:31Z, over sha256 6be29c5f…) stay
beside it as `PREREG.md.filing-1.*` to `PREREG.md.filing-5.*`.


## Amendment 7 (2026-10-27, before any data; the harness block, who labels the e-invoice and legal arms, and the engine pin)

**Reason.** Section 9 asks for a harness block, hashed into `PREREG.sha256` as a second block and stamped, before any data is
touched. It is written now, under `harness/` in this folder, for the e-invoice and legal arms; the AP arm's part waits for a
partner (point 3). Writing it showed that sections 4 and 6 leave some choices to the scripts; each is fixed in point 4, before
any data exists, so that no script chooses. Section 3 names a labeller who is a person. The maintainers have none for the
e-invoice and legal arms, and both arms' labels can be made by a mechanical rule or a written protocol; point 2 says who
labels them and what their results must say. Since Amendment 6 the engine's sources moved in its bench tooling only: `bench
index`, `bench check` and the misses ledger learned to hold a table back from a tree. Five files account for the move: one new
(`src/bench/held.ts`) and four edited (`src/bench/cli-bench.ts`, `docs.ts`, `ledger.ts`, `tree.ts`); with the four restored to
their earlier bytes and the new one removed, the digest is Amendment 6's pin again. No rule version, default or verdict moves,
and the other five pins do not move. Nothing in this file has run; no data has been touched.

**1. The pins.** Recomputed the way section 2 defines, over the export of this tree made at 12:28 local on 2026-10-26 (1,892
files), by the same code `bench check --pins-root` uses.

| what | version | pin (over the shipped tree) |
|---|---|---|
| engine (`riposte-verify`) | 0.7.2 | every file under `packages/verify/src/`, recursively: `c3e9b09db1da8ce94c3355897b55a19c00cea6fc3b7708c4217b40a95f620a7c` (219 files) |
| AP pack (`packages/verify/src/ap/`, `*.ts` at its top level) | ruleset ap-threeway@0.3.0 | `3b93e3e2ff5b375dcf9b04f36f86af747554999962e03960953e96cc11251033` (16 files), unchanged |
| e-invoice ruleset, the default under this engine | peppol-en16931@0.3.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.3.json`, sha256 `20e0d12fe16f8910780bb7c9a768508b9fea2d0e74936f43074abed0d9b1ebe7`, unchanged |
| e-invoice ruleset, scored beside it | peppol-en16931@0.2.0 | `packages/verify/docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d`, unchanged |
| legal rule, the default under this engine | legal@0.5.4 | `packages/verify/src/legal/*.ts` at its top level: `67a32c8f9bbf2a61229ecfb89c991b72f41670bb216ebfd8abe932fbead45d67` (7 files), unchanged |
| pilot tool (`riposte-pilot`, AP arm) | riposte-ai 0.0.1 | every file under `packages/receipts/src/`, recursively: `c823d5361155a31d1e9a81572de4e12c2a1edda1237fcadb7335efa36b58ce88` (59 files), unchanged |

**2. Who labels, and what the results say.**

- *The e-invoice arm (4.2).* Its labels are the official validators' output; section 3 already lets "anyone who can run the
  official validators of section 4.2" label it. An AI agent of the maintainers runs them (`harness/einvoice-validate.mjs`) and
  makes the planted set (`harness/einvoice-plant.mjs`). The result names that agent with the model id its own first reply
  attested. The arm's labels are called "validator-labelled", never "independent", and its result opens with: "labelled by
  the official validators, run by an AI agent of the maintainers; not independently".
- *The legal arm (4.3).* An AI agent of the maintainers may transcribe and label under `harness/LEGAL-TRANSCRIPTION-PROTOCOL.md`
  in place of the person section 3 names. Its result then opens with: "labelled by an AI agent of the maintainers, not
  independently", and cannot support the word "independent". If a person who meets section 3 labels instead, section 3's
  words apply unchanged.
- *Both.* An agent that labels an arm has seen no engine output on that arm's data. The order of section 3 is unchanged, and
  the scripts enforce it: the labels and the planted set are hashed onto the run's ledger (`results/ledger.jsonl`, each line
  carrying the sha256 of the line before it) before the first engine call on that arm, and the run commands refuse to start
  otherwise.
- *The runner.* The person or agent who types an arm's run commands (`einvoice-run.mjs`, `legal-run.mjs`, `score.mjs`) needs
  no cold standing: this file bars seeing the data before the stamp, not seeing the tree. Three rules bind the runner: (1) the
  runner does not label, and is not the labeller of that arm (the labeller fetches the sources, labels and plants: section 4.2
  has the labeller record the tags); (2) the runner does not see the labels, the planted cases or the planted set's selection
  before their hashes are on the ledger; (3) the runner makes no engine, rule or harness change between the stamp and the
  arm's last engine call (section 10).

**3. The AP arm waits.** It needs a partner's closed month (4.1), and no partner has agreed. Its column mapping, its frozen
pilot pre-registration (with section 9's parameters), the record of which seeded operators are inside the claim, and the
script that writes its scoring input are written, hashed and stamped in a further amendment before any bill is run
(`harness/AP-ARM.md`). Section 10 holds: an arm whose data is not in hand 90 days after the stamp does not run. "The stamp"
there, and in section 4.2's "the day of the stamp", is the first stamp of this file (2026-10-14T01:55:28Z), the one no later
filing can move: the AP arm's data must be in hand by 2027-01-12T01:55:28Z. Until the AP arm runs, P1, P2, S1 and S2 read DID
NOT RUN, and the run cannot pass (section 7).

**4. Readings fixed now.**

1. *The seed (section 6).* "The first stamp's bytes" are `PREREG.md.filing-1.tsr`: its message imprint
   (`9dafea26589e0823c8a328efd0e2e18b21940392112c5a074d14dbf368525d48`, the sha256 of the file it stamped) and its serial
   number as `bench check` prints it (`77eb242c704d7a87c92ab6d39733b2ef`). The arms are named `ap`, `einvoice` and `legal`, so
   the seeds are: ap `28bc5225aa5f59de57890b1a268e490e51534adb26392312b92e514125dace73`, einvoice
   `f16e44d84a3c2e8a6cc15951bd8eafa5953bb7f3f9595ef0f1c2f599cf83c0da`, legal
   `c66c35828505c6db07f0196056d8773cd8a5a2f616146bddbfb2f59887214c4d`. An e-invoice file's item id is `<repository>/<path>`; a
   quotation's is `<docket>-<P or R><n>-Q<nn>` (protocol, step 4).
2. *The sources' tags (4.2).* "The latest release tag on the day of the stamp" is, for each repository, its latest GitHub
   release that is neither a draft nor a pre-release, published at or before 2026-10-14T23:59:59Z; a repository with no GitHub
   release is read by its latest tag dated at or before then. The tag, its commit and the time are recorded, and hashed onto
   the ledger, before any file of the repository is read. Files are read from the commit's own blobs, as committed.
3. *"A file anywhere in this tree" (section 4).* Every file under the maintainers' working tree, of which the shipped tree is a
   part, indexed by size before anything is fetched; a fetched file is hashed against the tree's files of the same size. Not
   indexed: version-control metadata (`.git`), installed packages (`node_modules`), this run's own `results/` and `tmp/`, and
   folders the tree marks as private (one holding a `README-SEAL.md` notice, or named `*-private` or `*-sealed`), which are
   counted and not opened. A selected file byte-identical to an earlier selected file, in path order, is dropped and listed as
   a duplicate; section 4.2 said nothing about duplicates.
4. *The validators (4.2).* Each runs from the compiled XSLT its repository ships at the recorded commit when it ships exactly
   one; otherwise its schematron is compiled with SchXslt, whose version is recorded. The processor is SaxonC-HE 12 for Python
   (`saxonche`), its version recorded. A rule fires on a file when either validator's SVRL holds a failed assertion or a
   successful report with that rule's id, at any flag; the flag is recorded. A file a validator cannot process is left
   unlabelled and listed (section 10).
5. *The rules a ruleset cites (4.2, 5).* A check whose name begins with a rule id and a colon cites that rule. Both rulesets
   cite the same eleven: BR-02, BR-03, BR-05, BR-15, BR-CO-10, BR-CO-13, BR-CO-14, BR-CO-15, BR-CO-16, PEPPOL-EN16931-R051
   and PEPPOL-EN16931-R120. 0.3.0's document-wide R120 slack says it is not an EN 16931 or Peppol rule and cites none; a FAIL
   through it on an invalid file is counted among the wrong reasons, as naming no rule the validators fired.
6. *The planted files (4.2).* Drawn from the files valid under 0.3.0, the operators in section 4.2's order, five each, each
   file used once. "Changed" means: the written amount plus one currency unit, its number of decimals kept (BR-CO-10,
   BR-CO-13, BR-CO-14 on the tax total in the invoice currency, BR-CO-15, and PEPPOL-EN16931-R120 on the first line); for
   BR-CO-16, the rightmost pair of unequal adjacent digits on one side of the decimal point swapped, the fraction first, never
   making a leading zero; for BR-05 and BR-03, the element removed. Each change is made in place, and every other byte stays.
7. *The extraction (4.2, 9)* is `harness/einvoice-extract.mjs`, element by element in its header. It fixes two readings:
   BT-110 is the tax amount of the one `cac:TaxTotal` in the invoice currency, as BR-CO-15 reads it; the currency the totals
   are stated in is their one `@currencyID`, or, when they differ, the first that is not the invoice currency. It writes only
   the fields 0.3.0's contract names, so 0.2.0's marker for a fifth VAT breakdown row is never written; 0.2.0's numbers are
   descriptive (section 7).
8. *The engine's answers (5).* `verify check <extraction> --ruleset <the pinned file>` for each ruleset of section 2, and
   `verify citations <file> --sources <opinions> --json` under the legal rule this engine uses by default. Exit 0 is PASS, 1
   FAIL, 2 can't tell, 3 can't tell and listed as refused. A legal answer is its quotation's claim. A legal run whose verdict
   names another legal rule than the pinned one stops before any answer is used.
9. *The legal sources (4.3).* The argument calendars are the Court's monthly calendars for October Term 2024 at
   `https://www.supremecourt.gov/oral_arguments/argument_calendars/MonthlyArgumentCal<Month><Year>.pdf`, October 2024 to
   April 2025, then any special sitting's calendar for May or June 2025 the Court published there; the calendars index
   (`oral_arguments/calendarsandlists.aspx`) is recorded beside them. The dockets are taken in the order the calendars print
   them. A case's merits briefs are the entries of its docket page (`docket/docketfiles/html/public/<docket>.html`) that read
   "Brief of (the) petitioner(s), respondent(s), appellant(s) or appellee(s)" and are not in opposition, amicus, reply,
   supplemental, a letter or a motion, each taken as the PDF the page links as its main document: the petitioner's side first,
   each side in docket order. `legal-fetch.mjs --head-check` asks every such address with HEAD requests only before anything
   is fetched, and refuses if a required one does not answer. The same PDF
   filed on two dockets is read once. An opinion is the Caselaw Access Project's case file found by its official citation in
   the volume's metadata; it is served when exactly one case carries that citation and the file holds a majority opinion. The
   text the engine reads is a caption line, the head matter, and every opinion as served. A brief is added whole: the brief in
   which the 200th genuine quotation falls is finished.
10. *Scoring (5, 7)* is `harness/score.mjs`; its tests check that its intervals reproduce every row of section 7's "what clears
    it" column.

**5. The harness block.** These files, under `harness/` in this folder, are the harness block of section 9 for the e-invoice
and legal arms. Their sha256 are listed here and hashed into `PREREG.sha256` as its second block, and both files are stamped.
The runs use the shipped tree at the pins of point 1, built as the release check builds it.

```
0e61b71092359a1f2915e4001c60a06177c720e18ef22b4040b500cddc770107  harness/AP-ARM.md
30ef5d0740f2233a9e145fcf4ea63963b861ef10e0486ff5f109524d29370241  harness/LEGAL-TRANSCRIPTION-PROTOCOL.md
b3fe525d5b3b90e37048efb0412b4cda6dd3d71889ba21edf35fc5e2e6db8af9  harness/ap-mapping.TEMPLATE.json
6b2e8d1386db189282667e05478b99700efc6b0826ca02fc888da50275a250c1  harness/einvoice-extract.mjs
7343aa2322d9f8d4672e44e3c9001e66c9b481033632747d15f4e922315bf82e  harness/einvoice-fetch.mjs
5454af26b23fcf4b15b0a336471c57db4311bcb473759c4be74aa879b8f223a0  harness/einvoice-plant.mjs
5e82f026cdffe390bc0803fd2d5ccd32bcba2685684f3ae6672802df7d18f860  harness/einvoice-run.mjs
52da4a568efd1a9063a89f6f42982881a9edd9dca518239e40637e4aa9242d55  harness/einvoice-validate.mjs
74c81dad9de7e394756d4fbe6da97e0af075c730dc63b0f96ba63798b77ca3d4  harness/ledger.mjs
e05ddac17223111a51871245d5877a93f9c67b32448c034dc3b12833b0fd3171  harness/legal-fetch.mjs
5273fe5626e6f9d96ed36eb18ad6c0cdd8a452ee4adf862af6ad41b1344c656f  harness/legal-run.mjs
2d6e8f96a72c8bb07000abd5061ef4559e45508c9918aac1b4df4cd1347c37e0  harness/lib.mjs
8e3b94efe7c082e85f3d59b8edc0db1c05cc6362bb4580a9902bf240070e42da  harness/schematron-svrl.py
502d6cdac65264c9913915c4b605f5822d8e6e946fe7a306700f6d4cf4143e98  harness/score.mjs
6f2e719d08d1b4f9ac1ce46fe44f560e2bd2c27d79656458e11ebefe567d7afa  harness/test/harness.test.mjs
```

The runner's pin check (section 3) reads the table of point 1. The stamps of the first filing and of Amendments 1 to 3, 5 and
6 (Amendment 6: 2026-10-20T21:53:10Z, over sha256 5e3b686f…) stay beside it as `PREREG.md.filing-1.*` to
`PREREG.md.filing-6.*`.

