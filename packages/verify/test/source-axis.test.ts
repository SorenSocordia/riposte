/**
 * The source-text axis wired into verify(): the numeric gavel and the "does it appear in the document" checks
 * live in one proof object, one verdict id, one replay guarantee.
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import { FIXED_NOW, singleLine } from './fixtures/invoices'

const now = FIXED_NOW

describe('source-text axis through verify()', () => {
  const invoiceText = 'INVOICE INV-2001\nConsulting  10 @ 150.00 ......... 1,500.00\nSubtotal 1,500.00\nTax (8.25%) 123.75\nTotal Due 1,623.75'

  it('records source: true and adds source.* claims alongside the numeric claims, in one verdict', () => {
    const v = verify(singleLine, {
      now,
      source: {
        text: invoiceText,
        values: [
          { id: 'subtotal', value: 1500, field: 'subtotal' },
          { id: 'total', value: 1623.75, field: 'total' },
          { id: 'phantom', value: 9999, field: 'total' },
        ],
      },
    })
    expect(v.references.source).toBe(true)
    expect(v.claims.find(c => c.claim_id === 'source.subtotal')?.outcome).toBe('PASS')
    expect(v.claims.find(c => c.claim_id === 'source.total')?.outcome).toBe('PASS')
    // a value not in the text abstains, never FAILs
    expect(v.claims.find(c => c.claim_id === 'source.phantom')?.outcome).toBe('INSUFFICIENT_DATA')
    expect(v.claims.find(c => c.claim_id === 'source.phantom')?.insufficiency?.reason).toBe('SPAN_NOT_FOUND')
    // the numeric footing still ran
    expect(v.claims.find(c => c.claim_id === 'document.SUM_INT')?.outcome).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })

  it('a quote that is not verbatim in the source FAILs the whole document (the anti-fudge / cite-check case)', () => {
    const opinion = 'The court holds that the agreement is unenforceable for want of consideration.'
    const v = verify({ invoice_number: 'X' }, {
      now,
      source: { text: opinion, quotes: [{ id: 'cite[0]', quote: 'the agreement is VOID for want of consideration', label: 'Brief p.4 n.2' }] },
    })
    const c = v.claims.find(x => x.claim_id === 'source.cite[0]')!
    expect(c.outcome).toBe('FAIL')
    expect(c.kind).toBe('QUOTE_MATCH')
    expect(c.computation?.operands.source_says).toMatch(/unenforceable/)
    expect(v.outcome).toBe('FAIL')
  })

  it('the source text participates in the verdict id, and the whole thing replays byte-identically', () => {
    const a = verify(singleLine, { now, source: { text: invoiceText, values: [{ id: 's', value: 1500, field: 'subtotal' }] } })
    const b = verify(singleLine, { now })
    expect(a.verdict_id).not.toBe(b.verdict_id)
    const a2 = verify(singleLine, { now: () => new Date('2030-01-01T00:00:00Z'), source: { text: invoiceText, values: [{ id: 's', value: 1500, field: 'subtotal' }] } })
    const drop = (v: typeof a) => JSON.stringify({ ...v, issued_at: '' })
    expect(drop(a)).toBe(drop(a2))
  })
})
