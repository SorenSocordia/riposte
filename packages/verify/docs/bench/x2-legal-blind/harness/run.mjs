// X2 blind run: feed each manifest item (quoted string or proposition + cited opinion text) to verify's legal ruleset.
// Read-only use of products/verify (the built library, dist/). One citation per verdict, so each item has its own timing.
//
//   node harness/run.mjs [--manifest items/MANIFEST.json] [--out results/run-blind.json] [--reps 5]
//
// Records per item: outcome (PASS/FAIL/ABSTAIN), insufficiency reason, rule id, remedies (kinds + details), verdict_id,
// quote/source lengths, and wall time of verifyCitations (median of --reps runs, plus all runs). Writes a replay bundle per
// item under results/bundles/ so any verdict can be re-performed with `verify replay <bundle.json>`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REPO = resolve(ROOT, '../../..')
const VERIFY_DIST = join(REPO, 'products/verify/dist/index.js')

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt }
const manifestPath = resolve(ROOT, arg('--manifest', 'items/MANIFEST.json'))
const outPath = resolve(ROOT, arg('--out', 'results/run-blind.json'))
const reps = Number(arg('--reps', '5'))

const { verifyCitations } = await import(pathToFileURL(VERIFY_DIST).href)
const sha = (s) => createHash('sha256').update(s).digest('hex')
const answer = (o) => (o === 'INSUFFICIENT_DATA' ? 'ABSTAIN' : o)
const FIXED_NOW = () => new Date('2026-10-03T00:00:00.000Z') // issued_at pinned so bundles replay byte-identically

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
mkdirSync(join(dirname(outPath), 'bundles'), { recursive: true })
const rows = []
for (const it of manifest.items) {
  const sources = {}
  let sourceText = null
  if (it.source_file) {
    sourceText = readFileSync(join(ROOT, it.source_file), 'utf8')
    if (sha(sourceText) !== it.source_sha256) throw new Error(`${it.id}: source sha mismatch (${it.source_file})`)
    sources[it.source_key] = sourceText
  }
  const citation = { id: it.id, cite: it.cite, case_name: it.case_name, source_key: it.source_key }
  if (it.quote !== undefined && it.quote !== null) citation.quote = it.quote
  if (it.proposition !== undefined && it.proposition !== null) citation.proposition = it.proposition

  const times = []
  let v
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint()
    v = verifyCitations([citation], sources, { now: FIXED_NOW, producer: 'x2-legal-blind' })
    times.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const c = v.claims[0]
  const remedies = (v.remedies ?? []).map((m) => ({ kind: m.kind, ...(m.authority ? { authority: m.authority } : {}), detail: m.detail }))
  rows.push({
    id: it.id, set: it.set, subset: it.subset, expected: it.expected,
    outcome: answer(c.outcome), reason: c.insufficiency?.reason ?? null, rule_id: c.rule_id, claim_id: c.claim_id,
    locked: c.locked, explanation: c.explanation,
    opinion_says: c.computation?.operands?.opinion_says ?? null,
    evidence_span: c.evidence?.[0]?.locator?.kind === 'span' ? { start: c.evidence[0].locator.start, end: c.evidence[0].locator.end } : null,
    remedies, verdict_id: v.verdict_id,
    quote_chars: (it.quote ?? '').length, quote_words: (it.quote ?? '').trim().split(/\s+/).filter(Boolean).length,
    source_chars: sourceText ? sourceText.length : 0,
    ms_median: sorted[Math.floor(sorted.length / 2)], ms_runs: times.map((t) => Math.round(t * 1000) / 1000),
  })
  writeFileSync(join(dirname(outPath), 'bundles', `${it.id}.json`), JSON.stringify({ verdict: v, inputs: { citations: [citation], sources } }))
}
const out = {
  run: 'x2-legal-blind', engine_version: rows.length ? JSON.parse(readFileSync(join(dirname(outPath), 'bundles', `${rows[0].id}.json`), 'utf8')).verdict.engine_version : null,
  verify_dist_sha256: sha(readFileSync(VERIFY_DIST)), legal_dist_sha256: sha(readFileSync(join(REPO, 'products/verify/dist/legal/index.js'))),
  matcher_dist_sha256: sha(readFileSync(join(REPO, 'products/verify/dist/textmatch/matcher.js'))),
  manifest_sha256: sha(readFileSync(manifestPath)), reps, node: process.version, rows,
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
console.log(`wrote ${rows.length} rows -> ${outPath}`)
