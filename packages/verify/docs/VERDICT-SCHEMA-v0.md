# Verdict schema — v0 (2026-09-22; revised 00:50 to match `src/verdict/schema.ts`)

> The verdict is the product. Everything else is plumbing. This schema is designed so that a verdict emitted today can be **replayed and re-audited** in three years, and so that Stage 2 (the Verdict Ledger) and Stage 3 (agentic argument-truth) need *additive* fields only — never a breaking change.
>
> **Source of truth is the TypeScript in `src/verdict/schema.ts`.** This document explains the rules behind it.

## Design rules

1. **A verdict is a proof object, not a score.** It carries everything needed to reproduce itself: inputs (by hash), the exact rules that fired, the computation performed, the operands consulted with their provenance, and the versions of everything.
2. **Three outcomes, never a fourth.** `PASS` (the check ran and held) · `FAIL` (the check ran and did not hold) · `INSUFFICIENT_DATA` (the check *could not run* — the inputs did not permit a determination). **FAIL and INSUFFICIENT_DATA are different verdicts and are never conflated.** "Proven wrong" ≠ "couldn't tell."
3. **Every claim gets its own verdict.** The document-level outcome is an aggregation over per-claim verdicts and the aggregation rule is named (`ANY_FAIL_FAILS`: FAIL if any claim FAILs; else INSUFFICIENT_DATA if *no* claim could run; else PASS — a PASS with partial coverage is honest, and `coverage` says how partial). A second named rule was added on 2026-09-29, `ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES`: FAIL if any claim FAILs; else PASS only if a claim of a kind other than `CONSISTENCY` PASSed; else INSUFFICIENT_DATA. It is for a verdict that also checks a document against itself: an internal inconsistency still FAILs it, but the document agreeing with itself never PASSes values nobody verified. The e-invoice twin names it from 0.3.0. A verdict always names the rule it uses, and every reader recomputes under that rule (`src/verdict/aggregation.ts`).
4. **Tier is explicit.** Each claim declares *how* it was reached: `DETERMINISTIC` (recompute / exact match — cannot be hallucinated) or, later, `REASONED` (the hybrid overreach tier — an audited opinion, labeled as such). v0 emits only `DETERMINISTIC`. **A REASONED verdict is never presented as DETERMINISTIC**, and the consumer never infers tier.
5. **Determinism is a contract.** Same `input_hash` + same `ruleset.version` + same `engine_version` → byte-identical verdict **except `issued_at`**, the one field allowed to carry a clock (injectable for tests). `verdict_id` is therefore **derived** (`sha256(input_hash:ruleset@version:engine)`), not a ULID. `replayView(verdict)` returns the comparable projection.
6. **Provenance points into the input, never at it.** v0's input is *structured, already-extracted JSON*, so each piece of evidence carries a **field locator** — `source` (invoice / contract / evidence / computed) + `path` — plus the normalized value, the original value when it differed, the normalization log (e.g. `european_format_converted`), and the binding confidence (100 exact path · 95 alternative path · 75 fuzzy alias — only exact/alternative can lock). Character-span locators are reserved for the later source-document mode.

## Three honesty rules enforced on top of the kernel

- A kernel `FAIL` whose only failing predicates are *could-not-compare* (type mismatch, operand missing, wrong shape) becomes **`INSUFFICIENT_DATA / UNPARSEABLE`.** The data wasn't proven wrong; it couldn't be compared.
- A kernel `INSUFFICIENT_DATA` whose missing roles are *all* contract-side (or all evidence-side) **while the caller supplied no such reference** becomes **`INSUFFICIENT_DATA / REFERENCE_NOT_PROVIDED`.** The extraction is not at fault; the check simply needs a document it wasn't given.
- **A verdict is never issued on a guessed field.** Binding confidence is exact path 100 · alternative path 95 · fuzzy alias search 75. After every operand is on the receipt — including the operands *behind* computed roles, which inherit the **lowest** confidence of their inputs — any PASS/FAIL resting on an operand below **90** becomes **`INSUFFICIENT_DATA / AMBIGUOUS_FIELD`**, with the guessed operand still shown so the developer can name it properly. (Found by the first test run: the engine's alias table lets "subtotal" reach `totals.total`; without this rule a footing check could FAIL against a number that was never on the invoice.)

## Rulesets and the history axis (added 02:30)

The verdict's `ruleset {id, version, domain}` names the document type's law package (`docs/RULESETS.md`); `verdict_id` includes it, so the same input under different rules is a different verdict. `references.history` counts prior documents of the same kind (the previous pay application; prior invoices); evidence bound from them carries `source: 'history'` and a path into the caller's document (`history[0].schedule_of_values[1].completed_to_date`), role `REFERENCE`. `variance` is **signed**: asserted − expected (a stated total below its recomputation is negative).

## Insufficiency reasons

`FIELD_MISSING` · `UNPARSEABLE` · `AMBIGUOUS_UNIT` (currency mismatch, unknown scaling) · `AMBIGUOUS_FIELD` (found only by fuzzy name-matching) · `AMBIGUOUS_REFERENCE` (the reference offers several candidates — e.g. many rates — and none could be matched to this line; honesty rule 4) · `SPAN_NOT_FOUND` (source-document mode) · `OUT_OF_RULESET_SCOPE` · `REFERENCE_NOT_PROVIDED`. Every `INSUFFICIENT_DATA` claim carries one, with a `detail` sentence and the `missing` roles when applicable. For computed roles (`LINE_ITEMS_SUM`, `EXPECTED_GRAND_TOTAL`, `EXPECTED_TAX_AMOUNT`) the detail names *which operand* was absent.

## Non-negotiables (tested as schema invariants)

- `evidence` may be empty **only** on `INSUFFICIENT_DATA`. A `PASS` or `FAIL` with no evidence is a schema violation, not a verdict.
- `insufficiency` is present **iff** `outcome === 'INSUFFICIENT_DATA'`.
- `tier` is stated by the producer and cannot be upgraded after the fact.
- `declared_accuracy` is *measured on a public, preregistered set* or it is absent. It is never estimated.
- `replayable` is literally `true` — the field asserts the contract for this verdict.

## Shape (abridged — see `src/verdict/schema.ts`)

```
Verdict {
  schema_version 'v0' · verdict_id (deterministic) · issued_at (ISO-8601 UTC; the only volatile field)
  engine_version · ruleset {id, version, domain} · input_hash · replayable: true
  document { extraction_hash, producer?, line_items } · references { contract: bool, evidence: n }
  outcome · aggregation ('ANY_FAIL_FAILS' | 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES') · claims: ClaimVerdict[]
  coverage { claims_total, claims_checked, claims_pass, claims_fail, claims_insufficient }
  remedies? (2026-10-02, additive: present iff a claim or the verdict is not PASS; outside the hashed core; docs/REMEDIES.md)
  declared_accuracy? · ledger? (Stage 2) · action_context? (Stage 3) · channel? ('VERDICT'; v0.1, additive)
}
ClaimVerdict {
  claim_id ("document.TOTAL_INT", "line[3].MATH_INT") · kind (RECOMPUTE | QUOTE_MATCH | CROSS_REFERENCE | CONSISTENCY)
  tier · outcome · field · asserted · rule_id · rule_name
  computation? { formula, operands (by role), result, tolerance? }
  evidence: Evidence[] · insufficiency? · variance? · locked · explanation
}
Evidence { locator {kind:'field', source, path} | {kind:'span',…} · value · original? · normalizations? · confidence · role }
Remedy { kind (missing-operand | transform | authority | recompute-with | none) · operand? {source, role?, path?}
  transform? (a registered name) · authority? (a role) · detail · clears: rule ids · claims: claim ids }
```

### Typed remedies (2026-10-02)

Every non-PASS claim is answered by typed remedies: what lawfully clears it (`docs/REMEDIES.md`, `src/verdict/remedy.ts`).
They sit in one top-level `remedies` list, after `coverage`, and they are **outside the hashed core**:

- `verdict_id` derives from `input_hash`, the ruleset and the engine exactly as before. A remedy never enters it, and a
  declarative ruleset's `remedy` declarations are removed from its input identity (`rulesetIdentity`). Every verdict id
  issued before remedies existed is unchanged, and so is every other byte of every verdict (pinned by the goldens, which
  hash the core).
- A remedy is the engine's output, so a replay re-derives it and compares it byte for byte. A verdict issued before
  remedies existed carries none: it replays on its core, and the replay reports the remedies it derives
  (`remedies_not_carried`).
- A signed envelope covers the remedies like every other field.

### The gate reading, and checks that do not apply (R3, 2026-10-03)

- **PASS-WITH-OPEN.** The verdict keeps its three outcomes. A gate reads four (`gateStatus`, `src/verdict/aggregation.ts`):
  PASS (every deterministic claim ran and held), PASS-WITH-OPEN (the verdict PASSes but a deterministic claim could not run),
  FAIL, INSUFFICIENT_DATA. Under ANY_FAIL_FAILS a can't-tell never blocks PASS; a gate that acts on money must not read
  that as PASS. The AP gate (library, MCP `ap_gate`, hosted `POST /v1/ap/gate`) never pays on PASS-WITH-OPEN and answers
  `status`; the CLI exits 2 on it by default from 2026-10-05 (fails closed; `--allow-open` exits 0 when each
  open check waits on a reference or a missing field, and says so) and `--gate`
  names the open checks. It is a reading, not a new aggregation rule, because a
  stricter recorded outcome would stop every already-issued verdict with an open claim from replaying byte for byte. The
  typed-decision gate (receipts `gate()`) holds on it only with `holdOnOpen`: the built-in invoice ruleset abstains on every
  reference the caller did not send, so a strict reading there would hold nearly every invoice. From engine 0.6.0 the verdict
  also records this reading as `gate_status` (below), so a reader of one field no longer sees a bare PASS.
- **`not_applicable`** (additive): a declarative check or required passage that `applies_if` ruled out makes no claim and
  is listed here with the condition that did not hold. Present only when one was ruled out.

### Span offsets, the inputs a verdict binds, and a packed verdict (R3, 2026-10-03)

- **Span offsets are UTF-16 code units** of the source text as the caller gave it (JavaScript string indices): `start`
  inclusive, `end` exclusive, so `text.slice(start, end)` is the matched passage. They are not byte offsets and not code
  points: after `☕` or `😀` the three differ. `source_hash` is the sha256 of the text's UTF-8 bytes. A SARIF or editor
  location built from a span converts from UTF-16 code units (SARIF's default `columnKind` is `utf16CodeUnits`).
- **The inputs a verdict's input_hash binds** come from one exported builder, `verifyInputs(extraction, options)` (and
  `verifyInputHash`), which verify() and the declarative evaluator use themselves. A replay bundle is
  `{ verdict, inputs: verifyInputs(extraction, options) }`.
- **A packed verdict** (`packVerdict` / `unpackVerdict`, format `riposte.verdict-pack/1`) is the same verdict with each
  object's key list and each repeated string stored once. It is lossless: unpacking gives the verdict byte for byte, so its
  id, hash and replay are untouched (unpack before verifying). A 1,500-line invoice's 4.1 MB verdict packs to 1.8 MB, and to
  about 105 KB with gzip on top. verify's HTTP `/v1/verify` and `/v1/verify/declared` answer packed with `"pack": true`.
  Per-line provenance is not capped or summarised inside the verdict: that would change the bytes of verdicts already issued.

### Engine 0.3.0: struck fields, evidence tiers, the scope line (V1b, 2026-10-03; `docs/EVIDENCE.md`)

Every addition is additive, and none is emitted for a verdict that names an earlier engine, so those verdicts keep their
bytes. The three outcomes are unchanged.

```
Verdict (engine 0.3.0, declarative) {
  …
  computed      { pass: claim_id[], fail: claim_id[] }           the checks that ran, by outcome
  struck        StruckField[]                                     every struck field some claim waits on
  would_unlock  { field, claims: claim_id[] }[]                   per struck field, the claims waiting on it
  counts        { checks_computed, checks_pass, checks_fail, checks_struck, fields_struck,
                  unreadable, suspect, withdrawn, unsupported_assertion, conflict, findings }
  evidence_floor  'E0' | 'E1' | 'E2' | 'E3' | 'E4' | 'unstated' | 'none'
  findings?     { kind: 'tier-conflict' | 'tier-claim-capped', field, path, detail, kept?, against? }[]
  support?      { field, path, value, tier, supported_at, sources: { source_id, tier, value, agrees, move_id? }[] }[]
  case?         { case_id, prior_verdict_id, move_id }           an annotation (set aside by replay, like `channel`)
  scope         { ruleset, engine_version, evidence_floor, statements }   every engine; always the last key
}
StruckField { field ("PAYABLE", "LINE_EXT@line[0]", "VBD_TAX[2]"), role, path?, reason ('unreadable' | 'suspect' | 'withdrawn' |
  'unsupported-assertion' | 'conflict'), provenance { raw?, at?, page?, line?, reader?, readings?, tier?, move_id? }, detail,
  candidates? { checked, failing, passing, shown: { read_as, value, fails: claim_id[] }[] } }
```

- **`ClaimVerdict.suspect` is retired from 0.3.0.** A 0.3.0 verdict states suspect on the struck field. A 0.2.0 verdict keeps
  the claim-level field and its gate reading (FAIL / HELD-SUSPECT).
- **The gate.** `gateStatusOpen(v)` adds OPEN to the four readings: a verdict that is not FAIL, with a struck field a claim waits
  on. `gateStatus` is unchanged in type, and an OPEN verdict reads PASS-WITH-OPEN (or INSUFFICIENT_DATA) there.
- **Inputs.** A declarative re-verdict made with an arbitration evidence overlay binds it: its inputs are
  `{ extraction, ruleset, source?, tolerance?, evidence }`, and `verifyInputs` builds them.
- **Provenance** in the extraction contract gains an optional `tier` (E1, E2, E3).

### Engine 0.4.0: claims over tables (SCI-R4, 2026-10-04; `docs/RULESETS.md`, `docs/EVIDENCE.md`)

Two blocks are added, each only when it has something to say, and only by engine 0.4.0. A verdict that names an earlier engine
carries neither and keeps its bytes. The outcomes, the claims and the id derivation are unchanged.

```
Verdict (engine 0.4.0, declarative) {
  …
  archives?    { url, member?, container_sha256?, retrieved_at, sha256, archive_checksum? { algorithm, value, published_at? },
                 tier: 'E1', content_verified, checksum_verified, fields, detail }[]   one per archive file values were read from
  algorithms?  { ref, id, version, implementation_sha256, source { doi, url, pdf_sha256, text_sha256, quote_sha256 } }[]
               (or { ref, carried: false })                                       the pinned algorithms the ruleset names
  scope        …                                                                  still the last key
}
```

- **`algorithms` and the id.** The ruleset's input identity (`rulesetIdentity`) carries the same pins, so the input_hash, and so
  the verdict_id, binds the implementation and the quoted source of every algorithm the ruleset names. `deriveVerdictId` is
  unchanged. A third party recomputing the input_hash of such a verdict needs the registry's pins: they are on the verdict.
- **Replay** checks every pin against the build's registry before anything else, and FAILS ("replay refuses: …") when one
  differs or is not carried.
- **`archives`.** `checksum_verified` is true only when the engine hashed the bytes itself (the source text), they are the file
  the provenance names, and they match a checksum the archive publishes. The tier is always E1, never E0.
- **The abstention for a missing neighbour** (`prev()` on the first row, `next()` on the last) uses the existing reason
  `OUT_OF_RULESET_SCOPE`, with a detail that starts `no_neighbour:`. No reason code was added.

### Engine 0.5.0: the choice ledger (CEN-A, 2026-10-04; `docs/CHOICES.md`, `docs/RULESETS.md`)

Every addition is additive and emitted only by engine 0.5.0, so a verdict that names an earlier engine keeps its bytes. The
outcomes, the claims, the reason codes and the id derivation are unchanged.

```
Verdict (engine 0.5.0, declarative) {
  …
  counts      { …, choices_load_bearing, choices_stated, stated_rate (number to 4 decimals | null), qc_held, qc_struck, beyond_data }
  advisories? [{ …, beyond_data?: true, support?: { field, value, max_of, last } }]   a model check past its measured support
  archives?   [{ …, matched? }]                                                      which supplied bytes were this file
  choices     ChoiceEntry[]                                     every slot the ruleset declares, in its order ([] when none)
  qc?         { choice, read, computed, held, struck, absent, not_read, values: QcValue[] }   when a value carries `qc`
  scope       …                                                                       still the last key
}
ChoiceEntry { id, kind ('weights' | 'flags' | 'ratio' | 'units' | 'model_form' | 'algorithm' | 'tolerance' | 'selection'),
  status ('stated' | 'supplied' | 'unstated' | 'not_applicable'), value (number | string | object | null),
  source ({ span: { page?, section?, quote }, registry?: { ref, quote_sha256, verbatim } } | { default, by: 'ruleset' | 'judge' }
          | { not_applicable } | null), load_bearing, detail? }
QcValue { field, path, scheme, flag, meaning (the scheme's), action ('held' | 'struck' | 'absent') }
StruckField.reason   adds 'qc_held' and 'qc_struck'
AlgorithmPin.source  adds reference_sha256 when the registry entry names a reference implementation (rar.fit@1)
```

- **`stated_rate`** is stated / load-bearing. It is null, never 0, when no slot is load-bearing: nothing to state is not the same as
  nothing stated.
- **Identity.** The document's fills are in the extraction, the ruleset's defaults in the ruleset, the judge's values in the inputs
  (`supplied_choices`), so all three are bound by the input_hash: another supplied value is another verdict.
- **Inputs.** A declarative verdict made with the judge's values or with archive bytes binds them: its inputs are
  `{ extraction, ruleset, source?, tolerance?, evidence?, supplied_choices?, archive_files? }`, and `verifyInputs` builds them.
- **The gate's abstention** for a check that depends on a slot with no value uses the existing reason `FIELD_MISSING`, with a
  detail that starts `choice_unstated:` and `missing` naming the slots. No reason code was added.
- **A beyond-data check makes no claim**, so it is in neither `claims` nor `coverage`: it is counsel, and the gate never reads it.
- The built-in engines declare no slots and carry no ledger.

### Engine 0.6.0: gate_status, and the hash contract (2026-10-05; `docs/REPLAY.md`)

Additive. A verdict that names engine 0.0.1 to 0.5.0 carries no `gate_status` and keeps its bytes. The outcomes, the claims, the
reason codes and the id derivation are unchanged.

```
Verdict (engine 0.6.0, every engine) {
  …
  outcome      'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'          unchanged: the named aggregation over the claims
  gate_status  'PASS' | 'PASS_WITH_OPEN' | 'FAIL' | 'INSUFFICIENT_DATA'     the key right after outcome
  …
}
```

- **What it records.** `gate_status` is what a gate reads (`recordedGateStatus`, `src/verdict/aggregation.ts`):
  - `PASS`: the verdict PASSes, every deterministic claim ran and held, and no load-bearing field is struck.
  - `PASS_WITH_OPEN`: every check that ran held, but at least one could not run. That covers an open deterministic claim and a
    struck load-bearing field (what `verify --gate` and a person read as OPEN).
  - `FAIL`: the verdict FAILs.
  - `INSUFFICIENT_DATA`: no claim could run.
  A judgement-tier (REASONED) abstention never opens a verdict. The record spells the open state with an underscore, like
  INSUFFICIENT_DATA; a person reads `PASS-WITH-OPEN`.
- **Why beside `outcome`, not instead of it.** `outcome` keeps its meaning, so nothing that reads it changes, and every verdict
  already issued replays byte for byte. A consumer that reads one field (a SIEM, a script, a spreadsheet) should read
  `gate_status`. For a verdict of an earlier engine, recompute it from the claims (`gateStatus`); the CLI does.
- **Replay.** It is a pure function of the verdict, so a replay re-derives it and compares it like any engine output: a doctored
  `gate_status` diverges at `gate_status`.
- **The CLI headline.** `verify <doc>`, `verify ap` and `verify replay` print it on stderr with the count behind it:
  `PASS: 13 of 13 checks ran and held`, `PASS-WITH-OPEN: 3 of 13 checks could not run`, `FAIL: 2 of 13 checks failed`,
  `INSUFFICIENT_DATA: none of the 13 checks could run`.
- **Acting on it: fail closed (from 2026-10-05; `src/verdict/exit.ts`).** Every entry point reads the gate the same way, and
  only a clean PASS reads as passed. Nothing in the verdict changes; this is how a caller is told to act on it.

  | gate | CLI exit (`check`, `ap`) | HTTP `x-verify-exit` | MCP gate line |
  |---|---|---|---|
  | PASS (an AP approve with `payable` true) | 0 | 0 | `exit 0` |
  | FAIL, HELD-SUSPECT, an AP hold | 1 | 1 | `exit 1` |
  | PASS-WITH-OPEN, OPEN, INSUFFICIENT_DATA, an AP abstain | 2 | 2 | `exit 2` |

  A caller who wants an open verdict whose checks that ran all held to read as 0 states it: `--allow-open` on the command line,
  `"allow_open": true` in the HTTP body or the MCP arguments.
  From 2026-10-19 that reading applies only when every open check's reason is REFERENCE_NOT_PROVIDED or FIELD_MISSING and no
  load-bearing field is struck (verdict/exit.ts ALLOW_OPEN_REASONS); any other open check keeps exit 2 and is named with its
  reason, and the reading carries no `x-verify-allow-open` header. The answer then says it was the caller's stated choice (stderr; the
  `x-verify-allow-open: stated` header; the gate line). Before 2026-10-05 the CLI's exit code read `outcome`, so PASS-WITH-OPEN
  exited 0 unless `--gate` was given. `--gate` is still accepted; it prints the gate's own message and exits the same way. The HTTP
  status stays 200 for every verdict (a FAIL always was), with `x-verify-gate` and `x-verify-exit` on every verdict route; an MCP
  verdict tool's text leads with the gate line, the JSON follows as the second text item, and the structured content is the
  verdict as before (`isError` stays false: the verification ran). For `verify ap`, allow-open reaches one case only: a bill the AP
  gate abstained on because no payment history was given, every other check passed (`abstainsOnlyForMissingHistory`); the decision
  object keeps `decision: "abstain"` and, on the command line, gains `"exit"` and `"allow_open"`.
- **The hash contract** (`docs/REPLAY.md`): input_hash is sha256 over the canonical JSON of the inputs as parsed. Canonical JSON
  writes array-index keys first in ascending numeric order, then every other key in UTF-16 code-unit order. Text that is not valid
  UTF-8, a JSON number past the double range (`1e999`), a key repeated in one JSON object and a JSON byte-order mark are refused
  before hashing, never collapsed to U+FFFD, to null or to the last value written. From 2026-10-05 `verify()` refuses a non-finite
  number anywhere input_hash covers, under every engine, and a malformed tolerance override (`InputRefused`); HTTP and MCP read
  their bodies under the same contract.

## What v1 will add (so v0 doesn't paint us into a corner)

- `REASONED` tier live for the overreach flag (hybrid), with its own declared accuracy measured separately from the deterministic tier.
- Multi-document `CROSS_REFERENCE` across `source_hash`es and span locators (documents checked against documents).
- `AMBIGUOUS_UNIT` abstention on currency mismatch / "in thousands" scaling.
- Ledger population (Stage 2) and `action_context` population (Stage 3) — both already reserved.

---

## v0.1 (2026-09-28): typed channels, per-action handling, earned voice, opinions

> Honesty key: ✓ built and tested (`test/channel`, `notices`, `bounds`, `voice`, `opinion`, `opinion-cli`) · ⚠ inferred · ◇ hypothesis, untested.
> Every v0.1 addition is **additive**. `verify()` emits exactly the bytes it emitted before, `verdict_id` is derived exactly as
> before, and the 489 declarative golden hashes are unchanged ✓. Source of truth: `src/verdict/channel.ts`,
> `src/verdict/notices.ts`, `src/verdict/voice.ts`, `src/verdict/bounds.ts`, `src/opinion/`.
> **Amended by design ruling, 2026-09-28 ~08:14 (as corrected 08:35):** judgement is advice, not verdict; the person is
> made aware of every FAIL and can dispute it (*"the human should be made aware of what fails in case they want to
> dispute"*: awareness at every rung, holding only at gate and autonomy); the rung changes only by a person's decision, in
> either direction; the settings a workflow started at stay fixed. In his words: *"I just want to fight the fight as the
> fight was intended from the settings it started out at."*

### Typed channels

Riposte speaks on two channels, and they never mix.

| channel | what it is | carries | may it flex? | does it hold the action? |
|---|---|---|---|---|
| **VERDICT** | checked against a binding source and evidenced: the v0 proof object | everything in v0; optionally `channel: 'VERDICT'` | never | a FAIL or ABSTAIN does at gate and autonomy; at record and advise it is surfaced, not held |
| **COUNSEL** | generated: a miner candle, "you might also check X", a proposed ruling (an opinion), or a **judgement-tier finding** | `provenance.type: 'GENERATED'` (generator, version, `source_hash`), the **judge results** that justified surfacing it, `dismissible: true`, `holds_action: false`; an advisory also carries a `strength` | it is advice, and a person may dismiss it | never |

- **Judgement-tier findings are COUNSEL, never VERDICT: advisories with a strength, shown with the evidence they rest on, and they never hold the action.**
  ✓ `counselFromReasoned` / `advisoriesFromVerdict` turn a REASONED finding into an `ADVISORY` with
  `strength: 'strong' | 'moderate' | 'note'`. A **strong** advisory is prominent. People and agents may proceed with the data,
  and it is always shown with the evidence it rests on and a dispute path for that single finding (`makeCounsel` refuses a
  strong advisory without evidence, and any advisory without a strength or a dispute path). `assertVerdict` refuses any
  object carrying a REASONED PASS/FAIL finding, and the ledger calibration never counts one as VERDICT evidence.
- **The stamp is additive (the `accuracy.ts` pattern)** ✓. `stampVerdictChannel(v)` adds `channel: 'VERDICT'` only after
  `assertVerdict` confirms that the object earns it. The id must re-derive from `input_hash + ruleset@version + engine_version`,
  every PASS/FAIL claim must carry evidence and be DETERMINISTIC, and nothing about the object may be generated. `channel` is
  not part of `verdict_id`. An unstamped v0 verdict is read as VERDICT only after the same check.
- **The guard** ✓. COUNSEL can never be rendered or serialized as a VERDICT. Anything carrying `channel: 'COUNSEL'` **or**
  `provenance.type: 'GENERATED'` is COUNSEL, whatever other fields it wears. `serializeVerdict` / `renderVerdict` /
  `stampVerdictChannel` throw `ChannelViolation` on it. `renderChanneled` / `serializeChanneled` keep each item under its own
  label and never promote COUNSEL. COUNSEL on the ledger is never counted as VERDICT evidence.
- **COUNSEL must earn surfacing** ✓. `makeCounsel` refuses an item with no judges, a judge that did not pass, a non-GENERATED
  provenance, or no `source_hash`. `counsel_id` is derived from the content, so an edited item no longer matches its id.
- **Miner candles are COUNSEL** ✓. `counselFromCandle` maps the mining gauntlet's three judges (CONSISTENCY, GROUNDING, NOVELTY)
  onto judge results, and re-checks them against the report's own gates. Only fate CANDLE may be surfaced; the morgue stays in
  the morgue.
- COUNSEL is generated by deterministic code (the miner, the judges, the opinion renderer) or by a reasoning layer that stands
  outside verify. It is **never** generated by a language model inside verify. The verifier verifies; it does not converse.

### Per-action handling (the rung decides the hold; awareness is at every rung)

- **Every FAIL is shown to the person with its evidence and a dispute path, at every rung. Whether it also holds the action is the rung's: surfaced at record and advise, held at gate and autonomy.**
  ✓ `ACTION_HANDLING` (in `notices.ts`) is the table below, and every assessment carries its row as `handling`.

| rung | FAIL / ABSTAIN | PASS | delivery |
|---|---|---|---|
| `record` | recorded and **surfaced** as a notice with its evidence and a dispute path; **not held** | unchanged (Riposte does not intervene) | a notice on the record |
| `advise` | the same, surfaced **prominently in-flow** to the person and the agent; **not held** | unchanged | in-flow |
| `gate` | **HELD** until a person resolves it | human review | in-flow |
| `autonomy` | still **HELD** until a person resolves it | proceeds unreviewed within the declared bounds | in-flow |

- ✓ `actionNotice(verdict, level)` (CLI: `verify notice --level <rung>`) lists every deterministic FAIL, then every
  abstention. Each comes with the cells it rests on and its own dispute command
  (`verify opinion --ledger <chain.jsonl> --dispute <verdict_id> --claim <claim_id>`), so a dispute is reachable from a
  single FAIL at any rung, not only from proposals. The findings and dispute paths are identical at every rung (tested);
  only the handling differs. `renderVerdict` is rung-free and shows the same findings.
- Intercepting the tool call in-flow (the `verify_action` adapters: Claude Code hook, LangGraph `wrap_tool_call`, OpenAI
  Agents guardrail) is a **delivery surface** for the gate and autonomy holds. It is not a rung of its own.
- Only DETERMINISTIC findings count. Judgement-tier advisories are shown but never held. For every v0 verdict, the notice's
  outcome is exactly the verdict's outcome (tested).

### Earned voice

How far a workflow's agents may be trusted is **measured** from the book of record and **decided** by a person. The rungs
(handling as in the table above):

| rung | in one line | the evidence that supports it (per workflow, from human reviews on the ledger) |
|---|---|---|
| `record` | quiet entry: log everything, surface every FAIL, hold nothing (the day-1 audit report) | nothing: the default |
| `advise` | surface FAILs and COUNSEL (strong advisories live here) prominently in-flow; hold nothing | the **false-flag rate** (overturned FAILs ÷ reviewed FAILs): advice from a checker that cries wolf is noise |
| `gate` | hold each FAIL/ABSTAIN until a person resolves it; PASSes still get human review | the false-flag rate, under a stricter bar: a wrong hold costs work |
| `autonomy` | PASSes proceed unreviewed within bounds; FAIL/ABSTAIN still held | the **false-PASS rate** (overturned PASSes ÷ reviewed PASSes): a wrong unreviewed action |

A rung is supported when `n ≥ min_n` **and** the declared one-sided upper confidence bound on its rate is at or below the
declared bar. Support is cumulative ✓. The rules:

- **Riposte proposes; a person decides. The rung changes only by a person's decision, one rung at a time, in either direction.**
  ✓ `assessVoice` returns `level === granted`, always: it never changes the rung on its own, in either direction
  (property-tested across a grid of evidence, every granted rung and two tiers). When the evidence supports the rung above,
  it raises a `PROMOTION_PROPOSAL`. When the evidence stops supporting the granted rung, it raises a `DEMOTION_PROPOSAL`:
  symmetric with promotion, in the same opinion format, `urgent: true`, with the reasons and the `failing_cases` listed (each
  overturned verdict behind the unsupported rungs, with its own dispute path). Both carry `status: 'PROPOSED'` and
  `requires_human_signature: true`. Until a person decides, the rung stays where they set it, with that rung's handling, and
  every FAIL stays visible and disputable.
- **The settings a workflow was granted under are fixed. The policy is versioned, nothing tunes it, and a change is a person's recorded revision.**
  ✓ The policy (method, tiers, bars, minimums, confidence) is declared data. `assessVoice` reads it and never writes it (tested
  on a deep-frozen policy). A `grant` names who set the rung, when, and the policy version and consequence tier it was made
  under. Assessing it under any other settings is refused. A person adjusts the weighting at a review with `revisePolicy()`:
  a new version that records who, when, why, what changed (computed), and the hash of the version it supersedes. A revision
  that changes nothing, reuses the version, or lacks a person or a reason is refused. Moving a workflow onto the new version
  is a person's re-grant.
- **The burden of proof scales with consequence** ✓. `lintPolicy` rejects a policy whose burden ever decreases as consequence
  rises, and one whose gate bar is laxer than its advise bar.
- **A ruleset or engine version change changes behaviour; the old record no longer describes it. Each version earns its own record.**
  Evidence that spans versions supports nothing (the `declared_accuracy` precedent) ✓. The default workflow key is
  `tenant/ruleset@version`. A calibration that no longer matches its own hash also supports nothing ✓. Either way, the rung
  does not move: an urgent demotion proposal says why.
- `EXAMPLE_PROMOTION_POLICY` is **◇ illustrative only**. It is not ratified and not calibrated on any deployment. The real bars
  are a business and risk decision. Its severe tier implies: with zero misses, a 0.1% bar at 99% confidence needs about 5,400
  reviewed PASSes.
- ⚠ Two consequences of the design, stated now. (1) Because support is cumulative, a workflow that never produces a FAIL
  cannot be supported above `record`, since its flags have never been tested. (2) Every rate takes a person's review as
  ground truth, and reviewers who choose what to review bias the rate in a direction nobody measures. Opinions state both in
  their dissent.
- ✓ measured: the dispatch's illustrative "412 of 415" (3 misses) has a 95% Wilson upper bound of about 1.79%. It would **not**
  clear a 0.5% bar. It clears only a bar of about 2% or looser.

### Opinions

`promotionOpinion` (a proposal, promotion or demotion, or a workflow's declaration) and `disputeOpinion` (one contested
claim of a recorded verdict, reachable from any single FAIL) render the courtroom format as Markdown plus a JSON
object ✓:

> the question · the candidate readings with cited cells · the authorities quoted · precedent · the footing consequences of each
> reading · the ruling and its scope · the steelmanned dissent · what would overturn it

and then the **premises**. Each factual premise names the Riposte check that verified it and cites replayable ids: verdict ids
(which re-derive), evidence-set hashes (which re-derive from the listed ids), ledger RECORD/REVIEW event hashes, the chain
head, and the policy and calibration hashes. **Self-verifying** ✓: the opinion re-hashes the ledger's content and rebuilds the
records from the chain. It recomputes the calibration, the bounds and the ladder. A supplied proposal must match its own id
**and** be exactly what the evidence produces. If any premise fails, the disposition is `WITHHELD` and nothing is proposed.

- **The deterministic check settles FACT, and FACT replays. Whether a rule applies to a document is LAW, and a ruling on LAW is a person's. Riposte proposes; a person signs or overrules.**
- Voice dispositions: `PROPOSE_PROMOTION` · `NOT_YET` · `RETAIN` · `PROPOSE_DEMOTION` (urgent; the failing cases are listed
  under Precedent, each with its dispute path). Every one takes effect only on a person's decision. Dispute dispositions:
  `UPHOLD` · `REFER` (the rule's precedent puts it on the review queue, so the LAW question goes to a person; or the finding is
  judgement-tier, an advisory that never held the action). An abstention is always upheld, because a ruling cannot
  manufacture data.
- The dissent is steelmanned against the ruling: the sample size, the confidence bounds, the counter-cases found, the
  consequence tier, review selection, and the reviewer as ground truth. "What would overturn it" gives the specific
  evidence, with counts computed by the same arithmetic the assessment uses. One example: "N more overturned PASS verdicts in
  a row would take the upper bound over the bar, and Riposte would raise an urgent proposal to step down."
- An opinion is **COUNSEL**: generated, carrying its premises as judge results, and dismissible. `opinion_id` is derived from
  its content, and no clock appears anywhere in it.
- **The rung is read from the book** (2026-09-28). A promotion or demotion opinion always carries **P8**, which says where the
  rung came from: `BOOK` (the signed GRANT in force, cited by id and seq; a ruling would amend that grant) or `DECLARED`
  (no signed GRANT or DECLINE on the verified book, so the rung is the caller's declaration). A flag never overrides a signed
  grant: a declaration or proposal that disagrees with the book fails P8, and the opinion is `WITHHELD`. A person's standing
  DECLINE of the proposal the evidence raises is **P9**, and the disposition is `DECLINED`, never a fresh ask: nothing
  changes, and the ruling says who declined, when, why, and what would re-raise it. When the evidence the decline saw
  changes, P9 says the decline no longer stands and the proposal is raised again.
- **The tenant scope.** On a shared book, an opinion scoped to one tenant (`scope: { tenant_id, owns_workflow? }`; a
  workflow belongs to a tenant when its id starts with `<tenant_id>/` unless `owns_workflow` says otherwise) verifies the
  chain whole, because its hashes cover every tenant, and reads only that tenant's records, reviews and decisions. Another
  tenant's verdict or workflow is refused.
- **Precedent → statute.** A person's ruling on LAW (`STANDS` or `SET_ASIDE`) is a signed statement about one dispute
  opinion, bound to the book it was read from. A statute is built from those rulings, each re-verified against the book,
  and mined like any labelled case table. What comes back is **COUNSEL, never VERDICT**: rulings are inputs to counsel. A
  rule the statute suggests binds nothing until a person adopts it by writing it into a ruleset.
- CLI: `verify notice …` (exit 0 PROCEED · 1 HOLD · 2 SURFACED), `verify voice …` (exit 2 while an urgent demotion proposal
  is open), `verify opinion …` and `verify twin …` (see `verify --help`). All are read-only. `verify rule …` signs a ruling
  and `verify statute …` builds the statute (COUNSEL).
- Built since v0.1: the grant, the decline and the policy revision are signed decisions on the book (`GRANT`, `DECLINE`,
  `POLICY_REVISION`); voice and opinions have MCP (`voice_assess`, `opinion_render`) and HTTP (`/v1/voice/{workflow}`,
  `/v1/opinion`) surfaces. ◇ Not built yet: runtime enforcement of the declared bounds (they are a person's text).

### Structured-twin verdicts (CREDENCE-1, wired 2026-09-28)

- `verifyAgainstTwin(html, claims, opts)` (`src/twin/`, exported from the package; CLI `verify twin`) checks an agent's
  extracted values against the filing's own inline-XBRL facts and returns a standard verify `Verdict` plus per-claim
  `TwinJudgment`s. PASS = MATCH. FAIL = MISMATCH, diagnosed as SCALE · PERIOD · CONCEPT · DIMENSION · UNLOCATED. ABSTAIN maps
  onto the existing `InsufficiencyReason`s, with the twin reason leading `insufficiency.detail`.
- Twin verdicts are **VERDICT-channel** material: a binding source, evidenced by spans into the twin. `stampVerdictChannel`
  accepts them unchanged ✓ (tested). They use the standard `verdict_id` derivation; `twinVerdictInput()` makes `verifyReplay`
  work.
- ⚠ CREDENCE-1 K2 fired (7.2% false FAILs on correct values, mostly concept-priority binding). The measured posture ◇ is
  therefore: in promoted cells, auto-accept on twin PASS and route FAIL/ABSTAIN to a person. ⚠ That is `autonomy` as
  defined above (PASS proceeds within bounds; FAIL/ABSTAIN held for a person to resolve, which routes it to a person rather
  than rejecting it). Any stronger action on a twin FAIL (auto-reject) waits for a twin v0.2 that clears K2 on fresh data.
