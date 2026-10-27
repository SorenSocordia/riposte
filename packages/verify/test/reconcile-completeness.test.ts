/**
 * Completeness reconciliation: the book of record against a payment population. The auditor's first question ("did every
 * payment go through the control?") answered class by class on a real book: real verify() verdicts through the ledger door,
 * a signed GRANT to gate, reviews on the ledger clock. Every population row in the scenario states the class it must land in.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { verifyAction } from '../src/action/index'
import { createLedger, linkEvent, parseChainJSONL, type LedgerEvent } from '../src/ledger/index'
import { rateInterval } from '../src/verdict/bounds'
import { hashOf } from '../src/verdict/canonical'
import { verify } from '../src/index'
import {
  reconcileCompleteness, renderCompletenessReport, readPopulationCSV, readPopulationJSONL, populationFromRows, completenessReportIntact,
  effectiveCompletenessMapping, CompletenessRefused, COMPLETENESS_BOUNDARY, type CompletenessMapping, type CompletenessReport,
} from '../src/reconcile/completeness/index'
import { MAPPING, TRUSTED, FIXED_NOW, WF, buildScenario, csvOf, passInvoice, failInvoice, type Json } from './fixtures/reconcile/scenario'

const ACME = { scope: { tenant_id: 'acme' }, anchors: { trusted_keys: TRUSTED } }
const classOf = (r: CompletenessReport, row: number): string => {
  const e = r.exceptions
  for (const [cls, items] of [['PAID_DESPITE_HOLD', e.paid_despite_hold], ['MISMATCHED', e.mismatched], ['CHECKED_AFTER_PAYMENT', e.checked_after_payment]] as const) {
    if (items.some(x => x.population.row === row)) return cls
  }
  if (e.ambiguous.some(g => g.population.some(p => p.row === row))) return 'AMBIGUOUS'
  if (e.bypassed.some(x => x.population.row === row)) return 'BYPASSED'
  if (e.unreadable.some(x => x.row === row)) return 'UNREADABLE'
  return 'MATCHED'
}

describe('the scenario: every population row lands in the class it states', () => {
  const s = buildScenario()
  const pop = readPopulationCSV(s.csv)
  const r = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })

  it('every row, by class', () => {
    for (const [row, cls] of Object.entries(s.expected)) expect(classOf(r, Number(row)), `row ${row}`).toBe(cls)
    expect(r.population.by_class).toEqual({ MATCHED: 5, MISMATCHED: 2, PAID_DESPITE_HOLD: 2, CHECKED_AFTER_PAYMENT: 1, AMBIGUOUS: 2, BYPASSED: 3, UNREADABLE: 0 })
    expect(r.clean).toBe(false)
  })

  it('PAID DESPITE HOLD: held at gate by the signed GRANT in force when recorded, unresolved by the payment date', () => {
    const [f1, f3] = r.exceptions.paid_despite_hold
    expect(f1!.book.verdict_id).toBe(s.verdicts.F1!.verdict_id)
    expect(f1!.hold).toMatchObject({ rung: 'gate', rung_from: 'grant', resolution: 'NONE', grant: { signer_id: 'owner' } })
    // F3 was reviewed, but only on 09-08: the money moved on 09-05 while it was held.
    expect(f3!.book.verdict_id).toBe(s.verdicts.F3!.verdict_id)
    expect(f3!.hold).toMatchObject({ rung: 'gate', resolution: 'AFTER_PAYMENT', review: { decision: 'UPHELD', reviewer_id: 'ap-clerk' } })
  })

  it('a FAIL recorded before the GRANT was never held (the rung is the one in force at the record)', () => {
    const x = [...(r.matched ?? []), ...r.resolved_holds.items].find(m => m.book.verdict_id === s.verdicts.F0!.verdict_id)
    expect(x).toBeUndefined() // not a resolved hold: never held at all
    expect(classOf(r, 7)).toBe('MATCHED')
    const withMatched = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions, include_matched: true })
    const f0 = withMatched.matched!.find(m => m.book.verdict_id === s.verdicts.F0!.verdict_id)!
    expect(f0.book.outcome).toBe('FAIL')
    expect(f0.hold).toBeUndefined()
  })

  it('a hold a person resolved before the payment is not an exception, and is listed for sampling', () => {
    expect(r.resolved_holds).toMatchObject({ count: 1, overturned: 1, upheld: 0 })
    expect(r.resolved_holds.items[0]!.book.verdict_id).toBe(s.verdicts.F2!.verdict_id)
    expect(r.resolved_holds.items[0]!.hold!.resolution).toBe('ON_OR_BEFORE_PAYMENT')
  })

  it('MISMATCHED: the amount checked is not the amount paid; the currency checked is not the currency paid', () => {
    const [a2, a6] = r.exceptions.mismatched
    expect(a2!.differences).toEqual([{ field: 'amount', population: '2100', book: '2000', book_source: 'extraction:totals.total', delta: '-100' }])
    // Same number, different currency: flagged, and no amount delta is computed across currencies.
    expect(a6!.differences).toEqual([{ field: 'currency', population: 'EUR', book: 'USD', book_source: 'extraction:currency' }])
  })

  it('CHECKED AFTER PAYMENT: the verdict reached the book two days after the money moved', () => {
    expect(r.exceptions.checked_after_payment[0]!.late).toEqual({ first_recorded_day: '2026-09-07', payment_date: '2026-09-05' })
    expect(r.coverage.before_payment).toEqual({ rows_with_date: 10, checked_by_payment_date: 9, checked_after: 1 })
  })

  it('AMBIGUOUS: one verdict, two payments (a possible duplicate payment) is reported, never resolved', () => {
    expect(r.exceptions.ambiguous).toHaveLength(1)
    const g = r.exceptions.ambiguous[0]!
    expect(g.shape).toBe('POPULATION_DUPLICATES')
    expect(g.population.map(p => p.payment_id)).toEqual(['P-009', 'P-010'])
    expect(g.book.map(b => b.verdict_id)).toEqual([s.verdicts.A5!.verdict_id])
  })

  it('BYPASSED: no verdict for the key; a row with no key; another tenant\'s verdict does not cover this tenant\'s payment', () => {
    expect(r.exceptions.bypassed.map(b => [b.population.payment_id, b.reason])).toEqual([['P-003', 'NO_VERDICT'], ['P-014', 'NO_KEY'], ['P-015', 'NO_VERDICT']])
  })

  it('ORPHANS on the book: a PASS never paid, a held FAIL never paid (the control working), a same-number invoice from another vendor', () => {
    expect(r.exceptions.orphans.map(o => [o.book.verdict_id, o.book.outcome, o.held])).toEqual([
      [s.verdicts.A8!.verdict_id, 'PASS', false],
      [s.verdicts.F4!.verdict_id, 'FAIL', true],
      [s.verdicts.D1a!.verdict_id, 'PASS', false],
    ])
    // P-S3-R1: under a tenant scope the summary is the tenant's slice (was records 15, out_of_scope 1, both tenants).
    expect(r.book).toMatchObject({ records: 14, out_of_scope: 0, in_scope: 14, in_period: 14, tenants: ['acme'], by_class: { MATCHED: 10, ORPHAN: 3, AMBIGUOUS: 1, UNKEYED: 0 } })
    expect(r.book.rungs).toEqual([{ workflow_id: 'acme/invoice@0.0.1', from: 'grant' }])
  })

  it('coverage: exact counts, and the bound is the declared method from src/verdict/bounds.ts', () => {
    expect(r.coverage).toMatchObject({ population_rows: 15, on_book: 10, not_on_book: 5 })
    expect(r.coverage.rate).toBeCloseTo(10 / 15, 12)
    const iv = rateInterval(5, 15, 0.95, 'clopper-pearson', 'one-sided')
    expect(r.coverage.bound).toMatchObject({ method: 'clopper-pearson', confidence: 0.95, sidedness: 'one-sided', words: '95% one-sided clopper-pearson', not_on_book_upper: iv.upper })
    const w = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions, interval: { method: 'wilson', confidence: 0.9 } })
    expect(w.coverage.bound.not_on_book_upper).toBe(rateInterval(5, 15, 0.9, 'wilson').upper)
  })

  it('$ totals by currency tie out: population = sum over classes', () => {
    expect(r.amounts.population).toEqual({ EUR: '800', USD: '7131' })
    const sum = (c: string): number => Object.values(r.amounts.by_class).reduce((a, t) => a + Number(t[c] ?? 0), 0)
    expect(sum('USD')).toBe(7131)
    expect(sum('EUR')).toBe(800)
    expect(r.amounts.by_class.PAID_DESPITE_HOLD).toEqual({ USD: '1220' })
  })

  it('binds: the book head and length, the population file hash, and the extractions it used', () => {
    expect(r.binds.book).toEqual({ head: s.ledger.chainHead(), length: s.ledger.events().length })
    expect(r.binds.population.sha256).toBe(createHash('sha256').update(Buffer.from(s.csv, 'utf8')).digest('hex'))
    expect(r.binds.population.rows).toBe(15)
    expect(r.binds.extractions).toMatchObject({ supplied: 15, distinct: 15, used: 14 }) // globex's extraction is out of scope
    expect(r.book.unanchored_signers).toEqual([])
  })
})

describe('key normalization is declared, never guessed', () => {
  const s = buildScenario()
  const pop = readPopulationCSV(s.csv)
  it('without the case rule, "v3 / inv-a7 " is not "V3 / INV-A7": BYPASSED here, ORPHAN on the book', () => {
    const plain = reconcileCompleteness(pop, s.ledger, { ...MAPPING, normalize: {} }, { ...ACME, extractions: s.extractions })
    expect(classOf(plain, 12)).toBe('BYPASSED')
    expect(plain.exceptions.orphans.some(o => o.book.verdict_id === s.verdicts.A7!.verdict_id)).toBe(true)
  })
  it('trim is on by default and can be declared off', () => {
    const noTrim = reconcileCompleteness(pop, s.ledger, { ...MAPPING, normalize: { invoice_number: { case: 'upper', trim: false }, vendor_id: { case: 'upper' } } }, { ...ACME, extractions: s.extractions })
    expect(classOf(noTrim, 12)).toBe('BYPASSED')
  })
  it('remove + strip leading zeros, in order, on both sides', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-000123', 'V1', 50)
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    const pop2 = readPopulationCSV(csvOf([['P-1', 'V1', 'inv 123', '50', 'USD', '2026-09-01', '2026-09-05']]))
    const m: CompletenessMapping = { ...MAPPING, normalize: { invoice_number: { remove: '- ', case: 'upper', strip_leading_zeros: false } } }
    // "INV000123" vs "INV123": leading zeros inside the string are not leading zeros of the value.
    expect(reconcileCompleteness(pop2, led, m, { extractions: [x] }).population.by_class.BYPASSED).toBe(1)
    const m2: CompletenessMapping = { ...MAPPING, normalize: { invoice_number: { remove: '- INVinv', strip_leading_zeros: true } } }
    expect(reconcileCompleteness(pop2, led, m2, { extractions: [x] }).population.by_class.MATCHED).toBe(1)
  })
})

describe('duplicate invoice numbers across vendors', () => {
  const s = buildScenario()
  const pop = readPopulationCSV(s.csv)
  it('keyed on vendor + number: two vendors\' INV-D1 are two items', () => {
    const r = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    expect(classOf(r, 13)).toBe('MATCHED')
  })
  it('keyed on the number alone: one payment, two verdicts → AMBIGUOUS (BOOK_DUPLICATES), never a silent pick', () => {
    const r = reconcileCompleteness(pop, s.ledger, { ...MAPPING, key: ['invoice_number'] }, { ...ACME, extractions: s.extractions })
    const g = r.exceptions.ambiguous.find(x => x.key.invoice_number === 'INV-D1')!
    expect(g.shape).toBe('BOOK_DUPLICATES')
    expect(g.book.map(b => b.verdict_id).sort()).toEqual([s.verdicts.D1a!.verdict_id, s.verdicts.D1b!.verdict_id].sort())
    expect(classOf(r, 13)).toBe('AMBIGUOUS')
  })
  it('keyed on the number alone, the vendor is COMPARED: a payee swap is MISMATCHED', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-PAYEE', 'V1', 900)
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    const pop2 = readPopulationCSV(csvOf([['P-1', 'V7', 'INV-PAYEE', '900', 'USD', '2026-09-01', '2026-09-05']]))
    const r = reconcileCompleteness(pop2, led, { ...MAPPING, key: ['invoice_number'] }, { extractions: [x] })
    expect(r.mapping.compared).toEqual(['vendor_id', 'amount', 'currency', 'invoice_date'])
    expect(r.exceptions.mismatched[0]!.differences).toEqual([{ field: 'vendor_id', population: 'V7', book: 'V1', book_source: 'extraction:vendor_id' }])
  })
  it('without a tenant scope, another tenant\'s verdict for the same key is a second record: AMBIGUOUS, not a match', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-T', 'V1', 10)
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'globex' })
    const pop2 = readPopulationCSV(csvOf([['P-1', 'V1', 'INV-T', '10', 'USD', '2026-09-01', '2026-09-05']]))
    expect(reconcileCompleteness(pop2, led, MAPPING, { extractions: [x] }).exceptions.ambiguous[0]!.book.map(b => b.tenant_id)).toEqual(['acme', 'globex'])
    expect(reconcileCompleteness(pop2, led, MAPPING, { extractions: [x], scope: { tenant_id: 'globex' } }).population.by_class.MATCHED).toBe(1)
  })
})

describe('amounts and dates are exact unless a tolerance is declared', () => {
  const one = (paid: string, m: Partial<CompletenessMapping> = {}): CompletenessReport => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-T', 'V1', 1894.92)
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    return reconcileCompleteness(readPopulationCSV(csvOf([['P-1', 'V1', 'INV-T', paid, 'USD', '2026-09-01', '2026-09-05']])), led, { ...MAPPING, ...m }, { extractions: [x] })
  }
  it('exact by default: a one-cent difference is a mismatch, with an exact delta (no float noise)', () => {
    expect(one('1894.92').population.by_class.MATCHED).toBe(1)
    expect(one('1894.920').population.by_class.MATCHED).toBe(1)
    expect(one('1894.93').exceptions.mismatched[0]!.differences[0]!.delta).toBe('-0.01')
  })
  it('an absolute tolerance', () => {
    expect(one('1894.93', { amount_tolerance: { abs: '0.01' } }).population.by_class.MATCHED).toBe(1)
    expect(one('1894.94', { amount_tolerance: { abs: '0.01' } }).exceptions.mismatched[0]!.differences[0]!.delta).toBe('-0.02')
  })
  it('a relative tolerance (the larger of abs and rel × the larger amount)', () => {
    expect(one('1895.80', { amount_tolerance: { rel: '0.0005' } }).population.by_class.MATCHED).toBe(1) // 0.88 ≤ 0.9479
    expect(one('1895.90', { amount_tolerance: { rel: '0.0005' } }).population.by_class.MISMATCHED).toBe(1) // 0.98 > 0.94795
  })
  it('a digit-grouped amount is refused until the grouping is declared, with the row and column', () => {
    expect(() => one('1,894.92')).toThrow(/row 1 \(line 2\), column "Amount": "1,894.92" is not an amount.*declare amount_format.group/)
    expect(one('1,894.92', { population: { ...MAPPING.population, amount_format: { group: ',' } } }).population.by_class.MATCHED).toBe(1)
  })
  it('an invoice-date difference, and a declared day tolerance', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-T', 'V1', 5, { date: '2026-09-01' })
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    const pop2 = readPopulationCSV(csvOf([['P-1', 'V1', 'INV-T', '5', 'USD', '2026-09-03', '2026-09-05']]))
    expect(reconcileCompleteness(pop2, led, MAPPING, { extractions: [x] }).exceptions.mismatched[0]!.differences).toEqual([{ field: 'invoice_date', population: '2026-09-03', book: '2026-09-01', book_source: 'extraction:invoice_date', delta: '-2' }])
    expect(reconcileCompleteness(pop2, led, { ...MAPPING, date_tolerance_days: 2 }, { extractions: [x] }).population.by_class.MATCHED).toBe(1)
  })
  it('a declared date format reads what the default refuses', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const x = passInvoice('INV-T', 'V1', 5, { date: '2026-09-01' })
    led.record(verify(x, { now: FIXED_NOW }), { tenant_id: 'acme' })
    const pop2 = readPopulationCSV(csvOf([['P-1', 'V1', 'INV-T', '5', 'USD', '09/01/2026', '09/05/2026']]))
    expect(() => reconcileCompleteness(pop2, led, MAPPING, { extractions: [x] })).toThrow(/is not a YYYY-MM-DD date/)
    const r = reconcileCompleteness(pop2, led, { ...MAPPING, population: { ...MAPPING.population, date_format: 'MM/DD/YYYY' } }, { extractions: [x] })
    expect(r.population.by_class.MATCHED).toBe(1)
  })
})

describe('malformed values: refused by default, UNREADABLE only when declared', () => {
  const s = buildScenario()
  const bad = s.csv.replace('P-001,V1,INV-A1,1000,', 'P-001,V1,INV-A1,10x0,')
  it('refuses with the row, line and column', () => {
    try { reconcileCompleteness(readPopulationCSV(bad), s.ledger, MAPPING, { ...ACME, extractions: s.extractions }); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(CompletenessRefused)
      expect((e as CompletenessRefused).row).toBe(1)
      expect((e as Error).message).toMatch(/row 1 \(line 2\), column "Amount": "10x0"/)
    }
  })
  it('on_malformed: report → UNREADABLE, counted against coverage', () => {
    const r = reconcileCompleteness(readPopulationCSV(bad), s.ledger, { ...MAPPING, on_malformed: 'report' }, { ...ACME, extractions: s.extractions })
    expect(r.exceptions.unreadable).toEqual([{ row: 1, line: 2, problems: [{ field: 'amount', column: 'Amount', value: '10x0', why: expect.stringMatching(/not an amount/) }] }])
    expect(r.population.by_class.UNREADABLE).toBe(1)
    expect(r.coverage.not_on_book).toBe(6)
    // Its verdict is still on the book, and now it has no payment: an orphan.
    expect(r.exceptions.orphans.some(o => o.book.verdict_id === s.verdicts.A1!.verdict_id)).toBe(true)
  })
})

describe('the book side: read only from a verified book, from declared sources', () => {
  it('a book that does not verify is refused: nothing is reconciled against a broken book', () => {
    const s = buildScenario()
    const chain = parseChainJSONL(s.ledger.chainJSONL())
    const payloads = [...chain.payloads]
    const i = chain.events.findIndex(e => e.type === 'RECORD' && e.verdict_id === s.verdicts.F1!.verdict_id)
    const p = structuredClone(payloads[i]) as { verdict: { outcome: string } }
    expect(p.verdict.outcome).toBe('FAIL')
    p.verdict.outcome = 'PASS' // a FAIL rewritten as PASS after the fact
    payloads[i] = p
    expect(() => reconcileCompleteness(readPopulationCSV(s.csv), { events: chain.events, payloads }, MAPPING, { extractions: s.extractions })).toThrow(new RegExp(`the book does not verify at event ${i} .*nothing is reconciled against a broken book`))
  })
  it('a chain export and the live ledger give the same report, byte for byte', () => {
    const s = buildScenario()
    const pop = readPopulationCSV(s.csv)
    const live = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    const exported = reconcileCompleteness(pop, parseChainJSONL(s.ledger.chainJSONL()), MAPPING, { ...ACME, extractions: s.extractions })
    expect(JSON.stringify(exported)).toBe(JSON.stringify(live))
  })
  it('without the extraction, an extraction-only key cannot be read: UNKEYED, never guessed; a claim source is the declared fallback', () => {
    const s = buildScenario()
    const pop = readPopulationCSV(s.csv)
    const r = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions.filter(x => x.invoice_number !== 'INV-A8') })
    expect(r.exceptions.unkeyed.map(u => [u.book.verdict_id, u.missing])).toEqual([[s.verdicts.A8!.verdict_id, ['invoice_number', 'vendor_id']]])
    expect(r.exceptions.unkeyed[0]!.why[0]).toMatch(/its extraction was not supplied/)
    expect(r.book.by_class.UNKEYED).toBe(1)
  })
  it('an extraction that is not the one on the book is never used (the hash binds it)', () => {
    const s = buildScenario()
    const forged = s.extractions.map(x => (x.invoice_number === 'INV-A1' ? { ...x, totals: { ...(x.totals as Json), total: 999 } } : x))
    const r = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: forged })
    expect(r.exceptions.unkeyed.map(u => u.book.verdict_id)).toEqual([s.verdicts.A1!.verdict_id])
    expect(r.binds.extractions.used).toBe(13)
  })
  it('claim sources: the verdict\'s own asserted values (normalized by the engine), with no extractions at all', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    led.record(verify(passInvoice('INV-1001', 'V1', 1894.92), { now: FIXED_NOW }), { tenant_id: 'acme' })
    const m: CompletenessMapping = {
      mapping_version: 'completeness-mapping-v0', key: ['invoice_number'],
      population: { columns: { invoice_number: 'InvoiceNo', amount: 'Amount' } },
      book: { fields: { invoice_number: [{ claim: 'document.DUP_PROHIB' }], amount: [{ claim: 'document.TOTAL_INT' }] } },
      normalize: { invoice_number: { remove: '-' } }, // the engine asserts "INV1001" (it drops the dash); declare the same on both sides
    }
    const r = reconcileCompleteness(populationFromRows([{ InvoiceNo: 'INV-1001', Amount: 1894.92 }]), led, m)
    expect(r.population.by_class.MATCHED).toBe(1)
    expect(r.binds.population.format).toBe('rows')
    expect(r.binds.population.sha256).toBeUndefined()
  })
  it('agent actions: a payment the gate held (ungrounded amount) and that was paid anyway, rung declared, keys from the action\'s claims', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const act = { tool: 'pay_invoice', arguments: { invoice_number: 'ACT-1', vendor_id: 'V9', amount: 500, currency: 'USD' } }
    const v = verifyAction(act, { allowed: { invoice_number: ['ACT-1'], vendor_id: ['V9'], currency: ['USD'] } }, { now: FIXED_NOW })
    expect(v.outcome).toBe('INSUFFICIENT_DATA') // nobody declared where the amount comes from
    led.record(v, { tenant_id: 'acme' })
    const m: CompletenessMapping = {
      mapping_version: 'completeness-mapping-v0', key: ['vendor_id', 'invoice_number'],
      population: { columns: { invoice_number: 'InvoiceNo', vendor_id: 'VendorID', amount: 'Amount', payment_date: 'PaymentDate' } },
      book: { fields: { invoice_number: [{ extraction: 'arguments.invoice_number' }, { claim: 'arg.invoice_number' }], vendor_id: [{ claim: 'arg.vendor_id' }], amount: [{ claim: 'arg.amount' }] } },
    }
    const pop2 = populationFromRows([{ InvoiceNo: 'ACT-1', VendorID: 'V9', Amount: '500', PaymentDate: '2026-09-04' }])
    const record = reconcileCompleteness(pop2, led, m)
    expect(record.population.by_class.MATCHED).toBe(1) // at `record` nothing is held
    const gate = reconcileCompleteness(pop2, led, m, { rungs: { 'acme/action@0.0.1': 'gate' } })
    expect(gate.exceptions.paid_despite_hold[0]!.hold).toMatchObject({ rung: 'gate', rung_from: 'declared', resolution: 'NONE' })
    expect(gate.book.rungs).toEqual([{ workflow_id: 'acme/action@0.0.1', from: 'declared' }])
    // The proposed action itself is the checked "extraction": its hash is the one on the book.
    const withAction = reconcileCompleteness(pop2, led, m, { extractions: [act] })
    expect(withAction.exceptions.bypassed).toEqual([])
    expect(withAction.binds.extractions.used).toBe(1)
  })
  it('an unanchored GRANT has no effect (D-ANCHOR): listed, and the rung falls back to the declared one, then record', () => {
    const s = buildScenario()
    const pop = readPopulationCSV(s.csv)
    const bare = reconcileCompleteness(pop, s.ledger, MAPPING, { scope: { tenant_id: 'acme' }, extractions: s.extractions }) // no anchors
    expect(bare.population.by_class.PAID_DESPITE_HOLD).toBe(0)
    expect(bare.book.unanchored_grants).toEqual([expect.objectContaining({ workflow_id: WF, level: 'gate', signer_id: 'owner' })])
    expect(bare.book.rungs).toEqual([{ workflow_id: WF, from: 'none' }])
    const declared = reconcileCompleteness(pop, s.ledger, MAPPING, { scope: { tenant_id: 'acme' }, extractions: s.extractions, rungs: { [WF]: 'gate' } })
    // Declared gate everywhere: F0 (recorded before the GRANT) is now held too.
    expect(declared.exceptions.paid_despite_hold.map(x => x.population.payment_id)).toEqual(['P-004', 'P-006', 'P-007'])
    expect(renderCompletenessReport(bare)).toMatch(/is not anchored to a person: it has no effect on any rung here/)
  })
  it('a declared rung never overrides an anchored GRANT on the book', () => {
    const s = buildScenario()
    const r = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: s.extractions, rungs: { [`acme/invoice@0.0.1`]: 'record' } })
    expect(r.population.by_class.PAID_DESPITE_HOLD).toBe(2)
  })
  it('the period: records outside it still match, but are never orphans', () => {
    const s = buildScenario()
    const r = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: s.extractions, period: { since: '2026-09-02T00:00:00Z' } })
    expect(r.book.in_period).toBe(13)
    expect(r.book.matched_outside_period).toBe(1) // F0, recorded 09-01, paid in the population
    expect(classOf(r, 7)).toBe('MATCHED')
    const later = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: s.extractions, period: { since: '2026-09-05T00:00:00-04:00' } })
    expect(later.period.since).toBe('2026-09-05T04:00:00.000Z')
    expect(later.book.in_period).toBe(1) // A4 only
    expect(later.exceptions.orphans).toEqual([])
  })
})

describe('the mapping is declared, and refused when it would have to guess', () => {
  const s = buildScenario()
  const pop = readPopulationCSV(s.csv)
  const refuse = (m: unknown, re: RegExp): void => { expect(() => reconcileCompleteness(pop, s.ledger, m as CompletenessMapping, ACME)).toThrow(re) }
  it('refusals', () => {
    refuse({ ...MAPPING, mapping_version: 'v1' }, /mapping_version/)
    refuse({ ...MAPPING, key: [] }, /key must name/)
    refuse({ ...MAPPING, key: ['amount'] }, /key field "amount"/)
    refuse({ ...MAPPING, population: { columns: { ...MAPPING.population.columns, invoice_number: undefined } } }, /key field invoice_number has no population column/)
    refuse({ ...MAPPING, population: { columns: { ...MAPPING.population.columns, amount: 'Amt' } } }, /names column "Amt", which the header does not have/)
    refuse({ ...MAPPING, book: { fields: { ...MAPPING.book.fields, amount: [{ guess: true }] } } }, /book.fields.amount must be/)
    refuse({ ...MAPPING, amount_tolerance: { abs: '-1' } }, /cannot be negative/)
    refuse({ ...MAPPING, payment_date_utc_offset: 'EST' }, /payment_date_utc_offset/)
    refuse({ ...MAPPING, population: { ...MAPPING.population, amount_format: { decimal: ',', group: ',' } } }, /cannot both be/)
    expect(() => reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, interval: { confidence: 1 } })).toThrow(/confidence/)
  })
  it('the effective mapping states every default, and is what mapping_hash binds', () => {
    const e = effectiveCompletenessMapping(MAPPING)
    expect(e.amount_tolerance).toEqual({ abs: '0', rel: '0' })
    expect(e.normalize.invoice_number).toEqual({ trim: true, remove: '', case: 'upper', strip_leading_zeros: false })
    expect(e.population.amount_format).toEqual({ decimal: '.', group: '', strip: [], parens_negative: false, trailing_minus: false })
    expect(e.on_malformed).toBe('refuse')
    const r = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    expect(r.binds.mapping_hash).toBe(hashOf(e))
  })
})

describe('deterministic: the same inputs give the same bytes and the same report_hash', () => {
  it('twice over, from two independently built books', () => {
    const a = buildScenario(), b = buildScenario()
    const ra = reconcileCompleteness(readPopulationCSV(a.csv), a.ledger, MAPPING, { ...ACME, extractions: a.extractions })
    const rb = reconcileCompleteness(readPopulationCSV(Buffer.from(b.csv, 'utf8')), b.ledger, MAPPING, { ...ACME, extractions: [...b.extractions].reverse() })
    expect(JSON.stringify(rb)).toBe(JSON.stringify(ra))
    expect(renderCompletenessReport(rb)).toBe(renderCompletenessReport(ra))
    expect(completenessReportIntact(ra)).toBe(true)
  })
  it('generated_at is outside the hash; any other edit breaks it', () => {
    const s = buildScenario()
    const pop = readPopulationCSV(s.csv)
    const r1 = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    const r2 = reconcileCompleteness(pop, s.ledger, MAPPING, { ...ACME, extractions: s.extractions, now: () => new Date('2026-10-01T00:00:00Z') })
    expect(r2.generated_at).toBe('2026-10-01T00:00:00.000Z')
    expect(r2.report_hash).toBe(r1.report_hash)
    expect(completenessReportIntact(r2)).toBe(true)
    const tampered = structuredClone(r1)
    tampered.exceptions.paid_despite_hold.pop()
    expect(completenessReportIntact(tampered)).toBe(false)
  })
  it('a different population file is a different binding', () => {
    const s = buildScenario()
    const r1 = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    const r2 = reconcileCompleteness(readPopulationCSV(s.csv.replace(/\r\n/g, '\n')), s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    expect(r2.binds.population.sha256).not.toBe(r1.binds.population.sha256) // other bytes…
    expect(r2.binds.population.rows_hash).toBe(r1.binds.population.rows_hash) // …the same rows
    expect(r2.report_hash).not.toBe(r1.report_hash)
  })
  it('JSONL and CSV of the same rows reconcile the same way', () => {
    const s = buildScenario()
    const csv = readPopulationCSV(s.csv)
    const jsonl = readPopulationJSONL(csv.rows.map(r => JSON.stringify(r.values)).join('\n') + '\n')
    const a = reconcileCompleteness(csv, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    const b = reconcileCompleteness(jsonl, s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
    expect(b.population.by_class).toEqual(a.population.by_class)
    // Identical but for the physical line numbers (a CSV has a header line; JSONL does not).
    const noLines = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'line' ? undefined : v))
    expect(noLines(b.exceptions)).toBe(noLines(a.exceptions))
  })
})

describe('the Markdown an auditor reads', () => {
  const s = buildScenario()
  const r = reconcileCompleteness(readPopulationCSV(s.csv), s.ledger, MAPPING, { ...ACME, extractions: s.extractions })
  const md = renderCompletenessReport(r)
  it('states what it covers: the book head and length, the population hash', () => {
    expect(md).toContain(`head \`${r.binds.book.head}\` (${r.binds.book.length} events)`)
    expect(md).toContain(`\`${r.binds.population.sha256}\` (csv, ${r.binds.population.bytes} bytes, 15 rows)`)
    expect(md).toContain(`report \`${r.report_hash}\``)
  })
  it('states the honest boundary, verbatim', () => {
    expect(md).toContain("> Completeness of the population itself is the customer's IPE responsibility; this proves the book covers the population you gave it.")
    for (const line of COMPLETENESS_BOUNDARY) expect(md).toContain(line)
  })
  it('lists the override first, with the grant that set the hold', () => {
    expect(md.indexOf('## PAID DESPITE HOLD (2)')).toBeLessThan(md.indexOf('## MISMATCHED (2)'))
    expect(md).toMatch(/held at `gate` \(GRANT `[0-9a-f]{12}` by owner\); no person has reviewed it/)
    expect(md).toContain('after the payment')
    expect(md).toContain('**Not clean.** 10 of 15 payments (66.67%)')
    expect(md).toContain('95% one-sided clopper-pearson')
  })
  it('caps long sections and says so', () => {
    const short = renderCompletenessReport(r, { max_rows: 1 })
    expect(short).toContain('… and 2 more (in the JSON report).')
  })
  it('escapes a pipe in a population value', () => {
    const led = createLedger({ now: () => new Date('2026-09-03T00:00:00Z') })
    const pop = readPopulationCSV(csvOf([['P|1', 'V1', 'INV|X', '5', 'USD', '2026-09-01', '2026-09-05']]))
    const md2 = renderCompletenessReport(reconcileCompleteness(pop, led, MAPPING))
    expect(md2).toContain('1 (P\\|1)')
    expect(md2).toContain('invoice_number=INV\\|X')
  })
})

describe('an empty population and an empty book', () => {
  it('are reported honestly, not as a failure', () => {
    const led = createLedger()
    const pop = readPopulationCSV('PaymentID,VendorID,InvoiceNo,Amount,Currency,InvoiceDate,PaymentDate\r\n')
    const r = reconcileCompleteness(pop, led, MAPPING)
    expect(r.coverage).toMatchObject({ population_rows: 0, on_book: 0, rate: null, bound: { not_on_book_upper: 1, coverage_lower: 0 } })
    expect(r.book.records).toBe(0)
    expect(renderCompletenessReport(r)).toContain('0 of 0 payments (n/a)')
  })
  it('a book carrying something that is not a VERDICT is refused, never counted as the control operating', () => {
    const s = buildScenario()
    const chain = parseChainJSONL(s.ledger.chainJSONL())
    // Rebuild a book where one RECORD payload carries COUNSEL (a pre-door legacy entry), re-linked so the chain verifies.
    const payloads = chain.payloads.map(p => structuredClone(p))
    const i = chain.events.findIndex(e => e.type === 'RECORD' && e.verdict_id === s.verdicts.A1!.verdict_id)
    ;(payloads[i] as { verdict: Record<string, unknown> }).verdict.channel = 'COUNSEL'
    const events: LedgerEvent[] = []
    let prev = chain.events[0]!.prev_hash
    chain.events.forEach((e, j) => { const ev = linkEvent(j, prev, { ts: e.ts, type: e.type, verdict_id: e.verdict_id, payload: payloads[j] }); events.push(ev); prev = ev.entry_hash })
    // 2026-09-28: the book itself re-applies the verdict door on read, so such a book does not verify, and nothing is
    // reconciled against it. (The engine's own not_verdict exclusion stays as defence in depth.)
    expect(() => reconcileCompleteness(readPopulationCSV(s.csv), { events, payloads }, MAPPING, { ...ACME, extractions: s.extractions })).toThrow(CompletenessRefused)
    expect(() => reconcileCompleteness(readPopulationCSV(s.csv), { events, payloads }, MAPPING, { ...ACME, extractions: s.extractions })).toThrow(/does not pass the verdict door \(COUNSEL/)
  })
})

describe('sanity: the scenario\'s verdicts are what the fixtures say they are', () => {
  it('PASS invoices pass and FAIL invoices fail on the real engine', () => {
    expect(verify(passInvoice('A', 'V', 123.45), { now: FIXED_NOW }).outcome).toBe('PASS')
    expect(verify(failInvoice('B', 'V', 123.45), { now: FIXED_NOW }).outcome).toBe('FAIL')
  })
})
