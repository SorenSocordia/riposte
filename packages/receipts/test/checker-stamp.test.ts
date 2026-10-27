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
  rootedTextReader, signReceipt, stamped, stopHook, stopReceipt, verifyChain, verifyReceipt, readCheckOutcome, readGateOutcome,
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

// 2026-10-06: can't tell is written INSUFFICIENT_DATA where this capture wrote ABSTAIN (an --all-turns audit's `outcomes` key, and
// any `outcome` value). The one rename, applied to an old body before it is compared with what is written today.
const renamed = <T>(x: T): T => JSON.parse(JSON.stringify(x), (k, v: unknown) => {
  if (k === 'outcome' && v === 'ABSTAIN') return 'INSUFFICIENT_DATA'
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'ABSTAIN' in v) return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk === 'ABSTAIN' ? 'INSUFFICIENT_DATA' : kk, vv]))
  return v
}) as T

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
  // store_documents: the receipt shape this capture pinned (summary + proof). Since 2026-10-03 the default is hashes
  // only, a different body (test/hosted-r2.test.ts and test/ledger-file.test.ts cover it); the opt-in keeps this one.
  call('ap_gate', { decision: 'approve', layout: t001.input, store_documents: true })
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
      pay_app_check: 'riposte.receipts.pay-app', // the shadow pilot's pay applications (2026-10-05)
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
  it('an old body that says ABSTAIN still verifies, and reads as INSUFFICIENT_DATA', () => {
    const audit = OLD.ledger[4]!.body as { all_turns?: boolean; outcomes: Record<string, number> }
    expect(audit.all_turns).toBe(true)
    expect(Object.keys(audit.outcomes)).toEqual(['PASS', 'FAIL', 'ABSTAIN'])
    expect(renamed(audit).outcomes).toEqual({ PASS: audit.outcomes.PASS, FAIL: audit.outcomes.FAIL, INSUFFICIENT_DATA: audit.outcomes.ABSTAIN })
    expect([readCheckOutcome('ABSTAIN'), readGateOutcome('ABSTAIN'), readCheckOutcome('PASS'), readGateOutcome('HOLD'), readCheckOutcome('maybe')]).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'PASS', 'HOLD', undefined])
    expect(verifyChain(OLD.ledger, { publicKey: OLD.ledger[0]!.signature!.public_key, head: OLD.head }).ok).toBe(true)
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
      // The AP check moved to ruleset ap-threeway 0.2.0 (the line recompute, 2026-09-29) after this capture. A verdict id binds
      // its ruleset version, so the ap_gate entry's verdict_id is the one value that moves: identity only, the decision and
      // the drafted letter are the same.
      const old = renamed(OLD.ledger[i]!.body as Record<string, unknown>)
      // Repinned 2026-10-03: engine 0.1.0 issued cd1f3241… where 0.0.1 issued 402cf106…. Repinned again 2026-10-03 16:22: engine 0.2.0 (remedy_table_hash enters the identity) issues 8de08514…; engine 0.3.0 (2026-10-03 19:20) issues 8caa3877…; engine 0.4.0 (2026-10-04 00:27) issues 6a2806a3…; identity only (engine_version, verdict_id).
      // release-pass 2026-10-04: engine 0.5.0 issues 71af8a10… where engine 0.4.0 issued 6a2806a3…; identity only (verdict.verdict_id, verdict.engine_version, verdict.scope.engine_version). The engine moved to 0.5.0.
      // Repinned by hand 2026-10-05: engine 0.6.0 issues d44d6a5c… where 0.5.0 issued 71af8a10…. NOT identity-only, by
      // design: an AP verdict issued with no payment history now carries an INSUFFICIENT_DATA ap.duplicate claim first (fail-closed:
      // no duplicate check, no auto-pay; the gate reads it as PASS-WITH-OPEN), so the claims list moved. The release command refused
      // the automatic repin, correctly; the move is recorded with this reason in products/identity-pins.json.
      // Repinned by hand 2026-10-05 (AP engine): engine 0.6.0 issues 0d6f43eb… where it issued d44d6a5c…. The 0.6.0 AP
      // remedy table gained the PO balance check's remedies (its hash, and so every 0.6.0 AP verdict id, moved), and under 0.6.0
      // the price and total claims' explanations are reworded; no outcome, value or decision moved, and this case carries no
      // payment history, so no balance claim was added. Not identity-only by the registry's rule; recorded in identity-pins.json.
      // Repinned by hand later on 2026-10-05 (AP engine): engine 0.6.0 issues 768b5c8f… where it issued 0d6f43eb…. The 0.6.0 AP
      // remedy table gained the vendor and tax checks' remedies (its hash, and so every 0.6.0 AP verdict id, moved), and this case
      // gained the vendor check's claim (ap.vendor PASS: the invoice names the PO's vendor), so the claims list and coverage moved.
      // No outcome of an existing claim, no reason and no decision moved; this bill carries no tax field, so no tax claim was added.
      // Not identity-only by the registry's rule; recorded in identity-pins.json.
      // Repinned by hand 2026-10-06 (AP engine): engine 0.6.0 issues d24a1597… where it issued 768b5c8f…. The 0.6.0 AP
      // remedy table gained the payment-details and billed-to-date checks' remedies (its hash, and so every 0.6.0 AP verdict id,
      // moved), and the vendor check now reads the sender's address first (this case's ap.vendor PASS cites line 8, not the subject
      // line); no outcome, other claim, reason or decision moved. Not identity-only by the registry's rule; recorded in identity-pins.json.
      // release-pass 2026-10-13: engine 0.7.0 issues 2eed82d8… where engine 0.6.0 issued d24a1597…; identity only (verdict.verdict_id, verdict.engine_version, verdict.scope.engine_version). the emailed-bill path reads the sender from the address, payment-instruction sentences, partial bills and tax lines; approves name their path; near-number duplicates say similar, not same
      // release-pass 2026-10-13: engine 0.7.1 issues 3cdb648a… where engine 0.7.0 issued 2eed82d8…; identity only (verdict.verdict_id, verdict.engine_version, verdict.scope.engine_version). legal@0.5.3 is the default legal rule: a separate opinion's designation with a join clause, a view stated across sentences, the opinion's own quotations, running headers and citation clauses are read; a replay names the keys it does not check, the HTTP service refuses a request with no Host header, the ledger names a torn tail, invoice explanations are in words, and a sender domain with two letters swapped goes to a person
      // 2026-10-14: engine 0.7.2 issues 2407dbc1… where engine 0.7.1 issued 3cdb648a…: the engine label (identity only: verdict_id, engine_version, scope.engine_version; a340cef9… under ap-threeway@0.2.0) and the accounts-payable default moving to ap-threeway@0.3.0 (ruleset.version, scope.ruleset); every claim and the decision unchanged.
      if (e.kind === 'ap_gate') expect([old.verdict_id, body.verdict_id]).toEqual(['394880b67362cf8c30ff9f8efb742250', '2407dbc1a6e80a0bb2c63f2ee1f54e65'])
      // Typed remedies (2026-10-02) add two keys to the ap_gate receipt, and nothing else moves: `remedies` (what would
      // lawfully clear the hold) and `proof` (the verdict and its inputs, so riposte-replay re-performs it from the ledger).
      // The gate reading (2026-10-03) adds `status` after checker_decision: PASS, PASS-WITH-OPEN, FAIL or INSUFFICIENT_DATA.
      // The model-switch monitor (2026-10-03) adds `evidence_tier` and `evidence_note` to the model_attest receipt, at the end.
      const { remedies, proof, status, evidence_tier, evidence_note, ...was } = body as Record<string, unknown>
      if (e.kind === 'model_attest') expect([evidence_tier, typeof evidence_note], `entry ${i} evidence tier`).toEqual(['T1', 'string'])
      else expect([evidence_tier, evidence_note]).toEqual([undefined, undefined])
      if (e.kind === 'ap_gate') {
        expect(Array.isArray(remedies) && remedies.length > 0, `entry ${i} remedies`).toBe(true)
        expect((proof as { verdict: { verdict_id: string } }).verdict.verdict_id).toBe(body.verdict_id)
        expect(status, `entry ${i} status`).toBe('FAIL')
      } else expect([remedies, proof, status]).toEqual([undefined, undefined, undefined])
      expect(was, `entry ${i}`).toEqual(e.kind === 'ap_gate' ? { ...old, verdict_id: body.verdict_id } : old)
      const oldKeys = Object.keys(OLD.ledger[i]!.body as object)
      const at = oldKeys.indexOf('verdict_id') + 1
      const cd = oldKeys.indexOf('checker_decision') + 1
      expect(Object.keys(e.body as object), `entry ${i}`).toEqual(e.kind === 'ap_gate'
        ? [...oldKeys.slice(0, cd), 'status', ...oldKeys.slice(cd, at), 'remedies', ...oldKeys.slice(at), 'proof', 'checker']
        : e.kind === 'model_attest' ? [...oldKeys, 'evidence_tier', 'evidence_note', 'checker'] : [...oldKeys, 'checker'])
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
