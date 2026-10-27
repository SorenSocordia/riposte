/**
 * The bench table format (src/bench/table.ts): intervals by the named method, verdicts against the preregistered bar,
 * descriptive rows, refusals of malformed rows, the tuning slot, and the shape check.
 */
import { describe, it, expect } from 'vitest'
import { ci95, makeRow, meets, rerunProblems, rerunWords, rowVerdict, tableProblems, tuningProblems, BENCH_FORMAT, type BenchTable } from '../src/bench/table'
import { specProblems } from '../src/bench/spec'
import { verdictCell } from '../src/bench/docs'

describe('intervals (95% two-sided, outward-rounded at 1e-6)', () => {
  it('Wilson matches the reference values', () => {
    const [lo0, hi0] = ci95(0, 20, 'wilson')
    expect(lo0).toBe(0)
    expect(hi0).toBeCloseTo(0.1611, 4)
    const [lo, hi] = ci95(196, 200, 'wilson') // the s4-bpi2019 table's audited precision, as its own report states it
    expect(lo).toBeCloseTo(0.9497, 4)
    expect(hi).toBeCloseTo(0.9922, 4)
  })

  it('Clopper-Pearson matches the reference values', () => {
    const [lo0, hi0] = ci95(0, 20, 'clopper-pearson')
    expect(lo0).toBe(0)
    expect(hi0).toBeCloseTo(0.1684, 4)
    const [lo, hi] = ci95(10, 20, 'clopper-pearson')
    expect(lo).toBeCloseTo(0.2720, 4)
    expect(hi).toBeCloseTo(0.7280, 4)
  })

  it('n = 0 is the honest [0, 1]', () => {
    expect(ci95(0, 0, 'wilson')).toEqual([0, 1])
    expect(ci95(0, 0, 'clopper-pearson')).toEqual([0, 1])
  })
})

describe('rows and verdicts', () => {
  const bar0 = { text: '0 wrong PASS on the 20 planted defects', test: { k: { eq: 0 } } }

  it('computes rate, interval and verdict; the method is named on the row', () => {
    const r = makeRow({ claim: 'planted defects certified PASS', n: 20, k: 0, method: 'wilson', bar: bar0 })
    expect(r).toMatchObject({ n: 20, k: 0, rate: 0, method: 'wilson', verdict: 'PASS' })
    const f = makeRow({ claim: 'planted defects certified PASS', n: 20, k: 11, method: 'wilson', bar: bar0 })
    expect(f.verdict).toBe('FAIL')
    expect(f.rate).toBe(0.55)
  })

  it('a row with no bar is descriptive and reads INSUFFICIENT; so does n = 0', () => {
    const d = makeRow({ claim: 'controls PASS', n: 20, k: 6, method: 'wilson' })
    expect(d.verdict).toBe('INSUFFICIENT')
    expect(d.note).toMatch(/descriptive: no preregistered bar/)
    const z = makeRow({ claim: 'profiles computed', n: 0, k: 0, method: 'wilson', bar: { text: 'agree within tolerance', test: { rate: { ge: 0.9 } } } })
    expect(z.verdict).toBe('INSUFFICIENT')
    expect(z.rate).toBeNull()
  })

  it('a row held to a bar written for another run has no verdict of its own: POST-HOC, whatever the counts, and the cell says whose bar', () => {
    const reused = { ...bar0, reused_from: 'the e-invoice PDF run\'s prereg' }
    const met = makeRow({ claim: 'planted defects certified PASS', n: 20, k: 0, method: 'wilson', bar: reused })
    expect(met.verdict).toBe('POST-HOC')
    expect(met.note).toMatch(/post-hoc: the bar was written for the e-invoice PDF run's prereg, not for this run, so the row has no verdict; its counts meet that bar's test/)
    const missed = makeRow({ claim: 'planted defects certified PASS', n: 20, k: 3, method: 'wilson', bar: reused })
    expect(missed.verdict).toBe('POST-HOC')
    expect(missed.note).toMatch(/its counts do not meet that bar's test/)
    expect(makeRow({ claim: 'x', n: 0, k: 0, method: 'wilson', bar: reused }).verdict).toBe('INSUFFICIENT')
    expect(verdictCell(met)).toBe('post-hoc (no bar of its own; the e-invoice PDF run\'s prereg reused)')
    expect(verdictCell(makeRow({ claim: 'x', n: 20, k: 0, method: 'wilson', bar: bar0 }))).toBe('PASS')
    expect(() => makeRow({ claim: 'x', n: 20, k: 0, method: 'wilson', bar: { ...bar0, reused_from: ' ' } })).toThrow(/reused_from, when given, names whose bar it is/)
    const spec = { spec: 'bench-spec/1', id: 's', title: 'S', adapter: 'summary', label: 'post-hoc', blind: false, run: { id: 'r', date: '2026-10-03' }, rows: [{ claim: 'c', method: 'wilson', n: 20, k: 0, bar: { ...bar0, reused_from: '' } }] }
    expect(specProblems(spec).join('; ')).toMatch(/bar\.reused_from, when given, names whose bar it is/)
  })

  it('a rerun record says what a rerun reproduces, in the words the page prints', () => {
    expect(rerunWords({ from_tree: 'yes', detail: 'd', identical: 'outcomes' })).toBe('yes, with identical outcomes; verdict ids differ until a release pins the engine label')
    expect(rerunWords({ from_tree: 'yes', detail: 'd', identical: 'bytes' })).toBe('yes, byte for byte')
    expect(rerunWords({ from_tree: 'partly', detail: 'd' })).toBe('partly')
    expect(rerunProblems({ from_tree: 'yes', detail: 'd', identical: 'outcomes' })).toEqual([])
    expect(rerunProblems({ from_tree: 'yes', detail: 'd', identical: 'mostly' }).join('; ')).toMatch(/identical, when given, is one of bytes, outcomes/)
    expect(rerunProblems({ from_tree: 'no', detail: 'd', identical: 'bytes' }).join('; ')).toMatch(/a run that does not rerun carries none/)
  })

  it('bars test k, n, rate and the interval edges, with "$n", all and any', () => {
    const v = { k: 196, n: 200, rate: 0.98, ci95: ci95(196, 200, 'wilson') }
    expect(meets({ ci_lo: { ge: 0.8 } }, v)).toBe(true)
    expect(meets({ k: { eq: '$n' } }, v)).toBe(false)
    expect(meets({ all: [{ k: { ge: 190 } }, { rate: { gt: 0.95 } }] }, v)).toBe(true)
    expect(meets({ any: [{ k: { eq: 0 } }, { ci_hi: { lt: 0.5 } }] }, v)).toBe(false)
    expect(rowVerdict({ text: 'all replay', test: { k: { eq: '$n' } } }, { k: 58, n: 58, rate: 1, ci95: [0.9, 1] })).toBe('PASS')
  })

  it('refuses a row without a CI method, with k > n, or with a malformed bar', () => {
    expect(() => makeRow({ claim: 'x', n: 20, k: 0 })).toThrow(/no CI method/)
    expect(() => makeRow({ claim: 'x', n: 20, k: 0, method: 'normal' })).toThrow(/unknown CI method/)
    expect(() => makeRow({ claim: 'x', n: 20, k: 21, method: 'wilson' })).toThrow(/k must be an integer in \[0, n\]/)
    expect(() => makeRow({ claim: 'x', n: 2.5, k: 0, method: 'wilson' })).toThrow(/n must be an integer/)
    expect(() => makeRow({ claim: 'x', n: 20, k: 0, method: 'wilson', bar: { text: 'bar', test: { kk: { eq: 0 } } as never } })).toThrow(/unknown field/)
    expect(() => makeRow({ claim: 'x', n: 20, k: 0, method: 'wilson', bar: { text: '', test: { k: { eq: 0 } } } })).toThrow(/preregistered text/)
  })
})

describe('the tuning slot (Φ2: designed, not produced here)', () => {
  const ok = { knob: 'similarity', range: [0.5, 0.9] as [number, number], objective: 'max controls PASS s.t. known-bad PASS = 0', heldout: 'half B', trace: [{ x: 0.65, objective: 12 }, { x: 0.75, objective: 14 }], chosen: 0.75 }
  it('accepts a tuned value that travels with its trace', () => expect(tuningProblems(ok)).toEqual([]))
  it('refuses a tuned value without its trace, outside its range, or not among the evaluated points', () => {
    expect(tuningProblems({ ...ok, trace: [] }).join()).toMatch(/never alone/)
    expect(tuningProblems({ ...ok, trace: [{ x: 0.95, objective: 1 }], chosen: 0.95 }).join()).toMatch(/outside the declared range/)
    expect(tuningProblems({ ...ok, chosen: 0.7 }).join()).toMatch(/one of the evaluated points/)
  })
})

describe('the shape check', () => {
  const H = (c: string): string => c.repeat(64)
  const good = (): BenchTable => ({
    format: BENCH_FORMAT, id: 'demo-table', title: 'A demo table',
    prereg: { path: 'PREREG.md', sha256: H('b'), frozen_sha256: H('a'), amendments: [{ sha256: H('b'), recorded_in: 'PREREG.sha256' }] },
    run: { id: 'run 1', date: '2026-10-03', engine_version: '0.5.0', ruleset: 'demo@1.0.0', results: { path: 'results.json', sha256: H('c') } },
    rows: [makeRow({ claim: 'wrong PASS', n: 20, k: 0, method: 'wilson', bar: { text: 'k = 0', test: { k: { eq: 0 } } } })],
    misses: [{ id: 'M1', kind: 'false-fail', description: 'a defect', post_hoc: false }],
    blind: true, label: 'blind',
  })

  it('a well-formed table has no problems', () => expect(tableProblems(good())).toEqual([]))

  it('names every broken invariant', () => {
    const t = good() as unknown as Record<string, unknown>
    expect(tableProblems({ ...t, prereg: undefined }).join()).toMatch(/never written/)
    expect(tableProblems({ ...t, prereg: { ...(t.prereg as object), sha256: H('d') } }).join()).toMatch(/last hash of the chain/)
    expect(tableProblems({ ...t, label: 'post-hoc' }).join()).toMatch(/blind: true goes with label "blind" only/)
    expect(tableProblems({ ...t, label: 'transcribed', blind: false }).join()).toMatch(/names the report/)
    const row = (t.rows as Record<string, unknown>[])[0]!
    expect(tableProblems({ ...t, rows: [{ ...row, verdict: 'FAIL' }] }).join()).toMatch(/does not recompute/)
    expect(tableProblems({ ...t, rows: [{ ...row, ci95: [0, 0.5] }] }).join()).toMatch(/rate or ci95 does not recompute/)
    const run = t.run as Record<string, unknown>
    const edited = { file: 'harness/run.ts', recorded_sha256: H('e'), sha256: H('f'), reason: 'a comment line rewritten' }
    expect(tableProblems({ ...t, run: { ...run, shipped_edited: [edited], blind_basis: 'PREREG.sha256 records the prereg at 14:00Z' } })).toEqual([])
    expect(tableProblems({ ...t, run: { ...run, shipped_edited: [{ ...edited, sha256: H('e') }] } }).join()).toMatch(/the shipped bytes are the recorded ones/)
    expect(tableProblems({ ...t, run: { ...run, shipped_edited: [{ ...edited, reason: '' }] } }).join()).toMatch(/shipped_edited\[0\] must be \{ file, recorded_sha256, sha256, reason \}/)
    expect(tableProblems({ ...t, label: 'post-hoc', blind: false, run: { ...run, blind_basis: 'a record' } }).join()).toMatch(/blind_basis goes with label "blind" only/)
    expect(tableProblems({ ...t, run: { ...run, blind_basis: ' ' } }).join()).toMatch(/blind_basis, when given, names the record/)
    expect(tableProblems({ ...t, misses: [{ id: 'M1', kind: 'x', description: 'y', post_hoc: false }, { id: 'M1', kind: 'x', description: 'y', post_hoc: false }] }).join()).toMatch(/duplicate id/)
  })
})
