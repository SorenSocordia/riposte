/**
 * The transcribed shape: a run that left no machine-readable results. The rows' n and k, and the misses, are typed from the
 * run's report into the spec; the table names that report by sha256 and carries the label "transcribed", so nobody reads it
 * as computed. A misses-only table (a red team's findings) is a transcribed table with no rows.
 */

import { literalMisses, readRow, runFields } from './common.js'
import type { Adapter } from './shape.js'

export const transcribedAdapter: Adapter = ({ spec }) =>
  ({ rows: spec.rows.map(r => readRow(r, null)), misses: literalMisses(spec), run: runFields(spec, null) })
