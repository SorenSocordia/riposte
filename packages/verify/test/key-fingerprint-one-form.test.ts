/**
 * One fingerprint per key (2026-10-05; an outside engineer's finding): `verify replay` printed and pinned
 * sha256 of the BASE64 TEXT of a key's DER, while `riposte-ledger fingerprint` printed 16 hex of sha256 over the DER bytes, so
 * one key had two fingerprints and REPLAY.md named neither derivation.
 *
 * Now every surface prints and pins sha256 over the DER bytes, 64 hex (the value `openssl pkey -pubin -outform DER | sha256sum`
 * gives). The older form is still accepted by `--trusted-key` for this release, with a note, and still read where a stored
 * record names a key by it (an arbitration move's signer); a prefix is never a pin.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createHash, createPublicKey } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../src/cli'
import { generateSigningKeypair, keyFingerprint, legacyKeyFingerprint, signVerdict, verify, KeyRegistry } from '../src/index'
import { partyByFingerprint, type PartiesFile } from '../src/arbitration/parties'
import { scratch, cleanScratch } from './helpers/scratch'

afterAll(() => cleanScratch())
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
const alice = generateSigningKeypair()
const mallory = generateSigningKeypair()
const der = (pem: string): Buffer => createPublicKey(pem).export({ type: 'spki', format: 'der' })

function go(argv: string[]): { code: number; out: string; err: string } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err }
}

describe('the derivation', () => {
  it('keyFingerprint is sha256 over the DER bytes, 64 hex; the older form is sha256 of their base64 text', () => {
    expect(keyFingerprint(alice.publicKeyPem)).toBe(createHash('sha256').update(der(alice.publicKeyPem)).digest('hex'))
    expect(legacyKeyFingerprint(alice.publicKeyPem)).toBe(createHash('sha256').update(der(alice.publicKeyPem).toString('base64')).digest('hex'))
    expect(keyFingerprint(alice.publicKeyPem)).not.toBe(legacyKeyFingerprint(alice.publicKeyPem))
    expect(keyFingerprint('not a key')).toBeUndefined()
    expect(legacyKeyFingerprint('not a key')).toBeUndefined()
  })
  it('the key registry keys its entries by it', () => {
    const r = new KeyRegistry([alice.publicKeyPem])
    expect(r.isRoot(alice.publicKeyPem)).toBe(true)
    expect(r.isRoot(mallory.publicKeyPem)).toBe(false)
  })
  it('an arbitration move naming its signer in either form finds the party (moves written before 2026-10-05 use the older form)', () => {
    const pf = { format: 'verify-parties/1', parties: [{ id: 'a', role: 'filer', public_key: alice.publicKeyPem }] } as unknown as PartiesFile
    expect(partyByFingerprint(pf, keyFingerprint(alice.publicKeyPem)!)?.id).toBe('a')
    expect(partyByFingerprint(pf, legacyKeyFingerprint(alice.publicKeyPem)!)?.id).toBe('a')
    expect(partyByFingerprint(pf, keyFingerprint(mallory.publicKeyPem)!)).toBeUndefined()
  })
})

describe('verify replay prints and pins it; the older form is still accepted, with a note', () => {
  const dir = scratch('fp-one-form')
  const ex = { invoice_number: 'INV-1', line_items: [{ description: 'C', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax_rate: 0, tax: 0, total: 1500 } }
  const exFile = join(dir, 'invoice.json')
  writeFileSync(exFile, JSON.stringify(ex))
  const envFile = join(dir, 'env.json')
  writeFileSync(envFile, JSON.stringify(signVerdict(verify(ex, { now: NOW }), alice.privateKeyPem)))
  const pubFile = join(dir, 'alice.pub.pem')
  writeFileSync(pubFile, alice.publicKeyPem)
  const FP = keyFingerprint(alice.publicKeyPem)!
  const OLD = legacyKeyFingerprint(alice.publicKeyPem)!

  it('unpinned: the signing key fingerprint is the full DER hash', () => {
    const r = go(['replay', envFile, '--extraction', exFile])
    expect(r.code).toBe(0)
    expect(r.err).toContain(`verify replay: signing key fingerprint ${FP} (to pin it: --trusted-key ${FP})`)
    expect(JSON.parse(r.out).envelope.key_fingerprint).toBe(FP)
  })
  it('pinned by the key file or by the fingerprint: VERIFIED, no note', () => {
    for (const pin of [pubFile, FP]) {
      const r = go(['replay', envFile, '--extraction', exFile, '--trusted-key', pin])
      expect(r.code, pin).toBe(0)
      expect(r.err).toContain(`signing key fingerprint ${FP} (the trusted key)`)
      expect(r.err).not.toContain('older fingerprint form')
      expect(JSON.parse(r.out).envelope).toMatchObject({ trusted: true })
      expect('older_fingerprint_form' in JSON.parse(r.out).envelope).toBe(false)
    }
  })
  it('pinned by the older form: VERIFIED for this release, with a note naming the fingerprint to pin instead', () => {
    const r = go(['replay', envFile, '--extraction', exFile, '--trusted-key', OLD])
    expect(r.code).toBe(0)
    expect(r.err).toContain(`verify replay: note: --trusted-key matched this key by the older fingerprint form (sha256 of the key's base64 text), which this release still accepts; pin ${FP} instead (sha256 over the key's DER bytes)`)
    expect(JSON.parse(r.out).envelope).toMatchObject({ trusted: true, older_fingerprint_form: true, key_fingerprint: FP })
  })
  it('another key pinned, in either form: FAILED; a prefix is refused (exit 3)', () => {
    for (const pin of [keyFingerprint(mallory.publicKeyPem)!, legacyKeyFingerprint(mallory.publicKeyPem)!]) expect(go(['replay', envFile, '--extraction', exFile, '--trusted-key', pin]).code).toBe(1)
    const p = go(['replay', envFile, '--extraction', exFile, '--trusted-key', FP.slice(0, 16)])
    expect(p.code).toBe(3)
    expect(p.err).toContain('a fingerprint prefix is not a pin (a key can be ground to match a short prefix)')
  })
  it('a folder replay matches the older form too, and says so once', () => {
    const folder = scratch('fp-one-form-folder')
    writeFileSync(join(folder, 'b.json'), JSON.stringify({ verdict: signVerdict(verify(ex, { now: NOW }), alice.privateKeyPem), inputs: { extraction: ex, references: { contract: null, evidence: [], history: [] }, source: null } }))
    const r = go(['replay', folder, '--trusted-key', OLD])
    expect(r.code).toBe(0)
    expect(r.err.match(/older fingerprint form/g)?.length).toBe(1)
  })
})
