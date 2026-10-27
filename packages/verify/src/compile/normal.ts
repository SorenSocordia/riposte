/**
 * A normal form for arithmetic (2026-10-03, the standards compiler): an expression over named atoms becomes a polynomial
 * with rational exponents allowed for division by an atom (`QTY * PRICE / BASE` is one monomial). Two expressions with
 * the same polynomial compute the same number from the same operands, whatever their order or parenthesization. It is
 * used to collapse a schematron disjunction whose branches differ only by which optional operands are present, and to
 * compare a compiled check with a hand-written one by its operands rather than its text. A division by anything that is
 * not a single monomial has no normal form here (`undefined`), and the caller reports that instead of guessing.
 */

/** monomial key ('' for the constant term) → coefficient */
export type Poly = Map<string, number>

const EPS = 1e-12
const monoKey = (factors: Map<string, number>): string => [...factors.entries()].filter(([, e]) => e !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([a, e]) => (e === 1 ? a : `${a}^${e}`)).join('·')
const parseMono = (k: string): Map<string, number> => {
  const m = new Map<string, number>()
  if (!k) return m
  for (const f of k.split('·')) { const i = f.lastIndexOf('^'); if (i > 0) m.set(f.slice(0, i), Number(f.slice(i + 1))); else m.set(f, 1) }
  return m
}
const clean = (p: Poly): Poly => { for (const [k, v] of p) if (Math.abs(v) < EPS) p.delete(k); return p }

export const constant = (v: number): Poly => clean(new Map([['', v]]))
export const atom = (name: string): Poly => new Map([[name, 1]])
export function add(a: Poly, b: Poly, sign = 1): Poly {
  const out = new Map(a)
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + sign * v)
  return clean(out)
}
export const neg = (a: Poly): Poly => new Map([...a].map(([k, v]) => [k, -v]))
export function mul(a: Poly, b: Poly): Poly {
  const out: Poly = new Map()
  for (const [ka, va] of a) for (const [kb, vb] of b) {
    const f = parseMono(ka)
    for (const [x, e] of parseMono(kb)) f.set(x, (f.get(x) ?? 0) + e)
    const k = monoKey(f)
    out.set(k, (out.get(k) ?? 0) + va * vb)
  }
  return clean(out)
}
/** a ÷ b, when b is a single monomial (an atom product or a constant); else undefined. */
export function div(a: Poly, b: Poly): Poly | undefined {
  if (b.size !== 1) return undefined
  const [[kb, vb]] = [...b] as [[string, number]]
  if (Math.abs(vb) < EPS) return undefined
  const inv = new Map<string, number>()
  for (const [x, e] of parseMono(kb)) inv.set(x, -e)
  return mul(a, new Map([[monoKey(inv), 1 / vb]]))
}
export function equal(a: Poly, b: Poly): boolean {
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const k of keys) if (Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)) > 1e-9) return false
  return true
}
export const isZero = (a: Poly): boolean => [...a.values()].every(v => Math.abs(v) < 1e-9)
/** Replace atoms by 0 (an absent optional operand counted as zero). */
export function zero(a: Poly, atoms: (name: string) => boolean): Poly {
  const out: Poly = new Map()
  for (const [k, v] of a) { const f = parseMono(k); if ([...f.keys()].some(x => atoms(x) && (f.get(x) ?? 0) > 0)) continue; out.set(k, v) }
  return clean(out)
}
/** The atoms a polynomial uses. */
export const atomsOf = (a: Poly): Set<string> => new Set([...a.keys()].flatMap(k => [...parseMono(k).keys()]))
/** A readable rendering, e.g. "BT-106 - BT-109 - BT-107 + BT-108". */
export function show(a: Poly): string {
  if (isZero(a)) return '0'
  const parts = [...a].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => {
    const mag = Math.abs(v)
    const body = k === '' ? String(mag) : mag === 1 ? k : `${mag}·${k}`
    return { sign: v < 0 ? '-' : '+', body }
  })
  return parts.map((p, i) => (i === 0 ? (p.sign === '-' ? `-${p.body}` : p.body) : ` ${p.sign} ${p.body}`)).join('')
}

// ── declarative expressions ────────────────────────────────────────────────────────────────────────────────────────────

/** The polynomial of a declarative check expression (numbers, roles, `ROLE?`, + - * /, parentheses, sum(ROLE), abs()). `atomOf` names each role (e.g. by its BT term); `sum(ROLE)` is the atom `Σ` + that name. */
export function polyOfExpr(expr: string, atomOf: (role: string) => string): Poly | undefined {
  const toks = expr.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*\??|[()+\-*/]/g)
  if (!toks || toks.join('') !== expr.replace(/\s+/g, '')) return undefined
  let p = 0
  const peek = (): string | undefined => toks[p]
  const term = (): Poly | undefined => {
    let l = factor()
    while (l && (peek() === '*' || peek() === '/')) {
      const op = toks[p++]
      const r = factor()
      if (!r) return undefined
      l = op === '*' ? mul(l, r) : div(l, r)
    }
    return l
  }
  const exprP = (): Poly | undefined => {
    let l = term()
    while (l && (peek() === '+' || peek() === '-')) {
      const op = toks[p++]
      const r = term()
      if (!r) return undefined
      l = add(l, r, op === '+' ? 1 : -1)
    }
    return l
  }
  const factor = (): Poly | undefined => {
    const t = toks[p++]
    if (t === undefined) return undefined
    if (t === '-') { const f = factor(); return f ? neg(f) : undefined }
    if (t === '+') return factor()
    if (t === '(') { const e = exprP(); if (toks[p++] !== ')') return undefined; return e }
    if (/^\d/.test(t)) return constant(Number(t))
    if (t === 'sum' && peek() === '(') { p++; const r = toks[p++]; if (!r || toks[p++] !== ')') return undefined; return atom(`Σ${atomOf(r.replace(/\?$/, ''))}`) }
    if (t === 'abs' && peek() === '(') return undefined
    return atom(atomOf(t.replace(/\?$/, '')))
  }
  const out = exprP()
  return out && p === toks.length ? out : undefined
}
