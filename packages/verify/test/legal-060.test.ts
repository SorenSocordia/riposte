/**
 * Legal under engine 0.6.0 (2026-10-05): the opinion text is bound to its cite and recorded, an invented quotation
 * abstains instead of FAILing beside a coincidental passage, and every answer is worded by the text that was supplied.
 * Engines 0.0.1 to 0.5.0 answer as they always did (test/legal.test.ts, legal-v010.test.ts, legal-audit.test.ts pin 0.5.0).
 *
 * The Makarova passages are excerpts of Makarova v. United States, 201 F.3d 110 (2d Cir. 2000), a United States opinion
 * (public domain), copied as an outside reviewer's probe bundle carries them. The caption line is what a reporter prints.
 */
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  verifyCitation, verifyCitations, renderCitationAudit, LEGAL_REMEDIES_060, LEGAL_REMEDIES_V010_060, LEGAL_REMEDIES_V020_060,
  LEGAL_REMEDIES_060_NEAREST, LEGAL_REMEDIES_060_ALTERED, LEGAL_REMEDIES_060_UNBOUND, PARTIES_ONLY_NOTE, type Citation, type LegalVerdict, type OpinionSources,
} from '../src/legal/index'
import { citeNamed, namingOf, parseReporterCite, partiesOf, provenanceOf } from '../src/legal/binding'
import { runCitations, loadOpinionFolder, readCitationsFile } from '../src/legal/cli-citations'
import { run } from '../src/cli'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples')
import { verifyReplay } from '../src/protocol/replay'
import { remedyTableProblems } from '../src/verdict/remedy'
import { sha256 } from '../src/verdict/canonical'
import { route } from '../src/http/router'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import type { ClaimVerdict } from '../src/index'

const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
const RULES = ['legal@0.0.1', 'legal@0.1.0', 'legal@0.2.0'] as const

const MAKAROVA_BODY = [
  'McLAUGHLIN, Circuit Judge:\nBACKGROUND\nIn 1982, Natalia Makarova was injured when a piece of scenery fell on her shoulder at the Kennedy Center for the Performing Arts in Washington, D.C. At the time of the injury, Makarova was performing in a production of the musical “On Your Toes,” and a witness for Makarova asserts that she was widely regarded as the world’s best prima ballerina.',
  'A case is properly dismissed for lack of subject matter jurisdiction under Rule 12(b)(1) when the district court lacks the statutory or constitutional power to adjudicate it. See Fed.R.Civ.P. 12(b)(1). In resolving a motion to dismiss for lack of subject matter jurisdiction under Rule 12(b)(1), a district court, as it did here, may refer to evidence outside the pleadings. See Kamen v. American Tel. & Tel. Co., 791 F.2d 1006, 1011 (2d Cir.1986). A plaintiff asserting subject matter jurisdiction has the burden of proving by a preponderance of the evidence that it exists. See Malik v. Meissner, 82 F.3d 560, 562 (2d Cir.1996).',
  'The FTCA waives the government’s sovereign immunity only for:\nclaims against the United States, for money damages ... for injury or loss of property, or personal injury or death caused by the negligent or wrongful act or omission of any employee of the Government while acting within the scope of his office or employment, under circumstances where the United States, if a private person, would be liable to the claimant in accordance with the law of the place where the act or omission occurred.\n28 U.S.C. § 1346(b).',
  'Having accepted the workers’ compensation benefits of being a Kennedy Center employee, Maka-rova cannot now argue that she should be free of the strictures of that same workers’ compensation regime.',
].join('\n')
const MAKAROVA_CAPTION = 'Natalia MAKAROVA, Plaintiff-Appellant, v. UNITED STATES of America, Defendant-Appellee.\n201 F.3d 110 (2d Cir. 2000)\n'
const MAKAROVA = `${MAKAROVA_CAPTION}${MAKAROVA_BODY}`
const M = { cite: '201 F.3d 110', case_name: 'Makarova v. United States' }

/** An outside reviewer's probes, P1 to P11. */
const PROBES: Citation[] = [
  { id: 'P1', ...M, quote: 'a district court, as it did here, may refer to evidence outside the pleadings' },
  { id: 'P2', ...M, quote: 'a district court, as it did here, [must] refer to evidence outside the pleadings' },
  { id: 'P3', ...M, quote: 'a district court, as it did here, must refer to evidence outside the pleadings' },
  { id: 'P4', ...M, quote: 'The FTCA waives the government’s sovereign immunity ... for' },
  { id: 'P5', ...M, quote: 'The FTCA waives the government’s sovereign immunity for' },
  { id: 'P6', ...M, quote: 'now argue that she should be free of the strictures of that same workers’ compensation regime' },
  { id: 'P7', cite: '999 F.4th 123', case_name: 'Smith v. Jones', quote: 'a district court must always hold an evidentiary hearing' },
  { id: 'P8', ...M, quote: 'the Kennedy Center owes no duty of care to any performer under any law' },
  { id: 'P9', ...M, quote: 'the district court lacks the power to hear any claim against the Kennedy Center' },
  { id: 'P10', cite: '598 U.S. 175', case_name: 'Axon Enterprise, Inc. v. FTC', quote: 'a district court, as it did here, may refer to evidence outside the pleadings' },
  { id: 'P11', ...M, proposition: 'A plaintiff bears the burden of proving subject matter jurisdiction.' },
]
const probe = (id: string): Citation => PROBES.find(p => p.id === id)!
/** P10 maps the Axon cite to the Makarova text, as the judge did. */
const SOURCES = (text: string): OpinionSources => ({ '201 F.3d 110': text, '598 U.S. 175': text })
const one = (c: Citation, sources: OpinionSources, ruleset: string, engine?: string): { v: LegalVerdict; c: ClaimVerdict } => {
  const v = verifyCitations([c], sources, { now: NOW, ruleset, ...(engine ? { engine } : {}) })
  return { v, c: v.claims[0]! }
}
const allText = (v: LegalVerdict): string => JSON.stringify(v)

// ── P8 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('P8: an invented quotation of a real opinion abstains as possibly fabricated under every rule (engine 0.6.0)', () => {
  it('before (engine 0.5.0), legal@0.0.1 FAILed beside a coincidental passage and said to conform the quotation to it', () => {
    const { v, c } = one(probe('P8'), SOURCES(MAKAROVA_BODY), 'legal@0.0.1', '0.5.0')
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/is a real authority, but the quotation is not accurate/)
    expect(v.remedies![0]!.detail).toMatch(/Natalia Makarova was injured.*Conform the quotation to it/)
  })
  it('after (engine 0.6.0), every rule abstains SPAN_NOT_FOUND: not found in the supplied opinion text, may be fabricated', () => {
    for (const rs of RULES) {
      const { v, c } = one(probe('P8'), SOURCES(MAKAROVA), rs)
      expect([c.outcome, c.insufficiency?.reason], rs).toEqual(['INSUFFICIENT_DATA', 'SPAN_NOT_FOUND'])
      expect(c.explanation, rs).toBe('Makarova v. United States: quotation not found in the supplied opinion text; it may be fabricated. Abstaining rather than asserting a fabrication.')
      expect(c.insufficiency!.detail, rs).toMatch(/^the quotation was not found in the opinion text supplied for Makarova v\. United States; it may be fabricated/)
      expect(allText(v), rs).not.toMatch(/Conform the quotation/)
      expect(allText(v), rs).not.toMatch(/scenery/)
    }
  })
  it('a quotation that does correspond to a passage still FAILs with that passage, and only then says to conform to it', () => {
    const { v, c } = one(probe('P3'), SOURCES(MAKAROVA), 'legal@0.0.1')
    expect([c.outcome, c.locked]).toEqual(['FAIL', true])
    expect(c.explanation).toMatch(/^The quotation is not found as quoted in the opinion text supplied for Makarova v\. United States\. The corresponding passage there reads: ".*may refer to evidence outside the pleadings/)
    expect(v.remedies![0]!.detail).toMatch(/in the opinion text supplied for it; the corresponding passage there reads: .*Conform the quotation to it/)
  })
  it('a named passage is cut where its two-word margins cross a sentence boundary; its span still points at exactly that text', () => {
    const { c } = one(probe('P5'), SOURCES(MAKAROVA), 'legal@0.1.0')
    expect(c.computation?.operands.opinion_says).toBe('The FTCA waives the government’s sovereign immunity only for:')
    const loc = c.evidence[0]!.locator as { start: number; end: number }
    expect(MAKAROVA.slice(loc.start, loc.end)).toBe(c.computation?.operands.opinion_says)
    const old = one(probe('P5'), SOURCES(MAKAROVA), 'legal@0.1.0', '0.5.0').c // engine 0.5.0 keeps its display
    expect(String(old.computation?.operands.opinion_says)).toMatch(/^2d Cir\.1996\)\.\nThe FTCA waives[\s\S]*\nclaims against$/)
  })
  it('a partial match FAILs unlocked, labelled nearest only, and is answered by quoting exactly or withdrawing', () => {
    const { v, c } = one(probe('P9'), SOURCES(MAKAROVA), 'legal@0.0.1')
    expect([c.outcome, c.locked]).toEqual(['FAIL', false])
    expect(c.explanation).toMatch(/a partial match only/)
    expect(v.remedies![0]!.detail).toMatch(/partial match only.*Quote the passage the quotation comes from exactly, or withdraw it/)
    expect(v.remedies![0]!.detail).not.toMatch(/Conform/)
  })
})

// ── P10 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a cite paired with another opinion\'s text is never PASS (engine 0.6.0)', () => {
  it('before (engine 0.5.0), every rule PASSed the Axon cite against the Makarova text', () => {
    for (const rs of RULES) expect(one(probe('P10'), SOURCES(MAKAROVA), rs, '0.5.0').c.outcome, rs).toBe('PASS')
  })
  it('after, every rule abstains: the supplied text does not name the cite; it may be the wrong opinion', () => {
    for (const rs of RULES) {
      const { v, c } = one(probe('P10'), SOURCES(MAKAROVA), rs)
      expect([c.outcome, c.insufficiency?.reason, c.locked], rs).toEqual(['INSUFFICIENT_DATA', 'REFERENCE_NOT_PROVIDED', false])
      expect(c.insufficiency!.detail, rs).toMatch(/^the supplied text does not name Axon Enterprise, Inc\. v\. FTC, 598 U\.S\. 175; it may be the wrong opinion\. Not found in it: the reporter citation 598 U\.S\. 175; the party Axon Enterprise, Inc\.; the party FTC\./)
      expect(c.insufficiency!.missing, rs).toEqual(['cite', 'case_name'])
      expect(v.remedies!.map(r => r.detail), rs).toEqual([LEGAL_REMEDIES_060_UNBOUND.abstain![0]!.detail.replace('{field}', '598 U.S. 175')])
      expect(v.outcome, rs).toBe('INSUFFICIENT_DATA')
    }
  })
  it('the same quotation under the right cite PASSes, worded by the supplied text', () => {
    for (const rs of RULES) {
      const { c } = one(probe('P1'), SOURCES(MAKAROVA), rs)
      expect(c.outcome, rs).toBe('PASS')
      expect(c.explanation, rs).toBe('The quotation appears verbatim in the opinion text supplied for Makarova v. United States.')
    }
  })
  it('a text that names the parties but not the reporter citation is not bound (the circuit and district opinions share a caption)', () => {
    const { c } = one(probe('P1'), SOURCES(MAKAROVA_BODY), 'legal@0.2.0')
    expect([c.outcome, c.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', ['cite']])
    expect(c.insufficiency!.detail).toMatch(/Not found in it: the reporter citation 201 F\.3d 110\./)
  })
})

// ── the binding rule ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('what a text names (./binding.ts)', () => {
  it('a reporter citation: parts separated by spaces or periods; pin cites and parentheticals aside; digits bounded', () => {
    expect(parseReporterCite('201 F.3d 110, 113 (2d Cir. 2000)')).toEqual({ volume: '201', reporter: ['F', '3d'], page: '110' })
    expect(parseReporterCite('550 U.S. 544 at 570')).toEqual({ volume: '550', reporter: ['U', 'S'], page: '544' })
    expect(parseReporterCite('No. 21-86')).toBeUndefined()
    expect(citeNamed('Bell Atlantic Corp. v. Twombly, 550 U. S. 544 (2007)', '550 U.S. 544')).toEqual({ found: true, form: 'reporter' })
    expect(citeNamed('see 201 F. 3d 110', '201 F.3d 110').found).toBe(true)
    expect(citeNamed('see 1201 F.3d 110', '201 F.3d 110').found).toBe(false)
    expect(citeNamed('see 201 F.3d 1100', '201 F.3d 110').found).toBe(false)
    expect(citeNamed('see 201 F.2d 110', '201 F.3d 110').found).toBe(false)
    expect(citeNamed('Cite as: 598 U. S. ____ (2023)', '598 U.S. 175')).toEqual({ found: true, form: 'slip' })
    expect(citeNamed('Cite as: 597 U. S. ____ (2023)', '598 U.S. 175').found).toBe(false)
    expect(citeNamed('Docket No. 21-86, argued', 'No. 21-86')).toEqual({ found: true, form: 'literal' })
  })
  it('a case name: each party by a distinctive word, suffixes and procedural words aside', () => {
    expect(partiesOf('Axon Enterprise, Inc. v. FTC')).toEqual(['Axon Enterprise, Inc.', 'FTC'])
    expect(partiesOf('In re Daphnie E.')).toEqual(['In re Daphnie E.'])
    const n = (case_name: string, text: string) => namingOf('c', { case_name }, text)
    expect(n('Axon Enterprise, Inc. v. FTC', 'AXON ENTERPRISE, INC. v. FEDERAL TRADE COMMISSION; the FTC argues').bound).toBe(true)
    expect(n('Axon Enter., Inc. v. FTC', 'Axon Enterprise and the FTC').parties).toEqual([{ party: 'Axon Enter., Inc.', found: 'Axon' }, { party: 'FTC', found: 'FTC' }])
    expect(n('Enter. Grp. v. Jones', 'the Enterprise and Jones').parties).toEqual([{ party: 'Enter. Grp.', found: 'Enter.' }, { party: 'Jones', found: 'Jones' }])
    expect(n('U.S. Bank N.A. v. Doe', 'US Bank against Doe').bound).toBe(true)
    expect(n('Nat\'l Labor Relations Bd. v. Jones', 'the Labor board and Jones').bound).toBe(true)
    expect(n('Makarova v. United States', 'the United States').bound).toBe(false) // one party missing is not bound
    expect(n('Inc. v. Co.', 'Inc. and Co. agree').bound).toBe(true) // no distinctive word: the party must appear literally
    expect(n('Twombly', 'Twomblyesque').bound).toBe(false) // whole words only
  })
  it('a citation with neither a case name nor a reporter citation names no authority: nothing can be bound to it', () => {
    const c = verifyCitation({ id: 'x', source_key: 's', quote: 'a short passage' }, { s: 'Here is a short passage of text.' }, 'legal@0.1.0')
    expect([c.outcome, c.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', ['cite', 'case_name']])
    expect(c.insufficiency!.detail).toMatch(/Not found in it: any authority \(the citation gives no case name and no reporter citation\)/)
  })
})

// ── provenance ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('provenance: every supplied text is recorded, with what it names', () => {
  const origin = { text: MAKAROVA, source: 'case-law archive', url: 'https://example.org/opinions/201-f3d-110', retrieved_at: '2026-10-05T12:00:00Z' }
  it('key, sha256, length, the stated origin, and per citation what it names; texts sorted by key', () => {
    const v = verifyCitations([probe('P1'), probe('P10')], { '598 U.S. 175': MAKAROVA_BODY, '201 F.3d 110': origin }, { now: NOW, ruleset: 'legal@0.2.0' }) // 0.3.0 records the caption too (legal-030.test.ts)
    expect(v.opinion_sources).toEqual([
      { key: '201 F.3d 110', sha256: sha256(MAKAROVA), chars: MAKAROVA.length, source: 'case-law archive', url: 'https://example.org/opinions/201-f3d-110', retrieved_at: '2026-10-05T12:00:00Z',
        names: [{ claim_id: 'cite.P1', cite: { asked: '201 F.3d 110', found: true, form: 'reporter' }, parties: [{ party: 'Makarova', found: 'Makarova' }, { party: 'United States', found: 'United' }], bound: true }] },
      { key: '598 U.S. 175', sha256: sha256(MAKAROVA_BODY), chars: MAKAROVA_BODY.length,
        names: [{ claim_id: 'cite.P10', cite: { asked: '598 U.S. 175', found: false }, parties: [{ party: 'Axon Enterprise, Inc.', found: null }, { party: 'FTC', found: null }], bound: false }] },
    ])
    expect(Object.keys(v).at(-1)).toBe('scope')
  })
  it('the order the caller lists the texts in changes nothing: same verdict id, same bytes', () => {
    const a = verifyCitations([probe('P1')], { '201 F.3d 110': origin, '598 U.S. 175': MAKAROVA_BODY }, { now: NOW })
    const b = verifyCitations([probe('P1')], { '598 U.S. 175': MAKAROVA_BODY, '201 F.3d 110': origin }, { now: NOW })
    expect(b.verdict_id).toBe(a.verdict_id)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
  it('the stated origin is part of the input: a verdict made with it replays only with it', () => {
    const inputs = { citations: [probe('P1')], sources: { '201 F.3d 110': origin } }
    const v = verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.2.0' })
    expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    const relabelled = { ...inputs, sources: { '201 F.3d 110': { ...origin, source: 'somewhere else' } } }
    expect(verifyReplay(v, relabelled)).toMatchObject({ status: 'FAILED', input_ok: false })
  })
  it('an engine before 0.6.0 reads string texts only, as it always did, and records no provenance', () => {
    const v = verifyCitations([probe('P1')], { '201 F.3d 110': origin }, { now: NOW, engine: '0.5.0' })
    expect(v.claims[0]!.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
    expect(v.opinion_sources).toBeUndefined()
  })
  it('provenanceOf skips an entry with no text', () => {
    expect(provenanceOf({ a: '', b: { text: '' }, c: 'x' }, [])).toEqual([{ key: 'c', sha256: sha256('x'), chars: 1, names: [] }])
  })
})

// ── wording, remedies, replay ────────────────────────────────────────────────────────────────────────────────────────────

describe('wording limited to what the engine knows; remedies; replay', () => {
  it('no 0.6.0 verdict says an authority is real or speaks for "the opinion" on a PASS or a FAIL', () => {
    for (const rs of RULES) {
      for (const text of [MAKAROVA, MAKAROVA_BODY]) {
        const v = verifyCitations(PROBES, SOURCES(text), { now: NOW, ruleset: rs })
        expect(allText(v), rs).not.toMatch(/real authority/)
        for (const c of v.claims.filter(x => x.outcome !== 'INSUFFICIENT_DATA')) expect(c.explanation, `${rs} ${c.claim_id}`).toMatch(/the opinion text supplied for/)
      }
    }
  })
  it('the 0.6.0 remedy tables are well formed', () => {
    for (const [n, t] of [['0.0.1', LEGAL_REMEDIES_060], ['0.1.0', LEGAL_REMEDIES_V010_060], ['0.2.0', LEGAL_REMEDIES_V020_060], ['nearest', { CITE_VERBATIM: LEGAL_REMEDIES_060_NEAREST }], ['altered', { CITE_VERBATIM: LEGAL_REMEDIES_060_ALTERED }], ['unbound', { CITE_VERBATIM: LEGAL_REMEDIES_060_UNBOUND }]] as const) {
      expect(remedyTableProblems(t, `legal ${n} @0.6.0`), n).toEqual([])
    }
    expect(JSON.stringify([LEGAL_REMEDIES_060, LEGAL_REMEDIES_V010_060, LEGAL_REMEDIES_V020_060])).not.toMatch(/neither existence nor/)
  })
  it('an altered bracket under 0.2.0 FAILs, and its remedy restores the word the supplied text has', () => {
    const { v, c } = one(probe('P2'), SOURCES(MAKAROVA), 'legal@0.2.0')
    expect([c.outcome, c.computation?.operands.bracket, c.computation?.operands.replaces]).toEqual(['FAIL', '[must]', 'may'])
    expect(v.remedies![0]!.detail).toBe('The quotation attributed to 201 F.3d 110 changes the words of the opinion text supplied for it in a bracket ([must] for "may"). Restore the word the text has, or keep only a bracket that changes case, tense or a pronoun; the corrected brief is checked again.')
  })
  it('every 0.6.0 verdict replays byte for byte, and its verdict id differs from 0.5.0\'s for the same inputs', () => {
    for (const rs of RULES) {
      const inputs = { citations: PROBES, sources: SOURCES(MAKAROVA) }
      const v = verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: rs, engine: '0.6.0' })
      expect(v.engine_version).toBe('0.6.0')
      expect(verifyReplay(v, inputs), rs).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
      const old = verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: rs, engine: '0.5.0' })
      expect(old.verdict_id, rs).not.toBe(v.verdict_id)
      expect(verifyReplay(old, inputs), rs).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    }
  })
})

// ── the quotation rules themselves are unchanged ─────────────────────────────────────────────────────────────────────────

describe('once a text is bound, engine 0.6.0 reaches the outcomes 0.5.0 reached; only 0.0.1\'s coincidental passages change', () => {
  // Fixtures from test/legal-v010.test.ts and test/legal.test.ts (public-domain excerpts), each captioned for 0.6.0.
  const OP: Record<string, string> = {
    Garrett: 'the court cannot take on the responsibility of serving as the litigant’s attorney in constructing arguments and searching the record.',
    Keys: 'We must construe the complaint in the light most favorable to the plaintiff and accept all allegations as true.',
    Thompson: 'In the exercise of that power they may impose sanctions including, where appropriate, default or dismissal.',
    Celotex: 'summary judgment is proper “if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to a judgment as a matter of law.” In our view',
    Twombly: 'To survive a motion to dismiss, a complaint must contain sufficient factual matter to state a claim to relief that is plausible on its face. A pleading that offers labels and conclusions will not do.',
    Imm: 'We do not hold that qualified immunity shields the officer in these circumstances.',
    Makarova: MAKAROVA_BODY,
  }
  const QUOTES: [string, string, string?][] = [
    ['Garrett', 'serv[e] as the litigant’s attorney in constructing arguments and searching the record.'],
    ['Keys', 'construe the complaint in the light most favorable to plaintiff and accept all allegations as true.'],
    ['Keys', 'construe the complaint in the light most favorable to the plaintiff'],
    ['Thompson', '[i]n the exercise of that power they may impose sanctions including, where appropriate ... dismissal'],
    ['Thompson', '[i]n the exercise of that power, they may impose sanctions including, where appropriate ... dismissal'],
    ['Celotex', 'if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to judgment as a matter of law.'],
    ['Twombly', 'a claim to relief that is probable on its face'],
    ['Twombly', 'punitive damages are available as a matter of right in all actions'],
    ['Imm', 'hold that qualified immunity shields the officer'],
    ...PROBES.filter(p => p.quote !== undefined && p.case_name === M.case_name).map(p => ['Makarova', p.quote!, p.id] as [string, string, string]),
  ]
  const captioned = (name: string): string => `${name} v. Doe, 1 F.4th 1 (2026)\n${OP[name]}`
  const outcomeOf = (c: ClaimVerdict): string => `${c.outcome}${c.insufficiency ? `:${c.insufficiency.reason}` : ''}${c.computation?.operands.nearest_passage !== undefined ? ':nearest' : ''}`
  for (const rs of RULES) {
    it(rs, () => {
      const changed: string[] = []
      for (const [k, [name, quote, id]] of QUOTES.entries()) {
        const before = verifyCitation({ id: 'q', case_name: name, quote }, { [name]: OP[name]! }, rs, '0.5.0')
        const after = verifyCitation({ id: 'q', case_name: `${name} v. Doe`, cite: '1 F.4th 1', quote, source_key: name }, { [name]: captioned(name) }, rs)
        if (outcomeOf(before) !== outcomeOf(after)) changed.push(`${id ?? `${name}#${k}`}: ${outcomeOf(before)} -> ${outcomeOf(after)}`)
      }
      if (rs === 'legal@0.0.1') {
        // 0.0.1 at 0.5.0 FAILed on any 3 coincident words; at 0.6.0 it names a passage only on 0.1.0's rule
        expect(changed).toEqual([
          'P8: FAIL -> INSUFFICIENT_DATA:SPAN_NOT_FOUND',
          'P9: FAIL -> FAIL:nearest',
        ])
      } else expect(changed).toEqual([])
    })
  }
})

// ── the audit and the surfaces ───────────────────────────────────────────────────────────────────────────────────────────

describe('the audit, HTTP and MCP under engine 0.6.0', () => {
  const origin = { text: MAKAROVA, source: 'case-law archive', retrieved_at: '2026-10-05' }
  it('the audit says what the check is against and lists each opinion text with its sha256', () => {
    const audit = renderCitationAudit(verifyCitations([probe('P1'), probe('P10')], { '201 F.3d 110': origin, '598 U.S. 175': MAKAROVA_BODY }, { now: NOW }))
    expect(audit).toMatch(/appears verbatim in the opinion text supplied for its cite, and that the text names the cite/)
    expect(audit).toMatch(/It does NOT check that an authority exists or is good law/)
    expect(audit).toMatch(/does NOT decide whether an authority \*stands for\* a proposition/)
    expect(audit).toContain(`- \`201 F.3d 110\` — case-law archive, retrieved 2026-10-05; sha256 \`${sha256(MAKAROVA)}\``)
    expect(audit).not.toMatch(/existence check/)
  })
  it('an engine 0.5.0 audit keeps its words', () => {
    expect(renderCitationAudit(verifyCitations([probe('P1')], SOURCES(MAKAROVA), { now: NOW, engine: '0.5.0' }))).toMatch(/verbatim-quotation \+ existence check/)
  })
  it('HTTP and MCP take a text with its origin and return the provenance block', () => {
    const body = { citations: [probe('P1')], sources: { '201 F.3d 110': origin } }
    const h = route({ method: 'POST', path: '/v1/verify/citations', body }).json as LegalVerdict
    expect([h.outcome, h.opinion_sources?.[0]?.source]).toEqual(['PASS', 'case-law archive'])
    const r = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_citations', arguments: body } } as JsonRpcRequest)!
    const m = (r.result as { structuredContent: LegalVerdict }).structuredContent
    expect([m.outcome, m.opinion_sources?.[0]?.sha256]).toEqual(['PASS', sha256(MAKAROVA)])
  })
})

// ── the citations verb ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('verify citations <citations.json> --sources <dir> (src/legal/cli-citations.ts)', () => {
  const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (s: string) => { o.out += s }, err: (s: string) => { o.err += s }, now: NOW } } }
  const folder = (withManifest: boolean): { dir: string; file: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-citations-'))
    const src = join(dir, 'opinions')
    mkdirSync(src)
    if (withManifest) {
      writeFileSync(join(src, 'makarova.txt'), MAKAROVA)
      writeFileSync(join(src, 'sources.json'), JSON.stringify({ '201 F.3d 110': { file: 'makarova.txt', source: 'case-law archive', url: 'https://example.org/m', retrieved_at: '2026-10-05' }, '598 U.S. 175': { file: 'makarova.txt' } }))
    } else {
      writeFileSync(join(src, '201 F.3d 110.txt'), MAKAROVA)
      writeFileSync(join(src, '598 U.S. 175.txt'), MAKAROVA)
    }
    const file = join(dir, 'brief.json')
    writeFileSync(file, JSON.stringify({ citations: [probe('P1'), probe('P8'), probe('P10')] }))
    return { dir: src, file }
  }
  it('prints one line per citation, PASS / FAIL / INSUFFICIENT_DATA, on stderr, then the opinion texts with their origin; exit 2 when some could not be checked', () => {
    const { dir, file } = folder(true)
    const { o, io: x } = io()
    expect(runCitations([file, '--sources', dir], x)).toBe(2)
    expect(o.out).toBe('') // 2026-10-05: the report is on stderr; stdout carries the verdict only with --json
    expect(o.err).toMatch(/^citations: 3 checked under legal@0\.5\.4 \(engine 0\.7\.2\)/) // the default rule under the current engine (legal@0.5.2 under 0.6.0 on 2026-10-06; legal@0.5.3 from 2026-10-13; legal@0.5.4 from engine 0.7.2, 2026-10-14)
    expect(o.err).toMatch(/\nPASS {14}cite\.P1  Makarova v\. United States, 201 F\.3d 110\n/)
    expect(o.err).toMatch(/\nINSUFFICIENT_DATA cite\.P8  Makarova v\. United States, 201 F\.3d 110  \[SPAN_NOT_FOUND\]\n/)
    expect(o.err).toMatch(/\nINSUFFICIENT_DATA cite\.P10  Axon Enterprise, Inc\. v\. FTC, 598 U\.S\. 175  \[REFERENCE_NOT_PROVIDED\]\n/)
    expect(o.err).not.toMatch(/ABSTAIN|PASS_WITH_OPEN/)
    expect(o.err).toContain(`  201 F.3d 110: case-law archive, https://example.org/m, retrieved 2026-10-05; sha256 ${sha256(MAKAROVA)}`)
    expect(o.err).toMatch(/for cite\.P10: its caption reads Natalia Makarova v\. United States of America, 201 F\.3d 110; the caption does NOT name the citation \(598 U\.S\. 175 NOT named; Axon Enterprise, Inc\. NOT named; FTC NOT named\)/)
    expect(o.err).toMatch(/\nverdict: PASS-WITH-OPEN: every citation that could be checked held, but some could not be checked \(1 pass, 0 fail, 2 can't tell\)/)
    expect(o.err).toMatch(/Not checked: that an authority exists, is good law, or stands for a proposition\./)
  })
  it('without a manifest, each .txt file is the text for its name; --ruleset, --json and --bundle; the bundle replays', () => {
    const { dir, file } = folder(false)
    const { o, io: x } = io()
    const bundle = join(dir, '..', 'bundle.json')
    expect(runCitations([file, '--sources', dir, '--ruleset', 'legal@0.2.0', '--json', '--bundle', bundle], x)).toBe(2)
    const v = JSON.parse(o.out) as LegalVerdict
    expect(v.ruleset.version).toBe('0.2.0')
    expect(v.opinion_sources!.map(p => [p.key, p.source])).toEqual([['201 F.3d 110', 'file 201 F.3d 110.txt'], ['598 U.S. 175', 'file 598 U.S. 175.txt']])
    expect(o.err).toMatch(/^citations: 3 checked under legal@0\.2\.0/)
    const b = JSON.parse(readFileSync(bundle, 'utf8')) as { verdict: LegalVerdict; inputs: unknown }
    expect(verifyReplay(b.verdict, b.inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
  })
  it('exit 0 on PASS, 1 on FAIL, 3 on usage or input errors (never a stack trace)', () => {
    const { dir } = folder(true)
    const pass = join(dir, '..', 'pass.json'); writeFileSync(pass, JSON.stringify([probe('P1')]))
    const fail = join(dir, '..', 'fail.json'); writeFileSync(fail, JSON.stringify([probe('P3')]))
    expect(runCitations([pass, '--sources', dir], io().io)).toBe(0)
    expect(runCitations([fail, '--sources', dir], io().io)).toBe(1)
    const bad = io()
    expect(runCitations([pass], bad.io)).toBe(3)
    expect(runCitations([pass, '--sources', join(dir, 'nope')], bad.io)).toBe(3)
    expect(runCitations([pass, '--sources', dir, '--ruleset', 'legal@9'], bad.io)).toBe(3)
    const dup = join(dir, '..', 'dup.json'); writeFileSync(dup, JSON.stringify([probe('P1'), probe('P1')]))
    expect(runCitations([dup, '--sources', dir], bad.io)).toBe(3)
    expect(bad.o.err).toMatch(/citation id "P1" appears twice/)
    expect(bad.o.err).not.toMatch(/at .*\.ts:\d+/)
    const u = io() // a usage error is one line and a pointer, as the rest of the CLI prints one; --help prints the whole text
    expect(runCitations([pass, '--frob'], u.io)).toBe(3)
    expect(u.o.err).toBe('verify citations: unknown flag --frob\nsee: verify citations --help\n')
    const h = io()
    expect(runCitations(['--help'], h.io)).toBe(0)
    expect(h.o.err).toMatch(/^usage: verify citations <citations\.json> --sources <dir>/)
  })
  it('is the CLI verb `verify citations`: the worked example in docs/examples runs and FAILs on its misquote', () => {
    let out = '', stdout = ''
    const code = run(['citations', join(EXAMPLES, 'legal-citations.json'), '--sources', join(EXAMPLES, 'legal-opinions')], { out: (s: string) => { stdout += s }, err: (s: string) => { out += s } })
    expect(code).toBe(1)
    expect(stdout).toBe('') // 2026-10-05: the report is on stderr
    expect(out).toMatch(/^citations: 5 checked under legal@0\.5\.4 \(engine 0\.7\.2\)/)
    expect(out.match(/^(PASS|FAIL|INSUFFICIENT_DATA) +cite\.p\d/gm)!.map(l => l.replace(/ +/, ' '))).toEqual(['PASS cite.p1', 'FAIL cite.p2', 'INSUFFICIENT_DATA cite.p3', 'INSUFFICIENT_DATA cite.p4', 'INSUFFICIENT_DATA cite.p5'])
    // legal@0.4.0: the words that differ, and the passage as whole sentences
    expect(out).toContain('Where they differ: the quotation leaves out "only". The passage there reads: "The FTCA waives the government’s sovereign immunity only for: claims against the United States')
  })
  it('refuses a manifest file outside the folder and a text that is not UTF-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-citations-bad-'))
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ k: { file: '../outside.txt' } }))
    expect(() => loadOpinionFolder(dir)).toThrow(/outside the folder/)
    const dir2 = mkdtempSync(join(tmpdir(), 'riposte-citations-bad2-'))
    writeFileSync(join(dir2, 'k.txt'), Buffer.from([0x66, 0xff, 0x66]))
    expect(() => loadOpinionFolder(dir2)).toThrow(/not valid UTF-8/)
    const f = join(dir2, 'c.json'); writeFileSync(f, JSON.stringify({ citations: [{ id: 'a', quote: 1 }] }))
    expect(() => readCitationsFile(f)).toThrow(/"quote" is not a string/)
  })
})

// ── owner rulings 2026-10-05: the default rule, the labelled parties-only tier, strict UTF-8 ─────────────────────────────

describe('the default legal rule: 0.4.0 for a new verdict under engine 0.6.0, 0.0.1 under earlier engines', () => {
  it('no ruleset and the bare name "legal" issue legal@0.5.3 (2026-10-13; legal@0.5.2 under engine 0.6.0); a named version is issued as named; a replay names its version', () => {
    const inputs = { citations: [probe('P1'), probe('P2')], sources: SOURCES(MAKAROVA) }
    const v = verifyCitations(inputs.citations, inputs.sources, { now: NOW })
    expect(v.ruleset).toEqual({ id: 'legal', version: '0.5.4', domain: 'legal' }) // the default from engine 0.7.2 (2026-10-14)
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.5.0' }).ruleset.version).toBe('0.5.0')
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.4.0' }).ruleset.version).toBe('0.4.0')
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.3.0' }).ruleset.version).toBe('0.3.0')
    expect(() => verifyCitations(inputs.citations, inputs.sources, { now: NOW, engine: '0.5.0', ruleset: 'legal@0.4.0' })).toThrow(/legal@0\.4\.0 needs engine 0\.6\.0 or later/)
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal' }).verdict_id).toBe(v.verdict_id)
    expect(v.claims.map(c => c.outcome)).toEqual(['PASS', 'FAIL']) // the meaning guard: "[must]" for "may" FAILs
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.2.0' }).ruleset.version).toBe('0.2.0')
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, ruleset: 'legal@0.0.1' }).ruleset.version).toBe('0.0.1')
    expect(verifyCitations(inputs.citations, inputs.sources, { now: NOW, engine: '0.5.0' }).ruleset.version).toBe('0.0.1')
    expect(() => verifyCitations(inputs.citations, inputs.sources, { now: NOW, engine: '0.5.0', ruleset: 'legal@0.3.0' })).toThrow(/legal@0\.3\.0 needs engine 0\.6\.0 or later/)
    expect(verifyReplay(v, inputs)).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
  })
})

describe('the parties-only tier under legal@0.2.0: opt-in per text (bind "parties"), labelled everywhere, a stated choice in the ledger', () => {
  const body = (bind?: 'parties' | 'strict') => ({ '201 F.3d 110': { text: MAKAROVA_BODY, source: 'case-law archive', ...(bind ? { bind } : {}) } })
  const R020 = { now: NOW, ruleset: 'legal@0.2.0' } // legal@0.3.0's tier: legal-030.test.ts
  it('a text that names both parties but not the reporter citation is checked under bind "parties", and says so', () => {
    const v = verifyCitations([probe('P1')], body('parties'), R020)
    const c = v.claims[0]!
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toBe('The quotation appears verbatim in the opinion text supplied for Makarova v. United States. Bound by parties only: the reporter citation 201 F.3d 110 is not found in the supplied text (bind "parties", stated by the caller).')
    expect(v.opinion_sources![0]).toMatchObject({ bind: 'parties', names: [{ claim_id: 'cite.P1', bound: true, tier: 'parties-only', note: PARTIES_ONLY_NOTE, cite: { asked: '201 F.3d 110', found: false } }] })
    expect(PARTIES_ONLY_NOTE).toBe('bound by parties only; reporter citation not found in text')
    expect(v.choices).toEqual([{ id: 'binding:201 F.3d 110', kind: 'selection', status: 'stated', value: 'parties', source: { span: { section: 'sources["201 F.3d 110"].bind', quote: 'parties' } }, load_bearing: true, detail: expect.stringMatching(/^stated by the caller/) }])
    expect(renderCitationAudit(v)).toContain('Bound by parties only')
  })
  it('strict, stated or by default, refuses that text as before; the ledger records the binding, never unstated', () => {
    for (const [bind, status, source] of [['strict', 'stated', { span: { section: 'sources["201 F.3d 110"].bind', quote: 'strict' } }], [undefined, 'supplied', { default: 'strict', by: 'ruleset' }]] as const) {
      const v = verifyCitations([probe('P1')], body(bind), R020)
      expect([v.claims[0]!.outcome, v.claims[0]!.insufficiency?.missing], String(bind)).toEqual(['INSUFFICIENT_DATA', ['cite']])
      expect(v.claims[0]!.insufficiency!.detail, String(bind)).toMatch(/The text names every party: supplied with bind "parties", it would be checked, labelled as bound by parties only\.$/)
      expect(v.choices, String(bind)).toEqual([{ id: 'binding:201 F.3d 110', kind: 'selection', status, value: 'strict', source, load_bearing: true, detail: expect.stringMatching(/^strict binding/) }])
    }
  })
  it('bind "parties" never binds a text that does not name every party (P10 stays the wrong opinion); a bound text records no choice unless stated', () => {
    const p10 = verifyCitations([probe('P10')], { '598 U.S. 175': { text: MAKAROVA, bind: 'parties' } }, R020)
    expect([p10.claims[0]!.outcome, p10.claims[0]!.insufficiency?.missing]).toEqual(['INSUFFICIENT_DATA', ['cite', 'case_name']])
    expect(p10.choices).toEqual([expect.objectContaining({ status: 'stated', value: 'parties', load_bearing: false })])
    expect(verifyCitations([probe('P1')], SOURCES(MAKAROVA), R020).choices).toBeUndefined()
  })
  it('the binding is part of the input: another bind is another input hash; a parties verdict replays', () => {
    const a = verifyCitations([probe('P1')], body('parties'), R020), b = verifyCitations([probe('P1')], body('strict'), R020)
    expect(a.input_hash).not.toBe(b.input_hash)
    expect(verifyReplay(a, { citations: [probe('P1')], sources: body('parties') })).toMatchObject({ status: 'REPERFORMED', reperformed: { identical: true } })
    expect(verifyReplay(a, { citations: [probe('P1')], sources: body('strict') })).toMatchObject({ status: 'FAILED', input_ok: false })
  })
  it('the CLI: --bind parties checks it, labelled; --bind strict refuses it; a bad --bind or manifest bind is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-bind-'))
    writeFileSync(join(dir, '201 F.3d 110.txt'), MAKAROVA_BODY)
    const brief = join(dir, '..', `bind-${Date.now()}.json`); writeFileSync(brief, JSON.stringify([probe('P1')]))
    const cap = () => { const o = { out: '', err: '' }; return { o, io: { out: (x: string) => { o.out += x }, err: (x: string) => { o.err += x }, now: NOW } } }
    const p = cap(); expect(runCitations([brief, '--sources', dir, '--bind', 'parties', '--ruleset', 'legal@0.2.0'], p.io)).toBe(0)
    expect(p.o.err).toMatch(/for cite\.P1: BOUND BY PARTIES ONLY \(bind "parties"; the reporter citation is not in the text\)/)
    expect(p.o.err).toMatch(/; bind parties\n/)
    const st = cap(); expect(runCitations([brief, '--sources', dir, '--bind', 'strict', '--ruleset', 'legal@0.2.0'], st.io)).toBe(2)
    expect(st.o.err).toMatch(/INSUFFICIENT_DATA cite\.P1 .*\[REFERENCE_NOT_PROVIDED\]/)
    const bad = cap(); expect(runCitations([brief, '--sources', dir, '--bind', 'loose'], bad.io)).toBe(3)
    expect(bad.o.err).toBe('verify citations: --bind takes strict or parties (got loose)\nsee: verify citations --help\n')
    const mdir = mkdtempSync(join(tmpdir(), 'riposte-bind-m-'))
    writeFileSync(join(mdir, 'm.txt'), MAKAROVA_BODY)
    writeFileSync(join(mdir, 'sources.json'), JSON.stringify({ '201 F.3d 110': { file: 'm.txt', bind: 'loose' } }))
    expect(() => loadOpinionFolder(mdir)).toThrow(/"201 F\.3d 110"\.bind is "loose"; it is "strict" or "parties"/)
    writeFileSync(join(mdir, 'sources.json'), JSON.stringify({ '201 F.3d 110': { file: 'm.txt', bind: 'parties' } }))
    expect(loadOpinionFolder(mdir)['201 F.3d 110']).toMatchObject({ bind: 'parties' })
    expect(loadOpinionFolder(mdir, 'strict')['201 F.3d 110']).toMatchObject({ bind: 'strict' }) // the flag sets every text
  })
})

describe('the citations reader is strict UTF-8: a byte-order mark or a non-UTF-8 byte is refused with its offset, never stripped', () => {
  it('an opinion text or a citations file with a byte-order mark is refused (two files must never share one input_hash)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riposte-bom-'))
    writeFileSync(join(dir, 'k.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MAKAROVA, 'utf8')]))
    expect(() => loadOpinionFolder(dir)).toThrow(/k\.txt starts with a UTF-8 byte-order mark \(bytes EF BB BF at offset 0\)\. A text is hashed byte for byte and the mark is not stripped silently/)
    const f = join(dir, 'c.json'); writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify([probe('P1')]), 'utf8')]))
    expect(() => readCitationsFile(f)).toThrow(/byte-order mark/)
    const g = join(dir, 'g.txt'); writeFileSync(g, Buffer.from([0x61, 0x62, 0xff, 0x63]))
    const d2 = mkdtempSync(join(tmpdir(), 'riposte-bad8-')); writeFileSync(join(d2, 'g.txt'), Buffer.from([0x61, 0x62, 0xff, 0x63]))
    expect(() => loadOpinionFolder(d2)).toThrow(/g\.txt is not valid UTF-8: the bytes at offset 2 \(FF 63\)/)
  })
})
