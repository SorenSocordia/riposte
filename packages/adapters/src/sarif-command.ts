/**
 * `riposte-sarif`: check files in a repository and write the findings as SARIF 2.1.0 (./sarif.ts). The GitHub Action
 * (riposte-overlay .github/actions/riposte-verify) runs it; the bin is ./sarif-cli.ts (I/O only).
 *
 * FAIL CLOSED BY DEFAULT (2026-10-05). `--fail-on` defaults to `insufficient-data`: the step fails on a FAIL, on
 * a check that could not run (can't tell, INSUFFICIENT_DATA, PASS-WITH-OPEN included) and on a file that could not be checked,
 * as the command-line checks do. `fail` loosens it to FAILs only. The outputs and messages say INSUFFICIENT_DATA / can't
 * tell; the older value `abstain` is still read, as `insufficient-data`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeclarativeRuleset, verify } from 'riposte-verify'
import type { Json, Verdict } from 'riposte-verify'
import { BUILTIN_RULESETS, replayCommand, verifyCall, type References, type RulesetChoice } from './scorers/core.js'
import { sarifCounts, sarifSummary, toSarif, type SarifItem } from './sarif.js'

export const SARIF_USAGE = `riposte-sarif --files <glob> [--files <glob>]... [options]
  Checks each matched file and writes SARIF 2.1.0: one result per check that did not PASS (FAIL is an error, can't tell,
  INSUFFICIENT_DATA, a warning). Each verdict's proof is saved, and every result names the command that re-performs it.
  --files <glob>          files to check, relative to the working directory; repeatable, or one pattern per line;
                          ** * ? {a,b} wildcards; a leading ! excludes. A file is an extracted document (JSON), or an inputs
                          object { "extraction", "references"?, "source"?: { "text" }, "ruleset"? } (the shape a replay takes;
                          its "ruleset", a built-in name or a declarative ruleset, overrides --ruleset for that file)
  --ruleset <r>           invoice (default) | pay-app | a declarative ruleset file
  --out <file>            the SARIF file (default riposte.sarif)
  --proof-dir <dir>       where each verdict's replay bundle is written (default riposte-proofs)
  --fail-on <when>        insufficient-data (default): exit 1 if any check FAILs or can't tell (INSUFFICIENT_DATA, a PASS
                          with a check that could not run included), or a file could not be checked · fail: exit 1 only
                          if a check FAILs (can't tell then passes) · none: never. The older value abstain is read as insufficient-data
  --root <dir>            the folder SARIF locations are relative to (default: the working directory; in CI, the repository root)
  --category <id>         the SARIF automationDetails category
  --summary <file>        append a Markdown digest (a CI job summary file)
  --github-output <file>  append outputs: sarif-file, proof-dir (relative to --root), files, pass, fail, insufficient-data,
                          refused, outcome (FAIL, INSUFFICIENT_DATA, PASS-WITH-OPEN or PASS)
Exit 0 · 1 the --fail-on condition was met · 3 usage, or no file matched
`

export type FailOn = 'insufficient-data' | 'fail' | 'none'
/** The default: fail closed on can't tell, as the command-line checks do (2026-10-05). */
export const DEFAULT_FAIL_ON: FailOn = 'insufficient-data'
export interface SarifArgs {
  files: string[]; ruleset: string; out: string; proofDir: string; failOn: FailOn
  root?: string; category?: string; summary?: string; githubOutput?: string; help?: boolean; error?: string
}

const VALUE_FLAGS: Record<string, keyof SarifArgs> = {
  '--ruleset': 'ruleset', '--out': 'out', '--proof-dir': 'proofDir', '--fail-on': 'failOn', '--root': 'root',
  '--category': 'category', '--summary': 'summary', '--github-output': 'githubOutput',
}

export function parseSarifArgs(argv: string[]): SarifArgs {
  const a: SarifArgs = { files: [], ruleset: 'invoice', out: 'riposte.sarif', proofDir: 'riposte-proofs', failOn: DEFAULT_FAIL_ON }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!
    if (f === '--help' || f === '-h') { a.help = true; continue }
    const v = argv[i + 1]
    if (f === '--files') {
      if (v === undefined) return { ...a, error: '--files needs a pattern' }
      a.files.push(...v.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))
      i++
      continue
    }
    const key = VALUE_FLAGS[f]
    if (!key) return { ...a, error: `unknown argument ${f}` }
    if (v === undefined || v.startsWith('--')) return { ...a, error: `${f} needs a value` }
    ;(a as unknown as Record<string, string>)[key] = v
    i++
  }
  if ((a.failOn as string) === 'abstain') a.failOn = 'insufficient-data' // the older name, still read
  if (!['insufficient-data', 'fail', 'none'].includes(a.failOn)) return { ...a, error: `--fail-on is insufficient-data (the default), fail or none (got ${a.failOn})` }
  if (!a.help && !a.files.length) return { ...a, error: 'give at least one --files pattern' }
  if (!a.out.trim()) return { ...a, error: '--out needs a file' }
  if (!a.proofDir.trim()) return { ...a, error: '--proof-dir needs a folder' }
  return a
}

/** A glob as a regular expression over `/`-separated relative paths: `**` any depth, `*` and `?` within a segment, `{a,b}`. */
export function globRegex(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i++ }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = p.indexOf('}', i)
      if (end < 0) { re += '\\{'; continue }
      re += `(?:${p.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Files under `dir` (relative, `/`-separated), skipping node_modules and .git. */
function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) listFiles(full, base, out)
    else if (e.isFile()) out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

/** The files the patterns select, in path order. A pattern without wildcards names one file, which must exist. */
export function matchFiles(cwd: string, patterns: string[]): { files: string[]; missing: string[] } {
  const include = patterns.filter((p) => !p.startsWith('!'))
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => globRegex(p.slice(1)))
  const literal = include.filter((p) => !/[*?{]/.test(p))
  const missing = literal.filter((p) => !existsSync(resolve(cwd, p)) || !statSync(resolve(cwd, p)).isFile())
  const globs = include.filter((p) => /[*?{]/.test(p)).map(globRegex)
  const all = globs.length ? listFiles(cwd) : []
  const picked = new Set<string>([
    ...literal.filter((p) => !missing.includes(p)).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')),
    ...all.filter((f) => globs.some((g) => g.test(f))),
  ])
  return { files: [...picked].filter((f) => !exclude.some((x) => x.test(f))).sort(), missing }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const INPUT_KEYS = new Set(['extraction', 'references', 'source', 'ruleset'])

/** An inputs object (the shape `riposte-verify replay` takes), or undefined when the file is the extraction itself. */
export function asInputs(doc: unknown): { extraction: Json; references?: References; source?: string; ruleset?: RulesetChoice } | undefined {
  if (!isObj(doc) || !isObj(doc.extraction) && !Array.isArray(doc.extraction)) return undefined
  if (!Object.keys(doc).every((k) => INPUT_KEYS.has(k))) return undefined
  const src = doc.source
  return {
    extraction: doc.extraction as Json,
    ...(isObj(doc.references) ? { references: doc.references as References } : {}),
    ...(isObj(src) && typeof src.text === 'string' ? { source: src.text } : {}),
    ...(isDeclarativeRuleset(doc.ruleset) || (BUILTIN_RULESETS as readonly unknown[]).includes(doc.ruleset) ? { ruleset: doc.ruleset as RulesetChoice } : {}),
  }
}

export interface SarifRun { code: number; stdout: string; stderr: string; log?: ReturnType<typeof toSarif> }

export function sarifCommand(argv: string[], env: { cwd: string }): SarifRun {
  const a = parseSarifArgs(argv)
  if (a.help) return { code: 0, stdout: SARIF_USAGE, stderr: '' }
  if (a.error) return { code: 3, stdout: '', stderr: `riposte-sarif: ${a.error}\n${SARIF_USAGE}` }
  const cwd = resolve(env.cwd)
  const root = resolve(cwd, a.root ?? '.')
  let ruleset: RulesetChoice
  if ((BUILTIN_RULESETS as readonly string[]).includes(a.ruleset)) ruleset = a.ruleset as RulesetChoice
  else {
    try {
      const r: unknown = JSON.parse(readFileSync(resolve(cwd, a.ruleset), 'utf8'))
      if (!isDeclarativeRuleset(r)) throw new Error('not a declarative ruleset')
      ruleset = r
    } catch (e) {
      return { code: 3, stdout: '', stderr: `riposte-sarif: --ruleset ${a.ruleset}: ${BUILTIN_RULESETS.join(' or ')}, or a declarative ruleset file (${(e as Error).message})\n` }
    }
  }
  const { files, missing } = matchFiles(cwd, a.files)
  if (missing.length) return { code: 3, stdout: '', stderr: `riposte-sarif: no such file: ${missing.join(', ')}\n` }
  if (!files.length) return { code: 3, stdout: '', stderr: `riposte-sarif: no file matched ${a.files.join(', ')}\n` }

  const items: SarifItem[] = []
  const proofDir = resolve(cwd, a.proofDir)
  for (const rel of files) {
    const abs = resolve(cwd, rel)
    const uri = relative(root, abs).split(sep).join('/')
    const text = readFileSync(abs, 'utf8')
    let doc: unknown
    try { doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) } catch (e) {
      items.push({ uri, text, layout: 'extraction', result: { kind: 'refused', reason: `not JSON (${(e as Error).message})` } })
      continue
    }
    const inputs = asInputs(doc)
    const extraction = (inputs ? inputs.extraction : doc) as Json
    let verdict: Verdict
    let bound: Record<string, unknown>
    try {
      const call = verifyCall(extraction, {
        ruleset: inputs?.ruleset ?? ruleset,
        ...(inputs?.references ? { references: inputs.references } : {}),
        ...(inputs?.source ? { source: inputs.source } : {}),
      })
      verdict = verify(extraction, call.options)
      bound = call.inputs
    } catch (e) {
      if ((e as Error)?.name !== 'InputRefused') throw e
      items.push({ uri, text, layout: inputs ? 'inputs' : 'extraction', result: { kind: 'refused', reason: (e as Error).message } })
      continue
    }
    mkdirSync(proofDir, { recursive: true })
    const proofAbs = join(proofDir, `${verdict.verdict_id}.json`)
    writeFileSync(proofAbs, `${JSON.stringify({ verdict, inputs: bound }, null, 2)}\n`)
    const proofFile = (isAbsolute(a.proofDir) ? proofAbs : relative(cwd, proofAbs)).split(sep).join('/')
    items.push({ uri, text, layout: inputs ? 'inputs' : 'extraction', result: { kind: 'verdict', verdict, replay: replayCommand(proofFile), proofFile } })
  }

  const rootUri = pathToFileURL(root).href.replace(/\/?$/, '/')
  const log = toSarif(items, { rootUri, ...(a.category ? { category: a.category } : {}) })
  const out = resolve(cwd, a.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(log, null, 2)}\n`)
  const c = sarifCounts(items)
  const outcome = c.fail ? 'FAIL' : c.insufficient_data || c.refused ? 'INSUFFICIENT_DATA' : c.open ? 'PASS-WITH-OPEN' : 'PASS'
  if (a.summary) appendFileSync(a.summary, sarifSummary(log))
  if (a.githubOutput) {
    const rel = (p: string) => relative(root, p).split(sep).join('/') // the repository root: where later CI steps run
    appendFileSync(a.githubOutput, [
      `sarif-file=${rel(out)}`, `proof-dir=${rel(proofDir)}`, `files=${c.files}`, `pass=${c.pass}`, `fail=${c.fail}`,
      `insufficient-data=${c.insufficient_data}`, `refused=${c.refused}`, `outcome=${outcome}`, '',
    ].join('\n'))
  }
  const failed = a.failOn === 'fail' ? c.fail > 0 : a.failOn === 'insufficient-data' ? c.fail > 0 || c.warnings > 0 || c.refused > 0 : false
  const stderr = `riposte-sarif: ${c.files} file(s): ${c.pass} PASS${c.open ? ` (${c.open} PASS-WITH-OPEN: a check could not run)` : ''} · ${c.fail} FAIL · ${c.insufficient_data} INSUFFICIENT_DATA · ${c.refused} not checked; ` +
    `${c.errors} FAIL finding(s) (error) · ${c.warnings} can't-tell finding(s) (warning) → ${relative(cwd, out).split(sep).join('/')}` +
    `${failed ? ` · failing (--fail-on ${a.failOn}${a.failOn === 'insufficient-data' && !c.fail ? ": can't tell fails the step by default; --fail-on fail passes it" : ''})` : ''}\n`
  return { code: failed ? 1 : 0, stdout: '', stderr, log }
}
