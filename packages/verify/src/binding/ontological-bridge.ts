/**
 * Ontological Bridge - Domain to Universal Role Mappings
 *
 * Maps domain-specific field paths to universal logical roles.
 * This enables the same axiom predicates to work across all domains.
 *
 * ENHANCED: Fuzzy path resolution with fallbacks and field aliases.
 */

// Vendored 2026-09-22 from an earlier internal engine and hardened here.
// Imports rewired to this package; correlation shapes inlined (they were type-only in the
// engine); the engine's flight recorder replaced by a null stub so every call site
// typechecks unchanged and records nothing. The 28 engine ontologies were NOT copied.
import type {
  UniversalRole,
  BoundValue,
  BindingContext,
  DomainFieldMapping,
  DomainOntology,
  LLMCorrelationMap,
  RoleKind,
} from '../kernel/types.js'
import {
  normalizeAmount,
  normalizeQuantity,
  normalizeDate,
  normalizeReference,
  normalizeRate,
  type NormalizedValue,
} from './forensic-normalizer.js'
import { resolveJsonPath } from './jsonpath-resolver.js'

// --- correlation shapes (inlined; no runtime dependency) -----------------------------
interface CorrelationResult {
  score: number
  factors: { dateMatch: number; referenceMatch: number; descriptionMatch: number }
  matchedIndex: number
  explanation: string
  isReliable: boolean
}
interface LineItemData {
  description?: string
  date?: string
  referenceIds: string[]
  quantity?: number
  rate?: number
  amount?: number
}
interface EvidenceData {
  description?: string
  date?: string
  referenceIds: string[]
  ticketNumber?: string
  quantity?: number
  hours?: number
}
interface ContractRuleData {
  ruleName?: string
  description?: string
  rate?: number
  unit?: string
}

// --- telemetry stub: the engine's flight recorder does not cross the border -----------
type EpistemicFlightRecorder = {
  logSuccess: (path: string, value: unknown, matchCount: number, meta: Record<string, unknown>) => void
  logFailure: (path: string, error: string, meta: Record<string, unknown>) => void
}
const getFlightRecorder = (): EpistemicFlightRecorder | null => null

// --- logging: injectable, silent by default (a verifier must not spray stdout) -----------
let bridgeLog: (message: string) => void = () => {}
/** Install a logger for the binding layer (debugging/telemetry); pass undefined to silence. */
export function setBridgeLogger(logger?: (message: string) => void): void {
  bridgeLog = logger ?? (() => {})
}

// ============================================================================
// FIELD ALIASES - Common synonyms for field names
// ============================================================================

/**
 * Aliases map common field name variations to canonical names.
 * Used for fuzzy matching when exact paths fail.
 */
// ============================================================================
// FUZZY MATCH RESULT TYPE
// ============================================================================

/**
 * Result of a fuzzy field match with confidence scoring
 */
interface FuzzyMatchResult {
  value: unknown
  confidence: number
  matchType: 'exact' | 'alternative' | 'fuzzy' | 'deep_search'
  matchPath: string
}

const FIELD_ALIASES: Record<string, string[]> = {
  // Rate variations
  rate: ['unit_price', 'price', 'hourly_rate', 'rate_per_unit', 'price_per_unit', 'unit_rate', 'cost', 'charge'],
  unit_price: ['rate', 'price', 'hourly_rate', 'cost', 'charge'],

  // Quantity variations
  quantity: ['qty', 'units', 'hours', 'count', 'num', 'amount'],
  hours: ['quantity', 'qty', 'units', 'total_hours', 'worked_hours'],

  // Amount variations
  amount: ['total', 'sum', 'value', 'price', 'cost', 'charge', 'billed_amount', 'line_total'],
  total: ['amount', 'sum', 'grand_total', 'subtotal', 'total_amount'],

  // Date variations
  date: ['service_date', 'event_date', 'transaction_date', 'work_date', 'effective_date'],
  effective_date: ['start_date', 'begin_date', 'commencement_date'],
  end_date: ['expiration_date', 'termination_date', 'expiry_date', 'contract_end'],

  // Reference variations
  document_number: ['invoice_number', 'reference', 'ref', 'po_number', 'order_number', 'ticket_number'],
}

/**
 * Get all aliases for a field name
 */
function getFieldAliases(fieldName: string): string[] {
  const normalized = fieldName.toLowerCase().replace(/-/g, '_')
  const aliases = new Set<string>([normalized])

  // Direct aliases
  if (FIELD_ALIASES[normalized]) {
    for (const alias of FIELD_ALIASES[normalized]) {
      aliases.add(alias)
    }
  }

  // Reverse lookup
  for (const [canonical, aliasList] of Object.entries(FIELD_ALIASES)) {
    if (aliasList.includes(normalized)) {
      aliases.add(canonical)
      for (const alias of aliasList) {
        aliases.add(alias)
      }
    }
  }

  return Array.from(aliases)
}


// Domain ontologies were intentionally NOT copied from the engine.
// Ontologies are authored per ruleset in ../rulesets/<id>/ontology.ts and registered via registerOntology().
const DOMAIN_ONTOLOGIES: Record<string, DomainOntology> = {}

// ============================================================================
// ONTOLOGICAL BRIDGE CLASS
// ============================================================================

/**
 * OntologicalBridge maps domain-specific data to universal roles.
 * This is the "translation layer" between raw documents and axiom predicates.
 *
 * ENHANCED: Uses fuzzy path resolution with multiple fallbacks.
 */
export class OntologicalBridge {
  private ontologies: Map<string, DomainOntology> = new Map()
  // role → kind for the ontology currently being bound (set in createBindings). Lets a ruleset declare how its
  // roles normalize instead of extending the hard-coded lists below.
  private roleKinds: Partial<Record<UniversalRole, RoleKind>> = {}
  // one representative built-in role per kind; kind-declared roles delegate to it.
  private static readonly KIND_REPRESENTATIVE: Record<RoleKind, UniversalRole> = {
    amount: 'CLAIMED_AMOUNT', rate: 'TAX_RATE', quantity: 'CLAIMED_QUANTITY', date: 'EVENT_DATE',
    reference: 'DOCUMENT_ID', string: 'INVOICE_DESCRIPTION', array: 'PRIOR_CLAIM_IDS',
  }
  private extractionCache: WeakMap<object, Map<string, unknown>> = new WeakMap()
  private flightRecorder: EpistemicFlightRecorder | null = null
  private currentDocumentId: string | undefined
  private currentDomain: string | undefined
  private currentDocumentType: 'invoice' | 'contract' | 'evidence' | undefined

  constructor() {
    // Load default ontologies
    for (const [key, ontology] of Object.entries(DOMAIN_ONTOLOGIES)) {
      this.ontologies.set(key, ontology)
    }

    // Initialize flight recorder for traceability
    try {
      this.flightRecorder = getFlightRecorder()
    } catch {
      // Flight recorder not available - continue without logging
    }
  }

  /**
   * Enable flight recording for current extraction context
   */
  setExtractionContext(
    documentId?: string,
    domain?: string,
    documentType?: 'invoice' | 'contract' | 'evidence'
  ): void {
    this.currentDocumentId = documentId
    this.currentDomain = domain
    this.currentDocumentType = documentType
  }

  /**
   * Register a custom domain ontology
   */
  registerOntology(ontology: DomainOntology): void {
    this.ontologies.set(ontology.domainId, ontology)
  }

  /**
   * Get ontology for a domain
   */
  getOntology(domainId: string): DomainOntology | undefined {
    return this.ontologies.get(domainId)
  }

  /**
   * Extract a value from a document using a field path with fuzzy fallbacks.
   * Supports dot notation and array wildcards (e.g., "line_items[*].rate")
   *
   * ENHANCED: Tries JSONPath first (for paths starting with $), then exact paths,
   * and finally fuzzy field name matching.
   */
  extractValue(
    document: Record<string, unknown>,
    fieldPath: string,
    arrayIndex?: number,
    enableFuzzy: boolean = true
  ): unknown {
    // PHASE 1: Try JSONPath resolution first (for paths starting with $)
    if (fieldPath.startsWith('$')) {
      const jsonPathResult = resolveJsonPath(document, fieldPath, arrayIndex)
      if (jsonPathResult.success && jsonPathResult.value !== null && jsonPathResult.value !== undefined) {
        return jsonPathResult.value
      }
      // If JSONPath fails, we can still try legacy resolution by converting path
      // Example: $.line_items[*].rate -> line_items[*].rate
      const legacyPath = fieldPath.replace(/^\$\.?/, '')
      if (legacyPath) {
        const legacyResult = this.extractExact(document, legacyPath, arrayIndex)
        if (legacyResult !== null && legacyResult !== undefined) {
          return legacyResult
        }
      }
    }

    // PHASE 2: Try exact path matching (for legacy non-JSONPath paths)
    const exactResult = this.extractExact(document, fieldPath, arrayIndex)
    if (exactResult !== null && exactResult !== undefined) {
      return exactResult
    }

    // PHASE 3: If exact fails and fuzzy is enabled, try fuzzy resolution
    if (enableFuzzy) {
      return this.extractFuzzy(document, fieldPath, arrayIndex)
    }

    return null
  }

  /**
   * Extract using exact path matching
   */
  private extractExact(
    document: Record<string, unknown>,
    fieldPath: string,
    arrayIndex?: number
  ): unknown {
    const parts = fieldPath.split('.')
    let current: unknown = document

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null
      }

      // Handle array wildcard [*]
      const arrayMatch = part.match(/^(.+)\[\*\]$/)
      if (arrayMatch) {
        const arrayField = arrayMatch[1]
        const arr = (current as Record<string, unknown>)[arrayField]
        if (!Array.isArray(arr)) {
          return null
        }
        // If arrayIndex is provided, get that specific item
        if (arrayIndex !== undefined) {
          current = arr[arrayIndex]
        } else {
          // Return first non-null value from array
          for (const item of arr) {
            if (item !== null && item !== undefined) {
              current = item
              break
            }
          }
          if (current === arr) {
            return arr // Return whole array if we didn't find specific item
          }
        }
      } else if (part.match(/^\d+$/)) {
        // Numeric index
        const idx = parseInt(part, 10)
        if (Array.isArray(current)) {
          current = current[idx]
        } else {
          return null
        }
      } else {
        current = (current as Record<string, unknown>)[part]
      }
    }

    return current
  }

  /**
   * Extract using fuzzy path resolution
   */
  private extractFuzzy(
    document: Record<string, unknown>,
    fieldPath: string,
    arrayIndex?: number
  ): unknown {
    const parts = fieldPath.split('.')
    if (parts.length === 0) return null

    // Get the final field name to search for
    let lastPart = parts[parts.length - 1]
    const arrayWildcard = lastPart.match(/^(.+)\[\*\]$/)
    if (arrayWildcard) {
      lastPart = arrayWildcard[1]
    }

    // Get all aliases for this field
    const aliases = getFieldAliases(lastPart)

    // Try each alias with recursive search
    for (const alias of aliases) {
      const result = this.deepSearch(document, alias, arrayIndex)
      if (result !== null && result !== undefined) {
        return result
      }
    }

    // Try searching nested objects for arrays with the target field
    if (parts.length >= 2 && parts[0].includes('[*]')) {
      const arrMatch = parts[0].match(/^(.+)\[\*\]$/)
      if (arrMatch) {
        const result = this.searchInArrays(document, arrMatch[1], lastPart, arrayIndex)
        if (result !== null && result !== undefined) {
          return result
        }
      }
    }

    return null
  }

  /**
   * Deep search for a field name in nested object
   */
  private deepSearch(
    obj: Record<string, unknown>,
    fieldName: string,
    arrayIndex?: number,
    maxDepth: number = 4
  ): unknown {
    if (maxDepth <= 0) return null

    // Check direct properties (case-insensitive)
    for (const key of Object.keys(obj)) {
      const normalizedKey = key.toLowerCase().replace(/-/g, '_')
      if (normalizedKey === fieldName.toLowerCase()) {
        const value = obj[key]
        if (Array.isArray(value) && arrayIndex !== undefined) {
          return value[arrayIndex]
        }
        return value
      }
    }

    // Search in nested objects and arrays
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          // Search in array items
          if (arrayIndex !== undefined && value[arrayIndex]) {
            const item = value[arrayIndex]
            if (typeof item === 'object' && item !== null) {
              const result = this.deepSearch(item as Record<string, unknown>, fieldName, undefined, maxDepth - 1)
              if (result !== null && result !== undefined) {
                return result
              }
            }
          } else {
            // Search all items
            for (const item of value) {
              if (typeof item === 'object' && item !== null) {
                const result = this.deepSearch(item as Record<string, unknown>, fieldName, undefined, maxDepth - 1)
                if (result !== null && result !== undefined) {
                  return result
                }
              }
            }
          }
        } else {
          const result = this.deepSearch(value as Record<string, unknown>, fieldName, arrayIndex, maxDepth - 1)
          if (result !== null && result !== undefined) {
            return result
          }
        }
      }
    }

    return null
  }

  /**
   * Search in arrays for a specific field
   */
  private searchInArrays(
    obj: Record<string, unknown>,
    arrayName: string,
    fieldName: string,
    arrayIndex?: number
  ): unknown {
    // Find array by name or alias
    const aliases = getFieldAliases(arrayName)
    let arr: unknown[] | null = null

    for (const alias of aliases) {
      for (const key of Object.keys(obj)) {
        const normalizedKey = key.toLowerCase().replace(/-/g, '_')
        if (normalizedKey === alias.toLowerCase() && Array.isArray(obj[key])) {
          arr = obj[key] as unknown[]
          break
        }
      }
      if (arr) break
    }

    if (!arr) return null

    // Search for field in array items
    const targetIndex = arrayIndex ?? 0
    const item = arr[targetIndex]
    if (item && typeof item === 'object') {
      const fieldAliases = getFieldAliases(fieldName)
      for (const alias of fieldAliases) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          const normalizedKey = key.toLowerCase().replace(/-/g, '_')
          if (normalizedKey === alias.toLowerCase()) {
            return (item as Record<string, unknown>)[key]
          }
        }
      }
    }

    return null
  }

  /**
   * Create bindings from extracted document data.
   * This is the core "data binding" step that feeds the axiom gavel.
   *
   * ENHANCED v4.5: Uses LLM correlation map when available, falls back to code correlation.
   * LLM provides semantic understanding; code provides mathematical verification.
   */
  createBindings(
    domainId: string,
    invoice: Record<string, unknown>,
    contract: Record<string, unknown>,
    evidence: Record<string, unknown>[],
    lineItemIndex?: number,
    llmCorrelationMap?: LLMCorrelationMap
  ): BindingContext {
    const ontology = this.ontologies.get(domainId)
    this.roleKinds = ontology?.roleKinds ?? {}
    const invoiceId = (invoice.document_number as string) || (invoice.id as string) || 'unknown'

    // v5.1: Set extraction context for flight recorder traceability
    this.setExtractionContext(invoiceId, domainId, 'invoice')

    if (!ontology) {
      bridgeLog(`[OntologicalBridge] No ontology for domain: ${domainId}`)
      return {
        bindings: {},
        invoiceId,
        lineItemIndex,
      }
    }

    const bindings: Partial<Record<UniversalRole, BoundValue>> = {}
    // Correlation engine available for future use - currently using LLM-based correlation
    // const correlationEngine = getCorrelationEngine()

    // Sort mappings by priority (higher first)
    const sortedMappings = [...ontology.mappings].sort((a, b) => b.priority - a.priority)

    // Line item data extracted for correlation matching (used in contract/evidence steps below)
    // const lineItemData = this.extractLineItemForCorrelation(invoice, lineItemIndex)

    // ========================================================================
    // STEP 2: Process invoice mappings (no correlation needed - source data)
    // v4.5: Include full normalization audit trail in every binding
    // v5.0: Special handling for EVENT_DATE to prefer service_date over invoice_date
    // ========================================================================
    for (const mapping of sortedMappings.filter(m => m.documentType === 'invoice' || m.documentType === 'any')) {
      if (bindings[mapping.role]) continue // Already have a higher-priority binding

      // v5.0 TIME_ORD FIX: Special handling for EVENT_DATE to select service_date from dates array
      if (mapping.role === 'EVENT_DATE') {
        const dateValue = this.extractDateValue(invoice)
        if (dateValue) {
          const normResult = this.normalizeValueForRole(dateValue, mapping.role)
          bindings[mapping.role] = {
            value: normResult.normalized,
            source: 'invoice',
            field: 'dates[service_date]',
            confidence: 100, // Deterministic extraction
            originalValue: dateValue as string | number | Date | null,
            normalizedValue: typeof normResult.normalized === 'object' ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations,
          }
          bridgeLog(`[OntologicalBridge] EVENT_DATE BIND (smart): ${String(dateValue).slice(0, 50)} (service_date preferred, 100%)`)
          continue
        }
      }

      const match = this.extractWithFallbacks(invoice, mapping, lineItemIndex)
      if (match !== null) {
        // v4.5: Use role-specific normalization with audit trail
        const normResult = this.normalizeValueForRole(match.value, mapping.role)

        bindings[mapping.role] = {
          value: normResult.normalized,
          source: 'invoice',
          field: match.matchPath,
          confidence: match.confidence,
          // v4.5: Normalization provenance
          originalValue: (normResult.meta?.original ?? match.value) as string | number | Date | null,
          normalizedValue: typeof normResult.normalized === 'object' ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations,
        }
        if (match.matchType === 'fuzzy' || match.matchType === 'deep_search') {
          bridgeLog(`[OntologicalBridge] FUZZY BIND: ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${match.confidence}%)`)
        }
      }
    }

    // ========================================================================
    // STEP 3: Correlate invoice line item to contract rules, then bind
    // LLM mapping takes precedence over code-based correlation when available
    // v5.1: Update context for flight recorder
    // ========================================================================
    this.setExtractionContext(invoiceId, domainId, 'contract')
    const contractRules = this.extractContractRulesForCorrelation(contract)

    // Check for LLM correlation map first
    const llmMapping = llmCorrelationMap?.lineItemMappings?.find(
      m => m.invoiceLineIndex === lineItemIndex
    )
    const llmContractMatch = llmMapping?.matchedContractRule

    let contractCorrelation: CorrelationResult

    // If LLM provided a HIGH confidence match, use it
    if (llmContractMatch && llmContractMatch.confidence === 'HIGH' && llmContractMatch.ruleIndex !== undefined && llmContractMatch.ruleIndex >= 0) {
      bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION: ${llmContractMatch.ruleName || 'unnamed'} (${llmContractMatch.confidence})`)
      bridgeLog(`[OntologicalBridge]   Reasoning: ${llmContractMatch.reasoning}`)
      contractCorrelation = {
        score: 90, // LLM HIGH = 90%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 90 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match: ${llmContractMatch.reasoning}`,
        isReliable: true,
      }
    } else if (llmContractMatch && llmContractMatch.confidence === 'MEDIUM' && llmContractMatch.ruleIndex !== undefined && llmContractMatch.ruleIndex >= 0) {
      bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION (MEDIUM): ${llmContractMatch.ruleName || 'unnamed'}`)
      contractCorrelation = {
        score: 65, // LLM MEDIUM = 65%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 65 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match (medium): ${llmContractMatch.reasoning}`,
        isReliable: true,
      }
    } else if (llmCorrelationMap && llmCorrelationMap.lineItemMappings.length > 0 && contractRules.length > 0) {
      // v4.5: LLM provided correlation_map with mappings, but no match for this specific line item
      // This is a WARNING: MAPPING_FAILURE - LLM couldn't find a semantic match
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to contract rule`)
      bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`)
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: 'MAPPING_FAILURE: LLM could not semantically match this line item to a contract rule',
        isReliable: false,
      }
    } else if ((!llmCorrelationMap || llmCorrelationMap.lineItemMappings.length === 0) && contractRules.length > 0) {
      // v5.20 FIX: Also trigger keyword matching when LLM correlation map is EMPTY
      // An empty correlation_map (0 line item mappings) should be treated like no correlation map
      // v5.19 FIX: Use deterministic keyword matching when LLM correlation is unavailable
      // This replaces the overly-conservative "JACCARD FALLBACK DISABLED" behavior
      // that was causing legitimate rate overcharges to be missed.

      // Extract line item description from invoice for keyword matching
      const lineItems = (invoice.line_items || []) as Array<Record<string, unknown>>
      const currentLineItem = lineItemIndex !== undefined ? lineItems[lineItemIndex] || {} : {}
      const lineItemDescription = String(currentLineItem.description ?? '') // hardened: coerce non-strings

      const keywordMatch = this.findContractRuleByKeywords(lineItemDescription, contractRules as Array<Record<string, unknown>>)

      if (keywordMatch.matchedIndex >= 0) {
        bridgeLog(`[OntologicalBridge] v5.19 KEYWORD MATCH: Line "${lineItemDescription.slice(0, 40)}" → Rule "${keywordMatch.ruleName}" (${keywordMatch.score}% confidence)`)
        contractCorrelation = {
          score: keywordMatch.score,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: keywordMatch.score },
          matchedIndex: keywordMatch.matchedIndex,
          explanation: `v5.19 keyword match: ${keywordMatch.explanation}`,
          isReliable: keywordMatch.score >= 70, // Treat 70%+ keyword matches as reliable
        }
      } else {
        bridgeLog(`[OntologicalBridge] v5.19: No keyword match found for "${lineItemDescription.slice(0, 40)}" in ${contractRules.length} rules`)
        contractCorrelation = {
          score: 0,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
          matchedIndex: -1,
          explanation: 'v5.19: No keyword match - line item does not match any contract rule category',
          isReliable: false,
        }
      }
    } else {
      // No contract rules to match against
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: 'No contract rules to correlate',
        isReliable: false,
      }
    }

    // v5.6 FIX: Determine if contract has multiple financial_rules (ambiguity)
    // If contract has only ONE rule, we can use it directly without correlation
    // If contract has MULTIPLE rules, we NEED reliable correlation to know which one to use
    const hasMultipleRules = contractRules.length > 1

    for (const mapping of sortedMappings.filter(m => m.documentType === 'contract' || m.documentType === 'any')) {
      if (bindings[mapping.role]) continue

      // v5.6 FIX: For array-based contract fields (financial_rules[*]):
      // - If contract has MULTIPLE rules AND correlation is unreliable, SKIP binding
      //   (would pick wrong rule causing false MATH_INT findings like "Allowed: $8")
      // - If contract has SINGLE rule, use it directly (no ambiguity)
      // - Document-level fields (effective_date, etc.) don't need correlation
      const isArrayBasedField = mapping.fieldPath.includes('[*]')

      if (isArrayBasedField && hasMultipleRules && !contractCorrelation.isReliable) {
        // Skip binding array-based fields when we can't reliably match to a contract rule
        // This will result in INSUFFICIENT_DATA verdict instead of false FAIL
        bridgeLog(`[OntologicalBridge] SKIPPING ${mapping.role} - multiple contract rules require reliable correlation`)
        continue
      }

      // Use correlated rule index if available
      // For single-rule contracts, index 0 is always correct
      // For non-array fields, undefined is fine (document-level extraction)
      let ruleIndex: number | undefined
      if (contractCorrelation.isReliable) {
        ruleIndex = contractCorrelation.matchedIndex
      } else if (!hasMultipleRules && contractRules.length === 1) {
        ruleIndex = 0 // Single rule - use it directly
      }

      const match = this.extractWithFallbacks(contract, mapping, ruleIndex)

      if (match !== null) {
        // v5.0 DETERMINISTIC MODE:
        // When matchType is 'exact' or 'alternative' (explicit path resolution succeeded),
        // the binding is deterministic - we don't need LLM correlation to trust it.
        // Only scale fuzzy/deep_search matches by correlation factor.
        let adjustedConfidence: number
        const isDeterministic = match.matchType === 'exact' || match.matchType === 'alternative'
        if (isDeterministic) {
          // Exact/alternative path match = deterministic, use original confidence
          adjustedConfidence = match.confidence
        } else {
          // Fuzzy/deep_search = needs correlation validation
          const correlationFactor = contractCorrelation.score / 100
          adjustedConfidence = Math.round(match.confidence * correlationFactor)
        }

        // v4.5: Use role-specific normalization with audit trail
        const normResult = this.normalizeValueForRole(match.value, mapping.role)

        bindings[mapping.role] = {
          value: normResult.normalized,
          source: 'contract',
          field: match.matchPath,
          confidence: adjustedConfidence,
          // v4.5: Normalization provenance
          originalValue: (normResult.meta?.original ?? match.value) as string | number | Date | null,
          normalizedValue: typeof normResult.normalized === 'object' ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations,
        }

        if (match.matchType === 'fuzzy' || match.matchType === 'deep_search') {
          bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}% adjusted)`)
        } else {
          bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}%)`)
        }
      }
    }

    // ========================================================================
    // STEP 4: Correlate invoice line item to evidence, then bind
    // LLM mapping takes precedence over code-based correlation when available
    // v5.1: Update context for flight recorder
    // ========================================================================
    this.setExtractionContext(invoiceId, domainId, 'evidence')
    const evidenceItems = this.extractEvidenceForCorrelation(evidence)

    // Check for LLM evidence correlation
    const llmEvidenceMatches = llmMapping?.matchedEvidence?.filter(
      m => m.evidenceDocIndex !== undefined && m.evidenceDocIndex >= 0 && m.confidence !== 'LOW'
    ) || []

    let evidenceCorrelation: CorrelationResult

    // If LLM provided HIGH confidence evidence match, use it
    if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === 'HIGH') {
      const bestMatch = llmEvidenceMatches[0]
      bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION: doc[${bestMatch.evidenceDocIndex}] ticket:${bestMatch.ticketNumber || 'none'} (${bestMatch.confidence})`)
      bridgeLog(`[OntologicalBridge]   Reasoning: ${bestMatch.reasoning}`)
      evidenceCorrelation = {
        score: 90, // LLM HIGH = 90%
        factors: { dateMatch: 45, referenceMatch: 45, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match: ${bestMatch.reasoning}`,
        isReliable: true,
      }
    } else if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === 'MEDIUM') {
      const bestMatch = llmEvidenceMatches[0]
      bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION (MEDIUM): doc[${bestMatch.evidenceDocIndex}]`)
      evidenceCorrelation = {
        score: 65, // LLM MEDIUM = 65%
        factors: { dateMatch: 32, referenceMatch: 33, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match (medium): ${bestMatch.reasoning}`,
        isReliable: true,
      }
    } else if (llmCorrelationMap && evidenceItems.length > 0) {
      // v4.5: LLM provided correlation_map but no match for this line item
      // This is a WARNING: MAPPING_FAILURE - LLM couldn't find a semantic match
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to evidence`)
      bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`)
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: 'MAPPING_FAILURE: LLM could not semantically match this line item to evidence',
        isReliable: false,
      }
    } else if (!llmCorrelationMap && evidenceItems.length > 0) {
      // v4.5: No LLM correlation_map at all - KILL JACCARD FALLBACK
      // Instead of fabricating matches with Jaccard, issue a clear warning
      bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - No LLM correlation_map provided`)
      bridgeLog(`[OntologicalBridge]   ${evidenceItems.length} evidence items exist but cannot be semantically matched`)
      bridgeLog(`[OntologicalBridge]   JACCARD FALLBACK DISABLED - insufficient data for reliable matching`)
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: 'MAPPING_FAILURE: No LLM correlation_map - cannot semantically match to evidence',
        isReliable: false,
      }
    } else {
      // No evidence items to match against
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: 'No evidence items to correlate',
        isReliable: false,
      }
    }

    for (const mapping of sortedMappings.filter(m => m.documentType === 'evidence')) {
      if (bindings[mapping.role]) continue

      // v5.5 HETEROGENEOUS LINE ITEM DETECTION (must run BEFORE correlation branch)
      // If invoice has multiple distinct line item types (e.g., "transport" + "fuel surcharge" + "crane"),
      // we cannot safely bind a single ACTUAL_QUANTITY globally - different line items need different handling
      if (mapping.role === 'ACTUAL_QUANTITY') {
        bridgeLog(`[OntologicalBridge] v5.5 CHECK ENTERED - invoice exists: ${!!invoice}`)
        const invoiceLineItems = invoice ? (invoice as Record<string, unknown>).line_items as Array<Record<string, unknown>> | undefined : undefined
        bridgeLog(`[OntologicalBridge] v5.5 line_items: ${invoiceLineItems ? `array of ${invoiceLineItems.length}` : 'undefined'}`)
        if (invoiceLineItems && Array.isArray(invoiceLineItems) && invoiceLineItems.length > 1) {
          // Extract all line item descriptions
          const descriptions = invoiceLineItems
            .map(item => (item.description || item.service || item.name) as string | undefined)
            .filter((d): d is string => typeof d === 'string' && d.length > 0)
            .map(d => d.toLowerCase())

          // Check for heterogeneity by looking for distinct categories
          const hasTransport = descriptions.some(d => /transport|haul|freight|delivery|drive/.test(d))
          const hasFuel = descriptions.some(d => /fuel|gas|diesel/.test(d))
          const hasCrane = descriptions.some(d => /crane|mobilization|rigging|lift/.test(d))
          const hasMileage = descriptions.some(d => /mileage|mile|excess|distance/.test(d))
          const hasPerDiem = descriptions.some(d => /per diem|lodging|overnight|hotel/.test(d))
          const hasOther = descriptions.some(d => /surcharge|fee|charge|standby|wait/.test(d))

          const categoryCount = [hasTransport, hasFuel, hasCrane, hasMileage, hasPerDiem, hasOther].filter(Boolean).length

          if (categoryCount >= 2) {
            // Multiple line item categories detected - don't bind global ACTUAL_QUANTITY
            bridgeLog(`[OntologicalBridge] v5.5 HETEROGENEOUS INVOICE DETECTED - ${categoryCount} distinct categories`)
            bridgeLog(`[OntologicalBridge]   Line items: ${descriptions.slice(0, 3).join(', ')}${descriptions.length > 3 ? '...' : ''}`)
            bridgeLog(`[OntologicalBridge]   SKIPPING global ACTUAL_QUANTITY binding - LLM will handle per-line-item`)
            continue // Skip this role entirely for this invoice
          }
        }
      }

      // Only use correlated evidence if correlation is reliable
      if (evidenceCorrelation.isReliable && evidenceCorrelation.matchedIndex >= 0) {
        const correlatedEvidence = evidence[evidenceCorrelation.matchedIndex]
        const match = this.extractWithFallbacks(correlatedEvidence, mapping)

        if (match !== null) {
          // v5.0 DETERMINISTIC MODE: Exact/alternative matches don't need correlation scaling
          let adjustedConfidence: number
          const isDeterministic = match.matchType === 'exact' || match.matchType === 'alternative'
          if (isDeterministic) {
            adjustedConfidence = match.confidence // Deterministic path = use original
          } else {
            const correlationFactor = evidenceCorrelation.score / 100
            adjustedConfidence = Math.round(match.confidence * correlationFactor)
          }

          // v4.5: Use role-specific normalization with audit trail
          const normResult = this.normalizeValueForRole(match.value, mapping.role)

          bindings[mapping.role] = {
            value: normResult.normalized,
            source: 'evidence',
            field: `evidence[${evidenceCorrelation.matchedIndex}].${match.matchPath}`,
            confidence: adjustedConfidence,
            // v4.5: Normalization provenance
            originalValue: (normResult.meta?.original ?? match.value) as string | number | Date | null,
            normalizedValue: typeof normResult.normalized === 'object' ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations,
          }

          bridgeLog(`[OntologicalBridge] EVIDENCE BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`)
        }
      } else {
        // v5.0 QTY_MATCH FIX: Single Evidence Deterministic Mode
        // When there's EXACTLY ONE evidence document, there's no ambiguity about which to use
        // Grant higher confidence for exact/alternative path matches
        const isSingleEvidence = evidence.length === 1

        // v5.4 semantic check - backup for non-heterogeneous invoices
        const needsSemanticCheck = mapping.role === 'ACTUAL_QUANTITY'
        const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value

        // Fallback: try all evidence
        for (let evIdx = 0; evIdx < evidence.length; evIdx++) {
          const ev = evidence[evIdx]
          const match = this.extractWithFallbacks(ev, mapping)
          if (match !== null) {
            // v5.4: For ACTUAL_QUANTITY, check description similarity first (backup check)
            if (needsSemanticCheck && typeof invoiceDesc === 'string') {
              // Extract evidence description from the same line item
              const evLineItems = (ev as Record<string, unknown>).line_items as Array<Record<string, unknown>> | undefined
              let evidenceDescForQty: string | undefined

              // Try to get description from the line item that has this quantity
              if (evLineItems && Array.isArray(evLineItems)) {
                for (const evItem of evLineItems) {
                  const evQty = evItem.quantity || evItem.hours || evItem.qty
                  if (evQty === match.value) {
                    evidenceDescForQty = (evItem.description || evItem.service || evItem.name) as string | undefined
                    break
                  }
                }
              }

              // If no matching line item found, try document-level description
              if (!evidenceDescForQty) {
                evidenceDescForQty = (ev as Record<string, unknown>).description as string | undefined
              }
              // hardened: coerce non-string descriptions (a numeric description would throw on .slice)
              if (evidenceDescForQty !== undefined && typeof evidenceDescForQty !== 'string') {
                evidenceDescForQty = String(evidenceDescForQty)
              }

              // Check similarity
              const similarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDescForQty)
              const SEMANTIC_THRESHOLD = 0.25 // 25% word overlap required

              if (similarity < SEMANTIC_THRESHOLD) {
                bridgeLog(`[OntologicalBridge] SKIPPED ACTUAL_QUANTITY binding - descriptions don't match (${(similarity * 100).toFixed(0)}% < ${SEMANTIC_THRESHOLD * 100}%)`)
                bridgeLog(`[OntologicalBridge]   Invoice: "${typeof invoiceDesc === 'string' ? invoiceDesc.slice(0, 50) : 'N/A'}"`)
                bridgeLog(`[OntologicalBridge]   Evidence: "${evidenceDescForQty?.slice(0, 50) || 'N/A'}"`)
                continue // Skip this evidence, try next
              }
            }

            // v5.0: Calculate confidence based on match quality and evidence count
            let adjustedConfidence: number
            const isDeterministicPath = match.matchType === 'exact' || match.matchType === 'alternative'

            if (isSingleEvidence && isDeterministicPath) {
              // Single evidence + explicit path = high confidence (no ambiguity)
              adjustedConfidence = match.confidence // 100% for exact, 95% for alternative
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-deterministic): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`)
            } else if (isSingleEvidence) {
              // Single evidence + fuzzy path = medium confidence
              adjustedConfidence = Math.min(75, match.confidence)
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-fuzzy): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`)
            } else {
              // Multiple evidence documents without correlation = low confidence
              adjustedConfidence = Math.min(50, Math.round(match.confidence * 0.5))
              bridgeLog(`[OntologicalBridge] EVIDENCE BIND (uncorrelated): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}% - LOW CONFIDENCE)`)
            }

            // v4.5: Use role-specific normalization with audit trail
            const normResult = this.normalizeValueForRole(match.value, mapping.role)

            bindings[mapping.role] = {
              value: normResult.normalized,
              source: 'evidence',
              field: `evidence[${evIdx}].${match.matchPath}`,
              confidence: adjustedConfidence,
              // v4.5: Normalization provenance
              originalValue: (normResult.meta?.original ?? match.value) as string | number | Date | null,
              normalizedValue: typeof normResult.normalized === 'object' ? String(normResult.normalized) : normResult.normalized,
              normalizations: normResult.meta?.transformations,
            }
            break
          }
        }
      }
    }

    // v5.11 FIX: Sanity check VERIFIED_AMOUNT from evidence
    // Tickets often have totals.total = hours (e.g., 8), not dollars
    // If VERIFIED_AMOUNT is implausibly small compared to CLAIMED_AMOUNT, reject it
    if (bindings.VERIFIED_AMOUNT && bindings.CLAIMED_AMOUNT) {
      const verified = bindings.VERIFIED_AMOUNT.value as number
      const claimed = bindings.CLAIMED_AMOUNT.value as number

      // If VERIFIED_AMOUNT is less than 5% of CLAIMED_AMOUNT, it's probably wrong
      // e.g., VERIFIED_AMOUNT=8 (hours misread as $8) vs CLAIMED_AMOUNT=$1400
      if (typeof verified === 'number' && typeof claimed === 'number' && claimed > 0) {
        const ratio = verified / claimed
        if (ratio < 0.05 && verified < 100) { // Less than 5% AND under $100
          bridgeLog(`[OntologicalBridge] v5.11 FIX: Rejecting VERIFIED_AMOUNT=${verified} - implausibly small vs CLAIMED_AMOUNT=${claimed} (ratio: ${(ratio * 100).toFixed(1)}%)`)
          bridgeLog(`[OntologicalBridge]   This is likely hours (${verified}) misread as dollars from ticket totals.total`)
          delete bindings.VERIFIED_AMOUNT
        }
      }
    }

    // Compute derived values
    this.computeDerivedBindings(bindings)

    // Get item description for context
    let itemDescription: string | undefined
    if (lineItemIndex !== undefined) {
      const lineItems = invoice.line_items as Array<{ description?: string }> | undefined
      if (lineItems && lineItems[lineItemIndex]) {
        itemDescription = lineItems[lineItemIndex].description
      }
    }

    return {
      bindings,
      invoiceId: (invoice.document_number as string) || (invoice.id as string) || 'unknown',
      lineItemIndex,
      itemDescription,
      // Include correlation info for provenance
      correlationInfo: {
        evidence: evidenceCorrelation,
        contract: contractCorrelation,
      },
    } as BindingContext
  }

  /**
   * Extract line item data for correlation matching
   */
  private extractLineItemForCorrelation(
    invoice: Record<string, unknown>,
    lineItemIndex?: number
  ): LineItemData {
    const lineItems = invoice.line_items as Array<Record<string, unknown>> | undefined

    if (!lineItems || lineItemIndex === undefined || !lineItems[lineItemIndex]) {
      // Fallback to invoice-level data
      return {
        description: invoice.description as string | undefined,
        date: this.extractDateValue(invoice),
        referenceIds: this.extractReferenceIds(invoice),
      }
    }

    const item = lineItems[lineItemIndex]
    return {
      description: (item.description || item.service || item.name) as string | undefined,
      date: this.extractDateValue(item) || this.extractDateValue(invoice),
      referenceIds: this.extractReferenceIds(invoice),
      quantity: (item.quantity || item.hours || item.qty) as number | undefined,
      rate: (item.unit_price || item.rate || item.price) as number | undefined,
      amount: (item.amount || item.total) as number | undefined,
    }
  }

  /**
   * Extract contract rules for correlation matching
   */
  private extractContractRulesForCorrelation(
    contract: Record<string, unknown>
  ): ContractRuleData[] {
    const rules = contract.financial_rules as Array<Record<string, unknown>> | undefined
    if (!rules || !Array.isArray(rules)) return [] // hardened

    return rules.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object').map(rule => ({
      ruleName: (rule.rule_name || rule.name || rule.description) as string | undefined,
      description: (rule.description || rule.rule_name) as string | undefined,
      rate: ((rule.values as Record<string, unknown>)?.rate ||
             (rule.values as Record<string, unknown>)?.hourly_rate ||
             rule.rate) as number | undefined,
      unit: ((rule.values as Record<string, unknown>)?.unit || rule.unit) as string | undefined,
    }))
  }

  /**
   * Extract evidence items for correlation matching
   */
  private extractEvidenceForCorrelation(
    evidence: Record<string, unknown>[]
  ): EvidenceData[] {
    return evidence.map(ev => ({
      description: (ev.description || ev.service_description || ev.work_description) as string | undefined,
      date: this.extractDateValue(ev),
      referenceIds: this.extractReferenceIds(ev),
      ticketNumber: (ev.ticket_number || ev.document_number || ev.reference) as string | undefined,
      quantity: (ev.quantity || (ev.totals as Record<string, unknown>)?.total) as number | undefined,
      hours: ((ev.totals as Record<string, unknown>)?.hours ||
              (ev.totals as Record<string, unknown>)?.total_hours ||
              ev.hours) as number | undefined,
    }))
  }

  /**
   * Extract date value from document
   * v5.0: Implements MIN(service_date) logic for TIME_ORD accuracy
   */
  private extractDateValue(doc: Record<string, unknown>): string | undefined {
    // Try common date field names first
    const dateFields = ['service_date', 'work_date', 'event_date', 'date', 'invoice_date', 'ticket_date']
    for (const field of dateFields) {
      const raw = doc[field]
      // hardened: only scalar dates; objects/arrays here are not a date (fuzz-found)
      if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
    }

    // Try dates array - supports both { date: '...' } and { value: '...' } structures
    // hardened: `dates` must be an array of objects; anything else is treated as absent (fuzz-found crash)
    const rawDates = doc.dates
    const dates = Array.isArray(rawDates)
      ? (rawDates.filter(d => d !== null && typeof d === 'object') as Array<{ date?: string; value?: string; type?: string }>)
      : undefined
    if (dates && dates.length > 0) {
      // v5.0 TIME_ORD FIX: Prefer service_date type, then find MIN date
      const serviceDateTypes = ['service_date', 'service', 'work_date', 'work', 'event_date', 'event']
      const invoiceDateTypes = ['invoice_date', 'invoice', 'billing_date']

      // First pass: find service dates (the actual event date)
      const serviceDates = dates.filter(d =>
        d.type && serviceDateTypes.some(t => d.type!.toLowerCase().includes(t.toLowerCase()))
      )

      if (serviceDates.length > 0) {
        // Get the date value (supports both .date and .value properties)
        const dateValue = serviceDates[0].date || serviceDates[0].value
        if (dateValue) return String(dateValue)
      }

      // Second pass: skip invoice dates if possible, use any other date
      const nonInvoiceDates = dates.filter(d =>
        !d.type || !invoiceDateTypes.some(t => d.type!.toLowerCase().includes(t.toLowerCase()))
      )

      if (nonInvoiceDates.length > 0) {
        const dateValue = nonInvoiceDates[0].date || nonInvoiceDates[0].value
        if (dateValue) return String(dateValue)
      }

      // Fallback: use first date with either .date or .value
      const firstDateValue = dates[0]?.date || dates[0]?.value
      if (firstDateValue) return String(firstDateValue)
    }

    return undefined
  }

  /**
   * Extract reference IDs from document
   */
  private extractReferenceIds(doc: Record<string, unknown>): string[] {
    const refs: string[] = []

    // Direct reference fields
    const refFields = ['reference_ids', 'po_number', 'order_number', 'ticket_number', 'document_number']
    for (const field of refFields) {
      const value = doc[field]
      if (Array.isArray(value)) {
        refs.push(...value.map(String))
      } else if (value) {
        refs.push(String(value))
      }
    }

    return refs.filter(r => r.length > 0)
  }

  /**
   * Validate that an extracted value matches the expected type for a role.
   * This prevents fuzzy matching from grabbing wrong fields.
   */
  private validateValueType(value: unknown, role: UniversalRole): boolean {
    // a ruleset-declared kind delegates to the representative built-in role of that kind
    const declared = this.roleKinds[role]
    if (declared !== undefined) {
      const rep = OntologicalBridge.KIND_REPRESENTATIVE[declared]
      if (rep !== role) return this.validateValueType(value, rep)
    }
    const numericRoles: UniversalRole[] = [
      'RATE_APPLIED', 'RATE_CONTRACTED', 'CLAIMED_AMOUNT',
      'VERIFIED_AMOUNT', 'CONTRACTED_LIMIT', 'CLAIMED_QUANTITY', 'ACTUAL_QUANTITY',
      'LINE_ITEM_TOTAL', 'EXPECTED_TOTAL',
      // invoice document-level roles
      'SUBTOTAL', 'TAX_AMOUNT', 'TAX_RATE', 'DISCOUNT_AMOUNT', 'SERVICE_CHARGE', 'GRAND_TOTAL',
      'LINE_ITEMS_SUM', 'EXPECTED_GRAND_TOTAL', 'EXPECTED_TAX_AMOUNT',
    ]
    const dateRoles: UniversalRole[] = ['EVENT_DATE', 'CONTRACT_START', 'CONTRACT_END']
    const arrayRoles: UniversalRole[] = ['PRIOR_CLAIM_IDS']
    const stringRoles: UniversalRole[] = ['DOCUMENT_ID', 'INVOICE_DESCRIPTION', 'EVIDENCE_DESCRIPTION', 'CURRENCY_CODE']

    if (numericRoles.includes(role)) {
      if (typeof value === 'number') return true
      if (typeof value === 'string') {
        const cleaned = value.replace(/[,$\s]/g, '')
        return !isNaN(parseFloat(cleaned)) && cleaned.match(/^-?\d*\.?\d+$/) !== null
      }
      return false
    }

    if (dateRoles.includes(role)) {
      if (value instanceof Date) return true
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return !isNaN(parsed)
      }
      return false
    }

    if (arrayRoles.includes(role)) {
      return Array.isArray(value)
    }

    if (stringRoles.includes(role)) {
      return typeof value === 'string'
    }

    // For unknown roles, accept any non-null value
    return true
  }

  /**
   * v5.19: Deterministic keyword matching for contract rules
   *
   * When LLM correlation_map is unavailable (e.g., during code-only precompute),
   * this provides a reliable fallback by matching line item descriptions to
   * contract rule names using domain-specific keyword categories.
   *
   * Returns the best matching rule index and confidence score.
   */
  /**
   * v10.9.2: Enhanced keyword matching with expanded categories,
   * generic fallback, and correlation telemetry.
   */
  private findContractRuleByKeywords(
    lineItemDescription: string,
    contractRules: Array<Record<string, unknown>>
  ): { matchedIndex: number; ruleName: string; score: number; explanation: string } {
    const desc = lineItemDescription.toLowerCase()

    // v10.9.2: EXPANDED keyword categories - order matters (more specific first)
    // Each category maps line item keywords → contract rule keywords
    const categories: Array<{
      name: string
      lineKeywords: string[]    // Must match in line item (case-insensitive)
      ruleKeywords: string[]    // Must match in rule name/description (case-insensitive)
      excludeRuleKeywords?: string[]  // Rules containing these are excluded
      skipValidation?: boolean  // If true, don't use this for rate validation
    }> = [
      // === SPECIFIC CATEGORIES (check first) ===
      { name: 'mileage', lineKeywords: ['mileage', 'excess mile', 'miles', 'per mile'], ruleKeywords: ['mileage', 'mile'], excludeRuleKeywords: ['crane'] },
      { name: 'fuel', lineKeywords: ['fuel surcharge', 'diesel surcharge', 'fuel charge', 'fsc'], ruleKeywords: ['fuel'], skipValidation: true },
      { name: 'per_diem', lineKeywords: ['per diem', 'per-diem', 'overnight per diem', 'overnight lodging', 'lodging', 'hotel', 'motel'], ruleKeywords: ['per diem', 'per-diem', 'overnight', 'lodging'] },
      { name: 'standby', lineKeywords: ['standby', 'wait time', 'detention', 'waiting', 'delay'], ruleKeywords: ['standby', 'detention', 'wait'] },
      { name: 'permit', lineKeywords: ['permit', 'oversize', 'overweight', 'os/ow'], ruleKeywords: ['permit'] },
      { name: 'crane', lineKeywords: ['crane', 'rigging crew', 'rigging', 'lift'], ruleKeywords: ['crane', 'rigging'] },
      { name: 'pilot', lineKeywords: ['pilot car', 'escort vehicle', 'lead car', 'chase car', 'escort'], ruleKeywords: ['pilot', 'escort'] },

      // === TRANSPORT/HAULING (common) ===
      { name: 'heavy_haul', lineKeywords: ['heavy haul', 'heavy-haul', 'oversize load', 'specialized transport'], ruleKeywords: ['heavy haul', 'heavy-haul', 'specialized'] },
      { name: 'transport', lineKeywords: ['transport', 'haul', 'hauling', 'trucking', 'freight', 'delivery', 'shipping'], ruleKeywords: ['transport', 'haul', 'trucking', 'freight', 'delivery'] },

      // === WATER/FLUID SERVICES ===
      { name: 'water', lineKeywords: ['water', 'h2o', 'hydro', 'water haul', 'water truck', 'water service'], ruleKeywords: ['water', 'h2o', 'hydro'] },
      { name: 'vacuum', lineKeywords: ['vacuum', 'vac truck', 'vac service', 'vacuum truck'], ruleKeywords: ['vacuum', 'vac'] },
      { name: 'pump', lineKeywords: ['pump', 'pumping', 'pump truck', 'pump service'], ruleKeywords: ['pump'] },

      // === LABOR/SERVICE (very common) ===
      { name: 'labor', lineKeywords: ['labor', 'labour', 'manpower', 'crew', 'worker', 'hand'], ruleKeywords: ['labor', 'labour', 'manpower', 'crew', 'hourly'] },
      { name: 'service', lineKeywords: ['service', 'services', 'service call', 'field service'], ruleKeywords: ['service', 'hourly', 'rate'] },
      { name: 'hourly', lineKeywords: ['hourly', 'per hour', '/hr', '/ hr', 'hour rate'], ruleKeywords: ['hourly', 'hour', '/hr'] },
      { name: 'daily', lineKeywords: ['daily', 'per day', '/day', 'day rate'], ruleKeywords: ['daily', 'day', '/day'] },

      // === EQUIPMENT ===
      { name: 'equipment_rental', lineKeywords: ['equipment rental', 'equipment rate', 'equip rental'], ruleKeywords: ['equipment', 'rental'] },
      { name: 'rental', lineKeywords: ['rental', 'rent', 'lease'], ruleKeywords: ['rental', 'rent', 'lease'] },
      { name: 'operator', lineKeywords: ['operator', 'operated', 'with operator'], ruleKeywords: ['operator', 'operated'] },

      // === MISC CHARGES ===
      { name: 'mobilization', lineKeywords: ['mobilization', 'mob', 'demob', 'demobilization', 'move-in', 'move-out'], ruleKeywords: ['mobilization', 'mob', 'demob'] },
      { name: 'minimum', lineKeywords: ['minimum', 'min charge', 'minimum charge', 'min.'], ruleKeywords: ['minimum', 'min'] },
      { name: 'overtime', lineKeywords: ['overtime', 'ot', 'over time', 'after hours'], ruleKeywords: ['overtime', 'ot', 'after hours'] },
      { name: 'weekend', lineKeywords: ['weekend', 'saturday', 'sunday', 'sat/sun'], ruleKeywords: ['weekend', 'saturday', 'sunday'] },
      { name: 'holiday', lineKeywords: ['holiday'], ruleKeywords: ['holiday'] },

      // === ADMIN/FEES ===
      { name: 'admin', lineKeywords: ['admin', 'administrative', 'admin fee', 'processing'], ruleKeywords: ['admin', 'administrative', 'processing'] },
      { name: 'markup', lineKeywords: ['markup', 'mark-up', 'margin'], ruleKeywords: ['markup', 'mark-up', 'margin'] },
    ]

    // Find which category the line item belongs to
    let matchedCategory: typeof categories[0] | null = null
    for (const cat of categories) {
      if (cat.lineKeywords.some(kw => desc.includes(kw))) {
        matchedCategory = cat
        break
      }
    }

    // v10.9.2: TELEMETRY - Log correlation attempts for debugging
    const logCorrelation = (result: string, details: string) => {
      bridgeLog(`[OntologicalBridge] CORRELATION ${result}: "${lineItemDescription.slice(0, 40)}" - ${details}`)
    }

    // === PHASE 1: Category-based matching ===
    if (matchedCategory) {
      // Skip fuel surcharges - they're index-based and can't be validated
      if (matchedCategory.skipValidation) {
        logCorrelation('SKIP', `${matchedCategory.name} requires external validation`)
        return {
          matchedIndex: -1,
          ruleName: '',
          score: 0,
          explanation: `Skipping ${matchedCategory.name} - index-based, requires external validation`
        }
      }

      // Find best matching rule for this category
      let bestMatch: { index: number; score: number; rule: Record<string, unknown> } | null = null

      for (let i = 0; i < contractRules.length; i++) {
        const rule = contractRules[i]
        const ruleName = ((rule.rule_name || rule.description || '') as string).toLowerCase()
        const ruleDesc = ((rule.description || '') as string).toLowerCase()
        const ruleText = ruleName + ' ' + ruleDesc

        // Check exclusions first
        if (matchedCategory.excludeRuleKeywords?.some(kw => ruleText.includes(kw))) {
          continue
        }

        // Count keyword matches
        const matchCount = matchedCategory.ruleKeywords.filter(kw => ruleText.includes(kw)).length
        if (matchCount > 0) {
          const score = Math.min(90, 60 + matchCount * 15)
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { index: i, score, rule }
          }
        }
      }

      if (bestMatch) {
        const ruleName = (bestMatch.rule.rule_name || bestMatch.rule.description || 'unnamed') as string
        logCorrelation('CATEGORY', `${matchedCategory.name} → "${ruleName}" (${bestMatch.score}%)`)
        return {
          matchedIndex: bestMatch.index,
          ruleName,
          score: bestMatch.score,
          explanation: `Category "${matchedCategory.name}" matched rule "${ruleName}" with ${bestMatch.score}% confidence`
        }
      }

      // Category matched but no rule found
      logCorrelation('CATEGORY_NO_RULE', `${matchedCategory.name} category but no matching rule in ${contractRules.length} rules`)
    }

    // === PHASE 2: Generic word overlap fallback (v10.9.2) ===
    // When no category matches, try direct word matching between line item and rules
    const lineWords = desc
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2) // Skip tiny words
      .filter(w => !['the', 'and', 'for', 'per', 'with', 'from', 'this', 'that'].includes(w))

    if (lineWords.length === 0) {
      logCorrelation('FAIL', 'No meaningful words in line item description')
      return {
        matchedIndex: -1,
        ruleName: '',
        score: 0,
        explanation: `No meaningful words in "${lineItemDescription.slice(0, 50)}"`
      }
    }

    let bestGenericMatch: { index: number; score: number; rule: Record<string, unknown>; matchedWords: string[] } | null = null

    for (let i = 0; i < contractRules.length; i++) {
      const rule = contractRules[i]
      const ruleName = ((rule.rule_name || rule.description || '') as string).toLowerCase()
      const ruleDesc = ((rule.description || '') as string).toLowerCase()
      const ruleText = ruleName + ' ' + ruleDesc

      // Find overlapping words
      const matchedWords = lineWords.filter(word => ruleText.includes(word))

      if (matchedWords.length > 0) {
        // Score based on overlap ratio and absolute count
        const overlapRatio = matchedWords.length / lineWords.length
        const score = Math.min(75, Math.round(40 + overlapRatio * 35))

        if (!bestGenericMatch || matchedWords.length > bestGenericMatch.matchedWords.length ||
            (matchedWords.length === bestGenericMatch.matchedWords.length && score > bestGenericMatch.score)) {
          bestGenericMatch = { index: i, score, rule, matchedWords }
        }
      }
    }

    if (bestGenericMatch && bestGenericMatch.matchedWords.length >= 1) {
      const ruleName = (bestGenericMatch.rule.rule_name || bestGenericMatch.rule.description || 'unnamed') as string
      const wordsStr = bestGenericMatch.matchedWords.slice(0, 3).join(', ')
      logCorrelation('GENERIC', `words [${wordsStr}] → "${ruleName}" (${bestGenericMatch.score}%)`)
      return {
        matchedIndex: bestGenericMatch.index,
        ruleName,
        score: bestGenericMatch.score,
        explanation: `Generic word match [${wordsStr}] to rule "${ruleName}" with ${bestGenericMatch.score}% confidence`
      }
    }

    // === PHASE 3: No match - log for debugging ===
    logCorrelation('FAIL', `No match in ${contractRules.length} rules. Line words: [${lineWords.slice(0, 5).join(', ')}]`)

    // Log rule names for debugging
    if (contractRules.length > 0 && contractRules.length <= 10) {
      const ruleNames = contractRules.map(r => (r.rule_name || r.description || 'unnamed') as string)
      bridgeLog(`[OntologicalBridge] CORRELATION DEBUG: Available rules: [${ruleNames.join(', ')}]`)
    }

    return {
      matchedIndex: -1,
      ruleName: '',
      score: 0,
      explanation: `No keyword or word overlap match for "${lineItemDescription.slice(0, 50)}" in ${contractRules.length} rules`
    }
  }

  /**
   * Extract value with all fallback paths, returning confidence and match type.
   * Returns FuzzyMatchResult with confidence scoring.
   *
   * v5.1 FULL-SPECTRUM TRACEABILITY: Logs all resolution attempts to flight recorder
   */
  private extractWithFallbacks(
    document: Record<string, unknown>,
    mapping: DomainFieldMapping,
    arrayIndex?: number
  ): FuzzyMatchResult | null {
    const alternativesTried: string[] = []

    // 1. Try exact path first (confidence: 100)
    let value = this.extractValue(document, mapping.fieldPath, arrayIndex, false)
    if (value !== null && value !== undefined) {
      // Log success
      this.logResolutionAttempt(mapping.fieldPath, mapping.role, true, value, 100, 'exact', 1, alternativesTried, document)
      return {
        value,
        confidence: 100,
        matchType: 'exact',
        matchPath: mapping.fieldPath
      }
    }
    alternativesTried.push(mapping.fieldPath)

    // 2. Try alternative paths (confidence: 95)
    if (mapping.alternativePaths) {
      for (const altPath of mapping.alternativePaths) {
        value = this.extractValue(document, altPath, arrayIndex, false)
        if (value !== null && value !== undefined) {
          // Log success
          this.logResolutionAttempt(altPath, mapping.role, true, value, 95, 'alternative', 1, alternativesTried, document)
          return {
            value,
            confidence: 95,
            matchType: 'alternative',
            matchPath: altPath
          }
        }
        alternativesTried.push(altPath)
      }
    }

    // 3. Try fuzzy extraction with field aliases (confidence: 75) - WITH TYPE VALIDATION
    const fuzzyEnabled = mapping.fuzzyMatch !== false
    if (fuzzyEnabled) {
      value = this.extractValue(document, mapping.fieldPath, arrayIndex, true)
      if (value !== null && value !== undefined) {
        // TYPE GUARD: Validate extracted value matches expected type
        if (this.validateValueType(value, mapping.role)) {
          // Log success
          this.logResolutionAttempt('fuzzy', mapping.role, true, value, 75, 'fuzzy', 1, alternativesTried, document)
          return {
            value,
            confidence: 75,
            matchType: 'fuzzy',
            matchPath: 'fuzzy'
          }
        } else {
          bridgeLog(`[OntologicalBridge] Fuzzy match REJECTED for ${mapping.role}: got ${typeof value} (${String(value).slice(0, 50)})`)
          // Log type validation failure
          this.logResolutionAttempt('fuzzy', mapping.role, false, null, 0, 'none', 0, alternativesTried, document, `Type validation failed: expected ${mapping.role}-compatible, got ${typeof value}`)
        }
      }
    }

    // Log complete failure - no path resolved
    this.logResolutionAttempt(
      mapping.fieldPath,
      mapping.role,
      false,
      null,
      0,
      'none',
      0,
      alternativesTried,
      document,
      `No path resolved for ${mapping.role}. Tried: ${alternativesTried.join(', ')}`
    )

    return null
  }

  /**
   * Log a resolution attempt to the flight recorder
   * v5.1: Full-spectrum traceability for forensic replay
   */
  private logResolutionAttempt(
    path: string,
    role: UniversalRole,
    success: boolean,
    value: unknown,
    confidence: number,
    matchType: 'exact' | 'alternative' | 'fuzzy' | 'none',
    matchCount: number,
    alternativesTried: string[],
    document: Record<string, unknown>,
    error?: string
  ): void {
    if (!this.flightRecorder) return

    try {
      // Convert 'none' to undefined for the flight recorder type
      const recordedMatchType = matchType === 'none' ? undefined : matchType

      if (success) {
        this.flightRecorder.logSuccess(path, value, matchCount, {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          confidence,
          matchType: recordedMatchType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : undefined,
        })
      } else {
        this.flightRecorder.logFailure(path, error || 'No match found', {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : undefined,
          // Include document snapshot on failure for forensic replay
          documentSnapshot: document,
        })
      }
    } catch {
      // Don't let logging failures break extraction
    }
  }

  /**
   * Normalize a value to a standard type using forensic normalizer
   * Returns both normalized value and normalization metadata for audit trail.
   */
  private normalizeValue(value: unknown): number | string | Date | string[] | null {
    if (value === null || value === undefined) {
      return null
    }
    if (typeof value === 'number') {
      return value
    }
    if (typeof value === 'string') {
      // Try to parse as number using forensic normalizer
      const amountResult = normalizeAmount(value)
      if (amountResult?.success) {
        return amountResult.normalized
      }

      // Try to parse as date using forensic normalizer
      const dateResult = normalizeDate(value)
      if (dateResult?.success) {
        return new Date(dateResult.normalized)
      }

      return value
    }
    if (value instanceof Date) {
      return value
    }
    if (Array.isArray(value)) {
      // If array of objects, try to extract string values
      if (value.length > 0 && typeof value[0] === 'object') {
        return value.map(v => String(v))
      }
      return value.map(v => String(v))
    }
    return String(value)
  }

  /**
   * Normalize a value for a specific role with full audit trail
   * Returns normalization metadata for provenance tracking.
   */
  private normalizeValueForRole(
    value: unknown,
    role: UniversalRole
  ): { normalized: number | string | Date | string[] | null; meta?: NormalizedValue<unknown> } {
    if (value === null || value === undefined) {
      return { normalized: null }
    }

    // a ruleset-declared kind delegates to the representative built-in role of that kind
    const declared = this.roleKinds[role]
    if (declared !== undefined) {
      const rep = OntologicalBridge.KIND_REPRESENTATIVE[declared]
      if (rep !== role) return this.normalizeValueForRole(value, rep)
    }

    // Numeric roles - use amount normalizer (cents)
    const numericRoles: UniversalRole[] = [
      'RATE_APPLIED', 'RATE_CONTRACTED', 'CLAIMED_AMOUNT',
      'VERIFIED_AMOUNT', 'CONTRACTED_LIMIT', 'LINE_ITEM_TOTAL', 'EXPECTED_TOTAL',
      // invoice document-level amounts
      'SUBTOTAL', 'TAX_AMOUNT', 'DISCOUNT_AMOUNT', 'SERVICE_CHARGE', 'GRAND_TOTAL',
      'LINE_ITEMS_SUM', 'EXPECTED_GRAND_TOTAL', 'EXPECTED_TAX_AMOUNT',
    ]

    // Rate roles - a FRACTION, never cent-rounded (0.0825 must stay 0.0825)
    const rateRoles: UniversalRole[] = ['TAX_RATE']

    // Quantity roles - use quantity normalizer
    const quantityRoles: UniversalRole[] = ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY']

    // Date roles - use date normalizer
    const dateRoles: UniversalRole[] = ['EVENT_DATE', 'CONTRACT_START', 'CONTRACT_END']

    // Reference roles - use reference normalizer
    const referenceRoles: UniversalRole[] = ['DOCUMENT_ID']

    if (rateRoles.includes(role)) {
      const result = normalizeRate(value)
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result as NormalizedValue<unknown>
        }
      }
    }

    if (numericRoles.includes(role)) {
      const result = normalizeAmount(value)
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result as NormalizedValue<unknown>
        }
      }
    }

    if (quantityRoles.includes(role)) {
      const result = normalizeQuantity(value)
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result as NormalizedValue<unknown>
        }
      }
    }

    if (dateRoles.includes(role)) {
      const result = normalizeDate(value)
      if (result?.success) {
        return {
          normalized: new Date(result.normalized),
          meta: result as NormalizedValue<unknown>
        }
      }
      // a date that will not parse stays a STRING (→ type mismatch → UNPARSEABLE); never the numeric guess below
      return { normalized: String(value), ...(result ? { meta: result as NormalizedValue<unknown> } : {}) }
    }

    if (referenceRoles.includes(role)) {
      const result = normalizeReference(value)
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result as NormalizedValue<unknown>
        }
      }
    }

    // Fallback to basic normalization
    return { normalized: this.normalizeValue(value) }
  }

  /**
   * Simple word overlap similarity for description matching
   * Returns 0-1 score
   */
  private computeDescriptionSimilarity(a: unknown, b: unknown): number {
    // Ensure we have strings
    const strA = typeof a === 'string' ? a : null
    const strB = typeof b === 'string' ? b : null
    if (!strA || !strB) return 0

    // Extract meaningful words (3+ chars, lowercase)
    const wordsA = new Set(strA.toLowerCase().split(/\W+/).filter(w => w.length >= 3))
    const wordsB = new Set(strB.toLowerCase().split(/\W+/).filter(w => w.length >= 3))

    if (wordsA.size === 0 || wordsB.size === 0) return 0

    // Count overlapping words
    let overlap = 0
    Array.from(wordsA).forEach(word => {
      if (wordsB.has(word)) overlap++
    })

    // Jaccard-like: overlap / smaller set size
    return overlap / Math.min(wordsA.size, wordsB.size)
  }

  /**
   * Compute derived bindings (LINE_ITEM_TOTAL, EXPECTED_TOTAL, VERIFIED_AMOUNT)
   * v5.0 MATH_INT FIX: Compute VERIFIED_AMOUNT from invoice data when no evidence
   * v5.2 SCOPING FIX: Only compute EXPECTED_TOTAL when ACTUAL_QUANTITY has high correlation
   * v5.3 SEMANTIC FIX: Check description similarity before applying evidence quantities
   */
  private computeDerivedBindings(
    bindings: Partial<Record<UniversalRole, BoundValue>>
  ): void {
    const rateApplied = bindings.RATE_APPLIED?.value
    const claimedQty = bindings.CLAIMED_QUANTITY?.value

    // LINE_ITEM_TOTAL = RATE_APPLIED * CLAIMED_QUANTITY (computed from invoice)
    if (typeof rateApplied === 'number' && typeof claimedQty === 'number') {
      const computedTotal = rateApplied * claimedQty
      bindings.LINE_ITEM_TOTAL = {
        value: computedTotal,
        source: 'computed',
        field: 'RATE_APPLIED * CLAIMED_QUANTITY',
        confidence: Math.min(bindings.RATE_APPLIED?.confidence ?? 0, bindings.CLAIMED_QUANTITY?.confidence ?? 0), // inherit the weakest operand
      }
      bridgeLog(`[OntologicalBridge] COMPUTED: LINE_ITEM_TOTAL = ${rateApplied} × ${claimedQty} = ${computedTotal}`)
    }

    // EXPECTED_TOTAL = RATE_CONTRACTED * ACTUAL_QUANTITY (requires contract + evidence)
    // v5.3 SEMANTIC FIX: Only compute if descriptions semantically match
    const rateContracted = bindings.RATE_CONTRACTED?.value
    const actualQtyBinding = bindings.ACTUAL_QUANTITY
    const actualQty = actualQtyBinding?.value

    // Get descriptions for semantic comparison
    const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value as string | undefined
    const evidenceDesc = bindings.EVIDENCE_DESCRIPTION?.value as string | undefined

    // Compute description similarity
    const descSimilarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDesc)
    const SIMILARITY_THRESHOLD = 0.3 // At least 30% word overlap

    // Guard: ACTUAL_QUANTITY must be:
    // 1. From evidence source (not computed or invoice)
    // 2. Have high confidence (≥70%) indicating semantic correlation
    // 3. Description similarity must be above threshold (prevents crane × transport hours)
    const actualQtyIsCorrelated =
      actualQtyBinding &&
      actualQtyBinding.source === 'evidence' &&
      actualQtyBinding.confidence >= 70 &&
      (descSimilarity >= SIMILARITY_THRESHOLD || (!invoiceDesc && !evidenceDesc))

    if (typeof rateContracted === 'number' && typeof actualQty === 'number' && actualQtyIsCorrelated) {
      bindings.EXPECTED_TOTAL = {
        value: rateContracted * actualQty,
        source: 'computed',
        field: 'RATE_CONTRACTED * ACTUAL_QUANTITY',
        confidence: Math.min(actualQtyBinding.confidence, 95), // Capped by correlation quality
      }
      bridgeLog(`[OntologicalBridge] COMPUTED: EXPECTED_TOTAL = ${rateContracted} × ${actualQty} = ${rateContracted * actualQty} (similarity: ${(descSimilarity * 100).toFixed(0)}%)`)
    } else if (typeof rateContracted === 'number' && typeof actualQty === 'number') {
      // Log why we skipped EXPECTED_TOTAL computation
      const invDescStr = typeof invoiceDesc === 'string' ? invoiceDesc.slice(0, 50) : 'N/A'
      const evDescStr = typeof evidenceDesc === 'string' ? evidenceDesc.slice(0, 50) : 'N/A'
      bridgeLog(`[OntologicalBridge] SKIPPED: EXPECTED_TOTAL - descriptions don't match (similarity: ${(descSimilarity * 100).toFixed(0)}%, threshold: ${SIMILARITY_THRESHOLD * 100}%)`)
      bridgeLog(`[OntologicalBridge]   Invoice: "${invDescStr}"`)
      bridgeLog(`[OntologicalBridge]   Evidence: "${evDescStr}"`)
    }

    // v5.22 DEDUP FIX: VERIFIED_AMOUNT for MATH_INT should use INVOICE math only
    //
    // MATH_INT checks: Does the invoice's own math add up? (qty × rate = stated total)
    // It should NOT compare invoice total vs contract-rate-based total (that's RATE_SUP's job)
    //
    // OLD (WRONG): VERIFIED_AMOUNT = EXPECTED_TOTAL (contract rate × evidence qty)
    //   → This double-counts with RATE_SUP when rates differ
    //
    // NEW (CORRECT): VERIFIED_AMOUNT = LINE_ITEM_TOTAL (invoice rate × invoice qty)
    //   → Only catches pure arithmetic errors
    //   → EXCEPTION: If VERIFIED_AMOUNT already bound from evidence (e.g., receipt), keep it
    //
    // This ensures:
    // - RATE_SUP catches: rate overcharges (invoice rate > contract rate)
    // - QTY_MATCH catches: quantity inflation (invoice qty > evidence qty)
    // - MATH_INT catches: arithmetic errors (qty × rate ≠ stated total on invoice)
    if (!bindings.VERIFIED_AMOUNT) {
      if (bindings.LINE_ITEM_TOTAL) {
        // Use invoice-based computed total for pure math verification
        // This catches cases where amount ≠ qty × rate on the invoice itself
        bindings.VERIFIED_AMOUNT = {
          value: bindings.LINE_ITEM_TOTAL.value,
          source: 'computed',
          field: 'RATE_APPLIED * CLAIMED_QUANTITY (math check)',
          confidence: bindings.LINE_ITEM_TOTAL.confidence, // inherit from the computed total
        }
        bridgeLog(`[OntologicalBridge] COMPUTED: VERIFIED_AMOUNT = ${bindings.LINE_ITEM_TOTAL.value} (math check: rate×qty)`)
      }
      // NOTE: We no longer set VERIFIED_AMOUNT from EXPECTED_TOTAL
      // That comparison is semantically a RATE+QTY check, not a MATH check
    }
  }

  /**
   * Create bindings for ALL line items in an invoice.
   * Returns an array of BindingContext, one per line item.
   *
   * v4.5: Accepts optional LLM correlation map for semantic matching.
   */
  createLineItemBindings(
    domainId: string,
    invoice: Record<string, unknown>,
    contract: Record<string, unknown>,
    evidence: Record<string, unknown>[],
    llmCorrelationMap?: LLMCorrelationMap
  ): BindingContext[] {
    // the per-line array key comes from the ontology (first candidate that is an array wins)
    const keys = this.ontologies.get(domainId)?.lineArrayKeys ?? ['line_items']
    const lineKey = keys.find(k => Array.isArray(invoice[k]))
    const lineItems = lineKey !== undefined ? (invoice[lineKey] as Array<unknown>) : undefined
    if (!lineItems || !Array.isArray(lineItems)) {
      // No line items, create single binding for whole invoice
      return [this.createBindings(domainId, invoice, contract, evidence, undefined, llmCorrelationMap)]
    }

    const contexts: BindingContext[] = []
    for (let i = 0; i < lineItems.length; i++) {
      contexts.push(this.createBindings(domainId, invoice, contract, evidence, i, llmCorrelationMap))
    }
    return contexts
  }

  /**
   * Convert extracted correlation_map from indexer format to internal format
   */
  static convertExtractedCorrelationMap(
    extractedMap: {
      line_item_mappings?: Array<{
        invoice_line_index: number
        invoice_line_description: string
        matched_evidence?: Array<{
          evidence_doc_index?: number
          evidence_description?: string
          ticket_number?: string
          confidence: 'HIGH' | 'MEDIUM' | 'LOW'
          reasoning: string
        }>
        matched_contract_rule?: {
          rule_name?: string
          rule_index?: number
          confidence: 'HIGH' | 'MEDIUM' | 'LOW'
          reasoning: string
        }
      }>
    } | undefined
  ): LLMCorrelationMap | undefined {
    if (!extractedMap?.line_item_mappings) {
      return undefined
    }

    return {
      lineItemMappings: extractedMap.line_item_mappings.map(m => ({
        invoiceLineIndex: m.invoice_line_index,
        invoiceLineDescription: m.invoice_line_description,
        matchedEvidence: (m.matched_evidence || []).map(e => ({
          evidenceDocIndex: e.evidence_doc_index ?? -1,
          evidenceDescription: e.evidence_description,
          ticketNumber: e.ticket_number,
          confidence: e.confidence,
          reasoning: e.reasoning,
        })),
        matchedContractRule: m.matched_contract_rule ? {
          ruleName: m.matched_contract_rule.rule_name,
          ruleIndex: m.matched_contract_rule.rule_index ?? -1,
          confidence: m.matched_contract_rule.confidence,
          reasoning: m.matched_contract_rule.reasoning,
        } : undefined,
      })),
    }
  }

  /**
   * Get all available domains
   */
  getAvailableDomains(): string[] {
    return Array.from(this.ontologies.keys())
  }

  /**
   * Diagnostic: Show what paths would be tried for a role
   */
  debugPathResolution(domainId: string, role: UniversalRole, documentType: 'invoice' | 'contract' | 'evidence'): string[] {
    const ontology = this.ontologies.get(domainId)
    if (!ontology) return []

    const paths: string[] = []
    for (const mapping of ontology.mappings) {
      if (mapping.role === role && (mapping.documentType === documentType || mapping.documentType === 'any')) {
        paths.push(mapping.fieldPath)
        if (mapping.alternativePaths) {
          paths.push(...mapping.alternativePaths)
        }
        if (mapping.fieldAliases) {
          paths.push(...mapping.fieldAliases.map(a => `[fuzzy:${a}]`))
        }
      }
    }
    return paths
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let bridgeInstance: OntologicalBridge | null = null

/**
 * Get or create the ontological bridge singleton
 */
export function getOntologicalBridge(): OntologicalBridge {
  if (!bridgeInstance) {
    bridgeInstance = new OntologicalBridge()
  }
  return bridgeInstance
}

/**
 * Reset the bridge singleton (for testing)
 */
export function resetOntologicalBridge(): void {
  bridgeInstance = null
}

export default OntologicalBridge
