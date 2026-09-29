/**
 * Completeness-reconciliation fixtures: a real book (real verify() verdicts through the ledger door, a signed GRANT to gate,
 * reviews on the ledger clock), the checked extractions, and a payment population in which every row states the class the
 * reconciliation MUST put it in. Synthetic, and labelled so.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify } from '../../../src/index'
import { INVOICE_RULESET_V0_0_1 } from '../../../src/rulesets/index'
import { createLedger, makeGrant, signDecision, type Ledger, type TrustedKeys } from '../../../src/ledger/index'
import { EXAMPLE_PROMOTION_POLICY, policyRef } from '../../../src/verdict/voice'
import type { Verdict } from '../../../src/verdict/schema'
import type { CompletenessMapping } from '../../../src/reconcile/completeness/index'

export type Json = Record<string, unknown>

/** A fixed 32-byte seed → the same Ed25519 key every run (the ledger-decisions test pattern). */
export function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
export const OWNER = keyFromSeed('44'.repeat(32))
export const TRUSTED: TrustedKeys = { owner: OWNER.publicKeyPem }
export const FIXED_NOW = (): Date => new Date('2026-09-28T00:00:00Z')

/** A one-line invoice that foots (PASS). */
export function passInvoice(no: string, vendor: string, amount: number, o: { currency?: string; date?: string } = {}): Json {
  return {
    invoice_number: no, vendor_id: vendor, currency: o.currency ?? 'USD', invoice_date: o.date ?? '2026-09-01',
    line_items: [{ description: 'Services', quantity: 1, unit_price: amount, amount }],
    totals: { subtotal: amount, tax_rate: 0, tax: 0, total: amount },
  }
}

/** A one-line invoice whose subtotal does not foot (FAIL): the line says `amount`, the subtotal and total say amount + 10. */
export function failInvoice(no: string, vendor: string, amount: number, o: { currency?: string; date?: string } = {}): Json {
  return {
    invoice_number: no, vendor_id: vendor, currency: o.currency ?? 'USD', invoice_date: o.date ?? '2026-09-01',
    line_items: [{ description: 'Services', quantity: 1, unit_price: amount, amount }],
    totals: { subtotal: amount + 10, tax_rate: 0, tax: 0, total: amount + 10 },
  }
}

export const WF = 'acme/invoice@0.0.1'

/** The declared mapping for the scenario's CSV (keys: vendor + invoice number, upper-cased). */
export const MAPPING: CompletenessMapping = {
  mapping_version: 'completeness-mapping-v0',
  key: ['vendor_id', 'invoice_number'],
  population: {
    columns: {
      payment_id: 'PaymentID', vendor_id: 'VendorID', invoice_number: 'InvoiceNo', amount: 'Amount', currency: 'Currency',
      invoice_date: 'InvoiceDate', payment_date: 'PaymentDate',
    },
  },
  book: {
    fields: {
      invoice_number: [{ extraction: 'invoice_number' }],
      vendor_id: [{ extraction: 'vendor_id' }],
      amount: [{ extraction: 'totals.total' }],
      currency: [{ extraction: 'currency' }],
      invoice_date: [{ extraction: 'invoice_date' }],
    },
  },
  normalize: { invoice_number: { case: 'upper' }, vendor_id: { case: 'upper' } },
}

export interface Scenario {
  ledger: Ledger
  extractions: Json[]
  verdicts: Record<string, Verdict>
  csv: string
  /** CSV row number → the class it must land in. */
  expected: Record<number, string>
}

/** CSV-quote a field when it needs it (RFC 4180). */
export const q = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
export const HEADER = 'PaymentID,VendorID,InvoiceNo,Amount,Currency,InvoiceDate,PaymentDate'
export const csvOf = (rows: string[][]): string => [HEADER, ...rows.map(r => r.map(q).join(','))].join('\r\n') + '\r\n'

/**
 * The scenario. The book clock steps through September 2026:
 *   09-01  F0 recorded (FAIL) while the workflow is still at `record`: nothing is held.
 *   09-02  the owner GRANTs `gate`.
 *   09-03  the rest is recorded.
 *   09-04  F2 reviewed (OVERTURNED): its hold is resolved before its payment on 09-05.
 *   09-07  A4 recorded, two days after it was paid.
 *   09-08  F3 reviewed, three days after it was paid.
 */
export function buildScenario(): Scenario {
  let now = Date.parse('2026-09-01T10:00:00Z')
  const ledger = createLedger({ now: () => new Date(now), trusted_keys: TRUSTED })
  const extractions: Json[] = []
  const verdicts: Record<string, Verdict> = {}
  const rec = (name: string, x: Json, tenant = 'acme'): void => {
    // Issued under the retained invoice 0.0.1 so the workflow stays acme/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
    const v = verify(x, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    ledger.record(v, { tenant_id: tenant })
    extractions.push(x)
    verdicts[name] = v
  }
  const at = (iso: string): void => { now = Date.parse(iso) }

  at('2026-09-01T10:00:00Z')
  rec('F0', failInvoice('INV-F0', 'V1', 300))
  at('2026-09-02T09:00:00Z')
  ledger.decide(signDecision(makeGrant({
    workflow_id: WF, level: 'gate', consequence_tier: 'moderate', policy: policyRef(EXAMPLE_PROMOTION_POLICY),
    signer_id: 'owner', signed_at: '2026-09-02T09:00:00Z',
  }), OWNER.privateKeyPem))
  at('2026-09-03T12:00:00Z')
  rec('A1', passInvoice('INV-A1', 'V1', 1000))
  rec('A2', passInvoice('INV-A2', 'V1', 2000))
  rec('F1', failInvoice('INV-F1', 'V1', 500))
  rec('F2', failInvoice('INV-F2', 'V1', 600))
  rec('F3', failInvoice('INV-F3', 'V2', 700))
  rec('A5', passInvoice('INV-A5', 'V2', 450))
  rec('A6', passInvoice('INV-A6', 'V2', 800, { currency: 'USD' }))
  rec('A7', passInvoice('INV-A7', 'V3', 90))
  rec('A8', passInvoice('INV-A8', 'V3', 120))
  rec('F4', failInvoice('INV-F4', 'V3', 130))
  rec('D1a', passInvoice('INV-D1', 'V1', 55))
  rec('D1b', passInvoice('INV-D1', 'V2', 66))
  rec('X1', passInvoice('INV-X1', 'V9', 10), 'globex') // another tenant's book entry
  at('2026-09-04T08:00:00Z')
  ledger.review(verdicts.F2!.verdict_id, { reviewer_id: 'ap-clerk', decision: 'OVERTURNED', note: 'subtotal typo; total is right' }, { tenant_id: 'acme' })
  at('2026-09-07T15:00:00Z')
  rec('A4', passInvoice('INV-A4', 'V1', 400))
  at('2026-09-08T11:00:00Z')
  ledger.review(verdicts.F3!.verdict_id, { reviewer_id: 'ap-clerk', decision: 'UPHELD' }, { tenant_id: 'acme' })

  const rows: [string, string[]][] = [
    ['MATCHED', ['P-001', 'V1', 'INV-A1', '1000', 'USD', '2026-09-01', '2026-09-05']],
    ['MISMATCHED', ['P-002', 'V1', 'INV-A2', '2100', 'USD', '2026-09-01', '2026-09-05']],
    ['BYPASSED', ['P-003', 'V2', 'INV-A3', '350', 'USD', '2026-09-01', '2026-09-05']],
    ['PAID_DESPITE_HOLD', ['P-004', 'V1', 'INV-F1', '510', 'USD', '2026-09-01', '2026-09-05']],
    ['MATCHED', ['P-005', 'V1', 'INV-F2', '610', 'USD', '2026-09-01', '2026-09-05']], // held, resolved 09-04
    ['PAID_DESPITE_HOLD', ['P-006', 'V2', 'INV-F3', '710', 'USD', '2026-09-01', '2026-09-05']], // reviewed only 09-08
    ['MATCHED', ['P-007', 'V1', 'INV-F0', '310', 'USD', '2026-09-01', '2026-09-05']], // FAIL at `record`: never held
    ['CHECKED_AFTER_PAYMENT', ['P-008', 'V1', 'INV-A4', '400', 'USD', '2026-09-01', '2026-09-05']],
    ['AMBIGUOUS', ['P-009', 'V2', 'INV-A5', '450', 'USD', '2026-09-01', '2026-09-05']],
    ['AMBIGUOUS', ['P-010', 'V2', 'INV-A5', '450', 'USD', '2026-09-01', '2026-09-06']], // paid twice
    ['MISMATCHED', ['P-011', 'V2', 'INV-A6', '800', 'EUR', '2026-09-01', '2026-09-05']], // checked in USD, paid in EUR
    ['MATCHED', ['P-012', 'v3', 'inv-a7 ', '90.00', 'usd', '2026-09-01', '2026-09-05']], // normalization: trim + upper
    ['MATCHED', ['P-013', 'V2', 'INV-D1', '66', 'USD', '2026-09-01', '2026-09-05']], // same number as V1's: the key has the vendor
    ['BYPASSED', ['P-014', 'V1', '', '75', 'USD', '2026-09-01', '2026-09-05']], // no invoice number at all
    ['BYPASSED', ['P-015', 'V9', 'INV-X1', '10', 'USD', '2026-09-01', '2026-09-05']], // globex's verdict, outside acme's scope
  ]
  const expected: Record<number, string> = {}
  rows.forEach(([cls], j) => { expected[j + 1] = cls })
  return { ledger, extractions, verdicts, csv: csvOf(rows.map(r => r[1])), expected }
}
