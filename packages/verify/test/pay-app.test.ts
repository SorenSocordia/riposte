/**
 * RULESET 'pay-app' — construction pay applications (AIA G702 / G703).
 * Second document type on the same engine, same proof object, same four honesty rules.
 */
import { describe, it, expect } from 'vitest'
import { verify, MIN_VERDICT_CONFIDENCE } from '../src/index'
import type { ClaimVerdict, Verdict } from '../src/index'
import {
  FIXED_NOW, prevApp, cleanApp, brokenApp, firstApp, barePercent, altVocab, prevAppDupItems, driftApp, type Json,
} from './fixtures/pay-apps'

const claim = (v: Verdict, id: string): ClaimVerdict => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have: ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}
const run = (ex: Json, history?: Json[]) => verify(ex, { ruleset: 'pay-app', now: FIXED_NOW, references: history ? { history } : undefined })

const LINE_CODES = ['G703_TOTAL', 'G703_BAL', 'G703_PCT', 'G703_CAP', 'G703_PREV']
const DOC_CODES = ['G702_CSUM', 'G702_SOV', 'G702_DONE', 'G702_RSUM', 'G702_RATE', 'G702_EARN', 'G702_DUE', 'G702_BAL', 'G702_PREV']

describe('pay-app: single-document coherence', () => {
  it('names the ruleset it ran under', () => {
    const v = run(cleanApp)
    expect(v.ruleset).toEqual({ id: 'pay-app', version: '0.0.1', domain: 'pay-app' })
    expect(v.document.line_items).toBe(3)
    expect(v.references).toEqual({ contract: false, evidence: 0, history: 0, source: false })
  })

  it('clean application: every footing law of both forms PASSes; continuity abstains honestly without the previous application', () => {
    const v = run(cleanApp)
    expect(v.outcome).toBe('PASS')
    // 3 lines × 5 + 9 document = 24 claims; the 4 continuity claims (3 × G703_PREV + G702_PREV) need history
    expect(v.coverage).toEqual({ claims_total: 24, claims_checked: 20, claims_pass: 20, claims_fail: 0, claims_insufficient: 4 })
    for (const code of DOC_CODES.filter(c => c !== 'G702_PREV')) expect(claim(v, `document.${code}`).outcome, code).toBe('PASS')
    for (let i = 0; i < 3; i++) for (const code of LINE_CODES.filter(c => c !== 'G703_PREV')) expect(claim(v, `line[${i}].${code}`).outcome, `line[${i}].${code}`).toBe('PASS')
    for (const id of ['line[0].G703_PREV', 'line[1].G703_PREV', 'line[2].G703_PREV', 'document.G702_PREV']) {
      const c = claim(v, id)
      expect(c.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, id).toBe('REFERENCE_NOT_PROVIDED')
      expect(c.insufficiency?.detail, id).toMatch(/history/i)
    }
  })

  it('receipts: Σ G lists every line\'s completed-to-date with its path; the % law carries its tolerance', () => {
    const v = run(cleanApp)
    const done = claim(v, 'document.G702_DONE')
    const paths = done.evidence.map(e => e.locator.kind === 'field' ? e.locator.path : '')
    expect(paths).toEqual(expect.arrayContaining(['schedule_of_values[0].completed_to_date', 'schedule_of_values[1].completed_to_date', 'schedule_of_values[2].completed_to_date', 'total_completed_and_stored']))
    expect(done.computation?.operands).toEqual({ TOTAL_COMPLETED_STORED: 62000, SOV_COMPLETED_SUM: 62000 })

    const pct = claim(v, 'line[1].G703_PCT')
    expect(pct.computation?.operands).toEqual({ PERCENT_COMPLETE: 0.8, EXPECTED_PERCENT_COMPLETE: 0.8 })
    expect(pct.computation?.tolerance).toEqual({ abs: 0.005 })
    const rate = claim(v, 'document.G702_RATE').evidence.find(e => e.locator.kind === 'field' && e.locator.path === 'retainage_rate')
    expect(rate?.value).toBe(0.1)
    expect(rate?.original).toBe('10%')
  })

  it('broken application: each of five errors is blamed on exactly the right number, locked, with a signed variance', () => {
    const v = run(brokenApp)
    expect(v.outcome).toBe('FAIL')
    expect(v.coverage.claims_fail).toBe(5)

    const t = claim(v, 'line[1].G703_TOTAL')
    expect(t.outcome).toBe('FAIL'); expect(t.locked).toBe(true); expect(t.variance).toBe(1000)
    expect(t.computation?.operands).toEqual({ COMPLETED_TO_DATE: 41000, EXPECTED_COMPLETED_TO_DATE: 40000 })

    const b = claim(v, 'line[1].G703_BAL')
    expect(b.outcome).toBe('FAIL'); expect(b.variance).toBe(1000)

    expect(claim(v, 'line[1].G703_PCT').outcome).toBe('FAIL')

    const cap = claim(v, 'line[2].G703_CAP')
    expect(cap.outcome).toBe('FAIL'); expect(cap.locked).toBe(true); expect(cap.variance).toBe(5000)
    expect(cap.computation?.operands).toEqual({ COMPLETED_TO_DATE: 45000, SCHEDULED_VALUE: 40000 })

    const done = claim(v, 'document.G702_DONE')
    expect(done.outcome).toBe('FAIL'); expect(done.variance).toBe(-34000)

    // independent checks stay independent
    expect(claim(v, 'line[0].G703_TOTAL').outcome).toBe('PASS')
    expect(claim(v, 'line[2].G703_TOTAL').outcome).toBe('PASS')  // 0 + 45000 + 0 = 45000 — the line foots; it is the CAP that fails
    expect(claim(v, 'document.G702_EARN').outcome).toBe('PASS')
  })

  it('first application: blank previous / previous-certificates are zero by the form\'s convention, and the formula says so', () => {
    const v = run(firstApp)
    expect(v.outcome).toBe('PASS')
    const due = claim(v, 'document.G702_DUE')
    expect(due.outcome).toBe('PASS')
    expect(due.computation?.operands).toEqual({ CURRENT_PAYMENT_DUE: 9000, EXPECTED_CURRENT_PAYMENT_DUE: 9000 })
    const expected = due.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'computed')
    expect(expected?.locator.kind === 'field' && expected.locator.path).toMatch(/line 7 absent → 0/)
    const csum = claim(v, 'document.G702_CSUM')
    expect(csum.outcome).toBe('PASS')
    expect(claim(v, 'line[0].G703_TOTAL').outcome).toBe('PASS') // D and F blank
  })

  it('percent complete as a bare fraction in (0, 1] abstains AMBIGUOUS_UNIT — 1 could be 1% or 100%', () => {
    const v = run(barePercent)
    for (let i = 0; i < 3; i++) {
      const c = claim(v, `line[${i}].G703_PCT`)
      expect(c.outcome, `line[${i}]`).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, `line[${i}]`).toBe('AMBIGUOUS_UNIT')
      expect(c.insufficiency?.detail).toMatch(/45%/)
    }
    expect(v.outcome).toBe('PASS') // everything else still foots
  })

  it('alternate vocabulary (line_items, summary block, $-formatted strings) binds at exact/alternative confidence and PASSes', () => {
    const v = run(altVocab)
    expect(v.outcome).toBe('PASS')
    expect(v.coverage.claims_checked).toBe(20)
    for (const c of v.claims) for (const e of c.evidence) expect(e.confidence, `${c.claim_id} ${JSON.stringify(e.locator)}`).toBeGreaterThanOrEqual(MIN_VERDICT_CONFIDENCE)
    const sv = claim(v, 'document.G702_SOV').evidence.find(e => e.locator.kind === 'field' && e.locator.path === 'line_items[1].scheduled_value')
    expect(sv?.value).toBe(50000)
    expect(sv?.original).toBe('$50,000.00')
  })
})

describe('pay-app: continuity against the previous application (history)', () => {
  it('clean application + application #1: all 24 claims run and PASS; history evidence carries its own provenance', () => {
    const v = run(cleanApp, [prevApp])
    expect(v.outcome).toBe('PASS')
    expect(v.references.history).toBe(1)
    expect(v.coverage).toEqual({ claims_total: 24, claims_checked: 24, claims_pass: 24, claims_fail: 0, claims_insufficient: 0 })

    const p1 = claim(v, 'line[1].G703_PREV')
    expect(p1.outcome).toBe('PASS') // (the kernel locks only FAILs — see driftApp below)
    expect(p1.computation?.operands).toEqual({ WORK_PREVIOUS: 20000, PREVIOUS_COMPLETED_TO_DATE: 20000 })
    const h = p1.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'history')
    expect(h?.locator.kind === 'field' && h.locator.path).toBe('history[0].schedule_of_values[1].completed_to_date')
    expect(h?.role).toBe('REFERENCE')

    const cert = claim(v, 'document.G702_PREV')
    expect(cert.outcome).toBe('PASS')
    expect(cert.computation?.operands).toEqual({ PREVIOUS_CERTIFICATES: 27000, PREVIOUS_EARNED_LESS_RETAINAGE: 27000 })
  })

  it('a "previous" column that disagrees with application #1 FAILs continuity with the variance', () => {
    const v = run(driftApp, [prevApp])
    const c = claim(v, 'line[1].G703_PREV')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(5000)
    expect(c.locked).toBe(true)
    expect(v.outcome).toBe('FAIL')
    // the line itself still foots (25000 + 15000 + 5000 = 45000)
    expect(claim(v, 'line[1].G703_TOTAL').outcome).toBe('PASS')
  })

  it('the previous application lists an item number twice: continuity for that item abstains AMBIGUOUS_REFERENCE — never picks one', () => {
    const v = run(cleanApp, [prevAppDupItems])
    const c = claim(v, 'line[1].G703_PREV')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.insufficiency?.detail).toMatch(/item number 2 more than once/)
    expect(claim(v, 'line[0].G703_PREV').outcome).toBe('PASS')
    expect(claim(v, 'line[2].G703_PREV').outcome).toBe('PASS')
  })

  it('several history documents without application numbers: the previous application is ambiguous → abstain', () => {
    const { application_number: _a, ...unnumbered } = prevApp
    const v = run(cleanApp, [unnumbered, { ...unnumbered }])
    const c = claim(v, 'document.G702_PREV')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
  })

  it('several numbered history documents: the highest application number is the previous one', () => {
    const app0: Json = { ...prevApp, application_number: 0, total_earned_less_retainage: 1 }
    const v = run(cleanApp, [app0, prevApp])
    expect(claim(v, 'document.G702_PREV').outcome).toBe('PASS')
    expect(claim(v, 'document.G702_PREV').computation?.operands.PREVIOUS_EARNED_LESS_RETAINAGE).toBe(27000)
  })

  it('a line with no item number cannot be matched to the previous application — by design, never by position', () => {
    const noIds: Json = { ...cleanApp, schedule_of_values: (cleanApp.schedule_of_values as Json[]).map(({ item_no: _i, ...rest }) => rest) }
    const v = run(noIds, [prevApp])
    const c = claim(v, 'line[0].G703_PREV')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('FIELD_MISSING')
    expect(c.insufficiency?.detail).toMatch(/item number/)
  })
})

describe('pay-app: the invoice ruleset is untouched by the second ruleset', () => {
  it('the same extraction under the default ruleset produces an invoice verdict, not a pay-app one', () => {
    const v = verify(cleanApp, { now: FIXED_NOW })
    expect(v.ruleset.id).toBe('invoice')
    expect(v.claims.some(c => c.rule_id.startsWith('G70'))).toBe(false)
  })

  it('an unknown ruleset id throws — a verdict is never issued under rules that do not exist', () => {
    expect(() => verify(cleanApp, { ruleset: 'paystub' as never, now: FIXED_NOW })).toThrow(/unknown ruleset/)
  })
})
