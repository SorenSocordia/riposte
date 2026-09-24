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
 */

export interface Env {
  /** role name → its bound numeric value (or undefined if absent/unparseable). */
  vars: Record<string, number | undefined>
  /** sum a per-line role across all lines; undefined if any line lacks it. */
  sum: (role: string) => number | undefined
}

type Tok = { t: 'num' | 'id' | 'op' | 'lp' | 'rp'; v: string; opt?: true }

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

export function evalExpr(expr: string, env: Env): number | undefined {
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
  for (const t of tokenize(expr)) if (t.t === 'id' && t.v !== 'sum' && t.v !== 'abs') out.add(t.v)
  return [...out]
}

/**
 * The roles of one or more expressions, split into REQUIRED (written without `?` at least once) and OPTIONAL (only ever
 * written as `ROLE?`). Order is first appearance, as in `referencedRoles`. Throws on an expression that does not tokenize.
 */
export function roleRefs(...exprs: string[]): { all: string[]; required: string[]; optional: string[] } {
  const all = new Set<string>(), req = new Set<string>()
  for (const e of exprs) for (const t of tokenize(e)) {
    if (t.t !== 'id' || t.v === 'sum' || t.v === 'abs') continue
    all.add(t.v)
    if (!t.opt) req.add(t.v)
  }
  const list = [...all]
  return { all: list, required: list.filter(r => req.has(r)), optional: list.filter(r => !req.has(r)) }
}
