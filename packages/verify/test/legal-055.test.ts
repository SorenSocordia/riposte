/**
 * legal@0.5.5 (2026-10-19): selectable under this build (engine 0.7.2); the default only from the engine named in src/legal/index.ts
 * V055_DEFAULT_ENGINE, a label this build does not carry, so legal@0.5.4 stays the default. The cases two cold reviews found on 2026-10-19
 * (test/fixtures/legal-r10/: a tenth review round's brief, probes and bracket briefs, and a legal-operations buyer's briefs; AI agents in
 * those roles, not people). The texts are fictional mock-ups the reviewers typed; they test the check's mechanics, not the law.
 *   1. an ellipsis that omits a word of degree, frequency or hedging ("rarely", "generally"), or words from inside a clause, answers can't
 *      tell: the probe's 19 adverb cuts (13 PASS under legal@0.5.4) and the brief's M04, M14 and M15;
 *   2. an ellipsis over a part of a time phrase joined by "or" (q03) or over words that say who must show what (o06) answers can't tell;
 *   3. nine more separate-opinion designation styles end the majority (the probe's STY lines, 9 PASS under legal@0.5.4; the brief's M20), and
 *      two plurality forms are named as pluralities (F01, C01);
 *   4. a ligature from PDF conversion is read as its letters: M01 and M27 PASS (legal@0.5.4 FAILed them, telling the writer to change them);
 *   5. a bracket that inserts "always", "unreliable" or an "-ly" adverb FAILs; one that inserts another content word answers can't tell;
 *   6. "(citation omitted)" excuses a rule, code or Restatement citation: the buyer's eleven forms all PASS (2 under legal@0.5.4);
 *   7. the court's own judging sentence after a party's contention PASSes (q06, q06b); a quoted standard the court departs from in its next
 *      sentence in other words answers can't tell naming that sentence (o02, o12);
 *   8. a district court's slip opinion is read from its heading or its judge's line (the buyer's three judge-line variants).
 * legal@0.5.4 and every earlier rule answer as before (the last blocks).
 *
 * The fix assertions read the rule in NEW. To watch them fail under the rule before, run this file with LEGAL_RULE_UNDER_TEST=legal@0.5.4.
 */
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCitations, defaultLegalRuleset, resolveLegalRuleset, LEGAL_RULESET_VERSIONS, type Citation, type LegalVerdict, type OpinionSources } from '../src/legal/index'
import { loadOpinionFolder, readCitationsFile } from '../src/legal/cli-citations'
import { sectionsOf } from '../src/legal/sections'
import type { ClaimVerdict } from '../src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = join(HERE, 'fixtures', 'legal-r10')
const FX = join(HERE, 'fixtures')
const NOW = (): Date => new Date('2026-10-19T00:00:00Z')
const NEW = process.env.LEGAL_RULE_UNDER_TEST ?? 'legal@0.5.5'
const OLD = 'legal@0.5.4'

const runFolder = (brief: string, dir: string, ruleset: string): LegalVerdict =>
  verifyCitations(readCitationsFile(brief), loadOpinionFolder(dir), { now: NOW, ruleset })
type Claim = ClaimVerdict & { remedyText: string }
const withRemedies = (v: LegalVerdict, c: ClaimVerdict): Claim => ({ ...c, remedyText: (v.remedies ?? []).filter(r => (r.claims ?? []).includes(c.claim_id)).map(r => r.detail).join(' ') })
const byId = (v: LegalVerdict): Record<string, Claim> => Object.fromEntries(v.claims.map(c => [c.claim_id.replace(/^cite\./, ''), withRemedies(v, c)]))
const said = (c: ClaimVerdict): string => `${c.explanation} ${c.insufficiency?.detail ?? ''}`
const totals = (v: LegalVerdict): string => `${v.coverage.claims_pass}/${v.coverage.claims_fail}/${v.coverage.claims_insufficient}`

const review = (r: string) => runFolder(join(F, 'review', 'brief.json'), join(F, 'review', 'ops'), r)
const brackets = (r: string) => runFolder(join(F, 'review', 'brief-brackets.json'), join(F, 'review', 'ops'), r)
const inserted = (r: string) => runFolder(join(F, 'review', 'brief-ins.json'), join(F, 'review', 'ops'), r)
const probe = (r: string) => runFolder(join(F, 'review', 'probe', 'brief.json'), join(F, 'review', 'probe', 'ops'), r)
const buyer = (r: string) => runFolder(join(F, 'buyer', 'brief.json'), join(F, 'buyer', 'opinions'), r)
const buyerOn = (brief: string, dir: string, r: string) => runFolder(join(F, 'buyer', brief), join(F, 'buyer', dir), r)

/** One text, one quotation. */
const one = (text: string, quote: string, ruleset = NEW, extra: Partial<Citation> = {}): Claim => {
  const sources: OpinionSources = { '901 F.4th 1': { text, source: 'mock-up' } }
  const c: Citation = { id: 'q', cite: '901 F.4th 1', case_name: 'Acme Supply Co. v. Bravo Holdings, Inc.', quote, ...extra }
  const v = verifyCitations([c], sources, { now: NOW, ruleset })
  return withRemedies(v, v.claims[0]!)
}
const CAPTION = 'ACME SUPPLY CO. v. BRAVO HOLDINGS, INC.\n901 F.4th 1 (7th Cir. 2026)\nEASTERBROOK, Circuit Judge:\n'

describe('legal@0.5.5 can be named under this build; the default does not move', () => {
  it('is the newest rule, resolves by name, needs engine 0.7.2, and leaves this build\'s default at legal@0.5.4', () => {
    expect(LEGAL_RULESET_VERSIONS[0]).toEqual({ id: 'legal', version: '0.5.5', domain: 'legal' })
    expect(resolveLegalRuleset('legal@0.5.5').version).toBe('0.5.5')
    const c: Citation = { id: 'a', cite: '601 U.S. 1', case_name: 'Acme Arbitration Co. v. Roe Contractors, Inc.', quote: 'x' }
    expect(verifyCitations([c], {}, { now: NOW, ruleset: 'legal@0.5.5' }).ruleset).toEqual({ id: 'legal', version: '0.5.5', domain: 'legal' })
    expect(() => verifyCitations([c], {}, { now: NOW, engine: '0.7.1', ruleset: 'legal@0.5.5' })).toThrow(/legal@0\.5\.5 needs engine 0\.7\.2 or later/)
    // the default for a new verdict: legal@0.5.4 under this build's engine 0.7.2 (V055_DEFAULT_ENGINE names a label this build does not carry)
    expect(defaultLegalRuleset().version).toBe('0.5.4')
    expect(defaultLegalRuleset('0.7.2').version).toBe('0.5.4')
    expect(defaultLegalRuleset('0.7.1').version).toBe('0.5.3')
    expect(verifyCitations([c], {}, { now: NOW }).ruleset.version).toBe('0.5.4')
  })
})

describe('1. an ellipsis that omits a word of degree or frequency, or words from inside a clause', () => {
  const ADV = ['ADV0_rarely', 'ADV1_seldom', 'ADV2_hardly', 'ADV3_scarcely', 'ADV4_barely', 'ADV5_never', 'ADV6_infrequently', 'ADV7_only_rarely', 'ADV8_not_always', 'ADV9_not_ordinarily', 'ADV10_almost_never', 'ADV11_no_longer', 'ADV12_usually', 'ADV13_typically', 'ADV14_generally', 'ADV15_sometimes', 'ADV16_occasionally', 'ADV17_presumptively', 'ADV18_in_limited_circumstances']
  it('the probe: all 19 adverb cuts answer can\'t tell; legal@0.5.4 passed 13 of them', () => {
    const old = byId(probe(OLD))
    expect(ADV.filter(id => old[id]!.outcome === 'PASS')).toEqual(['ADV0_rarely', 'ADV1_seldom', 'ADV2_hardly', 'ADV3_scarcely', 'ADV4_barely', 'ADV6_infrequently', 'ADV12_usually', 'ADV13_typically', 'ADV14_generally', 'ADV15_sometimes', 'ADV16_occasionally', 'ADV17_presumptively', 'ADV18_in_limited_circumstances'])
    const n = byId(probe(NEW))
    for (const id of ADV) expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('INSUFFICIENT_DATA')
    expect(said(n.ADV0_rarely!)).toContain('elided qualifier: the quotation\'s ellipsis omits "rarely"')
    expect(said(n.ADV18_in_limited_circumstances!)).toContain('"in limited circumstances", a word of degree, frequency or hedging')
    expect(n.ADV0_rarely!.insufficiency?.missing).toEqual(['elided_words'])
    expect(n.ADV0_rarely!.remedyText).toContain('Quote the words the ellipsis leaves out')
  })
  it('the brief: M04 ("generally"), M14 ("rarely") and M15 ("ordinarily") answer can\'t tell; legal@0.5.4 passed all three', () => {
    const old = byId(review(OLD)), n = byId(review(NEW))
    for (const id of ['M04', 'M14', 'M15']) {
      expect(old[id]!.outcome, id).toBe('PASS')
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('INSUFFICIENT_DATA')
    }
    expect(said(n.M15!)).toContain('omits "ordinarily"')
  })
  it('a cut inside a clause is held whatever word it omits; an omission set off on both sides, a whole sentence, and a "not X, but" contrast read as before', () => {
    const text = `${CAPTION}A district court must promptly exclude expert testimony that rests on no method. The proponent bears the cost of the hearing, an adverse ruling or a delay, as the rules provide. The question is not whether the expert is right but whether the method is reliable.\n`
    const cut = one(text, 'A district court must . . . exclude expert testimony that rests on no method.')
    expect(cut.outcome, cut.explanation).toBe('INSUFFICIENT_DATA')
    expect(said(cut)).toContain('cut inside a clause: the quotation\'s ellipsis omits "promptly"')
    expect(one(text, 'A district court must . . . exclude expert testimony that rests on no method.', OLD).outcome).toBe('PASS')
    expect(one(text, 'The proponent bears the cost of the hearing . . . as the rules provide.').outcome).toBe('PASS')
    expect(one(text, 'A district court must promptly exclude expert testimony that rests on no method. . . . The question is not whether the expert is right but whether the method is reliable.').outcome).toBe('PASS')
    expect(one(text, 'The question is . . . whether the method is reliable.').outcome).toBe('PASS')
  })
  it('a phrase of degree set off by commas is held too; a set-off appositive and a whole sentence that holds one read as before', () => {
    const text = `${CAPTION}Such clauses are, in limited circumstances, enforced against merchants. The court excluded the testimony of the damages expert, Dr. Ilse Varga, on March 3. The clause binds the buyer. Courts generally agree. The clause also binds the seller.\n`
    const c = one(text, 'Such clauses are . . . enforced against merchants.')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toContain('which carries "in limited circumstances"')
    expect(one(text, 'The court excluded the testimony of the damages expert . . . on March 3.').outcome).toBe('PASS')
    expect(one(text, 'The clause binds the buyer. . . . The clause also binds the seller.').outcome).toBe('PASS')
  })
})

describe('2. an ellipsis over a part of a time phrase, or over a burden', () => {
  it('q03 ("within a reasonable time after he discovers . . . any breach") answers can\'t tell; legal@0.5.4 passed it', () => {
    expect(byId(buyer(OLD)).q03!.outcome).toBe('PASS')
    const c = byId(buyer(NEW)).q03!
    expect(c.outcome, c.explanation).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toContain('omits "or should have discovered"')
    expect(said(c)).toContain('a part of the time phrase its sentence states ("within a reasonable time after he discovers …") that "or" joins to the words kept')
  })
  it('o06 ("if . . . the source of information") answers can\'t tell naming the burden; legal@0.5.4 passed it', () => {
    expect(byId(buyer(OLD)).o06!.outcome).toBe('PASS')
    const c = byId(buyer(NEW)).o06!
    expect(c.outcome, c.explanation).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toContain('elided burden: the quotation\'s ellipsis omits "the opponent shows that"')
  })
})

describe('3. separate-opinion designations and pluralities', () => {
  const STYLES = ['STY0', 'STY1', 'STY5', 'STY6', 'STY7', 'STY11', 'STY12', 'STY13', 'STY14']
  it('the probe: all 15 designation styles answer can\'t tell; legal@0.5.4 passed nine as the majority\'s words', () => {
    const old = byId(probe(OLD))
    expect(STYLES.map(id => old[id]!.outcome)).toEqual(STYLES.map(() => 'PASS'))
    const n = byId(probe(NEW))
    for (let k = 0; k <= 14; k++) expect(n[`STY${k}`]!.outcome, `STY${k}: ${n[`STY${k}`]!.explanation}`).toBe('INSUFFICIENT_DATA')
    expect(said(n.STY0!)).toContain('the quoted words appear in Judge Lindqvist\'s opinion concurring dubitante')
    expect(said(n.STY5!)).toContain('Judge Lindqvist\'s statement respecting the denial of rehearing en banc')
    expect(said(n.STY12!)).toContain('Lindqvist\'s opinion concurring in result only')
    expect(said(n.STY14!)).toContain('Lindqvist\'s separate statement')
  })
  it('each style ends the majority: header, majority, separate', () => {
    const sources = loadOpinionFolder(join(F, 'review', 'probe', 'ops'))
    for (let k = 950; k <= 964; k++) {
      const text = (sources[`${k} F.4th 20`] as { text: string }).text
      expect(sectionsOf(text, { v051: true, v052: true, v053: true, v054: true, v055: true }).sections.map(s => s.kind), String(k)).toEqual(['header', 'majority', 'separate'])
    }
  })
  it('M20, the concurrence "concurring dubitante", answers can\'t tell; legal@0.5.4 passed it as the majority\'s words', () => {
    expect(byId(review(OLD)).M20!.explanation).toContain('Found in the majority opinion')
    const c = byId(review(NEW)).M20!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(c)).toContain('Judge Lindqvist\'s opinion concurring dubitante')
  })
  it('F01 (a plurality named only in a Lexis "Judges:" line) and C01 ("OPINION ANNOUNCING THE JUDGMENT OF THE COURT") are named as pluralities', () => {
    const old = byId(review(OLD)), n = byId(review(NEW))
    for (const id of ['F01', 'C01']) {
      expect(old[id]!.explanation, id).toContain('Found in the majority opinion')
      expect(n[id]!.outcome, id).toBe('PASS')
      expect(n[id]!.explanation, id).toContain('Found in the lead opinion')
      expect(n[id]!.explanation, id).toContain('a plurality opinion, not an opinion of the Court')
    }
    expect(n.F01!.explanation).toContain('"Judges: ODUYA, J., announced the judgment of the Court')
    expect(n.C01!.explanation).toContain('"OPINION ANNOUNCING THE JUDGMENT OF THE COURT"')
  })
  it('a line of the majority that names a judge in a sentence starts nothing', () => {
    const text = `${CAPTION}The clause is void.\nJudge Okafor's dissent misreads the record.\nOKAFOR, Circuit Judge, is right that the clause was signed late.\nThe clause is void only if unsigned.\n`
    expect(one(text, 'The clause is void only if unsigned.').outcome).toBe('PASS')
    expect(one(text, 'The clause is void only if unsigned.').explanation).toContain('Found in the majority opinion')
  })
})

describe('4. a ligature from PDF conversion', () => {
  it('M01 and M27 ("ﬁnd" in the text) PASS, saying so; legal@0.5.4 FAILed both and told the writer to change a correct quotation', () => {
    const old = byId(review(OLD)), n = byId(review(NEW))
    for (const id of ['M01', 'M27']) {
      expect(old[id]!.outcome, id).toBe('FAIL')
      expect(old[id]!.remedyText, id).toContain('Conform the quotation to the passage')
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('PASS')
      expect(n[id]!.explanation, id).toContain('a ligature in the text read as letters ("ﬁ" as "fi")')
      expect(n[id]!.explanation, id).not.toContain('verbatim')
    }
  })
  it('M02 (a dropped "only") still FAILs, naming "only" and never the ligature', () => {
    const c = byId(review(NEW)).M02!
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toContain('the quotation leaves out "only"')
    expect(c.explanation).not.toContain('where the quotation has "find"')
  })
})

describe('5. a bracket that inserts a word', () => {
  it('[always], [unreliable] and [expressly] FAIL with "Remove the inserted"; [novel] and [damages] answer can\'t tell; legal@0.5.4 passed all five', () => {
    const oi = byId(inserted(OLD)), ob = byId(brackets(OLD))
    expect([oi.I3_always!, oi.I4_expressly!, oi.I5_unreliable!, oi.I6_novel!, ob.B3!].map(c => c.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    const n = byId(inserted(NEW)), b = byId(brackets(NEW))
    for (const id of ['I3_always', 'I4_expressly', 'I5_unreliable']) {
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('FAIL')
      expect(n[id]!.remedyText, id).toContain('Remove the inserted')
    }
    expect(n.I3_always!.explanation).toContain('the bracket [always] inserts "always", which the text does not have there')
    expect(n.I6_novel!.outcome).toBe('INSUFFICIENT_DATA')
    expect(n.I6_novel!.insufficiency?.missing).toEqual(['inserted_words'])
    expect(b.B3!.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(b.B3!)).toContain('the bracket [damages] inserts "damages"')
  })
  it('[only] and [not] FAIL as before; "[A]" for "A" and a bracketed referent for "It" still PASS; glue and "[sic]" read as before', () => {
    const n = byId(inserted(NEW)), b = byId(brackets(NEW))
    expect([n.I1_only!.outcome, n.I2_not!.outcome]).toEqual(['FAIL', 'FAIL'])
    expect([b.B1!.outcome, b.B4!.outcome, b.B2!.outcome, b.B5!.outcome]).toEqual(['PASS', 'PASS', 'FAIL', 'FAIL'])
    const text = `${CAPTION}The clause binds every signatory and its successors.\n`
    expect(one(text, 'The clause binds every signatory and [all of] its successors.').outcome).toBe('FAIL')
    expect(one(text, 'The clause binds every signatory and [sic] its successors.').outcome).toBe('PASS')
    expect(one(text, 'The clause binds every signatory [of the Agreement] and its successors.').outcome).toBe('PASS')
  })
  it('a referent named right after its pronoun reads as before; a bracket at the edge that holds such a word answers can\'t tell', () => {
    expect(one(`${CAPTION}It held that the clause was void.\n`, 'It [the district court] held that the clause was void.').outcome).toBe('PASS')
    const edge = one(`${CAPTION}The court held that expert testimony must be excluded.\n`, '[unreliable] expert testimony must be excluded')
    expect(edge.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(edge)).toContain('the bracketed alteration [unreliable] carries "unreliable"')
    expect(one(`${CAPTION}The court held that expert testimony must be excluded.\n`, '[unreliable] expert testimony must be excluded', OLD).outcome).toBe('PASS')
  })
})

describe('6. "(citation omitted)" over a rule, code or Restatement citation', () => {
  it('the buyer\'s eleven forms all PASS, each naming the citation left out; legal@0.5.4 FAILed nine', () => {
    const old = buyerOn('brief5.json', 'opinions5', OLD), v = buyerOn('brief5.json', 'opinions5', NEW)
    expect(totals(old)).toBe('2/9/0')
    expect(totals(v)).toBe('11/0/0')
    const n = byId(v)
    expect(n.r0!.explanation).toContain('the citation "Fed. R. Civ. P. 56(a)." left out, as "(citation omitted)" says')
    expect(n.r3!.explanation).toContain('the citation "Restatement (Second) of Contracts § 90 (1981)." left out')
    expect(n.r5!.explanation).toContain('the citation "Tex. R. Civ. P. 166a(c)." left out')
    expect(n.r10!.explanation).toContain('the citation "N.Y. C.P.L.R. 3212(b) (McKinney 2024)." left out')
  })
  it('h25 and o09 in the buyer\'s brief PASS; h24 and o08, which leave the citation out without saying so, FAIL naming it', () => {
    const old = byId(buyer(OLD)), n = byId(buyer(NEW))
    for (const id of ['h25', 'o09']) {
      expect(old[id]!.outcome, id).toBe('FAIL')
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('PASS')
    }
    expect(n.h24!.outcome).toBe('FAIL')
    expect(n.h24!.explanation).toContain('it leaves out the citation "Fed. R. Civ. P. 6(b)(1)(B)." without an ellipsis or "(citation omitted)"')
    expect(n.o08!.explanation).toContain('leaves out the citation "Fed. R. Evid. 803(6)."')
  })
  it('a sentence about a rule is not a citation of it, and is never excused', () => {
    const text = `${CAPTION}The movant bears the initial burden. Rule 56 requires the movant to point to the record. The burden then shifts.\n`
    expect(one(text, 'The movant bears the initial burden. The burden then shifts. (citation omitted)').outcome).toBe('FAIL')
    expect(one(`${CAPTION}The movant bears the initial burden. Fed. R. Civ. P. 56(c)(1). The burden then shifts.\n`, 'The movant bears the initial burden. The burden then shifts. (citation omitted)').outcome).toBe('PASS')
  })
  it('a rule citation set off inside a sentence is a citation clause too', () => {
    const text = `${CAPTION}The movant must show the absence of a genuine dispute, Fed. R. Civ. P. 56(a), and the court views the record in the light most favorable to the nonmovant.\n`
    const q = 'The movant must show the absence of a genuine dispute, and the court views the record in the light most favorable to the nonmovant. (citation omitted)'
    expect(one(text, q, OLD).outcome).toBe('FAIL')
    const c = one(text, q)
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('the citation "Fed. R. Civ. P. 56(a)" left out, as "(citation omitted)" says')
  })
})

describe('7. the court\'s own sentence, and a quoted standard the court departs from', () => {
  it('q06 ("That reading is foreclosed by the statute.", after "Marbeck contends that …") PASSes; legal@0.5.4 held it as the party\'s position', () => {
    const old = byId(buyer(OLD)).q06!
    expect(old.outcome).toBe('INSUFFICIENT_DATA')
    expect(said(old)).toContain('found as someone else\'s position')
    const c = byId(buyer(NEW)).q06!
    expect(c.outcome, c.explanation).toBe('PASS')
    expect(c.explanation).toContain('The sentence before it reads: "Marbeck contends that')
  })
  it('q06b, LEGAL.md\'s own example ("That reading is foreclosed by the text."), PASSes on the variant text', () => {
    expect(byId(buyerOn('brief2.json', 'opinions2', OLD)).q06b!.outcome).toBe('INSUFFICIENT_DATA')
    expect(byId(buyerOn('brief2.json', 'opinions2', NEW)).q06b!.outcome).toBe('PASS')
  })
  it('o02 and o12 (Benfield\'s words, then "We part ways with that formulation today.") answer can\'t tell naming that sentence; legal@0.5.4 passed both', () => {
    const old = byId(buyer(OLD)), n = byId(buyer(NEW))
    for (const id of ['o02', 'o12']) {
      expect(old[id]!.outcome, id).toBe('PASS')
      expect(n[id]!.outcome, `${id}: ${n[id]!.explanation}`).toBe('INSUFFICIENT_DATA')
      expect(said(n[id]!), id).toContain('the court\'s next words read: line 30: "We part ways with that formulation today."')
      expect(n[id]!.insufficiency?.missing, id).toEqual(['next_sentence'])
      expect(n[id]!.remedyText, id).toContain('decides whether the court adopts them or departs from them')
    }
  })
  it('a strong rejection still FAILs, and a quotation the court goes on to apply still PASSes', () => {
    const base = `${CAPTION}In Smith, we said that "a late notice is void." Smith v. Jones, 500 F.4th 1, 2 (7th Cir. 2024).`
    expect(one(`${base} We overrule that statement today.\n`, 'a late notice is void').outcome).toBe('FAIL')
    expect(one(`${base} We apply that rule here.\n`, 'a late notice is void').outcome).toBe('PASS')
    expect(one(`${base} Bravo reads that to cover oral notice. We disagree.\n`, 'a late notice is void').outcome).toBe('PASS')
    expect(one(`${base} We limit that statement to written contracts.\n`, 'a late notice is void').outcome).toBe('INSUFFICIENT_DATA')
  })
})

describe('8. a district court\'s slip opinion', () => {
  it('the three judge-line variants are read from the judge\'s line; legal@0.5.4 read two as "in the counsel listing"', () => {
    for (const d of ['a', 'b', 'c']) {
      const v = buyerOn('brief3.json', `opinions3/${d}`, NEW)
      expect(v.claims[0]!.outcome, `${d}: ${v.claims[0]!.explanation}`).toBe('PASS')
    }
    for (const d of ['b', 'c']) expect(said(buyerOn('brief3.json', `opinions3/${d}`, OLD).claims[0]!), d).toContain('in the counsel listing')
  })
  it('the slip as typed (a heading, then "CORDELL, District Judge" with no colon): every quotation is checked', () => {
    const old = buyerOn('brief2.json', 'opinions', OLD), v = buyerOn('brief2.json', 'opinions', NEW)
    expect(totals(old)).toBe('0/1/12')
    expect(totals(v)).toBe('6/5/2')
    const n = byId(v)
    expect(n.f01!.explanation).toContain('Found in the majority opinion')
    expect([n.f02!.outcome, n.f05!.outcome, n.f06!.outcome, n.f10!.outcome]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL'])
    expect(n.f07!.outcome).toBe('INSUFFICIENT_DATA')
  })
  it('a judge\'s signature after the body of an unheaded order starts nothing: the body stays the opinion', () => {
    const text = 'Fenwright Marine Supply, LLC v. Abernook Tooling Co.\n2026 WL 1\nUnited States District Court, D. Westmark.\n\nFenwright moves for sanctions. The motion is granted in part.\nRule 37(e) does not call for perfection. Negligence will not do.\nIT IS SO ORDERED.\nCORDELL, District Judge.\n'
    const v = verifyCitations([{ id: 's', cite: '2026 WL 1', case_name: 'Fenwright Marine Supply, LLC v. Abernook Tooling Co.', quote: 'Rule 37(e) does not call for perfection.' }], { '2026 WL 1': text }, { now: NOW, ruleset: NEW })
    expect(v.claims[0]!.outcome, v.claims[0]!.explanation).toBe('PASS')
  })
})

describe('the two reviews\' briefs, whole', () => {
  it('the tenth round\'s brief: 14/5/23 under legal@0.5.4, 12/3/27 under legal@0.5.5; the moved answers are the ones above', () => {
    const a = review(OLD), b = review(NEW)
    expect(totals(a)).toBe('14/5/23')
    expect(totals(b)).toBe('12/3/27')
    const moved = a.claims.filter((c, i) => c.outcome !== b.claims[i]!.outcome).map(c => c.claim_id.replace(/^cite\./, ''))
    expect(moved).toEqual(['M01', 'M04', 'M14', 'M15', 'M20', 'M27'])
  })
  it('the buyer\'s brief: 17/15/35 under legal@0.5.4, 21/17/29 under legal@0.5.5; one altered quotation passes (h14, an unlisted lead-in)', () => {
    const a = buyer(OLD), b = buyer(NEW)
    expect(totals(a)).toBe('17/15/35')
    expect(totals(b)).toBe('21/17/29')
    const moved = a.claims.filter((c, i) => c.outcome !== b.claims[i]!.outcome).map(c => c.claim_id.replace(/^cite\./, ''))
    expect(moved).toEqual(['h25', 'q03', 'q06', 'o02', 'o06', 'o09', 'o12', 'f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f08', 'f09', 'f10'])
    expect(byId(b).h14!.outcome).toBe('PASS')
  })
})

describe('legal@0.5.4, named, answers every one of these as before', () => {
  it('the adverb cuts, the designations, the ligature FAILs, the inserted words, the rule citations, the rejection sentence, the slip', () => {
    const r = byId(review(OLD)), p = byId(probe(OLD)), b = byId(buyer(OLD))
    expect([r.M01!.outcome, r.M14!.outcome, r.M20!.outcome, p.ADV0_rarely!.outcome, p.STY0!.outcome]).toEqual(['FAIL', 'PASS', 'PASS', 'PASS', 'PASS'])
    expect([b.q03!.outcome, b.o02!.outcome, b.o06!.outcome, b.h25!.outcome, b.q06!.outcome, b.f01!.outcome]).toEqual(['PASS', 'PASS', 'PASS', 'FAIL', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'])
    expect(byId(inserted(OLD)).I3_always!.outcome).toBe('PASS')
  })
  it('the earlier readers\' briefs: no outcome moves between legal@0.5.4 and legal@0.5.5 (229 checks)', () => {
    const F7 = join(FX, 'legal-cold-review-2026-10-06'), F8 = join(FX, 'legal-cold-review-2026-10-12'), F9 = join(FX, 'legal-cold-review-2026-10-13')
    const sets: [string, string][] = [
      [join(F7, 'brief.json'), join(F7, 'opinions')], [join(F7, 'desig', 'brief.json'), join(F7, 'desig')], [join(F7, 'probe', 'brief.json'), join(F7, 'probe')],
      [join(F8, 'brief1.json'), join(F8, 'opinions')], [join(F8, 'brief2.json'), join(F8, 'opinions2')], [join(F8, 'brief3.json'), join(F8, 'opinions3')],
      [join(F9, 'buyer', 'brief.json'), join(F9, 'buyer', 'opinions')], [join(F9, 'buyer', 'brief3.json'), join(F9, 'buyer', 'opinions')], [join(F9, 'buyer', 'brief4.json'), join(F9, 'buyer', 'opinions')],
      [join(F9, 'round9', 'brief1.json'), join(F9, 'round9', 'opinions')], [join(F9, 'round9', 'probe', 'brief.json'), join(F9, 'round9', 'probe')],
    ]
    let checks = 0
    const moved: string[] = []
    for (const [brief, dir] of sets) {
      const a = runFolder(brief, dir, OLD), b = runFolder(brief, dir, NEW)
      a.claims.forEach((c, i) => {
        checks++
        const d = b.claims[i]!
        if (c.outcome !== d.outcome || c.insufficiency?.reason !== d.insufficiency?.reason) moved.push(c.claim_id)
      })
    }
    expect(checks).toBe(229)
    expect(moved).toEqual([])
  })
})
