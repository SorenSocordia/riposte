/**
 * legal@0.1.0 (2026-10-03, opt-in): the quotation conventions courts and briefs use, read and named on the verdict, with
 * whole-word anchors and an honest FAIL. legal@0.0.1 stays the default, byte for byte.
 *
 * The opinion passages below are excerpts of United States court opinions (public domain), copied as extracted: the Iqbal
 * text keeps the soft hyphen its PDF extraction carries, the Fedele text keeps the scanned "plaintiffs claim". Each
 * quotation is the form another court used when quoting the passage, conventions included.
 */
import { describe, it, expect } from 'vitest'
import { verifyCitation as verifyCitationAt, verifyCitations as verifyCitationsAt, type OpinionSources, type VerifyCitationsOptions, resolveLegalRuleset, LEGAL_RULESET_VERSIONS, LEGAL_REMEDIES_V010, LEGAL_REMEDIES_V010_NEAREST, type Citation } from '../src/legal/index'
import { readQuotation, prepareLegalSource, normalizeLegalText, QUOTATION_LIMITS } from '../src/legal/quotation'
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'
import { route } from '../src/http/router'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import type { ClaimVerdict } from '../src/index'

/** 2026-10-05: this file documents the rules as engines 0.0.1 to 0.5.0 read them, so it names engine 0.5.0. Engine 0.6.0
 *  binds each opinion text to its cite and words its answers by the supplied text: test/legal-060.test.ts. */
const LEGACY_ENGINE = '0.5.0'
const verifyCitation = (c: Citation, s: OpinionSources, r?: string) => verifyCitationAt(c, s, r, LEGACY_ENGINE)
const verifyCitations = (c: Citation[], s: OpinionSources, o: VerifyCitationsOptions = {}) => verifyCitationsAt(c, s, { engine: LEGACY_ENGINE, ...o })

const NOW = () => new Date('2026-10-03T00:00:00Z')
const V010 = 'legal@0.1.0'

const OPINIONS: Record<string, string> = {
  Iqbal: 'To survive a motion to dismiss, a complaint must con\u00AD tain sufficient factual matter, accepted as true, to “state a claim to relief that is plausible on its face.” Id., at 570.',
  Twombly: 'in order to “give the defendant fair notice of what the . . . claim is and the grounds upon which it rests,” Conley v. Gibson',
  'Orellana-Recinos': 'That is, it cannot be incidental, tangential, superficial, or subordinate to another reason for harm.” In re J-B-N-',
  'Lombard Bros.': '“[The] first inquiry must be whether our long-arm statute authorizes the exercise of jurisdiction under the particular facts of this case. Only if we find the statute to be applicable do we reach the question whether it would offend due process to assert jurisdiction.”',
  Garrett: 'the court cannot take on the responsibility of serving as the litigant’s attorney in constructing arguments and searching the record.',
  'Cooter & Gell': 'Rule 11 imposes a duty on attorneys to certify that they have conducted a reasonable inquiry and have determined that any papers filed with the court are well grounded in fact, legally tenable, and “not interposed for any improper purpose.” An attorney who signs',
  Yost: 'personally liable for all torts which he authorizes or directs or in which he participates, notwithstanding that he acted as an',
  Goodyear: 'Federal courts possess certain “inherent powers,” not conferred by rule or statute, “to manage their own affairs so as to achieve the orderly and expeditious disposition of cases.” Link v. Wabash',
  'CVS Pharmacy': 'Preliminary objections in the nature of a demurrer test the legal sufficiency of the complaint[.] Preliminary objections which seek the dismissal',
  Celotex: 'summary judgment is proper “if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to a judgment as a matter of law.” In our view',
  Keys: 'We must construe the complaint in the light most favorable to the plaintiff and accept all allegations as true.',
  Fedele: 'the Second Circuit has cautioned district courts “to take seriously the adjective ‘substantial’ ” and thus “for venue to be proper, significant events or omissions material to the plaintiffs claim must have occurred in the district in question.”',
  Thompson: 'In the exercise of that power they may impose sanctions including, where appropriate, default or dismissal.',
}

/** under legal@0.1.0 */
const check = (case_name: string, quote: string): ClaimVerdict => verifyCitation({ id: 'q', case_name, quote }, OPINIONS, V010)
/** under the default, legal@0.0.1, for comparison */
const old = (case_name: string, quote: string): ClaimVerdict => verifyCitation({ id: 'q', case_name, quote }, OPINIONS)
const notesOf = (c: ClaimVerdict): string[] => c.evidence[0]?.normalizations ?? []

// ── 1. versions ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('1. the version is chosen by the caller; 0.0.1 stays the default, byte for byte', () => {
  const cites: Citation[] = [
    { id: '1', case_name: 'Twombly', quote: 'give the defendant fair notice of what the claim is and the grounds upon which it rests.' },
    { id: '2', case_name: 'Keys', quote: 'construe the complaint in the light most favorable to plaintiff and accept all allegations as true.' },
    { id: '3', case_name: 'Nowhere', quote: 'anything' },
    { id: '4', case_name: 'Keys', proposition: 'pleadings are read for the plaintiff' },
  ]

  it('no ruleset, "legal" and "legal@0.0.1" give the same verdict, byte for byte', () => {
    const a = verifyCitations(cites, OPINIONS, { now: NOW })
    const b = verifyCitations(cites, OPINIONS, { now: NOW, ruleset: 'legal' })
    const c = verifyCitations(cites, OPINIONS, { now: NOW, ruleset: 'legal@0.0.1' })
    expect(a.ruleset).toEqual({ id: 'legal', version: '0.0.1', domain: 'legal' })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    expect(JSON.stringify(c)).toBe(JSON.stringify(a))
  })

  it('legal@0.1.0 is named on the verdict and gives a different verdict id for the same inputs', () => {
    const a = verifyCitations(cites, OPINIONS, { now: NOW })
    const v = verifyCitations(cites, OPINIONS, { now: NOW, ruleset: V010 })
    expect(v.ruleset).toEqual({ id: 'legal', version: '0.1.0', domain: 'legal' })
    expect(v.input_hash).toBe(a.input_hash)
    expect(v.verdict_id).not.toBe(a.verdict_id)
  })

  it('an unknown version or id throws, naming the known ones and the default', () => {
    // the default moved to 0.2.0 for new verdicts under engine 0.6.0 (2026-10-05), then to 0.3.0 and 0.4.0, the same day; earlier engines keep 0.0.1
    // 2026-10-14: legal@0.5.4 is known and selectable; the default stays legal@0.5.3 under engine 0.7.1 and moves with the engine that ships 0.5.4
    expect(() => resolveLegalRuleset('legal@9.9.9')).toThrow(/legal@0\.5\.4, legal@0\.5\.3, legal@0\.5\.2, legal@0\.5\.1, legal@0\.5\.0, legal@0\.4\.0, legal@0\.3\.0, legal@0\.2\.0, legal@0\.1\.0, legal@0\.0\.1 \(the default is legal@0\.5\.[34] under this build's engine 0\.\d+\.\d+, legal@0\.5\.2 under engines 0\.6\.0 and 0\.7\.0, legal@0\.0\.1 under earlier engines\)/)
    expect([resolveLegalRuleset(undefined, '0.5.0').version, resolveLegalRuleset('legal', '0.5.0').version, resolveLegalRuleset(undefined, '0.6.0').version, resolveLegalRuleset('legal', '0.6.0').version]).toEqual(['0.0.1', '0.0.1', '0.5.2', '0.5.2'])
    expect(() => resolveLegalRuleset('action@0.1.0')).toThrow(/unknown legal ruleset/)
    expect(LEGAL_RULESET_VERSIONS.map(v => v.version)).toEqual(['0.5.5', '0.5.4', '0.5.3', '0.5.2', '0.5.1', '0.5.0', '0.4.0', '0.3.0', '0.2.0', '0.1.0', '0.0.1']) // 0.5.1, then 0.5.2 (2026-10-06), 0.5.3 (2026-10-13), 0.5.4 (2026-10-14), 0.5.5 (2026-10-19), newest first
  })

  it('without opinion text, or without a quotation, 0.1.0 answers as 0.0.1 does', () => {
    for (const c of [cites[2]!, cites[3]!]) expect(verifyCitation(c, OPINIONS, V010)).toEqual(verifyCitation(c, OPINIONS))
  })

  it('both versions replay: the verdict is re-performed under the version it names, byte for byte', () => {
    for (const ruleset of [undefined, V010]) {
      const v = verifyCitations(cites, OPINIONS, { now: NOW, ...(ruleset ? { ruleset } : {}) })
      expect(verifyReplay(v, { citations: cites, sources: OPINIONS })).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
    }
  })

  it('a verdict whose version was changed after the fact does not replay', () => {
    const v = verifyCitations(cites, OPINIONS, { now: NOW, ruleset: V010 })
    const relabelled = { ...v, ruleset: { ...v.ruleset, version: '0.0.1' } }
    expect(verifyReplay(relabelled, { citations: cites, sources: OPINIONS }).ok).toBe(false)
  })
})

// ── 2. the conventions ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('2. quotation conventions PASS under 0.1.0, and each says what it relied on', () => {
  it('a period inside the closing quotation mark, where the opinion goes on with a comma', () => {
    const q = 'authorizes or directs or in which he participates.'
    expect(old('Yost', q).outcome).not.toBe('PASS') // 0.0.1
    const c = check('Yost', q)
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toContain('trailing "." not compared')
  })

  it("single marks where the opinion has double ones (a nested quotation)", () => {
    const q = 'imposes a duty on attorneys to certify that they have conducted a reasonable inquiry and have determined that any papers filed with the court are well grounded in fact, legally tenable, and ‘not interposed for any improper purpose.’'
    expect(old('Cooter & Gell', q).outcome).toBe('FAIL') // 0.0.1
    const c = check('Cooter & Gell', q)
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toContain('quotation marks not compared')
  })

  it('a bracketed change of case, "[I]t" for "it"', () => {
    const c = check('Orellana-Recinos', '[I]t cannot be incidental, tangential, superficial, or subordinate to another reason for harm.')
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toContain('bracket [I] read as written (case aside)')
    expect(c.evidence[0]!.value).toMatch(/^it cannot be incidental/)
  })

  it('bracketed substitutions: each bracket names the words of the opinion it stands for', () => {
    const q = 'The first inquiry must be whether [Connecticut’s] long-arm statute authorizes the exercise of jurisdiction under the particular facts of this case. Only if [the court] find[s] the statute to be applicable do[es it] reach the question whether it would offend due process to assert jurisdiction.'
    expect(old('Lombard Bros.', q).outcome).toBe('FAIL') // 0.0.1
    const c = check('Lombard Bros.', q)
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toEqual(expect.arrayContaining([
      'bracket [Connecticut’s] stands for "our"', 'bracket [the court] stands for "we"', 'bracket [s] is an insertion',
      'bracket [es it] stands for "we"', "the opinion's own brackets not compared",
    ]))
    expect(c.explanation).toMatch(/read with the quotation conventions it uses: /)
  })

  it('a bracket attached to a word replaces part of that word: "serv[e]" for "serving"', () => {
    // An illustrative sentence (no negation before the passage): the in-word substitution PASSes and is named.
    const op = { Op: 'A district court that went further would risk serving as the litigant’s attorney in constructing arguments and searching the record.' }
    const c = verifyCitation({ id: 'g', case_name: 'Op', quote: 'serv[e] as the litigant’s attorney in constructing arguments and searching the record.' }, op, V010)
    expect(c.outcome).toBe('PASS')
    expect(c.evidence[0]!.normalizations).toContain('bracket [e] stands for "ing"')
  })

  it('read with its bracket, the Garrett passage follows "cannot" in the opinion: 0.0.1\'s negation guard declines to certify it', () => {
    // Garrett reads "the court cannot take on the responsibility of serving as the litigant's attorney ...". The words
    // match once the bracket is read; the guard that 0.0.1 applies to every match then answers SELECTIVE_QUOTE, a
    // can't-tell, because the quotation drops the negation that governs it (the quoting court supplies its own).
    const c = check('Garrett', 'serv[e] as the litigant’s attorney in constructing arguments and searching the record.')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(c.evidence[0]!.normalizations).toContain('bracket [e] stands for "ing"')
  })

  it("an ellipsis is an ordered gap and says what it omits; a soft hyphen in the opinion's text is joined", () => {
    const q = 'a complaint must contain sufficient factual matter . . . to ‘state a claim to relief that is plausible on its face.’'
    expect(old('Iqbal', q).outcome).not.toBe('PASS') // 0.0.1
    const c = check('Iqbal', q)
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toEqual(expect.arrayContaining(['an ellipsis stands for ", accepted as true,"', 'a soft hyphen in the opinion joined', 'quotation marks not compared']))
  })

  it('every ellipsis form is a gap: "…", "...", ". . ." and "[. . .]"', () => {
    for (const e of ['…', '...', '. . .', '. . . .', '[. . .]', '[…]']) {
      expect(check('Iqbal', `a complaint must contain sufficient factual matter ${e} to state a claim to relief that is plausible on its face`).outcome, e).toBe('PASS')
    }
  })

  it("the opinion's own ellipsis need not be reproduced", () => {
    const c = check('Twombly', 'give the defendant fair notice of what the claim is and the grounds upon which it rests.')
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toContain("the opinion's own ellipsis not reproduced")
  })

  it('"(cleaned up)" and other parentheticals are stripped and named', () => {
    const q = '[f]ederal courts possess certain ‘inherent powers,’ not conferred by rule or statute, to manage their own affairs so as to achieve the orderly and expeditious disposition of cases. (cleaned up)'
    const c = check('Goodyear', q)
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toContain('parenthetical (cleaned up) stripped from the quotation')
    for (const p of ['(internal quotation marks omitted)', '(citation omitted)', '(citations and internal quotation marks omitted)', '(emphasis added)', '(alteration in original)']) {
      const r = check('Keys', `construe the complaint in the light most favorable to the plaintiff ${p}`)
      expect(r.outcome, p).toBe('PASS')
      expect(notesOf(r).join(' '), p).toContain(`parenthetical ${p} stripped`)
    }
  })

  it("the opinion's own bracketed alteration \"complaint[.]\" need not be reproduced", () => {
    const c = check('CVS Pharmacy', 'Preliminary objections in the nature of a demurrer test the legal sufficiency of the complaint.')
    expect(c.outcome).toBe('PASS')
    expect(notesOf(c)).toEqual(["the opinion's own brackets not compared"]) // the opinion's "[.]" is its period
    expect(c.evidence[0]!.value).toMatch(/sufficiency of the complaint\[\.\]$/)
    expect(old('CVS Pharmacy', 'Preliminary objections in the nature of a demurrer test the legal sufficiency of the complaint.').outcome).toBe('FAIL')
  })

  it('a quotation whose final period the opinion also has is verbatim: no note, the period shown', () => {
    const op = { Makarova: 'A case is properly dismissed for lack of subject matter jurisdiction when the district court lacks the statutory or constitutional power to adjudicate it. Nowak v. Ironworkers' }
    const c = verifyCitation({ id: 'm', case_name: 'Makarova', quote: 'when the district court lacks the statutory or constitutional power to adjudicate it.' }, op, V010)
    expect(c.outcome).toBe('PASS')
    expect(c.evidence[0]!.normalizations).toBeUndefined()
    expect(c.evidence[0]!.value).toBe('when the district court lacks the statutory or constitutional power to adjudicate it.')
    expect(c.explanation).toMatch(/appears verbatim in the opinion\.$/)
  })

  it("the opinion's own bracket at the start of the match is shown whole", () => {
    const c = check('Lombard Bros.', 'The first inquiry must be whether our long-arm statute authorizes the exercise of jurisdiction')
    expect(c.outcome).toBe('PASS')
    expect(c.evidence[0]!.value).toMatch(/^\[The\] first inquiry/)
  })

  it('a hyphenated word broken across a line in the opinion reads as the hyphenated word', () => {
    const op = { Op: 'the first inquiry is whether the long-\narm statute reaches the defendant' }
    const r = verifyCitation({ id: 'h', case_name: 'Op', quote: 'whether the long-arm statute reaches the defendant' }, op, V010)
    expect(r.outcome).toBe('PASS')
    expect(r.evidence[0]!.normalizations).toContain('a line-break hyphen in the opinion joined')
    expect(verifyCitation({ id: 'h', case_name: 'Op', quote: 'whether the long-arm statute reaches the defendant' }, op).outcome).not.toBe('PASS') // 0.0.1
  })

  it('a quotation with no convention at all PASSes as verbatim, with no notes', () => {
    const c = check('Keys', 'construe the complaint in the light most favorable to the plaintiff')
    expect(c.outcome).toBe('PASS')
    expect(c.evidence[0]!.normalizations).toBeUndefined()
    expect(c.explanation).toMatch(/appears verbatim in the opinion\.$/)
  })
})

// ── 3. what must still FAIL ─────────────────────────────────────────────────────────────────────────────────────────────

describe('3. real misquotes still FAIL, naming the corresponding passage', () => {
  it('Celotex quoted without the "a" in "entitled to a judgment"', () => {
    const c = check('Celotex', 'if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to judgment as a matter of law.')
    expect(c.outcome).toBe('FAIL')
    expect(c.locked).toBe(true)
    expect(c.computation?.operands.opinion_says).toMatch(/entitled to a judgment as a matter of law/)
    expect(c.explanation).toMatch(/is not in the opinion as quoted\. The corresponding passage reads: "/)
    expect(c.explanation).not.toMatch(/real authority/)
  })

  it('Keys quoted without the "the" in "favorable to the plaintiff"', () => {
    const c = check('Keys', 'construe the complaint in the light most favorable to plaintiff and accept all allegations as true.')
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.operands.opinion_says).toMatch(/favorable to the plaintiff/)
  })

  it('an apostrophe inside a word is compared: "plaintiff\'s" is not the scanned "plaintiffs"', () => {
    const c = check('Fedele', '[T]he Second Circuit has cautioned district courts ‘to take seriously the adjective substantial’ and thus ‘for venue to be proper, significant events or omissions material to the plaintiff’s claim must have occurred in the district in question.’')
    expect(c.outcome).toBe('FAIL')
    expect(normalizeLegalText('the plaintiff’s claim').text).toBe("the plaintiff's claim")
    expect(normalizeLegalText('the plaintiffs’ claim').text).toBe('the plaintiffs claim')
  })

  it('the corresponding passage is the tightest stretch the quotation aligns with, not a later repeat of its last word', () => {
    const op = { Thompson: 'District courts have inherent power to control their dockets. In the exercise of that power they may impose sanctions including, where appropriate, default or dismissal. Link v. Wabash Railroad Co., 370 U.S. 626 (1961). Dismissal, however, is so harsh a penalty it should be imposed as a sanction only in extreme circumstances. We have repeatedly upheld the imposition of the sanction of dismissal for failure to comply with pretrial procedures.' }
    const c = verifyCitation({ id: 't', case_name: 'Thompson', quote: '[i]n the exercise of that power, they may impose sanctions including, where appropriate ... dismissal' }, op, V010)
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.operands.opinion_says).toBe('their dockets. In the exercise of that power they may impose sanctions including, where appropriate, default or dismissal. Link v')
  })

  it('a comma the opinion does not have is a difference', () => {
    expect(check('Thompson', '[i]n the exercise of that power, they may impose sanctions including, where appropriate ... dismissal').outcome).toBe('FAIL')
    expect(check('Thompson', '[i]n the exercise of that power they may impose sanctions including, where appropriate ... dismissal').outcome).toBe('PASS')
  })
})

// ── 4. the anchor rule and the FAIL's wording ───────────────────────────────────────────────────────────────────────────

describe('4. a passage is named only on a whole-word anchor and a strong enough match', () => {
  const op = {
    Fees: 'The court awarded a reasonable attorney\'s fee under the statute, and costs.',
    Act: 'The plaintiffs sued under the Sunshine Act, alleging that the board met in private.',
    Motion: 'The court must consider all of the circumstances surrounding the default before ruling on the motion.',
  }

  it('an anchor inside a longer word ("attorney" in "attorney\'s") names nothing: 0.0.1 FAILs, 0.1.0 abstains', () => {
    const c: Citation = { id: 'w', case_name: 'Fees', quote: 'a reasonable attorney in like circumstances could believe his actions to be factually and legally justified' }
    expect(verifyCitation(c, op).outcome).toBe('FAIL')
    const r = verifyCitation(c, op, V010)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.reason).toBe('SPAN_NOT_FOUND')
  })

  it('a three-word coincidence names nothing, and the abstention says how long the run was', () => {
    const c: Citation = { id: 's', case_name: 'Act', quote: 'The Sunshine Act imposes obligations directly upon the agency and its members.' }
    expect(verifyCitation(c, op).outcome).toBe('FAIL')
    const r = verifyCitation(c, op, V010)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.detail).toMatch(/longest run of its words found in the opinion is 3 words, too few to name a passage/)
  })

  it('a partial match is a FAIL that says "not found as quoted" and labels the passage as nearest only', () => {
    const v = verifyCitations([{ id: 'n', case_name: 'Motion', quote: 'the court must consider all relevant factors before granting relief on the motion' }], op, { now: NOW, ruleset: V010 })
    const c = v.claims[0]!
    expect(c.outcome).toBe('FAIL')
    expect(c.locked).toBe(false)
    expect(c.explanation).toMatch(/was not found as quoted in the opinion\. The nearest passage, a partial match only \(5 consecutive words; 69% of the quotation's words in order\)/)
    expect(c.explanation).not.toMatch(/reads/)
    expect(c.evidence[0]!.role).toBe('CONTEXT')
    expect(c.computation?.operands.nearest_passage).toBeDefined()
    expect(c.computation?.operands.opinion_says).toBeUndefined()
    const fail = v.remedies!.find(m => m.claims.includes('cite.n'))!
    expect(fail.kind).toBe('recompute-with')
    expect(fail.detail).toMatch(/nearest passage is a partial match only/)
    expect(fail.detail).not.toMatch(/reads|Conform/)
  })

  it('the corresponding passage is a locked FAIL whose remedy is to conform the quotation to it', () => {
    const v = verifyCitations([{ id: 'k', case_name: 'Keys', quote: 'construe the complaint in the light most favorable to plaintiff' }], OPINIONS, { now: NOW, ruleset: V010 })
    expect(v.claims[0]!.outcome).toBe('FAIL')
    expect(v.remedies![0]!.detail).toMatch(/^The quotation attributed to Keys is not in the opinion as quoted\. The corresponding passage reads: ".*favorable to the plaintiff.*"\. Conform the quotation to it/)
  })

  it('the thresholds are the declared ones', () => {
    expect(QUOTATION_LIMITS).toMatchObject({ anchorWords: 4, correspondingSimilarity: 0.8, nearestSimilarity: 0.5, ellipsisChars: 600, bracketChars: 40, bracketExtraWords: 2 })
  })
})

// ── 5. what the conventions may not hide ────────────────────────────────────────────────────────────────────────────────

describe('5. an omission or alteration that changes a negation is not certified; the gaps are bounded', () => {
  it('an ellipsis that omits "not" → SELECTIVE_QUOTE', () => {
    const op = { Rule: 'We hold that the agency\'s rule does not bind private parties in any circumstance.' }
    const r = verifyCitation({ id: 'e', case_name: 'Rule', quote: 'the agency\'s rule . . . bind[s] private parties in any circumstance' }, op, V010)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(r.insufficiency?.detail).toMatch(/ellipsis omits \("does not"\) carries a negation/)
  })

  it('a bracket that stands for "did not" → SELECTIVE_QUOTE', () => {
    const op = { Waiver: 'The defendant did not waive the defense by filing an answer.' }
    const r = verifyCitation({ id: 'b', case_name: 'Waiver', quote: 'The defendant [did] waive the defense by filing an answer.' }, op, V010)
    expect(r.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(r.insufficiency?.detail).toMatch(/\[did\] stands for "did not" and removes a negation/)
  })

  it('a bracket that inserts "not" → SELECTIVE_QUOTE', () => {
    const op = { Imm: 'We conclude the officer was entitled to qualified immunity on this record.' }
    const r = verifyCitation({ id: 'i', case_name: 'Imm', quote: 'the officer was [not] entitled to qualified immunity' }, op, V010)
    expect(r.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
    expect(r.insufficiency?.detail).toMatch(/adds a negation/)
  })

  it("0.0.1's guard still holds: a quotation lifted from just after a negation is not certified", () => {
    const op = { Imm: 'We do not hold that qualified immunity shields the officer in these circumstances.' }
    expect(verifyCitation({ id: 'n', case_name: 'Imm', quote: 'hold that qualified immunity shields the officer' }, op, V010).insufficiency?.reason).toBe('SELECTIVE_QUOTE')
  })

  it('an ellipsis stands for at most 600 characters of the opinion', () => {
    const filler = 'The record was long. '.repeat(40) // 840 characters
    const op = { Long: `The district court found the contract ambiguous. ${filler}It therefore denied summary judgment on the claim.` }
    const near = verifyCitation({ id: 'l', case_name: 'Long', quote: 'The district court found the contract ambiguous . . . It therefore denied summary judgment on the claim.' }, op, V010)
    expect(near.outcome).not.toBe('PASS')
    const opShort = { Long: `The district court found the contract ambiguous. ${'The record was long. '.repeat(20)}It therefore denied summary judgment on the claim.` }
    expect(verifyCitation({ id: 'l', case_name: 'Long', quote: 'The district court found the contract ambiguous . . . It therefore denied summary judgment on the claim.' }, opShort, V010).outcome).toBe('PASS')
  })

  it('a bracket stands for a few words at most', () => {
    const op = { Panel: 'Only if we, the members of this appellate tribunal sitting en banc, find the statute applicable do we proceed.' }
    expect(verifyCitation({ id: 'p', case_name: 'Panel', quote: 'Only if [we] find the statute applicable do we proceed.' }, op, V010).outcome).not.toBe('PASS')
  })

  it('a quotation made mostly of gaps is not read as one', () => {
    const r = readQuotation(prepareLegalSource(OPINIONS.Celotex!), 'the . . . of . . . a . . . law')
    expect(r.kind).not.toBe('match')
  })

  it('pieces must sit on word boundaries: "ourt" is not "court"', () => {
    expect(readQuotation(prepareLegalSource('The court held that the lease was void.'), 'ourt held that the lease was void').kind).not.toBe('match')
  })
})

// ── 6. remedies, surfaces, bounds ───────────────────────────────────────────────────────────────────────────────────────

describe('6. typed remedies, the HTTP and MCP surfaces, and a bounded cost', () => {
  it('the 0.1.0 remedy tables are well formed', () => {
    expect(remedyTableProblems(LEGAL_REMEDIES_V010, 'legal@0.1.0')).toEqual([])
    expect(remedyTableProblems({ CITE_VERBATIM: LEGAL_REMEDIES_V010_NEAREST }, 'legal@0.1.0 nearest')).toEqual([])
  })

  it('every non-PASS 0.1.0 claim carries a typed remedy', () => {
    const v = verifyCitations([
      { id: 'a', case_name: 'Keys', quote: 'construe the complaint in the light most favorable to plaintiff' },
      { id: 'b', case_name: 'Keys', quote: 'a wholly different sentence about something else entirely' },
      { id: 'c', case_name: 'Nowhere', quote: 'x y z' },
    ], OPINIONS, { now: NOW, ruleset: V010 })
    for (const c of v.claims.filter(x => x.outcome !== 'PASS')) {
      expect(v.remedies!.some(m => m.claims.includes(c.claim_id) && ['recompute-with', 'missing-operand', 'authority'].includes(m.kind)), c.claim_id).toBe(true)
    }
  })

  it('HTTP: "ruleset" selects 0.1.0; an unknown one is a 400; a non-string one is a 400', () => {
    // HTTP and MCP verdicts are made by this build's engine (0.6.0), which checks a quotation only against a text that names its cite
    const body = { citations: [{ id: 'a', case_name: 'Yost', quote: 'authorizes or directs or in which he participates.' }], sources: { Yost: `Yost v. Doe\n${OPINIONS.Yost}` } }
    const ok = route({ method: 'POST', path: '/v1/verify/citations', body: { ...body, ruleset: V010 } })
    expect(ok.status).toBe(200)
    expect((ok.json as { ruleset: { version: string }; outcome: string })).toMatchObject({ ruleset: { version: '0.1.0' }, outcome: 'PASS' })
    expect(route({ method: 'POST', path: '/v1/verify/citations', body }).json).toMatchObject({ ruleset: { version: '0.5.4' } }) // the default under this build (2026-10-14; legal@0.5.3 under engine 0.7.1, legal@0.5.2 under 0.6.0)
    expect(route({ method: 'POST', path: '/v1/verify/citations', body: { ...body, ruleset: 'legal@7' } }).status).toBe(400)
    expect(route({ method: 'POST', path: '/v1/verify/citations', body: { ...body, ruleset: 1 } }).status).toBe(400)
  })

  it('MCP: verify_citations takes "ruleset"', () => {
    const r = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_citations', arguments: { citations: [{ id: 'a', case_name: 'Yost', quote: 'authorizes or directs or in which he participates.' }], sources: { Yost: `Yost v. Doe\n${OPINIONS.Yost}` }, ruleset: V010 } } } as JsonRpcRequest)!
    const res = r.result as { structuredContent: { ruleset: { version: string }; outcome: string } }
    expect(res.structuredContent).toMatchObject({ ruleset: { version: '0.1.0' }, outcome: 'PASS' })
  })

  it('a 2,000-word near-miss quotation against a 119 KB opinion finishes in a bounded time', () => {
    const W = 'court held that the parties agreed contract clause arbitration enforceable statute provides remedy damages plaintiff defendant appeal reversed remanded findings evidence record'.split(' ')
    let seed = 11
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const toks: string[] = []
    while (toks.join(' ').length < 119 * 1024) toks.push(W[Math.floor(rnd() * W.length)]! + (rnd() < 0.05 ? '.' : ''))
    const source = toks.join(' ')
    const quote = toks.slice(500, 2500).map((w, k) => (k % 40 === 39 ? 'xyzzy' : w)).join(' ')
    const t0 = performance.now()
    const c = verifyCitation({ id: 'p', cite: '1 F.4th 1', quote }, { '1 F.4th 1': source }, V010)
    const ms = performance.now() - t0
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.operands.opinion_says).toBeDefined() // 39 words in 40 match: the corresponding passage
    expect(ms).toBeLessThan(5000)
  })
})
