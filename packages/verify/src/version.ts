/**
 * Single source of version truth for the verifier.
 *
 * Every verdict records ENGINE_VERSION and the RULESET it was evaluated under, so a verdict issued
 * today can be replayed and re-audited later against exactly the rules that produced it.
 * A test asserts ENGINE_VERSION === package.json.version. Rulesets version independently of the engine.
 *
 * 0.1.0 (2026-10-03): the declarative evaluator reads strictly by default. A field reported as null, "" or "UNREADABLE" is
 * unreadable, never a default, and a money, price or quantity string that is not strictly a number ("°225.0") is unreadable,
 * never coerced. A ruleset restores the old reading with `"distinguish_unreadable": false` and `"strict_numbers": false`
 * (declarative/types.ts). No other engine changed behaviour: their 0.1.0 verdicts differ from 0.0.1's only in engine_version
 * and verdict_id (which derives from it).
 *
 * 0.2.0 (2026-10-03, the red team's verify-side findings; CHANGELOG.md):
 *  - every verdict carries `remedy_table_hash`, the hash of the remedy table it was answered from, and its verdict_id derives
 *    from it too (protocol/verdict-id.ts), so two verdicts whose remedies differ never share an id;
 *  - the declarative evaluator holds a claim as SUSPECT when a value it could not read has a one-character reading under which
 *    the check FAILs (the gate books it as FAIL; a ruleset turns it off with `"held_suspect": false`);
 *  - identifiers are compared after NFKC with invisible format characters and every kind of space removed;
 *  - a number written with an ambiguous grouping ("1.234", "1,234", "1,23", "1 234") is unreadable unless the ruleset declares
 *    its `locale`, and an accepted one is read whole, never truncated;
 *  - a field reported under a key that differs from its path only by spaces or invisible characters is unreadable, never absent.
 * Verdicts that name 0.0.1 or 0.1.0 are re-performed exactly as those engines read.
 *
 * 0.3.0 (2026-10-03: the evidence ruling; CHANGELOG.md, docs/EVIDENCE.md):
 *  - strike and recompute: a declarative verdict lists what it computed, every struck load-bearing field (unreadable, suspect,
 *    withdrawn, unsupported-assertion, conflict) with its provenance, and the checks each struck field would unlock;
 *  - SUSPECT is a flag on a struck field, counted, never booked as a FAIL (HELD-SUSPECT is retired: 0.2.0 verdicts keep it);
 *  - evidence tiers E0-E4: every verdict states the evidence floor it rests on; an envelope field without provenance (E4) is
 *    struck, never load-bearing; an evidence overlay from arbitration moves (`options.evidence`) is part of the input;
 *  - every verdict, of every engine, ends with a generated `scope` block (verdict/scope.ts).
 * Verdicts that name 0.0.1, 0.1.0 or 0.2.0 are re-performed exactly as those engines read.
 *
 * 0.4.0 (2026-10-04: claims over tables; CHANGELOG.md, docs/RULESETS.md, docs/EVIDENCE.md). Additive, read only by
 * the declarative evaluator under this engine:
 *  - expressions gain sqrt(), median(), min(), max(), count() and filtered aggregates over named row sets (`row_sets`);
 *  - row checks read the row before or after (`prev(R)`, `next(R)`) and document values (`doc.R`);
 *  - named algorithms are pinned procedures (src/algorithms/, ruleset key `algorithms`), bound into the ruleset's identity;
 *  - an extraction-contract value may carry `archive` provenance (E1; `checksum_verified` only when the engine hashed the bytes).
 * A ruleset that uses none of them gives the verdict 0.3.0 gives, apart from engine_version, verdict_id and scope. Verdicts
 * that name 0.0.1, 0.1.0, 0.2.0 or 0.3.0 are re-performed exactly as those engines read.
 *
 * 0.5.0 (2026-10-04: the choice ledger; CHANGELOG.md, docs/CHOICES.md). Additive, read only by the declarative evaluator
 * under this engine:
 *  - a ruleset declares its choice slots (`choices`: weights, flags, ratio, units, model form, algorithm, tolerance, selection);
 *    a claim document states them with a quoted span, a judge supplies them, or the ruleset's default is supplied; a check that
 *    depends on a slot with no value abstains (`choice_unstated:`); every declarative verdict lists its choices, and `counts`
 *    states the stated rate (stated / load-bearing; null when nothing is load-bearing);
 *  - a check that evaluates a model past its measured support (`support`) is counsel (`beyond_data`), never PASS or FAIL;
 *  - a value's own quality flag (provenance `qc`) computes, holds or strikes it, as the ruleset's flags choice says (the Argo
 *    flag scale is the first scheme, src/schemes/);
 *  - archive bytes supplied as files (`archive_files`) are hashed, so a binary file (FITS) can reach checksum_verified;
 *  - the registry carries rar.fit@1, the weighted orthogonal-distance fit of the radial acceleration relation.
 * A ruleset that uses none of them gives the verdict 0.4.0 gives, apart from engine_version, verdict_id, scope, an empty
 * `choices` list and three null-or-zero counts. Verdicts that name 0.0.1 to 0.4.0 are re-performed exactly as those engines read.
 *
 * 0.6.0 (2026-10-05; CHANGELOG.md, docs/VERDICT-SCHEMA-v0.md, docs/REPLAY*.md). Every behaviour change of the
 * round is gated on this engine (engineAtLeast(v, '0.6.0')), so a verdict that names 0.0.1 to 0.5.0 is re-performed exactly as
 * those engines read and replays byte for byte:
 *  - a verdict carries a top-level `gate_status` (PASS, PASS_WITH_OPEN, FAIL, INSUFFICIENT_DATA): PASS_WITH_OPEN when every
 *    check that ran passed but some could not run; `outcome` keeps its meaning;
 *  - the hash contract refuses what it cannot hash faithfully: text input that is not valid UTF-8 and extraction JSON that
 *    holds a non-finite number are refused before hashing, never collapsed to U+FFFD or to null (this one is engine-independent:
 *    such an input never produced a faithful hash under any engine);
 *  - the other 0.6.0 changes are listed in CHANGELOG.md under 0.6.0.
 *
 * 0.7.0 (2026-10-13, release-pass): the emailed-bill path reads the sender from the address, payment-instruction sentences, partial bills and tax lines; approves name their path; near-number duplicates say similar, not same
 *
 * 0.7.1 (2026-10-13, release-pass): legal@0.5.3 is the default legal rule: a separate opinion's designation with a join clause, a view stated across sentences, the opinion's own quotations, running headers and citation clauses are read; a replay names the keys it does not check, the HTTP service refuses a request with no Host header, the ledger names a torn tail, invoice explanations are in words, and a sender domain with two letters swapped goes to a person
 *
 * 0.7.2 (2026-10-14, release-pass): the announced-change rule and the supply-house readings become the accounts-payable default (ap-threeway@0.3.0), legal@0.5.4 becomes the legal default, and the gate server's policy is the operator's
 */

export const ENGINE_VERSION = '0.7.2'

/**
 * Every engine version this build re-performs, oldest first (2026-10-03). A verdict names the engine that made it, and a
 * replay re-performs it under THAT version's behaviour, so a verdict issued before a minor change still replays byte for byte.
 * A later minor that changes an engine's behaviour keeps the earlier behaviour selectable here, or drops the version from this
 * list (and its verdicts then replay as structure only).
 */
export const ENGINE_VERSIONS = ['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.7.1', '0.7.2'] as const
export type EngineVersion = (typeof ENGINE_VERSIONS)[number]

/** True when this build re-performs verdicts made by engine `v`. */
export function isRetainedEngine(v: unknown): v is EngineVersion {
  return typeof v === 'string' && (ENGINE_VERSIONS as readonly string[]).includes(v)
}

/** True when engine `v` is `min` or later (both carried by this build). */
export function engineAtLeast(v: EngineVersion, min: EngineVersion): boolean {
  return ENGINE_VERSIONS.indexOf(v) >= ENGINE_VERSIONS.indexOf(min)
}

/**
 * The engine version a verdict is made under: this build's (ENGINE_VERSION) when none is asked for, else an earlier version
 * this build retains. An engine's `engine` option exists for replay: it re-performs a verdict under the version it names, and
 * the verdict it makes names that version. Throws on a version this build does not carry.
 */
export function engineFor(requested?: string): EngineVersion {
  if (requested === undefined) return ENGINE_VERSION
  if (isRetainedEngine(requested)) return requested
  throw new Error(`engine ${String(requested)} is not one this build carries (it carries ${ENGINE_VERSIONS.join(', ')})`)
}

/**
 * The default ruleset. 0.1.0 (2026-09-28): the rounding band is capped at what rounding can produce.
 * 0.0.1 stays resolvable as 'invoice@0.0.1' (src/rulesets/invoice/index.ts).
 */
export const RULESET = {
  id: 'invoice',
  version: '0.1.0',
  domain: 'invoice',
} as const

export const PAY_APP_RULESET_REF = {
  id: 'pay-app',
  version: '0.0.1',
  domain: 'pay-app',
} as const

export const SCHEMA_VERSION = 'v0' as const
