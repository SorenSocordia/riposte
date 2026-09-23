import { describe, it, expect } from 'vitest'
import { generateSigningKeypair, canonicalize, sha256 } from 'riposte-verify'
import { checkDone, openLedger, verifyChain, memoryStore, type StateReader } from '../src/index.js'

const NOW = () => new Date('2026-09-23T00:00:00Z')

// A fake "real state": the form store the agent claims to have written to.
const store: Record<string, unknown> = {
  'payments.json': { 'INV-1042': { amount: 1935.5, status: 'scheduled', vendor: 'Aldine Janitorial' } },
}
const read: StateReader = (src) => { if (!(src in store)) throw new Error('ENOENT'); return store[src] }

describe('checkDone — completion claims checked against the real state', () => {
  it('PASS when every expectation holds', () => {
    const r = checkDone({ claim: 'Scheduled the payment for INV-1042', expectations: [
      { source: 'payments.json', path: 'INV-1042.amount', equals: 1935.5 },
      { source: 'payments.json', path: 'INV-1042.status', equals: 'scheduled' },
    ] }, read)
    expect(r.outcome).toBe('PASS')
    expect(r.observed['payments.json']).toMatch(/^[0-9a-f]{64}$/)
  })
  it('FAIL when the save silently never happened — the fabricated-"done" case', () => {
    const r = checkDone({ claim: 'Scheduled the payment for INV-2001', expectations: [{ source: 'payments.json', path: 'INV-2001.amount', equals: 500 }] }, read)
    expect(r.outcome).toBe('FAIL')
    expect(r.message).toMatch(/Not done: .*INV-2001.amount does not exist/)
  })
  it('FAIL when the value differs, showing what is actually there', () => {
    const r = checkDone({ claim: 'Paid 2000', expectations: [{ source: 'payments.json', path: 'INV-1042.amount', equals: 2000 }] }, read)
    expect(r.outcome).toBe('FAIL')
    expect(r.results[0]).toMatchObject({ expected: 2000, actual: 1935.5 })
  })
  it('ABSTAIN — never accepts a claim it could not check', () => {
    expect(checkDone({ claim: 'done!', expectations: [] }, read).outcome).toBe('ABSTAIN')
    expect(checkDone({ claim: 'wrote the file', expectations: [{ source: 'missing.json', path: '', exists: true }] }, read).outcome).toBe('ABSTAIN')
    expect(checkDone({ claim: 'vague', expectations: [{ source: 'payments.json', path: 'INV-1042' }] }, read).outcome).toBe('ABSTAIN')
  })
  it('exists / absent expectations', () => {
    expect(checkDone({ claim: 'removed draft', expectations: [{ source: 'payments.json', path: 'DRAFT-1', exists: false }] }, read).outcome).toBe('PASS')
    expect(checkDone({ claim: 'created INV-1042', expectations: [{ source: 'payments.json', path: 'INV-1042', exists: true }] }, read).outcome).toBe('PASS')
  })
})

describe('receipt ledger — append-only, hash-chained, signed', () => {
  it('verifies an intact signed chain; detects edit, deletion, and reorder', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const s = memoryStore()
    const L = openLedger(s, { signingKey: privateKeyPem, now: NOW })
    L.append('decision', { decided: 'approve', invoice: 'INV-1042' })
    L.append('done_check', { outcome: 'FAIL', claim: 'Scheduled INV-2001' })
    L.append('model_switch', { from: 'claude-sonnet-5', to: 'qwen3:4b' })
    expect(L.verify()).toMatchObject({ ok: true, length: 3 })

    const edited = L.entries().map((e) => structuredClone(e))
    ;(edited[1]!.body as { outcome: string }).outcome = 'PASS'
    expect(verifyChain(edited)).toMatchObject({ ok: false, broken_at: 1 })

    const deleted = L.entries().filter((_, i) => i !== 1)
    expect(verifyChain(deleted).ok).toBe(false)

    const reordered = [L.entries()[1]!, L.entries()[0]!, L.entries()[2]!]
    expect(verifyChain(reordered).ok).toBe(false)
  })
  it('a forger who edits the body AND recomputes the hash (but lacks the key) is caught by the signature', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const L = openLedger(memoryStore(), { signingKey: privateKeyPem, now: NOW })
    L.append('decision', { decided: 'hold_total' })
    const forged = L.entries().map((e) => structuredClone(e))
    ;(forged[0]!.body as { decided: string }).decided = 'approve'
    const e = forged[0]!
    e.hash = sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash })) // hash now consistent
    const check = verifyChain(forged)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/signature does not verify/)
  })
  it('an unsigned ledger still detects tampering by hash alone', () => {
    const L = openLedger(memoryStore(), { now: NOW })
    L.append('note', { text: 'a' })
    L.append('note', { text: 'b' })
    expect(L.verify().ok).toBe(true)
    const t = L.entries().map((x) => structuredClone(x))
    ;(t[0]!.body as { text: string }).text = 'z'
    expect(verifyChain(t)).toMatchObject({ ok: false, broken_at: 0 })
  })
})
