/**
 * 2026-10-05, the replay wording: what a replay tells the person who runs it.
 *   1. The VERIFIED line names the rule version that decided the outcome (ruleset id@version) beside the engine.
 *   2. A verdict with no issued_at is named without --strict too, on one verdict and in a folder; --strict still fails it.
 *   3. On a replayed AP proof, the scope's "This is a check, not a decision." reads as the AP sentence, because the gate's
 *      APPROVE or HOLD line is printed above it. Other verdicts keep the line. No verdict's bytes change.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitApLayout, verifyInvoiceMatch } from '../src/index'
import { run, type CliIO } from '../src/cli'
import { ISSUED_AT_MISSING, AP_REPLAY_SCOPE } from '../src/protocol/replay-case'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
afterAll(() => cleanScratch())

function cap(): CliIO & { o: () => string; e: () => string } {
  let o = '', e = ''
  return { out: s => { o += s }, err: s => { e += s }, o: () => o, e: () => e }
}

/** The README's engineer example: an invoice verdict and its extraction, written to a scratch folder. */
function invoiceVerdict(): { dir: string; invoice: string; verdict: string; v: Record<string, unknown> } {
  const dir = scratch('r5-docs-')
  const invoice = join(dir, 'invoice.json')
  writeFileSync(invoice, JSON.stringify({ invoice_number: 'INV-1001', line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }, { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 250.5 }], totals: { subtotal: 1750.5, tax_rate: 0.0825, tax: 144.42, total: 1894.92 } }))
  const io = cap()
  expect(run([invoice], io)).toBe(2) // PASS-WITH-OPEN, as the README says
  const verdict = join(dir, 'verdict.json')
  writeFileSync(verdict, io.o())
  return { dir, invoice, verdict, v: JSON.parse(io.o()) as Record<string, unknown> }
}

describe('1. the VERIFIED line names the ruleset id and version', () => {
  it('an invoice verdict: "re-performed with verify:invoice (ruleset invoice@<version>, engine <engine>)"', () => {
    const { invoice, verdict, v } = invoiceVerdict()
    const rs = v.ruleset as { id: string; version: string }
    const io = cap()
    expect(run(['replay', verdict, '--extraction', invoice], io)).toBe(0)
    const first = io.e().split('\n')[0]!
    expect(first).toContain(`(ruleset ${rs.id}@${rs.version}, engine ${String(v.engine_version)}) and byte-identical, issued_at aside.`)
    expect(first).toMatch(/^verify replay: outcome VERIFIED: re-performed with /)
  })
})

describe('2. a missing issued_at is named without --strict', () => {
  it('one verdict: exit 0, and the first line says the verdict carries no issued_at; --strict fails it, exit 1', () => {
    const { dir, invoice, v } = invoiceVerdict()
    const { issued_at: _drop, ...noTime } = v
    const f = join(dir, 'no-issued-at.json')
    writeFileSync(f, JSON.stringify(noTime, null, 2))
    const io = cap()
    expect(run(['replay', f, '--extraction', invoice], io)).toBe(0)
    const first = io.e().split('\n')[0]!
    expect(first).toContain(`and byte-identical; ${ISSUED_AT_MISSING}.`)
    expect(first).not.toContain('issued_at aside')
    const strict = cap()
    expect(run(['replay', f, '--extraction', invoice, '--strict'], strict)).toBe(1)
    expect(strict.e()).toContain('issued_at is missing: every verdict records when it was issued')
  })

  it('a folder: the MATCH line is followed by the note; under --strict the STRICT line says it instead, once', () => {
    const d = scratch('r5-docs-folder-')
    const ap = { ...splitApLayout(apCase('T003'))!, history: [] }
    const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }
    const { verdict } = verifyInvoiceMatch(ap, { policy, now: () => new Date('2026-10-05T00:00:00.000Z') })
    const { issued_at: _drop, ...noTime } = verdict as unknown as Record<string, unknown>
    const folder = join(d, 'bundles')
    mkdirSync(folder)
    writeFileSync(join(folder, 'no-time.json'), JSON.stringify({ verdict: noTime, inputs: { ap, policy } }))
    const io = cap()
    expect(run(['replay', folder], io)).toBe(0)
    expect(io.e()).toMatch(/MATCH\s+no-time\.json[^\n]*\n {4}the verdict carries no issued_at/)
    const strict = cap()
    expect(run(['replay', folder, '--strict'], strict)).toBe(1)
    expect(strict.e()).toContain('STRICT: issued_at is missing')
    expect(strict.e()).not.toContain(ISSUED_AT_MISSING)
  })
})

describe('3. a replayed AP proof relates the check to the gate\'s decision', () => {
  it('an AP bundle: the AP sentence replaces "This is a check, not a decision."; an invoice verdict keeps it', () => {
    const d = scratch('r5-docs-ap-')
    const ap = { ...splitApLayout(apCase('T003'))!, history: [] }
    const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }
    const { verdict } = verifyInvoiceMatch(ap, { policy, now: () => new Date('2026-10-05T00:00:00.000Z') })
    const f = join(d, 'ap-bundle.json')
    writeFileSync(f, JSON.stringify({ verdict, inputs: { ap, policy } }))
    const io = cap()
    expect(run(['replay', f], io)).toBe(0)
    const err = io.e()
    expect(err).toContain('APPROVE (gate: the check pays)')
    expect(err).toContain(AP_REPLAY_SCOPE)
    expect(err).not.toContain('This is a check, not a decision.')
    // the verdict's own scope block is unchanged (it is hashed)
    expect((verdict as unknown as { scope?: { statements: string[] } }).scope?.statements).toContain('this is a check, not a decision')

    const { invoice, verdict: inv } = invoiceVerdict()
    const plain = cap()
    expect(run(['replay', inv, '--extraction', invoice], plain)).toBe(0)
    expect(plain.e()).toContain('This is a check, not a decision.')
    expect(plain.e()).not.toContain(AP_REPLAY_SCOPE)
  })
})

/** A case of Distil Labs' public AP benchmark (Apache-2.0), vendored in data/real. */
function apCase(id: string): string {
  const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
    .map(l => JSON.parse(l) as { id: string; input: string })
  return cases.find(c => c.id === id)!.input
}
