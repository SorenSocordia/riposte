/**
 * A RULESET is the unit of product growth.
 *
 * The engine is a host: one verdict schema, one binding layer, one deterministic kernel. What changes per document
 * type — invoices, construction pay applications, later paystubs / freight bills / financial statements — is a
 * ruleset package: the ontology (field names → roles), the axioms (the laws), the computed roles (the arithmetic
 * the laws compare against), and the vocabulary the verdict speaks in. Everything a second document type needs
 * lives in one folder under src/rulesets/<id>/, and nothing else in the engine has to learn about it.
 *
 * Every verdict names the ruleset id + version it was evaluated under, so a verdict issued today replays later
 * against exactly these rules.
 */

import type { BindingContext, BoundValue, ComputationalAxiom, DomainOntology, UniversalRole } from '../kernel/types.js'
import type { ClaimKind, ClaimVerdict, Evidence, InsufficiencyReason } from '../verdict/schema.js'

export type Json = Record<string, unknown>

export interface RulesetRef {
  id: string
  version: string
  domain: string
}

/** Why a role could not be bound. A bare string is a FIELD_MISSING detail; an object names a different reason. */
export type Absence = string | { reason: InsufficiencyReason; detail: string }
export type AbsenceMap = Partial<Record<UniversalRole, Absence>>

export interface References {
  contract: Json | null
  evidence: Json[]
  /** Prior documents of the same kind, as supplied (previous pay application, prior invoices). */
  history: Json[]
}

export interface ComputeInput {
  extraction: Json
  references: References
  /** Document-level binding context (mutate `bindings` to add computed roles). */
  docCtx: BindingContext
  /** One context per line, in document order (mutate to add per-line computed roles). */
  lineCtxs: BindingContext[]
}

export interface ComputeOutput {
  /** Document-level roles that could not be computed, with the reason. */
  docAbsence: AbsenceMap
  /** Per-line roles that could not be computed, indexed like lineCtxs. */
  lineAbsence: AbsenceMap[]
  /** Extra operand evidence to attach to specific claims (e.g. every line amount behind a Σ), keyed by claim_id. */
  attach: Record<string, Evidence[]>
  /** Ready-made claims the ruleset produces itself (checks that are not gavel predicates, e.g. near-duplicate detection). */
  claims?: ClaimVerdict[]
}

export interface Ruleset extends RulesetRef {
  /** Human name, e.g. "Commercial invoice", "Construction pay application (AIA G702/G703)". */
  name: string
  ontology: DomainOntology
  /** Axioms this ruleset adds to the kernel registry (the engine's core axioms are always present). */
  axioms: readonly ComputationalAxiom[]
  /** Rule codes evaluated once per line, in evaluation order. */
  lineCodes: readonly string[]
  /** Rule codes evaluated once per document, in evaluation order. */
  documentCodes: readonly string[]
  /** What kind of claim each rule makes. */
  kindByCode: Readonly<Record<string, ClaimKind>>
  /** The extracted field each rule is "about", in the caller's vocabulary. */
  fieldByCode: Readonly<Record<string, string>>
  /** Roles that come from each optional reference. Drives honesty rule 2 (REFERENCE_NOT_PROVIDED). */
  referenceRoles: {
    contract: readonly UniversalRole[]
    evidence: readonly UniversalRole[]
    history: readonly UniversalRole[]
  }
  /** Roles produced by compute() rather than bound from the document. */
  computedRoles: readonly UniversalRole[]
  /** Rounding-tolerance policy: a relative band over each rule's absolute floor. Omit / rel:0 = strict. See src/tolerance.ts. */
  defaultTolerance?: { rel: number; absCap: number }
  /**
   * Honesty rule 4 guards: [rule code, reference role]. When the contract offers several candidates for the role and
   * the bridge could not match a rule to the line, the claim abstains with AMBIGUOUS_REFERENCE.
   */
  ambiguityGuards: readonly (readonly [code: string, role: UniversalRole])[]
  /** Bind computed roles (with provenance) onto the contexts; report what could not be computed and why. */
  compute(input: ComputeInput): ComputeOutput
}

/** A computed role inherits the LOWEST confidence of its operands — a guessed operand can never launder into a locked verdict. */
export function computed(value: number, formula: string, operands: BoundValue[]): BoundValue {
  return { value, source: 'computed', field: formula, confidence: minConfidence(operands) }
}

export function minConfidence(bindings: BoundValue[]): number {
  return bindings.length === 0 ? 0 : Math.min(...bindings.map(b => b.confidence))
}

export function num(b: BoundValue | undefined): number | null {
  return b && typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : null
}

/** Sub-cent precision for computed values and variances: kills float noise without hiding a real cent. */
export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4
}
