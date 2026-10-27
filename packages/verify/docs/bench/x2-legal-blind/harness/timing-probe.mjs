// Pre-registered timing probe for P1's finding (the misquote search is superlinear on long inputs).
// Quotes built from the LONGEST manifest source text, deterministic, no outcomes involved:
//   near-verbatim: N consecutive words of the opinion with the middle word replaced by "zzqx" -> two long runs, the
//                  extension loop re-scans the whole source for every growing phrase (the expected worst case).
//   shuffled:      the same N words in a fixed pseudo-random order (every word present, runs short).
// N = 25, 50, 100, 200, 400, 800. Median of 3 runs each. Read-only use of products/verify/dist.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(ROOT, '../../..')
const { verifyCitations } = await import(pathToFileURL(join(REPO, 'products/verify/dist/index.js')).href)
const m = JSON.parse(readFileSync(join(ROOT, 'items/MANIFEST.json'), 'utf8'))
const withSrc = m.items.filter((i) => i.source_file)
const longest = withSrc.map((i) => ({ i, t: readFileSync(join(ROOT, i.source_file), 'utf8') })).sort((a, b) => b.t.length - a.t.length)[0]
const words = longest.t.split(/\s+/).filter(Boolean)
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const rows = []
for (const N of [25, 50, 100, 200, 400, 800]) {
  const start = Math.floor(words.length / 3)
  const span = words.slice(start, start + N)
  const near = [...span]; near[Math.floor(N / 2)] = 'zzqx'
  const shuf = [...span]; for (let k = shuf.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [shuf[k], shuf[j]] = [shuf[j], shuf[k]] }
  for (const [kind, q] of [['near-verbatim', near.join(' ')], ['shuffled', shuf.join(' ')]]) {
    const ts = []
    let out
    for (let r = 0; r < 3; r++) {
      const t0 = process.hrtime.bigint()
      out = verifyCitations([{ id: 'probe', cite: 'probe', quote: q }], { probe: longest.t }, { now: () => new Date(0) })
      ts.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    ts.sort((a, b) => a - b)
    rows.push({ N, kind, quote_chars: q.length, source_chars: longest.t.length, ms_median: Math.round(ts[1] * 100) / 100, outcome: out.claims[0].outcome })
    console.log(N, kind, Math.round(ts[1]), 'ms', out.claims[0].outcome)
  }
}
writeFileSync(join(ROOT, 'results/timing-probe.json'), JSON.stringify({ source_item: longest.i.id, source_file: longest.i.source_file, rows }, null, 1))
