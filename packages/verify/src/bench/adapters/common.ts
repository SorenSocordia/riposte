/** Pieces every run-shape adapter shares: the run fields, literal misses, and a row's n and k read from the spec. */

import { BenchRefused } from '../prereg.js'
import { resolveVal, type LoadedResults, type RowSpec, type RunSpec } from '../spec.js'
import type { BenchMiss } from '../table.js'
import type { AdapterOutput, RowDraft } from './shape.js'

const str = (v: unknown, at: string): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  throw new BenchRefused('bad-spec', `${at} must be a string (got ${JSON.stringify(v)})`)
}

export function runFields(spec: RunSpec, results: LoadedResults | null): AdapterOutput['run'] {
  const out: AdapterOutput['run'] = {
    engine_version: str(resolveVal(spec.run.engine_version ?? null, results, 'run.engine_version'), 'run.engine_version'),
    ruleset: str(resolveVal(spec.run.ruleset ?? null, results, 'run.ruleset'), 'run.ruleset'),
  }
  const dist = str(resolveVal(spec.run.dist_sha256, results, 'run.dist_sha256'), 'run.dist_sha256')
  if (dist !== null) out.dist_sha256 = dist
  return out
}

export function literalMisses(spec: RunSpec): BenchMiss[] {
  return (spec.misses ?? []).map(m => {
    const out: BenchMiss = { id: m.id, kind: m.kind, description: m.description, post_hoc: m.post_hoc }
    if (m.fixed_by !== undefined) out.fixed_by = m.fixed_by
    if (m.date !== undefined) out.date = m.date
    return out
  })
}

/** A row whose n and k are given (literal or `$from`), not counted. */
export function readRow(r: RowSpec, results: LoadedResults | null): RowDraft {
  const d: RowDraft = {
    claim: r.claim,
    n: resolveVal(r.n, results, `row "${r.claim}" n`),
    k: resolveVal(r.k, results, `row "${r.claim}" k`),
    method: r.method,
    bar: r.bar ?? null,
  }
  if (r.note) d.note = r.note
  if (r.reported) d.reported = r.reported
  return d
}
