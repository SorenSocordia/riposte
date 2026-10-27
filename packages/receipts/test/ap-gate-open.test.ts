/**
 * 2026-10-03: the AP gate never pays on a PASS that still carries a check that could not run.
 *
 * No real AP input reaches this today: the policy decision abstains on any open check in its order, and the AP rulesets make
 * no claim outside that order (the 100 benchmark invoices are checked in r3-gate-replay-lock.test.ts). So the checker's real
 * result is given one extra open claim here, and the gate's decision on it (apGateOnCheck, what apGate runs) is checked.
 */
import { describe, it, expect } from 'vitest'
import { verifyBillMatch } from 'riposte-verify'
import { apGate, apGateOnCheck } from '../src/index.js'

const input = {
  schema: 'riposte.ap-input/0.1.0' as const,
  bill: { invoice_number: 'OPEN-1', vendor: { name: 'N' }, purchase_order_number: 'PO-1', currency: 'USD', amount: 236.5, line_items: [{ purchase_order_line_item_id: 'pol-1', quantity: 5, unit_price: 47.3, amount: 236.5 }] },
  purchase_order: { purchase_order_number: 'PO-1', currency: 'USD', freight_allowed: false, line_items: [{ id: 'pol-1', unit_price: 47.3 }] },
  item_receipts: [{ line_items: [{ purchase_order_line_item_id: 'pol-1', quantity: 5 }] }],
  // engine 0.6.0: history known and empty, so the duplicate check runs and passes; without it the check is open
  payment_history: [],
}

describe('the AP gate holds on PASS-WITH-OPEN', () => {
  it('the checker approves and every check in its order passed, but one check could not run: REVIEW, never PAY', () => {
    expect(apGate('approve', input)).toMatchObject({ action: 'EXECUTE', effect: 'PAY', status: 'PASS' })
    const real = verifyBillMatch(input)
    const open = { claim_id: 'ap.extra', kind: 'RECOMPUTE' as const, tier: 'DETERMINISTIC' as const, outcome: 'INSUFFICIENT_DATA' as const, field: 'extra', asserted: null, rule_id: 'AP_EXTRA', rule_name: 'an extra check', evidence: [], insufficiency: { reason: 'FIELD_MISSING' as const, detail: 'extra not supplied', missing: ['EXTRA'] }, locked: false, explanation: 'abstained' }
    const check = { ...real, verdict: { ...real.verdict, claims: [...real.verdict.claims, open], coverage: { ...real.verdict.coverage, claims_total: real.verdict.coverage.claims_total + 1, claims_insufficient: real.verdict.coverage.claims_insufficient + 1 } } }
    expect(check.decision).toBe('approve')
    expect(check.verdict.outcome).toBe('PASS') // ANY_FAIL_FAILS: a can't-tell never blocks PASS
    const g = apGateOnCheck('approve', check)
    expect(g).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW', status: 'PASS-WITH-OPEN' })
    expect(g.reason).toBe('PASS-WITH-OPEN: every check that ran passed, but 1 could not run (ap.extra) — not executing the model\'s "approve"')
    // and the same check without the extra claim executes, as apGate does
    expect(apGateOnCheck('approve', real)).toMatchObject({ action: 'EXECUTE', effect: 'PAY' })
  })
})
