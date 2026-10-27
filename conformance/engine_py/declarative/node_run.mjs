// The Node engine over a JSONL of cases, for test_declarative.py's byte comparison (standard Node, no dependency):
//   node node_run.mjs <verify dist folder> <cases.jsonl> <out.jsonl>
// A case: { id, fn: verifyDeclarative | verify | lintRuleset, x, rs, o: { now?, engine?, producer?, tolerance?, source? } }.
// Writes per case the result exactly as the command line prints a verdict (JSON.stringify(result, null, 2) and a newline), or
// the error it threw.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [, , dist, inPath, outPath] = process.argv
const api = await import(pathToFileURL(join(dist, 'index.js')).href)
const out = []
for (const line of readFileSync(inPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const c = JSON.parse(line)
  const o = { ...(c.o ?? {}) }
  if (typeof o.now === 'string') { const t = o.now; o.now = () => new Date(t) }
  try {
    let r
    if (c.fn === 'verifyDeclarative') r = api.verifyDeclarative(c.x, c.rs, o)
    else if (c.fn === 'verify') r = api.verify(c.x, { ...o, ruleset: c.rs })
    else if (c.fn === 'lintRuleset') r = api.lintRuleset(c.rs)
    else throw new Error(`unknown fn ${c.fn}`)
    out.push(JSON.stringify({ id: c.id, out: `${JSON.stringify(r, null, 2)}\n` }))
  } catch (e) {
    out.push(JSON.stringify({ id: c.id, error: String(e?.message ?? e) }))
  }
}
writeFileSync(outPath, `${out.join('\n')}\n`)
