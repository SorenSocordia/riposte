# Evidence: struck fields, the evidence ladder, the scope line, and the Salle (engine 0.3.0)

Engine 0.3.0 (2026-10-03) builds one rule into the verdict: an unreadable field is not an automatic FAIL. It is a flag and a
report with evidence. The field is left out of the calculations, the verdict says exactly what it holds back, and the field is
settled by evidence, never by a typed number. This page describes the four parts:

1. strike and recompute;
2. the evidence ladder;
3. the scope line;
4. the arbitration protocol, which in the product is the Salle.

Each verdict names the engine that made it. A verdict that names 0.0.1, 0.1.0 or 0.2.0 is re-performed exactly as that engine
read it, so none of this changes a verdict issued before 0.3.0. Engine 0.4.0 (2026-10-04) adds archive provenance to the ladder
(section 2, "Archive provenance") and changes nothing else here. Engine 0.5.0 (2026-10-04) adds a value's own quality flag as a
second axis (section 2, "Per-value quality flags"), lets the engine hash binary archive files, and puts the free choices a number
depends on on the verdict ([CHOICES.md](CHOICES.md), [RULESETS.md](RULESETS.md) "Engine 0.5.0").

## 1. Strike and recompute

A field the document carries but nobody could read is STRUCK. The checks that need it abstain, and every other check computes.
A field is unreadable when it was reported as null, blank or `"UNREADABLE"`, when its string does not read as a number, when its
label is printed with no value next to it, or when it was reported under a near-miss key. An ABSENT field is not struck: the
document does not carry it, and an optional total still takes its `default`. A 0.3.0 declarative verdict adds these blocks:

| block | what it says |
|---|---|
| `computed` | `{ pass: [claim ids], fail: [claim ids] }`: the checks that ran, by outcome |
| `struck` | one entry per struck field that some check waits on: `field` (with its line or list element), `role`, `path`, `reason`, `provenance` (the value as reported, the printed line, and an envelope's page, line, reader, readings and tier), `detail`, and `candidates` when the reason is `suspect` |
| `would_unlock` | for each struck field, the claims waiting on it: exactly which evidence ends the hold |
| `counts` | checks computed, passed, failed and struck; fields struck, by reason; findings |
| `evidence_floor` | the tier the computed checks rest on (section 2) |
| `findings` | only when present: tier conflicts, and tier claims the engine capped |
| `support` | only with an evidence overlay: per field, the value used, its tier, `supported_at`, and every source with whether it agrees |

The `reason` of a struck field is one of these:

- `unreadable`: seen, not read;
- `suspect`: unreadable, and a reading one step away makes a check FAIL;
- `withdrawn`: a STRIKE removed it;
- `unsupported-assertion`: an envelope value with no provenance;
- `conflict`: two sources at one tier disagree.

**Suspect is a flag, never a FAIL.** Take a value whose string does not read, such as `"4O0.00"`. The engine evaluates every
reading of it one character away. In an envelope, it evaluates what each reader actually read. If one of those readings fails a
check, the field is struck as `suspect`. The verdict lists the failing candidates (`{ checked, failing, passing, shown }`) and
counts the field under `counts.suspect`. Nothing is booked as a FAIL. A suspect field shortens a case's clock (section 4). A
ruleset that says `"held_suspect": false` keeps the strike and drops the flag.

**The gate.** A verdict whose outcome is not FAIL, and which has a struck field some check waits on, is **OPEN**: not PASS and
not FAIL (`gateStatusOpen`, `gateLabel`). `verify --gate` names each struck field and the checks it would unlock, and exits 2.
A computed FAIL elsewhere in the verdict stays a FAIL, because a struck field never rescues a check that ran and failed.

`gateStatus` keeps its four values, because deployed gates compile against them. There an OPEN verdict reads PASS-WITH-OPEN, or
INSUFFICIENT_DATA when no check ran. Both hold the action; neither is PASS or FAIL.

Engine 0.2.0's HELD-SUSPECT, which booked a suspect claim as a FAIL, is retired. A 0.2.0 verdict still carries its claim-level
`suspect` and still reads HELD-SUSPECT, because replay re-performs it under 0.2.0. No 0.3.0 verdict does either.

**The remedy for a struck field** is evidence. It says so in words: a CORRECT carrying the page or document that prints the
value, which the engine reads itself, or a CORROBORATE from an independent source.

## 2. The evidence ladder

| tier | what the value rests on | how it arises in this build |
|---|---|---|
| **E0** | a system of record, through an authenticated channel | a statement (`verify-source-statement/1`) signed by a source key enrolled in a case's parties file. The engine verifies the signature and reads the value itself. Nobody can claim E0 by saying so. |
| **E1** | a structured document whose fields are machine-native | a UBL XML the engine reads through the e-invoice map, by the field's published term (BT-115 …); from engine 0.4.0 also a value with archive provenance (a file an archive serves, read by its declared format; see "Archive provenance" below) |
| **E2** | a PDF's own text layer | the extraction contract's reference extractor on a born-digital page (text layer, confirmed by OCR) |
| **E3** | OCR of a scan or an image | the reference extractor on a scan (two OCR settings) |
| **E4** | a human's assertion | never evidence on its own, and never load-bearing |

Two more words appear where a tier would. **`unstated`** marks a value that carries no provenance at all. A plain extraction,
the input verify has always taken, is unstated: it is checked as given, and the verdict says so. **`none`** is the floor of a
verdict that computed nothing.

Rules:

- **A tier is never raised by a party's say-so.** An envelope's provenance may state `tier` E1, E2 or E3. The engine also infers
  a tier from the reader names: a structured reader is E1, a text layer read first is E2, anything else read off a page is E3. It
  uses the worse of the two. When the stated tier was better, the verdict records a `tier-claim-capped` finding. A stated E0 is
  treated the same way, because E0 is the engine's own.
- **E4 is never load-bearing.** An envelope field with no provenance, or provenance that says it was supplied, is struck as an
  `unsupported-assertion`. The checks that need it wait.
- **The floor.** `evidence_floor` is the worst effective tier among the field values the computed checks rest on. A value's
  effective tier is the better of its own tier and its `supported_at`. Defaulted and computed values are not filed values, and
  they do not count.
- **Corroboration raises support, not tier.** A value keeps its tier. `supported_at` is the best tier among independent sources
  that agree with it within the field's tolerance: the smallest `tol` of the checks that read the field, default 0.01.
- **Conflicts.** When sources disagree on a field, the higher tier computes and the conflict is a finding. When two different
  values sit at one tier and nothing higher ranks them, the field is struck with reason `conflict`.
- **A plain extraction is `unstated`, not E4.** Read strictly, "a field without provenance is E4" would strike every check of
  every plain extraction. A ruleset that wants that strictness already has it: `"require_contract": true` refuses anything but a
  provenance-carrying envelope.

The reference extractor writes `tier` into every provenance it produces: E2 for a born-digital page, E3 for a scan or a mixed
route. `verify extract-schema` lists `tier` as an optional provenance property.

### Archive provenance (engine 0.4.0, 2026-10-04)

A value can come from a file an archive serves: a published table, a survey release, a data product. Its provenance says
where the file was served, when it was retrieved, what the bytes were, and how they were read:

```json
{ "kind": "archive", "url": "https://astroweb.case.edu/SPARC/Rotmod_LTG.zip", "member": "NGC3198_rotmod.dat",
  "container_sha256": "0a80cc90…f588", "retrieved_at": "2026-10-04T02:59:41.099Z", "sha256": "17b774ad…f953",
  "archive_checksum": { "algorithm": "md5", "value": "…", "published_at": "…" },
  "reader": "sparc-rotmod (tab-separated; header lines 1-3)", "raw": "152.00", "locator": "line 25, column 2 (Vobs)" }
```

**Its tier is E1, not E0.** The file is machine-native, and the engine reads it by its declared format (or by a narrowing the
reader states). That is what E1 means. It is not E0. E0 is a statement signed by a source key enrolled in a case's parties
file, and no archive signs anything with such a key. A checksum published over TLS (MAST's per-file md5, a release's MD5SUM
list, Zenodo's per-file md5) says which bytes the archive serves. It does not say who stands behind them in the way an
enrolled signature does. No new tier letter is used.

**`checksum_verified` is a fact the engine establishes, never a field it reads.** The verdict lists each archive file once,
under `archives`, with two booleans:

| flag | true when |
|---|---|
| `content_verified` | the engine hashed the bytes it was given (the source text, `--source`, which the input hash binds) and they are the file the provenance names (same sha256) |
| `checksum_verified` | `content_verified`, and the archive publishes a checksum for the file, and the same bytes match it |

So E1 with `checksum_verified: true` is better than a bare E1: the bytes checked are the bytes the archive says it serves, and a
re-fetch from the archive can confirm the match. E1 with `checksum_verified: false` says why in `detail`: the engine did not
see the bytes, the source text is another file, or the archive publishes no checksum at all (SPARC publishes none). The flag
never changes a tier, a claim or the floor.

- **Malformed archive provenance** (no url, no retrieval time, no 64-hex sha256, no reader) is an assertion: E4, struck as
  `unsupported-assertion`, with the missing parts named.
- **A stated tier** is read as for page provenance: E2 or E3 stands (it is worse than E1); a stated E0 is capped at E1 and the
  cap is a `tier-claim-capped` finding.
- **Under an earlier engine** archive provenance is read as page provenance always was: the tier is inferred from the reader
  name. A verdict that names 0.3.0 or earlier keeps its bytes.
- **What replay means for an archive table.** A DOI names a paper, not bytes, and an archive can serve new bytes under an old
  name after reprocessing. A verdict is re-performed from the bytes pinned by sha256 (carried in the bundle as the source text),
  the ruleset bytes and the engine version. Re-fetching from the archive and comparing the sha256 is a separate step. A mismatch
  there means the archive moved, not that the verdict is wrong.
- **Binary files** (FITS, compressed releases) do not travel as source text. Under engine 0.4.0 the engine cannot hash them, and
  `checksum_verified` stays false. From engine 0.5.0 they travel as bytes: `archive_files: [{ name?, base64 }]` (CLI
  `--archive-file <path>`, repeatable), bound into the verdict's inputs. The engine hashes every byte string it is given (the
  source text and each file) and says which one is the file (`matched`, e.g. `archive_files[0] (jw…_cal.fits)`). A JWST product
  whose MAST record publishes an md5 (`checksum`) reaches `checksum_verified: true`; one changed byte gives false on both flags.
  Bytes in the inputs make a bundle as large as its files, so a very large file needs a content store (open).

### Per-value quality flags (engine 0.5.0, 2026-10-04)

Some archives grade each measured value (Argo's flags 0-9). That grade is about the MEASUREMENT; a tier is about the READING. They
are two axes, and a flag never changes a tier: an Argo value read from its netCDF is E1 whatever its flag.

- **Provenance** (page or archive) may carry `qc: { scheme, flag, meaning? }`. The scheme says what the flag means, quoted from its
  source: the first is Argo's Reference table 2 (`src/schemes/argo-qc.json`; the Argo user's manual v3.44.0, DOI 10.13155/29825,
  every flag's meaning and both comments verbatim). The provenance's own `meaning` is the extractor's note and is not used.
- **The ruleset's flags choice decides**, never a code path: a `flags` slot whose value is a policy
  `{ scheme, compute: [...], hold: [...], strike: [...], absent: [...] }`.

| policy | what the engine does with the value | in the verdict |
|---|---|---|
| compute | it computes | counted `computed` |
| hold | struck, reason `qc_held`; a check that reads it, or an aggregate over it, waits: the gate reads OPEN | `struck`, `qc.values` |
| strike | struck, reason `qc_struck`; left out of every aggregate and algorithm series (the rest compute); a direct read abstains | `qc.values` (and `struck` when a check reads it directly) |
| absent | a missing value (Argo's flag 9: "Missing value. Data parameter will record FillValue."), left out of aggregates | `qc.values` |
| not placed | held | `qc.values` |
| not a flag the scheme defines | struck | `qc.values` |

- **Honouring and ignoring are both stated.** A policy that computes every flag is how a ruleset ignores them, on the ledger. A value
  whose scheme no flags slot governs is computed as given and counted `not_read`.
- **The remedy** for a held or struck value is the archive's: a file in which the archive serves the value with a flag the policy
  computes (a later quality state, such as delayed-mode QC), or a restated flags choice. Never a typed value.
- The verdict's `qc` block states the slot, the counts (read, computed, held, struck, absent, not_read) and every held, struck or
  absent value with its flag and the scheme's meaning.

## 3. The scope line

Every 0.3.0 verdict, from every engine, ends with `scope`. The block is generated from the verdict and never typed:

```json
"scope": { "ruleset": "peppol-en16931@0.2.0", "engine_version": "0.3.0", "evidence_floor": "unstated",
           "statements": ["advisories are counsel, not verdicts", "this is a check, not a decision"] }
```

Built-in engines state the floor as `unstated`. Replay re-derives the block like any other engine output. The human-readable
reports end with the same three lines: the gate message of `verify --gate`, the answer from `verify replay`, `verify notice`,
and `verify case`.

```
Scope: checked against peppol-en16931@0.2.0 by engine 0.3.0; evidence floor unstated (the values carry no provenance: the extraction is checked as given).
Advisories are counsel, not verdicts.
This is a check, not a decision.
```

## 4. The Salle: arbitration, the thin cut

An open verdict resolves by evidence, never by assertion. Parties file documents, and only the engine reads them.

**The parties file** (`verify-parties/1`) lists who may move: `{ id, role: filer | counterparty | operator, public_key, held? }`.
It lists the systems of record whose statements are E0: `{ id, tier: "E0", public_key }`. It may set the case clock in working
days (`ordinary_days`, default 5; `suspect_days`, default 2). It may also say where the readers live (`readers`: the Tesseract
and pdftoppm paths, and the OCR settings).

**A move** (`verify-move/1`) is a signed document. The fields are `format`, `case`, `type`, `by` (the signer's key fingerprint),
`at`, `nonce`, `expires_at`, `field?`, `target?`, `evidence?`, `reason`, `countersign?` and `sig`. The signature is Ed25519
over a domain prefix and the canonical JSON of the move without its signatures. The move id is the sha256 of that content.

A move is checked in this order:

1. its shape;
2. a signer enrolled in the parties file, looked up by fingerprint (the public key is never taken from the move);
3. a signer that is not held;
4. the signature;
5. a nonce never used before in the case;
6. the time window, `at` to `expires_at`;
7. the role.

| move | who may make it | what it carries | what the engine does |
|---|---|---|---|
| **CORRECT** | the counterparty, or the filer with the counterparty's countersign | a document: a PDF (E2 or E3) or a UBL XML (E1) | reads the field from the document itself, then recomputes |
| **STRIKE** | the filer or the operator | a target: `{ document: "filing" }`, a document filed earlier, or `{ field }`, with a reason | withdraws the target and recomputes; a withdrawn load-bearing field books UNSUPPORTED |
| **CORROBORATE** | any enrolled party | a signed source statement (E0, read at `evidence.locator`) or an independent document | checks independence, reads the value, recomputes |

**What nobody can do.** No party can assert a value. A move that carries `value` is refused (`e4-value`), and so are a move with
no document and a JSON of values or an extraction envelope (`not-a-document`). Each refusal is recorded by the sha256 of the
move's bytes, and its content is never copied. No corroboration can come from the filing's own document, or from a source
already supporting the field (`not-independent`): independence is by source, never two readings of one artifact.

**A case** opens on a verdict that reads OPEN, or on a FAIL claim a party disputes (`--dispute`). The verdict must first
re-perform on its inputs. Nobody has to ask for the first kind: `verify <doc> --ruleset … --case-dir <dir> --parties
<parties.json>` opens the case as soon as the verdict reads OPEN. The case lives in one directory:

- `case.json`: the record;
- `parties.json`;
- `filing/`: the inputs, the verdict, and the filed document when one is given;
- `evidence/`: each document by its sha256;
- `moves/`: the accepted moves;
- `verdicts/`: every re-verdict as a replay bundle;
- `ledger.jsonl`: hash-chained rows (`case.open`, `move.accepted`, `move.refused`, `verdict`, `case.resolve`, `case.reopen`).

Each accepted move re-evaluates the filing with the accumulated **evidence overlay**. The overlay holds, per field path, what the
engine read from each document or statement, and what a STRIKE withdrew. It is part of the re-verdict's inputs, so the input
hash binds it, and the re-verdict replays from `{ extraction, ruleset, source?, evidence }`. The re-verdict carries a `case`
annotation (`case_id`, `prior_verdict_id`, `move_id`) outside the compared body, and the ledger's `verdict` row records the
gate, counts and floor before and after.

**Resolution.** A case resolves in one of these ways:

- **After a move.** A STRIKE that leaves a load-bearing field withdrawn resolves the case UNSUPPORTED. Otherwise the re-verdict's
  reading decides: OPEN stays open, and any other reading (PASS, PASS-WITH-OPEN, FAIL, INSUFFICIENT_DATA) resolves the case to it.
- **On the clock.** The clock runs in working days, Monday to Friday, UTC, from the parties file: 5 days by default, or 2 when a
  struck field is suspect. Expiry resolves UNSUPPORTED while a load-bearing field is still struck. A disputed FAIL that still
  fails resolves FAIL. The clock never resolves a case PASS.
- **Reopening.** A resolved case takes only a CORROBORATE whose tier is strictly better than the tier it closed on, and that
  reopens it. UNSUPPORTED closes on E4.

**The CLI.**

```
verify case open --dir <case-dir> --verdict <verdict.json> --inputs <inputs.json> --parties <parties.json> [--document <file>] [--dispute <claim_id>] [--now <iso>]
verify case move --dir <case-dir> --move <move.json> [--evidence <file>] [--now <iso>]
verify case status --dir <case-dir> [--now <iso>] [--json]
verify case replay --dir <case-dir> [--reread]
```

`case status` gives counts per party, counts only: what each party filed and what was refused. `case replay` does four things:

1. checks the ledger chain;
2. verifies every accepted move's signature against the parties file;
3. re-performs the filing verdict and every re-verdict byte for byte;
4. with `--reread`, reads every filed document again. A signed statement and a UBL XML read the same anywhere. A PDF re-read
   needs the same readers.

The library exports `openCase`, `fileMove`, `caseStatus`, `replayCase`, `signMove`, `countersignMove` and `signStatement`.

**What the thin cut does not do yet:**

- The record is the case directory's own ledger, and verify does not import receipts. Receipts-side rows and a witnessed head
  are the next step. Until then, an edit to any row before the head breaks the chain, but the head itself needs a witness.
- A conflict is recorded but does not hold a case open by itself. The higher tier computes. Whether an unanswered conflict should
  hold a case is a policy question for the first buyer.
- A PDF CORRECT reads document fields only, not line or list fields.
- There is no two-party surface. The moves are files, and the CLI files them.
