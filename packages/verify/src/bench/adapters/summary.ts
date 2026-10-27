/**
 * The summary shape: a run that left one scored summary (counts already tallied by its own scorer). Each row reads n and k
 * at JSON paths (`{ "$from": "summary:audit.n" }`); no items are counted here.
 */

import { BenchRefused } from '../prereg.js'
import { literalMisses, readRow, runFields } from './common.js'
import type { Adapter } from './shape.js'

export const summaryAdapter: Adapter = ({ spec, results }) => {
  if (!results) throw new BenchRefused('no-results', 'the summary adapter reads machine-readable results')
  return { rows: spec.rows.map(r => readRow(r, results)), misses: literalMisses(spec), run: runFields(spec, results) }
}
