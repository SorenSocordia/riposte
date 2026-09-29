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

export interface DeclField {
  /** Candidate paths, most-preferred first. Dot notation + `[n]` indices. For a `line` field, paths are relative to each line object. */
  paths: string[]
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
   */
  kind?: 'amount' | 'rate' | 'quantity' | 'string' | 'bool' | 'identifier' | 'price'
  /** True = a per-line field (resolved once per item in the line array). Default false = a document-level field. */
  line?: boolean
  /** Value to use when the field is ABSENT (e.g. an optional allowance/charge that is 0 when omitted). If unset, an absent field abstains. */
  default?: number
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
   */
  compare?: 'number' | 'identifier'

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
}

/** A value is a declarative ruleset if it declares fields + checks and does NOT carry the built-in ruleset's compute(). */
export function isDeclarativeRuleset(x: unknown): x is DeclarativeRuleset {
  return !!x && typeof x === 'object' && !('compute' in (x as object))
    && typeof (x as DeclarativeRuleset).fields === 'object' && Array.isArray((x as DeclarativeRuleset).checks)
}
