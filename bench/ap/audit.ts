/**
 * Reproducible audit: every PUBLISHED model decision on Distil Labs' AP benchmark, gated by the BLIND run-1 checker.
 *   npx tsx bench/ap/audit.ts
 * Inputs: results/run-1.jsonl (our frozen blind run; every row carries checker sha256 d1ad333f…) and Distil's own
 * benchmarking/results/decider/decider__*.jsonl (Apache-2.0; local copies in data/distil/results/). No model is called.
 * Gate: auto-execute only when the model's decision equals the checker's DECIDED answer; otherwise route to a human.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const run1 = new Map<string, { checker_sha256: string; got: { outcome: string; decision: string | null } }>()
for (const l of readFileSync(join(HERE, 'results', 'run-1.jsonl'), 'utf8').trim().split('\n')) { const r = JSON.parse(l); run1.set(r.id, r) }
const sha = [...run1.values()][0]!.checker_sha256
const dir = join(HERE, 'data', 'distil', 'results')

console.log(`checker (blind run 1) sha256 ${sha}\n`)
console.log('| configuration | correct | wrong | wrong approvals | caught | auto-executed | wrong auto-executions | to human |')
console.log('|---|---|---|---|---|---|---|---|')
let T = { wrong: 0, wrongApprove: 0, caught: 0, wrongAuto: 0 }
for (const f of readdirSync(dir).filter((x) => x.startsWith('decider__')).sort()) {
  const rows = readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  let ok = 0, wrong = 0, wrongApprove = 0, caught = 0, auto = 0, wrongAuto = 0, human = 0
  for (const r of rows) {
    const correct = r.prediction === r.gold
    if (correct) ok++; else { wrong++; if (r.prediction === 'approve') wrongApprove++ }
    const c = run1.get(r.id)
    const agree = c && c.got.outcome === 'DECIDED' && c.got.decision === r.prediction
    if (agree) { auto++; if (!correct) wrongAuto++ } else { human++; if (!correct) caught++ }
  }
  T = { wrong: T.wrong + wrong, wrongApprove: T.wrongApprove + wrongApprove, caught: T.caught + caught, wrongAuto: T.wrongAuto + wrongAuto }
  console.log(`| ${f.replace(/^decider__|\.jsonl$/g, '')} | ${ok} | ${wrong} | ${wrongApprove} | ${caught}/${wrong} | ${auto} | ${wrongAuto} | ${human} |`)
}
console.log(`\nTOTAL: ${T.wrong} wrong decisions (${T.wrongApprove} wrong approvals); caught ${T.caught}/${T.wrong}; wrong auto-executions ${T.wrongAuto}`)
