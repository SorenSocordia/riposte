/**
 * Structured-twin mode (CREDENCE-1): check an agent's extracted values against the filing's own binding structured
 * record (inline XBRL facts), never against a table reconstructed from HTML.
 *
 *   parseInlineXbrl(html)                         → contexts, units, facts (counted skips)
 *   verifyAgainstTwin(html | twin, claims, opts)  → a verify Verdict + per-claim judgments (PASS / FAIL / INSUFFICIENT_DATA)
 *   bindTwinFields(html | twin, opts)             → each mapped field's binding fact, agent-independent
 *   FS_CORE_TWIN_MAP                              → the declared field → concept / period map (25 fields, 10 cells)
 *
 * Twin v0.2 (CREDENCE-2): statement-anchored binding through the filing's own presentation linkbase, and
 * decimals-aware matching. Select it with `map: FS_CORE_TWIN_MAP_V02` plus `presentation`:
 *   parseTwinPresentation({ pre, filingSummary, schema })  → which us-gaap concepts sit on the face statements
 * v0.1 (FS_CORE_TWIN_MAP) is the default and is unchanged.
 *
 * Twin v0.2.1 (TWIN-V021): FS_CORE_TWIN_MAP_V021 (same presentation input as v0.2) adds each field's us-gaap scope
 * variants (twinFieldConcepts), the cash roll as the tie-break between disagreeing face lines (INSUFFICIENT_DATA AMBIGUOUS_LINE
 * when it cannot decide), and an exact power-of-ten SCALE FAIL against anchored figures. v0.2 is unchanged.
 */
export { parseInlineXbrl, parseIxNumber, decodeEntities, isUsGaap } from './ixbrl.js'
export type { InlineXbrl, InlineXbrlStats, TwinContext, TwinUnit, TwinFact } from './ixbrl.js'
export { FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021, SCOPE_VARIANT_SUFFIXES, twinFieldConcepts } from './map.js'
export type { TwinConceptMap, TwinFieldMap, TwinPeriod, TwinBindingMode, TwinMatchingMode, TwinFamilyMode, TwinScaleMode, TwinRoll } from './map.js'
export { parseTwinPresentation } from './presentation.js'
export type { TwinPresentation, TwinPresentationRole, TwinPresentationInput, TwinPresentationOptions } from './presentation.js'
export { verifyAgainstTwin, bindTwinFields, twinGate, twinVerdictInput } from './judge.js'
export type { TwinClaim, TwinOptions, TwinOutcome, TwinReason, TwinAbstainReason, TwinDiagnosis, TwinFactRef, TwinBinding, TwinBindingResult, TwinJudgment, TwinResult } from './judge.js'
