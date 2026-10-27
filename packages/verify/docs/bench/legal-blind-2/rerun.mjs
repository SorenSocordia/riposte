// legal-blind-2: rerun the set from this folder's shipped texts with the package's built engine, and compare every
// outcome with the shipped per-case results. It never writes into results/.
//
//   node packages/verify/docs/bench/legal-blind-2/rerun.mjs [halfA|tune|halfB|binding]   (default: all four steps)
//
// Build the package first (npm install && npm run build, from the repository root). The steps are the ones
// harness/run.ts ran, with the same fixed clock (2026-10-05T00:00:00Z), the same items (items/MANIFEST.json), the same
// source texts (sources/opinions/, checked against the manifest's sha256) and the unheaded texts for the binding step
// (sources/opinions-unheaded/). The engine is today's build, not the one the run used: the run's engine sources are
// listed by sha256 in PREREG.sha256 and differ from today's, so a difference here is a finding, not an error in this
// script. Exit 0 when every outcome is identical, 1 when any differs, 3 when the build or a file is missing.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = join(ROOT, '..', '..', '..', 'dist')
if (!existsSync(join(DIST, 'legal', 'index.js'))) {
  console.error(`rerun: the package is not built (no ${join('dist', 'legal', 'index.js')} beside docs/): run npm install && npm run build from the repository root`)
  process.exit(3)
}
const load = (p) => import(pathToFileURL(join(DIST, ...p.split('/'))).href)
const { verifyCitations, checkCitationUnderLimits, LEGAL_RULESET_VERSIONS } = await load('legal/index.js')
const { QUOTATION_LIMITS } = await load('legal/quotation.js')
const { ENGINE_VERSION } = await load('version.js')

const sha = (b) => createHash('sha256').update(b).digest('hex')
const NOW = () => new Date('2026-10-05T00:00:00Z')
const read = (p) => readFileSync(join(ROOT, ...p.split('/')))
const json = (p) => JSON.parse(read(p).toString('utf8'))
const manifest = json('items/MANIFEST.json')
const fetchLog = read('sources/fetch-log.jsonl').toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
const retrievedAt = (url) => fetchLog.find((r) => r.url === url && r.status === 200)?.fetched_utc

function sourcesFor(it, unheaded = false) {
  const buf = read(unheaded ? it.source.unheaded_file : it.source.file)
  if (!unheaded && sha(buf) !== it.source.sha256) throw new Error(`${it.id}: ${it.source.file} does not match the manifest's sha256`)
  const url = it.source.provenance.url
  const at = retrievedAt(url)
  return { [it.citation.source_key]: { text: buf.toString('utf8'), source: url ? 'Caselaw Access Project (static.case.law)' : 'on-disk Wikisource extract', ...(url ? { url } : {}), ...(at ? { retrieved_at: at } : {}) } }
}
const outOf = (c) => (c.outcome === 'INSUFFICIENT_DATA' ? 'ABSTAIN' : c.outcome)
function J(rows) {
  const C = rows.filter((r) => r.label === 'control'), B = rows.filter((r) => r.label === 'known-bad')
  const n = (xs, o) => xs.filter((r) => r.out === o).length
  return 10 * n(B, 'PASS') + 1 * n(C, 'FAIL') + 0.5 * n(C, 'ABSTAIN') + 0.25 * n(B, 'ABSTAIN')
}
function runRule(items, ruleset) {
  return items.map((it) => {
    const v = verifyCitations([it.citation], sourcesFor(it), { ruleset, now: NOW })
    const c = v.claims[0]
    return { id: it.id, label: it.label, out: outOf(c), explanation: c.explanation, verdict_id: v.verdict_id }
  })
}
const runLimits = (items, L) => items.map((it) => ({ id: it.id, label: it.label, out: outOf(checkCitationUnderLimits(it.citation, sourcesFor(it), L)) }))
const half = (h) => manifest.items.filter((i) => i.half === h)
const RULES = ['legal@0.0.1', 'legal@0.1.0', 'legal@0.2.0']

let differs = 0
const line = (s) => console.log(s)
function compare(label, mine, shipped, fields) {
  const byId = new Map(shipped.map((r) => [r.id, r]))
  const moved = []
  let sameId = 0, sameText = 0
  for (const r of mine) {
    const s = byId.get(r.id)
    if (!s) { moved.push(`${r.id}: not in the shipped results`); continue }
    const d = fields.filter((f) => r[f] !== s[f]).map((f) => `${f} ${s[f]} -> ${r[f]}`)
    if (d.length) moved.push(`${r.id}: ${d.join(', ')}`)
    if ('verdict_id' in r && r.verdict_id === s.verdict_id) sameId++
    if ('explanation' in r && r.explanation === s.explanation) sameText++
  }
  if (mine.length !== shipped.length) moved.push(`${shipped.length} shipped row(s), ${mine.length} rerun`)
  const extra = 'verdict_id' in (mine[0] ?? {}) ? `; verdict ids identical ${sameId} of ${mine.length}, explanations identical ${sameText} of ${mine.length}` : ''
  if (moved.length) { differs++; line(`${label}: DIFFERS in ${moved.length} case(s)${extra}`); for (const m of moved) line(`    ${m}`) }
  else line(`${label}: IDENTICAL (${mine.length} of ${mine.length} outcomes)${extra}`)
}

const steps = process.argv[2] ? [process.argv[2]] : ['halfA', 'tune', 'halfB', 'binding']
if (!steps.every((s) => ['halfA', 'tune', 'halfB', 'binding'].includes(s))) { console.error('usage: rerun.mjs [halfA|tune|halfB|binding]'); process.exit(3) }
line(`legal-blind-2 rerun: engine ${ENGINE_VERSION}, rule versions in this build ${LEGAL_RULESET_VERSIONS.map((r) => r.version).join(', ')}; ${manifest.items.length} items, texts checked against items/MANIFEST.json`)

for (const step of steps) {
  if (step === 'halfA' || step === 'halfB') {
    const shipped = json(`results/run-${step}.json`)
    const freeze = json('results/FREEZE.json')
    const rules = step === 'halfB' && freeze.distinct ? [...RULES, 'legal@0.3.0'] : RULES
    for (const rs of rules) compare(`${step} ${rs}`, runRule(half(step === 'halfA' ? 'A' : 'B'), rs), shipped.rules[rs].rows, ['label', 'out'])
  } else if (step === 'tune') {
    const tuning = json('results/tuning.json'), freeze = json('results/FREEZE.json')
    const items = half('A')
    const base = { ...QUOTATION_LIMITS }
    const sameBase = JSON.stringify(base) === JSON.stringify(tuning.base)
    const ref = runRule(items, 'legal@0.2.0').map((r) => r.out).join(',')
    const hook = runLimits(items, base).map((r) => r.out).join(',') === ref
    const phi = (Math.sqrt(5) - 1) / 2
    const cur = { ...base }
    const problems = []
    if (!sameBase) problems.push(`the build's quotation limits ${JSON.stringify(base)} are not the run's base ${JSON.stringify(tuning.base)}`)
    if (!hook) problems.push('the limits hook under the base limits does not give legal@0.2.0\'s half-A outcomes')
    const searches = [['ellipsisChars', 150, 2400, (x) => Math.round(x)], ['bracketChars', 15, 120, (x) => Math.round(x)], ['nearestSimilarity', 0.30, 0.80, (x) => Math.round(x * 100) / 100]]
    for (const [i, [key, lo0, hi0, round]] of searches.entries()) {
      const x0 = base[key]
      const seen = new Map()
      const ev = (x) => { const r = round(x); if (!seen.has(r)) seen.set(r, J(runLimits(items, { ...cur, [key]: r }))); return seen.get(r) }
      ev(x0)
      let lo = lo0, hi = hi0
      for (let k = 0; k < 8; k++) {
        const c = hi - phi * (hi - lo), d = lo + phi * (hi - lo)
        const fc = ev(c), fd = ev(d)
        if (fc < fd) hi = d
        else if (fc > fd) lo = c
        else if (Math.abs(round(c) - x0) <= Math.abs(round(d) - x0)) hi = d
        else lo = c
      }
      const pts = [...seen.entries()].sort((a, b) => a[1] - b[1] || Math.abs(a[0] - x0) - Math.abs(b[0] - x0) || a[0] - b[0])
      const chosen = pts[0][0]
      const s = tuning.searches[i]
      const evaluated = Object.fromEntries([...seen.entries()].sort((a, b) => a[0] - b[0]))
      if (JSON.stringify(evaluated) !== JSON.stringify(s.evaluated)) problems.push(`${key}: the evaluated objective values differ from tuning.json`)
      if (chosen !== s.chosen) problems.push(`${key}: chose ${chosen}, tuning.json chose ${s.chosen}`)
      cur[key] = chosen
    }
    const moved = Object.keys(base).filter((k) => cur[k] !== base[k])
    if (JSON.stringify(cur) !== JSON.stringify(freeze.limits)) problems.push(`the candidate ${JSON.stringify(cur)} is not FREEZE.json's ${JSON.stringify(freeze.limits)}`)
    if ((moved.length > 0) !== freeze.distinct) problems.push(`distinct ${moved.length > 0}, FREEZE.json says ${freeze.distinct}`)
    if (problems.length) { differs++; line(`tune: DIFFERS`); for (const p of problems) line(`    ${p}`) }
    else line(`tune: IDENTICAL (every objective value tuning.json records, the three chosen limits, and FREEZE.json's candidate: distinct ${freeze.distinct})`)
  } else if (step === 'binding') {
    const shipped = json('results/binding-unheaded.json')
    const rows = manifest.items.map((it) => {
      const v = verifyCitations([it.citation], sourcesFor(it, true), { ruleset: 'legal@0.2.0', now: NOW })
      const n = v.opinion_sources[0].names[0]
      return { id: it.id, bound: n.bound, cite_named: n.cite?.found ?? null, parties_named: (n.parties ?? []).every((p) => p.found !== null) }
    })
    compare('binding (unheaded texts, legal@0.2.0)', rows, shipped.rows, ['bound', 'cite_named', 'parties_named'])
  }
}
line(differs ? `rerun: ${differs} step(s) differ from the shipped results` : 'rerun: every outcome is identical to the shipped results')
process.exit(differs ? 1 : 0)
