/**
 * Poland KSeF FA(3) — a national schema that is deliberately NOT EN 16931 (Polish MF field codes P_11/P_13/P_14/P_15,
 * per-rate net + VAT buckets, no allowance/charge/tax-exclusive chain). Proves the declarative engine generalizes past
 * the European family.
 *
 * PROVENANCE (honesty wall): footing from the official MF "FA(3) logical structure" information sheet
 * (ksef.podatki.gov.pl) via recon — line rule P_11 = P_8B × (P_9A − P_10 + P_10_Dodatki) (±0.02), totals rule
 * P_15 (gross) = Σ P_13_x (net by rate) + Σ P_14_x (VAT by rate). KSeF treats total coherence as a rounding-tolerant
 * warning (the Ministry's own example is 2050.99 vs 2051), so the ruleset carries a 0.02 tolerance — within-rounding
 * PASSes, a real error FAILs. FLAGGED for production: confirm the exact P_13_x / P_14_x bucket enumeration against the
 * primary MF PDF before shipping (this ruleset enumerates the documented rate buckets defensively, defaulting to 0).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'

const KSEF = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'ksef-fa3.ruleset.json'), 'utf8'),
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
  it('gross total and line net both PASS', () => {
    const v = verify(inv, { ruleset: KSEF, now: NOW })
    expect(v.ruleset.id).toBe('ksef-fa3-pl')
    expect(claim(v, 'document.GROSS_INT').outcome).toBe('PASS')
    expect(claim(v, 'line[0].LINE_NET_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('a multi-rate invoice foots (23% + 8% buckets)', () => {
  const inv = {
    lines: [{ P_11: 1000, P_8B: 10, P_9A: 100 }, { P_11: 500, P_8B: 5, P_9A: 100 }],
    P_13_1: 1000, P_14_1: 230, P_13_2: 500, P_14_2: 40, P_15: 1770,
  }
  it('sums net + VAT across rate buckets to the gross', () => {
    expect(verify(inv, { ruleset: KSEF, now: NOW }).outcome).toBe('PASS')
  })
})

describe('KSeF rounding tolerance (the Ministry-example case) does NOT false-FAIL', () => {
  const inv = {
    lines: [{ P_11: 2050.99, P_8B: 1, P_9A: 2050.99 }],
    P_13_1: 1667.47, P_14_1: 383.52, P_15: 2051, // Σ = 2050.99, gross stated 2051 → 0.01 rounding
  }
  it('a 1-grosz rounding difference PASSes within the 0.02 tolerance', () => {
    expect(claim(verify(inv, { ruleset: KSEF, now: NOW }), 'document.GROSS_INT').outcome).toBe('PASS')
  })
})

describe('a real error still FAILs', () => {
  const inv = {
    lines: [{ P_11: 1000, P_8B: 10, P_9A: 100 }],
    P_13_1: 1000, P_14_1: 230, P_15: 9999, // wrong gross
  }
  it('GROSS_INT FAILs beyond tolerance', () => {
    const v = verify(inv, { ruleset: KSEF, now: NOW })
    expect(claim(v, 'document.GROSS_INT').outcome).toBe('FAIL')
    expect(v.outcome).toBe('FAIL')
  })
})
