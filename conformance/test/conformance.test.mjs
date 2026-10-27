// SPDX-License-Identifier: Apache-2.0
// The conformance suite's own tests. Run from this folder after `npm run build` at the repository root:
//
//   cd conformance && npx vitest run
//
// They need the built engine (packages/verify/dist) and python3 on the PATH.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..')
const ROOT = join(DIR, '..')
const PY = process.env.PYTHON ?? 'python3'

const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, input, maxBuffer: 64 * 1024 * 1024 })

describe('the conformance vectors and the pack', () => {
  it('the engine gives every vector its expected exit code and phrase, and replays every pack bundle VERIFIED', () => {
    const r = run(process.execPath, [join(DIR, 'check-engine.mjs')])
    expect(r.stdout).toContain('31 of 31 runs as expected (20 vectors in 23 runs, 8 pack bundles)')
    expect(r.status).toBe(0)
  }, 120_000)

  // 2026-10-12 (integration): Python runs with -X utf8 (on Windows a pipe is cp1252 otherwise, and -I ignores PYTHONUTF8),
  // and its output is split on CRLF as well as LF (Python on Windows writes CRLF)
  it('the Python binding verifier gives every vector its binding answer and reproduces every pack input_hash and verdict_id', () => {
    const r = run(PY, ['-I', '-X', 'utf8', join(DIR, 'check_binding.py')])
    expect(r.stdout).toContain('28 of 28 as expected (20 vectors, 8 pack bundles)')
    expect(r.status).toBe(0)
  }, 120_000)

  it('the Python verifier never exits 0, and its first stderr line says it does not re-perform the check', () => {
    const r = run(PY, ['-I', '-X', 'utf8', join(DIR, 'riposte_bind.py'), join(DIR, 'vectors', '01-valid-invoice-0.6.0.json')])
    expect(r.status).toBe(2)
    expect(r.stderr.split(/\r?\n/)[0]).toBe('riposte_bind: binding only: input_hash and verdict_id recomputed; the check is not re-performed')
    expect(JSON.parse(r.stdout).reperformed).toBe(false)
  })

  // 2026-10-12 (integration): an output encoding that cannot write a character (cp1252, forced here on every platform) must
  // never read as exit 1, "the binding fails": the verifier writes UTF-8 itself. A missing file is refused, exit 3.
  it('a character the console encoding cannot write is still exit 3 (refused) for a missing file, never 1', () => {
    const missing = join(DIR, 'no-such-bundle-\u{1F600}.json')
    const r = spawnSync(PY, ['-s', join(DIR, 'riposte_bind.py'), missing], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: 'cp1252' } })
    expect(r.status, r.stderr).toBe(3)
    const out = JSON.parse(r.stdout)
    expect(out.binding).toBe('refused')
    expect(out.reasons[0]).toContain('no-such-bundle-\u{1F600}.json')
    expect(r.stderr.split(/\r?\n/)[0]).toBe('riposte_bind: binding only: input_hash and verdict_id recomputed; the check is not re-performed')
  })
})

// Each line is JSON text; the engine's canonicalize and the Python verifier's canonical_json must write the same bytes.
const CANONICAL_CASES = [
  '{"b":1,"10":2,"9":3}',
  '{"-1":0,"01":0,"4294967295":0,"4294967294":0,"B":0,"a":0,"0":0}',
  '[6125.0,6.125e3,612500e-2,1e21,1e-7,1.5e-7,123e-20,0.1,0.30000000000000004,-0,100,1e300,5e-324,123456789012345680000,-2.5e-8]',
  '"\\ud800 \\u0001 \\u001f \\u007f \\u2028 é 😀 \\" \\\\ \\n \\t \\b \\f \\r /"',
  '{"__proto__":{"x":1}}',
  '{"é":1,"z":2,"😀":3,"\\uffff":4,"":5}',
  '{"nested":[{"z":null,"a":[true,false,{}]},[]],"x":"\\u004f"}',
]

describe('canonical JSON: the Python verifier writes what the engine writes', () => {
  it('every case, byte for byte', async () => {
    const { canonicalize } = await import(pathToFileURL(join(ROOT, 'packages', 'verify', 'dist', 'verdict', 'canonical.js')).href)
    const script = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(DIR)})`,
      'import riposte_bind as rb',
      'for line in sys.stdin.read().split("\\n"):',
      '    if line: print(json.dumps(rb.canonical_json(rb.read_json_bytes(line.encode("utf-8"), "case"))))',
    ].join('\n')
    const r = run(PY, ['-I', '-X', 'utf8', '-c', script], CANONICAL_CASES.join('\n')) // -X utf8: 2026-10-12, as above
    expect(r.stderr).toBe('')
    const got = r.stdout.trim().split(/\r?\n/).map(l => JSON.parse(l))
    expect(got).toEqual(CANONICAL_CASES.map(c => canonicalize(JSON.parse(c))))
  })
})
