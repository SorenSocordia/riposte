/**
 * Seeded generative fuzzing for the pay-app ruleset — W1 (never a hallucinated verdict) under adversarial shapes:
 * $-strings, EU strings, percent strings, bare fractions, negatives, nulls, junk types, missing columns, alternate
 * vocabularies, a schedule of values that isn't an array, duplicate item numbers, junk history documents.
 *
 * For EVERY generated input, verify() must never throw, satisfy every schema invariant, and replay byte-identically.
 */
import { describe, it, expect } from 'vitest'
import { verify, replayView, MIN_VERDICT_CONFIDENCE } from '../src/index'
import type { Verdict } from '../src/index'

const CASES = 250
const FIXED_NOW = () => new Date('2026-09-22T00:00:00Z')
type Json = Record<string, unknown>

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

function money(r: R, v: number): unknown {
  const us = Math.abs(v).toFixed(2)
  const [ip, fp] = us.split('.')
  const grouped = `${Number(ip).toLocaleString('en-US')}.${fp}`
  const eu = `${Number(ip).toLocaleString('de-DE')},${fp}`
  return pick<() => unknown>(r, [
    () => v, () => Number(v.toFixed(2)), () => (v < 0 ? `-$${grouped}` : `$${grouped}`), () => (v < 0 ? `(${grouped})` : grouped),
    () => `${eu} €`, () => null, () => '', () => 'TBD', () => true, () => [v], () => ({ amount: v }),
  ])()
}
function percent(r: R, frac: number): unknown {
  return pick<() => unknown>(r, [() => frac * 100, () => `${(frac * 100).toFixed(1)}%`, () => frac, () => `${(frac * 100).toFixed(0)} %`, () => null, () => 'done'])()
}

const LINE_KEYS = {
  id: ['item_no', 'item_number', 'item', 'no', 'id', 'cost_code'],
  c: ['scheduled_value', 'scheduled_amount', 'contract_value', 'value'],
  d: ['previous', 'from_previous_application', 'work_completed_previous', 'prior'],
  e: ['this_period', 'work_completed_this_period', 'current'],
  f: ['materials_stored', 'stored_materials', 'stored'],
  g: ['completed_to_date', 'total_completed_and_stored', 'total_to_date'],
  pct: ['percent_complete', 'percent', 'pct'],
  h: ['balance_to_finish', 'balance', 'remaining'],
  i: ['retainage', 'retention', 'retained'],
}

function genLine(r: R, idx: number): Json {
  const c = pick(r, [10000, 50000, 40000, 1234.56, 0, 99999.99])
  const d = pick(r, [0, 10000, 20000, 5000.5])
  const e = pick(r, [0, 15000, 12000, 250])
  const f = pick(r, [0, 0, 5000])
  const g = chance(r, 0.7) ? d + e + f : d + e + f + pick(r, [1000, -500, 0.01])
  const line: Json = {}
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.id)] = pick(r, [String(idx + 1), idx + 1, `0${idx + 1}.00`, null, '2'])
  if (chance(r, 0.8)) line.description = pick(r, ['Mobilization', 'Concrete', 'Framing', 7, ''])
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.c)] = money(r, c)
  if (chance(r, 0.8)) line[pick(r, LINE_KEYS.d)] = money(r, d)
  if (chance(r, 0.8)) line[pick(r, LINE_KEYS.e)] = money(r, e)
  if (chance(r, 0.5)) line[pick(r, LINE_KEYS.f)] = money(r, f)
  if (chance(r, 0.9)) line[pick(r, LINE_KEYS.g)] = money(r, g)
  if (chance(r, 0.8)) line[pick(r, LINE_KEYS.pct)] = percent(r, c ? g / c : 0)
  if (chance(r, 0.8)) line[pick(r, LINE_KEYS.h)] = money(r, c - g)
  if (chance(r, 0.6)) line[pick(r, LINE_KEYS.i)] = money(r, g * 0.1)
  if (chance(r, 0.15)) line.junk = { nested: [1, { deep: null }] }
  return line
}

function genApp(r: R): Json {
  const app: Json = {}
  if (chance(r, 0.8)) app[pick(r, ['application_number', 'pay_app_number', 'number'])] = pick(r, [2, '2', 'PA-002', null, 'two'])
  const n = Math.floor(r() * 5)
  const lines = Array.from({ length: n }, (_, i) => genLine(r, i))
  const shape = r()
  if (shape < 0.6) app.schedule_of_values = lines
  else if (shape < 0.8) app.line_items = lines
  else if (shape < 0.9) app.schedule_of_values = 'see G703'
  else if (shape < 0.95) app.continuation_sheet = { not: 'an array' }
  const sum = (k: string): number => lines.reduce((a, l) => a + (typeof l[k] === 'number' ? (l[k] as number) : 0), 0)
  const l1 = pick(r, [95000, 100000, 0]), l2 = pick(r, [5000, 0, -2500]), l3 = chance(r, 0.7) ? l1 + l2 : l1
  const l4 = chance(r, 0.6) ? sum('completed_to_date') : pick(r, [62000, 30000])
  const rate = pick(r, [0.1, 0.05, 0])
  const l5 = chance(r, 0.7) ? l4 * rate : 6000
  const l6 = l4 - l5, l7 = pick(r, [27000, 0, 12345.67]), l8 = chance(r, 0.7) ? l6 - l7 : l6
  const doc: Json = {}
  if (chance(r, 0.85)) doc[pick(r, ['original_contract_sum', 'original_contract_amount'])] = money(r, l1)
  if (chance(r, 0.6)) doc[pick(r, ['net_change_orders', 'net_change_by_change_orders'])] = money(r, l2)
  if (chance(r, 0.85)) doc[pick(r, ['contract_sum_to_date', 'revised_contract_sum'])] = money(r, l3)
  if (chance(r, 0.85)) doc[pick(r, ['total_completed_and_stored', 'total_completed_to_date'])] = money(r, l4)
  if (chance(r, 0.7)) doc[pick(r, ['retainage_rate', 'retainage_percent'])] = percent(r, rate)
  if (chance(r, 0.8)) doc[pick(r, ['total_retainage', 'retainage'])] = money(r, l5)
  if (chance(r, 0.85)) doc[pick(r, ['total_earned_less_retainage', 'earned_less_retainage'])] = money(r, l6)
  if (chance(r, 0.7)) doc[pick(r, ['less_previous_certificates', 'previous_payments'])] = money(r, l7)
  if (chance(r, 0.85)) doc[pick(r, ['current_payment_due', 'payment_due', 'amount_due'])] = money(r, l8)
  if (chance(r, 0.7)) doc[pick(r, ['balance_to_finish_including_retainage', 'balance_to_finish'])] = money(r, l3 - l6)
  if (chance(r, 0.5)) app.summary = doc
  else Object.assign(app, doc)
  return app
}

function genHistory(r: R): Json[] | undefined {
  if (!chance(r, 0.5)) return undefined
  return pick<Json[]>(r, [
    [genApp(r)],
    [genApp(r), genApp(r)],
    [{ application_number: 1, schedule_of_values: [{ item_no: '1', completed_to_date: 10000 }, { item_no: '1', completed_to_date: 5 }], total_earned_less_retainage: 27000 }],
    [{ schedule_of_values: 'none' }],
    [null as unknown as Json, 'junk' as unknown as Json, 7 as unknown as Json],
    [],
    'not an array' as unknown as Json[],
  ])
}

function assertInvariants(v: Verdict, label: string): void {
  expect(v.replayable, label).toBe(true)
  expect(v.ruleset.id, label).toBe('pay-app')
  const ids = new Set<string>()
  let pass = 0, fail = 0, ins = 0
  for (const c of v.claims) {
    expect(ids.has(c.claim_id), `${label} duplicate claim id ${c.claim_id}`).toBe(false)
    ids.add(c.claim_id)
    expect(['PASS', 'FAIL', 'INSUFFICIENT_DATA'], `${label} ${c.claim_id}`).toContain(c.outcome)
    if (c.outcome === 'INSUFFICIENT_DATA') {
      ins++
      expect(c.insufficiency?.reason, `${label} ${c.claim_id}`).toBeTruthy()
      expect((c.insufficiency?.detail ?? '').length, `${label} ${c.claim_id}`).toBeGreaterThan(0)
      expect(c.locked, `${label} ${c.claim_id}`).toBe(false)
    } else {
      if (c.outcome === 'PASS') pass++; else fail++
      expect(c.evidence.length, `${label} ${c.claim_id} has no evidence`).toBeGreaterThan(0)
      expect(c.computation, `${label} ${c.claim_id}`).toBeDefined()
      for (const e of c.evidence) expect(e.confidence, `${label} ${c.claim_id} ${JSON.stringify(e.locator)}`).toBeGreaterThanOrEqual(MIN_VERDICT_CONFIDENCE)
      if (c.locked) expect(c.outcome, `${label} ${c.claim_id} locked PASS`).toBe('FAIL')
      if (c.variance !== undefined) expect(Number.isFinite(c.variance), `${label} ${c.claim_id} variance`).toBe(true)
    }
  }
  expect(v.coverage, label).toEqual({ claims_total: v.claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins })
  expect(v.outcome, label).toBe(fail > 0 ? 'FAIL' : pass + fail === 0 ? 'INSUFFICIENT_DATA' : 'PASS')
}

describe(`generative fuzz — pay-app — ${CASES} seeded adversarial applications (with junk history)`, () => {
  for (let seed = 1; seed <= CASES; seed++) {
    it(`seed ${seed}: never throws, every invariant holds, replays byte-identically`, () => {
      const r = mulberry32(seed * 7919)
      const app = genApp(r)
      const history = genHistory(r)
      const opts = { ruleset: 'pay-app' as const, now: FIXED_NOW, ...(history !== undefined ? { references: { history } } : {}) }
      let v: Verdict | undefined
      try { v = verify(app, opts) } catch (e) { throw new Error(`seed ${seed} threw: ${(e as Error).stack}\n${JSON.stringify({ app, history }).slice(0, 2000)}`) }
      assertInvariants(v, `seed ${seed}`)
      const again = verify(JSON.parse(JSON.stringify(app)), JSON.parse(JSON.stringify({ ...opts, now: undefined })) as never)
      expect(JSON.stringify(replayView({ ...again, issued_at: v.issued_at }))).toBe(JSON.stringify(replayView(v)))
    })
  }
})
