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

// ── what "caught" is made of, the intervals, the confidence count, and who labelled ─────────────────────────────────────
// Wilson score interval, two-sided 95% (z = 1.959964), the same method the bench tables use.
const wilson = (k: number, n: number): string => {
  if (n === 0) return 'n/a'
  const z = 1.959964, z2 = z * z, c = (k + z2 / 2) / (n + z2), h = (z * Math.sqrt((k * (n - k)) / n + z2 / 4)) / (n + z2)
  return `${(100 * Math.max(0, c - h)).toFixed(1)}% to ${(100 * Math.min(1, c + h)).toFixed(1)}%`
}
let byDisagreement = 0, byAbstention = 0, autoTotal = 0, wrongAutoTotal = 0
const run1Decided = [...run1.values()].filter((r) => r.got.outcome === 'DECIDED').length
const confidence: { t: number; wrong: number; wrongConf: number; wrongApprove: number; wrongApproveConf: number; wrongApproveP: number }[] = []
for (const f of readdirSync(dir).filter((x) => x.startsWith('decider__')).sort()) {
  const rows = readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const r of rows) {
    const c = run1.get(r.id)
    const decidedByChecker = c !== undefined && c.got.outcome === 'DECIDED'
    if (decidedByChecker && c.got.decision === r.prediction) { autoTotal++; if (r.prediction !== r.gold) wrongAutoTotal++ }
    if (r.prediction === r.gold) continue
    if (decidedByChecker) byDisagreement++; else byAbstention++
  }
  if (f === 'decider__jev-single.jsonl') for (const t of [0.9, 0.99]) {
    const wrong = rows.filter((r) => r.prediction !== r.gold)
    const wa = wrong.filter((r) => r.prediction === 'approve')
    const conf = (r: { answers?: { decision?: { confidence?: number } } }): number => r.answers?.decision?.confidence ?? -1
    const pApprove = (r: { answers?: { decision?: { probabilities?: { approve?: number } } } }): number => r.answers?.decision?.probabilities?.approve ?? -1
    confidence.push({ t, wrong: wrong.length, wrongConf: wrong.filter((r) => conf(r) >= t).length, wrongApprove: wa.length, wrongApproveConf: wa.filter((r) => conf(r) >= t).length, wrongApproveP: wa.filter((r) => pApprove(r) >= t).length })
  }
}
console.log(`\nWHAT "CAUGHT" IS MADE OF (${T.caught} wrong decisions routed to a person):`)
console.log(`  ${byDisagreement} because the checker decided and disagreed with the model`)
console.log(`  ${byAbstention} only because the checker abstained on that invoice (it would have gone to a person whatever the model said)`)
console.log(`  The "0 wrong auto-executions" row is not separate evidence: the checker made 0 wrong decisions in run 1, so agreeing with it`)
console.log(`  can only auto-execute a right one. It restates run 1's result, applied to each published configuration.`)
console.log(`\nWILSON 95% INTERVALS:`)
console.log(`  run 1 wrong among decided: 0 of ${run1Decided} (${wilson(0, run1Decided)})`)
console.log(`  run 1 coverage: ${run1Decided} of ${run1.size} decided (${wilson(run1Decided, run1.size)})`)
console.log(`  wrong decisions caught: ${T.caught} of ${T.wrong} (${wilson(T.caught, T.wrong)}); by disagreement ${byDisagreement} of ${T.wrong} (${wilson(byDisagreement, T.wrong)})`)
console.log(`  wrong auto-executions: ${wrongAutoTotal} of ${autoTotal} auto-executed (${wilson(wrongAutoTotal, autoTotal)}); the seven configurations share the same 100 invoices, so these are not independent trials`)
console.log(`\nCONFIDENCE (Jev, single question: the only published configuration whose rows carry a stated confidence; jev-checks and`)
console.log(`jev-lines carry per-check probabilities, the other four none). Definitions: "confidence" = answers.decision.confidence;`)
console.log(`"p(approve)" = answers.decision.probabilities.approve; wrong = prediction differs from gold.`)
for (const c of confidence) console.log(`  at >= ${c.t.toFixed(2)}: ${c.wrongConf} of ${c.wrong} wrong decisions by confidence; of the ${c.wrongApprove} wrong approvals, ${c.wrongApproveConf} by confidence and ${c.wrongApproveP} by p(approve)`)
console.log(`\nLABELS: right and wrong are the benchmark's own gold decisions as Distil Labs published them. Nobody here labelled a case.`)
