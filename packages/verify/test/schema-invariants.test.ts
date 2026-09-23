/**
 * Schema invariants — pre-registered claim W1 (no hallucinated verdicts by construction) enforced as tests.
 * These run over every fixture, with and without references. A violation anywhere is a kill.
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import type { Verdict } from '../src/index'
import { ALL_STANDALONE, FIXED_NOW, singleLine, singleLineOutOfTerm, contractOk, contractOverRate, evidenceOk, evidenceShort } from './fixtures/invoices'
import { ALL_PAY_APPS, prevApp, prevAppDupItems, cleanApp, driftApp } from './fixtures/pay-apps'

const OUTCOMES = new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA'])

function verdicts(): Array<[string, Verdict]> {
  const out: Array<[string, Verdict]> = ALL_STANDALONE.map(([name, ex]) => [name, verify(ex, { now: FIXED_NOW })])
  out.push(['singleLine+contractOk', verify(singleLine, { now: FIXED_NOW, references: { contract: contractOk } })])
  out.push(['singleLine+contractOverRate', verify(singleLine, { now: FIXED_NOW, references: { contract: contractOverRate } })])
  out.push(['outOfTerm+contractOk', verify(singleLineOutOfTerm, { now: FIXED_NOW, references: { contract: contractOk } })])
  out.push(['singleLine+evidenceOk', verify(singleLine, { now: FIXED_NOW, references: { evidence: [evidenceOk] } })])
  out.push(['singleLine+evidenceShort', verify(singleLine, { now: FIXED_NOW, references: { evidence: [evidenceShort] } })])
  // second ruleset: same invariants, same proof object
  for (const [name, ex] of ALL_PAY_APPS) out.push([`pay-app:${name}`, verify(ex, { ruleset: 'pay-app', now: FIXED_NOW })])
  out.push(['pay-app:cleanApp+history', verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW, references: { history: [prevApp] } })])
  out.push(['pay-app:driftApp+history', verify(driftApp, { ruleset: 'pay-app', now: FIXED_NOW, references: { history: [prevApp] } })])
  out.push(['pay-app:cleanApp+dupHistory', verify(cleanApp, { ruleset: 'pay-app', now: FIXED_NOW, references: { history: [prevAppDupItems] } })])
  // an invoice under the pay-app rules and a pay app under the invoice rules must be honest abstentions, not crashes
  out.push(['pay-app:invoice-shaped', verify(singleLine, { ruleset: 'pay-app', now: FIXED_NOW })])
  out.push(['invoice:pay-app-shaped', verify(cleanApp, { now: FIXED_NOW })])
  return out
}

describe('schema invariants (W1: zero hallucinated verdicts by construction)', () => {
  for (const [name, v] of verdicts()) {
    describe(name, () => {
      it('verdict header is well-formed and asserts the determinism contract', () => {
        expect(v.schema_version).toBe('v0')
        expect(v.replayable).toBe(true)
        expect(v.verdict_id).toMatch(/^[0-9a-f]{32}$/)
        expect(v.input_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(v.document.extraction_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(v.aggregation).toBe('ANY_FAIL_FAILS')
        expect(v.issued_at).toBe('2026-09-22T00:00:00.000Z')
      })

      it('every claim has exactly one of three outcomes and is DETERMINISTIC', () => {
        for (const c of v.claims) {
          expect(OUTCOMES.has(c.outcome), c.claim_id).toBe(true)
          expect(c.tier, c.claim_id).toBe('DETERMINISTIC')
        }
      })

      it('a PASS or FAIL always carries evidence and a computation; never an insufficiency', () => {
        for (const c of v.claims.filter(c => c.outcome !== 'INSUFFICIENT_DATA')) {
          expect(c.evidence.length, c.claim_id).toBeGreaterThan(0)
          expect(c.computation, c.claim_id).toBeDefined()
          expect(c.insufficiency, c.claim_id).toBeUndefined()
          for (const e of c.evidence) {
            expect(e.confidence, c.claim_id).toBeGreaterThanOrEqual(0)
            expect(e.confidence, c.claim_id).toBeLessThanOrEqual(100)
          }
        }
      })

      it('an INSUFFICIENT_DATA always explains itself and is never locked', () => {
        for (const c of v.claims.filter(c => c.outcome === 'INSUFFICIENT_DATA')) {
          expect(c.insufficiency, c.claim_id).toBeDefined()
          expect(c.insufficiency?.reason, c.claim_id).toBeTruthy()
          expect(c.insufficiency?.detail.length ?? 0, c.claim_id).toBeGreaterThan(0)
          expect(c.locked, c.claim_id).toBe(false)
        }
      })

      it('claim ids are unique; coverage sums; the aggregation rule holds', () => {
        const ids = v.claims.map(c => c.claim_id)
        expect(new Set(ids).size).toBe(ids.length)
        const { claims_total, claims_checked, claims_pass, claims_fail, claims_insufficient } = v.coverage
        expect(claims_total).toBe(v.claims.length)
        expect(claims_checked).toBe(claims_pass + claims_fail)
        expect(claims_total).toBe(claims_checked + claims_insufficient)
        const expected = claims_fail > 0 ? 'FAIL' : claims_checked === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
        expect(v.outcome).toBe(expected)
      })

      it('a locked claim is a FAIL', () => {
        for (const c of v.claims.filter(c => c.locked)) {
          expect(c.outcome, c.claim_id).toBe('FAIL')
        }
      })

      it('a PASS or FAIL never rests on a guessed field: EVERY operand — including those behind computed roles — is at exact/alternative confidence (≥ 90)', () => {
        for (const c of v.claims.filter(c => c.outcome !== 'INSUFFICIENT_DATA')) {
          for (const e of c.evidence) {
            expect(e.confidence, `${c.claim_id} ${JSON.stringify(e.locator)}`).toBeGreaterThanOrEqual(90)
          }
        }
      })
    })
  }
})
