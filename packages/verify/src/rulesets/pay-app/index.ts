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
 */

import type { BoundValue, UniversalRole } from '../../kernel/types.js'
import { normalizeAmount, normalizeReference } from '../../binding/forensic-normalizer.js'
import { evidenceFromBinding } from '../../verdict/from-report.js'
import type { Evidence } from '../../verdict/schema.js'
import { PAY_APP_RULESET_REF } from '../../version.js'
import { PAY_APP_AXIOMS, PAY_APP_DOCUMENT_AXIOMS, PAY_APP_LINE_AXIOMS } from './axioms.js'
import { PAY_APP_LINE_ARRAY_KEYS, PAY_APP_ONTOLOGY } from './ontology.js'
import { computed, num, round4, type Absence, type AbsenceMap, type ComputeInput, type ComputeOutput, type Json, type Ruleset } from '../types.js'

export { PAY_APP_AXIOMS, PAY_APP_LINE_AXIOMS, PAY_APP_DOCUMENT_AXIOMS, CURRENCY_TOLERANCE, PERCENT_TOLERANCE } from './axioms.js'
export { PAY_APP_ONTOLOGY } from './ontology.js'

type Bindings = Partial<Record<UniversalRole, BoundValue>>

function operandEvidence(b: Bindings, roles: UniversalRole[]): Evidence[] {
  const out: Evidence[] = []
  for (const r of roles) if (b[r]) out.push(evidenceFromBinding(r, b[r] as BoundValue))
  return out
}

/** Bound line amounts for a role across all lines — or the reasons some lines could not contribute. */
function column(lineCtxs: ComputeInput['lineCtxs'], role: UniversalRole, lineKey: string): { values: BoundValue[]; problems: string[] } {
  const values: BoundValue[] = []
  const problems: string[] = []
  lineCtxs.forEach((ctx, i) => {
    const b = ctx.bindings[role]
    if (b && num(b) !== null) values.push({ ...b, field: b.field.replace('[*]', `[${i}]`) })
    else problems.push(`${lineKey}[${i}]: ${role} missing or unparseable`)
  })
  return { values, problems }
}

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

/** Bind a history amount with full provenance (source 'history', path into the caller's document). */
function historyAmount(path: string, raw: unknown): BoundValue | null {
  const n = normalizeAmount(raw)
  if (!n?.success) return null
  return {
    value: n.normalized, source: 'history', field: path, confidence: 100,
    originalValue: (n.original ?? raw) as string | number | null, normalizedValue: n.normalized, normalizations: n.transformations,
  }
}

// ---------------------------------------------------------------- compute
function compute({ extraction, references, docCtx, lineCtxs }: ComputeInput): ComputeOutput {
  const docAbsence: AbsenceMap = {}
  const lineAbsence: AbsenceMap[] = lineCtxs.map(() => ({}))
  const attach: Record<string, Evidence[]> = {}
  const arr = lineArrayOf(extraction)
  const lineKey = arr?.key ?? 'schedule_of_values'
  const lines = arr?.lines ?? []

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

  // ---- G703 per line
  lineCtxs.forEach((ctx, i) => {
    const B = ctx.bindings
    const A = lineAbsence[i] as AbsenceMap
    const C = num(B.SCHEDULED_VALUE), Dv = num(B.WORK_PREVIOUS), E = num(B.WORK_THIS_PERIOD), F = num(B.MATERIALS_STORED), G = num(B.COMPLETED_TO_DATE)

    // G = D + E + F  (blank cells are zero by the form's convention — and the formula says which were blank)
    if (Dv === null && E === null && F === null) {
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
    if (C === null || !B.SCHEDULED_VALUE) A.EXPECTED_BALANCE_TO_FINISH = 'SCHEDULED_VALUE not present on the line'
    else if (G === null || !B.COMPLETED_TO_DATE) A.EXPECTED_BALANCE_TO_FINISH = 'COMPLETED_TO_DATE not present on the line'
    else B.EXPECTED_BALANCE_TO_FINISH = computed(round4(C - G), 'C − G', [B.SCHEDULED_VALUE, B.COMPLETED_TO_DATE])
    attach[`line[${i}].G703_BAL`] = operandEvidence(B, ['SCHEDULED_VALUE', 'COMPLETED_TO_DATE'])

    // % = G ÷ C
    if (C === null || !B.SCHEDULED_VALUE) A.EXPECTED_PERCENT_COMPLETE = 'SCHEDULED_VALUE not present on the line'
    else if (C === 0) A.EXPECTED_PERCENT_COMPLETE = 'SCHEDULED_VALUE is zero; percent complete is undefined'
    else if (G === null || !B.COMPLETED_TO_DATE) A.EXPECTED_PERCENT_COMPLETE = 'COMPLETED_TO_DATE not present on the line'
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
      if (id === null) A.PREVIOUS_COMPLETED_TO_DATE = `${lineKey}[${i}] has no item number; lines are matched to the previous application by item number only`
      else {
        const hit = prevById.get(id)
        if (hit === undefined) A.PREVIOUS_COMPLETED_TO_DATE = `no line in the previous application carries item number ${id}`
        else if (hit === 'duplicate') A.PREVIOUS_COMPLETED_TO_DATE = { reason: 'AMBIGUOUS_REFERENCE', detail: `the previous application lists item number ${id} more than once` }
        else {
          const g = firstKey(hit.line, COMPLETED_KEYS)
          const bound = g ? historyAmount(`${hit.path}.${g.path}`, g.value) : null
          if (!bound) A.PREVIOUS_COMPLETED_TO_DATE = `previous application item ${id} has no completed-to-date amount`
          else B.PREVIOUS_COMPLETED_TO_DATE = bound
        }
      }
    }
  })

  // ---- G702 document
  const B = docCtx.bindings
  const L1 = num(B.ORIGINAL_CONTRACT_SUM), L2 = num(B.NET_CHANGE_ORDERS), L3 = num(B.CONTRACT_SUM_TO_DATE)
  const L4 = num(B.TOTAL_COMPLETED_STORED), L5 = num(B.RETAINAGE_TOTAL), rate = num(B.RETAINAGE_RATE)
  const L6 = num(B.TOTAL_EARNED_LESS_RETAINAGE), L7 = num(B.PREVIOUS_CERTIFICATES)

  // line 3 = line 1 + line 2 (no change orders → 0, recorded)
  if (L1 === null || !B.ORIGINAL_CONTRACT_SUM) docAbsence.EXPECTED_CONTRACT_SUM_TO_DATE = 'ORIGINAL_CONTRACT_SUM not present'
  else {
    const ops = [B.ORIGINAL_CONTRACT_SUM, ...(L2 !== null && B.NET_CHANGE_ORDERS ? [B.NET_CHANGE_ORDERS] : [])]
    B.EXPECTED_CONTRACT_SUM_TO_DATE = computed(round4(L1 + (L2 ?? 0)), `line 1 + line 2${L2 === null ? ' (line 2 absent → 0)' : ''}`, ops)
  }
  attach['document.G702_CSUM'] = operandEvidence(B, ['ORIGINAL_CONTRACT_SUM', 'NET_CHANGE_ORDERS'])

  // Σ C, Σ G, Σ I
  if (lines.length === 0) {
    docAbsence.SOV_SCHEDULED_SUM = docAbsence.SOV_COMPLETED_SUM = docAbsence.SOV_RETAINAGE_SUM = 'no schedule-of-values array on the extraction'
  } else {
    const sc = column(lineCtxs, 'SCHEDULED_VALUE', lineKey)
    if (sc.problems.length) docAbsence.SOV_SCHEDULED_SUM = sc.problems.join('; ')
    else {
      B.SOV_SCHEDULED_SUM = computed(round4(sc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${sc.values.map(b => b.field).join(' + ')})`, sc.values)
      attach['document.G702_SOV'] = sc.values.map(b => evidenceFromBinding('SCHEDULED_VALUE', b))
    }
    const gc = column(lineCtxs, 'COMPLETED_TO_DATE', lineKey)
    if (gc.problems.length) docAbsence.SOV_COMPLETED_SUM = gc.problems.join('; ')
    else {
      B.SOV_COMPLETED_SUM = computed(round4(gc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${gc.values.map(b => b.field).join(' + ')})`, gc.values)
      attach['document.G702_DONE'] = gc.values.map(b => evidenceFromBinding('COMPLETED_TO_DATE', b))
    }
    const rc = column(lineCtxs, 'LINE_RETAINAGE', lineKey)
    if (rc.values.length === 0) docAbsence.SOV_RETAINAGE_SUM = 'no line-level retainage on the continuation sheet (column I absent)'
    else if (rc.problems.length) docAbsence.SOV_RETAINAGE_SUM = rc.problems.join('; ')
    else {
      B.SOV_RETAINAGE_SUM = computed(round4(rc.values.reduce((a, b) => a + (b.value as number), 0)), `Σ(${rc.values.map(b => b.field).join(' + ')})`, rc.values)
      attach['document.G702_RSUM'] = rc.values.map(b => evidenceFromBinding('LINE_RETAINAGE', b))
    }
  }

  // line 5 = line 4 × rate
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_RETAINAGE_TOTAL = 'TOTAL_COMPLETED_STORED not present'
  else if (rate === null || !B.RETAINAGE_RATE) docAbsence.EXPECTED_RETAINAGE_TOTAL = 'RETAINAGE_RATE not present'
  else B.EXPECTED_RETAINAGE_TOTAL = computed(round4(L4 * rate), 'line 4 × rate', [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_RATE])
  attach['document.G702_RATE'] = operandEvidence(B, ['TOTAL_COMPLETED_STORED', 'RETAINAGE_RATE'])

  // line 6 = line 4 − line 5
  if (L4 === null || !B.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = 'TOTAL_COMPLETED_STORED not present'
  else if (L5 === null || !B.RETAINAGE_TOTAL) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = 'RETAINAGE_TOTAL not present'
  else B.EXPECTED_EARNED_LESS_RETAINAGE = computed(round4(L4 - L5), 'line 4 − line 5', [B.TOTAL_COMPLETED_STORED, B.RETAINAGE_TOTAL])
  attach['document.G702_EARN'] = operandEvidence(B, ['TOTAL_COMPLETED_STORED', 'RETAINAGE_TOTAL'])

  // line 8 = line 6 − line 7 (first application: line 7 blank → 0, recorded)
  if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_CURRENT_PAYMENT_DUE = 'TOTAL_EARNED_LESS_RETAINAGE not present'
  else {
    const ops = [B.TOTAL_EARNED_LESS_RETAINAGE, ...(L7 !== null && B.PREVIOUS_CERTIFICATES ? [B.PREVIOUS_CERTIFICATES] : [])]
    B.EXPECTED_CURRENT_PAYMENT_DUE = computed(round4(L6 - (L7 ?? 0)), `line 6 − line 7${L7 === null ? ' (line 7 absent → 0)' : ''}`, ops)
  }
  attach['document.G702_DUE'] = operandEvidence(B, ['TOTAL_EARNED_LESS_RETAINAGE', 'PREVIOUS_CERTIFICATES'])

  // line 9 = line 3 − line 6
  if (L3 === null || !B.CONTRACT_SUM_TO_DATE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = 'CONTRACT_SUM_TO_DATE not present'
  else if (L6 === null || !B.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = 'TOTAL_EARNED_LESS_RETAINAGE not present'
  else B.EXPECTED_BALANCE_INCL_RETAINAGE = computed(round4(L3 - L6), 'line 3 − line 6', [B.CONTRACT_SUM_TO_DATE, B.TOTAL_EARNED_LESS_RETAINAGE])
  attach['document.G702_BAL'] = operandEvidence(B, ['CONTRACT_SUM_TO_DATE', 'TOTAL_EARNED_LESS_RETAINAGE'])

  // line 7 = previous application's line 6
  if (!prevDoc) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = prevAbsence
  else {
    const e = firstKey(prevDoc.doc, EARNED_KEYS, DOC_ROOTS)
    const bound = e ? historyAmount(`history[${prevDoc.index}].${e.path}`, e.value) : null
    if (!bound) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = 'the previous application has no total-earned-less-retainage amount'
    else B.PREVIOUS_EARNED_LESS_RETAINAGE = bound
  }

  return { docAbsence, lineAbsence, attach }
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
}

export default PAY_APP_RULESET
