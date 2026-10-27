/**
 * An XPath 2.0 parser for the subset schematron asserts use (2026-10-03, the standards compiler): paths with axes,
 * abbreviations and predicates, unions, comparisons (general and value), arithmetic, and/or, if/then/else,
 * some/every/for, sequences, function calls, `castable as` / `cast as` / `instance of`, literals and variables. It only
 * builds a tree; ./interpret.ts gives the tree its meaning over the UBL structure. A test this parser cannot read is
 * reported by the compiler as uncompiled (`xpath-not-parsed`), never guessed at.
 */

export type Ast =
  | { k: 'or' | 'and'; args: Ast[] }
  | { k: 'cmp'; op: CmpOp; l: Ast; r: Ast }
  | { k: 'arith'; op: '+' | '-' | '*' | 'div' | 'idiv' | 'mod'; l: Ast; r: Ast }
  | { k: 'neg'; a: Ast }
  | { k: 'union'; args: Ast[] }
  | { k: 'setop'; op: 'intersect' | 'except'; l: Ast; r: Ast }
  | { k: 'range'; l: Ast; r: Ast }
  | { k: 'path'; root: '' | '/' | '//'; steps: Step[] }
  | { k: 'filter'; primary: Ast; preds: Ast[] }
  | { k: 'lit'; v: string | number }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'ctx' }
  | { k: 'if'; cond: Ast; then: Ast; else: Ast }
  | { k: 'quant'; q: 'some' | 'every'; binds: { v: string; in: Ast }[]; sat: Ast }
  | { k: 'for'; binds: { v: string; in: Ast }[]; ret: Ast }
  | { k: 'seq'; items: Ast[] }
  | { k: 'type'; op: 'castable' | 'cast' | 'instance' | 'treat'; a: Ast; type: string }

/** General (=, !=, <, …) and value (eq, ne, …) comparisons, both kept; node comparisons (is, <<, >>) too. */
export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'is' | '<<' | '>>'

/** One step of a path: an axis step with a node test, or a primary expression used as a step (e.g. `xs:decimal(.)`, `(a|b)`). */
export type Step =
  | { s: 'axis'; sep: '/' | '//' | ''; axis: string; test: NodeTest; preds: Ast[] }
  | { s: 'expr'; sep: '/' | '//' | ''; expr: Ast; preds: Ast[] }
export type NodeTest = { kind: 'name'; name: string } | { kind: 'kind'; name: string }

export class XPathError extends Error {}

type Tok = { t: 'str' | 'num' | 'name' | 'var' | 'op'; v: string; pos: number }

const KIND_TESTS = new Set(['node', 'text', 'comment', 'processing-instruction', 'element', 'attribute', 'document-node', 'schema-element', 'schema-attribute', 'item'])
const AXES = new Set(['child', 'descendant', 'attribute', 'self', 'descendant-or-self', 'following-sibling', 'following', 'namespace', 'parent', 'ancestor', 'preceding-sibling', 'preceding', 'ancestor-or-self'])

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const nameStart = /[A-Za-z_À-￿]/
  const nameChar = /[A-Za-z0-9_.\-·À-￿]/
  while (i < src.length) {
    const c = src[i] as string
    if (/\s/.test(c)) { i++; continue }
    if (c === '(' && src[i + 1] === ':') { // comment, nestable
      let depth = 1; i += 2
      while (i < src.length && depth > 0) { if (src.startsWith('(:', i)) { depth++; i += 2 } else if (src.startsWith(':)', i)) { depth--; i += 2 } else i++ }
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = ''
      for (;;) {
        if (j >= src.length) throw new XPathError(`unterminated string at ${i}`)
        if (src[j] === c) { if (src[j + 1] === c) { s += c; j += 2; continue } break }
        s += src[j]; j++
      }
      out.push({ t: 'str', v: s, pos: i }); i = j + 1; continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!
      out.push({ t: 'num', v: m[0], pos: i }); i += m[0].length; continue
    }
    if (c === '$') {
      let j = i + 1
      if (!nameStart.test(src[j] ?? '')) throw new XPathError(`bad variable at ${i}`)
      while (j < src.length && (nameChar.test(src[j] as string) || (src[j] === ':' && nameStart.test(src[j + 1] ?? '')))) j++
      out.push({ t: 'var', v: src.slice(i + 1, j), pos: i }); i = j; continue
    }
    if (nameStart.test(c)) {
      let j = i
      while (j < src.length && nameChar.test(src[j] as string)) j++
      // a QName: prefix:local or prefix:*  (but not the axis separator '::')
      if (src[j] === ':' && src[j + 1] !== ':' && (nameStart.test(src[j + 1] ?? '') || src[j + 1] === '*')) {
        j++
        if (src[j] === '*') j++
        else while (j < src.length && nameChar.test(src[j] as string)) j++
      }
      out.push({ t: 'name', v: src.slice(i, j), pos: i }); i = j; continue
    }
    const two = src.slice(i, i + 2)
    if (['//', '!=', '<=', '>=', '<<', '>>', '::', '..'].includes(two)) { out.push({ t: 'op', v: two, pos: i }); i += 2; continue }
    if ('()[],|/@=<>+-*?.{}'.includes(c)) { out.push({ t: 'op', v: c, pos: i }); i++; continue }
    throw new XPathError(`unexpected character '${c}' at ${i}`)
  }
  return out
}

const VALUE_CMP = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'is'])

/** Parse an XPath expression into a tree. Throws XPathError on anything outside the subset. */
export function parseXPath(src: string): Ast {
  const toks = tokenize(src)
  let p = 0
  const peek = (o = 0): Tok | undefined => toks[p + o]
  const isOp = (v: string, o = 0): boolean => { const t = peek(o); return !!t && t.t === 'op' && t.v === v }
  const isName = (v: string, o = 0): boolean => { const t = peek(o); return !!t && t.t === 'name' && t.v === v }
  const next = (): Tok => { const t = toks[p++]; if (!t) throw new XPathError('unexpected end of expression'); return t }
  const expectOp = (v: string): void => { if (!isOp(v)) throw new XPathError(`expected '${v}' at ${peek()?.pos ?? 'end'}`); p++ }
  const expectName = (v: string): void => { if (!isName(v)) throw new XPathError(`expected '${v}' at ${peek()?.pos ?? 'end'}`); p++ }

  function expr(): Ast {
    const first = exprSingle()
    if (!isOp(',')) return first
    const items = [first]
    while (isOp(',')) { p++; items.push(exprSingle()) }
    return { k: 'seq', items }
  }
  function binds(sepWord: string): { v: string; in: Ast }[] {
    const out: { v: string; in: Ast }[] = []
    for (;;) {
      const t = next(); if (t.t !== 'var') throw new XPathError(`expected a variable at ${t.pos}`)
      expectName('in')
      out.push({ v: t.v, in: exprSingle() })
      if (isOp(',')) { p++; continue }
      if (isName(sepWord)) { p++; return out }
      throw new XPathError(`expected '${sepWord}' at ${peek()?.pos ?? 'end'}`)
    }
  }
  function exprSingle(): Ast {
    const t = peek()
    if (t?.t === 'name' && (t.v === 'some' || t.v === 'every') && peek(1)?.t === 'var') { p++; const b = binds('satisfies'); return { k: 'quant', q: t.v as 'some' | 'every', binds: b, sat: exprSingle() } }
    if (t?.t === 'name' && t.v === 'for' && peek(1)?.t === 'var') { p++; const b = binds('return'); return { k: 'for', binds: b, ret: exprSingle() } }
    if (t?.t === 'name' && t.v === 'if' && isOp('(', 1)) {
      p += 2; const cond = expr(); expectOp(')'); expectName('then'); const th = exprSingle(); expectName('else'); const el = exprSingle()
      return { k: 'if', cond, then: th, else: el }
    }
    return orExpr()
  }
  function orExpr(): Ast { const a = [andExpr()]; while (isName('or')) { p++; a.push(andExpr()) } return a.length === 1 ? a[0]! : { k: 'or', args: a } }
  function andExpr(): Ast { const a = [cmpExpr()]; while (isName('and')) { p++; a.push(cmpExpr()) } return a.length === 1 ? a[0]! : { k: 'and', args: a } }
  function cmpExpr(): Ast {
    const l = rangeExpr()
    const t = peek()
    if (t && ((t.t === 'op' && ['=', '!=', '<', '<=', '>', '>=', '<<', '>>'].includes(t.v)) || (t.t === 'name' && VALUE_CMP.has(t.v)))) {
      p++
      return { k: 'cmp', op: t.v as CmpOp, l, r: rangeExpr() }
    }
    return l
  }
  function rangeExpr(): Ast { const l = addExpr(); if (isName('to')) { p++; return { k: 'range', l, r: addExpr() } } return l }
  function addExpr(): Ast {
    let l = mulExpr()
    while (isOp('+') || isOp('-')) { const op = next().v as '+' | '-'; l = { k: 'arith', op, l, r: mulExpr() } }
    return l
  }
  function mulExpr(): Ast {
    let l = unionExpr()
    while (isOp('*') || isName('div') || isName('idiv') || isName('mod')) { const op = next().v as '*' | 'div' | 'idiv' | 'mod'; l = { k: 'arith', op, l, r: unionExpr() } }
    return l
  }
  function unionExpr(): Ast {
    const a = [setExpr()]
    while (isOp('|') || isName('union')) { p++; a.push(setExpr()) }
    return a.length === 1 ? a[0]! : { k: 'union', args: a }
  }
  function setExpr(): Ast {
    let l = typeExpr()
    while (isName('intersect') || isName('except')) { const op = next().v as 'intersect' | 'except'; l = { k: 'setop', op, l, r: typeExpr() } }
    return l
  }
  function typeName(): string {
    const t = next(); if (t.t !== 'name') throw new XPathError(`expected a type name at ${t.pos}`)
    let s = t.v
    if (isOp('(')) { p++; while (!isOp(')')) s += next().v; p++; s += '()' }
    if (isOp('?') || isOp('*') || isOp('+')) s += next().v
    return s
  }
  function typeExpr(): Ast {
    const a = unary()
    if (isName('instance') && isName('of', 1)) { p += 2; return { k: 'type', op: 'instance', a, type: typeName() } }
    if (isName('treat') && isName('as', 1)) { p += 2; return { k: 'type', op: 'treat', a, type: typeName() } }
    if (isName('castable') && isName('as', 1)) { p += 2; return { k: 'type', op: 'castable', a, type: typeName() } }
    if (isName('cast') && isName('as', 1)) { p += 2; return { k: 'type', op: 'cast', a, type: typeName() } }
    return a
  }
  function unary(): Ast {
    if (isOp('-')) { p++; return { k: 'neg', a: unary() } }
    if (isOp('+')) { p++; return unary() }
    return pathExpr()
  }
  function pathExpr(): Ast {
    if (isOp('/')) {
      p++
      // a lone '/' (the root) is followed by nothing a step can start with
      const t = peek()
      if (!t || (t.t === 'op' && !['@', '.', '..', '*', '(', '$'].includes(t.v)) || (t.t === 'name' && ['and', 'or', 'div', 'mod', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'then', 'else', 'return', 'satisfies'].includes(t.v) && !isOp('(', 1) && !isOp('/', 1) && !isOp('[', 1))) return { k: 'path', root: '/', steps: [] }
      return relPath('/')
    }
    if (isOp('//')) { p++; return relPath('//') }
    return relPath('')
  }
  function relPath(root: '' | '/' | '//'): Ast {
    const steps: Step[] = [step('')]
    while (isOp('/') || isOp('//')) { const sep = next().v as '/' | '//'; steps.push(step(sep)) }
    // a lone filter expression is just that expression
    if (root === '' && steps.length === 1 && steps[0]!.s === 'expr') {
      const s = steps[0]!
      return s.preds.length ? { k: 'filter', primary: s.expr, preds: s.preds } : s.expr
    }
    return { k: 'path', root, steps }
  }
  function preds(): Ast[] { const out: Ast[] = []; while (isOp('[')) { p++; out.push(expr()); expectOp(']') } return out }
  function step(sep: '/' | '//' | ''): Step {
    const t = peek()
    if (!t) throw new XPathError('unexpected end of expression (a step was expected)')
    if (t.t === 'op' && t.v === '..') { p++; return { s: 'axis', sep, axis: 'parent', test: { kind: 'kind', name: 'node' }, preds: preds() } }
    if (t.t === 'op' && t.v === '.') { p++; return { s: 'expr', sep, expr: { k: 'ctx' }, preds: preds() } }
    if (t.t === 'op' && t.v === '@') { p++; return { s: 'axis', sep, axis: 'attribute', test: nodeTest(), preds: preds() } }
    if (t.t === 'op' && t.v === '*') { p++; return { s: 'axis', sep, axis: 'child', test: { kind: 'name', name: '*' }, preds: preds() } }
    if (t.t === 'name' && AXES.has(t.v) && isOp('::', 1)) { p += 2; return { s: 'axis', sep, axis: t.v, test: nodeTest(), preds: preds() } }
    if (t.t === 'name' && KIND_TESTS.has(t.v) && isOp('(', 1)) return { s: 'axis', sep, axis: 'child', test: nodeTest(), preds: preds() }
    if (t.t === 'name' && !isOp('(', 1)) { p++; return { s: 'axis', sep, axis: 'child', test: { kind: 'name', name: t.v }, preds: preds() } }
    return { s: 'expr', sep, expr: primary(), preds: preds() }
  }
  function nodeTest(): NodeTest {
    const t = next()
    if (t.t === 'op' && t.v === '*') return { kind: 'name', name: '*' }
    if (t.t !== 'name') throw new XPathError(`expected a node test at ${t.pos}`)
    if (KIND_TESTS.has(t.v) && isOp('(')) { p++; let depth = 1; while (depth > 0) { const x = next(); if (x.t === 'op' && x.v === '(') depth++; if (x.t === 'op' && x.v === ')') depth-- } return { kind: 'kind', name: t.v } }
    return { kind: 'name', name: t.v }
  }
  function primary(): Ast {
    const t = next()
    if (t.t === 'str') return { k: 'lit', v: t.v }
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) }
    if (t.t === 'var') return { k: 'var', name: t.v }
    if (t.t === 'op' && t.v === '(') {
      if (isOp(')')) { p++; return { k: 'seq', items: [] } }
      const e = expr(); expectOp(')')
      return e
    }
    if (t.t === 'name' && isOp('(')) {
      p++
      const args: Ast[] = []
      if (!isOp(')')) { args.push(exprSingle()); while (isOp(',')) { p++; args.push(exprSingle()) } }
      expectOp(')')
      return { k: 'call', name: t.v, args }
    }
    throw new XPathError(`unexpected '${t.v}' at ${t.pos}`)
  }

  const out = expr()
  if (p !== toks.length) throw new XPathError(`unexpected '${toks[p]!.v}' at ${toks[p]!.pos}`)
  return out
}

/** Render a tree back to compact XPath (for reports; not byte-identical to the source). */
export function showXPath(a: Ast): string {
  switch (a.k) {
    case 'or': case 'and': return a.args.map(x => paren(x)).join(` ${a.k} `)
    case 'cmp': return `${paren(a.l)} ${a.op} ${paren(a.r)}`
    case 'arith': return `${paren(a.l)} ${a.op} ${paren(a.r)}`
    case 'neg': return `-${paren(a.a)}`
    case 'union': return a.args.map(showXPath).join(' | ')
    case 'setop': return `${paren(a.l)} ${a.op} ${paren(a.r)}`
    case 'range': return `${paren(a.l)} to ${paren(a.r)}`
    case 'path': return a.root + a.steps.map(s => s.sep + (s.s === 'axis' ? `${s.axis === 'child' ? '' : s.axis === 'attribute' ? '@' : s.axis === 'parent' ? '..' : `${s.axis}::`}${s.axis === 'parent' && s.test.kind === 'kind' ? '' : s.test.kind === 'name' ? s.test.name : `${s.test.name}()`}` : showXPath(s.expr)) + s.preds.map(x => `[${showXPath(x)}]`).join('')).join('')
    case 'filter': return `${paren(a.primary)}${a.preds.map(x => `[${showXPath(x)}]`).join('')}`
    case 'lit': return typeof a.v === 'number' ? String(a.v) : `'${a.v.replace(/'/g, "''")}'`
    case 'var': return `$${a.name}`
    case 'call': return `${a.name}(${a.args.map(showXPath).join(', ')})`
    case 'ctx': return '.'
    case 'if': return `if (${showXPath(a.cond)}) then ${showXPath(a.then)} else ${showXPath(a.else)}`
    case 'quant': return `${a.q} ${a.binds.map(b => `$${b.v} in ${showXPath(b.in)}`).join(', ')} satisfies ${showXPath(a.sat)}`
    case 'for': return `for ${a.binds.map(b => `$${b.v} in ${showXPath(b.in)}`).join(', ')} return ${showXPath(a.ret)}`
    case 'seq': return `(${a.items.map(showXPath).join(', ')})`
    case 'type': return `${paren(a.a)} ${a.op === 'instance' ? 'instance of' : `${a.op} as`} ${a.type}`
  }
}
const paren = (a: Ast): string => (['or', 'and', 'cmp', 'arith', 'if', 'quant', 'for', 'union'].includes(a.k) ? `(${showXPath(a)})` : showXPath(a))
