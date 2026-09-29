/**
 * A real book of record for the earned-voice and opinion tests: real verify() verdicts (the clean and broken invoice
 * fixtures, made distinct by invoice number), recorded through the real ledger with an injected clock, reviewed by a
 * person. Deterministic: the same options always build the same chain.
 */
import { verify, createLedger, type Ledger } from '../../src/index'
import { INVOICE_RULESET_V0_0_1 } from '../../src/rulesets/index'
import { clean, broken, FIXED_NOW } from './invoices'

/**
 * The book's verdicts are issued under the RETAINED invoice ruleset 0.0.1, so the workflow these tests name stays
 * `<tenant>/invoice@0.0.1` across ruleset releases. They test the book, the voice and the opinions, not the invoice
 * rules (and the clean/broken fixtures get the same outcome under 0.0.1 and 0.1.0). Pinned 2026-09-28 when the default
 * moved to 0.1.0 (docs/NUMERIC-HONESTY-2026-09-28.md).
 */
const BOOK_RULESET = INVOICE_RULESET_V0_0_1

export interface LedgerBuild {
  tenant?: string
  /** PASS verdicts recorded (clean invoices). */
  passes: number
  /** FAIL verdicts recorded (broken invoices). */
  fails: number
  /** How many PASS verdicts are reviewed (default all). */
  reviewedPasses?: number
  /** How many FAIL verdicts are reviewed (default all). */
  reviewedFails?: number
  /** The first N reviewed PASSes are OVERTURNED (the misses). */
  passOverturned?: number
  /** The first N reviewed FAILs are OVERTURNED (the false alarms). */
  failOverturned?: number
  /** Continue on an existing ledger (a second tenant, or more evidence). */
  ledger?: Ledger
  /** Distinguish invoice numbers across builds on one ledger. */
  prefix?: string
}

export interface BuiltLedger { ledger: Ledger; passIds: string[]; failIds: string[] }

let clockMs = Date.parse('2026-09-01T00:00:00Z')

export function freshClock(): () => Date {
  clockMs = Date.parse('2026-09-01T00:00:00Z')
  return () => new Date((clockMs += 60_000))
}

export function buildLedger(o: LedgerBuild): BuiltLedger {
  const tenant = o.tenant ?? 'acme'
  const prefix = o.prefix ?? tenant
  const ledger = o.ledger ?? createLedger({ now: freshClock() })
  const passIds: string[] = [], failIds: string[] = []
  for (let i = 0; i < o.passes; i++) {
    const v = verify({ ...clean, invoice_number: `${prefix}-P${i}` }, { now: FIXED_NOW, ruleset: BOOK_RULESET })
    ledger.record(v, { tenant_id: tenant })
    passIds.push(v.verdict_id)
  }
  for (let i = 0; i < o.fails; i++) {
    const v = verify({ ...broken, invoice_number: `${prefix}-F${i}` }, { now: FIXED_NOW, ruleset: BOOK_RULESET })
    ledger.record(v, { tenant_id: tenant })
    failIds.push(v.verdict_id)
  }
  passIds.slice(0, o.reviewedPasses ?? o.passes).forEach((id, i) => {
    ledger.review(id, { reviewer_id: 'ap-lead', decision: i < (o.passOverturned ?? 0) ? 'OVERTURNED' : 'UPHELD', ...(i < (o.passOverturned ?? 0) ? { note: 'paid twice: the agent matched the wrong PO' } : {}) })
  })
  failIds.slice(0, o.reviewedFails ?? o.fails).forEach((id, i) => {
    ledger.review(id, { reviewer_id: 'ap-lead', decision: i < (o.failOverturned ?? 0) ? 'OVERTURNED' : 'UPHELD', ...(i < (o.failOverturned ?? 0) ? { note: 'credit note, not an invoice' } : {}) })
  })
  return { ledger, passIds, failIds }
}

export const WF = (tenant = 'acme'): string => `${tenant}/invoice@0.0.1`
