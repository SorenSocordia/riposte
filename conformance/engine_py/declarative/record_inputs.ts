// Regenerates this folder's two input files from the Node package's own TypeScript fixtures (they are TypeScript, so a reader
// without Node reads them here as JSON). Run with the Node package's tsx, from that package's folder:
//   node_modules/.bin/tsx <this folder>/record_inputs.ts <this folder>/fixtures
// fixtures/golden_inputs.json      every case of test/declarative-golden.test.ts and test/declarative-golden-einvoice-v010.test.ts,
//                                  as the function it calls and its arguments (a ruleset by key)
// fixtures/einvoice_labelled.json  test/fixtures/einvoice/labelled-set.ts as extractions: each fixture's clean values at their field
//                                  paths, then one document per labelled variant with that one field replaced (a line's item name
//                                  is left out: no carried ruleset reads it)
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type O = Record<string, unknown>
const FIX = resolve(process.cwd(), 'test', 'fixtures')
const load = async (f: string): Promise<O> => import(pathToFileURL(join(FIX, f)).href) as Promise<O>
const outDir = resolve(process.argv[2] ?? 'fixtures')

const rulesets: Record<string, unknown> = {}
const keyOf = (rs: unknown): string => { const k = createHash('sha256').update(JSON.stringify(rs)).digest('hex').slice(0, 16); rulesets[k] = rs; return k }
const opts = (o: O | undefined): O => {
  const out: O = {}
  for (const [k, v] of Object.entries(o ?? {})) {
    if (k === 'now') out.now = (v as () => Date)().toISOString()
    else if (k === 'ruleset') out.ruleset = keyOf(v)
    else out[k] = v
  }
  return out
}
function record(cases: { id: string; run: (api: never) => unknown }[]): O[] {
  return cases.map((c) => {
    let rec: O | undefined
    c.run({
      verify: (x: O, o: O) => { rec = { fn: 'verify', x, o: opts(o) }; return {} },
      verifyDeclarative: (x: O, rs: unknown, o: O) => { rec = { fn: 'verifyDeclarative', x, rs: keyOf(rs), o: opts(o) }; return {} },
      reconcile: (d: O, rs: unknown, o: O) => { rec = { fn: 'reconcile', x: d, rs: keyOf(rs), o: opts(o) }; return {} },
      lintRuleset: (rs: unknown) => { rec = { fn: 'lintRuleset', rs: keyOf(rs) }; return {} },
      evalExpr: (e: string) => { rec = { fn: 'evalExpr', expr: e }; return 0 },
    } as never)
    if (!rec) throw new Error(`case ${c.id} recorded nothing`)
    return { id: c.id, ...rec }
  })
}
const g1 = record(((await load('declarative-golden-cases.ts')).buildGoldenCases as () => never)())
const g2 = record(((await load('declarative-golden-einvoice-v010-cases.ts')).buildGoldenCasesV010 as () => never)())
writeFileSync(join(outDir, 'golden_inputs.json'), `${JSON.stringify({ kind: 'declarative-golden-inputs', recorded_by: 'record_inputs.ts', golden: g1, golden_einvoice_v010: g2, rulesets })}\n`)

function setPath(obj: O, path: string, v: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: O = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(parts[i + 1]!) ? [] : {}
    cur = cur[k] as O
  }
  cur[parts[parts.length - 1]!] = v
}
type Claim = { claim: { id: string; field: string; value: unknown }; label: string; kind: string }
const labelled = ((await load('einvoice/labelled-set.ts')).buildLabelledSet as () => { name: string; claims: Claim[] }[])()
const docs: { id: string; extraction: O }[] = []
// A line's item name is left out (no carried ruleset reads it, and the export's word scan holds one of the fixture's item names)
const read = (c: Claim): boolean => !/(^|\.)item_name$/.test(c.claim.field)
for (const d of labelled) {
  const base: O = {}
  for (const c of d.claims) if (c.label === 'CLEAN' && c.kind === 'exact' && read(c)) setPath(base, c.claim.field, c.claim.value)
  docs.push({ id: `${d.name}:clean`, extraction: base })
  for (const c of d.claims) {
    if (c.kind === 'exact' || !read(c)) continue
    const x = structuredClone(base)
    setPath(x, c.claim.field, c.claim.value)
    docs.push({ id: c.claim.id, extraction: x })
  }
}
writeFileSync(join(outDir, 'einvoice_labelled.json'), `${JSON.stringify({ kind: 'einvoice-labelled-extractions', recorded_by: 'record_inputs.ts', left_out: 'lines[*].item_name (no carried ruleset reads it)', docs })}\n`)
console.log(`recorded ${g1.length} + ${g2.length} golden cases (${Object.keys(rulesets).length} rulesets) and ${docs.length} labelled extractions -> ${outDir}`)
