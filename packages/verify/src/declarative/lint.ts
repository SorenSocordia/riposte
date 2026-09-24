/**
 * Lint a declarative ruleset BEFORE it runs. This is what makes a ruleset marketplace / user-authored rulesets safe: a
 * bad ruleset should be rejected with a clear reason, never silently produce garbage verdicts. Structural checks +
 * formula parsing (reusing the real evaluator) + role-reference validation + scope-mismatch and unused-role warnings.
 */

import { evalExpr, referencedRoles, roleRefs } from './expr.js'
import type { DeclarativeRuleset } from './types.js'

export interface LintResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const VALID_KINDS = new Set(['amount', 'rate', 'quantity', 'string', 'bool', 'identifier'])
const VALID_OPS = new Set(['=', '<=', '>=', '!='])
const VALID_COMPARE = new Set(['number', 'identifier'])
/** Added 2026-09-24: guard conditions may also use strict < and >. */
const VALID_GUARD_OPS = new Set(['=', '!=', '<', '<=', '>', '>='])
const VALID_ROUNDING = new Set(['none', 'infer'])
/** referencedRoles that never throws (a malformed expression is reported by parse(); this only feeds the reference checks). */
const safeRefs = (expr: unknown): string[] => { if (typeof expr !== 'string') return []; try { return referencedRoles(expr) } catch { return [] } }

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
  const docRoles = new Set(Object.keys(fields).filter(k => !fields[k]!.line))
  const lineRoles = new Set(Object.keys(fields).filter(k => fields[k]!.line))
  const computedRoles = new Set(Object.keys(computed))
  const allRoles = new Set([...docRoles, ...lineRoles, ...computedRoles])
  const identifierRoles = new Set(Object.keys(fields).filter(k => fields[k]!.kind === 'identifier'))
  const noIdentifierArithmetic = (expr: unknown, where: string): void => {
    if (typeof expr !== 'string') return
    try { for (const ref of referencedRoles(expr)) if (identifierRoles.has(ref)) errors.push(`${where}: identifier field "${ref}" cannot be used in arithmetic (use a check with compare: "identifier")`) } catch { /* parse errors are reported by parse() */ }
  }

  // fields well-formed
  for (const [role, f] of Object.entries(fields)) {
    if (!Array.isArray(f.paths) || f.paths.length === 0) errors.push(`field "${role}": "paths" must be a non-empty array`)
    if (f.kind !== undefined && !VALID_KINDS.has(f.kind)) errors.push(`field "${role}": invalid kind "${f.kind}"`)
  }
  for (const r of computedRoles) if (fields[r]) errors.push(`"${r}" is both a field and a computed role — names must be unique`)

  // a dummy env where every role resolves, to parse formulas
  const dummy = { vars: Object.fromEntries([...allRoles].map(r => [r, 1])), sum: (r: string) => (lineRoles.has(r) ? 1 : undefined) }
  const parse = (expr: string, where: string): void => {
    if (typeof expr !== 'string' || expr.trim() === '') { errors.push(`${where}: expression must be a non-empty string`); return }
    try { evalExpr(expr, dummy) } catch (e) { errors.push(`${where}: ${(e as Error).message}`); return }
    for (const ref of referencedRoles(expr)) if (!allRoles.has(ref)) errors.push(`${where}: references unknown role "${ref}"`)
  }

  // computed formulas
  for (const [role, formula] of Object.entries(computed)) { parse(formula, `computed "${role}"`); noIdentifierArithmetic(formula, `computed "${role}"`) }

  // ruleset-level rounding mode (added 2026-09-24; only checked when present)
  const tolRounding = (R.tolerance as { rounding?: unknown } | undefined)?.rounding
  if (tolRounding !== undefined && !VALID_ROUNDING.has(tolRounding as string)) errors.push(`tolerance.rounding: invalid value "${String(tolRounding)}" (none | infer)`)

  // checks
  const usedRoles = new Set<string>()
  /** One numeric expression of a check (a side, an alternative's side, or a guard condition's side), with the scope rules. */
  const checkSide = (expr: string, where: string, err: string, scope: 'document' | 'line'): void => {
    parse(expr, where)
    noIdentifierArithmetic(expr, where)
    if (typeof expr !== 'string') return
    for (const ref of safeRefs(expr)) {
      usedRoles.add(ref)
      if (!allRoles.has(ref)) continue
      if (scope === 'line') {
        // a per-line check only sees that line's fields (not document fields, not computed roles, not sum())
        if (docRoles.has(ref)) errors.push(`${err}: line-scope check references document field "${ref}" (only line fields are visible per line)`)
        if (computedRoles.has(ref)) errors.push(`${err}: line-scope check references computed role "${ref}" (computed roles are document-scope)`)
        if (/\bsum\s*\(/.test(expr)) errors.push(`${err}: sum() is not available in a line-scope check`)
      } else {
        // a document-scope check can only reach a per-line field through sum(ROLE)
        if (lineRoles.has(ref) && !new RegExp(`\\bsum\\s*\\(\\s*${ref}\\s*\\)`).test(expr)) {
          errors.push(`${err}: document-scope check uses per-line field "${ref}" directly — wrap it as sum(${ref})`)
        }
      }
    }
  }
  /** The 2026-09-24 check options: alternatives, guards, rounding. Silent for a check that uses none of them. */
  const checkNewOptions = (c: DeclarativeRuleset['checks'][number], where: string, scope: 'document' | 'line', isIdentifier: boolean): void => {
    if (c.rounding !== undefined) {
      if (isIdentifier) errors.push(`${where}: "rounding" applies to numeric checks only`)
      else if (!VALID_ROUNDING.has(c.rounding)) errors.push(`${where}: invalid rounding "${String(c.rounding)}" (none | infer)`)
    }
    if (c.alternatives !== undefined) {
      if (isIdentifier) errors.push(`${where}: "alternatives" apply to numeric checks only`)
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
        else if (scope === 'document' && lineRoles.has(r)) errors.push(`${where}."${key}": a document-scope check cannot name the per-line field "${r}"`)
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
          const r = roleRefs(f.left, f.right)
          if (r.required.length === 0 && r.optional.length > 0) warnings.push(`${where}${j ? `.alternatives[${j - 1}]` : ''}: every operand is optional (${r.optional.join(', ')}); the form abstains when none of them is reported`)
        } catch { /* malformed expressions are reported by parse() */ }
      })
    }
  }
  R.checks!.forEach((c, i) => {
    const where = `check[${i}]${c.code ? ` (${c.code})` : ''}`
    if (typeof c.code !== 'string' || c.code.length === 0) errors.push(`${where}: missing "code"`)
    if (!VALID_OPS.has(c.op)) errors.push(`${where}: invalid op "${c.op}"`)
    const scope = c.scope ?? 'document'
    if (c.compare !== undefined && !VALID_COMPARE.has(c.compare)) { errors.push(`${where}: invalid compare "${String(c.compare)}" (number | identifier)`); return }
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
      return
    }
    for (const side of ['left', 'right'] as const) checkSide(c[side], `${where}."${side}"`, where, scope)
    checkNewOptions(c, where, scope, false)
  })

  // unused roles → warning (defined but no check or computed uses them)
  const referencedByComputed = new Set<string>()
  for (const formula of Object.values(computed)) for (const r of safeRefs(formula)) referencedByComputed.add(r)
  for (const r of allRoles) if (!usedRoles.has(r) && !referencedByComputed.has(r)) warnings.push(`role "${r}" is defined but never used in a check`)

  return { ok: errors.length === 0, errors, warnings }
}
