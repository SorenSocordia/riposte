/**
 * purchase-order ruleset 0.0.1 → 0.1.0 (E-INVOICE-2, 2026-09-28): LINE_PRICE moved from `amount` (rounded to the cent)
 * to the full-precision `price` kind, the same class as defect 6 of docs/RULESET-CORRECTIONS-2026-09-28.md.
 * Pre-registered in "Purchase-order LINE_PRICE" (pre-registration, 2026-09-28); the set (fixtures/po-price-set.ts) is
 * CONSTRUCTED. BEFORE = the 0.0.1 bytes the first golden keeps running; AFTER = docs/examples/purchase-order.ruleset.json.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative, lintRuleset, measureRuleset, type DeclarativeRuleset } from '../src/index'
import { PO_PRICE_SET } from './fixtures/po-price-set'

const HERE = dirname(fileURLToPath(import.meta.url))
const json = (...p: string[]): DeclarativeRuleset => JSON.parse(readFileSync(join(HERE, ...p), 'utf8')) as DeclarativeRuleset
const BEFORE = json('fixtures', 'golden-rulesets', 'purchase-order.ruleset.v0.0.1.json')
const AFTER = json('..', 'docs', 'examples', 'purchase-order.ruleset.json')
const measure = (rs: DeclarativeRuleset) => measureRuleset(rs, PO_PRICE_SET.map(c => ({ extraction: c.extraction, label: c.label })))
const counts = (rs: DeclarativeRuleset) => { const { tp, tn, fp, fn, abstain, total } = measure(rs).metrics; return { tp, tn, fp, fn, abstain, total } }
const line0 = (x: Record<string, unknown>, rs: DeclarativeRuleset) => verifyDeclarative(x, rs, { now: () => new Date(0) }).claims.find(c => c.claim_id === 'line[0].MATH_INT')!

describe('purchase-order LINE_PRICE is a full-precision unit price (0.1.0)', () => {
  it('only the version and the LINE_PRICE kind changed; it lints clean', () => {
    expect(AFTER.version).toBe('0.1.0')
    expect(AFTER.fields.LINE_PRICE!.kind).toBe('price')
    expect({ ...AFTER, version: BEFORE.version, fields: { ...AFTER.fields, LINE_PRICE: { ...AFTER.fields.LINE_PRICE!, kind: 'amount' } } }).toEqual(BEFORE)
    expect(lintRuleset(AFTER)).toEqual({ ok: true, errors: [], warnings: [] })
  })
  it('the pre-registered measurement: 0.0.1 fp 8/8, fn 3/6 → 0.1.0 fp 0/8, fn 0/6 (constructed set)', () => {
    expect(counts(BEFORE)).toEqual({ tp: 3, tn: 0, fp: 8, fn: 3, abstain: 0, total: 14 })
    expect(counts(AFTER)).toEqual({ tp: 6, tn: 8, fp: 0, fn: 0, abstain: 0, total: 14 })
    expect(measure(AFTER).accuracy).toMatchObject({ ruleset_version: '0.1.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: '52f9fc40df04378170d05007ffc858aaa09b4b73d748b6aa6697c62f10fdbb1c' })
  })
  it('1,000 × 0.125 = 125.00 PASSes; the amount computed with the cent-rounded price (130.00) now FAILs', () => {
    const po = (amount: number) => ({ items: [{ qty: 1000, unit_price: 0.125, amount }], subtotal: amount, tax: 0, total: amount })
    expect(line0(po(125), BEFORE)).toMatchObject({ outcome: 'FAIL', variance: -5 })
    expect(line0(po(125), AFTER).outcome).toBe('PASS')
    expect(line0(po(130), BEFORE).outcome).toBe('PASS')
    expect(line0(po(130), AFTER)).toMatchObject({ outcome: 'FAIL', variance: 5 })
  })
  it('a formatted price string with more than two decimals abstains (UNPARSEABLE); it is never rounded', () => {
    const c = line0({ items: [{ qty: 2, unit_price: '$1,234.5678', amount: 2469.14 }], subtotal: 2469.14, tax: 0, total: 2469.14 }, AFTER)
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE' })
    expect(line0({ items: [{ qty: 2, unit_price: '$1,234.56', amount: 2469.12 }], subtotal: 2469.12, tax: 0, total: 2469.12 }, AFTER).outcome).toBe('PASS')
  })
})
