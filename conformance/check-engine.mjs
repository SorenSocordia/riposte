// SPDX-License-Identifier: Apache-2.0
// Runs the built engine's replay on every conformance vector and on every bundle of the pack, and compares the result with the
// expected outcome. Run from the repository root after `npm run build`:
//
//   node conformance/check-engine.mjs
//
// Exit 0: every vector and every pack bundle gave its expected exit code and phrase. Exit 1: at least one did not.
// Exit 3: the CLI is not built, or the manifest or the pack cannot be read.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'packages', 'verify', 'dist', 'cli.js')
const PACK = join(ROOT, 'packages', 'verify', 'test', 'fixtures', 'engine-0.0.1-bundles.json')

if (!existsSync(CLI)) {
  process.stderr.write('the engine is not built: run `npm run build` at the repository root first\n')
  process.exit(3)
}
let manifest, pack
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'conformance', 'vectors.json'), 'utf8'))
  pack = JSON.parse(readFileSync(PACK, 'utf8'))
} catch (e) {
  process.stderr.write(`cannot read the manifest or the pack: ${e.message}\n`)
  process.exit(3)
}

function replay(file, args = []) {
  const r = spawnSync(process.execPath, [CLI, 'replay', file, ...args], { encoding: 'utf8' })
  return { code: r.status, first: (r.stderr ?? '').split('\n')[0] ?? '' }
}

let bad = 0
let runs = 0
const line = (ok, name, detail) => {
  runs++
  if (!ok) bad++
  process.stdout.write(`${ok ? 'ok  ' : 'BAD '} ${name}  ${detail}\n`)
}

for (const v of manifest.vectors) {
  const file = join(ROOT, 'conformance', 'vectors', v.file)
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (sha !== v.sha256) {
    line(false, `vector ${v.id}`, `the file's bytes changed (sha256 ${sha}, expected ${v.sha256}); a checkout may have converted its line endings`)
    continue
  }
  // The vector's main run (with its `args`, when it has any), then each further run listed under `also`.
  const runs = [{ args: v.expect.args ?? [], engine_exit: v.expect.engine_exit, engine_says: v.expect.engine_says }, ...(v.expect.also ?? [])]
  for (const run of runs) {
    const { code, first } = replay(file, run.args)
    const ok = code === run.engine_exit && first.includes(run.engine_says)
    const shown = run.args.length ? ` ${run.args.join(' ')}` : ''
    line(ok, `vector ${v.id}${shown}`, `exit ${code} (expected ${run.engine_exit})${ok ? '' : `: ${first}`}`)
  }
}

// The pack: each bundle written to a scratch file as { verdict, inputs } and replayed; each must be VERIFIED (exit 0).
const scratch = mkdtempSync(join(tmpdir(), 'riposte-conformance-'))
try {
  for (const b of pack.bundles) {
    const f = join(scratch, `${b.id}.json`)
    writeFileSync(f, JSON.stringify({ verdict: b.verdict, inputs: b.inputs }))
    const { code, first } = replay(f)
    const ok = code === 0 && first.includes('outcome VERIFIED')
    line(ok, `pack ${b.id}`, `exit ${code} (expected 0)${ok ? '' : `: ${first}`}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

const vectorRuns = runs - pack.bundles.length
process.stdout.write(`${runs - bad} of ${runs} runs as expected (${manifest.vectors.length} vectors in ${vectorRuns} runs, ${pack.bundles.length} pack bundles)\n`)
process.exit(bad === 0 ? 0 : 1)
