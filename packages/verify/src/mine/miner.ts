/**
 * mine(table, schema, options?) → MineReport
 *
 * The product form of the Oracle-AP prototype. On 2026-09-24 that prototype rediscovered all four rules of an
 * accounts-payable policy from 100 labelled invoices, with 0 false rules (PREREG-ORACLE-AP.md, RESULTS.md). Here it is
 * made generic: the grammar is generated from a schema (grammar.ts), and the judges are the prototype's (judges.ts).
 * There is one opt-in extension, `maxApprovedViolationRate`, for real data with approved exceptions (see stats.ts for
 * its null).
 *
 * Deterministic: no randomness, no clock, no I/O. Violator lists are sorted by case id, so the report does not depend on
 * the order of the rows (except `data.table_hash`, which fingerprints the table exactly as given).
 */

import { hashOf } from '../verdict/canonical.js'
import { ENGINE_VERSION } from '../version.js'
import { approveLabels, buildGrammar, constSpec, DEFAULT_T_GRID, validateSchema, valueOk, worstRatio, type PreparedCase } from './grammar.js'
import { allowedApproved, judgeConsistency, judgeGrounding, judgeNovelty, learnT, tally } from './judges.js'
import { learnConst } from './threshold.js'
import type { CaseTable, JudgedCandidate, LineComparisonSpec, MineOptions, MineReport, MineSchema, ResolvedMineOptions } from './types.js'

export const MINE_VERSION = '0.1.0'

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const sortIds = (ids: readonly string[]): string[] => [...ids].sort(byId)

export function resolveMineOptions(o: MineOptions = {}): ResolvedMineOptions {
  const r: ResolvedMineOptions = {
    minHoldViolators: o.minHoldViolators ?? 5,
    maxP: o.maxP ?? 0.01,
    minNewHolds: o.minNewHolds ?? 3,
    tGrid: [...new Set(o.tGrid ?? DEFAULT_T_GRID)].sort((a, b) => a - b),
    maxApprovedViolationRate: o.maxApprovedViolationRate ?? 0,
    strictAlpha: o.strictAlpha ?? 0.05,
    thresholds: o.thresholds ?? false,
  }
  if (!Number.isInteger(r.minHoldViolators) || r.minHoldViolators < 1) throw new Error('minHoldViolators must be an integer >= 1')
  if (!Number.isInteger(r.minNewHolds) || r.minNewHolds < 1) throw new Error('minNewHolds must be an integer >= 1')
  if (!(r.maxP > 0 && r.maxP <= 1)) throw new Error('maxP must be in (0, 1]')
  if (!(r.strictAlpha > 0 && r.strictAlpha <= 1)) throw new Error('strictAlpha must be in (0, 1]')
  if (!(r.maxApprovedViolationRate >= 0 && r.maxApprovedViolationRate < 1)) throw new Error('maxApprovedViolationRate must be in [0, 1)')
  if (!r.tGrid.length || !r.tGrid.every((t) => Number.isFinite(t) && t >= 0)) throw new Error('tGrid must be a non-empty list of finite numbers >= 0')
  return r
}

/** Throw a clear error on a malformed case table (a bad row must never be mined silently). */
export function validateCaseTable(table: CaseTable): void {
  if (!table || !Array.isArray(table.cases)) throw new Error('case table must be { cases: [...] }')
  const seen = new Set<string>()
  table.cases.forEach((c, i) => {
    const where = `case[${i}]`
    if (!c || typeof c !== 'object') throw new Error(`${where}: must be an object`)
    if (typeof c.id !== 'string' || !c.id.length) throw new Error(`${where}: "id" must be a non-empty string`)
    if (seen.has(c.id)) throw new Error(`${where}: duplicate id "${c.id}"`)
    seen.add(c.id)
    if (typeof c.label !== 'string') throw new Error(`${where} (${c.id}): "label" must be a string`)
    if (!c.fields || typeof c.fields !== 'object' || Array.isArray(c.fields)) throw new Error(`${where} (${c.id}): "fields" must be an object`)
    if (c.lines !== undefined && (!Array.isArray(c.lines) || !c.lines.every((l) => l && typeof l === 'object' && !Array.isArray(l)))) throw new Error(`${where} (${c.id}): "lines" must be an array of objects`)
  })
}

function supportedInterval(spec: LineComparisonSpec, cases: readonly PreparedCase[], rate: number, nApproved: number): { lo: number | null; hi: number | null } {
  const approvedR = cases.filter((c) => !c.hold).map((c) => worstRatio(spec, c)).filter((r): r is number => r !== null).sort((a, b) => b - a)
  const lo = approvedR[allowedApproved(rate, nApproved)] ?? null
  const heldAbove = cases.filter((c) => c.hold).map((c) => worstRatio(spec, c)).filter((r): r is number => r !== null && (lo === null || r > lo + 1e-9))
  const hi = heldAbove.length ? Math.min(...heldAbove) : null
  const fin = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : x)
  return { lo: fin(lo), hi: fin(hi) }
}

export function mine(table: CaseTable, schema: MineSchema, options: MineOptions = {}): MineReport {
  validateSchema(schema)
  validateCaseTable(table)
  const opts = resolveMineOptions(options)
  const approve = approveLabels(schema)
  const cases: PreparedCase[] = table.cases.map((c) => ({ id: c.id, label: c.label, hold: !approve.has(c.label), fields: c.fields, lines: Array.isArray(c.lines) ? c.lines : null }))
  const grammar = buildGrammar(schema, opts.tGrid, { thresholds: opts.thresholds })
  const variants = grammar.reduce((a, g) => a + (g.tGrid?.length ?? 1), 0)
  const strictGate = opts.strictAlpha / variants
  const rate = opts.maxApprovedViolationRate

  // ── judges 1 + 2, per candidate in grammar order ──
  // `rows[i]` is grammar candidate i. A GROUNDED candidate's fate is provisional until judge 3 settles it (CANDLE | REDUNDANT).
  const rows: { j: JudgedCandidate; holdViolators: string[]; grounded: boolean; interval?: { lo: number; hi: number } }[] = []
  for (const g of grammar) {
    let t: number | undefined
    let spec = g.spec
    let learned: { c: number; lo: number; hi: number } | undefined
    if (g.learnConst) {
      const r = learnConst(g.learnConst.field, g.learnConst.dir, cases, rate)
      if (!r.ok) {
        const at = tally(g.spec, cases)
        rows.push({ grounded: false, holdViolators: [], j: { id: g.id, family: g.family, spec: g.spec, fate: r.fate, detail: r.detail,
          k: 0, holds: 0, approved: 0, decidable: at.decidable, decidable_holds: at.decidableHolds, p: 1, strict: false, violators: [] } })
        continue
      }
      learned = r.learned
      spec = constSpec(g.learnConst.field, g.learnConst.dir, learned.c)
    }
    if (g.tGrid) {
      t = learnT(g.spec, cases, g.tGrid, rate)
      if (t === undefined) {
        const at = tally(g.spec, cases, g.tGrid[g.tGrid.length - 1])
        rows.push({ grounded: false, holdViolators: [], j: { id: g.id, family: g.family, spec: g.spec, fate: 'INCONSISTENT',
          detail: rate > 0 ? `the approved-violation limit (rate ${rate}) is exceeded at every t in the grid` : 'approved cases violate it at every t in the grid',
          k: 0, holds: 0, approved: 0, decidable: at.decidable, decidable_holds: at.decidableHolds, p: 1, strict: false, violators: [] } })
        continue
      }
    }
    const tl = tally(spec, cases, t ?? 0)
    const base = {
      id: g.id, family: g.family, spec, ...(t !== undefined ? { t } : {}), ...(learned ? { c: learned.c } : {}),
      k: tl.violators.length, holds: tl.holdViolators.length, approved: tl.approved, decidable: tl.decidable, decidable_holds: tl.decidableHolds,
      violators: sortIds(tl.violators),
    }
    const cons = judgeConsistency(tl, rate)
    const interval = learned ? { lo: learned.lo, hi: learned.hi } : undefined
    if (!cons.ok) { rows.push({ grounded: false, holdViolators: tl.holdViolators, j: { ...base, fate: 'INCONSISTENT', detail: cons.detail, p: 1, strict: false } }); continue }
    const gr = judgeGrounding(tl, opts)
    const grounded = gr.fate === 'GROUNDED'
    rows.push({ grounded, holdViolators: tl.holdViolators, ...(interval ? { interval } : {}), j: { ...base, fate: grounded ? 'REDUNDANT' : (gr.fate as 'VOID' | 'BASE_RATE'), detail: gr.detail, p: gr.p, strict: grounded && gr.p <= strictGate } })
  }

  // ── judge 3, novelty over the grounded ──
  const { decisions, covered } = judgeNovelty(
    rows.map((r, index) => ({ index, id: r.j.id, holdViolators: r.holdViolators, grounded: r.grounded })).filter((r) => r.grounded),
    opts.minNewHolds,
  )
  const candles: JudgedCandidate[] = []
  const constInterval = new Map<JudgedCandidate, { lo: number; hi: number }>()
  for (const d of decisions) {
    const j = rows[d.index]!.j
    const iv = rows[d.index]!.interval
    if (iv) constInterval.set(j, iv)
    j.fate = d.fate
    j.detail = d.detail
    j.new_holds = d.newHolds
    if (d.fate === 'CANDLE') candles.push(j)
  }

  // ── candle annotations: labels among violators (descriptive only), and the t interval for L3 ──
  const labelOf = new Map(cases.map((c) => [c.id, c.label]))
  for (const c of candles) {
    const m: Record<string, number> = {}
    for (const v of c.violators) { const l = labelOf.get(v)!; m[l] = (m[l] ?? 0) + 1 }
    c.violator_labels = Object.fromEntries(Object.keys(m).sort(byId).map((k) => [k, m[k]!]))
    if (c.spec.form === 'le_tol') c.interval = supportedInterval(c.spec, cases, rate, c.decidable - c.decidable_holds)
    const iv = constInterval.get(c)
    if (iv) c.interval = iv
  }

  const holdIds = cases.filter((c) => c.hold).map((c) => c.id)

  // ── data diagnostics ──
  const missing: Record<string, number> = {}
  for (const [n, f] of Object.entries(schema.fields)) {
    const k = cases.filter((c) => !valueOk(f.type, c.fields[n])).length
    if (k) missing[n] = k
  }
  for (const [n, f] of Object.entries(schema.lines ?? {})) {
    const k = cases.filter((c) => !c.lines || c.lines.some((l) => !valueOk(f.type, l[n]))).length
    if (k) missing[n] = k
  }
  const subcent = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && Math.abs(Math.round(v * 100) - v * 100) > 1e-6
  const subcent_money_fields = [
    ...Object.entries(schema.fields).filter(([n, f]) => f.type === 'money' && cases.some((c) => subcent(c.fields[n]))).map(([n]) => n),
    ...Object.entries(schema.lines ?? {}).filter(([n, f]) => f.type === 'money' && cases.some((c) => (c.lines ?? []).some((l) => subcent(l[n])))).map(([n]) => n),
  ]

  return {
    engine: 'riposte-mine',
    mine_version: MINE_VERSION,
    engine_version: ENGINE_VERSION,
    options: opts,
    schema,
    data: {
      cases: cases.length, holds: holdIds.length, approves: cases.length - holdIds.length,
      table_hash: hashOf(table), excluded: table.excluded ?? [], missing, subcent_money_fields,
    },
    grammar: { forms: grammar.length, variants, strict_gate: strictGate },
    candles,
    morgue: rows.map((r) => r.j).filter((j) => j.fate !== 'CANDLE'),
    explained: { holds: holdIds.filter((id) => covered.has(id)).length, of: holdIds.length, unexplained: sortIds(holdIds.filter((id) => !covered.has(id))) },
  }
}
