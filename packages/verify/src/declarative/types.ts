/**
 * Declarative ruleset — a document type defined as DATA (JSON/YAML), not TypeScript.
 *
 * This is the "day-1 tunable" layer: a developer or an integrator's team teaches the engine a new document type by writing
 * one of these — field aliases, computed formulas, and checks — with no engine code. It also completes multilingual TAM:
 * any language the built-in alias tables miss, the caller supplies here (`paths`) in one line. The numbers already fold
 * universally; only field NAMES are locale-specific, and here they're just data.
 *
 * Roles are arbitrary strings (NOT the fixed UniversalRole enum) — the declarative path is enum-free by design.
 * Output is the SAME Verdict proof object as the built-in rulesets: per-claim PASS / FAIL / INSUFFICIENT_DATA, provenance,
 * deterministic id, replayable. Honesty rules apply: a missing field abstains (FIELD_MISSING); an unparseable one abstains
 * (UNPARSEABLE); within-tolerance is rounding, not error.
 */

import { normalizeDeclaration, type RemedyDeclaration, type RuleRemedies } from '../verdict/remedy.js'
import { remedyTableHashOf } from '../protocol/verdict-id.js'
import { algorithmPin } from '../algorithms/index.js'

export interface DeclField {
  /** Candidate paths, most-preferred first. Dot notation + `[n]` indices. For a `line` field, paths are relative to each line object. */
  paths: string[]
  /** A compiled field's term key (2026-10-03, T2; documentation): e.g. "BT-115", "BT-115/@currencyID", "sum:BT-136". */
  term_key?: string
  /** Set by `verify compile-ruleset --diff` on a field a person changed after it was compiled (documentation). */
  hand_edited?: boolean
  /**
   * How the value normalizes. Default 'amount' (currency). 'rate' = a fraction; 'quantity' = a count; 'string' = text (recorded, not compared).
   * Added 2026-09-24 (additive; existing rulesets are unaffected):
   *   'bool'       = true/false → 1/0 in expressions (also accepts 1/0 and "true"/"false"/"yes"/"no"). This lets a check
   *                  gate on a flag, e.g. `sum(AMT) + FREIGHT * FREIGHT_ALLOWED`. Anything else is UNPARSEABLE.
   *   'identifier' = an id or a list of ids (e.g. PO numbers), normalised by removing whitespace and upper-casing. Only
   *                  usable in a `compare: 'identifier'` check, never in arithmetic.
   * Added 2026-09-28 (additive):
   *   'price'      = a unit price at full precision. 'amount' rounds to the cent, but a unit price legitimately carries
   *                  more decimals (EN 16931 sets no decimal limit on BT-146; KSeF FA(3) allows 8 on P_9A). A JSON
   *                  number is taken exactly, and so is a plain decimal string ("3.335"). Any other string goes through
   *                  the amount parser, and if that parser would have to round it, the value is UNPARSEABLE, never
   *                  rounded. Like 'quantity', a price is not a rounding-inference operand.
   *                  Engine 0.2.0 (2026-10-03): a price, amount or quantity written as text is read whole first
   *                  (unreadable.ts readNumberTextV020): an unambiguous formatted string ("€1,234.567") is read exactly,
   *                  and an ambiguous grouping ("3.335", "1,23") is unreadable unless the ruleset declares its `locale`.
   */
  kind?: 'amount' | 'rate' | 'quantity' | 'string' | 'bool' | 'identifier' | 'price'
  /** True = a per-line field (resolved once per item in the line array). Default false = a document-level field. */
  line?: boolean
  /** Value to use when the field is ABSENT (e.g. an optional allowance/charge that is 0 when omitted). If unset, an absent field abstains. */
  default?: number

  // ── Added 2026-10-03 (additive: a field without them behaves exactly as before) ──────────────────────────────────
  /**
   * The labels a rendered document prints this field under ("Amount due for payment", "Paid amount"). Read only when
   * absent-vs-unreadable is on (`distinguish_unreadable`; the default from engine 0.1.0 (2026-10-03), unless the ruleset
   * says false) AND the caller supplies the source text: a document field that is absent from
   * the extraction while one of its labels heads a line of the source is UNREADABLE (the row is printed; its value was not
   * read), so its `default` does not apply and the checks that read it abstain. Document fields only. A label heads a line
   * when the line, whitespace collapsed and case folded, starts with it and the next character is not a letter or digit;
   * a line whose rest is lower-case words with no digit ("Document allowances and charges") is a heading, not the row.
   * The match can only move a check toward ABSTAIN, never toward PASS or FAIL.
   */
  labels?: string[]
  /** The published term the field binds, e.g. "BT-115 Amount due for payment (cac:LegalMonetaryTotal/cbc:PayableAmount)". Documentation; an unreadable operand's remedy names it. */
  term?: string

  // ── Added 2026-10-03 (additive: a field without it behaves exactly as before) ─────────────────────────────────
  /**
   * A LIST field: a document field read from EVERY element of an array, e.g. every VAT breakdown row's tax amount. `each`
   * lists the candidate paths of the array (the first that is an array wins); `paths` are relative to each element. A list
   * field is used only through `sum(ROLE)`, which sums every element and is unknown when an element did not read (a partial
   * sum would lie). Not a line field. An element that is reported but whose value is absent, null, blank or unreadable is an
   * unresolved element: the check abstains naming it, or FAILs if the check lists the role in `fail_if_unreadable`.
   */
  each?: string[]
}

export interface DeclCheck {
  /** Rule code, e.g. "SUM_INT". Prefixed with scope to form the claim id ("document.SUM_INT" / "line[2].MATH_INT"). */
  code: string
  name?: string
  /** Left-hand expression (roles, numbers, + - * /, parens, `sum(ROLE)`, `abs(x)`). The STATED figure by convention. */
  left: string
  op: '=' | '<=' | '>=' | '!='
  /** Right-hand expression (the expected/reference value). */
  right: string
  /** Absolute tolerance floor for this check. Default 0.01. */
  tol?: number
  /** 'document' (default) or 'line' (evaluated once per line item). */
  scope?: 'document' | 'line'
  /** The caller-vocabulary field this check is "about" (for the verdict). */
  field?: string
  /**
   * 'number' (default) = numeric comparison of the two expressions. 'identifier' (added 2026-09-24) = `left` and `right`
   * each NAME one 'identifier' field (no expressions). `=` holds iff the two normalised id SETS are equal: a single id
   * equals a single id, and a cited-ids list equals {the PO's number} only if it cites exactly that one number. `!=`
   * is the negation. Only '=' and '!=' are valid. The claim is a CROSS_REFERENCE.
   * From 2026-10-03 (T2, additive) an identifier check may carry `alternatives` (forms of two identifier fields, chosen by
   * what is present, never by outcome), so "A or B must be present" is `A = A` with the alternative `B = B`.
   * 'member' (added 2026-10-03, T2; the standards compiler) = `left` NAMES one 'identifier' or 'string' field and `in` lists
   * the codes it may take: `=` holds iff every value of the field is one of them, `!=` iff none is. Values and codes are
   * compared as a schematron code list compares them: NFKC, format characters removed, whitespace collapsed and trimmed, a
   * value with an inner space never matches, and case is kept. `right` is documentation (e.g. which list). The claim is a
   * CONSISTENCY claim; an absent field abstains (FIELD_MISSING), an unreadable one abstains (UNPARSEABLE).
   */
  compare?: 'number' | 'identifier' | 'member'
  /** compare: 'member': the codes the field may take (2026-10-03, T2). */
  in?: string[]

  // ── Added 2026-10-03 (T2, the standards compiler; documentation only, never evaluated, hashed with the ruleset) ─────
  /** How the compiled check reads the standard more narrowly (or differently) than its assert, e.g. `presence-abstains`. */
  narrowing?: string[]
  /** Where a compiled check came from: the schematron file, its sha256, the line, pattern, rule context, assert id, flag, test and text. */
  source?: { file: string; sha256: string; line: number; pattern_id?: string; rule_context?: string; assert_id: string; flag?: string; test?: string; text?: string }
  /** The compiler and version that wrote the check, and the class it compiled it as. */
  compiled_from?: { compiler: string; class?: string; [k: string]: unknown }
  /** Set by `verify compile-ruleset --diff` on a check a person changed after it was compiled. */
  hand_edited?: boolean

  // ── Added 2026-09-24 (additive: a check that uses none of these behaves exactly as before) ─────────────────────────
  /**
   * Fallback FORMS of the same identity, tried in order after the primary `left`/`right`. The first form whose REQUIRED
   * operands (roles written without `?`) are all present is the one evaluated; `op`, `tol`, guards and rounding are
   * shared. Use it to pair concepts consistently (e.g. comprehensive income including NCI with ProfitLoss, else the
   * parent's with NetIncomeLoss) or to prefer a reported total over the sum of its parts. Forms are chosen by what is
   * PRESENT, never by which one passes. If no form is applicable the check abstains (FIELD_MISSING, naming what each
   * form lacks). Numeric checks only.
   */
  alternatives?: { left: string; right: string }[]
  /** Abstain (OUT_OF_RULESET_SCOPE) when ANY of these roles is reported, i.e. an item the identity does not model is present. */
  abstain_if_present?: string[]
  /** Abstain (FIELD_MISSING, or UNPARSEABLE) unless EVERY one of these roles is reported. */
  abstain_unless_all_present?: string[]
  /** Abstain (OUT_OF_RULESET_SCOPE) when ANY condition holds. A condition whose required operands are absent does not fire. */
  abstain_if?: DeclCondition[]
  /** Per-check override of the ruleset's `tolerance.rounding` ('infer' | 'none'). Numeric checks only. */
  rounding?: RoundingMode

  // ── Added 2026-09-28 (additive: a check that uses neither behaves exactly as before) ─────────────────────────────
  /**
   * DECLARED ABSTENTION. When set, the check never decides: on every document (on every line, for a line check) it
   * abstains with reason OUT_OF_RULESET_SCOPE, and the detail is `declared abstention: <this text>`. Use it for an
   * identity the ruleset author cannot source from the governing spec. The gap then shows in every verdict instead of
   * being guessed at or silently dropped. `left`/`right` are still linted, so the check documents its candidate identity.
   */
  abstain?: string
  /** Why the check's guards exist, e.g. the cited source. When any guard fires, this text is appended to its detail. */
  guard_reason?: string

  // ── Added 2026-09-28 by E-INVOICE-2 (additive: a check that does not use it behaves exactly as before) ────────────
  /**
   * Abstain (OUT_OF_RULESET_SCOPE) when `present` is reported but `without` is not. It is for a list of items whose
   * stated total the identity uses in their place, since the engine does not sum a nested list: e.g. KSeF `Obciazenia`
   * (the charge items) reported without `SumaObciazen` (their stated sum). A `default` value does not count as reported
   * for either role, and a `without` that is present but unparseable does not satisfy the guard.
   */
  abstain_if_present_without?: { present: string; without: string }[]

  // ── Added 2026-10-02 (additive: typed remedies; verdict/remedy.ts, docs/REMEDIES.md) ──────────────────────────────────
  /**
   * What lawfully answers this check when it does not PASS: `{ fail: [...], abstain: [...] }`, or a bare remedy / list of
   * remedies (read as FAIL remedies). Each is `{ kind, detail, operand?, transform?, authority?, when? }`; `transform` names a
   * registered transformation, `when` filters ABSTAIN remedies by insufficiency reason, and `detail` may name the claim's
   * facts in braces ({asserted} {expected} {variance} {field} {line} {missing} {op:ROLE}). It never changes the verdict and is
   * NOT part of the ruleset's input identity (rulesetIdentity below): declaring or editing one never moves a verdict_id.
   * A check without one gets the remedies its claims' insufficiency implies, and `none` on a FAIL.
   */
  remedy?: RemedyDeclaration

  // ── Added 2026-10-03 (additive: a check without it behaves exactly as before) ────────────────────────────────────
  /**
   * APPLICABILITY, decided BEFORE the missing-field test. Every condition must hold for the check to apply. When one does
   * not, the check is NOT APPLICABLE on this document (or line): no claim is made, and the verdict lists it under
   * `not_applicable` with the condition that ruled it out. Use it for a blank a form does not have: a final lien-waiver form
   * has no Through Date, so the Through Date check does not apply to it, instead of abstaining FIELD_MISSING.
   * When a condition cannot be evaluated (its field is not reported, or does not parse), applicability is unknown and the
   * check ABSTAINS (FIELD_MISSING / UNPARSEABLE, naming that field): a check is never skipped on a guess.
   */
  applies_if?: DeclApplicability[]

  // ── Added 2026-10-03 (additive: a check without them behaves exactly as before) ──────────────────────────────
  /**
   * The tolerance, exactly: the difference of the two sides is rounded to 9 decimal places before it is compared with `tol`,
   * so a difference of exactly `tol` holds and anything above it does not (floating point would otherwise fail 50.02 − 50 at
   * tol 0.02). Such a claim skips the relative band and rounding inference: its `tol` is final.
   */
  exact_tolerance?: boolean
  /**
   * Roles whose unreadability FAILs the check instead of abstaining (e.g. a VAT breakdown row reported without a readable tax
   * amount: the standard's sum cannot hold over a row nobody can read). The FAIL names each unreadable operand and what was
   * reported. Every other unresolved operand abstains as usual.
   */
  fail_if_unreadable?: string[]
  /**
   * ADVISORY: the check never makes a claim. When it would FAIL, the verdict carries an `advisories` entry (counsel, never a
   * verdict): the outcome, the coverage and the gate are unchanged. When it holds or cannot run, nothing is said. `false` (or
   * absent) is an ordinary check.
   */
  advisory?: boolean

  // ── Added 2026-10-04 (engine 0.5.0; read only under engine 0.5.0) ─────────────────────────────────────────────────
  /**
   * THE MEASURED SUPPORT of a check that evaluates a model, a fit or an extrapolation: `field` is the point the model is evaluated
   * at (a role or an expression in the check's scope), `max_of` the measured support (a line field or line-computed role). When
   * the point lies past the largest measured value (field > max over the rows of max_of), the check makes no claim: the verdict
   * carries an advisory with `beyond_data: true` and the computed values, never PASS or FAIL. A point that cannot be evaluated
   * makes the check abstain.
   */
  support?: { field: string; max_of: string }
}

/**
 * A choice slot (engine 0.5.0, 2026-10-04: the choice ledger; docs/CHOICES.md). Every free choice a number depends on
 * that the data does not fix: fit weights, which quality flags are honoured, a mass-to-light ratio, a units convention, a model
 * form, the exact algorithm, a tolerance, a selection. The claim document states it (a value with a quoted span), the judge
 * supplies it (`supplied_choices`), or the ruleset's `default` is supplied; with none of them the slot is unstated and every
 * check that depends on it abstains (`choice_unstated:`). A numeric value is a document-scope role named by `id` (read
 * directly by a document check, as `doc.ID` in a row); an algorithm slot is linked from the `algorithms` block (`choice`) and
 * algorithm parameters come from slots (`params`); a flags slot is the policy for values' own quality flags (provenance `qc`).
 */
export interface DeclChoice {
  id: string
  kind: 'weights' | 'flags' | 'ratio' | 'units' | 'model_form' | 'algorithm' | 'tolerance' | 'selection'
  /** the number depends on it: it counts toward the stated rate, and a check that depends on it abstains while it has no value */
  load_bearing: boolean
  /** the value supplied when the document states none and the judge supplies none, and where that value comes from */
  default?: { value: number | string | Record<string, unknown>; source: string }
  /** the slot does not apply to this kind of document, and why (status `not_applicable`; never load-bearing, never a default) */
  not_applicable?: string
  /** the checks that depend on the slot where the engine cannot see it (a selection, a model form), by code */
  governs?: string[]
  /** what the choice is, in words (documentation; hashed with the ruleset) */
  name?: string
}

/** A claim document's fill for one slot (the input's top-level `choices`, engine 0.5.0): stated with a span, or marked silent. */
export type ChoiceFill =
  | { value: number | string | Record<string, unknown>; stated: true; span: { page?: number; section?: string; quote: string } }
  | { unstated: true }

/** A value the judge supplies for a slot (option `supplied_choices`, engine 0.5.0), with where it comes from. */
export interface SuppliedChoice { value: number | string | Record<string, unknown>; source: string }

/**
 * One applicability condition (DeclCheck.applies_if, DeclQuote.applies_if):
 *   { left, op, right, tol? }      a numeric condition over roles (bool fields read 1/0), as `abstain_if`
 *   { field, in: [...] }           an 'identifier' or 'string' field's value is one of these (every id, for a list)
 *   { field, not_in: [...] }       ... is none of these
 *   { field, present: true }       the field is reported (added 2026-10-03, T2): absent → the check does not apply; reported but
 *                                  unreadable → applicability is unknown and the check abstains. A `default` does not count as reported.
 *   { any_present: [f, …] }        at least one of these fields is reported (2026-10-03, T2): how a rule over an optional group
 *                                  applies only when the group is there. None reported → does not apply; none reported but
 *                                  one unreadable → unknown, the check abstains.
 *   { neighbour: 'prev' | 'next' }  engine 0.4.0 (2026-10-04), row checks only: the row has a row before (after) it. On
 *                                  the first (last) row the check does not apply and is listed under `not_applicable`, so a check
 *                                  that reads prev(R) or next(R) says it is about pairs of rows instead of abstaining on the edge.
 * Identifier values compare as identifiers do (whitespace, case and punctuation folded; see normIdentifierKey).
 */
export type DeclApplicability = DeclCondition | { field: string; in: string[] } | { field: string; not_in: string[] } | { field: string; present: true } | { any_present: string[] } | { neighbour: 'prev' | 'next' }

/**
 * A role computed by a named algorithm (engine 0.4.0, 2026-10-04; src/algorithms/): `algorithm` is a registry ref
 * (`sparc.vflat@1`), `inputs` maps each of the algorithm's input names to a line field or line-computed role (one value per row,
 * in row order), and `output` names which output the role takes (default: the algorithm's primary output). The role is a
 * document-scope value, read like a computed role (and through `doc.` in a row check).
 */
export interface DeclAlgorithm {
  algorithm: string
  inputs: Record<string, string>
  output?: string
  /**
   * Engine 0.5.0: the algorithm choice slot this role computes for. When the slot's value names another procedure than
   * `algorithm`, the role has no value (`choice_mismatch:`): the engine never computes another procedure in the document's name.
   */
  choice?: string
  /** Engine 0.5.0: the algorithm's parameters, each from a choice slot (parameter name → slot id), so each is on the ledger. */
  params?: Record<string, string>
}

/**
 * A passage the source document must contain VERBATIM (added 2026-10-03): checked only when the caller supplies the
 * source text (`verify(..., { source: { text } })`, CLI `--source`). Each becomes a QUOTE_MATCH claim `source.<id>`, the same
 * claim verify's source-text axis makes for a caller's quote. Without the source text, no quote claim is made and the
 * verdict says the source was not supplied (`references.source: false`).
 */
export interface DeclQuote {
  id: string
  /** the exact words (whitespace runs are collapsed on both sides; nothing else is normalized) */
  quote: string
  label?: string
  /** document-scope applicability, as DeclCheck.applies_if (e.g. the passage belongs to one statutory form only) */
  applies_if?: DeclApplicability[]
  /** remedies for this passage's claim, as DeclCheck.remedy (rule id QUOTE_MATCH is shared, so they are keyed by quote id) */
  remedy?: RemedyDeclaration
}

/**
 * The ruleset as a verdict's input identity binds it: every check's `remedy` removed (2026-10-02). A remedy never changes a
 * verdict, so it never moves a verdict_id. A ruleset that declares no remedy is returned as it is, so its bytes and every
 * verdict_id issued under it are unchanged.
 */
export function rulesetIdentity<R extends DeclarativeRuleset>(rs: R): R {
  const hasRemedy = (x: unknown): boolean => x !== null && typeof x === 'object' && 'remedy' in x
  const checksCarry = Array.isArray(rs.checks) && rs.checks.some(hasRemedy)
  const quotesCarry = Array.isArray(rs.quotes) && rs.quotes.some(hasRemedy)
  const algorithms = algorithmsIdentity(rs)
  if (!checksCarry && !quotesCarry && algorithms === undefined) return rs
  const strip = <T>(c: T): T => {
    if (!hasRemedy(c)) return c
    const { remedy: _r, ...rest } = c as T & { remedy?: unknown }
    return rest as T
  }
  return {
    ...rs,
    ...(checksCarry ? { checks: rs.checks.map(strip) } : {}),
    ...(quotesCarry ? { quotes: rs.quotes!.map(strip) } : {}),
    ...(algorithms !== undefined ? { algorithms } : {}),
  }
}

/**
 * Engine 0.4.0 (2026-10-04): the `algorithms` block as the ruleset's identity binds it. Each entry carries the pin of the
 * algorithm it names (src/algorithms algorithmPin: the ref, the implementation sha256, the source's hashes), so a verdict's
 * input_hash, and so its verdict_id, moves when the procedure's implementation or quoted source does. Undefined for a ruleset
 * without the block, so every other ruleset's identity is exactly what it was.
 */
function algorithmsIdentity(rs: DeclarativeRuleset): Record<string, unknown> | undefined {
  const block = (rs as { algorithms?: unknown }).algorithms
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return undefined
  const out: Record<string, unknown> = {}
  for (const [role, spec] of Object.entries(block as Record<string, unknown>)) {
    out[role] = spec !== null && typeof spec === 'object' && !Array.isArray(spec)
      ? { ...(spec as object), pin: algorithmPin(String((spec as { algorithm?: unknown }).algorithm)) }
      : spec
  }
  return out
}

/**
 * The ruleset's remedy table (engine 0.2.0, 2026-10-03): every declared remedy, normalized as the evaluator reads it, keyed by
 * check code (the first check of a code, as the evaluator reads it) and by quote claim id. A verdict issued by engine 0.2.0
 * carries the sha256 of this table (`remedy_table_hash`, = remedyTableHash below) and its verdict_id derives from it, so the
 * remedies a verdict hands back are bound to it. A replay, or a closed loop, re-derives the table from the ruleset it pinned
 * and compares; a bundle's own remedy text is never trusted.
 */
export function remedyTableOf(rs: DeclarativeRuleset): { checks: Record<string, RuleRemedies>; quotes: Record<string, RuleRemedies> } {
  const checks: Record<string, RuleRemedies> = {}
  const seen = new Set<string>()
  for (const c of Array.isArray(rs.checks) ? rs.checks : []) {
    if (!c || typeof c.code !== 'string' || seen.has(c.code)) continue
    seen.add(c.code)
    const d = normalizeDeclaration(c.remedy)
    if (d) checks[c.code] = d
  }
  const quotes: Record<string, RuleRemedies> = {}
  for (const q of Array.isArray(rs.quotes) ? rs.quotes : []) {
    if (!q || typeof q.id !== 'string') continue
    const d = normalizeDeclaration(q.remedy)
    if (d) quotes[q.id.startsWith('source.') ? q.id : `source.${q.id}`] = d
  }
  return { checks, quotes }
}

/** sha256 of the ruleset's remedy table (remedyTableOf): what an engine 0.2.0 verdict carries as `remedy_table_hash`. */
export function remedyTableHash(rs: DeclarativeRuleset): string {
  return remedyTableHashOf(remedyTableOf(rs))
}

/** A guard condition: `left op right`, compared exactly unless `tol` is given. */
export interface DeclCondition {
  left: string
  op: '=' | '!=' | '<' | '<=' | '>' | '>='
  right: string
  /** Absolute tolerance for the comparison. Default 0 (exact). */
  tol?: number
}

/**
 * 'none' (default) = the existing policy: the check's `tol` floor, plus the relative band applied by `applyTolerancePolicy`.
 * 'infer' (added 2026-09-24) = rounding-aware: per check and document, the reporting unit U is the largest of
 * {1, 1 000, 100 000, 1 000 000} that divides every operand, and the tolerance is
 *   max(tol floor, rel × the largest |operand|, U × the number of operands)
 * where "operands" are the amount-kind values the evaluated form actually uses as reported (optional terms that are
 * absent, `default` values, and bool/rate/quantity fields are not operands; computed roles are expanded into theirs; a
 * `sum(ROLE)` contributes every line's value). If no candidate unit divides every operand (e.g. amounts with cents), the
 * unit term is 0. `absCap`, if > 0, caps the relative term only. The relative band is NOT applied a second time.
 */
export type RoundingMode = 'none' | 'infer'

export interface DeclarativeRuleset {
  id: string
  version: string
  name?: string
  domain?: string
  /** Candidate keys for the per-line array, first that is an array wins. Default ['line_items']. */
  lineArrayKeys?: string[]
  /** roleName → field spec. */
  fields: Record<string, DeclField>
  /** roleName → expression (may use `sum(ROLE)` over line fields). Evaluated after fields are bound. */
  computed?: Record<string, string>
  /** The checks. */
  checks: DeclCheck[]
  /**
   * Rounding-tolerance policy (relative band + optional absolute cap). Default { rel: 0.0003, absCap: 0 }.
   * `rounding: 'infer'` (added 2026-09-24) switches every numeric check to the rounding-aware tolerance (see RoundingMode).
   */
  tolerance?: { rel: number; absCap: number; rounding?: RoundingMode }
  /**
   * The primary sources the ruleset cites, as key → URL (added 2026-09-28). Check names refer to the keys. This is
   * documentation only: it is hashed with the ruleset and never evaluated.
   */
  sources?: Record<string, string>
  /** Passages the source document must contain verbatim, checked when the source text is supplied (added 2026-10-03). */
  quotes?: DeclQuote[]
  /**
   * ABSENT vs UNREADABLE (added 2026-10-03). Since engine 0.1.0 (2026-10-03) it is ON unless the ruleset says
   * `false`; under engine 0.0.1 it was on only when `true`, and a verdict that names 0.0.1 is still re-performed that way.
   * An absent field is one the document does not carry; an unreadable one is printed but could not be read. Only the first
   * may take a `default`. When on:
   *  - a field reported as null, an empty string, or the marker "UNREADABLE" (any case) was seen and could not be read. It is
   *    an unresolved operand: the checks that read it abstain (UNPARSEABLE), and its `default` never applies. So two
   *    unreadable totals can never cancel into a PASS;
   *  - with the source text, a document field absent from the extraction whose `labels` head a source line is unreadable too;
   *  - an unreadable operand's remedy is `missing-operand`, naming the field (role, path, `term`), the value as reported, and
   *    the source line that prints it; an abstention names every unreadable operand of the check, not only the first.
   * Absent with no label in the source (or with no source text at all) stays absent, and an optional total takes its
   * `default`, as EN 16931 reads an omitted BT-107 / BT-108 / BT-113 / BT-114 (the CEN schematron's BR-CO-13 and BR-CO-16
   * treat a missing one as 0). An extractor that drops a printed value without saying so is invisible here unless the
   * source text shows the label.
   * `false` restores the 0.0.1 reading: null and "" are absent (the default applies), labels are not read, and an
   * abstention names the first unparseable operand only.
   */
  distinguish_unreadable?: boolean
  /**
   * STRICT NUMBER READING (added 2026-10-03; engine 0.1.0). ON unless the ruleset says `false`: a money, price or
   * quantity string must read strictly as a number (digits in any script, digit grouping, one decimal part, a currency symbol
   * or a three-letter code before or after, a sign, a trailing minus or parentheses), else it is unparseable and the checks
   * that read it abstain. `"°225.0"`, `"1,2?5.00"` and `"E 2O"` are never coerced into numbers. `false` restores the
   * general normalizer's lenient reading (it strips what it takes for currency marks: `"°225.0"` → 225). Under engine
   * 0.0.1 this key is not read: strict reading followed `distinguish_unreadable === true`. JSON numbers are never affected.
   */
  strict_numbers?: boolean
  /**
   * THE EXTRACTION CONTRACT (added 2026-10-03, T1; engine 0.1.0; OFF unless `true`). With it, verify reads only an
   * extraction-contract envelope (src/extract, docs/EXTRACTION-CONTRACT.md) that validates against this ruleset's generated
   * schema (`verify extract-schema <ruleset>`): every field term of `fields` read with its provenance {page, line, raw,
   * reader} or named in `not_printed`, "UNREADABLE" with its readings for a value that could not be read, and no unknown term.
   * Anything else is refused: no check runs, the verdict is INSUFFICIENT_DATA, and a typed remedy names the first
   * violation. Without the flag an envelope is still accepted (lowered to the fields' first paths) and nothing is enforced.
   * Under engine 0.0.1 this key is not read, and an envelope is not lowered, so every 0.0.1 verdict keeps its bytes.
   */
  require_contract?: boolean

  // ── Added 2026-10-03 (additive: a ruleset without them behaves exactly as before) ─────────────────────────────
  /**
   * Per-line computed roles: role → an expression over this line's fields (and earlier line-computed roles), evaluated on every
   * line. Usable in a line check, and at document scope through `sum(ROLE)`. Unknown on a line where an operand is absent or
   * unreadable, which makes the sum unknown.
   */
  line_computed?: Record<string, string>
  /**
   * HELD-SUSPECT (engine 0.2.0). On by default: when a claim cannot run because a value was reported as a string that does not
   * read as a number, and a reading of that string one character away (one deletion, substitution or insertion of 0-9 . ,)
   * FAILs the check, the claim is held as suspect and the gate books it as a FAIL (verdict/aggregation.ts). `false` keeps every
   * such claim a plain hold (PASS-WITH-OPEN at a gate). Under engines 0.0.1 and 0.1.0 this key is not read.
   */
  held_suspect?: boolean
  /**
   * How numbers are written in this ruleset's documents (engine 0.2.0): the decimal mark and the grouping mark, or one of the
   * tags `en` (. and ,), `de` (, and .), `fr` (, and a space), `ch` (. and '). Without it, a number whose grouping is
   * ambiguous ("1.234", "1,234", "1,23", "1 234") is unreadable, never guessed. With it, a number is read with exactly those marks,
   * and one written otherwise is unreadable. Under engines 0.0.1 and 0.1.0 this key is not read.
   */
  locale?: DeclLocale

  // ── Added 2026-10-03 (T2, the standards compiler; documentation only, never evaluated, hashed with the ruleset) ─────
  /**
   * How a compiled ruleset was made: the compiler and its version, every input with its sha256 (the schematrons, the
   * structure, an alias file), the per-file counts by class, the compile report's sha256, and `hand_edits` (what a person
   * changed after compiling, written by `verify compile-ruleset --diff`). See docs/COMPILER.md.
   */
  compiled_from?: { compiler: string; compiler_version: string; hand_edits?: unknown[]; [k: string]: unknown }

  // ── Added 2026-10-04 (engine 0.4.0; read only under engine 0.4.0, so a ruleset without them keeps its bytes) ──────
  /**
   * Named row sets: name → conditions (the shapes of `applies_if`), evaluated on each row. A row is in the set when every
   * condition holds; when one cannot be evaluated the row's membership is unknown, and so is every aggregate over the set. Used
   * as the second argument of an aggregate: `median(VOBS, OUTER)`, `count(RAD, OUTER)`, `sum(AMT, OUTER)`. A condition reads the
   * row's fields and line-computed roles, and document fields through `doc.`.
   */
  row_sets?: Record<string, DeclApplicability[]>
  /** Roles computed by named, pinned algorithms (src/algorithms/): role → { algorithm, inputs, output? }. See DeclAlgorithm. */
  algorithms?: Record<string, DeclAlgorithm>
  /**
   * The provenance kinds the generated extraction schema accepts (extract/schema.ts): `page` (the default, always) and `archive`
   * (a value read from a file an archive serves: url, retrieval time, content sha256, the archive's own checksum when it publishes
   * one; docs/EVIDENCE.md). Without `archive` here the schema is exactly what it was. Read by the schema only: the evaluator
   * accepts archive provenance in any envelope under engine 0.4.0.
   */
  provenance_kinds?: ('page' | 'archive')[]

  // ── Added 2026-10-04 (engine 0.5.0; read only under engine 0.5.0, so a ruleset without it keeps its bytes) ──────────
  /** The choice slots (DeclChoice): every free choice the checks' numbers depend on, each stated, supplied or unstated. */
  choices?: DeclChoice[]
}

/** A declared number format (DeclarativeRuleset.locale): the marks, or a tag naming them. */
export type DeclLocale = 'en' | 'de' | 'fr' | 'ch' | { decimal: '.' | ','; group: ',' | '.' | ' ' | "'" | '' }

/** A value is a declarative ruleset if it declares fields + checks and does NOT carry the built-in ruleset's compute(). */
export function isDeclarativeRuleset(x: unknown): x is DeclarativeRuleset {
  return !!x && typeof x === 'object' && !('compute' in (x as object))
    && typeof (x as DeclarativeRuleset).fields === 'object' && Array.isArray((x as DeclarativeRuleset).checks)
}
