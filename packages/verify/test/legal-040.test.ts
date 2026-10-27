/**
 * legal@0.4.0 (2026-10-05), the default for a new legal verdict under engine 0.6.0:
 *   - a quotation that begins in the middle of its sentence, as the text writes it, is read for a condition or a negation in the part
 *     of the sentence before it (an outside reviewer's five lowercase cuts: "Only", "Unless", "Except", "If", "Absent");
 *   - star paging and footnote numerals glued to sentence punctuation are read out of the comparison and named on the answer; a FAIL
 *     that matches once a looser token is read out answers can't tell; a named passage is whole sentences, never showing a page mark,
 *     and a FAIL names the words that differ;
 *   - a short form is read as a pin cite to the brief's own full citation; "Id." and an unresolved short form say "short form; supply
 *     the full citation"; a citation line outside the caption window is named as such; no doubled period after "Co.";
 *   - the citations verb prints the one vocabulary (INSUFFICIENT_DATA, PASS-WITH-OPEN) on stderr; replay names the opinion text that moved.
 * legal@0.0.1 to 0.3.0 answer as before (legal-060.test.ts, legal-030.test.ts, the drift bank).
 *
 * The opinion texts are short excerpts an outside reviewer typed from memory for their probe, or invented for mechanics: they test
 * the check, not the law.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  verifyCitations, LEGAL_REMEDIES_V040, LEGAL_REMEDIES_V040_SHORT_FORM, LEGAL_REMEDIES_V040_UNBOUND,
  type Citation, type LegalVerdict, type OpinionSources,
} from '../src/legal/index'
import { leadCutOf, pageMarksOf, loosePageMarksOf, wordDifferences } from '../src/legal/quotation'
import { runCitations } from '../src/legal/cli-citations'
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'

const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
const R = { now: NOW, ruleset: 'legal@0.4.0' }
const R030 = { now: NOW, ruleset: 'legal@0.3.0' }

const SMITH = [
  'SMITH v. JONES MANUFACTURING CO.',
  '123 F.4th 456 (9th Cir. 2025)',
  'Opinion by Judge Doe.',
  'Only disputes over facts that might affect the outcome of the suit will properly preclude the entry of summary judgment.',
  'Unless the movant shows actual prejudice, the motion to amend must be granted.',
  'Except in extraordinary circumstances, a district court must defer to the arbitrator.',
  'If the contract is ambiguous, extrinsic evidence is admissible to show the parties\' intent.',
  'Absent a showing of bad faith, sanctions are not available under this rule.',
  'Provided the notice is timely, the claim is preserved for review.',
  'Where the record is silent, the presumption of regularity applies.',
  'When the parties so stipulate, the hearing may proceed by video.',
  'To the extent the order rests on state law, it is not reviewable here.',
  'The panel held that the motion to strike must be denied.',
  'The rule is that, unless the plaintiff objects, the deposition may be used at trial.',
  'A notice of appeal must be filed within 30 days after entry of the judgment, and the time limit is mandatory and jurisdictional.',
  'The plaintiff recovered $1,250,000 in compensatory damages under § 1983.',
].join('\n')
const SM = { cite: '123 F.4th 456', case_name: 'Smith v. Jones Manufacturing Co.' }
const sm = (id: string, quote: string): Citation => ({ id, ...SM, quote })

const ANDERSON = [
  'ANDERSON et al. v. LIBERTY LOBBY, INC., et al.',
  '477 U.S. 242 (1986)',
  'JUSTICE WHITE delivered the opinion of the Court.',
  'As to materiality, the substantive law will identify which facts are material. Only disputes over facts that might affect the outcome of the suit under the governing *248 law will properly preclude the entry of summary judgment. Factual disputes that are irrelevant or unnecessary will not be counted.4 This materiality inquiry is independent of and separate [*249] from the question of the incorporation of the evidentiary standard into the summary judgment determination.',
  'The mere existence of a scintilla of evidence in support of the plaintiff\'s position will be insufficient; there must be evidence on which the jury could reasonably find for the plaintiff.',
  'Neither do we suggest that the trial courts should act other than with caution in granting summary judgment or that the trial court may not deny summary judgment in a case where there is reason to believe that the better course would be to proceed to a full trial.',
  'An unconstitutional act is not a law; it confers no rights; it imposes no duties.',
  'We do not hold that summary judgment is never appropriate in a libel case.',
].join('\n')
const AN = { cite: '477 U.S. 242', case_name: 'Anderson v. Liberty Lobby, Inc.' }
const an = (id: string, quote: string): Citation => ({ id, ...AN, quote })

const one = (c: Citation, sources: OpinionSources, opts: Record<string, unknown> = R): LegalVerdict => verifyCitations([c], sources, opts)
const claim = (c: Citation, sources: OpinionSources, opts: Record<string, unknown> = R) => one(c, sources, opts).claims[0]!

// ── a quotation that begins mid-sentence ─────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.4.0 reads the part of the sentence before a quotation that begins mid-sentence', () => {
  const cuts: [string, string, string][] = [
    ['Only', 'disputes over facts that might affect the outcome of the suit will properly preclude the entry of summary judgment', 'Only'],
    ['Unless', 'the motion to amend must be granted', 'Unless the movant shows actual prejudice,'],
    ['Except', 'a district court must defer to the arbitrator', 'Except in extraordinary circumstances,'],
    ['If', 'extrinsic evidence is admissible to show the parties\' intent', 'If the contract is ambiguous,'],
    ['Absent', 'sanctions are not available under this rule', 'Absent a showing of bad faith,'],
    ['Provided', 'the claim is preserved for review', 'Provided the notice is timely,'],
    ['Where', 'the presumption of regularity applies', 'Where the record is silent,'],
    ['When', 'the hearing may proceed by video', 'When the parties so stipulate,'],
    ['To the extent', 'it is not reviewable here', 'To the extent the order rests on state law,'],
  ]
  for (const [word, quote, head] of cuts) {
    it(`a lowercase start after "${word} …" is held as an elided condition (0.3.0 passed it "verbatim")`, () => {
      expect(claim(sm('x', quote), { [SM.cite]: SMITH }, R030).outcome).toBe('PASS') // the hole an outside reviewer found
      const c = claim(sm('x', quote), { [SM.cite]: SMITH })
      expect([c.outcome, c.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'SELECTIVE_QUOTE'])
      expect(c.insufficiency!.detail).toContain(`elided condition: the quotation begins in the middle of its sentence in the opinion text supplied for Smith v. Jones Manufacturing Co., after "${head}", which carries "${word}"`)
      expect(c.explanation).toBe(`Smith v. Jones Manufacturing Co.: elided condition — the quotation begins after "${head}", leaving out "${word}" and what it governs; not certified.`)
    })
  }
  it('a set-off clause that ends right before the quotation is a condition too ("The rule is that, unless …,")', () => {
    const c = claim(sm('x', 'the deposition may be used at trial'), { [SM.cite]: SMITH })
    expect(c.insufficiency?.detail).toMatch(/after "The rule is that, unless the plaintiff objects,", which carries "unless"/)
  })
  it('negative controls: a non-conditional opening, a sentence start, and the bracketed capital (0.3.0\'s guard) behave as before', () => {
    expect(claim(sm('a', 'the motion to strike must be denied'), { [SM.cite]: SMITH }).outcome).toBe('PASS') // "The panel held that" is no condition
    const start = claim(sm('b', 'Unless the movant shows actual prejudice, the motion to amend must be granted.'), { [SM.cite]: SMITH })
    expect([start.outcome, start.explanation]).toEqual(['PASS', 'The quotation appears verbatim in the opinion text supplied for Smith v. Jones Manufacturing Co.: the same words, in the same letter case.'])
    expect(claim(sm('c', '[T]he motion to amend must be granted.'), { [SM.cite]: SMITH }).insufficiency?.detail).toMatch(/opens with a bracketed capital/)
  })
  it('a negation in the quotation\'s own clause is held; one in an earlier clause is not; one within 80 characters keeps the 0.0.1 guard\'s words', () => {
    const far = claim(an('n1', 'the trial court may not deny summary judgment'), { [AN.cite]: ANDERSON })
    expect(far.insufficiency?.detail).toMatch(/^elided negation: the quotation begins in the middle of its sentence .*after "Neither do we suggest that the trial courts should act other than with caution in granting summary judgment or that", which carries the negation "Neither"/)
    expect(claim(an('n2', 'confers no rights; it imposes no duties'), { [AN.cite]: ANDERSON }).outcome).toBe('PASS') // "is not a law; it"
    expect(claim(an('n3', 'hold that summary judgment is never appropriate in a libel case'), { [AN.cite]: ANDERSON }).insufficiency?.detail).toMatch(/immediately follow a negation there/)
  })
  it('the head reader: openers, a closing set-off clause, a negation in the last clause', () => {
    expect(leadCutOf('Only ')).toEqual({ word: 'Only', kind: 'condition' })
    expect(leadCutOf('The panel held that if the contract is ambiguous, ')).toEqual({ word: 'if', kind: 'condition' })
    expect(leadCutOf('The panel held that ')).toBeUndefined()
    expect(leadCutOf('In Smith v. Jones, ')).toBeUndefined()
    expect(leadCutOf('The Clause does not immunize them, but that such commerce may be ')).toBeUndefined()
    expect(leadCutOf('We do not decide today that the regulation is wise, or ')).toEqual({ word: 'not', kind: 'negation' })
  })
})

// ── page marks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.4.0 reads star paging and glued footnote numerals out of the comparison, and says so', () => {
  it('a genuine quotation across "*248", "[*249]" or "counted.4" PASSes, naming what it read out (0.3.0 FAILed each)', () => {
    const cases: [string, string, RegExp][] = [
      ['s1', 'Only disputes over facts that might affect the outcome of the suit under the governing law will properly preclude the entry of summary judgment.', /read with star paging ignored \(\*248\): the same words, in the same letter case\.$/],
      ['s2', 'This materiality inquiry is independent of and separate from the question of the incorporation of the evidentiary standard', /read with star paging ignored \(\[\*249\]\): the same words/],
      ['s3', 'Factual disputes that are irrelevant or unnecessary will not be counted. This materiality inquiry is independent', /read with a footnote numeral ignored \("counted\.4"\): the same words/],
    ]
    for (const [id, quote, said] of cases) {
      expect(claim(an(id, quote), { [AN.cite]: ANDERSON }, R030).outcome, id).toBe('FAIL')
      const c = claim(an(id, quote), { [AN.cite]: ANDERSON })
      expect([c.outcome, c.explanation], id).toEqual(['PASS', expect.stringMatching(said)])
      expect(c.explanation, id).not.toMatch(/verbatim/)
      expect(c.evidence[0]!.normalizations, id).toEqual(expect.arrayContaining([expect.stringMatching(/ignored/)]))
    }
  })
  it('a misquotation across a page mark FAILs on whole sentences, never quoting a mark, and names the words that differ', () => {
    const v = one(an('m', 'This materiality inquiry is dependent on and separate from the question of the incorporation of the evidentiary standard'), { [AN.cite]: ANDERSON })
    const c = v.claims[0]!
    expect(c.outcome).toBe('FAIL')
    expect(c.computation!.result).toBe('This materiality inquiry is independent of and separate from the question of the incorporation of the evidentiary standard into the summary judgment determination.')
    expect(c.explanation).toContain('(read with star paging ignored ([*249])). Where they differ: the text has "independent of" where the quotation has "dependent on".')
    // the line names the mark it read out; the passage it shows, and every remedy, never carry one
    for (const s of [c.explanation.split('The passage there reads:')[1]!, String(c.computation!.result), ...v.remedies!.map(r => r.detail)]) expect(s).not.toMatch(/\*24\d|counted\.4/)
    expect(c.evidence[0]!.value).toContain('[*249]') // the evidence keeps the supplied text's own characters
  })
  it('a token it does not read out on its own ("counted4") answers can\'t tell, never FAIL', () => {
    const glued = ANDERSON.replace('counted.4 This', 'counted4. This')
    const c = claim(an('g', 'Factual disputes that are irrelevant or unnecessary will not be counted.'), { [AN.cite]: glued })
    expect([c.outcome, c.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'UNPARSEABLE'])
    expect(c.insufficiency!.detail).toMatch(/only when a token inside the quoted words is read out \("counted4"\), which may be a page marker or a footnote number/)
    expect(claim(an('g', 'Factual disputes that are irrelevant or unnecessary will not be counted.'), { [AN.cite]: glued }, R030).outcome).toBe('FAIL')
  })
  it('what counts as a safe mark', () => {
    const marks = (s: string) => pageMarksOf(s).map(m => s.slice(m.start, m.end))
    expect(marks('the governing *248 law; separate [*249] from; **2510 and; counted.4 This; the rule,3 which; Rule 56(c).4 The')).toEqual(['*248', '[*249]', '**2510', '4', '3', '4'])
    expect(marks('No.3 and art.2 and p.12 and U.S.3 and 2.4 and gov*248erning and counted4 This')).toEqual([])
    expect(loosePageMarksOf('gov*248erning and counted4 This').map(m => m.kind)).toEqual(['star', 'footnote'])
  })
})

// ── passages and the word diff ───────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.4.0: a named passage is whole sentences, and a FAIL names the words that differ', () => {
  it('"30 days" quoted as "60 days": the passage opens at its sentence (not the caption tail) and closes at its end', () => {
    const v = one(sm('e1', 'A notice of appeal must be filed within 60 days after entry of the judgment'), { [SM.cite]: SMITH })
    const c = v.claims[0]!
    expect(c.computation!.result).toBe('A notice of appeal must be filed within 30 days after entry of the judgment, and the time limit is mandatory and jurisdictional.')
    expect(c.explanation).toBe('The quotation is not found as quoted in the opinion text supplied for Smith v. Jones Manufacturing Co. Where they differ: the text has "30" where the quotation has "60". The passage there reads: "A notice of appeal must be filed within 30 days after entry of the judgment, and the time limit is mandatory and jurisdictional."')
    expect(v.remedies![0]!.detail).toBe('The quotation attributed to 123 F.4th 456 is not found as quoted in the opinion text supplied for it. Where they differ: the text has "30" where the quotation has "60". Conform the quotation to the passage, or cite the passage it comes from; the corrected brief is checked again. The passage there reads: "A notice of appeal must be filed within 30 days after entry of the judgment, and the time limit is mandatory and jurisdictional."')
  })
  it('the outside reviewer\'s altered quotations still FAIL, each naming its difference', () => {
    const fails: [Citation, string, string][] = [
      [an('a3', 'Factual disputes that are irrelevant or unnecessary will be counted.'), ANDERSON, 'the quotation leaves out "not"'],
      [an('a5', 'The mere existence of a scintilla of evidence in support of the plaintiff’s position may be insufficient'), ANDERSON, 'the text has "will" where the quotation has "may"'],
      [an('a8', 'Factual disputes that are irrelevant or unnecessary will not be cоunted.'), ANDERSON, 'the text has "counted" where the quotation has "cоunted"'],
      [an('b6', 'We do not hold that summary judgment is appropriate in a libel case.'), ANDERSON, 'the quotation leaves out "never"'],
      [sm('e2', 'The plaintiff recovered $1,350,000 in compensatory damages under § 1983.'), SMITH, 'the text has "$1,250,000" where the quotation has "$1,350,000"'],
      [sm('e3', 'The plaintiff recovered $1,250,000 in compensatory damages under § 1985.'), SMITH, 'the text has "1983" where the quotation has "1985"'],
    ]
    for (const [c, text, diff] of fails) {
      const x = claim(c, { [c.cite!]: text })
      expect([x.outcome, x.explanation.includes(`Where they differ: ${diff}.`)], c.id).toEqual(['FAIL', true])
    }
  })
  it('the word diff: replacements, omissions and additions; context outside the shared stretch is not a difference', () => {
    expect(wordDifferences('Judicial scrutiny of counsel\'s performance must be highly deferential.', 'Judicial scrutiny of counsel\'s performance must be highly and extremely deferential.')).toEqual([{ text: '', quote: 'and extremely' }])
    expect(wordDifferences('A notice of appeal must be filed within 30 days after entry of the judgment, and the time limit is mandatory.', 'must be filed within 60 days')).toEqual([{ text: '30', quote: '60' }])
  })
})

// ── short forms, headers, wording ────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.4.0: short forms, the caption window, and its wording', () => {
  const QUOTE = 'Factual disputes that are irrelevant or unnecessary will not be counted.'
  it('"477 U.S. at 248" is read as a pin cite to the brief\'s own full citation', () => {
    const v = verifyCitations([{ id: 'full', ...AN, quote: QUOTE }, { id: 'short', cite: '477 U.S. at 248', case_name: 'Anderson', quote: QUOTE }], { [AN.cite]: ANDERSON }, R)
    const c = v.claims[1]!
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/ Short form 477 U\.S\. at 248 read as a pin cite to 477 U\.S\. 242, Anderson v\. Liberty Lobby, Inc\., cited in full at cite\.full\.$/)
    expect(v.opinion_sources![0]!.names[1]).toMatchObject({ claim_id: 'cite.short', bound: true, short_form: { written: '477 U.S. at 248', reads: '477 U.S. 242', from: 'cite.full' } })
    expect(verifyReplay(v, { citations: [{ id: 'full', ...AN, quote: QUOTE }, { id: 'short', cite: '477 U.S. at 248', case_name: 'Anderson', quote: QUOTE }], sources: { [AN.cite]: ANDERSON } })).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    // the same short form written with its case name in the cite field, and with a page range
    const named = verifyCitations([{ id: 'full', ...AN, quote: QUOTE }, { id: 'n', cite: 'Anderson, 477 U.S. at 248-49', quote: QUOTE }], { [AN.cite]: ANDERSON }, R).claims[1]!
    expect([named.outcome, named.explanation]).toEqual(['PASS', expect.stringMatching(/Short form Anderson, 477 U\.S\. at 248-49 read as a pin cite to 477 U\.S\. 242/)])
  })
  it('a short form with nothing to point to, "Id." and an ambiguous one: "short form; supply the full citation"', () => {
    const alone = one({ id: 's', cite: '477 U.S. at 248', case_name: 'Anderson', source_key: AN.cite, quote: QUOTE }, { [AN.cite]: ANDERSON })
    const c = alone.claims[0]!
    expect([c.outcome, c.insufficiency?.reason, c.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', 'REFERENCE_NOT_PROVIDED', ['full_cite']])
    expect(c.insufficiency!.detail).toMatch(/^short form; supply the full citation: the brief gives no full citation in 477 U\.S\. at or before page 248 for Anderson for it to point to\./)
    expect(c.explanation).toBe('Anderson: short form 477 U.S. at 248; supply the full citation. The quotation was not checked.')
    expect(alone.remedies!.map(r => r.detail)).toEqual([LEGAL_REMEDIES_V040_SHORT_FORM.abstain![0]!.detail.replace('{field}', '477 U.S. at 248')])
    const id = claim({ id: 'i', cite: 'Id.', ...{ case_name: AN.case_name }, source_key: AN.cite, quote: QUOTE }, { [AN.cite]: ANDERSON })
    expect(id.explanation).toBe('Anderson v. Liberty Lobby, Inc.: short form Id.; supply the full citation. The quotation was not checked.')
    const two = verifyCitations([{ id: 'a', ...AN, quote: QUOTE }, { id: 'b', cite: '477 U.S. 317', case_name: 'Celotex Corp. v. Catrett', quote: 'x' }, { id: 'c', cite: '477 U.S. at 320', quote: QUOTE }], { [AN.cite]: ANDERSON }, R).claims[2]!
    expect(two.insufficiency!.detail).toMatch(/it could point to more than one full citation of the brief \(477 U\.S\. 242; 477 U\.S\. 317\)/)
    expect(claim({ id: 'i', cite: 'Id.', case_name: AN.case_name, source_key: AN.cite, quote: QUOTE }, { [AN.cite]: ANDERSON }, R030).explanation).toMatch(/does not print the reporter citation Id\./) // 0.3.0's words, kept
  })
  it('a citation line printed outside the caption window is named, with the window, instead of "in its body"', () => {
    const lexis = 'Anderson v. Liberty Lobby, Inc.\nSupreme Court of the United States\nDecember 3, 1985, Argued ; June 25, 1986, Decided\nNo. 84-1602\nReporter\n477 U.S. 242 *; 106 S. Ct. 2505 **; 91 L. Ed. 2d 202 ***\nJUSTICE WHITE delivered the opinion of the Court.\n' + QUOTE
    const v = one({ id: 'l', ...AN, quote: QUOTE }, { L: { text: lexis } }, R)
    expect(v.claims[0]!.outcome).toBe('INSUFFICIENT_DATA') // no source key: the text is keyed L, the citation has none
    const w = one({ id: 'l', ...AN, source_key: 'L', quote: QUOTE }, { L: { text: lexis } }, R)
    const c = w.claims[0]!
    expect(c.explanation).toBe('Anderson v. Liberty Lobby, Inc.: the citation line 477 U.S. 242 sits 5 lines below the case name in the supplied text, outside the caption window (a caption\'s citation line lies at most three lines above the case name or two below it); the quotation was not checked.')
    expect(w.opinion_sources![0]!.names[0]).toMatchObject({ cite_line: { lines: 5, at: 'below' } })
    expect(w.remedies!.map(r => r.detail)).toEqual([LEGAL_REMEDIES_V040_UNBOUND.abstain![0]!.detail.replace('{field}', '477 U.S. 242')])
  })
  it('no doubled period after a name ending in "Co." or "Inc."', () => {
    const texts = [
      claim(sm('d1', 'A notice of appeal must be filed within 60 days after entry of the judgment'), { [SM.cite]: SMITH }).explanation,
      claim({ id: 'd2', cite: '123 F.4th 999', case_name: 'Smith v. Jones Manufacturing Co.', source_key: SM.cite, quote: 'x y z w' }, { [SM.cite]: SMITH }).insufficiency!.detail,
      claim(an('d3', 'Factual disputes that are irrelevant or unnecessary will be counted.'), { [AN.cite]: ANDERSON }).explanation,
    ]
    for (const t of texts) expect(t).not.toMatch(/\b(?:Co|Inc)\.\./)
    expect(claim(sm('d1', 'A notice of appeal must be filed within 60 days after entry of the judgment'), { [SM.cite]: SMITH }, R030).explanation).toMatch(/Co\.\. /) // 0.3.0's recorded words, kept
  })
})

// ── the verb, replay, versions ───────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.4.0: the verb\'s one vocabulary and stream, replay, versions', () => {
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-040-'))
    const src = join(dir, 'opinions'); mkdirSync(src)
    writeFileSync(join(src, '123 F.4th 456.txt'), SMITH)
    const brief = join(dir, 'brief.json')
    writeFileSync(brief, JSON.stringify([sm('ok', 'the motion to strike must be denied'), sm('cut', 'the motion to amend must be granted')]))
    return { dir, src, brief }
  }
  it('the report goes to stderr; stdout is empty without --json and is the verdict with it; can\'t tell reads INSUFFICIENT_DATA; PASS-WITH-OPEN hyphenated', () => {
    const { src, brief } = folder()
    let out = '', err = ''
    expect(runCitations([brief, '--sources', src, '--ruleset', 'legal@0.4.0'], { out: s => { out += s }, err: s => { err += s }, now: NOW })).toBe(2)
    expect(out).toBe('')
    expect(err).toMatch(/\nINSUFFICIENT_DATA cite\.cut  Smith v\. Jones Manufacturing Co\., 123 F\.4th 456  \[SELECTIVE_QUOTE\]\n/)
    expect(err).toMatch(/\nverdict: PASS-WITH-OPEN: every citation that could be checked held, but some could not be checked \(1 pass, 0 fail, 1 can't tell\); verdict_id [0-9a-f]{32}\n/)
    expect(err).not.toMatch(/ABSTAIN|PASS_WITH_OPEN/)
    out = ''; err = ''
    expect(runCitations([brief, '--sources', src, '--json', '--ruleset', 'legal@0.4.0'], { out: s => { out += s }, err: s => { err += s }, now: NOW })).toBe(2)
    expect((JSON.parse(out) as LegalVerdict).gate_status).toBe('PASS_WITH_OPEN') // the JSON keeps its form
    expect(err).toMatch(/^citations: 2 checked under legal@0\.4\.0/)
  })
  it('replay names the opinion text that moved, against the sha256 the verdict records', () => {
    const inputs = { citations: [sm('r', 'the motion to strike must be denied')], sources: { [SM.cite]: { text: SMITH, source: 'firm DMS' } } }
    const v = verifyCitations(inputs.citations, inputs.sources, R)
    expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    const moved = verifyReplay(v, { ...inputs, sources: { [SM.cite]: { text: `${SMITH} `, source: 'firm DMS' } } })
    expect(moved.reason).toMatch(/the citations agree with the verdict's document\.extraction_hash; against the opinion texts the verdict records \(opinion_sources\): the opinion text for 123 F\.4th 456 is not the one the verdict records \(supplied sha256 [0-9a-f]{12}…, recorded [0-9a-f]{12}…\)/)
    const origin = verifyReplay(v, { ...inputs, sources: { [SM.cite]: { text: SMITH, source: 'Westlaw download' } } })
    expect(origin.reason).toMatch(/the stated source of the opinion text for 123 F\.4th 456 is "Westlaw download", where the verdict records "firm DMS"/)
  })
  it('its remedy tables are well formed; 0.3.0 verdicts replay byte for byte; the same inputs give a different id under each', () => {
    for (const [n, t] of [['0.4.0', LEGAL_REMEDIES_V040], ['short', { CITE_VERBATIM: LEGAL_REMEDIES_V040_SHORT_FORM }], ['unbound', { CITE_VERBATIM: LEGAL_REMEDIES_V040_UNBOUND }]] as const) {
      expect(remedyTableProblems(t, `legal ${n}`), n).toEqual([])
    }
    const inputs = { citations: [sm('a', 'the motion to amend must be granted'), an('b', 'Only disputes over facts that might affect the outcome of the suit under the governing law will properly preclude the entry of summary judgment.')], sources: { [SM.cite]: SMITH, [AN.cite]: ANDERSON } }
    const v4 = verifyCitations(inputs.citations, inputs.sources, R)
    const v3 = verifyCitations(inputs.citations, inputs.sources, R030)
    expect(v4.claims.map(c => c.outcome)).toEqual(['INSUFFICIENT_DATA', 'PASS'])
    expect(v3.claims.map(c => c.outcome)).toEqual(['PASS', 'FAIL']) // 0.3.0's answers stand for its verdicts
    expect(v4.verdict_id).not.toBe(v3.verdict_id)
    for (const v of [v3, v4]) expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
  })
})
