/**
 * Per-rule calibration — the "which checks does the field distrust?" loop over the ledger. Tests the attribution and
 * flagging logic on synthetic records (deterministic, no engine coupling), plus one integration check on a real verdict.
 */
import { describe, it, expect } from 'vitest'
import { ruleCalibration, renderCalibration } from '../src/ledger/calibration'
import type { LedgerRecord, ReviewDecision } from '../src/ledger/types'
import type { Verdict, Outcome } from '../src/verdict/schema'
import { createLedger, verify } from '../src/index'
import { broken, FIXED_NOW } from './fixtures/invoices'

/** Minimal ledger record carrying only the fields ruleCalibration reads. Cast because the pure fn ignores the rest. */
function rec(claims: Array<{ rule_id: string; rule_name: string; outcome: Outcome }>, decision?: ReviewDecision, domain = 'invoice'): LedgerRecord {
  return {
    verdict: { ruleset: { domain }, claims } as unknown as Verdict,
    tenant_id: 't',
    recorded_at: '2026-01-01T00:00:00Z',
    retention_until: '2033-01-01T00:00:00Z',
    ...(decision ? { review: { reviewer_id: 'r', decided_at: '2026-01-02T00:00:00Z', decision } } : {}),
  } as LedgerRecord
}

const FAIL = (rule_id: string): { rule_id: string; rule_name: string; outcome: Outcome } => ({ rule_id, rule_name: rule_id.toLowerCase(), outcome: 'FAIL' })
const PASS = (rule_id: string): { rule_id: string; rule_name: string; outcome: Outcome } => ({ rule_id, rule_name: rule_id.toLowerCase(), outcome: 'PASS' })

describe('ruleCalibration — attribution', () => {
  it('computes per-rule overturn rate and sorts worst-first', () => {
    const records = [
      rec([FAIL('A')], 'OVERTURNED'),
      rec([FAIL('A')], 'OVERTURNED'),
      rec([FAIL('A')], 'UPHELD'),
      rec([FAIL('B')], 'UPHELD'),
      rec([FAIL('B')], 'UPHELD'),
    ]
    const { rules } = ruleCalibration(records)
    expect(rules.map(r => r.rule_id)).toEqual(['A', 'B']) // A worse → first
    const a = rules.find(r => r.rule_id === 'A')!
    expect(a).toMatchObject({ reviewed: 3, overturned: 2, upheld: 1 })
    expect(a.overturn_rate).toBeCloseTo(2 / 3)
    expect(rules.find(r => r.rule_id === 'B')!.overturn_rate).toBe(0)
  })

  it('counts a rule once per verdict even if it fails on several claims', () => {
    const { rules } = ruleCalibration([rec([FAIL('A'), FAIL('A'), PASS('C')], 'OVERTURNED')])
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ rule_id: 'A', reviewed: 1, overturned: 1 })
  })

  it('ignores unreviewed records and non-FAIL claims', () => {
    const records = [
      rec([FAIL('A')]),                    // recorded, never reviewed → no signal
      rec([PASS('A'), PASS('B')], 'UPHELD'), // reviewed but nothing FAILed → no rule attributed
    ]
    expect(ruleCalibration(records).rules).toHaveLength(0)
  })

  it('keys a rule id by domain (same id in two domains stays separate)', () => {
    const { rules } = ruleCalibration([
      rec([FAIL('TOTAL')], 'OVERTURNED', 'invoice'),
      rec([FAIL('TOTAL')], 'UPHELD', 'e-invoice'),
    ])
    expect(rules).toHaveLength(2)
    expect(rules.map(r => r.domain).sort()).toEqual(['e-invoice', 'invoice'])
  })
})

describe('ruleCalibration — flagging', () => {
  it('flags only rules with enough samples AND overturn ≥ threshold', () => {
    const records = [
      ...Array.from({ length: 6 }, () => rec([FAIL('LOUD')], 'OVERTURNED')), // 6 reviewed, 100% overturn → flag
      ...Array.from({ length: 6 }, () => rec([FAIL('GOOD')], 'UPHELD')),     // 6 reviewed, 0% overturn → no flag
      rec([FAIL('THIN')], 'OVERTURNED'),                                     // 1 reviewed, 100% → below min_reviewed
    ]
    const report = ruleCalibration(records, { min_reviewed: 5, flag_threshold: 0.2 })
    expect(report.flagged.map(r => r.rule_id)).toEqual(['LOUD'])
    expect(report.params).toEqual({ min_reviewed: 5, flag_threshold: 0.2 })
  })
})

describe('renderCalibration', () => {
  it('says so when nothing has been reviewed (never fakes a table)', () => {
    expect(renderCalibration(ruleCalibration([]))).toMatch(/No FAIL verdict has been human-reviewed yet/)
  })

  it('renders a table and marks flagged rules', () => {
    const report = ruleCalibration(Array.from({ length: 5 }, () => rec([FAIL('A')], 'OVERTURNED')), { min_reviewed: 5, flag_threshold: 0.2 })
    const md = renderCalibration(report)
    expect(md).toMatch(/Per-rule calibration/)
    expect(md).toMatch(/`A`/)
    expect(md).toMatch(/⚠/)
  })
})

describe('integration — real verdict through the ledger', () => {
  it('surfaces a real rule_id when a human overturns a real FAIL', () => {
    const led = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const v = verify(broken, { now: FIXED_NOW })
    expect(v.outcome).toBe('FAIL')
    led.record(v, { tenant_id: 't' })
    led.review(v.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' })
    const { rules } = ruleCalibration(led.query({ reviewed: true }))
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0].overturned).toBe(1)
    expect(rules[0].rule_id).toBeTruthy()
  })
})
