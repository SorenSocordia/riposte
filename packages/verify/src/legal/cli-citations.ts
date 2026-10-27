/**
 * `verify citations <citations.json> --sources <dir>` (cold-review round 2, 2026-10-05): a brief's citations, each checked against the
 * opinion text supplied for it, printed one line per citation (PASS, FAIL or INSUFFICIENT_DATA, the one word for can't tell) with
 * where each opinion text came from.
 *
 * The citations file is a JSON array of citations, or an object with a `citations` array (a brief):
 *   { "id": "p4n2", "cite": "201 F.3d 110", "case_name": "Makarova v. United States", "quote": "…", "source_key"?: "…" }
 * The sources folder holds the opinion texts, as UTF-8 text files:
 *   - with a `sources.json` manifest, `{ "<key>": { "file": "makarova.txt", "source"?: "case-law archive", "url"?: "…",
 *     "retrieved_at"?: "2026-10-05T13:00:00Z" } }`: each key is what a citation is matched by (its source_key, cite or case
 *     name), and the origin it states is recorded in the verdict;
 *   - without one, every `.txt` file, keyed by its name without `.txt` (`201 F.3d 110.txt` is the text for "201 F.3d 110").
 * Each text is checked only for the citation it is paired with, and only when it names that citation (engine 0.6.0,
 * ./binding.ts): its parties and reporter citation; under legal@0.3.0 and later (the default among them), its CAPTION must name them (a
 * mention in the body binds nothing). `--bind parties` (or `"bind": "parties"` on a manifest entry) checks, labelled "bound by
 * parties only", a citation whose parties the text (0.3.0 and later: its caption) names when its reporter citation is not there;
 * under 0.3.0 and later such an answer is never PASS, so the verdict is open and the exit code 2. `--bind strict`, the default,
 * refuses such a text. The flag, when given, sets the binding of every text. The headline counts the citations bound by parties only.
 * Every file is read as strict UTF-8: a byte that is not UTF-8, or a byte-order mark, is refused with its offset, never replaced
 * or stripped (a text is hashed byte for byte; src/protocol/hash-input.ts).
 *
 * Exit code, read from the verdict's gate_status: 0 = PASS (every citation was checked and held), 1 = FAIL, 2 = PASS-WITH-OPEN
 * or INSUFFICIENT_DATA (some citation could not be checked, and none failed), 3 = usage or input error. The report a person reads
 * goes to stderr, always; `--json` prints the verdict as JSON on stdout (cold-review round 4: the one rule every command follows; before,
 * the report went to stdout without --json). `--bundle <file>` writes { verdict, inputs } for `verify replay`: every quotation and
 * every opinion text in one JSON file. No network, no clock other than the verdict's issued_at.
 *
 * Library use: verifyCitations(citations, loadOpinionFolder(dir), { ruleset }) (docs/LEGAL.md).
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { verifyCitations, resolveLegalRuleset, defaultLegalRuleset, type BindMode, type Citation, type LegalVerdict, type OpinionSources, type OpinionText } from './index.js'
import { parseReporterCite, textOf } from './binding.js'
import { citeTooLong, citeTooLongWords } from './cite-bound.js'
import { decodeUtf8Strict, startsWithBom } from '../protocol/hash-input.js'
import { recordedGateStatus, type RecordedGateStatus } from '../verdict/aggregation.js'

export interface CitationsIO { out: (s: string) => void; err: (s: string) => void; now?: () => Date }
const PROCESS_IO: CitationsIO = { out: s => { process.stdout.write(s) }, err: s => { process.stderr.write(s) } }

export const CITATIONS_USAGE = [
  'usage: verify citations <citations.json> --sources <dir> [--ruleset legal[@version]] [--bind strict|parties] [--json] [--bundle <file>]',
  '  <citations.json>  a JSON array of citations, or { "citations": [...] }; each { id, cite?, case_name?, quote?, proposition?, source_key? }',
  '  --sources <dir>   the opinion texts: a sources.json manifest { key: { file, source?, url?, retrieved_at?, bind? } }, or one <key>.txt per text',
  `  --ruleset         legal (the default: legal@${defaultLegalRuleset().version} under this build's engine; legal@${defaultLegalRuleset('0.6.0').version} under engines 0.6.0 and 0.7.0), legal@0.5.5, legal@0.5.4, legal@0.5.3, legal@0.5.2, legal@0.5.1, legal@0.5.0, legal@0.4.0, legal@0.3.0, legal@0.2.0, legal@0.1.0 or legal@0.0.1`,
  '  --bind            strict (the default): a text\'s caption must name the reporter citation and every party; parties: a text',
  '                    whose caption names every party but not the reporter citation is checked too, and each such answer',
  '                    stays open ("bound by parties only"; never PASS under legal@0.3.0 and later)',
  '  --json            print the verdict as JSON on stdout',
  '  --bundle <file>   write { verdict, inputs } for `verify replay`: it holds every quotation and every opinion text',
  'The report a person reads goes to stderr; with --json the verdict goes to stdout as JSON, so stdout can be piped or redirected on its own.',
  'It checks that each quotation appears as quoted in the opinion text supplied for its cite, and that the text\'s caption names the cite.',
  'Under legal@0.5.0 and later it reads the text\'s sections: words found only in editorial matter (headnotes, a synopsis, the syllabus) or in a',
  'separate opinion answer can\'t tell, naming where they are, and every PASS says where it matched. A full citation\'s pin page, case',
  'name and parenthetical are read off it to find its text.',
  'A short form ("477 U.S. at 248") is read as a pin cite to the brief\'s own full citation; "Id." and "supra" are not resolved.',
  'It does not check that an authority exists or is good law, nor whether it stands for a proposition.',
  'exit: 0 PASS (every citation checked and held), 1 FAIL, 2 some citation could not be checked (and none failed), 3 usage or input error',
].join('\n')

class InputError extends Error {}

/** A usage error, printed as the rest of the CLI prints one: one line and a pointer to the help, never the whole text. Exit 3. */
function usageError(io: CitationsIO, msg: string): number {
  io.err(`verify citations: ${msg}\nsee: verify citations --help\n`)
  return 3
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * Read a file as strict UTF-8 (src/protocol/hash-input.ts): bytes that are not UTF-8 are refused with their offset, and so is a
 * byte-order mark. A text is hashed byte for byte, so it is never decoded with replacements and a mark is never stripped: two
 * different files must never share one input_hash.
 */
function readUtf8(path: string): string {
  let text: string
  try {
    text = decodeUtf8Strict(readFileSync(path), path)
  } catch (e) {
    throw new InputError(e instanceof Error ? e.message : String(e))
  }
  if (startsWithBom(text)) throw new InputError(`${path} starts with a UTF-8 byte-order mark (bytes EF BB BF at offset 0). A text is hashed byte for byte and the mark is not stripped silently: re-save the file as UTF-8 without the mark, then run it again`)
  return text
}

/** The citations of a citations file: an array, or { citations: [...] }. Each needs a string id; known fields only. */
export function readCitationsFile(path: string): Citation[] {
  let raw: unknown
  try { raw = JSON.parse(readUtf8(path)) } catch (e) { throw new InputError(e instanceof InputError ? e.message : `${path} is not JSON (${(e as Error).message})`) }
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.citations) ? raw.citations : undefined
  if (!list) throw new InputError(`${path} holds neither a JSON array of citations nor an object with a "citations" array`)
  const ids = new Set<string>()
  return list.map((c, i) => {
    if (!isObj(c) || typeof c.id !== 'string' || c.id.length === 0) throw new InputError(`citation ${i} has no string "id"`)
    if (ids.has(c.id)) throw new InputError(`citation id "${c.id}" appears twice`)
    ids.add(c.id)
    const out: Citation = { id: c.id }
    for (const k of ['cite', 'case_name', 'quote', 'proposition', 'source_key'] as const) {
      if (c[k] === undefined) continue
      if (typeof c[k] !== 'string') throw new InputError(`citation "${c.id}": "${k}" is not a string`)
      out[k] = c[k] as string
    }
    return out
  })
}

/** The opinion texts in a folder: its sources.json manifest, or every .txt file keyed by its name. `bind`, when given, sets every text's. */
export function loadOpinionFolder(dir: string, bind?: BindMode): OpinionSources {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new InputError(`--sources ${dir} is not a folder`)
  const root = resolve(dir)
  const manifestPath = join(root, 'sources.json')
  const out: OpinionSources = {}
  if (existsSync(manifestPath)) {
    let m: unknown
    try { m = JSON.parse(readUtf8(manifestPath)) } catch (e) { throw new InputError(e instanceof InputError ? e.message : `sources.json is not JSON (${(e as Error).message})`) }
    if (!isObj(m)) throw new InputError('sources.json is not an object of { key: { file, source?, url?, retrieved_at? } }')
    for (const [key, entry] of Object.entries(m)) {
      if (!isObj(entry) || typeof entry.file !== 'string') throw new InputError(`sources.json: "${key}" has no "file"`)
      const path = resolve(root, entry.file)
      const rel = relative(root, path)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new InputError(`sources.json: "${key}" names a file outside the folder (${entry.file})`)
      if (!existsSync(path)) throw new InputError(`sources.json: "${key}" names ${entry.file}, which is not there`)
      const t: OpinionText = { text: readUtf8(path) }
      for (const k of ['source', 'url', 'retrieved_at'] as const) {
        if (entry[k] === undefined) continue
        if (typeof entry[k] !== 'string') throw new InputError(`sources.json: "${key}".${k} is not a string`)
        t[k] = entry[k] as string
      }
      if (entry.bind !== undefined && entry.bind !== 'strict' && entry.bind !== 'parties') throw new InputError(`sources.json: "${key}".bind is "${String(entry.bind)}"; it is "strict" or "parties"`)
      const b = bind ?? (entry.bind as BindMode | undefined)
      if (b !== undefined) t.bind = b
      out[key] = t
    }
    return out
  }
  for (const name of readdirSync(root).sort()) {
    if (!name.toLowerCase().endsWith('.txt')) continue
    const path = join(root, name)
    if (!statSync(path).isFile()) continue
    out[name.slice(0, -4)] = { text: readUtf8(path), source: `file ${name}`, ...(bind !== undefined ? { bind } : {}) }
  }
  if (Object.keys(out).length === 0) throw new InputError(`--sources ${dir} holds no sources.json and no .txt files`)
  return out
}

/** The one vocabulary (cold-review round 4): can't tell is INSUFFICIENT_DATA on every line, as in the JSON and the headline. */
const WORD: Record<string, string> = { PASS: 'PASS', FAIL: 'FAIL', INSUFFICIENT_DATA: 'INSUFFICIENT_DATA' }
/** The gate as a screen prints it: PASS-WITH-OPEN hyphenated (the JSON keeps PASS_WITH_OPEN). */
const onScreen = (g: string): string => g.replace(/_WITH_/g, '-WITH-')

/** The gate reading: recorded on the verdict from engine 0.6.0, recomputed for an earlier one. */
const gateOf = (v: LegalVerdict): RecordedGateStatus => (v.gate_status ?? recordedGateStatus(v))

/**
 * The citation as the report names it: case name and cite, the case name once (cold-review round 5: a full citation that already opens with
 * its case name printed it twice, "Anderson v. Liberty Lobby, Inc., Anderson v. Liberty Lobby, Inc., 477 U.S. 242, 248 (1986)").
 */
function shownName(cit: Citation | undefined, field: string): string {
  const name = cit?.case_name?.trim()
  const cite = cit?.cite?.trim()
  const fold = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (name && cite && fold(cite).startsWith(fold(name))) return cite
  return [name, cite].filter(Boolean).join(', ') || field
}

/** The 1-based line of offset `at` in `text` (a PASS under a rule before legal@0.5.0 is told where it matched from its evidence). */
function lineOf(text: string, at: number): number {
  let n = 1
  for (let i = 0; i < at && i < text.length; i++) if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] !== '\n')) n++
  return n
}

/**
 * The report a person reads: one block per citation, then the opinion texts and the verdict. `sources` (cold-review round 5), when given,
 * lets a PASS under a rule before legal@0.5.0 say where it matched (legal@0.5.0 says so in the answer itself).
 */
export function formatCitationsReport(v: LegalVerdict, citations: Citation[], sources?: OpinionSources): string {
  const lines: string[] = [`citations: ${v.claims.length} checked under ${v.ruleset.id}@${v.ruleset.version} (engine ${v.engine_version})`, '']
  const says = v.ruleset.id === 'legal' && (v.ruleset.version === '0.5.0' || v.ruleset.version === '0.5.1' || v.ruleset.version === '0.5.2')
  for (const [i, c] of v.claims.entries()) {
    const cit = citations[i]
    const name = shownName(cit, c.field)
    lines.push(`${(WORD[c.outcome] ?? c.outcome).padEnd(18)}${c.claim_id}  ${name}${c.insufficiency ? `  [${c.insufficiency.reason}]` : ''}`)
    lines.push(`        ${c.explanation}`)
    // display only: where a PASS matched, from its evidence, when the rule's own answer does not say it
    const loc = c.outcome === 'PASS' && !says ? c.evidence.find(e => e.locator.kind === 'span')?.locator : undefined
    if (loc?.kind === 'span' && sources) {
      const key = (v.opinion_sources ?? []).find(p => p.sha256 === loc.source_hash)?.key
      const text = key !== undefined ? textOf(sources[key]) : undefined
      if (text !== undefined) lines.push(`        found at: line ${lineOf(text, loc.start)} of ${key} (character offset ${loc.start})`)
    }
    for (const r of (v.remedies ?? []).filter(x => x.claims.includes(c.claim_id))) lines.push(`        remedy (${r.kind}): ${r.detail}`)
  }
  const prov = v.opinion_sources ?? []
  if (prov.length > 0) {
    lines.push('', 'opinion texts:')
    for (const p of prov) {
      const origin = [p.source, p.url, p.retrieved_at !== undefined ? `retrieved ${p.retrieved_at}` : undefined].filter((s): s is string => s !== undefined)
      lines.push(`  ${p.key}: ${origin.length > 0 ? origin.join(', ') : 'origin not stated'}; sha256 ${p.sha256}; ${p.chars} characters${p.bind !== undefined ? `; bind ${p.bind}` : ''}`)
      // legal@0.5.0: the sections it read, so a reader sees what was taken as the opinion
      if (p.sections !== undefined && p.sections.length > 0) lines.push(`    sections read: ${p.sections.map(s => `${s.name} (line${s.line === s.last_line ? ` ${s.line}` : `s ${s.line}-${s.last_line}`})`).join('; ')}`)
      for (const n of p.names) {
        const what = [n.cite ? `${n.cite.asked} ${n.cite.found ? 'named' : 'NOT named'}` : undefined, ...(n.parties ?? []).map(x => `${x.party} ${x.found !== null ? 'named' : 'NOT named'}`)].filter(Boolean).join('; ')
        if (n.by === 'caption') {
          // legal@0.3.0: what the caption says the text is, and what it names
          const cap = n.caption ? [n.caption.name, n.caption.cite].filter(Boolean).join(', ') : ''
          const head = n.caption ? `its caption reads ${cap || '(no case name)'}` : 'it has no caption'
          // legal@0.4.0 records where an out-of-window citation line sits; under 0.3.0 the text only names it outside its caption
          const outside = n.cite_line !== undefined
            ? ` (its citation line sits ${n.cite_line.lines} line${n.cite_line.lines === 1 ? '' : 's'} ${n.cite_line.at} the case name, outside the caption window: at most three lines above the case name or two below it)`
            : n.mentioned ? ' (the text names it outside its caption)' : ''
          const short = n.short_form !== undefined ? `; short form ${n.short_form.written} read as a pin cite to ${n.short_form.reads} (cited in full at ${n.short_form.from})` : ''
          // legal@0.5.0: how the citation as written was read for the lookup, and a citation line the Lexis "Reporter" block supplied
          const readAs = n.read_as !== undefined ? `; the citation as written, ${n.read_as.written}, read as ${n.read_as.reads}${n.read_as.pin !== undefined ? ` (pin page ${n.read_as.pin}, not checked)` : ''}` : ''
          const reporter = n.reporter_block ? '; its citation line is the line after the Lexis "Reporter" heading'
            : n.all_citations ? '; its citation line is the line under "All Citations" at the end of the text' : ''
          lines.push(`    for ${n.claim_id}: ${head}; ${n.tier === 'parties-only' ? 'BOUND BY PARTIES ONLY (bind "parties"; the caption does not print the reporter citation): not certified' : n.bound ? 'the caption names the citation' : `the caption does NOT name the citation${outside}`}${what ? ` (${what})` : ''}${short}${readAs}${reporter}`)
          continue
        }
        lines.push(`    for ${n.claim_id}: ${n.tier === 'parties-only' ? 'BOUND BY PARTIES ONLY (bind "parties"; the reporter citation is not in the text)' : n.bound ? 'names the citation' : 'does NOT name the citation'}${what ? ` (${what})` : ''}`)
      }
    }
  }
  const c = v.coverage
  const gate = gateOf(v)
  const meaning: Record<RecordedGateStatus, string> = {
    PASS: 'every citation was checked and held', PASS_WITH_OPEN: 'every citation that could be checked held, but some could not be checked',
    FAIL: 'at least one quotation is not in the opinion text supplied for it as quoted', INSUFFICIENT_DATA: 'no citation could be checked',
  }
  // a citation checked against a text bound by its parties alone is named in the headline, under every rule (display only)
  const partiesOnly = prov.flatMap(p => p.names).filter(n => n.tier === 'parties-only').length
  const po = partiesOnly === 0 ? ''
    : prov.some(p => p.names.some(n => n.by === 'caption')) ? `; ${partiesOnly} bound by parties only, not certified`
      : `; ${partiesOnly} bound by parties only, the reporter citation not in the text`
  lines.push('', `verdict: ${onScreen(gate)}: ${meaning[gate]} (${c.claims_pass} pass, ${c.claims_fail} fail, ${c.claims_insufficient} can't tell${po}); verdict_id ${v.verdict_id}`)
  lines.push('Checked: each quotation against the opinion text supplied for its cite. Not checked: that an authority exists, is good law, or stands for a proposition.', '')
  return lines.join('\n')
}

/**
 * A hint for a folder without sources.json (2026-10-06; display only): when a citation found no text and some file names do not read as a
 * reporter citation, say how a folder is keyed. A reader's "harlan-999-F4th-101.txt" answered can't tell for every citation, and the
 * message only listed "texts supplied: harlan-999-F4th-101".
 */
function folderHint(dir: string, v: LegalVerdict, citations: Citation[], sources: OpinionSources): string | undefined {
  if (existsSync(join(resolve(dir), 'sources.json'))) return undefined
  const missed = v.claims.map((c, i) => ({ c, cit: citations[i] })).filter(({ c }) => c.outcome === 'INSUFFICIENT_DATA' && c.insufficiency?.reason === 'REFERENCE_NOT_PROVIDED' && (c.insufficiency.missing?.length ?? 0) === 0 && /no (?:supplied text matched|opinion text supplied)/.test(c.insufficiency.detail))
  if (missed.length === 0) return undefined
  const odd = Object.keys(sources).filter(k => parseReporterCite(k) === undefined)
  if (odd.length === 0) return undefined
  const cite = missed.map(({ cit }) => cit?.cite?.match(/\d{1,4}\s+[A-Z][\p{L}.'’\d ]{0,24}?\s+\d{1,5}/u)?.[0]).find((x): x is string => x !== undefined) ?? '999 F.4th 101'
  const file = `${odd[0]}.txt`
  return `hint: ${missed.length} citation${missed.length === 1 ? '' : 's'} found no text. In a folder without sources.json, each text is keyed by its file name, and ${odd.length === 1 ? 'this name does' : 'these names do'} not read as a reporter citation: ${odd.slice(0, 5).map(k => `${k}.txt`).join(', ')}${odd.length > 5 ? ` and ${odd.length - 5} more` : ''}. Name the file by the citation it is for ("${cite}.txt"), or add a sources.json beside it: { "${cite}": { "file": "${file}" } }.`
}

/** `verify citations …`. Never throws: an unexpected error is a usage/input error (3). */
export function runCitations(argv: string[], io: CitationsIO = PROCESS_IO): number {
  let file: string | undefined
  let dir: string | undefined
  let ruleset: string | undefined
  let bundle: string | undefined
  let bind: BindMode | undefined
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] as string
    if (t === '-h' || t === '--help') { io.err(`${CITATIONS_USAGE}\n`); return 0 }
    else if (t === '--sources') dir = argv[++i]
    else if (t === '--ruleset') ruleset = argv[++i]
    else if (t === '--bundle') bundle = argv[++i]
    else if (t === '--json') json = true
    else if (t === '--bind') {
      const v = argv[++i]
      if (v !== 'strict' && v !== 'parties') return usageError(io, `--bind takes strict or parties (got ${v === undefined ? 'nothing' : v})`)
      bind = v
    }
    else if (t.startsWith('-')) return usageError(io, `unknown flag ${t}`)
    else if (file === undefined) file = t
    else return usageError(io, `one citations file only (got ${file} and ${t})`)
  }
  if (file === undefined) return usageError(io, 'needs <citations.json>')
  if (dir === undefined) return usageError(io, 'needs --sources <dir> (the opinion texts)')
  try {
    if (ruleset !== undefined) resolveLegalRuleset(ruleset)
    const citations = readCitationsFile(file)
    // 2026-10-20: a cite, case name, source key or text key over the bound (./cite-bound.ts) is refused before any pattern reads it
    // and before anything is hashed: exit 3, naming the bound and the length; never a verdict. A citation's own fields are refused
    // before the opinion texts are read; a text's key once the folder is read.
    const citeLong = citeTooLong(citations)
    if (citeLong) throw new InputError(citeTooLongWords(citeLong))
    const sources = loadOpinionFolder(dir, bind)
    const keyLong = citeTooLong([], sources, existsSync(join(resolve(dir), 'sources.json')) ? 'a key of sources.json' : 'the name of a .txt file in --sources')
    if (keyLong) throw new InputError(citeTooLongWords(keyLong))
    const verdict = verifyCitations(citations, sources, { ...(ruleset !== undefined ? { ruleset } : {}), ...(io.now ? { now: io.now } : {}) })
    const report = formatCitationsReport(verdict, citations, sources)
    // one rule for every command (cold-review round 4): the report a person reads on stderr; the verdict JSON on stdout with --json
    if (json) io.out(`${JSON.stringify(verdict, null, 2)}\n`)
    io.err(report)
    const hint = folderHint(dir, verdict, citations, sources)
    if (hint !== undefined) io.err(`${hint}\n`)
    if (bundle !== undefined) writeFileSync(bundle, `${JSON.stringify({ verdict, inputs: { citations, sources } }, null, 2)}\n`)
    const gate = gateOf(verdict)
    return gate === 'PASS' ? 0 : gate === 'FAIL' ? 1 : 2
  } catch (e) {
    io.err(`verify citations: ${e instanceof Error ? e.message : String(e)}\n`)
    return 3
  }
}
