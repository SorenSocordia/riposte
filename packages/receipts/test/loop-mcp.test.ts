import { describe, it, expect } from 'vitest'
import { generateSigningKeypair } from 'riposte-verify'
import { handleMcpRequest, openLedger, memoryStore, rootedJsonReader, verifyLoopBundle, replayRoundInProcess, type LoopBundle } from '../src/index.js'

const NOW = () => new Date('2026-10-03T12:00:00Z')
type R = { structuredContent: Record<string, unknown>; isError: boolean; content: { text: string }[] }
const call = (args: unknown, deps: Parameters<typeof handleMcpRequest>[1]): R =>
  (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'loop_round', arguments: args } }, deps) as { result: R }).result

// 2026-10-06 (verify engine 0.6.0): a subject line is never vendor evidence, so the bill names its sender, from the
// vendor's own domain, as loop.test.ts's does
const INVOICE = 'From: ar@examplevendor.test\nSubject: Example Vendor invoice EV-10001\n\nPlease find our invoice EV-10001 against your order PO-70001:\n\n- 4 x WIDGET BOX @ USD 10.00 = USD 40.00\n- 2 x GADGET @ USD 25.00 = USD 50.00\n\nTotal due: USD 90.00\n'
const REC = 'PURCHASE ORDER (ERP)\nPO-70001 | Vendor: Example Vendor | Freight: not allowed\n1. Widget box | qty 4 | unit USD 10.00\n2. Gadget | qty 2 | unit USD 25.00\n\nGOODS RECEIPT (ERP) for PO-70001\n1. Widget box | received 4\n2. Gadget | received 2'
const PO = REC.slice(0, REC.indexOf('GOODS RECEIPT (ERP)'))
const GR = REC.slice(REC.indexOf('GOODS RECEIPT (ERP)'))

describe('MCP loop_round: the remedy arrives as the next instruction', () => {
  const { privateKeyPem, publicKeyPem } = generateSigningKeypair()
  const deps = () => ({ ledger: openLedger(memoryStore(), { signingKey: privateKeyPem, now: NOW }), read: rootedJsonReader('.'), now: NOW, loopSigningKey: privateKeyPem })

  it('open → instruction names the goods receipt → answer with it → CONVERGED-PASS; the bundle replays and the server ledger anchors it', async () => {
    const d = deps()
    const r1 = call({ task: 'ap', item_id: 'EV-10001', decision: 'approve', invoice: INVOICE, purchase_order: PO, goods_receipt: '', model: 'test-model-1',
      // engine 0.6.0: the books, known and empty, given when the loop opens, so the duplicate check runs
      history: [], structured_sources: { 'erp:EV-10001': REC }, supplied_from: { purchase_order: { source: 'erp', key: 'EV-10001' } } }, d)
    expect(r1.isError).toBe(false)
    expect(r1.content[0]!.text).toMatch(/^Round 1 of 3: not executed/)
    expect(r1.content[0]!.text).toMatch(/\[missing-operand\] goods_receipt/)
    const id = r1.structuredContent.loop_id as string
    expect(r1.content[0]!.text).toContain(`loop_id: ${id}`)
    const r2 = call({ loop_id: id, decision: 'approve', invoice: INVOICE, purchase_order: PO, goods_receipt: GR, model: 'test-model-1',
      supplied_from: { purchase_order: { source: 'erp', key: 'EV-10001' }, goods_receipt: { source: 'erp', key: 'EV-10001' } } }, d)
    expect(r2.content[0]!.text).toMatch(/^CONVERGED-PASS after 2 round\(s\)/)
    const bundle = r2.structuredContent.bundle as LoopBundle
    expect(bundle.rounds.map((r) => r.agent.model)).toEqual(['test-model-1', 'test-model-1'])
    expect(bundle.rounds[0]!.agent.evidence_tier).toBe('T0')
    const c = await verifyLoopBundle(bundle, { replayRound: replayRoundInProcess, policy: { publicKey: publicKeyPem, requireSigned: true } })
    expect(c.problems).toEqual([])
    const anchor = d.ledger.entries().at(-1)!
    expect(anchor.kind).toBe('loop.close')
    expect((anchor.body as { top_hash: string }).top_hash).toBe(bundle.top_hash)
    // the loop is closed: the id no longer answers
    expect(call({ loop_id: id, decision: 'hold', invoice: INVOICE, purchase_order: PO, goods_receipt: GR }, d).isError).toBe(true)
  })

  it('a declarative loop refuses an unquoted edit; decline closes; bad calls are tool errors', () => {
    const d = deps()
    const x = { invoice_number: 'A-1', issue_date: '2026-01-02', currency: 'EUR', amount_currency: 'EUR', line_extension_amount: 100, tax_exclusive_amount: 100, tax_amount: 20,
      tax_inclusive_amount: 120, payable_amount: 130, lines: [{ id: '1', invoiced_quantity: 1, price_amount: 100, line_extension_amount: 100 }], vat_breakdown: [{ category: 'S', rate: 20, taxable_amount: 100, tax_amount: 20, row: 1 }] }
    const source = { text: 'Amount due for payment EUR 130.00', quotes: [{ id: 'payable_amount', quote: '130.00' }] }
    const r1 = call({ task: 'declarative', item_id: 'A-1', ruleset: 'peppol-en16931@0.2.0', decision: 'accept', extraction: x, source }, d)
    expect(r1.content[0]!.text).toMatch(/\[recompute-with\] e-invoice PAYABLE \(payable_amount\)/)
    const r2 = call({ loop_id: r1.structuredContent.loop_id, decision: 'accept', extraction: { ...x, payable_amount: 120 }, source }, d)
    expect(r2.content[0]!.text).toMatch(/^HELD-FOR-HUMAN after 1 round\(s\): round 2 refused by the edit discipline \(payable_amount: its quote "130.00" does not read as 120\)/)
    const r3 = call({ task: 'declarative', item_id: 'A-1', ruleset: 'peppol-en16931@0.2.0', decision: 'accept', extraction: x, source }, d)
    expect(call({ loop_id: r3.structuredContent.loop_id, decline: true, reason: 'cannot re-read' }, d).content[0]!.text).toMatch(/^HELD-FOR-HUMAN after 1 round\(s\): the agent declined/)
    expect(call({ decision: 'accept' }, d).isError).toBe(true)
    expect(call({ loop_id: 'nope', decision: 'accept' }, d).isError).toBe(true)
    expect(call({ task: 'declarative', decision: 'accept', extraction: x, ruleset: 'no-such' }, d).isError).toBe(true)
  })
})
