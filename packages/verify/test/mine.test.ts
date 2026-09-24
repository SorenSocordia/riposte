/**
 * Rule mining (src/mine): the product form of the Oracle-AP prototype.
 *
 *  - unit tests for each judge, including the approved-exception path and its enrichment null;
 *  - REGRESSION: on Distil Labs' public AP set (data/real/D-ap-distil, Apache-2.0) via the AP adapter, the product miner
 *    reproduces the frozen prototype output (test/fixtures/oracle-ap-prototype.json) exactly. That covers every fate, t, k,
 *    p and violator set: 4/4 true rules candled, 0 false candles, price t = 0.02, 68/68 holds explained;
 *  - determinism (byte-identical JSON; row order does not change the rules);
 *  - the compiled ruleset: `verify` enforcing the mined rules agrees with the gold pay/hold decision wherever it decides;
 *  - the two additive declarative extensions (field kinds 'bool' / 'identifier', compare: 'identifier');
 *  - the CLI (`verify mine`).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mine, compileRuleset, caseToExtraction, apCasesToTable, AP_MINE_SCHEMA, buildGrammar, verify, verifyDeclarative, lintRuleset,
  hypergeomAllHolds, hypergeomUpperTail, groundingP, tally, learnT, judgeConsistency, judgeGrounding, judgeNovelty, parseJsonl,
  type MineSchema, type MineCase, type CaseTable, type DeclarativeRuleset, type Verdict, type JudgedCandidate,
} from '../src/index'
import { violated, type PreparedCase } from '../src/mine/grammar'
import { run, parseMineArgs, mineFromJsonl, type CliIO } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const AP_PATH = join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl')
const AP_TEXT = readFileSync(AP_PATH, 'utf8')
const AP_ROWS = parseJsonl(AP_TEXT) as { id: string; input: string; decision: string }[]
const PROTO = JSON.parse(readFileSync(join(HERE, 'fixtures', 'oracle-ap-prototype.json'), 'utf8')) as {
  prereg_sha256: string; n: number; holds: number; excluded: number
  judged: { id: string; t?: number; fate: string; k: number; p: number; detail: string; violators: string[] }[]
}
const NOW = () => new Date('2026-09-24T00:00:00Z')
const sorted = (a: readonly string[]) => [...a].sort()

// ── exact rational reference for the hypergeometric (BigInt), to check the float implementations ─────────────────────
const bc = (n: number, r: number): bigint => {
  if (r < 0 || r > n) return 0n
  let x = 1n
  for (let i = 1; i <= r; i++) x = (x * BigInt(n - r + i)) / BigInt(i)
  return x
}
const exactTail = (N: number, H: number, k: number, h: number): number => {
  let num = 0n
  for (let x = Math.max(h, 0); x <= Math.min(k, H); x++) num += bc(H, x) * bc(N - H, k - x)
  const den = bc(N, k)
  // scale to 1e18 before dividing so the ratio keeps ~18 significant digits
  return Number((num * 10n ** 18n) / den) / 1e18
}

// ── prototype-id → product-id (field names are product names; the grammar is the same) ─────────────────────────────
const TOKENS: [RegExp, string][] = [[/\bq_inv\b/g, 'inv_qty'], [/\bq_po\b/g, 'po_qty'], [/\bq_rcv\b/g, 'rcv_qty'], [/\bp_inv\b/g, 'inv_price'], [/\bp_po\b/g, 'po_price'], [/\ba_inv\b/g, 'inv_amount']]
const EXPLICIT: Record<string, string> = {
  'D T = S': 'D total = sum(inv_amount)',
  'D T = S + F': 'D total = sum(inv_amount) + freight',
  'D T = S + F*[A]': 'D total = sum(inv_amount) + freight*[freight_allowed]',
  'D T <= P': 'D total <= sum(po_qty*po_price)',
  'D T = P': 'D total = sum(po_qty*po_price)',
  'D F = 0': 'D freight <= 0',
  'D F*[not A] = 0': 'D freight*[not freight_allowed] <= 0',
  'D S <= P': 'D sum(inv_amount) <= sum(po_qty*po_price)',
  'I1 invoice cites exactly one PO number = PO': 'I1 inv_po_numbers cites exactly one id = po_number',
}
const toProduct = (protoId: string): string => EXPLICIT[protoId] ?? TOKENS.reduce((s, [re, r]) => s.replace(re, r), protoId)
const TRUE_RULES: Record<string, (j: JudgedCandidate) => boolean> = {
  'R1 PO match': (j) => j.id === 'I1 inv_po_numbers cites exactly one id = po_number',
  'R2 qty <= received': (j) => j.id === 'L1 inv_qty <= rcv_qty',
  'R3 price <= PO*(1+2%)': (j) => j.id === 'L3 inv_price <= po_price*(1+t)' && j.t !== undefined && j.t >= 0.02 && j.t < 0.03,
  'R4 total = sum + allowed freight': (j) => j.id === 'D total = sum(inv_amount) + freight*[freight_allowed]',
}

const AP_TABLE = apCasesToTable(AP_ROWS)
const AP_REPORT = mine(AP_TABLE, AP_MINE_SCHEMA)
const allJudged = (r = AP_REPORT): JudgedCandidate[] => [...r.candles, ...r.morgue]

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('stats: the exact grounding null', () => {
  it('all-holds product = C(H,k)/C(N,k) exactly (the prototype numbers)', () => {
    expect(hypergeomAllHolds(100, 68, 14)).toBe(0.0027889297675125846)
    expect(hypergeomAllHolds(100, 68, 0)).toBe(1)
    for (const [N, H, k] of [[20, 8, 3], [30, 20, 10], [100, 68, 22]] as const) {
      expect(hypergeomAllHolds(N, H, k)).toBeCloseTo(exactTail(N, H, k, k), 15)
    }
  })

  it('upper tail P(X >= h) matches the exact rational sum for every h (N=20, H=8, all k)', () => {
    for (let k = 0; k <= 20; k++) for (let h = 0; h <= 9; h++) {
      const want = exactTail(20, 8, k, h), got = hypergeomUpperTail(20, 8, k, h)
      expect(Math.abs(got - want), `k=${k} h=${h}`).toBeLessThanOrEqual(1e-12 + 1e-10 * want)
    }
  })

  it('tail edges: h at or below the minimum possible → 1; above min(k,H) → 0; bad args throw', () => {
    expect(hypergeomUpperTail(100, 68, 40, 8)).toBe(1) // X >= 40 - 32 = 8 always
    expect(hypergeomUpperTail(100, 68, 20, 21)).toBe(0)
    expect(() => hypergeomUpperTail(10, 11, 3, 1)).toThrow(RangeError)
  })

  it('groundingP: the prototype product when h = k; the enrichment tail when approved exceptions exist', () => {
    expect(groundingP(100, 68, 22, 22)).toBe(hypergeomAllHolds(100, 68, 22))
    const withException = groundingP(100, 68, 22, 21)
    expect(withException).toBe(hypergeomUpperTail(100, 68, 22, 21))
    // the all-holds formula would be anti-conservative here: it is the probability of a STRICTLY more extreme event
    expect(hypergeomAllHolds(100, 68, 22)).toBeLessThan(withException)
    expect(withException).toBeCloseTo(exactTail(100, 68, 22, 21), 12)
  })
})

// ── a small synthetic line-comparison table for the judges ─────────────────────────────────────────────────────────
const QSCHEMA: MineSchema = { approve: 'ok', lines: { billed: { type: 'qty' }, received: { type: 'qty' } }, fields: {} }
const qcase = (id: string, label: string, billed: number | null, received: number | null): MineCase =>
  ({ id, label, fields: {}, lines: [{ ...(billed === null ? {} : { billed }), ...(received === null ? {} : { received }) }] })
const prep = (c: MineCase, approve = 'ok'): PreparedCase => ({ id: c.id, label: c.label, hold: c.label !== approve, fields: c.fields, lines: c.lines ?? null })
const LE = { scope: 'line' as const, form: 'le' as const, x: 'billed', y: 'received', eps: 1e-9 }
const pad = (n: number) => String(n).padStart(3, '0')

/** 40 approvals (billed = received, except `exceptions` of them billed 2×), 30 holds (25 over-billed, 5 not). */
function exceptionTable(exceptions: number): CaseTable {
  const cases: MineCase[] = []
  for (let i = 0; i < 40; i++) cases.push(qcase(`A${pad(i)}`, 'ok', i < exceptions ? 20 : 10, 10))
  for (let i = 0; i < 30; i++) cases.push(qcase(`H${pad(i)}`, 'hold', i < 25 ? 15 : 10, 10))
  return { cases }
}

describe('judges', () => {
  it('tally: three-valued. Undecidable cases are left out of the null (N, H)', () => {
    const cases = [qcase('a', 'ok', 1, 1), qcase('b', 'hold', 3, 1), qcase('c', 'hold', null, 1), qcase('d', 'ok', 2, 1)].map((c) => prep(c))
    const t = tally(LE, cases)
    expect(t).toEqual({ decidable: 3, decidableHolds: 1, violators: ['b', 'd'], holdViolators: ['b'], approved: 1 })
    expect(violated(LE, prep({ id: 'z', label: 'ok', fields: {} }))).toBeNull() // no line data at all → undecidable
    expect(violated(LE, prep({ id: 'z', label: 'ok', fields: {}, lines: [] }))).toBe(false) // zero lines → vacuously holds
  })

  it('CONSISTENCY: with rate 0 one approved violator kills; with a rate, floor(rate × approvals) are tolerated', () => {
    const base = { decidable: 60, decidableHolds: 40, violators: [], holdViolators: [] } // 20 approvals
    expect(judgeConsistency({ ...base, approved: 0 }, 0)).toEqual({ ok: true })
    expect(judgeConsistency({ ...base, approved: 1 }, 0)).toEqual({ ok: false, detail: '1 approved case(s) violate it' })
    expect(judgeConsistency({ ...base, approved: 2 }, 0.1).ok).toBe(true) // 2/20 = 10%
    const dead = judgeConsistency({ ...base, approved: 3 }, 0.1)
    expect(dead.ok).toBe(false)
    expect(!dead.ok && dead.detail).toMatch(/3\/20 > max rate 0\.1/)
  })

  it('CONSISTENCY learns t: the smallest grid value no approval violates (and with exceptions, a smaller one)', () => {
    const spec = { scope: 'line' as const, form: 'le_tol' as const, x: 'inv', y: 'po', eps: 0.005 }
    const mk = (id: string, label: string, inv: number): PreparedCase => ({ id, label, hold: label !== 'ok', fields: {}, lines: [{ inv, po: 100 }] })
    const approved = [100, 100.5, 101, 101.5].map((v, i) => mk(`a${i}`, 'ok', v))
    const grid = [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1]
    expect(learnT(spec, approved, grid, 0)).toBe(0.02) // 101.5 > 101.005 at 1%; ≤ 102.005 at 2%
    const withOutlier = [...approved, mk('a9', 'ok', 104)]
    expect(learnT(spec, withOutlier, grid, 0)).toBe(0.05)
    expect(learnT(spec, withOutlier, grid, 0.2)).toBe(0.02) // 1 of 5 approvals may violate
    expect(learnT(spec, [mk('x', 'ok', 200)], grid, 0)).toBeUndefined()
  })

  it('GROUNDING: VOID / BASE_RATE (too few holds, or p too large) / GROUNDED, with the prototype detail strings', () => {
    const g = { minHoldViolators: 5, maxP: 0.01 }
    const T = (k: number, h: number, N = 100, H = 68) => ({ decidable: N, decidableHolds: H, violators: Array.from({ length: k }, (_, i) => `v${i}`), holdViolators: Array.from({ length: h }, (_, i) => `v${i}`), approved: k - h })
    expect(judgeGrounding(T(0, 0), g)).toEqual({ fate: 'VOID', p: 1, detail: 'no case violates it (always true here)' })
    expect(judgeGrounding({ ...T(0, 0), decidable: 0, decidableHolds: 0 }, g).detail).toBe('no case could evaluate it (values missing)')
    expect(judgeGrounding(T(6, 6), g)).toEqual({ fate: 'BASE_RATE', p: hypergeomAllHolds(100, 68, 6), detail: 'k=6, p=9.18e-2 (gate k>=5, p<=0.01)' })
    expect(judgeGrounding(T(4, 4, 100, 5), g).fate).toBe('BASE_RATE') // p is tiny but only 4 holds
    expect(judgeGrounding(T(14, 14), g)).toEqual({ fate: 'GROUNDED', p: 0.0027889297675125846, detail: '' })
  })

  it('GROUNDING with approved exceptions uses the enrichment tail, never the all-holds formula', () => {
    const t = { decidable: 100, decidableHolds: 68, violators: Array.from({ length: 22 }, (_, i) => `v${i}`), holdViolators: Array.from({ length: 21 }, (_, i) => `v${i}`), approved: 1 }
    const r = judgeGrounding(t, { minHoldViolators: 5, maxP: 0.01 })
    expect(r.p).toBe(hypergeomUpperTail(100, 68, 22, 21))
    expect(r.p).not.toBe(hypergeomAllHolds(100, 68, 22))
    expect(r.fate).toBe('GROUNDED')
    // an enrichment that is not there (violators at the base rate) is not grounded, however many there are
    const flat = { decidable: 100, decidableHolds: 68, violators: Array.from({ length: 30 }, (_, i) => `v${i}`), holdViolators: Array.from({ length: 21 }, (_, i) => `v${i}`), approved: 9 }
    const f = judgeGrounding(flat, { minHoldViolators: 5, maxP: 0.01 })
    expect(f.fate).toBe('BASE_RATE')
    expect(f.detail).toMatch(/^k=30 \(21 holds, 9 approved\), p=/)
  })

  it('NOVELTY: greedy by hold coverage, grammar order breaks ties, >= 3 new holds', () => {
    const r = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => `h${a + i}`)
    const { decisions, covered } = judgeNovelty([
      { index: 0, id: 'small', holdViolators: r(20, 23) }, // 3 new → candle (last)
      { index: 1, id: 'big', holdViolators: r(0, 10) },
      { index: 2, id: 'overlap', holdViolators: [...r(0, 9), 'h11'] }, // 10 holds but only 1 new → redundant
      { index: 3, id: 'tie', holdViolators: r(10, 20) }, // 10 holds, ties with index 1/2 → after them
    ], 3)
    expect(decisions.map((d) => [d.index, d.fate, d.newHolds])).toEqual([[1, 'CANDLE', 10], [2, 'REDUNDANT', 1], [3, 'CANDLE', 10], [0, 'CANDLE', 3]])
    expect(decisions[1]!.detail).toBe('only 1 new hold(s); covered by big')
    expect(covered.size).toBe(23)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('grammar from the schema', () => {
  it('the AP schema yields the prototype grammar exactly: 30 forms, 78 variants, same order', () => {
    const g = buildGrammar(AP_MINE_SCHEMA)
    expect(g.map((c) => c.id)).toEqual(PROTO.judged.map((j) => toProduct(j.id)))
    expect(g.reduce((a, c) => a + (c.tGrid?.length ?? 1), 0)).toBe(78)
    expect(AP_REPORT.grammar).toEqual({ forms: 30, variants: 78, strict_gate: 0.05 / 78 })
  })

  it('rejects schemas it cannot mine honestly', () => {
    expect(() => buildGrammar({ approve: 'ok', fields: { 'bad name': { type: 'qty' } } })).toThrow(/identifiers/)
    expect(() => buildGrammar({ approve: 'ok', fields: { sum: { type: 'qty' } } })).toThrow(/identifiers/)
    expect(() => buildGrammar({ approve: 'ok', fields: { t: { type: 'qty', role: 'total' } } })).toThrow(/role/)
    expect(() => buildGrammar({ approve: 'ok', fields: { a: { type: 'money' } }, lines: { a: { type: 'qty' } } })).toThrow(/twice/)
    expect(() => buildGrammar({ approve: '', fields: {} })).toThrow(/approve/)
    expect(() => mine({ cases: [{ id: 'x', label: 'ok', fields: {} }, { id: 'x', label: 'ok', fields: {} }] }, QSCHEMA)).toThrow(/duplicate id/)
    expect(() => mine({ cases: [{ id: 'x', fields: {} } as unknown as MineCase] }, QSCHEMA)).toThrow(/label/)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('REGRESSION: the product miner reproduces the Oracle-AP prototype on the Distil AP set', () => {
  it('the adapter extracts all 100 cases (68 hold / 32 approve), none excluded, no missing values', () => {
    expect(AP_ROWS.length).toBe(100)
    expect(AP_TABLE.excluded).toEqual([])
    expect(AP_REPORT.data).toMatchObject({ cases: PROTO.n, holds: PROTO.holds, approves: 32, excluded: [], missing: {}, subcent_money_fields: [] })
  })

  it('every candidate: same fate, t, k, p (bit-identical), violator set and cause of death as the frozen prototype', () => {
    const byId = new Map(allJudged().map((j) => [j.id, j]))
    expect(byId.size).toBe(30)
    for (const pj of PROTO.judged) {
      const j = byId.get(toProduct(pj.id))
      expect(j, pj.id).toBeDefined()
      expect(j!.fate, pj.id).toBe(pj.fate)
      expect(j!.t, pj.id).toBe(pj.t)
      expect(j!.k, pj.id).toBe(pj.k)
      expect(j!.p, pj.id).toBe(pj.p)
      expect(j!.violators, pj.id).toEqual(sorted(pj.violators))
      expect(j!.detail, pj.id).toBe(pj.detail.replace(/covered by (.+)$/, (_, id: string) => `covered by ${toProduct(id)}`))
    }
  })

  it('4/4 true rules candled, 0 false candles, price t = 0.02, 68/68 holds explained', () => {
    const found = Object.entries(TRUE_RULES).map(([name, f]) => ({ name, c: AP_REPORT.candles.find(f) }))
    expect(found.filter((f) => f.c).map((f) => f.name)).toEqual(Object.keys(TRUE_RULES))
    const falseCandles = AP_REPORT.candles.filter((c) => !Object.values(TRUE_RULES).some((f) => f(c)))
    expect(falseCandles).toEqual([])
    expect(AP_REPORT.candles.length).toBe(4)
    expect(AP_REPORT.candles.find(TRUE_RULES['R3 price <= PO*(1+2%)']!)!.t).toBe(0.02)
    expect(AP_REPORT.explained).toEqual({ holds: 68, of: 68, unexplained: [] })
  })

  it('candle detail: acceptance order, new holds, the strict gate, labels among violators, the t interval', () => {
    expect(AP_REPORT.candles.map((c) => [c.id, c.new_holds, c.strict])).toEqual([
      ['L3 inv_price <= po_price*(1+t)', 22, true],
      ['L1 inv_qty <= rcv_qty', 18, true],
      ['D total = sum(inv_amount) + freight*[freight_allowed]', 16, true],
      ['I1 inv_po_numbers cites exactly one id = po_number', 12, false], // p = 2.79e-3 > 0.05/78: fails the strict gate, as preregistered
    ])
    expect(AP_REPORT.candles[3]!.violator_labels).toEqual({ hold_no_po: 14 })
    expect(AP_REPORT.candles[0]!.violator_labels).toEqual({ hold_price: 19, hold_quantity: 3 })
    const iv = AP_REPORT.candles[0]!.interval!
    expect([(iv.lo! * 100).toFixed(2), (iv.hi! * 100).toFixed(2)]).toEqual(['1.90', '2.20']) // prototype: [1.90%, 2.20%)
    expect(AP_REPORT.candles[0]!.t!).toBeGreaterThanOrEqual(iv.lo!)
    expect(AP_REPORT.candles[0]!.t!).toBeLessThan(iv.hi!)
  })

  it('the adapter EXCLUDES what it cannot extract (counted, reported, never mined or guessed)', () => {
    const t = apCasesToTable([
      AP_ROWS[0]!,
      { id: 'X1', input: 'no section markers here', decision: 'approve' },
      { id: 'X2', input: AP_ROWS[1]!.input.replace(/PO-\d+ \| Vendor/, 'PO ??? | Vendor'), decision: 'hold_total' },
      null as unknown as { input: string; decision: string },
    ])
    expect(t.cases.map((c) => c.id)).toEqual(['T001'])
    expect(t.excluded).toEqual([
      { id: 'X1', label: 'approve', why: 'layout' },
      { id: 'X2', label: 'hold_total', why: 'PO number unreadable' },
      { id: '#4', label: '', why: 'not an object' },
    ])
    const r = mine(t, AP_MINE_SCHEMA)
    expect(r.data.cases).toBe(1)
    expect(r.data.excluded.length).toBe(3)
  })

  it('small approved-exception rates leave the AP result unchanged (4/4, 68/68)', () => {
    for (const rate of [0.03, 0.05, 0.1]) {
      const r = mine(AP_TABLE, AP_MINE_SCHEMA, { maxApprovedViolationRate: rate })
      expect(r.candles.map((c) => c.id), `rate ${rate}`).toEqual(AP_REPORT.candles.map((c) => c.id))
      expect(r.explained.holds, `rate ${rate}`).toBe(68)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('approved exceptions (maxApprovedViolationRate > 0), end to end', () => {
  it('rate 0: two approved exceptions kill the true rule; rate 0.05 candles it, grounded on the enrichment tail', () => {
    const table = exceptionTable(2)
    const strict = mine(table, QSCHEMA)
    expect(strict.candles).toEqual([])
    expect(strict.morgue.find((j) => j.id === 'L1 billed <= received')).toMatchObject({ fate: 'INCONSISTENT', detail: '2 approved case(s) violate it' })

    const tolerant = mine(table, QSCHEMA, { maxApprovedViolationRate: 0.05 }) // 40 approvals → 2 tolerated
    expect(tolerant.candles.map((c) => c.id)).toEqual(['L1 billed <= received'])
    const c = tolerant.candles[0]!
    expect(c).toMatchObject({ k: 27, holds: 25, approved: 2, decidable: 70, decidable_holds: 30, new_holds: 25 })
    expect(c.p).toBe(hypergeomUpperTail(70, 30, 27, 25))
    expect(c.p).toBeGreaterThan(hypergeomAllHolds(70, 30, 27)) // the wrong formula would overstate the evidence
    expect(tolerant.explained).toEqual({ holds: 25, of: 30, unexplained: ['H025', 'H026', 'H027', 'H028', 'H029'] })
    // the redundant forms of the same rule die REDUNDANT, not as extra candles
    expect(tolerant.morgue.filter((j) => j.fate === 'REDUNDANT').map((j) => j.id)).toEqual(['L2 billed = received', 'L3 billed <= received*(1+t)'])
  })

  it('three exceptions exceed a 5% rate: still INCONSISTENT, with the rate in the cause', () => {
    const r = mine(exceptionTable(3), QSCHEMA, { maxApprovedViolationRate: 0.05 })
    expect(r.candles).toEqual([])
    expect(r.morgue.find((j) => j.id === 'L1 billed <= received')!.detail).toBe('3 approved case(s) violate it (3/40 > max rate 0.05)')
  })

  it('missing values: undecidable cases leave the candidate null (N, H) and are counted in data.missing', () => {
    const t = exceptionTable(0)
    t.cases.push(qcase('M001', 'hold', 15, null), qcase('M002', 'ok', 10, null))
    const r = mine(t, QSCHEMA)
    expect(r.data.missing).toEqual({ received: 2 })
    expect(r.candles[0]).toMatchObject({ id: 'L1 billed <= received', decidable: 70, decidable_holds: 30, k: 25 })
    expect(r.candles[0]!.p).toBe(hypergeomAllHolds(70, 30, 25))
  })

  it('option validation', () => {
    expect(() => mine(exceptionTable(0), QSCHEMA, { maxApprovedViolationRate: 1 })).toThrow(/maxApprovedViolationRate/)
    expect(() => mine(exceptionTable(0), QSCHEMA, { tGrid: [] })).toThrow(/tGrid/)
    expect(() => mine(exceptionTable(0), QSCHEMA, { minNewHolds: 0 })).toThrow(/minNewHolds/)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('determinism', () => {
  it('the same input gives byte-identical JSON', () => {
    const a = JSON.stringify(mine(apCasesToTable(AP_ROWS), AP_MINE_SCHEMA))
    const b = JSON.stringify(mine(apCasesToTable(AP_ROWS), AP_MINE_SCHEMA))
    expect(a).toBe(b)
    expect(JSON.stringify(compileRuleset(AP_REPORT))).toBe(JSON.stringify(compileRuleset(mine(apCasesToTable(AP_ROWS), AP_MINE_SCHEMA))))
  })

  it('row order does not change the rules (candles and morgue identical when the table is reversed)', () => {
    const rev = mine({ cases: [...AP_TABLE.cases].reverse() }, AP_MINE_SCHEMA)
    expect(JSON.stringify(rev.candles)).toBe(JSON.stringify(AP_REPORT.candles))
    expect(JSON.stringify(rev.morgue)).toBe(JSON.stringify(AP_REPORT.morgue))
    expect(rev.data.table_hash).not.toBe(AP_REPORT.data.table_hash) // the fingerprint is of the table as given
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('compiled ruleset: verify enforces the mined rules', () => {
  const compiled = compileRuleset(AP_REPORT)

  it('all 4 candles compile (complete), lint clean, strict tolerance, and the checks say what was mined', () => {
    expect(compiled.complete).toBe(true)
    expect(compiled.not_expressible).toEqual([])
    expect(compiled.lint).toEqual({ ok: true, errors: [], warnings: [] })
    expect(compiled.warnings).toEqual([])
    expect(compiled.ruleset.tolerance).toEqual({ rel: 0, absCap: 0 })
    expect(compiled.ruleset.checks.map((c) => [c.code, c.scope ?? 'document', c.compare ?? 'number', `${c.left} ${c.op} ${c.right}`])).toEqual([
      ['M1', 'line', 'number', 'inv_price <= po_price * (1 + 0.02)'],
      ['M2', 'line', 'number', 'inv_qty <= rcv_qty'],
      ['M3', 'document', 'number', 'total = sum(inv_amount) + freight * freight_allowed'],
      ['M4', 'document', 'identifier', 'inv_po_numbers = po_number'],
    ])
    expect(Object.keys(compiled.ruleset.fields)).toEqual(['total', 'freight', 'freight_allowed', 'inv_po_numbers', 'po_number', 'inv_qty', 'rcv_qty', 'inv_price', 'po_price', 'inv_amount'])
  })

  it('over the 100 cases, verify agrees with the gold pay/hold decision wherever it decides (counts)', () => {
    const counts = { decided: 0, agree: 0, disagree: 0, abstain: 0, hold_as_fail: 0, approve_as_pass: 0 }
    const verdicts: Verdict[] = []
    for (const c of AP_TABLE.cases) {
      const v = verify(caseToExtraction(c), { ruleset: compiled.ruleset, now: NOW })
      verdicts.push(v)
      const goldHold = c.label !== 'approve'
      if (v.outcome === 'INSUFFICIENT_DATA') { counts.abstain++; continue }
      counts.decided++
      if ((v.outcome === 'FAIL') === goldHold) { counts.agree++; if (goldHold) counts.hold_as_fail++; else counts.approve_as_pass++ } else counts.disagree++
    }
    expect(counts).toEqual({ decided: 100, agree: 100, disagree: 0, abstain: 0, hold_as_fail: 68, approve_as_pass: 32 })
    // and the verdicts are well-formed proof objects: a PASS/FAIL claim always carries evidence and a computation
    for (const v of verdicts) for (const cl of v.claims.filter((x) => x.outcome !== 'INSUFFICIENT_DATA')) {
      expect(cl.evidence.length, cl.claim_id).toBeGreaterThan(0)
      expect(cl.computation, cl.claim_id).toBeDefined()
    }
  })

  it('a hold is FAILed on the right rule (T001: billed 10 of 7 received → M2 on line 0)', () => {
    const c = AP_TABLE.cases.find((x) => x.id === 'T001')!
    expect(c.label).toBe('hold_quantity')
    const v = verify(caseToExtraction(c), { ruleset: compiled.ruleset, now: NOW })
    expect(v.claims.filter((x) => x.outcome === 'FAIL').map((x) => x.claim_id)).toEqual(['line[0].M2'])
  })

  it('a candle the format cannot express is left OUT and listed, never approximated (Σ qty·price)', () => {
    const schema: MineSchema = {
      approve: 'ok',
      lines: { inv_amount: { type: 'money', role: 'amount', source: 'invoice' }, po_qty: { type: 'qty', source: 'po' }, po_price: { type: 'money', role: 'price', source: 'po' } },
      fields: { total: { type: 'money', role: 'total', source: 'invoice' } },
    }
    const cases: MineCase[] = []
    for (let i = 0; i < 20; i++) cases.push({ id: `A${pad(i)}`, label: 'ok', fields: { total: 100 }, lines: [{ inv_amount: 100, po_qty: 10, po_price: 10 + (i % 3) }] })
    for (let i = 0; i < 10; i++) cases.push({ id: `H${pad(i)}`, label: 'hold', fields: { total: 150 }, lines: [{ inv_amount: 150, po_qty: 10, po_price: 10 }] })
    const r = mine({ cases }, schema)
    expect(r.candles.map((c) => c.id)).toEqual(['D total <= sum(po_qty*po_price)'])
    const comp = compileRuleset(r)
    expect(comp.complete).toBe(false)
    expect(comp.checks).toEqual([])
    expect(comp.not_expressible).toEqual([{ candle: 'D total <= sum(po_qty*po_price)', reason: expect.stringMatching(/sum of a per-line product/) }])
    expect(comp.warnings.join(' ')).toMatch(/under-enforces/)
    expect(comp.warnings.join(' ')).toMatch(/no candle compiled/)
  })

  it('the gated forms compile and enforce correctly through the new bool kind (freight*[not allowed] <= 0)', () => {
    const schema: MineSchema = { approve: 'ok', fields: { freight: { type: 'money', role: 'extra' }, allowed: { type: 'bool' } } }
    const cases: MineCase[] = []
    for (let i = 0; i < 20; i++) cases.push({ id: `A${pad(i)}`, label: 'ok', fields: { freight: i % 2 ? 25 : 0, allowed: i % 2 === 1 } })
    for (let i = 0; i < 10; i++) cases.push({ id: `H${pad(i)}`, label: 'hold', fields: { freight: 40, allowed: false } })
    const r = mine({ cases }, schema)
    expect(r.candles.map((c) => c.id)).toEqual(['D freight*[not allowed] <= 0'])
    const comp = compileRuleset(r)
    expect(comp.ruleset.checks[0]).toMatchObject({ left: 'freight * (1 - allowed)', op: '<=', right: '0', tol: 0.005 })
    for (const c of cases) {
      const v = verify(caseToExtraction(c), { ruleset: comp.ruleset, now: NOW })
      expect(v.outcome, c.id).toBe(c.label === 'ok' ? 'PASS' : 'FAIL')
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('declarative format extensions (additive): kind bool / identifier, compare: identifier', () => {
  const RS: DeclarativeRuleset = {
    id: 'ext', version: '1.0.0', lineArrayKeys: ['line_items'],
    fields: {
      F: { paths: ['freight'] }, OK: { paths: ['allowed'], kind: 'bool' },
      CITED: { paths: ['cited'], kind: 'identifier' }, PO: { paths: ['po'], kind: 'identifier' },
      SKU: { paths: ['sku'], kind: 'identifier', line: true }, SKU_PO: { paths: ['sku_po'], kind: 'identifier', line: true },
    },
    checks: [
      { code: 'FREIGHT', left: 'F * (1 - OK)', op: '<=', right: '0', tol: 0.005 },
      { code: 'PO_MATCH', compare: 'identifier', left: 'CITED', op: '=', right: 'PO' },
      { code: 'SKU_MATCH', compare: 'identifier', scope: 'line', left: 'SKU', op: '=', right: 'SKU_PO' },
    ],
    tolerance: { rel: 0, absCap: 0 },
  }
  const doc = (o: Record<string, unknown> = {}) => ({ freight: 10, allowed: true, cited: ['PO-1'], po: 'PO-1', line_items: [{ sku: 'a-1', sku_po: 'A-1' }], ...o })
  const claim = (v: Verdict, id: string) => v.claims.find((c) => c.claim_id === id)!

  it('lints clean', () => { expect(lintRuleset(RS)).toEqual({ ok: true, errors: [], warnings: [] }) })

  it('bool binds true/false, 1/0 and yes/no text to 1/0, and anything else is UNPARSEABLE (never guessed)', () => {
    for (const [allowed, outcome] of [[true, 'PASS'], [false, 'FAIL'], [1, 'PASS'], [0, 'FAIL'], ['yes', 'PASS'], [' No ', 'FAIL']] as const) {
      expect(claim(verifyDeclarative(doc({ allowed }), RS, { now: NOW }), 'document.FREIGHT').outcome, String(allowed)).toBe(outcome)
    }
    const bad = claim(verifyDeclarative(doc({ allowed: 'maybe' }), RS, { now: NOW }), 'document.FREIGHT')
    expect(bad.outcome).toBe('INSUFFICIENT_DATA')
    expect(bad.insufficiency!.reason).toBe('UNPARSEABLE')
  })

  it('identifier compare: normalised set equality; several or no cited ids FAIL; missing abstains', () => {
    const at = (o: Record<string, unknown>) => claim(verifyDeclarative(doc(o), RS, { now: NOW }), 'document.PO_MATCH')
    expect(at({ cited: [' po-1 ', 'PO-1'] }).outcome).toBe('PASS') // normalised + deduplicated → {PO-1}
    expect(at({ cited: 'PO-1' }).outcome).toBe('PASS')
    expect(at({ cited: ['PO-1', 'PO-2'] }).outcome).toBe('FAIL')
    expect(at({ cited: [] }).outcome).toBe('FAIL')
    expect(at({ cited: ['PO-9'] })).toMatchObject({ outcome: 'FAIL', kind: 'CROSS_REFERENCE', asserted: 'PO-9', locked: true })
    expect(at({ cited: undefined }).insufficiency!.reason).toBe('FIELD_MISSING')
    expect(at({ cited: [{ x: 1 }] }).insufficiency!.reason).toBe('UNPARSEABLE')
    const pass = at({})
    expect(pass.evidence.length).toBe(2)
    expect(pass.computation).toMatchObject({ operands: { CITED: ['PO-1'], PO: ['PO-1'] }, result: 'PO-1' })
    expect(claim(verifyDeclarative(doc(), RS, { now: NOW }), 'line[0].SKU_MATCH').outcome).toBe('PASS')
    expect(claim(verifyDeclarative(doc({ line_items: [{ sku: 'A-2', sku_po: 'A-1' }] }), RS, { now: NOW }), 'line[0].SKU_MATCH').outcome).toBe('FAIL')
    const ne: DeclarativeRuleset = { ...RS, checks: [{ code: 'NE', compare: 'identifier', left: 'CITED', op: '!=', right: 'PO' }] }
    expect(verifyDeclarative(doc(), ne, { now: NOW }).outcome).toBe('FAIL')
  })

  it('an identifier check that names a non-identifier field abstains OUT_OF_RULESET_SCOPE (and lint rejects it)', () => {
    const bad: DeclarativeRuleset = { ...RS, checks: [{ code: 'X', compare: 'identifier', left: 'F', op: '=', right: 'PO' }] }
    expect(claim(verifyDeclarative(doc(), bad, { now: NOW }), 'document.X').insufficiency!.reason).toBe('OUT_OF_RULESET_SCOPE')
    expect(lintRuleset(bad).errors.join(' ')).toMatch(/must name an 'identifier' field/)
  })

  it('lint: identifier fields cannot enter arithmetic; identifier checks allow only = / != and matching scope; compare is validated', () => {
    const e = (checks: DeclarativeRuleset['checks']) => lintRuleset({ ...RS, checks }).errors.join(' | ')
    expect(e([{ code: 'A', left: 'PO', op: '=', right: '1' }])).toMatch(/cannot be used in arithmetic/)
    expect(e([{ code: 'B', compare: 'identifier', left: 'CITED', op: '<=', right: 'PO' }])).toMatch(/only = and !=/)
    expect(e([{ code: 'C', compare: 'identifier', scope: 'line', left: 'CITED', op: '=', right: 'PO' }])).toMatch(/document field but the check is line-scope/)
    expect(e([{ code: 'D', compare: 'bogus' as 'number', left: 'F', op: '=', right: '1' }])).toMatch(/invalid compare/)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('verify mine (CLI)', () => {
  const files: string[] = []
  const tmp = (name: string, content: unknown): string => {
    const p = join(tmpdir(), `verify-mine-${process.pid}-${files.length}-${name}`)
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
    files.push(p)
    return p
  }
  afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })
  const cap = (): CliIO & { o: () => string; e: () => string } => { let o = '', e = ''; return { out: (s) => { o += s }, err: (s) => { e += s }, o: () => o, e: () => e } }

  it('--ap on the Distil file prints the JSON report + compiled ruleset (exit 0), byte-identical across runs', () => {
    const io1 = cap(), io2 = cap()
    expect(run(['mine', AP_PATH, '--ap'], io1)).toBe(0)
    expect(run(['mine', AP_PATH, '--ap'], io2)).toBe(0)
    expect(io1.o()).toBe(io2.o())
    const out = JSON.parse(io1.o()) as { report: typeof AP_REPORT; compiled: ReturnType<typeof compileRuleset> }
    expect(out.report.candles.map((c) => c.id)).toEqual(AP_REPORT.candles.map((c) => c.id))
    expect(out.report.explained.holds).toBe(68)
    expect(out.compiled.complete).toBe(true)
  })

  it('--ruleset-out writes a ruleset that `verify <doc> --ruleset` enforces (hold → exit 1, approve → exit 0)', () => {
    const rsPath = tmp('mined.json', '')
    expect(run(['mine', AP_PATH, '--ap', '--ruleset-out', rsPath, '--ruleset-id', 'ap-mined'], cap())).toBe(0)
    const rs = JSON.parse(readFileSync(rsPath, 'utf8')) as DeclarativeRuleset
    expect(rs.id).toBe('ap-mined')
    const hold = AP_TABLE.cases.find((c) => c.label !== 'approve')!, ok = AP_TABLE.cases.find((c) => c.label === 'approve')!
    expect(run([tmp('hold.json', caseToExtraction(hold)), '--ruleset', rsPath], cap())).toBe(1)
    expect(run([tmp('ok.json', caseToExtraction(ok)), '--ruleset', rsPath], cap())).toBe(0)
  })

  it('a generic case table + --schema, and the approved-exception flag', () => {
    const table = exceptionTable(2)
    const jsonl = table.cases.map((c) => JSON.stringify(c)).join('\n') + '\n'
    const casesPath = tmp('cases.jsonl', jsonl), schemaPath = tmp('schema.json', QSCHEMA)
    const io = cap()
    expect(run(['mine', casesPath, '--schema', schemaPath, '--max-approved-violation-rate', '0.05'], io)).toBe(0)
    expect((JSON.parse(io.o()) as { report: { candles: { id: string }[] } }).report.candles.map((c) => c.id)).toEqual(['L1 billed <= received'])
    expect(mineFromJsonl(jsonl, { schema: QSCHEMA }).report.candles).toEqual([]) // no exceptions tolerated → none
    // numeric ids in a JSONL table are accepted as strings
    const numeric = table.cases.map((c, i) => JSON.stringify({ ...c, id: i + 1 })).join('\n')
    expect(mineFromJsonl(numeric, { schema: QSCHEMA, maxApprovedViolationRate: 0.05 }).report.candles[0]!.violators).toContain('41')
  })

  it('usage and input errors exit 3 with a reason; --help exits 0', () => {
    const casesPath = tmp('c.jsonl', '{"id":"a","label":"ok","fields":{}}\n{not json\n')
    const cases = [
      [['mine'], /needs <cases.jsonl>/],
      [['mine', AP_PATH], /--schema/],
      [['mine', AP_PATH, '--ap', '--max-approved-violation-rat', '0.1'], /unknown option/],
      [['mine', AP_PATH, '--ap', '--max-approved-violation-rate', 'lots'], /must be a number/],
      [['mine', AP_PATH, '--ap', '--max-approved-violation-rate', '1'], /must be a number in \[0, 1\)/],
      [['mine', casesPath, '--schema', tmp('s.json', QSCHEMA)], /line 2: invalid JSON/],
      [['mine', tmp('bad.jsonl', '{"id":"a","fields":{}}\n'), '--schema', tmp('s2.json', QSCHEMA)], /"label" must be a string/],
      [['mine', '/no/such/file.jsonl', '--ap'], /error reading input/],
    ] as const
    for (const [argv, msg] of cases) {
      const io = cap()
      expect(run([...argv], io), argv.join(' ')).toBe(3)
      expect(io.e(), argv.join(' ')).toMatch(msg)
    }
    const h = cap()
    expect(run(['mine', '--help'], h)).toBe(0)
    expect(h.e()).toMatch(/verify mine/)
  })

  it('parseMineArgs is a pure parser', () => {
    expect(parseMineArgs(['c.jsonl', '--ap', '--schema', 's.json', '--max-approved-violation-rate', '0.1', '--ruleset-out', 'o.json', '-x'])).toEqual({
      file: 'c.jsonl', ap: true, schema: 's.json', rate: '0.1', rulesetOut: 'o.json', thresholds: false, help: false, unknown: ['-x'],
    })
  })
})
