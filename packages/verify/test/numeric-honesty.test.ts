/**
 * Numeric honesty (2026-09-28, docs/NUMERIC-HONESTY-2026-09-28.md). Five promises:
 *  1. R6: the invoice rounding band is capped at what rounding can produce (U × k, plus half a cash step on the total),
 *     in a new ruleset version (0.1.0); 0.0.1 stays resolvable, and the cap only ever tightens.
 *  2. D-TOL-ID: any option that can change an outcome is committed to by the verdict_id.
 *  3. Could-not-compare is not FAIL: no string/number mismatch ever FAILs (the gavel's = and !=, and a junk tax in the
 *     invoice total).
 *  4. A unit price keeps its precision (0.125 × 1,000 = 125); currency totals keep cent rounding.
 *  5. Replay binds a restated override, and still re-performs a verdict issued before the override was hashed.
 */
import { describe, it, expect } from 'vitest'
import { verify, hashOf, verifyReplay, deriveVerdictId, STRICT, type Verdict } from '../src/index'
import { resolveRuleset, RULESET_VERSIONS, INVOICE_RULESET, INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { CAPPED, PRACTITIONER, cashStepOf, documentGrain, toleranceIdentity, type TolerancePolicy } from '../src/tolerance'
import { normalizeAmount, normalizePrice } from '../src/binding/forensic-normalizer'
import { getValidationGavel } from '../src/kernel/validation-gavel'
import type { DeclarativeRuleset } from '../src/declarative/types'
import { clean, roundingDrift, FIXED_NOW } from './fixtures/invoices'

type J = Record<string, unknown>
const claim = (v: Verdict, id: string) => {
  const c = v.claims.find(x => x.claim_id === id)
  if (!c) throw new Error(`claim ${id} not found`)
  return c
}
const doc = (lines: J[], sub: unknown, total: unknown, extra: J = {}): J =>
  ({ invoice_number: 'NH', line_items: lines, totals: { subtotal: sub, tax_rate: 0, tax: 0, total, ...extra } })
const line = (q: unknown, p: unknown, a: unknown): J => ({ description: 'Item', quantity: q, unit_price: p, amount: a })

/** A deterministic PRNG (mulberry32), so the property sweeps are the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('R6: the invoice rounding band is capped at what rounding can produce (invoice 0.1.0)', () => {
  const r6 = doc([line(1, 10_000_000, 10_002_500)], 10_002_500, 10_002_500)

  it('the red-team PoC: $2,500 on a $10M line FAILs, and the explanation names the cap', () => {
    const v = verify(r6, { now: FIXED_NOW })
    expect(v.ruleset).toEqual({ id: 'invoice', version: '0.1.0', domain: 'invoice' })
    const c = claim(v, 'line[0].MATH_INT')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(2500)
    expect(c.explanation).toContain('above the rounding cap 1 × 3 steps = 3')
    expect(v.outcome).toBe('FAIL')
  })

  it('0.0.1 is retained and resolvable, and still forgives it (so its verdicts replay as issued)', () => {
    expect(resolveRuleset('invoice@0.0.1')).toBe(INVOICE_RULESET_V0_0_1)
    expect(resolveRuleset('invoice@0.1.0')).toBe(INVOICE_RULESET)
    expect(resolveRuleset('invoice')).toBe(INVOICE_RULESET)
    expect(() => resolveRuleset('invoice@9.9.9')).toThrow(/unknown ruleset/)
    expect(RULESET_VERSIONS.map(r => `${r.id}@${r.version}`)).toEqual(['invoice@0.1.0', 'pay-app@0.0.1', 'invoice@0.0.1'])
    const old = verify(r6, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    expect(old.ruleset.version).toBe('0.0.1')
    expect(old.outcome).toBe('PASS')
    expect(INVOICE_RULESET_V0_0_1.defaultTolerance).toEqual(PRACTITIONER)
    expect(INVOICE_RULESET.defaultTolerance).toEqual(CAPPED)
  })

  it('the forgiven amount no longer grows with the document: $200,000 on $1B, and round thousands, FAIL', () => {
    expect(verify(doc([line(1, 1e9, 1_000_200_000)], 1_000_200_000, 1_000_200_000), { now: FIXED_NOW }).outcome).toBe('FAIL')
    // A grain is never read from round numbers (it would be the attacker's to choose): U stays 1, not 1,000.
    expect(verify(doc([line(1, 10_000_000, 10_003_000)], 10_003_000, 10_003_000), { now: FIXED_NOW }).outcome).toBe('FAIL')
  })

  it('a penny is still never an error, and real rounding still passes', () => {
    expect(verify(clean, { now: FIXED_NOW }).outcome).toBe('PASS') // tax 144.42 vs 144.4163: the $0.01 floor
    // A tax rounded line by line: 12 × round(1000.05 × 8.25%) = 990.00 vs 990.0495 on the subtotal. k gains one per line.
    const perLine: J = { invoice_number: 'T', line_items: Array.from({ length: 12 }, () => line(1, 1000.05, 1000.05)), totals: { subtotal: 12000.6, tax_rate: 0.0825, tax: 990, total: 12990.6 } }
    expect(claim(verify(perLine, { now: FIXED_NOW }), 'document.TAX_INT').outcome).toBe('PASS')
    expect(claim(verify(perLine, { now: FIXED_NOW, tolerance: { rel: 0.0003, absCap: 0, roundingCap: {} } }), 'document.TAX_INT').outcome).toBe('FAIL')
  })

  it('a payable total rounded to a cash step (CORD cord-0: 1,591,645 → 1,591,600 IDR) passes; past half a step it FAILs', () => {
    const rupiah = (total: number): J => ({
      invoice_number: 'IDR', currency: 'IDR', line_items: [{ description: 'x', quantity: 1, amount: 1_346_000 }],
      totals: { subtotal: 1_346_000, tax: 144_695, service_charge: 100_950, total },
    })
    const ok = claim(verify(rupiah(1_591_600), { now: FIXED_NOW }), 'document.TOTAL_INT')
    expect(ok.outcome).toBe('PASS')
    expect(ok.explanation).toContain('half a cash step of 100')
    expect(claim(verify(rupiah(1_591_700), { now: FIXED_NOW }), 'document.TOTAL_INT').outcome).toBe('FAIL') // 55 > 4 + 50
    expect(cashStepOf(1_591_600, 1)).toBe(100)
    expect(cashStepOf(1_591_650, 1)).toBe(50)
    expect(cashStepOf(12.35, 0.01)).toBe(0.05)
    expect(cashStepOf(12.34, 0.01)).toBe(0)
  })

  it('the document grain: 1 when every asserted amount is whole, else 0.01', () => {
    expect(documentGrain(verify(doc([line(2, 5, 10)], 10, 10), { now: FIXED_NOW }).claims)).toBe(1)
    expect(documentGrain(verify(clean, { now: FIXED_NOW }).claims)).toBe(0.01)
    expect(documentGrain([])).toBe(0.01)
  })

  it('PROPERTY: the cap only tightens. Every claim that FAILs under 0.0.1 FAILs under 0.1.0 (1,500 seeded invoices)', () => {
    const r = rng(20260928)
    const scale = [1, 100, 10_000, 1_000_000, 100_000_000]
    let tightened = 0
    for (let n = 0; n < 1500; n++) {
      const s = scale[Math.floor(r() * scale.length)]!
      const cents = r() < 0.5
      const money = (x: number): number => (cents ? Math.round(x * 100) / 100 : Math.round(x))
      const lines = Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
        const q = 1 + Math.floor(r() * 9), p = money(r() * s)
        const drift = r() < 0.5 ? 0 : money((r() - 0.5) * s * 0.001)
        return line(q, p, money(q * p + drift))
      })
      const sub = money(lines.reduce((a, l) => a + (l.amount as number), 0) + (r() < 0.7 ? 0 : money((r() - 0.5) * s * 0.001)))
      const x = doc(lines, sub, money(sub + (r() < 0.7 ? 0 : money((r() - 0.5) * s * 0.001))))
      const now = verify(x, { now: FIXED_NOW }), then = verify(x, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
      for (const c of then.claims) {
        const d = claim(now, c.claim_id)
        if (c.outcome === 'FAIL') expect(d.outcome, `${n} ${c.claim_id}`).toBe('FAIL')
        if (c.outcome === 'PASS' && d.outcome === 'FAIL') tightened++
      }
    }
    expect(tightened).toBeGreaterThan(0) // the sweep does reach claims the old band forgave
  })
})

describe('D-TOL-ID: any option that can change an outcome is committed to by the verdict_id', () => {
  const contract: J = { rates: [{ rate: 150 }] }
  const variants: [string, J][] = [
    ['default', {}],
    ['tolerance STRICT', { tolerance: STRICT }],
    ['tolerance 0.05%', { tolerance: { rel: 0.0005, absCap: 0 } }],
    ['tolerance 0.05% capped $1', { tolerance: { rel: 0.0005, absCap: 1 } }],
    ['tolerance CAPPED (the default, stated)', { tolerance: CAPPED }],
    ['tolerance CAPPED without the cash step', { tolerance: { rel: 0.0003, absCap: 0, roundingCap: { perLine: ['TAX_INT'] } } }],
    ['ruleset invoice@0.0.1', { ruleset: INVOICE_RULESET_V0_0_1 }],
    ['ruleset pay-app', { ruleset: 'pay-app' }],
    ['references.contract', { references: { contract } }],
    ['references.evidence', { references: { evidence: [{ description: 'Consulting', quantity: 10 }] } }],
    ['references.history', { references: { history: [{ invoice_number: 'INV-0999' }] } }],
    ['source', { source: { text: 'Invoice INV-RND-1 total 1750.50' } }],
  ]

  it('PROPERTY: every such option gives its own verdict_id (built-in path)', () => {
    const ids = variants.map(([name, o]) => [name, verify(roundingDrift, { ...o, now: FIXED_NOW } as never).verdict_id] as const)
    const seen = new Map<string, string>()
    for (const [name, id] of ids) {
      expect(seen.get(id), `${name} shares its id with ${seen.get(id)}`).toBeUndefined()
      seen.set(id, name)
    }
  })

  it('the options that cannot change an outcome keep the id: producer and the clock', () => {
    const a = verify(roundingDrift, { now: FIXED_NOW })
    expect(verify(roundingDrift, { now: () => new Date('2030-01-01T00:00:00Z'), producer: 'someone' }).verdict_id).toBe(a.verdict_id)
  })

  it('without an override the input identity is unchanged: hashOf({extraction, references, source})', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW })
    expect(v.input_hash).toBe(hashOf({ extraction: roundingDrift, references: { contract: null, evidence: [], history: [] }, source: null }))
    const s = verify(roundingDrift, { now: FIXED_NOW, tolerance: STRICT })
    expect(s.input_hash).toBe(hashOf({ extraction: roundingDrift, references: { contract: null, evidence: [], history: [] }, source: null, tolerance: toleranceIdentity(STRICT) }))
  })

  it('the declarative evaluator commits to a tolerance override (and its rounding mode) the same way', () => {
    const rs: DeclarativeRuleset = { id: 'nh', version: '0.0.1', fields: { A: { paths: ['a'] }, B: { paths: ['b'] } }, checks: [{ code: 'EQ', left: 'A', op: '=', right: 'B' }] } as DeclarativeRuleset
    const x = { a: 100_000, b: 100_020 }
    const plain = verify(x, { ruleset: rs, now: FIXED_NOW }) // the engine's 0.03% default forgives 20 on 100,020
    const strict = verify(x, { ruleset: rs, now: FIXED_NOW, tolerance: { rel: 0, absCap: 0 } })
    const infer = verify(x, { ruleset: rs, now: FIXED_NOW, tolerance: { rel: 0, absCap: 0, rounding: 'infer' } as TolerancePolicy })
    expect(plain.outcome).not.toBe(strict.outcome)
    expect(new Set([plain.verdict_id, strict.verdict_id, infer.verdict_id]).size).toBe(3)
    expect(plain.input_hash).toBe(hashOf({ extraction: x, ruleset: rs }))
  })
})

describe('could-not-compare is not FAIL: no string/number mismatch ever FAILs', () => {
  const JUNK: unknown[] = ['n/a', 'N/A', '—', 'TBD', 'see attached', true, ['1', '2']]
  const FIELDS: [string, (x: J, v: unknown) => void][] = [
    ['line amount', (x, v) => { (x.line_items as J[])[0]!.amount = v }],
    ['unit price', (x, v) => { (x.line_items as J[])[0]!.unit_price = v }],
    ['quantity', (x, v) => { (x.line_items as J[])[0]!.quantity = v }],
    ['subtotal', (x, v) => { (x.totals as J).subtotal = v }],
    ['tax', (x, v) => { (x.totals as J).tax = v }],
    ['tax rate', (x, v) => { (x.totals as J).tax_rate = v }],
    ['total', (x, v) => { (x.totals as J).total = v }],
  ]

  it('PROPERTY: junk in any money field of a correct invoice FAILs nothing; the claims it touches abstain UNPARSEABLE or missing', () => {
    expect(verify(clean, { now: FIXED_NOW }).outcome).toBe('PASS')
    for (const [name, set] of FIELDS) {
      for (const j of JUNK) {
        const x = structuredClone(clean) as J
        set(x, j)
        const v = verify(x, { now: FIXED_NOW })
        const fails = v.claims.filter(c => c.outcome === 'FAIL').map(c => c.claim_id)
        expect(fails, `${name} = ${JSON.stringify(j)}`).toEqual([])
      }
    }
  })

  it('"n/a" against a number is UNPARSEABLE with its reason, not FAIL (the gavel\'s =)', () => {
    const v = verify(doc([line(2, 5, 'n/a')], 10, 10), { now: FIXED_NOW })
    const c = claim(v, 'line[0].MATH_INT')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE' })
    expect(c.insufficiency!.detail).toContain('Type mismatch for = comparison: CLAIMED_AMOUNT is the text "n/a", VERIFIED_AMOUNT is a number')
  })

  it('a junk tax is never read as 0 (0.1.0); 0.0.1 did, and FAILed a correct total (kept for replay)', () => {
    const x = structuredClone(clean) as J
    ;(x.totals as J).tax = 'n/a'
    const now = claim(verify(x, { now: FIXED_NOW }), 'document.TOTAL_INT')
    expect(now.outcome).toBe('INSUFFICIENT_DATA')
    expect(now.insufficiency).toMatchObject({ reason: 'UNPARSEABLE' })
    expect(now.insufficiency!.detail).toContain('TAX_AMOUNT ("n/a") present but not a number')
    expect(claim(verify(x, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }), 'document.TOTAL_INT').outcome).toBe('FAIL')
  })

  it('PROPERTY (the gavel itself): = and != on mixed kinds never pass and always say "Type mismatch"', () => {
    const gavel = getValidationGavel()
    const values: unknown[] = [10, 0, -3.5, 'n/a', '', 'ten', new Date('2026-01-01T00:00:00Z'), true, ['a']]
    const kind = (v: unknown): string => (v instanceof Date ? 'date' : Array.isArray(v) ? 'list' : typeof v)
    for (const op of ['=', '!='] as const) {
      for (const l of values) {
        for (const r of values) {
          if (kind(l) === kind(r)) continue
          const axiom = { id: 'nh', shortCode: 'NH', name: 'NH', requiredRoles: ['CLAIMED_AMOUNT', 'VERIFIED_AMOUNT'], predicates: [{ leftRole: 'CLAIMED_AMOUNT', operator: op, rightRole: 'VERIFIED_AMOUNT' }], combinationLogic: 'AND', detectableBy: 'PRECOMPUTE' }
          const bound = (value: unknown) => ({ value, source: 'invoice', field: 'x', confidence: 100 })
          const res = gavel.validateAxiom(axiom as never, { bindings: { CLAIMED_AMOUNT: bound(l), VERIFIED_AMOUNT: bound(r) } } as never)
          expect(res.predicateResults[0]!.passed, `${JSON.stringify(l)} ${op} ${JSON.stringify(r)}`).toBe(false)
          expect(res.predicateResults[0]!.failureReason).toMatch(/^Type mismatch/)
        }
      }
    }
  })
})

describe('a unit price keeps its precision; currency totals keep the cent', () => {
  it('normalizePrice is exact; normalizeAmount still rounds to the cent', () => {
    expect(normalizePrice(0.125)?.normalized).toBe(0.125)
    expect(normalizePrice('0.125')?.normalized).toBe(0.125)
    expect(normalizePrice('$1,234.5678')?.normalized).toBe(1234.5678)
    expect(normalizePrice('€1.234,56')?.normalized).toBe(1234.56)
    expect(normalizePrice('n/a')?.success).toBe(false)
    expect(normalizeAmount(0.125)?.normalized).toBe(0.13)
    expect(normalizeAmount('0.125')?.normalized).toBe(0.13)
  })

  it('1,000 × 0.125 = 125.00 PASSes (it was a false FAIL), and a wrong 130.00 now FAILs (it was a false PASS)', () => {
    for (const p of [0.125, '0.125']) {
      const ok = claim(verify(doc([line(1000, p, 125)], 125, 125), { now: FIXED_NOW }), 'line[0].MATH_INT')
      expect(ok.outcome).toBe('PASS')
      expect(ok.variance).toBe(0)
    }
    const wrong = claim(verify(doc([line(1000, 0.125, 130)], 130, 130), { now: FIXED_NOW }), 'line[0].MATH_INT')
    expect(wrong.outcome).toBe('FAIL')
    expect(wrong.variance).toBe(5)
  })
})

describe('replay binds a restated override (D-TOL-ID) and still re-performs an override verdict issued before it', () => {
  const inputs = { extraction: roundingDrift, references: { contract: null, evidence: [], history: [] }, source: null }

  it('restated: REPERFORMED; not restated: FAILED, with the hint to restate it', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW, tolerance: STRICT })
    expect(verifyReplay(v, inputs, { tolerance: STRICT }).status).toBe('REPERFORMED')
    const bare = verifyReplay(v, inputs)
    expect(bare.status).toBe('FAILED')
    expect(bare.reason).toMatch(/If it was issued under a rounding-tolerance override, restate it/)
    expect(verifyReplay(v, { ...inputs, tolerance: toleranceIdentity(STRICT) }).status).toBe('REPERFORMED') // carried in the inputs
    expect(verifyReplay(v, inputs, { tolerance: { rel: 0.0005, absCap: 0 } }).status).toBe('FAILED') // not the override it was issued under
  })

  it('a verdict issued before 2026-09-28 (input_hash without the override) still binds and re-performs, identity carried', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW, tolerance: STRICT })
    const oldHash = hashOf(inputs)
    const legacy = { ...v, input_hash: oldHash, verdict_id: deriveVerdictId(oldHash, v.ruleset, v.engine_version) }
    const r = verifyReplay(legacy, inputs, { tolerance: STRICT })
    expect(r.status).toBe('REPERFORMED')
    expect(r.reperformed?.annotations).toEqual(['input_hash', 'verdict_id'])
    const flipped = verifyReplay({ ...legacy, outcome: 'PASS' as const }, inputs, { tolerance: STRICT })
    expect(flipped.status).toBe('FAILED') // the body is still compared
  })

  it('an invoice@0.0.1 verdict re-performs under the retained 0.0.1, not the current version', () => {
    const v = verify(roundingDrift, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    const r = verifyReplay(v, inputs)
    expect(r.status).toBe('REPERFORMED')
    expect(r.reperformed?.engine).toBe('verify:invoice')
  })
})
