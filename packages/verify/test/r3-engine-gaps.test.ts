/**
 * Engine gaps (2026-10-03), found by the lien-waiver demo and the structured-input work:
 *   1. an open ABSTAIN holds at a gate (gateStatus: PASS vs PASS-WITH-OPEN)
 *   2. applies_if: a declarative check's applicability is decided BEFORE the missing-field test
 *   3. a declarative ruleset's source-text axis (its `quotes`, and the caller's) runs from the library and the CLI
 *   4. identifiers compare punctuation-insensitively; remedies print the document's own strings and money as money
 *
 * Fixtures: test/fixtures/lien-waiver/ (the demo's 30 synthetic cases and its v0.1.0 ruleset, copied byte for byte; v0.2.0
 * states the form table's not-applicable blanks as applies_if and its required phrases as quotes).
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateStatus, lintRuleset, openClaims, verify, verifyDeclarative, type DeclarativeRuleset, type Verdict } from '../src/index'
import { identifierKey, formatMoney } from '../src/declarative/evaluate'
import { run, type CliIO } from '../src/cli'

const HERE = join(__dirname, 'fixtures', 'lien-waiver')
const V1 = JSON.parse(readFileSync(join(HERE, 'lien-waiver-v0.1.0.ruleset.json'), 'utf8')) as DeclarativeRuleset
const V2 = JSON.parse(readFileSync(join(HERE, 'lien-waiver-v0.2.0.ruleset.json'), 'utf8')) as DeclarativeRuleset
interface LwCase { id: string; label: 'clean' | 'defect'; form: string; defect: string | null; defect_field: string | null; expected_outcome: string; expected_rules: string[]; extraction: Record<string, any>; waiver_text: string }
const CASES = (JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as { cases: LwCase[] }).cases
const NOW = () => new Date('2026-10-03T00:00:00Z')
const byId = (id: string): LwCase => CASES.find(c => c.id === id)!
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const v2 = (c: LwCase, extraction = c.extraction, text: string | undefined = c.waiver_text): Verdict =>
  verify(extraction, { ruleset: V2, now: NOW, ...(text !== undefined ? { source: { text } } : {}) })

describe('an open ABSTAIN holds at a gate', () => {
  it('gateStatus: PASS only when every deterministic claim ran and held; a PASS verdict with an open claim reads PASS-WITH-OPEN', () => {
    const claim = (outcome: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA', tier = 'DETERMINISTIC') => ({ outcome, tier })
    expect(gateStatus({ outcome: 'PASS', claims: [claim('PASS'), claim('PASS')] })).toBe('PASS')
    expect(gateStatus({ outcome: 'PASS', claims: [claim('PASS'), claim('INSUFFICIENT_DATA')] })).toBe('PASS-WITH-OPEN')
    expect(gateStatus({ outcome: 'FAIL', claims: [claim('FAIL'), claim('INSUFFICIENT_DATA')] })).toBe('FAIL')
    expect(gateStatus({ outcome: 'INSUFFICIENT_DATA', claims: [claim('INSUFFICIENT_DATA')] })).toBe('INSUFFICIENT_DATA')
    // judgement never hardens a gate
    expect(gateStatus({ outcome: 'PASS', claims: [claim('PASS'), claim('INSUFFICIENT_DATA', 'REASONED')] })).toBe('PASS')
  })

  it('the demo\'s two can\'t-tell defects: verify\'s own outcome is PASS (ANY_FAIL_FAILS), the gate reading holds', () => {
    // F25 (an exception amount with no date) under the demo's own v0.1.0 ruleset, no harness rule
    const f25 = verify(byId('F25').extraction, { ruleset: V1, now: NOW })
    expect(f25.outcome).toBe('PASS')
    expect(gateStatus(f25)).toBe('PASS-WITH-OPEN')
    expect(openClaims(f25).map(c => c.rule_id)).toContain('LW_EXC_DATED')
    // F24 (the statutory NOTICE missing): the required phrase is a QUOTE_MATCH claim that cannot be found
    const f24 = v2(byId('F24'))
    expect(f24.outcome).toBe('PASS')
    expect(gateStatus(f24)).toBe('PASS-WITH-OPEN')
    expect(openClaims(f24).map(c => [c.claim_id, c.insufficiency?.reason])).toEqual([['source.TX-53.284(c).notice', 'SPAN_NOT_FOUND']])
  })

  it('the CLI with --gate: exit 0 only on a clean PASS; PASS-WITH-OPEN exits 2 and names the open checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r3-gate-'))
    const rs = join(dir, 'lw.json'); writeFileSync(rs, JSON.stringify(V2))
    const go = (c: LwCase, gate: boolean) => {
      const doc = join(dir, `${c.id}.json`), txt = join(dir, `${c.id}.txt`)
      writeFileSync(doc, JSON.stringify(c.extraction)); writeFileSync(txt, c.waiver_text)
      let out = '', err = ''
      const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
      const code = run([doc, '--ruleset', rs, '--source', txt, ...(gate ? ['--gate'] : [])], io)
      return { code, err, verdict: JSON.parse(out) as Verdict }
    }
    expect(go(byId('F01'), true).code).toBe(0)
    const f24 = go(byId('F24'), true)
    expect(f24.verdict.outcome).toBe('PASS')
    expect(f24.code).toBe(2)
    expect(f24.err).toContain('PASS-WITH-OPEN')
    expect(f24.err).toContain('source.TX-53.284(c).notice (SPAN_NOT_FOUND)')
    // without --gate the exit code is the same from 2026-10-05 (the CLI fails closed; it read the verdict's outcome before, 0
    // here). 2026-10-19: --allow-open is no way back to 0 here: F24's open check is a required passage the waiver does not carry
    // (SPAN_NOT_FOUND), and --allow-open accepts only checks that wait on a reference or a field the document does not carry
    expect(go(byId('F24'), false).code).toBe(2)
    let allowErr = ''
    expect(run([join(dir, 'F24.json'), '--ruleset', rs, '--source', join(dir, 'F24.txt'), '--allow-open'], { out: () => {}, err: s => { allowErr += s } })).toBe(2)
    expect(allowErr).toContain('--allow-open does not apply')
    expect(allowErr).toContain('source.TX-53.284(c).notice (SPAN_NOT_FOUND)')
  })
})

describe('applies_if: a blank the form does not have is skipped, not flagged', () => {
  it('v0.2.0 (applies_if + quotes) over the 30 cases with their text, no form table and no hold rule: 20/20 clean PASS, 10/10 defects held', () => {
    const rows = CASES.map(c => ({ c, v: v2(c) }))
    for (const { c, v } of rows.filter(r => r.c.label === 'clean')) {
      expect([c.id, gateStatus(v)]).toEqual([c.id, 'PASS'])
      expect(openClaims(v)).toEqual([])
    }
    for (const { c, v } of rows.filter(r => r.c.label === 'defect')) {
      const s = gateStatus(v)
      expect([c.id, s === 'PASS']).toEqual([c.id, false])
      expect([c.id, s]).toEqual([c.id, c.expected_outcome === 'ABSTAIN' ? 'PASS-WITH-OPEN' : 'FAIL'])
      // every defect's own rule is among the non-PASS claims, and a remedy names the defect's field
      const caught = new Set(v.claims.filter(x => x.outcome !== 'PASS').map(x => x.rule_id))
      for (const r of c.expected_rules) expect([c.id, caught.has(r)]).toEqual([c.id, true])
      expect([c.id, (v.remedies ?? []).some(r => r.operand?.path === c.defect_field)]).toEqual([c.id, true])
    }
  })

  it('on a final form the Through Date check is not applicable: no claim, listed with the condition that ruled it out', () => {
    const f = CASES.find(c => c.label === 'clean' && c.form === 'CA-8138')!
    const v = v2(f)
    expect(v.claims.some(c => c.rule_id === 'LW_THROUGH')).toBe(false)
    const na = v.not_applicable!.find(n => n.rule_id === 'LW_THROUGH')!
    expect(na.claim_id).toBe('document.LW_THROUGH')
    expect(na.detail).toBe('applies_if: FORM_FINAL = 0 does not hold (1 vs 0)')
    // the other forms' statutory phrases are not applicable either; this form's three are checked and PASS
    expect(v.claims.filter(c => c.kind === 'QUOTE_MATCH').map(c => [c.claim_id, c.outcome])).toEqual([
      ['source.CA-8138.title', 'PASS'], ['source.CA-8138.notice', 'PASS'], ['source.CA-8138.paid', 'PASS']])
    expect(v.not_applicable!.filter(n => n.rule_id === 'QUOTE_MATCH')).toHaveLength(21)
    // the same document under v0.1.0 abstains FIELD_MISSING there (what the demo's form table had to excuse)
    const old = verify(f.extraction, { ruleset: V1, now: NOW })
    expect(old.claims.find(c => c.rule_id === 'LW_THROUGH')?.insufficiency?.reason).toBe('FIELD_MISSING')
    expect(gateStatus(old)).toBe('PASS-WITH-OPEN')
  })

  it('a real gap on a form that HAS the blank still abstains (CA 8132 with no Through Date read)', () => {
    const d = clone(byId('F01').extraction); delete d.waiver.through_date
    const v = v2(byId('F01'), d)
    const c = v.claims.find(x => x.rule_id === 'LW_THROUGH')!
    expect(c.insufficiency?.reason).toBe('FIELD_MISSING')
    expect(gateStatus(v)).toBe('PASS-WITH-OPEN')
  })

  it('applicability that cannot be decided abstains, naming the field: never skipped on a guess', () => {
    const d = clone(byId('F01').extraction); delete d.waiver.form.state
    const v = verify(d, { ruleset: V2, now: NOW, source: { text: byId('F01').waiver_text } })
    const c = v.claims.find(x => x.rule_id === 'LW_THROUGH')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toEqual({ reason: 'FIELD_MISSING', detail: 'cannot tell whether this applies: FORM_STATE not reported', missing: ['FORM_STATE'] })
    // the quotes, too: every form's phrases are of unknown applicability, so none is silently dropped
    expect(v.claims.filter(x => x.kind === 'QUOTE_MATCH' && x.outcome === 'INSUFFICIENT_DATA').length).toBe(24)
  })

  it('lint: the v0.2.0 ruleset lints clean; malformed applies_if and quotes are refused with a reason', () => {
    expect(lintRuleset(V2).errors).toEqual([])
    const bad = clone(V2) as any
    bad.checks[0].applies_if = [{ field: 'WAIVER_AMOUNT', in: ['CA'] }, { field: 'FORM_STATE', in: [] }, { field: 'FORM_STATE', in: ['CA'], not_in: ['TX'] }, { left: 'NOPE', op: '=', right: '1' }]
    bad.quotes.push({ id: bad.quotes[0].id, quote: '' })
    const errs = lintRuleset(bad).errors.join('\n')
    expect(errs).toContain(`"field" must name an 'identifier' or 'string' field (got "WAIVER_AMOUNT")`)
    expect(errs).toContain('"in" must be a non-empty array of non-empty strings')
    expect(errs).toContain('give exactly one of "in" or "not_in"')
    expect(errs).toContain('references unknown role "NOPE"')
    expect(errs).toContain('duplicate id "CA-8132.title"')
    expect(errs).toContain('"quote" must be a non-empty string')
  })

  it('a ruleset that uses neither applies_if nor quotes is unchanged: no not_applicable, the same verdict_id and bytes', () => {
    const a = verifyDeclarative(byId('F03').extraction, V1, { now: NOW })
    expect(a.not_applicable).toBeUndefined()
    expect(a.references.source).toBe(false)
    expect(verify(byId('F03').extraction, { ruleset: V1, now: NOW })).toEqual(a)
  })
})

describe('the source-text axis for a declarative ruleset, from the library and the CLI', () => {
  it('with --source: the required phrases are checked verbatim; the source is part of the input the verdict is bound to', () => {
    const c = byId('F11')
    const without = verify(c.extraction, { ruleset: V2, now: NOW })
    const withText = v2(c)
    expect(withText.references.source).toBe(true)
    expect(without.references.source).toBe(false)
    expect(withText.input_hash).not.toBe(without.input_hash)
    expect(withText.claims.filter(x => x.kind === 'QUOTE_MATCH').every(x => x.outcome === 'PASS' && x.evidence[0]?.locator.kind === 'span')).toBe(true)
  })

  it('without the source text a required phrase is an open check (REFERENCE_NOT_PROVIDED), so the gate holds', () => {
    const v = verify(byId('F11').extraction, { ruleset: V2, now: NOW })
    const q = v.claims.filter(x => x.kind === 'QUOTE_MATCH')
    expect(q.length).toBe(3)
    expect(q.every(x => x.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED')).toBe(true)
    expect(v.outcome).toBe('PASS')
    expect(gateStatus(v)).toBe('PASS-WITH-OPEN')
  })

  it('a changed word in the notice FAILs with the source\'s own words, and the declared phrase remedy names the field (probe P6)', () => {
    const c = byId('F01')
    const v = v2(c, c.extraction, c.waiver_text.replace('EFFECTIVE ON RECEIPT OF PAYMENT', 'EFFECTIVE ON SIGNING'))
    const fail = v.claims.find(x => x.kind === 'QUOTE_MATCH' && x.outcome === 'FAIL')!
    expect(fail.claim_id).toBe('source.CA-8132.notice')
    expect(v.remedies!.some(r => r.kind === 'authority' && r.authority === 'counsel' && r.claims.includes('source.CA-8132.notice'))).toBe(true)
    expect(v.remedies!.some(r => r.operand?.path === 'CA-8132.notice')).toBe(true)
  })

  it('the CLI runs the phrase check for a declarative ruleset (it used to ignore --source for one), and --quotes adds the caller\'s own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r3-src-'))
    const c = byId('F21')
    const doc = join(dir, 'd.json'), txt = join(dir, 'w.txt'), rs = join(dir, 'lw.json'), q = join(dir, 'q.json')
    writeFileSync(doc, JSON.stringify(c.extraction)); writeFileSync(txt, c.waiver_text); writeFileSync(rs, JSON.stringify(V1))
    writeFileSync(q, JSON.stringify([{ id: 'notice', quote: 'NOTICE: THIS DOCUMENT WAIVES THE CLAIMANT\'S LIEN', label: 'CA-8132 notice' }]))
    let out = ''
    const io: CliIO = { out: s => { out += s }, err: () => {} }
    run([doc, '--ruleset', rs, '--source', txt, '--quotes', q], io)
    const v = JSON.parse(out) as Verdict
    expect(v.references.source).toBe(true)
    const claim = v.claims.find(x => x.claim_id === 'source.notice')!
    expect(claim.kind).toBe('QUOTE_MATCH')
    // the same through the library
    const lib = verify(c.extraction, { ruleset: V1, now: () => new Date(v.issued_at), source: { text: c.waiver_text, quotes: [{ id: 'notice', quote: 'NOTICE: THIS DOCUMENT WAIVES THE CLAIMANT\'S LIEN', label: 'CA-8132 notice' }] } })
    expect(lib).toEqual(v)
    // --quotes without --source is refused
    let err = ''
    expect(run([doc, '--ruleset', rs, '--quotes', q], { out: () => {}, err: s => { err += s } })).toBe(3)
    expect(err).toContain('--quotes are found in --source')
  })
})

describe('identifiers compare punctuation-insensitively; remedies print what the document says', () => {
  it('identifierKey: punctuation is ignored, except that a separator between digits stays a separator', () => {
    const same = (a: string, b: string) => identifierKey(a.replace(/\s+/g, '').toUpperCase()) === identifierKey(b.replace(/\s+/g, '').toUpperCase())
    expect(same('Paxwick Builders, Inc.', 'Paxwick Builders Inc.')).toBe(true)
    expect(same('PO-1001', 'PO1001')).toBe(true)
    expect(same('INV/2026/001', 'INV-2026-001')).toBe(true)
    expect(same('Gannet & Rowe Constructors Inc.', 'Gannet Rowe Constructors Inc')).toBe(true)
    expect(same('12-3', '1-23')).toBe(false)
    expect(same('12.500', '12500')).toBe(false)
    expect(same('Paxwick Builders Inc.', 'Paxwick Builder Inc.')).toBe(false)
  })

  it('"Paxwick Builders, Inc." against "Paxwick Builders Inc." no longer FAILs; the claim says the folding decided it', () => {
    const c = byId('F01')
    const d = clone(c.extraction); d.waiver.claimant = 'Paxwick Builders, Inc.'
    expect(c.extraction.waiver.claimant).toBe('Paxwick Builders Inc.')
    const v = v2(c, d)
    const claim = v.claims.find(x => x.rule_id === 'LW_CLAIMANT')!
    expect(claim.outcome).toBe('PASS')
    expect(claim.computation?.formula).toBe('CLAIMANT = PAYAPP_CONTRACTOR (identifier sets; whitespace removed, upper-cased; punctuation ignored except between digits)')
    expect(gateStatus(v)).toBe('PASS')
    // a match the old rule already decided keeps its bytes (no folding note)
    expect(v2(c).claims.find(x => x.rule_id === 'LW_CLAIMANT')!.computation?.formula).toBe('CLAIMANT = PAYAPP_CONTRACTOR (identifier sets; whitespace removed, upper-cased)')
  })

  it('a genuinely different party still FAILs, and the remedy prints both names as written (F26, F28)', () => {
    const f26 = v2(byId('F26'))
    const claimant = f26.claims.find(x => x.rule_id === 'LW_CLAIMANT')!
    expect(claimant.outcome).toBe('FAIL')
    const text = f26.remedies!.filter(r => r.clears.includes('LW_CLAIMANT') || r.clears.includes('LW_PAYEE')).map(r => r.detail).join('\n')
    const raw = [byId('F26').extraction.waiver.claimant, byId('F26').extraction.pay_app.contractor] as string[]
    for (const name of raw) expect(text).toContain(name)
    expect(text).not.toMatch(/[A-Z]{4,}&[A-Z]{4,}/) // no stripped, upper-cased run such as GANNET&ROWE…
    const f28 = v2(byId('F28'))
    const loc = f28.remedies!.filter(r => r.clears.includes('LW_LOCATION')).map(r => r.detail).join('\n')
    expect(loc).toContain(byId('F28').extraction.waiver.job_location)
  })

  it('amounts print as money in remedies (F22: the waiver counted retainage)', () => {
    const v = v2(byId('F22'))
    const r = v.remedies!.find(x => x.clears.includes('LW_AMOUNT'))!
    expect(r.detail).toContain('The waiver states 330,000.00; the pay application\'s current payment due (G702 line 8) is 297,000.00; difference 33,000.00.')
    expect(formatMoney(-1234.5)).toBe('-1,234.50')
    expect(formatMoney(0)).toBe('0.00')
    // the claim itself is unchanged: numbers stay numbers
    const c = v.claims.find(x => x.rule_id === 'LW_AMOUNT')!
    expect([c.asserted, c.variance]).toEqual([330000, 33000])
  })
})
