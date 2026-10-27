/**
 * One fingerprint per key, and a chain answer that means the chain (2026-10-05; an outside engineer's
 * findings): the same key had two fingerprints, `riposte-ledger fingerprint` printing 16 hex of sha256(DER) and `verify replay`
 * pinning sha256 of the DER's base64 TEXT; `chain_ok` read false on an intact chain checked against the wrong key; and a file
 * cut at its tail with its head record deleted verified OK.
 */
import { describe, it, expect } from 'vitest'
import { createHash, createPublicKey } from 'node:crypto'
import { generateSigningKeypair, keyFingerprint as verifyKeyFingerprint, legacyKeyFingerprint } from 'riposte-verify'
import { keyFingerprint, shortKeyFingerprint, keyFingerprintOf, ledgerCli, openLedger, memoryStore, verifyChain, entryHash, type LedgerEntry } from '../src/index.js'

const alice = generateSigningKeypair()
const mallory = generateSigningKeypair()
const derSha = (pem: string): string => createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')

describe('one derivation: sha256 over the DER bytes, 64 hex, everywhere', () => {
  it('the ledger and replay compute the same full value; the short form is its first 16 characters', () => {
    expect(keyFingerprint(alice.publicKeyPem)).toBe(derSha(alice.publicKeyPem))
    expect(keyFingerprint(alice.publicKeyPem)).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyKeyFingerprint(alice.publicKeyPem)).toBe(keyFingerprint(alice.publicKeyPem))
    expect(shortKeyFingerprint(alice.publicKeyPem)).toBe(keyFingerprint(alice.publicKeyPem).slice(0, 16))
    expect(keyFingerprintOf(alice.publicKeyPem)).toBe(keyFingerprint(alice.publicKeyPem)) // a ruling's refusal names it the same way
    // the older form (sha256 of the base64 text) is a different value, read only where a pin or a stored record still uses it
    expect(legacyKeyFingerprint(alice.publicKeyPem)).not.toBe(keyFingerprint(alice.publicKeyPem))
  })

  it('riposte-ledger fingerprint prints the full value (a private key gives its public key\'s); --short adds 16 hex for display', () => {
    const files: Record<string, string> = { 'a.pub.pem': alice.publicKeyPem, 'a.pem': alice.privateKeyPem }
    const read = (p: string): string => { const f = files[p]; if (f === undefined) throw new Error('ENOENT'); return f }
    const full = ledgerCli(['fingerprint', 'a.pub.pem'], read)
    expect(full.code).toBe(0)
    expect(full.err).toBe(`fingerprint ${derSha(alice.publicKeyPem)}\n`)
    expect(JSON.parse(full.out).fingerprint).toBe(derSha(alice.publicKeyPem))
    expect(JSON.parse(ledgerCli(['fingerprint', 'a.pem'], read).out).fingerprint).toBe(derSha(alice.publicKeyPem))
    const short = ledgerCli(['fingerprint', 'a.pub.pem', '--short'], read)
    expect(short.err).toBe(`fingerprint ${derSha(alice.publicKeyPem)}\nshort ${derSha(alice.publicKeyPem).slice(0, 16)} (for display only: pin the full fingerprint)\n`)
    expect(JSON.parse(short.out)).toMatchObject({ fingerprint: derSha(alice.publicKeyPem), short: derSha(alice.publicKeyPem).slice(0, 16) })
    expect(ledgerCli(['fingerprint', 'a.pub.pem', '--bogus'], read).code).toBe(3)
  })
})

describe('chain_ok is the hash chain alone; the key and the anchor have their own fields', () => {
  const l = openLedger(memoryStore(), { signingKey: alice.privateKeyPem })
  for (let i = 0; i < 4; i++) l.append('note', { i })
  const entries = l.entries()

  it('intact, the right key: every answer true; no anchor field without a --head', () => {
    const c = verifyChain(entries, { publicKey: alice.publicKeyPem })
    expect(c).toMatchObject({ ok: true, chain_ok: true, signatures_ok: true, signers: [keyFingerprint(alice.publicKeyPem)] })
    expect('anchor_ok' in c).toBe(false)
  })
  it('intact, the wrong key: chain_ok true, signatures_ok false, the first failing entry named', () => {
    expect(verifyChain(entries, { publicKey: mallory.publicKeyPem })).toMatchObject({ ok: false, chain_ok: true, signatures_ok: false, broken_at: 0, signed: 4 })
  })
  it('intact, a --head not in it: chain_ok true, anchor_ok false; a --head in it: anchor_ok true', () => {
    expect(verifyChain(entries, { head: 'f'.repeat(64) })).toMatchObject({ ok: false, chain_ok: true, signatures_ok: true, anchor_ok: false })
    expect(verifyChain(entries, { head: entries[1]!.hash })).toMatchObject({ ok: true, anchor_ok: true })
  })
  it('an edited entry: chain_ok false at that entry; the signatures are still answered on their own', () => {
    const edited = entries.map((e) => ({ ...e })) as LedgerEntry[]
    edited[2] = { ...edited[2]!, body: { i: 99 } }
    expect(verifyChain(edited, { publicKey: alice.publicKeyPem })).toMatchObject({ ok: false, chain_ok: false, signatures_ok: true, broken_at: 2, head: entries[1]!.hash })
    // re-hashed after the edit (the chain re-linked by whoever edited it), the old signature no longer covers the new hash
    let prev = edited[1]!.hash
    for (let i = 2; i < edited.length; i++) { edited[i] = { ...edited[i]!, prev_hash: prev }; edited[i]!.hash = entryHash(edited[i]!); prev = edited[i]!.hash }
    expect(verifyChain(edited, { publicKey: alice.publicKeyPem })).toMatchObject({ ok: false, chain_ok: true, signatures_ok: false, broken_at: 2 })
  })
})
