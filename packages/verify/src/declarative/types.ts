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
  /** How the value normalizes. Default 'amount' (currency). 'rate' = a fraction; 'quantity' = a count; 'string' = text (recorded, not compared). */
  kind?: 'amount' | 'rate' | 'quantity' | 'string'
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
}

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
  /** Rounding-tolerance policy (relative band + optional absolute cap). Default { rel: 0.0003, absCap: 0 }. */
  tolerance?: { rel: number; absCap: number }
}

/** A value is a declarative ruleset if it declares fields + checks and does NOT carry the built-in ruleset's compute(). */
export function isDeclarativeRuleset(x: unknown): x is DeclarativeRuleset {
  return !!x && typeof x === 'object' && !('compute' in (x as object))
    && typeof (x as DeclarativeRuleset).fields === 'object' && Array.isArray((x as DeclarativeRuleset).checks)
}
