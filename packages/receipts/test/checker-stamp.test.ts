/**
 * The checker stamp (2026-09-29): every decision receipt and every check on the ledger names the checker that wrote it and
 * its build, `checker: { id, version }`, so a calibration record can count each version on its own.
 *
 * Additive, and proven so against bytes written BEFORE the stamp existed: `fixtures/pre-checker-stamp-2026-09-29.json` holds
 * a signed decision receipt and a signed six-entry ledger (every kind of check this package writes), captured from the code
 * as it stood. They must keep verifying byte for byte, and the same calls today must write the same bodies plus one key.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair } from 'riposte-verify'
import {
  CHECKER_IDS, CHECKER_VERSION, buildReceipt, checkerStamp, gate, handleMcpRequest, memoryStore, openLedger, rootedJsonReader,
  rootedTextReader, signReceipt, stamped, stopHook, stopReceipt, verifyChain, verifyReceipt,
  type LedgerEntry, type SignedReceipt, type SystemOneRequest, type SystemOneResponse,
} from '../src/index.js'
import { FILES, INPUTS, readFixture } from './fixtures/stop-hook-cases.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OLD = JSON.parse(readFileSync(join(HERE, 'fixtures', 'pre-checker-stamp-2026-09-29.json'), 'utf8')) as { decision_receipt: SignedReceipt; ledger: LedgerEntry[]; head: string }

// the capture's inputs, exactly (tmp/ capture script of 2026-09-29, reproduced here)
const req: SystemOneRequest = {
  state: 'Invoice INV-1001 from Acme: 10 widgets at $12.50 and 3 gadgets at $40. Matches PO-77.',
  model: 'test-model',
  questions: { decision: { type: 'choice', instructions: 'What should AP do with this invoice?', criteria: { pay: 'Approve for payment', hold: 'Hold for review', return: 'Return to vendor' } } },
}
const res: SystemOneResponse = { model: 'test-model', answers: { decision: { type: 'choice', choice: 'pay', probabilities: { pay: 0.95, hold: 0.025, return: 0.025 } } } }
const NOW = () => new Date('2026-09-29T00:00:00Z')

function writeToday(signingKey: string): LedgerEntry[] {
  const root = mkdtempSync(join(tmpdir(), 'receipts-stamp-'))
  mkdirSync(join(root, 'forms'), { recursive: true })
  writeFileSync(join(root, 'forms', 'payments.json'), JSON.stringify({ 'INV-1042': { amount: 1935.5, status: 'scheduled' } }))
  writeFileSync(join(root, 'mixed.jsonl'), (FILES as Record<string, string>)['mixed.jsonl']!)
  let t = Date.parse('2026-09-29T00:00:00Z')
  const ledger = openLedger(memoryStore(), { signingKey, now: () => new Date((t += 1000)) })
  const deps = { ledger, read: rootedJsonReader(root), readText: rootedTextReader(root) }
  const call = (name: string, args: unknown) => handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, deps)
  call('check_done', { claim: 'Scheduled INV-1042', expectations: [{ source: 'forms/payments.json', path: 'INV-1042.status', equals: 'scheduled' }] })
  const t001 = JSON.parse(readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').split('\n')[0]!)
  call('ap_gate', { decision: 'approve', layout: t001.input })
  call('model_attest', { replies: [{ model: 'model-a' }, { model: 'model-b' }], declared: 'model-a' })
  call('check_claims', { transcript: 'mixed.jsonl' })
  call('check_claims', { transcript: 'mixed.jsonl', all_turns: true })
  // the Stop hook bin's write (src/claims-cli.ts)
  ledger.append('claims_check', stamped('claims_check', stopReceipt(stopHook((INPUTS as Record<string, string>).mixed!, readFixture, {}), 'block', false)))
  return ledger.entries()
}

describe('checker stamp: the version', () => {
  it('CHECKER_VERSION matches package.json: a receipt must name the exact build that wrote it', () => {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { version: string }
    expect(CHECKER_VERSION).toBe(pkg.version)
    expect(CHECKER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('one id per check', () => {
    expect(CHECKER_IDS).toEqual({
      decision: 'riposte.receipts.gate', claims_check: 'riposte.receipts.claims', done_check: 'riposte.receipts.done',
      ap_gate: 'riposte.receipts.ap-gate', model_attest: 'riposte.receipts.model-attest',
    })
  })
})

describe('checker stamp: receipts written before it still verify, byte for byte', () => {
  it('the old signed decision receipt (no checker)', () => {
    expect('checker' in OLD.decision_receipt.receipt).toBe(false)
    expect(verifyReceipt(OLD.decision_receipt, req)).toEqual({ ok: true, signature_ok: true, id_ok: true, request_ok: true })
  })
  it('the old signed ledger (no checker on any entry): chain, signatures, one signer, and the recorded head', () => {
    expect(OLD.ledger.map(e => e.kind)).toEqual(['done_check', 'ap_gate', 'model_attest', 'claims_check', 'claims_check', 'claims_check'])
    expect(OLD.ledger.some(e => 'checker' in (e.body as object))).toBe(false)
    const check = verifyChain(OLD.ledger, { publicKey: OLD.ledger[0]!.signature!.public_key, requireSigned: true, head: OLD.head })
    expect(check).toMatchObject({ ok: true, length: 6, head: OLD.head, signed: 6, unsigned: 0 })
  })
})

describe('checker stamp: what is written now', () => {
  const { privateKeyPem } = generateSigningKeypair()

  it('a decision receipt names the gate and its build; the id and signature cover it', () => {
    const r = buildReceipt({ request: req, response: res, gate: gate(req, res, { question: 'decision', allow: ['pay'] }), now: NOW })
    expect(r.checker).toEqual({ id: 'riposte.receipts.gate', version: CHECKER_VERSION })
    const { checker, ...rest } = r
    expect(checker).toBeDefined()
    // everything but the stamp (and the id that now binds it) is what the old code wrote for the same decision
    const { receipt_id: _a, ...was } = OLD.decision_receipt.receipt
    const { receipt_id: _b, ...now } = rest
    expect(now).toEqual(was)
    expect(r.receipt_id).not.toBe(OLD.decision_receipt.receipt.receipt_id)
    const signed = signReceipt(r, privateKeyPem)
    expect(verifyReceipt(signed, req).ok).toBe(true)
    const relabelled = { ...signed, receipt: { ...signed.receipt, checker: { id: 'riposte.receipts.gate', version: '9.9.9' } } }
    expect(verifyReceipt(relabelled)).toMatchObject({ ok: false, signature_ok: false, id_ok: false })
  })

  it('every check on the ledger names its checker; each body is the old body plus that one key', () => {
    const today = writeToday(privateKeyPem)
    expect(today.map(e => e.kind)).toEqual(OLD.ledger.map(e => e.kind))
    const ids = today.map(e => (e.body as { checker: { id: string } }).checker.id)
    expect(ids).toEqual(['riposte.receipts.done', 'riposte.receipts.ap-gate', 'riposte.receipts.model-attest', 'riposte.receipts.claims', 'riposte.receipts.claims', 'riposte.receipts.claims'])
    for (const [i, e] of today.entries()) {
      const { checker, ...body } = e.body as Record<string, unknown>
      expect(checker, `entry ${i}`).toEqual({ id: ids[i], version: CHECKER_VERSION })
      expect(body, `entry ${i}`).toEqual(OLD.ledger[i]!.body)
      expect(Object.keys(e.body as object), `entry ${i}`).toEqual([...Object.keys(OLD.ledger[i]!.body as object), 'checker'])
    }
    expect(verifyChain(today, { requireSigned: true })).toMatchObject({ ok: true, length: 6 })
  })

  it('a tool\'s answer is unchanged: the stamp goes on the ledger, not into the response', () => {
    const root = mkdtempSync(join(tmpdir(), 'receipts-stamp-'))
    writeFileSync(join(root, 'p.json'), JSON.stringify({ a: 1 }))
    const deps = { ledger: openLedger(memoryStore()), read: rootedJsonReader(root) }
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_done', arguments: { claim: 'a is 1', expectations: [{ source: 'p.json', path: 'a', equals: 1 }] } } }, deps) as { result: { structuredContent: Record<string, unknown> } }
    expect(r.result.structuredContent.outcome).toBe('PASS')
    expect('checker' in r.result.structuredContent).toBe(false)
    expect((deps.ledger.entries()[0]!.body as { checker: unknown }).checker).toEqual(checkerStamp('done_check'))
  })
})
