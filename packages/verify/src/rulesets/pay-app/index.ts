/**
 * RULESET: construction pay application (AIA G702 / G703).
 *
 * Always runs (single-document coherence): every footing law of the two forms — see ./axioms.ts.
 * Runs only when the PREVIOUS application is supplied as `references.history` (else REFERENCE_NOT_PROVIDED):
 *   G703_PREV  this application's "from previous applications" = the previous application's "completed to date", per item
 *   G702_PREV  this application's "less previous certificates"  = the previous application's "total earned less retainage"
 *
 * Honesty specifics of this ruleset:
 *   - Blank G703 cells D / E / F are conventionally zero; an absent one is treated as 0 and the formula SAYS so. If all
 *     three are absent the total cannot be recomputed and the check abstains.
 *   - A percent-complete value given as a bare number in (0, 1] is AMBIGUOUS (1 = 1% or 100%?) → AMBIGUOUS_UNIT.
 *     Send "45%" or 45. Zero and values above 1 are unambiguous.
 *   - Matching a line to the previous application is by item number ONLY. No item number, or several previous lines
 *     with the same number → no verdict (never by position, never by description similarity).
 *   - Several history documents → the one with the highest application number is "previous"; if numbers are missing
 *     the reference is ambiguous → AMBIGUOUS_REFERENCE.
 *   - Engine 0.6.0 (2026-10-06): the G702's own retainage split, lines 5a and 5b, is read from
 *     retainage_rate { completed_work, stored_materials }; a rate given as any other object or an array is refused by name
 *     (InputRefused), never read as "no rate". A schedule line the application marks unapproved ("pending owner approval", a
 *     status field, approved: false) that bills work is a person's decision, the owner clearing it.
 */

import type { BoundValue, UniversalRole } from '../../kernel/types.js'
import { normalizeAmount, normalizeRate, normalizeReference } from '../../binding/forensic-normalizer.js'
import { evidenceFromBinding } from '../../verdict/from-report.js'
import type { Evidence } from '../../verdict/schema.js'
import { PAY_APP_RULESET_REF } from '../../version.js'
import { CURRENCY_TOLERANCE, PAY_APP_AXIOMS, PAY_APP_DOCUMENT_AXIOMS, PAY_APP_LINE_AXIOMS, PAY_APP_REMEDIES, PAY_APP_REMEDIES_V060 } from './axioms.js'
import { PAY_APP_LINE_ARRAY_KEYS, PAY_APP_ONTOLOGY } from './ontology.js'
import { computed, num, round4, type Absence, type AbsenceMap, type ComputeInput, type ComputeOutput, type FinishContext, type Json, type Ruleset } from '../types.js'
import { documentFormat, foldKey, nearMissArrayKey, refuseNearMissKeys, strictenBindings, strictNumberText, type DocumentFormat, type Refusals } from '../strict.js'
import type { ClaimVerdict } from '../../verdict/schema.js'
import { engineAtLeast } from '../../version.js'
import { InputRefused } from '../../protocol/input.js'

export { PAY_APP_AXIOMS, PAY_APP_LINE_AXIOMS, PAY_APP_DOCUMENT_AXIOMS, PAY_APP_REMEDIES, PAY_APP_REMEDIES_V060, CURRENCY_TOLERANCE, PERCENT_TOLERANCE } from './axioms.js'
export { PAY_APP_ONTOLOGY } from './ontology.js'

type Bindings = Partial<Record<UniversalRole, BoundValue>>

function operandEvidence(b: Bindings, roles: UniversalRole[]): Evidence[] {
  const out: Evidence[] = []
  for (const r of roles) if (b[r]) out.push(evidenceFromBinding(r, b[r] as BoundValue))
  return out
}

/**
 * Bound line amounts for a role across all lines — or the reasons some lines could not contribute. `refused` (engine 0.6.0,
 * ../strict.ts) names the lines whose value was refused; their reason is given instead, and `anyRefused` says the sum is
 * UNPARSEABLE rather than missing. Empty below 0.6.0, so the result reads exactly as before.
 */
function column(lineCtxs: ComputeInput['lineCtxs'], role: UniversalRole, lineKey: string, refused: readonly Refusals[] = []): { values: BoundValue[]; problems: string[]; anyRefused: boolean } {
  const values: BoundValue[] = []
  const problems: string[] = []
  let anyRefused = false
  lineCtxs.forEach((ctx, i) => {
    const b = ctx.bindings[role]
    const r = refused[i]?.[role]
    if (r !== undefined) { anyRefused = true; problems.push(`${lineKey}[${i}]: ${typeof r === 'string' ? r : r.detail}`) }
    else if (b && num(b) !== null) values.push({ ...b, field: b.field.replace('[*]', `[${i}]`) })
    else problems.push(`${lineKey}[${i}]: ${role} missing or unparseable`)
  })
  return { values, problems, anyRefused }
}

/**
 * A pay application handed over inside another object (engine 0.6.0, 2026-10-05): the first object, at most
 * three levels down, that carries a schedule-of-values array. Its path ("extraction", "pay_app.g703") and the array's key.
 */
function findWrapped(doc: Json, depth = 3, prefix = ''): { path: string; key: string } | null {
  if (depth === 0) return null
  for (const [k, v] of Object.entries(doc)) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
    const inner = lineArrayOf(v as Json)
    if (inner) return { path: `${prefix}${k}`, key: inner.key }
    const deeper = findWrapped(v as Json, depth - 1, `${prefix}${k}.`)
    if (deeper) return deeper
  }
  return null
}

/** The document-level roles of the pay-app ontology (G702 lines), in mapping order. */
const DOCUMENT_ROLES: readonly UniversalRole[] = [...new Set(PAY_APP_ONTOLOGY.mappings.filter(m => !m.fieldPath.includes('[*]')).map(m => m.role))]

// ---------------------------------------------------------------- history (the previous application)
const ITEM_KEYS = ['item_no', 'item_number', 'item', 'line_no', 'line_number', 'no', 'id', 'number', 'cost_code']
const COMPLETED_KEYS = ['completed_to_date', 'total_completed_and_stored', 'total_completed_and_stored_to_date', 'total_completed_stored_to_date', 'total_to_date', 'completed_and_stored', 'total_completed', 'total_completed_stored']
const EARNED_KEYS = ['total_earned_less_retainage', 'earned_less_retainage', 'net_earned', 'total_earned_less_retention']
const APP_NO_KEYS = ['application_number', 'application_no', 'pay_app_number', 'pay_application_number', 'app_no', 'invoice_number', 'number']
const DOC_ROOTS = ['', 'summary.', 'g702.', 'application.', 'totals.']

function get(obj: Json, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (part === '') continue
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Json)[part]
  }
  return cur
}
function firstKey(obj: Json, keys: string[], roots: string[] = ['']): { path: string; value: unknown } | null {
  for (const r of roots) for (const k of keys) {
    const v = get(obj, `${r}${k}`)
    if (v !== undefined && v !== null && v !== '') return { path: `${r}${k}`, value: v }
  }
  return null
}
function itemIdOf(line: Json): string | null {
  const hit = firstKey(line, ITEM_KEYS)
  if (!hit) return null
  const n = normalizeReference(hit.value)
  return n?.success ? n.normalized : String(hit.value).trim()
}
function lineArrayOf(doc: Json): { key: string; lines: Json[] } | null {
  for (const k of PAY_APP_LINE_ARRAY_KEYS) {
    const v = doc[k]
    if (Array.isArray(v)) return { key: k, lines: v.filter((x): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)) }
  }
  return null
}
function appNumber(doc: Json): number | null {
  const hit = firstKey(doc, APP_NO_KEYS, DOC_ROOTS)
  if (!hit) return null
  const m = String(hit.value).match(/(\d+)(?!.*\d)/)
  return m ? Number(m[1]) : null
}

/** Pick the previous application out of the supplied history, or explain why that is not possible. */
function previousApplication(history: Json[]): { index: number; doc: Json } | Absence {
  if (history.length === 0) return 'no previous application supplied'
  if (history.length === 1) return { index: 0, doc: history[0] as Json }
  const numbered = history.map((d, i) => ({ i, n: appNumber(d) }))
  if (numbered.some(x => x.n === null)) {
    return { reason: 'AMBIGUOUS_REFERENCE', detail: `${history.length} history documents supplied and not all carry an application number; cannot tell which is the previous application` }
  }
  numbered.sort((a, b) => (b.n as number) - (a.n as number))
  const top = numbered[0] as { i: number; n: number }
  if (numbered[1] && numbered[1].n === top.n) {
    return { reason: 'AMBIGUOUS_REFERENCE', detail: `two history documents share application number ${top.n}` }
  }
  return { index: top.i, doc: history[top.i] as Json }
}

/**
 * Bind a history amount with full provenance (source 'history', path into the caller's document). Under engine 0.6.0 (`strict`)
 * a text amount must read strictly (../strict.ts), else it is refused: the returned string says why.
 */
function historyAmount(path: string, raw: unknown, strict = false, format?: DocumentFormat): BoundValue | string | null {
  if (strict && typeof raw === 'string' && raw.trim() !== '') {
    const s = strictNumberText(raw, 'amount', format)
    if (!s.ok) return `${path} is ${JSON.stringify(raw)}, which does not read as one number (${s.why}): not read, never guessed`
  }
  const n = normalizeAmount(raw)
  if (!n?.success) return null
  return {
    value: n.normalized, source: 'history', field: path, confidence: 100,
    originalValue: (n.original ?? raw) as string | number | null, normalizedValue: n.normalized, normalizations: n.transformations,
  }
}

// ---------------------------------------------------------------- retainage (engine 0.6.0)
const RATE_KEYS = ['retainage_rate', 'retainage_percent', 'retainage_percentage', 'retention_rate', 'retainage_pct', 'retention_percent']
/** A rate as a fraction ("10%" and 10 read 0.1), or null. */
function rateOf(raw: unknown): number | null {
  const n = normalizeRate(raw)
  return n?.success && Number.isFinite(n.normalized) ? n.normalized : null
}
/**
 * Engine 0.6.0: where an application states a lower retainage. A schedule line's own rate (any RATE_KEYS
 * name on the line), and a reduced rate the application states for the period, optionally naming the items it covers.
 */
const REDUCED_RATE_KEYS = ['reduced_retainage_rate', 'retainage_rate_reduced', 'retainage_reduced_rate', 'reduced_retention_rate', 'retention_rate_reduced']
const REDUCED_ITEMS_KEYS = ['reduced_retainage_items', 'reduced_retainage_applies_to', 'retainage_reduced_items']
/** A stated rate read from the extraction: the fraction and its binding (evidence), or why it does not read. */
type StatedRate = { rate: number; bound: BoundValue } | { unreadable: string }
function statedRate(source: BoundValue['source'], path: string, raw: unknown): StatedRate {
  const n = normalizeRate(raw)
  if (!n?.success || !Number.isFinite(n.normalized)) return { unreadable: `${path} is ${JSON.stringify(raw)}, which does not read as a rate` }
  return { rate: n.normalized, bound: { value: n.normalized, source, field: path, confidence: 100, originalValue: (n.original ?? raw) as string | number | null, normalizedValue: n.normalized, normalizations: n.transformations } }
}
/**
 * Engine 0.6.0 (2026-10-06): a rate given as an object or an array is refused by name (exit 3 at the command line), never read
 * as "no rate". Before, an object retainage_rate was read as absent and the previous application's rate applied instead.
 * The one object a rate may be is the application's own split, read by statedSplit.
 */
function refuseObjectRate(path: string, raw: unknown, what: string): void {
  if (raw === null || typeof raw !== 'object') return
  const shown = JSON.stringify(raw) ?? ''
  throw new InputRefused('extraction', `verify: ${path} is ${Array.isArray(raw) ? 'an array' : 'an object'} (${shown.length > 80 ? `${shown.slice(0, 79)}…` : shown}), where ${what}`)
}

/**
 * The G702's own retainage split (engine 0.6.0, 2026-10-06): lines 5a and 5b of the form retain one rate on completed work
 * (columns D + E of the continuation sheet) and another on stored material (column F). The application states it as
 * `retainage_rate: { "completed_work": "10%", "stored_materials": "0%" }`. Null when the rate is not an object. Any other
 * object or an array, or a part that does not read as a rate, is refused by name.
 */
interface StatedSplit { work: number; stored: number; workBound: BoundValue; storedBound: BoundValue; path: string }
const SPLIT_SHAPE = '{ "completed_work": "10%", "stored_materials": "0%" } (the G702\'s lines 5a and 5b)'
function statedSplit(extraction: Json): StatedSplit | null {
  const hit = firstKey(extraction, RATE_KEYS, DOC_ROOTS)
  if (!hit || hit.value === null || typeof hit.value !== 'object') return null
  const v = hit.value as Json
  if (Array.isArray(v) || Object.keys(v).sort().join(',') !== 'completed_work,stored_materials') {
    refuseObjectRate(hit.path, v, `a rate is expected: give one rate ("10%"), or the split by line of the form, ${SPLIT_SHAPE}`)
  }
  const w = statedRate('invoice', `${hit.path}.completed_work`, v.completed_work)
  const s = statedRate('invoice', `${hit.path}.stored_materials`, v.stored_materials)
  for (const x of [w, s]) if ('unreadable' in x) throw new InputRefused('extraction', `verify: ${x.unreadable}: each part of ${SPLIT_SHAPE} is a rate`)
  const W = w as { rate: number; bound: BoundValue }, S = s as { rate: number; bound: BoundValue }
  return { work: W.rate, stored: S.rate, workBound: W.bound, storedBound: S.bound, path: hit.path }
}

/**
 * G702_RATE under the application's own split (engine 0.6.0, 2026-10-06): line 5 = the work rate × completed work (line 4 less
 * the stored materials of column F) + the stored rate × stored materials. At it: PASS, naming both parts. Above it: the claim
 * FAILs (more retained than the split allows). Under it: a person decides, the dollar difference first.
 */
function splitRetainage(x: { B: Bindings; L4: number; L5: number | null; split: StatedSplit; lineCtxs: ComputeInput['lineCtxs']; refusedLines: readonly Refusals[] }): ({ bound: BoundValue } | { absence: Absence }) & { rates: BoundValue[]; stored: BoundValue[] } {
  const { split } = x
  const rates = [split.workBound, split.storedBound]
  const stored: BoundValue[] = []
  let F = 0
  for (let i = 0; i < x.lineCtxs.length; i++) {
    const r = x.refusedLines[i]?.MATERIALS_STORED
    if (r !== undefined) return { absence: { reason: 'UNPARSEABLE', detail: `${typeof r === 'string' ? r : r.detail}; the stored materials of line ${i + 1} are needed for the split (lines 5a and 5b), and a refused value is never read as 0` }, rates, stored }
    const b = x.lineCtxs[i]!.bindings.MATERIALS_STORED
    const v = num(b)
    if (b && v !== null) { F += v; stored.push({ ...b, field: b.field.replace('[*]', `[${i}]`) }) }
  }
  F = round4(F)
  const work = round4(x.L4 - F)
  const wAmt = round4(work * split.work), sAmt = round4(F * split.stored), expected = round4(wAmt + sAmt)
  const parts = `${plainPct(split.work)} of completed work, ${plainMoney(work)} (line 4 less stored materials), is ${plainMoney(wAmt)}, and ${plainPct(split.stored)} of stored materials, ${plainMoney(F)}, is ${plainMoney(sAmt)}`
  if (x.L5 === null || x.L5 >= expected - CURRENCY_TOLERANCE) {
    return { bound: computed(expected, `the total retainage is the application's own split, lines 5a and 5b: ${parts}`, [x.B.TOTAL_COMPLETED_STORED as BoundValue, ...rates, ...stored]), rates, stored }
  }
  const diff = round4(expected - x.L5)
  return { absence: { reason: 'AMBIGUOUS_REFERENCE', detail: `${plainMoney(diff)} less retained than the application's own split, lines 5a and 5b (${parts}: ${plainMoney(expected)} in all; the total retainage says ${plainMoney(x.L5)}). A person confirms the retainage terms before it is paid` }, rates, stored }
}

/**
 * A schedule line the application marks unapproved (engine 0.6.0, 2026-10-06): its description says "pending owner
 * approval", "unapproved", "not approved", "awaiting approval", "subject to approval", "proposed", "unsigned", "not executed",
 * "disputed", "rejected", or carries PCO or COR (a pending change order, a change order request); or a status field says so; or
 * an approved field is false. The words that say where, or null.
 */
const UNAPPROVED = /\b(?:pending(?:\s+(?:owner\s+|architect\s+)?approval)?|unapproved|not\s+(?:yet\s+)?approved|awaiting\s+(?:owner\s+|architect\s+)?approval|approval\s+pending|subject\s+to\s+(?:owner\s+)?approval|proposed|unsigned|not\s+(?:yet\s+)?executed|disputed|rejected)\b/i
const UNAPPROVED_CODES = /\b(?:PCO|COR)\b/
const STATUS_KEYS = ['status', 'change_order_status', 'co_status', 'approval_status', 'approval']
const APPROVED_KEYS = ['approved', 'owner_approved', 'is_approved']
function unapprovedMark(o: Json, descKeys: readonly string[]): string | null {
  for (const k of APPROVED_KEYS) {
    const v = o[k]
    if (v === false || (typeof v === 'string' && /^(?:no|false|n)$/i.test(v.trim()))) return `${k} is ${JSON.stringify(v)}`
  }
  for (const k of STATUS_KEYS) {
    const v = o[k]
    if (typeof v === 'string' && (UNAPPROVED.test(v) || UNAPPROVED_CODES.test(v))) return `its ${k} is "${v.trim()}"`
  }
  const d = firstKey(o, [...descKeys])
  if (d && typeof d.value === 'string') {
    const m = UNAPPROVED.exec(d.value) ?? UNAPPROVED_CODES.exec(d.value)
    if (m) return `"${m[0]}" in its description, "${d.value.trim().slice(0, 120)}"`
  }
  return null
}

interface RetainageStatements {
  /** per schedule line: its own stated rate, or null */
  lines: readonly (StatedRate | null)[]
  /** the application's stated reduced rate, and the item numbers it covers (null: every line) */
  reduced: (StatedRate & { items?: readonly string[] | null }) | null
  /** each schedule line's item number (for the reduced rate's items) and whether it is complete (completed to date = scheduled value) */
  itemIds: readonly (string | null)[]
  complete: readonly boolean[]
  /** the previous application's stated rate as a binding (applied when this application states none) */
  prevBound: BoundValue | null
}

/**
 * G702_RATE under engine 0.6.0. A change earlier on 2026-10-05 made the stated rate a ceiling, so an application stating 10% that retained 5% on
 * every line passed and paid $13,741.25 more (2026-10-05). From a later change the same day, THE STATED RATE APPLIES, and a
 * line may retain less only where the application says so:
 *
 *   the line states its own rate (retainage_rate, or another rate name, on the schedule line), and retains that rate of its
 *     completed work; or
 *   the application states a reduced rate for the period (reduced_retainage_rate), optionally naming the items it covers
 *     (reduced_retainage_items), and the line retains that rate; or
 *   the line is complete (completed to date = its scheduled value) and its column I states the lower retainage, while another
 *     line with work still retains at the stated rate (retainage reduced on finished work; never every line at once).
 *
 *   At or above the stated rate: line 5 is compared with line 4 × rate (above FAILs: more retained than the rate allows).
 *   Under it, with every lower line accounted for as above, column I on every line and adding to line 5: PASS, naming each
 *     line that retains less and where the application says so.
 *   Under it otherwise, uniform under-withholding above all (no line at the stated rate): a person decides
 *     (AMBIGUOUS_REFERENCE), in words that lead with the dollar difference: "13,741.25 less retained than the stated 10% ...".
 *   No rate on this application: the previous application's stated rate applies, and the words say so. No rate on either:
 *     the lines' own retainage is read (the form's variable-rate total), each line's rate listed, and the check passes.
 * The formula text of the bound value is the sentence finish() gives as the claim's explanation.
 */
function retainageV060(x: {
  B: Bindings; D: Refusals; L4: number; L5: number | null; rate: number | null
  lineCtxs: ComputeInput['lineCtxs']; refusedLines: readonly Refusals[]; prevRate: number | null
  stated: RetainageStatements
}): ({ bound: BoundValue } | { absence: Absence }) & { lines?: BoundValue[]; rates?: BoundValue[] } {
  const { B, D, L4, L5, stated } = x
  const tol = CURRENCY_TOLERANCE
  const lines = x.lineCtxs.map((ctx, i) => ({ n: i + 1, i, I: num(ctx.bindings.LINE_RETAINAGE), G: num(ctx.bindings.COMPLETED_TO_DATE), b: ctx.bindings.LINE_RETAINAGE,
    refused: x.refusedLines[i]?.LINE_RETAINAGE !== undefined || x.refusedLines[i]?.COMPLETED_TO_DATE !== undefined }))
  const allI = lines.length > 0 && lines.every(l => l.I !== null && l.G !== null && !l.refused)
  const sumI = allI ? round4(lines.reduce((s, l) => s + (l.I as number), 0)) : null
  const lineBindings = allI ? lines.map((l, i) => ({ ...(l.b as BoundValue), field: (l.b as BoundValue).field.replace('[*]', `[${i}]`) })) : undefined
  const statedBindings = [...stated.lines.flatMap(s => (s && 'bound' in s ? [s.bound] : [])), ...(stated.reduced && 'bound' in stated.reduced ? [stated.reduced.bound] : [])]
  const pctOf = (l: { I: number | null; G: number | null }): string => (l.G ? plainPct((l.I as number) / l.G) : 'on nothing completed')
  const said = (ls: readonly { n: number; I: number | null; G: number | null }[]): string =>
    `${ls.slice(0, 6).map(l => `line ${l.n} retains ${plainMoney(l.I)} on ${plainMoney(l.G)} completed (${pctOf(l)})`).join(', ')}${ls.length > 6 ? `, and ${ls.length - 6} more lines` : ''}`
  const nums = (ns: readonly number[]): string => (ns.length === 1 ? `line ${ns[0]}` : `lines ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`)
  if (D.RETAINAGE_RATE !== undefined) return { absence: D.RETAINAGE_RATE }

  // the rate that applies: this application's, else the previous application's (an unexplained change is not a reduction)
  const own = x.rate !== null && B.RETAINAGE_RATE ? x.rate : null
  const fromPrev = own === null && x.prevRate !== null && stated.prevBound !== null
  const rate = own ?? (fromPrev ? x.prevRate : null)
  const rateBound = own !== null ? B.RETAINAGE_RATE as BoundValue : fromPrev ? stated.prevBound : null
  const prev = own !== null && x.prevRate !== null && Math.abs(x.prevRate - own) > 1e-9 ? `; the previous application stated ${plainPct(x.prevRate)}` : ''
  const which = (r: number): string => (fromPrev ? `the ${plainPct(r)} the previous application stated (this application states no rate)` : `the stated ${plainPct(r)}`)

  if (rate === null || rateBound === null) {
    if (allI && L5 !== null && sumI !== null && Math.abs(sumI - L5) <= tol && !lines.some(l => (l.I as number) > tol && !((l.G as number) > 0))) {
      // the form's variable-rate total: each line's own retainage, its rate listed (grouped by rate)
      const byRate = new Map<string, number[]>()
      for (const l of lines) if ((l.G as number) > 0) { const k = plainPct((l.I as number) / (l.G as number)); byRate.set(k, [...(byRate.get(k) ?? []), l.n]) }
      const rates = [...byRate].map(([k, ns]) => `${k} on line${ns.length === 1 ? '' : 's'} ${ns.join(', ')}`).join('; ')
      return { bound: computed(sumI, `the total retainage is the lines' own retainage (column I): no single retainage rate is stated, so no line was checked against one; the lines retain ${rates || 'nothing'}`, lineBindings!), lines: lineBindings }
    }
    return { absence: 'RETAINAGE_RATE not present' }
  }
  const ceiling = round4(L4 * rate)
  const atRate = (): { bound: BoundValue; rates?: BoundValue[] } => ({ bound: computed(ceiling,
    fromPrev ? `line 4 × rate; no retainage rate is stated on this application, so the previous application's ${plainPct(rate)} is applied` : prev ? `line 4 × rate${prev}` : 'line 4 × rate',
    [B.TOTAL_COMPLETED_STORED as BoundValue, rateBound]), ...(fromPrev ? { rates: [rateBound] } : {}) })
  if (L5 === null || L5 >= ceiling - tol) return atRate()

  // under the rate that applies: the dollar difference first, then where (and whether) the application says so
  const diff = round4(ceiling - L5)
  const lead = `${plainMoney(diff)} less retained than ${which(rate)} of ${plainMoney(L4)} completed (${plainMoney(ceiling)} at ${plainPct(rate)}; the total retainage says ${plainMoney(L5)})`
  const person = (why: string): { absence: Absence; lines?: BoundValue[]; rates?: BoundValue[] } => ({ absence: { reason: 'AMBIGUOUS_REFERENCE', detail: `${lead}${why}${prev}. A person confirms the retainage terms before it is paid` },
    ...(lineBindings ? { lines: lineBindings } : {}), rates: [...(fromPrev ? [rateBound] : []), ...statedBindings] })
  if (!allI) return person(', and the schedule lines do not all carry their retainage (column I) to say where a lower rate applies')
  // every line retains at the rate and only line 5 is short: under-withheld against the lines' own figures, FAIL as before
  if (lines.every(l => ((l.G as number) <= 0 ? (l.I as number) <= tol : Math.abs((l.I as number) - (l.G as number) * rate) <= tol))) return atRate()
  if (Math.abs((sumI as number) - L5) > tol) return person(`, and the lines' retainage (column I) adds to ${plainMoney(sumI)}, not ${plainMoney(L5)}`)

  const unreadable = [...stated.lines.flatMap(s => (s && 'unreadable' in s ? [s.unreadable] : [])), ...(stated.reduced && 'unreadable' in stated.reduced ? [stated.reduced.unreadable] : [])]
  if (unreadable.length) return person(`, and ${unreadable.join('; ')}: not read, never guessed`)
  const reduced = stated.reduced && 'rate' in stated.reduced ? stated.reduced : null
  const atR: number[] = [], ownRate: string[] = [], period: number[] = [], completed: number[] = [], unstated: typeof lines = [], over: typeof lines = [], ownOff: string[] = []
  for (const l of lines) {
    const I = l.I as number, G = l.G as number
    if (G <= 0) { if (I > tol) over.push(l); continue }
    const s = stated.lines[l.i]
    if (s && 'rate' in s) {
      if (Math.abs(I - G * s.rate) <= tol) { if (s.rate >= rate - 1e-9) atR.push(l.n); else ownRate.push(`line ${l.n} states its own rate of ${plainPct(s.rate)} and retains ${plainMoney(I)} on ${plainMoney(G)} completed`) }
      else ownOff.push(`line ${l.n} states its own rate of ${plainPct(s.rate)} but retains ${plainMoney(I)} on ${plainMoney(G)} completed (${pctOf(l)})`)
      continue
    }
    if (Math.abs(I - G * rate) <= tol) { atR.push(l.n); continue }
    if (I > G * rate + tol) { over.push(l); continue }
    const id = stated.itemIds[l.i] ?? null
    if (reduced && (reduced.items == null || (id !== null && reduced.items.includes(id))) && Math.abs(I - G * reduced.rate) <= tol) { period.push(l.n); continue }
    if (stated.complete[l.i]) { completed.push(l.n); continue }
    unstated.push(l)
  }
  if (ownOff.length) return person(`, and ${ownOff.join('; ')}`)
  if (over.length) return person(`, and the application's own figures do not account for it: ${said(over)}, more than ${which(rate)}`)
  const grouped = (ls: readonly { n: number; I: number | null; G: number | null }[]): string => {
    const byPct = new Map<string, number[]>()
    for (const l of ls) byPct.set(pctOf(l), [...(byPct.get(pctOf(l)) ?? []), l.n])
    return [...byPct].map(([p, ns]) => `${nums(ns)} ${ns.length === 1 ? 'retains' : 'retain'} ${p}`).join('; ')
  }
  if (unstated.length && atR.length === 0) {
    // uniform (or all-below) under-withholding: the rate that applies governs no line with work
    const lower = lines.filter(l => unstated.includes(l) || completed.includes(l.n))
    const done = completed.length ? `; ${nums(completed)} ${completed.length === 1 ? 'is' : 'are'} complete` : ''
    return person(`: no line with work retains at ${plainPct(rate)} (${grouped(lower)}${done}), and the application states no reduced rate and no line states a rate of its own`)
  }
  if (unstated.length) {
    return person(`: ${grouped(unstated)}, ${unstated.length === 1 ? 'a line that is not complete' : 'lines that are not complete'}, and neither ${unstated.length === 1 ? 'the line' : 'the lines'} nor the application ${unstated.length === 1 ? 'states a lower rate for it' : 'state a lower rate for them'}`)
  }
  if (completed.length && atR.length === 0) {
    // every line retaining less: a reduction on completed work is legitimate line by line, never as the whole application's rate
    return person(`: no line with work retains at ${plainPct(rate)} (${nums(completed)} ${completed.length === 1 ? 'is' : 'are'} complete and ${completed.length === 1 ? 'retains' : 'retain'} less), and the application states no reduced rate`)
  }
  const parts = [
    ...ownRate,
    ...(period.length ? [`${nums(period)} ${period.length === 1 ? 'retains' : 'retain'} the reduced rate the application states, ${plainPct((reduced as { rate: number }).rate)}`] : []),
    ...(completed.length ? [`${completed.map(n => { const l = lines[n - 1]!; return `line ${n} is complete and retains ${plainMoney(l.I)} on ${plainMoney(l.G)} (${pctOf(l)})` }).join(', ')}: a reduction on completed work, stated by ${completed.length === 1 ? 'its' : 'their'} column I`] : []),
  ]
  const sentence = `the total retainage, ${plainMoney(L5)}, is ${plainMoney(diff)} less than ${which(rate)} of ${plainMoney(L4)} (${plainMoney(ceiling)}), and the application says where: ${parts.join('; ')}; every other line with work retains at ${plainPct(rate)}${prev}`
  return { bound: computed(sumI as number, sentence, [rateBound, ...lineBindings!, ...statedBindings]), lines: lineBindings!, rates: [...(fromPrev ? [rateBound] : []), ...statedBindings] }
}

// ---------------------------------------------------------------- continuity with last month (engine 0.6.0)
/** The leaf field names a role may be written under, read off the ontology (every root shares them). */
function leafKeys(role: UniversalRole): string[] {
  const out: string[] = []
  for (const m of PAY_APP_ONTOLOGY.mappings) {
    if (m.role !== role) continue
    for (const p of [m.fieldPath, ...(m.alternativePaths ?? [])]) { const leaf = p.includes('].') ? p.split('].').pop()! : p.split('.').pop()!; if (!out.includes(leaf)) out.push(leaf) }
  }
  return out
}
/**
 * Column D read two ways (engine 0.6.0). The form's own heading for column D is "Work Completed From Previous
 * Application (D + E)": last month's work in place, stored materials not in it (they move to this period when installed). Much
 * billing software carries last month's completed to date (column G, stored materials included) instead. Either reconciles, and
 * the words say which was read; when last month stored nothing the two are one figure, and nothing is said (as before). Neither:
 * the claim FAILs, as before (the figures contradict the form either way).
 */
function previousReading(x: { D: number | null; bound: BoundValue; hit: { path: string; line: Json }; strict: boolean; format?: DocumentFormat }): { reconciles: boolean; value: number; words: string | null; ops: BoundValue[] } {
  const tol = CURRENCY_TOLERANCE
  const lastG = x.bound.value as number
  const read = (role: UniversalRole): BoundValue | null => {
    const h = firstKey(x.hit.line, leafKeys(role))
    if (!h) return null
    const b = historyAmount(`${x.hit.path}.${h.path}`, h.value, x.strict, x.format)
    return typeof b === 'object' && b !== null ? b : null
  }
  const lastD = read('WORK_PREVIOUS'), lastE = read('WORK_THIS_PERIOD'), lastF = read('MATERIALS_STORED')
  const F = lastF ? (lastF.value as number) : 0
  const wip = lastD || lastE ? round4(((lastD?.value as number | undefined) ?? 0) + ((lastE?.value as number | undefined) ?? 0)) : lastF ? round4(lastG - F) : null
  if (x.D === null) return { reconciles: true, value: lastG, words: null, ops: [] } // a missing D: the check cannot run, as before
  if (Math.abs(x.D - lastG) <= tol) {
    return F > tol
      ? { reconciles: true, value: lastG, words: `last month's completed to date for that item, ${plainMoney(lastG)}, stored materials included (${plainMoney(F)} stored last month): column D read as last month's column G`, ops: [x.bound, lastF!] }
      : { reconciles: true, value: lastG, words: null, ops: [] }
  }
  if (wip !== null && F > tol && Math.abs(x.D - wip) <= tol) {
    return { reconciles: true, value: wip, words: `last month's work completed for that item (D + E), ${plainMoney(wip)}: column D read by the form's own heading, "from previous application (D + E)"; the ${plainMoney(F)} of materials stored last month is not in D, and moves to this period when installed`,
      ops: [...(lastD ? [lastD] : []), ...(lastE ? [lastE] : []), lastF!] }
  }
  return { reconciles: false, value: lastG, words: null, ops: [] }
}

const CO_LIST_KEYS = ['change_orders', 'change_orders_this_period', 'change_order_list']
const CO_AMOUNT_KEYS = ['amount', 'value', 'change_order_amount', 'net_change']
const CO_NUMBER_KEYS = ['number', 'change_order_number', 'co_number', 'id', 'name']
const LINE_CO_AMOUNT_KEYS = ['change_order_amount', 'change_order_value']

/**
 * A stated change order: what the application says changed a scheduled value, with its amount and (optionally) the item, and
 * (2026-10-06) where the application marks it unapproved (its status, an approved field of false, or its description).
 */
interface StatedChangeOrder { number: string | null; amount: number; item: string | null; bound: BoundValue; mark: string | null }

/**
 * What the application says about each line's continuity with last month's, worked out before the lines are checked:
 *   - a line whose scheduled value (column C) changed needs a stated change order of that amount: on the line
 *     (change_order_amount), or in the application's change_orders list naming its item (or naming no item, for one change)
 *   - a line new this month (its item number is not on last month's application) is read as a change-order line when the new
 *     lines' scheduled values, less any line dropped since, are what net change orders (line 2) rose by, apart from the stated
 *     changes on other lines; otherwise a person confirms it
 *   - the original contract sum (line 1) does not change from month to month
 * Each finding is a sentence a person reads; nothing here is a FAIL (a changed schedule is reconcilable by a change order).
 */
interface Continuity {
  /** per current line: the words for a change it accounts for (PASS), or why a person decides (AMBIGUOUS_REFERENCE) */
  line: Map<number, { ok: true; words: string; ops: BoundValue[] } | { ok: false; detail: string }>
  /** document level: why a person decides on the contract sum (line 1 changed, a line dropped and not accounted for) */
  doc: string | null
}
function continuityOf(x: {
  extraction: Json; lines: Json[]; lineCtxs: ComputeInput['lineCtxs']; lineKey: string
  prevDoc: { index: number; doc: Json }; prevLines: { key: string; lines: Json[] }
  prevById: Map<string, { path: string; line: Json } | 'duplicate'>
  B: Bindings; strict: boolean; format?: DocumentFormat
}): Continuity {
  const tol = CURRENCY_TOLERANCE
  const out: Continuity = { line: new Map(), doc: null }
  const prevAmount = (path: string, raw: unknown): BoundValue | null => { const b = historyAmount(path, raw, x.strict, x.format); return typeof b === 'object' && b !== null ? b : null }
  // stated change orders: the application's list, and each line's own amount
  const listHit = firstKey(x.extraction, CO_LIST_KEYS, DOC_ROOTS)
  const stated: StatedChangeOrder[] = []
  if (listHit && Array.isArray(listHit.value)) {
    listHit.value.forEach((co, k) => {
      if (co === null || typeof co !== 'object' || Array.isArray(co)) return
      const a = firstKey(co as Json, CO_AMOUNT_KEYS)
      const n = a ? normalizeAmount(a.value) : null
      if (!a || !n?.success) return
      const no = firstKey(co as Json, CO_NUMBER_KEYS)
      const it = firstKey(co as Json, ITEM_KEYS.filter(k2 => k2 !== 'id' && k2 !== 'number' && k2 !== 'no'))
      const itemN = it ? normalizeReference(it.value) : null
      stated.push({ number: no ? String(no.value) : null, amount: n.normalized, item: it ? (itemN?.success ? itemN.normalized : String(it.value).trim()) : null,
        bound: { value: n.normalized, source: 'invoice', field: `${listHit.path}[${k}].${a.path}`, confidence: 100, originalValue: (n.original ?? a.value) as string | number | null, normalizedValue: n.normalized, normalizations: n.transformations },
        mark: unapprovedMark(co as Json, ['description', 'title', 'name', 'scope']) })
    })
  }
  const usedUnnamed = new Set<number>()
  const SV = leafKeys('SCHEDULED_VALUE')
  const ids = x.lines.map(l => itemIdOf(l))
  const current = new Set(ids.filter((s): s is string => s !== null))
  // what each line's scheduled value did since last month
  const moved: { i: number; id: string; prevC: number | null; C: number | null; isNew: boolean; prevBound: BoundValue | null }[] = []
  x.lines.forEach((ln, i) => {
    const id = ids[i]
    if (id === null || id === undefined) return
    const hit = x.prevById.get(id)
    const C = num(x.lineCtxs[i]!.bindings.SCHEDULED_VALUE)
    if (hit === 'duplicate') return
    if (hit === undefined) { moved.push({ i, id, prevC: null, C, isNew: true, prevBound: null }); return }
    const c = firstKey(hit.line, SV)
    const pb = c ? prevAmount(`${hit.path}.${c.path}`, c.value) : null
    moved.push({ i, id, prevC: pb ? (pb.value as number) : null, C, isNew: false, prevBound: pb })
    void ln
  })
  const dropped: { id: string; prevC: number }[] = []
  for (const [id, hit] of x.prevById) {
    if (hit === 'duplicate' || current.has(id)) continue
    const c = firstKey(hit.line, SV)
    const pb = c ? prevAmount(`${hit.path}.${c.path}`, c.value) : null
    dropped.push({ id, prevC: pb ? (pb.value as number) : 0 })
  }
  // net change orders this month and last (line 2; blank reads 0, as the form's own footing reads it)
  const coNow = num(x.B.NET_CHANGE_ORDERS)
  const coHit = firstKey(x.prevDoc.doc, leafKeys('NET_CHANGE_ORDERS'), DOC_ROOTS)
  const coPrevB = coHit ? prevAmount(`history[${x.prevDoc.index}].${coHit.path}`, coHit.value) : null
  const coPrev = coPrevB ? (coPrevB.value as number) : coHit ? null : 0
  const coRose = coPrev !== null ? round4((coNow ?? 0) - coPrev) : null
  const coWords = coRose === null ? 'net change orders on last month\'s application could not be read' : coRose === 0 ? `net change orders did not change, at ${plainMoney(coNow ?? 0)}`
    : `net change orders ${coRose > 0 ? 'rose' : 'fell'} ${plainMoney(Math.abs(coRose))}, from ${plainMoney(coPrev)} to ${plainMoney(coNow ?? 0)}`
  const coOps = [...(x.B.NET_CHANGE_ORDERS ? [x.B.NET_CHANGE_ORDERS] : []), ...(coPrevB ? [coPrevB] : [])]

  // existing lines: a changed scheduled value needs a stated change order of that amount
  let statedSum = 0
  for (const m of moved) {
    if (m.isNew || m.prevC === null || m.C === null) continue
    const delta = round4(m.C - m.prevC)
    if (Math.abs(delta) <= tol) continue
    const n = m.i + 1
    const own = firstKey(x.lines[m.i]!, LINE_CO_AMOUNT_KEYS)
    const ownN = own ? normalizeAmount(own.value) : null
    const named = stated.filter(s => s.item === m.id)
    const namedSum = round4(named.reduce((s, c) => s + c.amount, 0))
    const ownAmt = ownN?.success ? ownN.normalized : null
    let by: string | null = null
    let ops: BoundValue[] = []
    let marks: string[] = []
    if (ownAmt !== null && Math.abs(ownAmt - delta) <= tol) {
      by = `the change order amount stated on the line, ${plainMoney(ownAmt)}`
      ops = [{ value: ownAmt, source: 'invoice', field: `${x.lineKey}[${m.i}].${own!.path}`, confidence: 100, originalValue: (ownN!.original ?? own!.value) as string | number | null, normalizedValue: ownAmt, normalizations: ownN!.transformations }]
    } else if (named.length && Math.abs(namedSum - delta) <= tol) {
      by = `change order${named.length === 1 ? '' : 's'} ${named.map(s => `${s.number ?? 'stated'} (${plainMoney(s.amount)})`).join(', ')} stated on the application for item ${m.id}`
      ops = named.map(s => s.bound)
      marks = named.flatMap(s => (s.mark ? [`change order ${s.number ?? 'stated'}: ${s.mark}`] : []))
    } else if (!named.length && ownAmt === null) {
      const k = stated.findIndex((s, j) => s.item === null && !usedUnnamed.has(j) && Math.abs(s.amount - delta) <= tol)
      if (k >= 0) {
        usedUnnamed.add(k); by = `change order ${stated[k]!.number ?? 'stated on the application'} (${plainMoney(stated[k]!.amount)}), which names no item`; ops = [stated[k]!.bound]
        if (stated[k]!.mark) marks = [`change order ${stated[k]!.number ?? 'stated'}: ${stated[k]!.mark}`]
      }
    }
    const change = `line ${n}'s scheduled value ${delta > 0 ? 'rose' : 'fell'} from ${plainMoney(m.prevC)} to ${plainMoney(m.C)} since last month's application (by ${plainMoney(Math.abs(delta))})`
    // 2026-10-06: a change order the application itself marks unapproved does not account for the change: the owner approves it first
    if (by && marks.length) {
      out.line.set(m.i, { ok: false, detail: `${change}, which ${by} would account for, but the application marks it unapproved (${marks.join('; ')}): a change the owner has not approved is not payable on this application. The owner approves the change order before this application is paid` })
      continue
    }
    if (by) {
      statedSum = round4(statedSum + delta)
      out.line.set(m.i, { ok: true, words: `${change}, which ${by} accounts for; that the owner approved the change order is not checked`, ops: [...(m.prevBound ? [m.prevBound] : []), ...ops] })
    } else {
      out.line.set(m.i, { ok: false, detail: `${change}, and no change order on the application accounts for it; ${coWords}. A scheduled value changes only by change order: a person confirms the change order before this application is paid` })
    }
  }
  // new lines (and lines dropped since): read as change-order lines when they are what net change orders rose by
  const fresh = moved.filter(m => m.isNew)
  if (fresh.length || dropped.length) {
    const freshSum = round4(fresh.reduce((s, m) => s + (m.C ?? 0), 0))
    const droppedSum = round4(dropped.reduce((s, d) => s + d.prevC, 0))
    const accounted = coRose !== null && fresh.every(m => m.C !== null) && Math.abs(round4(freshSum - droppedSum) - round4(coRose - statedSum)) <= tol * Math.max(1, fresh.length + dropped.length)
    const droppedWords = dropped.length ? `; item${dropped.length === 1 ? '' : 's'} ${dropped.map(d => `${d.id} (${plainMoney(d.prevC)})`).join(', ')} on last month's application ${dropped.length === 1 ? 'is' : 'are'} not on this one` : ''
    for (const m of fresh) {
      const n = m.i + 1
      const D = num(x.lineCtxs[m.i]!.bindings.WORK_PREVIOUS)
      const head = `line ${n} is new this month (item ${m.id}${m.C !== null ? `, scheduled value ${plainMoney(m.C)}` : ''})`
      if (D !== null && Math.abs(D) > tol) {
        out.line.set(m.i, { ok: false, detail: `${head}, but it says ${plainMoney(D)} from previous applications, and no line of last month's application carries item ${m.id}: a line renumbered since last month, or work never certified. A person confirms which before this application is paid` })
      } else if (accounted) {
        out.line.set(m.i, { ok: true, words: `${head}: no previous application carries item ${m.id}, so its previous work is 0; ${coWords}, which the new line${fresh.length > 1 ? 's' : ''}${dropped.length ? ', less the line dropped since,' : ''} account${fresh.length > 1 || dropped.length ? '' : 's'} for${droppedWords}. Read as a change order; that the owner approved it is not checked`,
          ops: [...(x.lineCtxs[m.i]!.bindings.SCHEDULED_VALUE ? [x.lineCtxs[m.i]!.bindings.SCHEDULED_VALUE as BoundValue] : []), ...coOps] })
      } else {
        out.line.set(m.i, { ok: false, detail: `${head}; ${coWords}${droppedWords}: confirm it is a change order${coRose !== null && Math.abs(round4(freshSum - droppedSum) - round4(coRose - statedSum)) > tol ? `, and what accounts for the difference of ${plainMoney(Math.abs(round4(freshSum - droppedSum - (coRose - statedSum))))}` : ''}. A person confirms it before this application is paid` })
      }
    }
    if (!fresh.length && dropped.length && !accounted) out.doc = `item${dropped.length === 1 ? '' : 's'} ${dropped.map(d => `${d.id} (${plainMoney(d.prevC)})`).join(', ')} on last month's application ${dropped.length === 1 ? 'is' : 'are'} not on this one, and ${coWords}, which does not account for ${dropped.length === 1 ? 'it' : 'them'}: a person confirms the change order that removed ${dropped.length === 1 ? 'it' : 'them'} before this application is paid`
  }
  // the original contract sum does not change from month to month
  const l1 = num(x.B.ORIGINAL_CONTRACT_SUM)
  const l1Hit = firstKey(x.prevDoc.doc, leafKeys('ORIGINAL_CONTRACT_SUM'), DOC_ROOTS)
  const l1Prev = l1Hit ? prevAmount(`history[${x.prevDoc.index}].${l1Hit.path}`, l1Hit.value) : null
  if (l1 !== null && l1Prev && Math.abs(l1 - (l1Prev.value as number)) > tol) {
    const was = `the original contract sum (line 1) is ${plainMoney(l1)} on this application and was ${plainMoney(l1Prev.value)} on last month's: it does not change; a change belongs in the net change by change orders (line 2). A person confirms it before this application is paid`
    out.doc = out.doc ? `${was}; and ${out.doc}` : was
  }
  return out
}

// ---------------------------------------------------------------- compute
function compute({ extraction, references, docCtx, lineCtxs, engine }: ComputeInput): ComputeOutput {
  const docAbsence: AbsenceMap = {}
  const lineAbsence: AbsenceMap[] = lineCtxs.map(() => ({}))
  const attach: Record<string, Evidence[]> = {}
  const arr = lineArrayOf(extraction)
  const lineKey = arr?.key ?? 'schedule_of_values'
  const lines = arr?.lines ?? []

  // Engine 0.6.0 (2026-10-05): read strictly (../strict.ts). A value that does not read
  // as one number keeps its raw text (every check on it abstains UNPARSEABLE); a near-miss key is refused by name; a refused
  // cell or line is never read as the form's blank-means-zero. Below 0.6.0 (and for a caller that names no engine) nothing here
  // runs, every refusal map is empty, and `because` returns its fallback: the code reads exactly as before.
  const strict = engine !== undefined && engineAtLeast(engine, '0.6.0')
  const refusedDoc: Refusals = {}
  const refusedLines: Refusals[] = lineCtxs.map(() => ({}))
  // the previous application is read in the document's own number format (one contractor, one format)
  let format: DocumentFormat | undefined
  if (strict) {
    const near = refuseNearMissKeys(extraction, docCtx, lineCtxs, PAY_APP_ONTOLOGY, arr?.key)
    format = documentFormat(extraction, [docCtx, ...lineCtxs], PAY_APP_ONTOLOGY)
    Object.assign(refusedDoc, near.doc, strictenBindings(docCtx, PAY_APP_ONTOLOGY, undefined, format))
    lineCtxs.forEach((ctx, i) => Object.assign(refusedLines[i]!, near.lines[i], strictenBindings(ctx, PAY_APP_ONTOLOGY, i, format)))
    Object.assign(docAbsence, near.doc)
    near.lines.forEach((r, i) => Object.assign(lineAbsence[i]!, r))
  }
  const because = (r: Refusals, role: UniversalRole, fallback: Absence): Absence => r[role] ?? fallback
  const neverZero = (r: Refusals, roles: readonly UniversalRole[]): Absence | undefined => {
    const hit = roles.filter(x => r[x] !== undefined)
    if (!hit.length) return undefined
    return { reason: 'UNPARSEABLE', detail: `${hit.map(x => { const a = r[x]!; return typeof a === 'string' ? a : a.detail }).join('; ')}; a refused value is never read as the form's blank (0)` }
  }

  const prev = previousApplication(references.history)
  const prevDoc = typeof prev === 'object' && 'doc' in prev ? prev : null
  const prevAbsence: Absence = prevDoc ? '' : (prev as Absence)
  const prevLines = prevDoc ? lineArrayOf(prevDoc.doc) : null
  // Index the previous application's lines by item id; an id seen twice is unusable (never guess between them).
  const prevById = new Map<string, { path: string; line: Json } | 'duplicate'>()
  if (prevDoc && prevLines) {
    prevLines.lines.forEach((l, j) => {
      const id = itemIdOf(l)
      if (id === null) return
      prevById.set(id, prevById.has(id) ? 'duplicate' : { path: `history[${prevDoc.index}].${prevLines.key}[${j}]`, line: l })
    })
  }

  // Engine 0.6.0: each line's scheduled value against last month's, new lines, and the original contract sum,
  // worked out once (continuityOf); a change a change order accounts for passes, anything else is a person's decision
  const cont = strict && prevDoc && prevLines ? continuityOf({ extraction, lines, lineCtxs, lineKey, prevDoc, prevLines, prevById, B: docCtx.bindings, strict, ...(format ? { format } : {}) }) : null

  // ---- G703 per line
  lineCtxs.forEach((ctx, i) => {
    const B = ctx.bindings
    const A = lineAbsence[i] as AbsenceMap
    const C = num(B.SCHEDULED_VALUE), Dv = num(B.WORK_PREVIOUS), E = num(B.WORK_THIS_PERIOD), F = num(B.MATERIALS_STORED), G = num(B.COMPLETED_TO_DATE)

    // G = D + E + F  (blank cells are zero by the form's convention — and the formula says which were blank)
    const refusedDEF = neverZero(refusedLines[i]!, ['WORK_PREVIOUS', 'WORK_THIS_PERIOD', 'MATERIALS_STORED'])
    if (refusedDEF !== undefined) {
      A.EXPECTED_COMPLETED_TO_DATE = refusedDEF
    } else if (Dv === null && E === null && F === null) {
      A.EXPECTED_COMPLETED_TO_DATE = 'none of previous / this period / materials stored is present on the line'
    } else {
      const notes: string[] = []
      if (Dv === null) notes.push('D absent → 0')
      if (E === null) notes.push('E absent → 0')
      if (F === null) notes.push('F absent → 0')
      const ops = [B.WORK_PREVIOUS, B.WORK_THIS_PERIOD, B.MATERIALS_STORED].filter((b): b is BoundValue => !!b && num(b) !== null)
      B.EXPECTED_COMPLETED_TO_DATE = computed(round4((Dv ?? 0) + (E ?? 0) + (F ?? 0)), `D + E + F${notes.length ? ` (${notes.join('; ')})` : ''}`, ops)
    }
    attach[`line[${i}].G703_TOTAL`] = operandEvidence(B, ['WORK_PREVIOUS', 'WORK_THIS_PERIOD', 'MATERIALS_STORED'])

    // H = C − G
    const R = refusedLines[i]!
    if (C === null || !B.SCHEDULED_VALUE) A.EXPECTED_BALANCE_TO_FINISH = because(R, 'SCHEDULED_VALUE', 'SCHEDULED_VALUE not present on the line')
    else if (G === null || !B.COMPLETED_TO_DATE) A.EXPECTED_BALANCE_TO_FINISH = because(R, 'COMPLETED_TO_DATE', 'COMPLETED_TO_DATE not present on the line')
    else B.EXPECTED_BALANCE_TO_FINISH = computed(round4(C - G), 'C − G', [B.SCHEDULED_VALUE, B.COMPLETED_TO_DATE])
    attach[`line[${i}].G703_BAL`] = operandEvidence(B, ['SCHEDULED_VALUE', 'COMPLETED_TO_DATE'])

    // % = G ÷ C
    if (C === null || !B.SCHEDULED_VALUE) A.EXPECTED_PERCENT_COMPLETE = because(R, 'SCHEDULED_VALUE', 'SCHEDULED_VALUE not present on the line')
    else if (C === 0) A.EXPECTED_PERCENT_COMPLETE = 'SCHEDULED_VALUE is zero; percent complete is undefined'
    else if (G === null || !B.COMPLETED_TO_DATE) A.EXPECTED_PERCENT_COMPLETE = because(R, 'COMPLETED_TO_DATE', 'COMPLETED_TO_DATE not present on the line')
    else B.EXPECTED_PERCENT_COMPLETE = computed(Math.round((G / C) * 1e6) / 1e6, 'G ÷ C', [B.SCHEDULED_VALUE, B.COMPLETED_TO_DATE])
    attach[`line[${i}].G703_PCT`] = operandEvidence(B, ['SCHEDULED_VALUE', 'COMPLETED_TO_DATE'])

    // A bare percent in (0, 1] is ambiguous (1 → 1% or 100%?). Refuse to guess.
    const pct = B.PERCENT_COMPLETE
    if (pct) {
      const raw = pct.originalValue
      const bare = typeof raw === 'number' || (typeof raw === 'string' && !raw.includes('%'))
      const rawNum = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[^0-9.\-]/g, '')) : NaN
      if (bare && Number.isFinite(rawNum) && rawNum > 0 && rawNum <= 1) {
        delete B.PERCENT_COMPLETE
        A.PERCENT_COMPLETE = { reason: 'AMBIGUOUS_UNIT', detail: `${pct.field} = ${String(raw)} — a bare value in (0, 1] may be a percent or a fraction; send "45%" or 45` }
      }
    }

    // D = previous application's G for the same item
    if (!prevDoc) {
      A.PREVIOUS_COMPLETED_TO_DATE = prevAbsence
    } else if (!prevLines) {
      A.PREVIOUS_COMPLETED_TO_DATE = 'the previous application has no schedule-of-values array'
    } else {
      const id = lines[i] ? itemIdOf(lines[i] as Json) : null
      const sv = cont?.line.get(i)
      if (id === null) A.PREVIOUS_COMPLETED_TO_DATE = `${lineKey}[${i}] has no item number; lines are matched to the previous application by item number only`
      else {
        const hit = prevById.get(id)
        if (hit === undefined) {
          // engine 0.6.0: a line new this month is read as a change order when net change orders account for it
          if (sv?.ok) { B.PREVIOUS_COMPLETED_TO_DATE = computed(0, sv.words, sv.ops); attach[`line[${i}].G703_PREV`] = sv.ops.map(b => evidenceFromBinding('PREVIOUS_COMPLETED_TO_DATE', b)) }
          else if (sv) A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'AMBIGUOUS_REFERENCE', detail: sv.detail }
          else A.PREVIOUS_COMPLETED_TO_DATE = `no line in the previous application carries item number ${id}`
        }
        else if (hit === 'duplicate') A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'AMBIGUOUS_REFERENCE', detail: `the previous application lists item number ${id} more than once` }
        else {
          const g = firstKey(hit.line, COMPLETED_KEYS)
          const bound = g ? historyAmount(`${hit.path}.${g.path}`, g.value, strict, format) : null
          if (typeof bound === 'string') A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'UNPARSEABLE', detail: bound }
          else if (!bound) A.PREVIOUS_COMPLETED_TO_DATE = `previous application item ${id} has no completed-to-date amount`
          else if (!strict || cont === null) B.PREVIOUS_COMPLETED_TO_DATE = bound
          else {
            const r = previousReading({ D: Dv, bound, hit, strict, format })
            // the figures contradict both readings of column D: the claim FAILs, as before (a changed scheduled value is not named)
            if (!r.reconciles) B.PREVIOUS_COMPLETED_TO_DATE = bound
            else if (sv && !sv.ok) A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'AMBIGUOUS_REFERENCE', detail: sv.detail }
            else if (sv?.ok || r.words !== null) {
              const words = [r.words ?? `last month's completed to date for that item, ${plainMoney(bound.value)}`, ...(sv?.ok ? [sv.words] : [])].join('; ')
              const ops = [...r.ops, ...(sv?.ok ? sv.ops : [])]
              B.PREVIOUS_COMPLETED_TO_DATE = computed(r.value, words, ops.length ? ops : [bound])
              attach[`line[${i}].G703_PREV`] = (ops.length ? ops : [bound]).map(b => evidenceFromBinding('PREVIOUS_COMPLETED_TO_DATE', b))
            }
            else B.PREVIOUS_COMPLETED_TO_DATE = bound
          }
        }
      }
    }
  })

  // Engine 0.6.0 (2026-10-06): a schedule line the application marks unapproved ("pending owner approval", a status field),
  // billing work to date, is a person's decision for the owner, whatever its continuity reads. A previous figure that
  // contradicts last month still FAILs, as before (that FAIL is the line's label; the mark does not hide it).
  if (strict) {
    const descKeys = leafKeys('SOV_DESCRIPTION')
    lines.forEach((ln, i) => {
      const mark = unapprovedMark(ln, descKeys)
      if (!mark) return
      const LB = lineCtxs[i]!.bindings, A = lineAbsence[i]!
      const G = num(LB.COMPLETED_TO_DATE)
      if (G === null || G <= CURRENCY_TOLERANCE) return
      const Dv = num(LB.WORK_PREVIOUS), P = num(LB.PREVIOUS_COMPLETED_TO_DATE)
      if (LB.PREVIOUS_COMPLETED_TO_DATE && Dv !== null && P !== null && Math.abs(Dv - P) > CURRENCY_TOLERANCE) return
      delete LB.PREVIOUS_COMPLETED_TO_DATE
      A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'AMBIGUOUS_REFERENCE', detail: `line ${i + 1} is marked unapproved (${mark}) and bills ${plainMoney(G)} to date: a change the owner has not approved is not payable on this application. The owner approves the change order, or the line waits until it is approved, before this application is paid` }
      attach[`line[${i}].G703_PREV`] = operandEvidence(LB, ['SOV_DESCRIPTION', 'COMPLETED_TO_DATE'])
    })
  }

  // Engine 0.6.0 (2026-10-06): a rate given as an object or an array is refused by name before anything is checked, never read
  // as "no rate": the application's own split (lines 5a and 5b) is the one object a rate may be (statedSplit)
  const split = strict ? statedSplit(extraction) : null
  if (strict) {
    lines.forEach((ln, i) => { const h = firstKey(ln, RATE_KEYS); if (h) refuseObjectRate(`${lineKey}[${i}].${h.path}`, h.value, `a rate is expected: a schedule line states one rate ("5%"); the split of lines 5a and 5b is the application's, ${SPLIT_SHAPE}`) })
    const reducedRaw = firstKey(extraction, REDUCED_RATE_KEYS, DOC_ROOTS)
    if (reducedRaw) refuseObjectRate(reducedRaw.path, reducedRaw.value, 'a rate is expected ("5%")')
  }

  // ---- G702 document
  const B = docCtx.bindings
  const L1 = num(B.ORIGINAL_CONTRACT_SUM), L2 = num(B.NET_CHANGE_ORDERS), L3 = num(B.CONTRACT_SUM_TO_DATE)
  const L4 = num(B.TOTAL_COMPLETED_STORED), L5 = num(B.RETAINAGE_TOTAL), rate = num(B.RETAINAGE_RATE)
  const L6 = num(B.TOTAL_EARNED_LESS_RETAINAGE), L7 = num(B.PREVIOUS_CERTIFICATES)

  // line 3 = line 1 + line 2 (no change orders → 0, recorded)
  const D = refusedDoc
  const refusedL2 = neverZero(D, ['NET_CHANGE_ORDERS'])
  if (L1 === null || !B.ORIGINAL_CONTRACT_SUM) docAbsence.EXPECTED_CONTRACT_SUM_TO_DATE = because(D, 'ORIGINAL_CONTRACT_SUM', 'ORIGINAL_CONTRACT_SUM not present')
  else if (refusedL2 !== undefined) docAbsence.EXPECTED_CONTRACT_SUM_TO_DATE = refusedL2
  else {
    const ops = [B.ORIGINAL_CONTRACT_SUM, ...(L2 !== null && B.NET_CHANGE_ORDERS ? [B.NET_CHANGE_ORDERS] : [])]
    B.EXPECTED_CONTRACT_SUM_TO_DATE = computed(round4(L1 + (L2 ?? 0)), `line 1 + line 2${L2 === null ? ' (line 2 absent → 0)' : ''}`, ops)
  }
  attach['document.G702_CSUM'] = operandEvidence(B, ['ORIGINAL_CONTRACT_SUM', 'NET_CHANGE_ORDERS'])

  // Σ C, Σ G, Σ I
  // Engine 0.6.0: a pay application handed over inside another object, or under a near-miss key, is named, not "no array".
  const wrapped = strict && lines.length === 0 && !arr ? findWrapped(extraction) : null
  const misKeyed = strict && lines.length === 0 && !arr ? nearMissArrayKey(extraction, PAY_APP_LINE_ARRAY_KEYS) : undefined
  const wrappedDetail = wrapped
    ? `the extraction looks wrapped: the ${wrapped.key} array is under "${wrapped.path}.${wrapped.key}"; pass the inner object ("${wrapped.path}") as the extraction${!wrapped.path.includes('.') && extraction.references !== null && typeof extraction.references === 'object' ? ', and its "references" as the references (--history for a previous application)' : ''}`
    : misKeyed !== undefined ? `the schedule of values was reported under the key ${JSON.stringify(misKeyed)}, which differs from "${foldKey(misKeyed)}" only by spaces or invisible characters: not read (correct the key and run the check again)` : undefined
  if (lines.length === 0) {
    docAbsence.SOV_SCHEDULED_SUM = docAbsence.SOV_COMPLETED_SUM = docAbsence.SOV_RETAINAGE_SUM = 'no schedule-of-values array on the extraction'
  } else {
    const sc = column(lineCtxs, 'SCHEDULED_VALUE', lineKey, refusedLines)
    if (sc.anyRefused) docAbsence.SOV_SCHEDULED_SUM = { reason: 'UNPARSEABLE', detail: sc.problems.join('; ') }
    else if (sc.problems.length) docAbsence.SOV_SCHEDULED_SUM = sc.problems.join('; ')
    else {
      B.SOV_SCHEDULED_SUM = computed(round4(sc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${sc.values.map(b => b.field).join(' + ')})`, sc.values)
      attach['document.G702_SOV'] = sc.values.map(b => evidenceFromBinding('SCHEDULED_VALUE', b))
    }
    const gc = column(lineCtxs, 'COMPLETED_TO_DATE', lineKey, refusedLines)
    if (gc.anyRefused) docAbsence.SOV_COMPLETED_SUM = { reason: 'UNPARSEABLE', detail: gc.problems.join('; ') }
    else if (gc.problems.length) docAbsence.SOV_COMPLETED_SUM = gc.problems.join('; ')
    else {
      B.SOV_COMPLETED_SUM = computed(round4(gc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${gc.values.map(b => b.field).join(' + ')})`, gc.values)
      attach['document.G702_DONE'] = gc.values.map(b => evidenceFromBinding('COMPLETED_TO_DATE', b))
    }
    const rc = column(lineCtxs, 'LINE_RETAINAGE', lineKey, refusedLines)
    if (rc.anyRefused) docAbsence.SOV_RETAINAGE_SUM = { reason: 'UNPARSEABLE', detail: rc.problems.join('; ') }
    else if (rc.values.length === 0) docAbsence.SOV_RETAINAGE_SUM = 'no line-level retainage on the continuation sheet (column I absent)'
    else if (rc.problems.length) docAbsence.SOV_RETAINAGE_SUM = rc.problems.join('; ')
    else {
      B.SOV_RETAINAGE_SUM = computed(round4(rc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${rc.values.map(b => b.field).join(' + ')})`, rc.values)
      attach['document.G702_RSUM'] = rc.values.map(b => evidenceFromBinding('LINE_RETAINAGE', b))
    }
  }

  // line 5 = line 4 × rate
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_RETAINAGE_TOTAL = because(D, 'TOTAL_COMPLETED_STORED', 'TOTAL_COMPLETED_STORED not present')
  else if (split) {
    // Engine 0.6.0 (2026-10-06): the application's own split, lines 5a and 5b of the form (statedSplit, splitRetainage)
    const r = splitRetainage({ B, L4, L5, split, lineCtxs, refusedLines })
    if ('absence' in r) docAbsence.EXPECTED_RETAINAGE_TOTAL = r.absence
    else B.EXPECTED_RETAINAGE_TOTAL = r.bound
    attach['document.G702_RATE'] = [...operandEvidence(B, ['TOTAL_COMPLETED_STORED']), ...r.rates.map(b => evidenceFromBinding('RETAINAGE_RATE', b)), ...r.stored.map(b => evidenceFromBinding('MATERIALS_STORED', b))]
  }
  else if (strict) {
    // Engine 0.6.0: the stated rate applies; a line retains less only where the application says so
    // (its own rate, a stated reduced rate, or a complete line's column I beside lines at the rate): retainageV060
    const prevHit = prevDoc ? firstKey(prevDoc.doc, RATE_KEYS, DOC_ROOTS) : null
    const prevRate = prevHit ? rateOf(prevHit.value) : null
    const prevStated = prevDoc && prevHit && prevRate !== null ? statedRate('history', `history[${prevDoc.index}].${prevHit.path}`, prevHit.value) : null
    const reducedHit = firstKey(extraction, REDUCED_RATE_KEYS, DOC_ROOTS)
    const itemsHit = firstKey(extraction, REDUCED_ITEMS_KEYS, DOC_ROOTS)
    const itemList = itemsHit === null ? null : Array.isArray(itemsHit.value) ? itemsHit.value : typeof itemsHit.value === 'string' ? itemsHit.value.split(/[,;]\s*|\s+/).filter(Boolean) : [itemsHit.value]
    const items = itemList === null ? null : itemList.map(v => { const n = normalizeReference(v); return n?.success ? n.normalized : String(v).trim() })
    const stated: RetainageStatements = {
      lines: lines.map((ln, i) => { const h = firstKey(ln, RATE_KEYS); return h ? statedRate('invoice', `${lineKey}[${i}].${h.path}`, h.value) : null }),
      reduced: reducedHit ? { ...statedRate('invoice', reducedHit.path, reducedHit.value), items } : null,
      itemIds: lines.map(ln => itemIdOf(ln)),
      complete: lineCtxs.map(ctx => { const C = num(ctx.bindings.SCHEDULED_VALUE), G = num(ctx.bindings.COMPLETED_TO_DATE); return C !== null && G !== null && C > 0 && G >= C - CURRENCY_TOLERANCE }),
      prevBound: prevStated && 'bound' in prevStated ? prevStated.bound : null,
    }
    const r = retainageV060({ B, D, L4, L5, rate, lineCtxs, refusedLines, prevRate, stated })
    if ('absence' in r) docAbsence.EXPECTED_RETAINAGE_TOTAL = r.absence
    else B.EXPECTED_RETAINAGE_TOTAL = r.bound
    // the fields the reading rests on, beside line 4 and the rate: each line's retainage when it read them, and every stated rate
    if (r.lines || r.rates?.length) {
      attach['document.G702_RATE'] = [...operandEvidence(B, ['TOTAL_COMPLETED_STORED', 'RETAINAGE_RATE']), ...(r.rates ?? []).map(b => evidenceFromBinding('RETAINAGE_RATE', b)), ...(r.lines ?? []).map(b => evidenceFromBinding('LINE_RETAINAGE', b))]
    }
  }
  else if (rate === null || !B.RETAINAGE_RATE) docAbsence.EXPECTED_RETAINAGE_TOTAL = because(D, 'RETAINAGE_RATE', 'RETAINAGE_RATE not present')
  else B.EXPECTED_RETAINAGE_TOTAL = computed(round4(L4 * rate), 'line 4 × rate', [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_RATE])
  attach['document.G702_RATE'] ??= operandEvidence(B, ['TOTAL_COMPLETED_STORED', 'RETAINAGE_RATE'])

  // line 6 = line 4 − line 5
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = because(D, 'TOTAL_COMPLETED_STORED', 'TOTAL_COMPLETED_STORED not present')
  else if (L5 === null || !B.RETAINAGE_TOTAL) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = because(D, 'RETAINAGE_TOTAL', 'RETAINAGE_TOTAL not present')
  else B.EXPECTED_EARNED_LESS_RETAINAGE = computed(round4(L4 - L5), 'line 4 − line 5', [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_TOTAL])
  attach['document.G702_EARN'] = operandEvidence(B, ['TOTAL_COMPLETED_STORED', 'RETAINAGE_TOTAL'])

  // line 8 = line 6 − line 7 (first application: line 7 blank → 0, recorded)
  const refusedL7 = neverZero(D, ['PREVIOUS_CERTIFICATES'])
  if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_CURRENT_PAYMENT_DUE = because(D, 'TOTAL_EARNED_LESS_RETAINAGE', 'TOTAL_EARNED_LESS_RETAINAGE not present')
  else if (refusedL7 !== undefined) docAbsence.EXPECTED_CURRENT_PAYMENT_DUE = refusedL7
  else {
    const ops = [B.TOTAL_EARNED_LESS_RETAINAGE, ...(L7 !== null && B.PREVIOUS_CERTIFICATES ? [B.PREVIOUS_CERTIFICATES] : [])]
    B.EXPECTED_CURRENT_PAYMENT_DUE = computed(round4(L6 - (L7 ?? 0)), `line 6 − line 7${L7 === null ? ' (line 7 absent → 0)' : ''}`, ops)
  }
  attach['document.G702_DUE'] = operandEvidence(B, ['TOTAL_EARNED_LESS_RETAINAGE', 'PREVIOUS_CERTIFICATES'])

  // line 9 = line 3 − line 6
  if (L3 === null || !B.CONTRACT_SUM_TO_DATE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = because(D, 'CONTRACT_SUM_TO_DATE', 'CONTRACT_SUM_TO_DATE not present')
  else if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = because(D, 'TOTAL_EARNED_LESS_RETAINAGE', 'TOTAL_EARNED_LESS_RETAINAGE not present')
  else B.EXPECTED_BALANCE_INCL_RETAINAGE = computed(round4(L3 - L6), 'line 3 − line 6', [B.CONTRACT_SUM_TO_DATE, B.TOTAL_EARNED_LESS_RETAINAGE])
  attach['document.G702_BAL'] = operandEvidence(B, ['CONTRACT_SUM_TO_DATE', 'TOTAL_EARNED_LESS_RETAINAGE'])

  // line 7 = previous application's line 6
  if (!prevDoc) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = prevAbsence
  else {
    const e = firstKey(prevDoc.doc, EARNED_KEYS, DOC_ROOTS)
    const bound = e ? historyAmount(`history[${prevDoc.index}].${e.path}`, e.value, strict, format) : null
    if (typeof bound === 'string') docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = { reason: 'UNPARSEABLE', detail: bound }
    else if (!bound) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = 'the previous application has no total-earned-less-retainage amount'
    else B.PREVIOUS_EARNED_LESS_RETAINAGE = bound
  }
  // engine 0.6.0: the contract sum's continuity (line 1 unchanged; a line dropped since accounted for), read
  // when line 7 itself agrees with last month (a line 7 that disagrees FAILs, as before)
  const prevEarned = num(B.PREVIOUS_EARNED_LESS_RETAINAGE)
  if (cont?.doc && prevEarned !== null && L7 !== null && Math.abs(L7 - prevEarned) <= CURRENCY_TOLERANCE) {
    delete B.PREVIOUS_EARNED_LESS_RETAINAGE
    docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = { reason: 'AMBIGUOUS_REFERENCE', detail: cont.doc }
  }

  // Engine 0.6.0: every document-level check that cannot run because the pay application was handed over wrapped (or its
  // schedule under a near-miss key) says so, instead of "not present" nine times over.
  if (wrappedDetail !== undefined) {
    const said: Absence = { reason: 'FIELD_MISSING', detail: wrappedDetail }
    for (const k of Object.keys(docAbsence) as UniversalRole[]) docAbsence[k] = said
    for (const role of DOCUMENT_ROLES) if (!B[role]) docAbsence[role] = said
  }

  return { docAbsence, lineAbsence, attach }
}

// ---------------------------------------------------------------- plain words (engine 0.6.0)
/** Money as a person reads it: thousands grouped, cents only when there are any ("6,200", "6,200.50"). Deterministic. */
export function plainMoney(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return JSON.stringify(x) ?? String(x)
  const cents = Math.round(Math.abs(x) * 100)
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = cents % 100
  return `${x < 0 ? '-' : ''}${whole}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`
}
/** A fraction as a percent ("0.8" reads "80%"). */
const plainPct = (x: unknown): string => (typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : JSON.stringify(x) ?? String(x))

/**
 * Each law's FAIL in the words of the form (2026-10-05): what the arithmetic gives, then what the document
 * says. `a` is the stated figure (the claim's asserted), `e` the expected one (its computation's result), `n` the line's position
 * on the continuation sheet (1-based). The rule ids and every number are unchanged; only the sentence is.
 */
const PLAIN: Readonly<Record<string, (a: unknown, e: unknown, n: string) => string>> = {
  G703_TOTAL: (a, e, n) => `line ${n}: previous work plus this period plus stored materials adds to ${plainMoney(e)}, but completed to date says ${plainMoney(a)}`,
  G703_BAL: (a, e, n) => `line ${n}: the scheduled value minus completed to date is ${plainMoney(e)}, but the balance to finish says ${plainMoney(a)}`,
  G703_PCT: (a, e, n) => `line ${n}: completed to date is ${plainPct(e)} of the scheduled value, but the percent complete says ${plainPct(a)}`,
  G703_CAP: (a, e, n) => `line ${n} bills ${plainMoney(a)} to date, more than its scheduled value of ${plainMoney(e)}`,
  G703_PREV: (a, e, n) => `previous on line ${n} is ${plainMoney(a)}, which does not match last month's completed to date for that item, ${plainMoney(e)}`,
  G702_CSUM: (a, e) => `the original contract sum plus change orders is ${plainMoney(e)}, but the contract sum to date says ${plainMoney(a)}`,
  G702_SOV: (a, e) => `the scheduled values add to ${plainMoney(e)}, but the contract sum to date says ${plainMoney(a)}`,
  G702_DONE: (a, e) => `the lines' completed to date add to ${plainMoney(e)}, but the total completed and stored says ${plainMoney(a)}`,
  G702_RSUM: (a, e) => `line retainage adds to ${plainMoney(e)} but the total says ${plainMoney(a)}`,
  G702_RATE: (a, e) => `the retainage rate applied to the total completed and stored gives ${plainMoney(e)}, but the total retainage says ${plainMoney(a)}`,
  G702_EARN: (a, e) => `the total completed and stored minus retainage is ${plainMoney(e)}, but the total earned less retainage says ${plainMoney(a)}`,
  G702_DUE: (a, e) => `earned less retainage minus previous certificates is ${plainMoney(e)}, but the current payment due says ${plainMoney(a)}`,
  G702_BAL: (a, e) => `the contract sum to date minus earned less retainage is ${plainMoney(e)}, but the balance to finish (including retainage) says ${plainMoney(a)}`,
  G702_PREV: (a, e) => `the previous certificates line says ${plainMoney(a)}, but last month's total earned less retainage was ${plainMoney(e)}`,
}

/** What each law checks, in a clerk's words, for a check that could not run ({n}: the line as a person counts it). */
const WHAT: Readonly<Record<string, string>> = {
  G703_TOTAL: "line {n}'s total completed and stored", G703_BAL: "line {n}'s balance to finish", G703_PCT: "line {n}'s percent complete",
  G703_CAP: 'whether line {n} is billed past its scheduled value', G703_PREV: "line {n}'s previous work against last month's application",
  G702_CSUM: 'the contract sum to date', G702_SOV: 'the schedule of values against the contract sum', G702_DONE: 'the total completed and stored',
  G702_RSUM: "the total retainage against the lines' retainage", G702_RATE: 'the retainage against the retainage rate',
  G702_EARN: 'the total earned less retainage', G702_DUE: 'the current payment due', G702_BAL: 'the balance to finish, including retainage',
  G702_PREV: "the previous certificates against last month's application",
}
/** A stated field a clerk supplies: its name in the extraction and what it is on the form. */
const FIELD: Readonly<Partial<Record<UniversalRole, [string, string]>>> = {
  ORIGINAL_CONTRACT_SUM: ['original_contract_sum', 'the original contract sum (line 1)'], NET_CHANGE_ORDERS: ['net_change_orders', 'the net change by change orders (line 2)'],
  CONTRACT_SUM_TO_DATE: ['contract_sum_to_date', 'the contract sum to date (line 3)'], TOTAL_COMPLETED_STORED: ['total_completed_and_stored', 'the total completed and stored (line 4)'],
  RETAINAGE_RATE: ['retainage_rate', 'the retainage rate (for example "10%")'], RETAINAGE_TOTAL: ['total_retainage', 'the total retainage (line 5)'],
  TOTAL_EARNED_LESS_RETAINAGE: ['total_earned_less_retainage', 'the total earned less retainage (line 6)'], PREVIOUS_CERTIFICATES: ['less_previous_certificates', 'the previous certificates (line 7)'],
  CURRENT_PAYMENT_DUE: ['current_payment_due', 'the current payment due (line 8)'], BALANCE_INCL_RETAINAGE: ['balance_to_finish_including_retainage', 'the balance to finish, including retainage (line 9)'],
  SCHEDULED_VALUE: ['scheduled_value', 'the scheduled value (column C)'], WORK_PREVIOUS: ['previous', 'the work from previous applications (column D)'],
  WORK_THIS_PERIOD: ['this_period', 'the work this period (column E)'], MATERIALS_STORED: ['materials_stored', 'the materials presently stored (column F)'],
  COMPLETED_TO_DATE: ['completed_to_date', 'the total completed and stored to date (column G)'], PERCENT_COMPLETE: ['percent_complete', 'the percent complete'],
  BALANCE_TO_FINISH: ['balance_to_finish', 'the balance to finish (column H)'], LINE_RETAINAGE: ['retainage', 'the retainage (column I)'],
}
const ROLE_NAMES = new Set(Object.keys(FIELD))

/**
 * A check that could not run, in a clerk's words (engine 0.6.0): "Cannot evaluate: missing bindings for
 * EXPECTED_RETAINAGE_TOTAL" became "the retainage against the retainage rate cannot be checked: the retainage rate (for example
 * "10%") is not on the application. Supply retainage_rate, or each schedule line's retainage (column I)." The reason and the
 * missing roles are unchanged; only the sentence (explanation, and the detail where it carried role names) is.
 */
function openWords(c: ClaimVerdict, n: string): string | null {
  const what = (WHAT[c.rule_id] ?? 'this check').replace('{n}', n)
  const ins = c.insufficiency
  if (!ins) return null
  if (ins.reason === 'REFERENCE_NOT_PROVIDED') return `${what} cannot be checked: last month's application was not supplied. Supply it as history (--history <last-month.json>), and the check runs`
  // roles a person supplies, named in the detail ("RETAINAGE_RATE not present", "COMPLETED_TO_DATE missing or unparseable")
  const named = [...new Set([...(ins.detail ?? '').matchAll(/\b([A-Z][A-Z_]+[A-Z])\b(?= not present| missing or unparseable)/g)].map(m => m[1]!))].filter(r => ROLE_NAMES.has(r)) as UniversalRole[]
  const stated = named.length ? named : (ins.missing ?? []).filter((r): r is UniversalRole => ROLE_NAMES.has(r))
  if (ins.reason === 'FIELD_MISSING' && stated.length) {
    const f = stated.map(r => FIELD[r]!)
    const tail = c.rule_id === 'G702_RATE' && stated.includes('RETAINAGE_RATE') ? `, or each schedule line's retainage (column I)` : ''
    return `${what} cannot be checked: ${f.map(x => x[1]).join(' and ')} ${f.length === 1 ? 'is' : 'are'} not on the application. Supply ${f.map(x => x[0]).join(' and ')}${tail}, and the check runs`
  }
  // a reason the ruleset already put in words (a refused value, a wrapped application, a reading it would not guess)
  const detail = (ins.detail ?? '').replace(/^[A-Z][A-Z_]+[A-Z]: /, '').replace(/ — Please supply: .*$/, '')
  // 2026-10-05: retainage under the rate that applies was checked, not "cannot be checked": the sentence leads with the
  // dollar difference ("13,741.25 less retained than the stated 10% ...")
  if (c.rule_id === 'G702_RATE' && ins.reason === 'AMBIGUOUS_REFERENCE' && detail) return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}`
  // 2026-10-06: continuity with last month was checked and a person decides: the sentence names the line and the figures
  if (ins.reason === 'AMBIGUOUS_REFERENCE' && detail && ((c.rule_id === 'G703_PREV' && /^line \d/.test(detail)) || c.rule_id === 'G702_PREV')) return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}`
  return detail ? `${what} cannot be checked: ${detail}` : null
}

/**
 * Each law's PASS in the words of the form (engine 0.6.0: a PASS read "Law of Retainage (carried): All
 * predicates satisfied", engine vocabulary). What the arithmetic gives, and that the document says the same. Only the sentence
 * changes; the rule ids, numbers and outcomes do not.
 */
const PLAIN_PASS: Readonly<Record<string, (a: unknown, e: unknown, n: string) => string>> = {
  G703_TOTAL: (_a, e, n) => `line ${n}: previous work plus this period plus stored materials adds to ${plainMoney(e)}, as completed to date says`,
  G703_BAL: (_a, e, n) => `line ${n}: the scheduled value minus completed to date is ${plainMoney(e)}, as the balance to finish says`,
  G703_PCT: (a, e, n) => `line ${n}: completed to date is ${plainPct(e)} of the scheduled value; the percent complete says ${plainPct(a)}${typeof a === 'number' && typeof e === 'number' && Math.abs(a - e) > 1e-9 ? ', within half of one percent (the column is printed rounded)' : ''}`,
  G703_CAP: (a, e, n) => `line ${n} bills ${plainMoney(a)} to date, within its scheduled value of ${plainMoney(e)}`,
  G703_PREV: (a, _e, n) => `previous on line ${n} is ${plainMoney(a)}, last month's completed to date for that item`,
  G702_CSUM: (_a, e) => `the original contract sum plus change orders is ${plainMoney(e)}, as the contract sum to date says`,
  G702_SOV: (_a, e) => `the scheduled values add to ${plainMoney(e)}, as the contract sum to date says`,
  G702_DONE: (_a, e) => `the lines' completed to date add to ${plainMoney(e)}, as the total completed and stored says`,
  G702_RSUM: (_a, e) => `the lines' retainage adds to ${plainMoney(e)}, as the total retainage says`,
  G702_RATE: (_a, e) => `the retainage rate applied to the total completed and stored gives ${plainMoney(e)}, as the total retainage says`,
  G702_EARN: (_a, e) => `the total completed and stored minus retainage is ${plainMoney(e)}, as the total earned less retainage says`,
  G702_DUE: (_a, e) => `earned less retainage minus previous certificates is ${plainMoney(e)}, as the current payment due says`,
  G702_BAL: (_a, e) => `the contract sum to date minus earned less retainage is ${plainMoney(e)}, as the balance to finish (including retainage) says`,
  G702_PREV: (a) => `the previous certificates line says ${plainMoney(a)}, last month's total earned less retainage`,
}

/**
 * Engine 0.6.0: reword every FAILed law in plain words (PLAIN), every check that could not run (openWords, 2026-10-05), and
 * the retainage check's reading (2026-10-05): G702_RATE's computed value names the reading it took (the stated rate, the
 * stated rate read as a ceiling with each line that retains less, or the lines' own retainage with no rate stated), and its
 * explanation and formula say so. Earlier engines keep the kernel's "Law of … VIOLATED" and "Cannot evaluate" text.
 */
function finish(claims: ClaimVerdict[], ctx: FinishContext): void {
  if (!engineAtLeast(ctx.engine, '0.6.0')) return
  for (const c of claims) {
    const i = /^line\[(\d+)\]/.exec(c.claim_id)?.[1]
    const n = i === undefined ? '' : String(Number(i) + 1)
    if (c.outcome === 'FAIL') {
      const say = PLAIN[c.rule_id]
      if (say) c.explanation = say(c.asserted, c.computation?.result, n)
      // 2026-10-06: over the application's own split (lines 5a and 5b), said as the split
      const split = c.rule_id === 'G702_RATE' ? c.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'computed' && e.locator.path.includes('lines 5a and 5b')) : undefined
      if (split && c.computation) {
        c.explanation = `the application's own split, lines 5a and 5b, gives ${plainMoney(c.computation.result)}, but the total retainage says ${plainMoney(c.asserted)}: more retained than the split allows`
        c.computation.formula = 'line 5 = 5a: rate × completed work (line 4 less Σ column F) + 5b: rate × stored materials (Σ column F)'
      }
      continue
    }
    if (c.outcome === 'INSUFFICIENT_DATA') {
      const words = openWords(c, n)
      if (words) {
        c.explanation = words
        if (c.insufficiency && /\b[A-Z][A-Z_]+[A-Z]\b/.test(c.insufficiency.detail ?? '')) c.insufficiency.detail = words
      }
      continue
    }
    if (c.rule_id === 'G702_RATE' && c.computation) {
      const reading = c.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'computed')
      const path = reading?.locator.kind === 'field' ? reading.locator.path : ''
      if (path.startsWith('the total retainage')) {
        c.explanation = `${path.charAt(0).toUpperCase()}${path.slice(1)}.`
        // 2026-10-05: the rate applies, and a line retains less only where the application says so
        c.computation.formula = path.includes('no single retainage rate') ? 'line 5 = Σ column I (no rate stated: the lines\' own retainage)'
          : path.includes('lines 5a and 5b') ? 'line 5 = 5a: rate × completed work (line 4 less Σ column F) + 5b: rate × stored materials (Σ column F)'
            : 'line 5 = Σ column I, each line at the rate unless the application states a lower one for it'
        continue
      } else if (path.startsWith('line 4 × rate; ')) {
        c.explanation = `The total retainage, ${plainMoney(c.asserted)}, is the retainage rate applied to the total completed and stored${path.slice('line 4 × rate'.length)}.`
        continue
      }
    }
    // 2026-10-06: continuity read another way than "previous = last month's completed to date" names the reading
    if (c.rule_id === 'G703_PREV' && c.outcome === 'PASS') {
      const reading = c.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'computed')
      if (reading?.locator.kind === 'field') { c.explanation = `previous on line ${n} is ${plainMoney(c.asserted)}: ${reading.locator.path}`; continue }
    }
    // 2026-10-05: every other PASS in the form's words; the retainage at its rate names the rate and the base it read
    if (c.outcome === 'PASS') {
      const field = (re: RegExp): number | undefined => {
        const e = c.evidence.find(x => x.locator.kind === 'field' && x.locator.source !== 'computed' && re.test(x.locator.path))
        return typeof e?.value === 'number' ? e.value : undefined
      }
      const r = c.rule_id === 'G702_RATE' ? field(/(?:retainage|retention)_(?:rate|percent|percentage|pct)$/) : undefined
      const l4 = c.rule_id === 'G702_RATE' ? field(/total_completed/) : undefined
      if (r !== undefined && l4 !== undefined) { c.explanation = `the total retainage, ${plainMoney(c.asserted)}, is ${plainPct(r)} of the total completed and stored, ${plainMoney(l4)}`; continue }
      const say = PLAIN_PASS[c.rule_id]
      if (say) c.explanation = say(c.asserted, c.computation?.result, n)
    }
  }
}

export const PAY_APP_RULESET: Ruleset = {
  ...PAY_APP_RULESET_REF,
  name: 'Construction pay application (AIA G702 / G703)',
  ontology: PAY_APP_ONTOLOGY,
  axioms: PAY_APP_AXIOMS,
  lineCodes: PAY_APP_LINE_AXIOMS.map(a => a.shortCode),
  documentCodes: PAY_APP_DOCUMENT_AXIOMS.map(a => a.shortCode),
  kindByCode: {
    G703_TOTAL: 'RECOMPUTE', G703_BAL: 'RECOMPUTE', G703_PCT: 'RECOMPUTE', G703_CAP: 'CONSISTENCY', G703_PREV: 'CROSS_REFERENCE',
    G702_CSUM: 'RECOMPUTE', G702_SOV: 'RECOMPUTE', G702_DONE: 'RECOMPUTE', G702_RSUM: 'RECOMPUTE', G702_RATE: 'RECOMPUTE',
    G702_EARN: 'RECOMPUTE', G702_DUE: 'RECOMPUTE', G702_BAL: 'RECOMPUTE', G702_PREV: 'CROSS_REFERENCE',
  },
  fieldByCode: {
    G703_TOTAL: 'completed_to_date', G703_BAL: 'balance_to_finish', G703_PCT: 'percent_complete', G703_CAP: 'completed_to_date', G703_PREV: 'previous',
    G702_CSUM: 'contract_sum_to_date', G702_SOV: 'contract_sum_to_date', G702_DONE: 'total_completed_and_stored',
    G702_RSUM: 'total_retainage', G702_RATE: 'total_retainage', G702_EARN: 'total_earned_less_retainage',
    G702_DUE: 'current_payment_due', G702_BAL: 'balance_to_finish_including_retainage', G702_PREV: 'less_previous_certificates',
  },
  remedyByCode: PAY_APP_REMEDIES,
  // engine 0.6.0 (2026-10-05): the remedies name a line as the claim does, counting from 1 (axioms.ts PAY_APP_REMEDIES_V060)
  remedyByCodeFor: (engine) => (engineAtLeast(engine, '0.6.0') ? PAY_APP_REMEDIES_V060 : PAY_APP_REMEDIES),
  referenceRoles: {
    contract: [],
    evidence: [],
    history: ['PREVIOUS_COMPLETED_TO_DATE', 'PREVIOUS_EARNED_LESS_RETAINAGE'],
  },
  computedRoles: [
    'EXPECTED_COMPLETED_TO_DATE', 'EXPECTED_BALANCE_TO_FINISH', 'EXPECTED_PERCENT_COMPLETE',
    'EXPECTED_CONTRACT_SUM_TO_DATE', 'SOV_SCHEDULED_SUM', 'SOV_COMPLETED_SUM', 'SOV_RETAINAGE_SUM',
    'EXPECTED_RETAINAGE_TOTAL', 'EXPECTED_EARNED_LESS_RETAINAGE', 'EXPECTED_CURRENT_PAYMENT_DUE', 'EXPECTED_BALANCE_INCL_RETAINAGE',
  ],
  ambiguityGuards: [],
  compute,
  finish,
}

export default PAY_APP_RULESET
