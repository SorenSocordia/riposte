/**
 * Legal citation verification — now required by rules of practice.
 *
 * Florida Rule 2.515(d)(2) (adopted Case SC2026-0673, eff. 2026-06-15) REQUIRES that cited authorities "exist and are
 * accurately cited" — a live, confirmed mandate (claim-verify 2026-09-22). California SB 574 (passed the legislature
 * 2026-08-31, awaiting the Governor as of 2026-09) WOULD add a "personally verified" duty — treat as PENDING, not
 * settled law. Existence-checking is a commodity (CourtListener,
 * Shepard's) and cannot catch the growing failure: a REAL case cited for words it does not contain. Of Charlotin's 2,046
 * hallucination decisions, 549 are false QUOTES — exactly what a deterministic verbatim match catches and existence-checkers miss.
 *
 * We decide, deterministically, only what is decidable:
 *   quote present verbatim in the opinion   → PASS
 *   quote's own words are in the opinion but not as quoted (a misquote) → FAIL, with the passage the opinion actually carries
 *   quote located nowhere in the supplied opinion → INSUFFICIENT (maybe a fabrication, maybe wrong/partial source text)
 *   no opinion text supplied for the cite   → INSUFFICIENT / REFERENCE_NOT_PROVIDED (we will not assert existence we can't check)
 *   only a PROPOSITION, no quote            → INSUFFICIENT / OUT_OF_RULESET_SCOPE — whether the case STANDS FOR the
 *                                             proposition is semantic; the deterministic tier does not decide it (a REASONED
 *                                             tier will, later, labelled as an opinion). This declared abstention is the
 *                                             honest "can't-tell".
 *
 * Deterministic; reuses the source-text axis. No I/O, no clock except issued_at.
 *
 * Two versions (2026-10-03). legal@0.0.1, the default, is the contract above, unchanged. legal@0.1.0, opt-in with
 * `ruleset: 'legal@0.1.0'`, reads the quotation conventions opinions and briefs use (brackets, ellipses, quotation marks,
 * "(cleaned up)", trailing punctuation, soft hyphens) and names on each PASS the ones it relied on; requires whole-word
 * matches; and names a passage on a FAIL only on a strong enough match (./quotation.ts): the corresponding passage, or
 * the nearest one labelled as a partial match. A replay re-performs each verdict under the version it names.
 *
 * legal@0.2.0 (2026-10-03), opt-in with `ruleset: 'legal@0.2.0'`: 0.1.0's reading plus a meaning guard (./quotation.ts
 * meaningOf). A bracket that replaces a word with a different word, or swaps a modal, a negation or a quantifier, FAILs as an
 * altered quotation; an ellipsis that omits a condition or limiting word, and inner quotation marks dropped or added, abstain
 * (SELECTIVE_QUOTE). 0.0.1 stays the default; 0.1.0 is unchanged.
 *
 * Engine 0.6.0 (cold-review round 2, 2026-10-05), every legal rule (check060 below; docs/LEGAL.md): a quotation is checked only against
 * a text that names its cite (./binding.ts), and every supplied text's provenance is recorded (`opinion_sources`); 0.0.1 names a
 * passage only on 0.1.0's rule, so an invented quotation abstains instead of FAILing beside a coincidental match; and every
 * answer speaks of the opinion text supplied for the case. Engines 0.0.1 to 0.5.0 answer through the legacy code, byte for byte.
 * The default rule for a new verdict is 0.2.0 under engine 0.6.0 (maintainers' decision 2026-10-05; defaultLegalRuleset), 0.0.1 before it; 0.3.0 later the same day, then 0.4.0.
 * A text supplied with bind "parties" is bound, labelled, by its parties alone (./binding.ts); the choice ledger records it.
 *
 * legal@0.3.0 (2026-10-05; engine 0.6.0 and later; the default for a new verdict from then on): 0.2.0's reading,
 * plus four changes a cold reader's (an AI agent's) adversarial brief called for. A text is bound by its CAPTION, never by a mention in its
 * body (./binding.ts captionOf), and the abstention says what the caption says the text is. A parties-only binding is checked and
 * left open, never PASS. An ellipsis or a capital at an edge of the quotation is read to the sentence boundary for a dropped
 * condition, and a set-off phrase of time or procedure in an omission is a condition. Letter case is compared, and "verbatim" is
 * said only of an exact match. Verdicts naming 0.0.1, 0.1.0 or 0.2.0 are re-performed as before, byte for byte.
 *
 * legal@0.4.0 (2026-10-05, cold-review round 4; engine 0.6.0 and later; the default for a new verdict from then on): 0.3.0's reading, plus
 * what a cold reader's (an AI agent in a legal-operations director's role) third-round probe called for. A quotation that begins mid-sentence as the text writes
 * it ("the motion to amend must be granted" from "Unless the movant shows actual prejudice, the motion …") is read for a condition
 * or negation in the part of the sentence before it, as the capital guard reads it. Star paging ("*248", "[*249]") and footnote
 * numerals glued to sentence punctuation ("counted.4 This") are read out of the comparison and named on the answer; a quotation
 * that matches only with a looser token read out answers can't tell. A named passage is whole sentences, never showing a page
 * mark, and a FAIL names the words that differ. A short form ("477 U.S. at 248") is read as a pin cite to the brief's own full
 * citation, else "short form; supply the full citation". A citation line outside the caption window is named as such. No doubled
 * period after "Co.". Verdicts naming 0.3.0 are re-performed as before, byte for byte.
 *
 * legal@0.5.0 (2026-10-05, cold-review round 5; engine 0.6.0 and later; see defaultLegalRuleset for whether it is the default): 0.4.0's
 * reading, plus what a cold reader's (an AI agent in a legal-operations director's role) fourth-round probe called for. The text's sections are read
 * (./sections.ts): a quotation is checked against the majority opinion's words, and words found only in editorial matter (a
 * synopsis, headnotes, a case summary, core terms, the syllabus, the header) or in a separate opinion answer can't tell naming
 * where they are, never PASS; a citation whose parenthetical names a separate opinion ("(Brennan, J., dissenting)") is checked
 * against that opinion. Every PASS says where it matched (the section, the line, the character offset). A citation is looked up
 * by its reporter citation with the pin page, the case name and a parenthetical read off ("Anderson v. Liberty Lobby, Inc., 477
 * U.S. 242, 248 (1986)" finds the text keyed "477 U.S. 242"), and a miss names what was looked for and what was supplied. A Lexis
 * header's "Reporter" block binds (./binding.ts reporterBlockLines). Every footnote-call form 0.4.0 does not read out on its own
 * ("n7", "FN6", "[4]", superscript digits) answers can't tell naming it, never FAIL. Its claims are named "Quotation found as
 * quoted in the supplied text". Verdicts naming 0.4.0 and every earlier rule are re-performed as before, byte for byte.
 *
 * legal@0.5.1 (2026-10-06; engine 0.6.0 and later; the default for a new verdict from then on): 0.5.0's reading, plus what the next
 * cold reader's probe called for (quote051 below). A quotation that stops before its sentence ends is never called "verbatim": its
 * PASS prints how the sentence continues, and a continuation that limits or negates the quoted words ("… complaint" + " is
 * inapplicable to legal conclusions", ", but it does not …") answers can't tell; a fragment presented as a whole sentence is said to
 * be one. Em dashes, en dashes and "--" are one dash; "(citation omitted)", "(cleaned up)", "(footnote omitted)", "(internal
 * quotation marks omitted)" and "(alteration in original)" excuse what they name, and the PASS says what; a Westlaw headnote number
 * between sentences is read out; a FAIL names what differs as the text prints it. Verdicts naming 0.5.0 and every earlier rule are
 * re-performed as before, byte for byte.
 *
 * legal@0.5.2 (2026-10-06, later that day; engine 0.6.0 and later): 0.5.1's reading, plus what the next cold reader's probe called for
 * (quote051 and quote050 below, under `v052`). A quotation that begins in the middle of its sentence is never called "verbatim": its
 * PASS prints how the sentence begins, and when those words report another's position ("Appellant argues that", "the dissent maintains
 * that", "the court below held that") or frame what follows as a counterfactual, a rejected reading, a question or a hypothetical ("we
 * might hold that", "It would be a mistake to conclude that"), the answer is can't tell naming them (quotation.ts leadFrameOf). A lead
 * opinion that is a plurality, wholly or in a part, is named "the lead opinion" and a PASS in a plurality part says so (sections.ts
 * pluralityOf). A Westlaw PDF's page footers and running headers and a Lexis "HN4[ ]" marker are read out of the comparison; a KeyCite
 * flag at the head of a download is not read as its caption, and the "All Citations" lines at its end name the text (binding.ts). A
 * FAIL's words left out honour the quotation's ellipses. Verdicts naming 0.5.1 and every earlier rule are re-performed as before.
 *
 * legal@0.5.3 (2026-10-13; engine 0.7.1 and later, its default from then): 0.5.2's reading, plus what two more cold readers' probes
 * called for (quote051 under `v053`). A separate opinion's designation is read whatever stands between its author and its role ("with
 * whom Justice GINSBURG joins except as to Part IV,"; sections.ts BETWEEN_053). A lead-in is read with its verb's inflections and the
 * words after it ("asks us to hold that", "According to Bravo,", "In Bravo's view,", "held (1) that …, and (2) that"; quotation.ts
 * leadFrameOf053), and a sentence that introduces another's view makes the sentences after it that view's until the court speaks again
 * (carriedView053). Words inside the opinion's own quotation marks PASS with a notice naming their source, and FAIL when the court's next
 * words reject them (innerQuotation053, rejectionAfter053). A running header's parallel citations are read by their shape, "(citations
 * omitted)" excuses a citation clause inside a sentence (quotation.ts citationClausesOf), a FAIL that rests only on citation- or
 * header-shaped words answers can't tell, a negation is read only up to "but", and a period before a small letter ends no sentence.
 * Verdicts naming 0.5.2 and every earlier rule are re-performed as before, byte for byte.
 *
 * legal@0.5.4 (2026-10-14; selectable from engine 0.7.1, the default from the engine named in V054_DEFAULT_ENGINE): 0.5.3's reading, plus
 * what two more cold readers found (an AI agent as a legal-operations buyer, and one in the ninth review round; neither a person). A
 * "(quoting …)" or "(citing …)" parenthetical written after the quoted words, in the quotation itself, is the brief's own and not compared
 * (QUOTING_PAREN_054; the citation field already read it). An unbracketed change of the first letter's case answers can't tell naming the
 * bracket to write ("[s]ummary"). An ellipsis that omits a part of a condition joined by "and" or "or" ("where A . . . , but" for "where A
 * and B, but") answers can't tell; one that omits a whole "not X, but" contrast keeps what the text asserts (NOT_BUT_054). A negation's
 * clause ends at a comma before a coordinating conjunction (quotation.ts CLAUSE_CUT_054; precededByNegation054), a party's filing is a
 * speaker ("Tamberly's brief states that"), a sentence that opens on a headnote marker ("HN2[ ]", "[2]") is the court's own statement and
 * carries no view from the sentence before it, and a sentence that judges a stated rule ("That rule no longer holds.") is the court's voice.
 * Six more separate-opinion designation styles end the majority (sections.ts), and a Westlaw or Lexis database number is a caption's
 * citation (binding.ts CITE_IN_LINE_054; citeParts). Verdicts naming 0.5.3 and every earlier rule are re-performed as before, byte for byte.
 *
 * legal@0.5.5 (2026-10-19; selectable from engine 0.7.2, the default from the engine named in V055_DEFAULT_ENGINE, a label not yet open): 0.5.4's
 * reading, plus what two more cold readers found (an AI agent in a tenth review round and one as a legal-operations buyer; neither a person).
 * An ellipsis that omits words from inside a clause, a word of degree, frequency or hedging ("rarely", "generally", "in limited
 * circumstances"), words that say who must show what ("the opponent shows that") or a part of a time phrase joined by "or" answers can't tell,
 * never PASS (quotation.ts cutInsideClause055, hedgeIn055, burdenIn055, timePhraseOf055). A bracket that inserts a word of degree, a word that
 * says the opposite of its stem or an "-ly" adverb FAILs; one that inserts any other content word answers can't tell (insertedWord055). A
 * ligature from PDF conversion ("ﬁ") is read as its letters. A rule, code or Restatement citation is a citation sentence or clause, so
 * "(citation omitted)" excuses it. The court's own sentence that judges a view is read as the court's; words the opinion quotes and departs from
 * in its next sentence in words the 0.5.3 list does not hold ("We part ways with that formulation today.") answer can't tell, naming that
 * sentence. Nine more separate-opinion designation styles end the majority, two plurality forms are named, and a district court's slip opinion
 * is read from its heading or its judge's line (sections.ts). Verdicts naming 0.5.4 and every earlier rule are re-performed as before, byte for byte.
 */

import { hashOf, sha256 } from '../verdict/canonical.js'
import { attachRemedies, type RemedyTable, type RuleRemedies } from '../verdict/remedy.js'
import { attachScope } from '../verdict/scope.js'
import { prepareSource, matchQuote, type PreparedSource } from '../textmatch/index.js'
import type { ChoiceEntry, ClaimVerdict, Coverage, Evidence, Outcome, Verdict } from '../verdict/schema.js'
import { SCHEMA_VERSION, ENGINE_VERSION, engineFor, engineAtLeast, isRetainedEngine, type EngineVersion } from '../version.js'
import { verdictIdentity } from '../protocol/verdict-id.js'
import { burdenIn055, clipWords, conditionIn030, continuationAfter, continuesClause054, courtVoice053, cutInsideClause055, hasWordsBefore, hedgeIn055, keptSentenceParts055, ligaturesIn055, onlyCitation, conventionParentheticalsOf, hasInnerQuotationMarks, leadCutOf, leadFrameOf, leadFrameWords, markNotes, markShown, meaningOf, nearestPassage, prepareLegalSource, punctuationDifferences, readQuotation, sentenceHeadBefore, sentenceSpanOf, sentenceTailAfter, tailLimitOf, timePhraseOf055, viewOpener053, wordDifferences, CLAUSE_CUT_054, QUOTATION_LIMITS, type LeadFrame, type LegalPreparedSource, type PageMark, type QuotationLimits, type QuotationReading } from './quotation.js'
import { afterSpacing, asciiDigit, lineBreak, spacingAt, type WholeMatch, bindModeOf, captionNamingOf, citeNameOf, namingOf, parseReporterCite, partiesOf, partyNamer, provenanceOf, textOf, unnamedOf, CAPTION_LIMITS, PARTIES_ONLY_NOTE_V030, type CiteNaming, type OpinionProvenance, type OpinionText } from './binding.js'
import { lineAt, opinionNamedBy, pluralityAt, sectionAt, sectionsNamed, sectionsOf, viewOf, type Plurality, type Section, type TextSections } from './sections.js'

export type { BindMode, Caption, CiteNaming, OpinionProvenance, OpinionText } from './binding.js'
export { PARTIES_ONLY_NOTE, PARTIES_ONLY_NOTE_V030, CAPTION_LIMITS, captionOf } from './binding.js'

const LEGAL_RULESET = { id: 'legal', version: '0.0.1', domain: 'legal' } as const
/** The rule that reads quotation conventions (above). Opt-in: named only when the caller asks for it. */
const LEGAL_RULESET_V010 = { id: 'legal', version: '0.1.0', domain: 'legal' } as const
/** 0.1.0's reading plus the meaning guard (2026-10-03). Opt-in, like 0.1.0. */
const LEGAL_RULESET_V020 = { id: 'legal', version: '0.2.0', domain: 'legal' } as const
/**
 * 0.2.0's reading plus (2026-10-05; engine 0.6.0 and later only): binding by the text's caption (./binding.ts captionOf),
 * a parties-only binding left open, the condition guards at the edges of a quotation and on a set-off phrase of time, and letter
 * case compared. See check060 and quote060V010 below; docs/LEGAL.md.
 */
const LEGAL_RULESET_V030 = { id: 'legal', version: '0.3.0', domain: 'legal' } as const
/**
 * 0.3.0's reading plus (2026-10-05, cold-review round 4; engine 0.6.0 and later only; docs/LEGAL.md): a quotation that begins in the
 * middle of its sentence is read for a condition or negation in the part of the sentence before it (quotation.ts leadCutOf);
 * star paging and glued footnote numerals are read out of the comparison and named (quotation.ts pageMarksOf), and a FAIL that
 * matches only with a looser token read out answers can't tell; a named passage is whole sentences, with the words that differ;
 * a short form ("477 U.S. at 248") is read as a pin cite to the brief's own full citation; and its wording is corrected. See
 * check060 and quote060V010 below.
 */
const LEGAL_RULESET_V040 = { id: 'legal', version: '0.4.0', domain: 'legal' } as const
/**
 * 0.4.0's reading plus (2026-10-05, cold-review round 5; engine 0.6.0 and later only; docs/LEGAL.md): section awareness (./sections.ts),
 * where every PASS matched, the cite lookup with the pin, case name and parenthetical read off, a Lexis "Reporter" block bound,
 * every unread footnote-call form held as can't tell, and its claim name. See check060 and quote050 below.
 */
const LEGAL_RULESET_V050 = { id: 'legal', version: '0.5.0', domain: 'legal' } as const
/**
 * 0.5.0's reading plus (2026-10-06; engine 0.6.0 and later only; docs/LEGAL.md): a quotation that stops before its sentence ends is
 * never called "verbatim" (its PASS prints how the sentence continues), and is held when the continuation limits or negates it; a
 * fragment presented as a whole sentence is said to be one; em dashes, en dashes and "--" are one dash; "(citation omitted)",
 * "(cleaned up)", "(footnote omitted)", "(internal quotation marks omitted)" and "(alteration in original)" excuse what they name and
 * the PASS says what; Westlaw headnote numbers between sentences are read out; a sentence ends after a number; differences are named
 * as printed (punctuation included) and an insertion is answered by removing it; a footnote-call can't tell never asks for an edited
 * download; a "Dissent by:" line is named for what it is. See check060 and quote051 below.
 */
const LEGAL_RULESET_V051 = { id: 'legal', version: '0.5.1', domain: 'legal' } as const
/**
 * 0.5.1's reading plus (2026-10-06, later that day; engine 0.6.0 and later only; docs/LEGAL.md): the words before a quotation that begins
 * mid-sentence printed beside its PASS, and read for whose words follow (reported speech, a counterfactual, a rejected reading, a question:
 * can't tell); a plurality named; a Westlaw PDF's page furniture and a Lexis headnote marker read out; a KeyCite flag skipped and the "All
 * Citations" lines read for the caption; a FAIL's words left out read with the quotation's ellipses. See check060, quote050 and quote051.
 */
const LEGAL_RULESET_V052 = { id: 'legal', version: '0.5.2', domain: 'legal' } as const
/**
 * 0.5.2's reading plus (2026-10-13; docs/LEGAL.md): a separate opinion's designation read whatever stands between its author and its role
 * (a join clause "with whom … joins except as to Part IV,"); a lead-in read with its verb's inflections and the words after it, and the
 * sentences after one that introduces another's view held until the court speaks again; a quotation inside the opinion's own quotation of
 * another source named as one, and failed when the court's next words reject it; a running header's parallel citations read by their
 * shape; "(citations omitted)" read over a citation clause; a FAIL that rests only on words shaped like a citation or a running header
 * answered can't tell; a negation read up to "but". See check060, quote050 and quote051 (`v053`).
 */
const LEGAL_RULESET_V053 = { id: 'legal', version: '0.5.3', domain: 'legal' } as const
/**
 * 0.5.3's reading plus (2026-10-14; docs/LEGAL.md): a "(quoting …)" parenthetical inside the quotation read as the brief's own; an
 * unbracketed first-letter case change held; an ellipsis over a part of a condition held, one over a whole "not X, but" contrast passed; a
 * negation's clause ended at ", and"; a party's filing read as a speaker; a headnote-marked sentence read as the court's own; six more
 * separate-opinion designation styles; a Westlaw or Lexis database number read as a caption's citation. See check060, quote050 and quote051 (`v054`).
 */
const LEGAL_RULESET_V054 = { id: 'legal', version: '0.5.4', domain: 'legal' } as const
/**
 * 0.5.4's reading plus (2026-10-19; docs/LEGAL.md): an ellipsis that omits words from inside a clause, a word of degree or frequency, a burden
 * or a part of a time phrase held; a bracket that inserts a word of degree, a word that says the opposite of its stem or an "-ly" adverb
 * failed, and any other inserted content word held; ligatures read as their letters; rule, code and Restatement citations read as citations;
 * the court's own judging sentence read as the court's, and a quoted standard the court departs from in its next sentence held; nine more
 * designation styles, two plurality forms and a district court's slip opinion read. See check060, quote050 and quote051 (`v055`).
 */
const LEGAL_RULESET_V055 = { id: 'legal', version: '0.5.5', domain: 'legal' } as const
export type LegalRuleset = typeof LEGAL_RULESET | typeof LEGAL_RULESET_V010 | typeof LEGAL_RULESET_V020 | typeof LEGAL_RULESET_V030 | typeof LEGAL_RULESET_V040 | typeof LEGAL_RULESET_V050 | typeof LEGAL_RULESET_V051 | typeof LEGAL_RULESET_V052 | typeof LEGAL_RULESET_V053 | typeof LEGAL_RULESET_V054 | typeof LEGAL_RULESET_V055
/**
 * Every legal rule this build can issue or re-perform, newest first. The default for a new verdict is 0.5.4 from the engine named in
 * V054_DEFAULT_ENGINE (2026-10-14, by LEGAL.md's rule 3: it closes the false-PASS classes two more cold readers found, six dissent
 * designation styles and a party's filing passed as the court's, and ends the false can't-tells on four genuine quotations and a
 * genuine "(quoting …)" quotation); 0.5.3 under engine 0.7.1 (2026-10-13, by the same rule); 0.5.2 under engines 0.6.0 and 0.7.0
 * (2026-10-06; 0.5.1 earlier that day; 0.5.0, 0.4.0, 0.3.0 and 0.2.0 on 2026-10-05); and 0.0.1 under earlier engines. A replay names
 * its version, so a verdict issued under 0.5.2 replays under 0.5.2. 0.5.5 (2026-10-19) is selectable by name and is the default from the
 * engine named in V055_DEFAULT_ENGINE only once this build carries that engine.
 */
export const LEGAL_RULESET_VERSIONS: readonly LegalRuleset[] = [LEGAL_RULESET_V055, LEGAL_RULESET_V054, LEGAL_RULESET_V053, LEGAL_RULESET_V052, LEGAL_RULESET_V051, LEGAL_RULESET_V050, LEGAL_RULESET_V040, LEGAL_RULESET_V030, LEGAL_RULESET_V020, LEGAL_RULESET_V010, LEGAL_RULESET]

/** The engine legal@0.5.3 arrived with (2026-10-13): a verdict under an earlier engine never names it, and 0.6.0 and 0.7.0 keep legal@0.5.2. */
const V053_ENGINE: EngineVersion = '0.7.1'
/** The engine legal@0.5.4 can be named under (2026-10-14): it was built on 0.7.1, so a 0.7.1 verdict may name it. */
const V054_ENGINE: EngineVersion = '0.7.1'
/**
 * The engine from which legal@0.5.4 is the DEFAULT for a new verdict: the first engine released after 0.7.1. Undefined until that release
 * names its engine here (the release that ships it sets this to its own version; 0.7.1 keeps legal@0.5.3 as its default, so every 0.7.1
 * verdict replays byte for byte).
 */
const V054_DEFAULT_ENGINE: EngineVersion | undefined = '0.7.2'
/** The engine legal@0.5.5 can be named under (2026-10-19): it was built on 0.7.2, so a 0.7.2 verdict may name it. */
const V055_ENGINE: EngineVersion = '0.7.2'
/**
 * The engine from which legal@0.5.5 is the DEFAULT for a new verdict: the first engine label opened after 0.7.2. It is written as a plain
 * string because that label does not exist yet: the default moves only once this build carries it (isRetainedEngine; engineAtLeast reads an
 * engine it does not carry as earlier than every one it does, so the guard is what keeps 0.7.2 on legal@0.5.4). Every 0.7.2 verdict keeps
 * legal@0.5.4 as its default and replays byte for byte.
 */
const V055_DEFAULT_ENGINE: string | undefined = '0.7.3'

/** The default legal rule for a new verdict under engine `engine` (this build's when absent): 0.5.5 from V055_DEFAULT_ENGINE once this build carries it, 0.5.4 from V054_DEFAULT_ENGINE, 0.5.3 from engine 0.7.1, 0.5.2 from 0.6.0, else 0.0.1. */
export function defaultLegalRuleset(engine?: string): LegalRuleset {
  const e = engineFor(engine)
  if (V055_DEFAULT_ENGINE !== undefined && isRetainedEngine(V055_DEFAULT_ENGINE) && engineAtLeast(e, V055_DEFAULT_ENGINE)) return LEGAL_RULESET_V055
  if (V054_DEFAULT_ENGINE !== undefined && engineAtLeast(e, V054_DEFAULT_ENGINE)) return LEGAL_RULESET_V054
  return engineAtLeast(e, V053_ENGINE) ? LEGAL_RULESET_V053 : engineAtLeast(e, '0.6.0') ? LEGAL_RULESET_V052 : LEGAL_RULESET
}

/** The name a legal claim carries: legal@0.5.0 says what is checked (the words, in the supplied text), never "accurately". */
const RULE_NAME = 'Citation quoted accurately'
const RULE_NAME_V050 = 'Quotation found as quoted in the supplied text'

/**
 * Resolve undefined or 'legal' (the default for the engine: defaultLegalRuleset), 'legal@<version>' or a ruleset ref. Unknown ids
 * or versions throw: a verdict is never issued under a rule that does not exist. legal@0.3.0 and 0.4.0 exist from engine 0.6.0
 * only: asked for under an earlier engine, they throw (an earlier engine never read them).
 */
export function resolveLegalRuleset(r?: string | { id: string; version: string }, engine?: string): LegalRuleset {
  if (r === undefined) return defaultLegalRuleset(engine)
  const [id, version] = typeof r === 'string' ? r.split('@') as [string, string | undefined] : [r.id, r.version]
  const hit = id === LEGAL_RULESET.id && (version === undefined ? defaultLegalRuleset(engine) : LEGAL_RULESET_VERSIONS.find(v => v.version === version))
  if (!hit) throw new Error(`unknown legal ruleset "${typeof r === 'string' ? r : `${r.id}@${r.version}`}"; known: ${LEGAL_RULESET_VERSIONS.map(v => `${v.id}@${v.version}`).join(', ')} (the default is legal@${defaultLegalRuleset().version} under this build's engine ${ENGINE_VERSION}, legal@0.5.2 under engines 0.6.0 and 0.7.0, legal@0.0.1 under earlier engines)`)
  if ((hit === LEGAL_RULESET_V030 || hit === LEGAL_RULESET_V040 || hit === LEGAL_RULESET_V050 || hit === LEGAL_RULESET_V051 || hit === LEGAL_RULESET_V052) && !engineAtLeast(engineFor(engine), '0.6.0')) throw new Error(`legal@${hit.version} needs engine 0.6.0 or later (asked for under engine ${String(engine)})`)
  if (hit === LEGAL_RULESET_V053 && !engineAtLeast(engineFor(engine), V053_ENGINE)) throw new Error(`legal@${hit.version} needs engine ${V053_ENGINE} or later (asked for under engine ${String(engine)})`)
  if (hit === LEGAL_RULESET_V054 && !engineAtLeast(engineFor(engine), V054_ENGINE)) throw new Error(`legal@${hit.version} needs engine ${V054_ENGINE} or later (asked for under engine ${String(engine)})`)
  if (hit === LEGAL_RULESET_V055 && !engineAtLeast(engineFor(engine), V055_ENGINE)) throw new Error(`legal@${hit.version} needs engine ${V055_ENGINE} or later (asked for under engine ${String(engine)})`)
  return hit
}

/**
 * Remedies, declared next to the rule (2026-10-02; docs/REMEDIES.md). A misquote is answered by correcting the brief: no
 * ruling makes a quotation accurate, so its FAIL names no authority. A can't-tell names what is missing (the opinion text,
 * the quoted language behind a proposition, the complete opinion) or, where the deterministic tier does not decide, the
 * attorney of record, for this verdict only.
 */
export const LEGAL_REMEDIES: RemedyTable = {
  CITE_VERBATIM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
        detail: 'The quotation attributed to {field} is not what the opinion says. The opinion reads: "{expected}". Conform the quotation to it, or cite the passage it comes from; the corrected brief is checked again.' },
    ],
    abstain: [
      { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' }, when: ['REFERENCE_NOT_PROVIDED'],
        detail: 'The text of the opinion cited as {field}: without it neither existence nor quotation can be checked.' },
      { kind: 'missing-operand', operand: { source: 'brief', path: '{claim}.quote' }, when: ['OUT_OF_RULESET_SCOPE'],
        detail: 'The language of {field} that supports the proposition, quoted, so it can be checked verbatim.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['OUT_OF_RULESET_SCOPE'],
        detail: 'Whether {field} stands for the proposition is a judgement the deterministic check does not make: the attorney of record decides, for this verdict only.' },
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with the negation that precedes it in the opinion, or quote a passage the cut does not invert.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the passage in context and decides, for this verdict only.' },
      { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' }, when: ['SPAN_NOT_FOUND'],
        detail: 'The complete text of {field}, or the pin cite where the passage appears. Until then the quotation is not confirmed: it may be fabricated.' },
    ],
  },
}

/**
 * legal@0.1.0's remedies. A FAIL on the corresponding passage is answered by conforming the quotation to it. A FAIL on the
 * nearest passage only (LEGAL_REMEDIES_V010_NEAREST) never says what the opinion reads there: the quotation is to be quoted
 * exactly from wherever it comes, or withdrawn. The can't-tells are 0.0.1's, except that a selective quotation may now be
 * an omission or an alteration, not only a cut after a negation.
 */
export const LEGAL_REMEDIES_V010: RemedyTable = {
  CITE_VERBATIM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
        detail: 'The quotation attributed to {field} is not in the opinion as quoted. The corresponding passage reads: "{expected}". Conform the quotation to it, or cite the passage it comes from; the corrected brief is checked again.' },
    ],
    abstain: [
      ...(LEGAL_REMEDIES.CITE_VERBATIM?.abstain ?? []).filter(s => !s.when?.includes('SELECTIVE_QUOTE')),
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with the negation the quotation leaves out or alters, or quote a passage the cut does not invert.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the passage in context and decides, for this verdict only.' },
    ],
  },
}
/** legal@0.1.0's FAIL when only a nearest passage was found (a partial match): see LEGAL_REMEDIES_V010. */
export const LEGAL_REMEDIES_V010_NEAREST: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} was not found as quoted in the opinion; the nearest passage is a partial match only: "{expected}". Quote the passage the quotation comes from exactly, or withdraw it; the corrected brief is checked again.' },
  ],
}

/**
 * legal@0.2.0's remedies (2026-10-03). The FAILs are 0.1.0's, plus one for an altered quotation (LEGAL_REMEDIES_V020_ALTERED).
 * A selective quotation may now be an omitted condition or reassigned inner quotation marks as well as a negation.
 */
export const LEGAL_REMEDIES_V020: RemedyTable = {
  CITE_VERBATIM: {
    fail: LEGAL_REMEDIES_V010.CITE_VERBATIM?.fail ?? [],
    abstain: [
      ...(LEGAL_REMEDIES_V010.CITE_VERBATIM?.abstain ?? []).filter(s => !s.when?.includes('SELECTIVE_QUOTE')),
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with what the quotation leaves out or changes (a negation, a condition, or the inner quotation marks that say whose words they are), or quote a passage the cut does not change.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the passage in context and decides, for this verdict only.' },
    ],
  },
}
/** legal@0.2.0's FAIL when a bracket alters the opinion's words (see LEGAL_REMEDIES_V020). */
export const LEGAL_REMEDIES_V020_ALTERED: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} changes the opinion\'s words in a bracket ({op:bracket} for "{op:replaces}"). Restore the opinion\'s word, or keep only a bracket that changes case, tense or a pronoun; the corrected brief is checked again.' },
  ],
}

/**
 * Engine 0.6.0 remedies (cold-review round 2, 2026-10-05), one table per rule. They say only what the engine knows: what the opinion
 * text SUPPLIED for the cite reads, never what "the opinion" says or that an authority is real. legal@0.0.1's nearest-passage
 * "conform the quotation to it" beside a coincidental 3-word match is retired: under engine 0.6.0 every rule names a passage
 * only on 0.1.0's rule (quotation.ts nearestPassage), so the corresponding passage is conformed to, a partial match is quoted
 * exactly or withdrawn, and anything less abstains as possibly fabricated. A text that does not name its cite is answered by
 * the right text (LEGAL_REMEDIES_060_UNBOUND). Engines before 0.6.0 answer from the tables above, unchanged.
 */
const FAIL_CORRESPONDING_060: RuleRemedies['fail'] = [
  { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
    detail: 'The quotation attributed to {field} is not found as quoted in the opinion text supplied for it; the corresponding passage there reads: "{expected}". Conform the quotation to it, or cite the passage it comes from; the corrected brief is checked again.' },
]
const REFERENCE_060 = { kind: 'missing-operand' as const, operand: { source: 'opinion', path: '{field}' }, when: ['REFERENCE_NOT_PROVIDED' as const],
  detail: 'The text of the opinion cited as {field}, with its caption and reporter citation: without it the quotation cannot be checked.' }
const withReference060 = (t: RemedyTable): RemedyTable => ({
  CITE_VERBATIM: {
    fail: FAIL_CORRESPONDING_060,
    abstain: (t.CITE_VERBATIM?.abstain ?? []).map(s => (s.when?.includes('REFERENCE_NOT_PROVIDED') ? REFERENCE_060 : s)),
  },
})
/** legal@0.0.1 under engine 0.6.0. */
export const LEGAL_REMEDIES_060: RemedyTable = withReference060(LEGAL_REMEDIES)
/** legal@0.1.0 under engine 0.6.0. */
export const LEGAL_REMEDIES_V010_060: RemedyTable = withReference060(LEGAL_REMEDIES_V010)
/** legal@0.2.0 under engine 0.6.0. */
export const LEGAL_REMEDIES_V020_060: RemedyTable = withReference060(LEGAL_REMEDIES_V020)
/** Every rule under engine 0.6.0: a FAIL on a partial match only. */
export const LEGAL_REMEDIES_060_NEAREST: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} was not found as quoted in the opinion text supplied for it; the nearest passage there is a partial match only: "{expected}". Quote the passage the quotation comes from exactly, or withdraw it; the corrected brief is checked again.' },
  ],
}
/** legal@0.2.0 under engine 0.6.0: a bracket that alters the words. */
export const LEGAL_REMEDIES_060_ALTERED: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} changes the words of the opinion text supplied for it in a bracket ({op:bracket} for "{op:replaces}"). Restore the word the text has, or keep only a bracket that changes case, tense or a pronoun; the corrected brief is checked again.' },
  ],
}
/** Every rule under engine 0.6.0: the supplied text does not name the cite (./binding.ts). */
export const LEGAL_REMEDIES_060_UNBOUND: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' },
      detail: 'The text of the opinion cited as {field}, with its caption and reporter citation. The supplied text does not name it, so it may be another opinion; the quotation is checked once the text names the authority. A text that names every party but not the reporter citation can instead be supplied with bind "parties": it is then checked, labelled as bound by parties only.' },
  ],
}

/**
 * legal@0.3.0's remedies (2026-10-05). 0.2.0's under engine 0.6.0, except: a selective quotation may also be a sentence cut
 * at an edge or a changed letter case; a text whose caption does not name the cite is answered by the captioned text
 * (LEGAL_REMEDIES_V030_UNBOUND); a quotation found in a text bound by parties only is answered by the reporter citation in its
 * caption, or by the attorney of record (LEGAL_REMEDIES_V030_PARTIES_ONLY).
 */
export const LEGAL_REMEDIES_V030: RemedyTable = {
  CITE_VERBATIM: {
    fail: FAIL_CORRESPONDING_060,
    abstain: [
      ...(LEGAL_REMEDIES_V020_060.CITE_VERBATIM?.abstain ?? []).filter(s => !s.when?.includes('SELECTIVE_QUOTE')),
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with what the quotation leaves out or changes (a negation; a condition, including one in the part of the sentence an ellipsis or a capital at the start or end of the quotation cuts off; the letter case; or the inner quotation marks that say whose words they are), or quote a passage the cut does not change.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the passage in context and decides, for this verdict only.' },
    ],
  },
}
/** legal@0.3.0: the caption of the supplied text does not name the cite (./binding.ts captionOf). */
export const LEGAL_REMEDIES_V030_UNBOUND: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' },
      detail: 'The text of the opinion cited as {field}, with the caption a reporter prints at its top: the case name and the reporter citation, on their own lines. The caption of the supplied text does not name it, so it may be another opinion, or one that cites it; the quotation is checked once the caption names the authority. A text whose caption names every party but not the reporter citation can be supplied with bind "parties": the quotation is then checked and left open.' },
  ],
}
/** legal@0.3.0: the quotation is in a text bound by parties only, which is never certified. */
export const LEGAL_REMEDIES_V030_PARTIES_ONLY: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' },
      detail: 'The reporter citation {field}, in the caption of the opinion text supplied for it (add the citation line a reporter prints, and say so in source). The quotation was found in the text; it is certified once the caption prints the citation.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'Or the attorney of record confirms that the supplied text is the opinion cited, not another opinion in the same case (the decision below, a remand, a rehearing), for this verdict only.' },
  ],
}

/**
 * legal@0.4.0's remedies (2026-10-05, cold-review round 4). 0.3.0's, except: a FAIL on the corresponding passage names the words that
 * differ and quotes the passage as whole sentences with page marks left out (the remedy never asks for a page marker); a selective
 * quotation may also begin mid-sentence after a condition or negation; a quotation that matches only with a possible page mark or
 * footnote numeral read out (UNPARSEABLE) is answered by a clean text or the attorney of record; a short form by the full
 * citation (LEGAL_REMEDIES_V040_SHORT_FORM); a text whose caption does not name the cite by the captioned text, with the caption
 * window stated (LEGAL_REMEDIES_V040_UNBOUND).
 */
export const LEGAL_REMEDIES_V040: RemedyTable = {
  CITE_VERBATIM: {
    fail: [
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
        detail: 'The quotation attributed to {field} is not found as quoted in the opinion text supplied for it. Where they differ: {op:differs}. Conform the quotation to the passage, or cite the passage it comes from; the corrected brief is checked again. The passage there reads: "{expected}"' },
    ],
    abstain: [
      ...(LEGAL_REMEDIES_V030.CITE_VERBATIM?.abstain ?? []).filter(s => !s.when?.includes('SELECTIVE_QUOTE')),
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with what the quotation leaves out or changes (a negation; a condition, including one in the part of the sentence before a quotation that begins mid-sentence, or that an ellipsis or a capital at the start or end of the quotation cuts off; the letter case; or the inner quotation marks that say whose words they are), or quote a passage the cut does not change.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the passage in context and decides, for this verdict only.' },
      { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' }, when: ['UNPARSEABLE'],
        detail: 'A clean copy of the opinion text supplied for {field}: without the page markers or footnote numbers inside the quoted words. The quotation is then checked against it.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['UNPARSEABLE'],
        detail: 'Or the attorney of record checks the quotation against the printed page, for this verdict only.' },
    ],
  },
}
/** legal@0.4.0: a short form ("477 U.S. at 248" with no full citation in the brief to point to, "Id.", "supra"). */
export const LEGAL_REMEDIES_V040_SHORT_FORM: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'brief', path: '{claim}.cite' },
      detail: 'The full citation for {field}: volume, reporter and first page (for example 477 U.S. 242), in this citation or once elsewhere in the same brief. A short form such as "477 U.S. at 248" is read as a pin cite to the one full citation of the brief it can point to; "Id." and "supra" are not resolved.' },
  ],
}
/** legal@0.4.0: the caption of the supplied text does not name the cite (./binding.ts captionOf), the caption window stated. */
export const LEGAL_REMEDIES_V040_UNBOUND: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' },
      detail: 'The text of the opinion cited as {field}, with the caption a reporter prints at its top: the case name on its own line, and the reporter citation on its own line at most three lines above it or two below it. The caption of the supplied text does not name it, so it may be another opinion, or one that cites it; the quotation is checked once the caption names the authority. A text whose caption names every party but not the reporter citation can be supplied with bind "parties": the quotation is then checked and left open.' },
  ],
}

/**
 * legal@0.5.0's remedies (2026-10-05, cold-review round 5). 0.4.0's, except: a citation no supplied text matched is answered by a text keyed
 * by its reporter citation (LEGAL_REMEDIES_V050 REFERENCE_NOT_PROVIDED); a quotation whose words are found only outside the opinion
 * it is attributed to (editorial matter, a separate opinion) by the opinion's own words or a parenthetical naming the separate opinion
 * (LEGAL_REMEDIES_V050_SECTION); a text whose caption does not name the cite by the captioned text, the Lexis "Reporter" line
 * included (LEGAL_REMEDIES_V050_UNBOUND).
 */
const REFERENCE_V050 = { kind: 'missing-operand' as const, operand: { source: 'opinion', path: '{field}' }, when: ['REFERENCE_NOT_PROVIDED' as const],
  detail: 'The text of the opinion cited as {field}, with its caption and reporter citation, keyed in the sources by its reporter citation (a pin page, the case name and a parenthetical are read off the citation; a parallel citation needs its own key, pointing at the same file), or named by the citation\'s source_key: without it the quotation cannot be checked.' }
export const LEGAL_REMEDIES_V050: RemedyTable = {
  CITE_VERBATIM: {
    fail: LEGAL_REMEDIES_V040.CITE_VERBATIM?.fail ?? [],
    abstain: (LEGAL_REMEDIES_V040.CITE_VERBATIM?.abstain ?? []).map(s => (s.when?.includes('REFERENCE_NOT_PROVIDED') ? REFERENCE_V050 : s)),
  },
}
/** legal@0.5.0: the quoted words appear only outside the opinion the citation is attributed to (./sections.ts). */
export const LEGAL_REMEDIES_V050_SECTION: RuleRemedies = {
  abstain: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'Quote the words of the majority opinion for the point, or say whose words they are: a separate opinion by a parenthetical in the citation ("(Brennan, J., dissenting)"), and the quotation is checked against that opinion. Editorial matter (a synopsis, headnotes, a case summary, the syllabus) is not the opinion and is never checked as it; the corrected brief is checked again.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the passage where it appears and decides, for this verdict only.' },
  ],
}
/** legal@0.5.0: the caption of the supplied text does not name the cite, the caption window and the Lexis "Reporter" block stated. */
export const LEGAL_REMEDIES_V050_UNBOUND: RuleRemedies = {
  abstain: [
    { kind: 'missing-operand', operand: { source: 'opinion', path: '{field}' },
      detail: 'The text of the opinion cited as {field}, with the caption a reporter prints at its top: the case name on its own line, and the reporter citation on its own line at most three lines above it or two below it, or on the line after a Lexis header\'s "Reporter" heading. The caption of the supplied text does not name it, so it may be another opinion, or one that cites it; the quotation is checked once the caption names the authority. A text whose caption names every party but not the reporter citation can be supplied with bind "parties": the quotation is then checked and left open.' },
  ],
}

/**
 * legal@0.5.1's remedies (2026-10-06). 0.5.0's, except: a selective quotation may also stop before a limitation its sentence goes on
 * to state; a quotation that matches only with a possible page mark or footnote call read out is answered by the printed page or a
 * "(footnote omitted)", never by an edited copy of the download (its sha256 is what the verdict records); a bracket that inserts a word
 * is answered by removing it (LEGAL_REMEDIES_V051_INSERTED); a citation left out of the quoted words without saying so by
 * "(citation omitted)" or an ellipsis (LEGAL_REMEDIES_V051_OMITTED_CITATION); words joined from passages farther apart than an
 * ellipsis is read for by quoting each on its own (LEGAL_REMEDIES_V051_STITCHED).
 */
export const LEGAL_REMEDIES_V051: RemedyTable = {
  CITE_VERBATIM: {
    fail: LEGAL_REMEDIES_V040.CITE_VERBATIM?.fail ?? [],
    abstain: [
      ...(LEGAL_REMEDIES_V050.CITE_VERBATIM?.abstain ?? []).filter(s => !s.when?.includes('SELECTIVE_QUOTE') && !s.when?.includes('UNPARSEABLE') && !s.when?.includes('OUT_OF_RULESET_SCOPE')),
      { kind: 'missing-operand', operand: { source: 'brief', path: '{claim}.quote' }, when: ['OUT_OF_RULESET_SCOPE'],
        detail: 'The language of {field} that supports the proposition, quoted, so it can be checked as quoted.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['OUT_OF_RULESET_SCOPE'],
        detail: 'Whether {field} stands for the proposition is a judgement this check does not make: the attorney of record decides, for this verdict only.' },
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['SELECTIVE_QUOTE'],
        detail: 'Quote the passage with what the quotation leaves out or changes: a negation; a condition or a limitation, including one in the part of the sentence before or after the quoted words, or one that an ellipsis or a capital at the start or end of the quotation cuts off; the letter case; or the inner quotation marks that say whose words they are. Or quote a passage the cut does not change; the corrected brief is checked again.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['SELECTIVE_QUOTE'],
        detail: 'The attorney of record reads the full sentence in the opinion text and decides, for this verdict only.' },
      { kind: 'authority', authority: 'attorney-of-record', when: ['UNPARSEABLE'],
        detail: 'The attorney of record checks the quoted words against the printed page, for this verdict only. Keep the download as delivered: its sha256 is what the verdict records, and an edited copy no longer matches the vendor\'s file.' },
      { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' }, when: ['UNPARSEABLE'],
        detail: 'If the token is a footnote call the quotation leaves out, say so after the quotation with "(footnote omitted)"; the corrected brief is checked again.' },
    ],
  },
}
/** legal@0.5.1: a bracket that inserts a word the text does not have there. */
export const LEGAL_REMEDIES_V051_INSERTED: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} inserts {op:bracket}, which the opinion text supplied for it does not have there. Remove the inserted {op:bracket}, or keep only a bracket that changes case, tense or a pronoun; the corrected brief is checked again.' },
  ],
}
/** legal@0.5.1: a citation inside the quoted words left out without an ellipsis or "(citation omitted)". */
export const LEGAL_REMEDIES_V051_OMITTED_CITATION: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} leaves out a citation that the opinion text supplied for it has inside the quoted words ({op:omitted}), and does not say so. Add "(citation omitted)" after the quotation, or mark the omission with an ellipsis; the corrected brief is checked again.' },
  ],
}
/** legal@0.5.1: an ellipsis that would stand for more of the text than an ellipsis is read for (words joined from two passages). */
export const LEGAL_REMEDIES_V051_STITCHED: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} joins words from two passages of the opinion text supplied for it, {op:apart} characters apart; an ellipsis is read for at most {op:limit}. Quote each passage on its own, or quote the omitted text; the corrected brief is checked again.' },
  ],
}

/**
 * legal@0.5.2's remedies (2026-10-06). 0.5.1's table, plus one answer: a quotation held because the words before it in its sentence
 * report another's position or frame it (a counterfactual, a rejected reading, a question) is answered by quoting it with those words, or
 * by quoting the opinion's own words (LEGAL_REMEDIES_V052_FRAMED; the claim marks it with `missing: ['lead_in']`).
 */
export const LEGAL_REMEDIES_V052: RemedyTable = LEGAL_REMEDIES_V051
export const LEGAL_REMEDIES_V052_FRAMED: RuleRemedies = {
  abstain: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'Quote the words with the lead-in that says whose they are or how the opinion frames them ("Appellant argues that …", "we might hold that …"), or quote the opinion\'s own words for the point; the corrected brief is checked again.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the full sentence in the opinion text and decides whether the opinion adopts the words, for this verdict only.' },
  ],
}

/**
 * legal@0.5.3's remedies (2026-10-13). 0.5.2's table, plus two answers. A quotation that matched a passage except for words shaped like a
 * citation or a page's running header, which the check did not read out, is answered by the printed page or "(citation omitted)", never
 * by changing the quotation (LEGAL_REMEDIES_V053_FURNITURE; the claim marks it with `missing: ['page_furniture']`). A quotation of words
 * the opinion quotes from another source and then rejects is answered by quoting the standard the court adopts
 * (LEGAL_REMEDIES_V053_REJECTED; its FAIL carries `rejected` among its operands).
 */
export const LEGAL_REMEDIES_V053: RemedyTable = LEGAL_REMEDIES_V052
export const LEGAL_REMEDIES_V053_FURNITURE: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record checks the quoted words against the printed page, for this verdict only: the words the opinion text supplied for {field} has there, and the quotation does not, are shaped like a citation or a page\'s running header, which this check did not read out. The quotation is not called a misquotation.' },
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'If those words are a citation the quotation leaves out, say so after it with "(citation omitted)"; the corrected brief is checked again.' },
  ],
}
export const LEGAL_REMEDIES_V053_REJECTED: RuleRemedies = {
  fail: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'The quotation attributed to {field} is a passage the opinion text supplied for it quotes from {op:rejected} and then rejects ({op:rejected_at}). Do not cite these words as the court\'s: quote the standard the court adopts, or cite the case for its rejection of them; the corrected brief is checked again.' },
  ],
}

/**
 * legal@0.5.4's remedies (2026-10-14). 0.5.3's table, plus one answer: a quotation held because it changes the case of its first letter
 * without a bracket is answered by writing the letter in brackets, or restoring it (LEGAL_REMEDIES_V054_CASE; the claim marks it with
 * `missing: ['letter_case']`).
 */
export const LEGAL_REMEDIES_V054: RemedyTable = LEGAL_REMEDIES_V053
export const LEGAL_REMEDIES_V054_CASE: RuleRemedies = {
  abstain: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'Write the letter the quotation changes in brackets ("[s]ummary judgment" for a sentence that begins "Summary judgment"), or restore the letter case the opinion text supplied for {field} has; the corrected brief is checked again.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the words in the opinion text and decides, for this verdict only.' },
  ],
}

/**
 * legal@0.5.5's remedies (2026-10-19). 0.5.4's table, plus three answers. A quotation held because its ellipsis omits words from inside a
 * clause, a word of degree or frequency, a burden or a part of a time phrase is answered by quoting the words left out, or by the attorney
 * of record (LEGAL_REMEDIES_V055_CUT; the claim marks it with `missing: ['elided_words']`). A quotation held because a bracket inserts a word
 * this check does not read is answered by removing the bracket, or by the attorney of record (LEGAL_REMEDIES_V055_INSERTED; `missing:
 * ['inserted_words']`). A quotation within the opinion that the court's next sentence may depart from is answered by the attorney of record
 * reading those sentences (LEGAL_REMEDIES_V055_DEPARTED; `missing: ['next_sentence']`).
 */
export const LEGAL_REMEDIES_V055: RemedyTable = LEGAL_REMEDIES_V054
export const LEGAL_REMEDIES_V055_CUT: RuleRemedies = {
  abstain: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'Quote the words the ellipsis leaves out, or end the quotation before them and quote what follows on its own; the corrected brief is checked again.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the full sentence in the opinion text supplied for {field} and decides whether the cut changes what the kept words say, for this verdict only.' },
  ],
}
export const LEGAL_REMEDIES_V055_INSERTED: RuleRemedies = {
  abstain: [
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'Remove the inserted bracket, or keep only a bracket that changes case, tense or a pronoun, or names what a pronoun refers to; the corrected brief is checked again.' },
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the passage in the opinion text supplied for {field} and decides whether the inserted words change what it says, for this verdict only.' },
  ],
}
export const LEGAL_REMEDIES_V055_DEPARTED: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'attorney-of-record',
      detail: 'The attorney of record reads the sentences after the quoted words in the opinion text supplied for {field} and decides whether the court adopts them or departs from them, for this verdict only.' },
    { kind: 'recompute-with', operand: { source: 'brief', path: '{claim}.quote' },
      detail: 'If the court departs from them, quote the standard it adopts, or cite the case for its departure from them; the corrected brief is checked again.' },
  ],
}

/** The remedy table a legal verdict is answered from, per version (engine 0.2.0 binds its hash into the verdict id). */
function legalRemedyTable(r: LegalRuleset, engine?: EngineVersion): unknown {
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V055) {
    return { table: LEGAL_REMEDIES_V055, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, inserted: LEGAL_REMEDIES_V051_INSERTED, omittedCitation: LEGAL_REMEDIES_V051_OMITTED_CITATION, stitched: LEGAL_REMEDIES_V051_STITCHED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION, framed: LEGAL_REMEDIES_V052_FRAMED, furniture: LEGAL_REMEDIES_V053_FURNITURE, rejected: LEGAL_REMEDIES_V053_REJECTED, letterCase: LEGAL_REMEDIES_V054_CASE, cut: LEGAL_REMEDIES_V055_CUT, insertedUnread: LEGAL_REMEDIES_V055_INSERTED, departed: LEGAL_REMEDIES_V055_DEPARTED }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V054) {
    return { table: LEGAL_REMEDIES_V054, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, inserted: LEGAL_REMEDIES_V051_INSERTED, omittedCitation: LEGAL_REMEDIES_V051_OMITTED_CITATION, stitched: LEGAL_REMEDIES_V051_STITCHED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION, framed: LEGAL_REMEDIES_V052_FRAMED, furniture: LEGAL_REMEDIES_V053_FURNITURE, rejected: LEGAL_REMEDIES_V053_REJECTED, letterCase: LEGAL_REMEDIES_V054_CASE }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V053) {
    return { table: LEGAL_REMEDIES_V053, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, inserted: LEGAL_REMEDIES_V051_INSERTED, omittedCitation: LEGAL_REMEDIES_V051_OMITTED_CITATION, stitched: LEGAL_REMEDIES_V051_STITCHED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION, framed: LEGAL_REMEDIES_V052_FRAMED, furniture: LEGAL_REMEDIES_V053_FURNITURE, rejected: LEGAL_REMEDIES_V053_REJECTED }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V052) {
    return { table: LEGAL_REMEDIES_V052, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, inserted: LEGAL_REMEDIES_V051_INSERTED, omittedCitation: LEGAL_REMEDIES_V051_OMITTED_CITATION, stitched: LEGAL_REMEDIES_V051_STITCHED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION, framed: LEGAL_REMEDIES_V052_FRAMED }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V051) {
    return { table: LEGAL_REMEDIES_V051, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, inserted: LEGAL_REMEDIES_V051_INSERTED, omittedCitation: LEGAL_REMEDIES_V051_OMITTED_CITATION, stitched: LEGAL_REMEDIES_V051_STITCHED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V050) {
    return { table: LEGAL_REMEDIES_V050, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V050_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM, section: LEGAL_REMEDIES_V050_SECTION }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V040) {
    return { table: LEGAL_REMEDIES_V040, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V040_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED, shortForm: LEGAL_REMEDIES_V040_SHORT_FORM }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0') && r === LEGAL_RULESET_V030) {
    return { table: LEGAL_REMEDIES_V030, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_V030_UNBOUND, partiesOnly: LEGAL_REMEDIES_V030_PARTIES_ONLY, altered: LEGAL_REMEDIES_060_ALTERED }
  }
  if (engine !== undefined && engineAtLeast(engine, '0.6.0')) {
    const table = r === LEGAL_RULESET_V020 ? LEGAL_REMEDIES_V020_060 : r === LEGAL_RULESET_V010 ? LEGAL_REMEDIES_V010_060 : LEGAL_REMEDIES_060
    return { table, nearest: LEGAL_REMEDIES_060_NEAREST, unbound: LEGAL_REMEDIES_060_UNBOUND, ...(r === LEGAL_RULESET_V020 ? { altered: LEGAL_REMEDIES_060_ALTERED } : {}) }
  }
  if (r === LEGAL_RULESET_V020) return { table: LEGAL_REMEDIES_V020, nearest: LEGAL_REMEDIES_V010_NEAREST, altered: LEGAL_REMEDIES_V020_ALTERED }
  if (r === LEGAL_RULESET_V010) return { table: LEGAL_REMEDIES_V010, nearest: LEGAL_REMEDIES_V010_NEAREST }
  return LEGAL_REMEDIES
}

export interface Citation {
  /** Stable id for the claim (e.g. "brief:p4n2"). */
  id: string
  /** The reporter citation, recorded (e.g. "550 U.S. 544"). */
  cite?: string
  /** The case name, recorded (e.g. "Bell Atlantic Corp. v. Twombly"). */
  case_name?: string
  /** The passage the brief attributes to the authority — the thing we verify verbatim. */
  quote?: string
  /** What the brief says the authority stands for — NOT decided deterministically (semantic). */
  proposition?: string
  /** Which supplied opinion text to check against. Defaults to cite, then case_name, then id. */
  source_key?: string
}

/**
 * Opinion texts keyed by cite / case_name / source_key. A value is the text, or (engine 0.6.0) the text with where it came
 * from (`{ text, source?, url?, retrieved_at? }`, recorded in the verdict's `opinion_sources`). Engines before 0.6.0 read
 * string values only, as they always did.
 */
export type OpinionSources = Record<string, string | OpinionText>

/** A legal verdict: the standard proof object, plus (engine 0.6.0) the provenance of every supplied opinion text. */
export type LegalVerdict = Verdict & { opinion_sources?: OpinionProvenance[] }

export interface VerifyCitationsOptions {
  producer?: string
  now?: () => Date
  /** 'legal' or 'legal@0.0.1' (the default), or 'legal@0.1.0' (reads quotation conventions). See resolveLegalRuleset. */
  ruleset?: string | { id: string; version: string }
  /** The engine version to re-perform under (2026-10-03, version.ts engineFor): this build's when absent, or an earlier one it retains. For replay. */
  engine?: string
}

function spanEvidence(sourceHash: string, span: { start: number; end: number }, text: string): Evidence {
  return { locator: { kind: 'span', source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: 'QUOTE' }
}

/**
 * Does a negation immediately precede `start` in the source, within the same clause? A verbatim quote lifted from
 * "We do NOT hold that X" while dropping "do not" is the classic meaning-inverting selective quotation — technically
 * present, materially false. We cannot certify such a quote as accurate. (red-team break, 2026-09-22.)
 */
const NEGATION = /\b(?:not|no|never|cannot|can't|don't|doesn't|didn't|nor|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|reject\w*|decline[ds]?)\b/i
function precededByNegation(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 80), start)
  const clause = before.split(/[.;:!?]/).pop() ?? before // only within the same sentence/clause
  return NEGATION.test(clause)
}

function resolveSource(c: Citation, sources: Record<string, string>): { key: string; text: string } | null {
  for (const k of [c.source_key, c.cite, c.case_name, c.id]) {
    if (k !== undefined && typeof sources[k] === 'string' && sources[k].length > 0) return { key: k, text: sources[k] }
  }
  return null
}

/**
 * Check one citation. `engine` is this build's when absent (version.ts engineFor); engines before 0.6.0 answer exactly as
 * they always did (the body below), engine 0.6.0 and later through check060 (binding, provenance, wording; see the header).
 */
export function verifyCitation(c: Citation, sources: OpinionSources, ruleset?: string | { id: string; version: string }, engine?: string): ClaimVerdict {
  const e = engineFor(engine)
  if (engineAtLeast(e, '0.6.0')) return check060(c, sources, resolveLegalRuleset(ruleset, e)).claim
  if (ruleset !== undefined) resolveLegalRuleset(ruleset, e) // legal@0.3.0 under an earlier engine throws: it never read it
  return verifyCitationLegacy(c, sources as Record<string, string>, ruleset)
}

/** Engines 0.0.1 to 0.5.0: unchanged, byte for byte (replay re-performs their verdicts through here). */
function verifyCitationLegacy(c: Citation, sources: Record<string, string>, ruleset?: string | { id: string; version: string }): ClaimVerdict {
  if (ruleset !== undefined && resolveLegalRuleset(ruleset) === LEGAL_RULESET_V010) return verifyCitationV010(c, sources)
  if (ruleset !== undefined && resolveLegalRuleset(ruleset) === LEGAL_RULESET_V020) return verifyCitationV010(c, sources, true)
  const label = c.case_name ?? c.cite ?? c.id
  const base = {
    claim_id: `cite.${c.id}`, kind: 'QUOTE_MATCH' as const, tier: 'DETERMINISTIC' as const,
    field: c.cite ?? c.case_name ?? c.id, asserted: (c.quote ?? c.proposition ?? label) as string,
    rule_id: 'CITE_VERBATIM', rule_name: 'Citation quoted accurately',
  }

  const src = resolveSource(c, sources)
  if (!src) {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `no opinion text supplied for ${label}; existence and quotation cannot be verified without the source opinion. (Existence-only checking is a separate commodity; we verify the words.)` },
      locked: false, explanation: `No opinion text for ${label}; cannot verify.` }
  }

  if (c.quote === undefined || c.quote.trim().length === 0) {
    // Existence context is present (we have the opinion), but there is no quotation to check — only a proposition.
    return { ...base, outcome: 'INSUFFICIENT_DATA',
      evidence: [{ locator: { kind: 'field', source: 'contract', path: `opinion:${src.key}` }, value: label, confidence: 100, role: 'REFERENCE' }],
      insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `whether ${label} stands for the asserted proposition is a semantic judgement the deterministic tier does not make. Supply the quoted language to verify it verbatim, or await the REASONED tier.` },
      locked: false, explanation: `${label}: proposition not deterministically decidable; abstaining by design.` }
  }

  const { prepared, sourceHash } = preparedFor(src.text)
  const r = matchQuote(prepared, c.quote)
  if (r.found && r.span) {
    // The words appear verbatim — but if they are lifted from immediately after a negation the quotation drops, the
    // citation may invert the opinion's meaning. We will not certify accuracy in that case; we flag it for a human.
    if (precededByNegation(src.text, r.span.start)) {
      return { ...base, outcome: 'INSUFFICIENT_DATA',
        evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${label}, but immediately follow a negation in the opinion (e.g. "we do not hold that…") that the quotation omits. This may be a selective quotation that inverts the holding — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: quoted words present but preceded by a negation the quote omits; not certified — possible selective quotation.` }
    }
    return { ...base, outcome: 'PASS', locked: true,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? '')],
      explanation: `The quotation attributed to ${label} appears verbatim in the opinion.` }
  }
  if (r.reason === 'misquote_nearest' && r.nearest) {
    return { ...base, outcome: 'FAIL', locked: true,
      computation: { formula: 'brief_quote = opinion[cited passage]', operands: { brief_quote: c.quote, opinion_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `${label} is a real authority, but the quotation is not accurate. The opinion reads: "${r.nearest.text}".` }
  }
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quoted passage was not found in the supplied text of ${label}; it may be fabricated, or the supplied opinion text may be incomplete. Not confirmed — do not rely on this citation as quoted.` },
    locked: false, explanation: `${label}: quotation not located in the opinion; abstaining rather than asserting a fabrication.` }
}

/**
 * legal@0.1.0's check of one citation (./quotation.ts). Without opinion text or without a quotation it answers exactly as
 * 0.0.1 does; with both, it reads the quotation's conventions and says which it relied on.
 */
function verifyCitationV010(c: Citation, sources: Record<string, string>, v020 = false): ClaimVerdict {
  const src = resolveSource(c, sources)
  if (!src || c.quote === undefined || c.quote.trim().length === 0) return verifyCitationLegacy(c, sources)
  const label = c.case_name ?? c.cite ?? c.id
  const base = {
    claim_id: `cite.${c.id}`, kind: 'QUOTE_MATCH' as const, tier: 'DETERMINISTIC' as const,
    field: c.cite ?? c.case_name ?? c.id, asserted: c.quote,
    rule_id: 'CITE_VERBATIM', rule_name: 'Citation quoted accurately',
  }
  const { prepared, sourceHash } = legalPreparedFor(src.text)
  const r = readQuotation(prepared, c.quote)

  if (r.kind === 'match') {
    const ev = spanEvidence(sourceHash, r.span, r.text)
    if (r.notes.length > 0) ev.normalizations = r.notes
    // legal@0.2.0: did the conventions keep the meaning? (./quotation.ts meaningOf; PREREG order: altered, negation, condition,
    // nested, preceding negation)
    const m = v020 ? meaningOf(r, c.quote) : undefined
    if (m?.kind === 'altered') {
      return { ...base, outcome: 'FAIL', locked: true,
        computation: { formula: 'a bracket = the word it replaces (case, inflection), a pronoun or referent, or an insertion with no modal, negation, quantifier or limit', operands: { brief_quote: c.quote, opinion_says: r.text, bracket: m.bracket, replaces: m.replaced }, result: r.text },
        evidence: [ev],
        explanation: `The quotation attributed to ${label} alters the opinion's meaning: the bracket ${m.bracket} ${m.replaced === '' ? 'is an insertion' : `stands for "${m.replaced}"`}, and ${m.why}. The opinion reads: "${r.text}".` }
    }
    if (m?.kind === 'guarded-edge') {
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the bracketed alteration ${m.bracket} carries "${m.word}" (a modal, negation, quantifier or limit), and what it replaces in ${label} cannot be located to compare. This may alter the passage's meaning — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: a bracket carrying "${m.word}" could not be compared with the opinion; not certified.` }
    }
    if (r.selective) {
      const how = r.selective.via === 'ellipsis' ? 'an omission' : 'an alteration'
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${label}, but ${r.selective.detail}. This may be a selective quotation that inverts the passage — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: quoted words present, but ${how} in the quotation changes a negation; not certified — possible selective quotation.` }
    }
    if (m?.kind === 'condition') {
      const elided = m.elided.replace(/\s+/g, ' ').trim()
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${elided.length > 200 ? `${elided.slice(0, 96)} … ${elided.slice(-96)}` : elided}" from ${label}, which carries "${m.word}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ellipsis omits "${m.word}" and what it governs; not certified.` }
    }
    if (m?.kind === 'nested') {
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `nested quotation: ${m.detail}. Cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: nested quotation — the inner quotation marks do not match the opinion's; not certified.` }
    }
    if (precededByNegation(src.text, r.span.start)) {
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${label}, but immediately follow a negation in the opinion (e.g. "we do not hold that…") that the quotation omits. This may be a selective quotation that inverts the holding — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: quoted words present but preceded by a negation the quote omits; not certified — possible selective quotation.` }
    }
    return { ...base, outcome: 'PASS', locked: true, evidence: [ev],
      explanation: r.notes.length === 0
        ? `The quotation attributed to ${label} appears verbatim in the opinion.`
        : `The quotation attributed to ${label} appears in the opinion, read with the quotation conventions it uses: ${r.notes.join('; ')}.` }
  }

  if (r.kind === 'passage') {
    const corresponding = r.strength === 'corresponding'
    const pct = Math.round(r.similarity * 100)
    return { ...base, outcome: 'FAIL', locked: corresponding,
      computation: corresponding
        ? { formula: 'brief_quote = opinion[corresponding passage]', operands: { brief_quote: c.quote, opinion_says: r.text, anchor_words: r.anchorWords, similarity: r.similarity }, result: r.text }
        : { formula: 'brief_quote found in opinion (not found; nearest passage shown)', operands: { brief_quote: c.quote, nearest_passage: r.text, anchor_words: r.anchorWords, similarity: r.similarity }, result: r.text },
      evidence: [{ ...spanEvidence(sourceHash, r.span, r.text), role: corresponding ? 'QUOTE' : 'CONTEXT' }],
      explanation: corresponding
        ? `The quotation attributed to ${label} is not in the opinion as quoted. The corresponding passage reads: "${r.text}".`
        : `The quotation attributed to ${label} was not found as quoted in the opinion. The nearest passage, a partial match only (${r.anchorWords} consecutive words; ${pct}% of the quotation's words in order), is: "${r.text}".` }
  }

  const run = r.longestRun >= 3 ? ` The longest run of its words found in the opinion is ${r.longestRun} words, too few to name a passage.` : ''
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quoted passage was not found in the supplied text of ${label}; it may be fabricated, or the supplied opinion text may be incomplete. Not confirmed — do not rely on this citation as quoted.${run}` },
    locked: false, explanation: `${label}: quotation not located in the opinion; abstaining rather than asserting a fabrication.` }
}

// ── engine 0.6.0 (cold-review round 2, 2026-10-05) ─────────────────────────────────────────────────────────────────────────────────
//
// What changes, for every legal rule, from engine 0.6.0 (engines 0.0.1 to 0.5.0 answer through the legacy code above):
//  1. Provenance and binding (./binding.ts): every supplied opinion text is recorded (key, sha256, length, and the source, url
//     and retrieval date the caller states) in the verdict's `opinion_sources`; a quotation is checked only against a text that
//     names its cite (the parties of the case name, the reporter citation). A text that does not abstains: never PASS.
//  2. legal@0.0.1's not-found path: a passage is named only on 0.1.0's rule (quotation.ts nearestPassage), so an invented
//     quotation abstains as possibly fabricated instead of FAILing beside a coincidental 3-word match (a cold reader's (an AI agent's) probe).
//  3. Wording limited to what the engine knows: "the opinion text supplied for X", never "X is a real authority".
// The quotation rules themselves (0.0.1's verbatim match, 0.1.0's conventions, 0.2.0's meaning guard) are unchanged.

interface Checked060 { claim: ClaimVerdict; key?: string; naming?: CiteNaming }

function resolveSource060(c: Citation, sources: OpinionSources): { key: string; text: string } | null {
  for (const k of [c.source_key, c.cite, c.case_name, c.id]) {
    if (k === undefined || !Object.prototype.hasOwnProperty.call(sources, k)) continue
    const text = textOf(sources[k])
    if (text !== undefined) return { key: k, text }
  }
  return null
}

const suppliedFor = (label: string): string => `the opinion text supplied for ${label}`

// ── legal@0.5.0: the cite lookup (2026-10-05, cold-review round 5) ─────────────────────────────────────────────────────────────────────
//
// Engine 0.6.0's lookup is an exact match on source_key, then cite, then case_name, then id, so a brief's full citation with a pin
// ("477 U.S. 242, 248"), its Bluebook form ("Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)") and a parallel citation
// answered "No opinion text" for a text that was supplied (found by a cold reader, an AI agent), against LEGAL.md's "a pin cite is read
// for the case it names". legal@0.5.0 reads the citation's reporter citations off it (a parenthetical, the pin page and the case
// name before it read off) and, after source_key and the cite as written, matches each against the supplied keys, spacing and
// periods aside ("477 U. S. 242" is "477 U.S. 242"). Two keys that name the same citation match only when their texts are the
// same. The citation is then bound by that reporter citation and its case name (the brief's case_name, else the one the full
// citation prints), and the answer records how it read the citation (CiteNaming.read_as). The pin page is never checked.

// ── the citation readers, in one pass (2026-10-20) ──────────────────────────────────────────────────────────────────────────────────
//
// Both readers were regular expressions run on the citation as written, which is the caller's text. Their loop over capitalised
// words let a run of capitals split every way: the reporter pattern took about 0.1 s at 22 capitals and doubled with each one more
// (and was quadratic in a chain of short words), the database pattern was polynomial in a run of capitals after a year. Each reader
// below returns exactly what `text.matchAll(<pattern>)` returned, match for match, position, text and groups: the patterns are
// quoted on each, and test/legal-redos.test.ts compares the two on every citation in the legal fixtures and on generated probes.
// No verdict changes, so no rule version changes.

/** One match, shaped as `matchAll` returned it: the whole citation, then volume (or year), reporter words (or database), page (or number). */
type CiteMatch = [string, string, string, string] & { index: number }

const citeMatch = (text: string, at: number, end: number, a: string, b: string, c: string): CiteMatch =>
  Object.assign([text.slice(at, end), a, b, c] as [string, string, string, string], { index: at })

const CITE_HEAD = /(?<![\p{L}\p{N}])(\d{1,4})\s+/gu
const CITE_RUN = /[\p{L}\p{N}.'’]+/gu
const SPACING_ONLY = /^\s+$/u
const ORDINAL_OPENING = /\d{1,2}(?:d|st|nd|rd|th)\.?/uy
const ORDINAL_AFTER = /\d{1,2}(?:d|st|nd|rd|th)\b\.?/uy
const CITE_PAGE = /(\d{1,5})(?![\p{N}])/uy

/**
 * The reporter citations inside a string: volume, reporter words ("U.S.", "S. Ct.", "F.3d", "L. Ed. 2d"), first page. What this
 * pattern matched:
 *   /(?<![\p{L}\p{N}])(\d{1,4})\s+((?:[A-Z][\p{L}\p{N}.'’]*|\d{1,2}(?:d|st|nd|rd|th)\.?)(?:\s*(?:[A-Z][\p{L}\p{N}.'’]*|\d{1,2}(?:d|st|nd|rd|th)\b\.?))*)\s+(\d{1,5})(?![\p{N}])/gu
 * How it reads in one pass. The reporter words are whole runs of letters, numbers, periods and apostrophes with spacing between
 * them. A run is words when it opens with a capital (the word takes the rest of the run), or with an ordinal ("2d", "4th", a period
 * optional) that ends the run or is followed by more words; every ordinal but the citation's opening word is followed by no ASCII
 * letter, digit or underscore. Of the runs of words after a volume, the pattern took the furthest one that a page number follows,
 * and one pass from the right records that run for every run. Exported for its tests; not part of the package's entry point.
 */
export function reporterCitesIn(text: string): CiteMatch[] {
  const out: CiteMatch[] = []
  CITE_HEAD.lastIndex = 0
  let head = CITE_HEAD.exec(text)
  if (head === null) return out
  const starts: number[] = []
  const ends: number[] = []
  for (const m of text.matchAll(CITE_RUN)) { starts.push(m.index); ends.push(m.index + m[0].length) }
  const runAt = new Map(starts.map((s, i) => [s, i] as const))
  const words = (i: number, opening: boolean): boolean => {
    let p = starts[i] as number
    let o = opening
    for (;;) {
      const c = text.charCodeAt(p)
      if (c >= 65 && c <= 90) return true
      const re = o ? ORDINAL_OPENING : ORDINAL_AFTER
      re.lastIndex = p
      if (!re.test(text)) return false
      p = re.lastIndex
      if (p === ends[i]) return true
      o = false
    }
  }
  const pageAt = (i: number): boolean => { CITE_PAGE.lastIndex = starts[i] as number; return CITE_PAGE.test(text) }
  // furthest[i]: the furthest run k >= i with runs i+1..k words, spacing only from run i to run k+1, and a page opening run k+1 (-1: none)
  const furthest = new Int32Array(starts.length).fill(-1)
  for (let i = starts.length - 2; i >= 0; i--) {
    if (!SPACING_ONLY.test(text.slice(ends[i], starts[i + 1]))) continue
    if (furthest[i + 1] >= 0 && words(i + 1, false)) furthest[i] = furthest[i + 1]
    else if (pageAt(i + 1)) furthest[i] = i
  }
  while (head !== null) {
    const r = runAt.get(CITE_HEAD.lastIndex)
    if (r !== undefined && furthest[r] >= 0 && words(r, true)) {
      const k = furthest[r]
      CITE_PAGE.lastIndex = starts[k + 1] as number
      const page = CITE_PAGE.exec(text) as RegExpExecArray
      out.push(citeMatch(text, head.index, CITE_PAGE.lastIndex, head[1] as string, text.slice(starts[r], ends[k]), page[1] as string))
      CITE_HEAD.lastIndex = CITE_PAGE.lastIndex
    }
    head = CITE_HEAD.exec(text)
  }
  return out
}

const DATABASE_HEAD = /(?<![\p{L}\p{N}])(\d{4})\s+/gu
const DATABASE_SPAN = /[\p{L}.\s]*/uy
const DATABASE_NUMBER = /(\d{1,8})(?![\p{N}])/uy
const ONE_SPACE = /\s/u

/** The database the pattern below read: "WL", or "LEXIS" after up to four words that open with a capital, each followed by one space or none. */
function databaseWords(w: string): boolean {
  if (w === 'WL') return true
  if (!w.endsWith('LEXIS')) return false
  const before = w.slice(0, -5)
  if (before.length === 0) return true
  if (/\s\s/u.test(before)) return false
  const parts = before.split(/\s/u)
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.length <= 4 && parts.every(x => x.charCodeAt(0) >= 65 && x.charCodeAt(0) <= 90)
}

/**
 * legal@0.5.4: the Westlaw or Lexis database numbers inside a string ("2025 WL 1188234", "2024 U.S. Dist. LEXIS 48213"): a year, the
 * database, up to eight digits. What this pattern matched:
 *   /(?<![\p{L}\p{N}])(\d{4})\s+(WL|(?:[A-Z][\p{L}.]*\s?){0,4}LEXIS)\s+(\d{1,8})(?![\p{N}])/gu
 * How it reads in one pass. Everything between the year's spacing and the number is letters, periods and spacing, so the database
 * is that stretch less its closing spacing, and it is read whole (databaseWords). Exported for its tests; not part of the package's
 * entry point.
 */
export function databaseCitesIn(text: string): CiteMatch[] {
  const out: CiteMatch[] = []
  DATABASE_HEAD.lastIndex = 0
  let head: RegExpExecArray | null
  while ((head = DATABASE_HEAD.exec(text)) !== null) {
    const from = DATABASE_HEAD.lastIndex
    DATABASE_SPAN.lastIndex = from
    DATABASE_SPAN.test(text)
    const spanEnd = DATABASE_SPAN.lastIndex
    let to = spanEnd
    while (to > from && ONE_SPACE.test(text[to - 1] as string)) to--
    if (to === spanEnd || to === from) continue
    DATABASE_NUMBER.lastIndex = spanEnd
    const n = DATABASE_NUMBER.exec(text)
    if (n === null) continue
    const w = text.slice(from, to)
    if (!databaseWords(w)) continue
    out.push(citeMatch(text, head.index, DATABASE_NUMBER.lastIndex, head[1] as string, w, n[1] as string))
    DATABASE_HEAD.lastIndex = DATABASE_NUMBER.lastIndex
  }
  return out
}

/**
 * `s.replace(/[\s,;]+$/u, '')` (2026-10-20, in one pass): the closing run of spacing, commas and semicolons read off. The pattern tried
 * every position of a long run that something else closes, each to the run's end. Exported for its tests; not part of the package's
 * entry point.
 */
export function withoutClosingSeparators(s: string): string {
  let e = s.length
  while (e > 0 && (spacingAt(s, e - 1) || s[e - 1] === ',' || s[e - 1] === ';')) e--
  return s.slice(0, e)
}

/** A citation as written, read for its parts: its reporter citations in order, the pin page after the first, the case name before it. legal@0.5.4 (`v054`) reads a database number as one. */
function citeParts(written: string, v054 = false): { cores: string[]; pin?: string; caseName?: string } {
  const stripped = written.replace(/\([^()]*\)/g, ' ')
  const cores: { core: string; at: number; end: number }[] = []
  for (const m of reporterCitesIn(stripped)) {
    if (!/\p{L}/u.test(m[2] as string)) continue
    cores.push({ core: `${m[1]} ${(m[2] as string).replace(/\s+/g, ' ').trim()} ${m[3]}`, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  if (v054) {
    for (const m of databaseCitesIn(stripped)) {
      const at = m.index ?? 0
      if (cores.some(c => at < c.end && at + m[0].length > c.at)) continue
      cores.push({ core: `${m[1]} ${(m[2] as string).replace(/\s+/g, ' ').trim()} ${m[3]}`, at, end: at + m[0].length })
    }
    cores.sort((a, b) => a.at - b.at)
  }
  if (cores.length === 0) return { cores: [] }
  const first = cores[0]!
  const pin = /^\s*,\s*(\d{1,5}(?:\s*[-–]\s*\d{1,5})?(?:\s*nn?\.\s*\d{1,3})?)(?!\s*[A-Za-z])/u.exec(stripped.slice(first.end))?.[1]
  const before = withoutClosingSeparators(stripped.slice(0, first.at)).trim()
  const caseName = /\sv\.?\s|^in\s+re\b|^ex\s+parte\b|^matter\s+of\b/iu.test(before) ? before : undefined
  return { cores: cores.map(x => x.core), ...(pin !== undefined ? { pin } : {}), ...(caseName !== undefined ? { caseName } : {}) }
}

/** A reporter citation as a comparison key (volume, reporter words without spacing or periods, page), or undefined. */
const citeKey = (s: string): string | undefined => {
  const p = parseReporterCite(s)
  return p ? `${p.volume} ${p.reporter.join(' ').toLowerCase()} ${p.page}` : undefined
}

// ── a brief's citations, read once (2026-10-20) ─────────────────────────────────────────────────────────────────────────────────────
//
// Two readings were made again for every citation, so their cost grew with the square of the number of citations: a short form read
// every citation of the brief to find the full citations it can point to (shortFormOf), and a citation looked up by its reporter
// citation read every supplied key (lookup050). At 4,000 citations of genuine length they took 17 s and 27 s. Each now reads the brief
// once, the first time it is needed, into an index kept for that one call (BriefIndex): the full citations by volume and reporter, and
// the keys by the reporter citation each reads as. Three smaller readings of the same shape go the same way: the list of supplied texts a
// miss prints (suppliedKeys, once), and the namings of each text that the choice ledger and the provenance record (grouped by key once:
// bindingChoices, binding.ts provenanceOf). Nothing is kept between calls, so a brief or sources object the caller changes is read
// afresh. Each answers what the loop it replaces answered, in the same order (test/legal-cite-index.test.ts): no verdict changes, so no
// rule version changes.

/**
 * A full citation of the brief as a short form reads it: its position, its volume, reporter and first page (`key`), that page as a
 * number, and its case name (the one it carries, else, under legal@0.5.0, the one its cite prints).
 */
interface FullCite { o: Citation; at: number; key: string; page: number; name: string | undefined }
/**
 * The full citations of one volume and reporter, in brief order; then, made the first time a short form asks, the same sorted by first
 * page (`byPage`, `pages`), and the first of each volume, reporter and first page, sorted the same way (`firsts`, `firstPages`).
 */
interface FullCiteGroup { list: FullCite[]; byPage?: FullCite[]; pages?: number[]; firsts?: FullCite[]; firstPages?: number[] }
/** The supplied keys that read as one reporter citation (citeKey), in the order Object.keys gives them; whether they all hold one text; their list as a miss prints it. */
interface KeyGroup { keys: string[]; same: boolean; listed?: string }
/** What one call of the citations check reads once, for one brief (`all`) and one sources object (above). */
interface BriefIndex { all: readonly Citation[]; sources: OpinionSources; full040?: Map<string, FullCiteGroup>; full050?: Map<string, FullCiteGroup>; keys?: Map<string, KeyGroup>; supplied?: string }
const briefIndex = (all: readonly Citation[], sources: OpinionSources): BriefIndex => ({ all, sources })

/**
 * The brief's full citations by volume and reporter: each citation whose cite is not "Id.", "supra" or a short form, read as legal@0.4.0
 * reads it (parseReporterCite) or, under legal@0.5.0 (`v050`), by its first reporter citation (citeParts). This is the pass each short
 * form made over the whole brief, made once. A short form is never one of them, so the one being resolved never meets itself.
 */
function fullCitesOf(all: readonly Citation[], v050: boolean): Map<string, FullCiteGroup> {
  const groups = new Map<string, FullCiteGroup>()
  for (let at = 0; at < all.length; at++) {
    const o = all[at] as Citation
    if (o.cite === undefined) continue
    const oc = o.cite.trim()
    if (ID_FORM.test(oc) || SUPRA_FORM.test(oc) || shortFormParts(oc) !== null) continue
    const parts = v050 ? citeParts(oc) : undefined
    const first = parts !== undefined ? parts.cores[0] : undefined
    const p = v050 ? (first !== undefined ? parseReporterCite(first) : undefined) : parseReporterCite(oc)
    if (!p) continue
    const volumeReporter = `${p.volume} ${p.reporter.join(' ').toLowerCase()}`
    let group = groups.get(volumeReporter)
    if (group === undefined) { group = { list: [] }; groups.set(volumeReporter, group) }
    group.list.push({ o, at, key: `${volumeReporter} ${p.page}`, page: Number(p.page), name: o.case_name ?? parts?.caseName })
  }
  return groups
}

/** Lower first page first; at one page, earlier in the brief first. */
const byFirstPage = (a: FullCite, b: FullCite): number => (a.page < b.page ? -1 : a.page > b.page ? 1 : a.at - b.at)
/** How many of `pages` (ascending) are at or before `pin`. */
function atOrBefore(pages: readonly number[], pin: number): number {
  let lo = 0
  let hi = pages.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((pages[mid] as number) <= pin) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The full citations a short form can point to, in brief order (shortFormOf's rule): same volume and reporter, a first page at or
 * before the pin, and, when the short form names a case, every party of that name named in the full citation's case name; one for each
 * volume, reporter and first page, the first the brief gives that passes. Without a case name, the first of each volume, reporter and
 * first page at or before the pin is found by a search of the group's sorted pages; with one, each full citation at or before the pin is
 * read for its parties, as before.
 */
function pointsTo(c: Citation, ix: BriefIndex, v050: boolean, volume: string, reporter: string, pin: number): Citation[] {
  const groups = v050 ? (ix.full050 ??= fullCitesOf(ix.all, true)) : (ix.full040 ??= fullCitesOf(ix.all, false))
  const g = groups.get(`${volume} ${reporter}`)
  if (g === undefined) return []
  if (g.byPage === undefined) {
    g.byPage = [...g.list].sort(byFirstPage)
    g.pages = g.byPage.map(f => f.page)
    const firsts = new Map<string, FullCite>()
    for (const f of g.list) if (!firsts.has(f.key)) firsts.set(f.key, f)
    g.firsts = [...firsts.values()].sort(byFirstPage)
    g.firstPages = g.firsts.map(f => f.page)
  }
  const n = atOrBefore(g.pages as number[], pin)
  if (n === 0) return []
  let chosen: FullCite[]
  if (!(c.case_name !== undefined && c.case_name.trim().length > 0)) chosen = (g.firsts as FullCite[]).slice(0, atOrBefore(g.firstPages as number[], pin))
  else {
    // each party's words read once for this short form (partyNamer), then tested against each full citation's case name
    const parties = partiesOf(c.case_name).map(party => partyNamer(party))
    const first = new Map<string, FullCite>()
    for (let i = 0; i < n; i++) {
      const f = (g.byPage as FullCite[])[i] as FullCite
      if (!parties.every(named => named(f.name ?? ''))) continue
      const had = first.get(f.key)
      if (had === undefined || f.at < had.at) first.set(f.key, f)
    }
    chosen = [...first.values()]
  }
  return chosen.sort((a, b) => a.at - b.at).map(f => f.o)
}

/** The supplied keys by the reporter citation each reads as (citeKey), in the order Object.keys gives them: lookup050's pass over every key, made once. */
function keysByCite(sources: OpinionSources): Map<string, KeyGroup> {
  const out = new Map<string, KeyGroup>()
  for (const k of Object.keys(sources)) {
    if (!Object.prototype.hasOwnProperty.call(sources, k) || textOf(sources[k]) === undefined) continue
    const want = citeKey(k)
    if (want === undefined) continue
    const g = out.get(want)
    if (g === undefined) out.set(want, { keys: [k], same: true })
    else g.keys.push(k)
  }
  for (const g of out.values()) {
    const text = textOf(sources[g.keys[0] as string])
    g.same = g.keys.every(k => textOf(sources[k]) === text)
  }
  return out
}

interface Lookup050 { src?: { key: string; text: string }; ec: Citation; tried: string[]; readAs?: { written: string; reads: string; pin?: string } }

/** legal@0.5.0: the supplied text for a citation, and the citation as it is bound (above). legal@0.5.4 (`v054`) reads a database number as a citation. */
function lookup050(c: Citation, sources: OpinionSources, ix: BriefIndex, v054 = false): Lookup050 {
  const tried: string[] = []
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(sources, k) && textOf(sources[k]) !== undefined
  const written = c.cite !== undefined && c.cite.trim().length > 0 ? c.cite.trim() : undefined
  const parts = written !== undefined ? citeParts(written, v054) : undefined
  let hit: string | undefined
  let core: string | undefined
  if (c.source_key !== undefined) { tried.push(`source_key "${c.source_key}"`); if (has(c.source_key)) hit = c.source_key }
  if (hit === undefined && c.cite !== undefined) { tried.push(`cite "${c.cite}"`); if (has(c.cite)) hit = c.cite }
  if (hit === undefined && parts) {
    for (const p of parts.cores) {
      const want = citeKey(p)
      if (want === undefined) continue
      // the supplied keys that read as this reporter citation, in the order Object.keys gives them (keysByCite: read once per call)
      const named = (ix.keys ??= keysByCite(sources)).get(want)
      const keys = named?.keys ?? []
      if (p !== written) tried.push(`reporter citation ${p}`)
      if (named !== undefined && named.same) { hit = keys[0]; core = p; break }
      if (named !== undefined && keys.length > 1) tried.push(`(${keys.length} different texts are keyed ${p}: ${named.listed ??= keys.join(', ')})`)
    }
  }
  if (hit === undefined && c.case_name !== undefined && c.case_name.length > 0) { tried.push(`case name "${c.case_name}"`); if (has(c.case_name)) hit = c.case_name }
  if (hit === undefined) { tried.push(`id "${c.id}"`); if (has(c.id)) hit = c.id }
  // the citation is bound as written when it already reads as a reporter citation (a pin page after a comma and a closing
  // parenthetical are read off by the binding itself, and "5 U.S. (1 Cranch) 137" is bound as the caption prints it); a citation
  // that opens with its case name ("Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)") is bound by the reporter citation
  // read off it, or by the one that found its text
  const asWritten = written !== undefined && parseReporterCite(written) !== undefined && (core === undefined || parts?.cores[0] === core)
  const reads = asWritten ? written : core ?? parts?.cores[0]
  const caseName = c.case_name !== undefined && c.case_name.trim().length > 0 ? c.case_name : parts?.caseName
  const ec: Citation = reads !== undefined && written !== undefined && (reads !== written || caseName !== c.case_name)
    ? { ...c, cite: reads, ...(caseName !== undefined ? { case_name: caseName } : {}) } : c
  // how the citation was read, whenever it carried more than its reporter citation (bound as written or not): the reporter citation
  // looked up, and a pin page, which is never checked
  const looked = core ?? parts?.cores[0]
  const readAs = looked !== undefined && written !== undefined && (looked !== written || parts?.pin !== undefined) ? { written, reads: looked, ...(parts?.pin !== undefined ? { pin: parts.pin } : {}) } : undefined
  return { ...(hit !== undefined ? { src: { key: hit, text: textOf(sources[hit]) as string } } : {}), ec, tried, ...(readAs ? { readAs } : {}) }
}

/** The supplied texts' keys, as a miss lists them (at most ten, then how many more). */
function suppliedKeys(sources: OpinionSources): string {
  const keys = Object.keys(sources).filter(k => textOf(sources[k]) !== undefined)
  if (keys.length === 0) return 'none'
  return keys.length <= 10 ? keys.join(', ') : `${keys.slice(0, 10).join(', ')} and ${keys.length - 10} more`
}

// ── legal@0.4.0: short forms (2026-10-05, cold-review round 4) ─────────────────────────────────────────────────────────────────────
//
// Most quotations in a brief sit under a short form. legal@0.3.0 read "477 U.S. at 248" as a reporter citation the caption must
// print, and refused it as "the caption does not print the reporter citation 477 U.S. at 248". legal@0.4.0 reads it as a pin cite
// to a full citation the same brief gives: same volume and reporter, a first page at or before the pin page, and (when the short
// form names a case) every party of that name named in the full citation's case name. Exactly one such full citation: the
// quotation is checked as that citation's (its text, its caption), and the answer says it read the short form so. None, or more
// than one: can't tell, "short form; supply the full citation". "Id." and "supra" are never resolved (they point to whatever the
// brief cited last, which a list of citations does not record): can't tell, the same way.

const ID_FORM = /^(?:id|ibid)\.?(?:,?\s+at\s+.*)?$/iu
const SUPRA_FORM = /\bsupra\b/iu
/** The scratch tables of shortFormParts, kept between calls for strings up to SHORT_FORM_REUSE characters (one call at a time per thread). */
const SHORT_FORM_REUSE = 4096
let SHORT_FORM_INTS = new Int32Array(5 * 258)
let SHORT_FORM_BYTES = new Uint8Array(257)
/** Spacing, "at" in either case, spacing: a short form has it after its volume (fixed length, so it cannot backtrack). */
const SPACED_AT = /\s[aA][tT]\s/g
/**
 * "477 U.S. at 248", "477 U.S. at 248-49", "477 U.S. at 248 n.4", and the same after a case name ("Anderson, 477 U.S. at 248"): the
 * volume, the reporter words and the pin, or null. What this pattern's `exec` returned, match and groups (2026-10-20, in one pass):
 *   /^(?:[^\d,][^,]*,\s*)?(\d{1,4})\s+(.+?)\s+at\s+(\d{1,5})(?:\s*[-–]\s*\d{1,5})?(?:\s*(?:,|&|nn?\.)\s*\d{1,5})*\s*(?:\([^)]*\))?$/iu
 * Its reporter words were lazy, and the spacing after them was tried again from every position of a long run of spacing, so a long
 * run cost time quadratic in its length. How it reads in one pass. The volume is one to four digits beside spacing, at the start, or,
 * when the string does not open with a digit, after its first comma and the spacing after it. The rest is read from the right once:
 * for each position, whether what follows is the tail (a range, then pages after ",", "&", "n." or "nn.", each one to five digits,
 * then a parenthetical with no ")" inside, then the end), and for each run of spacing, whether "at" (either case), spacing, a pin of
 * one to five digits and the tail follow it. The reporter words then end at the first such run after them, starting after as much of
 * the spacing after the volume as leaves one, and never cross a line break. Exported for its tests; not part of the package's entry point.
 */
export function shortFormParts(s: string): WholeMatch | null {
  const n = s.length
  if (n === 0) return null
  // the volume: at the start, or after the first comma when the string does not open with a digit (nor with a comma); one to four
  // digits, then spacing. Then a short form needs "at" between spacing somewhere after it. Most strings stop here, before any table.
  let h: number
  if (asciiDigit(s.charCodeAt(0))) h = 0
  else if (s[0] === ',') return null
  else { const c = s.indexOf(','); if (c < 0) return null; h = afterSpacing(s, c + 1) }
  let g = h
  while (g < n && asciiDigit(s.charCodeAt(g))) g++
  if (g - h < 1 || g - h > 4 || !spacingAt(s, g)) return null
  SPACED_AT.lastIndex = g
  if (!SPACED_AT.test(s)) return null
  // the tables, read from the right once, in one scratch buffer of five regions (m = n + 2 each) and one of bytes:
  //   WS where the run of spacing from each position ends   DG where the run of digits ends
  //   PF, PT the pin a run of spacing reads (from, to; PF -1: none)   NR the first position at or after k inside such a run
  //   T[t] what follows t reads `(?:\s*(?:,|&|nn?\.)\s*\d{1,5})*\s*(?:\([^)]*\))?$`
  const m = n + 2
  let I = SHORT_FORM_INTS
  let T = SHORT_FORM_BYTES
  if (I.length < 5 * m) { I = new Int32Array(5 * m); if (n <= SHORT_FORM_REUSE) SHORT_FORM_INTS = I }
  if (T.length < n + 1) { T = new Uint8Array(n + 1); if (n <= SHORT_FORM_REUSE) SHORT_FORM_BYTES = T }
  const WS = 0, DG = m, PF = 2 * m, PT = 3 * m, NR = 4 * m
  I[WS + n] = n; I[WS + n + 1] = n; I[DG + n] = n; I[DG + n + 1] = n
  for (let i = n - 1; i >= 0; i--) {
    I[WS + i] = spacingAt(s, i) ? I[WS + i + 1]! : i
    I[DG + i] = asciiDigit(s.charCodeAt(i)) ? I[DG + i + 1]! : i
  }
  // `\s*(?:\([^)]*\))?$` from the end u of the spacing: the end, or "(" whose ")" is the last character, with none between
  const beforeLastClose = s[n - 1] === ')' ? (n >= 2 ? s.lastIndexOf(')', n - 2) : -1) : -2
  for (let t = n; t >= 0; t--) {
    T[t] = 0
    const u = I[WS + t]!
    if (u === n || (s[u] === '(' && beforeLastClose !== -2 && beforeLastClose < u && u < n - 1)) { T[t] = 1; continue }
    // `,` `&` `n.` `nn.` (either case), then spacing and pages of one to five digits, the run whole
    let v = -1
    if (s[u] === ',' || s[u] === '&') v = u + 1
    else if (s[u] === 'n' || s[u] === 'N') { if ((s[u + 1] === 'n' || s[u + 1] === 'N') && s[u + 2] === '.') v = u + 3; else if (s[u + 1] === '.') v = u + 2 }
    if (v < 0) continue
    const w = I[WS + v]!, d = I[DG + w]!
    if (d - w >= 1 && d - w <= 5 && T[d] === 1) T[t] = 1
  }
  // each run of spacing that `\s+at\s+(\d{1,5})` and the tail follow to the end (the tail: an optional range `\s*[-–]\s*\d{1,5}`,
  // then T): its pin, recorded at every position of the run
  for (let k = 0; k <= n; k++) I[PF + k] = -1
  for (let i = 0; i < n;) {
    if (!spacingAt(s, i)) { i++; continue }
    const r0 = i
    i = I[WS + i]!
    if ((s[i] === 'a' || s[i] === 'A') && (s[i + 1] === 't' || s[i + 1] === 'T') && spacingAt(s, i + 2)) {
      const w = I[WS + i + 2]!, d = I[DG + w]!
      if (d - w < 1 || d - w > 5) continue
      let tail = T[d] === 1
      if (!tail) {
        const u = I[WS + d]!
        if (u < n && (s[u] === '-' || s[u] === '–')) { const w2 = I[WS + u + 1]!, d2 = I[DG + w2]!; tail = d2 - w2 >= 1 && d2 - w2 <= 5 && T[d2] === 1 }
      }
      if (tail) for (let k = r0; k < i; k++) { I[PF + k] = w; I[PT + k] = d }
    }
  }
  I[NR + n] = n; I[NR + n + 1] = n
  for (let k = n - 1; k >= 0; k--) I[NR + k] = I[PF + k]! >= 0 ? k : I[NR + k + 1]!
  // the reporter words: from as far into the spacing after the volume as leaves one, to the first such run after them, never across
  // a line break
  const e1 = I[WS + g]!
  let nextBreak = n // the first line break at or after a
  for (let k = n - 1; k >= e1; k--) if (lineBreak(s.charCodeAt(k))) nextBreak = k
  for (let a = e1; a > g; a--) {
    if (a < e1 && lineBreak(s.charCodeAt(a))) nextBreak = a
    const b = I[NR + a + 1]!
    if (b >= n || nextBreak < b) continue
    return Object.assign([s, s.slice(h, g), s.slice(a, b), s.slice(I[PF + b]!, I[PT + b]!)] as [string, string, string, string], { index: 0 })
  }
  return null
}

type ShortForm =
  | { kind: 'unresolved'; written: string; why: string }
  | { kind: 'resolved'; written: string; citation: Citation; full: Citation }

const reporterKey = (r: string): string => r.split(/[\s.]+/).filter(Boolean).join(' ').toLowerCase()

/**
 * legal@0.4.0: a short form of `c.cite`, resolved within the brief's citations, or undefined when the cite is not a short form.
 * legal@0.5.0 (`v050`) reads each full citation for its first reporter citation (citeParts), so a full citation written with its
 * case name, pin page and parenthetical ("Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)") is one a short form can point to;
 * a full citation with no case_name is named by the case name it prints. The full citations are read once per call (pointsTo).
 */
function shortFormOf(c: Citation, ix: BriefIndex, v050 = false): ShortForm | undefined {
  const written = c.cite?.trim() ?? ''
  if (written.length === 0) return undefined
  if (ID_FORM.test(written)) return { kind: 'unresolved', written, why: `"${written}" points to the authority cited just before it, which a list of citations does not record` }
  if (SUPRA_FORM.test(written)) return { kind: 'unresolved', written, why: `"${written}" points to an authority cited earlier in the brief without saying which citation` }
  const m = shortFormParts(written)
  if (!m || !/\p{L}/u.test(m[2] as string)) return undefined
  const vol = m[1] as string, rep = reporterKey(m[2] as string), pin = Number(m[3])
  const seen = pointsTo(c, ix, v050, vol, rep, pin)
  const reporter = (m[2] as string).trim()
  if (seen.length === 0) return { kind: 'unresolved', written, why: `the brief gives no full citation in ${vol} ${reporter} at or before page ${pin}${c.case_name ? ` for ${c.case_name}` : ''} for it to point to` }
  if (seen.length > 1) return { kind: 'unresolved', written, why: `it could point to more than one full citation of the brief (${seen.map(o => o.cite!.trim()).join('; ')})` }
  const full = seen[0] as Citation
  const citation: Citation = {
    id: c.id, cite: full.cite!.trim(),
    ...(full.case_name !== undefined ? { case_name: full.case_name } : c.case_name !== undefined ? { case_name: c.case_name } : {}),
    ...(c.quote !== undefined ? { quote: c.quote } : {}), ...(c.proposition !== undefined ? { proposition: c.proposition } : {}),
    ...(c.source_key !== undefined ? { source_key: c.source_key } : full.source_key !== undefined ? { source_key: full.source_key } : {}),
  }
  return { kind: 'resolved', written, citation, full }
}

/** A sentence ending in a period, never two ("Jones Manufacturing Co." does not become "Co.."): legal@0.4.0's wording. */
const stop = (s: string): string => (/[.!?]["”’)]*$/.test(s) ? s : `${s}.`)

function check060(c: Citation, sources: OpinionSources, rule: LegalRuleset, L: QuotationLimits = QUOTATION_LIMITS, all: readonly Citation[] = [c], ix: BriefIndex = briefIndex(all, sources)): Checked060 {
  const label = c.case_name ?? c.cite ?? c.id
  // legal@0.5.1 reads as 0.5.0 does, with its own quotation reading (quote051); everything 0.5.0 does, it does. legal@0.5.2 reads as
  // 0.5.1 does, with what `v052` adds; legal@0.5.3 as 0.5.2 does, with what `v053` adds; legal@0.5.4 as 0.5.3 does, with what `v054` adds;
  // legal@0.5.5 as 0.5.4 does, with what `v055` adds
  const v055 = rule === LEGAL_RULESET_V055
  const v054 = rule === LEGAL_RULESET_V054 || v055
  const v053 = rule === LEGAL_RULESET_V053 || v054
  const v052 = rule === LEGAL_RULESET_V052 || v053
  const v051 = rule === LEGAL_RULESET_V051 || v052
  const v050 = rule === LEGAL_RULESET_V050 || v051
  const base = {
    claim_id: `cite.${c.id}`, kind: 'QUOTE_MATCH' as const, tier: 'DETERMINISTIC' as const,
    field: c.cite ?? c.case_name ?? c.id, asserted: (c.quote ?? c.proposition ?? label) as string,
    rule_id: 'CITE_VERBATIM', rule_name: v050 ? RULE_NAME_V050 : RULE_NAME,
  }
  const v040 = rule === LEGAL_RULESET_V040 || v050
  // legal@0.4.0: a short form is read as a pin cite to the brief's full citation, or refused as a short form (above)
  const sf = v040 && c.quote !== undefined && c.quote.trim().length > 0 ? shortFormOf(c, ix, v050) : undefined
  if (sf?.kind === 'unresolved') {
    return { claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', missing: ['full_cite'], detail: `short form; supply the full citation: ${sf.why}. A quotation is checked against the text of the opinion its full citation names (volume, reporter and first page).` },
      locked: false, explanation: `${label}: short form ${sf.written}; supply the full citation. The quotation was not checked.` } }
  }
  const ec0 = sf?.kind === 'resolved' ? sf.citation : c
  // legal@0.5.0: the citation is looked up by its reporter citation, the pin page, case name and parenthetical read off (lookup050)
  const looked = v050 ? lookup050(ec0, sources, ix, v054) : undefined
  const ec = looked ? looked.ec : ec0
  const src = looked ? looked.src : resolveSource060(ec, sources)
  if (!src) {
    if (looked) {
      // the texts supplied, listed once per call (suppliedKeys reads every key)
      const supplied = (ix.supplied ??= suppliedKeys(sources))
      return { claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
        insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `no supplied text matched the cite as written (looked for: ${looked.tried.join('; ')}; texts supplied: ${supplied}). A quotation is checked only against the text supplied for its citation: key the text by the citation's reporter citation ("477 U.S. 242"; a pin page, the case name and a parenthetical are read off the citation), or name its key in source_key. (Whether the authority exists is a separate check this engine does not make.)` },
        locked: false, explanation: `${label}: no supplied text matched the cite as written (looked for: ${looked.tried.join('; ')}; texts supplied: ${supplied}); the quotation was not checked.` } }
    }
    return { claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: `no opinion text supplied for ${label}; the quotation cannot be checked without the text of the opinion it is attributed to. (Whether the authority exists is a separate check this engine does not make.)` },
      locked: false, explanation: `No opinion text for ${label}; cannot verify.` } }
  }
  const bind = bindModeOf(sources[src.key])
  const v030 = rule === LEGAL_RULESET_V030 || v040
  // legal@0.3.0 binds by the text's caption (./binding.ts captionOf); 0.0.1 to 0.2.0 by a mention anywhere in it
  const naming = v030 ? captionNamingOf(base.claim_id, ec, src.text, bind.mode, v040, v050, v052, v054) : namingOf(base.claim_id, c, src.text, bind.mode)
  if (sf?.kind === 'resolved') naming.short_form = { written: sf.written, reads: ec.cite as string, from: `cite.${sf.full.id}` }
  if (looked?.readAs) naming.read_as = { ...looked.readAs, key: src.key }
  const reference: Evidence = { locator: { kind: 'field', source: 'contract', path: `opinion:${src.key}` }, value: citeNameOf(ec), confidence: 100, role: 'REFERENCE' }
  if (c.quote === undefined || c.quote.trim().length === 0) {
    // legal@0.5.1 says can't tell in the product's words (earlier rules keep theirs, so their verdicts replay)
    if (v051) {
      return { key: src.key, naming, claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [reference],
        insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `whether ${label} stands for the asserted proposition is a judgement this check does not make. Supply the quoted language, and it is checked as quoted.` },
        locked: false, explanation: `${label}: whether it stands for the proposition is not decided by this check; can't tell, by design.` } }
    }
    return { key: src.key, naming, claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [reference],
      insufficiency: { reason: 'OUT_OF_RULESET_SCOPE', detail: `whether ${label} stands for the asserted proposition is a semantic judgement the deterministic tier does not make. Supply the quoted language to verify it verbatim, or await the REASONED tier.` },
      locked: false, explanation: `${label}: proposition not deterministically decidable; abstaining by design.` } }
  }
  // legal@0.4.0: the short form read as a pin cite is said on every answer
  const shortNote = (claim: ClaimVerdict): ClaimVerdict => sf?.kind !== 'resolved' ? claim
    : { ...claim, explanation: `${claim.explanation} Short form ${sf.written} read as a pin cite to ${stop(`${sf.full.cite!.trim()}${sf.full.case_name ? `, ${sf.full.case_name}` : ''}, cited in full at cite.${sf.full.id}`)}` }
  if (!naming.bound && v030) return { key: src.key, naming, claim: shortNote(unbound030(base, label, ec, naming, reference, v040, v050)) }
  if (v030) {
    // legal@0.5.0: the quotation is read against the opinion it is attributed to (quote050); a PASS says where it matched and that a pin page is not checked
    const checked = v050 ? quote050(c.quote, base, label, src.text, L, c.cite, naming.read_as?.pin, v051, v052, v053, v054, v055) : quote060V010(c.quote, base, label, src.text, true, L, true, v040)
    return { key: src.key, naming, claim: shortNote(naming.tier === 'parties-only' ? partiesOnly030(checked, base, label, ec, naming, reference) : checked) }
  }
  if (!naming.bound) {
    const name = citeNameOf(c)
    const partiesOnly = naming.cite !== undefined && !naming.cite.found && (naming.parties ?? []).length > 0 && (naming.parties ?? []).every(p => p.found !== null)
    const missing = [...(naming.cite && !naming.cite.found ? ['cite'] : []), ...((naming.parties ?? []).some(p => p.found === null) ? ['case_name'] : []), ...(!naming.cite && !naming.parties ? ['cite', 'case_name'] : [])]
    return { key: src.key, naming, claim: { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [reference],
      insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', missing,
        detail: `the supplied text does not name ${name}; it may be the wrong opinion. Not found in it: ${unnamedOf(naming).join('; ')}. A quotation is checked only against a text that names the authority it is attributed to (its caption and reporter citation).${partiesOnly ? ' The text names every party: supplied with bind "parties", it would be checked, labelled as bound by parties only.' : ''}` },
      locked: false, explanation: `${label}: the supplied text does not name ${name}; it may be the wrong opinion. The quotation was not checked.` } }
  }
  const checked = rule === LEGAL_RULESET_V020 ? quote060V010(c.quote, base, label, src.text, true, L)
    : rule === LEGAL_RULESET_V010 ? quote060V010(c.quote, base, label, src.text, false, L)
      : quote060V001(c.quote, base, label, src.text)
  // the opt-in weaker tier is never silent: the claim says it, beside the naming and the choice ledger
  const claim = naming.tier === 'parties-only'
    ? { ...checked, explanation: `${checked.explanation} Bound by parties only: the reporter citation ${naming.cite?.asked ?? ''} is not found in the supplied text (bind "parties", stated by the caller).` }
    : checked
  return { claim, key: src.key, naming }
}

type ClaimBase = Pick<ClaimVerdict, 'claim_id' | 'kind' | 'tier' | 'field' | 'asserted' | 'rule_id' | 'rule_name'>

/** A stretch of text as a reader is shown it: whitespace collapsed, at most 200 characters (the middle elided). */
const clip = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= 200 ? t : `${t.slice(0, 96)} … ${t.slice(-96)}`
}

/**
 * legal@0.3.0: the caption of the supplied text does not name the citation. The abstention says what the caption says the text is,
 * and whether its body names the citation (an opinion that cites it): "the supplied text is Cooper v. Aaron, 358 U.S. 1 (its
 * caption); it cites Brown v. Board of Education, 347 U.S. 483 but is not that opinion".
 */
function unbound030(base: ClaimBase, label: string, c: Citation, n: CiteNaming, reference: Evidence, v040 = false, v050 = false): ClaimVerdict {
  const name = citeNameOf(c)
  const cap = n.caption ?? undefined
  const capName = cap ? [cap.name, cap.cite].filter((s): s is string => s !== undefined).join(', ') : ''
  const partiesNamed = (n.parties ?? []).length > 0 && (n.parties ?? []).every(p => p.found !== null)
  const citeOnly = n.cite !== undefined && !n.cite.found && partiesNamed
  const missing = [...(n.cite && !n.cite.found ? ['cite'] : []), ...((n.parties ?? []).some(p => p.found === null) ? ['case_name'] : []), ...(!n.cite && !n.parties ? ['cite', 'case_name'] : [])]
  // another opinion: the caption prints a reporter citation other than the one asked for, or names none of the parties
  const other = cap !== undefined && cap.name !== undefined && ((cap.cite !== undefined && n.cite !== undefined && !n.cite.found) || ((n.parties ?? []).length > 0 && (n.parties ?? []).every(p => p.found === null)))
  // legal@0.4.0: the reporter citation is printed in the head of the text, but farther from the case name than a caption's
  const line = v040 && n.cite_line !== undefined && n.cite !== undefined && !n.cite.found ? n.cite_line : undefined
  const where = line === undefined ? '' : `${line.lines} line${line.lines === 1 ? '' : 's'} ${line.at} the case name`
  const window = `a caption's citation line lies at most ${CAPTION_LIMITS.citeAbove === 3 ? 'three' : CAPTION_LIMITS.citeAbove} lines above the case name or ${CAPTION_LIMITS.citeBelow === 2 ? 'two' : CAPTION_LIMITS.citeBelow} below it${v050 ? ', or is the line after a Lexis header\'s "Reporter" heading' : ''}`
  const what = !cap
    ? `the supplied text has no caption (the case name and reporter citation a reporter prints, on their own lines at its top), so it cannot be bound to ${name}${n.mentioned ? `; its body names ${name}, but a text is bound only by its caption` : ''}`
    : citeOnly && line !== undefined
      ? `the caption of the supplied text${cap.name !== undefined ? ` (${capName})` : ''} names the parties of ${c.case_name ?? name}, and its citation line ${n.cite!.asked} sits ${where}, outside the caption window (${window})`
      : citeOnly
      ? `the caption of the supplied text${cap.name !== undefined ? ` (${capName})` : ''} names the parties of ${c.case_name ?? name} but not the reporter citation ${n.cite!.asked}; another opinion in the same case (the decision below, a remand, a rehearing) carries the same caption`
      : other
        ? n.mentioned ? `the supplied text is ${capName} (its caption); it cites ${name} but is not that opinion` : `the supplied text is ${capName} (its caption), not ${name}; it may be the wrong opinion`
        : `the caption of the supplied text (${capName}) does not name all of ${name}; it may be the wrong opinion`
  const explanation = !cap
    ? `${label}: the supplied text has no caption naming ${name}; the quotation was not checked.`
    : citeOnly && line !== undefined
      ? `${label}: the citation line ${n.cite!.asked} sits ${where} in the supplied text, outside the caption window (${window}); the quotation was not checked.`
      : citeOnly
      ? `${label}: the caption of the supplied text does not print the reporter citation ${n.cite!.asked}; the quotation was not checked.`
      : other ? `${label}: the supplied text is ${capName} by its caption, not ${name}; the quotation was not checked.`
        : `${label}: the caption of the supplied text does not name all of ${name}; the quotation was not checked.`
  const dot = v040 ? stop : (s: string): string => `${s}.`
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [reference],
    insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', missing,
      detail: `${dot(what)} Not named in its caption: ${dot(unnamedOf(n).join('; '))} A quotation is checked only against the text of the opinion it is attributed to, known by the caption a reporter prints at its top.${citeOnly ? ' Supplied with bind "parties", the quotation would be checked and left open (never certified) until the caption prints the reporter citation.' : ''}` },
    locked: false, explanation }
}

/**
 * legal@0.3.0: a text bound by parties only (bind "parties": its caption names every party, not the reporter citation). A quotation
 * found in it is never certified: the claim abstains (REFERENCE_NOT_PROVIDED, missing "cite") with the passage found as evidence, so
 * the verdict is PASS_WITH_OPEN at best and the citations verb exits 2. A FAIL or another abstention stands, labelled.
 */
function partiesOnly030(checked: ClaimVerdict, base: ClaimBase, label: string, c: Citation, n: CiteNaming, reference: Evidence): ClaimVerdict {
  const asked = n.cite?.asked ?? ''
  if (checked.outcome !== 'PASS') {
    return { ...checked, explanation: `${checked.explanation} Bound by parties only: the caption of the supplied text does not print the reporter citation ${asked} (bind "parties", stated by the caller).` }
  }
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [...checked.evidence, reference],
    insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', missing: ['cite'],
      detail: `bound by parties only: the quoted words appear in ${suppliedFor(label)}, but its caption names the parties of ${c.case_name ?? citeNameOf(c)} and not the reporter citation ${asked} (bind "parties", stated by the caller). Another opinion in the same case (the decision below, a remand, a rehearing) carries the same caption, so the text is not confirmed as the opinion cited and the quotation is not certified.` },
    locked: false, explanation: `${label}: the quoted words are in the supplied text, but it is bound by parties only (its caption does not print the reporter citation ${asked}); not certified.` }
}

const precededClaim = (base: ClaimBase, label: string, ev: Evidence): ClaimVerdict => ({ ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
  insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${suppliedFor(label)}, but immediately follow a negation there (e.g. "we do not hold that…") that the quotation omits. This may be a selective quotation that inverts the holding — cannot certify as accurately cited; verify in context.` },
  locked: false, explanation: `${label}: quoted words present in the supplied text but preceded by a negation the quote omits; not certified — possible selective quotation.` })

/** legal@0.0.1 under engine 0.6.0: the verbatim match as before; when it fails, a passage only on 0.1.0's rule. */
function quote060V001(quote: string, base: ClaimBase, label: string, text: string): ClaimVerdict {
  const { prepared, sourceHash } = preparedFor(text)
  const r = matchQuote(prepared, quote)
  if (r.found && r.span) {
    const ev = spanEvidence(sourceHash, r.span, r.matchedText ?? '')
    if (precededByNegation(text, r.span.start)) return precededClaim(base, label, ev)
    return { ...base, outcome: 'PASS', locked: true, evidence: [ev], explanation: `The quotation appears verbatim in ${suppliedFor(label)}.` }
  }
  return notFound060(nearestPassage(legalPreparedFor(text).prepared, quote), quote, base, label, sourceHash)
}

/**
 * Engine 0.6.0: a named passage carries two words of margin on each side of the stretch the quotation aligns with. When a margin
 * crosses a sentence boundary, it is cut there, so the passage does not open on the tail of the sentence before ("prima
 * ballerina. The FTCA …") or close on the first words of the next (a cold reader's (an AI agent's) note). Only the margins are cut.
 */
function snapPassage(r: Extract<QuotationReading, { kind: 'passage' }>): Extract<QuotationReading, { kind: 'passage' }> {
  const toks = [...r.text.matchAll(/\S+/g)].map(m => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, ends: /[.;:!?]["”’)\]]*$/.test(m[0]) }))
  if (toks.length < 6) return r
  let from = 0
  let to = r.text.length
  if (toks[1]!.ends) from = toks[2]!.start
  else if (toks[0]!.ends) from = toks[1]!.start
  const n = toks.length
  if (toks[n - 3]!.ends) to = toks[n - 3]!.end
  else if (toks[n - 2]!.ends) to = toks[n - 2]!.end
  if (from === 0 && to === r.text.length) return r
  return { ...r, text: r.text.slice(from, to), span: { start: r.span.start + from, end: r.span.start + to } }
}

/** Every rule under engine 0.6.0: the quotation is not in the supplied text as quoted. */
function notFound060(r0: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string): ClaimVerdict {
  const r = r0.kind === 'passage' ? snapPassage(r0) : r0
  if (r.kind === 'passage') {
    const corresponding = r.strength === 'corresponding'
    const pct = Math.round(r.similarity * 100)
    return { ...base, outcome: 'FAIL', locked: corresponding,
      computation: corresponding
        ? { formula: 'brief_quote = opinion[corresponding passage]', operands: { brief_quote: quote, opinion_says: r.text, anchor_words: r.anchorWords, similarity: r.similarity }, result: r.text }
        : { formula: 'brief_quote found in opinion (not found; nearest passage shown)', operands: { brief_quote: quote, nearest_passage: r.text, anchor_words: r.anchorWords, similarity: r.similarity }, result: r.text },
      evidence: [{ ...spanEvidence(sourceHash, r.span, r.text), role: corresponding ? 'QUOTE' : 'CONTEXT' }],
      explanation: corresponding
        ? `The quotation is not found as quoted in ${suppliedFor(label)}. The corresponding passage there reads: "${r.text}".`
        : `The quotation was not found as quoted in ${suppliedFor(label)}. The nearest passage there, a partial match only (${r.anchorWords} consecutive words; ${pct}% of the quotation's words in order), is: "${r.text}".` }
  }
  const run = r.longestRun >= 3 ? ` The longest run of its words found in the text is ${r.longestRun} words, too few to name a passage.` : ''
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quotation was not found in ${suppliedFor(label)}; it may be fabricated, or the supplied text may be incomplete. Not confirmed — do not rely on this citation as quoted.${run}` },
    locked: false, explanation: `${label}: quotation not found in the supplied opinion text; it may be fabricated. Abstaining rather than asserting a fabrication.` }
}

/**
 * legal@0.4.0: the quotation is not in the supplied text as quoted, read with its safe page marks read out (quotation.ts
 * pageMarksOf). First, if it matches once looser tokens are read out too (a numeral glued to a word, a star mark inside one, a
 * bracketed footnote call: loosePageMarksOf), the answer is can't tell (UNPARSEABLE), never FAIL: such a token may be a page mark,
 * and the engine does not drop it on its own. Otherwise a named passage is whole sentences of the text (sentenceSpanOf), shown with
 * its page marks left out, and the FAIL names the words that differ.
 */
function notFound040(r: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string, prepared: LegalPreparedSource, L: QuotationLimits): ClaimVerdict {
  const at = suppliedFor(label)
  const loose = legalPreparedFor(prepared.raw, 'loose').prepared
  const lr = readQuotation(loose, quote, L)
  if (lr.kind === 'match') {
    const safe = new Set((prepared.marks ?? []).map(m => `${m.start}:${m.end}`))
    const extra = (loose.marks ?? []).filter(m => m.start >= lr.span.start && m.end <= lr.span.end && !safe.has(`${m.start}:${m.end}`)).map(m => `"${markShown(prepared.raw, m)}"`)
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [spanEvidence(sourceHash, lr.span, lr.text)],
      insufficiency: { reason: 'UNPARSEABLE', detail: `the quotation matches ${at} only when ${extra.length === 1 ? 'a token' : 'tokens'} inside the quoted words ${extra.length === 1 ? 'is' : 'are'} read out (${extra.join(', ') || 'a possible page mark'}), which may be a page marker or a footnote number. The engine reads out on its own only star paging between words and a footnote numeral glued to sentence punctuation, so it cannot tell whether the quotation is accurate; it does not call it a misquotation.` },
      locked: false, explanation: `${label}: the quotation matches the supplied text only with ${extra.join(', ') || 'a possible page mark'} read out, which may be a page marker or footnote number; can't tell.` }
  }
  return passage040(r, quote, base, label, sourceHash, prepared)
}

/**
 * legal@0.4.0's answer once no reading matches (notFound040 above; legal@0.5.0's notFound050): possibly fabricated, or a FAIL naming
 * a passage as whole sentences with the words that differ. `full` (legal@0.5.0) is the supplied text when `prepared` reads a view
 * of it (./sections.ts viewOf): the evidence then quotes the text itself, and the view's separator is never shown.
 */
function passage040(r: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string, prepared: LegalPreparedSource, full?: string): ClaimVerdict {
  const at = suppliedFor(label)
  if (r.kind === 'none') {
    const run = r.longestRun >= 3 ? ` The longest run of its words found in the text is ${r.longestRun} words, too few to name a passage.` : ''
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quotation was not found in ${at}; it may be fabricated, or the supplied text may be incomplete. Not confirmed — do not rely on this citation as quoted.${run}` },
      locked: false, explanation: `${label}: quotation not found in the supplied opinion text; it may be fabricated. Abstaining rather than asserting a fabrication.` }
  }
  const blank = prepared.blank ?? prepared.raw
  const span = sentenceSpanOf(blank, r.core ?? r.span)
  const text = full === undefined ? shownText(blank.slice(span.start, span.end)) : shownText(blank.slice(span.start, span.end).replace(/¦/g, ' '))
  const marks = markNotes(prepared.raw, prepared.marks ?? [], span.start, span.end)
  const read = marks.length ? ` (read with ${marks.join(' and ')})` : ''
  const corresponding = r.strength === 'corresponding'
  const pct = Math.round(r.similarity * 100)
  const diff = wordDifferences(text, quote.replace(PARENTHETICALS_040, ' '))
  const differs = diff.length === 0 ? 'the same words, written differently'
    : diff.map(d => !d.quote ? `the quotation leaves out "${d.text}"` : !d.text ? `the quotation adds "${d.quote}"` : `the text has "${d.text}" where the quotation has "${d.quote}"`).join('; ')
  const ev: Evidence = { ...spanEvidence(sourceHash, span, (full ?? prepared.raw).slice(span.start, span.end)), role: corresponding ? 'QUOTE' : 'CONTEXT' }
  if (marks.length) ev.normalizations = marks
  return { ...base, outcome: 'FAIL', locked: corresponding,
    computation: corresponding
      ? { formula: 'brief_quote = opinion[corresponding passage]', operands: { brief_quote: quote, opinion_says: text, anchor_words: r.anchorWords, similarity: r.similarity, differs }, result: text }
      : { formula: 'brief_quote found in opinion (not found; nearest passage shown)', operands: { brief_quote: quote, nearest_passage: text, anchor_words: r.anchorWords, similarity: r.similarity, differs }, result: text },
    evidence: [ev],
    explanation: corresponding
      ? `${stop(`The quotation is not found as quoted in ${at}${read}`)} Where they differ: ${differs}. The passage there reads: "${text}"`
      : `${stop(`The quotation was not found as quoted in ${at}${read}`)} The nearest passage there, a partial match only (${r.anchorWords} consecutive words; ${pct}% of the quotation's words in order), is: "${text}"` }
}
/** A stretch of the text as legal@0.4.0 shows it: a line-break hyphen joined (as the comparison reads it), whitespace collapsed. */
const shownText = (s: string): string => s.replace(/(\p{L})[-‐‑][ \t]*\r?\n\s*(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim()
/** Parentheticals a quotation may carry ("(emphasis added)"), left out of the word comparison (they are not the opinion's words). */
const PARENTHETICALS_040 = /\(\s*(?:cleaned\s+up|[^()]*\b(?:omitted|added|supplied|in\s+original|removed))\s*\)/giu

/**
 * legal@0.1.0 and 0.2.0 under engine 0.6.0: their reading and meaning guard, unchanged; the 0.6.0 wording. legal@0.3.0 (`v030`)
 * reads as 0.2.0 and adds, in this order after 0.2.0's own condition guard: a set-off phrase of time or procedure omitted by an
 * ellipsis ("after adequate time for discovery and upon motion"); the part of the sentence an ellipsis or a capital at an EDGE of the
 * quotation cuts off, read to the sentence boundary, when it carries a condition; and, after the preceding-negation guard, a
 * changed letter case. It says "verbatim" only when nothing but quotation marks, spacing and apostrophe style differ.
 */
function quote060V010(quote: string, base: ClaimBase, label: string, text: string, v020: boolean, L: QuotationLimits = QUOTATION_LIMITS, v030 = false, v040 = false, x?: Context050): ClaimVerdict {
  // legal@0.5.0 (`x`): `text` is the view of the opinion the quotation is attributed to (quote050); the evidence names the supplied text's hash
  const { prepared, sourceHash: viewHash } = legalPreparedFor(text, v040 ? 'safe' : undefined)
  const sourceHash = x?.hash ?? viewHash
  const r = readQuotation(prepared, quote, L)
  const at = suppliedFor(label)
  if (r.kind !== 'match') return x ? notFound050(r, quote, base, label, sourceHash, prepared, L, x) : v040 ? notFound040(r, quote, base, label, sourceHash, prepared, L) : notFound060(r, quote, base, label, sourceHash)
  // legal@0.4.0 reads sentence boundaries and negations on the text with its page marks blanked ("counted.4 This" ends a sentence)
  const read = v040 ? (prepared.blank ?? text) : text
  const marks = v040 ? markNotes(text, prepared.marks ?? [], r.span.start, r.span.end) : []
  const ev = spanEvidence(sourceHash, r.span, r.text)
  if (r.notes.length > 0 || marks.length > 0) ev.normalizations = [...r.notes, ...marks]
  const m = v020 ? meaningOf(r, quote) : undefined
  if (m?.kind === 'altered') {
    // legal@0.4.0 shows the passage with its page marks left out (the evidence keeps the text's own characters)
    const whole = v040 ? sentenceSpanOf(read, r.span) : r.span
    const says = v040 ? shownText(read.slice(whole.start, whole.end)) : r.text
    return { ...base, outcome: 'FAIL', locked: true,
      computation: { formula: 'a bracket = the word it replaces (case, inflection), a pronoun or referent, or an insertion with no modal, negation, quantifier or limit', operands: { brief_quote: quote, opinion_says: says, bracket: m.bracket, replaces: m.replaced }, result: says },
      evidence: [ev],
      explanation: v040
        ? `The quotation alters the meaning of ${at}: the bracket ${m.bracket} ${m.replaced === '' ? 'is an insertion' : `stands for "${m.replaced}"`}, and ${m.why}. The passage there reads: "${says}"`
        : `The quotation alters the meaning of ${at}: the bracket ${m.bracket} ${m.replaced === '' ? 'is an insertion' : `stands for "${m.replaced}"`}, and ${m.why}. The passage there reads: "${r.text}".` }
  }
  if (m?.kind === 'guarded-edge') {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the bracketed alteration ${m.bracket} carries "${m.word}" (a modal, negation, quantifier or limit), and what it replaces in ${at} cannot be located to compare. This may alter the passage's meaning — cannot certify as accurately cited; verify in context.` },
      locked: false, explanation: `${label}: a bracket carrying "${m.word}" could not be compared with the supplied text; not certified.` }
  }
  if (r.selective) {
    const how = r.selective.via === 'ellipsis' ? 'an omission' : 'an alteration'
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${at}, but ${r.selective.detail}. This may be a selective quotation that inverts the passage — cannot certify as accurately cited; verify in context.` },
      locked: false, explanation: `${label}: quoted words present, but ${how} in the quotation changes a negation; not certified — possible selective quotation.` }
  }
  if (m?.kind === 'condition') {
    const elided = m.elided.replace(/\s+/g, ' ').trim()
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${elided.length > 200 ? `${elided.slice(0, 96)} … ${elided.slice(-96)}` : elided}" from ${at}, which carries "${m.word}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately cited; verify in context.` },
      locked: false, explanation: `${label}: elided condition — the ellipsis omits "${m.word}" and what it governs; not certified.` }
  }
  if (v030) {
    // a set-off phrase of time or procedure inside the quotation's own ellipsis (0.2.0's condition words were tested above)
    for (const o of r.omissions) {
      const w = conditionIn030(o)
      if (w === undefined) continue
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${clip(o)}" from ${at}, which carries "${w}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ellipsis omits "${w}" and what it governs; not certified.` }
    }
    // the edges: what an opening or closing ellipsis, or an opening capital, cuts from the sentence
    const edges: { where: string; that: (cut: string, w: string) => string; cut: string }[] = []
    if (r.edges.lead !== undefined) {
      const cut = sentenceHeadBefore(read, r.span.start)
      edges.push(r.edges.lead === 'ellipsis'
        ? { where: 'ellipsis at its start', cut, that: (s, w) => `the quotation opens with an ellipsis that leaves out the start of its sentence in ${at}, "${s}", which carries "${w}"` }
        : { where: 'capital at its start', cut, that: (s, w) => `the quotation opens with a ${r.edges.bracketed ? 'bracketed ' : ''}capital, which presents its words as the start of a sentence, but in ${at} they follow "${s}", which carries "${w}"` })
    }
    if (r.edges.trail === 'ellipsis') {
      const cut = sentenceTailAfter(read, r.span.end)
      edges.push({ where: 'ellipsis at its end', cut, that: (s, w) => `the quotation closes with an ellipsis that leaves out the rest of its sentence in ${at}, "${s}", which carries "${w}"` })
    }
    for (const e of edges) {
      const w = conditionIn030(e.cut)
      if (w === undefined) continue
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: ${e.that(clip(e.cut), w)}; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately cited; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ${e.where} leaves out "${w}" and what it governs; not certified.` }
    }
    // legal@0.4.0: a quotation that begins in the middle of its sentence as the text writes it (no ellipsis, no capital it adds):
    // the part of the sentence before it, read as the capital guard reads it, is held when it is a condition or a negation
    // (quotation.ts leadCutOf). A negation the 0.0.1 guard reads (same clause, 80 characters) is left to that guard's words, below.
    if (v040 && r.edges.lead === undefined) {
      const head = sentenceHeadBefore(read, r.span.start)
      const cut = /\p{L}/u.test(head) ? leadCutOf(head) : undefined
      if (cut && (cut.kind === 'condition' || !precededByNegation(read, r.span.start))) {
        const cond = cut.kind === 'condition'
        return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
          insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided ${cond ? 'condition' : 'negation'}: the quotation begins in the middle of its sentence in ${at}, after "${clip(head)}", which carries ${cond ? '' : 'the negation '}"${cut.word}"; quoted without it, ${cond ? 'a conditional or limited passage may read as absolute' : 'the passage may read as the opposite of what the text says'} — cannot certify as accurately cited; verify in context.` },
          locked: false, explanation: `${label}: elided ${cond ? 'condition' : 'negation'} — the quotation begins after "${clip(head)}", leaving out "${cut.word}" and what it governs; not certified.` }
      }
    }
  }
  if (m?.kind === 'nested') {
    // legal@0.3.0 words whose words they are by the opinion, not its author (0.2.0's wording is kept for its verdicts)
    const detail = v030 ? m.detail.replace('gives those words to the court', 'gives those words to the opinion itself').replace('give the court\'s own words to someone else', 'give the opinion\'s own words to someone else') : m.detail
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `nested quotation: ${detail}. Cannot certify as accurately cited; verify in context.` },
      locked: false, explanation: `${label}: nested quotation — the inner quotation marks do not match the supplied text's; not certified.` }
  }
  if (precededByNegation(read, r.span.start)) return precededClaim(base, label, ev)
  if (v030) {
    // letter case: a quotation is not "as quoted" when it changes the case of letters the text has, except a bracketed letter, the
    // first letter of the quotation or the first after an ellipsis, or a change the quotation discloses ("(emphasis added)")
    const disclosed = r.parentheticals.some(p => /emphasis/i.test(p))
    const notes = [...r.notes]
    if (r.cases.changed > 0 && !disclosed) {
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `case change: the quotation writes "${clip(r.cases.quoted ?? '')}" where ${at} reads "${clip(r.cases.reads ?? '')}"; the words match, but not as written. Restore the letter case the text has, or say how the quotation changes it (for capitals added for emphasis, "(emphasis added)") — cannot certify as accurately quoted.` },
        locked: false, explanation: `${label}: the words are in the supplied text, but the quotation changes their letter case; not certified.` }
    }
    if (r.cases.changed > 0) notes.push('letter case differs from the text\'s, disclosed by the parenthetical')
    if (r.cases.firstLetter) notes.push('the case of its first letter differs from the text\'s')
    if (!r.cases.compared) notes.push('letter case not compared (the letters do not line up one for one)')
    // legal@0.4.0: page marks read out are named, and such a match is never called "verbatim"
    if (marks.length > 0) {
      return { ...base, outcome: 'PASS', locked: true, evidence: [ev],
        explanation: notes.length === 0
          ? `The quotation appears in ${at}, read with ${marks.join(' and ')}: the same words, in the same letter case.`
          : `The quotation appears in ${at}, read with ${marks.join(' and ')}, and with the quotation conventions it uses: ${notes.join('; ')}.` }
    }
    return { ...base, outcome: 'PASS', locked: true, evidence: [ev],
      explanation: notes.length === 0
        ? `The quotation appears verbatim in ${at}: the same words, in the same letter case.`
        : `The quotation appears in ${at}, read with the quotation conventions it uses: ${notes.join('; ')}.` }
  }
  return { ...base, outcome: 'PASS', locked: true, evidence: [ev],
    explanation: r.notes.length === 0
      ? `The quotation appears verbatim in ${at}.`
      : `The quotation appears in ${at}, read with the quotation conventions it uses: ${r.notes.join('; ')}.` }
}

// ── legal@0.5.0: whose words (2026-10-05, cold-review round 5) ─────────────────────────────────────────────────────────────────────────
//
// A quotation is read against the opinion it is attributed to: the majority opinion, or the separate opinion a parenthetical in the
// citation names ("(Brennan, J., dissenting)"). The text's sections are read (./sections.ts), and the quotation is read against a
// view of the text in which every other section is blanked (offsets and lines kept). A match there goes through every 0.4.0 guard,
// and a PASS says where it matched. When nothing matches there, in this order:
//   1. it matches there with an unread footnote call or page mark read out ("n7", "FN6", "[4]", superscript digits): can't tell
//      naming it (UNPARSEABLE), never FAIL;
//   2. its words are found in another section (editorial matter, the header, a separate opinion, footnotes that cannot be assigned):
//      can't tell, "whose words: the quoted words appear in the West headnotes …, not in the opinion" (SPAN_NOT_FOUND, with where they
//      appear as evidence), never PASS: where the majority opinion also has them, the match above wins;
//   3. a passage of the opinion corresponds: FAIL, worded as 0.4.0 words it;
//   4. the nearest passage lies in another section: can't tell naming it;
//   5. otherwise: not found, possibly fabricated, as before.
// A text with no recognised section is read whole, as 0.4.0 reads it (the PASS says the line and offset only).

/** What legal@0.5.0 reads a quotation against: the supplied text, its sections, and the opinion the quotation is attributed to. */
interface Context050 {
  full: string; hash: string; ts: TextSections; target: Section[]; targetName: string; named: boolean; v051?: boolean
  /** legal@0.5.2: its readings, and the lead opinion's name when it is a plurality ("the lead opinion") */
  v052?: boolean; leadName?: string
  /** legal@0.5.3: its readings (quote051 under `v053`) */
  v053?: boolean
  /** legal@0.5.4: its readings (quote051 under `v054`) */
  v054?: boolean
  /** legal@0.5.5: its readings (quote051 under `v055`) */
  v055?: boolean
}

/** A character no quotation carries, put where a blanked section begins, so a quotation never matches across one. */
const VIEW_SEPARATOR = '¦'

/** The sections and sha256 of the last few texts, kept as the prepared texts are (sectionsOf is linear in the text). legal@0.5.1 names a "Dissent by:" line its own way; legal@0.5.2 reads a plurality; legal@0.5.4 reads six more designation styles. */
const sectionsCache: { text: string; v051: boolean; v052: boolean; v053: boolean; v054: boolean; v055: boolean; ts: TextSections; hash: string }[] = []
function sectionsFor(text: string, v051 = false, v052 = false, v053 = false, v054 = false, v055 = false): { ts: TextSections; hash: string } {
  const hit = sectionsCache.find(x => x.text === text && x.v051 === v051 && x.v052 === v052 && x.v053 === v053 && x.v054 === v054 && x.v055 === v055)
  if (hit) return hit
  const made = { text, v051, v052, v053, v054, v055, ts: sectionsOf(text, { v051, ...(v052 ? { v052 } : {}), ...(v053 ? { v053 } : {}), ...(v054 ? { v054 } : {}), ...(v055 ? { v055 } : {}) }), hash: sha256(text) }
  sectionsCache.unshift(made)
  if (sectionsCache.length > PREPARED_KEEP) sectionsCache.pop()
  return made
}

/** The sections a legal@0.5.0 verdict records for a text (OpinionProvenance.sections): absent when it read none. */
const sectionsRecord = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}
/** The same, as legal@0.5.1 names the sections. */
const sectionsRecord051 = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text, true)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}
/** The same, as legal@0.5.2 names the sections ("the lead opinion" for a plurality). */
const sectionsRecord052 = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text, true, true)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}

/** The same, as legal@0.5.3 reads the sections (a designation with a join clause; a separate opinion named by its role as printed). */
const sectionsRecord053 = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text, true, true, true)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}
/** The same, as legal@0.5.4 reads the sections (six more designation styles). */
const sectionsRecord054 = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text, true, true, true, true)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}
/** The same, as legal@0.5.5 reads the sections (nine more designation styles, two plurality forms, a district court's slip opinion). */
const sectionsRecord055 = (text: string): OpinionProvenance['sections'] => {
  const { ts } = sectionsFor(text, true, true, true, true, true)
  return ts.recognized ? ts.sections.map(s => ({ kind: s.kind, name: s.name, line: s.line, last_line: s.last_line })) : undefined
}

/** The view a section list gives (./sections.ts viewOf), with a separator where each blanked stretch begins. */
function separatedView(text: string, keep: readonly Section[]): string {
  const v = viewOf(text, keep)
  if (keep.length === 0) return v
  let out = ''
  let blankRun = false
  for (let i = 0; i < v.length; i++) {
    const inKeep = keep.some(s => i >= s.start && i < s.end)
    const ch = v[i] as string
    if (!inKeep && !blankRun && ch !== '\n' && ch !== '\r') { out += VIEW_SEPARATOR; blankRun = true; continue }
    if (inKeep) blankRun = false
    out += ch
  }
  return out
}

/** "the synopsis", "the synopsis and the syllabus", "A, B and C" */
const listOf = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * legal@0.5.0: one citation's quotation against the opinion it is attributed to (above). `cite` is the citation as written (its
 * parenthetical may name a separate opinion); `pin` a pin page the lookup read off it, which a PASS says is not checked.
 */
function quote050(quote: string, base: ClaimBase, label: string, text: string, L: QuotationLimits, cite: string | undefined, pin: string | undefined, v051 = false, v052 = false, v053 = false, v054 = false, v055 = false): ClaimVerdict {
  // legal@0.5.5 reads the sections with its own forms besides 0.5.4's (sections.ts `v055`)
  const { ts, hash } = sectionsFor(text, v051, v052, v053, v054, v055)
  const at = suppliedFor(label)
  const named = opinionNamedBy(cite)
  let target: Section[]
  if (named) {
    target = ts.recognized ? sectionsNamed(ts, named) : []
    if (target.length === 0) {
      const who = `${named.author}'s ${named.role === 'dissent' ? 'dissent' : named.role === 'concurrence' ? 'concurrence' : 'opinion concurring in part and dissenting in part'}`
      const marked = ts.recognized ? ts.sections.filter(s => s.kind === 'separate').map(s => s.name) : []
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
        insufficiency: { reason: 'SPAN_NOT_FOUND', missing: ['separate_opinion'], detail: `whose words: the citation names ${who}, and ${at} marks no such opinion (${marked.length > 0 ? `the separate opinions it marks: ${listOf(marked)}` : 'it marks no separate opinion'}), so the quotation cannot be checked against it. Supply the text with that opinion and the line that designates it ("Justice ${named.author}, dissenting."), or quote the majority opinion without the parenthetical.` },
        locked: false, explanation: `${label}: the citation names ${who}, which the supplied text does not mark; the quotation was not checked.` }
    }
  } else target = ts.sections.filter(s => s.kind === 'majority')
  const view = ts.recognized ? separatedView(text, target) : text
  // legal@0.5.2: a lead opinion that is a plurality is "the lead opinion" in every answer that names it
  const leadName = v052 && ts.plurality ? 'the lead opinion' : undefined
  const x: Context050 = { full: text, hash, ts, target, targetName: named ? (target[0] as Section).name : leadName ?? 'the majority opinion', named: named !== undefined, ...(v051 ? { v051 } : {}), ...(v052 ? { v052 } : {}), ...(leadName ? { leadName } : {}), ...(v053 ? { v053 } : {}), ...(v054 ? { v054 } : {}), ...(v055 ? { v055 } : {}) }
  const claim = v051 ? quote051(quote, base, label, view, L, x, cite) : quote060V010(quote, base, label, view, true, L, true, true, x)
  if (claim.outcome !== 'PASS') return claim
  const loc = claim.evidence[0]?.locator
  const start = loc?.kind === 'span' ? loc.start : 0
  const where = !ts.recognized
    ? `Found at line ${lineAt(text, start)} of the supplied text (character offset ${start}).`
    : v052 && ts.plurality && !x.named && sectionAt(ts, start).kind === 'majority'
      ? pluralityWhere052(ts.plurality, text, start)
      : `Found in ${x.named ? `${x.targetName}, as the citation says` : sectionAt(ts, start).name}, line ${lineAt(text, start)} (character offset ${start}).`
  return { ...claim, explanation: `${claim.explanation} ${where}${pin !== undefined ? ` The pin page ${pin} is not checked.` : ''}` }
}

/**
 * legal@0.5.2: where a PASS matched in a lead opinion that is a plurality, and what the designation makes of that place: "Found in Part
 * III of the lead opinion, line 7 (character offset 304): a plurality opinion, not an opinion of the Court; the designation makes the
 * lead opinion the Court's only as to Parts I and II (line 3: "…")." Never "the majority opinion".
 */
function pluralityWhere052(p: Plurality, text: string, start: number): string {
  const at = pluralityAt(p, start)
  const place = `${at.part !== undefined ? `Part ${at.part} of ` : ''}the lead opinion, line ${lineAt(text, start)} (character offset ${start})`
  const parts = (xs: string[]): string => `${xs.length === 1 ? 'Part' : 'Parts'} ${listOf(xs)}`
  const said = `line ${p.line}: "${clipWords(p.designation, 160)}"`
  if (p.kind === 'whole') return `Found in ${place}: a plurality opinion, not an opinion of the Court; it announces the judgment of the Court, and no part of it is the Court's opinion (${said}).`
  const courtOnly = p.court.length > 0 ? `the designation makes the lead opinion the Court's only as to ${parts(p.court)}` : 'the designation names the parts that are not the Court\'s'
  if (at.status === 'plurality') return `Found in ${place}: a plurality opinion, not an opinion of the Court; ${courtOnly} (${said}).`
  if (at.status === 'court') return `Found in ${place}: an opinion of the Court as to that part; the lead opinion is a plurality as to ${parts(p.plurality)} (${said}).`
  return `Found in ${place}, in a stretch the designation does not assign: ${courtOnly}, and the lead opinion is a plurality as to ${parts(p.plurality)} (${said}).`
}

interface Hit050 { s: Section; span: { start: number; end: number }; how: 'found' | 'read-out' | 'nearest'; tokens?: string[] }

/** legal@0.5.0: the sections other than the opinion read, in text order, whose words hold the quotation (as read, or with unread marks read out). */
function sectionHits050(quote: string, x: Context050, L: QuotationLimits): Hit050[] {
  const others = x.ts.sections.filter(s => !x.target.includes(s))
  if (others.length === 0) return []
  // the common case first, on the whole text (prepared once per text): nowhere in it, so nowhere in a section of it
  const anywhere = readQuotation(legalPreparedFor(x.full, 'safe').prepared, quote, L).kind === 'match' || readQuotation(legalPreparedFor(x.full, 'wide').prepared, quote, L).kind === 'match'
  if (!anywhere) return []
  const hits: Hit050[] = []
  for (const s of others) {
    const view = separatedView(x.full, [s])
    const safe = legalPreparedFor(view, 'safe').prepared
    const r = readQuotation(safe, quote, L)
    if (r.kind === 'match') { hits.push({ s, span: r.span, how: 'found' }); continue }
    const wide = legalPreparedFor(view, 'wide').prepared
    const w = readQuotation(wide, quote, L)
    if (w.kind === 'match') {
      const known = new Set((safe.marks ?? []).map(m => `${m.start}:${m.end}`))
      const tokens = (wide.marks ?? []).filter(m => m.start >= w.span.start && m.end <= w.span.end && !known.has(`${m.start}:${m.end}`)).map(m => `"${markShown(x.full, m)}"`)
      hits.push({ s, span: w.span, how: 'read-out', tokens })
    }
  }
  return hits
}

/** legal@0.5.0: can't tell, the quotation's words (or its nearest passage) found outside the opinion it is attributed to. */
function sectionHold050(hits: Hit050[], base: ClaimBase, label: string, sourceHash: string, x: Context050): ClaimVerdict {
  const at = suppliedFor(label)
  const first = hits[0] as Hit050
  const names = listOf([...new Set(hits.map(h => h.s.name))])
  const line = lineAt(x.full, first.span.start)
  const kinds = new Set(hits.map(h => h.s.kind))
  const editorialOnly = [...kinds].every(k => k === 'editorial' || k === 'header')
  const notIn = x.named ? `${x.targetName}, which the citation names` : editorialOnly && x.target.length > 0 ? 'the opinion' : x.leadName ?? 'the majority opinion'
  const how = first.how === 'nearest'
    ? `the nearest passage, a partial match only, is in ${names} of ${at}`
    : `the quoted words appear${first.how === 'read-out' && first.tokens?.length ? ` (with ${first.tokens.join(', ')} read out)` : ''} in ${names} of ${at}`
  const why: string[] = []
  if (kinds.has('editorial') || kinds.has('header')) why.push('A synopsis, headnotes, a case summary, core terms, a syllabus and a header are written by the publisher or the reporter, not by the judges: they are not the opinion and are never checked as it.')
  if (kinds.has('separate')) why.push('A separate opinion is not the majority\'s: quote it with a parenthetical that names it ("(Brennan, J., dissenting)"), and the quotation is checked against that opinion.')
  if (kinds.has('majority')) why.push('The words are the majority opinion\'s, not the separate opinion the citation names.')
  if (kinds.has('footnotes')) why.push('Footnotes printed after every opinion cannot be assigned to one of them.')
  const unmarked = !x.named && x.target.length === 0
    ? ' The supplied text marks no start of the majority opinion (an "Opinion" heading, or the line saying who delivered the opinion), so the text after each heading is read as that heading\'s.' : ''
  return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [{ ...spanEvidence(sourceHash, first.span, x.full.slice(first.span.start, first.span.end)), role: 'CONTEXT' }],
    insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `whose words: ${how} (line ${line}), not in ${notIn}. ${why.join(' ')}${unmarked} Cannot certify as quoted from ${notIn}.` },
    locked: false, explanation: `${label}: ${first.how === 'nearest' ? `the nearest passage is in ${names}` : `the quoted words appear in ${names}`} (line ${line}), not in ${notIn}; not certified.` }
}

/** legal@0.5.0: the quotation is not in the opinion it is attributed to, as quoted (the order is above quote050). */
function notFound050(r: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string, prepared: LegalPreparedSource, L: QuotationLimits, x: Context050): ClaimVerdict {
  const at = suppliedFor(label)
  // 1. an unread footnote call or page mark inside the quoted words (the wide set: "n7", "FN6", "[4]", superscript digits)
  const wide = legalPreparedFor(prepared.raw, 'wide').prepared
  const lr = readQuotation(wide, quote, L)
  if (lr.kind === 'match') {
    const safe = new Set((prepared.marks ?? []).map(m => `${m.start}:${m.end}`))
    const extra = (wide.marks ?? []).filter(m => m.start >= lr.span.start && m.end <= lr.span.end && !safe.has(`${m.start}:${m.end}`)).map(m => `"${markShown(x.full, m)}"`)
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [spanEvidence(sourceHash, lr.span, x.full.slice(lr.span.start, lr.span.end))],
      insufficiency: { reason: 'UNPARSEABLE', detail: `the quotation matches ${at} only when ${extra.length === 1 ? 'a token' : 'tokens'} inside the quoted words ${extra.length === 1 ? 'is' : 'are'} read out (${extra.join(', ') || 'a possible page mark'}), which may be a page marker or a footnote call. The engine reads out on its own only star paging between words and a footnote numeral glued to sentence punctuation, so it cannot tell whether the quotation is accurate; it does not call it a misquotation.` },
      locked: false, explanation: `${label}: the quotation matches the supplied text only with ${extra.join(', ') || 'a possible page mark'} read out, which may be a page marker or footnote call; can't tell.` }
  }
  // 2. its words elsewhere in the text: never the opinion's words
  if (x.ts.recognized) {
    const hits = sectionHits050(quote, x, L)
    if (hits.length > 0) return sectionHold050(hits, base, label, sourceHash, x)
  }
  // 3. a passage of the opinion, or 5. not found
  if (r.kind === 'passage' || !x.ts.recognized) return passage040(r, quote, base, label, sourceHash, prepared, x.full)
  // 4. the nearest passage elsewhere in the text
  const fr = readQuotation(legalPreparedFor(x.full, 'safe').prepared, quote, L)
  if (fr.kind === 'passage') {
    const s = sectionAt(x.ts, (fr.core ?? fr.span).start)
    if (!x.target.includes(s)) return sectionHold050([{ s, span: fr.core ?? fr.span, how: 'nearest' }], base, label, sourceHash, x)
  }
  return passage040(r, quote, base, label, sourceHash, prepared, x.full)
}

// ── legal@0.5.1: the cut, the conventions a quotation discloses (2026-10-06) ─────────────────────────────────────────────────────
//
// legal@0.5.1 reads a quotation as 0.5.0 does, against the opinion it is attributed to, and changes four things (quote051):
//   1. Dashes and headnote numbers: an em dash, an en dash and "--" are one dash; a Westlaw headnote number between sentences ("[9]
//      Second, …") is read out like star paging; a sentence ends after a number ("… 127 S.Ct. 1955. To survive …").
//   2. What the quotation discloses: "(citation omitted)", "(citations omitted)" and "(cleaned up)" let a citation sentence inside the
//      quoted words be absent; "(footnote omitted)" and "(cleaned up)" a footnote call; "(internal quotation marks omitted)" and
//      "(cleaned up)" the text's inner quotation marks; "(alteration in original)" names the text's own brackets. The parenthetical
//      may stand in the quotation or after the citation. The PASS says what each excused.
//   3. The cut at the end: a quotation that stops before its sentence ends is never called "verbatim"; its PASS prints how the
//      sentence continues ("the sentence continues: "…, and the complaint here is sufficient to state a claim.""). When the
//      continuation limits or negates the quoted words (quotation.ts tailLimitOf: "… complaint" + " is inapplicable to legal
//      conclusions", ", but it does not unlock …"), the answer is can't tell: "the cut ends before a limitation". A closing ellipsis
//      over such a continuation is the same. A fragment presented as a whole sentence (a capital at its start and a period at its
//      end, words before it in the sentence) is said to be one, with the full sentence.
//   4. Its FAILs: the words that differ as the text prints them, punctuation named ("the text has a comma after "action" that the
//      quotation leaves out"), a long run clipped; a citation sentence left out without saying so is named as that; words joined
//      from passages farther apart than an ellipsis is read for are named as that; a can't tell on a possible page mark never asks
//      for an edited download (LEGAL_REMEDIES_V051).

/** What a quotation discloses by its parentheticals (its own, and its cite's): which conventions are excused, and by which words. */
interface Disclosed051 { citations?: string; footnotes?: string; marks?: string; original?: string; cite: string[] }
function disclosed051(quote: string, cite: string | undefined): Disclosed051 {
  const own = conventionParentheticalsOf(quote)
  const fromCite = conventionParentheticalsOf(cite)
  const all = [...own, ...fromCite]
  const find = (re: RegExp): string | undefined => all.find(p => re.test(p))
  const out: Disclosed051 = { cite: fromCite }
  const citations = find(/citations?\s+omitted|cleaned\s+up/i)
  const footnotes = find(/footnotes?\s+omitted|cleaned\s+up/i)
  const marks = find(/(?:quotation\s+marks?|quotations?)\s+omitted|cleaned\s+up/i)
  const original = find(/(?:alterations?|brackets?)\s+in\s+original/i)
  if (citations !== undefined) out.citations = citations
  if (footnotes !== undefined) out.footnotes = footnotes
  if (marks !== undefined) out.marks = marks
  if (original !== undefined) out.original = original
  return out
}

/** A stretch shown in a note: whitespace collapsed, at most 90 characters (its start and end kept). */
const clipShort = (s: string): string => clipWords(s, 90)

/** The quotation without its convention parentheticals and quotation marks at its edges, for reading its first and last characters. */
const bareQuote = (q: string): string => q.replace(/\(\s*(?:cleaned\s+up|[^()]*\b(?:omitted|added|supplied|in\s+original|removed))\s*\)/giu, ' ').trim()

/** The dash forms a string uses ("—", "–", "--"), for a note when the quotation's differ from the text's. */
const dashForms = (s: string): string[] => [...new Set([...s.matchAll(/-{2,3}|[—–―]/g)].map(m => m[0]))]

/**
 * legal@0.5.1: one citation's quotation against the view of the opinion it is attributed to (quote050). The readings, in order: the
 * text with its page marks and headnote numbers read out; then, when the quotation discloses them, with its footnote calls read out,
 * its citation sentences, or both. The first that matches goes through every 0.5.0 guard and then the cut at the end (above).
 */
function quote051(quoteIn: string, base: ClaimBase, label: string, text: string, L: QuotationLimits, x: Context050, cite: string | undefined): ClaimVerdict {
  // legal@0.5.4 (`v054`): a "(quoting …)" or "(citing …)" parenthetical written after the quoted words, in the quotation field, is the
  // brief's own (LEGAL.md tells the writer to carry it): it is read as the citation field's parenthetical is, never compared as words
  const v054 = x.v054 === true
  const quotingParen = v054 ? QUOTING_PAREN_054.exec(quoteIn) : null
  const quote = quotingParen ? quoteIn.slice(0, quotingParen.index).replace(/\s+$/u, '') : quoteIn
  const d = disclosed051(quote, cite)
  const sourceHash = x.hash
  const at = suppliedFor(label)
  // legal@0.5.3 (`v053`): a citation clause may be read out with the comma before it, or with the commas on both sides
  const v053 = x.v053 === true
  const tries: { mode: 'safe' | 'wide'; citations: boolean; commas?: 'both' }[] = [{ mode: 'safe', citations: false }]
  if (d.footnotes !== undefined) tries.push({ mode: 'wide', citations: false })
  if (d.citations !== undefined) tries.push({ mode: 'safe', citations: true })
  if (d.citations !== undefined && v053) tries.push({ mode: 'safe', citations: true, commas: 'both' })
  if (d.citations !== undefined && d.footnotes !== undefined) tries.push({ mode: 'wide', citations: true })
  if (d.citations !== undefined && d.footnotes !== undefined && v053) tries.push({ mode: 'wide', citations: true, commas: 'both' })
  // legal@0.5.2 (`v052`): every reading also reads out page furniture and Lexis headnote markers (quotation.ts furnitureMarksOf)
  const v052 = x.v052 === true
  // legal@0.5.5 (`v055`): every reading reads a ligature as its letters, and a rule, code or Restatement citation as a citation
  const v055 = x.v055 === true
  const first = legalPreparedFor(text, 'safe', true, false, v052, v053, 'before', v055).prepared
  let prepared = first
  let r = readQuotation(first, quote, L)
  for (const t of tries.slice(1)) {
    if (r.kind === 'match') break
    const p = legalPreparedFor(text, t.mode, true, t.citations, v052, v053, t.commas ?? 'before', v055).prepared
    const rr = readQuotation(p, quote, L)
    if (rr.kind === 'match') { prepared = p; r = rr }
  }
  if (r.kind !== 'match') return notFound051(readQuotation(first, quote, L) as Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote, base, label, sourceHash, first, L, x, d)
  const read = prepared.blank ?? text
  const seen = read.slice(r.span.start, r.span.end)
  // the marks read out inside the match: the safe ones are named as 0.5.0 names them; a footnote call or a citation read out only
  // because the quotation says so is named with the parenthetical that excused it
  const safeKeys = new Set(first.marks?.map(m => `${m.start}:${m.end}`) ?? [])
  const inside = (prepared.marks ?? []).filter(m => m.start >= r.span.start && m.end <= r.span.end)
  const excused = inside.filter(m => !safeKeys.has(`${m.start}:${m.end}`))
  const marks = markNotes(text, inside.filter(m => safeKeys.has(`${m.start}:${m.end}`)), r.span.start, r.span.end)
  const ev = spanEvidence(sourceHash, r.span, r.text)
  // the notes: 0.5.0's, with an edge ellipsis said plainly (0.5.0's "(not located)" told a reader nothing), and what each disclosed
  // convention excused
  let edgeSeen = 0
  const notes = r.notes.map(n => {
    if (n !== 'an ellipsis at the edge of the quotation (not located)') return n
    const lead = edgeSeen++ === 0 && r.edges.lead === 'ellipsis'
    return lead ? 'an ellipsis at its start, over the start of its sentence' : 'an ellipsis at its end, over the rest of its sentence'
  })
  // a parenthetical that excused something is named by what it excused, not also as "stripped from the quotation"
  const used = new Set<string>()
  for (const m of excused) {
    // (legal@0.5.3: a citation clause is shown without the comma or semicolon that set it off; a citation sentence starts with neither)
    const what = text.slice(m.start, m.end).replace(/^[,;]\s*/u, '').replace(/,$/u, '')
    if (m.kind === 'citation') { notes.push(`the citation "${clipShort(what)}" left out, as "${d.citations}" says`); used.add(d.citations ?? '') }
    else { notes.push(`the footnote call "${markShown(text, m as PageMark)}" left out, as "${d.footnotes}" says`); used.add(d.footnotes ?? '') }
  }
  const qInnerText = ((): string => { const q = quote.trim(); return /^[“"„«]/.test(q) && /[”"‟»]$/.test(q) ? q.slice(1, -1) : q })()
  if (d.marks !== undefined && hasInnerQuotationMarks(seen) && !hasInnerQuotationMarks(qInnerText)) { notes.push(`the text's inner quotation marks left out, as "${d.marks}" says`); used.add(d.marks) }
  if (d.original !== undefined && /[[\]]/.test(seen)) { notes.push(`the brackets are the text's own, as "${d.original}" says`); used.add(d.original) }
  for (const pr of used) {
    const k = notes.indexOf(`parenthetical ${pr} stripped from the quotation`)
    if (k >= 0) notes.splice(k, 1)
  }
  const qd = dashForms(quote), td = dashForms(seen)
  if (qd.length > 0 && td.length > 0 && qd.join() !== td.join()) notes.push(`dashes read as one ("${qd.join('", "')}" in the quotation, "${td.join('", "')}" in the text)`)
  for (const pr of d.cite) if (!r.parentheticals.includes(pr)) notes.push(`parenthetical ${pr} after the citation read with the quotation`)
  if (quotingParen) notes.push(`the parenthetical "(${clipWords(quotingParen[1] as string, 90)})" after the quoted words read as the brief's own, not as the quotation`)
  // legal@0.5.4: an ellipsis over a whole "not X, but" contrast keeps what the text asserts (the words kept are the sentence's own
  // assertion), so it is neither a negation the quotation omits nor an elided condition; the note says so. Every other omission is read as before.
  const contrasts = v054 ? r.omissions.filter(o => NOT_BUT_054.test(o.trim())) : []
  const omissionsRead = contrasts.length > 0 ? r.omissions.filter(o => !contrasts.includes(o)) : r.omissions
  const selective = r.selective !== undefined && !(contrasts.length > 0 && r.selective.via === 'ellipsis' && !omissionsRead.some(o => NEGATION.test(o))) ? r.selective : undefined
  for (const o of contrasts) notes.push(`an ellipsis stands for a "not …, but" contrast omitted whole ("${clipWords(o.trim(), 90)}"): the words kept are what the text asserts`)
  // legal@0.5.5: a ligature the text prints inside the match is read as its letters, and the answer says so (never "verbatim")
  if (v055) {
    const ligs = ligaturesIn055(seen).filter(l => !quote.includes(l.slice(1, 2)))
    if (ligs.length > 0) notes.push(`${ligs.length === 1 ? 'a ligature' : 'ligatures'} in the text read as letters (${ligs.join(', ')})`)
  }
  if (notes.length > 0 || marks.length > 0) ev.normalizations = [...notes, ...marks]
  // 0.5.0's guards, in its order, read on the text with every mark read out (an inner quotation inside a citation the quotation
  // leaves out is not the quoted words'); a cite's parenthetical counts as the quotation's own
  const m = meaningOf({ ...r, text: seen, parentheticals: [...r.parentheticals, ...d.cite], omissions: omissionsRead }, quote, v055 ? { v055: true } : {})
  if (m?.kind === 'altered') {
    const whole = sentenceSpanOf(read, r.span, true)
    const says = shownText(read.slice(whole.start, whole.end))
    return { ...base, outcome: 'FAIL', locked: true,
      computation: { formula: 'a bracket = the word it replaces (case, inflection), a pronoun or referent, or an insertion with no modal, negation, quantifier or limit', operands: { brief_quote: quote, opinion_says: says, bracket: m.bracket, replaces: m.replaced }, result: says },
      evidence: [ev],
      explanation: m.replaced === ''
        ? `The quotation alters the meaning of ${at}: the bracket ${m.bracket} inserts "${m.bracket.replace(/^\[|\]$/g, '')}", which the text does not have there. The passage there reads: "${says}"`
        : `The quotation alters the meaning of ${at}: the bracket ${m.bracket} stands for "${m.replaced}", and ${m.why}. The passage there reads: "${says}"` }
  }
  if (m?.kind === 'guarded-edge') {
    // legal@0.5.5 holds an edge bracket for more kinds of word than these four, and names them so
    const kinds = v055 ? 'a word that can change what the passage says' : 'a modal, negation, quantifier or limit'
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the bracketed alteration ${m.bracket} carries "${m.word}" (${kinds}), and what it replaces in ${at} cannot be located to compare. This may alter the passage's meaning — cannot certify as accurately quoted; verify in context.` },
      locked: false, explanation: `${label}: a bracket carrying "${m.word}" could not be compared with the supplied text; not certified.` }
  }
  if (selective) {
    const how = selective.via === 'ellipsis' ? 'an omission' : 'an alteration'
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the quoted words appear in ${at}, but ${selective.detail}. This may be a selective quotation that inverts the passage — cannot certify as accurately quoted; verify in context.` },
      locked: false, explanation: `${label}: quoted words present, but ${how} in the quotation changes a negation; not certified — possible selective quotation.` }
  }
  if (m?.kind === 'condition') {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${clipWords(m.elided)}" from ${at}, which carries "${m.word}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately quoted; verify in context.` },
      locked: false, explanation: `${label}: elided condition — the ellipsis omits "${m.word}" and what it governs; not certified.` }
  }
  // legal@0.5.5: a bracket that inserts a content word this check does not read (quotation.ts insertedWord055): a person decides
  if (m?.kind === 'inserted') {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['inserted_words'], detail: `inserted words: the bracket ${m.bracket} inserts "${m.word}", which ${at} does not have there. A bracket may change case, tense or a pronoun, or name what a pronoun refers to; whether this one narrows or changes what the text says is a judgement this check does not make — cannot certify as accurately quoted; the attorney of record decides.` },
      locked: false, explanation: `${label}: the bracket ${m.bracket} inserts "${m.word}", which the supplied text does not have there; not certified.` }
  }
  for (const o of omissionsRead) {
    const w = conditionIn030(o)
    if (w === undefined) continue
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${clipWords(o)}" from ${at}, which carries "${w}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately quoted; verify in context.` },
      locked: false, explanation: `${label}: elided condition — the ellipsis omits "${w}" and what it governs; not certified.` }
  }
  // legal@0.5.3 reads no sentence end before a small letter ("American Bd. of Psychiatry"), and a negation only up to "but"
  // legal@0.5.3 reads the words around the match on the text without the citations a parenthetical excused, so a citation read out
  // before the quotation never hides the sentence end before it ("… (1957). While …")
  const ctx = v053 ? (first.blank ?? text) : read
  // legal@0.5.4: an ellipsis that omits a part of a condition joined by "and", "or" or "nor" ("where the injury is inherently unknowable
  // . . . , but" for "… unknowable and the plaintiff is blamelessly ignorant of it, but") narrows or widens the condition the sentence
  // states: can't tell, naming the part left out (a cold review's genuine-looking quotation that legal@0.5.3 passed)
  // legal@0.5.5: where each omission lies in the text (quotation.ts records it); legal@0.5.4 looked the omitted words up by their text
  const spanOfOmission = (o: string): { start: number; end: number } | undefined => { const k = r.omissions.indexOf(o); return k >= 0 ? r.omissionSpans?.[k] : undefined }
  if (v054) {
    for (const o of omissionsRead) {
      const conj = /^[\s,;]*(and|or|nor)(?![\p{L}])/iu.exec(o)
      if (!conj) continue
      const oAt = v055 ? (spanOfOmission(o)?.start ?? -1) : text.indexOf(o, r.span.start)
      if (oAt < 0 || oAt > r.span.end) continue
      const clause = sentenceHeadBefore(ctx, oAt, 600, 'v053').split(/[;:]/).pop() ?? ''
      const w = conditionIn030(clause)
      // legal@0.5.5: a set-off phrase of time the omitted part belongs to (", within a reasonable time after he discovers . . . any breach,"
      // for "… discovers or should have discovered any breach,"), as LEGAL.md's "Conditions" reads one
      const time = w === undefined && v055 ? timePhraseOf055(clause) : undefined
      if (w === undefined && time === undefined) continue
      if (time !== undefined) {
        return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
          insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['elided_words'], detail: `elided condition: the quotation's ellipsis omits "${clipWords(o.trim())}" from ${at}, a part of the time phrase its sentence states ("${clipWords(time.phrase, 90)} …") that "${conj[1]}" joins to the words kept; quoted without it, the time reads as narrower or broader than the text's — cannot certify as accurately quoted; verify in context.` },
          locked: false, explanation: `${label}: elided condition — the ellipsis omits "${clipWords(o.trim(), 90)}", a part of the time phrase joined by "${conj[1]}"; not certified.` }
      }
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation's ellipsis omits "${clipWords(o.trim())}" from ${at}, a part of the condition its sentence states ("${w} …") that "${conj[1]}" joins to the words kept; quoted without it, the condition reads as broader or narrower than the text's — cannot certify as accurately quoted; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ellipsis omits "${clipWords(o.trim(), 90)}", a part of the condition joined by "${conj[1]}"; not certified.` }
    }
  }
  // legal@0.5.5: an ellipsis that omits words that say who must show what, a word of degree, frequency or hedging (in the part of the omission
  // that belongs to a kept sentence), or words from inside a clause, answers can't tell: such a cut can invert or widen what the kept words
  // say ("are . . . enforced" for "are rarely enforced"), and the guards above read only listed condition words (a cold review: 13 of 19
  // adverb cuts passed under legal@0.5.4; an AI agent in a legal-operations role, not a person)
  if (v055) {
    for (const o of omissionsRead) {
      const shown = clipWords(o.trim(), 160), short = clipWords(o.trim(), 90)
      const parts = keptSentenceParts055(o)
      const burden = parts.map(burdenIn055).find(w => w !== undefined)
      if (burden !== undefined) {
        return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
          insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['elided_words'], detail: `elided burden: the quotation's ellipsis omits "${shown}" from ${at}, words that say who must show what ("${burden}"); quoted without them, the kept words may put the burden on someone else, or on no one — cannot certify as accurately quoted; verify in context.` },
          locked: false, explanation: `${label}: elided burden — the ellipsis omits "${short}"; not certified.` }
      }
      const hedge = parts.map(hedgeIn055).find(w => w !== undefined)
      if (hedge !== undefined) {
        return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
          insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['elided_words'], detail: `elided qualifier: the quotation's ellipsis omits "${shown}" from ${at}, which carries "${hedge}", a word of degree, frequency or hedging; quoted without it, the kept words may say more, or the opposite, of what the text says — cannot certify as accurately quoted; verify in context.` },
          locked: false, explanation: `${label}: elided qualifier — the ellipsis omits "${hedge}"; not certified.` }
      }
      const where = spanOfOmission(o)
      if (where !== undefined && cutInsideClause055(read, where)) {
        return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
          insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['elided_words'], detail: `cut inside a clause: the quotation's ellipsis omits "${shown}" from the middle of a clause in ${at}: on at least one side, no comma, dash, parenthesis or sentence end sets the omitted words off from the words kept. Words left out there can change what the kept words say (how often, how far, who, or whether) — cannot certify as accurately quoted; verify in context.` },
          locked: false, explanation: `${label}: the ellipsis omits "${short}" from inside a clause; not certified.` }
      }
    }
  }
  const head = sentenceHeadBefore(ctx, r.span.start, 600, v053 ? 'v053' : true)
  const negated = (t: string, at0: number): boolean => (v054 ? precededByNegation054(t, at0) : v053 ? precededByNegation053(t, at0) : precededByNegation(t, at0))
  // the continuation is read with every footnote-call form blanked too, so "… immaterial.[4] [*323] The moving party …" ends the
  // sentence at "immaterial." (a glued call is not read out of the comparison, but it does not join two sentences)
  const tail = continuationAfter(legalPreparedFor(text, 'wide', true, false, v052, v053).prepared.blank ?? read, r.span.end, v053)
  const cont = /\p{L}/u.test(tail) && !onlyCitation(tail) ? tail : ''
  if (r.edges.lead !== undefined) {
    const w = conditionIn030(head)
    if (w !== undefined) {
      const that = r.edges.lead === 'ellipsis'
        ? `the quotation opens with an ellipsis that leaves out the start of its sentence in ${at}, "${clipWords(head)}", which carries "${w}"`
        : `the quotation opens with a ${r.edges.bracketed ? 'bracketed ' : ''}capital, which presents its words as the start of a sentence, but in ${at} they follow "${clipWords(head)}", which carries "${w}"`
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: ${that}; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately quoted; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ${r.edges.lead === 'ellipsis' ? 'ellipsis' : 'capital'} at its start leaves out "${w}" and what it governs; not certified.` }
    }
  }
  if (r.edges.trail === 'ellipsis') {
    const w = conditionIn030(tail)
    if (w !== undefined) {
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided condition: the quotation closes with an ellipsis that leaves out the rest of its sentence in ${at}, "${clipWords(tail)}", which carries "${w}"; quoted without it, a conditional or limited passage may read as absolute — cannot certify as accurately quoted; verify in context.` },
        locked: false, explanation: `${label}: elided condition — the ellipsis at its end leaves out "${w}" and what it governs; not certified.` }
    }
  }
  if (r.edges.lead === undefined) {
    const cut = /\p{L}/u.test(head) ? leadCutOf(head, v054 ? { v054: true, next: ctx.slice(r.span.start, r.span.start + 12) } : {}) : undefined
    if (cut && (cut.kind === 'condition' || !negated(ctx, r.span.start))) {
      const cond = cut.kind === 'condition'
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `elided ${cond ? 'condition' : 'negation'}: the quotation begins in the middle of its sentence in ${at}, after "${clipWords(head)}", which carries ${cond ? '' : 'the negation '}"${cut.word}"; quoted without it, ${cond ? 'a conditional or limited passage may read as absolute' : 'the passage may read as the opposite of what the text says'} — cannot certify as accurately quoted; verify in context.` },
        locked: false, explanation: `${label}: elided ${cond ? 'condition' : 'negation'} — the quotation begins after "${clipWords(head)}", leaving out "${cut.word}" and what it governs; not certified.` }
    }
  }
  if (m?.kind === 'nested') {
    const detail = m.detail.replace('gives those words to the court', 'gives those words to the opinion itself').replace('give the court\'s own words to someone else', 'give the opinion\'s own words to someone else')
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `nested quotation: ${detail}. Cannot certify as accurately quoted; verify in context.` },
      locked: false, explanation: `${label}: nested quotation — the inner quotation marks do not match the supplied text's; not certified.` }
  }
  if (negated(ctx, r.span.start)) return precededClaim(base, label, ev)
  const disclosedCase = r.parentheticals.some(p => /emphasis/i.test(p)) || d.cite.some(p => /emphasis/i.test(p))
  if (r.cases.changed > 0 && !disclosedCase) {
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `case change: the quotation writes "${clipWords(r.cases.quoted ?? '')}" where ${at} reads "${clipWords(r.cases.reads ?? '')}"; the words match, but not as written. Restore the letter case the text has, or say how the quotation changes it (for capitals added for emphasis, "(emphasis added)") — cannot certify as accurately quoted.` },
      locked: false, explanation: `${label}: the words are in the supplied text, but the quotation changes their letter case; not certified.` }
  }
  if (r.cases.changed > 0) notes.push('letter case differs from the text\'s, disclosed by the parenthetical')
  // legal@0.5.4: the case of the first letter (of the quotation, or of the words after an ellipsis) changed without a bracket is a changed
  // letter case like any other: can't tell, naming the bracket to write ("[s]ummary"). legal@0.5.3 allowed it and noted it on the PASS; a
  // cold review (an AI agent in a legal-operations role, not a person) marked the PASS as a miss against the page's promise.
  if (v054 && r.cases.firstLetter && !disclosedCase) {
    const bq = bareQuote(quote)
    const qFirst = /\p{L}/u.exec(bq), tFirst = /\p{L}/u.exec(seen)
    const atStart = qFirst !== null && tFirst !== null && qFirst[0] !== tFirst[0] && qFirst[0].toLowerCase() === tFirst[0].toLowerCase()
    const qWord = atStart ? (bq.slice(qFirst.index).match(/^[\p{L}'’-]+/u)?.[0] ?? qFirst[0]) : undefined
    const tWord = atStart ? (seen.slice(tFirst.index).match(/^[\p{L}'’-]+/u)?.[0] ?? tFirst[0]) : undefined
    const where = qWord !== undefined && tWord !== undefined ? `writes "${qWord}" where ${at} reads "${tWord}"` : `changes the case of the first letter after an ellipsis against ${at}`
    const bracketed = qWord !== undefined ? `"[${qWord[0]}]${qWord.slice(1)}"` : 'the letter in brackets'
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['letter_case'], detail: `case change: the quotation ${where}, with no bracket; the words match, but not as written. Write the changed letter in brackets (${bracketed}), or restore the letter case the text has — cannot certify as accurately quoted.` },
      locked: false, explanation: `${label}: the words are in the supplied text, but the quotation changes the case of its first letter without a bracket; not certified.` }
  }
  if (r.cases.firstLetter) notes.push('the case of its first letter differs from the text\'s')
  if (!r.cases.compared) notes.push('letter case not compared (the letters do not line up one for one)')
  // the cut at the end: what follows the quoted words in their sentence
  const bare = bareQuote(quote).replace(/^["“'‘\s]+|["”'’\s]+$/gu, '')
  // (words before it on its own line: a heading above it, which ends in a small letter and so runs on into the sentence, does not count)
  const dressed = /[.?!]$/.test(bare) && /^\[?\p{Lu}/u.test(bare) && hasWordsBefore(head.slice(Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r')) + 1))
  if (cont !== '') {
    const lim = tailLimitOf(cont)
    if (lim) {
      const ell = r.edges.trail === 'ellipsis'
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', detail: `the cut ends before a limitation: ${ell ? `the quotation closes with an ellipsis that leaves out the rest of its sentence in ${at}` : `the quotation stops before its sentence ends in ${at}`}, and the sentence continues "…${clipWords(cont)}", which carries ${lim.kind === 'negation' ? 'the negation ' : ''}"${lim.word}"; quoted without it, the words may read as broader than, or the opposite of, what the text says — cannot certify as accurately quoted; verify in context.` },
        locked: false, explanation: `${label}: the cut ends before a limitation — the sentence continues "…${clipWords(cont)}"; not certified.` }
    }
  }
  // legal@0.5.2: the words before a quotation that begins in the middle of its sentence (its lead-in) are printed beside its PASS, and
  // read for whose words follow (quotation.ts leadFrameOf): reported speech, a counterfactual, a rejected reading or a question holds it
  const lead = v052 ? leadIn052(head, ctx, r.span.start) : ''
  const leadShown = clipWords(lead.replace(/¦/g, ' ').replace(/[\s"“'‘([]+$/u, ''), 160)
  // legal@0.5.3: the words may stand inside the opinion's own quotation of another source (inner quotation marks around them)
  const inner = v053 ? innerQuotation053(ctx, r.span) : undefined
  const frame = lead !== '' ? leadFrameOf(lead.replace(/¦/g, ' '), v054 ? { v054: true } : v053 ? { v053: true } : {}) : undefined
  // legal@0.5.3: another court's or another source's words that the opinion quotes are its quotation, named below; a party's, a
  // separate opinion's, a counterfactual or a rejected reading are held whether quoted or not
  if (frame && !(inner && (frame.kind === 'court' || frame.kind === 'source'))) {
    const w = leadFrameWords(frame)
    const whose = v053 ? whoseWords053(frame) : undefined
    const found = whose !== undefined ? `found as ${whose}, not the court's: ` : ''
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
      insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['lead_in'], detail: `${w.label}: ${found}the words follow "${leadShown}" in ${at} (line ${lineAt(x.full, r.span.start)}): ${w.why}. Quoted without those words, they read as the opinion's own holding — cannot certify as the opinion's words; verify in context.` },
      locked: false, explanation: `${label}: ${found}the words follow "${leadShown}": ${w.why}; not certified.` }
  }
  // legal@0.5.3: a sentence that follows one introducing another's view ("In his view, …", "Bravo makes two arguments.") is that view's
  // until the court speaks again ("We disagree.") or the paragraph ends
  const sentenceStart = r.span.start - head.length
  // legal@0.5.4: a sentence that opens on a headnote marker ("HN2[ ] A conclusory affidavit …", "[2] A court may …") is where the publisher
  // marks the court's own statement of a point of law; it carries no view from the sentence before it (a cold review's genuine quotations,
  // held under legal@0.5.3 as "someone else's position" after "Delacroix contends that …"). The marks are the ones the reading read out
  // (kind 'headnote': a Westlaw number standing between sentences, a Lexis "HNn[ ]"), with nothing but spaces and star paging before them.
  const headnoteStart = v054 && (first.marks ?? []).some(mk => mk.kind === 'headnote' && mk.start >= sentenceStart && mk.end <= r.span.start && /^\s*$/u.test(ctx.slice(sentenceStart, mk.start)))
  // legal@0.5.5: a quoted sentence that is itself in the court's voice ("That reading is foreclosed by the text.", the example LEGAL.md gives)
  // carries no view from the sentence before it; legal@0.5.4 read only the sentences before it, and held a cold review's quotation of it
  const ownVoice = v055 && lead === '' && courtVoice053(ctx.slice(sentenceStart, Math.min(ctx.length, r.span.end + tail.length)).replace(/¦/g, ' '), true)
  if (v053 && !headnoteStart && !ownVoice && !(lead !== '' && courtVoice053(lead.replace(/¦/g, ' '), v054))) {
    const carried = carriedView053(ctx, sentenceStart, v054)
    if (carried) {
      const w = leadFrameWords(carried.frame)
      const whose = whoseWords053(carried.frame) ?? 'someone else\'s position'
      const opener = clipWords(carried.text.replace(/¦/g, ' '), 160)
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['lead_in'], detail: `${w.label}: found as ${whose}, not the court's: the sentence before the quoted words in ${at} (line ${lineAt(x.full, carried.at)}) introduces another's view ("${opener}"), and the opinion does not speak in its own voice again before them (line ${lineAt(x.full, r.span.start)}). Quoted without that sentence, they read as the opinion's own holding — cannot certify as the opinion's words; verify in context.` },
        locked: false, explanation: `${label}: found as ${whose}, not the court's: the words follow "${opener}"; not certified.` }
    }
  }
  // legal@0.5.3: a quotation within the opinion: FAIL when the court's next words reject it, else PASS with the notice naming its source
  let notice = ''
  if (inner) {
    const source = attributionOf053(ctx, inner, frame, v054)
    const rejected = rejectionAfter053(ctx, r.span.end + tail.length, quote, source.name)
    if (rejected) {
      const says = clipWords(rejected.text.replace(/¦/g, ' '), 240)
      const line = lineAt(x.full, rejected.at)
      return { ...base, outcome: 'FAIL', locked: true,
        computation: { formula: 'brief_quote = the opinion\'s own words, not a quotation within the opinion that the court rejects', operands: { brief_quote: quote, opinion_says: says, rejected: source.name, rejected_at: `line ${line}` }, result: says },
        evidence: [ev],
        explanation: `The quoted words appear in ${at}, but as a quotation within the opinion, attributed to ${source.name}${source.how}, and the court rejected this standard: line ${line}: "${says}" The words are not the court's holding.` }
    }
    // legal@0.5.5: the court's next sentence departs from it in words the list above does not hold ("We part ways with that formulation
    // today."): can't tell, naming that sentence, never a PASS that says nothing of it (a cold review; an AI agent as a legal-operations buyer)
    const departed = v055 ? departureAfter055(ctx, r.span.end + tail.length, quote, source.name) : undefined
    if (departed) {
      const says = clipWords(departed.text.replace(/¦/g, ' '), 240)
      const line = lineAt(x.full, departed.at)
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [ev],
        insufficiency: { reason: 'SELECTIVE_QUOTE', missing: ['next_sentence'], detail: `a quotation within the opinion the court may depart from: the quoted words are the opinion's quotation of ${source.name}${source.how}, and the court's next words read: line ${line}: "${says}" Whether the court adopts these words or departs from them is a judgement this check does not make — cannot certify as the court's holding; the attorney of record reads the sentences after them.` },
        locked: false, explanation: `${label}: a quotation within the opinion, attributed to ${source.name}, and the court's next sentence may depart from it (line ${line}: "${clipWords(departed.text.replace(/¦/g, ' '), 120)}"); not certified.` }
    }
    // legal@0.5.4: the disclosure may stand in the quotation field too (quotingParen), where LEGAL.md told the writer to carry it
    const disclosure = (cite !== undefined ? /\(\s*((?:quoting|citing)\s(?:[^()]|\([^()]*\))*)\)/iu.exec(cite)?.[1] : undefined) ?? (quotingParen ? quotingParen[1] : undefined)
    notice = disclosure !== undefined
      ? ` It is a quotation within the opinion, attributed to ${source.name}, as the citation says (${disclosure.replace(/\s+/g, ' ').trim()}).`
      : source.cite === undefined
        ? ` It is a quotation within the opinion: the text sets these words in quotation marks and does not name their source here; the brief should say whom the opinion quotes ("(quoting …)").`
        : ` It is a quotation within the opinion, attributed to ${source.name}${source.how}; the brief should say (quoting ${source.cite}).`
  }
  // legal@0.5.3: a quotation that begins where its sentence begins prints the sentence before it in its paragraph
  const before = v053 && lead === '' ? previousSentence053(ctx, sentenceStart) : undefined
  const beforeNote = before !== undefined ? ` The sentence before it reads: "${clipWords(before.text.replace(/¦/g, ' '), 160)}"` : ''
  const conventions = notes.length > 0
  const said = marks.length > 0 && conventions ? `, read with ${marks.join(' and ')}, and with the quotation conventions it uses: ${notes.join('; ')}`
    : marks.length > 0 ? `, read with ${marks.join(' and ')}` : conventions ? `, read with the quotation conventions it uses: ${notes.join('; ')}` : ''
  if (cont === '' && !dressed && lead === '') {
    const said0 = said === '' ? `The quotation appears verbatim in ${at}: the same words, in the same letter case.`
      : marks.length > 0 && !conventions ? `The quotation appears in ${at}${said}: the same words, in the same letter case.` : `The quotation appears in ${at}${said}.`
    return { ...base, outcome: 'PASS', locked: true, evidence: [ev], explanation: `${said0}${notice}${beforeNote}` }
  }
  // a fragment: never "verbatim"; the PASS prints how the sentence begins (legal@0.5.2) and goes on, or the whole sentence when it is
  // presented as one
  const opening = said === '' ? `The quotation appears as quoted in ${at}, the same words in the same letter case` : `The quotation appears in ${at}${said}`
  const sentence = shownText(ctx.slice(r.span.start - head.length, r.span.end + tail.length))
  const rest = dressed
    ? `; it presents part of a sentence as a whole one. The full sentence reads: "${clipWords(sentence)}"`
    : lead !== '' && cont !== ''
      ? `, but it begins in the middle of its sentence and stops before its end; the sentence begins: "${leadShown}…" and continues: "…${clipWords(cont, v053 ? 400 : 200)}"`
      : lead !== ''
        ? `, but it begins in the middle of its sentence; the sentence begins: "${leadShown}…"`
        : `, but it stops before its sentence ends; the sentence continues: "…${clipWords(cont, v053 ? 400 : 200)}"`
  return { ...base, outcome: 'PASS', locked: true, evidence: [ev], explanation: `${opening}${rest}${notice}${beforeNote}` }
}

/**
 * legal@0.5.2: the words before a quotation in its sentence, when the quotation begins in the middle of it; '' when it begins where its
 * sentence begins. Words on the quotation's own line count; words only on earlier lines count when the quotation's first letter is a
 * small one (a hard-wrapped sentence), so a heading that ends in a small letter and runs on into the sentence does not.
 */
function leadIn052(head: string, read: string, start: number): string {
  const line = head.slice(Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r')) + 1)
  if (hasWordsBefore(line)) return head
  const first = /\p{L}/u.exec(read.slice(start, start + 40))?.[0]
  return first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase() && hasWordsBefore(head) ? head : ''
}

// ── legal@0.5.3: whose words, across sentences and inside the opinion's own quotations (2026-10-13) ─────────────────────────────────
//
// The negation guard reads its clause only after the last "but", as leadCutOf reads a negation: "we do not require heightened fact
// pleading of specifics, but only enough facts to state a claim to relief that is plausible on its face" does not negate the words after
// "but" (a cold review's genuine Twombly quotation, held under legal@0.5.2).
//
// A paragraph ends at a blank line, a section's edge, or where one of two neighbouring lines is longer than a hard-wrapped line (160
// characters): a download that prints one paragraph per line, as Westlaw and Lexis texts do, ends a paragraph at every line break.
//
// A quotation within the opinion: the quoted words stand inside the opinion's own quotation marks (an opening mark before them and its
// closing mark after them, in their paragraph). Its source is the speaker the lead-in names ("relying on Conley's statement that", "the
// Ninth Circuit held that"), else a case named in its sentence or in the citation after the closing mark, else "a source the text does not name here". When one
// of the next two sentences of the paragraph (a citation sentence aside, and none introducing another's view) rejects it, the answer is
// FAIL: a strong word of rejection ("retirement", "overrule", "abrogate", "repudiate", "disapprove", "abandon", "explained away", "no
// longer", "reject this standard"), not negated, in a sentence that names the statement ("this famous observation", "that language"),
// its source ("Conley's"), or three of the quotation's words in order.

const BUT_053 = /(?<![\p{L}])but(?![\p{L}])/iu
function precededByNegation053(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 80), start)
  const clause = before.split(/[.;:!?]/).pop() ?? before
  return NEGATION.test(clause.split(BUT_053).pop() ?? clause)
}

// ── legal@0.5.4: the clause a negation governs, a "(quoting …)" in the quotation, a "not X, but" contrast, a headnote-marked sentence (2026-10-14) ──
//
// The negation guard's clause also ends at a comma before a coordinating conjunction (quotation.ts CLAUSE_CUT_054): "does not create a
// genuine dispute, and a party may not defeat …" does not negate the words after ", and" (three genuine quotations of a cold review held
// under legal@0.5.3). A "(quoting …)" or "(citing …)" parenthetical at the end of the quotation field is the brief's own disclosure, as it is
// in the citation field (LEGAL.md told writers to carry it with the quoted words, and legal@0.5.3 FAILed a genuine quotation written so). An
// ellipsis over a whole "not X, but" contrast ("The question is . . . whether the method is reliable" for "The question is not whether the
// expert is right but whether the method is reliable") keeps what the text asserts. A sentence that opens on a headnote marker is the
// court's own statement of law: a publisher marks headnoted points where the court states them, never inside a party's reported argument.

function precededByNegation054(text: string, start: number): boolean {
  const before = continuesClause054(text.slice(Math.max(0, start - 80), start), text.slice(start, start + 12))
  const clause = before.split(/[.;:!?]/).pop() ?? before
  return NEGATION.test(clause.split(CLAUSE_CUT_054).pop() ?? clause)
}
/** A "(quoting …)" or "(citing …)" parenthetical ending the quotation field, its nested parentheses ("(1960)") included; closing marks after it aside. */
const QUOTING_PAREN_054 = /\s*\(\s*((?:quoting|citing)\s(?:[^()]|\([^()]*\))*)\)\s*["”’)\]]*\s*$/iu
/** An omitted stretch that is a whole "not X, but" contrast: it opens with a negation and closes with "but" (or "but rather", "but instead"). */
const NOT_BUT_054 = /^[,;]?\s*(?:not|never|neither)(?![\p{L}])[\s\S]{0,400}?(?<![\p{L}])but(?:\s+(?:rather|instead))?\s*,?$/iu

/** legal@0.5.3: whose words a frame makes the quotation, as an answer says it; undefined for a frame that is not reported speech. */
function whoseWords053(f: LeadFrame): string | undefined {
  switch (f.kind) {
    case 'party': return 'a party\'s position'
    case 'separate': return 'a separate opinion\'s view'
    case 'court': return 'another court\'s words'
    case 'source': return 'another opinion\'s or source\'s words'
    case 'other': case 'argument': return 'someone else\'s position'
    default: return undefined
  }
}

const lineBounds = (read: string, at: number): { s: number; e: number } => {
  const s = read.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const n = read.indexOf('\n', at)
  return { s: at > 0 && read[at - 1] === '\n' ? at : s, e: n < 0 ? read.length : n }
}
const lineText = (read: string, b: { s: number; e: number }): string => read.slice(b.s, b.e).replace(/\r$/u, '')
/** Whether a paragraph ends between two neighbouring lines (above). */
const paragraphBreak = (a: string, b: string): boolean => a.trim() === '' || b.trim() === '' || a.includes('¦') || b.includes('¦') || a.length > 160 || b.length > 160 || /^(?:\t| {2,})/.test(b)

/** legal@0.5.3: where the paragraph holding offset `at` begins. */
function paragraphStart053(read: string, at: number): number {
  let cur = lineBounds(read, at)
  for (let guard = 0; guard < 400 && cur.s > 0; guard++) {
    const prev = lineBounds(read, cur.s - 1)
    if (paragraphBreak(lineText(read, prev), lineText(read, cur))) return cur.s
    cur = prev
  }
  return cur.s
}
/** legal@0.5.3: where the paragraph holding offset `at` ends. */
function paragraphEnd053(read: string, at: number): number {
  let cur = lineBounds(read, at)
  for (let guard = 0; guard < 400 && cur.e < read.length; guard++) {
    const next = lineBounds(read, cur.e + 1)
    if (paragraphBreak(lineText(read, cur), lineText(read, next))) return cur.e
    cur = next
  }
  return cur.e
}

/** legal@0.5.3: the sentence that ends before `start` in the same paragraph (a citation sentence passed over), or undefined. */
function previousSentence053(read: string, start: number): { at: number; text: string } | undefined {
  const floor = paragraphStart053(read, start)
  let e = start - 1
  for (let guard = 0; guard < 4; guard++) {
    while (e >= floor && /\s/.test(read[e] as string)) e--
    if (e < floor || read[e] === '¦') return undefined
    const head = sentenceHeadBefore(read, e, 600, 'v053')
    const from = Math.max(floor, e - head.length)
    const raw = read.slice(from, e + 1)
    const lead = raw.length - raw.replace(/^[\s¦]+/u, '').length
    const text = raw.trim().replace(/^¦+/u, '').trim()
    if (!/\p{L}/u.test(text)) return undefined
    if (onlyCitation(text)) { e = from - 1; continue }
    return { at: from + lead, text }
  }
  return undefined
}

/** legal@0.5.3: the sentence that starts at or after `from`, within the paragraph that ends at `limit`, or undefined. */
function nextSentence053(read: string, from: number, limit: number): { at: number; end: number; text: string } | undefined {
  let i = from
  while (i < limit && /[\s"”’)\]]/.test(read[i] as string)) i++
  if (i >= limit || read[i] === '¦') return undefined
  let end = i + sentenceTailAfter(read, i, 600, 'v053').length
  while (end < read.length && /["”’)\]]/.test(read[end] as string)) end++
  const text = read.slice(i, Math.min(end, limit)).trim()
  if (!/[\p{L}\p{N}]/u.test(text)) return undefined
  return { at: i, end, text }
}

/** legal@0.5.3: the view a sentence before the quotation opened, when the court has not spoken in its own voice since (above). legal@0.5.4 (`v054`): a party's filing opens a view; a sentence judging a stated rule is the court's voice. */
function carriedView053(read: string, start: number, v054 = false): { frame: LeadFrame; text: string; at: number } | undefined {
  let cursor = start
  for (let n = 0; n < 3; n++) {
    const prev = previousSentence053(read, cursor)
    if (!prev) return undefined
    if (courtVoice053(prev.text, v054)) return undefined
    const f = viewOpener053(prev.text, v054)
    if (f) return { frame: f, text: prev.text, at: prev.at }
    cursor = prev.at
  }
  return undefined
}

/** legal@0.5.3: the opinion's own quotation marks around the quoted words, in their paragraph, or undefined. */
function innerQuotation053(read: string, span: { start: number; end: number }): { open: number; close: number } | undefined {
  const pStart = paragraphStart053(read, span.start), pEnd = paragraphEnd053(read, Math.max(span.start, span.end - 1))
  let open = -1
  for (let i = span.start - 1; i >= Math.max(pStart, span.start - 1500); i--) {
    const c = read[i]
    if (c === '¦') break
    if (c === '“') { open = i; break }
    if (c === '”') return undefined
    if (c === '"') {
      if (i === 0 || /[\s([—–-]/.test(read[i - 1] as string)) { open = i; break }
      return undefined
    }
  }
  if (open < 0) return undefined
  for (let i = span.end; i < Math.min(pEnd, span.end + 1500); i++) {
    const c = read[i]
    if (c === '¦' || c === '“') return undefined
    if (c === '”') return { open, close: i }
    if (c === '"') return i + 1 >= read.length || /[\s.,;:!?)\]—–-]/.test(read[i + 1] as string) ? { open, close: i } : undefined
  }
  return undefined
}

/** A case name in a stretch ("Smith v. Jones"), a signal or "In" before it read off. */
const caseNameIn053 = (s: string): string | undefined => /([A-Z][\p{L}.'’&-]*(?:\s+(?:[A-Z][\p{L}.'’&-]*|of|and|the|&)){0,6}\s+v\.\s+[A-Z][\p{L}.'’&-]*(?:\s+(?:[A-Z][\p{L}.'’&-]*|of|and|the|&)){0,6})/u
  .exec(s)?.[1]?.replace(/^(?:(?:In|See|As|Under|Cf\.|Accord|Quoting|Citing|Following|Applying)\s+)+/u, '').replace(/[,.;]+$/u, '')

/** legal@0.5.3: whom a quotation within the opinion is attributed to (above), and the authority a "(quoting …)" would name. */
function attributionOf053(read: string, inner: { open: number; close: number }, frame: LeadFrame | undefined, v054 = false): { name: string; how: string; cite?: string } {
  const before = sentenceHeadBefore(read, inner.open, 600, 'v053')
  // legal@0.5.4: the citation after the closing mark is read to its sentence end, abbreviations kept ("v.", "Co."); legal@0.5.3 cut it at
  // the first period before a space, so "United Steelworkers v. Warrior & Gulf Navigation Co." was never named (a cold review's brief)
  const after = v054 ? sentenceTailAfter(read, inner.close + 1, 300, 'v053') : read.slice(inner.close + 1, inner.close + 300).split(/(?<=[.;])\s/u)[0] ?? ''
  const found = caseNameIn053(after) ?? caseNameIn053(before)
  // legal@0.5.4: a name that ends in an abbreviation keeps its period ("Navigation Co.", "Liberty Lobby, Inc.")
  const abbreviated = found !== undefined && v054 && /(?:^|\s)(?:Co|Cos|Inc|Corp|Ltd|Bros|Assn|Ass'n|Dept|Nat'l|Natl|Int'l|Intl|Mfg|Ry|LLC|L\.P|L\.L\.C|No|St)$/u.test(found) && new RegExp(`${found.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`, 'u').test(`${after} ${before}`)
  const cited = abbreviated ? `${found}.` : found
  const speaker = frame?.speaker?.replace(/['’]s?$/u, '').trim()
  if (speaker !== undefined && speaker !== '' && !/^(?:his|her|their|its)$/iu.test(speaker)) return { name: speaker, how: '', cite: cited ?? speaker }
  if (cited !== undefined) return { name: cited, how: '', cite: cited }
  return { name: 'a source the text does not name here', how: '' }
}

const REJECT_STRONG_053 = /(?<![\p{L}])(?:retire(?:d|ment|s)?|best\s+forgotten|overrul(?:e|ed|es|ing)|abrogat(?:e|ed|es|ing)|repudiat(?:e|ed|es|ing)|disapprov(?:e|ed|es|ing)|abandon(?:ed|s|ing)?|discard(?:ed|s|ing)?|disavow(?:ed|s|ing)?|explained\s+away|no\s+longer|decline\s+to\s+follow|was\s+error|erroneous|incomplete,?\s+negative\s+gloss|reject(?:ed|s|ing)?\s+(?:this|that|the|such)\s+(?:standard|test|rule|language|statement|formulation|view|approach|reading|gloss))(?![\p{L}])/iu
const REJECT_LINK_053 = /(?<![\p{L}])(?:this|that|the|such|its|their)\s+(?:(?:famous|familiar|oft-?quoted|now-?familiar|venerable|old|earlier|prior|same)\s+)*(?:statement|observation|language|formulation|phrase|passage|dictum|dicta|standard|test|rule|gloss|reading|view|holding|approach|formula|words|remark|pronouncement)(?![\p{L}])/iu
const wordsOf053 = (s: string): string[] => (s.toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [])
/** legal@0.5.3: whether a sentence rejects the quoted statement (above). */
function rejects053(sentence: string, quote: string, source: string): boolean {
  const m = REJECT_STRONG_053.exec(sentence)
  if (!m) return false
  if (/(?<![\p{L}])(?:not|never|decline\s+to|refuse\s+to|without)\s+(?:\p{L}+\s+){0,2}$/iu.test(sentence.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0))) return false
  if (REJECT_LINK_053.test(sentence)) return true
  if (source !== 'a source the text does not name here' && new RegExp(String.raw`(?<![\p{L}])${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['’]s?)?(?![\p{L}])`, 'u').test(sentence)) return true
  const q = wordsOf053(quote), w = ` ${wordsOf053(sentence).join(' ')} `
  for (let k = 0; k + 3 <= q.length; k++) if (w.includes(` ${q.slice(k, k + 3).join(' ')} `)) return true
  return false
}

/** legal@0.5.3: the sentence after a quotation within the opinion that rejects it (above), or undefined. */
function rejectionAfter053(read: string, from: number, quote: string, source: string): { at: number; text: string } | undefined {
  const limit = paragraphEnd053(read, Math.max(0, from - 1))
  let cursor = from
  let seen = 0
  for (let guard = 0; guard < 6 && seen < 2; guard++) {
    const s = nextSentence053(read, cursor, limit)
    if (!s) return undefined
    cursor = s.end
    if (onlyCitation(s.text)) continue
    seen++
    if (viewOpener053(s.text)) return undefined
    if (rejects053(s.text, quote, source)) return { at: s.at, text: s.text }
  }
  return undefined
}

// ── legal@0.5.5: a quotation within the opinion that the court departs from in other words (2026-10-19) ───────────────────────────────
//
// legal@0.5.3's rejection list holds strong words only ("retire", "overrule", "abrogate", "explained away", "no longer", "reject this
// standard"), so "In Benfield, we said that “a spreadsheet compiled for litigation is never a business record.” … We part ways with that
// formulation today." passed, with a notice naming Benfield and nothing of the next sentence (a cold review; an AI agent as a
// legal-operations buyer, not a person). legal@0.5.5 reads one of the next two sentences of the paragraph (a citation sentence aside, and
// none introducing another's view) for the court speaking in its own voice (courtVoice053) with a word of departure ("part ways",
// "disagree", "do not agree", "decline to follow", "depart from", "recede from", "retreat from", "reject", "not the law", "too broad",
// "goes too far", "is mistaken", "limit", "narrow", "clarify", "modify"), not negated, in a sentence that names the statement, its source or
// three of its words in order: can't tell, naming the sentence, never a FAIL (the words may only be narrowed).
const DEPART_055 = /(?<![\p{L}])(?:part(?:s|ed|ing)?\s+ways|disagree(?:s|d)?|do(?:es)?\s+not\s+(?:agree|accept|adopt|follow|share|endorse)|cannot\s+(?:agree|accept|adopt|follow|endorse)|declin(?:e|es|ed)\s+to\s+(?:follow|adopt|apply|extend|accept|endorse)|depart(?:s|ed|ing)?\s+from|reced(?:e|es|ed)\s+from|retreat(?:s|ed)?\s+from|reject(?:s|ed)?|not\s+the\s+law|too\s+broad(?:ly)?|overstat(?:e|es|ed)|go(?:es)?\s+too\s+far|went\s+too\s+far|(?:is|was)\s+(?:wrong|mistaken|incorrect|unpersuasive|untenable|overbroad)|limit(?:s|ed)?|narrow(?:s|ed)?|clarif(?:y|ies|ied)|modif(?:y|ies|ied)|qualif(?:y|ies|ied)|abandon(?:s|ed)?|disavow(?:s|ed)?)(?![\p{L}])/iu
function departureAfter055(read: string, from: number, quote: string, source: string): { at: number; text: string } | undefined {
  const limit = paragraphEnd053(read, Math.max(0, from - 1))
  let cursor = from
  let seen = 0
  for (let guard = 0; guard < 6 && seen < 2; guard++) {
    const s = nextSentence053(read, cursor, limit)
    if (!s) return undefined
    cursor = s.end
    if (onlyCitation(s.text)) continue
    seen++
    if (viewOpener053(s.text, true)) return undefined
    if (!courtVoice053(s.text, true)) continue
    const m = DEPART_055.exec(s.text)
    if (!m) continue
    if (/(?<![\p{L}])(?:not|never|without)\s+(?:\p{L}+\s+){0,2}$/iu.test(s.text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0)) && !/^do(?:es)?\s+not|^cannot/iu.test(m[0])) continue
    const q = wordsOf053(quote), w = ` ${wordsOf053(s.text).join(' ')} `
    const threeWords = (() => { for (let k = 0; k + 3 <= q.length; k++) if (w.includes(` ${q.slice(k, k + 3).join(' ')} `)) return true; return false })()
    const named = source !== 'a source the text does not name here' && new RegExp(String.raw`(?<![\p{L}])${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['’]s?)?(?![\p{L}])`, 'u').test(s.text)
    if (REJECT_LINK_053.test(s.text) || named || threeWords) return { at: s.at, text: s.text }
  }
  return undefined
}

/**
 * legal@0.5.1: the quotation is not in the opinion it is attributed to, as quoted. 0.5.0's order (notFound050), read the 0.5.1 way, with
 * two answers before the FAIL on a passage: a citation sentence left out of the quoted words without saying so, and words joined from
 * passages farther apart than an ellipsis is read for. Each is a FAIL that names what happened, not a partial match.
 */
function notFound051(r: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string, prepared: LegalPreparedSource, L: QuotationLimits, x: Context050, d: Disclosed051): ClaimVerdict {
  const at = suppliedFor(label)
  const view = prepared.raw
  const v053 = x.v053 === true
  const ends = v053 ? 'v053' as const : true
  // 1. an unread footnote call or page mark inside the quoted words
  const wide = legalPreparedFor(view, 'wide', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared
  const lr = readQuotation(wide, quote, L)
  if (lr.kind === 'match') {
    const safe = new Set((prepared.marks ?? []).map(m => `${m.start}:${m.end}`))
    const extra = (wide.marks ?? []).filter(m => m.start >= lr.span.start && m.end <= lr.span.end && !safe.has(`${m.start}:${m.end}`)).map(m => `"${markShown(x.full, m)}"`)
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [spanEvidence(sourceHash, lr.span, x.full.slice(lr.span.start, lr.span.end))],
      insufficiency: { reason: 'UNPARSEABLE', detail: `the quotation matches ${at} only when ${extra.length === 1 ? 'a token' : 'tokens'} inside the quoted words ${extra.length === 1 ? 'is' : 'are'} read out (${extra.join(', ') || 'a possible page mark'}), which may be a page marker or a footnote call. The engine reads out on its own only star paging, a headnote number between sentences and a footnote numeral glued to sentence punctuation, so it cannot tell whether the quotation is accurate; it does not call it a misquotation. A quotation that leaves out a footnote call can say so with "(footnote omitted)".` },
      locked: false, explanation: `${label}: the quotation matches the supplied text only with ${extra.join(', ') || 'a possible page mark'} read out, which may be a page marker or footnote call; can't tell.` }
  }
  // 2. its words elsewhere in the text: never the opinion's words
  if (x.ts.recognized) {
    const hits = sectionHits051(quote, x, L)
    if (hits.length > 0) return sectionHold050(hits, base, label, sourceHash, x)
  }
  // 3. a citation sentence inside the quoted words, left out without an ellipsis or "(citation omitted)" (legal@0.5.3: or a citation
  // clause, read out with the comma before it or with both)
  for (const commas of (v053 ? ['before', 'both'] as const : ['before'] as const)) {
    if (d.citations !== undefined) break
    const cp = legalPreparedFor(view, 'safe', true, true, x.v052 === true, v053, commas, x.v055 === true).prepared
    const cr = readQuotation(cp, quote, L)
    if (cr.kind === 'match') {
      const cites = (cp.marks ?? []).filter(m => m.kind === 'citation' && m.start >= cr.span.start && m.end <= cr.span.end)
      if (cites.length > 0) {
        const omitted = cites.map(m => `"${clipShort(x.full.slice(m.start, m.end).replace(/^[,;]\s*/u, '').replace(/,$/u, ''))}"`).join(' and ')
        // legal@0.5.3: the passage is read on the text without the citations read out, so one before it never hides a sentence end
        const whole = sentenceSpanOf(v053 ? (prepared.blank ?? view) : (cp.blank ?? view), cr.span, ends)
        const says = shownText(x.full.slice(whole.start, whole.end).replace(/¦/g, ' '))
        const differs = `the quotation leaves out the citation ${omitted}`
        return { ...base, outcome: 'FAIL', locked: true,
          computation: { formula: 'brief_quote = opinion[passage], an omission marked', operands: { brief_quote: quote, opinion_says: says, omitted, differs }, result: says },
          evidence: [spanEvidence(sourceHash, cr.span, x.full.slice(cr.span.start, cr.span.end))],
          explanation: `The quotation is not found as quoted in ${at}: it leaves out the citation ${omitted} without an ellipsis or "(citation omitted)". The passage there reads: "${says}"` }
      }
    }
  }
  // 4. words joined from passages farther apart than an ellipsis is read for
  const sr = readQuotation(prepared, quote, { ...L, ellipsisChars: 50_000 })
  if (sr.kind === 'match') {
    const longest = sr.omissions.reduce((a, o) => (o.length > a.length ? o : a), '')
    if (longest.length > L.ellipsisChars) {
      const blank = prepared.blank ?? view
      const from = sr.span.start, to = sr.span.end
      const gapAt = view.indexOf(longest, from)
      const firstEnd = gapAt >= 0 ? gapAt : from
      const secondStart = gapAt >= 0 ? gapAt + longest.length : to
      const one = sentenceSpanOf(blank, { start: from, end: Math.max(from + 1, firstEnd) }, ends)
      const two = sentenceSpanOf(blank, { start: Math.min(secondStart, to - 1), end: to }, ends)
      const a = shownText(blank.slice(one.start, one.end).replace(/¦/g, ' ')), b = shownText(blank.slice(two.start, two.end).replace(/¦/g, ' '))
      const differs = `its ellipsis would stand for ${longest.length} characters of the text, from line ${lineAt(x.full, firstEnd)} to line ${lineAt(x.full, secondStart)}`
      return { ...base, outcome: 'FAIL', locked: true,
        computation: { formula: 'brief_quote = opinion[passage], each ellipsis at most the declared limit', operands: { brief_quote: quote, opinion_says: `${a} … ${b}`, apart: longest.length, limit: L.ellipsisChars, differs }, result: `${a} … ${b}` },
        evidence: [{ ...spanEvidence(sourceHash, sr.span, x.full.slice(sr.span.start, sr.span.end)), role: 'CONTEXT' }],
        explanation: `The quotation is not found as quoted in ${at}: ${differs}, more than the ${L.ellipsisChars} an ellipsis is read for, so it joins two passages. The first reads: "${clipWords(a)}" The second reads: "${clipWords(b)}"` }
    }
  }
  // 5. a passage of the opinion (FAIL), the nearest passage elsewhere, or not found
  if (r.kind === 'passage' || !x.ts.recognized) return passage051(r, quote, base, label, sourceHash, prepared, x.full, x.v052 === true, v053, x.v055 === true)
  const fr = readQuotation(legalPreparedFor(x.full, 'safe', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared, quote, L)
  if (fr.kind === 'passage') {
    const s = sectionAt(x.ts, (fr.core ?? fr.span).start)
    if (!x.target.includes(s)) return sectionHold050([{ s, span: fr.core ?? fr.span, how: 'nearest' }], base, label, sourceHash, x)
  }
  return passage051(r, quote, base, label, sourceHash, prepared, x.full, x.v052 === true, v053, x.v055 === true)
}

/** legal@0.5.1: the sections other than the opinion read whose words hold the quotation, read the 0.5.1 way (sectionHits050). */
function sectionHits051(quote: string, x: Context050, L: QuotationLimits): Hit050[] {
  const others = x.ts.sections.filter(s => !x.target.includes(s))
  if (others.length === 0) return []
  const v053 = x.v053 === true
  const anywhere = readQuotation(legalPreparedFor(x.full, 'safe', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared, quote, L).kind === 'match' || readQuotation(legalPreparedFor(x.full, 'wide', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared, quote, L).kind === 'match'
  if (!anywhere) return []
  const hits: Hit050[] = []
  for (const s of others) {
    const view = separatedView(x.full, [s])
    const safe = legalPreparedFor(view, 'safe', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared
    const r = readQuotation(safe, quote, L)
    if (r.kind === 'match') { hits.push({ s, span: r.span, how: 'found' }); continue }
    const wide = legalPreparedFor(view, 'wide', true, false, x.v052 === true, v053, 'before', x.v055 === true).prepared
    const w = readQuotation(wide, quote, L)
    if (w.kind === 'match') {
      const known = new Set((safe.marks ?? []).map(m => `${m.start}:${m.end}`))
      const tokens = (wide.marks ?? []).filter(m => m.start >= w.span.start && m.end <= w.span.end && !known.has(`${m.start}:${m.end}`)).map(m => `"${markShown(x.full, m)}"`)
      hits.push({ s, span: w.span, how: 'read-out', tokens })
    }
  }
  return hits
}

/**
 * legal@0.5.3: words shaped like a citation or a page's running header: every word a number, a capitalized word or abbreviation, "v.",
 * "of", "and", "the", "at", "P", "¶" or "§", with a reporter citation ("550 U.S. 544", "167 L.Ed.2d 929") or a vendor's mark among them.
 */
function furnitureShaped053(words: string): boolean {
  const toks = words.split(/\s+/).filter(Boolean)
  if (toks.length < 2) return false
  if (!toks.every(t => /^(?:\d[\d,\-–.]*|[A-Z][\p{L}\d.'’&]*|v|vs|of|and|the|&|at|n|nn|id|ibid|supp|P|¶|§|©)$/u.test(t))) return false
  const joined = toks.join(' ')
  return /\d{1,5}(?:-\d{1,2})?\s+[A-Z][\p{L}.\d'’]*(?:\s+[A-Z][\p{L}.\d'’]*){0,5}\s+(?:P\s+|¶\s*)?\d{1,7}/u.test(joined) || /Thomson|Reuters|Westlaw|LEXIS|USLW/u.test(joined)
}

/**
 * legal@0.5.1's FAIL on a passage (passage040, read the 0.5.1 way): the passage as whole sentences, a sentence ending after a number; the
 * words that differ as the text prints them; where only punctuation differs, which; not found worded without "abstaining".
 */
function passage051(r: Extract<QuotationReading, { kind: 'passage' | 'none' }>, quote: string, base: ClaimBase, label: string, sourceHash: string, prepared: LegalPreparedSource, full: string, v052 = false, v053 = false, v055 = false): ClaimVerdict {
  const at = suppliedFor(label)
  if (r.kind === 'none') {
    const run = r.longestRun >= 3 ? ` The longest run of its words found in the text is ${r.longestRun} words, too few to name a passage.` : ''
    return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [],
      insufficiency: { reason: 'SPAN_NOT_FOUND', detail: `the quotation was not found in ${at}; it may be fabricated, or the supplied text may be incomplete. Not confirmed — do not rely on this citation as quoted.${run}` },
      locked: false, explanation: `${label}: the quotation was not found in the supplied opinion text; it may be fabricated. Can't tell: the check does not call it a fabrication.` }
  }
  const blank = prepared.blank ?? prepared.raw
  const span = sentenceSpanOf(blank, r.core ?? r.span, v053 ? 'v053' : true)
  const text = shownText(blank.slice(span.start, span.end).replace(/¦/g, ' '))
  const marks = markNotes(prepared.raw, prepared.marks ?? [], span.start, span.end)
  const read = marks.length ? ` (read with ${marks.join(' and ')})` : ''
  const corresponding = r.strength === 'corresponding'
  const pct = Math.round(r.similarity * 100)
  const q = quote.replace(PARENTHETICALS_040, ' ')
  // the words that differ are read against the stretch the quotation aligns with (its tightest), so a word that repeats earlier in
  // the sentence is not taken for the quotation's start
  const core = r.core !== undefined ? shownText(blank.slice(r.core.start, r.core.end).replace(/¦/g, ' ')) : text
  // legal@0.5.5 (`v055`): a ligature is compared as its letters, so it is never named as a difference
  const diff = wordDifferences(core, q, 4, true, v052, v055)
  // legal@0.5.3: a passage that differs from the quotation only by words the text has there and the quotation does not, each shaped like
  // a citation or a page's running header, is not a misquotation the check can name: can't tell, never "conform the quotation"
  if (v053 && corresponding && diff.length > 0) {
    const all = wordDifferences(text, q, 50, false, false, v055)
    if (all.length > 0 && all.every(dd => dd.quote === '' && furnitureShaped053(dd.text))) {
      const shown = clipWords(all.map(dd => dd.text).join(' … '), 160)
      return { ...base, outcome: 'INSUFFICIENT_DATA', evidence: [{ ...spanEvidence(sourceHash, span, full.slice(span.start, span.end)), role: 'CONTEXT' }],
        insufficiency: { reason: 'UNPARSEABLE', missing: ['page_furniture'], detail: `the quotation matches a passage of ${at} except for words the text has there that are shaped like a citation or a page's running header ("${shown}"), which this check did not read out. It cannot tell whether the quotation is accurate; it does not call it a misquotation. The passage there reads: "${clipWords(text, 400)}"` },
        locked: false, explanation: `${label}: the quotation matches the supplied text except for words shaped like a citation or a page's running header ("${shown}"); can't tell.` }
    }
  }
  const punct = diff.length === 0 ? punctuationDifferences(core, q, 4, v055) : []
  const side = (t: string, n: number | undefined): string => (n !== undefined ? `${n} words, "${t}"` : `"${t}"`)
  const differs = diff.length > 0
    ? diff.map(dd => !dd.quote ? `the quotation leaves out ${side(dd.text, dd.textWords)}` : !dd.text ? `the quotation adds ${side(dd.quote, dd.quoteWords)}` : `the text has ${side(dd.text, dd.textWords)} where the quotation has ${side(dd.quote, dd.quoteWords)}`).join('; ')
    : punct.length > 0 ? punct.join('; ') : 'the same words, written differently'
  const ev: Evidence = { ...spanEvidence(sourceHash, span, full.slice(span.start, span.end)), role: corresponding ? 'QUOTE' : 'CONTEXT' }
  if (marks.length) ev.normalizations = marks
  return { ...base, outcome: 'FAIL', locked: corresponding,
    computation: corresponding
      ? { formula: 'brief_quote = opinion[corresponding passage]', operands: { brief_quote: quote, opinion_says: text, anchor_words: r.anchorWords, similarity: r.similarity, differs }, result: text }
      : { formula: 'brief_quote found in opinion (not found; nearest passage shown)', operands: { brief_quote: quote, nearest_passage: text, anchor_words: r.anchorWords, similarity: r.similarity, differs }, result: text },
    evidence: [ev],
    explanation: corresponding
      ? `${stop(`The quotation is not found as quoted in ${at}${read}`)} Where they differ: ${differs}. The passage there reads: "${text}"`
      : `${stop(`The quotation was not found as quoted in ${at}${read}`)} The nearest passage there, a partial match only (${r.anchorWords} consecutive words; ${pct}% of the quotation's words in order), is: "${text}"` }
}

/**
 * For the preregistered tuning harness only (the second legal blind set, PREREG section 6, sha256 bfaf202a): legal@0.2.0's check of
 * one citation under engine 0.6.0, read with other quotation limits. It issues no verdict and is not exported by the package
 * (src/index.ts): a verdict is only ever made under a named rule whose limits are fixed and declared.
 */
export function checkCitationUnderLimits(c: Citation, sources: OpinionSources, limits: QuotationLimits): ClaimVerdict {
  return check060(c, sources, LEGAL_RULESET_V020, limits).claim
}

/**
 * Engine 0.6.0: the binding of each supplied text as a choice-ledger entry (Verdict.choices), never unstated. A text the caller
 * supplied with `bind` is a stated choice (the span names where it is stated); a text with none is bound strictly, supplied as the
 * rule's default. An entry appears when the binding was stated, or when it decided a citation (the reporter citation not found,
 * every party named): load_bearing says which.
 */
function bindingChoices(sources: OpinionSources, checked: Checked060[], rule: LegalRuleset): ChoiceEntry[] {
  const out: ChoiceEntry[] = []
  // each text's namings, in citation order, grouped by key once (2026-10-20: it was a pass over every citation for every key)
  const namingsOf = new Map<string, CiteNaming[]>()
  for (const x of checked) {
    if (x.key === undefined || x.naming === undefined) continue
    const list = namingsOf.get(x.key)
    if (list === undefined) namingsOf.set(x.key, [x.naming])
    else list.push(x.naming)
  }
  for (const key of Object.keys(sources).sort()) {
    const namings = namingsOf.get(key) ?? []
    if (namings.length === 0) continue
    const bind = bindModeOf(sources[key])
    const decided = namings.some(n => n.cite !== undefined && !n.cite.found && (n.parties ?? []).length > 0 && (n.parties ?? []).every(p => p.found !== null))
    if (!bind.stated && !decided) continue
    out.push({
      id: `binding:${key}`, kind: 'selection', status: bind.stated ? 'stated' : 'supplied', value: bind.mode,
      source: bind.stated ? { span: { section: `sources[${JSON.stringify(key)}].bind`, quote: bind.mode } } : { default: 'strict', by: 'ruleset' },
      load_bearing: decided,
      detail: rule === LEGAL_RULESET_V030 || rule === LEGAL_RULESET_V040 || rule === LEGAL_RULESET_V050 || rule === LEGAL_RULESET_V051 || rule === LEGAL_RULESET_V052 || rule === LEGAL_RULESET_V053 || rule === LEGAL_RULESET_V054 || rule === LEGAL_RULESET_V055
        ? bind.mode === 'parties'
          ? `stated by the caller: a citation whose parties are all named in this text's caption is checked even when the caption does not print its reporter citation, and the answer is left open, never certified ("${PARTIES_ONLY_NOTE_V030}")`
          : 'strict binding by the caption: this text is used only for a citation whose reporter citation and parties its caption names (supply it with bind "parties" to check, and leave open, a citation whose parties alone its caption names)'
        : bind.mode === 'parties'
        ? 'stated by the caller: a citation whose parties are all named in this text is checked even when its reporter citation is not found there, labelled "bound by parties only; reporter citation not found in text"'
        : 'strict binding: this text is used only for a citation whose reporter citation and parties it names (supply it with bind "parties" to check, labelled, a citation whose parties alone it names)',
    })
  }
  return out
}

/** Engine 0.6.0, every rule: the remedy for each open claim (an unbound text, an altered bracket, a partial match, else the rule's). */
const remedies060For = (table: RemedyTable) => (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing?.length ?? 0) > 0 ? LEGAL_REMEDIES_060_UNBOUND
    : claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? LEGAL_REMEDIES_060_ALTERED
      : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_060_NEAREST : table[claim.rule_id]

/**
 * legal@0.3.0: a quotation found in a text bound by parties only (an open claim with the passage found as evidence) is answered by
 * the reporter citation in the caption or the attorney of record; a text whose caption does not name the cite by the captioned
 * text; an altered bracket and a partial match as under 0.6.0; every other claim by its rule.
 */
const remedies030For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing?.length ?? 0) > 0
    ? (claim.evidence.some(e => e.locator.kind === 'span') ? LEGAL_REMEDIES_V030_PARTIES_ONLY : LEGAL_REMEDIES_V030_UNBOUND)
    : claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? LEGAL_REMEDIES_060_ALTERED
      : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_060_NEAREST : LEGAL_REMEDIES_V030[claim.rule_id]

/** legal@0.4.0: as 0.3.0, plus a short form (missing "full_cite") answered by the full citation, and its own unbound and FAIL wording. */
const remedies040For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing ?? []).includes('full_cite') ? LEGAL_REMEDIES_V040_SHORT_FORM
    : claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing?.length ?? 0) > 0
      ? (claim.evidence.some(e => e.locator.kind === 'span') ? LEGAL_REMEDIES_V030_PARTIES_ONLY : LEGAL_REMEDIES_V040_UNBOUND)
      : claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? LEGAL_REMEDIES_060_ALTERED
        : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_060_NEAREST : LEGAL_REMEDIES_V040[claim.rule_id]

/**
 * legal@0.5.0: as 0.4.0, plus a quotation whose words are found only outside the opinion it is attributed to (SPAN_NOT_FOUND with the
 * place found as evidence, or a separate opinion the citation names and the text does not mark) answered by the opinion's own words or
 * a parenthetical (LEGAL_REMEDIES_V050_SECTION), and its own unbound wording and REFERENCE_NOT_PROVIDED remedy.
 */
const remedies050For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing ?? []).includes('full_cite') ? LEGAL_REMEDIES_V040_SHORT_FORM
    : claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing?.length ?? 0) > 0
      ? (claim.evidence.some(e => e.locator.kind === 'span') ? LEGAL_REMEDIES_V030_PARTIES_ONLY : LEGAL_REMEDIES_V050_UNBOUND)
      : claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'SPAN_NOT_FOUND' && (claim.evidence.some(e => e.locator.kind === 'span') || (claim.insufficiency.missing ?? []).includes('separate_opinion')) ? LEGAL_REMEDIES_V050_SECTION
        : claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? LEGAL_REMEDIES_060_ALTERED
          : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_060_NEAREST : LEGAL_REMEDIES_V050[claim.rule_id]

/**
 * legal@0.5.1: as 0.5.0, plus its own table (the cut, the possible page mark), a bracket that inserts a word answered by removing it, a
 * citation left out without saying so, and words joined from passages farther apart than an ellipsis is read for.
 */
const remedies051For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing ?? []).includes('full_cite') ? LEGAL_REMEDIES_V040_SHORT_FORM
    : claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (claim.insufficiency.missing?.length ?? 0) > 0
      ? (claim.evidence.some(e => e.locator.kind === 'span') ? LEGAL_REMEDIES_V030_PARTIES_ONLY : LEGAL_REMEDIES_V050_UNBOUND)
      : claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'SPAN_NOT_FOUND' && (claim.evidence.some(e => e.locator.kind === 'span') || (claim.insufficiency.missing ?? []).includes('separate_opinion')) ? LEGAL_REMEDIES_V050_SECTION
        : claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? (claim.computation.operands.replaces === '' ? LEGAL_REMEDIES_V051_INSERTED : LEGAL_REMEDIES_060_ALTERED)
          : claim.outcome === 'FAIL' && claim.computation?.operands.omitted !== undefined ? LEGAL_REMEDIES_V051_OMITTED_CITATION
            : claim.outcome === 'FAIL' && claim.computation?.operands.apart !== undefined ? LEGAL_REMEDIES_V051_STITCHED
              : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_060_NEAREST : LEGAL_REMEDIES_V051[claim.rule_id]

/** legal@0.5.2: as 0.5.1, plus a quotation held by its lead-in (missing "lead_in") answered by quoting it with those words. */
const remedies052For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'SELECTIVE_QUOTE' && (claim.insufficiency.missing ?? []).includes('lead_in') ? LEGAL_REMEDIES_V052_FRAMED
    : remedies051For(claim)

/**
 * legal@0.5.3: as 0.5.2, plus a quotation held because the only words it lacks are shaped like a citation or a running header (missing
 * "page_furniture") answered by the printed page or "(citation omitted)", and a quotation of words the court quotes and rejects (a FAIL
 * with `rejected` among its operands) answered by the standard the court adopts.
 */
const remedies053For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'UNPARSEABLE' && (claim.insufficiency.missing ?? []).includes('page_furniture') ? LEGAL_REMEDIES_V053_FURNITURE
    : claim.outcome === 'FAIL' && claim.computation?.operands.rejected !== undefined ? LEGAL_REMEDIES_V053_REJECTED
      : remedies052For(claim)

/** legal@0.5.4: as 0.5.3, plus a quotation held for an unbracketed change of its first letter's case (missing "letter_case") answered by the bracket. */
const remedies054For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'SELECTIVE_QUOTE' && (claim.insufficiency.missing ?? []).includes('letter_case') ? LEGAL_REMEDIES_V054_CASE
    : remedies053For(claim)

/**
 * legal@0.5.5: as 0.5.4, plus a quotation held for what its ellipsis leaves out (missing "elided_words"), for an inserted word this check
 * does not read (missing "inserted_words"), or for the court's next sentence (missing "next_sentence"), each answered by its own remedy.
 */
const remedies055For = (claim: ClaimVerdict): RuleRemedies | undefined => {
  const missing = claim.outcome === 'INSUFFICIENT_DATA' && claim.insufficiency?.reason === 'SELECTIVE_QUOTE' ? (claim.insufficiency.missing ?? []) : []
  if (missing.includes('elided_words')) return LEGAL_REMEDIES_V055_CUT
  if (missing.includes('inserted_words')) return LEGAL_REMEDIES_V055_INSERTED
  if (missing.includes('next_sentence')) return LEGAL_REMEDIES_V055_DEPARTED
  return remedies054For(claim)
}

/** legal@0.1.0: a FAIL on a nearest passage only takes the nearest-passage remedies; every other claim its rule's. */
const remediesV010For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_V010_NEAREST : LEGAL_REMEDIES_V010[claim.rule_id]
/** legal@0.2.0: an altered quotation takes its own FAIL remedy; a nearest passage 0.1.0's; every other claim its rule's. */
const remediesV020For = (claim: ClaimVerdict): RuleRemedies | undefined =>
  claim.outcome === 'FAIL' && claim.computation?.operands.bracket !== undefined ? LEGAL_REMEDIES_V020_ALTERED
    : claim.outcome === 'FAIL' && claim.computation?.operands.nearest_passage !== undefined ? LEGAL_REMEDIES_V010_NEAREST : LEGAL_REMEDIES_V020[claim.rule_id]

function coverageOf(claims: ClaimVerdict[]): Coverage {
  let pass = 0, fail = 0, ins = 0
  for (const c of claims) c.outcome === 'PASS' ? pass++ : c.outcome === 'FAIL' ? fail++ : ins++
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
}

/** Verify a brief's citations against supplied opinion texts. Returns the standard proof object (ruleset 'legal'). */
export function verifyCitations(citations: Citation[], sources: OpinionSources = {}, options: VerifyCitationsOptions = {}): LegalVerdict {
  const engine_version = engineFor(options.engine)
  const ruleset = resolveLegalRuleset(options.ruleset, engine_version)
  const v010 = ruleset === LEGAL_RULESET_V010
  const v020 = ruleset === LEGAL_RULESET_V020
  // Engine 0.6.0 (cold-review round 2): binding, provenance and the 0.6.0 wording (check060); earlier engines exactly as they read.
  // One index of the brief for the whole call (BriefIndex, 2026-10-20): every citation's short form and lookup read it, not the brief.
  const ix = briefIndex(citations, sources)
  const checked = engineAtLeast(engine_version, '0.6.0') ? citations.map(c => check060(c, sources, ruleset, QUOTATION_LIMITS, citations, ix)) : undefined
  const legacy = sources as Record<string, string>
  const claims = checked ? checked.map(x => x.claim) : citations.map(c => (v020 ? verifyCitationV010(c, legacy, true) : v010 ? verifyCitationV010(c, legacy) : verifyCitationLegacy(c, legacy)))
  const coverage = coverageOf(claims)
  const outcome: Outcome = coverage.claims_fail > 0 ? 'FAIL' : coverage.claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'

  const input_hash = hashOf({ citations, sources })
  // Engine 0.2.0: the id also binds the version's remedy table (protocol/verdict-id.ts verdictIdentity).
  const { verdict_id, remedy_table_hash } = verdictIdentity(input_hash, ruleset, engine_version, legalRemedyTable(ruleset, engine_version))
  const issued_at = (options.now ?? (() => new Date()))().toISOString()

  const verdict: LegalVerdict = {
    schema_version: SCHEMA_VERSION, verdict_id, issued_at, engine_version,
    ruleset: { ...ruleset }, input_hash, ...(remedy_table_hash !== undefined ? { remedy_table_hash } : {}), replayable: true,
    document: { extraction_hash: hashOf(citations), ...(options.producer !== undefined ? { producer: options.producer } : {}), line_items: citations.length },
    references: { contract: false, evidence: 0, history: 0, source: Object.keys(sources).length > 0 },
    outcome, aggregation: 'ANY_FAIL_FAILS', claims, coverage,
    // Engine 0.6.0: every supplied opinion text, sorted by key, with its sha256, its stated origin and what it names per citation.
    // legal@0.5.0 also records the sections it read in each text a citation was checked against (./sections.ts).
    ...(checked ? { opinion_sources: provenanceOf(sources, checked.flatMap(x => (x.key !== undefined && x.naming !== undefined ? [{ key: x.key, naming: x.naming }] : [])), ruleset === LEGAL_RULESET_V050 ? sectionsRecord : ruleset === LEGAL_RULESET_V051 ? sectionsRecord051 : ruleset === LEGAL_RULESET_V052 ? sectionsRecord052 : ruleset === LEGAL_RULESET_V053 ? sectionsRecord053 : ruleset === LEGAL_RULESET_V054 ? sectionsRecord054 : ruleset === LEGAL_RULESET_V055 ? sectionsRecord055 : undefined) } : {}),
  }
  // Engine 0.6.0: how each text was bound, in the choice ledger, whenever the caller stated it or it decided a citation
  const binding = checked ? bindingChoices(sources, checked, ruleset) : []
  if (binding.length > 0) verdict.choices = binding
  // Typed remedies for every non-PASS claim, outside the hashed core (verdict/remedy.ts): the verdict_id above is unchanged.
  if (checked && ruleset === LEGAL_RULESET_V055) return attachScope(attachRemedies(verdict, { declaredFor: remedies055For, declared: (rule) => LEGAL_REMEDIES_V055[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V054) return attachScope(attachRemedies(verdict, { declaredFor: remedies054For, declared: (rule) => LEGAL_REMEDIES_V054[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V053) return attachScope(attachRemedies(verdict, { declaredFor: remedies053For, declared: (rule) => LEGAL_REMEDIES_V053[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V052) return attachScope(attachRemedies(verdict, { declaredFor: remedies052For, declared: (rule) => LEGAL_REMEDIES_V052[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V051) return attachScope(attachRemedies(verdict, { declaredFor: remedies051For, declared: (rule) => LEGAL_REMEDIES_V051[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V050) return attachScope(attachRemedies(verdict, { declaredFor: remedies050For, declared: (rule) => LEGAL_REMEDIES_V050[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V040) return attachScope(attachRemedies(verdict, { declaredFor: remedies040For, declared: (rule) => LEGAL_REMEDIES_V040[rule], document: 'brief' }))
  if (checked && ruleset === LEGAL_RULESET_V030) return attachScope(attachRemedies(verdict, { declaredFor: remedies030For, declared: (rule) => LEGAL_REMEDIES_V030[rule], document: 'brief' }))
  if (checked) {
    const table = v020 ? LEGAL_REMEDIES_V020_060 : v010 ? LEGAL_REMEDIES_V010_060 : LEGAL_REMEDIES_060
    return attachScope(attachRemedies(verdict, { declaredFor: remedies060For(table), declared: (rule) => table[rule], document: 'brief' }))
  }
  if (v020) return attachScope(attachRemedies(verdict, { declaredFor: remediesV020For, declared: (rule) => LEGAL_REMEDIES_V020[rule], document: 'brief' }))
  if (v010) return attachScope(attachRemedies(verdict, { declaredFor: remediesV010For, declared: (rule) => LEGAL_REMEDIES_V010[rule], document: 'brief' }))
  return attachScope(attachRemedies(verdict, { declared: (rule) => LEGAL_REMEDIES[rule], document: 'brief' }))
}

/**
 * Render a filing-ready citation audit from a legal verdict — the signable artifact a filer attaches (pair with
 * `signVerdict` from ../protocol for a tamper-evident, independently-verifiable report). Honest by construction: it
 * states its own scope (verbatim quotation + existence in the supplied text; it does NOT decide whether an authority
 * stands for a proposition) so it cannot be read as more than it is.
 */
export function renderCitationAudit(verdict: Verdict, opts: { title?: string } = {}): string {
  const sym = (o: Outcome): string => (o === 'PASS' ? '✓' : o === 'FAIL' ? '✗' : '⚠')
  const label = (o: Outcome): string => (o === 'PASS' ? 'verified' : o === 'FAIL' ? 'INACCURATE' : 'could not verify')
  const c = verdict.coverage
  // Engine 0.6.0: the audit says what the check is against (the supplied text, bound to the cite) and lists each text's origin.
  const at060 = isRetainedEngine(verdict.engine_version) && engineAtLeast(verdict.engine_version, '0.6.0')
  const scopeLine = at060
    ? `> Deterministic check that each quotation appears verbatim in the opinion text supplied for its cite, and that the text names the cite (its parties and reporter citation). It does NOT check that an authority exists or is good law, and it does NOT decide whether an authority *stands for* a proposition — that semantic question is explicitly abstained (see ⚠ entries)${scopeNote(verdict)}. Verdict \`${verdict.verdict_id}\`, engine ${verdict.engine_version}; replayable and independently verifiable.`
    : `> Deterministic verbatim-quotation + existence check against the supplied opinion text. It does NOT decide whether an authority *stands for* a proposition — that semantic question is explicitly abstained (see ⚠ entries)${scopeNote(verdict)}. Verdict \`${verdict.verdict_id}\`, engine ${verdict.engine_version}; replayable and independently verifiable.`
  const lines: string[] = [
    `# ${opts.title ?? 'Citation audit'}`,
    '',
    scopeLine,
    '',
    `**${verdict.claims.length} citations** — ${c.claims_pass} verified · ${c.claims_fail} inaccurate · ${c.claims_insufficient} could-not-verify. Overall: **${verdict.outcome}**.`,
    '',
  ]
  for (const cl of verdict.claims) lines.push(`- ${sym(cl.outcome)} **${cl.field}** — _${label(cl.outcome)}._ ${cl.explanation}`)
  const prov = (verdict as LegalVerdict).opinion_sources
  if (at060 && prov && prov.length > 0) {
    lines.push('', '**Opinion texts checked against:**', '')
    for (const p of prov) {
      const origin = [p.source, p.url, p.retrieved_at !== undefined ? `retrieved ${p.retrieved_at}` : undefined].filter((s): s is string => s !== undefined)
      lines.push(`- \`${p.key}\` — ${origin.length > 0 ? origin.join(', ') : 'origin not stated'}; sha256 \`${p.sha256}\`; ${p.chars} characters.`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * legal@0.2.0's audit states one more limit (red-team F10): a quotation found in the opinion is not thereby its holding.
 * Earlier versions' audits keep their words.
 */
function scopeNote(v: Verdict): string {
  // legal@0.5.3 also reads a designation with a join clause, the sentences a lead-in's view runs on into, and the opinion's own quotations;
  // legal@0.5.4 reads the same scope (six more designation styles, a party's filing as a speaker); legal@0.5.5 too (nine more styles)
  if (v.ruleset.id === 'legal' && (v.ruleset.version === '0.5.3' || v.ruleset.version === '0.5.4' || v.ruleset.version === '0.5.5')) return '; nor whether the words are the opinion\'s holding (words the text marks as editorial matter or a separate opinion are not passed as the majority\'s; words after a lead-in that reports another\'s position or states a counterfactual, or in the sentences that position runs on into, are not passed; words the opinion quotes from another source are named as such; a part it does not mark is read as the opinion, and a plurality is named as one)'
  // legal@0.5.2 also reads the words before a quotation that begins mid-sentence, and names a plurality
  if (v.ruleset.id === 'legal' && v.ruleset.version === '0.5.2') return '; nor whether the words are the opinion\'s holding (words the text marks as editorial matter or a separate opinion are not passed as the majority\'s; words after a lead-in that reports another\'s position or states a counterfactual are not passed; a part it does not mark is read as the opinion, and a plurality is named as one)'
  // legal@0.5.0 reads the text's sections: a concurrence or dissent, or editorial matter, that the text marks is never passed as the majority's words
  if (v.ruleset.id === 'legal' && (v.ruleset.version === '0.5.0' || v.ruleset.version === '0.5.1')) return '; nor whether the words are the opinion\'s holding or a party\'s argument the opinion reports (words the text marks as editorial matter or a separate opinion are not passed as the majority\'s; a part it does not mark is read as the opinion)'
  return v.ruleset.id === 'legal' && v.ruleset.version !== '0.0.1' && v.ruleset.version !== '0.1.0'
    ? '; nor whether the words are the opinion\'s holding, a concurrence or dissent, or a party\'s argument the opinion reports'
    : ''
}

/**
 * The prepared source and its hash, kept for the last few opinion texts (2026-10-03): many citations to one opinion used
 * to normalise and hash the whole opinion once per citation. Pure: the same text always gives the same preparation.
 */
const PREPARED_KEEP = 8
const preparedCache: { text: string; prepared: PreparedSource; sourceHash: string }[] = []
function preparedFor(text: string): { prepared: PreparedSource; sourceHash: string } {
  const hit = preparedCache.find(x => x.text === text)
  if (hit) return hit
  const made = { text, prepared: prepareSource(text), sourceHash: sha256(text) }
  preparedCache.unshift(made)
  if (preparedCache.length > PREPARED_KEEP) preparedCache.pop()
  return made
}

/** legal@0.1.0's prepared opinion texts, kept the same way (its normalisation differs from 0.0.1's); legal@0.4.0's per page-mark reading. */
const legalPreparedCache: { text: string; mode?: 'safe' | 'loose' | 'wide'; v051: boolean; citations: boolean; v052: boolean; v053: boolean; commas: 'before' | 'both'; v055: boolean; prepared: LegalPreparedSource; sourceHash: string }[] = []
/**
 * `v051` (legal@0.5.1): dashes read as one and headnote numbers read out; `citations`: citation sentences read out too; `v052` (legal@0.5.2):
 * page furniture and Lexis headnote markers read out too; `v053` (legal@0.5.3): a running header read by its shape, and with `citations`
 * the citation clauses inside a sentence, read out with the comma before them or with both commas (`commas`); `v055` (legal@0.5.5): a
 * ligature read as its letters, and with `citations` a rule, code or Restatement citation read out as a citation.
 */
function legalPreparedFor(text: string, mode?: 'safe' | 'loose' | 'wide', v051 = false, citations = false, v052 = false, v053 = false, commas: 'before' | 'both' = 'before', v055 = false): { prepared: LegalPreparedSource; sourceHash: string } {
  const hit = legalPreparedCache.find(x => x.text === text && x.mode === mode && x.v051 === v051 && x.citations === citations && x.v052 === v052 && x.v053 === v053 && x.commas === commas && x.v055 === v055)
  if (hit) return hit
  const opts = mode === undefined ? {} : { pageMarks: mode, ...(v051 ? { v051: true } : {}), ...(v051 && citations ? { citations: true } : {}), ...(v051 && v052 ? { v052: true } : {}), ...(v051 && v052 && v053 ? { v053: true, ...(citations && commas === 'both' ? { citationCommas: 'both' as const } : {}) } : {}), ...(v051 && v052 && v053 && v055 ? { v055: true } : {}) }
  const made = { text, mode, v051, citations, v052, v053, commas, v055, prepared: prepareLegalSource(text, opts), sourceHash: sha256(text) }
  legalPreparedCache.unshift(made)
  if (legalPreparedCache.length > PREPARED_KEEP) legalPreparedCache.pop()
  return made
}
