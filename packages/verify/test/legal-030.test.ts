/**
 * legal@0.3.0 (2026-10-05), the default for a new legal verdict under engine 0.6.0:
 *   - a text is bound to a citation by its CAPTION, never by a mention in its body (an outside reviewer's Cooper-for-Brown probe);
 *   - a text bound by parties only is checked and left open, never PASS (the verdict is PASS_WITH_OPEN; the verb exits 2);
 *   - an ellipsis or a capital at an EDGE of a quotation is read to the sentence boundary for a dropped condition, and a set-off
 *     phrase of time or procedure in an ellipsis is a condition;
 *   - letter case is compared: "verbatim" means the same words in the same case.
 * legal@0.0.1 to 0.2.0 answer as before (test/legal-060.test.ts and the drift bank).
 *
 * The opinion texts are short excerpts of opinions in the United States Reports (public domain): Cooper v. Aaron, 358 U.S. 1;
 * Marbury v. Madison, 5 U.S. 137; Strickland v. Washington, 466 U.S. 668; Brandenburg v. Ohio, 395 U.S. 444; Miranda v. Arizona,
 * 384 U.S. 436; Celotex Corp. v. Catrett, 477 U.S. 317; as an outside reviewer typed them for the adversarial brief they ran.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  verifyCitations, LEGAL_REMEDIES_V030, LEGAL_REMEDIES_V030_UNBOUND, LEGAL_REMEDIES_V030_PARTIES_ONLY, PARTIES_ONLY_NOTE_V030, captionOf,
  type Citation, type LegalVerdict, type OpinionSources,
} from '../src/legal/index'
import { captionNamingOf } from '../src/legal/binding'
import { runCitations } from '../src/legal/cli-citations'
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'

const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
const R = { now: NOW, ruleset: 'legal@0.3.0' }

const COOPER = [
  'COOPER et al., MEMBERS OF THE BOARD OF DIRECTORS OF THE LITTLE ROCK, ARKANSAS, INDEPENDENT SCHOOL DISTRICT, et al. v. AARON et al.',
  '358 U.S. 1 (1958)',
  'Opinion of the Court by THE CHIEF JUSTICE, MR. JUSTICE BLACK, MR. JUSTICE FRANKFURTER, MR. JUSTICE DOUGLAS, MR. JUSTICE BURTON, MR. JUSTICE CLARK, MR. JUSTICE HARLAN, MR. JUSTICE BRENNAN, and MR. JUSTICE WHITTAKER.',
  'As this case reaches us it raises questions of the highest importance to the maintenance of our federal system of government. It necessarily involves a claim by the Governor and Legislature of a State that there is no duty on state officials to obey federal court orders resting on this Court\'s considered interpretation of the United States Constitution. Specifically it involves actions by the Governor and Legislature of Arkansas upon the premise that they are not bound by our holding in Brown v. Board of Education, 347 U.S. 483.',
  'Article VI of the Constitution makes the Constitution the "supreme Law of the Land." In 1803, Chief Justice Marshall, speaking for a unanimous Court, referring to the Constitution as "the fundamental and paramount law of the nation," declared in the notable case of Marbury v. Madison, 1 Cranch 137, 177, that "It is emphatically the province and duty of the judicial department to say what the law is." This decision declared the basic principle that the federal judiciary is supreme in the exposition of the law of the Constitution, and that principle has ever since been respected by this Court and the Country as a permanent and indispensable feature of our constitutional system.',
  'The principles announced in that decision and the obedience of the States to them, according to the command of the Constitution, are indispensable for the protection of the freedoms guaranteed by our fundamental charter for all of us. Our constitutional ideal of equal justice under law is thus made a living truth.',
].join('\n')
const MARBURY_BODY = 'Mr. Chief Justice MARSHALL delivered the opinion of the Court.\nIt is emphatically the province and duty of the judicial department to say what the law is. Those who apply the rule to particular cases, must of necessity expound and interpret that rule.'
const MARBURY = `MARBURY v. MADISON.\n5 U.S. 137 (1803)\n${MARBURY_BODY}`
const MARBURY_NOCITE = `MARBURY v. MADISON.\n${MARBURY_BODY}`
const STRICKLAND = 'STRICKLAND, SUPERINTENDENT, FLORIDA STATE PRISON, et al. v. WASHINGTON.\n466 U.S. 668 (1984)\nJUSTICE O\'CONNOR delivered the opinion of the Court.\nFirst, the defendant must show that counsel\'s performance was deficient. Second, the defendant must show that the deficient performance prejudiced the defense. Unless a defendant makes both showings, it cannot be said that the conviction or death sentence resulted from a breakdown in the adversary process that renders the result unreliable.'
const BRANDENBURG = 'BRANDENBURG v. OHIO.\n395 U.S. 444 (1969)\nPER CURIAM.\nThese later decisions have fashioned the principle that the constitutional guarantees of free speech and free press do not permit a State to forbid or proscribe advocacy of the use of force or of law violation except where such advocacy is directed to inciting or producing imminent lawless action and is likely to incite or produce such action.'
const MIRANDA = 'MIRANDA v. ARIZONA.\n384 U.S. 436 (1966)\nMr. Chief Justice WARREN delivered the opinion of the Court.\nPrior to any questioning, the person must be warned that he has a right to remain silent, that any statement he does make may be used as evidence against him, and that he has a right to the presence of an attorney, either retained or appointed. The defendant may waive effectuation of these rights, provided the waiver is made voluntarily, knowingly and intelligently.'
const CELOTEX = 'CELOTEX CORP. v. CATRETT, ADMINISTRATRIX OF THE ESTATE OF CATRETT.\n477 U.S. 317 (1986)\nJUSTICE REHNQUIST delivered the opinion of the Court.\nIn our view, the plain language of Rule 56(c) mandates the entry of summary judgment, after adequate time for discovery and upon motion, against a party who fails to make a showing sufficient to establish the existence of an element essential to that party\'s case, and on which that party will bear the burden of proof at trial.\nThe judgment sought shall be rendered forthwith if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to a judgment as a matter of law.'

const BROWN = { cite: '347 U.S. 483', case_name: 'Brown v. Board of Education' }
const MARB = { cite: '5 U.S. 137', case_name: 'Marbury v. Madison' }
const one = (c: Citation, sources: OpinionSources, opts: Record<string, unknown> = R): LegalVerdict => verifyCitations([c], sources, opts)
const claim = (c: Citation, sources: OpinionSources) => one(c, sources).claims[0]!

// ── the caption ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.3.0 binds a text by its caption, never by a mention in its body', () => {
  it('Cooper v. Aaron\'s text, which cites Brown and Marbury, is not bound to either: it says what the text is', () => {
    const quote = 'Our constitutional ideal of equal justice under law is thus made a living truth.'
    const before = verifyCitations([{ id: 'w2', ...BROWN, quote }], { [BROWN.cite]: COOPER }, { now: NOW, ruleset: 'legal@0.2.0' })
    expect(before.claims[0]!.outcome).toBe('PASS') // the hole an outside reviewer found, under 0.2.0
    const v = one({ id: 'w2', ...BROWN, quote }, { [BROWN.cite]: COOPER })
    const c = v.claims[0]!
    expect([c.outcome, c.insufficiency?.reason, c.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', 'REFERENCE_NOT_PROVIDED', ['cite', 'case_name']])
    expect(c.insufficiency!.detail).toMatch(/^the supplied text is Cooper v\. Aaron, 358 U\.S\. 1 \(its caption\); it cites Brown v\. Board of Education, 347 U\.S\. 483 but is not that opinion\. Not named in its caption: the reporter citation 347 U\.S\. 483; the party Brown\./)
    expect(c.explanation).toBe('Brown v. Board of Education: the supplied text is Cooper v. Aaron, 358 U.S. 1 by its caption, not Brown v. Board of Education, 347 U.S. 483; the quotation was not checked.')
    expect(v.remedies!.map(r => r.detail)).toEqual([LEGAL_REMEDIES_V030_UNBOUND.abstain![0]!.detail.replace('{field}', '347 U.S. 483')])
    expect(v.opinion_sources![0]!.names[0]).toMatchObject({ by: 'caption', caption: { name: 'Cooper v. Aaron', cite: '358 U.S. 1' }, mentioned: true, bound: false })
    const w3 = claim({ id: 'w3', cite: '1 Cranch 137', case_name: 'Marbury v. Madison', quote: 'the federal judiciary is supreme in the exposition of the law of the Constitution' }, { '1 Cranch 137': COOPER })
    expect(w3.insufficiency!.detail).toMatch(/^the supplied text is Cooper v\. Aaron, 358 U\.S\. 1 \(its caption\); it cites Marbury v\. Madison, 1 Cranch 137 but is not that opinion\./)
  })
  it('the same text binds to its own cite and passes its own words, "verbatim": the same words in the same case', () => {
    const c = claim({ id: 'q2', cite: '358 U.S. 1', case_name: 'Cooper v. Aaron', quote: 'Our constitutional ideal of equal justice under law is thus made a living truth.' }, { '358 U.S. 1': COOPER })
    expect([c.outcome, c.explanation]).toEqual(['PASS', 'The quotation appears verbatim in the opinion text supplied for Cooper v. Aaron: the same words, in the same letter case.'])
  })
  it('the caption: a wrapped name block, a slip opinion\'s lone "v." and "Cite as" line, an initialism, and never a prose line', () => {
    const wrapped = 'COOPER et al., MEMBERS OF THE BOARD OF DIRECTORS OF THE LITTLE ROCK, ARKANSAS,\nINDEPENDENT SCHOOL DISTRICT, et al. v. AARON et al.\n358 U.S. 1 (1958)\n' + 'x'.repeat(500)
    expect(captionOf(wrapped)).toMatchObject({ name: 'Cooper v. Aaron', cite: '358 U.S. 1' })
    const slip = '(Slip Opinion)\nOCTOBER TERM, 2022\nSyllabus\nNOTE: Where it is feasible, a syllabus (headnote) will be released, as is being done in connection with this case, at the time the opinion is issued. The syllabus constitutes no part of the opinion of the Court. See United States v. Detroit Timber & Lumber Co., 200 U. S. 321, 337.\nSUPREME COURT OF THE UNITED STATES\nAXON ENTERPRISE, INC., ET AL., PETITIONERS\nv.\nFEDERAL TRADE COMMISSION, ET AL.\n' + 'y'.repeat(500) + '\nCite as: 598 U. S. ____ (2023)\n'
    expect(captionOf(slip)).toMatchObject({ name: 'Axon Enterprise v. Federal Trade Commission', cite: '598 U. S. ____' })
    expect(captionNamingOf('c', { cite: '598 U.S. 175', case_name: 'Axon Enterprise, Inc. v. FTC' }, slip)).toMatchObject({ bound: true, cite: { found: true, form: 'slip' }, parties: [{ found: 'Axon' }, { found: 'FTC (FEDERAL TRADE COMMISSION)' }] })
    // the syllabus note cites Detroit Timber: a prose line is never caption, so that case is not bound to Axon's text
    expect(captionNamingOf('c', { cite: '200 U.S. 321', case_name: 'United States v. Detroit Timber & Lumber Co.' }, slip)).toMatchObject({ bound: false, mentioned: true })
    expect(captionOf('Makarova v. United States, 201 F.3d 110 (2d Cir. 2000). The FTCA waives the government\'s sovereign immunity only for claims. '.repeat(5))).toBeUndefined() // one long line: no caption
    expect(captionOf('CELOTEX CORP. v. CATRETT, ADMINISTRATRIX.\n477 U.S. 317 (1986)\n')!.name).toBe('Celotex Corp. v. Catrett')
  })
  it('a text with no caption is never bound, even when its body names the citation', () => {
    const body = `Mr. Chief Justice MARSHALL delivered the opinion of the Court.\nThe question was settled long ago, in Marbury v. Madison, 5 U.S. 137, and it is settled still. ${'The parties do not dispute the record. '.repeat(10)}\nIt is emphatically the province and duty of the judicial department to say what the law is.`
    const c = claim({ id: 'x', ...MARB, quote: 'It is emphatically the province and duty of the judicial department to say what the law is.' }, { [MARB.cite]: body })
    expect(c.insufficiency!.detail).toMatch(/^the supplied text has no caption \(the case name and reporter citation a reporter prints, on their own lines at its top\), so it cannot be bound to Marbury v\. Madison, 5 U\.S\. 137; its body names Marbury v\. Madison, 5 U\.S\. 137, but a text is bound only by its caption\./)
    // a short first line that introduces a quotation (it ends with a colon) is not a caption
    expect(captionOf(`As held in Marbury v. Madison, 5 U.S. 137:\n${'z'.repeat(450)}`)).toBeUndefined()
  })
  it('the caption check is linear: a long run of capitals after a number does not stall it', () => {
    const t0 = Date.now()
    captionOf(`1 ${'A'.repeat(300)} x\n2 ${'B '.repeat(150)}x\n`)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

// ── parties only ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.3.0: a text bound by parties only is checked and left open, never PASS', () => {
  const quote = 'It is emphatically the province and duty of the judicial department to say what the law is.'
  it('the quotation found in it abstains with the passage as evidence; the verdict is PASS_WITH_OPEN or INSUFFICIENT_DATA', () => {
    const v = verifyCitations([{ id: 'p1', ...MARB, quote }, { id: 'ok', cite: '358 U.S. 1', case_name: 'Cooper v. Aaron', quote: 'Our constitutional ideal of equal justice under law is thus made a living truth.' }],
      { [MARB.cite]: { text: MARBURY_NOCITE, bind: 'parties' }, '358 U.S. 1': COOPER }, R)
    const c = v.claims[0]!
    expect([c.outcome, c.locked, c.insufficiency?.reason, c.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', false, 'REFERENCE_NOT_PROVIDED', ['cite']])
    expect(c.evidence.map(e => e.role)).toEqual(['QUOTE', 'REFERENCE'])
    expect(c.insufficiency!.detail).toMatch(/^bound by parties only: the quoted words appear in the opinion text supplied for Marbury v\. Madison, but its caption names the parties of Marbury v\. Madison and not the reporter citation 5 U\.S\. 137/)
    expect(c.explanation).toBe('Marbury v. Madison: the quoted words are in the supplied text, but it is bound by parties only (its caption does not print the reporter citation 5 U.S. 137); not certified.')
    expect([v.outcome, v.gate_status]).toEqual(['PASS', 'PASS_WITH_OPEN'])
    expect(v.remedies!.filter(r => r.claims.includes('cite.p1')).map(r => r.detail)).toEqual(LEGAL_REMEDIES_V030_PARTIES_ONLY.abstain!.map(s => s.detail.replace('{field}', '5 U.S. 137')))
    expect(v.opinion_sources!.find(p => p.key === MARB.cite)!.names[0]).toMatchObject({ tier: 'parties-only', note: PARTIES_ONLY_NOTE_V030, by: 'caption' })
    expect(v.choices).toEqual([expect.objectContaining({ id: 'binding:5 U.S. 137', status: 'stated', value: 'parties', load_bearing: true, detail: expect.stringMatching(/left open, never certified/) })])
    const alone = one({ id: 'p1', ...MARB, quote }, { [MARB.cite]: { text: MARBURY_NOCITE, bind: 'parties' } })
    expect([alone.outcome, alone.gate_status]).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'])
  })
  it('a text whose caption is another case is not bound by parties either (Cooper keyed for Marbury)', () => {
    const c = claim({ id: 'q3', ...MARB, source_key: 'Marbury v. Madison', quote: 'the federal judiciary is supreme in the exposition of the law of the Constitution' }, { 'Marbury v. Madison': { text: COOPER, bind: 'parties' } })
    expect(c.insufficiency!.detail).toMatch(/^the supplied text is Cooper v\. Aaron, 358 U\.S\. 1 \(its caption\)/)
  })
  it('the verb exits 2 and its headline counts the citations bound by parties only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-030-'))
    const src = join(dir, 'opinions'); mkdirSync(src)
    writeFileSync(join(src, '5 U.S. 137.txt'), MARBURY_NOCITE)
    const brief = join(dir, 'brief.json'); writeFileSync(brief, JSON.stringify([{ id: 'p1', ...MARB, quote }]))
    // 2026-10-05: the report is on stderr (the one stream rule); can't tell is counted in those words
    let out = ''
    const io = { out: () => {}, err: (s: string) => { out += s }, now: NOW }
    expect(runCitations([brief, '--sources', src, '--bind', 'parties', '--ruleset', 'legal@0.3.0'], io)).toBe(2)
    expect(out).toMatch(/for cite\.p1: its caption reads Marbury v\. Madison; BOUND BY PARTIES ONLY \(bind "parties"; the caption does not print the reporter citation\): not certified/)
    expect(out).toMatch(/\nverdict: INSUFFICIENT_DATA: no citation could be checked \(0 pass, 0 fail, 1 can't tell; 1 bound by parties only, not certified\); verdict_id /)
    out = ''
    expect(runCitations([brief, '--sources', src, '--bind', 'parties', '--ruleset', 'legal@0.2.0'], io)).toBe(0) // 0.2.0 recorded PASS; the headline still names it
    expect(out).toMatch(/\(1 pass, 0 fail, 0 can't tell; 1 bound by parties only, the reporter citation not in the text\)/)
  })
})

// ── conditions at the edges ──────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.3.0 reads what an edge ellipsis or an opening capital cuts from the sentence, and a set-off phrase of time', () => {
  const cases: [string, Citation, string, RegExp][] = [
    ['trailing ellipsis drops "except where"', { id: 'e1', cite: '395 U.S. 444', case_name: 'Brandenburg v. Ohio', quote: 'the constitutional guarantees of free speech and free press do not permit a State to forbid or proscribe advocacy of the use of force or of law violation . . . .' }, BRANDENBURG,
      /^elided condition: the quotation closes with an ellipsis that leaves out the rest of its sentence in the opinion text supplied for Brandenburg v\. Ohio, "except where such advocacy .*", which carries "except"/],
    ['trailing ellipsis drops "provided"', { id: 'e5', cite: '384 U.S. 436', case_name: 'Miranda v. Arizona', quote: 'The defendant may waive effectuation of these rights . . . .' }, MIRANDA, /which carries "provided"/],
    ['leading ellipsis drops "Unless"', { id: 'e3b', cite: '466 U.S. 668', case_name: 'Strickland v. Washington', quote: '... it cannot be said that the conviction or death sentence resulted from a breakdown in the adversary process' }, STRICKLAND,
      /^elided condition: the quotation opens with an ellipsis that leaves out the start of its sentence in the opinion text supplied for Strickland v\. Washington, "Unless a defendant makes both showings,", which carries "Unless"/],
    ['bracketed capital drops "Unless"', { id: 'e3', cite: '466 U.S. 668', case_name: 'Strickland v. Washington', quote: '[I]t cannot be said that the conviction or death sentence resulted from a breakdown in the adversary process that renders the result unreliable.' }, STRICKLAND,
      /^elided condition: the quotation opens with a bracketed capital, which presents its words as the start of a sentence, but in the opinion text supplied for Strickland v\. Washington they follow "Unless a defendant makes both showings,"/],
    ['ellipsis omits "after adequate time for discovery and upon motion"', { id: 'e2', cite: '477 U.S. 317', case_name: 'Celotex Corp. v. Catrett', quote: 'the plain language of Rule 56(c) mandates the entry of summary judgment . . . against a party who fails to make a showing sufficient to establish the existence of an element essential to that party\'s case' }, CELOTEX,
      /^elided condition: the quotation's ellipsis omits ", after adequate time for discovery and upon motion," from the opinion text supplied for Celotex Corp\. v\. Catrett, which carries "after"/],
  ]
  for (const [name, c, text, detail] of cases) {
    it(`${name}: abstains as an elided condition (0.2.0 passed it)`, () => {
      expect(verifyCitations([c], { [c.cite!]: text }, { now: NOW, ruleset: 'legal@0.2.0' }).claims[0]!.outcome).toBe('PASS')
      const x = claim(c, { [c.cite!]: text })
      expect([x.outcome, x.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'SELECTIVE_QUOTE'])
      expect(x.insufficiency!.detail).toMatch(detail)
      expect(x.explanation).toMatch(/elided condition/)
    })
  }
  it('a benign list ellipsis still passes; a bracketed capital after a clause with no condition passes; "if any" still abstains', () => {
    const m = (quote: string) => claim({ id: 'm', cite: '384 U.S. 436', case_name: 'Miranda v. Arizona', quote }, { '384 U.S. 436': MIRANDA })
    expect(m('Prior to any questioning, the person must be warned that he has a right to remain silent . . . and that he has a right to the presence of an attorney').outcome).toBe('PASS')
    expect(m('[T]he person must be warned that he has a right to remain silent').outcome).toBe('PASS')
    const e4 = claim({ id: 'e4', cite: '477 U.S. 317', case_name: 'Celotex Corp. v. Catrett', quote: 'The judgment sought shall be rendered forthwith if the pleadings, depositions, answers to interrogatories, and admissions on file . . . show that there is no genuine issue as to any material fact' }, { '477 U.S. 317': CELOTEX })
    expect(e4.insufficiency?.detail).toMatch(/^elided condition: .*which carries "if"/)
  })
  it('the sentence boundary: an abbreviation does not end the sentence; a heading line does', () => {
    const t = 'SMITH v. JONES.\n1 F.4th 1 (2026)\nBACKGROUND\nThe rule in Smith v. U.S. Steel Corp. applies only where the parties agree, and the agency may not enlarge it . . .'
    const c = claim({ id: 's', cite: '1 F.4th 1', case_name: 'Smith v. Jones', quote: 'the agency may not enlarge it . . . .' }, { '1 F.4th 1': t })
    expect(c.outcome).toBe('PASS') // nothing after it in its sentence
    const lead = claim({ id: 's2', cite: '1 F.4th 1', case_name: 'Smith v. Jones', quote: '... the agency may not enlarge it' }, { '1 F.4th 1': t })
    expect(lead.insufficiency?.detail).toMatch(/"The rule in Smith v\. U\.S\. Steel Corp\. applies only where the parties agree, and", which carries "only"/)
  })
})

// ── letter case ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.3.0 compares letter case', () => {
  const c = (quote: string) => claim({ id: 'k', ...MARB, quote }, { [MARB.cite]: MARBURY })
  it('an ALL-CAPS quotation of words the text has in lower case abstains, naming the case change', () => {
    const x = c('THE PROVINCE AND DUTY OF THE JUDICIAL DEPARTMENT')
    expect([x.outcome, x.insufficiency?.reason]).toEqual(['INSUFFICIENT_DATA', 'SELECTIVE_QUOTE'])
    expect(x.insufficiency!.detail).toMatch(/^case change: the quotation writes "THE PROVINCE AND DUTY OF THE JUDICIAL DEPARTMENT" where the opinion text supplied for Marbury v\. Madison reads "the province and duty of the judicial department"; the words match, but not as written\./)
    expect(verifyCitations([{ id: 'k', ...MARB, quote: 'THE PROVINCE AND DUTY OF THE JUDICIAL DEPARTMENT' }], { [MARB.cite]: MARBURY }, { now: NOW, ruleset: 'legal@0.2.0' }).claims[0]!.explanation).toMatch(/verbatim/) // 0.2.0's wording, kept
  })
  it('a disclosed change passes with the note; a first letter passes with the note; only an exact match is "verbatim"', () => {
    expect(c('THE PROVINCE AND DUTY OF THE JUDICIAL DEPARTMENT (emphasis added)').explanation).toMatch(/letter case differs from the text's, disclosed by the parenthetical/)
    const first = c('it is emphatically the province and duty of the judicial department to say what the law is.')
    expect([first.outcome, first.explanation]).toEqual(['PASS', 'The quotation appears in the opinion text supplied for Marbury v. Madison, read with the quotation conventions it uses: the case of its first letter differs from the text\'s.'])
    expect(c('the province and duty of the Judicial Department').outcome).toBe('INSUFFICIENT_DATA')
    expect(c('the province and duty of the judicial department').explanation).toMatch(/verbatim .*: the same words, in the same letter case\.$/)
  })
})

// ── versions, remedies, replay ───────────────────────────────────────────────────────────────────────────────────────────

describe('legal@0.3.0: versions, remedies, replay, and the named passage', () => {
  it('its remedy tables are well formed; its verdicts replay byte for byte; its id differs from 0.2.0\'s for the same inputs', () => {
    for (const [n, t] of [['0.3.0', LEGAL_REMEDIES_V030], ['unbound', { CITE_VERBATIM: LEGAL_REMEDIES_V030_UNBOUND }], ['parties-only', { CITE_VERBATIM: LEGAL_REMEDIES_V030_PARTIES_ONLY }]] as const) {
      expect(remedyTableProblems(t, `legal ${n}`), n).toEqual([])
    }
    const inputs = { citations: [{ id: 'a', ...BROWN, quote: 'Our constitutional ideal of equal justice under law is thus made a living truth.' }, { id: 'b', ...MARB, quote: 'It is emphatically the province and duty of the judicial department to say what the law is.' }],
      sources: { [BROWN.cite]: COOPER, [MARB.cite]: { text: MARBURY_NOCITE, bind: 'parties' as const } } }
    const v = verifyCitations(inputs.citations, inputs.sources, R)
    expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    const old = verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.2.0' })
    expect(old.verdict_id).not.toBe(v.verdict_id)
    expect(verifyReplay(old, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    expect(old.claims.map(c => c.outcome)).toEqual(['PASS', 'PASS']) // 0.2.0's answers stand for its verdicts
  })
  it('a named passage starts at a sentence boundary, not on the tail of the sentence before ("appeals. But Cochran …")', () => {
    const axon = 'AXON ENTERPRISE, INC. v. FEDERAL TRADE COMMISSION ET AL.\nCite as: 598 U. S. ____ (2023)\nAnd the statutes at issue in this case provide for judicial review of adverse SEC and FTC actions in a court of appeals. But Cochran and Axon assert a “here-and-now injury” from being subjected to an illegitimate proceeding, led by an illegitimate decisionmaker. Seila Law LLC v. Consumer Financial Protection Bureau, 591 U. S. ___, ___.'
    const x = claim({ id: 'kb', cite: '598 U.S. 175', case_name: 'Axon Enterprise, Inc. v. FTC', quote: 'Cochran and Axon assert a here-and-now injury from being subjected to an illegitimate proceeding, led by an unaccountable decisionmaker' }, { '598 U.S. 175': axon })
    expect(x.outcome).toBe('FAIL')
    expect(String(x.computation?.operands.opinion_says)).toMatch(/^But Cochran and Axon assert/)
  })
})
