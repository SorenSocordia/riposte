/**
 * `riposte-attest monitor` (also the bin `riposte-attest-monitor`): the model-switch monitor's command, as a function over an
 * injected file system (the bins in ./attest-cli.ts and ./attest-monitor-cli.ts only do I/O).
 *
 *   riposte-attest monitor run <manifest.json> --out <dir> [--ledger <receipts.jsonl> --key <ed25519-private.pem>]
 *        Writes attest-report.md and attest-report.json. With --ledger, signs one model_attest_report receipt (holding both
 *        files' sha256) onto the ledger, under its single-writer lock. Exit 0: no flags · 1: flags · 3: refused or usage.
 *   riposte-attest monitor parse --source <id> <export-file> [--columns <map.json>] [--acknowledge <field>]...
 *        Parses one provider export strictly and prints what it read, the unknown fields and what was assumed. Exit 0 or 3.
 *   riposte-attest monitor anchor <host-record> --format <fmt> --run <name> --ledger <file> --key <private.pem>
 *        Anchors every reply's id and recorded model onto a signed ledger (T3), for a hook to run after each turn.
 *   riposte-attest monitor synth --seed <n> --out <dir> [--month YYYY-MM]
 *        Writes a synthetic month (host records, provider exports, an anchor ledger, a manifest and the planted truth).
 *   riposte-attest monitor tiers
 *        Prints the evidence tiers.
 *
 * Nothing here calls the network. Only ids, times, model fields, token counts and command tags are read from any record.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Ledger } from './ledger.js'
import { readHostRecord, HOST_FORMATS, type HostFormat } from './attest-monitor/hosts.js'
import { parseExport, EXPORT_SOURCES, EXPORT_SCHEMAS, type ExportSource, type CsvColumnMap } from './attest-monitor/exports.js'
import { manifestProblems, loadManifest, type AttestManifest } from './attest-monitor/manifest.js'
import { runMonitor } from './attest-monitor/monitor.js'
import { renderAttestReport, attestReportJson, signAttestReport } from './attest-monitor/report.js'
import { anchorReplies } from './attest-monitor/anchor.js'
import { synthAttestMonth } from './attest-monitor/synth.js'
import { TIERS, TIER_ORDER, tierTable } from './attest-monitor/tiers.js'

export const MONITOR_USAGE = [
  'riposte-attest monitor run <manifest.json> --out <dir> [--ledger <receipts.jsonl> --key <private.pem>]',
  'riposte-attest monitor parse --source <id> <export-file> [--columns <map.json>] [--acknowledge <field>]...',
  'riposte-attest monitor anchor <host-record> --format <claude-code|codex|api-log> --run <name> --ledger <file> --key <private.pem>',
  'riposte-attest monitor synth --seed <n> --out <dir> [--month YYYY-MM]',
  'riposte-attest monitor tiers',
].join('\n')

export interface MonitorIo {
  readFile(path: string): Uint8Array
  writeFile(path: string, data: string): void
  mkdir(path: string): void
  /** open a ledger file for appending, under its single-writer lock; release() gives the lock back */
  openLedger(path: string, signingKeyPem?: string): { ledger: Ledger; release(): void }
}
export interface CliResult { code: number; out: string; err: string }

const usage = (msg: string): CliResult => ({ code: 3, out: '', err: `${msg}\n${MONITOR_USAGE}\n` })
const decode = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '')

function flags(argv: string[], known: { values: string[]; repeat?: string[]; bools?: string[] }): { pos: string[]; opt: Record<string, string>; rep: Record<string, string[]>; bool: Set<string>; error?: string } {
  const pos: string[] = [], opt: Record<string, string> = {}, rep: Record<string, string[]> = {}, bool = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (known.bools?.includes(name)) { bool.add(name); continue }
      if (!known.values.includes(name) && !known.repeat?.includes(name)) return { pos, opt, rep, bool, error: `unknown option ${a}` }
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) return { pos, opt, rep, bool, error: `${a} needs a value` }
      if (known.repeat?.includes(name)) (rep[name] ??= []).push(v); else opt[name] = v
    } else pos.push(a)
  }
  return { pos, opt, rep, bool }
}

export function monitorCli(argv: string[], io: MonitorIo): CliResult {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') return { code: sub ? 0 : 3, out: '', err: `${MONITOR_USAGE}\n` }
  try {
    if (sub === 'tiers') return { code: 0, out: `${tierTable()}\n\n${TIER_ORDER.map((t) => `${t}: raise by: ${TIERS[t].raise_by}`).join('\n')}\n`, err: '' }
    if (sub === 'run') return runCmd(rest, io)
    if (sub === 'parse') return parseCmd(rest, io)
    if (sub === 'anchor') return anchorCmd(rest, io)
    if (sub === 'synth') return synthCmd(rest, io)
    return usage(`unknown sub-command ${sub}`)
  } catch (e) {
    return { code: 3, out: '', err: `refused: ${(e as Error).message}\n` }
  }
}

function runCmd(argv: string[], io: MonitorIo): CliResult {
  const f = flags(argv, { values: ['out', 'ledger', 'key'] })
  if (f.error) return usage(f.error)
  const [manifestPath] = f.pos
  if (!manifestPath || f.pos.length > 1) return usage('one manifest')
  if (!f.opt.out) return usage('--out <dir> is required')
  if (f.opt.key && !f.opt.ledger) return usage('--key signs onto --ledger: give both')
  let m: unknown
  try { m = JSON.parse(decode(io.readFile(manifestPath))) } catch (e) { return { code: 3, out: '', err: `refused: cannot read the manifest ${manifestPath}: ${(e as Error).message}\n` } }
  const problems = manifestProblems(m)
  if (problems.length) return { code: 3, out: '', err: `refused: the manifest has problems:\n  ${problems.join('\n  ')}\n` }
  const base = dirname(resolve(manifestPath))
  const loaded = loadManifest(m as AttestManifest, (rel) => io.readFile(isAbsolute(rel) ? rel : join(base, rel)))
  if (loaded.refused.length) return { code: 3, out: '', err: `refused, nothing guessed:\n  ${loaded.refused.join('\n  ')}\n` }
  const result = runMonitor(loaded.input)
  const md = renderAttestReport(result), json = attestReportJson(result)
  io.mkdir(f.opt.out)
  io.writeFile(join(f.opt.out, 'attest-report.md'), md)
  io.writeFile(join(f.opt.out, 'attest-report.json'), json)
  let receipt = ''
  if (f.opt.ledger) {
    const key = f.opt.key ? decode(io.readFile(f.opt.key)) : undefined
    const { ledger, release } = io.openLedger(f.opt.ledger, key)
    try {
      const e = signAttestReport(ledger, result, json, md)
      receipt = ` · receipt seq ${e.seq} ${e.hash.slice(0, 16)}…${e.signature ? ' signed' : ' UNSIGNED (no --key)'}`
    } finally { release() }
  }
  const t = result.totals
  const summary = { month: result.month, runs: t.runs, replies: t.replies, flags: t.flags, silent_switches: t.silent_switches, violations: t.violations, contradictions: t.contradictions, bucket_shortfalls: t.bucket_shortfalls, by_tier: t.by_tier, coverage_any: t.coverage_any }
  return { code: t.flags ? 1 : 0, out: `${JSON.stringify(summary, null, 2)}\n`, err: `monitor: ${t.replies} replies in ${t.runs} runs · ${t.flags} flags · coverage ${t.coverage_any}/${t.replies}${receipt}\n` }
}

function parseCmd(argv: string[], io: MonitorIo): CliResult {
  const f = flags(argv, { values: ['source', 'columns'], repeat: ['acknowledge'] })
  if (f.error) return usage(f.error)
  const source = f.opt.source as ExportSource | undefined
  if (!source || !EXPORT_SOURCES.includes(source)) return usage(`--source must be one of ${EXPORT_SOURCES.join(', ')}`)
  const [file] = f.pos
  if (!file || f.pos.length > 1) return usage('one export file')
  const columns = f.opt.columns ? JSON.parse(decode(io.readFile(f.opt.columns))) as CsvColumnMap : undefined
  const p = parseExport(source, decode(io.readFile(file)), { ...(columns ? { columns } : {}), ...(f.rep.acknowledge ? { acknowledge: f.rep.acknowledge } : {}) })
  const s = EXPORT_SCHEMAS[source]
  const models = [...new Set(p.rows.map((r) => r.model ?? '(none)'))].sort()
  const summary = { source, rows: p.rows.length, granularity: s.granularity, models, unknown_fields: p.unknown_fields, acknowledged: p.acknowledged, refused: p.refused, notes: p.notes, schema: s.doc, verified: s.verified, assumed: s.assumed, reads: s.reads, ...(p.covers ? { covers: p.covers } : {}) }
  return { code: p.refused.length ? 3 : 0, out: `${JSON.stringify(summary, null, 2)}\n`, err: p.refused.length ? `refused, nothing guessed:\n  ${p.refused.join('\n  ')}\n` : `parse: ${p.rows.length} rows · ${models.length} model(s)\n` }
}

function anchorCmd(argv: string[], io: MonitorIo): CliResult {
  const f = flags(argv, { values: ['format', 'run', 'ledger', 'key'] })
  if (f.error) return usage(f.error)
  const [file] = f.pos
  if (!file || f.pos.length > 1) return usage('one host record')
  const format = f.opt.format as HostFormat | undefined
  if (!format || !HOST_FORMATS.includes(format)) return usage(`--format must be one of ${HOST_FORMATS.join(', ')}`)
  if (!f.opt.run || !f.opt.ledger || !f.opt.key) return usage('--run, --ledger and --key are required (an anchor is only worth its signature)')
  const record = readHostRecord(format, decode(io.readFile(file)))
  const { ledger, release } = io.openLedger(f.opt.ledger, decode(io.readFile(f.opt.key)))
  try {
    const r = anchorReplies(ledger, record, f.opt.run)
    return { code: 0, out: `${JSON.stringify(r)}\n`, err: `anchor: ${r.anchored} new · ${r.skipped} skipped (already anchored, or no id or model)\n` }
  } finally { release() }
}

function synthCmd(argv: string[], io: MonitorIo): CliResult {
  const f = flags(argv, { values: ['seed', 'out', 'month'] })
  if (f.error) return usage(f.error)
  if (!f.opt.out || !f.opt.seed || !/^\d+$/.test(f.opt.seed)) return usage('--seed <integer> and --out <dir> are required')
  if (f.opt.month && !/^\d{4}-\d{2}$/.test(f.opt.month)) return usage('--month must be YYYY-MM')
  const s = synthAttestMonth({ seed: Number(f.opt.seed), ...(f.opt.month ? { month: f.opt.month } : {}) })
  for (const [rel, body] of Object.entries(s.files)) { io.mkdir(dirname(join(f.opt.out, rel))); io.writeFile(join(f.opt.out, rel), body) }
  io.writeFile(join(f.opt.out, 'manifest.json'), `${JSON.stringify(s.manifest, null, 2)}\n`)
  io.writeFile(join(f.opt.out, 'truth.json'), `${JSON.stringify(s.truth, null, 2)}\n`)
  return { code: 0, out: '', err: `synth: ${s.manifest.runs.length} runs, ${s.manifest.exports?.length ?? 0} exports, seed ${f.opt.seed} → ${f.opt.out} (synthetic: invented model ids, not a customer)\n` }
}
