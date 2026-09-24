/**
 * Compile accepted CANDLES into the engine's existing DECLARATIVE ruleset format, so `verify <doc> --ruleset mined.json`
 * enforces the mined rules directly, with the same proof object and the same honesty rules.
 *
 * Each candle compiles to the check that has the SAME semantics as the miner's violation test:
 *   L1 x <= y             line check    x <= y              tol = eps    (any failing line FAILs the document, ANY_FAIL_FAILS)
 *   L2 x = y              line check    x = y               tol = eps
 *   L3 x <= y*(1+t)       line check    x <= y * (1 + t)    the learned t written as a decimal literal
 *   L4 a = q*p            line check    a = q * p
 *   D  T = S [+ F] [*b]   document      T = sum(a) + F * b  (b is a 'bool' field → 1/0)
 *   D  F <= 0             document      F <= 0              (one-sided; this is the prototype's "F = 0")
 *   D  F*[not b] <= 0     document      F * (1 - b) <= 0
 *   I1 / I2               document      compare: 'identifier' (set equality of normalised ids)
 * The compiled ruleset uses the strict tolerance policy (rel 0). The mined eps IS the tolerance, and no extra rounding
 * band is added.
 *
 * NOT EXPRESSIBLE YET (left out, and listed with the reason, never approximated):
 *   - a term Σ(q·p) over lines (a source with no amount field, e.g. the PO's value). `sum()` in the expression language
 *     takes one role, and there are no line-level computed roles. So `T <= sum(q*p)`, `T = sum(q*p)` and
 *     `S <= sum(q*p)` cannot be written.
 *   - a learned t that only prints in exponent notation (e.g. 1e-7). The expression tokenizer reads plain decimals only.
 * When any candle is left out, `complete` is false. The ruleset then UNDER-enforces: a document it passes may still
 * violate a candle it could not express.
 *
 * Two small, additive extensions of the declarative format make I1/I2 and the `*[flag]` forms expressible:
 * field kinds 'bool' and 'identifier', and `compare: 'identifier'` checks (see declarative/types.ts).
 */

import { lintRuleset, type LintResult } from '../declarative/lint.js'
import type { DeclarativeRuleset, DeclCheck, DeclField } from '../declarative/types.js'
import type { Json } from '../declarative/evaluate.js'
import type { CandidateSpec, JudgedCandidate, MineCase, MineFieldSpec, MineReport, Term } from './types.js'

export interface CompileOptions { id?: string; version?: string; name?: string }

export interface CompiledRuleset {
  ruleset: DeclarativeRuleset
  /** candle → check code, in candle (acceptance) order */
  checks: { code: string; candle: string }[]
  not_expressible: { candle: string; reason: string }[]
  /** true iff every candle compiled */
  complete: boolean
  /** the engine's own lint over the compiled ruleset */
  lint: LintResult
  warnings: string[]
}

class NotExpressible extends Error {}

/** A number as an expression literal (the tokenizer reads [0-9.] only, so no exponents and no sign). */
function literal(x: number): string {
  const s = String(x)
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) throw new NotExpressible(`the constant ${s} cannot be written as a plain decimal literal in the expression language`)
  return s
}

function expr(t: Term, used: Set<string>): string {
  if ('field' in t) { used.add(t.field); return t.field }
  if ('sum' in t) { used.add(t.sum); return `sum(${t.sum})` }
  if ('sumProduct' in t) throw new NotExpressible(`sum(${t.sumProduct[0]}*${t.sumProduct[1]}) is a sum of a per-line product; declarative sum() takes one role and there are no line-level computed roles`)
  if ('const' in t) return literal(t.const)
  if ('plus' in t) return `${expr(t.plus[0], used)} + ${expr(t.plus[1], used)}`
  used.add(t.gated); used.add(t.by)
  return t.negate ? `${t.gated} * (1 - ${t.by})` : `${t.gated} * ${t.by}`
}

function toCheck(spec: CandidateSpec, t: number | undefined, code: string, name: string, used: Set<string>): DeclCheck {
  switch (spec.form) {
    case 'le': used.add(spec.x); used.add(spec.y); return { code, name, scope: 'line', left: spec.x, op: '<=', right: spec.y, tol: spec.eps, field: spec.x }
    case 'eq': used.add(spec.x); used.add(spec.y); return { code, name, scope: 'line', left: spec.x, op: '=', right: spec.y, tol: spec.eps, field: spec.x }
    case 'le_tol': {
      if (t === undefined) throw new NotExpressible('no learned tolerance')
      const right = `${spec.y} * (1 + ${literal(t)})`
      used.add(spec.x); used.add(spec.y)
      return { code, name, scope: 'line', left: spec.x, op: '<=', right, tol: spec.eps, field: spec.x }
    }
    case 'product': used.add(spec.a); used.add(spec.q); used.add(spec.p); return { code, name, scope: 'line', left: spec.a, op: '=', right: `${spec.q} * ${spec.p}`, tol: spec.eps, field: spec.a }
    case 'rel': {
      const local = new Set<string>()
      const left = expr(spec.left, local), right = expr(spec.right, local)
      for (const u of local) used.add(u)
      const field = 'field' in spec.left ? spec.left.field : 'gated' in spec.left ? spec.left.gated : undefined
      return { code, name, left, op: spec.op, right, tol: spec.eps, ...(field ? { field } : {}) }
    }
    case 'ids_one': used.add(spec.list); used.add(spec.id); return { code, name, compare: 'identifier', left: spec.list, op: '=', right: spec.id, field: spec.list }
    case 'id_eq': used.add(spec.x); used.add(spec.y); return { code, name, compare: 'identifier', left: spec.x, op: '=', right: spec.y, field: spec.x }
  }
}

const KIND: Record<MineFieldSpec['type'], NonNullable<DeclField['kind']>> = { qty: 'quantity', money: 'amount', bool: 'bool', id: 'identifier', ids: 'identifier' }

export function compileRuleset(report: MineReport, options: CompileOptions = {}): CompiledRuleset {
  const checks: DeclCheck[] = []
  const map: { code: string; candle: string }[] = []
  const not_expressible: { candle: string; reason: string }[] = []
  const used = new Set<string>()
  report.candles.forEach((c: JudgedCandidate) => {
    const code = `M${map.length + 1}`
    const local = new Set<string>()
    try {
      checks.push(toCheck(c.spec, c.t, code, c.id, local))
      for (const u of local) used.add(u)
      map.push({ code, candle: c.id })
    } catch (e) {
      if (!(e instanceof NotExpressible)) throw e
      not_expressible.push({ candle: c.id, reason: e.message })
    }
  })
  // fields: only those the compiled checks reference (document fields first, then line fields, in schema order)
  const fields: Record<string, DeclField> = {}
  for (const [n, f] of Object.entries(report.schema.fields)) if (used.has(n)) fields[n] = { paths: [n], kind: KIND[f.type] }
  for (const [n, f] of Object.entries(report.schema.lines ?? {})) if (used.has(n)) fields[n] = { paths: [n], kind: KIND[f.type], line: true }
  const ruleset: DeclarativeRuleset = {
    id: options.id ?? 'mined',
    version: options.version ?? '0.1.0',
    name: options.name ?? `Mined ruleset (${report.candles.length} candle(s); riposte-mine ${report.mine_version}; table ${report.data.table_hash.slice(0, 12)})`,
    domain: 'mined',
    lineArrayKeys: ['line_items'],
    fields,
    checks,
    tolerance: { rel: 0, absCap: 0 },
  }
  const warnings: string[] = []
  const subcent = report.data.subcent_money_fields.filter((f) => used.has(f))
  if (subcent.length) warnings.push(`money field(s) ${subcent.join(', ')} hold sub-cent values; the engine's amount normaliser rounds to cents, so the enforced ruleset may disagree with the miner on them`)
  if (!checks.length) warnings.push('no candle compiled: the ruleset has no checks and every verdict will be INSUFFICIENT_DATA')
  if (not_expressible.length) warnings.push(`${not_expressible.length} candle(s) could not be expressed; the ruleset under-enforces (a PASS does not mean those rules hold)`)
  return { ruleset, checks: map, not_expressible, complete: not_expressible.length === 0, lint: lintRuleset(ruleset), warnings }
}

/** A mined case as a `verify` extraction for the compiled ruleset: document fields at the top, lines under `line_items`. */
export function caseToExtraction(c: MineCase): Json {
  return { ...c.fields, ...(Array.isArray(c.lines) ? { line_items: c.lines } : {}) }
}
