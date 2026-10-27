/**
 * Absent vs unreadable (added 2026-10-03): the parts of a ruleset's `distinguish_unreadable` (types.ts) that do not need
 * the evaluator. An ABSENT field is one the document does not carry; an UNREADABLE one is printed but was not read. Only an
 * absent field may take its `default`. An unreadable one is an unresolved operand: the checks that read it abstain, so two
 * unreadable totals can never cancel into a PASS.
 *
 * Nothing here runs for a ruleset that does not opt in, so every verdict issued under one keeps its bytes.
 * Since engine 0.1.0 (2026-10-03) a ruleset is opted in unless it says `"distinguish_unreadable": false`; a verdict that
 * names engine 0.0.1 is re-performed with the old opt-in (declarative/evaluate.ts declarativeReading).
 */

import { foldDigits, parseCjkNumeral } from '../binding/forensic-normalizer.js'

/** Where the source text prints a field: the line one of its labels heads, or the line holding the reported raw value. */
export interface SourceLine {
  /** 1-based page, present only when the source text has page breaks (form feeds) */
  page?: number
  /** 1-based line within its page */
  line: number
  /** the line, whitespace collapsed, at most 120 characters */
  text: string
  /** the label that matched, when the line was found by label */
  label?: string
}

export interface Unreadable {
  /** how the field came to be unreadable: reported null, blank or as the marker; reported but not parseable; printed (its label heads a source line) but not reported; or (engine 0.2.0) reported under a key that differs from the path only by spaces or invisible characters */
  how: 'null' | 'blank' | 'marker' | 'unparseable' | 'label' | 'key' | 'withdrawn' | 'unsupported' | 'conflict' | 'qc_held' | 'qc_struck'
  /** the extraction path it was reported at (none for 'label': nothing was reported) */
  path?: string
  /** the value as reported, as JSON (null, "", "UNREADABLE", "°225.0"); none for 'label' */
  raw?: string
  /** where the source text prints it, when that is known */
  at?: SourceLine
  /**
   * Engine 0.3.0 only: why a field is struck although it may read. 'withdrawn': a STRIKE move removed it (`detail` is the
   * move and its reason); 'unsupported': an envelope value with no provenance, or provenance that is an assertion (E4);
   * 'conflict': two sources at one tier disagree and nothing higher ranks them (`detail` names both).
   * Engine 0.5.0 only: 'qc_held' and 'qc_struck': the value's own quality flag (provenance `qc`), read through the ruleset's
   * flags choice, holds it (the check waits) or strikes it (excluded from aggregates and algorithm series; a direct read abstains).
   * `detail` names the scheme, the flag and its meaning.
   */
  detail?: string
}

/** The marker an extractor may report for a value it saw and could not read (any case, surrounding whitespace ignored). */
export const UNREADABLE_MARKER = /^\s*unreadable\s*$/i

/** A reported value that says "seen, not read": null, a blank string, or the marker. Undefined = an ordinary value. */
export function unreadableMarker(raw: unknown): 'null' | 'blank' | 'marker' | undefined {
  if (raw === null) return 'null'
  if (typeof raw === 'string') {
    if (raw.trim() === '') return 'blank'
    if (UNREADABLE_MARKER.test(raw)) return 'marker'
  }
  return undefined
}

/**
 * A number written as text, read strictly: digits (any script), optional digit grouping (comma, period, space, no-break
 * space, apostrophe, Arabic separators), at most one decimal part, an optional currency symbol or three-letter code before
 * or after, and a sign, a trailing minus or parentheses. Nothing else. The general amount normalizer is lenient on purpose
 * (it strips what it takes for currency marks), so it reads "°20" as 20 and "1,2?5.00" as 12; under
 * `distinguish_unreadable` such a string is unreadable instead, because a misread number can cancel another into a PASS.
 */
const CUR = String.raw`(?:\p{Sc}|[A-Z]{3})`
const NUM = String.raw`(?:\p{Nd}{1,3}(?:[ ,.'  ٬]\p{Nd}{3})+|\p{Nd}+)(?:[.,٫]\p{Nd}+)?`
const STRICT_NUMBER = new RegExp(String.raw`^\s*(?:[-−+]\s*)?\(?\s*(?:${CUR}\s*)?(?:[-−+]\s*)?${NUM}\s*(?:${CUR})?\s*\)?\s*-?\s*$`, 'u')
export function isStrictNumberText(s: string): boolean {
  return STRICT_NUMBER.test(s)
}

/**
 * Engine 0.1.0's strict reading (2026-10-03), the default for every declarative ruleset: isStrictNumberText, or a whole,
 * well-formed CJK numeral ("十一万", "1万2千", with 円 / 元 / ¥ marks), which the normalizer's own CJK parser reads character by
 * character and refuses on any character it does not know. A numeral in another script is not a garbled number. Engine
 * 0.0.1's strict reading (under `distinguish_unreadable`) was isStrictNumberText alone, and stays that for its verdicts.
 */
export function isStrictNumberTextV010(s: string): boolean {
  return STRICT_NUMBER.test(s) || parseCjkNumeral(s.trim()) !== null
}

/** A reported value as a remedy shows it: JSON, at most 60 characters. */
export function showRaw(raw: unknown): string {
  let s: string
  try { s = JSON.stringify(raw) ?? String(raw) } catch { s = String(raw) }
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The source text's lines: a form feed starts a new page; lines are numbered within their page. */
export function sourceLines(text: string): { page: number; line: number; text: string }[] {
  const out: { page: number; line: number; text: string }[] = []
  text.split('\f').forEach((pageText, p) => pageText.split(/\r?\n/).forEach((l, i) => out.push({ page: p + 1, line: i + 1, text: l })))
  return out
}

const at = (l: { page: number; line: number; text: string }, multiPage: boolean, label?: string): SourceLine => {
  const t = collapse(l.text)
  return { ...(multiPage ? { page: l.page } : {}), line: l.line, text: t.length > 120 ? `${t.slice(0, 117)}...` : t, ...(label !== undefined ? { label } : {}) }
}

/**
 * The first source line one of the labels heads, or undefined. A label heads a line when the line, whitespace collapsed and
 * case folded, starts with it and the next character is not a letter or digit. A line whose rest starts with a lower-case
 * word and holds no digit ("Document allowances and charges") is a section heading, not the row, and does not count.
 */
export function findLabelLine(lines: readonly { page: number; line: number; text: string }[], labels: readonly string[]): SourceLine | undefined {
  const multiPage = lines.some(l => l.page > 1)
  const wanted = labels.map(l => collapse(l)).filter(l => l.length > 0)
  for (const l of lines) {
    const orig = collapse(l.text)
    const low = orig.toLowerCase()
    for (const label of wanted) {
      const lab = label.toLowerCase()
      if (!low.startsWith(lab)) continue
      const next = orig.charAt(lab.length)
      if (next !== '' && /[\p{L}\p{N}]/u.test(next)) continue
      const rest = orig.slice(lab.length).trim()
      if (rest !== '' && /^\p{Ll}+(\s|$)/u.test(rest) && !/\p{N}/u.test(rest)) continue
      return at(l, multiPage, label)
    }
  }
  return undefined
}

/** The first source line that holds the reported raw string (whitespace collapsed on both sides), or undefined. */
export function findRawLine(lines: readonly { page: number; line: number; text: string }[], raw: string): SourceLine | undefined {
  const r = collapse(raw)
  if (r.length < 2) return undefined
  const multiPage = lines.some(l => l.page > 1)
  const hit = lines.find(l => collapse(l.text).includes(r))
  return hit ? at(hit, multiPage) : undefined
}

/** A source line as a detail or remedy names it: `line 16 of the source text: "Document allowances EUR 20"`. */
export function renderAt(s: SourceLine): string {
  return `${s.page !== undefined ? `page ${s.page}, ` : ''}line ${s.line} of the source text: "${s.text}"`
}

const KIND_WORD: Record<string, string> = { amount: 'an amount', price: 'a price', quantity: 'a quantity', rate: 'a rate', bool: 'true or false', identifier: 'an identifier', string: 'text' }

/**
 * Engine 0.6.0 (2026-10-05; a cold reader in cold review round 3: "A person reads 20 there"): why a printed figure was not read, when
 * the line a field's label heads prints a number with no two decimals. An amount needs exactly two decimals under a strict reading
 * (docs/EXTRACTION-CONTRACT.md), so "Document allowances EUR 20" is read as not strict, never as 20.00. Undefined when the field is
 * not an amount or a price, when nothing was found by label, or when the figure there has two decimals (then the reason is another).
 */
export function notStrictNote(u: Unreadable, kind: string | undefined): string | undefined {
  if (u.how !== 'label' || !u.at || (kind !== undefined && kind !== 'amount' && kind !== 'price')) return undefined
  const text = u.at.text
  const rest = u.at.label !== undefined && text.toLowerCase().startsWith(u.at.label.toLowerCase()) ? text.slice(u.at.label.length) : text
  const fig = /\p{Nd}(?:[\p{Nd},.' ]*\p{Nd})?/u.exec(rest)?.[0]
  if (fig === undefined || /[.,]\p{Nd}{2}$/u.test(fig)) return undefined
  return `the line prints "${fig}": an amount needs two decimals, so "${fig}" is read as not strict${/[.,]/.test(fig) ? '' : `, never as ${fig}.00`}`
}

/** The insufficiency detail for one unreadable operand (in the hashed core of a verdict issued under an opting-in ruleset). */
export function describeUnreadable(role: string, u: Unreadable, kind: string | undefined, note?: string): string {
  const where = u.at ? `; the source prints it at ${renderAt(u.at)}` : ''
  switch (u.how) {
    case 'key': return `${role} was reported under the key ${JSON.stringify(u.path ?? '?')}, which is not its path but differs from it only by spaces or invisible characters: not read${where}`
    case 'label': return `${role} is printed but no value was read: the label "${u.at?.label ?? '?'}" heads ${u.at ? renderAt(u.at) : 'a source line'}${note !== undefined ? `; ${note}` : ''}`
    case 'null': return `${role} was reported as null at ${u.path ?? '?'}: seen, not read${where}`
    case 'blank': return `${role} was reported as an empty string at ${u.path ?? '?'}: seen, not read${where}`
    case 'marker': return `${role} was reported as ${u.raw ?? '"UNREADABLE"'} at ${u.path ?? '?'}: seen, not read${where}`
    case 'withdrawn': return `${role} at ${u.path ?? '?'} is struck: withdrawn${u.detail ? ` (${u.detail})` : ''}`
    case 'unsupported': return `${role} at ${u.path ?? '?'} is struck: an unsupported assertion${u.detail ? ` (${u.detail})` : ''}; a value with no provenance is never load-bearing`
    case 'conflict': return `${role} at ${u.path ?? '?'} is struck: ${u.detail ?? 'two sources at one tier disagree'}`
    case 'qc_held': return `${role} at ${u.path ?? '?'} is held by its quality flag: ${u.detail ?? 'the flags choice holds it'}`
    case 'qc_struck': return `${role} at ${u.path ?? '?'} is struck by its quality flag: ${u.detail ?? 'the flags choice strikes it'}`
    // engine 0.6.0 (2026-10-06): a figure refused for a character it holds, or for a document mixing both formats, says why
    default: return `${role} at ${u.path ?? '?'} reads ${u.raw ?? '?'}, which is not ${KIND_WORD[kind ?? 'amount'] ?? 'a value'} the rule can use${u.detail !== undefined ? ` (${u.detail})` : ''}${where}`
  }
}

// ── Engine 0.2.0 (2026-10-03): numbers read whole, never guessed by position (red-team F14) ───────────────────────────────

/** A declared number format: the decimal mark and the grouping mark ('' = no grouping). */
export interface NumberLocale { decimal: '.' | ','; group: ',' | '.' | ' ' | "'" | '' }

/** The tags a ruleset's `locale` may name. */
export const LOCALE_TAGS: Readonly<Record<string, NumberLocale>> = Object.freeze({
  en: { decimal: '.', group: ',' }, de: { decimal: ',', group: '.' }, fr: { decimal: ',', group: ' ' }, ch: { decimal: '.', group: "'" },
})

/** A ruleset's `locale` as marks; undefined when none is declared; null when it is not a valid declaration. */
export function resolveLocale(l: unknown): NumberLocale | undefined | null {
  if (l === undefined) return undefined
  if (typeof l === 'string') return LOCALE_TAGS[l] ?? null
  if (l === null || typeof l !== 'object' || Array.isArray(l)) return null
  const { decimal, group } = l as { decimal?: unknown; group?: unknown }
  if (decimal !== '.' && decimal !== ',') return null
  if (group !== ',' && group !== '.' && group !== ' ' && group !== "'" && group !== '') return null
  if (decimal === group) return null
  return { decimal, group }
}

const SPACE_MARK = /^[\s\u00A0\u202F\u2009\u2007]$/u
/** sign, then an optional parenthesis, currency, sign, the numeric core, currency, parenthesis, trailing minus */
const NUMBER_V020 = new RegExp(String.raw`^\s*(?:([-−+])\s*)?(\()?\s*(?:${CUR}\s*)?(?:([-−+])\s*)?(\p{Nd}(?:[\p{Nd} ,.'\u00A0\u202F\u2009\u2007٬٫]*\p{Nd})?)\s*(?:${CUR})?\s*(\))?\s*(-)?\s*$`, 'u')

/**
 * Engine 0.2.0's strict reading of a number written as text: the string as one canonical decimal ("-1234.56"), or null when it
 * is not strictly a number or its grouping is ambiguous. Read whole: a grouped number is never truncated at a separator.
 *
 * Without a declared locale:
 *   - digits only; a run of one separator kind repeated, every group three digits (a grouping); or two kinds, the last occurring
 *     once as the decimal mark and the other grouping in threes;
 *   - a single "." followed by 1-2 or 4+ digits is a decimal point; "'" and the Arabic marks (٬ grouping, ٫ decimal) read as such;
 *   - AMBIGUOUS, so unreadable: a single "." or "," followed by exactly 3 digits ("1.234", "1,234": a thousands group or three
 *     decimals), a single "," followed by any other count ("1,23": a decimal comma), and any space grouping ("1 234": one number or
 *     two).
 * With a locale, exactly its marks are read: its decimal mark at most once and last, its grouping mark in threes, nothing else.
 * A whole, well-formed CJK numeral reads as itself (the normalizer's own parser reads it).
 */
export function readNumberTextV020(raw: string, locale?: NumberLocale): { canonical: string; changed: boolean } | null {
  const trimmed = raw.trim()
  if (trimmed !== '' && parseCjkNumeral(trimmed) !== null) return { canonical: trimmed, changed: false }
  const m = NUMBER_V020.exec(raw)
  if (!m) return null
  const [, lead, open, inner, core, close, trail] = m
  if ((open === undefined) !== (close === undefined)) return null
  const minus = (s: string | undefined): boolean => s === '-' || s === '−'
  const negatives = [minus(lead), minus(inner), open !== undefined, trail !== undefined].filter(Boolean).length
  if (negatives > 1) return null
  // groups of digits and the single separator between each pair
  const chars = [...foldDigits(core as string).text]
  const groups: string[] = ['']
  const seps: string[] = []
  for (const ch of chars) {
    if (/[0-9]/.test(ch)) { groups[groups.length - 1] += ch; continue }
    if (groups[groups.length - 1] === '') return null // two separators in a row
    seps.push(SPACE_MARK.test(ch) ? ' ' : ch)
    groups.push('')
  }
  if (groups.some(g => g === '' || !/^[0-9]+$/.test(g))) return null
  // a grouping: a first group of 1-3 digits that is not a zero group ("0.125" is never 125), then groups of exactly 3
  const grouped = (gs: string[]): boolean => gs.length >= 1 && gs[0]!.length >= 1 && gs[0]!.length <= 3 && !(gs.length > 1 && gs[0]!.startsWith('0')) && gs.slice(1).every(g => g.length === 3)
  let intPart: string
  let decPart: string | undefined
  if (seps.length === 0) intPart = groups[0]!
  else if (locale) {
    const decAt = seps.indexOf(locale.decimal)
    if (decAt >= 0 && (decAt !== seps.length - 1 || seps.lastIndexOf(locale.decimal) !== decAt)) return null
    const groupSeps = decAt >= 0 ? seps.slice(0, -1) : seps
    if (groupSeps.some(s => s !== locale.group || locale.group === '')) return null
    const intGroups = decAt >= 0 ? groups.slice(0, -1) : groups
    if (groupSeps.length > 0 && !grouped(intGroups)) return null
    intPart = intGroups.join('')
    decPart = decAt >= 0 ? groups[groups.length - 1] : undefined
  } else {
    const kinds = [...new Set(seps)]
    const last = seps[seps.length - 1]!
    const after = groups[groups.length - 1]!
    if (kinds.includes(' ')) return null // a space grouping needs a declared locale
    if (kinds.length === 1) {
      const k = kinds[0]!
      if (seps.length > 1) {
        if (k === '٫' || !grouped(groups)) return null
        intPart = groups.join('')
      } else if (k === '.') {
        // three digits after one "." could be a thousands group, unless the first group starts with 0 ("0.125"): a grouped
        // number never begins with a zero group, so that one is a decimal point
        if (after.length === 3 && !groups[0]!.startsWith('0')) return null
        intPart = groups[0]!; decPart = after
      } else if (k === '٫') {
        intPart = groups[0]!; decPart = after
      } else if (k === "'" || k === '٬') {
        if (!grouped(groups)) return null
        intPart = groups.join('')
      } else return null // a single ",": a thousands group or a decimal comma; never guessed
    } else if (kinds.length === 2) {
      if (seps.indexOf(last) !== seps.length - 1) return null // the decimal mark occurs once, last
      if (last !== '.' && last !== ',' && last !== '٫') return null
      if (kinds.find(k => k !== last) === '٫') return null // the Arabic decimal mark never groups
      const intGroups = groups.slice(0, -1)
      if (!grouped(intGroups)) return null
      intPart = intGroups.join('')
      decPart = after
    } else return null
  }
  const neg = negatives === 1 && !/^0+$/.test(intPart + (decPart ?? ''))
  const canonical = `${neg ? '-' : ''}${intPart}${decPart !== undefined ? `.${decPart}` : ''}`
  return { canonical, changed: canonical !== trimmed }
}
