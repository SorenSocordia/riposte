/**
 * The declarative evaluator: run a JSON-defined ruleset over an extraction and emit the SAME Verdict proof object as the
 * built-in rulesets. Enum-free; reuses the normalizer (universal digit folding included), the tolerance policy, and the
 * canonical hash. Honesty rules hold: a missing field abstains (FIELD_MISSING); an unparseable one abstains (UNPARSEABLE);
 * within-tolerance is rounding, not error; nothing is ever guessed.
 *
 * Added 2026-09-24 (additive; a ruleset that uses none of them produces byte-identical verdicts, pinned by
 * test/declarative-golden.test.ts):
 *  - OPTIONAL TERMS `ROLE?`: counts as 0 when absent. A check decides when its REQUIRED operands are present; a required
 *    operand absent → FIELD_MISSING as before; an optional one present but unparseable → UNPARSEABLE (never read as 0);
 *    a form whose operands are ALL optional and none is reported abstains (nothing was reported to check).
 *  - CHECK ALTERNATIVES `alternatives: [{left, right}]`: ordered fallback forms; the first whose required operands are
 *    all present is evaluated (chosen by presence, never by outcome).
 *  - ABSTAIN GUARDS `abstain_unless_all_present`, `abstain_if_present`, `abstain_if`: evaluated after the form is chosen
 *    (so a check that was already going to abstain for a missing field keeps that reason), before the comparison.
 *  - ROUNDING-AWARE TOLERANCE `tolerance.rounding: 'infer'` (or per check `rounding`): per check and document, the
 *    reporting unit U = the largest of {1, 1 000, 100 000, 1 000 000} dividing every operand, and
 *    tolerance = max(tol floor, rel × largest |operand|, U × number of operands). Operands = the reported amount-kind
 *    values the chosen form uses (see RoundingMode in types.ts). Such claims skip the separate relative-band pass.
 */

import { normalizeAmount, normalizeQuantity, normalizeRate } from '../binding/forensic-normalizer.js'
import { applyTolerancePolicy } from '../tolerance.js'
import { hashOf, sha256 } from '../verdict/canonical.js'
import { round4 } from '../verdict/from-report.js'
import type { ClaimVerdict, Coverage, DeclaredAccuracy, Evidence, Insufficiency, Outcome, Value, Verdict } from '../verdict/schema.js'
import { attachDeclaredAccuracy } from '../verdict/accuracy.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'
import { evalExpr, referencedRoles, roleRefs, type Env } from './expr.js'
import type { DeclarativeRuleset, DeclCheck, DeclCondition, DeclField, RoundingMode } from './types.js'

export type Json = Record<string, unknown>
export interface VerifyDeclarativeOptions { producer?: string; now?: () => Date; tolerance?: { rel: number; absCap: number; rounding?: RoundingMode }; declared_accuracy?: DeclaredAccuracy }

/** Candidate reporting units for rounding inference, largest first (the addendum's set). */
export const ROUNDING_UNITS = [1_000_000, 100_000, 1_000, 1] as const

/**
 * The reporting unit of a set of reported values: the largest candidate unit that divides every one of them, or
 * undefined when there are no values or none divides them all (e.g. amounts with cents).
 */
export function inferReportingUnit(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return ROUNDING_UNITS.find(u => values.every(v => Number.isFinite(v) && Math.abs(v) % u === 0))
}

/** Rounding-aware tolerance: max(floor, rel × largest |operand| (capped by absCap if > 0), U × number of operands). */
export function roundingTolerance(values: readonly number[], rel: number, absCap: number, floor: number): { tol: number; unit: number | undefined; n: number; maxAbs: number } {
  const n = values.length
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const unit = inferReportingUnit(values)
  // round4: 0.0003 × 20e9 is 5999999.999999999 in floating point; a boundary gap must not flip on that artefact.
  const relTerm = round4(absCap > 0 ? Math.min(rel * maxAbs, absCap) : rel * maxAbs)
  return { tol: Math.max(floor, relTerm, (unit ?? 0) * n), unit, n, maxAbs }
}

/** A guard condition's comparison (exact unless tol > 0). */
function conditionHolds(l: number, op: DeclCondition['op'], r: number, tol: number): boolean {
  switch (op) {
    case '=': return Math.abs(l - r) <= tol
    case '!=': return Math.abs(l - r) > tol
    case '<': return l < r - tol
    case '<=': return l <= r + tol
    case '>': return l > r + tol
    case '>=': return l >= r - tol
    default: return false
  }
}

/** What a scope (the document, or one line) knows about a role — for optional terms, guards and rounding. */
interface ScopeInfo {
  /** 'ok' = reported; 'defaulted' = absent but bound at the field's `default`; 'missing'; 'unparseable'. */
  status: (role: string) => 'ok' | 'defaulted' | 'missing' | 'unparseable'
  /** Where a reported role was found (for guard explanations). */
  where: (role: string) => string | undefined
  /** The reported amount-kind values behind these roles (computed roles expanded; sum() → every line's value). */
  amounts: (roles: string[]) => number[]
}

const isDefaulted = (b: Bound | undefined): boolean => !!b && b.status === 'ok' && !!b.path && b.path.startsWith('default(')
const isAmountField = (f: DeclField | undefined): boolean => !!f && (f.kind === undefined || f.kind === 'amount')
const statusOf = (b: Bound | undefined): 'ok' | 'defaulted' | 'missing' | 'unparseable' => (!b ? 'missing' : b.status === 'ok' ? (isDefaulted(b) ? 'defaulted' : 'ok') : b.status)

interface Bound {
  status: 'ok' | 'missing' | 'unparseable'
  value?: number
  strValue?: string
  /** kind 'identifier': the normalised ids (deduplicated, first-appearance order) */
  ids?: string[]
  path?: string
  confidence: number
  original?: unknown
  norms?: string[]
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** kind 'bool': true/false, 1/0 and "true"/"false"/"yes"/"no"/"1"/"0" map to 1/0. Anything else is null (UNPARSEABLE). */
function normBool(raw: unknown): { value: number; norms?: string[] } | null {
  if (raw === true || raw === false) return { value: raw ? 1 : 0, norms: ['bool_to_number'] }
  if (raw === 1 || raw === 0) return { value: raw, norms: ['already_number'] }
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === '1') return { value: 1, norms: ['bool_text_parsed'] }
    if (s === 'false' || s === 'no' || s === '0') return { value: 0, norms: ['bool_text_parsed'] }
  }
  return null
}

/** kind 'identifier': one id (string/number) or a list of them → normalised (whitespace removed, upper-cased), deduplicated. */
function normIdentifiers(raw: unknown): string[] | null {
  const one = (x: unknown): string | null | undefined => {
    if (typeof x === 'number' && Number.isFinite(x)) return String(x)
    if (typeof x !== 'string') return undefined // not an identifier at all
    const n = x.replace(/\s+/g, '').toUpperCase()
    return n.length ? n : null // blank → ignored
  }
  if (!Array.isArray(raw)) { const n = one(raw); return typeof n === 'string' ? [n] : null }
  const out: string[] = []
  for (const x of raw) {
    const n = one(x)
    if (n === undefined) return null
    if (n !== null && !out.includes(n)) out.push(n)
  }
  return out
}

function normByKind(kind: DeclField['kind'], raw: unknown): { value: number; norms?: string[] } | null {
  if (kind === 'bool') return normBool(raw)
  const n = kind === 'rate' ? normalizeRate(raw) : kind === 'quantity' ? normalizeQuantity(raw) : normalizeAmount(raw)
  if (!n?.success || typeof n.normalized !== 'number' || !Number.isFinite(n.normalized)) return null
  return { value: n.normalized, norms: n.transformations }
}

/** Resolve one field spec against a source object (extraction, or a line item). */
function bindField(source: unknown, field: DeclField): Bound {
  let resolvedButBad = false
  for (let i = 0; i < field.paths.length; i++) {
    const raw = getPath(source, field.paths[i] as string)
    if (raw === undefined || raw === null || raw === '') continue
    const confidence = i === 0 ? 100 : 95
    if (field.kind === 'string') return { status: 'ok', strValue: String(raw), path: field.paths[i], confidence, original: raw }
    if (field.kind === 'identifier') {
      const ids = normIdentifiers(raw)
      if (ids) return { status: 'ok', ids, path: field.paths[i], confidence, original: raw, norms: ['identifier_normalized'] }
      resolvedButBad = true
      continue
    }
    const norm = normByKind(field.kind, raw)
    if (norm) return { status: 'ok', value: norm.value, path: field.paths[i], confidence, original: raw, norms: norm.norms }
    resolvedButBad = true
  }
  // An absent OPTIONAL field with a declared default (e.g. an allowance that is 0 when omitted) is 'ok' at that default.
  if (!resolvedButBad && field.default !== undefined) return { status: 'ok', value: field.default, path: `default(${field.default})`, confidence: 100 }
  return { status: resolvedButBad ? 'unparseable' : 'missing', confidence: 0 }
}

function fieldEvidence(role: string, b: Bound): Evidence | null {
  if (b.status !== 'ok' || !b.path) return null
  const value: Value = b.ids !== undefined ? (Array.isArray(b.original) ? b.ids : (b.ids[0] ?? null)) : b.value !== undefined ? b.value : (b.strValue ?? null)
  const source = b.path.startsWith('default(') ? 'computed' : 'invoice'
  const e: Evidence = { locator: { kind: 'field', source, path: b.path }, value, confidence: b.confidence, role: 'OPERAND' }
  if (b.original !== undefined && String(b.original) !== String(value)) e.original = b.original as Value
  if (b.norms && b.norms.length) e.normalizations = b.norms
  return e
}

const evidenceKey = (e: Evidence): string => (e.locator.kind === 'field' ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}`)

export function verifyDeclarative(extraction: Json, ruleset: DeclarativeRuleset, options: VerifyDeclarativeOptions = {}): Verdict {
  const lineKeys = ruleset.lineArrayKeys ?? ['line_items']
  const lineKey = lineKeys.find(k => Array.isArray(extraction[k]))
  const lines: Json[] = lineKey ? (extraction[lineKey] as unknown[]).filter((x): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)) : []

  const docRoles = Object.entries(ruleset.fields).filter(([, f]) => !f.line)
  const lineRoles = Object.entries(ruleset.fields).filter(([, f]) => f.line)
  const lineRoleNames = new Set(lineRoles.map(([r]) => r))

  // Bind document fields and per-line fields.
  const boundDoc = new Map<string, Bound>()
  for (const [role, f] of docRoles) boundDoc.set(role, bindField(extraction, f))
  const boundLines: Map<string, Bound>[] = lines.map(line => {
    const m = new Map<string, Bound>()
    for (const [role, f] of lineRoles) m.set(role, bindField(line, f))
    return m
  })

  // sum(role): sum a per-line role across all lines; undefined if any line lacks it (a partial sum would lie).
  const sumRole = (role: string): number | undefined => {
    if (boundLines.length === 0) return undefined
    let acc = 0
    for (const m of boundLines) { const b = m.get(role); if (!b || b.status !== 'ok' || b.value === undefined) return undefined; acc += b.value }
    return round4(acc)
  }

  // Document-scope variable map + computed roles (evaluated in declaration order; later may use earlier).
  const docVars: Record<string, number | undefined> = {}
  for (const [role, b] of boundDoc) docVars[role] = b.status === 'ok' ? b.value : undefined
  const computedFormula = new Map<string, string>()
  for (const [role, formula] of Object.entries(ruleset.computed ?? {})) {
    computedFormula.set(role, formula)
    docVars[role] = evalExpr(formula, { vars: docVars, sum: sumRole })
  }
  const docEnv: Env = { vars: docVars, sum: sumRole }

  const policy = options.tolerance ?? ruleset.tolerance ?? { rel: 0.0003, absCap: 0 }
  const roundingDefault: RoundingMode = options.tolerance?.rounding ?? ruleset.tolerance?.rounding ?? 'none'
  const claims: ClaimVerdict[] = []
  /** Claims decided under rounding inference: their tolerance is final, so the relative-band pass skips them. */
  const inferred = new Set<ClaimVerdict>()
  const fieldSpec = (r: string): DeclField | undefined => (Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined)

  // ---- abstain guards (shared by numeric and identifier checks). null = no guard fires.
  const guardInsufficiency = (chk: DeclCheck, env: Env, scope: ScopeInfo): Insufficiency | null => {
    const unless = chk.abstain_unless_all_present ?? []
    if (unless.length) {
      const bad = unless.filter(r => scope.status(r) === 'unparseable')
      if (bad.length) return { reason: 'UNPARSEABLE', detail: `guard abstain_unless_all_present: ${bad.join(', ')} present but unparseable`, missing: bad }
      const absent = unless.filter(r => scope.status(r) !== 'ok')
      if (absent.length) return { reason: 'FIELD_MISSING', detail: `guard abstain_unless_all_present: ${absent.join(', ')} not reported`, missing: absent }
    }
    for (const r of chk.abstain_if_present ?? []) {
      const s = scope.status(r)
      if (s === 'ok' || s === 'unparseable') { const w = scope.where(r); return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if_present: ${r} is reported${w ? ` (${w})` : ''}; the identity does not model it` } }
    }
    for (const c of chk.abstain_if ?? []) {
      let l: number | undefined, r: number | undefined
      try {
        const unp = roleRefs(c.left, c.right).all.filter(x => scope.status(x) === 'unparseable')
        if (unp.length) return { reason: 'UNPARSEABLE', detail: `guard abstain_if: ${unp.join(', ')} present but unparseable, so "${c.left} ${c.op} ${c.right}" cannot be evaluated`, missing: unp }
        l = evalExpr(c.left, env); r = evalExpr(c.right, env)
      } catch (e) { return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if: expression error: ${(e as Error).message}` } }
      if (l === undefined || r === undefined) continue // an operand is absent: the condition cannot hold
      if (conditionHolds(l, c.op, r, c.tol ?? 0)) return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if: ${c.left} ${c.op} ${c.right} holds (${round4(l)} vs ${round4(r)})` }
    }
    return null
  }

  // ---- helper to build one check claim given an env, an evidence-gatherer, and a claim-id prefix
  const runCheck = (chk: DeclCheck, env: Env, prefix: string, gatherEvidence: (roles: string[]) => Evidence[], missingOf: (roles: string[]) => Insufficiency | null, scope: ScopeInfo): void => {
    const claim_id = `${prefix}.${chk.code}`
    const base = { claim_id, kind: 'RECOMPUTE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }

    // 1. The form to evaluate: the primary left/right, else the first alternative whose REQUIRED operands are present.
    //    With no alternatives and no `?`, this is exactly the old single missing-operand test.
    const forms = [{ left: chk.left, right: chk.right }, ...(chk.alternatives ?? [])]
    const multi = forms.length > 1
    const blockedBy = (refs: ReturnType<typeof roleRefs>): Insufficiency | null => {
      const m = missingOf(refs.required)
      if (m) return m
      for (const o of refs.optional) if (scope.status(o) === 'unparseable') return { reason: 'UNPARSEABLE', detail: `optional ${o} is present but could not be parsed as a number`, missing: [o] }
      return null
    }
    let k = -1
    let refs = roleRefs(forms[0]!.left, forms[0]!.right)
    const blocks: { refs: ReturnType<typeof roleRefs>; why: Insufficiency }[] = []
    for (let i = 0; i < forms.length; i++) {
      const r = i === 0 ? refs : roleRefs(forms[i]!.left, forms[i]!.right)
      const why = blockedBy(r)
      if (!why) { k = i; refs = r; break }
      blocks.push({ refs: r, why })
    }
    if (k < 0) {
      if (!multi) return abstain(blocks[0]!.why)
      const unp = blocks.find(b => b.why.reason === 'UNPARSEABLE')
      if (unp) return abstain(unp.why)
      const lacks = blocks.map(b => b.refs.required.filter(x => { const s = scope.status(x); return s !== 'ok' && s !== 'defaulted' }))
      return abstain({ reason: 'FIELD_MISSING', detail: `no form of ${chk.code} has all its required operands (${lacks.map((l, i) => `form ${i + 1} lacks ${l.join(', ') || blocks[i]!.why.detail}`).join('; ')})`, missing: [...new Set(lacks.flat())] })
    }
    const form = forms[k]!
    const roles = refs.all
    // A form made only of optional terms, none of them reported, has nothing to check.
    if (refs.required.length === 0 && refs.optional.length > 0 && !refs.optional.some(o => scope.status(o) === 'ok')) {
      return abstain({ reason: 'FIELD_MISSING', detail: `none of the operands of ${chk.code} is reported (all are optional)`, missing: refs.optional })
    }

    // 2. Abstain guards.
    const g = guardInsufficiency(chk, env, scope)
    if (g) return abstain(g)

    // 3. Evaluate.
    let left: number | undefined, right: number | undefined
    try { left = evalExpr(form.left, env); right = evalExpr(form.right, env) }
    catch (e) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `expression error: ${(e as Error).message}` }, locked: false, explanation: `${chk.code}: bad expression` }); return }
    if (left === undefined || right === undefined) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'FIELD_MISSING', detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` }); return }

    // 4. Tolerance: the check's own floor, or the rounding-aware tolerance.
    const infer = (chk.rounding ?? roundingDefault) === 'infer'
    const rt = infer ? roundingTolerance(scope.amounts(roles), policy.rel, policy.absCap, chk.tol ?? 0.01) : undefined
    const tol = rt ? rt.tol : chk.tol ?? 0.01
    let passed: boolean
    if (chk.op === '=') passed = Math.abs(left - right) <= tol
    else if (chk.op === '<=') passed = left <= right + tol
    else if (chk.op === '>=') passed = left >= right - tol
    else passed = Math.abs(left - right) > tol // !=
    const evidence = gatherEvidence(roles)
    const absentOptional = refs.optional.filter(o => scope.status(o) !== 'ok')
    const notes = [
      ...(multi ? [`Form ${k + 1} of ${forms.length}.`] : []),
      ...(absentOptional.length ? [`Optional terms not reported (counted as 0): ${absentOptional.join(', ')}.`] : []),
      ...(rt ? [`Rounding-aware tolerance ${round4(rt.tol)} = max(${round4(policy.rel * 100)}% of the largest operand ${round4(rt.maxAbs)}, unit ${rt.unit ?? 'none'} × ${rt.n} operands${policy.absCap > 0 ? `; relative term capped at ${policy.absCap}` : ''}, floor ${chk.tol ?? 0.01})${passed && left !== right && chk.op === '=' ? ': the difference is treated as rounding, not error' : ''}.`] : []),
    ]
    const claim: ClaimVerdict = {
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: round4(left),
      computation: { formula: `${form.left} ${chk.op} ${form.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right), tolerance: rt ? { abs: round4(rt.tol), rel: policy.rel } : { abs: tol } },
      evidence, locked: !passed, explanation: `${chk.field ?? chk.code}: ${round4(left)} ${chk.op} ${round4(right)} — ${passed ? 'holds' : 'does not hold'}.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      ...(passed ? {} : { variance: round4(left - right) }),
    }
    claims.push(claim)
    if (rt) inferred.add(claim)
  }

  // ---- an identifier check (compare: 'identifier'): two NAMED identifier fields, compared as normalised id sets
  const runIdentifierCheck = (chk: DeclCheck, prefix: string, scope: 'document' | 'line', lookup: (role: string) => Bound | undefined, env: Env, info: ScopeInfo): void => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }
    const L = String(chk.left ?? '').trim(), R = String(chk.right ?? '').trim()
    if (chk.op !== '=' && chk.op !== '!=') return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `identifier checks support only = and != (got ${chk.op})` })
    if (chk.alternatives !== undefined || chk.rounding !== undefined) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'alternatives and rounding apply to numeric checks only, not to an identifier check' })
    for (const r of [L, R]) {
      const f = Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined
      if (!f || f.kind !== 'identifier' || !!f.line !== (scope === 'line')) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `"${r}" is not a ${scope}-level 'identifier' field (an identifier check names two identifier fields)` })
    }
    const bl = lookup(L), br = lookup(R)
    for (const [r, b] of [[L, bl], [R, br]] as const) if (b?.status === 'unparseable') return abstain({ reason: 'UNPARSEABLE', detail: `${r} is present but is not an identifier or a list of identifiers`, missing: [r] })
    for (const [r, b] of [[L, bl], [R, br]] as const) if (!b || b.status !== 'ok' || !b.ids) return abstain({ reason: 'FIELD_MISSING', detail: `${r} not present`, missing: [r] })
    const g = guardInsufficiency(chk, env, info)
    if (g) return abstain(g)
    const li = bl!.ids!, ri = br!.ids!
    const same = li.length === ri.length && li.every(x => ri.includes(x))
    const passed = chk.op === '=' ? same : !same
    const show = (ids: string[]): string => (ids.length === 1 ? ids[0]! : `{${ids.join(', ')}}`)
    const asValue = (ids: string[]): Value => (ids.length === 1 ? ids[0]! : ids)
    claims.push({
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: asValue(li),
      computation: { formula: `${L} ${chk.op} ${R} (identifier sets; whitespace removed, upper-cased)`, operands: { [L]: li, [R]: ri }, result: asValue(ri) },
      evidence: [fieldEvidence(L, bl!), fieldEvidence(R, br!)].filter((e): e is Evidence => e !== null),
      locked: !passed, explanation: `${chk.field ?? chk.code}: ${show(li)} ${chk.op} ${show(ri)} — ${passed ? 'holds' : 'does not hold'}.`,
    })
  }

  // ---- document-scope checks
  const docMissing = (roles: string[]): Insufficiency | null => {
    for (const r of roles) {
      const b = boundDoc.get(r)
      if (b && b.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} is present but could not be parsed as a number`, missing: [r] }
    }
    // Per-line roles referenced from a document check via sum(): unparseable if any line has the field present-but-bad.
    for (const r of roles) {
      if (!lineRoleNames.has(r)) continue
      for (let i = 0; i < boundLines.length; i++) { const b = boundLines[i]!.get(r); if (b?.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable on line ${i}`, missing: [r] } }
    }
    for (const r of roles) {
      if (computedFormula.has(r)) { if (docVars[r] === undefined) return { reason: 'FIELD_MISSING', detail: `computed ${r} could not be produced (an operand was absent)`, missing: [r] } ; continue }
      // A per-line role summed at document scope: missing if there are no lines or any line lacks it (a partial sum would lie).
      if (lineRoleNames.has(r)) { if (sumRole(r) === undefined) return { reason: 'FIELD_MISSING', detail: `${r} absent on one or more lines`, missing: [r] } ; continue }
      const b = boundDoc.get(r)
      if (!b || b.status === 'missing') return { reason: 'FIELD_MISSING', detail: `${r} not present on the document`, missing: [r] }
    }
    return null
  }
  const docEvidence = (roles: string[]): Evidence[] => {
    const out: Evidence[] = []; const seen = new Set<string>()
    const add = (e: Evidence | null) => { if (e) { const k = evidenceKey(e); if (!seen.has(k)) { seen.add(k); out.push(e) } } }
    for (const r of roles) {
      if (boundDoc.has(r)) add(fieldEvidence(r, boundDoc.get(r)!))
      else if (computedFormula.has(r) && docVars[r] !== undefined) add({ locator: { kind: 'field', source: 'computed', path: computedFormula.get(r)! }, value: round4(docVars[r] as number), confidence: 100, role: 'CONTEXT' })
      // a per-line role referenced (via sum) contributes each line's field
      for (const m of boundLines) if (m.has(r)) add(fieldEvidence(r, m.get(r)!))
    }
    return out
  }
  // What the document scope knows about a role (optional terms, guards, rounding operands).
  const docScope: ScopeInfo = {
    status: r => {
      if (boundDoc.has(r)) return statusOf(boundDoc.get(r))
      if (computedFormula.has(r)) return docVars[r] === undefined ? 'missing' : 'ok'
      if (lineRoleNames.has(r)) {
        for (const m of boundLines) if (m.get(r)?.status === 'unparseable') return 'unparseable'
        return sumRole(r) === undefined ? 'missing' : 'ok'
      }
      return 'missing'
    },
    where: r => boundDoc.get(r)?.path ?? computedFormula.get(r),
    amounts: roles => {
      const out: number[] = []
      const seen = new Set<string>()
      const walk = (r: string): void => {
        if (seen.has(r)) return
        seen.add(r)
        const f = fieldSpec(r)
        if (f && !f.line) { const b = boundDoc.get(r); if (isAmountField(f) && b?.status === 'ok' && b.value !== undefined && !isDefaulted(b)) out.push(b.value); return }
        if (f && f.line) { if (isAmountField(f)) for (const m of boundLines) { const b = m.get(r); if (b?.status === 'ok' && b.value !== undefined && !isDefaulted(b)) out.push(b.value) } return }
        const formula = computedFormula.get(r)
        if (formula !== undefined && docVars[r] !== undefined) for (const x of referencedRoles(formula)) walk(x)
      }
      for (const r of roles) walk(r)
      return out
    },
  }
  const lineScope = (m: Map<string, Bound>): ScopeInfo => ({
    status: r => statusOf(m.get(r)),
    where: r => m.get(r)?.path,
    amounts: roles => roles.flatMap(r => { const b = m.get(r); return isAmountField(fieldSpec(r)) && b?.status === 'ok' && b.value !== undefined && !isDefaulted(b) ? [b.value] : [] }),
  })

  for (const chk of ruleset.checks.filter(c => (c.scope ?? 'document') === 'document')) {
    if (chk.compare === 'identifier') runIdentifierCheck(chk, 'document', 'document', r => boundDoc.get(r), docEnv, docScope)
    else runCheck(chk, docEnv, 'document', docEvidence, docMissing, docScope)
  }

  // ---- line-scope checks
  ruleset.checks.filter(c => c.scope === 'line').forEach(chk => {
    boundLines.forEach((m, i) => {
      const lineVars: Record<string, number | undefined> = {}
      for (const [role, b] of m) lineVars[role] = b.status === 'ok' ? b.value : undefined
      const env: Env = { vars: lineVars, sum: () => undefined }
      if (chk.compare === 'identifier') { runIdentifierCheck(chk, `line[${i}]`, 'line', r => m.get(r), env, lineScope(m)); return }
      const missing = (roles: string[]): Insufficiency | null => {
        for (const r of roles) { const b = m.get(r); if (b?.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable on line ${i}`, missing: [r] } }
        for (const r of roles) { const b = m.get(r); if (!b || b.status === 'missing') return { reason: 'FIELD_MISSING', detail: `${r} not present on line ${i}`, missing: [r] } }
        return null
      }
      const ev = (roles: string[]): Evidence[] => { const out: Evidence[] = []; for (const r of roles) { const e = fieldEvidence(r, m.get(r) ?? { status: 'missing', confidence: 0 }); if (e) out.push(e) } return out }
      runCheck(chk, env, `line[${i}]`, ev, missing, lineScope(m))
    })
  })

  // The relative band applies to every numeric claim EXCEPT those decided under rounding inference (already final).
  applyTolerancePolicy(inferred.size ? claims.filter(c => !inferred.has(c)) : claims, policy)

  let pass = 0, fail = 0, ins = 0
  for (const c of claims) c.outcome === 'PASS' ? pass++ : c.outcome === 'FAIL' ? fail++ : ins++
  const coverage: Coverage = { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
  const outcome: Outcome = fail > 0 ? 'FAIL' : pass + fail === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  const input_hash = hashOf({ extraction, ruleset })
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32)
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version: ENGINE_VERSION,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash, replayable: true,
    document: { extraction_hash: hashOf(extraction), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: lines.length },
    references: { contract: false, evidence: 0, history: 0, source: false },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
  }
  return options.declared_accuracy ? attachDeclaredAccuracy(verdict, options.declared_accuracy) : verdict
}
