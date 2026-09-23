/**
 * Honesty rule 4: a verdict is never issued against a reference that offers several candidates when none could be
 * matched to the line. A bare `rates: [150, 200]` contract cannot be applied per line — abstain. Named
 * `financial_rules` CAN be matched (keyword / category / word overlap ≥ 70), and then per-line checks run for real.
 */
import { describe, it, expect } from 'vitest'
import { verify, referenceMultiplicity, MIN_VERDICT_CONFIDENCE } from '../src/index'
import { FIXED_NOW, singleLine, craneLine, contractOk, contractMultiRate, contractWithRules } from './fixtures/invoices'

const claim = (v: ReturnType<typeof verify>, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}

describe('reference multiplicity', () => {
  it('counts candidate rates and limits by the ontology\'s array-rooted paths', () => {
    expect(referenceMultiplicity(contractOk, 'RATE_CONTRACTED')).toBe(1)
    expect(referenceMultiplicity(contractMultiRate, 'RATE_CONTRACTED')).toBe(2)
    expect(referenceMultiplicity(contractWithRules, 'RATE_CONTRACTED')).toBe(2)
    expect(referenceMultiplicity(contractOk, 'CONTRACTED_LIMIT')).toBe(0)     // scalar max_amount, no array candidates
    expect(referenceMultiplicity({ rates: [null, { rate: 1 }] }, 'RATE_CONTRACTED')).toBe(1)
  })
})

describe('multi-rate contract without rule names', () => {
  it('RATE_SUP abstains with AMBIGUOUS_REFERENCE — it never silently checks against the first rate', () => {
    const v = verify(singleLine, { now: FIXED_NOW, references: { contract: contractMultiRate } })
    const c = claim(v, 'line[0].RATE_SUP')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.insufficiency?.detail).toMatch(/2 candidate values/)
    expect(c.locked).toBe(false)
    expect(c.computation).toBeUndefined()
  })

  it('single-valued parts of the same contract still verify (cap, term)', () => {
    const v = verify(singleLine, { now: FIXED_NOW, references: { contract: contractMultiRate } })
    expect(claim(v, 'line[0].AMT_CAP').outcome).toBe('PASS')
    expect(claim(v, 'document.TIME_ORD').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('named financial_rules', () => {
  it('a Consulting line matches the Consulting rule: RATE_SUP runs and passes at the matched rate', () => {
    const v = verify(singleLine, { now: FIXED_NOW, references: { contract: contractWithRules } })
    const c = claim(v, 'line[0].RATE_SUP')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.operands.RATE_CONTRACTED).toBe(150)
    for (const e of c.evidence) expect(e.confidence).toBeGreaterThanOrEqual(MIN_VERDICT_CONFIDENCE)
  })

  it('a Crane line matches the Crane rule: billed above it, RATE_SUP FAILs with variance (950 − 900) × 2', () => {
    const v = verify(craneLine, { now: FIXED_NOW, references: { contract: contractWithRules } })
    const c = claim(v, 'line[0].RATE_SUP')
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.operands.RATE_CONTRACTED).toBe(900)
    expect(c.variance).toBe(100)
    expect(c.locked).toBe(true)
    expect(v.outcome).toBe('FAIL')
  })
})
