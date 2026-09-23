/**
 * The one-command live demo — its logic is unit-tested so the thing we demo can't silently rot.
 */
import { describe, it, expect } from 'vitest'
import { runDemo } from '../scripts/demo'

describe('runDemo', () => {
  const r = runDemo()

  it('Beat 1: the fabricated/misquoted citation fails the brief', () => {
    expect(r.legal.outcome).toBe('FAIL')
    expect(r.legal.audit).toMatch(/Citation audit/)
    expect(r.legal.audit).toMatch(/plausible on its face/) // surfaces the opinion's real words
    expect(r.legal.verdict_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('Beat 2: the overpayment is caught cross-document, with provenance', () => {
    expect(r.reconcile.outcome).toBe('FAIL')
    expect(r.reconcile.failedCheck).toBe('PAYMENT_TIES_INV')
    expect(r.reconcile.variance).toBe(1000)
    expect(r.reconcile.provenanceDocs).toContain('payment')
    expect(r.reconcile.provenanceDocs).toContain('invoice')
  })

  it('Beat 3: the proof is verifiable, tamper-evident, and independently replayable', () => {
    expect(r.protocol.signature_ok).toBe(true)
    expect(r.protocol.tamper_caught).toBe(true)
    expect(r.protocol.replay_ok).toBe(true)
    expect(r.protocol.replay_wrong_inputs_rejected).toBe(true)
  })
})
