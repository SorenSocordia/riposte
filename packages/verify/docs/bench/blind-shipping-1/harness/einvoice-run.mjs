// blind-shipping-1, e-invoice arm (PREREG.md sections 4.2, 5, 9, 10): the command that runs each ruleset on each file.
//
//   node harness/einvoice-run.mjs [--results results/einvoice] [--pins-root <tree root>]
//
// Before the first engine call it (1) recomputes every pin of section 2, as the latest amendment's table leaves it, on the
// tree it runs, records the output, and stops if any differs (section 10); (2) checks that the labels and the planted set of
// this arm are on the run's ledger with the sha256 their files have now (section 3), and stops if not; (3) records the start
// on the ledger. Then, for every selected file and every kept planted file, it builds the extraction by the fixed mapping
// (einvoice-extract.mjs) and runs, one child process at a time:
//   node <verify>/dist/cli.js check <extraction.json> --ruleset <the pinned ruleset file>
// for peppol-en16931@0.3.0 (the headline) and @0.2.0 (beside it). The answer is the exit code: 0 PASS, 1 FAIL, 2 can't tell
// (PASS-WITH-OPEN or INSUFFICIENT_DATA), 3 can't tell and listed as a refusal. Any other exit is a crash of the harness: the
// arm stops (section 10 allows one restart from the beginning with the same files, recorded on the ledger).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { args, checkPinsNow, CLI, citedRules, ledgerAppend, readJson, requireRecorded, RULESET_FILES, RUN_DIR, sha256, sha256File, TREE_ROOT, writeNew } from './lib.mjs'
import { extractUbl, MAPPING_ID, toJson } from './einvoice-extract.mjs'

const a = args(process.argv.slice(2), { flags: ['restart'] })
const R = resolve(a.results ?? join(RUN_DIR, 'results', 'einvoice'))
const OUT = join(R, a.restart ? 'engine-restart' : 'engine')
const fetchPath = join(R, 'fetch-manifest.json'), labelsPath = join(R, 'labels.json'), plantedPath = join(R, 'planted', 'planted-manifest.json')
for (const p of [fetchPath, labelsPath, plantedPath]) if (!existsSync(p)) { console.error(`missing ${p}: fetch, label and plant come first (RUN order in AMENDMENT)`); process.exit(3) }
if (existsSync(join(OUT, 'engine-einvoice.json'))) { console.error(`${OUT} already holds a run; the arm runs once (section 10)`); process.exit(1) }

const pins = await checkPinsNow(resolve(a['pins-root'] ?? TREE_ROOT))
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'pins-before.json'), JSON.stringify(pins, null, 1) + '\n')
if (!pins.ok) { console.error(`section 10: a pin differs from this tree, so nothing runs:\n  ${[...pins.stale, ...pins.unrecomputed].join('\n  ')}`); process.exit(1) }
requireRecorded('einvoice', { labels: labelsPath, planted: plantedPath }, { restart: !!a.restart })
const fetched = readJson(fetchPath), planted = readJson(plantedPath)
const rulesets = Object.fromEntries(Object.entries(RULESET_FILES).map(([v, f]) => [v, { file: f, sha256: sha256File(f), cites: citedRules(readJson(f)) }]))
ledgerAppend({ arm: 'einvoice', event: a.restart ? 'engine-restart' : 'engine-start', pins_sha256: sha256File(join(OUT, 'pins-before.json')), cli_sha256: sha256File(CLI) })

const items = [
  ...fetched.selected.map(s => ({ key: s.key, id: s.id, kind: 'natural', file: join(R, s.file), sha256: s.sha256 })),
  ...planted.kept.map(p => ({ key: p.key, id: p.key, kind: 'planted', file: join(R, 'planted', p.file), sha256: p.sha256 })),
]
const ANSWER = { 0: 'PASS', 1: 'FAIL', 2: 'CANT_TELL', 3: 'CANT_TELL' }
const rows = []
for (const it of items) {
  const bytes = readFileSync(it.file)
  if (sha256(bytes) !== it.sha256) { console.error(`${it.key}: the file's sha256 is not the one recorded; the arm stops`); process.exit(1) }
  const ex = extractUbl(bytes.toString('utf8'))
  const exPath = join(OUT, 'extractions', `${it.key}.json`)
  mkdirSync(join(OUT, 'extractions'), { recursive: true })
  writeFileSync(exPath, toJson(ex.extraction))
  writeFileSync(join(OUT, 'extractions', `${it.key}.trace.json`), JSON.stringify({ mapping: MAPPING_ID, root: ex.root, trace: ex.trace }, null, 1) + '\n')
  for (const [version, rs] of Object.entries(rulesets)) {
    let exit = 0, stdout = '', stderr = ''
    try { stdout = execFileSync(process.execPath, [CLI, 'check', exPath, '--ruleset', rs.file], { windowsHide: true, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { exit = e.status ?? -1; stdout = String(e.stdout ?? ''); stderr = String(e.stderr ?? '') }
    if (!(exit in ANSWER)) { console.error(`${it.key} @${version}: exit ${exit} is a crash of the harness; the arm stops (section 10)\n${stderr}`); process.exit(1) }
    let v = null
    try { v = JSON.parse(stdout) } catch { /* exit 3 prints no verdict */ }
    mkdirSync(join(OUT, 'verdicts', version), { recursive: true })
    writeFileSync(join(OUT, 'verdicts', version, `${it.key}.json`), stdout || '{}\n')
    const failCodes = (v?.claims ?? []).filter(c => c.outcome === 'FAIL').map(c => c.rule_id)
    rows.push({ key: it.key, id: it.id, kind: it.kind, ruleset: `peppol-en16931@${version}`, exit, answer: ANSWER[exit], refused: exit === 3,
      outcome: v?.outcome ?? null, gate_status: v?.gate_status ?? null, ruleset_named: v?.ruleset ? `${v.ruleset.id}@${v.ruleset.version}` : null,
      fail_codes: [...new Set(failCodes)], fail_rules: [...new Set(failCodes.map(c => rs.cites.byCode[c] ?? null).filter(Boolean))],
      verdict_id: v?.verdict_id ?? null, stderr_head: stderr.split('\n')[0] ?? '' })
  }
  console.error(`${it.key} ${rows.slice(-2).map(r => `${r.ruleset.split('@')[1]} ${r.answer}`).join(' · ')}`)
}
const out = { format: 'blind-shipping-1/einvoice-engine/1', mapping: MAPPING_ID, cli: { path: 'dist/cli.js', sha256: sha256File(CLI) }, node: process.version,
  rulesets: Object.fromEntries(Object.entries(rulesets).map(([v, r]) => [v, { sha256: r.sha256, cites: r.cites.rules }])), rows }
const h = writeNew(join(OUT, 'engine-einvoice.json'), out)
ledgerAppend({ arm: 'einvoice', event: 'engine-end', kind: 'engine-output', sha256: h, rows: rows.length })
console.error(`done: ${items.length} files × ${Object.keys(rulesets).length} rulesets; engine-einvoice.json sha256 ${h}`)
