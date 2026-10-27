/**
 * `verify compile-ruleset --diff <compiled> <edited>` (2026-10-03): mark what a person changed after compiling.
 *
 * A compiled ruleset is a skeleton; a reviewer may change a check (a tolerance, a guard, a remedy), add one, delete one,
 * or change a field (its paths, labels, kind). This marks every changed or added check and field `hand_edited: true` in
 * the edited ruleset and lists every edit, deletions included, in `compiled_from.hand_edits`, so a compiled check is never
 * mistaken for a hand-edited one and a hand edit is never mistaken for the standard. The comparison ignores the markers it
 * writes, so running it again on its own output gives the same output.
 */

import type { DeclarativeRuleset } from '../declarative/types.js'
import { canonicalize, hashOf } from '../verdict/canonical.js'

export interface HandEdit { kind: 'check' | 'field' | 'ruleset'; id: string; change: 'changed' | 'added' | 'removed'; keys?: string[] }

const strip = (x: unknown): Record<string, unknown> => {
  const { hand_edited: _h, ...rest } = (x ?? {}) as Record<string, unknown>
  return rest
}
const changedKeys = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => canonicalize(a[k]) !== canonicalize(b[k])).sort()

/** The edited ruleset with every hand edit marked, and the list of edits. `compiled` must be the compiler's own output. */
export function markHandEdits(compiled: DeclarativeRuleset, edited: DeclarativeRuleset): { ruleset: DeclarativeRuleset; edits: HandEdit[] } {
  const edits: HandEdit[] = []
  const cChecks = new Map(compiled.checks.map(c => [c.code, c]))
  const eCodes = new Set(edited.checks.map(c => c.code))
  const checks = edited.checks.map(c => {
    const orig = cChecks.get(c.code)
    const e = strip(c)
    if (!orig) { edits.push({ kind: 'check', id: c.code, change: 'added' }); return { ...e, hand_edited: true } }
    const keys = changedKeys(strip(orig), e)
    if (keys.length) { edits.push({ kind: 'check', id: c.code, change: 'changed', keys }); return { ...e, hand_edited: true } }
    return e
  })
  for (const c of compiled.checks) if (!eCodes.has(c.code)) edits.push({ kind: 'check', id: c.code, change: 'removed' })
  const fields: Record<string, unknown> = {}
  for (const [role, f] of Object.entries(edited.fields)) {
    const orig = compiled.fields[role]
    const e = strip(f)
    if (!orig) { edits.push({ kind: 'field', id: role, change: 'added' }); fields[role] = { ...e, hand_edited: true }; continue }
    const keys = changedKeys(strip(orig), e)
    if (keys.length) { edits.push({ kind: 'field', id: role, change: 'changed', keys }); fields[role] = { ...e, hand_edited: true } } else fields[role] = e
  }
  for (const role of Object.keys(compiled.fields)) if (!(role in edited.fields)) edits.push({ kind: 'field', id: role, change: 'removed' })
  // ruleset-level keys other than fields, checks and the compiler's own record
  const top = (r: DeclarativeRuleset): Record<string, unknown> => { const { fields: _f, checks: _c, compiled_from: _cf, ...rest } = r as unknown as Record<string, unknown>; return rest }
  for (const k of changedKeys(top(compiled), top(edited))) edits.push({ kind: 'ruleset', id: k, change: k in (edited as object) ? (k in (compiled as object) ? 'changed' : 'added') : 'removed' })
  const cf = (edited.compiled_from ?? compiled.compiled_from ?? { compiler: 'unknown', compiler_version: 'unknown' }) as Record<string, unknown>
  const ruleset = {
    ...(edited as unknown as Record<string, unknown>),
    fields, checks,
    compiled_from: { ...cf, hand_edits: edits, hand_edited_from: hashOf(compiled) },
  } as unknown as DeclarativeRuleset
  return { ruleset, edits }
}
