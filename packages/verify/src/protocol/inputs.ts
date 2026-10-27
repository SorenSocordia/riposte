/**
 * The exact inputs a verify() verdict's input_hash binds (2026-10-03): ONE builder, used by verify() and the declarative
 * evaluator to compute their own input_hash, and exported so a caller (the adapters, a host port) builds a replay bundle's
 * `inputs` with the same function instead of a copy that can drift.
 *
 *   verifyInputs(extraction, options)    → the `inputs` of a replay bundle ({ verdict, inputs }) for that call
 *   verifyInputHash(extraction, options) → the input_hash that call's verdict carries
 *
 * Built-in rulesets ('invoice', 'pay-app'): `{ extraction, references: { contract, evidence, history }, source }`, each
 * reference as the caller sent it (absent: null / [] / []), plus `tolerance` when an override is given (D-TOL-ID).
 * Declarative rulesets: `{ extraction, ruleset }`, plus `tolerance` and `source` when given. The ruleset is carried whole
 * (its declared remedies too); its identity for the hash drops the remedies (rulesetIdentity, 2026-10-02).
 * Engine 0.3.0 (2026-10-03): plus `evidence` when an arbitration overlay is given (declarative/evidence.ts). Absent, the
 * inputs and the hash are exactly what they were.
 * Engine 0.5.0 (2026-10-04): plus `supplied_choices` (the judge's values for choice slots) and `archive_files` (archive bytes,
 * base64) when given. Absent, the inputs and the hash are exactly what they were.
 */
import { isDeclarativeRuleset, rulesetIdentity, type DeclarativeRuleset } from '../declarative/types.js'
import { toleranceIdentity, type TolerancePolicy } from '../tolerance.js'
import { hashOf } from '../verdict/canonical.js'

type Json = Record<string, unknown>

/** The options verifyInputs reads (verify()'s VerifyOptions, structurally; declared here so this module stays a leaf). */
export interface VerifyInputOptions {
  ruleset?: unknown
  references?: { contract?: unknown; evidence?: unknown; history?: unknown }
  source?: unknown
  tolerance?: TolerancePolicy & { rounding?: string }
  /** an arbitration evidence overlay (engine 0.3.0, declarative rulesets only) */
  evidence?: unknown
  /** values the judge supplies for choice slots (engine 0.5.0, declarative rulesets only) */
  supplied_choices?: unknown
  /** archive files supplied as bytes, base64 (engine 0.5.0, declarative rulesets only) */
  archive_files?: unknown
}

/** The replay bundle's `inputs` for verify(extraction, options). */
export function verifyInputs(extraction: Json, options: VerifyInputOptions = {}): Json {
  const tolerance = options.tolerance ? { tolerance: toleranceIdentity(options.tolerance) } : {}
  if (isDeclarativeRuleset(options.ruleset)) {
    return {
      extraction, ruleset: options.ruleset as DeclarativeRuleset, ...tolerance, ...(options.source !== undefined ? { source: options.source } : {}), ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
      // engine 0.5.0: absent, the inputs and the hash are exactly what they were
      ...(options.supplied_choices !== undefined ? { supplied_choices: options.supplied_choices } : {}), ...(options.archive_files !== undefined ? { archive_files: options.archive_files } : {}),
    }
  }
  return {
    extraction,
    references: { contract: options.references?.contract ?? null, evidence: options.references?.evidence ?? [], history: options.references?.history ?? [] },
    source: options.source ?? null,
    ...tolerance,
  }
}

/** The input_hash verify(extraction, options) gives its verdict. */
export function verifyInputHash(extraction: Json, options: VerifyInputOptions = {}): string {
  const inputs = verifyInputs(extraction, options)
  return hashOf(isDeclarativeRuleset(inputs.ruleset) ? { ...inputs, ruleset: rulesetIdentity(inputs.ruleset as DeclarativeRuleset) } : inputs)
}
