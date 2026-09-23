import { describe, it, expect } from 'vitest'
import { createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { canonicalize, sha256, generateSigningKeypair } from 'riposte-verify'
import {
  openLedger, memoryStore, verifyChain, keyFingerprint, ledgerCli, publicOf, handleMcpRequest, rootedJsonReader,
  type LedgerEntry,
} from '../src/index.js'

const NOW = () => new Date('2026-09-23T00:00:00Z')
const owner = generateSigningKeypair()
const attacker = generateSigningKeypair()

function ownerLedger(n = 3) {
  const l = openLedger(memoryStore(), { signingKey: owner.privateKeyPem, now: NOW })
  for (let i = 0; i < n; i++) l.append('note', { n: i, paid: 100 * (i + 1) })
  return l
}

/** What a determined forger does: edit, recompute every hash from `from` on, and re-sign with THEIR key (or strip signatures). */
function forge(entries: LedgerEntry[], from: number, edit: (e: LedgerEntry) => void, signWith: string | null): LedgerEntry[] {
  const out = entries.map((e) => JSON.parse(JSON.stringify(e)) as LedgerEntry)
  for (let i = from; i < out.length; i++) {
    const e = out[i]!
    if (i === from) edit(e)
    e.prev_hash = i === 0 ? '0'.repeat(64) : out[i - 1]!.hash
    e.hash = sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }))
    if (signWith) {
      const key = createPrivateKey(signWith)
      e.signature = { alg: 'ed25519', public_key: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(), sig: edSign(null, Buffer.from(e.hash, 'utf8'), key).toString('base64') }
    } else delete e.signature
  }
  return out
}

describe('ledger trust anchors — what a hash chain alone cannot prove', () => {
  const ownerFp = keyFingerprint(owner.publicKeyPem)
  const attackerFp = keyFingerprint(attacker.publicKeyPem)

  it('an intact owner-signed chain verifies, and says who signed', () => {
    const c = ownerLedger().verify({ publicKey: owner.publicKeyPem, requireSigned: true })
    expect(c).toMatchObject({ ok: true, signed: 3, unsigned: 0, signers: [ownerFp] })
  })

  it('a WHOLE-file rewrite re-signed by someone else passes the bare chain check — but not a pinned key', () => {
    const forged = forge(ownerLedger().entries(), 0, (e) => { (e.body as { paid: number }).paid = 1 }, attacker.privateKeyPem)
    const bare = verifyChain(forged)
    expect(bare.ok).toBe(true) // the honest limit: internally consistent
    expect(bare.signers).toEqual([attackerFp]) // …but the signer is visible
    expect(verifyChain(forged, { publicKey: owner.publicKeyPem })).toMatchObject({ ok: false, broken_at: 0, reason: expect.stringMatching(/signed by key .* not the expected/) })
  })

  it('a partial rewrite re-signed by someone else shows up as mixed signers, and fails a pinned key where it starts', () => {
    const forged = forge(ownerLedger().entries(), 1, (e) => { (e.body as { paid: number }).paid = 1 }, attacker.privateKeyPem)
    expect(verifyChain(forged)).toMatchObject({ ok: true, signers: [ownerFp, attackerFp] })
    expect(verifyChain(forged, { publicKey: owner.publicKeyPem })).toMatchObject({ ok: false, broken_at: 1 })
  })

  it('stripped signatures: consistent without a policy; caught by requireSigned', () => {
    const forged = forge(ownerLedger().entries(), 0, () => {}, null)
    expect(verifyChain(forged)).toMatchObject({ ok: true, signed: 0, unsigned: 3 })
    expect(verifyChain(forged, { requireSigned: true })).toMatchObject({ ok: false, broken_at: 0, reason: expect.stringMatching(/not signed/) })
  })

  it('a head anchor: a chain that grew still contains it; a rewritten one does not', () => {
    const l = ownerLedger(2)
    const anchor = l.verify().head
    l.append('note', { n: 2 })
    expect(l.verify({ head: anchor }).ok).toBe(true)
    const forged = forge(l.entries(), 0, (e) => { (e.body as { paid: number }).paid = 1 }, owner.privateKeyPem) // even with the RIGHT key
    expect(verifyChain(forged, { head: anchor })).toMatchObject({ ok: false, reason: expect.stringMatching(/anchored hash .* is not in this chain/) })
  })

  it('a bad expected key is a failure, not a pass', () => {
    expect(verifyChain(ownerLedger().entries(), { publicKey: 'not a key' })).toMatchObject({ ok: false, reason: /could not be read/ })
  })
})

describe('riposte-ledger CLI', () => {
  const l = ownerLedger()
  const files: Record<string, string> = {
    'ledger.jsonl': l.entries().map((e) => JSON.stringify(e)).join('\n') + '\n',
    'forged.jsonl': forge(l.entries(), 0, (e) => { (e.body as { paid: number }).paid = 1 }, attacker.privateKeyPem).map((e) => JSON.stringify(e)).join('\n') + '\n',
    'owner.pub.pem': owner.publicKeyPem,
    'owner.key.pem': owner.privateKeyPem,
    'junk.jsonl': '{"seq":0}\nnot json\n',
  }
  const read = (p: string) => { const f = files[p]; if (f === undefined) throw new Error('ENOENT'); return f }

  it('verify: 0 ok · 1 broken · 3 usage; warns when no trust anchor is given', () => {
    const bare = ledgerCli(['verify', 'forged.jsonl'], read)
    expect(bare.code).toBe(0)
    expect(bare.err).toMatch(/no trust anchor given/)
    const pinned = ledgerCli(['verify', 'forged.jsonl', '--key', 'owner.pub.pem'], read)
    expect(pinned.code).toBe(1)
    expect(pinned.err).toMatch(/^BROKEN at entry 0: entry 0 is signed by key/)
    expect(ledgerCli(['verify', 'ledger.jsonl', '--key', 'owner.key.pem', '--require-signed'], read)).toMatchObject({ code: 0, err: expect.stringMatching(/^OK: 3 entries/) })
    expect(ledgerCli(['verify', 'ledger.jsonl', '--head', l.verify().head], read).code).toBe(0)
    expect(ledgerCli(['verify', 'junk.jsonl'], read)).toMatchObject({ code: 3, err: expect.stringMatching(/line 2 is not JSON/) })
    expect(ledgerCli(['verify'], read).code).toBe(3)
    expect(ledgerCli(['frobnicate', 'ledger.jsonl'], read).code).toBe(3)
  })

  it('summary and fingerprint (a private key yields the same fingerprint as its public key)', () => {
    const s = JSON.parse(ledgerCli(['summary', 'ledger.jsonl'], read).out)
    expect(s).toMatchObject({ entries: 3, kinds: { note: 3 }, chain_ok: true, signed: 3, signers: [keyFingerprint(owner.publicKeyPem)] })
    expect(JSON.parse(ledgerCli(['fingerprint', 'owner.key.pem'], read).out).fingerprint).toBe(keyFingerprint(owner.publicKeyPem))
    expect(publicOf(owner.publicKeyPem).fingerprint).toBe(keyFingerprint(owner.publicKeyPem))
  })
})

describe('MCP ledger_verify with a trust anchor', () => {
  it('passes the pinned key through', () => {
    const ledger = openLedger(memoryStore(forge(ownerLedger().entries(), 0, () => {}, attacker.privateKeyPem)), { now: NOW })
    const call = (args: unknown) => (handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ledger_verify', arguments: args } }, { ledger, read: rootedJsonReader('.') }) as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent
    expect(call({})).toMatchObject({ ok: true })
    expect(call({ public_key: owner.publicKeyPem })).toMatchObject({ ok: false, broken_at: 0 })
  })
})
