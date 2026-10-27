#!/usr/bin/env node
// Re-tally the second legal blind set from its per-case results, with no engine and no dependency.
//   node score.mjs            (run from this folder)
// For each half and each rule it counts PASS, FAIL and ABSTAIN by label from the per-case rows, checks every count and the
// loss J against the score block the run wrote beside its rows, checks every row against the item manifest (id, half,
// label, operator), checks the frozen limits' sha256, and prints the counts with Wilson 95% intervals. Exit 0 when every
// check holds, 1 when one fails. The bench table's rows are counted from the same files by `verify bench emit`.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => JSON.parse(readFileSync(join(HERE, p), 'utf8'))
const manifest = read('items/MANIFEST.json')
const halves = { A: read('results/run-halfA.json'), B: read('results/run-halfB.json') }
const freeze = read('results/FREEZE.json')
const binding = read('results/binding-unheaded.json')
const problems = []

function wilson(k, n) {
  if (n === 0) return [0, 1]
  const z = 1.959963984540054, p = k / n, d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}
const pct = (x) => `${(x * 100).toFixed(1)}%`
const show = (k, n) => { const [lo, hi] = wilson(k, n); return `${k}/${n} (${pct(lo)} to ${pct(hi)})` }

// the manifest: 40 items, 20 per half, controls on odd k, known-bads on even k
const byId = new Map(manifest.items.map((it) => [it.id, it]))
if (manifest.items.length !== 40) problems.push(`the manifest holds ${manifest.items.length} items, not 40`)

const count = (rows, label, out) => rows.filter((r) => r.label === label && r.out === out).length
const totals = {}
for (const [h, run] of Object.entries(halves)) {
  if (run.engine !== '0.6.0') problems.push(`half ${h} ran engine ${run.engine}, not 0.6.0`)
  for (const [rule, { score, rows }] of Object.entries(run.rules)) {
    for (const r of rows) {
      const it = byId.get(r.id)
      if (!it) { problems.push(`half ${h} ${rule}: ${r.id} is not in the manifest`); continue }
      if (it.half !== h || it.label !== r.label || (it.operator ?? null) !== (r.operator ?? null)) problems.push(`half ${h} ${rule}: ${r.id} disagrees with the manifest (half, label or operator)`)
    }
    if (rows.length !== 20) problems.push(`half ${h} ${rule}: ${rows.length} rows, not 20`)
    const c = {
      known_bad_false_pass: count(rows, 'known-bad', 'PASS'), known_bad_fail: count(rows, 'known-bad', 'FAIL'), known_bad_abstain: count(rows, 'known-bad', 'ABSTAIN'),
      control_false_fail: count(rows, 'control', 'FAIL'), control_pass: count(rows, 'control', 'PASS'), control_abstain: count(rows, 'control', 'ABSTAIN'),
    }
    for (const [k, v] of Object.entries(c)) if (score[k].k !== v || score[k].n !== 10) problems.push(`half ${h} ${rule}: ${k} recounts to ${v}/10, the run wrote ${score[k].k}/${score[k].n}`)
    const J = 10 * c.known_bad_false_pass + c.control_false_fail + 0.5 * c.control_abstain + 0.25 * c.known_bad_abstain
    if (J !== score.J) problems.push(`half ${h} ${rule}: J recounts to ${J}, the run wrote ${score.J}`)
    const t = (totals[rule] ??= { known_bad_false_pass: 0, control_false_fail: 0, control_pass: 0, control_abstain: 0 })
    for (const k of Object.keys(t)) t[k] += c[k]
    console.log(`half ${h}  ${rule}  known-bad PASS ${show(c.known_bad_false_pass, 10)} · control FAIL ${show(c.control_false_fail, 10)} · control PASS ${show(c.control_pass, 10)} · control ABSTAIN ${c.control_abstain}/10 · known-bad FAIL ${c.known_bad_fail} ABSTAIN ${c.known_bad_abstain} · J ${J}`)
  }
}
for (const [rule, t] of Object.entries(totals)) console.log(`both halves  ${rule}  known-bad PASS ${show(t.known_bad_false_pass, 20)} · control FAIL ${show(t.control_false_fail, 20)} · control PASS ${show(t.control_pass, 20)} · control ABSTAIN ${t.control_abstain}/20`)

// the freeze: its sha256 is of the record without the sha256 field, as the harness wrote it
const { sha256: frozenSha, ...frozen } = freeze
if (createHash('sha256').update(JSON.stringify(frozen)).digest('hex') !== frozenSha) problems.push('results/FREEZE.json: its sha256 does not match its record')
if (freeze.distinct !== false || freeze.moved.length) problems.push('results/FREEZE.json: a limit moved; the table reads no candidate')
console.log(`freeze: distinct ${freeze.distinct}, moved [${freeze.moved.join(', ')}], sha256 ${frozenSha.slice(0, 12)}… ${problems.some((p) => p.startsWith('results/FREEZE')) ? 'FAILS' : 'holds'}`)
console.log(`binding without the header line (legal@0.2.0): ${binding.rows.filter((r) => r.bound).length} of ${binding.rows.length} bound; ${binding.rows.filter((r) => r.parties_named).length} name their parties`)

if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); process.exit(1) }
console.log('every count recomputes from the per-case rows, and every row agrees with the manifest')
