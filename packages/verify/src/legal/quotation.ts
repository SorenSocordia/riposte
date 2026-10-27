/**
 * How legal@0.1.0 reads a quotation against an opinion (2026-10-03). legal@0.0.1 does not use this module and is unchanged.
 *
 * legal@0.0.1 asks for the quoted string, normalised, as a substring of the opinion. Opinions and briefs quote by convention,
 * not by string: "[t]he" for "The", an ellipsis for omitted words, single marks for the opinion's double ones, "(cleaned
 * up)", a period inside the closing mark. On opinions' own quotations of authority, 0.0.1 failed most genuine ones for those
 * reasons alone. 0.1.0 reads the conventions, says on the verdict which ones it relied on, and refuses everything else:
 *
 *   - quotation marks are not compared; an apostrophe inside a word is ("plaintiff's" is not "plaintiffs");
 *   - brackets are first read as written ("[t]he" reads "the"); failing that, each stands for a short substitution: at most
 *     (its words + 2) words and 40 characters of the opinion, and a bracket with no space inside that is attached to a word
 *     replaces part of that word only ("serv[e]" for "serving"); the opinion's own brackets are dropped;
 *   - an ellipsis is an ordered gap of at most 600 characters of the opinion; the opinion's own ellipses are dropped;
 *   - a quotation with gaps keeps a literal piece of 3 or more words and 4 or more literal words in all;
 *   - known parentheticals ("(cleaned up)", "(emphasis added)", "(citations omitted)" ...) are stripped and named;
 *   - a period, comma, semicolon or colon ending the quotation is not compared; nor is a space before punctuation;
 *   - a soft hyphen (and the break after it) and a hyphen between two letters are not compared;
 *   - every literal piece starts and ends on a word boundary in the opinion, unless a bracket is attached to it;
 *   - an ellipsis that omits a negation, or a bracket that adds or removes one, is reported so the caller can refuse to
 *     certify (SELECTIVE_QUOTE).
 *
 * When no reading matches, a passage is named only on an anchor of 4 or more consecutive quoted words found as whole words.
 * Its similarity is the longest common subsequence of the quotation's words with the passage around the anchor, over the
 * quotation's word count: 0.8 or more names the corresponding passage; 0.5 up to 0.8 names the nearest passage, a partial
 * match only; below that, or with no such anchor, the quotation is not located.
 *
 * Pure and deterministic: no I/O, no clock, no randomness. Every limit is in QUOTATION_LIMITS; changing one is a new
 * ruleset version.
 *
 * legal@0.2.0 (2026-10-03) reads exactly as 0.1.0 and then asks whether the conventions it relied on kept the opinion's meaning
 * (meaningOf, below): a bracket may change case, inflection or a pronoun, or insert a referent, but a bracket that replaces a
 * word with another word, or swaps a modal, a negation or a quantifier, alters the meaning; an ellipsis that omits a condition or
 * a limiting word ("unless", "provided", "only", "preclude"...) may turn a conditional passage into an absolute one; and inner
 * quotation marks the quotation drops (or adds) reassign whose words they are. 0.0.1 and 0.1.0 never call it.
 */

import { toOriginalSpan, type Mapped } from '../textmatch/normalize.js'

export interface Span { start: number; end: number }

/** The limits legal@0.1.0 reads quotations with. Changing any of them is a new ruleset version. */
export const QUOTATION_LIMITS = {
  /** An ellipsis stands for at most this many characters of the opinion. */
  ellipsisChars: 600,
  /** A bracket stands for at most this many characters of the opinion ... */
  bracketChars: 40,
  /** ... and at most (the words inside it + this many) words. */
  bracketExtraWords: 2,
  /** A quotation with gaps keeps a literal piece of this many words ... */
  minPieceWords: 3,
  /** ... and this many literal words in all. */
  minLiteralWords: 4,
  /** A passage is named only on a run of this many consecutive quoted words found as whole words in the opinion. */
  anchorWords: 4,
  /** Similarity at or above which the named passage is the corresponding one. */
  correspondingSimilarity: 0.8,
  /** Similarity at or above which the nearest passage is named (a partial match only). */
  nearestSimilarity: 0.5,
} as const

/** The limits a quotation is read with. QUOTATION_LIMITS is the declared set (0.1.0, 0.2.0); a later rule may declare its own. */
export interface QuotationLimits {
  ellipsisChars: number; bracketChars: number; bracketExtraWords: number; minPieceWords: number; minLiteralWords: number
  anchorWords: number; correspondingSimilarity: number; nearestSimilarity: number
}

/** Same pattern as legal@0.0.1's negation guard. */
const NEGATION = /\b(?:not|no|never|cannot|can't|don't|doesn't|didn't|nor|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|reject\w*|decline[ds]?)\b/i

// ── normalisation (both sides) ────────────────────────────────────────────────────────────────────────────────────────

const DOUBLE_MARKS = new Set(['"', '“', '”', '„', '‟', '«', '»', '″'])
const SINGLE_MARKS = new Set(["'", '‘', '’', '‚', '‛', '‹', '›', '`', '´', '′'])
const WORD_HYPHENS = new Set(['-', '‐', '‑'])
const DASHES = new Set(['‒', '–', '—', '―', '−'])
const ZERO_WIDTH = new Set(['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF'])
const NO_SPACE_BEFORE = new Set(['.', ',', ';', ':', '!', '?'])

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)
const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}/u.test(c)
const isAlnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)
/** Part of a word in normalised text: a letter, a digit, or an apostrophe (which normalisation keeps only inside a word). */
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}']/u.test(c)

/** Three or more periods, each at most one space from the next ("...", ". . .", ". . . ."): the index after it, or i. */
function ellipsisEnd(s: string, i: number): number {
  let k = i
  let dots = 0
  let end = i
  while (s[k] === '.') {
    dots++
    k++
    end = k
    if ((s[k] === ' ' || s[k] === '\u00A0') && s[k + 1] === '.') k++
  }
  return dots >= 3 ? end : i
}

// ── legal@0.4.0: page marks in commercial texts (2026-10-05) ──────────────────────────────────────────────────────────────
//
// A Westlaw or Lexis download prints the reporter's page breaks inside the text ("the governing *248 law", "separate [*249]
// from", "**2510" for a parallel reporter) and footnote calls as numerals glued to the punctuation they follow ("counted.4
// This"). A genuine quotation never carries them, so legal@0.1.0 to 0.3.0 FAIL it. legal@0.4.0 reads them out of the comparison,
// both sides, and says so on the answer. Only the two safe forms are read out:
//   - star paging: one to four asterisks and a page number, alone between spaces or punctuation ("*248", "**2510"), or the
//     same in brackets ("[*249]"). Never one glued to a letter or digit ("gov*248erning" is left as written);
//   - a footnote numeral: one to three digits glued to a period, comma, semicolon, colon, question or exclamation mark (and any
//     closing mark after it) that ends a word of two or more letters (or a closing parenthesis), followed by a space or the end
//     of the text, when that word is not an abbreviation a number follows ("No.3", "art.2", "p.12" are left as written).
// Anything else that looks like one is never read out on its own: where the quotation matches only with such a token read out,
// the answer is can't tell, never FAIL (index.ts). The offsets of the text are kept: every answer's span is in the supplied text.

/**
 * A page mark read out of a text (legal@0.4.0): where it is, and which kind. legal@0.5.1 adds two kinds, which no earlier rule ever
 * produces: a Westlaw headnote number standing between sentences ("[9] Second, …"), and a citation sentence read out only when the
 * quotation says a citation is omitted ("(citation omitted)", "(cleaned up)").
 */
export interface PageMark { start: number; end: number; kind: 'star' | 'footnote' | 'headnote' | 'citation' | 'furniture' }

/** Words a number follows by convention, so a numeral glued to their period is not a footnote call. */
const NUMBER_ABBREVIATIONS = new Set(['no', 'nos', 'art', 'arts', 'sec', 'secs', 'ch', 'cl', 'pp', 'p', 'vol', 'vols', 'fig', 'figs', 'para', 'paras', 'pt', 'pts', 'tit', 'subch', 'subd', 'n', 'nn', 'ex', 'exh', 'tr', 'r', 'rec', 'doc', 'dkt', 'ecf', 'app', 'pet', 'reg', 'regs', 'op', 'ord', 'id', 'ibid', 'v', 'vs', 'st'])

const STAR_MARK = /(?<![\p{L}\p{N}*[])(?:\[\*{1,4}\d{1,5}\]|\*{1,4}\d{1,5})(?![\p{L}\p{N}*\]])/gu
const FOOTNOTE_MARK = /[.,;:!?]["”’)\]]?(\d{1,3})(?=\s|$)/gu

/** The safe page marks of a text (legal@0.4.0), in order, never overlapping. */
export function pageMarksOf(src: string): PageMark[] {
  const out: PageMark[] = []
  for (const m of src.matchAll(STAR_MARK)) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'star' })
  for (const m of src.matchAll(FOOTNOTE_MARK)) {
    const at = (m.index ?? 0) + m[0].length - (m[1] as string).length
    const p = m.index ?? 0 // the punctuation
    const before = src[p - 1]
    if (before === ')' || before === ']') { out.push({ start: at, end: at + (m[1] as string).length, kind: 'footnote' }); continue }
    if (!isLetter(before)) continue
    let s = p
    while (s > 0 && isLetter(src[s - 1])) s--
    const word = src.slice(s, p).toLowerCase()
    if (word.length < 2) continue
    // an abbreviation's period ("No.3", "art.2") is not sentence punctuation; a comma or semicolon after a word always is
    if (src[p] === '.' && (NUMBER_ABBREVIATIONS.has(word) || SENTENCE_ABBREVIATIONS.has(word))) continue
    if (s > 0 && (src[s - 1] === '.' || isAlnum(src[s - 1]))) continue // "U.S.3", "e.g.4": part of an abbreviation
    out.push({ start: at, end: at + (m[1] as string).length, kind: 'footnote' })
  }
  out.sort((a, b) => a.start - b.start)
  return out.filter((x, k) => k === 0 || x.start >= (out[k - 1] as PageMark).end)
}

/**
 * Tokens that may be page marks or footnote calls but are not read out on their own (legal@0.4.0): a star mark glued to a word,
 * a numeral glued to the end of a word ("counted4") or to any punctuation, a bracketed or "FN" footnote call. Used only to tell
 * a FAIL that may be one of these from a misquotation, which then answers can't tell (index.ts).
 */
export function loosePageMarksOf(src: string): PageMark[] {
  const out: PageMark[] = [...pageMarksOf(src)]
  const add = (re: RegExp, kind: PageMark['kind'], group = 0): void => {
    for (const m of src.matchAll(re)) {
      const text = m[group] as string
      const start = (m.index ?? 0) + m[0].indexOf(text)
      out.push({ start, end: start + text.length, kind })
    }
  }
  add(/\[?\*{1,4}\d{1,5}\]?/gu, 'star')
  add(/[.,;:!?]["”’)\]]?(\d{1,3})(?=[\s"”’)]|$)/gu, 'footnote', 1)
  add(/\p{L}{2}(\d{1,3})(?=[\s.,;:!?"”’)]|$)/gu, 'footnote', 1)
  add(/\[(?:fn\s?)?\d{1,3}\]|\bfn\s?\d{1,3}\b/giu, 'footnote')
  out.sort((a, b) => a.start - b.start || b.end - a.end)
  return out.filter((x, k) => k === 0 || x.start >= (out[k - 1] as PageMark).end)
}

/**
 * legal@0.5.0 (2026-10-05, cold-review round 5): every footnote-call form legal@0.4.0's loose reading misses, as well as its own. A
 * standalone Lexis call ("trial. n7 Directed", "n. 7"), a bracketed one ("[n7]"), and superscript digits ("trial.⁷", "trial ⁷"). A
 * quotation that matches only with one of these read out answers can't tell naming it, never FAIL (a cold reader, an AI agent, found that a
 * genuine quotation across "n7" FAILed under legal@0.4.0, against LEGAL.md's "never FAIL"). legal@0.4.0 never calls this.
 */
export function widePageMarksOf(src: string): PageMark[] {
  const out: PageMark[] = [...loosePageMarksOf(src)]
  const add = (re: RegExp): void => {
    for (const m of src.matchAll(re)) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'footnote' })
  }
  add(/(?<![\p{L}\p{N}])(?:fn|n)\.?\s?\d{1,3}(?![\p{L}\p{N}])/giu)
  add(/\[n\.?\s?\d{1,3}\]/giu)
  add(/[¹²³⁰⁴-⁹]+/gu)
  out.sort((a, b) => a.start - b.start || b.end - a.end)
  return out.filter((x, k) => k === 0 || x.start >= (out[k - 1] as PageMark).end)
}

// ── legal@0.5.1: headnote numbers, citation sentences, sentence ends after a number (2026-10-06) ─────────────────────────────────
//
// A Westlaw download prints its headnote numbers inside the opinion, in brackets, where each headnoted point begins: "… nothing more
// than conclusions. [9] Second, only a complaint …", "[5] [6] To survive a motion to dismiss, …". legal@0.5.0 read a genuine
// quotation across one as can't tell, and its named passages opened on it. legal@0.5.1 reads one out, as it reads star paging, when
// it stands alone between sentences: not glued to the character before it, after a sentence end, a line break, star paging or
// another such number, and before a capital that starts the next sentence. A bracketed number glued to a word or its punctuation
// ("immaterial.[4]") is a footnote call and still answers can't tell.

/** legal@0.5.1: Westlaw headnote numbers standing alone between sentences (above), in order. */
export function headnoteMarksOf(src: string): PageMark[] {
  const out: PageMark[] = []
  const LEAD = /(?:\[\*{0,4}\d{1,5}\]|\*{1,4}\d{1,5})$/u
  const NEXT = /^\s+(?:(?:\[\*{0,4}\d{1,5}\]|\*{1,4}\d{1,5})\s+)*["“‘(]?\p{Lu}/u
  for (const m of src.matchAll(/\[\d{1,3}\]/g)) {
    const s = m.index ?? 0
    const e = s + m[0].length
    if (s > 0 && !isSpace(src[s - 1])) continue // glued to what precedes it: a footnote call
    if (e < src.length && !isSpace(src[e])) continue
    if (!NEXT.test(src.slice(e, e + 40))) continue
    let j = s - 1
    while (j >= 0 && (src[j] === ' ' || src[j] === '\t' || src[j] === '\u00A0')) j--
    if (j < 0 || src[j] === '\n' || src[j] === '\r') { out.push({ start: s, end: e, kind: 'headnote' }); continue }
    if (LEAD.test(src.slice(Math.max(0, j - 12), j + 1))) { out.push({ start: s, end: e, kind: 'headnote' }); continue }
    if (/[.?!]["”’)\]]*$/u.test(src.slice(Math.max(0, j - 3), j + 1))) out.push({ start: s, end: e, kind: 'headnote' })
  }
  return out
}

/**
 * legal@0.5.1: a sentence end, as legal@0.3.0 reads one (sentenceEndsAt), plus a period after a number or after "Id." or "Ibid." when
 * the next word starts with a capital ("… 127 S.Ct. 1955. To survive …", "… 490 F.3d, at 157-158. But where …", "Ibid. Where …").
 * legal@0.3.0 to 0.5.0 never ended a sentence there, so a named passage could open on the citation sentence before it ("Id., at
 * 556, 127 S.Ct. 1955. The plausibility standard …").
 */
function sentenceEndsAt051(raw: string, i: number): boolean {
  if (sentenceEndsAt(raw, i)) return true
  if (raw[i] !== '.') return false
  if (raw[i - 1] === '.' || raw[i + 1] === '.') return false
  let k = i + 1
  while (k < raw.length && /["”’)\]]/.test(raw[k] as string)) k++
  if (k < raw.length && !/\s/.test(raw[k] as string)) return false
  while (k < raw.length && /\s/.test(raw[k] as string)) k++
  // what follows: a capital, or a bracketed number or star paging and then a capital; or the end of the text
  const next = raw.slice(k, k + 40)
  if (k < raw.length && !/^(?:(?:\[\*{0,4}\d{1,5}\]|\*{1,4}\d{1,5})\s+)*["“‘(]?\[?\p{Lu}/u.test(next)) return false
  let s = i
  while (s > 0 && !/\s/.test(raw[s - 1] as string)) s--
  const word = raw.slice(s, i).replace(/^[("“‘[]+/u, '')
  if (/^(?:id|ibid)$/iu.test(word)) return !/^at\b/iu.test(next)
  return /^[\d§¶][\d\-–,()a-z]*\)?$/iu.test(word) && /\d/.test(word)
}

// ── legal@0.5.2: what a vendor prints around the opinion (2026-10-06) ─────────────────────────────────────────────────────────
//
// A Lexis download prints its headnote markers inside the opinion, where each headnoted point begins: "HN4[ ] To the contrary, …".
// legal@0.5.1 did not read one out, so a genuine quotation across it FAILed ("the quotation leaves out "HN4[""), and a quotation
// beginning right after one was said to present part of a sentence as a whole one. legal@0.5.2 reads it out as it reads a Westlaw
// headnote number, wherever it stands alone between spaces.
//
// A Westlaw PDF turned into text carries each page break's footer and the next page's running header inside the opinion: "©
// 2026 Thomson Reuters. No claim to original U.S. Government Works. 9", then the case name with its citation, then the line of
// parallel citations ("113 S.Ct. 2786, …, 37 Fed. R. Evid. Serv. 1"). legal@0.5.1 FAILed a genuine quotation across one, naming
// a passage that opened on the "1" of the header. legal@0.5.2 reads a run of such lines out of the comparison, as one break
// between words. A run needs a vendor's own line to start it (the Thomson Reuters footer, a Westlaw banner line, a "Page N of M"
// line, a KeyCite flag line); next to one, a line that is only a case name with its citation, only a list of citations, only a
// page number, or a KeyCite treatment line belongs to the run. A citation line standing alone in the opinion is never read out.

/** legal@0.5.2: Lexis headnote markers standing alone between spaces ("HN4[ ]"), as headnote marks. */
export function lexisHeadnoteMarksOf(src: string): PageMark[] {
  const out: PageMark[] = []
  for (const m of src.matchAll(/(?<![\p{L}\p{N}[\]])HN\d{1,3}\[\s*\](?=\s|$)/gu)) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'headnote' })
  return out
}

/** A vendor's own line, which starts a run of page furniture (above). */
const FURNITURE_SEED = /^(?:(?:End of Document\s+)?©\s?\d{4}\s+Thomson\s+Reuters\b.{0,140}|(?:WESTLAW|Westlaw(?:Next)?)\b.{0,160}|Page\s+\d{1,4}\s+of\s+\d{1,4}|KeyCite\b.{0,120})$/u
/** A line that is only a case name with its reporter citation ("Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)"). */
const FURNITURE_CAPTION = /^[^\n]{1,160}\sv\.\s[^\n]{1,160}?,\s+\d{1,4}\s+[A-Z][\p{L}.'’\d ]{0,24}?\s+\d{1,6}(?:\s*\(\d{4}\))?$/u
/** A line that is only reporter citations, comma-separated ("113 S.Ct. 2786, 125 L.Ed.2d 469, 37 Fed. R. Evid. Serv. 1"). */
const FURNITURE_CITES = /^\d{1,4}\s+[A-Z][\p{L}.'’\d ]{0,24}?\s+\d{1,6}(?:\s*,\s*\d{1,4}\s+[A-Z][\p{L}.'’\d ]{0,24}?\s+\d{1,6})*$/u
/** A KeyCite treatment line ("Declined to Extend by Nease v. Ford Motor Co., 4th Cir.(W.Va.), January 24, 2017"). */
export const KEYCITE_TREATMENT = /^(?:Declined to Extend|Distinguished|Overruled|Abrogated|Superseded|Called into Doubt|Disagreed With|Not Followed|Criticized|Limited|Questioned|Rejected|Disapproved|Modified|Reversed|Vacated|Holding Limited|Recognized as Overruled|Abrogation Recognized|Negative Treatment)\b[^\n]{0,200}$/u

/**
 * legal@0.5.3 (2026-10-13): a line of parallel citations read by its shape, not by a list of reporters. legal@0.5.2 took a line
 * of "volume reporter page" triples only, so a Westlaw header line "127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337, 2007-1 Trade Cases P
 * 75,709" was not read out and a genuine quotation across the page break FAILed (two cold reviews; AI agents, not people). Each item,
 * between commas, is an optional volume ("127", a looseleaf "2007-1"), one to eight reporter words (each opening with a capital, as
 * "S.Ct.", "L.Ed.2d", "USLW", "Trade", "Cas.", or an ordinal, or "(CCH)" and its kin), and a page or paragraph ("1955", "P 75,709",
 * "¶ 94,224", a Westlaw number "1461367"), with at most one short parenthetical after it. At least one reporter word carries a
 * period or is written in capitals, as a reporter's abbreviation is. Like every furniture line it is read out only next to a vendor's
 * own line; a citation line standing alone in the opinion is never read out.
 */
const CITE_WORD_053 = String.raw`(?:[A-Z][\p{L}\d.'’&]*|\d{1,2}(?:d|st|nd|rd|th)\.?|\((?:CCH|BNA|P-H|RIA|West)\)|&)`
const CITE_ITEM_053 = new RegExp(String.raw`^(?:\d{1,5}(?:-\d{1,2})?\s+)?${CITE_WORD_053}(?:\s+${CITE_WORD_053}){0,7}\s+(?:(?:P|¶|para\.)\s*)?\d{1,7}(?:,\d{3})*(?:\s*\([^()]{1,40}\))?$`, 'u')
const citesLine053 = (t: string): boolean => {
  if (t.length > 200) return false
  const items = t.split(/[,;]\s+/)
  return items.length > 0 && items.every(i => CITE_ITEM_053.test(i.trim())) && items.some(i => /(?:^|\s)(?:[A-Z][\p{L}\d'’&]*\.[\p{L}\d.'’&]*|[A-Z]{2,}[\d.]*)(?=\s)/u.test(` ${i.trim()} `))
}

/** legal@0.5.2: runs of page furniture (above), each from the line break before its first line to the end of its last. legal@0.5.3 (`v053`) reads a line of parallel citations by its shape (citesLine053). */
export function furnitureMarksOf(src: string, opts: { v053?: boolean } = {}): PageMark[] {
  const lines: { s: number; e: number; t: string }[] = []
  for (let at = 0; at <= src.length;) {
    const nl = src.indexOf('\n', at)
    const e = nl < 0 ? src.length : nl
    lines.push({ s: at, e: e > at && src[e - 1] === '\r' ? e - 1 : e, t: src.slice(at, e).replace(/\s+/g, ' ').trim() })
    if (nl < 0) break
    at = nl + 1
  }
  const seed = (t: string): boolean => FURNITURE_SEED.test(t)
  const joins = (t: string): boolean => t.length <= 200 && (seed(t) || FURNITURE_CAPTION.test(t) || FURNITURE_CITES.test(t) || (opts.v053 === true && citesLine053(t)) || /^\d{1,4}$/.test(t) || KEYCITE_TREATMENT.test(t))
  const out: PageMark[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!seed(lines[i]!.t)) continue
    let a = i, b = i
    // a blank line inside a run is part of it; at its edges it is not
    const extend = (k: number, dir: -1 | 1): number => {
      let j = k + dir, last = k
      while (j >= 0 && j < lines.length) {
        const t = lines[j]!.t
        if (t === '') { j += dir; continue }
        if (!joins(t)) break
        last = j
        j += dir
      }
      return last
    }
    a = extend(i, -1)
    b = extend(i, 1)
    if (out.length > 0 && lines[a]!.s <= out[out.length - 1]!.end) { out[out.length - 1]!.end = lines[b]!.e; i = b; continue }
    // the line break before the run belongs to it, so the words either side read as one sentence
    let start = lines[a]!.s
    if (start > 0 && src[start - 1] === '\n') start -= start > 1 && src[start - 2] === '\r' ? 2 : 1
    out.push({ start, end: lines[b]!.e, kind: 'furniture' })
    i = b
  }
  return out
}

/** The sentence-end reading a rule uses: legal@0.3.0's, or legal@0.5.1's (`numbers`), which also ends one after a number. */
/** legal@0.5.3 passes 'v053': legal@0.5.1's reading, with no sentence end before a small letter (sentenceEndsAt053). */
export type SentenceReading = boolean | 'v053'
const endsAt = (numbers: SentenceReading): ((raw: string, i: number) => boolean) => (numbers === 'v053' ? sentenceEndsAt053 : numbers ? sentenceEndsAt051 : sentenceEndsAt)

/**
 * legal@0.5.1: the citation sentences of a text, read out only when a quotation says a citation is omitted ("(citation omitted)",
 * "(citations omitted)", "(cleaned up)"), and, on a FAIL, to say that a quotation leaves one out without saying so. A citation
 * sentence starts where a sentence starts, with "Id.", "Ibid.", a signal ("See", "Cf.", "Accord", "Compare", "But see", "E.g.,"), a
 * case name with " v. ", a reporter citation or "Fed. Rule"; it holds a reporter citation, "at" and a page, a rule or a section, or is
 * "Id." or "Ibid." alone; it runs to its sentence end outside any parenthesis (its explanatory parenthetical is part of it), at most
 * 1,200 characters. Only whole sentences: a citation clause inside a sentence (", see Twombly, 550 U.S., at 570,") is not one.
 */
export function citationSentencesOf(src: string, v053 = false, v055 = false): PageMark[] {
  const ends = v055 ? sentenceEndsAt055 : v053 ? sentenceEndsAt053 : sentenceEndsAt051
  const out: PageMark[] = []
  const START = v055 ? START_055 : v053 ? START_053 : /^(?:Id\.|Ibid\.|See\b|Cf\.|Accord\b|Compare\b|But\s+(?:see|cf\.)|E\.\s?g\.,|[A-Z][\p{L}.'’&-]*(?:\s+[\p{L}.'’&,-]+){0,8}\s+v\.\s|\d{1,4}\s+(?:U\.\s?S\.|S\.\s?Ct\.|L\.\s?Ed\.|F\.\s?(?:\d?d|Supp\.)|F\.\s)|Fed\.\s+Rules?\b)/u
  const MATERIAL = v055 ? MATERIAL_055 : /\b\d{1,4}\s+[A-Z][\p{L}.]*(?:\s?[\p{L}\d.]{1,6}){0,3}\s+\d{1,5}\b|\bat\s+\d{1,5}\b|\bRules?\s+\d|§|^(?:Id|Ibid)\.\s*$/u
  const starts: number[] = [0]
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1)
    else if (ends(src, i)) starts.push(i + 1)
  }
  let lastEnd = -1
  // (2026-10-06, cost only) a start inside the stretch the previous start already skipped lands where that one did, and a place
  // already decided is not decided again: the section view blanks other sections to spaces with their line breaks kept, and
  // re-skipping each blank line's run made this quadratic (seconds on a long opinion). The marks found are the same.
  let skipFrom = -1, skipTo = -1, lastAt = -1
  for (const at0 of starts) {
    let at: number
    if (at0 >= skipFrom && at0 <= skipTo) at = skipTo
    else {
      at = at0
      // the closing marks of the sentence before ("… enhancement." Id., at 557") are not this sentence's
      while (at < src.length && /[\s"”’)\]]/.test(src[at] as string)) at++
      skipFrom = at0
      skipTo = at
    }
    if (at === lastAt) continue
    lastAt = at
    if (at <= lastEnd || at >= src.length || !START.test(src.slice(at, at + 120))) continue
    // legal@0.5.5: a sentence that opens on a rule, code or Restatement citation is one only when it holds citation words only
    const ruleOnly = v055 && !START_053.test(src.slice(at, at + 120))
    let depth = 0
    let end = -1
    for (let i = at; i < src.length && i - at <= 1200; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') depth = Math.max(0, depth - 1)
      else if (c === '\n' && depth === 0 && (src[i + 1] === '\n' || src[i + 1] === '\r')) break // a paragraph ends it
      else if (depth === 0 && ends(src, i)) { end = i + 1; break }
    }
    if (end < 0) continue
    while (end < src.length && /["”’)\]]/.test(src[end] as string)) end++
    const sentence = src.slice(at, end)
    if (!MATERIAL.test(sentence)) continue
    if (ruleOnly && !citationWordsOnly055(sentence)) continue
    out.push({ start: at, end, kind: 'citation' })
    lastEnd = end
  }
  return out
}

// ── legal@0.5.3: citation clauses, and a period before a small letter (2026-10-13) ─────────────────────────────────────────────
//
// legal@0.5.1 excused only a whole citation SENTENCE under "(citation omitted)", "(citations omitted)" or "(cleaned up)". Opinions also
// set citations off inside a sentence: "While a complaint … does not need detailed factual allegations, ibid.; Sanjuan v. American Bd.
// of Psychiatry and Neurology, Inc., 40 F.3d 247, 251 (C.A.7 1994), a plaintiff's obligation …". A cold review (an AI agent, not a
// person) quoted that sentence without the citation, under "(citations omitted)", and legal@0.5.2 FAILed the genuine quotation with a
// remedy telling the writer to change it. legal@0.5.3 reads a citation clause too: after a comma or semicolon, a stretch that opens with
// "id.", "ibid.", a signal ("see", "cf.", "accord", "compare", "but see", "e.g.,", "see also"), a case name with " v. " or a reporter
// citation, and runs through citation pieces only (a case name, "Inc." and its kin, a reporter citation, a pin page, "at" a page, a
// footnote, "supra", a statute section, each with its parentheticals) to the last of them. The clause is read out with the comma or
// semicolon before it ('before'), or with the commas on both sides when the quotation joins the words around it without one ('both').
// A period before a small letter ends no sentence ("American Bd. of Psychiatry"), so the context a PASS prints is never cut there.

const SIGNAL_053 = String.raw`(?:[Ss]ee\s+also|[Ss]ee,?\s+e\.\s?g\.,|[Ss]ee|[Cc]f\.|[Aa]ccord|[Cc]ompare|[Bb]ut\s+see|[Bb]ut\s+cf\.|[Ee]\.\s?g\.,|[Cc]ontra)`
/** A case name: capitalized words, "v." and the small words a case name carries, nothing else. */
const CASE_NAME_053 = new RegExp(String.raw`^(?:${SIGNAL_053}\s+)?(?:In\s+re\s+|Ex\s+parte\s+|Matter\s+of\s+)?[A-Z][\p{L}.'’&-]*(?:\s+(?:[A-Z][\p{L}.'’&-]*|of|and|for|the|in|on|de|du|la|ex|rel\.|&|v\.|vs\.|\d{1,4}(?:st|nd|rd|th)?)){0,14}$`, 'u')
const SHORT_NAME_053 = new RegExp(String.raw`^${SIGNAL_053}\s+[A-Z][\p{L}.'’&-]*(?:\s+[A-Z][\p{L}.'’&-]*){0,3}$`, 'u')
const ID_053 = new RegExp(String.raw`^(?:${SIGNAL_053}\s+)?(?:[Ii]d|[Ii]bid)\.(?:\s+at\s+\d{1,5}(?:[-–]\d{1,5})?)?$`, 'u')
const REPORTER_053 = String.raw`[A-Z][\p{L}.'’]*(?:\s?(?:[A-Z][\p{L}.'’]*|\d{1,2}(?:d|st|nd|rd|th)\.?)){0,4}`
const CITE_053 = new RegExp(String.raw`^(?:${SIGNAL_053}\s+)?\d{1,4}\s+${REPORTER_053}(?:\s+\d{1,6})?$`, 'u')
const PIN_053 = /^(?:at\s+)?\d{1,5}(?:\s*[-–]\s*\d{1,5})?(?:\s*(?:&|and)\s*\d{1,5})*(?:\s+nn?\.\s*\d{1,3})?$|^nn?\.\s*\d{1,3}$|^supra(?:\s+(?:at\s+\d{1,5}|note\s+\d{1,3}))?$|^at\s+\d{1,5}(?:\s+nn?\.\s*\d{1,3})?$/iu
const SUFFIX_053 = /^(?:Inc|Co|Corp|Ltd|L\.L\.C|LLC|N\.A|P\.C|L\.P|LLP|S\.A|P\.A|L\.L\.P|Cos|Bros|et\s+al)\.?$/u
const STATUTE_053 = new RegExp(String.raw`^(?:${SIGNAL_053}\s+)?\d{1,3}\s+U\.\s?S\.\s?C\.\s*§{1,2}\s*[\w.()-]+$|^§{1,2}\s*[\w.()-]+$`, 'u')

/** One piece of a citation clause, its parentheticals off, read for what it is: an opening piece, a later piece, or neither. */
function citePiece053(raw: string, v055 = false): 'open' | 'piece' | undefined {
  const t = raw.replace(/\s*\((?:[^()]|\([^()]*\))*\)/gu, '').replace(/\s+/g, ' ').trim()
  if (t === '') return /\(/.test(raw) ? 'piece' : undefined
  if (ID_053.test(t) || STATUTE_053.test(t)) return 'open'
  // legal@0.5.5: a rule, code or Restatement citation ("Fed. R. Civ. P. 56(a)", "U.C.C. § 2-607(3)(a)"); its parentheticals were read off above
  if (v055 && RULE_CODE_CITE_055.test(raw.replace(/\s+/g, ' ').trim()) && MATERIAL_055.test(raw) && citationWordsOnly055(raw)) return 'open'
  if (CITE_053.test(t)) return 'open'
  if (/\sv\.\s/u.test(` ${t} `) && CASE_NAME_053.test(t)) return 'open'
  if (SHORT_NAME_053.test(t)) return 'open'
  if (PIN_053.test(t) || SUFFIX_053.test(t)) return 'piece'
  return undefined
}

/**
 * legal@0.5.3: the citation clauses inside the sentences of a text (above), each as a mark that starts at the comma or semicolon before
 * it and ends at its last citation piece ('before'), or that also takes the comma after it ('both').
 */
export function citationClausesOf(src: string, commas: 'before' | 'both' = 'before', v055 = false): PageMark[] {
  const out: PageMark[] = []
  const OPENER = new RegExp(String.raw`[,;][ \t]+(?=(?:${SIGNAL_053}\s+)?(?:[Ii]d\.|[Ii]bid\.|[A-Z]|\d{1,4}\s+[A-Z]|§))`, 'gu')
  // legal@0.5.5 (`v055`): a rule, code or Restatement citation is a piece too, and a period after "Tex." or "Cal." inside one ends nothing
  const ends = v055 ? sentenceEndsAt055 : sentenceEndsAt053
  for (const m of src.matchAll(OPENER)) {
    const at = m.index ?? 0
    if (out.length > 0 && at < out[out.length - 1]!.end) continue
    // split what follows into pieces at commas and semicolons outside parentheses, up to a sentence end or a paragraph
    let i = at + m[0].length, depth = 0, pieceStart = i, lastEnd = -1, first = true, ok = true
    for (; i <= src.length && i - at < 1200; i++) {
      const c = src[i]
      const atEnd = i === src.length || (c === '\n' && (src[i + 1] === '\n' || src[i + 1] === '\r'))
      if (c === '(') { depth++; continue }
      if (c === ')') { depth = Math.max(0, depth - 1); continue }
      const sentenceEnd = !atEnd && depth === 0 && c === '.' && ends(src, i) && citePiece053(src.slice(pieceStart, i + 1), v055) === undefined
      if (atEnd || sentenceEnd || (depth === 0 && (c === ',' || c === ';') && /\s/.test(src[i + 1] ?? ' '))) {
        const piece = src.slice(pieceStart, i)
        const kind = citePiece053(piece, v055)
        if (kind === undefined || (first && kind !== 'open')) { ok = !first; break }
        // a later piece after a semicolon opens a new citation in the string; after a comma it continues the one before
        lastEnd = pieceStart + piece.replace(/\s+$/u, '').length
        first = false
        if (atEnd || sentenceEnd) break
        pieceStart = i + 1
        while (pieceStart < src.length && /[ \t]/.test(src[pieceStart] as string)) pieceStart++
      }
    }
    if (!ok || lastEnd < 0) continue
    // a clause is cited material: a reporter citation, a pin, "id." or "ibid.", a statute; a bare name between commas is not
    const body = src.slice(at + 1, lastEnd)
    if (!/\d|\b(?:id|ibid|supra)\./iu.test(body) && !/\bsupra\b/iu.test(body)) continue
    let end = lastEnd
    if (commas === 'both' && src[end] === ',') end++
    out.push({ start: at, end, kind: 'citation' })
  }
  return out
}

/** legal@0.5.3: a sentence end as legal@0.5.1 reads one, except that a period before a small letter never ends a sentence. */
function sentenceEndsAt053(raw: string, i: number): boolean {
  if (!sentenceEndsAt051(raw, i)) return false
  if (raw[i] !== '.') return true
  let k = i + 1
  while (k < raw.length && /["”’)\]]/.test(raw[k] as string)) k++
  while (k < raw.length && /\s/.test(raw[k] as string)) k++
  return !(k < raw.length && /\p{Ll}/u.test(raw[k] as string))
}

/**
 * legal@0.5.3: where a citation sentence starts, as legal@0.5.1 reads it, except that a case name is capitalized words and the small words a
 * case name carries ("of", "and", "the", "&") before " v. ": legal@0.5.1 took "The notice must be written, cf. Smith v. Jones, …" for a
 * case name and read the whole sentence as a citation.
 */
const START_053 = /^(?:Id\.|Ibid\.|See\b|Cf\.|Accord\b|Compare\b|But\s+(?:see|cf\.)|E\.\s?g\.,|(?:See\s+(?:also\s+)?|Cf\.\s+|Accord\s+)?[A-Z][\p{L}.'’&-]*(?:,?\s+(?:[A-Z][\p{L}.'’&-]*|of|and|for|the|in|on|de|ex|rel\.|&)){0,8}\s+v\.\s|\d{1,4}\s+(?:U\.\s?S\.|S\.\s?Ct\.|L\.\s?Ed\.|F\.\s?(?:\d?d|Supp\.)|F\.\s)|Fed\.\s+Rules?\b)/u

// ── legal@0.5.5: rule, code and Restatement citations (2026-10-19) ──────────────────────────────────────────────────────────────
//
// legal@0.5.4 read a citation sentence that opens with a case name, a reporter citation, "Id." or "28 U.S.C. §", so "(citation omitted)"
// over a rule, a code or a Restatement left a correctly disclosed quotation FAILing with a remedy that told the writer to change it: "Fed.
// R. Civ. P. 56(a).", "See Fed. R. Civ. P. 56(a).", "Fed. R. Evid. 801(d)(2).", "Fed. R. App. P. 4(a)(1)(A).", "U.C.C. § 2-607(3)(a).",
// "Restatement (Second) of Contracts § 90 (1981).", "Cal. Civ. Proc. Code § 340.", "Tex. R. Civ. P. 166a(c).", "N.Y. C.P.L.R. 3212(b)
// (McKinney 2024)." (a cold review, nine of eleven forms; an AI agent in a legal-operations buyer's role, not a person). legal@0.5.5 reads a
// citation sentence or clause that opens, after an optional signal, with one of these: up to four capitalized abbreviations and "R." or
// "Rule" with a number ("Fed. R. Civ. P. 56", "Tex. R. Civ. P. 166a"); up to five capitalized words and "Code", "C.P.L.R.", "Stat.",
// "Laws" or "Ann." with a section or a number; "U.C.C. §"; "Restatement (Second) of … §"; a title number and capitalized words before "§".
// Inside such a citation a period after a state or code abbreviation written with its capital ("Tex.", "Cal.", "Pa.") ends no sentence.
const SIGNAL_055 = String.raw`(?:(?:See(?:\s+also)?|Cf\.|Accord|But\s+see|Compare|E\.\s?g\.,|See,?\s+e\.\s?g\.,)\s+)?`
const CAPS_055 = String.raw`[A-Z][\p{L}.'’]*`
const RULE_CITE_055 = String.raw`(?:${CAPS_055}\s+){0,4}(?:R\.|Rules?)\s+(?:of\s+)?(?:${CAPS_055}\s+){0,4}\d`
const CODE_CITE_055 = String.raw`(?:${CAPS_055}\s+){0,5}(?:Code|C\.\s?P\.\s?L\.\s?R\.|Stat\.|Laws|Ann\.)(?:\s+Ann\.)?\s*(?:§{1,2}|art\.|\d)`
const UCC_CITE_055 = String.raw`U\.\s?C\.\s?C\.\s*(?:§{1,2}|art\.|\d)`
const RESTATEMENT_055 = String.raw`Restatement\s+\((?:First|Second|Third|Fourth)\)\s+of\s+[\p{L}' ]{2,60}?\s*§`
const TITLE_CITE_055 = String.raw`\d{1,3}\s+${CAPS_055}(?:\s+${CAPS_055}){0,5}\s*§{1,2}`
/** legal@0.5.5: a rule, code or Restatement citation at the start of a stretch (above). */
export const RULE_CODE_CITE_055 = new RegExp(String.raw`^${SIGNAL_055}(?:${RULE_CITE_055}|${CODE_CITE_055}|${UCC_CITE_055}|${RESTATEMENT_055}|${TITLE_CITE_055})`, 'u')
const START_055 = new RegExp(String.raw`${START_053.source}|${RULE_CODE_CITE_055.source}`, 'u')
const MATERIAL_055 = /\b\d{1,4}\s+[A-Z][\p{L}.]*(?:\s?[\p{L}\d.]{1,6}){0,3}\s+\d{1,5}\b|\bat\s+\d{1,5}\b|\bRules?\s+\d|§|^(?:Id|Ibid)\.\s*$|(?<![\p{L}])R\.\s+(?:[A-Z][\p{L}.]*\s+){0,4}\d|C\.\s?P\.\s?L\.\s?R\.\s*\d|U\.\s?C\.\s?C\./u
/** State and code abbreviations a rule or code citation writes with a capital and a period ("Tex.", "Cal.", "Pa.", "Prac."). */
const CITE_ABBREVIATIONS_055 = new Set(['ala', 'alaska', 'ariz', 'ark', 'cal', 'colo', 'conn', 'del', 'fla', 'ga', 'haw', 'ill', 'ind', 'iowa', 'kan', 'ky', 'la', 'mass', 'md', 'me', 'mich', 'minn', 'miss', 'mo', 'mont', 'neb', 'nev', 'okla', 'or', 'ore', 'pa', 'tenn', 'tex', 'va', 'vt', 'wash', 'wis', 'wyo', 'prac', 'cons', 'comp', 'jud', 'bus', 'prof', 'com', 'fam', 'pen', 'veh', 'transp', 'educ', 'elec', 'fin', 'est', 'agric', 'govt', 'lab', 'util', 'bankr', 'unif', 'mod', 'restatement'])
/**
 * legal@0.5.5: a stretch that holds citation words only, its parentheticals read off: no small-letter word but "at", "of", "and", "the",
 * "see", "also", "et", "seq.", "n.", "art." and their kin. So "Rule 56 requires the movant to show …" is a sentence about a rule, never a
 * citation of one, and is never read out under "(citation omitted)".
 */
const CITE_SMALL_WORDS_055 = new Set(['at', 'of', 'and', 'the', 'see', 'also', 'cf', 'accord', 'e', 'g', 'id', 'ibid', 'supra', 'infra', 'n', 'nn', 'et', 'seq', 'ann', 'art', 'arts', 'cl', 'cls', 'para', 'paras', 'subd', 'subds', 'ch', 'pt', 'pts', 'tit', 'app', 'supp', 'cmt', 'illus', 'rep', 'reg', 'regs', 'r', 'p', 'pp', 'no', 'nos', 'ed', 'rev', 'repl', 'vol', 'v', 'vs', 'sec', 'secs'])
export function citationWordsOnly055(s: string): boolean {
  const t = s.replace(/\((?:[^()]|\([^()]*\))*\)/gu, ' ')
  return (t.match(/(?<![\p{L}\p{N}])\p{Ll}[\p{L}]*/gu) ?? []).every(w => CITE_SMALL_WORDS_055.has(w.toLowerCase()))
}
/** legal@0.5.5: a sentence end as legal@0.5.3 reads one, except a period after a capitalized state or code abbreviation (above). */
function sentenceEndsAt055(raw: string, i: number): boolean {
  if (!sentenceEndsAt053(raw, i)) return false
  if (raw[i] !== '.') return true
  let s = i
  while (s > 0 && !/\s/.test(raw[s - 1] as string)) s--
  const word = raw.slice(s, i).replace(/^[("“‘[]+/u, '')
  return !(/^\p{Lu}/u.test(word) && CITE_ABBREVIATIONS_055.has(word.toLowerCase()))
}

/** The text with each mark replaced by spaces of the same length: offsets kept, sentence ends readable ("counted.  This"). */
export function blankMarks(src: string, marks: readonly PageMark[]): string {
  if (marks.length === 0) return src
  let out = ''
  let at = 0
  for (const m of marks) { out += src.slice(at, m.start) + ' '.repeat(m.end - m.start); at = m.end }
  return out + src.slice(at)
}

/** How a mark is named on an answer: `*248`, or the word a footnote numeral is glued to ("counted.4"). */
export function markShown(src: string, m: PageMark): string {
  if (m.kind === 'star') return src.slice(m.start, m.end)
  // legal@0.5.2: a run of page furniture is named by its first line
  if (m.kind === 'furniture') return clipWords(src.slice(m.start, m.end).trim().split(/\r?\n/)[0] ?? '', 70)
  let s = m.start
  while (s > 0 && !isSpace(src[s - 1]) && m.start - s < 40) s--
  return src.slice(s, m.end)
}

/** The page-mark notes for a stretch of the text (legal@0.4.0): "star paging ignored (*248)", "a footnote numeral ignored (...)". */
export function markNotes(src: string, marks: readonly PageMark[], from: number, to: number): string[] {
  const inside = marks.filter(m => m.start >= from && m.end <= to)
  const stars = inside.filter(m => m.kind === 'star').map(m => markShown(src, m))
  const notes = inside.filter(m => m.kind === 'footnote').map(m => `"${markShown(src, m)}"`)
  // legal@0.5.1's kinds (no earlier rule produces them, so its notes are unchanged)
  const heads = inside.filter(m => m.kind === 'headnote').map(m => src.slice(m.start, m.end))
  // legal@0.5.2's kind (no earlier rule produces it)
  const pages = inside.filter(m => m.kind === 'furniture').map(m => `"${markShown(src, m)}"`)
  return [
    ...(stars.length ? [`star paging ignored (${stars.join(', ')})`] : []),
    ...(notes.length ? [`${notes.length === 1 ? 'a footnote numeral' : 'footnote numerals'} ignored (${notes.join(', ')})`] : []),
    ...(heads.length ? [`${heads.length === 1 ? 'a headnote number' : 'headnote numbers'} ignored (${heads.join(' ')})`] : []),
    ...(pages.length ? [`${pages.length === 1 ? 'a page break\'s footer and running header' : 'page breaks\' footers and running headers'} read out (${pages.join(', ')})`] : []),
  ]
}

/**
 * How a text is normalised: legal@0.1.0 to 0.3.0 read it as written; legal@0.4.0 also reads out the safe page marks ('wide': legal@0.5.0's
 * can't-tell probe). legal@0.5.1 (`v051`) also reads em dashes, en dashes and "--" as one dash (the spaces around it aside) and reads out
 * Westlaw headnote numbers between sentences (headnoteMarksOf); `citations` (legal@0.5.1 only) also reads out citation sentences
 * (citationSentencesOf), for a quotation that says a citation is omitted.
 */
export interface LegalReadOptions {
  pageMarks?: 'safe' | 'loose' | 'wide'; v051?: boolean; citations?: boolean; v052?: boolean
  /** legal@0.5.3: a running header read by its shape; with `citations`, citation clauses too, read out with the comma before them or with both (`citationCommas`) */
  v053?: boolean; citationCommas?: 'before' | 'both'
  /** legal@0.5.5: a typographic ligature read as its letters (LIGATURES_055); with `citations`, a rule, code or Restatement citation read as one (START_055) */
  v055?: boolean
}

// ── legal@0.5.5: ligatures from PDF conversion (2026-10-19) ─────────────────────────────────────────────────────────────────────
//
// A PDF's text layer often gives "ﬁ" (U+FB01) for "fi" and "ﬂ" (U+FB02) for "fl". legal@0.5.4 read such a ligature as one letter that is
// not the quotation's two, so a genuine quotation of "ﬁnd" FAILed, and the remedy told the writer to change a correct quotation (a cold
// review; an AI agent in a legal-operations role, not a person). legal@0.5.5 reads each of the seven Latin ligatures U+FB00 to U+FB06 as
// its letters, on both sides, as curly quotation marks and a no-break space were already read; a PASS that relied on it says so.
const LIGATURES_055: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' }
/** legal@0.5.5: a string with each Latin ligature written as its letters. */
export const foldLigatures055 = (s: string): string => s.replace(/[ﬀ-ﬆ]/gu, c => LIGATURES_055[c] ?? c)
/** legal@0.5.5: the ligatures a stretch of text holds, as a note shows them ("ﬁ" as "fi"). */
export function ligaturesIn055(s: string): string[] {
  return [...new Set([...s.matchAll(/[ﬀ-ﬆ]/gu)].map(m => `"${m[0]}" as "${LIGATURES_055[m[0]] ?? m[0]}"`))]
}

/** Marks merged in text order; where two overlap, the earlier (then the longer) is kept. */
function mergeMarks(...lists: PageMark[][]): PageMark[] {
  const all = lists.flat().sort((a, b) => a.start - b.start || b.end - a.end)
  const out: PageMark[] = []
  for (const m of all) if (out.length === 0 || m.start >= (out[out.length - 1] as PageMark).end) out.push(m)
  return out
}

/** The marks a reading reads out (none, safe, loose, or legal@0.5.0's wide set; legal@0.5.1 adds headnote numbers and, asked, citations). */
const marksFor = (src: string, mode: LegalReadOptions['pageMarks'], opts: LegalReadOptions = {}): PageMark[] => {
  const base = mode === 'safe' ? pageMarksOf(src) : mode === 'loose' ? loosePageMarksOf(src) : mode === 'wide' ? widePageMarksOf(src) : []
  if (!opts.v051 || mode === undefined) return base
  // legal@0.5.2 (`v052`): page furniture and Lexis headnote markers too (above); a run of furniture is listed first, so a mark inside it is folded into it
  const vendor = opts.v052 ? [furnitureMarksOf(src, opts.v053 ? { v053: true } : {}), lexisHeadnoteMarksOf(src)] : []
  // legal@0.5.3 (`v053`): citation clauses inside a sentence too, and its sentence end
  // legal@0.5.5 (`v055`): a rule, code or Restatement citation is a citation sentence or clause too (START_055)
  const cites = !opts.citations ? [] : opts.v053 ? [citationSentencesOf(src, true, opts.v055 === true), citationClausesOf(src, opts.citationCommas ?? 'before', opts.v055 === true)] : [citationSentencesOf(src)]
  return mergeMarks(...vendor, ...cites, headnoteMarksOf(src), base)
}

/**
 * legal@0.1.0's normalisation, with a map back to original offsets (the same contract as textmatch/normalize.ts: every
 * output character maps to one source offset; deletions map away). Case-folded; whitespace collapsed; quotation marks,
 * brackets, ellipses, soft hyphens and hyphens between letters dropped; an apostrophe inside a word kept as '.
 * legal@0.4.0 (`opts.pageMarks`) also drops the page marks pageMarksOf finds ('loose': loosePageMarksOf), each as a space.
 */
export function normalizeLegalText(src: string, opts: LegalReadOptions = {}): Mapped {
  const out: string[] = []
  const map: number[] = []
  const last = (): string | undefined => out[out.length - 1]
  const space = (at: number): void => { if (out.length > 0 && last() !== ' ') { out.push(' '); map.push(at) } }
  const n = src.length
  const marks = marksFor(src, opts.pageMarks, opts)
  let mk = 0
  let i = 0
  while (i < n) {
    while (mk < marks.length && (marks[mk] as PageMark).end <= i) mk++
    const mark = marks[mk]
    if (mark !== undefined && mark.start === i) {
      // a star mark is a break between words; a footnote numeral glued to a word is read as nothing
      if (mark.kind === 'star' || mark.kind === 'headnote' || mark.kind === 'citation' || mark.kind === 'furniture' || isAlnum(src[mark.end])) space(i)
      i = mark.end
      continue
    }
    const c = src[i] as string
    if (c === '\u00AD') { i++; while (i < n && isSpace(src[i])) i++; continue } // soft hyphen: the broken word is joined
    if (ZERO_WIDTH.has(c)) { i++; continue }
    // legal@0.5.1: an em dash, an en dash, a horizontal bar and a run of two or three hyphens are one dash, the spaces around it aside
    if (opts.v051 && (DASHES.has(c) || (c === '-' && src[i + 1] === '-'))) {
      let k = i
      while (k < n && (DASHES.has(src[k] as string) || src[k] === '-')) k++
      if (last() === ' ') { out.pop(); map.pop() }
      out.push('-'); map.push(i)
      i = k
      while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\u00A0')) i++
      continue
    }
    if (WORD_HYPHENS.has(c)) {
      let k = i + 1
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++
      if (k < n && (src[k] === '\n' || src[k] === '\r')) { // line-break hyphenation, as in 0.0.1
        i = k
        while (i < n && isSpace(src[i])) i++
        continue
      }
      if (isLetter(last()) && isLetter(src[i + 1])) { i++; continue } // a hyphen between letters is not compared
      out.push('-'); map.push(i); i++; continue
    }
    if (DASHES.has(c)) { out.push('-'); map.push(i); i++; continue }
    if (isSpace(c)) {
      const s = i
      while (i < n && isSpace(src[i])) i++
      space(s)
      continue
    }
    if (c === '…') { space(i); i++; continue }
    if (c === '.') {
      const e = ellipsisEnd(src, i)
      if (e > i) { space(i); i = e; continue }
    }
    if (DOUBLE_MARKS.has(c)) { i++; continue }
    if (SINGLE_MARKS.has(c)) {
      if (isAlnum(last()) && isAlnum(src[i + 1])) { out.push("'"); map.push(i) } // an apostrophe inside a word
      i++
      continue
    }
    if (c === '[' || c === ']') { i++; continue }
    if (NO_SPACE_BEFORE.has(c) && last() === ' ') { out.pop(); map.pop() }
    // legal@0.5.5: a ligature is its letters, each mapped to the ligature's offset (no earlier rule reads one so)
    const lig = opts.v055 ? LIGATURES_055[c] : undefined
    if (lig !== undefined) { for (const ch of lig) { out.push(ch); map.push(i) } i++; continue }
    const lc = c.toLowerCase()
    for (let k = 0; k < lc.length; k++) { out.push(lc[k] as string); map.push(i) }
    i++
  }
  if (last() === ' ') { out.pop(); map.pop() }
  return { text: out.join(''), map, original: src }
}
const normalizeLegal = normalizeLegalText

// ── the quotation as written: pieces, brackets, ellipses ──────────────────────────────────────────────────────────────

const PAREN_TERM = '(?:internal\\s+)?(?:quotation\\s+marks?|quotations?|citations?|alterations?|brackets?|ellips[ie]s|footnotes?|emphasis|punctuation|omissions?)'
/** "(cleaned up)", "(emphasis added)", "(citations and internal quotation marks omitted)", "(alteration in original)" ... */
const PARENTHETICAL = new RegExp(`\\(\\s*(?:cleaned\\s+up|${PAREN_TERM}(?:\\s*,?\\s*(?:and\\s+)?${PAREN_TERM})*\\s+(?:omitted|added|supplied|in\\s+original|removed))\\s*\\)`, 'gi')
const QUOTE_TOKEN = /\[([^\[\]]{0,80})\]|…|\.(?:[ \u00A0]?\.){2,}/g
const ELLIPSIS_ONLY = /^\s*(?:…|\.(?:[ \u00A0]?\.){2,})\s*$/

/** legal@0.5.1: the convention parentheticals a string carries ("(cleaned up)", "(citation omitted)" …), as written, spacing collapsed. */
export function conventionParentheticalsOf(s: string | undefined): string[] {
  return s === undefined ? [] : [...s.matchAll(PARENTHETICAL)].map(m => m[0].replace(/\s+/g, ' ').trim())
}

type Token = { t: 'text'; raw: string } | { t: 'bracket'; raw: string; content: string } | { t: 'ellipsis'; raw: string }

/** The quotation without its quotation marks (an apostrophe inside a word stays): marks are not compared, and dropping them
 *  first keeps a bracket next to the word it is attached to (`“[T]he`). */
function stripQuotationMarks(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (DOUBLE_MARKS.has(c)) continue
    if (SINGLE_MARKS.has(c) && !(isAlnum(s[i - 1]) && isAlnum(s[i + 1]))) continue
    out += c
  }
  return out
}

function tokenize(quote: string): { tokens: Token[]; parentheticals: string[] } {
  const parentheticals: string[] = []
  const stripped = stripQuotationMarks(quote).replace(PARENTHETICAL, (m: string) => { parentheticals.push(m.replace(/\s+/g, ' ').trim()); return ' ' })
  const tokens: Token[] = []
  let at = 0
  for (const m of stripped.matchAll(QUOTE_TOKEN)) {
    const idx = m.index ?? 0
    if (idx > at) tokens.push({ t: 'text', raw: stripped.slice(at, idx) })
    if (m[0].startsWith('[')) {
      const content = m[1] ?? ''
      tokens.push(ELLIPSIS_ONLY.test(content) ? { t: 'ellipsis', raw: m[0] } : { t: 'bracket', raw: m[0], content })
    } else tokens.push({ t: 'ellipsis', raw: m[0] })
    at = idx + m[0].length
  }
  if (at < stripped.length) tokens.push({ t: 'text', raw: stripped.slice(at) })
  return { tokens, parentheticals }
}

const wordsIn = (s: string): number => (s.trim().match(/\S+/g) ?? []).length

interface Piece {
  /** normalised text */
  text: string
  /** must start / end on a word boundary in the opinion (false where a bracket is attached) */
  boundStart: boolean
  boundEnd: boolean
  /** the piece as the quotation writes it, letter case kept (legal@0.3.0 compares case); a bracket read as written is inside it */
  quoted: string
  /** per character of `quoted`: true where it came from inside a bracket ("[T]he": the T) */
  bracketed: boolean[]
}

interface Gap {
  ellipsis: boolean
  /** the brackets the gap is made of, as written */
  brackets: { raw: string; content: string }[]
  maxChars: number
  maxWords: number
  /** attached to the piece on its left / right (no space between): the gap then replaces part of that word */
  attachedLeft: boolean
  attachedRight: boolean
  /** a bracket with no space inside, attached to a word: what it stands for may not contain a space */
  inWord: boolean
}

interface Plan {
  pieces: Piece[]
  /** gaps[k] lies between pieces[k] and pieces[k + 1] */
  gaps: Gap[]
  lead?: Gap
  trail?: Gap
  /** punctuation stripped from the end of the quotation (not compared) */
  trailing: string
  /** brackets read as written (the first reading) */
  literalBrackets: string[]
  usable: boolean
}

function gapOf(toks: Token[], attachedLeft: boolean, attachedRight: boolean, spacedInside: boolean, L: QuotationLimits): Gap {
  const ellipsis = toks.some(t => t.t === 'ellipsis')
  const brackets = toks.flatMap(t => (t.t === 'bracket' ? [{ raw: t.raw, content: t.content }] : []))
  const words = brackets.reduce((n, b) => n + wordsIn(b.content), 0)
  const maxChars = (ellipsis ? L.ellipsisChars : 0) + brackets.length * L.bracketChars
  const maxWords = ellipsis ? Number.POSITIVE_INFINITY : words + L.bracketExtraWords * brackets.length
  const inWord = !ellipsis && !spacedInside && brackets.length > 0 && brackets.every(b => !/\s/.test(b.content)) && (attachedLeft || attachedRight)
  return { ellipsis, brackets, maxChars, maxWords, attachedLeft, attachedRight, inWord }
}

/** The quotation as pieces and gaps. 'literal' reads brackets as written; 'substitute' reads each as a short gap. */
function planOf(tokens: Token[], brackets: 'literal' | 'substitute', L: QuotationLimits = QUOTATION_LIMITS, opts: LegalReadOptions = {}): Plan {
  const normalizeLegalText = (s: string): Mapped => normalizeLegal(s, opts)
  // Segments: runs of text, and runs of gaps (brackets, ellipses and any spaces between them).
  type Elem = Token | 'space'
  type Seg = { t: 'text'; raw: string; br: boolean[] } | { t: 'gap'; elems: Elem[] }
  const segs: Seg[] = []
  const literalBrackets: string[] = []
  for (const tok of tokens) {
    const prev = segs[segs.length - 1]
    if (tok.t === 'text' || (tok.t === 'bracket' && brackets === 'literal')) {
      const raw = tok.t === 'bracket' ? tok.content : tok.raw
      const flags = new Array<boolean>(raw.length).fill(tok.t === 'bracket')
      if (tok.t === 'bracket') literalBrackets.push(tok.raw)
      if (prev && prev.t === 'text') { prev.raw += raw; prev.br.push(...flags) }
      else segs.push({ t: 'text', raw, br: flags })
    } else if (prev && prev.t === 'gap') prev.elems.push(tok)
    else segs.push({ t: 'gap', elems: [tok] })
  }
  // Text that normalises to nothing (spaces) is a space inside the run of gaps around it.
  const merged: Seg[] = []
  for (const s of segs) {
    const prev = merged[merged.length - 1]
    if (s.t === 'text' && normalizeLegalText(s.raw).text.length === 0) {
      if (prev && prev.t === 'gap') prev.elems.push('space')
      else merged.push({ t: 'gap', elems: ['space'] })
      continue
    }
    if (s.t === 'gap' && prev && prev.t === 'gap') { prev.elems.push(...s.elems); continue }
    merged.push(s)
  }

  const isBracket = (e: Elem | undefined): boolean => e !== undefined && e !== 'space' && e.t === 'bracket'
  const pieces: Piece[] = []
  const gaps: Gap[] = []
  let lead: Gap | undefined
  let trail: Gap | undefined
  for (let k = 0; k < merged.length; k++) {
    const s = merged[k] as Seg
    const before = merged[k - 1]
    const after = merged[k + 1]
    if (s.t === 'text') {
      // A bracket written against this text (no space between) is attached: the piece need not start / end a word there.
      const attachedBefore = before !== undefined && before.t === 'gap' && isBracket(before.elems[before.elems.length - 1]) && !isSpace(s.raw[0])
      const attachedAfter = after !== undefined && after.t === 'gap' && isBracket(after.elems[0]) && !isSpace(s.raw[s.raw.length - 1])
      pieces.push({ text: normalizeLegalText(s.raw).text, boundStart: !attachedBefore, boundEnd: !attachedAfter, quoted: s.raw, bracketed: s.br })
      continue
    }
    const toks = s.elems.filter((e): e is Token => e !== 'space')
    if (toks.length === 0) continue // only spaces (before the first piece or after the last): nothing to place
    const attachedLeft = before !== undefined && before.t === 'text' && isBracket(s.elems[0]) && !isSpace(before.raw[before.raw.length - 1])
    const attachedRight = after !== undefined && after.t === 'text' && isBracket(s.elems[s.elems.length - 1]) && !isSpace(after.raw[0])
    const g = gapOf(toks, attachedLeft, attachedRight, s.elems.includes('space'), L)
    if (pieces.length === 0) lead = g
    else if (!merged.slice(k + 1).some(x => x.t === 'text')) trail = g
    else gaps.push(g)
  }
  // Trailing punctuation: a period, comma, semicolon or colon ending the quotation is not compared.
  let trailing = ''
  const lastPiece = pieces[pieces.length - 1]
  if (lastPiece) {
    const m = lastPiece.text.match(/[.,;:\s]+$/)
    if (m) { trailing = m[0].replace(/\s+/g, ''); lastPiece.text = lastPiece.text.slice(0, m.index) }
    if (lastPiece.text.length === 0) {
      pieces.pop()
      if (gaps.length > 0 && pieces.length > 0) trail = gaps.pop()
    }
  }
  const pieceWords = pieces.map(p => wordsIn(p.text))
  const hasGaps = gaps.length > 0 || lead !== undefined || trail !== undefined
  const usable = pieces.length > 0 && (!hasGaps || (Math.max(...pieceWords) >= L.minPieceWords &&
    pieceWords.reduce((a, b) => a + b, 0) >= L.minLiteralWords))
  return { pieces, gaps, ...(lead ? { lead } : {}), ...(trail ? { trail } : {}), trailing, literalBrackets, usable }
}

// ── placing the pieces in the opinion ─────────────────────────────────────────────────────────────────────────────────

const boundedAt = (text: string, p: number, needle: string, bs: boolean, be: boolean): boolean =>
  (!bs || p === 0 || !isWordChar(text[p - 1]) || !isWordChar(needle[0])) &&
  (!be || p + needle.length >= text.length || !isWordChar(text[p + needle.length]) || !isWordChar(needle[needle.length - 1]))

/** Occurrences of `piece` starting in [from, to], on the word boundaries it requires, at most `cap`. */
function occurrences(text: string, piece: Piece, from: number, to: number, cap: number): number[] {
  const out: number[] = []
  let p = text.indexOf(piece.text, Math.max(0, from))
  while (p >= 0 && p <= to && out.length < cap) {
    if (boundedAt(text, p, piece.text, piece.boundStart, piece.boundEnd)) out.push(p)
    p = text.indexOf(piece.text, p + 1)
  }
  return out
}

/** Can the opinion text in [from, to) be what this gap stands for? */
function gapFits(text: string, from: number, to: number, g: Gap): boolean {
  const raw = text.slice(from, to)
  const inner = raw.trim()
  if (inner.length > g.maxChars) return false
  if (wordsIn(inner) > g.maxWords) return false
  if (g.inWord) {
    if (inner.includes(' ')) return false
    // replacing part of the attached word: the replaced text touches that word
    if (inner.length > 0 && g.attachedLeft && isSpace(raw[0])) return false
    if (inner.length > 0 && g.attachedRight && isSpace(raw[raw.length - 1])) return false
  }
  return true
}

interface Placement { starts: number[]; ends: number[]; from: number; to: number; leadFrom?: number; trailTo?: number }

/** Every piece in order with every gap fitting, or undefined. The first occurrence of the longest piece that extends wins. */
function place(text: string, plan: Plan): Placement | undefined {
  const P = plan.pieces
  let budget = 50_000 // candidate checks; exhausted = not placed (the safe side)
  let a = 0
  for (let k = 1; k < P.length; k++) if ((P[k] as Piece).text.length > (P[a] as Piece).text.length) a = k
  const starts: number[] = new Array<number>(P.length).fill(0)
  const ends: number[] = new Array<number>(P.length).fill(0)

  const right = (k: number): boolean => {
    if (k === P.length) return true
    const g = plan.gaps[k - 1] as Gap
    const piece = P[k] as Piece
    const prevEnd = ends[k - 1] as number
    for (const s of occurrences(text, piece, prevEnd, prevEnd + g.maxChars + 2, 64)) {
      if (--budget < 0) return false
      if (!gapFits(text, prevEnd, s, g)) continue
      starts[k] = s
      ends[k] = s + piece.text.length
      if (right(k + 1)) return true
    }
    return false
  }
  const left = (k: number): boolean => {
    if (k < 0) return true
    const g = plan.gaps[k] as Gap
    const piece = P[k] as Piece
    const nextStart = starts[k + 1] as number
    const lo = nextStart - g.maxChars - 2 - piece.text.length
    const found = occurrences(text, piece, lo, nextStart - piece.text.length, 256).reverse() // nearest first
    for (const s of found) {
      if (--budget < 0) return false
      const e = s + piece.text.length
      if (e > nextStart || !gapFits(text, e, nextStart, g)) continue
      starts[k] = s
      ends[k] = e
      if (left(k - 1)) return true
    }
    return false
  }
  /** A bracket attached to the first / last piece replaces the rest of that word: at most bracketChars, no space. */
  const edge = (g: Gap | undefined, at: number, dir: -1 | 1): number | undefined | false => {
    if (!g || g.ellipsis || !g.inWord) return undefined // not located: the quoter's own words, or an omission at the edge
    let j = at
    if (dir < 0) while (j > 0 && isWordChar(text[j - 1])) j--
    else while (j < text.length && isWordChar(text[j])) j++
    return Math.abs(at - j) <= g.maxChars ? j : false
  }

  for (const s of occurrences(text, P[a] as Piece, 0, text.length, 2000)) {
    if (--budget < 0) return undefined
    starts[a] = s
    ends[a] = s + (P[a] as Piece).text.length
    if (!right(a + 1) || !left(a - 1)) continue
    const leadFrom = edge(plan.lead, starts[0] as number, -1)
    const trailTo = edge(plan.trail, ends[P.length - 1] as number, 1)
    if (leadFrom === false || trailTo === false) continue
    return {
      starts: [...starts], ends: [...ends],
      from: leadFrom ?? (starts[0] as number), to: trailTo ?? (ends[P.length - 1] as number),
      ...(leadFrom !== undefined ? { leadFrom } : {}), ...(trailTo !== undefined ? { trailTo } : {}),
    }
  }
  return undefined
}

// ── the reading ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LegalPreparedSource {
  raw: string
  norm: Mapped
  /** word tokens, built on first need (the nearest-passage search) */
  words?: WordTokens
  /** legal@0.4.0: how the text was read (page marks read out), the marks read out, and the text with them blanked */
  opts?: LegalReadOptions
  marks?: PageMark[]
  blank?: string
}

/** Prepare an opinion text. legal@0.1.0 to 0.3.0 call it bare; legal@0.4.0 with `{ pageMarks: 'safe' }`. */
export function prepareLegalSource(raw: string, opts: LegalReadOptions = {}): LegalPreparedSource {
  if (opts.pageMarks === undefined) return { raw, norm: normalizeLegalText(raw) }
  const marks = marksFor(raw, opts.pageMarks, opts)
  return { raw, norm: normalizeLegalText(raw, opts), opts, marks, blank: blankMarks(raw, marks) }
}

/** A bracket the match read as a substitution (legal@0.2.0's meaning guard reads these). */
export interface Alteration {
  /** the bracket as written, e.g. "[may]" */
  raw: string
  content: string
  /** the opinion text it stands for (original characters); undefined when not located (at an edge) or inside an omission */
  stands?: string
  /** inside an ellipsis gap: what it stands for is mixed with the omission */
  inOmission: boolean
  /** attached inside a word ("serv[e]"): the whole quoted word and the whole opinion word */
  quoteWord?: string
  opinionWord?: string
  /** legal@0.5.5 reads it (no earlier rule does): the quotation's word just before the bracket, when one stands there */
  prevWord?: string
  /** legal@0.5.5 reads it: for a bracket at an edge of the quotation, not located, the text's word just outside the match on that side */
  edgeWord?: string
}

export type QuotationReading =
  /** The quotation is in the opinion, read with the conventions listed in `notes` (empty = verbatim). */
  | {
    kind: 'match'; span: Span; text: string; notes: string[]; selective?: { via: 'ellipsis' | 'bracket'; detail: string }
    /** 2026-10-03: the brackets read as substitutions, the opinion text each located ellipsis stands for, the parentheticals stripped */
    alterations: Alteration[]; omissions: string[]; parentheticals: string[]
    /** legal@0.5.5 reads these (no earlier rule does): where each of `omissions` lies in the text, in the same order */
    omissionSpans?: Span[]
    /** legal@0.3.0 reads these (0.1.0 and 0.2.0 never do): see EdgeReading and CaseReading */
    edges: EdgeReading; cases: CaseReading
  }
  /** Not in the opinion as quoted; the corresponding passage (similarity ≥ 0.8) or the nearest one (≥ 0.5). `core` (2026-10-05,
   *  read by legal@0.4.0 only) is the stretch the quotation aligns with, without the two words of margin either side. */
  | { kind: 'passage'; strength: 'corresponding' | 'nearest'; span: Span; text: string; anchorWords: number; similarity: number; core?: Span }
  /** Not located. `longestRun` = the longest run of consecutive quoted words found as whole words. */
  | { kind: 'none'; longestRun: number }

/**
 * legal@0.3.0: how the quotation meets the edges of the sentence it is cut from.
 *   lead 'ellipsis'  the quotation opens with an ellipsis (words before it are omitted)
 *   lead 'capital'   the quotation's first letter is a capital where the opinion has a small letter: it presents words from the
 *                    middle of a sentence as the start of one ("[I]t cannot be said" for "Unless …, it cannot be said");
 *                    `bracketed` says whether the capital is written in a bracket
 *   trail 'ellipsis' the quotation closes with an ellipsis (words after it are omitted)
 */
export interface EdgeReading { lead?: 'ellipsis' | 'capital'; bracketed?: boolean; trail?: 'ellipsis' }

/**
 * legal@0.3.0: the quotation's letter case against the opinion's, letter for letter over each literal piece (`compared` false when
 * the letters do not line up one for one, e.g. a case fold that changes length). A difference is `allowed` when the letter is
 * written in a bracket ("[T]he"), or is the first letter of the quotation or the first after an ellipsis; any other is `changed`,
 * shown by the first piece that has one, as quoted and as the opinion reads.
 */
export interface CaseReading { compared: boolean; allowed: number; changed: number; quoted?: string; reads?: string; firstLetter?: boolean }

const firstLetterOf = (s: string | undefined): string | undefined => s?.match(/\p{L}/u)?.[0]
const isLower = (c: string): boolean => c !== c.toUpperCase() && c === c.toLowerCase()
const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()

function edgesOf(plan: Plan, passage: string): EdgeReading {
  const out: EdgeReading = {}
  if (plan.lead?.ellipsis) out.lead = 'ellipsis'
  else {
    const fromBracket = plan.lead !== undefined && plan.lead.brackets.length > 0
    const first = plan.pieces[0]
    const q = fromBracket ? firstLetterOf(plan.lead!.brackets[0]!.content) : firstLetterOf(first?.quoted)
    const o = firstLetterOf(passage)
    // a capital that starts a sentence: the first word is not written all in capitals ("[I]t", "It", "A"; not "WOULD")
    const firstWord = fromBracket ? `${plan.lead!.brackets[0]!.content}${first?.quoted ?? ''}` : (first?.quoted ?? '')
    const word = firstWord.trim().match(/^[\p{L}'’]+/u)?.[0] ?? ''
    const shouting = word.replace(/[^\p{L}]/gu, '').length > 1 && word === word.toUpperCase()
    if (q !== undefined && o !== undefined && isUpper(q) && isLower(o) && !shouting) {
      out.lead = 'capital'
      const at = first ? [...first.quoted].findIndex(ch => /\p{L}/u.test(ch)) : -1
      out.bracketed = fromBracket || (first !== undefined && at >= 0 && first.bracketed[at] === true)
    }
  }
  if (plan.trail?.ellipsis) out.trail = 'ellipsis'
  return out
}

function casesOf(p: LegalPreparedSource, plan: Plan, at: Placement): CaseReading {
  const out: CaseReading = { compared: true, allowed: 0, changed: 0 }
  for (let k = 0; k < plan.pieces.length; k++) {
    const pc = plan.pieces[k] as Piece
    // legal@0.5.1: the letters read are the text's with its read-out marks blanked (a citation left out under "(citation omitted)"
    // has letters of its own, which are not the quotation's); earlier rules read the text as written, unchanged
    const span = p.opts?.v051 && p.blank !== undefined ? toOriginalSpan(p.norm, at.starts[k] as number, at.ends[k] as number) : undefined
    const reads0 = span !== undefined && (at.ends[k] as number) > (at.starts[k] as number) ? (p.blank as string).slice(span.start, span.end) : originalOf(p, at.starts[k] as number, at.ends[k] as number)
    // legal@0.5.5: a ligature is compared as its letters, on both sides (LIGATURES_055)
    const v055 = p.opts?.v055 === true
    const reads = v055 ? foldLigatures055(reads0) : reads0
    const q: { ch: string; br: boolean }[] = []
    for (let i = 0; i < pc.quoted.length; i++) {
      const ch = pc.quoted[i] as string
      if (!/\p{L}/u.test(ch)) continue
      for (const x of v055 ? foldLigatures055(ch) : ch) q.push({ ch: x, br: pc.bracketed[i] === true })
    }
    const o = [...reads].filter(ch => /\p{L}/u.test(ch))
    if (q.length !== o.length || q.some((x, i) => x.ch.toLowerCase() !== (o[i] as string).toLowerCase())) return { compared: false, allowed: 0, changed: 0 }
    const afterGap = k === 0 ? plan.lead?.ellipsis === true || plan.lead === undefined : (plan.gaps[k - 1] as Gap).ellipsis
    q.forEach((x, i) => {
      if (x.ch === o[i]) return
      const first = i === 0 && (k === 0 || afterGap)
      if (x.br || first) { out.allowed++; if (first && !x.br) out.firstLetter = true; return }
      out.changed++
      if (out.quoted === undefined) { out.quoted = squash(pc.quoted); out.reads = squash(reads) }
    })
  }
  return out
}

/**
 * legal@0.3.0: the words of the opinion's sentence before `start` (back to the sentence's start) and after `end` (to its end),
 * at most `cap` characters each way. A sentence ends at a period, question or exclamation mark followed by a space (or a closing
 * mark and a space) and is not an abbreviation ("U.S.", "v.", "Inc.", "e.g.", a single letter), not an ellipsis; or at a line break
 * after a line that does not run on (a heading: it ends without a small letter, comma, semicolon or opening bracket) when the next
 * line starts with a capital. Reading too far is the safe side: more of the sentence is examined, never less.
 */
const SENTENCE_ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'no', 'nos', 'v', 'vs', 'inc', 'co', 'corp', 'ltd', 'cir', 'ct', 'app', 'supp', 'stat', 'cong', 'sess', 'rev', 'ann', 'gen', 'gov', 'jr', 'sr', 'bros', 'id', 'cf', 'al', 'seq', 'art', 'sec', 'ch', 'cl', 'fed', 'civ', 'crim', 'proc', 'evid', 'reg', 'pp', 'ed', 'eds', 'ibid', 'op', 'dist', 'div', 'misc', 'ex', 'rel', 'univ', 'dept', 'assn', 'comm', 'natl', 'intl', 'cert', 'prob', 'amend', 'const', 'admin', 'mfg', 'ry', 'ins'])
function sentenceEndsAt(raw: string, i: number): boolean {
  const c = raw[i]
  if (c === '\n') {
    let j = i - 1
    while (j >= 0 && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\r')) j--
    let k = i + 1
    while (k < raw.length && /\s/.test(raw[k] as string)) k++
    const prevCh = raw[j]
    return prevCh !== undefined && !/[\p{Ll},;(\[\-–—]/u.test(prevCh) && k < raw.length && /\p{Lu}/u.test(raw[k] as string)
  }
  if (c !== '.' && c !== '?' && c !== '!') return false
  let k = i + 1
  while (k < raw.length && /["”’)\]]/.test(raw[k] as string)) k++
  if (k < raw.length && !/\s/.test(raw[k] as string)) return false
  if (c !== '.') return true
  if (raw[i - 1] === '.' || raw[i + 1] === '.' || (raw[i - 1] === ' ' && raw[i - 2] === '.') || (raw[i + 1] === ' ' && raw[i + 2] === '.')) return false // an ellipsis
  let s = i
  while (s > 0 && !/\s/.test(raw[s - 1] as string)) s--
  const word = raw.slice(s, i)
  if (/\p{L}\.\p{L}/u.test(word) || /\.\S/.test(word)) return false // "U.S", "e.g", "Cir.1996)"
  const letters = word.replace(/[^\p{L}]/gu, '')
  return letters.length > 1 && !SENTENCE_ABBREVIATIONS.has(letters.toLowerCase())
}
export function sentenceHeadBefore(raw: string, start: number, cap = 600, numbers: SentenceReading = false): string {
  const lo = Math.max(0, start - cap)
  const ends = endsAt(numbers)
  for (let j = start - 1; j >= lo; j--) if (ends(raw, j)) return raw.slice(j + 1, start)
  return raw.slice(lo, start)
}
export function sentenceTailAfter(raw: string, end: number, cap = 600, numbers: SentenceReading = false): string {
  const hi = Math.min(raw.length, end + cap)
  const ends = endsAt(numbers)
  for (let j = end; j < hi; j++) if (ends(raw, j)) return raw.slice(end, j + 1)
  return raw.slice(end, hi)
}

/**
 * legal@0.5.1: what follows a quotation's last word in its sentence, read on the text with its page marks blanked; '' when the
 * quotation ends where its sentence ends (its last character, or the punctuation before closing marks, ends the sentence). A view's
 * section separator ends it (the next section is not the sentence's).
 */
export function continuationAfter(raw: string, end: number, v053 = false): string {
  let j = end - 1
  while (j >= 0 && /["”’)\]\s]/.test(raw[j] as string)) j--
  if (j >= 0 && (v053 ? sentenceEndsAt053 : sentenceEndsAt051)(raw, j) && raw.slice(j + 1, end).trim().replace(/["”’)\]]/g, '') === '') return ''
  let tail = sentenceTailAfter(raw, end, 600, v053 ? 'v053' : true)
  // the closing marks after the sentence's last period belong to it ("… disruptive discovery."")
  let k = end + tail.length
  while (k < raw.length && /["”’)\]]/.test(raw[k] as string)) tail += raw[k++]
  const cut = tail.indexOf('¦')
  return cut >= 0 ? tail.slice(0, cut) : tail
}

/**
 * legal@0.5.1: whether a continuation is only a citation of what the sentence quotes (`,” Conley v. Gibson, 355 U. S. 41, 47 (1957).`):
 * the quoted words then end where the sentence's own words end.
 */
export function onlyCitation(tail: string): boolean {
  const t = tail.replace(/^[\s"“”'‘’)\],;:]+/u, '')
  if (t.length === 0) return false
  const c = citationSentencesOf(t)
  return c.length === 1 && c[0]!.start === 0 && t.slice(c[0]!.end).trim() === ''
}

/**
 * legal@0.5.1: whether the part of a sentence before a quotation holds words, a footnote call or a page or headnote number aside
 * (a Lexis "n3 It does not …": the quotation begins where its sentence begins).
 */
export function hasWordsBefore(head: string): boolean {
  const t = head
    .replace(/(?<![\p{L}\p{N}])(?:fn|n)\.?\s?\d{1,3}(?![\p{L}\p{N}])/giu, ' ')
    .replace(/\[[^\]]{0,8}\]|\*{1,4}\d{1,5}|[¹²³⁰⁴-⁹]+/gu, ' ')
  return /\p{L}/u.test(t)
}

/** legal@0.5.1: a stretch shown to a reader, whitespace collapsed, at most `max` characters, cut at word boundaries (its start and end kept). */
export function clipWords(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const keep = Math.floor((max - 3) / 2)
  const a = t.slice(0, keep).replace(/\s+\S*$/u, '')
  const b = t.slice(-keep).replace(/^\S*\s+/u, '')
  return `${a} … ${b}`
}

// legal@0.5.1: a quotation that stops before its sentence ends is held when what follows limits or negates it. Read on the
// continuation: its first words, after a comma, dash, semicolon, colon or parenthesis, are a limiting word ("but", "unless",
// "except", "only", "however", "provided", "if", "until" …) or a negation ("not", "never" …); or, when the continuation goes on
// in the same clause (no punctuation first: "… complaint" + " is inapplicable to legal conclusions"), that clause carries a negation
// or a word that denies what precedes it ("inapplicable", "insufficient", "unavailable" …). A concession after the quoted words
// ("notwithstanding …", "although …", "even if …") does not limit them: they hold regardless, so it is not read as a limitation.
const TAIL_OPENER = /^(?:(?:and|or)\s+only|but|unless|except|excepting|save|only|however|provided|providing|if|where|wherever|when|whenever|so\s+long\s+as|as\s+long\s+as|to\s+the\s+extent|insofar\s+as|in\s+so\s+far\s+as|subject\s+to|until|till|absent|in\s+the\s+absence\s+of|other\s+than|yet|nevertheless|nonetheless|not|nor|neither|never|no|none|without|cannot|\p{L}+n['’]t)(?![\p{L}])/iu
const NEGATIVE_PREDICATE = /(?<![\p{L}])(?:inapplicable|insufficient|inadequate|irrelevant|immaterial|inadmissible|invalid|improper|impermissible|inappropriate|incorrect|inaccurate|inconsistent|unavailable|unavailing|unnecessary|unwarranted|unpersuasive|unfounded|unsupported|unconstitutional|unenforceable|unlawful|unreasonable|untenable|erroneous|mistaken|misplaced|wrong|false|rejected|overruled|abrogated|disapproved|repudiated|abandoned|foreclosed|precluded|barred|prohibited|forbidden|doubtful|questionable)(?![\p{L}])/iu

/** legal@0.5.1: the limiting or negating word a continuation opens with (above), or undefined when it is neutral. */
export function tailLimitOf(tail: string): { word: string; kind: 'limitation' | 'negation' } | undefined {
  const t = tail.replace(/^[\s"“”'‘’)\]]+/u, '')
  const direct = !/^[,;:(—–-]/u.test(t)
  const lead = t.replace(/^[\s,;:(—–-]+/u, '')
  const op = TAIL_OPENER.exec(lead)
  if (op) return { word: op[0], kind: /^(?:not|nor|neither|never|no|none|without|cannot|\p{L}+n['’]t)$/iu.test(op[0]) ? 'negation' : 'limitation' }
  // a set-off phrase of time or procedure after a comma states when the rule applies, as legal@0.3.0 reads one inside an omission
  // (", after adequate time for discovery and upon motion, against a party who fails …"); straight on ("filed after the deadline")
  // it does not set anything off
  const setOff = direct ? null : /^(?:after|before|upon|once)(?![\p{L}])/iu.exec(lead)
  if (setOff) return { word: setOff[0], kind: 'limitation' }
  if (!direct) return undefined
  const clause = lead.split(/[,;:(—–]|(?<![\p{L}])but(?![\p{L}])/iu)[0] ?? lead
  const neg = HEAD_NEGATION.exec(clause) ?? NEGATIVE_PREDICATE.exec(clause)
  return neg ? { word: neg[0], kind: 'negation' } : undefined
}

/**
 * legal@0.3.0: an omitted stretch that opens a set-off phrase with a word of time or procedure ("after adequate time for discovery
 * and upon motion", between commas) is a condition too: it states when the rule applies. The first such word, or undefined.
 * legal@0.2.0's condition words (conditionWordIn) are tested first.
 */
const TEMPORAL_OPENER = /(?:^|[,;(—–]\s*)(after|before|upon|until|till|once|when|whenever)\b/iu
export function conditionIn030(t: string): string | undefined {
  return conditionWordIn(t) ?? TEMPORAL_OPENER.exec(t.trim())?.[1]
}

// ── legal@0.4.0: a quotation that begins in the middle of its sentence (2026-10-05) ──────────────────────────────────────────
//
// legal@0.3.0 reads what an opening capital cuts from a sentence ("[T]he motion …" from "Unless the movant shows actual prejudice,
// the motion …"), but a quotation that begins mid-sentence as the opinion writes it ("the motion to amend must be granted") was
// read as a phrase and passed "verbatim" (a cold reader's (an AI agent's) five cuts: "Only …", "Unless …,", "Except …,", "If …,",
// "Absent …,"). legal@0.4.0 reads the same part of the sentence (sentenceHeadBefore) whenever the quotation does not begin where
// its sentence begins, and holds it when that part is a condition or a limit on what follows:
//   - it opens with a conditional or restrictive word (LEAD_OPENERS: "Only", "Unless", "Except", "If", "Absent", "Provided",
//     "Where", "When", "To the extent", …), or
//   - it ends with a comma right before the quotation, and the stretch since the last comma, semicolon, colon, parenthesis or dash
//     before that one holds such a word ("The court held that, unless the movant shows prejudice, " · "The rule is that if the
//     contract is ambiguous, "), or
//   - its last clause (after the last semicolon, colon or "but") carries a negation (HEAD_NEGATION: "not", "no", "never",
//     "neither", "nor", "without", …), which governs what follows ("Neither do we suggest that … the trial court may not deny").
//     A negation the 0.0.1 guard already reads (in the same clause, within 80 characters) is answered by that guard, as before.
// A part that is neither ("The court held that ") is not held: a quotation may begin mid-sentence without an ellipsis.

const OPENER_WORDS = 'only|unless|except|excepting|if|absent|provided|providing|where|wherever|when|whenever|to\\s+the\\s+extent|so\\s+long\\s+as|as\\s+long\\s+as|subject\\s+to|until|till|once|after|before|upon|save|but\\s+for|in\\s+the\\s+absence\\s+of|notwithstanding'
const LEAD_OPENERS = new RegExp(`^(?:${OPENER_WORDS})\\b`, 'iu')
const OPENER_INSIDE = new RegExp(`(?:^|[^\\p{L}])(${OPENER_WORDS})(?![\\p{L}])`, 'iu')
const HEAD_NEGATION = /(?<![\p{L}'’])(?:not|no|never|neither|nor|none|nothing|nobody|nowhere|cannot|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|\p{L}+n['’]t)(?![\p{L}])/iu

/**
 * legal@0.5.4 (2026-10-14): a comma followed by a coordinating conjunction starts a new clause, so a negation before ", and" governs the
 * clause before it only. legal@0.5.3 read "A conclusory affidavit … does not create a genuine dispute, and a party may not defeat summary
 * judgment …" as negating the words after ", and", and held three genuine quotations of a cold review (an AI agent in a legal-operations
 * role, not a person) as "preceded by a negation the quote omits". The clause a negation governs ends at a semicolon, a colon, "but", or
 * a comma before "and", "or", "nor", "yet" or "so"; not before ", and that" or ", or that", which coordinate a further complement under
 * the same verb ("We do not decide today that X, that Y, or that Z": the negation reaches Z).
 */
export const CLAUSE_CUT_054 = /[;:]|(?<![\p{L}])but(?![\p{L}])|,\s+(?:and|or|nor|yet|so)(?!\s+that(?![\p{L}]))(?![\p{L}])/iu

/** legal@0.5.4: a conjunction that ends the words before a quotation beginning with "that" (", or " + "that a more just …") coordinates a complement under the same verb: no new clause. */
export const continuesClause054 = (head: string, next: string | undefined): string => (next !== undefined && /^\s*that(?![\p{L}])/iu.test(next) ? head.replace(/,\s+(?:and|or|nor|yet|so)\s*$/iu, ' ') : head)

/** What a quotation that begins mid-sentence cuts from its sentence (legal@0.4.0): the condition or negation word, or undefined. legal@0.5.4 (`v054`) ends a negation's clause at a comma before a coordinating conjunction too (CLAUSE_CUT_054), unless the quotation's first word is "that" (`next`: the text the quotation begins with). */
export function leadCutOf(head: string, opts: { v054?: boolean; next?: string } = {}): { word: string; kind: 'condition' | 'negation' } | undefined {
  const h = head.replace(/^[\s"“”'‘’([]+/u, '')
  const opener = LEAD_OPENERS.exec(h)
  if (opener) return { word: opener[0], kind: 'condition' }
  const t = h.replace(/\s+$/u, '')
  if (t.endsWith(',')) {
    const seg = t.slice(0, -1).split(/[,;:(—–]/u).pop() ?? ''
    const inside = OPENER_INSIDE.exec(seg)
    if (inside) return { word: inside[1] as string, kind: 'condition' }
  }
  // a negation governs its own clause: what follows the last semicolon, colon or "but" before the quotation ("is not a law; it",
  // "does not immunize …, but that such commerce may be" do not negate the quoted words)
  const clause = (opts.v054 ? continuesClause054(h, opts.next).split(CLAUSE_CUT_054) : h.split(/[;:]|(?<![\p{L}])but(?![\p{L}])/iu)).pop() ?? h
  const neg = HEAD_NEGATION.exec(clause)
  return neg ? { word: neg[0], kind: 'negation' } : undefined
}

// ── legal@0.5.2: whose words follow a lead-in (2026-10-06) ──────────────────────────────────────────────────────────────────────
//
// legal@0.5.1 passed "the statute of limitations was tolled." quoted from "The dissent maintains that the statute of limitations was
// tolled." as "verbatim", and so with "Appellant argues that …", "Were we writing on a clean slate, we might hold that …" and "It
// would be a mistake to conclude that …" (a cold reader's probe; an AI agent, not a person). A quotation that begins in the middle of
// its sentence leaves out how the sentence begins, and those words can say the opinion is not speaking for itself. legal@0.5.2 reads
// them (the head of the sentence, as leadCutOf does) and holds the quotation when they:
//   - report another's position: a reporting verb at their end whose subject is not the court ("Appellant argues that", "the dissent
//     maintains that", "Respondent moved for summary judgment, contending that", "the court below held that", "the Ninth Circuit
//     reasoned that"); an argument named as one ("the contention that"); a report with no speaker ("it is argued that");
//   - state a counterfactual or a possibility ("we might hold that", "a reasonable jury could find that", "one could argue that", a
//     sentence opening "Were we …" or "Had the …");
//   - reject what follows ("It would be a mistake to conclude that");
//   - pose it as a question ("The question is whether") or a hypothetical ("Suppose that", "Assuming that").
// The court's own voice is not held: "we hold that", "We conclude that", "this Court held that", "the Court has said that". A verb
// that only reports ("says", "held", "found", "noted") needs a speaker the reader names (a party, a separate opinion, another court
// or tribunal); a verb that only a party or a critic uses ("argues", "contends", "maintains", "urges") holds whoever its subject is,
// unless it is the court.

/** What a lead-in says about the words after it (legal@0.5.2, above; 'source', another opinion or source the opinion relies on or quotes, from legal@0.5.3). */
export type LeadFrameKind = 'party' | 'separate' | 'court' | 'other' | 'argument' | 'counterfactual' | 'rejected' | 'question' | 'hypothetical' | 'source'
export interface LeadFrame { kind: LeadFrameKind; speaker?: string }

type Speaker = 'own' | 'party' | 'separate' | 'court' | 'other'
const SPEAKERS: [Speaker, RegExp][] = [
  ['own', /(?<![\p{L}])(?:we|us|our|i|this\s+court|this\s+panel)(?![\p{L}])/giu],
  ['own', /(?<![\p{L}])the\s+Court(?![\p{L}])(?!\s+(?:of|below|a\s+quo)(?![\p{L}]))/gu],
  ['court', /(?<![\p{L}])the\s+court(?![\p{L}])/gu],
  ['court', /(?<![\p{L}])the\s+courts?\s+(?:below|a\s+quo)(?![\p{L}])|(?<![\p{L}])the\s+court\s+of\s+(?:appeals?|criminal\s+appeals|claims)(?![\p{L}])|(?<![\p{L}])the\s+supreme\s+court(?![\p{L}])/giu],
  ['court', /(?<![\p{L}])(?:district|trial|lower|appellate|circuit|bankruptcy|state|federal|county|superior|family|tax|juvenile|probate|chancery|habeas|reviewing|sentencing|motions?|magistrate|municipal|intermediate|other|some|many|several|most|numerous|sister)\s+(?:court|courts|judge|judges)(?![\p{L}])/giu],
  ['court', /(?<![\p{L}])the\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|d\.\s?c\.|federal)\s+circuit(?![\p{L}])|(?<![\p{L}])the\s+(?:\p{L}+\s+)?panel(?![\p{L}])|(?<![\p{L}])the\s+(?:administrative\s+law\s+judge|alj|immigration\s+judge|hearing\s+(?:officer|examiner)|arbitrator|special\s+master|magistrate(?:\s+judge)?|jury|board|commission|tribunal)(?![\p{L}])|(?<![\p{L}])\p{Lu}\p{L}+\s+(?:Supreme\s+Court|Court\s+of\s+Appeals)(?![\p{L}])/giu],
  ['separate', /(?<![\p{L}])the\s+(?:principal\s+|lead\s+|partial\s+|first\s+|second\s+)?(?:dissent|dissents|concurrence|concurrences|dissenters|dissenting\s+(?:opinion|judges?|justices?)|concurring\s+(?:opinion|judges?|justices?)|separate\s+opinion)(?![\p{L}])|(?<![\p{L}])(?:dissenting|concurring)\s+(?:colleagues?|brothers?|brethren|sisters?)(?![\p{L}])|(?<![\p{L}])the\s+chief\s+justice(?![\p{L}])/giu],
  ['separate', /(?<![\p{L}])(?:Chief\s+)?(?:Justice|JUSTICE|Judge|JUDGE)\s+\p{Lu}[\p{L}'’-]+|(?<![\p{L}])\p{Lu}[\p{L}'’-]+['’]s\s+(?:dissent|concurrence)(?![\p{L}])/gu],
  ['party', /(?<![\p{L}])(?:the\s+)?(?:appellants?|appellees?|petitioners?|respondents?|plaintiffs?|defendants?|movants?|nonmovants?|claimants?|complainants?|relators?|intervenors?|amic(?:us|i)(?:\s+curiae)?|counsel|prosecutors?|debtors?|objectors?|applicants?)(?![\p{L}])|(?<![\p{L}])the\s+(?:government|state|commonwealth|people|prosecution|defense|defence|united\s+states|parties|trustee|union|attorney\s+general|solicitor\s+general|secretary|commissioner)(?![\p{L}])/giu],
  ['other', /(?<![\p{L}])(?:commentators?|scholars?|critics?|academics?|authorities)(?![\p{L}])|(?<![\p{L}])(?:some|others)\s+(?:have|has|had)(?![\p{L}])/giu],
]

/** The speaker named nearest the end of `s` (the last match; a longer one where two end together), or undefined. */
function speakerIn(s: string): { kind: Speaker; text: string } | undefined {
  let best: { kind: Speaker; text: string; end: number } | undefined
  for (const [kind, re] of SPEAKERS) {
    for (const m of s.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length
      if (!best || end > best.end || (end === best.end && m[0].length > best.text.length)) best = { kind, text: m[0], end }
    }
  }
  return best ? { kind: best.kind, text: best.text } : undefined
}

const ASIDE = String.raw`(?:\s*,[^,;:]{1,200},|\s+(?:also|further|now|again|first|second|third|finally|primarily|principally|essentially|instead|then|here|nonetheless|nevertheless|correctly|incorrectly|rightly|wrongly|erroneously|mistakenly|persuasively|vigorously|strenuously|forcefully|repeatedly|simply|only|merely|below|in\s+(?:its|his|her|their)\s+(?:brief|briefs|reply|motion|petition|opinion|dissent|concurrence)|on\s+appeal|before\s+us|at\s+trial|at\s+oral\s+argument|in\s+response))*`
/** Verbs a party or a critic uses: whoever their subject is, other than the court, the words after them are that speaker's. */
const STRONG_VERB = 'argu(?:e|es|ed|ing)|contend(?:s|ed|ing)?|assert(?:s|ed|ing)?|claim(?:s|ed|ing)?|urg(?:e|es|ed|ing)|insist(?:s|ed|ing)?|submit(?:s|ted|ting)?|alleg(?:e|es|ed|ing)|aver(?:s|red|ring)?|counter(?:s|ed|ing)?|protest(?:s|ed|ing)?|complain(?:s|ed|ing)?|maintain(?:s|ed|ing)?|posit(?:s|ed|ing)?|theoriz(?:e|es|ed|ing)|speculat(?:e|es|ed|ing)|conced(?:e|es|ed|ing)|respond(?:s|ed|ing)?|repl(?:y|ies|ied|ying)|object(?:s|ed|ing)?|retort(?:s|ed|ing)?'
/** Verbs that only report: the words after them are another's when the speaker named before them is not the court. */
const WEAK_VERB = 'sa(?:y|ys|id|ying)|stat(?:e|es|ed|ing)|h(?:old|olds|eld|olding)|reason(?:s|ed|ing)?|conclud(?:e|es|ed|ing)|f(?:ind|inds|ound|inding)|rul(?:e|es|ed|ing)|not(?:e|es|ed|ing)|observ(?:e|es|ed|ing)|explain(?:s|ed|ing)?|determin(?:e|es|ed|ing)|opin(?:e|es|ed|ing)|believ(?:e|es|ed|ing)|th(?:ink|inks|ought|inking)|decid(?:e|es|ed|ing)|wr(?:ite|ites|ote|iting)|declar(?:e|es|ed|ing)|recogniz(?:e|es|ed|ing)|acknowledg(?:e|es|ed|ing)|emphasiz(?:e|es|ed|ing)|suggest(?:s|ed|ing)?|propos(?:e|es|ed|ing)|interpret(?:s|ed|ing)?|characteriz(?:e|es|ed|ing)|describ(?:e|es|ed|ing)|report(?:s|ed|ing)?|indicat(?:e|es|ed|ing)|recommend(?:s|ed|ing)?|announc(?:e|es|ed|ing)|recit(?:e|es|ed|ing)|point(?:s|ed|ing)?\s+out|t(?:ake|akes|ook|aking)\s+the\s+(?:view|position)'
const REPORTING_END = new RegExp(String.raw`(?<![\p{L}])(?:(${STRONG_VERB})|(${WEAK_VERB}))(?![\p{L}])${ASIDE}\s*(?:that\s*)?$`, 'iu')
const MODAL_END = new RegExp(String.raw`(?<![\p{L}])(?:might|could|would|may)\s+(?:well\s+|reasonably\s+|plausibly\s+|arguably\s+|also\s+|then\s+|even\s+)?(?:have\s+)?(?:be\s+(?:tempted|inclined)\s+to\s+)?(?:hold|held|conclude|concluded|say|said|find|found|argue|argued|think|thought|believe|believed|rule|ruled|decide|decided|reason|reasoned|suppose|infer|determine|determined|view|construe|construed|interpret|interpreted|read)(?![\p{L}])${ASIDE}\s*(?:that\s*)?$|(?<![\p{L}])(?:might|could|may|would)\s+(?:well\s+)?be\s+(?:argued|said|thought|suggested|contended|urged|claimed|maintained|asserted|objected|supposed)(?![\p{L}])\s*(?:that\s*)?$`, 'iu')
const PASSIVE_END = /(?<![\p{L}])(?:is|are|was|were|has\s+been|have\s+been|had\s+been)\s+(?:sometimes\s+|often\s+|also\s+|frequently\s+|commonly\s+|widely\s+|occasionally\s+)?(?:argued|contended|suggested|urged|claimed|asserted|maintained|said|posited|alleged|supposed)(?![\p{L}])(?:\s+by\s+[^,;:]{1,80}?)?\s*(?:that\s*)?$/iu
const REJECTED_END = /(?<![\p{L}])(?:mistake|mistaken|error|erroneous|wrong|incorrect|misguided|misreading|untenable|fallacy|fallacious|unwarranted|implausible|absurd|unfounded|unpersuasive)(?![\p{L}])[^.;:]{0,100}?(?<![\p{L}])(?:to|in)\s+(?:conclud(?:e|ing)|say(?:ing)?|suggest(?:ing)?|hold(?:ing)?|find(?:ing)?|think(?:ing)?|suppos(?:e|ing)|assum(?:e|ing)|believ(?:e|ing)|read(?:ing)?|infer(?:ring)?|treat(?:ing)?|argu(?:e|ing)|claim(?:ing)?|presum(?:e|ing)|view(?:ing)?|constru(?:e|ing))(?![\p{L}])[^.;:]{0,40}?\s*(?:that\s*)?$/iu
const ARGUMENT_END = /(?<![\p{L}])(?:argument|arguments|contention|contentions|assertion|assertions|suggestion|suggestions|allegation|allegations|insistence|submission|theory)(?:\s*,[^,;:]{1,160},)?\s+(?:is\s+|was\s+)?that\s*$/iu
/** The court adopting what it reports: its own voice agreeing ("and we agree"; "the Court" with its capital), or an adverb that endorses. */
const ADOPTED = { test: (s: string): boolean => /(?<![\p{L}])(?:[Ww]e|[Tt]his\s+[Cc]ourt|[Tt]he\s+Court)\s+(?:agree|agrees|accept|accepts|concur|concurs|adopt|adopts)(?![\p{L}])/u.test(s) || /(?<![\p{L}])(?:correctly|rightly|properly|persuasively|aptly)(?![\p{L}])/iu.test(s) }

/**
 * legal@0.5.2: what the part of a sentence before a quotation (`head`) says about the words after it: whose they are, or how the
 * opinion frames them (above); undefined when it says nothing of the kind, or the voice is the court's own.
 */
export function leadFrameOf(head: string, opts: { v053?: boolean; v054?: boolean } = {}): LeadFrame | undefined {
  if (opts.v054) return leadFrameOf053(head, true)
  if (opts.v053) return leadFrameOf053(head)
  const h = head.replace(/\s+/g, ' ').replace(/[\s"“'‘([]+$/u, '').trim()
  if (!/\p{L}/u.test(h)) return undefined
  const start = h.replace(/^[\s"“'‘([]+/u, '')
  if (/^(?:suppose|supposing|assume|assuming|imagine|hypothetically|let\s+us\s+(?:assume|suppose)|even\s+assuming)(?![\p{L}])/iu.test(start)) return { kind: 'hypothetical' }
  if (/^(?:were|had)\s+(?:we|it|the|this|that|they|he|she|there|a|an|i|congress|courts?|petitioners?|respondents?|appellants?|appellees?|plaintiffs?|defendants?)(?![\p{L}])/iu.test(start)) return { kind: 'counterfactual' }
  // the clause the quotation continues: what follows the last semicolon or colon
  const clause = (h.split(/[;:]/).pop() ?? h).trim()
  if (!/\p{L}/u.test(clause)) return undefined
  if (REJECTED_END.test(clause)) return { kind: 'rejected' }
  if (/(?<![\p{L}])whether$/iu.test(clause)) return { kind: 'question' }
  if (/(?<![\p{L}])(?:suppose|supposing|assume|assuming|imagine)(?:\s+that)?$/iu.test(clause)) return { kind: 'hypothetical' }
  if (MODAL_END.test(clause)) return { kind: 'counterfactual' }
  // the court adopting what it reports ("Petitioners suggest, and we agree, that", "Appellant correctly argues that") speaks for itself
  if (ADOPTED.test(clause)) return undefined
  const passive = PASSIVE_END.exec(clause)
  if (passive) {
    const by = speakerIn(passive[0])
    return by && by.kind !== 'own' ? { kind: by.kind, speaker: by.text } : by?.kind === 'own' ? undefined : { kind: 'other' }
  }
  if (ARGUMENT_END.test(clause)) return { kind: 'argument' }
  const v = REPORTING_END.exec(clause)
  if (!v) return undefined
  const sp = speakerIn(clause.slice(0, v.index))
  if (sp?.kind === 'own') return undefined
  if (v[1] !== undefined) return { kind: sp?.kind ?? 'other', ...(sp ? { speaker: sp.text } : {}) }
  // a trial court can write of itself as "the court" in small letters, in the present tense ("the court finds that"): that is its own
  // voice; in the past tense ("the court stated that") it reports a court below or a decision
  if (sp && /^the\s+court$/u.test(sp.text) && /^(?:says|states|holds|reasons|concludes|finds|rules|notes|observes|explains|determines|opines|believes|thinks|decides|writes|declares|recognizes|acknowledges|emphasizes|agrees|accepts|points\s+out)$/iu.test(v[2] ?? '')) return undefined
  return sp ? { kind: sp.kind, speaker: sp.text } : undefined
}

/** legal@0.5.2: how an answer says what a lead-in's frame does to the words after it, and the label its can't tell carries. */
export function leadFrameWords(f: LeadFrame): { label: string; why: string } {
  switch (f.kind) {
    case 'party': return { label: 'reported speech', why: 'the opinion reports a party\'s position' }
    case 'separate': return { label: 'reported speech', why: 'the opinion reports a separate opinion\'s view' }
    case 'court': return { label: 'reported speech', why: 'the opinion reports what another court or tribunal said' }
    case 'other': return { label: 'reported speech', why: 'the opinion reports someone else\'s position' }
    case 'argument': return { label: 'reported speech', why: 'the opinion names the words as an argument' }
    case 'counterfactual': return { label: 'counterfactual', why: 'the opinion states what might be, not what it holds' }
    case 'hypothetical': return { label: 'counterfactual', why: 'the opinion poses the words as a hypothetical' }
    case 'rejected': return { label: 'rejected reading', why: 'the opinion rejects what follows' }
    case 'question': return { label: 'question', why: 'the opinion poses the words as a question' }
    case 'source': return { label: 'reported speech', why: 'the opinion reports what another opinion or source said' }
  }
}

// ── legal@0.5.3: lead-ins read with their verbs' inflections and the words after them (2026-10-13) ─────────────────────────────
//
// legal@0.5.2 read a reporting verb only at the very end of the words before a quotation, with "that", and took "us" for the court's
// own voice. A cold review (an AI agent, not a person) passed seven of twelve party positions: "Bravo asks us to hold that", "Acme
// would have us", "According to Bravo,", "Bravo's position is that", "In Bravo's view,", "We are told that", "Under the rule Bravo
// proposes,"; and "Rotkiske urges us to" though "urges" is on the list. A later one passed another court's holding after "held (1) that
// …, and (2) that, in that circumstance," and Conley's retired standard after "relying on Conley's statement that". legal@0.5.3 reads:
//   - a sentence that opens on another's view: "In X's view,", "According to X,", "Under X's reading," or "Under the rule X proposes,"
//     (X not the court: "In our view," and "According to the statute," are the court's own);
//   - a request of the court: "X asks us to …", "urges us to", "invites the Court to", "would have us", "requests that we";
//   - the court told: "We are told that", "we are urged by X to";
//   - a position named by its noun and its holder: "Bravo's position is that", "the view that" (never "our view", "the better view");
//   - quoted or attributed matter: "relying on X's statement that", "the familiar statement that", "quoting X,", "X's finding that";
//   - a reporting verb that governs coordinated that-clauses: "held (1) that …, and (2) that, in that circumstance,".
// Everything legal@0.5.2 reads, it reads the same way.

const POSS_053 = String.raw`(?:(?:the\s+)?[\p{L}][\p{L}.\-]*(?:\s+[\p{L}][\p{L}.\-]*){0,5}(?:['’]s|s['’])|his|her|their|its|our|my)`
const OWN_053 = /^(?:our|my|this\s+court['’]s|the\s+Court['’]s|the\s+majority['’]s|we|us|this\s+court|the\s+Court|i)$/u
const ownOf = (s: string | undefined): boolean => s !== undefined && (OWN_053.test(s.trim()) || /^(?:our|my|this\s+court['’]?s?)$/iu.test(s.trim()))
const LAW_WORDS_053 = /^(?:the\s+)?(?:statute|act|text|rules?|regulations?|code|constitution|amendment|section|subsection|provision|clause|language|terms|law|record|plain\s+(?:meaning|language|text)|its\s+terms|precedent|our\s+(?:cases|precedents?|decisions)|this\s+court['’]s\s+(?:cases|precedents?|decisions)|the\s+(?:federal|state)\s+rules?)\b/iu
const VIEW_IN_053 = new RegExp(String.raw`^(?:in|on)\s+(${POSS_053})\s+(?:view|opinion|estimation|judgment|reading|telling|account|submission|words|theory|framing|understanding|interpretation|characterization)\s*,`, 'iu')
const ACCORDING_053 = /^according\s+to\s+([^,]{1,80}?)\s*,/iu
const UNDER_053 = new RegExp(String.raw`^under\s+(?:(?:the|a)\s+)?(?:(${POSS_053})\s+)?(?:proposed\s+)?(?:rule|reading|theory|view|interpretation|approach|construction|position|proposal|argument|logic|account|framework)(?:\s+(?:that\s+|which\s+)?([^,]{1,60}?)\s+(?:proposes|proposed|urges|urged|advances|advanced|offers|offered|suggests|suggested|presses|pressed|favors|favored|advocates|advocated|propounds|propounded|espouses|espoused|champions|championed|would\s+adopt|would\s+have\s+us\s+adopt))?\s*,`, 'iu')
const ASK_053 = /(?<![\p{L}])(?:asks?|asked|asking|urges?|urged|urging|invites?|invited|inviting|implores?|implored|exhorts?|exhorted|presses|pressed|pressing|calls\s+(?:on|upon)|called\s+(?:on|upon)|wants?|wanted|would\s+have|would\s+like|wishes|wished|requests?|requested|beseeches|encourages?|encouraged|entreats?|entreated|prays|prayed)\s+(?:(?:us|this\s+court|the\s+court|the\s+panel|this\s+panel)(?:\s+to)?|that\s+(?:we|this\s+court|the\s+court|the\s+panel))(?:\s+[\p{L}'’-]+){0,3}?\s*(?:that\s*)?$/iu
const PASSIVE_US_053 = /(?<![\p{L}])(?:we|this\s+court|the\s+court|the\s+panel)\s+(?:are|is|were|was|have\s+been|has\s+been|had\s+been)\s+(?:repeatedly\s+|also\s+|now\s+|again\s+|often\s+)?(?:told|urged|asked|invited|reminded|assured|warned|advised|pressed|implored|exhorted|encouraged)(?:\s+by\s+([^,;:]{1,80}?))?(?:\s+to(?:\s+[\p{L}'’-]+){0,3}?)?\s*(?:that\s*)?$/iu
const UTTERANCE_053 = '(?:statement|statements|observation|language|formulation|dictum|dicta|words|admonition|pronouncement|declaration|assertion|holding|conclusion|finding|ruling|teaching|explanation|suggestion|remark|comment|characterization|gloss)'
const ATTRIBUTION_053 = new RegExp(String.raw`(?<![\p{L}])(?:rel(?:y|ies|ied|ying)\s+(?:on|upon)|citing|cited|quoting|quoted|following|followed|applying|applied|invoking|invoked|adopting|adopted|echoing|echoed|paraphrasing|in\s+light\s+of|based\s+on)\s+(?:(${POSS_053})\s+|the\s+|an?\s+)?(?:(?:familiar|famous|oft-?quoted|often-?quoted|well-?known|earlier|later|now-?familiar|venerable|classic)\s+)*${UTTERANCE_053}(?:\s+in\s+([^,;:]{1,60}?))?\s*,?\s*that\s*$`, 'iu')
const POSS_UTTERANCE_053 = new RegExp(String.raw`(?<![\p{L}])(${POSS_053})\s+(?:(?:familiar|famous|oft-?quoted|well-?known|earlier|later)\s+)*${UTTERANCE_053}\s+that\s*$`, 'iu')
const QUOTING_053 = /(?<![\p{L}])(?:quoting|citing)\s+([A-Z][^,;:]{0,80}?)\s*,?\s*$/u
const ARGUMENT_END_053 = /(?<![\p{L}])((?:[\p{L}'’.\-]+\s+){0,4}?)(?:argument|arguments|contention|contentions|assertion|assertions|suggestion|suggestions|allegation|allegations|insistence|submission|theory|position|view|premise|proposal|objection|reply|thesis)(?:\s*,[^,;:]{1,160},)?\s+(?:is\s+|was\s+|has\s+been\s+)?that\s*$/iu
const REPORTING_END_053 = new RegExp(String.raw`(?<![\p{L}])(?:(${STRONG_VERB})|(${WEAK_VERB}))(?![\p{L}])${ASIDE}\s*(?:\(\w{1,3}\)\s*)?(?:that\s*)?$`, 'iu')
const FIRST_THAT_053 = new RegExp(String.raw`(?<![\p{L}])(?:${STRONG_VERB}|${WEAK_VERB})(?![\p{L}])${ASIDE}\s*(?:\(\w{1,3}\)\s*)?that(?![\p{L}])`, 'iu')
/** The court's own voice entering again after an opener ("In Bravo's view, X, but we hold that"). */
const OWN_VOICE_053 = /(?<![\p{L}])(?:we|this\s+court|the\s+Court)\s+(?:hold|holds|conclude|concludes|find|finds|agree|agrees|disagree|disagrees|reject|rejects|think|believe|decline|declines|read|reads|are|have|has|do|does|must|cannot|will|now)(?![\p{L}])/u
/**
 * legal@0.5.4 (2026-10-14): a party's filing as the subject of a reporting verb ("Tamberly's brief states that", "the reply brief argues
 * that", "Appellee's motion contends that") is a party's position. legal@0.5.3 read "states" as a verb that only reports and found no
 * speaker it knew, so the words after "Tamberly's brief states that" passed as the court's (a cold review; an AI agent, not a person).
 */
const FILING_SUBJECT_054 = /(?<![\p{L}])(?:(?:the|its|his|her|their|a)\s+|[\p{L}][\p{L}'’.\-]*['’]s\s+)?(?:(?:opening|reply|answering|principal|supplemental|amicus|appellate|post-?trial|pre-?trial)\s+)?(?:briefs?|motion|petition|memorandum|memoranda|complaint|answer|pleadings?|submission|papers|filing|reply|opposition|response|appeal)\s*$/iu
/** legal@0.5.4: a sentence that judges a rule or standard another has stated is the court's own voice too ("That rule no longer holds."). */
const JUDGES_RULE_054 = /^(?:that|this|the|such\s+an?|his|her|their|its)\s+(?:rule|standard|test|formulation|requirement|proposition|principle|holding|gloss|dictum|argument|reading|view|contention|position|theory|interpretation|claim|suggestion|premise|approach|submission)\s+(?:no\s+longer|is\s+no\s+longer|is\s+not|was\s+not|does\s+not|did\s+not|cannot|could\s+not|has\s+not|had\s+not|will\s+not|would\s+not|fails?|failed|misses|misreads|overlooks|ignores|lacks|founders|proves|rests|runs|misapprehends|misunderstands|has|does|is|was)(?![\p{L}])/iu

/** The kind a speaker's words give a frame: a party, a separate opinion, another court, or someone else ('other'); undefined for the court's own. */
export function speakerFrame053(words: string | undefined, fallback: LeadFrameKind = 'other'): LeadFrame | undefined {
  if (words === undefined || words.trim() === '') return { kind: fallback }
  if (ownOf(words)) return undefined
  const sp = speakerIn(words)
  if (sp?.kind === 'own') return undefined
  return { kind: sp?.kind ?? fallback, speaker: sp?.text ?? words.trim() }
}

// ── legal@0.5.3: a sentence that introduces another's view, and the court speaking again (2026-10-13) ───────────────────────────
//
// legal@0.5.2 read a lead-in inside the quotation's own sentence only, so "In his view, the general discovery rule should apply. A statute
// of limitations under the FDCPA begins to run when the plaintiff discovers the violation. We disagree." passed the middle sentence as
// "verbatim" (a cold review; an AI agent, not a person). legal@0.5.3 reads the sentences before a quotation, in its paragraph: one that
// introduces another's view makes the sentences after it that view's, until a sentence in the court's own voice. A view is introduced
// by an opener at the start of the sentence ("In his view,", "According to Bravo,", "Under the rule Bravo proposes,"), by a party or a
// critic's verb or noun with what follows ("Bravo argues that", "Bravo's position is that", "Bravo asks us to"), or by a sentence that
// announces a party's arguments ("Bravo makes two arguments."). A report of a holding ("The district court held that …") is not a view:
// the court's narrative usually goes on after it. The court speaks again in a sentence that opens on "we", "our", "this Court" or "the
// Court", one that judges the view ("That reading is foreclosed", "It is mistaken", "Not so"), or one whose first clause says "we hold",
// "we disagree" and the like.

const VIEW_KINDS_053 = new Set<LeadFrameKind>(['party', 'separate', 'other', 'argument'])
const VIEW_VERB_END_053 = new RegExp(String.raw`(?<![\p{L}])(?:${STRONG_VERB})(?![\p{L}])${ASIDE}\s*(?:that\s*)?$`, 'iu')
const ASK_START_053 = /^(.{1,80}?)\s+(?:asks?|asked|urges?|urged|invites?|invited|implores?|implored|exhorts?|exhorted|presses|pressed|would\s+have|wants?|wanted|requests?|requested|calls\s+(?:on|upon))\s+(?:us|this\s+court|the\s+court|the\s+panel|this\s+panel)(?![\p{L}])/iu
const ANNOUNCES_053 = /^(.{1,80}?)\s+(?:makes|made|raises|raised|advances|advanced|presses|pressed|offers|offered|presents|presented|puts\s+forward|put\s+forward|has|had|asserts|asserted)\s+(?:(?:two|three|four|five|several|a\s+few|a\s+number\s+of|many|various|other|additional|further|related|principal|main|primary|alternative|separate|distinct)\s+)+(?:arguments?|contentions?|points?|objections?|claims|theories|grounds|reasons)(?![\p{L}])[^.;]*[.:]?$/iu

/** legal@0.5.3: the frame a sentence opens for the sentences after it (another's view), or undefined. legal@0.5.4 (`v054`) reads a party's filing as a speaker (FILING_SUBJECT_054). */
export function viewOpener053(sentence: string, v054 = false): LeadFrame | undefined {
  const t = sentence.replace(/\s+/g, ' ').replace(/^[\s"“'‘([¦]+/u, '').replace(/^(?:\*{1,4}\d{1,5}|\[\*{0,4}\d{1,5}\]|\[\d{1,3}\])\s*/u, '').trim()
  const opener = /^(?:in|on|according|under)(?![\p{L}])[^,]{0,120},/iu.exec(t)?.[0]
  if (opener !== undefined) {
    const f = leadFrameOf053(opener, v054)
    if (f && VIEW_KINDS_053.has(f.kind)) return f
  }
  const a = ANNOUNCES_053.exec(t)
  if (a) {
    const f = speakerFrame053(a[1], 'argument')
    if (f && VIEW_KINDS_053.has(f.kind)) return f
  }
  // a request of the court at the sentence's start ("Rotkiske urges us to read …", "Acme would have us …")
  const ask = ASK_START_053.exec(t)
  if (ask) {
    const f = speakerFrame053(ask[1])
    if (f && VIEW_KINDS_053.has(f.kind)) return f
  }
  // a party's or a critic's verb, a position named by its noun, or the court told, with "that" or a colon after it (a comma is not
  // enough: "fair notice of the claim," is a noun, not the verb)
  for (const m of t.slice(0, 300).matchAll(/(?<![\p{L}])that(?![\p{L}])|:/gu)) {
    const prefix = t.slice(0, (m.index ?? 0) + m[0].length)
    const clause = (prefix.split(/[;]/).pop() ?? prefix).replace(/:\s*$/u, '').trim()
    // legal@0.5.4: a party's filing with a verb that only reports ("Tamberly's brief states that") opens its view too
    if (!(VIEW_VERB_END_053.test(clause) || ARGUMENT_END_053.test(clause) || PASSIVE_US_053.test(clause) || (v054 && REPORTING_END_053.test(clause) && FILING_SUBJECT_054.test(clause.replace(REPORTING_END_053, ''))))) continue
    const f = leadFrameOf053(prefix.replace(/:\s*$/u, ''), v054)
    if (f && VIEW_KINDS_053.has(f.kind)) return f
  }
  return undefined
}

/** legal@0.5.3: a sentence in the court's own voice (above). legal@0.5.4 (`v054`) also reads one that judges a stated rule or standard (JUDGES_RULE_054). */
export function courtVoice053(sentence: string, v054 = false): boolean {
  const t = sentence.replace(/\s+/g, ' ').replace(/^[\s"“'‘([¦]+/u, '').replace(/^(?:\*{1,4}\d{1,5}|\[\*{0,4}\d{1,5}\]|\[\d{1,3}\])\s*/u, '').trim()
  const lead = String.raw`^(?:(?:but|however|nonetheless|nevertheless|still|yet|and|so|thus|accordingly|instead|rather|indeed|here|today|again|first|second|third|finally)\s*,?\s+)?`
  if (new RegExp(String.raw`${lead}(?:we|our|us|this\s+court|this\s+panel)(?![\p{L}])`, 'iu').test(t)) return true
  if (new RegExp(String.raw`${lead}the\s+Court(?!\s+of)(?![\p{L}])`, 'u').test(t)) return true
  // legal@0.5.4: "The Court disagrees." opens on a capital at the sentence's start (a district court writing of itself); legal@0.5.3 read
  // only "the Court" in small letters, so a cold review's genuine quotation after it was held as the party's view the paragraph opened on
  if (v054 && new RegExp(String.raw`${lead}The\s+Court(?!\s+of)(?![\p{L}])`, 'u').test(t)) return true
  if (v054 && JUDGES_RULE_054.test(t)) return true
  if (/^(?:that|this|the|such\s+an?|his|her|their|its)\s+(?:argument|reading|view|contention|position|theory|interpretation|claim|suggestion|premise|approach|submission)\s+(?:is|was|fails|failed|cannot|ignores|misreads|overlooks|lacks|founders|proves|has|does|runs|rests|misapprehends|misunderstands)(?![\p{L}])/iu.test(t)) return true
  if (/^(?:it\s+is\s+(?:true|so|correct|clear|plain|settled|undisputed|well\s+(?:settled|established))\s+that|to\s+be\s+sure|of\s+course|certainly|admittedly)(?![\p{L}])/iu.test(t)) return true
  if (/^(?:not\s+so|no\.|that\s+(?:is|was)\s+(?:wrong|incorrect|mistaken|error)|it\s+(?:is|was)\s+(?:mistaken|wrong|incorrect|not\s+so|unpersuasive|foreclosed|untenable)|that\s+was\s+error|neither\s+persuades|none\s+(?:of\s+(?:these|them)\s+)?persuades?)(?![\p{L}])/iu.test(t)) return true
  return /^[^,;:]{0,80}?(?<![\p{L}])we\s+(?:hold|conclude|disagree|agree|reject|decline|think|believe|find|affirm|reverse|vacate|remand)(?![\p{L}])/iu.test(t)
}

/** legal@0.5.3: what the words before a quotation say about it (above); legal@0.5.2's reading, widened. legal@0.5.4 (`v054`): a party's filing as the subject of a reporting verb is a party (FILING_SUBJECT_054). */
export function leadFrameOf053(head: string, v054 = false): LeadFrame | undefined {
  const h = head.replace(/\s+/g, ' ').replace(/[\s"“'‘([]+$/u, '').trim()
  if (!/\p{L}/u.test(h)) return undefined
  const start = h.replace(/^[\s"“'‘([]+/u, '')
  if (/^(?:suppose|supposing|assume|assuming|imagine|hypothetically|let\s+us\s+(?:assume|suppose)|even\s+assuming)(?![\p{L}])/iu.test(start)) return { kind: 'hypothetical' }
  if (/^(?:were|had)\s+(?:we|it|the|this|that|they|he|she|there|a|an|i|congress|courts?|petitioners?|respondents?|appellants?|appellees?|plaintiffs?|defendants?)(?![\p{L}])/iu.test(start)) return { kind: 'counterfactual' }
  // a sentence that opens on another's view: everything after the opener is that view, unless the court speaks for itself after it
  const opener = (() => {
    const v = VIEW_IN_053.exec(start)
    if (v) return { at: v[0].length, frame: speakerFrame053(v[1]) }
    const a = ACCORDING_053.exec(start)
    if (a) return { at: a[0].length, frame: LAW_WORDS_053.test((a[1] as string).trim()) ? undefined : speakerFrame053(a[1]) }
    const u = UNDER_053.exec(start)
    if (u && (u[1] !== undefined || u[2] !== undefined)) return { at: u[0].length, frame: u[1] !== undefined ? speakerFrame053(u[1]) : speakerFrame053(u[2]) }
    return undefined
  })()
  if (opener) {
    if (opener.frame === undefined || OWN_VOICE_053.test(start.slice(opener.at))) return undefined
    return opener.frame
  }
  // the clause the quotation continues: what follows the last semicolon or colon; a set-off phrase after its "that" read off, and a
  // coordinated that-clause read back to the verb that governs the first ("held (1) that …, and (2) that, in that circumstance,")
  let clause = (h.split(/[;:]/).pop() ?? h).trim()
  if (!/\p{L}/u.test(clause)) return undefined
  clause = clause.replace(/(?<![\p{L}])that\s*,[^,;:]{1,120},?\s*$/u, 'that')
  if (/(?:,?\s*(?:and|or)\s+|,\s*)(?:\(\w{1,3}\)\s*)?that$/iu.test(clause)) {
    const m = FIRST_THAT_053.exec(clause)
    if (m) clause = clause.slice(0, m.index + m[0].length)
  }
  if (REJECTED_END.test(clause)) return { kind: 'rejected' }
  if (/(?<![\p{L}])whether$/iu.test(clause)) return { kind: 'question' }
  if (/(?<![\p{L}])(?:suppose|supposing|assume|assuming|imagine)(?:\s+that)?$/iu.test(clause)) return { kind: 'hypothetical' }
  if (MODAL_END.test(clause)) return { kind: 'counterfactual' }
  if (ADOPTED.test(clause)) return undefined
  const told = PASSIVE_US_053.exec(clause)
  if (told) return speakerFrame053(told[1])
  const ask = ASK_053.exec(clause)
  if (ask) return speakerFrame053(clause.slice(0, ask.index))
  const attr = ATTRIBUTION_053.exec(clause)
  if (attr) {
    const who = attr[1] ?? attr[2]
    if (who !== undefined && ownOf(who.replace(/['’]s?$/u, ''))) return undefined
    const sp = who !== undefined ? speakerIn(who) : undefined
    if (sp?.kind === 'own') return undefined
    return { kind: sp?.kind === 'court' ? 'court' : 'source', ...(who !== undefined ? { speaker: who.trim() } : {}) }
  }
  const poss = POSS_UTTERANCE_053.exec(clause)
  if (poss) {
    const who = poss[1] as string
    if (ownOf(who.replace(/['’]s?$/u, '')) || ownOf(who)) return undefined
    const sp = speakerIn(who)
    if (sp?.kind === 'own') return undefined
    return { kind: sp?.kind === 'court' ? 'court' : sp?.kind === 'party' || sp?.kind === 'separate' ? sp.kind : 'source', speaker: who.trim() }
  }
  const quoting = QUOTING_053.exec(clause)
  if (quoting) return { kind: 'source', speaker: (quoting[1] as string).trim() }
  const passive = PASSIVE_END.exec(clause)
  if (passive) {
    const by = speakerIn(passive[0])
    return by && by.kind !== 'own' ? { kind: by.kind, speaker: by.text } : by?.kind === 'own' ? undefined : { kind: 'other' }
  }
  const arg = ARGUMENT_END_053.exec(clause)
  if (arg) {
    const before = `${clause.slice(0, arg.index)} ${arg[1] ?? ''}`
    if (/(?<![\p{L}])(?:our|my|this\s+court['’]s|the\s+Court['’]s)\s+(?:[\p{L}'’.\-]+\s+){0,3}$/u.test(`${arg[1] ?? ''}`) || /(?<![\p{L}])(?:our|my)(?![\p{L}])/iu.test(arg[1] ?? '')) return undefined
    if (/(?<![\p{L}])(?:better|best|correct|proper|sounder|right|true)(?![\p{L}])/iu.test(arg[1] ?? '')) return undefined
    const sp = speakerIn(before)
    if (sp?.kind === 'own' && /(?<![\p{L}])(?:our|my|this\s+court['’]s|the\s+Court['’]s)/u.test(arg[1] ?? '')) return undefined
    return sp && sp.kind !== 'own' ? { kind: sp.kind, speaker: sp.text } : { kind: 'argument' }
  }
  const v = REPORTING_END_053.exec(clause)
  if (!v) return undefined
  const sp = speakerIn(clause.slice(0, v.index))
  if (sp?.kind === 'own') return undefined
  // legal@0.5.4: a party's filing is the speaker ("Tamberly's brief states that", "the reply brief argues that")
  const filing = v054 && (sp === undefined || sp.kind === 'party') ? FILING_SUBJECT_054.exec(clause.slice(0, v.index)) : null
  if (filing) return { kind: 'party', speaker: filing[0].trim() }
  if (v[1] !== undefined) return { kind: sp?.kind ?? 'other', ...(sp ? { speaker: sp.text } : {}) }
  if (sp && /^the\s+court$/u.test(sp.text) && /^(?:says|states|holds|reasons|concludes|finds|rules|notes|observes|explains|determines|opines|believes|thinks|decides|writes|declares|recognizes|acknowledges|emphasizes|agrees|accepts|points\s+out)$/iu.test(v[2] ?? '')) return undefined
  return sp ? { kind: sp.kind, speaker: sp.text } : undefined
}

/**
 * legal@0.4.0: a named passage is whole sentences. The sentence holding the first word the quotation aligns with, through the
 * sentence holding the last (sentenceHeadBefore / sentenceTailAfter, read on the text with its page marks blanked, at most 600
 * characters either way). Its span in the supplied text, with leading and trailing space trimmed.
 */
export function sentenceSpanOf(text: string, core: Span, numbers: SentenceReading = false): Span {
  let start = core.start - sentenceHeadBefore(text, core.start, 600, numbers).length
  let end = core.end + sentenceTailAfter(text, core.end, 600, numbers).length
  while (start < end && /\s/.test(text[start] as string)) start++
  while (end > start && /\s/.test(text[end - 1] as string)) end--
  return { start, end }
}

/**
 * One place a quotation's words differ from a passage's: the passage's words there, and the quotation's (either may be empty).
 * legal@0.5.1's printed reading also gives the number of words of a side shown clipped (more than twelve).
 */
export interface WordDifference { text: string; quote: string; textWords?: number; quoteWords?: number }

/**
 * legal@0.4.0: where a FAIL's quotation differs from the passage, word by word (a longest common subsequence of their words, case
 * and punctuation at the edges of a word aside). Passage words before the first and after the last word they share are context,
 * not differences; quotation words there are compared with as many passage words just outside the shared stretch. At most `cap`.
 */
export function wordDifferences(passage: string, quote: string, cap = 4, printed = false, ellipses = false, ligatures = false): WordDifference[] {
  // legal@0.5.5 (`ligatures`): a ligature is compared as its letters, so "ﬁnd" and "find" are never named as differing
  const fold = (w: string): string => (ligatures ? foldLigatures055(w) : w)
  // legal@0.5.1 (`printed`): the words as the text prints them, punctuation kept, and a run of more than twelve words shown by its
  // first six and last four with the count ("64 words: "is inapplicable to legal conclusions. Threadbare … a notable""), never a
  // punctuation-stripped dump
  // legal@0.5.2 (`ellipses`): an ellipsis in the quotation stands for the passage's words where it falls, so those words are never
  // listed as left out ("The focus . . . must be on" against "The focus, of course, must be solely on" names "solely" only)
  const ELL = '\u0000…'
  const q0 = ellipses ? quote.replace(/…|\.(?:[ \u00A0]?\.){2,}/g, ` ${ELL} `) : quote
  const toks = (s: string): { shown: string; key: string }[] => (s.match(/\S+/g) ?? [])
    .map(w => (w === ELL ? { shown: '…', key: ELL } : { shown: printed ? w.replace(/["“”„‟«»″]/g, '').replace(/^['‘’]+|['‘’]+$/g, '') : w.replace(/^[^\p{L}\p{N}§$]+|[^\p{L}\p{N}%]+$/gu, ''), key: fold(w).toLowerCase().replace(/[’]/g, "'").replace(/^[^\p{L}\p{N}§$]+|[^\p{L}\p{N}%]+$/gu, '') }))
    .filter(t => t.key.length > 0)
  const p = toks(passage), q = toks(q0)
  if (p.length === 0 || q.length === 0 || p.length * q.length > 250_000) return []
  const n = q.length, m = p.length
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    (L[i] as Uint16Array)[j] = q[i]!.key === p[j]!.key ? (L[i + 1] as Uint16Array)[j + 1]! + 1 : Math.max((L[i + 1] as Uint16Array)[j]!, (L[i] as Uint16Array)[j + 1]!)
  }
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m;) {
    if (q[i]!.key === p[j]!.key) { pairs.push([i, j]); i++; j++ } else if ((L[i + 1] as Uint16Array)[j]! >= (L[i] as Uint16Array)[j + 1]!) i++; else j++
  }
  const out: WordDifference[] = []
  const words = (xs: { shown: string }[]): string => !printed || xs.length <= 12 ? xs.map(x => x.shown).join(' ')
    : `${xs.slice(0, 6).map(x => x.shown).join(' ')} … ${xs.slice(-4).map(x => x.shown).join(' ')}`
  const diff = (ps: { shown: string }[], qs: { shown: string }[]): WordDifference => ({
    text: words(ps), quote: words(qs), ...(printed && ps.length > 12 ? { textWords: ps.length } : {}), ...(printed && qs.length > 12 ? { quoteWords: qs.length } : {}),
  })
  if (ellipses) return ellipsisDifferences(p, q, ELL, diff).slice(0, cap)
  if (pairs.length === 0) return [diff(p, q)].slice(0, cap)
  const [qi0, pj0] = pairs[0]!
  if (qi0 > 0) out.push(diff(p.slice(Math.max(0, pj0 - qi0), pj0), q.slice(0, qi0)))
  for (let k = 1; k < pairs.length; k++) {
    const [qa, pa] = pairs[k - 1]!, [qb, pb] = pairs[k]!
    if (qb - qa > 1 || pb - pa > 1) out.push(diff(p.slice(pa + 1, pb), q.slice(qa + 1, qb)))
  }
  const [qi1, pj1] = pairs[pairs.length - 1]!
  if (qi1 < n - 1) out.push(diff(p.slice(pj1 + 1, Math.min(m, pj1 + 1 + (n - 1 - qi1))), q.slice(qi1 + 1)))
  return out.slice(0, cap)
}

/**
 * legal@0.5.2: the differences between a passage and a quotation whose ellipses (`ell` tokens) may each stand for any run of the passage's
 * words. The alignment leaves out the fewest words on either side, an ellipsis's run costing nothing; passage words before its first and
 * after its last matched word are context, as in wordDifferences. "… testimony . . . and the Rules themselves" against "… testimony. That
 * austere standard, …, does not mean, however, that the Rules themselves" names "that" for "and", never the words the ellipsis covers.
 */
function ellipsisDifferences<T extends { key: string }>(p: T[], q: T[], ell: string, diff: (ps: T[], qs: T[]) => WordDifference): WordDifference[] {
  const n = q.length, m = p.length, INF = 1 << 29
  const C: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = C[i] as Int32Array, next = C[i + 1] as Int32Array
    const isEll = q[i]!.key === ell
    for (let j = m; j >= 0; j--) {
      if (isEll) { row[j] = Math.min(next[j]!, j < m ? row[j + 1]! : INF); continue }
      let best = 1 + next[j]!
      if (j < m) {
        best = Math.min(best, 1 + row[j + 1]!)
        if (q[i]!.key === p[j]!.key) best = Math.min(best, next[j + 1]!)
      }
      row[j] = best
    }
  }
  // the passage words before the alignment are context: it starts where it costs least, earliest on a tie
  let j = 0
  for (let k = 1; k <= m; k++) if (C[0]![k]! < C[0]![j]!) j = k
  const start = j
  type Op = { t: 'm'; j: number } | { t: 'e' } | { t: 'q'; i: number } | { t: 'p'; j: number }
  const ops: Op[] = []
  for (let i = 0; i < n;) {
    if (q[i]!.key === ell) {
      while (j < m && C[i]![j] !== C[i + 1]![j]) j++
      ops.push({ t: 'e' }); i++; continue
    }
    const here = C[i]![j]!
    if (j < m && q[i]!.key === p[j]!.key && here === C[i + 1]![j + 1]) { ops.push({ t: 'm', j }); i++; j++; continue }
    if (j < m && here === 1 + C[i]![j + 1]!) { ops.push({ t: 'p', j }); j++; continue }
    ops.push({ t: 'q', i }); i++
  }
  const words = q.filter(x => x.key !== ell)
  const firstM = ops.findIndex(o => o.t === 'm')
  if (firstM < 0) return words.length > 0 || p.length > 0 ? [diff(p, words)] : []
  let lastM = -1
  ops.forEach((o, k) => { if (o.t === 'm') lastM = k })
  const out: WordDifference[] = []
  const run = (from: number, to: number, edge: 'lead' | 'trail' | 'inner'): void => {
    const qs = ops.slice(from, to).flatMap(o => (o.t === 'q' ? [q[o.i]!] : []))
    let ps = ops.slice(from, to).flatMap(o => (o.t === 'p' ? [p[o.j]!] : []))
    // at an edge, the quotation's own words are compared with as many passage words just outside the matched stretch
    if (edge === 'lead' && qs.length > 0 && ps.length === 0) { const at = (ops[firstM] as { j: number }).j; ps = p.slice(Math.max(start, at - qs.length), at) }
    if (edge === 'trail' && qs.length > 0 && ps.length === 0) { const at = (ops[lastM] as { j: number }).j + 1; ps = p.slice(at, Math.min(m, at + qs.length)) }
    if (qs.length > 0 || ps.length > 0) out.push(diff(ps, qs))
  }
  run(0, firstM, 'lead')
  for (let k = firstM + 1; k <= lastM; k++) {
    if (ops[k]!.t === 'm') continue
    let e = k
    while (e <= lastM && ops[e]!.t !== 'm') e++
    run(k, e, 'inner')
    k = e
  }
  run(lastM + 1, ops.length, 'trail')
  return out
}

const PUNCT_NAME: Record<string, string> = {
  ',': 'a comma', '.': 'a period', ';': 'a semicolon', ':': 'a colon', '?': 'a question mark', '!': 'an exclamation mark',
  '-': 'a dash', '—': 'a dash', '–': 'a dash', '(': 'an opening parenthesis', ')': 'a closing parenthesis', '[': 'a bracket', ']': 'a bracket',
}

/**
 * legal@0.5.1: where a FAIL's quotation has the passage's words but not its punctuation (legal@0.5.0 said only "the same words,
 * written differently"): each word whose punctuation differs, named ("the text has a comma after "action" that the quotation leaves
 * out"). Quotation marks and apostrophe style are not compared, as everywhere. At most `cap`.
 */
export function punctuationDifferences(passage: string, quote: string, cap = 4, ligatures = false): string[] {
  const strip = (s: string): string => s.replace(/["“”„‟«»″'‘’‚‛‹›`´′]/g, '')
  const toks = (s: string): { raw: string; key: string; lead: string; trail: string }[] => (s.match(/\S+/g) ?? []).map(w0 => {
    const w = (ligatures ? foldLigatures055(strip(w0)) : strip(w0)).replace(/-{2,3}|[—–―]/g, '—')
    const key = w.toLowerCase().replace(/^[^\p{L}\p{N}§$]+|[^\p{L}\p{N}%]+$/gu, '')
    return { raw: w0, key, lead: (/^[^\p{L}\p{N}§$]+/u.exec(w)?.[0] ?? ''), trail: (/[^\p{L}\p{N}%]+$/u.exec(w)?.[0] ?? '') }
  }).filter(t => t.key.length > 0)
  const p = toks(passage), q = toks(quote)
  const out: string[] = []
  let j = 0
  for (const [qi, t] of q.entries()) {
    while (j < p.length && p[j]!.key !== t.key) j++
    if (j >= p.length) break
    const o = p[j]!
    j++
    const word = t.key
    for (const [a, b, after] of [[o.trail, t.trail, true], [o.lead, t.lead, false]] as const) {
      if (a === b) continue
      // the quotation's own edges are conventions, never compared: what ends its last word, what opens its first
      if ((after && qi === q.length - 1) || (!after && qi === 0)) continue
      const where = after ? 'after' : 'before'
      if (a.length === 1 && b === '' && PUNCT_NAME[a]) out.push(`the text has ${PUNCT_NAME[a]} ${where} "${word}" that the quotation leaves out`)
      else if (b.length === 1 && a === '' && PUNCT_NAME[b]) out.push(`the quotation has ${PUNCT_NAME[b]} ${where} "${word}" that the text does not`)
      else out.push(`the text has "${strip(o.raw)}" where the quotation has "${strip(t.raw)}"`)
      break
    }
    if (out.length >= cap) break
  }
  return out
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const shown = (s: string): string => {
  const t = squash(s)
  return t.length <= 200 ? t : `${t.slice(0, 96)} … ${t.slice(-96)}`
}

/** True when `s` carries a quotation mark (an apostrophe inside a word is not one). */
function hasQuotationMarks(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (DOUBLE_MARKS.has(c)) return true
    if (SINGLE_MARKS.has(c) && !(isAlnum(s[i - 1]) && isAlnum(s[i + 1]))) return true
  }
  return false
}

/** The original text of a normalised range (empty for an empty range). */
function originalOf(p: LegalPreparedSource, from: number, to: number): string {
  if (to <= from) return ''
  const span = toOriginalSpan(p.norm, from, to)
  return p.raw.slice(span.start, span.end)
}

export function readQuotation(prepared: LegalPreparedSource, quote: string, L: QuotationLimits = QUOTATION_LIMITS): QuotationReading {
  const { tokens, parentheticals } = tokenize(quote)
  // legal@0.4.0 reads the quotation with the same page-mark reading as the text (a quotation copied with "*248" in it reads alike)
  const opts = prepared.opts ?? {}
  const literal = planOf(tokens, 'literal', L, opts)
  const plans = [literal]
  if (tokens.some(t => t.t === 'bracket')) plans.push(planOf(tokens, 'substitute', L, opts))
  const text = prepared.norm.text
  for (const plan of plans) {
    if (!plan.usable) continue
    const at = place(text, plan)
    if (at) return matched(prepared, quote, plan, at, parentheticals)
  }
  return nearest(prepared, literal, L)
}

/**
 * Engine 0.6.0 (cold-review round 2, 2026-10-05): legal@0.0.1's answer when its verbatim match fails. 0.0.1 used to name the passage
 * around any 3 consecutive quoted words, so an invented quotation was answered with an unrelated sentence and "conform the
 * quotation to it" (a cold reader's (an AI agent's) probe). Under engine 0.6.0 it names a passage by 0.1.0's rule instead: a whole-word anchor of 4 or
 * more words and a similarity of 0.5 or more, read without the quotation conventions (0.0.1 does not read them). Engines
 * before 0.6.0 never call this.
 */
export function nearestPassage(prepared: LegalPreparedSource, quote: string, L: QuotationLimits = QUOTATION_LIMITS): Extract<QuotationReading, { kind: 'passage' | 'none' }> {
  return nearest(prepared, planOf(tokenize(quote).tokens, 'literal', L), L) as Extract<QuotationReading, { kind: 'passage' | 'none' }>
}

function matched(p: LegalPreparedSource, quote: string, plan: Plan, at: Placement, parentheticals: string[]): QuotationReading {
  // Trailing punctuation the opinion also carries right after the match is compared after all, and shown.
  const trailingMatches = plan.trailing !== '' && plan.trail === undefined && p.norm.text.startsWith(plan.trailing, at.to)
  const span = toOriginalSpan(p.norm, at.from, at.to + (trailingMatches ? plan.trailing.length : 0))
  // The opinion's own brackets at either edge of the match are shown whole ("[The] first", "complaint[.]").
  const inner = p.raw.slice(span.start, span.end)
  if (p.raw[span.start - 1] === '[' && inner.indexOf(']') >= 0 && (inner.indexOf('[') < 0 || inner.indexOf(']') < inner.indexOf('['))) span.start--
  if (p.raw[span.end] === ']' && inner.lastIndexOf('[') > inner.lastIndexOf(']')) span.end++
  const passage = p.raw.slice(span.start, span.end)
  const notes: string[] = []
  let selective: { via: 'ellipsis' | 'bracket'; detail: string } | undefined
  const alterations: Alteration[] = []
  const omissions: string[] = []
  const omissionSpans: Span[] = []
  const lastWord = (t: string | undefined): string => (t?.match(/[\p{L}\p{N}']+$/u)?.[0] ?? '')
  const firstWord = (t: string | undefined): string => (t?.match(/^[\p{L}\p{N}']+/u)?.[0] ?? '')
  const check = (g: Gap, stands: string | undefined, before?: Piece, after?: Piece, where?: Span, edgeWord?: string): void => {
    if (g.ellipsis && stands !== undefined) { omissions.push(stands); omissionSpans.push(where ?? { start: -1, end: -1 }) }
    if (g.brackets.length) {
      const content = g.brackets.map(b => b.content).join(' ')
      const left = g.attachedLeft ? lastWord(before?.text) : ''
      const right = g.attachedRight ? firstWord(after?.text) : ''
      const inWord = g.inWord && stands !== undefined
      const prev = lastWord(before?.text)
      alterations.push({
        raw: g.brackets.map(b => b.raw).join(''), content,
        ...(stands !== undefined && !g.ellipsis ? { stands } : {}), inOmission: g.ellipsis,
        ...(inWord ? { quoteWord: `${left}${normalizeLegalText(content).text}${right}`, opinionWord: `${left}${normalizeLegalText(stands as string).text}${right}` } : {}),
        ...(prev !== '' ? { prevWord: prev } : {}),
        ...(stands === undefined && edgeWord !== undefined ? { edgeWord } : {}),
      })
    }
    if (g.ellipsis) {
      notes.push(stands === undefined ? 'an ellipsis at the edge of the quotation (not located)' : stands.trim() === '' ? 'an ellipsis stands for nothing in the opinion' : `an ellipsis stands for "${shown(stands)}"`)
      if (!selective && stands !== undefined && NEGATION.test(stands)) selective = { via: 'ellipsis', detail: `the text the quotation's ellipsis omits ("${shown(stands)}") carries a negation` }
    }
    for (const b of g.brackets) {
      if (g.ellipsis) notes.push(`bracket ${b.raw} inside an omission`)
      else notes.push(stands === undefined ? `bracket ${b.raw}: the quoter's words (not located)` : stands.trim() === '' ? `bracket ${b.raw} is an insertion` : `bracket ${b.raw} stands for "${shown(stands)}"`)
      const added = NEGATION.test(b.content)
      const removed = stands !== undefined && NEGATION.test(stands)
      if (!selective && added !== removed) {
        selective = { via: 'bracket', detail: stands === undefined
          ? `the bracketed alteration ${b.raw} carries a negation the opinion's text cannot be checked for`
          : `the bracketed alteration ${b.raw} stands for "${shown(stands)}" and ${added ? 'adds' : 'removes'} a negation` }
      }
    }
  }
  for (const pr of parentheticals) notes.push(`parenthetical ${pr} stripped from the quotation`)
  for (const b of plan.literalBrackets) notes.push(`bracket ${b} read as written (case aside)`)
  // (the text's words just outside the match, for a bracket at an edge that is not located; legal@0.5.5 reads them)
  const wordBefore = /([\p{L}'’]+)[^\p{L}]*$/u.exec(p.raw.slice(Math.max(0, span.start - 40), span.start))?.[1]
  const wordAfter = /^[^\p{L}]*([\p{L}'’]+)/u.exec(p.raw.slice(span.end, span.end + 40))?.[1]
  if (plan.lead) check(plan.lead, at.leadFrom !== undefined ? originalOf(p, at.leadFrom, at.starts[0] as number) : undefined, undefined, plan.pieces[0], undefined, wordBefore)
  plan.gaps.forEach((g, k) => check(g, originalOf(p, at.ends[k] as number, at.starts[k + 1] as number), plan.pieces[k], plan.pieces[k + 1], spanOf(p, at.ends[k] as number, at.starts[k + 1] as number)))
  if (plan.trail) check(plan.trail, at.trailTo !== undefined ? originalOf(p, at.ends[plan.pieces.length - 1] as number, at.trailTo) : undefined, plan.pieces[plan.pieces.length - 1], undefined, undefined, wordAfter)
  // legal@0.4.0: the notes below read the passage with its page marks blanked ("[*249]" is a page mark, not the opinion's brackets)
  const seen = p.blank !== undefined ? p.blank.slice(span.start, span.end) : passage
  if (hasQuotationMarks(quote) || hasQuotationMarks(seen)) notes.push('quotation marks not compared')
  if (plan.trailing && !trailingMatches) notes.push(`trailing "${plan.trailing}" not compared`)
  if (seen.includes('\u00AD')) notes.push('a soft hyphen in the opinion joined')
  if (/[-‐‑][ \t]*[\r\n]/.test(seen)) notes.push('a line-break hyphen in the opinion joined')
  if (/…|\.(?:[ \u00A0]?\.){2,}/.test(seen) && !plan.gaps.some(g => g.ellipsis)) notes.push("the opinion's own ellipsis not reproduced")
  if (/[[\]]/.test(seen)) notes.push("the opinion's own brackets not compared")
  return { kind: 'match', span, text: passage, notes, ...(selective ? { selective } : {}), alterations, omissions, parentheticals, omissionSpans, edges: edgesOf(plan, passage), cases: casesOf(p, plan, at) }
}

/** The original span of a normalised range (an empty range: where it falls). */
function spanOf(p: LegalPreparedSource, from: number, to: number): Span {
  if (to <= from) { const s = from < p.norm.map.length ? (p.norm.map[from] as number) : p.raw.length; return { start: s, end: s } }
  return toOriginalSpan(p.norm, from, to)
}

// ── legal@0.2.0: did the conventions keep the opinion's meaning? ──────────────────────────────────────────────────────────

const MODALS = new Set(['must', 'shall', 'may', 'can', 'could', 'should', 'will', 'would', 'might', 'ought'])
const QUANTIFIERS = new Set(['all', 'any', 'some', 'no', 'only', 'every', 'each', 'none', 'few', 'many', 'most', 'several', 'both', 'either', 'neither'])
const LIMITING = new Set(['unless', 'except', 'provided', 'if', 'but', 'until'])
const NEGATIONS = new Set(['not', 'no', 'never', 'cannot', 'nor', 'without', 'neither', 'none', 'nothing', 'nobody', 'nowhere'])
const PRONOUNS = new Set(['we', 'us', 'our', 'ours', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which'])
const ARTICLES = new Set(['a', 'an', 'the'])

/** A word that carries a modal, a negation, a quantifier or a limit: a bracket may never swap one. */
export function isGuardedWord(w: string): boolean {
  return MODALS.has(w) || QUANTIFIERS.has(w) || LIMITING.has(w) || NEGATIONS.has(w) || /n't$/.test(w) || /^(?:reject\w*|declin\w*|refus\w*|fail(?:s|ed|ing)?)$/.test(w)
}

const IRREGULAR: Record<string, string> = Object.fromEntries(([
  ['be', 'is are was were been being am'], ['have', 'has had having'], ['do', 'does did done doing'], ['hold', 'held holds holding'],
  ['find', 'found finds finding'], ['make', 'made makes making'], ['say', 'said says saying'], ['take', 'took taken takes taking'],
  ['give', 'gave given gives giving'], ['know', 'knew known knows knowing'], ['see', 'saw seen sees seeing'], ['come', 'came comes coming'],
  ['bring', 'brought brings bringing'], ['think', 'thought thinks thinking'], ['lead', 'led leads leading'], ['bear', 'bore borne bears bearing'],
  ['seek', 'sought seeks seeking'], ['write', 'wrote written writes writing'], ['begin', 'began begun begins beginning'],
  ['fall', 'fell fallen falls falling'], ['get', 'got gotten gets getting'], ['leave', 'left leaves leaving'], ['keep', 'kept keeps keeping'],
  ['meet', 'met meets meeting'], ['pay', 'paid pays paying'], ['show', 'shown showed shows showing'], ['speak', 'spoke spoken speaks speaking'],
  ['stand', 'stood stands standing'], ['tell', 'told tells telling'], ['win', 'won wins winning'], ['become', 'became becomes becoming'],
  ['go', 'went gone goes going'],
] as const).flatMap(([base, forms]) => [[base, base], ...forms.split(' ').map(f => [f, base])]))

/** A word's lemma for legal@0.2.0's same-word test: the irregular table, else one inflectional suffix off (see PREREG). */
export function lemmaOf(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, '').replace(/[’']$/, '')
  if (IRREGULAR[w]) return IRREGULAR[w] as string
  for (const [suf, add] of [['ies', 'y'], ['ied', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']] as const) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) { w = w.slice(0, -suf.length) + add; break }
  }
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1)
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[aeiou]/.test(w[w.length - 1] as string)) w = w.slice(0, -1)
  return w
}

const wordsOf = (t: string): string[] => (t.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []).map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean)

/** Inner quotation marks: a double mark, or an opening single mark (after a space, a bracket or a dash, before a letter). */
export function hasInnerQuotationMarks(t: string): boolean {
  return /[“”"„‟«»]/.test(t) || /(?:^|[\s([—–-])[‘'](?=\p{L})/u.test(t)
}

/** An ellipsis's omitted text carries a condition or a limiting word (legal@0.2.0's meaning guard): the first such word, or undefined. */
const CONDITION = /\b(?:unless|provided|except|only|not|but|subject\s+to|so\s+long\s+as|if|where|to\s+the\s+extent|preclud(?:e|es|ed|ing)|prohibit(?:s|ed|ing)?|bar(?:s|red|ring)?|exclud(?:e|es|ed|ing)|forb(?:id|ids|ade|idden)|foreclos(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|lack(?:s|ed|ing)?|absent|neither|none|nothing|nobody|nowhere)\b|\b[\p{L}]+n['’]t\b/iu
export function conditionWordIn(t: string): string | undefined {
  return CONDITION.exec(t)?.[0]
}

export type MeaningProblem =
  | { kind: 'altered'; bracket: string; replaced: string; why: string }
  | { kind: 'guarded-edge'; bracket: string; word: string }
  | { kind: 'condition'; elided: string; word: string }
  | { kind: 'nested'; detail: string }
  /** legal@0.5.5: a bracket inserts a content word this check does not read (neither a word it fails nor glue nor a name) */
  | { kind: 'inserted'; bracket: string; word: string }

// ── legal@0.5.5: words an insertion or an ellipsis can change the meaning with (2026-10-19) ───────────────────────────────────────
//
// legal@0.5.4 failed a bracket that inserts a word only when the word is a modal, a negation, a quantifier or a limit, so "must [always]
// exclude", "exclude [unreliable] expert testimony", "[expressly]", "[novel]" and "[damages]" passed (a cold review's eleven bracket probes;
// an AI agent in a legal-operations role, not a person). legal@0.5.5 reads an inserted word for what it is: a word of degree, frequency or
// hedging (HEDGE_WORDS_055), a word that says the opposite of its stem ("unreliable", "inadmissible", NEGATIVE_POLARITY_055), or an adverb
// in "-ly" FAILs, "it inserts "always", which the text does not say"; glue (an article, a pronoun, a preposition, a form of "be", "have"
// or "do", "that", "[sic]") and a name written with capitals ("[the Board]") read as before; any other inserted word answers can't tell,
// and the attorney of record decides whether it changes what the text says.

/** legal@0.5.5: one word of degree, frequency or hedging (a guarded word aside: those are read before). */
const HEDGE_WORDS_055 = new Set(['always', 'never', 'usually', 'generally', 'typically', 'ordinarily', 'normally', 'commonly', 'customarily', 'routinely', 'regularly', 'rarely', 'seldom', 'hardly', 'scarcely', 'barely', 'infrequently', 'sometimes', 'occasionally', 'often', 'frequently', 'presumptively', 'presumably', 'arguably', 'possibly', 'probably', 'likely', 'unlikely', 'largely', 'mostly', 'partly', 'partially', 'primarily', 'principally', 'chiefly', 'mainly', 'substantially', 'nearly', 'almost', 'virtually', 'merely', 'solely', 'exclusively', 'wholly', 'entirely', 'fully', 'necessarily', 'invariably', 'automatically', 'categorically', 'absolutely', 'strictly', 'narrowly', 'broadly', 'expressly', 'clearly', 'plainly', 'reasonably', 'sufficiently', 'adequately', 'materially', 'significantly', 'seriously', 'very', 'too', 'quite', 'rather', 'somewhat', 'especially', 'particularly', 'ever', 'still', 'yet', 'also', 'even', 'just', 'again', 'already', 'once', 'twice'])
/** legal@0.5.5: a phrase of degree, frequency or hedging inside an omitted stretch (one word of HEDGE_WORDS_055, or a phrase). */
const HEDGE_055 = new RegExp(String.raw`(?<![\p{L}])(?:${[...HEDGE_WORDS_055].filter(w => !['also', 'even', 'just', 'again', 'already', 'still', 'yet', 'once', 'twice', 'too', 'very', 'quite', 'rather', 'ever'].includes(w)).join('|')}|in\s+(?:(?:very|most|some|many|certain|rare|limited|exceptional|appropriate|narrow|unusual|extraordinary|few)\s+)+(?:circumstances|cases|instances|situations|respects)|as\s+a\s+(?:general\s+)?rule|for\s+the\s+most\s+part|in\s+general|by\s+and\s+large|to\s+(?:some|a\s+(?:limited|large|great|certain)|that|this|the\s+same)\s+(?:extent|degree)|in\s+part|at\s+least|at\s+most|no\s+longer|not\s+always)(?![\p{L}])`, 'iu')
/** legal@0.5.5: the word or phrase of degree, frequency or hedging a stretch carries, or undefined. */
export function hedgeIn055(t: string): string | undefined {
  return HEDGE_055.exec(t)?.[0]
}
/** legal@0.5.5: words formed with "un-", "in-", "non-" and their kin that are not the opposite of a stem. */
const NOT_NEGATIVE_055 = new Set(['universal', 'universally', 'unilateral', 'unilaterally', 'unanimous', 'unanimously', 'uniform', 'uniformly', 'unique', 'uniquely', 'united', 'unitary', 'understanding', 'understood', 'undertaking', 'underlying', 'undergoing', 'undertaken', 'interested', 'interesting', 'interstate', 'international', 'internal', 'intentional', 'intentionally', 'informed', 'influential', 'instrumental', 'integral', 'intended', 'intensive', 'increasing', 'incidental', 'individual', 'industrial', 'initial', 'innocent', 'inquiring', 'institutional', 'insured', 'insurable', 'invested', 'invited', 'involved', 'involuntary', 'immediate', 'immediately', 'important', 'importantly', 'imposing', 'imperative', 'impartial', 'implied', 'impliedly', 'imputed', 'irrevocable', 'disclosed', 'discovered', 'discretionary', 'disputed', 'distinct', 'distinctly', 'dispositive', 'distributed', 'nonetheless'])
/** legal@0.5.5: a word that says the opposite of its stem (legal@0.5.1's NEGATIVE_PREDICATE list, or a negating prefix on an adjective or adverb). */
export function negativePolarity055(w: string): boolean {
  const x = w.toLowerCase()
  if (NOT_NEGATIVE_055.has(x)) return false
  if (NEGATIVE_PREDICATE.test(x)) return true
  return /^(?:un|in|im|il|ir|non|dis|mis)[\p{L}]{3,}(?:able|ible|ful|ed|ing|ly|al|ive|ent|ant|ous|ary|ic|ical|ate|ile)$/u.test(x) && !/^(?:un|in|im|il|ir|non|dis|mis)(?:der|ter|clud|sist|stit|struct|stru|tend|form|vest|vit|volv|port|pos|pli|mediat|partial)/u.test(x)
}
/** Words an inserted bracket may hold as glue (an article, a pronoun, a preposition, a form of "be", "have" or "do", "that", "sic"). */
const GLUE_055 = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'upon', 'under', 'as', 'than', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had', 'having', 'does', 'do', 'did', 'that', 'which', 'who', 'whom', 'whose', 'there', 'here', 'sic', 's', 'es', 'ed', 'd', 'ing', 'one', 'ones', ...PRONOUNS])
/** Words of six letters or more that end in "-ly" and are not adverbs. */
const NOT_ADVERB_055 = new Set(['family', 'supply', 'comply', 'assembly', 'monopoly', 'anomaly', 'homily', 'butterfly', 'multiply', 'resupply', 'oversupply'])
/** legal@0.5.5: what an inserted bracket's words are: a word it fails, an unread content word, or glue and names only (undefined). */
export function insertedWord055(content: string): { word: string; fails: boolean } | undefined {
  const words = (content.match(/[\p{L}][\p{L}'’-]*/gu) ?? [])
  for (const w of words) {
    const x = w.toLowerCase()
    if (HEDGE_WORDS_055.has(x) || negativePolarity055(x) || (/^\p{L}{4,}ly$/u.test(x) && !NOT_ADVERB_055.has(x))) return { word: w, fails: true }
  }
  for (const w of words) {
    const x = w.toLowerCase()
    if (GLUE_055.has(x)) continue
    if (/^\p{Lu}/u.test(w)) continue // a name, or a referent written with its capital ("[the Board]", "[Marlowe]")
    return { word: w, fails: false }
  }
  return undefined
}

/** legal@0.5.5: an omitted stretch that says who must show what ("the opponent shows that", "must prove", "bears the burden"). */
const BURDEN_055 = /(?<![\p{L}])(?:(?:show|shows|showing|shown|showed|prove|proves|proving|proved|proven|establish|establishes|establishing|established|demonstrate|demonstrates|demonstrating|demonstrated|persuade|persuades)\s+that|(?:bears?|bore|carr(?:y|ies|ied)|has|have|had|shifts?|shifted)\s+the\s+(?:burden|onus|risk)|burden\s+of\s+(?:proof|persuasion|production|showing|establishing|proving))(?![\p{L}])/iu
export function burdenIn055(t: string): string | undefined {
  return BURDEN_055.exec(t)?.[0]
}
/** legal@0.5.5: a set-off phrase of time the last stretch of a clause opens ("…, within a reasonable time after he discovers"), or undefined. */
const TIME_PHRASE_055 = /^\s*(within|after|before|until|till|upon|once|when|whenever|while|during|prior\s+to|no\s+later\s+than|not\s+later\s+than|by\s+the\s+time|at\s+the\s+time|as\s+soon\s+as|following)(?![\p{L}])/iu
export function timePhraseOf055(clause: string): { word: string; phrase: string } | undefined {
  const seg = clause.split(/[,(—–]/u).pop() ?? clause
  const m = TIME_PHRASE_055.exec(seg)
  return m ? { word: m[1] as string, phrase: seg.trim() } : undefined
}
/**
 * legal@0.5.5: an omission that sits inside a clause: its stretch of the text neither opens nor closes on a clause mark (a comma, a semicolon,
 * a colon, a parenthesis, a dash, a sentence end or a quotation mark), on either side. "are . . . enforced" for "are rarely enforced" is
 * one; ", an adverse-inference instruction or dismissal," and a whole sentence are not.
 */
export function cutInsideClause055(raw: string, at: Span): boolean {
  if (at.start < 0 || at.end <= at.start) return false
  const o = raw.slice(at.start, at.end)
  const t = o.trim()
  if (t === '' || !/\p{L}/u.test(t)) return false
  const MARK = /[,;:()[\]—–\-.!?"“”'‘’¦]/u
  let a = at.start - 1
  while (a >= 0 && /\s/.test(raw[a] as string)) a--
  let b = at.end
  while (b < raw.length && /\s/.test(raw[b] as string)) b++
  const leftSet = MARK.test(t[0] as string) || (a >= 0 && MARK.test(raw[a] as string))
  const rightSet = MARK.test(t[t.length - 1] as string) || (b < raw.length && MARK.test(raw[b] as string))
  return !leftSet || !rightSet
}
/** legal@0.5.5: the parts of an omitted stretch that belong to the kept sentences: before its first sentence end, and after its last. */
export function keptSentenceParts055(o: string): string[] {
  const ends = [...o.matchAll(/[.!?]["”’)\]]*(?=\s|$)/gu)].filter(m => !/(?:^|\s)(?:\p{L}|[A-Z][a-z]{0,3}|Id|v|vs|No|Co|Inc|Corp|Ltd|U\.S|e\.g|i\.e)\.$/u.test(o.slice(Math.max(0, (m.index ?? 0) - 6), (m.index ?? 0) + 1)))
  if (ends.length === 0) return [o]
  const first = ends[0]!, last = ends[ends.length - 1]!
  return [o.slice(0, first.index ?? 0), o.slice((last.index ?? 0) + last[0].length)]
}

/**
 * legal@0.2.0's meaning guard on a match: the first problem, in its order of the rules that decide here
 * (an altered bracket, then an omitted condition, then reassigned inner quotation marks); undefined when the conventions kept
 * the meaning. 0.1.0's own negation checks (an omitted or bracketed negation, a preceding negation) are applied by the caller.
 * legal@0.5.5 (`opts.v055`) reads an inserted word for what it is (insertedWord055): FAIL, or, last of all, an unread insertion.
 */
export function meaningOf(r: Extract<QuotationReading, { kind: 'match' }>, quote: string, opts: { v055?: boolean } = {}): MeaningProblem | undefined {
  const lemmaKey = (ws: string[]): string => ws.filter(isGuardedWord).map(lemmaOf).sort().join(' ')
  let unread: MeaningProblem | undefined
  for (const a of r.alterations) {
    const B = wordsOf(a.content)
    if (a.inOmission || a.stands === undefined) {
      // not located (an edge), or mixed with an omission: what it replaced cannot be compared word for word
      const g = B.find(isGuardedWord)
      if (g !== undefined) return { kind: 'guarded-edge', bracket: a.raw, word: g }
      // legal@0.5.5: so is any word it would read in an insertion (insertedWord055), glue and names aside, unless it names what the
      // pronoun just outside the match refers to ("[The arbitration agreement] is enforceable" for "It is enforceable")
      const w = opts.v055 ? insertedWord055(a.content) : undefined
      const referent = a.edgeWord !== undefined && PRONOUNS.has(a.edgeWord.toLowerCase()) && /^\s*(?:the|a|an|its|his|her|their|that|this|such|\p{Lu})/iu.test(a.content) && w?.fails !== true
      if (w !== undefined && !referent) return { kind: 'guarded-edge', bracket: a.raw, word: w.word }
      continue
    }
    if (a.quoteWord !== undefined && a.opinionWord !== undefined) {
      const q = a.quoteWord.toLowerCase(), o = a.opinionWord.toLowerCase()
      if (q === o || lemmaOf(q) === lemmaOf(o)) continue
      return { kind: 'altered', bracket: a.raw, replaced: a.opinionWord, why: `it makes "${a.quoteWord}" of "${a.opinionWord}", which is not the same word or an inflection of it` }
    }
    const S = wordsOf(a.stands)
    if (S.length === 0) {
      const g = B.find(isGuardedWord)
      if (g !== undefined) return { kind: 'altered', bracket: a.raw, replaced: '', why: `it inserts "${g}", which the opinion does not say` }
      if (opts.v055) {
        const w = insertedWord055(a.content)
        if (w?.fails) return { kind: 'altered', bracket: a.raw, replaced: '', why: `it inserts "${w.word}", which the opinion does not say` }
        // a referent named right after the pronoun it explains ("It [the district court] held") reads as before
        const referent = a.prevWord !== undefined && PRONOUNS.has(a.prevWord.toLowerCase()) && /^\s*(?:the|a|an|its|his|her|their|that|this|such|\p{Lu})/u.test(a.content)
        if (w && !referent && unread === undefined) unread = { kind: 'inserted', bracket: a.raw, word: w.word }
      }
      continue
    }
    if (lemmaKey(B) !== lemmaKey(S)) {
      const gb = B.filter(isGuardedWord), gs = S.filter(isGuardedWord)
      const wb = gb.find(w => !gs.some(x => lemmaOf(x) === lemmaOf(w))), ws = gs.find(w => !gb.some(x => lemmaOf(x) === lemmaOf(w)))
      return { kind: 'altered', bracket: a.raw, replaced: a.stands.trim(), why: wb !== undefined && ws !== undefined ? `it puts "${wb}" where the opinion says "${ws}"` : wb !== undefined ? `it adds "${wb}"` : `it removes "${ws}"` }
    }
    if (B.join(' ') === S.join(' ')) continue
    if (S.every(w => PRONOUNS.has(w)) || B.every(w => PRONOUNS.has(w))) continue
    const pool = S.filter(w => !ARTICLES.has(w))
    const content = B.filter(w => !ARTICLES.has(w))
    const used = new Set<number>()
    const allSame = content.length > 0 && content.every(b => { const i = pool.findIndex((x, k) => !used.has(k) && lemmaOf(x) === lemmaOf(b)); if (i < 0) return false; used.add(i); return true })
    if (allSame) continue
    return { kind: 'altered', bracket: a.raw, replaced: a.stands.trim(), why: `"${a.content}" is not "${a.stands.trim()}", an inflection of it, or a pronoun or referent` }
  }
  for (const o of r.omissions) {
    const w = conditionWordIn(o)
    if (w !== undefined) return { kind: 'condition', elided: o, word: w }
  }
  const marksNamed = r.parentheticals.some(p => /quotation|cleaned\s+up/i.test(p))
  const q = quote.trim()
  const inner = /^[“"„«]/.test(q) && /[”"‟»]$/.test(q) ? q.slice(1, -1) : q
  const qInner = hasInnerQuotationMarks(inner)
  const pInner = hasInnerQuotationMarks(r.text)
  if (pInner && !qInner && !marksNamed) return { kind: 'nested', detail: 'the opinion quotes part of these words from another source (inner quotation marks), and the quotation drops the marks, which gives those words to the court; keep the inner marks or say "(internal quotation marks omitted)"' }
  if (qInner && !pInner) return { kind: 'nested', detail: 'the quotation marks some of these words as quoted from another source, but the opinion does not quote them: the marks give the court\'s own words to someone else' }
  return unread
}

// ── when nothing matches: the corresponding or nearest passage ────────────────────────────────────────────────────────

interface WordTokens { words: string[]; starts: number[]; ends: number[]; index: Map<string, number[]> }

/** Words of normalised text, edge punctuation stripped, with their normalised offsets. */
function wordTokens(text: string): WordTokens {
  const words: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  const index = new Map<string, number[]>()
  const re = /\S+/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let s = m.index
    let e = m.index + m[0].length
    while (s < e && !isAlnum(text[s])) s++
    while (e > s && !isAlnum(text[e - 1])) e--
    if (e <= s) continue
    const w = text.slice(s, e)
    const at = words.length
    words.push(w); starts.push(s); ends.push(e)
    const list = index.get(w)
    if (list) list.push(at); else index.set(w, [at])
  }
  return { words, starts, ends, index }
}

/** Length of the longest common subsequence of q and w[lo, hi). */
function lcs(q: string[], w: string[], lo: number, hi: number): number {
  const n = q.length
  const m = Math.max(0, hi - lo)
  if (n === 0 || m === 0) return 0
  let prev = new Uint32Array(m + 1)
  let cur = new Uint32Array(m + 1)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cur[j] = q[i - 1] === w[lo + j - 1] ? (prev[j - 1] as number) + 1 : Math.max(prev[j] as number, cur[j - 1] as number)
    const t = prev; prev = cur; cur = t
  }
  return prev[m] as number
}

/**
 * The tightest stretch of w[lo, hi) that still holds a longest common subsequence of length `len` with q: the smallest end,
 * then the largest start (both monotone, so a binary search). Its first and last word, inclusive.
 */
function tightest(q: string[], w: string[], lo: number, hi: number, len: number): [number, number] {
  let a = lo + 1
  let b = hi
  while (a < b) { const mid = (a + b) >> 1; if (lcs(q, w, lo, mid) >= len) b = mid; else a = mid + 1 }
  const end = a
  let c = lo
  let d = end - 1
  while (c < d) { const mid = (c + d + 1) >> 1; if (lcs(q, w, mid, end) >= len) c = mid; else d = mid - 1 }
  return [c, end - 1]
}

function nearest(p: LegalPreparedSource, plan: Plan, L: QuotationLimits = QUOTATION_LIMITS): QuotationReading {
  const q = wordTokens(plan.pieces.map(x => x.text).join(' ')).words
  if (q.length === 0) return { kind: 'none', longestRun: 0 }
  p.words ??= wordTokens(p.norm.text)
  const src = p.words
  // Maximal runs of consecutive quoted words that occur consecutively in the opinion (whole words, by construction). Only the
  // best few are ever read (by length, then quotation position, then text position: a total order, since a run is known by where
  // it starts), so only those are kept while scanning (2026-10-06). Keeping every run let a repetitive quotation against a long text
  // ("the court held that N", over and over) hold tens of millions of them and exhaust memory. A candidate the kept runs already
  // beat is skipped once one word shows it cannot be longer than the weakest of them; it is no longer than the longest run either,
  // so neither the runs read nor `longestRun` change: the answer is the same, byte for byte, under every rule.
  const keep = q.length > 500 ? 3 : 8
  const before = (x: { i: number; at: number; len: number }, y: { i: number; at: number; len: number }): boolean => x.len > y.len || (x.len === y.len && (x.i < y.i || (x.i === y.i && x.at < y.at)))
  let longestRun = 0
  const runs: { i: number; at: number; len: number }[] = []
  for (let i = 0; i < q.length; i++) {
    let list = src.index.get(q[i] as string) ?? []
    let shift = 0
    if (runs.length === keep) {
      // a run that can enter is longer than the weakest kept one, so it matches every word from here to `need` places on; walk the
      // places of the rarest of those words (each list ascends, so the candidates come in the same order). A candidate that does
      // not match it is no longer than the weakest kept run, and would be skipped below. None can enter when the quotation ends first.
      const need0 = (runs[keep - 1] as { len: number }).len
      if (i + need0 >= q.length) continue
      for (let k = 1; k <= need0; k++) {
        const other = src.index.get(q[i + k] as string) ?? []
        if (other.length < list.length) { list = other; shift = k }
      }
    }
    for (const at1 of list) {
      const at = at1 - shift
      if (at < 0 || (shift > 0 && src.words[at] !== q[i])) continue
      if (i > 0 && at > 0 && src.words[at - 1] === q[i - 1]) continue // not maximal on the left
      if (runs.length === keep) {
        // scanned in order of (i, at), so this run enters only if it is longer than the weakest kept one
        const need = (runs[keep - 1] as { len: number }).len
        if (i + need >= q.length || at + need >= src.words.length || src.words[at + need] !== q[i + need]) continue
      }
      let len = 1
      while (i + len < q.length && at + len < src.words.length && src.words[at + len] === q[i + len]) len++
      if (len > longestRun) longestRun = len
      if (len < L.anchorWords) continue
      const run = { i, at, len }
      if (runs.length === keep && !before(run, runs[keep - 1] as typeof run)) continue
      let k = runs.length
      while (k > 0 && before(run, runs[k - 1] as typeof run)) k--
      runs.splice(k, 0, run)
      if (runs.length > keep) runs.pop()
    }
  }
  if (runs.length === 0) return { kind: 'none', longestRun }
  const slack = Math.max(3, Math.ceil(q.length / 4))
  const allowance = plan.gaps.reduce((n, g) => n + (g.ellipsis ? Math.ceil(L.ellipsisChars / 6) : 4 * g.brackets.length), 0)
  let best: { run: { i: number; at: number; len: number }; sim: number; lo: number; hi: number; common: number } | undefined
  for (const run of runs) {
    const lo = Math.max(0, run.at - run.i - slack)
    const hi = Math.min(src.words.length, run.at + (q.length - run.i) + slack + allowance)
    const common = lcs(q, src.words, lo, hi)
    const sim = common / q.length
    if (!best || sim > best.sim) best = { run, sim, lo, hi, common }
  }
  if (!best || best.sim < L.nearestSimilarity) return { kind: 'none', longestRun }
  // The passage: the tightest stretch of the opinion the quotation aligns with, two words either side. (A very long
  // quotation is shown against the stretch its anchor implies, to keep the cost bounded.)
  const [first, last] = q.length * (best.hi - best.lo) <= 1_000_000
    ? tightest(q, src.words, best.lo, best.hi, best.common)
    : [Math.max(best.lo, best.run.at - best.run.i), Math.min(best.hi - 1, best.run.at + q.length - best.run.i - 1)]
  const a = Math.max(0, first - 2)
  const b = Math.min(src.words.length - 1, last + 2)
  const span = toOriginalSpan(p.norm, src.starts[a] as number, src.ends[b] as number)
  const core = toOriginalSpan(p.norm, src.starts[first] as number, src.ends[last] as number)
  return {
    kind: 'passage',
    strength: best.sim >= L.correspondingSimilarity ? 'corresponding' : 'nearest',
    span, text: p.raw.slice(span.start, span.end), anchorWords: best.run.len, similarity: Math.round(best.sim * 1000) / 1000, core,
  }
}
