/**
 * The two generated pages: `docs/BENCH.md` (every bench table, the rows outside the bench rule with their provenance, and
 * the runs the tool refused or withdrew) and `docs/MISSES.md` (the misses ledger). Every figure on either page is inside a
 * generated block naming the JSON it came from and that JSON's sha256 (bench/marker.ts). Nothing here reads a clock: the
 * same inputs give the same pages. Nothing here types a fact about the tree either: the engine labels come from the version
 * file and the changelog (`engineLabels`), the stress rows' re-bank history from their amendment file (`rebankHistory`), the
 * default legal rule from the legal module, and a planned run's moved pins from its own prereg (bench/tree.ts).
 */

import { BLOCK_END, blockBegin } from './marker.js'
import { HELD_FILE, HELD_MARK, type HeldList } from './held.js'
import type { Ledger } from './ledger.js'
import type { OutsideList } from './outside.js'
import type { ProvenanceList } from './provenance.js'
import type { StressDeclaration } from './stress.js'
import type { PlannedRun } from './tree.js'
import { rerunWords, runStart, STAMPING_FROM, UNSTAMPED_LABEL, type BenchLabel, type BenchMiss, type BenchRow, type BenchTable, type PreregHash } from './table.js'
import { ENGINE_VERSION, ENGINE_VERSIONS } from '../version.js'
import { defaultLegalRuleset } from '../legal/index.js'

/** A page the generator will not write because the tree contradicts itself (`bench index` exits 1 and writes nothing). */
export class PageRefused extends Error {
  readonly code = 'page-stale'
  constructor(message: string) { super(message); this.name = 'PageRefused' }
}

/** The engine labels the page states: the open one, every closed one below it, and the closing dates the changelog gives. */
export interface EngineLabels { open: string; closed: string[]; dated: { version: string; date: string }[] }

const SEMVER = String.raw`\d+\.\d+\.\d+`

/**
 * The engine labels from the tree, never typed. The open label is the version file's ENGINE_VERSION (src/version.ts); the closed
 * ones are every label below it in ENGINE_VERSIONS (a label closes when a later one is opened above it); the changelog's
 * "**<label> closed on <date>" lines date them. A changelog that calls the open label closed, dates a label the version file does
 * not hold below the open one, or whose summary sentence ("Engines A to B are closed; C, the label this tree builds, is open")
 * disagrees with the version file refuses (PageRefused): the page would contradict the tree. `o` replaces the version file (tests).
 */
export function engineLabels(changelog: string | null, o: { versions?: readonly string[]; open?: string } = {}): EngineLabels {
  const versions = o.versions ?? ENGINE_VERSIONS
  const open = o.open ?? ENGINE_VERSION
  const at = versions.indexOf(open)
  if (at < 0) throw new PageRefused(`the open label ${open} is not in the version list`)
  const closed = versions.slice(0, at)
  const text = changelog ?? ''
  const dated: EngineLabels['dated'] = []
  for (const m of text.matchAll(new RegExp(String.raw`^\*\*(${SEMVER}) closed on (\d{4}-\d{2}-\d{2})\b`, 'gm'))) {
    const v = m[1] as string, d = m[2] as string
    if (v === open) throw new PageRefused(`CHANGELOG.md says ${v} closed on ${d}, but it is the label this build carries (ENGINE_VERSION in src/version.ts); a label closes only when a later one is opened above it`)
    if (!closed.includes(v)) throw new PageRefused(`CHANGELOG.md says ${v} closed on ${d}, but the version file holds no such label below ${open}`)
    dated.push({ version: v, date: d })
  }
  const s = text.match(new RegExp(String.raw`Engines\s+(${SEMVER})\s+to\s+(${SEMVER})\s+are\s+closed;\s+(${SEMVER}),\s+the\s+label\s+this\s+tree\s+builds,\s+is\s+open`))
  if (s && (s[3] !== open || s[1] !== closed[0] || s[2] !== closed[closed.length - 1])) {
    throw new PageRefused(`CHANGELOG.md says engines ${s[1]} to ${s[2]} are closed and ${s[3]} is open, but the version file says ${closed.length ? `${closed[0]} to ${closed[closed.length - 1]} are closed and ` : ''}${open} is open`)
  }
  return { open, closed, dated }
}

/** The sentence the page prints for the labels. */
function engineSentence(e: EngineLabels): string {
  const c = e.closed
  const closedWords = !c.length ? 'no label below it exists' : c.length === 1 ? `engine ${c[0]} is closed` : `engines ${c[0]} to ${c[c.length - 1]} are closed`
  const dates = e.dated.length ? ` (${e.dated.map(d => `${d.version} on ${d.date}`).join(', ')})` : ''
  return `Engine ${e.open}, the label today's build carries, is open; ${closedWords}${dates}.`
}

/** One re-bank the stress amendment file records: an amendment's heading, or a dated "**Re-bank, <date> …**" entry inside one. */
export interface Rebank { date: string; title: string }

/**
 * The re-bank history of the AP stress rows, read from the amendment file `_stress.json` names: each top- or second-level heading
 * that names an amendment is one re-bank, dated by the first date in it, and each paragraph inside one that opens with a bold
 * "Re-bank, <date> …" is one more. Nothing is typed: the page prints what the file holds, through its last entry.
 */
export function rebankHistory(text: string): { amendments: number; rebanks: Rebank[] } {
  const rebanks: Rebank[] = []
  let amendments = 0
  for (const raw of text.split(/\r?\n/)) {
    const h = raw.match(/^#{1,2}\s+(.*\bamendment\b.*)$/i)
    if (h) {
      const title = (h[1] as string).trim()
      amendments++
      rebanks.push({ date: title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? 'undated', title })
      continue
    }
    const r = raw.match(/^\*\*(Re-bank, (\d{4}-\d{2}-\d{2})[^*]*?)\.?\*\*/)
    if (r) rebanks.push({ date: r[2] as string, title: (r[1] as string).trim() })
  }
  return { amendments, rebanks }
}

const COUNT_WORDS: Record<string, number> = {
  once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}

/** Every re-bank count typed into the provenance rows and the outside-the-rule list ("re-banked eleven times"), as written. */
function typedRebankCounts(extras: IndexExtras): { words: string; n: number | null }[] {
  const texts = [
    ...(extras.provenance?.entries ?? []).flatMap(e => e.rows.flatMap(r => [r.claim, r.note])),
    ...(extras.outside?.entries ?? []).flatMap(e => [e.title, e.numbers, e.reason]),
  ]
  const out: { words: string; n: number | null }[] = []
  for (const t of texts) for (const m of (t ?? '').matchAll(/\bre-banked\s+(?:(\w+)\s+times|(once|twice))\b/gi)) {
    const w = (m[1] ?? m[2] ?? '').toLowerCase()
    out.push({ words: m[1] ? `${w} times` : w, n: /^\d+$/.test(w) ? Number(w) : COUNT_WORDS[w] ?? null })
  }
  return out
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The stress paragraph's history lines, from the amendment file, and a note when typed text on the page counts differently. */
function rebankLines(text: string, extras: IndexExtras): string[] {
  const h = rebankHistory(text)
  if (!h.rebanks.length) return []
  const byDate = new Map<string, number>()
  for (const r of h.rebanks) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1)
  const last = h.rebanks.slice(-2)
  const L = [
    `**Re-bank history, from that file.** The rows were re-banked ${plural(h.rebanks.length, 'time', 'times')} over ${plural(h.amendments, 'amendment', 'amendments')}: ${[...byDate].map(([d, n]) => `${n} on ${d}`).join(', ')}.`,
    `The last ${last.length === 1 ? 'one' : 'two'}: ${last.map(r => `"${cell(r.title)}"`).join('; ')}.`,
  ]
  const off = [...new Set(typedRebankCounts(extras).filter(c => c.n !== h.rebanks.length).map(c => c.words))]
  if (off.length) L.push(`Typed text further down this page says the rows were re-banked ${off.join(' and ')}; the amendment file records ${h.rebanks.length} re-banks, the last on ${h.rebanks[h.rebanks.length - 1]!.date}. The file is the record, and the typed text is to be corrected to it.`)
  return L
}

export const REFUSED_FORMAT = 'bench-refused/1'
/**
 * A run with published numbers but no table. `code` is the tool's refusal code, or `withdrawn` for a table that was emitted
 * once and taken out of the index (then `date` is the day it was withdrawn, `status` the short reason, and a withdrawn
 * table's misses travel here with its `run_date`, so the ledger keeps them).
 */
export interface RefusedRun { id: string; title: string; code: string; reason: string; date?: string; status?: string; run_date?: string; misses?: BenchMiss[]; label?: string }

/** The words MISSES.md shows for each withdrawn run that carries a `label` (its id stays the ledger's key). */
export const withdrawnLabels = (r: RefusedList | null): Map<string, string> =>
  new Map((r?.runs ?? []).filter(x => x.code === 'withdrawn' && typeof x.label === 'string' && x.label.trim()).map(x => [x.id, x.label as string]))
export interface RefusedList { format: typeof REFUSED_FORMAT; runs: RefusedRun[] }

export interface IndexExtras {
  /** Rows outside the bench rule (bench/provenance.ts), and the sha256 of their file. */
  provenance?: ProvenanceList | null
  provenanceSha?: string | null
  /** The table ids whose evidence sits in `docs/bench/<id>/` (links are printed for those). */
  folders?: ReadonlySet<string>
  /** Numbers published outside the bench rule (bench/outside.ts), and the sha256 of their file. */
  outside?: OutsideList | null
  outsideSha?: string | null
  /** The AP stress rows `bench check` compares with the tree (bench/stress.ts), when the directory declares them. */
  stress?: StressDeclaration | null
  /** Preregistered runs that have not run (bench/tree.ts `plannedRuns`). */
  planned?: readonly PlannedRun[]
  /** The engine labels (`engineLabels` over the package's CHANGELOG.md); without them, the version file's alone. */
  engine?: EngineLabels
  /** The text of the stress amendment file `_stress.json` names, for the re-bank history (`rebankHistory`). */
  stressAmendment?: string | null
  /** Tables held from this tree (bench/held.ts, `_held.json`): listed by name under "Held tables", with no numbers. */
  held?: HeldList | null
}

/** The one spelling of the command on the generated pages, run from the repository root, and the tables directory there. */
export const CLI = 'node packages/verify/dist/cli.js'
export const TABLES = 'packages/verify/docs/bench'

/** Printed under a prereg whose frozen text names lab paths (the emitter sets `prereg.lab_paths`; nothing is typed). */
export const LAB_PATHS_NOTE = "Note on the prereg: frozen text; file paths in it refer to the authors' working tree at the time of freezing."

const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`)
const ci = (r: BenchRow): string => (r.n === 0 ? 'n/a' : `${pct(r.ci95[0])} to ${pct(r.ci95[1])}`)

/**
 * How each label reads on the page. Every blind label in this tree rests on the authors' own records (a hash list's time, a
 * fetch log, a note in the prereg), never on a third party's, so it reads "blind, by the authors' records", and the table
 * names the record (run.json `blind_basis`).
 */
export const LABEL_SHOWN: Record<BenchLabel, string> = {
  blind: 'blind, by the authors\' records', 'post-hoc': 'post-hoc', demo: 'demo', regression: 'regression', transcribed: 'transcribed',
}
export const LABEL_MEANING: Record<BenchLabel, string> = {
  blind: 'the builder had not seen the data before the run, and only the authors\' own records show it; no third party can confirm that, and the label says nothing about who audited the outcomes',
  'post-hoc': 'scored on data the builder had already seen',
  demo: 'a constructed demonstration',
  regression: 'a re-run showing published numbers did not move',
  transcribed: 'typed from a report that left no machine-readable results',
}

/** The verdict cell: a row held to another run's bar says so in the cell itself, never PASS or FAIL. */
export const verdictCell = (r: BenchRow): string =>
  r.verdict === 'POST-HOC' ? `post-hoc (no bar of its own; ${cell(r.bar?.reused_from ?? 'another run\'s prereg')} reused)` : r.verdict

/** A file inside a table's folder, as a link from docs/BENCH.md. */
const inTree = (id: string, p: string): string => {
  const rel = ['bench', id, ...(p === '.' ? [] : [p])].join('/').replace(/\\/g, '/')
  return `[\`${rel}\`](${rel})`
}

/** A fence longer than any run of backticks in the text, so a quoted amendment can never close it early. */
function fenced(text: string): string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}text`, ...text.split('\n'), fence]
}

function amendmentLines(t: BenchTable, list: PreregHash[], heading: (i: number) => string): string[] {
  const L: string[] = []
  list.forEach((a, i) => {
    const where = `recorded in \`${cell(a.recorded_in)}\`${a.at ? ` at ${a.at}` : ''}${a.doc ? ` for \`${cell(a.doc)}\`` : ''}${a.note ? ` (${cell(a.note)})` : ''}`
    L.push(`**${heading(i)}:** sha256 \`${a.sha256}\`, ${where}.`)
    L.push('')
    if (a.text !== undefined && a.text_from) {
      const [file, range] = [a.text_from.slice(0, a.text_from.lastIndexOf(':')), a.text_from.slice(a.text_from.lastIndexOf(':') + 1)]
      L.push(`<details><summary>${heading(i)}, its text: ${cell(file)} lines ${range}</summary>`)
      L.push('')
      L.push(...fenced(a.text))
      L.push('')
      L.push('</details>')
    } else L.push(`Its text is not shown: no recorded version of \`${cell(t.prereg.path)}\` in the tree separates it.`)
    L.push('')
  })
  return L
}

/** The prereg's stamp line: what a third party's timestamp shows, or that none predates the run. */
function stampLine(t: BenchTable, folder: boolean): string[] {
  const s = t.prereg.stamp
  if (!s) return []
  const file = (p: string): string => (folder ? inTree(t.id, p) : `\`${cell(p)}\``)
  const list = (ps: typeof s.proofs): string => ps.map(p => `${file(p.proof)}, signed ${p.gen_time}, covers \`${cell(p.covers)}\``).join('; ')
  const late = s.proofs.filter(p => !p.before_run)
  const lateText = late.length ? ` A timestamp authority signed these bytes later (${list(late)}): that shows the text existed by then, not that it came before the run.` : ''
  switch (s.status) {
    case 'stamped before the run':
      return [`**Stamp:** stamped before the run: ${list(s.proofs.filter(p => p.before_run))}. \`${CLI} bench check ${TABLES}\` checks each signature and chain against the roots in \`docs/bench/_tsa/\`.${lateText}`, '']
    case UNSTAMPED_LABEL:
      return [`**Stamp:** ${UNSTAMPED_LABEL}. No third party saw this prereg before its run, so the order of prereg and run rests on the authors' own files and logs.${lateText}`, '']
    case 'needs stamp':
      return [`**Stamp:** NEEDS STAMP. The run (${t.run.date}) came after stamping began on ${STAMPING_FROM}, and no timestamp proof is in the folder. Its time rests on the authors' own hash list. A stamp made now would show the text existed from then on, not that it came before the run.`, '']
    case 'stamped after the run':
      return [`**Stamp:** stamped after the run (${t.run.date}), not before it.${lateText}`, '']
  }
}

/** Files the folder's hash lists name that ship, edited: both sha256s and the reason. */
function shippedEditedLines(t: BenchTable): string[] {
  const list = t.run.shipped_edited ?? []
  if (!list.length) return []
  return ['**Ships, edited:**', '', ...list.map(x => `- \`${cell(x.file)}\`, recorded sha256 \`${x.recorded_sha256}\`, shipped sha256 \`${x.sha256}\`: ${cell(x.reason)}`), '']
}

/** Files the folder's hash lists name that do not ship, each beside its sha256 and the reason. */
function notShippedLines(t: BenchTable): string[] {
  const list = t.run.not_shipped ?? []
  if (!list.length) return []
  return ['**Hashed, not shipped:**', '', ...list.map(x => `- \`${cell(x.file)}\`, sha256 \`${x.sha256}\`: ${cell(x.reason)}`), '']
}

function tableBlock(t: BenchTable, sha: string, folder: boolean): string[] {
  const L: string[] = []
  L.push(blockBegin('table', t.id, sha))
  const am = t.prereg.amendments.length
  // a table that records misses only (a transcribed table with no rows): a scope note stands in the prereg's place
  const missesOnly = t.label === 'transcribed' && !t.rows.length
  const basis = t.run.blind_basis ? ` The record it rests on: ${cell(t.run.blind_basis)}.` : ''
  L.push(`**Label:** ${LABEL_SHOWN[t.label]}: ${LABEL_MEANING[t.label]}.${basis} **Run:** ${cell(t.run.id)}, ${t.run.date}; engine ${t.run.engine_version ?? 'n/a'}; ruleset ${t.run.ruleset ?? 'n/a'}.`)
  L.push('')
  L.push(missesOnly
    ? `**Engine:** no numbers: this table records misses only${t.run.engine_version ? `, found under engine ${t.run.engine_version}` : ''}. Each miss carries its own date.`
    : t.run.engine_version
      ? `**Engine:** these numbers hold for engine ${t.run.engine_version}, the one the run used. The table was not re-run on a later engine.`
      : '**Engine:** the run used its own scripts, not this package\'s engine.')
  L.push('')
  if (t.run.rerun) { L.push(`**Reruns from this tree:** ${rerunWords(t.run.rerun)}. ${cell(t.run.rerun.detail)}`); L.push('') }
  if (t.audit) { L.push(`**Audit:** ${cell(t.audit)}.`); L.push('') }
  const prereg = folder ? inTree(t.id, t.prereg.path) : `\`${cell(t.prereg.path)}\``
  L.push(`**${missesOnly ? 'Scope note, in the prereg\'s place' : 'Prereg'}:** ${prereg}, frozen sha256 \`${t.prereg.frozen_sha256}\`${am ? `, held to \`${t.prereg.sha256}\` after ${am} recorded amendment(s)` : ''}.`)
  L.push('')
  if (t.prereg.lab_paths) { L.push(`*${LAB_PATHS_NOTE}*`); L.push('') }
  L.push(...stampLine(t, folder))
  if (t.hash_list_note) { L.push(`**Hash list:** ${cell(t.hash_list_note)}`); L.push('') }
  if (t.run.results) L.push(`**Results:** ${folder ? inTree(t.id, t.run.results.path) : `\`${cell(t.run.results.path)}\``}, sha256 \`${t.run.results.sha256}\`.`)
  if (t.run.report) L.push(`**Transcribed from:** \`${cell(t.run.report.name)}\`, sha256 \`${t.run.report.sha256}\`.`)
  L.push('')
  L.push(...shippedEditedLines(t))
  L.push(...notShippedLines(t))
  if (t.rows.length) {
    L.push('| claim | k/n | rate | 95% CI | method | bar | verdict |')
    L.push('|---|---|---|---|---|---|---|')
    for (const r of t.rows) {
      const claim = r.note ? `${cell(r.claim)} (${cell(r.note)})` : cell(r.claim)
      L.push(`| ${claim} | ${r.k}/${r.n} | ${pct(r.rate)} | ${ci(r)} | ${r.method} | ${r.bar ? cell(r.bar.text) : 'none'} | ${verdictCell(r)} |`)
    }
  } else L.push('No rows: this table records misses only.')
  L.push('')
  if (t.findings?.length) { for (const f of t.findings) L.push(`- **Finding:** ${cell(f)}`); L.push('') }
  if (am) L.push(...amendmentLines(t, t.prereg.amendments, i => `Amendment ${i + 1}`))
  if (t.prereg.later?.length) L.push(...amendmentLines(t, t.prereg.later, i => `Recorded after this run, ${i + 1}`))
  if (t.tuning) { L.push(`**Tuned:** \`${cell(t.tuning.knob)}\` over ${t.tuning.range[0]} to ${t.tuning.range[1]} on \`${cell(t.tuning.heldout)}\`, chosen ${t.tuning.chosen} after ${t.tuning.trace.length} evaluation(s).`); L.push('') }
  L.push(`**Misses:** ${t.misses.length}${t.misses.length ? ', in MISSES.md' : ''}.`)
  L.push(BLOCK_END)
  return L
}

function provenanceBlock(list: ProvenanceList, sha: string): string[] {
  const L: string[] = [blockBegin('provenance', 'provenance', sha)]
  for (const e of list.entries) {
    L.push(`### ${cell(e.title)} (\`${e.id}\`)`)
    L.push('')
    L.push(`**Tier:** ${e.tier}. **Run:** ${cell(e.run.id)}, ${e.run.date}; engine ${e.run.engine_version ?? 'n/a'}${e.run.checker_sha256 ? `; checker sha256 \`${e.run.checker_sha256}\`` : ''}.`)
    L.push('')
    const rel = `bench/${e.provenance.path.replace(/\\/g, '/')}`
    L.push(`**Provenance:** [\`${rel}\`](${rel}), sha256 \`${e.provenance.sha256}\`.`)
    L.push('')
    L.push(`**Why it is not a table:** ${cell(e.why_not_a_table)}`)
    L.push('')
    if (e.headline) { L.push(`**Headline, restated:** ${cell(e.headline)}`); L.push('') }
    L.push('| claim | k/n | rate | 95% CI | method |')
    L.push('|---|---|---|---|---|')
    for (const r of e.rows) {
      const note = r.note.replace(/^descriptive: no preregistered bar;?\s*/, '')
      L.push(`| ${cell(r.claim)}${note ? ` (${cell(note)})` : ''} | ${r.k}/${r.n} | ${pct(r.rate)} | ${ci(r)} | ${r.method} |`)
    }
    L.push('')
  }
  L.push(BLOCK_END)
  return L
}

/** `docs/BENCH.md`, from the tables (sorted by id), their file sha256s, the refusal list, and the provenance rows. */
export function renderBenchIndex(tables: BenchTable[], shas: ReadonlyMap<string, string>, refused: RefusedList | null, refusedSha: string | null, extras: IndexExtras = {}): string {
  const folders = extras.folders ?? new Set<string>()
  const L: string[] = []
  L.push('# Bench tables')
  L.push('')
  L.push(`Generated by \`${CLI} bench index ${TABLES}\` from the JSON tables in`)
  L.push(`\`docs/bench/\`. Do not edit this page: re-emit the table from its run with \`${CLI} bench emit\`, then`)
  L.push('regenerate. Every figure here sits inside a generated block that names the table it came from and that table\'s')
  L.push('sha256, so a reader can check a block against the JSON beside it. Commands on this page run from the repository root.')
  L.push('')
  L.push('A table is emitted only against a prereg whose sha256 was recorded. `bench emit` reads the recorded chain')
  L.push('(the frozen hash, then every amendment), and refuses when no hash was recorded, when the prereg changed after its last')
  L.push('record, or when a recorded snapshot changed. A recorded hash proves which text was frozen. The tool checks that the')
  L.push('record exists, not when it was made: a record\'s time is the authors\' own. Each table\'s **Stamp** line says what a')
  L.push(`third party can show. Stamping began on ${STAMPING_FROM}: a prereg frozen before then reads "${UNSTAMPED_LABEL}",`)
  L.push('a later run with no proof reads NEEDS STAMP, and a stamp made after its run is shown as that, never as a stamp before it.')
  L.push('')
  // the rule's exceptions, computed from the tables so the list cannot go stale
  const missesOnly = (t: BenchTable): boolean => t.label === 'transcribed' && !t.rows.length
  const late = tables.filter(t => t.prereg.stamp?.status === 'stamped after the run' && t.run.date.slice(0, 10) >= STAMPING_FROM)
  const unstampedRuns = tables.filter(t => t.prereg.stamp?.status === 'needs stamp' && !missesOnly(t))
  const unstampedNotes = tables.filter(t => t.prereg.stamp?.status === 'needs stamp' && missesOnly(t))
  const exceptions = late.length + unstampedRuns.length + unstampedNotes.length
  L.push(`**The stamp rule, from ${STAMPING_FROM}.** Every preregistration is to be stamped by a timestamp authority before its run.${exceptions ? ' This tree does not meet the rule everywhere yet: the exceptions are listed below, after how a stamp is made.' : ''}`)
  L.push('A stamp is made with')
  L.push(`\`${CLI} bench stamp <prereg> --tsa http://timestamp.digicert.com\``)
  L.push('sends the file\'s sha256 and writes the authority\'s signed reply beside it as `<prereg>.tsr`. The table records the')
  L.push('stamp\'s time beside the run\'s time on its **Stamp** line, which the tool writes from the token and the run date, so a')
  L.push('stamp made after its run can only read "stamped after the run". A run made after stamping began whose stamp came later')
  L.push('also says so in a note on its first row.')
  if (exceptions) {
    L.push('')
    L.push('**Where this tree does not meet the rule.**')
    L.push('')
    // stamping began in practice with the earliest stamp in the tree; a run that day but before it could not have been stamped
    const firstStamp = tables.flatMap(t => t.prereg.stamp?.proofs ?? []).map(p => p.gen_time).sort()[0]
    for (const t of late) {
      const p = (t.prereg.stamp?.proofs ?? []).filter(x => !x.before_run).map(x => x.gen_time).sort()[0]
      const mins = p && /T/.test(t.run.date) ? Math.floor((Date.parse(p) - runStart(t.run.date)) / 60000) : null
      const when = `its prereg was stamped at ${p ?? 'a later time'}${mins !== null && mins > 0 ? `, ${mins} minutes after the run` : ', after the run'}`
      const beforeAny = firstStamp && /T/.test(t.run.date) && runStart(t.run.date) < Date.parse(firstStamp)
      L.push(beforeAny
        ? `- \`${t.id}\` ran on the day the rule began (${t.run.date}), before the first stamp in this tree (${firstStamp}), and ${when}. Its table reads "stamped after the run".`
        : `- \`${t.id}\` broke the rule: its run (${t.run.date}) came after stamping began, and ${when}. Its table reads "stamped after the run", and no later stamp can change the order.`)
    }
    for (const t of unstampedRuns) L.push(`- \`${t.id}\` broke the rule: its run (${t.run.date}) came after stamping began, and no stamp is in its folder. Its table reads NEEDS STAMP; a stamp made now would show only that the prereg existed from then on.`)
    if (unstampedNotes.length) L.push(`- ${unstampedNotes.length} table(s) record misses only: ${unstampedNotes.map(t => `\`${t.id}\``).join(', ')}. Each has a scope note in the prereg's place, written after the events it records, so no stamp could come before them. They read NEEDS STAMP until the maintainers stamp each note with the command above; the stamp will then show only that the note existed from that time.`)
    L.push('')
    L.push(`\`${CLI} bench check ${TABLES}\` exits 4 while any table reads NEEDS STAMP, so a CI step can enforce the rule; \`--allow-unstamped\` accepts them knowingly and exits 0. A run that broke the rule stays listed here.`)
    L.push('')
  }
  const proofs = tables.flatMap(t => t.prereg.stamp?.proofs ?? [])
  const first = proofs.map(p => p.gen_time).sort()[0]
  const before = tables.filter(t => t.prereg.stamp?.status === 'stamped before the run').length
  if (first) L.push(`The earliest stamp in this tree was signed at ${first}.`)
  L.push(before
    ? `${before} table(s) carry a stamp made before their run; every other stamp shows only that its text existed by then.`
    : 'No stamp in this tree predates its run yet: each shows only that its text existed by then, not that it came first.')
  L.push('To verify a stamp with OpenSSL alone, see [`bench/_tsa/README.md`](bench/_tsa/README.md): it ships the authority\'s')
  L.push('roots and the `-untrusted` step OpenSSL needs.')
  L.push('The rule\'s record is in [`NUMERIC-HONESTY-2026-09-28.md`](NUMERIC-HONESTY-2026-09-28.md), "Preregistration timestamps".')
  L.push('A table that records misses only has no preregistration: a scope note, written when its misses were transcribed and')
  L.push('saying so, takes the prereg\'s place. It reads NEEDS STAMP until it is stamped, and a stamp can then show only that the')
  L.push('note existed by then.')
  L.push('')
  for (const p of extras.planned ?? []) {
    const link = `[\`bench/${p.id}/PREREG.md\`](bench/${p.id}/PREREG.md)`
    const stamp = p.stamped_at
      ? `A timestamp authority signed it at ${p.stamped_at}; \`bench check\` verifies the signature.`
      : 'It is not stamped yet: no timestamp authority has signed it, so nothing outside the maintainers\' files fixes its time.'
    const begun = p.others.length
      ? `Its folder also holds ${p.others.map(f => `\`${cell(f)}\``).join(', ')}; there is no table until its run is emitted.`
      : 'The run has not begun: the folder holds no results, and there is no table.'
    // from the versions alone (they read the same wherever the page is generated); bench check also recomputes the sources
    const moved = p.stale_versions?.length ? ` Its version pins no longer match this tree: ${p.stale_versions.join('; ')}. \`bench check\` prints every pin that moved on a STALE PINS line.` : ''
    L.push(`**Preregistered, not yet run: \`${p.id}\`.** "${cell(p.title)}" (${link}), sha256 \`${p.actual}\`, as its hash list records. ${stamp} ${begun}${moved} \`bench check\` refuses the folder if the prereg changes without a new recorded hash.`)
    L.push('')
  }
  if (folders.size) {
    L.push('Each table\'s evidence ships beside it. The folder `docs/bench/<id>/` holds the prereg byte for byte, every hash list')
    L.push('the prereg check reads, the run spec, the per-case results, and `run.json`, which says where each file came from.')
    L.push(`\`${CLI} bench check ${TABLES}\` re-emits every table from its folder and compares`)
    L.push('byte for byte. That is a re-tally from the per-case results that ship, not a rerun: it shows the table is what its')
    L.push('results give, not that the results are what the run would give again. Preregs ship unedited so their sha256 can be')
    L.push('checked. Where one names a file path in the authors\' working tree, its table says so.')
    L.push('Where a hash list or the prereg names a file the folder does not hold (a harness, raw data, a large per-case file), the')
    L.push('table lists it under "Hashed, not shipped" beside its sha256, with the reason. Where a hash-listed file ships in bytes')
    L.push('other than the recorded ones (a comment line that named a private folder was rewritten), the table lists it under')
    L.push('"Ships, edited" with both sha256s and the reason; the original does not ship, so a reader cannot check the difference.')
    L.push('The check refuses a hash-listed file that neither ships in those bytes nor is listed.')
    L.push(`\`${CLI} bench emit ${TABLES}/<id>\` re-emits one table from the files in its folder.`)
    L.push('`bench check` exits 0 when everything holds, 1 on any DIFFERS, refusal or failure, and 4 when everything holds but a')
    L.push('table reads NEEDS STAMP (see the stamp rule above), or a preregistered run that has not run pins an engine, a rule or')
    L.push('source files this tree no longer builds (a STALE PINS line names each pin that moved; `--strict-pins` refuses instead).')
    L.push('')
    const withRerun = tables.filter(t => folders.has(t.id) && t.run.rerun)
    if (withRerun.length) {
      L.push('**Which tables rerun from this tree.** A rerun regenerates the per-case results from inputs that ship, with a harness')
      L.push('that ships, and compares them with the shipped results. Each table\'s **Reruns from this tree** line says what reruns,')
      L.push('with which command, and what is withheld and why. "partly" means some steps or some cases rerun and others do not.')
      L.push('A rerun that reproduces outcomes but not bytes says so. No tagged, signed release of this tree exists yet.')
      L.push(engineSentence(extras.engine ?? engineLabels(null)))
      L.push('`CHANGELOG.md` defines "closed" and "released" and dates each closing. A rerun runs on today\'s build, so it can give every')
      L.push('outcome the run gave under different verdict ids: a verdict\'s id derives from the engine label that made it, and an open')
      L.push('label\'s computation can still change under it.')
      L.push('')
      L.push('| table | reruns from this tree |')
      L.push('|---|---|')
      for (const t of withRerun) L.push(`| \`${t.id}\` | ${rerunWords(t.run.rerun!)} |`)
      L.push('')
    }
  }
  const stress = extras.stress
  if (stress) {
    L.push('**The AP stress rows.** The AP stress study is not a table (its numbers are under "Outside the rule"), but its banked')
    L.push(`rows, ${stress.files.length} files in \`${stress.rows}/\` at the repository root, claim that a fresh run of \`${stress.harness}\` reproduces`)
    L.push('them byte for byte. Each row carries `checker_sha256`, the sha256 over the AP pack\'s source files, with the engine version')
    L.push('and the AP ruleset. `bench check` compares every banked row with what this tree builds and fails when they differ, so an')
    L.push(`AP change that was not re-banked cannot pass unseen. Each re-bank is dated in [\`bench/${stress.amendment}\`](bench/${stress.amendment}).`)
    L.push('The files are named for five "holdout" seeds. They are fixed seeds, not a holdout: one re-bank followed a change to')
    L.push('the AP pack made with these seeds\' results in view (the amendment says which), so they test reproduction, not')
    L.push('generalisation.')
    L.push('')
    const history = extras.stressAmendment ? rebankLines(extras.stressAmendment, extras) : []
    if (history.length) { L.push(...history); L.push('') }
  }
  L.push('Each row names its claim, its counts, a two-sided interval at the stated confidence by the named method (Wilson or')
  L.push('Clopper-Pearson), the bar as the prereg states it, and the verdict against that bar. A row with no preregistered bar is')
  L.push('descriptive and reads INSUFFICIENT. A row held to a bar written for another run, reused after the fact, has no verdict')
  L.push('of its own: its verdict cell reads "post-hoc" and names whose bar it is. Labels: blind, by the authors\' records (by the')
  L.push('authors\' own hash times, fetch logs and notes, the builder had not seen the data before the run; no third party has')
  L.push('confirmed that for any table, each blind table names the record it rests on, and the label says nothing about who')
  L.push('audited, which a table states separately), post-hoc (scored on data already seen), demo (a constructed demonstration),')
  L.push('regression (a re-run showing nothing moved), transcribed (typed from a report that left no machine-readable results).')
  L.push('Misses are listed in `MISSES.md`.')
  L.push('')
  const held = extras.held?.tables ?? []
  // the science tables' sentence, as before; when every one of them is held from this tree, it says so instead
  if (!tables.some(t => t.id.startsWith('sci-')) && held.some(h => h.id.startsWith('sci-'))) {
    L.push('Scope: most tables test the document checks (invoices, e-invoices, legal quotations, a purchase log). The tables whose')
    L.push('ids start with `sci-` hold the same prereg-and-replay discipline to public science tables (galaxy rotation curves,')
    L.push('ocean floats, gravity inversions); they are held from this tree, listed under "Held tables" with no numbers. Numbers')
    L.push('published outside the rule are listed under "Outside the rule", with the reason for each.')
  } else {
    L.push('Scope: most tables test the document checks (invoices, e-invoices, legal quotations, a purchase log). The tables whose')
    L.push('ids start with `sci-` hold the same prereg-and-replay discipline to public science tables (galaxy rotation curves,')
    L.push('ocean floats, gravity inversions). They are here because the bench rule covers every table on this page, not because')
    L.push('the invoice checker reads galaxies. Numbers published outside the rule are listed under "Outside the rule", with the')
    L.push('reason for each.')
  }
  L.push('The tables titled "Cold review" record defects found by cold readers: AI agents that had not worked on this tree, each')
  L.push('given a copy of it in a buyer\'s or a reviewer\'s role. They are run by the maintainers. They are not people, not customers')
  L.push('and not independent reviewers, and nothing they found is evidence of how the checks do on real documents.')
  L.push('')
  for (const t of tables) {
    L.push(`## ${cell(t.title)}`)
    L.push('')
    L.push(`Table \`${t.id}\`.`)
    L.push('')
    L.push(...tableBlock(t, shas.get(t.id) ?? '', folders.has(t.id)))
    L.push('')
  }
  if (held.length) {
    L.push('## Held tables')
    L.push('')
    L.push('These tables are held from this tree: neither the table nor its folder is here, so this page prints no numbers for')
    L.push(`them and \`bench check\` has nothing of theirs to re-emit. Their misses stay in \`MISSES.md\`, each row marked "${HELD_MARK}",`)
    L.push(`because the ledger never drops a row. The list is \`docs/bench/${HELD_FILE}\`.`)
    L.push('')
    L.push('| table | status |')
    L.push('|---|---|')
    for (const h of held) L.push(`| \`${h.id}\` | held: ${cell(h.reason)} |`)
    L.push('')
  }
  const prov = extras.provenance
  if (prov?.entries.length) {
    L.push('## Rows outside the bench rule, with archived provenance')
    L.push('')
    L.push('These rows are not bench tables and carry no verdict. Their prereg\'s sha256 was never recorded before the run, so')
    L.push('`bench emit` refuses them, and the refusal stays on the list below. Each prints with its tier, the reason it is')
    L.push('not a table, and an archive of the provenance that does exist, with the archive\'s sha256.')
    L.push(`\`${CLI} bench check ${TABLES}\` verifies each archive against that sha256 and recomputes every interval.`)
    L.push('')
    L.push(...provenanceBlock(prov, extras.provenanceSha ?? ''))
    L.push('')
  }
  const outside = extras.outside
  if (outside?.entries.length) {
    L.push('## Outside the rule')
    L.push('')
    L.push('These accuracy numbers are published on other pages, but they are not bench tables, so they carry no verdict here.')
    L.push('Each row says where the numbers are published and why they sit outside the rule. A number joins the rule only as a')
    L.push('table emitted from its own folder, never by an edit to this list.')
    if (prov?.entries.length) L.push('The rows above, under "Rows outside the bench rule", are outside it too, with their archived provenance.')
    L.push('')
    L.push(blockBegin('outside', 'outside', extras.outsideSha ?? ''))
    L.push('| numbers, as published | where | why outside the rule |')
    L.push('|---|---|---|')
    for (const e of outside.entries) L.push(`| **${cell(e.title)}** (\`${e.id}\`): ${cell(e.numbers)} | ${cell(e.where)} | ${cell(e.reason)} |`)
    L.push(BLOCK_END)
    L.push('')
    // the default legal rule this build issues is derived, so a new default can never be silently missing from the list
    const legal = `legal@${defaultLegalRuleset().version}`
    const named = legal.replace(/\./g, '\\.')
    const listed = outside.entries.some(e => new RegExp(`^${named}(?![\\d.])`).test(e.title.trim()))
      || tables.some(t => new RegExp(`(?:^|[\\s+,(])${named}(?![\\d.])`).test(t.run.ruleset ?? ''))
    if (!listed) {
      L.push(`**Not on this list:** \`${legal}\`, the default legal rule this build issues new verdicts under, has no row here and no table, so no number published for it is restated on this page.`)
      L.push('')
    }
  }
  if (refused?.runs.length) {
    const withdrawn = refused.runs.some(r => r.code === 'withdrawn')
    L.push(withdrawn ? '## Runs the tool refused, and tables withdrawn' : '## Runs the tool refused')
    L.push('')
    L.push('Refused: these runs have published numbers elsewhere, but no table, because their prereg chain does not hold, so')
    L.push('`bench emit` wrote nothing. A refusal clears only by a recorded hash, never by an edit to this page.')
    if (withdrawn) {
      L.push('Withdrawn: these tables were emitted once, but the files they rest on cannot ship in this tree, so they are not')
      L.push('printed. Their misses stay in `MISSES.md`, because the ledger never drops a row.')
    }
    L.push('')
    L.push(blockBegin('refused', 'refused', refusedSha ?? ''))
    L.push('| run | status | date | reason |')
    L.push('|---|---|---|---|')
    for (const r of refused.runs) {
      const status = r.code === 'withdrawn' ? cell(r.status ?? 'withdrawn') : `refused (${r.code})`
      L.push(`| ${cell(r.title)} (\`${r.id}\`) | ${status} | ${r.date ?? r.run_date ?? 'n/a'} | ${cell(r.reason)} |`)
    }
    L.push(BLOCK_END)
    L.push('')
  }
  return `${L.join('\n').replace(/\n+$/, '')}\n`
}

/**
 * The words a reader sees for the ledger's recorded strings. The ledger keeps every field as recorded (it is append-only);
 * the page drops a leading work label from a fix (a code, a slash, then the version: "… / legal@0.1.0" reads "legal@0.1.0"), names the red team's severity
 * ranks, and spells out run codes in a description. Deterministic: the same ledger gives the same page.
 */
const SEVERITY: Record<string, string> = { S0: 'critical', S1: 'high', S2: 'medium', S3: 'low' }
const WORK_LABEL = /(^|[\s(,;])(?:FIX-[A-Z]|[A-Z]\d+[a-z]?(?:-[A-Z])?)\s\/\s/g
export function plainFix(s: string): string {
  return s
    .replace(/\bunder the V3 ruling\b/g, 'under the maintainers\' ruling that a check stricter than the standard is advisory')
    .replace(WORK_LABEL, '$1')
}
export const plainKind = (k: string): string => k.replace(/^(S[0-3])\s+(.+)$/, (_, s: string, rest: string) => `${rest} (severity: ${SEVERITY[s]})`)
export const plainDescription = (d: string): string => d.replace(/\bX2's\b/g, 'the first legal blind set\'s').replace(/\bX1's\b/g, 'the e-invoice PDF run\'s')

/**
 * `docs/MISSES.md`, from the ledger and its file's sha256; `labels` names a withdrawn table in words (from `_refused.json`);
 * `held` names the tables held from this tree (bench/held.ts): their rows print in place, each with the held mark after the
 * table's id, and the row is otherwise as it would print with the table present.
 */
export function renderMisses(ledger: Ledger, sha: string, labels: ReadonlyMap<string, string> = new Map(), held: ReadonlySet<string> = new Set()): string {
  const L: string[] = []
  L.push('# Misses ledger')
  L.push('')
  L.push('Every miss from every bench table, dated: the cases a run got wrong, the defects its audit found, the predictions')
  L.push('that failed, and the label errors in its own test set. Generated from `docs/bench/`, never typed, by')
  L.push(`\`${CLI} bench index ${TABLES}\`. The ledger is append-only, and this is what that means:`)
  L.push('regenerating it refuses, and writes nothing, when a row would be dropped or changed; the only change it allows to an')
  L.push('existing row is recording what fixed it, and a recorded fix never changes. `bench check` also refuses a table that no')
  L.push('longer re-emits from its folder. Both checks read files inside this tree, so someone who edits a table\'s folder, the')
  L.push('table and this ledger together can drop a row and pass both. Only a copy outside the authors\' hands would catch that,')
  L.push('such as a public CI history or a signed release of the ledger, and neither exists yet.')
  L.push('A row describes a defect in data or code, never a person. A table withdrawn from the index keeps its rows here.')
  L.push('')
  L.push('Some tables record misses only, with no counts. They carry the misses of studies whose numbers sit outside the bench')
  L.push('rule (the AP stress study\'s development seeds, the SEC studies), and the defects found in rounds of cold review, in')
  L.push('which four cold readers (AI agents that had not worked on this tree) were each given a copy of this tree in one reader\'s')
  L.push('role (a controller, a platform engineer, a legal-operations director, a methods reviewer) and asked to break it. They')
  L.push('are AI agents run by the maintainers, not people and not independent reviewers. Earlier scope notes and some older rows')
  L.push('call them "outside readers" or "an outside reviewer"; those notes and rows are frozen, and this is what those words mean.')
  L.push('Some frozen scope notes also say a row is fixed when its defect is gone from "a released tree": that means the copy of')
  L.push('this tree handed to the next round\'s readers. No tagged, signed release of this tree exists yet.')
  L.push('A review row\'s description begins with the reader who logged it. Each such table\'s folder in `docs/bench/` holds a')
  L.push('scope note saying how its rows were made.')
  if (ledger.rows.some(r => held.has(r.table))) {
    L.push(`A row marked "${HELD_MARK}" belongs to a table held from this tree: the row is kept as recorded, and the table and its`)
    L.push(`folder are not here (\`BENCH.md\` lists the held tables under "Held tables"; the list is \`docs/bench/${HELD_FILE}\`).`)
  }
  L.push('')
  L.push(blockBegin('ledger', 'misses', sha))
  L.push('| date | table | miss | kind | description | post-hoc | fixed by |')
  L.push('|---|---|---|---|---|---|---|')
  for (const r of ledger.rows) {
    const table = held.has(r.table) ? `\`${r.table}\` (${HELD_MARK})` : labels.get(r.table) ?? `\`${r.table}\``
    L.push(`| ${r.date} | ${cell(table)} | ${cell(r.id)} | ${cell(plainKind(r.kind))} | ${cell(plainDescription(r.description))} | ${r.post_hoc ? 'yes' : 'no'} | ${r.fixed_by ? cell(plainFix(r.fixed_by)) : 'open'} |`)
  }
  L.push(BLOCK_END)
  return `${L.join('\n')}\n`
}
