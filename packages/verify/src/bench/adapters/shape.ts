/**
 * What a run-shape adapter hands the bench emitter: row drafts (claim, n, k, method, bar, and what the run's report said)
 * and misses, plus the run fields it read from the results. The emitter turns drafts into rows (rate, interval, verdict),
 * cross-checks them against `reported`, and refuses anything malformed (bench/emit.ts).
 */

import type { BarTest, BenchMiss, CiMethod } from '../table.js'
import type { LoadedResults, RunSpec } from '../spec.js'

export interface RowDraft {
  claim: string
  n: unknown
  k: unknown
  method: CiMethod
  bar: BarTest | null
  note?: string
  reported?: { k?: number; n?: number }
}

export interface AdapterOutput {
  rows: RowDraft[]
  misses: BenchMiss[]
  run: { engine_version: string | null; ruleset: string | null; dist_sha256?: string }
}

export interface AdapterContext {
  spec: RunSpec
  /** Null for a transcribed table (no machine-readable results). */
  results: LoadedResults | null
}

export type Adapter = (ctx: AdapterContext) => AdapterOutput
