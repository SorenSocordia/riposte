/**
 * Typed remedies: what can lawfully answer a non-PASS finding (2026-10-02; docs/REMEDIES.md).
 *
 * A failed check that only says "no" leaves a person to guess what would make it "yes". Here every non-PASS claim carries
 * typed remedies, declared by the rule next to its predicate (a built-in ruleset's table, or `remedy` on a declarative
 * check), and derived from the claim's own insufficiency when the rule declares none:
 *
 *   ABSTAIN → the missing or unresolved operand (missing-operand), a re-read (recompute-with), a registered transformation
 *             that resolves an ambiguous reading (transform), or, where the ruleset cannot decide, a person (authority)
 *   FAIL    → the registered transformation, the corrected operand, or the AUTHORITY that could lawfully clear it; or
 *             `none`, when no transition is declared and the finding simply stands
 *
 * The idea is borrowed (principles, not code) from the APPA repair taxonomy (Kravchenko et al., arXiv 2607.24625, Theorem 5):
 * when a check fails, the only lawful state transitions are a committed effect, a call-scoped authority ruling, a registered
 * transformation, or a confined child computation, and a failed check yields structured remedies rather than an opaque
 * refusal. APPA gates information flow BEFORE an agent acts; Riposte checks the truth of what was decided AFTER. So our
 * remedies are about operands and authorities, not labels.
 *
 * INVARIANTS
 *   - A remedy never changes a verdict. It is attached to it (`verdict.remedies`), outside the hashed core: verdict_id
 *     derives from the inputs, ruleset and engine exactly as before, and nothing here reads or writes an outcome.
 *   - Deterministic: a pure function of the claims and the declared tables (claim order, then spec order; duplicates merged).
 *   - A `transform` names a REGISTERED transformation (REMEDY_TRANSFORMS). An unregistered name is a lint error in a
 *     declarative ruleset and a test failure in a built-in table.
 *   - An `authority` remedy is the role's MANDATE for this verdict: a ruling by that role may cover exactly the rule ids the
 *     remedy clears (receipts' ap_gate enforces this). No authority remedy, no ruling can clear the rule.
 */

import { canonicalize } from './canonical.js'
import type { ClaimVerdict, InsufficiencyReason, OperandRef, Outcome, Remedy, RemedyKind, Value, Verdict } from './schema.js'

export type { Remedy, RemedyKind, OperandRef } from './schema.js'

export const REMEDY_KINDS: readonly RemedyKind[] = ['missing-operand', 'transform', 'authority', 'recompute-with', 'none']

/**
 * One declared remedy. `detail` and `operand.path` may name facts of the claim it answers in braces, filled in
 * deterministically: {field} {asserted} {expected} {variance} {claim} {rule} {line} {missing} {reason} and {op:NAME} (an
 * operand of the claim's computation). An unknown or absent fact reads `?`. {line} is the line's index in its array (line[3]
 * reads 3), for paths; {position} (2026-10-05) is the line's position as a person counts it (line[3] reads 4), for words.
 */
export interface RemedySpec {
  kind: RemedyKind
  operand?: OperandRef
  transform?: string
  authority?: string
  detail: string
  /** ABSTAIN specs only: the insufficiency reasons this spec answers. Absent = every reason. */
  when?: InsufficiencyReason[]
}

/** A rule's remedies, by the outcome they answer. */
export interface RuleRemedies {
  fail?: RemedySpec[]
  abstain?: RemedySpec[]
}

/** What a declarative check may write under `remedy`: the full form, or a bare spec / list of specs (read as FAIL remedies). */
export type RemedyDeclaration = RuleRemedies | RemedySpec | RemedySpec[]

/** A transformation a remedy may name. Each is defined here, once; `requires` is what must be true before it is lawful. */
export interface RegisteredTransform {
  name: string
  description: string
  requires: string
}

/**
 * The registered transformations. A remedy names one; the caller (or a person) applies it and runs the check again, which
 * issues a NEW verdict. None of them changes what a value means; each states how an ambiguous or mis-shaped value is to be read.
 */
export const REMEDY_TRANSFORMS: Readonly<Record<string, RegisteredTransform>> = {
  'declare-field-path': {
    name: 'declare-field-path',
    description: 'Map the caller\'s field name to the role the rule reads: a recognized field name, or a `paths` entry in a declarative ruleset. No value changes.',
    requires: 'the field found by fuzzy name-matching is in fact the operand the rule means',
  },
  'declare-unit': {
    name: 'declare-unit',
    description: 'State the unit of a value that reads two ways: a percent written as a whole number ("45" or "45%") rather than a bare fraction, a currency, or a reporting scale ("in thousands"). The value is re-read under the stated unit.',
    requires: 'the document (or its producer) states the unit; the transform never guesses it',
  },
  'tax-inclusive-subtotal': {
    name: 'tax-inclusive-subtotal',
    description: 'Read the stated subtotal as already including tax: the expected total becomes subtotal + service charge − |discount|, and the tax is not added again.',
    requires: 'the document states that its prices include tax',
  },
  'cap-at-received': {
    name: 'cap-at-received',
    description: 'Bill only what was received: each invoice line\'s quantity becomes the goods-receipt quantity and its amount quantity × unit price (a partial payment). The three-way match then runs on the capped invoice.',
    requires: 'the payer\'s policy allows paying received units ahead of the rest',
  },
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const KIND_SET = new Set<string>(REMEDY_KINDS)
const REASONS = new Set<string>([
  'FIELD_MISSING', 'UNPARSEABLE', 'AMBIGUOUS_UNIT', 'SPAN_NOT_FOUND', 'OUT_OF_RULESET_SCOPE', 'REFERENCE_NOT_PROVIDED',
  'AMBIGUOUS_FIELD', 'AMBIGUOUS_REFERENCE', 'SELECTIVE_QUOTE',
])

/** The problems with one remedy spec (empty = well-formed). `where` prefixes each message. */
export function remedySpecProblems(s: unknown, where: string, outcome: 'fail' | 'abstain'): string[] {
  if (!isObj(s)) return [`${where}: a remedy is an object { kind, detail, … }`]
  const out: string[] = []
  const known = new Set(['kind', 'operand', 'transform', 'authority', 'detail', 'when'])
  for (const k of Object.keys(s)) if (!known.has(k)) out.push(`${where}: unknown remedy field "${k}"`)
  if (typeof s.kind !== 'string' || !KIND_SET.has(s.kind)) out.push(`${where}: kind must be one of ${REMEDY_KINDS.join(', ')}`)
  if (typeof s.detail !== 'string' || !s.detail.trim()) out.push(`${where}: detail is required (what the remedy is, in words)`)
  if (s.operand !== undefined) {
    if (!isObj(s.operand) || typeof s.operand.source !== 'string' || !s.operand.source) out.push(`${where}: operand needs a source`)
    else for (const k of ['role', 'path'] as const) if (s.operand[k] !== undefined && typeof s.operand[k] !== 'string') out.push(`${where}: operand.${k} must be a string`)
  }
  if (s.kind === 'missing-operand' || s.kind === 'recompute-with') {
    if (s.operand === undefined) out.push(`${where}: a ${s.kind} remedy names its operand`)
  }
  if (s.kind === 'transform') {
    if (typeof s.transform !== 'string') out.push(`${where}: a transform remedy names a registered transformation (one of ${Object.keys(REMEDY_TRANSFORMS).join(', ')})`)
    else if (!REMEDY_TRANSFORMS[s.transform]) out.push(`${where}: transform "${s.transform}" is not registered (registered: ${Object.keys(REMEDY_TRANSFORMS).join(', ')})`)
  } else if (s.transform !== undefined) out.push(`${where}: only a transform remedy names a transform`)
  if (s.kind === 'authority') {
    if (typeof s.authority !== 'string' || !s.authority.trim()) out.push(`${where}: an authority remedy names the role that may rule`)
  } else if (s.authority !== undefined) out.push(`${where}: only an authority remedy names an authority`)
  if (s.when !== undefined) {
    if (outcome !== 'abstain') out.push(`${where}: "when" filters ABSTAIN remedies by insufficiency reason; a FAIL remedy has none`)
    else if (!Array.isArray(s.when) || s.when.some(w => typeof w !== 'string' || !REASONS.has(w))) out.push(`${where}: when lists insufficiency reasons (${[...REASONS].join(', ')})`)
  }
  return out
}

/** The problems with a check's `remedy` declaration (empty = well-formed). */
export function remedyDeclarationProblems(d: unknown, where: string): string[] {
  if (Array.isArray(d)) return d.flatMap((s, i) => remedySpecProblems(s, `${where}[${i}]`, 'fail'))
  if (!isObj(d)) return [`${where}: remedy must be a remedy, a list of remedies, or { fail: [...], abstain: [...] }`]
  if ('kind' in d) return remedySpecProblems(d, where, 'fail')
  const out: string[] = []
  for (const k of Object.keys(d)) if (k !== 'fail' && k !== 'abstain') out.push(`${where}: unknown key "${k}" (fail, abstain)`)
  for (const k of ['fail', 'abstain'] as const) {
    if (d[k] === undefined) continue
    if (!Array.isArray(d[k])) { out.push(`${where}.${k}: a list of remedies`); continue }
    ;(d[k] as unknown[]).forEach((s, i) => out.push(...remedySpecProblems(s, `${where}.${k}[${i}]`, k)))
  }
  return out
}

/**
 * A declaration in its full form ({ fail, abstain }), keeping only well-formed specs. Lint reports a malformed one; a ruleset
 * that was never linted still never crashes a verdict: its malformed remedies are dropped, and the claim takes the remedies
 * its insufficiency implies (or `none` on a FAIL).
 */
export function normalizeDeclaration(d: unknown): RuleRemedies | undefined {
  if (d === undefined || d === null) return undefined
  const keep = (xs: unknown, outcome: 'fail' | 'abstain'): RemedySpec[] | undefined => {
    if (!Array.isArray(xs)) return undefined
    const ok = xs.filter((s): s is RemedySpec => remedySpecProblems(s, '', outcome).length === 0)
    return ok.length ? ok : undefined
  }
  let out: RuleRemedies
  if (Array.isArray(d)) out = { ...(keep(d, 'fail') ? { fail: keep(d, 'fail') } : {}) }
  else if (isObj(d) && 'kind' in d) out = { ...(keep([d], 'fail') ? { fail: keep([d], 'fail') } : {}) }
  else if (isObj(d)) out = { ...(keep(d.fail, 'fail') ? { fail: keep(d.fail, 'fail') } : {}), ...(keep(d.abstain, 'abstain') ? { abstain: keep(d.abstain, 'abstain') } : {}) }
  else return undefined
  return out.fail || out.abstain ? out : undefined
}

// ── derivation ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RemedyContext {
  /** The remedies a rule declares, by rule id. */
  declared?: (ruleId: string) => RuleRemedies | undefined
  /** The remedies declared for one claim, consulted before `declared` (2026-10-03: a ruleset's quotes share rule id QUOTE_MATCH). */
  declaredFor?: (claim: ClaimVerdict) => RuleRemedies | undefined
  /**
   * How a claim's fact reads in a remedy's text when the producer knows better than the bare value (2026-10-03): an
   * identifier as the document wrote it, money as money. Undefined = the default rendering.
   */
  display?: (claim: ClaimVerdict, key: string) => string | undefined
  /** Where a role was read in the document (e.g. the path of a value that did not parse), for the claim it belongs to (2026-10-03). */
  pathOfRole?: (role: string, claim: ClaimVerdict) => string | undefined
  /** The source a role comes from, for derived missing-operand remedies (e.g. RATE_CONTRACTED → contract). */
  sourceOfRole?: (role: string) => string | undefined
  /** The name of the document the claims are about, for derived remedies. Default 'document'. */
  document?: string
  /** Roles the ruleset computes from other operands: a missing one names why it could not be computed, not "supply it". */
  isComputed?: (role: string) => boolean
  /**
   * 2026-10-03, given only by a declarative ruleset that sets `distinguish_unreadable`: the operand's field path and
   * published term, and, when it was seen but could not be read, the value as reported and the source line that prints it.
   * An unreadable operand then gets a `missing-operand` remedy naming all of that, not a bare "re-read".
   */
  operandInfo?: (role: string, claim: ClaimVerdict) => OperandInfo | undefined
  /**
   * Engine 0.3.0 (2026-10-03: the evidence ruling): an unreadable or struck operand is answered by EVIDENCE, never by
   * a typed value. Its remedy says so: a CORRECT carrying the page or document that prints it (the engine reads it), or a
   * CORROBORATE from an independent source. Without it the remedies keep their bytes.
   */
  evidenceLaw?: boolean
  /**
   * Engine 0.5.0 (2026-10-04: the choice ledger): the kind of a choice slot a claim waits on, when the missing role is one.
   * A check that depends on an unstated choice is answered by stating it (a quoted span) or by a value the judge supplies, never by
   * reading a field. Without it the remedies keep their bytes.
   */
  choiceOf?: (role: string) => { kind: string } | undefined
}

/** What a producer knows about one operand of a claim (RemedyContext.operandInfo). */
export interface OperandInfo {
  path?: string
  term?: string
  /** present when the operand was seen but not read: the value as reported (JSON) and where the source prints it */
  unreadable?: { value?: string; at?: string; struck?: 'withdrawn' | 'unsupported' | 'conflict' | 'qc_held' | 'qc_struck'; why?: string; /** engine 0.6.0: why a printed figure was not read (unreadable.ts notStrictNote) */ note?: string }
}

/** " (allowance_total_amount), BT-107 Sum of allowances …" — an operand as a remedy names it. */
const operandName = (info: OperandInfo): string => `${info.path !== undefined ? ` (${info.path})` : ''}${info.term !== undefined ? `, ${info.term}` : ''}`

const show = (v: unknown): string => {
  if (v === undefined || v === null) return '?'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(show).join(', ')
  return canonicalize(v)
}

/** The facts of a claim a remedy's text may name. */
function factsOf(c: ClaimVerdict, display?: RemedyContext['display']): (key: string) => string {
  const line = c.claim_id.match(/line\[(\d+)\]/)?.[1]
  return (key: string): string => {
    const shown = display?.(c, key)
    if (shown !== undefined) return shown
    if (key.startsWith('op:')) return show(c.computation?.operands?.[key.slice(3)] as Value | undefined)
    switch (key) {
      case 'field': return c.field
      case 'asserted': return show(c.asserted)
      case 'expected': return show(c.computation?.result)
      case 'variance': return c.variance === undefined ? '?' : String(c.variance)
      case 'claim': return c.claim_id
      case 'rule': return c.rule_id
      case 'line': return line ?? '?'
      case 'position': return line === undefined ? '?' : String(Number(line) + 1)
      case 'missing': return c.insufficiency?.missing?.length ? c.insufficiency.missing.join(', ') : '?'
      case 'reason': return c.insufficiency?.reason ?? '?'
      default: return '?'
    }
  }
}

const fill = (text: string, fact: (k: string) => string): string => text.replace(/\{(op:[A-Za-z0-9_]+|[a-z]+)\}/g, (_, k: string) => fact(k))

function instantiate(s: RemedySpec, c: ClaimVerdict, display?: RemedyContext['display']): Omit<Remedy, 'clears' | 'claims'> {
  const fact = factsOf(c, display)
  const r: Omit<Remedy, 'clears' | 'claims'> = { kind: s.kind, detail: fill(s.detail, fact) }
  if (s.operand) {
    r.operand = { source: s.operand.source }
    if (s.operand.role !== undefined) r.operand.role = s.operand.role
    if (s.operand.path !== undefined) r.operand.path = fill(s.operand.path, fact)
  }
  if (s.transform !== undefined) r.transform = s.transform
  if (s.authority !== undefined) r.authority = s.authority
  return r
}

/** The remedies a claim's own insufficiency implies, when its rule declares none for that reason. */
function derivedAbstain(c: ClaimVerdict, ctx: RemedyContext): RemedySpec[] {
  const doc = ctx.document ?? 'document'
  const ins = c.insufficiency
  const missing = ins?.missing ?? []
  const sourceOf = (role: string): string => ctx.sourceOfRole?.(role) ?? doc
  switch (ins?.reason) {
    case 'REFERENCE_NOT_PROVIDED': {
      if (!missing.length) return [{ kind: 'missing-operand', operand: { source: 'reference' }, detail: `supply the reference this check reads: ${ins.detail}` }]
      const bySource = new Map<string, string[]>()
      for (const m of missing) bySource.set(sourceOf(m), [...(bySource.get(sourceOf(m)) ?? []), m])
      return [...bySource].map(([source, roles]) => ({
        kind: 'missing-operand' as const, operand: { source, ...(roles.length === 1 ? { role: roles[0] } : {}) },
        detail: `supply the ${source} reference: ${c.rule_id} needs ${roles.join(', ')} from it`,
      }))
    }
    case 'FIELD_MISSING':
      if (!missing.length) return [{ kind: 'missing-operand', operand: { source: doc, path: c.field }, detail: `supply ${c.field}: ${ins.detail}` }]
      return missing.map(m => {
        // Engine 0.5.0: a choice the check depends on is unstated: state it (a quoted span), or the judge supplies it.
        const choice = ctx.choiceOf?.(m)
        if (choice) return { kind: 'missing-operand' as const, operand: { source: doc, role: m, path: `choices.${m}` }, detail: `state the choice ${m} (${choice.kind}): the document does not state it and the ruleset supplies no default. A fill { value, stated: true, span: { page or section, quote } } quoting the passage that states it, or a value the judge supplies (supplied_choices), runs the check again` }
        const info = ctx.isComputed?.(m) ? undefined : ctx.operandInfo?.(m, c)
        if (info) return { kind: 'missing-operand' as const, operand: { source: sourceOf(m), role: m, ...(info.path !== undefined ? { path: info.path } : {}) }, detail: `supply ${m}${operandName(info)}: the rule cannot run without it` }
        if (!ctx.isComputed?.(m)) return { kind: 'missing-operand' as const, operand: { source: sourceOf(m), role: m }, detail: `supply ${m}: the rule cannot run without it` }
        // A computed role is missing because one of ITS operands is: the insufficiency names which ("ROLE: why; …").
        const why = /^[A-Z0-9_]+$/.test(m) ? ins.detail.match(new RegExp(`(?:^|; )${m}: ([^;]*)`))?.[1]?.split(' — ')[0] : undefined
        return { kind: 'missing-operand' as const, operand: { source: doc, role: m }, detail: `${m} is computed from the document and could not be: ${why ?? ins.detail}` }
      })
    case 'UNPARSEABLE':
      // 2026-10-03: name the operand that could not be read, not the check's field (an unreadable allowance used to read
      // "re-read tax_exclusive_amount"). Each named role, with the document path it was read from when the producer knows it.
      if (missing.length) {
        return missing.map(m => {
          // An operand seen but not read is unresolved: supply it, named by field, term, reported value and printed line.
          const info = ctx.operandInfo?.(m, c)
          // Engine 0.5.0: a value held or struck by its own quality flag is answered by the archive, not by a typed value.
          if (info?.unreadable && ctx.evidenceLaw && (info.unreadable.struck === 'qc_held' || info.unreadable.struck === 'qc_struck')) {
            const u = info.unreadable
            return {
              kind: 'missing-operand' as const, operand: { source: sourceOf(m), role: m, ...(info.path !== undefined ? { path: info.path } : {}) },
              detail: `${m}${operandName(info)} is ${u.struck === 'qc_held' ? 'held' : 'struck'} by its quality flag${u.why ? ` (${u.why})` : ''}. It is answered by the archive: a CORRECT carrying the file in which the archive serves the value with a flag the ruleset's flags choice computes (a later quality state), or a restated flags choice; never by a typed value`,
            }
          }
          if (info?.unreadable && ctx.evidenceLaw) {
            const u = info.unreadable
            const what = u.struck === 'withdrawn' ? `withdrawn${u.why ? ` (${u.why})` : ''}`
              : u.struck === 'unsupported' ? `an unsupported assertion${u.why ? ` (${u.why})` : ''}`
                : u.struck === 'conflict' ? `in conflict: ${u.why ?? 'two sources at one tier disagree'}`
                  : `unreadable${u.at !== undefined ? ` at ${u.at}` : ''}; ${u.value !== undefined ? `reported as ${u.value}` : 'no value was read'}${u.note !== undefined ? `; ${u.note}` : ''}`
            return {
              kind: 'missing-operand' as const, operand: { source: sourceOf(m), role: m, ...(info.path !== undefined ? { path: info.path } : {}) },
              detail: `${m}${operandName(info)} is struck: ${what}. It is answered by evidence, never by a typed value: a CORRECT carrying the page or document that prints it (the engine reads it), or a CORROBORATE from an independent source; the checks waiting on it run again`,
            }
          }
          if (info?.unreadable) {
            const u = info.unreadable
            return {
              kind: 'missing-operand' as const, operand: { source: sourceOf(m), role: m, ...(info.path !== undefined ? { path: info.path } : {}) },
              detail: `supply ${m}${operandName(info)}: unreadable${u.at !== undefined ? ` at ${u.at}` : ''}; ${u.value !== undefined ? `reported as ${u.value}` : 'no value was read'}${u.note !== undefined ? `; ${u.note}` : ''}. Read it off the document and run the check again`,
            }
          }
          const path = ctx.pathOfRole?.(m, c)
          return { kind: 'recompute-with' as const, operand: { source: sourceOf(m), role: m, ...(path !== undefined ? { path } : {}) }, detail: `re-read ${m}${path !== undefined ? ` (${path})` : ''} as a value the rule can compare: ${ins.detail}` }
        })
      }
      return [{ kind: 'recompute-with', operand: { source: doc, path: c.field }, detail: `re-read ${c.field} as a value the rule can compare: ${ins.detail}` }]
    case 'AMBIGUOUS_FIELD':
      return [{ kind: 'transform', transform: 'declare-field-path', operand: { source: doc, path: c.field }, detail: `say which field is ${c.field}: ${ins.detail}` }]
    case 'AMBIGUOUS_UNIT':
      return [{ kind: 'transform', transform: 'declare-unit', operand: { source: doc, path: c.field }, detail: `state the unit of ${c.field}: ${ins.detail}` }]
    case 'AMBIGUOUS_REFERENCE':
      return [{ kind: 'missing-operand', operand: { source: missing.length ? sourceOf(missing[0] as string) : 'reference', ...(missing.length === 1 ? { role: missing[0] } : {}) }, detail: `name the one reference entry that applies: ${ins.detail}` }]
    case 'SPAN_NOT_FOUND':
      return [{ kind: 'missing-operand', operand: { source: 'source', path: c.field }, detail: `supply the complete source text, or where the passage appears: ${ins.detail}` }]
    case 'SELECTIVE_QUOTE':
      return [{ kind: 'authority', authority: 'reviewer', detail: `a person reads the passage in context and rules, for this verdict only: ${ins.detail}` }]
    case 'OUT_OF_RULESET_SCOPE':
      return [{ kind: 'authority', authority: 'reviewer', detail: `the ruleset does not decide this (${ins.detail}); a person rules, for this verdict only` }]
    default:
      return [{ kind: 'none', detail: `no remedy is declared for ${c.rule_id}; the claim abstains: ${ins?.detail ?? 'undecided'}` }]
  }
}

function specsFor(c: ClaimVerdict, ctx: RemedyContext): RemedySpec[] {
  const declared = ctx.declaredFor?.(c) ?? ctx.declared?.(c.rule_id)
  if (c.outcome === 'FAIL') {
    if (declared?.fail?.length) return declared.fail
    return [{ kind: 'none', detail: `no remedy is declared for ${c.rule_id}: the finding stands` }]
  }
  const reason = c.insufficiency?.reason
  const hits = (declared?.abstain ?? []).filter(s => !s.when || (reason !== undefined && s.when.includes(reason)))
  return hits.length ? hits : derivedAbstain(c, ctx)
}

/**
 * The remedies for a verdict's non-PASS claims, merged (one remedy per distinct kind/operand/transform/authority/detail,
 * naming every rule and claim it answers), FAIL claims first, then can't-tell, each in claim order. Undefined when every
 * claim PASSes and the verdict PASSes. A non-PASS verdict with no non-PASS claim (nothing could be formed) gets one
 * verdict-level missing-operand remedy.
 */
export function remediesFor(v: { outcome: Outcome; claims: readonly ClaimVerdict[]; aggregation?: string }, ctx: RemedyContext = {}): Remedy[] | undefined {
  const open = [...v.claims.filter(c => c.outcome === 'FAIL'), ...v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA')]
  if (!open.length) {
    if (v.outcome === 'PASS') return undefined
    const source = ctx.document ?? 'document'
    // Every claim passed, yet the named aggregation does not let them alone make the verdict PASS (a document agreeing with
    // itself never PASSes the values checked against it); or nothing could be formed at all.
    const detail = v.claims.length
      ? `every claim passed, but under ${v.aggregation ?? 'its aggregation'} they cannot alone make the verdict PASS: supply a value to check against the ${source}`
      : 'no claim could be formed from these inputs: supply a document the ruleset reads'
    return [{ kind: 'missing-operand', operand: { source }, detail, clears: [], claims: [] }]
  }
  const merged = new Map<string, Remedy>()
  for (const c of open) {
    for (const s of specsFor(c, ctx)) {
      const r = instantiate(s, c, ctx.display)
      const key = canonicalize(r)
      const hit = merged.get(key)
      if (hit) {
        if (!hit.clears.includes(c.rule_id)) hit.clears.push(c.rule_id)
        if (!hit.claims.includes(c.claim_id)) hit.claims.push(c.claim_id)
      } else merged.set(key, { ...r, clears: [c.rule_id], claims: [c.claim_id] })
    }
  }
  return [...merged.values()]
}

/** Attach the remedies to a verdict (in place; returned for chaining). Sets nothing when every claim PASSes. */
export function attachRemedies<V extends Verdict>(v: V, ctx: RemedyContext = {}): V {
  const remedies = remediesFor(v, ctx)
  if (remedies) v.remedies = remedies
  return v
}

/** A verdict without its remedies: the hashed core a replay and a golden compare when the presented verdict carries none. */
export function withoutRemedies<V extends { remedies?: unknown }>(v: V): Omit<V, 'remedies'> {
  const { remedies: _r, ...core } = v
  return core
}

/** Built-in remedy tables: rule id → its remedies. */
export type RemedyTable = Readonly<Record<string, RuleRemedies>>

/** The problems with a built-in table (unregistered transforms, malformed specs). Tested for every built-in ruleset. */
export function remedyTableProblems(table: RemedyTable, where: string): string[] {
  return Object.entries(table).flatMap(([rule, d]) => remedyDeclarationProblems(d, `${where}.${rule}`))
}

/**
 * The public word for an outcome. From 2026-10-05 it is the outcome itself: PASS, FAIL or INSUFFICIENT_DATA (can't
 * tell). The older word ABSTAIN is never written (docs/GLOSSARY.md, "ABSTAIN").
 */
export function answerOf(o: Outcome): 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA' {
  return o
}

/** One line per remedy, for a terminal: `authority buyer → AP_PRICE_PO: approve …`. */
export function renderRemedies(remedies: readonly Remedy[] | undefined): string[] {
  if (!remedies?.length) return []
  return remedies.map(r => {
    const what = r.kind === 'authority' ? `authority ${r.authority}` : r.kind === 'transform' ? `transform ${r.transform}`
      : r.operand ? `${r.kind} ${r.operand.source}${r.operand.role ? `:${r.operand.role}` : ''}${r.operand.path ? ` (${r.operand.path})` : ''}` : r.kind
    return `${what}${r.clears.length ? ` → ${r.clears.join(', ')}` : ''}: ${r.detail}`
  })
}
