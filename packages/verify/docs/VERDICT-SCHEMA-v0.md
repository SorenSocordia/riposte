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
  declared_accuracy? · ledger? (Stage 2) · action_context? (Stage 3) · channel? ('VERDICT'; v0.1, additive)
}
ClaimVerdict {
  claim_id ("document.TOTAL_INT", "line[3].MATH_INT") · kind (RECOMPUTE | QUOTE_MATCH | CROSS_REFERENCE | CONSISTENCY)
  tier · outcome · field · asserted · rule_id · rule_name
  computation? { formula, operands (by role), result, tolerance? }
  evidence: Evidence[] · insufficiency? · variance? · locked · explanation
}
Evidence { locator {kind:'field', source, path} | {kind:'span',…} · value · original? · normalizations? · confidence · role }
```

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
