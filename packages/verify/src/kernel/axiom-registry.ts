/**
 * Axiom Registry - Computational Axiom Schemas
 *
 * Each axiom becomes an executable predicate that can be mathematically evaluated.
 * These replace "English hints to AI" with "Code-enforced mathematical rules."
 */

import type {
  ComputationalAxiom,
  UniversalRole,
} from './types.js'

// ============================================================================
// CORE FORENSIC AXIOMS
// ============================================================================

/**
 * AX-RATE_SUP: Law of Rate Supremacy
 * A claimed rate cannot exceed the contracted rate.
 *
 * Predicate: RATE_APPLIED <= RATE_CONTRACTED
 */
export const RATE_SUPREMACY: ComputationalAxiom = {
  id: 'ax-rate-sup',
  shortCode: 'RATE_SUP',
  name: 'Law of Rate Supremacy',
  axiomStatement: 'A claimed rate cannot exceed the contracted rate',
  formalForm: '∀r: r_applied ≤ r_contracted',
  predicates: [
    {
      leftRole: 'RATE_APPLIED',
      operator: '<=',
      rightRole: 'RATE_CONTRACTED',
      tolerance: 0.01, // 1 cent tolerance
      description: 'Invoice rate must not exceed contracted rate',
    },
  ],
  requiredRoles: ['RATE_APPLIED', 'RATE_CONTRACTED'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: [], // Universal
}

/**
 * AX-QTY_MATCH: Law of Quantity Match
 * Claimed quantity must equal verified quantity from evidence.
 *
 * Predicate: CLAIMED_QUANTITY = ACTUAL_QUANTITY
 */
export const QUANTITY_MATCH: ComputationalAxiom = {
  id: 'ax-qty-match',
  shortCode: 'QTY_MATCH',
  name: 'Law of Quantity Match',
  axiomStatement: 'Claimed quantity must match verified quantity from evidence',
  formalForm: '∀q: q_claimed = q_verified',
  predicates: [
    {
      leftRole: 'CLAIMED_QUANTITY',
      operator: '=',
      rightRole: 'ACTUAL_QUANTITY',
      tolerance: 0.001, // Small tolerance for rounding
      description: 'Invoice quantity must match evidence quantity',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: [],
}

/**
 * AX-TIME_ORD: Law of Temporal Order
 * Service date must fall within contract effective period.
 *
 * Predicates:
 *   EVENT_DATE >= CONTRACT_START
 *   EVENT_DATE <= CONTRACT_END
 */
export const TEMPORAL_ORDER: ComputationalAxiom = {
  id: 'ax-time-ord',
  shortCode: 'TIME_ORD',
  name: 'Law of Temporal Order',
  axiomStatement: 'Service date must fall within contract effective period',
  formalForm: '∀t: contract_start ≤ t_event ≤ contract_end',
  predicates: [
    {
      leftRole: 'EVENT_DATE',
      operator: '>=',
      rightRole: 'CONTRACT_START',
      description: 'Service date must be on or after contract start',
    },
    {
      leftRole: 'EVENT_DATE',
      operator: '<=',
      rightRole: 'CONTRACT_END',
      description: 'Service date must be on or before contract end',
    },
  ],
  requiredRoles: ['EVENT_DATE', 'CONTRACT_START', 'CONTRACT_END'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: [],
}

/**
 * AX-DUP_PROHIB: Law of Duplicate Prohibition
 * A claim cannot duplicate a prior approved claim.
 *
 * Predicate: PRIOR_CLAIM_IDS = [] (empty array)
 */
export const DUPLICATE_PROHIBITION: ComputationalAxiom = {
  id: 'ax-dup-prohib',
  shortCode: 'DUP_PROHIB',
  name: 'Law of Duplicate Prohibition',
  axiomStatement: 'A claim cannot duplicate a prior approved claim',
  formalForm: '∀c: prior_claims(c) = ∅',
  predicates: [
    {
      leftRole: 'PRIOR_CLAIM_IDS',
      operator: 'EMPTY',
      rightRole: null,
      description: 'No prior claims should exist for this service',
    },
  ],
  requiredRoles: ['PRIOR_CLAIM_IDS'],
  combinationLogic: 'AND',
  detectableBy: 'BOTH', // May need LLM to identify fuzzy duplicates
  severity: 'critical',
  applicableDomains: [],
}

/**
 * AX-MATH_INT: Law of Mathematical Integrity
 * Claimed amount must equal verified/calculated amount.
 *
 * Predicate: CLAIMED_AMOUNT = VERIFIED_AMOUNT (or LINE_ITEM_TOTAL = EXPECTED_TOTAL)
 */
export const MATH_INTEGRITY: ComputationalAxiom = {
  id: 'ax-math-int',
  shortCode: 'MATH_INT',
  name: 'Law of Mathematical Integrity',
  axiomStatement: 'Claimed amount must equal calculated/verified amount',
  formalForm: '∀a: a_claimed = a_calculated',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT',
      operator: '=',
      rightRole: 'VERIFIED_AMOUNT',
      tolerance: 0.01, // 1 cent tolerance
      description: 'Invoice amount must match verified amount',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'VERIFIED_AMOUNT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: [],
}

/**
 * AX-AMT_CAP: Law of Amount Cap
 * Claimed amount cannot exceed contracted limit.
 *
 * Predicate: CLAIMED_AMOUNT <= CONTRACTED_LIMIT
 */
export const AMOUNT_CAP: ComputationalAxiom = {
  id: 'ax-amt-cap',
  shortCode: 'AMT_CAP',
  name: 'Law of Amount Cap',
  axiomStatement: 'Claimed amount cannot exceed contracted maximum',
  formalForm: '∀a: a_claimed ≤ a_max',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT',
      operator: '<=',
      rightRole: 'CONTRACTED_LIMIT',
      tolerance: 0.01,
      description: 'Invoice amount must not exceed contracted limit',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: [],
}

// ============================================================================
// EXTENDED AXIOMS (LLM-ASSISTED)
// ============================================================================

/**
 * AX-EVID_REQ: Law of Evidence Requirement
 * Every claim must have supporting evidence.
 *
 * SEMI-COMPUTABLE: Can detect missing evidence (null check),
 * but fuzzy evidence matching still requires LLM.
 *
 * When ACTUAL_QUANTITY or VERIFIED_AMOUNT is null, we know evidence is missing.
 * This is NOT lockable since LLM may find evidence in ways we can't detect.
 */
export const EVIDENCE_REQUIREMENT: ComputationalAxiom = {
  id: 'ax-evid-req',
  shortCode: 'EVID_REQ',
  name: 'Law of Evidence Requirement',
  axiomStatement: 'Every claim must have supporting documentary evidence',
  formalForm: '∀c: evidence(c) ≠ ∅',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY',
      operator: 'EXISTS',
      rightRole: null,
      description: 'Evidence quantity must exist for claimed items',
    },
  ],
  requiredRoles: [], // No roles required - we're checking if evidence EXISTS
  combinationLogic: 'AND',
  detectableBy: 'BOTH', // Semi-computable: can detect missing, but LLM verifies match
  severity: 'medium',
  applicableDomains: [],
}

/**
 * AX-DESC_MATCH: Law of Description Match
 * Service description must match evidence description.
 *
 * LLM-ONLY: Semantic matching requires natural language understanding.
 * Word overlap metrics (Jaccard) fail on paraphrases and synonyms.
 * Role bindings are maintained for provenance reporting.
 */
export const DESCRIPTION_MATCH: ComputationalAxiom = {
  id: 'ax-desc-match',
  shortCode: 'DESC_MATCH',
  name: 'Law of Description Match',
  axiomStatement: 'Invoice service description must match evidence documentation',
  formalForm: '∀d: semantic_match(d_invoice, d_evidence) = true',
  predicates: [], // No computational predicates - LLM handles semantic matching
  requiredRoles: ['INVOICE_DESCRIPTION', 'EVIDENCE_DESCRIPTION'], // Kept for binding/provenance
  combinationLogic: 'AND',
  detectableBy: 'LLM', // Semantic matching requires LLM
  severity: 'medium',
  applicableDomains: [],
}

/**
 * AX-OMISSION: Law of Structural Completeness
 * Required data fields must be present for validation.
 *
 * PRECOMPUTABLE: Pure structural check - if required bindings resolve to null,
 * the document has a structural void that makes proper validation impossible.
 *
 * This axiom generates CRITICAL findings for missing required data.
 */
export const STRUCTURAL_OMISSION: ComputationalAxiom = {
  id: 'ax-omission',
  shortCode: 'OMISSION',
  name: 'Law of Structural Completeness',
  axiomStatement: 'Required data fields must be present for validation to proceed',
  formalForm: '∀f ∈ RequiredFields: f ≠ ∅',
  predicates: [], // Omission detection is handled by omission-detector.ts, not predicates
  requiredRoles: [], // Dynamic - depends on domain configuration
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: [], // Universal - applies to all domains
}

// ============================================================================
// THE OCTAGON - SPECIALIZED DOMAIN AXIOMS
// ============================================================================

/**
 * AX-TERM_GUAR: Termination Guarantee (Code Domain)
 * All loops must have verified exit conditions.
 *
 * Predicate: ACTUAL_QUANTITY (verified exits) >= CLAIMED_QUANTITY (claimed exits)
 *           AND CLAIMED_QUANTITY >= 1
 */
export const TERMINATION_GUARANTEE: ComputationalAxiom = {
  id: 'ax-term-guar',
  shortCode: 'TERMINATION_GUARANTEE',
  name: 'Law of Termination Guarantee',
  axiomStatement: 'All execution paths must have verified termination conditions',
  formalForm: '∀loop: verified_exits(loop) ≥ 1',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Verified exits
      operator: '>=',
      rightRole: 'CLAIMED_QUANTITY', // Claimed exits
      tolerance: 0,
      description: 'Verified exits must match or exceed claimed exits',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: ['code'],
}

/**
 * AX-STATE_EX: State Exclusivity (Code Domain)
 * Shared state must be protected by synchronization.
 *
 * Predicate: synchronized_accesses >= shared_variables
 */
export const STATE_EXCLUSIVITY: ComputationalAxiom = {
  id: 'ax-state-ex',
  shortCode: 'STATE_EXCLUSIVITY',
  name: 'Law of State Exclusivity',
  axiomStatement: 'All shared state must be protected by synchronization primitives',
  formalForm: '∀v ∈ SharedVars: synchronized(v)',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Synchronized accesses
      operator: '>=',
      rightRole: 'CLAIMED_QUANTITY', // Shared variables
      tolerance: 0,
      description: 'All shared variables must have synchronization',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['code'],
}

/**
 * AX-MEM_CONS: Memory Conservation (Code Domain)
 * Allocations must equal releases (no leaks).
 *
 * Predicate: releases >= allocations
 */
export const MEMORY_CONSERVATION: ComputationalAxiom = {
  id: 'ax-mem-cons',
  shortCode: 'MEMORY_CONSERVATION',
  name: 'Law of Memory Conservation',
  axiomStatement: 'All memory allocations must have corresponding releases',
  formalForm: '∀alloc: ∃release(alloc)',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Releases
      operator: '>=',
      rightRole: 'CLAIMED_QUANTITY', // Allocations
      tolerance: 0,
      description: 'Releases must match or exceed allocations',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['code'],
}

/**
 * AX-ORG_DIST: Organic Distribution (Media Domain)
 * Human activity follows bell curves, not step functions.
 *
 * Predicate: entropy_score >= 0.7 (high randomness = organic)
 */
export const ORGANIC_DISTRIBUTION: ComputationalAxiom = {
  id: 'ax-org-dist',
  shortCode: 'ORGANIC_DISTRIBUTION',
  name: 'Law of Organic Distribution',
  axiomStatement: 'Human activity patterns follow natural distributions with high entropy',
  formalForm: '∀activity: entropy(timestamps) ≥ 0.7',
  predicates: [
    {
      leftRole: 'RATE_APPLIED', // Actual entropy
      operator: '>=',
      rightRole: 'RATE_CONTRACTED', // Required entropy (0.7)
      tolerance: 0.05,
      description: 'Activity entropy must indicate organic behavior',
    },
  ],
  requiredRoles: ['RATE_APPLIED', 'RATE_CONTRACTED'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: ['media'],
}

/**
 * AX-VOTE_CONS: Vote Conservation (Media Domain)
 * Votes cannot exceed registered voters.
 *
 * Predicate: total_votes <= registered_voters
 */
export const VOTE_CONSERVATION: ComputationalAxiom = {
  id: 'ax-vote-cons',
  shortCode: 'VOTE_CONSERVATION',
  name: 'Law of Vote Conservation',
  axiomStatement: 'Total votes cast cannot exceed registered voter count',
  formalForm: '∀election: votes_cast ≤ registered_voters',
  predicates: [
    {
      leftRole: 'CLAIMED_QUANTITY', // Votes cast
      operator: '<=',
      rightRole: 'CONTRACTED_LIMIT', // Registered voters
      tolerance: 0,
      description: 'Votes must not exceed registration',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: ['media'],
}

/**
 * AX-TRANS_PROP: Transitive Property (Philosophy Domain)
 * If A=B and B=C, then A=C (logical validity).
 *
 * Predicate: verified_links >= stated_links
 */
export const TRANSITIVE_PROPERTY: ComputationalAxiom = {
  id: 'ax-trans-prop',
  shortCode: 'TRANSITIVE_PROPERTY',
  name: 'Law of Transitive Property',
  axiomStatement: 'Logical chains must preserve validity across all links',
  formalForm: '(A→B ∧ B→C) → (A→C)',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Verified links
      operator: '>=',
      rightRole: 'CLAIMED_QUANTITY', // Stated links
      tolerance: 0,
      description: 'All logical links must be verified',
    },
  ],
  requiredRoles: ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'critical',
  applicableDomains: ['philosophy'],
}

/**
 * AX-CIRC_PROHIB: Circular Prohibition (Philosophy Domain)
 * Conclusion cannot appear in premises (begging the question).
 *
 * Predicate: circular_reference < 0.1
 */
export const CIRCULAR_PROHIBITION: ComputationalAxiom = {
  id: 'ax-circ-prohib',
  shortCode: 'CIRCULAR_PROHIBITION',
  name: 'Law of Circular Prohibition',
  axiomStatement: 'Arguments must not beg the question (conclusion in premise)',
  formalForm: '∀arg: premise ∩ conclusion = ∅',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Circularity score
      operator: '<',
      rightRole: 'CONTRACTED_LIMIT', // Max allowed (0.1)
      tolerance: 0.01,
      description: 'Circularity must be below threshold',
    },
  ],
  requiredRoles: ['ACTUAL_QUANTITY', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['philosophy'],
}

// ============================================================================
// LEVEL 4: SEMANTIC AXIOMS
// ============================================================================

/**
 * AX-SEM_EUPHEMISM: Euphemism Detection (Semantic Domain)
 * Detects softening/obfuscating language patterns.
 *
 * Layer 1 (Deterministic) - Can achieve LOCKED status
 */
export const EUPHEMISM_DETECTION: ComputationalAxiom = {
  id: 'ax-sem-euphemism',
  shortCode: 'SEM_EUPHEMISM',
  name: 'Law of Plain Language',
  axiomStatement: 'Claims should use direct language, not euphemisms',
  formalForm: '∀text: euphemism_count(text) = 0',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT', // Euphemism count
      operator: '<=',
      rightRole: 'CONTRACTED_LIMIT', // Max allowed (0)
      tolerance: 0,
      description: 'No euphemisms should be present',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'medium',
  applicableDomains: ['finance', 'legal', 'medical', 'science'],
}

/**
 * AX-SEM_DISCLOSURE: Disclosure Requirements (Semantic Domain)
 * Checks for required disclosures in documents.
 *
 * Layer 1 (Deterministic) - Can achieve LOCKED status
 */
export const DISCLOSURE_REQUIREMENTS: ComputationalAxiom = {
  id: 'ax-sem-disclosure',
  shortCode: 'SEM_DISCLOSURE',
  name: 'Law of Required Disclosures',
  axiomStatement: 'Documents must contain all required disclosures',
  formalForm: '∀req ∈ requirements: present(doc, req)',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Disclosures found
      operator: '>=',
      rightRole: 'CLAIMED_QUANTITY', // Disclosures required
      tolerance: 0,
      description: 'All required disclosures must be present',
    },
  ],
  requiredRoles: ['ACTUAL_QUANTITY', 'CLAIMED_QUANTITY'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['finance', 'legal', 'medical', 'science'],
}

/**
 * AX-SEM_PROPORTIONALITY: Proportionality Check (Semantic Domain)
 * Verifies claim magnitude matches evidence magnitude.
 *
 * Layer 1 (Deterministic) - Can achieve LOCKED status
 */
export const PROPORTIONALITY_CHECK: ComputationalAxiom = {
  id: 'ax-sem-proportionality',
  shortCode: 'SEM_PROPORTIONALITY',
  name: 'Law of Proportional Claims',
  axiomStatement: 'Claim magnitudes must be proportional to evidence',
  formalForm: '|claim/evidence| ≤ maxRatio',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT', // Claim magnitude
      operator: '<=',
      rightRole: 'VERIFIED_AMOUNT', // Evidence magnitude × maxRatio
      tolerance: 0.1,
      description: 'Claim must not exceed evidence by ratio threshold',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'VERIFIED_AMOUNT'],
  combinationLogic: 'AND',
  detectableBy: 'PRECOMPUTE',
  severity: 'high',
  applicableDomains: ['finance', 'legal', 'medical', 'science'],
}

/**
 * AX-SEM_CHERRY_PICKING: Cherry-Picking Detection (Semantic Domain)
 * Detects selective data presentation.
 *
 * Layer 3 (LLM-based) - Always FLAGGED status
 */
export const CHERRY_PICKING_DETECTION: ComputationalAxiom = {
  id: 'ax-sem-cherry-picking',
  shortCode: 'SEM_CHERRY_PICKING',
  name: 'Law of Complete Evidence',
  axiomStatement: 'Claims must not selectively present data',
  formalForm: 'cited_data ⊆ relevant_data → ¬cherry_picked',
  predicates: [
    {
      leftRole: 'ACTUAL_QUANTITY', // Cited evidence ratio
      operator: '>=',
      rightRole: 'CONTRACTED_LIMIT', // Minimum coverage (0.8)
      tolerance: 0.1,
      description: 'Must cite sufficient portion of relevant data',
    },
  ],
  requiredRoles: ['ACTUAL_QUANTITY', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'LLM',
  severity: 'high',
  applicableDomains: ['science', 'legal', 'medical'],
}

/**
 * AX-SEM_CAUSAL_VALIDITY: Causal Validity (Semantic Domain)
 * Verifies cause-effect claims are supported by methodology.
 *
 * Layer 3 (LLM-based) - Always FLAGGED status
 */
export const CAUSAL_VALIDITY: ComputationalAxiom = {
  id: 'ax-sem-causal-validity',
  shortCode: 'SEM_CAUSAL_VALIDITY',
  name: 'Law of Causal Validity',
  axiomStatement: 'Causal claims must be supported by appropriate methodology',
  formalForm: 'claim(A→B) → methodology_supports(A→B)',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT', // Methodology strength
      operator: '>=',
      rightRole: 'CONTRACTED_LIMIT', // Required strength for causal claim
      tolerance: 0.05,
      description: 'Methodology must support causal inference',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'LLM',
  severity: 'high',
  applicableDomains: ['science', 'medical'],
}

/**
 * AX-SEM_FRAMING: Framing Analysis (Semantic Domain)
 * Detects biased framing in text.
 *
 * Layer 3 (LLM-based) - Always FLAGGED status
 */
export const FRAMING_ANALYSIS: ComputationalAxiom = {
  id: 'ax-sem-framing',
  shortCode: 'SEM_FRAMING',
  name: 'Law of Neutral Framing',
  axiomStatement: 'Information should be presented without biased framing',
  formalForm: 'bias_score(text) ≤ threshold',
  predicates: [
    {
      leftRole: 'CLAIMED_AMOUNT', // Bias score
      operator: '<=',
      rightRole: 'CONTRACTED_LIMIT', // Max allowed bias
      tolerance: 0.1,
      description: 'Text must not contain excessive framing bias',
    },
  ],
  requiredRoles: ['CLAIMED_AMOUNT', 'CONTRACTED_LIMIT'],
  combinationLogic: 'AND',
  detectableBy: 'LLM',
  severity: 'medium',
  applicableDomains: ['media', 'legal', 'finance'],
}

// ============================================================================
// AXIOM REGISTRY
// ============================================================================

/**
 * All core computational axioms
 */
export const CORE_AXIOMS: ComputationalAxiom[] = [
  RATE_SUPREMACY,
  QUANTITY_MATCH,
  TEMPORAL_ORDER,
  DUPLICATE_PROHIBITION,
  MATH_INTEGRITY,
  AMOUNT_CAP,
]

/**
 * Extended axioms (including LLM-assisted and structural)
 */
export const EXTENDED_AXIOMS: ComputationalAxiom[] = [
  ...CORE_AXIOMS,
  EVIDENCE_REQUIREMENT,
  DESCRIPTION_MATCH,
  STRUCTURAL_OMISSION,
  // The Octagon - Domain-Specific Axioms
  TERMINATION_GUARANTEE,    // Code: loops must terminate
  STATE_EXCLUSIVITY,        // Code: synchronized access
  MEMORY_CONSERVATION,      // Code: no leaks
  ORGANIC_DISTRIBUTION,     // Media: bell curves not step functions
  VOTE_CONSERVATION,        // Media: votes <= voters
  TRANSITIVE_PROPERTY,      // Philosophy: A→B→C implies A→C
  CIRCULAR_PROHIBITION,     // Philosophy: no begging the question
  // Level 4: Semantic Axioms
  EUPHEMISM_DETECTION,      // Semantic: detect softening language
  DISCLOSURE_REQUIREMENTS,  // Semantic: check required disclosures
  PROPORTIONALITY_CHECK,    // Semantic: claim vs evidence magnitude
  CHERRY_PICKING_DETECTION, // Semantic: selective data presentation (LLM)
  CAUSAL_VALIDITY,          // Semantic: cause-effect validity (LLM)
  FRAMING_ANALYSIS,         // Semantic: biased framing (LLM)
]

/**
 * Map of axiom short codes to axioms
 */
export const AXIOM_BY_CODE: Map<string, ComputationalAxiom> = new Map(
  EXTENDED_AXIOMS.map(a => [a.shortCode, a])
)

/**
 * Map of axiom IDs to axioms
 */
export const AXIOM_BY_ID: Map<string, ComputationalAxiom> = new Map(
  EXTENDED_AXIOMS.map(a => [a.id, a])
)

// ============================================================================
// REGISTRY CLASS
// ============================================================================

/**
 * AxiomRegistry manages computational axioms and their lookups.
 */
export class AxiomRegistry {
  private axioms: Map<string, ComputationalAxiom> = new Map()
  private axiomsByCode: Map<string, ComputationalAxiom> = new Map()

  constructor() {
    // Load default axioms
    for (const axiom of EXTENDED_AXIOMS) {
      this.register(axiom)
    }
  }

  /**
   * Register a computational axiom
   */
  register(axiom: ComputationalAxiom): void {
    this.axioms.set(axiom.id, axiom)
    this.axiomsByCode.set(axiom.shortCode, axiom)
  }

  /**
   * Get axiom by ID
   */
  getById(id: string): ComputationalAxiom | undefined {
    return this.axioms.get(id)
  }

  /**
   * Get axiom by short code
   */
  getByCode(code: string): ComputationalAxiom | undefined {
    return this.axiomsByCode.get(code)
  }

  /**
   * Get all axioms
   */
  getAll(): ComputationalAxiom[] {
    return Array.from(this.axioms.values())
  }

  /**
   * Get axioms applicable to a domain
   */
  getForDomain(domainId: string): ComputationalAxiom[] {
    return this.getAll().filter(
      a => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
    )
  }

  /**
   * Get precomputable axioms (can be evaluated without LLM)
   */
  getPrecomputable(): ComputationalAxiom[] {
    return this.getAll().filter(
      a => a.detectableBy === 'PRECOMPUTE' || a.detectableBy === 'BOTH'
    )
  }

  /**
   * Get LLM-required axioms
   */
  getLLMRequired(): ComputationalAxiom[] {
    return this.getAll().filter(a => a.detectableBy === 'LLM')
  }

  /**
   * Get axioms that require specific roles
   */
  getRequiringRoles(roles: UniversalRole[]): ComputationalAxiom[] {
    const roleSet = new Set(roles)
    return this.getAll().filter(
      a => a.requiredRoles.every(r => roleSet.has(r))
    )
  }

  /**
   * Check if axiom is applicable given available bindings
   */
  isApplicable(axiomId: string, availableRoles: UniversalRole[]): boolean {
    const axiom = this.axioms.get(axiomId)
    if (!axiom) return false
    const roleSet = new Set(availableRoles)
    return axiom.requiredRoles.every(r => roleSet.has(r))
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let registryInstance: AxiomRegistry | null = null

/**
 * Get or create the axiom registry singleton
 */
export function getAxiomRegistry(): AxiomRegistry {
  if (!registryInstance) {
    registryInstance = new AxiomRegistry()
  }
  return registryInstance
}

/**
 * Reset the registry singleton (for testing)
 */
export function resetAxiomRegistry(): void {
  registryInstance = null
}

export default AxiomRegistry
