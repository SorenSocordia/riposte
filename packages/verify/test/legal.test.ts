/**
 * Legal cite-check (leg 2.9): verbatim quotation verification against supplied opinion text — the failure existence-checkers
 * can't catch (a real case quoted for words it doesn't contain). Opinion texts below are plain paraphrase fixtures (US
 * court opinions are public domain; these are illustrative, not verbatim reproductions of any specific case).
 */
import { describe, it, expect } from 'vitest'
import { verifyCitation, verifyCitations } from '../src/legal/index'
import type { Citation } from '../src/legal/index'
import type { Verdict } from '../src/index'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

const OPINIONS = {
  'Twombly': 'To survive a motion to dismiss, a complaint must contain sufficient factual matter to state a claim to relief that is plausible on its face. A pleading that offers labels and conclusions will not do.',
  'Carlisle': 'The court holds that the arbitration clause is unenforceable because it was procured by fraud in the inducement. Accordingly, the order compelling arbitration is reversed.',
}

describe('verbatim quotation', () => {
  it('an accurate quote from a supplied opinion PASSes with a span into the opinion', () => {
    const c: Citation = { id: 'a', case_name: 'Twombly', quote: 'a claim to relief that is plausible on its face' }
    const v = verifyCitations([c], OPINIONS, { now: NOW })
    expect(claim(v, 'cite.a').outcome).toBe('PASS')
    expect(claim(v, 'cite.a').evidence[0]!.locator.kind).toBe('span')
    expect(v.ruleset.id).toBe('legal')
    expect(v.outcome).toBe('PASS')
  })

  it('a MISQUOTE of a real opinion FAILs and returns what the opinion actually says (the 549-false-quotes case)', () => {
    // The brief claims "probable on its face"; the opinion says "plausible on its face".
    const c: Citation = { id: 'b', case_name: 'Twombly', quote: 'a claim to relief that is probable on its face' }
    const r = verifyCitation(c, OPINIONS)
    expect(r.outcome).toBe('FAIL')
    expect(r.locked).toBe(true)
    expect(r.computation?.operands.opinion_says).toMatch(/plausible on its face/)
  })

  it('a fabricated quote located nowhere abstains (not a FAIL — the source text may be incomplete)', () => {
    const c: Citation = { id: 'c', case_name: 'Twombly', quote: 'punitive damages are available as a matter of right in all actions' }
    const r = verifyCitation(c, OPINIONS)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.reason).toBe('SPAN_NOT_FOUND')
  })
})

describe('honest abstentions', () => {
  it('no opinion text supplied → REFERENCE_NOT_PROVIDED (we never assert existence we cannot check)', () => {
    const c: Citation = { id: 'd', case_name: 'United States v. Nowhere', cite: '999 U.S. 1', quote: 'the statute is void' }
    const r = verifyCitation(c, OPINIONS)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
  })

  it('RED-TEAM regression: a negation-stripped selective quote is NOT certified (SELECTIVE_QUOTE)', () => {
    // The words appear verbatim, but the opinion says "We do NOT hold that…"; dropping the negation inverts the holding.
    const op = { 'Imm': 'We do not hold that qualified immunity shields the officer in these circumstances.' }
    const r = verifyCitation({ id: 'inv', case_name: 'Imm', quote: 'hold that qualified immunity shields the officer' }, op)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.locked).toBe(false)
    expect(r.insufficiency?.reason).toBe('SELECTIVE_QUOTE')
  })

  it('an honest quote that is NOT preceded by a negation still PASSes (no over-blocking)', () => {
    const op = { 'Held': 'We hold that qualified immunity shields the officer in these circumstances.' }
    const r = verifyCitation({ id: 'ok', case_name: 'Held', quote: 'qualified immunity shields the officer' }, op)
    expect(r.outcome).toBe('PASS')
  })

  it('a proposition with no quote → OUT_OF_RULESET_SCOPE (holding-fit is semantic; declared abstention)', () => {
    const c: Citation = { id: 'e', case_name: 'Carlisle', proposition: 'arbitration clauses are always unenforceable' }
    const r = verifyCitation(c, OPINIONS)
    expect(r.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    expect(r.insufficiency?.detail).toMatch(/semantic|stands for/i)
  })
})

describe('a brief with a mix of good and bad citations', () => {
  it('one misquote fails the whole brief; the accurate cites still PASS; the rest abstain honestly', () => {
    const cites: Citation[] = [
      { id: '1', case_name: 'Twombly', quote: 'plausible on its face' },
      { id: '2', case_name: 'Carlisle', quote: 'the arbitration clause is VALID because it was procured by fraud' }, // misquote
      { id: '3', case_name: 'Ghost', cite: '1 F.4th 1', quote: 'anything' }, // no source
      { id: '4', case_name: 'Carlisle', proposition: 'fraud voids arbitration' }, // proposition only
    ]
    const v = verifyCitations(cites, OPINIONS, { now: NOW })
    expect(claim(v, 'cite.1').outcome).toBe('PASS')
    expect(claim(v, 'cite.2').outcome).toBe('FAIL')
    expect(claim(v, 'cite.3').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'cite.4').outcome).toBe('INSUFFICIENT_DATA')
    expect(v.outcome).toBe('FAIL')
    expect(v.coverage).toMatchObject({ claims_total: 4, claims_pass: 1, claims_fail: 1, claims_insufficient: 2 })
  })

  it('replays byte-identically except issued_at', () => {
    const cites: Citation[] = [{ id: '1', case_name: 'Twombly', quote: 'plausible on its face' }]
    const a = verifyCitations(cites, OPINIONS, { now: NOW })
    const b = verifyCitations(cites, OPINIONS, { now: () => new Date('2031-01-01T00:00:00Z') })
    expect(a.verdict_id).toBe(b.verdict_id)
    expect(JSON.stringify({ ...a, issued_at: '' })).toBe(JSON.stringify({ ...b, issued_at: '' }))
  })
})
