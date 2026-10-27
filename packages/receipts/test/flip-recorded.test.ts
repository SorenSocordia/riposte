/**
 * 2026-10-03: the flip probe replayed from recordings (recordedTransport). A decision recorded under several option
 * orders is probed offline; an order nobody recorded is refused, never invented; one recorded order cannot measure anything.
 */
import { describe, it, expect } from 'vitest'
import { flipProbe, orderSchedule, recordedTransport, NotRecorded, type ChoiceAnswer, type RecordedChoice, type SystemOneRequest } from '../src/index.js'

const LABELS = ['approve', 'hold_no_po', 'hold_quantity', 'hold_price', 'hold_total']
const req = (state: string): SystemOneRequest => ({
  state,
  questions: { decision: { type: 'choice', instructions: 'Pay or hold under the four-check policy.', criteria: Object.fromEntries(LABELS.map((l) => [l, null])) } },
})
const answer = (choice: string): ChoiceAnswer => ({ type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(LABELS.map((l) => [l, l === choice ? 0.9 : 0.025])) })
/** Recordings for every order the probe's default schedule will send, answering `pick(round)`. */
const recordAll = (state: string, pick: (round: number) => string): RecordedChoice[] =>
  orderSchedule(LABELS, 6, 'receipts/flip/v1\u0000decision').map((order, r) => ({ question: 'decision', order, answer: answer(pick(r)), state }))

describe('recorded transport: the flip probe without a model', () => {
  it('a decision that holds under every recorded order is stable', async () => {
    const out = await flipProbe(recordedTransport(recordAll('T001', () => 'hold_quantity')), req('T001'))
    expect(out.decision).toMatchObject({ stable: true, flipRate: 0, identityChoice: 'hold_quantity', modal: 'hold_quantity' })
    expect(out.decision!.orders).toHaveLength(6)
  })
  it('a decision that moves when only the option order moves is unstable, with its flip rate', async () => {
    const out = await flipProbe(recordedTransport(recordAll('T002', (r) => (r === 3 ? 'approve' : 'hold_total'))), req('T002'))
    expect(out.decision).toMatchObject({ stable: false, identityChoice: 'hold_total', modal: 'hold_total' })
    expect(out.decision!.flipRate).toBeCloseTo(1 / 5)
  })
  it('an order nobody recorded is refused, never invented; recordings for another state do not count', async () => {
    const identityOnly: RecordedChoice[] = [{ question: 'decision', order: LABELS, answer: answer('approve'), state: 'T003' }]
    await expect(flipProbe(recordedTransport(identityOnly), req('T003'))).rejects.toBeInstanceOf(NotRecorded)
    await expect(flipProbe(recordedTransport(recordAll('T004', () => 'approve')), req('T005'))).rejects.toThrow(/no recorded answer for "decision"/)
  })
})
