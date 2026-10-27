/**
 * legal@0.5.2 (2026-10-06), the default for a new legal verdict under engine 0.6.0:
 *   - a quotation that begins in the middle of its sentence is never called "verbatim": its PASS prints how the sentence begins; when
 *     those words report another's position ("Appellant argues that", "The dissent maintains that", "the court stated that",
 *     "Respondent moved …, contending that") or frame what follows ("we might hold that", "It would be a mistake to conclude that", "The
 *     question is whether", "Assuming that"), the answer is can't tell naming them; the court's own voice and its adoption pass;
 *   - a lead opinion that is a plurality is named "the lead opinion", and a PASS in a plurality part says so, never "majority";
 *   - a Westlaw PDF's page footer and running header, and a Lexis "HN4[ ]" marker, are read out of the comparison; a KeyCite flag at the
 *     head of a download is not read as its caption, and the "All Citations" lines at its end name the text;
 *   - a FAIL's words left out honour the quotation's ellipses;
 *   - a legal replay's scope line states no evidence floor; a folder whose file names do not read as reporter citations gets a hint.
 * legal@0.5.1 and every earlier rule answer as before (legal-051.test.ts and the rest, the drift bank).
 *
 * The opinion texts are short mock-ups laid out the way a cold reader (an AI agent, not a person) laid out its own: they test the
 * check's mechanics, not the law.
 */
import { afterAll, describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyCitations, defaultLegalRuleset, LEGAL_REMEDIES_V052, LEGAL_REMEDIES_V052_FRAMED, type Citation, type OpinionSources } from '../src/legal/index'
import { furnitureMarksOf, leadFrameOf, lexisHeadnoteMarksOf, wordDifferences } from '../src/legal/quotation'
import { sectionsOf } from '../src/legal/sections'
import { captionOf } from '../src/legal/binding'
import { legalRuleNow, legalScopeLines } from '../src/legal/replay-notice'
import { runCitations } from '../src/legal/cli-citations'
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'
import { run } from '../src/cli'
import { scratch as packageScratch, cleanScratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const NOW = (): Date => new Date('2026-10-06T00:00:00Z')
const R = { now: NOW, ruleset: 'legal@0.5.2' }
const R051 = { now: NOW, ruleset: 'legal@0.5.1' }

const HARLAN = [
  'Harlan v. Reed Logistics, Inc.',
  '999 F.4th 101 (9th Cir. 2026)',
  'SMITH, Circuit Judge:',
  'We reject the contention that the arbitration clause is unenforceable.',
  'The dissent maintains that the statute of limitations was tolled.',
  'It would be a mistake to conclude that the agency\'s interpretation controls.',
  'Appellant argues that the contract is void for vagueness. We disagree.',
  'Were we writing on a clean slate, we might hold that the waiver is invalid.',
  'Citing Smith v. Jones, 12 F.3d 34 (1990), the court stated that expert opinion is inadmissible unless generally accepted.',
  'Respondent moved for summary judgment, contending that the drug does not cause birth defects.',
  'We hold that the notice was timely.',
  'In Kline, this Court held that the notice period runs from receipt.',
  'Petitioners suggest, and we agree, that the notice period runs from mailing.',
  'Congress found that small carriers bear the cost of the rule.',
  'The question is whether the clause survives termination.',
  'Assuming that the provision survives, the claim is arbitrable.',
  'It is argued that the claim is time-barred.',
  'We are not persuaded by the contention that the claim is time-barred.',
  'A reasonable jury could find that the carrier acted in bad faith.',
  'To the contrary, under the Act the carrier must give notice within ten days.',
  'Notice must reach the shipper within ten days.',
].join('\n')
const H: OpinionSources = { '999 F.4th 101': { text: HARLAN, source: 'mock-up' } }
const HC = { cite: '999 F.4th 101', case_name: 'Harlan v. Reed Logistics, Inc.' }
const q = (id: string, quote: string, extra: Partial<Citation> = {}): Citation => ({ id, ...HC, quote, ...extra })
const claim = (c: Citation, sources: OpinionSources = H, opts: Record<string, unknown> = R) => verifyCitations([c], sources, opts as never).claims[0]!

describe('legal@0.5.2 is the default, and every earlier rule is still issued when named', () => {
  it('a new verdict under engine 0.6.0 is legal@0.5.2 (under this build, legal@0.5.3); 0.5.1 is issued when named; earlier engines keep 0.0.1; 0.5.2 needs engine 0.6.0', () => {
    // 2026-10-14: legal@0.5.4 becomes this build's default with the engine that ships it (src/legal/index.ts V054_DEFAULT_ENGINE); 0.5.3 until then
    expect(['0.5.3', '0.5.4']).toContain(defaultLegalRuleset().version)
    expect(defaultLegalRuleset('0.6.0').version).toBe('0.5.2')
    expect(defaultLegalRuleset('0.5.0').version).toBe('0.0.1')
    expect(verifyCitations([q('a', 'x')], H, { now: NOW }).ruleset).toEqual({ id: 'legal', version: defaultLegalRuleset().version, domain: 'legal' })
    expect(verifyCitations([q('a', 'x')], H, R051).ruleset.version).toBe('0.5.1')
    expect(() => verifyCitations([q('a', 'x')], H, { now: NOW, engine: '0.5.0', ruleset: 'legal@0.5.2' })).toThrow(/legal@0\.5\.2 needs engine 0\.6\.0 or later/)
  })
})

describe('legal@0.5.2: the words before a quotation that begins mid-sentence', () => {
  it('reported speech answers can\'t tell, naming the lead-in and whose words they are (0.5.1 passed each, three as "verbatim")', () => {
    const cases: [string, string, RegExp][] = [
      ['the statute of limitations was tolled.', 'The dissent maintains that', /a separate opinion's view/],
      ['the contract is void for vagueness.', 'Appellant argues that', /a party's position/],
      ['expert opinion is inadmissible unless generally accepted.', 'the court stated that', /another court or tribunal/],
      ['the drug does not cause birth defects.', 'Respondent moved for summary judgment, contending that', /a party's position/],
      ['the claim is time-barred.', 'It is argued that', /someone else's position/],
    ]
    for (const [quote, lead, whose] of cases) {
      const c = claim(q('r', quote))
      expect(c.outcome).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency).toMatchObject({ reason: 'SELECTIVE_QUOTE', missing: ['lead_in'] })
      expect(c.insufficiency!.detail).toMatch(/^reported speech: the words follow "/)
      expect(c.insufficiency!.detail).toContain(lead)
      expect(c.explanation).toMatch(whose)
      expect(claim(q('r', quote), H, R051).outcome).toBe('PASS')
    }
  })
  it('a counterfactual, a rejected reading, a question and a hypothetical answer can\'t tell, each named', () => {
    expect(claim(q('c', 'the waiver is invalid.')).insufficiency!.detail).toMatch(/^counterfactual: the words follow "Were we writing on a clean slate, we might hold that"/)
    expect(claim(q('c', 'the agency\'s interpretation controls.')).insufficiency!.detail).toMatch(/^rejected reading: the words follow "It would be a mistake to conclude that".*the opinion rejects what follows/)
    expect(claim(q('c', 'the clause survives termination.')).insufficiency!.detail).toMatch(/^question: .*poses the words as a question/)
    expect(claim(q('c', 'the provision survives')).insufficiency!.detail).toMatch(/^counterfactual: .*hypothetical/)
    expect(claim(q('c', 'the carrier acted in bad faith.')).insufficiency!.detail).toMatch(/^counterfactual: the words follow "A reasonable jury could find that"/)
  })
  it('the court\'s own voice and its adoption of what it reports pass, printing how the sentence begins (never "verbatim")', () => {
    for (const [quote, lead] of [['the notice was timely.', 'We hold that'], ['the notice period runs from receipt.', 'In Kline, this Court held that'], ['the notice period runs from mailing.', 'Petitioners suggest, and we agree, that'], ['small carriers bear the cost of the rule.', 'Congress found that']] as const) {
      const c = claim(q('o', quote))
      expect(c.outcome).toBe('PASS')
      expect(c.explanation).not.toMatch(/verbatim/)
      expect(c.explanation).toContain(`but it begins in the middle of its sentence; the sentence begins: "${lead}…"`)
    }
  })
  it('a neutral lead-in passes with the lead-in printed; a whole sentence is still "verbatim"; a negation before it is held as before', () => {
    const mid = claim(q('m', 'the carrier must give notice within ten days.'))
    expect(mid.outcome).toBe('PASS')
    expect(mid.explanation).toMatch(/the sentence begins: "To the contrary, under the Act…"/)
    expect(claim(q('w', 'Notice must reach the shipper within ten days.')).explanation).toMatch(/appears verbatim/)
    expect(claim(q('n', 'the claim is time-barred.')).outcome).toBe('INSUFFICIENT_DATA')
    const both = claim(q('b', 'the carrier must give notice'))
    expect(both.explanation).toMatch(/begins in the middle of its sentence and stops before its end; the sentence begins: "To the contrary, under the Act…" and continues: "…within ten days\."/)
  })
  it('a held quotation is answered by quoting it with its lead-in, or by the attorney of record', () => {
    const v = verifyCitations([q('r', 'the contract is void for vagueness.')], H, R)
    expect(v.remedies?.map(r => r.kind)).toEqual(['recompute-with', 'authority'])
    expect(v.remedies?.[0]?.detail).toMatch(/Quote the words with the lead-in/)
  })
  it('the lead-in reader: whose words, how framed, and the court\'s own voice', () => {
    expect(leadFrameOf('The dissent maintains that ')).toMatchObject({ kind: 'separate' })
    expect(leadFrameOf('Appellant argues on appeal that ')).toMatchObject({ kind: 'party' })
    expect(leadFrameOf('The Ninth Circuit reasoned that ')).toMatchObject({ kind: 'court' })
    expect(leadFrameOf('The court below held that ')).toMatchObject({ kind: 'court' })
    expect(leadFrameOf('Justice Scalia wrote that ')).toMatchObject({ kind: 'separate' })
    expect(leadFrameOf('One could argue that ')).toMatchObject({ kind: 'counterfactual' })
    expect(leadFrameOf('We reject the contention that ')).toMatchObject({ kind: 'argument' })
    expect(leadFrameOf('We hold that ')).toBeUndefined()
    expect(leadFrameOf('We conclude that ')).toBeUndefined()
    expect(leadFrameOf('The Court has said that ')).toBeUndefined()
    expect(leadFrameOf('As the dissent notes, ')).toBeUndefined()
    expect(leadFrameOf('Appellant correctly argues that ')).toBeUndefined()
    expect(leadFrameOf('The record shows that ')).toBeUndefined()
    // "the court" in small letters: a trial court's own voice in the present tense; a court below or a decision in the past
    expect(leadFrameOf('For these reasons, the court finds that ')).toBeUndefined()
    expect(leadFrameOf('In its earlier order, the court found that ')).toMatchObject({ kind: 'court' })
  })
})

const PLURALITY = [
  'Roe v. Doe Industries, Inc.',
  '600 U.S. 1 (2027)',
  'Justice SMITH announced the judgment of the Court and delivered the opinion of the Court with respect to Parts I and II, and an opinion with respect to Part III, in which Justice JONES and Justice LEE join.',
  'I',
  'The statute applies to the conduct at issue.',
  'III',
  'The statute also reaches conduct abroad.',
  'Justice KAGAN, concurring in part and concurring in the judgment.',
  'I join Parts I and II of the Court opinion but not Part III.',
].join('\n')
const PL: OpinionSources = { '600 U.S. 1': PLURALITY }
const PC = { cite: '600 U.S. 1', case_name: 'Roe v. Doe Industries, Inc.' }

describe('legal@0.5.2: a plurality is named, never "the majority opinion"', () => {
  it('a PASS in a plurality part says so, naming the designation; in a part of the Court it says that', () => {
    const p = claim({ id: 'p', ...PC, quote: 'The statute also reaches conduct abroad.' }, PL)
    expect(p.outcome).toBe('PASS')
    expect(p.explanation).toMatch(/Found in Part III of the lead opinion, line 7 \(character offset \d+\): a plurality opinion, not an opinion of the Court; the designation makes the lead opinion the Court's only as to Parts I and II \(line 3: "Justice SMITH announced the judgment/)
    expect(p.explanation).not.toMatch(/majority/)
    const c = claim({ id: 'c', ...PC, quote: 'The statute applies to the conduct at issue.' }, PL)
    expect(c.explanation).toMatch(/Found in Part I of the lead opinion, line 5 \(character offset \d+\): an opinion of the Court as to that part; the lead opinion is a plurality as to Part III/)
    expect(claim({ id: 'p', ...PC, quote: 'The statute also reaches conduct abroad.' }, PL, R051).explanation).toMatch(/Found in the majority opinion, line 7/)
  })
  it('a lead opinion with no opinion of the Court is a plurality throughout; the sections read name it the lead opinion', () => {
    const whole = PLURALITY.replace('and delivered the opinion of the Court with respect to Parts I and II, and an opinion with respect to Part III, in which', 'and delivered an opinion, in which')
    const c = claim({ id: 'w', ...PC, quote: 'The statute applies to the conduct at issue.' }, { '600 U.S. 1': whole })
    expect(c.explanation).toMatch(/Found in Part I of the lead opinion, line 5 \(character offset \d+\): a plurality opinion, not an opinion of the Court; it announces the judgment of the Court, and no part of it is the Court's opinion/)
    expect(sectionsOf(PLURALITY, { v052: true }).sections.map(s => s.name)).toEqual(['the header above the opinion', 'the lead opinion', 'Justice Kagan\'s concurrence'])
    expect(sectionsOf(PLURALITY, { v051: true }).sections.map(s => s.name)).toContain('the majority opinion')
    const held = claim({ id: 'k', ...PC, quote: 'I join Parts I and II of the Court opinion but not Part III.' }, PL)
    expect(held.explanation).toMatch(/not in the lead opinion/)
  })
})

const FOOTER = '© 2026 Thomson Reuters. No claim to original U.S. Government Works. 9\nDaubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)\n113 S.Ct. 2786, 125 L.Ed.2d 469, 37 Fed. R. Evid. Serv. 1\n'
const DAUBERT_PDF = [
  'Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)',
  '113 S.Ct. 2786, 125 L.Ed.2d 469, 37 Fed. R. Evid. Serv. 1',
  'Opinion',
  'Justice BLACKMUN delivered the opinion of the Court.',
  `Vigorous cross-examination, presentation of contrary evidence, and careful instruction on the\n${FOOTER}**2798 *596 burden of proof are the traditional and appropriate means of attacking shaky but admissible evidence.`,
  'See Smith v. Jones, 12 F.3d 34 (1990).',
  'The inquiry is a flexible one.',
].join('\n')
const DC = { cite: '509 U.S. 579', case_name: 'Daubert v. Merrell Dow Pharmaceuticals, Inc.' }

describe('legal@0.5.2: what a vendor prints around the opinion', () => {
  it('a Westlaw PDF\'s page footer and running header inside a genuine quotation are read out, and the PASS names them (0.5.1 FAILed it)', () => {
    const src = { '509 U.S. 579': DAUBERT_PDF }
    const quote = 'Vigorous cross-examination, presentation of contrary evidence, and careful instruction on the burden of proof are the traditional and appropriate means of attacking shaky but admissible evidence.'
    const c = claim({ id: 'pdf', ...DC, quote }, src)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/read with star paging ignored \(\*\*2798, \*596\) and a page break's footer and running header read out \("© 2026 Thomson Reuters/)
    expect(claim({ id: 'pdf', ...DC, quote }, src, R051).outcome).toBe('FAIL')
    expect(claim({ id: 'alt', ...DC, quote: quote.replace('admissible', 'inadmissible') }, src).outcome).toBe('FAIL')
  })
  it('a run of furniture needs a vendor\'s own line; a citation line standing alone in the opinion is never read out', () => {
    expect(furnitureMarksOf(DAUBERT_PDF)).toHaveLength(1)
    expect(furnitureMarksOf('the\nSmith v. Jones, 12 F.3d 34 (1990)\nwords')).toEqual([])
    const c = claim({ id: 'stitch', ...DC, quote: 'See The inquiry is a flexible one.' }, { '509 U.S. 579': DAUBERT_PDF })
    expect(c.outcome).not.toBe('PASS')
  })
  it('a Lexis "HN4[ ]" marker is read out like a Westlaw headnote number, and a quotation after one is not said to present part of a sentence', () => {
    const lexis = [
      'Daubert v. Merrell Dow Pharms., 509 U.S. 579', '', 'Reporter', '509 U.S. 579 *; 113 S. Ct. 2786 **', '', 'Opinion', '',
      'JUSTICE BLACKMUN delivered the opinion of the Court.', '',
      'Nor is the trial judge disabled from screening such evidence. HN4[ ] To the contrary, under the Rules the trial judge must ensure that the evidence is reliable.',
    ].join('\n')
    expect(lexisHeadnoteMarksOf(lexis)).toHaveLength(1)
    const src = { '509 U.S. 579': lexis }
    const whole = claim({ id: 'hn', ...DC, quote: 'To the contrary, under the Rules the trial judge must ensure that the evidence is reliable.' }, src)
    expect(whole.outcome).toBe('PASS')
    expect(whole.explanation).not.toMatch(/part of a sentence/)
    const two = claim({ id: 'hn2', ...DC, quote: 'Nor is the trial judge disabled from screening such evidence. To the contrary, under the Rules the trial judge must ensure that the evidence is reliable.' }, src)
    expect(two.outcome).toBe('PASS')
    expect(two.explanation).toMatch(/a headnote number ignored \(HN4\[ \]\)/)
    expect(claim({ id: 'hn2', ...DC, quote: 'Nor is the trial judge disabled from screening such evidence. To the contrary, under the Rules the trial judge must ensure that the evidence is reliable.' }, src, R051).outcome).toBe('FAIL')
  })
  it('a download that opens on its KeyCite flag binds to its real caption, and its "All Citations" line names the text (0.5.1 took the flag for the caption)', () => {
    const kc = [
      'KeyCite Yellow Flag - Negative Treatment',
      'Declined to Extend by Nease v. Ford Motor Co., 4th Cir.(W.Va.), January 24, 2017',
      '113 S.Ct. 2786',
      'Supreme Court of the United States',
      'William DAUBERT, et ux., Petitioners,', 'v.', 'MERRELL DOW PHARMACEUTICALS, INC.',
      'Opinion', 'Justice BLACKMUN delivered the opinion of the Court.',
      'The inquiry envisioned by Rule 702 is, we emphasize, a flexible one.',
      'All Citations', '509 U.S. 579, 113 S.Ct. 2786, 125 L.Ed.2d 469',
    ].join('\n')
    expect(captionOf(kc, undefined, { vendor: true })?.name).toBe('William Daubert v. Merrell Dow Pharmaceuticals')
    expect(captionOf(kc)?.name).toMatch(/^Declined to Extend by Nease/)
    const v = verifyCitations([{ id: 'kc', ...DC, quote: 'The inquiry envisioned by Rule 702 is, we emphasize, a flexible one.' }], { '509 U.S. 579': kc }, R)
    expect(v.claims[0]!.outcome).toBe('PASS')
    expect(v.opinion_sources?.[0]?.names[0]).toMatchObject({ bound: true, all_citations: true })
    expect(verifyCitations([{ id: 'kc', ...DC, quote: 'x y z w' }], { '509 U.S. 579': kc }, R051).claims[0]!.explanation).toMatch(/Declined to Extend by Nease/)
  })
})

describe('legal@0.5.2: a FAIL\'s words left out honour the quotation\'s ellipses', () => {
  it('words an ellipsis stands for are never listed; a changed word after a long ellipsis is named', () => {
    const passage = 'The focus, of course, must be solely on principles and methodology, not on the conclusions that they generate.'
    const quote = 'The focus . . . must be on principles and methodology, not on the conclusions that they generate.'
    expect(wordDifferences(passage, quote, 4, true, true)).toEqual([{ text: 'solely', quote: '' }])
    expect(wordDifferences(passage, quote, 4, true).map(d => d.text)).toContain('of course,')
    const wl = { '509 U.S. 579': 'Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993)\nOpinion\nJustice BLACKMUN delivered the opinion of the Court.\n' + passage }
    const c = claim({ id: 'x', ...DC, quote: `${quote} (cleaned up)` }, wl)
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/Where they differ: the quotation leaves out "solely"\. The passage/)
  })
})

describe('legal@0.5.2: replay, the report and remedies', () => {
  it('a 0.5.1 verdict and a 0.5.2 verdict of the same inputs both replay byte for byte; the 0.5.1 replay says how today reads it', () => {
    const inputs = { citations: [q('r', 'the contract is void for vagueness.'), q('w', 'Notice must reach the shipper within ten days.')], sources: H }
    const now = verifyCitations(inputs.citations, inputs.sources, R)
    const old = verifyCitations(inputs.citations, inputs.sources, R051)
    expect(now.verdict_id).not.toBe(old.verdict_id)
    for (const v of [now, old]) expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    expect(legalRuleNow(old, inputs)).toMatchObject({ ruleset: 'legal@0.5.4', claims: [{ claim_id: 'cite.r', was: 'PASS', now: 'INSUFFICIENT_DATA', reason: 'SELECTIVE_QUOTE', why: 'reported speech' }] })
    expect(legalRuleNow(now, inputs)).toBeUndefined()
  })
  it('a legal replay\'s scope line says what the verdict was checked against, never an evidence floor', () => {
    const v = verifyCitations([q('w', 'Notice must reach the shipper within ten days.')], H, R)
    expect(legalScopeLines(v)[0]).toBe('Scope: checked against legal@0.5.2 by engine 0.7.2; each quotation against the opinion text supplied for its cite, recorded in the verdict by its sha256.')
    const dir = packageScratch('legal-052-replay-')
    const file = join(dir, 'b.json')
    writeFileSync(file, JSON.stringify({ verdict: v, inputs: { citations: [q('w', 'Notice must reach the shipper within ten days.')], sources: H } }))
    let err = ''
    expect(run(['replay', file], { out: () => {}, err: (s: string) => { err += s } } as never)).toBe(0)
    expect(err).toContain('Scope: checked against legal@0.5.2 by engine 0.7.2; each quotation against the opinion text supplied for its cite')
    expect(err).not.toMatch(/evidence floor/)
  })
  it('a folder whose file names do not read as reporter citations gets a hint saying how a folder is keyed', () => {
    const dir = packageScratch('legal-052-folder-')
    writeFileSync(join(dir, 'harlan-999-F4th-101.txt'), HARLAN)
    const brief = join(dir, 'brief.json')
    writeFileSync(brief, JSON.stringify([q('a', 'We hold that the notice was timely.')]))
    let err = ''
    expect(runCitations([brief, '--sources', dir], { out: () => {}, err: s => { err += s }, now: NOW })).toBe(2)
    expect(err).toContain('hint: 1 citation found no text. In a folder without sources.json, each text is keyed by its file name, and this name does not read as a reporter citation: harlan-999-F4th-101.txt. Name the file by the citation it is for ("999 F.4th 101.txt"), or add a sources.json beside it: { "999 F.4th 101": { "file": "harlan-999-F4th-101.txt" } }.')
    writeFileSync(join(dir, '999 F.4th 101.txt'), HARLAN)
    err = ''
    runCitations([brief, '--sources', dir], { out: () => {}, err: s => { err += s }, now: NOW })
    expect(err).not.toMatch(/hint:/)
  })
  it('its remedy tables are well formed, and no 0.5.2 answer says "abstaining"', () => {
    for (const [n, t] of [['0.5.2', LEGAL_REMEDIES_V052], ['framed', { CITE_VERBATIM: LEGAL_REMEDIES_V052_FRAMED }]] as const) expect(remedyTableProblems(t, n)).toEqual([])
    expect(JSON.stringify(verifyCitations([q('a', 'the contract is void for vagueness.'), q('b', 'Nothing like this is in the text at all, anywhere.')], H, R))).not.toMatch(/[Aa]bstain/)
  })
})
