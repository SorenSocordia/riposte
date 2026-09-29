/**
 * PREREG-EINVOICE-TWIN-1 (pre-registration, 2026-09-28, design sha256 dd3a707e…):
 * the e-invoice twin's accuracy MEASURED on a SYNTHETIC labelled claim set (test/fixtures/einvoice/labelled-set.ts:
 * correct values plus seeded errors over three constructed invoices). The numbers here are mechanics, not field
 * accuracy: no model produced these extractions, and the fixtures were also the development fixtures.
 *
 * Frozen bars (prereg §5): false-flag rate (CLEAN judged FAIL / all CLEAN) ≤ 2.0%; catch rate (ERROR judged FAIL /
 * all ERROR) ≥ 95%; ERROR judged PASS = 0.
 */
import { describe, it, expect } from 'vitest'
import { measureEinvoiceTwin, type EinvoiceTwinMeasurement } from '../src/twin-einvoice/index'
import { buildLabelledSet } from './fixtures/einvoice/labelled-set'

const docs = buildLabelledSet()
const m: EinvoiceTwinMeasurement = measureEinvoiceTwin(docs)
const clean = m.rows.filter((r) => r.label === 'CLEAN')
const errors = m.rows.filter((r) => r.label === 'ERROR')

describe('PREREG-EINVOICE-TWIN-1: synthetic labelled set, measured', () => {
  it('the set is the deterministic §4 generation (every error kind is present)', () => {
    expect(new Set(errors.map((r) => r.kind))).toEqual(new Set(['transposed_digits', 'vat_vs_net', 'currency_scale', 'party_swap', 'day_month_swap']))
    expect(new Set(clean.map((r) => r.kind))).toEqual(new Set(['exact', 'spaced_id', 'upper_name', 'string_amount']))
    expect(new Set(m.rows.map((r) => r.claim_id)).size).toBe(m.rows.length)
    expect(measureEinvoiceTwin(buildLabelledSet()).accuracy.measured_on).toBe(m.accuracy.measured_on)
  })
  it('false-flag rate on correct values ≤ 2.0% (frozen bar)', () => {
    const ff = clean.filter((r) => r.judgment === 'FAIL').length / clean.length
    expect(ff).toBeLessThanOrEqual(0.02)
  })
  it('catch rate on seeded errors ≥ 95% (frozen bar), and no seeded error PASSes', () => {
    expect(errors.filter((r) => r.judgment === 'FAIL').length / errors.length).toBeGreaterThanOrEqual(0.95)
    expect(errors.filter((r) => r.judgment === 'PASS')).toEqual([])
  })
  it('mints a DeclaredAccuracy bound to this set (the standard measured-accuracy pattern)', () => {
    expect(m.accuracy.domain).toBe('e-invoice')
    expect(m.accuracy.ruleset_version).toBe('0.3.0') // the twin moved to 0.3.0 (PRODUCT-FIX-1, the verdict's outcome rule; per-claim judgments unchanged); the bars below are re-checked on it
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
    expect(m.metrics.total).toBe(m.rows.length)
  })
})
