# Review round 1: the rows, as transcribed

The documentation and message defects the four round-1 reports logged, one row per friction item, written on 2026-10-05 from the reports (sha256 in `REPORTS.sha256`). Each description begins with its reviewer.

| miss | kind | description |
|---|---|---|
| J1-01 | docs-defect | J1 (controller): README.md:5: the opening sentence is about AI agents and never says which documents it checks; read twice to learn it checks invoices |
| J1-02 | docs-defect | J1 (controller): README.md:97-98: the quick start promises a one-line hold message with the lines read; the command prints about 600 lines of JSON with the reason near the bottom |
| J1-03 | docs-defect | J1 (controller): README.md:46-62 and 126-134: the SEC section and the related-work section come before anything an AP buyer needs and mean nothing to one |
| J1-05 | docs-defect | J1 (controller): README.md:68 claims AIA pay-application coverage but docs/examples has no pay-app example, and a wrapped pay app abstains on all 9 checks with "no schedule-of-values array" although the array is one level down |
| J1-06 | message-defect | J1 (controller): pay-app findings read "Law of Retainage (carried) VIOLATED: 5200 ≠ 6200" and "Law of Continuity" instead of plain sentences about which line and which month disagree |
| J1-07 | message-defect | J1 (controller): CLI --help is 265 lines with the ap command at line 124 among internal feature names; ap --help prints the whole general help |
| J1-08 | docs-defect | J1 (controller): AP-INPUT.md:15 and 208 say `verify ap --input bill.json`; no `verify` command exists on the path after the build (the working form is node packages/verify/dist/cli.js ap --input) |
| J1-09 | docs-defect | J1 (controller): AP-INPUT.md:12 and 219-224 mention a hosted gate and POST /v1/ap/gate with no URL, signup or price; a reader cannot tell whether a hosted option exists |
| J1-10 | docs-defect | J1 (controller): AP-INPUT.md:79 says a duplicate is "same vendor" without saying vendors match by exact name; a same-number bill under "..., Inc." passed with "does not appear among 1 booked invoice(s)", which is false in plain terms |
| J1-11 | message-defect | J1 (controller): an ap run with no payment history approves (exit 0) with the duplicate check off, and says so only under not_checked at the end of the JSON |
| J1-12 | docs-defect | J1 (controller): packages/receipts/PILOT.md, the most useful file for a controller, is never mentioned on the front page; it is linked only from the receipts README |
| J1-13 | docs-defect | J1 (controller): PILOT.md:42-46 lists Ramp, Xero, QuickBooks Online and unverified CSV presets and says nothing about construction ERPs (Sage 300 CRE, Viewpoint Vista or Spectrum, Foundation) |
| J1-14 | docs-defect | J1 (controller): PILOT.md:78: the pre-registered number, hold precision, measures false holds and not bad bills the gate would have paid, and the page does not say so |
| J1-15 | docs-defect | J1 (controller): PILOT.md:91 writes the run's private signing key into the output folder with no guidance on who should hold the key so an auditor can rely on the signatures |
| J1-16 | message-defect | J1 (controller): shadow receipts say "action":"EXECUTE","effect":"PAY" at the top level while "executed": false sits nested under body.shadow; a reader skimming the log would misread it |
| J1-17 | message-defect | J1 (controller): replay headlines "PASS with 3 of 13 checks unable to run" on an invoice whose totals could not be read; the default word is PASS |
| J1-18 | message-defect | J1 (controller): the input_hash refusal is one sentence of about 600 characters |
| J1-19 | docs-defect | J1 (controller): the replay instructions give the contact as a literal [ADDRESS] placeholder |
| J1-20 | docs-defect | J1 (controller): README.md:24 reports "18 handed to a person" without saying that 13 of them were invoices that should have been paid, which is the delay cost on good bills |
| J2-01 | docs-defect | J2 (platform engineer): the replay instructions give the contact for kills and questions as a literal [ADDRESS] placeholder, with no disclosure policy |
| J2-03 | docs-defect | J2 (platform engineer): npm install reports one low-severity advisory (esbuild) and no page mentions it |
| J2-04 | docs-defect | J2 (platform engineer): the replay instructions say issued_at is the one exception to byte-for-byte replay; the replay also exempts channel, ledger, declared_accuracy, action_context and case, carries document.producer, and folder mode discloses none of this |
| J2-05 | message-defect | J2 (platform engineer): replay with no arguments exits 3 and prints the general usage, which starts "verify a document", instead of the replay usage |
| J2-06 | message-defect | J2 (platform engineer): an unknown replay option is named correctly but the line is buried under the full usage block |
| J2-07 | message-defect | J2 (platform engineer): replay on a parent folder refuses "not a replay bundle" with no pointer to single-file mode or the flags a bare verdict needs |
| J2-08 | message-defect | J2 (platform engineer): a bundle starting with a UTF-8 byte-order mark reports "not a replay bundle" in folder mode and "Unexpected token" in single-file mode, instead of naming the byte-order mark |
| J2-09 | message-defect | J2 (platform engineer): the replay exit-2 and exit-3 messages show the placeholder --source <text>; the flag takes a file |
| J2-10 | message-defect | J2 (platform engineer): an e-invoice verdict records outcome PASS while its VAT and net totals are unreadable; a consumer reading only outcome (a SIEM, a script) sees PASS; the gate reading lives only in the docs |
| J2-11 | message-defect | J2 (platform engineer): replay JSON reports `answer` while the verdict carries `outcome`; the first parse guessed wrong |
| J2-13 | docs-defect | J2 (platform engineer): .gitattributes says results must cmp-equal a fresh re-run; all six shipped holdout1 stress files differ from a fresh run ("all four checks passed" against "all five"), with decisions unchanged |
| J2-14 | docs-defect | J2 (platform engineer): README.md:97-98 promises the line "hold_quantity: ... billed 10, received 7"; the command prints a JSON blob on stdout and nothing on stderr |
| J2-15 | docs-defect | J2 (platform engineer): README.md:81 says the plugin adds a Stop hook; the plugin also registers a PreToolUse hook on every tool, off by default but still starting node on every call |
| J2-18 | docs-defect | J2 (platform engineer): the replay instructions imply a reader can check the source hash with sha256sum; input_hash is a sha256 over canonical JSON of the inputs, not of the file |
| J2-19 | docs-defect | J2 (platform engineer): the verdict id is truncated to 128 bits and the replay instructions do not say so |
| J2-20 | docs-defect | J2 (platform engineer): the docs lean on internal work-item codes and the 0.5.0 changelog opens with ocean-float and galaxy terms inside an accounts-payable verifier, so the product surface could not be mapped in an hour |
| J3-01 | docs-defect | J3 (legal operations): the replay instructions give the contact as a literal [ADDRESS] placeholder; there is no named entity, support terms or contact anywhere |
| J3-02 | docs-defect | J3 (legal operations): README.md:14-31: the headline section is all accounts payable, and legal appears once, as a list item at README.md:68 |
| J3-03 | docs-defect | J3 (legal operations): README.md:91: npm test has no note on whether it starts a server or how long it runs, so the judge skipped it |
| J3-04 | docs-defect | J3 (legal operations): README.md:109-114: "Re-run the benchmark" covers AP only; there is no command for the legal benchmark |
| J3-05 | docs-defect | J3 (legal operations): the replay instructions say RULESETS.md lists each rule set's declared accuracy including the misses; for legal it does not, and the legal rates are in BENCH.md |
| J3-08 | docs-defect | J3 (legal operations): BENCH.md:286 says a prereg was held after 1 recorded amendment without saying what the amendment changed, and the prereg is not in the tree |
| J3-09 | docs-defect | J3 (legal operations): BENCH.md:313 gives a results path that points outside the repository |
| J3-11 | docs-defect | J3 (legal operations): the CLI help has no citation verb and QUICKSTART.md:94 lists verify_citations as an MCP tool only; checking a brief meant reading src/legal/index.ts and writing a script |
| J3-12 | message-defect | J3 (legal operations): the KB02 remedy quotes the opinion starting mid-sentence on a stray word ("appeals. But Cochran ...") |
| J3-14 | message-defect | J3 (legal operations): the legal FAIL explanation says "X is a real authority, but the quotation is not accurate"; the engine knows only the opinion text it was given |
| J3-15 | docs-defect | J3 (legal operations): too many version numbers with no explanation: bundles at engine 0.0.1, fresh verdicts at 0.5.0, three legal and three Peppol rule versions, five engine releases in two days |
| J3-16 | docs-defect | J3 (legal operations): internal jargon in reader-facing text: CLI help, RULESETS.md:47 and QUICKSTART.md:99 use internal names for features where plain words were expected |
| J3-17 | docs-defect | J3 (legal operations): MISSES.md mixes e-invoice, legal, AP and model-attestation rows in one table with no per-ruleset filter or section |
| J3-18 | message-defect | J3 (legal operations): an e-invoice remedy calls "Document allowances EUR 20" unreadable; the real reason is that strict reading needs two decimals, and the message could say so |
| J4-01 | docs-defect | J4 (methods reviewer): README.md:24 headlines a "Blind, pre-registered run" that BENCH.md:337 lists among the runs the tool refused, for having no recorded prereg hash |
| J4-02 | method | J4 (methods reviewer): bench/ap/PREREG.md says "frozen ... before any run" but has no recorded hash anywhere, and line 5 carries an edit instead of an appended amendment |
| J4-03 | docs-defect | J4 (methods reviewer): BENCHMARK-MINE.md:33-34 cites the mining prereg by hash as "available on request" instead of shipping it in bench/ |
| J4-04 | docs-defect | J4 (methods reviewer): every BENCH.md table names a prereg and a results path that are not in the tree (0 of 13 preregs, 0 of 13 results files found) |
| J4-05 | docs-defect | J4 (methods reviewer): BENCH.md:69, 245 and 264 name paths of the private working layout that do not exist in the public tree |
| J4-06 | docs-defect | J4 (methods reviewer): BENCHMARK-AP.md:56 says "nine of Jev's at 0.99 confidence"; no script computes it and a recount gives 3 or 4 depending on the definition |
| J4-07 | docs-defect | J4 (methods reviewer): BENCHMARK-AP.md:56 and audit.ts:30 say the blind checker caught all 111 wrong decisions; 87 were caught by disagreement and 24 only because the checker abstained, and the split is not printed |
| J4-09 | docs-defect | J4 (methods reviewer): bench/ap/README.md:58 says the parser was hardened against other seeds first, without naming them, showing the diff, or shipping a stress prereg |
| J4-10 | docs-defect | J4 (methods reviewer): README.md:5-6 promises ABSTAIN when the engine cannot verify, but the shipped e-invoice bundle is a PASS with 3 of 13 checks unable to run; PASS-WITH-OPEN was explained only in VERDICT-SCHEMA-v0.md |
| J4-11 | message-defect | J4 (methods reviewer): the tamper refusal labels the hash of the tampered inputs as "expected"; it should read recorded X, computed Y |
| J4-12 | docs-defect | J4 (methods reviewer): bench/sec/PREREG-SEC-CHECK.md:4 uses unexplained internal shorthand for why lab iterations stay private, and gives no count of them |
| J4-14 | docs-defect | J4 (methods reviewer): README.md:71 says "the hand-labelled audits" while bench/sec/RESULTS-V02.md:20 says the audit was done by a separate agent; the annotator is not stated |
| J4-15 | docs-defect | J4 (methods reviewer): CHANGELOG.md:285 says the build carries engines 0.0.1 and 0.1.0 while src/version.ts carries six; the replay instructions send readers to the changelog for the list |
| J4-16 | docs-defect | J4 (methods reviewer): CHANGELOG.md and MISSES.md use internal governance shorthand and fixed-by codes where plain words were expected |
| J4-17 | docs-defect | J4 (methods reviewer): the engine moved five versions in two days and the non-AP bench tables do not say whether they still hold on the current engine |
| J4-18 | docs-defect | J4 (methods reviewer): BENCHMARK-MINE.md:42 says "t = 0.02 learned" without disclosing that the tolerance grid contained 0.02 and that the schema was hand-typed by people who knew the policy |
| J4-19 | docs-defect | J4 (methods reviewer): BENCH.md:61 labels the BPI 2019 table blind while its precision row says the audit is by the harness author; the label does not separate blind data from a blind audit |
| J4-20 | docs-defect | J4 (methods reviewer): six of the BENCH.md tables are science replays (galaxy rotation curves, ocean floats, gravity inversions) and the README gives no sentence of scope |

## Left out, with the reason

- J1-04 install from source only, no installer: a packaging gap, not a doc defect (now disclosed on the front page)
- J1-21 the judge's own process slip
- J2-02 gitignored build output shipped in the review pack: pack assembly
- J2-12 bench --run 1 overwrote the shipped results file: tool behaviour (bench work)
- J2-16 plugin hooks point at executables missing from the tree: export completeness
- J2-17 Peppol default 0.2.0 while 0.3.0 exists: an engine default
- J3-06 legal default 0.0.1: an engine default
- J3-07 legal 0.2.0 numbers are post-hoc: not a defect; the gap is a blind run
- J3-10 legal benchmark data absent from the tree: data (bench work)
- J3-13 misleading remedy on an invented quotation: an engine defect already in the ledger as misleading-remedy rows
- J4-08 stress rows carry no engine provenance: data provenance (bench work)
- J4-13 prereg clock correction: attestation (third-party timestamps)
