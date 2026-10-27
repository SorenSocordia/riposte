# Review round 2: the rows, as transcribed

The defects of round 2, one row per distinct defect, written on 2026-10-05 from the summary of the round and checked against the four reports (sha256 in `REPORTS.sha256`). Each description begins with its reviewers.

| miss | kind | description |
|---|---|---|
| r2-01 | docs-defect | J1 (controller), J2 (platform engineer), J3 (legal operations): README.md:224-228 and PILOT.md:15 leave the publisher, price and support terms as unfilled placeholders ([ENTITY], [PRICE], [SUPPORT-TERMS]); the only liability term is the licence's "as is" |
| r2-02 | docs-defect | J1 (controller), J2 (platform engineer), J3 (legal operations): REPLAYERS.md:4 and the front page give the contact for kills, questions and security reports as a literal [ADDRESS] placeholder, so a break cannot be reported anywhere |
| r2-03 | engine | J1 (controller): `ap` on a bill with no payment history printed APPROVE, payable: true and exit 0 with the duplicate check not run, while the library gate returned REVIEW for the same bill; docs/GLOSSARY.md:13 says the AP gate never pays on PASS-WITH-OPEN |
| r2-04 | engine | J1 (controller): `ap --gate` was accepted silently and changed nothing, and `ap --help` did not list it |
| r2-05 | engine | J2 (platform engineer): README.md:13-15 and the CLI defaults: a PASS-WITH-OPEN verdict exited 0 unless --gate was given, so a CI user wiring exit codes got fail-open by default |
| r2-06 | engine | J2 (platform engineer): the tolerance identity spread roundingCap.perLine with [...x], so the string "TAX_INT" and its seven-character array hashed alike while the engine's .includes() read them differently: one verdict_id for a PASS and a FAIL, reachable through the library and HTTP /v1/verify |
| r2-07 | engine | J2 (platform engineer): the non-finite refusal covered CLI file reads and declarative rules only: built-in verify() gave one hash for null, Infinity, -Infinity and NaN, with PASS for null and FAIL for the rest, and the HTTP and MCP servers parsed bodies with plain JSON.parse |
| r2-08 | engine | J2 (platform engineer): duplicate JSON keys were accepted everywhere, including inside a signed envelope: an "outcome":"FAIL" inserted before the real "outcome":"PASS" verified under --trusted-key --strict |
| r2-09 | docs-defect | J2 (platform engineer): REPLAY.md:70-71 said three kinds of input are refused before any engine sees them, and the hash-input source comment said two inputs that differ never share a hash; the library, HTTP and MCP paths broke both (the tolerance, non-finite and duplicate-key rows of this table) |
| r2-10 | engine | J3 (legal operations): binding was satisfied by any opinion text that cites the case: a Cooper v. Aaron text passed for Brown and for Marbury under the default strict binding, against LEGAL.md:10-12 |
| r2-11 | engine | J3 (legal operations): a parties-only binding gave outcome PASS, gate status PASS and exit 0 even when the JSON marked the choice load_bearing: true (LEGAL.md:76-81) |
| r2-12 | engine | J3 (legal operations): a trailing ellipsis that drops a condition passed ("except where ..."; "provided the waiver is made voluntarily ..."), reported as an ellipsis at the edge of the quotation, not located |
| r2-13 | engine | J3 (legal operations): a leading ellipsis and a bracketed capital that drop a leading "Unless" clause both passed (two Strickland quotations) |
| r2-14 | engine | J3 (legal operations): a mid-quotation ellipsis over "after adequate time for discovery and upon motion" passed: the condition carried no word the guard looked for |
| r2-15 | docs-defect | J3 (legal operations): LEGAL.md:26 said an ellipsis over a condition abstains, and MISSES.md:19 marks the condition-dropping ellipsis row fixed by legal@0.2.0, while edge ellipses and a bracketed capital that drop a condition still passed |
| r2-16 | docs-defect | J2 (platform engineer), J3 (legal operations): README.md:77-78 described the negation guard backwards ("when a quotation stops right after a negation"): a quotation ending in "cannot" passed, and the guard fires when a quotation starts right after a negation |
| r2-17 | message-defect | J2 (platform engineer): an ALL-CAPS quotation passed as "appears verbatim": the match ignores letter case, but the message called it verbatim |
| r2-18 | method | J3 (legal operations), J4 (methods reviewer): the second legal blind set, the stated basis for moving the legal default, shipped no prereg, no per-case results, no bench table and no misses rows, and LEGAL.md:42-43 cited its prereg by eight hex characters |
| r2-19 | method | J4 (methods reviewer): COMPILER.md:139-147 published a 60-document XRechnung accuracy table with a truncated prereg hash, and it was not in BENCH.md, not refused and not withdrawn |
| r2-20 | docs-defect | J4 (methods reviewer): BENCH.md:27-28 said the bench rule covers every number the project publishes, while its own pages carried numbers outside it (the second legal blind set, XRechnung, three SEC studies, rule mining, the Peppol 4- and 7-case figures, "8 of 130") |
| r2-21 | engine | J4 (methods reviewer): six tests of the public suite failed: two read a file by a path in the authors' working tree and four expected the command name `verify` where the public binary prints `riposte-verify` (README.md:241 implies the suite passes) |
| r2-22 | message-defect | J4 (methods reviewer): the CLI's hint on an unknown option, "see: riposte-verify replay --help", could not be typed as printed in a source checkout |
| r2-23 | engine | J4 (methods reviewer): the test suite wrote scratch folders to the system temp folder, so a reviewer confined to one folder could not run the tests |
| r2-24 | engine | J1 (controller): a one-letter vendor typo ("Sumit" for "Summit") or a trade name, with the same invoice number but a different PO and total, got APPROVE and the gate's EXECUTE / PAY |
| r2-25 | message-defect | J1 (controller): AP-INPUT.md:84: when the invoice number was booked under another vendor, the plain-English answer said "all checks passed, including the duplicate check" and the other-vendor fact was in the JSON only |
| r2-26 | message-defect | J1 (controller): the duplicate explanation said a booked row had "another PO and another total" when the row carried neither |
| r2-27 | engine | J1 (controller): the "could be a different supplier" duplicate case was clearable by an AP clerk, while a confirmed duplicate needs the controller, and no setting for the level was documented |
| r2-28 | method | J1 (controller): the synthetic month planted only suffix and punctuation vendor variants, which the matcher handles, so its perfect score could not show the near-match gap |
| r2-29 | docs-defect | J3 (legal operations): one answer goes by several names: README.md:5-6 says can't tell, the CLI prints ABSTAIN, the verdict says INSUFFICIENT_DATA; README.md:15 says PASS-WITH-OPEN and the CLI prints PASS_WITH_OPEN |
| r2-30 | docs-defect | J1 (controller), J3 (legal operations): one command, three spellings in copyable examples: README.md:244-245 says node packages/verify/dist/cli.js, AP-INPUT.md:248 says verify ap, LEGAL.md:101 says verify citations, and other pages say riposte-verify |
| r2-31 | message-defect | J2 (platform engineer): the MCP tool description (src/mcp/server.ts:220) said peppol-en16931 is 0.2.0, the default, while the bare name issued 0.3.0 and the CLI help said 0.3.0 |
| r2-32 | docs-defect | J3 (legal operations), J4 (methods reviewer): the shipped legal example's sources.json:10 carried an internal test label, printed in the output of the front page's first legal command |
| r2-33 | docs-defect | J3 (legal operations): LEGAL.md:30 said "The owner moved the default" without naming the role or the rule |
| r2-34 | message-defect | J1 (controller): PILOT.md:37: the prereg template put its placeholders inside quotes, so a filled-in 0.85 kept in quotes was refused with "primary.bar is a number between 0 and 1" |
| r2-35 | message-defect | J1 (controller): the pilot report's remedy column was unreadable in the default hashes-only mode ("recompute-with line[4].amount -> AP_LINE_MATH; ...") |
| r2-36 | engine | J1 (controller): the audit sheet carried sample number, bill, invoice number and rule id, but no vendor, amount or reason, so a labeller had to open every bill |
| r2-37 | docs-defect | J1 (controller): PILOT.md:124-127 put a quotation from an unnamed reviewer of the pilot into the buyer's own prereg template |
| r2-38 | message-defect | J1 (controller): `riposte-pilot report` on a ledger with one edited entry said entries were removed or the file was cut short, where `riposte-ledger verify` named the altered entry |
| r2-39 | engine | J1 (controller): PILOT.md:16-22: by default the pilot wrote the run's private signing key next to the receipts, so the signatures proved nothing to an auditor until --key was set |
| r2-40 | docs-defect | J1 (controller): README.md:169-176: the AP results led with Wilson bounds and tiers, and the labour cost (13 of 32 good bills to a person) was not said first in words |
| r2-41 | engine | J1 (controller): pay applications were absent from the pilot, though pay applications are a headline document type |
| r2-42 | docs-defect | J1 (controller): README.md:47-48 and PILOT.md:87-92: no construction ERP export (Sage 300 CRE, Viewpoint Vista, Spectrum, Foundation) is read, and QuickBooks Desktop was not mentioned |
| r2-43 | engine | J2 (platform engineer): REPLAYERS.md:10-12 and REPLAY.md:109: --strict failed the genuine shipped legal bundles for carrying document.producer, while a copy with the producer deleted passed |
| r2-44 | engine | J2 (platform engineer): REPLAY.md:95 against :109: issued_at was not validated as a timestamp, so {"lol":1} passed --strict |
| r2-45 | docs-defect | J2 (platform engineer): REPLAY.md:118 said --trusted-key accepts an inline PEM, but a PEM starts with "-", so the value was read as an unknown option |
| r2-46 | message-defect | J2 (platform engineer): replay printed only 12 characters of the signing key's fingerprint on stderr, and a 12-character pin was refused |
| r2-47 | message-defect | J2 (platform engineer): a mistyped subcommand ("verify replya verdict.json") or a forgotten "replay" ran a fresh invoice check on the verdict file and exited 2, with no "unknown command" and no hint that the file is a verdict |
| r2-48 | message-defect | J2 (platform engineer): a mistyped --ruleset name gave a raw ENOENT instead of naming the known rulesets |
| r2-49 | message-defect | J2 (platform engineer): --source "some text" gave a raw ENOENT without saying the flag takes a file |
| r2-50 | engine | J2 (platform engineer): 9 of 10 prebuilt plugin bundles differed in sha256 from BUILD.json after a rebuild from the shipped source (a class-field emission difference), so the bins could not be reproduced from the public tree |
| r2-51 | method | J2 (platform engineer): no public CI runs the repository's own tests (.github/workflows holds examples only, while README:257 calls the Action "CI"), and there are no signed tags |
| r2-52 | engine | J2 (platform engineer): src/version.ts:8-66: seven engine versions in three days are behaviour gates inside one build, not pinned artifacts, and no build hash is recorded in each verdict |
| r2-53 | docs-defect | J4 (methods reviewer): README.md:147-148 said each bench table's per-case results ship beside it, but s4-bpi2019 ships a summary, not the per-case file it names |
| r2-54 | method | J4 (methods reviewer): s4-bpi2019's 250,234-item per-case file (results/run-blind.jsonl, sha256 4365d239...) does not ship, so its coverage and flag-rate rows are read from a summary, not per-case data |
| r2-55 | method | J4 (methods reviewer): harness files are hashed but absent for x1-einvoice-pdf, x2-legal-blind, s4-bpi2019, t1-extraction-contract and t3-closed-loop, so those tables can be re-tallied from their results but not rerun |
| r2-56 | docs-defect | J4 (methods reviewer): x2b-legal-fix/PREREG.sha256 names its files by paths in the authors' working tree |
| r2-57 | method | J4 (methods reviewer): s4-bpi2019's preregistered secondaries were computed and left unprinted (log agreement 0.617; P(held given FAIL) 0.945 against P(held given PASS) 0.386, relative risk 2.45; 161 of 200 audited flags with a visible reason) |
| r2-58 | method | J4 (methods reviewer): the PREREG.sha256 lists of x1-einvoice-pdf, r4-peppol-posthoc, t1-extraction-contract and t3-closed-loop held one hash line and no time |
| r2-59 | docs-defect | J4 (methods reviewer): CHANGELOG.md:9-10 said any earlier verdict replays byte for byte, while CHANGELOG.md:366-368 said 8 of 130 replays differ |
| r2-60 | docs-defect | J4 (methods reviewer): README.md:176 called the stress seeds holdout seeds without saying they were re-banked on 2026-10-05 under a pack changed for 12 days, and did not name the three ways the generator differs from its written protocol |
| r2-61 | docs-defect | J4 (methods reviewer): BENCHMARK-AP.md:1 said "zero wrong payments" for a tool that moves no money, and bench/ap/README.md:59 said "0 wrong in 3,000 perturbed invoices" when 245 were not decided |
| r2-62 | docs-defect | J4 (methods reviewer): the AP provenance archive says who audited the run but not whether a person or an AI agent built the checker |
| r2-63 | method | J4 (methods reviewer): the AP benchmark data, gold labels included, was on disk 13 minutes before the prereg file was created, and the prereg was last written 0.503 s before run 1's results, so "blind" rests on the authors' own records (disclosed in the provenance archive) |
| r2-64 | docs-defect | J2 (platform engineer): NOTICE omitted the EUPL-1.2 Schematron excerpts in packages/verify/test/fixtures/compile/*.sch (they were attributed in-file only) |
| r2-65 | docs-defect | J2 (platform engineer): NOTICE gave no provenance for the Peppol, ZATCA and KSeF sample XMLs in test/fixtures/einvoice/ |
| r2-66 | message-defect | J2 (platform engineer), J3 (legal operations): the shipped KB02 bundle's remedy quotes the opinion from mid-sentence ("appeals. But Cochran and Axon ..."), which looks like a sentence-boundary error |
