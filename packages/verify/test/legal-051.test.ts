/**
 * legal@0.5.1 (2026-10-06), the default for a new legal verdict under engine 0.6.0:
 *   - the cut at the end: a quotation that stops before its sentence ends is never called "verbatim"; its PASS prints how the sentence
 *     continues; a continuation that limits or negates the quoted words answers can't tell ("the cut ends before a limitation"), and a
 *     closing ellipsis over one is the same; a fragment presented as a whole sentence is said to be one, with the full sentence;
 *   - the conventions a quotation discloses: em dash, en dash and "--" are one dash; "(citation omitted)", "(citations omitted)" and
 *     "(cleaned up)" excuse a citation sentence inside the quoted words, "(footnote omitted)" a footnote call, "(internal quotation
 *     marks omitted)" the text's inner marks, "(alteration in original)" names the text's own brackets; the PASS says what each excused;
 *   - Westlaw headnote numbers between sentences are read out; a sentence ends after a number, so a named passage does not open on the
 *     citation sentence before it; a FAIL names punctuation that differs, an inserted bracket, a citation left out without saying so,
 *     and words joined from passages too far apart; a footnote-call can't tell never asks for an edited download; a "Dissent by:" line
 *     is named for what it is; no answer says "abstaining".
 * legal@0.5.0 and every earlier rule answer as before (legal-050.test.ts and the rest, the drift bank).
 *
 * The opinion texts are Westlaw- and Lexis-shaped mock-ups of Ashcroft v. Iqbal, 556 U.S. 662 (2009), a public-domain opinion, laid
 * out the way a cold reader's probe laid them out: they test the check's mechanics, not the law.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  verifyCitations, defaultLegalRuleset, LEGAL_REMEDIES_V051, LEGAL_REMEDIES_V051_INSERTED, LEGAL_REMEDIES_V051_OMITTED_CITATION, LEGAL_REMEDIES_V051_STITCHED,
  type Citation, type LegalVerdict, type OpinionSources,
} from '../src/legal/index'
import { citationSentencesOf, headnoteMarksOf, normalizeLegalText, punctuationDifferences, tailLimitOf } from '../src/legal/quotation'
import { sectionsOf } from '../src/legal/sections'
import { legalRuleNow } from '../src/legal/replay-notice'
import { runCitations } from '../src/legal/cli-citations'
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'
import { scratch as packageScratch, cleanScratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const NOW = (): Date => new Date('2026-10-06T00:00:00Z')
const R = { now: NOW, ruleset: 'legal@0.5.1' }
const R050 = { now: NOW, ruleset: 'legal@0.5.0' }

const WESTLAW = [
  'Ashcroft v. Iqbal, 556 U.S. 662 (2009)',
  '129 S.Ct. 1937, 173 L.Ed.2d 868',
  'Supreme Court of the United States',
  'John D. ASHCROFT, Former Attorney General, et al., Petitioners,',
  'v.',
  'Javaid IQBAL et al.',
  'Decided May 18, 2009.',
  'Synopsis',
  'Holdings: a complaint must plead facts showing a plausible claim, and bare legal conclusions are not entitled to the assumption of truth.',
  'Opinion',
  'Justice KENNEDY delivered the opinion of the Court.',
  '*677 [4] Nor does a complaint suffice if it tenders "naked assertion[s]" devoid of "further factual enhancement." Id., at 557, 127 S.Ct. 1955.',
  '[5] [6] To survive a motion to dismiss, a complaint must contain sufficient factual matter, accepted as true, to "state a claim to relief that is plausible on its face." Id., at 570, 127 S.Ct. 1955. A claim has facial plausibility when the plaintiff pleads factual content that allows the court to draw the reasonable inference that the defendant is liable for the misconduct alleged. Id., at 556, 127 S.Ct. 1955. The plausibility standard is not akin to a "probability requirement," but it asks for more than a sheer possibility that a defendant has acted unlawfully.',
  '[7] Two working principles underlie our decision in Twombly. First, the tenet that a court must accept as true all of the allegations contained in a complaint is inapplicable to legal conclusions. Threadbare recitals of the elements of a cause of action, supported by mere conclusory statements, do not suffice. Id., at 555, 127 S.Ct. 1955 (Although for the purposes of a motion to dismiss we must take all of the factual allegations in the complaint as true, we "are not bound to accept as true a legal conclusion couched as a factual allegation" (internal quotation marks omitted)). Rule 8 marks a notable and generous departure from the hypertechnical, code-pleading regime of a prior era, but it does not unlock the doors of discovery for a plaintiff armed with nothing more than conclusions. [9] Second, only a complaint that states a plausible claim for relief survives a motion to dismiss. Id., at 556, 127 S.Ct. 1955. Determining whether a complaint states a plausible claim for relief will, as the Court of Appeals observed, be a context-specific task that requires the reviewing court to draw on its judicial experience and common sense.',
  '*679 [8] In keeping with these principles a court considering a motion to dismiss can choose to begin by identifying pleadings that, because they are no more than conclusions, are not entitled to the assumption of truth. While legal conclusions can provide the framework of a complaint, they must be supported by factual allegations. When there are well-pleaded factual allegations, a court should assume their veracity and then determine whether they plausibly give rise to an entitlement to relief.',
  'An officer is personally liable for all torts which he authorizes or directs or in which he participates, notwithstanding that he acted as an agent of the government.',
  'Justice SOUTER, with whom Justice STEVENS, Justice GINSBURG, and Justice BREYER join, dissenting.',
  'The majority\'s approach to pleading is not consistent with Twombly, and the complaint here is sufficient to state a claim.',
].join('\n')
const WL: OpinionSources = { '556 U.S. 662': { text: WESTLAW, source: 'Westlaw-shaped mock-up of a public-domain opinion' } }

const LEXIS = [
  'Ashcroft v. Iqbal',
  'Supreme Court of the United States',
  'May 18, 2009, Decided',
  'No. 07-1015',
  '',
  'Reporter',
  '556 U.S. 662 *; 129 S. Ct. 1937 **; 173 L. Ed. 2d 868 ***',
  '',
  'Opinion by: KENNEDY',
  '',
  'Opinion',
  '',
  '[*666] Justice Kennedy delivered the opinion of the Court.',
  '',
  'Rule 9 merely excuses a party from pleading discriminatory intent under an elevated pleading standard. n3 It does not give him license to evade the less rigid--though still operative--strictures of Rule 8.',
  '',
  'Footnotes',
  '',
  'n3 The allegations remain conclusory.',
  '',
  'Dissent by: SOUTER; BREYER',
  '',
  'Dissent',
  '',
  'Justice Souter, with whom Justice Stevens, Justice Ginsburg, and Justice Breyer join, dissenting.',
  '',
  'The majority\'s approach to pleading is not consistent with Twombly.',
].join('\n')
const LX: OpinionSources = { '556 U.S. 662': { text: LEXIS, source: 'Lexis-shaped mock-up of a public-domain opinion' } }

/** The Westlaw-shaped text with a line added to the majority opinion (before the dissent). */
const withMajority = (line: string): OpinionSources => ({ '556 U.S. 662': { text: WESTLAW.replace('Justice SOUTER, with whom', `${line}\nJustice SOUTER, with whom`) } })
const IQ = { cite: '556 U.S. 662', case_name: 'Ashcroft v. Iqbal' }
const q = (id: string, quote: string, extra: Partial<Citation> = {}): Citation => ({ id, ...IQ, quote, ...extra })
const one = (c: Citation, sources: OpinionSources = WL, opts: Record<string, unknown> = R): LegalVerdict => verifyCitations([c], sources, opts)
const claim = (c: Citation, sources: OpinionSources = WL, opts: Record<string, unknown> = R) => one(c, sources, opts).claims[0]!

describe('legal@0.5.1 was the default until legal@0.5.2 (both 2026-10-06), and every earlier rule is still issued when named', () => {
  it('a new verdict under engine 0.6.0 is legal@0.5.2 (under this build, legal@0.5.3); 0.5.1 and 0.5.0 are issued when named; earlier engines keep 0.0.1; 0.5.1 needs engine 0.6.0', () => {
    // 2026-10-14: legal@0.5.4 becomes this build's default with the engine that ships it (src/legal/index.ts V054_DEFAULT_ENGINE); 0.5.3 until then
    expect(['0.5.3', '0.5.4']).toContain(defaultLegalRuleset().version)
    expect(defaultLegalRuleset('0.6.0').version).toBe('0.5.2')
    expect(defaultLegalRuleset('0.5.0').version).toBe('0.0.1')
    expect(verifyCitations([q('a', 'x')], WL, { now: NOW }).ruleset).toEqual({ id: 'legal', version: defaultLegalRuleset().version, domain: 'legal' })
    expect(verifyCitations([q('a', 'x')], WL, R).ruleset.version).toBe('0.5.1')
    expect(verifyCitations([q('a', 'x')], WL, R050).ruleset.version).toBe('0.5.0')
    expect(() => verifyCitations([q('a', 'x')], WL, { now: NOW, engine: '0.5.0', ruleset: 'legal@0.5.1' })).toThrow(/legal@0\.5\.1 needs engine 0\.6\.0 or later/)
    expect(claim(q('a', 'Two working principles underlie our decision in Twombly.')).rule_name).toBe('Quotation found as quoted in the supplied text')
  })
})

describe('legal@0.5.1: the cut at the end of a quotation', () => {
  const W08 = 'a court must accept as true all of the allegations contained in a complaint'
  it('a cut whose sentence goes on "is inapplicable to legal conclusions" answers can\'t tell, printing the continuation (0.5.0 passed it "verbatim")', () => {
    expect(claim(q('w08', W08), WL, R050).explanation).toMatch(/appears verbatim/)
    const c = claim(q('w08', W08))
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(c.insufficiency?.detail).toMatch(/^the cut ends before a limitation: the quotation stops before its sentence ends in the opinion text supplied for Ashcroft v\. Iqbal, and the sentence continues "…is inapplicable to legal conclusions\.", which carries the negation "inapplicable"/)
    expect(c.explanation).toBe('Ashcroft v. Iqbal: the cut ends before a limitation — the sentence continues "…is inapplicable to legal conclusions."; not certified.')
  })
  it('the same cut with a closing ellipsis, or dressed as a sentence with a bracketed capital and a period, answers the same way', () => {
    const ell = claim(q('p07', `${W08} ...`))
    expect(ell.insufficiency?.detail).toMatch(/the quotation closes with an ellipsis that leaves out the rest of its sentence/)
    expect(ell.outcome).toBe('INSUFFICIENT_DATA')
    const dressed = claim(q('p07b', '[A] court must accept as true all of the allegations contained in a complaint.'))
    expect([dressed.outcome, dressed.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'SELECTIVE_QUOTE'])
    expect(dressed.explanation).toMatch(/the sentence continues "…is inapplicable to legal conclusions\."/)
  })
  it('a quotation that ends on "but it does", before "not unlock …", and one that stops before ", but …", answer can\'t tell', () => {
    const stub = claim(q('p19', 'Rule 8 marks a notable and generous departure from the hypertechnical, code-pleading regime of a prior era, but it does'))
    expect(stub.insufficiency?.detail).toMatch(/continues "…not unlock the doors of discovery[^"]*", which carries the negation "not"/)
    const but = claim(q('w07', 'Rule 8 marks a notable and generous departure from the hypertechnical, code-pleading regime of a prior era'))
    expect(but.insufficiency?.detail).toMatch(/continues "…, but it does not unlock[^"]*", which carries "but"/)
  })
  it('a neutral continuation PASSes, never "verbatim", and prints how the sentence goes on; a whole sentence is still "verbatim"', () => {
    const c = claim(q('w17', 'The majority\'s approach to pleading is not consistent with Twombly', { cite: 'Ashcroft v. Iqbal, 556 U.S. 662, 687 (2009) (Souter, J., dissenting)' }))
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/^The quotation appears as quoted in the opinion text supplied for Ashcroft v\. Iqbal, the same words in the same letter case, but it stops before its sentence ends; the sentence continues: "…, and the complaint here is sufficient to state a claim\." Found in Justice Souter's dissent, as the citation says/)
    expect(c.explanation).not.toMatch(/verbatim/)
    const ell = claim(q('w30', 'Determining whether a complaint states a plausible claim for relief will ... be a context-specific task'))
    expect(ell.outcome).toBe('PASS')
    expect(ell.explanation).toMatch(/an ellipsis stands for ", as the Court of Appeals observed,", but it stops before its sentence ends; the sentence continues: "…that requires the reviewing court to draw on its judicial experience and common sense\."/)
    // a mid-sentence start after "When …," is still held by the 0.4.0 guard, before the cut at the end is read
    expect(claim(q('when', 'a court should assume their veracity')).insufficiency?.detail).toMatch(/^elided condition: the quotation begins in the middle of its sentence/)
    const whole = claim(q('w26', 'While legal conclusions can provide the framework of a complaint, they must be supported by factual allegations.'))
    expect(whole.explanation).toMatch(/^The quotation appears verbatim in the opinion text supplied for Ashcroft v\. Iqbal: the same words, in the same letter case\. Found in the majority opinion/)
  })
  it('a concession after the quoted words ("notwithstanding …") does not limit them: PASS, with the continuation', () => {
    const c = claim(q('ct01', 'An officer is personally liable for all torts which he authorizes or directs or in which he participates'))
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/the sentence continues: "…, notwithstanding that he acted as an agent of the government\."/)
    expect(tailLimitOf(', notwithstanding that he acted as an agent')).toBeUndefined()
    expect(tailLimitOf(', even if the motion is late')).toBeUndefined()
    expect(tailLimitOf(', unless the court extends it.')).toEqual({ word: 'unless', kind: 'limitation' })
    expect(tailLimitOf(' is inapplicable to legal conclusions.')).toEqual({ word: 'inapplicable', kind: 'negation' })
    expect(tailLimitOf(', and the complaint must be dismissed for lack of jurisdiction.')).toBeUndefined()
  })
  it('a fragment presented as a whole sentence (a capital at its start, a period at its end) says so and prints the full sentence', () => {
    const c = claim(q('dress', '[T]he plausibility standard is not akin to a "probability requirement," but it asks for more than a sheer possibility that a defendant has acted unlawfully.'))
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).not.toMatch(/presents part of a sentence/) // it begins where its sentence begins
    const text = withMajority('That is, it cannot be incidental, tangential, superficial, or subordinate to another reason for harm.')
    const frag = claim(q('ct14', '[I]t cannot be incidental, tangential, superficial, or subordinate to another reason for harm.'), text)
    expect(frag.outcome).toBe('PASS')
    expect(frag.explanation).toMatch(/it presents part of a sentence as a whole one\. The full sentence reads: "That is, it cannot be incidental, tangential, superficial, or subordinate to another reason for harm\."/)
    // a heading above a quotation that begins its own line runs on into the sentence (it ends in a small letter), but is not the sentence's
    const headed = withMajority('I. Framework for Imposing Sanctions under Inherent Authority\nFederal courts possess certain inherent powers to manage their own affairs.')
    expect(claim(q('ct13', 'Federal courts possess certain inherent powers to manage their own affairs.'), headed).explanation).toMatch(/appears verbatim/)
  })
  it('a quotation followed in its sentence only by the citation of what it quotes ends there', () => {
    const text = withMajority('The pleading standard requires "a short and plain statement of the claim showing that the pleader is entitled to relief," Conley v. Gibson, 355 U. S. 41, 47 (1957).')
    const c = claim(q('ct06', 'a short and plain statement of the claim showing that the pleader is entitled to relief'), text)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).not.toMatch(/stops before its sentence ends/)
  })
})

describe('legal@0.5.1: the conventions a quotation discloses', () => {
  const CITED = 'Threadbare recitals of the elements of a cause of action, supported by mere conclusory statements, do not suffice. Rule 8 marks a notable and generous departure from the hypertechnical, code-pleading regime of a prior era, but it does not unlock the doors of discovery for a plaintiff armed with nothing more than conclusions.'
  it('an em dash, an en dash or a spaced dash against Lexis\'s "--" PASSes, saying so (0.5.0 FAILed it)', () => {
    const quote = 'It does not give him license to evade the less rigid—though still operative—strictures of Rule 8.'
    expect(claim(q('l11', quote), LX, R050).outcome).toBe('FAIL')
    const c = claim(q('l11', quote), LX)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/dashes read as one \("—" in the quotation, "--" in the text\)/)
    expect(c.explanation).not.toMatch(/presents part of a sentence/) // the Lexis "n3" before it is a footnote call, not words of its sentence
    for (const dash of ['–', ' — ', ' -- ']) expect(claim(q('l11', quote.replaceAll('—', dash)), LX).outcome, dash).toBe('PASS')
    expect(normalizeLegalText('rigid -- though', { pageMarks: 'safe', v051: true }).text).toBe(normalizeLegalText('rigid—though', { pageMarks: 'safe', v051: true }).text)
    expect(normalizeLegalText('well-known', { pageMarks: 'safe', v051: true }).text).toBe('wellknown') // a hyphen inside a word is not a dash
  })
  it('"(citation omitted)", "(citations omitted)" and "(cleaned up)" let a citation sentence be absent, and the PASS names it (0.5.0 FAILed them)', () => {
    for (const paren of ['(citation omitted)', '(citations omitted)', '(cleaned up)']) {
      expect(claim(q('p16', `${CITED} ${paren}`), WL, R050).outcome, paren).toBe('FAIL')
      const c = claim(q('p16', `${CITED} ${paren}`))
      expect(c.outcome, paren).toBe('PASS')
      expect(c.explanation).toMatch(/the citation "Id\., at 555, 127 S\.Ct\. 1955 \(Although [^"]* … [^"]*omitted\)\)\." left out, as "\(/)
      expect(c.explanation).toContain(`left out, as "${paren}" says`)
      expect(c.explanation).not.toMatch(/letter case not compared/)
    }
    // after the citation, as Bluebook places it, it counts the same
    expect(claim(q('p16', CITED, { cite: 'Ashcroft v. Iqbal, 556 U.S. 662, 678-679 (2009) (cleaned up)' })).outcome).toBe('PASS')
  })
  it('a citation sentence left out with no ellipsis or parenthetical FAILs, naming the citation; its remedy says how to disclose it', () => {
    const v = one(q('p16a', CITED))
    const c = v.claims[0]!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/^The quotation is not found as quoted in the opinion text supplied for Ashcroft v\. Iqbal: it leaves out the citation "Id\., at 555, 127 S\.Ct\. 1955 \(Although[^"]*" without an ellipsis or "\(citation omitted\)"\./)
    expect(v.remedies!.map(r => r.detail).join(' ')).toMatch(/Add "\(citation omitted\)" after the quotation, or mark the omission with an ellipsis/)
  })
  it('"(footnote omitted)" lets a footnote call be absent and names it; without it the call answers can\'t tell, never asking for an edited download', () => {
    const quote = 'Rule 9 merely excuses a party from pleading discriminatory intent under an elevated pleading standard. It does not give him license to evade the less rigid--though still operative--strictures of Rule 8.'
    const open = one(q('l03', quote), LX)
    expect([open.claims[0]!.outcome, open.claims[0]!.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'UNPARSEABLE'])
    const said = open.remedies!.map(r => r.detail).join(' ')
    expect(said).not.toMatch(/clean copy|without the page markers/)
    expect(said).toMatch(/Keep the download as delivered/)
    expect(said).toMatch(/"\(footnote omitted\)"/)
    const c = claim(q('l03', `${quote} (footnote omitted)`), LX)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toContain('the footnote call "n3" left out, as "(footnote omitted)" says')
  })
  it('"(internal quotation marks omitted)" and "(alteration in original)" say what they excuse', () => {
    const marks = claim(q('im', 'To survive a motion to dismiss, a complaint must contain sufficient factual matter, accepted as true, to state a claim to relief that is plausible on its face. (internal quotation marks omitted)'))
    expect(marks.outcome).toBe('PASS')
    expect(marks.explanation).toContain('the text\'s inner quotation marks left out, as "(internal quotation marks omitted)" says')
    const orig = claim(q('ao', 'Nor does a complaint suffice if it tenders "naked assertion[s]" devoid of "further factual enhancement." (alteration in original)'))
    expect(orig.outcome).toBe('PASS')
    expect(orig.explanation).toContain('the brackets are the text\'s own, as "(alteration in original)" says')
  })
  it('"(cleaned up)" does not excuse a dropped word: it still FAILs, naming the word', () => {
    const c = claim(q('p02', 'Threadbare recitals of the elements of a cause of action, supported by conclusory statements, do not suffice. (cleaned up)'))
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/Where they differ: the quotation leaves out "mere"/)
  })
  it('the citation sentences of a text are whole sentences that open a citation and hold one', () => {
    const marks = citationSentencesOf(WESTLAW).map(m => WESTLAW.slice(m.start, m.end))
    expect(marks).toContain('Id., at 557, 127 S.Ct. 1955.')
    expect(marks).toContain('Id., at 556, 127 S.Ct. 1955.')
    expect(marks.some(m => m.startsWith('Id., at 555, 127 S.Ct. 1955 (Although') && m.endsWith('omitted)).'))).toBe(true)
    expect(marks.some(m => /^Two working|^Rule 8|^First,/.test(m))).toBe(false)
  })
})

describe('legal@0.5.1: Westlaw headnote numbers and sentence ends', () => {
  it('a genuine quotation across a headnote number between sentences PASSes, naming it (0.5.0 answered can\'t tell)', () => {
    const quote = 'it does not unlock the doors of discovery for a plaintiff armed with nothing more than conclusions. Second, only a complaint that states a plausible claim for relief survives a motion to dismiss.'
    expect(claim(q('w22', quote), WL, R050).insufficiency?.reason).toBe('UNPARSEABLE')
    const c = claim(q('w22', quote))
    expect(c.explanation).toMatch(/read with a headnote number ignored \(\[9\]\)/)
  })
  it('a headnote number stands alone between sentences; a bracketed number glued to a word\'s punctuation is a footnote call and is not read out', () => {
    const t = 'conclusions. [9] Second, only. [5] [6] To survive. *677 [4] Under. immaterial.[4] [*323] The moving. The statute requires: [1] notice.'
    expect(headnoteMarksOf(t).map(m => t.slice(m.start, m.end))).toEqual(['[9]', '[5]', '[6]', '[4]'])
    expect(headnoteMarksOf(t).some(m => t.slice(m.start - 1, m.start) === '.')).toBe(false)
  })
  it('a named passage opens at its own sentence, never on the citation sentence or the headnote number before it', () => {
    const c = claim(q('w05', 'Second, only a complaint that states a plausable claim for relief survives a motion to dismiss.'))
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/The passage there reads: "Second, only a complaint that states a plausible claim for relief survives a motion to dismiss\."$/)
    const w11 = claim(q('w11', 'To survive a motion to dismiss, a complaint must contain [only] sufficient factual matter'))
    expect(w11.explanation).toMatch(/The passage there reads: "To survive a motion to dismiss,/)
    expect(claim(q('w05', 'Second, only a complaint that states a plausable claim for relief survives a motion to dismiss.'), WL, R050).explanation).toMatch(/reads: "\[9\] Second/)
  })
})

describe('legal@0.5.1: what a FAIL names', () => {
  it('dropped commas are named, not "the same words, written differently"', () => {
    const c = claim(q('w06', 'Threadbare recitals of the elements of a cause of action supported by mere conclusory statements do not suffice.'))
    expect(c.explanation).toMatch(/Where they differ: the text has a comma after "action" that the quotation leaves out; the text has a comma after "statements" that the quotation leaves out\./)
    expect(claim(q('w06', 'Threadbare recitals of the elements of a cause of action supported by mere conclusory statements do not suffice.'), WL, R050).explanation).toMatch(/the same words, written differently/)
    expect(punctuationDifferences('do not suffice.', 'do not suffice')).toEqual([]) // the quotation's own last punctuation is never compared
  })
  it('a bracket that inserts a word is answered by removing it', () => {
    const v = one(q('w11', 'To survive a motion to dismiss, a complaint must contain [only] sufficient factual matter'))
    expect(v.claims[0]!.explanation).toMatch(/the bracket \[only\] inserts "only", which the text does not have there/)
    expect(v.remedies!.map(r => r.detail).join(' ')).toMatch(/Remove the inserted \[only\]/)
    expect(v.remedies!.map(r => r.detail).join(' ')).not.toMatch(/Restore the word the text has/)
  })
  it('words joined from passages farther apart than an ellipsis is read for are named as that, never a dump of the words between', () => {
    const v = one(q('w31', 'a court must accept as true all of the allegations contained in a complaint ... [and] assume their veracity'))
    const c = v.claims[0]!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/its ellipsis would stand for \d+ characters of the text, from line 14 to line 15, more than the 600 an ellipsis is read for, so it joins two passages\. The first reads: "First, the tenet that/)
    expect(c.explanation).not.toMatch(/Id at 555 127/)
    expect(v.remedies!.map(r => r.detail).join(' ')).toMatch(/joins words from two passages of the opinion text supplied for it, \d+ characters apart; an ellipsis is read for at most 600\./)
  })
  it('a long run of words that differs is shown by its ends and its count, punctuation kept', () => {
    const c = claim(q('long', 'In keeping with these principles a court considering a motion to dismiss can choose to begin by identifying pleadings that, because they are no more than conclusions, are not entitled to the assumption of truth. While legal conclusions can provide the framework of a complaint, and every one of the pleaded facts must be read in the light the plaintiff gives it, they must be supported by factual allegations. When there are well-pleaded factual allegations, a court should assume their veracity and then determine whether they plausibly give rise to an entitlement to relief.'))
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/Where they differ: the quotation adds 17 words, "and every one of the pleaded … the plaintiff gives it,"/)
  })
})

describe('legal@0.5.1: sections, wording, remedies, replay and the report', () => {
  it('a Lexis "Dissent by:" line is named for what it is (0.5.0 named it the header above the opinion)', () => {
    const names = (v051: boolean): string[] => sectionsOf(LEXIS, { v051 }).sections.map(s => s.name)
    expect(names(true)).toContain('the "Dissent by" line')
    expect(names(false).filter(n => n === 'the header above the opinion')).toHaveLength(2)
    const v = one(q('l', 'The majority\'s approach to pleading is not consistent with Twombly.', { cite: 'Ashcroft v. Iqbal, 556 U.S. 662, 687 (2009) (Souter, J., dissenting)' }), LX)
    expect(v.opinion_sources![0]!.sections!.map(s => s.name)).toContain('the "Dissent by" line')
  })
  it('no 0.5.1 answer says "abstaining"; a proposition and a possible fabrication say can\'t tell', () => {
    const v = verifyCitations([q('fab', 'A complaint that fails to allege scienter with particularity must be dismissed with prejudice.'), { id: 'prop', ...IQ, proposition: 'pleading requires plausibility' }], WL, R)
    const all = JSON.stringify(v)
    expect(all).not.toMatch(/[Aa]bstain/)
    expect(v.claims[0]!.explanation).toMatch(/it may be fabricated\. Can't tell: the check does not call it a fabrication\./)
    expect(v.claims[1]!.explanation).toMatch(/can't tell, by design\.$/)
  })
  it('its remedy tables are well formed', () => {
    for (const [n, t] of [['0.5.1', LEGAL_REMEDIES_V051], ['inserted', { CITE_VERBATIM: LEGAL_REMEDIES_V051_INSERTED }], ['omitted', { CITE_VERBATIM: LEGAL_REMEDIES_V051_OMITTED_CITATION }], ['stitched', { CITE_VERBATIM: LEGAL_REMEDIES_V051_STITCHED }]] as const) {
      expect(remedyTableProblems(t, n)).toEqual([])
    }
  })
  it('a 0.5.1 verdict and a 0.5.0 verdict of the same inputs both replay byte for byte, with different ids; the 0.5.0 replay says how today reads it', () => {
    const inputs = { citations: [q('w08', 'a court must accept as true all of the allegations contained in a complaint'), q('w26', 'While legal conclusions can provide the framework of a complaint, they must be supported by factual allegations.')], sources: WL }
    const now = verifyCitations(inputs.citations, inputs.sources, R)
    const old = verifyCitations(inputs.citations, inputs.sources, R050)
    expect(now.verdict_id).not.toBe(old.verdict_id)
    for (const v of [now, old]) expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    const r = legalRuleNow(old, inputs)
    expect(r).toMatchObject({ ruleset: 'legal@0.5.4', gate: 'PASS_WITH_OPEN', gate_recorded: 'PASS', claims: [{ claim_id: 'cite.w08', was: 'PASS', now: 'INSUFFICIENT_DATA', reason: 'SELECTIVE_QUOTE', why: 'the cut ends before a limitation' }] })
    expect(legalRuleNow(now, inputs)).toBeUndefined()
  })
  it('the verb\'s report under 0.5.1 named: the continuation beside the answer, the "Dissent by" line in the sections read', () => {
    const dir = packageScratch('legal-051-')
    writeFileSync(join(dir, 'iqbal.txt'), LEXIS)
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ '556 U.S. 662': { file: 'iqbal.txt', source: 'Lexis-shaped mock' } }))
    const brief = join(dir, 'brief.json')
    writeFileSync(brief, JSON.stringify({ citations: [
      q('cut', 'Rule 9 merely excuses a party from pleading discriminatory intent'),
      q('dash', 'It does not give him license to evade the less rigid—though still operative—strictures of Rule 8.'),
    ] }))
    let err = ''
    expect(runCitations([brief, '--sources', dir, '--ruleset', 'legal@0.5.1'], { out: () => {}, err: s => { err += s }, now: NOW })).toBe(0)
    expect(err).toMatch(/^citations: 2 checked under legal@0\.5\.1 \(engine 0\.7\.2\)/)
    expect(err).toContain('the sentence continues: "…under an elevated pleading standard."')
    expect(err).toContain('the "Dissent by" line (lines 21-22)')
    expect(err).not.toMatch(/found at: line/)
  })
})
