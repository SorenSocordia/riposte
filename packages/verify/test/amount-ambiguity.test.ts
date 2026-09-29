/**
 * Money parsing (2026-09-28; the bug was found by E-INVOICE-2 and fixed by KERNEL-PERF):
 *   (a) "0.125" parsed as 125: the "period + exactly 3 digits = European thousands" branch fired on it. A leading "0."
 *       (the sign is stripped first, so "-0.125" too) is never a thousands group, so it is a decimal. SHIPPED.
 *   (b) proposed: refuse a lone "1.250" (US 1.25 / EU 1250) as ambiguous. NOT shipped (DECISION, see
 *       the performance note "Per-document hoist in the bridge", 2026-09-28, §5): it moved no golden, but it turned a real CORD receipt
 *       (Indonesian, "25.000" = 25,000) from PASS to INSUFFICIENT_DATA. A lone "d.ddd" keeps reading as thousands, pinned
 *       below so the choice is visible, and a locale option is the fork.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAmount } from '../src/binding/forensic-normalizer'
import { verifyDeclarative } from '../src/index'

const NOW = () => new Date('2026-09-28T12:00:00Z')

describe('(a) a leading "0." is a decimal point, never a thousands separator', () => {
  it('0.125, -0.125, $0.125, (0.125) and 0.125 EUR are about an eighth, not 125', () => {
    for (const s of ['0.125', '-0.125', '$0.125', '(0.125)', '0.125 EUR']) {
      const r = normalizeAmount(s)!
      expect(r.success).toBe(true)
      expect(Math.abs(r.normalized)).toBeLessThan(1)
      expect(r.transformations).not.toContain('european_format_converted')
    }
    expect(normalizeAmount('0.125')!.normalized).toBe(0.13) // amounts are cent-rounded, as every other amount
  })

  it('declarative (the shipped Peppol ruleset): a unit price of "0.125" × 1000 foots to 125', () => {
    const rs = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'peppol-en16931.ruleset.json'), 'utf8'))
    const line = (l: Record<string, unknown>) =>
      verifyDeclarative({ lines: [l] }, rs, { now: NOW }).claims.find(c => c.claim_id === 'line[0].LINE_MATH_INT')!.outcome
    expect(line({ invoiced_quantity: 1000, price_amount: '0.125', line_extension_amount: 125 })).toBe('PASS')
    expect(line({ invoiced_quantity: 1000, price_amount: 0.125, line_extension_amount: 125 })).toBe('PASS')
  })
})

describe('everything else reads as before', () => {
  it('separators that disambiguate, and the lone "d.ddd" kept as thousands (the (b) DECISION)', () => {
    const cases: Array<[string, number]> = [
      ['1.250.000', 1250000], ['1.250,50', 1250.5], ['1,250.50', 1250.5], ['1,250', 1250], ['1.25', 1.25],
      ['0.12', 0.12], ['1250.5', 1250.5], ['12,5', 12.5], ['1250', 1250], ['$1,234.56', 1234.56], ['1.234.567,89', 1234567.89],
      // (b) not shipped: a lone d.ddd stays a thousands group (Indonesian / EU receipts depend on it)
      ['1.250', 1250], ['25.000', 25000], ['999.999', 999999],
    ]
    for (const [s, n] of cases) expect([s, normalizeAmount(s)!.normalized, normalizeAmount(s)!.success]).toEqual([s, n, true])
  })
})
