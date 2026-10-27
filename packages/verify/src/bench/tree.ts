/**
 * The bench tables' own evidence, inside the tree (bench-run/1).
 *
 * Every table `docs/bench/<id>.json` has a folder `docs/bench/<id>/` holding what its emission reads: the prereg, every
 * chain source the prereg check reads (sidecar, hash list, frozen snapshots), the run spec, and the per-case results, plus
 * `run.json`, the manifest that says which file is which:
 *
 *   { "format": "bench-run/1", "id": "<id>", "prereg": "PREREG.md", "results": "results/…" | "results", "spec": "spec.json",
 *     "chains"?: [...], "docs"?: [...], "report"?: "…", "amendment_text"?: [{ "sha256", "from": "PREREG.md:120-140" }],
 *     "stamps"?: [{ "proof": "PREREG.md.tsr", "ca"?: "tsa-ca.pem" }], "unstamped"?: "unstamped (frozen before 2026-10-05)",
 *     "not_shipped"?: [{ "file", "sha256", "reason" }],
 *     "shipped_edited"?: [{ "file", "recorded_sha256", "sha256", "reason" }],
 *     "rerun": { "from_tree": "yes" | "partly" | "no", "detail": "…", "identical"?: "bytes" | "outcomes" },
 *     "blind_basis"?: "…",
 *     "sources": [{ "file", "sha256", "from", "from_sha256"?, "note"? }] }
 *
 * `rerun` is required: every table says whether a reader can rerun its run from this tree (regenerate the per-case results
 * from inputs that ship, with a harness that ships), and what is withheld and why. Re-tallying from shipped results is not
 * a rerun.
 *
 * `shipped_edited` lists a hash-listed file that ships in the folder in bytes other than the recorded ones (a comment line
 * that named a private folder was rewritten), with both sha256s and the reason, apart from `not_shipped`, which is for files
 * that are not in the folder at all. `blind_basis` is required for a table labelled blind: it names the record the label
 * rests on, and every such record in this tree is the authors' own.
 *
 * `sources` says where each file came from (its path inside the run's original folder) and, when the copy was edited (a
 * spec note that named a private path), the original's sha256. Every path is relative to the folder and stays inside it.
 *
 * Every prereg carries a stamp record (bench/table.ts `prereg.stamp`): a third-party proof made before the run, or the
 * label "unstamped (frozen before 2026-10-05)" (only for a run before stamping began), or, for a later run with no proof,
 * "needs stamp", which `checkTree` flags on its line and in its summary. A proof made after its run is listed as what it is:
 * the text existed by then. Every file the folder's hash lists name ships in those bytes or is in `not_shipped`.
 *
 * `checkTree` re-emits every table from its folder and compares byte for byte; it also refuses a table or manifest that
 * names a path outside the tree, a source whose bytes moved, a stamp whose signature or chain fails against the roots in
 * `<tables-dir>/_tsa/`, a hash-listed file that neither ships nor is marked not shipped, a withdrawn run that still has a
 * table, a provenance archive that changed (bench/provenance.ts), and a malformed outside-the-rule list (bench/outside.ts).
 *
 * A preregistered run that has not run (`plannedRuns`) pins the build it will test in its own tables (`| what | version | pin |`,
 * section 2 and any amendment after it). `checkTree` reads those pins (`preregPins`), recomputes each source digest on the tree
 * the tables directory sits in (`pinDigest`), and compares each version with this build (`THIS_BUILD`). A pin that moved is noted,
 * not refused: the line carries `flag: 'stale pins'` and the words `bench check` prints as "STALE PINS <id>: …" (exit 4, like a
 * missing stamp, unless --strict-pins). Cold review round 10 found the shipped blind prereg pinned to an engine and a legal rule
 * this tree no longer builds, with four of its source digests moved, while the check said OK.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { AP_RULESET } from '../ap/index.js'
import { defaultLegalRuleset } from '../legal/index.js'
import { DECLARATIVE_DEFAULT_VERSIONS } from '../rulesets/declarative.js'
import { ENGINE_VERSION } from '../version.js'
import { REFUSED_FORMAT, type RefusedList } from './docs.js'
import { emitTable, type EmitResult } from './emit.js'
import { HELD_FILE, readHeld } from './held.js'
import { BenchRefused, sha256Bytes } from './prereg.js'
import { outsideProblems, type OutsideList } from './outside.js'
import { provenanceProblems, type ProvenanceList } from './provenance.js'
import { listTableFiles } from './spec.js'
import { rerunProblems, STAMPING_FROM, tableBytes, tableProblems, UNSTAMPED_LABEL, type BenchTable, type NotShipped, type Rerun, type ShippedEdited, type StampProof } from './table.js'
import { parseTimestampReply, SHA256_OID, verifyStamp, type OpensslRunner } from './timestamp.js'

export const RUN_FORMAT = 'bench-run/1'

export interface RunSource { file: string; sha256: string; from: string; from_sha256?: string; note?: string }
export interface RunManifest {
  format: typeof RUN_FORMAT
  id: string
  prereg: string
  results?: string
  report?: string
  spec: string
  chains?: string[]
  docs?: string[]
  amendment_text?: { sha256: string; from: string }[]
  /** RFC 3161 proofs of the prereg documents (`<file>.tsr` beside `<file>`), with an optional CA inside the folder. */
  stamps?: { proof: string; ca?: string }[]
  /** The label a prereg frozen before stamping began carries when no listed stamp predates its run (UNSTAMPED_LABEL). */
  unstamped?: string
  /** Files the folder's hash lists (or results) name by sha256 that are not in the folder in those bytes, and why. */
  not_shipped?: NotShipped[]
  /** Files the folder's hash lists name that ship in the folder, edited: both sha256s and why (bench/table.ts `ShippedEdited`). */
  shipped_edited?: ShippedEdited[]
  /** Required: whether a reader can rerun the run from this tree, and what is withheld and why (bench/table.ts `Rerun`). */
  rerun: Rerun
  /** Required for a table labelled blind: the record its blindness rests on (bench/table.ts `RunRef.blind_basis`). */
  blind_basis?: string
  sources: RunSource[]
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** A path that leaves the folder it is written in: absolute, a drive letter, or a `..` segment. */
export const leavesTree = (p: string): boolean => isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..')

/** Internal-path shapes no published table may carry: a parent hop, a drive, or the authors' working folders. */
export const INTERNAL_PATH = /(?:^|[\s"'`(=])(?:\.\.[\\/]|[A-Za-z]:[\\/]|(?:products|workspace|tmp)[\\/])/

const chainFile = (c: string): string => c.replace(/#.*$/, '').replace(/:\d+$/, '')

/** Every problem with a manifest ([] when well formed), checked against the folder it sits in. */
export function manifestProblems(m: unknown, dir: string, id: string): string[] {
  if (!isObj(m) || m.format !== RUN_FORMAT) return [`run.json is not a ${RUN_FORMAT}`]
  const out: string[] = []
  if (m.id !== id) out.push(`run.json names table "${String(m.id)}", but its folder is "${id}"`)
  const paths: [string, unknown][] = [['prereg', m.prereg], ['spec', m.spec]]
  if (m.results !== undefined) paths.push(['results', m.results])
  if (m.report !== undefined) paths.push(['report', m.report])
  if (m.results === undefined && m.report === undefined) out.push('run.json names results, or a report for a transcribed table')
  for (const [k, list] of [['chains', m.chains], ['docs', m.docs]] as const) {
    if (list === undefined) continue
    if (!Array.isArray(list) || !list.every(x => typeof x === 'string')) { out.push(`${k} must be a list of paths`); continue }
    for (const x of list) paths.push([k, k === 'chains' ? chainFile(x) : x])
  }
  for (const [k, p] of paths) {
    if (typeof p !== 'string' || !p) { out.push(`${k} must be a path`); continue }
    if (leavesTree(p)) { out.push(`${k} ${p} leaves the table's folder`); continue }
    if (k !== 'docs' && !existsSync(join(dir, p))) out.push(`${k} ${p} does not exist in the folder`)
  }
  if (m.amendment_text !== undefined && (!Array.isArray(m.amendment_text) || !m.amendment_text.every(a => isObj(a) && typeof a.sha256 === 'string' && typeof a.from === 'string'))) out.push('amendment_text must be [{ sha256, from }]')
  if (m.stamps !== undefined) {
    if (!Array.isArray(m.stamps)) out.push('stamps must be a list')
    else for (const s of m.stamps) {
      if (!isObj(s) || typeof s.proof !== 'string') { out.push('a stamp names its proof'); continue }
      for (const p of [s.proof, s.ca].filter((x): x is string => typeof x === 'string')) if (leavesTree(p) || !existsSync(join(dir, p))) out.push(`stamp file ${p} is not in the folder`)
    }
  }
  if (m.unstamped !== undefined && m.unstamped !== UNSTAMPED_LABEL) out.push(`unstamped, when present, is exactly "${UNSTAMPED_LABEL}"`)
  if (m.not_shipped !== undefined) {
    if (!Array.isArray(m.not_shipped)) out.push('not_shipped must be a list')
    else for (const x of m.not_shipped) {
      if (!isObj(x) || typeof x.file !== 'string' || !x.file || typeof x.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(x.sha256) || typeof x.reason !== 'string' || !x.reason.trim()) { out.push('a not_shipped entry is { file, sha256, reason }'); continue }
      if (leavesTree(x.file) || INTERNAL_PATH.test(` ${x.file}`)) { out.push(`not_shipped ${x.file}: name the file as it sits in the run's folder, not by an internal path`); continue }
      const abs = join(dir, x.file)
      if (existsSync(abs) && !statSync(abs).isDirectory()) {
        const actual = sha256Bytes(readFileSync(abs))
        // a superseded version may be listed while the version a later hash set records ships; anything else in the folder
        // under that name is the listed file, edited
        if (actual === x.sha256) out.push(`not_shipped ${x.file}: those bytes are in the folder, so it ships`)
        else if (!recordedInHashLists(dir).has(actual)) out.push(`not_shipped ${x.file}: a file of that name ships in the folder (sha256 ${actual.slice(0, 12)}…), so list it under shipped_edited with both sha256s`)
      }
    }
  }
  if (m.shipped_edited !== undefined) {
    if (!Array.isArray(m.shipped_edited)) out.push('shipped_edited must be a list')
    else for (const x of m.shipped_edited) {
      const hex = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
      if (!isObj(x) || typeof x.file !== 'string' || !x.file || !hex(x.recorded_sha256) || !hex(x.sha256) || typeof x.reason !== 'string' || !x.reason.trim()) { out.push('a shipped_edited entry is { file, recorded_sha256, sha256, reason }'); continue }
      if (leavesTree(x.file) || INTERNAL_PATH.test(` ${x.file}`)) { out.push(`shipped_edited ${x.file}: name the file as it sits in the run's folder, not by an internal path`); continue }
      if (x.recorded_sha256 === x.sha256) { out.push(`shipped_edited ${x.file}: the shipped sha256 is the recorded one, so it ships unedited`); continue }
      const abs = join(dir, x.file)
      if (!existsSync(abs) || statSync(abs).isDirectory()) { out.push(`shipped_edited ${x.file}: not in the folder, so list it under not_shipped`); continue }
      const actual = sha256Bytes(readFileSync(abs))
      if (actual !== x.sha256) out.push(`shipped_edited ${x.file}: the file in the folder has sha256 ${actual.slice(0, 12)}…, not the ${String(x.sha256).slice(0, 12)}… run.json records`)
    }
  }
  if (m.blind_basis !== undefined) {
    if (typeof m.blind_basis !== 'string' || !m.blind_basis.trim()) out.push('blind_basis, when given, names the record a blind label rests on')
    else if (INTERNAL_PATH.test(` ${m.blind_basis}`)) out.push('blind_basis names an internal path: name files as they sit in this tree')
  }
  if (m.rerun === undefined) out.push('run.json says whether the run reruns from this tree: rerun { from_tree: yes | partly | no, detail }')
  else {
    const rp = rerunProblems(m.rerun)
    out.push(...rp)
    if (!rp.length && INTERNAL_PATH.test(` ${(m.rerun as Rerun).detail}`)) out.push('rerun.detail names an internal path: name files as they sit in this tree')
  }
  if (!Array.isArray(m.sources) || !m.sources.length) out.push('sources must list where each copied file came from')
  else for (const s of m.sources) {
    if (!isObj(s) || typeof s.file !== 'string' || typeof s.sha256 !== 'string' || typeof s.from !== 'string') { out.push('a source is { file, sha256, from }'); continue }
    if (leavesTree(s.file)) { out.push(`source ${s.file} leaves the folder`); continue }
    if (INTERNAL_PATH.test(` ${s.from}`)) out.push(`source ${s.file}: "from" must name the file inside its run's folder, not an internal path`)
    const abs = join(dir, s.file)
    if (!existsSync(abs) || statSync(abs).isDirectory()) out.push(`source ${s.file} does not exist`)
    else if (sha256Bytes(readFileSync(abs)) !== s.sha256) out.push(`source ${s.file} changed after it was copied in (sha256 differs from run.json)`)
  }
  return out
}

/** Read a table folder's manifest; throws BenchRefused when it is missing or malformed. */
export function readManifest(dir: string, id: string): RunManifest {
  const file = join(dir, 'run.json')
  if (!existsSync(file)) throw new BenchRefused('no-folder', `table ${id} has no in-tree folder with run.json: its prereg and results are not in the tree`)
  let m: unknown
  try { m = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { throw new BenchRefused('bad-manifest', `${id}/run.json is not JSON: ${(e as Error).message}`) }
  const p = manifestProblems(m, dir, id)
  if (p.length) throw new BenchRefused('bad-manifest', `${id}/run.json: ${p.join('; ')}`)
  return m as RunManifest
}

/** Emit a table from its in-tree folder: every path resolves in the folder and is written relative to it. */
export function emitFromFolder(dir: string, id: string): EmitResult {
  const m = readManifest(dir, id)
  const out = emitTable({
    prereg: m.prereg, spec: m.spec, cwd: dir,
    ...(m.results !== undefined ? { results: m.results } : {}),
    ...(m.report !== undefined ? { report: m.report } : {}),
    ...(m.chains?.length ? { chains: m.chains } : {}),
    ...(m.docs?.length ? { docs: m.docs } : {}),
    ...(m.amendment_text?.length ? { amendmentText: m.amendment_text } : {}),
    stampState: { proofs: (m.stamps ?? []).map(s => s.proof), ...(m.unstamped !== undefined ? { unstamped: m.unstamped } : {}) },
    ...(m.not_shipped?.length ? { notShipped: m.not_shipped } : {}),
    ...(m.shipped_edited?.length ? { shippedEdited: m.shipped_edited } : {}),
    rerun: m.rerun,
    ...(m.blind_basis !== undefined ? { blindBasis: m.blind_basis } : {}),
  })
  // a blind label in this tree rests on the authors' own records; the folder names which, or the table is not written
  if (out.table.label === 'blind' && !out.table.run.blind_basis) throw new BenchRefused('bad-manifest', `${id}/run.json: a table labelled blind names the record its blindness rests on (blind_basis): a hash list's time, a fetch log, a note in the prereg`)
  return out
}

/** A token that names a file: a name with an extension that holds a letter (so `0.0.1` and times are not files). */
const FILE_TOKEN = /^[^\s()]*[^\s()/\\]\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/
/** The folder's hash lists: `*.sha256` sidecars and `*HASHES*.txt` lists, at the folder's top level. */
export const isHashList = (name: string): boolean => /\.sha256$/i.test(name) || /HASHES[\w.-]*\.txt$/i.test(name)

/** Every (sha256, file as written) record in a hash list's text: the first file-like token after each full hash. */
export function hashListNames(text: string): { sha256: string; name: string }[] {
  const out: { sha256: string; name: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const h = line.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i)
    if (!h) continue
    const name = line.slice((h.index ?? 0) + 64).trim().split(/\s+/).map(t => t.replace(/^\*/, '').replace(/[,;)]+$/, '')).find(t => FILE_TOKEN.test(t) && !/\d{4}-\d{2}-\d{2}T/.test(t))
    if (name) out.push({ sha256: h[0].toLowerCase(), name: name.replace(/\\/g, '/') })
  }
  return out
}

/** Every sha256 the folder's hash lists record, for any file. */
function recordedInHashLists(dir: string): Set<string> {
  const out = new Set<string>()
  for (const f of readdirSync(dir).filter(isHashList)) for (const r of hashListNames(readFileSync(join(dir, f), 'utf8'))) out.add(r.sha256)
  return out
}

/**
 * Every file a hash list in the folder names either ships there in those bytes, or is listed in run.json `not_shipped` by
 * its sha256, or ships edited and is listed in `shipped_edited` by its recorded sha256. Records naming a prereg document
 * (`PREREG*.md`) are the prereg's own chain, checked by `verify bench emit`.
 */
export function hashListProblems(dir: string, m: RunManifest): string[] {
  const out: string[] = []
  const marked = new Set([...(m.not_shipped ?? []).map(x => x.sha256), ...(m.shipped_edited ?? []).map(x => x.recorded_sha256)])
  for (const f of readdirSync(dir).filter(isHashList).sort()) {
    for (const { sha256, name } of hashListNames(readFileSync(join(dir, f), 'utf8'))) {
      if (/^PREREG[\w.-]*\.md$/.test(basename(name))) continue
      const abs = leavesTree(name) ? null : join(dir, name)
      if (abs && existsSync(abs) && !statSync(abs).isDirectory() && sha256Bytes(readFileSync(abs)) === sha256) continue
      if (!marked.has(sha256)) out.push(`${f} names ${basename(name)} (sha256 ${sha256.slice(0, 12)}…), which neither ships in the folder in those bytes nor is listed in run.json not_shipped`)
    }
  }
  return out
}

/** Every string in a table that is a path or a quoted record, with where it sits (for the out-of-tree scan). */
function tablePaths(t: BenchTable): [string, string][] {
  const out: [string, string][] = [['prereg.path', t.prereg.path]]
  for (const [k, list] of [['amendments', t.prereg.amendments], ['later', t.prereg.later ?? []]] as const) list.forEach((a, i) => {
    out.push([`prereg.${k}[${i}].recorded_in`, a.recorded_in])
    if (a.text_from) out.push([`prereg.${k}[${i}].text_from`, a.text_from])
  })
  if (t.run.results) out.push(['run.results.path', t.run.results.path])
  return out
}

/** Problems with a table's paths: any that leaves the tree, and any internal-path shape anywhere in its bytes. */
export function outOfTree(t: BenchTable): string[] {
  const out: string[] = []
  for (const [where, p] of tablePaths(t)) if (leavesTree(chainFile(p))) out.push(`${where} ${p} leaves the tree`)
  const text = tableBytes(t)
  text.split('\n').forEach((line, i) => { if (INTERNAL_PATH.test(line)) out.push(`line ${i + 1} of the table names an internal path: ${line.trim().slice(0, 120)}`) })
  return out
}

/**
 * A line of `bench check`. `flag` marks what is noted, not refused: a prereg that NEEDS STAMP, or a preregistered run whose pins
 * no longer match the tree (`stale` then holds the words of the STALE PINS line).
 */
export interface TreeLine { id: string; status: 'MATCH' | 'DIFFERS' | 'REFUSED' | 'OK' | 'FAIL'; detail: string; flag?: 'needs stamp' | 'stale pins'; stale?: string }
export interface TreeReport { ok: boolean; lines: TreeLine[] }
/**
 * `openssl` replaces the OpenSSL runner (tests); `ca` replaces the roots shipped in `<tables-dir>/_tsa/`; `pinsRoot` is the
 * repository root a prereg's pins name their paths from (default: four folders above the tables directory, as for the stress
 * rows); `build` replaces this build's engine label and rule defaults (tests).
 */
export interface TreeOptions { openssl?: OpensslRunner; ca?: string[]; pinsRoot?: string; build?: TreeBuild }

/** Check every table in `dir` against its in-tree folder, then the refused list and the provenance rows (see module comment). */
export function checkTree(dir: string, o: TreeOptions = {}): TreeReport {
  const lines: TreeLine[] = []
  const tables = listTableFiles(dir)
  const ids = new Set<string>()
  for (const f of tables) {
    const id = f.replace(/\.json$/, '')
    ids.add(id)
    const bytes = readFileSync(join(dir, f), 'utf8')
    let t: BenchTable
    try { t = JSON.parse(bytes) as BenchTable } catch (e) { lines.push({ id, status: 'FAIL', detail: `not JSON: ${(e as Error).message}` }); continue }
    const shape = tableProblems(t)
    if (shape.length) { lines.push({ id, status: 'FAIL', detail: shape.join('; ') }); continue }
    const paths = outOfTree(t)
    if (paths.length) { lines.push({ id, status: 'FAIL', detail: paths.join('; ') }); continue }
    const folder = join(dir, id)
    try {
      const { table } = emitFromFolder(folder, id)
      const same = tableBytes(table) === bytes
      const manifest = readManifest(folder, id)
      const stamp = stampLines(folder, manifest, dir, o, table.prereg.stamp?.proofs ?? [])
      const listedProofs = new Set((manifest.stamps ?? []).map(s => s.proof))
      const unlisted = [
        ...hashListProblems(folder, manifest),
        ...readdirSync(folder).filter(f => f.endsWith('.tsr') && !listedProofs.has(f)).map(f => `the proof ${f} is in the folder but not listed in run.json stamps, so the table cannot show what it proves`),
      ]
      const status = table.prereg.stamp?.status
      if (!same) lines.push({ id, status: 'DIFFERS', detail: 'the table is not the current emission of its in-tree folder' })
      else if (!status) lines.push({ id, status: 'FAIL', detail: 'the table records no prereg stamp status' })
      else if (stamp.bad.length) lines.push({ id, status: 'FAIL', detail: stamp.bad.join('; ') })
      else if (unlisted.length) lines.push({ id, status: 'FAIL', detail: unlisted.join('; ') })
      else {
        const flag = status === 'needs stamp' ? `prereg NEEDS STAMP: the run (${t.run.date}) came after stamping began and no timestamp proof is in the folder`
          : status === UNSTAMPED_LABEL ? `prereg frozen before stamping began on ${STAMPING_FROM}, so no stamp predates its run`
            : status === 'stamped after the run' ? 'prereg stamped after its run, not before it'
              : `prereg ${status}`
        lines.push({ id, status: 'MATCH', detail: [`re-emitted from ${id}/ byte for byte`, flag, ...stamp.good].join('; '), ...(status === 'needs stamp' ? { flag: 'needs stamp' as const } : {}) })
      }
    } catch (e) {
      lines.push({ id, status: 'REFUSED', detail: e instanceof BenchRefused ? `(${e.code}) ${e.message}` : (e as Error).message })
    }
  }
  const pinsRoot = o.pinsRoot ?? resolve(dir, '..', '..', '..', '..')
  for (const p of plannedRuns(dir, o.build)) {
    if (p.recorded === null) { lines.push({ id: p.id, status: 'FAIL', detail: 'preregistered, not run: PREREG.sha256 records no sha256 for PREREG.md' }); continue }
    if (p.recorded !== p.actual) { lines.push({ id: p.id, status: 'FAIL', detail: `preregistered, not run: PREREG.md (sha256 ${p.actual.slice(0, 12)}…) no longer matches the sha256 its hash list records (${p.recorded.slice(0, 12)}…)` }); continue }
    const tsr = join(dir, p.id, 'PREREG.md.tsr')
    let stamp = 'NOT STAMPED: no timestamp authority has signed it yet'
    if (existsSync(tsr)) {
      if (!p.stamped_at) { lines.push({ id: p.id, status: 'FAIL', detail: 'preregistered, not run: PREREG.md.tsr does not read as a timestamp that covers PREREG.md' }); continue }
      const shared = o.ca ?? (existsSync(join(dir, TSA_ROOTS)) ? [join(dir, TSA_ROOTS)] : [])
      const c = verifyStamp(join(dir, p.id, 'PREREG.md'), tsr, { ...(shared.length ? { ca: shared } : {}), ...(o.openssl ? { openssl: o.openssl } : {}) })
      const failed = c.lines.filter(l => l.startsWith('FAIL'))
      const noOpenssl = failed.length > 0 && failed.every(l => l.startsWith('FAIL signature: openssl could not run'))
      if (failed.length && !noOpenssl) { lines.push({ id: p.id, status: 'FAIL', detail: `preregistered, not run: stamp PREREG.md.tsr: ${failed.join('; ')}` }); continue }
      stamp = `stamped at ${p.stamped_at}${!shared.length ? ', signature not checked (no CA in _tsa/)' : noOpenssl ? ', signature not checked (openssl could not run)' : ', signature and chain verified'}`
    }
    const rest = p.others.length ? `; the folder also holds ${p.others.join(', ')}` : '; the run has not begun (the folder holds no results and no run.json)'
    const pins = checkPins(p.pins, pinsRoot, o.build)
    lines.push({
      id: p.id, status: 'OK', detail: `preregistered, not run: PREREG.md matches the sha256 its hash list records; ${stamp}${rest}${pinSummary(pins)}`,
      ...(pins.stale.length ? { flag: 'stale pins' as const, stale: staleWords(pins, pinsRoot) } : {}),
    })
  }
  const refusedPath = join(dir, '_refused.json')
  if (existsSync(refusedPath)) {
    const r = JSON.parse(readFileSync(refusedPath, 'utf8')) as RefusedList
    if (r.format !== REFUSED_FORMAT || !Array.isArray(r.runs)) lines.push({ id: '_refused', status: 'FAIL', detail: `not a ${REFUSED_FORMAT}` })
    else for (const run of r.runs) {
      if (ids.has(run.id)) lines.push({ id: run.id, status: 'FAIL', detail: 'listed as refused or withdrawn, yet it has a table' })
      else if (run.code === 'withdrawn' && !(run.date && /^\d{4}-\d{2}-\d{2}$/.test(run.date))) lines.push({ id: run.id, status: 'FAIL', detail: 'a withdrawn row carries the date it was withdrawn' })
      else lines.push({ id: run.id, status: 'OK', detail: `${run.code === 'withdrawn' ? `withdrawn ${run.date}` : `refused (${run.code})`}: no table` })
    }
  }
  const provPath = join(dir, '_provenance.json')
  if (existsSync(provPath)) {
    const list = JSON.parse(readFileSync(provPath, 'utf8')) as ProvenanceList
    const p = provenanceProblems(list, dir)
    if (p.length) lines.push({ id: '_provenance', status: 'FAIL', detail: p.join('; ') })
    else for (const e of list.entries) {
      if (ids.has(e.id)) lines.push({ id: e.id, status: 'FAIL', detail: 'a provenance row is never also a table' })
      else lines.push({ id: e.id, status: 'OK', detail: `${e.tier}; archive ${e.provenance.path} matches sha256 ${e.provenance.sha256.slice(0, 12)}…; ${e.rows.length} row(s) recompute` })
    }
  }
  const outPath = join(dir, '_outside.json')
  if (existsSync(outPath)) {
    let list: OutsideList | null = null
    try { list = JSON.parse(readFileSync(outPath, 'utf8')) as OutsideList } catch (e) { lines.push({ id: '_outside', status: 'FAIL', detail: `not JSON: ${(e as Error).message}` }) }
    if (list) {
      const p = outsideProblems(list, ids)
      if (p.length) lines.push({ id: '_outside', status: 'FAIL', detail: p.join('; ') })
      else for (const e of list.entries) lines.push({ id: e.id, status: 'OK', detail: `outside the rule: ${e.reason}` })
    }
  }
  // tables held from this tree (bench/held.ts): absent by declaration, so nothing to re-emit; their misses stay in the ledger
  const { held, problems: heldBad } = readHeld(dir, ids)
  if (heldBad.length) lines.push({ id: HELD_FILE.replace(/\.json$/, ''), status: 'FAIL', detail: heldBad.join('; ') })
  for (const h of held?.tables ?? []) lines.push({ id: h.id, status: 'OK', detail: `held from this tree (${HELD_FILE}): no table and no folder here; its misses stay in the ledger` })
  return { ok: lines.every(l => l.status === 'MATCH' || l.status === 'OK'), lines }
}

/** Whether a version string `a.b.c` is at least `min` (a null or unparseable version is not). */
export function engineAtLeast(v: string | null, min: string): boolean {
  const parse = (x: string): number[] | null => (/^\d+\.\d+\.\d+$/.test(x) ? x.split('.').map(Number) : null)
  const a = v ? parse(v) : null, b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return true
}

/** The timestamp authority roots shipped beside the tables (`<tables-dir>/_tsa/`), trusted for every stamp without its own CA. */
export const TSA_ROOTS = '_tsa/digicert-roots.pem'

/**
 * Each listed stamp's signature and chain, by `openssl ts -verify` against the stamp's own CA or the roots shipped in
 * `<tables-dir>/_tsa/`. Whether it predates the run is the table's own record (prereg.stamp, set at emission). OpenSSL that
 * cannot run is reported, not failed: the imprint and the time were already read from the token at emission.
 */
function stampLines(folder: string, m: RunManifest, dir: string, o: TreeOptions, proofs: readonly StampProof[] = []): { good: string[]; bad: string[] } {
  const good: string[] = [], bad: string[] = []
  const before = new Set(proofs.filter(p => p.before_run).map(p => p.proof))
  const shared = o.ca ?? (existsSync(join(dir, TSA_ROOTS)) ? [join(dir, TSA_ROOTS)] : [])
  for (const s of m.stamps ?? []) {
    const covers = join(folder, s.proof.replace(/\.tsr$/, ''))
    const ca = s.ca ? [join(folder, s.ca)] : shared
    const c = verifyStamp(covers, join(folder, s.proof), { ...(ca.length ? { ca } : {}), ...(o.openssl ? { openssl: o.openssl } : {}) })
    const failed = c.lines.filter(l => l.startsWith('FAIL'))
    const noOpenssl = failed.length > 0 && failed.every(l => l.startsWith('FAIL signature: openssl could not run'))
    if (!c.info || (failed.length && !noOpenssl)) { bad.push(`stamp ${s.proof}: ${failed.join('; ') || 'unreadable'}`); continue }
    good.push(`${before.has(s.proof) ? 'stamped before the run' : 'stamped after'}: ${s.proof} signed ${c.info.gen_time}${!ca.length ? ', signature not checked (no CA in the folder or in _tsa/)' : noOpenssl ? ', signature not checked (openssl could not run)' : ', signature and chain verified'}`)
  }
  return { good, bad }
}

/** The folders a tables directory holds for its tables (for linking from the index). */
export function tableFolders(dir: string): Set<string> {
  return new Set(listTableFiles(dir).map(f => f.replace(/\.json$/, '')).filter(id => existsSync(join(dir, id, 'run.json'))))
}

/**
 * A preregistered run that has not run yet: a folder `<tables-dir>/<id>/` holding `PREREG.md` and its hash list
 * `PREREG.sha256`, with no `run.json` and no table. The index prints it, with whether a timestamp authority has signed it, and
 * `bench check` refuses one whose prereg no longer matches the first sha256 its hash list records for `PREREG.md`.
 */
export interface PlannedRun {
  id: string
  /** The prereg's title: its first Markdown heading. */
  title: string
  /** The first sha256 the hash list records for PREREG.md, or null when it records none. */
  recorded: string | null
  /** The sha256 of PREREG.md as it is now. */
  actual: string
  /** The time the authority signed `PREREG.md.tsr`, when the folder holds one that covers these bytes. */
  stamped_at?: string
  /** Files in the folder besides the prereg, its hash list and its stamp (the run has begun when results appear). */
  others: string[]
  /** The build the prereg pins, read from its own pin tables (`preregPins`); empty when it has none. */
  pins: PreregPin[]
  /** The version pins this build no longer resolves to, in the words of a STALE PINS line (the sources are compared by `checkTree`). */
  stale_versions: string[]
}

/** What this build is, for a preregistration's pins: its engine label, and the version each rule id resolves to when a verdict names none. */
export interface TreeBuild { engine: string; rules: Readonly<Record<string, string>> }
export const THIS_BUILD: TreeBuild = Object.freeze({
  engine: ENGINE_VERSION,
  rules: Object.freeze({ ...DECLARATIVE_DEFAULT_VERSIONS, [AP_RULESET.id]: AP_RULESET.version, [defaultLegalRuleset().id]: defaultLegalRuleset().version }),
})

/**
 * One pin of a preregistration: a row of a table whose header reads `| what | version | pin… |`. Section 2 of a prereg holds the
 * first such table and each amendment may add another; a later row whose `what` cell is the same overrides the earlier one's
 * digest and version, keeps its path when it names none, and is skipped when it carries no full sha256 ("unchanged (`20e0…`)").
 */
export interface PreregPin {
  /** The row's first cell, as written. */
  what: string
  /** Short words for the row on a STALE PINS line: the cell before its first comma, less backticks and parentheses; when two rows share those, the rest follows in parentheses. */
  label: string
  /** The version cell, as written. */
  version: string
  /** The pinned path from the repository root (a folder, or one file), or null when no row for it names one. */
  path: string | null
  /** How its digest is formed: one file's sha256; every `*.ts` at the folder's top level; every file under the folder, recursively. */
  mode: 'file' | 'top' | 'recursive' | null
  sha256: string
  /** The file count the row states, when it states one. */
  files: number | null
}

const cellsOf = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim())
const ticked = (s: string): string[] => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1] as string)
const PATH_TOKEN = /^[\w.@-]+(?:\/[\w.*@-]*)+$/

/** The pinned path in a row: the first backticked path in the pin cell, else in the what cell; and how the row says to hash it. */
function pinPath(what: string, pin: string): { path: string; mode: PreregPin['mode'] } | null {
  const t = ticked(pin).find(x => PATH_TOKEN.test(x)) ?? ticked(what).find(x => PATH_TOKEN.test(x))
  if (!t) return null
  const both = `${what} ${pin}`
  if (/\/\*\.ts$/.test(t)) return { path: t.replace(/\/\*\.ts$/, ''), mode: 'top' }
  if (t.endsWith('/')) return { path: t.replace(/\/+$/, ''), mode: /\brecursively\b/i.test(both) ? 'recursive' : /`\*\.ts`\s+at its top level/i.test(both) ? 'top' : null }
  return { path: t, mode: 'file' }
}

/** Every pin a prereg's text fixes, in the order section 2 first names them, each as its latest table row leaves it. */
export function preregPins(text: string): PreregPin[] {
  const lines = text.split(/\r?\n/)
  const byWhat = new Map<string, Omit<PreregPin, 'label'>>()
  for (let i = 0; i < lines.length; i++) {
    const head = (lines[i] as string).trim()
    if (!head.startsWith('|')) continue
    const h = cellsOf(head).map(c => c.toLowerCase())
    if (h.length < 3 || h[0] !== 'what' || h[1] !== 'version' || !(h[2] as string).startsWith('pin')) continue
    if (!/^\|[\s|:-]+$/.test((lines[i + 1] ?? '').trim())) continue
    for (i += 2; i < lines.length && (lines[i] as string).trim().startsWith('|'); i++) {
      const c = cellsOf(lines[i] as string)
      if (c.length < 3) continue
      const what = (c[0] as string).replace(/\s+/g, ' '), version = c[1] as string, pin = c.slice(2).join(' | ')
      const sha = pin.match(/`([0-9a-f]{64})`/)
      if (!sha) continue
      const prior = byWhat.get(what)
      const at = pinPath(what, pin)
      const files = pin.match(/\((\d+) files?\)/)
      byWhat.set(what, { what, version, path: at?.path ?? prior?.path ?? null, mode: at?.mode ?? prior?.mode ?? null, sha256: sha[1] as string, files: files ? Number(files[1]) : prior?.files ?? null })
    }
  }
  const bare = (w: string): string => w.replace(/`[^`]*`/g, '').replace(/\s*\([^)]*\)/g, '').trim()
  const short = (w: string): string => (bare(w).split(',')[0] as string).trim()
  // comma-free, so a list of labels stays readable: "e-invoice ruleset (scored beside it)"
  const long = (w: string): string => { const rest = bare(w).split(',').slice(1).join(',').trim(); return rest ? `${short(w)} (${rest})` : short(w) }
  const pins = [...byWhat.values()]
  const shared = (w: string): boolean => pins.filter(p => short(p.what) === short(w)).length > 1
  return pins.map(p => ({ ...p, label: shared(p.what) ? long(p.what) : short(p.what) }))
}

function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const f of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${f}` : f
    if (statSync(join(dir, r)).isDirectory()) out.push(...filesUnder(dir, r)); else out.push(r)
  }
  return out
}

/**
 * A pin's digest recomputed on the tree at `root`, the way the prereg defines it (and `apPackDigest` computes the AP pack's):
 * sha256 over "<sha256 of the file>  <path>\n" per file, sorted by path, paths relative to the folder and written with `/`; one
 * file's own sha256 for a file pin. Null when the pinned path is not in that tree.
 */
export function pinDigest(root: string, p: PreregPin): { sha256: string; files: number } | null {
  if (!p.path || !p.mode) return null
  const abs = join(root, ...p.path.split('/'))
  if (!existsSync(abs)) return null
  if (p.mode === 'file') return statSync(abs).isFile() ? { sha256: sha256Bytes(readFileSync(abs)), files: 1 } : null
  if (!statSync(abs).isDirectory()) return null
  const names = p.mode === 'top' ? readdirSync(abs).filter(f => f.endsWith('.ts') && statSync(join(abs, f)).isFile()) : filesUnder(abs)
  return { sha256: sha256Bytes([...names].sort().map(f => `${sha256Bytes(readFileSync(join(abs, f)))}  ${f}\n`).join('')), files: names.length }
}

/**
 * Each version a pin names that this build no longer resolves to: the engine row against the engine label, and a rule
 * (`<id>@<version>`) against the version this build gives that rule when a verdict names none. A single file pinned beside the
 * default (a ruleset "scored beside it") is held to its bytes only; a row that says it is the default is held to the default.
 */
function versionWords(p: PreregPin, build: TreeBuild): string[] {
  if (/^engine\b/i.test(p.what)) {
    const v = p.version.match(/\d+\.\d+\.\d+/)?.[0]
    return v && v !== build.engine ? [`engine ${v} pinned, tree ${build.engine}`] : []
  }
  if (p.mode === 'file' && !/\bdefault\b/i.test(p.what)) return []
  const out: string[] = []
  for (const m of p.version.matchAll(/([A-Za-z][\w-]*)@(\d+\.\d+\.\d+)/g)) {
    const id = m[1] as string, tree = build.rules[id]
    if (tree !== undefined && tree !== m[2]) out.push(`${id}@${m[2]} pinned, tree ${id}@${tree}`)
  }
  return out
}

/** A prereg's pins against a tree: what matches, what moved (STALE PINS words), and what could not be recomputed there. */
export interface PinCheck { total: number; matched: number; stale: string[]; staleVersions: string[]; unrecomputed: string[]; pathless: string[] }

/** Compare every pin with this build (versions) and, when `root` is given, with the tree there (digests). */
export function checkPins(pins: readonly PreregPin[], root: string | null, build: TreeBuild = THIS_BUILD): PinCheck {
  const r: PinCheck = { total: pins.length, matched: 0, stale: [], staleVersions: [], unrecomputed: [], pathless: [] }
  for (const p of pins) {
    const v = versionWords(p, build)
    r.staleVersions.push(...v)
    r.stale.push(...v)
    let ok = !v.length
    const what = p.mode === 'file' ? `${p.label} file` : `${p.label} sources`
    if (!p.path || !p.mode) { r.pathless.push(what); ok = false } else if (root === null) { r.unrecomputed.push(what); ok = false } else {
      const d = pinDigest(root, p)
      if (!d) { r.unrecomputed.push(what); ok = false } else if (d.sha256 !== p.sha256) {
        const counts = p.files !== null && p.files !== d.files
        r.stale.push(`${what} ${p.sha256.slice(0, 8)}…${counts ? ` (${p.files} files)` : ''} pinned, tree ${d.sha256.slice(0, 8)}…${counts ? ` (${d.files} files)` : ''}`)
        ok = false
      }
    }
    if (ok) r.matched++
  }
  return r
}

/** The pin words on a planned run's OK line. */
function pinSummary(c: PinCheck): string {
  if (!c.total) return ''
  const unchecked = c.unrecomputed.length + c.pathless.length
  if (!unchecked) return `; pins: ${c.matched} of ${c.total} match this tree`
  return `; pins: ${c.total - unchecked} of ${c.total} recomputed here (the pinned paths are not under this tree); ${c.staleVersions.length ? `${c.staleVersions.length} version pin(s) moved` : 'the versions they name match this build'}`
}

/** The words after "STALE PINS <id>: ": every pin that moved, then what could not be recomputed and why. */
function staleWords(c: PinCheck, root: string): string {
  return [
    ...c.stale,
    ...(c.unrecomputed.length ? [`not recomputed here, because the pinned paths are not under ${root} (give --pins-root <the tree's root>): ${c.unrecomputed.join(', ')}`] : []),
    ...(c.pathless.length ? [`not recomputed: the prereg names no path for ${c.pathless.join(', ')}`] : []),
  ].join('; ')
}

export function plannedRuns(dir: string, build: TreeBuild = THIS_BUILD): PlannedRun[] {
  const tables = new Set(listTableFiles(dir).map(f => f.replace(/\.json$/, '')))
  const out: PlannedRun[] = []
  for (const id of readdirSync(dir).sort()) {
    const folder = join(dir, id)
    if (id.startsWith('_') || !statSync(folder).isDirectory() || tables.has(id)) continue
    if (existsSync(join(folder, 'run.json')) || !existsSync(join(folder, 'PREREG.md')) || !existsSync(join(folder, 'PREREG.sha256'))) continue
    const bytes = readFileSync(join(folder, 'PREREG.md'))
    const actual = sha256Bytes(bytes)
    const title = (bytes.toString('utf8').match(/^#\s+(.+)$/m)?.[1] ?? id).trim()
    const recorded = hashListNames(readFileSync(join(folder, 'PREREG.sha256'), 'utf8')).find(r => basename(r.name) === 'PREREG.md')?.sha256 ?? null
    const pins = preregPins(bytes.toString('utf8'))
    const r: PlannedRun = { id, title, recorded, actual, others: readdirSync(folder).filter(f => !['PREREG.md', 'PREREG.sha256', 'PREREG.md.tsr', 'PREREG.md.tsq'].includes(f)).sort(), pins, stale_versions: checkPins(pins, null, build).staleVersions }
    const tsr = join(folder, 'PREREG.md.tsr')
    if (existsSync(tsr)) {
      try {
        const info = parseTimestampReply(readFileSync(tsr))
        if (info.imprint_algorithm === SHA256_OID && info.imprint === actual) r.stamped_at = info.gen_time
      } catch { /* an unreadable proof is not a stamp; the check line says so */ }
    }
    out.push(r)
  }
  return out
}
