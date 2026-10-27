/**
 * Poland KSeF FA(3) — a national schema that is deliberately NOT EN 16931 (Polish MF field codes P_11/P_13/P_14/P_15,
 * per-rate net + VAT buckets, no allowance/charge/tax-exclusive chain). Proves the declarative engine generalizes past
 * the European family.
 *
 * PROVENANCE (ruleset 0.1.0, corrected 2026-09-28 — docs/RULESET-CORRECTIONS-2026-09-28.md):
 *  - field names and the bucket set are the FA(3) XSD's (http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd):
 *    P_13_1..P_13_5, P_13_6_1/_2/_3, P_13_7..P_13_11, P_14_1..P_14_5. (0.0.1 named a non-existent P_13_6 and
 *    P_10_Dodatki and omitted P_13_8..P_13_11.)
 *  - GROSS_INT (P_15 = Σ P_13_x + Σ P_14_x) is a DECLARED ABSTENTION: neither the XSD nor the MF information sheet
 *    (2026-03-04) states it, and the sheet names cases where P_15 is something else.
 *  - LINE_NET_INT (P_11 = P_8B × P_9A) follows the MF sheet's worked examples (Przykład 22-23) and abstains when P_10,
 *    P_9B or P_11A is reported. KSeF itself validates only the XSD.
 * Regression tests for each correction are in test/ruleset-corrections.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'

const KSEF = JSON.parse(
  // pinned to the frozen 0.1.0 bytes (pinned 2026-09-28); 0.2.0 (DoZaplaty) is tested in ksef-dozaplaty.test.ts
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden-rulesets', 'ksef-fa3.ruleset.v0.1.0.json'), 'utf8'),
) as DeclarativeRuleset
const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}`); return c }

describe('the KSeF ruleset is well-formed', () => {
  it('passes the linter', () => {
    const r = lintRuleset(KSEF)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('a compliant single-rate (23%) FA(3) invoice foots', () => {
  const inv = {
    lines: [{ P_11: 1000, P_8B: 10, P_9A: 100 }],
    P_13_1: 1000, P_14_1: 230, P_15: 1230,
  }
  it('the line net PASSes; the unsourced gross identity abstains with its reason', () => {
    const v = verify(inv, { ruleset: KSEF, now: NOW })
    expect(v.ruleset).toMatchObject({ id: 'ksef-fa3-pl', version: '0.1.0' })
    expect(claim(v, 'document.GROSS_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'OUT_OF_RULESET_SCOPE' } })
    expect(claim(v, 'document.GROSS_INT').insufficiency!.detail).toMatch(/^declared abstention: UNSOURCED/)
    expect(claim(v, 'line[0].LINE_NET_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('a multi-rate invoice (23% + 8% buckets) PASSes on its lines', () => {
  const inv = {
    lines: [{ P_11: 1000, P_8B: 10, P_9A: 100 }, { P_11: 500, P_8B: 5, P_9A: 100 }],
    P_13_1: 1000, P_14_1: 230, P_13_2: 500, P_14_2: 40, P_15: 1770,
  }
  it('every line foots; the gross identity is not checked', () => {
    expect(verify(inv, { ruleset: KSEF, now: NOW }).outcome).toBe('PASS')
  })
})

describe('the reported Ministry-sample case (Σ 2050.99 vs P_15 2051) does NOT false-FAIL', () => {
  const inv = {
    lines: [{ P_11: 1667.47, P_8B: 1, P_9A: 1667.47 }],
    P_13_1: 1667.47, P_14_1: 383.52, P_15: 2051, // Σ = 2050.99, gross stated 2051 → 0.01 rounding
  }
  it('the gross identity abstains (declared), so a 1-grosz difference cannot false-FAIL; the verdict PASSes', () => {
    const v = verify(inv, { ruleset: KSEF, now: NOW })
    expect(claim(v, 'document.GROSS_INT').outcome).toBe('INSUFFICIENT_DATA')
    expect(v.outcome).toBe('PASS')
  })
})

describe('a real line error still FAILs; a wrong P_15 is not checked (the published cost of not guessing)', () => {
  it('LINE_NET_INT FAILs beyond tolerance', () => {
    const v = verify({ lines: [{ P_11: 1100, P_8B: 10, P_9A: 100 }], P_13_1: 1100, P_14_1: 253, P_15: 1353 }, { ruleset: KSEF, now: NOW })
    expect(claim(v, 'line[0].LINE_NET_INT')).toMatchObject({ outcome: 'FAIL', variance: 100 })
    expect(v.outcome).toBe('FAIL')
  })
  it('a wrong gross total abstains on GROSS_INT, so the verdict rests on the lines alone', () => {
    const v = verify({ lines: [{ P_11: 1000, P_8B: 10, P_9A: 100 }], P_13_1: 1000, P_14_1: 230, P_15: 9999 }, { ruleset: KSEF, now: NOW })
    expect(claim(v, 'document.GROSS_INT').outcome).toBe('INSUFFICIENT_DATA')
    expect(v.outcome).toBe('PASS')
  })
})
