/**
 * The lattice: the candidate grammar is generated FROM THE SCHEMA and enumerated exhaustively in a fixed order.
 * These are the same families as the Oracle-AP prototype (PREREG-ORACLE-AP.md). For the AP schema the grammar is the
 * prototype's frozen grammar exactly: 30 forms, and 78 variants once the t-grid is counted.
 *
 *   L1  x <= y          every ordered pair of same-dimension line fields     (violated if ANY line violates it)
 *   L2  x = y           every unordered same-dimension pair
 *   L3  x <= y*(1+t)    the L1 pairs, with t learned from the grid
 *   L4  a = q*p         per amount field, with every qty and price of the same source
 *   D   for each total T:  T = S · T = S + F · T = S + F*[b]   (S = the line sum of T's own source; F = an extra; b = a bool)
 *                          T <= P · T = P                        (P = the line value of each OTHER source)
 *       for each extra F:  F <= 0 · F*[not b] <= 0
 *       S <= P
 *   I1  a cited-ids list holds exactly one id, and it equals an id field (set semantics, normalised)
 *   I2  id = id         every unordered pair of single-id fields
 *   C   X <= c, c <= X  per numeric document field, c learned from the labels (opt-in: `thresholds`; threshold.ts)
 *
 * A source's line value is Σ amount when the source has an amount field, and otherwise Σ qty·price.
 *
 * Evaluation is THREE-VALUED. It returns true (violated), false (holds), or null (undecidable here, because a value it
 * needs is missing or of the wrong type). The judges build each candidate's null only over the cases it can decide.
 */

import type { Candidate, CandidateSpec, LineComparisonSpec, MineFieldSpec, MineSchema, Term } from './types.js'

export const DEFAULT_T_GRID: readonly number[] = [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.10]
export const DEFAULT_EPS = { qty: 1e-9, money: 0.005 } as const

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = new Set(['sum', 'abs', 'line_items'])
const TYPES = new Set(['qty', 'money', 'bool', 'id', 'ids'])

/** Throw a clear error if the schema cannot be mined (bad names, types or roles). */
export function validateSchema(schema: MineSchema): void {
  if (!schema || typeof schema !== 'object') throw new Error('schema must be an object')
  const approve = Array.isArray(schema.approve) ? schema.approve : [schema.approve]
  if (!approve.length || !approve.every((a) => typeof a === 'string' && a.length > 0)) throw new Error('schema.approve must be a non-empty label string (or array of them)')
  if (!schema.fields || typeof schema.fields !== 'object' || Array.isArray(schema.fields)) throw new Error('schema.fields must be an object')
  const seen = new Set<string>()
  const check = (name: string, f: MineFieldSpec, where: 'document' | 'line'): void => {
    if (!IDENT.test(name) || RESERVED.has(name)) throw new Error(`schema ${where} field "${name}": names must be identifiers ([A-Za-z_][A-Za-z0-9_]*) and not sum/abs/line_items`)
    if (seen.has(name)) throw new Error(`schema field "${name}" is declared twice (document and line names share one namespace)`)
    seen.add(name)
    if (!f || !TYPES.has(f.type)) throw new Error(`schema ${where} field "${name}": type must be one of qty, money, bool, id, ids`)
    if (f.role !== undefined) {
      const ok = where === 'line' ? f.type === 'money' && (f.role === 'price' || f.role === 'amount') : f.type === 'money' && (f.role === 'total' || f.role === 'extra')
      if (!ok) throw new Error(`schema ${where} field "${name}": role "${f.role}" is not valid here (line money: price|amount; document money: total|extra)`)
    }
    if (f.eps !== undefined && !(typeof f.eps === 'number' && Number.isFinite(f.eps) && f.eps >= 0)) throw new Error(`schema field "${name}": eps must be a finite number >= 0`)
  }
  for (const [n, f] of Object.entries(schema.fields)) check(n, f, 'document')
  for (const [n, f] of Object.entries(schema.lines ?? {})) check(n, f, 'line')
}

/** A C candidate's spec with its constant filled in ('high': `field <= c`; 'low': `c <= field`). eps 0: see threshold.ts. */
export function constSpec(field: string, dir: 'high' | 'low', c: number): CandidateSpec {
  return dir === 'high'
    ? { scope: 'document', form: 'rel', op: '<=', left: { field }, right: { const: c }, eps: 0 }
    : { scope: 'document', form: 'rel', op: '<=', left: { const: c }, right: { field }, eps: 0 }
}

export const approveLabels = (schema: MineSchema): Set<string> => new Set(Array.isArray(schema.approve) ? schema.approve : [schema.approve])

const epsOf = (f: MineFieldSpec): number => f.eps ?? (f.type === 'qty' ? DEFAULT_EPS.qty : DEFAULT_EPS.money)
const dimOf = (f: MineFieldSpec): string => f.dim ?? (f.type === 'money' && f.role ? `money:${f.role}` : f.type)
const isNumeric = (f: MineFieldSpec): boolean => f.type === 'qty' || f.type === 'money'

/** A human-readable rendering of a document term (also the candidate id's vocabulary). */
export function renderTerm(t: Term): string {
  if ('field' in t) return t.field
  if ('sum' in t) return `sum(${t.sum})`
  if ('sumProduct' in t) return `sum(${t.sumProduct[0]}*${t.sumProduct[1]})`
  if ('const' in t) return String(t.const)
  if ('plus' in t) return `${renderTerm(t.plus[0])} + ${renderTerm(t.plus[1])}`
  return `${t.gated}*[${t.negate ? 'not ' : ''}${t.by}]`
}

/** Build the lattice from the schema, in grammar order. */
export function buildGrammar(schema: MineSchema, tGrid: readonly number[] = DEFAULT_T_GRID, opts: { thresholds?: boolean } = {}): Candidate[] {
  validateSchema(schema)
  const lines = Object.entries(schema.lines ?? {})
  const docs = Object.entries(schema.fields)
  const out: Candidate[] = []

  // ── line comparisons: group numeric line fields by dimension (dimension order = first appearance) ──
  const dims = new Map<string, [string, MineFieldSpec][]>()
  for (const [n, f] of lines) if (isNumeric(f)) { const d = dimOf(f); if (!dims.has(d)) dims.set(d, []); dims.get(d)!.push([n, f]) }
  const ordered: { x: string; y: string; eps: number }[] = []
  const unordered: { x: string; y: string; eps: number }[] = []
  for (const fs of dims.values()) {
    for (const [x, fx] of fs) for (const [y, fy] of fs) if (x !== y) ordered.push({ x, y, eps: Math.max(epsOf(fx), epsOf(fy)) })
    fs.forEach(([x, fx], i) => { for (const [y, fy] of fs.slice(i + 1)) unordered.push({ x, y, eps: Math.max(epsOf(fx), epsOf(fy)) }) })
  }
  for (const { x, y, eps } of ordered) out.push({ id: `L1 ${x} <= ${y}`, family: 'L1', spec: { scope: 'line', form: 'le', x, y, eps } })
  for (const { x, y, eps } of unordered) out.push({ id: `L2 ${x} = ${y}`, family: 'L2', spec: { scope: 'line', form: 'eq', x, y, eps } })
  for (const { x, y, eps } of ordered) out.push({ id: `L3 ${x} <= ${y}*(1+t)`, family: 'L3', spec: { scope: 'line', form: 'le_tol', x, y, eps }, tGrid: [...tGrid] })

  // ── line arithmetic, grouped by source (source order = first appearance) ──
  const sources: string[] = []
  for (const [, f] of lines) { const s = f.source ?? ''; if (!sources.includes(s)) sources.push(s) }
  const of = (s: string, pred: (f: MineFieldSpec) => boolean): string[] => lines.filter(([, f]) => (f.source ?? '') === s && pred(f)).map(([n]) => n)
  const qtyOf = (s: string) => of(s, (f) => f.type === 'qty')
  const priceOf = (s: string) => of(s, (f) => f.type === 'money' && f.role === 'price')
  const amountOf = (s: string) => of(s, (f) => f.type === 'money' && f.role === 'amount')
  for (const [a, fa] of lines) {
    if (!(fa.type === 'money' && fa.role === 'amount')) continue
    const s = fa.source ?? ''
    for (const q of qtyOf(s)) for (const p of priceOf(s)) out.push({ id: `L4 ${a} = ${q}*${p}`, family: 'L4', spec: { scope: 'line', form: 'product', a, q, p, eps: epsOf(fa) } })
  }

  // ── document sum relations ──
  const lineValue = new Map<string, Term[]>() // source → its line-value terms
  for (const s of sources) {
    const amounts = amountOf(s)
    const terms: Term[] = amounts.length ? amounts.map((a) => ({ sum: a })) : qtyOf(s).flatMap((q) => priceOf(s).map((p) => ({ sumProduct: [q, p] as [string, string] })))
    if (terms.length) lineValue.set(s, terms)
  }
  const totals = docs.filter(([, f]) => f.type === 'money' && f.role === 'total')
  const extras = docs.filter(([, f]) => f.type === 'money' && f.role === 'extra')
  const bools = docs.filter(([, f]) => f.type === 'bool').map(([n]) => n)
  const d = (left: Term, op: '=' | '<=', right: Term, eps: number): Candidate =>
    ({ id: `D ${renderTerm(left)} ${op} ${renderTerm(right)}`, family: 'D', spec: { scope: 'document', form: 'rel', op, left, right, eps } })
  const own = (src: string): Term[] => lineValue.get(src) ?? []
  const others = (src: string): Term[] => [...lineValue.entries()].filter(([s]) => s !== src).flatMap(([, t]) => t)
  for (const [T, fT] of totals) {
    const src = fT.source ?? ''
    const e = epsOf(fT)
    for (const S of own(src)) {
      out.push(d({ field: T }, '=', S, e))
      for (const [F] of extras) out.push(d({ field: T }, '=', { plus: [S, { field: F }] }, e))
      for (const [F] of extras) for (const b of bools) out.push(d({ field: T }, '=', { plus: [S, { gated: F, by: b }] }, e))
    }
    for (const P of others(src)) {
      out.push(d({ field: T }, '<=', P, e))
      out.push(d({ field: T }, '=', P, e))
    }
  }
  for (const [F, fF] of extras) {
    out.push(d({ field: F }, '<=', { const: 0 }, epsOf(fF)))
    for (const b of bools) out.push(d({ gated: F, by: b, negate: true }, '<=', { const: 0 }, epsOf(fF)))
  }
  const ownSrcs = [...new Set(totals.map(([, f]) => f.source ?? ''))]
  for (const src of ownSrcs) {
    const e = Math.max(...totals.filter(([, f]) => (f.source ?? '') === src).map(([, f]) => epsOf(f)))
    for (const S of own(src)) for (const P of others(src)) out.push(d(S, '<=', P, e))
  }

  // ── identifiers ──
  const idsF = docs.filter(([, f]) => f.type === 'ids').map(([n]) => n)
  const idF = docs.filter(([, f]) => f.type === 'id').map(([n]) => n)
  for (const list of idsF) for (const id of idF) out.push({ id: `I1 ${list} cites exactly one id = ${id}`, family: 'I1', spec: { scope: 'document', form: 'ids_one', list, id } })
  idF.forEach((x, i) => { for (const y of idF.slice(i + 1)) out.push({ id: `I2 ${x} = ${y}`, family: 'I2', spec: { scope: 'document', form: 'id_eq', x, y } }) })

  // ── learned constants (opt-in, last, so the families above keep their order) ──
  if (opts.thresholds) {
    for (const [X, f] of docs) {
      if (!isNumeric(f)) continue
      out.push({ id: `C ${X} <= c`, family: 'C', spec: constSpec(X, 'high', 0), learnConst: { field: X, dir: 'high' } })
      out.push({ id: `C ${X} >= c`, family: 'C', spec: constSpec(X, 'low', 0), learnConst: { field: X, dir: 'low' } })
    }
  }

  return out
}

// ── evaluation ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PreparedCase {
  id: string
  label: string
  hold: boolean
  fields: Record<string, unknown>
  lines: Record<string, unknown>[] | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean | null => (v === true || v === 1 ? true : v === false || v === 0 ? false : null)
export const normId = (s: string): string => s.replace(/\s+/g, '').toUpperCase()
const one = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const n = normId(v)
  return n.length ? n : null
}
const idSet = (v: unknown): Set<string> | null => {
  if (typeof v === 'string' || typeof v === 'number') { const n = one(v); return n === null ? null : new Set([n]) }
  if (!Array.isArray(v)) return null
  const out = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string' && typeof x !== 'number') return null
    const n = one(x)
    if (n !== null) out.add(n)
  }
  return out
}

/** Is a value present and of the declared type? (For the report's missing-value diagnostics.) */
export function valueOk(type: MineFieldSpec['type'], v: unknown): boolean {
  if (type === 'qty' || type === 'money') return num(v) !== null
  if (type === 'bool') return bool(v) !== null
  if (type === 'id') return one(v) !== null
  return idSet(v) !== null
}

function evalTerm(t: Term, c: PreparedCase): number | null {
  if ('field' in t) return num(c.fields[t.field])
  if ('const' in t) return t.const
  if ('sum' in t || 'sumProduct' in t) {
    if (!c.lines) return null
    let acc = 0
    for (const l of c.lines) {
      if ('sum' in t) { const v = num(l[t.sum]); if (v === null) return null; acc = acc + v }
      else { const q = num(l[t.sumProduct[0]]), p = num(l[t.sumProduct[1]]); if (q === null || p === null) return null; acc = acc + q * p }
    }
    return acc
  }
  if ('plus' in t) { const a = evalTerm(t.plus[0], c), b = evalTerm(t.plus[1], c); return a === null || b === null ? null : a + b }
  const g = bool(c.fields[t.by]), f = num(c.fields[t.gated])
  if (g === null || f === null) return null
  return (t.negate ? !g : g) ? f : 0
}

/** Any line violates, over the lines that can be decided. With no line data at all, the answer is undecidable. */
function anyLine(c: PreparedCase, f: (l: Record<string, unknown>) => boolean | null): boolean | null {
  if (!c.lines) return null
  let undecided = false
  for (const l of c.lines) { const r = f(l); if (r === true) return true; if (r === null) undecided = true }
  return undecided ? null : false
}

/** Three-valued: true = violated, false = holds, null = undecidable on this case. `t` is used by L3 only. */
export function violated(spec: CandidateSpec, c: PreparedCase, t = 0): boolean | null {
  switch (spec.form) {
    case 'le': return anyLine(c, (l) => { const x = num(l[spec.x]), y = num(l[spec.y]); return x === null || y === null ? null : x > y + spec.eps })
    case 'eq': return anyLine(c, (l) => { const x = num(l[spec.x]), y = num(l[spec.y]); return x === null || y === null ? null : Math.abs(x - y) > spec.eps })
    case 'le_tol': return anyLine(c, (l) => { const x = num(l[spec.x]), y = num(l[spec.y]); return x === null || y === null ? null : x > y * (1 + t) + spec.eps })
    case 'product': return anyLine(c, (l) => { const a = num(l[spec.a]), q = num(l[spec.q]), p = num(l[spec.p]); return a === null || q === null || p === null ? null : Math.abs(a - q * p) > spec.eps })
    case 'rel': {
      const L = evalTerm(spec.left, c), R = evalTerm(spec.right, c)
      if (L === null || R === null) return null
      return spec.op === '=' ? Math.abs(L - R) > spec.eps : L > R + spec.eps
    }
    case 'ids_one': {
      const s = idSet(c.fields[spec.list]), id = one(c.fields[spec.id])
      if (s === null || id === null) return null
      return !(s.size === 1 && s.has(id))
    }
    case 'id_eq': {
      const x = one(c.fields[spec.x]), y = one(c.fields[spec.y])
      return x === null || y === null ? null : x !== y
    }
  }
}

/**
 * The per-case worst ratio x/y − 1 over the lines, used for an L3 candle's data-supported interval (eps ignored,
 * as in the prototype). Returns null when no line has a usable ratio. A line with y <= 0 that violates at every t
 * counts as +Infinity.
 */
export function worstRatio(spec: LineComparisonSpec, c: PreparedCase): number | null {
  if (!c.lines) return null
  let worst: number | null = null
  for (const l of c.lines) {
    const x = num(l[spec.x]), y = num(l[spec.y])
    if (x === null || y === null) continue
    const r = y > 0 ? x / y - 1 : x > y + spec.eps ? Infinity : null
    if (r !== null && (worst === null || r > worst)) worst = r
  }
  return worst
}
