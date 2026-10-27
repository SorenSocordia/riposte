/**
 * legal@0.5.0 (2026-10-05, cold-review round 5): the sections of a supplied opinion text.
 *
 * Why: a Westlaw or Lexis download, and a public archive's text of an opinion, carries more than the opinion. Before the opinion
 * there is the publisher's editorial matter (a synopsis, headnotes, a case summary, core terms, the reporter's syllabus, the
 * counsel and judges listings); after it there may be concurring and dissenting opinions. legal@0.4.0 asked only "are the quoted
 * words in the supplied text", so words from a West headnote, a Lexis headnote, the syllabus or a dissent passed as "verbatim"
 * (a cold reader's (an AI agent in a legal-operations director's role) fourth-round probe). legal@0.5.0 reads where each part of the text begins and checks a
 * quotation against the majority opinion's words; words found only elsewhere are named by where they are, never passed.
 *
 * The reading, line by line (a heading is matched with any star paging before it read out, "**2507 *242 Syllabus"):
 *   - EDITORIAL headings start the publisher's or reporter's matter: "Synopsis" (its "Background:" and "Holdings:" belong to it),
 *     "West Headnotes", "Headnotes", "LexisNexis® Headnotes", "Case Summary", "Summary", "Core Terms", "Syllabus", "Counsel",
 *     "Attorneys and Law Firms", "West Codenotes", "All Citations", "End of Document"; and, written inline with text after the
 *     colon only, "Counsel:", "Judges:", "Disposition:", "Prior History:", "Subsequent History:", "Procedural Posture:",
 *     "Overview:", "Outcome:", "Dissent by:", "Concur by:" (a bare "Disposition" heading is a section of some opinions). A
 *     heading starts with a capital, and the line above does not end with a comma or a hyphen (a hard-wrapped body line is not one);
 *   - the MAJORITY opinion starts at an "Opinion" heading ("Opinion of the Court", "OPINION ____", "Opinion by:", "Per Curiam"),
 *     at a short line that begins with who "delivered the opinion of the Court" or "announced the judgment of the Court" (never a
 *     sentence that mentions it, never a syllabus's "Black, J., delivered …" summary), or at "NAME, Circuit Judge:";
 *   - a SEPARATE opinion starts at its designation, on one line or up to three short ones: "Justice BRENNAN, dissenting.",
 *     "Mr. Justice Stewart, / with whom Mr. Justice Brennan and Mr. Justice Marshall join, / dissenting.", "THE CHIEF JUSTICE,
 *     concurring in the judgment.", "SMITH, Circuit Judge, dissenting:", a "Dissent" or "Concurrence" heading, or "Separate
 *     opinion of"; after the majority has started, also a line that is only "Mr. Justice Douglas." or "Mr. Justice Roberts:";
 *   - "Footnotes": when a separate opinion came before it, the footnotes cannot be assigned to one opinion and are a section of
 *     their own; otherwise they belong to the opinion before them.
 * Each section runs to the next start. What precedes the first start is the HEADER (the caption, the tribunal, the docket, the
 * dates) when that start is editorial matter or the majority opinion, and the majority opinion when it is a separate opinion (a
 * text that begins with the opinion and carries a dissent after it). A text with no start at all is read whole, as the opinion,
 * exactly as legal@0.4.0 read it.
 *
 * Reading too little as the majority opinion is the safe side: a genuine quotation from a part read as editorial answers can't
 * tell, never FAIL; a quotation from editorial matter can never pass as the majority's words.
 *
 * Pure and deterministic: no I/O, no clock. Changing a heading list or a pattern is a new ruleset version.
 *
 * legal@0.5.3 (`v053`, 2026-10-13): a designation is who wrote the opinion, then whatever stands between (a join clause, a part list; no
 * sentence end), then its role at the line's end, so "Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV,
 * dissenting." starts a separate opinion (BETWEEN_053); the opinion is named by its role as printed (roleName053).
 */

export type SectionKind = 'header' | 'editorial' | 'majority' | 'separate' | 'footnotes'

/** One section of a supplied text: its kind, how an answer names it, and where it lies (character offsets, 1-based lines). */
export interface Section {
  kind: SectionKind
  /** "the West headnotes", "the syllabus", "Justice Brennan's dissent", "the majority opinion", "the header above the opinion" */
  name: string
  /** a separate opinion: its author's surname as printed, read the way a reader writes it ("Brennan"); absent when not printed */
  author?: string
  /** a separate opinion: a dissent, a concurrence, an opinion concurring in part and dissenting in part, or a separate opinion */
  role?: 'dissent' | 'concurrence' | 'concurrence-dissent' | 'separate'
  start: number
  end: number
  line: number
  last_line: number
}

/** The sections of a text. `recognized` false: no start was found and the text is read whole, as the opinion. */
export interface TextSections {
  recognized: boolean
  sections: Section[]
  /** legal@0.5.2: the lead opinion is a plurality opinion, wholly or in some of its parts (pluralityOf) */
  plurality?: Plurality
}

/**
 * legal@0.5.2 (2026-10-06): a plurality. A lead opinion that "announced the judgment of the Court" and delivered no opinion of the Court
 * is a plurality opinion throughout (`whole`); one that delivered "the opinion of the Court with respect to Parts I and II, and an
 * opinion with respect to Part III, in which …" is the Court's only in the parts it names (`parts`). legal@0.5.1 called every part of a
 * lead opinion "the majority opinion" (a cold reader's probe; an AI agent, not a person). The designation is read on the lines that
 * start the majority opinion; the parts are the lines of the lead opinion that are only a part number ("III", "II-A", or a letter
 * under a number).
 */
export interface Plurality {
  kind: 'whole' | 'parts'
  /** the designation as printed (spacing collapsed) and its 1-based line */
  designation: string
  line: number
  /** the parts the designation makes the Court's, and the parts it does not ("I", "II-A") */
  court: string[]
  plurality: string[]
  /** the numbered parts of the lead opinion, by offset */
  parts: { label: string; start: number; end: number }[]
}

const PART_LIST = /(?<![\p{L}])([IVXL]{1,6}(?:[-–][A-H](?:[-–]\d{1,2})?)?)(?![\p{L}])/gu
const partsIn = (s: string): string[] => [...s.matchAll(PART_LIST)].map(m => (m[1] as string).replace('–', '-'))

/**
 * legal@0.5.2: the plurality the lead opinion's designation states (above), or undefined. legal@0.5.5 (`v055`, 2026-10-19) reads two more
 * forms a cold review found named "the majority opinion" (an AI agent in a legal-operations role, not a person): a heading "OPINION
 * ANNOUNCING THE JUDGMENT OF THE COURT" (a state reporter's form), and a plurality stated only in a Lexis header's "Judges:" line ("ODUYA,
 * J., announced the judgment of the Court and delivered an opinion, in which …"), read when the lead opinion's first lines state none.
 */
export function pluralityOf(text: string, sections: readonly Section[], v055 = false): Plurality | undefined {
  const lead = sections.filter(s => s.kind === 'majority')
  if (lead.length === 0) return undefined
  const lines = linesOf(text)
  const first = lead[0] as Section
  let found: { designation: string; line: number; kind: Plurality['kind']; court: string[]; plurality: string[] } | undefined
  const PLURAL = v055
    ? /announced\s+the\s+judgment\s+of\s+the\s+court|delivered\s+an\s+opinion|an\s+opinion\s+with\s+respect\s+to|opinion\s+of\s+the\s+court,?\s+except\s+as\s+to|opinion\s+announcing\s+the\s+judgment/iu
    : /announced\s+the\s+judgment\s+of\s+the\s+court|delivered\s+an\s+opinion|an\s+opinion\s+with\s+respect\s+to|opinion\s+of\s+the\s+court,?\s+except\s+as\s+to/iu
  const read = (b: string, line: number): typeof found => {
    if (/^plurality\s+opinion\b/iu.test(b)) return { designation: b, line, kind: 'whole', court: [], plurality: [] }
    if (!PLURAL.test(b)) return undefined
    const ofCourt = /\bthe\s+opinion\s+of\s+the\s+court\b/iu.test(b)
    if (!ofCourt) return { designation: b, line, kind: 'whole', court: [], plurality: [] }
    const court = /\bopinion\s+of\s+the\s+court\s+with\s+respect\s+to\s+([^;]*?)(?:,\s*(?:in\s+which|and\s+an\s+opinion)|\.|$)/iu.exec(b)?.[1]
    const plural = /\ban\s+opinion\s+with\s+respect\s+to\s+([^;]*?)(?:,\s*in\s+which|\.|$)/iu.exec(b)?.[1]
    const except = /\bopinion\s+of\s+the\s+court,?\s+except\s+as\s+to\s+([^;]*?)(?:,\s*in\s+which|\.|$)/iu.exec(b)?.[1]
    const pl = [...(plural ? partsIn(plural) : []), ...(except ? partsIn(except) : [])]
    return pl.length > 0 ? { designation: b, line, kind: 'parts', court: court ? partsIn(court) : [], plurality: pl } : undefined
  }
  // the designation: one of the first few lines of the lead opinion that says who announced the judgment or delivered an opinion
  for (let i = first.line - 1, n = 0; i < lines.length && n < 6 && lines[i]!.start < first.end; i++) {
    const b = bareOf(lines[i]!.text)
    if (b.length === 0) continue
    n++
    if (b.length > 700) break
    found = read(b, i + 1)
    if (found) break
  }
  // legal@0.5.5: a Lexis header's "Judges:" line, before the lead opinion, when the lead opinion's own lines state none
  if (!found && v055) {
    for (const s of sections) {
      if (s.start >= first.start) break
      if (s.kind !== 'editorial' || s.name !== 'the judges listing') continue
      const b = bareOf(lines[s.line - 1]!.text)
      if (b.length <= 700) found = read(b, s.line)
      if (found) break
    }
  }
  if (!found) return undefined
  // the numbered parts of the lead opinion: a line that is only a part number, or a letter under one
  const parts: Plurality['parts'] = []
  let numeral: string | undefined
  for (const s of lead) {
    for (const l of lines) {
      if (l.start < s.start || l.start >= s.end) continue
      const b = bareOf(l.text).replace(/\.$/, '')
      const whole = /^(?:Part\s+)?([IVXL]{1,6})(?:[-–]([A-H]))?$/u.exec(b)
      const letter = numeral !== undefined ? /^([A-H])$/u.exec(b) : null
      if (!whole && !letter) continue
      if (whole) numeral = whole[1] as string
      const label = whole ? (whole[2] !== undefined ? `${whole[1]}-${whole[2]}` : whole[1] as string) : `${numeral}-${(letter as RegExpExecArray)[1]}`
      const prev = parts[parts.length - 1]
      if (prev) prev.end = l.start
      parts.push({ label, start: l.start, end: s.end })
    }
  }
  return { ...found, parts }
}

/**
 * legal@0.5.2: what the plurality says of offset `at` in the lead opinion: the part it lies in (or none, before the first numbered part)
 * and whether the designation makes that part the Court's (`court`), not the Court's (`plurality`), or names neither (`unassigned`).
 */
export function pluralityAt(p: Plurality, at: number): { part?: string; status: 'court' | 'plurality' | 'unassigned' } {
  let part: string | undefined
  for (const x of p.parts) if (x.start <= at && at < x.end) part = x.label
  if (p.kind === 'whole') return { ...(part !== undefined ? { part } : {}), status: 'plurality' }
  if (part === undefined) return { status: 'unassigned' }
  const numeral = part.split('-')[0] as string
  const has = (list: string[]): boolean => list.includes(part as string) || list.includes(numeral)
  return { part, status: has(p.plurality) ? 'plurality' : has(p.court) ? 'court' : 'unassigned' }
}

interface Line { text: string; start: number; end: number; no: number }

function linesOf(text: string): Line[] {
  const out: Line[] = []
  const re = /\r\n|\r|\n/g
  let at = 0
  let no = 1
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push({ text: text.slice(at, m.index), start: at, end: m.index, no })
    at = m.index + m[0].length
    no++
  }
  out.push({ text: text.slice(at), start: at, end: text.length, no })
  return out
}

/** A line with star paging before it read out, its spacing collapsed: "**2507 *242 Syllabus" → "Syllabus". */
const bareOf = (s: string): string => s.replace(/^\s*(?:(?:\[\*{1,4}\d{1,5}\]|\*{1,4}\d{1,5})\s*)+/u, '').replace(/\s+/g, ' ').trim()
/**
 * A heading's key: lower case; a rule printed after it ("OPINION ______"), a note mark ("SUMMARY*"), a count "(12)" and a closing
 * colon dropped. A closing period is kept: a hard-wrapped body line "disposition." is not a heading.
 */
const keyOf = (bare: string): string => bare.replace(/[\s_=*~—–-]{3,}$/u, '').replace(/[*†‡]+$/u, '').replace(/\s*\((?:\d{1,3}|s)\)\s*$/i, '').replace(/:$/, '').trim().toLowerCase()

const EDITORIAL: Record<string, string> = {
  'synopsis': 'the synopsis',
  'west headnotes': 'the West headnotes',
  'headnotes': 'the headnotes',
  'lexisnexis® headnotes': 'the LexisNexis headnotes',
  'lexisnexis headnotes': 'the LexisNexis headnotes',
  'lexis headnotes': 'the LexisNexis headnotes',
  'case summary': 'the case summary',
  'summary': 'the summary',
  'core terms': 'the core terms',
  'syllabus': 'the syllabus',
  'counsel': 'the counsel listing',
  'attorneys and law firms': 'the counsel listing',
  'west codenotes': 'the West codenotes',
  'all citations': 'the citation list',
  'end of document': 'the end matter',
}
/**
 * Labels that start editorial matter only written inline, with text after the colon ("Disposition: 244 U.S. App. D.C. 160 …",
 * "Counsel: Robert Smith argued …"): a bare "Disposition" or "Overview" heading is a section of some majority opinions.
 */
const INLINE_EDITORIAL: Record<string, string> = {
  'counsel': 'the counsel listing', 'attorneys and law firms': 'the counsel listing', 'judges': 'the judges listing',
  'prior history': 'the case history', 'subsequent history': 'the case history', 'disposition': 'the disposition line',
  'procedural posture': 'the procedural posture', 'procedural postures': 'the procedural posture', 'procedural posture(s)': 'the procedural posture',
  'overview': 'the case summary', 'outcome': 'the case summary', 'core terms': 'the core terms', 'case summary': 'the case summary',
  'dissent by': 'the header above the opinion', 'concur by': 'the header above the opinion',
}
/**
 * legal@0.5.1: a Lexis "Dissent by:" or "Concur by:" line is named for what it is. legal@0.5.0 named it "the header above the opinion",
 * which is wrong where it follows the majority opinion (a reader's report: "Dissent by: SOUTER; BREYER" read as the header, lines 59-60).
 */
const INLINE_EDITORIAL_051: Record<string, string> = { ...INLINE_EDITORIAL, 'dissent by': 'the "Dissent by" line', 'concur by': 'the "Concur by" line' }
const MAJORITY_HEADINGS = new Set(['opinion', 'opinion of the court', 'majority opinion', 'per curiam', 'opinion by'])
const SEPARATE_HEADINGS: Record<string, Section['role']> = {
  'dissent': 'dissent', 'dissenting opinion': 'dissent', 'dissents': 'dissent',
  'concurrence': 'concurrence', 'concur': 'concurrence', 'concurring opinion': 'concurrence', 'concurrences': 'concurrence',
  'separate opinion of': 'separate', 'separate opinion': 'separate',
}

/**
 * The line that starts the majority opinion: it begins with who wrote it, or with what a two-line designation leaves on its second
 * line ("Mr. Justice Field / delivered the opinion of the court.", "… / after stating the case, delivered the opinion of the court.").
 * A sentence that mentions who delivered an opinion is never a start.
 */
const DELIVERED = /^(?:(?:\S{1,4}\s+)?(?:(?:the\s+)?chief\s+)?justic\S{0,3}(?:\s+[\p{L}'’\-]+)?,?\s+)?(?:after\s+stating\s+the\s+case[^,]{0,40},\s+)?(?:deliv\S{0,3}red\s+the\s+opinion\s+of\s+the\s+court|announced\s+the\s+judgment\s+of\s+the\s+court)\b|^opinion\s+of\s+the\s+court\s+by\b|^per\s+curiam\b/iu
const CIRCUIT_MAJORITY = /^[\p{L}][\p{L}'’.\- ]{1,40},\s+(?:(?:chief|senior)\s+)?(?:circuit|district)\s+judge\s*:$/iu
/**
 * legal@0.5.5 (2026-10-19): where a district court's slip opinion begins. legal@0.5.4 started the majority only at "NAME, District Judge:" with
 * its colon, so a Westlaw slip copy whose body follows "MEMORANDUM OPINION AND ORDER" and "CORDELL, District Judge" (no colon), "JANE M.
 * CORDELL, United States District Judge" or "CORDELL, J." read every quotation as "in the counsel listing", can't tell (a cold review; an AI
 * agent in a legal-operations buyer's role, not a person; the layout was typed from memory, not taken from a real download). Before any
 * majority has started, legal@0.5.5 starts one at a district court's own heading (DISTRICT_HEADINGS_055) or at a line that is only a judge's
 * name and title, with or without a colon or a period (JUDGE_LINE_055). After the majority has started, such a line is read as before (a signature).
 */
const DISTRICT_HEADINGS_055 = new Set(['memorandum opinion and order', 'memorandum opinion', 'memorandum and order', 'memorandum decision and order', 'memorandum decision', 'memorandum and opinion', 'memorandum opinion & order', 'opinion and order', 'opinion & order', 'order and opinion', 'order and reasons', 'decision and order', 'order', 'findings of fact and conclusions of law', 'opinion announcing the judgment of the court', 'plurality opinion'])
const JUDGE_LINE_055 = /^[\p{L}][\p{L}'’.\- ]{1,60},\s+(?:(?:chief|senior)\s+)?(?:(?:united\s+states|u\.\s?s\.)\s+)?(?:(?:chief|senior)\s+)?(?:circuit|district|bankruptcy)\s+judge\s*[.:]?$|^[\p{L}][\p{L}'’.\-]{1,40}(?:\s+[\p{L}][\p{L}'’.\-]*){0,3},\s+(?:c\.\s?)?j\.\s*:?$/iu
/** a syllabus's closing summary of who wrote what ("Black, J., delivered the opinion of the Court, in Part I of which …") */
const SYLLABUS_SUMMARY = /^[\p{L}'’\-]+,\s+(?:C\.\s?)?JJ?\.,/u
/** who joins, between the author and the role: ", with whom Mr. Justice Brennan and Mr. Justice Marshall join," */
const WHOM = String.raw`(?:(?:with\s+)?whom\s+.{1,200}?\s+join(?:s|ed)?(?:\s+in\s+[^,.]{1,80})?\s*,\s*)?`
/** the role and what may follow it: "dissenting", "concurring in the judgment", "concurring in part and dissenting in part", "dissenting in No. 70-57, …" */
const ROLE = String.raw`(dissenting|concurring)(?:\s+in\s+(?:(?:part|the\s+judgment|judgment|the\s+result|result)\b|nos?\.).{0,100})?\s*[.:]?\s*$`
const JUSTICE_ROLE = new RegExp(String.raw`^(?:\S{1,4}\s+)?((?:the\s+)?chief\s+)?justic\S{0,3}(?:\s+([\p{L}'’\-]+))?\s*,?\s*${WHOM}${ROLE}`, 'iu')
const JUDGE_ROLE = new RegExp(String.raw`^([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,2}),\s+(?:(?:chief|senior)\s+)?(?:circuit\s+judge|district\s+judge|judge|j\.|c\.\s?j\.)\s*,?\s*${WHOM}${ROLE}`, 'iu')
/**
 * legal@0.5.3 (2026-10-13): what may stand between the author and the role. legal@0.5.2 read only "with whom … join(s) [in …],", so
 * "Justice STEVENS, with whom Justice GINSBURG joins except as to Part IV, dissenting." (Twombly's own designation), "joins as to Parts
 * I and II," and "joins as to all but Part II-B," started no separate opinion and the dissent's words passed as the majority's (two cold
 * reviews; AI agents, not people). legal@0.5.3 reads any stretch set off by commas between who wrote the opinion and its role, so long
 * as it holds no sentence end ("with whom …", "joined by …", a part list): a line shaped like a designation always starts one.
 */
const BETWEEN_053 = String.raw`(?:(?:[^.]|(?<=(?:^|[^\p{L}])(?:J|JJ|C|Mr|Mrs|Ms|No|Nos|Pt|Pts))\.){1,300}?\s*,\s*)?`
const JUSTICE_ROLE_053 = new RegExp(String.raw`^(?:\S{1,4}\s+)?((?:the\s+)?chief\s+)?justic\S{0,3}(?:\s+([\p{L}'’\-]+))?\s*,?\s*${BETWEEN_053}${ROLE}`, 'iu')
const JUDGE_ROLE_053 = new RegExp(String.raw`^([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,2}),\s+(?:(?:chief|senior)\s+)?(?:circuit\s+judge|district\s+judge|judge|j\.|c\.\s?j\.)\s*,?\s*${BETWEEN_053}${ROLE}`, 'iu')
/**
 * legal@0.5.3: a separate opinion is named by its role as printed, so "concurring in the judgment and dissenting in part" is never named
 * "concurring in part and dissenting in part" (a cold review's note): "dissenting" → "dissent", "concurring" → "concurrence", any longer
 * role → "opinion <role>" ("opinion concurring in part and concurring in the judgment").
 */
const ROLE_AT_END = new RegExp(ROLE, 'iu')
/** legal@0.5.3: where the role the designation ends with begins (the earliest "dissenting" or "concurring" that runs to the line's end). */
function lastRoleAt(joined: string): number {
  return ROLE_AT_END.exec(joined)?.index ?? joined.search(/dissenting|concurring/i)
}
function roleName053(roleWords: string): string {
  const w = roleWords.replace(/[.:]\s*$/u, '').split(',')[0]!.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
  return w === 'dissenting' ? 'dissent' : w === 'concurring' ? 'concurrence' : `opinion ${w}`
}

/**
 * legal@0.5.4 (2026-10-14): six designation styles a cold review (an AI agent in a legal-operations role, not a person) found passing a
 * dissent's words as the majority's under legal@0.5.3: "Dissenting Opinion by Judge Molina", "Judge MOLINA, dissenting.", "MOLINA, J.
 * (dissenting):", "MOLINA, J., dissents and votes to reverse in the following opinion:", "MOLINA, Circuit Judge, dissenting from the
 * denial of rehearing en banc:", "I respectfully dissent.". The rule is the reviewer's: a short line of its own that designates a separate
 * opinion ends the majority, whatever its form (fail closed). The role may stand in parentheses and go on with "from" or "as to"; the
 * title may come before the name; the role may be a verb ("dissents", "concurs"); a dissent may announce itself in the first person.
 */
const ROLE_054 = String.raw`\(?\s*(dissenting|concurring)(?:\s+(?:in|from|as\s+to|with\s+respect\s+to)\b.{0,100}?)?\s*\)?\s*[.:]?\s*$`
const JUSTICE_ROLE_054 = new RegExp(String.raw`^(?:\S{1,4}\s+)?((?:the\s+)?chief\s+)?justic\S{0,3}(?:\s+([\p{L}'’\-]+))?\s*,?\s*${BETWEEN_053}${ROLE_054}`, 'iu')
const JUDGE_ROLE_054 = new RegExp(String.raw`^([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,2}),\s+(?:(?:chief|senior)\s+)?(?:circuit\s+judge|district\s+judge|judge|j\.|c\.\s?j\.)\s*,?\s*${BETWEEN_053}${ROLE_054}`, 'iu')
/** the title before the name: "Judge MOLINA, dissenting.", "Chief Judge SMITH, concurring in the judgment:" */
const TITLE_FIRST_054 = new RegExp(String.raw`^(?:(?:chief|senior|circuit|district|presiding)\s+)?judge\s+([\p{L}'’\-]+)\s*,?\s*${BETWEEN_053}${ROLE_054}`, 'iu')
/** the role as a verb (a New York style): "MOLINA, J., dissents and votes to reverse in the following opinion:" */
const VERB_054 = /^([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}'’\-]+){0,2}),\s+(?:(?:chief|senior)\s+)?(?:circuit\s+judge|district\s+judge|judge|j\.|jj\.|c\.\s?j\.)\s*,?\s+(dissents?|concurs?|dissented|concurred)(?![\p{L}])[^.]{0,160}[.:]?$/iu
/** a dissent announced in the first person, on a line of its own: "I respectfully dissent.", "I dissent in part." */
const I_DISSENT_054 = /^I\s+(?:(?:respectfully|must|therefore|also|would|accordingly)\s+)*(dissent|concur)(?:\s+in\s+(?:part|the\s+judgment|the\s+result))?(?:\s+(?:from|as\s+to)\b[^.]{0,80})?\.?$/iu
/** a heading that names the author: "Dissenting Opinion by Judge Molina", "Dissent of Justice Roe", "Concurring Opinion of SMITH, J." */
const HEADING_BY_054 = /^(dissenting|concurring|dissent|concurrence)(?:\s+opinion)?\s+(?:by|of)\s+(.{1,80})$/iu
const AUTHOR_IN_054 = /(?:(judge)|(justice))\s+([\p{L}'’\-]+)|^([\p{L}'’\-]+)\s*,\s*(?:C\.\s?)?JJ?\./iu
const ROLE_AT_END_054 = new RegExp(ROLE_054, 'iu')
/** legal@0.5.4: the role as printed, its parentheses off ("(dissenting)" is "dissent"). */
const roleName054 = (roleWords: string): string => roleName053(roleWords.replace(/^\(\s*/u, '').replace(/\s*\)\s*(?=[.:]?\s*$)/u, ''))

/**
 * legal@0.5.5 (2026-10-19): nine more designation styles a cold review (an AI agent in a legal-operations role, not a person) found passing a
 * separate opinion's words as the majority's under legal@0.5.4: "concurring dubitante:", "specially concurring:", "statement respecting the
 * denial of rehearing en banc:", "joining the opinion of the court and concurring:", "concurring, with whom OKAFOR, Circuit Judge, joins:",
 * "Judge LINDQVIST, concurring dubitante.", "LINDQVIST, P.J. (concurring in result only)", "LINDQVIST, J., would grant the petition.",
 * "Separate Statement of LINDQVIST, J.". The rule is the reviewer's, read wider (fail closed): after the majority has started, a short line of
 * its own that names a judge (who, then a title; or a title, then who) and goes on with a role-like word (a form of "dissent" or "concur",
 * "dubitante", "statement", "separately", "joining", "would grant", "would deny" and the like) starts a separate opinion, whatever else it
 * says; so does a heading "Separate Statement of …", "Statement of …" or "Separate Opinion by …".
 */
const TITLE_055 = String.raw`(?:(?:chief|senior|presiding|associate|acting|circuit|district|appellate)\s+)*(?:judge|justice)|(?:[pcas]\.\s?)?jj?\.`
const NAME_FIRST_055 = new RegExp(String.raw`^([\p{L}][\p{L}'’\-]+(?:\s+[\p{L}][\p{L}'’.\-]*){0,3}),\s+(?:${TITLE_055})\s*,?\s*(.{2,160})$`, 'iu')
const TITLE_FIRST_055 = /^(?:(?:chief|senior|presiding|associate|acting|circuit|district)\s+)*(?:judge|justice)\s+([\p{L}'’\-]+)\s*,\s*(.{2,160})$/iu
const STATEMENT_HEADING_055 = /^(?:separate\s+)?(?:statement|opinion|memorandum|writing|views?)\s+(?:of|by)\s+(?:(?:chief\s+)?(?:judge|justice)\s+)?([\p{L}'’\-]+)(?:\s*,\s*(?:[pcas]\.\s?)?jj?\.?)?(?:\s*,?\s+(.{2,120}))?$/iu
/** the role-like words a separate opinion's designation opens with (after a parenthesis, or "specially", "separately", "respectfully") */
const ROLE_START_055 = /^\(?\s*(?:(?:specially|separately|respectfully|also)\s+)?(?:dissent\w*|concur\w*|dubitante|statement|separate\w*|joining|joins|respecting|would\s+(?:grant|deny|affirm|reverse|vacate|remand|hold|dismiss|reach|rehear|certify))(?![\p{L}])/iu
/** legal@0.5.5: the opinion's name from its role words as printed ("concurring dubitante" → "opinion concurring dubitante"). */
function roleName055(words: string): string {
  const w = words.replace(/^\(\s*/u, '').replace(/\s*\)\s*$/u, '').replace(/[.:]\s*$/u, '').split(',')[0]!.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
  if (w === 'dissenting') return 'dissent'
  if (w === 'concurring') return 'concurrence'
  if (/^statement\b/u.test(w)) return w
  if (/dissent|concur|dubitante/u.test(w)) return `opinion ${w}`
  return 'separate opinion'
}
/** legal@0.5.5: a separate opinion's designation in one of the wider forms (above), on line `b`, after the majority; or undefined. */
function designation055(b: string): { author: string; title: 'Judge' | 'Justice' | undefined; role: Section['role']; printed: string } | undefined {
  if (b.length > 200 || /\p{L}{2,}[.!?]["”’)]*\s+\p{Lu}\p{Ll}/u.test(b.replace(/(?:^|\s)(?:[pcas]\.\s?)?jj?\.\s/giu, ' '))) return undefined
  const st = STATEMENT_HEADING_055.exec(b.replace(/[.:]\s*$/u, ''))
  if (st) {
    const words = st[2] ?? ''
    return { author: readerName(st[1] as string), title: /\bjustice\b/iu.test(b) ? 'Justice' : /\bjudge\b/iu.test(b) ? 'Judge' : undefined, role: roleOf(words) === 'separate' ? 'separate' : roleOf(words), printed: /dissent|concur/iu.test(words) ? roleName055(words) : 'separate statement' }
  }
  const t = TITLE_FIRST_055.exec(b)
  const n = t ? undefined : NAME_FIRST_055.exec(b)
  const m = t ?? n
  if (!m) return undefined
  const rest = m[2] as string
  if (!ROLE_START_055.test(rest)) return undefined
  const author = readerName((m[1] as string).split(/\s+/).pop() as string)
  const title = t ? (/\bjustice\b/iu.test(b.slice(0, (b.indexOf(m[1] as string)))) ? 'Justice' as const : 'Judge' as const) : /\bjudge\b/iu.test(b.slice((m[1] as string).length, b.length - rest.length)) ? 'Judge' as const : /\bjustice\b/iu.test(b.slice((m[1] as string).length, b.length - rest.length)) ? 'Justice' as const : undefined
  return { author, title, role: roleOf(rest), printed: roleName055(rest) }
}

/** a line that is only an author's designation, closed by a period or colon ("Mr. Justice Douglas.", "Mr. Justice Roberts:") */
const BARE_DESIGNATION = /^(?:\S{1,4}\s+)?((?:the\s+)?chief\s+)?justic\S{0,3}\s+([\p{L}'’\-]+)\s*[.:]$/iu
/** the author named on a line after a "Dissent" or "Separate opinion of" heading */
const AUTHOR_ON_LINE = /^(?:\S{1,4}\s+)?((?:the\s+)?chief\s+)?justic\S{0,3}\s+([\p{L}'’\-]+)/iu

/** A surname as a reader writes it: "BRENNAN" → "Brennan"; "McLAUGHLIN" and "Brennan" kept. */
function readerName(w: string): string {
  const t = w.replace(/[,.:;]+$/, '')
  return t.length > 1 && t === t.toUpperCase() && /\p{L}/u.test(t) ? t[0] + t.slice(1).toLowerCase() : t
}

function roleOf(words: string): Section['role'] {
  const d = /dissent/i.test(words), c = /concur/i.test(words)
  return d && c ? 'concurrence-dissent' : d ? 'dissent' : c ? 'concurrence' : 'separate'
}

const ROLE_NAME: Record<NonNullable<Section['role']>, string> = {
  'dissent': 'dissent', 'concurrence': 'concurrence', 'concurrence-dissent': 'opinion concurring in part and dissenting in part', 'separate': 'separate opinion',
}

/** "Justice Brennan's dissent", "the Chief Justice's concurrence", "Judge Smith's dissent", "a dissent"; `what` (legal@0.5.3) names the role as printed */
function separateName(role: Section['role'], author: string | undefined, title: 'Justice' | 'Chief Justice' | 'Judge' | undefined, printed?: string): string {
  const what = printed ?? ROLE_NAME[role ?? 'separate']
  if (author !== undefined) return title !== undefined ? `${title} ${author}'s ${what}` : `${author}'s ${what}`
  if (title === 'Chief Justice') return `the Chief Justice's ${what}`
  if (printed === undefined) return role === 'separate' ? 'a separate opinion' : `a ${what}`
  return /^opinion\b/.test(what) ? `an ${what}` : `a ${what}`
}

interface Marker { line: number; kind: Exclude<SectionKind, 'header'>; name: string; author?: string; role?: Section['role']; title?: 'Justice' | 'Chief Justice' | 'Judge'; heading?: boolean }

/**
 * A separate opinion's designation starting at line i (one line, or up to three short ones joined), or undefined. legal@0.5.3 (`v053`)
 * reads any stretch between the author and the role (BETWEEN_053) and names the opinion by its role as printed (roleName053).
 */
function designationAt(lines: Line[], i: number, majoritySeen: boolean, v053 = false, v054 = false, v055 = false): { marker: Marker; through: number } | undefined {
  const parts: string[] = []
  let k = i
  for (let n = 0; n < 3 && k < lines.length; k++) {
    const b = bareOf(lines[k]!.text)
    if (b.length === 0) { if (n === 0) return undefined; continue }
    if (b.length > 200) break
    parts.push(b)
    n++
    const joined = parts.join(' ')
    if (joined.length > 360) break
    // the role is the last "dissenting" or "concurring" that opens the role at the line's end (legal@0.5.3: a join clause may name
    // "dissenting" opinions before it); earlier rules take the first, as they always did. legal@0.5.4 reads the role in parentheses too.
    const roleAt = v054 ? (ROLE_AT_END_054.exec(joined)?.index ?? joined.search(/dissenting|concurring/i)) : v053 ? lastRoleAt(joined) : joined.search(/dissenting|concurring/i)
    const printed = (): string | undefined => (v054 ? roleName054(joined.slice(roleAt)) : v053 ? roleName053(joined.slice(roleAt)) : undefined)
    const j = (v054 ? JUSTICE_ROLE_054 : v053 ? JUSTICE_ROLE_053 : JUSTICE_ROLE).exec(joined)
    if (j) {
      const author = j[2] !== undefined && !/^justic/i.test(j[2]) ? readerName(j[2]) : undefined
      const title = j[1] !== undefined ? 'Chief Justice' as const : 'Justice' as const
      const role = roleOf(joined.slice(roleAt))
      return { marker: { line: i, kind: 'separate', name: separateName(role, author, title, printed()), ...(author !== undefined ? { author } : {}), role, title }, through: k }
    }
    const g = (v054 ? JUDGE_ROLE_054 : v053 ? JUDGE_ROLE_053 : JUDGE_ROLE).exec(joined)
    if (g) {
      const author = readerName((g[1] as string).split(/\s+/).pop() as string)
      const role = roleOf(joined.slice(roleAt))
      // "J." and "C. J." name a Justice or a Judge alike, so the name carries no title; "Judge" only when printed
      const title = /\bjudge\b/i.test(joined.slice((g[1] as string).length, roleAt)) ? 'Judge' as const : undefined
      return { marker: { line: i, kind: 'separate', name: separateName(role, author, title, printed()), author, role, ...(title ? { title } : {}) }, through: k }
    }
    if (v054) {
      // legal@0.5.4: the title before the name ("Judge MOLINA, dissenting.")
      const t = TITLE_FIRST_054.exec(joined)
      if (t) {
        const author = readerName(t[1] as string)
        const role = roleOf(joined.slice(roleAt))
        return { marker: { line: i, kind: 'separate', name: separateName(role, author, 'Judge', printed()), author, role, title: 'Judge' }, through: k }
      }
      if (n === 1 && majoritySeen) {
        // the role as a verb ("MOLINA, J., dissents and votes to reverse …:"), and a dissent announced in the first person
        const v = VERB_054.exec(b)
        if (v) {
          const author = readerName((v[1] as string).split(/\s+/).pop() as string)
          const role = roleOf(v[2] as string)
          const title = /\bjudge\b/i.test(b.slice((v[1] as string).length, v.index + v[0].indexOf(v[2] as string))) ? 'Judge' as const : undefined
          return { marker: { line: i, kind: 'separate', name: separateName(role, author, title, ROLE_NAME[role ?? 'separate']), author, role, ...(title ? { title } : {}) }, through: k }
        }
        const me = I_DISSENT_054.exec(b)
        if (me) {
          const role = roleOf(me[1] as string)
          return { marker: { line: i, kind: 'separate', name: separateName(role, undefined, undefined, ROLE_NAME[role ?? 'separate']), role }, through: k }
        }
      }
    }
    if (v055 && n === 1 && majoritySeen) {
      // legal@0.5.5: the wider forms, one line of its own after the majority (designation055)
      const w = designation055(b)
      if (w) return { marker: { line: i, kind: 'separate', name: separateName(w.role, w.author, w.title, w.printed), author: w.author, role: w.role, ...(w.title ? { title: w.title } : {}) }, through: k }
    }
    if (n === 1 && majoritySeen) {
      const d = BARE_DESIGNATION.exec(b)
      if (d) {
        const author = readerName(d[2] as string)
        const title = d[1] !== undefined ? 'Chief Justice' as const : 'Justice' as const
        return { marker: { line: i, kind: 'separate', name: separateName('separate', author, title), author, role: 'separate', title }, through: k }
      }
    }
  }
  return undefined
}

/**
 * The sections of an opinion text (above). Offsets are the text's own: `start` is the first character of a section's first
 * line, `end` the first character of the next section (or the text's length).
 */
export function sectionsOf(text: string, opts: { v051?: boolean; v052?: boolean; v053?: boolean; v054?: boolean; v055?: boolean } = {}): TextSections {
  const INLINE = opts.v051 ? INLINE_EDITORIAL_051 : INLINE_EDITORIAL
  const lines = linesOf(text)
  const markers: Marker[] = []
  let majoritySeen = false
  let separateSeen = false
  // legal@0.5.5: a body sentence seen outside editorial matter before any start (the text is an unheaded opinion, so a judge's line after
  // it is a signature, never where the opinion begins)
  let bodySeen = false
  for (let i = 0; i < lines.length; i++) {
    const bare = bareOf(lines[i]!.text)
    if (bare.length === 0) continue
    const markBodySeen = (): void => {
      if (opts.v055 && !bodySeen && (markers.length === 0 || markers[markers.length - 1]!.kind !== 'editorial') && (bare.length > 400 || /\p{L}{4,}[.?!]["”’)]*\s+["“(]?\p{Lu}/u.test(bare))) bodySeen = true
    }
    // a heading or label starts with a capital, and the line above does not break mid-phrase into it (a comma or hyphen), so a
    // hard-wrapped body line ("for a final" / "disposition.") is never read as one
    const prev = i > 0 ? lines[i - 1]!.text.replace(/\s+$/u, '') : ''
    const standsAlone = /^\P{L}*\p{Lu}/u.test(bare) && !/[,\-]$/u.test(prev)
    const key = standsAlone ? keyOf(bare) : ''
    const label = standsAlone ? /^([\p{L}®][\p{L}® ()]{1,40}?)\s*:\s+\S/u.exec(bare)?.[1]?.toLowerCase().replace(/\s+/g, ' ') : undefined
    if (MAJORITY_HEADINGS.has(key) || label === 'opinion by') {
      markers.push({ line: i, kind: 'majority', name: 'the majority opinion' })
      majoritySeen = true
      continue
    }
    // legal@0.5.5: a district court's heading or a judge's line starts the majority when none has started (above)
    if (opts.v055 && !majoritySeen && !bodySeen && standsAlone && (DISTRICT_HEADINGS_055.has(key) || JUDGE_LINE_055.test(bare))) {
      markers.push({ line: i, kind: 'majority', name: 'the majority opinion' })
      majoritySeen = true
      continue
    }
    // an editorial label first: a Lexis "Judges: REHNQUIST, J., delivered the opinion of the Court, …" line is the judges listing
    const inline = label !== undefined ? INLINE[label] : undefined
    if (EDITORIAL[key] !== undefined || inline !== undefined) {
      markers.push({ line: i, kind: 'editorial', name: EDITORIAL[key] ?? inline as string, heading: true })
      continue
    }
    // "Black, J., delivered the opinion of the Court, in which …" closes a syllabus; the opinion starts at "Mr. Justice Black delivered …"
    if ((bare.length <= 240 && DELIVERED.test(bare) && !SYLLABUS_SUMMARY.test(bare)) || CIRCUIT_MAJORITY.test(bare)) {
      markers.push({ line: i, kind: 'majority', name: 'the majority opinion' })
      majoritySeen = true
      continue
    }
    if (key === 'footnotes') {
      if (separateSeen) markers.push({ line: i, kind: 'footnotes', name: 'the footnotes at the end of the text, which this check cannot assign to one opinion' })
      continue
    }
    // legal@0.5.4: a heading that names its author ("Dissenting Opinion by Judge Molina") starts the separate opinion it names
    const hb = (opts.v054 || opts.v055) && standsAlone && bare.length <= 120 ? HEADING_BY_054.exec(bare.replace(/[.:]\s*$/u, '')) : null
    if (hb) {
      const role: Section['role'] = /^dissent/i.test(hb[1] as string) ? 'dissent' : 'concurrence'
      const a = AUTHOR_IN_054.exec(hb[2] as string)
      const author = a ? readerName((a[3] ?? a[4]) as string) : undefined
      const title = a?.[1] !== undefined ? 'Judge' as const : a?.[2] !== undefined ? 'Justice' as const : undefined
      markers.push({ line: i, kind: 'separate', name: separateName(role, author, title), ...(author !== undefined ? { author } : {}), role, ...(title ? { title } : {}), heading: true })
      separateSeen = true
      continue
    }
    const sep = SEPARATE_HEADINGS[key]
    if (sep !== undefined) {
      // a heading: the author is on one of the next three lines when printed there ("JUSTICE BRENNAN, dissenting.")
      let author: string | undefined, title: Marker['title']
      for (let k = i + 1, n = 0; k < lines.length && n < 3; k++) {
        const b = bareOf(lines[k]!.text)
        if (b.length === 0) continue
        n++
        const a = b.length <= 200 ? AUTHOR_ON_LINE.exec(b) : null
        if (a) { author = readerName(a[2] as string); title = a[1] !== undefined ? 'Chief Justice' : 'Justice'; break }
      }
      const role = sep === 'separate' ? 'separate' : sep
      markers.push({ line: i, kind: 'separate', name: separateName(role, author, title), ...(author !== undefined ? { author } : {}), role, ...(title ? { title } : {}), heading: true })
      separateSeen = true
      continue
    }
    const d = designationAt(lines, i, majoritySeen, opts.v053 === true || opts.v054 === true || opts.v055 === true, opts.v054 === true || opts.v055 === true, opts.v055 === true)
    if (d) {
      // a heading just above ("Dissent", "Separate opinion of") takes the designation's author and role
      const last = markers[markers.length - 1]
      const fold = (s: string | undefined): string => (s ?? '').toLowerCase().replace(/[^\p{L}]/gu, '')
      if (last?.kind === 'separate' && last.heading && last.author === undefined && i - last.line <= 3) {
        markers[markers.length - 1] = { ...d.marker, line: last.line }
      } else if (last?.kind === 'separate' && last.author !== undefined && fold(last.author) === fold(d.marker.author) && last.role === d.marker.role) {
        // the same opinion designated again (a slip opinion's running head, "SOUTER, J., dissenting", atop each page): one section,
        // named by the designation that prints a title
        if (last.title === undefined && d.marker.title !== undefined) markers[markers.length - 1] = { ...d.marker, line: last.line }
      } else markers.push(d.marker)
      separateSeen = true
      i = d.through
    } else markBodySeen()
  }
  if (markers.length === 0) {
    return { recognized: false, sections: [{ kind: 'majority', name: 'the majority opinion', start: 0, end: text.length, line: 1, last_line: lines.length }] }
  }
  const out: Section[] = []
  const push = (s: Omit<Section, 'end' | 'last_line'>, endLine: number): void => {
    const end = endLine < lines.length ? lines[endLine]!.start : text.length
    if (text.slice(s.start, end).trim().length === 0) return
    const last = out[out.length - 1]
    if (last && last.kind === s.kind && last.name === s.name) { last.end = end; last.last_line = endLine; return }
    out.push({ ...s, end, last_line: endLine })
  }
  const first = markers[0] as Marker
  if (first.line > 0) push(first.kind === 'separate' ? { kind: 'majority', name: 'the majority opinion', start: 0, line: 1 } : { kind: 'header', name: 'the header above the opinion', start: 0, line: 1 }, first.line)
  markers.forEach((m, k) => {
    const next = markers[k + 1]
    const s: Omit<Section, 'end' | 'last_line'> = { kind: m.kind, name: m.name, start: lines[m.line]!.start, line: m.line + 1, ...(m.author !== undefined ? { author: m.author } : {}), ...(m.role !== undefined ? { role: m.role } : {}) }
    push(s, next ? next.line : lines.length)
  })
  // legal@0.5.2: a lead opinion that is a plurality, wholly or in part, is named "the lead opinion", never "the majority opinion"
  const plurality = opts.v052 ? pluralityOf(text, out, opts.v055 === true) : undefined
  if (plurality) for (const s of out) if (s.kind === 'majority') s.name = 'the lead opinion'
  return { recognized: true, sections: out, ...(plurality ? { plurality } : {}) }
}

/** The section holding offset `at` (the last one starting at or before it). */
export function sectionAt(ts: TextSections, at: number): Section {
  let hit = ts.sections[0] as Section
  for (const s of ts.sections) if (s.start <= at) hit = s
  return hit
}

/** The 1-based line of offset `at` in `text`. */
export function lineAt(text: string, at: number): number {
  let n = 1
  for (let i = 0; i < at && i < text.length; i++) {
    const c = text[i]
    if (c === '\n') n++
    else if (c === '\r' && text[i + 1] !== '\n') n++
  }
  return n
}

/**
 * The text with everything outside `keep` blanked: each character a space, line breaks kept, so offsets and lines are the text's
 * own and a quotation found in the result is found, at the same offsets, in the text.
 */
export function viewOf(text: string, keep: readonly Section[]): string {
  if (keep.length === 0) return text.replace(/[^\r\n]/g, ' ')
  const spans = [...keep].sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const s of spans) {
    if (s.start > at) out += text.slice(at, s.start).replace(/[^\r\n]/g, ' ')
    out += text.slice(Math.max(at, s.start), s.end)
    at = Math.max(at, s.end)
  }
  return out + text.slice(at).replace(/[^\r\n]/g, ' ')
}

/**
 * The separate opinion a citation names in a parenthetical ("477 U.S. 242, 265 (Brennan, J., dissenting)", "(Stewart, J.,
 * concurring in the judgment)"): its author and role, or undefined when the citation names none.
 */
export function opinionNamedBy(cite: string | undefined): { author: string; role: 'dissent' | 'concurrence' | 'concurrence-dissent' } | undefined {
  if (cite === undefined) return undefined
  for (const m of cite.matchAll(/\(([^()]*)\)/g)) {
    const inner = m[1] as string
    if (!/\b(?:dissenting|concurring)\b/i.test(inner)) continue
    const who = /([\p{L}'’\-]+),\s*(?:C\.\s?)?J\.?/u.exec(inner)?.[1] ?? /justice\s+([\p{L}'’\-]+)/iu.exec(inner)?.[1]
    if (who === undefined) continue
    const role = roleOf(inner)
    return { author: readerName(who), role: role === 'separate' || role === undefined ? 'dissent' : role }
  }
  return undefined
}

/** The separate opinions of `ts` a citation's parenthetical names: same author (letter case aside), a compatible role. */
export function sectionsNamed(ts: TextSections, named: { author: string; role: 'dissent' | 'concurrence' | 'concurrence-dissent' }): Section[] {
  const fold = (s: string): string => s.toLowerCase().replace(/[^\p{L}]/gu, '')
  return ts.sections.filter(s => s.kind === 'separate' && s.author !== undefined && fold(s.author) === fold(named.author) &&
    (s.role === 'separate' || s.role === 'concurrence-dissent' || named.role === 'concurrence-dissent' || s.role === named.role))
}
