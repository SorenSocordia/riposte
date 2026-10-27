/**
 * 2026-10-05: reconcile reads strictly under engine 0.6.0 (src/reconcile/index.ts bindField, with
 * src/rulesets/strict.ts), closing red-team F6, F14 and F15 on the reconciliation path. Under engine 0.5.0 every case below reads
 * exactly as before (the red-team finding reproduces), and a 0.5.0 verdict replays.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcile, verifyReplay, type ReconciliationRuleset, type Verdict } from '../src/index'

const RS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'four-way-match.ruleset.json'), 'utf8')) as ReconciliationRuleset
const NOW = () => new Date('2026-10-05T00:00:00Z')
type Docs = Record<string, Record<string, unknown>>
const base = (inv: unknown): Docs => ({ po: { approved_amount: 1000 }, invoice: { payable_amount: inv }, receipt: { received_amount: 1 }, payment: { amount: 1 } })
const run = (d: Docs, engine?: string): Verdict => reconcile(d, RS, { now: NOW, ...(engine ? { engine } : {}) })
const tie = (v: Verdict) => v.claims.find((c) => c.claim_id === 'recon.RECEIPT_TIES_INV')!

describe('reconcile under engine 0.6.0', () => {
  it('F6: a garbled "$1OO.O0" is UNPARSEABLE, never 1 (engine 0.5.0 read 1 and tied it to a receipt of 1)', () => {
    expect(tie(run(base('$1OO.O0'), '0.5.0'))).toMatchObject({ outcome: 'PASS', asserted: 1 })
    const c = tie(run(base('$1OO.O0')))
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE', missing: ['INV_TOTAL'] })
    expect(c.insufficiency!.detail).toBe('INV_TOTAL in "invoice" is present but not a number: payable_amount is "$1OO.O0", which does not read as one number (it holds characters that are not part of a number): not read, never guessed')
  })
  it('F14: "1 234" and an unsettled "1.234" are unreadable; "1.234" reads 1234 once the document declares de (from 2026-10-06, a format the other figures settle does not read it)', () => {
    expect(tie(run(base('1 234'), '0.5.0')).asserted).toBe(1)
    expect(tie(run(base('1 234'))).insufficiency!.reason).toBe('UNPARSEABLE')
    const d = base('1.234'); d.receipt = { received_amount: 1234 }
    expect(tie(run(d, '0.5.0')).outcome).toBe('PASS') // read by position as 1234
    expect(tie(run(d)).insufficiency!.detail).toContain('nothing in the document settles its number format')
    expect(tie(run({ ...d, invoice: { payable_amount: '1.234', number_locale: 'de' } }))).toMatchObject({ outcome: 'PASS', asserted: 1234 })
    expect(tie(run({ ...d, invoice: { payable_amount: '1.234', freight: '12,50' } })).outcome).toBe('INSUFFICIENT_DATA') // "12,50" is ambiguous itself: no evidence
    // 2026-10-06: "1.200,00" settles de, but a lone three-digit group reads only under a declared format (cold review round 6:
    // "1.500" was read as 1.5 beside "1500.00")
    const settled = tie(run({ ...d, invoice: { payable_amount: '1.234', subtotal: '1.200,00' } }))
    expect(settled.outcome).toBe('INSUFFICIENT_DATA')
    expect(settled.insufficiency!.detail).toContain('only a declared format settles which; the document\'s other figures are written in de')
    expect(tie(run({ ...d, invoice: { payable_amount: '1.234', subtotal: '1.200,00', number_locale: 'de' } }))).toMatchObject({ outcome: 'PASS', asserted: 1234 })
  })
  it('F15: a near-miss key is UNPARSEABLE naming it, never FIELD_MISSING', () => {
    const d: Docs = { ...base(1), invoice: { 'payable_amount ': 1 } }
    expect(tie(run(d, '0.5.0')).insufficiency!.reason).toBe('FIELD_MISSING')
    expect(tie(run(d)).insufficiency).toMatchObject({ reason: 'UNPARSEABLE', detail: expect.stringContaining('payable_amount was reported under the key path "payable_amount ", which differs from it only by spaces or invisible characters') })
  })
  it('a refused value never falls back to the field\'s default', () => {
    const rs: ReconciliationRuleset = { ...RS, fields: { ...RS.fields, INV_TOTAL: { ...RS.fields.INV_TOTAL!, default: 0 } } }
    const d: Docs = { ...base('n/a'), receipt: { received_amount: 0 } }
    expect(reconcile(d, rs, { now: NOW, engine: '0.5.0' }).claims.find((c) => c.claim_id === 'recon.RECEIPT_TIES_INV')!.outcome).toBe('PASS') // junk read as the default 0
    expect(reconcile(d, rs, { now: NOW }).claims.find((c) => c.claim_id === 'recon.RECEIPT_TIES_INV')!.insufficiency!.reason).toBe('UNPARSEABLE')
  })
  it('controls: JSON numbers, "$1,234.56", a coherent set: unchanged verdict bodies between the engines apart from identity', () => {
    const d: Docs = { po: { approved_amount: 2000 }, invoice: { payable_amount: '$1,234.56' }, receipt: { received_amount: 1234.56 }, payment: { amount: '1,234.56' } }
    const a = run(d), b = run(d, '0.5.0')
    expect(a.outcome).toBe('PASS')
    expect(a.claims).toEqual(b.claims)
  })
  it('verdicts of both engines replay VERIFIED', () => {
    for (const engine of [undefined, '0.5.0']) {
      for (const d of [base('$1OO.O0'), base('1 234'), { ...base(1), invoice: { 'payable_amount ': 1 } }]) {
        const v = run(d, engine)
        const r = verifyReplay(v, { documents: d, ruleset: RS })
        expect(r.status, `${engine}`).toBe('REPERFORMED')
        expect(r.outcome_verified).toBe(true)
      }
    }
  })
})
