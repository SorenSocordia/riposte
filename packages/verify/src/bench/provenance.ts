/**
 * Rows outside the bench rule (bench-provenance/1, `docs/bench/_provenance.json`).
 *
 * A run whose prereg sha256 was never recorded before it ran gets no bench table: `verify bench emit` refuses it, and the
 * refusal stays on the refused list. When such a run's numbers are published elsewhere, they may still be printed here,
 * under one fixed tier label, beside a link to an archive of the provenance that does exist (file metadata, dated log
 * lines), with that archive's sha256. The rows are descriptive: they carry counts and intervals, never a verdict, because
 * there is no recorded bar to hold them to. Nothing here can turn into a table: the tier is not a bench label.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { sha256Bytes } from './prereg.js'
import { makeRow, type BenchRow, type CiMethod } from './table.js'

export const PROVENANCE_FORMAT = 'bench-provenance/1'
export const PROVENANCE_TIER = 'transcribed; provenance archived; prereg unhashed'

export interface ProvenanceEntry {
  id: string
  title: string
  tier: typeof PROVENANCE_TIER
  run: { id: string; date: string; engine_version: string | null; checker_sha256?: string }
  /** The archive, relative to the tables folder (`ap-blind/PROVENANCE.md`), and the sha256 of its bytes. */
  provenance: { path: string; sha256: string }
  /** Why this is not a bench table, in one or two sentences. */
  why_not_a_table: string
  /** The headline as it may be quoted, restated in full. */
  headline?: string
  rows: BenchRow[]
}

export interface ProvenanceList { format: typeof PROVENANCE_FORMAT; entries: ProvenanceEntry[] }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const inside = (p: string): boolean => !isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..')

/** A descriptive row (no bar): counts, a two-sided 95% interval by the named method, and a note. */
export const provenanceRow = (claim: string, k: number, n: number, note: string, method: CiMethod = 'wilson'): BenchRow =>
  makeRow({ claim, k, n, method, bar: null, note })

/** Every problem with a provenance list ([] when well formed). With `dir`, each archive must exist there and match its sha256. */
export function provenanceProblems(x: unknown, dir?: string): string[] {
  if (!isObj(x) || x.format !== PROVENANCE_FORMAT || !Array.isArray(x.entries)) return [`not a ${PROVENANCE_FORMAT}`]
  const out: string[] = []
  const seen = new Set<string>()
  x.entries.forEach((e, i) => {
    const at = `entries[${i}]`
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.title !== 'string') { out.push(`${at} needs id and title`); return }
    if (seen.has(e.id)) out.push(`${at}: duplicate id ${e.id}`)
    seen.add(e.id)
    if (e.tier !== PROVENANCE_TIER) out.push(`${at}: the tier is exactly "${PROVENANCE_TIER}"`)
    if (typeof e.why_not_a_table !== 'string' || !e.why_not_a_table.trim()) out.push(`${at}: why_not_a_table is required`)
    if (!isObj(e.run) || typeof e.run.id !== 'string' || typeof e.run.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(e.run.date)) out.push(`${at}: run needs id and an ISO date`)
    const p = e.provenance
    if (!isObj(p) || typeof p.path !== 'string' || typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) out.push(`${at}: provenance needs path and sha256`)
    else if (!inside(p.path)) out.push(`${at}: provenance path ${p.path} leaves the tables folder`)
    else if (dir !== undefined) {
      const abs = resolve(join(dir, p.path))
      if (!existsSync(abs)) out.push(`${at}: the archive ${p.path} does not exist`)
      else if (sha256Bytes(readFileSync(abs)) !== p.sha256) out.push(`${at}: the archive ${p.path} does not match its recorded sha256 (it changed after it was recorded)`)
    }
    if (!Array.isArray(e.rows) || !e.rows.length) { out.push(`${at}: rows are required`); return }
    e.rows.forEach((r, j) => {
      if (!isObj(r)) { out.push(`${at}.rows[${j}] must be an object`); return }
      try {
        const re = makeRow({ claim: r.claim as string, n: r.n, k: r.k, method: r.method, bar: null, note: '' })
        if (r.bar !== null) out.push(`${at}.rows[${j}]: a provenance row carries no bar`)
        if (re.rate !== r.rate || re.ci95[0] !== (r.ci95 as number[])?.[0] || re.ci95[1] !== (r.ci95 as number[])?.[1]) out.push(`${at}.rows[${j}] ("${String(r.claim)}"): rate or ci95 does not recompute`)
        if (r.verdict !== 'INSUFFICIENT') out.push(`${at}.rows[${j}]: a provenance row has no verdict (INSUFFICIENT)`)
      } catch (err) { out.push(`${at}.rows[${j}]: ${(err as Error).message}`) }
    })
  })
  return out
}

export const provenanceBytes = (l: ProvenanceList): string => `${JSON.stringify(l, null, 2)}\n`
