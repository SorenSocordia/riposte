/**
 * Exact + near duplicate detection (leg 1.12). ERPs catch an exact repeated invoice number; the money leaks through the
 * near-collision (28417 → 28417-A, 028417, "multiple vendor records"). We catch both, deterministically, and never guess.
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import { tightId, baseId, classifyDuplicates } from '../src/dedup'
import { FIXED_NOW, clean, withPriorIds, withNoPriorIds, nearDupFormatting, nearDupRevision, noNearDup } from './fixtures/invoices'

const claim = (v: ReturnType<typeof verify>, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found; have ${v.claims.map(x => x.claim_id).join(', ')}`)
  return c
}
const run = (ex: Record<string, unknown>) => verify(ex, { now: FIXED_NOW })

describe('id normalization', () => {
  it('tightId is segment-aware: ignores case/punctuation/leading-zeros but PRESERVES digit grouping', () => {
    expect(tightId('INV-028417')).toBe('INV|28417')
    expect(tightId('inv 28417')).toBe('INV|28417')      // same segments as INV-028417
    expect(tightId('28417')).toBe('28417')
    expect(tightId('0042')).toBe('42')
    // different groupings of the same digits are NOT the same id (red-team break)
    expect(tightId('12-345')).not.toBe(tightId('123-45'))
  })
  it('baseId strips a trailing revision suffix but keeps a real core', () => {
    expect(baseId('28417-A')).toBe('28417')
    expect(baseId('INV-2001-REV2')).toBe(baseId('INV-2001'))
    expect(baseId('28417')).toBe('28417')
    expect(baseId('A-1')).toBe('A|1') // trailing '1' is numeric, NOT a revision token → kept
  })
})

describe('classifyDuplicates', () => {
  it('separates exact, formatting-variant and revision-variant collisions; misses unrelated', () => {
    const f = classifyDuplicates('INV-2001', ['INV-2001', 'INV-002001', 'INV-2001-A', 'INV-1999'])
    expect(f.exact).toEqual(['INV-2001'])
    expect(f.near.find(n => n.id === 'INV-002001')?.kind).toBe('formatting')
    expect(f.near.find(n => n.id === 'INV-2001-A')?.kind).toBe('revision')
    expect(f.near.some(n => n.id === 'INV-1999')).toBe(false)
  })
  it('an exact match is never also reported as near', () => {
    const f = classifyDuplicates('X-1', ['X-1'])
    expect(f.exact).toEqual(['X-1'])
    expect(f.near).toEqual([])
  })

  it('RED-TEAM regression: sequential invoices and different POs do NOT collide (no false-duplicate FAIL)', () => {
    expect(classifyDuplicates('INV-02', ['INV-01']).near).toEqual([])   // numeric suffix = sequence, not revision
    expect(classifyDuplicates('12-345', ['123-45']).near).toEqual([])   // same digits, different grouping = different id
    // and the true near-dups still catch:
    expect(classifyDuplicates('28417', ['28417-A']).near[0]?.kind).toBe('revision')
    expect(classifyDuplicates('INV-28417', ['INV-028417']).near[0]?.kind).toBe('formatting')
  })
})

describe('DUP_PROHIB / DUP_NEAR through verify()', () => {
  it('no prior_invoice_ids field → DUP_PROHIB abstains FIELD_MISSING; no DUP_NEAR claim', () => {
    const v = run(clean)
    expect(claim(v, 'document.DUP_PROHIB').outcome).toBe('INSUFFICIENT_DATA')
    expect(claim(v, 'document.DUP_PROHIB').insufficiency?.reason).toBe('FIELD_MISSING')
    expect(v.claims.some(c => c.claim_id === 'document.DUP_NEAR')).toBe(false)
  })

  it('empty history → both PASS (a valid "no duplicates" answer, not an abstention)', () => {
    const v = run(withNoPriorIds)
    expect(claim(v, 'document.DUP_PROHIB').outcome).toBe('PASS')
    expect(claim(v, 'document.DUP_NEAR').outcome).toBe('PASS')
  })

  it('exact duplicate → DUP_PROHIB FAILs and is locked, naming the match', () => {
    const v = run(withPriorIds)
    const c = claim(v, 'document.DUP_PROHIB')
    expect(c.outcome).toBe('FAIL')
    expect(c.locked).toBe(true)
    expect(c.explanation).toMatch(/INV-2001/)
    expect(c.evidence.some(e => e.locator.kind === 'field' && e.locator.path === 'prior_invoice_ids')).toBe(true)
    expect(v.outcome).toBe('FAIL')
  })

  it('formatting variant → DUP_PROHIB PASS, DUP_NEAR FAIL flagged as near-certain duplicate', () => {
    const v = run(nearDupFormatting)
    expect(claim(v, 'document.DUP_PROHIB').outcome).toBe('PASS')
    const c = claim(v, 'document.DUP_NEAR')
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/different formatting|almost certainly/i)
    expect(v.outcome).toBe('FAIL')
  })

  it('revision suffix → DUP_NEAR FAIL but flagged as a possible legitimate re-issue for review', () => {
    const v = run(nearDupRevision)
    const c = claim(v, 'document.DUP_NEAR')
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toMatch(/re-issue|human should confirm|review/i)
  })

  it('unrelated prior numbers → both PASS', () => {
    const v = run(noNearDup)
    expect(claim(v, 'document.DUP_PROHIB').outcome).toBe('PASS')
    expect(claim(v, 'document.DUP_NEAR').outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})
