/**
 * RFC 3161 time-stamp tokens over a checkpoint, verified offline (2026-09-28). The fixture was issued by a
 * throwaway OpenSSL TSA (RSA and EC signers under one root; private keys deleted) over checkpointDigest(body), and OpenSSL's
 * own `ts -verify` accepted both tokens: an independent oracle for what this verifier accepts.
 */
import { describe, it, expect } from 'vitest'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signCheckpoint, checkpointDigest, verifyCheckpointTimestamp, verifyTimestampToken, type CheckpointBody } from '../src/anchor/index'

const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'anchor', 'rfc3161-fixture.json'), 'utf8')) as {
  body: CheckpointBody; digest_hex: string; ca_cert_pem: string; other_tsa_cert_pem: string
  rsa: { tsa_cert_pem: string; token_b64: string }; ec: { tsa_cert_pem: string; token_b64: string }
}
const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from('77'.repeat(32), 'hex')])
const AUDITOR = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }).toString()
const cp = signCheckpoint(FX.body, AUDITOR)
const GEN_TIME = '2026-09-29T03:46:55.000Z' // OpenSSL `ts -reply -text`: "Time stamp: Sep 29 03:46:55 2026 GMT"

describe('RFC 3161: a TSA token over a checkpoint, checked offline', () => {
  it('the imprint a TSA stamps is checkpointDigest (the sha256 of exactly what the witness signed)', () => {
    expect(checkpointDigest(cp).toString('hex')).toBe(FX.digest_hex)
  })

  it('RSA and EC tokens verify against their pinned TSA certificate, with the TSA\'s time', () => {
    for (const t of [FX.rsa, FX.ec]) {
      expect(verifyCheckpointTimestamp(cp, t.token_b64, { tsa_certs: [t.tsa_cert_pem] })).toMatchObject({ ok: true, gen_time: GEN_TIME, via: 'pinned', policy: '1.2.3.4.1' })
    }
  })

  it('or against the root that issued the embedded TSA certificate', () => {
    expect(verifyCheckpointTimestamp(cp, FX.rsa.token_b64, { tsa_roots: [FX.ca_cert_pem] })).toMatchObject({ ok: true, via: 'root' })
  })

  it('an untrusted TSA is refused: another pinned TSA, another root, or no trust at all', () => {
    for (const trust of [{ tsa_certs: [FX.other_tsa_cert_pem] }, { tsa_roots: [FX.other_tsa_cert_pem] }, {}]) {
      expect(verifyCheckpointTimestamp(cp, FX.rsa.token_b64, trust)).toMatchObject({ ok: false, reason: expect.stringMatching(/is not trusted/) })
    }
  })

  it('a token is not a time-stamp of any other checkpoint', () => {
    const other = signCheckpoint({ ...FX.body, length: 9 }, AUDITOR)
    expect(verifyCheckpointTimestamp(other, FX.rsa.token_b64, { tsa_certs: [FX.rsa.tsa_cert_pem] })).toMatchObject({ ok: false, reason: expect.stringMatching(/stamps a different digest/) })
  })

  it('an altered token is refused: the stamped time, the signature, or the bytes', () => {
    const tok = Buffer.from(FX.rsa.token_b64, 'base64')
    const at = tok.indexOf('20260929034655Z', 0, 'latin1')
    expect(at).toBeGreaterThan(0)
    const retimed = Buffer.from(tok); retimed[at + 3] = '5'.charCodeAt(0) // 2026 → 2025
    expect(verifyTimestampToken(retimed, checkpointDigest(cp), { tsa_certs: [FX.rsa.tsa_cert_pem] })).toMatchObject({ ok: false, reason: expect.stringMatching(/messageDigest does not match/) })
    const resigned = Buffer.from(tok); resigned[resigned.length - 1] ^= 0x01
    expect(verifyTimestampToken(resigned, checkpointDigest(cp), { tsa_certs: [FX.rsa.tsa_cert_pem] })).toMatchObject({ ok: false, reason: expect.stringMatching(/signature does not verify/) })
    expect(verifyTimestampToken(tok.subarray(0, 200), checkpointDigest(cp), { tsa_certs: [FX.rsa.tsa_cert_pem] })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not parse/) })
    expect(verifyTimestampToken('not a token', checkpointDigest(cp), {})).toMatchObject({ ok: false })
  })
})
