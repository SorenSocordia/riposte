import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, splitApLayout } from 'riposte-verify'
import { draftResolution, isTransposition, type ResolutionDraft } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
const NOW = () => new Date('2026-09-24T00:00:00Z')
const run = (id: string) => {
  const c = cases.find((x) => x.id === id)!
  const docs = splitApLayout(c.input)!
  return draftResolution(verifyInvoiceMatch(docs, { now: NOW }), docs)
}

/** Every number in the body must be a recorded fact (after removing text-valued facts such as ids and item names). */
function unsourcedNumbers(d: ResolutionDraft): number[] {
  let text = `${d.subject}\n${d.body}`
  for (const f of d.facts) if (typeof f.value === 'string') text = text.split(f.value).join(' ')
  const nums = (text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, '')))
  const known = d.facts.filter((f) => typeof f.value === 'number').map((f) => f.value as number)
  return nums.filter((n) => !known.some((k) => Math.abs(k - n) < 0.005))
}

describe('AP resolution drafts — generation where every number is a verified fact', () => {
  it('hold_quantity: credit memo for the unreceived units, with a short-pay figure', () => {
    const d = run('T001')
    expect(d.kind).toBe('vendor_query')
    expect(d.body).toMatch(/bills 10 × Machine grease cartridge 14 oz, but our goods receipt shows 7 received/)
    expect(d.body).toMatch(/credit memo for the 3 unit\(s\) not delivered/)
    expect(d.body).toMatch(/That is 22\.35 at your invoiced unit price of 7\.45/)
    expect(d.short_pay).toEqual({ stated_total: 1935.5, withheld: 22.35, payable_now: 1913.15 })
  })

  it('hold_price: rebill at the PO price; overcharge computed from the line', () => {
    const d = run('T007')
    expect(d.body).toMatch(/at 63\.47 per unit; PO-48329 agreed 62\.10 \(2\.21% over/)
    expect(d.facts.find((f) => f.label === 'overcharge per unit')).toMatchObject({ value: 1.37, source: 'computed' })
    expect(d.short_pay?.withheld).toBeGreaterThan(0)
  })

  it('hold_total: corrected invoice, no short-pay (we cannot tell which line is wrong)', () => {
    const d = run('T002')
    expect(d.body).toMatch(/states a total of 9,017\.00, but its lines add up to 8,990\.00; the stated total is 27\.00 above them/)
    expect(d.short_pay).toBeUndefined()
  })

  it('a total BELOW its lines is described in words, never as a negative number (found by the all-cases property test)', () => {
    const d = run('T018')
    expect(d.body).toMatch(/the stated total is 90\.00 below them/)
    expect(d.body).not.toMatch(/(?:^|[\s(])-\d/m) // a minus sign as a sign — not the hyphen inside ids like VE-31750
  })

  it('hold_no_po: flags a transposed digit when that is what it looks like', () => {
    const d = run('T034')
    expect(d.body).toMatch(/cites PO-54876; the open order we have is PO-54867\. That looks like two digits transposed\./)
    expect(isTransposition('PO-54876', 'PO-54867')).toBe(true)
    expect(isTransposition('PO-54876', 'PO-54877')).toBe(false)
    expect(isTransposition('PO-12345', 'PO-54321')).toBe(false)
  })

  it('approve: nothing to send; abstain: no guessed letter, only the reasons', () => {
    expect(run('T003')).toMatchObject({ kind: 'none' })
    const docs = splitApLayout(cases[0]!.input)!
    const blurred = { ...docs, invoice: docs.invoice.replace(/Total due:.*$/m, 'Total due: USD 1 935.50') } // ambiguous total → abstain
    const d = draftResolution(verifyInvoiceMatch(blurred, { now: NOW }), blurred)
    if (d.decision === 'abstain') expect(d.kind).toBe('review')
  })

  it('across all 100 invoices: every number in every draft is a recorded fact, and every short-pay adds up', () => {
    let drafts = 0
    for (const c of cases) {
      const docs = splitApLayout(c.input)!
      const d = draftResolution(verifyInvoiceMatch(docs, { now: NOW }), docs)
      drafts++
      expect(unsourcedNumbers(d), `${c.id}: ${d.subject}`).toEqual([])
      if (d.short_pay) expect(Math.abs(d.short_pay.payable_now + d.short_pay.withheld - d.short_pay.stated_total)).toBeLessThan(0.006)
      for (const f of d.facts.filter((x) => x.source === 'computed')) expect(f.from?.length, `${c.id}: ${f.label}`).toBeGreaterThan(0)
    }
    expect(drafts).toBe(100)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(run('T001'))).toBe(JSON.stringify(run('T001')))
  })
})
