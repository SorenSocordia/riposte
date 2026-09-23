/**
 * The last link of the honesty loop: a verdict self-reports its ruleset's measured accuracy. Measure once, then stamp
 * the DeclaredAccuracy onto every verdict — without disturbing verdict_id (determinism holds) and with an honest
 * version guard.
 */
import { describe, it, expect } from 'vitest'
import { verifyDeclarative, measureRuleset, attachDeclaredAccuracy, type LabeledCase } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const cases: LabeledCase[] = [
  { extraction: { subtotal: 100, tax: 10, total: 110 }, label: 'CLEAN' },
  { extraction: { subtotal: 100, tax: 10, total: 999 }, label: 'ERROR' },
]
const NOW = () => new Date('2026-09-22T00:00:00Z')
const doc = { subtotal: 100, tax: 10, total: 110 }

describe('attachDeclaredAccuracy', () => {
  it('stamps the accuracy and leaves verdict_id untouched', () => {
    const { accuracy } = measureRuleset(ruleset, cases)
    const v = verifyDeclarative(doc, ruleset, { now: NOW })
    const stamped = attachDeclaredAccuracy(v, accuracy)
    expect(stamped.declared_accuracy).toEqual(accuracy)
    expect(stamped.verdict_id).toBe(v.verdict_id) // additive metadata → id unchanged
  })

  it('refuses to stamp an accuracy from a different ruleset version', () => {
    const { accuracy } = measureRuleset(ruleset, cases)
    const v = verifyDeclarative(doc, { ...ruleset, version: '2.0.0' }, { now: NOW })
    expect(() => attachDeclaredAccuracy(v, accuracy)).toThrow(/version/)
  })
})

describe('verifyDeclarative { declared_accuracy } option', () => {
  it('emits a verdict that self-reports its measured accuracy, deterministically', () => {
    const { accuracy } = measureRuleset(ruleset, cases)
    const plain = verifyDeclarative(doc, ruleset, { now: NOW })
    const withAcc = verifyDeclarative(doc, ruleset, { now: NOW, declared_accuracy: accuracy })
    expect(withAcc.declared_accuracy).toEqual(accuracy)
    expect(withAcc.verdict_id).toBe(plain.verdict_id) // the option does not change the deterministic id
  })
})
