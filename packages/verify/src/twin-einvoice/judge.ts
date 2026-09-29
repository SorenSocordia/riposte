/**
 * E-invoice structured-twin mode: judge an agent's extracted claims against the invoice's own binding XML.
 *
 * For Peppol BIS 3.0, ZATCA and KSeF FA(3) the XML IS the legal invoice, so there is no linkbase problem (CREDENCE-1
 * §6): each field binds one declared element (map.ts), and the claim is compared with that element's content.
 *
 * Outcomes (the reason is always explicit):
 *   PASS     MATCH     the claim equals the binding element (amounts within `tolerance`; identifiers after removing
 *                      whitespace and case; text after Unicode/whitespace/case normalisation)
 *   FAIL     MISMATCH  with a diagnosis, first match wins:
 *                        amounts   SIGN · SCALE (×10^±1/2/3/6) · OTHER_FIELD (it is another mapped element's value) ·
 *                                  TRANSPOSITION (two adjacent digits swapped) · CURRENCY (claim currency ≠ element's)
 *                        dates     DAY_MONTH_SWAP · OTHER_FIELD
 *                        ids/text  SWAPPED_PARTY (it is the counterparty's) · OTHER_FIELD · TRANSPOSITION
 *                      then UNLOCATED
 *   ABSTAIN  NO_TWIN (not well-formed XML) · UNSUPPORTED_PROFILE · NOT_MAPPED · ELEMENT_ABSENT · AMBIGUOUS_ELEMENT ·
 *            BINDING_UNPARSEABLE · VALUE_UNPARSEABLE · TEXT_VARIANT (a name that differs beyond normalisation and is not
 *            the counterparty's: names legitimately vary, so it is not judged). An abstention is never a flag.
 *
 * Separately, the XML's own footing is checked (consistency.ts) and reported under the spec rule id (BR-CO-*); an
 * internally inconsistent invoice FAILs the verdict even when every claim matches it.
 *
 * The verdict's outcome (twin 0.3.0, PRODUCT-FIX-1 2026-09-29; docs/EINVOICE-TWIN-CORRECTION-2026-09-29.md):
 *   FAIL               any claim FAILs: an extracted value, or the document's own footing
 *   PASS               nothing FAILs AND at least one EXTRACTED value was verified (a TWIN_XML claim PASSed)
 *   INSUFFICIENT_DATA  otherwise, including a footing that passes while no extracted value was verified: the footing
 *                      proves the document agrees with itself, never that the caller's values are right
 * The verdict names that rule: aggregation ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES (the footing claims are CONSISTENCY).
 * Before 0.3.0 a passing footing alone made the verdict PASS (a published miss). The two questions are also answered
 * apart, in `outcomes.extraction` and `outcomes.footing`.
 *
 * The result is a standard verify Verdict (ABSTAIN = INSUFFICIENT_DATA, reason leading insufficiency.detail) plus the
 * structured judgments. verdict_id = the standard derivation over input_hash (xml sha256, profile, claims, tolerances,
 * map id@version, footing on/off, the footing ruleset's id@version), the map id@version, and the engine version.
 * Deterministic: no network, no randomness, no clock except `issued_at`.
 */
import { hashOf, sha256 } from '../verdict/canonical.js'
import type { ClaimVerdict, Coverage, Evidence, InsufficiencyReason, Outcome, Verdict } from '../verdict/schema.js'
import { deriveVerdictId } from '../protocol/verdict-id.js'
import { aggregateOutcome } from '../verdict/aggregation.js'
import { ENGINE_VERSION, SCHEMA_VERSION } from '../version.js'
import { bindField, detectProfile, mapFor, parseDecimal, parseIsoDate, parseTime, type BindResult, type EinvoiceBinding, type ScopeRef } from './bind.js'
import { checkEinvoiceConsistency, type EinvoiceConsistency } from './consistency.js'
import { lineElements, type EinvoiceFieldMap, type EinvoiceMap, type EinvoiceProfile } from './map.js'
import { footingRulesetFor } from './rulesets.js'
import { parseXml, XmlParseError, type XmlElement } from './xml.js'

export interface EinvoiceClaim {
  id: string
  /** a mapped field: `payable_amount`, `seller_vat_id`, `lines[0].net_amount`, `vat_breakdown[1].tax_amount`, `P_15` … */
  field: string
  /** numbers for amounts / quantities / rates; ISO `YYYY-MM-DD` strings for dates; strings for ids, codes, names */
  value: number | string
  /** optional: the currency the agent attached to an amount (checked against the element's @currencyID) */
  currency?: string
}

export interface EinvoiceTwinOptions {
  /** force a profile instead of detecting it from the document's own markers */
  profile?: EinvoiceProfile
  /** absolute tolerance on amounts, default 0.005 (half a cent: e-invoice amounts carry at most 2 decimals) */
  tolerance?: number
  /** absolute tolerance on quantities and rates, default 0.0005 */
  quantityTolerance?: number
  /** run the XML's own footing (consistency.ts), default true */
  consistency?: boolean
  now?: () => Date
  producer?: string
}

export type EinvoiceOutcome = 'PASS' | 'FAIL' | 'ABSTAIN'
export type EinvoiceAbstainReason = 'NO_TWIN' | 'UNSUPPORTED_PROFILE' | 'NOT_MAPPED' | 'ELEMENT_ABSENT' | 'AMBIGUOUS_ELEMENT' | 'BINDING_UNPARSEABLE' | 'VALUE_UNPARSEABLE' | 'TEXT_VARIANT'
export type EinvoiceReason = 'MATCH' | 'MISMATCH' | EinvoiceAbstainReason
export type EinvoiceDiagnosis = 'SIGN' | 'SCALE' | 'OTHER_FIELD' | 'TRANSPOSITION' | 'CURRENCY' | 'DAY_MONTH_SWAP' | 'SWAPPED_PARTY' | 'UNLOCATED'

export interface EinvoiceMatchRef { field: string; term: string; xpath: string; value: number | string }

export interface EinvoiceJudgment {
  claim_id: string
  field: string
  value: number | string
  outcome: EinvoiceOutcome
  reason: EinvoiceReason
  detail: string
  /** the binding element (present on PASS / FAIL, and on abstentions where one was found) */
  binding?: EinvoiceBinding
  diagnosis?: EinvoiceDiagnosis
  /** for OTHER_FIELD / SWAPPED_PARTY: the elements the value does equal */
  matches?: EinvoiceMatchRef[]
  /** normalisations applied to reach a PASS (e.g. identifier whitespace removed) */
  normalizations?: string[]
}

export interface EinvoiceTwinOutcomes {
  /** the extracted values alone: FAIL if any FAILs, else PASS if any PASSed, else INSUFFICIENT_DATA (none verified) */
  extraction: Outcome
  /** the document's own footing alone, by the same rule; null when it did not run (consistency off, or no twin) */
  footing: Outcome | null
}

export interface EinvoiceTwinResult {
  verdict: Verdict
  judgments: EinvoiceJudgment[]
  consistency: EinvoiceConsistency[]
  /** the two questions answered apart (twin 0.3.0). `verdict.outcome` is PASS only when `extraction` is PASS and nothing FAILs. */
  outcomes: EinvoiceTwinOutcomes
  twin: { sha256: string; profile: EinvoiceProfile | null; detail: string; lines: number }
}

/** The label when no twin could be read (not XML, or no supported profile): the twin's own version, bumped with its rule. */
const UNKNOWN_RULESET = { id: 'twin-einvoice', version: '0.3.0', domain: 'e-invoice' }
/** The rule the outcome follows (verdict/aggregation.ts): the footing's CONSISTENCY claims can FAIL a verdict, never PASS it alone. */
const AGGREGATION = 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES' as const

const INSUFFICIENCY: Record<EinvoiceAbstainReason, InsufficiencyReason> = {
  NO_TWIN: 'REFERENCE_NOT_PROVIDED',
  UNSUPPORTED_PROFILE: 'OUT_OF_RULESET_SCOPE',
  NOT_MAPPED: 'OUT_OF_RULESET_SCOPE',
  ELEMENT_ABSENT: 'REFERENCE_NOT_PROVIDED',
  AMBIGUOUS_ELEMENT: 'AMBIGUOUS_REFERENCE',
  BINDING_UNPARSEABLE: 'UNPARSEABLE',
  VALUE_UNPARSEABLE: 'UNPARSEABLE',
  TEXT_VARIANT: 'AMBIGUOUS_REFERENCE',
}

const SCOPED = /^(lines|vat_breakdown)\[(\d+)\]\.([A-Za-z0-9_]+)$/

/** Resolve a claim field to its map entry and scope. null = NOT_MAPPED. */
export function resolveField(map: EinvoiceMap, field: string): { fm: EinvoiceFieldMap; ref: ScopeRef } | null {
  const m = SCOPED.exec(field)
  if (m) {
    const scope = m[1] === 'lines' ? 'line' : 'vat_breakdown'
    const fm = map.fields.find((f) => f.scope === scope && f.field === m[3])
    return fm ? { fm, ref: { scope, index: Number(m[2]) } } : null
  }
  const fm = map.fields.find((f) => f.scope === 'document' && f.field === field)
  return fm ? { fm, ref: { scope: 'document', index: 0 } } : null
}

/**
 * The inputs a verdict's input_hash commits to (pass them to verifyReplay to check the binding). Since map 0.2.0 this
 * includes the footing ruleset's id@version, so a ruleset change (e.g. KSeF 0.1.0 → 0.2.0) changes the verdict_id.
 */
export function einvoiceVerdictInput(xmlSha256: string, profile: EinvoiceProfile | null, claims: readonly EinvoiceClaim[], opts: EinvoiceTwinOptions = {}): unknown {
  const map = profile ? mapFor(profile) : null
  const footing = profile && (opts.consistency ?? true) ? footingRulesetFor(profile) : null
  return {
    xml_sha256: xmlSha256,
    profile,
    map: map ? `${map.id}@${map.version}` : `${UNKNOWN_RULESET.id}@${UNKNOWN_RULESET.version}`,
    tolerance: opts.tolerance ?? 0.005,
    quantity_tolerance: opts.quantityTolerance ?? 0.0005,
    consistency: opts.consistency ?? true,
    footing: footing ? `${footing.id}@${footing.version}` : null,
    claims: claims.map((c) => ({ id: c.id, field: c.field, value: typeof c.value === 'number' && !Number.isFinite(c.value) ? null : c.value, ...(c.currency !== undefined ? { currency: c.currency } : {}) })),
  }
}

// ---- normalisation of claim values ---------------------------------------------------------------------------

const idNorm = (s: string): string => s.replace(/\s+/g, '').toUpperCase()
const textNorm = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

function claimNumber(v: number | string): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return parseDecimal(v)
}
function claimString(v: number | string): string | null {
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? String(v) : null
  const t = v.trim()
  return t.length ? t : null
}

/** Every string of `s` made by swapping two adjacent, different digits. */
function adjacentDigitSwaps(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i]!, b = s[i + 1]!
    if (a !== b && /\d/.test(a) && /\d/.test(b)) out.add(s.slice(0, i) + b + a + s.slice(i + 2))
  }
  return out
}
/** Fixed two-decimal rendering for digit comparisons of amounts. */
const fixed2 = (x: number): string => Math.abs(x).toFixed(2)

// ---- the judge -------------------------------------------------------------------------------------------------

interface Ctx { map: EinvoiceMap; root: XmlElement; cache: Map<string, BindResult> }

function bindCached(ctx: Ctx, fm: EinvoiceFieldMap, ref: ScopeRef): BindResult {
  const k = `${fm.scope}:${ref.index}:${fm.field}`
  let b = ctx.cache.get(k)
  if (!b) { b = bindField(ctx.map, ctx.root, fm, ref); ctx.cache.set(k, b) }
  return b
}

/** Bound elements of the given kinds that could be "the other field" a wrong value came from. */
function otherBindings(ctx: Ctx, fm: EinvoiceFieldMap, ref: ScopeRef, kinds: readonly string[]): EinvoiceBinding[] {
  const seen = new Set<number>()
  const out: EinvoiceBinding[] = []
  const add = (f: EinvoiceFieldMap, r: ScopeRef): void => {
    if (!kinds.includes(f.kind)) return
    const b = bindCached(ctx, f, r)
    if (!b.ok || seen.has(b.binding.span.start)) return
    seen.add(b.binding.span.start)
    out.push(b.binding)
  }
  for (const f of ctx.map.fields) if (f.scope === 'document') add(f, { scope: 'document', index: 0 })
  if (ref.scope !== 'document') for (const f of ctx.map.fields) if (f.scope === ref.scope) add(f, ref)
  const self = bindCached(ctx, fm, ref)
  return out.filter((b) => !(self.ok && b.span.start === self.binding.span.start))
}
const matchRef = (b: EinvoiceBinding): EinvoiceMatchRef => ({ field: b.field, term: b.term, xpath: b.xpath, value: b.value! })

interface Compared { outcome: 'PASS' | 'FAIL' | 'ABSTAIN'; reason: EinvoiceReason; detail: string; diagnosis?: EinvoiceDiagnosis; matches?: EinvoiceMatchRef[]; normalizations?: string[] }

function compare(ctx: Ctx, fm: EinvoiceFieldMap, ref: ScopeRef, b: EinvoiceBinding, c: EinvoiceClaim, tol: number, qtol: number): Compared {
  const where = `${b.term} ${b.xpath} = ${JSON.stringify(b.raw.trim())}`
  const fail = (diagnosis: EinvoiceDiagnosis, why: string, matches?: EinvoiceMatchRef[]): Compared =>
    ({ outcome: 'FAIL', reason: 'MISMATCH', diagnosis, detail: `${why}; the binding element is ${where}`, ...(matches?.length ? { matches } : {}) })
  const unparseable = (what: string): Compared => ({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE', detail: `the asserted value ${JSON.stringify(c.value)} is not ${what}; nothing is guessed` })

  if (fm.kind === 'amount' || fm.kind === 'quantity' || fm.kind === 'rate') {
    const v = claimNumber(c.value)
    if (v === null) return unparseable('a plain number (numbers, or strings like "1234.56"; no thousands separators or symbols)')
    const bv = b.value as number
    const t = fm.kind === 'amount' ? tol : qtol
    if (Math.abs(v - bv) <= t + 1e-9) {
      if (fm.kind === 'amount' && c.currency !== undefined) {
        const elCur = b.currency ?? documentCurrency(ctx)
        if (elCur && c.currency.trim().toUpperCase() !== elCur.toUpperCase()) return fail('CURRENCY', `the amount matches but the asserted currency ${c.currency} is not the element's ${elCur}`)
      }
      return { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where}${b.currency ? ` ${b.currency}` : ''}` }
    }
    // a rate given as a fraction of the element's percentage (0.19 for 19) is a representation, not an error: not guessed
    if (fm.kind === 'rate' && bv !== 0 && Math.abs(v * 100 - bv) <= t * 100 + 1e-9) {
      return { outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE', detail: `the asserted rate ${v} reads as a fraction of the element's percentage ${bv}; the representation is not guessed` }
    }
    if (bv !== 0 && Math.abs(v + bv) <= t + 1e-9) return fail('SIGN', `the sign is inverted (${v} vs ${bv})`)
    if (bv !== 0) for (const k of [1, 2, 3, 6]) for (const r of [10 ** k, 10 ** -k]) if (Math.abs(v - bv * r) <= Math.max(t, Math.abs(bv * r) * 1e-9)) return fail('SCALE', `off by a factor of ${r >= 1 ? r : `1/${1 / r}`} (${v} vs ${bv}): a currency-unit or scale error`)
    const others = otherBindings(ctx, fm, ref, ['amount', 'quantity', 'rate']).filter((o) => Math.abs((o.value as number) - v) <= t + 1e-9)
    if (others.length) return fail('OTHER_FIELD', `it is ${others.map((o) => `${o.term} (${o.field})`).join(' / ')}, another element's value`, others.slice(0, 3).map(matchRef))
    if (adjacentDigitSwaps(fixed2(bv)).has(fixed2(v)) && Math.sign(v) === Math.sign(bv)) return fail('TRANSPOSITION', `two adjacent digits are transposed (${v} vs ${bv})`)
    return fail('UNLOCATED', `${v} differs from the element and equals no other mapped element`)
  }

  if (fm.kind === 'date') {
    if (typeof c.value !== 'string' || parseIsoDate(c.value) === null) return unparseable('an ISO calendar date YYYY-MM-DD (other layouts are ambiguous: day/month order is never guessed)')
    const v = c.value.trim()
    if (v === b.value) return { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where}` }
    const [y, mo, d] = v.split('-')
    if (`${y}-${d}-${mo}` === b.value) return fail('DAY_MONTH_SWAP', `day and month are swapped (${v} vs ${b.value})`)
    const others = otherBindings(ctx, fm, ref, ['date']).filter((o) => o.value === v)
    if (others.length) return fail('OTHER_FIELD', `it is ${others.map((o) => `${o.term} (${o.field})`).join(' / ')}, another date`, others.slice(0, 3).map(matchRef))
    return fail('UNLOCATED', `${v} differs from the element and equals no other mapped date`)
  }

  if (fm.kind === 'time') {
    if (typeof c.value !== 'string' || parseTime(c.value) === null) return unparseable('a time HH:mm:ss')
    return c.value.trim() === b.value ? { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where}` } : fail('UNLOCATED', `${c.value.trim()} differs from the element`)
  }

  const s = claimString(c.value)
  if (s === null) return unparseable('a non-empty string')
  const bs = b.value as string
  const counterpart = (): EinvoiceBinding | null => {
    if (!fm.counterpart) return null
    const cf = ctx.map.fields.find((f) => f.scope === fm.scope && f.field === fm.counterpart)
    if (!cf) return null
    const cb = bindCached(ctx, cf, ref)
    return cb.ok ? cb.binding : null
  }

  if (fm.kind === 'identifier' || fm.kind === 'code') {
    if (s === bs.trim()) return { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where}` }
    if (idNorm(s) === idNorm(bs)) return { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where} after removing whitespace and case`, normalizations: ['whitespace_removed', 'case_folded'] }
    const cp = counterpart()
    if (cp && idNorm(cp.value as string) === idNorm(s)) return fail('SWAPPED_PARTY', `it is the counterparty's ${cp.term} (${cp.field})`, [matchRef(cp)])
    const others = otherBindings(ctx, fm, ref, ['identifier', 'code']).filter((o) => idNorm(o.value as string) === idNorm(s))
    if (others.length) return fail('OTHER_FIELD', `it is ${others.map((o) => `${o.term} (${o.field})`).join(' / ')}, another element's value`, others.slice(0, 3).map(matchRef))
    if (adjacentDigitSwaps(idNorm(bs)).has(idNorm(s))) return fail('TRANSPOSITION', `two adjacent digits are transposed (${s} vs ${bs.trim()})`)
    return fail('UNLOCATED', `${JSON.stringify(s)} differs from the element`)
  }

  // text: names vary legitimately (legal vs trading name, abbreviations, casing); only a counterparty swap is judged
  if (textNorm(s) === textNorm(bs)) {
    return { outcome: 'PASS', reason: 'MATCH', detail: `equals ${where}${s === bs.trim() ? '' : ' after Unicode, whitespace and case normalisation'}`, ...(s === bs.trim() ? {} : { normalizations: ['nfkc', 'whitespace_collapsed', 'case_folded'] }) }
  }
  const cp = counterpart()
  if (cp && textNorm(cp.value as string) === textNorm(s)) return fail('SWAPPED_PARTY', `it is the counterparty's ${cp.term} (${cp.field})`, [matchRef(cp)])
  return { outcome: 'ABSTAIN', reason: 'TEXT_VARIANT', detail: `${JSON.stringify(s)} differs from ${where} beyond normalisation and is not the counterparty's; names vary legitimately, so text is not judged further` }
}

function documentCurrency(ctx: Ctx): string | undefined {
  const fm = ctx.map.fields.find((f) => f.scope === 'document' && f.field === 'currency')
  if (!fm) return undefined
  const b = bindCached(ctx, fm, { scope: 'document', index: 0 })
  return b.ok ? (b.binding.value as string) : undefined
}

function bindingEvidence(xmlSha: string, b: EinvoiceBinding, normalizations?: string[]): Evidence[] {
  return [
    { locator: { kind: 'span', source_hash: xmlSha, start: b.span.start, end: b.span.end }, value: b.value, original: b.raw,
      normalizations: [`kind=${b.kind}`, ...(b.currency ? [`currencyID=${b.currency}`] : []), ...(normalizations ?? [])], confidence: 100, role: 'REFERENCE' },
    { locator: { kind: 'field', source: 'evidence', path: b.xpath }, value: `${b.term} ${b.name}`, confidence: 100, role: 'CONTEXT' },
  ]
}

/** Judge claims against an e-invoice's binding XML. `xml` is the document as received (its sha256 anchors every span). */
export function verifyEinvoiceTwin(xml: string, claims: readonly EinvoiceClaim[], opts: EinvoiceTwinOptions = {}): EinvoiceTwinResult {
  const xmlSha = sha256(xml)
  const tol = opts.tolerance ?? 0.005
  const qtol = opts.quantityTolerance ?? 0.0005
  let root: XmlElement | null = null
  let parseError: string | null = null
  try { root = parseXml(xml) } catch (e) { if (e instanceof XmlParseError) parseError = e.message; else throw e }
  const det = root ? (opts.profile ? { profile: opts.profile, detail: `profile forced by the caller: ${opts.profile}` } : detectProfile(root)) : { profile: null, detail: `not well-formed XML: ${parseError}` }
  const map = det.profile ? mapFor(det.profile) : null
  const ctx: Ctx | null = root && map ? { map, root, cache: new Map() } : null

  const judgments: EinvoiceJudgment[] = [], out: ClaimVerdict[] = []
  for (const c of claims) {
    const resolved = map ? resolveField(map, c.field) : null
    const term = resolved ? resolved.fm.term : 'UNMAPPED'
    const base = { claim_id: `${c.id}.twin`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: c.field,
      asserted: typeof c.value === 'number' && !Number.isFinite(c.value) ? null : c.value, rule_id: `TWIN_XML:${term}`,
      rule_name: resolved ? `Extracted value equals the invoice's binding element ${resolved.fm.term} (${resolved.fm.name})` : "Extracted value equals the invoice's binding element", locked: false }
    const abstain = (reason: EinvoiceAbstainReason, detail: string, binding?: EinvoiceBinding): void => {
      judgments.push({ claim_id: c.id, field: c.field, value: c.value, outcome: 'ABSTAIN', reason, detail, ...(binding ? { binding } : {}) })
      out.push({ ...base, outcome: 'INSUFFICIENT_DATA', evidence: [], insufficiency: { reason: INSUFFICIENCY[reason], detail: `${reason}: ${detail}` }, explanation: `${c.field}: ${detail}; abstaining.` })
    }
    if (!root) { abstain('NO_TWIN', `the document is ${det.detail}`); continue }
    if (!map || !ctx) { abstain('UNSUPPORTED_PROFILE', `the document is ${det.detail}`); continue }
    if (!resolved) { abstain('NOT_MAPPED', `${map.id}@${map.version} does not map "${c.field}" (no verified primary-source mapping for this profile)`); continue }
    const b = bindCached(ctx, resolved.fm, resolved.ref)
    if (!b.ok) { abstain(b.reason, b.detail, b.binding); continue }
    const r = compare(ctx, resolved.fm, resolved.ref, b.binding, c, tol, qtol)
    if (r.outcome === 'ABSTAIN') { abstain(r.reason as EinvoiceAbstainReason, r.detail, b.binding); continue }
    judgments.push({ claim_id: c.id, field: c.field, value: c.value, outcome: r.outcome, reason: r.reason, detail: r.detail, binding: b.binding,
      ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}), ...(r.matches ? { matches: r.matches } : {}), ...(r.normalizations ? { normalizations: r.normalizations } : {}) })
    const numeric = typeof b.binding.value === 'number' && claimNumber(c.value) !== null
    const computation = { formula: `claim = ${b.binding.term} (${b.binding.declared_xpath})`, operands: { element: b.binding.value, raw: b.binding.raw }, result: b.binding.value,
      ...(numeric ? { tolerance: { abs: resolved.fm.kind === 'amount' ? tol : qtol } } : {}) }
    const ev = [...bindingEvidence(xmlSha, b.binding, r.normalizations), ...(r.matches ?? []).map((m): Evidence => ({ locator: { kind: 'field', source: 'evidence', path: m.xpath }, value: m.value, confidence: 100, role: 'CONTEXT' }))]
    out.push({ ...base, outcome: r.outcome, locked: r.outcome === 'PASS', evidence: ev, computation,
      ...(r.outcome === 'FAIL' && numeric ? { variance: Math.round(((claimNumber(c.value) as number) - (b.binding.value as number)) * 1e6) / 1e6 } : {}),
      explanation: `${c.field} = ${JSON.stringify(c.value)}: ${r.detail}.${r.diagnosis ? ` [${r.diagnosis}]` : ''}` })
  }

  const consistency = ctx && (opts.consistency ?? true) ? checkEinvoiceConsistency(ctx.map, ctx.root, xmlSha) : []
  for (const k of consistency) out.push(k.claim)

  const coverage: Coverage = { claims_total: out.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 }
  for (const c of out) { if (c.outcome === 'PASS') coverage.claims_pass++; else if (c.outcome === 'FAIL') coverage.claims_fail++; else coverage.claims_insufficient++ }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail
  // twin 0.3.0: a passing footing never stands in for an extracted value nobody verified (see the header)
  const outcomes: EinvoiceTwinOutcomes = {
    extraction: partOutcome(judgments.map((j) => j.outcome)),
    footing: ctx && (opts.consistency ?? true) ? partOutcome(consistency.map((k) => k.outcome)) : null,
  }
  const outcome: Outcome = aggregateOutcome(AGGREGATION, out)
  const input = einvoiceVerdictInput(xmlSha, det.profile, claims, opts) as { claims: unknown }
  const input_hash = hashOf(input)
  const ruleset = map ? { id: map.id, version: map.version, domain: map.domain } : UNKNOWN_RULESET
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id: deriveVerdictId(input_hash, ruleset, ENGINE_VERSION),
    issued_at: (opts.now ?? (() => new Date()))().toISOString(), engine_version: ENGINE_VERSION, ruleset, input_hash, replayable: true,
    document: { extraction_hash: hashOf(input.claims), ...(opts.producer !== undefined ? { producer: opts.producer } : {}), line_items: root && map ? lineElements(map, root).length : 0 },
    references: { contract: false, evidence: 1, history: 0, source: true },
    outcome, aggregation: AGGREGATION, claims: out, coverage,
  }
  return { verdict, judgments, consistency, outcomes, twin: { sha256: xmlSha, profile: det.profile, detail: det.detail, lines: verdict.document.line_items } }
}

/** One part's outcome under ANY_FAIL_FAILS: FAIL if any FAILs, else PASS if any PASSed, else INSUFFICIENT_DATA. */
function partOutcome(outcomes: readonly EinvoiceOutcome[]): Outcome {
  return outcomes.includes('FAIL') ? 'FAIL' : outcomes.includes('PASS') ? 'PASS' : 'INSUFFICIENT_DATA'
}
