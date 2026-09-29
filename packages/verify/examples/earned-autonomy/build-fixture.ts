/**
 * Builds the demo's data fixture from the CREDENCE-2 benchmark (2026-09-28: 96 fresh 2025q2 10-K filings, pre-registered,
 * audited by an independent reader). Run once by the maintainer; the demo itself never reads the benchmark.
 *
 *   cmd //c "node_modules\.bin\tsx.cmd examples\earned-autonomy\build-fixture.ts --bench <credence2-bench dir>"
 *
 * What goes into data/fixture.json.gz, and why each part is honest:
 *   - the 26 filings of the benchmark's audit sample (drawn by the benchmark in sha256 order, before any label was read) plus
 *     the next filing in the same order (the reserve's first), whose items are December traffic and are never reviewed;
 *   - per filing, the PARSED iXBRL twin (every fact whose context is not dimensional, and every fact of a mapped concept) and
 *     the parsed presentation linkbase, both keeping the real filing's sha256. The builder proves the reduction changes
 *     nothing: every item's verdict from the reduced twin is byte-identical (replayView) to the verdict from the full filing;
 *   - per item (the six promoted cells only), the agent's extracted value, the benchmark's twin v0.2 outcome (checked equal),
 *     and the gold label (the independent reader's adjudicated reading of the printed statement);
 *   - ONE whole filing (the smallest in the sample) as text, so replay can re-perform from the real bytes offline.
 * Nothing here is synthetic. The demo's synthetic elements are made in demo.ts, and each is labelled there.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseInlineXbrl, parseTwinPresentation, verifyAgainstTwin, twinFieldConcepts, replayView, canonicalize,
  FS_CORE_TWIN_MAP_V02, type InlineXbrl, type TwinPresentationInput,
} from '../../src/index.js'
import { encodeTwin, decodeTwin, type FixtureFiling, type Fixture } from './fixture.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const BENCH = arg('--bench')
if (!BENCH) { console.error('usage: build-fixture.ts --bench <credence2-bench dir> [--out <file>]'); process.exit(2) }
const OUT = arg('--out') ?? join(HERE, 'data', 'fixture.json.gz')

const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex')
const jl = (p: string): Record<string, any>[] => readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
const iso = (p: string): string => `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}`
const FIXED = (): Date => new Date('2026-09-28T00:00:00Z')
const MAP = FS_CORE_TWIN_MAP_V02

const files = ['manifest.jsonl', 'judgments.jsonl', 'gold.jsonl', 'audit-sample.json', 'fields.jsonl']
const provenance = Object.fromEntries(files.map(f => [f, sha(readFileSync(join(BENCH, f)))]))
const manifest = jl(join(BENCH, 'manifest.jsonl'))
const judgments = jl(join(BENCH, 'judgments.jsonl'))
const gold = new Map(jl(join(BENCH, 'gold.jsonl')).map(r => [`${r.adsh}|${r.field}`, r]))
const fieldsRows = jl(join(BENCH, 'fields.jsonl'))
const audit = JSON.parse(readFileSync(join(BENCH, 'audit-sample.json'), 'utf8')) as { sample: string[]; reserve: string[]; promoted_cells: string[] }
const PROMOTED = new Set(audit.promoted_cells)
const MAPPED = new Set(MAP.fields.flatMap(f => twinFieldConcepts(MAP, f)))

function presentationInput(adsh: string, m: Record<string, any>): TwinPresentationInput {
  const input: TwinPresentationInput = {}
  for (const [name, h] of Object.entries(m.package.files as Record<string, string>)) {
    const b = readFileSync(join(BENCH!, 'packages', adsh, name))
    if (sha(b) !== h) throw new Error(`${adsh}: package file ${name} does not hash as the manifest says`)
    const text = b.toString('utf8')
    if (name === 'FilingSummary.xml') input.filingSummary = text
    else if (/_pre\.xml$/i.test(name)) input.pre = text
    else if (/\.xsd$/i.test(name)) input.schema = text
  }
  return input
}

/** The reduction: keep every fact in a non-dimensional context, and every fact of a concept the map binds. */
function reduce(tw: InlineXbrl): InlineXbrl {
  const facts = tw.facts.filter(f => !tw.contexts.get(f.contextRef)?.dimensional || MAPPED.has(f.concept))
  const ctx = new Set(facts.map(f => f.contextRef)), units = new Set(facts.map(f => f.unitRef))
  return {
    sha256: tw.sha256, stats: tw.stats, facts,
    contexts: new Map([...tw.contexts].filter(([k]) => ctx.has(k))),
    units: new Map([...tw.units].filter(([k]) => units.has(k))),
  }
}

const order = [...audit.sample, audit.reserve[0]!]
const out: FixtureFiling[] = []
let checked = 0, full: Fixture['full'] = undefined
for (const [i, adsh] of order.entries()) {
  const m = manifest.find(x => x.adsh === adsh)!
  const html = readFileSync(join(BENCH, 'raw', adsh, m.doc_name), 'utf8')
  if (sha(html) !== m.doc_html_sha256) throw new Error(`${adsh}: the cached filing does not hash as the manifest says`)
  const tw = parseInlineXbrl(html)
  const pin = presentationInput(adsh, m)
  const pres = parseTwinPresentation(pin)
  if (!pres || pres.sha256 !== m.package.presentation.sha256) throw new Error(`${adsh}: the presentation does not re-read to the manifest's sha256`)
  const reduced = decodeTwin(JSON.parse(JSON.stringify(encodeTwin(reduce(tw)))))
  const periodEnd = iso(m.period)
  const rows = judgments.filter(j => j.adsh === adsh && PROMOTED.has(j.cell))
  const items: FixtureFiling['items'] = []
  for (const j of rows) {
    const claim = { id: `${adsh}.${j.model}.${j.field}`, field: j.field as string, value: j.value as number }
    const opts = { periodEnd, now: FIXED, producer: j.model as string, map: MAP, presentation: pres }
    const a = verifyAgainstTwin(tw, [claim], opts), b = verifyAgainstTwin(reduced, [claim], opts)
    if (canonicalize(replayView(a.verdict)) !== canonicalize(replayView(b.verdict))) throw new Error(`${claim.id}: the reduced twin changes the verdict`)
    const jd = a.judgments[0]!
    if (jd.outcome !== j.v02.outcome || jd.reason !== j.v02.reason || (jd.binding?.value ?? null) !== j.v02.binding_value) {
      throw new Error(`${claim.id}: a single-claim verdict disagrees with the benchmark's (${jd.outcome}/${jd.reason} vs ${j.v02.outcome}/${j.v02.reason})`)
    }
    checked++
    const g = gold.get(`${adsh}|${j.field}`)
    const inSample = i < audit.sample.length
    if (inSample && !g) throw new Error(`${claim.id}: an audit-sample item without a gold label`)
    items.push({
      field: j.field, cell: j.cell, value: j.value, bench_v02: j.v02.outcome,
      ...(inSample ? { gold: { value: g!.value, displayed: g!.displayed, row: g!.row, column: g!.column } } : {}),
    })
  }
  // One value the agent extracted outside the six promoted cells (never checked in this workflow): the demo's bypass plant.
  const outside = fieldsRows.find(r => r.adsh === adsh && r.value !== null && !rows.some(j => j.field === r.field) && judgments.some(j => j.adsh === adsh && j.field === r.field))
  out.push({
    adsh, name: m.name, cik: String(m.cik), model: m.model, period_end: periodEnd, link: m.link, doc_name: m.doc_name,
    doc_html_sha256: m.doc_html_sha256, audit_sample: i < audit.sample.length,
    twin: encodeTwin(reduce(tw)), presentation: pres, items,
    ...(outside ? { unchecked_value: { field: outside.field, value: outside.value } } : {}),
  })
  if (adsh === '0001477932-25-002447') full = { adsh, html, presentation: pin }
  console.log(`${String(i + 1).padStart(2)} ${adsh} ${m.name.slice(0, 30).padEnd(30)} items ${String(items.length).padStart(2)} facts ${tw.facts.length} -> ${reduce(tw).facts.length}`)
}
if (!full) throw new Error('the whole-filing sample is missing')

const fixture: Fixture = {
  fixture_version: 'earned-autonomy-fixture-v1',
  source: {
    benchmark: 'CREDENCE-2 (2026-09-28): twin v0.2 on 96 fresh 2025q2 10-K filings, pre-registered; audit by an independent model reader (claude-sonnet-5), adjudicated',
    files: provenance,
    audit_sample: audit.sample.length, promoted_cells: [...PROMOTED],
    map: `${MAP.id}@${MAP.version}`,
    reduction: 'facts in non-dimensional contexts plus every fact of a mapped concept; every item re-verified byte-identical against the full filing',
    items_checked_equal: checked,
  },
  filings: out, full,
}
mkdirSync(dirname(OUT), { recursive: true })
const gz = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 })
writeFileSync(OUT, gz)
console.log(JSON.stringify({ out: OUT, bytes: gz.length, sha256: sha(gz), filings: out.length, items: out.reduce((a, f) => a + f.items.length, 0), items_checked_equal: checked }))
