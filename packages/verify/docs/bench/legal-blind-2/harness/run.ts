// H11 / legal-blind-2: the engine runs, exactly as PREREG.md section 6 says.
//   halfA  : legal@0.0.1, 0.1.0, 0.2.0 on half A                         -> results/run-halfA.json
//   tune   : golden-section search of three limits on half A only        -> results/tuning.json, results/FREEZE.json
//   halfB  : one invocation, every rule (and the frozen candidate)       -> results/run-halfB.json
//   binding: descriptive, after half B: binding on the unheaded sources  -> results/binding-unheaded.json
// Run from the verify package folder with tsx: run.ts <step>. [This line is edited for this tree: it named the authors' private folder.]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCitations, checkCitationUnderLimits, LEGAL_RULESET_VERSIONS, type Citation, type OpinionSources } from '../../../../products/verify/src/legal/index'
import { QUOTATION_LIMITS, type QuotationLimits } from '../../../../products/verify/src/legal/quotation'
import { ENGINE_VERSION } from '../../../../products/verify/src/version'
import type { ClaimVerdict } from '../../../../products/verify/src/verdict/schema'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERIFY = join(ROOT, '..', '..', '..', 'products', 'verify')
const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex')
const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
type Item = { id: string; k: number; half: 'A' | 'B'; label: 'control' | 'known-bad'; operator: string | null; citation: Citation; source: { file: string; sha256: string; unheaded_file: string; provenance: { url?: string } } }
const manifest = JSON.parse(readFileSync(join(ROOT, 'items', 'MANIFEST.json'), 'utf8')) as { items: Item[] }
const fetchLog = readFileSync(join(ROOT, 'sources', 'fetch-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { url: string; fetched_utc: string; status: number })
const retrievedAt = (url?: string): string | undefined => fetchLog.find(r => r.url === url && r.status === 200)?.fetched_utc

function sourcesFor(it: Item, unheaded = false): OpinionSources {
  const text = readFileSync(join(ROOT, unheaded ? it.source.unheaded_file : it.source.file), 'utf8')
  if (!unheaded && sha(Buffer.from(text, 'utf8')) !== it.source.sha256) throw new Error(`${it.id}: source text does not match the manifest's sha256`)
  const url = it.source.provenance.url
  const at = retrievedAt(url)
  return { [it.citation.source_key!]: { text, source: url ? 'Caselaw Access Project (static.case.law)' : 'on-disk Wikisource extract', ...(url ? { url } : {}), ...(at ? { retrieved_at: at } : {}) } }
}

type Out = 'PASS' | 'FAIL' | 'ABSTAIN'
const outOf = (c: ClaimVerdict): Out => (c.outcome === 'INSUFFICIENT_DATA' ? 'ABSTAIN' : c.outcome)

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const z = 1.96, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}
const rate = (k: number, n: number) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? k / n : 0, ci95: [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000] } }

function score(rows: { label: string; out: Out }[]) {
  const C = rows.filter(r => r.label === 'control'), B = rows.filter(r => r.label === 'known-bad')
  const n = (xs: typeof rows, o: Out) => xs.filter(r => r.out === o).length
  const J = 10 * n(B, 'PASS') + 1 * n(C, 'FAIL') + 0.5 * n(C, 'ABSTAIN') + 0.25 * n(B, 'ABSTAIN')
  return {
    known_bad_false_pass: rate(n(B, 'PASS'), B.length), known_bad_fail: rate(n(B, 'FAIL'), B.length), known_bad_abstain: rate(n(B, 'ABSTAIN'), B.length),
    control_false_fail: rate(n(C, 'FAIL'), C.length), control_pass: rate(n(C, 'PASS'), C.length), control_abstain: rate(n(C, 'ABSTAIN'), C.length),
    J,
  }
}

function runRule(items: Item[], ruleset: string) {
  return items.map(it => {
    const v = verifyCitations([it.citation], sourcesFor(it), { ruleset, now: NOW })
    const c = v.claims[0]!
    return { id: it.id, half: it.half, label: it.label, operator: it.operator, out: outOf(c), reason: c.insufficiency?.reason ?? null, explanation: c.explanation, verdict_id: v.verdict_id }
  })
}
function runLimits(items: Item[], L: QuotationLimits) {
  return items.map(it => ({ id: it.id, label: it.label, out: outOf(checkCitationUnderLimits(it.citation, sourcesFor(it), L)) }))
}

const tree = () => Object.fromEntries(['src/legal/index.ts', 'src/legal/quotation.ts', 'src/legal/binding.ts', 'src/version.ts'].map(f => [f, sha(readFileSync(join(VERIFY, f)))]))
const write = (name: string, x: unknown) => { mkdirSync(join(ROOT, 'results'), { recursive: true }); writeFileSync(join(ROOT, 'results', name), JSON.stringify(x, null, 2) + '\n'); console.log(`wrote results/${name}`) }
const half = (h: 'A' | 'B') => manifest.items.filter(i => i.half === h)
const RULES = ['legal@0.0.1', 'legal@0.1.0', 'legal@0.2.0']
const step = process.argv[2]

if (step === 'halfA') {
  if (existsSync(join(ROOT, 'results', 'run-halfB.json'))) throw new Error('half B has run; half A is not re-run')
  const items = half('A')
  const out: Record<string, unknown> = { step: 'halfA', run_utc: new Date().toISOString(), engine: ENGINE_VERSION, tree: tree(), rules: {} }
  for (const rs of RULES) { const rows = runRule(items, rs); (out.rules as Record<string, unknown>)[rs] = { score: score(rows), rows } }
  write('run-halfA.json', out)
  for (const rs of RULES) { const s = (out.rules as Record<string, { score: ReturnType<typeof score> }>)[rs]!.score; console.log(`${rs}: known-bad PASS ${s.known_bad_false_pass.k}/${s.known_bad_false_pass.n}; control FAIL ${s.control_false_fail.k}/${s.control_false_fail.n}, PASS ${s.control_pass.k}, ABSTAIN ${s.control_abstain.k}; J ${s.J}`) }
} else if (step === 'tune') {
  if (!existsSync(join(ROOT, 'results', 'run-halfA.json'))) throw new Error('run half A first')
  if (existsSync(join(ROOT, 'results', 'FREEZE.json'))) throw new Error('already frozen')
  const items = half('A')
  const base: QuotationLimits = { ...QUOTATION_LIMITS }
  const J = (L: QuotationLimits) => score(runLimits(items, L)).J
  // sanity: the hook under 0.2.0's limits gives 0.2.0's half-A outcomes
  const ref = runRule(items, 'legal@0.2.0').map(r => r.out).join(',')
  if (runLimits(items, base).map(r => r.out).join(',') !== ref) throw new Error('the tuning hook does not reproduce legal@0.2.0 on half A')
  const phi = (Math.sqrt(5) - 1) / 2
  const searches: unknown[] = []
  const cur: QuotationLimits = { ...base }
  for (const [key, lo0, hi0, round] of [
    ['ellipsisChars', 150, 2400, (x: number) => Math.round(x)],
    ['bracketChars', 15, 120, (x: number) => Math.round(x)],
    ['nearestSimilarity', 0.30, 0.80, (x: number) => Math.round(x * 100) / 100],
  ] as [keyof QuotationLimits, number, number, (x: number) => number][]) {
    const x0 = base[key]
    const seen = new Map<number, number>()
    const ev = (x: number): number => { const r = round(x); if (!seen.has(r)) seen.set(r, J({ ...cur, [key]: r })); return seen.get(r)! }
    ev(x0)
    let lo = lo0, hi = hi0
    const path: unknown[] = []
    for (let i = 0; i < 8; i++) {
      const c = hi - phi * (hi - lo), d = lo + phi * (hi - lo)
      const fc = ev(c), fd = ev(d)
      path.push({ lo, hi, c: round(c), d: round(d), Jc: fc, Jd: fd })
      if (fc < fd) hi = d
      else if (fc > fd) lo = c
      else if (Math.abs(round(c) - x0) <= Math.abs(round(d) - x0)) hi = d // a tie: toward the 0.2.0 value
      else lo = c
    }
    const pts = [...seen.entries()].sort((a, b) => a[1] - b[1] || Math.abs(a[0] - x0) - Math.abs(b[0] - x0) || a[0] - b[0])
    const chosen = pts[0]![0]
    searches.push({ key, range: [lo0, hi0], start: x0, J_at_start: seen.get(round(x0)), path, evaluated: Object.fromEntries([...seen.entries()].sort((a, b) => a[0] - b[0])), chosen, J_at_chosen: seen.get(chosen) })
    cur[key] = chosen
    console.log(`${key}: ${x0} -> ${chosen} (J ${seen.get(round(x0))} -> ${seen.get(chosen)})`)
  }
  const moved = (Object.keys(base) as (keyof QuotationLimits)[]).filter(k => cur[k] !== base[k])
  write('tuning.json', { step: 'tune', run_utc: new Date().toISOString(), engine: ENGINE_VERSION, tree: tree(), half: 'A', objective: 'J = 10*knownbad_PASS + 1*control_FAIL + 0.5*control_ABSTAIN + 0.25*knownbad_ABSTAIN', base, searches, candidate: cur, moved, J_base: J(base), J_candidate: J(cur) })
  const freeze = { frozen_utc: new Date().toISOString(), distinct: moved.length > 0, limits: cur, moved }
  write('FREEZE.json', { ...freeze, sha256: sha(JSON.stringify(freeze)) })
} else if (step === 'halfB') {
  if (!existsSync(join(ROOT, 'results', 'FREEZE.json'))) throw new Error('freeze the candidate first')
  if (existsSync(join(ROOT, 'results', 'run-halfB.json'))) throw new Error('half B has already run: it runs once')
  const freeze = JSON.parse(readFileSync(join(ROOT, 'results', 'FREEZE.json'), 'utf8')) as { distinct: boolean; limits: QuotationLimits }
  const items = half('B')
  const rules = [...RULES, ...(freeze.distinct ? ['legal@0.3.0'] : [])]
  if (freeze.distinct && !LEGAL_RULESET_VERSIONS.some(r => r.version === '0.3.0')) throw new Error('the frozen candidate is distinct but legal@0.3.0 is not in this build')
  const out: Record<string, unknown> = { step: 'halfB', run_utc: new Date().toISOString(), engine: ENGINE_VERSION, tree: tree(), freeze, rules: {} }
  for (const rs of rules) { const rows = runRule(items, rs); (out.rules as Record<string, unknown>)[rs] = { score: score(rows), rows } }
  if (!freeze.distinct) out.candidate = 'none: no limit moved on half A, so there is no distinct legal@0.3.0 candidate (PREREG section 6)'
  write('run-halfB.json', out)
  for (const rs of rules) { const s = (out.rules as Record<string, { score: ReturnType<typeof score> }>)[rs]!.score; console.log(`${rs}: known-bad PASS ${s.known_bad_false_pass.k}/${s.known_bad_false_pass.n}; control FAIL ${s.control_false_fail.k}/${s.control_false_fail.n}, PASS ${s.control_pass.k}, ABSTAIN ${s.control_abstain.k}; J ${s.J}`) }
} else if (step === 'binding') {
  if (!existsSync(join(ROOT, 'results', 'run-halfB.json'))) throw new Error('descriptive binding runs after half B')
  const rows = manifest.items.map(it => {
    const v = verifyCitations([it.citation], sourcesFor(it, true), { ruleset: 'legal@0.2.0', now: NOW })
    const n = (v as unknown as { opinion_sources: { names: { bound: boolean; cite?: { found: boolean }; parties?: { found: string | null }[] }[] }[] }).opinion_sources[0]!.names[0]!
    return { id: it.id, bound: n.bound, cite_named: n.cite?.found ?? null, parties_named: (n.parties ?? []).every(p => p.found !== null) }
  })
  write('binding-unheaded.json', { step: 'binding', run_utc: new Date().toISOString(), engine: ENGINE_VERSION, bound: rows.filter(r => r.bound).length, cite_named: rows.filter(r => r.cite_named).length, parties_named: rows.filter(r => r.parties_named).length, n: rows.length, rows })
} else {
  console.error('usage: run.ts halfA | tune | halfB | binding')
  process.exit(3)
}
