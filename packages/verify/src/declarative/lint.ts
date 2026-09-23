/**
 * Lint a declarative ruleset BEFORE it runs. This is what makes a ruleset marketplace / user-authored rulesets safe: a
 * bad ruleset should be rejected with a clear reason, never silently produce garbage verdicts. Structural checks +
 * formula parsing (reusing the real evaluator) + role-reference validation + scope-mismatch and unused-role warnings.
 */

import { evalExpr, referencedRoles } from './expr.js'
import type { DeclarativeRuleset } from './types.js'

export interface LintResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const VALID_KINDS = new Set(['amount', 'rate', 'quantity', 'string'])
const VALID_OPS = new Set(['=', '<=', '>=', '!='])

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
  for (const [role, formula] of Object.entries(computed)) parse(formula, `computed "${role}"`)

  // checks
  const usedRoles = new Set<string>()
  R.checks!.forEach((c, i) => {
    const where = `check[${i}]${c.code ? ` (${c.code})` : ''}`
    if (typeof c.code !== 'string' || c.code.length === 0) errors.push(`${where}: missing "code"`)
    if (!VALID_OPS.has(c.op)) errors.push(`${where}: invalid op "${c.op}"`)
    const scope = c.scope ?? 'document'
    for (const side of ['left', 'right'] as const) {
      const expr = c[side]
      parse(expr, `${where}."${side}"`)
      if (typeof expr !== 'string') continue
      for (const ref of referencedRoles(expr)) {
        usedRoles.add(ref)
        if (!allRoles.has(ref)) continue
        if (scope === 'line') {
          // a per-line check only sees that line's fields (not document fields, not computed roles, not sum())
          if (docRoles.has(ref)) errors.push(`${where}: line-scope check references document field "${ref}" (only line fields are visible per line)`)
          if (computedRoles.has(ref)) errors.push(`${where}: line-scope check references computed role "${ref}" (computed roles are document-scope)`)
          if (/\bsum\s*\(/.test(expr)) errors.push(`${where}: sum() is not available in a line-scope check`)
        } else {
          // a document-scope check can only reach a per-line field through sum(ROLE)
          if (lineRoles.has(ref) && !new RegExp(`\\bsum\\s*\\(\\s*${ref}\\s*\\)`).test(expr)) {
            errors.push(`${where}: document-scope check uses per-line field "${ref}" directly — wrap it as sum(${ref})`)
          }
        }
      }
    }
  })

  // unused roles → warning (defined but no check or computed uses them)
  const referencedByComputed = new Set<string>()
  for (const formula of Object.values(computed)) for (const r of referencedRoles(formula)) referencedByComputed.add(r)
  for (const r of allRoles) if (!usedRoles.has(r) && !referencedByComputed.has(r)) warnings.push(`role "${r}" is defined but never used in a check`)

  return { ok: errors.length === 0, errors, warnings }
}
