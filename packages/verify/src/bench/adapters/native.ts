/**
 * The native shape: a run that writes its results in the bench draft form itself, so no mapping is needed:
 *   { "rows": [{ "claim", "n", "k", "method", "bar"?, "note"?, "reported"? }], "misses"?: [...] }
 * The spec still names the run, the label and the prereg; its own rows list must be empty.
 */

import { BenchRefused } from '../prereg.js'
import type { BarTest, BenchMiss, CiMethod } from '../table.js'
import { runFields } from './common.js'
import type { Adapter, RowDraft } from './shape.js'

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

export const nativeAdapter: Adapter = ({ spec, results }) => {
  if (!results) throw new BenchRefused('no-results', 'the native adapter reads machine-readable results')
  if (spec.rows.length) throw new BenchRefused('bad-spec', 'a native run carries its own rows: the spec lists none')
  const main = results.files.get('main')
  if (!isObj(main) || !Array.isArray(main.rows)) throw new BenchRefused('bad-results', 'native results must be { rows: [...], misses?: [...] }')
  const rows: RowDraft[] = main.rows.map((r, i) => {
    if (!isObj(r)) throw new BenchRefused('bad-row', `rows[${i}] must be an object`)
    const d: RowDraft = { claim: String(r.claim ?? ''), n: r.n, k: r.k, method: r.method as CiMethod, bar: (r.bar ?? null) as BarTest | null }
    if (typeof r.note === 'string') d.note = r.note
    if (isObj(r.reported)) d.reported = r.reported as RowDraft['reported']
    return d
  })
  const misses = (Array.isArray(main.misses) ? main.misses : []) as BenchMiss[]
  return { rows, misses: [...(spec.misses ?? []), ...misses], run: runFields(spec, results) }
}
