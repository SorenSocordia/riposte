/**
 * Declared value readers for completeness reconciliation: amounts, dates and keys are read ONLY by the rules the mapping
 * declares. Nothing is inferred from the data (no "this looks European", no "this looks like MM/DD"). A value the declared
 * rule cannot read is a problem with a reason, never a guess.
 *
 * Amounts are exact decimals (a BigInt of units at a stated scale), so an exact comparison is exact: 1894.93 − 1894.92 is
 * 0.01, not 0.010000000000218279.
 */

// ── exact decimals ──────────────────────────────────────────────────────────────────────────────────────────────────

/** value = units / 10^scale. Normalized: no trailing zeros in the fraction (scale is minimal), and zero is never negative. */
export interface Dec { units: bigint; scale: number }

const TEN = 10n
const pow10 = (n: number): bigint => TEN ** BigInt(n)

function normDec(units: bigint, scale: number): Dec {
  while (scale > 0 && units % TEN === 0n) { units /= TEN; scale-- }
  return { units, scale }
}

const at = (d: Dec, scale: number): bigint => d.units * pow10(scale - d.scale)

export function decAdd(a: Dec, b: Dec): Dec {
  const s = Math.max(a.scale, b.scale)
  return normDec(at(a, s) + at(b, s), s)
}

export function decSub(a: Dec, b: Dec): Dec {
  const s = Math.max(a.scale, b.scale)
  return normDec(at(a, s) - at(b, s), s)
}

export function decMul(a: Dec, b: Dec): Dec {
  return normDec(a.units * b.units, a.scale + b.scale)
}

export function decAbs(a: Dec): Dec {
  return a.units < 0n ? { units: -a.units, scale: a.scale } : a
}

export function decCmp(a: Dec, b: Dec): number {
  const s = Math.max(a.scale, b.scale)
  const x = at(a, s), y = at(b, s)
  return x < y ? -1 : x > y ? 1 : 0
}

export const DEC_ZERO: Dec = { units: 0n, scale: 0 }

/** The canonical decimal string: "-1234.5", "0", "0.07". */
export function decToString(d: Dec): string {
  const neg = d.units < 0n
  const digits = (neg ? -d.units : d.units).toString()
  if (d.scale === 0) return (neg ? '-' : '') + digits
  const padded = digits.padStart(d.scale + 1, '0')
  return (neg ? '-' : '') + padded.slice(0, padded.length - d.scale) + '.' + padded.slice(padded.length - d.scale)
}

/** A plain decimal literal ("-12.50", "3", ".5", "1e-7") to an exact Dec, or undefined. */
function decFromLiteral(s: string): Dec | undefined {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s)
  if (!m) return undefined
  const [, sign, int = '', frac = '', exp] = m
  if (int === '' && frac === '') return undefined
  let units = BigInt((int || '0') + frac)
  let scale = frac.length
  if (exp !== undefined) {
    const e = Number(exp)
    if (!Number.isSafeInteger(e) || Math.abs(e) > 400) return undefined
    if (e >= scale) { units *= pow10(e - scale); scale = 0 } else scale -= e
  }
  if (sign === '-') units = -units
  return normDec(units, scale)
}

/** Largest magnitude read exactly from a JSON/JS number: beyond it the double may not be the literal that was written. */
const NUMBER_EXACT_LIMIT = 1e15

/** A JS number as the exact decimal it prints as (the shortest round-trip literal), or a problem. */
export function decFromNumber(n: number): Dec | { problem: string } {
  if (!Number.isFinite(n)) return { problem: `${n} is not a finite number` }
  if (Math.abs(n) >= NUMBER_EXACT_LIMIT) return { problem: `${n} is too large to be read exactly from a number; supply it as a string` }
  const d = decFromLiteral(String(n))
  return d ?? { problem: `${n} does not print as a decimal` }
}

/**
 * How an amount written as TEXT is read. Every rule is declared; the defaults are the strictest reading.
 *   decimal          the decimal separator. Default '.'.
 *   group            a digit-grouping separator, accepted ONLY between groups of three digits. Default: none (a grouped
 *                    number is refused, with the row, until the grouping is declared).
 *   strip            symbols deleted before reading (e.g. ["$", "€", "USD"]). Default: none.
 *   parens_negative  "(123.45)" reads as −123.45. Default false.
 *   trailing_minus   "123.45-" reads as −123.45 (an SAP export habit). Default false.
 */
export interface AmountFormat {
  decimal?: '.' | ','
  group?: ',' | '.' | ' ' | "'" | ''
  strip?: string[]
  parens_negative?: boolean
  trailing_minus?: boolean
}

export function effectiveAmountFormat(f: AmountFormat = {}): Required<AmountFormat> {
  const decimal = f.decimal ?? '.'
  const group = f.group ?? ''
  if (decimal !== '.' && decimal !== ',') throw new RangeError(`amount_format.decimal must be "." or "," (got ${JSON.stringify(f.decimal)})`)
  if (![',', '.', ' ', "'", ''].includes(group)) throw new RangeError(`amount_format.group must be one of "," "." " " "'" or "" (got ${JSON.stringify(f.group)})`)
  if (group !== '' && group === decimal) throw new RangeError(`amount_format.group and amount_format.decimal cannot both be ${JSON.stringify(decimal)}`)
  const strip = f.strip ?? []
  if (!Array.isArray(strip) || strip.some(s => typeof s !== 'string' || s === '' || /[\d]/.test(s))) throw new RangeError('amount_format.strip must be a list of non-empty symbols without digits')
  return { decimal, group, strip: [...strip], parens_negative: f.parens_negative ?? false, trailing_minus: f.trailing_minus ?? false }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Read an amount (text by the declared format; a number exactly as it prints). */
export function readAmount(raw: unknown, fmt: Required<AmountFormat>): Dec | { problem: string } {
  if (typeof raw === 'number') return decFromNumber(raw)
  if (typeof raw !== 'string') return { problem: `${JSON.stringify(raw)} is not an amount (a number or text)` }
  let s = raw.trim()
  for (const sym of fmt.strip) s = s.split(sym).join('')
  s = s.trim()
  let neg = false
  if (fmt.parens_negative && /^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  if (fmt.trailing_minus && s.endsWith('-') && !s.startsWith('-')) { neg = !neg; s = s.slice(0, -1).trim() }
  let sign = ''
  if (s.startsWith('-') || s.startsWith('+')) { sign = s[0]!; s = s.slice(1) }
  const d = escapeRe(fmt.decimal)
  const plain = new RegExp(`^\\d+(?:${d}\\d+)?$|^${d}\\d+$`)
  let body: string | undefined
  if (plain.test(s)) body = s
  else if (fmt.group !== '') {
    const g = escapeRe(fmt.group)
    if (new RegExp(`^\\d{1,3}(?:${g}\\d{3})+(?:${d}\\d+)?$`).test(s)) body = s.split(fmt.group).join('')
  }
  if (body === undefined) {
    const hint = fmt.group === '' && /\d[,.' ]\d{3}(?:\D|$)/.test(s) ? ' (it looks digit-grouped: declare amount_format.group to read it)' : ''
    return { problem: `${JSON.stringify(raw)} is not an amount under the declared format (decimal ${JSON.stringify(fmt.decimal)}, group ${JSON.stringify(fmt.group)})${hint}` }
  }
  const lit = decFromLiteral(sign + body.replace(fmt.decimal, '.'))
  if (!lit) return { problem: `${JSON.stringify(raw)} is not an amount` }
  return neg ? { units: -lit.units, scale: lit.scale } : lit
}

/** A declared constant (a tolerance): a number or a plain decimal string ("0.01"). */
export function readConstant(raw: unknown, what: string): Dec {
  const d = typeof raw === 'number' ? decFromNumber(raw) : typeof raw === 'string' ? (decFromLiteral(raw.trim()) ?? { problem: 'not a decimal' }) : { problem: 'not a number' }
  if ('problem' in d) throw new RangeError(`${what}: ${JSON.stringify(raw)} ${d.problem}`)
  if (d.units < 0n) throw new RangeError(`${what} cannot be negative (got ${JSON.stringify(raw)})`)
  return d
}

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How a date written as text is read. Declared, never sniffed: "03/04/2026" is March 4 or April 3 only by declaration.
 *   'YYYY-MM-DD'  exactly ten characters (the default).
 *   'ISO'         YYYY-MM-DD, optionally followed by a time ("2026-09-15T23:30:00-05:00"); the calendar date AS WRITTEN is
 *                 taken (the local date of the system that wrote it), the time is ignored.
 *   'MM/DD/YYYY' · 'DD/MM/YYYY' · 'DD.MM.YYYY' · 'YYYYMMDD'
 */
export type DateFormat = 'YYYY-MM-DD' | 'ISO' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'DD.MM.YYYY' | 'YYYYMMDD'
export const DATE_FORMATS: readonly DateFormat[] = ['YYYY-MM-DD', 'ISO', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY', 'YYYYMMDD']

const DATE_RE: Record<DateFormat, { re: RegExp; y: number; m: number; d: number }> = {
  'YYYY-MM-DD': { re: /^(\d{4})-(\d{2})-(\d{2})$/, y: 1, m: 2, d: 3 },
  ISO: { re: /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/, y: 1, m: 2, d: 3 },
  'MM/DD/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 1, d: 2 },
  'DD/MM/YYYY': { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 2, d: 1 },
  'DD.MM.YYYY': { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, y: 3, m: 2, d: 1 },
  YYYYMMDD: { re: /^(\d{4})(\d{2})(\d{2})$/, y: 1, m: 2, d: 3 },
}

export function assertDateFormat(f: unknown, what: string): DateFormat {
  if (!DATE_FORMATS.includes(f as DateFormat)) throw new RangeError(`${what} must be one of ${DATE_FORMATS.join(' | ')} (got ${JSON.stringify(f)})`)
  return f as DateFormat
}

/** A calendar date as "YYYY-MM-DD", or a problem. A number (YYYYMMDD from a JSON export) is read as its digits. */
export function readDate(raw: unknown, fmt: DateFormat): string | { problem: string } {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : undefined
  if (s === undefined) return { problem: `${JSON.stringify(raw)} is not a date` }
  const spec = DATE_RE[fmt]
  const m = spec.re.exec(s)
  if (!m) return { problem: `${JSON.stringify(raw)} is not a ${fmt} date` }
  const y = Number(m[spec.y]), mo = Number(m[spec.m]), d = Number(m[spec.d])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (mo < 1 || mo > 12 || d < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { problem: `${JSON.stringify(raw)} is not a calendar date (read as ${fmt})` }
  }
  return `${m[spec.y]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Whole days from date a to date b (both "YYYY-MM-DD"): b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** A declared UTC offset ("+00:00", "-05:00", "+0530") in minutes. */
export function readUtcOffset(raw: unknown): number {
  const m = typeof raw === 'string' ? /^([+-])(\d{2}):?(\d{2})$/.exec(raw.trim()) : null
  if (!m) throw new RangeError(`payment_date_utc_offset must look like "+00:00" or "-05:00" (got ${JSON.stringify(raw)})`)
  const mins = Number(m[2]) * 60 + Number(m[3])
  if (Number(m[2]) > 14 || Number(m[3]) > 59) throw new RangeError(`payment_date_utc_offset out of range: ${JSON.stringify(raw)}`)
  return m[1] === '-' ? -mins : mins
}

/** The calendar date of an ISO instant (the ledger's UTC clock) at a UTC offset: the day the payer's system would write. */
export function localDateOf(instant: string, offsetMinutes: number): string {
  const ms = Date.parse(instant)
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

// ── keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How a key value (invoice number, vendor id) is normalized before matching, applied to BOTH sides, in this order:
 *   trim                 remove leading/trailing whitespace. Default true.
 *   remove               delete every one of these characters (e.g. "-/ ."). Default "" (none).
 *   case                 'upper' | 'lower' | 'preserve'. Default 'preserve'.
 *   strip_leading_zeros  "000123" → "123" (a value of only zeros keeps one). Default false.
 */
export interface KeyRules {
  trim?: boolean
  remove?: string
  case?: 'preserve' | 'upper' | 'lower'
  strip_leading_zeros?: boolean
}

export function effectiveKeyRules(r: KeyRules = {}, what: string): Required<KeyRules> {
  const c = r.case ?? 'preserve'
  if (!['preserve', 'upper', 'lower'].includes(c)) throw new RangeError(`${what}.case must be preserve | upper | lower (got ${JSON.stringify(r.case)})`)
  if (r.remove !== undefined && typeof r.remove !== 'string') throw new RangeError(`${what}.remove must be a string of characters`)
  return { trim: r.trim ?? true, remove: r.remove ?? '', case: c, strip_leading_zeros: r.strip_leading_zeros ?? false }
}

/** A key's text: a string or an integer/decimal number (as it prints). Anything else is not a key. */
export function keyText(raw: unknown): string | undefined | { problem: string } {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : { problem: `${raw} is not a key` }
  return { problem: `${JSON.stringify(raw)} is not a key (text or a number)` }
}

export function normalizeKey(s: string, r: Required<KeyRules>): string {
  let k = r.trim ? s.trim() : s
  if (r.remove) { const drop = new Set([...r.remove]); k = [...k].filter(ch => !drop.has(ch)).join('') }
  if (r.case === 'upper') k = k.toUpperCase()
  else if (r.case === 'lower') k = k.toLowerCase()
  if (r.strip_leading_zeros) k = k.replace(/^0+(?=.)/, '')
  return k
}

/** A currency code: trimmed and upper-cased (ISO 4217 codes are case-insensitive). The only currency rule, and it is fixed. */
export function normalizeCurrency(raw: unknown): string | undefined | { problem: string } {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') return { problem: `${JSON.stringify(raw)} is not a currency code` }
  const c = raw.trim().toUpperCase()
  return c === '' ? undefined : c
}
