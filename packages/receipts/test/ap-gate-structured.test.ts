/**
 * 2026-10-03: the AP gate on structured input (verify's ApStructuredInput, ruleset ap-structured@0.1.0).
 *   - the gate on structured input: EXECUTE on agreement, REVIEW on disagreement or ABSTAIN, typed remedies on a planted mismatch
 *   - a bare "hold" from the model agrees with any hold the check finds
 *   - path parity at the gate: text and structured give the same action, effect and checker decision on all 100 Distil cases
 *   - a structured receipt holds hashes and JSON Pointers, never document text, and a kept proof binds to it
 * Cases are Distil Labs' public AP benchmark (Apache-2.0), vendored in verify/data/real.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { replayBundle, splitApLayout, structuredFromText, type ApStructuredInput } from 'riposte-verify'
import { AP_POLICY, apGate, bindProof, hashesOnlyBody } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = () => new Date('2026-10-03T00:00:00Z')
const CASES = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l) as { id: string; input: string; decision: string })

const base = (): ApStructuredInput => ({
  schema: 'riposte.ap-input/0.1.0',
  bill: {
    invoice_number: 'NM-84665', vendor: { name: 'Northfield Material Handling' }, purchase_order_number: 'PO-48825', currency: 'USD', amount: 2695,
    line_items: [
      { purchase_order_line_item_id: 'pol-1', description: 'CORD EXT 50FT 12AWG', quantity: 5, unit_price: 47.3, amount: 236.5 },
      { purchase_order_line_item_id: 'pol-2', description: 'TAPE FLOOR YEL', quantity: 10, unit_price: 14.25, amount: 142.5 },
      { purchase_order_line_item_id: 'pol-3', description: 'SHELF WIRE 48IN', quantity: 24, unit_price: 96.5, amount: 2316 },
    ],
  },
  purchase_order: {
    purchase_order_number: 'PO-48825', vendor: { name: 'Northfield Material Handling' }, currency: 'USD', freight_allowed: false,
    line_items: [
      { id: 'pol-1', description: 'Extension cord 50 ft, 12 AWG', unit_price: 47.3 },
      { id: 'pol-2', description: 'Floor marking tape, yellow', unit_price: 14.25 },
      { id: 'pol-3', description: 'Wire shelving unit 48 in', unit_price: 96.5 },
    ],
  },
  item_receipts: [{ line_items: [
    { purchase_order_line_item_id: 'pol-1', quantity: 5 }, { purchase_order_line_item_id: 'pol-2', quantity: 10 }, { purchase_order_line_item_id: 'pol-3', quantity: 24 },
  ] }],
  // engine 0.6.0: history known and empty, so the duplicate check runs and passes (without it, an approve reads PASS-WITH-OPEN)
  payment_history: [],
})
/** The tape billed 2.5% over the PO price (the total adds up): the check says hold_price. */
const overPriced = (): ApStructuredInput => { const x = base(); x.bill.line_items[1]!.unit_price = 14.61; x.bill.line_items[1]!.amount = 146.1; x.bill.amount = 2698.6; return x }

describe('the gate on structured input', () => {
  it('agreement executes; disagreement and can\'t-tell go to a person', () => {
    expect(apGate('approve', base(), { now: NOW })).toMatchObject({ action: 'EXECUTE', effect: 'PAY', checker_decision: 'approve' })
    expect(apGate('hold_price', overPriced(), { now: NOW })).toMatchObject({ action: 'EXECUTE', effect: 'HOLD', checker_decision: 'hold_price' })
    expect(apGate('approve', overPriced(), { now: NOW })).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW', checker_decision: 'hold_price' })
    const eur = base(); eur.bill.currency = 'EUR'
    expect(apGate('approve', eur, { now: NOW })).toMatchObject({ action: 'REVIEW', checker_decision: 'abstain' })
  })
  it('a planted mismatch carries the typed remedies that would clear it', () => {
    const g = apGate('approve', overPriced(), { now: NOW })
    const kinds = g.remedies!.map((r) => `${r.kind}:${r.authority ?? r.operand?.source ?? ''}`)
    expect(kinds).toContain('authority:buyer')
    expect(kinds).toContain('missing-operand:purchase_order')
    expect(g.remedies!.every((r) => r.clears.includes('AP_PRICE_PO'))).toBe(true)
    expect(g.check.grounding).toMatchObject({ item: 'Floor marking tape, yellow', invoiced: 14.61, expected: 14.25 })
  })
  it('a bare "hold" agrees with any hold the check finds, and never with a payment', () => {
    expect(apGate('hold', overPriced(), { now: NOW })).toMatchObject({ action: 'EXECUTE', effect: 'HOLD', model_decision: 'hold', checker_decision: 'hold_price' })
    expect(apGate('hold', base(), { now: NOW })).toMatchObject({ action: 'REVIEW', checker_decision: 'approve' })
    const short = base(); short.item_receipts[0]!.line_items[2]!.quantity = 20
    expect(apGate('hold', short, { now: NOW })).toMatchObject({ action: 'EXECUTE', effect: 'HOLD', checker_decision: 'hold_quantity' })
  })
  it('a structured input that carries its own decision is gated on its documents only (the decision is not in the verdict)', () => {
    const x = base(); x.decision = { action: 'pay', confidence: 0.97, model: 'any-model' }
    expect(apGate('approve', x, { now: NOW }).check.verdict.verdict_id).toBe(apGate('approve', base(), { now: NOW }).check.verdict.verdict_id)
  })
})

describe('path parity at the gate: text and structured, all 100 Distil cases', () => {
  it('the same action, effect and checker decision, for the gold decision and for a blanket "approve"', () => {
    let n = 0
    for (const c of CASES) {
      const d = splitApLayout(c.input)!
      const s = structuredFromText(d)
      expect(s.ok, c.id).toBe(true)
      if (!s.ok) continue
      for (const decision of [c.decision, 'approve', 'hold']) {
        const t = apGate(decision, d, { now: NOW })
        const u = apGate(decision, s.input, { now: NOW })
        expect({ a: u.action, e: u.effect, c: u.checker_decision, g: u.check.grounding }, `${c.id} ${decision}`).toEqual({ a: t.action, e: t.effect, c: t.checker_decision, g: t.check.grounding })
        n++
      }
    }
    expect(n).toBe(300)
  })
})

describe('receipts for structured input: hashes and pointers, never text', () => {
  it('the hashes-only body names no value from the documents, and the kept proof binds and replays', () => {
    const x = overPriced()
    const g = apGate('approve', x, { now: NOW })
    const body = hashesOnlyBody(g, x, 'key-1')
    const text = JSON.stringify(body)
    for (const v of ['NM-84665', 'PO-48825', 'Northfield', 'TAPE FLOOR', 'Floor marking', '14.61', '2698.6']) expect(text, v).not.toContain(v)
    expect(Object.keys(body.documents as object).sort()).toEqual(['bill', 'item_receipts', 'purchase_order'])
    const claims = body.claims as { claim_id: string; pointers?: string[] }[]
    expect(claims.find((c) => c.claim_id === 'ap.line[2].price')!.pointers).toEqual(['/bill/line_items/1/unit_price', '/purchase_order/line_items/1/unit_price'])
    const proof = { verdict: g.check.verdict, inputs: { ap_structured: x, policy: AP_POLICY } }
    expect(bindProof(body, proof)).toEqual({ ok: true })
    expect(replayBundle(proof)).toMatchObject({ result: 'MATCH', answer: 'FAIL' })
    const forged = structuredClone(proof)
    forged.inputs.ap_structured.bill.line_items[1]!.unit_price = 14.25
    expect(bindProof(body, forged)).toMatchObject({ ok: false, field: 'documents.bill.sha256' })
    const missing = { verdict: g.check.verdict, inputs: { policy: AP_POLICY } }
    expect(bindProof(body, missing)).toMatchObject({ ok: false, field: 'documents.bill' })
  })
  it('a text receipt is unchanged: no pointers, the three text documents', () => {
    const d = splitApLayout(CASES[0]!.input)!
    const g = apGate('approve', d, { now: NOW })
    const body = hashesOnlyBody(g, d)
    expect(Object.keys(body.documents as object).sort()).toEqual(['goods_receipt', 'invoice', 'purchase_order'])
    expect((body.claims as { pointers?: unknown }[]).some((c) => c.pointers !== undefined)).toBe(false)
    // the text proof still binds (a text receipt also names a purchase_order: binding must not read it as structured)
    expect(bindProof(body, { verdict: g.check.verdict, inputs: { ap: d, policy: AP_POLICY } })).toEqual({ ok: true })
  })
})
