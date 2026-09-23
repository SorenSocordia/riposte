/**
 * Forensic Normalizer - Standardizes values for mathematical comparison
 *
 * This module ensures consistent value formats before comparison to prevent
 * format mismatches causing false positives/negatives in axiom validation.
 *
 * Key capabilities:
 * - Date normalization (US, European, ISO formats)
 * - Currency normalization (various formats, symbols, locales)
 * - Reference number normalization (for matching POs, tickets, etc.)
 * - Quantity normalization (handling unit suffixes)
 *
 * Each normalizer returns both the normalized value AND a record of transformations
 * applied, enabling full auditability in locked findings.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a normalization operation with full audit trail
 */
export interface NormalizedValue<T> {
  /** Original raw value before normalization */
  original: string | number | Date | null

  /** Normalized value for comparison */
  normalized: T

  /** List of transformations applied (for audit trail) */
  transformations: string[]

  /** Whether normalization was successful */
  success: boolean

  /** Error message if normalization failed */
  error?: string
}

// ============================================================================
// DATE NORMALIZATION
// ============================================================================

/**
 * Options for date normalization
 */
export interface DateNormalizationOptions {
  /**
   * Expected locale for ambiguous dates (01/02/2024 = Jan 2 or Feb 1?)
   * - 'US': MM/DD/YYYY (default)
   * - 'EU': DD/MM/YYYY
   * - 'auto': Try to infer from context
   */
  locale?: 'US' | 'EU' | 'auto'

  /**
   * If true, mark ambiguous dates in the transformation log
   */
  trackAmbiguity?: boolean
}

/**
 * Normalize date to ISO-8601 format (YYYY-MM-DD)
 *
 * Handles various input formats:
 * - ISO: "2024-01-15"
 * - US: "01/15/2024", "1/15/24"
 * - European: "15-01-2024", "15/01/2024"
 * - Text: "Jan 15, 2024", "January 15th, 2024"
 * - Unix timestamp: 1705276800000
 *
 * Issue #5 Fix: Now tracks ambiguous dates and supports explicit locale hints
 *
 * @param value - Date value to normalize
 * @param options - Normalization options (locale hint, ambiguity tracking)
 * @returns Normalized date string in YYYY-MM-DD format or null if invalid
 */
export function normalizeDate(
  value: unknown,
  options: DateNormalizationOptions = {}
): NormalizedValue<string> | null {
  const { locale = 'US', trackAmbiguity = true } = options
  if (value === null || value === undefined || value === '') {
    return null
  }

  const transformations: string[] = []
  let originalValue: string | number | Date | null = null

  // Handle Date objects
  if (value instanceof Date) {
    originalValue = value
    if (isNaN(value.getTime())) {
      return {
        original: originalValue,
        normalized: '',
        transformations: ['invalid_date_object'],
        success: false,
        error: 'Invalid Date object'
      }
    }
    transformations.push('date_object_converted')
    return {
      original: originalValue,
      normalized: formatDateISO(value),
      transformations,
      success: true
    }
  }

  // Handle numeric timestamps
  if (typeof value === 'number') {
    originalValue = value
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return {
        original: originalValue,
        normalized: '',
        transformations: ['invalid_timestamp'],
        success: false,
        error: 'Invalid timestamp'
      }
    }
    transformations.push('timestamp_converted')
    return {
      original: originalValue,
      normalized: formatDateISO(date),
      transformations,
      success: true
    }
  }

  // Handle string dates
  if (typeof value !== 'string') {
    return null
  }

  originalValue = value
  const input = value.trim()

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return finishDate(originalValue, input, ['already_iso'])
  }

  // Try ISO with time component (strip time)
  const isoWithTimeMatch = input.match(/^(\d{4}-\d{2}-\d{2})T/)
  if (isoWithTimeMatch) {
    transformations.push('time_stripped')
    return finishDate(originalValue, isoWithTimeMatch[1], transformations)
  }

  // Handle slash-separated numeric dates: MM/DD/YYYY (US) — or DD/MM/YYYY when the first field cannot be a month
  const usMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (usMatch) {
    const [, first, second, yearPart] = usMatch
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart
    const f = parseInt(first, 10)
    const s2 = parseInt(second, 10)
    // hardened: a "month" above 12 means day-first (fuzz-found: "15/09/2026" was parsed as month 15)
    if (f > 12 && s2 <= 12) {
      transformations.push('european_format_parsed')
      return finishDate(originalValue, `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`, transformations)
    }
    if (f > 12 || s2 > 31) {
      return { original: originalValue, normalized: '', transformations: ['parse_failed'], success: false, error: `Could not parse date: ${input}` }
    }
    const ambiguous = f <= 12 && s2 <= 12 && f !== s2
    if (ambiguous && trackAmbiguity) transformations.push('AMBIGUOUS_DATE')
    if (locale === 'EU' && s2 <= 12) {
      transformations.push('european_format_applied')
      return finishDate(originalValue, `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`, transformations)
    }
    transformations.push('us_format_parsed')
    return finishDate(originalValue, `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`, transformations)
  }

  // Handle European format: DD-MM-YYYY or DD/MM/YYYY (when day > 12)
  const euroMatch = input.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (euroMatch) {
    const [, first, second, year] = euroMatch
    const firstNum = parseInt(first, 10)
    const secondNum = parseInt(second, 10)

    // If first > 12, it must be day (European)
    if (firstNum > 12) {
      transformations.push('european_format_parsed')
      return finishDate(originalValue, `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`, transformations)
    }
    // If second > 12, first must be month (US)
    if (secondNum > 12) {
      transformations.push('us_format_parsed')
      return finishDate(originalValue, `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`, transformations)
    }

    // =========================================================================
    // DATE AMBIGUITY FIX (Issue #5 from AUDIT-Z3-SCORCHED-EARTH.md)
    //
    // Both values are ≤12, so we can't tell if it's MM/DD or DD/MM.
    // Use the locale hint to resolve, and track ambiguity for review.
    // =========================================================================
    const isAmbiguous = firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum
    if (isAmbiguous && trackAmbiguity) {
      transformations.push('AMBIGUOUS_DATE')
    }

    if (locale === 'EU') {
      // European: DD/MM/YYYY
      transformations.push('european_format_applied')
      return finishDate(originalValue, `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`, transformations)
    } else {
      // US (default): MM/DD/YYYY
      transformations.push('us_format_defaulted')
      return finishDate(originalValue, `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`, transformations)
    }
  }

  // Handle text month formats: "Jan 15, 2024", "January 15th, 2024"
  const textMonthMatch = input.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i
  )
  if (textMonthMatch) {
    const [, monthName, day, year] = textMonthMatch
    const month = parseMonthName(monthName)
    if (month) {
      transformations.push('text_month_parsed')
      return finishDate(originalValue, `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, transformations)
    }
  }

  // Try native Date parsing as fallback
  const parsed = new Date(input)
  if (!isNaN(parsed.getTime())) {
    transformations.push('native_date_parsed')
    return {
      original: originalValue,
      normalized: formatDateISO(parsed),
      transformations,
      success: true
    }
  }

  // Failed to parse
  return {
    original: originalValue,
    normalized: '',
    transformations: ['parse_failed'],
    success: false,
    error: `Could not parse date: ${input}`
  }
}

/**
 * Validate a composed ISO calendar date. "2026-15-09" and "2026-02-30" are not dates and must never
 * become Date objects downstream (an Invalid Date throws on toISOString — fuzz-found crash).
 */
function finishDate(original: string | number | Date | null, iso: string, transformations: string[]): NormalizedValue<string> {
  const t = Date.parse(iso)
  if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso) {
    return { original, normalized: '', transformations: [...transformations, 'invalid_calendar_date'], success: false, error: `Not a calendar date: ${iso}` }
  }
  return { original, normalized: iso, transformations, success: true }
}

/**
 * Parse month name to two-digit month number
 */
function parseMonthName(name: string): string | null {
  const months: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  }
  return months[name.toLowerCase()] || null
}

/**
 * Format Date object to ISO-8601 date string
 */
function formatDateISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ============================================================================
// REFERENCE NUMBER NORMALIZATION
// ============================================================================

/**
 * Normalize reference number for comparison
 *
 * Transformations:
 * - Uppercase all letters
 * - Remove special characters except alphanumeric and hyphen
 * - Trim whitespace
 * - Collapse multiple spaces/hyphens
 *
 * Examples:
 * - "po #1234-a" → "PO1234A"
 * - "INV-2024-001" → "INV2024001"
 * - "Ticket #12345" → "TICKET12345"
 *
 * @param value - Reference number to normalize
 * @returns Normalized reference string or null if invalid
 */
export function normalizeReference(value: unknown): NormalizedValue<string> | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const original = String(value)
  const transformations: string[] = []

  let normalized = original.trim()
  if (normalized !== original) {
    transformations.push('whitespace_trimmed')
  }

  // Uppercase
  const uppercased = normalized.toUpperCase()
  if (uppercased !== normalized) {
    transformations.push('uppercased')
    normalized = uppercased
  }

  // Remove special characters except alphanumeric
  const cleaned = normalized.replace(/[^A-Z0-9]/g, '')
  if (cleaned !== normalized) {
    transformations.push('special_chars_removed')
    normalized = cleaned
  }

  if (normalized.length === 0) {
    return {
      original,
      normalized: '',
      transformations: ['empty_after_normalization'],
      success: false,
      error: 'Reference is empty after normalization'
    }
  }

  return {
    original,
    normalized,
    transformations: transformations.length > 0 ? transformations : ['no_changes'],
    success: true
  }
}

// ============================================================================
// CURRENCY AMOUNT NORMALIZATION
// ============================================================================

/**
 * Normalize currency amount to a number with 2 decimal places
 *
 * Handles various formats:
 * - US: "$1,234.56", "1234.56", "$-500.00"
 * - European: "1.234,56", "€1.234,56"
 * - With symbols: "USD 1,234.56", "1234.56 EUR"
 * - Negative: "($500.00)", "-$500", "500-"
 *
 * @param value - Currency value to normalize
 * @returns Normalized number rounded to 2 decimals or null if invalid
 */
/**
 * Fold non-ASCII digits to 0-9 so numbers verify in ANY script — full-width (Japanese/Chinese `１２３`), Arabic-Indic
 * (`١٢٣`), Persian, Devanagari (India), Bengali, Thai — plus full-width `．`/`，`. Deterministic verification is
 * language-agnostic on the numbers; this makes that literally true across the world's major scripts, no model involved.
 */
export function foldDigits(s: string): { text: string; folded: boolean } {
  let folded = false
  const out = Array.from(s, ch => {
    const c = ch.codePointAt(0) as number
    if (c >= 0xFF10 && c <= 0xFF19) { folded = true; return String(c - 0xFF10) } // full-width 0-9
    if (c >= 0x0660 && c <= 0x0669) { folded = true; return String(c - 0x0660) } // Arabic-Indic
    if (c >= 0x06F0 && c <= 0x06F9) { folded = true; return String(c - 0x06F0) } // Extended Arabic-Indic (Persian/Urdu)
    if (c >= 0x0966 && c <= 0x096F) { folded = true; return String(c - 0x0966) } // Devanagari
    if (c >= 0x09E6 && c <= 0x09EF) { folded = true; return String(c - 0x09E6) } // Bengali
    if (c >= 0x0E50 && c <= 0x0E59) { folded = true; return String(c - 0x0E50) } // Thai
    if (c === 0xFF0E) { folded = true; return '.' } // full-width full stop
    if (c === 0xFF0C) { folded = true; return ',' } // full-width comma
    return ch
  }).join('')
  return { text: out, folded }
}

// --- CJK numeral words (Japanese/Chinese kanji amounts) -----------------------------------------------------------
// The myriad (万進) system. Includes Chinese FORMAL financial numerals (大写 — 壹貳參…), the anti-tamper forms used on
// invoices and checks precisely to stop digit forgery, which is exactly the fraud surface this engine guards.
// Deterministic and total-or-nothing: a malformed or out-of-order string returns null (abstain) rather than a guess.
const CJK_DIGIT: Record<string, number> = {
  '〇': 0, '零': 0, '一': 1, '壹': 1, '二': 2, '貳': 2, '贰': 2, '兩': 2, '两': 2, '三': 3, '參': 3, '叁': 3, '叄': 3,
  '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陸': 6, '陆': 6, '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9,
}
const CJK_SMALL: Record<string, number> = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000 }
const CJK_BIG: Record<string, number> = { '万': 1e4, '萬': 1e4, '億': 1e8, '亿': 1e8, '兆': 1e12 }
// Currency marks, filler, and separators that may wrap a kanji amount — stripped before parsing.
const CJK_STRIP = /[円圓圆元圜￥¥整正也\s,]/g

/**
 * Parse a CJK-numeral amount (e.g. 一億二千三百四十五万六千七百八十九 → 123456789, or the formal 壹萬貳仟 → 12000).
 * Returns null if the string contains no CJK numeral, or is malformed / has units in a non-decreasing order — never a guess.
 */
export function parseCjkNumeral(input: string): number | null {
  const s = input.replace(CJK_STRIP, '')
  if (s === '') return null
  let hasCjk = false
  for (const ch of s) if (ch in CJK_DIGIT || ch in CJK_SMALL || ch in CJK_BIG) { hasCjk = true; break }
  if (!hasCjk) return null // a plain ASCII number belongs to the normal path
  let total = 0, section = 0, num = 0
  let lastBig = Infinity, lastSmall = Infinity
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { num = num * 10 + (ch.charCodeAt(0) - 48); continue }
    if (ch in CJK_DIGIT) { num = num * 10 + (CJK_DIGIT[ch] as number); continue }
    if (ch in CJK_SMALL) {
      const u = CJK_SMALL[ch] as number
      if (u >= lastSmall) return null // 千 > 百 > 十 must strictly decrease within a section
      lastSmall = u
      section += (num === 0 ? 1 : num) * u
      num = 0
      continue
    }
    if (ch in CJK_BIG) {
      const b = CJK_BIG[ch] as number
      if (b >= lastBig) return null // 億 > 万 must strictly decrease across sections
      lastBig = b
      section += num
      if (section === 0) return null // a myriad unit with no digits in its section is not a real amount → abstain
      total += section * b
      section = 0; num = 0; lastSmall = Infinity
      continue
    }
    return null // any unexpected character → abstain
  }
  section += num
  total += section
  return Number.isFinite(total) ? total : null
}

export function normalizeAmount(value: unknown): NormalizedValue<number> | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const transformations: string[] = []
  let original: string | number | null = null

  // Already a number
  if (typeof value === 'number') {
    original = value
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ['invalid_nan'],
        success: false,
        error: 'Value is NaN'
      }
    }
    const rounded = Math.round(value * 100) / 100
    if (rounded !== value) {
      transformations.push('rounded_to_2_decimals')
    }
    return {
      original,
      normalized: rounded,
      transformations: transformations.length > 0 ? transformations : ['already_number'],
      success: true
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  original = value
  let cleaned = value.trim()
  { const fd = foldDigits(cleaned); cleaned = fd.text; if (fd.folded) transformations.push('non_ascii_digits_folded') }
  { const cjk = parseCjkNumeral(cleaned); if (cjk !== null) { cleaned = String(cjk); transformations.push('cjk_numerals_parsed') } }

  // Track if negative (parentheses or trailing minus)
  let isNegative = false
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true
    cleaned = cleaned.slice(1, -1)
    transformations.push('parentheses_negative')
  }
  if (cleaned.endsWith('-')) {
    isNegative = true
    cleaned = cleaned.slice(0, -1)
    transformations.push('trailing_minus')
  }
  if (cleaned.startsWith('-')) {
    isNegative = true
    cleaned = cleaned.slice(1)
    transformations.push('leading_minus')
  }

  // Remove currency symbols and text
  const beforeCurrency = cleaned
  cleaned = cleaned.replace(/^[^0-9.\-,]+|[^0-9.\-,]+$/g, '')
  if (cleaned !== beforeCurrency) {
    transformations.push('currency_symbols_removed')
  }

  // =========================================================================
  // EUROPEAN DECIMAL TRAP FIX (Issue #1 from AUDIT-Z3-SCORCHED-EARTH.md)
  //
  // Detect locale by analyzing the POSITION and ROLE of separators:
  // - European: 1.250,00 (period = thousands, comma = decimal)
  // - US:       1,250.00 (comma = thousands, period = decimal)
  //
  // Key insight: The LAST separator determines the decimal position
  // If comma is last and followed by exactly 2 digits → European
  // If period is last and followed by exactly 2 digits → US
  // =========================================================================
  const lastComma = cleaned.lastIndexOf(',')
  const lastPeriod = cleaned.lastIndexOf('.')

  // Determine locale based on last separator position and decimal digit count
  let detectedLocale: 'US' | 'EU' | 'unknown' = 'unknown'

  if (lastComma > lastPeriod) {
    // Comma is the last separator - check if it looks like European decimal
    const afterComma = cleaned.substring(lastComma + 1)
    if (/^\d{1,2}$/.test(afterComma)) {
      // Comma followed by 1-2 digits → European decimal (1.250,00 or 1.250,5)
      detectedLocale = 'EU'
    } else if (/^\d{3}$/.test(afterComma)) {
      // Comma followed by exactly 3 digits → US thousands (1,250 with no decimal)
      detectedLocale = 'US'
    }
  } else if (lastPeriod > lastComma) {
    // Period is the last separator - check if it looks like US decimal
    const afterPeriod = cleaned.substring(lastPeriod + 1)
    if (/^\d{1,2}$/.test(afterPeriod)) {
      // Period followed by 1-2 digits → US decimal (1,250.00 or 1,250.5)
      detectedLocale = 'US'
    } else if (/^\d{3}$/.test(afterPeriod)) {
      // Period followed by exactly 3 digits → European thousands (1.250 with no decimal)
      detectedLocale = 'EU'
    }
  }

  // Fallback patterns if position analysis is inconclusive
  if (detectedLocale === 'unknown') {
    // Classic European pattern: 1.234,56 (digits.digits.digits,digits)
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
      detectedLocale = 'EU'
    }
    // Simple European: 1234,56 (no thousands, comma decimal)
    else if (/^\d+,\d{1,2}$/.test(cleaned)) {
      detectedLocale = 'EU'
    }
    // Default to US for standard formats
    else {
      detectedLocale = 'US'
    }
  }

  if (detectedLocale === 'EU') {
    // European: periods are thousands, comma is decimal
    cleaned = cleaned.replace(/\./g, '') // Remove thousands
    cleaned = cleaned.replace(',', '.')  // Convert decimal
    transformations.push('european_format_converted')
  } else {
    // US/Standard: commas are thousands, period is decimal
    const beforeCommaRemoval = cleaned
    cleaned = cleaned.replace(/,/g, '')
    if (cleaned !== beforeCommaRemoval) {
      transformations.push('thousands_separators_removed')
    }
  }

  // Handle multiple decimal points (take last one as decimal)
  const parts = cleaned.split('.')
  if (parts.length > 2) {
    cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
    transformations.push('multiple_decimals_fixed')
  }

  const parsed = parseFloat(cleaned)
  if (isNaN(parsed)) {
    return {
      original,
      normalized: 0,
      transformations: ['parse_failed'],
      success: false,
      error: `Could not parse amount: ${value}`
    }
  }

  let result = isNegative ? -parsed : parsed
  const rounded = Math.round(result * 100) / 100
  if (rounded !== result) {
    transformations.push('rounded_to_2_decimals')
    result = rounded
  }

  return {
    original,
    normalized: result,
    transformations,
    success: true
  }
}

// ============================================================================
// QUANTITY NORMALIZATION
// ============================================================================

/**
 * Normalize quantity to a number
 *
 * Handles:
 * - Plain numbers: "4", "4.5"
 * - With unit suffixes: "4 hrs", "8 hours", "2.5 days"
 * - Fractions: "1/2", "3/4 hr"
 * - Ranges (takes first value): "4-6 hours" → 4
 *
 * @param value - Quantity value to normalize
 * @returns Normalized number or null if invalid
 */
export function normalizeQuantity(value: unknown): NormalizedValue<number> | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const transformations: string[] = []
  let original: string | number | null = null

  // Already a number
  if (typeof value === 'number') {
    original = value
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ['invalid_nan'],
        success: false,
        error: 'Value is NaN'
      }
    }
    return {
      original,
      normalized: value,
      transformations: ['already_number'],
      success: true
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  original = value
  let cleaned = value.trim().toLowerCase()
  { const fd = foldDigits(cleaned); cleaned = fd.text; if (fd.folded) transformations.push('non_ascii_digits_folded') }
  { const cjk = parseCjkNumeral(cleaned); if (cjk !== null) { cleaned = String(cjk); transformations.push('cjk_numerals_parsed') } }

  // Handle fractions
  const fractionMatch = cleaned.match(/^(\d+)\/(\d+)/)
  if (fractionMatch) {
    const numerator = parseInt(fractionMatch[1], 10)
    const denominator = parseInt(fractionMatch[2], 10)
    if (denominator !== 0) {
      transformations.push('fraction_converted')
      return {
        original,
        normalized: numerator / denominator,
        transformations,
        success: true
      }
    }
  }

  // Handle ranges - take first value
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—to]\s*\d+/)
  if (rangeMatch) {
    transformations.push('range_first_value_used')
    return {
      original,
      normalized: parseFloat(rangeMatch[1]),
      transformations,
      success: true
    }
  }

  // Remove unit suffixes
  const unitSuffixes = [
    'hours?', 'hrs?', 'hr',
    'days?', 'd',
    'minutes?', 'mins?', 'min',
    'units?', 'un',
    'each', 'ea',
    'pieces?', 'pcs?', 'pc',
    'pounds?', 'lbs?', 'lb',
    'gallons?', 'gal',
    'miles?', 'mi',
    'tons?',
  ]
  const unitPattern = new RegExp(`\\s*(${unitSuffixes.join('|')})\\s*$`, 'i')
  const withoutUnit = cleaned.replace(unitPattern, '')
  if (withoutUnit !== cleaned) {
    transformations.push('unit_suffix_removed')
    cleaned = withoutUnit
  }

  // Extract number
  const numMatch = cleaned.match(/^-?\d*\.?\d+/)
  if (numMatch) {
    return {
      original,
      normalized: parseFloat(numMatch[0]),
      transformations: transformations.length > 0 ? transformations : ['number_extracted'],
      success: true
    }
  }

  return {
    original,
    normalized: 0,
    transformations: ['parse_failed'],
    success: false,
    error: `Could not parse quantity: ${value}`
  }
}

// ============================================================================
// RATE NORMALIZATION  [added 2026-09-22]
// ============================================================================

/**
 * Normalize a rate (tax rate, discount rate, interest rate) to a FRACTION, without cent-rounding.
 *
 * DO NOT use normalizeAmount for rates: it rounds to 2 decimals, turning 0.0825 into 0.08.
 *
 * Handles:
 * - Fractions as given: 0.0825, ".0825"
 * - Percent strings: "8.25%", "8.25 %", "8,25%" (EU decimal comma)
 * - Bare percents by heuristic: 8.25 → 0.0825 when the value is > 1 (a rate above 100% is not a rate)
 *
 * The heuristic is recorded as a transformation so the audit trail shows it was applied.
 *
 * @returns NormalizedValue<number> in [0, 1] (fraction) with full transformation log, or null if empty
 */
export function normalizeRate(value: unknown): NormalizedValue<number> | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const transformations: string[] = []
  let original: string | number | null = null
  let parsed: number

  if (typeof value === 'number') {
    original = value
    if (isNaN(value)) {
      return { original, normalized: 0, transformations: ['invalid_nan'], success: false, error: 'Value is NaN' }
    }
    parsed = value
    transformations.push('already_number')
  } else if (typeof value === 'string') {
    original = value
    let cleaned = value.trim()
    { const fd = foldDigits(cleaned); cleaned = fd.text; if (fd.folded) transformations.push('non_ascii_digits_folded') }

    const hasPercentSign = cleaned.includes('%')
    if (hasPercentSign) {
      cleaned = cleaned.replace(/%/g, '')
      transformations.push('percent_sign_removed')
    }

    // Strip everything except digits, separators and sign
    const beforeStrip = cleaned
    cleaned = cleaned.replace(/[^0-9.,\-]/g, '')
    if (cleaned !== beforeStrip) transformations.push('non_numeric_removed')

    // EU decimal comma ("8,25") — only when the comma is the sole separator
    if (cleaned.includes(',') && !cleaned.includes('.')) {
      cleaned = cleaned.replace(',', '.')
      transformations.push('decimal_comma_converted')
    } else if (cleaned.includes(',')) {
      // Both present: treat commas as thousands separators (unusual for rates, but harmless)
      cleaned = cleaned.replace(/,/g, '')
      transformations.push('thousands_separators_removed')
    }

    parsed = parseFloat(cleaned)
    if (isNaN(parsed)) {
      return { original, normalized: 0, transformations: ['parse_failed'], success: false, error: `Could not parse rate: ${value}` }
    }

    if (hasPercentSign) {
      parsed = parsed / 100
      transformations.push('percent_to_fraction')
    }
  } else {
    return null
  }

  // Heuristic: a rate above 1 (100%) was almost certainly expressed in percent
  if (parsed > 1) {
    parsed = parsed / 100
    transformations.push('percent_to_fraction_heuristic')
  }

  if (parsed < 0) {
    return { original, normalized: parsed, transformations: [...transformations, 'negative_rate'], success: false, error: `Negative rate: ${value}` }
  }

  // Keep precision; rates are not currency. Round only to kill float noise (1e-9).
  const normalized = Math.round(parsed * 1e9) / 1e9

  return {
    original,
    normalized,
    transformations,
    success: true,
  }
}

// ============================================================================
// DESCRIPTION NORMALIZATION
// ============================================================================

/**
 * Normalize description for logging and comparison
 *
 * Transformations:
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Truncate if too long
 * - Lowercase for comparison
 *
 * @param value - Description string
 * @param maxLength - Maximum length (default: 100)
 * @returns Normalized description
 */
export function normalizeDescription(value: string, maxLength: number = 100): string {
  if (!value) return ''

  let normalized = value.trim()

  // Collapse multiple whitespace
  normalized = normalized.replace(/\s+/g, ' ')

  // Truncate if needed
  if (normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength - 3) + '...'
  }

  return normalized
}

/**
 * Normalize description for comparison (lowercase, no punctuation)
 */
export function normalizeDescriptionForComparison(value: string): string {
  if (!value) return ''

  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim()
}

// ============================================================================
// BATCH NORMALIZATION
// ============================================================================

/**
 * Normalize a binding value based on its universal role
 * Returns normalized value with full transformation audit trail
 */
export function normalizeBindingValue(
  value: unknown,
  role: string
): NormalizedValue<unknown> | null {
  // Numeric roles
  const numericRoles = [
    'RATE_APPLIED', 'RATE_CONTRACTED',
    'CLAIMED_AMOUNT', 'VERIFIED_AMOUNT', 'CONTRACTED_LIMIT',
    'LINE_ITEM_TOTAL', 'EXPECTED_TOTAL'
  ]

  // Quantity roles
  const quantityRoles = ['CLAIMED_QUANTITY', 'ACTUAL_QUANTITY']

  // Date roles
  const dateRoles = ['EVENT_DATE', 'CONTRACT_START', 'CONTRACT_END']

  // Reference roles
  const referenceRoles = ['DOCUMENT_ID']

  if (numericRoles.includes(role)) {
    return normalizeAmount(value)
  }

  if (quantityRoles.includes(role)) {
    return normalizeQuantity(value)
  }

  if (dateRoles.includes(role)) {
    return normalizeDate(value)
  }

  if (referenceRoles.includes(role)) {
    return normalizeReference(value)
  }

  // Default: return as-is
  return {
    original: value as string | number | null,
    normalized: value,
    transformations: ['no_normalization_needed'],
    success: true
  }
}

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

/**
 * Compare two dates after normalization
 * Returns difference in days (positive = date1 is later)
 */
export function compareDates(
  date1: unknown,
  date2: unknown
): { match: boolean; daysDifference: number } | null {
  const norm1 = normalizeDate(date1)
  const norm2 = normalizeDate(date2)

  if (!norm1?.success || !norm2?.success) {
    return null
  }

  const d1 = new Date(norm1.normalized)
  const d2 = new Date(norm2.normalized)

  const diffMs = d1.getTime() - d2.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  return {
    match: Math.abs(diffDays) < 1,
    daysDifference: Math.round(diffDays)
  }
}

/**
 * Compare two reference numbers after normalization
 */
export function compareReferences(
  ref1: unknown,
  ref2: unknown
): { match: boolean; similarity: 'exact' | 'contains' | 'none' } | null {
  const norm1 = normalizeReference(ref1)
  const norm2 = normalizeReference(ref2)

  if (!norm1?.success || !norm2?.success) {
    return null
  }

  if (norm1.normalized === norm2.normalized) {
    return { match: true, similarity: 'exact' }
  }

  if (norm1.normalized.includes(norm2.normalized) ||
      norm2.normalized.includes(norm1.normalized)) {
    return { match: true, similarity: 'contains' }
  }

  return { match: false, similarity: 'none' }
}

/**
 * Compare two amounts after normalization
 * Returns variance and whether they match within tolerance
 */
export function compareAmounts(
  amount1: unknown,
  amount2: unknown,
  tolerance: number = 0.01
): { match: boolean; variance: number; percentVariance: number } | null {
  const norm1 = normalizeAmount(amount1)
  const norm2 = normalizeAmount(amount2)

  if (!norm1?.success || !norm2?.success) {
    return null
  }

  const variance = norm1.normalized - norm2.normalized
  const base = Math.max(Math.abs(norm2.normalized), 0.01) // Avoid division by zero
  const percentVariance = (variance / base) * 100

  return {
    match: Math.abs(variance) <= tolerance,
    variance,
    percentVariance
  }
}
