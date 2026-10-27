/**
 * Structured-twin mode: judge an agent's extracted values against the filing's own binding facts.
 *
 * The agent read something (a PDF, the HTML, a rendering). We do not re-read that. For every claim {field, value} we
 * find the field's BINDING FACT in the twin through four declared mapping layers, and compare magnitudes:
 *
 *   concept  the map's concepts for the field, in priority order (the first one the twin reports in the period binds)
 *   period   instant / fiscal-year duration / prior instant, within a stated tolerance of the period end
 *   scale    the fact's own `scale` attribute (never a heading)
 *   sign     NOT judged: displayed and economic signs are both defensible; agreement with XBRL is recorded as a note
 *
 * v0.2 (map.binding = 'statement', map.matching = 'decimals'; CREDENCE-2): a concept can bind only if the filing's own
 * presentation linkbase places it on a face statement (TwinOptions.presentation, from parseTwinPresentation), and a
 * value PASSes when it equals ANY consistent duplicate of the binding fact; a value inside the binding fact's own
 * declared rounding that equals no duplicate is INSUFFICIENT_DATA (ROUNDED_BINDING). v0.1 (the default map) is unchanged.
 *
 * Outcomes (the reason is always explicit):
 *   PASS     MATCH      |value| = |binding value| (tolerance 0.5 by default)
 *   FAIL     MISMATCH   with a diagnosis, first match wins: SCALE (×10^±3/6/9) · PERIOD (the field's concept in another
 *                       period) · CONCEPT (another concept's fact in the period) · DIMENSION (a dimensional fact of the
 *                       field's concepts) · UNLOCATED (in the twin nowhere)
 *   INSUFFICIENT_DATA  can't tell: NO_TWIN · FIELD_NOT_MAPPED · PERIOD_UNRESOLVED · NO_BINDING_FACT · NO_USD_FACT ·
 *            CONFLICTING_FACTS · VALUE_UNPARSEABLE; and in v0.2 NO_PRESENTATION_LINKBASE · NO_STATEMENT_ROLES · NOT_ON_STATEMENT ·
 *            ROUNDED_BINDING. A can't tell is never a flag: absence proves nothing.
 *
 * The judgments said ABSTAIN for can't tell before 2026-10-06; they now say INSUFFICIENT_DATA, the verdict's own word. Under
 * engine 0.6.0 the verdict's explanation for such a claim ends "can't tell." where it ended "abstaining."; earlier engines keep
 * their text, so their verdicts replay byte for byte.
 *
 * The result is a standard verify Verdict (INSUFFICIENT_DATA, with the twin reason leading
 * `insufficiency.detail`) plus the structured judgments. verdict_id = the standard verify derivation over input_hash
 * (twin sha256, claims, period end, map id@version, tolerances), the map's id@version, and the engine version.
 * Deterministic: no network, no randomness, no clock except `issued_at`.
 */
import { hashOf } from '../verdict/canonical.js'
import { attachRemedies } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import type { ClaimVerdict, Coverage, Evidence, InsufficiencyReason, Outcome, Verdict } from '../verdict/schema.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { SCHEMA_VERSION, engineFor, engineAtLeast } from '../version.js'
import { isUsGaap, parseInlineXbrl, type InlineXbrl, type TwinContext, type TwinFact } from './ixbrl.js'
import { FS_CORE_TWIN_MAP, twinFieldConcepts, type TwinConceptMap, type TwinFieldMap, type TwinPeriod } from './map.js'
import type { TwinPresentation } from './presentation.js'

export interface TwinClaim {
  id: string
  field: string
  value: number
}

export interface TwinOptions {
  /** the fiscal period end, YYYY-MM-DD */
  periodEnd: string
  /** default 7: 52/53-week fiscal years end within a week of the nominal date */
  periodToleranceDays?: number
  /** absolute tolerance on magnitudes, default 0.5 (whole currency units) */
  tolerance?: number
  /** default FS_CORE_TWIN_MAP */
  map?: TwinConceptMap
  /** clock for issued_at only */
  now?: () => Date
  /** who produced the extraction, if known (never trusted) */
  producer?: string
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
  /** the filing's presentation (parseTwinPresentation); required by statement-anchored maps (v0.2), ignored by v0.1 */
  presentation?: TwinPresentation | null
}

export type TwinOutcome = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
export type TwinAbstainReason = 'NO_TWIN' | 'FIELD_NOT_MAPPED' | 'PERIOD_UNRESOLVED' | 'NO_BINDING_FACT' | 'NO_USD_FACT' | 'CONFLICTING_FACTS' | 'VALUE_UNPARSEABLE'
  /** v0.2: statement-anchored binding needs the filing's presentation linkbase, and none was supplied or readable */
  | 'NO_PRESENTATION_LINKBASE'
  /** v0.2: the presentation linkbase was read, but no face-statement role could be identified */
  | 'NO_STATEMENT_ROLES'
  /** v0.2: the field's concepts are reported in the period, but the presentation places none of them on a face statement */
  | 'NOT_ON_STATEMENT'
  /** v0.2: the value lies inside the binding fact's own declared rounding but equals none of its reported figures */
  | 'ROUNDED_BINDING'
  /**
   * v0.2.1: the face statement presents several lines of the field's concept family with different values, and either
   * the statement's own cash roll cannot say which one is the field's line, or the value equals a line it did not pick
   */
  | 'AMBIGUOUS_LINE'
export type TwinReason = 'MATCH' | 'MISMATCH' | TwinAbstainReason
export type TwinDiagnosis = 'SCALE' | 'PERIOD' | 'CONCEPT' | 'DIMENSION' | 'UNLOCATED'

export interface TwinFactRef {
  concept: string
  context: string
  /** "2024-12-31" (instant) or "2024-01-01..2024-12-31" (duration) */
  period: string
  value: number
  displayed: string
  scale: number
  decimals: number | null
  sign: 1 | -1
  dimensional: boolean
  span: { start: number; end: number }
}

export interface TwinBinding extends TwinFactRef {
  /** how many facts (duplicates) report this concept in this period; all agree within their rounding */
  duplicates: number
}

export type TwinBindingResult =
  /** `alternatives` (v0.2.1): other face lines of the field's concept family, with other values; the roll picked `binding` */
  | { field: string; cell: string; bound: true; binding: TwinBinding; alternatives?: TwinBinding[] }
  /** `candidates` (v0.2.1, AMBIGUOUS_LINE): the face lines of the field's concept family the roll could not choose between */
  | { field: string; cell: string; bound: false; reason: Exclude<TwinAbstainReason, 'VALUE_UNPARSEABLE' | 'FIELD_NOT_MAPPED' | 'ROUNDED_BINDING'>; detail: string; candidates?: TwinBinding[] }

export interface TwinJudgment {
  claim_id: string
  field: string
  /** the workflow cell from the map; null when the field is not mapped */
  cell: string | null
  value: number
  outcome: TwinOutcome
  reason: TwinReason
  detail: string
  binding?: TwinBinding
  diagnosis?: TwinDiagnosis
  /** for a FAIL: the facts the value does equal (up to 3), which is what the diagnosis rests on */
  matches?: TwinFactRef[]
  /** for a PASS or FAIL: whether the value carries the XBRL (economic) sign of the binding fact */
  sign_matches_xbrl?: boolean
  /** v0.2.1 AMBIGUOUS_LINE (and a SCALE FAIL against one of them): the face lines of the field's concept family */
  candidates?: TwinFactRef[]
  /** v0.2.1 value-anchored SCALE FAIL: the face-statement fact that prints the field concept's (off-face) value */
  anchor?: TwinFactRef
}

export interface TwinResult {
  verdict: Verdict
  judgments: TwinJudgment[]
  /** `presentation` is present only for statement-anchored maps (v0.2); null when none was supplied */
  twin: { sha256: string; facts: number; contexts: number; gate: boolean; presentation?: { sha256: string; source: string; statement_roles: number; statement_concepts: number; links?: 'strict' } | null }
}

const DAY = 86_400_000
const ms = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
const periodKey = (c: TwinContext): string => c.instant ?? `${c.start ?? '?'}..${c.end ?? '?'}`

function periodMatch(c: TwinContext, p: TwinPeriod, E: number, tolDays: number): boolean {
  if (p === 'instant') return c.instant !== undefined && Math.abs(ms(c.instant) - E) <= tolDays * DAY
  if (p === 'FY') {
    if (c.start === undefined || c.end === undefined) return false
    const len = (ms(c.end) - ms(c.start)) / DAY
    return Math.abs(ms(c.end) - E) <= tolDays * DAY && len >= 350 && len <= 380
  }
  if (c.instant === undefined) return false
  const back = (E - ms(c.instant)) / DAY
  return back > tolDays && back >= 350 && back <= 380
}

/** Among several matching periods, the one the field means. */
function preferPeriod(p: TwinPeriod, E: number, a: TwinContext, b: TwinContext): number {
  if (p === 'prior_instant') return ms(b.instant!) - ms(a.instant!) // latest first
  const ea = ms(a.instant ?? a.end!), eb = ms(b.instant ?? b.end!)
  const d = Math.abs(ea - E) - Math.abs(eb - E)
  if (d !== 0) return d // closest to the period end first
  if (p === 'FY') {
    const la = ms(a.end!) - ms(a.start!), lb = ms(b.end!) - ms(b.start!)
    if (la !== lb) return lb - la // longest first
  }
  const ka = periodKey(a), kb = periodKey(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/** Pre-indexed twin: facts by concept and by rounded magnitude. */
interface Indexed {
  twin: InlineXbrl
  byConcept: Map<string, TwinFact[]>
  byMagnitude: Map<number, TwinFact[]>
}
const indexCache = new WeakMap<InlineXbrl, Indexed>()
function indexed(twin: InlineXbrl): Indexed {
  const hit = indexCache.get(twin)
  if (hit) return hit
  const byConcept = new Map<string, TwinFact[]>(), byMagnitude = new Map<number, TwinFact[]>()
  for (const f of twin.facts) {
    const k = isUsGaap(f) ? f.concept : `\u0000${f.qname}`
    const a = byConcept.get(k) ?? []; a.push(f); byConcept.set(k, a)
    const m = Math.round(Math.abs(f.value))
    const b = byMagnitude.get(m) ?? []; b.push(f); byMagnitude.set(m, b)
  }
  const out = { twin, byConcept, byMagnitude }
  indexCache.set(twin, out)
  return out
}

function ref(twin: InlineXbrl, f: TwinFact): TwinFactRef {
  const c = twin.contexts.get(f.contextRef)!
  return { concept: f.concept, context: f.contextRef, period: periodKey(c), value: f.value, displayed: f.displayed, scale: f.scale, decimals: f.decimals, sign: f.sign, dimensional: c.dimensional, span: f.span }
}

const usdOf = (twin: InlineXbrl, f: TwinFact): boolean => twin.units.get(f.unitRef)?.usd === true
const rank = (d: number | null): number => (d === null ? -Infinity : d)

/** The structural twin gate: at least one non-dimensional USD fact dated within the tolerance of the period end. */
export function twinGate(twin: InlineXbrl, periodEnd: string, periodToleranceDays = 7): boolean {
  const E = ms(periodEnd)
  return twin.facts.some((f) => {
    const c = twin.contexts.get(f.contextRef)
    const d = c?.instant ?? c?.end
    return c !== undefined && !c.dimensional && d !== undefined && usdOf(twin, f) && Math.abs(ms(d) - E) <= periodToleranceDays * DAY
  })
}

type Unbound = Exclude<TwinAbstainReason, 'VALUE_UNPARSEABLE' | 'FIELD_NOT_MAPPED' | 'ROUNDED_BINDING'>

/**
 * One concept in one period: its consistent duplicate group (the most precise fact first), or why it has none.
 *   off       reported in the period, but `anchor` (v0.2) does not place the concept on a face statement
 *   nonusd    reported in the period only in a non-USD unit
 *   none      not reported in the period (non-dimensional)
 *   conflict  duplicates in the preferred period disagree beyond their rounding
 */
type ConceptGroup = { kind: 'off' } | { kind: 'nonusd' } | { kind: 'none' } | { kind: 'conflict'; detail: string } | { kind: 'group'; group: TwinFact[] }
function conceptGroup(ix: Indexed, concept: string, period: TwinPeriod, E: number, tolDays: number, anchor: ReadonlySet<string> | null): ConceptGroup {
  const { twin } = ix
  const inPeriod = (ix.byConcept.get(concept) ?? []).filter((f) => {
    const c = twin.contexts.get(f.contextRef)!
    return !c.dimensional && periodMatch(c, period, E, tolDays)
  })
  if (anchor && !anchor.has(concept)) return { kind: inPeriod.length ? 'off' : 'none' }
  const usd = inPeriod.filter((f) => usdOf(twin, f))
  if (!usd.length) return { kind: inPeriod.length ? 'nonusd' : 'none' }
  const ctxs = [...new Map(usd.map((f) => [periodKey(twin.contexts.get(f.contextRef)!), twin.contexts.get(f.contextRef)!])).values()]
  ctxs.sort((a, b) => preferPeriod(period, E, a, b))
  const key = periodKey(ctxs[0]!)
  const group = usd.filter((f) => periodKey(twin.contexts.get(f.contextRef)!) === key)
    .sort((a, b) => rank(b.decimals) - rank(a.decimals) || a.span.start - b.span.start)
  const best = group[0]!
  for (const o of group.slice(1)) {
    const tol = o.decimals !== null && Number.isFinite(o.decimals) ? 0.5 * 10 ** -o.decimals : 0.5
    if (Math.abs(o.value - best.value) > tol + 1e-9) return { kind: 'conflict', detail: `${concept} in ${key} is reported as both ${best.value} and ${o.value}` }
  }
  return { kind: 'group', group }
}

/**
 * The field's binding fact. `anchor` (v0.2) is the set of us-gaap concepts the filing presents on a face statement;
 * a concept outside it cannot bind. `group` is every consistent duplicate of the binding fact (same concept, period).
 * `concepts` (v0.2.1) is the field's concept family (twinFieldConcepts); `named` how the details name it.
 */
function bindFieldGroup(ix: Indexed, fm: TwinFieldMap, E: number, tolDays: number, anchor: ReadonlySet<string> | null,
  concepts: readonly string[] = fm.concepts, named = fm.concepts.join(' / ')): { result: TwinBindingResult; group: TwinFact[] } {
  const { twin } = ix
  const base = { field: fm.field, cell: fm.cell }
  const none = (reason: Unbound, detail: string): { result: TwinBindingResult; group: TwinFact[] } => ({ result: { ...base, bound: false, reason, detail }, group: [] })
  const anyContext = [...twin.contexts.values()].some((c) => !c.dimensional && periodMatch(c, fm.period, E, tolDays))
  if (!anyContext) return none('PERIOD_UNRESOLVED', `the twin has no non-dimensional ${fm.period} context for this period`)
  let sawNonUsd = false
  const offStatement: string[] = []
  for (const concept of concepts) {
    const g = conceptGroup(ix, concept, fm.period, E, tolDays, anchor)
    if (g.kind === 'off') { offStatement.push(concept); continue }
    if (g.kind === 'nonusd') { sawNonUsd = true; continue }
    if (g.kind === 'none') continue
    if (g.kind === 'conflict') return none('CONFLICTING_FACTS', g.detail)
    return { result: { ...base, bound: true, binding: { ...ref(twin, g.group[0]!), duplicates: g.group.length } }, group: g.group }
  }
  if (sawNonUsd) return none('NO_USD_FACT', `${named} is reported in the period only in a non-USD unit`)
  if (offStatement.length) return none('NOT_ON_STATEMENT', `${offStatement.join(' / ')} is reported in the ${fm.period} period, but the filing's presentation linkbase places none of ${named} on a face statement`)
  return none('NO_BINDING_FACT', `the twin reports none of ${named} (non-dimensional, USD) in the ${fm.period} period${anchor ? ' on a face statement' : ''}`)
}

/** Half a unit of a fact's declared precision (0.5 × 10^−decimals), or `tol` when it declares none. */
const halfUnit = (d: number | null, tol: number): number => (d !== null && Number.isFinite(d) ? Math.max(tol, 0.5 * 10 ** -d) : tol)

type FamilyBinding = { result: TwinBindingResult; group: TwinFact[] }

/** v0.2.1: the face lines of a field's concept family in one period, one per distinct value (priority order kept). */
function faceLines(ix: Indexed, concepts: readonly string[], period: TwinPeriod, E: number, tolDays: number, anchor: ReadonlySet<string>, tol: number): TwinFact[][] {
  const out: TwinFact[][] = []
  for (const concept of concepts) {
    const g = conceptGroup(ix, concept, period, E, tolDays, anchor)
    if (g.kind !== 'group') continue
    const v = g.group[0]!
    if (!out.some((o) => Math.abs(o[0]!.value - v.value) <= Math.max(halfUnit(o[0]!.decimals, tol), halfUnit(v.decimals, tol)) + 1e-9)) out.push(g.group)
  }
  return out
}

/**
 * v0.2.1 binding: the field's concept family (listed concepts first, then their scope variants), statement-anchored.
 * For a `roll` field whose face presents family lines with different values, the cash roll decides: the line that
 * closes start + change = end against a face line of the other endpoint (and the bound change) is the field's line;
 * if none or several close, the field is unbound (AMBIGUOUS_LINE) and the lines are returned as candidates.
 */
function bindFamily(ix: Indexed, map: TwinConceptMap, fm: TwinFieldMap, E: number, tolDays: number, anchor: ReadonlySet<string>, tol: number,
  change: () => TwinBindingResult | undefined): FamilyBinding {
  const concepts = twinFieldConcepts(map, fm)
  const named = `${fm.concepts.join(' / ')} (or a scope variant)`
  const first = bindFieldGroup(ix, fm, E, tolDays, anchor, concepts, named)
  if (!first.result.bound || !fm.roll) return first
  const own = faceLines(ix, concepts, fm.period, E, tolDays, anchor, tol)
  if (own.length <= 1) return first
  const { twin } = ix
  const base = { field: fm.field, cell: fm.cell }
  const lines = own.map((g): TwinBinding => ({ ...ref(twin, g[0]!), duplicates: g.length }))
  const show = lines.map((l) => `${l.concept} = ${l.value}`).join(', ')
  const partner = faceLines(ix, concepts, fm.period === 'prior_instant' ? 'instant' : 'prior_instant', E, tolDays, anchor, tol)
  const d = change()
  const closes = (o: TwinFact): boolean => d !== undefined && d.bound && partner.some((p) => {
    const [start, end] = fm.roll!.position === 'end' ? [p[0]!, o] : [o, p[0]!]
    const slack = halfUnit(start.decimals, tol) + halfUnit(end.decimals, tol) + halfUnit(d.binding.decimals, tol)
    return Math.abs(start.value + d.binding.value - end.value) <= slack + 1e-9
  })
  const fits = own.filter((g) => closes(g[0]!))
  if (fits.length !== 1) {
    const why = d === undefined || !d.bound ? `the period's net change (${fm.roll.change}) does not bind` : !partner.length ? 'the other end of the roll has no face line' : `${fits.length ? 'several' : 'none'} of them close${fits.length ? '' : 's'} the roll`
    return { result: { ...base, bound: false, reason: 'AMBIGUOUS_LINE', detail: `the face statement presents ${own.length} lines of the field's concept family in the ${fm.period} period (${show}), and ${why}`, candidates: lines }, group: [] }
  }
  const group = fits[0]!
  return { result: { ...base, bound: true, binding: { ...ref(twin, group[0]!), duplicates: group.length }, alternatives: lines.filter((l) => l.span.start !== group[0]!.span.start) }, group }
}

/**
 * v0.2.1 value anchors for a NOT_ON_STATEMENT field: each off-face fact of the field's family (its preferred period,
 * consistent duplicates) whose value a face-statement fact of the same period also reports. Only such a value is
 * anchored: the filer's own concept says the field is m, and the face statement prints m.
 */
function valueAnchors(ix: Indexed, concepts: readonly string[], fm: TwinFieldMap, E: number, tolDays: number, anchor: ReadonlySet<string>, tol: number): { fact: TwinFact; duplicates: number; face: TwinFact }[] {
  const { twin } = ix
  const out: { fact: TwinFact; duplicates: number; face: TwinFact }[] = []
  for (const concept of concepts) {
    if (anchor.has(concept)) continue
    const g = conceptGroup(ix, concept, fm.period, E, tolDays, null)
    if (g.kind !== 'group') continue
    const m = g.group[0]!
    const key = periodKey(twin.contexts.get(m.contextRef)!)
    const face = twin.facts.find((f) => isUsGaap(f) && anchor.has(f.concept) && usdOf(twin, f) && !twin.contexts.get(f.contextRef)!.dimensional
      && periodKey(twin.contexts.get(f.contextRef)!) === key && Math.abs(Math.abs(f.value) - Math.abs(m.value)) <= Math.max(halfUnit(f.decimals, tol), halfUnit(m.decimals, tol)) + 1e-9)
    if (face) out.push({ fact: m, duplicates: g.group.length, face })
  }
  return out
}

/**
 * v0.2.1 exact scale: the power of ten k (±3/6/9) with |value| × 10^−k equal to the fact's magnitude within the fact's
 * own declared rounding (or `tol`), i.e. the printed digits with the wrong multiplier. null when there is none.
 */
function exactScale(v: number, f: TwinFact | TwinFactRef, tol: number): number | null {
  const a = Math.abs(f.value)
  if (a === 0 || v === 0) return null
  for (const k of [3, 6, 9, -3, -6, -9]) {
    const scaled = k > 0 ? v / 10 ** k : v * 10 ** -k
    if (Math.abs(scaled - a) <= halfUnit(f.decimals, tol) + 1e-9) return k
  }
  return null
}

function bindField(ix: Indexed, fm: TwinFieldMap, E: number, tolDays: number): TwinBindingResult {
  return bindFieldGroup(ix, fm, E, tolDays, null).result
}

/** v0.2 prerequisites: the anchor set, or why every claim abstains. A null anchor with no abstain = v0.1 (document binding). */
function statementAnchor(map: TwinConceptMap, p: TwinPresentation | null | undefined):
  { anchor: ReadonlySet<string> | null; abstain?: { reason: 'NO_PRESENTATION_LINKBASE' | 'NO_STATEMENT_ROLES'; detail: string } } {
  if ((map.binding ?? 'document') !== 'statement') return { anchor: null }
  if (!p) return { anchor: null, abstain: { reason: 'NO_PRESENTATION_LINKBASE', detail: `the ruleset ${map.id}@${map.version} binds through the filing's presentation linkbase, and none was supplied or readable` } }
  if ((map.links ?? 'v0.2') === 'strict' && p.links !== 'strict') return { anchor: null, abstain: { reason: 'NO_PRESENTATION_LINKBASE', detail: `the ruleset ${map.id}@${map.version} binds through the strict reading of the presentation linkbase (parseTwinPresentation(…, { links: 'strict' })), and the presentation supplied (sha256 ${p.sha256.slice(0, 12)}…) was read the v0.2 way` } }
  if (!p.statementRoles.length) return { anchor: null, abstain: { reason: 'NO_STATEMENT_ROLES', detail: `the presentation linkbase (sha256 ${p.sha256.slice(0, 12)}…) identifies no face-statement role (source: ${p.source})` } }
  return { anchor: new Set(p.statementConcepts) }
}

/**
 * Every mapped field's binding fact, agent-independent (what the twin itself says each field is). For a
 * statement-anchored map (v0.2) pass `presentation`; without one every field is unbound (NO_PRESENTATION_LINKBASE).
 */
export function bindTwinFields(twin: InlineXbrl | string, opts: Pick<TwinOptions, 'periodEnd' | 'periodToleranceDays' | 'map' | 'presentation'>): TwinBindingResult[] {
  const tw = typeof twin === 'string' ? parseInlineXbrl(twin) : twin
  const ix = indexed(tw)
  const E = ms(opts.periodEnd)
  const tolDays = opts.periodToleranceDays ?? 7
  const map = opts.map ?? FS_CORE_TWIN_MAP
  const st = statementAnchor(map, opts.presentation)
  const ab = st.abstain
  if (ab) return map.fields.map((fm): TwinBindingResult => ({ field: fm.field, cell: fm.cell, bound: false, reason: ab.reason, detail: ab.detail }))
  if ((map.family ?? 'map') === 'scope-variants' && st.anchor) {
    const fam = familyBinder(ix, map, E, tolDays, st.anchor, 0.5)
    return map.fields.map((fm) => fam(fm).result)
  }
  return map.fields.map((fm) => (st.anchor ? bindFieldGroup(ix, fm, E, tolDays, st.anchor).result : bindField(ix, fm, E, tolDays)))
}

/** v0.2.1: every field's family binding, memoized per call (a roll field reads its change field's binding). */
function familyBinder(ix: Indexed, map: TwinConceptMap, E: number, tolDays: number, anchor: ReadonlySet<string>, tol: number): (fm: TwinFieldMap) => FamilyBinding {
  const memo = new Map<string, FamilyBinding>()
  const bind = (fm: TwinFieldMap): FamilyBinding => {
    const hit = memo.get(fm.field)
    if (hit) return hit
    const changeFm = fm.roll ? map.fields.find((f) => f.field === fm.roll!.change && !f.roll) : undefined
    const r = bindFamily(ix, map, fm, E, tolDays, anchor, tol, () => (changeFm ? bind(changeFm).result : undefined))
    memo.set(fm.field, r)
    return r
  }
  return bind
}

function diagnose(ix: Indexed, fm: TwinFieldMap, b: TwinBinding, v: number, tol: number, E: number, tolDays: number, concepts: readonly string[] = fm.concepts): { diagnosis: TwinDiagnosis; matches: TwinFactRef[] } {
  const { twin } = ix
  const bv = Math.abs(b.value)
  if (bv !== 0) for (const k of [3, 6, 9]) for (const r of [10 ** k, 10 ** -k]) if (Math.abs(v / bv - r) <= 0.001 * r) return { diagnosis: 'SCALE', matches: [] }
  const equal: TwinFact[] = []
  for (let k = Math.round(v) - 1; k <= Math.round(v) + 1; k++) for (const f of ix.byMagnitude.get(k) ?? []) if (Math.abs(Math.abs(f.value) - v) <= tol && usdOf(twin, f)) equal.push(f)
  equal.sort((a, c) => a.span.start - c.span.start)
  const ctx = (f: TwinFact): TwinContext => twin.contexts.get(f.contextRef)!
  const own = (f: TwinFact): boolean => isUsGaap(f) && concepts.includes(f.concept)
  const inPeriod = (f: TwinFact): boolean => periodMatch(ctx(f), fm.period, E, tolDays)
  const pick = (fs: TwinFact[]): TwinFactRef[] => fs.slice(0, 3).map((f) => ref(twin, f))
  const period = equal.filter((f) => own(f) && !ctx(f).dimensional && periodKey(ctx(f)) !== b.period)
  if (period.length) return { diagnosis: 'PERIOD', matches: pick(period) }
  const concept = equal.filter((f) => !ctx(f).dimensional && inPeriod(f) && !(isUsGaap(f) && f.concept === b.concept))
  if (concept.length) return { diagnosis: 'CONCEPT', matches: pick(concept) }
  const dim = equal.filter((f) => own(f) && ctx(f).dimensional && inPeriod(f))
  if (dim.length) return { diagnosis: 'DIMENSION', matches: pick(dim) }
  return { diagnosis: 'UNLOCATED', matches: [] }
}

const INSUFFICIENCY: Record<TwinAbstainReason, InsufficiencyReason> = {
  NO_TWIN: 'REFERENCE_NOT_PROVIDED',
  FIELD_NOT_MAPPED: 'OUT_OF_RULESET_SCOPE',
  PERIOD_UNRESOLVED: 'REFERENCE_NOT_PROVIDED',
  NO_BINDING_FACT: 'REFERENCE_NOT_PROVIDED',
  NO_USD_FACT: 'AMBIGUOUS_UNIT',
  CONFLICTING_FACTS: 'AMBIGUOUS_REFERENCE',
  VALUE_UNPARSEABLE: 'UNPARSEABLE',
  NO_PRESENTATION_LINKBASE: 'REFERENCE_NOT_PROVIDED',
  NO_STATEMENT_ROLES: 'REFERENCE_NOT_PROVIDED',
  NOT_ON_STATEMENT: 'REFERENCE_NOT_PROVIDED',
  ROUNDED_BINDING: 'AMBIGUOUS_REFERENCE',
  AMBIGUOUS_LINE: 'AMBIGUOUS_REFERENCE',
}

/** The inputs a twin verdict's input_hash commits to (pass them to verifyReplay to check the binding). */
export function twinVerdictInput(twinSha256: string, claims: readonly TwinClaim[], opts: TwinOptions): unknown {
  const map = opts.map ?? FS_CORE_TWIN_MAP
  const input = {
    twin_sha256: twinSha256,
    period_end: opts.periodEnd,
    period_tolerance_days: opts.periodToleranceDays ?? 7,
    tolerance: opts.tolerance ?? 0.5,
    map: `${map.id}@${map.version}`,
    claims: claims.map((c) => ({ id: c.id, field: c.field, value: Number.isFinite(c.value) ? c.value : null })),
  }
  // v0.2 commits to the presentation it bound through; v0.1's input is unchanged, byte for byte
  return (map.binding ?? 'document') === 'statement' ? { ...input, presentation_sha256: opts.presentation?.sha256 ?? null } : input
}

function factEvidence(twinSha: string, b: TwinFactRef, format: string): Evidence[] {
  return [
    { locator: { kind: 'span', source_hash: twinSha, start: b.span.start, end: b.span.end }, value: b.value, original: b.displayed,
      normalizations: [`ix:scale=${b.scale}`, ...(b.sign === -1 ? ['ix:sign=-'] : []), `ix:format=${format || 'none'}`], confidence: 100, role: 'REFERENCE' },
    { locator: { kind: 'field', source: 'evidence', path: `contexts["${b.context}"]` }, value: b.period, confidence: 100, role: 'CONTEXT' },
  ]
}

/** Judge claims against the twin. `twin` is the iXBRL HTML, or an already-parsed twin. */
export function verifyAgainstTwin(twin: InlineXbrl | string, claims: readonly TwinClaim[], opts: TwinOptions): TwinResult {
  const tw = typeof twin === 'string' ? parseInlineXbrl(twin) : twin
  const ix = indexed(tw)
  const map = opts.map ?? FS_CORE_TWIN_MAP
  const tol = opts.tolerance ?? 0.5
  const tolDays = opts.periodToleranceDays ?? 7
  const E = ms(opts.periodEnd)
  if (!Number.isFinite(E)) throw new RangeError(`periodEnd must be YYYY-MM-DD (got ${JSON.stringify(opts.periodEnd)})`)
  const gate = twinGate(tw, opts.periodEnd, tolDays)
  const statementMode = (map.binding ?? 'document') === 'statement'
  const decimalsMode = (map.matching ?? 'exact') === 'decimals'
  const st = statementAnchor(map, opts.presentation)
  // v0.2.1 (family 'scope-variants', scale 'anchored') act only through the face, i.e. with a statement anchor
  const fam = (map.family ?? 'map') === 'scope-variants' && st.anchor ? familyBinder(ix, map, E, tolDays, st.anchor, tol) : null
  const scaleAnchored = (map.scale ?? 'diagnose') === 'anchored' && st.anchor !== null
  const formatAt = new Map(tw.facts.map((f) => [f.span.start, f.format]))
  const judgments: TwinJudgment[] = [], out: ClaimVerdict[] = []
  // engine 0.6.0: a claim the twin cannot judge says can't tell in its explanation (earlier engines: "abstaining")
  const cantTellWord = engineAtLeast(engineFor(opts.engine), '0.6.0') ? "can't tell" : 'abstaining'

  for (const c of claims) {
    const fm = map.fields.find((f) => f.field === c.field)
    const base = { claim_id: `${c.id}.twin`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: c.field,
      asserted: Number.isFinite(c.value) ? c.value : null, rule_id: 'TWIN_FACT', rule_name: "Extracted value equals the filing's binding XBRL fact", locked: false }
    const abstain = (reason: TwinAbstainReason, detail: string, binding?: TwinBinding, candidates?: TwinFactRef[]): void => {
      judgments.push({ claim_id: c.id, field: c.field, cell: fm?.cell ?? null, value: c.value, outcome: 'INSUFFICIENT_DATA', reason, detail, ...(binding ? { binding } : {}), ...(candidates ? { candidates } : {}) })
      out.push({ ...base, outcome: 'INSUFFICIENT_DATA', evidence: [], insufficiency: { reason: INSUFFICIENCY[reason], detail: `${reason}: ${detail}` }, explanation: `${c.field}: ${detail}; ${cantTellWord}.` })
    }
    if (!Number.isFinite(c.value)) { abstain('VALUE_UNPARSEABLE', `the asserted value ${JSON.stringify(String(c.value))} is not a finite number`); continue }
    if (!fm) { abstain('FIELD_NOT_MAPPED', `the map ${map.id}@${map.version} does not define "${c.field}"`); continue }
    if (!gate) { abstain('NO_TWIN', `the twin (sha256 ${tw.sha256.slice(0, 12)}…) has no non-dimensional USD fact dated within ${tolDays} days of ${opts.periodEnd}`); continue }
    if (st.abstain) { abstain(st.abstain.reason, st.abstain.detail); continue }
    const { result: b, group } = fam ? fam(fm) : statementMode ? bindFieldGroup(ix, fm, E, tolDays, st.anchor) : { result: bindField(ix, fm, E, tolDays), group: [] as TwinFact[] }
    if (!b.bound) {
      // v0.2.1 anchored scale: an exact power-of-ten error against an anchored figure is a FAIL even though the field does not bind
      if (scaleAnchored && (b.reason === 'NOT_ON_STATEMENT' || b.reason === 'AMBIGUOUS_LINE')) {
        const v = Math.abs(c.value)
        const hit = b.reason === 'AMBIGUOUS_LINE'
          ? (b.candidates ?? []).map((l) => ({ k: exactScale(v, l, tol), fact: l, face: undefined as TwinFactRef | undefined })).find((x) => x.k !== null)
          : valueAnchors(ix, twinFieldConcepts(map, fm), fm, E, tolDays, st.anchor!, tol)
            .map((a) => ({ k: exactScale(v, a.face, tol) ?? exactScale(v, a.fact, tol), fact: { ...ref(tw, a.fact), duplicates: a.duplicates } as TwinBinding, face: ref(tw, a.face) as TwinFactRef | undefined })).find((x) => x.k !== null)
        if (hit) {
          const f = hit.fact
          const signOk = c.value === 0 || f.value === 0 || Math.sign(c.value) === Math.sign(f.value)
          const at = (r: TwinFactRef): string => `${r.concept} @ ${r.period} ("${r.displayed}" × 10^${r.scale}${r.sign === -1 ? ', sign −' : ''} = ${r.value})`
          const how = hit.face
            ? `value-anchored: the field's concept reports ${at(f)} off the face statements, and the face statement prints it as ${at(hit.face)}`
            : `a face line of the field's concept family, ${at(f)}; ${b.detail}`
          const why = `off by a power of ten (${c.value} is exactly 10^${hit.k} × ${f.value})`
          const ev = factEvidence(tw.sha256, f, formatAt.get(f.span.start) ?? '')
          ev[0]!.normalizations!.push('twin:statement-anchored', hit.face ? 'twin:value-anchored' : 'twin:family-line')
          if (hit.face) ev.push({ locator: { kind: 'span', source_hash: tw.sha256, start: hit.face.span.start, end: hit.face.span.end }, value: hit.face.value, original: hit.face.displayed, confidence: 100, role: 'CONTEXT' })
          const computation = { formula: '|value| = |fact| (fact = sign × displayed × 10^scale)', operands: { fact: f.value, displayed: f.displayed, scale: f.scale }, result: f.value, tolerance: { abs: tol } }
          judgments.push({ claim_id: c.id, field: c.field, cell: fm.cell, value: c.value, outcome: 'FAIL', reason: 'MISMATCH', detail: `${why}; ${how}`, binding: f, diagnosis: 'SCALE',
            ...(hit.face ? { anchor: hit.face } : { candidates: b.candidates }), sign_matches_xbrl: signOk })
          out.push({ ...base, outcome: 'FAIL', evidence: ev, computation, variance: v - Math.abs(f.value), explanation: `${c.field} = ${c.value}: ${why}; ${how}. [SCALE]` })
          continue
        }
      }
      abstain(b.reason, b.detail, undefined, b.candidates)
      continue
    }
    const bind = b.binding
    const v = Math.abs(c.value), bv = Math.abs(bind.value)
    const signOk = c.value === 0 || bind.value === 0 || Math.sign(c.value) === Math.sign(bind.value)
    const where = `${bind.concept} @ ${bind.period} ("${bind.displayed}" × 10^${bind.scale}${bind.sign === -1 ? ', sign −' : ''} = ${bind.value})`
    // v0.2 decimals-aware: a consistent duplicate of the binding fact, reported at its own precision, is the same fact
    const dup = decimalsMode && Math.abs(v - bv) > tol ? group.find((f) => Math.abs(v - Math.abs(f.value)) <= tol) : undefined
    const shown: TwinFactRef = dup ? ref(tw, dup) : bind
    const ev = factEvidence(tw.sha256, shown, formatAt.get(shown.span.start) ?? '')
    if (statementMode) ev[0]!.normalizations!.push('twin:statement-anchored')
    const computation = { formula: '|value| = |fact| (fact = sign × displayed × 10^scale)', operands: { fact: shown.value, displayed: shown.displayed, scale: shown.scale }, result: shown.value, tolerance: { abs: tol } }
    if (Math.abs(v - bv) <= tol || dup) {
      const asDup = dup ? `; matched as reported to decimals ${dup.decimals === null ? 'none' : dup.decimals} ("${dup.displayed}" × 10^${dup.scale} = ${dup.value}), a consistent duplicate` : ''
      judgments.push({ claim_id: c.id, field: c.field, cell: fm.cell, value: c.value, outcome: 'PASS', reason: 'MATCH', detail: `equals the binding fact ${where}${asDup}`, binding: bind, sign_matches_xbrl: signOk })
      out.push({ ...base, outcome: 'PASS', locked: true, evidence: ev, computation,
        explanation: `${c.field} = ${c.value}: the filing's binding fact is ${where}${asDup}.${signOk ? '' : ' (Sign differs from the XBRL value; sign is not judged.)'}` })
      continue
    }
    // v0.2.1: the value is another face line of the field's concept family, one the cash roll did not pick
    const alt = b.alternatives?.find((a) => Math.abs(v - Math.abs(a.value)) <= halfUnit(a.decimals, tol) + 1e-9)
    if (alt) {
      abstain('AMBIGUOUS_LINE', `${c.value} is ${alt.concept} @ ${alt.period}, a face line of the field's concept family, but the statement's cash roll closes on ${where}`, bind, b.alternatives)
      continue
    }
    if (decimalsMode && bind.decimals !== null && Number.isFinite(bind.decimals) && Math.abs(v - bv) <= 0.5 * 10 ** -bind.decimals + 1e-9) {
      abstain('ROUNDED_BINDING', `the binding fact ${where} is reported only to decimals ${bind.decimals} (± ${0.5 * 10 ** -bind.decimals}); ${c.value} is consistent with it at that precision but equals none of its reported figures`, bind)
      continue
    }
    const d = fam ? diagnose(ix, fm, bind, v, tol, E, tolDays, twinFieldConcepts(map, fm)) : diagnose(ix, fm, bind, v, tol, E, tolDays)
    const why = d.diagnosis === 'SCALE' ? `off by a power of ten (${c.value} vs ${bind.value})`
      : d.diagnosis === 'PERIOD' ? `it is ${d.matches[0]!.concept} for ${d.matches[0]!.period}, another period`
      : d.diagnosis === 'CONCEPT' ? `it is ${d.matches.map((m) => m.concept).join(' / ')} in the period, another concept`
      : d.diagnosis === 'DIMENSION' ? `it is a dimensional (segment / member) fact of the concept, not the consolidated figure`
      : 'the twin reports that magnitude nowhere'
    judgments.push({ claim_id: c.id, field: c.field, cell: fm.cell, value: c.value, outcome: 'FAIL', reason: 'MISMATCH', detail: `${why}; the binding fact is ${where}`, binding: bind, diagnosis: d.diagnosis, ...(d.matches.length ? { matches: d.matches } : {}), sign_matches_xbrl: signOk })
    out.push({ ...base, outcome: 'FAIL', evidence: [...ev, ...d.matches.map((m): Evidence => ({ locator: { kind: 'span', source_hash: tw.sha256, start: m.span.start, end: m.span.end }, value: m.value, original: m.displayed, confidence: 100, role: 'CONTEXT' }))],
      computation, variance: v - bv, explanation: `${c.field} = ${c.value}: ${why}. The filing's binding fact is ${where}. [${d.diagnosis}]` })
  }

  const coverage: Coverage = { claims_total: out.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 }
  for (const c of out) { if (c.outcome === 'PASS') coverage.claims_pass++; else if (c.outcome === 'FAIL') coverage.claims_fail++; else coverage.claims_insufficient++ }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  const input = twinVerdictInput(tw.sha256, claims, opts) as { claims: unknown }
  const input_hash = hashOf(input)
  const ruleset = { id: map.id, version: map.version, domain: map.domain }
  // Engine 0.2.0: the id also binds the remedy table; the twin declares none (every remedy is derived), so it is the empty table.
  const identity = verdictIdentity(input_hash, ruleset, engineFor(opts.engine), {})
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id: identity.verdict_id,
    issued_at: (opts.now ?? (() => new Date()))().toISOString(), engine_version: engineFor(opts.engine), ruleset, input_hash,
    ...(identity.remedy_table_hash !== undefined ? { remedy_table_hash: identity.remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(input.claims), ...(opts.producer !== undefined ? { producer: opts.producer } : {}), line_items: claims.length },
    references: { contract: false, evidence: statementMode ? 2 : 1, history: 0, source: true },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims: out, coverage,
  }
  // Typed remedies (verdict/remedy.ts): derived from each claim's insufficiency; a FAIL says `none`. Outside the hashed core.
  attachScope(attachRemedies(verdict, { document: 'filing' }))
  const p = opts.presentation
  const presentation = p ? { sha256: p.sha256, source: p.source, statement_roles: p.statementRoles.length, statement_concepts: p.statementConcepts.length, ...(p.links ? { links: p.links } : {}) } : null
  return { verdict, judgments, twin: { sha256: tw.sha256, facts: tw.facts.length, contexts: tw.contexts.size, gate, ...(statementMode ? { presentation } : {}) } }
}
