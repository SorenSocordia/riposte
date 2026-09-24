import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { generateSigningKeypair } from 'riposte-verify'
import { handleMcpRequest, rootedJsonReader, openLedger, memoryStore, fileStore, verifyChain } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'receipts-'))
mkdirSync(join(root, 'forms'), { recursive: true })
writeFileSync(join(root, 'forms', 'payments.json'), JSON.stringify({ 'INV-1042': { amount: 1935.5, status: 'scheduled' } }))
const NOW = () => new Date('2026-09-23T00:00:00Z')

const call = (name: string, args: unknown, deps: Parameters<typeof handleMcpRequest>[1]) =>
  (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, deps) as { result: { structuredContent: Record<string, unknown>; isError: boolean; content: { text: string }[] } }).result

describe('Receipts MCP server', () => {
  const { privateKeyPem } = generateSigningKeypair()
  const deps = { ledger: openLedger(memoryStore(), { signingKey: privateKeyPem, now: NOW }), read: rootedJsonReader(root) }

  it('initializes and lists its tools', () => {
    const init = handleMcpRequest({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, deps) as { result: { serverInfo: { name: string } } }
    expect(init.result.serverInfo.name).toBe('receipts')
    const list = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, deps) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toEqual(['check_done', 'ap_gate', 'model_attest', 'check_claims', 'ledger_verify'])
  })

  it('check_done: a true claim PASSes and is receipted (signed)', () => {
    const r = call('check_done', { claim: 'Scheduled INV-1042', expectations: [{ source: 'forms/payments.json', path: 'INV-1042.status', equals: 'scheduled' }] }, deps)
    expect(r.structuredContent.outcome).toBe('PASS')
    expect(r.structuredContent.receipt).toMatchObject({ seq: 0, signed: true })
  })

  it('check_done: a fabricated "done" FAILs with what is actually there', () => {
    const r = call('check_done', { claim: 'Scheduled INV-2001', expectations: [{ source: 'forms/payments.json', path: 'INV-2001.amount', equals: 500 }] }, deps)
    expect(r.structuredContent.outcome).toBe('FAIL')
    expect(String(r.structuredContent.message)).toMatch(/Not done/)
  })

  it('check_done: cannot read outside the workspace root (path escape and absolute paths refused -> ABSTAIN)', () => {
    const esc = call('check_done', { claim: 'x', expectations: [{ source: '../../etc/passwd', path: '', exists: true }] }, deps)
    expect(esc.structuredContent.outcome).toBe('ABSTAIN')
    expect(JSON.stringify(esc.structuredContent)).toMatch(/escapes the workspace root/)
    const abs = call('check_done', { claim: 'x', expectations: [{ source: 'C:/Windows/win.ini', path: '', exists: true }] }, deps)
    expect(abs.structuredContent.outcome).toBe('ABSTAIN')
  })

  it('ap_gate: disagreement goes to REVIEW with the reason, and is receipted', () => {
    const cases = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').split('\n')
    const t001 = JSON.parse(cases[0]!)
    const r = call('ap_gate', { decision: 'approve', layout: t001.input }, deps)
    expect(r.structuredContent).toMatchObject({ action: 'REVIEW', checker_decision: 'hold_quantity' })
    // the draft rides along: a vendor query with a short-pay figure, every number a recorded fact
    expect(r.structuredContent.resolution).toMatchObject({ kind: 'vendor_query', short_pay: { withheld: 22.35, payable_now: 1913.15 } })
    expect(String((r.structuredContent.resolution as { body: string }).body)).toMatch(/credit memo for the 3 unit\(s\) not delivered/)
  })

  it('ledger_verify: the whole chain of everything above verifies; bad args return a tool error, not a crash', () => {
    expect(call('ledger_verify', {}, deps).structuredContent).toMatchObject({ ok: true })
    const bad = call('check_done', { claim: 'x' }, deps)
    expect(bad.isError).toBe(true)
  })

  it('file-backed ledger persists and re-verifies across restarts', () => {
    const path = join(root, 'receipts.jsonl')
    const a = openLedger(fileStore(path), { now: NOW })
    a.append('note', { n: 1 })
    a.append('note', { n: 2 })
    const b = openLedger(fileStore(path), { now: NOW }) // "restart"
    b.append('note', { n: 3 })
    expect(verifyChain(b.entries())).toMatchObject({ ok: true, length: 3 })
  })
})
