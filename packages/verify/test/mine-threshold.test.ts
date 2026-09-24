/**
 * The C family (src/mine/threshold.ts): a constant learned per numeric document field, opt-in via `thresholds`.
 *
 *  - the learner: the constrained minimum-error cut, its interval, ties, exceptions, and missing values;
 *  - it does NOT drift down when exceptions are allowed (the bias of "the smallest consistent c");
 *  - end to end: a filer-status table where a $700M float decides the label, with noise on both sides and a
 *    correlated distractor field;
 *  - off by default: the AP grammar is unchanged unless `thresholds` is set;
 *  - the candle compiles and `verify` enforces it; determinism; the CLI flag.
 */
import { describe, it, expect } from 'vitest'
import { mine, compileRuleset, caseToExtraction, buildGrammar, learnConst, AP_MINE_SCHEMA, verify, type MineSchema, type MineCase } from '../src/index'
import type { PreparedCase } from '../src/mine/grammar'
import { parseMineArgs, mineFromJsonl } from '../src/cli'

const NOW = () => new Date('2026-09-24T00:00:00Z')
const pc = (id: string, hold: boolean, x: number | null): PreparedCase => ({ id, label: hold ? 'hold' : 'ok', hold, fields: x === null ? {} : { x }, lines: null })
const table = (approves: (number | null)[], holds: (number | null)[]): PreparedCase[] => [
  ...approves.map((x, i) => pc(`A${i}`, false, x)),
  ...holds.map((x, i) => pc(`H${i}`, true, x)),
]
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('learnConst: the constrained minimum-error cut', () => {
  it('separable data: the gap between the classes, with c at its midpoint', () => {
    const r = learnConst('x', 'high', table(range(1, 10), range(20, 30)), 0)
    expect(r).toEqual({ ok: true, learned: { c: 15, lo: 10, hi: 20, approved: 0, missed: 0 } })
    const low = learnConst('x', 'low', table(range(20, 30), range(1, 10)), 0)
    expect(low).toEqual({ ok: true, learned: { c: 15, lo: 10, hi: 20, approved: 0, missed: 0 } })
  })

  it('the wrong direction is INCONSISTENT at rate 0 (every cut makes an approval violate)', () => {
    expect(learnConst('x', 'low', table(range(1, 10), range(20, 30)), 0)).toEqual({ ok: false, fate: 'INCONSISTENT', detail: 'approved cases violate it at every cut' })
  })

  it('exceptions above the cut do not drag it down (no spending of the allowed exceptions)', () => {
    // 100 approvals at 1..100 plus 2 exceptions far above; holds at 200..300; rate 0.05 allows floor(0.05 × 102) = 5
    const cases = table([...range(1, 100), 500, 600], range(200, 300))
    const r = learnConst('x', 'high', cases, 0.05)
    expect(r).toEqual({ ok: true, learned: { c: 150, lo: 100, hi: 200, approved: 2, missed: 0 } })
    // "the smallest consistent c" would have spent 3 more exceptions and cut at 97.5, inside the approvals
  })

  it('a stale hold below the cut is missed, not chased', () => {
    const r = learnConst('x', 'high', table(range(1, 100), [50, ...range(200, 300)]), 0.05)
    expect(r.ok && r.learned).toMatchObject({ c: 150, lo: 100, hi: 200, missed: 1, approved: 0 })
  })

  it('ties in error go to fewer approved violators', () => {
    // approvals 1,2,3,5; holds 4,6,7. Cut 3|4 → 1 approved + 0 missed; cut 5|6 → 0 approved + 1 missed. Both err 1.
    const r = learnConst('x', 'high', table([1, 2, 3, 5], [4, 6, 7]), 0.25)
    expect(r.ok && r.learned).toMatchObject({ c: 5.5, lo: 5, hi: 6, approved: 0, missed: 1 })
  })

  it('the consistency limit is a constraint on the cut, not a tie-breaker', () => {
    // approvals 1..10 and 12, 13; holds 11, 11.5, 11.7 and 14..20.
    // Unconstrained best: cut 10|11 (2 approved + 0 missed = 2). Next: cut 13|14 (0 approved + 3 missed = 3).
    const cases = table([...range(1, 10), 12, 13], [11, 11.5, 11.7, ...range(14, 20)])
    // rate 0.2 allows floor(0.2 × 12) = 2 approved violators: the unconstrained best is feasible
    expect(learnConst('x', 'high', cases, 0.2)).toEqual({ ok: true, learned: { c: 10.5, lo: 10, hi: 11, approved: 2, missed: 0 } })
    // at rate 0 it is not: the best feasible cut is 13|14, even though its error is larger
    expect(learnConst('x', 'high', cases, 0)).toEqual({ ok: true, learned: { c: 13.5, lo: 13, hi: 14, approved: 0, missed: 3 } })
  })

  it('missing values are undecidable; fewer than two distinct values is VOID', () => {
    const r = learnConst('x', 'high', table([...range(1, 10), null], [null, ...range(20, 30)]), 0)
    expect(r.ok && r.learned.c).toBe(15)
    expect(learnConst('x', 'high', table([null], [null]), 0)).toEqual({ ok: false, fate: 'VOID', detail: 'no case could evaluate it (values missing)' })
    expect(learnConst('x', 'high', table([5, 5], [5]), 0)).toEqual({ ok: false, fate: 'VOID', detail: 'fewer than two distinct values: no cut to learn' })
  })

  it('adjacent doubles: the midpoint never lands on an endpoint (the partition is kept)', () => {
    const lo = 1, hi = 1 + Number.EPSILON
    const r = learnConst('x', 'high', table([lo], [hi]), 0)
    expect(r.ok && r.learned).toMatchObject({ lo, hi, c: lo }) // X <= c with c = lo: hi violates, lo does not
    const l = learnConst('x', 'low', table([hi], [lo]), 0)
    expect(l.ok && l.learned).toMatchObject({ lo, hi, c: hi }) // c <= X with c = hi: lo violates, hi does not
  })
})

// ── a filer-status table: a float of $700M or more ⇒ LAF (hold). Deterministic noise on both sides. ──────────────────
const M = 1_000_000
const FILER_SCHEMA: MineSchema = { approve: ['2-ACC', '4-NON'], fields: { float: { type: 'money' }, revenue: { type: 'money' } } }
function filers(): MineCase[] {
  const out: MineCase[] = []
  const wobble = (i: number): number => 0.3 + ((i * 37) % 100) / 100 // revenue/float in [0.3, 1.3): correlated, noisy
  for (let i = 0; i < 300; i++) { const f = 1 * M + i * 2.3 * M; out.push({ id: `N${String(i).padStart(3, '0')}`, label: f < 75 * M ? '4-NON' : '2-ACC', fields: { float: f, revenue: Math.round(f * wobble(i)) } }) }
  for (let i = 0; i < 120; i++) { const f = 705 * M + i * 50 * M; out.push({ id: `L${String(i).padStart(3, '0')}`, label: '1-LAF', fields: { float: f, revenue: Math.round(f * wobble(i + 7)) } }) }
  // noise: three first-year registrants with big floats (not LAF yet), two stale LAF labels below the cut, one missing float
  out.push({ id: 'X-IPO1', label: '4-NON', fields: { float: 900 * M, revenue: 50 * M } })
  out.push({ id: 'X-IPO2', label: '4-NON', fields: { float: 2_000 * M, revenue: 80 * M } })
  out.push({ id: 'X-IPO3', label: '4-NON', fields: { float: 5_000 * M, revenue: 300 * M } })
  out.push({ id: 'X-STALE1', label: '1-LAF', fields: { float: 400 * M, revenue: 900 * M } })
  out.push({ id: 'X-STALE2', label: '1-LAF', fields: { float: 500 * M, revenue: 1_200 * M } })
  out.push({ id: 'X-NOFLOAT', label: '2-ACC', fields: { revenue: 10 * M } })
  return out
}

describe('end to end: rediscovering a filer-status threshold', () => {
  const r = mine({ cases: filers() }, FILER_SCHEMA, { thresholds: true, maxApprovedViolationRate: 0.02 })

  it('the first candle is the float threshold; its interval brackets $700M tightly', () => {
    const first = r.candles[0]!
    expect(first.id).toBe('C float <= c')
    expect(first.family).toBe('C')
    expect(first.interval!.lo).toBeLessThan(700 * M)
    expect(first.interval!.hi).toBe(705 * M)
    expect(first.interval!.hi - first.interval!.lo).toBeLessThan(70 * M)
    expect(first.c).toBe(first.interval!.lo + (first.interval!.hi - first.interval!.lo) / 2)
    expect(first.spec).toEqual({ scope: 'document', form: 'rel', op: '<=', left: { field: 'float' }, right: { const: first.c }, eps: 0 })
    expect(first).toMatchObject({ holds: 120, approved: 3, decidable: 425, decidable_holds: 122 })
    expect(first.violator_labels).toEqual({ '1-LAF': 120, '4-NON': 3 })
  })

  it('the noise is visible, not absorbed: the stale labels stay unexplained by the float rule', () => {
    expect(r.candles[0]!.violators).not.toContain('X-STALE1')
    expect(r.candles[0]!.violators).toEqual(expect.arrayContaining(['X-IPO1', 'X-IPO2', 'X-IPO3']))
  })

  it('the correlated distractor never outranks the true field', () => {
    const rev = [...r.candles, ...r.morgue].filter((j) => j.id.startsWith('C revenue'))
    expect(rev.length).toBe(2)
    for (const j of rev) expect(r.candles.indexOf(j)).not.toBe(0)
  })

  it('the rule compiles, lints clean, and verify enforces it (decision = the label, except the listed noise)', () => {
    const comp = compileRuleset({ ...r, candles: [r.candles[0]!] })
    expect(comp.complete).toBe(true)
    expect(comp.lint.ok).toBe(true)
    expect(comp.ruleset.checks[0]).toMatchObject({ left: 'float', op: '<=', right: String(r.candles[0]!.c), tol: 0 })
    const noise = new Set(['X-IPO1', 'X-IPO2', 'X-IPO3', 'X-STALE1', 'X-STALE2'])
    for (const c of filers()) {
      const v = verify(caseToExtraction(c), { ruleset: comp.ruleset, now: NOW })
      if (c.id === 'X-NOFLOAT') { expect(v.outcome).toBe('INSUFFICIENT_DATA'); continue }
      const lawful = c.label === '1-LAF' ? 'FAIL' : 'PASS'
      expect(v.outcome === lawful, c.id).toBe(!noise.has(c.id))
    }
  })

  it('deterministic: reversing the rows gives the same candles and the same c', () => {
    const rev = mine({ cases: filers().reverse() }, FILER_SCHEMA, { thresholds: true, maxApprovedViolationRate: 0.02 })
    expect(JSON.stringify(rev.candles)).toBe(JSON.stringify(r.candles))
    expect(JSON.stringify(rev.morgue)).toBe(JSON.stringify(r.morgue))
  })
})

describe('opt-in', () => {
  it('off by default: the AP grammar is the prototype grammar (30 forms); on, it adds 2 per numeric document field', () => {
    expect(buildGrammar(AP_MINE_SCHEMA).length).toBe(30)
    const on = buildGrammar(AP_MINE_SCHEMA, undefined, { thresholds: true })
    const numericDocFields = Object.values(AP_MINE_SCHEMA.fields).filter((f) => f.type === 'qty' || f.type === 'money').length
    expect(on.length).toBe(30 + 2 * numericDocFields)
    expect(on.slice(0, 30).map((g) => g.id)).toEqual(buildGrammar(AP_MINE_SCHEMA).map((g) => g.id))
    expect(on.slice(30).every((g) => g.family === 'C' && g.learnConst)).toBe(true)
  })

  it('mine() without thresholds never proposes a C candidate', () => {
    const r = mine({ cases: filers() }, FILER_SCHEMA, { maxApprovedViolationRate: 0.02 })
    expect([...r.candles, ...r.morgue].some((j) => j.family === 'C')).toBe(false)
    expect(r.options.thresholds).toBe(false)
  })

  it('the CLI flag', () => {
    expect(parseMineArgs(['cases.jsonl', '--schema', 's.json', '--thresholds']).thresholds).toBe(true)
    expect(parseMineArgs(['cases.jsonl', '--schema', 's.json']).thresholds).toBe(false)
    const jsonl = filers().map((c) => JSON.stringify(c)).join('\n')
    const out = mineFromJsonl(jsonl, { schema: FILER_SCHEMA, thresholds: true, maxApprovedViolationRate: 0.02 })
    expect(out.report.candles[0]!.id).toBe('C float <= c')
    expect(out.compiled.checks[0]).toEqual({ code: 'M1', candle: 'C float <= c' })
  })
})
