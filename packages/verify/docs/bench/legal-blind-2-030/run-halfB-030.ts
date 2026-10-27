// legal-blind-2, post-hoc: legal@0.3.0 on half B (2026-10-05). See ADDENDUM-legal-0.3.0.md beside this file. [Edited for this tree: an internal work label removed.]
// Scoring copied unchanged from ../harness/run.ts (PREREG section 6). Writes posthoc/run-halfB-legal-0.3.0.json; refuses to
// overwrite it, and never touches ../results/.
// Run from the verify package folder with tsx: run-halfB-030.ts. [This line is edited for this tree: it named the authors' private folder.]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCitations, type Citation, type OpinionSources } from '../../../../products/verify/src/legal/index'
import { ENGINE_VERSION } from '../../../../products/verify/src/version'
import type { ClaimVerdict } from '../../../../products/verify/src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const VERIFY = join(ROOT, '..', '..', '..', 'products', 'verify')
const OUT = join(HERE, 'run-halfB-legal-0.3.0.json')
if (existsSync(OUT)) throw new Error('already run: this post-hoc run is made once')
const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex')
const NOW = (): Date => new Date('2026-10-05T00:00:00Z')
type Item = { id: string; k: number; half: 'A' | 'B'; label: 'control' | 'known-bad'; operator: string | null; citation: Citation; source: { file: string; sha256: string; provenance: { url?: string } } }
const manifest = JSON.parse(readFileSync(join(ROOT, 'items', 'MANIFEST.json'), 'utf8')) as { items: Item[] }
const fetchLog = readFileSync(join(ROOT, 'sources', 'fetch-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { url: string; fetched_utc: string; status: number })
const retrievedAt = (url?: string): string | undefined => fetchLog.find(r => r.url === url && r.status === 200)?.fetched_utc

// as ../harness/run.ts sourcesFor (headed texts, sha256 checked against the manifest)
function sourcesFor(it: Item): OpinionSources {
  const text = readFileSync(join(ROOT, it.source.file), 'utf8')
  if (sha(Buffer.from(text, 'utf8')) !== it.source.sha256) throw new Error(`${it.id}: source text does not match the manifest's sha256`)
  const url = it.source.provenance.url
  const at = retrievedAt(url)
  return { [it.citation.source_key!]: { text, source: url ? 'Caselaw Access Project (static.case.law)' : 'on-disk Wikisource extract', ...(url ? { url } : {}), ...(at ? { retrieved_at: at } : {}) } }
}

// ── copied unchanged from ../harness/run.ts ──
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
// ── end of the copy ──

const tree = Object.fromEntries(['src/legal/index.ts', 'src/legal/quotation.ts', 'src/legal/binding.ts', 'src/version.ts'].map(f => [f, sha(readFileSync(join(VERIFY, f)))]))
const items = manifest.items.filter(i => i.half === 'B')
const rows = runRule(items, 'legal@0.3.0')
const s = score(rows)
// beside it, for comparison only: the shipped half-B rows (results/run-halfB.json), never re-run
const shipped = JSON.parse(readFileSync(join(ROOT, 'results', 'run-halfB.json'), 'utf8')) as { rules: Record<string, { score: ReturnType<typeof score>; rows: { id: string; out: Out }[] }> }
const differs020 = rows.filter(r => shipped.rules['legal@0.2.0']!.rows.find(x => x.id === r.id)!.out !== r.out).map(r => r.id)
const out = {
  step: 'post-hoc: legal@0.3.0 on half B (not the PREREG section 6 candidate; see ADDENDUM-legal-0.3.0.md)',
  label: 'post-hoc', run_utc: new Date().toISOString(), engine: ENGINE_VERSION, tree,
  addendum_sha256: sha(readFileSync(join(HERE, 'ADDENDUM-legal-0.3.0.md'))), script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  manifest_sha256: sha(readFileSync(join(ROOT, 'items', 'MANIFEST.json'))),
  rules: { 'legal@0.3.0': { score: s, rows } },
  compared_with_shipped_legal_0_2_0: { outcomes_that_differ: differs020, shipped_score: shipped.rules['legal@0.2.0']!.score },
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`legal@0.3.0 half B: known-bad PASS ${s.known_bad_false_pass.k}/${s.known_bad_false_pass.n} ${JSON.stringify(s.known_bad_false_pass.ci95)}; control FAIL ${s.control_false_fail.k}/${s.control_false_fail.n} ${JSON.stringify(s.control_false_fail.ci95)}, PASS ${s.control_pass.k} ${JSON.stringify(s.control_pass.ci95)}, ABSTAIN ${s.control_abstain.k}; known-bad FAIL ${s.known_bad_fail.k} / ABSTAIN ${s.known_bad_abstain.k}; J ${s.J}`)
console.log(`outcomes that differ from the shipped legal@0.2.0 half-B rows: ${differs020.length ? differs020.join(', ') : 'none'}`)
console.log(`wrote ${OUT}`)
