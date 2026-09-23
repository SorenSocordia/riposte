/**
 * Verdict schema (v0) — the verdict is a PROOF OBJECT, not a score.
 *
 * Design rules (see docs/VERDICT-SCHEMA-v0.md):
 *  1. Three outcomes, never a fourth. FAIL and INSUFFICIENT_DATA are different verdicts and are never conflated.
 *  2. Every claim gets its own verdict; the document outcome is a NAMED aggregation over claims.
 *  3. Tier is stated by the producer, never inferred by the consumer, never upgraded after the fact.
 *  4. Determinism is a contract: same input_hash + ruleset.version + engine_version → byte-identical verdict,
 *     with the single exception of `issued_at` (the only field allowed to carry a clock).
 *  5. `evidence` may be empty ONLY on INSUFFICIENT_DATA. A PASS or FAIL without evidence is a schema violation.
 *  6. An INSUFFICIENT_DATA claim MUST carry an explained `insufficiency`.
 *
 * Input model: the caller supplies STRUCTURED, already-extracted data (JSON). Provenance therefore
 * points into that structure by FIELD PATH with source, original value, normalized value and the
 * normalization log — which is exactly what the binding layer records. Character-span locators are
 * reserved for the later source-document mode.
 */

export type Outcome = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

/** v0 emits only DETERMINISTIC. REASONED is reserved for the hybrid overreach tier. */
export type Tier = 'DETERMINISTIC' | 'REASONED'

export type ClaimKind = 'RECOMPUTE' | 'QUOTE_MATCH' | 'CROSS_REFERENCE' | 'CONSISTENCY'

export type InsufficiencyReason =
  | 'FIELD_MISSING'            // a required field was not present in the extraction
  | 'UNPARSEABLE'              // present, but could not be normalized/compared (type mismatch, bad number/date)
  | 'AMBIGUOUS_UNIT'           // e.g. currency mismatch across documents, "in thousands" scaling unknown
  | 'SPAN_NOT_FOUND'           // (source-document mode) cited span not found
  | 'OUT_OF_RULESET_SCOPE'     // the ruleset has no rule that can decide this
  | 'REFERENCE_NOT_PROVIDED'   // a cross-document check needs a contract/evidence reference the caller did not supply
  | 'AMBIGUOUS_FIELD'          // a required field was located only by fuzzy name-matching; verdicts are never issued on guessed fields
  | 'AMBIGUOUS_REFERENCE'      // the reference offers several candidate values (e.g. many rates) and none could be matched to this line
  | 'SELECTIVE_QUOTE'          // the quoted words appear verbatim, but immediately follow a negation the quotation omits — meaning may be inverted; cannot certify

export type Scalar = number | string | boolean | null
export type Value = Scalar | Scalar[]

export type EvidenceSource = 'invoice' | 'contract' | 'evidence' | 'history' | 'computed' | 'human'

export type EvidenceLocator =
  | { kind: 'field'; source: EvidenceSource; path: string }
  | { kind: 'span'; source_hash: string; start: number; end: number; page?: number; line?: number }

export interface Evidence {
  locator: EvidenceLocator
  /** The value as used in the comparison (normalized). */
  value: Value
  /** The raw value before normalization, when it differed. */
  original?: Value
  /** Normalization steps applied (audit trail), e.g. ["currency_symbols_removed","european_format_converted"]. */
  normalizations?: string[]
  /** Binding confidence 0–100 (100 = exact path; 95 = alternative path; 75 = fuzzy alias). */
  confidence: number
  role: 'OPERAND' | 'QUOTE' | 'REFERENCE' | 'CONTEXT'
}

export interface Computation {
  /** Human-readable formula from the ruleset, e.g. "Σ line_items[i].amount = subtotal". */
  formula: string
  /** Operands keyed by universal role (plus "constant" when a rule compares to a literal). */
  operands: Record<string, Value>
  /** The expected/reference value the assertion was compared against. */
  result: Value
  tolerance?: { abs?: number; rel?: number }
}

export interface Insufficiency {
  reason: InsufficiencyReason
  detail: string
  /** Universal roles that were required but absent, when applicable. */
  missing?: string[]
}

export interface ClaimVerdict {
  claim_id: string
  kind: ClaimKind
  tier: Tier
  outcome: Outcome
  /** The extracted field under test, in the caller's vocabulary (e.g. "total", "line_items[3].amount"). */
  field: string
  /** The asserted value as extracted (normalized), or null when absent. */
  asserted: Value
  /** Rule identifier within the ruleset (e.g. "TOTAL_INT"). The ruleset version lives on the Verdict. */
  rule_id: string
  rule_name: string
  computation?: Computation
  /** Empty ONLY when outcome === 'INSUFFICIENT_DATA'. */
  evidence: Evidence[]
  /** Present iff outcome === 'INSUFFICIENT_DATA'. The honest refusal is itself explained. */
  insufficiency?: Insufficiency
  /** Signed numeric variance for recompute/cross-reference failures (asserted − expected), when defined. */
  variance?: number
  /** True when the kernel LOCKED this verdict (all operands exact-path, high confidence). */
  locked: boolean
  explanation: string
}

export interface Coverage {
  claims_total: number
  /** Claims that actually ran to PASS or FAIL. */
  claims_checked: number
  claims_pass: number
  claims_fail: number
  claims_insufficient: number
}

export interface DeclaredAccuracy {
  domain: string
  ruleset_version: string
  fp_rate: number
  fn_rate: number
  abstain_rate: number
  /** The hashed, preregistered labeled set these rates were measured on. Never estimated. */
  measured_on: string
}

export interface Verdict {
  schema_version: 'v0'
  /** Deterministic: derived from input_hash + ruleset + engine_version. NOT random, NOT time-based. */
  verdict_id: string
  /** ISO-8601 UTC. The ONLY field allowed to vary between replays of identical input. */
  issued_at: string

  // --- reproducibility contract ---------------------------------------------------------------
  engine_version: string
  ruleset: { id: string; version: string; domain: string }
  /** sha256 over the canonicalized (extraction + references). */
  input_hash: string
  replayable: true

  // --- what was checked -----------------------------------------------------------------------
  document: {
    /** sha256 over the canonicalized extraction alone. */
    extraction_hash: string
    /** Who produced the extraction, if the caller says (e.g. "reducto", "llamaextract", "custom"). Never trusted, always checked. */
    producer?: string
    line_items: number
  }
  references: {
    contract: boolean
    evidence: number
    /** Prior documents of the same kind (previous pay application, prior invoices) — the history axis. */
    history: number
    /** Whether source text (the document itself) was supplied for the quote/value-in-source axis. */
    source: boolean
  }

  // --- the result -----------------------------------------------------------------------------
  outcome: Outcome
  /** FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS. */
  aggregation: 'ANY_FAIL_FAILS'
  claims: ClaimVerdict[]

  // --- honesty about ourselves ----------------------------------------------------------------
  coverage: Coverage
  /** Populated once the public Verification Index exists. Measured on a preregistered set or absent. */
  declared_accuracy?: DeclaredAccuracy

  // --- Stage 2 / Stage 3 reserved (additive; unused in v0) -------------------------------------
  ledger?: {
    tenant_id: string
    retention_until: string
    reviewer?: { id: string; decided_at: string; decision: 'UPHELD' | 'OVERTURNED'; note?: string }
  }
  action_context?: { tool_name: string; call_id: string; argument_path: string }
}
