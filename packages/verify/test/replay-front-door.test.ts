/**
 * 2026-10-05, the replay and the front door: what a person reads, and where.
 *   1. twin-einvoice: JSON on stdout, the words on stderr (one rule for every command); can't tell is INSUFFICIENT_DATA in its
 *      JSON, never ABSTAIN; it fails closed like `check`.
 *   2. A check that could not run says can't tell in a clerk's words under engine 0.6.0 (TIME_ORD on a numeric date read
 *      "Law of Temporal Order VIOLATED"); earlier engines keep their bytes.
 *   3. A printed figure with no two decimals says why it was not read (engine 0.6.0).
 *   4. The CLI module knows when it is the program, and a script that only imports it is told so (exit 3), never a silent 0.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../src/index'
import { run, isProgram, type CliIO } from '../src/cli'
import { cantTellSentence } from '../src/verdict/cant-tell'
import { notStrictNote } from '../src/declarative/unreadable'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEPPOL = join(HERE, 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml')
const DIST_CLI = join(HERE, '..', 'dist', 'cli.js')
afterAll(() => cleanScratch())

function cap(): CliIO & { o: () => string; e: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, o: () => o, e: () => e }
}

describe('1. twin-einvoice: JSON on stdout, words on stderr, one word for can\'t tell, fail closed', () => {
  it('the README example: FAIL on stderr in words, exit 1; stdout is the JSON alone', () => {
    const d = scratch('r4-twin-')
    const claims = join(d, 'claims.json')
    writeFileSync(claims, JSON.stringify([{ id: 'total', field: 'payable_amount', value: 1043.00 }]))
    const io = cap()
    expect(run(['twin-einvoice', PEPPOL, '--claims', claims, '--profile', 'peppol-bis3'], io)).toBe(1)
    const json = JSON.parse(io.o())
    expect(json.verdict.outcome).toBe('FAIL')
    const err = io.e().split('\n')
    expect(err[0]).toMatch(/^verify twin-einvoice: FAIL: 1 of \d+ checks? failed$/)
    expect(io.e()).toContain('two adjacent digits are transposed (1043 vs 1034)')
    expect(io.e()).toContain('BT-115')
    expect(io.e()).toMatch(/PASS +the XML's own figures: \d+ of \d+ business rules hold/)
  })

  it('a claim it cannot judge reads INSUFFICIENT_DATA in the JSON and on stderr, never ABSTAIN; a PASS beside it exits 2', () => {
    const d = scratch('r4-twin-')
    const claims = join(d, 'claims.json')
    writeFileSync(claims, JSON.stringify([{ id: 'ok', field: 'payable_amount', value: 1034 }, { id: 'odd', field: 'payable_amount', value: 'about a thousand' }]))
    const io = cap()
    const code = run(['twin-einvoice', PEPPOL, '--claims', claims, '--profile', 'peppol-bis3'], io)
    const json = JSON.parse(io.o())
    expect(json.judgments.map((j: { outcome: string }) => j.outcome)).toEqual(['PASS', 'INSUFFICIENT_DATA'])
    expect(io.o()).not.toContain('ABSTAIN')
    expect(io.e()).not.toContain('ABSTAIN')
    expect(io.e()).toMatch(/INSUFFICIENT_DATA +odd \(payable_amount = "about a thousand"\)/)
    // the verdict's outcome is PASS (ANY_FAIL_FAILS), its gate PASS-WITH-OPEN: the command fails closed, as check does
    expect(json.verdict.outcome).toBe('PASS')
    expect(code).toBe(2)
    expect(io.e().split('\n')[0]).toMatch(/^verify twin-einvoice: PASS-WITH-OPEN: 1 of \d+ checks? could not run$/)
  })
})

describe('2. a check that could not run says can\'t tell in words (engine 0.6.0)', () => {
  const inv = { invoice_number: 'INV-77', service_date: 1769922000000, line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax_rate: 0, tax: 0, total: 1500 } }
  const contract = { contract_id: 'C-1', effective_date: '2026-01-01', expiration_date: '2026-01-31', line_items: [{ description: 'Consulting', unit_price: 150 }] }
  const timeOrd = (engine?: string) => verify(inv, { references: { contract }, ...(engine ? { engine } : {}), now: () => new Date(0) }).claims.find(c => c.rule_id === 'TIME_ORD')!

  it('TIME_ORD on a numeric date: INSUFFICIENT_DATA with a clerk\'s sentence, no "VIOLATED", no "Law of"', () => {
    const c = timeOrd()
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.explanation).toBe('Can\'t tell whether the service date falls within the contract\'s term: the service date reads "1769922000000", which is not a date, so nothing was compared. Write the date as YYYY-MM-DD and check again.')
    expect(c.explanation).not.toMatch(/VIOLATED|Law of/)
    // the machine record is unchanged
    expect(c.insufficiency).toEqual({ reason: 'UNPARSEABLE', detail: 'Type mismatch for >= comparison; Type mismatch for <= comparison' })
  })

  it('engine 0.5.0 keeps the kernel\'s text, so its verdicts replay byte for byte', () => {
    expect(timeOrd('0.5.0').explanation).toBe('Law of Temporal Order VIOLATED: Type mismatch for >= comparison; Type mismatch for <= comparison')
  })

  it('a check with no unreadable operand on record still says can\'t tell, naming the check by what it asks', () => {
    expect(cantTellSentence({ rule_id: 'TAX_INT', evidence: [] })).toBe('Can\'t tell whether the tax equals the subtotal times the tax rate: a value it needs is not a number or a date it can compare, so nothing was compared.')
    expect(cantTellSentence({ rule_id: 'SOMETHING_NEW', evidence: [] })).toMatch(/^Can't tell the check SOMETHING_NEW: /)
  })
})

describe('3. a printed figure with no two decimals says why it was not read (engine 0.6.0)', () => {
  const at = (text: string, label: string) => ({ how: 'label' as const, at: { line: 21, text, label } })
  it('"Document allowances EUR 20": an amount needs two decimals, read as not strict', () => {
    expect(notStrictNote(at('Document allowances EUR 20', 'Document allowances'), 'amount')).toBe('the line prints "20": an amount needs two decimals, so "20" is read as not strict, never as 20.00')
    expect(notStrictNote(at('VAT total i °225.0', 'VAT total'), 'amount')).toBe('the line prints "225.0": an amount needs two decimals, so "225.0" is read as not strict')
  })
  it('no note when the figure has two decimals, when there is no figure, or when the field is not an amount', () => {
    expect(notStrictNote(at('Document allowances EUR 20.00', 'Document allowances'), 'amount')).toBeUndefined()
    expect(notStrictNote(at('Total without VAT E ten', 'Total without VAT'), 'amount')).toBeUndefined()
    expect(notStrictNote(at('Quantity 20', 'Quantity'), 'quantity')).toBeUndefined()
    expect(notStrictNote({ how: 'null', path: 'x' }, 'amount')).toBeUndefined()
  })
})

describe('4. the CLI module knows when it is the program', () => {
  it('argv[1] naming cli.js or cli.ts is the program; another script is not', () => {
    expect(isProgram('/opt/riposte/packages/verify/dist/cli.js')).toBe(true)
    expect(isProgram('C:\\riposte\\packages\\verify\\src\\cli.ts')).toBe(true)
    expect(isProgram('/home/me/wrapper.mjs')).toBe(false)
    expect(isProgram(undefined)).toBe(false)
  })

  it.skipIf(!existsSync(DIST_CLI))('a script that only imports the built CLI is told no command ran, and exits 3 (never a silent 0)', () => {
    const d = scratch('r4-wrap-')
    const wrapper = join(d, 'wrapper.mjs')
    writeFileSync(wrapper, `await import(${JSON.stringify(new URL(`file:///${DIST_CLI.replace(/\\/g, '/').replace(/^\//, '')}`).href)})\n`)
    const env = { ...process.env }
    delete env.VITEST
    delete env.JEST_WORKER_ID
    const r = spawnSync(process.execPath, [wrapper, '--version'], { encoding: 'utf8', env, windowsHide: true })
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('no command ran: this module was imported by')
    expect(r.stderr).toContain('call run(process.argv.slice(2))')
    expect(r.stdout).toBe('')
    // run directly, the same build prints its version and exits 0
    const direct = spawnSync(process.execPath, [DIST_CLI, '--version'], { encoding: 'utf8', env, windowsHide: true })
    expect(direct.status).toBe(0)
    expect(direct.stdout).toMatch(/\d+\.\d+\.\d+ \(engine /)
  })
})
