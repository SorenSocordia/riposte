/**
 * Completeness reconciliation: did every payment go through the control?
 *
 * An auditor relying on Riposte as an automated control asks this before anything else. The hash chain makes an edit to
 * the book detectable (a recomputed one only against external checkpoints: docs/ANCHORING.md); it cannot show that
 * nothing was LEFT OUT. AS 1105 .10 (quoted from pcaobus.org in the research note "Automated-approval evidence
 * standards", 2026-09-28, §1.3 ✓): when using information produced by the company
 * as audit evidence, the auditor should "Test the accuracy and completeness of the information, or test the controls over
 * the accuracy and completeness of that information". This module reconciles the book against the customer's own
 * system-of-record population (the AP payment register, a GL payments extract) and reports, deterministically:
 *
 *   BYPASSED               a payment with no verdict on the book: it never went through the check.
 *   ORPHAN                 a verdict on the book (in the period) with no payment: unpaid, paid outside the population, or
 *                          a sign the population itself is incomplete.
 *   MISMATCHED             matched by key, but the amount / payee / currency / invoice date on the book differs from what
 *                          was paid: the extraction that was checked is not what was paid.
 *   PAID_DESPITE_HOLD      paid, while the book says the verdict was a FAIL/ABSTAIN HELD at gate/autonomy (the GRANT in
 *                          force when it was recorded) with no person's resolution by the payment date. A control override.
 *   CHECKED_AFTER_PAYMENT  the verdict reached the book on a later day than the payment: the check did not gate it.
 *   AMBIGUOUS              two records for one row, or two rows for one record (a possible duplicate payment). Reported,
 *                          never resolved.
 *   UNREADABLE / UNKEYED   a population value the declared format cannot read (only with on_malformed: 'report'; the
 *                          default refuses) / a book record whose declared key cannot be read.
 *
 * Matching is DECLARED (./types.ts CompletenessMapping): which column is which field, how keys normalize, the amount and
 * date tolerances (exact by default), where each book field is read. Nothing is inferred from the data.
 *
 * Deterministic: the same book, population, mapping and options give the same bytes and the same report_hash. The only
 * clock is `generated_at`, and only when options.now is supplied (it is outside the hash).
 *
 * THE BOUNDARY: completeness of the population itself is the customer's IPE responsibility; this proves the book covers the
 * population you gave it.
 */

import { hashOf } from '../../verdict/canonical.js'
import { describeBound, rateInterval, type BoundMethod, type Sidedness } from '../../verdict/bounds.js'
import { ACTION_HANDLING } from '../../verdict/notices.js'
import { grantAt, isAnchored, type DecisionEntry, type GrantDecision, type GrantReadOptions } from '../../ledger/decisions.js'
import { tenantOfWorkflow } from '../../ledger/registry.js'
import type { VoiceLevel } from '../../verdict/voice.js'
import { ENGINE_VERSION } from '../../version.js'
import { readBook, type BookInput, type BookRecordView } from './book.js'
import { populationRowsHash, type Population, type PopulationRow } from './population.js'
import {
  DEC_ZERO, assertDateFormat, daysBetween, decAbs, decAdd, decCmp, decMul, decSub, decToString, effectiveAmountFormat, effectiveKeyRules,
  keyText, localDateOf, normalizeCurrency, normalizeKey, readAmount, readConstant, readDate, readUtcOffset, type Dec,
} from './values.js'
import {
  BOOK_CLASSES, BOOK_FIELDS, CompletenessRefused, KEY_FIELDS, MATCH_PRECEDENCE, POPULATION_CLASSES, POPULATION_FIELDS,
  type AmbiguousGroup, type BookClass, type BookField, type BookRef, type BookSource, type BypassedItem, type CompareField,
  type CompletenessMapping, type CompletenessOptions, type CompletenessReport, type EffectiveMapping, type FieldDifference, type HoldInfo,
  type KeyField, type MatchedItem, type OrphanItem, type PopulationClass, type PopulationField, type PopulationRef, type Uncompared,
  type UnkeyedItem, type UnreadableItem,
} from './types.js'

export const COMPLETENESS_BOUNDARY: readonly string[] = [
  'Completeness of the population itself is the customer\'s IPE responsibility; this proves the book covers the population you gave it.',
  'Every population row is read as a payment. A voided or reversed payment in the export is still a row here.',
  'A match proves a verdict for this key is on the verified book. It does not prove the extraction is faithful to the paper document: that is the check\'s own job, measured separately.',
  'The book verified whole before any record was read. Its head is not externally anchored by this report: a party with write access to the store could recompute the chain. Anchor the head to make it third-party provable.',
  'Orphans can mean an item was paid outside this population. A PASS orphan is the one window this report has into whether the population is incomplete.',
  'PAID DESPITE HOLD sees only holds that are on the book. A held action the deployment did not record reads here as BYPASSED (a payment with no verdict), still an exception, but not named as an override.',
  'A rung is read only from a GRANT whose signer is anchored to a person (trusted or registered keys); an unanchored GRANT has no effect, and the rung falls back to the declared one, then to record.',
]

const COVERAGE_NOTE =
  'For the population given, the counts are exact: it is a census, not a sample. The bound treats this period as one draw from the process that produced it: the per-payment not-on-book rate the data cannot rule out for that process.'

// ── the mapping, made explicit ──────────────────────────────────────────────────────────────────────────────────────

const COMPARABLE: readonly CompareField[] = ['vendor_id', 'amount', 'currency', 'invoice_date']

function isSource(s: unknown): s is BookSource {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const k = Object.keys(s)
  if (k.length !== 1) return false
  const v = (s as Record<string, unknown>)[k[0]!]
  return (k[0] === 'extraction' || k[0] === 'claim') && typeof v === 'string' && v.trim() !== ''
}

/** Validate a mapping and fill every default. Throws CompletenessRefused on anything it would otherwise have to guess. */
export function effectiveCompletenessMapping(m: CompletenessMapping): EffectiveMapping {
  const bad = (why: string): never => { throw new CompletenessRefused(`mapping: ${why}`) }
  if (!m || typeof m !== 'object') bad('a mapping object is required')
  if (m.mapping_version !== 'completeness-mapping-v0') bad(`mapping_version must be "completeness-mapping-v0" (got ${JSON.stringify(m.mapping_version)})`)
  if (!Array.isArray(m.key) || m.key.length === 0) bad('key must name at least one of invoice_number, vendor_id')
  const key = [...new Set(m.key)]
  if (key.length !== m.key.length) bad('key names a field twice')
  for (const k of key) if (!KEY_FIELDS.includes(k)) bad(`key field ${JSON.stringify(k)} is not one of ${KEY_FIELDS.join(', ')}`)
  const cols = m.population?.columns
  if (!cols || typeof cols !== 'object') bad('population.columns is required')
  for (const [f, c] of Object.entries(cols)) {
    if (c === undefined) continue
    if (!POPULATION_FIELDS.includes(f as PopulationField)) bad(`population.columns names an unknown field ${JSON.stringify(f)} (fields: ${POPULATION_FIELDS.join(', ')})`)
    if (typeof c !== 'string' || c === '') bad(`population.columns.${f} must be a column name`)
  }
  const fields = m.book?.fields
  if (!fields || typeof fields !== 'object') bad('book.fields is required')
  for (const [f, srcs] of Object.entries(fields)) {
    if (srcs === undefined) continue
    if (!BOOK_FIELDS.includes(f as BookField)) bad(`book.fields names an unknown field ${JSON.stringify(f)} (fields: ${BOOK_FIELDS.join(', ')})`)
    if (!Array.isArray(srcs) || srcs.length === 0 || !srcs.every(isSource)) bad(`book.fields.${f} must be a non-empty list of { extraction: "<path>" } or { claim: "<claim_id>" }`)
  }
  for (const k of key) {
    if (!cols[k]) bad(`key field ${k} has no population column`)
    if (!fields[k as BookField]) bad(`key field ${k} has no book source`)
  }
  const wrap = <T>(what: string, f: () => T): T => { try { return f() } catch (e) { return bad(`${what}: ${(e as Error).message}`) } }
  const tolAbs = wrap('amount_tolerance.abs', () => readConstant(m.amount_tolerance?.abs ?? 0, 'amount_tolerance.abs'))
  const tolRel = wrap('amount_tolerance.rel', () => readConstant(m.amount_tolerance?.rel ?? 0, 'amount_tolerance.rel'))
  const days = m.date_tolerance_days ?? 0
  if (!Number.isInteger(days) || days < 0) bad(`date_tolerance_days must be a non-negative integer (got ${JSON.stringify(m.date_tolerance_days)})`)
  const offset = m.payment_date_utc_offset ?? '+00:00'
  wrap('payment_date_utc_offset', () => readUtcOffset(offset))
  const onMal = m.on_malformed ?? 'refuse'
  if (onMal !== 'refuse' && onMal !== 'report') bad(`on_malformed must be refuse or report (got ${JSON.stringify(m.on_malformed)})`)
  const normalize = {} as Record<KeyField, ReturnType<typeof effectiveKeyRules>>
  for (const k of KEY_FIELDS) normalize[k] = wrap(`normalize.${k}`, () => effectiveKeyRules(m.normalize?.[k], `normalize.${k}`))
  for (const k of Object.keys(m.normalize ?? {})) if (!KEY_FIELDS.includes(k as KeyField)) bad(`normalize names an unknown key field ${JSON.stringify(k)}`)
  const compared = COMPARABLE.filter(f => !key.includes(f as KeyField) && cols[f] !== undefined && fields[f as BookField] !== undefined)
  const sortObj = <T>(o: Partial<Record<string, T>>): Partial<Record<string, T>> => Object.fromEntries(Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => [k, o[k]]))
  return {
    mapping_version: 'completeness-mapping-v0',
    key: KEY_FIELDS.filter(k => key.includes(k)),
    population: {
      columns: sortObj(cols) as EffectiveMapping['population']['columns'],
      amount_format: wrap('population.amount_format', () => effectiveAmountFormat(m.population.amount_format)),
      date_format: wrap('population.date_format', () => assertDateFormat(m.population.date_format ?? 'YYYY-MM-DD', 'population.date_format')),
    },
    book: {
      fields: sortObj(Object.fromEntries(Object.entries(fields).filter(([, s]) => s !== undefined).map(([f, s]) => [f, (s as BookSource[]).map(x => ({ ...x }))]))) as EffectiveMapping['book']['fields'],
      amount_format: wrap('book.amount_format', () => effectiveAmountFormat(m.book.amount_format)),
      date_format: wrap('book.date_format', () => assertDateFormat(m.book.date_format ?? 'YYYY-MM-DD', 'book.date_format')),
    },
    normalize,
    amount_tolerance: { abs: decToString(tolAbs), rel: decToString(tolRel) },
    date_tolerance_days: days,
    payment_date_utc_offset: offset,
    on_malformed: onMal,
    compared,
  }
}

// ── reading values ──────────────────────────────────────────────────────────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

interface ReadRow {
  ref: PopulationRef
  amount?: Dec
  keyString?: string
  missingKey: KeyField[]
  problems: UnreadableItem['problems']
}

function readPopulationRow(r: PopulationRow, m: EffectiveMapping, csv: boolean): ReadRow {
  const val = (f: PopulationField): unknown => {
    const col = m.population.columns[f]
    if (col === undefined) return undefined
    if (csv || Object.prototype.hasOwnProperty.call(r.values, col)) return r.values[col]
    return getPath(r.values, col)
  }
  const problems: UnreadableItem['problems'] = []
  const problem = (field: PopulationField, raw: unknown, why: string): void => {
    problems.push({ field, column: m.population.columns[field]!, value: typeof raw === 'string' ? raw : JSON.stringify(raw), why })
  }
  const ref: PopulationRef = { row: r.row, line: r.line, key: {} }
  const missingKey: KeyField[] = []
  for (const k of KEY_FIELDS) {
    if (m.population.columns[k] === undefined) continue
    const raw = val(k)
    if (blank(raw)) { if (m.key.includes(k)) missingKey.push(k); continue }
    const t = keyText(raw)
    if (t === undefined) continue
    if (typeof t === 'object') { problem(k, raw, t.problem); continue }
    const norm = normalizeKey(t, m.normalize[k])
    if (norm === '') { if (m.key.includes(k)) missingKey.push(k); continue }
    if (m.key.includes(k)) ref.key[k] = norm
    if (k === 'vendor_id') ref.vendor_id = norm
  }
  const pid = val('payment_id')
  if (!blank(pid)) ref.payment_id = String(pid)
  let amount: Dec | undefined
  const rawAmt = val('amount')
  if (!blank(rawAmt)) {
    const a = readAmount(rawAmt, m.population.amount_format)
    if ('problem' in a) problem('amount', rawAmt, a.problem)
    else { amount = a; ref.amount = decToString(a) }
  }
  const rawCur = val('currency')
  const c = normalizeCurrency(rawCur)
  if (typeof c === 'object') problem('currency', rawCur, c.problem)
  else if (c !== undefined) ref.currency = c
  for (const f of ['invoice_date', 'payment_date'] as const) {
    const raw = val(f)
    if (blank(raw)) continue
    const d = readDate(raw, m.population.date_format)
    if (typeof d === 'object') problem(f, raw, d.problem)
    else ref[f] = d
  }
  const keyString = missingKey.length === 0 && problems.every(p => !m.key.includes(p.field as KeyField)) ? m.key.map(k => ref.key[k] ?? '').join('\u0000') : undefined
  return { ref, ...(amount !== undefined ? { amount } : {}), ...(keyString !== undefined ? { keyString } : {}), missingKey, problems }
}

interface ReadBook {
  view: BookRecordView
  ref: BookRef
  amount?: Dec
  keyString?: string
  missingKey: KeyField[]
  keyWhy: string[]
  /** A book field read but not readable under the declared format. */
  unreadable: Partial<Record<CompareField, string>>
  usedExtraction: string | undefined
}

function readBookRecord(v: BookRecordView, m: EffectiveMapping, extractions: Map<string, unknown>): ReadBook {
  const ex = extractions.get(v.verdict.document?.extraction_hash)
  const sources: BookRef['sources'] = {}
  const raw = (f: BookField): { value: unknown; source: string } | undefined => {
    for (const s of m.book.fields[f] ?? []) {
      let value: unknown
      let source: string
      if ('extraction' in s) {
        if (ex === undefined) continue
        value = getPath(ex, s.extraction)
        source = `extraction:${s.extraction}`
      } else {
        value = v.verdict.claims?.find(c => c.claim_id === s.claim)?.asserted
        source = `claim:${s.claim}`
      }
      if (!blank(value)) return { value, source }
    }
    return undefined
  }
  const ref: BookRef = {
    verdict_id: v.verdict_id, tenant_id: v.tenant_id, workflow_id: v.workflow_id, outcome: v.verdict.outcome,
    record_seq: v.record.seq, entry_hash: v.record.entry_hash, recorded_at: v.record.recorded_at, first_recorded_at: v.first_record.recorded_at,
    key: {}, sources,
  }
  const missingKey: KeyField[] = []
  const keyWhy: string[] = []
  const unreadable: ReadBook['unreadable'] = {}
  for (const k of KEY_FIELDS) {
    if (m.book.fields[k] === undefined) continue
    const r = raw(k)
    const t = r ? keyText(r.value) : undefined
    const norm = typeof t === 'string' ? normalizeKey(t, m.normalize[k]) : undefined
    if (!r || typeof t !== 'string' || !norm) {
      if (m.key.includes(k)) {
        missingKey.push(k)
        keyWhy.push(!r ? `${k}: no declared source yielded a value${ex === undefined && (m.book.fields[k] ?? []).some(s => 'extraction' in s) ? ' (its extraction was not supplied)' : ''}` : `${k}: ${typeof t === 'object' ? t.problem : 'empty after normalization'}`)
      } else if (r && k === 'vendor_id') unreadable.vendor_id = typeof t === 'object' ? t.problem : 'empty after normalization'
      continue
    }
    sources[k] = r.source
    if (m.key.includes(k)) ref.key[k] = norm
    if (k === 'vendor_id') ref.vendor_id = norm
  }
  let amount: Dec | undefined
  const ra = raw('amount')
  if (ra) {
    const a = readAmount(ra.value, m.book.amount_format)
    if ('problem' in a) unreadable.amount = a.problem
    else { amount = a; ref.amount = decToString(a); sources.amount = ra.source }
  }
  const rc = raw('currency')
  if (rc) {
    const c = normalizeCurrency(rc.value)
    if (typeof c === 'object') unreadable.currency = c.problem
    else if (c !== undefined) { ref.currency = c; sources.currency = rc.source }
  }
  const rd = raw('invoice_date')
  if (rd) {
    const d = readDate(rd.value, m.book.date_format)
    if (typeof d === 'object') unreadable.invoice_date = d.problem
    else { ref.invoice_date = d; sources.invoice_date = rd.source }
  }
  const keyString = missingKey.length === 0 ? m.key.map(k => ref.key[k] ?? '').join('\u0000') : undefined
  const usedExtraction = ex !== undefined && Object.values(sources).some(s => s?.startsWith('extraction:')) ? v.verdict.document.extraction_hash : undefined
  return { view: v, ref, ...(amount !== undefined ? { amount } : {}), ...(keyString !== undefined ? { keyString } : {}), missingKey, keyWhy, unreadable, usedExtraction }
}

// ── the rung a record was held at ───────────────────────────────────────────────────────────────────────────────────

interface RungAt { level: VoiceLevel; from: 'grant' | 'declared' | 'none'; grant?: DecisionEntry<GrantDecision> }

function rungAt(decisions: readonly DecisionEntry[], granted: Set<string>, declared: Readonly<Record<string, VoiceLevel>>, workflow_id: string, seq: number, reading: GrantReadOptions): RungAt {
  if (granted.has(workflow_id)) {
    const g = grantAt(decisions, workflow_id, seq, reading)
    return g ? { level: g.signed.decision.level, from: 'grant', grant: g } : { level: 'record', from: 'grant' }
  }
  const d = declared[workflow_id]
  return d !== undefined ? { level: d, from: 'declared' } : { level: 'record', from: 'none' }
}

/** The first RECORD of a FAIL/ABSTAIN that fell under a holding rung, or undefined (never held). */
function holdOf(b: ReadBook, decisions: readonly DecisionEntry[], granted: Set<string>, declared: Readonly<Record<string, VoiceLevel>>, reading: GrantReadOptions): RungAt | undefined {
  const o = b.view.verdict.outcome
  if (o !== 'FAIL' && o !== 'INSUFFICIENT_DATA') return undefined
  for (const seq of b.view.record_seqs) {
    const r = rungAt(decisions, granted, declared, b.view.workflow_id, seq, reading)
    if (ACTION_HANDLING[r.level]?.[o] === 'HOLD') return r
  }
  return undefined
}

// ── the reconciliation ──────────────────────────────────────────────────────────────────────────────────────────────

function addTo(totals: Record<string, Dec>, currency: string | undefined, amount: Dec | undefined): void {
  if (amount === undefined) return
  const c = currency ?? 'UNSPECIFIED'
  totals[c] = decAdd(totals[c] ?? DEC_ZERO, amount)
}

const totalsOut = (t: Record<string, Dec>): Record<string, string> => Object.fromEntries(Object.keys(t).sort().map(k => [k, decToString(t[k]!)]))

function checkInterval(i: CompletenessOptions['interval']): { method: BoundMethod; confidence: number; sidedness: Sidedness } {
  const method = i?.method ?? 'clopper-pearson'
  const confidence = i?.confidence ?? 0.95
  const sidedness = i?.sidedness ?? 'one-sided'
  if (method !== 'wilson' && method !== 'clopper-pearson') throw new CompletenessRefused(`interval.method must be wilson or clopper-pearson (got ${JSON.stringify(method)})`)
  if (!(confidence >= 0.5 && confidence < 1)) throw new CompletenessRefused(`interval.confidence must be in [0.5, 1) (got ${confidence})`)
  if (sidedness !== 'one-sided' && sidedness !== 'two-sided') throw new CompletenessRefused(`interval.sidedness must be one-sided or two-sided (got ${JSON.stringify(sidedness)})`)
  return { method, confidence, sidedness }
}

/**
 * Reconcile the book against a system-of-record population. Deterministic. Throws CompletenessRefused for a mapping it would
 * have to guess at, a book that does not verify, or (by default) a population value the declared format cannot read.
 */
export function reconcileCompleteness(population: Population, book: BookInput, mapping: CompletenessMapping, options: CompletenessOptions = {}): CompletenessReport {
  const m = effectiveCompletenessMapping(mapping)
  const interval = checkInterval(options.interval)
  const offsetMin = readUtcOffset(m.payment_date_utc_offset)
  const scope = options.scope ?? {}
  // Period bounds are compared with the book's UTC clock (ISO-8601 'Z' strings), so they are normalized to that form first.
  const period: { since?: string; until?: string } = {}
  for (const k of ['since', 'until'] as const) {
    const v = options.period?.[k]
    if (v === undefined) continue
    const ms = Date.parse(v)
    if (Number.isNaN(ms)) throw new CompletenessRefused(`period.${k} is not an ISO-8601 instant: ${JSON.stringify(v)}`)
    period[k] = new Date(ms).toISOString()
  }
  const declared = options.rungs ?? {}
  // P-S4-C (D-GOVERNING-POLICY): the declared policy judges every grant a record's rung is read from.
  const reading: GrantReadOptions = options.policy ? { policies: [options.policy], governing_policy: options.policy } : {}
  const csv = population.format === 'csv'
  if (csv && population.columns) {
    for (const [f, col] of Object.entries(m.population.columns)) {
      if (!population.columns.includes(col!)) throw new CompletenessRefused(`mapping: population.columns.${f} names column ${JSON.stringify(col)}, which the header does not have (header: ${population.columns.map(c => JSON.stringify(c)).join(', ')})`)
    }
  }

  // The book, verified whole, then scoped.
  const bv = readBook(book, options.anchors ?? {})
  // D-ANCHOR: only a GRANT whose signer is anchored moves a rung (grantAt selects the same way); an unanchored one is listed.
  const grants = bv.decisions.filter(e => e.signed.decision.kind === 'GRANT') as DecisionEntry<GrantDecision>[]
  const granted = new Set(grants.filter(isAnchored).map(e => e.signed.decision.workflow_id))
  // P-S3-R1: under a tenant scope the book summary is that tenant's slice; nothing of another tenant is counted or named.
  const own = (t: string | undefined): boolean => scope.tenant_id === undefined || t === scope.tenant_id
  const unanchored_grants = grants.filter(e => !isAnchored(e) && own(tenantOfWorkflow(e.signed.decision.workflow_id))).map(e => ({ decision_id: e.decision_id, seq: e.seq, workflow_id: e.signed.decision.workflow_id, level: e.signed.decision.level, signer_id: e.signed.decision.signer_id }))
  const extractions = new Map<string, unknown>()
  for (const x of options.extractions ?? []) extractions.set(hashOf(x), x)
  const inPeriod = (at: string): boolean => (period.since === undefined || at >= period.since) && (period.until === undefined || at < period.until)
  const not_verdict: CompletenessReport['book']['not_verdict'] = []
  let out_of_scope = 0
  const scoped: ReadBook[] = []
  for (const v of bv.records) {
    if (!own(v.tenant_id)) continue // another tenant's record: neither counted nor named under a tenant scope
    const rs = v.verdict.ruleset
    if ((scope.tenant_id !== undefined && v.tenant_id !== scope.tenant_id) ||
        (scope.workflows !== undefined && !scope.workflows.includes(v.workflow_id)) ||
        (scope.rulesets !== undefined && !scope.rulesets.includes(String(rs?.id)))) { out_of_scope++; continue }
    if (v.not_verdict) { not_verdict.push({ verdict_id: v.verdict_id, tenant_id: v.tenant_id, why: v.not_verdict }); continue }
    scoped.push(readBookRecord(v, m, extractions))
  }
  const ownRecords = bv.records.filter(r => own(r.tenant_id))
  const ownSigners = scope.tenant_id === undefined ? undefined : bv.signersOf(scope.tenant_id)
  const usedExtractions = new Set(scoped.map(b => b.usedExtraction).filter((h): h is string => h !== undefined))

  // The population, read by the declared rules.
  const rows = population.rows.map(r => readPopulationRow(r, m, csv))
  const unreadable: UnreadableItem[] = []
  for (const r of rows) {
    if (r.problems.length === 0) continue
    if (m.on_malformed === 'refuse') {
      const p = r.problems[0]!
      throw new CompletenessRefused(`row ${r.ref.row} (line ${r.ref.line}), column ${JSON.stringify(p.column)}: ${p.why}. Declare the format that reads it, or on_malformed: "report" to list the row as UNREADABLE`, { row: r.ref.row, line: r.ref.line })
    }
    unreadable.push({ row: r.ref.row, line: r.ref.line, problems: r.problems })
  }

  // Group both sides by key.
  const groups = new Map<string, { pops: ReadRow[]; books: ReadBook[] }>()
  const group = (k: string): { pops: ReadRow[]; books: ReadBook[] } => {
    let g = groups.get(k)
    if (!g) { g = { pops: [], books: [] }; groups.set(k, g) }
    return g
  }
  const bypassed: BypassedItem[] = []
  for (const r of rows) {
    if (r.problems.length > 0) continue
    if (r.keyString === undefined) { bypassed.push({ population: r.ref, reason: 'NO_KEY', duplicate_key: false }); continue }
    group(r.keyString).pops.push(r)
  }
  const unkeyed: UnkeyedItem[] = []
  for (const b of scoped) {
    if (b.keyString === undefined) { if (inPeriod(b.ref.recorded_at)) unkeyed.push({ book: b.ref, missing: b.missingKey, why: b.keyWhy }); continue }
    group(b.keyString).books.push(b)
  }

  const matchedAll: MatchedItem[] = []
  const ambiguous: AmbiguousGroup[] = []
  const orphans: OrphanItem[] = []
  const popClass = new Map<number, PopulationClass>()
  const bookClass = new Map<ReadBook, BookClass>()
  const tolAbs = readConstant(m.amount_tolerance.abs, 'abs'), tolRel = readConstant(m.amount_tolerance.rel, 'rel')

  for (const g of groups.values()) {
    if (g.pops.length === 0) {
      for (const b of g.books) {
        bookClass.set(b, 'ORPHAN')
        if (inPeriod(b.ref.recorded_at)) orphans.push({ book: b.ref, held: holdOf(b, bv.decisions, granted, declared, reading) !== undefined, reviewed: b.view.review !== undefined })
      }
      continue
    }
    if (g.books.length === 0) {
      for (const r of g.pops) { bypassed.push({ population: r.ref, reason: 'NO_VERDICT', duplicate_key: g.pops.length > 1 }); popClass.set(r.ref.row, 'BYPASSED') }
      continue
    }
    if (g.pops.length > 1 || g.books.length > 1) {
      const shape: AmbiguousGroup['shape'] = g.pops.length > 1 && g.books.length > 1 ? 'MANY_TO_MANY' : g.books.length > 1 ? 'BOOK_DUPLICATES' : 'POPULATION_DUPLICATES'
      ambiguous.push({
        key: { ...g.pops[0]!.ref.key }, shape,
        population: g.pops.map(r => r.ref).sort((a, b) => a.row - b.row),
        book: g.books.map(b => b.ref).sort((a, b) => a.record_seq - b.record_seq),
      })
      for (const r of g.pops) popClass.set(r.ref.row, 'AMBIGUOUS')
      for (const b of g.books) bookClass.set(b, 'AMBIGUOUS')
      continue
    }
    const r = g.pops[0]!, b = g.books[0]!
    bookClass.set(b, 'MATCHED')
    const differences: FieldDifference[] = []
    const uncompared: Uncompared[] = []
    const missing = (f: CompareField, side: 'population' | 'book'): void => {
      uncompared.push({ field: f, why: side === 'book' && b.unreadable[f] ? `unreadable on the book: ${b.unreadable[f]}` : `missing ${side === 'book' ? 'on the book' : 'in the population'}` })
    }
    const currencyDiffers = m.compared.includes('currency') && r.ref.currency !== undefined && b.ref.currency !== undefined && r.ref.currency !== b.ref.currency
    for (const f of m.compared) {
      const pv = f === 'amount' ? r.ref.amount : r.ref[f]
      const bvv = f === 'amount' ? b.ref.amount : b.ref[f]
      if (pv === undefined) { missing(f, 'population'); continue }
      if (bvv === undefined) { missing(f, 'book'); continue }
      const src = b.ref.sources[f as BookField] ?? ''
      if (f === 'amount') {
        const diff = decSub(b.amount!, r.amount!)
        const big = decCmp(decAbs(b.amount!), decAbs(r.amount!)) >= 0 ? decAbs(b.amount!) : decAbs(r.amount!)
        const rel = decMul(tolRel, big)
        const allowed = decCmp(tolAbs, rel) >= 0 ? tolAbs : rel
        if (decCmp(decAbs(diff), allowed) > 0) differences.push({ field: f, population: pv, book: bvv, book_source: src, ...(currencyDiffers ? {} : { delta: decToString(diff) }) })
      } else if (f === 'invoice_date') {
        const d = daysBetween(pv, bvv)
        if (Math.abs(d) > m.date_tolerance_days) differences.push({ field: f, population: pv, book: bvv, book_source: src, delta: String(d) })
      } else if (pv !== bvv) {
        differences.push({ field: f, population: pv, book: bvv, book_source: src })
      }
    }
    const flags: PopulationClass[] = []
    let hold: HoldInfo | undefined
    const held = holdOf(b, bv.decisions, granted, declared, reading)
    if (held) {
      const rv = b.view.review
      const resolution: HoldInfo['resolution'] = !rv ? 'NONE'
        : r.ref.payment_date === undefined ? 'UNORDERED'
        : localDateOf(rv.first_decided_at, offsetMin) > r.ref.payment_date ? 'AFTER_PAYMENT' : 'ON_OR_BEFORE_PAYMENT'
      hold = {
        rung: held.level as 'gate' | 'autonomy', rung_from: held.from as 'grant' | 'declared',
        ...(held.grant ? { grant: { decision_id: held.grant.decision_id, seq: held.grant.seq, signer_id: held.grant.signed.decision.signer_id } } : {}),
        resolution,
        ...(rv ? { review: { ...rv } } : {}),
      }
      if (resolution === 'NONE' || resolution === 'AFTER_PAYMENT') flags.push('PAID_DESPITE_HOLD')
    }
    if (differences.length > 0) flags.push('MISMATCHED')
    let late: MatchedItem['late']
    if (r.ref.payment_date !== undefined) {
      const day = localDateOf(b.ref.first_recorded_at, offsetMin)
      if (day > r.ref.payment_date) { late = { first_recorded_day: day, payment_date: r.ref.payment_date }; flags.push('CHECKED_AFTER_PAYMENT') }
    }
    flags.sort((x, y) => MATCH_PRECEDENCE.indexOf(x) - MATCH_PRECEDENCE.indexOf(y))
    const cls = (flags[0] ?? 'MATCHED') as MatchedItem['class']
    popClass.set(r.ref.row, cls)
    matchedAll.push({ class: cls, flags, population: r.ref, book: b.ref, differences, uncompared, ...(hold ? { hold } : {}), ...(late ? { late } : {}) })
  }
  for (const u of unreadable) popClass.set(u.row, 'UNREADABLE')
  for (const x of bypassed) popClass.set(x.population.row, 'BYPASSED')

  // Deterministic order: population items by row; book items by chain position.
  matchedAll.sort((a, b) => a.population.row - b.population.row)
  bypassed.sort((a, b) => a.population.row - b.population.row)
  ambiguous.sort((a, b) => a.population[0]!.row - b.population[0]!.row)
  orphans.sort((a, b) => a.book.record_seq - b.book.record_seq)
  unkeyed.sort((a, b) => a.book.record_seq - b.book.record_seq)
  unreadable.sort((a, b) => a.row - b.row)
  not_verdict.sort((a, b) => a.tenant_id.localeCompare(b.tenant_id) || a.verdict_id.localeCompare(b.verdict_id))

  // Counts and totals.
  const byClass = Object.fromEntries(POPULATION_CLASSES.map(c => [c, 0])) as Record<PopulationClass, number>
  const amtByClass = Object.fromEntries(POPULATION_CLASSES.map(c => [c, {}])) as Record<PopulationClass, Record<string, Dec>>
  const popTotals: Record<string, Dec> = {}
  let rowsWithoutAmount = 0
  for (const r of rows) {
    const c = popClass.get(r.ref.row)!
    byClass[c]++
    if (r.amount === undefined) { rowsWithoutAmount++; continue }
    addTo(popTotals, r.ref.currency, r.amount)
    addTo(amtByClass[c], r.ref.currency, r.amount)
  }
  const bookByClass = Object.fromEntries(BOOK_CLASSES.map(c => [c, 0])) as Record<BookClass, number>
  const bookAmt = Object.fromEntries(BOOK_CLASSES.map(c => [c, {}])) as Record<BookClass, Record<string, Dec>>
  let inPeriodCount = 0, matchedOutsidePeriod = 0
  for (const b of scoped) {
    const c: BookClass = b.keyString === undefined ? 'UNKEYED' : bookClass.get(b)!
    if (!inPeriod(b.ref.recorded_at)) { if (c === 'MATCHED') matchedOutsidePeriod++; continue }
    inPeriodCount++
    bookByClass[c]++
    addTo(bookAmt[c], b.ref.currency, b.amount)
  }

  const n = rows.length
  const on_book = byClass.MATCHED + byClass.MISMATCHED + byClass.PAID_DESPITE_HOLD + byClass.CHECKED_AFTER_PAYMENT
  const not_on_book = n - on_book
  const iv = rateInterval(not_on_book, n, interval.confidence, interval.method, interval.sidedness)
  const dated = matchedAll.filter(x => x.population.payment_date !== undefined)
  const anyPaymentDate = m.population.columns.payment_date !== undefined

  const exceptions: CompletenessReport['exceptions'] = {
    paid_despite_hold: matchedAll.filter(x => x.class === 'PAID_DESPITE_HOLD'),
    mismatched: matchedAll.filter(x => x.class === 'MISMATCHED'),
    checked_after_payment: matchedAll.filter(x => x.class === 'CHECKED_AFTER_PAYMENT'),
    ambiguous, bypassed, unreadable, orphans, unkeyed,
  }
  const resolvedItems = matchedAll.filter(x => x.hold && (x.hold.resolution === 'ON_OR_BEFORE_PAYMENT' || x.hold.resolution === 'UNORDERED'))
  const cleanPairs = matchedAll.filter(x => x.class === 'MATCHED')
  const rungWorkflows = [...new Set(scoped.map(b => b.view.workflow_id))].sort()
  const extractionHashes = [...extractions.keys()].sort()

  const body: Omit<CompletenessReport, 'report_hash' | 'generated_at'> = {
    report_version: 'completeness-v0',
    engine_version: ENGINE_VERSION,
    binds: {
      book: { head: bv.head, length: bv.length },
      population: {
        format: population.format,
        ...(population.sha256 !== undefined ? { sha256: population.sha256 } : {}),
        ...(population.bytes !== undefined ? { bytes: population.bytes } : {}),
        rows: n, rows_hash: populationRowsHash(population),
      },
      mapping_hash: hashOf(m),
      options_hash: hashOf({ scope, period, rungs: declared, interval, anchors: options.anchors ?? null, ...(options.policy ? { policy: hashOf(options.policy) } : {}) }),
      extractions: { supplied: options.extractions?.length ?? 0, distinct: extractions.size, used: usedExtractions.size, set_hash: hashOf(extractionHashes) },
      matched_hash: hashOf(cleanPairs.map(x => [x.population.row, x.book.tenant_id, x.book.verdict_id])),
    },
    mapping: m,
    scope: { ...scope },
    period: { ...period },
    population: { rows: n, by_class: byClass },
    book: {
      verified: true,
      unanchored_signers: scope.tenant_id === undefined ? bv.unanchored : bv.unanchored.filter(s => ownSigners!.has(s)),
      unanchored_grants,
      tenants: [...new Set(ownRecords.map(r => r.tenant_id))].sort(),
      records: ownRecords.length,
      out_of_scope,
      not_verdict,
      in_scope: scoped.length,
      in_period: inPeriodCount,
      by_class: bookByClass,
      matched_outside_period: matchedOutsidePeriod,
      rungs: rungWorkflows.map(w => ({ workflow_id: w, from: granted.has(w) ? 'grant' as const : declared[w] !== undefined ? 'declared' as const : 'none' as const })),
    },
    coverage: {
      population_rows: n, on_book, not_on_book, rate: n === 0 ? null : on_book / n,
      bound: {
        ...interval, words: describeBound(interval.confidence, interval.method, interval.sidedness),
        not_on_book_upper: iv.upper, coverage_lower: Math.max(0, Math.floor((1 - iv.upper) * 1e12) / 1e12),
      },
      ...(anyPaymentDate ? { before_payment: { rows_with_date: dated.length, checked_by_payment_date: dated.filter(x => !x.late).length, checked_after: dated.filter(x => x.late).length } } : {}),
      note: COVERAGE_NOTE,
    },
    amounts: {
      population: totalsOut(popTotals),
      by_class: Object.fromEntries(POPULATION_CLASSES.map(c => [c, totalsOut(amtByClass[c])])) as Record<PopulationClass, Record<string, string>>,
      rows_without_amount: rowsWithoutAmount,
      book_in_period: Object.fromEntries(BOOK_CLASSES.map(c => [c, totalsOut(bookAmt[c])])) as Record<BookClass, Record<string, string>>,
    },
    exceptions,
    resolved_holds: {
      count: resolvedItems.length,
      upheld: resolvedItems.filter(x => x.hold!.review!.decision === 'UPHELD').length,
      overturned: resolvedItems.filter(x => x.hold!.review!.decision === 'OVERTURNED').length,
      items: resolvedItems,
    },
    matched_with_uncompared: matchedAll.filter(x => x.uncompared.length > 0).length,
    ...(options.include_matched ? { matched: cleanPairs } : {}),
    clean: byClass.MATCHED === n,
    boundary: [...COMPLETENESS_BOUNDARY],
  }
  const report_hash = hashOf(body)
  return { ...body, report_hash, ...(options.now ? { generated_at: options.now().toISOString() } : {}) }
}

/** Re-derive a report's hash: true when the report is exactly what reconcileCompleteness emitted. */
export function completenessReportIntact(report: CompletenessReport): boolean {
  const { report_hash, generated_at, ...body } = report
  void generated_at
  return hashOf(body) === report_hash
}
