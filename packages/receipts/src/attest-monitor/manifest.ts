/**
 * The monitor's manifest: one JSON file naming the month, every host record (with the model each run was declared to use),
 * every provider export, and any anchor ledgers. Paths are relative to the manifest. The loader refuses, never guesses: an
 * unknown key, an unknown format or source, an unreadable file, or an export with unacknowledged unknown fields stops the run.
 */
import { createHash } from 'node:crypto'
import { readHostRecord, HOST_FORMATS, type HostFormat } from './hosts.js'
import { parseExport, EXPORT_SOURCES, PROVIDERS, type CsvColumnMap, type ExportSource, type Provider } from './exports.js'
import { readAnchors } from './anchor.js'
import type { LedgerEntry } from '../ledger.js'
import type { MonitorInput, MonitorRun, MonitorExport, AnchorSet } from './monitor.js'

export interface AttestManifest {
  month: string
  deployer?: string
  match_window_seconds?: number
  anchor_lag_seconds?: number
  runs: { name: string; path: string; format: HostFormat; declared: string; allowed?: string[]; provider?: Provider; account?: string }[]
  exports?: { source: ExportSource; path: string; columns?: CsvColumnMap; acknowledge?: string[]; account?: string }[]
  anchors?: { ledger: string; public_key: string }[]
}

export const MAX_FILE_BYTES = 200 * 1024 * 1024
const isObj = (x: unknown): x is Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x)
const KEYS = { top: ['month', 'deployer', 'match_window_seconds', 'anchor_lag_seconds', 'runs', 'exports', 'anchors'], run: ['name', 'path', 'format', 'declared', 'allowed', 'provider', 'account'], exp: ['source', 'path', 'columns', 'acknowledge', 'account'], anchor: ['ledger', 'public_key'] }

/** Check a parsed manifest. Returns the problems; empty means usable. */
export function manifestProblems(x: unknown): string[] {
  const p: string[] = []
  if (!isObj(x)) return ['the manifest is not a JSON object']
  for (const k of Object.keys(x)) if (!KEYS.top.includes(k)) p.push(`unknown key "${k}"`)
  if (typeof x.month !== 'string' || !/^\d{4}-\d{2}$/.test(x.month)) p.push('month must be "YYYY-MM"')
  if (!Array.isArray(x.runs) || !x.runs.length) p.push('runs must list at least one host record')
  const names = new Set<string>()
  for (const [i, r] of (Array.isArray(x.runs) ? x.runs : []).entries()) {
    if (!isObj(r)) { p.push(`runs[${i}] is not an object`); continue }
    for (const k of Object.keys(r)) if (!KEYS.run.includes(k)) p.push(`runs[${i}]: unknown key "${k}"`)
    if (typeof r.name !== 'string' || !r.name.trim()) p.push(`runs[${i}]: name is required`)
    else if (names.has(r.name)) p.push(`runs[${i}]: the name "${r.name}" is used twice`); else names.add(r.name)
    if (typeof r.path !== 'string') p.push(`runs[${i}]: path is required`)
    if (!HOST_FORMATS.includes(r.format)) p.push(`runs[${i}]: format must be one of ${HOST_FORMATS.join(', ')}`)
    if (typeof r.declared !== 'string' || !r.declared.trim()) p.push(`runs[${i}]: declared (the exact model id the run was declared to use) is required`)
    if (r.provider !== undefined && !PROVIDERS.includes(r.provider)) p.push(`runs[${i}]: provider must be one of ${PROVIDERS.join(', ')}`)
    if (r.allowed !== undefined && (!Array.isArray(r.allowed) || !r.allowed.every((a: unknown) => typeof a === 'string'))) p.push(`runs[${i}]: allowed must be a list of model ids`)
  }
  for (const [i, e] of (Array.isArray(x.exports) ? x.exports : []).entries()) {
    if (!isObj(e)) { p.push(`exports[${i}] is not an object`); continue }
    for (const k of Object.keys(e)) if (!KEYS.exp.includes(k)) p.push(`exports[${i}]: unknown key "${k}"`)
    if (!EXPORT_SOURCES.includes(e.source)) p.push(`exports[${i}]: source must be one of ${EXPORT_SOURCES.join(', ')}`)
    if (typeof e.path !== 'string') p.push(`exports[${i}]: path is required`)
  }
  if (x.exports !== undefined && !Array.isArray(x.exports)) p.push('exports must be a list')
  for (const [i, a] of (Array.isArray(x.anchors) ? x.anchors : []).entries()) {
    if (!isObj(a) || typeof a.ledger !== 'string' || typeof a.public_key !== 'string') p.push(`anchors[${i}]: needs ledger and public_key (paths)`)
  }
  for (const k of ['match_window_seconds', 'anchor_lag_seconds']) if (x[k] !== undefined && !(typeof x[k] === 'number' && x[k] > 0)) p.push(`${k} must be a positive number`)
  return p
}

export interface LoadedManifest { input: MonitorInput; refused: string[] }

const text = (name: string, buf: Uint8Array): string => {
  if (buf.length > MAX_FILE_BYTES) throw new Error(`${name} is ${buf.length} bytes, over the ${MAX_FILE_BYTES}-byte cap`)
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body) } catch { throw new Error(`${name} is not UTF-8`) }
}
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** Read every file a manifest names (read: a path relative to the manifest → its bytes) into the monitor's input. */
export function loadManifest(m: AttestManifest, read: (rel: string) => Uint8Array): LoadedManifest {
  const refused: string[] = []
  const runs: MonitorRun[] = []
  for (const r of m.runs) {
    try {
      const buf = read(r.path)
      const record = readHostRecord(r.format, text(r.path, buf))
      if (r.format === 'api-log' && record.rejected.length) refused.push(`${r.path}: ${record.rejected.length} line(s) are not provider responses (first: line ${record.rejected[0]!.line}, ${record.rejected[0]!.reason})`)
      runs.push({ name: r.name, format: r.format, record, declared: r.declared, ...(r.allowed ? { allowed: r.allowed } : {}), ...(r.provider ? { provider: r.provider } : {}), ...(r.account ? { account: r.account } : {}), file: r.path, sha256: sha(buf) })
    } catch (e) { refused.push(`${r.path}: ${(e as Error).message}`) }
  }
  const exports: MonitorExport[] = []
  for (const x of m.exports ?? []) {
    try {
      const buf = read(x.path)
      const parsed = parseExport(x.source, text(x.path, buf), { ...(x.columns ? { columns: x.columns } : {}), ...(x.acknowledge ? { acknowledge: x.acknowledge } : {}) })
      for (const why of parsed.refused) refused.push(`${x.path} (${x.source}): ${why}`)
      exports.push({ parsed: { ...parsed, ...(x.account ? { account: x.account } : {}) }, file: x.path, sha256: sha(buf) })
    } catch (e) { refused.push(`${x.path}: ${(e as Error).message}`) }
  }
  const anchors: AnchorSet[] = []
  for (const a of m.anchors ?? []) {
    try {
      const entries = text(a.ledger, read(a.ledger)).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LedgerEntry)
      const set = readAnchors(a.ledger, entries, text(a.public_key, read(a.public_key)))
      if (!set.ok) refused.push(`${a.ledger}: ${set.reason}`)
      anchors.push(set)
    } catch (e) { refused.push(`${a.ledger}: ${(e as Error).message}`) }
  }
  return {
    input: { month: m.month, ...(m.deployer ? { deployer: m.deployer } : {}), runs, exports, anchors, ...(m.match_window_seconds ? { windowSeconds: m.match_window_seconds } : {}), ...(m.anchor_lag_seconds ? { anchorLagSeconds: m.anchor_lag_seconds } : {}) },
    refused,
  }
}
