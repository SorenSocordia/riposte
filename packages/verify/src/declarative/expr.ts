/**
 * A tiny, SAFE arithmetic expression evaluator for declarative rulesets. No `eval`, no dynamic code — a hand-written
 * recursive-descent parser over: numbers, role identifiers, `+ - * /`, parentheses, unary sign, `sum(ROLE)`, `abs(x)`.
 *
 * Returns `undefined` when any referenced role's value is missing — so a formula over an absent field yields "unknown",
 * which the evaluator turns into an honest abstention rather than a number pulled from nowhere.
 *
 * OPTIONAL TERMS (added 2026-09-24, additive): a role name written with a `?` suffix, e.g. `CFO + CFI + CFF + FX?`,
 * is an optional term. It takes the role's value when the role is present and counts as 0 when it is absent, so the
 * expression still has a value. The `?` must follow the role name directly (`FX?`, not `FX ?`). It is only valid after
 * a role name: `sum(X?)`, `abs?(x)` and a free-standing `?` are errors. A role written both as `X` and `X?` in the same
 * check is required. Expressions without `?` evaluate exactly as before.
 *
 * ENGINE 0.4.0 (2026-10-04; docs/RULESETS.md "Engine 0.4.0"). A second grammar, used ONLY when the caller asks for it
 * (`evalExprV040`, `roleRefsV040`, `operandRefs`; the declarative evaluator does so under engine 0.4.0, lint always). The
 * functions above it keep the old grammar byte for byte, with their own caches, so every verdict of an earlier engine reads
 * exactly as it did. The 0.4.0 grammar adds:
 *   sqrt(x)                     the square root (IEEE-754, rounded to 9 decimals); unknown for x < 0, with a domain note
 *   median(R) min(R) max(R) count(R), each also fn(R, SET), and sum(R, SET)
 *                               aggregates over a line or list role, optionally over the rows of a named row set; the caller's
 *                               env.agg computes them (declarative/evaluate.ts), never this module
 *   prev(R) next(R)             R on the row before / after (env.ref)
 *   doc.R                       the document's value of R inside a row (env.ref)
 * Arithmetic that is not finite is unknown under 0.4.0 (NaN and Infinity are never produced).
 */

export interface Env {
  /** role name → its bound numeric value (or undefined if absent/unparseable). */
  vars: Record<string, number | undefined>
  /** sum a per-line role across all lines; undefined if any line lacks it. */
  sum: (role: string) => number | undefined
  /** Engine 0.4.0: an aggregate over a line or list role, optionally over a named row set. */
  agg?: (fn: AggFn, role: string, set?: string) => number | undefined
  /** Engine 0.4.0: a value outside this scope: the document's (doc.R) or a neighbouring row's (prev(R), next(R)). */
  ref?: (kind: RefKind, role: string) => number | undefined
  /** Engine 0.4.0: told when a function has no real value here (sqrt of a negative number). */
  domain?: (note: string) => void
}

/** Engine 0.4.0 aggregate functions. */
export type AggFn = 'median' | 'min' | 'max' | 'count' | 'sum'
/** Engine 0.4.0 references outside the scope. */
export type RefKind = 'doc' | 'prev' | 'next'

type Tok = { t: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string; opt?: true; doc?: true }

function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i] as string
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j] as string)) j++; toks.push({ t: 'num', v: s.slice(i, j) }); i = j; continue }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j] as string)) j++
      // `ROLE?` — an optional term. The '?' must follow the name directly; anywhere else it stays an invalid character.
      if (s[j] === '?') { toks.push({ t: 'id', v: s.slice(i, j), opt: true }); i = j + 1; continue }
      toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue
    }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue }
    if ('+-*/'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    throw new Error(`invalid character in expression: '${c}'`)
  }
  return toks
}

// ── 2026-10-03: compile once, evaluate per line ───────────────────────────────────────────────────────────────────
//
// A line-scope check evaluated its expression on every line by tokenizing and parsing the text again (three times per
// line, with the role lists). A 500-term expression over 2,000 lines × 10 checks took about 34 s. Each expression is now
// compiled once into a tree (cached by its text) and the tree is evaluated per line. The grammar, the errors (thrown at the
// same inputs, with the same messages: parsing never depended on the values) and the arithmetic (the same operations in the
// same order, left to right) are unchanged; the old single-pass evaluator is kept as `evalExprUncompiled` for the
// equivalence test.

type Node =
  | { k: 'num'; v: number }
  /** `syn` (engine 0.4.0 only): a reference outside the scope, `doc.R`, `prev(R)` or `next(R)`, read through env.ref */
  | { k: 'var'; name: string; opt: boolean; syn?: RefKind; role?: string }
  | { k: 'sum'; role: string }
  | { k: 'neg'; a: Node }
  | { k: 'abs'; a: Node }
  /** a left-to-right chain of + - (or * /), evaluated with a loop, so a long expression never recurses deeply; `fin` (0.4.0): non-finite → unknown */
  | { k: 'chain'; first: Node; rest: [string, Node][]; fin?: true }
  /** engine 0.4.0 */
  | { k: 'sqrt'; a: Node }
  | { k: 'agg'; fn: AggFn; role: string; set?: string }

function compileTokens(toks: Tok[]): Node {
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const next = (): Tok => toks[p++] as Tok
  const expect = (t: Tok['t']): void => { if (peek()?.t !== t) throw new Error(`expected ${t}`); next() }
  const chain = (first: Node, ops: string, sub: () => Node): Node => {
    const rest: [string, Node][] = []
    while (peek()?.t === 'op' && ops.includes(peek()!.v)) { const op = next().v; rest.push([op, sub()]) }
    return rest.length ? { k: 'chain', first, rest } : first
  }
  function parseExpr(): Node { return chain(parseTerm(), '+-', parseTerm) }
  function parseTerm(): Node { return chain(parseFactor(), '*/', parseFactor) }
  function parseFactor(): Node {
    const tk = peek()
    if (!tk) throw new Error('unexpected end of expression')
    if (tk.t === 'op' && tk.v === '-') { next(); return { k: 'neg', a: parseFactor() } }
    if (tk.t === 'op' && tk.v === '+') { next(); return parseFactor() }
    if (tk.t === 'num') { next(); return { k: 'num', v: Number(tk.v) } }
    if (tk.t === 'lp') { next(); const v = parseExpr(); expect('rp'); return v }
    if (tk.t === 'id') {
      next()
      if (peek()?.t === 'lp') {
        if (tk.opt) throw new Error(`'?' marks an optional role; it cannot follow the function name '${tk.v}'`)
        next()
        if (tk.v === 'sum') {
          const arg = peek(); if (!arg || arg.t !== 'id') throw new Error('sum() expects a role name')
          if (arg.opt) throw new Error("sum() takes a role name without '?'")
          next(); expect('rp'); return { k: 'sum', role: arg.v }
        }
        if (tk.v === 'abs') { const v = parseExpr(); expect('rp'); return { k: 'abs', a: v } }
        throw new Error(`unknown function '${tk.v}'`)
      }
      return { k: 'var', name: tk.v, opt: tk.opt === true }
    }
    throw new Error(`unexpected token '${tk.v}'`)
  }
  const root = parseExpr()
  if (p !== toks.length) throw new Error('trailing tokens in expression')
  return root
}

function evalNode(n: Node, env: Env): number | undefined {
  switch (n.k) {
    case 'num': return n.v
    case 'var':
      if (n.syn !== undefined) { const v = env.ref?.(n.syn, n.role as string); return v !== undefined && Number.isFinite(v) ? v : undefined }
      return n.opt ? env.vars[n.name] ?? 0 : env.vars[n.name]
    case 'sum': return env.sum(n.role)
    case 'neg': { const v = evalNode(n.a, env); return v === undefined ? undefined : -v }
    case 'abs': { const v = evalNode(n.a, env); return v === undefined ? undefined : Math.abs(v) }
    case 'chain': {
      let left = evalNode(n.first, env)
      for (const [op, sub] of n.rest) {
        const right = evalNode(sub, env)
        if (left === undefined || right === undefined) left = undefined
        else if (op === '+') left = left + right
        else if (op === '-') left = left - right
        else if (op === '*') left = left * right
        else left = right === 0 ? undefined : left / right
        if (n.fin && left !== undefined && !Number.isFinite(left)) left = undefined
      }
      return left
    }
    case 'sqrt': {
      const v = evalNode(n.a, env)
      if (v === undefined) return undefined
      if (v < 0) { env.domain?.(`sqrt of a negative value (${Number(v.toFixed(4))})`); return undefined }
      const r = Math.sqrt(v)
      return Number.isFinite(r) ? round9(r) : undefined
    }
    case 'agg': { const v = env.agg?.(n.fn, n.role, n.set); return v !== undefined && Number.isFinite(v) ? v : undefined }
  }
}

/** The 0.4.0 functions' declared precision: 9 decimal places (the rounding `exact_tolerance` already uses). */
export const round9 = (x: number): number => Number(x.toFixed(9))

/** Bounded caches by expression text (a ruleset has a few hundred expressions at most; the cap only bounds memory). */
const CACHE_MAX = 4096
const compiled = new Map<string, Node | Error>()
const tokenCache = new Map<string, Tok[] | Error>()
function cached<T>(cache: Map<string, T | Error>, key: string, make: () => T): T {
  let hit = cache.get(key)
  if (hit === undefined) {
    try { hit = make() } catch (e) { hit = e as Error }
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(key, hit)
  }
  if (hit instanceof Error) throw hit
  return hit
}
const tokensOf = (expr: string): Tok[] => cached(tokenCache, expr, () => tokenize(expr))

export function evalExpr(expr: string, env: Env): number | undefined {
  return evalNode(cached(compiled, expr, () => compileTokens(tokensOf(expr))), env)
}

/** The evaluator as it was before 2026-10-03 (tokenize and parse on every call). Kept for the equivalence test; same results. */
export function evalExprUncompiled(expr: string, env: Env): number | undefined {
  const toks = tokenize(expr)
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const next = (): Tok => toks[p++] as Tok

  function parseExpr(): number | undefined {
    let left = parseTerm()
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = next().v
      const right = parseTerm()
      if (left === undefined || right === undefined) left = undefined
      else left = op === '+' ? left + right : left - right
    }
    return left
  }
  function parseTerm(): number | undefined {
    let left = parseFactor()
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = next().v
      const right = parseFactor()
      if (left === undefined || right === undefined) left = undefined
      else left = op === '*' ? left * right : (right === 0 ? undefined : left / right)
    }
    return left
  }
  function parseFactor(): number | undefined {
    const tk = peek()
    if (!tk) throw new Error('unexpected end of expression')
    if (tk.t === 'op' && tk.v === '-') { next(); const v = parseFactor(); return v === undefined ? undefined : -v }
    if (tk.t === 'op' && tk.v === '+') { next(); return parseFactor() }
    if (tk.t === 'num') { next(); return Number(tk.v) }
    if (tk.t === 'lp') { next(); const v = parseExpr(); expect('rp'); return v }
    if (tk.t === 'id') {
      next()
      if (peek()?.t === 'lp') {
        if (tk.opt) throw new Error(`'?' marks an optional role; it cannot follow the function name '${tk.v}'`)
        next()
        if (tk.v === 'sum') {
          const arg = peek(); if (!arg || arg.t !== 'id') throw new Error('sum() expects a role name')
          if (arg.opt) throw new Error("sum() takes a role name without '?'")
          next(); expect('rp'); return env.sum(arg.v)
        }
        if (tk.v === 'abs') { const v = parseExpr(); expect('rp'); return v === undefined ? undefined : Math.abs(v) }
        throw new Error(`unknown function '${tk.v}'`)
      }
      // An optional term counts as 0 when its role is absent.
      if (tk.opt) return env.vars[tk.v] ?? 0
      return env.vars[tk.v]
    }
    throw new Error(`unexpected token '${tk.v}'`)
  }
  function expect(t: Tok['t']): void { if (peek()?.t !== t) throw new Error(`expected ${t}`); next() }

  const result = parseExpr()
  if (p !== toks.length) throw new Error('trailing tokens in expression')
  return result
}

/** The role identifiers an expression references (excluding function names) — for evidence and missing-operand detection. */
export function referencedRoles(expr: string): string[] {
  const out = new Set<string>()
  for (const t of tokensOf(expr)) if (t.t === 'id' && t.v !== 'sum' && t.v !== 'abs') out.add(t.v)
  return [...out]
}

/**
 * The roles of one or more expressions, split into REQUIRED (written without `?` at least once) and OPTIONAL (only ever
 * written as `ROLE?`). Order is first appearance, as in `referencedRoles`. Throws on an expression that does not tokenize.
 */
export function roleRefs(...exprs: string[]): { all: string[]; required: string[]; optional: string[] } {
  const all = new Set<string>(), req = new Set<string>()
  for (const e of exprs) for (const t of tokensOf(e)) {
    if (t.t !== 'id' || t.v === 'sum' || t.v === 'abs') continue
    all.add(t.v)
    if (!t.opt) req.add(t.v)
  }
  const list = [...all]
  return { all: list, required: list.filter(r => req.has(r)), optional: list.filter(r => !req.has(r)) }
}

// ── Engine 0.4.0 (2026-10-04): the table grammar ────────────────────────────────────────────────────────────────
//
// Only for a caller that asks for it. Every function above keeps the old grammar, so a verdict of an earlier engine never sees
// `sqrt`, `doc.`, a comma or a new aggregate (for it they stay the errors they always were).

const AGG_FNS = new Set<string>(['median', 'min', 'max', 'count'])

function tokenizeV040(s: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i] as string
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j] as string)) j++; toks.push({ t: 'num', v: s.slice(i, j) }); i = j; continue }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j] as string)) j++
      // `doc.ROLE`: the document's value of ROLE inside a row. Only `doc` directly followed by `.` and a name.
      if (s.slice(i, j) === 'doc' && s[j] === '.' && /[A-Za-z_]/.test(s[j + 1] ?? '')) {
        let k = j + 1; while (k < s.length && /[A-Za-z0-9_]/.test(s[k] as string)) k++
        if (s[k] === '?') throw new Error(`'?' cannot follow doc.${s.slice(j + 1, k)}: a document value is required or not used`)
        toks.push({ t: 'id', v: s.slice(j + 1, k), doc: true }); i = k; continue
      }
      if (s[j] === '?') { toks.push({ t: 'id', v: s.slice(i, j), opt: true }); i = j + 1; continue }
      toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue
    }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma', v: c }); i++; continue }
    if ('+-*/'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    throw new Error(`invalid character in expression: '${c}'`)
  }
  return toks
}

function compileTokensV040(toks: Tok[]): Node {
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const next = (): Tok => toks[p++] as Tok
  const expect = (t: Tok['t']): void => { if (peek()?.t !== t) throw new Error(`expected ${t}`); next() }
  const chain = (first: Node, ops: string, sub: () => Node): Node => {
    const rest: [string, Node][] = []
    while (peek()?.t === 'op' && ops.includes(peek()!.v)) { const op = next().v; rest.push([op, sub()]) }
    return rest.length ? { k: 'chain', first, rest, fin: true } : first
  }
  /** A role-name argument: a plain name, never `?` and never `doc.`. */
  const roleArg = (fn: string): string => {
    const arg = peek()
    if (!arg || arg.t !== 'id' || arg.doc) throw new Error(`${fn}() expects a role name`)
    if (arg.opt) throw new Error(`${fn}() takes a role name without '?'`)
    next()
    return arg.v
  }
  function parseExpr(): Node { return chain(parseTerm(), '+-', parseTerm) }
  function parseTerm(): Node { return chain(parseFactor(), '*/', parseFactor) }
  function parseFactor(): Node {
    const tk = peek()
    if (!tk) throw new Error('unexpected end of expression')
    if (tk.t === 'op' && tk.v === '-') { next(); return { k: 'neg', a: parseFactor() } }
    if (tk.t === 'op' && tk.v === '+') { next(); return parseFactor() }
    if (tk.t === 'num') { next(); return { k: 'num', v: Number(tk.v) } }
    if (tk.t === 'lp') { next(); const v = parseExpr(); expect('rp'); return v }
    if (tk.t === 'id') {
      next()
      if (tk.doc) return { k: 'var', name: `doc.${tk.v}`, opt: false, syn: 'doc', role: tk.v }
      if (peek()?.t === 'lp') {
        if (tk.opt) throw new Error(`'?' marks an optional role; it cannot follow the function name '${tk.v}'`)
        next()
        if (tk.v === 'sum' || AGG_FNS.has(tk.v)) {
          const role = roleArg(tk.v)
          let set: string | undefined
          if (peek()?.t === 'comma') {
            next()
            const s = peek()
            if (!s || s.t !== 'id' || s.opt || s.doc) throw new Error(`${tk.v}() takes a row set name as its second argument`)
            next()
            set = s.v
          }
          expect('rp')
          if (tk.v === 'sum' && set === undefined) return { k: 'sum', role }
          return { k: 'agg', fn: tk.v as AggFn, role, ...(set !== undefined ? { set } : {}) }
        }
        if (tk.v === 'abs') { const v = parseExpr(); expect('rp'); return { k: 'abs', a: v } }
        if (tk.v === 'sqrt') { const v = parseExpr(); expect('rp'); return { k: 'sqrt', a: v } }
        if (tk.v === 'prev' || tk.v === 'next') {
          const role = roleArg(tk.v)
          expect('rp')
          return { k: 'var', name: `${tk.v}.${role}`, opt: false, syn: tk.v, role }
        }
        throw new Error(`unknown function '${tk.v}'`)
      }
      return { k: 'var', name: tk.v, opt: tk.opt === true }
    }
    if (tk.t === 'comma') throw new Error("unexpected ',' (a comma separates a function's arguments)")
    throw new Error(`unexpected token '${tk.v}'`)
  }
  const root = parseExpr()
  if (p !== toks.length) throw new Error('trailing tokens in expression')
  return root
}

const compiledV040 = new Map<string, Node | Error>()
const tokenCacheV040 = new Map<string, Tok[] | Error>()
const treeV040 = (expr: string): Node => cached(compiledV040, expr, () => compileTokensV040(cached(tokenCacheV040, expr, () => tokenizeV040(expr))))

/** Evaluate under the engine 0.4.0 grammar. */
export function evalExprV040(expr: string, env: Env): number | undefined {
  return evalNode(treeV040(expr), env)
}

/**
 * One operand occurrence of a 0.4.0 expression: a role (`kind: 'role'`, or `'sum'` inside a one-argument sum), a document value
 * (`doc`), a neighbouring row's value (`prev` / `next`) or an aggregate (`agg`). `name` is how the evaluator keys it: the role
 * itself for `role` and `sum`; `doc.R`, `prev.R`, `next.R`; `fn(R)` or `fn(R,SET)` for an aggregate.
 */
export interface OperandRef {
  name: string
  kind: 'role' | 'sum' | 'doc' | 'prev' | 'next' | 'agg'
  role: string
  fn?: AggFn
  set?: string
  optional: boolean
}

/** Every operand occurrence of a 0.4.0 expression, in reading order (not deduplicated). Throws on an expression that does not parse. */
export function operandRefs(expr: string): OperandRef[] {
  const out: OperandRef[] = []
  const walk = (n: Node): void => {
    switch (n.k) {
      case 'num': return
      case 'var':
        if (n.syn !== undefined) { out.push({ name: n.name, kind: n.syn, role: n.role as string, optional: false }); return }
        // the old reference rule excluded the names `sum` and `abs` wherever they appear; kept, so a role so named reads as before
        if (n.name === 'sum' || n.name === 'abs') return
        out.push({ name: n.name, kind: 'role', role: n.name, optional: n.opt })
        return
      case 'sum': out.push({ name: n.role, kind: 'sum', role: n.role, optional: false }); return
      case 'neg': case 'abs': case 'sqrt': walk(n.a); return
      case 'chain': walk(n.first); for (const [, s] of n.rest) walk(s); return
      case 'agg': out.push({ name: `${n.fn}(${n.role}${n.set !== undefined ? `,${n.set}` : ''})`, kind: 'agg', role: n.role, fn: n.fn, ...(n.set !== undefined ? { set: n.set } : {}), optional: false }); return
    }
  }
  walk(treeV040(expr))
  return out
}

/** referencedRoles under the 0.4.0 grammar: the operand names (operandRefs `name`), deduplicated, in reading order. */
export function referencedRolesV040(expr: string): string[] {
  return [...new Set(operandRefs(expr).map(r => r.name))]
}

/** roleRefs under the 0.4.0 grammar: the operand names split into REQUIRED (written without `?` at least once) and OPTIONAL. */
export function roleRefsV040(...exprs: string[]): { all: string[]; required: string[]; optional: string[] } {
  const all = new Set<string>(), req = new Set<string>()
  for (const e of exprs) for (const r of operandRefs(e)) { all.add(r.name); if (!r.optional) req.add(r.name) }
  const list = [...all]
  return { all: list, required: list.filter(r => req.has(r)), optional: list.filter(r => !req.has(r)) }
}

/** An evaluator name that is not a plain role: `doc.R`, `prev.R`, `next.R`, `fn(R)` or `fn(R,SET)` (parsed back), else undefined. */
export function parseOperandName(name: string): Omit<OperandRef, 'optional'> | undefined {
  let m = /^(doc|prev|next)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(name)
  if (m) return { name, kind: m[1] as RefKind, role: m[2] as string }
  m = /^(median|min|max|count|sum)\(([A-Za-z_][A-Za-z0-9_]*)(?:,([A-Za-z_][A-Za-z0-9_]*))?\)$/.exec(name)
  if (m) return { name, kind: 'agg', role: m[2] as string, fn: m[1] as AggFn, ...(m[3] !== undefined ? { set: m[3] } : {}) }
  return undefined
}
