// SPDX-License-Identifier: Apache-2.0
// riposte.pattern/0.1.0: the pattern dialect (SPEC.md in this folder), read into JavaScript. Node.js 20 or later, no
// dependencies. translate.py reads the same grammar into Python's standard `re`; vectors.json is the contract both answer.
//
//   import { translate, compile, test, firstMatch } from './translate.mjs'
//   const t = translate('\\bwire\\s+details\\b', 'i')   // { source, flags: 'u', usesTable, ... } or throws PatternRefused
//   test(compile('\\p{L}+', ''), 'abc')                  // 'match' | 'no match' | "can't tell"
//
// Command line:
//   node translate.mjs <pattern> [flags]                 prints the RegExp source and flags as JSON
//   node translate.mjs <pattern> [flags] --test <text>   prints match, no match or can't tell
// Exit 0 translated, or the text matches; 1 the text does not match; 2 can't tell; 3 refused (the position and the reason
// are printed), or a usage error.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DIALECT = 'riposte.pattern/0.1.0'
export const TABLE_FILE = new URL('./unicode-classes.json', import.meta.url)
const MAX_CODE_POINT = 0x10ffff
const MAX_COUNT = 1000

/** The reasons a pattern is refused, by code. Both translators use these words. */
export const REASONS = {
  usage: 'the pattern and its flags must be strings',
  flag: 'a flag other than i is outside the dialect',
  'outside-plane': 'a lone surrogate, or a character outside the Basic Multilingual Plane written as itself (write \\u{...}), is outside the dialect\'s pattern text',
  backreference: 'a backreference is outside the dialect: JavaScript matches an unset group as empty, Python fails',
  'named-group': 'a named group is outside the dialect: the two languages spell it differently',
  'group-syntax': 'this group syntax is outside the dialect (only (...), (?:...), (?=...), (?!...), (?<=...) and (?<!...))',
  property: 'this property class is outside the dialect: only the classes of the pinned table (L, Lu, Ll, N, Mn)',
  escape: 'this escape is outside the dialect: the two languages read it differently, or no pack pattern uses it',
  'lookbehind-width': 'a lookbehind must match a fixed number of characters: Python refuses any other',
  'quantified-assertion': 'a quantifier on an assertion is outside the dialect',
  'nothing-to-repeat': 'a quantifier with nothing to repeat',
  count: 'a count must be at most 1000, with the lower bound not above the upper',
  brace: 'a lone {, } or ] is outside the dialect: escape it',
  'class-range': 'a class range must run between two characters, low to high',
  'empty-class': 'an empty class, [] or [^], is outside the dialect',
  unclosed: 'a group or a class is not closed, or a ) has no group',
  'trailing-backslash': 'the pattern ends in a backslash',
  'case-fold': 'a character outside ASCII that has another case, under the i flag: the dialect folds ASCII letters only',
  'cased-class-fold': 'the class Lu or Ll under the i flag: JavaScript\'s Unicode mode reads either case, the dialect one',
}

export class PatternRefused extends Error {
  constructor(code, at) {
    super(`refused${at === null ? '' : ` at ${at}`}: ${REASONS[code]}`)
    this.name = 'PatternRefused'
    this.code = code
    this.at = at
  }
}

let defaultTable = null
/** The pinned class table (unicode-classes.json), read once. */
export function loadTable(url = TABLE_FILE) {
  if (url === TABLE_FILE && defaultTable) return defaultTable
  const t = JSON.parse(readFileSync(url, 'utf8'))
  if (url === TABLE_FILE) defaultTable = t
  return t
}

// ── ranges: sorted, merged lists of [lo, hi] code points ──────────────────────────────────────────────────────────────────
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
  for (const [a, b] of norm(ranges)) {
    if (a > next) out.push([next, a - 1])
    next = b + 1
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT])
  return out
}
function intersects(ranges, lo, hi) {
  return ranges.some(([a, b]) => a <= hi && b >= lo)
}
function inRanges(ranges, cp) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < ranges[mid][0]) hi = mid - 1
    else if (cp > ranges[mid][1]) lo = mid + 1
    else return true
  }
  return false
}
/** Adds the other case of every ASCII letter in the ranges (the dialect's i flag). */
function asciiFold(ranges) {
  const add = []
  for (const [a, b] of ranges) {
    const ua = Math.max(a, 0x41), ub = Math.min(b, 0x5a)
    if (ua <= ub) add.push([ua + 32, ub + 32])
    const la = Math.max(a, 0x61), lb = Math.min(b, 0x7a)
    if (la <= lb) add.push([la - 32, lb - 32])
  }
  return norm([...ranges, ...add])
}

const DIGIT = [[0x30, 0x39]]
const WORD = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]
/** ECMAScript's WhiteSpace and LineTerminator, written out: the dialect's \s on every reader. */
export const SPACE = [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]]
const DOT_EXCLUDES = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]]
const SYNTAX = '^$\\.*+?()[]{}|'
const QUANT = /\{([0-9]+)(,([0-9]*))?\}/y
const PROPERTY = /[pP]\{([A-Za-z_=]+)\}/y
const HEX4 = /u([0-9A-Fa-f]{4})/y
const BRACED = /u\{([0-9A-Fa-f]{1,6})\}/y

// ── the parser: one pass over the pattern text; every node keeps the position it starts at ─────────────────────────────────
/**
 * Parses a pattern in the dialect. Returns the tree; throws PatternRefused with the code and the position (an index into
 * the pattern text, which holds no character outside the Basic Multilingual Plane, so JavaScript and Python count alike).
 */
export function parse(source, flags = '', options = {}) {
  if (typeof source !== 'string' || typeof flags !== 'string') throw new PatternRefused('usage', null)
  if (flags !== '' && flags !== 'i') throw new PatternRefused('flag', null)
  const table = options.table ?? loadTable()
  const allow = new Set(options.allow ?? [])
  const fold = flags === 'i'
  const cased = table.cased
  const s = source
  let i = 0
  let groups = 0
  let usesTable = false

  const ch = () => (i < s.length ? s[i] : '')
  const refuse = (code, pos = i) => { throw new PatternRefused(code, pos) }
  const plain = (pos) => {
    const c = s.charCodeAt(pos)
    if (c >= 0xd800 && c <= 0xdfff) refuse('outside-plane', pos)
    return c
  }
  const checkFold = (lo, hi, pos) => {
    if (fold && hi > 0x7f && intersects(cased, Math.max(lo, 0x80), hi)) refuse('case-fold', pos)
  }

  function quantifierAhead() {
    // a {n}, {n,} or {n,m} at i: returns [min, max, length] or null
    QUANT.lastIndex = i
    const m = QUANT.exec(s)
    if (!m) return null
    const min = Number(m[1])
    const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3])
    return [min, max, m[0].length]
  }

  function disjunction() {
    const start = i
    const alts = [alternative()]
    while (ch() === '|') { i++; alts.push(alternative()) }
    return alts.length === 1 ? alts[0] : { type: 'alt', at: start, end: i, items: alts }
  }
  function alternative() {
    const start = i
    const items = []
    while (i < s.length && ch() !== '|' && ch() !== ')') items.push(term())
    return { type: 'seq', at: start, end: i, items }
  }
  function term() {
    const start = i
    const c = ch()
    let atom
    if (c === '^' || c === '$') { i++; return noQuantifier({ type: 'assert', at: start, end: i, kind: c }) }
    if (c === '\\' && (s[i + 1] === 'b' || s[i + 1] === 'B')) { i += 2; return noQuantifier({ type: 'assert', at: start, end: i, kind: s[i - 1] }) }
    if (c === '(') {
      if (s.startsWith('(?=', i) || s.startsWith('(?!', i) || s.startsWith('(?<=', i) || s.startsWith('(?<!', i)) {
        const behind = s[i + 2] === '<'
        const negate = s[behind ? i + 3 : i + 2] === '!'
        i += behind ? 4 : 3
        const body = disjunction()
        if (ch() !== ')') refuse('unclosed', start)
        i++
        const node = { type: 'look', at: start, end: i, behind, negate, body }
        if (behind && !allow.has('lookbehind-width')) { const [lo, hi] = width(body); if (lo !== hi) refuse('lookbehind-width', start) }
        return noQuantifier(node)
      }
      if (s.startsWith('(?:', i)) {
        i += 3
        const body = disjunction()
        if (ch() !== ')') refuse('unclosed', start)
        i++
        atom = { type: 'group', at: start, capture: false, body }
      } else if (s[i + 1] === '?') {
        if (s[i + 2] === '<' && /[A-Za-z_$]/.test(s[i + 3] ?? '')) refuse('named-group', start)
        refuse('group-syntax', start)
      } else {
        i++
        const index = ++groups
        const body = disjunction()
        if (ch() !== ')') refuse('unclosed', start)
        i++
        atom = { type: 'group', at: start, capture: true, index, body }
      }
    } else if (c === '[') {
      atom = charClass()
    } else if (c === '.') {
      i++
      atom = { type: 'set', at: start, negated: true, ranges: DOT_EXCLUDES, table: false, items: [{ dot: true }] }
    } else if (c === '*' || c === '+' || c === '?') {
      refuse('nothing-to-repeat')
    } else if (c === '{') {
      refuse(quantifierAhead() ? 'nothing-to-repeat' : 'brace')
    } else if (c === '}' || c === ']') {
      refuse('brace')
    } else if (c === '\\') {
      atom = atomEscape()
    } else {
      const cp = plain(i)
      checkFold(cp, cp, i)
      i++
      atom = { type: 'char', at: start, cp }
    }
    atom.end = i
    return quantified(atom)
  }
  function noQuantifier(node) {
    const c = ch()
    if (c === '*' || c === '+' || c === '?' || (c === '{' && quantifierAhead())) refuse('quantified-assertion')
    return node
  }
  function quantified(atom) {
    const c = ch()
    let min, max
    const qStart = i
    if (c === '*') { min = 0; max = Infinity; i++ }
    else if (c === '+') { min = 1; max = Infinity; i++ }
    else if (c === '?') { min = 0; max = 1; i++ }
    else if (c === '{') {
      const q = quantifierAhead()
      if (!q) refuse('brace')
      ;[min, max] = q
      if (min > MAX_COUNT || (max !== Infinity && (max > MAX_COUNT || max < min))) refuse('count')
      i += q[2]
    } else return atom
    let lazy = false
    if (ch() === '?') { lazy = true; i++ }
    const n = ch()
    if (n === '*' || n === '+' || n === '?' || (n === '{' && quantifierAhead())) refuse('nothing-to-repeat')
    return { type: 'quant', at: qStart, end: i, min, max, lazy, body: atom }
  }
  /** \d \D \w \W \s \S \p{X} \P{X} at i (after the backslash): the class's ranges and whether the table supplied them. */
  function classEscape(start) {
    const e = s[i]
    if (e === 'd' || e === 'D') { i++; return { ranges: e === 'd' ? DIGIT : complement(DIGIT), table: false, item: { esc: e } } }
    if (e === 'w' || e === 'W') { i++; return { ranges: e === 'w' ? WORD : complement(WORD), table: false, item: { esc: e } } }
    if (e === 's' || e === 'S') { i++; return { ranges: e === 's' ? SPACE : complement(SPACE), table: false, item: { esc: e } } }
    if (e === 'p' || e === 'P') {
      PROPERTY.lastIndex = i
      const m = PROPERTY.exec(s)
      if (!m || !Object.prototype.hasOwnProperty.call(table.classes, m[1])) refuse('property', start)
      if (fold && (m[1] === 'Lu' || m[1] === 'Ll')) refuse('cased-class-fold', start)
      i += m[0].length
      usesTable = true
      const r = table.classes[m[1]]
      return { ranges: e === 'p' ? r : complement(r), table: true, item: { esc: e, prop: m[1] } }
    }
    return null
  }
  /** n r t uXXXX, a syntax character, / or - at i (after the backslash): a code point, or a refusal. */
  function charEscape(start) {
    const e = s[i]
    if (e === undefined) refuse('trailing-backslash', start)
    if (e === 'n') { i++; return 0x0a }
    if (e === 'r') { i++; return 0x0d }
    if (e === 't') { i++; return 0x09 }
    if (e === 'u') {
      const re = s[i + 1] === '{' ? BRACED : HEX4
      re.lastIndex = i
      const m = re.exec(s)
      if (!m) refuse('escape', start)
      const cp = parseInt(m[1], 16)
      if (cp > MAX_CODE_POINT) refuse('escape', start)
      if (cp >= 0xd800 && cp <= 0xdfff) refuse('outside-plane', start)
      i += m[0].length
      return cp
    }
    if (e >= '1' && e <= '9') refuse('backreference', start)
    if (e === 'k') refuse('backreference', start)
    if (SYNTAX.includes(e) || e === '/' || e === '-') { plain(i); i++; return e.charCodeAt(0) }
    plain(i)
    refuse('escape', start)
  }
  function atomEscape() {
    const start = i
    i++
    if (i >= s.length) refuse('trailing-backslash', start)
    const k = classEscape(start)
    if (k) return { type: 'set', at: start, negated: false, ranges: k.ranges, table: k.table, items: [k.item] }
    const cp = charEscape(start)
    checkFold(cp, cp, start)
    return { type: 'char', at: start, cp }
  }
  function charClass() {
    const start = i
    i++
    let negated = false
    if (ch() === '^') { negated = true; i++ }
    if (ch() === ']') refuse('empty-class', start)
    const parts = []
    const items = []
    let table_ = false
    const classAtom = () => {
      const aStart = i
      if (i >= s.length) refuse('unclosed', start)
      if (ch() === '\\') {
        i++
        if (i >= s.length) refuse('trailing-backslash', aStart)
        const k = classEscape(aStart)
        if (k) { if (k.table) table_ = true; return { set: k.ranges, at: aStart, item: k.item } }
        if (s[i] === 'b') refuse('escape', aStart)
        return { cp: charEscape(aStart), at: aStart }
      }
      const cp = plain(i)
      i++
      return { cp, at: aStart }
    }
    while (ch() !== ']') {
      if (i >= s.length) refuse('unclosed', start)
      const a = classAtom()
      if (ch() === '-' && s[i + 1] !== ']' && i + 1 < s.length) {
        i++
        const b = classAtom()
        if (a.set || b.set || a.cp > b.cp) refuse('class-range', a.at)
        checkFold(a.cp, b.cp, a.at)
        parts.push([a.cp, b.cp])
        items.push({ lo: a.cp, hi: b.cp })
      } else if (a.set) {
        parts.push(...a.set)
        items.push(a.item)
      } else {
        checkFold(a.cp, a.cp, a.at)
        parts.push([a.cp, a.cp])
        items.push({ lo: a.cp, hi: a.cp })
      }
    }
    i++
    return { type: 'set', at: start, end: i, negated, ranges: norm(parts), table: table_, items }
  }

  const tree = disjunction()
  if (i < s.length) refuse('unclosed', i)
  return { tree, fold, groups, usesTable }
}

/** [min, max] characters a node matches (max may be Infinity). */
export function width(node) {
  switch (node.type) {
    case 'char': case 'set': return [1, 1]
    case 'assert': case 'look': return [0, 0]
    case 'group': return width(node.body)
    case 'seq': return node.items.reduce(([a, b], n) => { const [c, d] = width(n); return [a + c, b + d] }, [0, 0])
    case 'alt': { const w = node.items.map(width); return [Math.min(...w.map((x) => x[0])), Math.max(...w.map((x) => x[1]))] }
    case 'quant': { const [a, b] = width(node.body); return [a * node.min, node.max === Infinity ? (b === 0 ? 0 : Infinity) : b * node.max] }
    default: throw new Error(`unknown node ${node.type}`)
  }
}

// ── emitting JavaScript (u flag: code points; no i flag: case is written out) ────────────────────────────────────────────────
const hex = (cp, n) => cp.toString(16).toUpperCase().padStart(n, '0')
function escJs(cp) {
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return String.fromCharCode(cp)
  return cp <= 0xffff ? `\\u${hex(cp, 4)}` : `\\u{${hex(cp, 1)}}`
}
const NEVER = '(?!)'
function setJs(ranges, negated) {
  if (ranges.length === 0) return negated ? `[${escJs(0)}-${escJs(MAX_CODE_POINT)}]` : NEVER
  if (negated && ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === MAX_CODE_POINT) return NEVER
  return `[${negated ? '^' : ''}${ranges.map(([a, b]) => (a === b ? escJs(a) : `${escJs(a)}-${escJs(b)}`)).join('')}]`
}
function emitJs(node, fold) {
  switch (node.type) {
    case 'alt': return node.items.map((n) => emitJs(n, fold)).join('|')
    case 'seq': return node.items.map((n) => emitJs(n, fold)).join('')
    case 'char': {
      const cp = node.cp
      if (fold && ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a))) return setJs(asciiFold([[cp, cp]]), false)
      return escJs(cp)
    }
    case 'set': return setJs(fold ? asciiFold(node.ranges) : node.ranges, node.negated)
    case 'group': return `(${node.capture ? '' : '?:'}${emitJs(node.body, fold)})`
    case 'look': return `(?${node.behind ? '<' : ''}${node.negate ? '!' : '='}${emitJs(node.body, fold)})`
    case 'assert': return node.kind === 'b' ? '\\b' : node.kind === 'B' ? '\\B' : node.kind
    case 'quant': {
      const q = node.min === 0 && node.max === Infinity ? '*' : node.min === 1 && node.max === Infinity ? '+'
        : node.min === 0 && node.max === 1 ? '?' : node.max === Infinity ? `{${node.min},}`
          : node.min === node.max ? `{${node.min}}` : `{${node.min},${node.max}}`
      return `${emitJs(node.body, fold)}${q}${node.lazy ? '?' : ''}`
    }
    default: throw new Error(`unknown node ${node.type}`)
  }
}

/**
 * Translates a dialect pattern into a JavaScript RegExp source and flags. Throws PatternRefused when the pattern is not in
 * the dialect. `usesTable` says the pattern names a class of the pinned table: such a pattern answers can't tell on a text
 * holding a code point outside the table's repertoire (test() and firstMatch() do this; a caller compiling `source` itself
 * must do the same).
 */
export function translate(source, flags = '', options = {}) {
  const table = options.table ?? loadTable()
  const p = parse(source, flags, { table })
  return { dialect: DIALECT, source: emitJs(p.tree, p.fold), flags: 'u', usesTable: p.usesTable, groups: p.groups, unicode: table.unicode }
}

/** A translated pattern ready to run: the RegExp, and the repertoire it answers within. */
export function compile(source, flags = '', options = {}) {
  const table = options.table ?? loadTable()
  const t = translate(source, flags, { table })
  return { ...t, regexp: new RegExp(t.source, t.flags), repertoire: table.repertoire }
}

/** The first code point of the text outside the repertoire, as a UTF-16 index, or -1. */
export function outsideRepertoire(text, repertoire) {
  let k = 0
  for (const c of text) {
    if (!inRanges(repertoire, c.codePointAt(0))) return k
    k += c.length
  }
  return -1
}

/** match, no match, or can't tell (a pattern naming a table class, on a text holding a code point outside the repertoire). */
export function test(compiled, text) {
  if (compiled.usesTable && outsideRepertoire(text, compiled.repertoire) >= 0) return "can't tell"
  return compiled.regexp.test(text) ? 'match' : 'no match'
}

/** The answer and, on a match, the first match's span in UTF-16 code units of the text. */
export function firstMatch(compiled, text) {
  if (compiled.usesTable && outsideRepertoire(text, compiled.repertoire) >= 0) return { answer: "can't tell" }
  const m = compiled.regexp.exec(text)
  return m ? { answer: 'match', span: [m.index, m.index + m[0].length] } : { answer: 'no match' }
}

/** Applies a character map of the table (maps.<name>) code point by code point; when to apply it is the caller's rule. */
export function fold(text, name, options = {}) {
  const table = options.table ?? loadTable()
  const map = table.maps?.[name]?.map
  if (!map) throw new Error(`the table has no map ${name}`)
  let out = ''
  for (const c of text) out += map[hex(c.codePointAt(0), 4)] ?? c
  return out
}

// ── command line ──────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const ti = args.indexOf('--test')
  const text = ti >= 0 ? args[ti + 1] : undefined
  const rest = ti >= 0 ? args.slice(0, ti).concat(args.slice(ti + 2)) : args
  if (rest.length < 1 || rest.length > 2 || (ti >= 0 && text === undefined)) {
    console.error('usage: node translate.mjs <pattern> [flags] [--test <text>]')
    process.exit(3)
  }
  try {
    const c = compile(rest[0], rest[1] ?? '')
    if (text === undefined) {
      console.log(JSON.stringify({ dialect: c.dialect, source: c.source, flags: c.flags, usesTable: c.usesTable, unicode: c.unicode }))
      process.exit(0)
    }
    const a = test(c, text)
    console.log(a)
    process.exit(a === 'match' ? 0 : a === 'no match' ? 1 : 2)
  } catch (e) {
    if (e instanceof PatternRefused) { console.log(e.message); process.exit(3) }
    throw e
  }
}
