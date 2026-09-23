/**
 * `verify` CLI — declarative-ruleset-from-file, plus the `lint` and `measure` subcommands. Driven through run(argv, io)
 * with a captured IO (no real stdout) and temp files.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { run, type CliIO } from '../src/cli'
import { verifyDeclarative } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const files: string[] = []
function tmp(name: string, content: unknown): string {
  const p = join(tmpdir(), `verify-cli-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })

function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

const ruleset = {
  id: 't', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}

describe('verify <doc> --ruleset <declarative file>', () => {
  it('PASS → exit 0 and prints a verdict', () => {
    const io = cap()
    const rp = tmp('rs.json', ruleset)
    const dp = tmp('doc.json', { subtotal: 1, tax: 1, total: 2 })
    expect(run([dp, '--ruleset', rp], io)).toBe(0)
    expect(io.out_()).toMatch(/"verdict_id"/)
    expect(io.out_()).toMatch(/"outcome": "PASS"/)
  })
  it('FAIL → exit 1', () => {
    const io = cap()
    const rp = tmp('rs.json', ruleset)
    const dp = tmp('doc.json', { subtotal: 1, tax: 1, total: 9 })
    expect(run([dp, '--ruleset', rp], io)).toBe(1)
  })
})

describe('verify lint', () => {
  it('a well-formed ruleset lints ok → exit 0', () => {
    const io = cap()
    const rp = tmp('rs.json', ruleset)
    expect(run(['lint', '--ruleset', rp], io)).toBe(0)
    expect(io.out_()).toMatch(/"ok": true/)
  })
  it('missing --ruleset → usage error, exit 3', () => {
    const io = cap()
    expect(run(['lint'], io)).toBe(3)
    expect(io.err_()).toMatch(/verify lint/)
  })
})

describe('verify measure', () => {
  it('prints a measured accuracy card and exits 0', () => {
    const io = cap()
    const rp = tmp('rs.json', ruleset)
    const lp = tmp('labels.json', [
      { extraction: { subtotal: 1, tax: 1, total: 2 }, label: 'CLEAN' },
      { extraction: { subtotal: 1, tax: 1, total: 9 }, label: 'ERROR' },
    ])
    expect(run(['measure', '--ruleset', rp, '--labels', lp], io)).toBe(0)
    expect(io.out_()).toMatch(/Declared accuracy/)
    expect(io.out_()).toMatch(/measured_on/)
  })
  it('accepts a { cases: [...] } labels file too', () => {
    const io = cap()
    const rp = tmp('rs.json', ruleset)
    const lp = tmp('labels.json', { cases: [{ extraction: { subtotal: 1, tax: 1, total: 2 }, label: 'CLEAN' }] })
    expect(run(['measure', '--ruleset', rp, '--labels', lp], io)).toBe(0)
  })
})

describe('verify replay', () => {
  const v = verifyDeclarative({ subtotal: 100, tax: 10, total: 110 }, ruleset as DeclarativeRuleset, { now: () => new Date('2026-09-22T00:00:00Z') })
  it('a genuine verdict replays → exit 0', () => {
    const io = cap()
    const vp = tmp('verdict.json', v)
    expect(run(['replay', vp], io)).toBe(0)
    expect(io.out_()).toMatch(/"id_ok": true/)
  })
  it('with --inputs, binding to the right inputs → exit 0', () => {
    const io = cap()
    const vp = tmp('verdict.json', v)
    const ip = tmp('inputs.json', { extraction: { subtotal: 100, tax: 10, total: 110 }, ruleset })
    expect(run(['replay', vp, '--inputs', ip], io)).toBe(0)
    expect(io.out_()).toMatch(/"input_ok": true/)
  })
  it('a tampered verdict_id → exit 1', () => {
    const io = cap()
    const vp = tmp('verdict.json', { ...v, verdict_id: 'deadbeefdeadbeefdeadbeefdeadbeef' })
    expect(run(['replay', vp], io)).toBe(1)
  })
})

describe('usage', () => {
  it('--help → exit 0 with usage', () => {
    const io = cap()
    expect(run(['--help'], io)).toBe(0)
    expect(io.err_()).toMatch(/verify </)
  })
  it('no args → exit 3', () => {
    expect(run([], cap())).toBe(3)
  })
})
