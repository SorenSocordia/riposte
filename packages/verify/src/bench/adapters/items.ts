/**
 * The items shape: a run that left one record per case (a JSON list, a JSONL file, a TSV). Each row counts n = records
 * matching `where` and k = those also matching `hit`; misses can be generated per record (`misses_from`) as well as listed.
 * A row may instead read n and k from the results (`$from`), for the run's summary figures beside its per-case records.
 */

import { BenchRefused } from '../prereg.js'
import { interpolate, itemsFrom, matches } from '../spec.js'
import type { BenchMiss } from '../table.js'
import { literalMisses, readRow, runFields } from './common.js'
import type { Adapter, RowDraft } from './shape.js'

export const itemsAdapter: Adapter = ({ spec, results }) => {
  if (!results) throw new BenchRefused('no-results', 'the items adapter reads machine-readable results')
  const rows: RowDraft[] = spec.rows.map((r, i) => {
    if (r.where === undefined && r.hit === undefined) return readRow(r, results)
    const src = r.items ?? spec.items
    if (src === undefined) throw new BenchRefused('bad-spec', `rows[${i}] ("${r.claim}"): no item source (items)`)
    const items = itemsFrom(src, results, `rows[${i}]`)
    const inScope = items.filter(it => matches(it, r.where))
    const d: RowDraft = { claim: r.claim, n: inScope.length, k: inScope.filter(it => matches(it, r.hit)).length, method: r.method, bar: r.bar ?? null }
    if (r.note) d.note = r.note
    if (r.reported) d.reported = r.reported
    return d
  })
  const misses: BenchMiss[] = literalMisses(spec)
  for (const [i, m] of (spec.misses_from ?? []).entries()) {
    const src = m.items ?? spec.items
    if (src === undefined) throw new BenchRefused('bad-spec', `misses_from[${i}]: no item source (items)`)
    for (const it of itemsFrom(src, results, `misses_from[${i}]`).filter(x => matches(x, m.where))) {
      const miss: BenchMiss = { id: interpolate(m.id, it), kind: interpolate(m.kind, it), description: interpolate(m.description, it), post_hoc: m.post_hoc }
      if (m.fixed_by !== undefined) miss.fixed_by = interpolate(m.fixed_by, it)
      misses.push(miss)
    }
  }
  return { rows, misses, run: runFields(spec, results) }
}
