/**
 * Lint a declarative ruleset BEFORE it runs. This is what makes a ruleset marketplace / user-authored rulesets safe: a
 * bad ruleset should be rejected with a clear reason, never silently produce garbage verdicts. Structural checks +
 * formula parsing (reusing the real evaluator) + role-reference validation + scope-mismatch and unused-role warnings.
 */

import { evalExprV040, operandRefs, referencedRoles, roleRefsV040, type OperandRef } from './expr.js'
import type { DeclarativeRuleset } from './types.js'
import { remedyDeclarationProblems } from '../verdict/remedy.js'
import { resolveLocale } from './unreadable.js'
import { resolveAlgorithm } from '../algorithms/index.js'
import { QC_SCHEMES, qcFlagKey } from '../schemes/index.js'

/*
 * Engine 0.4.0 (2026-10-04): lint reads the 0.4.0 grammar (expr.ts): sqrt(), median/min/max/count(R[, SET]), sum(R, SET),
 * prev(R), next(R), doc.R, and the keys `row_sets`, `algorithms`, `provenance_kinds`, plus the `neighbour` condition. A ruleset
 * that uses none of them lints exactly as before: its expressions parse to the same operands under both grammars. Lint describes
 * this build; a ruleset that uses a new form is read with it only by engine 0.4.0 (an earlier engine never sees the forms).
 */

export interface LintResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const VALID_KINDS = new Set(['amount', 'rate', 'quantity', 'string', 'bool', 'identifier', 'price'])
const VALID_OPS = new Set(['=', '<=', '>=', '!='])
const VALID_COMPARE = new Set(['number', 'identifier', 'member'])
/** Added 2026-09-24: guard conditions may also use strict < and >. */
const VALID_GUARD_OPS = new Set(['=', '!=', '<', '<=', '>', '>='])
const VALID_ROUNDING = new Set(['none', 'infer'])
/** Every operand occurrence, never throwing (a malformed expression is reported by parse(); this only feeds the reference checks). */
// An expression that does not parse still names the roles its tokens name, as lint always read them (the old token reading), so a
// broken expression's roles still count as used and lint's output for it is what it was.
const refsOf = (expr: unknown): OperandRef[] => {
  if (typeof expr !== 'string') return []
  try { return operandRefs(expr) } catch { /* fall back to the tokens */ }
  try { return referencedRoles(expr).map(r => ({ name: r, kind: 'role' as const, role: r, optional: false })) } catch { return [] }
}
/** The roles read directly (a role, or inside a one-argument sum), as referencedRoles always gave them. */
const safeRefs = (expr: unknown): string[] => [...new Set(refsOf(expr).filter(r => r.kind === 'role' || r.kind === 'sum').map(r => r.role))]
/** Every role an expression rests on, the new forms unwrapped. */
const allUnderlying = (expr: unknown): string[] => [...new Set(refsOf(expr).map(r => r.role))]
const FORM = (r: OperandRef): string => (r.kind === 'agg' ? `${r.fn}(${r.role}${r.set !== undefined ? `, ${r.set}` : ''})` : r.kind === 'doc' ? `doc.${r.role}` : `${r.kind}(${r.role})`)

export function lintRuleset(rs: unknown): LintResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (rs === null || typeof rs !== 'object') return { ok: false, errors: ['ruleset must be an object'], warnings }
  const R = rs as Partial<DeclarativeRuleset>

  if (typeof R.id !== 'string' || R.id.length === 0) errors.push('missing or empty "id"')
  if (typeof R.version !== 'string' || R.version.length === 0) errors.push('missing or empty "version"')
  const fieldsOk = R.fields !== null && typeof R.fields === 'object' && !Array.isArray(R.fields) && Object.keys(R.fields).length > 0
  if (!fieldsOk) errors.push('"fields" must be a non-empty object')
  if (!Array.isArray(R.checks) || R.checks.length === 0) errors.push('"checks" must be a non-empty array')
  if (errors.length > 0) return { ok: false, errors, warnings }

  const fields = R.fields as NonNullable<DeclarativeRuleset['fields']>
  const computed = R.computed ?? {}
  // 2026-10-03: list fields (`each`) and line-computed roles. A list field is reached only through sum(), like a line field.
  const lineComputedRaw = (R as { line_computed?: unknown }).line_computed
  const lineComputed: Record<string, string> = lineComputedRaw !== null && typeof lineComputedRaw === 'object' && !Array.isArray(lineComputedRaw) ? lineComputedRaw as Record<string, string> : {}
  const listRoles = new Set(Object.keys(fields).filter(k => fields[k]!.each !== undefined && !fields[k]!.line))
  const docRoles = new Set(Object.keys(fields).filter(k => !fields[k]!.line && !listRoles.has(k)))
  const lineRoles = new Set([...Object.keys(fields).filter(k => fields[k]!.line), ...Object.keys(lineComputed)])
  const computedRoles = new Set(Object.keys(computed))
  // 2026-10-04 (engine 0.4.0): roles computed by pinned algorithms, and named row sets (only read when present)
  const algorithmsRaw = (R as { algorithms?: unknown }).algorithms
  const algorithms: Record<string, unknown> = algorithmsRaw !== null && typeof algorithmsRaw === 'object' && !Array.isArray(algorithmsRaw) ? algorithmsRaw as Record<string, unknown> : {}
  const algoRoles = new Set(Object.keys(algorithms))
  const rowSetsRaw = (R as { row_sets?: unknown }).row_sets
  const rowSets: Record<string, unknown> = rowSetsRaw !== null && typeof rowSetsRaw === 'object' && !Array.isArray(rowSetsRaw) ? rowSetsRaw as Record<string, unknown> : {}
  // 2026-10-04 (engine 0.5.0): choice slots (only read when present). A slot id is a document role (a numeric value is read by it).
  const choicesRaw = (R as { choices?: unknown }).choices
  const slotList: Record<string, unknown>[] = Array.isArray(choicesRaw) ? choicesRaw.filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object' && !Array.isArray(s)) : []
  const slotIds = new Set(slotList.map(s => s.id).filter((x): x is string => typeof x === 'string' && x.length > 0))
  const slotOf = (id: string): Record<string, unknown> | undefined => slotList.find(s => s.id === id)
  const allRoles = new Set([...docRoles, ...lineRoles, ...computedRoles, ...listRoles, ...algoRoles, ...slotIds])
  const identifierRoles = new Set(Object.keys(fields).filter(k => fields[k]!.kind === 'identifier'))
  /** 0.4.0: line-computed roles that read a computed or algorithm role through doc. (or such a role): evaluated after the computed roles. */
  const lateRoles = new Set<string>()
  for (const [role, f] of Object.entries(lineComputed)) {
    if (refsOf(f).some(r => (r.kind === 'doc' && (computedRoles.has(r.role) || algoRoles.has(r.role))) || (r.kind !== 'doc' && r.kind !== 'agg' && lateRoles.has(r.role)))) lateRoles.add(role)
  }
  const noIdentifierArithmetic = (expr: unknown, where: string): void => {
    if (typeof expr !== 'string') return
    for (const ref of allUnderlying(expr)) if (identifierRoles.has(ref)) errors.push(`${where}: identifier field "${ref}" cannot be used in arithmetic (use a check with compare: "identifier")`)
  }

  // fields well-formed
  // 2026-10-03: absent vs unreadable (only checked when present, so a ruleset without these keys lints as before)
  const strictFlag = (R as { distinguish_unreadable?: unknown }).distinguish_unreadable
  if (strictFlag !== undefined && typeof strictFlag !== 'boolean') errors.push('"distinguish_unreadable" must be true or false')
  // 2026-10-03: strict number reading, on by default from engine 0.1.0; only checked when present
  const strictNumbers = (R as { strict_numbers?: unknown }).strict_numbers
  if (strictNumbers !== undefined && typeof strictNumbers !== 'boolean') errors.push('"strict_numbers" must be true or false')
  // T1 (2026-10-03): the extraction contract, opt-in; only checked when present
  const requireContract = (R as { require_contract?: unknown }).require_contract
  if (requireContract !== undefined && typeof requireContract !== 'boolean') errors.push('"require_contract" must be true or false')
  // 2026-10-03 (engine 0.2.0): HELD-SUSPECT and the declared number format; only checked when present
  const heldSuspect = (R as { held_suspect?: unknown }).held_suspect
  if (heldSuspect !== undefined && typeof heldSuspect !== 'boolean') errors.push('"held_suspect" must be true or false')
  const locale = (R as { locale?: unknown }).locale
  if (locale !== undefined && resolveLocale(locale) === null) errors.push('"locale" must be one of en, de, fr, ch, or { "decimal": "." | ",", "group": "," | "." | " " | "\'" | "" } with different marks')
  if (lineComputedRaw !== undefined && (lineComputedRaw === null || typeof lineComputedRaw !== 'object' || Array.isArray(lineComputedRaw))) errors.push('"line_computed" must be an object mapping each role to an expression')
  for (const [role, f] of Object.entries(fields)) {
    if (!Array.isArray(f.paths) || f.paths.length === 0) errors.push(`field "${role}": "paths" must be a non-empty array`)
    if (f.kind !== undefined && !VALID_KINDS.has(f.kind)) errors.push(`field "${role}": invalid kind "${f.kind}"`)
    if (f.labels !== undefined) {
      if (!Array.isArray(f.labels) || f.labels.length === 0 || f.labels.some(l => typeof l !== 'string' || l.trim() === '')) errors.push(`field "${role}": "labels" must be a non-empty array of non-empty strings`)
      else if (f.line) errors.push(`field "${role}": "labels" are read for document fields only (this is a line field)`)
      // 2026-10-03: labels are read unless the ruleset turns absent-vs-unreadable off (the engine 0.1.0 default is on)
      else if (strictFlag === false) warnings.push(`field "${role}": "labels" are not read: the ruleset sets "distinguish_unreadable": false`)
    }
    if (f.term !== undefined && (typeof f.term !== 'string' || f.term.trim() === '')) errors.push(`field "${role}": "term" must be a non-empty string`)
    if (f.each !== undefined) {
      if (!Array.isArray(f.each) || f.each.length === 0 || f.each.some(k => typeof k !== 'string' || k.trim() === '')) errors.push(`field "${role}": "each" must be a non-empty array of array paths`)
      if (f.line) errors.push(`field "${role}": a list field ("each") is a document field, not a line field`)
      if (f.labels !== undefined) errors.push(`field "${role}": "labels" are not read for a list field`)
      if (f.kind === 'identifier' || f.kind === 'string') errors.push(`field "${role}": a list field is summed, so its kind is a number kind`)
    }
  }
  for (const r of Object.keys(lineComputed)) if (fields[r] || computedRoles.has(r)) errors.push(`"${r}" is a line-computed role and a field or computed role: names must be unique`)
  for (const r of computedRoles) if (fields[r]) errors.push(`"${r}" is both a field and a computed role — names must be unique`)

  const usedRoles = new Set<string>()
  // a dummy env where every role resolves, to parse formulas
  const dummy = { vars: Object.fromEntries([...allRoles].map(r => [r, 1])), sum: (r: string) => (lineRoles.has(r) || listRoles.has(r) ? 1 : undefined), agg: () => 1, ref: () => 1 }
  const parse = (expr: string, where: string): void => {
    if (typeof expr !== 'string' || expr.trim() === '') { errors.push(`${where}: expression must be a non-empty string`); return }
    try { evalExprV040(expr, dummy) } catch (e) { errors.push(`${where}: ${(e as Error).message}`); return }
    for (const ref of roleRefsV040(expr).all) {
      const r = refsOf(expr).find(x => x.name === ref)
      if (!r || !allRoles.has(r.role)) errors.push(`${where}: references unknown role "${r ? r.role : ref}"`)
      else if (r.kind === 'agg' && r.set !== undefined && !Object.prototype.hasOwnProperty.call(rowSets, r.set)) errors.push(`${where}: ${FORM(r)} names the row set "${r.set}", which "row_sets" does not declare`)
    }
  }
  /**
   * 0.4.0: the new forms are read in their own places. `scope` says where the expression is read: a document check or computed
   * role ('document'), a row check ('line'), a line-computed role ('line_computed'), a row-set condition ('row_set').
   */
  const newForms = (expr: unknown, where: string, scope: 'document' | 'line' | 'line_computed' | 'row_set', lcBefore?: Set<string>): void => {
    for (const r of refsOf(expr)) {
      if (!allRoles.has(r.role)) continue // reported by parse()
      if (r.kind === 'agg') {
        if (scope !== 'document') { errors.push(`${where}: ${FORM(r)} is not available per row (an aggregate is document-scope; read it on a row through doc. and a computed role)`); continue }
        if (!lineRoles.has(r.role) && !listRoles.has(r.role)) errors.push(`${where}: ${FORM(r)} aggregates "${r.role}", which is not a line field, a line-computed role or a list field`)
        if (r.set !== undefined && listRoles.has(r.role)) errors.push(`${where}: ${FORM(r)}: a row set selects line rows; "${r.role}" is a list field`)
      } else if (r.kind === 'doc') {
        if (scope === 'document') errors.push(`${where}: ${FORM(r)} is read on a row; a document check reads "${r.role}" directly`)
        // (engine 0.5.0: a choice is readable as doc.ID too; a ruleset without choice slots keeps the 0.4.0 wording byte for byte)
        else if (!docRoles.has(r.role) && !computedRoles.has(r.role) && !algoRoles.has(r.role) && !slotIds.has(r.role)) errors.push(`${where}: ${FORM(r)}: "${r.role}" is not a document field, a computed role${slotIds.size ? ', an algorithm role or a choice' : ' or an algorithm role'}`)
        else if (scope === 'row_set' && !docRoles.has(r.role) && !slotIds.has(r.role)) errors.push(`${where}: ${FORM(r)}: a row-set condition reads document fields ${slotIds.size ? 'and choices ' : ''}only (computed and algorithm roles are evaluated after the row sets they may aggregate)`)
      } else if (r.kind === 'prev' || r.kind === 'next') {
        if (scope === 'document') errors.push(`${where}: ${FORM(r)} is read on a row, not at document scope`)
        else if (!lineRoles.has(r.role)) errors.push(`${where}: ${FORM(r)}: "${r.role}" is not a line field or a line-computed role`)
        else if (scope === 'line_computed' && Object.prototype.hasOwnProperty.call(lineComputed, r.role) && !lcBefore?.has(r.role)) errors.push(`${where}: ${FORM(r)} reads line-computed role "${r.role}" before it is defined (line-computed roles are evaluated in order, each over every row)`)
      }
      if (scope === 'row_set' && lateRoles.has(r.role)) errors.push(`${where}: "${r.role}" reads a computed or algorithm role through doc., so it is evaluated after the row sets; a row-set condition cannot read it`)
    }
  }

  // computed formulas
  for (const [role, formula] of Object.entries(computed)) {
    parse(formula, `computed "${role}"`); noIdentifierArithmetic(formula, `computed "${role}"`)
    // 0.4.0: a computed role is document-scope, and it is evaluated before the line-computed roles that read doc. values
    newForms(formula, `computed "${role}"`, 'document')
    for (const r of refsOf(formula)) if (lateRoles.has(r.role)) errors.push(`computed "${role}": reads line-computed role "${r.role}", which reads a computed or algorithm role through doc. and is evaluated after the computed roles`)
  }
  // line-computed formulas (2026-10-03): this line's fields and earlier line-computed roles only, no sum()
  const lcSeen = new Set<string>()
  for (const [role, formula] of Object.entries(lineComputed)) {
    const where = `line_computed "${role}"`
    parse(formula, where)
    noIdentifierArithmetic(formula, where)
    if (typeof formula === 'string') {
      if (/\bsum\s*\(/.test(formula)) errors.push(`${where}: sum() is not available per line`)
      for (const ref of safeRefs(formula)) {
        if (Object.prototype.hasOwnProperty.call(lineComputed, ref) && !lcSeen.has(ref)) errors.push(`${where}: uses line-computed role "${ref}" before it is defined`)
        else if (!lineRoles.has(ref) && allRoles.has(ref)) errors.push(`${where}: "${ref}" is not a line field (a line-computed role sees only its line)`)
      }
      newForms(formula, where, 'line_computed', lcSeen)
    }
    lcSeen.add(role)
  }

  // algorithms (2026-10-04, engine 0.4.0; only checked when present): registry refs, inputs mapped to line roles, the output
  if (algorithmsRaw !== undefined && (algorithmsRaw === null || typeof algorithmsRaw !== 'object' || Array.isArray(algorithmsRaw))) errors.push('"algorithms" must be an object mapping each role to { algorithm, inputs, output? }')
  for (const [role, spec] of Object.entries(algorithms)) {
    const where = `algorithms "${role}"`
    if (fields[role] || computedRoles.has(role) || Object.prototype.hasOwnProperty.call(lineComputed, role)) errors.push(`${where}: "${role}" is also a field, computed or line-computed role: names must be unique`)
    const s = spec as { algorithm?: unknown; inputs?: unknown; output?: unknown } | null
    if (!s || typeof s !== 'object') { errors.push(`${where}: must be { algorithm, inputs, output? }`); continue }
    const entry = resolveAlgorithm(s.algorithm)
    if (!entry) { errors.push(`${where}: "${String(s.algorithm)}" is not an algorithm this build carries (src/algorithms)`); continue }
    const inputs = s.inputs !== null && typeof s.inputs === 'object' && !Array.isArray(s.inputs) ? s.inputs as Record<string, unknown> : undefined
    if (!inputs) { errors.push(`${where}: "inputs" must map each of ${entry.inputs.map(i => i.name).join(', ')} to a line field or line-computed role`); continue }
    for (const inp of entry.inputs) {
      const r = inputs[inp.name]
      if (typeof r !== 'string') { errors.push(`${where}: input "${inp.name}" (${inp.what}) is not mapped`); continue }
      usedRoles.add(r)
      if (!lineRoles.has(r) && !listRoles.has(r)) errors.push(`${where}: input "${inp.name}" names "${r}", which is not a line field, a line-computed role or a list field`)
      else if (lateRoles.has(r)) errors.push(`${where}: input "${inp.name}" names "${r}", which reads a computed or algorithm role through doc. and is evaluated after the algorithms`)
      else if (identifierRoles.has(r) || fields[r]?.kind === 'string') errors.push(`${where}: input "${inp.name}" names "${r}", which is not a number field`)
    }
    for (const k of Object.keys(inputs)) if (!entry.inputs.some(i => i.name === k)) errors.push(`${where}: "${k}" is not an input of ${String(s.algorithm)} (its inputs are ${entry.inputs.map(i => i.name).join(', ')})`)
    if (s.output !== undefined && (typeof s.output !== 'string' || !entry.outputs.some(o => o.name === s.output))) errors.push(`${where}: "output" must be one of ${entry.outputs.map(o => o.name).join(', ')}`)
    // 2026-10-04 (engine 0.5.0): the algorithm choice this role computes for, and the parameters, each from a choice slot
    const sx = s as { choice?: unknown; params?: unknown }
    if (sx.choice !== undefined) {
      const slot = typeof sx.choice === 'string' ? slotOf(sx.choice) : undefined
      if (!slot) errors.push(`${where}: "choice" must name a choice slot (got ${JSON.stringify(sx.choice)})`)
      else if (slot.kind !== 'algorithm') errors.push(`${where}: "choice" names "${String(sx.choice)}", a ${String(slot.kind)} slot; an algorithm role is linked to an algorithm slot`)
      else {
        const d = slot.default as { value?: unknown } | undefined
        if (d && typeof d === 'object' && d.value !== undefined && d.value !== s.algorithm) errors.push(`${where}: the algorithm slot "${String(sx.choice)}" defaults to ${JSON.stringify(d.value)}, and this role computes with ${String(s.algorithm)}: the role would never have a value by default`)
      }
    }
    const params = sx.params !== null && typeof sx.params === 'object' && !Array.isArray(sx.params) ? sx.params as Record<string, unknown> : undefined
    if (sx.params !== undefined && !params) errors.push(`${where}: "params" must map each parameter of ${String(s.algorithm)} to a choice slot`)
    for (const p of entry.params ?? []) {
      const slotId = params?.[p.name]
      if (typeof slotId !== 'string') { errors.push(`${where}: ${String(s.algorithm)} takes its parameter "${p.name}" (${p.values.join(' | ')}) from a choice slot, and "params" names none`); continue }
      const slot = slotOf(slotId)
      if (!slot) { errors.push(`${where}: params.${p.name} names "${slotId}", which is not a choice slot`); continue }
      const d = slot.default as { value?: unknown } | undefined
      if (d && typeof d === 'object' && d.value !== undefined && (typeof d.value !== 'string' || !p.values.includes(d.value))) errors.push(`${where}: the slot "${slotId}" defaults to ${JSON.stringify(d.value)}; params.${p.name} takes ${p.values.join(' or ')}`)
    }
    for (const k of Object.keys(params ?? {})) if (!(entry.params ?? []).some(p => p.name === k)) errors.push(`${where}: "${k}" is not a parameter of ${String(s.algorithm)}${entry.params?.length ? ` (its parameters are ${entry.params.map(p => p.name).join(', ')})` : ' (it takes none)'}`)
  }

  // choice slots (2026-10-04, engine 0.5.0; only checked when present)
  const CHOICE_KINDS = new Set(['weights', 'flags', 'ratio', 'units', 'model_form', 'algorithm', 'tolerance', 'selection'])
  if (choicesRaw !== undefined && !Array.isArray(choicesRaw)) errors.push('"choices" must be an array of choice slots { id, kind, load_bearing, default?, not_applicable?, governs?, name? }')
  if (Array.isArray(choicesRaw)) {
    const seenIds = new Set<string>()
    const checkCodes = new Set((R.checks ?? []).map(c => c?.code).filter((x): x is string => typeof x === 'string'))
    choicesRaw.forEach((raw: unknown, i) => {
      const s = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
      const where = `choices[${i}]${typeof s.id === 'string' ? ` (${s.id})` : ''}`
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${where}: a choice slot is an object`); return }
      if (typeof s.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.id)) errors.push(`${where}: "id" is a plain name (letters, digits, _): it is a document role`)
      else if (seenIds.has(s.id)) errors.push(`${where}: duplicate id "${s.id}"`)
      else {
        seenIds.add(s.id)
        if (fields[s.id] || computedRoles.has(s.id) || Object.prototype.hasOwnProperty.call(lineComputed, s.id) || algoRoles.has(s.id) || Object.prototype.hasOwnProperty.call(rowSets, s.id)) errors.push(`${where}: "${s.id}" is also a field, computed, line-computed or algorithm role, or a row set: names must be unique`)
      }
      if (typeof s.kind !== 'string' || !CHOICE_KINDS.has(s.kind)) errors.push(`${where}: "kind" must be one of ${[...CHOICE_KINDS].join(', ')}`)
      if (typeof s.load_bearing !== 'boolean') errors.push(`${where}: "load_bearing" must be true or false`)
      if (s.name !== undefined && (typeof s.name !== 'string' || s.name.trim() === '')) errors.push(`${where}: "name" must be a non-empty string`)
      const na = s.not_applicable
      if (na !== undefined) {
        if (typeof na !== 'string' || na.trim() === '') errors.push(`${where}: "not_applicable" must be a non-empty string (why the choice does not apply)`)
        if (s.load_bearing === true) errors.push(`${where}: a choice declared not applicable is never load-bearing`)
        if (s.default !== undefined) errors.push(`${where}: a choice declared not applicable has no default`)
      }
      if (s.default !== undefined) {
        const d = s.default as Record<string, unknown> | null
        const v = d && typeof d === 'object' ? d.value : undefined
        const valueOk = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '') || (v !== null && typeof v === 'object' && !Array.isArray(v))
        if (!d || typeof d !== 'object' || Array.isArray(d) || !valueOk || typeof d.source !== 'string' || d.source.trim() === '') errors.push(`${where}: "default" must be { value: a number, a non-empty string or an object, source: a non-empty string naming where the value comes from }`)
        else if (s.kind === 'algorithm' && (typeof v !== 'string' || !resolveAlgorithm(v))) errors.push(`${where}: an algorithm slot's default names an algorithm this build carries (src/algorithms); got ${JSON.stringify(v)}`)
        else if (s.kind === 'flags') errors.push(...flagsPolicyProblems(v, `${where}.default.value`))
      }
      if (s.governs !== undefined) {
        if (!Array.isArray(s.governs) || s.governs.length === 0 || s.governs.some(x => typeof x !== 'string')) errors.push(`${where}: "governs" must be a non-empty array of check codes`)
        else for (const c of s.governs as string[]) if (!checkCodes.has(c)) errors.push(`${where}: "governs" names "${c}", which is not a check code`)
      }
    })
  }

  // support (2026-10-04, engine 0.5.0; only checked when present): { field, max_of } on a numeric check
  R.checks!.forEach((c, i) => {
    const sp = (c as { support?: unknown }).support
    if (sp === undefined) return
    const where = `check[${i}]${c.code ? ` (${c.code})` : ''}`
    const o = sp as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.field !== 'string' || typeof o.max_of !== 'string') { errors.push(`${where}: "support" must be { field: the point the model is evaluated at, max_of: the measured line field }`); return }
    if (c.compare === 'identifier' || c.compare === 'member') errors.push(`${where}: "support" applies to numeric checks only`)
    parse(o.field, `${where}.support.field`)
    for (const ref of allUnderlying(o.field)) usedRoles.add(ref)
    if (!lineRoles.has(o.max_of)) errors.push(`${where}: support.max_of "${o.max_of}" must be a line field or a line-computed role (the measured support)`)
    else usedRoles.add(o.max_of)
  })

  // provenance kinds (2026-10-04; only checked when present)
  const pk = (R as { provenance_kinds?: unknown }).provenance_kinds
  if (pk !== undefined && (!Array.isArray(pk) || pk.length === 0 || pk.some(k => k !== 'page' && k !== 'archive'))) errors.push('"provenance_kinds" must be a non-empty array of "page" and "archive"')

  // ruleset-level rounding mode (added 2026-09-24; only checked when present)
  const tolRounding = (R.tolerance as { rounding?: unknown } | undefined)?.rounding
  if (tolRounding !== undefined && !VALID_ROUNDING.has(tolRounding as string)) errors.push(`tolerance.rounding: invalid value "${String(tolRounding)}" (none | infer)`)

  // sources (added 2026-09-28; only checked when present): documentation, key → non-empty string
  const src = (R as { sources?: unknown }).sources
  if (src !== undefined && (src === null || typeof src !== 'object' || Array.isArray(src) || Object.values(src as object).some(v => typeof v !== 'string' || v.trim() === ''))) {
    errors.push('"sources" must be an object mapping each key to a non-empty string (a URL or a citation)')
  }

  // checks
  /** One numeric expression of a check (a side, an alternative's side, or a guard condition's side), with the scope rules. */
  const checkSide = (expr: string, where: string, err: string, scope: 'document' | 'line' | 'row_set'): void => {
    parse(expr, where)
    noIdentifierArithmetic(expr, where)
    if (typeof expr !== 'string') return
    // 0.4.0: an aggregate, doc., prev() and next() are checked in their places; the roles under them count as used
    newForms(expr, err, scope === 'document' ? 'document' : scope === 'row_set' ? 'row_set' : 'line')
    for (const ref of allUnderlying(expr)) usedRoles.add(ref)
    for (const ref of safeRefs(expr)) {
      usedRoles.add(ref)
      if (!allRoles.has(ref)) continue
      if (scope === 'line' || scope === 'row_set') {
        // a per-line check only sees that line's fields (not document fields, not computed roles, not sum()); 0.4.0: doc.R reads them
        if (docRoles.has(ref) || listRoles.has(ref)) errors.push(`${err}: line-scope check references document field "${ref}" (only line fields are visible per line)`)
        if (computedRoles.has(ref)) errors.push(`${err}: line-scope check references computed role "${ref}" (computed roles are document-scope)`)
        if (algoRoles.has(ref)) errors.push(`${err}: line-scope check references algorithm role "${ref}" directly (it is document-scope: read it as doc.${ref})`)
        if (slotIds.has(ref)) errors.push(`${err}: line-scope check references choice "${ref}" directly (a choice is document-scope: read it as doc.${ref})`)
        if (/\bsum\s*\(/.test(expr)) errors.push(`${err}: sum() is not available in a line-scope check`)
      } else {
        // a document-scope check can only reach a per-line field through sum(ROLE)
        if (lineRoles.has(ref) && !new RegExp(`\\bsum\\s*\\(\\s*${ref}\\s*\\)`).test(expr)) {
          errors.push(`${err}: document-scope check uses per-line field "${ref}" directly — wrap it as sum(${ref})`)
        }
        if (listRoles.has(ref) && !new RegExp(`\\bsum\\s*\\(\\s*${ref}\\s*\\)`).test(expr)) {
          errors.push(`${err}: document-scope check uses list field "${ref}" directly — wrap it as sum(${ref})`)
        }
      }
    }
  }
  /** applies_if (2026-10-03): numeric conditions as abstain_if; field conditions name an identifier/string field of this scope. */
  const lintApplicability = (conds: unknown, where: string, scope: 'document' | 'line' | 'row_set'): void => {
    const lineLike = scope !== 'document'
    const scopeWord = lineLike ? 'line' : 'document'
    if (!Array.isArray(conds) || conds.length === 0) { errors.push(`${where}: "applies_if" must be a non-empty array of conditions`); return }
    conds.forEach((g: unknown, j) => {
      const gw = `${where}.applies_if[${j}]`
      if (!g || typeof g !== 'object') { errors.push(`${gw}: must be { left, op, right } or { field, in | not_in }`); return }
      const o = g as Record<string, unknown>
      // 2026-10-04 (engine 0.4.0): { neighbour: 'prev' | 'next' }, row checks and row sets only
      if ('neighbour' in o) {
        if (o.neighbour !== 'prev' && o.neighbour !== 'next') errors.push(`${gw}: "neighbour" must be "prev" or "next"`)
        if (!lineLike) errors.push(`${gw}: a neighbour condition is read on a row; this condition is document-scope`)
        if (Object.keys(o).length !== 1) errors.push(`${gw}: a neighbour condition is { neighbour } alone`)
        return
      }
      // 2026-10-03 (T2): { any_present: [fields] }
      if ('any_present' in o) {
        const list = o.any_present
        if (!Array.isArray(list) || list.length === 0 || list.some(x => typeof x !== 'string')) { errors.push(`${gw}: "any_present" must be a non-empty array of field names`); return }
        for (const name of list as string[]) {
          usedRoles.add(name)
          const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
          if (!f) errors.push(`${gw}: "any_present" names "${name}", which is not a field`)
          else if (!!f.line !== lineLike) errors.push(`${gw}: "${name}" is a ${f.line ? 'line' : 'document'} field but the condition is ${scopeWord}-scope`)
        }
        return
      }
      if ('field' in o) {
        const name = typeof o.field === 'string' ? o.field : ''
        usedRoles.add(name)
        const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
        // 2026-10-03 (T2): { field, present: true }: any field of this scope
        if ('present' in o) {
          if (o.present !== true) errors.push(`${gw}: "present" must be true`)
          if ('in' in o || 'not_in' in o) errors.push(`${gw}: give exactly one of "in", "not_in" or "present"`)
          if (!f) errors.push(`${gw}: "field" must name a field (got "${name}")`)
          else if (!!f.line !== lineLike) errors.push(`${gw}: "${name}" is a ${f.line ? 'line' : 'document'} field but the condition is ${scopeWord}-scope`)
          return
        }
        if (!f || (f.kind !== 'identifier' && f.kind !== 'string')) errors.push(`${gw}: "field" must name an 'identifier' or 'string' field (got "${name}")`)
        else if (!!f.line !== lineLike) errors.push(`${gw}: "${name}" is a ${f.line ? 'line' : 'document'} field but the condition is ${scopeWord}-scope`)
        const hasIn = 'in' in o, hasNot = 'not_in' in o
        if (hasIn === hasNot) { errors.push(`${gw}: give exactly one of "in" or "not_in"`); return }
        const list = hasIn ? o.in : o.not_in
        if (!Array.isArray(list) || list.length === 0 || list.some(x => typeof x !== 'string' || x.trim() === '')) errors.push(`${gw}: "${hasIn ? 'in' : 'not_in'}" must be a non-empty array of non-empty strings`)
        return
      }
      if (!VALID_GUARD_OPS.has(o.op as string)) errors.push(`${gw}: invalid op "${String(o.op)}" (= != < <= > >=)`)
      if (o.tol !== undefined && !(typeof o.tol === 'number' && o.tol >= 0)) errors.push(`${gw}: "tol" must be a number >= 0`)
      for (const side of ['left', 'right'] as const) checkSide(o[side] as string, `${gw}."${side}"`, gw, scope)
    })
  }
  /** The 2026-09-24 check options: alternatives, guards, rounding. Silent for a check that uses none of them. */
  const checkNewOptions = (c: DeclarativeRuleset['checks'][number], where: string, scope: 'document' | 'line', isIdentifier: boolean): void => {
    // 2026-10-02: typed remedies (silent for a check that declares none): every kind known, every transform registered.
    if (c.remedy !== undefined) errors.push(...remedyDeclarationProblems(c.remedy, `${where}.remedy`))
    // 2026-10-03: exact tolerance, advisory, fail_if_unreadable (silent for a check that uses none of them)
    if (c.exact_tolerance !== undefined) {
      if (typeof c.exact_tolerance !== 'boolean') errors.push(`${where}: "exact_tolerance" must be true or false`)
      else if (isIdentifier && c.exact_tolerance) errors.push(`${where}: "exact_tolerance" applies to numeric checks only`)
      else if (c.exact_tolerance && c.rounding === 'infer') warnings.push(`${where}: "exact_tolerance" takes precedence; rounding inference is not applied`)
    }
    if (c.advisory !== undefined && typeof c.advisory !== 'boolean') errors.push(`${where}: "advisory" must be true or false`)
    else if (c.advisory === true) warnings.push(`${where}: advisory; the check never makes a claim (a failure is counsel on the verdict)`)
    if (c.fail_if_unreadable !== undefined) {
      const list = c.fail_if_unreadable as unknown
      if (isIdentifier) errors.push(`${where}: "fail_if_unreadable" applies to numeric checks only`)
      else if (!Array.isArray(list) || list.length === 0 || list.some(x => typeof x !== 'string')) errors.push(`${where}: "fail_if_unreadable" must be a non-empty array of role names`)
      else {
        const refs = new Set([...safeRefs(c.left), ...safeRefs(c.right), ...(Array.isArray(c.alternatives) ? c.alternatives.flatMap(a => [...safeRefs(a?.left), ...safeRefs(a?.right)]) : [])])
        for (const r of list as string[]) if (!refs.has(r)) errors.push(`${where}."fail_if_unreadable": "${r}" is not an operand of the check`)
      }
    }
    if (c.applies_if !== undefined) lintApplicability(c.applies_if, where, scope)
    // 2026-09-28: declared abstention + guard reason (silent for a check that uses neither)
    if (c.abstain !== undefined) {
      if (typeof c.abstain !== 'string' || c.abstain.trim() === '') errors.push(`${where}: "abstain" must be a non-empty string (the reason the check never decides)`)
      else warnings.push(`${where}: declared abstention; the check never decides (${c.abstain.length > 80 ? `${c.abstain.slice(0, 77)}...` : c.abstain})`)
    }
    if (c.guard_reason !== undefined) {
      if (typeof c.guard_reason !== 'string' || c.guard_reason.trim() === '') errors.push(`${where}: "guard_reason" must be a non-empty string`)
      else if (c.abstain_if_present === undefined && c.abstain_unless_all_present === undefined && c.abstain_if === undefined && c.abstain_if_present_without === undefined) warnings.push(`${where}: "guard_reason" is set but the check has no abstain guard`)
    }
    // E-INVOICE-2: abstain_if_present_without (silent for a check that does not use it)
    if (c.abstain_if_present_without !== undefined) {
      const list = c.abstain_if_present_without as unknown
      if (!Array.isArray(list) || list.length === 0 || list.some(g => !g || typeof g !== 'object' || typeof (g as { present?: unknown }).present !== 'string' || typeof (g as { without?: unknown }).without !== 'string')) {
        errors.push(`${where}: "abstain_if_present_without" must be a non-empty array of { present, without } role names`)
      } else for (const g of list as { present: string; without: string }[]) for (const r of [g.present, g.without]) {
        usedRoles.add(r)
        if (!allRoles.has(r)) errors.push(`${where}."abstain_if_present_without": unknown role "${r}"`)
        else if (scope === 'line' && !lineRoles.has(r)) errors.push(`${where}."abstain_if_present_without": a line-scope check can only name line fields ("${r}" is not one)`)
        else if (scope === 'document' && lineRoles.has(r)) errors.push(`${where}."abstain_if_present_without": a document-scope check cannot name the per-line field "${r}"`)
      }
    }
    if (c.rounding !== undefined) {
      if (isIdentifier) errors.push(`${where}: "rounding" applies to numeric checks only`)
      else if (!VALID_ROUNDING.has(c.rounding)) errors.push(`${where}: invalid rounding "${String(c.rounding)}" (none | infer)`)
    }
    if (c.alternatives !== undefined) {
      if (isIdentifier && c.compare === 'identifier') {
        // 2026-10-03 (T2): forms of two identifier fields, chosen by what is present ("A or B must be present")
        if (!Array.isArray(c.alternatives) || c.alternatives.length === 0) errors.push(`${where}: "alternatives" must be a non-empty array of { left, right }`)
        else c.alternatives.forEach((a, j) => {
          for (const side of ['left', 'right'] as const) {
            const name = a && typeof a[side] === 'string' ? a[side].trim() : ''
            usedRoles.add(name)
            const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
            if (!f || f.kind !== 'identifier') errors.push(`${where}.alternatives[${j}]."${side}": an identifier check must name an 'identifier' field (got "${name}")`)
            else if (!!f.line !== (scope === 'line')) errors.push(`${where}.alternatives[${j}]."${side}": "${name}" is a ${f.line ? 'line' : 'document'} field but the check is ${scope}-scope`)
          }
        })
      } else if (isIdentifier) errors.push(`${where}: "alternatives" apply to numeric and identifier checks only`)
      else if (!Array.isArray(c.alternatives) || c.alternatives.length === 0) errors.push(`${where}: "alternatives" must be a non-empty array of { left, right }`)
      else c.alternatives.forEach((a, j) => {
        const aw = `${where}.alternatives[${j}]`
        if (!a || typeof a !== 'object') { errors.push(`${aw}: must be an object { left, right }`); return }
        for (const side of ['left', 'right'] as const) checkSide(a[side], `${aw}."${side}"`, aw, scope)
      })
    }
    for (const key of ['abstain_unless_all_present', 'abstain_if_present'] as const) {
      const list = c[key] as unknown
      if (list === undefined) continue
      if (!Array.isArray(list) || list.length === 0 || list.some(x => typeof x !== 'string')) { errors.push(`${where}: "${key}" must be a non-empty array of role names`); continue }
      for (const r of list as string[]) {
        usedRoles.add(r)
        if (!allRoles.has(r)) errors.push(`${where}."${key}": unknown role "${r}"`)
        else if (scope === 'line' && !lineRoles.has(r)) errors.push(`${where}."${key}": a line-scope check can only name line fields ("${r}" is not one)`)
        // 2026-10-03 (engine 0.2.0): a document-scope guard may name a text line field (string / identifier): reported on any line
        else if (scope === 'document' && lineRoles.has(r) && !(key === 'abstain_if_present' && (fields[r]?.kind === 'string' || fields[r]?.kind === 'identifier'))) errors.push(`${where}."${key}": a document-scope check cannot name the per-line field "${r}"`)
      }
    }
    if (c.abstain_if !== undefined) {
      if (!Array.isArray(c.abstain_if) || c.abstain_if.length === 0) errors.push(`${where}: "abstain_if" must be a non-empty array of { left, op, right }`)
      else c.abstain_if.forEach((g, j) => {
        const gw = `${where}.abstain_if[${j}]`
        if (!g || typeof g !== 'object') { errors.push(`${gw}: must be an object { left, op, right }`); return }
        if (!VALID_GUARD_OPS.has(g.op)) errors.push(`${gw}: invalid op "${String(g.op)}" (= != < <= > >=)`)
        if (g.tol !== undefined && !(typeof g.tol === 'number' && g.tol >= 0)) errors.push(`${gw}: "tol" must be a number >= 0`)
        for (const side of ['left', 'right'] as const) checkSide(g[side], `${gw}."${side}"`, gw, scope)
      })
    }
    if (!isIdentifier) {
      // a form made only of optional terms decides whenever one of them is reported, and abstains otherwise — legal but unusual
      const forms = [{ left: c.left, right: c.right }, ...(Array.isArray(c.alternatives) ? c.alternatives : [])]
      forms.forEach((f, j) => {
        if (!f || typeof f.left !== 'string' || typeof f.right !== 'string') return
        try {
          const r = roleRefsV040(f.left, f.right)
          if (r.required.length === 0 && r.optional.length > 0) warnings.push(`${where}${j ? `.alternatives[${j - 1}]` : ''}: every operand is optional (${r.optional.join(', ')}); the form abstains when none of them is reported`)
        } catch { /* malformed expressions are reported by parse() */ }
      })
    }
  }
  /** 2026-10-03 (T2): a compiled check's documentation keys (silent when absent). */
  const checkDocKeys = (c: DeclarativeRuleset['checks'][number], where: string): void => {
    if (c.narrowing !== undefined && (!Array.isArray(c.narrowing) || c.narrowing.some(x => typeof x !== 'string' || x.trim() === ''))) errors.push(`${where}: "narrowing" must be an array of non-empty strings`)
    if (c.source !== undefined) {
      const s0 = c.source as unknown as Record<string, unknown> | null
      if (!s0 || typeof s0 !== 'object' || typeof s0.file !== 'string' || typeof s0.sha256 !== 'string' || typeof s0.line !== 'number' || typeof s0.assert_id !== 'string') errors.push(`${where}: "source" must be an object with file, sha256, line and assert_id`)
    }
    if (c.compiled_from !== undefined && (!c.compiled_from || typeof c.compiled_from !== 'object' || typeof c.compiled_from.compiler !== 'string')) errors.push(`${where}: "compiled_from" must be an object naming the compiler`)
    if (c.hand_edited !== undefined && typeof c.hand_edited !== 'boolean') errors.push(`${where}: "hand_edited" must be true or false`)
  }
  for (const [role, f] of Object.entries(fields)) if (f.term_key !== undefined && (typeof f.term_key !== 'string' || f.term_key.trim() === '')) errors.push(`field "${role}": "term_key" must be a non-empty string`)
  for (const [role, f] of Object.entries(fields)) if (f.hand_edited !== undefined && typeof f.hand_edited !== 'boolean') errors.push(`field "${role}": "hand_edited" must be true or false`)
  const cf = (R as { compiled_from?: unknown }).compiled_from as Record<string, unknown> | undefined
  if (cf !== undefined && (!cf || typeof cf !== 'object' || typeof cf.compiler !== 'string' || typeof cf.compiler_version !== 'string')) errors.push('"compiled_from" must be an object naming the compiler and its version')

  R.checks!.forEach((c, i) => {
    const where = `check[${i}]${c.code ? ` (${c.code})` : ''}`
    if (typeof c.code !== 'string' || c.code.length === 0) errors.push(`${where}: missing "code"`)
    if (!VALID_OPS.has(c.op)) errors.push(`${where}: invalid op "${c.op}"`)
    const scope = c.scope ?? 'document'
    if (c.compare !== undefined && !VALID_COMPARE.has(c.compare)) { errors.push(`${where}: invalid compare "${String(c.compare)}" (number | identifier)`); return }
    if (c.in !== undefined && c.compare !== 'member') errors.push(`${where}: "in" belongs to a compare: "member" check`)
    if (c.compare === 'member') {
      // 2026-10-03 (T2): one NAMED identifier or string field and the codes it may take; only = and !=
      if (c.op !== '=' && c.op !== '!=') errors.push(`${where}: a member check supports only = and !=`)
      const name = typeof c.left === 'string' ? c.left.trim() : ''
      usedRoles.add(name)
      const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
      if (!f || (f.kind !== 'identifier' && f.kind !== 'string')) errors.push(`${where}."left": a member check must name an 'identifier' or 'string' field (got "${name}")`)
      else if (!!f.line !== (scope === 'line')) errors.push(`${where}."left": "${name}" is a ${f.line ? 'line' : 'document'} field but the check is ${scope}-scope`)
      if (!Array.isArray(c.in) || c.in.length === 0 || c.in.some(x => typeof x !== 'string' || x.trim() === '')) errors.push(`${where}: "in" must be a non-empty array of non-empty codes`)
      if (typeof c.right !== 'string') errors.push(`${where}: "right" must be a string (it documents the list)`)
      if (c.alternatives !== undefined) errors.push(`${where}: "alternatives" do not apply to a member check`)
      checkNewOptions({ ...c, alternatives: undefined }, where, scope, true)
      checkDocKeys(c, where)
      return
    }
    if (c.compare === 'identifier') {
      // two NAMED identifier fields visible in this scope; only = and !=
      if (c.op !== '=' && c.op !== '!=') errors.push(`${where}: an identifier check supports only = and !=`)
      for (const side of ['left', 'right'] as const) {
        const name = typeof c[side] === 'string' ? c[side].trim() : ''
        usedRoles.add(name)
        const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
        if (!f || f.kind !== 'identifier') errors.push(`${where}."${side}": an identifier check must name an 'identifier' field (got "${name}")`)
        else if (!!f.line !== (scope === 'line')) errors.push(`${where}."${side}": "${name}" is a ${f.line ? 'line' : 'document'} field but the check is ${scope}-scope`)
      }
      checkNewOptions(c, where, scope, true)
      checkDocKeys(c, where)
      return
    }
    for (const side of ['left', 'right'] as const) checkSide(c[side], `${where}."${side}"`, where, scope)
    checkNewOptions(c, where, scope, false)
    checkDocKeys(c, where)
  })

  // row sets (2026-10-04, engine 0.4.0; only checked when present): name → conditions, read on each row
  if (rowSetsRaw !== undefined && (rowSetsRaw === null || typeof rowSetsRaw !== 'object' || Array.isArray(rowSetsRaw))) errors.push('"row_sets" must be an object mapping each name to a non-empty array of conditions')
  for (const [name, conds] of Object.entries(rowSets)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) errors.push(`row_sets "${name}": a row set name is a plain name (letters, digits, _)`)
    if (allRoles.has(name)) errors.push(`row_sets "${name}": "${name}" is also a role: names must be unique`)
    lintApplicability(conds, `row_sets "${name}"`, 'row_set')
  }

  // quotes (2026-10-03): passages the source text must contain verbatim
  const quotes = (R as { quotes?: unknown }).quotes
  if (quotes !== undefined) {
    if (!Array.isArray(quotes) || quotes.length === 0) errors.push('"quotes" must be a non-empty array of { id, quote, label?, applies_if?, remedy? }')
    else {
      const seen = new Set<string>()
      quotes.forEach((q: unknown, i) => {
        const o = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>
        const where = `quotes[${i}]${typeof o.id === 'string' ? ` (${o.id})` : ''}`
        if (typeof o.id !== 'string' || o.id.trim() === '') errors.push(`${where}: missing "id"`)
        else if (seen.has(o.id)) errors.push(`${where}: duplicate id "${o.id}"`)
        else seen.add(o.id)
        if (typeof o.quote !== 'string' || o.quote.trim() === '') errors.push(`${where}: "quote" must be a non-empty string`)
        if (o.label !== undefined && typeof o.label !== 'string') errors.push(`${where}: "label" must be a string`)
        if (o.applies_if !== undefined) lintApplicability(o.applies_if, where, 'document')
        if (o.remedy !== undefined) errors.push(...remedyDeclarationProblems(o.remedy as never, `${where}.remedy`))
      })
    }
  }

  // unused roles → warning (defined but no check or computed uses them)
  const referencedByComputed = new Set<string>()
  for (const formula of Object.values(computed)) for (const r of allUnderlying(formula)) referencedByComputed.add(r)
  for (const formula of Object.values(lineComputed)) for (const r of allUnderlying(formula)) referencedByComputed.add(r)
  for (const r of allRoles) if (!slotIds.has(r) && !usedRoles.has(r) && !referencedByComputed.has(r)) warnings.push(`role "${r}" is defined but never used in a check`)

  // choice slots (engine 0.5.0): a slot a check depends on is load-bearing; a slot read in arithmetic has a number for a default
  if (slotList.length) {
    const memo = new Map<string, Set<string>>()
    const rolesOf = (role: string, seen: Set<string>): Set<string> => {
      const hit = memo.get(role)
      if (hit) return hit
      const out = new Set<string>([role])
      if (seen.has(role)) return out
      seen.add(role)
      const f = computed[role] ?? lineComputed[role]
      if (typeof f === 'string') for (const r of allUnderlying(f)) for (const x of rolesOf(r, seen)) out.add(x)
      const a = algorithms[role] as { inputs?: unknown; choice?: unknown; params?: unknown } | undefined
      if (a && typeof a === 'object') {
        for (const r of Object.values(a.inputs && typeof a.inputs === 'object' ? a.inputs as Record<string, unknown> : {})) if (typeof r === 'string') for (const x of rolesOf(r, seen)) out.add(x)
        if (typeof a.choice === 'string') out.add(a.choice)
        for (const p of Object.values(a.params && typeof a.params === 'object' ? a.params as Record<string, unknown> : {})) if (typeof p === 'string') out.add(p)
      }
      memo.set(role, out)
      return out
    }
    const exprsOf = (c: DeclarativeRuleset['checks'][number]): string[] => [
      c.left, c.right, ...(Array.isArray(c.alternatives) ? c.alternatives.flatMap(a => [a?.left, a?.right]) : []),
      ...(Array.isArray(c.abstain_if) ? c.abstain_if.flatMap(g => [g?.left, g?.right]) : []),
      ...(Array.isArray(c.applies_if) ? c.applies_if.flatMap(g => (g && typeof g === 'object' && 'left' in g ? [(g as { left: string }).left, (g as { right: string }).right] : [])) : []),
      ...(c.support && typeof c.support === 'object' ? [c.support.field, c.support.max_of] : []),
    ].filter((e): e is string => typeof e === 'string')
    const dependedOn = new Map<string, string[]>()
    const readInArithmetic = new Set<string>()
    for (const c of R.checks ?? []) {
      const deps = new Set<string>()
      for (const e of exprsOf(c)) for (const ref of refsOf(e)) {
        for (const x of rolesOf(ref.role, new Set())) deps.add(x)
        if (ref.kind === 'agg' && ref.set !== undefined) for (const g of Array.isArray(rowSets[ref.set]) ? rowSets[ref.set] as unknown[] : []) if (g && typeof g === 'object' && 'left' in g) for (const e2 of [(g as unknown as { left: string }).left, (g as unknown as { right: string }).right]) for (const r2 of allUnderlying(e2)) for (const x of rolesOf(r2, new Set())) deps.add(x)
      }
      for (const s of slotList) if (Array.isArray(s.governs) && s.governs.includes(c.code) && typeof s.id === 'string') deps.add(s.id)
      for (const d of deps) if (slotIds.has(d)) dependedOn.set(d, [...(dependedOn.get(d) ?? []), c.code])
    }
    for (const f of [...Object.values(computed), ...Object.values(lineComputed), ...(R.checks ?? []).flatMap(exprsOf)]) for (const r of allUnderlying(f)) if (slotIds.has(r)) readInArithmetic.add(r)
    for (const s of slotList) {
      if (typeof s.id !== 'string') continue
      const codes = dependedOn.get(s.id) ?? []
      if (codes.length && s.load_bearing === false) errors.push(`choice "${s.id}": the checks ${[...new Set(codes)].join(', ')} depend on it, so it is load-bearing (declare "load_bearing": true)`)
      if (codes.length && s.not_applicable !== undefined) errors.push(`choice "${s.id}": declared not applicable, and the checks ${[...new Set(codes)].join(', ')} depend on it`)
      if (!codes.length && s.load_bearing === true) warnings.push(`choice "${s.id}": declared load-bearing, and no check depends on it (name the checks it governs with "governs")`)
      // the gate, seen from the ruleset: with no default, a document that does not state the slot leaves its checks abstaining
      if (codes.length && s.load_bearing === true && s.default === undefined && s.not_applicable === undefined) warnings.push(`choice "${s.id}": load-bearing with no default: a document that does not state it, with no value from the judge, leaves ${[...new Set(codes)].join(', ')} abstaining (choice_unstated)`)
      const d = s.default as { value?: unknown } | undefined
      if (readInArithmetic.has(s.id) && d && typeof d === 'object' && d.value !== undefined && typeof d.value !== 'number') errors.push(`choice "${s.id}": an expression reads it, and its default is ${JSON.stringify(d.value)}, not a number`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Problems with a flags policy (engine 0.5.0): { scheme, compute?, hold?, strike?, absent? }, each flag the scheme defines, in one bucket. */
export function flagsPolicyProblems(v: unknown, where: string): string[] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${where}: a flags policy is { scheme, compute, hold, strike, absent }`]
  const p = v as Record<string, unknown>
  const out: string[] = []
  const scheme = typeof p.scheme === 'string' ? QC_SCHEMES[p.scheme] : undefined
  if (!scheme) out.push(`${where}: "scheme" must name a scheme this build carries (${Object.keys(QC_SCHEMES).join(', ')})`)
  const seen = new Map<string, string>()
  for (const k of Object.keys(p)) if (!['scheme', 'compute', 'hold', 'strike', 'absent'].includes(k)) out.push(`${where}: unknown key "${k}" (a flags policy has scheme, compute, hold, strike, absent)`)
  for (const k of ['compute', 'hold', 'strike', 'absent'] as const) {
    if (p[k] === undefined) continue
    if (!Array.isArray(p[k])) { out.push(`${where}.${k}: a list of flags`); continue }
    for (const f of p[k] as unknown[]) {
      const key = qcFlagKey(f)
      if (key === undefined || (scheme && !Object.prototype.hasOwnProperty.call(scheme.flags, key))) out.push(`${where}.${k}: ${JSON.stringify(f)} is not a flag the ${String(p.scheme)} scheme defines`)
      else if (seen.has(key) && seen.get(key) !== k) out.push(`${where}: flag ${JSON.stringify(key)} is in both ${seen.get(key)} and ${k}`)
      else seen.set(key, k)
    }
  }
  return out
}
