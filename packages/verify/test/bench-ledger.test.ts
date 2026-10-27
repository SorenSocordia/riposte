/**
 * The misses ledger (src/bench/ledger.ts) is append-only by construction: regenerating it refuses to drop a row or alter
 * one; the only change it allows to a prior row is adding a `fixed_by` that was absent.
 */
import { describe, it, expect } from 'vitest'
import { mergeLedger, ledgerRowsOf, LedgerRefused, type Ledger } from '../src/bench/ledger'
import { BENCH_FORMAT, type BenchMiss, type BenchTable } from '../src/bench/table'

const H = (c: string): string => c.repeat(64)
const table = (id: string, misses: BenchMiss[], date = '2026-10-03'): BenchTable => ({
  format: BENCH_FORMAT, id, title: id,
  prereg: { path: 'PREREG.md', sha256: H('a'), frozen_sha256: H('a'), amendments: [] },
  run: { id: 'r', date, engine_version: null, ruleset: null, results: { path: 'r.json', sha256: H('b') } },
  rows: [], misses, blind: false, label: 'post-hoc',
})
const m = (id: string, over: Partial<BenchMiss> = {}): BenchMiss => ({ id, kind: 'false-fail', description: `defect ${id}`, post_hoc: false, ...over })
const code = (f: () => unknown): string => { try { f(); return 'merged' } catch (e) { return e instanceof LedgerRefused ? e.code : `other: ${(e as Error).message}` } }

describe('the misses ledger', () => {
  const first = mergeLedger(null, [table('X1', [m('D02'), m('D04')]), table('X2', [m('CT01')], '2026-10-02')]).ledger

  it('starts from the tables, dated by the run (or the miss), keyed table#miss', () => {
    expect(first.rows.map(r => [r.key, r.date])).toEqual([['X1#D02', '2026-10-03'], ['X1#D04', '2026-10-03'], ['X2#CT01', '2026-10-02']])
    expect(ledgerRowsOf([table('T', [m('a', { date: '2026-09-30' })])])[0]!.date).toBe('2026-09-30')
  })

  it('appends new misses after the prior rows, in table order', () => {
    const { ledger, added } = mergeLedger(first, [table('A0', [m('new')]), table('X1', [m('D02'), m('D04')]), table('X2', [m('CT01')], '2026-10-02')])
    expect(added).toBe(1)
    expect(ledger.rows.map(r => r.key)).toEqual(['X1#D02', 'X1#D04', 'X2#CT01', 'A0#new'])
  })

  it('allows adding a fixed_by that was absent', () => {
    const { ledger, fixed } = mergeLedger(first, [table('X1', [m('D02', { fixed_by: 'R4 / peppol-en16931@0.2.0' }), m('D04')]), table('X2', [m('CT01')], '2026-10-02')])
    expect(fixed).toBe(1)
    expect(ledger.rows[0]!.fixed_by).toBe('R4 / peppol-en16931@0.2.0')
  })

  it('refuses to drop a row: its table is gone, or the table no longer lists it', () => {
    expect(code(() => mergeLedger(first, [table('X1', [m('D02'), m('D04')])]))).toBe('drop')
    expect(code(() => mergeLedger(first, [table('X1', [m('D02')]), table('X2', [m('CT01')], '2026-10-02')]))).toBe('drop')
  })

  it('refuses to alter a row: description, kind, date or post_hoc', () => {
    const base = (d: BenchMiss): BenchTable[] => [table('X1', [d, m('D04')]), table('X2', [m('CT01')], '2026-10-02')]
    expect(code(() => mergeLedger(first, base(m('D02', { description: 'reworded' }))))).toBe('alter')
    expect(code(() => mergeLedger(first, base(m('D02', { kind: 'near-miss' }))))).toBe('alter')
    expect(code(() => mergeLedger(first, base(m('D02', { post_hoc: true }))))).toBe('alter')
    expect(code(() => mergeLedger(first, [table('X1', [m('D02'), m('D04')], '2026-10-04'), table('X2', [m('CT01')], '2026-10-02')]))).toBe('alter')
  })

  it('refuses to change or remove a recorded fix', () => {
    const fixedOnce: Ledger = mergeLedger(first, [table('X1', [m('D02', { fixed_by: 'R4 / 0.2.0' }), m('D04')]), table('X2', [m('CT01')], '2026-10-02')]).ledger
    expect(code(() => mergeLedger(fixedOnce, [table('X1', [m('D02', { fixed_by: 'E1 / 0.1.0' }), m('D04')]), table('X2', [m('CT01')], '2026-10-02')]))).toBe('alter')
    expect(code(() => mergeLedger(fixedOnce, [table('X1', [m('D02'), m('D04')]), table('X2', [m('CT01')], '2026-10-02')]))).toBe('alter')
  })

  it('refuses a miss listed twice', () => {
    expect(code(() => mergeLedger(null, [table('X1', [m('D02'), m('D02')])]))).toBe('duplicate')
  })
})
