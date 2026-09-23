/**
 * Peppol BIS Billing 3.0 / EN 16931 — a REAL, EU-mandated e-invoice standard, verified as a pure JSON declarative
 * ruleset (no engine code). The three document footing formulas are from docs.peppol.eu §10.1 (verified by the
 * doc-standards agent). This proves the declarative engine on a document type with a built-in legal buyer, and exercises
 * optional-field defaults (allowances/charges/prepaid/rounding are 0 when omitted) and the per-line base-quantity price.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'

const PEPPOL = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'peppol-en16931.ruleset.json'), 'utf8')) as DeclarativeRuleset
const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

describe('the shipped Peppol ruleset is well-formed', () => {
  it('passes the linter with no errors', () => {
    const r = lintRuleset(PEPPOL)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('a compliant Peppol invoice foots (optional fields omitted → 0)', () => {
  // 2 lines: 10 × 150 = 1500 ; 4 × 25 = 100. Σ = 1600. No allowances/charges. Tax 20% = 320. Total 1920. No prepaid/rounding.
  const inv = {
    invoice_number: 'PEPPOL-1', currency: 'EUR',
    lines: [
      { line_extension_amount: 1500, invoiced_quantity: 10, price_amount: 150 },
      { line_extension_amount: 100, invoiced_quantity: 4, price_amount: 25 },
    ],
    line_extension_amount: 1600, tax_exclusive_amount: 1600, tax_amount: 320, tax_inclusive_amount: 1920, payable_amount: 1920,
  }
  it('every EN 16931 footing formula PASSes', () => {
    const v = verify(inv, { ruleset: PEPPOL, now: NOW })
    expect(v.ruleset.id).toBe('peppol-en16931')
    for (const code of ['LINES_SUM_INT', 'TAX_EXCL_INT', 'TAX_INCL_INT', 'PAYABLE_INT']) expect(claim(v, `document.${code}`).outcome, code).toBe('PASS')
    expect(claim(v, 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(claim(v, 'line[1].LINE_MATH_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('allowances, charges, prepaid and rounding when present', () => {
  const inv = {
    invoice_number: 'PEPPOL-2', currency: 'EUR',
    lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
    line_extension_amount: 1000,
    allowance_total_amount: 50, charge_total_amount: 30,     // tax_excl = 1000 − 50 + 30 = 980
    tax_exclusive_amount: 980, tax_amount: 196,              // 20%
    tax_inclusive_amount: 1176,
    prepaid_amount: 176, payable_rounding_amount: 0,         // payable = 1176 − 176 + 0 = 1000
    payable_amount: 1000,
  }
  it('the full allowance/charge/prepaid chain reconciles', () => {
    expect(verify(inv, { ruleset: PEPPOL, now: NOW }).outcome).toBe('PASS')
  })
})

describe('a wrong Peppol total FAILs on the right formula', () => {
  const inv = {
    invoice_number: 'PEPPOL-3', currency: 'EUR',
    lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
    line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 200, tax_inclusive_amount: 1200,
    payable_amount: 9999, // wrong: should be 1200
  }
  it('PAYABLE_INT FAILs with the variance; the others hold', () => {
    const v = verify(inv, { ruleset: PEPPOL, now: NOW })
    expect(claim(v, 'document.TAX_INCL_INT').outcome).toBe('PASS')
    const c = claim(v, 'document.PAYABLE_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(8799) // 9999 − 1200
    expect(v.outcome).toBe('FAIL')
  })
})
