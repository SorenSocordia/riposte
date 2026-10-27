/**
 * Strict reading for the BUILT-IN rulesets (invoice, pay-app) under engine 0.6.0 (2026-10-05; red-team
 * F6, F14, F15). "Abstain, never guess" had held only on the declarative path since engine 0.2.0; the built-ins still read every
 * value through the lenient normalizer (binding/forensic-normalizer.ts), so "$1OO.O0" (letter O) was read as 1, "°225.0" as 225,
 * and "1 234" as 1. Under engine 0.6.0 a built-in ruleset's compute() runs this pass first, on the bindings the bridge made:
 *
 *   1. a money, price, quantity or rate value that arrived as TEXT must read as exactly one number by the declarative path's
 *      rule (declarative/unreadable.ts readNumberTextV020, no locale declared): digits; groups of three under one grouping
 *      mark; or two marks, the last occurring once as the decimal mark. AMBIGUOUS, so unreadable: one "." or "," followed by
 *      exactly three digits ("1.234", "1,234"), one "," followed by any other count ("1,23"), any space grouping ("1 234",
 *      also with a no-break or thin space). A currency symbol or three-letter code before or after, a sign, brackets for a
 *      negative and (for a rate) a trailing "%" are read. A value that fails, or whose lenient reading differs from the strict
 *      one, keeps its raw text as the bound value, so every check that needs it abstains as UNPARSEABLE (the gavel's "Type
 *      mismatch ... is the text ...") and every computed role that needs it says it is present but not a number. JSON numbers
 *      are not text and are not touched.
 *   2. a field reported under a key that differs from one of the ruleset's paths only by spaces or invisible characters
 *      ("total " with a trailing space, or "sub" + U+200B + "total") is refused by name: the role is not bound from it, and the reason names the key
 *      (UNPARSEABLE), never a bare FIELD_MISSING. Folding is the declarative path's (declarative/evaluate.ts foldKey).
 *
 *   3. (2026-10-06; an outside engineer read "1,500" as 1500 at confidence 100, "1.500" as 1.5, and an invoice writing
 *      "1.500,00" beside "1,500.00" as 1500 twice, and it passed) a lone three-digit group ("1,500", "1.500") reads only under a
 *      declared `number_locale`, never under a format the document's other figures settle; a document that mixes both formats
 *      reads none of its figures written with a "." or ","; digits of two scripts, in one figure or across the document's figures
 *      (a full-width "１５００.００" in an invoice whose other figures use 0-9), a space other than the ordinary one outside a
 *      grouping (a trailing no-break space), or an invisible formatting character is refused, named. A document written wholly
 *      in full-width or Arabic-Indic digits reads as before.
 *
 * Engines 0.0.1 to 0.5.0 never call this: their verdicts re-perform exactly as before.
 * The cost, stated: a price or quantity written as TEXT with exactly three decimals ("3.335") is unreadable without a declared
 * locale (the same cost the declarative path carries since 0.2.0); the built-in rulesets declare none, so send JSON numbers.
 */
import type { BindingContext, BoundValue, DomainOntology, UniversalRole } from '../kernel/types.js'
import { LOCALE_TAGS, isStrictNumberText, readNumberTextV020, resolveLocale, type NumberLocale } from '../declarative/unreadable.js'
import { foldDigits } from '../binding/forensic-normalizer.js'
import { numberTextIsExact } from '../protocol/hash-input.js'
import type { Absence, Json } from './types.js'

export type NumericKind = 'amount' | 'price' | 'quantity' | 'rate'

/** The numeric roles the bridge reads by kind for an ontology that declares none (binding/ontological-bridge.ts normalizeValueForRole). */
const BUILTIN_KINDS: Partial<Record<UniversalRole, NumericKind>> = {
  CLAIMED_AMOUNT: 'amount', VERIFIED_AMOUNT: 'amount', CONTRACTED_LIMIT: 'amount', LINE_ITEM_TOTAL: 'amount', EXPECTED_TOTAL: 'amount',
  SUBTOTAL: 'amount', TAX_AMOUNT: 'amount', DISCOUNT_AMOUNT: 'amount', SERVICE_CHARGE: 'amount', GRAND_TOTAL: 'amount',
  RATE_APPLIED: 'price', RATE_CONTRACTED: 'price', TAX_RATE: 'rate', CLAIMED_QUANTITY: 'quantity', ACTUAL_QUANTITY: 'quantity',
}

/** The numeric kind of a role in an ontology: its declared kind, else the bridge's built-in reading; undefined when not numeric. */
export function numericKindOf(ontology: DomainOntology, role: UniversalRole): NumericKind | undefined {
  const declared = ontology.roleKinds?.[role]
  if (declared !== undefined) return declared === 'amount' || declared === 'rate' || declared === 'quantity' ? declared : undefined
  return BUILTIN_KINDS[role]
}

/** A key as a near-miss match compares it: NFKC, format characters and every kind of space removed; case kept. */
const INVISIBLE_OR_SPACE = /[\p{Cf}\p{Zs}\s]/gu
export const foldKey = (k: string): string => k.normalize('NFKC').replace(INVISIBLE_OR_SPACE, '')

/**
 * The number format a document's text values are read in: `tag` is a LOCALE_TAGS name. `declared`: the extraction says so in a
 * top-level `number_locale`; `settled`: the document's own text values settle it (some read under exactly one of en and de, and
 * none under only the other); `mixed` (2026-10-06): some read only under en and some only under de, so no figure written with a
 * "." or "," is read; `none`: neither, so an ambiguous value stays unreadable. A settled format never reads a lone three-digit
 * group ("1,500", "1.500"): only a declared one does (strictNumberText).
 */
export interface DocumentFormat {
  source: 'declared' | 'settled' | 'mixed' | 'none'; tag?: string; locale?: NumberLocale; note?: string
  /**
   * 2026-10-06: the document writes its figures in more than one script of digits (the words, naming one figure of each). A
   * figure that is not in the digits 0-9 is then not read.
   */
  digits?: string
}

/** The name of a character that may not stand in a figure written as text, for the reason a refusal gives. */
function characterName(ch: string): string {
  const named: Record<string, string> = {
    '\u00A0': 'a no-break space', '\u202F': 'a narrow no-break space', '\u2009': 'a thin space', '\u2007': 'a figure space',
    '\u3000': 'an ideographic space', '\u200B': 'a zero-width space', '\uFEFF': 'a zero-width no-break space', '\u200E': 'a left-to-right mark',
    '\u200F': 'a right-to-left mark', '\u2060': 'a word joiner', '\u00AD': 'a soft hyphen',
  }
  return named[ch] ?? (/\p{Zs}/u.test(ch) ? 'a space other than the ordinary one' : 'an invisible formatting character')
}
const codePoint = (ch: string): string => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`
/** The spaces the grouping rule reads as a space grouping mark between digits (declarative/unreadable.ts SPACE_MARK). */
const GROUP_SPACES: ReadonlySet<string> = new Set(['\u00A0', '\u202F', '\u2009', '\u2007'])

/** The digit scripts the readers fold, by the code point of their zero, with a name for the words. */
const DIGIT_SCRIPTS: readonly { zero: number; name: string }[] = [
  { zero: 0x30, name: 'the digits 0-9' }, { zero: 0xff10, name: 'full-width digits' }, { zero: 0x0660, name: 'Arabic-Indic digits' },
  { zero: 0x06f0, name: 'Persian digits' }, { zero: 0x0966, name: 'Devanagari digits' }, { zero: 0x09e6, name: 'Bengali digits' },
  { zero: 0x0e50, name: 'Thai digits' },
]
/** The script a digit is written in ("the digits 0-9", "full-width digits", ...). */
function digitScript(ch: string): string {
  const c = ch.codePointAt(0) as number
  return DIGIT_SCRIPTS.find(s => c >= s.zero && c <= s.zero + 9)?.name ?? `digits near ${codePoint(ch)}`
}
/** The script of the first digit in a text, or undefined when it holds none. */
export function digitScriptOf(text: string): string | undefined {
  const m = /\p{Nd}/u.exec(text)
  return m ? digitScript(m[0]) : undefined
}

/**
 * Engine 0.6.0 (2026-10-06): why a figure written as text holds characters no figure handed over should hold, or undefined:
 * digits of two scripts in one figure ("1５00"), a space other than U+0020 outside a grouping (a trailing no-break space copied
 * from a page), or an invisible formatting character (a zero-width space, a direction mark). Each is read by some reader and
 * not by another, so the figure is not read. A figure written wholly in one script of digits (a Japanese invoice in full-width
 * digits, an Arabic one in Arabic-Indic digits) reads as before; a document that writes its figures in two scripts is refused
 * figure by figure (formatOfTexts, strictNumberText). A whole CJK numeral (壹萬貳仟) holds no digit and is read as before. A
 * no-break, narrow, thin or figure space BETWEEN two digits is a space grouping, which the grouping rule reads under a declared
 * "fr" and refuses otherwise ("1 234"), as before.
 */
export function figureCharacterProblem(raw: string): string | undefined {
  const chars = [...raw]
  const scripts = new Map<string, string>()
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const c = ch.codePointAt(0) as number
    if (/\p{Nd}/u.test(ch)) {
      const s = digitScript(ch)
      if (!scripts.has(s)) scripts.set(s, ch)
      if (scripts.size > 1) {
        return `it mixes ${[...scripts.keys()].join(' and ')} (${[...scripts.values()].map(x => `${JSON.stringify(x)}, ${codePoint(x)}`).join('; ')}); send a figure in one script of digits, or as a JSON number`
      }
      continue
    }
    if (GROUP_SPACES.has(ch) && /\p{Nd}/u.test(chars[i - 1] ?? '') && /\p{Nd}/u.test(chars[i + 1] ?? '')) continue
    if (c !== 0x20 && /[\p{Zs}\p{Cf}]/u.test(ch)) {
      return `it holds ${characterName(ch)} (${codePoint(ch)}), which is not part of a number as handed over; remove it, or send the figure as a JSON number`
    }
  }
  return undefined
}

/**
 * The numeric core of a figure's text: what is left when a currency, a sign, brackets and spaces are stripped from both ends
 * ("$1,500.00" → "1,500.00").
 */
const numericCore = (t: string): string => t.trim().replace(/^[^\p{Nd}]+|[^\p{Nd}]+$/gu, '')

/** A lone group of three digits after one separator ("1,500", "1.500"): a thousands group or three decimals. */
const LONE_THREE = /^[1-9]\d{0,2}[.,]\d{3}$/

/** Does the text carry a "." or "," between digits (the marks whose meaning a mixed document leaves open)? */
export const hasMark = (t: string): boolean => /\p{Nd}[.,]\p{Nd}/u.test(t)

/** Strip a trailing "%" from a rate's text; the number before it is a percent. */
function rateText(raw: string, kind: NumericKind): { text: string; percent: boolean } {
  if (kind !== 'rate') return { text: raw, percent: false }
  const m = /^(.*?)\s*%\s*$/su.exec(raw)
  return m ? { text: m[1]!, percent: true } : { text: raw, percent: false }
}

/**
 * Why a text value does not read strictly as one number, or the number it reads as (null for a CJK numeral, read whole).
 * 2026-10-06, in this order: a character no figure should hold is refused, naming it (figureCharacterProblem); in a document
 * that mixes both number formats, any figure written with a "." or "," is refused; a lone three-digit group ("1,500",
 * "1.500") reads only under a declared `number_locale`, never under a format the other figures settle; the rest as before.
 */
export function strictNumberText(raw: string, kind: NumericKind, format: DocumentFormat = { source: 'none' }): { ok: true; value: number | null } | { ok: false; why: string; inexact?: true } {
  const { text, percent } = rateText(raw, kind)
  const bad = figureCharacterProblem(text)
  if (bad !== undefined) return { ok: false, why: bad }
  const script = digitScriptOf(text)
  if (format.digits !== undefined && script !== undefined && script !== DIGIT_SCRIPTS[0]!.name) {
    return { ok: false, why: `${format.digits}, and this figure is written in ${script}; send every figure in the digits 0-9, or as JSON numbers` }
  }
  if (format.source === 'mixed' && hasMark(text)) {
    return { ok: false, why: `${format.note ?? 'the document mixes both number formats'}, so what its "." and "," mean is not settled (declare "number_locale": "en" or "de", or send JSON numbers)` }
  }
  // with nothing settled, the grouping rule below refuses it in the words it always used; a figure the settled format does not
  // read at all keeps that reason ("40,000." holds a character that is not part of a number)
  if (format.source === 'settled' && LONE_THREE.test(foldDigits(numericCore(text)).text) && readNumberTextV020(text, format.locale) !== null) {
    return { ok: false, why: `one separator followed by three digits is a thousands group or three decimals, and only a declared format settles which; the document's other figures are written in ${format.tag}, which does not settle a lone group of three (declare "number_locale": "en" or "de", or send JSON numbers)` }
  }
  const r = readNumberTextV020(text, format.locale)
  if (!r) {
    const t = text.trim()
    const unsettled = format.source === 'none' ? `${format.note ? `${format.note}; ` : ''}nothing in the document settles its number format (declare "number_locale": "en" or "de", or send JSON numbers)` : ''
    const why = format.locale && readNumberTextV020(text) ? `it does not read in the document's number format (${format.tag}, ${format.source})`
      : /^[\p{Nd}]{1,3}([\s\u00A0\u202F\u2009\u2007][\p{Nd}]{3})+([.,][\p{Nd}]+)?$/u.test(t) ? `a space-grouped number reads as one number or as several${format.locale ? ` and the document's format (${format.tag}) does not group with spaces` : ` (only a declared "number_locale": "fr" reads it)`}`
      : /^[\p{Nd}]+[.,][\p{Nd}]{3}$/u.test(t) ? `one separator followed by three digits is a thousands group or three decimals${unsettled ? `, and ${unsettled}` : ''}`
      : /^[\p{Nd}]+,[\p{Nd}]{1,2}$/u.test(t) ? `a single comma is a decimal comma or a thousands mark${unsettled ? `, and ${unsettled}` : ''}`
      : 'it holds characters that are not part of a number'
    return { ok: false, why }
  }
  const n = Number(r.canonical)
  // 2026-10-05: a figure with more digits than a double holds ("9007199254740993.00" reads as 9007199254740992) is not
  // read as the nearest double; every check that needs it says can't tell
  if (Number.isFinite(n) && !numberTextIsExact(r.canonical)) {
    return { ok: false, inexact: true, why: `it has more digits than a number can hold exactly (it would read as ${String(n)}), so no check can use it as written` }
  }
  return { ok: true, value: Number.isFinite(n) ? (percent ? n / 100 : n) : null }
}

/**
 * The document's number format: a declared `number_locale` (one of LOCALE_TAGS) wins; else the text values settle it when some
 * that read without a locale read under exactly one of en ("1,234.56", "0.125", "1,250,000") and none under only de ("1.250,00"),
 * or the reverse; else none. JSON numbers say nothing about format. Deterministic: it reads only the bound numeric text values.
 */
export function documentFormat(extraction: Json, ctxs: readonly BindingContext[], ontology: DomainOntology): DocumentFormat {
  const texts: string[] = []
  for (const ctx of ctxs) {
    for (const [role, b] of Object.entries(ctx.bindings) as [UniversalRole, BoundValue | undefined][]) {
      if (!b || b.source === 'computed' || typeof b.originalValue !== 'string') continue
      const kind = numericKindOf(ontology, role)
      if (kind) texts.push(rateText(b.originalValue, kind).text)
    }
  }
  return formatOfTexts(texts, extraction.number_locale)
}

/** The number format a set of text values settles, or the one `declared` names (a document's `number_locale`); see documentFormat. */
export function formatOfTexts(texts: readonly string[], declared: unknown): DocumentFormat {
  // 2026-10-06: the scripts of digits the document's figures are written in (a text that reads as a figure), one figure of each
  const scripts = new Map<string, string>()
  for (const text of texts) {
    const s = isStrictNumberText(text) ? digitScriptOf(text) : undefined
    if (s !== undefined && !scripts.has(s)) scripts.set(s, text.trim())
  }
  const digits = scripts.size > 1 ? { digits: `the document writes its figures in more than one script of digits (${[...scripts].map(([s, t]) => `${s}: ${JSON.stringify(t)}`).join('; ')})` } : {}
  const base = (f: DocumentFormat): DocumentFormat => ({ ...f, ...digits })
  if (declared !== undefined) {
    const locale = typeof declared === 'string' ? resolveLocale(declared) : undefined
    if (locale) return base({ source: 'declared', tag: declared as string, locale })
    return base({ source: 'none', note: `"number_locale" is ${JSON.stringify(declared)}, which is not one of ${Object.keys(LOCALE_TAGS).join(', ')}` })
  }
  let en: string | undefined, de: string | undefined
  for (const text of texts) {
    // evidence is a value that reads without any locale ("1.250,00", "1,234.56", "0.125"), and in only one of en and de; an
    // ambiguous value ("1,23", "75,000") is never its own evidence, or "1,23" would settle de and be read by position again
    if (readNumberTextV020(text) === null) continue
    const inEn = readNumberTextV020(text, LOCALE_TAGS.en) !== null, inDe = readNumberTextV020(text, LOCALE_TAGS.de) !== null
    if (inEn && !inDe) en ??= text
    if (inDe && !inEn) de ??= text
  }
  if (en !== undefined && de === undefined) return base({ source: 'settled', tag: 'en', locale: LOCALE_TAGS.en! })
  if (de !== undefined && en === undefined) return base({ source: 'settled', tag: 'de', locale: LOCALE_TAGS.de! })
  // 2026-10-06: a document that writes one figure as "1,500.00" and another as "1.500,00" settles nothing, and none of its
  // figures written with a "." or "," is read (it used to read each by itself, so both became 1500 and the sum held)
  if (en !== undefined && de !== undefined) return base({ source: 'mixed', note: `the document mixes both number formats (${JSON.stringify(en.trim())} and ${JSON.stringify(de.trim())})` })
  return base({ source: 'none' })
}

/** Every string value in a document, at most `depth` levels down (keys are not values). For formatOfTexts over a whole document. */
export function textValues(doc: unknown, depth = 4): string[] {
  if (typeof doc === 'string') return [doc]
  if (depth === 0 || doc === null || typeof doc !== 'object') return []
  return (Array.isArray(doc) ? doc : Object.values(doc as Json)).flatMap(v => textValues(v, depth - 1))
}

/**
 * A dotted path (`a.b[0].c`) that is absent as written but present when one or more of its keys differs only by spaces or
 * invisible characters: the path as the document writes it (`a.b[0].c `), else undefined.
 */
export function nearMissPath(doc: unknown, path: string): string | undefined {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = doc
  const written: string[] = []
  let missed = false
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    const o = cur as Json
    if (Object.prototype.hasOwnProperty.call(o, p)) { written.push(p); cur = o[p]; continue }
    const k = Object.keys(o).find(x => x !== p && foldKey(x) === p)
    if (k === undefined) return undefined
    missed = true
    written.push(k)
    cur = o[k]
  }
  return missed && cur !== undefined && cur !== null && cur !== '' ? written.join('.') : undefined
}

/** Does the lenient reading the bridge made agree with the strict one (amounts to the cent, the rest to 1e-9)? */
function agrees(kind: NumericKind, lenient: unknown, strict: number | null): boolean {
  if (strict === null || typeof lenient !== 'number') return true // a CJK numeral, or a value the bridge did not read as a number
  if (kind === 'rate') return Math.abs(lenient - strict) < 1e-9 || Math.abs(lenient - strict * 100) < 1e-9 || Math.abs(lenient * 100 - strict) < 1e-9
  if (kind === 'amount') return Math.round(strict * 100) / 100 === lenient
  return Math.abs(lenient - strict) <= 1e-9 * Math.max(1, Math.abs(strict))
}

/** What the strict pass did to one context: the roles it refused, with the reason a computed role that needs one should give. */
export type Refusals = Partial<Record<UniversalRole, Absence>>

/**
 * Part 1 on one binding context, in the document's number format (documentFormat): every numeric binding read from text either
 * reads strictly (kept; rebound to the strict value when the lenient reading differs, except a rate, whose percent-or-fraction
 * reading stays the bridge's) or is refused (its value becomes the raw text). Returns the refusals, each an UNPARSEABLE absence
 * naming the field and the value as reported.
 */
export function strictenBindings(ctx: BindingContext, ontology: DomainOntology, line?: number, format: DocumentFormat = { source: 'none' }): Refusals {
  const refused: Refusals = {}
  /** roles refused for holding more digits than a double holds, with their reason (2026-10-05) */
  const inexact = new Map<UniversalRole, string>()
  for (const [role, b] of Object.entries(ctx.bindings) as [UniversalRole, BoundValue | undefined][]) {
    if (!b || b.source === 'computed') continue
    const kind = numericKindOf(ontology, role)
    if (!kind) continue
    const raw = b.originalValue
    if (typeof raw !== 'string' || raw.trim() === '' || b.value === null || b.value === undefined) continue
    const s = strictNumberText(raw, kind, format)
    if (s.ok && agrees(kind, b.value, s.value)) continue
    if (s.ok && kind !== 'rate' && s.value !== null) {
      const value = kind === 'amount' ? Math.round(s.value * 100) / 100 : s.value
      ctx.bindings[role] = { ...b, value, normalizedValue: value, normalizations: [`strict_reading_${format.tag ?? 'plain'}`] }
      continue
    }
    const why = s.ok ? 'the lenient reading and the strict one differ' : s.why
    ctx.bindings[role] = { ...b, value: raw, normalizedValue: raw, normalizations: ['strict_reading_refused'] }
    refused[role] = { reason: 'UNPARSEABLE', detail: `${b.field.replace(/\[\*\]/g, line === undefined ? '' : `[${line}]`)} is ${JSON.stringify(raw)}, which does not read as one number (${why}): not read, never guessed` }
    if (!s.ok && s.inexact) inexact.set(role, refused[role]!.detail)
  }
  // 2026-10-05: the bridge computes some roles (a line's price × quantity) while it binds, before this pass, from the
  // lenient reading. A role computed from a figure refused here for having more digits than a double holds is dropped too, with
  // the same reason, so no check judges the rounded figure through it. (Roles computed from a figure refused for another reason
  // are left as they were: that wider question is a reading change of its own.)
  if (inexact.size > 0) {
    for (const [role, b] of Object.entries(ctx.bindings) as [UniversalRole, BoundValue | undefined][]) {
      if (!b || b.source !== 'computed') continue
      const from = [...inexact.keys()].find(r => new RegExp(`\\b${r}\\b`).test(b.field))
      if (from === undefined) continue
      // the refused figure's own text stands in for the computed value, so every check on it says can't tell (UNPARSEABLE), as
      // it does on the figure itself
      const raw = String(ctx.bindings[from]?.value ?? '')
      ctx.bindings[role] = { ...b, value: raw, normalizedValue: raw, normalizations: ['strict_reading_refused'] }
      refused[role] = { reason: 'UNPARSEABLE', detail: `computed from ${inexact.get(from)}` }
    }
  }
  return refused
}

/** The document-level and line-level paths of an ontology's mappings, each with its role (first mapping wins). */
function pathRoles(ontology: DomainOntology): { doc: Map<string, UniversalRole>; line: Map<string, UniversalRole> } {
  const doc = new Map<string, UniversalRole>()
  const line = new Map<string, UniversalRole>()
  for (const m of ontology.mappings) {
    for (const p of [m.fieldPath, ...(m.alternativePaths ?? [])]) {
      const at = p.indexOf('[*].')
      if (at >= 0) { const k = p.slice(at + 4); if (!line.has(k)) line.set(k, m.role) } // the path inside a line, e.g. "amount"
      else if (!doc.has(p)) doc.set(p, m.role)
    }
  }
  return { doc, line }
}

const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x)

/** The keys of an object and of its object-valued children, as dotted paths ("totals.total "). */
function keyPaths(o: Json, depth = 2, prefix = ''): string[] {
  const out: string[] = []
  for (const k of Object.keys(o)) {
    out.push(`${prefix}${k}`)
    if (depth > 1 && isObj(o[k])) out.push(...keyPaths(o[k] as Json, depth - 1, `${prefix}${k}.`))
  }
  return out
}

/**
 * Part 2: a near-miss key names a role the bridge did not bind (or bound only from that key): refuse it by name. Mutates the
 * contexts (a binding read from a near-miss key is removed) and returns the refusals for the document and for each line.
 */
export function refuseNearMissKeys(extraction: Json, docCtx: BindingContext, lineCtxs: BindingContext[], ontology: DomainOntology, lineKey: string | undefined): { doc: Refusals; lines: Refusals[] } {
  const { doc, line } = pathRoles(ontology)
  const out = { doc: {} as Refusals, lines: lineCtxs.map((): Refusals => ({})) }
  const refuse = (ctx: BindingContext, into: Refusals, key: string, path: string, role: UniversalRole): void => {
    const b = ctx.bindings[role]
    // bound from one of its own paths (exact or alternative, confidence 95 or more): read, as before. A fuzzy guess (the bridge
    // records its field as "fuzzy", confidence 75, and may have guessed another field's value) gives way to the named key.
    if (b && b.confidence >= 95 && b.field.replace(/\[\d+\]|\[\*\]/g, '') !== key.replace(/\[\d+\]/g, '')) return
    delete ctx.bindings[role]
    into[role] = { reason: 'UNPARSEABLE', detail: `${role} was reported under the key ${JSON.stringify(key)}, which is not its path "${path}" but differs from it only by spaces or invisible characters: not read (correct the key and run the check again)` }
  }
  for (const kp of keyPaths(extraction)) {
    const folded = kp.split('.').map(foldKey).join('.')
    if (folded === kp) continue
    const role = doc.get(folded)
    if (role) refuse(docCtx, out.doc, kp, folded, role)
  }
  const items = lineKey !== undefined && Array.isArray(extraction[lineKey]) ? (extraction[lineKey] as unknown[]) : []
  items.forEach((it, i) => {
    if (!isObj(it) || !lineCtxs[i]) return
    for (const k of Object.keys(it)) {
      const folded = foldKey(k)
      if (folded === k) continue
      const role = line.get(folded)
      if (role) refuse(lineCtxs[i]!, out.lines[i]!, `${lineKey}[${i}].${k}`, `${lineKey}[${i}].${folded}`, role)
    }
  })
  return out
}

/** A top-level key that is one of `keys` apart from spaces or invisible characters, when the proper key is absent. */
export function nearMissArrayKey(extraction: Json, keys: readonly string[]): string | undefined {
  if (keys.some(k => Array.isArray(extraction[k]))) return undefined
  return Object.keys(extraction).find(k => k !== foldKey(k) && keys.includes(foldKey(k)) && Array.isArray(extraction[k]))
}
