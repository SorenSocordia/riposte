/**
 * Cross-document reconciliation — the deterministic N-way match generalized. Proves the coherence-contract layer over a
 * procure-to-pay set (PO ↔ invoice ↔ goods-receipt ↔ payment), abstains on a missing document rather than guessing, and
 * emits a verdict that is replay-verifiable under the same protocol as every other verdict.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcile, verifyReplay, type ReconciliationRuleset, type Verdict } from '../src/index'

const RS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'four-way-match.ruleset.json'), 'utf8'),
) as ReconciliationRuleset
const NOW = () => new Date('2026-09-22T00:00:00Z')
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}; have ${v.claims.map(x => x.claim_id).join(', ')}`); return c }

const coherent = {
  po: { approved_amount: 1000 },
  invoice: { payable_amount: 1000 },
  receipt: { received_amount: 1000 },
  payment: { amount: 1000 },
}

describe('a coherent procure-to-pay set reconciles', () => {
  it('all four documents tie → PASS', () => {
    const v = reconcile(coherent, RS, { now: NOW })
    expect(v.ruleset.id).toBe('procure-to-pay-4way')
    for (const code of ['INV_WITHIN_PO', 'RECEIPT_TIES_INV', 'PAYMENT_TIES_INV']) expect(claim(v, `recon.${code}`).outcome, code).toBe('PASS')
    expect(v.outcome).toBe('PASS')
  })
})

describe('cross-document mismatches are caught on the right contract', () => {
  it('an overpayment → PAYMENT_TIES_INV FAIL with the variance', () => {
    const v = reconcile({ ...coherent, payment: { amount: 1100 } }, RS, { now: NOW })
    const c = claim(v, 'recon.PAYMENT_TIES_INV')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(100)
    expect(v.outcome).toBe('FAIL')
  })
  it('an invoice exceeding the PO → INV_WITHIN_PO FAIL', () => {
    const v = reconcile({ ...coherent, invoice: { payable_amount: 1200 }, receipt: { received_amount: 1200 }, payment: { amount: 1200 } }, RS, { now: NOW })
    expect(claim(v, 'recon.INV_WITHIN_PO').outcome).toBe('FAIL') // 1200 > 1000
  })
  it('per-operand provenance names which document each value came from', () => {
    const v = reconcile({ ...coherent, payment: { amount: 1100 } }, RS, { now: NOW })
    const ev = claim(v, 'recon.PAYMENT_TIES_INV').evidence
    expect(ev.some(e => e.locator.kind === 'field' && e.locator.path.startsWith('payment.'))).toBe(true)
    expect(ev.some(e => e.locator.kind === 'field' && e.locator.path.startsWith('invoice.'))).toBe(true)
  })
})

describe('a missing document abstains, never guesses', () => {
  it('no payment document → PAYMENT_TIES_INV is INSUFFICIENT_DATA (REFERENCE_NOT_PROVIDED), others still evaluate', () => {
    const { po, invoice, receipt } = coherent
    const v = reconcile({ po, invoice, receipt }, RS, { now: NOW })
    const c = claim(v, 'recon.PAYMENT_TIES_INV')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('REFERENCE_NOT_PROVIDED')
    expect(claim(v, 'recon.RECEIPT_TIES_INV').outcome).toBe('PASS') // unaffected
    expect(v.outcome).toBe('PASS') // no FAIL, at least one PASS
  })
})

describe('reconciliation verdicts are replay-verifiable under the protocol', () => {
  it('verifyReplay confirms the binding to the exact documents + ruleset', () => {
    const v = reconcile(coherent, RS, { now: NOW })
    expect(verifyReplay(v).id_ok).toBe(true)
    expect(verifyReplay(v, { documents: coherent, ruleset: RS }).ok).toBe(true)
    // a different document set no longer matches the input_hash
    expect(verifyReplay(v, { documents: { ...coherent, payment: { amount: 999 } }, ruleset: RS }).input_ok).toBe(false)
  })
})
