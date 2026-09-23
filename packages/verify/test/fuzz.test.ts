/**
 * Seeded generative fuzzing — pre-registered claim W1 ("zero hallucinated verdicts by construction") as a TEST,
 * not a slogan. Hundreds of random, adversarial extractions: mixed number formats (US / EU / parenthesized /
 * currency-prefixed), missing and duplicated fields, unknown key names that only fuzzy-match, `line_items`
 * that isn't an array, junk types, prior-id fields of the wrong shape.
 *
 * For EVERY generated input, verify() must:
 *   - never throw
 *   - satisfy every schema invariant (three outcomes; PASS/FAIL ⇒ evidence, computation, all operands ≥ 90, no
 *     insufficiency; INSUFFICIENT_DATA ⇒ explained; unique claim ids; coverage sums; aggregation rule)
 *   - replay byte-identically (W2, under fuzz)
 *
 * The PRNG is seeded (mulberry32); a failure names its seed so it can be reproduced exactly.
 */
import { describe, it, expect } from 'vitest'
import { verify, replayView, MIN_VERDICT_CONFIDENCE } from '../src/index'
import type { Verdict } from '../src/index'

const CASES = 400
const FIXED_NOW = () => new Date('2026-09-22T00:00:00Z')

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type R = () => number
const pick = <T,>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const chance = (r: R, p: number): boolean => r() < p

const LINE_KEYS = {
  qty: ['quantity', 'qty', 'units', 'hours', 'count', 'how_many', 'n'],
  rate: ['unit_price', 'rate', 'price', 'unit_cost', 'cost', 'each', 'tariff'],
  amount: ['amount', 'total', 'line_total', 'extended_amount', 'charge', 'value', 'net'],
  desc: ['description', 'item', 'service', 'name', 'sku', 'memo'],
} as const
const DOC_KEYS = {
  subtotal: ['subtotal', 'sub_total', 'net_amount', 'before_tax', 'basis'],
  tax: ['tax', 'tax_amount', 'vat', 'sales_tax', 'levy'],
  rate: ['tax_rate', 'vat_rate', 'tax_percent', 'tax_pct', 'pct'],
  total: ['total', 'grand_total', 'amount_due', 'balance_due', 'sum_due'],
  discount: ['discount', 'discount_amount', 'rebate', 'markdown'],
} as const

/** Render a money value in one of many real-world shapes — or as junk. */
function money(r: R, v: number): unknown {
  const abs = Math.abs(v)
  const us = abs.toFixed(2)
  const [ip, fp] = us.split('.')
  const usGrouped = `${Number(ip).toLocaleString('en-US')}.${fp}`
  const eu = `${Number(ip).toLocaleString('de-DE')},${fp}`
  const forms: Array<() => unknown> = [
    () => v,
    () => Number(v.toFixed(2)),
    () => (v < 0 ? `-${us}` : us),
    () => (v < 0 ? `-$${usGrouped}` : `$${usGrouped}`),
    () => (v < 0 ? `(${usGrouped})` : usGrouped),
    () => (v < 0 ? `-${eu} €` : `${eu} €`),
    () => `USD ${us}`,
    () => `${us}-`,
    () => null,
    () => 'n/a',
    () => true,
    () => ({ value: v }),
    () => [v],
  ]
  return pick(r, forms)()
}

function rateValue(r: R, v: number): unknown {
  const pct = (v * 100)
  const forms: Array<() => unknown> = [
    () => v,
    () => `${pct.toFixed(2)}%`,
    () => `${pct.toFixed(2).replace('.', ',')} %`,
    () => pct,           // bare percent → heuristic
    () => null,
    () => 'exempt',
  ]
  return pick(r, forms)()
}

function genLine(r: R): Record<string, unknown> {
  const qty = pick(r, [1, 2, 3, 10, 12, 0.5, 100])
  const rate = pick(r, [9.99, 150, 250.5, 33.33, 1000, 0.05])
  const coherent = chance(r, 0.6)
  const amount = coherent ? Math.round(qty * rate * 100) / 100 : Math.round((qty * rate + pick(r, [0.01, 1, 24.5, -10])) * 100) / 100
  const line: Record<string, unknown> = {}
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.desc)] = pick(r, ['Consulting', 'Widget', 'Transport', 'Fuel surcharge', ''])
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.qty)] = chance(r, 0.8) ? qty : `${qty} hrs`
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.rate)] = money(r, rate)
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.amount)] = money(r, amount)
  if (chance(r, 0.2)) line.junk = { nested: [1, 2, { deep: 'x' }] }
  return line
}

function genInvoice(r: R): Record<string, unknown> {
  const inv: Record<string, unknown> = {}
  if (chance(r, 0.9)) inv[pick(r, ['invoice_number', 'document_number', 'id', 'ref'])] = pick(r, ['INV-1', 'INV-0042', 42, null])
  if (chance(r, 0.7)) inv[pick(r, ['invoice_date', 'date', 'service_date', 'issued'])] = pick(r, ['2026-09-15', '09/15/2026', '15/09/2026', 'Sep 15, 2026', 'yesterday', null])
  if (chance(r, 0.5)) inv.currency = pick(r, ['USD', 'EUR', 'usd', 7, null])

  const nLines = Math.floor(r() * 6)
  const lines = Array.from({ length: nLines }, () => genLine(r))
  const shape = r()
  if (shape < 0.75) inv.line_items = lines
  else if (shape < 0.85) inv.line_items = 'see attached'
  else if (shape < 0.92) inv.line_items = { not: 'an array' }
  else if (shape < 0.96) inv.items = lines
  // else: no line items at all

  const sub = Math.round(lines.reduce((a, l) => a + (typeof l.amount === 'number' ? l.amount : 0), 0) * 100) / 100 || pick(r, [100, 1750.5, 0])
  const rate = pick(r, [0, 0.0825, 0.19, 0.2, 0.0725])
  const tax = Math.round(sub * rate * 100) / 100
  const disc = chance(r, 0.3) ? pick(r, [0, 10, 12.5]) : 0
  const total = Math.round((sub + tax - disc) * 100) / 100
  const totals: Record<string, unknown> = {}
  if (chance(r, 0.85)) totals[pick(r, DOC_KEYS.subtotal)] = money(r, sub)
  if (chance(r, 0.7)) totals[pick(r, DOC_KEYS.tax)] = money(r, tax)
  if (chance(r, 0.7)) totals[pick(r, DOC_KEYS.rate)] = rateValue(r, rate)
  if (disc && chance(r, 0.8)) totals[pick(r, DOC_KEYS.discount)] = money(r, disc)
  if (chance(r, 0.9)) totals[pick(r, DOC_KEYS.total)] = money(r, chance(r, 0.7) ? total : total + 1)
  if (chance(r, 0.6)) inv.totals = totals
  else Object.assign(inv, totals)

  if (chance(r, 0.25)) inv.prior_invoice_ids = pick(r, [[], ['INV-0'], 'INV-0', 7, null])
  if (chance(r, 0.15)) inv.dates = pick(r, ['2026-01-01', [{ type: 'service_date', value: '2026-09-15' }], [null], 12])
  return inv
}

function assertInvariants(v: Verdict, label: string): void {
  expect(v.replayable, label).toBe(true)
  expect(v.verdict_id, label).toMatch(/^[0-9a-f]{32}$/)
  const ids = new Set<string>()
  let pass = 0, fail = 0, ins = 0
  for (const c of v.claims) {
    expect(ids.has(c.claim_id), `${label} duplicate claim id ${c.claim_id}`).toBe(false)
    ids.add(c.claim_id)
    expect(['PASS', 'FAIL', 'INSUFFICIENT_DATA'], `${label} ${c.claim_id}`).toContain(c.outcome)
    expect(c.tier, label).toBe('DETERMINISTIC')
    if (c.outcome === 'INSUFFICIENT_DATA') {
      ins++
      expect(c.insufficiency?.reason, `${label} ${c.claim_id}`).toBeTruthy()
      expect((c.insufficiency?.detail ?? '').length, `${label} ${c.claim_id}`).toBeGreaterThan(0)
      expect(c.locked, `${label} ${c.claim_id}`).toBe(false)
    } else {
      if (c.outcome === 'PASS') pass++; else fail++
      expect(c.evidence.length, `${label} ${c.claim_id} has no evidence`).toBeGreaterThan(0)
      expect(c.computation, `${label} ${c.claim_id}`).toBeDefined()
      expect(c.insufficiency, `${label} ${c.claim_id}`).toBeUndefined()
      for (const e of c.evidence) {
        expect(e.confidence, `${label} ${c.claim_id} operand ${JSON.stringify(e.locator)} below threshold`).toBeGreaterThanOrEqual(MIN_VERDICT_CONFIDENCE)
      }
      if (c.locked) expect(c.outcome, `${label} ${c.claim_id} locked PASS`).toBe('FAIL')
    }
  }
  expect(v.coverage, label).toEqual({ claims_total: v.claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins })
  const expected = fail > 0 ? 'FAIL' : pass + fail === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  expect(v.outcome, label).toBe(expected)
}

type Json = Record<string, unknown>

/** Sometimes supply reference documents — well-formed, malformed, or containing junk — so cross-document paths get fuzzed too. */
function genRefs(r: R): { contract?: Json; evidence?: Json[] } | undefined {
  if (!chance(r, 0.35)) return undefined
  const refs: { contract?: Json; evidence?: Json[] } = {}
  if (chance(r, 0.6)) {
    refs.contract = pick<Json>(r, [
      { rates: [{ rate: 150 }], max_amount: 5000, effective_date: '2026-01-01', expiration_date: '2026-12-31' },
      { rates: [{ rate: 140 }], max_amount: '5,000.00', effective_date: '2026-01-01', expiration_date: '2026-12-31' },
      { rates: 'n/a', max_amount: 'lots', effective_date: 'never' },
      { financial_rules: [null, { rule_name: 'Consulting', values: { rate: 150 } }, 'junk'] },
      { financial_rules: 'none' },
      {},
      null as unknown as Json,
    ])
  }
  if (chance(r, 0.6)) {
    refs.evidence = pick<Json[]>(r, [
      [{ line_items: [{ description: 'Consulting', quantity: 10 }], totals: { total: 1500 }, date: '2026-09-15' }],
      [{ line_items: [{ description: 7, quantity: '10 hrs' }], totals: { total: 'x' }, description: 42 }],
      [null as unknown as Json, { description: 'Thing', quantity: 8 }],
      [{ line_items: 'none', dates: 'x' }, { line_items: [null], dates: [null] }],
      [],
      'not an array' as unknown as Json[],
    ])
  }
  return refs
}

describe(`generative fuzz — ${CASES} seeded adversarial extractions (with junk references)`, () => {
  for (let seed = 1; seed <= CASES; seed++) {
    it(`seed ${seed}: never throws, every invariant holds, replays byte-identically`, () => {
      const r = mulberry32(seed)
      const input = genInvoice(r)
      const references = genRefs(r)
      const label = `seed=${seed} input=${JSON.stringify(input)} refs=${JSON.stringify(references)}`

      let v: Verdict | undefined
      expect(() => { v = verify(input, { now: FIXED_NOW, references }) }, label).not.toThrow()
      assertInvariants(v as Verdict, label)

      const again = verify(
        JSON.parse(JSON.stringify(input)),
        { now: FIXED_NOW, references: references === undefined ? undefined : JSON.parse(JSON.stringify(references)) },
      )
      expect(JSON.stringify(replayView(again)), label).toBe(JSON.stringify(replayView(v as Verdict)))
    })
  }
})
