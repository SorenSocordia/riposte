/**
 * AP line recompute (ruleset ap-threeway 0.2.0, src/ap/line-math.ts). The rule was pre-registered before any benchmark run
 * under it (docs/AP-LINE-MATH-2026-09-29.md): P = quantity × unit price exactly; PASS iff |amount − P| ≤ one minor unit.
 * Pinned here: every correctly rounded amount passes (any rounding mode, 2–4-decimal unit prices, fractional quantities,
 * 0/2/3-digit currencies); every planted error of two minor units or more FAILs with the right variance; a line with an
 * adjustment the product does not model abstains; the decision holds a planted line error that 0.1.0 approved.
 */
import { describe, it, expect } from 'vitest'
import { verifyInvoiceMatch, type ApDocuments } from '../src/ap/index'
import { recomputeLine, minorUnitDigits, adjustmentMarker } from '../src/ap/line-math'

const NOW = () => new Date('2026-09-29T00:00:00Z')
const V010 = 'ap-threeway@0.1.0'

/** Seeded PRNG (mulberry32), so every property run is the same run. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))

/** An independent exact rounding of m × 10^-e to 2 decimals (in cents), by mode: the reference the rule is tested against. */
type Mode = 'half-up' | 'half-even' | 'half-down' | 'trunc' | 'ceil'
function roundCents(m: bigint, e: number, mode: Mode): bigint {
  if (e <= 2) return m * 10n ** BigInt(2 - e)
  const div = 10n ** BigInt(e - 2)
  const q = m / div, r = m % div // m ≥ 0 here
  if (r === 0n) return q
  if (mode === 'trunc') return q
  if (mode === 'ceil') return q + 1n
  const twice = r * 2n
  if (twice > div) return q + 1n
  if (twice < div) return q
  return mode === 'half-up' ? q + 1n : mode === 'half-down' ? q : q % 2n === 0n ? q : q + 1n
}
const cents = (c: bigint): number => Number(c) / 100
/** A random decimal with `dp` places in [lo, hi): its text, and m, e. */
function dec(r: () => number, lo: number, hi: number, dp: number): { text: string; m: bigint; e: number; value: number } {
  const m = BigInt(Math.floor((lo + r() * (hi - lo)) * 10 ** dp))
  const s = m.toString().padStart(dp + 1, '0')
  const text = dp ? `${s.slice(0, s.length - dp)}.${s.slice(s.length - dp)}` : s
  return { text, m, e: dp, value: Number(text) }
}

describe('the rule: |amount − quantity × unit price| ≤ one minor unit, in exact arithmetic', () => {
  it('an exact line passes; the brief\'s "10 × 12.00 = 150.00" fails with variance 30 and the recomputed 120', () => {
    expect(recomputeLine({ quantity: 10, unit_price: 12, amount: 120, minor_digits: 2 })).toMatchObject({ ok: true, outcome: 'PASS', recomputed: 120, variance: 0 })
    expect(recomputeLine({ quantity: 10, unit_price: 12, amount: 150, minor_digits: 2 })).toMatchObject({ ok: true, outcome: 'FAIL', recomputed: 120, recomputed_text: '120.00', variance: 30, variance_text: '30.00' })
  })
  it('unit prices with 3–4 decimals: half-up, banker\'s and truncated amounts pass; two cents off fails', () => {
    // 3 × 12.3456 = 37.0368
    for (const a of [37.04, 37.03]) expect(recomputeLine({ quantity: 3, unit_price: 12.3456, amount: a, minor_digits: 2 })).toMatchObject({ outcome: 'PASS', exact_product: '37.0368' })
    expect(recomputeLine({ quantity: 3, unit_price: 12.3456, amount: 37.06, minor_digits: 2 })).toMatchObject({ outcome: 'FAIL', recomputed: 37.04, variance: 0.02 })
    // ties, where floating point misleads: 1 × 2.345 and 1 × 0.125 round to either neighbour depending on the mode
    for (const [u, lo, hi] of [[2.345, 2.34, 2.35], [0.125, 0.12, 0.13], [1.005, 1, 1.01]] as const) {
      for (const a of [lo, hi]) expect(recomputeLine({ quantity: 1, unit_price: u, amount: a, minor_digits: 2 })).toMatchObject({ outcome: 'PASS' })
    }
  })
  it('fractional quantities are exact: 2.5 × 12.99 = 32.475; 0.333 × 3.00 = 0.999', () => {
    for (const a of [32.48, 32.47]) expect(recomputeLine({ quantity: 2.5, unit_price: 12.99, amount: a, minor_digits: 2 })).toMatchObject({ outcome: 'PASS', exact_product: '32.475' })
    expect(recomputeLine({ quantity: 0.333, unit_price: 3, amount: 1, minor_digits: 2 })).toMatchObject({ outcome: 'PASS', exact_product: '0.999' })
    expect(recomputeLine({ quantity: 2.5, unit_price: 12.99, amount: 32.5, minor_digits: 2 })).toMatchObject({ outcome: 'FAIL', variance: 0.02 })
  })
  it('the minor unit follows the currency: 1 yen, 1 fils (0.001 KWD), 1 cent; never inferred from round numbers', () => {
    expect([minorUnitDigits('USD'), minorUnitDigits('JPY'), minorUnitDigits('KWD'), minorUnitDigits('jpy'), minorUnitDigits(null), minorUnitDigits('XYZ')]).toEqual([2, 0, 3, 0, 2, 2])
    expect(recomputeLine({ quantity: 3, unit_price: 1234.5, amount: 3704, minor_digits: 0 })).toMatchObject({ outcome: 'PASS', tolerance: 1, recomputed: 3704 })
    expect(recomputeLine({ quantity: 3, unit_price: 1234.5, amount: 3700, minor_digits: 0 })).toMatchObject({ outcome: 'FAIL', variance: -4 })
    expect(recomputeLine({ quantity: 7, unit_price: 1.2345, amount: 8.641, minor_digits: 3 })).toMatchObject({ outcome: 'PASS', tolerance: 0.001 })
    expect(recomputeLine({ quantity: 7, unit_price: 1.2345, amount: 8.65, minor_digits: 3 })).toMatchObject({ outcome: 'FAIL', recomputed: 8.642, variance: 0.008 })
    // whole-dollar amounts in a two-digit currency are still held to the cent: a round number is not a rounded one
    expect(recomputeLine({ quantity: 3, unit_price: 12.35, amount: 37, minor_digits: 2 })).toMatchObject({ outcome: 'FAIL' })
  })
  it('one minor unit is inclusive (a penny is never a hold); two are not', () => {
    expect(recomputeLine({ quantity: 10, unit_price: 12, amount: 120.01, minor_digits: 2 })).toMatchObject({ outcome: 'PASS' })
    expect(recomputeLine({ quantity: 10, unit_price: 12, amount: 119.99, minor_digits: 2 })).toMatchObject({ outcome: 'PASS' })
    expect(recomputeLine({ quantity: 10, unit_price: 12, amount: 120.02, minor_digits: 2 })).toMatchObject({ outcome: 'FAIL', variance: 0.02 })
  })
  it('a missing operand is FIELD_MISSING, an untrustworthy one UNPARSEABLE: never a guessed FAIL', () => {
    expect(recomputeLine({ quantity: null, unit_price: 12, amount: 120, minor_digits: 2 })).toMatchObject({ ok: false, reason: 'FIELD_MISSING', detail: expect.stringMatching(/no quantity/) })
    expect(recomputeLine({ quantity: 10, unit_price: undefined, amount: 120, minor_digits: 2 })).toMatchObject({ ok: false, reason: 'FIELD_MISSING', detail: expect.stringMatching(/no unit price/) })
    for (const bad of [NaN, Infinity, 1e21, 0.1 + 0.2]) expect(recomputeLine({ quantity: 10, unit_price: bad, amount: 120, minor_digits: 2 })).toMatchObject({ ok: false, reason: 'UNPARSEABLE' })
  })
  it('adjustment markers: percent, discount/fee/tax words, signed amounts; not bullets, identifiers or "disc" in a name', () => {
    expect(adjustmentMarker('Tape | 10 | 14.25 | 10% off | 128.25')).toBe('%')
    expect(adjustmentMarker('Tape | 10 | 14.25 | Discount | 128.25')).toBe('Discount')
    expect(adjustmentMarker('Tape | 10 | 14.25 | -14.25 | 128.25')).toBe('-14.25')
    expect(adjustmentMarker('Tape | 10 | 14.25 | (USD 14.25) | 128.25')).toBe('(USD 14.25)')
    expect(adjustmentMarker('Tape | 10 | 14.25 | incl. VAT | 171.00')).toBe('VAT')
    expect(adjustmentMarker('- 10 x GREASE CART 14OZ @ USD 7.45 = USD 74.50')).toBeNull()
    expect(adjustmentMarker('CUST PO: PO-49051 | SKU AJ-97466 | 3 | 1.00 | 3.00')).toBeNull()
    expect(adjustmentMarker('Sanding disc 5 in | 10 | 1.20 | 12.00')).toBeNull()
    expect(adjustmentMarker('Stainless hinge | 10 | 1.20 | 12.00')).toBeNull()
  })
})

describe('properties (seeded)', () => {
  it('never FAILs a correctly rounded amount: 20,000 lines, 2–4-decimal unit prices, whole and fractional quantities, five rounding modes', () => {
    const r = prng(0x11a1)
    const modes: Mode[] = ['half-up', 'half-even', 'half-down', 'trunc', 'ceil']
    let n = 0
    for (let i = 0; i < 20_000; i++) {
      const q = r() < 0.5 ? dec(r, 1, 5000, 0) : dec(r, 0.001, 900, int(r, 1, 3))
      const u = dec(r, 0.05, 9999, int(r, 2, 4))
      const mode = modes[i % modes.length]!
      const a = cents(roundCents(q.m * u.m, q.e + u.e, mode))
      const m = recomputeLine({ quantity: q.value, unit_price: u.value, amount: a, minor_digits: 2 })
      if (!m.ok || m.outcome !== 'PASS') throw new Error(`false FAIL: ${q.text} × ${u.text} → ${a} (${mode}): ${JSON.stringify(m)}`)
      n++
    }
    expect(n).toBe(20_000)
  })
  it('always FAILs a planted error of two minor units or more, with variance = the planted amount', () => {
    const r = prng(0x11a2)
    for (let i = 0; i < 20_000; i++) {
      const q = r() < 0.5 ? dec(r, 1, 5000, 0) : dec(r, 0.001, 900, int(r, 1, 3))
      const u = dec(r, 0.05, 9999, int(r, 2, 4))
      const base = roundCents(q.m * u.m, q.e + u.e, 'half-up')
      const k = BigInt((r() < 0.5 ? -1 : 1) * int(r, 2, 1_000_000))
      if (base + k < 0n) continue
      const m = recomputeLine({ quantity: q.value, unit_price: u.value, amount: cents(base + k), minor_digits: 2 })
      if (!m.ok || m.outcome !== 'FAIL' || m.variance !== cents(k)) throw new Error(`missed: ${q.text} × ${u.text}, planted ${cents(k)}: ${JSON.stringify(m)}`)
    }
  })
})

// ---------------------------------------------------------------- the decision, on the benchmark's document layout
const PO = `PURCHASE ORDER (ERP)
PO-48825 | Vendor: Northfield Material Handling | Freight: not allowed
1. Extension cord 50 ft, 12 AWG | qty 5 | unit USD 47.30
2. Floor marking tape, yellow | qty 10 | unit USD 14.25
3. Wire shelving unit 48 in | qty 24 | unit USD 96.50
`
const GR = `GOODS RECEIPT (ERP) for PO-48825
1. Extension cord 50 ft, 12 AWG | received 5
2. Floor marking tape, yellow | received 10
3. Wire shelving unit 48 in | received 24
`
// 2026-10-05: the invoice is signed by its vendor. Under engine 0.6.0 the text path checks that the invoice
// names the PO's vendor (src/ap/vendor.ts); an invoice that names no one goes to a person, so these fixtures, written to test other
// checks, now carry the vendor's name on a closing line (no number on it, so no line, total or amount reads differently).
const inv = (tape = '10 | 14.25 | 142.50', total = '2,695.00'): string => `INVOICE MESSAGE
INVOICE NM-84665   DATE 2026-09-28
CUST PO: PO-48825
1   CORD EXT 50FT 12AWG | 5 | 47.30 | 236.50
2   Floor marking tape, yellow | ${tape}
3   48 inch wire shelving unit | 24 | 96.50 | 2,316.00
TOTAL DUE USD | ${total}
PREVIOUS BALANCE ON YOUR ACCOUNT: USD 1,290.00 (NOT PART OF THIS INVOICE).
Northfield Material Handling
`
// engine 0.6.0: a bill is approved only against a known book; these tests check the line math, so the fixtures
// state the book known and empty (history: [])
const docs = (tape?: string, total?: string, po = PO): ApDocuments => ({ invoice: inv(tape, total), purchase_order: po, goods_receipt: GR, history: [] })
const amount = (d: ApDocuments, L: number, ruleset?: string) => verifyInvoiceMatch(d, { now: NOW, ...(ruleset ? { ruleset } : {}) }).verdict.claims.find((c) => c.claim_id === `ap.line[${L}].amount`)

describe('the decision (0.2.0): hold_line_math, after price, before total', () => {
  it('a clean invoice approves, with an amount claim per line', () => {
    const r = verifyInvoiceMatch(docs(), { now: NOW })
    expect(r.decision).toBe('approve')
    expect(r.reasons).toEqual(['all checks passed; the payment history supplied is empty, so the duplicate check had no booked invoice to compare'])
    expect(r.verdict.claims.filter((c) => /\.amount$/.test(c.claim_id)).map((c) => [c.claim_id, c.outcome])).toEqual([['ap.line[1].amount', 'PASS'], ['ap.line[2].amount', 'PASS'], ['ap.line[3].amount', 'PASS']])
  })
  it('THE REGRESSION: a planted line error whose total adds up was approved by 0.1.0; 0.2.0 holds it, naming the line', () => {
    const d = docs('10 | 14.25 | 172.50', '2,725.00') // 10 × 14.25 = 142.50, billed 172.50; the total adds up the stated lines
    expect(verifyInvoiceMatch(d, { now: NOW, ruleset: V010 }).decision).toBe('approve')
    const r = verifyInvoiceMatch(d, { now: NOW })
    expect(r.decision).toBe('hold_line_math')
    expect(r.payable).toBe(false)
    expect(r.verdict.outcome).toBe('FAIL')
    expect(r.grounding).toEqual({ invoice_number: 'NM-84665', po_number: 'PO-48825', item: 'Floor marking tape, yellow', invoiced: 172.5, expected: 142.5 })
    expect(r.reasons[0]).toMatch(/10 × 14\.25 = 142\.50, but the line says 172\.5 \(over by 30\.00\)/)
    const c = amount(d, 2)!
    expect(c).toMatchObject({ kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: 'FAIL', asserted: 172.5, variance: 30, rule_id: 'AP_LINE_MATH',
      computation: { operands: { quantity: 10, unit_price: 14.25, exact_product: '142.5', currency: 'USD', minor_unit_digits: 2 }, result: 142.5, tolerance: { abs: 0.01 } } })
    expect(c.evidence.map((e) => e.role)).toEqual(['OPERAND', 'OPERAND', 'OPERAND', 'CONTEXT'])
  })
  it('the brief\'s case, "10 × 12.00 = 150.00" with a total of 150.00: 0.1.0 approves, 0.2.0 holds for 30.00', () => {
    const d: ApDocuments = {
      history: [],
      invoice: 'INVOICE MESSAGE\nINVOICE HB-20001 DATE 2026-09-28\nCUST PO: PO-50001\n1   Hex bolt M8 | 10 | 12.00 | 150.00\nTOTAL DUE USD | 150.00\nFastener Supply\n', // signed by its vendor (2026-10-05)
      purchase_order: 'PURCHASE ORDER (ERP)\nPO-50001 | Vendor: Fastener Supply | Freight: not allowed\n1. Hex bolt M8 | qty 10 | unit USD 12.00\n',
      goods_receipt: 'GOODS RECEIPT (ERP) for PO-50001\n1. Hex bolt M8 | received 10\n',
    }
    expect(verifyInvoiceMatch(d, { now: NOW, ruleset: V010 }).decision).toBe('approve')
    const r = verifyInvoiceMatch(d, { now: NOW })
    expect(r.decision).toBe('hold_line_math')
    expect(r.grounding).toMatchObject({ item: 'Hex bolt M8', invoiced: 150, expected: 120 })
    expect(amount(d, 1)!.variance).toBe(30)
  })
  it('order: a price hold comes before the line math, the line math before the total', () => {
    expect(verifyInvoiceMatch(docs('10 | 14.61 | 176.10', '2,728.60'), { now: NOW }).decision).toBe('hold_price') // price over AND line wrong
    expect(verifyInvoiceMatch(docs('10 | 14.25 | 172.50', '2,695.00'), { now: NOW }).decision).toBe('hold_line_math') // line wrong AND total wrong
    expect(verifyInvoiceMatch(docs(undefined, '2,705.00'), { now: NOW }).decision).toBe('hold_total') // lines right, total wrong
  })
  it('clean rounding passes end to end: a 4-decimal unit price with a truncated amount', () => {
    const po4 = PO.replace('unit USD 14.25', 'unit USD 14.2537')
    const d = docs('10 | 14.2537 | 142.53', '2,695.03', po4) // 142.537 truncated
    const r = verifyInvoiceMatch(d, { now: NOW })
    expect(amount(d, 2)).toMatchObject({ outcome: 'PASS', computation: { operands: { exact_product: '142.537' } } })
    expect(r.decision).toBe('approve')
  })
  it('a discounted line (a signed amount on it) that does not compute abstains, naming the marker: never a guessed FAIL', () => {
    const d = docs('10 | 14.25 | -14.25 | 128.25', '2,680.75')
    expect(verifyInvoiceMatch(d, { now: NOW, ruleset: V010 }).decision).toBe('approve')
    const r = verifyInvoiceMatch(d, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.payable).toBe(false) // engine 0.6.0: every abstain is payable false
    expect(amount(d, 2)).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'AMBIGUOUS_FIELD', detail: expect.stringMatching(/adjustment \("-14\.25"\)/) } })
    expect(r.reasons[0]).toMatch(/^cannot decide ap\.line\[2\]\.amount/)
  })
  it('a line with no quantity or no unit price is not read as a line: the line checks abstain, nothing FAILs', () => {
    for (const tape of ['142.50', '10 | 142.50']) {
      const d = docs(tape)
      const r = verifyInvoiceMatch(d, { now: NOW })
      expect(r.decision).toBe('abstain')
      expect(amount(d, 2)).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'AMBIGUOUS_REFERENCE' } })
      // engine 0.7.0: an amount left unread may be the missing line, so the bill is never read as a partial one
      expect(r.reasons[0]).toMatch(/was not read as a line: cannot tell whether the bill is partial$/)
      expect(r.verdict.claims.some((c) => c.outcome === 'FAIL')).toBe(false)
    }
  })
  it('a fractional quantity on the invoice is not read by the parser (a stated limit): it abstains, never FAILs', () => {
    const d = docs('2.5 | 14.25 | 35.63', '2,588.13')
    const r = verifyInvoiceMatch(d, { now: NOW })
    expect(r.decision).toBe('abstain')
    expect(r.verdict.claims.some((c) => c.outcome === 'FAIL')).toBe(false)
  })
  it('the tolerance is the PO currency\'s minor unit: one yen passes on a JPY order, 0.02 on a USD one fails', () => {
    const jpy: ApDocuments = {
      history: [],
      invoice: 'INVOICE MESSAGE\nINVOICE KT-30001 DATE 2026-09-28\nCUST PO: PO-60001\n1   Masking film roll | 3 | 1,234.50 | 3,704\nTOTAL DUE | 3,704\nKanto Trading\n', // signed by its vendor (2026-10-05)
      purchase_order: 'PURCHASE ORDER (ERP)\nPO-60001 | Vendor: Kanto Trading | Freight: not allowed\n1. Masking film roll | qty 3 | unit JPY 1234.50\n',
      goods_receipt: 'GOODS RECEIPT (ERP) for PO-60001\n1. Masking film roll | received 3\n',
    }
    expect(amount(jpy, 1)).toMatchObject({ outcome: 'PASS', computation: { operands: { currency: 'JPY', minor_unit_digits: 0 }, tolerance: { abs: 1 } } })
    expect(verifyInvoiceMatch(jpy, { now: NOW }).decision).toBe('approve')
    expect(amount(docs('10 | 14.25 | 142.52', '2,695.02'), 2)).toMatchObject({ outcome: 'FAIL', variance: 0.02 })
  })
})

describe('property: clean invoices in the benchmark layout never hold on the line math (seeded, 2,000 invoices)', () => {
  const NAMES = ['Pallet wrap film', 'Nitrile gloves', 'Cable ties', 'Shop towels', 'Duct tape', 'Zip bags', 'Label ribbon', 'Hand soap', 'Floor squeegee', 'Safety glasses', 'Trash liners', 'Packing foam']
  const money = (c: bigint): string => { const s = c.toString().padStart(3, '0'); const i = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return `${i}.${s.slice(-2)}` }
  it('0 line FAILs, 0 hold_line_math; any other hold is 0.1.0\'s own decision on the same invoice', () => {
    const r = prng(0x11a3)
    const modes: Mode[] = ['half-up', 'half-even', 'trunc']
    const tally: Record<string, number> = {}
    let lineFails = 0, lineHolds = 0, inherited = 0
    for (let n = 0; n < 2000; n++) {
      const k = int(r, 1, 6)
      const names = [...NAMES].sort(() => r() - 0.5).slice(0, k)
      let po = `PURCHASE ORDER (ERP)\nPO-7${String(n).padStart(4, '0')} | Vendor: Fuzz Supply Co | Freight: not allowed\n`
      let gr = `GOODS RECEIPT (ERP) for PO-7${String(n).padStart(4, '0')}\n`
      let iv = `INVOICE MESSAGE\nINVOICE FZ-${String(10000 + n)} DATE 2026-09-28\nCUST PO: PO-7${String(n).padStart(4, '0')}\n`
      let sum = 0n
      names.forEach((name, i) => {
        const q = r() < 0.2 ? dec(r, 0.5, 90, int(r, 1, 3)) : dec(r, 1, 500, 0)
        const u = dec(r, 0.05, 2500, int(r, 2, 4))
        const a = roundCents(q.m * u.m, q.e + u.e, modes[int(r, 0, 2)]!)
        sum += a
        po += `${i + 1}. ${name} | qty ${Math.ceil(q.value)} | unit USD ${u.text}\n`
        gr += `${i + 1}. ${name} | received ${Math.ceil(q.value)}\n`
        iv += `${i + 1}   ${name} | ${q.text} | ${u.text} | ${money(a)}\n`
      })
      iv += `TOTAL DUE USD | ${money(sum)}\n`
      iv += `Fuzz Supply Co\n` // signed by its vendor (2026-10-05: the text path checks the invoice names the PO's vendor)
      const d: ApDocuments = { invoice: iv, purchase_order: po, goods_receipt: gr, history: [] }
      const res = verifyInvoiceMatch(d, { now: NOW })
      tally[res.decision] = (tally[res.decision] ?? 0) + 1
      lineFails += res.verdict.claims.filter((c) => /\.amount$/.test(c.claim_id) && c.outcome === 'FAIL').length
      if (res.decision === 'hold_line_math') lineHolds++
      if (res.decision !== 'approve' && res.decision !== 'abstain') {
        expect(verifyInvoiceMatch(d, { now: NOW, ruleset: V010 }).decision, iv).toBe(res.decision)
        inherited++
      }
    }
    expect(lineFails).toBe(0)
    expect(lineHolds).toBe(0)
    // Not vacuous, and deterministic (seeded; measured 2026-09-29): 0 holds of any kind. Every abstention is an invoice with a
    // fractional quantity, which the parser does not read (a stated limit); every whole-quantity invoice approves.
    expect({ tally, inherited }).toEqual({ tally: { approve: 1003, abstain: 997 }, inherited: 0 })
  })

  it('a planted line error whose total adds up is never approved by 0.2.0 (2,000 invoices; 0.1.0 approved the ones it could read)', () => {
    const r = prng(0x11a4)
    const tally: Record<string, number> = {}
    let approvedBefore = 0
    for (let n = 0; n < 2000; n++) {
      const k = int(r, 1, 6)
      const names = [...NAMES].sort(() => r() - 0.5).slice(0, k)
      const bad = int(r, 0, k - 1)
      const kind = n % 4 // 0: off by 2¢–500.00 · 1: one extra unit billed · 2: two digits of the amount swapped · 3: a price 1¢–5% above its own
      let po = `PURCHASE ORDER (ERP)\nPO-8${String(n).padStart(4, '0')} | Vendor: Fuzz Supply Co | Freight: not allowed\n`
      let gr = `GOODS RECEIPT (ERP) for PO-8${String(n).padStart(4, '0')}\n`
      let iv = `INVOICE MESSAGE\nINVOICE FZ-${String(20000 + n)} DATE 2026-09-28\nCUST PO: PO-8${String(n).padStart(4, '0')}\n`
      let sum = 0n
      names.forEach((name, i) => {
        const q = dec(r, 1, 500, 0)
        const u = dec(r, 0.05, 2500, int(r, 2, 4))
        let a = roundCents(q.m * u.m, q.e + u.e, 'half-up')
        if (i === bad) {
          const good = a
          if (kind === 0) a += BigInt((r() < 0.5 ? -1 : 1) * int(r, 2, 50_000))
          else if (kind === 1) a = roundCents((q.m + 1n) * u.m, q.e + u.e, 'half-up')
          else if (kind === 2) { const s = a.toString().split(''); const j = int(r, 0, Math.max(0, s.length - 2)); [s[j], s[j + 1]] = [s[j + 1] ?? s[j]!, s[j]!]; a = BigInt(s.join('')) }
          else a = roundCents(q.m * (u.m + BigInt(int(r, 1, Math.max(1, Number(u.m) / 20)))), q.e + u.e, 'half-up')
          if (a < 0n || (a - good < 2n && good - a < 2n)) a = good + 250n // keep the planted error ≥ 2 minor units
        }
        sum += a
        po += `${i + 1}. ${name} | qty ${q.value} | unit USD ${u.text}\n`
        gr += `${i + 1}. ${name} | received ${q.value}\n`
        iv += `${i + 1}   ${name} | ${q.text} | ${u.text} | ${money(a)}\n`
      })
      iv += `TOTAL DUE USD | ${money(sum)}\n` // the total adds up the stated lines: the case 0.1.0 could not see
      iv += `Fuzz Supply Co\n` // signed by its vendor (2026-10-05: the text path checks the invoice names the PO's vendor)
      const d: ApDocuments = { invoice: iv, purchase_order: po, goods_receipt: gr, history: [] }
      const after = verifyInvoiceMatch(d, { now: NOW }).decision
      if (verifyInvoiceMatch(d, { now: NOW, ruleset: V010 }).decision === 'approve') approvedBefore++
      expect(after, iv).not.toBe('approve')
      tally[after] = (tally[after] ?? 0) + 1
    }
    // Deterministic (seeded; measured 2026-09-29, after the rule was frozen): 0.1.0 approved 1,929 of the 2,000; 0.2.0 holds
    // those 1,929 on the line and abstains on 71 whose error is too large for the parser to read the line (over 25% of it).
    expect({ approvedBefore, tally }).toEqual({ approvedBefore: 1929, tally: { hold_line_math: 1929, abstain: 71 } })
  })
})
