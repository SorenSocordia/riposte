/**
 * ZATCA (Saudi Arabia / FATOORA) e-invoice — a second real national standard as a pure-JSON declarative ruleset.
 *
 * PROVENANCE (honesty wall): ZATCA's Electronic Invoice XML Implementation Standard (v1.2) conforms to EN 16931:2017;
 * its LegalMonetaryTotal footing is the EN 16931 BR-CO calculation-rule family — BR-CO-10 (sum of line nets),
 * BR-CO-13 (total without VAT = line nets − allowances + charges), BR-CO-15 (total with VAT = total without VAT + VAT),
 * BR-CO-16 (amount due = total with VAT − prepaid + rounding). These are the SAME verified formulas as Peppol/EN 16931
 * (docs.peppol.eu §10.1), independently confirmed for KSA. VAT is NOT hardcoded (mixed/zero-rated lines are legal) —
 * the standard KSA rate (15%) is used only in the example data. Arabic field-name aliases are a deliberate follow-up
 * (they need a verified Arabic-label source), so this ruleset carries the UBL + snake_case aliases only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, lintRuleset, measureRuleset, type DeclarativeRuleset, type LabeledCase, type Verdict } from '../src/index'

const ZATCA = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'zatca-ksa.ruleset.json'), 'utf8'),
) as DeclarativeRuleset
const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}`); return c }

describe('the ZATCA ruleset is well-formed', () => {
  it('passes the linter', () => {
    const r = lintRuleset(ZATCA)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('a compliant KSA invoice (15% VAT) foots', () => {
  // 1 line: 10 × 100 = 1000. VAT 15% = 150. Total 1150. No allowances/charges/prepaid/rounding.
  const inv = {
    invoice_number: 'ZATCA-1', currency: 'SAR',
    lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
    line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 150, tax_inclusive_amount: 1150, payable_amount: 1150,
  }
  it('every EN 16931 / ZATCA footing rule PASSes', () => {
    const v = verify(inv, { ruleset: ZATCA, now: NOW })
    expect(v.ruleset.id).toBe('zatca-ksa-en16931')
    for (const code of ['LINES_SUM_INT', 'TAX_EXCL_INT', 'TAX_INCL_INT', 'PAYABLE_INT']) expect(claim(v, `document.${code}`).outcome, code).toBe('PASS')
    expect(claim(v, 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('a wrong KSA total FAILs on the right rule', () => {
  const inv = {
    invoice_number: 'ZATCA-2', currency: 'SAR',
    lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
    line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 150, tax_inclusive_amount: 1150,
    payable_amount: 9999, // wrong: should be 1150
  }
  it('PAYABLE_INT FAILs with the variance', () => {
    const v = verify(inv, { ruleset: ZATCA, now: NOW })
    const c = claim(v, 'document.PAYABLE_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(8849) // 9999 − 1150
    expect(v.outcome).toBe('FAIL')
  })
})

describe('ZATCA measured accuracy (not asserted)', () => {
  it('mints a real DeclaredAccuracy on a hashed labeled set', () => {
    const cases: LabeledCase[] = [
      { label: 'CLEAN', extraction: { lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 150, tax_inclusive_amount: 1150, payable_amount: 1150 } },
      { label: 'CLEAN', extraction: { lines: [{ line_extension_amount: 500, invoiced_quantity: 5, price_amount: 100 }], line_extension_amount: 500, tax_exclusive_amount: 500, tax_amount: 75, tax_inclusive_amount: 575, payable_amount: 575 } },
      { label: 'ERROR', extraction: { lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 150, tax_inclusive_amount: 1150, payable_amount: 9999 } },
      { label: 'ERROR', extraction: { lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }], line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 150, tax_inclusive_amount: 1500, payable_amount: 1500 } },
    ]
    const m = measureRuleset(ZATCA, cases)
    expect(m.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 0 })
    expect(m.accuracy.domain).toBe('e-invoice')
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
  })
})
