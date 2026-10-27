/**
 * Compare a compiled ruleset with a hand-written one, check by check (2026-10-03, the standards compiler's recompile test).
 *
 * A hand check is matched to the compiled checks of the same schematron assert (the id its name starts with, e.g.
 * "BR-CO-10: …"). It is REPRODUCED when a compiled check has the same check kind, operator and scope, the same operand
 * polynomial over business terms (whatever the roles are called or the terms' order), the same tolerance and exactness,
 * the same reading of every operand (precision, and what an absent one counts as), and the same guards. Anything else is
 * listed as a difference with an explanation drawn from what the compiler recorded (its narrowings) and from what the hand
 * check does. Remedy text, check names and extraction paths are noted but never count as operand differences.
 */

import type { DeclarativeRuleset, DeclCheck, DeclField } from '../declarative/types.js'
import * as P from './normal.js'

export interface Difference { aspect: string; hand: string; compiled: string; explanation: string }
export interface CheckComparison {
  hand_code: string
  hand_name: string
  assert_id?: string
  compiled_codes: string[]
  verdict: 'reproduced' | 'differs' | 'no-counterpart'
  differences: Difference[]
  notes: string[]
}
export interface Comparison {
  hand: string
  compiled: string
  checks: CheckComparison[]
  summary: { hand_checks: number; reproduced: number; differs: number; no_counterpart: number; unexplained: number }
}

/** The business-term key a field stands for: the compiled field's term_key, else read off the hand field's `term`. */
export function termKeyOf(role: string, f: DeclField | undefined): string {
  if (!f) return role
  if (f.term_key) return f.term_key
  const t = f.term ?? ''
  if (/currencyID/i.test(t) && /totals/i.test(t)) return '@currencyID(the totals, one value)'
  const pos = /^(BT-\d+)\b.*\brow (\d+)\b/.exec(t)
  if (pos) return `${pos[1]}#row${pos[2]}`
  const sum = /^Σ\s*(BT-\d+)/.exec(t)
  if (sum) return `sum:${sum[1]}`
  const bt = /^(BT-\d+)/.exec(t)
  if (bt) return bt[1]!
  if (f.line && f.kind === 'string') return 'items:line-allowance-charge'
  return role
}
/** A hand field for a line's item list (no term) and a compiled items field mean the same guard. */
const normKey = (k: string): string => (k.startsWith('items:') ? 'items:line-allowance-charge' : k)

interface Operand { role: string; key: string; kind: string; absent: string }
function operandsOf(rs: DeclarativeRuleset, c: DeclCheck): Operand[] {
  const roles = [...new Set([c.left, c.right, ...(c.alternatives ?? []).flatMap(a => [a.left, a.right])].join(' ').match(/[A-Za-z_][A-Za-z0-9_]*\??/g) ?? [])]
  const out: Operand[] = []
  for (const tok of roles) {
    const role = tok.replace(/\?$/, '')
    if (role === 'sum' || role === 'abs' || !Object.prototype.hasOwnProperty.call(rs.fields, role)) continue
    const f = rs.fields[role]!
    const optional = new RegExp(`\\b${role}\\?`).test(`${c.left} ${c.right}`)
    out.push({ role, key: normKey(termKeyOf(role, f)), kind: f.kind ?? 'amount', absent: f.default !== undefined ? `counted as ${f.default}` : optional ? 'counted as 0 (optional term)' : 'abstains' })
  }
  return out
}
const absentReading = (a: string): string => (a.startsWith('counted as 0') ? 'counted as 0' : a)

function polyOf(rs: DeclarativeRuleset, c: DeclCheck): P.Poly | undefined {
  if (c.compare === 'identifier' || c.compare === 'member') return undefined
  const atom = (role: string): string => normKey(termKeyOf(role, rs.fields[role]))
  const l = P.polyOfExpr(c.left, atom), r = P.polyOfExpr(c.right, atom)
  return l && r ? P.add(l, r, -1) : undefined
}
const keysOf = (rs: DeclarativeRuleset, roles: string[] | undefined): string[] => (roles ?? []).map(r => normKey(termKeyOf(r, rs.fields[r]))).sort()
const assertIdOf = (c: DeclCheck): string | undefined => c.source?.assert_id ?? /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*[:[]/.exec(c.name ?? '')?.[1]
const show = (x: unknown): string => (x === undefined ? '—' : typeof x === 'string' ? x : JSON.stringify(x))

/** Compare every check of `hand` with the compiled checks of the same assert. */
export function compareWithHand(compiled: DeclarativeRuleset, hand: DeclarativeRuleset, report?: { entries: { assert_id: string; class: string; uncompiled: { instance?: string; category: string; reason: string }[]; checks: string[] }[] }): Comparison {
  const out: CheckComparison[] = []
  for (const h of hand.checks) {
    const id = assertIdOf(h)
    const cmp: CheckComparison = { hand_code: h.code, hand_name: h.name ?? h.code, ...(id ? { assert_id: id } : {}), compiled_codes: [], verdict: 'differs', differences: [], notes: [] }
    out.push(cmp)
    if (h.remedy !== undefined) cmp.notes.push('the hand check declares typed remedies; the compiler writes none (a check without remedies gets the ones its insufficiency implies)')
    if (!id) {
      cmp.verdict = 'no-counterpart'
      cmp.differences.push({ aspect: 'source', hand: h.name ?? h.code, compiled: '—', explanation: `the hand check names no schematron assert${h.advisory ? ' and is advisory' : ''}: it is a hand addition (${/stricter than the standard/i.test(h.name ?? '') ? 'its name says it is stricter than the standard' : 'not a rule of the pinned schematrons'}), so the compiler has nothing to compile it from` })
      continue
    }
    const candidates = compiled.checks.filter(c => assertIdOf(c) === id)
    const entry = report?.entries.find(e => e.assert_id === id)
    if (!candidates.length) {
      cmp.verdict = 'differs'
      cmp.differences.push({ aspect: 'compiled', hand: `${h.left} ${h.op} ${h.right}`, compiled: 'no check', explanation: entry ? `the compiler left ${id} uncompiled: ${entry.uncompiled.map(u => `${u.category}: ${u.reason}`).join('; ')}` : `no assert ${id} in the compiled inputs` })
      continue
    }
    // the best candidate: same polynomial / same operands, else the first
    const hp = polyOf(hand, h)
    const hOps = operandsOf(hand, h)
    const hKeys = new Set(hOps.map(o => o.key))
    const scored = candidates.map(c => {
      const cp = polyOf(compiled, c)
      const same = hp && cp ? (P.equal(hp, cp) || P.equal(hp, P.neg(cp)) ? 2 : 0) : 0
      const overlap = operandsOf(compiled, c).filter(o => hKeys.has(o.key)).length
      return { c, score: same * 100 + overlap }
    }).sort((a, b) => b.score - a.score)
    const c = scored[0]!.c
    cmp.compiled_codes = candidates.map(x => x.code)
    const d = cmp.differences
    const narrow = (c.narrowing ?? []).join('; ')
    if ((h.compare ?? 'number') !== (c.compare ?? 'number')) d.push({ aspect: 'check kind', hand: h.compare ?? 'number', compiled: c.compare ?? 'number', explanation: 'the two read the rule as different kinds of check' })
    if (h.op !== c.op) d.push({ aspect: 'operator', hand: h.op, compiled: c.op, explanation: 'different operators' })
    if ((h.scope ?? 'document') !== (c.scope ?? 'document')) d.push({ aspect: 'scope', hand: h.scope ?? 'document', compiled: c.scope ?? 'document', explanation: 'one runs per line, the other once per document' })
    // operands
    const cOps = operandsOf(compiled, c)
    if ((h.compare ?? 'number') === 'number' && (c.compare ?? 'number') === 'number') {
      const cp = polyOf(compiled, c)
      if (!hp || !cp) d.push({ aspect: 'operands', hand: `${h.left} ${h.op} ${h.right}`, compiled: `${c.left} ${c.op} ${c.right}`, explanation: 'one side has no polynomial normal form, so the operands are compared by term only' })
      else if (!(P.equal(hp, cp) || P.equal(hp, P.neg(cp)))) {
        const positional = [...P.atomsOf(hp)].some(a => /#row\d/.test(a))
        d.push({
          aspect: 'operands', hand: P.show(hp), compiled: P.show(cp),
          explanation: positional
            ? 'the hand check reads the VAT breakdown rows by position (BT-117 rows 1 to 4, with a guard on a fifth); the compiled check reads every row as one list field, as the schematron\'s sum(cac:TaxSubtotal/cbc:TaxAmount) does'
            : `the operand polynomials differ (compiler notes: ${narrow || 'none'})`,
        })
      }
    } else {
      const hk = hOps.map(o => o.key).sort().join(', '), ck = cOps.map(o => o.key).sort().join(', ')
      if (hk !== ck) {
        const currency = hOps.some(o => o.key.startsWith('@currencyID')) && cOps.some(o => o.key.endsWith('/@currencyID'))
        const instances = candidates.map(x => operandsOf(compiled, x).find(o => o.key.endsWith('/@currencyID'))?.key.replace('/@currencyID', '')).filter(Boolean)
        const left = entry?.uncompiled ?? []
        d.push({
          aspect: 'operands', hand: hk, compiled: currency ? `${candidates.length} checks: @currencyID of ${instances.join(', ')}, each = BT-5` : ck,
          explanation: currency
            ? `the hand check reads one value (the currency the totals are printed in) for every amount's currencyID; the compiler writes one identifier check per amount path that occurs once in the document (${instances.join(', ')}), and lists the amounts it cannot check one by one as uncompiled (${left.map(u => `${u.instance ?? 'one'}: ${u.category}`).join('; ') || 'none'}). An extraction must report each amount's currency (or alias every one to the totals' currency) to feed them`
            : `the checks name different terms (compiler notes: ${narrow || 'none'})`,
        })
      }
    }
    // reading of each shared operand
    for (const ho of hOps) {
      const co = cOps.find(o => o.key === ho.key)
      if (!co) continue
      const hk = ho.kind === 'price' && /BT-131/.test(ho.key) ? 'price (full precision)' : ho.kind
      const ck = co.kind === 'price' && /BT-131/.test(co.key) ? 'price (full precision)' : co.kind
      if (hk !== ck) d.push({ aspect: `reading of ${ho.key}`, hand: `${ho.role}: ${hk}`, compiled: `${co.role}: ${ck}`, explanation: /slack/.test(narrow) ? 'the compiled check reads the term at full precision because the schematron compares it unrounded (u:slack); the hand check reads it at the cent' : 'the two read the term with different kinds' })
      if (absentReading(ho.absent) !== absentReading(co.absent)) d.push({ aspect: `absent ${ho.key}`, hand: `${ho.role}: ${ho.absent}`, compiled: `${co.role}: ${co.absent}`, explanation: `an absent ${ho.key} is read differently (compiler notes: ${narrow || 'none'})` })
      else if (ho.absent !== co.absent) cmp.notes.push(`${ho.key}: absent ${ho.absent} in the hand check, ${co.absent} in the compiled one (the same reading, written differently)`)
    }
    // tolerance
    if ((h.compare ?? 'number') === 'number') {
      const ht = h.tol ?? 0.01, ct = c.tol ?? 0.01
      if (ht !== ct || !!h.exact_tolerance !== !!c.exact_tolerance) d.push({
        aspect: 'tolerance', hand: `${ht}${h.exact_tolerance ? ' exact' : ''}`, compiled: `${ct}${c.exact_tolerance ? ' exact' : ''}`,
        explanation: /slack/.test(narrow) ? `the schematron's u:slack compares decimals exactly; the compiled check allows exactly ${ct} (exact_tolerance), where the hand check's ${ht} stood in for it under floating point` : 'different tolerances',
      })
    }
    // guards
    const g = (x: DeclCheck): string => keysOf(x === h ? hand : compiled, x.abstain_if_present).join(',')
    if (g(h) !== g(c)) d.push({ aspect: 'guard abstain_if_present', hand: g(h) || '—', compiled: g(c) || '—', explanation: g(h).includes('#row') || /ROW/.test((h.abstain_if_present ?? []).join()) ? 'the hand check guards a fifth breakdown row because it reads four by position; a list field reads every row' : 'different abstain guards' })
    const hw = (h.abstain_if_present_without ?? []).length, cw = (c.abstain_if_present_without ?? []).length
    if (hw !== cw) d.push({ aspect: 'guard abstain_if_present_without', hand: String(hw), compiled: String(cw), explanation: hw > cw ? 'the hand check abstains on a positional row reported without its tax amount; the list field instead fails on an unreadable row (fail_if_unreadable)' : 'different guards' })
    const fu = (x: DeclCheck, rs: DeclarativeRuleset): string => keysOf(rs, x.fail_if_unreadable).map(k => k.replace(/^sum:/, '')).join(',')
    if (fu(h, hand) !== fu(c, compiled)) d.push({ aspect: 'fail_if_unreadable', hand: fu(h, hand) || '—', compiled: fu(c, compiled) || '—', explanation: 'the compiler fails a list sum on an element it cannot read (its lists policy, following Peppol 0.3.0); the hand check does not' })
    if (!!h.advisory !== !!c.advisory) d.push({ aspect: 'advisory', hand: String(!!h.advisory), compiled: String(!!c.advisory), explanation: 'one is counsel only' })
    if (JSON.stringify(h.applies_if ?? []) !== JSON.stringify(c.applies_if ?? []) && ((h.applies_if ?? []).length || (c.applies_if ?? []).length)) d.push({ aspect: 'applies_if', hand: show(h.applies_if), compiled: show(c.applies_if), explanation: 'different applicability' })
    if (candidates.length > 1 && !d.some(x => x.aspect === 'operands')) cmp.notes.push(`the compiler wrote ${candidates.length} checks for ${id} (${candidates.map(x => x.code).join(', ')}); compared with ${c.code}`)
    if (entry?.uncompiled.length && !d.some(x => x.aspect === 'operands')) cmp.notes.push(`the compiler left part of ${id} uncompiled, as the hand check does: ${entry.uncompiled.map(u => `${u.instance ? `${u.instance}: ` : ''}${u.category}: ${u.reason}`).join('; ')}`)
    cmp.verdict = d.length ? 'differs' : 'reproduced'
  }
  const unexplained = out.reduce((n, x) => n + x.differences.filter(d => !d.explanation || /^different|^the operand polynomials differ|^the checks name different terms/.test(d.explanation)).length, 0)
  return {
    hand: `${hand.id}@${hand.version}`, compiled: `${compiled.id}@${compiled.version}`, checks: out,
    summary: { hand_checks: out.length, reproduced: out.filter(x => x.verdict === 'reproduced').length, differs: out.filter(x => x.verdict === 'differs').length, no_counterpart: out.filter(x => x.verdict === 'no-counterpart').length, unexplained },
  }
}

/** A comparison as Markdown: one row per hand check, every difference on its own line. */
export function renderComparison(c: Comparison): string {
  const lines = [`### ${c.compiled} against ${c.hand}`, '', `${c.summary.hand_checks} hand checks: ${c.summary.reproduced} reproduced, ${c.summary.differs} differ, ${c.summary.no_counterpart} with no schematron counterpart; ${c.summary.unexplained} difference(s) without a specific explanation.`, '']
  for (const x of c.checks) {
    lines.push(`- **${x.hand_code}** (${x.assert_id ?? 'no assert'}) → ${x.compiled_codes.join(', ') || '—'}: ${x.verdict.toUpperCase()}`)
    for (const d of x.differences) lines.push(`  - ${d.aspect}: hand \`${d.hand}\` · compiled \`${d.compiled}\`. ${d.explanation}`)
    for (const n of x.notes) lines.push(`  - note: ${n}`)
  }
  return `${lines.join('\n')}\n`
}
