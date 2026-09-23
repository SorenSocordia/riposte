/**
 * Tenant book-of-record report — the composed compliance artifact (volume + real-world overturn + per-rule calibration
 * + tamper-evidence). Built on real verdicts through the real ledger.
 */
import { describe, it, expect } from 'vitest'
import { createLedger, verify, renderTenantReport } from '../src/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

describe('renderTenantReport', () => {
  it('composes volume, real-world overturn, calibration, and an intact-chain attestation', () => {
    const led = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const vC = verify(clean, { now: FIXED_NOW })
    const vB = verify(broken, { now: FIXED_NOW })
    led.record(vC, { tenant_id: 't' })
    led.record(vB, { tenant_id: 't' })
    led.review(vB.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' })

    const md = renderTenantReport(led, { tenant_id: 't', as_of: '2026-09-22' })
    expect(md).toMatch(/book of record — tenant `t`/)
    expect(md).toMatch(/As of 2026-09-22/)
    expect(md).toMatch(/Verdicts on record: \*\*2\*\*/)
    expect(md).toMatch(/Human-overturn rate: 100\.0%/)          // 1 of 1 reviewed FAIL overturned
    expect(md).toMatch(/Per-rule calibration/)                   // calibration section present
    expect(md).toMatch(/Chain intact across \*\*3\*\* events/)   // 2 records + 1 review
    expect(md).toMatch(/Anchor to notarize \(head hash\): `[0-9a-f]{8}/)
  })

  it('is honest when empty (no verdicts, no reviews)', () => {
    const md = renderTenantReport(createLedger())
    expect(md).toMatch(/Verdicts on record: \*\*0\*\*/)
    expect(md).toMatch(/Human-overturn rate: —/)
    expect(md).toMatch(/No FAIL verdict has been human-reviewed yet/)
  })
})
