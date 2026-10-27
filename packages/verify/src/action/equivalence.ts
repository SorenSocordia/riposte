/**
 * Typed value comparison for the action gate (action@0.2.0, 2026-09-29): the right value written differently is the same value.
 *
 * action@0.1.0 compared an argument with an approved value as text (String(a) === String(b)), so an approved amount written
 * 980.5 (a JSON number) and a proposed "980.50" (a string) did not match: a clean call was held. A gate that blocks correct
 * actions gets switched off. This module decides when two written forms are the SAME value. Every equivalence is typed by the
 * argument (`sources.fields`); none is global. Pure: no I/O, no clock, no floating-point arithmetic.
 *
 *   identity (every type)  equal as written under 0.1.0, so 0.2.0 never fails a comparison 0.1.0 passed
 *   undeclared             identity, or a JSON number and a string that is the same number as a plain numeral: 980.5 ≡ "980.50".
 *                          Two strings are never compared as numbers unless the field says it is one.
 *   text                   identity only
 *   amount [currency]      the same signed value exactly; thousands separators (comma, groups of three); trailing zeros; a
 *                          currency symbol or ISO code, read only against the declared currency
 *   identifier [flags]     case-insensitive and/or whitespace-insensitive when declared; never strips a leading zero or punctuation
 *   date [order]           the same calendar date: ISO, year-first with slashes, month-name forms; D/M/Y or M/D/Y only in a
 *                          declared order
 *   rate unit              percent and fraction, in the declared unit ("12.5%" ≡ 0.125 when unit is fraction)
 *
 * NOT the same value, under any type: a leading zero added or removed; any other scale (exact comparison; a comma is never a
 * decimal mark); a sign change (negative zero does not read); another argument's value; a numeric day-month date without a
 * declared order (03/04/2026); a currency marker without a declared currency, or one that cannot denote it; percent against
 * fraction without a declared unit.
 */

import type { Scalar } from '../verdict/schema.js'

export type FieldType =
  | { type: 'text' }
  | { type: 'amount'; currency?: string }
  | { type: 'identifier'; case_insensitive?: boolean; whitespace_insensitive?: boolean }
  | { type: 'date'; order?: 'DMY' | 'MDY' }
  | { type: 'rate'; unit: 'percent' | 'fraction' }

/** How an argument is compared: its declared type, or `undeclared` (identity plus the numeral rule). */
export type Comparison = FieldType | { type: 'undeclared' }

export type Match =
  | { kind: 'identical' }
  | { kind: 'equivalent'; canonical: string; steps: string[] }
  | { kind: 'different' }

const IDENTICAL: Match = { kind: 'identical' }
const DIFFERENT: Match = { kind: 'different' }
const TEXT: Comparison = { type: 'text' }
const UNDECLARED: Comparison = { type: 'undeclared' }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const CODE = /^[A-Z]{3}$/

// ── exact decimals ───────────────────────────────────────────────────────────────────────────────────────────────────

/** An exact decimal: (neg ? -1 : 1) × digits × 10^-scale, normalized (no trailing fractional zero; zero is never negative). */
interface Dec { neg: boolean; digits: bigint; scale: number }

function normalize(neg: boolean, digits: bigint, scale: number): Dec {
  while (scale > 0 && digits % 10n === 0n) { digits /= 10n; scale-- }
  return { neg: neg && digits !== 0n, digits, scale }
}
const decEqual = (a: Dec, b: Dec): boolean => a.neg === b.neg && a.digits === b.digits && a.scale === b.scale
function decString(d: Dec): string {
  const s = d.digits.toString().padStart(d.scale + 1, '0')
  const body = d.scale === 0 ? s : `${s.slice(0, s.length - d.scale)}.${s.slice(s.length - d.scale)}`
  return d.neg ? `-${body}` : body
}

const NUMERAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/
/** A plain numeral in the JSON number grammar without an exponent (no leading zero, plus sign, separator or space). */
function numeral(s: string): Dec | undefined {
  const m = NUMERAL.exec(s)
  if (!m) return undefined
  const frac = m[3] ?? ''
  const d = normalize(m[1] === '-', BigInt(m[2]! + frac), frac.length)
  if (m[1] === '-' && d.digits === 0n) return undefined // negative zero does not read
  return d
}
/** A finite JSON number, by its shortest round-trip form; one written with an exponent does not read. */
function jsonNumber(n: number): Dec | undefined {
  if (!Number.isFinite(n)) return undefined
  const s = String(n)
  return /e/i.test(s) ? undefined : numeral(s)
}

// ── the types ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An ISO currency symbol table: the currencies each symbol can denote. A symbol reads only against a declared currency it can denote. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  'US$': ['USD'], 'CA$': ['CAD'], 'AU$': ['AUD'], 'NZ$': ['NZD'], 'HK$': ['HKD'], 'NT$': ['TWD'],
  'C$': ['CAD'], 'A$': ['AUD'], 'S$': ['SGD'], 'R$': ['BRL'],
  '$': ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN', 'ARS', 'CLP', 'COP', 'TWD'],
  '€': ['EUR'], '£': ['GBP'], '¥': ['JPY', 'CNY'], '₹': ['INR'], '₩': ['KRW'], '₪': ['ILS'], '₱': ['PHP'], '₫': ['VND'],
  '฿': ['THB'], '₺': ['TRY'], '₽': ['RUB'], '₦': ['NGN'], '₴': ['UAH'],
}
const SYMBOLS = Object.keys(CURRENCY_SYMBOLS).sort((a, b) => b.length - a.length) // longest first: US$ before $

interface Amount { value: Dec; marker?: { kind: 'symbol' | 'code'; text: string }; grouped: boolean }
// The grouped form first, so "1,234" is read whole rather than stopping at "1".
const AMOUNT_N = /^([1-9][0-9]{0,2}(?:,[0-9]{3})+|0|[1-9][0-9]*)(?:\.([0-9]+))?/

/** An amount as written: [-][marker]N[marker], at most one marker and one minus (first, or right after a prefix marker). */
function amount(x: Scalar): Amount | undefined {
  if (typeof x === 'number') { const value = jsonNumber(x); return value ? { value, grouped: false } : undefined }
  if (typeof x !== 'string') return undefined
  let t = x.trim(), neg = false, marker: Amount['marker']
  if (t.startsWith('-')) { neg = true; t = t.slice(1) }
  const sym = SYMBOLS.find(s => t.startsWith(s))
  if (sym !== undefined) {
    marker = { kind: 'symbol', text: sym }
    t = t.slice(sym.length)
    if (t.startsWith(' ')) t = t.slice(1)
  } else if (/^[A-Z]{3} /.test(t)) {
    marker = { kind: 'code', text: t.slice(0, 3) }
    t = t.slice(4)
  }
  if (marker && !neg && t.startsWith('-')) { neg = true; t = t.slice(1) }
  const m = AMOUNT_N.exec(t)
  if (!m) return undefined
  const rest = t.slice(m[0].length)
  if (rest !== '') {
    if (marker) return undefined
    const code = /^ ([A-Z]{3})$/.exec(rest)
    const suffix = code ? undefined : SYMBOLS.find(s => rest === s || rest === ` ${s}`)
    if (code) marker = { kind: 'code', text: code[1]! }
    else if (suffix !== undefined) marker = { kind: 'symbol', text: suffix }
    else return undefined
  }
  const value = numeral(`${neg ? '-' : ''}${m[1]!.replace(/,/g, '')}${m[2] !== undefined ? `.${m[2]}` : ''}`)
  return value ? { value, ...(marker ? { marker } : {}), grouped: m[1]!.includes(',') } : undefined
}
function currencyOk(a: Amount, currency: string | undefined): boolean {
  if (!a.marker) return true
  if (currency === undefined) return false // a marker reads only against a declared currency
  return a.marker.kind === 'code' ? a.marker.text === currency : (CURRENCY_SYMBOLS[a.marker.text] ?? []).includes(currency)
}

const MONTHS: Readonly<Record<string, { m: number; abbrev: boolean }>> = (() => {
  const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const out: Record<string, { m: number; abbrev: boolean }> = {}
  names.forEach((n, i) => { out[n.slice(0, 3)] = { m: i + 1, abbrev: true }; out[n] = { m: i + 1, abbrev: n.length === 3 } })
  out.sept = { m: 9, abbrev: true }
  return out
})()
const daysIn = (y: number, m: number): number => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
function ymd(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return undefined
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function monthOf(word: string, dot: string | undefined): number | undefined {
  const hit = MONTHS[word.toLowerCase()]
  return hit && (dot === undefined || hit.abbrev) ? hit.m : undefined
}
/** A calendar date as YYYY-MM-DD, or undefined when the form does not read (a numeric day-month form needs a declared order). */
function date(x: Scalar, order: 'DMY' | 'MDY' | undefined): string | undefined {
  if (typeof x !== 'string') return undefined
  const t = x.trim()
  let m = /^([0-9]{4})([-/])([0-9]{2})\2([0-9]{2})$/.exec(t)
  if (m) return ymd(Number(m[1]), Number(m[3]), Number(m[4]))
  m = /^([0-9]{1,2})(?:st|nd|rd|th)? ([A-Za-z]+)(\.)?,? ([0-9]{4})$/i.exec(t)
  if (m) { const mo = monthOf(m[2]!, m[3]); return mo === undefined ? undefined : ymd(Number(m[4]), mo, Number(m[1])) }
  m = /^([A-Za-z]+)(\.)? ([0-9]{1,2})(?:st|nd|rd|th)?,? ([0-9]{4})$/i.exec(t)
  if (m) { const mo = monthOf(m[1]!, m[2]); return mo === undefined ? undefined : ymd(Number(m[4]), mo, Number(m[3])) }
  m = /^([0-9]{1,2})([/.-])([0-9]{1,2})\2([0-9]{4})$/.exec(t)
  if (m && order) return order === 'DMY' ? ymd(Number(m[4]), Number(m[3]), Number(m[1])) : ymd(Number(m[4]), Number(m[1]), Number(m[3]))
  return undefined
}

/** A rate in the declared unit: a bare number is in that unit; a numeral followed by % is a percent. */
function rate(x: Scalar, unit: 'percent' | 'fraction'): { value: Dec; percentSign: boolean } | undefined {
  if (typeof x === 'number') { const value = jsonNumber(x); return value ? { value, percentSign: false } : undefined }
  if (typeof x !== 'string') return undefined
  const pct = /^(.*?) ?%$/.exec(x)
  const d = numeral(pct ? pct[1]! : x)
  if (!d) return undefined
  if (!pct || unit === 'percent') return { value: d, percentSign: pct !== null }
  return { value: normalize(d.neg, d.digits, d.scale + 2), percentSign: true } // p% as a fraction is p / 100
}

// ── declarations ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why a single field declaration is not a valid FieldType, or undefined. */
function fieldTypeProblem(t: unknown): string | undefined {
  if (!isObj(t)) return 'must be an object { type, ... }'
  const flags = (keys: string[]): string | undefined => {
    for (const k of Object.keys(t)) if (k !== 'type' && !keys.includes(k)) return `has an unknown key "${k}"`
    return undefined
  }
  switch (t.type) {
    case 'text': return flags([])
    case 'amount':
      if (t.currency !== undefined && (typeof t.currency !== 'string' || !CODE.test(t.currency))) return 'currency must be an ISO 4217 code (three capital letters)'
      return flags(['currency'])
    case 'identifier':
      for (const k of ['case_insensitive', 'whitespace_insensitive']) if (t[k] !== undefined && typeof t[k] !== 'boolean') return `${k} must be true or false`
      return flags(['case_insensitive', 'whitespace_insensitive'])
    case 'date':
      if (t.order !== undefined && t.order !== 'DMY' && t.order !== 'MDY') return 'order must be "DMY" or "MDY"'
      return flags(['order'])
    case 'rate':
      if (t.unit !== 'percent' && t.unit !== 'fraction') return 'unit must be "percent" or "fraction"'
      return flags(['unit'])
    default: return 'type must be one of text, amount, identifier, date, rate'
  }
}

/** Why `sources.fields` is not a valid declaration ({ <argument>: FieldType }), or undefined. For the HTTP and MCP surfaces. */
export function fieldsProblem(fields: unknown): string | undefined {
  if (!isObj(fields)) return 'must be { <argument>: { type, ... } }'
  for (const [k, t] of Object.entries(fields)) {
    const p = fieldTypeProblem(t)
    if (p) return `.${k} ${p}`
  }
  return undefined
}

/**
 * The comparison for one argument. Undeclared → `undeclared`. An invalid declaration, or a `fields` value that is not an
 * object, compares as text: it can only fail, never pass.
 */
export function comparisonFor(fields: unknown, arg: string): Comparison {
  if (fields === undefined) return UNDECLARED
  if (!isObj(fields)) return TEXT
  if (!Object.prototype.hasOwnProperty.call(fields, arg)) return UNDECLARED
  const t = fields[arg]
  return fieldTypeProblem(t) ? TEXT : t as FieldType
}

/** A comparison as a short code carried on 0.2.0 claims (operands.type), so any reader can recompute the match. */
export function comparisonCode(c: Comparison): string {
  switch (c.type) {
    case 'amount': return c.currency ? `amount:${c.currency}` : 'amount'
    case 'identifier': {
      const f = [c.case_insensitive ? 'case' : '', c.whitespace_insensitive ? 'whitespace' : ''].filter(Boolean).join(',')
      return f ? `identifier:${f}` : 'identifier'
    }
    case 'date': return c.order ? `date:${c.order}` : 'date'
    case 'rate': return `rate:${c.unit}`
    default: return c.type
  }
}

/** The comparison a code names, or undefined for an unknown code. */
export function comparisonFromCode(code: unknown): Comparison | undefined {
  if (typeof code !== 'string') return undefined
  if (code === 'undeclared' || code === 'text') return { type: code }
  if (code === 'amount') return { type: 'amount' }
  let m = /^amount:([A-Z]{3})$/.exec(code)
  if (m) return { type: 'amount', currency: m[1]! }
  if (code === 'identifier') return { type: 'identifier' }
  m = /^identifier:(case|whitespace|case,whitespace)$/.exec(code)
  if (m) return { type: 'identifier', ...(m[1]!.includes('case') ? { case_insensitive: true } : {}), ...(m[1]!.includes('whitespace') ? { whitespace_insensitive: true } : {}) }
  if (code === 'date') return { type: 'date' }
  m = /^date:(DMY|MDY)$/.exec(code)
  if (m) return { type: 'date', order: m[1] as 'DMY' | 'MDY' }
  m = /^rate:(percent|fraction)$/.exec(code)
  if (m) return { type: 'rate', unit: m[1] as 'percent' | 'fraction' }
  return undefined
}

// ── the comparison ───────────────────────────────────────────────────────────────────────────────────────────────────

/** action@0.1.0's comparison: equal as written. */
export const sameAsWritten = (approved: Scalar, proposed: Scalar): Match => (String(approved) === String(proposed) ? IDENTICAL : DIFFERENT)

/**
 * Compare an approved value with a proposed one under a comparison: identical (equal as written), equivalent (the same value
 * in another written form, with its canonical form and the readings used), or different. Symmetric in its two values.
 */
export function compareValues(approved: Scalar, proposed: Scalar, c: Comparison): Match {
  if (String(approved) === String(proposed)) return IDENTICAL
  switch (c.type) {
    case 'text': return DIFFERENT
    case 'undeclared': {
      const [n, s] = typeof approved === 'number' && typeof proposed === 'string' ? [approved, proposed]
        : typeof proposed === 'number' && typeof approved === 'string' ? [proposed, approved] : [undefined, undefined]
      if (n === undefined || s === undefined) return DIFFERENT
      const a = jsonNumber(n), b = numeral(s)
      return a && b && decEqual(a, b) ? { kind: 'equivalent', canonical: decString(a), steps: ['number and numeral'] } : DIFFERENT
    }
    case 'amount': {
      const a = amount(approved), b = amount(proposed)
      if (!a || !b || !currencyOk(a, c.currency) || !currencyOk(b, c.currency) || !decEqual(a.value, b.value)) return DIFFERENT
      const steps = ['same amount']
      if (a.grouped || b.grouped) steps.push('thousands separators')
      if (a.marker || b.marker) steps.push(`currency ${c.currency}`)
      return { kind: 'equivalent', canonical: `${decString(a.value)}${c.currency ? ` ${c.currency}` : ''}`, steps }
    }
    case 'identifier': {
      if (!c.case_insensitive && !c.whitespace_insensitive) return DIFFERENT
      const fold = (x: Scalar, caseToo: boolean, spaceToo: boolean): string => {
        let t = String(x)
        if (caseToo) t = t.toLowerCase()
        if (spaceToo) t = t.replace(/\s/g, '')
        return t
      }
      const cs = !!c.case_insensitive, ws = !!c.whitespace_insensitive
      const a = fold(approved, cs, ws)
      if (a !== fold(proposed, cs, ws)) return DIFFERENT
      // a reading was used when the values still differ without it
      const steps = [cs && fold(approved, false, ws) !== fold(proposed, false, ws) ? 'case' : '', ws && fold(approved, cs, false) !== fold(proposed, cs, false) ? 'whitespace' : ''].filter(Boolean)
      return { kind: 'equivalent', canonical: a, steps }
    }
    case 'date': {
      const a = date(approved, c.order), b = date(proposed, c.order)
      return a !== undefined && a === b ? { kind: 'equivalent', canonical: a, steps: ['date format'] } : DIFFERENT
    }
    case 'rate': {
      const a = rate(approved, c.unit), b = rate(proposed, c.unit)
      if (!a || !b || !decEqual(a.value, b.value)) return DIFFERENT
      return { kind: 'equivalent', canonical: `${decString(a.value)}${c.unit === 'percent' ? '%' : ''}`, steps: [a.percentSign !== b.percentSign ? 'percent and fraction' : 'number and numeral'] }
    }
  }
}
