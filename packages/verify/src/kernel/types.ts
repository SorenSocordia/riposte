/**
 * Computational Axioms - Core Type Definitions
 *
 * These types enable mathematical enforcement of forensic axioms.
 * The AI becomes a "Data Binder" and the Code becomes the "Mathematical Gavel."
 *
 * Vendored 2026-09-22 from an earlier internal engine and hardened here.
 * Stripped: concern-scoring re-exports and the concern fields on ValidationResult;
 * the smart-contract roles (out of scope). Added: invoice document-level roles.
 */

// ============================================================================
// UNIVERSAL ROLES
// ============================================================================

/**
 * Universal roles that map domain-specific terms to logical primitives.
 * These are the abstract "slots" that any domain's data can fill.
 */
export type UniversalRole =
  // === Commerce/Finance Roles ===
  | 'CLAIMED_AMOUNT'      // What invoice asserts (total or line item)
  | 'VERIFIED_AMOUNT'     // What evidence confirms
  | 'CONTRACTED_LIMIT'    // Max allowed per contract
  | 'RATE_APPLIED'        // Rate used in calculation
  | 'RATE_CONTRACTED'     // Rate per contract
  | 'CLAIMED_QUANTITY'    // Units claimed on invoice
  | 'ACTUAL_QUANTITY'     // Units verified by evidence
  | 'EVENT_DATE'          // When service occurred
  | 'CONTRACT_START'      // Contract effective date
  | 'CONTRACT_END'        // Contract expiry date
  | 'DOCUMENT_ID'         // Reference number (invoice #, PO #, etc.)
  | 'PRIOR_CLAIM_IDS'     // For duplicate detection (array of previous claim IDs)
  | 'LINE_ITEM_TOTAL'     // Computed: RATE_APPLIED * CLAIMED_QUANTITY
  | 'EXPECTED_TOTAL'      // Computed: RATE_CONTRACTED * ACTUAL_QUANTITY
  | 'INVOICE_DESCRIPTION' // Description text from invoice line item
  | 'EVIDENCE_DESCRIPTION' // Description text from evidence document
  // === Invoice document-level roles (footing / totals) ===
  | 'SUBTOTAL'            // Stated subtotal before tax/discount
  | 'TAX_AMOUNT'          // Stated tax amount
  | 'TAX_RATE'            // Stated tax rate (fraction, e.g. 0.0825)
  | 'DISCOUNT_AMOUNT'     // Stated discount (positive number, subtracted)
  | 'SERVICE_CHARGE'      // Stated service charge / gratuity (positive number, added) — real receipts add this to the total
  | 'GRAND_TOTAL'         // Stated final total
  | 'LINE_ITEMS_SUM'      // Computed: Σ line_items[*].amount
  | 'EXPECTED_GRAND_TOTAL' // Computed: SUBTOTAL + TAX_AMOUNT − DISCOUNT_AMOUNT (absent tax/discount recorded as 0 in provenance)
  | 'EXPECTED_TAX_AMOUNT'  // Computed: SUBTOTAL × TAX_RATE
  | 'CURRENCY_CODE'       // ISO-4217; a mismatch across documents is INSUFFICIENT_DATA, never a numeric FAIL
  // === Construction pay application (AIA G702 / G703) — ruleset 'pay-app' ===
  // G703 continuation sheet, per schedule-of-values line:
  | 'SOV_ITEM_ID'                  // column A — item number (the key for matching a line to the previous application)
  | 'SOV_DESCRIPTION'              // column B
  | 'SCHEDULED_VALUE'              // column C
  | 'WORK_PREVIOUS'                // column D — work completed from previous applications
  | 'WORK_THIS_PERIOD'             // column E — work completed this period
  | 'MATERIALS_STORED'             // column F — materials presently stored
  | 'COMPLETED_TO_DATE'            // column G — total completed and stored to date (stated)
  | 'EXPECTED_COMPLETED_TO_DATE'   // Computed: D + E + F
  | 'PERCENT_COMPLETE'             // column G ÷ C (stated, as a fraction)
  | 'EXPECTED_PERCENT_COMPLETE'    // Computed: G ÷ C
  | 'BALANCE_TO_FINISH'            // column H (stated)
  | 'EXPECTED_BALANCE_TO_FINISH'   // Computed: C − G
  | 'LINE_RETAINAGE'               // column I
  | 'PREVIOUS_COMPLETED_TO_DATE'   // From the previous application (history): that application's column G for the same item
  // G702 application and certificate for payment, document level:
  | 'ORIGINAL_CONTRACT_SUM'        // line 1
  | 'NET_CHANGE_ORDERS'            // line 2
  | 'CONTRACT_SUM_TO_DATE'         // line 3 (stated)
  | 'EXPECTED_CONTRACT_SUM_TO_DATE' // Computed: line 1 + line 2
  | 'TOTAL_COMPLETED_STORED'       // line 4 (stated)
  | 'SOV_SCHEDULED_SUM'            // Computed: Σ column C
  | 'SOV_COMPLETED_SUM'            // Computed: Σ column G
  | 'RETAINAGE_RATE'               // line 5 percentage (fraction)
  | 'RETAINAGE_TOTAL'              // line 5 total retainage (stated)
  | 'EXPECTED_RETAINAGE_TOTAL'     // Computed: line 4 × rate
  | 'SOV_RETAINAGE_SUM'            // Computed: Σ column I
  | 'TOTAL_EARNED_LESS_RETAINAGE'  // line 6 (stated)
  | 'EXPECTED_EARNED_LESS_RETAINAGE' // Computed: line 4 − line 5
  | 'PREVIOUS_CERTIFICATES'        // line 7 — less previous certificates for payment (stated)
  | 'PREVIOUS_EARNED_LESS_RETAINAGE' // From the previous application (history): its line 6
  | 'CURRENT_PAYMENT_DUE'          // line 8 (stated)
  | 'EXPECTED_CURRENT_PAYMENT_DUE' // Computed: line 6 − line 7
  | 'BALANCE_INCL_RETAINAGE'       // line 9 — balance to finish, including retainage (stated)
  | 'EXPECTED_BALANCE_INCL_RETAINAGE' // Computed: line 3 − line 6

// ============================================================================
// BOUND VALUES
// ============================================================================

/**
 * A value bound to a universal role with provenance tracking.
 * Extended in v4.5 with normalization audit trail.
 */
export interface BoundValue {
  /** The actual value (number, string, Date, or array) - may be normalized */
  value: number | string | Date | string[] | null

  /** Where this value came from */
  source: 'invoice' | 'contract' | 'evidence' | 'history' | 'computed' | 'human'

  /** Field path in the source document (e.g., "line_items[0].rate") */
  field: string

  /** Confidence in this binding (0-100) */
  confidence: number

  /** Optional: Human-readable label for this binding */
  label?: string

  // === v4.5: Normalization audit trail ===

  /** The raw extracted value before normalization */
  originalValue?: string | number | Date | null

  /** The normalized value used for comparison */
  normalizedValue?: string | number | null

  /** What transformations were applied during normalization */
  normalizations?: string[]
}

/**
 * A binding conflict that was detected during role assignment.
 * Occurs when multiple sources/mappings try to bind to the same role.
 * The higher-priority binding wins, but we track the conflict for forensic value.
 */
export interface BindingConflict {
  /** The role that had multiple bindings attempted */
  role: UniversalRole

  /** Description of the binding that was used (winning binding) */
  usedSource: {
    source: 'invoice' | 'contract' | 'evidence' | 'history' | 'computed' | 'human'
    field: string
    priority: number
  }

  /** Description of the binding that was rejected (losing mapping) */
  rejectedMapping: {
    source: 'invoice' | 'contract' | 'evidence' | 'any'
    fieldPath: string
    priority: number
  }

  /** Human-readable explanation of why this conflict occurred */
  explanation: string
}

/**
 * Correlation result from multi-factor matching
 */
export interface CorrelationInfo {
  /** Overall correlation score (0-100) */
  score: number

  /** Is this correlation reliable enough for binding? */
  isReliable: boolean

  /** Explanation of correlation */
  explanation: string

  /** Matched item index */
  matchedIndex: number
}

/**
 * Context containing all bound values for axiom evaluation.
 */
export interface BindingContext {
  /** Map of role to bound value */
  bindings: Partial<Record<UniversalRole, BoundValue>>

  /** Invoice ID being evaluated */
  invoiceId: string

  /** Line item index (if applicable) */
  lineItemIndex?: number

  /** Item description for reference */
  itemDescription?: string

  /** Correlation info for provenance tracking */
  correlationInfo?: {
    evidence?: CorrelationInfo
    contract?: CorrelationInfo
  }

  /**
   * Binding conflicts detected during role assignment.
   * For forensic analysis - tracks when multiple mappings competed for same role.
   */
  conflicts?: BindingConflict[]
}

// ============================================================================
// AXIOM PREDICATES
// ============================================================================

/**
 * Comparison operators for axiom predicates.
 */
export type PredicateOperator =
  | '<='    // Less than or equal
  | '>='    // Greater than or equal
  | '='     // Equal (with tolerance for numbers)
  | '!='    // Not equal
  | '<'     // Less than
  | '>'     // Greater than
  | 'IN'    // Value is in array
  | 'NOT_IN' // Value is not in array
  | 'EMPTY'  // Array is empty
  | 'NOT_EMPTY' // Array is not empty
  | 'EXISTS' // Value is not null/undefined (semi-computable check)
  | 'NOT_EXISTS' // Value is null/undefined
  | 'SIMILAR_TO' // Fuzzy string similarity (Jaccard index with threshold)

/**
 * A single predicate within an axiom.
 * Evaluates: leftRole OPERATOR rightRole (or rightRole as constant)
 */
export interface AxiomPredicate {
  /** Left-hand side role to evaluate */
  leftRole: UniversalRole

  /** Comparison operator */
  operator: PredicateOperator

  /** Right-hand side role (or constant for certain operators) */
  rightRole: UniversalRole | null

  /** Constant value if rightRole is null */
  constant?: number | string | string[]

  /** Numeric tolerance for equality comparisons (default: 0.01 for currency) */
  tolerance?: number

  /** Human-readable description of this predicate */
  description?: string
}

/**
 * Binding provenance - tracks where a value came from
 * Extended in v4.5 with normalization details for full auditability.
 */
export interface BindingProvenance {
  /** The role this binding is for */
  role: UniversalRole

  /** The actual value (may be normalized) */
  value: number | string | Date | string[] | null

  /** Source document type */
  source: 'invoice' | 'contract' | 'evidence' | 'history' | 'computed' | 'human'

  /** Field path in the source document */
  fieldPath: string

  /** Confidence in this binding (0-100) */
  confidence: number

  // === v4.5: Normalization audit trail ===

  /** The raw extracted value before normalization */
  originalValue?: string | number | Date | null

  /** The normalized value used for comparison */
  normalizedValue?: string | number | null

  /** What transformations were applied during normalization */
  normalizations?: string[]
}

/**
 * LLM correlation mapping for a single line item.
 * Kept as a TYPE only so the vendored bridge typechecks unchanged.
 * The public verify() API never accepts a correlation map; these branches are unreachable.
 */
export interface LLMCorrelationMapping {
  /** Index of the invoice line item */
  invoiceLineIndex: number

  /** Description from invoice for reference */
  invoiceLineDescription: string

  /** Evidence matches from LLM */
  matchedEvidence: Array<{
    /** Index of evidence document (-1 if no match) */
    evidenceDocIndex: number

    /** Description from evidence */
    evidenceDescription?: string

    /** Ticket/reference number */
    ticketNumber?: string

    /** LLM confidence in this match */
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'

    /** LLM's reasoning */
    reasoning: string
  }>

  /** Contract rule match from LLM */
  matchedContractRule?: {
    /** Name of the matched rule */
    ruleName?: string

    /** Index of rule in financial_rules array (-1 if no match) */
    ruleIndex: number

    /** LLM confidence in this match */
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'

    /** LLM's reasoning */
    reasoning: string
  }
}

/**
 * Complete LLM correlation map for an invoice
 */
export interface LLMCorrelationMap {
  /** All line item mappings */
  lineItemMappings: LLMCorrelationMapping[]
}

/**
 * Result of evaluating a single predicate.
 */
export interface PredicateResult {
  /** The predicate that was evaluated */
  predicate: AxiomPredicate

  /** Whether the predicate passed */
  passed: boolean

  /** Left-hand value used */
  leftValue: number | string | Date | string[] | null

  /** Right-hand value used (if applicable) */
  rightValue: number | string | Date | string[] | null

  /** Computed variance (for numeric comparisons) */
  variance?: number

  /** Reason for failure (if failed) */
  failureReason?: string

  /** Provenance for left-hand binding */
  leftProvenance?: BindingProvenance

  /** Provenance for right-hand binding */
  rightProvenance?: BindingProvenance
}

// ============================================================================
// COMPUTATIONAL AXIOM
// ============================================================================

/**
 * A computational axiom with executable predicates.
 * This replaces the "English hints to AI" with "Mathematical enforcement by code."
 */
export interface ComputationalAxiom {
  /** Unique identifier */
  id: string

  /** Short code for reference (e.g., 'RATE_SUP') */
  shortCode: string

  /** Human-readable name */
  name: string

  /** Formal statement of the axiom */
  axiomStatement: string

  /** Formal mathematical form (for display) */
  formalForm: string

  /** The predicates that must ALL pass for the axiom to pass */
  predicates: AxiomPredicate[]

  /** Roles that must be bound before evaluation */
  requiredRoles: UniversalRole[]

  /** How predicates combine ('AND' = all must pass, 'OR' = any must pass) */
  combinationLogic: 'AND' | 'OR'

  /** Who/what can detect violations */
  detectableBy: 'PRECOMPUTE' | 'LLM' | 'BOTH'

  /** Severity if violated */
  severity: 'critical' | 'high' | 'medium' | 'low'

  /** Domains where this axiom applies (empty = universal) */
  applicableDomains: string[]
}

// ============================================================================
// VALIDATION RESULTS
// ============================================================================

/**
 * Verdict from the validation gavel.
 */
export type GavelVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

/**
 * Confidence level in the validation result.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Result of validating a single axiom against bindings.
 */
export interface ValidationResult {
  /** The axiom that was validated */
  axiomId: string
  axiomCode: string

  /** The verdict */
  verdict: GavelVerdict

  /** Confidence in this verdict */
  confidence: ConfidenceLevel

  /** Whether this finding is LOCKED (AI cannot override) */
  isLocked: boolean

  /** Computed variance (for numeric axioms) */
  variance?: number

  /** Results of each predicate */
  predicateResults: PredicateResult[]

  /** Roles that were missing (if INSUFFICIENT_DATA) */
  missingRoles?: UniversalRole[]

  /** Binding coverage: what percentage of required roles were bound (0-100) */
  bindingCoverage?: number

  /** Hint for the caller about what to supply when data is insufficient */
  extractionHint?: string

  /** Timestamp of validation */
  validatedAt: Date

  /** Human-readable explanation */
  explanation: string
}

/**
 * Complete validation report for all axioms.
 */
export interface ValidationReport {
  /** Invoice being validated */
  invoiceId: string

  /** All validation results */
  results: ValidationResult[]

  /** Count of locked failures (AI cannot override) */
  lockedFailures: number

  /** Count of passing axioms */
  passCount: number

  /** Count of failing axioms */
  failCount: number

  /** Count of insufficient data */
  insufficientCount: number

  /** Timestamp of report generation */
  generatedAt: Date
}

// ============================================================================
// ERROR CLASSIFICATION (TRIPLET LEARNING)
// ============================================================================

/**
 * Error phases for triplet classification.
 */
export type ErrorPhase = 'extraction' | 'binding' | 'reasoning'

/**
 * Error types for learning feedback.
 */
export type ErrorType =
  | 'EXTRACTION_MISSED'    // Value exists but extractor didn't find it
  | 'EXTRACTION_WRONG'     // Extractor produced wrong value
  | 'BINDING_WRONG_ROLE'   // Value correct but assigned to wrong role
  | 'BINDING_WRONG_SOURCE' // Value from wrong document
  | 'REASONING_OVERRIDE'   // A valid axiom verdict was overridden
  | 'REASONING_MISSED'     // An applicable axiom was not applied
  | 'AXIOM_GAP'            // No axiom exists for this pattern

/**
 * Classified error for learning feedback.
 */
export interface ClassifiedError {
  /** The type of error */
  errorType: ErrorType

  /** The phase where error occurred */
  errorPhase: ErrorPhase

  /** Description of what went wrong */
  description: string

  /** Original bindings (if applicable) */
  aiBindings?: Partial<Record<UniversalRole, BoundValue>>

  /** Human's corrected bindings (if applicable) */
  humanBindings?: Partial<Record<UniversalRole, BoundValue>>

  /** Specific differences between original and human */
  bindingDiff?: BindingDiff[]

  /** Axiom that was violated/missed (if applicable) */
  axiomCode?: string
}

/**
 * Difference between original and human bindings.
 */
export interface BindingDiff {
  /** The role that differs */
  role: UniversalRole

  /** What was originally bound */
  aiValue: BoundValue | null

  /** What human corrected to */
  humanValue: BoundValue | null

  /** Type of difference */
  diffType: 'missing' | 'wrong_value' | 'wrong_source' | 'added'
}

// ============================================================================
// DOMAIN MAPPING
// ============================================================================

/**
 * Mapping from domain-specific field paths to universal roles.
 */
export interface DomainFieldMapping {
  /** The domain this mapping applies to (e.g., 'invoice') */
  domain: string

  /** Primary field path in domain documents (supports dot notation) */
  fieldPath: string

  /** Alternative field paths to try if primary fails (fuzzy resolution) */
  alternativePaths?: string[]

  /** Field name aliases to try during fuzzy search */
  fieldAliases?: string[]

  /** The universal role this field maps to */
  role: UniversalRole

  /** Document type this mapping applies to */
  documentType: 'invoice' | 'contract' | 'evidence' | 'any'

  /** Priority (higher = prefer this mapping) */
  priority: number

  /** Optional transformation function name */
  transform?: string

  /** Enable fuzzy matching for this field (default: true) */
  fuzzyMatch?: boolean
}

/**
 * Complete domain ontology with all field mappings.
 */
export interface DomainOntology {
  /** Domain identifier */
  domainId: string

  /** Human-readable domain name */
  domainName: string

  /** All field mappings for this domain */
  mappings: DomainFieldMapping[]

  /** Domain-specific axiom overrides (by short code) */
  axiomOverrides?: Record<string, Partial<ComputationalAxiom>>

  /**
   * How each of this ontology's roles is typed and normalized. A ruleset declares this so the bridge does not
   * need a hard-coded role list per domain. Roles absent here fall back to the bridge's built-in lists.
   */
  roleKinds?: Partial<Record<UniversalRole, RoleKind>>

  /**
   * Candidate keys for the per-line array on the document under test, in preference order
   * (e.g. ['schedule_of_values', 'line_items']). Default: ['line_items'].
   */
  lineArrayKeys?: string[]
}

/**
 * The normalization/type family a role belongs to.
 *   amount    — currency (cents-rounded)        rate      — a fraction; "8.25%" → 0.0825, never cent-rounded
 *   quantity  — count / hours                   date      — calendar date
 *   reference — identifier string               string    — free text     array — list of strings
 */
export type RoleKind = 'amount' | 'rate' | 'quantity' | 'date' | 'reference' | 'string' | 'array'
