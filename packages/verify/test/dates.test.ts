/**
 * Date honesty — regression suite for the fuzz-found crash (seed 30: "15/09/2026" parsed as month 15 → Invalid Date →
 * RangeError inside the kernel). A date that isn't a date is a type mismatch, never a verdict, never a crash.
 */
import { describe, it, expect } from 'vitest'
import { normalizeDate } from '../src/binding/forensic-normalizer'
import { verify } from '../src/index'
import { FIXED_NOW, singleLine, contractOk } from './fixtures/invoices'

describe('date normalization', () => {
  it('day-first slash dates parse day-first when the first field cannot be a month', () => {
    const r = normalizeDate('15/09/2026')
    expect(r?.success).toBe(true)
    expect(r?.normalized).toBe('2026-09-15')
    expect(r?.transformations).toContain('european_format_parsed')
  })

  it('US slash dates still parse month-first', () => {
    const r = normalizeDate('09/15/2026')
    expect(r?.normalized).toBe('2026-09-15')
    expect(r?.transformations).toContain('us_format_parsed')
  })

  it('ambiguous slash dates are flagged and honor the locale hint', () => {
    const us = normalizeDate('03/04/2026')
    expect(us?.transformations).toContain('AMBIGUOUS_DATE')
    expect(us?.normalized).toBe('2026-03-04')
    expect(normalizeDate('03/04/2026', { locale: 'EU' })?.normalized).toBe('2026-04-03')
    expect(normalizeDate('12/12/2026')?.transformations).not.toContain('AMBIGUOUS_DATE')
  })

  it('impossible calendar dates never succeed, in any format', () => {
    for (const bad of ['2026-15-09', '2026-02-30', '31/04/2026', '13/13/2026', 'Feb 30, 2026', '2026-13-01T10:00:00Z']) {
      expect(normalizeDate(bad)?.success, bad).toBe(false)
    }
  })

  it('valid dates in every supported shape agree', () => {
    for (const good of ['2026-09-15', '2026-09-15T08:30:00Z', '09/15/2026', '9/15/26', '15/09/2026', 'Sep 15, 2026', 'September 15th, 2026', '15-09-2026']) {
      expect(normalizeDate(good)?.normalized, good).toBe('2026-09-15')
    }
  })
})

describe('an unparseable invoice date in the kernel', () => {
  it('TIME_ORD abstains with UNPARSEABLE — never a crash, never a verdict', () => {
    const v = verify({ ...singleLine, invoice_date: '2026-15-09' }, { now: FIXED_NOW, references: { contract: contractOk } })
    const c = v.claims.find(x => x.claim_id === 'document.TIME_ORD')
    expect(c?.outcome).toBe('INSUFFICIENT_DATA')
    expect(c?.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(c?.locked).toBe(false)
    // the receipt still shows what was there, with the failed normalization recorded
    const ev = c?.evidence.find(e => e.locator.kind === 'field' && e.locator.source === 'invoice')
    expect(ev?.value).toBe('2026-15-09')
    expect(ev?.normalizations).toContain('invalid_calendar_date')
  })

  it('a day-first date inside the term still verifies', () => {
    const v = verify({ ...singleLine, invoice_date: '15/09/2026' }, { now: FIXED_NOW, references: { contract: contractOk } })
    expect(v.claims.find(x => x.claim_id === 'document.TIME_ORD')?.outcome).toBe('PASS')
  })
})
