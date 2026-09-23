/**
 * The deterministic text matchers. Pure functions, no I/O, no randomness.
 *
 *   matchQuote(source, quote)  — does the passage appear VERBATIM (modulo whitespace/quotes/dashes/hyphenation/case)?
 *                                found → the real span; not found but the cite's own opening words ARE present → a
 *                                misquote, with the passage the source ACTUALLY carries there; neither → located nowhere.
 *   matchValue(source, value)  — does the number appear as a digit-bounded token, optionally with $ / − at its edge?
 *
 * "Never a false PASS" is the contract: we only report `found` on an exact normalized substring hit.
 */

import { Mapped, normalizeMapped, numberSurfaceForms, toOriginalSpan } from './normalize.js'

export interface Span { start: number; end: number }

export interface QuoteResult {
  /** The quoted passage appears verbatim (normalized) in the source. */
  found: boolean
  /** Original-text span of the verbatim match (when found). */
  span?: Span
  /** The verbatim original substring that matched (when found) — for the receipt. */
  matchedText?: string
  /**
   * When NOT found but the quote's own opening (or closing) words ARE located: the passage the source actually carries
   * around that anchor. This is the misquote signal — the citation points at real text that does not say what was quoted.
   */
  nearest?: { span: Span; text: string }
  /** How the result was reached (for explanations). */
  reason: 'verbatim' | 'misquote_nearest' | 'not_located'
}

export interface ValueResult {
  found: boolean
  span?: Span
  matchedText?: string
  /** Which surface form matched (e.g. "1,500.00"). */
  form?: string
}

const WORD_RE = /[^\s]+/g
/** A "misquote" (vs a fabrication) requires this many consecutive quoted words to really appear in the source. */
const MIN_ANCHOR_WORDS = 3

/**
 * Is the character at `idx` part of a longer NUMBER adjoining the match? A digit always is; a '.' or ',' is only if a
 * digit lies just beyond it (in direction `dir`) — so a trailing sentence period after "$4,250.00." is NOT a number part.
 */
function edgeIsNumberPart(text: string, idx: number, dir: 1 | -1): boolean {
  const c = text[idx]
  if (c === undefined) return false
  if (c >= '0' && c <= '9') return true
  if (c === '.' || c === ',') {
    const beyond = text[idx + dir]
    return beyond !== undefined && beyond >= '0' && beyond <= '9'
  }
  return false
}

/** Precompute the normalized source once; callers matching many quotes/values against one document reuse it. */
export interface PreparedSource {
  legal: Mapped
  value: Mapped
  raw: string
}
export function prepareSource(source: string): PreparedSource {
  return { legal: normalizeMapped(source, 'legal'), value: normalizeMapped(source, 'value'), raw: source }
}

function words(s: string): string[] {
  return s.match(WORD_RE) ?? []
}

export function matchQuote(prepared: PreparedSource, quote: string): QuoteResult {
  const src = prepared.legal
  const qn = normalizeMapped(quote, 'legal').text.trim()
  if (qn.length === 0) return { found: false, reason: 'not_located' }

  const idx = src.text.indexOf(qn)
  if (idx >= 0) {
    const span = toOriginalSpan(src, idx, idx + qn.length)
    return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), reason: 'verbatim' }
  }

  // Not verbatim. Is the citation nonetheless pointing at real text? Find the LONGEST run of consecutive quoted words
  // that appears as a contiguous phrase in the source (robust to a substitution anywhere in the quote, not just the ends).
  const qWords = words(qn)
  let bestLen = 0
  let bestPos = -1
  let bestChars = 0
  for (let i = 0; i < qWords.length; i++) {
    let phrase = qWords[i] as string
    let pos = src.text.indexOf(phrase)
    if (pos < 0) continue
    let j = i
    while (j + 1 < qWords.length) {
      const trial = `${phrase} ${qWords[j + 1]}`
      const tpos = src.text.indexOf(trial)
      if (tpos < 0) break
      phrase = trial; pos = tpos; j++
    }
    const len = j - i + 1
    if (len > bestLen) { bestLen = len; bestPos = pos; bestChars = phrase.length }
  }

  if (bestLen >= MIN_ANCHOR_WORDS && bestPos >= 0) {
    // Report the matched run plus a generous margin on BOTH sides, snapped to word boundaries — the divergent word sits
    // immediately before or after the run, so margins on both sides guarantee it is shown whichever side it falls.
    const margin = Math.max(qn.length, 40)
    let ws = Math.max(0, bestPos - margin)
    let we = Math.min(src.text.length, bestPos + bestChars + margin)
    while (ws > 0 && src.text[ws - 1] !== ' ') ws--
    while (we < src.text.length && src.text[we] !== ' ') we++
    const span = toOriginalSpan(src, ws, we)
    return {
      found: false,
      nearest: { span, text: prepared.raw.slice(span.start, span.end) },
      reason: 'misquote_nearest',
    }
  }

  return { found: false, reason: 'not_located' }
}

export function matchValue(prepared: PreparedSource, value: number): ValueResult {
  const src = prepared.value
  for (const form of numberSurfaceForms(value)) {
    let from = 0
    for (;;) {
      const p = src.text.indexOf(form, from)
      if (p < 0) break
      // Digit-bounded: neither neighbour may be part of a longer number (a trailing sentence period does not count).
      if (!edgeIsNumberPart(src.text, p - 1, -1) && !edgeIsNumberPart(src.text, p + form.length, 1)) {
        const span = toOriginalSpan(src, p, p + form.length)
        return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), form }
      }
      from = p + 1
    }
  }
  return { found: false }
}
