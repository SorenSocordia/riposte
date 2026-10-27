/**
 * The declarative evaluator: run a JSON-defined ruleset over an extraction and emit the SAME Verdict proof object as the
 * built-in rulesets. Enum-free; reuses the normalizer (universal digit folding included), the tolerance policy, and the
 * canonical hash. Honesty rules hold: a missing field abstains (FIELD_MISSING); an unparseable one abstains (UNPARSEABLE);
 * within-tolerance is rounding, not error; nothing is ever guessed.
 *
 * Added 2026-09-24 (additive; a ruleset that uses none of them produces byte-identical verdicts, pinned by
 * test/declarative-golden.test.ts):
 *  - OPTIONAL TERMS `ROLE?`: counts as 0 when absent. A check decides when its REQUIRED operands are present; a required
 *    operand absent → FIELD_MISSING as before; an optional one present but unparseable → UNPARSEABLE (never read as 0);
 *    a form whose operands are ALL optional and none is reported abstains (nothing was reported to check).
 *  - CHECK ALTERNATIVES `alternatives: [{left, right}]`: ordered fallback forms; the first whose required operands are
 *    all present is evaluated (chosen by presence, never by outcome).
 *  - ABSTAIN GUARDS `abstain_unless_all_present`, `abstain_if_present`, `abstain_if`: evaluated after the form is chosen
 *    (so a check that was already going to abstain for a missing field keeps that reason), before the comparison.
 *  - ROUNDING-AWARE TOLERANCE `tolerance.rounding: 'infer'` (or per check `rounding`): per check and document, the
 *    reporting unit U = the largest of {1, 1 000, 100 000, 1 000 000} dividing every operand, and
 *    tolerance = max(tol floor, rel × largest |operand|, U × number of operands). Operands = the reported amount-kind
 *    values the chosen form uses (see RoundingMode in types.ts). Such claims skip the separate relative-band pass.
 *
 * Added 2026-09-28 (additive, pinned by the same golden):
 *  - DECLARED ABSTENTION `abstain: "<why>"`: the check never decides; every document abstains (OUT_OF_RULESET_SCOPE)
 *    with `declared abstention: <why>`. This is for an identity the ruleset cannot source, so it is never guessed at.
 *  - GUARD REASON `guard_reason: "<why>"`: appended to the detail of whichever abstain guard fires.
 *  - FIELD KIND 'price': a unit price at full precision (see normPrice); 'amount' rounds to the cent.
 *  - GUARD `abstain_if_present_without: [{ present, without }]` (E-INVOICE-2): abstain when an item list is reported
 *    without the stated total the identity reads in its place (the engine never sums a nested list).
 *
 * Added 2026-10-03 (additive: a ruleset without the flag keeps its bytes):
 *  - ABSENT vs UNREADABLE `distinguish_unreadable: true` (types.ts, unreadable.ts): null, "", the marker "UNREADABLE" and a
 *    money/quantity string that is not strictly a number are unreadable, never a default; with source text, a labelled field
 *    that was not reported while its label heads a source line is unreadable too. Every unreadable operand of a check is
 *    named, and its remedy is missing-operand with the field, its term, the value as reported and the printed line.
 *
 * Engine 0.1.0 (2026-10-03): the two readings put behind the flag earlier that day are the DEFAULT (declarativeReading below).
 *  - Absent vs unreadable is on unless the ruleset says `"distinguish_unreadable": false`.
 *  - Strict number reading is on unless the ruleset says `"strict_numbers": false`: a money, price or quantity string that is
 *    not strictly a number is unparseable, never coerced, whether or not absent-vs-unreadable is on.
 *  Under engine 0.0.1 (`options.engine: '0.0.1'`, which replay passes for a verdict that names it) both follow
 *  `distinguish_unreadable === true` exactly as before, and `strict_numbers` is not read, so every 0.0.1 verdict keeps its bytes.
 *
 * Engine 0.2.0 (2026-10-03, the red team's verify-side findings). Read only when the engine is 0.2.0, so every verdict of 0.0.1
 * and 0.1.0 keeps its bytes:
 *  - HELD-SUSPECT: a claim that cannot run because a value was reported as a string that does not read is re-evaluated under
 *    every reading of that string one character away; if one FAILs the check, the claim is held as suspect (ClaimVerdict.suspect)
 *    and the gate books it as a FAIL. `"held_suspect": false` turns it off.
 *  - numbers are read whole by unreadable.ts readNumberTextV020: an ambiguous grouping is unreadable unless the ruleset declares
 *    `locale`; identifiers are compared after NFKC with format characters and every kind of space removed; a field reported
 *    under a near-miss key (spaces or invisible characters) is unreadable, never absent;
 *  - the verdict binds the ruleset's remedy table (remedy_table_hash, types.ts remedyTableOf).
 * Additive ruleset keys (2026-10-03, any engine; a ruleset without them keeps its bytes): list fields (`each`, summed by sum()),
 * `line_computed` roles, and the check keys `exact_tolerance`, `fail_if_unreadable` and `advisory` (types.ts).
 */

import { normalizeAmount, normalizeQuantity, normalizeRate } from '../binding/forensic-normalizer.js'
import { applyTolerancePolicy, toleranceIdentity } from '../tolerance.js'
import { hashOf, sha256 } from '../verdict/canonical.js'
import { round4 } from '../verdict/from-report.js'
import type { Advisory, ClaimVerdict, Coverage, DeclaredAccuracy, Evidence, Insufficiency, Outcome, Value, Verdict } from '../verdict/schema.js'
import { attachDeclaredAccuracy } from '../verdict/accuracy.js'
import { SCHEMA_VERSION, engineAtLeast, engineFor, type EngineVersion } from '../version.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { evalExpr, referencedRoles, roleRefs, evalExprV040, referencedRolesV040, roleRefsV040, operandRefs, parseOperandName, round9 as round9v, type AggFn, type Env, type OperandRef, type RefKind } from './expr.js'
import { remedyTableOf, type DeclAlgorithm, type DeclApplicability, type DeclarativeRuleset, type DeclCheck, type DeclChoice, type DeclCondition, type DeclField, type RoundingMode, type SuppliedChoice } from './types.js'
import { algorithmPin, resolveAlgorithm, type AlgorithmEntry, type AlgorithmPin } from '../algorithms/index.js'
import { QC_SCHEMES, qcFlagKey } from '../schemes/index.js'
import type { ChoiceEntry, ChoiceValue, QcBlock, QcValue } from '../verdict/schema.js'
import { createHash } from 'node:crypto'
import { attachRemedies, normalizeDeclaration, type RuleRemedies } from '../verdict/remedy.js'
import { verifyInputHash } from '../protocol/inputs.js'
import { InputRefused } from '../protocol/input.js'
import { nonFinitePath, nonFiniteRefusal, unsafeMagnitudePath, unsafeMagnitudeRefusal, valueAtPath, numberTextIsExact } from '../protocol/hash-input.js'
import { prepareSource, verifyQuote, verifyValueInText, type QuoteAssertion, type ValueAssertion } from '../textmatch/index.js'
import type { NotApplicable } from '../verdict/schema.js'
import { digitScriptOf, figureCharacterProblem, formatOfTexts, hasMark } from '../rulesets/strict.js'
import { describeUnreadable, notStrictNote, findLabelLine, findRawLine, isStrictNumberText, isStrictNumberTextV010, readNumberTextV020, renderAt, resolveLocale, showRaw, sourceLines, unreadableMarker, type NumberLocale, type Unreadable } from './unreadable.js'
import { isContractEnvelope, lowerContract, rulesetRef } from '../extract/contract.js'
import { validateContract, type ContractViolation } from '../extract/schema.js'
import { archiveProvenanceProblems, betterTier, floorOf, overlayProblems, provenanceTier, tierRank, type EvidenceItem, type EvidenceOverlay } from './evidence.js'
import type { ArchiveCheck, EvidenceTier, Finding, FieldSupport, StruckField, StruckReason, VerdictCounts, WouldUnlock } from '../verdict/schema.js'
import { attachScope } from '../verdict/scope.js'

export type Json = Record<string, unknown>
export interface VerifyDeclarativeOptions {
  producer?: string; now?: () => Date; tolerance?: { rel: number; absCap: number; rounding?: RoundingMode }; declared_accuracy?: DeclaredAccuracy
  /**
   * The source document's text (added 2026-10-03): the ruleset's `quotes` are checked against it verbatim, plus any
   * `quotes` / `values` the caller asks for, exactly as verify's source-text axis does for a built-in ruleset. When given, it
   * is part of the input the verdict is bound to (input_hash); when absent, the hash is what it always was.
   */
  source?: { text: string; quotes?: QuoteAssertion[]; values?: ValueAssertion[] }
  /**
   * The engine version to evaluate under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it
   * retains. '0.0.1' reads as that engine did (see declarativeReading). For replay: the verdict made names this version.
   */
  engine?: string
  /**
   * Engine 0.3.0 (2026-10-03): an arbitration evidence overlay (./evidence.ts): per field path, the evidence the engine read
   * from a filed document or a signed source, and the fields or document a STRIKE withdrew. Part of the input (input_hash).
   * Refused under an earlier engine.
   */
  evidence?: EvidenceOverlay
  /**
   * Engine 0.5.0 (2026-10-04): values the JUDGE supplies for choice slots (slot id → { value, source }), used when the
   * document does not state the slot; they override the ruleset's default. Part of the input (input_hash). Refused under an
   * earlier engine.
   */
  supplied_choices?: Record<string, SuppliedChoice>
  /**
   * Engine 0.5.0: archive files as bytes (base64), for archive provenance whose file is not text (a FITS file, a
   * compressed release). The engine hashes them itself, so `checksum_verified` is reachable for a binary file. Part of the input
   * (input_hash). Refused under an earlier engine.
   */
  archive_files?: ArchiveFile[]
}

/** One archive file supplied as bytes (engine 0.5.0): its name, for the reader, and its bytes in base64. */
export interface ArchiveFile { name?: string; base64: string }

/**
 * How a ruleset is read under an engine version (2026-10-03):
 *  - `unreadable`: null, "" and "UNREADABLE" are unreadable (never a default); labelled fields are looked for in the source
 *    text; every unreadable operand is named, and its remedy carries the value as reported and the printed line.
 *  - `strictNumbers`: a money, price or quantity string must read strictly as a number (unreadable.ts isStrictNumberText).
 * Engine 0.0.1: both are `distinguish_unreadable === true`, as that engine read them; `strict_numbers` did not exist.
 * Engine 0.1.0: both are on unless the ruleset turns them off (`"distinguish_unreadable": false`, `"strict_numbers": false`).
 */
export function declarativeReading(ruleset: Pick<DeclarativeRuleset, 'distinguish_unreadable' | 'strict_numbers'>, engine: EngineVersion): { unreadable: boolean; strictNumbers: boolean } {
  if (engine === '0.0.1') { const on = ruleset.distinguish_unreadable === true; return { unreadable: on, strictNumbers: on } }
  return { unreadable: ruleset.distinguish_unreadable !== false, strictNumbers: ruleset.strict_numbers !== false }
}

/** Candidate reporting units for rounding inference, largest first (the addendum's set). */
export const ROUNDING_UNITS = [1_000_000, 100_000, 1_000, 1] as const

/**
 * The reporting unit of a set of reported values: the largest candidate unit that divides every one of them, or
 * undefined when there are no values or none divides them all (e.g. amounts with cents).
 */
export function inferReportingUnit(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return ROUNDING_UNITS.find(u => values.every(v => Number.isFinite(v) && Math.abs(v) % u === 0))
}

/** Rounding-aware tolerance: max(floor, rel × largest |operand| (capped by absCap if > 0), U × number of operands). */
export function roundingTolerance(values: readonly number[], rel: number, absCap: number, floor: number): { tol: number; unit: number | undefined; n: number; maxAbs: number } {
  const n = values.length
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const unit = inferReportingUnit(values)
  // round4: 0.0003 × 20e9 is 5999999.999999999 in floating point; a boundary gap must not flip on that artefact.
  const relTerm = round4(absCap > 0 ? Math.min(rel * maxAbs, absCap) : rel * maxAbs)
  return { tol: Math.max(floor, relTerm, (unit ?? 0) * n), unit, n, maxAbs }
}

/** Engine 0.4.0: where an unresolved value sits: a document role, a role on a row, or a list element. */
type V040Loc = { role: string; line?: number; elem?: number }

/** A guard condition's comparison (exact unless tol > 0). */
function conditionHolds(l: number, op: DeclCondition['op'], r: number, tol: number): boolean {
  switch (op) {
    case '=': return Math.abs(l - r) <= tol
    case '!=': return Math.abs(l - r) > tol
    case '<': return l < r - tol
    case '<=': return l <= r + tol
    case '>': return l > r + tol
    case '>=': return l >= r - tol
    default: return false
  }
}

/** What a scope (the document, or one line) knows about a role — for optional terms, guards and rounding. */
interface ScopeInfo {
  /**
   * 'ok' = reported; 'defaulted' = absent but bound at the field's `default`; 'missing'; 'unparseable'. Engine 0.4.0 adds
   * 'no_neighbour': `prev(R)` on the first row or `next(R)` on the last.
   */
  status: (role: string) => 'ok' | 'defaulted' | 'missing' | 'unparseable' | 'no_neighbour'
  /** Where a reported role was found (for guard explanations). */
  where: (role: string) => string | undefined
  /** The reported amount-kind values behind these roles (computed roles expanded; sum() → every line's value). */
  amounts: (roles: string[]) => number[]
  /** Engine 0.4.0, a row's scope: whether the row has a row before and after it (the `neighbour` condition). */
  neighbours?: { prev: boolean; next: boolean }
}

const isDefaulted = (b: Bound | undefined): boolean => !!b && b.status === 'ok' && !!b.path && b.path.startsWith('default(')
const isAmountField = (f: DeclField | undefined): boolean => !!f && (f.kind === undefined || f.kind === 'amount')
const statusOf = (b: Bound | undefined): 'ok' | 'defaulted' | 'missing' | 'unparseable' => (!b ? 'missing' : b.status === 'ok' ? (isDefaulted(b) ? 'defaulted' : 'ok') : b.status)

interface Bound {
  status: 'ok' | 'missing' | 'unparseable'
  value?: number
  strValue?: string
  /** kind 'identifier': the normalised ids (deduplicated, first-appearance order) */
  ids?: string[]
  path?: string
  confidence: number
  original?: unknown
  norms?: string[]
  /** where an UNPARSEABLE value was found (for its remedy only: never evidence, never a guard's detail) */
  badPath?: string
  /** 2026-10-03, only under `distinguish_unreadable`: how an UNPARSEABLE field came to be unreadable, and where it is printed */
  unreadable?: Unreadable
  /**
   * Engine 0.4.0: a line-computed role with no value although nothing it reads is absent or unreadable: a domain note
   * (`sqrt of a negative value (-3.2)`) or `no_neighbour: …` (it reads prev() on the first row or next() on the last).
   */
  noValue?: string
  /**
   * Engine 0.5.0: the value's own quality flag, read through the flags choice, held it, struck it or blanked it. A struck or
   * absent value is left out of every aggregate and algorithm series (the rest compute); a held one makes them wait.
   */
  qc?: { action: 'held' | 'struck' | 'absent' }
}

/** Engine 0.5.0: a value its quality flag leaves out of aggregates and algorithm series (struck or absent; never a held one). */
const qcExcluded = (b: Bound | undefined): boolean => !!b?.qc && (b.qc.action === 'struck' || b.qc.action === 'absent')

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** kind 'bool': true/false, 1/0 and "true"/"false"/"yes"/"no"/"1"/"0" map to 1/0. Anything else is null (UNPARSEABLE). */
function normBool(raw: unknown): { value: number; norms?: string[] } | null {
  if (raw === true || raw === false) return { value: raw ? 1 : 0, norms: ['bool_to_number'] }
  if (raw === 1 || raw === 0) return { value: raw, norms: ['already_number'] }
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === '1') return { value: 1, norms: ['bool_text_parsed'] }
    if (s === 'false' || s === 'no' || s === '0') return { value: 0, norms: ['bool_text_parsed'] }
  }
  return null
}

/** Format characters (Cf: zero-width space, joiners, bidi marks, BOM) and every kind of space (Zs), plus whitespace. */
const INVISIBLE_OR_SPACE = /[\p{Cf}\p{Zs}\s]/gu

/**
 * An identifier's text as it is compared: whitespace removed and upper-cased; from engine 0.2.0 (red-team F13) first NFKC (so a
 * full-width "ＥＵＲ" is "EUR") with every format character and every kind of space removed (so "EU\u200BR" is "EUR").
 */
export function foldIdentifierText(x: string, v020 = false): string {
  return (v020 ? x.normalize('NFKC').replace(INVISIBLE_OR_SPACE, '') : x.replace(/\s+/g, '')).toUpperCase()
}

/** A key as a near-miss match compares it (engine 0.2.0, F15): NFKC, format characters and spaces removed; case kept. */
const foldKey = (k: string): string => k.normalize('NFKC').replace(INVISIBLE_OR_SPACE, '')

/** kind 'identifier': one id (string/number) or a list of them → normalised (whitespace removed, upper-cased), deduplicated. */
function normIdentifiers(raw: unknown, v020 = false): string[] | null {
  const one = (x: unknown): string | null | undefined => {
    if (typeof x === 'number' && Number.isFinite(x)) return String(x)
    if (typeof x !== 'string') return undefined // not an identifier at all
    const n = foldIdentifierText(x, v020)
    return n.length ? n : null // blank → ignored
  }
  if (!Array.isArray(raw)) { const n = one(raw); return typeof n === 'string' ? [n] : null }
  const out: string[] = []
  for (const x of raw) {
    const n = one(x)
    if (n === undefined) return null
    if (n !== null && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * The key two identifiers are COMPARED by (added 2026-10-03): the normalised id (whitespace removed, upper-cased) with its
 * punctuation removed, except that a run of punctuation between two digits becomes one '-'. So "Paxwick Builders, Inc." and
 * "Paxwick Builders Inc." are the same party, "PO-1001" and "PO1001" the same PO, and "INV/2026/001" and "INV-2026-001" the
 * same invoice, while "12-3" and "1-23" stay different (the separator between digits is kept, as a separator). The claim
 * still shows the normalised ids; a remedy shows the document's own strings.
 */
export function identifierKey(id: string): string {
  const isP = (ch: string | undefined): boolean => ch !== undefined && /\p{P}/u.test(ch)
  const isD = (ch: string | undefined): boolean => ch !== undefined && /\p{Nd}/u.test(ch)
  const chars = [...id]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    if (!isP(chars[i])) { out += chars[i]; continue }
    let j = i
    while (isP(chars[j])) j++
    if (isD([...out].pop()) && isD(chars[j])) out += '-'
    i = j - 1
  }
  return out
}

/** Two normalised id lists name the same SET of identifiers under identifierKey. */
function sameIdentifiers(a: readonly string[], b: readonly string[]): boolean {
  const ka = new Set(a.map(identifierKey)), kb = new Set(b.map(identifierKey))
  return ka.size === kb.size && [...ka].every(k => kb.has(k))
}

/** Money as a person reads it: thousands grouped, two decimals ("330,000.00", "-1,234.50"). Deterministic, locale-free. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const neg = n < 0
  const [int, frac] = Math.abs(round4(n)).toFixed(2).split('.') as [string, string]
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

/**
 * kind 'price' (added 2026-09-28): a unit price at full precision, never rounded to the cent. A JSON number or a plain
 * decimal string is exact. A formatted string ("€1.234,5", "1,500.00") goes through the amount parser, and if that
 * parser had to round it (more than two decimals) the result is null, i.e. UNPARSEABLE. It is never silently rounded.
 */
function normPrice(raw: unknown): { value: number; norms?: string[] } | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, norms: ['already_number'] } : null
  if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) { const v = Number(raw); return Number.isFinite(v) ? { value: v, norms: ['plain_decimal_parsed'] } : null }
  const n = normalizeAmount(raw)
  if (!n?.success || typeof n.normalized !== 'number' || !Number.isFinite(n.normalized)) return null
  if (n.transformations.includes('rounded_to_2_decimals')) return null
  return { value: n.normalized, norms: n.transformations }
}

function normByKind(kind: DeclField['kind'], raw: unknown): { value: number; norms?: string[] } | null {
  if (kind === 'bool') return normBool(raw)
  if (kind === 'price') return normPrice(raw)
  const n = kind === 'rate' ? normalizeRate(raw) : kind === 'quantity' ? normalizeQuantity(raw) : normalizeAmount(raw)
  if (!n?.success || typeof n.normalized !== 'number' || !Number.isFinite(n.normalized)) return null
  return { value: n.normalized, norms: n.transformations }
}

/**
 * Resolve one field spec against a source object (extraction, or a line item). `strict` = absent vs unreadable (added
 * 2026-10-03; declarativeReading): null, a blank string and the marker "UNREADABLE" mean "seen, not read", so the field is
 * unreadable and its default never applies. Without it, null and "" are absent, exactly as before. `strictNumbers`
 * (engine 0.1.0): a money, price or quantity string must read strictly as a number; under engine 0.0.1 it equals `strict`.
 */
/** Engine 0.2.0's reading (2026-10-03): numbers read whole (unreadable.ts readNumberTextV020, with the ruleset's locale), identifiers folded, near-miss keys unreadable. */
interface BindCtx {
  v020?: boolean
  locale?: NumberLocale
  /**
   * Engine 0.6.0 (2026-10-05): a number written as text must name exactly the double it reads as
   * (hash-input.ts numberTextIsExact). "9007199254740993.00" reads as 9007199254740992, so a check on it would judge a figure
   * the document does not hold: the field is unreadable instead.
   */
  exact?: boolean
  /**
   * Engine 0.6.0 (2026-10-06): a figure written as text with a digit other than 0-9, a space other than the ordinary one outside
   * a grouping, or an invisible formatting character is unreadable, the character named (rulesets/strict.ts
   * figureCharacterProblem).
   */
  figures?: boolean
  /**
   * Engine 0.6.0 (2026-10-06), with no locale declared: the document writes some figures only as en reads them and some only as de
   * does (the words, naming one of each). No figure written with a "." or "," is then read.
   */
  mixed?: string
  /** Engine 0.6.0 (2026-10-06): the document writes its figures in two scripts of digits (the words); one not in 0-9 is unreadable. */
  digits?: string
}

function bindField(source: unknown, field: DeclField, strict = false, strictNumbers = strict, isStrictText: (s: string) => boolean = isStrictNumberText, ctx: BindCtx = {}): Bound {
  let resolvedButBad = false
  let badPath: string | undefined
  let unreadable: Unreadable | undefined
  for (let i = 0; i < field.paths.length; i++) {
    const p = field.paths[i] as string
    const raw = getPath(source, p)
    if (raw === undefined) continue
    if (!strict && (raw === null || raw === '')) continue
    if (strict) {
      const marker = unreadableMarker(raw)
      if (marker) {
        resolvedButBad = true
        badPath ??= p
        unreadable ??= { how: marker, path: p, raw: showRaw(raw) }
        continue
      }
    }
    const confidence = i === 0 ? 100 : 95
    if (field.kind === 'string') return { status: 'ok', strValue: String(raw), path: field.paths[i], confidence, original: raw }
    if (field.kind === 'identifier') {
      const ids = normIdentifiers(raw, ctx.v020 === true)
      if (ids) return { status: 'ok', ids, path: field.paths[i], confidence, original: raw, norms: ['identifier_normalized'] }
      resolvedButBad = true
      badPath ??= field.paths[i]
      if (strict) unreadable ??= { how: 'unparseable', path: p, raw: showRaw(raw) }
      continue
    }
    // Under distinguish_unreadable a money or quantity string must read strictly as a number ("°20" is not 20). It is the
    // engine 0.1.0 default, unless the ruleset says strict_numbers: false.
    // Engine 0.2.0 (F14): a number written as text is read whole, with the declared locale; an ambiguous grouping is unreadable.
    if (ctx.v020 && strictNumbers && typeof raw === 'string' && (field.kind === undefined || field.kind === 'amount' || field.kind === 'price' || field.kind === 'quantity')) {
      const script = ctx.figures ? digitScriptOf(raw) : undefined
      const why = ctx.figures
        ? figureCharacterProblem(raw)
          ?? (ctx.digits !== undefined && script !== undefined && script !== 'the digits 0-9' ? `${ctx.digits}, and this figure is written in ${script}; send every figure in the digits 0-9, or as JSON numbers` : undefined)
          ?? (ctx.mixed !== undefined && hasMark(raw) ? `${ctx.mixed}, so what its "." and "," mean is not settled (declare the ruleset's "locale", or send JSON numbers)` : undefined)
        : undefined
      if (why !== undefined) {
        resolvedButBad = true
        badPath ??= field.paths[i]
        if (strict) unreadable ??= { how: 'unparseable', path: p, raw: showRaw(raw), detail: why }
        continue
      }
      const r = readNumberTextV020(raw, ctx.locale)
      const n = r && (!ctx.exact || numberTextIsExact(r.canonical)) ? normByKind(field.kind, r.canonical) : null
      if (r && n) return { status: 'ok', value: n.value, path: field.paths[i], confidence, original: raw, norms: r.changed ? ['number_text_read', ...(n.norms ?? [])] : n.norms }
      resolvedButBad = true
      badPath ??= field.paths[i]
      if (strict) unreadable ??= { how: 'unparseable', path: p, raw: showRaw(raw) }
      continue
    }
    const strictReject = strictNumbers && typeof raw === 'string' && (field.kind === undefined || field.kind === 'amount' || field.kind === 'price' || field.kind === 'quantity') && !isStrictText(raw)
    const norm = strictReject ? null : normByKind(field.kind, raw)
    if (norm) return { status: 'ok', value: norm.value, path: field.paths[i], confidence, original: raw, norms: norm.norms }
    resolvedButBad = true
    badPath ??= field.paths[i]
    if (strict) unreadable ??= { how: 'unparseable', path: p, raw: showRaw(raw) }
  }
  // Engine 0.2.0 (F15): no path resolved, but the object holds a key equal to one of them once spaces and invisible characters
  // are removed ("payable_amount "): the field was reported and not read. Unreadable, never absent, so it never takes a default.
  if (ctx.v020 && !resolvedButBad && source !== null && typeof source === 'object' && !Array.isArray(source)) {
    const keys = Object.keys(source as object)
    for (const p of field.paths) {
      if (/[.[\]]/.test(p)) continue
      const fp = foldKey(p)
      const k = keys.find(x => x !== p && foldKey(x) === fp)
      if (k !== undefined) return { status: 'unparseable', confidence: 0, badPath: k, ...(strict ? { unreadable: { how: 'key' as const, path: k, raw: showRaw((source as Record<string, unknown>)[k]) } } : {}) }
    }
  }
  // An absent OPTIONAL field with a declared default (e.g. an allowance that is 0 when omitted) is 'ok' at that default.
  if (!resolvedButBad && field.default !== undefined) return { status: 'ok', value: field.default, path: `default(${field.default})`, confidence: 100 }
  return resolvedButBad ? { status: 'unparseable', confidence: 0, ...(badPath !== undefined ? { badPath } : {}), ...(unreadable ? { unreadable } : {}) } : { status: 'missing', confidence: 0 }
}

function fieldEvidence(role: string, b: Bound): Evidence | null {
  if (b.status !== 'ok' || !b.path) return null
  const value: Value = b.ids !== undefined ? (Array.isArray(b.original) ? b.ids : (b.ids[0] ?? null)) : b.value !== undefined ? b.value : (b.strValue ?? null)
  const source = b.path.startsWith('default(') || b.path.startsWith('line_computed(') ? 'computed' : 'invoice'
  const e: Evidence = { locator: { kind: 'field', source, path: b.path }, value, confidence: b.confidence, role: 'OPERAND' }
  if (b.original !== undefined && String(b.original) !== String(value)) e.original = b.original as Value
  if (b.norms && b.norms.length) e.normalizations = b.norms
  return e
}

/** A check's declared abstention (DeclCheck.abstain, added 2026-09-28): the same insufficiency on every document. */
const declaredAbstention = (why: string): Insufficiency => ({ reason: 'OUT_OF_RULESET_SCOPE', detail: `declared abstention: ${why}` })

const evidenceKey = (e: Evidence): string => (e.locator.kind === 'field' ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}`)

export function verifyDeclarative(input: Json, ruleset: DeclarativeRuleset, options: VerifyDeclarativeOptions = {}): Verdict {
  // Engine 0.6.0 (the hash contract, protocol/hash-input.ts): an extraction or a supplied choice value holding a
  // non-finite number is refused before it is hashed. canonicalize writes Infinity, -Infinity and NaN as null, so 1e999, -1e999
  // and null shared one input_hash and one verdict_id. Under an earlier engine the input is read as it always was, so a verdict
  // that names 0.5.0 or earlier is re-performed byte for byte (the CLI refuses such a file before any engine sees it).
  if (engineAtLeast(engineFor(options.engine), '0.6.0')) {
    for (const [name, value] of [['the extraction', input], ['supplied_choices', options.supplied_choices]] as const) {
      const at = value === undefined ? undefined : nonFinitePath(value)
      if (at !== undefined) throw new InputRefused(name === 'the extraction' ? 'extraction' : 'supplied_choices', `verify: ${nonFiniteRefusal(name, at).message}`)
    }
    // 2026-10-05: a number past 2^53 − 1 in magnitude may already have been rounded when it was parsed (verify.ts
    // assertHashableInputs says why); refused, as verify() refuses it
    for (const [name, value] of [['the extraction', input], ['supplied_choices', options.supplied_choices]] as const) {
      const at = value === undefined ? undefined : unsafeMagnitudePath(value)
      if (at !== undefined) throw new InputRefused(name === 'the extraction' ? 'extraction' : 'supplied_choices', `verify: ${unsafeMagnitudeRefusal(name, at, valueAtPath(value, at)).message}`)
    }
  }
  return evaluateDeclarative(input, ruleset, options, false)
}

/** Budget of re-evaluations HELD-SUSPECT may spend on one verdict (engine 0.2.0); past it, the remaining claims stay plain holds. */
const SUSPECT_BUDGET = 1000
/** At most this many readings (or combinations of readings) are evaluated for one set of unreadable operands. */
const SUSPECT_MAX_COMBOS = 400
/** A reported string longer than this is not enumerated (its claim stays a plain hold). */
const SUSPECT_MAX_RAW = 32
/** The characters a one-character reading may substitute or insert. */
const SUSPECT_ALPHABET = '0123456789.,'

function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur = obj as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur?.[parts[i] as string]
    if (next === null || typeof next !== 'object') return
    cur = next as Record<string, unknown>
  }
  if (cur && typeof cur === 'object') cur[parts[parts.length - 1] as string] = value
}

const round9 = (x: number): number => Number(x.toFixed(9))

/** `nested`: a HELD-SUSPECT re-evaluation (no suspect pass of its own, no remedies). */
function evaluateDeclarative(input: Json, ruleset: DeclarativeRuleset, options: VerifyDeclarativeOptions, nested: boolean): Verdict {
  // T1 (2026-10-03): the extraction contract (src/extract). From engine 0.1.0 an envelope is lowered to the extraction the
  // checks read, and a ruleset that says `require_contract: true` refuses anything that is not a valid envelope (no check
  // runs). The verdict stays bound to the input as given. Engine 0.0.1 sees neither, so its verdicts keep their bytes.
  const contractEngine = engineFor(options.engine) !== '0.0.1'
  if (contractEngine && ruleset.require_contract === true) {
    const violations = validateContract(input, ruleset)
    if (violations.length) return contractRefusal(input, ruleset, options, violations)
  }
  const lowered = contractEngine && isContractEnvelope(input) ? lowerContract(input, ruleset) : undefined
  let extraction: Json = lowered ? lowered.extraction : input
  const lineKeys = ruleset.lineArrayKeys ?? ['line_items']
  const linesOf = (ex: Json): { lineKey: string | undefined; lines: Json[] } => {
    const k = lineKeys.find(x => Array.isArray(ex[x]))
    return { lineKey: k, lines: k ? (ex[k] as unknown[]).filter((x): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)) : [] }
  }
  let { lineKey, lines } = linesOf(extraction)

  const docRoles = Object.entries(ruleset.fields).filter(([, f]) => !f.line && !Array.isArray(f.each))
  const lineRoles = Object.entries(ruleset.fields).filter(([, f]) => f.line)
  const lineRoleNames = new Set(lineRoles.map(([r]) => r))
  /** List fields (2026-10-03): read from every element of an array, used through sum(). */
  const listRoles = Object.entries(ruleset.fields).filter(([, f]) => !f.line && Array.isArray(f.each))

  // The source text, read here because absent-vs-unreadable consults it while binding.
  const src = options.source
  const sourceGiven = typeof src?.text === 'string' && src.text.length > 0
  /**
   * 2026-10-03: the ruleset tells an unreadable field from an absent one (DeclarativeRuleset.distinguish_unreadable).
   * 2026-10-03: on by default from engine 0.1.0, and strict number reading with it (declarativeReading).
   */
  const engine_version = engineFor(options.engine)
  const reading = declarativeReading(ruleset, engine_version)
  const strict = reading.unreadable
  const strictNumbers = reading.strictNumbers
  // What reads strictly as a number: the absent-vs-unreadable predicate under engine 0.0.1; from 0.1.0 also a whole, well-formed CJK numeral.
  const strictText = engine_version === '0.0.1' ? isStrictNumberText : isStrictNumberTextV010
  // Engine 0.2.0 (2026-10-03): numbers read whole with the declared locale, identifiers folded, near-miss keys unreadable.
  const v020 = engineAtLeast(engine_version, '0.2.0')
  const locale = v020 ? resolveLocale(ruleset.locale) ?? undefined : undefined
  const bindCtx: BindCtx = v020 ? { v020: true, ...(locale ? { locale } : {}), ...(engineAtLeast(engine_version, '0.6.0') ? { exact: true, figures: true } : {}) } : {}
  // Engine 0.6.0 (2026-10-06), read off the figures of the ruleset's numeric fields as reported: a document whose figures are
  // written in two scripts of digits reads none that is not in 0-9; with no declared locale, one whose figures are written in
  // both formats reads none of those written with a "." or ","
  if (bindCtx.figures) {
    const texts: string[] = []
    const numeric = (f: DeclField): boolean => f.kind === undefined || f.kind === 'amount' || f.kind === 'price' || f.kind === 'quantity'
    const take = (o: unknown, f: DeclField): void => { for (const p of f.paths) { const v = getPath(o, p); if (typeof v === 'string') texts.push(v) } }
    for (const [, f] of docRoles) if (numeric(f)) take(extraction, f)
    for (const [, f] of lineRoles) if (numeric(f)) for (const l of lines) take(l, f)
    const fmt = formatOfTexts(texts, undefined)
    if (fmt.digits !== undefined) bindCtx.digits = fmt.digits
    if (!locale && fmt.source === 'mixed' && fmt.note !== undefined) bindCtx.mixed = fmt.note
  }
  // Engine 0.4.0 (2026-10-04): the table grammar (expr.ts) and the new ruleset keys. Under an earlier engine `E` is the old
  // grammar exactly, and nothing else below that is marked 0.4.0 runs, so every earlier verdict keeps its bytes.
  const v040 = engineAtLeast(engine_version, '0.4.0')
  const E: { evalExpr: (e: string, env: Env) => number | undefined; roleRefs: (...e: string[]) => { all: string[]; required: string[]; optional: string[] }; referencedRoles: (e: string) => string[] } = v040
    ? { evalExpr: evalExprV040, roleRefs: roleRefsV040, referencedRoles: referencedRolesV040 }
    : { evalExpr, roleRefs, referencedRoles }
  /** 0.4.0: archive provenance is read as E1 (evidence.ts provenanceTier); under an earlier engine the old inference applies. */
  const tierOpts = { archive: v040 }
  // Engine 0.5.0 (2026-10-04): the choice ledger, the measured support of model checks, per-value quality flags, archive
  // bytes. Nothing below that is marked 0.5.0 runs for an earlier engine, so every earlier verdict keeps its bytes.
  const v050 = engineAtLeast(engine_version, '0.5.0')
  // Engine 0.6.0: a field printed but not read says why when the figure there has no two decimals (notStrictNote)
  const v060 = engineAtLeast(engine_version, '0.6.0')
  const strictNote = (u: Unreadable, kind: string | undefined): string | undefined => (v060 ? notStrictNote(u, kind) : undefined)
  if (!v050 && options.supplied_choices !== undefined) throw new Error(`supplied_choices are read from engine 0.5.0 on; this verdict is made under engine ${engine_version}`)
  if (!v050 && options.archive_files !== undefined) throw new Error(`archive_files are read from engine 0.5.0 on; this verdict is made under engine ${engine_version}`)
  const ledger: ChoiceLedger = v050 ? choiceLedger(input, ruleset, options.supplied_choices) : { entries: [], values: new Map(), kinds: new Map(), load_bearing: 0, stated: 0, stated_rate: null }
  const own = (o: unknown, k: string): boolean => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
  /** 0.5.0: the slot ids that are document roles (a numeric value is read by its id); a slot whose id another role has is not one. */
  const choiceRoles = new Set<string>([...ledger.kinds.keys()].filter(id => !own(ruleset.fields, id) && !own(ruleset.computed, id) && !own(ruleset.line_computed, id) && !own(ruleset.algorithms, id)))
  /** 0.5.0: the per-value quality-flag account (the verdict's `qc`), filled when the envelope's values carry `qc`. */
  const qc: { seen: boolean; block: QcBlock } = { seen: false, block: { choice: null, read: 0, computed: 0, held: 0, struck: 0, absent: 0, not_read: 0, values: [] } }
  let beyondData = 0
  /** 0.4.0: the no-neighbour account for `prev.R` / `next.R` (on line `i` when known): the detail starts `no_neighbour:`. */
  const noNeighbourText = (name: string, i?: number): string => {
    const p = parseOperandName(name)
    const kind = p?.kind === 'next' ? 'next' : 'prev'
    return `no_neighbour: ${i === undefined ? 'this row' : `line ${i}`} has no ${kind === 'prev' ? 'previous' : 'next'} row, so ${kind}(${p?.role ?? name}) has no value`
  }
  /** 0.4.0: the plain roles an expression's operands rest on (aggregates, doc., prev() and next() unwrapped), in reading order. */
  const underlyingRoles = (...exprs: string[]): string[] => { const out = new Set<string>(); for (const e of exprs) for (const r of operandRefs(e)) out.add(r.role); return [...out] }

  // Bind document fields and per-line fields.
  const bindAll = (ex: Json, exLines: Json[]): { boundDoc: Map<string, Bound>; boundLines: Map<string, Bound>[]; boundLists: Map<string, { key?: string; elems: Bound[] }> } => {
    const bDoc = new Map<string, Bound>()
    for (const [role, f] of docRoles) bDoc.set(role, bindField(ex, f, strict, strictNumbers, strictText, bindCtx))
    const bLines: Map<string, Bound>[] = exLines.map(line => {
      const m = new Map<string, Bound>()
      for (const [role, f] of lineRoles) m.set(role, bindField(line, f, strict, strictNumbers, strictText, bindCtx))
      return m
    })
    // List fields: every element of the first candidate array, bound like a line field; an element that is not an object is unreadable.
    const bLists = new Map<string, { key?: string; elems: Bound[] }>()
    for (const [role, f] of listRoles) {
      let key: string | undefined
      let arr: unknown[] = []
      for (const k of f.each ?? []) { const a = getPath(ex, k); if (Array.isArray(a)) { key = k; arr = a; break } }
      const elems = arr.map((el): Bound => (el !== null && typeof el === 'object' && !Array.isArray(el)
        ? bindField(el, f, strict, strictNumbers, strictText, bindCtx)
        : { status: 'unparseable', confidence: 0, badPath: '', ...(strict ? { unreadable: { how: 'unparseable' as const, path: '', raw: showRaw(el) } } : {}) }))
      bLists.set(role, { ...(key !== undefined ? { key } : {}), elems })
    }
    return { boundDoc: bDoc, boundLines: bLines, boundLists: bLists }
  }
  let { boundDoc, boundLines, boundLists } = bindAll(extraction, lines)
  const listAt = (role: string, j: number, rel?: string): string => `${boundLists.get(role)?.key ?? role}[${j}]${rel ? `.${rel}` : ''}`

  // ---- Engine 0.3.0 (2026-10-03): the evidence ruling (./evidence.ts, docs/EVIDENCE.md). Tiers per path, the arbitration
  // overlay, struck fields. Nothing here runs for an earlier engine, so every 0.0.1, 0.1.0 and 0.2.0 verdict keeps its bytes.
  const v030 = engineAtLeast(engine_version, '0.3.0')
  const overlay = options.evidence
  if (overlay !== undefined) {
    if (!v030) throw new Error(`an evidence overlay is read from engine 0.3.0 on; this verdict is made under engine ${engine_version}`)
    const probs = overlayProblems(overlay)
    if (probs.length) throw new Error(`evidence overlay refused: ${probs.join('; ')}`)
  }
  const specOf = (r: string): DeclField | undefined => (Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined)
  const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const isRec = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
  /** v030: what an overlaid extraction path rests on: its tier and what supports it. */
  const pathTier = new Map<string, { tier: EvidenceTier | 'unstated'; supported_at: EvidenceTier | 'unstated' }>()
  const findings: Finding[] = []
  const support: FieldSupport[] = []
  type PathRole = { role: string; scope: 'doc' } | { role: string; scope: 'line'; i: number; rel: string } | { role: string; scope: 'list'; j: number; rel: string }
  /** v030: which role (and line or list element) an extraction path names, so a bound value can be found, read or struck. */
  const roleAtPath = (path: string): PathRole | undefined => {
    for (const [role, L] of boundLists) {
      const key = L.key ?? specOf(role)?.each?.[0]
      if (key === undefined) continue
      const m = new RegExp(`^${escapeRe(key)}\\[(\\d+)\\]\\.(.+)$`).exec(path)
      if (m && specOf(role)?.paths.includes(m[2]!)) return { role, scope: 'list', j: Number(m[1]), rel: m[2]! }
    }
    if (lineKey !== undefined) {
      const m = new RegExp(`^${escapeRe(lineKey)}\\[(\\d+)\\]\\.(.+)$`).exec(path)
      if (m) { const hit = lineRoles.find(([, f]) => f.paths.includes(m[2]!)); if (hit) return { role: hit[0], scope: 'line', i: Number(m[1]), rel: m[2]! } }
    }
    const byBound = docRoles.find(([role]) => boundDoc.get(role)?.path === path)
    if (byBound) return { role: byBound[0], scope: 'doc' }
    const byPath = docRoles.find(([, f]) => f.paths[0] === path) ?? docRoles.find(([, f]) => f.paths.includes(path))
    return byPath ? { role: byPath[0], scope: 'doc' } : undefined
  }
  const fieldNameOf = (r: PathRole | undefined, path: string): string => (!r ? path : r.scope === 'line' ? `${r.role}@line[${r.i}]` : r.scope === 'list' ? `${r.role}[${r.j}]` : r.role)
  const boundAt = (path: string): Bound | undefined => {
    const r = roleAtPath(path)
    if (!r) return undefined
    return r.scope === 'doc' ? boundDoc.get(r.role) : r.scope === 'line' ? boundLines[r.i]?.get(r.role) : boundLists.get(r.role)?.elems[r.j]
  }
  const setBoundAt = (path: string, b: Bound): void => {
    const r = roleAtPath(path)
    if (!r) return
    if (r.scope === 'doc') boundDoc.set(r.role, b)
    else if (r.scope === 'line') boundLines[r.i]?.set(r.role, b)
    else { const L = boundLists.get(r.role); if (L && r.j < L.elems.length) L.elems[r.j] = b }
  }
  /** The tier a path's ORIGINAL value rests on: an envelope's provenance (the worse of stated and inferred; none = E4), else unstated. */
  const originalTier = (path: string): EvidenceTier | 'unstated' => {
    if (!lowered) return 'unstated'
    const p = lowered.provenance.get(path)
    return p === undefined ? 'E4' : provenanceTier(p, tierOpts).tier
  }
  /** The tolerance two readings of a role agree within: the smallest `tol` of the numeric checks that read it (default 0.01). */
  const toleranceAt = (role: string): number => {
    let tol: number | undefined
    for (const c of ruleset.checks) {
      if (c.compare === 'identifier' || c.compare === 'member') continue
      let refs: string[] = []
      const exprs = [c.left, c.right, ...(c.alternatives ?? []).flatMap(a => [a.left, a.right])]
      try { refs = v040 ? underlyingRoles(...exprs) : roleRefs(...exprs).all } catch { refs = [] }
      if (refs.includes(role)) tol = Math.min(tol ?? Infinity, c.tol ?? 0.01)
    }
    return tol ?? 0.01
  }
  const sameValue = (a: unknown, b: unknown, tol: number): boolean =>
    typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol + 1e-9
      : typeof a === 'string' && typeof b === 'string' ? identifierKey(foldIdentifierText(a, true)) === identifierKey(foldIdentifierText(b, true)) : false
  /** Paths a same-tier conflict struck (nothing ranks the two values), with why. */
  const conflictStruck = new Map<string, string>()
  if (v030 && overlay?.fields && Object.keys(overlay.fields).length) {
    // Resolve each overlaid path against the value the filing itself carries (when it reads): the higher tier computes.
    const patched = structuredClone(extraction)
    for (const [path, items] of Object.entries(overlay.fields)) {
      const at = roleAtPath(path)
      const role = at?.role ?? path
      const tol = toleranceAt(role)
      const orig = boundAt(path)
      const origReads = orig?.status === 'ok' && !isDefaulted(orig) && orig.path !== undefined
      const origValue: number | string | undefined = origReads ? (orig!.value ?? orig!.strValue ?? orig!.ids?.[0]) : undefined
      type Src = { source_id: string; tier: EvidenceTier | 'unstated'; value: number | string; move_id?: string }
      const sources: Src[] = [
        ...(origReads && origValue !== undefined ? [{ source_id: 'filing', tier: originalTier(path), value: origValue }] : []),
        ...items.map((it: EvidenceItem): Src => ({ source_id: it.source_id, tier: it.tier, value: it.value, move_id: it.move_id })),
      ]
      const fieldName = fieldNameOf(at, path)
      const best = sources.reduce((m, x) => Math.min(m, tierRank(x.tier)), Infinity)
      const top = sources.filter(x => tierRank(x.tier) === best)
      const topDistinct = top.filter((x, i) => top.findIndex(y => sameValue(y.value, x.value, tol)) === i)
      if (topDistinct.length > 1) {
        // nothing ranks two different values at one tier: the field is struck (reason conflict), and the conflict is a finding
        const a = topDistinct[0]!, b = topDistinct[1]!
        conflictStruck.set(path, `${a.source_id} reads ${String(a.value)} and ${b.source_id} reads ${String(b.value)}, both at ${a.tier}, and nothing higher ranks them`)
        findings.push({ kind: 'tier-conflict', field: fieldName, path, detail: `two sources at ${a.tier} disagree on ${fieldName}: ${a.source_id} reads ${String(a.value)}, ${b.source_id} reads ${String(b.value)}; nothing higher ranks them, so the field is struck`, kept: { value: a.value, tier: a.tier, source: a.source_id }, against: { value: b.value, tier: b.tier, source: b.source_id } })
        continue
      }
      const chosen = top[0]!
      for (const x of sources) {
        if (x === chosen || sameValue(x.value, chosen.value, tol)) continue
        findings.push({ kind: 'tier-conflict', field: fieldName, path, detail: `${fieldName}: ${x.source_id} reads ${String(x.value)} at ${x.tier}, and ${chosen.source_id} reads ${String(chosen.value)} at ${chosen.tier}; the higher tier computes, and the conflict stays on the record`, kept: { value: chosen.value, tier: chosen.tier, source: chosen.source_id }, against: { value: x.value, tier: x.tier, source: x.source_id } })
      }
      const agreeing = sources.filter(x => sameValue(x.value, chosen.value, tol))
      const supported_at = agreeing.reduce<EvidenceTier | 'unstated'>((m, x) => betterTier(m, x.tier), chosen.tier)
      pathTier.set(path, { tier: chosen.tier, supported_at })
      support.push({ field: fieldName, path, value: chosen.value, tier: chosen.tier, supported_at, sources: sources.map(x => ({ source_id: x.source_id, tier: x.tier, value: x.value, agrees: sameValue(x.value, chosen.value, tol), ...(x.move_id !== undefined ? { move_id: x.move_id } : {}) })) })
      if (chosen.source_id !== 'filing') setPath(patched, path, chosen.value)
    }
    extraction = patched
    ;({ lineKey, lines } = linesOf(extraction))
    ;({ boundDoc, boundLines, boundLists } = bindAll(extraction, lines))
  }
  if (v030) {
    /** A struck Bound; `rel` is the path as the scope reads it (a document path; relative to its line or list element). */
    const struckBound = (rel: string | undefined, how: 'withdrawn' | 'unsupported' | 'conflict', detail: string, raw?: unknown): Bound =>
      ({ status: 'unparseable', confidence: 0, ...(rel !== undefined ? { badPath: rel } : {}), unreadable: { how, ...(rel !== undefined ? { path: rel } : {}), ...(raw !== undefined ? { raw: showRaw(raw) } : {}), detail } })
    /** Strike the value at an extraction path (absolute), naming it as its scope reads it. */
    const strikeAt = (path: string, how: 'withdrawn' | 'unsupported' | 'conflict', detail: string, raw?: unknown): void => {
      const r = roleAtPath(path)
      if (!r) return
      setBoundAt(path, struckBound(r.scope === 'doc' ? path : r.rel, how, detail, raw))
    }
    // An envelope value with no provenance, or provenance that is an assertion (E4), is never load-bearing: struck.
    if (lowered && isContractEnvelope(input)) {
      const env = input
      const consider = (path: string, f: unknown): void => {
        if (pathTier.has(path)) return // an overlay value carries its own evidence
        const b = boundAt(path)
        if (!b || b.status !== 'ok' || isDefaulted(b)) return
        const prov = lowered.provenance.get(path)
        const pt = prov === undefined ? { tier: 'E4' as const } : provenanceTier(prov, tierOpts)
        if (pt.tier === 'E4') {
          const why = prov === undefined ? 'the envelope gives it no provenance' : (prov as { reader?: unknown }).reader === 'supplied' ? 'its provenance says it was supplied, not read off the page'
            : v040 && (prov as { kind?: unknown }).kind === 'archive' && archiveProvenanceProblems(prov).length ? `its archive provenance is malformed (${archiveProvenanceProblems(prov).join('; ')}), so it is an assertion (E4)`
              : 'its provenance states an assertion (E4)'
          strikeAt(path, 'unsupported', why, isRec(f) ? f.value : undefined)
          return
        }
        if ('capped' in pt && pt.capped) {
          findings.push({ kind: 'tier-claim-capped', field: fieldNameOf(roleAtPath(path), path), path, detail: `the envelope states ${pt.capped.stated} for ${path}, but its readers support ${pt.capped.inferred}: a tier is never raised by a party's say-so, so the value rests on ${pt.capped.inferred}` })
        }
      }
      for (const [role, f] of Object.entries(isRec(env.fields) ? env.fields : {})) {
        const spec = specOf(role)
        if (!spec || spec.line || spec.paths[0] === undefined) continue
        if (Array.isArray(spec.each) && Array.isArray(f)) { const key = spec.each[0]; if (key !== undefined) f.forEach((it, j) => consider(`${key}[${j}].${spec.paths[0]}`, it)); continue }
        consider(spec.paths[0], f)
      }
      const lk = ruleset.lineArrayKeys?.[0] ?? 'line_items'
      ;(Array.isArray(env.lines) ? env.lines : []).forEach((line, i) => {
        for (const [role, f] of Object.entries(isRec(line) && isRec(line.fields) ? line.fields : {})) {
          const spec = specOf(role)
          if (!spec || !spec.line || spec.paths[0] === undefined) continue
          consider(`${lk}[${i}].${spec.paths[0]}`, f)
        }
      })
    }
    for (const [path, why] of conflictStruck) strikeAt(path, 'conflict', why, getPath(extraction, path))
    // A STRIKE withdraws a field, or the whole document (every field, read or not: nothing filed stands).
    for (const st of overlay?.struck ?? []) {
      const detail = `by move ${st.move_id.slice(0, 12)}: ${st.reason}`
      if (st.document === true) {
        const why = `the document was withdrawn ${detail}`
        for (const [role, f] of docRoles) boundDoc.set(role, struckBound(boundDoc.get(role)?.path ?? f.paths[0], 'withdrawn', why))
        for (const m of boundLines) for (const [role, f] of lineRoles) m.set(role, struckBound(m.get(role)?.path ?? f.paths[0], 'withdrawn', why))
        for (const [role, L] of boundLists) L.elems = L.elems.map(e => struckBound(e.path ?? specOf(role)?.paths[0], 'withdrawn', why))
        continue
      }
      if (st.path !== undefined) strikeAt(st.path, 'withdrawn', `withdrawn ${detail}`, getPath(extraction, st.path))
    }
  }
  // Engine 0.5.0: per-value quality flags. A value's provenance may carry its own flag (`qc: { scheme, flag }`); the
  // ruleset's flags choice for that scheme computes it, holds it (the checks that read it wait), strikes it (left out of every
  // aggregate and algorithm series; a direct read abstains) or reads it as missing. A value whose scheme no flags choice governs is
  // computed as given and counted `not_read`: honouring or ignoring flags is a choice on the ledger, never a code path.
  if (v050 && lowered) {
    const policies = new Map<string, { slot: string; policy: Record<string, unknown> }>()
    for (const e of ledger.entries) if (e.kind === 'flags' && isRec(e.value) && typeof e.value.scheme === 'string' && !policies.has(e.value.scheme)) policies.set(e.value.scheme, { slot: e.id, policy: e.value })
    const bucketOf = (policy: Record<string, unknown>, flag: string): 'compute' | 'hold' | 'strike' | 'absent' | undefined => {
      for (const k of ['compute', 'hold', 'strike', 'absent'] as const) { const list = policy[k]; if (Array.isArray(list) && list.some(x => qcFlagKey(x) === flag)) return k }
      return undefined
    }
    for (const [path, prov] of lowered.provenance) {
      const q = isRec(prov) ? (prov as Record<string, unknown>).qc : undefined
      if (!isRec(q)) continue
      qc.seen = true
      const b = boundAt(path)
      if (!b || b.status !== 'ok' || isDefaulted(b)) continue // already unresolved for another reason: the flag adds nothing
      qc.block.read++
      const scheme = String(q.scheme)
      const p = policies.get(scheme)
      if (!p) { qc.block.not_read++; continue }
      qc.block.choice ??= p.slot
      const S = Object.prototype.hasOwnProperty.call(QC_SCHEMES, scheme) ? QC_SCHEMES[scheme] : undefined
      const flag = qcFlagKey(q.flag)
      const meaning = flag !== undefined && S && Object.prototype.hasOwnProperty.call(S.flags, flag) ? S.flags[flag]!.meaning : undefined
      let action: 'computed' | 'held' | 'struck' | 'absent'
      let why: string
      if (!S) { action = 'held'; why = `the flags choice ${p.slot} names the scheme "${scheme}", which this build does not carry (src/schemes), so the flag cannot be read` }
      else if (meaning === undefined) { action = 'struck'; why = `${JSON.stringify(q.flag)} is not a flag the ${scheme} scheme defines` }
      else {
        const k = bucketOf(p.policy, flag!)
        action = k === 'compute' ? 'computed' : k === 'strike' ? 'struck' : k === 'absent' ? 'absent' : 'held'
        why = k === undefined ? `${scheme} flag ${flag} (${meaning}): the flags choice ${p.slot} does not place this flag, so it holds the value`
          : `${scheme} flag ${flag} (${meaning}): the flags choice ${p.slot} ${k === 'hold' ? 'holds' : k === 'strike' ? 'strikes' : k === 'absent' ? 'reads it as a missing value' : 'computes'} it`
      }
      if (action === 'computed') { qc.block.computed++; continue }
      qc.block[action]++
      const at = roleAtPath(path)
      const rel = at && at.scope !== 'doc' ? at.rel : path
      if (action === 'absent') setBoundAt(path, { status: 'missing', confidence: 0, qc: { action } })
      else setBoundAt(path, { status: 'unparseable', confidence: 0, badPath: rel, unreadable: { how: action === 'held' ? 'qc_held' : 'qc_struck', path: rel, raw: showRaw(b.original), detail: why }, qc: { action } })
      qc.block.values.push({ field: fieldNameOf(at, path), path, scheme, flag: flag ?? String(q.flag), meaning: meaning ?? 'not a flag the scheme defines', action })
    }
  }
  // Line-computed roles (2026-10-03): per line, in declaration order; unknown where an operand is absent or unreadable.
  for (const [role] of Object.entries(ruleset.line_computed ?? {})) lineRoleNames.add(role)
  // Engine 0.4.0 evaluates line-computed roles later, role by role over every row (prev(), next() and doc. need it); see below.
  if (ruleset.line_computed && !v040) {
    for (const m of boundLines) {
      for (const [role, formula] of Object.entries(ruleset.line_computed)) {
        const vars: Record<string, number | undefined> = {}
        for (const [r, b] of m) vars[r] = b.status === 'ok' ? b.value : undefined
        let refs: string[] = []
        try { refs = referencedRoles(formula) } catch { refs = [] }
        // an unreadable operand, optional ones included, makes the role unknown (an optional term never reads an unknown as 0)
        const unreadableOperand = refs.some(r => m.get(r)?.status === 'unparseable')
        let value: number | undefined
        try { value = unreadableOperand ? undefined : evalExpr(formula, { vars, sum: () => undefined }) } catch { value = undefined }
        if (value !== undefined && Number.isFinite(value)) m.set(role, { status: 'ok', value, path: `line_computed(${role})`, confidence: 100 })
        else m.set(role, { status: refs.some(r => m.get(r)?.status === 'unparseable') ? 'unparseable' : 'missing', confidence: 0 })
      }
    }
  }
  // With the source text, a labelled document field that was not reported (or only defaulted) while its label heads a
  // source line is printed but unread: unreadable, never its default. A reported value that did not parse is located by
  // its raw string. Only under distinguish_unreadable; the match can only move a check toward ABSTAIN.
  if (strict && sourceGiven) {
    const srcLines = sourceLines(src!.text)
    for (const [role, f] of docRoles) {
      const b = boundDoc.get(role)!
      if (f.labels?.length && (b.status === 'missing' || isDefaulted(b))) {
        const at = findLabelLine(srcLines, f.labels)
        if (at) boundDoc.set(role, { status: 'unparseable', confidence: 0, unreadable: { how: 'label', at } })
      }
    }
    const locate = (b: Bound | undefined): void => {
      const u = b?.unreadable
      if (!u || u.at || u.how !== 'unparseable' || u.raw === undefined) return
      let raw: unknown
      try { raw = JSON.parse(u.raw) } catch { return }
      if (typeof raw === 'string' || typeof raw === 'number') { const hit = findRawLine(srcLines, String(raw)); if (hit) u.at = hit }
    }
    for (const b of boundDoc.values()) locate(b)
    for (const m of boundLines) for (const b of m.values()) locate(b)
  }
  // T1 (2026-10-03): an envelope's UNREADABLE value carries where it is printed (its provenance), so its remedy names that
  // page and line even without source text. Only for an envelope; every other input keeps its bytes.
  if (strict && lowered) {
    const pages = Number((input as { document?: { pages?: unknown } }).document?.pages ?? 1)
    const fill = (b: Bound | undefined, path: string | undefined): void => {
      const u = b?.unreadable
      if (!u || u.at || path === undefined) return
      const p = lowered.provenance.get(path)
      if (!p || !('page' in p) || typeof p.line !== 'number') return
      const text = (p.line_text ?? p.raw).replace(/\s+/g, ' ').trim()
      u.at = { ...(pages > 1 || p.page > 1 ? { page: p.page } : {}), line: p.line, text: text.length > 120 ? `${text.slice(0, 117)}...` : text }
    }
    for (const b of boundDoc.values()) fill(b, b.unreadable?.path)
    // a list element's UNREADABLE value (2026-10-03, T2): its item's provenance
    for (const [role, L] of boundLists) L.elems.forEach((b, j) => fill(b, b.unreadable?.path === undefined ? undefined : `${L.key ?? role}[${j}].${b.unreadable.path}`))
    boundLines.forEach((m, i) => { for (const b of m.values()) fill(b, b.unreadable?.path === undefined ? undefined : `${lineKey ?? 'line_items'}[${i}].${b.unreadable.path}`) })
  }
  /** The detail for an UNPARSEABLE operand: the unreadable account when the ruleset opts in, else the old text. */
  const unpDetail = (role: string, b: Bound | undefined, fallback: string): string =>
    (b?.unreadable ? describeUnreadable(role, b.unreadable, Object.prototype.hasOwnProperty.call(ruleset.fields, role) ? ruleset.fields[role]?.kind : undefined, strictNote(b.unreadable, Object.prototype.hasOwnProperty.call(ruleset.fields, role) ? ruleset.fields[role]?.kind : undefined)) : fallback)

  // sum(role): sum a per-line role across all lines; undefined if any line lacks it (a partial sum would lie).
  const sumRole = (role: string): number | undefined => {
    const L = boundLists.get(role)
    if (L) {
      if (L.elems.length === 0) return undefined
      let acc = 0
      for (const b of L.elems) { if (b.status !== 'ok' || b.value === undefined) return undefined; acc += b.value }
      return round4(acc)
    }
    if (boundLines.length === 0) return undefined
    let acc = 0
    for (const m of boundLines) { const b = m.get(role); if (!b || b.status !== 'ok' || b.value === undefined) return undefined; acc += b.value }
    return round4(acc)
  }

  // Document-scope variable map + computed roles (evaluated in declaration order; later may use earlier).
  const docVars: Record<string, number | undefined> = {}
  for (const [role, b] of boundDoc) docVars[role] = b.status === 'ok' ? b.value : undefined
  // Engine 0.5.0: a choice with a numeric value is a document role named by its slot id (doc.ID inside a row)
  if (v050) for (const id of choiceRoles) { const v = ledger.values.get(id); docVars[id] = typeof v === 'number' ? v : undefined }
  const computedFormula = new Map<string, string>()
  for (const [role, formula] of Object.entries(ruleset.computed ?? {})) {
    computedFormula.set(role, formula)
    // Engine 0.4.0 evaluates computed roles later, after the line-computed roles and the algorithms they may read (see below).
    if (!v040) docVars[role] = evalExpr(formula, { vars: docVars, sum: sumRole })
  }
  const docEnv: Env = { vars: docVars, sum: sumRole }
  /** Engine 0.5.0: why a choice role has no number: unstated, declared not applicable, or a value that is not a number. */
  const choiceMissing = (id: string): Insufficiency => {
    const e = ledger.entries.find(x => x.id === id)
    if (e && (e.status === 'stated' || e.status === 'supplied')) return { reason: 'OUT_OF_RULESET_SCOPE', detail: `the choice ${id} (${e.kind}) has the value ${JSON.stringify(e.value)}, which is not a number, so an expression cannot read it` }
    return { reason: 'FIELD_MISSING', detail: `choice_unstated: ${e?.status === 'not_applicable' ? `the choice ${id} (${e.kind}) is declared not applicable here` : `the choice ${id} (${e?.kind ?? '?'}) is neither stated by the document nor supplied (the ruleset gives no default)`}`, missing: [id] }
  }
  /** Engine 0.5.0: a choice role as evidence: the document's fill (stated), or the supplied value with who supplied it. */
  const choiceEvidence = (id: string): Evidence => {
    const e = ledger.entries.find(x => x.id === id)
    const by = e?.source !== null && e?.source !== undefined && 'by' in e.source ? e.source.by : undefined
    return e?.status === 'stated'
      ? { locator: { kind: 'field', source: 'invoice', path: `choices.${id}.value` }, value: docVars[id] as number, confidence: 100, role: 'CONTEXT' }
      : { locator: { kind: 'field', source: 'computed', path: `choice ${id} (supplied by the ${by ?? 'ruleset'})` }, value: docVars[id] as number, confidence: 100, role: 'CONTEXT' }
  }
  // Engine 0.4.0: roles computed by named, pinned algorithms (src/algorithms/), evaluated with the computed roles below.
  type V040Result = { status: 'ok' | 'missing' | 'unparseable' | 'novalue' | 'no_neighbour'; value?: number; why?: Insufficiency; locs: V040Loc[]; rows: number[] }
  const algoRoles = new Map<string, { spec: DeclAlgorithm; entry?: AlgorithmEntry; output: string; res?: V040Result }>()
  if (v040 && ruleset.algorithms !== null && typeof ruleset.algorithms === 'object' && !Array.isArray(ruleset.algorithms)) {
    for (const [role, spec] of Object.entries(ruleset.algorithms)) {
      if (Object.prototype.hasOwnProperty.call(ruleset.fields, role) || computedFormula.has(role)) continue // lint refuses a name used twice
      const found = resolveAlgorithm(spec?.algorithm)
      // engine 0.5.0: an entry the registry gained at a later engine (rar.fit@1) is not carried by an earlier one
      const entry = found && (found.since === undefined || engineAtLeast(engine_version, found.since as EngineVersion)) ? found : undefined
      algoRoles.set(role, { spec, ...(entry ? { entry } : {}), output: typeof spec?.output === 'string' ? spec.output : entry?.primary ?? '' })
    }
  }

  const policy = options.tolerance ?? ruleset.tolerance ?? { rel: 0.0003, absCap: 0 }
  const roundingDefault: RoundingMode = options.tolerance?.rounding ?? ruleset.tolerance?.rounding ?? 'none'
  const claims: ClaimVerdict[] = []
  /** v030: the roles each computed (PASS/FAIL) claim rests on, with its line, for the evidence floor. */
  const restsOn = new Map<ClaimVerdict, { roles: string[]; line?: number }>()
  const lineOfPrefix = (prefix: string): number | undefined => { const m = /^line\[(\d+)\]$/.exec(prefix); return m ? Number(m[1]) : undefined }
  /** Checks and quotes ruled out by applies_if (2026-10-03): no claim, listed on the verdict with the reason. */
  const notApplicable: NotApplicable[] = []
  /** How a remedy shows a claim's facts: identifier claims show the document's own strings; money claims, money. */
  const display = { identifiers: new Map<string, { left: string; right: string; l: Bound; r: Bound }>(), money: new Set<string>() }
  /** Claims decided under rounding inference: their tolerance is final, so the relative-band pass skips them. */
  const inferred = new Set<ClaimVerdict>()
  const fieldSpec = (r: string): DeclField | undefined => (Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined)

  // ---- abstain guards (shared by numeric and identifier checks). null = no guard fires.
  // A check's `guard_reason` (added 2026-09-28) is appended to whichever guard fires; without it the detail is unchanged.
  const guardInsufficiency = (chk: DeclCheck, env: Env, scope: ScopeInfo): Insufficiency | null => {
    const g = firedGuard(chk, env, scope)
    return g && chk.guard_reason !== undefined ? { ...g, detail: `${g.detail}. Reason: ${chk.guard_reason}` } : g
  }
  const firedGuard = (chk: DeclCheck, env: Env, scope: ScopeInfo): Insufficiency | null => {
    const unless = chk.abstain_unless_all_present ?? []
    if (unless.length) {
      const bad = unless.filter(r => scope.status(r) === 'unparseable')
      if (bad.length) return { reason: 'UNPARSEABLE', detail: `guard abstain_unless_all_present: ${bad.join(', ')} present but unparseable`, missing: bad }
      const absent = unless.filter(r => scope.status(r) !== 'ok')
      if (absent.length) return { reason: 'FIELD_MISSING', detail: `guard abstain_unless_all_present: ${absent.join(', ')} not reported`, missing: absent }
    }
    for (const r of chk.abstain_if_present ?? []) {
      const s = scope.status(r)
      if (s === 'ok' || s === 'unparseable') { const w = scope.where(r); return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if_present: ${r} is reported${w ? ` (${w})` : ''}; the identity does not model it` } }
    }
    for (const g of chk.abstain_if_present_without ?? []) {
      const s = scope.status(g.present)
      if ((s === 'ok' || s === 'unparseable') && scope.status(g.without) !== 'ok') { const w = scope.where(g.present); return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if_present_without: ${g.present} is reported${w ? ` (${w})` : ''} without ${g.without}; the identity reads ${g.without} in its place` } }
    }
    for (const c of chk.abstain_if ?? []) {
      let l: number | undefined, r: number | undefined
      try {
        const unp = E.roleRefs(c.left, c.right).all.filter(x => scope.status(x) === 'unparseable')
        if (unp.length) return { reason: 'UNPARSEABLE', detail: `guard abstain_if: ${unp.join(', ')} present but unparseable, so "${c.left} ${c.op} ${c.right}" cannot be evaluated`, missing: unp }
        l = E.evalExpr(c.left, env); r = E.evalExpr(c.right, env)
      } catch (e) { return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if: expression error: ${(e as Error).message}` } }
      if (l === undefined || r === undefined) continue // an operand is absent: the condition cannot hold
      if (conditionHolds(l, c.op, r, c.tol ?? 0)) return { reason: 'OUT_OF_RULESET_SCOPE', detail: `guard abstain_if: ${c.left} ${c.op} ${c.right} holds (${round4(l)} vs ${round4(r)})` }
    }
    return null
  }

  // ---- applicability (applies_if, added 2026-10-03): decided BEFORE the missing-field test. A condition that cannot be
  // evaluated makes applicability unknown, and the check abstains naming the field: it is never skipped on a guess.
  type Applies = { applies: true } | { applies: false; detail: string } | { applies: 'unknown'; why: Insufficiency }
  const applicability = (conds: readonly DeclApplicability[] | undefined, env: Env, scope: ScopeInfo, lookup: (role: string) => Bound | undefined): Applies => {
    if (!conds || conds.length === 0) return { applies: true }
    const unknown = (reason: 'FIELD_MISSING' | 'UNPARSEABLE' | 'OUT_OF_RULESET_SCOPE', roles: string[], what: string): Applies =>
      ({ applies: 'unknown', why: { reason, detail: `cannot tell whether this applies: ${what}`, ...(roles.length ? { missing: roles } : {}) } })
    for (const c of conds) {
      // Engine 0.4.0: { neighbour: 'prev' | 'next' }, the row has a row before (after) it. Row checks only.
      if (v040 && c !== null && typeof c === 'object' && 'neighbour' in c) {
        const want = (c as { neighbour: unknown }).neighbour
        const has = scope.neighbours
        if (!has || (want !== 'prev' && want !== 'next')) return unknown('OUT_OF_RULESET_SCOPE', [], `a neighbour condition is read on a row, with "prev" or "next" (got ${JSON.stringify(want)}${has ? '' : ' at document scope'})`)
        if (!has[want]) return { applies: false, detail: `no_neighbour: this row has no ${want === 'prev' ? 'previous' : 'next'} row` }
        continue
      }
      if (c !== null && typeof c === 'object' && 'any_present' in c) {
        // 2026-10-03 (T2): at least one of these fields is reported (an optional group is there)
        const sts = c.any_present.map(r => scope.status(r))
        if (sts.includes('ok')) continue
        const bad = c.any_present.filter((_, i) => sts[i] === 'unparseable')
        if (bad.length) return unknown('UNPARSEABLE', bad, `${bad.join(', ')} present but could not be read`)
        return { applies: false, detail: `none of ${c.any_present.join(', ')} is reported` }
      }
      if (c !== null && typeof c === 'object' && 'field' in c && 'present' in c) {
        // 2026-10-03 (T2): the field is reported. Absent (or only defaulted): the check does not apply. Unreadable: unknown.
        const st = scope.status(c.field)
        if (st === 'unparseable') return unknown('UNPARSEABLE', [c.field], `${c.field} is present but could not be read`)
        if (st !== 'ok') return { applies: false, detail: `${c.field} is not reported` }
        continue
      }
      if (c !== null && typeof c === 'object' && 'field' in c) {
        const s = scope.status(c.field)
        if (s === 'unparseable') return unknown('UNPARSEABLE', [c.field], `${c.field} is present but could not be read`)
        const b = lookup(c.field)
        if (!b || b.status !== 'ok') return unknown('FIELD_MISSING', [c.field], `${c.field} not reported`)
        const fold = (x: string): string => identifierKey(foldIdentifierText(x, v020))
        const vals = (b.ids ?? (b.strValue !== undefined ? [b.strValue] : b.value !== undefined ? [String(b.value)] : [])).map(fold)
        const isIn = 'in' in c
        const list = (isIn ? (c as { in: string[] }).in : (c as { not_in: string[] }).not_in).map(String)
        const set = new Set(list.map(fold))
        const holds = isIn ? vals.length > 0 && vals.every(v => set.has(v)) : !vals.some(v => set.has(v))
        if (!holds) {
          const shown = Array.isArray(b.original) ? b.original.map(String).join(', ') : String(b.original ?? vals.join(', '))
          return { applies: false, detail: `${c.field} ${isIn ? 'in' : 'not in'} [${list.join(', ')}] does not hold (${c.field} is "${shown}")` }
        }
        continue
      }
      const g = c as DeclCondition
      let refs: string[]
      try { refs = E.roleRefs(g.left, g.right).all } catch (e) { return unknown('OUT_OF_RULESET_SCOPE', [], `expression error: ${(e as Error).message}`) }
      // Engine 0.4.0: prev(R) on the first row (next(R) on the last) has no value, so the condition cannot be evaluated.
      const nn = v040 ? refs.find(r => scope.status(r) === 'no_neighbour') : undefined
      if (nn !== undefined) return unknown('OUT_OF_RULESET_SCOPE', [], `${noNeighbourText(nn)}, in "${g.left} ${g.op} ${g.right}"`)
      const unp = refs.filter(r => scope.status(r) === 'unparseable')
      if (unp.length) return unknown('UNPARSEABLE', unp, `${unp.join(', ')} present but could not be read`)
      const miss = refs.filter(r => scope.status(r) === 'missing')
      if (miss.length) return unknown('FIELD_MISSING', miss, `${miss.join(', ')} not reported`)
      let l: number | undefined, r: number | undefined
      try { l = E.evalExpr(g.left, env); r = E.evalExpr(g.right, env) } catch (e) { return unknown('OUT_OF_RULESET_SCOPE', [], `expression error: ${(e as Error).message}`) }
      if (l === undefined || r === undefined) return unknown('FIELD_MISSING', refs, `a value in "${g.left} ${g.op} ${g.right}" is absent`)
      if (!conditionHolds(l, g.op, r, g.tol ?? 0)) return { applies: false, detail: `${g.left} ${g.op} ${g.right} does not hold (${round4(l)} vs ${round4(r)})` }
    }
    return { applies: true }
  }
  /** A role whose value is money: an amount field, or a computed role made only of amounts (a unit price is not: it has more decimals). */
  const isMoneyRole = (r: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(r)) return false
    seen.add(r)
    const f = fieldSpec(r)
    if (f) return isAmountField(f)
    const formula = computedFormula.get(r)
    if (formula === undefined) return false
    const refs = E.referencedRoles(formula)
    return refs.length > 0 && refs.every(x => isMoneyRole(x, seen))
  }

  /**
   * The unread places of an operand, for fail_if_unreadable (2026-10-03): a list field's unresolved elements (when the list has any
   * element), a line field's unreadable value on this line (line scope) or on any line (document scope), a document field's
   * unreadable value. Each with its path, the value as reported (or null), and a sentence.
   */
  const unresolvedOperand = (role: string, prefix: string, lookup: (role: string) => Bound | undefined): { role: string; path: string; value: Value; what: string }[] => {
    const asValue = (b: Bound): Value => {
      if (b.unreadable?.raw === undefined) return null
      try { const v = JSON.parse(b.unreadable.raw) as unknown; return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : b.unreadable.raw } catch { return b.unreadable.raw }
    }
    const say = (path: string, b: Bound): string => (b.status === 'missing' ? `${path} is reported without a value` : `${path} was reported as ${b.unreadable?.raw ?? 'a value'} and could not be read`)
    const L = boundLists.get(role)
    if (L) {
      if (L.elems.length === 0) return []
      return L.elems.flatMap((e, j) => (e.status === 'ok' ? [] : [{ role, path: listAt(role, j, e.unreadable?.path ?? fieldSpec(role)?.paths[0]), value: asValue(e), what: say(listAt(role, j, e.unreadable?.path ?? fieldSpec(role)?.paths[0]), e) }]))
    }
    const li = /^line\[(\d+)\]$/.exec(prefix)
    if (li) { const b = lookup(role); return b?.status === 'unparseable' ? [{ role, path: `${lineKey ?? 'line_items'}[${li[1]}].${b.unreadable?.path ?? fieldSpec(role)?.paths[0] ?? role}`, value: asValue(b), what: say(`${lineKey ?? 'line_items'}[${li[1]}].${b.unreadable?.path ?? role}`, b) }] : [] }
    if (lineRoleNames.has(role)) return boundLines.flatMap((m, i) => { const b = m.get(role); return b?.status === 'unparseable' ? [{ role, path: `${lineKey ?? 'line_items'}[${i}].${b.unreadable?.path ?? role}`, value: asValue(b), what: say(`${lineKey ?? 'line_items'}[${i}].${b.unreadable?.path ?? role}`, b) }] : [] })
    const b = boundDoc.get(role)
    return b?.status === 'unparseable' ? [{ role, path: b.unreadable?.path ?? b.badPath ?? role, value: asValue(b), what: say(b.unreadable?.path ?? b.badPath ?? role, b) }] : []
  }

  /** Counsel from an advisory check (2026-10-03): what would have been a FAIL, said as advice. */
  const advisories: Advisory[] = []
  const advisoryOf = (chk: DeclCheck, c: ClaimVerdict): Advisory => {
    const ops = c.computation?.operands
    const usesLines = /\bsum\s*\(/.test(`${chk.left} ${chk.right}`) && lines.length > 0
    return {
      channel: 'COUNSEL', rule_id: chk.code, rule_name: chk.name ?? chk.code, claim_id: c.claim_id,
      detail: `${chk.field ?? chk.code}: ${String(ops?.left ?? '?')} ${chk.op} ${String(ops?.right ?? '?')} does not hold${usesLines ? ` (over ${lines.length} line${lines.length === 1 ? '' : 's'})` : ''}. Counsel, not a verdict: the ruleset reads this check as advice (advisory), so it changes no outcome and no gate.`,
      ...(c.computation ? { computation: c.computation } : {}),
    }
  }
  /** Run a check; an advisory check's claims are taken back out, and a FAIL among them becomes counsel. */
  const runAdvisable = (chk: DeclCheck, run: () => void): void => {
    const before = claims.length
    run()
    // Engine 0.4.0: remember which check (and row) made each claim, for the struck block and the remedies of the new forms.
    if (v040) for (const c of claims.slice(before)) { const li = lineOfPrefix(c.claim_id.split('.')[0] ?? ''); claimCheck.set(c, { chk, ...(li !== undefined ? { line: li } : {}) }) }
    if (chk.advisory !== true) return
    for (const c of claims.splice(before)) {
      inferred.delete(c)
      display.money.delete(c.claim_id)
      display.identifiers.delete(c.claim_id)
      if (c.outcome === 'FAIL') advisories.push(advisoryOf(chk, c))
    }
  }

  // ---- helper to build one check claim given an env, an evidence-gatherer, and a claim-id prefix
  const runCheck = (chk: DeclCheck, env: Env, prefix: string, gatherEvidence: (roles: string[]) => Evidence[], missingOf: (roles: string[]) => Insufficiency | null, scope: ScopeInfo, lookup: (role: string) => Bound | undefined): void => {
    const claim_id = `${prefix}.${chk.code}`
    const base = { claim_id, kind: 'RECOMPUTE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }

    // -2. Engine 0.5.0: a check that depends on a choice with no value abstains, whatever the data.
    if (v050) { const cg = choiceGate(chk); if (cg) return abstain(cg) }

    // -1. Applicability (added 2026-10-03): a check that does not apply to this document makes no claim.
    const ap = applicability(chk.applies_if, env, scope, lookup)
    if (ap.applies === false) { notApplicable.push({ claim_id, rule_id: chk.code, detail: `applies_if: ${ap.detail}` }); return }
    if (ap.applies === 'unknown') return abstain(ap.why)

    // 0. A declared abstention (added 2026-09-28) never decides, whatever the data.
    if (chk.abstain !== undefined) return abstain(declaredAbstention(chk.abstain))

    // 0b. fail_if_unreadable (2026-10-03): an unreadable operand the ruleset names FAILs the check, naming what was reported.
    if (chk.fail_if_unreadable?.length) {
      let named: string[] = []
      try { named = E.roleRefs(chk.left, chk.right, ...(chk.alternatives ?? []).flatMap(a => [a.left, a.right])).all.filter(r => chk.fail_if_unreadable!.includes(r)) } catch { named = [] }
      const items = named.flatMap(r => unresolvedOperand(r, prefix, lookup))
      if (items.length) {
        let leftV: number | undefined
        try { leftV = E.evalExpr(chk.left, env) } catch { leftV = undefined }
        let okRoles: string[] = []
        try { okRoles = E.roleRefs(chk.left, chk.right).all } catch { okRoles = [] }
        const ev: Evidence[] = [
          ...gatherEvidence(okRoles),
          ...items.map((it): Evidence => ({ locator: { kind: 'field', source: 'invoice', path: it.path }, value: it.value, confidence: 0, role: 'OPERAND', normalizations: ['unreadable'] })),
        ]
        claims.push({
          ...base, outcome: 'FAIL', asserted: leftV === undefined ? null : round4(leftV),
          computation: { formula: `${chk.left} ${chk.op} ${chk.right}`, operands: { unreadable: items.map(it => it.path) }, result: null },
          evidence: ev, locked: false,
          explanation: `${chk.code}: ${items.map(it => it.what).join('; ')}. The ruleset fails this check on an unreadable ${[...new Set(items.map(it => it.role))].join(', ')} instead of abstaining (fail_if_unreadable).`,
        })
        restsOn.set(claims[claims.length - 1]!, { roles: okRoles.filter(r => !named.includes(r)), ...(lineOfPrefix(prefix) !== undefined ? { line: lineOfPrefix(prefix) } : {}) })
        return
      }
    }

    // 1. The form to evaluate: the primary left/right, else the first alternative whose REQUIRED operands are present.
    //    With no alternatives and no `?`, this is exactly the old single missing-operand test.
    const forms = [{ left: chk.left, right: chk.right }, ...(chk.alternatives ?? [])]
    const multi = forms.length > 1
    const blockedBy = (refs: ReturnType<typeof roleRefs>): Insufficiency | null => {
      const m = missingOf(refs.required)
      if (strict) {
        // An unreadable optional term is an unresolved operand like a required one; name every one, after the required.
        const unpOpt = refs.optional.filter(o => scope.status(o) === 'unparseable')
        if (unpOpt.length && (!m || m.reason === 'UNPARSEABLE')) {
          const opt = unpOpt.map(o => unpDetail(o, lookup(o), `optional ${o} is present but could not be parsed as a number`))
          return { reason: 'UNPARSEABLE', detail: [...(m ? [m.detail] : []), ...opt].join('; '), missing: [...(m?.missing ?? []), ...unpOpt] }
        }
      }
      if (m) return m
      for (const o of refs.optional) if (scope.status(o) === 'unparseable') return { reason: 'UNPARSEABLE', detail: `optional ${o} is present but could not be parsed as a number`, missing: [o] }
      return null
    }
    let k = -1
    let refs = E.roleRefs(forms[0]!.left, forms[0]!.right)
    const blocks: { refs: ReturnType<typeof roleRefs>; why: Insufficiency }[] = []
    for (let i = 0; i < forms.length; i++) {
      const r = i === 0 ? refs : E.roleRefs(forms[i]!.left, forms[i]!.right)
      const why = blockedBy(r)
      if (!why) { k = i; refs = r; break }
      blocks.push({ refs: r, why })
    }
    if (k < 0) {
      if (!multi) return abstain(blocks[0]!.why)
      const unp = blocks.find(b => b.why.reason === 'UNPARSEABLE')
      if (unp) return abstain(unp.why)
      const lacks = blocks.map(b => b.refs.required.filter(x => { const s = scope.status(x); return s !== 'ok' && s !== 'defaulted' }))
      return abstain({ reason: 'FIELD_MISSING', detail: `no form of ${chk.code} has all its required operands (${lacks.map((l, i) => `form ${i + 1} lacks ${l.join(', ') || blocks[i]!.why.detail}`).join('; ')})`, missing: [...new Set(lacks.flat())] })
    }
    const form = forms[k]!
    const roles = refs.all
    // A form made only of optional terms, none of them reported, has nothing to check.
    if (refs.required.length === 0 && refs.optional.length > 0 && !refs.optional.some(o => scope.status(o) === 'ok')) {
      return abstain({ reason: 'FIELD_MISSING', detail: `none of the operands of ${chk.code} is reported (all are optional)`, missing: refs.optional })
    }

    // 2. Abstain guards.
    const g = guardInsufficiency(chk, env, scope)
    if (g) return abstain(g)

    // 3. Evaluate.
    let left: number | undefined, right: number | undefined
    // Engine 0.4.0: a function with no real value here (sqrt of a negative number) says so, instead of reading as an absent operand.
    const domainNotes: string[] = []
    const evalEnv: Env = v040 ? { ...env, domain: (n: string) => { domainNotes.push(n) } } : env
    try { left = E.evalExpr(form.left, evalEnv); right = E.evalExpr(form.right, evalEnv) }
    catch (e) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `expression error: ${(e as Error).message}` }, locked: false, explanation: `${chk.code}: bad expression` }); return }
    if ((left === undefined || right === undefined) && domainNotes.length) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `no value: ${domainNotes[0]} in "${left === undefined ? form.left : form.right}"` })
    if (left === undefined || right === undefined) { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency: { reason: 'FIELD_MISSING', detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` }); return }

    // 3b. Engine 0.5.0: a check that evaluates a model past its measured support is counsel, never PASS or FAIL.
    if (v050 && chk.support !== undefined) {
      const sp = supportOf(chk, env)
      if ('why' in sp) return abstain(sp.why)
      if (sp.value > sp.last) { beyondData++; advisories.push(beyondAdvisory(chk, claim_id, form, left, right, sp)); return }
    }

    // 4. Tolerance: the check's own floor, or the rounding-aware tolerance; or (exact_tolerance) the floor compared exactly.
    const exact = chk.exact_tolerance === true
    const infer = !exact && (chk.rounding ?? roundingDefault) === 'infer'
    const rt = infer ? roundingTolerance(scope.amounts(roles), policy.rel, policy.absCap, chk.tol ?? 0.01) : undefined
    const tol = rt ? rt.tol : chk.tol ?? 0.01
    let passed: boolean
    if (exact) {
      const d = round9(left - right)
      passed = chk.op === '=' ? Math.abs(d) <= tol : chk.op === '<=' ? d <= tol : chk.op === '>=' ? d >= -tol : Math.abs(d) > tol
    } else if (chk.op === '=') passed = Math.abs(left - right) <= tol
    else if (chk.op === '<=') passed = left <= right + tol
    else if (chk.op === '>=') passed = left >= right - tol
    else passed = Math.abs(left - right) > tol // !=
    const evidence = gatherEvidence(roles)
    const absentOptional = refs.optional.filter(o => scope.status(o) !== 'ok')
    const notes = [
      ...(multi ? [`Form ${k + 1} of ${forms.length}.`] : []),
      ...(absentOptional.length ? [`Optional terms not reported (counted as 0): ${absentOptional.join(', ')}.`] : []),
      ...(exact ? [`Tolerance ${tol}, compared exactly (the difference to 9 decimal places).`] : []),
      ...(rt ? [`Rounding-aware tolerance ${round4(rt.tol)} = max(${round4(policy.rel * 100)}% of the largest operand ${round4(rt.maxAbs)}, unit ${rt.unit ?? 'none'} × ${rt.n} operands${policy.absCap > 0 ? `; relative term capped at ${policy.absCap}` : ''}, floor ${chk.tol ?? 0.01})${passed && left !== right && chk.op === '=' ? ': the difference is treated as rounding, not error' : ''}.`] : []),
    ]
    const claim: ClaimVerdict = {
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: round4(left),
      computation: { formula: `${form.left} ${chk.op} ${form.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right), tolerance: rt ? { abs: round4(rt.tol), rel: policy.rel } : { abs: tol } },
      evidence, locked: !passed, explanation: `${chk.field ?? chk.code}: ${round4(left)} ${chk.op} ${round4(right)} — ${passed ? 'holds' : 'does not hold'}.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      ...(passed ? {} : { variance: round4(left - right) }),
    }
    claims.push(claim)
    restsOn.set(claim, { roles, ...(lineOfPrefix(prefix) !== undefined ? { line: lineOfPrefix(prefix) } : {}) })
    if (rt || exact) inferred.add(claim)
    if (roles.length > 0 && roles.every(r => isMoneyRole(r))) display.money.add(claim_id)
  }

  let restsOnNext: { roles: string[]; line?: number } | undefined
  // ---- an identifier check (compare: 'identifier'): two NAMED identifier fields, compared as normalised id sets
  const runIdentifierCheck = (chk: DeclCheck, prefix: string, scope: 'document' | 'line', lookup: (role: string) => Bound | undefined, env: Env, info: ScopeInfo): void => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: 'CROSS_REFERENCE' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }
    if (v050) { const cg = choiceGate(chk); if (cg) return abstain(cg) } // engine 0.5.0: the choice gate
    const ap = applicability(chk.applies_if, env, info, lookup)
    if (ap.applies === false) { notApplicable.push({ claim_id: base.claim_id, rule_id: chk.code, detail: `applies_if: ${ap.detail}` }); return }
    if (ap.applies === 'unknown') return abstain(ap.why)
    if (chk.abstain !== undefined) return abstain(declaredAbstention(chk.abstain))
    let L = String(chk.left ?? '').trim(), R = String(chk.right ?? '').trim()
    if (chk.op !== '=' && chk.op !== '!=') return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `identifier checks support only = and != (got ${chk.op})` })
    if (chk.rounding !== undefined) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'rounding applies to numeric checks only, not to an identifier check' })
    // 2026-10-03 (T2): alternatives on an identifier check: the first form whose two fields are both reported is compared
    // (chosen by what is present, never by which one passes); a form with an unreadable side blocks only itself. Without
    // alternatives nothing here runs, so every identifier check that existed before keeps its bytes.
    let formNote = ''
    if (chk.alternatives !== undefined) {
      const forms = [{ left: L, right: R }, ...(Array.isArray(chk.alternatives) ? chk.alternatives : []).map(a => ({ left: String(a?.left ?? '').trim(), right: String(a?.right ?? '').trim() }))]
      const st = (r: string): 'ok' | 'defaulted' | 'missing' | 'unparseable' | 'no_neighbour' => info.status(r)
      const k = forms.findIndex(f => st(f.left) === 'ok' && st(f.right) === 'ok')
      if (k < 0) {
        const unp = [...new Set(forms.flatMap(f => [f.left, f.right]).filter(r => st(r) === 'unparseable'))]
        if (unp.length) return abstain({ reason: 'UNPARSEABLE', detail: unp.map(r => unpDetail(r, lookup(r), `${r} is present but is not an identifier or a list of identifiers`)).join('; '), missing: unp })
        const lacks = forms.map(f => [f.left, f.right].filter(r => st(r) !== 'ok'))
        return abstain({ reason: 'FIELD_MISSING', detail: `no form of ${chk.code} has both its fields reported (${lacks.map((l, i) => `form ${i + 1} lacks ${[...new Set(l)].join(', ')}`).join('; ')})`, missing: [...new Set(lacks.flat())] })
      }
      L = forms[k]!.left; R = forms[k]!.right
      formNote = ` Form ${k + 1} of ${forms.length}.`
    }
    for (const r of [L, R]) {
      const f = Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : undefined
      if (!f || f.kind !== 'identifier' || !!f.line !== (scope === 'line')) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `"${r}" is not a ${scope}-level 'identifier' field (an identifier check names two identifier fields)` })
    }
    const bl = lookup(L), br = lookup(R)
    if (strict) { // name every unreadable side, with how it was unreadable
      const bad = [...new Set([L, R])].filter(r => lookup(r)?.status === 'unparseable')
      if (bad.length) return abstain({ reason: 'UNPARSEABLE', detail: bad.map(r => unpDetail(r, lookup(r), `${r} is present but is not an identifier or a list of identifiers`)).join('; '), missing: bad })
    }
    for (const [r, b] of [[L, bl], [R, br]] as const) if (b?.status === 'unparseable') return abstain({ reason: 'UNPARSEABLE', detail: `${r} is present but is not an identifier or a list of identifiers`, missing: [r] })
    for (const [r, b] of [[L, bl], [R, br]] as const) if (!b || b.status !== 'ok' || !b.ids) return abstain({ reason: 'FIELD_MISSING', detail: `${r} not present`, missing: [r] })
    const g = guardInsufficiency(chk, env, info)
    if (g) return abstain(g)
    const li = bl!.ids!, ri = br!.ids!
    const sameExact = li.length === ri.length && li.every(x => ri.includes(x))
    // 2026-10-03: compared by identifierKey, so punctuation alone never fails a match. The formula names the folding
    // only when it decided the claim, so every claim the old rule already decided keeps its bytes.
    const same = sameExact || sameIdentifiers(li, ri)
    const folded = same && !sameExact
    const passed = chk.op === '=' ? same : !same
    const show = (ids: string[]): string => (ids.length === 1 ? ids[0]! : `{${ids.join(', ')}}`)
    const asValue = (ids: string[]): Value => (ids.length === 1 ? ids[0]! : ids)
    display.identifiers.set(base.claim_id, { left: L, right: R, l: bl!, r: br! })
    restsOnNext = { roles: [L, R], ...(lineOfPrefix(prefix) !== undefined ? { line: lineOfPrefix(prefix) } : {}) }
    claims.push({
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: asValue(li),
      computation: { formula: `${L} ${chk.op} ${R} (identifier sets; whitespace removed, upper-cased${folded ? '; punctuation ignored except between digits' : ''})`, operands: { [L]: li, [R]: ri }, result: asValue(ri) },
      evidence: [fieldEvidence(L, bl!), fieldEvidence(R, br!)].filter((e): e is Evidence => e !== null),
      locked: !passed, explanation: `${chk.field ?? chk.code}: ${show(li)} ${chk.op} ${show(ri)} — ${passed ? 'holds' : 'does not hold'}.${formNote}`,
    })
    if (restsOnNext) { restsOn.set(claims[claims.length - 1]!, restsOnNext); restsOnNext = undefined }
  }

  // ---- a membership check (compare: 'member', 2026-10-03, T2): one NAMED identifier/string field and the codes it may take
  const runMemberCheck = (chk: DeclCheck, prefix: string, scope: 'document' | 'line', lookup: (role: string) => Bound | undefined, env: Env, info: ScopeInfo): void => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: 'CONSISTENCY' as const, tier: 'DETERMINISTIC' as const, field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code }
    const abstain = (insufficiency: Insufficiency): void => { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` }) }
    if (v050) { const cg = choiceGate(chk); if (cg) return abstain(cg) } // engine 0.5.0: the choice gate
    const ap = applicability(chk.applies_if, env, info, lookup)
    if (ap.applies === false) { notApplicable.push({ claim_id: base.claim_id, rule_id: chk.code, detail: `applies_if: ${ap.detail}` }); return }
    if (ap.applies === 'unknown') return abstain(ap.why)
    if (chk.abstain !== undefined) return abstain(declaredAbstention(chk.abstain))
    const L = String(chk.left ?? '').trim()
    const f = Object.prototype.hasOwnProperty.call(ruleset.fields, L) ? ruleset.fields[L] : undefined
    if (chk.op !== '=' && chk.op !== '!=') return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `member checks support only = and != (got ${chk.op})` })
    if (!f || (f.kind !== 'identifier' && f.kind !== 'string') || !!f.line !== (scope === 'line') || !Array.isArray(chk.in) || chk.in.length === 0) return abstain({ reason: 'OUT_OF_RULESET_SCOPE', detail: `"${L}" is not a ${scope}-level 'identifier' or 'string' field with a list of codes (a member check names one field and its codes)` })
    const b = lookup(L)
    if (b?.status === 'unparseable') return abstain({ reason: 'UNPARSEABLE', detail: strict ? unpDetail(L, b, `${L} is present but could not be read`) : `${L} is present but could not be read`, missing: [L] })
    if (!b || b.status !== 'ok') return abstain({ reason: 'FIELD_MISSING', detail: `${L} not present`, missing: [L] })
    const g = guardInsufficiency(chk, env, info)
    if (g) return abstain(g)
    // compared as a schematron code list compares: NFKC, format characters removed, whitespace collapsed and trimmed, case kept
    const codeOf = (x: string): string => x.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
    const raw = b.original
    const values = (Array.isArray(raw) ? raw : [raw]).map(x => (typeof x === 'number' && Number.isFinite(x) ? String(x) : typeof x === 'string' ? x : undefined))
    if (values.some(v => v === undefined)) return abstain({ reason: 'UNPARSEABLE', detail: `${L} is not a code or a list of codes`, missing: [L] })
    const codes = new Set(chk.in.map(codeOf))
    const vals = (values as string[]).map(codeOf).filter(v => v.length > 0)
    if (!vals.length) return abstain({ reason: 'FIELD_MISSING', detail: `${L} is blank`, missing: [L] })
    const member = (v: string): boolean => !v.includes(' ') && codes.has(v)
    const passed = chk.op === '=' ? vals.every(member) : !vals.some(member)
    const outside = vals.filter(v => !member(v))
    const shown = vals.length === 1 ? vals[0]! : `{${vals.join(', ')}}`
    claims.push({
      ...base, outcome: passed ? 'PASS' : 'FAIL', asserted: vals.length === 1 ? vals[0]! : vals,
      computation: { formula: `${L} ${chk.op === '=' ? 'in' : 'not in'} ${chk.right || 'the listed codes'} (${chk.in.length} code${chk.in.length === 1 ? '' : 's'}; whitespace collapsed, case kept)`, operands: { [L]: vals }, result: passed ? 1 : 0 },
      evidence: [fieldEvidence(L, b)].filter((e): e is Evidence => e !== null),
      locked: !passed,
      explanation: `${chk.field ?? chk.code}: ${shown} ${chk.op === '=' ? (passed ? 'is one of the listed codes' : `is not one of the ${chk.in.length} listed codes (${outside.join(', ')})`) : (passed ? 'is none of the listed codes' : 'is one of the codes it must not be')}.`,
    })
    restsOn.set(claims[claims.length - 1]!, { roles: [L], ...(lineOfPrefix(prefix) !== undefined ? { line: lineOfPrefix(prefix) } : {}) })
  }

  // ---- document-scope checks
  const docMissing = (roles: string[]): Insufficiency | null => {
    // Under distinguish_unreadable, EVERY unreadable operand is named (two unreadable totals that would cancel are both
    // the reason), each with how it was unreadable and where the source prints it.
    if (strict) {
      const bad: string[] = [], why: string[] = []
      for (const r of roles) {
        const L = boundLists.get(r)
        if (L) {
          const j = L.elems.findIndex(e => e.status === 'unparseable')
          if (j >= 0) { const e = L.elems[j]!; bad.push(r); why.push(e.unreadable ? `${listAt(r, j)}: ${unpDetail(r, e, '')}` : `${r} present but unparseable at ${listAt(r, j)}`) }
          continue
        }
        const b = boundDoc.get(r)
        if (b?.status === 'unparseable') { bad.push(r); why.push(unpDetail(r, b, `${r} is present but could not be parsed as a number`)); continue }
        if (!lineRoleNames.has(r)) continue
        const i = boundLines.findIndex(m => m.get(r)?.status === 'unparseable')
        if (i >= 0) { const lb = boundLines[i]!.get(r); bad.push(r); why.push(lb?.unreadable ? `line ${i}: ${unpDetail(r, lb, '')}` : `${r} present but unparseable on line ${i}`) }
      }
      if (bad.length) return { reason: 'UNPARSEABLE', detail: why.join('; '), missing: bad }
    }
    for (const r of roles) {
      const L = boundLists.get(r)
      if (L) { const j = L.elems.findIndex(e => e.status === 'unparseable'); if (j >= 0) return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable at ${listAt(r, j)}`, missing: [r] }; continue }
      const b = boundDoc.get(r)
      if (b && b.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} is present but could not be parsed as a number`, missing: [r] }
    }
    // Per-line roles referenced from a document check via sum(): unparseable if any line has the field present-but-bad.
    for (const r of roles) {
      if (!lineRoleNames.has(r)) continue
      for (let i = 0; i < boundLines.length; i++) { const b = boundLines[i]!.get(r); if (b?.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable on line ${i}`, missing: [r] } }
    }
    for (const r of roles) {
      const L = boundLists.get(r)
      if (L) {
        if (sumRole(r) !== undefined) continue
        const j = L.elems.findIndex(e => e.status !== 'ok')
        return { reason: 'FIELD_MISSING', detail: L.elems.length === 0 ? `${r}: no element of ${(fieldSpec(r)?.each ?? []).join(' / ')} was reported` : `${r} absent at ${listAt(r, j)}`, missing: [r] }
      }
      // Engine 0.5.0: a choice role says why it has no value (unstated, not applicable, or not a number)
      if (v050 && choiceRoles.has(r)) { if (docVars[r] === undefined) return choiceMissing(r); continue }
      // Engine 0.4.0: an algorithm role, and a computed role over the new forms, say why they have no value.
      if (algoRoles.has(r)) { const a = algoRoles.get(r)!.res; if (!a || a.status !== 'ok') return a?.why ?? { reason: 'FIELD_MISSING', detail: `algorithm role ${r} was not computed`, missing: [r] }; continue }
      if (computedFormula.has(r) && v040 && docVars[r] === undefined && computedNeedsWhy(r)) return computedWhy(r)
      if (computedFormula.has(r)) { if (docVars[r] === undefined) return { reason: 'FIELD_MISSING', detail: `computed ${r} could not be produced (an operand was absent)`, missing: [r] } ; continue }
      // A per-line role summed at document scope: missing if there are no lines or any line lacks it (a partial sum would lie).
      if (lineRoleNames.has(r)) { if (sumRole(r) === undefined) return { reason: 'FIELD_MISSING', detail: `${r} absent on one or more lines`, missing: [r] } ; continue }
      const b = boundDoc.get(r)
      if (!b || b.status === 'missing') return { reason: 'FIELD_MISSING', detail: `${r} not present on the document`, missing: [r] }
    }
    return null
  }
  const docEvidence = (roles: string[]): Evidence[] => {
    const out: Evidence[] = []; const seen = new Set<string>()
    const add = (e: Evidence | null) => { if (e) { const k = evidenceKey(e); if (!seen.has(k)) { seen.add(k); out.push(e) } } }
    for (const r of roles) {
      if (boundDoc.has(r)) add(fieldEvidence(r, boundDoc.get(r)!))
      else if (computedFormula.has(r) && docVars[r] !== undefined) add({ locator: { kind: 'field', source: 'computed', path: computedFormula.get(r)! }, value: round4(docVars[r] as number), confidence: 100, role: 'CONTEXT' })
      // Engine 0.4.0: an algorithm role is context: the procedure, pinned on the verdict (`algorithms`), and its output
      else if (algoRoles.has(r) && docVars[r] !== undefined) { const a = algoRoles.get(r)!; add({ locator: { kind: 'field', source: 'computed', path: `algorithm ${String(a.spec.algorithm)} (${a.output})` }, value: docVars[r] as number, confidence: 100, role: 'CONTEXT' }) }
      // Engine 0.5.0: a choice role is context: stated by the document (its fill), or supplied (by the judge or the ruleset)
      else if (v050 && choiceRoles.has(r) && docVars[r] !== undefined) add(choiceEvidence(r))
      // a per-line role referenced (via sum) contributes each line's field
      for (const m of boundLines) if (m.has(r)) add(fieldEvidence(r, m.get(r)!))
      // a list role contributes each element's field, at its path in the array
      const L = boundLists.get(r)
      if (L) L.elems.forEach((e, j) => add(fieldEvidence(r, isDefaulted(e) || e.path === undefined ? e : { ...e, path: listAt(r, j, e.path) })))
    }
    return out
  }
  // What the document scope knows about a role (optional terms, guards, rounding operands).
  const docScope: ScopeInfo = {
    status: r => {
      if (v050 && choiceRoles.has(r)) return docVars[r] === undefined ? 'missing' : 'ok'
      if (boundDoc.has(r)) return statusOf(boundDoc.get(r))
      if (algoRoles.has(r)) return docVars[r] === undefined ? 'missing' : 'ok'
      if (computedFormula.has(r)) return docVars[r] === undefined ? 'missing' : 'ok'
      const L = boundLists.get(r)
      if (L) { if (L.elems.some(e => e.status === 'unparseable')) return 'unparseable'; return sumRole(r) === undefined ? 'missing' : 'ok' }
      // Engine 0.2.0: a text line field (string / identifier) read at document scope by a guard is reported when any line reports it.
      const lk = fieldSpec(r)?.kind
      if (v020 && lineRoleNames.has(r) && (lk === 'string' || lk === 'identifier')) {
        if (boundLines.some(m => m.get(r)?.status === 'ok')) return 'ok'
        return boundLines.some(m => m.get(r)?.status === 'unparseable') ? 'unparseable' : 'missing'
      }
      if (lineRoleNames.has(r)) {
        for (const m of boundLines) if (m.get(r)?.status === 'unparseable') return 'unparseable'
        return sumRole(r) === undefined ? 'missing' : 'ok'
      }
      return 'missing'
    },
    where: r => boundDoc.get(r)?.path ?? computedFormula.get(r) ?? boundLists.get(r)?.key ?? (algoRoles.has(r) ? `algorithm ${String(algoRoles.get(r)!.spec.algorithm)}` : v050 && choiceRoles.has(r) ? `choices.${r}` : undefined),
    amounts: roles => {
      const out: number[] = []
      const seen = new Set<string>()
      const walk = (r: string): void => {
        if (seen.has(r)) return
        seen.add(r)
        const f = fieldSpec(r)
        const L = boundLists.get(r)
        if (f && L) { if (isAmountField(f)) for (const b of L.elems) if (b.status === 'ok' && b.value !== undefined && !isDefaulted(b)) out.push(b.value); return }
        if (f && !f.line) { const b = boundDoc.get(r); if (isAmountField(f) && b?.status === 'ok' && b.value !== undefined && !isDefaulted(b)) out.push(b.value); return }
        if (f && f.line) { if (isAmountField(f)) for (const m of boundLines) { const b = m.get(r); if (b?.status === 'ok' && b.value !== undefined && !isDefaulted(b)) out.push(b.value) } return }
        const formula = computedFormula.get(r)
        if (formula !== undefined && docVars[r] !== undefined) for (const x of E.referencedRoles(formula)) walk(x)
      }
      for (const r of roles) walk(r)
      return out
    },
  }
  const lineScope = (m: Map<string, Bound>): ScopeInfo => ({
    status: r => statusOf(m.get(r)),
    where: r => m.get(r)?.path,
    amounts: roles => roles.flatMap(r => { const b = m.get(r); return isAmountField(fieldSpec(r)) && b?.status === 'ok' && b.value !== undefined && !isDefaulted(b) ? [b.value] : [] }),
  })

  // ==== Engine 0.4.0 (2026-10-04): claims over tables ========================================================================
  // Aggregates over row sets, prev()/next()/doc. inside rows, line-computed roles that read document values, roles computed by
  // pinned algorithms. Everything here is read only under engine 0.4.0; under an earlier engine none of it runs, and for a ruleset
  // that uses none of the new forms every wrapper below delegates to the scope functions above, unchanged.
  const lineAbs = (i: number, rel?: string): string => `${lineKey ?? 'line_items'}[${i}]${rel ? `.${rel}` : ''}`
  const lineValue = (j: number, role: string): number | undefined => { const b = boundLines[j]?.get(role); return b && b.status === 'ok' ? b.value : undefined }
  const lineVarsOf = (m: Map<string, Bound>): Record<string, number | undefined> => { const v: Record<string, number | undefined> = {}; for (const [r, b] of m) v[r] = b.status === 'ok' ? b.value : undefined; return v }
  /** A row's env: its own roles, document values through doc., neighbours through prev()/next(); `notes` collects why a value is missing. */
  const lineEnvV040 = (i: number, notes?: string[]): Env => ({
    vars: lineVarsOf(boundLines[i]!), sum: () => undefined, agg: () => undefined,
    ref: (kind: RefKind, role: string) => {
      if (kind === 'doc') return docVars[role]
      const j = kind === 'prev' ? i - 1 : i + 1
      if (j < 0 || j >= boundLines.length) { notes?.push(noNeighbourText(`${kind}.${role}`, i)); return undefined }
      return lineValue(j, role)
    },
    ...(notes ? { domain: (n: string) => { notes.push(n) } } : {}),
  })
  const summ = (xs: string[]): string => (xs.length <= 3 ? xs.join('; ') : `${xs.slice(0, 3).join('; ')}; and ${xs.length - 3} more`)
  const okStatus = (s: ReturnType<typeof statusOf>): boolean => s === 'ok' || s === 'defaulted'
  /** One row's value of `role`, as a V040Result: the value, or why it has none. */
  const rowRole = (j: number, role: string): V040Result => {
    const b = boundLines[j]?.get(role)
    const st = statusOf(b)
    if (okStatus(st) && b!.value !== undefined && Number.isFinite(b!.value)) return { status: 'ok', value: b!.value, locs: [], rows: [j] }
    if (st === 'unparseable') return { status: 'unparseable', why: { reason: 'UNPARSEABLE', detail: `line ${j}: ${unpDetail(role, b, `${role} present but unparseable on line ${j}`)}`, missing: [role] }, locs: [{ role, line: j }], rows: [j] }
    if (b?.noValue) return { status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: b.noValue.startsWith('no_neighbour:') ? `${b.noValue} (${role} on line ${j} reads it)` : `${role} has no value on line ${j}: ${b.noValue}` }, locs: [], rows: [j] }
    return { status: 'missing', why: { reason: 'FIELD_MISSING', detail: `${role} not present on line ${j}`, missing: [role] }, locs: [{ role, line: j }], rows: [j] }
  }
  /** `doc.R` read from a row: the document's value of R, or why it has none. */
  const resolveDocRole = (role: string): V040Result => {
    const st = docScope.status(role)
    if (okStatus(st as ReturnType<typeof statusOf>) && docVars[role] !== undefined) return { status: 'ok', value: docVars[role], locs: [], rows: [] }
    const why = docMissing([role]) ?? { reason: 'FIELD_MISSING' as const, detail: `${role} has no numeric value on the document`, missing: [role] }
    return { status: why.reason === 'UNPARSEABLE' ? 'unparseable' : why.reason === 'OUT_OF_RULESET_SCOPE' ? 'novalue' : 'missing', why, locs: [{ role }], rows: [] }
  }
  /** Where the value behind an operand name sits (for the struck block): a role on a row, a document role, a list element. */
  const locsForName = (i: number | undefined, r: string): V040Loc[] => {
    const p = parseOperandName(r)
    if (!p) return i !== undefined && lineRoleNames.has(r) ? [{ role: r, line: i }] : [{ role: r }]
    if (p.kind === 'doc') return [{ role: p.role }]
    if (p.kind === 'prev' || p.kind === 'next') { if (i === undefined) return []; const j = p.kind === 'prev' ? i - 1 : i + 1; return j < 0 || j >= boundLines.length ? [] : [{ role: p.role, line: j }] }
    return aggregate(p.fn as AggFn, p.role, p.set).locs
  }
  /** Every value of `role` (a line or list role), on the rows of `set` (all rows without one), or why the selection is unknown. */
  const collect = (role: string, set: string | undefined, label: string): { early?: V040Result; vals: number[]; rows: number[]; locs: V040Loc[]; unp: string[]; miss: string[]; novalue: string[]; missRoles: Set<string> } => {
    const c = { vals: [] as number[], rows: [] as number[], locs: [] as V040Loc[], unp: [] as string[], miss: [] as string[], novalue: [] as string[], missRoles: new Set<string>([role]) }
    const early = (status: V040Result['status'], reason: Insufficiency['reason'], detail: string): typeof c & { early: V040Result } =>
      ({ ...c, early: { status, why: { reason, detail: `${label}: ${detail}`, ...(reason === 'OUT_OF_RULESET_SCOPE' ? {} : { missing: [role] }) }, locs: [], rows: [] } })
    const L = boundLists.get(role)
    if (L) {
      if (set !== undefined) return early('novalue', 'OUT_OF_RULESET_SCOPE', `a row set selects line rows, and ${role} is a list field`)
      if (L.key === undefined) return early('missing', 'FIELD_MISSING', `no element of ${(fieldSpec(role)?.each ?? []).join(' / ')} was reported`)
      L.elems.forEach((b, j) => {
        if (v050 && qcExcluded(b)) return // engine 0.5.0: struck or blanked by its quality flag: left out, the rest compute
        const st = statusOf(b)
        if (okStatus(st) && b.value !== undefined && Number.isFinite(b.value)) { c.vals.push(b.value); c.rows.push(j) }
        else if (st === 'unparseable') { c.unp.push(`${listAt(role, j)}: ${unpDetail(role, b, 'could not be read')}`); c.locs.push({ role, elem: j }) }
        else { c.miss.push(`${role} absent at ${listAt(role, j)}`); c.locs.push({ role, elem: j }) }
      })
      return c
    }
    if (!lineRoleNames.has(role)) return early('novalue', 'OUT_OF_RULESET_SCOPE', `${role} is not a line field, a line-computed role or a list field`)
    if (lineKey === undefined) return early('missing', 'FIELD_MISSING', `the line array (${lineKeys.join(' / ')}) is absent`)
    const sets = ruleset.row_sets !== null && typeof ruleset.row_sets === 'object' ? ruleset.row_sets : {}
    const conds = set === undefined ? undefined : Object.prototype.hasOwnProperty.call(sets, set) ? sets[set] : undefined
    if (set !== undefined && !Array.isArray(conds)) return early('novalue', 'OUT_OF_RULESET_SCOPE', `no row set named ${set} is declared`)
    for (let i = 0; i < boundLines.length; i++) {
      // engine 0.5.0: a row whose value its quality flag struck or blanked is left out; the rest compute
      if (v050 && qcExcluded(boundLines[i]!.get(role))) continue
      if (conds) {
        const m = boundLines[i]!
        const ap = applicability(conds, lineEnvV040(i), lineScopeV040(i), r => m.get(r))
        if (ap.applies === false) continue
        if (ap.applies === 'unknown') {
          const w = ap.why
          // engine 0.5.0: membership unknown only because a quality flag left the row's operand out: the row is left out too
          if (v050 && (w.missing ?? []).length > 0 && (w.missing ?? []).every(r => !parseOperandName(r) && qcExcluded(m.get(r)))) continue
          ;(w.reason === 'UNPARSEABLE' ? c.unp : w.reason === 'FIELD_MISSING' ? c.miss : c.novalue).push(`line ${i}: membership in ${set} is unknown (${w.detail})`)
          for (const r of w.missing ?? []) { const pr = parseOperandName(r); c.missRoles.add(pr ? pr.role : r); c.locs.push(...locsForName(i, r)) }
          continue
        }
      }
      const one = rowRole(i, role)
      if (one.status === 'ok') { c.vals.push(one.value as number); c.rows.push(i); continue }
      ;(one.status === 'unparseable' ? c.unp : one.status === 'missing' ? c.miss : c.novalue).push(one.why!.detail)
      c.locs.push(...one.locs)
    }
    return c
  }
  /** The account of a collected selection that did not resolve (UNPARSEABLE, then FIELD_MISSING, then no value), or undefined. */
  const unresolvedOf = (label: string, c: ReturnType<typeof collect>): V040Result | undefined => {
    const missing = [...c.missRoles]
    if (c.unp.length) return { status: 'unparseable', why: { reason: 'UNPARSEABLE', detail: `${label}: ${summ(c.unp)}`, missing }, locs: c.locs, rows: c.rows }
    if (c.miss.length) return { status: 'missing', why: { reason: 'FIELD_MISSING', detail: `${label}: ${summ(c.miss)}`, missing }, locs: c.locs, rows: c.rows }
    if (c.novalue.length) return { status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `${label}: ${summ(c.novalue)}` }, locs: c.locs, rows: c.rows }
    return undefined
  }
  const aggCache = new Map<string, V040Result>()
  /** An aggregate over a line or list role (on a row set's rows): computed whole, never from part of the rows. */
  function aggregate(fn: AggFn, role: string, set?: string): V040Result {
    const label = `${fn}(${role}${set !== undefined ? `, ${set}` : ''})`
    const key = `${fn}(${role}${set !== undefined ? `,${set}` : ''})`
    const hit = aggCache.get(key)
    if (hit) return hit
    const c = collect(role, set, label)
    let res: V040Result
    if (c.early) res = c.early
    else {
      const bad = unresolvedOf(label, c)
      if (bad) res = bad
      else if (fn === 'count') res = { status: 'ok', value: c.vals.length, locs: c.locs, rows: c.rows }
      else if (!c.vals.length) res = { status: 'missing', why: { reason: 'FIELD_MISSING', detail: `${label}: no row ${set !== undefined ? `of ${set} ` : ''}has a value to aggregate`, missing: [role] }, locs: c.locs, rows: c.rows }
      else {
        const v = c.vals
        let value: number
        if (fn === 'sum') { let acc = 0; for (const x of v) acc += x; value = round4(acc) }
        else if (fn === 'min') { let m = v[0]!; for (const x of v) if (x < m) m = x; value = round9v(m) }
        else if (fn === 'max') { let m = v[0]!; for (const x of v) if (x > m) m = x; value = round9v(m) }
        else { const s = [...v].sort((a, b) => a - b); const n = s.length; value = round9v(n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2) }
        res = Number.isFinite(value) ? { status: 'ok', value, locs: c.locs, rows: c.rows } : { status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `${label} is not a finite number` }, locs: c.locs, rows: c.rows }
      }
    }
    aggCache.set(key, res)
    return res
  }
  /** Engine 0.5.0: one run per procedure, inputs, parameters and rows (two roles that read two outputs of one fit share the fit). */
  const algoRuns = new Map<string, ReturnType<AlgorithmEntry['run']>>()
  /** An algorithm role: the pinned procedure run on its input series, or why it has no value. */
  const runAlgorithm =(role: string, a: { spec: DeclAlgorithm; entry?: AlgorithmEntry; output: string }): V040Result => {
    const ref = String(a.spec?.algorithm)
    const nv = (detail: string): V040Result => ({ status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `${role}: ${detail}` }, locs: [], rows: [] })
    if (!a.entry) { const later = resolveAlgorithm(ref); return nv(later?.since !== undefined ? `the algorithm ${ref} is carried from engine ${later.since} on; this verdict is made under engine ${engine_version}` : `the algorithm ${ref} is not in this build's registry`) }
    if (!a.entry.outputs.some(o => o.name === a.output)) return nv(`${ref} has no output "${a.output}" (it has ${a.entry.outputs.map(o => o.name).join(', ')})`)
    // Engine 0.5.0: the algorithm choice this role computes for, and the parameters, each from a choice slot
    const params: Record<string, string> = {}
    if (v050) {
      const link = a.spec?.choice
      if (typeof link === 'string') {
        const v = ledger.values.get(link)
        if (v === undefined) return nv(`choice_unstated: the algorithm choice ${link} has no value`)
        if (v !== ref) return nv(`choice_mismatch: the choice ${link} names ${JSON.stringify(v)} (${ledger.entries.find(e => e.id === link)?.status ?? '?'}), and this ruleset computes ${role} with ${ref}; the engine never computes another procedure in the document's name`)
      }
      for (const p of a.entry.params ?? []) {
        const slot = a.spec?.params !== null && typeof a.spec?.params === 'object' ? a.spec.params[p.name] : undefined
        if (typeof slot !== 'string') return nv(`${ref} takes its parameter "${p.name}" from a choice slot (params: { ${p.name}: SLOT }), and the ruleset names none`)
        const v = ledger.values.get(slot)
        if (v === undefined) return nv(`choice_unstated: the choice ${slot}, which gives ${ref} its parameter ${p.name}, has no value`)
        if (typeof v !== 'string' || !p.values.includes(v)) return nv(`the choice ${slot} gives ${ref} the parameter ${p.name} = ${JSON.stringify(v)}; ${ref} takes ${p.values.map(x => JSON.stringify(x)).join(' or ')}`)
        params[p.name] = v
      }
    }
    /** v050: each input's value by row, to align the series when a quality flag left a row out of one input */
    const byRow: Record<string, Map<number, number>> = {}
    const series: Record<string, number[]> = {}
    const all = { vals: [] as number[], rows: [] as number[], locs: [] as V040Loc[], unp: [] as string[], miss: [] as string[], novalue: [] as string[], missRoles: new Set<string>() }
    for (const inp of a.entry.inputs) {
      const r = a.spec?.inputs !== null && typeof a.spec?.inputs === 'object' ? a.spec.inputs[inp.name] : undefined
      if (typeof r !== 'string') return nv(`${ref} needs its input "${inp.name}" mapped to a line field or line-computed role`)
      const c = collect(r, undefined, `${role} (${ref}, ${inp.name} = ${r})`)
      if (c.early) return { ...c.early, why: c.early.why }
      series[inp.name] = c.vals
      if (v050) byRow[inp.name] = new Map(c.rows.map((row, k) => [row, c.vals[k]!]))
      all.unp.push(...c.unp); all.miss.push(...c.miss); all.novalue.push(...c.novalue); all.locs.push(...c.locs)
      for (const x of c.missRoles) all.missRoles.add(x)
      for (const x of c.rows) if (!all.rows.includes(x)) all.rows.push(x)
    }
    if (all.unp.length || all.miss.length || all.novalue.length) {
      // only the input roles that did not resolve are named
      const named = new Set<string>(all.locs.map(l => l.role))
      return unresolvedOf(`${role} (${ref})`, { ...all, missRoles: named.size ? named : all.missRoles })!
    }
    if (v050) {
      // A row a quality flag left out of one input is left out of every input, so the series stay row by row
      const inputs = a.entry.inputs.map(i => i.name)
      const first = byRow[inputs[0] ?? ''] ?? new Map<number, number>()
      const common = [...first.keys()].filter(row => inputs.every(n => byRow[n]?.has(row)))
      if (inputs.some(n => (byRow[n]?.size ?? 0) !== common.length)) {
        for (const n of inputs) series[n] = common.map(row => byRow[n]!.get(row)!)
        all.rows = common
      }
    }
    const key = v050 ? JSON.stringify([ref, a.spec?.inputs ?? null, params, all.rows]) : ''
    const out = v050 && algoRuns.has(key) ? algoRuns.get(key)! : a.entry.run(series, v050 ? params : undefined)
    if (v050) algoRuns.set(key, out)
    if (!out.ok) return nv(`${ref} returns no value: ${out.reason}`)
    const v = out.outputs[a.output]
    if (v === undefined || !Number.isFinite(v)) return nv(`${ref} returned no finite ${a.output}`)
    return { status: 'ok', value: round9v(v), locs: [], rows: all.rows }
  }
  /** A row's operand name, resolved: `doc.R`, `prev.R`, `next.R` (aggregates are document scope). */
  const resolveLine = (i: number, name: string): V040Result | undefined => {
    const p = parseOperandName(name)
    if (!p) return undefined
    if (p.kind === 'doc') return resolveDocRole(p.role)
    if (p.kind === 'prev' || p.kind === 'next') {
      const j = p.kind === 'prev' ? i - 1 : i + 1
      if (j < 0 || j >= boundLines.length) return { status: 'no_neighbour', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: noNeighbourText(name, i) }, locs: [], rows: [] }
      return rowRole(j, p.role)
    }
    return { status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `${name} is read at document scope (an aggregate is not available per row)` }, locs: [], rows: [] }
  }
  /** A document operand name, resolved: an aggregate (doc., prev() and next() are row forms; read here for safety). */
  const resolveDoc = (name: string): V040Result => {
    const p = parseOperandName(name)!
    if (p.kind === 'agg') return aggregate(p.fn as AggFn, p.role, p.set)
    if (p.kind === 'doc') return resolveDocRole(p.role)
    return { status: 'novalue', why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `${name} is read on a row, not at document scope` }, locs: [], rows: [] }
  }
  const scopeStatusOf = (r: V040Result): 'ok' | 'missing' | 'unparseable' | 'no_neighbour' => (r.status === 'ok' ? 'ok' : r.status === 'unparseable' ? 'unparseable' : r.status === 'no_neighbour' ? 'no_neighbour' : 'missing')
  function lineScopeV040(i: number): ScopeInfo {
    const m = boundLines[i]!
    const base = lineScope(m)
    return {
      status: r => { const res = resolveLine(i, r); return res ? scopeStatusOf(res) : base.status(r) },
      where: r => (parseOperandName(r) ? undefined : base.where(r)),
      amounts: roles => base.amounts(roles.filter(r => !parseOperandName(r))),
      neighbours: { prev: i > 0, next: i < boundLines.length - 1 },
    }
  }
  const docScopeV040: ScopeInfo = {
    status: r => (parseOperandName(r) ? scopeStatusOf(resolveDoc(r)) : docScope.status(r)),
    where: r => (parseOperandName(r) ? undefined : docScope.where(r)),
    amounts: roles => docScope.amounts(roles.filter(r => !parseOperandName(r))),
  }
  /** UNPARSEABLE from the real roles and the resolved names together: every unreadable operand named. */
  const mergeUnp = (fromReal: Insufficiency | null, unp: V040Result[]): Insufficiency => ({
    reason: 'UNPARSEABLE',
    detail: [...(fromReal?.reason === 'UNPARSEABLE' ? [fromReal.detail] : []), ...unp.map(u => u.why!.detail)].join('; '),
    missing: [...new Set([...(fromReal?.reason === 'UNPARSEABLE' ? fromReal.missing ?? [] : []), ...unp.flatMap(u => u.why!.missing ?? [])])],
  })
  const docMissingV040 = (roles: string[]): Insufficiency | null => {
    const syn = roles.filter(r => parseOperandName(r))
    if (!syn.length) return docMissing(roles)
    const real = roles.filter(r => !parseOperandName(r))
    const res = syn.map(resolveDoc)
    const fromReal = real.length ? docMissing(real) : null
    const unp = res.filter(r => r.status === 'unparseable')
    if (unp.length || fromReal?.reason === 'UNPARSEABLE') return mergeUnp(fromReal, unp)
    if (fromReal) return fromReal
    return (res.find(r => r.status === 'missing') ?? res.find(r => r.status !== 'ok'))?.why ?? null
  }
  const lineMissingV040 = (i: number, orig: (roles: string[]) => Insufficiency | null) => (roles: string[]): Insufficiency | null => {
    const syn = roles.filter(r => parseOperandName(r))
    const real = roles.filter(r => !parseOperandName(r))
    const res = syn.map(r => resolveLine(i, r)!)
    const nn = res.find(r => r.status === 'no_neighbour')
    if (nn) return nn.why!
    let fromReal = real.length ? orig(real) : null
    if (fromReal?.reason === 'FIELD_MISSING') {
      // a line-computed role with no value (a domain note, or no neighbour) says why, unless an operand is truly absent
      const absent = real.filter(r => { const b = boundLines[i]!.get(r); return !b || b.status === 'missing' })
      const noValue = absent.filter(r => boundLines[i]!.get(r)?.noValue !== undefined)
      if (absent.length && noValue.length === absent.length) fromReal = rowRole(i, noValue[0]!).why!
    }
    const unp = res.filter(r => r.status === 'unparseable')
    if (unp.length || fromReal?.reason === 'UNPARSEABLE') return mergeUnp(fromReal, unp)
    if (fromReal) return fromReal
    return (res.find(r => r.status === 'missing') ?? res.find(r => r.status !== 'ok'))?.why ?? null
  }
  /** One row's field as evidence at its absolute path (a line-computed value as context). */
  const rowEvidence = (role: string, i: number): Evidence | null => {
    const b = boundLines[i]?.get(role)
    if (!b || b.status !== 'ok') return null
    if (b.path?.startsWith('line_computed(')) return b.value === undefined ? null : { locator: { kind: 'field', source: 'computed', path: `${lineAbs(i)}.${role}` }, value: b.value, confidence: 100, role: 'CONTEXT' }
    const e = fieldEvidence(role, b)
    return e && !isDefaulted(b) && b.path !== undefined ? { ...e, locator: { kind: 'field', source: 'invoice', path: lineAbs(i, b.path) } } : e
  }
  const listEvidence = (role: string, j: number): Evidence | null => {
    const b = boundLists.get(role)?.elems[j]
    if (!b) return null
    return fieldEvidence(role, isDefaulted(b) || b.path === undefined ? b : { ...b, path: listAt(role, j, b.path) })
  }
  const pushUnique = (out: Evidence[], e: Evidence | null): void => { if (e && !out.some(x => evidenceKey(x) === evidenceKey(e))) out.push(e) }
  const docEvidenceV040 = (roles: string[]): Evidence[] => {
    const out = docEvidence(roles.filter(r => !parseOperandName(r)))
    for (const r of roles) {
      const p = parseOperandName(r)
      if (!p || p.kind !== 'agg') continue
      const res = aggregate(p.fn as AggFn, p.role, p.set)
      for (const j of res.rows) pushUnique(out, boundLists.has(p.role) ? listEvidence(p.role, j) : rowEvidence(p.role, j))
    }
    return out
  }
  const lineEvidenceV040 = (i: number, orig: (roles: string[]) => Evidence[]) => (roles: string[]): Evidence[] => {
    const out = orig(roles.filter(r => !parseOperandName(r)))
    for (const r of roles) {
      const p = parseOperandName(r)
      if (!p) continue
      if (p.kind === 'doc') for (const e of docEvidence([p.role])) pushUnique(out, e)
      else if (p.kind === 'prev' || p.kind === 'next') pushUnique(out, rowEvidence(p.role, p.kind === 'prev' ? i - 1 : i + 1))
    }
    return out
  }
  /** Line-computed roles that read a computed or algorithm role through doc. (or such a role): evaluated after the computed roles. */
  const lateLineComputed = (): Set<string> => {
    const late = new Set<string>()
    for (const [role, f] of Object.entries(ruleset.line_computed ?? {})) {
      let refs: OperandRef[] = []
      try { refs = operandRefs(f) } catch { refs = [] }
      if (refs.some(r => (r.kind === 'doc' && (computedFormula.has(r.role) || algoRoles.has(r.role))) || (r.kind !== 'doc' && r.kind !== 'agg' && late.has(r.role)))) late.add(role)
    }
    return late
  }
  /** A line-computed role over every row (0.4.0: role by role, so prev()/next() of an earlier role and doc. are known). */
  const evalLineComputed = (role: string, formula: string): void => {
    let refs: OperandRef[] = []
    try { refs = operandRefs(formula) } catch { refs = [] }
    boundLines.forEach((m, i) => {
      const statusAt = (r: OperandRef): string => (r.kind === 'doc' ? docScope.status(r.role)
        : r.kind === 'prev' ? (i > 0 ? statusOf(boundLines[i - 1]!.get(r.role)) : 'no_neighbour')
          : r.kind === 'next' ? (i < boundLines.length - 1 ? statusOf(boundLines[i + 1]!.get(r.role)) : 'no_neighbour')
            : statusOf(m.get(r.role)))
      // engine 0.5.0: a role that reads this row's value its quality flag struck or blanked is left out of aggregates likewise
      if (v050) {
        const same = refs.filter(r => r.kind === 'role').map(r => m.get(r.role))
        if (same.some(b => b?.qc?.action === 'struck')) { m.set(role, { status: 'unparseable', confidence: 0, qc: { action: 'struck' } }); return }
        if (same.some(b => b?.qc?.action === 'absent')) { m.set(role, { status: 'missing', confidence: 0, qc: { action: 'absent' } }); return }
      }
      // an unreadable operand, optional ones included, makes the role unknown (an optional term never reads an unknown as 0)
      const unreadable = refs.some(r => statusAt(r) === 'unparseable')
      const notes: string[] = []
      let value: number | undefined
      try { value = unreadable ? undefined : evalExprV040(formula, lineEnvV040(i, notes)) } catch { value = undefined }
      if (value !== undefined && Number.isFinite(value)) m.set(role, { status: 'ok', value, path: `line_computed(${role})`, confidence: 100 })
      else m.set(role, { status: unreadable ? 'unparseable' : 'missing', confidence: 0, ...(!unreadable && notes.length ? { noValue: notes[0] } : {}) })
    })
  }
  /** Why a computed role that reads the new forms has no value. */
  const computedNotes = new Map<string, string>()
  const computedNeedsWhy = (role: string): boolean => {
    const f = computedFormula.get(role)
    if (f === undefined) return false
    if (computedNotes.has(role)) return true
    try { return operandRefs(f).some(r => r.kind === 'agg' || r.kind === 'doc' || algoRoles.has(r.role) || (computedFormula.has(r.role) && r.role !== role && computedNeedsWhy(r.role))) } catch { return false }
  }
  const computedWhy = (role: string): Insufficiency => {
    const f = computedFormula.get(role) ?? ''
    const prefix = (w: Insufficiency): Insufficiency => ({ ...w, detail: `computed ${role} could not be produced: ${w.detail}`, ...(w.reason === 'OUT_OF_RULESET_SCOPE' ? {} : { missing: [role] }) })
    let refs: OperandRef[] = []
    try { refs = operandRefs(f) } catch { refs = [] }
    for (const r of refs) {
      if (r.kind === 'agg') { const a = aggregate(r.fn as AggFn, r.role, r.set); if (a.status !== 'ok') return prefix(a.why!); continue }
      if (r.kind === 'doc' || r.kind === 'prev' || r.kind === 'next') continue
      if (r.optional) continue
      const w = docMissing([r.role])
      if (w) return prefix(w)
    }
    const note = computedNotes.get(role)
    if (note !== undefined) return { reason: 'OUT_OF_RULESET_SCOPE', detail: `computed ${role} has no value: ${note}` }
    return { reason: 'FIELD_MISSING', detail: `computed ${role} could not be produced (an operand was absent)`, missing: [role] }
  }
  if (v040) {
    docEnv.agg = (fn: AggFn, role: string, set?: string) => { const r = aggregate(fn, role, set); return r.status === 'ok' ? r.value : undefined }
    docEnv.ref = (kind: RefKind, role: string) => (kind === 'doc' ? docVars[role] : undefined)
    const late = lateLineComputed()
    for (const [role, f] of Object.entries(ruleset.line_computed ?? {})) if (!late.has(role)) evalLineComputed(role, f)
    aggCache.clear()
    for (const [role, a] of algoRoles) { a.res = runAlgorithm(role, a); docVars[role] = a.res.status === 'ok' ? a.res.value : undefined }
    for (const [role, formula] of Object.entries(ruleset.computed ?? {})) {
      const notes: string[] = []
      docVars[role] = evalExprV040(formula, { ...docEnv, domain: (n: string) => { notes.push(n) } })
      if (docVars[role] === undefined && notes.length) computedNotes.set(role, notes[0]!)
    }
    for (const [role, f] of Object.entries(ruleset.line_computed ?? {})) if (late.has(role)) evalLineComputed(role, f)
    aggCache.clear()
  }
  /** v040: the check a claim came from, and its row, for the struck block and the remedies (filled by runAdvisable). */
  const claimCheck = new Map<ClaimVerdict, { chk: DeclCheck; line?: number }>()
  /** The expressions of a check: its sides, its alternatives, its guards' and numeric conditions' sides. */
  const checkExprs = (chk: DeclCheck): string[] => [
    chk.left, chk.right, ...(chk.alternatives ?? []).flatMap(a => [a.left, a.right]),
    ...(chk.abstain_if ?? []).flatMap(g => [g.left, g.right]),
    ...(chk.applies_if ?? []).flatMap(g => (g && typeof g === 'object' && 'left' in g ? [(g as DeclCondition).left, (g as DeclCondition).right] : [])),
  ].filter((e): e is string => typeof e === 'string')
  // ---- Engine 0.5.0: which choices a check depends on, the gate, and the measured support of a model check ----------------
  const depMemo = new Map<string, Set<string>>()
  /** The choice slots a role rests on: itself (a choice role), its formula's, an algorithm's inputs, choice link and parameters. */
  const depsOfRole = (role: string, seen: Set<string>): Set<string> => {
    if (choiceRoles.has(role)) return new Set([role])
    const hit = depMemo.get(role)
    if (hit) return hit
    const out = new Set<string>()
    if (seen.has(role)) return out
    seen.add(role)
    const formula = computedFormula.get(role) ?? (own(ruleset.line_computed, role) ? ruleset.line_computed![role] : undefined)
    if (typeof formula === 'string') for (const x of depsOfExpr(formula, seen)) out.add(x)
    const a = algoRoles.get(role)
    if (a) {
      for (const r of Object.values(isRec(a.spec?.inputs) ? a.spec.inputs : {})) if (typeof r === 'string') for (const x of depsOfRole(r, seen)) out.add(x)
      if (typeof a.spec?.choice === 'string' && ledger.kinds.has(a.spec.choice)) out.add(a.spec.choice)
      for (const s of Object.values(isRec(a.spec?.params) ? a.spec.params : {})) if (typeof s === 'string' && ledger.kinds.has(s)) out.add(s)
    }
    depMemo.set(role, out)
    return out
  }
  const depsOfConds = (conds: unknown, seen: Set<string>): Set<string> => {
    const out = new Set<string>()
    for (const c of Array.isArray(conds) ? conds : []) if (isRec(c) && typeof c.left === 'string' && typeof c.right === 'string') for (const e of [c.left, c.right]) for (const x of depsOfExpr(e, seen)) out.add(x)
    return out
  }
  function depsOfExpr(expr: string, seen: Set<string>): Set<string> {
    const out = new Set<string>()
    let refs: OperandRef[] = []
    try { refs = operandRefs(expr) } catch { return out }
    for (const r of refs) {
      for (const x of depsOfRole(r.role, new Set(seen))) out.add(x)
      if (r.kind === 'agg' && r.set !== undefined && isRec(ruleset.row_sets)) for (const x of depsOfConds(ruleset.row_sets[r.set], new Set(seen))) out.add(x)
    }
    return out
  }
  /** The choice slots a check depends on, in the ledger's order: its expressions, conditions, row sets, support, and `governs`. */
  const choiceDeps = (chk: DeclCheck): string[] => {
    const out = new Set<string>()
    for (const e of checkExprs(chk)) for (const x of depsOfExpr(e, new Set())) out.add(x)
    if (isRec(chk.support)) for (const e of [chk.support.field, chk.support.max_of]) if (typeof e === 'string') for (const x of depsOfExpr(e, new Set())) out.add(x)
    for (const s of Array.isArray(ruleset.choices) ? ruleset.choices : []) if (isRec(s) && Array.isArray(s.governs) && s.governs.includes(chk.code) && ledger.kinds.has(s.id)) out.add(s.id)
    const order = [...ledger.kinds.keys()]
    return [...out].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
  /** THE GATE (0.5.0): a check that depends on a choice with no value abstains before anything else (`choice_unstated:`). */
  const choiceGate = (chk: DeclCheck): Insufficiency | null => {
    if (!v050 || ledger.kinds.size === 0) return null
    const blocked = choiceDeps(chk).filter(id => ledger.values.get(id) === undefined)
    if (!blocked.length) return null
    const say = (id: string): string => {
      const e = ledger.entries.find(x => x.id === id)
      return e?.status === 'not_applicable' ? `${id} (${e.kind}), which the ruleset declares not applicable here` : `${id} (${e?.kind ?? '?'}), which the document does not state and nobody supplies (the ruleset gives no default)`
    }
    return { reason: 'FIELD_MISSING', detail: `choice_unstated: this check depends on the choice ${blocked.map(say).join(' and on ')}. The engine never supplies a choice the ruleset does not declare: the document states it with a quoted span, or the judge supplies it`, missing: blocked }
  }
  /** The measured support of a model check (0.5.0): the point the model is evaluated at, and the largest measured value. */
  const supportOf = (chk: DeclCheck, env: Env): { value: number; last: number } | { why: Insufficiency } => {
    const s = chk.support
    if (!isRec(s) || typeof s.field !== 'string' || typeof s.max_of !== 'string') return { why: { reason: 'OUT_OF_RULESET_SCOPE', detail: 'support: a check\'s support is { field, max_of }' } }
    let v: number | undefined
    try { v = E.evalExpr(s.field, env) } catch (e) { return { why: { reason: 'OUT_OF_RULESET_SCOPE', detail: `support: expression error in "${s.field}": ${(e as Error).message}` } } }
    if (v === undefined) return { why: { reason: 'FIELD_MISSING', detail: `support: ${s.field} has no value here, so the engine cannot tell whether the point lies inside the measured support`, missing: underlyingRoles(s.field) } }
    const m = aggregate('max', s.max_of)
    if (m.status !== 'ok' || m.value === undefined) return { why: { reason: m.why?.reason ?? 'FIELD_MISSING', detail: `support: the measured support ${s.max_of} has no largest value (${m.why?.detail ?? 'no row has a value'})`, ...(m.why?.missing ? { missing: m.why.missing } : {}) } }
    return { value: v, last: m.value }
  }
  /** A model check evaluated past its support: counsel with `beyond_data`, the computed values and the two support numbers. */
  const beyondAdvisory = (chk: DeclCheck, claim_id: string, form: { left: string; right: string }, left: number, right: number, sp: { value: number; last: number }): Advisory => ({
    channel: 'COUNSEL', rule_id: chk.code, rule_name: chk.name ?? chk.code, claim_id,
    detail: `${chk.field ?? chk.code}: past the data. The check evaluates its model at ${chk.support!.field} = ${round4(sp.value)}, beyond the last measured ${chk.support!.max_of} (${round4(sp.last)}), so ${round4(left)} ${chk.op} ${round4(right)} is the model's number, not the data's. Counsel, never a verdict: the engine does not decide a quantity computed past its measured support.`,
    computation: { formula: `${form.left} ${chk.op} ${form.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right) },
    beyond_data: true,
    support: { field: chk.support!.field, value: round9(sp.value), max_of: chk.support!.max_of, last: round9(sp.last) },
  })
  /** v040: where a claim's unresolved values sit, when its check reads a new form; undefined otherwise (the 0.3.0 reading applies). */
  const claimLocsV040 = (c: ClaimVerdict): V040Loc[] | undefined => {
    const cc = claimCheck.get(c)
    if (!cc || c.outcome !== 'INSUFFICIENT_DATA' || cc.chk.compare === 'identifier' || cc.chk.compare === 'member') return undefined
    let refs: OperandRef[] = []
    try { refs = checkExprs(cc.chk).flatMap(e => operandRefs(e)) } catch { return undefined }
    if (!refs.some(r => r.kind === 'doc' || r.kind === 'prev' || r.kind === 'next' || r.kind === 'agg' || algoRoles.has(r.role) || (computedFormula.has(r.role) && computedNeedsWhy(r.role)))) return undefined
    const out: V040Loc[] = []
    for (const r of refs) {
      if (r.kind === 'role' || r.kind === 'sum') {
        if (algoRoles.has(r.role)) out.push(...(algoRoles.get(r.role)!.res?.locs ?? []))
        else out.push(cc.line !== undefined && lineRoleNames.has(r.role) && r.kind === 'role' ? { role: r.role, line: cc.line } : { role: r.role })
      } else out.push(...locsForName(cc.line, r.name))
    }
    return out
  }
  /** v040: the row (or list element) a claim's remedy should name for `role`: the first unresolved place of it. */
  const operandAtV040 = (c: ClaimVerdict, role: string): V040Loc | undefined => claimLocsV040(c)?.find(l => l.role === role && (l.line !== undefined || l.elem !== undefined))

  for (const chk of ruleset.checks.filter(c => (c.scope ?? 'document') === 'document')) {
    const dScope = v040 ? docScopeV040 : docScope
    runAdvisable(chk, () => {
      if (chk.compare === 'identifier') runIdentifierCheck(chk, 'document', 'document', r => boundDoc.get(r), docEnv, dScope)
      else if (chk.compare === 'member') runMemberCheck(chk, 'document', 'document', r => boundDoc.get(r), docEnv, dScope)
      else runCheck(chk, docEnv, 'document', v040 ? docEvidenceV040 : docEvidence, v040 ? docMissingV040 : docMissing, dScope, r => boundDoc.get(r))
    })
  }

  // ---- line-scope checks
  ruleset.checks.filter(c => c.scope === 'line').forEach(chk => {
    boundLines.forEach((m, i) => {
      const lineVars: Record<string, number | undefined> = {}
      for (const [role, b] of m) lineVars[role] = b.status === 'ok' ? b.value : undefined
      const env: Env = v040 ? lineEnvV040(i) : { vars: lineVars, sum: () => undefined }
      const lScope = v040 ? lineScopeV040(i) : lineScope(m)
      if (chk.compare === 'identifier') { runAdvisable(chk, () => runIdentifierCheck(chk, `line[${i}]`, 'line', r => m.get(r), env, lScope)); return }
      if (chk.compare === 'member') { runAdvisable(chk, () => runMemberCheck(chk, `line[${i}]`, 'line', r => m.get(r), env, lScope)); return }
      const missing = (roles: string[]): Insufficiency | null => {
        if (strict) { // name every unreadable operand of the line, with how it was unreadable
          const bad = roles.filter(r => m.get(r)?.status === 'unparseable')
          if (bad.length) return { reason: 'UNPARSEABLE', detail: bad.map(r => unpDetail(r, m.get(r), `${r} present but unparseable on line ${i}`)).join('; '), missing: bad }
        }
        for (const r of roles) { const b = m.get(r); if (b?.status === 'unparseable') return { reason: 'UNPARSEABLE', detail: `${r} present but unparseable on line ${i}`, missing: [r] } }
        for (const r of roles) { const b = m.get(r); if (!b || b.status === 'missing') return { reason: 'FIELD_MISSING', detail: `${r} not present on line ${i}`, missing: [r] } }
        return null
      }
      const ev = (roles: string[]): Evidence[] => { const out: Evidence[] = []; for (const r of roles) { const e = fieldEvidence(r, m.get(r) ?? { status: 'missing', confidence: 0 }); if (e) out.push(e) } return out }
      runAdvisable(chk, () => runCheck(chk, env, `line[${i}]`, v040 ? lineEvidenceV040(i, ev) : ev, v040 ? lineMissingV040(i, missing) : missing, lScope, r => m.get(r)))
    })
  })

  // The relative band applies to every numeric claim EXCEPT those decided under rounding inference (already final).
  applyTolerancePolicy(inferred.size ? claims.filter(c => !inferred.has(c)) : claims, policy)

  // ---- the source-text axis (added 2026-10-03): the ruleset's required passages, verbatim, plus the caller's own.
  const quoteRemedies = new Map<string, RuleRemedies | undefined>()
  if ((ruleset.quotes?.length ?? 0) > 0 || sourceGiven) {
    const prepared = sourceGiven ? prepareSource(src!.text) : undefined
    const sourceHash = sourceGiven ? sha256(src!.text) : ''
    const idOf = (raw: string): string => (raw.startsWith('source.') ? raw : `source.${raw}`)
    for (const q of ruleset.quotes ?? []) {
      const claim_id = idOf(q.id)
      const ap = applicability(q.applies_if, docEnv, docScope, r => boundDoc.get(r))
      if (ap.applies === false) { notApplicable.push({ claim_id, rule_id: 'QUOTE_MATCH', detail: `applies_if: ${ap.detail}` }); continue }
      if (q.remedy !== undefined) quoteRemedies.set(claim_id, normalizeDeclaration(q.remedy))
      const base = { claim_id, kind: 'QUOTE_MATCH' as const, tier: 'DETERMINISTIC' as const, field: q.label ?? q.id, asserted: q.quote, rule_id: 'QUOTE_MATCH', rule_name: 'Verbatim quotation' }
      if (ap.applies === 'unknown') { claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', locked: false, evidence: [], insufficiency: ap.why, explanation: `QUOTE_MATCH: ${ap.why.detail}` }); continue }
      if (!sourceGiven) {
        // A required passage nobody could look for is an open check, never a pass: the gate holds on it (PASS-WITH-OPEN).
        claims.push({ ...base, outcome: 'INSUFFICIENT_DATA', locked: false, evidence: [],
          insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: 'the ruleset requires this passage verbatim in the source document, and no source text was supplied (CLI --source; options.source.text)', missing: ['source'] },
          explanation: 'Could not look for the passage: no source text was supplied; abstaining.' })
        continue
      }
      claims.push(verifyQuote({ id: claim_id, quote: q.quote, label: q.label ?? q.id }, prepared!, sourceHash))
    }
    if (sourceGiven) {
      for (const q of src!.quotes ?? []) claims.push(verifyQuote({ ...q, id: idOf(q.id) }, prepared!, sourceHash))
      for (const v of src!.values ?? []) claims.push(verifyValueInText({ ...v, id: idOf(v.id) }, prepared!, sourceHash))
    }
  }

  // ---- HELD-SUSPECT (engine 0.2.0, red-team F7): a claim that could not run on values reported as unreadable strings is
  // re-evaluated under every reading of those strings one character away; if one FAILs it, the claim is held as suspect.
  if (v020 && !v030 && strict && ruleset.held_suspect !== false && !nested && !lowered) {
    type Loc = { role: string; path: string; raw: string; kind: DeclField['kind'] }
    const rawAt = (path: string): string | undefined => { const v = getPath(extraction, path); return typeof v === 'string' ? v : undefined }
    const numericKind = (k: DeclField['kind']): boolean => k === undefined || k === 'amount' || k === 'price' || k === 'quantity'
    const unreadableLoc = (role: string, b: Bound | undefined, abs: (rel: string) => string): Loc | undefined => {
      const u = b?.status === 'unparseable' ? b.unreadable : undefined
      if (!u || u.how !== 'unparseable' || u.path === undefined) return undefined
      const path = abs(u.path)
      const raw = rawAt(path)
      return raw === undefined ? undefined : { role, path, raw, kind: fieldSpec(role)?.kind }
    }
    const locsOf = (c: ClaimVerdict): Loc[] | undefined => {
      const missing = c.insufficiency?.missing ?? []
      if (!missing.length) return undefined
      const li = /^line\[(\d+)\]\./.exec(c.claim_id)
      const out: Loc[] = []
      for (const r of missing) {
        const f = fieldSpec(r)
        if (!f || !numericKind(f.kind)) return undefined
        if (li) { const loc = unreadableLoc(r, boundLines[Number(li[1])]?.get(r), rel => `${lineKey ?? 'line_items'}[${li[1]}].${rel}`); if (!loc) return undefined; out.push(loc); continue }
        const L = boundLists.get(r)
        if (L) {
          for (let j = 0; j < L.elems.length; j++) {
            const e = L.elems[j]!
            if (e.status === 'ok') continue
            const loc = unreadableLoc(r, e, rel => listAt(r, j, rel))
            if (!loc) return undefined
            out.push(loc)
          }
          continue
        }
        if (f.line) {
          for (let i = 0; i < boundLines.length; i++) {
            const b = boundLines[i]!.get(r)
            if (b?.status === 'ok') continue
            const loc = unreadableLoc(r, b, rel => `${lineKey ?? 'line_items'}[${i}].${rel}`)
            if (!loc) return undefined
            out.push(loc)
          }
          continue
        }
        const loc = unreadableLoc(r, boundDoc.get(r), rel => rel)
        if (!loc) return undefined
        out.push(loc)
      }
      return out.length ? out : undefined
    }
    const readValue = (t: string, kind: DeclField['kind']): number | undefined => {
      const r = readNumberTextV020(t, locale)
      const n = r ? normByKind(kind, r.canonical) : null
      return n ? n.value : undefined
    }
    const readingsOf = (raw: string, kind: DeclField['kind']): { text: string; value: number }[] => {
      const cs = [...raw]
      if (cs.length > SUSPECT_MAX_RAW) return []
      const seen = new Set<number>()
      const out: { text: string; value: number }[] = []
      const tryText = (t: string): void => {
        if (t === raw) return
        const v = readValue(t, kind)
        if (v === undefined || seen.has(v)) return
        seen.add(v)
        out.push({ text: t, value: v })
      }
      for (let i = 0; i < cs.length; i++) tryText(cs.slice(0, i).join('') + cs.slice(i + 1).join(''))
      for (let i = 0; i < cs.length; i++) for (const a of SUSPECT_ALPHABET) tryText(cs.slice(0, i).join('') + a + cs.slice(i + 1).join(''))
      for (let i = 0; i <= cs.length; i++) for (const a of SUSPECT_ALPHABET) tryText(cs.slice(0, i).join('') + a + cs.slice(i).join(''))
      return out
    }
    const groups = new Map<string, { locs: Loc[]; claims: ClaimVerdict[] }>()
    for (const c of claims) {
      if (c.outcome !== 'INSUFFICIENT_DATA' || c.insufficiency?.reason !== 'UNPARSEABLE') continue
      if (!c.claim_id.startsWith('document.') && !c.claim_id.startsWith('line[')) continue
      const locs = locsOf(c)
      if (!locs) continue
      const key = locs.map(l => l.path).join('\u0000')
      const g = groups.get(key) ?? { locs, claims: [] }
      g.claims.push(c)
      groups.set(key, g)
    }
    let budget = SUSPECT_BUDGET
    const nestedOptions: VerifyDeclarativeOptions = { ...options }
    delete nestedOptions.declared_accuracy
    for (const g of groups.values()) {
      const readings = g.locs.map(l => readingsOf(l.raw, l.kind))
      const total = readings.reduce((n, r) => n * r.length, 1)
      if (total === 0 || total > SUSPECT_MAX_COMBOS || total > budget) continue
      budget -= total
      const stats = new Map<ClaimVerdict, { failing: number; first?: { combo: { text: string; value: number }[]; nc: ClaimVerdict } }>()
      const combo: { text: string; value: number }[] = []
      const walk = (k: number): void => {
        if (k === readings.length) {
          const patched = structuredClone(input)
          combo.forEach((r, i) => setPath(patched, g.locs[i]!.path, r.text))
          let nv: Verdict
          try { nv = evaluateDeclarative(patched, ruleset, nestedOptions, true) } catch { return }
          for (const c of g.claims) {
            const st = stats.get(c) ?? { failing: 0 }
            const nc = nv.claims.find(x => x.claim_id === c.claim_id)
            if (nc?.outcome === 'FAIL') { st.failing++; st.first ??= { combo: [...combo], nc } }
            stats.set(c, st)
          }
          return
        }
        for (const r of readings[k]!) { combo.push(r); walk(k + 1); combo.pop() }
      }
      walk(0)
      for (const c of g.claims) {
        const st = stats.get(c)
        if (!st?.first) continue
        const { combo: first, nc } = st.first
        const left = nc.computation?.operands?.left ?? null
        const right = nc.computation?.operands?.right ?? null
        c.suspect = {
          reported: g.locs.map(l => ({ role: l.role, path: l.path, raw: l.raw })),
          reading: g.locs.map((l, i) => ({ role: l.role, path: l.path, read_as: first[i]!.text, value: first[i]!.value })),
          computed: { left, right }, readings_checked: total, readings_failing: st.failing,
        }
        const as = g.locs.map((l, i) => `${l.role} ${JSON.stringify(l.raw)} as ${JSON.stringify(first[i]!.text)}`).join(', ')
        const why = `held as suspect: read one character differently (${as}), ${nc.computation?.formula ?? c.rule_id} gives ${String(left)} against ${String(right)}, which does not hold; ${st.failing} of ${total} such readings fail it. The gate books it as a FAIL until a legible value is supplied`
        c.insufficiency = { ...c.insufficiency!, detail: `${c.insufficiency!.detail}; ${why}` }
        c.explanation = `${c.explanation} Held as suspect: a one-character reading of the unreadable value fails the check.`
      }
    }
  }

  // ---- Engine 0.3.0: strike and recompute. The claims are exactly as the evaluator made them (no HELD-SUSPECT booking);
  // the verdict adds what was computed, every struck load-bearing field with its provenance and why, and what each would unlock.
  // SUSPECT is a flag on a struck field (a one-reading-away candidate under which a check FAILs), counted, never a FAIL.
  let v030Blocks: Record<string, unknown> | undefined
  if (v030 && !nested) {
    type Loc = { key: string; field: string; role: string; path?: string; b: Bound; line?: number; elem?: number }
    const locOf = (role: string, b: Bound | undefined, line?: number, elem?: number): Loc | undefined => {
      if (!b || b.status !== 'unparseable') return undefined
      const rel = b.unreadable?.path ?? b.badPath
      const path = rel === undefined || rel === '' ? undefined : line !== undefined ? `${lineKey ?? 'line_items'}[${line}].${rel}` : elem !== undefined ? listAt(role, elem, rel) : rel
      const field = line !== undefined ? `${role}@line[${line}]` : elem !== undefined ? `${role}[${elem}]` : role
      return { key: path ?? `label:${field}`, field, role, ...(path !== undefined ? { path } : {}), b, ...(line !== undefined ? { line } : {}), ...(elem !== undefined ? { elem } : {}) }
    }
    const refsOf = (formula: string): string[] => { try { return E.referencedRoles(formula) } catch { return [] } }
    /** The unreadable places a role rests on: the role itself, or the operands of a computed / line-computed role. */
    const expand = (role: string, line: number | undefined, seen: Set<string> = new Set()): Loc[] => {
      const k = `${role}@${line ?? ''}`
      if (seen.has(k)) return []
      seen.add(k)
      // Engine 0.4.0: doc.R, prev(R), next(R), an aggregate (only the rows it waits on), an algorithm role (its unresolved inputs)
      if (v040) {
        const near = (x: V040Loc): Loc[] => expand(x.role, x.line, seen).filter(l => x.elem === undefined || l.elem === undefined || l.elem === x.elem)
        const p = parseOperandName(role)
        if (p?.kind === 'doc') return expand(p.role, undefined, seen)
        if (p?.kind === 'prev' || p?.kind === 'next') { if (line === undefined) return []; const j = p.kind === 'prev' ? line - 1 : line + 1; return j < 0 || j >= boundLines.length ? [] : expand(p.role, j, seen) }
        if (p?.kind === 'agg') return aggregate(p.fn as AggFn, p.role, p.set).locs.flatMap(near)
        const a = algoRoles.get(role)
        if (a) return (a.res?.locs ?? []).flatMap(near)
      }
      const L = boundLists.get(role)
      if (L) return L.elems.flatMap((e, j) => { const l = locOf(role, e, undefined, j); return l ? [l] : [] })
      if (line !== undefined) {
        const l = locOf(role, boundLines[line]?.get(role), line)
        if (l && boundLines[line]?.get(role)?.unreadable) return [l]
        const f = ruleset.line_computed?.[role]
        return f !== undefined ? refsOf(f).flatMap(r => expand(r, line, seen)) : l ? [l] : []
      }
      if (boundDoc.has(role)) { const l = locOf(role, boundDoc.get(role)); return l ? [l] : [] }
      const cf = computedFormula.get(role)
      if (cf !== undefined) return refsOf(cf).flatMap(r => expand(r, undefined, seen))
      if (lineRoleNames.has(role)) return boundLines.flatMap((_, i) => expand(role, i, new Set(seen)))
      return []
    }
    const locs = new Map<string, Loc>()
    const waits = new Map<string, string[]>()
    const claimLocs = new Map<ClaimVerdict, Loc[]>()
    for (const c of claims) {
      if (c.outcome !== 'INSUFFICIENT_DATA' || !c.insufficiency?.missing?.length) continue
      if (!c.claim_id.startsWith('document.') && !c.claim_id.startsWith('line[')) continue
      const li = /^line\[(\d+)\]\./.exec(c.claim_id)
      const mine = new Map<string, Loc>()
      // Engine 0.4.0: a claim whose check reads a new form waits on exactly the places its operands rest on (claimLocsV040)
      const ov = v040 ? claimLocsV040(c) : undefined
      if (ov) { for (const x of ov) for (const l of expand(x.role, x.line)) if (x.elem === undefined || l.elem === undefined || l.elem === x.elem) mine.set(l.key, l) }
      else for (const r of c.insufficiency.missing) for (const l of expand(r, li ? Number(li[1]) : undefined)) mine.set(l.key, l)
      if (!mine.size) continue
      claimLocs.set(c, [...mine.values()])
      for (const l of mine.values()) {
        locs.set(l.key, locs.get(l.key) ?? l)
        const w = waits.get(l.key) ?? []
        if (!w.includes(c.claim_id)) w.push(c.claim_id)
        waits.set(l.key, w)
      }
    }
    // SUSPECT: the candidates one reading away (a plain extraction: one character; an envelope: what its readers read), each
    // evaluated; a candidate under which a waiting check FAILs makes the field suspect. A flag; the claim stays an abstention.
    const suspectOf = new Map<string, { checked: number; failing: number; passing: number; shown: { read_as: string; value: number; fails: string[] }[] }>()
    if (ruleset.held_suspect !== false) {
      const numericKind = (k: DeclField['kind']): boolean => k === undefined || k === 'amount' || k === 'price' || k === 'quantity'
      const readValue = (t: string, kind: DeclField['kind']): number | undefined => { const r = readNumberTextV020(t, locale); const n = r ? normByKind(kind, r.canonical) : null; return n ? n.value : undefined }
      const oneAway = (raw: string, kind: DeclField['kind']): { text: string; value: number }[] => {
        const cs = [...raw]
        if (cs.length > SUSPECT_MAX_RAW) return []
        const seen = new Set<number>()
        const out: { text: string; value: number }[] = []
        const tryText = (t: string): void => { if (t === raw) return; const v = readValue(t, kind); if (v === undefined || seen.has(v)) return; seen.add(v); out.push({ text: t, value: v }) }
        for (let i = 0; i < cs.length; i++) tryText(cs.slice(0, i).join('') + cs.slice(i + 1).join(''))
        for (let i = 0; i < cs.length; i++) for (const a of SUSPECT_ALPHABET) tryText(cs.slice(0, i).join('') + a + cs.slice(i + 1).join(''))
        for (let i = 0; i <= cs.length; i++) for (const a of SUSPECT_ALPHABET) tryText(cs.slice(0, i).join('') + a + cs.slice(i).join(''))
        return out
      }
      /** A loc's candidates and where in the INPUT each is written for a re-evaluation (a plain path, or an envelope's value). */
      const candidatesOf = (l: Loc): { at: string; cands: { text: string; value: number; write: unknown }[] } | undefined => {
        const kind = fieldSpec(l.role)?.kind
        if (!numericKind(kind) || l.path === undefined) return undefined
        const u = l.b.unreadable
        if (!lowered) {
          if (u?.how !== 'unparseable') return undefined
          const raw = getPath(input, l.path)
          if (typeof raw !== 'string') return undefined
          return { at: l.path, cands: oneAway(raw, kind).map(x => ({ ...x, write: x.text })) }
        }
        if (u?.how !== 'marker' && u?.how !== 'unparseable') return undefined
        const readings = (lowered.provenance.get(l.path) as { readings?: { raw?: unknown }[] } | undefined)?.readings ?? []
        const seen = new Set<number>()
        const cands: { text: string; value: number; write: unknown }[] = []
        for (const rd of readings) {
          if (typeof rd?.raw !== 'string') continue
          const v = readValue(rd.raw, kind)
          if (v === undefined || seen.has(v)) continue
          seen.add(v)
          cands.push({ text: rd.raw, value: v, write: v })
        }
        const lk = ruleset.lineArrayKeys?.[0] ?? 'line_items'
        const at = l.line !== undefined ? `lines[${l.line}].fields.${l.role}.value` : l.elem !== undefined ? `fields.${l.role}[${l.elem}].value` : `fields.${l.role}.value`
        void lk
        return { at, cands }
      }
      const cand = new Map<string, ReturnType<typeof candidatesOf>>()
      for (const l of locs.values()) cand.set(l.key, candidatesOf(l))
      const groups = new Map<string, { locs: Loc[]; claims: ClaimVerdict[] }>()
      for (const [c, ls] of claimLocs) {
        if (ls.some(l => !cand.get(l.key)?.cands.length)) continue
        const key = ls.map(l => l.key).sort().join('\u0000')
        const g = groups.get(key) ?? { locs: [...ls].sort((a, b) => (a.key < b.key ? -1 : 1)), claims: [] }
        g.claims.push(c)
        groups.set(key, g)
      }
      let budget = SUSPECT_BUDGET
      const nestedOptions: VerifyDeclarativeOptions = { ...options }
      delete nestedOptions.declared_accuracy
      const tally = new Map<string, { all: Set<string>; failing: Map<string, { value: number; fails: Set<string> }> }>()
      for (const g of groups.values()) {
        const lists = g.locs.map(l => cand.get(l.key)!.cands)
        const total = lists.reduce((n, r) => n * r.length, 1)
        if (total === 0 || total > SUSPECT_MAX_COMBOS || total > budget) continue
        budget -= total
        const combo: { text: string; value: number; write: unknown }[] = []
        const walk = (k: number): void => {
          if (k === lists.length) {
            const patched = structuredClone(input)
            combo.forEach((r, i) => setPath(patched, cand.get(g.locs[i]!.key)!.at, r.write))
            let nv: Verdict
            try { nv = evaluateDeclarative(patched, ruleset, nestedOptions, true) } catch { return }
            const failed = g.claims.filter(c => nv.claims.find(x => x.claim_id === c.claim_id)?.outcome === 'FAIL').map(c => c.claim_id)
            combo.forEach((r, i) => {
              const key = g.locs[i]!.key
              const t = tally.get(key) ?? { all: new Set<string>(), failing: new Map() }
              t.all.add(r.text)
              if (failed.length) { const f = t.failing.get(r.text) ?? { value: r.value, fails: new Set<string>() }; for (const id of failed) f.fails.add(id); t.failing.set(r.text, f) }
              tally.set(key, t)
            })
            return
          }
          for (const r of lists[k]!) { combo.push(r); walk(k + 1); combo.pop() }
        }
        walk(0)
      }
      for (const [key, t] of tally) {
        if (!t.failing.size) continue
        const shown = [...t.failing.entries()].slice(0, 5).map(([read_as, f]) => ({ read_as, value: f.value, fails: [...f.fails] }))
        suspectOf.set(key, { checked: t.all.size, failing: t.failing.size, passing: t.all.size - t.failing.size, shown })
      }
    }
    const struck: StruckField[] = []
    const wouldUnlock: WouldUnlock[] = []
    const byReason: Record<StruckReason, number> = { unreadable: 0, suspect: 0, withdrawn: 0, 'unsupported-assertion': 0, conflict: 0, qc_held: 0, qc_struck: 0 }
    for (const l of locs.values()) {
      const u = l.b.unreadable
      const sus = suspectOf.get(l.key)
      const reason: StruckReason = u?.how === 'withdrawn' ? 'withdrawn' : u?.how === 'unsupported' ? 'unsupported-assertion' : u?.how === 'conflict' ? 'conflict'
        : u?.how === 'qc_held' ? 'qc_held' : u?.how === 'qc_struck' ? 'qc_struck' : sus ? 'suspect' : 'unreadable'
      byReason[reason]++
      const prov = lowered && l.path !== undefined ? (lowered.provenance.get(l.path) as { page?: number; line?: number; reader?: string; readings?: { reader: string; raw: string | null }[] } | undefined) : undefined
      const moveOf = u?.how === 'withdrawn' ? (overlay?.struck ?? []).find(st => st.document === true || st.path === l.path)?.move_id : undefined
      const provenance: StruckField['provenance'] = {
        ...(u?.raw !== undefined ? { raw: u.raw } : {}),
        ...(u?.at ? { at: renderAt(u.at) } : {}),
        ...(prov?.page !== undefined ? { page: prov.page } : {}), ...(prov?.line !== undefined ? { line: prov.line } : {}),
        ...(prov?.reader !== undefined ? { reader: prov.reader } : {}),
        ...(Array.isArray(prov?.readings) ? { readings: prov!.readings!.map(r => ({ reader: r.reader, raw: r.raw ?? null })) } : {}),
        tier: l.path === undefined ? 'unstated' : lowered ? (prov === undefined ? 'E4' : provenanceTier(prov, tierOpts).tier) : 'unstated',
        ...(moveOf !== undefined ? { move_id: moveOf } : {}),
      }
      const detail = u ? describeUnreadable(l.role, u, fieldSpec(l.role)?.kind, strictNote(u, fieldSpec(l.role)?.kind)) : `${l.role} could not be read`
      struck.push({ field: l.field, role: l.role, ...(l.path !== undefined ? { path: l.path } : {}), reason, provenance, detail, ...(sus && reason === 'suspect' ? { candidates: sus } : {}) })
      wouldUnlock.push({ field: l.field, claims: waits.get(l.key) ?? [] })
    }
    // the evidence floor: the worst effective tier among the field values the computed claims rest on
    const tierAtPath = (path: string): EvidenceTier | 'unstated' => {
      const o = pathTier.get(path)
      if (o) return betterTier(o.tier, o.supported_at)
      if (!lowered) return 'unstated'
      const p = lowered.provenance.get(path)
      return p === undefined ? 'E4' : provenanceTier(p, tierOpts).tier
    }
    const valueTiers = (role: string, line: number | undefined, seen: Set<string> = new Set()): (EvidenceTier | 'unstated')[] => {
      const k = `${role}@${line ?? ''}`
      if (seen.has(k)) return []
      seen.add(k)
      const okPath = (b: Bound | undefined): string | undefined => (b && b.status === 'ok' && !isDefaulted(b) && b.path !== undefined && !b.path.startsWith('line_computed(') ? b.path : undefined)
      // Engine 0.4.0: doc.R, prev(R), next(R), an aggregate (the rows it read), an algorithm role (every row of its inputs)
      if (v040) {
        const p = parseOperandName(role)
        if (p?.kind === 'doc') return valueTiers(p.role, undefined, seen)
        if (p?.kind === 'prev' || p?.kind === 'next') { if (line === undefined) return []; const j = p.kind === 'prev' ? line - 1 : line + 1; return j < 0 || j >= boundLines.length ? [] : valueTiers(p.role, j, seen) }
        if (p?.kind === 'agg') {
          const res = aggregate(p.fn as AggFn, p.role, p.set)
          const Lp = boundLists.get(p.role)
          return Lp ? res.rows.flatMap(j => { const q = okPath(Lp.elems[j]); return q === undefined ? [] : [tierAtPath(listAt(p.role, j, q))] }) : res.rows.flatMap(i => valueTiers(p.role, i, new Set(seen)))
        }
        const a = algoRoles.get(role)
        if (a) return Object.values(a.spec?.inputs ?? {}).flatMap(r => (typeof r !== 'string' ? [] : boundLists.has(r) ? valueTiers(r, undefined, new Set(seen)) : boundLines.flatMap((_, i) => valueTiers(r, i, new Set(seen)))))
      }
      const L = boundLists.get(role)
      if (L) return L.elems.flatMap((e, j) => { const p = okPath(e); return p === undefined ? [] : [tierAtPath(listAt(role, j, p))] })
      if (line !== undefined) {
        const f = ruleset.line_computed?.[role]
        if (f !== undefined) return refsOf(f).flatMap(r => valueTiers(r, line, seen))
        const p = okPath(boundLines[line]?.get(role))
        return p === undefined ? [] : [tierAtPath(`${lineKey ?? 'line_items'}[${line}].${p}`)]
      }
      if (boundDoc.has(role)) { const p = okPath(boundDoc.get(role)); return p === undefined ? [] : [tierAtPath(p)] }
      const cf = computedFormula.get(role)
      if (cf !== undefined) return refsOf(cf).flatMap(r => valueTiers(r, undefined, seen))
      if (lineRoleNames.has(role)) return boundLines.flatMap((_, i) => valueTiers(role, i, new Set(seen)))
      return []
    }
    const tiers: (EvidenceTier | 'unstated')[] = []
    for (const [c, r] of restsOn) if (c.outcome === 'PASS' || c.outcome === 'FAIL') for (const role of r.roles) tiers.push(...valueTiers(role, r.line))
    const pass = claims.filter(c => c.outcome === 'PASS').map(c => c.claim_id)
    const fail = claims.filter(c => c.outcome === 'FAIL').map(c => c.claim_id)
    const waiting = new Set(wouldUnlock.flatMap(w => w.claims))
    const counts: VerdictCounts = {
      checks_computed: pass.length + fail.length, checks_pass: pass.length, checks_fail: fail.length, checks_struck: waiting.size,
      fields_struck: struck.length, unreadable: byReason.unreadable, suspect: byReason.suspect, withdrawn: byReason.withdrawn,
      unsupported_assertion: byReason['unsupported-assertion'], conflict: byReason.conflict, findings: findings.length,
      // Engine 0.5.0: the choice ledger's rate, the quality-flag strikes, and the checks past their measured support
      ...(v050 ? { choices_load_bearing: ledger.load_bearing, choices_stated: ledger.stated, stated_rate: ledger.stated_rate, qc_held: byReason.qc_held, qc_struck: byReason.qc_struck, beyond_data: beyondData } : {}),
    }
    v030Blocks = {
      computed: { pass, fail }, struck, would_unlock: wouldUnlock, counts, evidence_floor: floorOf(tiers),
      ...(findings.length ? { findings } : {}), ...(support.length ? { support } : {}),
    }
  }

  let pass = 0, fail = 0, ins = 0
  for (const c of claims) c.outcome === 'PASS' ? pass++ : c.outcome === 'FAIL' ? fail++ : ins++
  const coverage: Coverage = { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
  const outcome: Outcome = fail > 0 ? 'FAIL' : pass + fail === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  // A tolerance override can change the outcome, so the input identity commits to it, only when one is given (D-TOL-ID).
  // The ruleset as its identity binds it: declared remedies are not part of it (2026-10-02), so they never move a verdict_id.
  // The source text, when given, is part of the input (2026-10-03); absent, the hash is exactly what it was before.
  // T1: bound to the input as given (an envelope, not its lowering); for any other input `input` is the extraction itself.
  const input_hash = verifyInputHash(input, { ruleset, ...(options.tolerance ? { tolerance: options.tolerance } : {}), ...(src !== undefined ? { source: src } : {}), ...(options.evidence !== undefined ? { evidence: options.evidence } : {}), ...(options.supplied_choices !== undefined ? { supplied_choices: options.supplied_choices } : {}), ...(options.archive_files !== undefined ? { archive_files: options.archive_files } : {}) })
  // Engine 0.2.0: the id also binds the ruleset's remedy table (types.ts remedyTableOf; protocol/verdict-id.ts).
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, remedyTableOf(ruleset))
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(input), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: lines.length },
    references: { contract: false, evidence: 0, history: 0, source: sourceGiven },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
    ...(notApplicable.length ? { not_applicable: notApplicable } : {}),
    ...(advisories.length ? { advisories } : {}),
    ...(v030Blocks ?? {}),
    ...(v040 ? v040Blocks(lowered, sourceGiven ? src!.text : undefined, ruleset, v050 ? { files: options.archive_files } : undefined) : {}),
    // Engine 0.5.0: the choice ledger, and the account of per-value quality flags when a value carries one
    ...(v050 ? { choices: ledger.entries, ...(qc.seen ? { qc: qc.block } : {}) } : {}),
  }
  if (nested) return verdict
  // Typed remedies for every non-PASS claim (verdict/remedy.ts): each check's own `remedy`, else what its insufficiency
  // implies. Outside the hashed core.
  const declared = new Map<string, RuleRemedies | undefined>()
  for (const c of ruleset.checks) if (!declared.has(c.code)) declared.set(c.code, normalizeDeclaration(c.remedy))
  const computedRoles = new Set([...Object.keys(ruleset.computed ?? {}), ...algoRoles.keys()])
  // 2026-10-03: a remedy names an identifier as the document wrote it, and money as money (verdict/remedy.ts `display`).
  const original = (b: Bound): string | undefined => (b.original === undefined ? undefined : Array.isArray(b.original) ? b.original.map(String).join(', ') : String(b.original))
  const shown = (c: ClaimVerdict, key: string): string | undefined => {
    const id = display.identifiers.get(c.claim_id)
    if (id) {
      if (key === 'asserted' || key === `op:${id.left}`) return original(id.l)
      if (key === 'expected' || key === `op:${id.right}`) return original(id.r)
      return undefined
    }
    if (!display.money.has(c.claim_id)) return undefined
    const n = key === 'asserted' ? c.asserted : key === 'expected' ? c.computation?.result : key === 'variance' ? c.variance : key.startsWith('op:') ? c.computation?.operands?.[key.slice(3)] : undefined
    return typeof n === 'number' ? formatMoney(n) : undefined
  }
  attachRemedies(verdict, {
    declared: (rule) => declared.get(rule), declaredFor: (c) => quoteRemedies.get(c.claim_id), display: shown,
    document: ruleset.domain ?? ruleset.id, isComputed: (role) => computedRoles.has(role),
    sourceOfRole: (role) => (role === 'source' ? 'source' : undefined),
    // 2026-10-03: an unreadable operand's remedy names where it was read (a line's own field on a line claim)
    pathOfRole: (role, c) => {
      // Engine 0.4.0: an operand read through an aggregate, prev(), next() or doc. is named where it was read
      const at = v040 ? operandAtV040(c, role) : undefined
      if (at?.line !== undefined) { const p = boundLines[at.line]?.get(role)?.badPath; return p === undefined ? undefined : lineAbs(at.line, p) }
      if (at?.elem !== undefined) { const e = boundLists.get(role)?.elems[at.elem]; return e?.badPath === undefined ? undefined : listAt(role, at.elem, e.badPath) }
      const li = /^line\[(\d+)\]\./.exec(c.claim_id)
      if (li) { const p = boundLines[Number(li[1])]?.get(role)?.badPath; return p === undefined ? undefined : `${lineKey ?? 'line_items'}[${li[1]}].${p}` }
      const L = boundLists.get(role)
      if (L) { const j = L.elems.findIndex(e => e.status === 'unparseable'); return j < 0 ? undefined : listAt(role, j, L.elems[j]!.badPath) }
      return boundDoc.get(role)?.badPath
    },
    // 2026-10-03, only under distinguish_unreadable (the engine 0.1.0 default): an operand's field path and published
    // term, and for an unreadable one the value as reported and the source line that prints it. Without it the remedies keep
    // their bytes.
    ...(strict ? {
      operandInfo: (role: string, c: ClaimVerdict) => {
        const f = fieldSpec(role)
        if (!f) return undefined
        // Engine 0.4.0: an operand read through an aggregate, prev(), next() or doc. is named on the row (or element) it was read
        const at = v040 ? operandAtV040(c, role) : undefined
        const li = /^line\[(\d+)\]\./.exec(c.claim_id)
        const lineIdx = at?.line !== undefined ? at.line : li ? Number(li[1]) : undefined
        const L = boundLists.get(role)
        const j = at?.elem !== undefined ? at.elem : L ? L.elems.findIndex(e => e.status === 'unparseable') : -1
        const b = lineIdx !== undefined ? boundLines[lineIdx]?.get(role) : L ? (j >= 0 ? L.elems[j] : undefined) : boundDoc.get(role)
        const rel = b?.unreadable?.path ?? f.paths[0]
        const path = rel === undefined ? undefined : lineIdx !== undefined ? `${lineKey ?? 'line_items'}[${lineIdx}].${rel}` : L ? listAt(role, Math.max(j, 0), rel) : rel
        const u = b?.status === 'unparseable' ? b.unreadable : undefined
        return {
          ...(path !== undefined ? { path } : {}), ...(f.term !== undefined ? { term: f.term } : {}),
          ...(u ? { unreadable: { ...(u.raw !== undefined ? { value: u.raw } : {}), ...(u.at ? { at: renderAt(u.at) } : {}), ...(strictNote(u, f.kind) !== undefined ? { note: strictNote(u, f.kind) } : {}), ...(v030 && (u.how === 'withdrawn' || u.how === 'unsupported' || u.how === 'conflict' || (v050 && (u.how === 'qc_held' || u.how === 'qc_struck'))) ? { struck: u.how, ...(u.detail !== undefined ? { why: u.detail } : {}) } : {}) } } : {}),
        }
      },
    } : {}),
    // Engine 0.3.0: a struck operand is answered by evidence, never by a typed value
    ...(v030 ? { evidenceLaw: true } : {}),
    // Engine 0.5.0: a check waiting on an unstated choice is answered by stating it, or by the judge supplying it
    ...(v050 ? { choiceOf: (role: string) => (ledger.kinds.has(role) && !own(ruleset.fields, role) ? { kind: ledger.kinds.get(role)! } : undefined) } : {}),
  })
  attachScope(verdict)
  return options.declared_accuracy ? attachDeclaredAccuracy(verdict, options.declared_accuracy) : verdict
}

/**
 * T1 (2026-10-03): the verdict for an extraction that breaks the contract a `require_contract` ruleset requires. No check
 * runs; one claim, `contract.EXTRACTION_CONTRACT`, abstains and names the first violation (its JSON Pointer and what is
 * wrong), and its typed remedy says what to hand over instead. Bound to the input as given, like every verdict.
 */
function contractRefusal(input: Json, ruleset: DeclarativeRuleset, options: VerifyDeclarativeOptions, violations: ContractViolation[]): Verdict {
  const engine_version = engineFor(options.engine)
  // Engine 0.5.0: the choice ledger is stated even when the envelope is refused; the 0.5.0 options are refused earlier
  const v050 = engineAtLeast(engine_version, '0.5.0')
  if (!v050 && (options.supplied_choices !== undefined || options.archive_files !== undefined)) throw new Error(`supplied_choices and archive_files are read from engine 0.5.0 on; this verdict is made under engine ${engine_version}`)
  const ledger = v050 ? choiceLedger(input, ruleset, options.supplied_choices) : undefined
  const src = options.source
  const sourceGiven = typeof src?.text === 'string' && src.text.length > 0
  const first = violations[0] as ContractViolation
  const where = first.pointer === '' ? '(the extraction itself)' : first.pointer
  const message = first.message.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
  const absentKind = first.code === 'contract.not_envelope' || first.code === 'contract.unaccounted' || first.code === 'contract.missing' || first.code === 'contract.provenance'
  const ref = rulesetRef(ruleset)
  const claim: ClaimVerdict = {
    claim_id: 'contract.EXTRACTION_CONTRACT', kind: 'CONSISTENCY', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA',
    field: first.pointer === '' ? 'extraction' : first.pointer, asserted: null,
    rule_id: 'EXTRACTION_CONTRACT', rule_name: `The extraction satisfies the extraction contract for ${ref} (require_contract)`,
    evidence: [], locked: false,
    insufficiency: {
      reason: absentKind ? 'FIELD_MISSING' : 'UNPARSEABLE',
      detail: `${first.code} at ${where}: ${message}${violations.length > 1 ? ` (${violations.length - 1} more violation${violations.length > 2 ? 's' : ''} after it)` : ''}. The ruleset requires the extraction contract, so no check ran`,
    },
    explanation: 'The extraction does not satisfy the extraction contract this ruleset requires; no check ran. Abstaining.',
  }
  const input_hash = verifyInputHash(input, { ruleset, ...(options.tolerance ? { tolerance: options.tolerance } : {}), ...(src !== undefined ? { source: src } : {}), ...(options.evidence !== undefined ? { evidence: options.evidence } : {}), ...(options.supplied_choices !== undefined ? { supplied_choices: options.supplied_choices } : {}), ...(options.archive_files !== undefined ? { archive_files: options.archive_files } : {}) })
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, remedyTableOf(ruleset))
  const issued_at = (options.now ?? (() => new Date()))().toISOString()
  const lineKey = (ruleset.lineArrayKeys ?? ['line_items']).find(k => Array.isArray(input[k]))
  const verdict: Verdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(input), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: lineKey ? (input[lineKey] as unknown[]).length : 0 },
    references: { contract: false, evidence: 0, history: 0, source: sourceGiven },
    outcome: 'INSUFFICIENT_DATA', aggregation: 'ANY_FAIL_FAILS', claims: [claim],
    coverage: { claims_total: 1, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 1 },
    // Engine 0.3.0: nothing was computed and nothing was struck: the envelope itself was refused
    ...(engineAtLeast(engine_version, '0.3.0') ? {
      computed: { pass: [], fail: [] }, struck: [], would_unlock: [],
      counts: {
        checks_computed: 0, checks_pass: 0, checks_fail: 0, checks_struck: 0, fields_struck: 0, unreadable: 0, suspect: 0, withdrawn: 0, unsupported_assertion: 0, conflict: 0, findings: 0,
        // Engine 0.5.0: the ledger is resolved from the input as given, though no check ran
        ...(ledger ? { choices_load_bearing: ledger.load_bearing, choices_stated: ledger.stated, stated_rate: ledger.stated_rate, qc_held: 0, qc_struck: 0, beyond_data: 0 } : {}),
      },
      evidence_floor: 'none' as const,
    } : {}),
    // Engine 0.4.0: the algorithms the ruleset names are pinned on the verdict, whether or not a check ran
    ...(engineAtLeast(engine_version, '0.4.0') && algorithmPinsOf(ruleset).length ? { algorithms: algorithmPinsOf(ruleset) } : {}),
    ...(ledger ? { choices: ledger.entries } : {}),
  }
  const fix = first.code === 'contract.not_envelope'
    ? `hand over an extraction-contract envelope for ${ref}: every field term read with its provenance (page, line, raw, reader) or named in not_printed (the schema is \`extract-schema ${ref}\`)`
    : `correct ${where} so the envelope satisfies the contract for ${ref} (\`extract-schema ${ref}\`): ${message}`
  attachRemedies(verdict, {
    declared: (rule) => (rule === 'EXTRACTION_CONTRACT'
      ? { abstain: [{ kind: absentKind ? 'missing-operand' : 'recompute-with', operand: { source: 'extraction', path: first.pointer === '' ? '/' : first.pointer }, detail: fix }] }
      : undefined),
    document: ruleset.domain ?? ruleset.id,
  })
  attachScope(verdict)
  return options.declared_accuracy ? attachDeclaredAccuracy(verdict, options.declared_accuracy) : verdict
}

// ── Engine 0.4.0 (2026-10-04): what a verdict states about its archives and its algorithms ──────────────────────────────

/** The pins of the algorithms a ruleset's `algorithms` block names (src/algorithms algorithmPin), one per ref, by ref. */
export function algorithmPinsOf(ruleset: DeclarativeRuleset): AlgorithmPin[] {
  const block = (ruleset as { algorithms?: unknown }).algorithms
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return []
  const refs = new Set<string>()
  for (const spec of Object.values(block as Record<string, unknown>)) refs.add(String((spec as { algorithm?: unknown } | null)?.algorithm))
  return [...refs].sort().map(algorithmPin)
}

/**
 * The archives an envelope's values were read from (archive provenance, engine 0.4.0; docs/EVIDENCE.md), one per file: where it
 * was served and when, the content sha256, the archive's own checksum when it publishes one, and what the engine verified.
 * `content_verified`: the engine hashed the bytes it was given (the source text) and they are the file this provenance names.
 * `checksum_verified`: those bytes also match the checksum the archive publishes. Neither is ever taken from the envelope.
 */
export function archiveChecks(lowered: { provenance: Map<string, unknown> } | undefined, text: string | undefined): ArchiveCheck[] {
  if (!lowered) return []
  type G = { url: string; member?: string; container_sha256?: string; retrieved_at: string; sha256: string; archive_checksum?: { algorithm: string; value: string; published_at?: string }; fields: number }
  const groups = new Map<string, G>()
  for (const p of lowered.provenance.values()) {
    if (p === null || typeof p !== 'object' || (p as { kind?: unknown }).kind !== 'archive' || archiveProvenanceProblems(p).length) continue
    const a = p as { url: string; member?: string; container_sha256?: string; retrieved_at: string; sha256: string; archive_checksum?: { algorithm: string; value: string; published_at?: string } }
    const key = `${a.url}\u0000${a.member ?? ''}\u0000${a.sha256}`
    const g = groups.get(key)
    if (g) { g.fields++; continue }
    groups.set(key, {
      url: a.url, ...(a.member !== undefined ? { member: a.member } : {}), ...(a.container_sha256 !== undefined ? { container_sha256: a.container_sha256 } : {}),
      retrieved_at: a.retrieved_at, sha256: a.sha256,
      ...(a.archive_checksum !== undefined ? { archive_checksum: { algorithm: a.archive_checksum.algorithm, value: a.archive_checksum.value, ...(a.archive_checksum.published_at !== undefined ? { published_at: a.archive_checksum.published_at } : {}) } } : {}),
      fields: 1,
    })
  }
  const digest = (alg: string): string | undefined => { if (text === undefined) return undefined; try { return createHash(alg).update(text, 'utf8').digest('hex') } catch { return undefined } }
  const textSha = digest('sha256')
  return [...groups.values()].map((g): ArchiveCheck => {
    const content_verified = textSha !== undefined && textSha === g.sha256
    const pub = g.archive_checksum
    const got = content_verified && pub ? digest(pub.algorithm) : undefined
    const checksum_verified = content_verified && !!pub && got !== undefined && got === pub.value.toLowerCase()
    const file = g.member !== undefined ? `${g.member} in ${g.url}` : g.url
    const detail = textSha === undefined
      ? `the engine did not see the bytes of ${file} (no source text was supplied), so it verified neither the content sha256 nor any archive checksum`
      : !content_verified ? `the source text supplied is not ${file} (it hashes to sha256 ${textSha}): the engine did not see this file's bytes, so it verified neither its content sha256 nor any archive checksum`
        : !pub ? `the engine hashed the bytes supplied and they are ${file} (sha256 matches); the archive publishes no checksum for it, so there is nothing of the archive's own to match`
          : checksum_verified ? `the engine hashed the bytes supplied: they are ${file} (sha256 matches) and match the ${pub.algorithm} the archive publishes${pub.published_at !== undefined ? ` (${pub.published_at})` : ''}`
            : got === undefined ? `the engine hashed the bytes supplied and they are ${file} (sha256 matches), but it cannot compute ${pub.algorithm} in this runtime`
              : `the engine hashed the bytes supplied and they are ${file} (sha256 matches), but their ${pub.algorithm} is ${got}, not the ${pub.value} stated as the archive's`
    return { ...g, tier: 'E1', content_verified, checksum_verified, detail }
  })
}

// ── Engine 0.5.0 (2026-10-04): the choice ledger, and archive bytes ─────────────────────────────────────────────────────

const isPlain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
/** A choice value the engine accepts: a finite number, a non-empty string, or a plain object (a flags policy). */
const choiceValueOk = (v: unknown): v is ChoiceValue => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '') || isPlain(v)
const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The choice ledger of one input under one ruleset (engine 0.5.0): the verdict's `choices`, the values the checks use, the rate. */
export interface ChoiceLedger {
  entries: ChoiceEntry[]
  /** slot id → the value the checks use (undefined: unstated or not applicable) */
  values: Map<string, ChoiceValue | undefined>
  kinds: Map<string, DeclChoice['kind']>
  load_bearing: number
  stated: number
  /** stated / load-bearing, to 4 decimals; null when no slot is load-bearing (nothing to state is not nothing stated) */
  stated_rate: number | null
}

/**
 * Resolve every choice slot the ruleset declares (engine 0.5.0, docs/CHOICES.md): a document's well-formed stated fill (a value
 * with a span: a quote and a page or a section) is `stated`; else the judge's value (`supplied_choices`) or the ruleset's default
 * is `supplied`; else the slot is `unstated` and has no value. A slot the ruleset declares not applicable is `not_applicable`.
 * An algorithm slot stated with a registry ref also says whether its quote is a verbatim part of the registry's pinned quote.
 */
export function choiceLedger(input: unknown, ruleset: DeclarativeRuleset, supplied?: Record<string, SuppliedChoice>): ChoiceLedger {
  const slots = Array.isArray(ruleset.choices) ? ruleset.choices.filter((s): s is DeclChoice => isPlain(s) && typeof (s as { id?: unknown }).id === 'string') : []
  const fills: Record<string, unknown> = isPlain(input) && isPlain(input.choices) ? input.choices : {}
  const entries: ChoiceEntry[] = []
  const values = new Map<string, ChoiceValue | undefined>()
  const kinds = new Map<string, DeclChoice['kind']>()
  let lb = 0, st = 0
  for (const s of slots) {
    if (kinds.has(s.id)) continue // lint refuses a duplicate id; the first slot of an id is the one read
    kinds.set(s.id, s.kind)
    if (typeof s.not_applicable === 'string' && s.not_applicable.trim() !== '') {
      entries.push({ id: s.id, kind: s.kind, status: 'not_applicable', value: null, source: { not_applicable: s.not_applicable }, load_bearing: false })
      values.set(s.id, undefined)
      continue
    }
    const loadBearing = s.load_bearing === true
    const f = Object.prototype.hasOwnProperty.call(fills, s.id) ? fills[s.id] : undefined
    const notes: string[] = []
    let entry: ChoiceEntry | undefined
    if (f !== undefined) {
      if (isPlain(f) && f.stated === true) {
        const sp = f.span
        const spanOk = isPlain(sp) && typeof sp.quote === 'string' && sp.quote.trim() !== '' &&
          ((typeof sp.page === 'number' && Number.isInteger(sp.page) && sp.page >= 1) || (typeof sp.section === 'string' && sp.section.trim() !== ''))
        if (spanOk && choiceValueOk(f.value)) {
          const span = { ...(typeof sp.page === 'number' ? { page: sp.page } : {}), ...(typeof sp.section === 'string' ? { section: sp.section } : {}), quote: sp.quote as string }
          const reg = s.kind === 'algorithm' && typeof f.value === 'string' ? resolveAlgorithm(f.value) : undefined
          entry = {
            id: s.id, kind: s.kind, status: 'stated', value: f.value,
            source: { span, ...(reg ? { registry: { ref: f.value as string, quote_sha256: reg.source.quote_sha256, verbatim: collapseWs(reg.source.quote).includes(collapseWs(span.quote)) } } : {}) },
            load_bearing: loadBearing,
          }
        } else notes.push(!choiceValueOk(f.value)
          ? 'the document\'s fill says stated, but its value is not a number, a non-empty string or an object, so it is not read as a statement'
          : 'the document\'s fill says stated, but it carries no span with a quote and a page or a section, so it is not read as a statement')
      } else if (isPlain(f) && f.unstated === true) notes.push('the document is marked silent on this choice')
      else notes.push('the document\'s fill is neither { value, stated: true, span } nor { unstated: true }, so it is not read')
    }
    if (!entry) {
      const j = supplied !== undefined && isPlain(supplied) && Object.prototype.hasOwnProperty.call(supplied, s.id) ? supplied[s.id] : undefined
      const judgeOk = isPlain(j) && choiceValueOk(j.value) && typeof j.source === 'string' && j.source.trim() !== ''
      if (j !== undefined && !judgeOk) notes.push('the judge\'s value is not { value, source }, so it is not used')
      const d = s.default
      if (judgeOk) entry = { id: s.id, kind: s.kind, status: 'supplied', value: j!.value, source: { default: j!.source, by: 'judge' }, load_bearing: loadBearing }
      else if (isPlain(d) && choiceValueOk(d.value) && typeof d.source === 'string' && d.source.trim() !== '') entry = { id: s.id, kind: s.kind, status: 'supplied', value: d.value, source: { default: d.source, by: 'ruleset' }, load_bearing: loadBearing }
      else entry = { id: s.id, kind: s.kind, status: 'unstated', value: null, source: null, load_bearing: loadBearing }
    }
    if (notes.length) entry.detail = notes.join('; ')
    entries.push(entry)
    values.set(s.id, entry.status === 'stated' || entry.status === 'supplied' ? (entry.value as ChoiceValue) : undefined)
    if (loadBearing) { lb++; if (entry.status === 'stated') st++ }
  }
  return { entries, values, kinds, load_bearing: lb, stated: st, stated_rate: lb === 0 ? null : round4(st / lb) }
}

/** The bytes an engine 0.5.0 verdict may hash for its archives: the source text (UTF-8), then each archive file (base64), labelled. */
function suppliedBytes(text: string | undefined, files: readonly ArchiveFile[] | undefined): { label: string; bytes?: Buffer; bad?: string }[] {
  const out: { label: string; bytes?: Buffer; bad?: string }[] = []
  if (text !== undefined) out.push({ label: 'source.text', bytes: Buffer.from(text, 'utf8') })
  ;(Array.isArray(files) ? files : []).forEach((f, i) => {
    const label = `archive_files[${i}]${isPlain(f) && typeof f.name === 'string' && f.name !== '' ? ` (${f.name})` : ''}`
    const b64 = isPlain(f) ? f.base64 : undefined
    if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) out.push({ label, bad: 'is not base64' })
    else out.push({ label, bytes: Buffer.from(b64, 'base64') })
  })
  return out
}

/**
 * Engine 0.5.0: `archives` from every supplied byte string (the source text and the archive files), so a binary file can reach
 * `checksum_verified`. Engine 0.4.0's archiveChecks is unchanged and still makes every 0.4.0 verdict.
 */
export function archiveChecksV050(lowered: { provenance: Map<string, unknown> } | undefined, text: string | undefined, files: readonly ArchiveFile[] | undefined): ArchiveCheck[] {
  const base = archiveChecks(lowered, undefined)
  if (!base.length) return []
  const supplied = suppliedBytes(text, files)
  const hashed = supplied.map(s => (s.bytes ? { ...s, sha256: createHash('sha256').update(s.bytes).digest('hex') } : s))
  const digest = (bytes: Buffer, alg: string): string | undefined => { try { return createHash(alg).update(bytes).digest('hex') } catch { return undefined } }
  const bad = supplied.filter(s => s.bad).map(s => `${s.label} ${s.bad}`)
  return base.map((g): ArchiveCheck => {
    const file = g.member !== undefined ? `${g.member} in ${g.url}` : g.url
    const hit = hashed.find(h => 'sha256' in h && h.sha256 === g.sha256)
    const pub = g.archive_checksum
    const got = hit?.bytes && pub ? digest(hit.bytes, pub.algorithm) : undefined
    const content_verified = hit !== undefined
    const checksum_verified = content_verified && !!pub && got !== undefined && got === pub.value.toLowerCase()
    const seen = hashed.filter(h => 'sha256' in h) as { label: string; sha256: string }[]
    const badNote = bad.length ? `; ${bad.join('; ')}, so it was not read` : ''
    const detail = !content_verified
      ? (seen.length === 0
        ? `the engine did not see the bytes of ${file} (no source text and no archive file was supplied), so it verified neither the content sha256 nor any archive checksum${badNote}`
        : `none of the bytes supplied is ${file} (${seen.map(h => `${h.label} hashes to sha256 ${h.sha256}`).join('; ')}): the engine did not see this file's bytes, so it verified neither its content sha256 nor any archive checksum${badNote}`)
      : !pub ? `the engine hashed ${hit!.label} (${hit!.bytes!.length} bytes) and it is ${file} (sha256 matches); the archive publishes no checksum for it, so there is nothing of the archive's own to match`
        : checksum_verified ? `the engine hashed ${hit!.label} (${hit!.bytes!.length} bytes): it is ${file} (sha256 matches) and matches the ${pub.algorithm} the archive publishes${pub.published_at !== undefined ? ` (${pub.published_at})` : ''}`
          : got === undefined ? `the engine hashed ${hit!.label} (${hit!.bytes!.length} bytes) and it is ${file} (sha256 matches), but it cannot compute ${pub.algorithm} in this runtime`
            : `the engine hashed ${hit!.label} (${hit!.bytes!.length} bytes) and it is ${file} (sha256 matches), but its ${pub.algorithm} is ${got}, not the ${pub.value} stated as the archive's`
    return { ...g, content_verified, checksum_verified, detail, ...(hit ? { matched: hit.label } : {}) }
  })
}

/** The engine 0.4.0 blocks of a declarative verdict: `archives` (an envelope with archive provenance) and `algorithms` (pins). */
function v040Blocks(lowered: { provenance: Map<string, unknown> } | undefined, text: string | undefined, ruleset: DeclarativeRuleset, v050?: { files?: readonly ArchiveFile[] }): { archives?: ArchiveCheck[]; algorithms?: AlgorithmPin[] } {
  // Engine 0.5.0: archive files supplied as bytes are hashed too; under 0.4.0 the source text alone, exactly as before
  const archives = v050 ? archiveChecksV050(lowered, text, v050.files) : archiveChecks(lowered, text)
  const algorithms = algorithmPinsOf(ruleset)
  return { ...(archives.length ? { archives } : {}), ...(algorithms.length ? { algorithms } : {}) }
}
