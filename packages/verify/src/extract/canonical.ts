/**
 * Canonical readings for the extraction contract (2026-10-03).
 *
 * Two readers of one page agree on a string field when their readings are equal after `canonicalText`, and on a number
 * when both read strictly (`readAmount` and friends) and are equal. The list below is fixed; nothing else is folded:
 *   - Unicode NFC;
 *   - a soft hyphen (U+00AD) is removed; a soft hyphen followed by whitespace marks a line end, so the whitespace goes
 *     too and the two halves of the word join ("con­\ntain", "con­ tain" → "contain");
 *   - line-break hyphenation: a hyphen ending a line, directly after a letter, followed by a line that starts with a
 *     lower-case letter, is removed and the words joined ("exam-\nple" → "example"; "Smith-\nJones" keeps its hyphen);
 *   - curly quotes and primes to straight ' and ";
 *   - typographic dashes (U+2010–U+2015, U+2212) to "-";
 *   - the ligatures ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ to their letters; the ellipsis character to "...";
 *   - every whitespace run to one space, trimmed (`canonicalLines` keeps the line breaks and canonicalizes each line).
 * No case folding and no character repair (O→0, l→1): a misread is a disagreement, never a correction.
 */

import { isStrictNumberTextV010 } from '../declarative/unreadable.js'

const QUOTES: Readonly<Record<string, string>> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
}
const LIGATURES: Readonly<Record<string, string>> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
}
const DASH = new RegExp('[' + String.fromCharCode(0x2010) + '-' + String.fromCharCode(0x2015) + String.fromCharCode(0x2212) + ']', 'g')
const QUOTE_RE = new RegExp('[' + Object.keys(QUOTES).join('') + ']', 'g')
const LIG_RE = new RegExp('[' + Object.keys(LIGATURES).join('') + ']', 'g')
const SHY = String.fromCharCode(0x00ad)
const SOFT_HYPHEN_BREAK = new RegExp(SHY + '\\s+', 'g')
const SOFT_HYPHEN = new RegExp(SHY, 'g')
const ELLIPSIS = new RegExp(String.fromCharCode(0x2026), 'g')

/** Every fold except whitespace: the text keeps its line breaks (soft-hyphen and hyphenation joins remove theirs). */
function fold(s: string): string {
  return s.normalize('NFC')
    .replace(SOFT_HYPHEN_BREAK, '')
    .replace(SOFT_HYPHEN, '')
    .replace(LIG_RE, (c) => LIGATURES[c] ?? c)
    .replace(DASH, '-')
    .replace(/(\p{L})-[ \t]*\r?\n[ \t\r\n]*(?=\p{Ll})/gu, '$1')
    .replace(QUOTE_RE, (c) => QUOTES[c] ?? c)
    .replace(ELLIPSIS, '...')
}

/** The canonical form of a reading: folded, every whitespace run one space, trimmed. */
export function canonicalText(s: string): string {
  return fold(s).replace(/\s+/g, ' ').trim()
}

/** A text's canonical form line by line: the folds, then each line's whitespace collapsed; line breaks kept, pages ("\f") kept. */
export function canonicalLines(s: string): string {
  return s.split('\f').map(page => fold(page).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).join('\n')).join('\f')
}

/** The canonical tokens of a reading (canonicalText split on its spaces). */
export function canonicalTokens(s: string): string[] {
  const c = canonicalText(s)
  return c === '' ? [] : c.split(' ')
}

/** Two string readings agree: equal after canonicalization, and not blank. */
export function sameText(a: string, b: string): boolean {
  const x = canonicalText(a)
  return x !== '' && x === canonicalText(b)
}

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The decimal separator a document uses: '.' or ',' as most of its two-decimal amounts use it; null when undetermined. */
export function detectDecimal(tokens: readonly string[]): '.' | ',' | null {
  let dot = 0, comma = 0
  for (const raw of tokens) {
    const t = raw.replace(/^[A-Z]{3}/, '')
    if (!/^-?\d[\d.,]*[.,]\d{2}$/.test(t)) continue
    if (t[t.length - 3] === '.') dot++; else comma++
  }
  if (dot === comma) return null
  return dot > comma ? '.' : ','
}

const esc = (c: string): string => (c === '.' ? '\\.' : c)
function numRe(dec: '.' | ',', minDec: number, maxDec: number, grouping: boolean): RegExp {
  const g = dec === '.' ? ',' : '.'
  const frac = maxDec === 0 ? '' : `(?:${esc(dec)}\\d{${minDec},${maxDec}})${minDec === 0 ? '?' : ''}`
  const int = grouping ? `(?:\\d{1,3}(?:${esc(g)}\\d{3})+|\\d+)` : '\\d+'
  return new RegExp(`^-?${int}${frac}$`)
}
function toNum(s: string, dec: '.' | ','): number | null {
  const g = dec === '.' ? ',' : '.'
  const n = Number(s.split(g).join('').replace(dec, '.'))
  return Number.isFinite(n) ? n : null
}
const strictly = (s: string): boolean => isStrictNumberTextV010(s)

/** An amount: the document's decimal separator, exactly two decimals, valid grouping, and strict by engine 0.1.0's rule. */
export function readAmount(s: string, dec: '.' | ',' | null): number | null {
  return dec && strictly(s) && numRe(dec, 2, 2, true).test(s) ? toNum(s, dec) : null
}
/** A unit price: two to six decimals. */
export function readPrice(s: string, dec: '.' | ',' | null): number | null {
  return dec && strictly(s) && numRe(dec, 2, 6, true).test(s) ? toNum(s, dec) : null
}
/** A quantity: up to six decimals, no grouping. */
export function readQuantity(s: string, dec: '.' | ',' | null): number | null {
  return dec && strictly(s) && numRe(dec, 0, 6, false).test(s) ? toNum(s, dec) : null
}
/** A rate printed as a percentage ("25%", "12,5%") → its number (25, 12.5). */
export function readRate(s: string, dec: '.' | ',' | null): number | null {
  if (!dec || !s.endsWith('%')) return null
  const b = s.slice(0, -1)
  return strictly(b) && numRe(dec, 0, 4, false).test(b) ? toNum(b, dec) : null
}
/** Read a token by a field kind; null when it does not read strictly. Identifier and string kinds are read as text. */
export function readByKind(kind: string | undefined, s: string, dec: '.' | ',' | null): number | null {
  switch (kind ?? 'amount') {
    case 'amount': return readAmount(s, dec)
    case 'price': return readPrice(s, dec)
    case 'quantity': return readQuantity(s, dec)
    case 'rate': return readRate(s, dec)
    default: return null
  }
}

/** Currency marks read off a page: an ISO 4217-shaped code, or one of the two unambiguous symbols. `$`, `¥` and the rest read as nothing. */
export function readCurrencyMark(s: string): string | null {
  if (/^[A-Z]{3}$/.test(s)) return s
  if (s === '€') return 'EUR'
  if (s === '£') return 'GBP'
  return null
}
