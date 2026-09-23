/**
 * Source-text axis — turn text matches into ClaimVerdict proof objects (same schema as the numeric gavel).
 *
 *   QUOTE_MATCH, tier DETERMINISTIC:
 *     verbatim present            → PASS  (span locator into the source, the matched text on the receipt)
 *     located but text differs    → FAIL  (a misquote — the citation's own opening words are there, the passage isn't;
 *                                          the real passage is shown as the "expected" side)
 *     not located at all          → INSUFFICIENT_DATA / SPAN_NOT_FOUND (maybe the wrong source was supplied — never a
 *                                          FAIL, because we cannot prove a negative from absence)
 *
 * "Does the case stand for the proposition" is NOT decided here — that is semantic, and stays a declared abstention
 * (REASONED tier, later). We decide only: does the quoted string exist verbatim, and does the number appear.
 */

import { sha256 } from '../verdict/canonical.js'
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import { matchQuote, matchValue, prepareSource, type PreparedSource } from './matcher.js'

export { prepareSource, matchQuote, matchValue } from './matcher.js'
export type { PreparedSource, QuoteResult, ValueResult, Span } from './matcher.js'
export { normalizeMapped, numberSurfaceForms } from './normalize.js'

export interface QuoteAssertion {
  /** Stable id for the claim, e.g. "cite[3]" or "field.total". */
  id: string
  /** The passage as quoted / the value as extracted. */
  quote: string
  /** Optional human label of what is being checked (a citation, a field name). */
  label?: string
}

export interface ValueAssertion {
  id: string
  value: number
  /** The field name in the caller's vocabulary (e.g. "subtotal"). */
  field: string
}

function spanEvidence(sourceHash: string, span: { start: number; end: number }, text: string, page?: number): Evidence {
  const e: Evidence = {
    locator: { kind: 'span', source_hash: sourceHash, start: span.start, end: span.end, ...(page !== undefined ? { page } : {}) },
    value: text,
    confidence: 100,
    role: 'QUOTE',
  }
  return e
}

/** Verify that a quoted passage appears verbatim in `sourceText`. Digital-born text only (scanned/handwritten → abstain upstream). */
export function verifyQuote(a: QuoteAssertion, prepared: PreparedSource, sourceHash: string): ClaimVerdict {
  const r = matchQuote(prepared, a.quote)
  const base = {
    claim_id: a.id,
    kind: 'QUOTE_MATCH' as const,
    tier: 'DETERMINISTIC' as const,
    field: a.label ?? 'quote',
    asserted: a.quote,
    rule_id: 'QUOTE_MATCH',
    rule_name: 'Verbatim quotation',
  }
  if (r.found && r.span) {
    return {
      ...base, outcome: 'PASS', locked: true,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
      explanation: `The quoted passage appears verbatim in the source at [${r.span.start}, ${r.span.end}).`,
    }
  }
  if (r.reason === 'misquote_nearest' && r.nearest) {
    return {
      ...base, outcome: 'FAIL', locked: true,
      computation: { formula: 'quoted = source[cited span]', operands: { quoted: a.quote, source_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `The citation points at real text, but the quotation is not verbatim. The source reads: "${r.nearest.text}".`,
    }
  }
  return {
    ...base, outcome: 'INSUFFICIENT_DATA', locked: false,
    evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: 'The quoted passage was not located in the supplied source text; it may be quoted from a different source, or the source text may be incomplete (e.g. scanned/OCR gaps).' },
    explanation: 'Could not locate the quoted passage in the source; abstaining rather than asserting a negative.',
  }
}

/** Verify that an extracted numeric value appears somewhere in `sourceText`. */
export function verifyValueInText(a: ValueAssertion, prepared: PreparedSource, sourceHash: string): ClaimVerdict {
  const r = matchValue(prepared, a.value)
  const base = {
    claim_id: a.id,
    kind: 'QUOTE_MATCH' as const,
    tier: 'DETERMINISTIC' as const,
    field: a.field,
    asserted: a.value,
    rule_id: 'VALUE_IN_SOURCE',
    rule_name: 'Extracted value present in source',
  }
  if (r.found && r.span) {
    // Presence, not proof-of-role: a number can appear in a source for many reasons. PASS (it IS present) but NOT locked —
    // this is a weak, advisory signal, not a certification that it is the correct field. (red-team note, 2026-09-22.)
    return {
      ...base, outcome: 'PASS', locked: false,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
      explanation: `The extracted ${a.field} (${a.value}) appears in the source as "${r.matchedText}" (presence only — not proof it is the correct field).`,
    }
  }
  return {
    ...base, outcome: 'INSUFFICIENT_DATA', locked: false,
    evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `The extracted ${a.field} (${a.value}) was not found in the supplied source text; the value may be computed, formatted differently, or extracted from a region not included.` },
    explanation: `Could not locate ${a.field} in the source; abstaining.`,
  }
}

/** Convenience: hash a source once and verify many quotes / values against it. */
export function verifyAgainstSource(
  sourceText: string,
  quotes: QuoteAssertion[] = [],
  values: ValueAssertion[] = [],
): { source_hash: string; claims: ClaimVerdict[] } {
  const source_hash = sha256(sourceText)
  const prepared = prepareSource(sourceText)
  const claims: ClaimVerdict[] = [
    ...quotes.map(q => verifyQuote(q, prepared, source_hash)),
    ...values.map(v => verifyValueInText(v, prepared, source_hash)),
  ]
  return { source_hash, claims }
}
