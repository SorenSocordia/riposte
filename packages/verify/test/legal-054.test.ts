/**
 * legal@0.5.4 (2026-10-14): selectable under this build; the default from the engine that ships it (src/legal/index.ts
 * V054_DEFAULT_ENGINE). The cases two cold reviews found on 2026-10-13 (test/fixtures/legal-cold-review-2026-10-13/: a legal-operations
 * buyer's own briefs, and a ninth review round's; AI agents in those roles, not people). The texts are mock-ups; they test the check's
 * mechanics, not the law.
 *   1. a "(quoting …)" parenthetical written after the quoted words, in the quotation field, is the brief's own: brief3's q1 and q2 PASS as
 *      q3 and brief4's q4 (the parenthetical in the citation field) always did; legal@0.5.3 FAILed them ("the quotation adds "(quoting");
 *   2. an unbracketed change of the first letter's case answers can't tell, naming the bracket to write (d11; legal@0.5.3 passed it);
 *   3. an ellipsis that omits a part of a condition joined by "and" answers can't tell (o4; legal@0.5.3 passed it);
 *   4. four genuine quotations legal@0.5.3 held now PASS: d4, o1 and o6 (a negation before ", and"), d12 (a headnote-marked sentence after
 *      a party's contention); so does o8 (an ellipsis over a whole "not X, but" contrast);
 *   5. six separate-opinion designation styles, and the lead-in "Tamberly's brief states that", answer can't tell (the ninth round's probe,
 *      24 texts; legal@0.5.3 passed 7 of them as the majority's or the court's words);
 *   6. a Westlaw database number ("2025 WL 1188234") binds its caption, so the nine quotations against that opinion are checked (legal@0.5.3
 *      answered "no supplied text matched" for all nine); and L05's genuine quotation after "That rule no longer holds. HN1[ ]" PASSes.
 * legal@0.5.3 and every earlier rule answer as before (the last block; legal-053.test.ts and the rest).
 */
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyCitations, defaultLegalRuleset, resolveLegalRuleset, LEGAL_RULESET_VERSIONS, type Citation, type LegalVerdict, type OpinionSources } from '../src/legal/index'
import { loadOpinionFolder, readCitationsFile } from '../src/legal/cli-citations'
import { sectionsOf } from '../src/legal/sections'
import type { ClaimVerdict } from '../src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const F9 = join(HERE, 'fixtures', 'legal-cold-review-2026-10-13')
const NOW = (): Date => new Date('2026-10-14T00:00:00Z')
const NEW = 'legal@0.5.4'
const OLD = 'legal@0.5.3'

const runFolder = (brief: string, dir: string, ruleset: string): LegalVerdict =>
  verifyCitations(readCitationsFile(brief), loadOpinionFolder(dir), { now: NOW, ruleset })
type Claim = ClaimVerdict & { remedyText: string }
const withRemedies = (v: LegalVerdict, c: ClaimVerdict): Claim => ({ ...c, remedyText: (v.remedies ?? []).filter(r => (r.claims ?? []).includes(c.claim_id)).map(r => r.detail).join(' ') })
const byId = (v: LegalVerdict): Record<string, Claim> => Object.fromEntries(v.claims.map(c => [c.claim_id.replace(/^cite\./, ''), withRemedies(v, c)]))
const said = (c: ClaimVerdict): string => `${c.explanation} ${c.insufficiency?.detail ?? ''}`
const totals = (v: LegalVerdict): string => `${v.coverage.claims_pass}/${v.coverage.claims_fail}/${v.coverage.claims_insufficient}`

const buyer = (brief: string, r: string) => runFolder(join(F9, 'buyer', brief), join(F9, 'buyer', 'opinions'), r)
const tank1 = (r: string) => runFolder(join(F9, 'round9', 'brief1.json'), join(F9, 'round9', 'opinions'), r)
const probe = (r: string) => runFolder(join(F9, 'round9', 'probe', 'brief.json'), join(F9, 'round9', 'probe'), r)
const probeLabels = (): Record<string, string> => JSON.parse(readFileSync(join(F9, 'round9', 'probe', 'labels.json'), 'utf8')) as Record<string, string>

/** One text, one quotation. */
const one = (text: string, quote: string, ruleset = NEW, extra: Partial<Citation> = {}): Claim => {
  const sources: OpinionSources = { '901 F.4th 1': { text, source: 'mock-up' } }
  const c: Citation = { id: 'q', cite: '901 F.4th 1', case_name: 'Acme Supply Co. v. Bravo Holdings, Inc.', quote, ...extra }
  const v = verifyCitations([c], sources, { now: NOW, ruleset })
  return withRemedies(v, v.claims[0]!)
}
const CAPTION = 'ACME SUPPLY CO. v. BRAVO HOLDINGS, INC.\n901 F.4th 1 (7th Cir. 2026)\nEASTERBROOK, Circuit Judge:\n'

describe('legal@0.5.4 can be named under this build; the default moves with the engine that ships it', () => {
  it('is the newest rule, resolves by name, needs engine 0.7.1, and leaves the default where the shipping engine sets it', () => {
    // 2026-10-19: legal@0.5.5 is newer (legal-055.test.ts); legal@0.5.4 is the next
    expect(LEGAL_RULESET_VERSIONS[1]).toEqual({ id: 'legal', version: '0.5.4', domain: 'legal' })
    expect(resolveLegalRuleset(NEW).version).toBe('0.5.4')
    const c: Citation = { id: 'a', cite: '601 U.S. 1', case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.', quote: 'x' }
    expect(verifyCitations([c], {}, { now: NOW, ruleset: NEW }).ruleset).toEqual({ id: 'legal', version: '0.5.4', domain: 'legal' })
    expect(() => verifyCitations([c], {}, { now: NOW, engine: '0.7.0', ruleset: NEW })).toThrow(/legal@0\.5\.4 needs engine 0\.7\.1 or later/)
    // under engines 0.6.0 and 0.7.0 the default is legal@0.5.2, under 0.7.1 legal@0.5.3; this build's default is whichever the engine names
    expect(defaultLegalRuleset('0.7.0').version).toBe('0.5.2')
    expect(defaultLegalRuleset('0.7.1').version).toBe('0.5.3')
    expect(['0.5.3', '0.5.4']).toContain(defaultLegalRuleset().version)
  })
})

describe('1. "(quoting …)" after the quoted words, in the quotation field', () => {
  it('brief3: q1 and q2 PASS with the notice naming the source, as q3 does; legal@0.5.3 FAILed q1 and q2 ("the quotation adds "(quoting")', () => {
    const old = byId(buyer('brief3.json', OLD))
    expect(old.q1!.outcome).toBe('FAIL')
    expect(old.q1!.explanation).toContain('the quotation adds "(quoting')
    expect(old.q2!.outcome).toBe('FAIL')
    expect(old.q3!.outcome).toBe('PASS')
    const v = buyer('brief3.json', NEW)
    expect(totals(v)).toBe('3/0/0')
    const n = byId(v)
    expect(n.q1!.outcome).toBe('PASS')
    expect(n.q1!.explanation).toContain('It is a quotation within the opinion, attributed to United Steelworkers v. Warrior & Gulf Navigation Co., as the citation says (quoting United Steelworkers v. Warrior & Gulf Navigation Co., 363 U.S. 574, 582 (1960))')
    expect(n.q1!.explanation).toContain('read as the brief\'s own, not as the quotation')
    expect(n.q2!.outcome).toBe('PASS')
    expect(n.q2!.explanation).toContain('as the citation says (quoting Warrior & Gulf)')
    expect(n.q3!.outcome).toBe('PASS')
    expect(n.q3!.explanation).toContain('the brief should say (quoting United Steelworkers v. Warrior & Gulf Navigation Co.)')
  })
  it('brief4: the parenthetical in the citation field PASSes under both rules, exit-0 shape', () => {
    for (const r of [OLD, NEW]) {
      const v = buyer('brief4.json', r)
      expect(totals(v), r).toBe('1/0/0')
      expect(v.gate_status ?? v.outcome, r).toBe('PASS')
      expect(byId(v).q4!.explanation, r).toContain('as the citation says (quoting United Steelworkers')
    }
  })
  it('the parenthetical is read only at the end of the quoted words; a quotation that has none reads as before', () => {
    const text = `${CAPTION}"A clause is ambiguous only when it admits two readings." Smith v. Jones, 500 U.S. 1, 5 (1990). We agree.\n`
    const a = one(text, 'A clause is ambiguous only when it admits two readings. (quoting Smith v. Jones, 500 U.S. 1, 5 (1990))')
    expect(a.outcome, a.explanation).toBe('PASS')
    expect(a.explanation).toContain('as the citation says (quoting Smith v. Jones, 500 U.S. 1, 5 (1990))')
    const b = one(text, 'A clause is ambiguous only when it admits two readings.')
    expect(b.outcome).toBe('PASS')
    expect(b.explanation).toContain('the brief should say (quoting Smith v. Jones)')
  })
})

describe('2. an unbracketed change of the first letter\'s case', () => {
  it('d11 ("summary judgment is appropriate only when …" for "Summary judgment …") answers can\'t tell naming "[s]ummary"; legal@0.5.3 passed it', () => {
    const old = byId(buyer('brief.json', OLD)).d11!
    expect(old.outcome).toBe('PASS')
    expect(old.explanation).toContain('the case of its first letter differs from the text\'s')
    const c = byId(buyer('brief.json', NEW)).d11!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(c.insufficiency?.missing).toEqual(['letter_case'])
    expect(said(c)).toContain('writes "summary" where the opinion text supplied for Delacroix Fabrication, Inc. v. Northgate Mut. Ins. Co. reads "Summary"')
    expect(said(c)).toContain('Write the changed letter in brackets ("[s]ummary")')
    expect(c.remedyText).toContain('Write the letter the quotation changes in brackets')
  })
  it('a bracketed first letter ("[T]he district court …", "[a] conclusory affidavit …") and a disclosed change still PASS', () => {
    expect(byId(tank1(NEW))['W11-legit-bracket-case-PASS']!.outcome).toBe('PASS')
    expect(byId(buyer('brief.json', NEW)).d12!.outcome).toBe('PASS')
    const text = `${CAPTION}The clause is ambiguous.\n`
    expect(one(text, 'the clause is ambiguous').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(text, '[t]he clause is ambiguous').outcome).toBe('PASS')
    expect(one(text, 'the clause is ambiguous (emphasis added)').outcome).toBe('PASS')
  })
})

describe('3. an ellipsis that omits a part of a condition joined by "and"', () => {
  it('o4 ("tolled where the injury is inherently unknowable . . . , but" for "… unknowable and the plaintiff is blamelessly ignorant of it, but") answers can\'t tell; legal@0.5.3 passed it', () => {
    expect(byId(buyer('brief.json', OLD)).o4!.outcome).toBe('PASS')
    const c = byId(buyer('brief.json', NEW)).o4!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(said(c)).toContain('omits "and the plaintiff is blamelessly ignorant of it"')
    expect(said(c)).toContain('a part of the condition its sentence states ("where …") that "and" joins to the words kept')
  })
  it('an ellipsis over an "and" clause outside any condition is read as before', () => {
    const text = `${CAPTION}The court considered the contract and the course of dealing, and it found no ambiguity.\n`
    const c = one(text, 'The court considered the contract . . . , and it found no ambiguity.')
    expect(c.outcome, c.explanation).toBe('PASS')
  })
})

describe('4. genuine quotations legal@0.5.3 held', () => {
  it('d4, o1 and o6: a negation before ", and" does not govern the clause after it (legal@0.5.3: "preceded by a negation the quote omits")', () => {
    const old = byId(buyer('brief.json', OLD)), n = byId(buyer('brief.json', NEW))
    for (const id of ['d4', 'o1', 'o6']) {
      expect(old[id]!.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('PASS')
    }
    expect(n.d4!.explanation).toContain('the sentence begins: "A conclusory affidavit that sets out no specific facts does not create a genuine dispute, and…"')
    expect(n.o6!.explanation).toContain('a line-break hyphen in the opinion joined')
  })
  it('a negation before ", and" still governs its own clause; a bare "and", and ", or that" under the same verb, carry it on', () => {
    expect(one(`${CAPTION}The court does not weigh the evidence, and it draws every inference for the nonmovant.\n`, 'it draws every inference for the nonmovant').outcome).toBe('PASS')
    expect(one(`${CAPTION}The court does not weigh the evidence, and it draws every inference for the nonmovant.\n`, 'weigh the evidence').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(`${CAPTION}The court does not weigh the evidence and draw inferences for the movant.\n`, 'draw inferences for the movant').outcome).toBe('INSUFFICIENT_DATA')
    // the second legal blind set's L2-23 (Dandridge): "We do not decide today that X, that Y, or that Z" keeps its negation over Z, as legal@0.5.3 read it,
    // whether the quotation begins after "that" or with it
    expect(one(`${CAPTION}We do not decide today that the regulation is wise, that it best fulfills its objectives, or that it is the fairest rule.\n`, 'it is the fairest rule').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(`${CAPTION}We do not decide today that the regulation is wise, that it best fulfills its objectives, or that it is the fairest rule.\n`, 'that it is the fairest rule.').outcome).toBe('INSUFFICIENT_DATA')
  })
  it('d12: a sentence that opens on a headnote marker ("HN2[ ] A conclusory affidavit …") is the court\'s own statement, not the view of "Delacroix contends that …" before it', () => {
    const old = byId(buyer('brief.json', OLD)).d12!
    expect(old.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(old)).toContain('the words follow "Delacroix contends that the district court should have credited its owner\'s affidavit."')
    const c = byId(buyer('brief.json', NEW)).d12!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('bracket [a] read as written')
  })
  it('o8: an ellipsis over a whole "not X, but" contrast keeps what the text asserts (legal@0.5.3: "an omission in the quotation changes a negation")', () => {
    expect(byId(buyer('brief.json', OLD)).o8!.outcome).toBe('INSUFFICIENT_DATA')
    const c = byId(buyer('brief.json', NEW)).o8!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('an ellipsis stands for a "not …, but" contrast omitted whole ("not whether the expert is right but")')
    // an ellipsis that omits the negation alone, or half the contrast, is still held
    const text = `${CAPTION}The question is not whether the expert is right but whether the method is reliable.\n`
    expect(one(text, 'The question is . . . whether the method is reliable.').outcome).toBe('PASS')
    expect(one(text, 'The question is . . . whether the expert is right but whether the method is reliable.').outcome).toBe('INSUFFICIENT_DATA')
  })
  it('the buyer\'s brief: 11/10/16 under legal@0.5.3 (its own run) and 14/10/13 under legal@0.5.4; every other answer stands', () => {
    const a = buyer('brief.json', OLD), b = buyer('brief.json', NEW)
    expect(totals(a)).toBe('11/10/16')
    expect(totals(b)).toBe('14/10/13')
    const moved = a.claims.filter((c, i) => c.outcome !== b.claims[i]!.outcome).map(c => c.claim_id.replace(/^cite\./, ''))
    expect(moved).toEqual(['d4', 'd11', 'd12', 'o1', 'o4', 'o6', 'o8'])
  })
})

describe('5. six more designation styles, and a party\'s filing as a speaker', () => {
  const SEVEN = ['d902', 'd903', 'd905', 'd906', 'd910', 'd911', 'l922']
  it('the ninth round\'s probe: all 24 answer can\'t tell; legal@0.5.3 passed seven', () => {
    const old = byId(probe(OLD))
    expect(SEVEN.map(id => old[id]!.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    const v = probe(NEW)
    expect(totals(v)).toBe('0/0/24')
    const n = byId(v), labels = probeLabels()
    for (const [id, c] of Object.entries(n)) expect(c.outcome, `${id} ${labels[id]}`).toBe('INSUFFICIENT_DATA')
    expect(said(n.d902!)).toContain('the quoted words appear in Judge Molina\'s dissent (line 8), not in the majority opinion')
    expect(said(n.d903!)).toContain('Judge Molina\'s dissent')
    expect(said(n.d905!)).toContain('Molina\'s dissent')
    expect(said(n.d906!)).toContain('Molina\'s dissent')
    expect(said(n.d910!)).toContain('Judge Molina\'s opinion dissenting from the denial of rehearing en banc')
    expect(said(n.d911!)).toContain('the quoted words appear in a dissent (line 8)')
    expect(said(n.l922!)).toContain('found as a party\'s position, not the court\'s: the words follow "Tamberly’s brief states that"')
  })
  it('each designation style ends the majority: header, majority, separate', () => {
    const sources = loadOpinionFolder(join(F9, 'round9', 'probe'))
    for (let k = 900; k <= 911; k++) {
      const text = (sources[`${k} F.4th 101`] as { text: string }).text
      expect(sectionsOf(text, { v051: true, v052: true, v053: true, v054: true }).sections.map(s => s.kind), String(k)).toEqual(['header', 'majority', 'separate'])
    }
  })
  it('a filing as the speaker in the quotation\'s own sentence, and in the sentence before it', () => {
    expect(one(`${CAPTION}The reply brief argues that the clause is void. We disagree.\n`, 'the clause is void').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(`${CAPTION}Bravo’s brief states that the clause is void. The clause is void only if unsigned. We disagree.\n`, 'The clause is void only if unsigned.').outcome).toBe('INSUFFICIENT_DATA')
    expect(one(`${CAPTION}Bravo’s brief states that the clause is void. That rule no longer holds. The clause is void only if unsigned.\n`, 'The clause is void only if unsigned.').outcome).toBe('PASS')
    expect(one(`${CAPTION}Bravo’s brief states that the clause is void. The Court disagrees. The clause is void only if unsigned.\n`, 'The clause is void only if unsigned.').outcome).toBe('PASS')
  })
})

describe('6. a Westlaw database number binds its caption; a headnote-marked sentence after "That rule no longer holds."', () => {
  it('the nine quotations against 2025 WL 1188234 are checked (legal@0.5.3: "no supplied text matched" for all nine)', () => {
    const old = byId(tank1(OLD))
    for (let k = 1; k <= 9; k++) {
      const id = Object.keys(old).find(x => x.startsWith(`D0${k}-`))!
      expect(old[id]!.insufficiency?.reason, id).toBe('REFERENCE_NOT_PROVIDED')
    }
    const n = byId(tank1(NEW))
    const out = (prefix: string): string => { const id = Object.keys(n).find(x => x.startsWith(prefix))!; const c = n[id]!; return `${c.outcome}${c.insufficiency ? `/${c.insufficiency.reason}` : ''}` }
    expect(out('D01-')).toBe('INSUFFICIENT_DATA/SELECTIVE_QUOTE') // a party's position
    expect(out('D02-')).toBe('INSUFFICIENT_DATA/SELECTIVE_QUOTE') // "would have the Court treat"
    expect(out('D03-')).toBe('INSUFFICIENT_DATA/SELECTIVE_QUOTE') // the cut ends before ", but a district court must still"
    expect(out('D04-')).toBe('FAIL') // "probability" for "certainty"
    expect(out('D05-')).toBe('INSUFFICIENT_DATA/SELECTIVE_QUOTE') // an ellipsis omits "only"
    expect(out('D06-')).toBe('PASS')
    expect(out('D07-')).toBe('FAIL') // the court rejected the formulation
    expect(out('D08-')).toBe('FAIL') // two passages joined
    expect(out('D09-')).toBe('INSUFFICIENT_DATA/SPAN_NOT_FOUND')
    expect(n['D06-genuine-verbatim-PASS']!.explanation).toContain('appears verbatim')
    expect(n['D07-quoted-then-rejected-NOTPASS']!.explanation).toContain('the court rejected this standard: line 10: "That formulation no longer reflects the law of this Circuit."')
    const v = tank1(NEW)
    expect(v.opinion_sources?.find(p => p.key === '2025 WL 1188234')?.names[0]?.bound).toBe(true)
  })
  it('a database number in a full citation is read off it, and a page-shaped number of five digits still reads as a reporter page', () => {
    const sources = loadOpinionFolder(join(F9, 'round9', 'opinions'))
    const v = verifyCitations([{ id: 'w', cite: 'Calloway Precision, Inc. v. Northgate Components Corp., 2025 WL 1188234, at *3 (D. Minn. Apr. 18, 2025)', quote: 'Summary judgment is appropriate where there is no genuine dispute as to any material fact and the movant is entitled to judgment as a matter of law.' }], sources, { now: NOW, ruleset: NEW })
    expect(v.claims[0]!.outcome, v.claims[0]!.explanation).toBe('PASS')
    expect(v.opinion_sources?.find(p => p.key === '2025 WL 1188234')?.names[0]?.read_as?.reads).toBe('2025 WL 1188234')
  })
  it('L05: the genuine quotation after "That rule no longer holds. HN1[ ]" PASSes and prints the sentence before it (legal@0.5.3: "someone else\'s position")', () => {
    const old = byId(tank1(OLD))['L05-genuine-after-HN-marker-PASS']!
    expect(old.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(old)).toContain('found as someone else\'s position')
    const c = byId(tank1(NEW))['L05-genuine-after-HN-marker-PASS']!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('The sentence before it reads: "That rule no longer holds."')
  })
  it('the ninth round\'s brief: 6/5/26 under legal@0.5.3 (its own run) and 8/8/21 under legal@0.5.4; nothing else moves', () => {
    const a = tank1(OLD), b = tank1(NEW)
    expect(totals(a)).toBe('6/5/26')
    expect(totals(b)).toBe('8/8/21')
    const moved = a.claims.filter((c, i) => c.outcome !== b.claims[i]!.outcome || c.insufficiency?.reason !== b.claims[i]!.insufficiency?.reason).map(c => c.claim_id.replace(/^cite\./, '').split('-')[0])
    expect(moved).toEqual(['L05', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09'])
  })
})

describe('legal@0.5.3, named, answers every one of these as before', () => {
  it('the "(quoting …)" FAIL, the first-letter PASS, the conjoined-condition PASS, the held genuine quotations, the seven probe PASSes, the unmatched database number', () => {
    const b3 = byId(buyer('brief3.json', OLD)), b = byId(buyer('brief.json', OLD)), p = byId(probe(OLD)), t = byId(tank1(OLD))
    expect(b3.q1!.outcome).toBe('FAIL')
    expect(b.d11!.outcome).toBe('PASS')
    expect(b.o4!.outcome).toBe('PASS')
    expect(['d4', 'd12', 'o1', 'o6', 'o8'].map(id => b[id]!.outcome)).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'])
    expect(p.d902!.outcome).toBe('PASS')
    expect(p.l922!.outcome).toBe('PASS')
    expect(t['D06-genuine-verbatim-PASS']!.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
    expect(t['L05-genuine-after-HN-marker-PASS']!.outcome).toBe('INSUFFICIENT_DATA')
  })
})
