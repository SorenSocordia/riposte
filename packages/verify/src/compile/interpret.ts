/**
 * The meaning of an assert's XPath over the document structure (2026-10-03, the standards compiler). The parsed test is
 * interpreted symbolically, never run: paths become references to structure paths (with their predicates), arithmetic
 * becomes a numeric expression over those references, and the test becomes a condition (presence, a numeric comparison,
 * a string comparison or code-list membership, and/or/not). Whatever the interpreter cannot give a meaning to becomes an
 * `opaque` value carrying the reason, and the compiler reports the assert as uncompiled with that reason.
 */

import type { Ast, Step } from './xpath.js'
import { parseXPath } from './xpath.js'
import { hasPath, lastStep, parentPath, pathsEndingWith, type Structure } from './structure.js'
import type { Let, Schematron, XslFunction } from './schematron.js'

/** Why something has no compiled meaning: a category (for the report's counts) and a sentence. */
export interface Why { cat: string; detail: string }

/** A reference to one structure path, with the conditions its predicates put on it (already interpreted, absolute). */
export interface NodeRef {
  path: string
  conds: Cond[]
  /** a positional predicate ([1]) was applied on the way */
  first?: boolean
}

export type Num =
  | { k: 'val'; ref: NodeRef }
  | { k: 'sum'; ref: NodeRef }
  | { k: 'count'; ref: NodeRef }
  | { k: 'const'; v: number }
  | { k: 'op'; op: '+' | '-' | '*' | '/'; l: Num; r: Num }
  | { k: 'neg'; a: Num }
  /** round(a × 100) div 100: rounded to the cent */
  | { k: 'cent'; a: Num }
  | { k: 'round'; a: Num }
  | { k: 'abs'; a: Num }
  | { k: 'ifp'; guard: Cond; then: Num; else: Num }
  | { k: 'opaque'; why: Why }

export type Str = { k: 'lit'; v: string } | { k: 'val'; ref: NodeRef } | { k: 'opaque'; why: Why }

export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>='
export type Cond =
  | { k: 'true' } | { k: 'false' }
  | { k: 'present'; ref: NodeRef }
  | { k: 'cmp'; op: CmpOp; l: Num; r: Num }
  /** |val − exp| ≤ slack, compared exactly (u:slack) */
  | { k: 'slack'; exp: Num; val: Num; slack: number }
  | { k: 'scmp'; op: '=' | '!='; l: Str; r: Str }
  | { k: 'member'; s: Str; list: string[]; from: string; neg?: boolean }
  /** the value has no inner space (the code-list idiom's companion test) */
  | { k: 'nospace'; s: Str }
  | { k: 'and' | 'or'; args: Cond[] }
  | { k: 'not'; a: Cond }
  | { k: 'opaque'; why: Why }

export type Sym =
  | { t: 'nodes'; refs: NodeRef[]; unknown: string[] }
  | { t: 'num'; e: Num }
  | { t: 'bool'; c: Cond }
  | { t: 'str'; s: Str }
  | { t: 'seq'; items: Sym[] }
  | { t: 'opaque'; why: Why }

const opaque = (cat: string, detail: string): Sym => ({ t: 'opaque', why: { cat, detail } })
const isOpaque = (s: Sym): s is { t: 'opaque'; why: Why } => s.t === 'opaque'

const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
const EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
const INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
const CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
const CANON: Record<string, string> = { [CAC]: 'cac', [CBC]: 'cbc', [EXT]: 'ext' }

/** A name that only a credit note carries: known absent from an invoice, so a union alternative naming it is dropped. */
const creditNoteOnly = (step: string): boolean => /(^|:)(CreditNote|CreditNoteLine|CreditedQuantity|CreditNoteTypeCode)$/.test(step)

/** The element kind a structure path holds, by its UBL name: what a value of it can be compared as. */
export function kindOfPath(path: string): 'amount' | 'price' | 'quantity' | 'identifier' {
  const step = lastStep(path)
  if (step.startsWith('@')) return 'identifier'
  const local = step.replace(/^[\w-]+:/, '')
  if (local === 'PriceAmount') return 'price'
  if (/Amount$/.test(local)) return 'amount'
  if (/Quantity$/.test(local) || local === 'Percent' || local === 'MultiplierFactorNumeric') return 'quantity'
  return 'identifier'
}
const numericPath = (p: string): boolean => kindOfPath(p) !== 'identifier'

export interface InterpretEnv {
  structure: Structure
  sch: Schematron
  /** namespace prefixes (prefix → URI) the schematron declares */
  ns: Record<string, string>
}

interface Scope {
  node: NodeRef | null
  vars: Map<string, () => Sym>
}

export class Interpreter {
  private readonly root: string
  private readonly globalLets = new Map<string, Let>()
  private readonly globalMemo = new Map<string, Sym>()
  private depth = 0
  constructor(private readonly env: InterpretEnv) {
    this.root = `/${env.structure.root}`
    for (const l of env.sch.lets) this.globalLets.set(l.name, l)
  }

  /** A canonical step name for a QName as the schematron writes it ("cac:TaxTotal"), or the root's name, or undefined. */
  private canon(qname: string): { step: string } | { root: true } | { creditNote: true } | { unknownPrefix: string } {
    if (qname === '*') return { step: '*' }
    const i = qname.indexOf(':')
    if (i < 0) return { step: qname }
    const prefix = qname.slice(0, i), local = qname.slice(i + 1)
    const uri = this.env.ns[prefix] ?? this.env.sch.ns[prefix]
    if (uri === INVOICE) return local === this.env.structure.root ? { root: true } : { unknownPrefix: prefix }
    if (uri === CREDIT_NOTE) return { creditNote: true }
    const canon = uri ? CANON[uri] : undefined
    if (canon) return { step: `${canon}:${local}` }
    if (prefix === 'cac' || prefix === 'cbc' || prefix === 'ext') return { step: qname }
    return { unknownPrefix: prefix }
  }

  private rootScope(): Scope {
    const vars = new Map<string, () => Sym>()
    return { node: { path: this.root, conds: [] }, vars }
  }

  /** The value of a global let (evaluated once, at the document root). */
  private globalVar(name: string): Sym | undefined {
    if (this.globalMemo.has(name)) return this.globalMemo.get(name)
    const l = this.globalLets.get(name)
    if (!l) return undefined
    this.globalMemo.set(name, opaque('recursion', `let $${name} refers to itself`))
    const v = this.evalText(l.value, this.rootScope())
    this.globalMemo.set(name, v)
    return v
  }

  /** A scope for a rule: its context node and its lets (each evaluated in that context, in order, lazily). */
  ruleScope(node: NodeRef, lets: Let[]): Scope {
    const vars = new Map<string, () => Sym>()
    const scope: Scope = { node, vars }
    for (const l of lets) {
      let memo: Sym | undefined
      vars.set(l.name, () => (memo ??= this.evalText(l.value, scope)))
    }
    return scope
  }

  evalText(xpath: string, scope: Scope): Sym {
    let ast: Ast
    try { ast = parseXPath(xpath) } catch (e) { return opaque('xpath-not-parsed', (e as Error).message) }
    return this.ev(ast, scope)
  }

  /** Interpret one expression. */
  ev(a: Ast, sc: Scope): Sym {
    if (++this.depth > 200) { this.depth--; return opaque('too-deep', 'the expression nests too deeply') }
    try { return this.ev1(a, sc) } finally { this.depth-- }
  }

  private ev1(a: Ast, sc: Scope): Sym {
    switch (a.k) {
      case 'lit': return typeof a.v === 'number' ? { t: 'num', e: { k: 'const', v: a.v } } : { t: 'str', s: { k: 'lit', v: a.v } }
      case 'ctx': return sc.node ? { t: 'nodes', refs: [sc.node], unknown: [] } : opaque('no-context', 'the context item is undefined here')
      case 'var': {
        const local = sc.vars.get(a.name)
        if (local) return local()
        const g = this.globalVar(a.name)
        return g ?? opaque('unknown-variable', `$${a.name} is not declared`)
      }
      case 'seq': {
        const items = a.items.map(x => this.ev(x, sc))
        const op = items.find(isOpaque)
        if (op) return op
        // a sequence of node sets is their union
        if (items.length && items.every(i => i.t === 'nodes')) return { t: 'nodes', refs: items.flatMap(i => (i as { refs: NodeRef[] }).refs), unknown: items.flatMap(i => (i as { unknown: string[] }).unknown) }
        return { t: 'seq', items }
      }
      case 'union': {
        const parts = a.args.map(x => this.ev(x, sc))
        const op = parts.find(isOpaque)
        if (op) return op
        if (!parts.every(p => p.t === 'nodes')) return opaque('union', 'a union of values that are not nodes')
        return { t: 'nodes', refs: parts.flatMap(p => (p as { refs: NodeRef[] }).refs), unknown: parts.flatMap(p => (p as { unknown: string[] }).unknown) }
      }
      case 'path': return this.path(a.root, a.steps, sc)
      case 'filter': {
        const base = this.ev(a.primary, sc)
        return this.applyPreds(base, a.preds, sc)
      }
      case 'or': case 'and': {
        const args = a.args.map(x => this.toCond(this.ev(x, sc)))
        return { t: 'bool', c: { k: a.k, args } }
      }
      case 'cmp': return this.compare(a.op, this.ev(a.l, sc), this.ev(a.r, sc))
      case 'arith': {
        if (a.op === 'idiv' || a.op === 'mod') return opaque('arithmetic', `${a.op} is not in the declarative check language`)
        const l = this.toNum(this.ev(a.l, sc)), r = this.toNum(this.ev(a.r, sc))
        const op = a.op === 'div' ? '/' : a.op
        // round(E × 100) div 100: rounding to the cent
        if (op === '/' && r.k === 'const' && r.v === 100 && l.k === 'round') { const e = times100(l.a); if (e) return { t: 'num', e: { k: 'cent', a: e } } }
        return { t: 'num', e: { k: 'op', op, l, r } }
      }
      case 'neg': return { t: 'num', e: { k: 'neg', a: this.toNum(this.ev(a.a, sc)) } }
      case 'if': {
        const c = this.toCond(this.ev(a.cond, sc))
        const th = this.ev(a.then, sc), el = this.ev(a.else, sc)
        const sc0 = simplifyRoot(c, this.root)
        if (sc0.k === 'true') return th
        if (sc0.k === 'false') return el
        if (th.t === 'num' || el.t === 'num' || (th.t === 'nodes' && th.refs.length === 1 && numericPath(th.refs[0]!.path))) return { t: 'num', e: { k: 'ifp', guard: sc0, then: this.toNum(th), else: this.toNum(el) } }
        if (th.t === 'bool' || el.t === 'bool') return { t: 'bool', c: { k: 'or', args: [{ k: 'and', args: [sc0, this.toCond(th)] }, { k: 'and', args: [{ k: 'not', a: sc0 }, this.toCond(el)] }] } }
        return opaque('conditional-value', 'an if/then/else whose value is neither a number nor a condition')
      }
      case 'quant': return this.quant(a, sc)
      case 'for': return opaque('quantifier', 'a for … return expression')
      case 'range': return opaque('range', 'a range (to) expression')
      case 'setop': return opaque('set-operation', `${a.op}`)
      case 'type': return a.op === 'castable' || a.op === 'instance' ? opaque('format', `${a.op === 'castable' ? 'castable as' : 'instance of'} ${a.type}`) : this.ev(a.a, sc)
      case 'call': return this.call(a.name, a.args, sc)
    }
  }

  /** No step from the root to the path repeats (max ≤ 1); the dual cac:TaxTotal counts as once (its first instance). */
  private once(path: string): boolean {
    const parts = path.split('/').slice(1)
    for (let i = 2; i <= parts.length; i++) { const p = `/${parts.slice(0, i).join('/')}`; const row = this.env.structure.rows.get(p); if (row && row.card.max > 1 && p !== `${this.root}/cac:TaxTotal`) return false }
    return true
  }

  /** Every step from the root to the path is mandatory (min ≥ 1) and single. */
  private mandatory(path: string): boolean {
    const parts = path.split('/').slice(1)
    for (let i = 2; i <= parts.length; i++) { const row = this.env.structure.rows.get(`/${parts.slice(0, i).join('/')}`); if (!row || row.card.min < 1 || row.card.max > 1) return false }
    return true
  }

  private quant(a: Extract<Ast, { k: 'quant' }>, sc: Scope): Sym {
    if (a.binds.length !== 1) return opaque('quantifier', `${a.q} over several variables`)
    const b = a.binds[0]!
    const dom = this.ev(b.in, sc)
    if (isOpaque(dom)) return dom
    // over literal values: expand
    const lits = literalItems(dom)
    if (lits) {
      const parts = lits.map(v => { const vars = new Map(sc.vars); vars.set(b.v, () => ({ t: 'str', s: { k: 'lit', v } })); return this.toCond(this.ev(a.sat, { node: sc.node, vars })) })
      return { t: 'bool', c: { k: a.q === 'some' ? 'or' : 'and', args: parts } }
    }
    // over one node that occurs at most once: bind it
    if (dom.t === 'nodes' && dom.refs.length === 1 && dom.unknown.length === 0 && this.once(dom.refs[0]!.path)) {
      const ref = dom.refs[0]!
      const vars = new Map(sc.vars); vars.set(b.v, () => ({ t: 'nodes', refs: [ref], unknown: [] }))
      const sat = this.toCond(this.ev(a.sat, { node: sc.node, vars }))
      // a mandatory node is there in every invoice: the quantifier is its body (an extraction without it abstains on the body)
      if (this.mandatory(ref.path)) return { t: 'bool', c: sat }
      // every over an absent node holds; some over it does not
      return { t: 'bool', c: a.q === 'every' ? { k: 'or', args: [{ k: 'not', a: { k: 'present', ref } }, sat] } : { k: 'and', args: [{ k: 'present', ref }, sat] } }
    }
    return opaque('quantifier', `${a.q} $${b.v} over a sequence that may hold several items`)
  }

  // ── paths ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private path(root: '' | '/' | '//', steps: Step[], sc: Scope): Sym {
    let cur: NodeRef[]
    const unknown: string[] = []
    if (root === '/' || root === '//') cur = [{ path: '', conds: [] }] // the document node
    else { if (!sc.node) return opaque('no-context', 'a relative path with no context'); cur = [sc.node] }
    if (root === '/' && steps.length === 0) return { t: 'nodes', refs: [{ path: this.root, conds: [] }], unknown }
    let first = true
    for (const s of steps) {
      const sep = first ? (root === '//' ? '//' : root === '/' ? '/' : '') : s.sep
      first = false
      const next: NodeRef[] = []
      // '//' before an expression step ((a|b), f(x)): the step applies at every descendant-or-self node
      const bases = sep === '//' && s.s === 'expr' ? this.descendantsOrSelf(cur) : cur
      for (const base of bases) {
        const r = this.step(base, s, sep === '//' && s.s !== 'expr', sc)
        if (isOpaque(r)) return r
        if (r.t === 'bool' && bases.length === 1 && s === steps[steps.length - 1]) return r
        if (r.t !== 'nodes') {
          // a function step (xs:decimal(.)) maps each node to a value; keep the node, the value is its own
          if (r.t === 'num' && r.e.k === 'val') { next.push(r.e.ref); continue }
          if (r.t === 'str' && r.s.k === 'val') { next.push(r.s.ref); continue }
          return opaque('path', 'a path step that yields a value other than a node')
        }
        next.push(...r.refs)
        unknown.push(...r.unknown)
      }
      const expanded = bases !== cur
      cur = expanded ? dedupeRefs(next) : next
      if (expanded) unknown.length = 0 // tried at every node: a node where the step matches nothing is not an unknown path
    }
    return { t: 'nodes', refs: cur, unknown }
  }

  /** Every node at or below the given ones (the document node stands for the root and everything under it). */
  private descendantsOrSelf(refs: NodeRef[]): NodeRef[] {
    const out: NodeRef[] = []
    for (const b of refs) {
      const from = b.path === '' ? this.root : b.path
      out.push({ ...b, path: from })
      for (const k of this.env.structure.rows.keys()) if (k.startsWith(`${from}/`) && !lastStep(k).startsWith('@')) out.push({ ...b, path: k })
    }
    return out
  }

  /** One step from one base node. `desc` = the step follows '//' (descendant-or-self). */
  private step(base: NodeRef, s: Step, desc: boolean, sc: Scope): Sym {
    if (s.s === 'expr') {
      const r = this.ev(s.expr, { node: base, vars: sc.vars })
      return s.preds.length ? this.applyPreds(r, s.preds, sc) : r
    }
    const S = this.env.structure
    let paths: string[] = []
    const unknown: string[] = []
    const test = s.test
    const nameOf = (): { step: string } | { root: true } | { creditNote: true } | { unknownPrefix: string } | { kind: string } =>
      (test.kind === 'kind' ? { kind: test.name } : this.canon(test.name))
    const n = nameOf()
    if ('unknownPrefix' in n) return opaque('namespace', `the prefix ${n.unknownPrefix}: is not a UBL namespace this compiler maps`)
    if ('creditNote' in n) return { t: 'nodes', refs: [], unknown: [] } // a credit-note element: known absent from an invoice
    switch (s.axis) {
      case 'child': {
        if ('root' in n) { if (base.path === '') paths = [this.root]; break }
        if ('kind' in n) { if (n.kind === 'text' || n.kind === 'node') paths = [base.path]; else return opaque('path', `${n.kind}() step`); break }
        if (base.path === '' && !desc) { // the document node's child: the root only
          if (n.step === '*') paths = [this.root]
          break
        }
        if (desc) {
          const from = base.path === '' ? '' : base.path
          paths = n.step === '*' ? [...S.rows.keys()].filter(k => k.startsWith(`${from}/`) && !lastStep(k).startsWith('@')) : pathsEndingWith(S, [n.step]).filter(k => from === '' || k.startsWith(`${from}/`))
          if (!paths.length && !creditNoteOnly(n.step)) unknown.push(`${from}//${n.step}`)
          break
        }
        if (n.step === '*') { paths = [...S.rows.keys()].filter(k => parentPath(k) === base.path && !lastStep(k).startsWith('@')); break }
        const p = `${base.path}/${n.step}`
        if (hasPath(S, p)) paths = [p]
        else if (!creditNoteOnly(n.step)) unknown.push(p)
        break
      }
      case 'attribute': {
        if (!('step' in n)) return opaque('path', 'an attribute step without a name')
        const p = `${base.path}/@${n.step.replace(/^[\w-]+:/, '')}`
        if (hasPath(S, p)) paths = [p]; else unknown.push(p)
        break
      }
      case 'parent': {
        const p = parentPath(base.path)
        if (!p) return { t: 'nodes', refs: [], unknown: [] }
        if (test.kind === 'name' && 'step' in n && n.step !== '*' && lastStep(p) !== n.step) break
        paths = [p]; break
      }
      case 'self': {
        if (test.kind === 'kind' || ('step' in n && (n.step === '*' || lastStep(base.path) === n.step)) || ('root' in n && base.path === this.root)) paths = [base.path]
        break
      }
      case 'ancestor': case 'ancestor-or-self': {
        let p = s.axis === 'ancestor' ? parentPath(base.path) : base.path
        while (p) {
          if (('step' in n && (n.step === '*' || lastStep(p) === n.step)) || ('root' in n && p === this.root)) { paths = [p]; break }
          p = parentPath(p)
        }
        break
      }
      case 'following-sibling': case 'preceding-sibling': {
        if (!('step' in n)) return opaque('path', 'a sibling step without a name')
        const p = `${parentPath(base.path)}/${n.step}`
        if (hasPath(S, p)) paths = [p]; else unknown.push(p)
        break
      }
      case 'descendant': case 'descendant-or-self': {
        if (!('step' in n)) return opaque('path', 'a descendant step without a name')
        paths = pathsEndingWith(S, [n.step]).filter(k => k.startsWith(`${base.path}/`) || (s.axis === 'descendant-or-self' && k === base.path))
        break
      }
      default: return opaque('path', `the ${s.axis} axis`)
    }
    let refs: NodeRef[] = paths.map(p => ({ path: p, conds: [...base.conds], ...(base.first ? { first: true } : {}) }))
    if (s.preds.length) {
      const r = this.applyPreds({ t: 'nodes', refs, unknown }, s.preds, sc)
      return r
    }
    refs = refs.filter(Boolean)
    return { t: 'nodes', refs, unknown }
  }

  /** Apply predicates to a value: positional [1] marks the first instance; a boolean predicate becomes a condition on the node. */
  applyPreds(base: Sym, preds: Ast[], sc: Scope): Sym {
    if (isOpaque(base)) return base
    let cur: Sym = base
    for (const pr of preds) {
      if (cur.t === 'seq') {
        if (pr.k === 'lit' && typeof pr.v === 'number') { const it: Sym | undefined = cur.items[pr.v - 1]; cur = it ?? { t: 'seq', items: [] }; continue }
        return opaque('predicate', 'a predicate on a sequence of values')
      }
      if (cur.t !== 'nodes') {
        if (pr.k === 'lit' && typeof pr.v === 'number' && pr.v === 1) continue // [1] on a single value
        return opaque('predicate', 'a predicate on a value that is not a node')
      }
      if (pr.k === 'lit' && typeof pr.v === 'number') { cur = { ...cur, refs: cur.refs.map(r => ({ ...r, first: true })) }; continue }
      if (pr.k === 'call' && pr.name === 'last' && pr.args.length === 0) return opaque('predicate', 'a [last()] predicate')
      const refs: NodeRef[] = []
      for (const r of cur.refs) {
        const v = this.ev(pr, { node: r, vars: sc.vars })
        if (v.t === 'num' && v.e.k === 'const') { refs.push({ ...r, first: true }); continue }
        const c = this.toCond(v)
        refs.push({ ...r, conds: [...r.conds, c] })
      }
      cur = { t: 'nodes', refs, unknown: cur.unknown }
    }
    return cur
  }

  // ── conversions ───────────────────────────────────────────────────────────────────────────────────────────────────────
  toNum(s: Sym): Num {
    switch (s.t) {
      case 'num': return s.e
      case 'nodes': {
        if (s.unknown.length) return { k: 'opaque', why: { cat: 'path-not-in-structure', detail: `${s.unknown.join(', ')} is not in the structure table` } }
        if (s.refs.length === 1) return { k: 'val', ref: s.refs[0]! }
        if (s.refs.length === 0) return { k: 'opaque', why: { cat: 'empty', detail: 'a value of a node that cannot occur in an invoice' } }
        return { k: 'opaque', why: { cat: 'multi-valued', detail: `one value from several paths (${s.refs.map(r => r.path).join(', ')})` } }
      }
      case 'str': if (s.s.k === 'lit' && /^-?\d+(\.\d+)?$/.test(s.s.v.trim())) return { k: 'const', v: Number(s.s.v) }
        if (s.s.k === 'val') return { k: 'val', ref: s.s.ref }
        return { k: 'opaque', why: s.s.k === 'opaque' ? s.s.why : { cat: 'type', detail: `"${(s.s as { v: string }).v}" read as a number` } }
      case 'opaque': return { k: 'opaque', why: s.why }
      default: return { k: 'opaque', why: { cat: 'type', detail: `a ${s.t} read as a number` } }
    }
  }
  toStr(s: Sym): Str {
    switch (s.t) {
      case 'str': return s.s
      case 'nodes': {
        if (s.unknown.length) return { k: 'opaque', why: { cat: 'path-not-in-structure', detail: `${s.unknown.join(', ')} is not in the structure table` } }
        if (s.refs.length === 1) return { k: 'val', ref: s.refs[0]! }
        if (s.refs.length === 0) return { k: 'opaque', why: { cat: 'empty', detail: 'the string value of a node that cannot occur in an invoice' } }
        return { k: 'opaque', why: { cat: 'multi-valued', detail: `one string from several paths (${s.refs.map(r => r.path).join(', ')})` } }
      }
      case 'num': return s.e.k === 'const' ? { k: 'lit', v: String(s.e.v) } : s.e.k === 'val' ? { k: 'opaque', why: { cat: 'format', detail: 'string(number(…)): a test of whether a value is written as a number' } } : { k: 'opaque', why: { cat: 'type', detail: 'a computed number read as a string' } }
      case 'bool': return s.c.k === 'true' ? { k: 'lit', v: 'true' } : s.c.k === 'false' ? { k: 'lit', v: 'false' } : { k: 'opaque', why: { cat: 'type', detail: 'a condition read as a string' } }
      case 'opaque': return { k: 'opaque', why: s.why }
      default: return { k: 'opaque', why: { cat: 'type', detail: `a ${s.t} read as a string` } }
    }
  }
  /** The effective boolean value. */
  toCond(s: Sym): Cond {
    switch (s.t) {
      case 'bool': return s.c
      case 'nodes': {
        if (s.unknown.length && s.refs.length === 0) return { k: 'opaque', why: { cat: 'path-not-in-structure', detail: `${s.unknown.join(', ')} is not in the structure table` } }
        if (s.unknown.length) return { k: 'opaque', why: { cat: 'path-not-in-structure', detail: `${s.unknown.join(', ')} is not in the structure table` } }
        if (s.refs.length === 0) return { k: 'false' }
        if (s.refs.length === 1) return { k: 'present', ref: s.refs[0]! }
        return { k: 'or', args: s.refs.map(ref => ({ k: 'present', ref }) as Cond) }
      }
      case 'str': return s.s.k === 'val' ? { k: 'present', ref: s.s.ref } : s.s.k === 'lit' ? (s.s.v.length ? { k: 'true' } : { k: 'false' }) : { k: 'opaque', why: s.s.why }
      case 'num': return s.e.k === 'const' ? (s.e.v !== 0 ? { k: 'true' } : { k: 'false' }) : { k: 'opaque', why: { cat: 'type', detail: 'a number used as a condition' } }
      case 'seq': return s.items.length === 0 ? { k: 'false' } : { k: 'opaque', why: { cat: 'type', detail: 'a sequence used as a condition' } }
      case 'opaque': return { k: 'opaque', why: s.why }
    }
  }

  // ── comparisons ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private compare(op0: string, l: Sym, r: Sym): Sym {
    if (op0 === 'is' || op0 === '<<' || op0 === '>>') return opaque('node-comparison', `the ${op0} operator`)
    const op = (({ eq: '=', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=' } as Record<string, CmpOp>)[op0] ?? op0) as CmpOp
    if (isOpaque(l)) return l
    if (isOpaque(r)) return r
    // two literals: a constant
    if (l.t === 'str' && l.s.k === 'lit' && r.t === 'str' && r.s.k === 'lit' && (op === '=' || op === '!=')) return { t: 'bool', c: { k: (l.s.v === r.s.v) === (op === '=') ? 'true' : 'false' } }
    const knownAbsent = (s: Sym): boolean => s.t === 'nodes' && s.refs.length === 0 && s.unknown.length === 0
    if (knownAbsent(l) || knownAbsent(r)) return { t: 'bool', c: { k: 'false' } }
    // a node set or value against a list of literals: membership (general comparison is existential)
    const rl = literalItems(r), ll = literalItems(l)
    if (rl && rl.length !== 1 && op === '=' && l.t === 'str' && l.s.k === 'lit') return { t: 'bool', c: { k: rl.includes(l.s.v) ? 'true' : 'false' } }
    if (ll && ll.length !== 1 && op === '=' && r.t === 'str' && r.s.k === 'lit') return { t: 'bool', c: { k: ll.includes(r.s.v) ? 'true' : 'false' } }
    if (rl && rl.length !== 1 && (op === '=')) return { t: 'bool', c: { k: 'member', s: this.toStr(l), list: rl, from: 'a sequence of literals' } }
    if (ll && ll.length !== 1 && (op === '=')) return { t: 'bool', c: { k: 'member', s: this.toStr(r), list: ll, from: 'a sequence of literals' } }
    if ((rl && rl.length !== 1) || (ll && ll.length !== 1)) return opaque('comparison', `${op} against a sequence of literals`)
    // booleans (true()/false()) against a node: its string value
    if (l.t === 'bool' || r.t === 'bool') {
      const b = (l.t === 'bool' ? l : r) as { t: 'bool'; c: Cond }, o = l.t === 'bool' ? r : l
      if ((b.c.k === 'true' || b.c.k === 'false') && o.t === 'nodes') {
        if (op !== '=' && op !== '!=') return opaque('comparison', `${op} on a boolean`)
        return { t: 'bool', c: { k: 'scmp', op, l: this.toStr(o), r: { k: 'lit', v: b.c.k } } }
      }
      return opaque('comparison', 'a comparison of conditions')
    }
    const numericSide = (s: Sym): boolean => s.t === 'num' || (s.t === 'nodes' && s.refs.length > 0 && s.refs.every(x => numericPath(x.path))) || (s.t === 'str' && s.s.k === 'val' && numericPath(s.s.ref.path))
    const literalNumber = (s: Sym): boolean => s.t === 'str' && s.s.k === 'lit' && /^-?\d+(\.\d+)?$/.test(s.s.v.trim())
    const isStrish = (s: Sym): boolean => s.t === 'str' || (s.t === 'nodes' && !numericSide(s)) || (s.t === 'seq' && literalItems(s)?.length === 1)
    if ((numericSide(l) && (numericSide(r) || literalNumber(r))) || (numericSide(r) && literalNumber(l))) {
      // a node set of several paths compared as numbers: existential, not one value
      if ((l.t === 'nodes' && l.refs.length > 1) || (r.t === 'nodes' && r.refs.length > 1)) return opaque('multi-valued', 'a numeric comparison over several paths at once')
      return { t: 'bool', c: { k: 'cmp', op: op as CmpOp, l: this.toNum(l), r: this.toNum(r) } }
    }
    if (isStrish(l) && isStrish(r)) {
      if (op !== '=' && op !== '!=') return opaque('comparison', `${op} between strings (dates or codes)`)
      // normalize-space(X) != '': X is present and not blank; = '': absent or blank
      const emptyLit = (s: Sym): boolean => s.t === 'str' && s.s.k === 'lit' && s.s.v === ''
      const nodeOf = (s: Sym): NodeRef | undefined => (s.t === 'nodes' && s.refs.length === 1 && !s.unknown.length ? s.refs[0] : s.t === 'str' && s.s.k === 'val' ? s.s.ref : undefined)
      if (emptyLit(r) || emptyLit(l)) {
        const n = nodeOf(emptyLit(r) ? l : r)
        if (n) return { t: 'bool', c: op === '!=' ? { k: 'present', ref: n } : { k: 'not', a: { k: 'present', ref: n } } }
      }
      if ((l.t === 'nodes' && l.refs.length > 1) || (r.t === 'nodes' && r.refs.length > 1)) return opaque('multi-valued', 'a string comparison over several paths at once')
      const ls = l.t === 'seq' ? { k: 'lit' as const, v: literalItems(l)![0]! } : this.toStr(l)
      const rs = r.t === 'seq' ? { k: 'lit' as const, v: literalItems(r)![0]! } : this.toStr(r)
      return { t: 'bool', c: { k: 'scmp', op, l: ls, r: rs } }
    }
    if ((l.t === 'num' && isStrish(r)) || (r.t === 'num' && isStrish(l))) return opaque('comparison', 'a number compared with a string')
    return opaque('comparison', `a comparison of a ${l.t} and a ${r.t}`)
  }

  // ── functions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  private call(name: string, args: Ast[], sc: Scope): Sym {
    const arg = (i: number): Sym => (args[i] ? this.ev(args[i]!, sc) : (sc.node ? { t: 'nodes', refs: [sc.node], unknown: [] } : opaque('no-context', `${name}() with no context`)))
    switch (name) {
      case 'xs:decimal': case 'number': case 'xs:double': case 'xs:float': case 'xs:integer': {
        const a = arg(0)
        if (isOpaque(a)) return a
        return { t: 'num', e: this.toNum(a) }
      }
      case 'string': case 'normalize-space': case 'xs:string': case 'upper-case': case 'lower-case': case 'normalize-unicode': {
        const a = arg(0)
        if (isOpaque(a)) return a
        if (a.t === 'nodes' && a.refs.length === 0 && a.unknown.length === 0) return { t: 'str', s: { k: 'lit', v: '' } } // the string value of nothing
        if (a.t === 'str' && a.s.k === 'lit') return { t: 'str', s: { k: 'lit', v: name === 'normalize-space' ? a.s.v.replace(/\s+/g, ' ').trim() : name === 'upper-case' ? a.s.v.toUpperCase() : name === 'lower-case' ? a.s.v.toLowerCase() : a.s.v } }
        if (a.t === 'nodes' && a.refs.length > 1) return opaque('multi-valued', `${name}() of several paths`)
        return { t: 'str', s: this.toStr(a) }
      }
      case 'exists': { const a = arg(0); return isOpaque(a) ? a : { t: 'bool', c: this.toCond(a.t === 'nodes' ? a : a) } }
      case 'empty': { const a = arg(0); return isOpaque(a) ? a : { t: 'bool', c: { k: 'not', a: this.toCond(a) } } }
      case 'boolean': { const a = arg(0); return isOpaque(a) ? a : { t: 'bool', c: this.toCond(a) } }
      case 'not': { const a = arg(0); return isOpaque(a) ? { t: 'bool', c: { k: 'not', a: { k: 'opaque', why: a.why } } } : { t: 'bool', c: { k: 'not', a: this.toCond(a) } } }
      case 'true': return { t: 'bool', c: { k: 'true' } }
      case 'false': return { t: 'bool', c: { k: 'false' } }
      case 'count': {
        const a = arg(0)
        if (isOpaque(a)) return a
        if (a.t !== 'nodes' || a.unknown.length || a.refs.length !== 1) return opaque('cardinality', 'count() of several paths, or of a value')
        return { t: 'num', e: { k: 'count', ref: a.refs[0]! } }
      }
      case 'sum': {
        const a = arg(0)
        if (isOpaque(a)) return a
        if (a.t !== 'nodes') return opaque('arithmetic', 'sum() of values that are not nodes')
        if (a.unknown.length) return opaque('path-not-in-structure', `${a.unknown.join(', ')} is not in the structure table`)
        if (a.refs.length === 0) return { t: 'num', e: { k: 'const', v: 0 } }
        const parts: Num[] = a.refs.map(ref => ({ k: 'sum', ref }))
        return { t: 'num', e: parts.reduce((x, y) => ({ k: 'op', op: '+', l: x, r: y })) }
      }
      case 'round': case 'round-half-to-even': {
        const a = arg(0)
        if (isOpaque(a)) return a
        const n = this.toNum(a)
        if (args.length === 2) {
          const d = this.ev(args[1]!, sc)
          if (d.t === 'num' && d.e.k === 'const' && d.e.v === 2) return { t: 'num', e: { k: 'cent', a: n } }
          return opaque('arithmetic', `${name}() to other than two decimals`)
        }
        return { t: 'num', e: { k: 'round', a: n } }
      }
      case 'abs': { const a = arg(0); return isOpaque(a) ? a : { t: 'num', e: { k: 'abs', a: this.toNum(a) } } }
      case 'concat': {
        const parts = args.map((_, i) => arg(i))
        const lits = parts.map(p => (p.t === 'str' && p.s.k === 'lit' ? p.s.v : p.t === 'num' && p.e.k === 'const' ? String(p.e.v) : undefined))
        if (lits.every(x => x !== undefined)) return { t: 'str', s: { k: 'lit', v: lits.join('') } }
        return opaque('string-function', 'concat() of a document value')
      }
      case 'contains': {
        const hay = arg(0)
        if (isOpaque(hay)) return hay
        const idiom = args[1]
        if (hay.t === 'str' && hay.s.k === 'lit' && idiom && idiom.k === 'call' && idiom.name === 'concat' && idiom.args.length === 3) {
          const a0 = this.ev(idiom.args[0]!, sc), a2 = this.ev(idiom.args[2]!, sc)
          const isSpace = (x: Sym): boolean => x.t === 'str' && x.s.k === 'lit' && x.s.v === ' '
          if (isSpace(a0) && isSpace(a2)) {
            const v = this.ev(idiom.args[1]!, sc)
            if (isOpaque(v)) return v
            return { t: 'bool', c: { k: 'member', s: this.toStr(v), list: hay.s.v.split(/\s+/).filter(Boolean), from: 'a code list in the schematron' } }
          }
        }
        const needle = arg(1)
        if (isOpaque(needle)) return needle
        // contains(normalize-space(X), ' '): X has an inner space
        if (needle.t === 'str' && needle.s.k === 'lit' && needle.s.v === ' ' && (hay.t === 'str' || hay.t === 'nodes')) return { t: 'bool', c: { k: 'not', a: { k: 'nospace', s: this.toStr(hay) } } }
        // the code-list idiom: contains(' A B C ', concat(' ', normalize-space(X), ' '))
        const listText = hay.t === 'str' && hay.s.k === 'lit' ? hay.s.v : undefined
        const inner = args[1]
        if (listText !== undefined && inner && inner.k === 'call' && inner.name === 'concat' && inner.args.length === 3) {
          const a0 = this.ev(inner.args[0]!, sc), a2 = this.ev(inner.args[2]!, sc)
          const isSpace = (x: Sym): boolean => x.t === 'str' && x.s.k === 'lit' && x.s.v === ' '
          if (isSpace(a0) && isSpace(a2)) {
            const v = this.ev(inner.args[1]!, sc)
            if (isOpaque(v)) return v
            const list = listText.split(/\s+/).filter(Boolean)
            return { t: 'bool', c: { k: 'member', s: this.toStr(v), list, from: 'a code list in the schematron' } }
          }
        }
        return opaque('string-function', 'contains() other than the code-list idiom')
      }
      case 'tokenize': {
        const a = arg(0)
        if (isOpaque(a)) return a
        const pat = args[1] ? this.ev(args[1], sc) : undefined
        if (a.t === 'str' && a.s.k === 'lit' && pat?.t === 'str' && pat.s.k === 'lit') {
          let re: RegExp
          try { re = new RegExp(pat.s.v.replace(/\\s/g, '\\s')) } catch { return opaque('regex', `tokenize() with the pattern ${pat.s.v}`) }
          return { t: 'seq', items: a.s.v.split(re).filter(x => x !== '').map(v => ({ t: 'str', s: { k: 'lit', v } }) as Sym) }
        }
        return opaque('regex', 'tokenize() of a document value')
      }
      case 'matches': case 'replace': return opaque('regex', `${name}() (a regular expression over text)`)
      case 'string-length': case 'substring-after': case 'substring-before': case 'substring': case 'translate': return opaque('format', `${name}() (a test of how a value is written)`)
      case 'starts-with': case 'ends-with': return opaque('string-function', `${name}()`)
      case 'xs:date': case 'xs:dateTime': case 'current-date': case 'current-dateTime': return opaque('date', `${name}() (date arithmetic or comparison)`)
      case 'name': case 'local-name': case 'node-name': return opaque('context-by-name', `${name}() (a test on an element's name)`)
      case 'distinct-values': case 'index-of': case 'last': case 'position': case 'string-to-codepoints': case 'reverse': case 'string-join': case 'codepoints-to-string':
        return opaque('function', `${name}()`)
      default: {
        const fn = this.env.sch.functions.get(name)
        if (fn) return this.inline(fn, args, sc)
        return opaque('function', `${name}() is not a function this compiler knows`)
      }
    }
  }

  /** A function the schematron defines (an XSLT function with params and a single xsl:sequence): its body, with the arguments bound. */
  private inline(fn: XslFunction, args: Ast[], sc: Scope): Sym {
    if (!fn.select || fn.params.length !== args.length) return opaque('function', `${fn.name}() (a function the schematron defines, not a single sequence)`)
    const vars = new Map(sc.vars)
    fn.params.forEach((p, i) => { const v = this.ev(args[i]!, sc); vars.set(p, () => v) })
    const inner: Scope = { node: sc.node, vars }
    for (const v of fn.vars) { let memo: Sym | undefined; const sel = v.select; vars.set(v.name, () => (memo ??= this.evalText(sel, inner))) }
    const out = this.evalText(fn.select, inner)
    if (isOpaque(out)) return opaque('function', `${fn.name}(): ${out.why.detail}`)
    if (out.t === 'bool') {
      const c = simplify(out.c)
      if (hasOpaque(c)) return opaque('function', `${fn.name}(): ${firstOpaque(c)!.detail}`)
      return { t: 'bool', c }
    }
    return out
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The literal strings of a value (a string literal, a number literal, or a sequence of them), else undefined. */
function dedupeRefs(refs: NodeRef[]): NodeRef[] {
  const seen = new Set<string>()
  return refs.filter(r => { const k = refKey(r); if (seen.has(k)) return false; seen.add(k); return true })
}

export function literalItems(s: Sym): string[] | undefined {
  if (s.t === 'str' && s.s.k === 'lit') return [s.s.v]
  if (s.t === 'num' && s.e.k === 'const') return [String(s.e.v)]
  if (s.t === 'seq') {
    const out: string[] = []
    for (const i of s.items) { const x = literalItems(i); if (!x) return undefined; out.push(...x) }
    return out
  }
  return undefined
}

/** E when n is E × 100 (written E * 100 or E * 10 * 10), else undefined. */
function times100(n: Num): Num | undefined {
  const factors: number[] = []
  let cur = n
  while (cur.k === 'op' && cur.op === '*' && cur.r.k === 'const') { factors.push(cur.r.v); cur = cur.l }
  if (!factors.length) return undefined
  const prod = factors.reduce((a, b) => a * b, 1)
  return prod === 100 ? cur : undefined
}

/** `present(/Invoice)` is true in an invoice profile; replace it so `if (/ubl:Invoice) then … else …` picks its branch. */
function simplifyRoot(c: Cond, root: string): Cond {
  if (c.k === 'present' && c.ref.path === root && c.ref.conds.length === 0) return { k: 'true' }
  return simplify(c)
}

export function hasOpaque(c: Cond): boolean { return firstOpaque(c) !== undefined }
export function firstOpaque(c: Cond): Why | undefined {
  switch (c.k) {
    case 'opaque': return c.why
    case 'and': case 'or': for (const a of c.args) { const w = firstOpaque(a); if (w) return w } return undefined
    case 'not': return firstOpaque(c.a)
    case 'cmp': return numOpaque(c.l) ?? numOpaque(c.r) ?? refsOpaque(numRefs(c.l)) ?? refsOpaque(numRefs(c.r))
    case 'slack': return numOpaque(c.exp) ?? numOpaque(c.val)
    case 'scmp': return strOpaque(c.l) ?? strOpaque(c.r)
    case 'member': case 'nospace': return strOpaque(c.s)
    case 'present': return refsOpaque([c.ref])
    default: return undefined
  }
}
const strOpaque = (s: Str): Why | undefined => (s.k === 'opaque' ? s.why : s.k === 'val' ? refsOpaque([s.ref]) : undefined)
function numOpaque(n: Num): Why | undefined {
  switch (n.k) {
    case 'opaque': return n.why
    case 'op': return numOpaque(n.l) ?? numOpaque(n.r)
    case 'neg': case 'cent': case 'round': case 'abs': return numOpaque(n.a)
    case 'ifp': return firstOpaque(n.guard) ?? numOpaque(n.then) ?? numOpaque(n.else)
    default: return undefined
  }
}
/** The opaque reason inside a reference's own predicates, if any. */
function refsOpaque(refs: NodeRef[]): Why | undefined {
  for (const r of refs) for (const c of r.conds) { const w = firstOpaque(c); if (w) return w }
  return undefined
}
export function numRefs(n: Num): NodeRef[] {
  switch (n.k) {
    case 'val': case 'sum': case 'count': return [n.ref]
    case 'op': return [...numRefs(n.l), ...numRefs(n.r)]
    case 'neg': case 'cent': case 'round': case 'abs': return numRefs(n.a)
    case 'ifp': return [...numRefs(n.then), ...numRefs(n.else)]
    default: return []
  }
}

/** Push negations inward, flatten and/or, drop true/false, recognise u:slack's shape and the code-list idiom. */
export function simplify(c: Cond): Cond {
  switch (c.k) {
    case 'not': {
      const a = simplify(c.a)
      if (a.k === 'true') return { k: 'false' }
      if (a.k === 'false') return { k: 'true' }
      if (a.k === 'not') return a.a
      if (a.k === 'and') return simplify({ k: 'or', args: a.args.map(x => ({ k: 'not', a: x }) as Cond) })
      if (a.k === 'or') return simplify({ k: 'and', args: a.args.map(x => ({ k: 'not', a: x }) as Cond) })
      if (a.k === 'scmp') return { ...a, op: a.op === '=' ? '!=' : '=' }
      if (a.k === 'member') return { ...a, neg: !a.neg }
      if (a.k === 'cmp') return { ...a, op: ({ '=': '!=', '!=': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' } as const)[a.op] }
      return { k: 'not', a }
    }
    case 'and': case 'or': {
      const flat: Cond[] = []
      for (const x of c.args.map(simplify)) { if (x.k === c.k) flat.push(...x.args); else flat.push(x) }
      const unit = c.k === 'and' ? 'true' : 'false', zero = c.k === 'and' ? 'false' : 'true'
      if (flat.some(x => x.k === zero)) return { k: zero }
      let args = flat.filter(x => x.k !== unit)
      if (c.k === 'and') {
        // u:slack: (A + s >= B) and (A − s <= B)  →  |B − A| ≤ s
        const sl = slackOf(args)
        if (sl) args = [...args.filter(x => !sl.used.includes(x)), sl.cond]
        // the code-list idiom's companion: no inner space, alongside membership of the same value
        args = args.filter(x => !(x.k === 'nospace' && args.some(y => y.k === 'member' && sameStr(y.s, x.s))))
      } else {
        // X = 'a' or X = 'b' …  →  membership
        const groups = new Map<string, { s: Str; vals: string[]; items: Cond[] }>()
        for (const x of args) {
          if (x.k === 'scmp' && x.op === '=' && x.l.k === 'val' && x.r.k === 'lit') { const key = refKey(x.l.ref); const g = groups.get(key) ?? { s: x.l, vals: [], items: [] }; g.vals.push(x.r.v); g.items.push(x); groups.set(key, g) }
          if (x.k === 'member' && x.s.k === 'val') { const key = refKey(x.s.ref); const g = groups.get(key) ?? { s: x.s, vals: [], items: [] }; g.vals.push(...x.list); g.items.push(x); groups.set(key, g) }
        }
        for (const g of groups.values()) if (g.items.length > 1) args = [...args.filter(x => !g.items.includes(x)), { k: 'member', s: g.s, list: [...new Set(g.vals)], from: 'a disjunction of equalities' }]
      }
      if (args.length === 0) return { k: unit }
      if (args.length === 1) return args[0]!
      return { k: c.k, args }
    }
    default: return c
  }
}

const sameStr = (a: Str, b: Str): boolean => (a.k === 'val' && b.k === 'val' ? refKey(a.ref) === refKey(b.ref) : a.k === 'lit' && b.k === 'lit' ? a.v === b.v : false)
export const refKey = (r: NodeRef): string => `${r.path}${r.first ? '[1]' : ''}${r.conds.length ? `{${r.conds.map(condKey).join('&')}}` : ''}`
export function condKey(c: Cond): string {
  switch (c.k) {
    case 'present': return `P(${refKey(c.ref)})`
    case 'not': return `!${condKey(c.a)}`
    case 'and': case 'or': return `${c.k}(${c.args.map(condKey).join(',')})`
    case 'scmp': return `S(${strKey(c.l)}${c.op}${strKey(c.r)})`
    case 'member': return `M(${strKey(c.s)}∈${c.list.length})`
    case 'nospace': return `NS(${strKey(c.s)})`
    case 'cmp': return `C(${numKey(c.l)}${c.op}${numKey(c.r)})`
    case 'slack': return `SL(${numKey(c.exp)},${numKey(c.val)},${c.slack})`
    case 'opaque': return `?(${c.why.cat})`
    default: return c.k
  }
}
const strKey = (s: Str): string => (s.k === 'lit' ? `'${s.v}'` : s.k === 'val' ? refKey(s.ref) : '?')
export function numKey(n: Num): string {
  switch (n.k) {
    case 'val': return refKey(n.ref)
    case 'sum': return `Σ${refKey(n.ref)}`
    case 'count': return `#${refKey(n.ref)}`
    case 'const': return String(n.v)
    case 'op': return `(${numKey(n.l)}${n.op}${numKey(n.r)})`
    case 'neg': return `-${numKey(n.a)}`
    case 'cent': return `cent(${numKey(n.a)})`
    case 'round': return `round(${numKey(n.a)})`
    case 'abs': return `abs(${numKey(n.a)})`
    case 'ifp': return `if(${condKey(n.guard)},${numKey(n.then)},${numKey(n.else)})`
    case 'opaque': return '?'
  }
}

/** (A + s >= B) and (A − s <= B), in either order, with s a constant: the slack test. */
function slackOf(args: Cond[]): { cond: Cond; used: Cond[] } | undefined {
  const cmps = args.filter((x): x is Extract<Cond, { k: 'cmp' }> => x.k === 'cmp')
  for (const a of cmps) for (const b of cmps) {
    if (a === b) continue
    if (a.op !== '>=' || b.op !== '<=') continue
    if (a.l.k !== 'op' || a.l.op !== '+' || a.l.r.k !== 'const') continue
    if (b.l.k !== 'op' || b.l.op !== '-' || b.l.r.k !== 'const') continue
    if (a.l.r.v !== b.l.r.v || numKey(a.l.l) !== numKey(b.l.l) || numKey(a.r) !== numKey(b.r)) continue
    return { cond: { k: 'slack', exp: a.l.l, val: a.r, slack: a.l.r.v }, used: [a, b] }
  }
  return undefined
}

/** Resolve a rule's context (an XSLT match pattern) to the structure paths it matches, each with its predicates' conditions. */
export function resolveContext(ip: Interpreter, ast: Ast, structure: Structure, ns: Record<string, string>): { refs: NodeRef[]; dropped: number } | { why: Why } {
  const out: NodeRef[] = []
  let dropped = 0
  const missing: string[] = []
  const alts: Ast[] = ast.k === 'union' ? ast.args : [ast]
  for (const alt of alts) {
    // a parenthesized union with predicates: (A | B)[p]
    if (alt.k === 'filter') {
      const base = resolveContext(ip, alt.primary, structure, ns)
      if ('why' in base) return base
      dropped += base.dropped
      const scope = ip.ruleScope({ path: `/${structure.root}`, conds: [] }, [])
      const r = ip.applyPreds({ t: 'nodes', refs: base.refs, unknown: [] }, alt.preds, scope)
      if (r.t !== 'nodes') return { why: r.t === 'opaque' ? r.why : { cat: 'context', detail: 'a context predicate that is not a node test' } }
      out.push(...r.refs)
      continue
    }
    if (alt.k !== 'path') return { why: { cat: 'context', detail: 'a rule context that is not a path pattern' } }
    const scope = ip.ruleScope({ path: `/${structure.root}`, conds: [] }, [])
    if (alt.root === '' && alt.steps.some(s => s.s === 'expr')) {
      // (/A[p]/B | /C)/D: the expression steps are absolute paths; evaluate from the document node
      const r = ip.ev(alt, ip.ruleScope({ path: '', conds: [] }, []))
      if (r.t === 'opaque') return { why: r.why }
      if (r.t !== 'nodes') return { why: { cat: 'context', detail: 'a context that is not a node set' } }
      if (!r.refs.length) { dropped++; continue }
      out.push(...r.refs)
      continue
    }
    if (alt.root === '/' || alt.root === '//') {
      const r = ip.ev(alt, scope)
      if (r.t === 'opaque') return { why: r.why }
      if (r.t !== 'nodes') return { why: { cat: 'context', detail: 'a context that is not a node set' } }
      if (r.unknown.length && !r.refs.length) return { why: { cat: 'path-not-in-structure', detail: `${r.unknown.join(', ')} is not in the structure table` } }
      if (!r.refs.length) dropped++
      out.push(...r.refs)
      continue
    }
    // a relative pattern matches its last steps anywhere: find the candidates, then evaluate the pattern from each one's
    // ancestor where the pattern starts (so predicates on every step are applied in their own context)
    const names: string[] = []
    for (const s of alt.steps) {
      if (s.s !== 'axis' || (s.axis !== 'child' && s.axis !== 'attribute') || s.test.kind !== 'name') return { why: { cat: 'context', detail: 'a context pattern with a step this compiler does not match' } }
      if (s.sep === '//') return { why: { cat: 'context', detail: 'a context pattern with // inside it' } }
      const qn = s.test.name
      const i = qn.indexOf(':')
      const uri = i >= 0 ? (ns[qn.slice(0, i)] ?? '') : ''
      if (uri === CREDIT_NOTE) { names.length = 0; break }
      if (uri === INVOICE) { names.push(structure.root); continue }
      const canon = i >= 0 ? (CANON[uri] ?? qn.slice(0, i)) : ''
      names.push(s.axis === 'attribute' ? `@${qn.slice(i + 1)}` : qn === '*' ? '*' : `${canon}:${qn.slice(i + 1)}`)
    }
    if (!names.length) { dropped++; continue }
    const candidates = pathsEndingWith(structure, names)
    if (!candidates.length) {
      if (names.some(creditNoteOnly)) { dropped++; continue }
      if (alts.length > 1) { missing.push(names.join('/')); continue }
      return { why: { cat: 'path-not-in-structure', detail: `no structure path ends with ${names.join('/')}` } }
    }
    for (const c of candidates) {
      const startDepth = c.split('/').length - names.length // the ancestor the pattern's first step is a child of
      const anchor = c.split('/').slice(0, startDepth).join('/') || ''
      const r = ip.ev({ k: 'path', root: '', steps: alt.steps.map(s => ({ ...s, sep: s.sep === '' ? '' : s.sep })) }, ip.ruleScope({ path: anchor, conds: [] }, []))
      if (r.t === 'opaque') return { why: r.why }
      if (r.t === 'nodes') out.push(...r.refs.filter(x => x.path === c))
    }
  }
  if (!out.length && missing.length) return { why: { cat: 'path-not-in-structure', detail: `no structure path ends with ${missing.join(', ')}` } }
  return { refs: out, dropped }
}
