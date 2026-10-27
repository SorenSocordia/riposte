// SPDX-License-Identifier: Apache-2.0
// two-engines-1: the Node engine and the Python engine on the same replay files with the same flags; for each check, the exit
// code and the first stderr line of each, and whether they agree. Implements PREREG-two-engines-1.md beside this file; it runs
// nothing that prereg governs unless every pin in it matches the tree (a full run), and a run limited to a few rows (--rows,
// --dry-run) is labelled a dry run and writes elsewhere. prototype; no measured accuracy.
//
//   node conformance/engine_py/bench/run-two-engines.mjs [--dry-run | --rows <id,id,...>] [--out <dir>] [--jobs <n>]
//        [--node-cli <cli.js>] [--python <python>] [--pins <PINS.json>] [--print-pins] [--keep-work]
//
// Arms: the whetstone corpus (every row of whetstone/mutations.json, mutations-2.json, HELDOUT.json, HELDOUT-2.json, in each
// mode its row names, spawned as whetstone/run.mjs spawns: `node <cli> replay <file> ...args`, from the repository root); the
// conformance vectors (every run conformance/vectors.json lists); the engine 0.0.1 pack (each bundle written as { verdict, inputs },
// as conformance/check-engine.mjs writes it). The Python engine runs through conformance/engine_py/shim.mjs.
//
// Exit: 0 the run finished (agreement is the result, not the exit) · 3 refused (usage, a file that cannot be read) · 4 integrity
// (a held-out file does not match its seal, or, for a full run, a pin does not match the tree; nothing was replayed).

import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = dirname(fileURLToPath(import.meta.url))
const ENGINE_PY = resolve(BENCH, '..')
const ROOT = resolve(ENGINE_PY, '..', '..')
const WS = join(ROOT, 'whetstone')
const FAMILIES = ['outside', 'inside', 'words', 'confusable', 'issued-at', 'signature', 'appended', 'layout', 'trusted-key', 'lenient-remedies']
const MODE_ORDER = ['replay', 'strict', 'trusted', 'trusted-strict', 'lenient', 'lenient-strict']
const DEFAULT_ARGS = { replay: [], strict: ['--strict'] }
// PREREG section 5: the words the Python engine names its own limits with, and the Node answers only re-performing can give.
// A disagreement is "outside the Python engine's declared scope" only when both hold; any other is classed by hand after the run.
const SCOPE_WORDS = ['this build re-performs invoice@0.1.0 only', 'outside what this build re-performs', 'overrides are not re-performed by this build yet',
  'whose registry this build does not carry', 'the declarative reader beside this build', "can't tell here"]
const REPERFORMED_ANSWER = /^(verify replay: (outcome VERIFIED|FAILED: the re-performed verdict differs|FAILED: the verdict carries no remedies)|(MATCH|DIVERGED) )/

function refuse(msg) { process.stderr.write(`two-engines: refused: ${msg}\n`); process.exit(3) }
function integrity(msg) { process.stderr.write(`two-engines: INTEGRITY: ${msg}; nothing was replayed\n`); process.exit(4) }

// ---- arguments
const argv = process.argv.slice(2)
const opt = { dry: false, rows: null, out: null, jobs: 1, nodeCli: null, python: null, pins: join(BENCH, 'PINS-two-engines-1.json'), printPins: false, keepWork: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run') { opt.dry = true; continue }
  if (a === '--print-pins') { opt.printPins = true; continue }
  if (a === '--keep-work') { opt.keepWork = true; continue }
  if (!['--rows', '--out', '--jobs', '--node-cli', '--python', '--pins'].includes(a)) refuse(`unknown argument ${a}`)
  const v = argv[++i]
  if (v === undefined) refuse(`${a} needs a value`)
  if (a === '--rows') opt.rows = v.split(',').filter(Boolean)
  else if (a === '--out') opt.out = resolve(v)
  else if (a === '--jobs') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 16) refuse('--jobs takes a whole number from 1 to 16'); opt.jobs = n }
  else if (a === '--node-cli') opt.nodeCli = resolve(v)
  else if (a === '--python') opt.python = v
  else if (a === '--pins') opt.pins = resolve(v)
}
const limited = opt.dry || opt.rows !== null
if (!opt.nodeCli) opt.nodeCli = [join(ROOT, 'packages', 'verify', 'dist', 'cli.js'), join(ROOT, '..', 'verify', 'dist', 'cli.js')].find(existsSync) ?? join(ROOT, 'packages', 'verify', 'dist', 'cli.js')
if (!opt.out) opt.out = join(BENCH, limited ? 'results-dry' : 'results')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

// ---- pins (PREREG section 2): each computed on this tree the way blind-shipping-1 section 2 defines a folder's digest
function filesUnder(dir, rel = '', skip = () => false) {
  const out = []
  for (const f of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${f}` : f
    if (skip(r)) continue
    if (statSync(join(dir, r)).isDirectory()) out.push(...filesUnder(dir, r, skip)); else out.push(r)
  }
  return out
}
function folderDigest(dir, skip) {
  if (!existsSync(dir)) return null
  const names = filesUnder(dir, '', skip).sort()
  return { sha256: sha256(names.map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join('')), files: names.length }
}
const fileSha = (p) => (existsSync(p) ? sha256(readFileSync(p)) : null)
function pythonCommand() {
  return opt.python ?? process.env.RIPOSTE_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
}
function versions() {
  let py = null
  try { py = execFileSync(pythonCommand(), ['-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8' }).trim() } catch { py = null }
  return { node: process.version, python: py, platform: process.platform }
}

// ---- the whetstone corpus, loaded as whetstone/run.mjs loads it (seals first; modes and their flags from the row files)
const HALVES = [
  { half: 1, dev: 'mutations.json', held: 'HELDOUT.json', seal: 'HELDOUT.sha256' },
  { half: 2, dev: 'mutations-2.json', held: 'HELDOUT-2.json', seal: 'HELDOUT-2.sha256' },
]
function readJson(p, what) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { refuse(`${what} cannot be read (${e.message})`) } }
function loadCorpus(withHeld) {
  const rows = []
  for (const h of HALVES) {
    const sealText = existsSync(join(WS, h.seal)) ? readFileSync(join(WS, h.seal), 'utf8').trim() : null
    const m = sealText && new RegExp(`^([0-9a-f]{64}) {2}${h.held.replace('.', '\\.')}$`).exec(sealText)
    if (!m) integrity(`${h.seal} is missing or not one line "<sha256>  ${h.held}"`)
    for (const r of readJson(join(WS, h.dev), h.dev).rows) rows.push({ ...r, half: h.half, split: 'dev' })
    if (!withHeld) continue
    if (!existsSync(join(WS, h.held))) integrity(`${h.held} is missing (the held-out rows need the sealed file)`)
    const now = fileSha(join(WS, h.held))
    if (now !== m[1]) integrity(`${h.held} does not match ${h.seal} (sealed ${m[1]}, now ${now})`)
    for (const r of readJson(join(WS, h.held), h.held).rows) rows.push({ ...r, half: h.half, split: 'heldout' })
  }
  rows.sort((a, b) => a.half - b.half || FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows
}
const modesOf = (r) => Object.keys(r.expect).sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b) || (a < b ? -1 : 1))
const argsOf = (r, m) => r.expect[m].args || DEFAULT_ARGS[m]
/** The bytes a row replays, and how: id, file kind, text, key files, each mode's flags (expectations left out: they are not compared). */
function replayedDigest(rows) {
  return sha256(rows.map((r) => JSON.stringify({ id: r.id, ext: r.ext, text: r.text, aux: r.aux ?? null, modes: modesOf(r).map((m) => [m, argsOf(r, m)]) }) + '\n').join(''))
}

function computePins(withHeld) {
  const devRows = loadCorpus(false)
  return {
    engine_sources: folderDigest(join(ROOT, 'packages', 'verify', 'src')),
    python_engine: folderDigest(ENGINE_PY, (r) => r === 'bench' || r.split('/').includes('__pycache__')),
    // the binding verifier the Python engine imports (canonical JSON, sha256, the identity chain), beside its folder
    binding_verifier: { sha256: fileSha(join(ROOT, 'conformance', 'riposte_bind.py')) },
    harness: { sha256: fileSha(join(BENCH, 'run-two-engines.mjs')) },
    whetstone_files: Object.fromEntries(['mutations.json', 'mutations-2.json', 'HELDOUT.sha256', 'HELDOUT-2.sha256'].map((f) => [f, fileSha(join(WS, f))])),
    whetstone_dev_replayed: { sha256: replayedDigest(devRows), rows: devRows.length },
    vectors_manifest: { sha256: fileSha(join(ROOT, 'conformance', 'vectors.json')) },
    pack: { sha256: fileSha(join(ROOT, 'packages', 'verify', 'test', 'fixtures', 'engine-0.0.1-bundles.json')) },
    ...versions(),
    with_heldout: withHeld,
  }
}

if (opt.printPins) { process.stdout.write(JSON.stringify(computePins(false), null, 2) + '\n'); process.exit(0) }

// a full run checks every pin before anything is replayed (PREREG section 10)
const pinsNow = computePins(!limited)
const pinProblems = []
let expected = null
if (existsSync(opt.pins)) {
  expected = readJson(opt.pins, 'the pins file')
  const cmp = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) pinProblems.push(`${what}: pinned ${JSON.stringify(a)}, tree ${JSON.stringify(b)}`) }
  cmp('engine sources (packages/verify/src/)', expected.engine_sources, pinsNow.engine_sources)
  cmp('Python engine (conformance/engine_py/, bench/ aside)', expected.python_engine, pinsNow.python_engine)
  cmp('binding verifier (conformance/riposte_bind.py)', expected.binding_verifier, pinsNow.binding_verifier)
  cmp('harness', expected.harness, pinsNow.harness)
  cmp('whetstone replayed bytes (development rows)', expected.whetstone_dev_replayed, pinsNow.whetstone_dev_replayed)
  for (const f of ['HELDOUT.sha256', 'HELDOUT-2.sha256']) cmp(`whetstone seal ${f}`, expected.whetstone_files[f], pinsNow.whetstone_files[f])
  cmp('conformance vectors manifest', expected.vectors_manifest, pinsNow.vectors_manifest)
  cmp('engine 0.0.1 pack', expected.pack, pinsNow.pack)
  cmp('Node version', expected.node, pinsNow.node)
  cmp('Python version', expected.python, pinsNow.python)
} else pinProblems.push(`no pins file at ${relative(ROOT, opt.pins)}`)
// a moved row file whose replayed bytes did not move is noted, never a stop (PREREG section 10: expectations are not compared)
const notes = expected ? ['mutations.json', 'mutations-2.json'].filter((f) => expected.whetstone_files?.[f] !== pinsNow.whetstone_files[f]).map((f) => `${f} moved (its replayed bytes did not, or the run would have stopped): expectations are not compared here`) : []
if (pinProblems.length && !limited) integrity(`a pin does not match this tree:\n  ${pinProblems.join('\n  ')}`)
if (!existsSync(opt.nodeCli)) refuse(`the Node engine is not built (${relative(ROOT, opt.nodeCli)} is missing): run npm run build at the repository root`)

// ---- the checks
let rows = loadCorpus(!limited)
// the dry run's ten rows, fixed: the first development row of each family of the first half, then of the second half's own two;
// a full run marks them, since both engines replayed them before the stamp (PREREG sections 7 and 9)
function dryRunRows(all) {
  const pick = []
  for (const f of FAMILIES.slice(0, 8)) { const r = all.find((x) => x.half === 1 && x.split === 'dev' && x.family === f); if (r) pick.push(r.id) }
  for (const f of ['trusted-key', 'lenient-remedies']) { const r = all.find((x) => x.half === 2 && x.split === 'dev' && x.family === f); if (r) pick.push(r.id) }
  return pick
}
const seenRows = new Set(dryRunRows(rows))
if (opt.dry) opt.rows = [...seenRows]
if (opt.rows) {
  const missing = opt.rows.filter((id) => !rows.some((r) => r.id === id))
  if (missing.length) refuse(`no development row ${missing.join(', ')}`)
  rows = rows.filter((r) => opt.rows.includes(r.id))
}
const work = join(BENCH, '.work')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const rel = (p) => relative(ROOT, p)
const checks = []
for (const r of rows) {
  writeFileSync(join(work, r.id + r.ext), r.text, 'utf8')
  if (r.aux) { mkdirSync(join(work, r.id + '.aux'), { recursive: true }); for (const [n, t] of Object.entries(r.aux)) writeFileSync(join(work, r.id + '.aux', n), t, 'utf8') }
  const aux = rel(join(work, r.id + '.aux'))
  for (const m of modesOf(r)) checks.push({ arm: 'whetstone', id: r.id, half: r.half, split: r.split, family: r.family, mode: m, seen_in_dry_run: seenRows.has(r.id), file: rel(join(work, r.id + r.ext)), args: argsOf(r, m).map((x) => x.split('{aux}').join(aux)) })
}
if (!limited) {
  const manifest = readJson(join(ROOT, 'conformance', 'vectors.json'), 'conformance/vectors.json')
  for (const v of manifest.vectors) {
    const file = join(ROOT, 'conformance', 'vectors', v.file)
    if (fileSha(file) !== v.sha256) integrity(`vector ${v.id}'s bytes changed (a checkout may have converted its line endings)`)
    for (const run of [{ args: v.expect.args ?? [] }, ...(v.expect.also ?? [])]) checks.push({ arm: 'vectors', id: v.id, mode: run.args.length ? run.args.join(' ') : 'replay', file: rel(file), args: run.args ?? [] })
  }
  const pack = readJson(join(ROOT, 'packages', 'verify', 'test', 'fixtures', 'engine-0.0.1-bundles.json'), 'the engine 0.0.1 pack')
  for (const b of pack.bundles) {
    writeFileSync(join(work, `pack-${b.id}.json`), JSON.stringify({ verdict: b.verdict, inputs: b.inputs }))
    checks.push({ arm: 'pack', id: b.id, mode: 'replay', file: rel(join(work, `pack-${b.id}.json`)), args: [] })
  }
}

// ---- replay, both engines, the same argv and working folder
const shim = join(ENGINE_PY, 'shim.mjs')
const env = { ...process.env, NO_COLOR: '1', RIPOSTE_PYTHON: pythonCommand() }
function spawn(cli, file, args) {
  return new Promise((done) => {
    const t0 = process.hrtime.bigint()
    execFile(process.execPath, [cli, 'replay', file, ...args], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, env, encoding: 'buffer' }, (err, out, errText) => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      const exit = err ? (typeof err.code === 'number' ? err.code : -1) : 0
      const text = errText.toString('utf8')
      const first = text.split('\n').find((l) => l.trim() !== '') || ''
      const second = text.split('\n').filter((l) => l.trim() !== '')[1] || ''
      done({ exit, first, second, stderr_sha256: sha256(errText), stdout_sha256: sha256(out), ms: Math.round(ms * 10) / 10, stderr: text })
    })
  })
}
// the one normalization (PREREG section 5): each program's own command, where a line names it, reads <command>
const nodeAs = `node ${relative(ROOT, opt.nodeCli).split(/[\\/]/).join('/')}`
const pyAs = `python3 ${relative(ROOT, join(ENGINE_PY, 'cli.py')).split(/[\\/]/).join('/')}`
const norm = (line, own) => line.split(own).join('<command>')
let next = 0
await Promise.all(Array.from({ length: Math.min(opt.jobs, checks.length) }, async () => {
  while (next < checks.length) {
    const c = checks[next++]
    c.node = await spawn(opt.nodeCli, c.file, c.args)
    c.python = await spawn(shim, c.file, c.args)
  }
}))
for (const c of checks) {
  const same = c.node.exit === c.python.exit && norm(c.node.first, nodeAs) === norm(c.python.first, pyAs)
  const pyNamesLimit = SCOPE_WORDS.some((w) => c.python.first.includes(w) || (/^NOT_REPERFORMED /.test(c.python.first) && c.python.second.includes(w)))
  const scope = !same && pyNamesLimit && REPERFORMED_ANSWER.test(c.node.first)
  c.result = same ? 'agree' : scope ? 'python-scope' : 'disagree'
  c.full_stderr_same = c.node.stderr_sha256 === c.python.stderr_sha256
  c.stdout_same = c.node.stdout_sha256 === c.python.stdout_sha256
  delete c.node.stderr; delete c.python.stderr; delete c.node.second; delete c.python.second
}

// ---- results
function tally(list) {
  const t = { checks: list.length, agree: 0, python_scope: 0, disagree: 0, full_stderr_same: 0 }
  for (const c of list) { t[c.result === 'python-scope' ? 'python_scope' : c.result]++; if (c.full_stderr_same) t.full_stderr_same++ }
  return t
}
const group = (key) => Object.fromEntries([...new Set(checks.map(key))].map((k) => [k, tally(checks.filter((c) => key(c) === k))]))
const ms = (who) => { const v = checks.map((c) => c[who].ms).sort((a, b) => a - b); return { total_s: Math.round(v.reduce((s, x) => s + x, 0) / 100) / 10, median_ms: v[Math.floor(v.length / 2)] ?? null } }
const summary = {
  run: limited ? 'DRY RUN (a few development rows only; not the preregistered run)' : 'two-engines-1, the preregistered run',
  total: tally(checks), by_arm: group((c) => c.arm), by_split: group((c) => (c.arm === 'whetstone' ? `whetstone half ${c.half} ${c.split}` : c.arm)),
  development_rows_replayed_before_the_stamp: tally(checks.filter((c) => c.seen_in_dry_run)),
  development_rows_not_replayed_before_the_stamp: tally(checks.filter((c) => c.arm === 'whetstone' && c.split === 'dev' && !c.seen_in_dry_run)),
  by_family: group((c) => (c.arm === 'whetstone' ? c.family : c.arm)), by_mode: group((c) => (c.arm === 'whetstone' ? c.mode : c.arm)),
  wall_time: { node: ms('node'), python_through_the_shim: ms('python'), jobs: opt.jobs },
}
mkdirSync(opt.out, { recursive: true })
writeFileSync(join(opt.out, 'checks.jsonl'), checks.map((c) => JSON.stringify(c)).join('\n') + '\n')
writeFileSync(join(opt.out, 'RUN.json'), JSON.stringify({ summary, pins_now: pinsNow, pins_expected: expected, pin_problems: pinProblems, notes, node_cli: rel(opt.nodeCli), commands: { node: nodeAs, python: pyAs } }, null, 2) + '\n')
const dis = checks.filter((c) => c.result !== 'agree')
const md = [`# ${summary.run}: every check where the two engines' exit code or first line differ`, '',
  `${summary.total.checks} checks: ${summary.total.agree} agree, ${summary.total.python_scope} outside the Python engine's declared scope, ${summary.total.disagree} other.`, '',
  '| arm | row | mode | Node exit | Python exit | result | Node first line | Python first line | class (post-run audit) |', '|---|---|---|---|---|---|---|---|---|',
  ...dis.map((c) => `| ${c.arm} | ${c.id} | ${c.mode} | ${c.node.exit} | ${c.python.exit} | ${c.result} | ${c.node.first.replace(/\|/g, '\\|')} | ${c.python.first.replace(/\|/g, '\\|')} | |`)]
writeFileSync(join(opt.out, 'DISAGREEMENTS.md'), md.join('\n') + '\n')
if (!opt.keepWork) rmSync(work, { recursive: true, force: true })
const t = summary.total
process.stdout.write(`two-engines: ${summary.run}\n${t.checks} checks: ${t.agree} agree on exit and first line, ${t.python_scope} outside the Python engine's declared scope, ${t.disagree} other disagreements\n`)
for (const [k, v] of Object.entries(summary.by_split)) process.stdout.write(`  ${k.padEnd(28)} ${v.checks} checks, ${v.agree} agree, ${v.python_scope} scope, ${v.disagree} other\n`)
process.stdout.write(`wall time: Node ${summary.wall_time.node.total_s}s (median ${summary.wall_time.node.median_ms} ms), Python through the shim ${summary.wall_time.python_through_the_shim.total_s}s (median ${summary.wall_time.python_through_the_shim.median_ms} ms)\n`)
if (pinProblems.length) process.stdout.write(`pins (a dry run is not held to them):\n  ${pinProblems.join('\n  ')}\n`)
for (const n of notes) process.stdout.write(`note: ${n}\n`)
process.stdout.write(`results: ${rel(opt.out)}\n`)
