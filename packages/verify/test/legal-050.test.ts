/**
 * legal@0.5.0 (2026-10-05), the default for a new legal verdict under engine 0.6.0:
 *   - the text's sections are read (src/legal/sections.ts): words found only in editorial matter (a synopsis, headnotes, a case
 *     summary, the syllabus, the header) or in a separate opinion answer can't tell naming where they are, never PASS; where the
 *     majority opinion also has them, the majority match wins; a citation's parenthetical naming a separate opinion is checked
 *     against that opinion; every PASS says where it matched;
 *   - a citation is looked up by its reporter citation with the pin page, case name and parenthetical read off, and a miss says
 *     what was looked for and what was supplied;
 *   - a Lexis header's "Reporter" block binds; every footnote-call form 0.4.0 does not read out ("n7", "FN6", "[4]", superscript
 *     digits) answers can't tell, never FAIL; the claim name says what is checked;
 *   - a replay of an older legal verdict says when today's default reads its inputs differently (rule_now), and
 *     --require-ruleset fails a verdict under an older rule.
 * legal@0.4.0 and every earlier rule answer as before (legal-040.test.ts and the rest, the drift bank).
 *
 * The opinion texts are Westlaw- and Lexis-shaped mock-ups modelled on an outside reviewer's probe: they test the check, not the law.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  verifyCitations, LEGAL_REMEDIES_V050, LEGAL_REMEDIES_V050_SECTION, LEGAL_REMEDIES_V050_UNBOUND, defaultLegalRuleset,
  type Citation, type LegalVerdict, type OpinionSources,
} from '../src/legal/index'
import { sectionsOf, opinionNamedBy, viewOf } from '../src/legal/sections'
import { widePageMarksOf } from '../src/legal/quotation'
import { reporterBlockLines } from '../src/legal/binding'
import { legalRuleNow, renderRuleNow, parseRulesetRequirement, rulesetRequirementProblem } from '../src/legal/replay-notice'
import { runCitations } from '../src/legal/cli-citations'
import { verifyReplay } from '../src/protocol/replay'
import { replayBundle } from '../src/protocol/replay-case'
import { remedyTableProblems } from '../src/verdict/remedy'
import { run } from '../src/cli'
import { scratch as packageScratch, cleanScratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
const R = { now: NOW, ruleset: 'legal@0.5.0' }
const R040 = { now: NOW, ruleset: 'legal@0.4.0' }

/** Westlaw-shaped: header, synopsis, West headnotes, syllabus, the opinion with star paging and footnote calls, a dissent. */
const WESTLAW = [
  'Anderson v. Liberty Lobby, Inc., 477 U.S. 242 (1986)',
  '106 S.Ct. 2505, 91 L.Ed.2d 202',
  'Supreme Court of the United States',
  'Jack ANDERSON, et al., Petitioners,',
  'v.',
  'LIBERTY LOBBY, INC. and Willis A. Carto.',
  'Decided June 25, 1986.',
  'Synopsis',
  'Public figures brought libel action. On certiorari, the Supreme Court held that the determination of whether a given factual dispute requires submission to a jury must be guided by the substantive evidentiary standards that apply to the case.',
  'West Headnotes (12)',
  '[1] Federal Civil Procedure 170A 2465',
  'A dispute about a material fact is genuine for summary judgment purposes only where a reasonable jury could find for the nonmovant on the evidence presented.',
  '**2507 *242 Syllabus',
  'The determination of whether a given factual dispute requires submission to a jury must be guided by the substantive evidentiary standards that apply to the case. Factual disputes that are irrelevant or unnecessary will not be counted.',
  'Opinion',
  '*244 Justice WHITE delivered the opinion of the Court.',
  '*248 As to materiality, the substantive law will identify which facts are material. Only disputes over facts that might affect the outcome of the suit under the **2510 governing law will properly preclude the entry of summary judgment. Factual disputes that are irrelevant or unnecessary will not be counted.4 See generally 10A C. Wright, Federal Practice and Procedure § 2725 (1983).',
  '*251 **2512 The primary difference between the two motions is procedural. FN6 Summary judgment motions are usually made before trial. n7 Directed verdict motions are made at trial. Counsel may renew the motion after the close of evidence.⁸ The renewed motion is decided on the same standard.',
  'Justice BRENNAN, dissenting.',
  '*265 In my view, the Court’s holding is plainly wrong.',
].join('\n')
const AN = { cite: '477 U.S. 242', case_name: 'Anderson v. Liberty Lobby, Inc.' }
const an = (id: string, quote: string, extra: Partial<Citation> = {}): Citation => ({ id, ...AN, quote, ...extra })
const WL: OpinionSources = { '477 U.S. 242': { text: WESTLAW, source: 'Westlaw-shaped mock' } }

/** Lexis-shaped: the citation line five lines below the case name, after a "Reporter" heading; a Lexis headnote; the opinion. */
const LEXIS = [
  'Celotex Corp. v. Catrett',
  'Supreme Court of the United States',
  'April 1, 1986, Argued ; June 25, 1986, Decided',
  'No. 85-198',
  'Reporter',
  '477 U.S. 317 *; 106 S. Ct. 2548 **; 91 L. Ed. 2d 265 ***',
  'Disposition: 244 U.S. App. D.C. 160, 756 F.2d 181, reversed and remanded.',
  'Core Terms',
  'summary judgment, moving party, nonmoving party',
  'LexisNexis® Headnotes',
  'HN1 A party seeking summary judgment always bears the initial responsibility of informing the court of the basis for its motion.',
  'Opinion',
  '[*319] JUSTICE REHNQUIST delivered the opinion of the Court.',
  '[*322] In our view, the plain language of Rule 56(c) mandates the entry of summary judgment, after adequate time for discovery and [**2552] upon motion, against a party who fails to make a showing sufficient to establish the existence of an element essential to that party’s case.',
].join('\n')
const CE = { cite: '477 U.S. 317', case_name: 'Celotex Corp. v. Catrett' }
const LX: OpinionSources = { '477 U.S. 317': { text: LEXIS, source: 'Lexis-shaped mock, as delivered' } }

const one = (c: Citation, sources: OpinionSources, opts: Record<string, unknown> = R): LegalVerdict => verifyCitations([c], sources, opts)
const claim = (c: Citation, sources: OpinionSources, opts: Record<string, unknown> = R) => one(c, sources, opts).claims[0]!

describe('legal@0.5.0 was the default until legal@0.5.1, then legal@0.5.2 (both 2026-10-06), then legal@0.5.3 (2026-10-13), and names what it checks', () => {
  it('a new verdict under this build is legal@0.5.3 and under engine 0.6.0 legal@0.5.2 (0.5.0 is still issued when named); earlier engines keep 0.0.1; the claim name says what is checked', () => {
    // 2026-10-14: legal@0.5.4 becomes this build's default with the engine that ships it (src/legal/index.ts V054_DEFAULT_ENGINE); 0.5.3 until then
    expect(['0.5.3', '0.5.4']).toContain(defaultLegalRuleset().version)
    expect(defaultLegalRuleset('0.6.0').version).toBe('0.5.2')
    expect(defaultLegalRuleset('0.5.0').version).toBe('0.0.1')
    const v = verifyCitations([an('a', 'the substantive law will identify which facts are material')], WL, { now: NOW, ruleset: 'legal@0.5.0' })
    expect(v.ruleset.version).toBe('0.5.0')
    expect(v.claims[0]!.rule_name).toBe('Quotation found as quoted in the supplied text')
    expect(claim(an('a', 'the substantive law will identify which facts are material'), WL, R040).rule_name).toBe('Citation quoted accurately')
    expect(() => verifyCitations([an('a', 'x')], WL, { now: NOW, engine: '0.5.0', ruleset: 'legal@0.5.0' })).toThrow(/legal@0\.5\.0 needs engine 0\.6\.0 or later/)
  })
})

describe('legal@0.5.0 reads the text\'s sections: whose words', () => {
  it('reads the header, the synopsis, the West headnotes, the syllabus, the majority opinion and a dissent', () => {
    const ts = sectionsOf(WESTLAW)
    expect(ts.recognized).toBe(true)
    expect(ts.sections.map(s => `${s.kind}:${s.name}:${s.line}-${s.last_line}`)).toEqual([
      'header:the header above the opinion:1-7', 'editorial:the synopsis:8-9', 'editorial:the West headnotes:10-12',
      'editorial:the syllabus:13-14', 'majority:the majority opinion:15-18', "separate:Justice Brennan's dissent:19-20",
    ])
  })
  it('a West headnote quoted as the opinion answers can\'t tell naming it, never PASS (0.4.0 passed it "verbatim")', () => {
    const q = an('hn', 'A dispute about a material fact is genuine for summary judgment purposes only where a reasonable jury could find for the nonmovant on the evidence presented')
    expect(claim(q, WL, R040).outcome).toBe('PASS')
    const v = one(q, WL)
    const c = v.claims[0]!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SPAN_NOT_FOUND')
    expect(c.explanation).toBe('Anderson v. Liberty Lobby, Inc.: the quoted words appear in the West headnotes (line 12), not in the opinion; not certified.')
    expect(c.insufficiency?.detail).toMatch(/^whose words: the quoted words appear in the West headnotes of the opinion text supplied for Anderson v\. Liberty Lobby, Inc\. \(line 12\), not in the opinion\. A synopsis, headnotes/)
    expect(c.evidence[0]).toMatchObject({ role: 'CONTEXT', locator: { kind: 'span' } })
    expect(c.locked).toBe(false)
    expect(v.remedies?.map(r => r.detail)).toEqual((LEGAL_REMEDIES_V050_SECTION.abstain ?? []).map(s => s.detail))
  })
  it('words in the synopsis and the syllabus are named in both; a quotation the majority opinion also has PASSes there', () => {
    const syl = claim(an('syl', 'The determination of whether a given factual dispute requires submission to a jury must be guided by the substantive evidentiary standards that apply to the case.'), WL)
    expect(syl.outcome).toBe('INSUFFICIENT_DATA')
    expect(syl.explanation).toMatch(/the quoted words appear in the synopsis and the syllabus \(line 9\), not in the opinion/)
    const both = claim(an('both', 'Factual disputes that are irrelevant or unnecessary will not be counted.'), WL)
    expect(both.outcome).toBe('PASS')
    expect(both.explanation).toMatch(/Found in the majority opinion, line 17 \(character offset \d+\)\.$/)
    const loc = both.evidence[0]!.locator
    expect(loc.kind === 'span' && WESTLAW.slice(0, loc.start).split('\n').length).toBe(17)
  })
  it('a dissent quoted as the opinion answers can\'t tell naming it; with the parenthetical that names it, it PASSes there', () => {
    const plain = claim(an('w9', 'the Court’s holding is plainly wrong.'), WL)
    expect(plain.outcome).toBe('INSUFFICIENT_DATA')
    expect(plain.explanation).toBe("Anderson v. Liberty Lobby, Inc.: the quoted words appear in Justice Brennan's dissent (line 20), not in the majority opinion; not certified.")
    const named = claim(an('w9p', 'the Court’s holding is plainly wrong.', { cite: '477 U.S. 242, 265 (Brennan, J., dissenting)' }), WL)
    expect(named.outcome).toBe('PASS')
    expect(named.explanation).toMatch(/Found in Justice Brennan's dissent, as the citation says, line 20 \(character offset \d+\)\. The pin page 265 is not checked\.$/)
    // the parenthetical names a dissent the text does not mark
    const other = one(an('w9x', 'the Court’s holding is plainly wrong.', { cite: '477 U.S. 242, 270 (Marshall, J., dissenting)' }), WL)
    expect(other.claims[0]!.outcome).toBe('INSUFFICIENT_DATA')
    expect(other.claims[0]!.insufficiency).toMatchObject({ reason: 'SPAN_NOT_FOUND', missing: ['separate_opinion'] })
    expect(other.claims[0]!.explanation).toMatch(/the citation names Marshall's dissent, which the supplied text does not mark/)
    expect(other.remedies?.[0]?.detail).toMatch(/^Quote the words of the majority opinion/)
    // the majority's words attributed to the dissent
    const majAsDissent = claim(an('mx', 'the substantive law will identify which facts are material', { cite: '477 U.S. 242, 265 (Brennan, J., dissenting)' }), WL)
    expect(majAsDissent.outcome).toBe('INSUFFICIENT_DATA')
    expect(majAsDissent.explanation).toMatch(/appear in the majority opinion \(line 17\), not in Justice Brennan's dissent, which the citation names/)
  })
  it('a text with no section heading is read whole, as 0.4.0 reads it, and a PASS says the line and offset', () => {
    const text = 'Makarova v. United States\n201 F.3d 110 (2d Cir. 2000)\nThe FTCA waives the government’s sovereign immunity only for certain claims.'
    const c = claim({ id: 'm', cite: '201 F.3d 110', case_name: 'Makarova v. United States', quote: 'The FTCA waives the government’s sovereign immunity' }, { '201 F.3d 110': text })
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/Found at line 3 of the supplied text \(character offset 54\)\.$/)
    expect(sectionsOf(text).recognized).toBe(false)
  })
  it('the verdict records the sections it read in each text (opinion_sources)', () => {
    const v = one(an('a', 'the substantive law will identify which facts are material'), WL)
    expect(v.opinion_sources?.[0]?.sections?.map(s => s.name)).toEqual(['the header above the opinion', 'the synopsis', 'the West headnotes', 'the syllabus', 'the majority opinion', "Justice Brennan's dissent"])
    expect(one(an('a', 'the substantive law will identify which facts are material'), WL, R040).opinion_sources?.[0]?.sections).toBeUndefined()
  })
})

describe('the section reader on public-archive and slip-opinion layouts', () => {
  it('a two- or three-line designation starts a separate opinion: "Mr. Justice Stewart, / with whom … join, / dissenting."', () => {
    const t = ['X v. Y', '1 U.S. 1', 'Mr. Justice Field', 'delivered the opinion of the court.', 'The judgment is affirmed.', '', 'Mr. Justice Stewart,', 'with whom Mr. Justice Brennan and Mr. Justice Marshall join, dissenting.', 'I would reverse.', 'Mr. Justice Douglas,', 'dissenting in No. 70-57, United States v. Caldwell.', 'Caldwell is a reporter.'].join('\n')
    expect(sectionsOf(t).sections.map(s => `${s.kind}:${s.name}`)).toEqual(['header:the header above the opinion', 'majority:the majority opinion', "separate:Justice Stewart's dissent", "separate:Justice Douglas's dissent"])
  })
  it('a slip opinion\'s running head designates the same dissent again: one section; "J." carries no title', () => {
    const t = ['X v. Y', '1 U.S. 1', 'JUSTICE KENNEDY delivered the opinion of the Court.', 'We reverse.', 'SOUTER, J., dissenting', 'JUSTICE SOUTER, with whom JUSTICE STEVENS joins, dissenting.', 'I would affirm.', 'SOUTER, J., dissenting', 'More of the dissent.', 'STEVENS, J., dissenting', 'A short dissent.'].join('\n')
    expect(sectionsOf(t).sections.map(s => `${s.kind}:${s.name}:${s.line}`)).toEqual(['header:the header above the opinion:1', 'majority:the majority opinion:3', "separate:Justice Souter's dissent:5", "separate:Stevens's dissent:10"])
  })
  it('never a heading: a hard-wrapped body line ("disposition."), a bare "Disposition" section of the majority, a sentence that says who delivered an opinion', () => {
    const t = ['X v. Y', '1 U.S. 1', 'Mr. Justice Field delivered the opinion of the court.', 'The request was for a final', 'disposition.', 'Disposition', 'We reverse the judgment.', 'Mr. Justice Black, dissenting.', 'As Justice Holmes, who delivered the opinion of the Court in that case, wrote, the test is plain.'].join('\n')
    expect(sectionsOf(t).sections.map(s => `${s.kind}:${s.line}-${s.last_line}`)).toEqual(['header:1-2', 'majority:3-7', 'separate:8-9'])
  })
  it('a Lexis "Judges:" line that says who delivered the opinion is the judges listing; an "OPINION ____" heading starts the opinion', () => {
    const t = ['X v. Y', '1 U.S. 1', 'Judges: REHNQUIST, J., delivered the opinion of the Court, in which WHITE, J., joined.', 'COUNSEL', 'Robert Smith argued the cause.', 'OPINION _________________', 'The judgment is affirmed.'].join('\n')
    expect(sectionsOf(t).sections.map(s => `${s.kind}:${s.name}`)).toEqual(['header:the header above the opinion', 'editorial:the judges listing', 'editorial:the counsel listing', 'majority:the majority opinion'])
  })
  it('a view blanks every other section and keeps the offsets; a parenthetical names its opinion', () => {
    const ts = sectionsOf(WESTLAW)
    const v = viewOf(WESTLAW, ts.sections.filter(s => s.kind === 'majority'))
    expect(v.length).toBe(WESTLAW.length)
    expect(v.split('\n').length).toBe(WESTLAW.split('\n').length)
    expect(v).not.toContain('West Headnotes')
    expect(v).toContain('Justice WHITE delivered')
    expect(opinionNamedBy('477 U.S. 242, 265 (Brennan, J., dissenting)')).toEqual({ author: 'Brennan', role: 'dissent' })
    expect(opinionNamedBy('Anderson, 477 U.S. at 270 (Rehnquist, C.J., concurring in part and dissenting in part)')).toEqual({ author: 'Rehnquist', role: 'concurrence-dissent' })
    expect(opinionNamedBy('477 U.S. 242 (1986)')).toBeUndefined()
  })
})

describe('legal@0.5.0: every unread footnote-call form answers can\'t tell, never FAIL', () => {
  it('"n7" (0.4.0 FAILed it), "FN6" and a superscript numeral each answer can\'t tell naming the token', () => {
    const n7 = an('n7', 'Summary judgment motions are usually made before trial. Directed verdict motions are made at trial.')
    expect(claim(n7, WL, R040).outcome).toBe('FAIL')
    const c = claim(n7, WL)
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(c.explanation).toBe('Anderson v. Liberty Lobby, Inc.: the quotation matches the supplied text only with "n7" read out, which may be a page marker or footnote call; can\'t tell.')
    expect(claim(an('fn6', 'The primary difference between the two motions is procedural. Summary judgment motions are usually made before trial.'), WL).explanation).toMatch(/only with "FN6" read out/)
    expect(claim(an('sup', 'Counsel may renew the motion after the close of evidence. The renewed motion is decided on the same standard.'), WL).explanation).toMatch(/only with "evidence\.⁸" read out/)
  })
  it('the wide reading finds the standalone, bracketed and superscript forms', () => {
    const s = 'trial. n7 Directed [n8] and FN9 then counted.⁴ end'
    expect(widePageMarksOf(s).map(m => s.slice(m.start, m.end))).toEqual(['n7', '[n8]', 'FN9', '⁴'])
  })
  it('a misquotation across a page mark still FAILs, naming the words that differ', () => {
    const c = claim(an('bad', 'The primary difference between the two motions is substantive.'), WL)
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/Where they differ: the text has "procedural" where the quotation has "substantive"/)
  })
})

describe('legal@0.5.0: a full citation finds its text', () => {
  const q = 'Factual disputes that are irrelevant or unnecessary will not be counted.'
  it('"477 U.S. 242, 248", the Bluebook form and a wrong pin page find the text keyed "477 U.S. 242"; the pin page is said not to be checked', () => {
    for (const cite of ['477 U.S. 242, 248', 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)', '477 U.S. 242, 299']) {
      const v = one({ id: 'p', cite, case_name: AN.case_name, quote: q }, WL)
      expect(v.claims[0]!.outcome, cite).toBe('PASS')
      expect(v.claims[0]!.explanation, cite).toMatch(/The pin page (248|299) is not checked\.$/)
      expect(v.opinion_sources?.[0]?.names[0]?.read_as, cite).toMatchObject({ reads: '477 U.S. 242', key: '477 U.S. 242' })
    }
    // the Bluebook form with no case_name: the case name is read off the citation
    const noName = one({ id: 'p', cite: 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)', quote: q }, WL)
    expect(noName.claims[0]!.outcome).toBe('PASS')
    // legal@0.4.0 keeps its answer
    expect(claim({ id: 'p', cite: 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)', case_name: AN.case_name, quote: q }, WL, R040).explanation).toBe('No opinion text for Anderson v. Liberty Lobby, Inc.; cannot verify.')
  })
  it('a parallel citation no key names says what was looked for and what was supplied; keyed in the sources, it is checked', () => {
    const miss = claim({ id: 's', cite: '106 S. Ct. 2505', case_name: AN.case_name, quote: q }, WL)
    expect(miss.outcome).toBe('INSUFFICIENT_DATA')
    expect(miss.explanation).toBe('Anderson v. Liberty Lobby, Inc.: no supplied text matched the cite as written (looked for: cite "106 S. Ct. 2505"; case name "Anderson v. Liberty Lobby, Inc."; id "s"; texts supplied: 477 U.S. 242); the quotation was not checked.')
    const keyed = claim({ id: 's', cite: '106 S. Ct. 2505, 2510', case_name: AN.case_name, quote: q }, { ...WL, '106 S.Ct. 2505': { text: WESTLAW } })
    expect(keyed.outcome).toBe('PASS')
  })
  it('a citation printed with a parallel volume ("5 U.S. (1 Cranch) 137") binds as the caption prints it', () => {
    const text = 'MARBURY v. MADISON.\n5 U.S. (1 Cranch) 137 (1803)\nMr. Chief Justice MARSHALL delivered the opinion of the Court.\nIt is emphatically the province and duty of the judicial department to say what the law is.'
    const c = claim({ id: 'm', cite: '5 U.S. (1 Cranch) 137', case_name: 'Marbury v. Madison', quote: 'It is emphatically the province and duty of the judicial department to say what the law is.' }, { '5 U.S. (1 Cranch) 137': text })
    expect(c.outcome).toBe('PASS')
  })
  it('a short form points to a full citation written in Bluebook form', () => {
    const v = verifyCitations([
      { id: 'full', cite: 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)', quote: q },
      { id: 'short', cite: '477 U.S. at 249', case_name: 'Anderson', quote: 'the substantive law will identify which facts are material' },
    ], WL, R)
    expect(v.claims.map(c => c.outcome)).toEqual(['PASS', 'PASS'])
    expect(v.claims[1]!.explanation).toMatch(/Short form 477 U\.S\. at 249 read as a pin cite to Anderson v\. Liberty Lobby, Inc\., 477 U\.S\. 242, 248 \(1986\)/)
  })
})

describe('legal@0.5.0: a Lexis "Reporter" block binds the text as delivered', () => {
  it('the eight-line Lexis header binds without an edit; legal@0.4.0 still names the line outside its window', () => {
    expect(reporterBlockLines(LEXIS)).toEqual(['477 U.S. 317 *; 106 S. Ct. 2548 **; 91 L. Ed. 2d 265 ***'])
    const q = { id: 'c01', ...CE, quote: 'In our view, the plain language of Rule 56(c) mandates the entry of summary judgment' }
    const v = one(q, LX)
    expect(v.claims[0]!.outcome).toBe('PASS')
    expect(v.opinion_sources?.[0]?.names[0]).toMatchObject({ bound: true, reporter_block: true })
    const old = one(q, LX, R040)
    expect(old.claims[0]!.explanation).toMatch(/sits 5 lines below the case name in the supplied text, outside the caption window/)
  })
  it('a Lexis headnote quoted as the opinion answers can\'t tell naming it; the decision below named on "Disposition:" binds nothing', () => {
    expect(claim({ id: 'hn1', ...CE, quote: 'A party seeking summary judgment always bears the initial responsibility of informing the court of the basis for its motion.' }, LX).explanation)
      .toBe('Celotex Corp. v. Catrett: the quoted words appear in the LexisNexis headnotes (line 11), not in the opinion; not certified.')
    const below = claim({ id: 'below', cite: '756 F.2d 181', case_name: 'Catrett v. Johns-Manville', quote: 'In our view' }, { '756 F.2d 181': { text: LEXIS } })
    expect(below.outcome).toBe('INSUFFICIENT_DATA')
    expect(below.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
  })
})

describe('legal@0.5.0: the verb\'s report and the remedy tables', () => {
  const folder = (): { dir: string; brief: string } => {
    const dir = packageScratch('legal-050-')
    writeFileSync(join(dir, 'anderson.txt'), WESTLAW)
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ '477 U.S. 242': { file: 'anderson.txt', source: 'Westlaw-shaped mock' } }))
    const brief = join(dir, 'brief.json')
    writeFileSync(brief, JSON.stringify({ citations: [
      { id: 'full', cite: 'Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)', case_name: 'Anderson v. Liberty Lobby, Inc.', quote: 'Factual disputes that are irrelevant or unnecessary will not be counted.' },
      { id: 'hn', ...AN, quote: 'A dispute about a material fact is genuine for summary judgment purposes only where a reasonable jury could find for the nonmovant on the evidence presented' },
    ] }))
    return { dir, brief }
  }
  it('names a full citation once, prints the sections read and how the citation was read; a PASS under 0.4.0 says where it matched', () => {
    const { dir, brief } = folder()
    let err = ''
    expect(runCitations([brief, '--sources', dir, '--ruleset', 'legal@0.5.0'], { out: () => {}, err: s => { err += s }, now: NOW })).toBe(2)
    expect(err).toMatch(/^citations: 2 checked under legal@0\.5\.0 \(engine 0\.7\.2\)/)
    expect(err).toContain('PASS              cite.full  Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)\n')
    expect(err).toContain("    sections read: the header above the opinion (lines 1-7); the synopsis (lines 8-9); the West headnotes (lines 10-12); the syllabus (lines 13-14); the majority opinion (lines 15-18); Justice Brennan's dissent (lines 19-20)")
    expect(err).toContain('; the citation as written, Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986), read as 477 U.S. 242 (pin page 248, not checked)')
    expect(err).toMatch(/INSUFFICIENT_DATA cite\.hn  Anderson v\. Liberty Lobby, Inc\., 477 U\.S\. 242  \[SPAN_NOT_FOUND\]/)
    let old = ''
    runCitations([brief, '--sources', dir, '--ruleset', 'legal@0.4.0'], { out: () => {}, err: s => { old += s }, now: NOW })
    expect(old).toMatch(/PASS              cite\.hn [^\n]*\n[^\n]*\n        found at: line 12 of 477 U\.S\. 242 \(character offset \d+\)\n/)
  })
  it('its remedy tables are well formed; a 0.5.0 verdict and a 0.4.0 verdict of the same inputs both replay byte for byte, with different ids', () => {
    for (const [n, t] of [['0.5.0', LEGAL_REMEDIES_V050], ['section', { CITE_VERBATIM: LEGAL_REMEDIES_V050_SECTION }], ['unbound', { CITE_VERBATIM: LEGAL_REMEDIES_V050_UNBOUND }]] as const) {
      expect(remedyTableProblems(t, `legal ${n}`), n).toEqual([])
    }
    const inputs = { citations: [an('a', 'A dispute about a material fact is genuine for summary judgment purposes only where a reasonable jury could find for the nonmovant on the evidence presented'), an('b', 'Summary judgment motions are usually made before trial. Directed verdict motions are made at trial.'), { id: 'c', cite: '477 U.S. 242, 248', case_name: AN.case_name, quote: 'the substantive law will identify which facts are material' }], sources: WL }
    const v5 = verifyCitations(inputs.citations, inputs.sources, R)
    const v4 = verifyCitations(inputs.citations, inputs.sources, R040)
    expect(v5.claims.map(c => c.outcome)).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'PASS'])
    expect(v4.claims.map(c => c.outcome)).toEqual(['PASS', 'FAIL', 'INSUFFICIENT_DATA']) // 0.4.0's answers stand for its verdicts
    expect(v5.verdict_id).not.toBe(v4.verdict_id)
    for (const v of [v4, v5]) expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
  })
})

describe('replay tells the relying party when the rule version is older (rule_now, --require-ruleset)', () => {
  const MK = 'Makarova v. United States\n201 F.3d 110 (2d Cir. 2000)\nUnless the claimant first presents the claim to the agency, the district court lacks jurisdiction over the action.'
  const inputs = { citations: [{ id: 'after_condition', cite: '201 F.3d 110', case_name: 'Makarova v. United States', quote: 'the district court lacks jurisdiction over the action' }], sources: { '201 F.3d 110': { text: MK } } }
  const v001 = verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.0.1' })
  it('a quotation cut after "Unless …," PASSes under legal@0.0.1; today\'s default reads it as can\'t tell, and the replay says so', () => {
    expect(v001.claims[0]!.outcome).toBe('PASS')
    const r = legalRuleNow(v001, inputs)
    expect(r).toMatchObject({ ruleset: 'legal@0.5.4', engine: '0.7.2', gate: 'INSUFFICIENT_DATA', gate_recorded: 'PASS', claims: [{ claim_id: 'cite.after_condition', was: 'PASS', now: 'INSUFFICIENT_DATA', reason: 'SELECTIVE_QUOTE', why: 'elided condition' }] })
    expect(renderRuleNow(r!, '0.7.2')).toEqual(['under today\'s default legal@0.5.4 this quotation reads can\'t tell: SELECTIVE_QUOTE (elided condition), not PASS'])
    const c = replayBundle({ verdict: v001, inputs }, 'b')
    expect(c.result).toBe('MATCH')
    expect(c.rule_now?.claims[0]?.now).toBe('INSUFFICIENT_DATA')
    // a verdict already under today's default carries no second line
    expect(legalRuleNow(verifyCitations(inputs.citations, inputs.sources, { now: NOW }), inputs)).toBeUndefined()
  })
  it('--require-ruleset reads <id>@>=<version>, says to quote it when a shell has cut it, and applies to its own ruleset id only', () => {
    expect(parseRulesetRequirement('legal@>=0.4.0')).toEqual({ id: 'legal', op: '>=', version: '0.4.0', written: 'legal@>=0.4.0' })
    expect(parseRulesetRequirement('peppol-en16931@0.3.0')).toMatchObject({ op: '=', version: '0.3.0' })
    expect(() => parseRulesetRequirement('legal@')).toThrow(/quote the value/)
    expect(() => parseRulesetRequirement('legal@>=4')).toThrow(/<ruleset>@>=<version>/)
    const req = [parseRulesetRequirement('legal@>=0.4.0')]
    expect(rulesetRequirementProblem(req, v001)).toMatch(/^the verdict was issued under legal@0\.0\.1, older than the legal@0\.4\.0 or later that --require-ruleset legal@>=0\.4\.0 asks for/)
    expect(rulesetRequirementProblem(req, verifyCitations(inputs.citations, inputs.sources, { now: NOW }))).toBeUndefined()
    expect(rulesetRequirementProblem([parseRulesetRequirement('peppol-en16931@>=0.3.0')], v001)).toBeUndefined()
  })
  it('the replay command prints the second line, and fails under --require-ruleset in words (single file and folder)', () => {
    const dir = packageScratch('legal-050-replay-')
    const file = join(dir, 'b.json')
    writeFileSync(file, JSON.stringify({ verdict: v001, inputs }))
    let out = '', err = ''
    const io = { out: (s: string) => { out += s }, err: (s: string) => { err += s } }
    expect(run(['replay', file], io as never)).toBe(0)
    expect(err).toContain("\n  under today's default legal@0.5.4 this quotation reads can't tell: SELECTIVE_QUOTE (elided condition), not PASS\n")
    expect(JSON.parse(out).rule_now.ruleset).toBe('legal@0.5.4')
    out = ''; err = ''
    expect(run(['replay', file, '--require-ruleset', 'legal@>=0.4.0'], io as never)).toBe(1)
    // the failure is its own line, first or after the headline (2026-10-06: the replay leads with it)
    expect(err).toMatch(/(?:^|\n)verify replay: FAILED: the verdict was issued under legal@0\.0\.1, older than the legal@0\.4\.0 or later that --require-ruleset legal@>=0\.4\.0 asks for\. It re-performs under its own rule, but that rule is not one the relying party accepts\.\n/)
    expect(JSON.parse(out).require_ruleset).toMatchObject({ ok: false, required: ['legal@>=0.4.0'] })
    out = ''; err = ''
    expect(run(['replay', dir, '--require-ruleset', 'legal@>=0.4.0'], io as never)).toBe(1)
    expect(err).toMatch(/\n    REQUIRED: the verdict was issued under legal@0\.0\.1/)
    expect(err).toMatch(/verify replay: FAILED: 1 case\(s\) were issued under a rule older than --require-ruleset legal@>=0\.4\.0 asks for/)
    out = ''; err = ''
    expect(run(['replay', dir], io as never)).toBe(0)
    expect(JSON.parse(out).require_ruleset).toBeUndefined()
  })
})
