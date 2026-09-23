/**
 * Honesty loop, end to end, on the REAL shipped standard: mint a measured DeclaredAccuracy for the Peppol / EN 16931
 * ruleset. The labeled set here is CONSTRUCTED and hand-labeled (documented as such — it is not field data); the point is
 * that the accuracy is *computed* on a named, hashed set via measureRuleset, never asserted. In production the same call
 * runs against a buyer's own labeled invoices, and the resulting object attaches to Verdict.declared_accuracy.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureRuleset, renderMeasurement, type LabeledCase, type DeclarativeRuleset } from '../src/index'

const PEPPOL = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'peppol-en16931.ruleset.json'), 'utf8'),
) as DeclarativeRuleset

// Constructed, hand-labeled. Two compliant invoices (CLEAN) and two with a broken footing (ERROR).
const cases: LabeledCase[] = [
  { // compliant: Σ lines 1600, tax 320, total 1920
    label: 'CLEAN',
    extraction: {
      currency: 'EUR',
      lines: [
        { line_extension_amount: 1500, invoiced_quantity: 10, price_amount: 150 },
        { line_extension_amount: 100, invoiced_quantity: 4, price_amount: 25 },
      ],
      line_extension_amount: 1600, tax_exclusive_amount: 1600, tax_amount: 320, tax_inclusive_amount: 1920, payable_amount: 1920,
    },
  },
  { // compliant: allowance/charge/prepaid chain reconciles
    label: 'CLEAN',
    extraction: {
      currency: 'EUR',
      lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
      line_extension_amount: 1000, allowance_total_amount: 50, charge_total_amount: 30,
      tax_exclusive_amount: 980, tax_amount: 196, tax_inclusive_amount: 1176,
      prepaid_amount: 176, payable_rounding_amount: 0, payable_amount: 1000,
    },
  },
  { // ERROR: payable wrong (9999 vs 1200)
    label: 'ERROR',
    extraction: {
      currency: 'EUR',
      lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
      line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 200, tax_inclusive_amount: 1200, payable_amount: 9999,
    },
  },
  { // ERROR: tax_inclusive wrong (1500 vs 1200)
    label: 'ERROR',
    extraction: {
      currency: 'EUR',
      lines: [{ line_extension_amount: 1000, invoiced_quantity: 10, price_amount: 100 }],
      line_extension_amount: 1000, tax_exclusive_amount: 1000, tax_amount: 200, tax_inclusive_amount: 1500, payable_amount: 1500,
    },
  },
]

describe('Peppol / EN 16931 — measured (not asserted) declared accuracy', () => {
  it('mints a real DeclaredAccuracy on a named, hashed labeled set', () => {
    const m = measureRuleset(PEPPOL, cases)
    expect(m.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 0, abstain: 0, total: 4 })
    expect(m.accuracy.domain).toBe('e-invoice')
    expect(m.accuracy.ruleset_version).toBe('0.0.1')
    expect(m.accuracy.fp_rate).toBe(0)
    expect(m.accuracy.fn_rate).toBe(0)
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
    // The card reads honestly and names the standard.
    expect(renderMeasurement(m)).toMatch(/Declared accuracy — e-invoice/)
    expect(renderMeasurement(m)).toMatch(/Measured on 4 labeled cases/)
  })
})
