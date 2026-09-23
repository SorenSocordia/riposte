/**
 * Run the verifier over the real CORD receipt corpus (data/real/A-invoices-receipts/cord-v2.rows.json, CC-BY-4.0) and
 * report coverage + robustness — the honest real-document counterpart to the synthetic Index. CORD is unlabelled, so this
 * measures COVERAGE (what fraction we can rule on) and where our rules still abstain/fail on real data, NOT FP/FN.
 *
 *   cmd //c "node_modules\.bin\tsx.cmd products\verify\scripts\cord-run.ts"
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, type Json } from '../src/index'
import { cordSampleToCases, type CordSampleFile } from '../src/bench/adapters/cord'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = JSON.parse(readFileSync(join(root, 'data', 'real', 'A-invoices-receipts', 'cord-v2.rows.json'), 'utf8')) as CordSampleFile
const cases = cordSampleToCases(file)
const NOW = () => new Date('2026-09-22T00:00:00Z')

type Tally = { PASS: number; FAIL: number; INSUFFICIENT_DATA: number }
const t = (): Tally => ({ PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 })
const overall = t(), sumInt = t(), totalInt = t()
let crashes = 0
const totalFails: { name: string; variance?: number; ex: Json }[] = []

for (const c of cases) {
  try {
    const v = verify(c.extraction, { now: NOW })
    overall[v.outcome]++
    const s = v.claims.find(x => x.claim_id === 'document.SUM_INT')
    if (s) sumInt[s.outcome]++
    const tot = v.claims.find(x => x.claim_id === 'document.TOTAL_INT')
    if (tot) {
      totalInt[tot.outcome]++
      if (tot.outcome === 'FAIL') totalFails.push({ name: c.name, variance: tot.variance, ex: c.extraction })
    }
  } catch (e) {
    crashes++
    console.error(`CRASH on ${c.name}: ${(e as Error).message}`)
  }
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)
const line = (label: string, x: Tally) => {
  const ruled = x.PASS + x.FAIL
  console.log(`${label.padEnd(12)} PASS ${String(x.PASS).padStart(3)}  FAIL ${String(x.FAIL).padStart(3)}  abstain ${String(x.INSUFFICIENT_DATA).padStart(3)}  | coverage ${pct(ruled, cases.length)}  pass-of-ruled ${pct(x.PASS, ruled)}`)
}

console.log(`\n=== CORD real-receipt run: ${cases.length} receipts, ${crashes} crashes ===`)
line('overall', overall)
line('SUM_INT', sumInt)
line('TOTAL_INT', totalInt)

if (totalFails.length) {
  console.log(`\n--- TOTAL_INT FAILs (${totalFails.length}) — gap candidates (tax-inclusive? extra charge? rounding?) ---`)
  for (const f of totalFails.slice(0, 8)) {
    const tt = (f.ex.totals ?? {}) as Json
    console.log(`  ${f.name}: variance ${f.variance}  totals=${JSON.stringify(tt)}`)
  }
}
