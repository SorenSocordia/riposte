# Remedies: what lawfully answers a FAIL or an ABSTAIN

Riposte answers PASS, FAIL or ABSTAIN. A FAIL or an ABSTAIN used to end there: the check said no, and a person had to work
out what would make it yes. Since 2026-10-02 every claim that does not PASS carries **typed remedies**, the lawful ways to
answer it, and any verdict can be **replayed** from its proof object with one command, remedies included.

## Where the idea comes from

The idea is borrowed from APPA (Kravchenko et al., *APPA: Recoverable Information-Flow Control for Real-World LLM Agents*,
arXiv 2607.24625, Archestra AI; the reference implementation, OpenAPPA, is MIT-licensed at
github.com/archestra-ai/OpenAPPA). APPA turns an agent's information-flow control from an abort-only barrier into a recovery
system. In the paper's words, "A failed check yields structured remedies—workflow prerequisites, call-scoped authority,
trusted transformations, or isolated sub-computations—rather than an opaque refusal." Its Theorem 5 states that when a
check fails, the only lawful state transitions are a committed effect, a call-scoped authority ruling, a registered
transformation (a cast), or a confined child branch.

We borrow the principles, not the code. The two systems sit at different moments:

- **APPA decides whether an agent may act.** It gates information flow before a tool call is dispatched, over security
  labels (who may read a value, how far it is trusted).
- **Riposte proves what it did.** It checks the truth of a decision after it is made, by recomputing it against the
  documents.

So Riposte's remedies are about **operands and authorities, not labels**. The mapping:

| APPA's transition | Riposte's remedy | the difference |
|---|---|---|
| a committed effect (a workflow prerequisite) | `missing-operand` | what is missing is a document or a value (a goods receipt, the contract, the previous pay application), not an effect token |
| a registered transformation or cast | `transform` | it changes how an operand is read (its unit, its field, whether tax is included), never a label; it must be registered |
| a call-scoped authority ruling | `authority` | bound to ONE verdict id and the exact rule ids; the role's mandate is the verdict's own authority remedies |
| a confined child branch | `recompute-with` | the operand is re-read or corrected and the check runs again: a NEW verdict, while the original stays on the record |
| (no transition) | `none` | nothing is declared: the finding stands |

## The type

```
Remedy {
  kind:       'missing-operand' | 'transform' | 'authority' | 'recompute-with' | 'none'
  operand?:   { source, role?, path? }     where the operand comes from (invoice, contract, goods_receipt, opinion, …)
  transform?: a registered transformation's name
  authority?: the role that may rule (its mandate: the rule ids in `clears`)
  detail:     what the remedy is, in words, with the claim's facts filled in
  clears:     the rule ids it could lawfully clear in this verdict
  claims:     the claim ids it answers
}
```

A verdict carries them in one top-level list, `remedies`, present exactly when some claim (or the verdict itself) is not
PASS. Each remedy answers one or more claims; identical remedies are merged, so "supply the contract" appears once and names
every line it would unlock. FAIL claims come first, then can't-tell claims, each in claim order. The order and the text are
deterministic: the same input gives the same remedies, byte for byte.

## The invariants

1. **A remedy never changes a verdict.** It is attached to the verdict. No outcome, claim, coverage or evidence is read
   differently because a remedy exists, and applying one (supplying the operand, re-reading it, transforming it) is a new
   check with a new verdict. A ruling changes nothing either: the FAIL stays on the record.
2. **The remedy table is bound to the verdict (engine 0.2.0, 2026-10-03).** The remedies themselves sit outside the hashed
   core, and a declarative ruleset's `remedy` declarations are removed from its input identity (`rulesetIdentity`). Through
   engine 0.1.0 that meant declaring or editing a remedy never moved an id. From engine 0.2.0 every verdict also carries
   `remedy_table_hash`, the sha256 of the table its remedies come from, and `verdict_id` derives from it as a fourth part, so
   a verdict answered from other remedy text is another verdict. The input hash is unchanged.
3. **Replay re-derives them, from the pinned ruleset.** A remedy is the engine's output, so a replay re-derives it and
   compares it byte for byte. When the inputs carry a declarative ruleset this build carries under the same id@version, its
   remedies must be that ruleset's: a bundle cannot bring its own remedy text. A verdict issued before remedies existed
   carries none; it replays on its core, and the replay reports the remedies this build derives, marked
   `remedies_not_carried`. A verdict of engine 0.2.0 always carries its remedies, so one without them diverges.
4. **A transform is registered.** It must be one of `REMEDY_TRANSFORMS` (below). Lint rejects any other name in a
   declarative ruleset, and a test holds every built-in table to it.
5. **An authority remedy is a mandate.** A role can rule only on the rule ids its authority remedies clear in that verdict.
   No authority remedy for a rule means no ruling can clear it.

**Decision: outside the hashed core, rather than a versioned id scheme.** A remedy is advice about a verdict, not part of
what was checked. Keeping it out of the id means every verdict, ruling and ledger entry issued before 2026-10-02 keeps its
identity. It is proven three ways:

- the frozen goldens (489 + 177 + the twin and AP pins) hash the core and were not re-pinned;
- a test pins every example verdict's core to the bytes the engine produced before remedies existed;
- a test switches remedies off and gets the earned-autonomy demo book back byte for byte.

The cost was that a remedy's text could change under the same verdict id. A replay then names the difference (for example
`remedies[0].detail`). Engine 0.2.0 closes it: the remedy table's hash is part of the id, so a verdict whose remedy text
changed is a different verdict, and a built-in remedy's text change moves the ids of the verdicts that engine issues.

**Engine 0.3.0 (V1b, 2026-10-03): a struck operand is answered by evidence.** An operand that was seen and not read is now a
struck field (docs/EVIDENCE.md). Its derived remedy is `missing-operand`, and its text names the field, its term, how it is
struck, and the lawful answer: "It is answered by evidence, never by a typed value: a CORRECT carrying the page or document that
prints it (the engine reads it), or a CORROBORATE from an independent source". Through engine 0.2.0 the text ended "Read it off
the document and run the check again". A verdict of an earlier engine keeps that wording when replayed. Declared remedies are
unchanged, and so is the remedy table each verdict binds.

## Registered transformations

| name | what it does | lawful only when |
|---|---|---|
| `declare-field-path` | maps the caller's field name to the role the rule reads (a recognized name, or a declarative `paths` entry); no value changes | the field found by fuzzy name-matching is in fact the operand the rule means |
| `declare-unit` | states the unit of a value that reads two ways: a percent as a whole number rather than a bare fraction, a currency, a reporting scale | the document or its producer states the unit; it is never guessed |
| `tax-inclusive-subtotal` | reads the subtotal as already including tax, so the tax is not added twice | the document states that its prices include tax |
| `cap-at-received` | bills only the received units (a partial payment), then runs the three-way match again | the payer's policy allows paying received units ahead of the rest |

The engine names these. It does not apply them: the caller (or a person) applies one and runs the check again.

## The built-in rulesets

Each table was written by reading what actually makes the rule fail.

- **Invoice** (`src/rulesets/invoice/axioms.ts`):
  - footing (`SUM_INT`, `TOTAL_INT`, `MATH_INT`) is answered by a re-read, or by an AP supervisor ruling to proceed on
    the document as stated;
  - a total off by its tax may be a tax-inclusive subtotal (a registered transform);
  - a tax mismatch outside one rate over the whole subtotal is a tax reviewer's call;
  - a rate over contract is the contract owner's call, or a contract amendment;
  - an amount over the cap is the budget owner's call, or an amendment;
  - an exact duplicate is the controller's call, and only if the earlier booking was voided or credited.
- **Pay application, AIA G702/G703** (`src/rulesets/pay-app/axioms.ts`):
  - every arithmetic law is answered by a correction, or by the certifier (the architect, on G702) certifying a
    corrected amount for that application;
  - overbilling past a line's scheduled value (`G703_CAP`) names a change order or a corrected application, **and no
    authority**: no ruling lawfully pays past the schedule;
  - continuity names the previous application as certified;
  - a bare percent names the `declare-unit` transform.
- **AP three-way match** (`src/ap/index.ts`):
  - billed but not received names a goods receipt for the missing units, the `cap-at-received` transform, or the buyer;
  - a price over tolerance names the buyer, or a PO change order;
  - a PO the invoice does not cite names a reissued invoice, or the buyer approving it as a non-PO invoice;
  - wrong line arithmetic or a total that does not add up names a re-read, or an AP supervisor;
  - a duplicate names the controller;
  - a line match too weak to check names the mapping.
- **Legal citations** (`src/legal/index.ts`):
  - a misquote is answered **only** by correcting the brief, because no ruling makes a quotation accurate;
  - a missing opinion names the opinion text;
  - a proposition without a quote names the quoted language, or the attorney of record;
  - a selective quote names the full passage, or the attorney of record;
  - a passage not found names the complete opinion text ("it may be fabricated");
  - under the opt-in `legal@0.1.0`, which reads quotation conventions (brackets, ellipses, quotation marks, "(cleaned
    up)"), a FAIL takes one of two forms. When the corresponding passage is found, the remedy is to conform the quotation
    to it. When only a nearest passage is found (a partial match), the remedy never says what the opinion reads: quote
    the passage exactly from wherever it comes, or withdraw it. A selective quote there may also be an ellipsis that
    omits a negation, or a bracket that adds or removes one;
  - under the opt-in `legal@0.2.0` (2026-10-03), a quotation whose bracket alters the opinion's words FAILs, and its remedy
    names the bracket and the word it replaced: restore the opinion's word, or keep only a bracket that changes case, tense
    or a pronoun. A selective quote there may also omit a condition, or drop or add inner quotation marks, and its remedy
    asks for the passage with what the quotation leaves out or changes.

A rule that declares nothing still answers. Its can't-tell takes the remedy its insufficiency implies:

| reason | remedy |
|---|---|
| `REFERENCE_NOT_PROVIDED` | `missing-operand`: the reference and the roles the rule needs from it |
| `FIELD_MISSING` | `missing-operand` per role (a computed role names why it could not be computed; under `distinguish_unreadable`, the engine 0.1.0 default for a declarative ruleset, with the field path and published term) |
| `UNPARSEABLE` | `recompute-with`: re-read the field. Under a declarative ruleset with `distinguish_unreadable` (R4, 2026-10-03; the default since engine 0.1.0, 2026-10-03, unless the ruleset says `false`), an unreadable operand is unresolved instead: `missing-operand` per operand, naming the role, its field path and published term, the value as reported (`null`, `"UNREADABLE"`, `"°20"`) or "no value was read", and the source line that prints it when the source text was supplied (`docs/RULESETS.md`) |
| `AMBIGUOUS_FIELD` | `transform` `declare-field-path` |
| `AMBIGUOUS_UNIT` | `transform` `declare-unit` |
| `AMBIGUOUS_REFERENCE` | `missing-operand`: the one reference entry that applies |
| `SPAN_NOT_FOUND` | `missing-operand`: the complete source text |
| `SELECTIVE_QUOTE`, `OUT_OF_RULESET_SCOPE` | `authority` `reviewer`: a person rules, for that verdict only |

Its FAIL says `none`. The action gate declares a small table: re-propose the call from its declared source, or an operator
approves that one call. Reconciliation and the two structured-twin judges use the derived remedies only.

A declarative ruleset declares its own, per check (`docs/RULESETS.md`).

## Authority rulings

An authority remedy names a role. That role's answer is a **ruling**, recorded on the receipt ledger:

```bash
riposte-ledger rule receipts.jsonl --verdict <verdict_id> --by buyer --decision allow \
  --note "agreed price uplift, PO change to follow" --key buyer.pem
```

- **Call-scoped.** It names one verdict id and the exact rule ids it covers. Without `--rules` it covers the role's whole
  mandate in that verdict, read from the ap_gate receipt on the ledger that carries the verdict (or `--verdict-file`).
- **Signed.** Ed25519 over a domain-separated body (`riposte:authority-ruling:v1`), so its signature is never valid as a
  verdict, a receipt or a dispute ruling. An unsigned ruling can be recorded; it is refused at the gate.
- **Never a waiver.** It covers that verdict and nothing after it. The same invoice under a new verdict, another vendor,
  or a later check is not covered.

`ap_gate` consumes a ruling only when all of these hold, and says why when one does not:

- it names this verdict (a ruling for verdict A never clears verdict B);
- its key is pinned for its role (`RIPOSTE_AUTHORITIES`, a JSON file mapping each role to its public keys);
- its rules are within the role's mandate in this verdict;
- it has not been consumed before (a ruling is spent once, so replaying the same invoice does not pay it twice).

What a ruling does at the gate:

- `deny` executes the hold, on the person's decision.
- `allow` executes the payment only when the model proposed to pay and the allowing rulings together cover every open
  rule of the verdict. Anything less stays in review, naming what is not covered.

No MCP tool writes a ruling. An agent holds no pinned key, so it cannot rule for itself.

An authority ruling is not the dispute ruling of `verify rule`. A dispute ruling decides whether a rule binds a document
(law), and it can become precedent. An authority ruling is a person's decision to act on one verdict despite its finding,
and it never becomes precedent.

## Replay

```bash
riposte-verify replay verdict.json --inputs inputs.json     # one verdict and its inputs
riposte-verify replay bundle.json                           # { "verdict", "inputs", "options"? } in one file
riposte-verify replay cases.jsonl                           # one bundle per line
riposte-verify replay cases/                                # a folder of bundle files
riposte-replay --ledger receipts.jsonl --entry 12           # the proof an ap_gate receipt carries (the plugin's bin)
```

Each case is re-performed with the deterministic engine: no model, no network, no service. It is then compared with the
presented verdict, byte for byte, remedies included (`issued_at` and post-engine annotations aside).

| result | what it means |
|---|---|
| **MATCH** | prints the answer (PASS, FAIL or ABSTAIN) and the remedies |
| **DIVERGED** | names the first differing field (`outcome`, `claims[0].explanation`, `remedies[1].authority`, `input_hash`, or `signature` for an altered envelope) |
| **NOT_REPERFORMED** | the binding holds, but there was nothing to re-perform it with (no inputs, another engine version) |
| **REFUSED** | not a bundle |

Exit codes:

| exit | when |
|---|---|
| 0 | every case MATCHes |
| 1 | a case DIVERGED |
| 2 | some cases were NOT_REPERFORMED |
| 3 | a case was REFUSED |

**On the frozen AP benchmark cases.** These are the 100 Distil Labs invoices, run through the production AP engine,
which includes the two disclosed wording rules. That makes this a determinism check, not an accuracy result: the published
blind result is unchanged and lives in `BENCHMARK-AP.md`. Verdicts issued by the engine before remedies existed were
replayed by the engine after:

- 100 of 100 MATCH;
- the 68 non-PASS verdicts get their remedies re-derived, marked not carried;
- every verdict id and every verdict core is unchanged (a test pins both over all 100);
- the same cases issued after the change also replay 100 of 100.

## What this is not

- A remedy does not make anything pass. It says what would answer the finding; the answer is a new check or a person's
  ruling on the record.
- The registered transformations are named, not applied by the engine.
- Role names (buyer, ap-supervisor, ap-controller, certifier, owner, contract-owner, budget-owner, tax-reviewer,
  attorney-of-record, reviewer, operator) are conventions. A deployment decides who holds each one by pinning their keys.
