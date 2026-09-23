/**
 * Validation Gavel - Deterministic Predicate Checker
 *
 * The "Mathematical Gavel" that evaluates axiom predicates deterministically.
 * If isLocked === true, no downstream reasoner may override this verdict.
 *
 * Vendored 2026-09-22 from an earlier internal engine and hardened here.
 * Stripped: the database-backed dynamic-axiom loader (Supabase / proper-axiom),
 * an experimental axiomsOverride path, `@ts-nocheck`, and all console output.
 * The static evaluation path is preserved verbatim in logic.
 */

import type {
  ComputationalAxiom,
  BindingContext,
  UniversalRole,
  AxiomPredicate,
  PredicateResult,
  ValidationResult,
  ValidationReport,
  GavelVerdict,
  ConfidenceLevel,
} from './types.js'
import { getAxiomRegistry } from './axiom-registry.js'

// ============================================================================
// LOGGING (injectable, silent by default — a verifier must not spray stdout)
// ============================================================================

export type GavelLogger = (message: string) => void
let log: GavelLogger = () => {}

/** Install a logger (e.g. for debugging or structured telemetry). Pass undefined to silence. */
export function setGavelLogger(logger?: GavelLogger): void {
  log = logger ?? (() => {})
}

/** A Date that actually holds a time. Invalid Dates are never compared or formatted — they are type mismatches. */
function isValidDate(x: unknown): x is Date {
  return x instanceof Date && !isNaN(x.getTime())
}

// ============================================================================
// VALIDATION GAVEL CLASS
// ============================================================================

/**
 * ValidationGavel evaluates axiom predicates against bound values.
 * This is the core "code enforcement" layer that locks findings.
 */
export class ValidationGavel {
  private readonly DEFAULT_TOLERANCE = 0.01 // 1 cent for currency

  /**
   * Get human-readable hint for what to supply for a role.
   */
  private getRoleHint(role: UniversalRole): string {
    const hints: Partial<Record<UniversalRole, string>> = {
      RATE_APPLIED: 'the rate/unit price from the invoice',
      RATE_CONTRACTED: 'the contracted rate from the contract',
      CLAIMED_AMOUNT: 'the billed/invoiced amount',
      VERIFIED_AMOUNT: 'the verified amount from evidence',
      CONTRACTED_LIMIT: 'the maximum allowed amount from contract',
      CLAIMED_QUANTITY: 'the quantity claimed on the invoice',
      ACTUAL_QUANTITY: 'the actual quantity from evidence (field tickets)',
      EVENT_DATE: 'the service date from the invoice',
      CONTRACT_START: 'the contract effective/start date',
      CONTRACT_END: 'the contract expiration/end date',
      DOCUMENT_ID: 'the invoice or document number',
      PRIOR_CLAIM_IDS: 'prior_invoice_ids — an array of previously seen invoice numbers, supplied by the caller, for duplicate detection',
      LINE_ITEM_TOTAL: 'the computed line item total',
      EXPECTED_TOTAL: 'the expected total based on contract rates',
      INVOICE_DESCRIPTION: 'the service description from the invoice',
      EVIDENCE_DESCRIPTION: 'the service description from evidence',
      SUBTOTAL: 'the stated subtotal from the invoice',
      TAX_AMOUNT: 'the stated tax amount from the invoice',
      TAX_RATE: 'the stated tax rate from the invoice',
      DISCOUNT_AMOUNT: 'the stated discount from the invoice',
      GRAND_TOTAL: 'the stated grand total from the invoice',
      LINE_ITEMS_SUM: 'the sum of line item amounts (computed)',
      CURRENCY_CODE: 'the ISO-4217 currency code',
    }
    return hints[role] ?? role
  }

  /**
   * Validate a single axiom against bindings.
   */
  validateAxiom(axiom: ComputationalAxiom, bindings: BindingContext): ValidationResult {
    // Check if all required roles are bound
    const missingRoles: UniversalRole[] = []
    for (const role of axiom.requiredRoles) {
      if (!bindings.bindings[role] || bindings.bindings[role]?.value === null) {
        missingRoles.push(role)
      }
    }

    if (missingRoles.length > 0) {
      // Calculate binding coverage percentage
      const boundCount = axiom.requiredRoles.length - missingRoles.length
      const bindingCoverage = axiom.requiredRoles.length > 0
        ? (boundCount / axiom.requiredRoles.length) * 100
        : 0

      // Generate hint for the caller
      const extractionHint = `Please supply: ${missingRoles.map(r => this.getRoleHint(r)).join(', ')}`

      return {
        axiomId: axiom.id,
        axiomCode: axiom.shortCode,
        verdict: 'INSUFFICIENT_DATA',
        confidence: 'LOW',
        isLocked: false,
        predicateResults: [],
        missingRoles,
        bindingCoverage,
        extractionHint,
        validatedAt: new Date(),
        explanation: `Cannot evaluate: missing bindings for ${missingRoles.join(', ')}`,
      }
    }

    // Evaluate all predicates
    const predicateResults: PredicateResult[] = []
    for (const predicate of axiom.predicates) {
      const result = this.evaluatePredicate(predicate, bindings)
      predicateResults.push(result)
    }

    // Determine verdict based on combination logic
    let passed: boolean
    if (axiom.combinationLogic === 'AND') {
      passed = predicateResults.every(r => r.passed)
    } else {
      passed = predicateResults.some(r => r.passed)
    }

    // Calculate confidence based on binding quality
    const confidence = this.calculateConfidence(bindings, axiom.requiredRoles)

    // Determine if finding should be LOCKED
    // v4.5 EPISTEMIC CONSTITUTION:
    // 1. ALL bindings must be high confidence (≥90% after correlation adjustment)
    // 2. If axiom uses evidence/contract roles, correlation must also be HIGH
    // This prevents locking when semantic matching was uncertain
    const allBindingsHighConfidence = this.allRequiredBindingsExact(bindings, axiom.requiredRoles)

    // v4.5: Additional check - correlation must be reliable for evidence/contract axioms
    const needsCorrelation = this.axiomNeedsCorrelation(axiom)
    const correlationIsReliable = this.checkCorrelationReliable(bindings, needsCorrelation)

    if ((needsCorrelation.contract || needsCorrelation.evidence) && !correlationIsReliable) {
      log(`[ValidationGavel] Locking prevented: ${axiom.shortCode} requires reliable correlation but correlation is weak/missing`)
    }

    const isLocked =
      !passed &&
      allBindingsHighConfidence &&  // ALL bindings must be exact matches
      (!(needsCorrelation.contract || needsCorrelation.evidence) || correlationIsReliable) &&  // v4.5: Correlation must be reliable if needed
      (
        axiom.detectableBy === 'PRECOMPUTE' ||
        // Lock BOTH axioms only for definitive negative checks
        // We can prove absence of data; a reasoner can't find what doesn't exist
        (axiom.detectableBy === 'BOTH' && this.isDefinitiveNegativeResult(axiom, predicateResults))
      )

    // Calculate total variance (for numeric axioms)
    // v5.21: For rate-based axioms, multiply variance by quantity to get total overcharge
    const variance = this.calculateVariance(predicateResults, bindings, axiom)

    // Generate explanation
    const explanation = this.generateExplanation(axiom, predicateResults, passed)

    return {
      axiomId: axiom.id,
      axiomCode: axiom.shortCode,
      verdict: passed ? 'PASS' : 'FAIL',
      confidence,
      isLocked,
      variance,
      predicateResults,
      bindingCoverage: 100, // All required roles were bound if we got here
      validatedAt: new Date(),
      explanation,
    }
  }

  /**
   * Validate all applicable axioms against bindings.
   */
  validateAll(bindings: BindingContext, domainId?: string): ValidationReport {
    const registry = getAxiomRegistry()
    const axioms = domainId
      ? registry.getForDomain(domainId)
      : registry.getAll()

    const results: ValidationResult[] = []
    for (const axiom of axioms) {
      const result = this.validateAxiom(axiom, bindings)
      results.push(result)
    }

    return this.summarize(bindings.invoiceId, results)
  }

  /**
   * Validate precomputable axioms only (fast path, no reasoner needed).
   * Evaluates the static registry, optionally filtered to a domain.
   */
  validatePrecomputable(bindings: BindingContext, domainId?: string): ValidationReport {
    const registry = getAxiomRegistry()

    let axioms = registry.getPrecomputable()
    if (domainId) {
      axioms = axioms.filter(
        a => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
      )
    }

    const results: ValidationResult[] = []
    for (const axiom of axioms) {
      results.push(this.validateAxiom(axiom, bindings))
    }

    return this.summarize(bindings.invoiceId, results)
  }

  /**
   * Build the report summary from results.
   */
  private summarize(invoiceId: string, results: ValidationResult[]): ValidationReport {
    const lockedFailures = results.filter(r => r.isLocked).length
    const passCount = results.filter(r => r.verdict === 'PASS').length
    const failCount = results.filter(r => r.verdict === 'FAIL').length
    const insufficientCount = results.filter(r => r.verdict === 'INSUFFICIENT_DATA').length

    return {
      invoiceId,
      results,
      lockedFailures,
      passCount,
      failCount,
      insufficientCount,
      generatedAt: new Date(),
    }
  }

  /**
   * Evaluate a single predicate against bindings.
   * v4.5: Includes binding provenance with full normalization audit trail.
   */
  private evaluatePredicate(
    predicate: AxiomPredicate,
    bindings: BindingContext
  ): PredicateResult {
    const leftBound = bindings.bindings[predicate.leftRole]
    const leftValue = leftBound?.value ?? null

    // Build provenance for left binding (v4.5: includes normalization metadata)
    const leftProvenance = leftBound ? {
      role: predicate.leftRole,
      value: leftBound.value,
      source: leftBound.source,
      fieldPath: leftBound.field,
      confidence: leftBound.confidence,
      // v4.5: Normalization audit trail
      originalValue: leftBound.originalValue,
      normalizedValue: leftBound.normalizedValue,
      normalizations: leftBound.normalizations,
    } : undefined

    // Get right-hand value (from role or constant)
    let rightValue: number | string | Date | string[] | null = null
    let rightProvenance: PredicateResult['rightProvenance'] = undefined

    if (predicate.rightRole) {
      const rightBound = bindings.bindings[predicate.rightRole]
      rightValue = rightBound?.value ?? null

      // Build provenance for right binding (v4.5: includes normalization metadata)
      if (rightBound) {
        rightProvenance = {
          role: predicate.rightRole,
          value: rightBound.value,
          source: rightBound.source,
          fieldPath: rightBound.field,
          confidence: rightBound.confidence,
          // v4.5: Normalization audit trail
          originalValue: rightBound.originalValue,
          normalizedValue: rightBound.normalizedValue,
          normalizations: rightBound.normalizations,
        }
      }
    } else if (predicate.constant !== undefined) {
      rightValue = predicate.constant
    }

    // Handle null/missing values - but EXISTS/NOT_EXISTS are specifically checking for null
    if (leftValue === null && predicate.operator !== 'EXISTS' && predicate.operator !== 'NOT_EXISTS') {
      return {
        predicate,
        passed: false,
        leftValue: null,
        rightValue,
        failureReason: `Left value (${predicate.leftRole}) is missing`,
        leftProvenance,
        rightProvenance,
      }
    }

    // an Invalid Date is not comparable: report a type mismatch (→ UNPARSEABLE upstream), never a verdict
    if ((leftValue instanceof Date && !isValidDate(leftValue)) || (rightValue instanceof Date && !isValidDate(rightValue))) {
      return { predicate, passed: false, leftValue, rightValue, failureReason: 'Type mismatch: invalid date value', leftProvenance, rightProvenance }
    }

    // Evaluate based on operator
    const tolerance = predicate.tolerance ?? this.DEFAULT_TOLERANCE
    let passed = false
    let variance: number | undefined
    let failureReason: string | undefined

    switch (predicate.operator) {
      case '<=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = leftValue <= rightValue + tolerance
          variance = leftValue - rightValue
          if (!passed) failureReason = `${leftValue} > ${rightValue}`
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue <= rightValue
          if (!passed) failureReason = `${leftValue.toISOString()} > ${rightValue.toISOString()}`
        } else {
          failureReason = 'Type mismatch for <= comparison'
        }
        break

      case '>=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = leftValue >= rightValue - tolerance
          variance = leftValue - rightValue
          if (!passed) failureReason = `${leftValue} < ${rightValue}`
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue >= rightValue
          if (!passed) failureReason = `${leftValue.toISOString()} < ${rightValue.toISOString()}`
        } else {
          failureReason = 'Type mismatch for >= comparison'
        }
        break

      case '=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = Math.abs(leftValue - rightValue) <= tolerance
          variance = leftValue - rightValue
          if (!passed) failureReason = `${leftValue} ≠ ${rightValue} (diff: ${variance.toFixed(2)})`
        } else if (typeof leftValue === 'string' && typeof rightValue === 'string') {
          passed = leftValue === rightValue
          if (!passed) failureReason = `"${leftValue}" ≠ "${rightValue}"`
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue.getTime() === rightValue.getTime()
          if (!passed) failureReason = `${leftValue.toISOString()} ≠ ${rightValue.toISOString()}`
        } else {
          passed = leftValue === rightValue
          if (!passed) failureReason = `${String(leftValue)} ≠ ${String(rightValue)}`
        }
        break

      case '!=':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = Math.abs(leftValue - rightValue) > tolerance
          if (!passed) failureReason = `${leftValue} = ${rightValue}`
        } else {
          passed = leftValue !== rightValue
          if (!passed) failureReason = `${String(leftValue)} = ${String(rightValue)}`
        }
        break

      case '<':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = leftValue < rightValue
          variance = leftValue - rightValue
          if (!passed) failureReason = `${leftValue} >= ${rightValue}`
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue < rightValue
          if (!passed) failureReason = `${leftValue.toISOString()} >= ${rightValue.toISOString()}`
        } else {
          failureReason = 'Type mismatch for < comparison'
        }
        break

      case '>':
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          passed = leftValue > rightValue
          variance = leftValue - rightValue
          if (!passed) failureReason = `${leftValue} <= ${rightValue}`
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue > rightValue
          if (!passed) failureReason = `${leftValue.toISOString()} <= ${rightValue.toISOString()}`
        } else {
          failureReason = 'Type mismatch for > comparison'
        }
        break

      case 'IN':
        if (Array.isArray(rightValue)) {
          passed = rightValue.includes(String(leftValue))
          if (!passed) failureReason = `${String(leftValue)} not in [${rightValue.join(', ')}]`
        } else {
          failureReason = 'Right value must be array for IN operator'
        }
        break

      case 'NOT_IN':
        if (Array.isArray(rightValue)) {
          passed = !rightValue.includes(String(leftValue))
          if (!passed) failureReason = `${String(leftValue)} found in [${rightValue.join(', ')}]`
        } else {
          failureReason = 'Right value must be array for NOT_IN operator'
        }
        break

      case 'EMPTY':
        if (Array.isArray(leftValue)) {
          passed = leftValue.length === 0
          if (!passed) failureReason = `Array has ${leftValue.length} elements`
        } else {
          failureReason = 'Left value must be array for EMPTY operator'
        }
        break

      case 'NOT_EMPTY':
        if (Array.isArray(leftValue)) {
          passed = leftValue.length > 0
          if (!passed) failureReason = 'Array is empty'
        } else {
          failureReason = 'Left value must be array for NOT_EMPTY operator'
        }
        break

      case 'EXISTS':
        // Semi-computable: Check if the value exists (is not null/undefined)
        passed = leftValue !== null && leftValue !== undefined
        if (!passed) failureReason = `${predicate.leftRole} does not exist (no evidence)`
        break

      case 'NOT_EXISTS':
        // Check if the value does NOT exist
        passed = leftValue === null || leftValue === undefined
        if (!passed) failureReason = `${predicate.leftRole} exists when it should not`
        break

      case 'SIMILAR_TO': {
        // Fuzzy string similarity using Jaccard index
        if (typeof leftValue !== 'string' || typeof rightValue !== 'string') {
          failureReason = 'SIMILAR_TO requires string values'
          break
        }
        const similarity = this.computeStringSimilarity(leftValue, rightValue)
        const threshold = tolerance // tolerance doubles as similarity threshold (axiom should specify)
        passed = similarity >= threshold
        variance = 1 - similarity // Distance from perfect match
        if (!passed) {
          const leftPreview = leftValue.length > 50 ? leftValue.slice(0, 50) + '...' : leftValue
          const rightPreview = rightValue.length > 50 ? rightValue.slice(0, 50) + '...' : rightValue
          failureReason = `Similarity: ${(similarity * 100).toFixed(0)}% (threshold: ${(threshold * 100).toFixed(0)}%) - "${leftPreview}" vs "${rightPreview}"`
        }
        break
      }

      default:
        failureReason = `Unknown operator: ${String(predicate.operator)}`
    }

    return {
      predicate,
      passed,
      leftValue,
      rightValue,
      variance,
      failureReason,
      leftProvenance,
      rightProvenance,
    }
  }

  /**
   * Calculate confidence level based on binding quality.
   */
  private calculateConfidence(
    bindings: BindingContext,
    requiredRoles: UniversalRole[]
  ): ConfidenceLevel {
    const confidences: number[] = []

    for (const role of requiredRoles) {
      const bound = bindings.bindings[role]
      if (bound) {
        confidences.push(bound.confidence)
      }
    }

    if (confidences.length === 0) return 'LOW'

    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length

    if (avgConfidence >= 90) return 'HIGH'
    if (avgConfidence >= 70) return 'MEDIUM'
    return 'LOW'
  }

  /**
   * Calculate total variance from predicate results.
   *
   * v5.21: For rate-based axioms (RATE_SUP), multiply the per-unit variance by quantity
   * to get the total overcharge. This ensures locked variance reflects actual savings.
   */
  private calculateVariance(
    results: PredicateResult[],
    bindings: BindingContext,
    axiom: ComputationalAxiom
  ): number | undefined {
    const variances = results
      .filter(r => r.variance !== undefined)
      .map(r => r.variance as number)

    if (variances.length === 0) return undefined

    const baseVariance = variances.reduce((a, b) => a + Math.abs(b), 0)

    // v5.21: For rate-based axioms, multiply by quantity to get total overcharge
    const isRateAxiom = axiom.shortCode === 'RATE_SUP'
    if (isRateAxiom) {
      const quantity = bindings.bindings['CLAIMED_QUANTITY']?.value
      if (typeof quantity === 'number' && quantity > 0) {
        const totalVariance = baseVariance * quantity
        log(`[ValidationGavel] RATE_SUP variance × quantity = ${baseVariance.toFixed(2)} × ${quantity} = ${totalVariance.toFixed(2)}`)
        return totalVariance
      }
    }

    return baseVariance
  }

  /**
   * Check if ALL required role bindings have high confidence (≥90%).
   * v9.3: Lowered from 95% to 90%. Fuzzy matches (75%) still don't qualify for locking.
   */
  private allRequiredBindingsExact(
    bindings: BindingContext,
    requiredRoles: UniversalRole[]
  ): boolean {
    const EXACT_MATCH_THRESHOLD = 90

    for (const role of requiredRoles) {
      const bound = bindings.bindings[role]
      if (!bound) {
        return false // Missing binding = can't lock
      }
      if (bound.confidence < EXACT_MATCH_THRESHOLD) {
        log(`[ValidationGavel] Locking prevented: ${role} has ${bound.confidence}% confidence (threshold: ${EXACT_MATCH_THRESHOLD}%)`)
        return false
      }
    }
    return true
  }

  /**
   * v4.5: Check if an axiom requires correlation to evidence or contract.
   * Axioms using RATE_CONTRACTED, ACTUAL_QUANTITY, etc. need reliable correlation.
   */
  private axiomNeedsCorrelation(axiom: ComputationalAxiom): { contract: boolean; evidence: boolean } {
    const CONTRACT_ROLES: UniversalRole[] = [
      'RATE_CONTRACTED', 'CONTRACTED_LIMIT', 'CONTRACT_START', 'CONTRACT_END'
    ]
    const EVIDENCE_ROLES: UniversalRole[] = [
      'ACTUAL_QUANTITY', 'VERIFIED_AMOUNT', 'EVIDENCE_DESCRIPTION'
    ]

    const needsContract = axiom.requiredRoles.some(role => CONTRACT_ROLES.includes(role))
    const needsEvidence = axiom.requiredRoles.some(role => EVIDENCE_ROLES.includes(role))

    return { contract: needsContract, evidence: needsEvidence }
  }

  /**
   * v4.5 + v5.0: Check if correlation info in bindings shows reliable correlation.
   * If axiom needs contract/evidence, those correlations must be reliable.
   *
   * v5.0 DETERMINISTIC MODE: If all required bindings for contract/evidence have
   * high confidence (≥95%), we treat the correlation as implicitly reliable because
   * the binding paths were explicit/deterministic (e.g., JSONPath resolution succeeded).
   */
  private checkCorrelationReliable(
    bindings: BindingContext,
    needs: { contract: boolean; evidence: boolean }
  ): boolean {
    const corrInfo = bindings.correlationInfo
    const DETERMINISTIC_THRESHOLD = 95

    // If no correlation needed, always reliable
    if (!needs.contract && !needs.evidence) {
      return true
    }

    const contractRoles: UniversalRole[] = ['RATE_CONTRACTED', 'CONTRACTED_LIMIT', 'CONTRACT_START', 'CONTRACT_END']
    const evidenceRoles: UniversalRole[] = ['ACTUAL_QUANTITY', 'VERIFIED_AMOUNT', 'EVIDENCE_DESCRIPTION']

    // Check contract correlation
    if (needs.contract) {
      const contractBindings = contractRoles
        .map(role => bindings.bindings[role])
        .filter((b): b is NonNullable<typeof b> => b !== undefined && b !== null)

      const allContractDeterministic = contractBindings.length > 0 &&
        contractBindings.every(b => b.confidence >= DETERMINISTIC_THRESHOLD)

      if (allContractDeterministic) {
        log(`[ValidationGavel] Contract correlation: DETERMINISTIC MODE (all bindings ≥${DETERMINISTIC_THRESHOLD}%)`)
      } else if (!corrInfo?.contract?.isReliable) {
        log(`[ValidationGavel] Correlation check: contract correlation not reliable (score: ${corrInfo?.contract?.score ?? 0})`)
        return false
      }
    }

    // Check evidence correlation
    if (needs.evidence) {
      const evidenceBindings = evidenceRoles
        .map(role => bindings.bindings[role])
        .filter((b): b is NonNullable<typeof b> => b !== undefined && b !== null)

      const allEvidenceDeterministic = evidenceBindings.length > 0 &&
        evidenceBindings.every(b => b.confidence >= DETERMINISTIC_THRESHOLD)

      if (allEvidenceDeterministic) {
        log(`[ValidationGavel] Evidence correlation: DETERMINISTIC MODE (all bindings ≥${DETERMINISTIC_THRESHOLD}%)`)
      } else if (!corrInfo?.evidence?.isReliable) {
        log(`[ValidationGavel] Correlation check: evidence correlation not reliable (score: ${corrInfo?.evidence?.score ?? 0})`)
        return false
      }
    }

    return true
  }

  /**
   * Check if a BOTH axiom has a definitive negative result that should be locked.
   *
   * v4.5 REVISED: EXISTS/NOT_EXISTS are NOT considered definitive for locking.
   * Reason: Missing evidence could be an extraction failure, not proof of absence.
   * Only EMPTY/NOT_EMPTY on arrays that WERE extracted are considered definitive.
   */
  private isDefinitiveNegativeResult(
    axiom: ComputationalAxiom,
    predicateResults: PredicateResult[]
  ): boolean {
    const definitiveOperators = ['EMPTY', 'NOT_EMPTY']

    return predicateResults.some(result => {
      if (result.passed) return false // Only consider failed predicates

      // Find the predicate definition to get its operator
      const predDef = axiom.predicates.find(
        p => p.description === result.predicate.description ||
             (p.leftRole === result.predicate.leftRole && p.operator === result.predicate.operator)
      )

      return predDef !== undefined && definitiveOperators.includes(predDef.operator)
    })
  }

  /**
   * Compute string similarity using Jaccard index on words.
   * Returns a value between 0 (no similarity) and 1 (identical).
   */
  private computeStringSimilarity(a: string, b: string): number {
    // Tokenize into words (3+ chars, lowercased, alphanumeric only)
    const aWords = new Set(
      a.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2)
    )
    const bWords = new Set(
      b.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2)
    )

    // Jaccard index: intersection / union
    const aWordsArray = Array.from(aWords)
    const bWordsArray = Array.from(bWords)
    const intersection = new Set(aWordsArray.filter(w => bWords.has(w)))
    const union = new Set(aWordsArray.concat(bWordsArray))

    if (union.size === 0) return 0
    return intersection.size / union.size
  }

  /**
   * Generate human-readable explanation of the validation result.
   */
  private generateExplanation(
    axiom: ComputationalAxiom,
    results: PredicateResult[],
    passed: boolean
  ): string {
    if (passed) {
      return `${axiom.name}: All predicates satisfied.`
    }

    const failures = results.filter(r => !r.passed)
    const reasons = failures
      .map(f => f.failureReason || f.predicate.description || 'Unknown failure')
      .join('; ')

    return `${axiom.name} VIOLATED: ${reasons}`
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract locked findings from a validation report.
 * These are findings that no downstream reasoner may override.
 */
export function extractLockedFindings(report: ValidationReport): ValidationResult[] {
  return report.results.filter(r => r.isLocked)
}

/**
 * Check if any axiom violation is locked.
 */
export function hasLockedViolations(report: ValidationReport): boolean {
  return report.lockedFailures > 0
}

/**
 * Get variance summary from validation report.
 */
export function getVarianceSummary(report: ValidationReport): {
  totalVariance: number
  byAxiom: Record<string, number>
} {
  const byAxiom: Record<string, number> = {}
  let totalVariance = 0

  for (const result of report.results) {
    if (result.variance !== undefined && result.verdict === 'FAIL') {
      byAxiom[result.axiomCode] = result.variance
      totalVariance += Math.abs(result.variance)
    }
  }

  return { totalVariance, byAxiom }
}

/**
 * Provenance info for a single binding - fully auditable
 */
export interface FormattedProvenance {
  role: string
  value: string
  source: string
  fieldPath: string
  confidence: number
}

/**
 * Format validation result for an audit finding.
 * Includes full binding provenance for auditability.
 */
export function formatValidationForFinding(result: ValidationResult): {
  axiom_code: string
  gavel_verdict: GavelVerdict
  is_gavel_locked: boolean
  variance: number | undefined
  explanation: string
  binding_coverage?: number
  predicate_results: Array<{
    description: string
    passed: boolean
    leftValue: string
    rightValue: string
    variance?: number
    leftProvenance?: FormattedProvenance
    rightProvenance?: FormattedProvenance
  }>
} {
  return {
    axiom_code: result.axiomCode,
    gavel_verdict: result.verdict,
    is_gavel_locked: result.isLocked,
    variance: result.variance,
    explanation: result.explanation,
    binding_coverage: result.bindingCoverage,
    predicate_results: result.predicateResults.map(pr => ({
      description: pr.predicate.description || `${pr.predicate.leftRole} ${pr.predicate.operator} ${pr.predicate.rightRole ?? String(pr.predicate.constant)}`,
      passed: pr.passed,
      leftValue: String(pr.leftValue),
      rightValue: String(pr.rightValue),
      variance: pr.variance,
      leftProvenance: pr.leftProvenance ? {
        role: pr.leftProvenance.role,
        value: String(pr.leftProvenance.value),
        source: pr.leftProvenance.source,
        fieldPath: pr.leftProvenance.fieldPath,
        confidence: pr.leftProvenance.confidence,
      } : undefined,
      rightProvenance: pr.rightProvenance ? {
        role: pr.rightProvenance.role,
        value: String(pr.rightProvenance.value),
        source: pr.rightProvenance.source,
        fieldPath: pr.rightProvenance.fieldPath,
        confidence: pr.rightProvenance.confidence,
      } : undefined,
    })),
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let gavelInstance: ValidationGavel | null = null

/**
 * Get or create the validation gavel singleton
 */
export function getValidationGavel(): ValidationGavel {
  if (!gavelInstance) {
    gavelInstance = new ValidationGavel()
  }
  return gavelInstance
}

/**
 * Reset the gavel singleton (for testing)
 */
export function resetValidationGavel(): void {
  gavelInstance = null
}

export default ValidationGavel
