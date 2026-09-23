/**
 * REAL-DOCUMENT test (roadmap 1.4): the verifier run against real CORD receipts (naver-clova-ix/cord-v2, CC-BY-4.0),
 * not hand-written fixtures. This proves the footing check holds on messy real data — rupiah formatting, "1 x" counts,
 * service charges and discounts — and never crashes. It is the honest counterpart to the synthetic Index.
 *
 * Ground truth: CORD is an extraction dataset, not a correctness-labelled one, so we do NOT compute FP/FN here. We assert
 * the real-world facts we measured from the data: Σ line prices == subtotal on every sampled receipt, and once the service
 * charge is modelled, subtotal + tax + service − discount == total. A receipt we can't fully bind abstains, never guesses.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../src/index'
import { cordSampleToCases, cordToExtraction, type CordSampleFile } from '../src/bench/adapters/cord'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const samplePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'real', 'A-invoices-receipts', 'cord-v2.sample.json')

describe('discount sign convention (surfaced by real CORD data)', () => {
  it('a discount stored as a NEGATIVE number still reduces the total (not adds it)', () => {
    // subtotal 63,636 + tax 5,409 − |−9,545| = 59,500 = the real total (cord-7).
    const ex: Json = {
      invoice_number: 'D1', currency: 'IDR',
      line_items: [{ description: 'x', quantity: 1, unit_price: 63636, amount: 63636 }],
      totals: { subtotal: 63636, tax: 5409, discount: -9545, total: 59500 },
    }
    expect(verify(ex, { now: NOW }).claims.find(c => c.claim_id === 'document.TOTAL_INT')?.outcome).toBe('PASS')
  })
})

describe('CORD adapter', () => {
  it('maps a receipt to the extraction shape: line amounts, and a totals block with service + discount', () => {
    const ex = cordToExtraction(
      { menu: [{ nm: 'Coffee', cnt: '2 x', price: '30,000' }], sub_total: { subtotal_price: '30,000', tax_price: '3,000', service_price: '1,500' }, total: { total_price: '34,500' } },
      'R1',
    )
    expect(ex.line_items).toEqual([{ description: 'Coffee', quantity: 2, amount: '30,000' }])
    expect(ex.totals).toMatchObject({ subtotal: '30,000', tax: '3,000', service_charge: '1,500', total: '34,500' })
  })
})

describe('the verifier on real CORD receipts', () => {
  const file = JSON.parse(readFileSync(samplePath, 'utf8')) as CordSampleFile
  const cases = cordSampleToCases(file)

  it('the sample file is the real CC-BY-4.0 CORD data', () => {
    expect(file.source_dataset).toMatch(/cord/i)
    expect(file.license.toLowerCase()).toContain('cc-by')
    expect(cases.length).toBeGreaterThanOrEqual(5)
  })

  it('never throws, and every verdict is well-formed, on real messy receipts', () => {
    for (const c of cases) {
      const v = verify(c.extraction, { now: NOW })
      expect(['PASS', 'FAIL', 'INSUFFICIENT_DATA']).toContain(v.outcome)
      for (const claim of v.claims) {
        if (claim.outcome !== 'INSUFFICIENT_DATA') expect(claim.evidence.length, `${c.name} ${claim.claim_id}`).toBeGreaterThan(0)
      }
    }
  })

  it('the footing check (Σ line prices = subtotal) holds on every sampled real receipt', () => {
    for (const c of cases) {
      const v = verify(c.extraction, { now: NOW })
      const sum = v.claims.find(x => x.claim_id === 'document.SUM_INT')
      expect(sum?.outcome, `${c.name} SUM_INT`).toBe('PASS')
    }
  })

  it('with the service charge now modelled, the total reconciles (subtotal + tax + service − discount) on every receipt', () => {
    for (const c of cases) {
      const v = verify(c.extraction, { now: NOW })
      const total = v.claims.find(x => x.claim_id === 'document.TOTAL_INT')
      // TOTAL_INT PASSes where a total is present; abstains only if the receipt omits a needed field — never FAILs on these real receipts.
      expect(total?.outcome, `${c.name} TOTAL_INT`).not.toBe('FAIL')
    }
  })
})
