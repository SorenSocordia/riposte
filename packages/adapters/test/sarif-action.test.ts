// The GitHub Action (riposte-overlay .github/actions/riposte-verify, the repository's .github/ once exported), run locally the
// way a runner would, act-style: action.yml is parsed (PyYAML), each step's `if`, `env` and `working-directory` expressions are
// evaluated, and its `run` executes in bash with GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files. No GitHub run, no network: the
// build step is skipped by passing `cli` (the bin built here). Skipped without the action, the built bin, bash or PyYAML.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { replayBundle } from 'riposte-verify'
import { validate } from './json-schema-lite.js'

const posix = (p: string) => p.replace(/\\/g, '/')
const actionDir = ['../../riposte-overlay/.github/actions/riposte-verify/', '../../../.github/actions/riposte-verify/']
  .map((p) => fileURLToPath(new URL(p, import.meta.url))).find((d) => existsSync(join(d, 'action.yml')))
const sarifBin = fileURLToPath(new URL('../bin/riposte-sarif.mjs', import.meta.url))
const FIX = fileURLToPath(new URL('./fixtures/sarif/', import.meta.url))
const SCHEMA = JSON.parse(readFileSync(join(FIX, 'sarif-schema-2.1.0.json'), 'utf8'))
const quiet = { encoding: 'utf8' as const, windowsHide: true, timeout: 60_000 }
const hasBash = spawnSync('bash', ['-c', 'echo ok'], quiet).stdout?.trim() === 'ok'
const yaml = (file: string): any => {
  const r = spawnSync('python', ['-c', 'import sys,json,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1],encoding="utf-8"))))', file], quiet)
  return r.status === 0 ? JSON.parse(r.stdout) : undefined
}
const action = actionDir ? yaml(join(actionDir, 'action.yml')) : undefined
const ready = Boolean(action && hasBash && existsSync(sarifBin))

const scanUrl = new URL('../../riposte-export-scan.mjs', import.meta.url)
const scan: ((rel: string, buf: Buffer) => string[]) | undefined = existsSync(fileURLToPath(scanUrl)) ? (await import(scanUrl.href)).scanFile : undefined

// ── a tiny runner for the expressions this action uses: inputs.x, steps.id.outputs.y, github.*, 'literal', ==, !=, || ──
interface Ctx { inputs: Record<string, string>; steps: Record<string, Record<string, string>>; github: Record<string, string> }
function evalExpr(e: string, ctx: Ctx): string {
  for (const alt of e.split('||').map((s) => s.trim())) {
    const cmp = /^(.*?)\s*(==|!=)\s*(.*)$/.exec(alt)
    const v = cmp ? String((evalExpr(cmp[1]!, ctx) === evalExpr(cmp[3]!, ctx)) === (cmp[2] === '==')) : term(alt, ctx)
    if (v && v !== 'false') return v
  }
  return ''
}
function term(t: string, ctx: Ctx): string {
  const lit = /^'(.*)'$/.exec(t)
  if (lit) return lit[1]!.replace(/''/g, "'")
  const [head, ...rest] = t.split('.')
  if (head === 'inputs') return ctx.inputs[rest.join('.')] ?? ''
  if (head === 'github') return ctx.github[rest.join('.')] ?? ''
  if (head === 'steps' && rest[1] === 'outputs') return ctx.steps[rest[0]!]?.[rest.slice(2).join('.')] ?? ''
  throw new Error(`unsupported expression term ${t}`)
}
const subst = (s: string, ctx: Ctx) => s.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_m, e: string) => evalExpr(e, ctx))
const parseOutputs = (file: string) => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'riposte-action-'))
  dirs.push(d)
  for (const f of ['clean-invoice.json', 'invoice-over-contract.json', 'payapp-retainage.json', 'invoice-missing-totals.json']) cpSync(join(FIX, f), join(d, 'docs', f))
  return d
}

/** Run the composite action's steps in `ws`, as a runner would. */
function runAction(ws: string, given: Record<string, string>) {
  const inputs = Object.fromEntries(Object.entries(action.inputs as Record<string, any>).map(([k, v]) => [k, given[k] ?? v.default ?? '']))
  for (const [k, v] of Object.entries(action.inputs as Record<string, any>)) if (v.required && !inputs[k]) throw new Error(`missing required input ${k}`)
  const ctx: Ctx = { inputs, steps: {}, github: { action_path: posix(actionDir!), workspace: posix(ws) } }
  const summary = join(ws, '..', `${ws.split(/[\\/]/).pop()}-summary.md`)
  writeFileSync(summary, '')
  dirs.push(summary)
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_') && !k.startsWith('INPUT_') && !k.startsWith('GITHUB_')))
  const ran: string[] = []
  for (const step of action.runs.steps as any[]) {
    if (step.if !== undefined && !evalExpr(String(step.if), ctx)) continue
    const out = join(ws, '..', `${ws.split(/[\\/]/).pop()}-${step.id}.out`)
    writeFileSync(out, '')
    dirs.push(out)
    const env = {
      ...base, HOME: ws, USERPROFILE: ws, GITHUB_ACTION_PATH: posix(actionDir!), GITHUB_WORKSPACE: posix(ws), GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary,
      ...Object.fromEntries(Object.entries((step.env ?? {}) as Record<string, string>).map(([k, v]) => [k, subst(String(v), ctx)])),
    }
    const cwd = step['working-directory'] ? resolve(ws, subst(step['working-directory'], ctx)) : ws
    const r = spawnSync('bash', ['-c', subst(step.run, ctx)], { ...quiet, cwd, env })
    ran.push(step.id)
    ctx.steps[step.id] = parseOutputs(out)
    if (r.status !== 0) return { code: r.status, failedStep: step.id as string, stderr: r.stderr, ran, outputs: outputsOf(ctx), summary: readFileSync(summary, 'utf8') }
  }
  return { code: 0, failedStep: undefined, stderr: '', ran, outputs: outputsOf(ctx), summary: readFileSync(summary, 'utf8') }
}
const outputsOf = (ctx: Ctx) => Object.fromEntries(Object.entries(action.outputs as Record<string, any>).map(([k, v]) => [k, subst(v.value, ctx)]))

describe.skipIf(!ready)('the GitHub Action, run locally act-style', () => {
  it('is a composite action whose run lines never interpolate an input (inputs reach the scripts only through env)', () => {
    expect(action.runs.using).toBe('composite')
    for (const step of action.runs.steps) {
      expect(step.shell).toBe('bash')
      expect(step.run).not.toMatch(/\$\{\{/)
      for (const v of Object.values(step.env ?? {}) as string[]) for (const m of v.matchAll(/inputs\.([\w-]+)/g)) expect(Object.keys(action.inputs)).toContain(m[1])
    }
    expect(Object.keys(action.inputs).filter((k) => action.inputs[k].required)).toEqual(['files'])
    expect(action.inputs['fail-on'].default).toBe('insufficient-data')
    expect(action.inputs['fail-on'].description).toMatch(/^insufficient-data \(default\)/)
    expect(action.inputs['fail-on'].description).toContain('fail: only when a check FAILs')
    expect(JSON.stringify(action)).not.toContain('ABSTAIN')
    expect(Object.keys(action.outputs)).toEqual(['sarif-file', 'proof-dir', 'files', 'pass', 'fail', 'insufficient-data', 'refused', 'outcome'])
  })

  it('the four fixtures: FAIL fails the step; valid SARIF, outputs, summary and replayable proofs', () => {
    const ws = workspace()
    const r = runAction(ws, { files: 'docs/**/*.json', cli: posix(sarifBin) })
    expect(r.ran).toEqual(['check']) // the build step's `if: inputs.cli == ''` skipped it
    expect([r.code, r.failedStep]).toEqual([1, 'check'])
    expect(r.outputs).toEqual({ 'sarif-file': 'riposte.sarif', 'proof-dir': 'riposte-proofs', files: '4', pass: '1', fail: '2', 'insufficient-data': '1', refused: '0', outcome: 'FAIL' })
    const log = JSON.parse(readFileSync(join(ws, 'riposte.sarif'), 'utf8'))
    expect(validate(SCHEMA, log)).toEqual([])
    const results = log.runs[0].results as any[]
    expect(new Set(results.map((x) => x.level))).toEqual(new Set(['error', 'warning']))
    expect(results.filter((x) => x.properties.riposte.answer === 'INSUFFICIENT_DATA').every((x) => x.level === 'warning')).toBe(true)
    expect(log.runs[0].automationDetails).toBeUndefined() // category is empty by default
    expect(r.summary).toMatch(/\| 4 \| 1 \| 2 \| 1 \| 0 \|/)
    const proofs = readdirSync(join(ws, 'riposte-proofs'))
    expect(proofs.length).toBe(4) // every verdict's proof, the PASS one included (it has no alert)
    for (const p of proofs) expect((replayBundle(JSON.parse(readFileSync(join(ws, 'riposte-proofs', p), 'utf8'))) as any).result).toBe('MATCH')
    if (scan) {
      delete log.runs[0].originalUriBaseIds // the runner's own folder: environment, not content
      expect(scan('emitted/action.sarif', Buffer.from(JSON.stringify(log, null, 2)))).toEqual([])
      expect(scan('emitted/summary.md', Buffer.from(r.summary))).toEqual([])
    }
  })

  it('can\'t tell fails the step by default (fail closed); fail-on: fail passes it; abstain is still read; fail-on: none never fails', () => {
    const cant = runAction(workspace(), { files: 'docs/invoice-missing-totals.json', cli: posix(sarifBin) })
    expect([cant.code, cant.outputs.outcome, cant.outputs['insufficient-data']]).toEqual([1, 'INSUFFICIENT_DATA', '1'])
    expect(runAction(workspace(), { files: 'docs/invoice-missing-totals.json', cli: posix(sarifBin), 'fail-on': 'fail' }).code).toBe(0)
    expect(runAction(workspace(), { files: 'docs/invoice-missing-totals.json', cli: posix(sarifBin), 'fail-on': 'abstain' }).code).toBe(1)
    const none = runAction(workspace(), { files: 'docs/*.json', cli: posix(sarifBin), 'fail-on': 'none' })
    expect([none.code, none.outputs.fail]).toEqual([0, '2'])
  })

  it('working-directory: globs relative to it; locations and outputs relative to the repository root', () => {
    const ws = workspace()
    const r = runAction(ws, { files: '*.json\n!clean-*', 'working-directory': 'docs', cli: posix(sarifBin), category: 'riposte-docs' })
    expect(r.outputs['sarif-file']).toBe('docs/riposte.sarif')
    expect(r.outputs.files).toBe('3')
    const log = JSON.parse(readFileSync(join(ws, 'docs', 'riposte.sarif'), 'utf8'))
    expect(log.runs[0].results.every((x: any) => x.locations[0].physicalLocation.artifactLocation.uri.startsWith('docs/'))).toBe(true)
    expect(log.runs[0].automationDetails).toEqual({ id: 'riposte-docs/' })
  })

  it('a hostile files input is a pattern, never a command', () => {
    const ws = workspace()
    const r = runAction(ws, { files: '$(touch pwned1)\n"; touch pwned2; #\n`touch pwned3`', cli: posix(sarifBin) })
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/no such file/)
    expect(readdirSync(ws).filter((f) => f.startsWith('pwned'))).toEqual([])
  })

  it('without cli, the build step is the one that runs (its `if` is true); a missing checker stops with exit 3', () => {
    const ctx: Ctx = { inputs: { cli: '' }, steps: {}, github: {} }
    expect(evalExpr(action.runs.steps[0].if, ctx)).toBe('true')
    expect(evalExpr(action.runs.steps[1].env.INPUT_CLI.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), { ...ctx, steps: { build: { cli: '/x/riposte-sarif.mjs' } } })).toBe('/x/riposte-sarif.mjs')
    const ws = workspace()
    const r = spawnSync('bash', [join(actionDir!, 'run.sh')], { ...quiet, cwd: ws, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIPOSTE_') && !k.startsWith('RECEIPTS_'))), INPUT_CLI: '', INPUT_FILES: 'docs/*.json' } })
    expect(r.status).toBe(3)
  })
})
