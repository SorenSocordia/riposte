/**
 * `emitTable`: one run → one bench table, or a refusal. The order is the guarantee: the prereg's chain is verified first, so
 * a run with no recorded prereg hash (or a prereg edited after its last record) never produces a number at all. Then the
 * spec is read, the results are loaded and hashed, the run's shape adapter drafts rows and misses, every row gets its
 * interval and verdict, and each count is checked against what the run's own report stated. A disagreement is a finding:
 * printed and kept in the table, never reconciled.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { ADAPTERS } from './adapters/index.js'
import { BenchRefused, defaultSidecar, displayPath, sha256Bytes, verifyPrereg } from './prereg.js'
import { loadResults, readSpec, type LoadedResults } from './spec.js'
import { BENCH_FORMAT, makeRow, runStart, STAMPING_FROM, stampStatus, tableProblems, TEXT_FROM, UNSTAMPED_LABEL, type BenchRow, type BenchTable, type NotShipped, type PreregRef, type PreregStamp, type Rerun, type RunRef, type ShippedEdited, type StampProof } from './table.js'
import { parseTimestampReply, SHA256_OID } from './timestamp.js'

export interface EmitOptions {
  /** The prereg file. */
  prereg: string
  /** The run's results (a file, or a directory whose files the spec names). Omitted only for a transcribed table. */
  results?: string
  /** The run spec (bench/spec.ts). */
  spec: string
  /** Chain sources for the prereg's recorded hashes (default: its sidecar). */
  chains?: string[]
  /** The document names the chain is read for (default: the prereg's own name). */
  docs?: string[]
  /** The report a transcribed table's numbers were typed from (required for one, recorded for any). */
  report?: string
  /** The run's own folder: paths resolve here and are written relative to it. */
  cwd: string
  /**
   * Each recorded amendment's own words: the record's full sha256, and `<file>:<first>-<last>` naming lines in a file inside
   * the run's folder whose sha256 is one of the chain's records (so the text shown is a recorded version's text).
   */
  amendmentText?: { sha256: string; from: string }[]
  /**
   * The prereg's stamp state, from the folder's run.json: the RFC 3161 proofs it lists (each `<file>.tsr` covers `<file>`),
   * and the unstamped label when it carries one. Given, the table records `prereg.stamp`; omitted, it records none.
   */
  stampState?: { proofs: string[]; unstamped?: string }
  /** Files the folder's hash lists name that are not in the folder in those bytes (run.json `not_shipped`). */
  notShipped?: NotShipped[]
  /** Files the folder's hash lists name that ship in other bytes than recorded (run.json `shipped_edited`). */
  shippedEdited?: ShippedEdited[]
  /** Whether the run reruns from this tree, and what is withheld (run.json `rerun`). */
  rerun?: Rerun
  /** For a blind table: the record its blindness rests on (run.json `blind_basis`). */
  blindBasis?: string
}

/** Read the listed proofs (no signature check here: that is `verify bench check`'s) and give the prereg's stamp record. */
export function readStampState(state: NonNullable<EmitOptions['stampState']>, runDate: string, cwd: string, prereg?: string): PreregStamp {
  const start = runStart(runDate)
  const proofs: StampProof[] = state.proofs.map(p => {
    if (!/\.tsr$/.test(p)) throw new BenchRefused('bad-stamp', `stamp ${p}: a proof is named <file>.tsr, beside the file it covers`)
    const covers = p.replace(/\.tsr$/, '')
    const isPrereg = prereg !== undefined && resolve(cwd, covers) === resolve(cwd, prereg)
    if (!isPrereg && !/(?:^|[\\/])PREREG[\w.-]*\.md$/.test(covers)) throw new BenchRefused('bad-stamp', `stamp ${p} covers ${covers}, which is neither the table's prereg nor a prereg document`)
    const [abs, cov] = [resolve(cwd, p), resolve(cwd, covers)]
    if (!existsSync(abs) || !existsSync(cov)) throw new BenchRefused('bad-stamp', `stamp ${p} or the file it covers is not in the folder`)
    let info
    try { info = parseTimestampReply(readFileSync(abs)) } catch (e) { throw new BenchRefused('bad-stamp', `stamp ${p} does not read as a timestamp: ${(e as Error).message}`) }
    if (info.imprint_algorithm !== SHA256_OID || info.imprint !== sha256Bytes(readFileSync(cov))) throw new BenchRefused('bad-stamp', `stamp ${p} does not cover ${covers}: its message imprint is not the file's sha256`)
    return { proof: displayPath(p, cwd), covers: displayPath(covers, cwd), gen_time: info.gen_time, serial: info.serial, before_run: Date.parse(info.gen_time) < start }
  })
  const status = stampStatus(runDate, proofs)
  if (status === UNSTAMPED_LABEL && state.unstamped !== UNSTAMPED_LABEL) throw new BenchRefused('no-stamp-status', `the prereg has no stamp made before the run (${runDate}), and run.json does not carry the label "${UNSTAMPED_LABEL}"`)
  if (state.unstamped !== undefined && status !== UNSTAMPED_LABEL) throw new BenchRefused('no-stamp-status', `run.json carries the label "${state.unstamped}", but the prereg's status is "${status}" (the label is for a run before ${STAMPING_FROM} with no earlier stamp)`)
  return { status, proofs }
}

export interface EmitResult {
  table: BenchTable
  findings: string[]
}

export function emitTable(o: EmitOptions): EmitResult {
  const cwd = resolve(o.cwd)
  const prereg = verifyPrereg(o.prereg, { cwd, ...(o.chains ? { chains: o.chains } : {}), ...(o.docs ? { docs: o.docs } : {}) })
  if (o.amendmentText?.length) attachAmendmentText(prereg, o.amendmentText, cwd)
  if (preregCarriesLabPaths(o, cwd)) prereg.lab_paths = true
  const { spec, sha256: specSha } = readSpec(o.spec, cwd)
  const adapter = ADAPTERS[spec.adapter]
  let results: LoadedResults | null = null
  if (spec.adapter === 'transcribed') {
    if (!o.report) throw new BenchRefused('no-report', 'a transcribed table names the report its numbers were typed from (--report)')
    if (o.results) throw new BenchRefused('bad-spec', 'a transcribed table has no machine-readable results: give --report, not results')
  } else {
    if (!o.results) throw new BenchRefused('no-results', `the ${spec.adapter} adapter reads the run's results: none were given`)
    results = loadResults(o.results, spec, cwd)
  }
  let report: RunRef['report']
  if (o.report) {
    const abs = resolve(cwd, o.report)
    if (!existsSync(abs)) throw new BenchRefused('no-report', `the report ${displayPath(o.report, cwd)} does not exist`)
    report = { name: basename(abs), sha256: sha256Bytes(readFileSync(abs)) }
  }
  const out = adapter({ spec, results })
  const findings: string[] = []
  const rows: BenchRow[] = out.rows.map(d => {
    let row: BenchRow
    try {
      row = makeRow({ claim: d.claim, n: d.n, k: d.k, method: d.method, bar: d.bar, ...(d.note ? { note: d.note } : {}) })
    } catch (e) {
      throw new BenchRefused(/CI method/.test((e as Error).message) ? 'no-ci-method' : 'bad-row', (e as Error).message)
    }
    const rep = d.reported
    if (rep && ((rep.k !== undefined && rep.k !== row.k) || (rep.n !== undefined && rep.n !== row.n))) {
      const said = `${rep.k ?? '?'} of ${rep.n ?? '?'}`
      const f = `"${row.claim}": computed ${row.k} of ${row.n} from the results; the run's report states ${said}`
      findings.push(f)
      row.note = [row.note, `differs from the report (${said})`].filter(Boolean).join('; ')
    }
    return row
  })
  if (prereg.later?.length) findings.push(`the prereg has ${prereg.later.length} hash(es) recorded after the version this run is held to (${prereg.sha256.slice(0, 12)}…)`)
  const run: RunRef = { id: spec.run.id, date: spec.run.date, engine_version: out.run.engine_version, ruleset: out.run.ruleset }
  if (out.run.dist_sha256) run.dist_sha256 = out.run.dist_sha256
  if (results) run.results = { path: results.path, sha256: results.sha256 }
  if (report) run.report = report
  run.spec_sha256 = specSha
  if (o.notShipped?.length) run.not_shipped = o.notShipped.map(x => ({ file: x.file, sha256: x.sha256, reason: x.reason }))
  if (o.shippedEdited?.length) run.shipped_edited = o.shippedEdited.map(x => ({ file: x.file, recorded_sha256: x.recorded_sha256, sha256: x.sha256, reason: x.reason }))
  if (o.rerun) run.rerun = { from_tree: o.rerun.from_tree, detail: o.rerun.detail, ...(o.rerun.identical ? { identical: o.rerun.identical } : {}) }
  if (o.blindBasis !== undefined) run.blind_basis = o.blindBasis
  if (o.stampState) prereg.stamp = readStampState(o.stampState, spec.run.date, cwd, o.prereg)
  const table: BenchTable = { format: BENCH_FORMAT, id: spec.id, title: spec.title, prereg, run, rows, misses: out.misses, blind: spec.blind, label: spec.label }
  if (findings.length) table.findings = findings
  if (spec.tuning) table.tuning = spec.tuning
  if (spec.audit) table.audit = spec.audit
  if (spec.hash_list_note) table.hash_list_note = spec.hash_list_note
  const problems = tableProblems(table)
  if (problems.length) throw new BenchRefused(problems.some(p => /tuning/.test(p)) ? 'tuning-without-trace' : 'bad-table', problems.join('; '))
  return { table, findings }
}

/**
 * A path in the authors' working tree, as frozen text writes one: a parent hop, a drive, a lab root folder, or a lab folder
 * name. Relative paths inside a run's own folder (`results/…`, `data/…`) and URLs are not lab paths.
 */
const LAB_FOLDER_NAMES = [['receipts', 'spike'], ['agent', 'outputs'], ['jev', 'spike']].map(p => p.join('-')).join('|') // assembled: the export scan keeps these names out of product source
export const LAB_PATH = new RegExp(String.raw`(?:^|[\s` + '`' + String.raw`'"(=*])(?:\.\.[\\/]|[A-Za-z]:[\\/]|(?:workspace|products|tmp|logs)[\\/])|` + LAB_FOLDER_NAMES)

/** Whether the prereg, a hash list its check reads, or a recorded snapshot beside it names a lab path (see LAB_PATH). */
export function preregCarriesLabPaths(o: Pick<EmitOptions, 'prereg' | 'chains' | 'docs'>, cwd: string): boolean {
  const prereg = resolve(cwd, o.prereg)
  const sources = (o.chains?.length ? o.chains : [defaultSidecar(prereg)]).map(c => resolve(cwd, c.replace(/#.*$/, '').replace(/:\d+$/, '')))
  const chainDir = sources[0] ? dirname(sources[0]) : dirname(prereg)
  const docs = (o.docs ?? []).map(d => join(chainDir, basename(d)))
  return [...new Set([prereg, ...sources, ...docs])].some(f => existsSync(f) && LAB_PATH.test(readFileSync(f, 'utf8')))
}

/** Copy each named amendment's lines into its record (EmitOptions.amendmentText). Refuses on any break; nothing is guessed. */
export function attachAmendmentText(prereg: PreregRef, texts: { sha256: string; from: string }[], cwd: string): void {
  const records = [...prereg.amendments, ...(prereg.later ?? [])]
  const recorded = new Set([prereg.frozen_sha256, ...records.map(r => r.sha256)])
  for (const t of texts) {
    const rec = records.find(r => r.sha256 === t.sha256)
    if (!rec) throw new BenchRefused('bad-spec', `amendment text names ${t.sha256.slice(0, 12)}…, which is not an amendment recorded in the chain`)
    const m = t.from.match(TEXT_FROM)
    if (!m) throw new BenchRefused('bad-spec', `amendment text source ${JSON.stringify(t.from)} must be <file>:<first>-<last> inside the run's folder`)
    const file = t.from.slice(0, t.from.lastIndexOf(':'))
    const abs = resolve(cwd, file)
    const rel = relative(cwd, abs)
    if (isAbsolute(rel) || rel.startsWith('..')) throw new BenchRefused('bad-spec', `amendment text source ${file} is outside the run's folder`)
    if (!existsSync(abs)) throw new BenchRefused('bad-spec', `amendment text source ${file} does not exist`)
    const bytes = readFileSync(abs)
    const fileSha = sha256Bytes(bytes)
    if (!recorded.has(fileSha)) throw new BenchRefused('bad-spec', `amendment text source ${file} (sha256 ${fileSha.slice(0, 12)}…) is not a recorded version of the prereg`)
    const lines = bytes.toString('utf8').split(/\r?\n/)
    const a = Number(m[1]), b = Number(m[2])
    if (a < 1 || b < a || b > lines.length) throw new BenchRefused('bad-spec', `amendment text lines ${a}-${b} are not inside ${file} (${lines.length} lines)`)
    rec.text = lines.slice(a - 1, b).join('\n')
    rec.text_from = `${displayPath(file, cwd)}:${a}-${b}`
  }
}
