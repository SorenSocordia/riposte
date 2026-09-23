import { describe, it, expect } from 'vitest'
import { generateSigningKeypair } from 'riposte-verify'
import {
  orderSchedule, flipProbe, gate, guard, buildReceipt, signReceipt, verifyReceipt,
  type SystemOneRequest, type SystemOneResponse, type Transport, type ChoiceQuestion,
} from '../src/index.js'

const NOW = () => new Date('2026-09-23T00:00:00Z')

const req: SystemOneRequest = {
  state: 'Invoice INV-1001 from Acme: 10 widgets at $12.50 and 3 gadgets at $40. Matches PO-77.',
  model: 'test-model',
  questions: {
    decision: { type: 'choice', instructions: 'What should AP do with this invoice?', criteria: { pay: 'Approve for payment', hold: 'Hold for review', return: 'Return to vendor' } },
    urgent: { type: 'noul', instructions: 'Is this urgent?' },
  },
}

/** A model that always picks whichever option is LISTED FIRST — pure position bias. */
const positionBiased: Transport = async (r) => {
  const answers: SystemOneResponse['answers'] = {}
  for (const [name, q] of Object.entries(r.questions)) {
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria)
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / (keys.length - 1)]))
      answers[name] = { type: 'choice', choice: keys[0] as string, probabilities }
    } else if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.2 }
  }
  return { model: 'position-biased', answers }
}

/** A model that decides on CONTENT: always 'pay', whatever the order. */
const contentModel = (choice = 'pay', p = 0.95): Transport => async (r) => {
  const answers: SystemOneResponse['answers'] = {}
  for (const [name, q] of Object.entries(r.questions)) {
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria)
      const probabilities = Object.fromEntries(keys.map((k) => [k, k === choice ? p : (1 - p) / (keys.length - 1)]))
      answers[name] = { type: 'choice', choice, probabilities }
    } else if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.1 }
  }
  return { model: 'content', answers }
}

const goodInvoice = {
  invoice_number: 'INV-1001', invoice_date: '2026-09-01', due_date: '2026-10-01', currency: 'USD',
  line_items: [
    { description: 'Widget', quantity: 10, unit_price: 12.5, amount: 125.0 },
    { description: 'Gadget', quantity: 3, unit_price: 40.0, amount: 120.0 },
  ],
  subtotal: 245.0, tax_rate: 0.08, tax: 19.6, total: 264.6,
}
const badInvoice = { ...goodInvoice, line_items: [goodInvoice.line_items[0], { ...goodInvoice.line_items[1], amount: 130.0 }], subtotal: 255.0, tax: 20.4, total: 280.4 }

describe('orderSchedule', () => {
  it('is deterministic, identity first, reversal second', () => {
    const a = orderSchedule(['a', 'b', 'c', 'd'], 6, 'seed')
    const b = orderSchedule(['a', 'b', 'c', 'd'], 6, 'seed')
    expect(a).toEqual(b)
    expect(a[0]).toEqual(['a', 'b', 'c', 'd'])
    expect(a[1]).toEqual(['d', 'c', 'b', 'a'])
    expect(a).toHaveLength(6)
    expect(new Set(a.map((o) => o.join())).size).toBe(6)
  })
  it('never invents duplicate orders when the option count cannot support them', () => {
    expect(orderSchedule(['x', 'y'], 6, 's')).toEqual([['x', 'y'], ['y', 'x']])
  })
  it('a different seed gives a different (still valid) schedule', () => {
    const a = orderSchedule(['a', 'b', 'c', 'd', 'e'], 6, 's1')
    const b = orderSchedule(['a', 'b', 'c', 'd', 'e'], 6, 's2')
    expect(a.slice(2)).not.toEqual(b.slice(2))
    for (const o of b) expect([...o].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('flipProbe', () => {
  it('catches a position-biased model: the decision follows the layout, not the input', async () => {
    const f = await flipProbe(positionBiased, req, { orders: 6 })
    expect(f.decision!.stable).toBe(false)
    expect(f.decision!.flipRate).toBeGreaterThan(0.5)
    expect(f.decision!.maxProbSwing).toBeGreaterThan(0.7)
    expect(f.decision!.options).toBe(3)
    expect(f.decision!.orders).toHaveLength(6) // 3 options -> all 6 permutations
  })
  it('clears a content-driven model', async () => {
    const f = await flipProbe(contentModel(), req, { orders: 6 })
    expect(f.decision!.stable).toBe(true)
    expect(f.decision!.flipRate).toBe(0)
    expect(f.decision!.modal).toBe('pay')
  })
  it('actually sends the reordered options (the probe is not a no-op)', async () => {
    const seen: string[][] = []
    const spy: Transport = async (r) => { seen.push(Object.keys((r.questions.decision as ChoiceQuestion).criteria)); return contentModel()(r) }
    await flipProbe(spy, req, { orders: 4 })
    expect(new Set(seen.map((s) => s.join())).size).toBe(4)
  })
})

describe('gate', () => {
  const pay = { question: 'decision', allow: ['pay'] }
  it('PROCEED: checks pass, decision confident and allowed', async () => {
    const res = await contentModel()(req)
    const g = gate(req, res, pay, { extraction: goodInvoice, options: { now: NOW } })
    expect(g.verdict!.outcome).toBe('PASS')
    expect(g.outcome).toBe('PROCEED')
  })
  it('HOLD: the model says pay, but the arithmetic does not foot', async () => {
    const res = await contentModel()(req)
    const g = gate(req, res, pay, { extraction: badInvoice, options: { now: NOW } })
    expect(g.outcome).toBe('HOLD')
    expect(g.reasons.join('\n')).toMatch(/check FAILED/)
  })
  it('HOLD: the model decided against the action', async () => {
    const g = gate(req, await contentModel('hold')(req), pay)
    expect(g.outcome).toBe('HOLD')
    expect(g.decided).toBe('hold')
  })
  it('ABSTAIN: not confident enough to act', async () => {
    const g = gate(req, await contentModel('pay', 0.55)(req), pay)
    expect(g.outcome).toBe('ABSTAIN')
    expect(g.reasons.join('\n')).toMatch(/confidence 0\.550 < 0\.8/)
  })
  it('ABSTAIN: confident, but the decision flips when only the option order changes', async () => {
    const f = await flipProbe(positionBiased, req)
    const res = await positionBiased(req) // identity order puts 'pay' first -> 'pay' @ 0.9
    const g = gate(req, res, pay, undefined, f)
    expect(g.decided).toBe('pay')
    expect(g.outcome).toBe('ABSTAIN')
    expect(g.reasons.join('\n')).toMatch(/flips under option reordering/)
  })
  it('HOLD dominates ABSTAIN: a demonstrated failure outranks a missing fact', async () => {
    const g = gate(req, await contentModel('pay', 0.55)(req), pay, { extraction: badInvoice, options: { now: NOW } })
    expect(g.outcome).toBe('HOLD')
  })
})

describe('receipts', () => {
  const { privateKeyPem } = generateSigningKeypair()

  it('receipt_id is deterministic across issue times (replayable), and binds option order', async () => {
    const res = await contentModel()(req)
    const g = gate(req, res, { question: 'decision', allow: ['pay'] })
    const r1 = buildReceipt({ request: req, response: res, gate: g, now: NOW })
    const r2 = buildReceipt({ request: req, response: res, gate: g, now: () => new Date('2027-01-01T00:00:00Z') })
    expect(r1.receipt_id).toBe(r2.receipt_id)
    expect(r1.option_orders.decision).toEqual(['pay', 'hold', 'return'])
    const reordered: SystemOneRequest = { ...req, questions: { ...req.questions, decision: { ...(req.questions.decision as ChoiceQuestion), criteria: { hold: 'Hold for review', pay: 'Approve for payment', return: 'Return to vendor' } } } }
    const r3 = buildReceipt({ request: reordered, response: res, gate: g, now: NOW })
    expect(r3.receipt_id).not.toBe(r1.receipt_id)
  })

  it('signed receipt verifies with only its public key; tampering with the outcome breaks it', async () => {
    const { signed } = await guard(contentModel(), req, { question: 'decision', allow: ['pay'] }, { checks: { extraction: badInvoice, options: { now: NOW } }, flip: true, signingKey: privateKeyPem, now: NOW })
    expect(signed!.receipt.gate.outcome).toBe('HOLD')
    expect(signed!.receipt.checks!.outcome).toBe('FAIL')
    expect(verifyReceipt(signed!, req).ok).toBe(true)

    const forged = structuredClone(signed!)
    forged.receipt.gate.outcome = 'PROCEED'
    const c = verifyReceipt(forged)
    expect(c.ok).toBe(false)
    expect(c.signature_ok).toBe(false)
  })

  it('a receipt presented against a different request is rejected', async () => {
    const { signed } = await guard(contentModel(), req, { question: 'decision', allow: ['pay'] }, { signingKey: privateKeyPem, now: NOW })
    const other: SystemOneRequest = { ...req, state: 'a different invoice' }
    const c = verifyReceipt(signed!, other)
    expect(c.request_ok).toBe(false)
    expect(c.ok).toBe(false)
  })

  it('a re-signed but internally inconsistent receipt is caught by the id check', async () => {
    const { signed } = await guard(contentModel(), req, { question: 'decision', allow: ['pay'] }, { signingKey: privateKeyPem, now: NOW })
    const edited = structuredClone(signed!.receipt)
    edited.gate.outcome = 'PROCEED'
    edited.gate.reasons = ['edited after the fact']
    const resigned = signReceipt(edited, privateKeyPem) // attacker holds the key but forgot the id binding
    const c = verifyReceipt(resigned)
    expect(c.signature_ok).toBe(true)
    expect(c.id_ok).toBe(false)
    expect(c.ok).toBe(false)
  })

  it('guard: position-biased model is flip-probed and abstained, with the evidence in the receipt', async () => {
    const { gate: g, receipt } = await guard(positionBiased, req, { question: 'decision', allow: ['pay'] }, { flip: true, now: NOW })
    expect(g.outcome).toBe('ABSTAIN')
    expect(receipt.flip!.decision!.stable).toBe(false)
    expect(receipt.flip!.decision!.seed_orders).toHaveLength(6)
  })
})
