/**
 * Rule mining: the types.
 *
 * The miner reads a CASE TABLE (labelled decisions, where each case has document fields and optional line records)
 * and a SCHEMA that types each field. It proposes the rules that best explain the HOLD decisions. It never sees why a
 * case was held: it gets only the binary approve/hold split that the schema's `approve` label defines. Every
 * other label counts as a HOLD.
 *
 * Proposals are CANDLES: rules for a human to ratify, never rules on their own. Every rejected candidate goes
 * to the MORGUE with the cause of its death. Output is deterministic (no randomness, and the null distribution is exact).
 */

/** How a field's value is read and which grammar families it can take part in. */
export type MineFieldType =
  /** a count (exact comparison by default) */
  | 'qty'
  /** a currency value (compared with a 0.005 tolerance by default) */
  | 'money'
  /** true / false (conditions: `extra*[flag]`) */
  | 'bool'
  /** one identifier (normalised: whitespace removed, upper-cased) */
  | 'id'
  /** a list of identifiers the document cites (compared as a set of normalised ids) */
  | 'ids'

export interface MineFieldSpec {
  type: MineFieldType
  /**
   * The field's arithmetic role:
   *   line `money` fields: 'price' (a unit price) or 'amount' (the extended line amount = qty × price)
   *   document `money` fields: 'total' (the document's stated total) or 'extra' (a charge added on top of the lines,
   *   e.g. freight)
   * `qty` line fields are always quantities and need no role.
   */
  role?: 'price' | 'amount' | 'total' | 'extra'
  /**
   * The document the value comes from, e.g. 'invoice', 'po', 'receipt'. Line arithmetic pairs a qty with a price from
   * the SAME source. A total is compared with the line sum of its own source (`total = sum(lines)`) and against the
   * line value of every other source (`total <= reference`).
   */
  source?: string
  /**
   * The comparison dimension. Line fields are only compared within one dimension. Default: 'qty' for qty;
   * 'money:<role>' for money with a role (so unit prices compare with unit prices, never with amounts); else the type.
   */
  dim?: string
  /** Absolute tolerance for this field's comparisons. Default qty 1e-9, money 0.005. */
  eps?: number
}

export interface MineSchema {
  /** The label value (or values) that mean APPROVE. Every other label is a HOLD. */
  approve: string | string[]
  /** Document-level fields. Names must be identifiers (`[A-Za-z_][A-Za-z0-9_]*`), since they become ruleset roles. */
  fields: Record<string, MineFieldSpec>
  /** Per-line fields (each case's `lines[i]`). */
  lines?: Record<string, MineFieldSpec>
}

export interface MineCase {
  id: string
  label: string
  /** Document-level values, keyed by schema field name. */
  fields: Record<string, unknown>
  /** Per-line values, keyed by schema line-field name. Absent = no line data (line candidates are undecidable here). */
  lines?: Record<string, unknown>[]
}

export interface ExcludedCase { id: string; label: string; why: string }

export interface CaseTable {
  cases: MineCase[]
  /** Cases an adapter could not turn into rows. Reported, never mined. */
  excluded?: ExcludedCase[]
}

export interface MineOptions {
  /** GROUNDING: the minimum number of HOLD cases that violate a candidate (the prototype's k ≥ 5). Default 5. */
  minHoldViolators?: number
  /** GROUNDING: the maximum p-value against the exact null. Default 0.01. */
  maxP?: number
  /** NOVELTY: the minimum number of holds that no already-accepted candle explains. Default 3. */
  minNewHolds?: number
  /** The grid for a learned tolerance t in `X <= Y*(1+t)`. The smallest consistent t is taken. Default {0, .5%, 1%, 2%, 3%, 5%, 10%}. */
  tGrid?: number[]
  /**
   * CONSISTENCY: the largest fraction of decidable APPROVE cases that a candidate may violate. Default 0, the
   * prototype's behaviour: one approved violator kills the candidate. When it is above 0, GROUNDING switches to the
   * enrichment null (see stats.ts).
   */
  maxApprovedViolationRate?: number
  /** Reported only, never gating: the family-wise strict gate is strictAlpha / (number of variants). Default 0.05. */
  strictAlpha?: number
  /**
   * Add the C family: a learned constant per numeric document field, in both directions (`X <= c`: large X means HOLD;
   * `X >= c`: small X means HOLD). Default false, so the AP grammar stays the prototype's exactly.
   */
  thresholds?: boolean
}

export interface ResolvedMineOptions {
  minHoldViolators: number
  maxP: number
  minNewHolds: number
  tGrid: number[]
  maxApprovedViolationRate: number
  strictAlpha: number
  thresholds: boolean
}

// ── the grammar's candidate shapes (JSON; the compiler reads these) ─────────────────────────────────────────────────

/** A document-scope arithmetic term. */
export type Term =
  | { field: string }
  /** Σ over lines of one line field */
  | { sum: string }
  /** Σ over lines of qty × price (a source with no amount field) */
  | { sumProduct: [string, string] }
  | { const: number }
  | { plus: [Term, Term] }
  /** `field*[flag]` (or `field*[not flag]` when negate): the field when the flag is true (false), else 0 */
  | { gated: string; by: string; negate?: boolean }

/** L1 `x <= y` (le), L2 `x = y` (eq), L3 `x <= y*(1+t)` (le_tol), violated if ANY line violates */
export interface LineComparisonSpec { scope: 'line'; form: 'le' | 'eq' | 'le_tol'; x: string; y: string; eps: number }

export type CandidateSpec =
  | LineComparisonSpec
  /** L4 `a = q*p` on every line */
  | { scope: 'line'; form: 'product'; a: string; q: string; p: string; eps: number }
  /** D: document-scope relation between terms */
  | { scope: 'document'; form: 'rel'; op: '=' | '<='; left: Term; right: Term; eps: number }
  /** I1: the list field cites exactly one identifier, and it equals the id field (set semantics, normalised) */
  | { scope: 'document'; form: 'ids_one'; list: string; id: string }
  /** I2: two identifier fields are equal (normalised) */
  | { scope: 'document'; form: 'id_eq'; x: string; y: string }

export type Family = 'L1' | 'L2' | 'L3' | 'L4' | 'D' | 'I1' | 'I2' | 'C'

export interface Candidate {
  id: string
  family: Family
  spec: CandidateSpec
  /** present for L3: the grid t is learned from */
  tGrid?: number[]
  /**
   * present for C: the constant in the spec is a placeholder, learned from the data (threshold.ts). 'high': the spec is
   * `field <= c` (large values violate). 'low': the spec is `c <= field` (small values violate).
   */
  learnConst?: { field: string; dir: 'high' | 'low' }
}

export type Fate = 'CANDLE' | 'REDUNDANT' | 'INCONSISTENT' | 'VOID' | 'BASE_RATE'

export interface JudgedCandidate {
  id: string
  family: Family
  spec: CandidateSpec
  /** the learned tolerance (L3 only, when a consistent t exists) */
  t?: number
  /** the learned constant (C only; also written into the spec) */
  c?: number
  fate: Fate
  /** the cause, in words (for a death, why it died) */
  detail: string
  /** violators of any label */
  k: number
  /** HOLD violators (what the candidate explains) */
  holds: number
  /** APPROVE violators (the exceptions; 0 unless maxApprovedViolationRate > 0, or the candidate is INCONSISTENT) */
  approved: number
  /** cases on which the candidate could be evaluated: the N of its null */
  decidable: number
  /** HOLD cases among them: the H of its null */
  decidable_holds: number
  /** the grounding p-value (1 when never computed: INCONSISTENT / VOID) */
  p: number
  /** passes the reported family-wise strict gate (strictAlpha / variants) */
  strict: boolean
  /** ids of the violating cases (all labels), sorted */
  violators: string[]
  /** CANDLE / REDUNDANT: holds it explains that no earlier-accepted candle does */
  new_holds?: number
  /** CANDLE: the labels among the violators (descriptive only; the judges never saw them) */
  violator_labels?: Record<string, number>
  /**
   * L3 candle: the range of t the data supports (the prototype's definition, ignoring eps). lo = the smallest ratio
   * x/y - 1 at which the approved-violation limit holds (with no exceptions allowed, the largest approved ratio).
   * hi = the smallest held ratio above lo, or null if there is none. Any t in [lo, hi) catches the same holds.
   *
   * C candle: the range of constants giving the same partition. lo and hi are the adjacent observed values on either side of
   * the cut. `X <= c` gives the same violators for any c in [lo, hi); `X >= c` for any c in (lo, hi]. c is the midpoint.
   */
  interval?: { lo: number | null; hi: number | null }
}

export interface MineReport {
  engine: 'riposte-mine'
  mine_version: string
  engine_version: string
  options: ResolvedMineOptions
  schema: MineSchema
  data: {
    cases: number
    holds: number
    approves: number
    /** sha256 of the canonicalised case table (determinism anchor) */
    table_hash: string
    /** cases the adapter excluded before mining */
    excluded: ExcludedCase[]
    /** per field: cases where the value was missing or not of the declared type (only nonzero counts) */
    missing: Record<string, number>
    /** money fields holding sub-cent values. The engine's 'amount' normaliser rounds to cents, so the compiled ruleset may differ from the miner on these. */
    subcent_money_fields: string[]
  }
  grammar: { forms: number; variants: number; strict_gate: number }
  /** accepted candles, in acceptance order (greedy by coverage) */
  candles: JudgedCandidate[]
  /** every other candidate, in grammar order, with its cause of death */
  morgue: JudgedCandidate[]
  explained: { holds: number; of: number; unexplained: string[] }
}
