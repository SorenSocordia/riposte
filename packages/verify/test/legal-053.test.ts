/**
 * legal@0.5.3, the default for a new legal verdict: the cases two cold reviews found (test/fixtures/legal-cold-review-2026-10-12/ and
 * -2026-10-06/, each a legal-operations reader's own briefs and opinion texts; an AI agent in that role, not a person). The texts are
 * mock-ups; they test the check's mechanics, not the law.
 *   1. a separate opinion's designation with a join clause ("with whom Justice GINSBURG joins except as to Part IV, dissenting.") starts
 *      a separate opinion, so its words are never passed as the majority's; a line shaped like a designation always does;
 *   2. a lead-in is read with its verb's inflections and the words after it ("urges us to", "would have us", "According to Bravo,", "In
 *      Bravo's view,", "We are told that", "Under the rule Bravo proposes,"), and the sentences after a sentence that introduces another's
 *      view are that view's until the court speaks again; a whole-sentence PASS prints the sentence before it;
 *   3. a quotation inside the opinion's own quotation of another source PASSes only with a notice naming the source, and FAILs when the
 *      court's next words reject it; an enumerated holding of another court ("held (1) that …, and (2) that") is reported speech;
 *   4. a running header's line of parallel citations is read by its shape ("75 USLW 4337", "2007-1 Trade Cases P 75,709");
 *   5. "(citations omitted)" excuses a citation clause inside the sentence too ("…, ibid.; Sanjuan v. …, a plaintiff's …");
 *   6. a FAIL never rests on words shaped like a citation or a page's running header alone, and its remedy names what differs;
 *   7. "we do not require …, but only enough facts …": a negation does not reach past "but".
 * legal@0.5.2 and every earlier rule answer as before (the last block, legal-052.test.ts and the rest).
 */
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCitations, defaultLegalRuleset, type Citation, type LegalVerdict, type OpinionSources } from '../src/legal/index'
import { loadOpinionFolder, readCitationsFile } from '../src/legal/cli-citations'
import { furnitureMarksOf } from '../src/legal/quotation'
import { sectionsOf } from '../src/legal/sections'
import type { ClaimVerdict } from '../src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const F8 = join(HERE, 'fixtures', 'legal-cold-review-2026-10-12')
const F7 = join(HERE, 'fixtures', 'legal-cold-review-2026-10-06')
const NOW = (): Date => new Date('2026-10-13T00:00:00Z')

const runFolder = (brief: string, dir: string, ruleset?: string): LegalVerdict =>
  verifyCitations(readCitationsFile(brief), loadOpinionFolder(dir), { now: NOW, ...(ruleset !== undefined ? { ruleset } : {}) })
/** A claim with the text of the verdict's remedies that answer it (remedies sit on the verdict, each naming its claims). */
type Claim = ClaimVerdict & { remedyText: string }
const withRemedies = (v: LegalVerdict, c: ClaimVerdict): Claim => ({ ...c, remedyText: (v.remedies ?? []).filter(r => (r.claims ?? []).includes(c.claim_id)).map(r => r.detail).join(' ') })
const byId = (v: LegalVerdict): Record<string, Claim> => Object.fromEntries(v.claims.map(c => [c.claim_id.replace(/^cite\./, ''), withRemedies(v, c)]))
const said = (c: ClaimVerdict): string => `${c.explanation} ${c.insufficiency?.detail ?? ''}`
const remedyText = (c: Claim): string => c.remedyText

const brief1 = (r?: string) => byId(runFolder(join(F8, 'brief1.json'), join(F8, 'opinions'), r))
const brief2 = (r?: string) => byId(runFolder(join(F8, 'brief2.json'), join(F8, 'opinions2'), r))
const brief3 = (r?: string) => byId(runFolder(join(F8, 'brief3.json'), join(F8, 'opinions3'), r))
const desig7 = (r?: string) => byId(runFolder(join(F7, 'desig', 'brief.json'), join(F7, 'desig'), r))
const probe7 = (r?: string) => byId(runFolder(join(F7, 'probe', 'brief.json'), join(F7, 'probe'), r))
const main7 = (r?: string) => byId(runFolder(join(F7, 'brief.json'), join(F7, 'opinions'), r))

/** One text, one quotation. */
const one = (text: string, quote: string, extra: Partial<Citation> = {}, ruleset?: string): Claim => {
  const sources: OpinionSources = { '901 F.4th 1': { text, source: 'mock-up' } }
  const c: Citation = { id: 'q', cite: '901 F.4th 1', case_name: 'Acme Supply Co. v. Bravo Holdings, Inc.', quote, ...extra }
  const v = verifyCitations([c], sources, { now: NOW, ...(ruleset !== undefined ? { ruleset } : {}) })
  return withRemedies(v, v.claims[0]!)
}
const CAPTION = 'ACME SUPPLY CO. v. BRAVO HOLDINGS, INC.\n901 F.4th 1 (7th Cir. 2026)\nEASTERBROOK, Circuit Judge:\n'

describe('legal@0.5.3 is the default for a new verdict', () => {
  it('this build issues legal@0.5.3 when no rule is named; engines 0.6.0 and 0.7.0 keep legal@0.5.2; legal@0.5.3 needs engine 0.7.1', () => {
    // 2026-10-14: legal@0.5.4 becomes this build's default with the engine that ships it (src/legal/index.ts V054_DEFAULT_ENGINE); 0.7.1 keeps 0.5.3
    expect(['0.5.3', '0.5.4']).toContain(defaultLegalRuleset().version)
    expect(defaultLegalRuleset('0.7.1').version).toBe('0.5.3')
    expect(defaultLegalRuleset('0.7.0').version).toBe('0.5.2')
    expect(defaultLegalRuleset('0.6.0').version).toBe('0.5.2')
    const c: Citation = { id: 'a', cite: '601 U.S. 1', case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.', quote: 'x' }
    expect(verifyCitations([c], {}, { now: NOW, engine: '0.7.0' }).ruleset.version).toBe('0.5.2')
    expect(() => verifyCitations([c], {}, { now: NOW, engine: '0.7.0', ruleset: 'legal@0.5.3' })).toThrow(/legal@0\.5\.3 needs engine 0\.7\.1 or later/)
    expect(runFolder(join(F8, 'brief3.json'), join(F8, 'opinions3')).ruleset).toEqual({ id: 'legal', version: '0.5.4', domain: 'legal' }) // the default from engine 0.7.2 (2026-10-14)
  })
})

describe('1. a separate opinion\'s designation with a join clause', () => {
  // the eight designation styles of the 2026-10-12 review, each text a majority and then one separate opinion
  const NAMES: Record<string, string> = {
    A: 'Justice Stevens\'s dissent',
    B: 'Justice Thomas\'s opinion concurring in part and dissenting in part',
    C: 'Justice Alito\'s dissent',
    D: 'Justice Kennedy\'s opinion concurring in part and concurring in the judgment',
    E: 'Judge Smith\'s opinion concurring in part and dissenting in part',
    F: 'Justice Breyer\'s dissent',
    G: 'Justice Ginsburg\'s dissent',
    H: 'Justice Scalia\'s opinion concurring in part and concurring in the judgment',
  }

  it('the separate opinion\'s words answer can\'t tell, naming the opinion, in all eight styles (0.5.2 passed A, B and C as the majority\'s)', () => {
    const v = brief3()
    for (const [k, name] of Object.entries(NAMES)) {
      const c = v[`desig-${k}`]!
      expect(c.outcome, k).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, k).toBe('SPAN_NOT_FOUND')
      expect(said(c), k).toContain(`whose words: the quoted words appear in ${name}`)
      expect(said(c), k).not.toMatch(/Found in the majority opinion/)
    }
  })

  it('in every style the majority\'s words PASS, and the separate opinion\'s words PASS under a parenthetical that names it', () => {
    for (const [k, name] of Object.entries(NAMES)) {
      const vol = 601 + 'ABCDEFGH'.indexOf(k)
      const sources = loadOpinionFolder(join(F8, 'opinions3'))
      const author = name.replace(/^(?:Justice|Judge) /, '').replace(/'s .*$/, '')
      const role = /dissent$/.test(name) ? 'dissenting' : /dissenting in part/.test(name) ? 'concurring in part and dissenting in part' : 'concurring'
      const v = verifyCitations([
        { id: 'maj', cite: `${vol} U.S. 1, 3 (2020)`, case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.', quote: 'A party who fails to move within that period forfeits the objection.' },
        { id: 'sep', cite: `${vol} U.S. 1, 9 (2020) (${author}, J., ${role})`, case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.', quote: `the period should run from the date the party learns of the arbitrator's undisclosed conflict, style ${k}` },
      ], sources, { now: NOW })
      const [maj, sep] = v.claims
      expect(maj!.outcome, k).toBe('PASS')
      expect(maj!.explanation, k).toMatch(/Found in the majority opinion, line 7/)
      expect(sep!.outcome, `${k}: ${sep!.explanation}`).toBe('PASS')
      expect(sep!.explanation, k).toContain(`Found in ${name}, as the citation says`)
    }
  })

  it('the earlier review\'s five styles (DS1 to DS5) all answer can\'t tell (0.5.2 passed DS1, DS4 and DS5)', () => {
    const v = desig7()
    for (const id of ['DS1', 'DS2', 'DS3', 'DS4', 'DS5']) {
      expect(v[id]!.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(said(v[id]!), id).toMatch(/whose words: the quoted words appear in Justice \w+'s /)
    }
  })

  it('Twombly\'s own designation: the Stevens dissent quoted as the holding answers can\'t tell (brief T06; 0.5.2: "Found in the majority opinion")', () => {
    const c = brief1()['T06-b-dissent-as-holding']!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toContain('whose words: the quoted words appear in Justice Stevens\'s dissent')
    const v2 = brief2()
    expect(v2['V1-dissent-plain-designation']!.outcome).toBe('INSUFFICIENT_DATA')
    expect(v2['V1b-dissent-with-whom']!.outcome).toBe('INSUFFICIENT_DATA')
  })

  it('a designation in a form no list names still ends the majority: who wrote it, then the role, on a short line of its own', () => {
    const forms = [
      'Justice ROE, with whom Justice DOE joins all but footnote 3 and Part II-C, dissenting.',
      'JUSTICE ROE, joined by JUSTICE DOE, dissenting.',
      'Justice ROE, with whom Justice DOE joins in all but Part III, concurring in the judgment.',
      'ROE, Circuit Judge, joined by DOE and POE, Circuit Judges, dissenting:',
    ]
    for (const d of forms) {
      const text = `${CAPTION}The claim accrued when the goods were tendered.\nAFFIRMED.\n\n${d}\nIn my view the claim accrued at breach.\n`
      const c = one(text, 'the claim accrued at breach')
      expect(c.outcome, d).toBe('INSUFFICIENT_DATA')
      expect(said(c), d).toMatch(/whose words: the quoted words appear in (?:Justice|Judge) Roe's/)
      expect(sectionsOf(text, { v051: true, v052: true, v053: true } as never).sections.map(s => s.kind), d).toEqual(['header', 'majority', 'separate'])
    }
  })

  it('a sentence of the majority that mentions a dissent does not start one', () => {
    const text = `${CAPTION}The Court of Appeals affirmed over a lengthy objection, with Judge Smith, joined by Judge Jones, dissenting.\nThe claim accrued when the goods were tendered.\n`
    const c = one(text, 'The claim accrued when the goods were tendered.')
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/Found in the majority opinion/)
  })
})

describe('2. a lead-in, with its verb\'s inflections and the words after it', () => {
  it('the earlier review\'s twelve lead-ins answer can\'t tell; the court\'s own holding passes (0.5.2 passed seven)', () => {
    const v = probe7()
    for (const id of ['L01_asks_us_to_hold', 'L02_district_court_concluded', 'L03_would_have_us', 'L04_magistrate_found', 'L05_according_to', 'L06_position_is', 'L07_some_courts_held', 'L08_in_view', 'L09_insists', 'L10_we_are_told', 'L11_dissent_would_hold', 'L12_rule_proposes']) {
      expect(v[id]!.outcome, `${id}: ${v[id]!.explanation}`).toBe('INSUFFICIENT_DATA')
      expect(v[id]!.insufficiency?.reason, id).toBe('SELECTIVE_QUOTE')
    }
    expect(v['L13_control_holding']!.outcome).toBe('PASS')
    expect(said(v['L05_according_to']!)).toMatch(/According to Bravo/)
    expect(said(v['L08_in_view']!)).toMatch(/In Bravo's view/)
  })

  it('"Rotkiske urges us to read …" answers can\'t tell (the earlier review\'s R03; "urges" is listed and 0.5.2 passed it)', () => {
    const c = main7()['R03_party_urges']!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toMatch(/urges us to/)
  })

  it('the court\'s own voice is not held: "In our view,", "According to the statute,", "Under the rule we adopt today,", "Our position is that"', () => {
    for (const lead of ['In our view, ', 'According to the statute, ', 'Under the rule we adopt today, ', 'Our position is that ', 'We conclude that ']) {
      const text = `${CAPTION}${lead}the claim accrued when the goods were tendered.\n`
      expect(one(text, 'the claim accrued when the goods were tendered.').outcome, lead).toBe('PASS')
    }
  })

  it('the sentence after "In his view, …" is his view until the court speaks again (R01: 0.5.2 passed it "verbatim")', () => {
    const c = brief1()['R01-b-argument-in-prior-sentence']!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toMatch(/In his view, the general discovery rule should apply/)
    expect(said(c)).toMatch(/not the court's/)
    expect(said(c)).not.toMatch(/verbatim/)
  })

  it('the view ends where the court speaks again ("We disagree.") or a paragraph ends', () => {
    const text = `${CAPTION}Bravo's position is different. In Bravo's view, the clause is void. The contract was never signed. We disagree. The contract was signed on May 1.\n\nThe guaranty is continuing.\n`
    const held = one(text, 'The contract was never signed.')
    expect(held.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(held)).toMatch(/In Bravo's view, the clause is void/)
    const own = one(text, 'The contract was signed on May 1.')
    expect(own.outcome).toBe('PASS')
    expect(own.explanation).toContain('The sentence before it reads: "We disagree."')
    const next = one(`${CAPTION}In Bravo's view, the clause is void.\n\nThe guaranty is continuing.\n`, 'The guaranty is continuing.')
    expect(next.outcome).toBe('PASS')
  })

  it('a sentence that announces a party\'s arguments opens its view too: "Bravo makes two arguments. First, …" (a known limit of 0.5.2)', () => {
    const text = `${CAPTION}Bravo makes two arguments. First, the contract is void. Second, the guaranty lapsed. Neither persuades us.\n`
    const c = one(text, 'First, the contract is void.')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toMatch(/Bravo makes two arguments/)
    expect(one(text, 'First, the contract is void.', {}, 'legal@0.5.2').outcome).toBe('PASS')
  })

  it('a quotation that begins where its sentence begins prints the sentence before it, so a frame the reader does not list is in view', () => {
    expect(brief1()['R03-g-we-hold-that']!.outcome).toBe('PASS')
    const text = `${CAPTION}The contract was signed in 2019. The guaranty is continuing.\n`
    const p = one(text, 'The guaranty is continuing.')
    expect(p.outcome).toBe('PASS')
    expect(p.explanation).toContain('The sentence before it reads: "The contract was signed in 2019."')
  })
})

describe('3. a quotation inside the opinion\'s own quotation of another source', () => {
  it('Conley\'s retired standard, quoted after "relying on Conley\'s statement that", FAILs: the court rejected it (T05; 0.5.2 passed it)', () => {
    const c = brief1()['T05-b-retired-standard-as-holding']!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/the court rejected this standard/)
    expect(c.explanation).toMatch(/Conley/)
    expect(c.explanation).toMatch(/line \d+: "We could go on, but there is no need to pile up further citations/)
    expect(remedyText(c)).not.toMatch(/Conform the quotation/)
    expect(remedyText(c)).toMatch(/rejects/)
  })

  it('the earlier review\'s T04 ("relied on the familiar statement that") FAILs the same way', () => {
    const c = main7()['T04_conley_quoted_to_retire']!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/the court rejected this standard/)
  })

  it('a quotation the court does not reject PASSes with the notice naming its source, and says so when the brief discloses it', () => {
    const text = `${CAPTION}In Smith v. Jones, 10 F.4th 1, 5 (7th Cir. 2020), the Ninth Circuit held that “a waiver must be knowing and voluntary.” We agree.\n`
    const c = one(text, 'a waiver must be knowing and voluntary')
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/a quotation within the opinion, attributed to the Ninth Circuit; the brief should say \(quoting /)
    const d = one(text, 'a waiver must be knowing and voluntary', { cite: '901 F.4th 1 (quoting Smith v. Jones, 10 F.4th 1, 5 (7th Cir. 2020))' })
    expect(d.outcome).toBe('PASS')
    expect(d.explanation).toMatch(/a quotation within the opinion, attributed to the Ninth Circuit, as the citation says/)
  })

  it('another court\'s holding in the enumerated form is reported speech (B02; 0.5.2 passed it as the Court\'s)', () => {
    const c = brief1()['B02-b-lower-court-holding-as-scotus']!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(said(c)).toMatch(/The Supreme Court of South Carolina held \(1\) that/)
    expect(said(c)).toMatch(/another court or tribunal/)
  })

  it('the same words unquoted after "relying on X\'s statement that" are reported speech', () => {
    const text = `${CAPTION}The district court dismissed, relying on Kline's statement that the period runs from receipt. That was error.\n`
    const c = one(text, 'the period runs from receipt')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toMatch(/relying on Kline's statement that/)
  })
})

describe('4. a running header\'s line of parallel citations, read by its shape', () => {
  it('a genuine quotation across a Westlaw page break with "75 USLW 4337, 2007-1 Trade Cases P 75,709" PASSes (T08; 0.5.2 FAILed it)', () => {
    const c = brief1()['T08-g-across-westlaw-page-break']!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toMatch(/a page break's footer and running header read out/)
  })

  it('the earlier review\'s genuine quotation across the same header PASSes (its T01; 0.5.2 FAILed it)', () => {
    const c = main7()['T01_pagebreak_genuine']!
    expect(c.outcome, c.explanation).toBe('PASS')
  })

  it('looseleaf, CCH and slip forms are read next to a vendor line; a citation line standing alone in the opinion is not', () => {
    const footer = '© 2026 Thomson Reuters. No claim to original U.S. Government Works. 7'
    for (const line of ['127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337, 2007-1 Trade Cases P 75,709', '2007-1 Trade Cas. (CCH) ¶ 75,709', '82 Fed. Sec. L. Rep. (CCH) P 94,224, 2007 WL 1461367', '55 U.S.P.Q.2d 1234, 39 Media L. Rep. 1777']) {
      const src = `the profession for 50 years, this famous observation has earned\n${footer}\nBell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)\n${line}\nits retirement.`
      const marks = furnitureMarksOf(src, { v053: true } as never)
      expect(marks.length, line).toBe(1)
      expect(src.slice(marks[0]!.start, marks[0]!.end), line).toContain(line)
    }
    const alone = 'The rule is settled.\n127 S.Ct. 1955, 167 L.Ed.2d 929, 75 USLW 4337\nIt applies here.'
    expect(furnitureMarksOf(alone, { v053: true } as never)).toEqual([])
  })
})

describe('5. "(citations omitted)" over a citation clause', () => {
  it('"…, ibid.; Sanjuan v. American Bd. … (C.A.7 1994), a plaintiff\'s …" is excused (T11 and the variant in the quotation; 0.5.2 FAILed both)', () => {
    const c = brief1()['T11-g-citations-omitted']!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toMatch(/the citation "ibid\.; Sanjuan v\. American Bd\..*" left out, as "\(citations omitted\)" says/)
    const v = brief2()['V2-citations-omitted-in-quote']!
    expect(v.outcome, v.explanation).toBe('PASS')
  })

  it('the same clause left out without saying so FAILs, naming the citation, and the remedy is "(citation omitted)" (T10)', () => {
    const c = brief1()['T10-b-citation-dropped-silently']!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/leaves out the citation "ibid\.; Sanjuan/)
    expect(remedyText(c)).toMatch(/Add "\(citation omitted\)"/)
  })

  it('a clause opening "see", "cf.", "accord", "id." or a case name, and a string of them, is excused; under legal@0.5.2 it FAILs', () => {
    const forms = [
      ', see Twombly, 550 U.S., at 570,',
      ', cf. Smith v. Jones, 1 F.4th 2, 3 (7th Cir. 2021); accord Doe v. Roe, 3 F.4th 4, 5 (9th Cir. 2022),',
      ', id., at 556,',
      ', Kline v. Burns, 12 F.3d 34, 36 (2d Cir. 1990),',
    ]
    for (const f of forms) {
      const text = `${CAPTION}The notice must be written${f} and it must reach the shipper within ten days.\n`
      const c = one(text, 'The notice must be written and it must reach the shipper within ten days.', { cite: '901 F.4th 1 (citation omitted)' })
      expect(c.outcome, `${f}: ${c.explanation}`).toBe('PASS')
      expect(c.explanation, f).toMatch(/left out, as "\(citation omitted\)" says/)
      expect(one(text, 'The notice must be written and it must reach the shipper within ten days.', { cite: '901 F.4th 1 (citation omitted)' }, 'legal@0.5.2').outcome, f).toBe('FAIL')
    }
  })

  it('a period before a small letter ends no sentence: the context after "American Bd." is printed whole (T03)', () => {
    const c = brief1()['T03-?-concessive-cut']!
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/requires more than labels and conclusions/)
  })
})

describe('6. a FAIL never rests on page furniture or a citation alone, and its remedy names what differs', () => {
  it('on the 2026-10-12 brief the genuine T08 and T11 pass, and each remaining FAIL\'s remedy names the alteration', () => {
    const v = brief1()
    expect(v['T08-g-across-westlaw-page-break']!.outcome).toBe('PASS')
    expect(v['T11-g-citations-omitted']!.outcome).toBe('PASS')
    const fails = Object.entries(v).filter(([, c]) => c.outcome === 'FAIL').map(([id]) => id).sort()
    expect(fails).toEqual(['C02-b-condition-dropped-no-ellipsis', 'C10-b-always-to-never', 'D01-b-and-to-or', 'D04-b-shaky-but-to-shaky-and-in', 'T02-b-word-changed', 'T05-b-retired-standard-as-holding', 'T10-b-citation-dropped-silently'])
    const names: Record<string, RegExp> = {
      'T02-b-word-changed': /"must" where the quotation has "need only"/,
      'T05-b-retired-standard-as-holding': /rejects/,
      'T10-b-citation-dropped-silently': /ibid\.; Sanjuan/,
      'C02-b-condition-dropped-no-ellipsis': /after adequate time for discovery and upon motion/,
      'C10-b-always-to-never': /"always" where the quotation has "never"/,
      'D01-b-and-to-or': /"both" where the quotation has "either"/,
      'D04-b-shaky-but-to-shaky-and-in': /the text has "but admissible evidence" where the quotation has "and inadmissible evidence"/,
    }
    for (const id of fails) expect(remedyText(v[id]!), id).toMatch(names[id]!)
  })

  it('a quotation across a bare running header (its footer lost in conversion) answers can\'t tell, never "Conform the quotation"', () => {
    const text = `${CAPTION}After puzzling the profession for 50 years, this famous observation has earned\nBell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)\n127 S.Ct. 1955, 167 L.Ed.2d 929\nits retirement.\n`
    const quote = 'After puzzling the profession for 50 years, this famous observation has earned its retirement.'
    expect(one(text, quote, {}, 'legal@0.5.2').outcome).toBe('FAIL')
    const c = one(text, quote)
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toMatch(/shaped like a citation or a page's running header/)
    expect(remedyText(c)).not.toMatch(/Conform the quotation/)
  })
})

describe('7. the genuine Twombly sentence the earlier review saw held', () => {
  it('"enough facts to state a claim to relief that is plausible on its face" PASSes, its lead-in printed (T17; 0.5.2: a negation the quote omits)', () => {
    const c = main7()['T17_bluebook_pin_genuine']!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('the sentence begins: "Here, we do not require heightened fact pleading of specifics, but only…"')
  })

  it('"not" in the clause before "but" still holds a quotation that begins inside that clause', () => {
    const text = `${CAPTION}We do not hold that the clause is void, but only that it is ambiguous.\n`
    expect(one(text, 'the clause is void').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(text, 'it is ambiguous').outcome).toBe('PASS')
  })
})

describe('legal@0.5.2, named, answers every one of these as before', () => {
  it('the eight styles, the lead-ins, the header, the citation clause, the view and the Twombly sentence', () => {
    const b3 = brief3('legal@0.5.2')
    expect(['A', 'B', 'C'].map(k => b3[`desig-${k}`]!.outcome)).toEqual(['PASS', 'PASS', 'PASS'])
    const b1 = brief1('legal@0.5.2')
    expect(b1['T06-b-dissent-as-holding']!.outcome).toBe('PASS')
    expect(b1['T08-g-across-westlaw-page-break']!.outcome).toBe('FAIL')
    expect(b1['T11-g-citations-omitted']!.outcome).toBe('FAIL')
    expect(b1['T05-b-retired-standard-as-holding']!.outcome).toBe('PASS')
    expect(b1['B02-b-lower-court-holding-as-scotus']!.outcome).toBe('PASS')
    expect(b1['R01-b-argument-in-prior-sentence']!.explanation).toMatch(/verbatim/)
    expect(probe7('legal@0.5.2')['L01_asks_us_to_hold']!.outcome).toBe('PASS')
    expect(main7('legal@0.5.2')['T17_bluebook_pin_genuine']!.outcome).toBe('INSUFFICIENT_DATA')
  })
})
