/**
 * The declarative evaluator: run a JSON-defined ruleset over an extraction and emit the SAME Verdict proof object as the
 * built-in rulesets. Enum-free; reuses the normalizer (universal digit folding included), the tolerance policy, and the
 * canonical hash. Honesty rules hold: a missing field abstains (FIELD_MISSING); an unparseable one abstains (UNPARSEABLE);
 * within-tolerance is rounding, not error; nothing is ever guessed.
 */

import { normalizeAmount, normalizeQuantity, normalizeRate } from '../binding/forensic-normalizer.js'
import { applyTolerancePolicy } from '../tolerance.js'
import { hashOf, sha256 } from '../verdict/canonical.js'
import { round4 } from '../verdict/from-report.js'
import type { ClaimVerdict, Coverage, DeclaredAccuracy, Evidence, Insufficiency, Outcome, Value, Verdict } from '../verdict/schema.js'
import { attachDeclaredAccuracy } from '../verdict/accuracy.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'
import { evalExpr, referencedRoles, type Env } from './expr.js'
import type { DeclarativeRuleset, DeclCheck, DeclField } from './types.js'

export type Json = Record<string, unknown>
export interface VerifyDeclarativeOptions { producer?: string; now?: () => Date; tolerance?: { rel: number; absCap: number }; declared_accuracy?: DeclaredAccuracy }

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
  const claims: ClaimVerdict[] = []

  // ---- helper to build one check claim given an env, an evidence-gatherer, and a claim-id prefix
  const runCheck = (chk: DeclCheck, env: Env, prefix: string, gatherEvidence: (roles: string[]) => Evidence[], missingOf: (roles: string[]) => Insufficiency | null): void => {
    const claim_id = `${prefix}.${chk.code}`
    const roles = [...new Set([...referencedRoles(chk.left), ...referencedRoles(chk.right)])]
    const base = { claim_id, kind: 'RECOMPUTE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const insuff = missingOf(roles)
    if (insuff) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: insuff, locked: false, explanation: `${chk.code}: ${insuff.detail}` }); return }

    let left: number | undefined, right: number | undefined
    try { left = evalExpr(chk.left, env); right = evalExpr(chk.right, env) }
    catch (e) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `expression error: ${(e as Error).message}` }, locked: false, explanation: `${chk.code}: bad expression` }); return }
    if (left === undefined || right === undefined) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'FIELD_MISSING', detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` }); return }

    const tol = chk.tol ?? 0.01
    let passed: boolean
    if (chk.op === '=') passed = Math.abs(left - right) <= tol
    else if (chk.op === '<=') passed = left <= right + tol
    else if (chk.op === '>=') passed = left >= right - tol
    else passed = Math.abs(left - right) > tol // !=
    const evidence = gatherEvidence(roles)
    claims.push({
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: round4(left),
      computation: { formula: `${chk.left} ${chk.op} ${chk.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right), tolerance: { abs: tol } },
      evidence, locked: !passed, explanation: `${chk.field ?? chk.code}: ${round4(left)} ${chk.op} ${round4(right)} — ${passed ? 'holds' : 'does not hold'}.`,
      ...(passed ? {} : { variance: round4(left - right) }),
    })
  }

  // ---- an identifier check (compare: 'identifier'): two NAMED identifier fields, compared as normalised id sets
  const runIdentifierCheck = (chk: DeclCheck, prefix: string, scope: 'document' | 'line', lookup: (role: string) => Bound | undefined): void => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }
    const L = String(chk.left ?? '').trim(), R = String(chk.right ?? '').trim()
    if (chk.op !== '=' && chk.op !== '!=') return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `identifier checks support only = and != (got ${chk.op})` })
    for (const r of [L, R]) {
      const f = Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined
      if (!f || f.kind !== 'identifier' || !!f.line !== (scope === 'line')) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `"${r}" is not a ${scope}-level 'identifier' field (an identifier check names two identifier fields)` })
    }
    const bl = lookup(L), br = lookup(R)
    for (const [r, b] of [[L, bl], [R, br]] as const) if (b?.status === 'unparseable') return abstain({ reason: 'UNPARSEABLE', detail: `${r} is present but is not an identifier or a list of identifiers`, missing: [r] })
    for (const [r, b] of [[L, bl], [R, br]] as const) if (!b || b.status !== 'ok' || !b.ids) return abstain({ reason: 'FIELD_MISSING', detail: `${r} not present`, missing: [r] })
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
  for (const chk of ruleset.checks.filter(c => (c.scope ?? 'document') === 'document')) {
    if (chk.compare === 'identifier') runIdentifierCheck(chk, 'document', 'document', r => boundDoc.get(r))
    else runCheck(chk, docEnv, 'document', docEvidence, docMissing)
  }

  // ---- line-scope checks
  ruleset.checks.filter(c => c.scope === 'line').forEach(chk => {
    boundLines.forEach((m, i) => {
      if (chk.compare === 'identifier') { runIdentifierCheck(chk, `line[${i}]`, 'line', r => m.get(r)); return }
      const lineVars: Record<string, number | undefined> = {}
      for (const [role, b] of m) lineVars[role] = b.status === 'ok' ? b.value : undefined
      const env: Env = { vars: lineVars, sum: () => undefined }
      const missing = (roles: string[]): Insufficiency | null => {
        for (const r of roles) { const b = m.get(r); if (b?.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable on line ${i}`, missing: [r] } }
        for (const r of roles) { const b = m.get(r); if (!b || b.status === 'missing') return { reason: 'FIELD_MISSING', detail: `${r} not present on line ${i}`, missing: [r] } }
        return null
      }
      const ev = (roles: string[]): Evidence[] => { const out: Evidence[] = []; for (const r of roles) { const e = fieldEvidence(r, m.get(r) ?? { status: 'missing', confidence: 0 }); if (e) out.push(e) } return out }
      runCheck(chk, env, `line[${i}]`, ev, missing)
    })
  })

  applyTolerancePolicy(claims, policy)

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
