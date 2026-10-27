/**
 * 2026-10-04: every receipts gate that reads a verdict reads OPEN (verify's gateStatusOpen). Today's AP engine and the
 * built-in invoice ruleset strike no field, so this file wraps verify's verifyInvoiceMatch and verify() to add a struck
 * load-bearing field (`struck`, `would_unlock`) when `ctl.strike` is on: the shape an engine 0.3.0 declarative verdict carries.
 * The loop_round case uses the real declarative engine, which does strike (a garbled payable). The AP cases are Distil Labs'
 * public AP benchmark (Apache-2.0), vendored in verify/data/real.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ctl = vi.hoisted(() => ({ strike: false }))
// by path, not by package name: the path is the same in this workshop and in the published tree (where the package is
// riposte-verify), and it is the module the 'verify' alias loads, so the mock applies to the code under test either way
vi.mock('../../verify/src/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../verify/src/index.ts')>()
  const strike = <V extends { outcome: string }>(v: V): V => (ctl.strike && v.outcome !== 'FAIL'
    ? { ...v, struck: [{ field: 'TOTAL', role: 'total', reason: 'suspect' }], would_unlock: [{ field: 'TOTAL', claims: ['document.TOTAL_CHECK'] }] }
    : v)
  return {
    ...real,
    verifyInvoiceMatch: ((...a: Parameters<typeof real.verifyInvoiceMatch>) => { const r = real.verifyInvoiceMatch(...a); return { ...r, verdict: strike(r.verdict) } }) as typeof real.verifyInvoiceMatch,
    verify: ((...a: Parameters<typeof real.verify>) => strike(real.verify(...a))) as typeof real.verify,
  }
})

const { apGate, gate, handleMcpRequest, openLedger, memoryStore } = await import('../src/index.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = new Map<string, string>(readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8')
  .trim().split('\n').map((l) => { const c = JSON.parse(l); return [c.id, c.input] }))
const APPROVE = cases.get('T003')! // gold: approve
const NOW = () => new Date('2026-10-04T06:00:00Z')
// the hosted gate is held back from the public tree with its tests; this case runs where its source is present
const HOSTED = existsSync(join(HERE, '..', 'src', 'hosted.ts'))
afterEach(() => { ctl.strike = false })

describe('the AP gate reads OPEN', () => {
  it('B3.1: a struck load-bearing field reads OPEN for every decision, never EXECUTE; without it the same documents pay', async () => {
    const { splitApLayout } = await import('../../verify/src/index.ts')
    // engine 0.6.0: history known and empty, so the paying side's duplicate check runs (without it, PASS-WITH-OPEN)
    const docs = { ...splitApLayout(APPROVE)!, history: [] }
    expect(apGate('approve', docs, { now: NOW })).toMatchObject({ action: 'EXECUTE', effect: 'PAY' })
    ctl.strike = true
    for (const d of ['approve', 'hold_quantity', 'hold']) {
      const g = apGate(d, docs, { now: NOW })
      expect(g).toMatchObject({ status: 'OPEN', action: 'REVIEW', effect: 'HUMAN_REVIEW' })
      expect(g.reason).toMatch(/^OPEN: TOTAL \(suspect\) is struck, so the verdict is neither PASS nor FAIL/)
    }
  })
})

describe('the systemone gate reads OPEN', () => {
  it('B3.3: an OPEN verdict abstains with holdOnOpen off, and the result names the reading', () => {
    const req = { state: 'Invoice INV-1001', model: 'test-model', questions: { decision: { type: 'choice' as const, instructions: 'Pay?', criteria: { pay: 'Pay', hold: 'Hold' } } } }
    const res = { model: 'm', answers: { decision: { type: 'choice' as const, choice: 'pay', probabilities: { pay: 0.95, hold: 0.05 } } } }
    const inv = { invoice_number: 'INV-1001', invoice_date: '2026-09-01', due_date: '2026-10-01', currency: 'USD', line_items: [{ description: 'Widget', quantity: 10, unit_price: 12.5, amount: 125 }], subtotal: 125, tax_rate: 0.08, tax: 10, total: 135 }
    const before = gate(req, res, { question: 'decision', allow: ['pay'] }, { extraction: inv, options: { now: NOW } })
    expect(before.outcome).toBe('PROCEED')
    expect(before.status).not.toBe('OPEN')
    ctl.strike = true
    const g = gate(req, res, { question: 'decision', allow: ['pay'] }, { extraction: inv, options: { now: NOW } })
    expect(g).toMatchObject({ outcome: 'INSUFFICIENT_DATA', status: 'OPEN' })
    expect(g.reasons.join('\n')).toMatch(/OPEN: TOTAL \(suspect\) is struck/)
  })
})

describe('the MCP and HTTP answers say OPEN', () => {
  it('B3.4: MCP ap_gate answers status OPEN with action REVIEW', () => {
    ctl.strike = true
    const deps = { ledger: openLedger(memoryStore(), { now: NOW }), read: () => null, now: NOW }
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ap_gate', arguments: { decision: 'approve', layout: APPROVE } } }, deps) as { result: { structuredContent: Record<string, unknown> } }
    expect(r.result.structuredContent).toMatchObject({ status: 'OPEN', action: 'REVIEW', effect: 'HUMAN_REVIEW' })
  })

  it.skipIf(!HOSTED)('B3.4: HTTP POST /v1/ap/gate answers status OPEN with action REVIEW', async () => {
    const { createApGateService, parseKeysFile, sha256Hex } = await import(/* @vite-ignore */ ['..', 'src', 'hosted.js'].join('/')) as typeof import('../src/hosted.js')
    ctl.strike = true
    const svc = createApGateService({
      keys: parseKeysFile({ keys: [{ id: 'k1', tenant: 'acme', sha256: sha256Hex('rpk_coh3') }] }),
      ledgerFor: () => openLedger(memoryStore(), { now: NOW }), log: () => undefined, now: NOW,
    })
    const r = svc.handle({ method: 'POST', path: '/v1/ap/gate', body: { decision: 'approve', layout: APPROVE }, headers: { 'x-api-key': 'rpk_coh3', 'idempotency-key': 'coh3-1' } })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'OPEN', action: 'REVIEW', effect: 'HUMAN_REVIEW' })
  })

  it('B3.4: MCP loop_round answers status OPEN for a garbled payable (the real declarative engine)', () => {
    const deps = { ledger: openLedger(memoryStore(), { now: NOW }), read: () => null, now: NOW }
    const extraction = { invoice_number: 'C-1', issue_date: '2026-01-02', currency: 'EUR', amount_currency: 'EUR', line_extension_amount: 100, tax_exclusive_amount: 100, tax_amount: 20,
      tax_inclusive_amount: 120, payable_amount: '4O0.00', lines: [{ id: '1', invoiced_quantity: 1, price_amount: 100, line_extension_amount: 100 }], vat_breakdown: [{ category: 'S', rate: 20, taxable_amount: 100, tax_amount: 20, row: 1 }] }
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'loop_round', arguments: { task: 'declarative', item_id: 'C-1', decision: 'accept', extraction, ruleset: 'peppol-en16931@0.2.0', source: { text: 'Amount due for payment EUR 4O0.00' } } } }, deps) as { result: { structuredContent: { verdict: Record<string, unknown>; instruction: { text: string } } } }
    expect(r.result.structuredContent.verdict).toMatchObject({ status: 'OPEN', action: 'REVIEW' })
    expect(r.result.structuredContent.instruction.text).toMatch(/\(gate: OPEN\)/)
  })
})
