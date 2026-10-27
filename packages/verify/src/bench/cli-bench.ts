/**
 * `verify bench emit | index | check | stamp | stamp-verify`: the bench tool's command line.
 *
 *   verify bench emit <prereg.md> [<results.json|dir>] --spec <spec.json> [--out <table.json>]
 *                     [--chain <source>]… [--doc <name>]… [--report <report.md>]
 *       One run → one bench table (stdout, or --out). Refuses (exit 1, nothing written) when the prereg has no recorded
 *       sha256, was edited after its last record, or a recorded snapshot changed; when the results are missing; when a row
 *       is malformed or names no CI method. Paths resolve in, and are written relative to, the current directory: run it
 *       from the run's own folder.
 *   verify bench emit <tables-dir>/<id> [--out <table.json>]
 *       The same, from a table's in-tree folder: its run.json names the prereg, chain, spec and results (bench/tree.ts).
 *   verify bench index <tables-dir> [--bench-md <file>] [--misses-md <file>] [--ledger <file>] [--refused <file>]
 *       Every table in the directory → the index page and the misses ledger. The ledger (default <tables-dir>/_misses-ledger.json)
 *       is regenerated against itself: a dropped or altered row refuses (exit 1, nothing written); a fix may be added. A
 *       withdrawn run's misses (in the refused list) stay in the ledger. `_provenance.json`, when present, is printed as rows
 *       outside the bench rule, with their archive. `_held.json`, when present, names tables held from the tree (bench/held.ts):
 *       their rows stay in the ledger as recorded and are marked on MISSES.md, and BENCH.md lists them with no numbers.
 *   verify bench check <tables-dir> [--allow-unstamped] [--stress <dir>] [--pack <dir>] [--strict-pins] [--pins-root <dir>]
 *       Every table re-emitted from its in-tree folder and compared byte for byte; every path inside the tree; withdrawn
 *       runs have no table; provenance archives match their sha256; and, when the directory declares them (_stress.json),
 *       every banked AP stress row names the AP pack digest, engine and ruleset this tree builds (bench/stress.ts); and a
 *       preregistered run that has not run (a folder with PREREG.md and PREREG.sha256, no run.json, no table) still matches
 *       the sha256 its hash list records, with its stamp, if any, verified, and the build its pin tables name is still this
 *       tree's: each version against this build, each source digest recomputed on the tree (a STALE PINS line names every
 *       pin that moved). A copied tables directory needs --stress and --pack, because _stress.json names its folders from the
 *       repository root, four folders above the tables directory, and --pins-root for the same reason.
 *       Exit 0 when all of it holds; 1 on any DIFFERS, refusal or failure; 4 when everything matches but a prereg run
 *       after stamping began has no stamp (NEED A STAMP), unless --allow-unstamped accepts that knowingly, or a planned
 *       run's pins moved (STALE PINS), unless --strict-pins refuses that (exit 1).
 *   verify bench check <table.json> <prereg.md> [<results>] --spec <spec.json> [--chain …] [--doc …] [--report …]
 *       Re-emit one run from its own folder and compare byte for byte: exit 0 when the table is the current emission.
 *   verify bench stamp <file> [--out <query.tsq>] [--tsa <url>]
 *   verify bench stamp-verify <file> <proof.tsr> [--ca <root.pem>]... [--untrusted <certs.pem>] [--query <query.tsq>]
 *       RFC 3161 timestamps for a prereg (bench/timestamp.ts). `stamp` contacts nothing unless --tsa is given.
 *
 * Exit codes: 0 ok, 1 refused, differs or not verified, 3 usage or error, 4 (bench check over a tables directory) every table
 * and the stress rows match, but a prereg NEEDS A STAMP and --allow-unstamped was not given, or a planned run's pins moved and
 * --strict-pins was not given. `bench index` refuses (exit 1, nothing written) when the changelog contradicts the version file.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { engineLabels, PageRefused, renderBenchIndex, renderMisses, REFUSED_FORMAT, withdrawnLabels, type RefusedList } from './docs.js'
import { emitTable, type EmitOptions, type EmitResult } from './emit.js'
import { heldIds, HELD_FILE, readHeld } from './held.js'
import { asLedger, ledgerBytes, LedgerRefused, ledgerSources, mergeLedger, type Ledger } from './ledger.js'
import { BenchRefused, sha256Bytes } from './prereg.js'
import { OUTSIDE_FORMAT, outsideProblems, type OutsideList } from './outside.js'
import { PROVENANCE_FORMAT, provenanceProblems, type ProvenanceList } from './provenance.js'
import { listTableFiles } from './spec.js'
import { checkStress, STRESS_FORMAT, stressProblems, type StressDeclaration } from './stress.js'
import { STAMPING_FROM, tableBytes, tableProblems, type BenchTable } from './table.js'
import { stampFile, TimestampError, verifyStamp } from './timestamp.js'
import { checkTree, emitFromFolder, plannedRuns, tableFolders } from './tree.js'

export interface BenchIO { out: (s: string) => void; err: (s: string) => void }

export const BENCH_USAGE = `usage:
  verify bench emit <prereg.md> [<results.json|dir>] --spec <spec.json> [--out <table.json>] [--chain <source>]... [--doc <name>]... [--report <report.md>]
  verify bench emit <tables-dir>/<id> [--out <table.json>]
  verify bench index <tables-dir> [--bench-md <file>] [--misses-md <file>] [--ledger <file>] [--refused <file>]
  verify bench check <tables-dir> [--allow-unstamped] [--stress <rows-dir>] [--pack <src/ap dir>] [--strict-pins] [--pins-root <repo root>]
  verify bench check <table.json> <prereg.md> [<results.json|dir>] --spec <spec.json> [--chain <source>]... [--doc <name>]... [--report <report.md>]
  verify bench stamp <file> [--out <query.tsq>] [--tsa <url>]
  verify bench stamp-verify <file> <proof.tsr> [--ca <root.pem>]... [--untrusted <certs.pem>] [--query <query.tsq>]
chain sources: <file> (a hash list or sidecar), <file>#<json.path>, <file>:<line>`

interface Parsed { pos: string[]; flags: Map<string, string[]>; problems: string[] }
const REPEATABLE = new Set(['chain', 'doc', 'ca'])
/** Flags that take no value. */
const BOOLEAN = new Set(['allow-unstamped', 'strict-pins'])
/** Flags only the tables-directory form of bench check reads. */
const TREE_ONLY = ['allow-unstamped', 'stress', 'pack', 'strict-pins', 'pins-root']
const KNOWN: Record<string, readonly string[]> = {
  emit: ['spec', 'out', 'chain', 'doc', 'report'],
  check: ['spec', 'chain', 'doc', 'report', 'allow-unstamped', 'stress', 'pack', 'strict-pins', 'pins-root'],
  index: ['bench-md', 'misses-md', 'ledger', 'refused'],
  stamp: ['out', 'tsa'],
  'stamp-verify': ['ca', 'untrusted', 'query'],
}
const VERBS = Object.keys(KNOWN)

function parse(sub: string, argv: string[]): Parsed {
  const pos: string[] = [], flags = new Map<string, string[]>(), problems: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    if (!t.startsWith('--')) { pos.push(t); continue }
    const name = t.slice(2)
    if (!(KNOWN[sub] ?? []).includes(name)) { problems.push(`unknown flag ${t} for bench ${sub}`); continue }
    if (BOOLEAN.has(name)) {
      if (flags.has(name)) problems.push(`${t} given twice`)
      else flags.set(name, ['true'])
      continue
    }
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) { problems.push(`${t} needs a value`); continue }
    i++
    const list = flags.get(name) ?? []
    if (list.length && !REPEATABLE.has(name)) { problems.push(`${t} given twice`); continue }
    list.push(v)
    flags.set(name, list)
  }
  return { pos, flags, problems }
}

const one = (p: Parsed, k: string): string | undefined => p.flags.get(k)?.[0]
const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory()

function emitOptions(prereg: string, results: string | undefined, p: Parsed): EmitOptions {
  const o: EmitOptions = { prereg, spec: one(p, 'spec') as string, cwd: process.cwd() }
  if (results !== undefined) o.results = results
  if (p.flags.get('chain')) o.chains = p.flags.get('chain')!
  if (p.flags.get('doc')) o.docs = p.flags.get('doc')!
  const report = one(p, 'report')
  if (report !== undefined) o.report = report
  return o
}

const usage = (io: BenchIO, msg: string): number => { io.err(`verify bench: ${msg}\n${BENCH_USAGE}\n`); return 3 }

function summary(t: BenchTable): string {
  const v = { PASS: 0, FAIL: 0, INSUFFICIENT: 0, 'POST-HOC': 0 }
  for (const r of t.rows) v[r.verdict]++
  const am = t.prereg.amendments.length
  // a row held to another run's bar has no verdict of its own; it is counted apart, and only when there is one
  const reused = v['POST-HOC'] ? ` · POST-HOC ${v['POST-HOC']} (another run's bar, no verdict)` : ''
  return `${t.id}: ${t.rows.length} row(s) (PASS ${v.PASS} · FAIL ${v.FAIL} · INSUFFICIENT ${v.INSUFFICIENT}${reused}), ${t.misses.length} miss(es), label ${t.label}; prereg ${t.prereg.sha256.slice(0, 12)}… (frozen ${t.prereg.frozen_sha256.slice(0, 12)}…, ${am} amendment(s))`
}

function runEmit(p: Parsed, io: BenchIO, check: boolean): number {
  const verb = check ? 'check' : 'emit'
  // the in-tree forms: `emit <tables-dir>/<id>` and `check <tables-dir>` (one directory, no --spec)
  if (!one(p, 'spec') && p.pos.length === 1 && isDir(p.pos[0] as string)) return check ? runCheckTree(p.pos[0] as string, p, io) : runEmitFolder(p, io)
  const treeOnly = TREE_ONLY.filter(f => p.flags.has(f))
  if (treeOnly.length) return usage(io, `${treeOnly.map(f => `--${f}`).join(', ')} apply only to bench check <tables-dir>`)
  const pos = check ? p.pos.slice(1) : p.pos
  if (!one(p, 'spec')) return usage(io, `bench ${verb} needs --spec <spec.json>, or a ${check ? 'tables directory' : 'table\'s in-tree folder'}`)
  if (pos.length < 1 || pos.length > 2) return usage(io, `bench ${verb} takes ${check ? '<table.json> ' : ''}<prereg.md> and, unless the table is transcribed, <results>`)
  if (check && !p.pos[0]) return usage(io, 'bench check needs <table.json>')
  return finishEmit(() => emitTable(emitOptions(pos[0] as string, pos[1], p)), p, io, check ? (p.pos[0] as string) : null)
}

function runEmitFolder(p: Parsed, io: BenchIO): number {
  const dir = resolve(p.pos[0] as string)
  return finishEmit(() => emitFromFolder(dir, basename(dir)), p, io, null)
}

function finishEmit(make: () => EmitResult, p: Parsed, io: BenchIO, checkFile: string | null): number {
  const verb = checkFile ? 'check' : 'emit'
  try {
    const { table, findings } = make()
    for (const f of findings) io.err(`verify bench ${verb}: finding: ${f}\n`)
    const bytes = tableBytes(table)
    if (checkFile) {
      const file = resolve(checkFile)
      if (!existsSync(file)) { io.err(`verify bench check: ${checkFile} does not exist\n`); return 3 }
      const same = readFileSync(file, 'utf8') === bytes
      io.err(`verify bench check: ${same ? 'MATCH' : 'DIFFERS'}: ${summary(table)}\n`)
      return same ? 0 : 1
    }
    const out = one(p, 'out')
    if (out) writeFileSync(out, bytes)
    else io.out(bytes)
    io.err(`verify bench emit: ${summary(table)}${out ? ` → ${out}` : ''}\n`)
    return 0
  } catch (e) {
    if (e instanceof BenchRefused) { io.err(`verify bench ${verb}: REFUSED (${e.code}): ${e.message}\n`); return 1 }
    io.err(`verify bench ${verb}: error: ${(e as Error).message}\n`)
    return 3
  }
}

function runCheckTree(dirArg: string, p: Parsed, io: BenchIO): number {
  try {
    const dir = resolve(dirArg)
    const pinsRoot = one(p, 'pins-root')
    const r = checkTree(dir, pinsRoot !== undefined ? { pinsRoot: resolve(pinsRoot) } : {})
    for (const l of r.lines) io.err(`verify bench check: ${l.status.padEnd(7)} ${l.id}: ${l.detail}\n`)
    const rowsFlag = one(p, 'stress'), packFlag = one(p, 'pack')
    const stress = checkStress(dir, { ...(rowsFlag !== undefined ? { rows: rowsFlag } : {}), ...(packFlag !== undefined ? { pack: packFlag } : {}) })
    if (stress) io.err(`verify bench check: ${stress.status.padEnd(7)} stress: ${stress.detail}\n`)
    const ok = r.ok && (!stress || stress.status === 'MATCH')
    const tables = r.lines.filter(l => ['MATCH', 'DIFFERS', 'REFUSED'].includes(l.status) || (l.status === 'FAIL' && !l.id.startsWith('_')))
    const stressWords = !stress ? '' : stress.status === 'MATCH' ? `; stress rows: ${stress.files} of ${stress.files} file(s) carry the AP pack digest this tree builds` : `; stress rows: ${stress.status} (see the stress line above${stress.status === 'FAIL' && rowsFlag === undefined && packFlag === undefined ? '; on a copied tables directory give --stress and --pack' : ''})`
    io.err(`verify bench check: ${ok ? 'ALL MATCH' : 'NOT ALL MATCH'}: ${r.lines.filter(l => l.status === 'MATCH').length} of ${tables.length} table(s) re-emitted from the tree byte for byte; ${r.lines.filter(l => l.status === 'OK').length} refused, withdrawn, provenance or outside-the-rule row(s) consistent${stressWords}\n`)
    const needs = r.lines.filter(l => l.flag === 'needs stamp').map(l => l.id)
    if (needs.length) io.err(`verify bench check: ${needs.length} prereg(s) NEED A STAMP (a run after stamping began, with no timestamp proof in its folder): ${needs.join(', ')}\n`)
    // a planned run whose pins moved: noted (exit 4) like a missing stamp, refused under --strict-pins
    const stale = r.lines.filter(l => l.flag === 'stale pins')
    for (const l of stale) io.err(`verify bench check: STALE PINS ${l.id}: ${l.stale}\n`)
    const staleIds = stale.map(l => l.id).join(', ')
    if (!ok) return 1
    if (stale.length && p.flags.has('strict-pins')) {
      io.err(`verify bench check: REFUSED by --strict-pins: ${stale.length} preregistration(s) pin a build other than this tree: ${staleIds}\n`)
      return 1
    }
    let code = 0
    if (needs.length && !p.flags.has('allow-unstamped')) {
      io.err(`verify bench check: exit 4: the stamp rule (BENCH.md) asks for a timestamp before every run from ${STAMPING_FROM}, and the ${needs.length} prereg(s) above have none. Stamp each with bench stamp <file> --tsa <url>, or pass --allow-unstamped to accept them knowingly\n`)
      code = 4
    } else if (needs.length) io.err(`verify bench check: ${needs.length} unstamped prereg(s) accepted by --allow-unstamped\n`)
    if (stale.length) {
      io.err(`verify bench check: exit 4: ${stale.length} preregistration(s) pin a build other than this tree: ${staleIds}. A run under one as frozen would not test the build it names; re-pin it in an amendment, hashed and stamped before any data is touched, or pass --strict-pins to refuse instead\n`)
      code = 4
    }
    return code
  } catch (e) {
    io.err(`verify bench check: error: ${(e as Error).message}\n`)
    return 3
  }
}

function runIndex(p: Parsed, io: BenchIO): number {
  if (p.pos.length !== 1) return usage(io, 'bench index takes one <tables-dir>')
  const dir = resolve(p.pos[0] as string)
  if (!existsSync(dir)) { io.err(`verify bench index: ${p.pos[0]} does not exist\n`); return 3 }
  const ledgerPath = one(p, 'ledger') ?? join(dir, '_misses-ledger.json')
  const refusedPath = one(p, 'refused') ?? join(dir, '_refused.json')
  const provPath = join(dir, '_provenance.json')
  try {
    // the engine labels first: a changelog that contradicts the version file refuses before anything is written
    const changelog = join(dir, '..', '..', 'CHANGELOG.md')
    const engine = engineLabels(existsSync(changelog) ? readFileSync(changelog, 'utf8') : null)
    const tables: BenchTable[] = []
    const shas = new Map<string, string>()
    for (const f of listTableFiles(dir)) {
      const bytes = readFileSync(join(dir, f))
      const t = JSON.parse(bytes.toString('utf8')) as BenchTable
      const problems = tableProblems(t)
      if (problems.length) { io.err(`verify bench index: REFUSED: ${f} is not a well-formed table: ${problems.join('; ')}\n`); return 1 }
      if (`${t.id}.json` !== f) { io.err(`verify bench index: REFUSED: ${f} holds table "${t.id}" (a table lives in <id>.json)\n`); return 1 }
      tables.push(t)
      shas.set(t.id, sha256Bytes(bytes))
    }
    let refused: RefusedList | null = null, refusedSha: string | null = null
    if (existsSync(refusedPath)) {
      const bytes = readFileSync(refusedPath)
      refused = JSON.parse(bytes.toString('utf8')) as RefusedList
      if (refused.format !== REFUSED_FORMAT || !Array.isArray(refused.runs)) { io.err(`verify bench index: REFUSED: ${refusedPath} is not a ${REFUSED_FORMAT}\n`); return 1 }
      refusedSha = sha256Bytes(bytes)
    }
    let outside: OutsideList | null = null, outsideSha: string | null = null
    const outPath = join(dir, '_outside.json')
    if (existsSync(outPath)) {
      const bytes = readFileSync(outPath)
      outside = JSON.parse(bytes.toString('utf8')) as OutsideList
      const problems = outsideProblems(outside, new Set(tables.map(t => t.id)))
      if (problems.length) { io.err(`verify bench index: REFUSED: _outside.json is not a well-formed ${OUTSIDE_FORMAT}: ${problems.join('; ')}\n`); return 1 }
      outsideSha = sha256Bytes(bytes)
    }
    let provenance: ProvenanceList | null = null, provenanceSha: string | null = null
    if (existsSync(provPath)) {
      const bytes = readFileSync(provPath)
      provenance = JSON.parse(bytes.toString('utf8')) as ProvenanceList
      const problems = provenanceProblems(provenance, dir)
      if (problems.length) { io.err(`verify bench index: REFUSED: _provenance.json is not a well-formed ${PROVENANCE_FORMAT}: ${problems.join('; ')}\n`); return 1 }
      provenanceSha = sha256Bytes(bytes)
    }
    let stress: StressDeclaration | null = null
    const stressPath = join(dir, '_stress.json')
    if (existsSync(stressPath)) {
      const x = JSON.parse(readFileSync(stressPath, 'utf8')) as unknown
      const problems = stressProblems(x)
      if (problems.length) { io.err(`verify bench index: REFUSED: _stress.json is not a well-formed ${STRESS_FORMAT}: ${problems.join('; ')}\n`); return 1 }
      stress = x as StressDeclaration
    }
    const amendmentPath = stress ? join(dir, stress.amendment) : null
    const stressAmendment = amendmentPath && existsSync(amendmentPath) ? readFileSync(amendmentPath, 'utf8') : null
    // a preregistered run that has not run: its prereg must still be the text its hash list records, or nothing is written
    const planned = plannedRuns(dir)
    const bad = planned.filter(r => r.recorded !== r.actual)
    if (bad.length) { io.err(`verify bench index: REFUSED: ${bad.map(r => `${r.id}/PREREG.md does not match the sha256 its hash list records`).join('; ')}\n`); return 1 }
    // tables held from this tree (_held.json): their ledger rows stay as recorded, and the pages say they are held
    const { held, problems: heldBad } = readHeld(dir, new Set(tables.map(t => t.id)))
    if (heldBad.length) { io.err(`verify bench index: REFUSED: ${HELD_FILE}: ${heldBad.join('; ')}\n`); return 1 }
    const prior: Ledger | null = existsSync(ledgerPath) ? asLedger(JSON.parse(readFileSync(ledgerPath, 'utf8'))) : null
    const { ledger, added, fixed } = mergeLedger(prior, ledgerSources(tables, (refused?.runs ?? []).filter(r => r.code === 'withdrawn')), heldIds(held))
    const lbytes = ledgerBytes(ledger)
    writeFileSync(ledgerPath, lbytes)
    const benchMd = one(p, 'bench-md'), missesMd = one(p, 'misses-md')
    if (benchMd) writeFileSync(benchMd, renderBenchIndex(tables, shas, refused, refusedSha, { provenance, provenanceSha, outside, outsideSha, folders: tableFolders(dir), stress, planned, engine, stressAmendment, held }))
    if (missesMd) writeFileSync(missesMd, renderMisses(ledger, sha256Bytes(lbytes), withdrawnLabels(refused), heldIds(held)))
    io.err(`verify bench index: ${tables.length} table(s), ${refused?.runs.length ?? 0} refused or withdrawn run(s), ${provenance?.entries.length ?? 0} provenance row set(s), ${outside?.entries.length ?? 0} outside-the-rule row(s); ledger ${ledger.rows.length} row(s) (${added} added, ${fixed} newly fixed)${held ? `; ${held.tables.length} table(s) held from this tree, their rows kept` : ''}${planned.length ? `; ${planned.length} preregistered run(s) not yet run` : ''}\n`)
    return 0
  } catch (e) {
    if (e instanceof LedgerRefused || e instanceof PageRefused) { io.err(`verify bench index: REFUSED (${e.code}): ${e.message}\n`); return 1 }
    io.err(`verify bench index: error: ${(e as Error).message}\n`)
    return 3
  }
}

function runStamp(p: Parsed, io: BenchIO): number {
  if (p.pos.length !== 1) return usage(io, 'bench stamp takes one <file>')
  try {
    const tsa = one(p, 'tsa'), out = one(p, 'out')
    const r = stampFile(p.pos[0] as string, { ...(tsa ? { tsa } : {}), ...(out ? { out } : {}) })
    io.err(`verify bench stamp: ${p.pos[0]} sha256 ${r.sha256}; query → ${r.query}\n`)
    if (!r.check) { io.err(`verify bench stamp: ${r.message}\nthen: verify bench stamp-verify ${p.pos[0]} ${p.pos[0]}.tsr --ca <the authority's root certificate(s)> --query ${r.query}\n`); return 0 }
    for (const l of r.check.lines) io.err(`verify bench stamp:   ${l}\n`)
    const bad = r.check.lines.some(l => l.startsWith('FAIL'))
    io.err(`verify bench stamp: ${bad ? 'the reply does not cover this file' : `${r.message}; reply → ${r.reply}`}\n`)
    return bad ? 1 : 0
  } catch (e) {
    io.err(`verify bench stamp: ${e instanceof TimestampError ? `REFUSED (${e.code})` : 'error'}: ${(e as Error).message}\n`)
    return e instanceof TimestampError && e.code !== 'no-file' ? 1 : 3
  }
}

function runStampVerify(p: Parsed, io: BenchIO): number {
  if (p.pos.length !== 2) return usage(io, 'bench stamp-verify takes <file> <proof.tsr>')
  const [file, proof] = p.pos as [string, string]
  const ca = p.flags.get('ca') ?? []
  for (const f of [file, proof, ...ca, one(p, 'untrusted'), one(p, 'query')]) if (f !== undefined && !existsSync(f)) { io.err(`verify bench stamp-verify: ${f} does not exist\n`); return 3 }
  const untrusted = one(p, 'untrusted'), query = one(p, 'query')
  const c = verifyStamp(file, proof, { ...(ca.length ? { ca } : {}),...(untrusted ? { untrusted } : {}), ...(query ? { query: readFileSync(query) } : {}) })
  for (const l of c.lines) io.err(`verify bench stamp-verify:   ${l}\n`)
  io.err(`verify bench stamp-verify: ${c.ok ? `VERIFIED: ${file} existed by ${c.info!.gen_time}, per the authority's signature` : 'NOT VERIFIED'}\n`)
  return c.ok ? 0 : 1
}

export function runBench(argv: string[], io: BenchIO): number {
  const [sub, ...rest] = argv
  if (sub === undefined || sub === '-h' || sub === '--help') { io.err(`${BENCH_USAGE}\n`); return sub === undefined ? 3 : 0 }
  if (!VERBS.includes(sub)) return usage(io, `the verbs are bench ${VERBS.join(', ')} (got "${sub}")`)
  const p = parse(sub, rest)
  if (p.problems.length) return usage(io, p.problems.join('; '))
  if (sub === 'index') return runIndex(p, io)
  if (sub === 'stamp') return runStamp(p, io)
  if (sub === 'stamp-verify') return runStampVerify(p, io)
  return runEmit(p, io, sub === 'check')
}
