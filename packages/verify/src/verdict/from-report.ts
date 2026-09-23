/**
 * Kernel results → claim verdicts.
 *
 * The gavel speaks in ValidationResult (axiom code, PASS/FAIL/INSUFFICIENT_DATA, predicate results with
 * binding provenance). This module turns each result into a ClaimVerdict proof object, applying honesty rules
 * the kernel does not:
 *
 *  1. A gavel FAIL whose only failing predicates are "could not compare" (type mismatch, operand missing,
 *     wrong shape) is NOT a failure of the data — it is INSUFFICIENT_DATA / UNPARSEABLE.
 *  2. An INSUFFICIENT_DATA whose missing roles are ALL contract-side (or all evidence-side, or all history-side)
 *     while the caller supplied no such reference is REFERENCE_NOT_PROVIDED, not FIELD_MISSING — the extraction
 *     is not at fault.
 *  3. (abstainOnGuessedOperands, run as a post-pass) A verdict is never issued on a field that was only guessed.
 *
 * The vocabulary (claim kinds, field names, which roles come from which reference, which roles are computed)
 * comes from the RULESET — this module knows nothing about invoices or pay applications.
 */

import type { AxiomRegistry } from '../kernel/axiom-registry.js'
import type {
  BindingContext,
  BindingProvenance,
  BoundValue,
  PredicateResult,
  UniversalRole,
  ValidationResult,
} from '../kernel/types.js'
import type { AbsenceMap } from '../rulesets/types.js'
import type {
  ClaimKind,
  ClaimVerdict,
  Evidence,
  Insufficiency,
  Tier,
  Value,
} from './schema.js'

export interface ReferenceFlags {
  contract: boolean
  evidence: boolean
  history: boolean
}

export interface MapOptions {
  registry: AxiomRegistry
  refs: ReferenceFlags
  /** e.g. "document" or "line[3]" — prefixed onto the rule code to form claim_id. */
  claimPrefix: string
  /** Why a role could not be bound or computed, keyed by role (from the ruleset's compute()). */
  absence: AbsenceMap
  kindByCode: Readonly<Record<string, ClaimKind>>
  fieldByCode: Readonly<Record<string, string>>
  referenceRoles: {
    contract: readonly UniversalRole[]
    evidence: readonly UniversalRole[]
    history: readonly UniversalRole[]
  }
}

/** Sub-cent precision for computed values and variances: kills float noise without hiding a real cent. */
export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4
}

/** Kernel value → schema Value. Dates become ISO calendar dates (the kernel normalizes dates to midnight). */
export function toValue(v: BoundValue['value'] | undefined): Value {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (Array.isArray(v)) return v.map(String)
  return v
}

function evidenceFrom(p: BindingProvenance | undefined): Evidence | null {
  if (!p) return null
  const value = toValue(p.value)
  const original = p.originalValue === undefined ? undefined : toValue(p.originalValue)
  const role: Evidence['role'] =
    p.source === 'computed' ? 'CONTEXT'
    : (p.source === 'contract' || p.source === 'evidence' || p.source === 'history') ? 'REFERENCE'
    : 'OPERAND'
  const e: Evidence = {
    locator: { kind: 'field', source: p.source, path: p.fieldPath },
    value,
    confidence: p.confidence,
    role,
  }
  if (original !== undefined && original !== value) e.original = original
  if (p.normalizations && p.normalizations.length > 0) e.normalizations = p.normalizations
  return e
}

/** Build an Evidence entry directly from a binding (for operands that sit behind a computed role). */
export function evidenceFromBinding(role: UniversalRole, b: BoundValue): Evidence {
  const p: BindingProvenance = {
    role,
    value: b.value,
    source: b.source,
    fieldPath: b.field,
    confidence: b.confidence,
    originalValue: b.originalValue,
    normalizedValue: b.normalizedValue,
    normalizations: b.normalizations,
  }
  // evidenceFrom only returns null for an undefined provenance; p is defined here.
  return evidenceFrom(p) as Evidence
}

/** Stable identity for de-duplicating evidence entries. */
export function evidenceKey(e: Evidence): string {
  return e.locator.kind === 'field'
    ? `${e.locator.source}:${e.locator.path}`
    : `span:${e.locator.source_hash}:${e.locator.start}-${e.locator.end}`
}

/**
 * A DETERMINISTIC verdict is never issued on a GUESSED field.
 * Binding confidence: exact path = 100 · alternative path = 95 · fuzzy alias search = 75.
 * Any operand below this threshold forces the claim to abstain.
 */
export const MIN_VERDICT_CONFIDENCE = 90

/**
 * Honesty rule 3 — run as a POST-PASS after all operand evidence has been attached (including the operands
 * that sit behind computed roles): downgrade any PASS/FAIL claim that rests on an operand found at
 * confidence < MIN_VERDICT_CONFIDENCE to INSUFFICIENT_DATA / AMBIGUOUS_FIELD.
 *
 * This is what makes "no hallucinated verdicts by construction" true at the binding layer, not just the
 * arithmetic layer: a wrong-but-plausible field is exactly how a confident lie gets in.
 */
export function abstainOnGuessedOperands(claims: ClaimVerdict[]): void {
  for (const c of claims) {
    if (c.outcome === 'INSUFFICIENT_DATA') continue
    const guessed = c.evidence.filter(e => e.confidence < MIN_VERDICT_CONFIDENCE)
    if (guessed.length === 0) continue
    const where = guessed
      .map(g => `${g.locator.kind === 'field' ? `${g.locator.source}:${g.locator.path}` : 'span'} (confidence ${g.confidence})`)
      .join('; ')
    c.outcome = 'INSUFFICIENT_DATA'
    c.locked = false
    delete c.computation
    delete c.variance
    c.insufficiency = {
      reason: 'AMBIGUOUS_FIELD',
      detail: `${where} — a required field was located only by fuzzy name-matching; verdicts are never issued on guessed fields. Supply it under a recognized field name.`,
    }
    c.explanation = `Abstained: ${c.explanation}`
  }
}

function isUncomparable(pr: PredicateResult): boolean {
  const r = pr.failureReason ?? ''
  return /^Type mismatch/.test(r)
    || /is missing$/.test(r)
    || /must be array/.test(r)
    || /requires string values/.test(r)
    || /^Unknown operator/.test(r)
}

export function toClaimVerdicts(
  results: ValidationResult[],
  ctx: BindingContext,
  opts: MapOptions,
): ClaimVerdict[] {
  return results.map(r => toClaim(r, ctx, opts))
}

function toClaim(r: ValidationResult, ctx: BindingContext, opts: MapOptions): ClaimVerdict {
  const code = r.axiomCode
  const axiom = opts.registry.getByCode(code)
  const kind: ClaimKind = opts.kindByCode[code] ?? 'CONSISTENCY'
  const tier: Tier = 'DETERMINISTIC'
  const claim_id = `${opts.claimPrefix}.${code}`
  const rule_id = code
  const rule_name = axiom?.name ?? code
  const formula = axiom?.formalForm ?? code
  const field = opts.fieldByCode[code] ?? code.toLowerCase()

  // Evidence: every operand's provenance, de-duplicated by (source, path)
  const evidence: Evidence[] = []
  const seen = new Set<string>()
  for (const pr of r.predicateResults) {
    for (const p of [pr.leftProvenance, pr.rightProvenance]) {
      const e = evidenceFrom(p)
      if (!e) continue
      const key = evidenceKey(e)
      if (seen.has(key)) continue
      seen.add(key)
      evidence.push(e)
    }
  }

  // The assertion under test = the left-hand value of the first predicate; fall back to the first required role.
  const first = r.predicateResults[0]
  let asserted: Value = null
  if (first) asserted = toValue(first.leftValue)
  else {
    const role = axiom?.requiredRoles[0]
    if (role) asserted = toValue(ctx.bindings[role]?.value)
  }

  if (r.verdict === 'INSUFFICIENT_DATA') {
    return {
      claim_id, kind, tier, outcome: 'INSUFFICIENT_DATA', field, asserted, rule_id, rule_name,
      evidence,
      insufficiency: insufficiencyFor(r.missingRoles ?? [], opts, r.extractionHint),
      locked: false,
      explanation: r.explanation,
    }
  }

  // Honesty rule 1: a FAIL that was really "could not compare" is an abstention, not a failure.
  const failed = r.predicateResults.filter(p => !p.passed)
  if (r.verdict === 'FAIL' && failed.length > 0 && failed.every(isUncomparable)) {
    return {
      claim_id, kind, tier, outcome: 'INSUFFICIENT_DATA', field, asserted, rule_id, rule_name,
      evidence,
      insufficiency: {
        reason: 'UNPARSEABLE',
        detail: failed.map(p => p.failureReason ?? 'operands could not be compared').join('; '),
      },
      locked: false,
      explanation: r.explanation,
    }
  }

  const operands: Record<string, Value> = {}
  for (const pr of r.predicateResults) {
    operands[pr.predicate.leftRole] = toValue(pr.leftValue)
    if (pr.predicate.rightRole) operands[pr.predicate.rightRole] = toValue(pr.rightValue)
    else if (pr.predicate.constant !== undefined) operands['constant'] = pr.predicate.constant
  }
  const tolerance = first?.predicate.tolerance

  const claim: ClaimVerdict = {
    claim_id, kind, tier, outcome: r.verdict, field, asserted, rule_id, rule_name,
    computation: {
      formula,
      operands,
      result: first ? toValue(first.rightValue) : null,
      ...(tolerance !== undefined ? { tolerance: { abs: tolerance } } : {}),
    },
    evidence,
    locked: r.isLocked,
    explanation: r.explanation,
  }
  // The kernel reports magnitude (|Σ| of predicate variances, × quantity for rate rules). The verdict reports it SIGNED
  // as asserted − expected: for a single-predicate rule the predicate's own sign is the direction of the assertion.
  if (r.variance !== undefined) {
    const only = r.predicateResults.length === 1 ? r.predicateResults[0] : undefined
    const sign = only && typeof only.variance === 'number' && only.variance < 0 ? -1 : 1
    claim.variance = round4(sign * Math.abs(r.variance))
  }
  return claim
}

function insufficiencyFor(
  missing: UniversalRole[],
  opts: MapOptions,
  hint: string | undefined,
): Insufficiency {
  if (missing.length === 0) {
    return { reason: 'OUT_OF_RULESET_SCOPE', detail: hint ?? 'rule could not be evaluated' }
  }
  const { contract, evidence, history } = opts.referenceRoles
  const allContract = missing.every(m => contract.includes(m))
  const allEvidence = missing.every(m => evidence.includes(m))
  const allHistory = missing.every(m => history.includes(m))

  // Honesty rule 2: the caller did not supply the reference — the extraction is not at fault.
  if (allContract && !opts.refs.contract) {
    return { reason: 'REFERENCE_NOT_PROVIDED', detail: `No contract/PO reference supplied; this check needs ${missing.join(', ')}`, missing }
  }
  if (allEvidence && !opts.refs.evidence) {
    return { reason: 'REFERENCE_NOT_PROVIDED', detail: `No evidence reference supplied; this check needs ${missing.join(', ')}`, missing }
  }
  if (allHistory && !opts.refs.history) {
    return { reason: 'REFERENCE_NOT_PROVIDED', detail: `No previous document supplied as history; this check needs ${missing.join(', ')}`, missing }
  }

  // A ruleset may have refused to bind a role for a reason of its own (ambiguous unit, ambiguous reference…).
  for (const m of missing) {
    const a = opts.absence[m]
    if (a !== undefined && typeof a !== 'string') return { reason: a.reason, detail: a.detail, missing }
  }

  const notes = missing
    .map(m => [m, opts.absence[m]] as const)
    .filter((x): x is readonly [UniversalRole, string] => typeof x[1] === 'string' && x[1].length > 0)
    .map(([m, why]) => `${m}: ${why}`)
  const parts = [notes.join('; '), hint].filter((s): s is string => Boolean(s))
  const detail = parts.length > 0 ? parts.join(' — ') : `missing ${missing.join(', ')}`
  return { reason: 'FIELD_MISSING', detail, missing }
}
