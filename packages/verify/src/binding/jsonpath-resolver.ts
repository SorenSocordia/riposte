/**
 * JSONPath Resolver - Execute JSONPath Bindings
 *
 * CRITICAL FIX: JSONPath expressions in ontological_bindings were being STORED
 * but NEVER EXECUTED. This module provides actual JSONPath resolution using
 * jsonpath-plus library.
 *
 * Key Discovery: The entire binding system was decorative - paths like
 * "$.line_items[*].unit_price" were strings that never got evaluated.
 */

import { JSONPath } from 'jsonpath-plus'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of resolving a JSONPath expression
 */
export interface PathResolutionResult {
  /** Whether the path resolved successfully */
  success: boolean
  /** The resolved value(s) */
  value: unknown
  /** The original path that was resolved */
  path: string
  /** Number of matches found (for array paths) */
  matchCount: number
  /** Error message if resolution failed */
  error?: string
  /** Type of the resolved value */
  valueType: 'number' | 'string' | 'array' | 'object' | 'null' | 'undefined'
}

/**
 * Result of validating all bindings in a document
 */
export interface BindingValidationReport {
  /** Total number of bindings tested */
  totalBindings: number
  /** Number of bindings that resolved successfully */
  successCount: number
  /** Number of bindings that failed */
  failCount: number
  /** Success rate as percentage */
  successRate: number
  /** Details for each binding */
  results: BindingValidationResult[]
  /** Summary of issues */
  issues: string[]
}

/**
 * Validation result for a single binding
 */
export interface BindingValidationResult {
  /** Binding identifier (domain + role) */
  bindingId: string
  /** Domain this binding belongs to */
  domain: string
  /** Universal role */
  role: string
  /** The JSONPath expression */
  jsonPath: string
  /** Resolution result */
  resolution: PathResolutionResult
  /** Whether this binding is critical for axiom evaluation */
  isCritical: boolean
}

/**
 * Ontological binding from database
 */
export interface OntologicalBindingRecord {
  domain: string
  role: string
  jsonPath: string
  documentType: 'invoice' | 'contract' | 'evidence'
  priority?: number
}

// ============================================================================
// JSONPATH RESOLVER
// ============================================================================

/**
 * Resolve a JSONPath expression against a document
 *
 * @param document - The document to query
 * @param jsonPath - JSONPath expression (e.g., "$.line_items[*].unit_price")
 * @param index - Optional array index for [*] wildcards
 * @returns Resolution result with value and metadata
 */
export function resolveJsonPath(
  document: Record<string, unknown>,
  jsonPath: string,
  index?: number
): PathResolutionResult {
  try {
    // Validate input
    if (!document || typeof document !== 'object') {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: 'Invalid document: expected object',
        valueType: 'null',
      }
    }

    if (!jsonPath || typeof jsonPath !== 'string') {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: 'Invalid JSONPath: expected non-empty string',
        valueType: 'null',
      }
    }

    // Ensure path starts with $ (JSONPath root)
    const normalizedPath = jsonPath.startsWith('$') ? jsonPath : `$.${jsonPath}`

    // Execute JSONPath query
    const results = JSONPath({
      path: normalizedPath,
      json: document,
      wrap: true, // Always return array
    })

    // Handle no matches
    if (!results || results.length === 0) {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: `No matches found for path: ${jsonPath}`,
        valueType: 'null',
      }
    }

    // If index is specified, get that specific element
    if (index !== undefined) {
      if (index >= 0 && index < results.length) {
        const value = results[index]
        return {
          success: true,
          value,
          path: jsonPath,
          matchCount: 1,
          valueType: getValueType(value),
        }
      } else {
        return {
          success: false,
          value: null,
          path: jsonPath,
          matchCount: results.length,
          error: `Index ${index} out of bounds (found ${results.length} matches)`,
          valueType: 'null',
        }
      }
    }

    // Return first result if single match, or array if multiple
    const value = results.length === 1 ? results[0] : results
    return {
      success: true,
      value,
      path: jsonPath,
      matchCount: results.length,
      valueType: getValueType(value),
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      value: null,
      path: jsonPath,
      matchCount: 0,
      error: `JSONPath error: ${errorMessage}`,
      valueType: 'null',
    }
  }
}

/**
 * Determine the type of a resolved value
 */
function getValueType(value: unknown): PathResolutionResult['valueType'] {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'object') return 'object'
  return 'undefined'
}

/**
 * Check if a path is a JSONPath expression (starts with $)
 */
export function isJsonPath(path: string): boolean {
  return path.startsWith('$') || path.startsWith('[')
}

/**
 * Convert a dot-notation path to JSONPath
 * e.g., "line_items[*].unit_price" -> "$.line_items[*].unit_price"
 */
export function toJsonPath(path: string): string {
  if (path.startsWith('$')) return path
  return `$.${path}`
}

// ============================================================================
// BINDING VALIDATION
// ============================================================================

/**
 * Validate all ontological bindings against a sample document
 *
 * Tests that each JSONPath in the bindings actually resolves to a value.
 * This is critical for ensuring bindings aren't just decorative strings.
 *
 * @param bindings - Array of ontological bindings to validate
 * @param sampleDocument - Sample document to test against
 * @param documentType - Type of document being tested
 * @returns Detailed validation report
 */
export function validateOntologicalBindings(
  bindings: OntologicalBindingRecord[],
  sampleDocument: Record<string, unknown>,
  documentType: 'invoice' | 'contract' | 'evidence'
): BindingValidationReport {
  const results: BindingValidationResult[] = []
  const issues: string[] = []

  // Filter bindings for this document type
  const relevantBindings = bindings.filter(b => b.documentType === documentType)

  for (const binding of relevantBindings) {
    const resolution = resolveJsonPath(sampleDocument, binding.jsonPath)

    const result: BindingValidationResult = {
      bindingId: `${binding.domain}:${binding.role}`,
      domain: binding.domain,
      role: binding.role,
      jsonPath: binding.jsonPath,
      resolution,
      isCritical: isCriticalBinding(binding.role),
    }

    results.push(result)

    // Track issues
    if (!resolution.success) {
      const severity = result.isCritical ? 'CRITICAL' : 'WARNING'
      issues.push(`[${severity}] ${result.bindingId}: ${resolution.error}`)
    }
  }

  const successCount = results.filter(r => r.resolution.success).length
  const failCount = results.length - successCount

  return {
    totalBindings: results.length,
    successCount,
    failCount,
    successRate: results.length > 0 ? Math.round((successCount / results.length) * 100) : 100,
    results,
    issues,
  }
}

/**
 * Check if a binding role is critical for axiom evaluation
 */
function isCriticalBinding(role: string): boolean {
  const criticalRoles = [
    'RATE_APPLIED',
    'RATE_CONTRACTED',
    'CLAIMED_AMOUNT',
    'VERIFIED_AMOUNT',
    'CLAIMED_QUANTITY',
    'ACTUAL_QUANTITY',
    'CONTRACTED_LIMIT',
    'EVENT_DATE',
    'CONTRACT_START',
    'CONTRACT_END',
  ]
  return criticalRoles.includes(role)
}

// ============================================================================
// BATCH RESOLUTION
// ============================================================================

/**
 * Resolve multiple JSONPaths against a document
 *
 * @param document - Document to query
 * @param paths - Object mapping names to JSONPath expressions
 * @returns Object mapping names to resolution results
 */
export function resolveMultiplePaths(
  document: Record<string, unknown>,
  paths: Record<string, string>
): Record<string, PathResolutionResult> {
  const results: Record<string, PathResolutionResult> = {}

  for (const [name, path] of Object.entries(paths)) {
    results[name] = resolveJsonPath(document, path)
  }

  return results
}

/**
 * Resolve a JSONPath and extract a numeric value
 *
 * Convenience function for getting numeric values with type coercion.
 *
 * @param document - Document to query
 * @param jsonPath - JSONPath expression
 * @param defaultValue - Value to return if resolution fails
 * @returns Numeric value or default
 */
export function resolveNumericValue(
  document: Record<string, unknown>,
  jsonPath: string,
  defaultValue: number = 0
): number {
  const result = resolveJsonPath(document, jsonPath)

  if (!result.success) {
    return defaultValue
  }

  const value = result.value
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    // Try to parse as number (handle currency strings)
    const cleaned = value.replace(/[,$\s]/g, '')
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? defaultValue : parsed
  }

  return defaultValue
}

/**
 * Resolve a JSONPath and extract a string value
 *
 * @param document - Document to query
 * @param jsonPath - JSONPath expression
 * @param defaultValue - Value to return if resolution fails
 * @returns String value or default
 */
export function resolveStringValue(
  document: Record<string, unknown>,
  jsonPath: string,
  defaultValue: string = ''
): string {
  const result = resolveJsonPath(document, jsonPath)

  if (!result.success) {
    return defaultValue
  }

  const value = result.value
  if (typeof value === 'string') {
    return value
  }

  if (value !== null && value !== undefined) {
    return String(value)
  }

  return defaultValue
}

/**
 * Resolve a JSONPath and extract an array
 *
 * @param document - Document to query
 * @param jsonPath - JSONPath expression
 * @returns Array of values or empty array
 */
export function resolveArrayValue(
  document: Record<string, unknown>,
  jsonPath: string
): unknown[] {
  const result = resolveJsonPath(document, jsonPath)

  if (!result.success) {
    return []
  }

  if (Array.isArray(result.value)) {
    return result.value
  }

  // Wrap single value in array
  if (result.value !== null && result.value !== undefined) {
    return [result.value]
  }

  return []
}

// ============================================================================
// DIAGNOSTIC UTILITIES
// ============================================================================

/**
 * Generate a diagnostic report for all paths in a document
 *
 * Useful for debugging why bindings aren't resolving.
 */
export function generatePathDiagnostic(
  document: Record<string, unknown>,
  bindings: OntologicalBindingRecord[]
): string {
  const lines: string[] = [
    '=== JSONPath Binding Diagnostic ===',
    `Document keys: ${Object.keys(document).join(', ')}`,
    '',
  ]

  for (const binding of bindings) {
    const result = resolveJsonPath(document, binding.jsonPath)
    const status = result.success ? '✓' : '✗'
    const valuePreview = result.success
      ? JSON.stringify(result.value).slice(0, 50)
      : result.error

    lines.push(`${status} ${binding.role} (${binding.domain})`)
    lines.push(`  Path: ${binding.jsonPath}`)
    lines.push(`  Result: ${valuePreview}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================================================
// EXPORTS
// ============================================================================

// Types are exported inline where defined (OntologicalBindingRecord, PathResolutionResult, etc.)
