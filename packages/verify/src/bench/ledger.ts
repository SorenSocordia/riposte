/**
 * The misses ledger: every miss from every bench table, dated, append-only by construction.
 *
 * The ledger is regenerated from the tables, and the regeneration is checked against the ledger it replaces. It refuses
 * (LedgerRefused, nothing written) when a prior row would be dropped (its table is gone, or the table no longer lists it),
 * or when any field of a prior row would change, except one: a `fixed_by` that was absent may be added. A `fixed_by` that
 * is present can never change or be removed. Prior rows keep their order; new rows are appended in table order.
 *
 * A table held from the tree (bench/held.ts, `docs/bench/_held.json`) is absent by design, not dropped: its prior rows are kept
 * exactly as recorded, in their places, so the ledger's bytes are the same whether the table ships or is held.
 */

import type { BenchMiss, BenchTable } from './table.js'

/**
 * What the ledger is built from: the tables, and the misses of runs withdrawn from the index (a withdrawn table's misses
 * stay in the ledger, dated by the run, because the ledger never drops a row).
 */
export type LedgerSource = Pick<BenchTable, 'id' | 'misses'> & { run: { date: string } }

/** The tables plus every withdrawn run that carries misses (docs.ts RefusedRun with `misses` and `run_date`). */
export function ledgerSources(tables: BenchTable[], withdrawn: readonly { id: string; misses?: BenchMiss[]; run_date?: string }[] = []): LedgerSource[] {
  const extra = withdrawn.filter(w => w.misses?.length).map(w => {
    if (!w.run_date) throw new LedgerRefused('bad-ledger', `withdrawn run ${w.id} keeps its misses but names no run_date`)
    return { id: w.id, misses: w.misses!, run: { date: w.run_date } }
  })
  return [...tables, ...extra]
}

export const LEDGER_FORMAT = 'misses-ledger/1'

export interface LedgerRow {
  /** `<table id>#<miss id>`: one row per miss, forever. */
  key: string
  table: string
  id: string
  date: string
  kind: string
  description: string
  post_hoc: boolean
  fixed_by?: string
}

export interface Ledger {
  format: typeof LEDGER_FORMAT
  rows: LedgerRow[]
}

export class LedgerRefused extends Error {
  constructor(readonly code: 'drop' | 'alter' | 'duplicate' | 'bad-ledger', message: string) {
    super(message)
    this.name = 'LedgerRefused'
  }
}

/** The ledger rows the tables hold, in table order. */
export function ledgerRowsOf(tables: LedgerSource[]): LedgerRow[] {
  const out: LedgerRow[] = []
  const seen = new Set<string>()
  for (const t of tables) for (const m of t.misses) {
    const key = `${t.id}#${m.id}`
    if (seen.has(key)) throw new LedgerRefused('duplicate', `miss ${key} is listed twice`)
    seen.add(key)
    const row: LedgerRow = { key, table: t.id, id: m.id, date: m.date ?? t.run.date, kind: m.kind, description: m.description, post_hoc: m.post_hoc }
    if (m.fixed_by !== undefined) row.fixed_by = m.fixed_by
    out.push(row)
  }
  return out
}

const FIXED_FIELDS = ['table', 'id', 'date', 'kind', 'description', 'post_hoc'] as const

/** Check a parsed ledger's shape. */
export function asLedger(x: unknown): Ledger {
  const o = x as Ledger
  if (typeof x !== 'object' || x === null || o.format !== LEDGER_FORMAT || !Array.isArray(o.rows)) throw new LedgerRefused('bad-ledger', `the prior ledger is not a ${LEDGER_FORMAT}`)
  return o
}

/**
 * The next ledger: the prior one with fixes added, then the new misses. Throws LedgerRefused on any drop or alteration. `held`
 * names the tables held from the tree (bench/held.ts): their prior rows are kept as recorded, in place; a held table that is
 * also among the sources refuses, since a table cannot be both held and present.
 */
export function mergeLedger(prior: Ledger | null, tables: LedgerSource[], held: ReadonlySet<string> = new Set()): { ledger: Ledger; added: number; fixed: number } {
  const both = tables.filter(t => held.has(t.id)).map(t => t.id)
  if (both.length) throw new LedgerRefused('bad-ledger', `table(s) ${both.join(', ')} are declared held but are among the tables`)
  const candidates = ledgerRowsOf(tables)
  const byKey = new Map(candidates.map(r => [r.key, r]))
  const rows: LedgerRow[] = []
  const kept = new Set<string>()
  let fixed = 0
  for (const p of prior?.rows ?? []) {
    if (held.has(p.table)) { rows.push(p); kept.add(p.key); continue } // held, not dropped: the row stays as recorded
    const c = byKey.get(p.key)
    if (!c) throw new LedgerRefused('drop', `miss ${p.key} (${p.date}, ${p.kind}) is in the ledger but in no table: the ledger never drops a row`)
    for (const f of FIXED_FIELDS) if (c[f] !== p[f]) throw new LedgerRefused('alter', `miss ${p.key}: ${f} would change from ${JSON.stringify(p[f])} to ${JSON.stringify(c[f])}; only fixed_by may be added`)
    if (p.fixed_by !== undefined && c.fixed_by !== p.fixed_by) throw new LedgerRefused('alter', `miss ${p.key}: fixed_by ${JSON.stringify(p.fixed_by)} would ${c.fixed_by === undefined ? 'be removed' : `change to ${JSON.stringify(c.fixed_by)}`}; a fix, once recorded, stays`)
    if (p.fixed_by === undefined && c.fixed_by !== undefined) fixed++
    rows.push(c)
    kept.add(p.key)
  }
  const fresh = candidates.filter(c => !kept.has(c.key))
  return { ledger: { format: LEDGER_FORMAT, rows: [...rows, ...fresh] }, added: fresh.length, fixed }
}

export const ledgerBytes = (l: Ledger): string => `${JSON.stringify(l, null, 2)}\n`
