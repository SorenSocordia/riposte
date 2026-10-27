// Scoring (PREREG §7, §8). Reads the per-item JSONL from run.mjs; writes the summary and the seeded audit samples.
//   node score.mjs --in results/run-blind.jsonl --prereg PREREG-final.frozen.md --out results/summary-blind.json --samples results/audit-sample.json
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { wilson, relativeRisk, mulberry32, sample } from './stats.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const input = arg('--in', 'results/run-blind.jsonl')
const preregPath = arg('--prereg', 'PREREG-final.frozen.md')
const preregHash = createHash('sha256').update(readFileSync(preregPath)).digest('hex')
const seed = parseInt(preregHash.slice(0, 8), 16) >>> 0

const S = { all: 0, notInvoiced: 0, inScope: 0, pass: 0, fail: 0, abstain: 0 }
const abstainWhy = {}
const byCat = {}
const checkFails = {}
const t2 = { a: 0, b: 0, c: 0, d: 0 } // a FAIL&held, b FAIL&clean, c PASS&held, d PASS&clean
const failList = [], passList = [], clearedDespiteFlag = []
const rl = createInterface({ input: createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line) continue
  const r = JSON.parse(line)
  S.all++
  const c = (byCat[r.cat] ??= { all: 0, notInvoiced: 0, inScope: 0, pass: 0, fail: 0, abstain: 0 })
  c.all++
  if (r.dec === 'NOT_INVOICED') { S.notInvoiced++; c.notInvoiced++; continue }
  S.inScope++; c.inScope++
  if (r.dec === 'ABSTAIN') { S.abstain++; c.abstain++; for (const w of r.why) abstainWhy[w] = (abstainWhy[w] ?? 0) + 1; continue }
  const held = r.log.held
  if (r.dec === 'FAIL') {
    S.fail++; c.fail++
    failList.push({ index: r.i, case: r.case, cat: r.cat })
    for (const [k, v] of Object.entries(r.chk)) if (v === 'FAIL') checkFails[k] = (checkFails[k] ?? 0) + 1
    if (held) t2.a++; else { t2.b++; clearedDespiteFlag.push(r.case) }
  } else {
    S.pass++; c.pass++
    passList.push({ index: r.i, case: r.case, cat: r.cat })
    if (held) t2.c++; else t2.d++
  }
}
const decided = S.pass + S.fail
const rr = relativeRisk(t2.a, t2.b, t2.c, t2.d)
const pct = (x, n) => (n ? x / n : null)
const summary = {
  input, input_sha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
  prereg: preregPath, prereg_sha256: preregHash, seed,
  counts: { ...S, decided },
  coverage_in_scope: pct(decided, S.inScope), coverage_all: pct(decided, S.all), abstain_rate_in_scope: pct(S.abstain, S.inScope),
  flag_rate_decided: pct(S.fail, decided),
  abstain_reasons: Object.fromEntries(Object.entries(abstainWhy).sort((x, y) => y[1] - x[1])),
  check_fail_counts: checkFails,
  by_category: Object.fromEntries(Object.entries(byCat).sort().map(([k, v]) => [k, { ...v, decided: v.pass + v.fail, coverage_in_scope: pct(v.pass + v.fail, v.inScope), flag_rate: pct(v.fail, v.pass + v.fail) }])),
  log_agreement: { ...t2, n: decided, agreement: pct(t2.a + t2.d, decided), p_held_given_fail: pct(t2.a, t2.a + t2.b), p_held_given_pass: pct(t2.c, t2.c + t2.d), rr },
  cleared_despite_flag: { count: clearedDespiteFlag.length, first_20: clearedDespiteFlag.slice(0, 20) },
}
const failSample = sample(failList, 200, mulberry32(seed))
const passSample = sample(passList, 50, mulberry32((seed + 1) >>> 0))
writeFileSync(arg('--out', 'results/summary.json'), JSON.stringify(summary, null, 2) + '\n')
if (arg('--samples')) writeFileSync(arg('--samples'), JSON.stringify({ seed, prereg_sha256: preregHash, fail: failSample, pass: passSample }, null, 2) + '\n')
if (arg('--cleared')) writeFileSync(arg('--cleared'), clearedDespiteFlag.join('\n') + '\n')
const audit = arg('--audit') // optional: audited labels → precision
if (audit) {
  const labels = JSON.parse(readFileSync(audit, 'utf8'))
  const fl = labels.fail ?? [], n = fl.length, x = fl.filter((l) => l.label === 'CONFIRMED').length
  const w = wilson(x, n)
  summary.audit = { n, confirmed: x, false: fl.filter((l) => l.label === 'FALSE').length, unclear: fl.filter((l) => l.label === 'UNCLEAR').length, precision: w.p, wilson95: [w.lo, w.hi], bar: 0.8, verdict: w.lo !== null && w.lo >= 0.8 ? 'PASS' : 'FAIL',
    miss_audit: { n: (labels.pass ?? []).length, misses: (labels.pass ?? []).filter((l) => l.label === 'MISSED').map((l) => l.case) } }
  writeFileSync(arg('--out', 'results/summary.json'), JSON.stringify(summary, null, 2) + '\n')
}
console.log(JSON.stringify({ counts: summary.counts, coverage_in_scope: summary.coverage_in_scope, abstain_rate_in_scope: summary.abstain_rate_in_scope, flag_rate_decided: summary.flag_rate_decided, rr: summary.log_agreement.rr, audit: summary.audit }, null, 1))
