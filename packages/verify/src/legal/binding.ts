/**
 * Engine 0.6.0 (cold-review round 2, 2026-10-05): binding a supplied opinion text to the citation it is checked for, and recording
 * where each text came from. Engines before 0.6.0 never call this module.
 *
 * Why: a quotation check is only as good as the text it is checked against. Mapping one case's cite to another case's text
 * used to PASS (a cold reader's (an AI agent's) probe: an Axon cite paired with the Makarova opinion). The engine cannot know that a text is the
 * opinion a cite names, but it can refuse to say so when the text does not name it.
 *
 * The rule (every identifier the citation supplies must be named in the text):
 *   - a reporter citation ("201 F.3d 110", pin cite and parenthetical aside) must appear in the text, its parts separated
 *     only by spaces or periods ("550 U. S. 544" names "550 U.S. 544"); a slip opinion's "<volume> <reporter> ___" names a
 *     citation with the same volume and reporter. A citation string that is not volume, reporter and page must appear
 *     literally (case and spacing aside);
 *   - a case name must have each party named: at least one of a party's distinctive words appears in the text as a whole
 *     word (case aside). Corporate suffixes, articles and procedural words ("Inc.", "the", "In re", "ex rel.") are not
 *     distinctive; a word abbreviated with a period ("Enter.") is read as a prefix; a contraction ("Int'l") is skipped;
 *   - a citation with neither a case name nor a reporter citation names no authority, so nothing can be bound to it.
 * When any part is not named, the claim abstains: never PASS, never FAIL.
 *
 * A weaker tier, opt-in per text and labelled (maintainers' decision, 2026-10-05): a text supplied with `bind: "parties"` binds a citation whose
 * case name has every party named in it even when its reporter citation is not found there. The naming records it (`tier:
 * "parties-only"`, "bound by parties only; reporter citation not found in text"), the claim's explanation says it, and the verdict's
 * choice ledger records the binding as a stated choice. `bind: "strict"` (the default) refuses such a text, as above.
 *
 * Pure and deterministic: no I/O, no clock.
 */

import { sha256 } from '../verdict/canonical.js'
import { KEYCITE_TREATMENT } from './quotation.js'

/** An opinion text with where it came from (engine 0.6.0). A bare string is an opinion text with no stated origin. */
export interface OpinionText {
  text: string
  /** Who supplied it or where it was read from, e.g. "a public case-law archive", "Westlaw download", "firm DMS". */
  source?: string
  /** Where it was retrieved, when it has an address. */
  url?: string
  /** When it was retrieved, as the caller states it (ISO 8601 recommended). */
  retrieved_at?: string
  /**
   * How this text is bound to the citations checked against it: "strict" (the default) needs the reporter citation and every party
   * named in the text; "parties" also binds, labelled, a citation whose parties are all named when its reporter citation is not.
   */
  bind?: BindMode
}

/** How a supplied text is bound to its cite (see OpinionText.bind). */
export type BindMode = 'strict' | 'parties'

/** The label a parties-only binding carries, wherever it is recorded. */
export const PARTIES_ONLY_NOTE = 'bound by parties only; reporter citation not found in text'

/** The binding mode a supplied source states: "parties" only when stated so; anything else is strict. */
export function bindModeOf(s: unknown): { mode: BindMode; stated: boolean } {
  const b = s !== null && typeof s === 'object' ? (s as OpinionText).bind : undefined
  return b === 'parties' || b === 'strict' ? { mode: b, stated: true } : { mode: 'strict', stated: false }
}

/** What one supplied text names, for one citation checked against it. */
export interface CiteNaming {
  claim_id: string
  /** the reporter citation the citation asks for, and whether the text names it */
  cite?: { asked: string; found: boolean; form?: 'reporter' | 'slip' | 'literal' }
  /** each party of the case name, and the word of it the text names (null: none) */
  parties?: { party: string; found: string | null }[]
  /** every identifier the citation supplies is named in the text (or, under bind "parties", every party: see tier) */
  bound: boolean
  /** present only when bound by the weaker, opt-in tier: the parties are named, the reporter citation is not */
  tier?: 'parties-only'
  note?: typeof PARTIES_ONLY_NOTE | typeof PARTIES_ONLY_NOTE_V030
  /** legal@0.3.0: bound by the text's caption (captionOf); cite and parties above say what the CAPTION names */
  by?: 'caption'
  /** legal@0.3.0: what the caption says the text is (null: the text has no caption) */
  caption?: { name?: string; cite?: string } | null
  /** legal@0.3.0: the caption does not name the citation, but the body does (the text cites it) */
  mentioned?: true
  /** legal@0.4.0: the reporter citation is printed on a head line outside the caption window, this many lines below or above the case name */
  cite_line?: { lines: number; at: 'below' | 'above' }
  /** legal@0.4.0: the citation is a short form, read as a pin cite to the brief's full citation `reads` (cited in full at claim `from`) */
  short_form?: { written: string; reads: string; from: string }
  /**
   * legal@0.5.0: the citation as written carried more than its reporter citation (a pin page, the case name, a parenthetical), and
   * was looked up and bound as `reads`; `pin` is the pin page as written (never checked); `key` the supplied text it found
   */
  read_as?: { written: string; reads: string; pin?: string; key: string }
  /** legal@0.5.0: the reporter citation was named by the line after a Lexis header's "Reporter" heading, not inside the caption window */
  reporter_block?: true
  /** legal@0.5.2: the reporter citation was named by the line under a Westlaw download's "All Citations" heading, not in the caption */
  all_citations?: true
}

/** The provenance block, one per supplied opinion text, sorted by key (engine 0.6.0; Verdict `opinion_sources`). */
export interface OpinionProvenance {
  key: string
  /** sha256 of the text, as UTF-8 */
  sha256: string
  chars: number
  source?: string
  url?: string
  retrieved_at?: string
  /** the binding mode the caller stated for this text (absent: strict, the default) */
  bind?: BindMode
  /** the citations checked against this text, and what it names for each */
  names: CiteNaming[]
  /**
   * legal@0.5.0: the sections the check read in this text (./sections.ts), in order, by 1-based line; absent when it read none (the
   * text is read whole, as the opinion)
   */
  sections?: { kind: string; name: string; line: number; last_line: number }[]
}

/** The text of a supplied source, string or OpinionText; undefined when there is none. */
export function textOf(s: unknown): string | undefined {
  if (typeof s === 'string') return s.length > 0 ? s : undefined
  if (s !== null && typeof s === 'object' && typeof (s as OpinionText).text === 'string' && (s as OpinionText).text.length > 0) return (s as OpinionText).text
  return undefined
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── a citation's parts, in one pass (2026-10-20) ────────────────────────────────────────────────────────────────────────────────────
//
// parseReporterCite read the citation as written, which is the caller's text, and every key a text is filed under (once for each
// citation of the brief), with four regular expressions, and partiesOf split a case name with a fifth. Each was quadratic in a long
// run of spaces, of open parentheses, or of commas before a line break: a 64 KB cite or case name took seconds. Each reader below
// returns exactly what its pattern returned (the pattern is quoted on each); test/legal-cite-readers.test.ts compares the two on every
// string in the legal fixtures and on generated probes. No verdict changes, so no rule version changes.

let SPACING: Uint8Array | undefined
/** The code units the patterns read as `\s`, taken once from the engine's own `\s` (each a single code unit; the same with or without the u flag). */
function spacingTable(): Uint8Array {
  if (SPACING !== undefined) return SPACING
  const t = new Uint8Array(65536)
  const re = /\s/
  for (let c = 0; c < 65536; c++) if (re.test(String.fromCharCode(c))) t[c] = 1
  SPACING = t
  return t
}
/** s[i] is spacing as the patterns read `\s`. */
export const spacingAt = (s: string, i: number): boolean => i < s.length && (SPACING ?? spacingTable())[s.charCodeAt(i)] === 1
/** A line terminator, the code units `.` does not match (with or without the u flag). */
export const lineBreak = (c: number): boolean => c === 10 || c === 13 || c === 0x2028 || c === 0x2029
/** An ASCII digit, `\d`. */
export const asciiDigit = (c: number): boolean => c >= 48 && c <= 57
/** The first position at or after i that is not spacing. */
export const afterSpacing = (s: string, i: number): number => { while (i < s.length && spacingAt(s, i)) i++; return i }
const lastLineBreak = (s: string): number => { for (let k = s.length - 1; k >= 0; k--) if (lineBreak(s.charCodeAt(k))) return k; return -1 }
/** "at" in either case: without it, there is no pin after " at " to read off. */
const AT_LETTERS = /[aA][tT]/

/**
 * `s.replace(/\([^)]*\)\s*$/, '')`: a closing parenthetical read off. The pattern took the leftmost "(" with no ")" between it and
 * the last character that is not spacing, when that character is ")". Exported for its tests; not part of the package's entry point.
 */
export function withoutClosingParenthetical(s: string): string {
  let j = s.length - 1
  while (j >= 0 && spacingAt(s, j)) j--
  if (j < 0 || s[j] !== ')') return s
  const i = s.indexOf('(', (j > 0 ? s.lastIndexOf(')', j - 1) : -1) + 1)
  return i === -1 || i >= j ? s : s.slice(0, i)
}
/** `s.replace(/,.*$/, '')`: from the first comma with no line break after it. Exported for its tests. */
export function withoutPinAfterComma(s: string): string {
  if (s.indexOf(',') < 0) return s
  const c = s.indexOf(',', lastLineBreak(s) + 1)
  return c === -1 ? s : s.slice(0, c)
}
/**
 * `s.replace(/\s+at\s+\d.*$/i, '')`: from the first run of spacing followed by "at" (either case), more spacing and a digit with no line
 * break after it. Exported for its tests.
 */
export function withoutPinAfterAt(s: string): string {
  if (!AT_LETTERS.test(s)) return s
  const n = s.length
  const last = lastLineBreak(s)
  let i = 0
  while (i < n) {
    if (!spacingAt(s, i)) { i++; continue }
    const r0 = i
    i = afterSpacing(s, i)
    if ((s[i] === 'a' || s[i] === 'A') && (s[i + 1] === 't' || s[i + 1] === 'T') && spacingAt(s, i + 2)) {
      const w = afterSpacing(s, i + 2)
      if (w < n && asciiDigit(s.charCodeAt(w)) && last < w) return s.slice(0, r0)
    }
  }
  return s
}

/** One match shaped as `exec` returned it: the whole string, then three groups, at index 0. */
export type WholeMatch = [string, string, string, string] & { index: number }
const wholeMatch = (s: string, a: string, b: string, c: string): WholeMatch => Object.assign([s, a, b, c] as [string, string, string, string], { index: 0 })

/**
 * `/^(\d+)\s+(.+?)\s+(\d+)$/.exec(s)`: volume, the words between, page. The volume is the leading digits and the page the closing ones,
 * each beside spacing; the words between are the shortest run that a run of spacing and the page close, starting after as much of the
 * spacing after the volume as leaves one, and never crossing a line break. Exported for its tests.
 */
export function volumeReporterPage(s: string): WholeMatch | null {
  const n = s.length
  let g = 0
  while (g < n && asciiDigit(s.charCodeAt(g))) g++
  if (g === 0 || !spacingAt(s, g)) return null
  const e1 = afterSpacing(s, g)
  let es = n
  while (es > 0 && asciiDigit(s.charCodeAt(es - 1))) es--
  if (es === n || es === 0 || !spacingAt(s, es - 1)) return null
  let w2 = es - 1
  while (w2 > 0 && spacingAt(s, w2 - 1)) w2--
  let nextBreak = n // the first line break at or after a
  for (let k = n - 1; k >= e1; k--) if (lineBreak(s.charCodeAt(k))) nextBreak = k
  for (let a = e1; a > g; a--) {
    if (a < e1 && lineBreak(s.charCodeAt(a))) nextBreak = a
    const b = Math.max(a + 1, w2)
    if (b >= es || nextBreak < b) continue
    return wholeMatch(s, s.slice(0, g), s.slice(a, b), s.slice(es))
  }
  return null
}

/** A reporter citation as volume, reporter and first page; undefined when the string is not one. */
export function parseReporterCite(cite: string): { volume: string; reporter: string[]; page: string } | undefined {
  // pin cite (", 113" or " at 113"), and a closing parenthetical ("(2d Cir. 2000)"), are not part of the citation
  const core = withoutPinAfterAt(withoutPinAfterComma(withoutClosingParenthetical(cite))).trim()
  const m = volumeReporterPage(core)
  if (!m) return undefined
  const reporter = m[2].split(/[\s.]+/).filter(Boolean)
  if (reporter.length === 0 || !reporter.some(t => /\p{L}/u.test(t))) return undefined
  return { volume: m[1], reporter, page: m[3] }
}

/** Does the text name this reporter citation? */
export function citeNamed(text: string, cite: string): { found: boolean; form?: 'reporter' | 'slip' | 'literal' } {
  const p = parseReporterCite(cite)
  if (!p) {
    const want = cite.replace(/\s+/g, ' ').trim().toLowerCase()
    return want.length > 0 && text.replace(/\s+/g, ' ').toLowerCase().includes(want) ? { found: true, form: 'literal' } : { found: false }
  }
  const sep = '[\\s.]*'
  const head = `(?<!\\p{N})${escape(p.volume)}(?!\\p{N})${sep}${p.reporter.map(escape).join(sep)}${sep}`
  if (new RegExp(`${head}${escape(p.page)}(?!\\p{N})`, 'iu').test(text)) return { found: true, form: 'reporter' }
  if (new RegExp(`${head}_{3,}`, 'iu').test(text)) return { found: true, form: 'slip' }
  return { found: false }
}

/** Words that do not distinguish a party. */
const NOT_DISTINCTIVE = new Set([
  'the', 'of', 'and', 'a', 'an', 'in', 're', 'ex', 'rel', 'parte', 'matter', 'et', 'al', 'on', 'for', 'by', 'to', 'at', 'as',
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'llc', 'llp', 'lp', 'plc', 'na', 'sa', 'ag', 'gmbh', 'pc', 'pa',
])

/** A party's distinctive words, each as a pattern and the word as written. */
function partyWords(party: string): { re: RegExp; word: string }[] {
  const out: { re: RegExp; word: string }[] = []
  for (const tok of party.split(/[\s,;:()]+/).filter(Boolean)) {
    if (/['’]/.test(tok.replace(/['’]s$/i, ''))) continue // a contraction ("Int'l", "Ass'n") cannot be matched reliably
    const bare = tok.replace(/['’]s$/i, '')
    const core = bare.replace(/[^\p{L}\p{N}]/gu, '')
    if (core.length === 0 || NOT_DISTINCTIVE.has(core.toLowerCase())) continue
    if (/^(?:\p{L}\.){2,}$/u.test(bare)) { // an initialism with periods ("U.S."): the letters, periods and spaces optional
      out.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${[...core].map(escape).join('\\.?\\s?')}\\.?(?![\\p{L}\\p{N}])`, 'iu'), word: tok })
      continue
    }
    if (core.length < 2) continue
    const abbreviated = /\.$/.test(bare) && core.length >= 2 && !/^\p{Lu}+$/u.test(core)
    out.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(core)}${abbreviated ? '[\\p{L}]*' : ''}(?![\\p{L}\\p{N}])`, 'iu'), word: tok })
  }
  return out
}

/**
 * The parties of a case name ("A v. B", "A vs. B"; one party otherwise, e.g. "In re A"). What `caseName.split(/\s+(?:v|vs)\.?\s+/i)`
 * returned, each part trimmed and the empty ones dropped. 2026-10-20: the separator may start only where a run of spacing starts (the
 * lookbehind). Split tries each position of a run from its start, and a separator that fails at a run's start fails at every later
 * position of that run (the rest of the run, then "v"), so the parts are the same; the pattern no longer reads a long run once from
 * each of its positions, which cost time quadratic in its length.
 */
const PARTY_SEPARATOR = /(?<!\s)\s+(?:v|vs)\.?\s+/i
export function partiesOf(caseName: string): string[] {
  return caseName.split(PARTY_SEPARATOR).map(s => s.trim()).filter(Boolean)
}

/** Does the text name this party? The word it names, or null. A party with no distinctive word must appear literally. */
function partyNamed(text: string, party: string): string | null {
  return namedBy(partyWords(party), text, party)
}
/** partyNamed with the party's words already read (partyWords). */
function namedBy(words: { re: RegExp; word: string }[], text: string, party: string): string | null {
  if (words.length === 0) {
    const want = party.replace(/\s+/g, ' ').trim().toLowerCase()
    return want.length > 0 && text.replace(/\s+/g, ' ').toLowerCase().includes(want) ? party : null
  }
  for (const w of words) if (w.re.test(text)) return w.word
  return null
}

/** Does the text name this party (partyNamed)? legal@0.4.0 reads a short form's case name against a full citation's with it. */
export function partyNamedIn(text: string, party: string): boolean {
  return partyNamed(text, party) !== null
}

/**
 * partyNamedIn for one party read against many texts (2026-10-20): the party's words are read once, not once for each text. A short
 * form's case name is read against every full citation it could point to, and building its patterns again for each cost more than the
 * test itself. The patterns hold no state between tests (no g or y flag), so each answer is partyNamedIn's.
 */
export function partyNamer(party: string): (text: string) => boolean {
  const words = partyWords(party)
  return (text: string): boolean => namedBy(words, text, party) !== null
}

/** What the text names for this citation (engine 0.6.0). */
export function namingOf(claimId: string, c: { cite?: string; case_name?: string }, text: string, mode: BindMode = 'strict'): CiteNaming {
  const cite = typeof c.cite === 'string' && c.cite.trim().length > 0 ? c.cite.trim() : undefined
  const caseName = typeof c.case_name === 'string' && c.case_name.trim().length > 0 ? c.case_name.trim() : undefined
  const out: CiteNaming = { claim_id: claimId, bound: false }
  if (cite !== undefined) {
    const hit = citeNamed(text, cite)
    out.cite = { asked: cite, found: hit.found, ...(hit.form !== undefined ? { form: hit.form } : {}) }
  }
  if (caseName !== undefined) out.parties = partiesOf(caseName).map(party => ({ party, found: partyNamed(text, party) }))
  out.bound = (cite !== undefined || caseName !== undefined) && (out.cite?.found ?? true) && (out.parties ?? []).every(p => p.found !== null)
  // the opt-in, labelled tier: every party named, the reporter citation asked for but not found
  if (!out.bound && mode === 'parties' && out.cite !== undefined && !out.cite.found && out.parties !== undefined && out.parties.length > 0 && out.parties.every(p => p.found !== null)) {
    out.bound = true
    out.tier = 'parties-only'
    out.note = PARTIES_ONLY_NOTE
  }
  return out
}

// ── legal@0.3.0: the caption (2026-10-05) ─────────────────────────────────────────────────────────────────────────────
//
// legal@0.0.1 to 0.2.0 bind a text to a citation when the text names the citation ANYWHERE. An opinion that cites a case names
// it, so a later opinion's text bound to the case it cites: Cooper v. Aaron's text, which cites Brown v. Board of Education,
// 347 U.S. 483, bound to a Brown cite and passed a Cooper sentence as Brown's (a cold reader's (an AI agent's) probe). legal@0.3.0 binds a
// text only by its CAPTION: the case name and reporter citation printed at its top, as a reporter prints them. A mention in the
// body binds nothing; it is reported ("it cites Brown v. Board of Education but is not that opinion").
//
// The caption is read from the text's HEAD: its first non-empty lines, at most CAPTION_LIMITS.headLines of them, ending before the
// first line longer than CAPTION_LIMITS.bodyLineChars characters (a paragraph of the body). In the head:
//   - a line is PROSE when it holds a sentence end (a word of four or more letters, a period, question or exclamation mark,
//     a space and a capital: "is issued. The syllabus") or ends with a colon (it introduces what follows); prose is never caption;
//   - the NAME block is the first non-prose head line with a case-name separator (" v. ", " vs. ") preceded by at most
//     CAPTION_LIMITS.partyWords words, or a line that is only "v." between two lines (a slip opinion's caption), or a line that
//     starts "In re", "Ex parte" or "Matter of"; a party wrapped onto the line above or below (the line ends with a comma or
//     "&") belongs to it, up to two lines;
//   - the CITATION lines are the non-prose head lines that carry a reporter citation (or a slip opinion's "<volume> U. S. ___")
//     and lie at most three lines above the name block or two below it; with no name block, a citation in the first two head
//     lines; and a line that starts "Cite as" and carries a citation, anywhere in the text (a slip opinion prints it atop every
//     page after the first: the text naming itself, never another case).
// A citation is bound (strict) when its reporter citation is named in the caption's citation lines and each party of its case
// name in the name block, by the same tests as above (citeNamed, partyNamed). Under bind "parties", a caption that names every
// party but not the reporter citation binds the parties-only tier, which under legal@0.3.0 is checked and left OPEN (never
// PASS: another opinion in the same case, the decision below or a remand, carries the same caption).

/** The limits legal@0.3.0 reads a caption with. Changing one is a new ruleset version. */
export const CAPTION_LIMITS = {
  /** the head is at most this many non-empty lines ... */
  headLines: 12,
  /** ... and ends before the first line longer than this many characters (a paragraph of the body) */
  bodyLineChars: 400,
  /** a case-name line has at most this many words before its " v. " */
  partyWords: 30,
  /** a citation line lies at most this many lines above the name block ... */
  citeAbove: 3,
  /** ... or this many below it */
  citeBelow: 2,
} as const

/** What a text's caption says it is (legal@0.3.0). */
export interface Caption {
  /** the case name the caption prints, shortened for a reader ("Cooper v. Aaron"); absent when the head has no case-name line */
  name?: string
  /** the first reporter citation the caption prints, as printed ("358 U.S. 1"); absent when it prints none */
  cite?: string
  /** the caption's name block and citation lines, as printed (what the citation is bound against) */
  names: string
  cites: string
}

/** A reporter citation inside a line: volume, reporter words, then a page or a slip opinion's blank ("598 U. S. ___"). */
// (reporter words are separated by a space, so a run of capitals splits one way only: no exponential backtracking on "1 SUPREMECOURT…")
const CITE_IN_LINE = /(?<![\p{L}\p{N}])\d{1,4}\s+[A-Z][\p{L}\p{N}.'’]*(?:\s(?:[A-Z][\p{L}\p{N}.'’]*|\d{1,2}[a-z]{1,2}\.?|[a-z]{1,5}\.))*(?:\s+\(\d{1,4}\s+[A-Z][\p{L}.'’ ]*\))?\s+(?:\d{1,5}|_{3,})(?![\p{L}\p{N}])/u
/**
 * legal@0.5.4 (2026-10-14): a Westlaw or Lexis database number ("2025 WL 1188234", "2024 U.S. Dist. LEXIS 48213") is a citation line of a
 * caption too. Its number runs to eight digits, where a reporter's page has at most five, so legal@0.5.3 read no citation on the line and
 * answered can't tell for every quotation against an unpublished opinion cited by its database number (a cold review; an AI agent, not a
 * person). The year is four digits; the database word is "WL" or ends in "LEXIS".
 */
const CITE_IN_LINE_054 = new RegExp(`${CITE_IN_LINE.source}|(?<![\\p{L}\\p{N}])\\d{4}\\s+(?:WL|(?:[A-Z][\\p{L}.]*\\s?){0,4}LEXIS)\\s+\\d{1,8}(?![\\p{L}\\p{N}])`, 'u')
const SEPARATOR = /\s(?:v|vs)\.?\s/i
const LONE_V = /^(?:v|vs)\.?$/i
const IN_RE = /^(?:in\s+re|ex\s+parte|in\s+the\s+matter\s+of|matter\s+of)\s/i
const PROSE = /\p{L}{4,}[.?!]["”’)]*\s+["“(]?\p{Lu}/u
const CITE_AS = /^cite\s+as\b/i
const CITE_IN_LINE_G = (): RegExp => new RegExp(CITE_IN_LINE.source, 'gu')
/** The label a parties-only binding carries under legal@0.3.0, where it is checked and left open. */
export const PARTIES_ONLY_NOTE_V030 = 'bound by parties only; the caption does not print the reporter citation; not certified'
const SMALL = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'at', 'by', 'to', 'a', 'an', 'ex', 'rel', 'et', 'al', 'de', 'la'])

/** A word printed in capitals, read the way a reader writes the name ("COOPER" → "Cooper"; "U.S." and "McLAUGHLIN" kept). */
function readerCase(words: string, keepFirst = true): string {
  return words.split(/(\s+)/).map((w, i) => {
    const letters = w.replace(/[^\p{L}]/gu, '')
    if (letters.length < 2 || letters !== letters.toUpperCase() || /\p{L}\.\p{L}/u.test(w)) return w
    const lower = w.toLowerCase()
    if (i > 0 && SMALL.has(letters.toLowerCase())) return lower
    return keepFirst ? lower.replace(/\p{L}/u, ch => ch.toUpperCase()) : lower
  }).join('')
}

/** One party as a caption prints it, shortened: up to its first comma, "et al." dropped ("COOPER et al., MEMBERS OF …" → "Cooper"). */
function shortParty(side: string): string {
  const cut = side.replace(CITE_IN_LINE_G(), ' ').split(',')[0] ?? side
  const t = cut.replace(/\bet\s+al\.?/gi, ' ').replace(/\s+/g, ' ').replace(/[\s,;:]+$/, '').trim()
  // a closing period is dropped unless it ends an abbreviation ("CELOTEX CORP." keeps it; "MADISON." does not)
  const last = (t.match(/([\p{L}']+)\.$/u)?.[1] ?? '').toLowerCase()
  return readerCase(/\.$/.test(t) && !ABBREVIATIONS.has(last) ? t.slice(0, -1) : t)
}
const ABBREVIATIONS = new Set(['corp', 'co', 'inc', 'ltd', 'bros', 'jr', 'sr', 'assn', 'dept', 'natl', 'intl', 'mfg', 'ry', 'st'])

/**
 * legal@0.3.0: a party named in the caption's name block. As partyNamed, and also an initialism the brief writes for a name the
 * caption prints in full: "FTC" is named by "FEDERAL TRADE COMMISSION", "NLRB" by "NATIONAL LABOR RELATIONS BOARD" (the initials of
 * consecutive words; "of", "and", "the" and "for" skipped). A caption prints the full name where the body and the brief abbreviate it.
 */
function partyNamedInCaption(names: string, party: string): string | null {
  const hit = partyNamed(names, party)
  if (hit !== null) return hit
  // a hyphenated name: partyWords reads "Orellana-Recinos" as one word without its hyphen, so read the caption that way too
  const joined = partyNamed(names.replace(/(\p{L})[-‐‑](?=\p{L})/gu, '$1'), party)
  if (joined !== null) return joined
  const words = names.split(/[^\p{L}'’]+/u).filter(w => w.length > 0 && !/^(?:of|and|the|for)$/i.test(w))
  for (const tok of party.split(/[\s,;:()]+/)) {
    const ini = tok.replace(/[.\s]/g, '')
    if (!/^\p{Lu}{2,6}$/u.test(ini)) continue
    for (let i = 0; i + ini.length <= words.length; i++) {
      if (words.slice(i, i + ini.length).every((w, k) => (w[0] as string).toUpperCase() === ini[k])) return `${tok} (${words.slice(i, i + ini.length).join(' ')})`
    }
  }
  return null
}

/** prose, or a line that introduces what follows (it ends with a colon: "As held in Marbury v. Madison, 5 U.S. 137:"), is never caption */
const proseLine = (l: string): boolean => PROSE.test(l) || /:$/.test(l)

/**
 * legal@0.5.2 (2026-10-06): lines a vendor prints at the head of a download that are not the caption, skipped when the caption is read.
 * A Westlaw download can open on its KeyCite flag ("KeyCite Yellow Flag - Negative Treatment") and the treatment under it ("Declined
 * to Extend by Nease v. Ford Motor Co., 4th Cir.(W.Va.), January 24, 2017"); legal@0.5.1 read that line's " v. " as the case name, and
 * said the text was "Declined to Extend by Nease v. Ford Motor Co." (a cold reader's probe; an AI agent, not a person). A PDF turned
 * into text can open on a page footer or banner ("© 2026 Thomson Reuters …", "WESTLAW …", "Page 1 of 12").
 */
const VENDOR_HEAD_LINE = /^(?:KeyCite\b|(?:End of Document\s+)?©\s?\d{4}\s+Thomson\s+Reuters\b|(?:WESTLAW|Westlaw(?:Next)?)\b|Page\s+\d{1,4}\s+of\s+\d{1,4}$)/u

/** The text's head (its first non-empty lines, as captionOf reads them) and its name block's first and last line (-1: none). legal@0.5.2 (`vendor`) skips a vendor's own lines (above). */
function headAndNameBlock(text: string, L: typeof CAPTION_LIMITS, vendor = false): { head: string[]; from: number; to: number; name: string | undefined } {
  const head: string[] = []
  let flag = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length === 0) continue
    if (line.length > L.bodyLineChars) break
    if (vendor && (VENDOR_HEAD_LINE.test(line) || (flag && KEYCITE_TREATMENT.test(line)))) { flag = flag || /^KeyCite\b/u.test(line); continue }
    head.push(line)
    if (head.length >= L.headLines) break
  }
  const prose = proseLine
  // the name block
  let from = -1, to = -1, name: string | undefined
  for (let i = 0; i < head.length && from < 0; i++) {
    const l = head[i] as string
    if (prose(l)) continue
    if (LONE_V.test(l) && i > 0 && i + 1 < head.length && !prose(head[i - 1] as string) && !prose(head[i + 1] as string)) {
      from = i - 1; to = i + 1
      name = `${shortParty(head[i - 1] as string)} v. ${shortParty(head[i + 1] as string)}`
    } else if (IN_RE.test(l)) {
      from = i; to = i
      name = shortParty(l)
    } else {
      const m = SEPARATOR.exec(l)
      if (m && (l.slice(0, m.index).trim().match(/\S+/g) ?? []).length <= L.partyWords) {
        from = i; to = i
        name = `${shortParty(l.slice(0, m.index))} v. ${shortParty(l.slice(m.index + m[0].length))}`
      }
    }
  }
  if (from >= 0) {
    const continues = (l: string): boolean => /(?:,|&|\band)$/i.test(l)
    for (let k = 0; k < 2 && from > 0 && continues(head[from - 1] as string) && !prose(head[from - 1] as string); k++) from--
    for (let k = 0; k < 2 && to + 1 < head.length && continues(head[to] as string) && !prose(head[to + 1] as string) && !CITE_IN_LINE.test(head[to + 1] as string); k++) to++
    // a party wrapped onto the line above or below: the name reads from the whole block
    const block = head.slice(from, to + 1).join(' ')
    const m = SEPARATOR.exec(block)
    if (m && !IN_RE.test(block)) name = `${shortParty(block.slice(0, m.index))} v. ${shortParty(block.slice(m.index + m[0].length))}`
  }
  return { head, from, to, name }
}

/**
 * legal@0.5.0 (2026-10-05, cold-review round 5): the citation lines of a Lexis header's "Reporter" block. A Lexis download prints the case
 * name, the tribunal, the dates and the docket, then a line that is only "Reporter", then the case's own citation line ("477 U.S. 317
 * *; 106 S. Ct. 2548 **; 91 L. Ed. 2d 265 ***"), several lines below the case name and outside legal@0.4.0's caption window: all
 * eight of a cold reader's (an AI agent's) Celotex citations were refused until the text was edited, and then its sha256 no longer matched
 * the vendor's file. The block is read in the header only: from the top of the text to the first opinion heading ("Opinion", a line
 * saying who delivered the opinion), at most 60 non-empty lines. The one or two lines right after "Reporter" that carry a reporter
 * citation, and hold no sentence, are caption citation lines. Nothing else in the header binds (a "Disposition:" or "Prior
 * History:" line names the decision below, another opinion).
 */
export function reporterBlockLines(text: string): string[] {
  const out: string[] = []
  let seen = 0
  const lines = text.split(/\r\n|\r|\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 0)
  for (let i = 0; i < lines.length && seen < 60; i++, seen++) {
    const l = lines[i] as string
    if (/^(?:opinion|opinion of the court|majority opinion)$/i.test(l) || /\bdeliv\S{0,3}red\s+the\s+opinion\s+of\s+the\s+court\b/i.test(l)) break
    if (!/^reporter:?$/i.test(l)) continue
    // a citation line starts with its volume ("477 U.S. 317 *; …"); a labelled line after it ("Disposition: 244 U.S. App. D.C. 160,
    // 756 F.2d 181, reversed") names another opinion and ends the block
    for (let k = i + 1; k < lines.length && k <= i + 2; k++) {
      const c = lines[k] as string
      if (!/^\d/.test(c) || c.length > CAPTION_LIMITS.bodyLineChars || proseLine(c) || !CITE_IN_LINE.test(c)) break
      out.push(c)
    }
    break
  }
  return out
}

/**
 * legal@0.5.2 (2026-10-06): the citation lines under a Westlaw download's "All Citations" heading, at its end ("509 U.S. 579, 113 S.Ct.
 * 2786, 125 L.Ed.2d 469"): the download naming itself, as a slip opinion's "Cite as:" line does. A download that opens on its KeyCite
 * flag prints the reporter citation nowhere else. The one or two lines right after the heading that start with a volume number and
 * carry a reporter citation, and hold no sentence.
 */
export function allCitationsLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 0)
  const out: string[] = []
  const at = lines.findIndex(l => /^all\s+citations:?$/iu.test(l))
  if (at < 0) return out
  for (let k = at + 1; k < lines.length && k <= at + 2; k++) {
    const c = lines[k] as string
    if (!/^\d/.test(c) || c.length > CAPTION_LIMITS.bodyLineChars || proseLine(c) || !CITE_IN_LINE.test(c)) break
    out.push(c)
  }
  return out
}

/**
 * The text's caption (legal@0.3.0), or undefined when its head has neither a case-name line nor a caption citation. legal@0.5.0
 * (`opts.reporterBlock`) adds a Lexis "Reporter" block's citation lines (reporterBlockLines). legal@0.5.2 (`opts.vendor`) skips a
 * vendor's own lines at the head (VENDOR_HEAD_LINE), and (`opts.allCitations`) adds the "All Citations" lines (allCitationsLines).
 */
export function captionOf(text: string, L: typeof CAPTION_LIMITS = CAPTION_LIMITS, opts: { reporterBlock?: boolean; vendor?: boolean; allCitations?: boolean; databaseNumbers?: boolean } = {}): Caption | undefined {
  const { head, from, to, name } = headAndNameBlock(text, L, opts.vendor === true)
  const prose = proseLine
  // legal@0.5.4 (`databaseNumbers`): a Westlaw or Lexis database number is a citation line too (CITE_IN_LINE_054)
  const CITE = opts.databaseNumbers ? CITE_IN_LINE_054 : CITE_IN_LINE
  // the citation lines
  const citeLines: string[] = []
  for (let i = 0; i < head.length; i++) {
    const l = head[i] as string
    if (prose(l) || !CITE.test(l)) continue
    const near = from >= 0 ? i >= from - L.citeAbove && i <= to + L.citeBelow : i < 2
    if (near || CITE_AS.test(l)) citeLines.push(l)
  }
  if (opts.reporterBlock) for (const l of reporterBlockLines(text)) if (!citeLines.includes(l)) citeLines.push(l)
  if (opts.allCitations && from >= 0) for (const l of allCitationsLines(text)) if (!citeLines.includes(l)) citeLines.push(l)
  // a "Cite as" line anywhere in the text is the text naming itself (a slip opinion prints it atop every page after the first)
  if (!citeLines.some(l => CITE_AS.test(l))) {
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const l = raw.replace(/\s+/g, ' ').trim()
      if (CITE_AS.test(l) && l.length <= L.bodyLineChars && !prose(l) && CITE.test(l)) { citeLines.push(l); break }
    }
  }
  if (from < 0 && citeLines.length === 0) return undefined
  const cite = citeLines.length > 0 ? (CITE.exec(citeLines[0] as string)?.[0] ?? '').replace(/\s+/g, ' ').trim() : undefined
  return {
    ...(name !== undefined && name.replace(/[^\p{L}]/gu, '').length > 0 ? { name } : {}),
    ...(cite ? { cite } : {}),
    names: from >= 0 ? head.slice(from, to + 1).join('\n') : '',
    cites: citeLines.join('\n'),
  }
}

/**
 * legal@0.4.0: a head line that prints `cite`, outside the caption window (more than CAPTION_LIMITS.citeAbove lines above the name
 * block, or more than citeBelow below it): how many lines from the case name, and which way; undefined when there is none (or no
 * name block). A Lexis download prints "Reporter" and the citation several lines below the case name; the abstention says so
 * instead of "the text cites it in its body".
 */
export function citeLineOutside(text: string, cite: string, L: typeof CAPTION_LIMITS = CAPTION_LIMITS, vendor = false): { lines: number; at: 'below' | 'above' } | undefined {
  const { head, from, to } = headAndNameBlock(text, L, vendor)
  if (from < 0) return undefined
  for (let i = 0; i < head.length; i++) {
    if (i >= from - L.citeAbove && i <= to + L.citeBelow) continue
    const l = head[i] as string
    if (proseLine(l) || !CITE_IN_LINE.test(l) || !citeNamed(l, cite).found) continue
    return i > to ? { lines: i - to, at: 'below' } : { lines: from - i, at: 'above' }
  }
  return undefined
}

/** legal@0.3.0's naming: what the CAPTION names (captionOf), with the caption recorded and whether the body alone names it. legal@0.4.0
 *  (`v040`) also records a citation line printed in the head outside the caption window (citeLineOutside). */
export function captionNamingOf(claimId: string, c: { cite?: string; case_name?: string }, text: string, mode: BindMode = 'strict', v040 = false, v050 = false, v052 = false, v054 = false): CiteNaming {
  const cite = typeof c.cite === 'string' && c.cite.trim().length > 0 ? c.cite.trim() : undefined
  const caseName = typeof c.case_name === 'string' && c.case_name.trim().length > 0 ? c.case_name.trim() : undefined
  // legal@0.5.2: a vendor's own head lines skipped, and the "All Citations" block read (VENDOR_HEAD_LINE, allCitationsLines); legal@0.5.4
  // (`v054`): a Westlaw or Lexis database number is a citation line (CITE_IN_LINE_054)
  const db = v054 ? { databaseNumbers: true } : {}
  const cap = captionOf(text, CAPTION_LIMITS, v052 ? { reporterBlock: true, vendor: true, allCitations: true, ...db } : v050 ? { reporterBlock: true } : {})
  const out: CiteNaming = { claim_id: claimId, bound: false, by: 'caption', caption: cap ? { ...(cap.name !== undefined ? { name: cap.name } : {}), ...(cap.cite !== undefined ? { cite: cap.cite } : {}) } : null }
  if (cite !== undefined) {
    const hit = cap && cap.cites.length > 0 ? citeNamed(cap.cites, cite) : { found: false }
    out.cite = { asked: cite, found: hit.found, ...(hit.form !== undefined ? { form: hit.form } : {}) }
    // legal@0.5.0: say when only the Lexis "Reporter" block names it; legal@0.5.2, also when only the "All Citations" block does
    if (v050 && hit.found) {
      const named = (x: Caption | undefined): boolean => x !== undefined && x.cites.length > 0 && citeNamed(x.cites, cite).found
      if (!v052) {
        if (!named(captionOf(text))) out.reporter_block = true
      } else if (!named(captionOf(text, CAPTION_LIMITS, { vendor: true, ...db }))) {
        if (named(captionOf(text, CAPTION_LIMITS, { vendor: true, reporterBlock: true, ...db }))) out.reporter_block = true
        else out.all_citations = true
      }
    }
  }
  if (caseName !== undefined) out.parties = partiesOf(caseName).map(party => ({ party, found: cap && cap.names.length > 0 ? partyNamedInCaption(cap.names, party) : null }))
  out.bound = (cite !== undefined || caseName !== undefined) && (out.cite?.found ?? true) && (out.parties ?? []).every(p => p.found !== null)
  if (!out.bound && mode === 'parties' && out.cite !== undefined && !out.cite.found && out.parties !== undefined && out.parties.length > 0 && out.parties.every(p => p.found !== null)) {
    out.bound = true
    out.tier = 'parties-only'
    out.note = PARTIES_ONLY_NOTE_V030
  }
  // the body names what the caption does not: an opinion that cites the case (said in the abstention, never a binding)
  if (!out.bound) {
    const body = namingOf(claimId, c, text, 'strict')
    if (body.bound) out.mentioned = true
  }
  if (v040 && out.cite !== undefined && !out.cite.found && (!out.bound || out.tier === 'parties-only')) {
    const line = citeLineOutside(text, out.cite.asked, CAPTION_LIMITS, v052)
    if (line !== undefined) out.cite_line = line
  }
  return out
}

/** The citation as a reader names it: case name and reporter citation, whichever are given. */
export function citeNameOf(c: { id: string; cite?: string; case_name?: string }): string {
  const parts = [c.case_name, c.cite].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim())
  return parts.length > 0 ? parts.join(', ') : c.id
}

/** What the text does not name, in words, for the abstention. */
export function unnamedOf(n: CiteNaming): string[] {
  const out: string[] = []
  if (n.cite && !n.cite.found) out.push(`the reporter citation ${n.cite.asked}`)
  for (const p of n.parties ?? []) if (p.found === null) out.push(`the party ${p.party}`)
  if (!n.cite && !n.parties) out.push('any authority (the citation gives no case name and no reporter citation)')
  return out
}

/**
 * The provenance block for every supplied text, sorted by key: independent of the order the caller listed them in. legal@0.5.0
 * (`sectionsFor`) also records the sections read in each text that a citation was checked against.
 */
export function provenanceOf(sources: Record<string, unknown>, namings: { key: string; naming: CiteNaming }[], sectionsFor?: (text: string) => OpinionProvenance['sections']): OpinionProvenance[] {
  const out: OpinionProvenance[] = []
  // each text's namings, in their order, grouped by key once (2026-10-20: it was a pass over every naming for every key)
  const namesOf = new Map<string, CiteNaming[]>()
  for (const n of namings) {
    const list = namesOf.get(n.key)
    if (list === undefined) namesOf.set(n.key, [n.naming])
    else list.push(n.naming)
  }
  for (const key of Object.keys(sources).sort()) {
    const s = sources[key]
    const text = textOf(s)
    if (text === undefined) continue
    const o = (s !== null && typeof s === 'object' ? s : {}) as OpinionText
    out.push({
      key, sha256: sha256(text), chars: text.length,
      ...(typeof o.source === 'string' ? { source: o.source } : {}),
      ...(typeof o.url === 'string' ? { url: o.url } : {}),
      ...(typeof o.retrieved_at === 'string' ? { retrieved_at: o.retrieved_at } : {}),
      ...(o.bind === 'parties' || o.bind === 'strict' ? { bind: o.bind } : {}),
      names: namesOf.get(key) ?? [],
    })
    const sections = sectionsFor !== undefined && namesOf.has(key) ? sectionsFor(text) : undefined
    if (sections !== undefined && sections.length > 0) (out[out.length - 1] as OpinionProvenance).sections = sections
  }
  return out
}
