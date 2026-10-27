# Choices: the ledger of what a number depends on (engine 0.5.0)

A number computed from a table is a statement made from data. Between the table and the number sit choices the table does not
fix: the weights of a fit, which quality flags are honoured, a mass-to-light ratio, a units convention, the form of a model, the
exact algorithm, a tolerance, a selection. When a paper states them, the number replays. When it does not, a replay can only be a
range, and nobody can tell a wrong number from a different choice.

Engine 0.5.0 records them. Every declarative verdict lists the choices its checks depend on, and says for each one whether the
document stated it, who supplied it, or that nobody did.

## The ledger

| status | meaning |
|---|---|
| `stated` | the document states it: a value with a span (a page or a section, and the quote) |
| `supplied` | the document does not state it; the judge (`supplied_choices`) or the ruleset's default supplies it, named with its source |
| `unstated` | nobody states or supplies it: every check that depends on it abstains (`choice_unstated:`) |
| `not_applicable` | the ruleset says it does not apply to this kind of document, and why |

`counts.stated_rate` is stated / load-bearing. It is null, never 0, when no choice is load-bearing: nothing to state is not the
same as nothing stated. Choices enter the verdict's identity, so a verdict under other supplied values is another verdict.

## Why it exists

Four replays of published science found the same gap. A radial-acceleration fit replayed to 1.0989 against the published 1.20,
because the paper does not state its weights, and reasonable variants span 0.97 to 1.16. An ocean mixed-layer value replays exactly
when the floats' quality flags are honoured, and moves by up to 165 m when they are ignored. A galaxy's mass beyond its last
measured radius differs by 17-23% between two halo forms. A rotation curve's flat velocity replays only when the procedure is
pinned. Nobody lied in any of them. The choices were not recorded.

So the correction a reader asks for is often one sentence in a methods section: state the choice.

## How to use it

- A ruleset declares its slots (`choices`), a default for each slot it can supply, and the checks a slot governs when the engine
  cannot see the dependency. See [RULESETS.md](RULESETS.md), "Engine 0.5.0", for the keys and the lint.
- A claim document fills them at its top-level `choices`: `{ "value", "stated": true, "span": { "page" | "section", "quote" } }`,
  or `{ "unstated": true }` when it is silent.
- A judge may supply values (`verify <doc> --ruleset <r> --supplied-choices <file.json>`). They are part of the verdict's inputs, and
  a replay needs them.
- A check that evaluates a model past its measured support declares `support`; the engine reports it as counsel (`beyond_data`),
  never PASS or FAIL.
- A value's own quality flag (`qc` in its provenance) is read through a flags slot ([EVIDENCE.md](EVIDENCE.md), "Per-value quality
  flags").

## What it does not do

It does not judge a choice. A supplied value is not a wrong one, and a stated value is not a right one: the ledger says which is
which, and the checks run under it. It does not find choices a ruleset does not declare. A judge's values are not signed.
