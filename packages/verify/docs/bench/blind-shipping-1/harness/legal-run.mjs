// blind-shipping-1, legal arm (PREREG.md sections 4.3, 5, 9, 10): the command that runs the citations check.
//
//   node harness/legal-run.mjs [--results results/legal] [--pins-root <tree root>] [--restart]
//
// Before the first engine call it (1) recomputes every pin of section 2 on the tree it runs, records the output, and stops
// if any differs (section 10); (2) checks that the transcription (the citations/ folder), the labels (labels/) and the
// planted set (planted/planted.json) are on the run's ledger with the digests they have now (section 3), and stops if not;
// (3) records the start on the ledger. Then, one child process at a time, under the legal rule this engine uses by default:
//   node <verify>/dist/cli.js citations citations/<brief id>.json --sources opinions/ --json      (each brief)
//   node <verify>/dist/cli.js citations planted/citations-planted.json --sources opinions/ --json  (the planted set)
// The answer for a quotation is its claim's outcome: PASS, FAIL, or can't tell (INSUFFICIENT_DATA or an open answer). An
// exit 3 makes every quotation of that file can't tell, listed as refused. Any other exit stops the arm (section 10).
// The run stops, before any answer is used, if a verdict names a legal rule other than the one section 2's table pins.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { args, checkPinsNow, CLI, digestOf, ledgerAppend, readJson, requireRecorded, RUN_DIR, sha256File, TREE_ROOT, writeNew } from './lib.mjs'

const a = args(process.argv.slice(2), { flags: ['restart'] })
const L = resolve(a.results ?? join(RUN_DIR, 'results', 'legal'))
const OUT = join(L, a.restart ? 'engine-restart' : 'engine')
const C = join(L, 'citations'), LAB = join(L, 'labels'), PL = join(L, 'planted', 'planted.json'), OP = join(L, 'opinions')
for (const p of [C, LAB, PL, OP]) if (!existsSync(p)) { console.error(`missing ${p}: transcription, labels and the planted set come first`); process.exit(3) }
if (existsSync(join(OUT, 'engine-legal.json'))) { console.error(`${OUT} already holds a run; the arm runs once (section 10)`); process.exit(1) }

const pins = await checkPinsNow(resolve(a['pins-root'] ?? TREE_ROOT))
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'pins-before.json'), JSON.stringify(pins, null, 1) + '\n')
if (!pins.ok) { console.error(`section 10: a pin differs from this tree, so nothing runs:\n  ${[...pins.stale, ...pins.unrecomputed].join('\n  ')}`); process.exit(1) }
const legalPin = pins.rows.find(r => /^legal rule/i.test(r.what))?.version.match(/legal@\d+\.\d+\.\d+/)?.[0]
if (!legalPin) { console.error('the pins table names no legal rule version'); process.exit(1) }
requireRecorded('legal', { transcription: C, labels: LAB, planted: PL }, { restart: !!a.restart })
ledgerAppend({ arm: 'legal', event: a.restart ? 'engine-restart' : 'engine-start', pins_sha256: sha256File(join(OUT, 'pins-before.json')), cli_sha256: sha256File(CLI), opinions_digest: digestOf(OP) })

const planted = readJson(PL)
const plantedInput = join(OUT, 'citations-planted.json')
writeFileSync(plantedInput, JSON.stringify(planted.map(p => ({ id: p.key, cite: p.cite, case_name: p.case_name, quote: p.quote, source_key: p.source_key })), null, 1) + '\n')
const files = [...readdirSync(C).filter(f => f.endsWith('.json')).sort().map(f => ({ file: join(C, f), brief: f.replace(/\.json$/, ''), kind: 'natural' })), { file: plantedInput, brief: null, kind: 'planted' }]

const rows = []
mkdirSync(join(OUT, 'verdicts'), { recursive: true })
for (const f of files) {
  const cites = readJson(f.file)
  let exit = 0, stdout = '', stderr = ''
  try { stdout = execFileSync(process.execPath, [CLI, 'citations', f.file, '--sources', OP, '--json'], { windowsHide: true, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (e) { exit = e.status ?? -1; stdout = String(e.stdout ?? ''); stderr = String(e.stderr ?? '') }
  if (![0, 1, 2, 3].includes(exit)) { console.error(`${f.brief ?? 'planted'}: exit ${exit} is a crash of the harness; the arm stops (section 10)\n${stderr}`); process.exit(1) }
  const name = f.brief ?? 'planted'
  writeFileSync(join(OUT, 'verdicts', `${name}.json`), stdout || '{}\n')
  let v = null
  try { v = JSON.parse(stdout) } catch { /* exit 3 prints no verdict */ }
  const rule = v?.ruleset ? `${v.ruleset.id}@${v.ruleset.version}` : null
  if (v && rule !== legalPin) { console.error(`${name}: the verdict names ${rule}; section 2 pins ${legalPin}. The arm stops before any answer is used.`); process.exit(1) }
  const byId = new Map((v?.claims ?? []).map(c => [String(c.claim_id).replace(/^cite\./, ''), c]))
  for (const q of cites) {
    const c = byId.get(String(q.id))
    const answer = exit === 3 || !c ? 'CANT_TELL' : c.outcome === 'PASS' ? 'PASS' : c.outcome === 'FAIL' ? 'FAIL' : 'CANT_TELL'
    rows.push({ id: String(q.id), kind: f.kind, brief_id: f.brief, exit, refused: exit === 3, answer, outcome: c?.outcome ?? null, reason: c?.insufficiency?.reason ?? null, rule, verdict_id: v?.verdict_id ?? null, missing_claim: !c && exit !== 3 })
  }
  console.error(`${name}: exit ${exit}, ${cites.length} quotation(s)`)
}
const h = writeNew(join(OUT, 'engine-legal.json'), { format: 'blind-shipping-1/legal-engine/1', cli: { path: 'dist/cli.js', sha256: sha256File(CLI) }, node: process.version, legal_rule: legalPin, rows })
ledgerAppend({ arm: 'legal', event: 'engine-end', kind: 'engine-output', sha256: h, rows: rows.length })
console.error(`done: ${rows.length} quotations; engine-legal.json sha256 ${h}`)
