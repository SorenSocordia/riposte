/**
 * The standards compiler (2026-10-03): schematron → declarative ruleset skeleton.
 *
 * Every assert of every input schematron lands in exactly one class:
 *   (a) arithmetic  – a comparison over amounts, quantities, prices and constants (+ − × ÷, sum(), cent rounding, u:slack),
 *                     compiled to a check with the standard's tolerance;
 *   (b) presence    – a presence check that ABSTAINS when the field is absent (`narrowing: presence-abstains`);
 *   (c) membership  – a value in a code list the schematron carries, or equal to another field (`compare: "member"` /
 *                     `compare: "identifier"`); a list that is not provided locally gives a declared abstention;
 *   (d) uncompiled  – everything else, listed in the compile report with its line, test and reason. Never dropped.
 * A rule context that matches several structure paths compiles once per path (an instance); an instance the declarative
 * language cannot check (a repeating group other than the invoice line, a document value inside a line check, an operand
 * outside the field scope) is listed as an uncompiled instance of a compiled assert (`partial`). The policies are in
 * POLICIES below and in docs/COMPILER.md.
 */

import { createHash } from 'node:crypto'
import type { DeclApplicability, DeclarativeRuleset, DeclCheck, DeclField } from '../declarative/types.js'
import { hashOf } from '../verdict/canonical.js'
import { parseXPath, type Ast } from './xpath.js'
import { readSchematron, type ReadFile, type Schematron, type SchematronAssert } from './schematron.js'
import { chain, dualIndex, lastStep, localOf, parentPath, parseStructureTsv, parseStructureXml, repeatingAncestor, singleUnder, childrenOf, type Structure, type StructureRow } from './structure.js'
import { Interpreter, firstOpaque, kindOfPath, numRefs, resolveContext, simplify, type Cond, type Num, type NodeRef, type Str, type Why } from './interpret.js'
import * as P from './normal.js'

export const COMPILER_ID = 'verify compile-ruleset'
/** 0.1.1 (2026-10-03, post hoc): adds the currency-count reading (POLICIES); every check 0.1.0 wrote keeps its code and form. */
export const COMPILER_VERSION = '0.1.1'

/** The compiler's reading policies, stated once (also in the compile report and docs/COMPILER.md). */
export const POLICIES: readonly string[] = [
  'presence-abstains: a presence assert compiles to a check that abstains when the field is absent, never one that fails: an extraction cannot tell "not on the invoice" from "not read".',
  'cent-rounding: round(x × 100) div 100 then an exact compare reads the amounts at the cent and allows 0.005; an exact compare of amounts does the same (BR-DEC rules limit them to two decimals).',
  'slack: u:slack(exp, val, s) compiles to |val − exp| ≤ s compared exactly (exact_tolerance), its unrounded amounts read at full precision.',
  'strict-inequality: x > c compiles to two checks, x >= c and x != c (the check language has = <= >= !=).',
  'branch-collapse: a disjunction whose branches differ only in which optional operands are present collapses to one form reading an absent operand as 0, only when the branches cover every presence combination; otherwise the fullest branch compiles alone and the others abstain.',
  'defaults: a schematron default (if (X) then X else K) is taken only for an optional element; for a mandatory one, absence abstains.',
  'lists: a document sum over a repeating group is a list field (`each`); the check fails on a reported element it cannot read (fail_if_unreadable), as Peppol 0.3.0 does.',
  'nested-sums: a line sum over a group inside the line (its allowances) is read as the line\'s stated total, and the check abstains when the line reports the items instead.',
  'flags: an assert flagged warning or information compiles as an advisory check (counsel, never a verdict); fatal and unflagged asserts are ordinary checks.',
  'instances: a context that matches several paths compiles once per path; a path inside a repeating group other than the invoice line is an uncompiled instance.',
  'credit notes: the compiler targets the invoice; credit-note alternatives of a context or path are dropped as absent from an invoice.',
  'dual terms: cac:AllowanceCharge is an allowance (ChargeIndicator false) or a charge (true); cac:TaxTotal is BT-110 (with the breakdown, in the invoice currency) or BT-111; any other two-term UBL element is read as one combined term.',
  'currency-count (added post hoc, 0.1.1, after a corpus run showed the gap): count(cac:TaxTotal/cbc:TaxAmount[@currencyID = C]) eq 1, with C the invoice currency (BT-5) or the VAT accounting currency (BT-6), is read per dual term: the term C selects has currencyID = C, and the other term, when reported, does not (two identifier checks, coded <assert>:<conjunct>; the assert\'s other checks keep their codes and class). An extraction that reports the invoice-currency total as BT-111 and the other as BT-110 fails, where the XML count is 1.',
]

export interface AliasEntry { paths?: string[]; each?: string[]; labels?: string[] }
export interface AliasFile { lineArrayKeys?: string[]; terms?: Record<string, AliasEntry> }

export interface CompileOptions {
  /** a structure table (TSV) or the published structure XML (VEFA structure-1), with a reader for its included parts */
  structure: { file: string; text: string; readPart?: (href: string) => string | undefined }
  profile?: string
  version?: string
  name?: string
  domain?: string
  aliases?: { file: string; text: string }
  /** compile only asserts whose operands are in this term set (`aliases` = the alias file's terms) */
  scope?: { file: string; text: string } | 'aliases'
  /** file base name → where it came from (URL and commit), written into the ruleset's `sources` */
  sources?: Record<string, string>
  read?: ReadFile
}

export type AssertClass = 'arithmetic' | 'presence' | 'membership' | 'uncompiled'
export interface UncompiledInstance { instance?: string; category: string; reason: string }
export interface ReportEntry {
  file: string; line: number; pattern_id: string; rule_context: string; assert_id: string; flag: string
  class: AssertClass
  test: string
  text: string
  checks: string[]
  narrowings: string[]
  /** for an uncompiled assert: why (every instance's reason); for a partial one: the instances or conjuncts left out */
  uncompiled: UncompiledInstance[]
  partial: boolean
}
export interface FileCounts { asserts: number; arithmetic: number; presence: number; membership: number; uncompiled: number; partial: number }
export interface CompileReport {
  compiler: string
  version: string
  profile: string
  inputs: { file: string; sha256: string; bytes: number; role: 'schematron' | 'structure' | 'aliases' | 'scope'; included_from?: string }[]
  counts: Record<string, FileCounts>
  total: FileCounts
  uncompiled_by_category: Record<string, number>
  policies: readonly string[]
  structure_gaps: string[]
  entries: ReportEntry[]
}

export interface CompileResult { ruleset: DeclarativeRuleset; report: CompileReport; reportText: string }

// ── terms ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = 'amount' | 'price' | 'quantity' | 'identifier' | 'string'
interface Term { key: string; bt?: string; name: string; path: string; rel: string; kind: Kind; notes: string[]; row?: StructureRow }

/** What a check needs from a field: one role per distinct need. */
interface RoleReq {
  term: Term
  use: 'value' | 'list' | 'nested-sum' | 'items'
  line: boolean
  precision: 'cent' | 'full'
  /** the value used when the field is absent (only for an optional element), else undefined (absence abstains) */
  absent?: number
  /** list fields: the repeating group's path; nested sums and items: the group inside the line */
  group?: string
  /** nested sums: how the items are selected (e.g. ChargeIndicator false) */
  select?: string
}
const reqKey = (r: RoleReq): string => `${r.term.key}|${r.term.kind}|${r.use}|${r.line ? 'L' : 'D'}|${r.precision}|${r.absent ?? '-'}|${r.group ?? ''}|${r.select ?? ''}`

type Piece = string | { req: RoleReq; optional?: boolean }
interface ApplyDraft { field?: RoleReq; in?: string[]; not_in?: string[]; present?: true; anyPresent?: RoleReq[]; left?: Piece[]; op?: string; right?: Piece[] }
interface Draft {
  cls: 'arithmetic' | 'presence' | 'membership'
  scope: 'document' | 'line'
  compare?: 'identifier' | 'member'
  left: Piece[]
  op: '=' | '<=' | '>=' | '!='
  right: Piece[]
  list?: string[]
  listFrom?: string
  tol?: number
  exact?: boolean
  abstain?: string
  abstainIfPresent?: RoleReq[]
  guardReason?: string
  failIfUnreadable?: RoleReq[]
  narrowing: string[]
  label?: string
  applies?: ApplyDraft[]
  /** identifier checks: fallback forms, chosen by what is present */
  alternatives?: { left: Piece[]; right: Piece[] }[]
  /**
   * A reading added after 0.1.0 (the currency count, 0.1.1): such a check always takes its `<assert>:<label>` code and never
   * takes part in naming or classifying the assert's other checks, so every check 0.1.0 wrote keeps its code and class.
   */
  added?: string
}

const snake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15))))
const whyOf = (cat: string, detail: string): Why => ({ cat, detail })
const isWhy = (x: unknown): x is Why => !!x && typeof x === 'object' && 'cat' in x && 'detail' in x && !('key' in x)

function flattenAnd(c: Cond): Cond[] { return c.k === 'and' ? c.args.flatMap(flattenAnd) : [c] }

// ── the compiler ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function compileSchematron(inputs: { path: string; text: string }[], o: CompileOptions): CompileResult {
  const S: Structure = /\.xml$/i.test(o.structure.file) || o.structure.text.trimStart().startsWith('<') ? parseStructureXml(o.structure.text, o.structure.readPart) : parseStructureTsv(o.structure.text)
  if (!S.root || S.rows.size === 0) throw new Error(`${o.structure.file}: no structure rows (a TSV of path, cardinality, BT ids, name, default, rules)`)
  const ROOT = `/${S.root}`
  const sumPaths = new Map<string, string>() // Σ atom → the summed path (branch collapse)
  const btPaths = new Map<string, string[]>()
  for (const [p, row] of S.rows) if (row.terms.length === 1) { const g = btPaths.get(row.terms[0]!) ?? []; g.push(p); btPaths.set(row.terms[0]!, g) }
  /** A term key for a single-term row: the BT, or BT@element when the structure gives that BT to several elements. */
  const btKey = (bt: string, p: string): string => ((btPaths.get(bt)?.length ?? 0) > 1 ? `${bt}@${localOf(lastStep(p))}` : bt)
  const LINE = `${ROOT}/cac:${S.root}Line`
  const aliases: AliasFile = o.aliases ? JSON.parse(o.aliases.text) as AliasFile : {}
  const scopeTerms: Set<string> | undefined = o.scope === 'aliases' ? new Set(Object.keys(aliases.terms ?? {}))
    : o.scope ? new Set((JSON.parse(o.scope.text) as { terms?: string[] }).terms ?? []) : undefined
  const schs: Schematron[] = inputs.map(i => readSchematron(i.path, i.text, o.read))

  const entries: ReportEntry[] = []
  const drafts: { entry: ReportEntry; a: SchematronAssert; d: Draft; code: string }[] = []

  for (const sch of schs) {
    const ip = new Interpreter({ structure: S, sch, ns: sch.ns })
    for (const a of sch.asserts) {
      const entry: ReportEntry = { file: a.file, line: a.line, pattern_id: a.pattern_id, rule_context: a.rule_context, assert_id: a.assert_id, flag: a.flag, class: 'uncompiled', test: a.test, text: a.text, checks: [], narrowings: [], uncompiled: [], partial: false }
      entries.push(entry)
      const out = compileAssert(ip, sch, a)
      if ('why' in out) { entry.uncompiled.push(...out.why); continue }
      if (!out.drafts.length) { entry.uncompiled.push(...out.left); continue }
      // field scope: an instance whose fields are not all in scope is left out
      const kept: Draft[] = []
      const left = [...out.left]
      for (const d of out.drafts) {
        if (scopeTerms) {
          const missing = [...new Set(draftTerms(d).filter(k => !scopeTerms.has(k)))]
          if (missing.length) { left.push({ ...(d.label ? { instance: d.label } : {}), category: 'outside-field-scope', reason: `the check reads ${missing.join(', ')}, outside the field scope` }); continue }
        }
        kept.push(d)
      }
      if (!kept.length) { entry.uncompiled.push(...left); continue }
      // checks from a reading added after 0.1.0 neither rename nor reclassify the ones 0.1.0 wrote (Draft.added)
      const base0 = kept.filter(d => !d.added)
      entry.class = (base0[0] ?? kept[0]!).cls
      entry.partial = left.length > 0
      entry.uncompiled.push(...left)
      entry.narrowings = [...new Set(kept.flatMap(d => d.narrowing))]
      const flagAdvisory = a.flag === 'warning' || a.flag === 'information'
      kept.forEach((d, i) => {
        const suffix = d.added ? (kept.length > 1 || d.label ? `:${d.label ?? i + 1}` : '') : base0.length > 1 ? `:${d.label ?? base0.indexOf(d) + 1}` : ''
        if (flagAdvisory) d.narrowing.push(`flag ${a.flag}: advisory`)
        drafts.push({ entry, a, d, code: `${a.assert_id}${suffix}` })
      })
    }
  }

  // ── roles and fields ────────────────────────────────────────────────────────────────────────────────────────────────
  const roleOf = new Map<string, string>()
  const roleReq = new Map<string, RoleReq>()
  const taken = new Map<string, string>() // role name → reqKey
  const baseOf = (r: RoleReq): string => {
    const k = r.term.key
    const core = k.startsWith('path:') ? k.slice(5).split('/').slice(-2).map(localOf).join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      : k.replace(/\/@/g, '_').replace(/[|]/g, '_').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    if (r.use === 'items') return `ITEMS_${localOf(lastStep(r.group ?? '')).toUpperCase()}`
    if (r.use === 'nested-sum') return `SUM_${core}`
    if (r.use === 'list') return `${core}_LIST`
    return `${core}${r.precision === 'full' && (r.term.kind === 'amount') ? '_EXACT' : ''}${r.term.kind === 'identifier' && kindOfPath(r.term.path) !== 'identifier' ? '_TEXT' : ''}`
  }
  const roleFor = (r: RoleReq): string => {
    const key = reqKey(r)
    const have = roleOf.get(key)
    if (have) return have
    let name = baseOf(r)
    if (taken.has(name)) name = `${name}${r.absent === undefined ? '_REQUIRED' : `_ABSENT_${String(r.absent).replace(/[^0-9]/g, '_')}`}`
    let n = 2
    const stem = name
    while (taken.has(name)) name = `${stem}_${n++}`
    taken.set(name, key)
    roleOf.set(key, name)
    roleReq.set(name, r)
    return name
  }
  const render = (ps: Piece[]): string => ps.map(p => (typeof p === 'string' ? p : `${roleFor(p.req)}${p.optional ? '?' : ''}`)).join('')
  {
    const all: RoleReq[] = []
    const visit = (ps: Piece[] | undefined): void => { for (const p of ps ?? []) if (typeof p !== 'string') all.push(p.req) }
    for (const { d } of drafts) {
      visit(d.left); visit(d.right)
      for (const a of d.alternatives ?? []) { visit(a.left); visit(a.right) }
      for (const r of [...(d.abstainIfPresent ?? []), ...(d.failIfUnreadable ?? [])]) all.push(r)
      for (const x of d.applies ?? []) { if (x.field) all.push(x.field); for (const q of x.anyPresent ?? []) all.push(q); visit(x.left); visit(x.right) }
    }
    const firstUse = new Map<string, number>()
    all.forEach((r, i) => { if (!firstUse.has(reqKey(r))) firstUse.set(reqKey(r), i) })
    const uniqReqs = uniqBy(all, reqKey)
    const rank = (r: RoleReq): number => (r.absent !== undefined ? 0 : 1)
    const byBase = new Map<string, RoleReq[]>()
    for (const r of uniqReqs) { const b = baseOf(r); const g = byBase.get(b) ?? []; g.push(r); byBase.set(b, g) }
    for (const g of byBase.values()) g.sort((a, b) => rank(a) - rank(b) || firstUse.get(reqKey(a))! - firstUse.get(reqKey(b))!)
    const order = [...byBase.values()].sort((a, b) => Math.min(...a.map(r => firstUse.get(reqKey(r))!)) - Math.min(...b.map(r => firstUse.get(reqKey(r))!)))
    for (const g of order) for (const r of g) roleFor(r)
  }

  const checks: DeclCheck[] = []
  const usedCodes = new Set<string>()
  for (const { entry, a, d, code: code0 } of drafts) {
    let code = code0
    let n = 2
    while (usedCodes.has(code)) code = `${code0}~${n++}`
    usedCodes.add(code)
    entry.checks.push(code)
    const leftFieldReq = d.left.find((p): p is { req: RoleReq } => typeof p !== 'string')?.req
    const c: Record<string, unknown> = { code, name: a.text || a.assert_id }
    if (d.scope === 'line') c.scope = 'line'
    if (leftFieldReq) c.field = '__FIELD__' + reqKey(leftFieldReq)
    if (d.compare) c.compare = d.compare
    c.left = render(d.left)
    c.op = d.op
    c.right = d.compare === 'member' ? `codes ${d.listFrom ?? ''}`.trim() : render(d.right)
    if (d.list) c.in = d.list
    if (d.tol !== undefined) c.tol = d.tol
    if (d.exact) c.exact_tolerance = true
    if (d.abstain) c.abstain = d.abstain
    const applies = d.applies
    if (d.alternatives?.length) c.alternatives = d.alternatives.map(a => ({ left: render(a.left), right: render(a.right) }))
    if (applies?.length) c.applies_if = applies.map((x): DeclApplicability => (x.anyPresent ? { any_present: uniq(x.anyPresent.map(roleFor)) } : x.field ? (x.present ? { field: roleFor(x.field), present: true } : x.in ? { field: roleFor(x.field), in: x.in } : { field: roleFor(x.field), not_in: x.not_in! }) : { left: render(x.left!), op: x.op as '=', right: render(x.right!) }))
    if (d.abstainIfPresent?.length) { c.abstain_if_present = d.abstainIfPresent.map(roleFor); if (d.guardReason) c.guard_reason = d.guardReason }
    if (d.failIfUnreadable?.length) c.fail_if_unreadable = d.failIfUnreadable.map(roleFor)
    if (a.flag === 'warning' || a.flag === 'information') c.advisory = true
    c.narrowing = d.narrowing
    c.source = { file: a.file, sha256: a.sha256, line: a.line, pattern_id: a.pattern_id, rule_context: a.rule_context, assert_id: a.assert_id, flag: a.flag, test: a.test, text: a.text_raw }
    c.compiled_from = { compiler: `${COMPILER_ID}@${COMPILER_VERSION}`, class: d.cls }
    checks.push(c as unknown as DeclCheck)
  }

  // fields, in first-use order
  const fields: Record<string, DeclField & { term_key?: string }> = {}
  const synth = new Map<string, string[]>() // role → synthesized paths (deduplicated across terms below)
  for (const [role, r] of roleReq) {
    const t = r.term
    const al = aliases.terms?.[aliasKey(r)]
    const f: DeclField & { term_key?: string } = { paths: [] }
    let syn: string[] = []
    const local = localOf(lastStep(t.path))
    if (r.use === 'items') {
      const g = localOf(lastStep(r.group ?? ''))
      syn = [`${snake(g)}s`, g]
      f.kind = 'string'
      f.line = true
    } else if (r.use === 'list') {
      const g = r.group ?? parentPath(t.path)
      const grow = S.rows.get(g)
      f.each = [...(al?.each ?? []), ...uniq([snake(grow?.name || localOf(lastStep(g))), localOf(lastStep(g)), `${snake(localOf(lastStep(g)))}s`])]
      syn = [snake(local), local, snake(t.name)]
      f.kind = r.precision === 'full' && t.kind === 'amount' ? 'price' : (t.kind === 'string' ? 'amount' : t.kind as 'amount')
    } else if (r.use === 'nested-sum') {
      syn = [`${snake(t.name)}_total`]
      f.kind = 'amount'
      f.line = true
    } else {
      syn = t.path.includes('/@') ? [`${snake(t.name.replace(/^\S+ of /, '').replace(/^B[TG]-\d+ /, ''))}_${snake(local)}`, `${snake(localOf(lastStep(parentPath(t.path))))}_${snake(local)}`] : [snake(t.name), local, snake(local)]
      f.kind = r.precision === 'full' && t.kind === 'amount' ? 'price' : t.kind === 'string' ? 'string' : t.kind
      if (r.line) f.line = true
    }
    if (f.kind === 'amount') delete f.kind // the default kind
    if (r.absent !== undefined) f.default = r.absent
    const term = r.use === 'items' ? `the line's ${localOf(lastStep(r.group ?? ''))} items, reported as a list (${relOf(S, r.group ?? '')})`
      : r.use === 'nested-sum' ? `Σ ${t.bt ?? t.key} ${t.name} (${t.rel}${r.select ? `, ${r.select}` : ''}), as the line states it`
        : r.use === 'list' ? `${t.bt ? `${t.bt} ` : ''}${t.name} (${t.rel}), every ${localOf(lastStep(r.group ?? ''))}`
          : `${t.bt ? `${t.bt} ` : ''}${t.name} (${t.rel})`
    f.term = term
    if (!r.line && r.use === 'value' && !t.path.includes('/@') && t.name && t.kind !== 'string') f.labels = uniq([...(al?.labels ?? []), t.name])
    else if (al?.labels?.length && !r.line && r.use === 'value') f.labels = uniq(al.labels)
    f.paths = [...(al?.paths ?? [])]
    synth.set(role, uniq(syn.filter(Boolean)))
    f.term_key = aliasKey(r)
    fields[role] = f
  }
  // a synthesized path two different terms would share in one scope is ambiguous: drop it from both
  const ns = (role: string): string => { const r = roleReq.get(role)!; return r.line || r.use === 'items' || r.use === 'nested-sum' ? 'line' : r.use === 'list' ? `list:${r.group}` : 'doc' }
  const owners = new Map<string, Set<string>>()
  for (const [role, paths] of synth) for (const p of paths) { const k = `${ns(role)}|${p}`; const s = owners.get(k) ?? new Set<string>(); s.add(roleReq.get(role)!.term.key); owners.set(k, s) }
  for (const [role, paths] of synth) {
    const f = fields[role]!
    const keep = paths.filter(p => (owners.get(`${ns(role)}|${p}`)?.size ?? 0) <= 1)
    f.paths = uniq([...f.paths, ...keep])
    if (!f.paths.length) f.paths = [role.toLowerCase()]
  }
  // reorder each field's keys for reading: paths, each, kind, line, default, term, labels, term_key
  for (const role of Object.keys(fields)) {
    const f = fields[role]!
    const fr = f as unknown as Record<string, unknown>
    fields[role] = Object.fromEntries(['each', 'paths', 'kind', 'line', 'default', 'term', 'labels', 'term_key'].filter(k => fr[k] !== undefined).map(k => [k, fr[k]])) as unknown as DeclField & { term_key?: string }
  }
  for (const c of checks as unknown as Record<string, unknown>[]) {
    if (typeof c.field === 'string' && c.field.startsWith('__FIELD__')) {
      const role = roleOf.get(c.field.slice(9))
      c.field = role ? (fields[role]?.paths[0] ?? role.toLowerCase()) : undefined
      if (c.field === undefined) delete c.field
    }
  }

  // ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const counts: Record<string, FileCounts> = {}
  const total: FileCounts = { asserts: 0, arithmetic: 0, presence: 0, membership: 0, uncompiled: 0, partial: 0 }
  const byCat: Record<string, number> = {}
  for (const e of entries) {
    const fc = (counts[e.file] ??= { asserts: 0, arithmetic: 0, presence: 0, membership: 0, uncompiled: 0, partial: 0 })
    for (const x of [fc, total]) { x.asserts++; x[e.class]++; if (e.partial) x.partial++ }
    if (e.class === 'uncompiled') { const cat = e.uncompiled[0]?.category ?? 'other'; byCat[cat] = (byCat[cat] ?? 0) + 1 }
  }
  const files = schs.flatMap(s => s.files)
  const inputsList: CompileReport['inputs'] = [
    ...uniqBy(files, f => `${f.file}|${f.sha256}`).map(f => ({ file: f.file, sha256: f.sha256, bytes: f.bytes, role: 'schematron' as const, ...(f.included_from ? { included_from: f.included_from } : {}) })),
    { file: base(o.structure.file), sha256: sha(o.structure.text), bytes: Buffer.byteLength(o.structure.text, 'utf8'), role: 'structure' },
    ...(o.aliases ? [{ file: base(o.aliases.file), sha256: sha(o.aliases.text), bytes: Buffer.byteLength(o.aliases.text, 'utf8'), role: 'aliases' as const }] : []),
    ...(o.scope && o.scope !== 'aliases' ? [{ file: base(o.scope.file), sha256: sha(o.scope.text), bytes: Buffer.byteLength(o.scope.text, 'utf8'), role: 'scope' as const }] : []),
  ]
  const profile = o.profile ?? `${base(inputs[0]?.path ?? 'schematron').replace(/\.sch$/i, '').toLowerCase()}-compiled`
  const report: CompileReport = {
    compiler: COMPILER_ID, version: COMPILER_VERSION, profile, inputs: inputsList, counts, total,
    uncompiled_by_category: Object.fromEntries(Object.entries(byCat).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))),
    policies: POLICIES, structure_gaps: S.gaps, entries,
  }
  const reportText = `${JSON.stringify(report, null, 1)}\n`
  const sources: Record<string, string> = {}
  for (const f of uniqBy(files, x => x.file)) sources[f.file] = `${o.sources?.[f.file] ? `${o.sources[f.file]} ` : ''}(sha256 ${f.sha256})`
  const titles = schs.map(s => s.title).filter(Boolean)
  const ruleset = {
    id: profile,
    version: o.version ?? '0.1.0',
    domain: o.domain ?? 'e-invoice',
    name: o.name ?? `${titles.join(' + ') || profile} (compiled by ${COMPILER_ID} ${COMPILER_VERSION}: a skeleton, every check quoting its assert; see compiled_from)`,
    sources,
    distinguish_unreadable: true,
    lineArrayKeys: aliases.lineArrayKeys ?? ['invoice_lines', 'InvoiceLine', 'lines', 'line_items'],
    tolerance: { rel: 0, absCap: 0 },
    fields,
    checks,
    compiled_from: {
      compiler: COMPILER_ID, compiler_version: COMPILER_VERSION,
      inputs: inputsList, counts, total,
      ...(scopeTerms ? { scope: o.scope === 'aliases' ? 'the alias file\'s terms' : base((o.scope as { file: string }).file) } : {}),
      report_sha256: sha(reportText),
      hand_edits: [],
    },
  } as unknown as DeclarativeRuleset
  return { ruleset, report, reportText }

  // ── per assert ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function compileAssert(ip: Interpreter, sch: Schematron, a: SchematronAssert): { why: UncompiledInstance[] } | { drafts: Draft[]; left: UncompiledInstance[] } {
    const one = (cat: string, reason: string): { why: UncompiledInstance[] } => ({ why: [{ category: cat, reason }] })
    if (a.unreadable) return one('abstract-rule', a.unreadable)
    let ctxAst: Ast
    try { ctxAst = parseXPath(a.rule_context) } catch (e) { return one('xpath-not-parsed', `the rule context does not parse: ${(e as Error).message}`) }
    try { parseXPath(a.test) } catch (e) { return one('xpath-not-parsed', `the test does not parse: ${(e as Error).message}`) }
    if (/\b(local-)?name\(\)/.test(a.rule_context)) return one('context-by-name', `the rule context selects elements by their names (${a.rule_context.replace(/\s+/g, ' ').slice(0, 120)}); an extraction carries fields, not element names`)
    const ctx = resolveContext(ip, ctxAst, S, sch.ns)
    if ('why' in ctx) return one(ctx.why.cat === 'path-not-in-structure' ? 'path-not-in-structure' : ctx.why.cat === 'context-by-name' ? 'context-by-name' : 'context', `rule context: ${ctx.why.detail}`)
    if (!ctx.refs.length) return one(ctx.dropped ? 'credit-note-only' : 'context-matches-nothing', ctx.dropped ? 'the rule context names only credit-note elements' : 'the rule context matches no structure path')
    const drafts: Draft[] = []
    const left: UncompiledInstance[] = []
    const multi = ctx.refs.length > 1
    for (const ref of ctx.refs) {
      const label = multi ? instanceLabel(ref) : undefined
      const r = compileInstance(ip, a, ref)
      if ('why' in r) { left.push(...r.why.map(w => ({ ...(label ? { instance: label } : {}), category: w.cat, reason: w.detail }))); continue }
      for (const d of r.drafts) drafts.push({ ...d, ...(label ? { label: d.label ? `${label}:${d.label}` : label } : {}) })
      left.push(...r.left.map(w => ({ ...(label ? { instance: label } : {}), category: w.cat, reason: w.detail })))
    }
    return { drafts, left: collapseLeft(left) }
  }

  /** Instances left out for the same reason are one report entry with a count (a //* context matches hundreds of paths). */
  function collapseLeft(xs: UncompiledInstance[]): UncompiledInstance[] {
    const groups = new Map<string, { first: UncompiledInstance; n: number }>()
    for (const x of xs) { const k = `${x.category}|${x.reason}`; const g = groups.get(k); if (g) g.n++; else groups.set(k, { first: x, n: 1 }) }
    return [...groups.values()].map(g => (g.n > 1 ? { instance: `${g.n} instances`, category: g.first.category, reason: g.first.reason } : g.first))
  }

  function instanceLabel(ref: NodeRef): string {
    const t = termOf({ path: ref.path, conds: [] })
    return isWhy(t) ? relOf(S, ref.path) : t.key
  }

  function compileInstance(ip: Interpreter, a: SchematronAssert, ctx: NodeRef): { why: Why[] } | { drafts: Draft[]; left: Why[] } {
    // the scope: the document, an invoice line, or (not checkable) another repeating group
    let scope: 'document' | 'line'
    const notes: string[] = []
    const rep = repeatingAncestor(S, ctx.path)
    if (!rep) scope = 'document'
    else if (rep === LINE) scope = 'line'
    else if (isDualInstance(rep) && !repeatingBelow(rep, ctx.path)) { scope = 'document'; notes.push(`first-instance: ${relOf(S, rep)} read as its first instance (${dualIndex(ctx.path, {}).why})`) }
    else {
      const each = perElementPresence(ip, a, ctx, rep)
      if (each) return each
      return { why: [whyOf('per-element-group', `the context ${relOf(S, ctx.path)} repeats (${relOf(S, rep)}); the declarative language checks elements one by one only over the invoice lines`)] }
    }
    if (scope === 'line' && repeatingBelow(LINE, ctx.path)) return { why: [whyOf('per-element-group', `the context ${relOf(S, ctx.path)} repeats inside the line`)] }
    // applicability from the context's predicates
    const appl: ApplyDraft[] = []
    for (const c0 of ctx.conds) {
      const c = c0
      if (chargeIndicatorOf(c, ctx.path) || taxTotalOf(c, ctx.path)) { notes.push(`context predicate picks the term: ${relOf(S, ctx.path)}`); continue }
      const r = toApplies(simplify(c), scope, notes)
      if (isWhy(r)) return { why: [r.cat === 'never-applies' ? r : whyOf(r.cat === 'context-by-name' ? 'context-by-name' : 'context-condition', `the rule context's predicate: ${r.detail}`)] }
      appl.push(...r)
    }
    // an optional element on the way to the context: the rule applies only when it is there, read as "one of its fields is reported"
    const base0 = scope === 'line' ? LINE : ROOT
    const optional = chain(S, ctx.path).filter(x => x.path.length > base0.length && x.card.min === 0 && !isDualInstance(x.path)).map(x => x.path).pop()
    if (optional) {
      const evidence = evidenceFields(optional)
      const reqs: RoleReq[] = []
      for (const p of evidence) { const t = termOf({ path: p, conds: [] }); if (isWhy(t)) continue; const q = valueReq(t, scope, 'cent', undefined); if (!isWhy(q)) reqs.push(q) }
      if (reqs.length) { appl.push({ anyPresent: uniqBy(reqs, reqKey) }); notes.push(`applies-when-present: the schematron applies this only where ${relOf(S, optional)} is present, read as one of its fields being reported`) }
      else notes.push(`optional-context-abstains: the schematron applies this only where ${relOf(S, optional)} is present, which no field stands for; this check abstains when its operands are absent`)
    }
    const ctxNode: NodeRef = { path: ctx.path, conds: [] }
    let cond: Cond = ip.toCond(ip.ev(parseXPath(a.test), ip.ruleScope(ctxNode, a.rule_lets)))
    if (a.kind === 'report') cond = { k: 'not', a: cond }
    cond = simplify(selfHolds(cond, ctx.path))
    const conjuncts = flattenAnd(cond)
    const drafts: Draft[] = []
    const left: Why[] = []
    conjuncts.forEach((cj, i) => {
      const r = classifyOne(cj, scope, appl, [...notes])
      if (isWhy(r)) { left.push(conjuncts.length > 1 ? { ...r, detail: `conjunct ${i + 1}: ${r.detail}` } : r); return }
      for (const d of r) drafts.push({ ...d, ...(conjuncts.length > 1 ? { label: `c${i + 1}` } : {}) })
    })
    if (!drafts.length) return { why: left }
    // number split drafts within a conjunct (strict inequalities give two)
    return { drafts: withApplies(drafts, appl), left }
  }

  /**
   * A rule over every element of a document-level repeating group whose test is the presence of a numeric field in the
   * element: a list field over the group, `sum(F) = sum(F)` (abstains when an element lacks it or none is reported).
   */
  function perElementPresence(ip: Interpreter, a: SchematronAssert, ctx: NodeRef, rep: string): { drafts: Draft[]; left: Why[] } | undefined {
    if (rep !== ctx.path || ctx.conds.length || repeatingAncestorExcludingDual(parentPath(rep))) return undefined
    const c = simplify(selfHolds(ip.toCond(ip.ev(parseXPath(a.test), ip.ruleScope({ path: ctx.path, conds: [] }, a.rule_lets))), ctx.path))
    // the nonblank predicate ([boolean(normalize-space(.))]) is the presence test itself
    const selfOnly = c.k === 'present' && c.ref.conds.flatMap(flattenAnd).every(x => x.k === 'present' && x.ref.path === c.ref.path && x.ref.conds.length === 0)
    if (c.k !== 'present' || !selfOnly) return undefined
    const p = c.ref.path
    if (!p.startsWith(`${rep}/`) || !singleUnder(S, rep, p) || kindOfPath(p) === 'identifier') return undefined
    const t = termOf({ path: p, conds: [] })
    if (isWhy(t)) return undefined
    const req: RoleReq = { term: t, use: 'list', line: false, precision: 'cent', group: rep }
    return { drafts: [{ cls: 'presence', scope: 'document', left: ['sum(', { req }, ')'], op: '=', right: ['sum(', { req }, ')'], tol: t.kind === 'amount' ? 0.005 : 0, narrowing: ['presence-abstains', `every-element: ${t.bt ?? relOf(S, p)} in every ${relOf(S, rep)}; abstains when one lacks it or none is reported`] }], left: [] }
  }
  /** present(context node) holds inside the rule (self::X in the rule for X); replaced by true. */
  function selfHolds(c: Cond, ctxPath: string): Cond {
    switch (c.k) {
      case 'present': return (c.ref.path === ctxPath || ctxPath.startsWith(`${c.ref.path}/`)) && c.ref.conds.length === 0 && !c.ref.first ? { k: 'true' } : c
      case 'and': case 'or': return { k: c.k, args: c.args.map(x => selfHolds(x, ctxPath)) }
      case 'not': return { k: 'not', a: selfHolds(c.a, ctxPath) }
      default: return c
    }
  }
  function withApplies(ds: Draft[], appl: ApplyDraft[]): Draft[] {
    const seen = new Map<string, number>()
    return ds.map(d => {
      const k = d.label ?? ''
      const n = (seen.get(k) ?? 0) + 1
      seen.set(k, n)
      const label = ds.filter(x => (x.label ?? '') === k).length > 1 ? `${k ? `${k}.` : ''}${n}` : d.label
      const extra = d.applies ?? []
      return { ...d, ...(label ? { label } : {}), applies: [...appl, ...extra] } as Draft
    })
  }

  // ── classification ──────────────────────────────────────────────────────────────────────────────────────────────────
  function classifyOne(c: Cond, scope: 'document' | 'line', appl: ApplyDraft[], notes: string[]): Draft[] | Why {
    switch (c.k) {
      case 'true': return whyOf('vacuous', 'the test always holds (true()): there is nothing to check')
      case 'false': return whyOf('always-fails', 'the test never holds (false()): the rule fires on its context alone, which an extraction does not carry')
      case 'opaque': return c.why
      case 'present': return presenceDraft(c.ref, scope, notes)
      case 'not': {
        if (c.a.k === 'present') return whyOf('absence', `the assert requires ${relOf(S, c.a.ref.path)} to be ABSENT; an extraction carries the fields it read, not proof that one is missing`)
        if (c.a.k === 'nospace') return whyOf('format', 'a test that a value has no inner space, apart from a code-list test')
        if (c.a.k === 'opaque') return c.a.why.cat === 'path-not-in-structure' ? whyOf('absence', `the assert requires an element outside the structure to be absent (${c.a.why.detail})`) : c.a.why
        return whyOf('negation', 'a negated condition other than absence')
      }
      case 'cmp': return cmpDrafts(c, scope, notes)
      case 'slack': return slackDraft(c, scope, notes)
      case 'member': case 'scmp': return memberDraft(c, scope, notes)
      case 'nospace': return whyOf('format', 'a test that a value has no inner space')
      case 'and': {
        // a conjunction inside a branch: only when every part compiles to the same kind of check do we take them all
        const parts = c.args.map(x => classifyOne(x, scope, appl, notes))
        const w = parts.find(isWhy)
        if (w) return w as Why
        return (parts as Draft[][]).flat()
      }
      case 'or': return orDrafts(c.args, scope, appl, notes)
    }
  }

  function orDrafts(args: Cond[], scope: 'document' | 'line', appl: ApplyDraft[], notes: string[]): Draft[] | Why {
    const op = args.map(firstOpaque).find(Boolean)
    let lastWhy: Why | undefined
    // 1. (A and B) or A', with A' the complement of a numeric A: B applies when A holds
    if (args.length === 2) {
      for (const [x, y] of [[args[0]!, args[1]!], [args[1]!, args[0]!]] as const) {
        if (x.k !== 'and' || y.k !== 'cmp') continue
        const comp = x.args.find(z => z.k === 'cmp' && complementary(z, y))
        if (!comp) continue
        const app = toApplies(comp, scope, notes)
        if (isWhy(app)) { lastWhy = app; continue }
        const rest = x.args.filter(z => z !== comp)
        const body = rest.length === 1 ? rest[0]! : { k: 'and' as const, args: rest }
        const r = classifyOne(body, scope, appl, [...notes])
        if (isWhy(r)) { lastWhy = r; continue }
        return r.map(d => ({ ...d, applies: [...(d.applies ?? []), ...app] }) as Draft)
      }
    }
    // 2. X or not(G): vacuous when a group X reads is absent
    const negs = args.filter((x): x is { k: 'not'; a: { k: 'present'; ref: NodeRef } } => x.k === 'not' && x.a.k === 'present')
    const pos = args.filter(x => !negs.includes(x as never))
    if (negs.length && pos.length === 1 && (pos[0]!.k === 'cmp' || pos[0]!.k === 'slack')) {
      const X = pos[0]!
      const refs = X.k === 'cmp' ? [...numRefs(X.l), ...numRefs(X.r)] : [...numRefs(X.exp), ...numRefs(X.val)]
      if (negs.every(g => refs.some(r => r.path === g.a.ref.path || r.path.startsWith(`${g.a.ref.path}/`)))) {
        // a single optional field: the check applies when it is present (exactly the schematron's reading)
        const apps = negs.map(g => toApplies(g.a, scope, [...notes]))
        if (apps.every(x => !isWhy(x))) {
          const r0 = classifyOne(X, scope, appl, [...notes])
          if (!isWhy(r0)) return r0.map(d => ({ ...d, applies: [...(d.applies ?? []), ...(apps as ApplyDraft[][]).flat()] }) as Draft)
        }
        const r = classifyOne(X, scope, appl, [...notes, `vacuous-when-absent-abstains: the schematron passes when ${negs.map(g => relOf(S, g.a.ref.path)).join(', ')} is absent; this check abstains`])
        if (!isWhy(r)) return r
        lastWhy = r
      }
    }
    // 3. presence-branched arithmetic
    const col = collapse(args, scope, notes)
    if (col) return col
    // 4. one of several fields present
    if (args.every(x => x.k === 'present')) return disjunctivePresence(args.map(x => (x as { ref: NodeRef }).ref), scope, notes)
    // 5. implication: not(A) or B (an explicit negation first, then a negatable comparison or membership), A as applicability
    const cands = [...args.filter(x => x.k === 'not'), ...args.filter(x => x.k !== 'not')]
    for (const x of cands) {
      const A = x.k === 'not' ? x.a : negated(x)
      if (!A) continue
      const app = toApplies(A, scope, notes)
      if (isWhy(app)) { lastWhy = app; continue }
      const rest = args.filter(y => y !== x)
      const body = rest.length === 1 ? rest[0]! : { k: 'or' as const, args: rest }
      const r = classifyOne(body, scope, appl, [...notes])
      if (isWhy(r)) { lastWhy = r; continue }
      return r.map(d => ({ ...d, applies: [...(d.applies ?? []), ...app] }) as Draft)
    }
    if (op) return op
    if (lastWhy && lastWhy.cat !== 'absence') return lastWhy.cat === 'group-presence' || lastWhy.cat === 'conditional-on-presence' ? whyOf('conditional-on-presence', `a rule conditional on an element's presence: ${lastWhy.detail}`) : lastWhy
    if (args.some(x => x.k === 'not' && x.a.k === 'present')) return whyOf('conditional-on-presence', 'a rule that applies only when an element is present, which applicability cannot test here')
    return whyOf('disjunction', 'a disjunction the compiler cannot reduce to one check')
  }

  /** The negation of a condition applicability can express (a comparison or a membership), else undefined. */
  function negated(c: Cond): Cond | undefined {
    if (c.k === 'scmp') return { ...c, op: c.op === '=' ? '!=' : '=' }
    if (c.k === 'member') return { ...c, neg: !c.neg }
    if (c.k === 'cmp') return { ...c, op: ({ '=': '!=', '!=': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' } as const)[c.op] }
    return undefined
  }
  function complementary(a: Cond, b: Cond): boolean {
    if (a.k !== 'cmp' || b.k !== 'cmp') return false
    const neg: Record<string, string> = { '>': '<=', '<=': '>', '<': '>=', '>=': '<', '=': '!=', '!=': '=' }
    return neg[a.op] === b.op && numKeyS(a.l) === numKeyS(b.l) && numKeyS(a.r) === numKeyS(b.r)
  }
  function numKeyS(n: Num): string { return JSON.stringify(n) }

  // ── presence ────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The field whose presence stands for a path's (a group stands as its first mandatory field), as an identifier-kind read. */
  function presenceReq(ref: NodeRef, scope: 'document' | 'line', narrowing: string[], asText = false): RoleReq | Why {
    let t = termOf(ref)
    if (!isWhy(t) && isGroup(t)) {
      const rep = repeatingAncestor(S, ref.path)
      if (rep && rep !== `${ROOT}/cac:TaxTotal` && (scope === 'document' || rep !== LINE)) return whyOf('group-presence', `at least one ${relOf(S, rep)}: the group repeats, and a presence check reads one field`)
      const child = mandatoryLeaf(ref.path)
      if (!child) return whyOf('group-presence', `presence of the group ${relOf(S, ref.path)}, which has no mandatory field to stand for it`)
      const ct = termOf({ path: child, conds: [] })
      if (isWhy(ct)) return ct
      narrowing.push(`group-by-mandatory-child: ${t.bt ?? relOf(S, ref.path)} read as ${ct.bt ?? relOf(S, child)}`)
      t = ct
    }
    if (isWhy(t)) return t
    if (t.notes.length) narrowing.push(...t.notes.map(n => `term: ${n}`))
    if (t.key.startsWith('path:') && t.row?.default !== undefined) return whyOf('holds-by-structure-default', `${relOf(S, t.path)} carries the fixed value ${t.row.default} (the structure's default), so its presence is not a fact an extraction reports`)
    return valueReq(asText && t.kind !== 'identifier' ? { ...t, kind: 'identifier', notes: [...t.notes, 'read as text for an any-of presence test'] } : t, scope, 'cent', undefined)
  }
  /** One of several fields must be present: an identifier check A = A with the fallback forms B = B, … (chosen by presence). */
  function disjunctivePresence(refs: NodeRef[], scope: 'document' | 'line', notes: string[]): Draft[] | Why {
    const narrowing = [...notes, 'presence-abstains', 'any-of: one of the fields must be present']
    const reqs: RoleReq[] = []
    const kinds = new Set(refs.map(r => kindOfPath(r.path) === 'identifier' ? 'id' : 'num'))
    for (const r of refs) { const q = presenceReq(r, scope, narrowing, kinds.size > 1); if (isWhy(q)) return q; reqs.push(q) }
    const [first, ...rest] = uniqBy(reqs, reqKey)
    if (first && first.term.kind !== 'identifier' && first.term.kind !== 'string') return [{ cls: 'presence', scope, left: [{ req: first }], op: '=', right: [{ req: first }], tol: first.term.kind === 'amount' ? 0.005 : 0, ...(rest.length ? { alternatives: rest.map(q => ({ left: [{ req: q }], right: [{ req: q }] })) } : {}), narrowing: uniq(narrowing) }]
    if (!first) return whyOf('disjunctive-presence', 'no field to look for')
    return [{ cls: 'presence', scope, compare: 'identifier', left: [{ req: first }], op: '=', right: [{ req: first }], ...(rest.length ? { alternatives: rest.map(q => ({ left: [{ req: q }], right: [{ req: q }] })) } : {}), narrowing: uniq(narrowing) }]
  }
  function presenceDraft(ref: NodeRef, scope: 'document' | 'line', notes: string[]): Draft[] | Why {
    let t = termOf(ref)
    const narrowing = [...notes, 'presence-abstains']
    if (!isWhy(t) && t.key.startsWith('path:') && t.row?.default !== undefined) return whyOf('holds-by-structure-default', `${relOf(S, t.path)} carries the fixed value ${t.row.default} (the structure's default), so its presence is not a fact an extraction reports`)
    if (!isWhy(t) && isGroup(t)) {
      const rep = repeatingAncestor(S, ref.path)
      if (rep && rep !== `${ROOT}/cac:TaxTotal` && (scope === 'document' || rep !== LINE)) return whyOf('group-presence', `at least one ${relOf(S, rep)}: the group repeats, and a presence check reads one field`)
      const child = mandatoryLeaf(ref.path)
      if (!child) {
        const leaves = leafFields(ref.path)
        if (!leaves.length) return whyOf('group-presence', `presence of the group ${relOf(S, ref.path)}, which has no field to stand for it`)
        return disjunctivePresence(leaves.map(p => ({ path: p, conds: [] })), scope, [...notes, `group-by-any-field: ${t.bt ?? relOf(S, ref.path)} is present when one of its fields is`])
      }
      const ct = termOf({ path: child, conds: [] })
      if (isWhy(ct)) return ct
      narrowing.push(`group-by-mandatory-child: ${t.bt ?? relOf(S, ref.path)} read as ${ct.bt ?? relOf(S, child)}`)
      t = ct
    }
    if (isWhy(t)) return t
    const req = valueReq(t, scope, 'cent', undefined)
    if (isWhy(req)) return req
    if (t.notes.length) narrowing.push(...t.notes.map(n => `term: ${n}`))
    if (req.term.kind === 'identifier' || req.term.kind === 'string') return [{ cls: 'presence', scope, compare: 'identifier', left: [{ req }], op: '=', right: [{ req }], narrowing }]
    return [{ cls: 'presence', scope, left: [{ req }], op: '=', right: [{ req }], tol: req.term.kind === 'amount' ? 0.005 : 0, narrowing }]
  }

  // ── membership and equality ─────────────────────────────────────────────────────────────────────────────────────────
  function memberDraft(c: Extract<Cond, { k: 'member' | 'scmp' }>, scope: 'document' | 'line', notes: string[]): Draft[] | Why {
    const fieldOf = (s: Str): RoleReq | Why => {
      if (s.k !== 'val') return s.k === 'opaque' ? s.why : whyOf('comparison', 'a comparison of two literals')
      const t = termOf(s.ref)
      if (isWhy(t)) return t
      const req = valueReq({ ...t, kind: 'identifier' }, scope, 'cent', undefined)
      return req
    }
    if (c.k === 'member') {
      const f = fieldOf(c.s)
      if (isWhy(f)) return f
      return [{ cls: 'membership', scope, compare: 'member', left: [{ req: f }], op: c.neg ? '!=' : '=', right: [], list: c.list, listFrom: c.from, narrowing: [...notes, ...f.term.notes.map(n => `term: ${n}`)] }]
    }
    if (c.l.k === 'opaque') return c.l.why
    if (c.r.k === 'opaque') return c.r.why
    const lv = c.l.k === 'val', rv = c.r.k === 'val'
    if (lv && rv) {
      const a = fieldOf(c.l), b = fieldOf(c.r)
      if (isWhy(a)) return a
      if (isWhy(b)) return b
      return [{ cls: 'membership', scope, compare: 'identifier', left: [{ req: a }], op: c.op, right: [{ req: b }], narrowing: [...notes, 'equals-field', ...a.term.notes.map(n => `term: ${n}`), ...b.term.notes.map(n => `term: ${n}`)] }]
    }
    const v = lv ? c.l : rv ? c.r : undefined
    const lit = lv ? c.r : c.l
    if (!v || lit.k !== 'lit') return whyOf('comparison', 'a string comparison without a field on one side and a literal on the other')
    const f = fieldOf(v)
    if (isWhy(f)) return f
    return [{ cls: 'membership', scope, compare: 'member', left: [{ req: f }], op: c.op, right: [], list: [lit.v], listFrom: 'a literal', narrowing: [...notes, ...f.term.notes.map(n => `term: ${n}`)] }]
  }

  // ── arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function cmpDrafts(c: Extract<Cond, { k: 'cmp' }>, scope: 'document' | 'line', notes: string[], absentable?: Set<string>): Draft[] | Why {
    // count(X) against 0 or 1: presence, absence, or cardinality
    if (c.l.k === 'count' || c.r.k === 'count') {
      const cnt = c.l.k === 'count' ? c.l : c.r as Extract<Num, { k: 'count' }>
      const other = c.l.k === 'count' ? c.r : c.l
      const op = c.l.k === 'count' ? c.op : flip(c.op)
      if (other.k === 'const') {
        if ((op === '>' && other.v === 0) || (op === '>=' && other.v === 1) || (op === '!=' && other.v === 0)) return presenceDraft(cnt.ref, scope, notes)
        if ((op === '=' && other.v === 0) || (op === '<' && other.v === 1) || (op === '<=' && other.v === 0)) return whyOf('absence', `count(${relOf(S, cnt.ref.path)}) = 0: the element must be absent`)
        if (op === '=' && other.v === 1) { const cc = currencyCount(cnt.ref, scope, notes); if (cc) return cc }
      }
      return whyOf('cardinality', `a count of ${relOf(S, cnt.ref.path)} (how many times an element occurs)`)
    }
    const w = firstOpaque(c)
    if (w) return w
    const hasCent = hasK(c.l, 'cent') || hasK(c.r, 'cent')
    const leaves = [...numRefs(c.l), ...numRefs(c.r)]
    const kinds = leaves.map(r => kindOfPath(r.path))
    if (kinds.includes('identifier')) return whyOf('non-numeric-comparison', `a numeric comparison over ${leaves.filter(r => kindOfPath(r.path) === 'identifier').map(r => relOf(S, r.path)).join(', ')}, which is not an amount or quantity`)
    const amountish = hasCent || kinds.some(k => k === 'amount')
    const ctx: ExprCtx = { scope, precision: 'cent', notes: [...notes], absentable: absentable ?? new Set(), extra: { abstainIfPresent: [], guardReason: [], failIfUnreadable: [] } }
    const [ol, or] = c.op === '=' || c.op === '!=' ? orient(c.l, c.r) : [c.l, c.r]
    const L = toExpr(ol, ctx), R = toExpr(or, ctx)
    if (isWhy(L)) return L
    if (isWhy(R)) return R
    const base = (op: Draft['op'], tol: number, exact: boolean): Draft => finishArith({ cls: 'arithmetic', scope, left: L, op, right: R, tol, ...(exact ? { exact: true } : {}), narrowing: ctx.notes }, ctx)
    switch (c.op) {
      case '=': return [base('=', amountish ? 0.005 : 0, !amountish)]
      case '!=': return [base('!=', amountish ? 0.005 : 0, !amountish)]
      case '<=': case '>=': return [base(c.op, 0, true)]
      case '<': case '>': {
        const a = base(c.op === '<' ? '<=' : '>=', 0, true)
        const b = base('!=', 0, true)
        a.narrowing = [...a.narrowing, `strict-inequality: ${c.op} as ${a.op} and !=`]
        b.narrowing = [...b.narrowing, `strict-inequality: ${c.op} as ${a.op} and !=`]
        return [a, b]
      }
    }
  }
  /**
   * The currency count (0.1.1, added post hoc; POLICIES `currency-count`): count(cac:TaxTotal/cbc:TaxAmount[@currencyID = C]) eq 1,
   * C a document code the dual-term discriminator recognises (BT-5 selects BT-110, BT-6 selects BT-111). cac:TaxTotal occurs at
   * most twice and each instance is a term, so the count is [selected term's currencyID = C] + [other term reported and its
   * currencyID = C]; eq 1 is (i) the selected term's currencyID = C and (ii) the other term's currencyID != C when it is
   * reported. Two identifier checks; no new check form. Anything else (another filter, a further condition, a line check)
   * returns undefined and stays a cardinality entry.
   */
  function currencyCount(ref: NodeRef, scope: 'document' | 'line', notes: string[]): Draft[] | undefined {
    if (scope !== 'document') return undefined
    const conds = ref.conds.flatMap(flattenAnd)
    if (conds.length !== 1) return undefined
    const filter = conds[0]!
    if (filter.k !== 'scmp' || filter.op !== '=' || filter.l.k !== 'val' || filter.r.k !== 'val' || filter.l.ref.path !== `${ref.path}/@currencyID`) return undefined
    const which = taxTotalOf(filter, ref.path)
    if (!which || filter.l.ref.conds.length || filter.r.ref.conds.length) return undefined
    const codePath = filter.r.ref.path
    const otherCodePath = which === 'document' ? `${ROOT}/cbc:TaxCurrencyCode` : `${ROOT}/cbc:DocumentCurrencyCode`
    const otherFilter: Cond = { k: 'scmp', op: '=', l: { k: 'val', ref: { path: `${ref.path}/@currencyID`, conds: [] } }, r: { k: 'val', ref: { path: otherCodePath, conds: [] } } }
    const selCur = termOf({ path: `${ref.path}/@currencyID`, conds: [filter] })
    const othCur = termOf({ path: `${ref.path}/@currencyID`, conds: [otherFilter] })
    const othAmt = termOf({ path: ref.path, conds: [otherFilter] })
    const code = termOf({ path: codePath, conds: [] })
    if (isWhy(selCur) || isWhy(othCur) || isWhy(othAmt) || isWhy(code) || !selCur.key.endsWith('/@currencyID') || selCur.key === othCur.key) return undefined
    const id = (t: Term): RoleReq | Why => valueReq({ ...t, kind: 'identifier' }, 'document', 'cent', undefined)
    const sel = id(selCur), oth = id(othCur), cod = id(code)
    const amt = valueReq(othAmt, 'document', 'cent', undefined)
    if (isWhy(sel) || isWhy(oth) || isWhy(cod) || isWhy(amt)) return undefined
    const selBt = selCur.key.replace(/\/@currencyID$/, ''), othBt = othCur.key.replace(/\/@currencyID$/, ''), codeBt = code.bt ?? code.key
    const reading = `currency-count: count(${relOf(S, ref.path)}[@currencyID = ${codeBt}]) eq 1 read per dual term (${relOf(S, parentPath(ref.path))} occurs at most twice, as ${selBt} and ${othBt}): ${selBt}'s currencyID = ${codeBt}, and ${othBt}'s currencyID != ${codeBt} when ${othBt} is reported; an extraction that reports the ${codeBt} total as ${othBt} and the other as ${selBt} fails here, where the XML count is 1`
    const termNotes = (...ts: Term[]): string[] => uniq(ts.flatMap(t => t.notes.map(n => `term: ${n}`)))
    return [
      { cls: 'membership', scope: 'document', compare: 'identifier', left: [{ req: sel }], op: '=', right: [{ req: cod }], narrowing: uniq([...notes, 'equals-field', reading, ...termNotes(selCur, code)]), added: 'currency-count' },
      { cls: 'membership', scope: 'document', compare: 'identifier', left: [{ req: oth }], op: '!=', right: [{ req: cod }], applies: [{ anyPresent: uniqBy([amt, oth], reqKey) }], narrowing: uniq([...notes, reading, `applies-when-present: ${othBt} counts only where it is reported`, ...termNotes(othCur, code)]), added: 'currency-count' },
    ]
  }

  /** For an equality: the left side's first added term alone on the left, its other terms moved to the right (A − B = C  →  A = C + B). */
  function orient(l: Num, r: Num): [Num, Num] {
    const terms: { sign: 1 | -1; n: Num }[] = []
    const walk = (n: Num, sign: 1 | -1): void => {
      if (n.k === 'cent') return walk(n.a, sign)
      if (n.k === 'op' && (n.op === '+' || n.op === '-')) { walk(n.l, sign); walk(n.r, n.op === '+' ? sign : (-sign as 1 | -1)); return }
      terms.push({ sign, n })
    }
    walk(l, 1)
    if (terms.length < 2 || terms[0]!.sign !== 1 || terms[0]!.n.k !== 'val') return [l, r]
    let right = r
    for (const t of terms.slice(1)) right = { k: 'op', op: t.sign === 1 ? '-' : '+', l: right, r: t.n }
    return [terms[0]!.n, right]
  }
  function flip(op: string): '=' | '!=' | '<' | '<=' | '>' | '>=' {
    return ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=', '!=': '!=' } as Record<string, '=' | '!=' | '<' | '<=' | '>' | '>='>)[op] ?? '='
  }

  function slackDraft(c: Extract<Cond, { k: 'slack' }>, scope: 'document' | 'line', notes: string[]): Draft[] | Why {
    const w = firstOpaque(c)
    if (w) return w
    const ctx: ExprCtx = { scope, precision: 'full', notes: [...notes, `slack: |right − left| ≤ ${fmtNum(c.slack)}, compared exactly`], absentable: new Set(), extra: { abstainIfPresent: [], guardReason: [], failIfUnreadable: [] } }
    const L = toExpr(c.exp, ctx), R = toExpr(c.val, ctx)
    if (isWhy(L)) return L
    if (isWhy(R)) return R
    return [finishArith({ cls: 'arithmetic', scope, left: L, op: '=', right: R, tol: c.slack, exact: true, narrowing: ctx.notes }, ctx)]
  }

  function finishArith(d: Draft, ctx: ExprCtx): Draft {
    if (ctx.extra.abstainIfPresent.length) { d.abstainIfPresent = uniqBy(ctx.extra.abstainIfPresent, reqKey); d.guardReason = uniq(ctx.extra.guardReason).join('; ') }
    if (ctx.extra.failIfUnreadable.length) d.failIfUnreadable = uniqBy(ctx.extra.failIfUnreadable, reqKey)
    d.narrowing = uniq(d.narrowing)
    return d
  }

  interface ExprCtx {
    scope: 'document' | 'line'
    precision: 'cent' | 'full'
    notes: string[]
    absentable: Set<string>
    extra: { abstainIfPresent: RoleReq[]; guardReason: string[]; failIfUnreadable: RoleReq[] }
  }

  /** A numeric expression → declarative expression pieces. `cent` wrappers read their operands at the cent. */
  function toExpr(n: Num, ctx: ExprCtx, inCent = false, parentPrec = 0): Piece[] | Why {
    const prec = (k: string): number => (k === '+' || k === '-' ? 1 : 2)
    switch (n.k) {
      case 'const': return [fmtNum(n.v)]
      case 'opaque': return n.why
      case 'count': return whyOf('cardinality', `a count of ${relOf(S, n.ref.path)}`)
      case 'round': return whyOf('arithmetic', 'round() to a whole number')
      case 'cent': return toExpr(n.a, ctx, true, parentPrec)
      case 'abs': { const a = toExpr(n.a, ctx, inCent, 0); return isWhy(a) ? a : ['abs(', ...a, ')'] }
      case 'neg': { const a = toExpr(n.a, ctx, inCent, 3); return isWhy(a) ? a : ['-', ...a] }
      case 'op': {
        const p = prec(n.op)
        const l = toExpr(n.l, ctx, inCent, p)
        if (isWhy(l)) return l
        const r = toExpr(n.r, ctx, inCent, n.op === '-' || n.op === '/' ? p + 0.5 : p)
        if (isWhy(r)) return r
        const body = [...l, ` ${n.op} `, ...r]
        return p < parentPrec ? ['(', ...body, ')'] : body
      }
      case 'val': {
        const t = termOf(n.ref)
        if (isWhy(t)) return t
        const absent = ctx.absentable.has(t.key) && isOptional(n.ref.path, ctx.scope) ? 0 : undefined
        const req = valueReq(t, ctx.scope, inCent ? 'cent' : ctx.precision, absent)
        if (isWhy(req)) return req
        if (t.notes.length) ctx.notes.push(...t.notes.map(x => `term: ${x}`))
        return [{ req }]
      }
      case 'sum': return sumPieces(n.ref, ctx)
      case 'ifp': {
        // if (X [and extra]) then X else K: X with K when absent (optional elements only)
        const guardRefs = flattenAnd(n.guard)
        const pres = guardRefs.find((g): g is { k: 'present'; ref: NodeRef } => g.k === 'present')
        const thenRefs = numRefs(n.then)
        if (!pres || n.else.k !== 'const') return whyOf('conditional-value', 'an if/then/else value other than "the value, else a constant"')
        const extra = guardRefs.filter(g => g !== pres)
        const inner = n.then.k === 'cent' ? n.then.a : n.then
        const K = n.else.v
        const groupPath = pres.ref.path
        if (inner.k === 'val' && inner.ref.path === groupPath && thenRefs.length === 1) {
          const t = termOf(inner.ref)
          if (isWhy(t)) return t
          const optional = isOptional(inner.ref.path, ctx.scope)
          if (extra.length) ctx.notes.push(`default-condition: when ${extra.length} further condition(s) fail the schematron reads ${fmtNum(K)}; this check reads the value (a zero divisor leaves it unknown, and it abstains)`)
          if (!optional) ctx.notes.push(`mandatory-absent-abstains: ${t.bt ?? relOf(S, t.path)} is mandatory; the schematron reads ${fmtNum(K)} when it is absent, this check abstains`)
          const req = valueReq(t, ctx.scope, n.then.k === 'cent' || inCent ? 'cent' : ctx.precision, optional ? K : undefined)
          if (isWhy(req)) return req
          return [{ req }]
        }
        if (inner.k === 'sum' && (inner.ref.path === groupPath || inner.ref.path.startsWith(`${groupPath}/`)) && K === 0) {
          const ps = sumPieces(inner.ref, ctx, true)
          return ps
        }
        return whyOf('conditional-value', 'an if/then/else value whose guard is not the value\'s own presence')
      }
      default: return whyOf('arithmetic', 'an expression the compiler cannot write as a check')
    }
  }

  function sumPieces(ref: NodeRef, ctx: ExprCtx, optionalSum = false): Piece[] | Why {
    const t = termOf(ref)
    if (isWhy(t)) return t
    const rep = repeatingAncestor(S, ref.path)
    if (!rep) return whyOf('arithmetic', `sum() over ${relOf(S, ref.path)}, which occurs once`)
    if (ctx.scope === 'document') {
      if (rep === LINE && singleUnder(S, LINE, ref.path)) {
        const req = valueReq(t, 'line', ctx.precision, undefined)
        if (isWhy(req)) return req
        return ['sum(', { req }, ')']
      }
      const outer = repeatingAncestorExcludingDual(parentPath(rep))
      if (rep !== LINE && !outer && singleUnder(S, rep, ref.path)) {
        const req: RoleReq = { term: t, use: 'list', line: false, precision: ctx.precision, group: rep }
        ctx.extra.failIfUnreadable.push(req)
        ctx.notes.push(`list: every ${relOf(S, rep)} (${t.bt ?? t.key}); a reported element that cannot be read fails the check`)
        return ['sum(', { req }, ')']
      }
      return whyOf('nested-group-sum', `sum() over ${relOf(S, ref.path)}, inside more than one repeating group`)
    }
    // line scope: a group inside the line, read as the line's stated total
    if (rep.startsWith(`${LINE}/`) && singleUnder(S, rep, ref.path) && !repeatingAncestorExcludingDual(parentPath(rep), LINE)) {
      const sel = t.notes.find(x => /ChargeIndicator/.test(x))
      const req: RoleReq = { term: t, use: 'nested-sum', line: true, precision: 'cent', group: rep, ...(sel ? { select: sel } : {}) }
      const items: RoleReq = { term: { key: `items:${relOf(S, rep)}`, name: `${localOf(lastStep(rep))} items`, path: rep, rel: relOf(S, rep), kind: 'string', notes: [] }, use: 'items', line: true, precision: 'cent', group: rep }
      ctx.extra.abstainIfPresent.push(items)
      ctx.extra.guardReason.push(`the line lists its ${localOf(lastStep(rep))} items; this ruleset reads only their stated totals, so it cannot sum them here`)
      ctx.notes.push(`nested-sum: Σ ${t.bt ?? t.key} over ${relOf(S, rep)} read as the line's stated total`)
      return [{ req, ...(optionalSum ? { optional: true } : {}) }]
    }
    return whyOf('nested-group-sum', `sum() over ${relOf(S, ref.path)} in a line check`)
  }

  /** Presence-branched disjunctions → one arithmetic check (or the fullest branch alone). */
  function collapse(args: Cond[], scope: 'document' | 'line', notes: string[]): Draft[] | undefined {
    type Branch = { pos: NodeRef[]; neg: NodeRef[]; arith?: Extract<Cond, { k: 'cmp' | 'slack' }> }
    const branches: Branch[] = []
    for (const b of args) {
      const lits = flattenAnd(b)
      const br: Branch = { pos: [], neg: [] }
      for (const l of lits) {
        if (l.k === 'present') br.pos.push(l.ref)
        else if (l.k === 'not' && l.a.k === 'present') br.neg.push(l.a.ref)
        else if ((l.k === 'cmp' || l.k === 'slack') && !br.arith) br.arith = l
        else return undefined
      }
      branches.push(br)
    }
    const withArith = branches.filter(b => b.arith)
    if (!withArith.length) return undefined
    const full = withArith.reduce((best, b) => (b.neg.length < best.neg.length || (b.neg.length === best.neg.length && b.pos.length > best.pos.length) ? b : best))
    if (full.neg.length) return undefined
    const keyOfRef = (r: NodeRef): string | undefined => { const t = termOf(r); return isWhy(t) ? undefined : t.key }
    const groupKey = (r: NodeRef): string => `${r.path}|${JSON.stringify(dualFactsOf(r))}`
    const fullPoly = polyOfCond(full.arith!)
    if (!fullPoly) return undefined
    let consistent = true
    const absentKeys = new Set<string>()
    for (const b of branches) {
      if (b === full) continue
      const zeroAtoms = new Set<string>()
      for (const r of b.neg) { const k = keyOfRef(r); if (k) zeroAtoms.add(k); zeroAtoms.add(`G:${groupKey(r)}`) }
      const zeroed = P.zero(fullPoly, a => zeroAtoms.has(a) || [...zeroAtoms].some(z => z.startsWith('G:') && a.startsWith('Σ') && sumUnder(a, z.slice(2))))
      if (b.arith) {
        const bp = polyOfCond(b.arith)
        if (!bp || !(P.equal(zeroed, bp) || P.equal(zeroed, P.neg(bp)))) { consistent = false; break }
      } else if (!P.isZero(zeroed)) { consistent = false; break }
      for (const z of zeroAtoms) if (!z.startsWith('G:')) absentKeys.add(z)
    }
    if (!consistent) return undefined
    // exhaustive? every presence combination of the guarded operands must be covered by a branch
    const guards = uniqBy([...branches.flatMap(b => [...b.pos, ...b.neg])], groupKey)
    if (guards.length > 6) return undefined
    const implicitPos = (b: Branch): NodeRef[] => (b.arith ? (b.arith.k === 'cmp' ? [...numRefs(b.arith.l), ...numRefs(b.arith.r)] : [...numRefs(b.arith.exp), ...numRefs(b.arith.val)]).filter(r => !isIfpWrapped(b.arith!, r)) : [])
    let exhaustive = true
    for (let m = 0; m < 1 << guards.length && exhaustive; m++) {
      const present = (r: NodeRef): boolean => { const i = guards.findIndex(g => groupKey(g) === groupKey(r)); return i < 0 ? true : !!(m & (1 << i)) }
      const covered = branches.some(b => b.pos.every(present) && b.neg.every(r => !present(r)) && implicitPos(b).every(r => { const i = guards.findIndex(g => groupKey(g) === groupKey(r) || keyOfRef(g) === keyOfRef(r)); return i < 0 || !!(m & (1 << i)) }))
      if (!covered) exhaustive = false
    }
    const arith = full.arith!
    const extraNotes = branches.length > 1 ? (exhaustive
      ? [`branch-collapse: ${branches.length} branches read as one, an absent ${[...absentKeys].join(', ')} counted as 0`]
      : [`other-branches-abstain: the schematron's other ${branches.length - 1} branch(es) (where ${[...new Set(branches.filter(b => b !== full).flatMap(b => b.neg.map(r => relOf(S, r.path))))].join(', ')} is absent) pass; this check reads every operand and abstains when one is absent`]) : []
    const absentable = exhaustive ? absentKeys : new Set<string>()
    const r = arith.k === 'cmp' ? cmpDrafts(arith, scope, [...notes, ...extraNotes], absentable) : slackDraft(arith, scope, [...notes, ...extraNotes])
    return isWhy(r) ? undefined : r
  }

  function isIfpWrapped(c: Cond, ref: NodeRef): boolean {
    const walk = (n: Num, inIfp: boolean): boolean => {
      switch (n.k) {
        case 'val': case 'sum': return inIfp && n.ref === ref
        case 'op': return walk(n.l, inIfp) || walk(n.r, inIfp)
        case 'neg': case 'cent': case 'round': case 'abs': return walk(n.a, inIfp)
        case 'ifp': return walk(n.then, true) || walk(n.else, true)
        default: return false
      }
    }
    return c.k === 'cmp' ? walk(c.l, false) || walk(c.r, false) : c.k === 'slack' ? walk(c.exp, false) || walk(c.val, false) : false
  }
  function sumUnder(atom: string, group: string): boolean {
    // atom is Σ<key>; we stored the sum's path in sumPaths
    const p = sumPaths.get(atom)
    const [gp] = group.split('|')
    return !!p && !!gp && p.startsWith(`${gp}/`)
  }

  function polyOfCond(c: Extract<Cond, { k: 'cmp' | 'slack' }>): P.Poly | undefined {
    const l = c.k === 'cmp' ? c.l : c.exp, r = c.k === 'cmp' ? c.r : c.val
    const pl = polyOfNum(l), pr = polyOfNum(r)
    return pl && pr ? P.add(pl, pr, -1) : undefined
  }
  function polyOfNum(n: Num): P.Poly | undefined {
    switch (n.k) {
      case 'const': return P.constant(n.v)
      case 'val': { const t = termOf(n.ref); return isWhy(t) ? undefined : P.atom(t.key) }
      case 'sum': { const t = termOf(n.ref); if (isWhy(t)) return undefined; const a = `Σ${t.key}`; sumPaths.set(a, n.ref.path); return P.atom(a) }
      case 'cent': return polyOfNum(n.a)
      case 'neg': { const a = polyOfNum(n.a); return a && P.neg(a) }
      case 'op': {
        const a = polyOfNum(n.l), b = polyOfNum(n.r)
        if (!a || !b) return undefined
        return n.op === '+' ? P.add(a, b) : n.op === '-' ? P.add(a, b, -1) : n.op === '*' ? P.mul(a, b) : P.div(a, b)
      }
      case 'ifp': return polyOfNum(n.then.k === 'cent' ? n.then.a : n.then)
      default: return undefined
    }
  }

  // ── applicability ───────────────────────────────────────────────────────────────────────────────────────────────────
  function toApplies(c: Cond, scope: 'document' | 'line', notes: string[]): ApplyDraft[] | Why {
    switch (c.k) {
      case 'true': return []
      case 'and': { const out: ApplyDraft[] = []; for (const x of c.args) { const r = toApplies(x, scope, notes); if (isWhy(r)) return r; out.push(...r) } return out }
      case 'opaque': return c.why
      case 'present': {
        const own = c.ref.conds.flatMap(flattenAnd)
        if (own.length && own.every(x => (x.k === 'scmp' && x.op === '=' && ((x.l.k === 'val' && x.l.ref.path === c.ref.path && x.r.k === 'lit') || (x.r.k === 'val' && x.r.ref.path === c.ref.path && x.l.k === 'lit'))) || (x.k === 'member' && !x.neg && x.s.k === 'val' && x.s.ref.path === c.ref.path))) {
          const vals = own.flatMap(x => (x.k === 'member' ? x.list : x.k === 'scmp' ? [x.l.k === 'lit' ? x.l.v : (x.r as { v: string }).v] : []))
          return toApplies({ k: 'member', s: { k: 'val', ref: { path: c.ref.path, conds: [] } }, list: [...new Set(vals)], from: 'a predicate on the field\'s own value' }, scope, notes)
        }
        const req = presenceReq(c.ref, scope, notes)
        if (isWhy(req)) return req.cat === 'group-presence' ? whyOf('conditional-on-presence', `applies only when ${relOf(S, c.ref.path)} is present: ${req.detail}`) : req
        return [{ field: req, present: true }]
      }
      case 'member': case 'scmp': {
        const s = c.k === 'member' ? c.s : c.l.k === 'val' ? c.l : c.r
        const list = c.k === 'member' ? c.list : (c.l.k === 'lit' ? [c.l.v] : c.r.k === 'lit' ? [c.r.v] : undefined)
        if (s.k !== 'val' || !list) return whyOf('context-condition', 'a condition comparing two document values')
        const t = termOf(s.ref)
        if (isWhy(t)) {
          // a term-less element whose structure states a default: the condition holds (or never does) by that default
          const row = S.rows.get(s.ref.path)
          if (row?.default !== undefined && !row.terms.length) {
            const holds = list.some(v => v.toUpperCase() === row.default!.toUpperCase())
            const want = c.k === 'scmp' && c.op === '!=' ? !holds : holds
            if (!want) return whyOf('never-applies', `${relOf(S, s.ref.path)} is ${row.default} by the structure's default, so the rule never applies`)
            notes.push(`holds-by-structure-default: ${relOf(S, s.ref.path)} = ${row.default}`)
            return []
          }
          return t
        }
        const req = valueReq({ ...t, kind: 'identifier' }, scope, 'cent', undefined)
        if (isWhy(req)) return req
        const neg = (c.k === 'scmp' && c.op === '!=') || (c.k === 'member' && c.neg === true)
        return [neg ? { field: req, not_in: list } : { field: req, in: list }]
      }
      case 'cmp': {
        const ctx: ExprCtx = { scope, precision: 'cent', notes, absentable: new Set(), extra: { abstainIfPresent: [], guardReason: [], failIfUnreadable: [] } }
        const L = toExpr(c.l, ctx), R = toExpr(c.r, ctx)
        if (isWhy(L)) return L
        if (isWhy(R)) return R
        return [{ left: L, op: c.op, right: R }]
      }
      default: return whyOf('context-condition', `a condition (${c.k}) applicability cannot express`)
    }
  }

  // ── terms and roles ─────────────────────────────────────────────────────────────────────────────────────────────────
  function dualFactsOf(ref: NodeRef): { chargeIndicator?: 'true' | 'false'; taxTotal?: 'document' | 'accounting' } {
    const f: { chargeIndicator?: 'true' | 'false'; taxTotal?: 'document' | 'accounting' } = {}
    for (const c of ref.conds.flatMap(flattenAnd)) {
      const ci = chargeIndicatorOf(c, ref.path)
      if (ci) f.chargeIndicator = ci
      const tt = taxTotalOf(c, ref.path)
      if (tt) f.taxTotal = tt
    }
    return f
  }
  function chargeIndicatorOf(c: Cond, path: string): 'true' | 'false' | undefined {
    const s = c.k === 'scmp' && c.op === '=' && c.l.k === 'val' && c.r.k === 'lit' ? { p: c.l.ref.path, v: c.r.v } : c.k === 'member' && c.s.k === 'val' && c.list.length === 1 ? { p: c.s.ref.path, v: c.list[0]! } : undefined
    if (!s || !/\/cac:AllowanceCharge\/cbc:ChargeIndicator$/.test(s.p) || !path.startsWith(parentPath(s.p))) return undefined
    const v = s.v.trim().toLowerCase()
    return v === 'true' || v === 'false' ? v : undefined
  }
  function taxTotalOf(c: Cond, path: string): 'document' | 'accounting' | undefined {
    if (!path.startsWith(`${ROOT}/cac:TaxTotal`)) return undefined
    if (c.k === 'present' && c.ref.path === `${ROOT}/cac:TaxTotal/cac:TaxSubtotal`) return 'document'
    if (c.k === 'scmp' && c.op === '=' && c.l.k === 'val' && c.r.k === 'val' && /\/cac:TaxTotal\/cbc:TaxAmount\/@currencyID$/.test(c.l.ref.path)) {
      if (c.r.ref.path === `${ROOT}/cbc:DocumentCurrencyCode`) return 'document'
      if (c.r.ref.path === `${ROOT}/cbc:TaxCurrencyCode`) return 'accounting'
    }
    return undefined
  }

  function termOf(ref: NodeRef): Term | Why {
    const path = ref.path
    if (path === ROOT) return whyOf('group-presence', 'the document itself')
    // predicates: those that pick a dual term or hold by the structure's default are consumed; any other filters the operand
    const facts: { chargeIndicator?: 'true' | 'false'; taxTotal?: 'document' | 'accounting' } = {}
    const notes: string[] = []
    for (const c of ref.conds.flatMap(flattenAnd)) {
      const ci = chargeIndicatorOf(c, path)
      if (ci) { facts.chargeIndicator = ci; continue }
      const tt = taxTotalOf(c, path)
      if (tt) { facts.taxTotal = tt; continue }
      if (c.k === 'present' && (c.ref.path === path || path.startsWith(`${c.ref.path}/`)) && c.ref.conds.length === 0) continue // non-blank (itself, or an ancestor)
      if (c.k === 'true') continue
      if (c.k === 'scmp' || c.k === 'member') {
        const s = c.k === 'scmp' ? (c.l.k === 'val' ? c.l : c.r) : c.s
        const lits = c.k === 'member' ? c.list : (c.l.k === 'lit' ? [c.l.v] : c.r.k === 'lit' ? [c.r.v] : [])
        const row = s.k === 'val' ? S.rows.get(s.ref.path) : undefined
        if (row?.default !== undefined && !row.terms.length && lits.some(v => v.toUpperCase() === row.default!.toUpperCase()) && !(c.k === 'scmp' && c.op === '!=')) { notes.push(`${relOf(S, s.k === 'val' ? s.ref.path : '')} = ${row.default} holds by the structure's default`); continue }
      }
      const w = firstOpaque(c)
      return whyOf(w ? w.cat : 'filtered-operand', `${relOf(S, path)} is filtered by a predicate the check language cannot express${w ? ` (${w.detail})` : ''}`)
    }
    if (ref.first) notes.push(`first-instance: only the first ${relOf(S, path)}`)
    if (path.includes('/@')) {
      const parent = termOf({ path: parentPath(path), conds: ref.conds })
      if (isWhy(parent)) return parent
      const attr = lastStep(path).slice(1)
      return { key: `${parent.key}/@${attr}`, name: `${attr} of ${parent.bt ? `${parent.bt} ` : ''}${parent.name}`, path, rel: relOf(S, path), kind: 'identifier', notes: [...parent.notes, ...notes], ...(S.rows.get(path) ? { row: S.rows.get(path)! } : {}) }
    }
    const row = S.rows.get(path)
    if (!row) return whyOf('path-not-in-structure', `${relOf(S, path)} is not in the structure table`)
    const kind = kindOfPath(path)
    if (row.terms.length === 0) return { key: `path:${relOf(S, path)}`, name: row.name || path.split('/').slice(-2).map(localOf).join(' '), path, rel: relOf(S, path), kind, notes, row }
    if (row.terms.length === 1) return { key: btKey(row.terms[0]!, path), bt: row.terms[0]!, name: row.name, path, rel: relOf(S, path), kind, notes, row }
    const choice = dualIndex(path, facts)
    const names = row.name.split(/,\s*/)
    if (choice.index !== undefined && row.terms[choice.index]) {
      const bt = row.terms[choice.index]!
      const name = names.length === row.terms.length ? names[choice.index]! : `${row.name} (${choice.why})`
      return { key: bt, bt, name, path, rel: relOf(S, path), kind, notes: [...notes, `${row.terms.join('/')} on one UBL element: ${choice.why}`], row }
    }
    return { key: row.terms.join('|'), bt: row.terms.join('/'), name: row.name, path, rel: relOf(S, path), kind, notes: [...notes, choice.why], row }
  }

  function valueReq(t: Term, scope: 'document' | 'line', precision0: 'cent' | 'full', absent: number | undefined): RoleReq | Why {
    const p = t.path
    const precision = t.kind === 'amount' ? precision0 : 'cent'
    if (scope === 'line') {
      if (!p.startsWith(`${LINE}/`)) return whyOf('document-term-in-line-check', `${t.bt ?? relOf(S, p)} is a document field and the check runs per line (a line check sees only that line's fields)`)
      if (!singleUnder(S, LINE, p)) return whyOf('multi-valued', `${t.bt ?? relOf(S, p)} repeats inside the line`)
      return { term: t, use: 'value', line: true, precision, ...(absent !== undefined ? { absent } : {}) }
    }
    if (!singleUnder(S, ROOT, p) && !dualSingle(p)) return whyOf('multi-valued', `${t.bt ?? relOf(S, p)} repeats in the document (${relOf(S, repeatingAncestor(S, p) ?? p)}); one value cannot stand for all`)
    return { term: t, use: 'value', line: false, precision, ...(absent !== undefined ? { absent } : {}) }
  }

  function isOptional(path: string, scope: 'document' | 'line'): boolean {
    const from = scope === 'line' ? LINE : ROOT
    return chain(S, path).some(c => c.path.length > from.length && c.card.min === 0)
  }
  function isGroup(t: Term): boolean { return !!t.bt && t.bt.startsWith('BG-') || (!t.path.includes('/@') && childrenOf(S, t.path).length > 0 && !t.bt) }
  /** The fields (with a BT) that evidence an element: itself if it is a field, else every single field below it (attributes aside). */
  function evidenceFields(el: string): string[] {
    const row = S.rows.get(el)
    const kids = childrenOf(S, el).filter(k => !k.includes('/@'))
    if (!kids.length) return row?.terms.some(x => x.startsWith('BT-')) ? [el] : []
    const out: string[] = []
    const walk = (p: string): void => {
      for (const c of childrenOf(S, p)) {
        if (c.includes('/@')) continue
        const r = S.rows.get(c)
        if (!r || r.card.max > 1) continue
        const sub = childrenOf(S, c).filter(k => !k.includes('/@'))
        if (sub.length) walk(c)
        else if (r.terms.some(x => x.startsWith('BT-'))) out.push(c)
      }
    }
    walk(el)
    return out
  }
  /** The fields (with a BT) directly inside a group, attributes aside. */
  function leafFields(group: string): string[] {
    return childrenOf(S, group).filter(c => !c.includes('/@') && (S.rows.get(c)?.terms.some(x => x.startsWith('BT-')) ?? false) && childrenOf(S, c).filter(k => !k.includes('/@')).length === 0 && (S.rows.get(c)?.card.max ?? 1) <= 1)
  }
  /** The first field inside a group that every instance of it must carry (mandatory at every level down), or undefined. */
  function mandatoryLeaf(group: string): string | undefined {
    for (const c of childrenOf(S, group)) {
      const row = S.rows.get(c)
      if (!row || row.card.min < 1 || row.card.max > 1 || c.includes('/@')) continue
      const sub = childrenOf(S, c).filter(k => !k.includes('/@'))
      if (!sub.length) { if (row.terms.some(x => x.startsWith('BT-'))) return c; continue }
      const deep = mandatoryLeaf(c)
      if (deep) return deep
    }
    return undefined
  }
  function isDualInstance(rep: string): boolean { return rep === `${ROOT}/cac:TaxTotal` }
  function dualSingle(p: string): boolean {
    // under the dual cac:TaxTotal (read as its first instance), with nothing else repeating
    const tt = `${ROOT}/cac:TaxTotal`
    return p.startsWith(`${tt}/`) && singleUnder(S, tt, p)
  }
  function repeatingBelow(from: string, p: string): boolean { return chain(S, p).some(c => c.path.length > from.length && c.card.max > 1) }
  function repeatingAncestorExcludingDual(p: string, below = ''): string | undefined {
    let found: string | undefined
    for (const c of chain(S, p)) if (c.path.length > below.length && c.card.max > 1 && !isDualInstance(c.path)) found = c.path
    return found
  }
  function draftTerms(d: Draft): string[] {
    const out: string[] = []
    const add = (ps: Piece[] | undefined): void => { for (const p of ps ?? []) if (typeof p !== 'string') out.push(aliasKey(p.req)) }
    add(d.left); add(d.right)
    for (const a of d.alternatives ?? []) { add(a.left); add(a.right) }
    for (const r of d.abstainIfPresent ?? []) out.push(aliasKey(r))
    for (const x of d.applies ?? []) { if (x.field) out.push(aliasKey(x.field)); for (const q of x.anyPresent ?? []) out.push(aliasKey(q)); add(x.left); add(x.right) }
    return out
  }
}


/** The alias-file key of a role need: the term key; `sum:` for a nested line sum; `items:` for a line's item list. */
function aliasKey(r: RoleReq): string {
  if (r.use === 'nested-sum') return `sum:${r.term.key}`
  if (r.use === 'items') return r.term.key
  return r.term.key
}
function hasK(n: Num, k: Num['k']): boolean {
  if (n.k === k) return true
  switch (n.k) {
    case 'op': return hasK(n.l, k) || hasK(n.r, k)
    case 'neg': case 'cent': case 'round': case 'abs': return hasK(n.a, k)
    case 'ifp': return hasK(n.then, k) || hasK(n.else, k)
    default: return false
  }
}
export const relOf = (S: Structure, p: string): string => p.startsWith(`/${S.root}/`) ? p.slice(S.root.length + 2) : p
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
function uniqBy<T>(xs: T[], key: (x: T) => string): T[] { const seen = new Set<string>(); return xs.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true }) }
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const base = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p

/** sha256 of a ruleset's canonical JSON (what a verdict's input identity would bind). */
export const rulesetSha = (rs: unknown): string => hashOf(rs)
