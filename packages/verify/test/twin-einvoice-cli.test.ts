/**
 * Wiring for the e-invoice twin (src/twin-einvoice/, logic untouched here): the package root exports it, and the
 * `verify twin-einvoice` CLI verb runs it with exit codes 0 PASS · 1 FAIL · 2 ABSTAIN · 3 usage/input error.
 * Constructed fixture only (test/fixtures/einvoice/peppol-bis3-invoice.xml).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { verifyEinvoiceTwin, detectProfile, EINVOICE_MAPS } from '../src/index'
import { run, type CliIO } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEPPOL = join(HERE, 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml')

const files: string[] = []
function tmp(name: string, content: unknown): string {
  const p = join(tmpdir(), `verify-twin-einvoice-cli-${process.pid}-${files.length}-${name}`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) rmSync(f) })
function cap(): CliIO & { out_: () => string; err_: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
}

describe('the package exports the e-invoice twin', () => {
  it('its public names are reachable from the package root', () => {
    for (const f of [verifyEinvoiceTwin, detectProfile]) expect(typeof f).toBe('function')
    expect(Object.keys(EINVOICE_MAPS).length).toBeGreaterThan(0)
  })
})

describe('verify twin-einvoice (CLI)', () => {
  it('a correct payable amount PASSes with exit 0', () => {
    const io = cap()
    const code = run(['twin-einvoice', PEPPOL, '--claims', tmp('ok.json', [{ id: 'c1', field: 'payable_amount', value: 1034 }])], io)
    expect(code).toBe(0)
    const r = JSON.parse(io.out_())
    expect(r.verdict.outcome).toBe('PASS')
    expect(r.twin.profile).toBe('peppol-bis3')
  })
  it('a wrong payable amount FAILs with exit 1', () => {
    const io = cap()
    const code = run(['twin-einvoice', PEPPOL, '--claims', tmp('bad.json', { claims: [{ id: 'c1', field: 'payable_amount', value: 1043.5 }] })], io)
    expect(code).toBe(1)
    expect(JSON.parse(io.out_()).verdict.outcome).toBe('FAIL')
  })
  it('usage errors exit 3 and never throw', () => {
    expect(run(['twin-einvoice', PEPPOL], cap())).toBe(3)
    expect(run(['twin-einvoice', PEPPOL, '--claims', tmp('c.json', []), '--profile', 'nope'], cap())).toBe(3)
    expect(run(['twin-einvoice', PEPPOL, '--claims', tmp('c.json', [{ id: 1 }])], cap())).toBe(3)
    expect(run(['twin-einvoice', PEPPOL, '--claims', tmp('c.json', []), '--bogus'], cap())).toBe(3)
  })
})
