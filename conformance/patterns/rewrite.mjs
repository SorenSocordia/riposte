// SPDX-License-Identifier: Apache-2.0
// The catalogue of rewrites of riposte.pattern/0.1.0 (SPEC.md, "Rewrites"): how a JavaScript pattern outside the dialect, or
// read under flags the dialect does not have, is written into it with the same meaning. Run once, when a pattern is ported;
// the result is a dialect pattern both translators read. Node.js 20 or later: a rewrite reproduces what JavaScript's own
// RegExp means by the source, so it asks this Node's RegExp, and vectors.json proves each rewrite on its probes.
//
//   import { rewrite } from './rewrite.mjs'
//   rewrite('(?<!(?:USD|\\$)\\s{0,2})\\b\\d+', 'i')    // { source, flags, applied: ['R-LB-SPLIT'] } or null
//
//   R-LB-SPLIT  a lookbehind whose alternatives match different numbers of characters, or that holds a bounded quantifier,
//               is written as one lookbehind per width: (?<!A|B) as (?<!A)(?<!B), (?<=A|B) as (?:(?<=A)|(?<=B))
//   R-UFOLD     a pattern read under JavaScript's u and i flags (Unicode case folding) is written without the i flag, every
//               letter and class with the characters that fold to it spelled out: s as [sSſ], \w and \b over
//               [A-Za-z0-9_ſK], \p{Lu} as every letter that folds to a capital
import { parse, translate, PatternRefused, loadTable } from './translate.mjs'

const MAX = 0x10ffff
const MAX_BRANCHES = 256

// ── ranges (as in translate.mjs) ───────────────────────────────────────────────────────────────────────────────────────────
function norm(ranges) {
  const r = ranges.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out = []
  for (const [a, b] of r) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
function complement(ranges) {
  const out = []
  let next = 0
  for (const [a, b] of norm(ranges)) { if (a > next) out.push([next, a - 1]); next = b + 1 }
  if (next <= MAX) out.push([next, MAX])
  return out
}
const union = (...rs) => norm(rs.flat())
const minus = (a, b) => intersect(a, complement(b))
function intersect(a, b) {
  const out = []
  let i = 0, j = 0
  const A = norm(a), B = norm(b)
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1])
    if (lo <= hi) out.push([lo, hi])
    if (A[i][1] < B[j][1]) i++
    else j++
  }
  return out
}
const size = (r) => r.reduce((n, [a, b]) => n + b - a + 1, 0)
const printable = (r) => intersect(r, [[0xd800, 0xdfff]]).length === 0
const hex4 = (cp) => cp.toString(16).toUpperCase().padStart(4, '0')
const escD = (cp) => ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? String.fromCharCode(cp)
  : cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : `\\u${hex4(cp)}`)
const rangesD = (r) => r.map(([a, b]) => (a === b ? escD(a) : `${escD(a)}-${escD(b)}`)).join('')

// ── R-LB-SPLIT ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function fixedWidth(node) {
  const w = widthOf(node)
  return w[0] === w[1] ? w[0] : -1
}
function widthOf(node) {
  switch (node.type) {
    case 'char': case 'set': return [1, 1]
    case 'assert': case 'look': return [0, 0]
    case 'group': return widthOf(node.body)
    case 'seq': return node.items.reduce(([a, b], n) => { const [c, d] = widthOf(n); return [a + c, b + d] }, [0, 0])
    case 'alt': { const w = node.items.map(widthOf); return [Math.min(...w.map((x) => x[0])), Math.max(...w.map((x) => x[1]))] }
    case 'quant': { const [a, b] = widthOf(node.body); return [a * node.min, node.max === Infinity ? (b === 0 ? 0 : Infinity) : b * node.max] }
    default: throw new Error(node.type)
  }
}
/** The fixed-width branches a node can match, as source texts; null when it has an unbounded part, a capture, or too many. */
function branches(node, src) {
  const w = fixedWidth(node)
  if (w >= 0) return [{ text: src.slice(node.at, node.end), w }]
  const product = (lists) => lists.reduce((acc, list) => {
    if (!acc || !list) return null
    const out = []
    for (const a of acc) for (const b of list) out.push({ text: a.text + b.text, w: a.w + b.w })
    return out.length > MAX_BRANCHES ? null : out
  }, [{ text: '', w: 0 }])
  switch (node.type) {
    case 'seq': return product(node.items.map((n) => branches(n, src)))
    case 'alt': { const all = node.items.map((n) => branches(n, src)); return all.some((x) => !x) ? null : all.flat() }
    case 'group': return node.capture ? null : branches(node.body, src)
    case 'quant': {
      if (node.max === Infinity) return null
      const body = branches(node.body, src)
      if (!body) return null
      const out = []
      for (let k = node.min; k <= node.max; k++) {
        const p = product(Array.from({ length: k }, () => body))
        if (!p) return null
        out.push(...p)
      }
      return out.length > MAX_BRANCHES ? null : out
    }
    default: return null
  }
}
function firstVariableLookbehind(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'look' && node.behind && fixedWidth(node.body) < 0) return node
  for (const k of ['body', 'items']) {
    const v = node[k]
    if (Array.isArray(v)) { for (const x of v) { const f = firstVariableLookbehind(x); if (f) return f } } else if (v) { const f = firstVariableLookbehind(v); if (f) return f }
  }
  return null
}
export function splitLookbehinds(source, flags) {
  let src = source
  const groupCount = parse(source, flags, { allow: ['lookbehind-width'] }).groups
  for (let round = 0; round < 16; round++) {
    const { tree, groups: now } = parse(src, flags, { allow: ['lookbehind-width'] })
    if (now !== groupCount) return null // a capturing group would be copied, and every later group renumbered
    const lb = firstVariableLookbehind(tree)
    if (!lb) return src
    const bs = branches(lb.body, src)
    if (!bs) return null
    const byWidth = new Map()
    for (const b of bs) byWidth.set(b.w, [...(byWidth.get(b.w) ?? []), b.text])
    const groups = [...byWidth.entries()].sort((a, b) => a[0] - b[0]).map(([, texts]) => [...new Set(texts)].join('|'))
    const text = lb.negate ? groups.map((g) => `(?<!${g})`).join('') : `(?:${groups.map((g) => `(?<=${g})`).join('|')})`
    src = src.slice(0, lb.at) + text + src.slice(lb.end)
  }
  return null
}

// ── R-UFOLD: JavaScript's u and i flags, spelled out ──────────────────────────────────────────────────────────────────────
let foldClasses = null
/** The classes of characters JavaScript's u and i flags read as one (simple case folding), from this Node's RegExp. */
export function caseClasses(table = loadTable()) {
  if (foldClasses) return foldClasses
  const cand = new Set()
  for (const [a, b] of table.cased) for (let cp = a; cp <= b; cp++) cand.add(cp)
  for (let cp = 0x41; cp <= 0x5a; cp++) { cand.add(cp); cand.add(cp + 32) }
  const parent = new Map([...cand].map((c) => [c, c]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)) }
  for (const c of cand) {
    const s = String.fromCodePoint(c)
    for (const t of [s.toUpperCase(), s.toLowerCase()]) if ([...t].length === 1) join(c, t.codePointAt(0))
  }
  const comps = new Map()
  for (const c of cand) { const r = find(c); comps.set(r, [...(comps.get(r) ?? []), c]) }
  const esc = (cp) => `\\u{${cp.toString(16)}}`
  const out = []
  for (const comp of comps.values()) {
    const left = new Set(comp)
    while (left.size) {
      const [c] = left
      const re = new RegExp(`^${esc(c)}$`, 'ui')
      const cls = [...left].filter((d) => re.test(String.fromCodePoint(d)))
      for (const d of cls) left.delete(d)
      if (cls.length > 1) out.push(cls.sort((x, y) => x - y))
    }
  }
  foldClasses = out
  return out
}
function closure(ranges, classes) {
  const add = []
  for (const cls of classes) if (cls.some((c) => inR(ranges, c))) for (const c of cls) add.push([c, c])
  return union(ranges, add)
}
function inR(r, cp) { let lo = 0, hi = r.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cp < r[m][0]) hi = m - 1; else if (cp > r[m][1]) lo = m + 1; else return true } return false }

/** A code point set written in the dialect with no i flag: one class, or a class with a lookahead taking some out. */
function printSet(target, table) {
  if (target.length === 0) return '(?!)'
  if (printable(target) && target.length <= 64) return `[${rangesD(target)}]`
  const comp = complement(target)
  if (comp.length === 0) return '[\\s\\S]'
  if (printable(comp) && comp.length <= 64) return `[^${rangesD(comp)}]`
  const names = Object.keys(table.classes)
  let best = null
  for (let mask = 1; mask < 1 << names.length; mask++) {
    const pick = names.filter((_, k) => mask & (1 << k))
    const h = union(...pick.map((n) => table.classes[n]))
    for (const negated of [false, true]) {
      const H = negated ? complement(h) : h
      const E = minus(target, H), D = minus(H, target)
      if (!printable(E) || !printable(D)) continue
      const cost = size(E) + size(D)
      if (!best || cost < best.cost) best = { cost, pick, negated, E, D }
    }
  }
  if (!best) return printable(target) ? `[${rangesD(target)}]` : printable(comp) ? `[^${rangesD(comp)}]` : null
  const P =`[${best.negated ? '^' : ''}${best.pick.map((n) => `\\p{${n}}`).join('')}]`
  const core = best.D.length ? `(?![${rangesD(best.D)}])${P}` : P
  return best.E.length ? `(?:${core}|[${rangesD(best.E)}])` : core
}

const WORD = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]
const SPACE = [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]]
const DOT_EXCLUDES = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]]

/** What a class item means under JavaScript's u and i flags, before folding (ECMA-262 WordCharacters, CharacterComplement). */
function uiItem(item, table, wordUi) {
  if (item.dot) return DOT_EXCLUDES // the dot is a negated set of the line terminators
  if (item.lo !== undefined) return [[item.lo, item.hi]]
  switch (item.esc) {
    case 'd': return [[0x30, 0x39]]
    case 'D': return complement([[0x30, 0x39]])
    case 'w': return wordUi
    case 'W': return complement(wordUi)
    case 's': return SPACE
    case 'S': return complement(SPACE)
    case 'p': return table.classes[item.prop]
    case 'P': return complement(table.classes[item.prop])
    default: throw new Error(`unknown item ${JSON.stringify(item)}`)
  }
}
export function unicodeFold(source, table = loadTable()) {
  const { tree } = parse(source, '', { table, allow: ['lookbehind-width'] })
  const classes = caseClasses(table)
  const wordUi = closure(WORD, classes)
  const w = printSet(wordUi, table)
  const boundary = `(?:(?<=${w})(?!${w})|(?<!${w})(?=${w}))`
  const notBoundary = `(?:(?<=${w})(?=${w})|(?<!${w})(?!${w}))`
  const q = (n) => (n.min === 0 && n.max === Infinity ? '*' : n.min === 1 && n.max === Infinity ? '+' : n.min === 0 && n.max === 1 ? '?'
    : n.max === Infinity ? `{${n.min},}` : n.min === n.max ? `{${n.min}}` : `{${n.min},${n.max}}`) + (n.lazy ? '?' : '')
  let failed = false
  const pr = (n) => {
    switch (n.type) {
      case 'alt': return n.items.map(pr).join('|')
      case 'seq': return n.items.map(pr).join('')
      case 'char': { const t = closure([[n.cp, n.cp]], classes); return size(t) === 1 ? source.slice(n.at, n.end) : (printSet(t, table) ?? ((failed = true), '')) }
      case 'set': {
        const content = union(...n.items.map((it) => uiItem(it, table, wordUi)))
        const folded = closure(content, classes)
        const target = n.negated ? complement(folded) : folded
        return printSet(target, table) ?? ((failed = true), '')
      }
      case 'group': return `(${n.capture ? '' : '?:'}${pr(n.body)})`
      case 'look': return `(?${n.behind ? '<' : ''}${n.negate ? '!' : '='}${pr(n.body)})`
      case 'assert': return n.kind === 'b' ? boundary : n.kind === 'B' ? notBoundary : n.kind
      case 'quant': return `${pr(n.body)}${q(n)}`
      default: throw new Error(n.type)
    }
  }
  const out = pr(tree)
  return failed ? null : out
}

/**
 * Brings a JavaScript regex literal's source and flags into the dialect. Returns { source, flags, applied } with the rewrites
 * applied (none when it is in the dialect as written, its g and u flags set aside: the dialect reads code points and a search
 * is a call's business), or null when no rewrite of the catalogue brings it in.
 */
export function rewrite(source, jsFlags = '', options = {}) {
  const table = options.table ?? loadTable()
  const i = jsFlags.includes('i')
  const applied = []
  let src = source
  let flags = i ? 'i' : ''
  if (options.unicodeFold === true && i && jsFlags.includes('u')) {
    const f = unicodeFold(src, table)
    if (f === null) return null
    src = f; flags = ''; applied.push('R-UFOLD')
  }
  for (let round = 0; round < 3; round++) {
    try {
      translate(src, flags, { table })
      return { source: src, flags, applied }
    } catch (e) {
      if (!(e instanceof PatternRefused)) throw e
      if (e.code === 'lookbehind-width' && !applied.includes('R-LB-SPLIT')) {
        const s2 = splitLookbehinds(src, flags)
        if (s2 === null) return null
        src = s2; applied.push('R-LB-SPLIT'); continue
      }
      if ((e.code === 'cased-class-fold' || e.code === 'case-fold') && i && jsFlags.includes('u') && !applied.includes('R-UFOLD')) {
        const f = unicodeFold(src, table)
        if (f === null) return null
        src = f; flags = ''; applied.push('R-UFOLD')
        continue
      }
      return null
    }
  }
  return null
}
