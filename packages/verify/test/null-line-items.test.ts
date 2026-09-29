/**
 * F-BF1 (found by BOOK-FIRST, fixed by KERNEL-PERF, 2026-09-28): verify() threw on VALID JSON when line_items had two or
 * more entries and one was null. The heterogeneity scan read `item.description` of every line and died on the null
 * ("Cannot read properties of null (reading 'description')"). A null line is now a line with nothing to check: its claims
 * abstain, the other lines are judged as before, and nothing else moves. The frozen pre-F3 bridge is the witness that the
 * old behavior was the crash, and that every shape which did NOT crash binds exactly as it did.
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import { OntologicalBridge } from '../src/binding/ontological-bridge'
import * as FROZEN from './fixtures/frozen-bridge/ontological-bridge.frozen'
import { INVOICE_ONTOLOGY } from '../src/rulesets/invoice/ontology'

const NOW = () => new Date('2026-09-28T12:00:00Z')
type Bridge = { registerOntology(o: unknown): void; createLineItemBindings(d: string, i: unknown, c: unknown, e: unknown[]): unknown }
const make = (C: unknown): Bridge => {
  const b = new (C as new () => Bridge)()
  b.registerOntology(INVOICE_ONTOLOGY)
  return b
}
const attempt = (fn: () => unknown): string => {
  try {
    return 'ok ' + JSON.stringify(fn())
  } catch (e) {
    return `throw ${(e as Error).message}`
  }
}

const line = (description: string, quantity: number, unit_price: number) => ({ description, quantity, unit_price, amount: quantity * unit_price })
const CRASHED = [
  { line_items: [null, 5] },
  { line_items: [{}, null] },
  { line_items: [{ description: 'a' }, null] },
  { line_items: [line('Consulting', 1, 3), null, line('Freight', 2, 4)], totals: { subtotal: 11, total: 11 } },
  { line_items: [null, null, null] },
]

describe('F-BF1: a null line item abstains instead of crashing verify()', () => {
  it('the old bridge threw on every one of these valid JSON inputs', () => {
    for (const x of CRASHED) {
      expect(attempt(() => make(FROZEN.OntologicalBridge).createLineItemBindings('invoice', x, {}, []))).toBe("throw Cannot read properties of null (reading 'description')")
    }
  })

  it('now each gets a verdict; the null line\'s claims all abstain; nothing FAILs', () => {
    for (const x of CRASHED) {
      const v = verify(x as never, { now: NOW })
      expect(v.outcome).not.toBe('FAIL')
      const items = x.line_items as unknown[]
      items.forEach((item, i) => {
        if (item !== null) return
        const own = v.claims.filter(c => c.claim_id.startsWith(`line[${i}].`))
        expect(own.length).toBeGreaterThan(0)
        expect(own.every(c => c.outcome === 'INSUFFICIENT_DATA')).toBe(true)
      })
    }
  })

  it('the good lines around a null are still judged: line 0 and line 2 foot (MATH_INT PASS)', () => {
    const v = verify(CRASHED[3] as never, { now: NOW })
    const math = (i: number) => v.claims.find(c => c.claim_id === `line[${i}].MATH_INT`)!.outcome
    expect([math(0), math(1), math(2)]).toEqual(['PASS', 'INSUFFICIENT_DATA', 'PASS'])
    // a seeded error in a good line still FAILs with a null beside it
    const bad = structuredClone(CRASHED[3]) as { line_items: Array<{ amount: number } | null> }
    bad.line_items[2]!.amount += 25
    expect(verify(bad as never, { now: NOW }).outcome).toBe('FAIL')
  })

  it('shapes that never crashed bind exactly as the old bridge bound them', () => {
    for (const x of [{ line_items: [null] }, { line_items: [5] }, { line_items: [5, 'x'] }, { line_items: [0, false, ''] }, { line_items: [line('Freight haul', 1, 2), 7, line('Fuel surcharge', 1, 1)] }]) {
      const now = attempt(() => make(OntologicalBridge).createLineItemBindings('invoice', x, {}, []))
      expect(now).toBe(attempt(() => make(FROZEN.OntologicalBridge).createLineItemBindings('invoice', x, {}, [])))
      expect(now.startsWith('ok ')).toBe(true)
    }
  })
})
