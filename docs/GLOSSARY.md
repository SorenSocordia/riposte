# Glossary

Plain definitions of the terms these docs use. Each entry names the page that defines it in full.

## Answers

**PASS / FAIL / can't tell.** The three answers. PASS: every check that ran held. FAIL: a check found a figure or a
quotation that does not agree. Can't tell: a check could not run, so a person decides. These pages say "can't tell". What
the commands print, on screen and in a verdict's JSON alike, is `INSUFFICIENT_DATA`. One state, one printed name:

| state | on screen | in the JSON |
|---|---|---|
| PASS | `PASS` | `PASS` |
| PASS-WITH-OPEN (below) | `PASS-WITH-OPEN` | `PASS_WITH_OPEN` |
| FAIL | `FAIL` | `FAIL` |
| can't tell | `INSUFFICIENT_DATA` | `INSUFFICIENT_DATA` |

**ABSTAIN.** The older word for can't tell; still read, no longer printed by the commands these pages show (`ap`,
`check`, `citations`, `twin-einvoice`, `replay`), the agent-checking tools in `packages/receipts` (`check_done`,
`check_claims`, `model_attest`, the Stop hook and the action gate), the filing comparison (`verify twin`), a book of
record's notices and ledger report, the three evaluation-framework scorers (Langfuse, Braintrust and Inspect) or the GitHub
Action. Anything written before 2026-10-06 that says ABSTAIN reads as INSUFFICIENT_DATA, and the GitHub Action still
accepts `fail-on: abstain`. A few outputs still print it: the description of the MCP invoice-match tool, the descriptions
of the autonomy levels, the e-invoice comparison's judgments over HTTP and MCP (the command line prints INSUFFICIENT_DATA),
and one note about the filing comparison's 0.2.1 rules. The AP decision value `abstain` is a different thing; see "Approve,
hold, a person decides".

**PASS-WITH-OPEN (gate status).** A PASS where some checks could not run, for example because a total was unreadable. It has
two spellings: `PASS-WITH-OPEN` in what a person reads (and from the library's `gateStatus()`), and `PASS_WITH_OPEN` in a
verdict's JSON, in the `gate_status` field that verdicts carry from engine 0.6.0. The recorded outcome stays PASS, so
verdicts issued earlier still replay byte for byte. Anything that acts on money must treat PASS-WITH-OPEN as not passed:
the AP gate never pays on it, and neither does the `ap` command, which prints A PERSON DECIDES and exits 2. `check` exits 2
on it too, and `--gate` names the open checks. `--allow-open` is the stated opt-out and says so on stderr:
`check --allow-open` exits 0 on a PASS-WITH-OPEN whose open checks each wait on a reference not given or a field the
document does not carry (an unreadable figure stays exit 2), and `ap --allow-open` exits 0 only on a bill sent to a person for one
reason, that no payment history was given. HTTP answers carry the same reading in their `x-verify-exit` header. Full rule:
[`VERDICT-SCHEMA-v0.md`](../packages/verify/docs/VERDICT-SCHEMA-v0.md), "The gate reading".

**Approve, hold, a person decides.** The AP decisions on a bill. Approve (exit 0) only when every check ran and held. A
hold (exit 1) means "do not pay yet", with the reason (quantity, price, line arithmetic, total, missing PO, duplicate) and
what would clear it. A person decides means the check could not decide the bill, for example because no payment history
was given. The AP command then prints A PERSON DECIDES and exits 2; in the JSON the decision is `abstain` and `payable` is
`false`. A PERSON DECIDES is a decision about a bill, not a verdict state: the verdict behind it reads PASS-WITH-OPEN or
can't tell, and a replay of an AP proof prints the decision first.
[The accounts-payable page](doors/accounts-payable.md).

**"Not checked" block.** What an AP approve did not establish for that bill, printed under "Not checked" and carried in the
JSON as `not_checked`: how the vendor was matched and that who sent the bill was not checked; on an emailed bill, exactly
what was read for payment redirection (every sentence, and the 25 phrasings listed in `AP-INPUT.md`; a standing remit-to
address named by its line; a wording the reading does not parse is not caught); per-line netting where it applies; a
partial bill's open lines; and what was read as tax. An emailed-text approve ends it by saying the bill was read from text.
It never asserts what it did not establish. A hold or a person's decision does not carry it.

**Remedy.** What would settle an answer that is not a PASS: a missing document, a re-read, a registered transformation, or
the person whose signed ruling may clear that one verdict. A remedy never changes a verdict.
[`REMEDIES.md`](../packages/verify/docs/REMEDIES.md).

**Authority ruling.** A person's signed allow or deny on one verdict, honoured only if that person's key is pinned for
their role, only for that verdict, and only once. It never waives a later check.

## Inputs

**Extraction.** The structured data (JSON) that a person, an ERP, an OCR tool or an AI model read off a document. It is
Riposte's input. Riposte does not read the page; it trusts the extraction and checks what can be checked from it. It reads
a document itself in two places only: the `ap` command reads the labelled lines of a forwarded invoice email given as
text, and an arbitration case reads the one disputed field from a document a party files
([the engineers' page](doors/engineers.md#what-the-engine-reads-itself)).

**Emailed-bill input, structured input.** The two inputs of the AP check. The emailed-bill input is text: the forwarded
email, followed by a block headed `PURCHASE ORDER (ERP)` and a block headed `GOODS RECEIPT (ERP)` pasted from your system,
or the three parts as separate files. The structured input is the bill, its PO and its item receipts as JSON, the shape an
ERP already holds ([`AP-INPUT.md`](../packages/verify/docs/AP-INPUT.md)). The shadow pilot builds structured input from
your export, so a pilot needs neither by hand. The structured input path is the product. The emailed-text path is a
convenience with a documented limit, and every approve names which path read the bill.

**Payment history.** The invoices already booked, given with a bill (`--history`, or `payment_history` in structured
input). Without it the duplicate check and the PO balance check do not run, and the bill goes to a person. `[]` says
nothing is booked yet.

**Price tolerance, tax rule, freight rule.** The buyer's choices an AP verdict is computed under. The price tolerance is
how far a unit price may run over the PO's before a hold, 2% unless set. The tax rule and the freight rule decide tax or
freight billed on a PO that says nothing about it: a person decides by default, or `allow`, or for tax a stated rate. Tax
is checked to the cent, never within the price tolerance. Each non-default choice is bound into the verdict's input hash,
so a replay re-performs it.

**Look-alike vendor.** A vendor name, vendor record or sender domain that is close to the PO's vendor without being it: a
one-letter typo, an abbreviation, initials, a trading name, a domain built from the vendor's name with something added.
It is never passed as the PO's vendor and never taken as proof of who sent a bill; on the duplicate check it counts as a
near match, so a repeated invoice number under it is held. The controller decides. A free-mail sender (Gmail, Outlook and
the like) goes to the controller the same way, unless that exact address is on file.

**Pay application (AIA G702/G703), retainage, change order.** A contractor's monthly request for payment on the AIA forms:
G703 lists each line of the schedule of values, G702 sums it. Retainage is the share held back until completion, at the
rate the application states. A change order changes a scheduled value or adds a line; a change without one goes to a
person. [The accounts-payable page](doors/accounts-payable.md).

**E-invoice, binding element, business rule.** An e-invoice is a structured XML invoice (Peppol BIS 3.0 / EN 16931, ZATCA,
KSeF). A binding element is the XML element a figure is legally carried in, named by its EN 16931 term (BT-115 is the
amount due). A business rule is a published consistency rule over those figures (BR-CO-10: the line net amounts add up to
their stated sum). [The e-invoice page](doors/e-invoice.md).

**Caption, majority opinion, editorial matter, verbatim.** Legal terms the quotation check uses. The caption is the case
name and reporter citation at the top of an opinion text; the check binds a text to its cite by it. The majority opinion
speaks for a majority of the judges who decided the case; editorial matter (a synopsis, headnotes, the syllabus) and
separate opinions (a concurrence, a dissent) do not, and words found only there answer can't tell; a match in a plurality
opinion says so. "Verbatim" is said only when the quoted words match exactly and begin and end where their sentence does.
A lead-in is the start of the sentence before a quotation that begins inside it; when it reports someone else's position
("Appellant argues that") or frames what follows ("we might hold that"), the answer is can't tell, naming the speaker.
[The legal page](doors/legal.md).

**Extraction contract.** An optional stricter input format: every value carries where it was read (page, line), the exact
string read, and which reader read it. [`EXTRACTION-CONTRACT.md`](../packages/verify/docs/EXTRACTION-CONTRACT.md).

**Source text.** The document's own text, given alongside an extraction, so a check can confirm that a quoted passage or
a value really appears in it. Some checks use it only when you ask for them.

**Three-way match.** Checking a supplier invoice against its purchase order (what was ordered, at what price) and its
goods receipt (what arrived).

## Proofs

**Verdict.** The JSON answer: the outcome, one claim per check with the values it used and where each came from, and the
hashes and versions that identify it.

**Bundle.** A file holding a verdict together with its inputs, `{ "verdict": …, "inputs": … }`. A bundle replays with no
extra flags. A verdict on its own replays when you supply the inputs it names.

**Envelope.** A verdict wrapped with an Ed25519 signature and the signer's public key. The envelope carries its own key,
so a valid signature only says that key signed. Pin the issuer's key out of band before relying on it.

**Key fingerprint.** sha256 over a public key's DER bytes, 64 hex characters: the value `riposte-ledger fingerprint` and
`replay` print, and `--trusted-key` pins. A prefix is never accepted. The older form (sha256 of the key's base64 text) is
still accepted by `--trusted-key` in this build, with a note.

**Input hash.** A sha256 over the canonical JSON of the inputs a verdict was computed from: the extraction, the ruleset's
identity and, when used, the source text and references. A rounding override is not part of it. It is not the hash of a
file, so `sha256sum` on a file will not reproduce it. The exact rules are in
[`REPLAY.md`](../packages/verify/docs/REPLAY.md).

**Verdict id.** A 128-bit id (32 hex characters): the first half of a sha256 over the input hash, the ruleset and its
version, the engine version and, from engine 0.2.0, the hash of the remedy table. The same inputs under the same versions
always give the same id.

**Replay.** Re-running a verdict's check from its recorded inputs, on your own machine, with the open-source engine and
no model, then comparing the canonical JSON of the result with the verdict's, byte for byte. `VERIFIED` or `MATCH` means
identical, and the VERIFIED line names the ruleset version that decided the outcome; a verdict under an older rule or
engine (legal, e-invoice, invoice, pay application) also gets a line saying how today's default rule reads the same inputs
when that differs (`rule_now`), and `--require-ruleset` fails a verdict under a rule older than the relying party accepts,
printing that failure first. `FAILED` or `DIVERGED` means different, and names the field. A verdict whose remedies were deleted is refused
the same way. "Structure verified, outcome NOT re-performed" means no inputs were given, so only the id and shape were
checked. A replay proves the verdict is exactly what the engine produces from those inputs. It does not prove the
extraction matches the document. The fields a replay does not compare are listed in
[`REPLAY.md`](../packages/verify/docs/REPLAY.md).

**Receipt ledger.** An append-only file of receipts (JSON lines), each one hashing the one before it, optionally signed.
The chain catches an edit, a deletion or a reordering inside the file, and a pinned issuer key also catches a forged or
re-hashed entry. Neither catches a clean cut at the end of the file, and a key does not catch a rewrite by whoever holds it.
`riposte-ledger verify` reads the head record kept beside the ledger (`<ledger>.head.json`) and refuses a file shorter than
it says, and a ledger whose record is missing (`--no-sidecar` verifies without it and says so), but whoever can rewrite
the file can rewrite that record too. A head hash recorded somewhere you control, checked with `--head`, catches a cut or a
rewrite by anyone. Its JSON answer keeps the three checks apart: `chain_ok` for the hash chain alone, `signatures_ok` for
the signatures and the pinned key, `anchor_ok` for `--head`.

**Frag.** One signed, append-only, publishable artefact under `frags/`: a lock (the pin table over the tree, by the preregistration's
rule), a claim (a bench table's rows, one verdict, or a closed engine label), its proof, provenance, a `frag_id` (sha256 over lock, claim
and proof, so it includes the claim; the name and the provenance sit outside it), an Ed25519 signature, and its entry in the record
`frags/frags.jsonl`, a receipts ledger. `frag open` re-performs it; the site renders each from its file alone. A frag is never edited: a
correction is a new frag that names the old one. [The frags door](doors/frags.md).

## Versions

**Check budget.** The HTTP server's limit on one request's work: each check runs in a worker thread with a time and a memory
limit (60 s and 512 MiB by default, two at once). A check past it is answered 413 with can't tell's exit code and the words
"input too large to check within the service's budget", never a verdict, and the server stays up.
[The engineers' page](doors/engineers.md).

**Engine version vs ruleset version.** The engine is the code that evaluates (for example `0.5.0`). A ruleset is the set
of rules for one kind of document (for example `peppol-en16931@0.3.0`), versioned on its own. Every verdict names both,
and its id depends on both. The current build keeps the behaviour of every earlier engine version, so an old verdict
replays under the rules of the engine version that made it. Today's code applies each version's rules; no old build is
kept or run. This is why several version numbers appear side by side. The engine history is in
[`CHANGELOG.md`](../packages/verify/CHANGELOG.md).

**Closed, open.** A closed engine label is one whose computation no longer changes: a later version has been opened above
it, and any change gets a new version number. Engines 0.0.1 to 0.7.0 are closed; 0.7.1, the one this tree builds, is open,
so a verdict issued under it can still change on a later 0.7.1 build. A verdict issued under a closed label replays byte
for byte under the engine that issued it (the 0.0.1 exceptions are listed in the [changelog](../packages/verify/CHANGELOG.md)).

**Released.** A tagged, signed, published artifact of a closed label. No version is released yet: none is on npm or carries
a signed tag. Both words are defined at the top of the [changelog](../packages/verify/CHANGELOG.md).

**Declared accuracy.** The error rates a ruleset version publishes about itself, with the run they came from.

## Evidence

**Evidence ladder (E0 to E4).** How strongly a value is evidenced. E0: a signed statement from a system of record enrolled
for the case. E1: a machine-native structured file, such as an e-invoice's UBL XML. E2: a PDF's own text layer. E3: OCR of
a scan or an image. E4: a person's assertion, which is never enough on its own. A tier is never raised because someone
says so. [`EVIDENCE.md`](../packages/verify/docs/EVIDENCE.md), section 2.

**Struck field.** A field the document carries but nobody could read. The checks that need it say can't tell, every other
check still runs, and the verdict lists what it held back.

**Arbitration.** How an open verdict or a disputed FAIL gets settled by evidence. The parties listed in a signed parties
file submit signed moves (for example, a document that corrects a field). The engine reads any document itself and
recomputes. Nobody's say-so changes a figure. [`EVIDENCE.md`](../packages/verify/docs/EVIDENCE.md), section 4.

**Choice ledger.** A list on a verdict of the choices a computed number depends on that the data does not fix: a
tolerance, a weighting, an algorithm, a units convention. Each is marked stated by the document, supplied (and by whom),
or unstated. A check that depends on an unstated choice says can't tell.
[`CHOICES.md`](../packages/verify/docs/CHOICES.md).

**Autonomy level.** How much a workflow may do on its own. `record`: findings are only recorded. `advise`: findings are
shown and the action runs. `gate`: every action waits for a person, and failures are held. `autonomy`: passing actions run,
and failures or can't tell answers are held for a person. The level is always the one a person granted. Riposte may
propose a change with the evidence, but never makes it.

## Measurement

**Preregistration.** A document written before a run that says what will be measured, how, and what result counts as a
pass. The bench tool prints a table only if the preregistration's sha256 was recorded; it checks that the record exists,
not when it was made. Later changes are recorded as amendments. A hash proves the text, not the time. A third-party
timestamp made before the run would prove the time, and none here has one yet: the stamps in the tree were made on
2026-10-05, each after its run, so for every run so far the order of events is recorded by the authors. Each table's Stamp
line says which case applies. The rule from 2026-10-05 is that every preregistration is stamped before its run, and the
bench page lists where the tree does not meet it: one run broke it (table `legal-blind-2-030`, stamped after its run), one
ran that day before the first stamp existed (table `legal-blind-2`), and the tables that record misses only have a scope
note in place of a preregistration, which reads NEEDS STAMP until it is stamped. `bench check` exits 4 while any table
reads NEEDS STAMP. Frozen preregistrations ship byte for byte so their hashes can be checked, which means they
keep the working shorthand of when they were written.

**Blind, post-hoc, demo, regression, transcribed.** The labels on a bench table. Blind: data the builders had not seen.
Post-hoc: scored on data already seen. Demo: a constructed demonstration. Regression: a re-run showing nothing moved.
Transcribed: typed from a report that left no machine-readable results.
[`BENCH.md`](../packages/verify/docs/BENCH.md).

**Re-tally, rerun.** `bench check` re-tallies every bench table: it counts the table again from the per-case results that
ship beside it and checks that the same bytes come out. That shows a table is a faithful count of its results, not that
the results were produced as stated. A rerun goes further: it runs the harness on the data again and produces the results
themselves. The AP headline run, its audit and the stress rows rerun from `bench/ap`; the
[methods page](doors/methods.md) says which bench tables also rerun from this tree.

**Hashed, not shipped.** A file a bench table's hash list or preregistration names that this repository cannot ship (a
harness that names private paths, a public data set not redistributed here, an engine build, a per-case file too large).
The table lists it with its sha256 and the reason, so a reader holding the file can check it.

**Stamp.** A timestamp authority's signed reply over a file's sha256 (RFC 3161), written beside the file as `.tsr`. It
shows the text existed by the stamp's time. Every stamp in this tree was made after its run. `bench check` reads NEEDS
STAMP for a scope note, or a run made after stamping began, that has no stamp yet. [`_tsa/README.md`](../packages/verify/docs/bench/_tsa/README.md)
says how to verify one with OpenSSL.

**Cold review, cold reader.** A round in which cold readers, AI agents that had not worked on this tree, are given a
buyer's or a reviewer's role and read the public pack. They are not people and not independent of the maintainers, who
dispatch them. Each defect they find becomes a dated row in the misses ledger.

**Hold precision, miss rate.** The shadow pilot's two registered numbers. Hold precision: of the bills the gate would have
held, the share a person confirms is a real problem. Miss rate: of the bills it would have paid automatically, the share a
person finds bad. Each is measured on its own audit sample, labelled by a person after the run.

**Coverage.** The share of cases decided without a person. It is always published next to accuracy, because a checker can
be "never wrong" by deciding nothing.

**Interval.** The range a true rate plausibly lies in, given the count, at 95% unless stated. Zero errors in 82 cases does
not mean an error rate of zero: the 95% Wilson interval runs from 0 to 4.5%. The bench tables use the Wilson interval; the
shadow pilot's report uses the exact (Clopper-Pearson) interval, which is a little wider.

**Misses ledger.** [`MISSES.md`](../packages/verify/docs/MISSES.md): every miss from every bench run, dated. That
includes wrong answers, defects an audit found, predictions that failed, and errors in the test set's own labels. It is
generated and append-only. Append-only means that regenerating it from the bench folders refuses to drop or change a row,
and the only change it accepts to a row is a note of what fixed it. Someone who can edit the tree can still remove a row by
editing a table's folder, the table and the ledger together. Nothing outside the authors' control, such as public CI or a signed
release, anchors it yet. The receipt ledger above has the same kind of limit.

**Refused run, withdrawn table.** A refused run is one the bench tool will not print as a result, for example because its
preregistration has no recorded hash. A withdrawn table was printed once, but the files it rests on cannot ship in this
repository, so it is no longer printed. Both are listed in [`BENCH.md`](../packages/verify/docs/BENCH.md), "Runs the
tool refused, and tables withdrawn".

**Outside the rule.** A number these pages publish that is not a bench table, such as the SEC studies or the AP headline.
It carries no verdict from the bench tool. Every such number is listed in [`BENCH.md`](../packages/verify/docs/BENCH.md),
"Outside the rule" and "Rows outside the bench rule", with where it is published and why it is not a table.

**Shadow pilot.** Running one closed month of real bills, and any pay applications, through the checks with nothing
executed: no money moves, and
nothing is held or sent. Each bill gets a signed receipt of what the gate would have done, and a report compares that with
what your team actually did.
[`PILOT.md`](../packages/receipts/PILOT.md).
