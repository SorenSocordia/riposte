/**
 * Preregistered-accuracy harness — measure a declarative ruleset against a labeled set and mint a real DeclaredAccuracy.
 * Controlled inline ruleset (a total check) with a known confusion matrix, plus determinism + version-sensitivity of the
 * measured_on hash.
 */
import { describe, it, expect } from 'vitest'
import { measureRuleset, renderMeasurement, type LabeledCase } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total',
  version: '1.0.0',
  domain: 'test',
  fields: {
    SUB: { paths: ['subtotal'] },
    TAX: { paths: ['tax'] },
    TOTAL: { paths: ['total'] },
  },
  checks: [{ code: 'TOTAL_INT', name: 'total = subtotal + tax', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}

// Known matrix: tp=2 (ERROR→FAIL), tn=2 (CLEAN→PASS), fp=0, fn=0, abstain=1 (missing total → INSUFFICIENT_DATA).
const cases: LabeledCase[] = [
  { extraction: { subtotal: 100, tax: 10, total: 110 }, label: 'CLEAN' }, // TN
  { extraction: { subtotal: 100, tax: 10, total: 200 }, label: 'ERROR' }, // TP
  { extraction: { subtotal: 50, tax: 5, total: 55 }, label: 'CLEAN' },    // TN
  { extraction: { subtotal: 50, tax: 5, total: 999 }, label: 'ERROR' },   // TP
  { extraction: { subtotal: 50, tax: 5 }, label: 'CLEAN' },               // abstain (no total)
]

describe('measureRuleset', () => {
  it('computes real fp/fn/abstain rates and a set-bound measured_on hash', () => {
    const m = measureRuleset(ruleset, cases)
    expect(m.metrics).toMatchObject({ tp: 2, tn: 2, fp: 0, fn: 0, abstain: 1, total: 5 })
    expect(m.accuracy.fp_rate).toBe(0)
    expect(m.accuracy.fn_rate).toBe(0)
    expect(m.accuracy.abstain_rate).toBeCloseTo(0.2)
    expect(m.accuracy.domain).toBe('test')
    expect(m.accuracy.ruleset_version).toBe('1.0.0')
    expect(m.accuracy.measured_on).toMatch(/^[0-9a-f]{64}$/)
    expect(m.metrics.precision).toBe(1)
    expect(m.metrics.recall).toBe(1)
    expect(m.metrics.coverage).toBeCloseTo(0.8)
  })

  it('detects a false alarm (CLEAN doc that FAILs raises fp_rate)', () => {
    const m = measureRuleset(ruleset, [
      { extraction: { subtotal: 100, tax: 10, total: 110 }, label: 'CLEAN' }, // TN
      { extraction: { subtotal: 100, tax: 10, total: 999 }, label: 'CLEAN' }, // FP — a clean doc we wrongly FAIL
    ])
    expect(m.metrics.fp).toBe(1)
    expect(m.accuracy.fp_rate).toBeCloseTo(0.5)
  })

  it('is deterministic — same ruleset + set → identical measured_on', () => {
    expect(measureRuleset(ruleset, cases).accuracy.measured_on).toBe(measureRuleset(ruleset, cases).accuracy.measured_on)
  })

  it('binds the hash to the ruleset version (a version bump changes measured_on)', () => {
    const bumped: DeclarativeRuleset = { ...ruleset, version: '1.0.1' }
    expect(measureRuleset(bumped, cases).accuracy.measured_on).not.toBe(measureRuleset(ruleset, cases).accuracy.measured_on)
  })

  it('renders an honest, non-estimated accuracy card', () => {
    const md = renderMeasurement(measureRuleset(ruleset, cases))
    expect(md).toMatch(/Declared accuracy — test/)
    expect(md).toMatch(/Not estimated/)
    expect(md).toMatch(/Measured on 5 labeled cases/)
  })
})
