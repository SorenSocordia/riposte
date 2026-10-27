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

/** A verdict's named aggregation rule (see Verdict.aggregation and verdict/aggregation.ts). */
export type Aggregation = 'ANY_FAIL_FAILS' | 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES'

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
  /**
   * Engine 0.2.0 (additive, 2026-10-03): present on an INSUFFICIENT_DATA claim held as SUSPECT. A value it could not read has a
   * reading one character away under which the check FAILs, so the gate books the claim as a FAIL (verdict/aggregation.ts
   * gateStatus) instead of an open check. Absent on every verdict of engines 0.0.1 and 0.1.0, and RETIRED from engine 0.3.0
   * (the product ruling: a flag, never a FAIL): a 0.3.0 verdict states suspect on the struck field (Verdict.struck).
   */
  suspect?: Suspect
}

/** Why an unreadable claim is held as suspect (ClaimVerdict.suspect, engine 0.2.0). */
export interface Suspect {
  /** each unreadable operand as reported: its role, where it was reported, and the string */
  reported: { role: string; path: string; raw: string }[]
  /** the first failing reading, in candidate order: each operand read one character differently, and the value that gives */
  reading: { role: string; path: string; read_as: string; value: number }[]
  /** the check under that reading: its two sides */
  computed: { left: Value; right: Value }
  /** how many distinct one-character readings were evaluated, and how many of them FAIL the check */
  readings_checked: number
  readings_failing: number
}

/**
 * Counsel attached to a verdict (additive, 2026-10-03; engine 0.2.0 rulesets that declare an `advisory` check): a check the
 * ruleset reads as advice, never as a verdict. It never changes an outcome, a coverage count or a gate.
 */
export interface Advisory {
  channel: 'COUNSEL'
  rule_id: string
  rule_name: string
  claim_id: string
  detail: string
  computation?: Computation
  /**
   * Engine 0.5.0: the check evaluates a model at a point past the last measured support (`support` on the check), so
   * the computed value is the model's, reported as counsel and never as PASS or FAIL. `support` gives the point and the last
   * measured value.
   */
  beyond_data?: true
  support?: { field: string; value: number; max_of: string; last: number }
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

// --- typed remedies (additive, 2026-10-02; verdict/remedy.ts, docs/REMEDIES.md) -------------------------------------------

/**
 * The lawful ways a non-PASS finding can be answered. A remedy never changes a verdict: applying one (supplying the operand,
 * re-reading it, transforming it, or a person's call-scoped ruling) yields a NEW check or a ruling bound to THIS verdict.
 *   missing-operand  an operand the rule needs is absent or unresolved: supply it (ABSTAIN's usual answer)
 *   transform        a REGISTERED transformation (verdict/remedy.ts REMEDY_TRANSFORMS) of an operand, by name
 *   authority        a named role may rule allow/deny on this verdict only (never a session, never a waiver of later checks)
 *   recompute-with   re-read or correct a named operand and run the check again (a new verdict)
 *   none             no lawful transition is declared: the finding stands
 */
export type RemedyKind = 'missing-operand' | 'transform' | 'authority' | 'recompute-with' | 'none'

/** Where an operand comes from, in the evidence vocabulary: a document or reference name, the rule's role, the field path. */
export interface OperandRef {
  /** e.g. invoice · contract · evidence · history · purchase_order · goods_receipt · opinion · brief · source · document */
  source: string
  /** The role the rule binds (e.g. SUBTOTAL, RATE_CONTRACTED), when the rule names one. */
  role?: string
  /** The field path in the caller's document (e.g. "line_items[1].amount", "line[2].quantity"), when known. */
  path?: string
}

export interface Remedy {
  kind: RemedyKind
  operand?: OperandRef
  /** kind 'transform': the registered transformation's name. */
  transform?: string
  /** kind 'authority': the role that may rule on this verdict (its mandate: the rule ids in `clears`). */
  authority?: string
  detail: string
  /** The rule ids this remedy could lawfully clear in this verdict. */
  clears: string[]
  /** The claim ids it answers in this verdict. */
  claims: string[]
}

export interface Verdict {
  schema_version: 'v0'
  /** Deterministic: derived from input_hash + ruleset + engine_version (+ remedy_table_hash from engine 0.2.0). NOT random, NOT time-based. */
  verdict_id: string
  /** ISO-8601 UTC. The ONLY field allowed to vary between replays of identical input. */
  issued_at: string

  // --- reproducibility contract ---------------------------------------------------------------
  engine_version: string
  ruleset: { id: string; version: string; domain: string }
  /** sha256 over the canonicalized (extraction + references). */
  input_hash: string
  /**
   * Engine 0.2.0 (2026-10-03): sha256 of the remedy table the verdict's remedies come from (a declarative ruleset's declared
   * remedies, or a built-in engine's table). verdict_id derives from it as well (protocol/verdict-id.ts), so a verdict's remedies
   * are bound to its identity. Absent on every verdict of engines 0.0.1 and 0.1.0.
   */
  remedy_table_hash?: string
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
  /**
   * Engine 0.6.0 (2026-10-05): what a gate reads, recorded beside the outcome (verdict/aggregation.ts
   * recordedGateStatus). PASS_WITH_OPEN when every check that ran held but some could not run; a gate that acts on money holds on
   * it. Absent on every verdict of engines 0.0.1 to 0.5.0 (a reader recomputes it from the claims: gateStatus).
   */
  gate_status?: 'PASS' | 'PASS_WITH_OPEN' | 'FAIL' | 'INSUFFICIENT_DATA'
  /**
   * The named rule the outcome follows from its claims by (verdict/aggregation.ts; every reader recomputes with the rule named):
   *   ANY_FAIL_FAILS: FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS.
   *   ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES (additive, 2026-09-29): FAIL if any claim FAILs; else PASS only if a claim of
   *     a kind other than CONSISTENCY PASSed; else INSUFFICIENT_DATA. Named by the e-invoice twin since 0.3.0.
   */
  aggregation: Aggregation
  claims: ClaimVerdict[]

  // --- honesty about ourselves ----------------------------------------------------------------
  coverage: Coverage
  /**
   * Typed remedies (additive, 2026-10-02): present iff some claim is not PASS (or the verdict itself is not PASS). The
   * engine's output, so a replay re-derives it, but OUTSIDE the hashed core: verdict_id never commits to it, and a verdict
   * issued before remedies existed (none carried) still replays on its core. See verdict/remedy.ts.
   */
  remedies?: Remedy[]
  /**
   * Checks a declarative ruleset ruled out for this document by `applies_if` (additive, 2026-10-03): no claim was made, and
   * this says which and why. Present only when one was ruled out, so every verdict without one keeps its bytes.
   */
  not_applicable?: NotApplicable[]
  /**
   * Counsel from the ruleset's advisory checks (additive, 2026-10-03): present only when one fired. Never part of the outcome,
   * the coverage or the gate reading; re-derived by a replay like every engine output.
   */
  advisories?: Advisory[]
  /** Populated once the public Verification Index exists. Measured on a preregistered set or absent. */
  declared_accuracy?: DeclaredAccuracy

  // --- v0.1 typed channel (additive; see channel.ts) -------------------------------------------
  /**
   * The channel this proof object speaks on. A Verdict can only ever be 'VERDICT': checked against a binding source
   * and evidenced, never flexes. Generated material (miner candles, suggestions, opinions) is COUNSEL and is a
   * different type. Absent on verdicts emitted before v0.1 and by default (so every existing byte and verdict_id is
   * unchanged); `stampVerdictChannel()` sets it after checking the proof object earns it. NOT part of verdict_id.
   */
  channel?: 'VERDICT'

  // --- engine 0.3.0: strike and recompute, evidence tiers, the scope line (additive, 2026-10-03; docs/EVIDENCE.md) ---
  /** The checks that ran, by outcome (engine 0.3.0, declarative). */
  computed?: { pass: string[]; fail: string[] }
  /** Every struck LOAD-BEARING field: one at least one claim waits on (engine 0.3.0, declarative). */
  struck?: StruckField[]
  /** Per struck field, the claims waiting on it: what a correction or corroboration would unlock (engine 0.3.0, declarative). */
  would_unlock?: WouldUnlock[]
  /** What was computed and what was struck, counted (engine 0.3.0, declarative). Suspect is counted here and never booked as FAIL. */
  counts?: VerdictCounts
  /** The worst effective evidence tier among the fields the computed checks rest on (engine 0.3.0, declarative). */
  evidence_floor?: EvidenceFloor
  /** Tier conflicts and refused tier claims (engine 0.3.0, declarative; present only when one was found). */
  findings?: Finding[]
  /** Per field an evidence overlay touched: the value used, its tier, what supports it (engine 0.3.0; present only with an overlay). */
  support?: FieldSupport[]
  /** The case a re-verdict belongs to (an annotation added after the engine, like `channel`; never compared by replay). */
  case?: CaseLink
  // --- engine 0.4.0: claims over tables (additive, 2026-10-04; docs/RULESETS.md, docs/EVIDENCE.md) ------------------
  /**
   * The files an envelope's values were read from, when their provenance is `archive` (engine 0.4.0, declarative): each with its
   * url, retrieval time, content sha256, the archive's own checksum when it publishes one, the tier (E1, never E0), and what the
   * engine verified from bytes it hashed itself (`content_verified`, `checksum_verified`). Present only when there is one.
   */
  archives?: ArchiveCheck[]
  /**
   * The pinned algorithms the ruleset names (engine 0.4.0, declarative; src/algorithms): ref, implementation sha256, source hashes.
   * The ruleset's input identity carries the same pins, so the verdict_id binds them; replay refuses a pin this build does not carry.
   */
  algorithms?: AlgorithmPin[]
  // --- engine 0.5.0: the choice ledger (additive, 2026-10-04; docs/CHOICES.md) -----------------------------------------
  /**
   * Every choice slot the ruleset declares (engine 0.5.0, declarative), in its order: stated by the document (with the quoted
   * span), supplied (by the judge or the ruleset's default, with its source), unstated (no value: the checks that depend on it
   * abstain), or not applicable. Empty for a ruleset that declares none. `counts.stated_rate` = stated / load-bearing.
   */
  choices?: ChoiceEntry[]
  /** The values whose own quality flag the flags choice read (engine 0.5.0, declarative; present when a value carries `qc`). */
  qc?: QcBlock
  /** What this verdict is and is not, generated from the verdict itself (engine 0.3.0, every engine; verdict/scope.ts). Always last. */
  scope?: VerdictScope

  // --- Stage 2 / Stage 3 reserved (additive; unused in v0) -------------------------------------
  ledger?: {
    tenant_id: string
    retention_until: string
    reviewer?: { id: string; decided_at: string; decision: 'UPHELD' | 'OVERTURNED'; note?: string }
  }
  action_context?: { tool_name: string; call_id: string; argument_path: string }
}

// --- engine 0.3.0 (2026-10-03): the evidence ruling ----------------------------------------------------------------

/**
 * What a value rests on (docs/EVIDENCE.md):
 *   E0  pulled from a system of record through an authenticated channel (a statement signed by an enrolled source key)
 *   E1  a structured document whose fields are machine-native (UBL/CII XML), read by the engine
 *   E2  a PDF's own text layer
 *   E3  OCR of a scan or an image
 *   E4  a human's assertion: never evidence on its own, never load-bearing
 */
export type EvidenceTier = 'E0' | 'E1' | 'E2' | 'E3' | 'E4'
/** A verdict's floor: a tier; `unstated` (values with no provenance: a plain extraction); `none` (nothing was computed). */
export type EvidenceFloor = EvidenceTier | 'unstated' | 'none'

/** Why a field is struck. `suspect` is a flag on an unreadable field whose readable candidates would fail a check. */
export type StruckReason = 'unreadable' | 'suspect' | 'withdrawn' | 'unsupported-assertion' | 'conflict' | 'qc_held' | 'qc_struck'

/** What is known about where a struck field was reported. */
export interface StruckProvenance {
  /** the value as reported, as JSON ("4O0.00" → "\"4O0.00\"") */
  raw?: string
  /** where the source text prints it, when known ("line 31 of the source text: …") */
  at?: string
  page?: number
  line?: number
  reader?: string
  /** an envelope field's readings: each reader's raw string (null when it read nothing) */
  readings?: { reader: string; raw: string | null }[]
  /** the tier the value would rest on; `unstated` for a plain extraction */
  tier?: EvidenceTier | 'unstated'
  /** a withdrawn field: the move that withdrew it */
  move_id?: string
}

export interface StruckField {
  /** the role, with its line or list element: "PAYABLE", "LINE_EXT@line[0]", "VBD_TAX[2]" */
  field: string
  role: string
  /** where it was reported in the extraction (absent when only its label is printed) */
  path?: string
  reason: StruckReason
  provenance: StruckProvenance
  detail: string
  /** reason `suspect`: the strict-parse candidates one reading away, and the first ones under which a check FAILs */
  candidates?: { checked: number; failing: number; passing: number; shown: { read_as: string; value: number; fails: string[] }[] }
}

export interface WouldUnlock {
  /** the struck field (as StruckField.field) */
  field: string
  /** the claims waiting on it; a claim waiting on two struck fields is listed under both */
  claims: string[]
}

export interface VerdictCounts {
  checks_computed: number
  checks_pass: number
  checks_fail: number
  /** claims that wait on at least one struck field */
  checks_struck: number
  fields_struck: number
  unreadable: number
  suspect: number
  withdrawn: number
  unsupported_assertion: number
  conflict: number
  findings: number
  // engine 0.5.0, present on every declarative verdict of that engine:
  /** choice slots the ruleset declares load-bearing */
  choices_load_bearing?: number
  /** of those, the slots the document states (a quoted span) */
  choices_stated?: number
  /** choices_stated / choices_load_bearing, to 4 decimals; null (never 0) when no slot is load-bearing */
  stated_rate?: number | null
  /** struck fields held by their quality flag, and struck by it (a claim waits on each) */
  qc_held?: number
  qc_struck?: number
  /** checks reported as counsel because they evaluate a model past the measured support */
  beyond_data?: number
}

/** The kinds of free choice a number depends on (engine 0.5.0, docs/CHOICES.md). */
export type ChoiceKind = 'weights' | 'flags' | 'ratio' | 'units' | 'model_form' | 'algorithm' | 'tolerance' | 'selection'
/** stated: quoted from the document · supplied: by the judge or the ruleset default · unstated: no value · not_applicable. */
export type ChoiceStatus = 'stated' | 'supplied' | 'unstated' | 'not_applicable'
/** A choice value: a number (a role the checks read), a string (a name: an algorithm ref, a weighting), or a flags policy. */
export type ChoiceValue = number | string | { [k: string]: unknown }

/** Where a stated choice is quoted from: a page or a section, and the words. */
export interface ChoiceSpan { page?: number; section?: string; quote: string }

/** One slot of the choice ledger (Verdict.choices, engine 0.5.0). */
export interface ChoiceEntry {
  id: string
  kind: ChoiceKind
  status: ChoiceStatus
  /** the value the checks use; null when unstated or not applicable */
  value: ChoiceValue | null
  /**
   * stated: `{ span }` (an algorithm slot also `registry`: whether the quote is a verbatim part of the registry's pinned quote);
   * supplied: `{ default, by }`; not applicable: `{ not_applicable }`; unstated: null
   */
  source:
    | { span: ChoiceSpan; registry?: { ref: string; quote_sha256: string; verbatim: boolean } }
    | { default: string; by: 'ruleset' | 'judge' }
    | { not_applicable: string }
    | null
  load_bearing: boolean
  /** why a fill was not read as a statement, or that the document is marked silent on it */
  detail?: string
}

/** One value whose own quality flag held, struck or blanked it (QcBlock.values). */
export interface QcValue {
  field: string
  path: string
  scheme: string
  flag: string
  /** the scheme's meaning of the flag (the scheme file is authoritative; the provenance's own text is not used) */
  meaning: string
  action: 'held' | 'struck' | 'absent'
}

/** The verdict's account of per-value quality flags (engine 0.5.0; Verdict.qc). */
export interface QcBlock {
  /** the flags slot that governs, or null when no slot governs the scheme the values carry */
  choice: string | null
  read: number
  computed: number
  held: number
  struck: number
  absent: number
  /** values whose qc no flags slot governs: computed as given, their flag not read */
  not_read: number
  values: QcValue[]
}

export interface Finding {
  kind: 'tier-conflict' | 'tier-claim-capped'
  field: string
  path: string
  detail: string
  /** tier-conflict: the value used and the one it overrode (or the two at one tier) */
  kept?: { value: Value; tier: EvidenceTier | 'unstated'; source: string }
  against?: { value: Value; tier: EvidenceTier | 'unstated'; source: string }
}

export interface FieldSupport {
  field: string
  path: string
  value: Value
  tier: EvidenceTier | 'unstated'
  /** the best tier among independent sources that agree with the value within tolerance */
  supported_at: EvidenceTier | 'unstated'
  sources: { source_id: string; tier: EvidenceTier | 'unstated'; value: Value; agrees: boolean; move_id?: string }[]
}

/** The case a re-verdict belongs to: its id, the verdict it follows, and the move that produced it. */
export interface CaseLink {
  case_id: string
  prior_verdict_id: string
  move_id: string
}

/** The scope-and-consent line, generated from the verdict, never typed (verdict/scope.ts). */
export interface VerdictScope {
  ruleset: string
  engine_version: string
  evidence_floor: EvidenceFloor
  statements: readonly ['advisories are counsel, not verdicts', 'this is a check, not a decision']
}

/**
 * A pinned algorithm as a verdict carries it (engine 0.4.0; Verdict.algorithms, src/algorithms): the ref, the sha256 of its
 * implementation file, and the hashes of its quoted source; `carried: false` for a ref the issuing build did not carry.
 */
export type AlgorithmPin =
  | { ref: string; id: string; version: string; implementation_sha256: string; source: { doi: string; url: string; pdf_sha256: string; text_sha256: string; quote_sha256: string; reference_sha256?: string } }
  | { ref: string; carried: false }

/** One archive an envelope's values were read from (engine 0.4.0; Verdict.archives, docs/EVIDENCE.md "Archive provenance"). */
export interface ArchiveCheck {
  url: string
  /** the file inside a container the url serves */
  member?: string
  container_sha256?: string
  retrieved_at: string
  /** sha256 of the content the values were read from, as the provenance states it */
  sha256: string
  /** the checksum the archive itself publishes for the file, as the provenance states it */
  archive_checksum?: { algorithm: string; value: string; published_at?: string }
  /** always E1: a machine-native table read by its declared format; never E0, since no archive signs with an enrolled key */
  tier: 'E1'
  /** the engine hashed bytes it was given (the source text) and they are this file */
  content_verified: boolean
  /** those bytes also match the checksum the archive publishes (false when it publishes none, or the bytes were not given) */
  checksum_verified: boolean
  /** how many values were read from it */
  fields: number
  detail: string
  /** engine 0.5.0: which supplied bytes the engine hashed and found to be this file (`source.text`, `archive_files[0]`, …) */
  matched?: string
}

/** A declarative check (or required passage) that `applies_if` ruled out for this document (additive, 2026-10-03). */
export interface NotApplicable {
  /** the claim id it would have had, e.g. "document.LW_THROUGH" or "source.CA-8132.notice" */
  claim_id: string
  rule_id: string
  /** the condition that does not hold, with the value it read */
  detail: string
}
