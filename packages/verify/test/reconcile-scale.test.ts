/**
 * Completeness reconciliation at a size a buyer asks about: ~50,000 payments against ~50,000 verdicts recorded through the
 * ledger door (real engine verdicts from the cross-document reconcile(), compact so the suite stays fast). Every class count
 * is known arithmetically in advance; the timing is measured and logged; the report is hash-stable across two runs.
 */
import { describe, it, expect } from 'vitest'
import { reconcile, type ReconciliationRuleset } from '../src/index'
import { createLedger } from '../src/ledger/index'
import { reconcileCompleteness, readPopulationCSV, renderCompletenessReport, type CompletenessMapping } from '../src/reconcile/completeness/index'

const N = 50_000
const RS: ReconciliationRuleset = {
  id: 'payables-scale', version: '0.0.1', documents: ['invoice'],
  fields: { total: { doc: 'invoice', paths: ['total'] }, approved: { doc: 'invoice', paths: ['approved'] } },
  checks: [{ code: 'WITHIN_APPROVAL', left: 'total', op: '<=', right: 'approved', tol: 0 }],
}
const NOW = (): Date => new Date('2026-09-28T00:00:00Z')
const total = (i: number): string => `${100 + (i % 900)}.${String(i % 100).padStart(2, '0')}`

// The plan (i = 0 … N−1 is one invoice):
const isFail = (i: number): boolean => i % 100 === 7            // 500 FAIL: over approval
const notOnBook = (i: number): boolean => i % 250 === 3         // 200 never checked → BYPASSED
const notPaid = (i: number): boolean => i % 500 === 11          // 100 checked, never paid → ORPHAN
const misPaid = (i: number): boolean => i % 1000 === 13         // 50 paid one cent more → MISMATCHED
const paidTwice = (i: number): boolean => i % 5000 === 17       // 10 paid twice → AMBIGUOUS (20 rows)

const MAP: CompletenessMapping = {
  mapping_version: 'completeness-mapping-v0', key: ['vendor_id', 'invoice_number'],
  population: { columns: { payment_id: 'id', vendor_id: 'vendor', invoice_number: 'invoice', amount: 'amount', currency: 'ccy', payment_date: 'paid' } },
  book: { fields: { invoice_number: [{ extraction: 'invoice.number' }], vendor_id: [{ extraction: 'invoice.vendor' }], amount: [{ extraction: 'invoice.total' }], currency: [{ extraction: 'invoice.currency' }] } },
}

describe(`completeness at scale: ${N} payments × ~${N} verdicts`, () => {
  it('every count is exact, the timing is measured, and the report is hash-stable', () => {
    let t = Date.now()
    const led = createLedger({ now: () => new Date('2026-09-10T12:00:00Z') })
    const extractions: unknown[] = []
    for (let i = 0; i < N; i++) {
      if (notOnBook(i)) continue
      const docs = { invoice: { number: `INV-${i}`, vendor: `V${i % 97}`, total: total(i), approved: isFail(i) ? '1.00' : '9999.99', currency: 'USD' } }
      led.record(reconcile(docs, RS, { now: NOW }), { tenant_id: 'acme' })
      extractions.push(docs)
    }
    const buildBookMs = Date.now() - t
    const lines = ['id,vendor,invoice,amount,ccy,paid']
    for (let i = 0; i < N; i++) {
      if (notPaid(i)) continue
      const amt = misPaid(i) ? (Number(total(i)) + 0.01).toFixed(2) : total(i)
      lines.push(`P${i},V${i % 97},INV-${i},${amt},USD,2026-09-15`)
      if (paidTwice(i)) lines.push(`P${i}b,V${i % 97},INV-${i},${amt},USD,2026-09-16`)
    }
    const csv = lines.join('\r\n') + '\r\n'

    t = Date.now()
    const pop = readPopulationCSV(csv)
    const readMs = Date.now() - t
    t = Date.now()
    const r = reconcileCompleteness(pop, led, MAP, { extractions, rungs: { 'acme/payables-scale@0.0.1': 'gate' } })
    const reconcileMs = Date.now() - t
    t = Date.now()
    const md = renderCompletenessReport(r)
    const renderMs = Date.now() - t

    // Expected, arithmetically.
    let bypassed = 0, orphans = 0, mism = 0, pdh = 0, ambRows = 0, matched = 0
    for (let i = 0; i < N; i++) {
      const onBook = !notOnBook(i), paid = !notPaid(i)
      if (!paid) { if (onBook) orphans++; continue }
      if (!onBook) { bypassed += paidTwice(i) ? 2 : 1; continue }
      if (paidTwice(i)) { ambRows += 2; continue }
      if (isFail(i)) pdh++ // held at gate, nobody resolved it, paid
      else if (misPaid(i)) mism++
      else matched++
    }
    const rows = pop.rows.length
    expect(rows).toBe(N - Array.from({ length: N }, (_, i) => i).filter(notPaid).length + Array.from({ length: N }, (_, i) => i).filter(i => paidTwice(i) && !notPaid(i)).length)
    expect(r.population.by_class).toEqual({ MATCHED: matched, MISMATCHED: mism, PAID_DESPITE_HOLD: pdh, CHECKED_AFTER_PAYMENT: 0, AMBIGUOUS: ambRows, BYPASSED: bypassed, UNREADABLE: 0 })
    expect(r.book.by_class.ORPHAN).toBe(orphans)
    expect(r.exceptions.mismatched.every(x => x.differences[0]!.delta === '-0.01')).toBe(true)
    expect(r.coverage.on_book + r.coverage.not_on_book).toBe(rows)
    expect(md.length).toBeGreaterThan(0)

    // Hash-stable: a second, independent read and reconciliation gives the same report.
    t = Date.now()
    const r2 = reconcileCompleteness(readPopulationCSV(Buffer.from(csv, 'utf8')), led, MAP, { extractions: [...extractions].reverse(), rungs: { 'acme/payables-scale@0.0.1': 'gate' } })
    const secondMs = Date.now() - t
    expect(r2.report_hash).toBe(r.report_hash)

    console.log(`[reconcile-scale] rows ${rows} · book ${r.binds.book.length} events · build book ${buildBookMs} ms · read CSV ${readMs} ms · reconcile ${reconcileMs} ms (again ${secondMs} ms) · render ${renderMs} ms · by_class ${JSON.stringify(r.population.by_class)} · report ${r.report_hash.slice(0, 16)}`)
    // A generous ceiling so a slow CI box does not flake; the logged figure is the measurement.
    expect(reconcileMs).toBeLessThan(60_000)
  }, 300_000)
})
