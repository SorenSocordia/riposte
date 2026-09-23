/**
 * Omission Detector - Structural Void Detection
 *
 * Detects when required data is MISSING from documents. Unlike passive
 * "INSUFFICIENT_DATA" responses, missing required fields are flagged as
 * CRITICAL findings.
 *
 * Key Insight: Absence of expected data is itself a finding, not just
 * an excuse to skip validation.
 */

import type { UniversalRole, BindingContext, BoundValue } from './types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * A detected structural void (missing required data)
 */
export interface OmissionFinding {
  /** Finding type identifier */
  type: 'STRUCTURAL_VOID'
  /** Always CRITICAL for missing required data */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  /** The missing universal role */
  missingRole: UniversalRole
  /** Expected source of the missing data */
  expectedFrom: 'invoice' | 'contract' | 'evidence'
  /** Human-readable reason */
  reason: string
  /** Field name that was expected */
  expectedField: string
  /** Axiom code this void relates to (if any) */
  relatedAxiom?: string
  /** Whether this prevents axiom evaluation */
  preventsAxiomEvaluation: boolean
}

/**
 * Complete omission report for a document set
 */
export interface OmissionReport {
  /** Document/invoice ID */
  documentId: string
  /** Domain being checked */
  domainId: string
  /** All detected voids */
  omissions: OmissionFinding[]
  /** Total count of omissions */
  totalOmissions: number
  /** Count by severity */
  criticalCount: number
  highCount: number
  mediumCount: number
  /** Whether any critical omissions exist */
  hasCriticalOmissions: boolean
  /** Summary for prompt/display */
  summary: string
}

// ============================================================================
// REQUIRED FIELDS BY DOMAIN
// ============================================================================

/**
 * Maps domain fields to their corresponding roles and requirements
 */
interface FieldRequirement {
  role: UniversalRole
  source: 'invoice' | 'contract' | 'evidence'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  relatedAxioms: string[]
  description: string
}

/**
 * Required fields per domain
 * These are the minimum fields needed for basic audit functionality
 */
const DOMAIN_REQUIRED_FIELDS: Record<string, FieldRequirement[]> = {
  freight: [
    // Invoice requirements
    {
      role: 'RATE_APPLIED',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['RATE_SUP', 'MATH_INT'],
      description: 'Invoice must have a rate/unit price for rate comparison',
    },
    {
      role: 'CLAIMED_AMOUNT',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['MATH_INT', 'AMT_CAP'],
      description: 'Invoice must have a claimed amount for validation',
    },
    {
      role: 'CLAIMED_QUANTITY',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['QTY_MATCH', 'MATH_INT'],
      description: 'Invoice should have quantity for verification',
    },
    {
      role: 'EVENT_DATE',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['TIME_ORD'],
      description: 'Invoice should have service date for temporal validation',
    },

    // Contract requirements
    {
      role: 'RATE_CONTRACTED',
      source: 'contract',
      severity: 'CRITICAL',
      relatedAxioms: ['RATE_SUP'],
      description: 'Contract must have agreed rate for comparison',
    },
    {
      role: 'CONTRACT_START',
      source: 'contract',
      severity: 'HIGH',
      relatedAxioms: ['TIME_ORD'],
      description: 'Contract should have effective date',
    },
    {
      role: 'CONTRACT_END',
      source: 'contract',
      severity: 'MEDIUM',
      relatedAxioms: ['TIME_ORD'],
      description: 'Contract should have expiration date',
    },

    // Evidence requirements
    {
      role: 'ACTUAL_QUANTITY',
      source: 'evidence',
      severity: 'HIGH',
      relatedAxioms: ['QTY_MATCH'],
      description: 'Evidence should have verified quantity',
    },
    {
      role: 'VERIFIED_AMOUNT',
      source: 'evidence',
      severity: 'HIGH',
      relatedAxioms: ['MATH_INT'],
      description: 'Evidence should have verified amount',
    },
  ],

  medical: [
    {
      role: 'CLAIMED_AMOUNT',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['MATH_INT', 'AMT_CAP'],
      description: 'Claim must have billed amount',
    },
    {
      role: 'CLAIMED_QUANTITY',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['QTY_MATCH'],
      description: 'Claim should have service units',
    },
    {
      role: 'RATE_CONTRACTED',
      source: 'contract',
      severity: 'CRITICAL',
      relatedAxioms: ['RATE_SUP'],
      description: 'Fee schedule must have allowed amount',
    },
    {
      role: 'EVENT_DATE',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['TIME_ORD'],
      description: 'Claim should have date of service',
    },
  ],

  cam: [
    {
      role: 'CLAIMED_AMOUNT',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['MATH_INT', 'AMT_CAP'],
      description: 'CAM reconciliation must have total charges',
    },
    {
      role: 'CONTRACTED_LIMIT',
      source: 'contract',
      severity: 'HIGH',
      relatedAxioms: ['AMT_CAP'],
      description: 'Lease should have CAM cap amount',
    },
    {
      role: 'CONTRACT_START',
      source: 'contract',
      severity: 'MEDIUM',
      relatedAxioms: ['TIME_ORD'],
      description: 'Lease should have commencement date',
    },
  ],

  // Generic commercial invoice — INVOICE-SOURCE requirements only.
  // Missing contract/evidence references are NOT structural voids here: the cross-document
  // axioms return INSUFFICIENT_DATA / REFERENCE_NOT_PROVIDED instead (see src/index.ts).
  invoice: [
    {
      role: 'GRAND_TOTAL',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['TOTAL_INT'],
      description: 'Invoice must state a grand total for bottom-line verification',
    },
    {
      role: 'SUBTOTAL',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['SUM_INT', 'TOTAL_INT'],
      description: 'Invoice should state a subtotal for footing verification',
    },
    {
      role: 'CLAIMED_AMOUNT',
      source: 'invoice',
      severity: 'HIGH',
      relatedAxioms: ['MATH_INT', 'SUM_INT'],
      description: 'Line items should carry amounts for footing and per-line math',
    },
    {
      role: 'DOCUMENT_ID',
      source: 'invoice',
      severity: 'MEDIUM',
      relatedAxioms: ['DUP_PROHIB'],
      description: 'Invoice should carry an identifier for duplicate detection and the audit trail',
    },
    {
      role: 'EVENT_DATE',
      source: 'invoice',
      severity: 'MEDIUM',
      relatedAxioms: ['TIME_ORD'],
      description: 'Invoice should carry a service or issue date for temporal checks',
    },
  ],

  // Default for unknown domains
  default: [
    {
      role: 'CLAIMED_AMOUNT',
      source: 'invoice',
      severity: 'CRITICAL',
      relatedAxioms: ['MATH_INT'],
      description: 'Document must have a claimed amount',
    },
    {
      role: 'RATE_CONTRACTED',
      source: 'contract',
      severity: 'HIGH',
      relatedAxioms: ['RATE_SUP'],
      description: 'Contract should have agreed rates',
    },
  ],
}

// ============================================================================
// OMISSION DETECTOR
// ============================================================================

/**
 * Check if a binding value is considered "present"
 * A value is missing if it's null, undefined, empty string, or zero
 */
function isBindingPresent(value: BoundValue | undefined): boolean {
  if (!value) return false
  if (value.value === null || value.value === undefined) return false
  if (value.value === '') return false
  // Note: We don't treat 0 as missing - 0 is a valid value
  return true
}

/**
 * Detect omissions (missing required data) in bindings
 *
 * @param domainId - Domain to check requirements for
 * @param bindings - Current binding context with available values
 * @param documentType - Type of document being checked
 * @returns Array of omission findings
 */
export function detectOmissions(
  domainId: string,
  bindings: BindingContext | null | undefined,
  documentType: 'invoice' | 'contract' | 'evidence'
): OmissionReport {
  const omissions: OmissionFinding[] = []

  // Get requirements for this domain (or default)
  const requirements = DOMAIN_REQUIRED_FIELDS[domainId] || DOMAIN_REQUIRED_FIELDS.default

  // Filter to requirements for this document type
  const relevantRequirements = requirements.filter(r => r.source === documentType)

  // If no bindings provided, all requirements are omissions
  if (!bindings || !bindings.bindings) {
    for (const req of relevantRequirements) {
      omissions.push({
        type: 'STRUCTURAL_VOID',
        severity: req.severity,
        missingRole: req.role,
        expectedFrom: req.source,
        reason: `No bindings available. ${req.description}`,
        expectedField: req.role,
        relatedAxiom: req.relatedAxioms[0],
        preventsAxiomEvaluation: req.relatedAxioms.length > 0,
      })
    }

    const criticalCount = omissions.filter(o => o.severity === 'CRITICAL').length
    return {
      documentId: 'unknown',
      domainId,
      omissions,
      totalOmissions: omissions.length,
      criticalCount,
      highCount: omissions.filter(o => o.severity === 'HIGH').length,
      mediumCount: omissions.filter(o => o.severity === 'MEDIUM').length,
      hasCriticalOmissions: criticalCount > 0,
      summary: `${omissions.length} required field(s) missing (no bindings)`,
    }
  }

  // Check each requirement
  for (const req of relevantRequirements) {
    const boundValue = bindings.bindings[req.role]
    const isPresent = isBindingPresent(boundValue)

    if (!isPresent) {
      // Create omission finding
      const omission: OmissionFinding = {
        type: 'STRUCTURAL_VOID',
        severity: req.severity,
        missingRole: req.role,
        expectedFrom: req.source,
        reason: req.description,
        expectedField: req.role,
        relatedAxiom: req.relatedAxioms[0],
        preventsAxiomEvaluation: req.relatedAxioms.length > 0,
      }

      omissions.push(omission)
    }
  }

  // Calculate counts
  const criticalCount = omissions.filter(o => o.severity === 'CRITICAL').length
  const highCount = omissions.filter(o => o.severity === 'HIGH').length
  const mediumCount = omissions.filter(o => o.severity === 'MEDIUM').length

  // Generate summary
  const summary = generateOmissionSummary(omissions, documentType)

  return {
    documentId: bindings.invoiceId,
    domainId,
    omissions,
    totalOmissions: omissions.length,
    criticalCount,
    highCount,
    mediumCount,
    hasCriticalOmissions: criticalCount > 0,
    summary,
  }
}

/**
 * Detect omissions across all document types
 */
export function detectAllOmissions(
  domainId: string,
  invoiceBindings: BindingContext,
  contractBindings: BindingContext | null,
  evidenceBindings: BindingContext | null
): OmissionReport {
  const allOmissions: OmissionFinding[] = []

  // Check invoice omissions
  const invoiceReport = detectOmissions(domainId, invoiceBindings, 'invoice')
  allOmissions.push(...invoiceReport.omissions)

  // Check contract omissions (if contract provided)
  if (contractBindings) {
    const contractReport = detectOmissions(domainId, contractBindings, 'contract')
    allOmissions.push(...contractReport.omissions)
  } else {
    // No contract at all - add critical omission
    const requirements = DOMAIN_REQUIRED_FIELDS[domainId] || DOMAIN_REQUIRED_FIELDS.default
    const contractReqs = requirements.filter(r => r.source === 'contract')

    for (const req of contractReqs) {
      allOmissions.push({
        type: 'STRUCTURAL_VOID',
        severity: 'CRITICAL',
        missingRole: req.role,
        expectedFrom: 'contract',
        reason: `No contract document provided. ${req.description}`,
        expectedField: req.role,
        relatedAxiom: req.relatedAxioms[0],
        preventsAxiomEvaluation: true,
      })
    }
  }

  // Check evidence omissions (if evidence provided)
  if (evidenceBindings) {
    const evidenceReport = detectOmissions(domainId, evidenceBindings, 'evidence')
    allOmissions.push(...evidenceReport.omissions)
  } else {
    // No evidence at all - add high-severity omission
    const requirements = DOMAIN_REQUIRED_FIELDS[domainId] || DOMAIN_REQUIRED_FIELDS.default
    const evidenceReqs = requirements.filter(r => r.source === 'evidence')

    for (const req of evidenceReqs) {
      allOmissions.push({
        type: 'STRUCTURAL_VOID',
        severity: 'HIGH', // Evidence is important but not always required
        missingRole: req.role,
        expectedFrom: 'evidence',
        reason: `No supporting evidence provided. ${req.description}`,
        expectedField: req.role,
        relatedAxiom: req.relatedAxioms[0],
        preventsAxiomEvaluation: true,
      })
    }
  }

  // Calculate counts
  const criticalCount = allOmissions.filter(o => o.severity === 'CRITICAL').length
  const highCount = allOmissions.filter(o => o.severity === 'HIGH').length
  const mediumCount = allOmissions.filter(o => o.severity === 'MEDIUM').length

  // Generate comprehensive summary
  const summary = generateComprehensiveSummary(allOmissions)

  return {
    documentId: invoiceBindings.invoiceId,
    domainId,
    omissions: allOmissions,
    totalOmissions: allOmissions.length,
    criticalCount,
    highCount,
    mediumCount,
    hasCriticalOmissions: criticalCount > 0,
    summary,
  }
}

// ============================================================================
// SUMMARY GENERATION
// ============================================================================

/**
 * Generate human-readable summary for omissions
 */
function generateOmissionSummary(
  omissions: OmissionFinding[],
  documentType: string
): string {
  if (omissions.length === 0) {
    return `All required fields present in ${documentType}.`
  }

  const critical = omissions.filter(o => o.severity === 'CRITICAL')
  const high = omissions.filter(o => o.severity === 'HIGH')
  const medium = omissions.filter(o => o.severity === 'MEDIUM')

  const parts: string[] = []

  if (critical.length > 0) {
    parts.push(`${critical.length} CRITICAL missing: ${critical.map(o => o.missingRole).join(', ')}`)
  }

  if (high.length > 0) {
    parts.push(`${high.length} HIGH missing: ${high.map(o => o.missingRole).join(', ')}`)
  }

  if (medium.length > 0) {
    parts.push(`${medium.length} MEDIUM missing: ${medium.map(o => o.missingRole).join(', ')}`)
  }

  return parts.join('. ')
}

/**
 * Generate comprehensive summary across all document types
 */
function generateComprehensiveSummary(omissions: OmissionFinding[]): string {
  if (omissions.length === 0) {
    return 'All required data present across invoice, contract, and evidence.'
  }

  const bySource = {
    invoice: omissions.filter(o => o.expectedFrom === 'invoice'),
    contract: omissions.filter(o => o.expectedFrom === 'contract'),
    evidence: omissions.filter(o => o.expectedFrom === 'evidence'),
  }

  const parts: string[] = []

  if (bySource.invoice.length > 0) {
    const critical = bySource.invoice.filter(o => o.severity === 'CRITICAL').length
    parts.push(`Invoice: ${bySource.invoice.length} missing (${critical} critical)`)
  }

  if (bySource.contract.length > 0) {
    const critical = bySource.contract.filter(o => o.severity === 'CRITICAL').length
    parts.push(`Contract: ${bySource.contract.length} missing (${critical} critical)`)
  }

  if (bySource.evidence.length > 0) {
    const critical = bySource.evidence.filter(o => o.severity === 'CRITICAL').length
    parts.push(`Evidence: ${bySource.evidence.length} missing (${critical} critical)`)
  }

  return parts.join(' | ')
}

// ============================================================================
// OMISSION TO FINDING CONVERSION
// ============================================================================

/**
 * Convert omission findings to unified findings format
 * This allows omissions to be included in the manifest of certainties
 */
export function omissionsToUnifiedFindings(
  omissions: OmissionFinding[]
): Array<{
  source: 'gavel'
  checkType: string
  description: string
  status: 'FAIL' | 'WARNING'
  confidence: 'LOCKED' | 'HIGH' | 'MEDIUM'
  isLocked: boolean
  variance: number
  field: string
  reasoning: string
  axiomCode: string
}> {
  return omissions.map(omission => ({
    source: 'gavel' as const,
    checkType: 'OMISSION',
    description: `Missing required data: ${omission.missingRole}`,
    status: omission.severity === 'CRITICAL' ? 'FAIL' as const : 'WARNING' as const,
    confidence: omission.severity === 'CRITICAL' ? 'LOCKED' as const : 'HIGH' as const,
    isLocked: omission.severity === 'CRITICAL',
    variance: 0, // Omissions don't have direct variance
    field: `${omission.expectedFrom}: ${omission.expectedField}`,
    reasoning: omission.reason,
    axiomCode: omission.relatedAxiom || 'OMISSION',
  }))
}

// ============================================================================
// PROMPT FORMATTING
// ============================================================================

/**
 * Format omission report for prompt injection
 */
export function formatOmissionsForPrompt(report: OmissionReport): string {
  if (report.omissions.length === 0) {
    return ''
  }

  const lines: string[] = [
    '### STRUCTURAL VOIDS DETECTED (Missing Required Data)',
    '',
  ]

  if (report.criticalCount > 0) {
    lines.push(`**⚠️ ${report.criticalCount} CRITICAL omissions prevent full validation:**`)
    for (const omission of report.omissions.filter(o => o.severity === 'CRITICAL')) {
      lines.push(`- **${omission.missingRole}** (from ${omission.expectedFrom}): ${omission.reason}`)
      if (omission.relatedAxiom) {
        lines.push(`  → Prevents evaluation of AX-${omission.relatedAxiom}`)
      }
    }
    lines.push('')
  }

  if (report.highCount > 0) {
    lines.push(`**${report.highCount} HIGH-priority missing data:**`)
    for (const omission of report.omissions.filter(o => o.severity === 'HIGH')) {
      lines.push(`- ${omission.missingRole} (from ${omission.expectedFrom}): ${omission.reason}`)
    }
    lines.push('')
  }

  if (report.mediumCount > 0) {
    lines.push(`**${report.mediumCount} MEDIUM-priority missing data:**`)
    for (const omission of report.omissions.filter(o => o.severity === 'MEDIUM')) {
      lines.push(`- ${omission.missingRole} (from ${omission.expectedFrom}): ${omission.reason}`)
    }
    lines.push('')
  }

  lines.push('**Action:** Include these omissions in your findings. Missing data is itself a finding.')
  lines.push('')

  return lines.join('\n')
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DOMAIN_REQUIRED_FIELDS,
}
