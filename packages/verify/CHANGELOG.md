# verify engine changelog

The engine version is `ENGINE_VERSION` in `src/version.ts` (a test keeps it equal to `package.json`). Every verdict names the
engine that made it, and its `verdict_id` derives from that name. Rulesets version on their own; see `docs/RULESETS.md`. Each
heading gives the version, the date, what the release is about and the pages that describe it. The terms are defined in the
glossary at the repository root (`docs/GLOSSARY.md`).

**Why there are so many versions, so close together.** A change to how the engine reads a document gets a new engine
version instead of silently changing old answers. This build carries every earlier engine (the list is `ENGINE_VERSIONS` in
`src/version.ts`), and a replay re-performs a verdict under the engine that issued it. A build that ever drops an old engine
must say so here, and that engine's verdicts then replay as a structure check only. So a verdict issued under a closed label
replays byte for byte under the engine that issued it, with one known exception: some verdicts labelled
0.0.1 were issued before later corrections were made under that same label, and an earlier measurement found 8 of 130 of them
do not replay identically (all corrections; see the 0.1.0 entry). A new version number means "new verdicts can differ here",
not "old verdicts changed". Several versions in a few days mean several such changes, each recorded below with what it changed.

**Two words, one meaning each.** *Closed*: an engine label whose computation no longer changes. A label closes when a later
version is opened above it in `ENGINE_VERSIONS`; from then on any change gets a new version number. Engines 0.0.1 to 0.7.1
are closed; 0.7.2, the label this tree builds, is open. *Released*: a tagged, signed, published artifact of a closed label.
No version is released yet: none is on npm or carries a signed tag, and this repository runs no public CI, so the record that
a label was closed, and when, is this page and the tree, both under the authors' control. A heading that says "unreleased"
records a change made while its label was still open; none of them is a release.

**0.7.1 closed on 2026-10-14, when 0.7.2 was opened above it; 0.7.2 is open.** The 0.7.1 entry below was written while that label
was open, and its subtotal sentence was corrected under it late on 2026-10-13, so a verdict issued under an earlier 0.7.1 build may
not replay byte for byte on the closed one. Nothing a 0.7.1 verdict computes changed on 2026-10-14: the defaults that moved that
day are gated on 0.7.2, and the drift bank's 3,762 replays matched on the tree that opened it. From the opening of 0.7.2 a 0.7.1
verdict is held to the same rule as every earlier engine's, and 0.7.2, now open, carries the same warning.

**0.7.0 closed on 2026-10-13, later that day, when 0.7.1 was opened above it.** The 0.7.0 entry below was written
while that label was open, and its emailed-bill reading changed again under it that afternoon (a sender domain with two
neighbouring letters swapped, against a domain on file, goes to a person), so a verdict issued under an earlier 0.7.0 build may
not replay byte for byte on the closed one. From the opening of 0.7.1 a 0.7.0 verdict is held to the same rule as every earlier
engine's, and 0.7.1 carried the same warning while it was open.

**0.6.0 closed on 2026-10-13, when 0.7.0 was opened above it.** The 0.6.0 entries below were written while that
label was open, for a build that has not been published. While it was open, a verdict issued under 0.6.0 was not
stable. Its id could move (the pay-app remedy entry below moved some) and its text could change (the can't-tell wording below
changed some), so a verdict issued under an earlier 0.6.0 build may not replay byte for byte on the closed one. From 2026-10-13
a 0.6.0 verdict is held to the same rule as every earlier engine's, and 0.7.0 carried the same warning 0.6.0 did while it was open.

## 0.7.2 (2026-10-14, release-pass)

the announced-change rule and the supply-house readings become the accounts-payable default (ap-threeway@0.3.0), legal@0.5.4 becomes the legal default, and the gate server's policy is the operator's

Engine 0.7.2 opens two changes to what a new verdict says, each gated on it so that a verdict made under 0.7.1 or earlier is
re-performed exactly as that engine read and replays byte for byte, and ships with four changes to the tools around it:

- **Ruleset ap-threeway@0.3.0, the default for a new emailed-bill verdict from engine 0.7.2** (2026-10-14; docs/AP-INPUT.md check 7
  and "Older rulesets", docs/doors/accounts-payable.md). A controller's cold review found an announced change of payment details
  with no instruction in it approved: "Heads up, our old account at Wells Fargo was closed last week. Janet in our office will call
  you with the replacement info before you cut the check." Under 0.3.0 a sentence that names an account, bank, lockbox, routing or
  remittance detail as closed, changed, new, updated or replaced, or that promises to call, send or confirm payment instructions, goes
  to the controller, the sentence named ("the bill announces a change of payment details, or promises new payment instructions"). An
  approve's payment-redirection line says "none was found" only when no sentence of the bill names payment at all; otherwise it names
  each sentence that does and how it was read. Four supply-house habits that sent a clean bill to a person for a reason of reading
  are read: a pole count ("1P" for single pole) in the line match, a subtotal line that is the lines' sum (one that is not goes to a
  person, both figures named), a distributor's invoice number after the word "invoice" ("S104412558.001"), and a unit price per
  thousand or per hundred ("189.00/M"; capital M and C only). 0.3.0 needs engine 0.7.0 or later and is refused under an earlier one.
  The default follows the engine asked for: a bill that names no ruleset is read under 0.3.0 from engine 0.7.2 and under 0.2.0 by
  engines 0.6.0 to 0.7.1, so an older engine named for a replay is never handed a ruleset it refuses. 0.2.0 is retained and
  re-performs byte for byte: over the 100 public benchmark cases and the 3,000 banked stress rows no decision or reason moves between
  the two.
- **The AP stress rows re-banked** under engine 0.7.2, `ap-threeway@0.3.0` and the new AP pack digest (`70cba0d1…`; the tenth and
  eleventh amendments in `docs/bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md`, the second after the verdict door below): 0 of 3,000
  decisions moved, 0 reasons changed, 0 wrong of 2,755 decided; a fresh run reproduces all 30 files.
- **The verdict door holds ap-threeway@0.3.0 to the line recompute.** The check the book and the HTTP service run on a recorded
  verdict (every priced line carries a line-amount claim, and each recomputes from its own operands to its own outcome) applied to
  ap-threeway@0.2.0 and ap-structured@0.1.0 only, so a 0.3.0 verdict whose line FAIL was flipped to PASS, with its outcome and coverage
  rewritten to match, was let through unchecked. Found while opening this label, before any 0.3.0 verdict was issued by a release;
  0.3.0 prices its lines as 0.2.0 does and is now held to the same check. Tests: the forgeries are refused under both versions.
- **The legal default.** A new legal verdict is issued under `legal@0.5.4`, the entry below; engine 0.7.1 keeps `legal@0.5.3` (and can
  name `legal@0.5.4`), engines 0.6.0 and 0.7.0 keep `legal@0.5.2`. Pages: `docs/LEGAL.md`, the root's `docs/doors/legal.md`.
- **A Word brief in.** `packages/intake` gains `brief`: `node packages/intake/dist/cli.js brief brief.docx --out brief.json` writes the
  citations check's input from a .docx, every quotation with its citation, "Id.", "supra" and short forms resolved to the full citation
  before them, the paragraph kept in each id, and whatever it cannot resolve listed first and still written so the engine answers can't
  tell for it (exit 2). A prototype with no measured accuracy. Pages: `docs/LEGAL.md` "From a .docx", `packages/intake/SPEC.md` "brief".
- **Gate server: the policy is the operator's.** `price_tolerance` is pinned when the server starts (`--policy <policy.json>` or
  `RIPOSTE_GATE_POLICY`; `--strict` refuses to start without one); a caller may lower it, never raise it, and a value above the
  operator's is refused by name (`policy_exceeds_operator: price_tolerance 1 > pinned 0.02 (policy <digest8>)`). The policy's
  digest (sha256 over its canonical JSON) is printed on every bill's scope line and every replay headline as `policy <digest8>
  price_tolerance <value>`; a proof made under a wider tolerance than the operator's re-performs and goes to a person (exit 2),
  naming both policies. A cold review had found an agent could pass `price_tolerance: 1` and APPROVE a bill 95% over its PO.
- **`riposte-ledger sign <verdict.json | proof.json> --key <private.pem>`** signs a verdict, or a replay bundle's verdict, into the
  engine's envelope (`{ verdict, alg: "ed25519", public_key, signature }`) and prints the issuer fingerprint (sha256 over the
  public key's DER bytes, 64 hex, the value `--trusted-key` pins). `riposte-ledger verify-signature <file> [--trusted-key
  <public.pem | 64-hex>]` checks it offline: exit 1 on one changed byte or another issuer.
- **Frags** (`packages/frag`, `frags/`, the frags door and the site's frag pages). A frag is one signed, append-only, publishable
  artefact: a lock over the tree by the preregistration's pin rule, a claim (a bench table's rows, one verdict, or a closed engine
  label), its proof, provenance, a `frag_id` over lock + claim + proof, an Ed25519 signature, and an entry in a receipts ledger
  (`frags/frags.jsonl`). `frag open` re-performs it; the site renders each from its `frag.json` alone. The first three are signed with
  a test key and pin the tree as it stood before this label was opened; the published key is the maintainer's to mint. Pages:
  `packages/frag/SPEC.md`, `docs/doors/frags.md`.
- **Work frags** (`packages/frag`: `import`, `export`, `emit ledger`, `emit diff`, `contract`, and `open` on a chain). A work frag
  is one step of work by an agent, a person or a tool (`riposte.work-frag/0.1.0`), named by the sha256 of the canonical JSON of
  its other fields and citing the frags it relied on. A Trajectory in uni-agent's shape imports to work frags and exports back
  to the same shape, every field as it was read, with the verdicts under `reward_info.riposte`; a second trip is
  byte-identical. Token fields are carried when a run has token ids and left out, declared absent, when it has none; a time or
  a model nothing recorded is null, never invented. A receipts ledger emits one frag per entry, read only (a repeated key
  refuses it, by line); a captured `git diff --stat` emits one step with the changed files by digest. The check contract maps
  each finding to gate, flag or monitor: an inference never gates (`inference_cannot_gate`, by name), and a checker the
  contract does not register never gates either (a person decides). The work graph's conformance cases run in this package's
  suite. Pages: `packages/frag/SPEC.md` ("Work frags"), `docs/doors/frags.md`.
- **The work graph** (`packages/workgraph`, new; prototype; no measured accuracy): the canonical work frag and its format
  (`SCHEMA.md`), a content-addressed store, invalidation that flags every descendant of a frag marked wrong, deltas since a frag,
  a deposited bundle anyone opens alone, a digest (doing, why, next) generated from the graph and never typed, and the charter
  (`CHARTER.md`): the findings contract that maps each check's finding to gate, flag or monitor, where a routing hit may appear
  only as an inference (`route_cannot_check`) and only a checker the charter names may gate. `conformance/` holds the cases any
  implementation runs to show it writes the same format; three packages run them.
- riposte-identity 0.0.1 (prototype; no measured accuracy; built and tested in the lab, **not in this export**): attest each reply's
  resolved model from a transcript or reply log as a work frag; a content-free skeleton that attests identically; a canary bank and a
  two-sample permutation test (`scan`) whose answer is an inference, never a gate. Held back because its frags carry a draft schema
  string the work graph refuses; it ships once that is fixed under a declared deviation of its preregistration.
- **Docs: the agents door** (`docs/doors/agents.md`) now opens on the gate itself (what it returns, MCP and HTTP, one command each, the
  policy is the operator's), then the receipts ledger and its offline check and every refusal; the plugin README gains "Install from
  this repository alone" with each host line and whether it was run; INTERCHANGE §15 states that the gate's proof is the engine's and
  replays with no network; the gate-server README gains a shell session run on a fresh clone.

**Security (2026-10-20)**

- **A long citation no longer stalls the citations check** (from an audit of the packs' patterns, 2026-10-19). From legal@0.5.0 the
  engine reads the reporter citations off a citation as written, and from legal@0.5.4 its database numbers, with two regular
  expressions whose loop over capitalised words let a run of capitals split every way. A volume and 28 capitals with no page after
  them (32 characters) took 7.6 s, about double for each capital more; a year and 256 capitals before a number took 1.9 s, about
  sixteen times as long for each doubling; 16,384 short words such as "A.1" after a volume took 10 s. The citation is the caller's
  text, so one such citation held an HTTP worker until the service's time limit stopped it, and held the MCP server or the command
  line with no limit. Each pattern is replaced by a reader that makes one pass and returns what the pattern returned, match for match
  and group for group: no match or group differs on 179,375 strings drawn from every citation and text in the tree or on 1,960,972
  generated ones, and every legal brief in the tree re-issued under each of the eleven legal rules gives byte-identical verdicts
  (2,266). No rule version changes and no verdict moves; the same probes now answer in 16 ms or less. Tests:
  `test/legal-redos.test.ts`.
- **Citation text is read up to 1,024 characters at the doors** (the remainder named by the reader change above, measured on
  2026-10-20). `POST /v1/verify/citations`, the MCP tool `verify_citations` and `verify citations` refuse a cite, case name or
  source key, or the key of a text, longer than 1,024 characters, before anything is read or hashed: `400` over HTTP, a tool error
  over MCP, exit 3 on the command line, each naming the bound and the length. It is a refusal, never a verdict. Before, a 64 KB
  citation made of a long run of spaces or of open parentheses held an HTTP worker, the MCP server or the command line for 2.5 to
  10 s, and a text's key was read again for every citation of the brief (10,000 citations against one such key of 1,024
  characters took 20 s). The longest citation in this package's legal fixtures, blind sets, drift sets and the cold reviews'
  briefs is 122 characters (a cite with a "(quoting ...)" parenthetical); no case name is over 74 and no key over 33. A citation
  at or under the bound is read exactly as before: every legal brief in the tree, issued through each of the three doors under
  each of the eleven legal rules, gives byte-identical answers (6,666), and no rule version changes. The OpenAPI description and
  the MCP tool's input schema state the bound (`maxLength`). The library's `verifyCitations` has no bound. Tests:
  `test/legal-cite-bound.test.ts`.
- **The citation's other readers make one pass.** Seven regular expressions that read a citation's text were quadratic in a long
  run of spaces, of open parentheses, or of commas before a line break: the four of the reporter-citation parser (a closing
  parenthetical, a pin after a comma, a pin after " at ", and volume, reporter and page), the split of a case name into its
  parties, the trim before a reporter citation and the short-form pattern. Each is replaced by a reader that returns what its
  pattern returned: no output differs on 529,817 strings drawn from every citation, key and text line in the tree, or on 2,100,000
  generated probes per reader; 600 verdicts on long citations issued through the library under every legal rule are
  byte-identical; no rule version changes. Through the library a 64 KB citation, case name or key now answers in 8 ms or less
  (before: 2 to 10 s), and 10,000 citations against one 1,024-character key in 0.3 s. Tests: `test/legal-cite-readers.test.ts`.
- **A long brief's citations are read once, not once for each citation** (the remainder named by the bound above, measured on
  2026-10-20). A short form ("477 U.S. at 248") read every citation of the brief to find the full citations it could point to, and a
  citation looked up by the reporter citation read off it read every supplied key, each again for every citation; the list of texts a
  miss prints, and each text's namings in the provenance and the choice ledger, were rebuilt the same way. Through the library, the MCP
  tool `verify_citations` and `verify citations`, 4,000 citations of genuine length took 20 to 24 s with half of them short forms, and
  27 to 34 s each looked up against 4,000 texts, about five times as long for each doubling. Each is now read once per request, through
  an index of the brief made the first time it is needed: the same briefs take 0.09 to 0.14 s through the library and MCP (0.9 and 3.1 s
  on the command line, most of it starting the process and reading 4,000 text files), and 60,000 citations with half of them short
  forms, about what a 4 MiB request holds, take 0.8 to 1.0 s. A short form still points to the one full citation of the brief it fits,
  wherever that stands, and none or more than one still answers can't tell; a citation still finds its text by the keys in the order
  supplied. No output differs: every legal brief in the tree through the library and the three doors under each of the eleven legal
  rules (9,020 answers), 3,000 generated briefs of 8 to 55 citations (33,000 verdicts) and every ordering of 525 small sets of short
  forms and full citations (340,200 verdicts) are byte-identical, and no rule version changes. Tests: `test/legal-cite-index.test.ts`.
- **A ledger line that is JSON `null` no longer stops `riposte-ledger` or `riposte-replay`** (packages/receipts; found by the
  Python reader of the record, pinned by its conformance vectors). `verify` threw `TypeError: Cannot read properties of null
  (reading 'seq')`, exit 1 with no verdict line; `summary`, `rule --sign-only`, `verify --proof` and the head record's check threw
  the same way. A null line now breaks the chain at that entry: the first line reads "BROKEN: chain" and the reason "entry N is not
  a ledger entry (the line is JSON null)", exit 1, the words the Python reader already gave. A line that is an array, a number, a
  string or a boolean already broke the chain there. When the head record names an entry whose line is not a ledger entry, its
  words now say so ("entry N is not a ledger entry, so it is not the one its head record names") where they read "the file has
  undefined… there". The record vector for the null line now pins that answer instead of the exception. Tests:
  `test/ledger-null-line.test.ts`.
- **An `--entry` given as a hash prefix no longer throws past a line that is not an object** (packages/receipts; found while
  fixing the line above, older than it). `riposte-ledger verify --proof … --entry <8 or more hex>` and `riposte-replay --ledger …
  --entry <8 or more hex>` read each line's hash as text and threw a TypeError, exit 1 with no verdict line, when any line before
  the match was `null`, an array or a number. Such a line is now passed over, and a prefix nothing matches says so in words: "no
  entry <prefix> on the ledger" (exit 1 with verify's chain answer) or "no entry <prefix> on <ledger>" (exit 3).

**Sibling packages (2026-10-20)**

- riposte-identity 0.1.0: attest and scan write work frags the work graph reads (riposte.work-frag/0.1.0): a step naming the transcript by its content-free skeleton's sha256 and a claim-check on it, or a step naming both samples and an inference read from it; the result block is named by digest and written with --detail; --charter goes with --clause; check-frag checks every rule of the format. What attest and scan answer is unchanged (1,166 recorded answers byte-identical, all 360 bench items included).

**Conformance (2026-10-20)**

- A Python interpreter of the declarative ruleset format (`conformance/engine_py/declarative/`, standard library only) reproduces both
  declarative goldens (489 and 177 pinned hashes), issues byte-identical e-invoice verdicts under engines 0.0.1 to 0.7.2, and replays the
  e-invoice drift sets item for item as the Node replay does (2,566 of 2,566). Python readers of the receipts ledger, frag folders and the
  work graph (`conformance/engine_py/record/`) pass the work graph's conformance file (78 of 78) and verify Ed25519 in pure Python. The
  replay contract has a second implementation (`conformance/engine_py/cli.py`): on the 23 conformance vector runs its exit code and first
  line equal the engine's; the comparison over the whetstone corpus is preregistered (two-engines-1) and has not run. Written from the
  Node sources by the same house: agreement shows faithfulness, not independence.
- Conformance: the pattern dialect riposte.pattern/0.1.0 (`conformance/patterns/`): two translators (JavaScript, Python 3.10+), a pinned
  Unicode 16.0 class table read by both, 708 vectors (699 for a reader without the rewrite catalogue); every one of the 744 pattern
  literals of the AP and legal packs crosses it (741 as written, 3 by a catalogued rewrite) with no difference between the two
  translators on 5,827,006 probe runs; no ruleset reads it yet.

**Accounts payable (2026-10-19)**

- **ap-threeway@0.4.0, selectable, not the default** (from cold reviews, 2026-10-06 and 2026-10-13, re-run on 2026-10-19). Six
  emailed bills approved under engine 0.7.2 and ap-threeway@0.3.0 go to a person under 0.4.0, the line named: the opening step of
  a payment redirection (a request to reply, call or confirm about the vendor's banking or wiring details, or to reply or call
  before payment is released; a move to a new bank or financial partner); a bank-detail phrase spelled apart, with invisible
  characters or with look-alike letters (each line is also read as spelled: invisible characters left out, compatibility forms
  and accents set back, look-alike Cyrillic and Greek letters read as Latin, single letters spelled apart joined into the payment
  words docs/AP-INPUT.md lists); a Reply-To at another domain than the From line of its header block; and, with no domain on
  file, a sender whose domain is the vendor's name run together under another ending than .com (a scanning slip read back onto
  .com still counts as .com). It reads everything 0.3.0 reads and only tightens. It adds no rule, claim id or remedy, so every verdict id of 0.3.0 and earlier is unchanged, and
  0.3.0, 0.2.0 and 0.1.0 re-perform byte for byte (5,753 bills under each, whole results and words compared before and after).
  Selected in the library (`ruleset: 'ap-threeway@0.4.0'`); it needs engine 0.7.0 or later, and a bill that names no ruleset is
  still checked under 0.3.0. On the stress study, the development seeds, the 100 public invoices and every AP fixture no decision
  moves; the bills that move are the readers'. A vendor whose own domain is not .com goes to a person under 0.4.0 until its
  domain is on file (the purchase order's "Email:" field, or a booked bill's sender). Tests: `test/ap-040.test.ts`; bills:
  `test/fixtures/ap-r10/`.

**Security (2026-10-19)**

- **The receipt ledger refuses an entry that reads two ways** (packages/receipts; from a cold review, 2026-10-13). A signed entry
  rewritten by hand as `"decision":"EXECUTE","decision":"HOLD"` verified with the pinned key: JSON keeps the last of a repeated
  key, so the hash and the signature covered HOLD while a reader that keeps the first saw EXECUTE. `riposte-ledger verify` now
  reads each line with the engine's strict JSON reader, as the replay path does: a key written twice in one object, or a number
  whose text does not read back as written, breaks the chain at that entry (exit 1), naming the line and the JSON path.
  `summary` and `rule` read the same way, and the library's `parseLedger` and `parseLedgerTolerant` throw on such a line, so
  `riposte-replay --ledger`, `riposte-pilot` and `riposte-ledger case` refuse it too. The file store reads each line the same way
  and breaks the chain at the first line it refuses, so `ledger_verify` over MCP and `riposte-serve` answer as the command line
  does. The reviewer's files ship as test fixtures.
- **The head record's byte count is checked** (packages/receipts). The record beside a ledger has always stored the file's
  length; verify now compares it with the file's length up to the entry the record names, as the file store does when it opens
  a ledger, and a difference does not verify (the reviewer's edited file was 21 bytes longer than its record said). A record
  without a byte count does not verify. A last entry with no newline after it still verifies, with its note.
- **Every file `riposte-ledger` reads is UTF-8** (packages/receipts): bytes that are not UTF-8 are refused (exit 3) instead of
  being replaced, which made two files read the same and a byte count read wrong.
- **The engine's MCP server bounds `price_tolerance` by the operator's policy** (`riposte-verify-mcp`), as the gate server does:
  `--policy <policy.json>` (or `RIPOSTE_VERIFY_MCP_POLICY`) pins it when the process starts, `--strict` refuses to start
  without one, and `verify_invoice_match` refuses a higher tolerance by name (`policy_exceeds_operator`, exit 3) in the gate
  server's words. Without a pinned policy the bar is the documented default, 0.02. Before, a caller's `price_tolerance: 1`
  approved a bill 95% over its purchase order. Within the bar every verdict is unchanged. The server now refuses an argument it
  does not read on its command line, where it used to ignore it.
- **A transcript line that is JSON but not an object no longer stops a model attestation** (packages/receipts `model_attest`,
  `riposte-attest`). A bare `null` line threw a TypeError and ended the run with no words; such a line is skipped, as a line that
  is not JSON already was, and the replies around it are read as before.
- **The export scan masks encoded runs before matching terms.** A base64 signature can contain any three letters by chance, and
  the characters around them make word boundaries, so a custody tabletop output failed the scan once in four runs on a signature.
  Runs of 24 or more standard-base64 characters that carry a digit and both letter cases, with no plain-word path segment, are
  masked before the term match; prose, paths and repository-link hashes are matched as before.
- **A replay checks the decision beside an AP verdict, not only the verdict** (from a cold review, 2026-10-19; reproduced the
  same evening). The output of `verify ap` carries what the AP gate decides on its verdict: `decision`, `payable`, `grounding`,
  `reasons` and `not_checked` (and `exit` and `allow_open` with `--allow-open`). A replay re-performed the verdict byte for byte
  but compared none of these, and did not name them, so a hold rewritten to "approve, all checks passed" replayed "outcome
  VERIFIED", exit 0, under `--strict`, on the emailed-bill and structured paths. Now each is derived again from the re-performed
  verdict's own inputs, under its engine and ruleset, and a field that differs, is missing, or is a key `ap` never writes fails
  the replay, exit 1, with or without `--strict`, each field named with what the file states and what the verdict derives. A
  bundle that states any of these fields beside an AP verdict has them compared too (DIVERGED at the field, in a folder, over
  HTTP and over MCP). A genuine file replays exactly as before. The pay-application and legal commands write no field outside
  the verdict; tests pin that. docs/REPLAY.md, "The decision beside an AP verdict".
- **`POST /v1/replay` answers a non-2xx status when a replay does not verify** (from a cold review, 2026-10-19). A diverged
  replay answered 200, with `x-verify-exit: 1` the only sign, so a proxy or a client that reads only the status took a forgery
  for a success. Now 409 when a case diverged, 422 when a case was refused (a refused case wins, so a batch with a diverged and an
  unreadable case is 422), 200 when every case matched or none diverged and some were not re-performed. The body and
  `x-verify-exit` are unchanged.

- **The hosted gate's `POST /v1/replay` answers with the replay's exit** (packages/receipts; from the same cold review,
  2026-10-19). It answered 200 with no `x-verify-exit` whatever the replay found, so a client or a proxy that reads only the
  status took a forged decision on a kept proof for a success. It now answers as the engine's route does: 409 when a case
  diverged or a kept proof did not bind to its receipt, 422 when a case was refused (a refused case wins), 200 otherwise, with
  `x-verify-exit` on every answer that replayed; a ledger whose chain does not verify is at least exit 1 (409), as
  `riposte-replay --ledger` exits. The body is unchanged; a request that names nothing replayable keeps its 400 or 404 and
  carries no exit header. The reader's forged result ships as a test fixture.
- **A replay refuses a key a bundle or a signed envelope does not define** (from a cold review, 2026-10-19; ruled that evening:
  fail closed by default). Such a key was named "carried, not checked" and the replay exited as if it were absent; only
  `--strict` refused it. Now it is refused before anything is hashed (exit 3; REFUSED in a folder; 422 over `POST /v1/replay`),
  each key named by its path (`unknown_keys` in the JSON). `verify replay --allow-unknown-keys` keeps the old reading and says
  on stderr and in the JSON (`allow_unknown_keys: "stated"`) that it was given. A bundle's `id` and `note` stay allowed, and the
  AP gate's fields beside an AP verdict stay compared. The 2026-10-12 cold reader's bundle (`extra`) and envelope
  (`issued_note`) are now refused; no banked replay set carries such a key.
- **A replay refuses an annotation member its declared shape does not have** (from the same review). A verdict carrying
  `action_context: {"approved": true, "amount": "1894.92"}` replayed VERIFIED, exit 0, because annotations are never compared.
  A member the shape does not declare (`action_context` is `{ tool_name, call_id, argument_path }`; likewise `ledger` and its
  reviewer, `declared_accuracy` and `case`) is now refused, exit 3, named, with or without `--strict`. The annotation itself is
  still not compared, and the shapes this build writes replay as before.
- **`--allow-open` accepts only checks that wait on a reference or a field the document does not carry** (from the same
  review). An invoice whose first line read "1600.0O" (wrong by 100 behind one letter O) left line math and the sum unreadable
  rather than failed, and `check --allow-open` exited 0. Now `--allow-open`, and `"allow_open": true` over HTTP and MCP, gives 0
  only when every open check's reason is REFERENCE_NOT_PROVIDED or FIELD_MISSING and no load-bearing field is struck; any other
  open check keeps exit 2 and is named with its reason. No verdict changes (the exit reading is not hashed). `ap --allow-open`
  is unchanged.

**Bench tooling (2026-10-19)**

- **The bench page states only what the tree says** (verify bench index; from a cold review, 2026-10-19). The page read "engine 0.6.0,
  the label today's build carries, is still open" from a literal in its generator, and `bench check` reproduced the false sentence byte
  for byte. The open label is now the version file's `ENGINE_VERSION` and the closed labels the ones below it in `ENGINE_VERSIONS`, each
  dated by this page's "closed on" lines; `bench index` refuses (exit 1, nothing written) when this page calls the open label closed or
  its summary sentence disagrees with the version file. The AP stress rows' re-bank history is read from their amendment file through its
  last entry (13 re-banks over 11 amendments, the last two on 2026-10-14), and typed text on the page that counts them differently is
  called out beside it. When the outside-the-rule list has no row for the default legal rule this build issues, the page says so.
  Tests: `test/bench-page-derived.test.ts`.
- **`bench check` names a preregistration whose pins moved** (from a cold review, 2026-10-19). A preregistered run that has not run pins
  the build it will test in its own tables. `bench check <tables-dir>` now reads them (section 2 and each amendment, row by row),
  recomputes each source digest on the tree the tables sit in, compares each version with this build, and prints `STALE PINS <id>: …`
  with both values of every pin that moved. Noted, not refused: exit 4, like a missing stamp; `--strict-pins` refuses (exit 1), and
  `--pins-root` points a copied tables directory at its tree. On the shipped tree it names `blind-shipping-1`: engine 0.7.1,
  ap-threeway@0.2.0 and legal@0.5.3 pinned, and four of its six pinned digests moved. The bench page says the same from the versions
  alone. Tests: `test/bench-pins.test.ts`.

## 0.7.1 (2026-10-13, release-pass)

legal@0.5.3 is the default legal rule: a separate opinion's designation with a join clause, a view stated across sentences, the opinion's own quotations, running headers and citation clauses are read; a replay names the keys it does not check, the HTTP service refuses a request with no Host header, the ledger names a torn tail, invoice explanations are in words, and a sender domain with two letters swapped goes to a person

Engine 0.7.1 opens two changes to what a new verdict says, each gated on it so that a verdict made under 0.7.0 or earlier is
re-performed exactly as that engine read and replays byte for byte, and ships with three changes to the tools around it:

- **The legal default.** A new legal verdict is issued under `legal@0.5.3`, the entry below; engines 0.6.0 and 0.7.0 keep
  `legal@0.5.2`, and `legal@0.5.3` cannot be named under them. Pages: `docs/LEGAL.md`, `docs/LEGAL-TEXT.md`.
- **Invoice explanations in words.** A claim's explanation for the invoice ruleset says what was checked and the figures
  ("total = subtotal + tax − discount: 1,894.92 computed, 1,894.92 on the invoice, the same to the cent"; a FAIL names both figures
  and the difference), a check that could not run says what it was not given, and no explanation carries a kernel name; the name
  stays in `rule_name`. Under 0.7.0 and earlier the old explanations stand. Page: `docs/RULESETS.md`, "The built-in rulesets".
- **The subtotal sentence, corrected under the open label (2026-10-13, late).** For the subtotal check the computed figure is the
  sum of the line amounts and the stated one is the invoice's subtotal; the sentence had named them the other way round. Found by
  the Python second engine's port of these words (`conformance/engine_py/`), which now matches byte for byte.
- **The `ap` headline.** `A PERSON DECIDES` on screen, without a parenthetical; the JSON `decision` is still `abstain`. Scripts that
  parse the headline match the three words.
- **Replay, the HTTP service and the ledger** (no verdict changes, under any engine). Pages: `docs/REPLAY.md`, the root's
  `docs/INTERCHANGE.md`, the replayers' instructions handed out with the review copy, and the engineers' page; the dated account is "How the replay contract changed" at the end of
  this file.
  - A replay names the keys a file carries outside the verdict and its inputs (`carried, not checked: <keys>` on the line under
    its first, `carried_not_checked` in the JSON), and `--strict` refuses them (`outside keys under --strict: <keys>`). Two caller
    keys at a bundle's top level, `id` and `note`, are allowed: named on every run as `carried (allowed): id, note`
    (`carried_allowed` in the JSON), and `--strict` does not refuse them, so the engine 0.0.1 pack's bundles still pass it. The
    output of `ap` names its `read` member as carried when the replay is not given the files `read` records. The `--strict`
    failure line reads "not everything in the file was" (it read "in the verdict").
  - When `--trusted-key` matched the key by the older fingerprint form, the first line says `by the trusted key` and the note
    comes second (it came first).
  - In a folder or a `.jsonl` a refused case wins the exit (3); a diverged case used to hide it behind exit 1.
  - A replay's refusal of a number that cannot be represented exactly advises re-issuing the verdict with the amount as a string,
    since a replay of the existing verdict cannot change its input (it advised writing amounts as strings).
  - `POST /v1/replay` answers with `x-verify-exit` (0 match, 1 diverged, 2 not re-performed, 3 refused), status 200.
  - `verify serve` refuses a request with no Host header with a 400 on every HTTP version, a charset other than UTF-8 with a 415
    naming it, and names a UTF-16 body in its 400; `--max-body <bytes>` sets the 4 MiB body cap, and `serve --help` states the
    caps.
  - `riposte-ledger verify`: a last line that is not a whole entry is a torn tail, exit 1, with or without a newline after it, and
    the words give the repair; a whole last entry with no newline after it verifies, with a note; a broken chain's first line is
    `BROKEN: chain`, with a sentence on why `signatures_ok` alone is not the answer; `--help` lists what each exit means.
- **Two pages state the rules as they stand** (no behaviour change): `docs/REPLAY.md` and `docs/RULESETS.md` lost their dated
  asides; what each said about when a rule arrived is at the end of this file, in "How the replay contract changed" and "The
  rulesets' record". REPLAY.md gains "What a replay is given" (with the recipe for an emailed bill's result) and "The order of
  the lines".

The swapped-letters sender domain named in the line above was read under the open 0.7.0 label (see the preface and 0.7.0), and
closes with it; 0.7.1 reads it the same way.

## Legal rule 0.5.5: an ellipsis inside a clause, inserted words, ligatures, rule and code citations, the court's own sentence, a quotation the court departs from, nine designation styles, two pluralities, a district court's slip opinion (2026-10-19; selectable from engine 0.7.2, the default from the first engine after it; docs/LEGAL.md)

Two cold readers (AI agents reading the pack in the tenth review round and as a legal-operations buyer, 2026-10-19; not people) found
ellipses that drop a word of degree passing ("are . . . enforced" for "are rarely enforced": 13 of 19 such cuts), as did one over part of
a time phrase and one over a burden; inserted bracket words ("[always]", "[unreliable]") passing; nine separate-opinion designation styles
and two plurality forms read as the majority; a ligature from PDF conversion causing false FAILs whose remedy told the writer to change a
correct quotation; "(citation omitted)" failing a correctly disclosed quotation over a rule, a code or a Restatement (9 of 11 forms); the
court's own rejection sentence held as a party's view; a quoted standard the court departs from in its next sentence passing; and a
district court's slip opinion read as its counsel listing. The fixes are a new ruleset version, `legal@0.5.5`, selectable from engine
0.7.2 and the default for a new legal verdict from the first engine after it (src/legal/index.ts V055_DEFAULT_ENGINE). Engine 0.7.2 keeps
`legal@0.5.4` as its default, and a verdict that names `legal@0.5.4` or earlier replays under that rule, byte for byte. On both blind sets
it gives every outcome `legal@0.5.4` gives (40 of 40; 58 of 58), and on the earlier readers' briefs no outcome moves (229 checks). On the
two readers' own briefs it moves 61 answers (the review round's: M01, M04, M14, M15, M20, M27, 13 adverb cuts, 9 designation styles, and 5
bracket probes; the buyer's: h25, q03, q06, o02, o06, o09, o12, f01 to f06, f08 to f10, q06b, two judge-line variants, and 9 rule-citation forms).

- **An ellipsis inside a clause (2026-10-19).** An ellipsis that omits words from the middle of a clause answers can't tell, "cut inside a
  clause", whatever the words; so does one over a word of degree, frequency or hedging, over words that say who must show what, or over a
  part of a time phrase that "or" joins to the words kept (`missing: ['elided_words']`). One set off on both sides, one over whole
  sentences, and one over a whole "not X, but" contrast read as before.
- **Inserted words (2026-10-19).** A bracket that inserts a word of degree ("[always]"), a word that negates its stem ("[unreliable]") or an
  "-ly" adverb FAILs ("Remove the inserted [always]"); any other inserted content word answers can't tell (`missing: ['inserted_words']`);
  glue, names, "[sic]" and a referent for a pronoun read as before.
- **Ligatures (2026-10-19).** U+FB00 to U+FB06 are read as their letters on both sides, named on the PASS, never named as a difference.
- **Rule, code and Restatement citations (2026-10-19).** "Fed. R. Civ. P. 56(a).", "U.C.C. § 2-607(3)(a).", "Restatement (Second) of Contracts
  § 90 (1981).", "N.Y. C.P.L.R. 3212(b) (McKinney 2024)." and their kin are citation sentences and clauses when they hold citation words only,
  so "(citation omitted)" excuses them; the buyer's eleven forms: 11 PASS (2 under 0.5.4).
- **Whose words (2026-10-19).** A quoted sentence in the court's own voice ("That reading is foreclosed by the text.") is the court's; a
  quoted standard the court departs from in other words in its next sentence ("We part ways with that formulation today.") answers can't
  tell naming it (`missing: ['next_sentence']`); nine designation styles end the majority ("concurring dubitante:", "specially concurring:",
  "statement respecting the denial of rehearing en banc:", "LINDQVIST, P.J. (concurring in result only)", "Separate Statement of …" and four
  more); a plurality in a Lexis "Judges:" line or under "OPINION ANNOUNCING THE JUDGMENT OF THE COURT" is named.
- **A district court's slip opinion (2026-10-19).** Its heading or its judge's line ("CORDELL, District Judge", "CORDELL, J.") starts the
  opinion before any body prose; the buyer's slip, typed from memory: 6/5/2 (0/1/12 under 0.5.4).

## Legal rule 0.5.4: "(quoting …)" in either field, the first letter, a conjoined condition, the negation's clause, six designation styles, a filing as speaker, database numbers (2026-10-14; the default from engine 0.7.2; docs/LEGAL.md)

Two cold readers (AI agents reading the pack as a legal-operations buyer and in the ninth review round, 2026-10-13; not people) found a
genuine quotation FAILing when its "(quoting …)" parenthetical is written after the quoted words, as LEGAL.md told the writer to; an
unbracketed change of a quotation's first letter and an ellipsis over part of a conjoined condition passing where the page promised
can't tell; four genuine quotations held by the negation and lead-in guards; six separate-opinion designation styles and a party's
filing ("Tamberly's brief states that") passing as the court's words; and nine quotations against an unpublished opinion cited by its
Westlaw number never checked, because the number was not read as a caption's citation. The fixes are a new ruleset version,
`legal@0.5.4`, the default for a new legal verdict from engine 0.7.2, chosen by LEGAL.md's stated rule: it ties `legal@0.5.3` on half B,
closes the false-PASS classes the readers found, and gives every outcome `legal@0.5.3` gives on the second blind set (40 of 40). Engine
0.7.1 keeps `legal@0.5.3` as its default and can name `legal@0.5.4`; a verdict that names `legal@0.5.3` or earlier replays under that
rule, byte for byte. On the readers' own briefs it moves 17 answers (the buyer's: d4, d11, d12, o1, o4, o6, o8; the ninth round's: L05,
D01 to D09), and none of the eight earlier readers' 127.

- **"(quoting …)" and "(citing …)" after the quoted words (2026-10-14).** Written in the quotation field or after the citation, the
  parenthetical is the brief's own disclosure: never compared as words, and the PASS names the source "as the citation says". The buyer's
  brief3.json: 1 PASS / 2 FAIL under 0.5.3 ("the quotation adds "(quoting"), 3 PASS under 0.5.4; brief4.json (the citation field) 1 PASS
  under both.
- **The first letter (2026-10-14).** A changed case of the quotation's first letter, or the first after an ellipsis, with no bracket answers
  can't tell naming the bracket to write ("[s]ummary"), with a remedy (`missing: ['letter_case']`); 0.5.3 passed it with a note. A letter
  in a bracket and a change the quotation discloses still pass.
- **An ellipsis over a part of a condition (2026-10-14).** When the omitted stretch opens with "and", "or" or "nor" and the clause before
  it states a condition ("tolled where the injury is inherently unknowable . . . , but" for "… unknowable and the plaintiff is blamelessly
  ignorant of it, but"), can't tell: the condition reads broader or narrower than the text's. An ellipsis over a whole "not X, but"
  contrast keeps what the text asserts and passes with a note.
- **The negation's clause (2026-10-14).** It ends at a semicolon, a colon, "but", or a comma before "and", "or", "nor", "yet", "so", and not
  before ", and that" or ", or that" (the blind set's "We do not decide today that X, that Y, or that Z" keeps its hold). Three genuine
  quotations after ", and" PASS; 0.5.3 held them "preceded by a negation the quote omits".
- **A headnote-marked sentence, a filing as speaker, the court judging a rule (2026-10-14).** A sentence that opens on a headnote marker
  ("HN2[ ]", "[2]") is the court's own statement and carries no view from the sentence before it; "Tamberly's brief states that" and "the
  reply brief argues that" open a party's view; "That rule no longer holds." and "The Court disagrees." are the court speaking again.
- **Six designation styles (2026-10-14).** "Dissenting Opinion by Judge Molina", "Judge MOLINA, dissenting.", "MOLINA, J. (dissenting):",
  "MOLINA, J., dissents and votes to reverse in the following opinion:", "MOLINA, Circuit Judge, dissenting from the denial of rehearing en
  banc:", "I respectfully dissent." each end the majority; the ninth round's probe of twelve styles and twelve lead-ins answers 0 PASS /
  24 can't tell (7 PASS under 0.5.3).
- **Database numbers (2026-10-14).** "2025 WL 1188234" and "2024 U.S. Dist. LEXIS 48213" are read as a caption's citation line and off a
  written citation ("Calloway Precision, Inc. v. Northgate Components Corp., 2025 WL 1188234, at *3 (D. Minn. Apr. 18, 2025)"); the
  ninth round's nine quotations against the Calloway order are checked (0.5.3: "no supplied text matched" for all nine).

## Legal rule 0.5.3: separate opinions with a join clause, a view across sentences, quotations within the opinion, running headers, citation clauses (2026-10-13; the default from engine 0.7.1; docs/LEGAL.md, docs/LEGAL-TEXT.md)

Two cold readers (AI agents reading the pack as a legal-operations director, with no prior work on this tree; cold review rounds
7 and 8, on 2026-10-06 and 2026-10-12) found a dissent read as the majority's when its designation carries a join clause,
party positions passing after lead-ins the reader did not list, a party's view passing "verbatim" in the sentence after "In his
view, …", another court's holding and a retired standard the opinion quotes passing as the Court's, and two false FAILs on
genuine quotations whose remedy told the writer to change a correct quotation. The fixes are a new ruleset version,
`legal@0.5.3`, the default for a new legal verdict from engine 0.7.1, chosen by LEGAL.md's stated rule: it ties `legal@0.5.2`
on half B, closes the false-PASS classes the readers found, and gives every outcome `legal@0.5.2` gives on both blind sets (40
of 40, 58 of 58). Engines 0.6.0 and 0.7.0 keep `legal@0.5.2` as their default, and a verdict that names `legal@0.5.2` or earlier
replays under that rule, byte for byte. `legal@0.5.3` is gated on engine 0.7.1.

- **A separate opinion's designation (2026-10-13).** Whatever stands between the author and the role is read, so long as it
  holds no sentence end: "Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV, dissenting.", "joins as to
  Parts I and II, concurring in part and dissenting in part.", "joins as to all but Part II-B, dissenting.", "joined by …". A
  line shaped like a designation always starts a separate opinion. The opinion is named by its role as printed ("Justice
  Stevens's opinion concurring in the judgment and dissenting in part", never "concurring in part and dissenting in part").
  Under `legal@0.5.2` 6 of 13 styles were not read and the dissent's words passed "Found in the majority opinion"; all 13 now
  answer can't tell, naming the dissent, and the majority's words still pass.
- **The lead-in, read with its verb's inflections and the words after it (2026-10-13).** A request of the court ("Bravo asks us
  to hold that", "urges us to", "would have us"), the court told ("We are told that"), a sentence that opens on another's view
  ("According to Bravo,", "In Bravo's view,", "Under the rule Bravo proposes,"), a position named by its noun and holder
  ("Bravo's position is that"), quoted or attributed matter ("relying on Conley's statement that", "the familiar statement
  that"), and a verb that governs coordinated that-clauses ("held (1) that …, and (2) that, in that circumstance,") are reported
  speech. The court's own ("In our view,", "According to the statute,", "Under the rule we adopt today,", "Our position is
  that") is not. The answer says "found as a party's position, not the court's" (or another court's words, a separate opinion's
  view, someone else's position).
- **The view runs on (2026-10-13).** A sentence that introduces another's view makes the sentences after it, in its paragraph,
  that view's until the court speaks again ("We disagree.", "That reading is foreclosed", "It is true that", a new paragraph):
  the middle sentence of "In his view, the general discovery rule should apply. A statute of limitations … discovers the
  violation. We disagree." answers can't tell; `legal@0.5.2` passed it "verbatim". A quotation that begins where its sentence
  begins prints the sentence before it beside its PASS.
- **A quotation within the opinion (2026-10-13).** Words inside the opinion's own quotation marks PASS with a notice naming the
  source ("It is a quotation within the opinion, attributed to the Ninth Circuit; the brief should say (quoting Smith v.
  Jones)"), and FAIL when one of the next two sentences rejects them: Conley's "no set of facts" standard, quoted in Twombly
  after "relying on Conley's statement that", answers "the court rejected this standard: line 37: "We could go on, …"". Its
  remedy says to quote the standard the court adopts, never to conform the quotation.
- **A running header's parallel citations, read by their shape (2026-10-13).** "127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337,
  2007-1 Trade Cases P 75,709", "2007-1 Trade Cas. (CCH) ¶ 75,709" and a Westlaw number are read as a line of parallel
  citations next to a vendor's line; a genuine quotation across such a page break PASSes. `legal@0.5.2` FAILed it, its remedy
  quoting the header's citations as the passage.
- **"(citations omitted)" over a citation clause (2026-10-13).** A citation set off inside a sentence ("…, ibid.; Sanjuan v.
  American Bd. of Psychiatry and Neurology, Inc., 40 F.3d 247, 251 (C.A.7 1994), a plaintiff's …"; ", see Twombly, 550 U.S., at
  570,"; a string of them) is excused like a citation sentence, with or without the commas around it; left out silently, it
  FAILs naming the citation, with the remedy "(citation omitted)". A citation sentence's start no longer takes "The notice must
  be written, cf. Smith v. Jones, …" for a case name.
- **A FAIL never rests on furniture alone (2026-10-13).** A passage that differs from the quotation only by words shaped like a
  citation or a page's running header answers can't tell, with the printed page or "(citation omitted)" as its remedy, never
  "Conform the quotation to the passage".
- **A negation up to "but", and sentence ends (2026-10-13).** The negation guard reads its clause only after the last "but",
  so Twombly's "enough facts to state a claim to relief that is plausible on its face", after "we do not require heightened fact
  pleading of specifics, but only", PASSes with its lead-in printed. A period before a small letter ends no sentence ("American
  Bd. of Psychiatry"), so a printed continuation is never cut there; a continuation is printed up to 400 characters.
- **The pages (2026-10-13).** `docs/LEGAL.md` is the manual for the current rule, under 500 lines; the record it carried for
  each earlier rule is below, verbatim, under "LEGAL.md's record". `docs/LEGAL-TEXT.md` names the rule and the parallel-citation
  lines.
- **What moved.** On the cold readers' own briefs (461 checks over seven rounds) 26 answers move, every one a case above: the
  seventh reader's 16 and the eighth reader's 10 (tables below). No answer of the five earlier readers moves. On both blind sets
  every outcome is unchanged; the wording of 3 genuine PASSes changed (two print the sentence before them, one names a quotation
  within the opinion). Three changes followed runs on the readers' own briefs before this entry was written: nouns that are
  legal terms ("complaint", "claim") were taken off the list of nouns that name a party's position, after "Second, only a
  complaint that states a plausible claim …" was read as one (the fourth reader's W30, the seventh's I05); a party's verb opens a
  view only with "that" or a colon after it, after "fair notice of the claim," was read as the verb (the seventh reader's T15);
  and "It is true that", "Of course" and the like were read as the court's voice, after the seventh reader's genuine I09 was
  held.

### LEGAL.md's record, moved here (2026-10-13)

Until 2026-10-13 `docs/LEGAL.md` carried, beside the rules, the record of every earlier rule. It is kept here word for word,
under the names its sections had there; BENCH.md cites some of them by those names. "Below" and "above" in it refer to the page
it was written for.

#### Changelog (each rule against the one below it)

**Changelog.** Each entry is what that rule added to the one below it, and why an earlier rule is not for filing: each
passes or FAILs a quotation the next one answers correctly. Every rule but `legal@0.0.1`, `0.1.0` and `0.2.0` needs engine
0.6.0.

- **`legal@0.5.2`** (2026-10-06, later that day; current). A quotation that begins in the middle of its sentence is never
  called "verbatim": its PASS prints how the sentence begins, and when those words report someone else's position or frame
  what follows (a party's argument, a dissent's view, another court's statement, a counterfactual, a rejected reading, a
  question), it answers can't tell, naming them. A lead opinion that is a plurality is named "the lead opinion", and a PASS
  in a plurality part says so. A Westlaw PDF's page footers and running headers and a Lexis "HN4[ ]" marker are read out; a
  KeyCite flag at the head of a download is not read as its caption, and the "All Citations" lines at its end name the
  text. A FAIL never lists words an ellipsis stands for. A replay of a legal verdict no longer prints an evidence floor.
- **`legal@0.5.1`** (2026-10-06; do not use for filing). A quotation that stops before its sentence ends is never called
  "verbatim": its PASS prints how the sentence continues, and a continuation that limits or negates the quoted words answers
  can't tell (a closing ellipsis over one too); a fragment presented as a whole sentence is said to be one. Em dashes, en
  dashes and "--" are one dash. "(citation omitted)", "(citations omitted)", "(cleaned up)", "(footnote omitted)", "(internal
  quotation marks omitted)" and "(alteration in original)" excuse what they name, in the quotation or after the citation, and
  the PASS says what. Westlaw headnote numbers between sentences are read out; a sentence ends after a number. A FAIL names
  the punctuation that differs, an inserted bracket, a citation left out without saying so, and words joined from passages
  too far apart. A can't tell on a footnote call never asks for an edited download. It passes "the statute of limitations was
  tolled." from "The dissent maintains that the statute of limitations was tolled." as "verbatim", and so a party's argument,
  a lower court's statement and a counterfactual the opinion reports; it calls a plurality part "the majority opinion"; it
  FAILs a genuine quotation across a Westlaw PDF's page break or a Lexis "HN4[ ]" marker; and it takes a KeyCite flag line
  for a download's caption.
- **`legal@0.5.0`** (2026-10-05; do not use for filing). The sections of the text, so words found only in editorial matter or a
  separate opinion answer can't tell; every PASS says where it matched; a citation looked up by its reporter citation with the
  pin page, case name and parenthetical read off; a Lexis header's "Reporter" block bound; every footnote-call form not read
  out answers can't tell, never FAIL. It passes a quotation cut before its sentence goes on "is inapplicable to legal
  conclusions" as "verbatim", and FAILs an em dash against a download's "--" and a citation left out under "(citation omitted)".
- **`legal@0.4.0`** (2026-10-05; do not use for filing). A quotation that begins mid-sentence read for a condition or negation
  cut off before it; star paging and footnote numerals read out; a named passage as whole sentences, with the words that differ;
  a short form read as a pin cite to the brief's own full citation. It passes words from a headnote, the syllabus or a dissent
  as the opinion's, FAILs a genuine quotation across a Lexis "n7" footnote call, and finds no text for a full citation with a
  pin.
- **`legal@0.3.0`** (2026-10-05; do not use for filing). The text bound by its caption; a parties-only binding left open, never
  PASS; a condition cut off at the start or end of a quotation by an ellipsis or a capital; letter case compared. It passes a
  lowercase quotation that begins after "Unless …," and FAILs a genuine quotation of a text that carries star paging.
- **`legal@0.2.0`** (2026-10-03; do not use for filing). A meaning guard: a bracket that changes a word FAILs; an ellipsis
  over a condition word and dropped inner quotation marks answer can't tell. It binds a text that merely cites the case, and
  passes a parties-only binding.
- **`legal@0.1.0`** (2026-10-03; do not use for filing). Quotation conventions: brackets, ellipses, quotation marks, "(cleaned
  up)", trailing punctuation. It passes a bracket that swaps a word.
- **`legal@0.0.1`** (do not use for filing). The quotation as a normalised string; the default under engines before 0.6.0. It
  binds a text that merely cites the case.

#### How the default is chosen: each time it was applied

**Applied on 2026-10-06, later that day.** The default moved from `legal@0.5.1` to `legal@0.5.2`:

- **Rule 1.** They tie on half B: 0 of 10 known-bad quotations passed, upper bound 27.8%.
- **Rule 2.** They tie: 1 of 10 genuine quotations failed.
- **Rule 3.** `legal@0.5.2` closes the false-PASS class the fifth cold reader found: words the opinion reports or frames,
  quoted as its own. "the statute of limitations was tolled." from "The dissent maintains that …", and the same cut after
  "Appellant argues that", "It would be a mistake to conclude that" and "Were we writing on a clean slate, we might hold
  that", passed under `legal@0.5.1`, each as "verbatim"; so did Daubert's report of the overturned lower-court standard ("the
  court stated that expert opinion … is inadmissible unless …"). Under `legal@0.5.2` each answers can't tell, naming the
  words before it. On both blind sets it gives the same outcome as `legal@0.5.1` on every item (40 of 40; 58 of 58), so it
  costs nothing on genuine quotations there: 4 of 10 passed on half B. The wording of 14 genuine PASSes changed: each now
  prints how its sentence begins, and 8 of them were "verbatim" (4 on half B, 10 on the first set).

`legal@0.5.2` took the default for that reason. On the cold readers' own briefs (334 checks over five rounds) it moves 14
answers, each named in "Cold readers' adversarial briefs": the fifth reader's 13, and the fourth reader's party argument
quoted as a holding ("Respondent contends that …"), which that reader built to pass and which now answers can't tell.

**Applied on 2026-10-06.** The default moved from `legal@0.5.0` to `legal@0.5.1`:

- **Rule 1.** They tie on half B: 0 of 10 known-bad quotations passed, upper bound 27.8%.
- **Rule 2.** They tie: 1 of 10 genuine quotations failed.
- **Rule 3.** `legal@0.5.1` closes the false-PASS class the fourth cold reader found: a quotation cut where its sentence goes on
  to negate or limit it. "a court must accept as true all of the allegations contained in a complaint", from a sentence that
  goes on "is inapplicable to legal conclusions", passed under `legal@0.5.0` in four forms (as cut, with a closing ellipsis,
  as "[A] court must accept … complaint.", and as "… but it does", before "not unlock …"), two of them as "verbatim". Under
  `legal@0.5.1` all four answer can't tell, printing the continuation. On half B it gives the same outcome as `legal@0.5.0` on
  all 20 items; on both halves, on all 40; on the first blind set (each text given a caption line), on all 58. So it costs
  nothing on genuine quotations there: 4 of 10 passed on half B, as under `legal@0.5.0`. On the first set the wording of two
  genuine PASSes changed: one prints how its sentence continues, one says it presents part of a sentence as a whole one.

`legal@0.5.1` took the default on 2026-10-06 for that reason. On the cold readers' own briefs (243 checks over four rounds;
some briefs were run against two texts) it moves 15 answers, each named in "Cold readers' adversarial briefs", and one of
them is a quotation that reader counted as genuine: a cut before ", but it does not unlock the doors of discovery …", which
now answers can't tell.

**Applied on 2026-10-05, four times.** The default moved from `legal@0.0.1` to `legal@0.2.0` on the strength of the blind
number below. Later the same day it moved to `legal@0.3.0`, then to `legal@0.4.0`, then to `legal@0.5.0`:

- **Rule 1.** `legal@0.0.1`, `0.2.0`, `0.3.0`, `0.4.0` and `0.5.0` tie on half B: 0 of 10 known-bad quotations passed, upper
  bound 27.8%. `legal@0.1.0` is out (2 of 10, upper bound 51.0%).
- **Rule 2.** `legal@0.2.0`, `0.3.0`, `0.4.0` and `0.5.0` tie: 1 of 10 genuine quotations failed. `legal@0.0.1` is out (3 of
  10).
- **Rule 3, for `legal@0.3.0`.** It closes two false-PASS classes the first cold reader found: a later opinion's text that
  cites the case, and a condition cut off at a quotation's edge by an ellipsis or a capital. On half B it gives every outcome
  `legal@0.2.0` gives.
- **Rule 3, for `legal@0.4.0`.** It closes the false-PASS class the second cold reader found: a quotation that begins in
  lowercase in the middle of a sentence after "Only", "Unless …,", "Except …,", "If …," or "Absent …,", which `legal@0.3.0`
  passed as "verbatim". Its rows are published below. On half B it gives the same outcome as `legal@0.3.0` on 19 of 20 items.
  The one that moves is a genuine quotation that moves from PASS to can't tell: "that a more just and humane system could not
  be devised", quoted from "We do not decide today that the Maryland regulation is wise, … or that a more just and humane
  system could not be devised." The new guard reads the "not" before it. Genuine quotations passed go from 5 of 10 to 4 of 10
  (23.7% to 76.3%, and 16.8% to 68.7%): within the interval, and printed here as the rule asks.

`legal@0.4.0` took the default on 2026-10-05 for that reason: it closes a false-PASS class a cold reader found, ties
`legal@0.3.0` on known-bad quotations passed and on false FAILs, and gives one genuine quotation to a person instead of passing
it.

- **Rule 3, for `legal@0.5.0`.** It closes the false-PASS class the third cold reader below found: words from West headnotes,
  the West synopsis, the syllabus, a Lexis headnote, or a dissent, quoted as the opinion's, which `legal@0.4.0` passed (three of
  them as "verbatim"). Its rows are published below. On half B it gives the same outcome as `legal@0.4.0` on all 20 items, and
  on both halves on all 40; on the first blind set (each text given a caption line) on all 58. So it costs nothing on genuine
  quotations: 4 of 10 passed on half B, as under `legal@0.4.0`.

`legal@0.5.0` took the default on 2026-10-05 for that reason: it closes a false-PASS class a cold reader found and ties
`legal@0.4.0` on every half-B number.

#### The named passage, and engine 0.6.0's wording

Under engine 0.6.0, every rule names a passage on a FAIL only on a match of four or more consecutive words, and says what
the supplied text reads, never what "the opinion" says. An invented quotation answers can't tell as possibly fabricated. One
consequence to know: a short misquote that shares fewer than four consecutive words with the text ("probable on its face"
for "plausible on its face") now answers can't tell as possibly fabricated instead of FAILing. Three shared words are too few
to tell the passage it corrupts from a coincidence, and an earlier rule that named a passage on three words told users to
"conform" their quotation to unrelated sentences. Quote a few more words and the misquote FAILs, showing the passage.

**The named passage.** Under `legal@0.4.0` a named passage is whole sentences: it opens at the start of the sentence that
holds the first word the quotation shares with the text, and closes at the end of the sentence that holds the last (read up to
600 characters either way; a longer sentence is cut there). It is shown with page marks left out and a line-break hyphen
joined, and a FAIL names the words that differ: "Where they differ: the text has "30" where the quotation has "60"." A FAIL
on a bracket that changes a word shows whole sentences the same way. Under `legal@0.0.1` to `0.3.0`, a named passage carries
two words of margin either side, cut where a margin crosses a sentence end. It can still close mid-sentence ("… and the"), or
open on a caption line or on a word with a footnote numeral glued to it, and a verdict issued under those rules keeps the
passage it printed, because replay re-performs it byte for byte. Under `legal@0.4.0` and `0.5.0` a named passage could open on
the citation sentence before it ("Id., at 556, 127 S.Ct. 1955. The plausibility standard …") or on a Westlaw headnote number
("[9] Second, …"). Under `legal@0.5.1` a sentence ends after a number, and headnote numbers are read out, so it opens at its own
sentence. A `legal@0.5.1` FAIL also names punctuation that differs ("the text has a comma after "action" that the quotation
leaves out"), shows a long run of differing words by its ends and its count, punctuation kept, and says so when a quotation
leaves out a citation sentence without an ellipsis or "(citation omitted)", or joins words from passages farther apart than an
ellipsis is read for ("its ellipsis would stand for 1646 characters of the text, from line 59 to line 61, more than the 600 an
ellipsis is read for, so it joins two passages"). A bracket that inserts a word is answered by removing it: "Remove the inserted
[only]".

#### Cold readers' adversarial briefs (AI agents, not people)

**The first.** On 2026-10-05 a cold reader, an AI agent in the role of the legal-operations director of a regional firm,
that had not worked on this tree, ran 26 citations against seven short opinion excerpts it typed from memory. The excerpts
test the check's mechanics, not the law. The same inputs, re-run on this build under the default binding (the wrong-opinion
row includes one citation run with `--bind parties`):

| category | `legal@0.2.0`: caught | `legal@0.3.0`: caught | `legal@0.4.0`: caught |
|---|---|---|---|
| invented, near-invented, stitched, no text, another case's quotation | 5 of 5 | 5 of 5 | 5 of 5 |
| a bracket that flips the meaning | 5 of 5 | 5 of 5 | 5 of 5 |
| a later opinion's text that cites the right case (Cooper v. Aaron supplied for Brown, and for Marbury) | 0 of 3 | 3 of 3 | 3 of 3 |
| an ellipsis or a bracketed capital that drops a condition (forms tested: an ellipsis at the start, at the end and inside, and a bracketed capital; not a lowercase start, see below) | 1 of 6 | 6 of 6 | 6 of 6 |

"Caught" means the answer was not PASS. The same brief's genuine quotations behave as before under all three rules, and
`legal@0.4.0` gives every outcome `legal@0.3.0` gives on all 26. `legal@0.5.0` gives every outcome `legal@0.4.0` gives on
all 26, and on all 15 of the same reader's further citations (the parallel-form, parties-only and negation briefs):

- the control passes;
- one benign ellipsis passes;
- the benign ellipsis whose omission includes "if any" answers can't tell;
- a quotation that starts right after "fails to make a showing …" answers can't tell under the negation guard.

**The second.** Later that day a second cold reader, another AI agent in the same role that had not worked on this tree,
ran six briefs of its own against excerpts it typed from memory or invented. They test mechanics, not the law, and their
Westlaw and Lexis headers are mock-ups from memory.

| what the reader tried | `legal@0.3.0` | `legal@0.4.0` |
|---|---|---|
| a lowercase quotation that begins after "Only", "Unless …,", "Except …,", "If …," or "Absent …," | 5 of 5 PASS ("verbatim") | 5 of 5 can't tell, each naming the cut |
| the same cut with a bracketed capital ("[T]he motion …") | 2 of 2 can't tell | 2 of 2 can't tell |
| a genuine quotation across star paging (`*248`, `[*249]`) or a footnote numeral (`counted.4`) | 3 of 3 FAIL | 3 of 3 PASS, naming what was read out |
| an altered quotation (a dropped "not" or "never", "will" to "may", "30 days" to "60 days", "§ 1983" to "§ 1985", a dollar figure, a Cyrillic letter, a swapped word order, an inserted word, a changed noun) | 11 of 11 FAIL | 11 of 11 FAIL, each naming the words that differ |
| a short form ("477 U.S. at 248") with the full citation elsewhere in the brief | can't tell ("does not print the reporter citation 477 U.S. at 248") | PASS, read as a pin cite to 477 U.S. 242 |
| "Id." | can't tell (the same words) | can't tell: "short form; supply the full citation" |
| a Lexis-style header, the citation five lines below the case name | can't tell ("the text cites it in its body") | can't tell, naming the line and the caption window |

Two more of that reader's quotations, which drop the "Neither do we suggest that …" before "the trial court may not deny
summary judgment", passed under `legal@0.3.0` and answer can't tell under `legal@0.4.0`.

`legal@0.5.0` gives every outcome `legal@0.4.0` gives on that reader's 44 citations but one: the genuine quotation under the
Lexis-style header now PASSes, because the line after the header's "Reporter" heading binds (see "Binding the text to its
cite").

**The third.** Later that day a third cold reader, another AI agent in the same role that had not worked on this tree, ran
42 citations against a Westlaw-shaped text (with its synopsis, West headnotes and syllabus, and in one copy a dissent) and a
Lexis-shaped text (with its header, core terms, case summary and LexisNexis headnotes). Both are mock-ups typed from memory;
they test mechanics, not the law.

| what the reader tried | `legal@0.4.0` | `legal@0.5.0` |
|---|---|---|
| words from the West headnotes, the West synopsis or syllabus, or a Lexis headnote, quoted as the opinion's | 3 of 3 PASS (2 "verbatim") | 3 of 3 can't tell, naming the section and line ("the quoted words appear in the West headnotes (line 17), not in the opinion") |
| words from a dissent quoted as the opinion's | 2 of 2 PASS ("verbatim") | 2 of 2 can't tell: "the quoted words appear in Justice Brennan's dissent (line 27), not in the majority opinion" |
| a genuine quotation across a Lexis `n7` footnote call | FAIL, the remedy quoting "n7" | can't tell, naming "n7" |
| a genuine quotation across `FN6` or `[4]` | 2 of 2 can't tell | 2 of 2 can't tell |
| a full citation with a pin ("477 U.S. 242, 248"), a wrong pin page, the Bluebook form with case name and year | 3 of 3 can't tell ("No opinion text") | 3 of 3 PASS, each saying "The pin page … is not checked" |
| the parallel citation "106 S. Ct. 2505", sources keyed "477 U.S. 242" | can't tell ("No opinion text") | can't tell, listing what was looked for and the texts supplied |
| eight citations of a Lexis text as delivered, the citation line five lines below the case name after "Reporter" | 8 of 8 can't tell (checked only after the text was edited) | checked without an edit: 3 PASS, 1 FAIL, 4 can't tell (the Lexis headnote, `[4]`, an elided condition, dropped inner quotation marks) |
| altered or unresolvable quotations (a dropped "not" or "mere", "may" to "[must]", a lowercase start after "Only", an ellipsis over "after adequate time for discovery and upon motion", a stitched quotation, a synonym, Rule 56(c) to 56(e), a Cyrillic letter, short forms that cannot be resolved, a near fabrication) | 0 of 17 PASS | 0 of 17 PASS |

Every PASS under `legal@0.5.0` says where it matched ("Found in the majority opinion, line 23 (character offset 2119).").
One documented limit stood: a quotation that stops just before ", after adequate time for discovery and upon motion" passed.
Under `legal@0.5.1` it answers can't tell, printing the continuation.

**The fourth.** Later that day a fourth cold reader, another AI agent in the same role that had not worked on this tree, ran 57
citations against a Westlaw-shaped and a Lexis-shaped text of Ashcroft v. Iqbal. Both are mock-ups it typed; they test
mechanics, not the law.

| what the reader tried | `legal@0.5.0` | `legal@0.5.1` |
|---|---|---|
| exact words cut so the meaning reverses: "a court must accept as true all of the allegations contained in a complaint", where the sentence goes on "is inapplicable to legal conclusions" (as cut, with a closing "...", as "[A] court must accept … complaint."), and "… but it does", before "not unlock …" | 4 of 4 PASS (2 "verbatim") | 4 of 4 can't tell, each printing the continuation ("the cut ends before a limitation") |
| a quotation that stops before ", but it does not unlock the doors of discovery …" (the reader counted it genuine) | PASS ("verbatim") | can't tell, printing the continuation |
| an internal citation sentence left out under "(citation omitted)", "(citations omitted)" or "(cleaned up)" | 3 of 3 FAIL | 3 of 3 can't tell: the citation is read as left out, and each quotation also stops before ", but it does not unlock …". The same quotations taken to the end of their sentence PASS, naming the citation left out |
| an em dash in the brief where the Lexis text prints "--" | FAIL | PASS: "dashes read as one" |
| a genuine quotation across a Westlaw headnote number "[9]" | can't tell | PASS: "read with a headnote number ignored ([9])" |
| a genuine quotation across a Lexis "n3" call, a majority footnote printed after the dissents, a parallel citation, "Id." | 4 of 4 can't tell | 4 of 4 can't tell; with "(footnote omitted)" the "n3" quotation PASSes, naming the call |
| a changed word (12 kinds, including "(cleaned up)" over a dropped "mere"), a quotation from editorial matter or a dissent (9), a fabricated quotation or a wrong case name (2), an ellipsis over a negation (3) | 0 of 26 PASS | 0 of 26 PASS. The FAILs name the commas that differ ("the text has a comma after "action" that the quotation leaves out"), say "Remove the inserted [only]", and name a stitch across paragraphs instead of listing the 60 words between |
| a citation sentence left out with no ellipsis or parenthetical; a quotation that begins mid-sentence after "But where … misconduct," | FAIL (a partial match); can't tell | FAIL naming the citation left out; can't tell |
| a party's argument the opinion reports, quoted as the holding | PASS ("verbatim") | PASS ("verbatim"); under `legal@0.5.2`, can't tell: "reported speech: the words follow "Respondent contends that"" |
| the other genuine quotations (plain, Bluebook form, short form, dissent with its parenthetical, star paging, glued footnote numeral, a non-breaking space, the opinion's own "[s]", "(emphasis added)") | 14 of 14 PASS | 14 of 14 PASS; three of them now also print how their sentence continues (one of them was "verbatim") |

Its `legal@0.5.1` answers also say "can't tell" where `legal@0.5.0` said "abstaining", and a can't tell on a footnote call no
longer asks for an edited copy of the download.

On the earlier readers' briefs, `legal@0.5.1` moves three more quotations, all from PASS to can't tell, each a cut before a
limitation the reader built on purpose: the first reader's "… of law violation", before "except where such advocacy is
directed to inciting …"; the second reader's quotation that stops before "insufficient; there must be evidence …"; and the
third reader's that stops before ", after adequate time for discovery and upon motion, against a party who fails …" (in three
folders).

**The fifth.** Later that day a fifth cold reader, another AI agent in the same role that had not worked on this tree, ran 91
checks: a Westlaw-shaped text of Daubert v. Merrell Dow Pharmaceuticals, Inc., a copy turned out of a PDF with its page
furniture left in, a copy that opens on its KeyCite flag, a Lexis-shaped copy, a short invented opinion of cuts and lead-ins,
and an invented plurality. It wrote and sealed its expected answers for the 46-citation Westlaw brief before the first run.
All are mock-ups it typed; they test mechanics, not the law.

| what the reader tried | `legal@0.5.1` | `legal@0.5.2` |
|---|---|---|
| words the opinion reports or frames, quoted from after "The dissent maintains that", "Appellant argues that", "It would be a mistake to conclude that", "Were we writing on a clean slate, we might hold that", "Respondent moved for summary judgment, contending that", or Daubert's "the court stated that" before the overturned lower-court standard | 6 of 6 PASS (4 "verbatim") | 6 of 6 can't tell, naming the words: "reported speech", "rejected reading" or "counterfactual" |
| a quotation from Part III of a lead opinion that is the Court's only as to Parts I and II | PASS, "Found in the majority opinion" | PASS, "Found in Part III of the lead opinion …: a plurality opinion, not an opinion of the Court" |
| a genuine quotation across a Westlaw PDF's page footer and running header | 2 of 2 FAIL | 2 of 2 PASS, naming the footer read out |
| five citations of a download that opens on its KeyCite flag | 5 of 5 can't tell, the text named "Declined to Extend by Nease v. Ford Motor Co." | the caption read as Daubert v. Merrell Dow Pharmaceuticals; the four citations to 509 U.S. 579 checked by the "All Citations" line (3 PASS, 1 FAIL on a dropped "not"); the parallel citation can't tell, as before (no text keyed by it) |
| a Lexis "HN4[ ]" marker: a two-sentence quotation across it, and quotations that begin right after one | 1 FAIL ("the quotation leaves out "HN4[""); 2 PASS saying "it presents part of a sentence as a whole one" | 3 PASS, with no such note |
| an ellipsis over "of course," with "solely" dropped, under "(cleaned up)" | FAIL, naming "of course," and "solely" as left out | FAIL, naming "solely" only |
| the reader's altered quotations and its words from the wrong part of the opinion | none PASS | none PASS |
| its other genuine quotations | all PASS | all PASS; the two that begin inside their sentence print how it begins, and no longer say "verbatim" |

On its sealed 46-citation brief, `legal@0.5.2` matches the reader's sealed expectations on 44 and moves two on purpose: the
lower court's reported standard, which the reader expected to PASS as a "documented gap … malpractice-grade risk", and a
party's contention the opinion reports ("Respondent moved for summary judgment, contending that"), also expected to PASS
as a documented gap. Both now answer can't tell. Its two cuts before an unread limitation ("barring a genuine dispute", "to
a limited degree") still pass with the continuation printed, as "Known limits" says.

**The seventh.** On 2026-10-06 a seventh cold reader, another AI agent in the same role that had not worked on this tree, ran 55
citations against Westlaw-, Lexis- and public-archive-shaped mock-ups it typed (Twombly, Iqbal, Daubert, Asahi, Concepcion,
Celotex, Rotkiske), five designation styles and twelve lead-ins. They test mechanics, not the law. Against its own written
expectations (`expect.json`), the 55-citation brief agreed on 46 of 54 under `legal@0.5.2` and on 52 of 54 under `legal@0.5.3`;
known-bad quotations passed: 3 of 36, then 0 of 36; genuine: 13 PASS, 1 FAIL, 4 can't tell, then 16 PASS, 0 FAIL, 2 can't tell.

| what the reader tried | `legal@0.5.2` | `legal@0.5.3` |
|---|---|---|
| a dissent whose designation carries a join clause, quoted as the holding (Twombly's own designation, and probe styles DS1, DS4, DS5) | 4 of 4 PASS, "Found in the majority opinion" | 4 of 4 can't tell, naming the dissent |
| the plain forms (DS2 "with whom … joins, concurring in part and dissenting in part"; DS3 "concurring in part and concurring in the judgment") | 2 of 2 can't tell | 2 of 2 can't tell |
| a genuine quotation of that dissent under "(Stevens, J., dissenting)" | can't tell: the text marks no such opinion | PASS, "as the citation says" |
| twelve party or court positions after a lead-in ("asks us to hold that", "would have us", "According to Bravo,", "Bravo's position is that", "In Bravo's view,", "We are told that", "Under the rule Bravo proposes,", and five forms `legal@0.5.2` read) | 7 PASS, 5 can't tell | 12 of 12 can't tell; the court's own holding (the control) PASS |
| "Rotkiske urges us to read a discovery rule into the provision" | PASS | can't tell |
| a genuine quotation across a Westlaw page break whose header carries "2007-1 Trade Cases P 75,709" | FAIL | PASS |
| Conley's standard after "relied on the familiar statement that", which the next sentence retires | PASS | FAIL, "the court rejected this standard" |
| "enough facts to state a claim to relief that is plausible on its face", after "we do not require …, but only" | can't tell, "a negation the quote omits" | PASS, its lead-in printed |
| "[A] formulaic recitation of the elements of a cause of action will not do." (a "not" in an earlier clause); Daubert's "That austere standard . . . should not be applied" (an ellipsis over "absent") | 2 of 2 can't tell | 2 of 2 can't tell, as "Known limits" says |

**The eighth.** On 2026-10-12 an eighth cold reader, another AI agent in the same role that had not worked on this tree, ran 36
quotations (23 altered or misattributed the way a careless or dishonest associate would, 12 genuine, one it marked uncertain)
against a Westlaw PDF-shaped Twombly, a Lexis-shaped Celotex and public-archive layouts of Bazzle, Rotkiske and Daubert, then 8
variants and 8 designation styles. They test mechanics, not the law. On the 36: altered quotations not passed, 19 of 23 under
`legal@0.5.2`, 23 of 23 under `legal@0.5.3`; genuine, 9 PASS, 2 FAIL, 1 can't tell, then 11 PASS, 0 FAIL, 1 can't tell (a short
form that drops the "not" before "nudged their claims across the line").

| what the reader tried | `legal@0.5.2` | `legal@0.5.3` |
|---|---|---|
| eight separate-opinion designation styles, the separate opinion's words quoted without a parenthetical | 3 PASS, "Found in the majority opinion" (the join-clause styles); 5 can't tell | 8 of 8 can't tell, naming the opinion; in each text the majority's words PASS |
| Twombly's dissent quoted as the holding (T06) | PASS, "Found in the majority opinion" | can't tell, "Justice Stevens's dissent" |
| Conley's retired standard after "relying on Conley's statement that" (T05) | PASS | FAIL: "the court rejected this standard: line 37: …" |
| the South Carolina Supreme Court's holding after "held (1) that …, and (2) that, in that circumstance," (B02) | PASS | can't tell, "found as another court's words, not the court's" |
| a party's view in the sentence after "In his view, …" (R01) | PASS, "verbatim" | can't tell, "found as someone else's position, not the court's" |
| a genuine quotation across a page break whose header carries "75 USLW 4337, 2007-1 Trade Cases P 75,709" (T08) | FAIL, "Conform the quotation to the passage" | PASS, the footer and header read out |
| "(citations omitted)" over "ibid.; Sanjuan v. …", after the citation and in the quotation (T11, V2) | 2 of 2 FAIL | 2 of 2 PASS, naming the citation left out |
| the same clause left out with no parenthetical (T10) | FAIL, naming words left out | FAIL, naming the citation left out; remedy "(citation omitted)" |
| its other altered quotations (changed words, dropped conditions, headnotes, footnotes, dissents with no join clause, an invented authority) | none PASS | none PASS |

#### Which blind rows are post-hoc, and why

**The `legal@0.3.0`, `legal@0.4.0`, `legal@0.5.0`, `legal@0.5.1` and `legal@0.5.2` rows are not blind.** The three rows under
them ran once, together, as the preregistration requires. The preregistration's own slot for a "0.3.0" was a set of 0.2.0's
limits tuned on half A. Tuning moved no limit, so that candidate never existed. The `legal@0.3.0` shipped here is a different
change, built after these numbers were published and not tuned on this set. It was run on half B afterwards, under the
preregistration's scoring. A note saying so was hashed before the run: sha256
`6e6cf86f7a46233fc302ff8d0ddff32b9343a51330cde1b60e0a245a3b358dad`, at 2026-10-05T17:50:39Z. Half B's outcomes were known by
then. It gives every outcome `legal@0.2.0` gives. It is the post-hoc bench table `legal-blind-2-030` in [BENCH.md](docs/BENCH.md).

`legal@0.4.0` was built from the second cold reader's cases, not tuned on this set, and run on both halves afterwards, with
the set's outcomes known and no note hashed before the run. One change was made after that run: its negation reading was
narrowed to the quotation's own clause, after a first run held two genuine half-B quotations whose "not" sat in an earlier
clause ("An unconstitutional act is not a law; it confers no rights"). For that change this set is not held-out. Its row is
listed here, and in the table below; it is not a bench table.

`legal@0.5.0` was built from the third cold reader's cases and run on both halves afterwards, with the set's outcomes
known and no note hashed before the run. Its section reader was shaped with both blind sets' texts in view: their layouts
(a public archive's two- and three-line designations of separate opinions, a slip opinion's running heads and summary,
hard-wrapped lines, a bare "Disposition" heading inside an opinion) were read before the reader was settled, and one change
followed an outcome. A first run on the first set moved one genuine quotation (CT19) from FAIL to can't tell, because an
"OPINION ____" heading with a rule after it was not read and the whole opinion fell under the "COUNSEL" heading above it.
For `legal@0.5.0` neither set is held-out. Its half-B row equals `legal@0.4.0`'s on every item; it is not a bench table.

`legal@0.5.1` was built from the fourth cold reader's cases and run on both sets afterwards, with their outcomes known and no
note hashed before the run. Three changes followed a first run on the first set. A genuine quotation (CT01) moved from PASS
to can't tell because its sentence goes on ", notwithstanding that he acted as an agent …", and "notwithstanding" was read as a
limitation: concessions were then taken off the list. A genuine quotation's PASS (CT13) said it presented part of a sentence
as a whole one, because the headings above it end in small letters and so ran into its sentence: that check was narrowed to
words on the quotation's own line. A PASS (CT06) printed a continuation that was only the citation of what its sentence
quotes: such a continuation is now read as the end. After them, every outcome on both sets equals `legal@0.5.0`'s (40 of 40,
58 of 58). For `legal@0.5.1` neither set is held-out. Its half-B row equals `legal@0.5.0`'s on every item; it is not a bench
table.

`legal@0.5.2` was built from the fifth cold reader's cases and run on both sets afterwards, with their outcomes known and no
note hashed before the run. Its first run on both sets gave every outcome `legal@0.5.1` gives (40 of 40, 58 of 58), and no
change followed it. One change followed a run on the cold readers' own briefs: a quotation one of them counted as genuine,
from after "Petitioners suggest, and we agree, that", was held as reported speech, and the court adopting what it reports
was then read as its own voice. The second run on both sets gave the same outcomes. For `legal@0.5.2` neither set is
held-out. Its half-B row equals `legal@0.5.1`'s on every item; it is not a bench table.

#### The replication table on both blind sets, and the earlier runs

| rule, on | items | outcomes equal to the rule before it | known-bad passed |
|---|---|---|---|
| `legal@0.3.0` on the second blind set, both halves | 40 | 40 of 40 (to `legal@0.2.0`) | 0 of 20 |
| `legal@0.3.0` on the first blind set (2026-10-03), each text given a caption line | 58 | 58 of 58 (to `legal@0.2.0`) | 0 of 20 |
| `legal@0.4.0` on the second blind set, both halves | 40 | 39 of 40 (to `legal@0.3.0`) | 0 of 20 |
| `legal@0.4.0` on the first blind set, each text given a caption line | 58 | 58 of 58 (to `legal@0.3.0`) | 0 of 20 |
| `legal@0.5.0` on the second blind set, both halves | 40 | 40 of 40 (to `legal@0.4.0`) | 0 of 20 |
| `legal@0.5.0` on the first blind set, each text given a caption line | 58 | 58 of 58 (to `legal@0.4.0`) | 0 of 20 (and 0 of the 18 supplementary false quotations) |
| `legal@0.5.1` on the second blind set, both halves | 40 | 40 of 40 (to `legal@0.5.0`) | 0 of 20 |
| `legal@0.5.1` on the first blind set, each text given a caption line | 58 | 58 of 58 (to `legal@0.5.0`) | 0 of 20 (and 0 of the 18 supplementary false quotations) |
| `legal@0.5.2` on the second blind set, both halves | 40 | 40 of 40 (to `legal@0.5.1`) | 0 of 20 |
| `legal@0.5.2` on the first blind set, each text given a caption line | 58 | 58 of 58 (to `legal@0.5.1`) | 0 of 20 (and 0 of the 18 supplementary false quotations) |

Post-hoc replication on the full sets; neither rule was tuned on either set (their changes came from cold readers' cases),
except the two changes named here, so this is held-out in fact but not by prereg. For `legal@0.3.0`: a first replication on the
first set showed one genuine quotation (CT14) move from PASS to can't tell, because the caption reader did not read the
hyphenated party name "Orellana-Recinos"; it was changed to read a hyphenated name with or without its hyphen. Before that
change, 57 of the 58 outcomes were equal. For `legal@0.4.0`: the negation reading named above. The 40-item `legal@0.3.0` row is
the post-hoc bench table `legal-blind-2-030` in [BENCH.md](docs/BENCH.md); the 58-item row is listed there under "Outside the rule".
The `legal@0.4.0`, `legal@0.5.0`, `legal@0.5.1` and `legal@0.5.2` rows are listed here and under "Outside the rule". On every
`legal@0.4.0` FAIL in both sets, the named passage closes on a sentence end, none opens on the tail of the sentence before it,
and none shows a page mark. For `legal@0.5.0`: the CT19 change named above; after it, 58 of 58. For `legal@0.5.1`: the three
changes named above; after them, 58 of 58, with the wording of two genuine PASSes changed (one prints how its sentence
continues, one says it presents part of a sentence as a whole one). For `legal@0.5.2`: no change followed a run on either set;
40 of 40 and 58 of 58, with the wording of 14 genuine PASSes changed (each prints how its sentence begins; 8 of them were
"verbatim").

Earlier runs, for the record: on the first blind set (58 items, 2026-10-03, engine 0.0.1), `legal@0.0.1` passed 0 of 20
known-bad quotations (0.0% to 16.1%) and 6 of 20 genuine ones (14.5% to 51.9%). On the same items afterwards (post-hoc: the
rules were tuned with them in view), 0.1.0 passed 15 of 20 genuine ones (53.1% to 88.8%) and 0 of 38 bad ones, and 0.2.0
gave every outcome 0.1.0 gave.

## 0.7.0 (2026-10-13, release-pass)

the emailed-bill path reads the sender from the address, payment-instruction sentences, partial bills and tax lines; approves name their path; near-number duplicates say similar, not same

Engine 0.7.0 changes how the emailed-bill path (`ap <layout.txt>`, ruleset `ap-threeway@0.2.0`) reads a bill. Every change is
gated on the engine (`src/ap/v070.ts`), so a verdict made under 0.6.0 or earlier is re-performed exactly as that engine read
and replays byte for byte. Pages: `docs/AP-INPUT.md` (checks 1, 3, 7, 8 and 9, "Running it", "What an approve did not check"),
the accounts-payable door page.

- **The sender is the address in angle brackets.** A From line's sender is the address in `<...>` (or after `mailto:`), never
  a display name. A display name shaped like another address goes to the controller, both addresses named ("the From line
  shows billing@gulfcoastsupply.com but the message was sent from ar.dept@outlook-mailer.net"). Under 0.6.0 every address on
  a From line was a sender, so such a bill was approved with a sentence naming the display name as the sender.
- **No domain on file, a sender not built from the vendor's name goes to the controller.** A line naming the vendor counts
  only when the bill names no sender at all, and never a header or signature line. A bill from a billing platform's domain
  goes to a person until a booked bill of the vendor carries that address as its `sender`.
- **A hyphen is the vendor's own only where its name carries one.** `gulfcoast-supply.com` for "Gulf Coast Supply",
  `example-vendor.test` for "Example Vendor" and `acme-group.com` for "Acme" are look-alikes.
- **A domain on file passes only as written.** The same domain with two neighbouring letters swapped (`aldinjean.com` for
  `aldinejan.com`) is a look-alike for the controller, both domains named. Under 0.6.0 the swap was read back as a scanning slip.
- **Payment-instruction sentences are read as sentences.** A verb of sending, paying, remitting, mailing, wiring, directing
  or updating with an account, an institution, an address, a lockbox, a link or an assignee as its object, a change or an
  attachment about where money goes, a sale or assignment of the bill, or a payee other than the vendor sends the bill to the
  controller. The 25 phrasings stay as a fast path. A standing remit-to postal address is named on the approve, not flagged.
  A bill that only prints bank details says no sentence of it was read as asking to change them.
- **Partial bills and lines that match no PO line.** Fewer bill lines than PO lines is a partial bill when every bill line
  matches a PO line and every amount on the bill was read; the approve says "partial: 1 of 2 purchase-order lines billed; 1
  line open". A bill line that matches no PO line, or does not name the item of the PO line it was paired with, is its own
  claim (`ap.bill_line[n].*`), named for a person. Under 0.6.0 any count mismatch made every line check undecided.
- **A line must name its PO line's item.** Its head noun, abbreviated, run together or with a swapped pair of letters, or
  another word of the description that says what the item is; sizes and family codes never count. Every one of the 455 line
  pairings of the public Distil benchmark names its item; "3/4 EMT SET SCREW CONNECTOR" against "3/4 in EMT conduit, 10 ft"
  does not.
- **Tax lines.** A tax line ("Sales tax 8.25%: USD 432.70") is read as the bill's tax, added to the total, and checked to the
  cent against the rate the purchase-order block states ("Tax: 8.25%"), as structured input's `bill.tax` is. A tax line on a
  purchase order that states no rate goes to a person ("tax line present, PO states no rate").
- **Invoice numbers.** A suffixed number is read whole (`GCS-20417A`, `AJ-97466-1`). A possible resubmission whose booked
  number is similar to this bill's says "a bill with a similar number is booked", on both paths. An unclear number names each
  number the bill reads, by line, and any of them that is booked.
- **The path is named.** After its headline, which keeps its shape for the scripts that parse it, every `ap` answer prints
  "read from: emailed text" or "read from: structured input" on a line of its own, and every emailed-text approve ends its
  "Not checked" block with "This bill was read from text; the structured path is the product and this path is a convenience
  with the limits listed."
- **Replay of an emailed bill.** The text path's JSON carries `read`: the sha256 of the text and of the payment history, and
  the policy. `replay <result> --source <bill.txt> --history <history.json>` re-performs it; a missing file is named (exit 3),
  and a file that is not the one it was read from fails the replay (exit 1).

Also in this release, words only (no verdict changes): the AP report says "payment history: N entries"; a pay application's
report names a payer that is not the AIA owner as "the payer's controller (ruling role: owner)", and prints "the owner
(owner)" only with `--payer-role owner` (`formatPayAppReport`'s `payer_role`). The shadow pilot's CSV reader no longer merges
bill rows under one invoice number across dates or vendor spellings when the export has no `ref` column; the dry run names
them (packages/receipts PILOT.md, HOW-TO-MAP.md).

## The HTTP service's check budget, ambiguous number spellings, today's rule on every replay, and the test suite, unreleased (2026-10-06, sixth pass; the engine stays 0.6.0; docs/DEPLOY.md, docs/REPLAY.md)

A cold reader in cold review round 6 (an AI agent reading the pack as a platform engineer) sent one request under the size cap
to the HTTP server's citation route, a 9 KB quotation against a 460 KB text: it held the server's only thread for 29 s, and a
3.48 MB request killed the process for want of memory. The same reader found "1,500" read as 1500 at confidence 100, "1.500"
read as 1.5, an invoice writing "1.500,00" beside "1,500.00" read as 1500 twice and passed, and a replay of a verdict made under
the weak `peppol-en16931@0.1.0` printed VERIFIED with no word that today's rule fails it. Under engine 0.6.0 some invoice and
pay-app verdicts that read such figures move from a decision to can't tell (none moves the other way); their ids move with them.
Engines 0.0.1 to 0.5.0 re-perform their verdicts byte for byte.

- **A budget for each check (2026-10-06).** `serve` checks every POST in a worker thread under a time limit (60 s), a heap
  limit (512 MiB) and a limit on checks at once (2, with 16 waiting). A check past its time or heap is stopped and answered
  `413`, "input too large to check within the service's budget; run it with the command line", with `x-verify-gate:
  INSUFFICIENT_DATA` and `x-verify-exit: 2`; it is never a verdict, and the server and every other request stay up. Past the
  queue, or after waiting one check's time for a worker, the answer is `503` with `Retry-After: 1`. `/v1/health` answers
  while a check runs, and a check longer than the idle-socket timeout keeps its connection. `--check-timeout-ms`,
  `--check-heap-mb` and `--check-workers` raise the budget (or the matching `VERIFY_CHECK_*` settings). Measured on the
  reader's two requests, with the server's own heap capped at 512 MiB: before, the process died at 5 s and at 7 s. Now, with
  the legal matcher bounded the same day (the legal entry), they get their verdicts in 3 s and 33 s; with the time limit set
  to 10 s the larger is answered `413` at 10 s; `/v1/health` answered within 30 ms throughout, and the process stayed up. The
  managed tier (`serveService`) still runs its service on the thread that answers requests.
- **Reading a body costs what it should (2026-10-06).** The duplicate-key scan searched back to the start of the text for every
  key, so a 20 MB body of 200,000 small objects took minutes to read; it reads in about a second. JSON nested more than 256
  levels deep is refused before it is parsed, "nesting too deep, limit 256": exit 3 on the command line, a `400` over HTTP, a
  refused case in a replay folder. It used to overflow the stack ("Maximum call stack size exceeded"), or answer "invalid JSON
  body" for valid JSON.
- **Ambiguous number spellings (2026-10-06).** On the built-in invoice and pay-app rulesets: a lone group of three digits after
  one separator ("1,500", "1.500") reads only under a declared `number_locale`, never under a format the document's other
  figures suggest; a document that writes some figures as "1,500.00" and others as "1.500,00" reads none of its figures written
  with a "." or ","; digits of two scripts, in one figure or across the document (a full-width "１５００.００" in an invoice whose
  other figures use 0-9), and a space other than the ordinary one outside a grouping (a trailing no-break space) are refused,
  named. The declarative rulesets refuse the same characters and the same mixed documents. Each leaves the checks that need the
  figure at can't tell, with the reason. "1,500.00", "1500.00", a consistently European "1.500,00", and an invoice written wholly
  in full-width or Arabic-Indic digits read as before.
- **Today's rule on every replay (2026-10-06).** A replayed declarative or built-in verdict made under an older rule or engine,
  whose inputs today's default reads differently, says so under its headline, as the legal and AP replays already did:
  "under today's default peppol-en16931@0.3.0 this invoice reads FAIL (currency), not PASS-WITH-OPEN", and the JSON carries it
  as `rule_now`. The verdict is still re-performed under its own rule, byte for byte. A `--require-ruleset` failure is now the
  first line a replay prints, before VERIFIED. A divergence at a field the engine never writes no longer suggests restating a
  rounding-tolerance override.
- **Smaller (2026-10-06).** The JSONPath call says `eval: false`, so a filter expression in a path is refused, never run. The
  example workflow pins the Riposte action by commit SHA, with `REPLACE_WITH_COMMIT_SHA` to fill in, instead of `@main`.
- **Tests on a stranger's machine (2026-10-06).** The root `npm test` runs every package whatever the others do, ends with each
  package's result, and exits non-zero when any failed (it chained them with `&&`, so one failure hid the rest). The two receipts
  loop tests that start the engine's command line get 180 s. The differential test of the line bridge says what its
  "MATH_INT FAIL -> PASS" counts mean.

## Legal rule 0.5.2: the lead-in, pluralities, and vendor downloads, unreleased (2026-10-06, sixth pass; the engine stays 0.6.0; docs/LEGAL.md, docs/LEGAL-TEXT.md)

A cold reader in cold review round 6 (an AI agent reading the pack as a legal-operations director, with no prior work on this
tree) found words the opinion reports passing as its own: "the statute of limitations was tolled." from "The dissent maintains
that the statute of limitations was tolled." passed as "verbatim", and so did the same cut after "Appellant argues that", "It
would be a mistake to conclude that" and "Were we writing on a clean slate, we might hold that", and Daubert's report of the
overturned lower-court standard. It found a plurality part labelled "the majority opinion", genuine quotations FAILing across
a Westlaw PDF's page break and a Lexis "HN4[ ]" marker, and a download that opens on its KeyCite flag named by that flag. The
fixes are a new ruleset version, `legal@0.5.2`, the default for a new legal verdict under engine 0.6.0 from 2026-10-06, chosen
by LEGAL.md's stated rule: it ties `legal@0.5.1` on half B, closes a false-PASS class a cold reader found, and gives every
outcome `legal@0.5.1` gives on both blind sets (40 of 40, 58 of 58). A verdict that names `legal@0.5.1` or earlier replays
under that rule, byte for byte.

- **The lead-in (2026-10-06).** A quotation that begins in the middle of its sentence is never called "verbatim": its PASS
  prints how the sentence begins ("the sentence begins: "To the contrary, under the Rules…""). When those words report
  someone else's position or frame what follows, the answer is can't tell (`SELECTIVE_QUOTE`, `missing: ["lead_in"]`),
  naming them and whose words they are: "reported speech" (a party, a separate opinion, another court or tribunal, or someone
  unnamed: "Appellant argues that", "the court below held that", "it is argued that", "the contention that"),
  "counterfactual" ("we might hold that", "a reasonable jury could find that", "Were we …", "Assuming that"), "rejected
  reading" ("It would be a mistake to conclude that") or "question" ("The question is whether"). The court's own voice ("We
  hold that", "this Court held that") and its adoption of what it reports ("Petitioners suggest, and we agree, that") pass.
  Its remedy says to quote the words with their lead-in, or the opinion's own words.
- **"Verbatim", one rule (2026-10-06).** LEGAL.md states once when a PASS says "verbatim": the words match exactly and the
  quotation begins and ends where its sentence does. Anything else that passes is "as quoted", with its context printed.
- **Pluralities (2026-10-06).** The lead opinion's designation is read ("announced the judgment of the Court … and an opinion
  with respect to Part III, in which …", "delivered an opinion", "except as to Part III"), with its numbered parts. A lead
  opinion that is a plurality, wholly or in part, is named "the lead opinion", and a PASS says what the designation makes of
  the place it matched ("Found in Part III of the lead opinion …: a plurality opinion, not an opinion of the Court").
- **Vendor downloads (2026-10-06).** A Westlaw PDF's page footer and the next page's running header, left inside the opinion
  when the PDF is turned into text, are read out as one break between words, and named on the answer; a run needs one of the
  vendor's own lines to start it. A Lexis "HN4[ ]" marker is read out like a Westlaw headnote number, and a quotation that
  begins after one is no longer said to present part of a sentence. A KeyCite flag and its treatment line at the head of a
  download, and a page footer or banner line there, are skipped when the caption is read, and the "All Citations" lines at
  the end of a Westlaw download name the text. The citations report says when they did. A new page,
  `docs/LEGAL-TEXT.md`, says how to get UTF-8 text from a vendor's PDF, Word or RTF download, what to keep and what is read
  out.
- **A FAIL's words left out (2026-10-06).** An ellipsis in the quotation stands for the words it covers, which are never
  listed as left out: "The focus . . . must be on principles" against "The focus, of course, must be solely on principles"
  names "solely" only.
- **Replay and the report (2026-10-06).** The replay of a legal verdict no longer prints an evidence floor ("evidence floor
  unstated (the values carry no provenance …)" is a document check's wording); its scope line says what the verdict was
  checked against. `verify citations` on a folder without `sources.json` ends with a hint when a citation found no text and a
  file name does not read as a reporter citation.
- **Cost, every legal rule (2026-10-06).** A repetitive quotation against a long text ("the court held that N", over and over)
  made the search for the nearest passage hold every matching run of words, and a 9 KB quotation against a 458 KB text ran a
  process capped at 512 MB out of memory. The search now keeps only the few runs it reads, in the same order, and skips a
  candidate that cannot be one of them: that case takes 2.5 s and 112 MB. The reading of citation sentences no longer
  re-scans the blank stretches of a section view: a 776-character quotation against a 307 KB opinion went from about 10 s
  to under 2 s. Neither changes an answer: 4,180 readings, both blind sets, every cold reader's brief and the drift sets
  give the same output, byte for byte.
- **What moved.** On the cold readers' own briefs (334 checks over five rounds) 14 answers move, each named in LEGAL.md: the
  fifth reader's 13, and the fourth reader's party argument quoted as a holding, now can't tell. On both blind sets every
  outcome is unchanged, and 14 genuine PASSes now print how their sentence begins.

## Accounts payable and pay applications: payment redirection on every channel, sender domains from the vendor's name, tax to the cent, unreleased (2026-10-06, sixth pass; the engine stays 0.6.0; docs/AP-INPUT.md, packages/receipts HOW-TO-MAP.md)

A cold reader in cold review round 6 (an AI agent, in the role of a subcontractor's controller) found an emailed bill that said
"please send payment by Zelle to billing.aldine@gmail.com" approved, its "Not checked" block saying that no line of the bill
asked to change where payment goes. Pay-by-link, a `.co` sender against a `.com` vendor, a hyphenated look-alike domain and a
Gmail sender were approved too. Tax was checked within the 2% price tolerance; a change-order line marked pending owner approval
passed with exit 0; the G702's own 5a/5b retainage split went to a person and a retainage rate given as an object was read as no
rate; an equal-amount second shipment went to a person although the PO line's invoiced quantity showed it was a new delivery;
and the Vista draft left per-hundred prices unconverted and wrote none of the notes the pilot page promised. Under engine 0.6.0
every pay-app verdict id moved, because its remedy table changed. The AP remedy table did not change. Engines 0.0.1 to 0.5.0
re-perform their verdicts byte for byte.

- **Payment redirection on every channel (2026-10-06).** The text path's `ap.remittance` reads one list of 25 phrasings
  (`PAYMENT_REDIRECTION`, listed in docs/AP-INPUT.md): a change of payment details, bank-account details, Zelle, Venmo,
  PayPal, Cash App, Western Union, MoneyGram, cryptocurrency, a web address on a line about paying, a pay-by-link, and an email
  address or phone number named as the payee. A line matching any of them is a person's decision, the line quoted, the AP
  controller clearing it. A remit-to post office box with a phone number, a remittance advice sent to an address, and a number
  to call with questions are not payees.
- **The "Not checked" block never asserts what it did not establish (2026-10-06).** An approve on the text path says "none
  of the 25 phrasings listed in docs/AP-INPUT.md (...) matched any line of the bill; a wording not on that list is not caught;
  the vendor's bank details are not part of the inputs". Its tax line says no amount was read as tax and that tax inside a
  price is not read, where it said "none is billed"; the console's tax line does the same. The vendor line says what the sender
  was compared with.
- **Sender domains (2026-10-06).** With no domain on file, a sender passes only from the vendor's name: a hyphen that is not
  the name's own (`aldine-jan.com`, against a word cut short) and an ending one letter off `.com` (`.co`, `.cm`) are
  look-alikes for the controller, with no "Email:" field needed. A hyphen where the name has a space between whole words
  (`example-vendor.test` for "Example Vendor") is the name's own. A free-mail sender (Gmail, Outlook, Yahoo, iCloud, Proton, AOL and the rest of the list in
  docs/AP-INPUT.md) is a person's decision unless that exact address is on file. A booked bill's `sender` on a text-path
  history row puts the vendor's domain on file when the PO names none.
- **Tax to the cent (2026-10-06).** A stated tax rate (or the tax rule's rate) is checked within rounding, one minor unit per
  taxable line, not within the price tolerance: $38.69 over goes to a person, naming the difference; a few cents of per-line
  rounding still approve.
- **A possible resubmission settled by the PO's own figures (2026-10-06).** On structured input, a new number with the same
  vendor, PO and total passes the duplicate check when every line's PO line carries `invoiced_quantity_to_date` and the bill
  bills units received and not yet invoiced; the approve names the quantities.
- **Pay applications (2026-10-06).** A schedule line marked unapproved ("pending owner approval", a status field, `approved:
  false`) that bills work, or a raised scheduled value that a change order marked unapproved accounts for, is PASS-WITH-OPEN,
  exit 2, the owner clearing it. `retainage_rate: { "completed_work": "10%", "stored_materials": "0%" }` states the G702's own
  split (lines 5a and 5b) and is checked as such. A rate given as any other object or an array, on the application, a line or
  as the reduced rate, is refused by name, exit 3. The retainage remedies name the split.
- **The Vista draft reads units (2026-10-06).** It maps ECM and CurECM as `price_per` (a rate per hundred or per thousand
  becomes a price per unit; any other value sends the bill to a person, naming it) and UM as `unit` (a bill line in another
  unit than its PO line goes to a person). `mappings --erp vista --out` writes the draft's notes into the file and prints them;
  a mapping file's `notes` are read out with every dry run.

## Documentation: the front page on one screen, a page for each reader, the AP input as a manual, unreleased (2026-10-06, sixth pass; the engine stays 0.6.0; README.md, docs/doors/, docs/AP-INPUT.md, docs/GLOSSARY.md, packages/receipts PILOT.md)

The four cold readers (AI agents) of cold review round 6 found the pages true but too long for their hour: a front page of
530 lines written for five readers at once, the AP input page written as dated patch notes, and the pilot page quoting an AI
agent's review to a customer. Nothing a page promised is dropped: each passage moved to the page of the reader it belongs to.
No engine behaviour changed.

- **The front page (2026-10-06)** is one screen: what Riposte is and is not, the five doors with each one's first command,
  how to read an answer, installation, who stands behind it, and where the misses and the bench live.
- **A page for each reader (2026-10-06)**, under `docs/doors/`: accounts payable (bills and pay applications), e-invoices,
  legal operations, engineers, and methods reviewers. Each carries its first command, its own caveats and where to read next.
  The engineers' first command reads a shipped sample extraction, `docs/doors/examples/invoice.json`, and the e-invoice first
  command reads its claims from stdin (`--claims -`), so each first command is one line.
- **AP-INPUT.md as a manual (2026-10-06):** the checks in the order they run, each with what it reads, what it answers, who
  may clear it and its tolerance. The dated history it carried stays in the accounts-payable entries of this page.
- **PILOT.md (2026-10-06)** no longer quotes an AI agent's review. It says in plain terms what the pre-registration's
  numbers mean (what the template's examples need to pass, the smallest samples that can, what a small month does), and the
  labelling cost in hours, an estimate that has not been timed.
- **Sentences made true (2026-10-06).** The BPI Challenge 2019 agreement figure (61.7%) now carries its recall side: of the
  81,771 decided items the company held, the check flagged 1,668, about 2.0%. The `model_attest` sentence names the date of
  the fix behind misses-ledger row F11. "Closed" and "released" are defined at the top of this page, one meaning each, and
  the pages use them so: the replay promise holds for closed labels, and no version is released yet. The pilot page calls
  its audit seed one "nobody picks by hand", where it said "nobody chooses": the seed comes from the run itself.
- **The glossary** gains the terms the new pages use: the AP decisions, the "Not checked" block, the two AP inputs, payment
  history, the price tolerance and the tax and freight rules, a look-alike vendor, pay applications, e-invoice terms, legal
  terms, released, hashed-not-shipped, stamps, cold review, and the pilot's two numbers.

## Bench: blind labels name their record, files that ship edited, a post-hoc verdict cell, the recall side, and cold review round 6, unreleased (2026-10-06, sixth pass; the engine stays 0.6.0; docs/BENCH.md, docs/MISSES.md, docs/BENCHMARK-AP.md, docs/bench/blind-shipping-1/PREREG.md)

A methods reviewer in cold review round 6 (an AI agent) found the bench pages faithful to their results but stronger than
their records in seven places: "blind" rested only on the authors' own hash times and fetch logs; files that ship edited
were listed as not shipped; a post-hoc re-run printed PASS against a bar written for another run; AP run 1 was called blind
with its checker "frozen before the run", while its own provenance archive puts the frozen file after the results; "one table
reruns in full" meant outcomes, not bytes; the purchase-log agreement figure stood without its recall side; and the blind-run
preregistration's seed sentence was false as written. No engine behaviour changed.

- **"Blind, by the authors' records" (2026-10-06).** BENCH.md prints the blind label as "blind, by the authors' records" and,
  beside it, the record it rests on, from a new `blind_basis` in each blind table's `run.json`; `bench check` refuses a blind
  table whose folder names none. All six blind tables rest on the authors' own hash lists, fetch logs or prereg notes, and
  none on a third party's.
- **"Ships, edited" (2026-10-06).** A hash-listed file that ships in bytes other than the recorded ones is listed under
  "Ships, edited" with both sha256s and the reason (`shipped_edited` in `run.json`), apart from "Hashed, not shipped". Three
  files moved there: legal-blind-2's `harness/run.ts` and `items/EXCLUDED.json`, and legal-blind-2-030's `run-halfB-030.ts`.
  `bench check` refuses a file listed as not shipped while a file of that name ships in other bytes, unless those bytes are
  themselves recorded in the folder's hash lists (a superseded version, as in the first legal blind set).
- **A post-hoc verdict cell (2026-10-06).** A bar written for another run and reused after the fact (`bar.reused_from` in a
  spec) gives the row no verdict of its own: the row reads POST-HOC, its cell reads "post-hoc (no bar of its own; ...
  reused)", and its note says whether the counts meet that bar's test. The first row of `r4-peppol-posthoc`, held to the
  e-invoice PDF run's bar, read PASS and now reads post-hoc; its counts, 0 wrong PASS of 20, are unchanged. `bench emit`
  counts such rows apart in its summary.
- **AP run 1's wording (2026-10-06).** BENCH.md and BENCHMARK-AP.md say run 1 is blind by the authors' records only, with the
  file times from its provenance archive: the benchmark data on disk at 12:33:54 UTC, the prereg created at 12:47:22, run 1's
  results written at 12:49:17 and the frozen checker file at 12:49:55, after the results. The FREEZE line inside a prereg
  whose sha256 was never recorded is the only record that the checker was frozen first. "The blind checker" now reads "the
  frozen checker" on both AP pages.
- **Reruns: outcomes or bytes (2026-10-06).** A rerun record can say what a rerun reproduces (`identical`: `bytes` or
  `outcomes`). legal-blind-2 reads "yes, with identical outcomes; verdict ids differ until a release pins the engine label":
  where the fifth-pass entry below says it "reruns in full", that means its 160 outcomes, not its bytes. BENCH.md says that
  no tagged, signed release of this tree exists yet and that 0.6.0 is still open, and points to the definitions of "closed"
  and "released" at the top of this page.
- **The recall side of the purchase-log agreement (2026-10-06).** s4-bpi2019 gains a descriptive row from the same summary
  counts: of the 81,771 decided items the company's log held, the check flagged 1,668, 2.0% (Wilson 95%, 1.9% to 2.1%). The
  agreement row says that most of its 61.7% is items that passed and were not held.
- **The blind-run preregistration's seed sentence (2026-10-06).** "No one can choose the seed: it does not exist until the
  stamp does" was false as written: anyone could request several stamps of the same bytes and keep one. It now says the seed
  is derived from the first stamp's bytes and that the order rule, a stamp before any data exists, is what makes it
  unchoosable in practice. The prereg was not stamped, so the sentence was changed once and its sha256 recorded again in
  `PREREG.sha256`.
- **Cold review round 6 in the misses ledger (2026-10-06).** A new misses-only table, `cold-review-r6`, holds 71 rows from
  the four round-6 reports (28 documentation, 9 message, 19 engine and 15 method defects), every one open. 42 round-5 rows
  are marked fixed, each verified in the tree handed to the round-6 readers and in the sources since, and so is the red
  team's F11 (the attest monitor's undated-name match, fixed since 2026-10-04). The ledger went from 471 rows to 542, and
  from 250 fixed to 293. Four "Outside the rule" cells now point at the methods page, where the numbers moved from the
  front page. MISSES.md now says that "a released tree" in earlier scope notes means the
  copy of this tree handed to the next round's readers. Eight scope notes now need a stamp, where there were seven.
- **The AP stress rows were re-banked, digest only (2026-10-06 11:45Z, the sixth amendment),** under the AP pack this
  pass ships: fifteen files, `checker_sha256` `2ee0594b…`, where it was `716018c7…`. The pack changed in behaviour (payment
  redirection, sender domains, tax to the cent, the resubmission rule), and the engine's number intake changed beside it.
  Before banking, each seed was run on the final tree and compared row by row with the banked rows: 0 of 3,000 decisions,
  0 reasons and 0 other fields moved, none of them from decided to can't tell, and the count is still 0 wrong of 2,755
  decided. A fresh run is identical, 30 of 30. The rows have now been banked eight times; the amendment says what this does
  not show.
- **Two rows join "Outside the rule" (2026-10-06):** legal@0.5.2, the new default legal rule, on both legal blind sets
  (post-hoc), and the fifth cold legal reader's briefs, legal@0.5.1 against legal@0.5.2. legal@0.5.1's row now says when
  0.5.2 took over.

## Accounts payable and pay applications: payment details, sender domains, continuity, unreleased (2026-10-06, fifth pass; the engine stays 0.6.0; docs/AP-INPUT.md, packages/receipts PILOT.md, packages/receipts HOW-TO-MAP.md)

Two cold readers (AI agents, in the roles of a platform engineer and a subcontractor's controller) found these: a bill from a
look-alike of its vendor's domain, saying "our bank details have changed", was approved, its vendor evidence the subject line
the sender wrote; an IBAN was read as a stated total; an approve never said what it did not check; a pay application whose
scheduled value was raised with no change order passed, while two correct ones (stored materials by the form's own column D
heading, and a new change-order line) were stopped, one with an internal role name as the remedy; a second bill taking a PO
line past what was received was approved; and leading zeros, taxed bills and audit samples too small to pass each went
unnoticed. Under engine 0.6.0 every AP verdict id and every pay-app verdict id moved again, because their remedy tables
changed. Engines 0.0.1 to 0.5.0 re-perform their verdicts byte for byte.

- **Payment details on the bill (2026-10-06).** A text bill whose invoice asks to change where payment goes ("bank details
  have changed", "new account", "please remit to our new account", "remit to IBAN ...") or prints bank-account details (an
  IBAN, a routing or account number, SWIFT/BIC, a sort code, wire or ACH instructions) gets `ap.remittance` (rule
  AP_REMITTANCE): a person decides, naming the line, and the AP controller clears it. It never FAILs, and a bill without such a
  line gets no such claim. A remit-to postal address is not a change. An IBAN or an account-number run on a "please remit"
  line is never read as a stated total.
- **Sender domains (2026-10-06).** On the text path the vendor check reads each sender's registrable domain first. A
  look-alike of the vendor's (a name built from the vendor's with anything added, one a letter or two away, or the vendor's
  name only as a subdomain of another domain) is a near match for the controller and never evidence of identity. When the
  purchase order names the vendor's domain or email, the sender must write from it. An email header line (Subject, To, Cc,
  Date, Re, Fwd) is never vendor evidence. A domain built from the name, with a company-form word beside it at most, passes as
  before.
- **What an approve did not check (2026-10-06).** Every approve's `not_checked`, printed under "Not checked", names the
  vendor's identity beyond the match, the bank details, per-line netting where it applies, and tax where the order states no
  tax terms. Holds and a person's decisions do not carry it.
- **Pay-application continuity (2026-10-06).** The continuity checks (G703_PREV, G702_PREV) also compare each line's scheduled
  value with last month's: a change needs a change order the application states (`change_orders`, or `change_order_amount` on
  the line), else a person decides, naming the line and the difference, and the owner clears it. A line new this month is read
  as a change order when net change orders rose by its scheduled value, else a person decides ("line 8 is new this month ...;
  confirm it is a change order"). Column D is read either way the form is filled in: last month's completed to date, or last
  month's D + E (the form's own heading), the console naming the reading; neither still FAILs. The original contract sum must
  not change. Their can't-tell remedies name the owner, a stated change order and last month's application, and no internal
  role name reaches the console. The shipped example still passes 44 of 44.
- **Billed to date per PO line (2026-10-06).** `purchase_order.line_items[].invoiced_quantity_to_date` (optional): the
  quantity earlier bills invoiced on the line. When present, `ap.line[L].billed_to_date` (rule AP_QTY_TO_DATE) nets this bill
  against it: over what was received, a person decides and the buyer clears it. Absent, the per-line gap is named, with the
  field that closes it. The shadow pilot's CSV mapping reads it from a purchase-order column, `invoiced_quantity`.
- **The tax rule (2026-10-06).** `ap --input ... --tax person|allow|rate:<pct>` decides tax on a purchase order that states no
  tax terms: `person`, the default and the behaviour before; `allow`, accepted as billed and said so; or a rate, checked within
  the price tolerance. An order that states its terms is never overridden. The rule is bound into the `input_hash` and carried
  as `inputs.policy.tax` (never for `person`); the text path and engines up to 0.5.0 refuse it. The shadow pilot registers it
  in its pre-registration and records it in each receipt; `prereg freeze` also warns, in words, when a registered audit sample
  cannot clear its bar even at its best.
- **Duplicates and the words for a look-alike vendor (2026-10-06).** Leading zeros of an invoice number count as punctuation
  (SES-020417 against SES-20417 is a person's decision). The duplicate check and the vendor check both say "a look-alike
  vendor" for the same finding.
- **Replay of what `ap --input` writes (2026-10-06).** `verify replay <that file>` replays its `proof` member and says so; a
  file whose top-level verdict is not its proof's is refused.
- **Identity (2026-10-06).** The pinned AP gate id in the receipts checker-stamp test moved from 768b5c8f… to d24a1597…,
  repinned by hand with the reason and the fields that moved. The engine 0.6.0 pay-app example ids moved from 742f0af5… and
  f9bbd336… to 1c847fc9… and dfa46800…. The AP pack now has 15 source files (remittance.ts and qty-to-date.ts are new), so its
  source digest moved.

## Bench: which tables rerun, cold readers named as AI agents, and a blind-run preregistration, unreleased (2026-10-06, fifth pass; the engine stays 0.6.0; docs/BENCH.md, docs/MISSES.md, docs/BENCHMARK-AP.md)

A methods reviewer in cold review round 5 read "re-emits every table byte for byte" as reproduction, found that no table
says whether it reruns from this tree, and found that the cold-review readers were called "outside readers", which reads as
people. These are fixed on the bench pages; no engine behaviour changed.
- **Every table says whether it reruns from this tree.** `run.json` now requires `rerun` (`from_tree`: yes, partly or no,
  and a `detail` saying what reruns, with which command, and what is withheld and why). The table carries it, BENCH.md
  prints it as **Reruns from this tree** in each table and lists all tables in one place, and `bench check` refuses a folder
  without it. One table reruns in full (`legal-blind-2`), one partly (`ap-stress-development`), the rest do not. BENCH.md
  now says that `bench check` re-tallies tables from their shipped results and is not a rerun.
- **legal-blind-2's 39 opinion texts ship.** They are public domain and were withheld because ordinary words in them matched
  terms the export scan refuses; the scan now allows those words in those passages only, each pinned to its phrase. A new
  `rerun.mjs` in the folder reruns every step from the shipped texts with the package's engine and compares each case: every
  outcome the table counts is identical; verdict ids and some explanation wording differ, because the engine has changed
  since the run.
- **Prereg-pinned files are listed.** The e-invoice PDF run's harness, scorer, extractor, supplement ruleset and render
  receipt now ship byte for byte in its folder; its corpus manifest and engine build are listed under "Hashed, not shipped"
  with the reason. Files pinned in the text of six other preregs are listed the same way.
- **Cold readers.** The cold-review tables' titles, MISSES.md's header and the outside-the-rule rows say "cold readers (AI
  agents that had not worked on this tree)", run by the maintainers, not people and not independent reviewers. The frozen
  scope notes keep their words; the pages say what those words mean.
- **The AP stress seeds are fixed seeds, not a holdout.** BENCHMARK-AP.md, the AP harness page and the bench lists say so,
  with the reason (a change to the vendor check was made with the seeds' results in view), and give the true number of
  re-banks: six.
- **The AP stress rows were re-banked again, digest only** (the fourth amendment, 2026-10-06 06:07Z), under the AP pack of
  this release: fifteen files, `checker_sha256` `b041e2b5…`. Before banking, each seed was compared row by row with the
  banked rows: 0 of 3,000 decisions, 0 reasons and 0 other fields moved, still 0 wrong of 2,755 decided; a fresh run is
  identical, 30 of 30. The amendment says what this does not show.
- **The AP prereg's header.** "frozen 2026-09-23 ~08:55, before any run" is an estimate that falls about six minutes after
  run 1, and the prereg's sha256 was never recorded. BENCHMARK-AP.md, the AP harness page and a new `bench/ap/PREREG.NOTE.md`
  beside the frozen file say this before a reader reaches the prereg.
- **The e-invoice blind table's title** states that its primary bar failed (11 of 20 planted defects certified PASS under
  ruleset 0.1.0).
- **`bench check` on a copied tables directory** says where it looked for the stress rows (four folders above the tables
  directory) and to give `--stress` and `--pack`.
- **Misses ledger.** Round 5's 68 rows are a new table, `cold-review-r5`, including one kill: a decimal that does not
  round-trip through a double is accepted silently and can change a check's outcome. 40 round-4 rows record the fix that
  shipped on 2026-10-05, each verified in that released tree.
- **A blind run of the versions that ship is preregistered, not run.** `docs/bench/blind-shipping-1/PREREG.md` pins the
  engine, AP pack, e-invoice rulesets and legal rule by digest; names data the maintainers have not seen (a partner's closed
  month; two public e-invoice test suites not used in this tree; Supreme Court merits briefs and the opinions they quote);
  sets labels by a person independent of the harness, bars with sample sizes that can clear them, stop rules, and what is
  published whatever the outcome. It is hashed and not yet stamped; the run has not begun.

## Legal rule 0.5.1, unreleased (2026-10-06, fifth pass; the engine stays 0.6.0; docs/LEGAL.md)

A cold reader (an AI agent reading the pack as a legal-operations director, with no prior work on this tree) found four
exact-word cuts that reverse the opinion passing under `legal@0.5.0`, two of them as "verbatim": "a court must accept as true
all of the allegations contained in a complaint", from a sentence that goes on "is inapplicable to legal conclusions". It also
found genuine, disclosed quotations FAILing: an em dash against a Lexis "--", and a citation sentence left out under "(citation
omitted)", "(citations omitted)" or "(cleaned up)". The fixes are a new ruleset version, `legal@0.5.1`, the default for a new
legal verdict under engine 0.6.0 from 2026-10-06, chosen by LEGAL.md's stated rule: it ties `legal@0.5.0` on half B and closes
a false-PASS class a cold reader found, and it gives every outcome `legal@0.5.0` gives on both blind sets (40 of 40, 58 of 58).
A verdict that names `legal@0.5.0` or earlier replays under that rule, byte for byte.

- **The cut at the end (2026-10-06).** A quotation that stops before its sentence ends is never called "verbatim". Its PASS
  prints how the sentence continues ("the sentence continues: "…, and the complaint here is sufficient to state a claim.""). A
  continuation that limits or negates the quoted words answers can't tell (`SELECTIVE_QUOTE`, "the cut ends before a
  limitation"), printing it: one that opens with "but", "unless", "except", "only", "however", a negation and the like, or a
  set-off phrase of time after a comma; or one that goes on in the same clause with a negation or a denying word
  ("inapplicable", "insufficient"). A closing ellipsis over one answers the same. A concession ("notwithstanding …") does not
  hold, and a continuation that is only the quoted passage's citation is read as the end. A fragment presented as a whole
  sentence says so, with the full sentence.
- **Dashes (2026-10-06).** An em dash, an en dash and "--" are one dash, the spaces around it aside; the PASS says so.
- **What a parenthetical excuses (2026-10-06).** "(citation omitted)", "(citations omitted)" and "(cleaned up)" let a citation
  sentence inside the quoted words be absent; "(footnote omitted)" and "(cleaned up)" a footnote call; "(internal quotation
  marks omitted)" and "(cleaned up)" the text's inner quotation marks; "(alteration in original)" names the text's own brackets.
  It may end the quotation or follow the citation. The PASS names what it excused. A citation sentence left out with no
  ellipsis and no parenthetical FAILs naming it, and its remedy says to add "(citation omitted)" or an ellipsis.
- **Westlaw headnote numbers and sentence ends (2026-10-06).** A bracketed number standing alone between sentences ("… conclusions.
  [9] Second, …") is read out like star paging, and the PASS names it; one glued to a word or its punctuation is still a
  footnote call. A period after a number ends a sentence before a capital, so a named passage no longer opens on the citation
  sentence or the headnote number before it.
- **What a FAIL names (2026-10-06).** Punctuation that differs ("the text has a comma after "action" that the quotation leaves
  out"), where `legal@0.5.0` said "the same words, written differently"; a long run of differing words by its ends and its count,
  as printed; words joined from passages farther apart than an ellipsis is read for, with both passages; and a bracket that
  inserts a word, answered by "Remove the inserted [only]" where `legal@0.5.0` said "Restore the word the text has".
- **Can't tell on a footnote call (2026-10-06).** The remedy is the printed page, or "(footnote omitted)"; it no longer asks for
  a copy of the download without its page markers, which would no longer match the vendor's file.
- **Wording (2026-10-06).** A Lexis "Dissent by:" line is named "the "Dissent by" line", not "the header above the opinion". No
  `legal@0.5.1` answer says "abstaining": a possible fabrication reads "Can't tell: the check does not call it a fabrication",
  and a proposition "can't tell, by design". The HTTP and MCP descriptions of the legal ruleset name 0.5.1 as the default.
- **Replay (2026-10-06).** `rule_now` now reads with `legal@0.5.1`, so a banked legal replay that carries it names
  "today's default legal@0.5.1" and, where 0.5.1 reads an item differently from 0.5.0, says so. The verdicts themselves are
  unchanged.

## Numbers that cannot be represented exactly, one key fingerprint, the receipt ledger, the HTTP server, and one word for can't tell, unreleased (2026-10-06, fifth pass; the engine stays 0.6.0; docs/REPLAY.md, docs/DEPLOY.md, packages/receipts)

An outside engineer found a bill whose unit price JSON cannot hold passing its line check, one key with two fingerprints, a
receipt ledger cut at its end with its head record deleted that verified, and an HTTP server that answered any Host and read
a text/plain body as JSON. Three entries change the bytes of a 0.6.0 verdict, and only for the inputs they name: a string
amount with more digits than a double holds, a parsed number past 2^53 − 1 given to the library, and the filing comparison's
explanation. No other verdict's bytes, id or outcome change, and a verdict of an earlier engine re-performs as issued.

- **A number that cannot be represented exactly is refused before hashing (2026-10-06).** `JSON.parse` reads
  `9007199254740993` as `9007199254740992`, so a bill with that unit price and an amount of `9007199254740992` passed its line
  check, and the verdict recorded a figure the file does not hold. Now a JSON number whose text names a decimal other than the
  double it reads as is refused with its JSON path and the words "a number that cannot be represented exactly; write amounts
  as strings with two decimals": exit 3 on the command line, a 400 over HTTP (code `body.inexact_number` with error codes on),
  a parse error over MCP (the engine's server and the receipts server), and a REFUSED case in a folder or `.jsonl` replay.
  `6125`, `6125.0`, `6.125e3` and `-0` are accepted, as before; `1e999` keeps its own refusal. `6125.0000000000001`, which
  REPLAY.md used to list as the same input as `6125`, is now refused.
- **The library refuses a parsed number past 2^53 − 1 (engine 0.6.0, 2026-10-06).** `verify()` and `verifyDeclarative()` have
  no text to compare, so from engine 0.6.0 they refuse a number whose magnitude is past 9007199254740991, naming its path:
  it may already have been rounded. An earlier engine reads it as before.
- **A string amount with more digits than a double holds is can't tell (engine 0.6.0, 2026-10-06).** `"9007199254740993.00"`
  was read as 9007199254740992. Under engine 0.6.0 the built-in rulesets' strict reading and the declarative reading treat it
  as not a number, so every check that needs it answers INSUFFICIENT_DATA (UNPARSEABLE); a line total computed from it goes
  with it. Amounts with two decimals and up to 13 digits before the point always read exactly.
- **One fingerprint per key (2026-10-06).** `verify replay`, `--trusted-key`, the key registry, `riposte-ledger` and a refused
  ruling's message all print and pin sha256 over the key's DER bytes, 64 hex (`openssl pkey -pubin -outform DER | sha256sum`).
  Replay used to print sha256 of the DER's base64 text, and the ledger the first 16 hex of the DER hash. `riposte-ledger
  fingerprint` prints the full value; `--short` adds its first 16 characters for display. The older form is still accepted by
  `--trusted-key` in this release, with a note naming the fingerprint to pin and `envelope.older_fingerprint_form: true` in
  the JSON, and an arbitration move naming its signer in it is still read.
- **The receipt ledger answers the chain, the signatures and the anchor apart (2026-10-06).** `verifyChain` and
  `riposte-ledger verify` report `chain_ok` (links and hashes only), `signatures_ok` (every signature, and the `--key`) and,
  with `--head`, `anchor_ok`. An intact chain checked against the wrong key read `chain_ok: false`; it reads `chain_ok: true,
  signatures_ok: false`, and the first line says NOT VERIFIED and that the chain holds, where it said BROKEN. `ok`, `reason`
  and the exit code are unchanged.
- **A ledger with no head record does not verify (2026-10-06).** `riposte-ledger verify` and `riposte-replay --ledger` fail
  (exit 1, in words) when the head record beside the file is missing, so a file cut at its end with its record deleted too no
  longer verifies. `--no-sidecar` verifies without it and says so. `riposte-ledger summary` still only reports it.
- **The HTTP server answers only its own names, and reads only JSON bodies (2026-10-06).** `verify serve` and the managed tier
  answer a request only when its Host header names localhost, 127.0.0.1, ::1, the address bound (any address of the machine
  for 0.0.0.0 or ::), or a name given with the new `--allow-host`; any other is 421, in words. A request body is read only when
  sent with `Content-Type: application/json`; any other type, or none, is 415, in words. With error codes on, the answers carry
  `request.host_not_allowed` and `body.unsupported_media_type`.
- **Each server's OpenAPI lists what it serves (2026-10-06).** `GET /v1/openapi.json` from `verify serve` no longer lists
  `/v1/ledger/*`, `/v1/voice/{workflow}`, `/v1/queue/{workflow}` or `/v1/grant/cosign`, which only the managed tier with a ledger
  serves; that tier's spec lists them.
- **One word for can't tell in the agent tools, the gate and the Stop hook (2026-10-06).** `check_done`, `check_claims`,
  `model_attest`, `riposte-claims`, `riposte-attest`, the Stop hook and its Codex, Cursor and OpenCode ports, and the decision
  gate answer INSUFFICIENT_DATA where they answered ABSTAIN. The gate's outcomes are PROCEED, HOLD and INSUFFICIENT_DATA. Exit
  codes do not change. A receipt written before still verifies byte for byte and reads as INSUFFICIENT_DATA. The model-switch
  monitor and its report are version 0.2.0 for the same rename. The delivery facts are `nunchi-facts-v1`, so a facts hash
  taken before differs.
- **`verify twin` says INSUFFICIENT_DATA (2026-10-06).** Its judgments say INSUFFICIENT_DATA where they said ABSTAIN. Under
  engine 0.6.0 a claim's explanation ends "can't tell." where it ended "abstaining."; earlier engines keep their text, and no
  outcome, value or id moved.
- **Notices and the ledger report (2026-10-06).** A notice reads "INSUFFICIENT_DATA: surfaced, not held". The report's section
  is "FAIL / INSUFFICIENT_DATA notices, by rung", and the workflow count field is `insufficient_data`, where it was `abstain`.
- **Evaluation scorers (2026-10-06).** Langfuse's category, Braintrust's metadata and the `riposte-score` output say
  INSUFFICIENT_DATA. The coverage count is `insufficient_data`. The Inspect answer is INSUFFICIENT_DATA with reason
  `insufficient_data`. An older input saying ABSTAIN is still read.
- **The synthetic pilot month plants what the gate gained (2026-10-06).** `riposte-pilot synth` appends, after every earlier
  bill and application (which are unchanged, byte for byte): a paid bill re-sent with a leading zero in its invoice number; tax
  at exactly 8.25% and at 9.5% on a PO with no tax terms; a pay application whose scheduled value rose with no change order;
  and two legitimate applications that must pay (a new change-order line; stored materials installed, column D as the form
  says). Every tax plant's truth carries `by_tax_rule`, its right answer under `person`, `allow` and `rate:8.25%`, so a run
  that froze another tax rule is scored by it. `--format generic-csv` writes the same month in this package's CSV columns,
  with each PO line's `invoiced_quantity`, where a PO line billed again across bills is caught. `riposte-pilot score` counts a
  legitimate application that pays as right, and one stopped with the clean applications. A month asked for 300 bills now
  holds 327. Requests to change bank details and look-alike senders are not planted: only an emailed bill carries them.

## Wording: older entries name the cold readers as AI agents, unreleased (2026-10-06, fifth pass; the engine stays 0.6.0; docs/RULESETS.md)

Entries below, and docs/RULESETS.md, called the readers of cold review "an outside reviewer", "an outside controller" or "an
outside engineer". Each was an AI agent given a buyer's or a reviewer's role that had not worked on this tree; the
maintainers dispatched it, so it was not independent of them. Those sentences now say so (2026-10-06). No verdict, ruleset or
count changed.

## Bench check, the AP stress rows and the misses ledger, unreleased (2026-10-05, fourth pass; the engine stays 0.6.0; docs/BENCH.md, docs/MISSES.md, docs/bench/ap-blind/STRESS-AMENDMENT-2026-10-05.md)

A cold reader (an AI agent in a methods reviewer's role) found that this tree no longer reproduced its own stress byte-identity claim after an AP change,
while `bench check` said ALL MATCH because the stress study is not a table; that `bench check` exited 0 while printing NEED A
STAMP; and that the stamp rule, the misses ledger's "append-only" and two hash lists were stated without what qualifies them.
None of these entries changes a verdict's bytes, id or outcome.

- **`bench check` compares the AP stress rows with the tree (2026-10-05).** A tables directory may declare banked stress rows
  in `docs/bench/_stress.json` (the rows' folder and the AP pack's folder, from the repository root, and the banked files).
  `bench check` then reads every row and compares its `checker_sha256`, engine version and AP ruleset with what this tree
  builds, using the one digest function the stress harness also uses (`apPackDigest`, exported). A mismatch reads DIFFERS,
  names both digests, says what to do, and exits 1. `--stress <dir>` and `--pack <dir>` point the check at another layout.
- **`bench check` exit codes (2026-10-05).** 0 when every table and the stress rows match and no prereg needs a stamp; 1 on
  any DIFFERS, refusal or failure; 4 when everything matches but a prereg NEEDS A STAMP; `--allow-unstamped` accepts those
  knowingly and exits 0; 3 for usage. NEED A STAMP used to exit 0, so a CI step could not enforce the stamp rule.
- **The stamp line says what it means (2026-10-05).** For a prereg frozen before stamping began, `bench check` prints "prereg
  frozen before stamping began on 2026-10-05, so no stamp predates its run; stamped after: PREREG.md.tsr signed …, signature
  and chain verified", where it printed "prereg unstamped …" beside "stamp … verified".
- **BENCH.md states the stamp rule with its exceptions (2026-10-05)**, computed from the tables so the list cannot go stale:
  the run that broke the rule (legal-blind-2-030, stamped 81 minutes after its run), a run made that day before the first stamp
  (legal-blind-2), and the misses-only scope notes that read NEEDS STAMP until they are stamped.
- **Hash-list notes (2026-10-05).** A run spec may carry `hash_list_note`, printed as **Hash list:** beside the prereg. The
  first legal blind set's table explains its superseded first hash set (42 seconds earlier; the manifest's hash changed, and
  the first manifest was not kept), and the closed-loop table explains the lines appended to its hash list on 2026-10-05.
- **The purchase-log table (2026-10-05)** lists its log-agreement row, the only check against something outside the run,
  first, and says its preregistered primary metric re-counts the check's own rule. No count, bar or verdict changed.
- **MISSES.md (2026-10-05)** says what append-only means, and that someone who edits a table's folder, the table and the
  ledger together can drop a row and pass both checks until a copy outside the authors' hands exists.
- **Outside the rule (2026-10-05)** lists the numbers of legal@0.4.0 and of legal@0.5.0, which took the default from it the
  same day, each as post-hoc on a half already seen, and the briefs of the third cold reader in the legal role (an AI agent) under both rules.
- **Misses ledger (2026-10-05).** The defects found in cold review round 4 are a new misses-only table, `cold-review-r4` (60
  rows, all open). 48 round-3 rows record the fix that reached the released tree. The ledger holds 403 rows, 210 of them fixed.
- **The AP stress rows re-banked (2026-10-06, 00:18Z).** The banked rows named the pack digest of nine source files
  (`29644c7f…`); the tree had eleven, and now thirteen (`fd0e639d…`). All 3,000 rows were re-run and re-banked: no decision
  moved, 956 rows' reasons changed wording (the total and price messages), and a fresh run of each seed is identical, 30 of
  30. The amendment says that the vendor check's reading of a noisy sender line was settled with these seeds' results in view.

## HTTP server, receipts ledger, shadow pilot and the example workflow, unreleased (2026-10-05, fourth pass; the engine stays 0.6.0; docs/DEPLOY.md, packages/receipts PILOT.md, docs/GITHUB-ACTION.md)

Cold readers (AI agents in buyers' and reviewers' roles) found an HTTP server with no start command that listened on every interface, a ledger check whose JSON said
ok beside a failing exit code, a synthetic month that planted only what the gate already checked, and an example workflow
that pinned other people's actions by tag. None of these entries changes a verdict's bytes, id or outcome.

- **`verify serve` starts the HTTP server, on 127.0.0.1 (2026-10-05).** `verify serve [--port N] [--host ADDRESS]` runs the
  engine's pure core over HTTP until stopped. With no `--host` it binds 127.0.0.1, so only programs on the same machine can
  reach it. Any other address is taken only when given, and a warning line says the server has no authentication. Before,
  there was no subcommand, and `node dist/http/serve.js` listened on every interface (0.0.0.0 and [::]); it now binds
  127.0.0.1 too. The library's `serve()` and `serveService()` bind 127.0.0.1 when no host is given. A port in use exits 3 and
  says so. The container image runs `serve --host 0.0.0.0`, because a published port cannot reach 127.0.0.1 inside a
  container, and prints the same warning; docs/DEPLOY.md publishes it on the host's loopback.
- **`riposte-ledger verify`: the JSON's `ok` is the exit code's (2026-10-05).** A torn tail, or a proof that does not bind,
  left `"ok": true` on stdout beside exit 1, and the first stderr line read `OK`. Now `ok` is true exactly when the exit is 0,
  `reason` names what failed first, `chain_ok` is the hash chain's own answer, and the first line reads `NOT VERIFIED: torn
  tail.` (or names the proofs that do not bind).
- **The synthetic month plants what the gate never checked (2026-10-05).** Appended after the month's bills, so every earlier
  bill is unchanged: a bill from another vendor than its PO's, tax on a PO with no tax terms, freight on a PO that does not
  say, and a PO line billed again across bills (a gap the check states, which the score marks as such); with pay
  applications, retainage withheld under the stated rate. `riposte-pilot score` sorts the report's "would have stopped N of
  the bills your team paid" into planted problems the team paid by mistake and clean bills.
- **The Ramp mapper reads expense lines beside inventory lines (2026-10-05).** A bill with both had its expense lines (tax,
  freight, any charge without a PO line) dropped, so its total no longer added up and the hold gave the wrong reason. Every
  line is now read. One expense line whose whole memo names a freight charge ("Freight", "Shipping & handling") is the bill's
  freight, which the freight rule decides; any other expense line matches no PO line, so the check sends the bill to a
  person and names the line.
- **The shadow report says once what a stopped paid bill can be (2026-10-05).** "Each of the N is one of two things: a problem
  your team paid by mistake, or a good bill the gate would have held up." Under `--hashes-only`, a bill sent to a person is
  explained by rule ids and reason codes, never by the check's wording, which can name vendors.
- **The filled pre-registration holds no literal `<fill:` (2026-10-05).** The instruction line describes the blanks instead of
  quoting one, so a search for unfilled blanks finds none once they are filled.
- **The example workflow pins third-party actions by commit SHA (2026-10-05)**, each with its release tag in a comment:
  `actions/checkout` v6.1.0, `actions/setup-node` v7.0.0, `github/codeql-action/upload-sarif` v4.38.2 and
  `actions/upload-artifact` v7.0.1, checked against GitHub on 2026-10-05. docs/GITHUB-ACTION.md shows the same pins.

## Accounts payable and pay applications, unreleased (2026-10-05, fourth pass; the engine stays 0.6.0; docs/AP-INPUT.md, packages/receipts PILOT.md)

A cold reader (an AI agent reading as a controller) found five things: a bill from another vendor than its PO's was approved, with
neither vendor shown; tax on a PO with no tax terms was approved; a pay application stating 10% retainage and retaining 5% on
every line passed silently; a bank-account number was read as a stated total; and every freighted Ramp bill went to a person.
Under engine 0.6.0 every AP verdict id and every pay-app verdict id moved again, because their remedy tables changed. Engines
0.0.1 to 0.5.0 re-perform their verdicts byte for byte.

- **The vendor check (2026-10-05).** `ap.vendor` (rule AP_VENDOR_MATCH) compares the bill's vendor with the PO's by the
  duplicate check's comparison: tax id, vendor id, the normalized name, then the look-alike rules. One supplier passes.
  Anything else goes to a person, naming both vendors; the AP controller may clear it. A PO that names no vendor is not
  compared, and `not_checked` says so. On the text path the check reads whether the invoice names the PO's vendor, on a line
  or in a sender's address built from the name, allowing one swapped letter pair. It is after the total check in order, so a
  hold on another check stays the label, and the hold's reasons end with the open vendor check.
- **The tax check (2026-10-05).** `ap.tax` (rule AP_TAX) runs on a structured bill that carries `tax`. A PO with no tax terms
  sends it to a person, naming the amount. A PO stating a rate of 0 holds it as `hold_total`. A stated rate passes the tax
  within the price tolerance of the rate times the taxable lines, and anything else goes to a person. The buyer may clear it.
  Two optional input fields state the terms: `purchase_order.tax_rate` (a fraction) and `purchase_order.line_items[].taxable`.
  A bill with no `tax` field gets no tax claim.
- **Retainage: the stated rate applies (2026-10-05).** The ceiling reading of the third pass is withdrawn. A line retains less
  only where the application says so: its own `retainage_rate`, a `reduced_retainage_rate` the application states (with
  `reduced_retainage_items`), or a complete line beside lines still at the rate. Anything else under the rate, uniform
  under-withholding above all, goes to a person, and the words lead with the dollar difference ("13,741.25 less retained than
  the stated 10% ..."). With no rate on the application, last month's stated rate applies. Every line at the rate with only
  the total short still fails. The missing-operand remedy names the new fields.
- **Stated totals on the text path (2026-10-05).** A stated total is an amount on a total line, never an account, routing,
  phone, ZIP or reference number on it; a total line with no such amount is not a total. "Please remit to our new bank
  account ending 9921" is no longer a second stated total.
- **The freight rule (2026-10-05).** `ap --freight allow|person` sets what happens to freight on a PO that does not say:
  `person`, the default and the behaviour before, or `allow`, which adds it to the total. A PO that says no is never
  overridden. `allow` is bound into the verdict's `input_hash` and carried as the proof's `inputs.policy.freight`; `person` is
  not written, so a default run hashes as before. Engines up to 0.5.0 refuse `allow`. The shadow pilot registers the rule in
  its pre-registration, records it in each receipt, and reads one Ramp expense line whose whole memo is a freight charge's name as the bill's
  freight.
- **What the AP block prints (2026-10-05).** Both vendors are the first lines under "Lines read" on every answer. A "Tax:"
  line says what tax the bill carries, and a "Freight:" line says who allowed the freight. "Not checked" names the per-line
  netting gap whenever an earlier bill is booked on the order.
- **Pay applications in a clerk's words (2026-10-05).** Every PASS reads in the form's words ("earned less retainage minus
  previous certificates is 130,342.50, as the current payment due says"), never "Law of …: All predicates satisfied". The
  console prints a "Retainage:" line when the check passed, and a check that ran and needs a person prints under "A person
  decides", apart from checks that could not run.
- **Identity (2026-10-05).** The pinned AP gate id in the receipts checker-stamp test moved from 0d6f43eb… to 768b5c8f…,
  repinned by hand with the reason and the fields that moved. The engine 0.6.0 pay-app example ids moved from 72893cb8… and
  49f7c1bd… to 742f0af5… and f9bbd336…. The AP pack now has 13 source files (vendor.ts and tax.ts are new), so its source
  digest moved; on the 3,000 stress rows no decision moved.

## Legal rule 0.5.0, and replay's reading of an older legal rule, unreleased (2026-10-05, fourth pass; the engine stays 0.6.0; docs/LEGAL.md)

A cold reader (an AI agent in a legal-operations director's role) found words from West headnotes, the West synopsis, the syllabus, a Lexis headnote and a
dissent passing as the opinion's, under the claim name "Citation quoted accurately". Full citations with a pin page found no
text, a Lexis header as delivered refused every citation of its text, and a genuine quotation across a Lexis `n7` FAILed. A
cold reader in an engineer's role (an AI agent) found that a replay of a verdict under an older legal rule said nothing about it. The fixes are a new ruleset
version, `legal@0.5.0`, the default for a new legal verdict under engine 0.6.0, and two replay additions outside the hashed
verdict. A verdict that names `legal@0.4.0` or earlier replays under that rule, byte for byte.

- **Whose words (2026-10-05).** `legal@0.5.0` reads the text's sections: editorial matter, the majority opinion, separate
  opinions, unassigned footnotes, the header. It checks a quotation against the majority opinion. Words found only elsewhere
  answer can't tell (`SPAN_NOT_FOUND`), naming every section that holds them and the line: "the quoted words appear in the West
  headnotes (line 17), not in the opinion". Where the majority opinion also has them, it PASSes. A cite whose parenthetical
  names a separate opinion ("(Brennan, J., dissenting)") is checked against that opinion. The verdict records the sections it
  read (`opinion_sources[].sections`).
- **Every PASS says where it matched (2026-10-05).** "Found in the majority opinion, line 17 (character offset 1849).", and "The
  pin page 248 is not checked." when the cite carried one. Under an opt-in older rule the citations report prints "found at:
  line N of <text> (character offset X)" under each PASS, from its evidence.
- **The cite lookup (2026-10-05).** A citation's text is found by its reporter citation, with the pin page, case name and
  parenthetical read off ("Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)" finds the text keyed "477 U.S. 242").
  A miss says "no supplied text matched the cite as written (looked for: …; texts supplied: …)". The report prints how each
  citation was read, and names a full citation's case name once.
- **Lexis as delivered (2026-10-05).** The citation line after a Lexis header's "Reporter" heading binds, so the vendor's file
  needs no edit. Every footnote-call form that is not read out on its own, including a standalone `n7` and superscript digits,
  answers can't tell naming the token, never FAIL.
- **The claim name (2026-10-05).** `legal@0.5.0` claims are named "Quotation found as quoted in the supplied text". Verdicts
  under earlier rules keep "Citation quoted accurately".
- **Replay says how today's default reads an older legal verdict (2026-10-05).** When a legal verdict names an older rule and
  today's default reads its inputs differently, the replay prints a second line under its headline, and a folder replay under
  each case: "under today's default legal@0.5.0 this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not PASS".
  Its JSON carries the same as `rule_now`. This adds a field to the replay JSON of such cases. Of the banked legal replay sets,
  103 of 118 cases carry it, and each is otherwise byte for byte as banked.
- **`verify replay --require-ruleset '<ruleset>@>=<version>'` (2026-10-05).** It fails, with exit 1 and in words, a replay whose
  verdict names that ruleset at an older version; a folder replay marks each such case REQUIRED. It is repeatable and applies to
  its own ruleset id only. Without it, nothing a replay prints or exits changes.

## Replay names its rule version and a missing issued_at, unreleased (2026-10-05, fourth pass; the engine stays 0.6.0; docs/REPLAY.md)

Cold readers (AI agents) found three things a replay did not say. Its VERIFIED line did not name the rule version that decided the
outcome. A verdict with its `issued_at` removed replayed with no word about it unless `--strict` was given. And a replayed AP
proof printed "This is a check, not a decision." beneath the gate's APPROVE or HOLD. These entries change what a replay
prints on stderr. They change no verdict's bytes, id or outcome, and no replay's exit code. A script that compares a
replay's first line word for word will see the first change.

- **The VERIFIED line names the ruleset and its version (2026-10-05).** It read `re-performed with legal (engine 0.6.0)`; it
  now reads `re-performed with legal (ruleset legal@0.0.1, engine 0.6.0)`.
- **A missing issued_at is named without --strict (2026-10-05).** A matching verdict that carries no `issued_at` ends its
  VERIFIED line `the verdict carries no issued_at (every verdict records when it was issued; --strict fails it)`, where it
  said `issued_at aside`. In a folder the same words follow its MATCH line. `--strict` still fails it, exit 1.
- **A replayed AP proof says how the check and the gate's decision relate (2026-10-05).** Its closing scope line reads
  `This re-performs the check; the APPROVE or HOLD line is the gate's decision on it.` where it read `This is a check, not a
  decision.` The verdict's own `scope.statements` are unchanged, and every other verdict keeps the line.

## Replay, one word per answer, and messages, unreleased (2026-10-05, third pass; the engine stays 0.6.0; docs/REPLAY.md)

Cold readers (AI agents) found a replay that matched a bundle whose remedies had been deleted, one answer printed under several names,
commands that disagreed about which stream carries the words, and messages in the engine's own vocabulary. The replay and
output entries change no verdict's bytes. The last two entries change the text of a 0.6.0 verdict, never its id, its outcome
or a value: a 0.6.0 verdict issued before them, with a check that could not run on a numeric date or an e-invoice figure
printed with no two decimals, no longer replays byte for byte. Every banked replay set replays as before, case for case;
the 62 banked legal cases that are can't tell now print `INSUFFICIENT_DATA` as their JSON `answer`, where they printed `ABSTAIN`.

- **Replay refuses a verdict whose remedies were deleted (2026-10-05).** A verdict of engine 0.0.1 or 0.1.0 does not bind its
  remedy table, so one with its `remedies` removed used to replay as a MATCH, exit 0, with a note. It now fails at `remedies`
  (exit 1; DIVERGED in a folder): "the verdict carries no remedies; the engine re-derives 1 remedy for it (engine 0.0.1); a
  replayed verdict must carry what it said". `verify replay --lenient-remedies` (library: `lenientRemedies`) restores the old
  reading for a verdict issued before remedies existed, and `--strict` still fails it. The HTTP and MCP replay routes take the
  default. This closes miss F18. Engine 0.2.0 and later already refused it.
- **One word for can't tell in replay and e-invoice output (2026-10-05).** The replay JSON's `answer` says `INSUFFICIENT_DATA`
  where it said `ABSTAIN`, and an AP proof's gate line says `A PERSON DECIDES (gate: a check could not decide)` where it said
  `ABSTAIN (gate: a person decides)`. `verify twin-einvoice` writes `INSUFFICIENT_DATA` in its `judgments` and `consistency`
  where it wrote `ABSTAIN`; its verdict always said `INSUFFICIENT_DATA`.
- **`verify twin-einvoice` says its answer on stderr and fails closed (2026-10-05).** The JSON stays on stdout. Stderr now
  carries the headline (`FAIL: 1 of 8 checks failed`) and one line per claim in words. The exit code reads the gate as `check`
  does: a PASS with a claim it could not judge exits 2, where it exited 0.
- **The CLI says when it was imported instead of run (2026-10-05).** The command line runs when `argv[1]` names `cli.js` or
  `cli.ts`, or is a link to it (an installed `riposte-verify` symlink). A script that only imports the module and never calls
  `run()` used to end with exit 0 and no output; it now prints that no command ran, how to wrap the CLI, and the usage, and
  exits 3.
- **A check that could not run says can't tell in words (engine 0.6.0, 2026-10-05).** A TIME_ORD claim on a numeric date read
  "Law of Temporal Order VIOLATED: Type mismatch for >= comparison" with outcome INSUFFICIENT_DATA. Under engine 0.6.0 every
  INSUFFICIENT_DATA claim whose explanation said a law was VIOLATED now says what could not be checked and why: "Can't tell
  whether the service date falls within the contract's term: the service date reads "1769922000000", which is not a date, so
  nothing was compared." The insufficiency's reason and detail are unchanged. Earlier engines keep their text.
- **Why a printed figure was not read (engine 0.6.0, 2026-10-05).** When a field's label heads a line whose figure has no two
  decimals, the detail and the remedy now say so: "the line prints "20": an amount needs two decimals, so "20" is read as not
  strict, never as 20.00". Before, they said only "no value was read". Earlier engines keep their text, so the frozen e-invoice
  verdict in the replay pack reads as it was issued.

## Receipts ledger, shadow pilot and GitHub Action, unreleased (2026-10-05, third pass; the engine stays 0.6.0; packages/receipts PILOT.md, docs/GITHUB-ACTION.md)

Cold readers (AI agents) found a signed ledger that did not notice a receipt cut from its end, pilot receipts whose first field
disagreed with the report, and a CI step that passed on can't tell. None of these entries changes a verdict's bytes: they
change the receipts package, the shadow pilot's receipts and wording, and the GitHub Action.

- **The receipt ledger notices a cut at its end.** `riposte-ledger verify` reads the head record beside the ledger
  (`<ledger>.head.json`, which the receipts file store rewrites after every append) unless `--no-sidecar` is given. A file with
  fewer entries than the record, or another entry where the record's head should be, does not verify (exit 1), and the first
  line says so in words. Before, a four-entry signed ledger cut to three in place verified OK with the issuer's key pinned. With
  no record, verify says that truncation cannot be detected without an anchor. The record sits beside the file, so whoever can
  rewrite the file can rewrite it too: it adds a refusal and never removes one, and `--head`, a head recorded somewhere you
  control, stays the anchor. `riposte-ledger summary` and `riposte-replay --ledger` read the record the same way.
- **A pinned key needs every entry signed by it.** `riposte-ledger verify --key`, `verifyChain` with `publicKey` and the MCP
  tool `ledger_verify` with `public_key` now refuse an unsigned entry, as `verifyEntry` already did. Before, a rewritten ledger
  with its signatures stripped passed `--key` alone.
- **`riposte-ledger --help`** says how a ledger is written (the tools that append, and the library call) and what each check
  catches and does not.
- **Shadow pilot receipts say first what the report counts.** Each bill's and each pay application's receipt now starts with
  `disposition` (`pay`, `hold` or `person`), and `action` and `effect` are its WOULD_ words. The live gate's reading of the
  buyer's own decision moved, named, to `shadow.on_buyer_decision`, and `shadow.would` is gone. Before, 34 of 300 receipts in
  one synthetic month said WOULD_REVIEW at the top while the report counted them held or paid. `riposte-pilot report` refuses
  receipts whose first field and shadow block disagree. Receipts written before are recounted from their shadow block, as before.
- **The audit sheet says a failed total in words**, read from the claim's own numbers: "lines add to 20,961.36; the bill says
  21,078.97; over by 117.61". Under engine 0.6.0 the verdict's explanation says the same (see "The total check in a clerk's
  words" under accounts payable); the sheet reads the claim's numbers either way, so a verdict from an earlier engine reads the
  same on the sheet. The report's "What this did not check" list repeats PILOT.md's, now with quantities netted against the
  order's total rather than each line, and retainage read as a ceiling. The report names the run's head to record, and what a
  key does not catch.
- **The GitHub Action fails closed by default.** `fail-on` defaults to `insufficient-data`: the step fails on a FAIL, on can't
  tell (a PASS with a check that could not run included) and on a file that could not be checked, as the command-line checks
  do. `fail-on: fail` loosens it to FAILs only. The Action's inputs, outputs, SARIF results and job summary say
  INSUFFICIENT_DATA or can't tell instead of ABSTAIN: the output `abstain` is now `insufficient-data`, `outcome` can read
  PASS-WITH-OPEN, and the old value `fail-on: abstain` is still read. `riposte-sarif` has the same default.

## Legal rule 0.4.0, unreleased (2026-10-05, third pass; the engine stays 0.6.0; docs/LEGAL.md)

A cold reader (an AI agent in a legal-operations director's role) found a misleading quotation that passed as "verbatim", genuine quotations of Westlaw and
Lexis texts that failed, and short forms and headers the check refused with the wrong reason. The fixes are a new ruleset
version, `legal@0.4.0`, the default for a new legal verdict under engine 0.6.0. A verdict that names `legal@0.3.0` or earlier
replays under that rule, byte for byte; the banked legal replay sets replay as before.

- **A quotation that begins mid-sentence is read for what it cuts.** "the motion to amend must be granted", quoted from "Unless
  the movant shows actual prejudice, the motion to amend must be granted.", passed under `legal@0.3.0` as "verbatim", while the
  same cut with "[T]he" was held. Under `legal@0.4.0` the part of the sentence before such a quotation is read as the capital
  guard reads it, and the answer is can't tell (SELECTIVE_QUOTE) when it opens with a condition word ("Only", "Unless",
  "Except", "If", "Absent", "Provided", "Where", "When", "To the extent", …), ends with a set-off clause holding one, or carries
  a negation in the quotation's own clause. "The panel held that " before a quotation is no condition and still passes.
- **Star paging and footnote numerals.** `*248`, `**2510` and `[*249]` between words, and a numeral glued to sentence
  punctuation (`counted.4 This`), are read out of the comparison on both sides and named on the answer ("read with star paging
  ignored (*248)"). A quotation that matches only once a looser token is read out (`counted4`) answers can't tell
  (UNPARSEABLE), never FAIL. The supplied text and its hash are unchanged.
- **The named passage is whole sentences, and a FAIL names the words that differ** ("the text has "30" where the quotation
  has "60""), in the explanation and in the remedy (computation operand `differs`). The passage never shows a page mark or a
  caption line. Under `legal@0.3.0` a passage carried two words of margin and could open on "2025)" or close on "… and the".
- **Short forms.** "477 U.S. at 248" is read as a pin cite to the one full citation of the same brief it can point to (the
  naming records `short_form`). Otherwise, and for "Id." and "supra", the answer is can't tell: "short form; supply the full
  citation", with its own remedy (missing `full_cite`).
- **Words.** A citation line printed outside the caption window is named as such ("sits 5 lines below the case name, outside
  the caption window") instead of "the text cites it in its body"; no doubled period after "Co." or "Inc.".
- **The `citations` verb follows the one stream rule.** The report a person reads goes to stderr; with `--json`, the verdict
  goes to stdout. Before, the report went to stdout without `--json`: a script that read the report from stdout reads stderr
  now. Each line says PASS, FAIL or INSUFFICIENT_DATA (it said ABSTAIN), and the headline says PASS-WITH-OPEN (it said
  PASS_WITH_OPEN); the JSON is unchanged.
- **Replay names the opinion text that moved.** When a legal verdict's citations agree with its inputs and its input_hash does
  not, `verify replay` compares each supplied text's sha256 and stated origin with the verdict's `opinion_sources` and names
  the one that differs. It used to say that the verdict does not record the opinion sources, which a 0.6.0 verdict does.
  Verdicts of earlier engines record none, and keep the old reason.

## Accounts payable and pay applications, unreleased (2026-10-05, third pass; the engine stays 0.6.0; docs/AP-INPUT.md)

A cold reader in a controller's role (an AI agent) wrote, in ten minutes, a bill the AP gate approved that paid for goods not received (the over-billing was
spread across two bills on one order). A legitimate retainage reduction failed, the price tolerance could not be set, and a
failed pay application printed only a count. These entries change what 0.6.0 verdicts say, and some of their ids: the AP and
pay-app remedy tables gained entries, so the `remedy_table_hash`, and the verdict id, of every AP and pay-app verdict under
engine 0.6.0 moved. Verdicts of
engines up to 0.5.0 are unchanged and replay byte for byte; no banked replay set holds a 0.6.0 AP or pay-app verdict.

- **The PO balance check.** With a payment history, a new claim, `ap.po_balance` (rule AP_PO_BALANCE), nets what is already
  booked on the bill's order: every booked row on this PO (same vendor, PO numbers compared without case, spaces or
  punctuation) plus this bill's lines, against Σ PO quantity × unit price. Over the order, a person decides, never an automatic
  hold, in words that name each booked invoice, its amount and the order ("already booked 1,200.00 on PO-7001 (GS-2210); this
  bill 1,400.00; the order totals 2,000.00"). The buyer may clear it. It is last in the decision order, so a hold on any other
  check stays the label. A booked row with no PO number is counted as if it were on this order, and the bill passes only if it
  fits even then; a row on the order with no amount sends the bill to a person, naming it. A row under the bill's own invoice
  number is left to the duplicate check (an exact repeat stays `hold_duplicate`). It nets amounts on the order, not quantities
  on a line: the payment history carries no lines, and that gap is listed under what the checks do not check. Without a
  payment history it does not run, and `not_checked` says so.
- **`no_purchase_order` on a payment-history row** (optional, additive to `riposte.ap-input/0.1.0`): true when the invoice was
  booked without a PO, so the balance check does not count it against any order. The shadow pilot sets it, and sets each
  history row's `purchase_order_number`; without them a vendor's non-PO bill sent its later clean bills to a person.
- **The price tolerance is a parameter.** `ap --price-tolerance <fraction>` (or `5%`; default 0.02) sets how far a unit price
  may run over the PO's before a hold. It is an input of the verdict: `input_hash` binds it, the proof carries it as
  `inputs.policy`, and a replay re-performs it. A tolerance that is not a finite number of at least 0 is refused, under every
  engine (Infinity and NaN used to hash alike). Under 0.6.0 the price claim names it ("max 204.0000 at the 2% price
  tolerance"). The shadow pilot registers it in the pre-registration, frozen before the run, and records it in each receipt.
- **The total check in a clerk's words** (0.6.0): "The lines add to 20,961.36; the bill says 21,078.97; over by 117.61." It used
  to read "Stated total 21078.97; lines 20961.36 = 20961.36. Does not add up."
- **`ap --history -`** reads the booked invoices from stdin; only one input may come from stdin in a run.
- **Retainage: the stated rate is a ceiling (pay-app, 0.6.0).** Retainage under the stated rate that the lines themselves carry
  (column I) and that adds up to the total passes, and the check names each line that retains less, with its rate. Under the
  rate, where the application's own figures do not account for it, a person decides, with both figures; the owner may clear
  it. With no rate stated, the lines' own retainage is read and each line's rate listed, instead of a can't tell. Retaining more
  than the rate, or every line at the full rate with only the total short, still fails. When the previous application states
  another rate, the check says so.
- **A pay application prints a plain-English block on stderr**, as `ap` does: each failed or open check, the fields it read,
  who may clear it, and what would settle it. A check that could not run says what to supply in a clerk's words ("the
  retainage rate (for example "10%") is not on the application. Supply retainage_rate, or each schedule line's retainage
  (column I)"), never "Cannot evaluate: missing bindings for EXPECTED_RETAINAGE_TOTAL". The JSON on stdout is unchanged.

## 0.6.x patch, unreleased (2026-10-05, second pass; the engine stays 0.6.0; docs/REPLAY.md, docs/VERDICT-SCHEMA-v0.md)

A cold reader in an engineer's role (an AI agent) found three ways to make one verdict_id name two different engine outputs, all outside the CLI's own file
reads, and cold readers (AI agents) found the CLI failing open by default. The entries up to "One list of ruleset names" change no
verdict's bytes: every input that issued a verdict before issues the same verdict. What they change is what is refused, and how a
caller is told to act on a verdict. The last two entries do change what a verdict says: the legal entry adds a ruleset version
and makes it the default for a new legal verdict, and the pay-app remedy entry changes the remedy text, and so the verdict id, of a
pay-app verdict under engine 0.6.0. Every banked replay set replays as before (none holds a 0.6.0 pay-app verdict), because a
replay re-performs a verdict under the ruleset version and engine it names. Because 0.6.0 is not released (see the top of this
page), these changes stay under the 0.6.0 label: a 0.6.0 verdict issued before them may not replay byte for byte after them.

- **Fail closed by default.** `verify check` (and `verify <doc>`) exits by the gate reading: 0 only on a clean PASS; 1 on FAIL or
  HELD-SUSPECT; 2 on PASS-WITH-OPEN, OPEN or INSUFFICIENT_DATA. Before, the exit code read `outcome`, so PASS-WITH-OPEN exited 0
  unless `--gate` was given. `--allow-open` exits 0 on an open verdict whose checks that ran all held, and says on stderr that it
  was the caller's stated choice; the verdict is the same either way. `--gate` keeps its message and exits the same way; giving
  both is a usage error. `verify ap` exits 0 only on an approve whose verdict is a clean PASS with `payable` true; a bill a check
  could not run on exits 2 and reads A PERSON DECIDES (abstain): the AP gate now abstains on it. `--gate` on `ap` is accepted and
  listed in `ap --help` (it was accepted and did nothing). On `ap`, `--allow-open` reaches one case only: a bill held because no
  payment history was given, every other check passed (`abstainsOnlyForMissingHistory`); it then exits 0, the decision stays
  `abstain`, and the decision object on stdout gains `"exit": 0, "allow_open": "stated"`. On any other abstain it exits 2 and
  says the flag changed nothing (`"allow_open": "stated, not applied"`). The text path takes `--history <file>`, a JSON array of
  the invoices already booked (`[]` = none), as the structured path's `payment_history`, so a clean text-path bill can approve.
  HTTP verdict routes add `x-verify-gate` and `x-verify-exit` headers (the status stays 200, the body is the verdict); an MCP
  verdict tool's text leads with the gate line, the JSON second. Both take `"allow_open": true`. One table serves all three:
  `src/verdict/exit.ts`.
- **A key repeated in one JSON object is refused.** JSON keeps the last value, so a signed envelope with `"outcome":"FAIL"`
  written before its real `"outcome":"PASS"` replayed as VERIFIED, signed by the trusted key, under `--strict`, while a reader that
  keeps the first key saw FAIL. Every JSON read that feeds a hash or a signature check now refuses it, naming the JSON path: the
  CLI's files and inline JSON (`parseJsonStrict`), a folder or `.jsonl` of bundles, the HTTP body and the MCP line. A library
  caller holding an envelope's text calls the new `verifyEnvelopeText`.
- **A non-finite number is refused inside `verify()`.** `verify()` never scanned for one, so through the library `total: null`
  (PASS) and `total: Infinity`, `-Infinity` or `NaN` (FAIL) shared one input_hash and verdict_id. It now refuses a non-finite number
  anywhere input_hash covers, under every engine version (`InputRefused`, naming the path). The HTTP and MCP readers decode their
  bodies as strict UTF-8 and refuse `1e999` and repeated keys before anything is verified (400 with `body.invalid_utf8`,
  `body.non_finite_number` or `body.duplicate_key` when error codes are on; a JSON-RPC parse error naming where). A replay whose
  inputs hold a non-finite number fails on the binding.
- **The tolerance override's shape is checked strictly.** `roundingCap.perLine: "TAX_INT"` (a string) and the array of its
  characters hashed alike while the engine read them differently, so one verdict_id named a PASS and a FAIL. A tolerance override
  is now refused unless `rel` and `absCap` are finite numbers of at least 0, the `roundingCap` lists are arrays of strings,
  `rounding` is `infer` or `none`, and no other key is present (`toleranceProblem`). Its identity keeps each list's type, so a
  string can never hash like its characters; a valid override hashes byte for byte as before. `verify replay --tolerance` now
  restates the whole override (it dropped `roundingCap` and `rounding`).
- **Strict replay fails on what is wrong.** `--strict` no longer fails a genuine bundle for carrying `document.producer`: it
  reports the label as a note (it is compared as carried, bound by neither input_hash nor verdict_id). It still fails on an
  annotation, re-derived remedies or an unpinned envelope, and now on a missing `issued_at`. A malformed `issued_at` (not an
  ISO-8601 timestamp, such as `{"lol":1}`) is refused, exit 3, with or without `--strict`.
- **Keys and messages.** `--trusted-key` takes an inline PEM, as docs/REPLAY.md said (`"$(cat k.pub.pem)"` and the `=` form); a
  replay of an envelope prints the full 64-hex fingerprint on stderr, and a shorter prefix is refused with the reason (a key can
  be ground to match a short prefix). A mistyped command (`verify replya x.json`) and a verdict, envelope or bundle handed to
  `check` are refused (exit 3) with the command meant, never checked as an extraction; so is a second positional argument. A
  mistyped `--ruleset` names the known rulesets; a `--source` that is not a file says it takes a file path. A usage hint names a
  command the reader can type: `node <path>/cli.js` in a source checkout, the binary's name when installed.
- **One list of ruleset names.** The CLI help, its refusals, the HTTP router and the MCP tool descriptions read the carried
  declarative rulesets from one function (`carriedRulesetNames`, `carriedDefaultVersion`). The MCP description still said
  `peppol-en16931` meant 0.2.0 after 0.3.0 became the default for new verdicts, and its name list lacked 0.3.0. The MCP legal
  description reads its default from `defaultLegalRuleset` the same way.
- **Legal: `legal@0.3.0`, the default for a new legal verdict under engine 0.6.0 (2026-10-05).** A ruleset version, not an
  engine bump. Asked for under an earlier engine, it throws. Verdicts that name legal@0.0.1, 0.1.0 or 0.2.0 replay byte for byte.
  Four changes, each from the adversarial brief of a cold reader (an AI agent):
  - **Caption binding.** A text is bound by its caption (the case name and reporter citation at its top, or a "Cite as" line
    anywhere), never by a mention in its body. The abstention says what the caption says the text is: "the supplied text is
    Cooper v. Aaron, 358 U.S. 1 (its caption); it cites Brown v. Board of Education, 347 U.S. 483 but is not that opinion".
  - **Parties-only, open.** A parties-only binding (`bind: "parties"`) is checked and left open, never PASS. The claim abstains
    with the passage found, the verdict is PASS_WITH_OPEN, and `verify citations` exits 2. Its headline counts citations bound by
    parties only.
  - **Edge conditions.** An ellipsis or a capital at an edge of a quotation is read to the sentence boundary, and a set-off phrase
    of time ("after adequate time for discovery and upon motion") in an omission is a condition. Either abstains as an "elided
    condition".
  - **Letter case.** It is compared ("case change"), and "verbatim" is said only of the same words in the same case.

  On the reviewer's 26 citations: wrong opinion went from 0 of 3 caught to 3 of 3, and elided condition from 1 of 6 to 6 of 6.
  Brackets and fabrication stay 5 of 5. The default is chosen by the rule now stated in docs/LEGAL.md ("How the default is
  chosen"). 0.3.0's half-B row on the second blind set, run post-hoc, ties 0.2.0 (0/10 known-bad passed, 1/10 genuine failed).
  New remedy tables: `LEGAL_REMEDIES_V030`, `_V030_UNBOUND`, `_V030_PARTIES_ONLY`. docs/LEGAL.md and the "Legal 0.3.0" section of
  docs/RULESETS.md give the detail.
- **Remedies name the line position (pay-app).** Remedy details under engine 0.6.0 name the line position the claim names; remedy
  tables for 0.6.0 are engine-gated, so verdict ids under 0.6.0 move for the affected rulesets; earlier engines re-perform exactly.

## 0.6.0 (2026-10-05, first pass; docs/REPLAY.md, docs/VERDICT-SCHEMA-v0.md "Engine 0.6.0")

Cold readers (AI agents) replayed the shipped verdicts, tried to break the hash, and read the CLI cold. This version answers what they
found. Every engine-behaviour change below is gated on 0.6.0, so a verdict that names 0.0.1 to 0.5.0 is re-performed exactly as that
engine read and replays byte-identical. Verdict ids issued under 0.6.0 differ from 0.5.0's, because the id derives from the engine:
identity pins elsewhere need a repin. The entries below cover the verdict record, replay, the CLI and the hash contract; changes to
the AP, legal and e-invoice rulesets made in the same round are listed after them.

- **`gate_status` on every verdict.** A verdict records PASS, PASS_WITH_OPEN, FAIL or INSUFFICIENT_DATA right after `outcome`.
  PASS_WITH_OPEN means every check that ran held but some could not run (an e-invoice whose VAT and net totals could not be read
  used to say only `outcome: "PASS"`). `outcome` keeps its meaning. It is recorded wherever an engine closes its verdict
  (`attachScope`), so every engine has it; a replay re-derives it. Earlier engines' verdicts carry none.
- **Headlines.** `verify <doc>` (also `verify check <doc>`), `verify ap` and `verify replay` print the gate status with the count
  behind it on stderr (`PASS-WITH-OPEN: 3 of 13 checks could not run`), never a bare PASS when a check could not run. `verify ap`
  prints the decision and its reasons (`HOLD (hold_quantity) · verdict FAIL: 1 of 12 checks failed`, then the lines it read). The
  exit codes are unchanged.
- **The hash contract.** Every text and JSON file the CLI reads is decoded as strict UTF-8: a byte that is not UTF-8 is refused
  with its offset, never replaced with U+FFFD (three source files that differed in one byte shared one input_hash and one
  verdict_id). A JSON number past the double range (`1e999`, read as Infinity) is refused with its path, never hashed as null
  (`1e999`, `-1e999` and `null` shared one input_hash). A JSON file that starts with a byte-order mark is refused with that sentence.
  These refusals do not depend on the engine version, because such an input never had a faithful hash; from 0.6.0 the declarative
  library entry refuses a non-finite number too. `canonicalize` is unchanged, so every accepted input hashes as before, and
  docs/REPLAY.md now states its real key order (array-index keys first, ascending; then code-unit order), which a "keys sorted"
  or RFC 8785 implementation would not reproduce.
- **What replay does not compare, said everywhere.** The exempt set is issued_at, `channel`, `ledger`, `declared_accuracy`,
  `action_context`, `case`, `document.producer`, and the remedies of an engine-0.0.1 or 0.1.0 verdict that carries none
  (re-derived). Folder and .jsonl replays now name them per case, as a single replay does, and list them in the summary
  (`fields_not_reperformed`). A verdict whose remedies were deleted says `remedies absent; re-derived`, never a silent MATCH.
- **`verify replay --trusted-key <key>`** pins the signing key: an envelope signed by any other key, or an unsigned verdict, fails
  (exit 1). **`--strict`** fails a match on anything that was not re-performed: an exempt field present, remedies re-derived, or an
  envelope whose key is not pinned.
- **Messages.** A hash refusal prints the recorded and the computed hash on their own lines (it used to label the computed one
  "expected"), names the input that disagrees (now for legal, AP and action verdicts too), and mentions line endings, a trailing
  newline and a byte-order mark when only the page text can be at fault. The replay JSON carries `recorded_input_hash` and
  `computed_input_hash`. `--version` prints the version and the engines this build replays. `verify <command> --help` prints that
  command only. An unknown option prints one line with the nearest known flag and a pointer to the command's help (the default
  check used to ignore it and use the default ruleset). `--name=value` reads as `--name value`. A folder given without `replay`
  says `did you mean: verify replay <dir>`. A folder replay that meets a bare verdict prints the single-verdict command with its
  flags, and names the folders it does not walk. The placeholder is `--source <file>`.
- **Help.** `verify --help` is one screen (under 40 lines): `ap`, `check` and `replay` first, each with its exit codes. The full
  reference is `verify --help all`, in plain words, with a glossary.
- **Legal: the opinion text is bound to its cite, and recorded.** A quotation is checked only against a text that names its cite
  (the reporter citation and each party of the case name). Otherwise the claim abstains, "the supplied text does not name <cite>;
  it may be the wrong opinion", never PASS. A source may carry its origin (`{ text, source, url, retrieved_at }`). Every legal
  verdict records `opinion_sources`: per text, its sha256, length, origin, and what it names per citation. legal@0.0.1 names a
  passage on a FAIL only on a 4-word anchor, so an invented quotation abstains as possibly fabricated instead of being told to
  "conform" to an unrelated sentence. Every answer speaks of "the opinion text supplied for" the case. The rules themselves (0.0.1,
  0.1.0, 0.2.0) are unchanged. New verdicts under engine 0.6.0 defaulted to legal@0.2.0 until a patch moved the default
  to legal@0.3.0 the same day (the 0.6.x patch above); under an earlier engine the default is still legal@0.0.1. New: `verify citations` (src/legal/cli-citations.ts), with `--bind strict` (the default: the reporter
  citation and every party) or `--bind parties` (a labelled tier: "bound by parties only"), and docs/LEGAL.md.

## 0.5.0 (2026-10-04, the choice ledger; docs/CHOICES.md, docs/RULESETS.md "Engine 0.5.0", docs/EVIDENCE.md)

A number computed from a table rests on choices the table does not fix: fit weights, which quality flags are honoured, a
mass-to-light ratio, a units convention, a model form, the exact algorithm, a tolerance, a selection. Engine 0.5.0 puts them on
the verdict. Everything is additive and read only by engine 0.5.0. Every verdict that names 0.0.1 to 0.4.0 is re-performed exactly
as that engine read, and every stored bundle set replays byte-identical. A ruleset that declares no choice slots gets, under 0.5.0,
the verdict 0.4.0 gives, apart from `engine_version`, `verdict_id`, `scope.engine_version`, an empty `choices` list and six new
counts (`stated_rate` null). Verdict ids issued under 0.5.0 differ from 0.4.0's, because the id derives from the engine: identity
pins elsewhere need a repin. The built-in engines declare no slots and carry no ledger.

- **Choice slots.** A declarative ruleset declares `choices: [{ id, kind, load_bearing, default?, not_applicable?, governs? }]`,
  `kind` one of weights, flags, ratio, units, model_form, algorithm, tolerance, selection. The claim document fills a slot at its
  top-level `choices`: `{ value, stated: true, span: { page | section, quote } }`, or `{ unstated: true }` when it is silent. The
  judge may supply a value (`supplied_choices`, bound into the inputs). Resolution: a well-formed stated fill is `stated`; else the
  judge's value or the ruleset's default is `supplied`, named with its source; else the slot is `unstated`. A slot declared
  `not_applicable` says why and never counts.
- **What a choice does.** A numeric value is a document role named by the slot id (`doc.ID` inside a row). An algorithm slot is
  linked from the `algorithms` block (`choice`): a document that states another procedure leaves the role without a value
  (`choice_mismatch:`), never a substitute. Algorithm parameters come only from slots (`params`). A flags slot is the policy for
  per-value quality flags. `governs` names checks that depend on a slot the engine cannot see.
- **The gate.** A check that depends on a slot with no value abstains before anything else: reason `FIELD_MISSING`, detail
  `choice_unstated: …`, `missing` the slot ids, and a remedy that says to state the choice or supply it. No reason code was added
  (receipts and the adapters compile against the reason list).
- **The ledger.** Every declarative verdict carries `choices: [{ id, kind, status, value, source, load_bearing, detail? }]`, and
  `counts` gains `choices_load_bearing`, `choices_stated` and `stated_rate` (stated / load-bearing, 4 decimals; null, never 0,
  when no slot is load-bearing). An algorithm slot stated with a registry ref says whether its quote is a verbatim part of the
  registry's pinned quote.
- **Beyond the data is counsel.** A check may declare `support: { field, max_of }`. When the point it evaluates lies past the
  largest measured value, the check makes no claim: the verdict carries an advisory with `beyond_data: true`, the computed values
  and both support numbers, never PASS or FAIL. `counts.beyond_data` counts them.
- **Per-value quality flags.** Provenance may carry `qc: { scheme, flag }`. The first scheme is Argo's Reference table 2
  (`src/schemes/argo-qc.json`, quoted verbatim, pinned to the manual's DOI, PDF and text hashes). A flags slot's policy computes,
  holds (struck `qc_held`: the checks that read it wait), strikes (struck `qc_struck`: left out of every aggregate and algorithm
  series, a direct read abstains) or blanks (`absent`, Argo's flag 9) each flag. A value whose scheme no slot governs is computed
  as given and counted `not_read`. The verdict's `qc` block lists every held, struck or absent value. A flag never changes a tier.
- **Archive bytes.** `archive_files: [{ name?, base64 }]` (bound into the inputs; CLI `--archive-file`) gives the engine the bytes
  of a binary archive file, so a FITS product can reach `checksum_verified` against the md5 its archive publishes. `archives`
  says which supplied bytes matched (`matched`).
- **`rar.fit@1`.** The registry carries the weighted orthogonal-distance fit of the radial acceleration relation (McGaugh, Lelli &
  Schombert 2016), as the preregistered replication of that fit specified it: Gauss-Newton inner steps, Brent's bounded outer
  minimiser, the weighting from a choice slot. On that study's 2,700 points it gives g† 1.0988500946 against the 1.0988500779 the
  study recorded (1.7e-8 apart). An entry
  can name the engine it is carried from (`since`), so 0.4.0 refuses rar.fit@1.
- **Lint** checks the slots, the links, `support` and flags policies, and that a slot a check depends on is declared
  load-bearing. A ruleset without slots lints exactly as before. The extraction schema accepts `choices` and `qc` only for a
  ruleset that declares them.
- **Demos.** `docs/examples/rotation-curve.v0.2.json` (`rotation-curve-sparc@0.2.0`; v0.1 is unchanged) puts the mass-to-light
  ratios, the V_f procedure, the flat-curve model, G and the (absent) flags on the ledger, and adds C4 (inside the data) and C5
  (past it). On NGC 3198: C1 7, C2 58.3755, C3 150.087, unchanged; C4 PASS; C5 counsel; `stated_rate` 0.6.
  `docs/examples/rar-sparc.ruleset.json` (`rar-sparc@0.1.0`) replays the relation's fit: g† 1.0989 against 1.20 ± 0.10 FAILs,
  with the weights supplied because the paper does not state them; with the judge supplying `unweighted`, 1.1363 PASSes.
- **Tests that name the current engine** were moved to 0.5.0; the one that compares 0.4.0 with 0.3.0 now names `engine: '0.4.0'`.
  No assertion was weakened.

## 0.4.0 (2026-10-04, claims over tables; docs/RULESETS.md "Engine 0.4.0", docs/EVIDENCE.md "Archive provenance")

A claim over a scientific table is now first-class in the declarative language. Everything is additive and read only by
engine 0.4.0. Every verdict that names 0.0.1, 0.1.0, 0.2.0 or 0.3.0 is re-performed exactly as that engine read, and every stored
bundle set replays byte-identical. A ruleset that uses none of the new forms gets, under 0.4.0, the verdict 0.3.0 gives,
apart from `engine_version`, `verdict_id` and `scope.engine_version`. That was measured on both golden sets, the 196 e-invoice
representations and the 120 extraction-contract identity checks: 0 moves. Verdict ids issued under 0.4.0 differ from 0.3.0's, because the id derives from the engine: identity pins elsewhere
need a repin.

- **Functions.** `sqrt(x)`: IEEE-754, rounded to 9 decimals; a negative argument has no value and the claim says so with a
  domain note. Aggregates over a line field, a line-computed role or a list field: `median`, `min`, `max` and `count`, each
  optionally over a named row set (`fn(R, SET)`), plus `sum(R, SET)`. The median of an even count is the mean of the two middle
  values. An aggregate is computed whole or not at all: an unreadable selected row strikes it (UNPARSEABLE, naming the row). An
  empty selection counts 0 and has no median. NaN and Infinity are never produced.
- **Row sets.** `"row_sets": { NAME: [conditions] }`, with the condition shapes of `applies_if`, evaluated per row. A row whose
  membership cannot be decided makes the aggregate unknown.
- **Rows.** `prev(R)` and `next(R)` work inside row checks, line-computed roles and row-set conditions. On the first or last row
  the claim abstains `OUT_OF_RULESET_SCOPE` with a detail that starts `no_neighbour:`. The applicability condition
  `{ "neighbour": "prev" | "next" }` rules the edge row out instead. `doc.R` reads a document field, computed role or algorithm
  role inside a row. Line-computed roles are evaluated role by role over every row. A line-computed role that reads a computed
  or algorithm role through `doc.` is evaluated after the computed roles.
- **Named algorithms** (`src/algorithms/`; ruleset key `algorithms`). A registry entry has an id, a version, a quoted source
  (DOI, URL, the fetched PDF's and text's sha256, the verbatim quote and its sha256, the reading), and an implementation file
  pinned by sha256. The ruleset's identity carries each named entry's pin, so the verdict_id binds the implementation and the
  source. The verdict lists the pins (`algorithms`). Replay refuses a pin this build does not carry byte for byte. The first
  entry is `sparc.vflat@1`, the V_f algorithm of Lelli, McGaugh & Schombert 2016, ApJL 816, L14, Sect. 2.2.
- **Archive provenance.** An envelope value may carry `{ kind: "archive", url, retrieved_at, sha256, member?, container_sha256?,
  archive_checksum?, reader, raw, locator? }`. It is evidence tier E1 (a structured document the engine reads), never E0 (see
  0.3.0 below). The verdict's new `archives` block states `content_verified`
  and `checksum_verified`, which the engine sets only from bytes it hashed itself. A malformed archive provenance is E4 and
  struck. The generated schema accepts it only for a ruleset with `"provenance_kinds": ["archive"]`, so every other schema
  keeps its bytes.
- **Lint** reads the new forms and keys, places each where it can be read, and checks the `algorithms` block against the
  registry. A ruleset without them lints exactly as before: 32 ruleset files on disk were compared against the previous build.
- **Demo:** `docs/examples/rotation-curve.ruleset.json` (`rotation-curve-sparc@0.1.0`, a demo, never a benchmark). It lints
  clean. On NGC 3198 its three claims PASS: largest deviation 7, smallest baryonic excess 58.3755, V_f 150.087 against the
  published 150.1.
- **Tests that name the current engine** were moved to 0.4.0, and two evidence-ruling tests now name `engine: '0.3.0'`, the engine they
  describe. No assertion was weakened.

## Unreleased (2026-10-03, the compiler's currency count, added post hoc; the engine stays 0.3.0)

The engine does not change: only `src/compile/` and its dist moved. Both goldens pass unchanged, and every stored bundle set
replays byte-identical to the build before this change.

- **`verify compile-ruleset` 0.1.1** compiles BR-CO-15's conjunct `count(cac:TaxTotal/cbc:TaxAmount[@currencyID = BT-5]) eq 1`,
  which 0.1.0 left uncompiled (cardinality).
  - `cac:TaxTotal` occurs at most twice, and each instance is a term (BT-110, BT-111). So the conjunct becomes
    `BT_110_CURRENCYID = BT_5` (`BR-CO-15:c1.1`) and `BT_111_CURRENCYID != BT_5` when BT-111 is reported (`BR-CO-15:c1.2`).
  - The same reading covers the VAT accounting currency (BT-6). A new policy, `currency-count`, appears in every compile
    report.
- **Post hoc.** The reading was added after a corpus run had shown the gap: three currency defects and one invented currency
  passed a compiled EN 16931 + XRechnung profile. The re-run in `docs/COMPILER.md` is a regression check on a known corpus, not a
  test.
- **Additive.**
  - A check from the new reading always takes a suffixed code and never renames or reclassifies the checks 0.1.0 wrote.
  - Recompiling any of the six pinned profiles leaves every earlier check unchanged apart from `compiled_from.compiler`.
  - In an unscoped compile, `BT_110_CURRENCYID` loses its synthesized path `tax_amount_currency_id`, because BT-111's
    currencyID now synthesizes the same path. The compiler drops a path that two terms share.
- The recompile comparison against Peppol 0.2.0 and 0.3.0 is unchanged: 0 unexplained.

## 0.3.0 (2026-10-03, the evidence ruling; docs/EVIDENCE.md)

The product ruling on a garbled field: "Not an automatic fail, a flag, and a report with evidence … leave it out of the
calculations with a flag for a human to come in with the fixed number." Engine 0.2.0's provisional HELD-SUSPECT (a suspect claim
booked as a FAIL) is overruled. Every verdict that names 0.0.1, 0.1.0 or 0.2.0 is re-performed exactly as that engine read
(nothing below runs for it), and every existing bundle replays byte-identical. Every verdict id issued under 0.3.0 differs from
0.2.0's, because the id derives from the engine: identity pins elsewhere need a repin.

- **Strike and recompute.** A 0.3.0 declarative verdict carries `computed`, `struck`, `would_unlock`, `counts` and
  `evidence_floor`, plus `findings` and `support` when there are any. A struck field is one some check waits on. Its reason is
  unreadable, suspect, withdrawn, unsupported-assertion or conflict. Each struck field comes with its provenance, and a suspect
  field comes with its failing candidates. The claims themselves are made as before (an abstention per check that needs the field).
- **Suspect is a flag.** The one-character re-evaluation still runs, now for envelopes too, using the readers' own readings. A
  failing reading marks the struck field `suspect` and is counted. No claim carries `suspect`, and nothing is booked as a FAIL.
  `"held_suspect": false` drops the flag and keeps the strike.
- **The gate reads OPEN.** `gateStatusOpen` and `gateLabel` return OPEN for a non-FAIL verdict with a struck load-bearing field.
  `verify --gate` names each struck field and what it unlocks, and exits 2. `gateStatus` keeps its four values for the deployed
  gates: there an OPEN verdict reads PASS-WITH-OPEN (or INSUFFICIENT_DATA), which holds the action. `HELD-SUSPECT` remains only
  for 0.2.0 verdicts.
- **Evidence tiers.** E0 is a statement signed by an enrolled source. E1 is a structured document the engine reads. E2 is a PDF
  text layer, E3 is OCR, and E4 is an assertion. Extraction-contract provenance gains an optional `tier` (E1-E3), which the
  reference extractor writes. The engine uses the worse of the stated and the inferred tier: a better stated tier is capped, and
  the cap is a finding. An envelope value with no provenance is struck (unsupported-assertion). A plain extraction is
  `unstated`. When sources conflict, the higher tier computes and the conflict is a finding; two values at one tier with nothing
  higher are struck (conflict).
- **The evidence overlay** (`options.evidence`, `./src/declarative/evidence.ts`) is how arbitration reaches a verdict. It holds
  the evidence the engine read for each field, and the fields or document a STRIKE withdrew. It is bound into the input hash:
  inputs gain `evidence`, which replay passes. Under an earlier engine an overlay is refused.
- **The scope line.** Every 0.3.0 verdict of every engine ends with `scope` (ruleset@version, engine, evidence floor, "advisories
  are counsel, not verdicts", "this is a check, not a decision"). The block is generated from the verdict (`./src/verdict/scope.ts`).
  `verify notice`, `verify replay`, `verify --gate` and `verify case` end their human output with it.
- **Arbitration, thin cut** (`./src/arbitration/`; CLI `verify case open | move | status | replay`). CORRECT, STRIKE and
  CORROBORATE are Ed25519-signed moves, checked against a parties file. The engine reads every document itself (a PDF via the
  reference extractor, a UBL XML, a signed source statement), and a move carrying a value is refused and recorded by hash.
  Independence is by source. Each accepted move records a linked re-verdict, with the state before and after, and both replay.
  The case has a working-day clock: expiry is UNSUPPORTED, never PASS. A higher-tier CORROBORATE reopens a resolved case. The
  record is a hash-chained JSONL ledger in the case directory.
- **Remedies under 0.3.0:** a struck operand is answered by evidence ("a CORRECT carrying the page or document that prints it …
  or a CORROBORATE from an independent source"), never by "read it off the document".
- Replay sets aside a new annotation, `case`, as it sets aside `channel`.

## Unreleased (2026-10-03, the standards compiler; the engine stays 0.2.0)

Nothing issued moves: every addition is read only when a ruleset uses it. Both goldens pass unchanged and every stored bundle
set replays byte-identical.

- **`verify compile-ruleset`** (`src/compile/`, `docs/COMPILER.md`): schematron → declarative ruleset skeleton and compile
  report; `--against` compares it check by check with a hand-written ruleset; `--diff` marks hand edits. Library:
  `compileSchematron`, `compareWithHand`, `markHandEdits`, `parseStructureTsv`, `parseStructureXml`, `readSchematron`, `parseXPath`.
- **Declarative keys (any engine):** `compare: "member"` with `in`; `applies_if` `{ field, present: true }` and
  `{ any_present: [...] }`; `alternatives` on an identifier check; the documentation keys `narrowing`, `source`,
  `compiled_from`, `hand_edited` (checks), `term_key`, `hand_edited` (fields) and `compiled_from` (ruleset). An older 0.2.0
  build does not know them, so a verdict made with one replays only on this build or later.
- **The extraction contract reads list fields:** `extract-schema` gives an `each` field an array schema, one item per
  element with its own provenance; an envelope's list is lowered to the list's array path; an UNREADABLE list item's
  provenance reaches its abstention. Every ruleset without a list field keeps its schema byte for byte.

## 0.2.0 (2026-10-03, an adversarial review's findings; docs/MISSES.md rows F1 to F18)

Every verdict that names engine 0.0.1 or 0.1.0 is re-performed exactly as those engines read: the existing bundles, the 196
e-invoice representations, the 120 extraction-contract identity checks and the closed loop's 980 bundles all replay
byte-identical. Every verdict id
issued under 0.2.0 differs from 0.1.0's (identity only, for the built-in engines), so identity pins elsewhere need a repin.

**Remedies are bound to the verdict (misses-ledger row F9).**

- Every verdict carries `remedy_table_hash`, the sha256 of the remedy table it was answered from (a declarative ruleset's
  declared remedies, `remedyTableOf`; a built-in engine's table). `verdict_id` derives from it as a fourth part
  (`deriveVerdictId(input_hash, ruleset, engine, remedy_table_hash)`); without it, the three-part form is unchanged.
- Two rulesets that differ only in remedy text no longer give one verdict id.
- Replay, every engine: when the inputs carry a declarative ruleset this build carries by id@version, and it is that
  ruleset once remedies are set aside, its remedies must be that ruleset's; otherwise the replay FAILS, naming the check.
  A 0.2.0 verdict without `remedy_table_hash` does not replay, and a 0.2.0 non-PASS verdict stripped of its remedies is a
  divergence (row F18), not "issued before remedies".
- A divergence inside the remedies names the rule ids the remedy answers.

**HELD-SUSPECT (misses-ledger row F7): the shipped default was provisional, pending a product ruling.** *(Ruled the same day: a flag, never a
FAIL. Retired in 0.3.0; a 0.2.0 verdict keeps the reading below when replayed.)*

- A declarative claim that cannot run because a value was reported as a string that does not read is re-evaluated under
  every reading of that string one character away (one deletion, substitution or insertion of 0-9 . ,). If one FAILs the
  check, the claim keeps INSUFFICIENT_DATA, carries `suspect` (the reported string, the first failing reading, the two sides,
  the counts), and the gate books it as a FAIL: `gateStatus` returns FAIL, `gateLabel` returns HELD-SUSPECT, and
  `verify --gate` exits 1. The four-valued gate type is unchanged, so receipts and the adapters block on it unchanged.
- The flip, if the ruling is "a plain hold": `"held_suspect": false` in a ruleset (or a 0.2.x engine default change).
- The cost, measured: a garble of a correct value is held too (some one-character reading fails). Absent, null, blank,
  marker, label-only, identifier and envelope values have no raw string and stay plain holds.

**Reading (misses-ledger rows F13, F14, F15).**

- Identifiers are compared after NFKC, with every format character (Cf) and every kind of space (Zs) removed:
  `"EU\u200BR"` (a zero-width space inside) and full-width `"ＥＵＲ"` equal `"EUR"`. Cross-script lookalikes (Cyrillic `Е`) are not folded (row F12, open).
- Numbers written as text are read whole (`readNumberTextV020`). An ambiguous grouping is unreadable unless the ruleset
  declares `"locale"` (`en`, `de`, `fr`, `ch`, or `{ decimal, group }`): a lone `.` or `,` before exactly three digits
  (`1.234`, `1,234`), a lone decimal comma (`1,23`), any space grouping (`1 234`). A group starting with 0 is a decimal
  (`0.125`). Accepted strings are canonicalized before the amount parser, so nothing is truncated (`1 234,56` under `fr`
  is 1234.56), a formatted price is read exactly (`€1,234.567`), and a U+2212 minus is negative (engine 0.1.0 read it as
  positive). The cost: a price or quantity written as text with exactly three decimals (`"3.335"`) is unreadable without a
  declared locale. JSON numbers are unaffected.
- A field reported under a key that differs from its path only by spaces or invisible characters (`"payable_amount "`) is
  unreadable and named, never absent, so an optional total never takes its default from it.

**New ruleset keys (any engine; a ruleset without them keeps its bytes).** List fields (`each`, read through `sum()`),
`line_computed` roles, and the check keys `exact_tolerance`, `fail_if_unreadable` and `advisory`; verdicts gain
`advisories` (counsel) when an advisory check fires.

**Peppol BIS 3.0 ruleset 0.3.0 (misses-ledger rows F4, F8), carried by name; 0.2.0 stays the default.**

- BR-CO-14 reads every VAT breakdown row (a list), and a row reported without a readable tax amount FAILs the check.
- PEPPOL-EN16931-R120 is compared exactly at 0.02 on the full-precision line net: 0.02 holds; 0.020001 and 0.0201 fail.
- `R120_SUM`, a document-wide cap on the summed R120 deviation (Σ |net − qty × price …| ≤ 0.02), stricter than the standard.
  **Its shipped form is advisory, pending a product ruling:** the verdict PASSes by the standard and carries an
  `advisories` entry stating the summed deviation and the line count. The flip: `"advisory": false` on `R120_SUM` (as a
  new patch version of the ruleset) makes it a FAIL.

**Legal ruleset 0.2.0 (misses-ledger rows F1 to F3), opt-in; 0.0.1 stays the default and 0.1.0 is unchanged.**

- 0.1.0's reading plus a meaning guard: a bracket that replaces a word with another word, or swaps a modal, a negation or a
  quantifier, FAILs as altered (case, inflection, a pronoun or a referent are allowed); an ellipsis whose omitted text holds
  a condition or limiting word abstains ("elided condition", the omitted text shown); inner quotation marks the quotation
  drops (without a parenthetical naming them) or adds abstain ("nested quotation"); a bracket carrying a guarded word that
  cannot be located abstains. On the first blind legal set's 58 items, every 0.2.0 outcome equals 0.1.0's.
- The audit states one more limit for 0.2.0 verdicts: the words are not thereby the opinion's holding (row F10).

**Not changed.** The built-in rulesets' lenient normalizer (row F6), per-line currencies (row F5), section-aware legal
sources (row F10), the attest-snapshot matcher (receipts, row F11).

## 0.1.0 (2026-10-03)

**The extraction contract (later the same day; additive).**

- `verify extract-schema <ruleset>` emits the JSON Schema for a ruleset's extraction. It is generated from the `fields`
  block, with one property per field term, typed by kind, each with provenance `{page, line, raw, reader}`. The legal
  ruleset's citation parts are covered too. `--validate` checks an envelope against it.
- **A new declarative ruleset key, `"require_contract": true`** (default off): verify refuses an extraction that does not
  validate against the schema. No check runs, and a typed remedy names the first violation.
- **An extraction-contract envelope** (it has both `extraction_contract` and `fields`) is lowered to the fields' first
  paths under engine 0.1.0. Its `"UNREADABLE"` values abstain, and their remedies name the printed page and line. Engine
  0.0.1 never lowers one.
- **The reference extractor** (`extractContract`, `readQuotationTwice`) reads every field twice: the PDF text layer and
  OCR, or two OCR settings on a scan. A disagreement is `"UNREADABLE"`, with both readings kept. pdfjs-dist is an optional
  peer dependency; Tesseract and poppler are external programs.
- **Every input without both keys reads exactly as before**, with the same input hash. No shipped ruleset sets the flag.

**Strict reading is the default for declarative rulesets.**

- **Absent vs unreadable is on unless a ruleset says `"distinguish_unreadable": false`.** A field reported as `null`, `""`
  or `"UNREADABLE"` was seen and not read. The checks that read it abstain (UNPARSEABLE) and name every such operand, and its
  `default` never applies. A field left out of the extraction is still absent, and an optional total still takes its default.
- **Strict number reading is on unless a ruleset says `"strict_numbers": false`** (new key). A money, price or quantity
  string must read strictly as a number. `"°225.0"`, `"1,2?5.00"` and `"E 2O"` are unparseable, never coerced. A whole,
  well-formed CJK numeral (`十一万`) still reads.
- **Why.** The e-invoice PDF test found an unreadable total read as 0, and garbled totals read as numbers, and two of them
  can cancel into a PASS on wrong inputs. Before this release the fix was opt-in per ruleset; now a ruleset has to opt out.
- **The old reading is kept.** Both flags set to `false` read exactly as 0.0.1 did. On the 196 e-invoice representations the verdicts
  are identical to 0.0.1's once `engine_version`, `verdict_id` and `input_hash` are set aside.

**Peppol BIS 3.0 ruleset 0.2.0 is the default e-invoice ruleset.**

- Declarative rulesets can be named: `peppol-en16931` resolves to 0.2.0, `peppol-en16931@0.1.0` to 0.1.0, and `e-invoice`
  to the default. Names work on the CLI (`--ruleset`), over HTTP (`/v1/verify/declared`, `/v1/ruleset/lint`,
  `/v1/ruleset/measure`) and over MCP (`verify_declared`).
- 0.1.0 is unchanged (sha256 `0a3cd5a5…`) and still shipped. The legal default stays `legal@0.0.1`; the invoice default
  stays `invoice@0.1.0`.

**Every earlier verdict still replays.**

- Replay re-performs a verdict under the engine version it names. This build carries 0.0.1 and 0.1.0 (`ENGINE_VERSIONS`).
- Every engine takes an `engine` option (`'0.0.1'`) to make a verdict under the earlier behaviour. Replay and the
  succession check use it.
- No engine other than the declarative evaluator changed behaviour. Their 0.1.0 verdicts differ from 0.0.1's in
  `engine_version` and `verdict_id` only.

**Moved by the new defaults, measured.**

| set | results | moved beyond identity | only in remedies | verdict outcomes moved | claim outcomes moved |
|---|---|---|---|---|---|
| first golden | 489 | 388 | 260 | 0 | 0 |
| e-invoice golden | 177 | 98 | 41 | 0 | 8 |

The 8 are line checks on synthetic e-invoices whose allowance-and-charge list is reported as `null`. Those checks now abstain
where they used to FAIL. Both goldens still pass byte for byte under engine 0.0.1.

**Not changed.**

- The built-in TypeScript rulesets (`invoice`, `pay-app`, `reconcile`) still read numbers leniently through the general
  normalizer.
- Some verdicts labelled 0.0.1 were issued before later corrections made under the same label. They were already known not
  to re-perform identically (an earlier measurement found 8 of 130 replays differ, all corrections). Engine 0.1.0
  re-performs 0.0.1 as the code reads it today, so this release does not change that.

## 0.0.1

The first engine. Every verdict issued before 2026-10-03 names it.

## How the replay contract changed

`docs/REPLAY.md` states the rules of replay as they stand. What it used to say about when each rule arrived, and what came
before it, moved here on 2026-10-13, oldest first. The version entries above carry the detail of each change.

**2026-10-05.**
- The refusals before hashing became engine-independent and hold at every entry point: `verify()` itself and the HTTP and MCP
  servers refuse what the command line refuses.
- Text that is not valid UTF-8: decoding used to replace each invalid byte with U+FFFD, so three source files ending in `0xFF`,
  in `0xFE` and in the valid bytes `EF BF BD` (U+FFFD itself) issued the same `input_hash` and the same `verdict_id`. The first
  two are now refused with the byte offset, and the third issues as before. A byte-order mark at the start of a text file was
  always kept as U+FEFF.
- A JSON number past the double range: `verify()` did not refuse a non-finite number, so `total: null` (PASS) and
  `total: Infinity` (FAIL) shared one `verdict_id`.
- A JSON number that cannot be represented exactly: `6125.0000000000001` and `9007199254740993` used to read as `6125` and
  `9007199254740992` and hash as those, so a bill with that unit price and an amount of `9007199254740992` passed its line
  check, and the verdict recorded a figure the file does not hold.
- A key repeated in one JSON object: a signed envelope with `"outcome":"FAIL"` written before its real `"outcome":"PASS"` used
  to verify as signed, while a reader that keeps the first key saw FAIL.
- A verdict issued on any of these inputs no longer replays: the replay refuses the input, where it used to report VERIFIED for
  a different input that shared the hash. No verdict in the banked replay sets was affected.
- The tolerance override's shape is checked strictly. Before, `"perLine": "TAX_INT"` (a string) and
  `"perLine": ["T","A","X","_","I","N","T"]` (its characters) hashed alike while the engine read them differently, so one
  `verdict_id` named a PASS and a FAIL. A valid override hashes exactly as before.
- Deleted remedies are refused by default; before, the default was the lenient reading (miss F18).
- `--strict` reports `document.producer` as a note. Before, it failed every genuine bundle that carried a producer, and passed
  the same bundle with the producer deleted.
- Replay prints and pins the key fingerprint as sha256 over the key's DER bytes. Until then it printed and pinned sha256 of the
  base64 text of the DER, the older form `--trusted-key` still accepts with a note.
- A verdict under an older rule version: the VERIFIED line names the rule version, a legal verdict carries today's reading
  (`rule_now`), and `--require-ruleset` was added. The VERIFIED line has named the ruleset and the version that decided the
  outcome since then.
- The JSON's `answer` writes `INSUFFICIENT_DATA` for can't tell; before, it wrote `ABSTAIN`.

**2026-10-06.**
- JSON nested more than 256 levels deep is refused; the readers that walk an input used to overflow their stack on it
  ("Maximum call stack size exceeded").
- Today's reading (`rule_now`, with `noun`) for a declarative or built-in verdict made under an older rule or engine.
- A `--require-ruleset` failure is the first line the replay prints.

**2026-10-13.**
- A key a file carries outside the verdict and its inputs is named on every replay (`carried, not checked: <keys>`, and
  `carried_not_checked` in the JSON), and `--strict` refuses it (`outside keys under --strict: <keys>`). Before, a key beside
  `verdict` and `inputs` in a bundle, or beside a signed envelope's four members, replayed VERIFIED, exit 0, under `--strict`,
  in folder mode, with `--trusted-key` and over `POST /v1/replay`, and nothing named it (a cold reader's finding, filed on
  2026-10-06 and again on 2026-10-12). The same evening `id` and `note` at a bundle's top level became the two allowed caller
  keys: named on every replay as `carried (allowed): id, note` (`carried_allowed` in the JSON), never checked, and allowed by
  `--strict`. Anywhere else they are outside keys. The engine 0.0.1 pack's bundles carry exactly these two, so they match under
  `--strict` as before; for a few hours they failed it.
- The output of `ap` carries a `read` member, the sha256 of each file the gate read. A replay given those files re-hashes and
  compares them; a replay not given them compares nothing `read` records, and now names `read` as carried, not checked.
- When the key was pinned by the older fingerprint form, the first line says `by the trusted key` and the note comes second;
  the note used to come first.
- Which failure a replay names is written down: the replay's own order (refusals before hashing, the signature and the trusted
  key, the binding, the outcome, the remedies). The behaviour did not change.
- In a folder or a `.jsonl` a refused case wins: exit 3. Before, a diverged case (exit 1) hid a refused sibling.
- `POST /v1/replay` sets `x-verify-exit` (0 match, 1 diverged, 2 not re-performed, 3 refused). Before, a DIVERGED replay
  answered 200 with no exit header, so a caller wired to the header failed open.
- In a replay, the refusal of a number that cannot be represented exactly advises re-issuing the verdict with the amount as a
  string, because a replay of the existing verdict cannot change its input. It used to advise writing amounts as strings, which
  changes the input the verdict is bound to.
- The `--strict` failure line reads "but not everything in the file was" (it read "in the verdict"), because a key outside the
  verdict is one of the things it lists.


**2026-10-19.**
- The decision beside an AP verdict is compared. The members `ap` writes beside its verdict (`decision`, `payable`, `grounding`,
  `reasons`, `not_checked`; `exit` and `allow_open` with `--allow-open`) were its own output, neither compared nor named, so an
  edited decision replayed VERIFIED. They are derived again from the re-performed verdict and compared; a key `ap` never writes,
  which was named "carried, not checked" with the exit unchanged, now fails the replay once the verdict re-performs. A bundle's
  AP fields are compared when it states them, and a compared field is no longer named as carried.
- `POST /v1/replay`'s status follows its exit: 409 for exit 1, 422 for exit 3, 200 otherwise. It was 200 whenever the replay ran.
- Which failure a replay names gains a step: after the remedies, the decision beside an AP verdict.
- Later that evening, fail closed by default: a key a bundle or a signed envelope does not define, which every replay had named
  "carried, not checked" with the exit unchanged, is refused (exit 3), named; `--allow-unknown-keys` keeps the old reading and
  says so. A member an annotation's declared shape does not have is refused too (exit 3); the flag does not reach it.
  `POST /v1/replay` answers 422 for either. The hosted gate's `POST /v1/replay` (packages/receipts) answers 409, 422 or 200 from
  the replay's exit, with `x-verify-exit`, as the engine's does; it answered 200 with no header.

## The rulesets' record

`docs/RULESETS.md` is the manual for the rules as they stand. Until 2026-10-13 it was written in the order the features
arrived, each section dated; that text moved here whole on 2026-10-13, so the record of what each change moved, and what it
measured, is kept. Where it says "now", it means the date in its heading.

### The shape (`src/rulesets/types.ts`)

| Piece | What it is | Invoice example | Pay-app example |
|---|---|---|---|
| `id` / `version` / `domain` | Named on every verdict; part of `verdict_id`. Rulesets version independently of the engine. | `invoice@0.0.1` | `pay-app@0.0.1` |
| `ontology` | Field names → roles, with `roleKinds` (how each role normalizes) and `lineArrayKeys` (what the per-line array is called). Amount roles have fuzzy matching **off**. | `totals.subtotal`, `line_items[*].amount` | `schedule_of_values[*].completed_to_date`, `summary.total_retainage` |
| `axioms` | The laws — kernel predicates comparing two roles with a tolerance. The **stated** figure is always the left operand so `asserted` is what the document says and `variance` is stated − expected. | `SUM_INT`, `TOTAL_INT`, `TAX_INT` | `G703_TOTAL` … `G702_PREV` (14) |
| `lineCodes` / `documentCodes` | Which laws run per line vs once per document. | 4 / 5 | 5 / 9 |
| `compute()` | Binds the **computed roles** (Σ, +, −, ×, ÷) with provenance naming their operands, inheriting the *lowest* operand confidence; reports what could not be computed and *why* (a string → `FIELD_MISSING`; an object → its own reason, e.g. `AMBIGUOUS_UNIT`, `AMBIGUOUS_REFERENCE`); returns extra operand evidence to attach to claims. | `LINE_ITEMS_SUM`, `EXPECTED_GRAND_TOTAL` | `SOV_COMPLETED_SUM`, `EXPECTED_CURRENT_PAYMENT_DUE`, `PREVIOUS_COMPLETED_TO_DATE` (from history) |
| `kindByCode` / `fieldByCode` | The vocabulary the verdict speaks in: RECOMPUTE / CROSS_REFERENCE / CONSISTENCY, and the caller's field name each law is "about". | `TOTAL_INT → 'total'` | `G702_DUE → 'current_payment_due'` |
| `referenceRoles` | Which roles come from `contract`, `evidence`, `history`. Drives honesty rule 2: missing reference ≠ the extraction's fault. | contract + evidence roles | history roles only |
| `ambiguityGuards` | Honesty rule 4: `[law, reference role]` pairs — abstain when the reference offers several candidates and none matched the line. | `RATE_SUP ↔ RATE_CONTRACTED` | none (history matching is by item number inside `compute`) |

### The four axes a ruleset can use

1. **Self** — the document's own arithmetic (always available).
2. **References** — contract / PO / receipt (`references.contract`, `references.evidence`).
3. **History** — prior documents of the same kind (`references.history`): the previous pay application, prior invoices. Bound with `source: 'history'` and a path into the caller's document (`history[0].schedule_of_values[1].completed_to_date`).
4. **Source text** — reserved: `QUOTE_MATCH` claims with span locators (does the extracted value appear at the cited span). Same primitive the legal corpus needs.

### Adding a ruleset — the checklist

1. `src/rulesets/<id>/ontology.ts` — every real-world field name you have seen, as `fieldPath` / `alternativePaths`. `fuzzyMatch: false` on every amount. Declare `roleKinds` for every role and `lineArrayKeys`.
2. `src/rulesets/<id>/axioms.ts` — one law per line of the form, stated figure on the left, tolerance stated and justified in a comment.
3. `src/rulesets/<id>/index.ts` — `compute()`; decide, per computed role, what "absent" means (a blank cell that is zero by the form's convention → 0 *and the formula says so*; anything else → an absence with a reason). Never guess a match: by identifier or not at all.
4. New roles → `UniversalRole` in `src/kernel/types.ts` (documented, one line each). New `RulesetRef` → `src/version.ts`.
5. One line in `src/rulesets/index.ts`; the `ruleset` option type in `src/index.ts`.
6. Tests: golden fixtures (`test/fixtures/<id>.ts`) with a clean, a broken (one error per law you care about), a first/edge case, an alternate vocabulary; outcome tests; add the fixtures to `schema-invariants` and `determinism/replay`; a seeded fuzzer.
7. Pre-register the ruleset's claims before measuring anything (`docs/PREREGISTERED-CLAIMS.md`).

### Honesty rules every ruleset inherits

Could-not-compare → `UNPARSEABLE`, not FAIL · missing reference → `REFERENCE_NOT_PROVIDED` · no verdict on a fuzzy-matched field (`AMBIGUOUS_FIELD`) · no verdict against an ambiguous reference (`AMBIGUOUS_REFERENCE`). A ruleset may add its own refusals through `compute()`'s absence reasons (pay-app: `AMBIGUOUS_UNIT` for a bare percent in (0, 1]).

### Mining a ruleset from labelled decisions (`src/mine`, 2026-09-24)

When a customer has past approve/hold decisions but no written policy, `verify mine` proposes the rules. It takes a case
table (`{ id, label, fields, lines? }` per line of a JSONL file) plus a schema that types each field (`qty` · `money` ·
`bool` · `id` · `ids`, with arithmetic roles `price`/`amount`/`total`/`extra` and a `source` per document). From these
it generates a grammar and judges every candidate against the Oracle-AP gauntlet: CONSISTENCY (no approved case violates
it) → GROUNDING (exact hypergeometric, ≥ 5 hold violators, p ≤ 0.01) → NOVELTY (greedy by coverage, ≥ 3 new holds).
The survivors are **candles**: proposals for a person to ratify. Every death goes to the **morgue** with its cause.
`--ap` runs Distil-style AP cases through the AP parser first (`apCasesToTable`). `--max-approved-violation-rate r`
tolerates approved exceptions, and grounding then uses the enrichment tail P(X ≥ holds among violators) (see
`src/mine/stats.ts`). `--ruleset-out` compiles the candles into a declarative ruleset that `verify <doc> --ruleset`
enforces.

Regression anchor: on the Distil AP set it reproduces the preregistered prototype bit for bit (4/4 policy rules, 0 false
candles, price t = 2%, 68/68 holds explained), and the compiled ruleset agrees with the gold decision on 100/100.

**Declarative-format additions (additive; every existing ruleset behaves as before):** field kinds `bool` (1/0 in
expressions, e.g. `sum(AMT) + FREIGHT * FREIGHT_ALLOWED`) and `identifier`, plus `compare: "identifier"` checks
(normalised id-set equality, e.g. "the invoice cites exactly the PO's number"). **Not expressible yet:** a sum of a
per-line product (`sum(qty*price)`). A candle that needs one is listed under `not_expressible` and left out, never
approximated, and the compiled ruleset is marked `complete: false`.

### Exception-aware, rounding-aware checks (2026-09-24)

Four more declarative additions, added for `financial-statement-core` v0.2 (`docs/examples/financial-statement.ruleset.v0.2.json`,
the implementation of the SEC v0.2 addendum, `bench/sec/ADDENDUM-V02.md` in the public repository). They are generic. They are additive: a ruleset that
uses none of them produces **byte-identical** verdicts, lint results and expression values. `test/declarative-golden.test.ts`
pins this with 489 hashes (real 10-K rows plus every example ruleset, reconcile, lint and expressions), frozen from the
engine as it was before these features.

| Feature | Syntax | Semantics |
|---|---|---|
| **Rounding-aware tolerance** | `"tolerance": { "rel": 0.0003, "absCap": 0, "rounding": "infer" }` on the ruleset; `"rounding": "infer" \| "none"` on a check overrides it | See "Rounding inference" below. |
| **Optional terms** | `ROLE?` in any numeric expression, e.g. `"CFO + CFI + CFF + FX_EFFECT?"` | Takes the role's value when it is reported, and counts as 0 when absent. A check decides when its **required** operands (those written without `?`) are present. A required operand that is absent abstains, as before (`FIELD_MISSING`). An optional term that is present but unparseable abstains (`UNPARSEABLE`) and is never read as 0. A form made only of optional terms, none of them reported, abstains. The `?` must follow the name directly. `sum(X?)`, `abs?(…)` and a free-standing `?` are errors. A role written both as `X` and `X?` is required. |
| **Abstain guards** | `"abstain_if_present": [ROLE…]`, `"abstain_unless_all_present": [ROLE…]`, `"abstain_if": [{ "left", "op", "right", "tol"? }]` (op: `= != < <= > >=`) | `abstain_unless_all_present`: any listed role not reported gives `FIELD_MISSING` (or `UNPARSEABLE`). `abstain_if_present`: any listed role reported (a `default` value does not count; present-but-unparseable does) gives `OUT_OF_RULESET_SCOPE`. `abstain_if`: any condition that holds gives `OUT_OF_RULESET_SCOPE`. The comparison is exact unless `tol` is set, and a condition with an absent operand does not fire. Every detail starts with `guard <name>:`. Guards run after the form is chosen, so a check already missing a field keeps its `FIELD_MISSING` reason, and before the comparison. They work on identifier checks and per line. A "fixed tag list" is a field whose `paths` are the tags (first present wins); naming that field in `abstain_if_present` fires on any of them. |
| **Check alternatives** | `"alternatives": [{ "left", "right" }, …]` | Ordered fallback forms of the same identity: the primary `left`/`right` first, then each alternative. The first form whose required operands are all present is evaluated. `op`, `tol`, guards and rounding are shared. Forms are chosen by what is present, **never by which one passes**: a failing primary is not rescued. If no form applies, the check abstains with `FIELD_MISSING`, naming what each form lacks. Use it for consistent pairing ("CI including NCI with ProfitLoss, else the parent's with NetIncomeLoss"), for "X, else Y + Z", and for "a reported total, else its parts". Numeric checks only. |

**Rounding inference.** This rule is ADDENDUM-V02 item 1, generalised. For each check and document:

- **Operands** are the amount-kind values the evaluated form uses, as reported. These do not count: absent optional terms, `default` values, and `bool`, `rate` and `quantity` fields. Computed roles are expanded into their own operands, and `sum(ROLE)` contributes every line's value.
- **The unit U** is the largest of {1, 1 000, 100 000, 1 000 000} that divides every operand.
- **The tolerance** is `max(tol floor, rel × largest |operand|, U × number of operands)`.
- **When no unit exists** (amounts with cents), the unit term is 0, so invoices keep the floor-plus-relative behaviour.
- **`absCap`**, if > 0, caps only the relative term.
- **A claim decided this way is final.** The separate relative-band pass (`applyTolerancePolicy`) does not run on it again. The claim carries `computation.tolerance = { abs: <tolerance>, rel }`, and its explanation states U, the operand count and the largest operand.

Lint understands all four: unknown roles, scope rules (line versus document), malformed options, numeric-only options on
identifier checks, and a warning for a form made only of optional terms. It also no longer *throws* on an expression
containing an invalid character: it reports it. That was a pre-existing crash. The reconciliation layer (`src/reconcile`)
shares the parser, so `ROLE?` parses there, but it has **no** optional semantics: reconcile treats every referenced role
as required.

### Sourced abstention and full-precision prices (2026-09-28)

Four more additions came with the e-invoice ruleset corrections (`docs/RULESET-CORRECTIONS-2026-09-28.md`: Peppol,
ZATCA and KSeF 0.0.1 → 0.1.0), and a fifth, the item-list guard, the same day (built for the KSeF `DoZaplaty`
identity). Like the ones above they are additive: a ruleset that uses none of them produces byte-identical verdicts,
which the 489-hash golden still pins. A second golden (`test/declarative-golden-einvoice-v010.test.ts`, 177 hashes)
pins the three e-invoice rulesets at their 0.1.0 bytes.

| Feature | Syntax | Semantics |
|---|---|---|
| **Declared abstention** | `"abstain": "<why>"` on a check | The check never decides. On every document (on every line, for a line check) it abstains with `OUT_OF_RULESET_SCOPE`, and the detail is `declared abstention: <why>`. This comes first, before operands or guards are looked at, and it works on identifier checks too. `left`/`right` are still linted, so the check documents its candidate identity. Use it for an identity you cannot source from the governing spec: the gap then shows in every verdict instead of being guessed at or silently dropped. Lint rejects an empty string, and it emits a warning (`declared abstention; the check never decides (…)`) so the gap is visible there too. |
| **Guard reason** | `"guard_reason": "<why>"` on a check | When one of the check's abstain guards fires (`abstain_if_present`, `abstain_unless_all_present`, `abstain_if`), the guard's detail becomes `<guard detail>. Reason: <why>`. It is typically the cited source. Other abstentions (a missing field, a declared abstention) are not changed. Lint rejects an empty string, and it warns when the check has no guard for the reason to explain. |
| **Price kind** | `"kind": "price"` on a field | A unit price at full precision. `amount` rounds to the cent, but a unit price legitimately carries more decimals (EN 16931 sets no decimal limit on BT-146; KSeF FA(3) allows 8 on P_9A). A JSON number is taken exactly, and so is a plain decimal string (`"3.335"`). Any other string goes through the amount parser, and if that parser would have to round it (more than two decimals, e.g. `"$1,234.5678"`), the value is `UNPARSEABLE`, never rounded. Like `quantity`, a price is not an operand for rounding inference. |
| **Sources** | `"sources": { "KEY": "https://…" }` on the ruleset | The primary sources the ruleset cites, as key → URL or citation. Check names refer to the keys (e.g. `… [PEPPOL-RULES-CEN, CEN-SCH]`). It is documentation only: never evaluated, but hashed with the ruleset like every other byte, so a changed citation is a changed ruleset. Lint requires an object whose values are non-empty strings. |
| **Item list without its total** (E-INVOICE-2) | `"abstain_if_present_without": [{ "present": "ITEMS", "without": "ITEMS_SUM" }]` on a check | An abstain guard, alongside the three above. It fires (`OUT_OF_RULESET_SCOPE`, detail `guard abstain_if_present_without: ITEMS is reported (<path>) without ITEMS_SUM; …`, plus the `guard_reason`) when `present` is reported and `without` is not. It is for an identity that reads a stated total in place of a list of items, since the engine never sums a nested list (e.g. KSeF `Obciazenia` without `SumaObciazen`). A `default` value does not count as reported, and a `without` that is present but unparseable does not satisfy the guard. It works per line and on identifier checks. Lint checks the shape, that both roles exist, and the scope rules of `abstain_if_present`. |

`docs/examples/purchase-order.ruleset.json` moved its `LINE_PRICE` to `price` on the same date (0.0.1 → 0.1.0,
pre-registered on a constructed set: false alarms 8/8 → 0/8, misses 3/6 → 0/6). The first golden keeps running its
0.0.1 bytes (`test/fixtures/golden-rulesets/`), as it does for the three e-invoice rulesets: the golden guards the
engine, and a ruleset change is tested on its own.

### Applicability, required passages and identifiers (2026-10-03)

Additive: a ruleset that uses none of these gives byte-identical verdicts (the golden test pins it). The identifier key below
is the one exception, and it is stated with the cases it moved.

| feature | syntax | behaviour |
|---|---|---|
| **Applicability** | `"applies_if": [ { "left", "op", "right", "tol"? } \| { "field", "in": [...] } \| { "field", "not_in": [...] } ]` on a check | Decided BEFORE the missing-field test. Every condition must hold for the check to apply. When one does not, the check makes no claim and the verdict lists it under `not_applicable` (`{ claim_id, rule_id, detail }`, e.g. `applies_if: FORM_FINAL = 0 does not hold (1 vs 0)`). When a condition cannot be evaluated (its field is not reported or does not parse), the check abstains (`FIELD_MISSING` / `UNPARSEABLE`, detail `cannot tell whether this applies: …`): it is never skipped on a guess. `field` conditions name an `identifier` or `string` field and compare with the identifier key. Lint checks the shape, the roles and the scope. |
| **Required passages** | `"quotes": [ { "id", "quote", "label"?, "applies_if"?, "remedy"? } ]` on the ruleset | Each is a `QUOTE_MATCH` claim `source.<id>`, checked verbatim against the source text when it is supplied (`verify(…, { source: { text } })`, CLI `--source`, HTTP/MCP `source`). Without the source text an applicable passage abstains `REFERENCE_NOT_PROVIDED`, so a gate holds on it. When given, the source text is part of the input the verdict is bound to. The caller's own `source.quotes` / `source.values` run for a declarative ruleset too (CLI `--quotes <file.json>`). |
| **Identifier key** | `compare: "identifier"` checks | Two identifiers compare by a key with punctuation removed, except that a run of punctuation between two digits becomes one separator: `Paxwick Builders, Inc.` = `Paxwick Builders Inc.`, `PO-1001` = `PO1001`, `INV/2026/001` = `INV-2026-001`, while `12-3` ≠ `1-23`. The claim still shows the normalised ids. Its formula adds `; punctuation ignored except between digits` only when the folding decided the claim, so every claim the old rule decided keeps its bytes. It moved seven synthetic golden cases (a cited-PO list `["PO1","PO-1"]` is now one PO), re-pinned with proof in `test/fixtures/declarative-golden-hashes.json`. |
| **Remedy wording** | (automatic) | A remedy prints an identifier as the document wrote it (`Gannet & Rowe Constructors Inc.`, not `GANNET&ROWECONSTRUCTORSINC.`) and an amount-only check's `{asserted}` / `{expected}` / `{variance}` as money (`330,000.00`). Remedies are outside the verdict's hashed core, so no verdict id moves. |

The lien-waiver demo's ruleset, restated with these (`test/fixtures/lien-waiver/lien-waiver-v0.2.0.ruleset.json`), needs no form
table and no hold rule: on its 30 synthetic waivers with their text, 20 clean waivers PASS and the 10 defects are held
(`test/r3-engine-gaps.test.ts`).

### Absent vs unreadable, and Peppol BIS 3.0 ruleset 0.2.0 (2026-10-03)

Our e-invoice PDF test (60 invoices rendered from public Peppol samples, read back by a text-layer and OCR extractor) found
the Peppol ruleset 0.1.0 PASSing 11 of its 20 planted defects. Every one was a gap in the rules, not in the extraction: no
BR-CO-14, no currency check, no presence checks. It also found an unreadable optional total read as 0, where two of them
cancel in BR-CO-13. **0.2.0** (`docs/examples/peppol-en16931.ruleset.v0.2.json`) closes both. **0.1.0 stays where it was,
byte for byte**, so every verdict issued under it keeps its id and replays (`test/peppol-v020.test.ts` pins the file's
sha256 and a verdict id computed before the change).

| feature | syntax | behaviour |
|---|---|---|
| **Absent vs unreadable** | `"distinguish_unreadable": true` on the ruleset (the default since engine 0.1.0; `false` turns it off) | An absent field is one the document does not carry; an unreadable one is printed but was not read. Only the first takes its `default`. A field reported as `null`, `""` or the marker `"UNREADABLE"` (any case) is unreadable. So is a money or quantity string that does not read strictly as a number: the general normalizer reads `"°20"` as 20 and `"1,2?5.00"` as 12, which this flag refuses. The checks that read an unreadable field abstain `UNPARSEABLE`, naming EVERY unreadable operand, so two unreadable totals can never cancel into a PASS. Absent with no label in the source text (or no source text at all) stays absent, and an optional total takes its default, as EN 16931 reads an omitted BT-107 / 108 / 113 / 114. |
| **Labels** | `"labels": ["Paid amount", …]` on a document field | Read only under the flag and with source text. A field absent from the extraction while one of its labels heads a source line is unreadable: printed, not read. A label heads a line when the line, whitespace collapsed and case folded, starts with it and the next character is not a letter or digit. A line whose rest is lower-case words with no digit (`Document allowances and charges`) is a heading, not the row. The match only ever moves a check toward ABSTAIN. |
| **Term** | `"term": "BT-115 Amount due for payment (cac:LegalMonetaryTotal/cbc:PayableAmount)"` on a field | Documentation. Under the flag, an unreadable operand's remedy is `missing-operand` and names the role, the field path, the term, the value as reported and the source line that prints it, e.g. `supply ALLOWANCE (allowance_total_amount), BT-107 Sum of allowances on document level (cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount): unreadable at line 21 of the source text: "Document allowances EUR 20"; no value was read. Read it off the document and run the check again`. A page break (form feed) in the source text adds the page. |

A ruleset without the flag keeps its bytes under engine 0.0.1 (the golden test pins 489 results; a before/after comparison of
196 0.1.0 verdicts over every unreadable representation, with and without source text, is byte-identical, remedies included).
**Since engine 0.1.0 (2026-10-03) both readings are the default for every declarative ruleset; see the next section.**

**The 0.2.0 rules.** The first five are 0.1.0's, unchanged; 0.2.0 adds typed remedies to them (re-read the operands; if they
are read correctly, only a corrected invoice from the seller clears a fatal rule). Rule texts are quoted from the CEN and
Peppol schematrons at commit `261c458` (sha256 in the ruleset's `sources`).

| check | rule | source | reads | on a miss |
|---|---|---|---|---|
| `LINES_SUM_INT` | BR-CO-10: BT-106 = Σ BT-131 | CEN-SCH | exact to the cent | FAIL |
| `TAX_EXCL_INT` | BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108 | CEN-SCH | exact to the cent | FAIL |
| `TAX_INCL_INT` | BR-CO-15: BT-112 = BT-109 + BT-110 | CEN-SCH | exact to the cent | FAIL |
| `PAYABLE_INT` | BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114 | CEN-SCH | exact to the cent | FAIL |
| `LINE_MATH_INT` | PEPPOL-EN16931-R120: BT-131 = BT-129 × (BT-146 / BT-149) + Σ BT-141 − Σ BT-136 | PEPPOL-SCH | slack 0.02 | FAIL |
| `BR02_PRESENT` | BR-02: an Invoice shall have an Invoice number (BT-1) | CEN-SCH | presence only | abstain (`FIELD_MISSING`) |
| `BR03_PRESENT` | BR-03: an Invoice shall have an Invoice issue date (BT-2) | CEN-SCH | presence only | abstain |
| `BR05_PRESENT` | BR-05: an Invoice shall have an Invoice currency code (BT-5) | CEN-SCH | presence only | abstain |
| `BR15_PRESENT` | BR-15: an Invoice shall have the Amount due for payment (BT-115) | CEN-SCH | presence only | abstain |
| `R051_CURRENCY` | PEPPOL-EN16931-R051: all currencyID attributes equal BT-5, except BT-111 | PEPPOL-SCH | the totals' currency = BT-5 | FAIL |
| `BRCO14_VAT_SUM` | BR-CO-14: BT-110 = Σ BT-117 | CEN-SCH | up to four VAT rows by position, exact to the cent | FAIL; abstains on a fifth row or a row without its tax amount |

A presence check passes on any readable value. It does not tell a misread invoice number from the right one.

Where 0.2.0 is narrower than the schematron:
- **Presence checks abstain on a miss** where the schematron fails, because an extraction cannot tell "not on the invoice"
  from "not read".
- **R051 checks one value**, the currency the totals are printed in, against BT-5. The schematron tests every amount's
  `currencyID`.
- **BR-CO-14 reads at most four VAT rows** by position.
- **BR-CO-14 abstains when no row was read**, where the schematron passes `or not(cac:TaxSubtotal)`.

BR-CO-14's cent rounding agrees with the schematron's `round(sum × 100) div 100` whenever BR-DEC-13 and BR-DEC-20 hold (at
most two decimals on BT-110 and BT-117).

**Declared accuracy, side by side** (`measureRuleset`, which scores the raw outcome; constructed, hand-labelled sets, not
field data):

| labelled set | ruleset | tp | tn | fp | fn | abstain | fp rate | fn rate | measured_on |
|---|---|---|---|---|---|---|---|---|---|
| the existing four cases (`test/peppol-accuracy.test.ts`) | 0.1.0 | 2 | 2 | 0 | 0 | 0 | 0% | 0% | `be0abbad21a29b43…` |
| the existing four cases | 0.2.0 | 2 | 2 | 0 | 0 | 0 | 0% | 0% | `9883ba9294523e25…` |
| seven cases with the new classes, constructed after the rules | 0.1.0 | 2 | 2 | 0 | 3 | 0 | 0% | 60% | `2c77257d5091ef4e…` |
| seven cases with the new classes, constructed after the rules | 0.2.0 | 4 | 2 | 0 | 1 | 0 | 0% | 20% | `c795d971db33b7c6…` |

The 0.2.0 "miss" on the seven cases is the invoice without a number. Its presence check abstains, so the raw outcome is PASS
while the gate reading holds it (PASS-WITH-OPEN). `measureRuleset` scores the raw outcome, as it always has. On the four
existing cases the gate reading also differs: they predate BT-1, BT-2, the totals' currency and the VAT breakdown, so 0.2.0
holds their two clean invoices open where 0.1.0 passes them.

### Engine 0.1.0: strict reading by default, Peppol 0.2.0 by name (2026-10-03)

**What moved, and why.** The e-invoice PDF test showed two failure modes that the declarative engine allowed by default: a
total reported as `null` (or `""`, or `"UNREADABLE"`) took its `default` of 0, and a garbled money string such as `"°225.0"`
or `"1,2?5.00"` was coerced into a number (225, 12). Two such totals can cancel into a PASS on wrong inputs. R4 closed both
behind an opt-in flag. From engine **0.1.0** they are the default for every declarative ruleset, so no ruleset reads an
unknown as zero or a garbled string as a number unless it says so:

| | engine 0.0.1 | engine 0.1.0 (now) |
|---|---|---|
| absent vs unreadable (`distinguish_unreadable`) | on only when the ruleset says `true` | on unless the ruleset says `false` |
| strict number reading (`strict_numbers`, new) | followed `distinguish_unreadable` | on unless the ruleset says `false` |
| what reads strictly as a number | digits in any script, grouping, one decimal part, a currency symbol or three-letter code, a sign or parentheses | the same, plus a whole, well-formed CJK numeral (`十一万`, `1万2千`), which is a numeral, not a garbled number |
| `peppol-en16931` named without a version | (no names) | 0.2.0 |
| engine of a new verdict | 0.0.1 | 0.1.0 |

**The old reading stays available, by flag.** `"distinguish_unreadable": false` brings back absent-for-null, the `default`
for a `null` total, and the old one-operand wording. `"strict_numbers": false` brings back the general normalizer's lenient
reading. With both, a ruleset reads exactly as engine 0.0.1 read it; only the verdict's `engine_version`, its `verdict_id`
and (because the flags are part of the ruleset) its `input_hash` differ. That is measured on R4's 196 representations: 196 of
196 identical with those three set aside (`test/engine-defaults.test.ts`). Lint checks that `strict_numbers` is a boolean, and
it warns about `labels` only when the ruleset turns `distinguish_unreadable` off.

**Every verdict an earlier engine issued still replays.** A verdict names its engine, and replay re-performs it under the
behaviour of THAT engine (engine versions this build carries: 0.0.1, 0.1.0; `ENGINE_VERSIONS`). A 0.0.1 verdict is
re-performed with the 0.0.1 reading and compared byte for byte, its id included; a version the build does not carry is
replayed as structure only, as before. Every engine takes an `engine` option for this (`verify`, `verifyDeclarative`, the AP
and structured AP checks, `verifyAction`, `verifyCitations`, `reconcile`, both twins); a verdict made with it names that
version. Engine 0.1.0 changed no other engine's behaviour: their 0.1.0 verdicts differ from 0.0.1's in `engine_version` and
`verdict_id` only (tested on every invoice and pay-app fixture, the 100 public AP cases, the iXBRL twin, reconcile, legal and
action). Both goldens still pass byte for byte, run under engine 0.0.1.

**What the new defaults move, measured on the goldens** (each result compared under engine 0.0.1 and 0.1.0, identity aside):

| set | results | moved | of which only in remedies | verdict outcomes moved | claim outcomes moved |
|---|---|---|---|---|---|
| first golden | 489 | 388 | 260 | 0 | 0 |
| e-invoice golden | 177 | 98 | 41 | 0 | 8 |

The wording moves are the unreadable account (every unreadable operand named, with the value as reported) and remedies that
name the field path. The 8 claim moves are line checks on synthetic e-invoices that go from FAIL to an abstention: the line
reports its allowance and charge list as `null`, which now reads as "seen, not read", so the line-math guard that abstains
when a list is present cannot rule it out. The documents' verdicts still FAIL on other claims. This is the price of the
default: an extractor that writes `null` for "not on the document" now gets an abstention there, not a 0. It can omit the key
instead (absent stays absent), or the ruleset can say `"distinguish_unreadable": false`.

**Peppol 0.2.0 is the default e-invoice ruleset.** The engine carries the Peppol rulesets by name, as verbatim copies of
their files (a test compares each to its file and pins the file's sha256):

| name | resolves to |
|---|---|
| `peppol-en16931` | 0.2.0 (`docs/examples/peppol-en16931.ruleset.v0.2.json`, sha256 `c0e1ae6c…`) |
| `peppol-en16931@0.2.0` | 0.2.0 |
| `peppol-en16931@0.1.0` | 0.1.0 (`docs/examples/peppol-en16931.ruleset.json`, sha256 `0a3cd5a5…`), unchanged and still shipped |
| `e-invoice` | the default e-invoice ruleset: `peppol-en16931` at its default version |

The CLI takes a name wherever it takes a ruleset file (`--ruleset peppol-en16931` to verify, lint, measure and replay); HTTP
`/v1/verify/declared`, `/v1/ruleset/lint` and `/v1/ruleset/measure` and MCP `verify_declared` take it as the `ruleset`
string. A carried id at a version the engine does not carry is refused, naming the versions it does. A verdict made under a
name is the verdict made under the file, byte for byte. The e-invoice twin's own footing still reads the 0.1.0 Peppol ruleset
(now under the engine's default reading), and no other default moved: the invoice default stays `invoice@0.1.0` and the legal
default stays `legal@0.0.1`.

**Not changed by engine 0.1.0.** The built-in TypeScript rulesets (`invoice` and `pay-app` through `verify()`, and
`reconcile`) still read numbers through the general normalizer, leniently: `verify()` on the built-in invoice reads a tax
reported as `"°144.42"` as 144.42. They have no ruleset flag to carry the old reading, so moving them is a separate change.

### The extraction contract: `require_contract` (2026-10-03)

Every declarative ruleset now has a generated extraction schema: `verify extract-schema <ruleset>`. It holds one property
per field term of the `fields` block, typed by kind, each with a required provenance object `{page, line, raw, reader}`.
Every field must be read or named in `not_printed`, and an unknown term is refused. The full description is in
[EXTRACTION-CONTRACT.md](docs/EXTRACTION-CONTRACT.md).

- **`"require_contract": true`** (new key, default off, engine 0.1.0): verify reads only an envelope that validates against
  the ruleset's schema. Anything else is refused. No check runs, the one claim `contract.EXTRACTION_CONTRACT` abstains and
  names the first violation (code and JSON Pointer), and a typed remedy says what to hand over.
- **Without the flag**, an envelope is lowered to the fields' first paths and checked as usual. `"UNREADABLE"` stays the
  marker and abstains, and its remedy names the page and line from the envelope's provenance. Every other input is read
  exactly as before and keeps its input hash.
- **Engine 0.0.1** reads neither the key nor an envelope.
- **No shipped ruleset sets the flag.** Peppol 0.2.0 and 0.1.0 are unchanged.

### Engine 0.2.0, Peppol 0.3.0 and legal 0.2.0: closing a red team's findings (2026-10-03)

A matrix red team attacked the built products and reported each finding with a script that reproduces it. This section says
what changed in verify and what did not. Verdicts that name engine 0.0.1 or 0.1.0 are re-performed exactly as those engines
read; every bundle issued before this change replays byte-identical.

**Remedies are part of a verdict's identity.** A declarative ruleset's remedies travel in the inputs, and the input hash sets
them aside, so two rulesets that differed only in remedy text gave one verdict id, and a bundle could carry doctored remedy
text in both its ruleset and its verdict and still replay as a match. From engine 0.2.0 every verdict carries
`remedy_table_hash` (the sha256 of the remedy table it was answered from; `remedyTableOf` for a declarative ruleset) and its
`verdict_id` derives from it as a fourth part. Replay, for every engine, re-derives remedies from the ruleset this build
carries under the same id@version and FAILS, naming the check, when the bundle's ruleset carries other remedies. A closed loop
should hand an agent only remedies re-derived from the ruleset it pinned, never a bundle's text.

**HELD-SUSPECT.** One garbled character on a failing operand used to turn a FAIL into an open check. From engine 0.2.0, when a
declarative claim cannot run because a value was reported as a string that does not read, the engine re-evaluates the claim
under every reading of that string one character away (one deletion, substitution or insertion of `0-9 . ,`). If one of them
FAILs the check, the claim stays INSUFFICIENT_DATA, carries `suspect` (what was reported, the first failing reading, the two
sides, the counts), and the gate books it as a FAIL (`gateStatus` FAIL; `gateLabel` HELD-SUSPECT; `verify --gate` exits 1).
This is a provisional default; `"held_suspect": false` in a ruleset keeps such claims plain holds. The cost: a garble of a
correct value usually has a failing one-character reading too, so it is held as suspect as well, and a legible value clears
it. A value reported as absent, `null`, blank or `"UNREADABLE"` has no string to read differently and stays a plain hold.
*Retired in engine 0.3.0 (the product ruling: a flag, never a FAIL). See the next section. A 0.2.0 verdict keeps this reading
when replayed.*

**Reading numbers, identifiers and keys (engine 0.2.0).**

| what | before (engine 0.1.0) | engine 0.2.0 |
|---|---|---|
| `"1.234"`, `"1,234"` | read by digit count (1234) | unreadable unless the ruleset declares `"locale"` |
| `"1,23"` | 1.23 | unreadable unless a locale declares the decimal comma |
| `"1 234"` | read as 1 (truncated) | unreadable unless a locale declares the space grouping; with `fr`, 1234 |
| `"0.125"` | 0.125 | 0.125 (a group starting with 0 is never a thousands group) |
| `"−330.00"` (U+2212) | read as positive | -330 |
| `"€1,234.567"` as a price | unparseable (the amount parser would round it) | 1234.567, exactly |
| `"3.335"` as a price or quantity | 3.335 | unreadable unless a locale is declared (a lone `.` before three digits) |
| `"EU\u200BR"` (a zero-width space inside), `"ＥＵＲ"` as identifiers | not `"EUR"` | `"EUR"` (NFKC, format characters and every kind of space removed) |
| `"ЕUR"` (Cyrillic `Е`) | not `"EUR"` | not `"EUR"`: lookalikes across scripts are not folded |
| a key `"payable_amount "` | absent (an optional total takes its default) | unreadable, naming the key; never a default |

`"locale"` is `en` (`.` and `,`), `de` (`,` and `.`), `fr` (`,` and a space), `ch` (`.` and `'`), or
`{ "decimal": "." | ",", "group": "," | "." | " " | "'" | "" }`. With a locale, exactly its marks are read. JSON numbers are
never affected.

**New ruleset keys** (any engine; a ruleset without them keeps its bytes):

- a list field: `"each": [array paths]` with `paths` relative to each element, used through `sum(ROLE)`;
- `"line_computed": { ROLE: expression }`, a per-line role, usable in a line check or summed at document scope;
- on a check, `"exact_tolerance": true` (the difference rounded to 9 decimal places, then compared with `tol`),
  `"fail_if_unreadable": [roles]` (an unreadable operand FAILs the check, named, instead of abstaining) and
  `"advisory": true` (the check makes no claim; a failure becomes an `advisories` entry on the verdict: counsel, never a
  verdict, never a gate).

**Peppol BIS 3.0 ruleset 0.3.0** (`docs/examples/peppol-en16931.ruleset.v0.3.json`, `peppol-en16931@0.3.0`; 0.2.0 stays the
default and its file is unchanged):

| check | 0.2.0 | 0.3.0 |
|---|---|---|
| `BRCO14_VAT_SUM` (BR-CO-14) | at most four VAT rows, by position; a fifth row, or a row without its tax amount, abstains | every row (`VBD_TAX`, a list field); a row reported without a readable tax amount FAILs, named |
| `LINE_MATH_INT` (PEPPOL-EN16931-R120) | line net read at the cent, slack 0.020001 (a line 0.0201 over still passed) | line net read at full precision, slack exactly 0.02: 0.02 holds, 0.020001 fails |
| `R120_SUM` (new; stricter than the standard) | none: R120's slack is per line, so 1,000 lines could each take 0.02 | Σ over lines of the R120 deviation ≤ 0.02; provisional default `"advisory": true` (counsel stating the summed deviation and the line count); `"advisory": false` makes it a FAIL |

Measured on the red team's scripts (the same scripts, loading the 0.3.0 file): R120 +0.02 on 10, 100 and 1,000 lines PASSes
with an advisory stating 0.2, 2 and 20; with `"advisory": false` each FAILs on `R120_SUM`. A line 0.0201 over fails R120. A
wrong fifth VAT row FAILs BR-CO-14.

**Legal ruleset 0.2.0** (opt-in, `ruleset: 'legal@0.2.0'`; 0.0.1 stays the default, 0.1.0 is unchanged). 0.1.0's reading, every
limit the same, plus a meaning guard applied in this order:

1. a bracket that replaces opinion text with a different word, or swaps a modal (`must`, `shall`, `may`, `can`, `should`,
   `will` …), a negation or a quantifier (`all`, `any`, `some`, `no`, `only` …), or that inserts one, FAILs as an altered
   quotation, naming both words; a bracket may change case or inflection (`serv[e]`, `find[s]`), or put a referent for a
   pronoun (`[the court]` for "we");
2. 0.1.0's negation checks (an omitted or bracketed negation) abstain as before;
3. an ellipsis whose omitted text holds a condition or limiting word (`unless`, `provided`, `except`, `only`, `not`, `but`,
   `subject to`, `so long as`, `if`, `where`, `to the extent`, `preclude`, `prohibit`, `bar`, `exclude`, `deny`, `lack` …)
   abstains as an "elided condition", showing the omitted text;
4. inner quotation marks the quotation drops (unless a parenthetical such as "(internal quotation marks omitted)" says so),
   or adds where the opinion has none, abstain as a "nested quotation";
5. a quotation that starts right after a negation abstains, as in 0.1.0.

On X2's 58 items (20 known-bad, 20 controls, 18 supplementary) every 0.2.0 outcome equals 0.1.0's: the convention fixes still
PASS, the two misquotes from the quoting opinions still FAIL, and no known-bad or supplementary item PASSes. These are post-hoc numbers on a set the
rules' authors had seen.

**What 0.2.0 does not decide.** Whether quoted words are the holding, a concurrence or dissent, or a party's argument
the opinion reports (the audit says so); a quotation that stops just before a condition with no ellipsis; a passage that sits
inside a quotation the opinion opened earlier (enclosure). Each needs a section-aware source or a reading of context.

**Not changed by engine 0.2.0.** The built-in rulesets (`invoice`, `pay-app`, `reconcile`) still read numbers through the
general normalizer, leniently. A line amount in another currency than the totals is still not caught (R051 reads one value).

### Engine 0.3.0: struck fields, the evidence ladder, the scope line (2026-10-03)

The full account is in [EVIDENCE.md](docs/EVIDENCE.md). What a ruleset author needs to know:

- **No new ruleset keys.** Every 0.3.0 behaviour follows from the fields and checks a ruleset already has. A check that needs an
  unreadable field abstains as before. The verdict now lists that field under `struck`, with its provenance, and lists the check
  under `would_unlock`. `"held_suspect": false` still turns suspicion off: the field stays struck as `unreadable`, without the
  `suspect` flag.
- **Suspect is never a FAIL.** A struck field whose one-step reading would fail a check is flagged and counted (`counts.suspect`).
  The gate reads OPEN, never FAIL. A computed FAIL elsewhere in the same verdict still fails it.
- **Absent is not struck.** A field the document does not carry abstains `FIELD_MISSING` or takes its `default`, as before
  (PASS-WITH-OPEN at a gate). Only a field that was seen and not read is struck.
- **Tolerance for agreement.** When arbitration compares two sources for a field, they agree within the smallest `tol` of the
  checks that read that field (default 0.01). A ruleset's tolerances therefore also decide when a bank line corroborates an
  invoice amount.
- **Terms matter for E1.** A CORRECT that files a UBL XML is read by the field's published term: the `BT-…` at the start of the
  field's `term`, or its `term_key`. A field without one cannot be corrected from a structured document.
- **The floor.** A plain extraction rests on `unstated` values. An extraction-contract envelope rests on its readers' tiers (E2 for
  a born-digital page, E3 for a scan). The verdict states the worst tier its computed checks rest on, and every verdict ends with
  the scope line.

### Engine 0.4.0: claims over tables (2026-10-04)

A claim over a published table ("the curve is flat within 10 km/s beyond 10 kpc", "the published V_flat replays from the
rows") needs things the language did not have: a square root, a median, a count, the row before, a document value inside a
row check, and a named procedure. Engine 0.4.0 adds them. Everything below is read only by engine 0.4.0. Under an earlier
engine the grammar, the role references and every evaluation path are the old ones byte for byte, and the new keys are not
read, so every verdict that names 0.3.0 or earlier keeps its bytes and replays. A ruleset that uses none of the new forms gets,
under 0.4.0, the verdict 0.3.0 gives, apart from `engine_version`, `verdict_id` and `scope.engine_version`. Measured: both
goldens (489 and 177 results), R4's 196 and T1's 120, 0 moves.

| form | where | what it means |
|---|---|---|
| `sqrt(x)` | any expression | the IEEE-754 square root, rounded to 9 decimal places. `x < 0` has no value: the claim abstains `OUT_OF_RULESET_SCOPE`, detail `no value: sqrt of a negative value (-4) in "…"`. Never NaN. |
| `median(R)`, `min(R)`, `max(R)`, `count(R)` | document checks, computed roles | an aggregate over every row of a line field or line-computed role, or every element of a list field |
| `fn(R, SET)`, `sum(R, SET)` | document checks, computed roles | the same over the rows of a named row set (below). One-argument `sum(R)` is unchanged |
| `prev(R)`, `next(R)` | row checks, line-computed roles, row-set conditions | R on the row before / after |
| `doc.R` | row checks, line-computed roles, row-set conditions | the document's value of R (a document field, a computed role, an algorithm role) inside a row |
| `{ "neighbour": "prev" \| "next" }` | `applies_if` of a row check, a row-set condition | the row has a row before / after it; on the edge row the check is listed under `not_applicable` |
| `"row_sets": { NAME: [conditions] }` | the ruleset | a named set of rows: every condition (the shapes of `applies_if`) holds on the row |
| `"algorithms": { ROLE: { "algorithm", "inputs", "output"? } }` | the ruleset | a document-scope role computed by a named, pinned procedure (below) |
| `"provenance_kinds": ["page", "archive"]` | the ruleset | the generated extraction schema also accepts archive provenance ([EVIDENCE.md](docs/EVIDENCE.md)) |

**The numbers, exactly.** Arithmetic is IEEE-754 binary64. An aggregate reads the rows in row order.
- `median`: sort ascending; an odd count gives the middle value, an even count the mean of the two middle values, `(a + b) / 2`. Rounded to 9 decimal places.
- `min`, `max`: the element, rounded to 9 decimal places. `count`: an exact integer.
- `sum(R, SET)`: added left to right, rounded to 4 decimal places, as `sum` always was.
- `sqrt` and every algorithm output: rounded to 9 decimal places. Arithmetic that is not finite has no value.

**An aggregate is computed whole or not at all.** It has no value when:
- a selected row's value is unreadable. The claim abstains `UNPARSEABLE`, naming the row. The verdict strikes exactly that
  field, and `would_unlock` names the claim. A row outside the set never matters.
- a selected row's value is absent (`FIELD_MISSING`), or has no value (a domain note: `OUT_OF_RULESET_SCOPE`).
- a row's membership cannot be decided, because its condition reads an unreadable or absent value. The detail says
  `membership in SET is unknown`, and the row's operand is struck.
- the line array is absent.

On an empty selection, `count` is 0, and `sum`, `median`, `min` and `max` have no value ("no row of SET has a value to
aggregate"). A partial aggregate is never computed.

**Neighbours.** `prev(R)` on the first row and `next(R)` on the last row have no value. The claim abstains with the existing
reason `OUT_OF_RULESET_SCOPE` and a detail that starts `no_neighbour:` (`no_neighbour: line 0 has no previous row, so prev(RAD)
has no value`). A check about pairs of rows says so with `applies_if: [{ "neighbour": "prev" }]`: the first row is then not
applicable, so a clean table reads PASS, not PASS-WITH-OPEN. A line-computed role that reads `prev()` has no value on the
first row, and a check on it says `no_neighbour:` too.

**Order of evaluation.** Line-computed roles are evaluated role by role, each over every row. So `prev()` or `next()` may read a
field or an earlier line-computed role. Then come the algorithms, then the computed roles in order. A line-computed role that
reads a computed or algorithm role through `doc.` (directly, or through another such role) is evaluated after the computed
roles, and only checks may read it. Lint refuses a computed role, an algorithm input or a row set that reads it. A row-set
condition reads document fields through `doc.`, never computed roles.

**Named algorithms are pinned procedures** (`src/algorithms/`). A published procedure is a claim like any other. A ruleset
that relies on one relies on that procedure, as its source states it, in exactly those bytes of code. So a registry entry
carries:
- an id and a version: a changed procedure is a new version, never an edit;
- its source: the citation, the DOI, the URL, the sha256 of the fetched PDF and of the fetched text, the verbatim quote and its
  sha256, and the reading taken where the text is loose;
- its implementation: one file of deterministic code, pinned by `implementation_sha256`, the sha256 of the file with CRLF folded
  to LF. A test recomputes it.

The ruleset names an entry by ref. The ruleset's input identity carries each named entry's pin, so a verdict's input_hash, and
so its verdict_id, moves when the implementation or the source does. The verdict lists the pins (`algorithms`). Replay refuses,
naming both hashes, a verdict whose pin this build's registry does not carry byte for byte. An algorithm role with an
unreadable input row abstains `UNPARSEABLE`, naming the row. The procedure's own refusal abstains `OUT_OF_RULESET_SCOPE` with
its reason.

The first entry is **`sparc.vflat@1`**: the flat rotation velocity V_f of Lelli, McGaugh & Schombert 2016, ApJL 816, L14,
Section 2.2 (DOI 10.3847/2041-8205/816/1/L14; arXiv:1512.04543, PDF sha256 `750465eb…963c`). The registry entry carries the
whole quote, from a UTF-8 text extraction of that PDF (sha256 `501a8f87…f3d6`, lines 34-52; the typesetting of the equations is
lost in extraction). Three fragments of it, verbatim:

> We estimate Vf using a simple automated algorithm. We start by calculating the mean of the two outermost points of the RC:

> |VN−2 − V | ≤ 0.05.

> Galaxies that do not satifsy the condition at the ﬁrst iteration are rejected, hence we only consider RCs that are ﬂat within
> ∼5% over at least three velocity-points.

The reading is as follows. The rows are taken in the table's order and must have strictly increasing radius. The procedure
starts with the mean of the two outermost velocities. While the next velocity inward lies within 5% of the running mean, it is
included and the mean is recomputed over every included velocity; the mean is summed outermost first. The first failure stops
the procedure. A failure at the first test, fewer than three points, or a radius that is not strictly increasing returns no
value with the reason. The inputs are `rad` and `v`. The outputs are `vflat` (the default), `n_used` and `r_inner` (the radius
of the innermost included row).

**The demo:** `docs/examples/rotation-curve.ruleset.json` (`rotation-curve-sparc@0.1.0`; a demo, never a benchmark). It reads one
galaxy's SPARC rotmod table and its Table1 row and checks:
- the units, the distance cross-reference and the galaxy names;
- that radius increases;
- that at least 5 rows lie beyond 10 kpc;
- three claims fixed before the numbers were computed. C1: flat within 10 km/s of the median beyond 10 kpc (`max(DEV, OUTER)`,
  `DEV = abs(VOBS - doc.VMED_OUTER)`). C2: Vobs − V_bar ≥ 30 km/s at every row beyond 10 kpc, with V_bar from `sqrt`. C3:
  `sparc.vflat@1` replays the published Vflat within 1 km/s.

On NGC 3198 every claim computes and PASSes:

| claim | value |
|---|---|
| largest deviation from the median beyond 10 kpc | 7 |
| smallest baryonic excess beyond 10 kpc | 58.3755 |
| V_f by `sparc.vflat@1`, 23 rows | 150.087 (150.086956522), against the published 150.1 |

The evidence floor is E1: every value carries archive provenance. No SPARC data ships with the product (SPARC states no licence),
so the tests use synthetic tables.

**Not done in 0.4.0:**
- an aggregate inside a row check (read it through `doc.` and a computed role);
- an aggregate over the rows of a list field by a set;
- `fail_if_unreadable` for an operand read only through an aggregate, `prev()`, `next()` or `doc.`;
- rounding inference over aggregate operands (an aggregate contributes no operand to `rounding: "infer"`);
- strict `<` and `>` in checks (radius strictly increasing is two checks, `>=` and `!=`, as the demo does).

### Engine 0.5.0: the choice ledger (2026-10-04)

A published number is a statement made from data through choices the data does not fix. When the choices are written down the
number replays; when they are not, the replay can only be a range. Engine 0.5.0 makes the choices part of the ruleset and part of
the verdict. Everything below is read only by engine 0.5.0; a ruleset without these keys keeps its bytes and lints as before.

| key | where | what it means |
|---|---|---|
| `"choices": [{ "id", "kind", "load_bearing", "default"?, "not_applicable"?, "governs"?, "name"? }]` | the ruleset | the slots. `kind`: weights, flags, ratio, units, model_form, algorithm, tolerance, selection. `default`: `{ "value", "source" }`, the value supplied when the document states none, and where it comes from |
| `"choices": { "ID": { "value", "stated": true, "span": { "page" \| "section", "quote" } } \| { "unstated": true } }` | the claim document (top level of the extraction or envelope) | the author states the slot with a quoted span, or the document is marked silent on it |
| option `supplied_choices: { ID: { value, source } }` | the call (`verify --supplied-choices <file>`) | the judge supplies a value; it is bound into the inputs |
| `"choice": "ID"`, `"params": { "name": "ID" }` | an `algorithms` entry | the algorithm slot the role computes for, and each parameter from a slot |
| `"support": { "field", "max_of" }` | a numeric check | the point a model is evaluated at, and the measured line field it must not pass |

**Resolution.** A well-formed stated fill is `stated`. Else the judge's value, then the ruleset's default, is `supplied`, with its
source and who supplied it. Else the slot is `unstated` and has no value. A slot with `not_applicable` says why and never counts. A
stated fill without a quote and a page or section is not a statement: the slot resolves as if the document were silent, and the
ledger entry says why.

**What a value does.**
- A number is a document role named by the slot id: a document check reads `UPS_DISK`, a row reads `doc.UPS_DISK`.
- An algorithm slot linked with `choice`: a resolved value other than the ref the ruleset computes with leaves the role without a
  value (`OUT_OF_RULESET_SCOPE`, `choice_mismatch: …`). The engine never computes another procedure in the document's name. A slot
  stated with a registry ref is checked against the registry's pinned quote (`registry.verbatim`).
- An algorithm parameter comes only from a slot (`params`), so every free parameter is on the ledger. `rar.fit@1` takes
  `weighting`: `errors` or `unweighted`.
- A flags slot's value is a policy for per-value quality flags ([EVIDENCE.md](docs/EVIDENCE.md), "Per-value quality flags").
- `governs` names checks that depend on a slot the engine cannot see (a selection, a model form).

**The gate.** A check that depends on a slot with no value abstains before anything else (`FIELD_MISSING`, detail
`choice_unstated: …`, `missing` the slots). Its remedy says to state the choice with a quoted span, or to supply it as the judge.
Dependency is transitive: the check's expressions, conditions, guards, row sets, computed and line-computed roles, algorithm inputs,
links and parameters, `support`, and `governs`.

**The ledger** is on every declarative verdict (`choices`), and `counts.stated_rate` = stated / load-bearing (null when nothing is
load-bearing). Choices enter the verdict's identity: another supplied value is another verdict.

**Beyond the data.** A check with `support` whose point lies past the largest measured value makes no claim. The verdict carries an
advisory with `beyond_data: true`, the computed values and the two support numbers: counsel, never PASS or FAIL, and never read by
the gate. A point the engine cannot evaluate makes the check abstain.

**Lint** checks the shapes, unique ids (a slot id is a role name), `governs` codes, `not_applicable` slots (never load-bearing,
never a default), algorithm links and parameters, `support`, flags policies against their scheme, and that a slot a check depends
on is declared load-bearing. A load-bearing slot nothing depends on is a warning.

**`rar.fit@1`** is the one-parameter fit of the radial acceleration relation, g_obs = g_bar / (1 - e^-sqrt(g_bar/g†)), by weighted
orthogonal distance regression in log space. The paper (McGaugh, Lelli & Schombert 2016, PRL 117, 201101; LaTeX source lines
200-201) states only:

> The solid line is the fit of eq.~\ref{eq:RFRfit} to the
> unbinned data using an orthogonal-distance-regression algorithm that considers errors on both variables.

It states neither the weights nor the solver. The entry pins SCI-R1's preregistered reading (Gauss-Newton inner steps, all rows
together, at most 60; Brent's bounded minimiser on ln g† over [ln 0.01, ln 100], xatol 1e-8) and names SCI-R1's script by sha256 as
the reference implementation. On SCI-R1's 2700 points it gives 1.0988500946 against SCI-R1's 1.0988500779; unweighted, 1.1363129556
against 1.1363129438. That missing statement of the weights is why SCI-R1's headline missed: its weights give 1.0989, outside
1.20 ± 0.10, and SCI-R1's five reasonable variants (three weightings, two samples) span 0.97 to 1.16. In the ledger the weights are a `weights` slot with status
`supplied`, and its source says the paper is silent.

**The demos.**
- `docs/examples/rotation-curve.v0.2.json` (`rotation-curve-sparc@0.2.0`; v0.1 is unchanged): V_bar reads the mass-to-light
  ratios as slots (UPS_DISK, UPS_BUL; the document states them from the SPARC paper, Sect. 5.3.1), V_f is computed for the
  VF_ALGORITHM slot, FLAT_MODEL (the form of the curve past its rows) and G_KPC (G M_sun in kpc (km/s)^2) are supplied, and
  QC_FLAGS is not applicable (the rotmod rows carry no per-value flag). C4 checks the flat model inside the data; C5 evaluates it
  at twice the last radius, which the engine reports as counsel. On NGC 3198: C1 7, C2 58.3755, C3 150.087 (as under v0.1), C4
  PASS (0.0146 ≤ 0.15), C5 counsel (46.17 × 1e10 M_sun at 88.16 kpc, past 44.08), `stated_rate` 0.6.
- `docs/examples/rar-sparc.ruleset.json` (`rar-sparc@0.1.0`): the fit over the relation's points. The paper states the procedure,
  the ratios and the selection (`stated`) and not the weights (`supplied`): `stated_rate` 0.8. g† 1.0989 against 1.20 ± 0.10
  FAILs; the rms, 0.1329 against 0.13 ± 0.02, PASSes; the points number 2700, not 2693. With the judge supplying `unweighted`, g†
  is 1.1363 and PASSes, under another verdict id.

No SPARC data ships with the product; the tests use synthetic tables.

**Not done in 0.5.0:** the engine does not compute the RAR points' uncertainties itself (it would need `tan()` and `log10()`), so
in the RAR demo the error model lives in the points a pinned script builds, and the weights slot chooses between using them and
not. A selection or a model form is enforced only through `governs` and guards. The judge's values are not signed.

### Engine 0.6.0: strict built-ins, Peppol 0.3.0 by default, pay apps in plain words (2026-10-05)

Every change below is gated on engine 0.6.0. A verdict that names engine 0.5.0 or earlier is re-performed exactly as that
engine read it, and replays byte for byte.

**The built-in rulesets read strictly** (`src/rulesets/strict.ts`; red-team F6, F14, F15). Until 0.6.0 `invoice` and `pay-app`
read every value through the general normalizer, so `"$1OO.O0"` (letter O) read as 1, `"°225.0"` as 225, and `"1 234"` as 1.
Under 0.6.0 a money, price, quantity or rate value that arrives as text must read as exactly one number. The rule is the
declarative path's (`readNumberTextV020`), read in the document's own number format:

1. **Declared.** A top-level `"number_locale"` on the extraction names the format: `"en"` (1,234.56), `"de"` (1.234,56), `"fr"`
   (1 234,56) or `"ch"` (1'234.56). Only that format's marks are read.
2. **Settled by the document.** Otherwise the document's own text values settle it, when some value that reads without any
   format reads in exactly one of en and de (`"1,234.56"`, `"0.125"` and `"1,250,000"` are en; `"1.250,00"` is de), and no value
   reads in only the other. An ambiguous value is never its own evidence, so a lone `"1,23"` settles nothing.
3. **Neither.** An ambiguous value stays unreadable, and its reason says how to settle it.

| text | no format settled | `en` | `de` |
|---|---|---|---|
| `1234.56`, `$1,234.56`, `USD 2,695.00`, `(12.50)`, `0.125`, `8.25%` (a rate) | the number | the number | unreadable |
| `1.234,56 €` | the number | unreadable | the number |
| `$1OO.O0`, `°225.0`, `E 2O`, `1,2?5.00`, `40,000.` | unreadable: characters that are not part of a number | unreadable | unreadable |
| `1 234`, also with a no-break or thin space | unreadable: only a declared `fr` reads a space group | unreadable | unreadable |
| `1.234`, `1,234`, `75,000` | unreadable: a thousands group or three decimals | 1.234, 1234, 75000 | 1234, 1.234, 75 |
| `1,23`, `625,00` | unreadable: a decimal comma or a thousands mark | unreadable | 1.23, 625 |

Measured cost on real data: the five CORD sample receipts (`data/real`) write amounts like `"58,000"` and `"43.636"`, so under
0.6.0 the built-in footing abstains on all five. Four foot again with `"number_locale": "en"`. The fifth carries a line amount
`"40,000."`, which never reads (`test/real-cord.test.ts`). An EU invoice that writes `"1.250,00"` anywhere settles de, so its
`"625,00"` and `"237,50"` read as before.

An unreadable value keeps its raw text as the bound value. Every check that needs it abstains `UNPARSEABLE`, and the claim's
`asserted` is the value as reported, never a guess. A total that needs it says the value is present but not a number. A refused
addend (tax, service charge, discount) or a refused blank-means-zero cell on a pay app (columns D, E, F; line 2; line 7) is never
read as 0. JSON numbers are not text, so they are untouched. The cost: a price or quantity written as text with exactly three
decimals (`"3.335"`) is unreadable, as on the declarative path since 0.2.0. Send JSON numbers.

A field reported under a key that differs from one of the ruleset's paths only by spaces or invisible characters (`"total "`,
`"tax "`, `"line_items "`) is refused by name: "GRAND_TOTAL was reported under the key "total ", which is not its path "total"
but differs from it only by spaces or invisible characters: not read". It is never a bare FIELD_MISSING, and never a fuzzy
guess.

**Peppol 0.3.0 is the default e-invoice ruleset under engine 0.6.0.** A bare `peppol-en16931` or `e-invoice` resolves to
`peppol-en16931@0.3.0` (`docs/examples/peppol-en16931.ruleset.v0.3.json`). It is the version MISSES rows F4 (a line overbilled
0.02 at a time passed) and F8 (a VAT error hidden across five rows) were fixed in. Engines 0.1.0 to 0.5.0 resolve the bare name
to 0.2.0 (`resolveDeclarativeRuleset(name, engine)`). A replay never uses the default: a bare name on `verify replay` means the
version the verdict names.

**Pay apps** (found by a cold reader, an AI agent that had not worked on this tree, in the controller's role):

- A pay application handed over inside another object (`{ "ruleset": …, "extraction": { … }, "references": … }`) is named.
  Every check says "the extraction looks wrapped: the schedule_of_values array is under "extraction.schedule_of_values"; pass
  the inner object ("extraction") as the extraction", where engine 0.5.0 said "no schedule-of-values array" nine times.
- A FAIL reads in the words of the form, with the rule id and every number unchanged. "Law of Retainage (carried) VIOLATED: 5200
  ≠ 6200" now reads "line retainage adds to 6,200 but the total says 5,200". "Law of Continuity" now reads "previous on line 2
  is 60,000, which does not match last month's completed to date for that item, 64,000".
- `docs/examples/payapp-g702-g703.json` is a synthetic AIA G702/G703 application: seven schedule-of-values lines, stored
  materials, a change order and 10% retainage. `payapp-g702-g703.previous.json` is the application before it. Together they
  pass all 44 checks:

```sh
verify docs/examples/payapp-g702-g703.json --ruleset pay-app --history docs/examples/payapp-g702-g703.previous.json
```

The rewording runs in the ruleset's `finish()` hook, after tolerance and the honesty passes, so only a claim that is still FAIL
is reworded.

### Legal under engine 0.6.0: the text bound to its cite, provenance, wording (2026-10-05)

The legal rules themselves do not change (0.0.1's string match, 0.1.0's conventions, 0.2.0's meaning guard); what every legal
rule does around them changes, from engine 0.6.0 only (`src/legal/index.ts`, `src/legal/binding.ts`). A verdict that names
engine 0.0.1 to 0.5.0 is re-performed exactly as that engine read, byte for byte.

**The default rule moves to `legal@0.2.0` for a new verdict under engine 0.6.0** (the maintainers' decision of 2026-10-05, on the strength of the second legal
blind set below; `defaultLegalRuleset`). No ruleset and the bare name `legal` resolve to it under engine 0.6.0, and to
`legal@0.0.1` under earlier engines; a named version is issued as named, and a replay names its version.

1. **Binding.** A quotation is checked only against a text that names its cite: the reporter citation (volume, reporter and
   page, separated only by spaces or periods; a slip opinion's `<volume> <reporter> ___` names the volume and reporter) and
   one distinctive word of each party of the case name (corporate suffixes and procedural words aside; an abbreviation
   read as a prefix). When any part is missing, the claim is INSUFFICIENT_DATA (`REFERENCE_NOT_PROVIDED`, with `missing`
   naming `cite` and/or `case_name`): "the supplied text does not name <cite>; it may be the wrong opinion". Never PASS.
   **Parties only, opt-in and labelled.** A text supplied with `bind: "parties"` (CLI `--bind parties`) also binds a citation
   whose parties are all named in it when its reporter citation is not. The claim's explanation says "Bound by parties only",
   `opinion_sources` records `tier: "parties-only"` and "bound by parties only; reporter citation not found in text", and the
   verdict's choice ledger (`choices`) records the binding as a stated choice (`binding:<key>`, kind `selection`). Strict
   binding is the default; when it decides a citation, the ledger records it as the rule's default, never as unstated.
2. **Provenance.** A source may be `{ text, source?, url?, retrieved_at?, bind? }` as well as a string. Every 0.6.0 legal verdict
   carries `opinion_sources`: per supplied text, sorted by key, its sha256, length, stated origin, and what it names per
   citation. Engines before 0.6.0 read string sources only. The citations verb reads files as strict UTF-8: a non-UTF-8 byte
   or a byte-order mark is refused with its offset, never replaced or stripped (the text is hashed byte for byte).
3. **No coincidental passages.** legal@0.0.1 names a passage on a FAIL only on 0.1.0's rule (a whole-word anchor of 4 or more
   words, similarity 0.5 or more). An invented quotation that shares three words with the opinion abstains
   (`SPAN_NOT_FOUND`, "it may be fabricated") instead of FAILing with "conform the quotation to it" beside an unrelated
   sentence. A named passage is cut where its two-word margins cross a sentence boundary.
4. **Wording.** Every answer speaks of "the opinion text supplied for <case>", never "the opinion", and never says an
   authority is real. The audit (`renderCitationAudit`) no longer calls the check an existence check and lists each text's
   origin and sha256. New remedy tables (`LEGAL_REMEDIES_060`, `_V010_060`, `_V020_060`, `_060_NEAREST`, `_060_ALTERED`,
   `_060_UNBOUND`) carry the 0.6.0 words; their hash is bound into each 0.6.0 verdict id.

**Declared accuracy, legal.** The legal rates, blind and post-hoc, with intervals, are in `docs/LEGAL.md` (the Peppol table
above is Peppol's). The second legal blind set (preregistered 2026-10-05; body sha256
`bfaf202aab0f5b5155c5d8b994c9637dfa4a71941f06beb875ae465812c1259e`; shipped in `docs/bench/legal-blind-2/`): on half B, 0.2.0
passed 0 of 10 known-bad quotations and failed 1 of 10 genuine ones; 0.1.0 passed 2 of 10 known-bad ones. Tuning on half A
moved no limit, so that run produced no tuned rule. `legal@0.3.0` (below) is a different change, made afterwards.

**A cost to know.** Public opinion texts rarely print their own reporter citation: none of the 40 Caselaw Access Project texts
in the second blind set did. Such a text abstains under strict binding until the caller adds the caption and citation line a
reporter prints, or supplies it with `bind: "parties"`. Under `legal@0.2.0` that binding is labelled and can PASS; under
`legal@0.3.0` it is labelled and stays open.

### Legal 0.3.0: the caption, parties-only left open, edge conditions, letter case (2026-10-05)

A cold reader's adversarial brief (an AI agent in a legal-operations director's role; 26 citations, seven opinion excerpts) found eight quotations `legal@0.2.0` passed and
should not have. Three were a later opinion's sentences checked against that opinion's text, supplied for a case it cites:
Cooper v. Aaron for Brown v. Board of Education, and for Marbury v. Madison. Five dropped a condition at the edge of the
quotation or in an omission with no condition word. It also found that a parties-only binding gave `outcome: PASS`,
`gate_status: PASS` and exit 0. `legal@0.3.0` closes each one. It runs from engine 0.6.0 only (asked for under an earlier
engine, it throws), and it was the default for a new verdict under engine 0.6.0 (`defaultLegalRuleset`) on 2026-10-05,
until `legal@0.4.0` (below) took the default later that day. A verdict that names `legal@0.0.1`, `0.1.0` or `0.2.0` is re-performed as before, byte for byte.
`src/legal/index.ts`, `binding.ts` (`captionOf`, `captionNamingOf`) and `quotation.ts`.

**Why it took the default.** The rule is stated in `docs/LEGAL.md` ("How the default is chosen"):

1. the lowest upper bound on known-bad quotations passed on half B;
2. then fewer false FAILs;
3. a version that closes a false-PASS class a cold reader (an AI agent) found may take the default the same day, with its half-B row
   published and the date named.

On half B, 0.0.1, 0.2.0 and 0.3.0 tie on rule 1 (0 of 10, upper bound 27.8%), and 0.2.0 and 0.3.0 tie on rule 2 (1 of 10
genuine failed). 0.3.0 takes the default by rule 3. Its half-B row is 0/10 known-bad passed (0.0% to 27.8%), 1/10 genuine
failed (1.8% to 40.4%), 5/10 passed and 4/10 abstained. That row is **post-hoc**: it was run after half B's numbers were
published, by a rule built afterwards, with a note saying so hashed before the run. It gives every outcome 0.2.0 gives. It is
the post-hoc bench table `legal-blind-2-030` in [BENCH.md](docs/BENCH.md).

1. **Caption binding.** A text binds a citation only when its caption names the reporter citation and each party. The caption
   is the case-name line and the citation line in the text's head: its first lines before a line of more than 400
   characters, at most 12 (`CAPTION_LIMITS`).
   - The name line is the first line with " v. ", or a lone "v." line between two parties, or an "In re" / "Ex parte" /
     "Matter of" line.
   - The citation line lies within three lines above the name or two below it. A "Cite as" line anywhere also counts.
   - A line holding a sentence, or ending with a colon, is never caption.
   - A party written as initials ("FTC") is named by the caption's full name ("FEDERAL TRADE COMMISSION"), and a hyphenated
     name is read with or without its hyphen.

   A mention in the body binds nothing; it is reported. The claim is INSUFFICIENT_DATA (`REFERENCE_NOT_PROVIDED`): "the
   supplied text is Cooper v. Aaron, 358 U.S. 1 (its caption); it cites Brown v. Board of Education, 347 U.S. 483 but is not
   that opinion". Each `opinion_sources` naming records `by: "caption"`, `caption: { name, cite }` (or `null`) and
   `mentioned: true` when only the body names the citation.
2. **Parties only, left open.** Under `bind: "parties"`, a citation whose parties the caption names, but not its reporter
   citation, is checked. A quotation found there is INSUFFICIENT_DATA (`REFERENCE_NOT_PROVIDED`, `missing: ["cite"]`), with
   the passage as evidence: "bound by parties only: the quoted words appear in …, but its caption names the parties of … and
   not the reporter citation …". The verdict is PASS_WITH_OPEN (or INSUFFICIENT_DATA) and the citations verb exits 2. Its
   remedy (`LEGAL_REMEDIES_V030_PARTIES_ONLY`) asks for the reporter citation in the caption, or the attorney of record's
   confirmation. A FAIL or another abstention stands, labelled. The verb's headline counts parties-only citations under
   every rule.
3. **Conditions at the edges.** After 0.2.0's own guard, two more cuts abstain as an "elided condition":
   - an ellipsis whose omitted text opens a set-off phrase of time or procedure (after a comma: "after", "before", "upon",
     "until", "once", "when");
   - the part of the sentence cut off by an opening ellipsis, a closing ellipsis, or an opening capital that presents
     mid-sentence words as a sentence start ("[I]t cannot be said"), read to the sentence boundary, when it carries a
     condition.

   A period after an abbreviation ("U.S.", "v.", "Inc.") or inside an ellipsis does not end a sentence. Nor does a line
   break inside a sentence. A heading line does.
4. **Letter case.** Each literal piece is compared letter for letter. A changed case abstains (`SELECTIVE_QUOTE`, "case
   change: the quotation writes … where … reads …"). The exceptions are a bracketed letter, the first letter of the quotation
   or the first after an ellipsis, and a change disclosed by "(emphasis added)". "Verbatim" is said only on an exact match
   ("the same words, in the same letter case").
5. **Remedies.** `LEGAL_REMEDIES_V030`, `_V030_UNBOUND` and `_V030_PARTIES_ONLY` are new; the altered-bracket and
   partial-match remedies are 0.6.0's. Their hash is bound into each 0.3.0 verdict id.

**What it costs.** 0.3.0 gives every outcome 0.2.0 gives on 40 of 40 items of the second blind set and 58 of 58 of the
first (each first-set text given the caption line the second set's texts carried). Post-hoc replication on the full sets;
0.3.0 was not tuned on either set (its changes came from a cold reader's cases, an AI agent's), except one change prompted by the
first set, so this is held-out in fact but not by prereg; 0 known-bad passed on both. The change: one first-set genuine
quotation (CT14) moved from PASS to can't tell until the caption reader learned to read a hyphenated party name; before that
change, 57 of 58 were equal. The 40 of 40 is the bench table `legal-blind-2-030`; the 58 of 58 is listed in BENCH.md under
"Outside the rule". One fabricated item abstains for a different reason: its text is now bound, and the quotation
is not found. Texts without a caption, or with the caption inside a long first line, now abstain where 0.2.0 found the cite
in the body.

### Legal 0.4.0: a mid-sentence start, page marks, whole-sentence passages, short forms (2026-10-05)

The next cold reader (an AI agent in a legal-operations director's role) found that a quotation beginning in lowercase after "Only", "Unless …,",
"Except …,", "If …," or "Absent …," passed `legal@0.3.0` as "verbatim" (five of five), while the same cut written "[T]he …"
was held; that genuine quotations of texts carrying Westlaw or Lexis star paging (`*248`, `[*249]`) or a footnote numeral
(`counted.4 This`) FAILed, with a remedy that quoted the page marker; and that short forms and a Lexis header were refused
with the wrong reason. `legal@0.4.0` answers each. It runs from engine 0.6.0 only (asked for under an earlier engine, it
throws), and it was the default for a new verdict under engine 0.6.0 on 2026-10-05, by rule 3 of "How the default is
chosen" in `docs/LEGAL.md`, until `legal@0.5.0` (below) took the default later that day. A verdict that names `legal@0.3.0` or earlier is re-performed as before, byte for byte.
`src/legal/index.ts`, `quotation.ts` (`leadCutOf`, `pageMarksOf`, `sentenceSpanOf`, `wordDifferences`), `binding.ts`
(`citeLineOutside`).

1. **A mid-sentence start.** When the quotation begins where its sentence does not (no ellipsis, no capital it adds), the
   part of the sentence before it (`sentenceHeadBefore`, as 0.3.0's capital guard reads it) is held as an elided condition
   when it opens with a conditional or restrictive word, or ends with a comma right before the quotation after a stretch that
   holds one; and as an elided negation when its last clause (after the last semicolon, colon or "but") carries a negation
   the 0.0.1 guard did not already read. `SELECTIVE_QUOTE`, "elided condition: the quotation begins in the middle of its
   sentence in …, after "Unless the movant shows actual prejudice,", which carries "Unless"".
2. **Page marks.** Star paging alone between words, and one to three digits glued to sentence punctuation after a word that is
   not a numbered abbreviation, are read out of both sides (`pageMarksOf`), each as a space; the supplied text is unchanged,
   and evidence spans point into it. The answer names them ("read with star paging ignored (*248)") and is never "verbatim".
   A FAIL that matches once looser tokens are read out (`loosePageMarksOf`: a numeral glued to a word, a star mark inside one,
   a bracketed or "FN" call) is INSUFFICIENT_DATA (`UNPARSEABLE`), never FAIL. Sentence ends are read with the marks blanked.
3. **The named passage.** A FAIL's passage is the whole sentences holding the first and last words the quotation shares with
   the text (at most 600 characters either way), shown with page marks left out and a line-break hyphen joined; the same for
   a bracket FAIL. The FAIL names the words that differ, in its explanation and in the computation operand `differs`, which
   its remedy (`LEGAL_REMEDIES_V040`) quotes.
4. **Short forms.** A cite `<volume> <reporter> at <page>` is read as a pin cite to the one full citation of the same brief
   with that volume and reporter, a first page at or before the pin, and (when the short form names a case) every party of
   it; the naming records `short_form`. None or several, and "Id." and "supra": INSUFFICIENT_DATA (`REFERENCE_NOT_PROVIDED`,
   `missing: ["full_cite"]`), "short form; supply the full citation", answered by `LEGAL_REMEDIES_V040_SHORT_FORM`.
5. **Words.** A citation line in the head, outside the caption window, is named with its distance (naming `cite_line`;
   remedy `LEGAL_REMEDIES_V040_UNBOUND` states the window). No doubled period after a name ending in a period.

**What it costs.** On half B of the second blind set, 0.4.0 gives the same outcome as 0.3.0 on 19 of 20 items; one genuine
quotation moves from PASS to can't tell ("that a more just and humane system could not be devised", after "We do not decide
today that …, or"). On both halves, 39 of 40; on the first set (each text given a caption line), 58 of 58; 0 known-bad passed
on either. Post-hoc, with no note hashed before the run, and with one change made after a first run (the negation reading
narrowed to the quotation's own clause), so this is not held-out for that change. The rows are in `docs/LEGAL.md`; they are
not a bench table.

### Legal 0.5.2: the lead-in, pluralities, vendor downloads (2026-10-06)

A cold reader (an AI agent reading as a legal-operations director) found words the opinion reports passing as its own,
four as "verbatim" ("the statute of limitations was tolled." after "The dissent maintains that"), a plurality part
labelled "the majority opinion", and genuine quotations FAILing across a Westlaw PDF's page break and a Lexis "HN4[ ]"
marker. `legal@0.5.2` answers each. It runs from engine 0.6.0 only, and it is **the default for a new verdict under engine
0.6.0** from 2026-10-06, by rule 3 of "How the default is chosen" in `docs/LEGAL.md`: it ties 0.5.1 on half B and gives
every outcome 0.5.1 gives on both blind sets (40 of 40, 58 of 58), post-hoc. A verdict that names `legal@0.5.1` or earlier
is re-performed as before, byte for byte. A quotation that begins inside its sentence prints how the sentence begins, and
answers can't tell when those words report someone else's position or frame what follows; a plurality is named; a PDF's
page furniture and a Lexis marker are read out; a KeyCite flag is not read as the caption, and the "All Citations" lines
name the text. The code is in `src/legal/index.ts` (`quote051`, `pluralityWhere052`), `quotation.ts` (`leadFrameOf`,
`furnitureMarksOf`, `lexisHeadnoteMarksOf`, `ellipsisDifferences`), `sections.ts` (`pluralityOf`) and `binding.ts`
(`allCitationsLines`).

### Legal 0.5.1: the cut at the end, disclosed conventions, headnote numbers (2026-10-06)

A cold reader (an AI agent reading as a legal-operations director) found four exact-word cuts that reverse the opinion
passing `legal@0.5.0`, two as "verbatim", and genuine, disclosed quotations FAILing: an em dash against a Lexis "--", and a
citation sentence left out under "(citation omitted)", "(citations omitted)" or "(cleaned up)". `legal@0.5.1` answers
each. It runs from engine 0.6.0 only, and it was the default for a new verdict under engine 0.6.0 from 2026-10-06 until
`legal@0.5.2` took it later that day, by rule 3 of "How the default is chosen" in `docs/LEGAL.md`: it ties 0.5.0 on half B and gives every outcome 0.5.0 gives on
both blind sets (40 of 40, 58 of 58), post-hoc. A verdict that names `legal@0.5.0` or earlier is re-performed as before,
byte for byte. A quotation that stops before its sentence ends is never called "verbatim"; its PASS prints the
continuation, and a continuation that limits or negates the quoted words answers can't tell. Dashes are one; a
parenthetical excuses what it names, and the PASS says what; Westlaw headnote numbers between sentences are read out; a
FAIL names punctuation, an inserted bracket, an undisclosed citation and a stitch. The code is in `src/legal/index.ts`
(`quote051`, `notFound051`, `passage051`) and `quotation.ts` (`tailLimitOf`, `headnoteMarksOf`, `citationSentencesOf`).

### Legal 0.5.0: whose words, where a PASS matched, the cite lookup, Lexis as delivered (2026-10-05)

The next cold reader (an AI agent in a legal-operations director's role) found that words from West headnotes, the West synopsis, the syllabus, a Lexis
headnote and a dissent passed `legal@0.4.0` as the opinion's (three of them as "verbatim"), under the claim name "Citation
quoted accurately", and that the report never said where a PASS matched. Full citations with a pin, the Bluebook form and a
parallel citation answered "No opinion text" for a text that was supplied. A Lexis header as delivered refused all eight of
the reviewer's Celotex citations until the text was edited. A genuine quotation across a Lexis `n7` footnote call FAILed.
`legal@0.5.0` answers each. It runs from engine 0.6.0 only (asked for under an earlier engine, it throws), and it was the
default for a new verdict under engine 0.6.0 from 2026-10-05 until `legal@0.5.1` took it on 2026-10-06, by rule 3 of "How the default is chosen" in `docs/LEGAL.md`.
A verdict that names `legal@0.4.0` or earlier is re-performed as before, byte for byte. The code is in `src/legal/index.ts`,
`sections.ts` (new), `quotation.ts` (`widePageMarksOf`), `binding.ts` (`reporterBlockLines`) and `replay-notice.ts` (new).

1. **Sections.** `sectionsOf` reads the text line by line: editorial headings, the start of the majority opinion, separate
   opinions' designations (on up to three short lines), and footnotes after a separate opinion. What precedes the first start
   is the header. A quotation is read against a view of the text in which every other section is blanked, with offsets kept
   (`viewOf`, plus a separator so nothing matches across a blank). A match there runs every 0.4.0 guard. When nothing
   matches, the order is: a wide footnote-call reading (`UNPARSEABLE`); the words found in another section (`SPAN_NOT_FOUND`,
   "whose words: the quoted words appear in …", every section that holds them named, the place as evidence, remedy
   `LEGAL_REMEDIES_V050_SECTION`); a FAIL on a passage of the opinion; the nearest passage elsewhere (can't tell); not found.
   A citation whose parenthetical names a separate opinion ("(Brennan, J., dissenting)") is read against that opinion
   (`opinionNamedBy`, `sectionsNamed`). If the text marks no such opinion the answer is `SPAN_NOT_FOUND`, `missing:
   ["separate_opinion"]`.
2. **Where a PASS matched.** Every PASS ends "Found in the majority opinion, line 17 (character offset 1849)." (or "Found at
   line 3 of the supplied text …" when no section is read), plus "The pin page 248 is not checked." when the cite carried a pin.
   The verdict's `opinion_sources[].sections` records the sections read.
3. **The lookup.** After `source_key` and the cite as written, each reporter citation read off the cite (`citeParts`: a
   parenthetical, the pin and a leading case name read off) is matched against the keys, spacing and periods aside. The
   citation is bound by that reporter citation and its case name (the brief's, else the full citation's); a cite that already
   reads as a reporter citation is bound as written. A miss is `REFERENCE_NOT_PROVIDED`: "no supplied text matched the cite as
   written (looked for: …; texts supplied: …)". The naming records `read_as`. A short form may point to a full citation
   written in Bluebook form.
4. **Lexis as delivered.** The line or two right after a header's "Reporter" heading that start with a volume number and carry
   a reporter citation are caption citation lines (`reporterBlockLines`, read up to the first opinion heading). The naming
   records `reporter_block`. A labelled line ("Disposition: …") ends the block.
5. **Footnote calls.** `widePageMarksOf` adds a standalone `n7` / `n. 7`, a bracketed `[n7]` and superscript digits to 0.4.0's
   loose set. A quotation that matches only with one read out answers `UNPARSEABLE`, naming the token, never FAIL.
6. **Words.** The claim name is "Quotation found as quoted in the supplied text" (0.4.0 and earlier keep "Citation quoted
   accurately"). A miss under the caption window also names the Lexis "Reporter" line (`LEGAL_REMEDIES_V050_UNBOUND`).

**What it costs.** On half B of the second blind set, 0.5.0 gives the same outcome as 0.4.0 on 20 of 20 items; on both halves,
40 of 40; on the first set (each text given a caption line), 58 of 58; 0 known-bad passed on either. Post-hoc, with no note
hashed before the run. The section reader was shaped with both sets' texts in view, and one change followed an outcome (an
"OPINION ____" heading in CT19), so neither set is held-out for it. Across the three cold readers' briefs (AI agents; 186 citations),
34 outcomes move, each one of the classes above. The rows are in `docs/LEGAL.md`; they are not a bench table.

**Replay (outside the hashed verdict).** A replay of a legal verdict under an older rule, whose inputs today's default reads
differently, prints "under today's default legal@0.5.2 this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not
PASS" under its headline and carries `rule_now` in its JSON. `verify replay --require-ruleset 'legal@>=0.4.0'` (any ruleset id)
fails, with exit 1, a verdict under an older version.

### Compiled rulesets: `verify compile-ruleset` (2026-10-03)

A ruleset no longer has to be translated by hand from its standard. `verify compile-ruleset <file.sch> … --structure <tsv | xml>
--out <ruleset.json>` reads schematron files and writes a declarative ruleset skeleton plus a compile report: every assert is
an arithmetic, presence or membership check quoting its text and citing `source: {file, sha256, line, pattern_id,
rule_context, assert_id, flag}`, or an uncompiled entry with its reason. Nothing is dropped. The full description, the
readings the compiler applies and its limits are in [COMPILER.md](docs/COMPILER.md).

**Recompiled Peppol, against the hand rulesets.** Compiled from the same pinned CEN and Peppol schematrons R4 quoted, then
compared check by check (`--against`): against 0.2.0, 8 of 11 checks are reproduced (same assert, operands, operator,
tolerance and readings) and 3 differ, each explained (R120's tolerance and precision, R051's one value for every amount,
BR-CO-14's positional rows); against 0.3.0, 10 of 12 are reproduced, R051 differs, and `R120_SUM` has no schematron
counterpart (a hand addition, stricter than the standard). Scoped to one extractor's fields, the compiled ruleset gives the
same gate decision as the hand-written 0.2.0 on all 60 documents of the e-invoice PDF test.

**The currency count (T2b, 2026-10-03; compiler 0.1.1; added post hoc).** BR-CO-15's conjunct
`count(cac:TaxTotal/cbc:TaxAmount[@currencyID = BT-5]) eq 1` now compiles. It becomes `BT_110_CURRENCYID = BT_5`
(`BR-CO-15:c1.1`), plus `BT_111_CURRENCYID != BT_5` when BT-111 is reported (`BR-CO-15:c1.2`). It was added after a corpus
run had shown the gap, so the re-run in [COMPILER.md](docs/COMPILER.md) is a regression check on a known corpus, not a test. No new
key is needed, because both checks are identifier checks with `applies_if`. Every check 0.1.0 compiled keeps its code and form,
and the recompile comparison above is unchanged: 0 unexplained against 0.2.0 and 0.3.0.

**New keys** (any engine; a ruleset without them keeps its bytes, and both goldens pass unchanged):

| key | where | behaviour |
|---|---|---|
| `compare: "member"`, `in: [codes]` | a check | `left` names one identifier or string field. `=` holds iff every value is one of the codes; `!=` iff none is. Compared as a schematron code list compares: NFKC, format characters removed, whitespace collapsed and trimmed, a value with an inner space never matches, case kept. Absent abstains (`FIELD_MISSING`), unreadable abstains (`UNPARSEABLE`). `right` documents the list. The claim is a CONSISTENCY claim |
| `{ "field": F, "present": true }` | `applies_if` | the check applies only when F is reported; absent (or only defaulted) → not applicable, listed under `not_applicable`; unreadable → applicability unknown, the check abstains |
| `{ "any_present": [F, G, …] }` | `applies_if` | the check applies when at least one of them is reported (a rule over an optional group applies only when the group is there) |
| `alternatives` | an identifier check | forms of two identifier fields, chosen by what is present, never by outcome: "A or B must be present" is `A = A` with the form `B = B` |
| `narrowing`, `source`, `compiled_from`, `hand_edited` | a check | documentation a compiled check carries (never evaluated, hashed with the ruleset) |
| `term_key`, `hand_edited` | a field | documentation (the business term a compiled field stands for; a hand edit after compiling) |
| `compiled_from` | the ruleset | the compiler, its version, every input with its sha256, the counts, the report's sha256, `hand_edits` |

`verify compile-ruleset --diff <compiled> <edited> --out <file>` marks every check or field a person changed after compiling
`hand_edited: true` and lists the edits, removals included, in `compiled_from.hand_edits`.

### Remedies next to the rules (2026-10-02)

A rule declares what lawfully answers it when it does not PASS (`docs/REMEDIES.md`). A built-in ruleset declares a table
next to its laws (`remedyByCode` on the `Ruleset`; the invoice, pay-app, AP three-way and legal tables). A declarative check
declares a `remedy`:

```json
{ "code": "CAP", "left": "TOTAL", "op": "<=", "right": "LIMIT",
  "remedy": {
    "fail":    [{ "kind": "authority", "authority": "budget-owner", "detail": "Over the limit by {variance}." }],
    "abstain": [{ "kind": "missing-operand", "operand": { "source": "po", "role": "LIMIT", "path": "limit" },
                  "when": ["FIELD_MISSING"], "detail": "The PO limit." }] } }
```

A bare remedy, or a list of them, is read as the FAIL remedies. `detail` and `operand.path` may name the claim's facts in
braces: `{asserted}` `{expected}` `{variance}` `{field}` `{line}` `{claim}` `{rule}` `{missing}` `{reason}` and `{op:ROLE}`.
Lint checks every remedy: a known kind, a detail, an operand where the kind needs one, a REGISTERED transform name, a role for
an authority, and `when` only on ABSTAIN remedies. A remedy is not part of the ruleset's input identity
(`rulesetIdentity`), so declaring or editing one never moves a verdict_id; a ruleset that declares none keeps its bytes. A
check that declares none still answers: its can't-tell implies a remedy (the missing field, a re-read, a unit to declare),
and its FAIL says `none` (the finding stands).

### Candidates, in the order the demand data ranks them (2026-09-22)

invoice ✔ · pay-app ✔ · paystub / bank-statement running balance (fraud pre-screen) · freight bill vs rate agreement · financial-statement footing · legal cite-check (needs the source-text axis).
