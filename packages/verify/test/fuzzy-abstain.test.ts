/**
 * Honesty rule 3: a DETERMINISTIC verdict is never issued on a field that was only GUESSED by fuzzy name-matching.
 * This is the binding-layer half of pre-registered claim W1 — a wrong-but-plausible field is exactly how a
 * confident lie gets into a verdict.
 */
import { describe, it, expect } from 'vitest'
import { verify, MIN_VERDICT_CONFIDENCE } from '../src/index'
import { FIXED_NOW, fuzzyLine, noSubtotal } from './fixtures/invoices'

const claim = (v: ReturnType<typeof verify>, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found`)
  return c
}

describe('no verdict on a guessed field', () => {
  it('a line amount found only by fuzzy matching makes MATH_INT and SUM_INT abstain with AMBIGUOUS_FIELD', () => {
    const v = verify(fuzzyLine, { now: FIXED_NOW })
    for (const id of ['line[0].MATH_INT', 'document.SUM_INT']) {
      const c = claim(v, id)
      expect(c.outcome, id).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason, id).toBe('AMBIGUOUS_FIELD')
      expect(c.insufficiency?.detail, id).toMatch(/fuzzy/)
      expect(c.locked, id).toBe(false)
      expect(c.computation, id).toBeUndefined()
      expect(c.variance, id).toBeUndefined()
      // the guessed operand is still on the receipt, so the developer can see what was found and at what confidence
      expect(c.evidence.some(e => e.confidence < MIN_VERDICT_CONFIDENCE), id).toBe(true)
    }
  })

  it('exact fields on the same invoice still verify normally', () => {
    const v = verify(fuzzyLine, { now: FIXED_NOW })
    expect(claim(v, 'document.TOTAL_INT').outcome).toBe('PASS')
    expect(claim(v, 'document.TAX_INT').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('with fuzzy matching disabled for document-level amounts, a missing subtotal is MISSING — not borrowed from the total', () => {
    const v = verify(noSubtotal, { now: FIXED_NOW })
    const sum = claim(v, 'document.SUM_INT')
    expect(sum.outcome).toBe('INSUFFICIENT_DATA')
    expect(sum.insufficiency?.reason).toBe('FIELD_MISSING')
    expect(sum.evidence.some(e => e.locator.kind === 'field' && e.locator.path === 'totals.total')).toBe(false)
  })

  it('a computed role inherits the lowest confidence of its operands', () => {
    // SUM_INT's computed LINE_ITEMS_SUM is built from the fuzzy line amount → it must carry that confidence, never 100.
    const v = verify(fuzzyLine, { now: FIXED_NOW })
    const sum = claim(v, 'document.SUM_INT')
    const computedSum = sum.evidence.find(e => e.role === 'CONTEXT')
    expect(computedSum).toBeDefined()
    expect(computedSum!.confidence).toBeLessThan(MIN_VERDICT_CONFIDENCE)
  })
})
