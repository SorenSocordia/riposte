/**
 * `riposte-ledger sign` and `riposte-ledger verify-signature` (2026-10-14; an engineer's request from a cold review, 2026-10-13: a
 * command that signs a verdict with a published issuer key). `sign` puts a verdict, or the verdict of a replay bundle, into the
 * engine's envelope shape { verdict, alg, public_key, signature } with an Ed25519 key, and prints the issuer fingerprint: sha256
 * over the public key's DER bytes, 64 hex, the value `riposte-ledger fingerprint` prints and `verify replay --trusted-key` pins.
 * `verify-signature` checks an envelope offline: the signature, and with --trusted-key, that the issuer is the one expected.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair, validateApInput, verifyBillMatch, replayBundle, verifyEnvelope } from 'riposte-verify'
import { ledgerCli, keyFingerprint } from '../src/index.js'

const bill = JSON.parse(readFileSync(fileURLToPath(new URL('../../verify/test/fixtures/ap-outside-review/01-clean.json', import.meta.url)), 'utf8'))
const checked = validateApInput(bill)
if (!checked.ok) throw new Error('fixture does not validate')
const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }
const result = verifyBillMatch(checked.input, { policy })
const proof = { verdict: result.verdict, inputs: { ap_structured: bill, policy } }

const issuer = generateSigningKeypair()
const other = generateSigningKeypair()
const fp = keyFingerprint(issuer.publicKeyPem)

const files: Record<string, string> = {
  'proof.json': JSON.stringify(proof, null, 2),
  'verdict.json': JSON.stringify(result.verdict, null, 2),
  'issuer.pem': issuer.privateKeyPem,
  'issuer.pub.pem': issuer.publicKeyPem,
  'other.pem': other.privateKeyPem,
  'other.pub.pem': other.publicKeyPem,
  'not-a-verdict.json': '{ "outcome": "PASS" }',
  'twice.json': '{ "verdict": { "verdict_id": "x", "outcome": "FAIL", "outcome": "PASS" } }',
}
const read = (p: string): string => { const f = files[p]; if (f === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }); return f }
const withFile = (name: string, text: string) => (p: string): string => (p === name ? text : read(p))

describe('riposte-ledger sign', () => {
  it('signs a replay bundle\'s verdict into the engine\'s envelope shape and prints the issuer fingerprint; the bundle replays with the key pinned', () => {
    const r = ledgerCli(['sign', 'proof.json', '--key', 'issuer.pem'], read)
    expect(r.code).toBe(0)
    const signed = JSON.parse(r.out)
    expect(Object.keys(signed)).toEqual(['verdict', 'inputs'])
    expect(signed.verdict).toMatchObject({ alg: 'ed25519', public_key: issuer.publicKeyPem, verdict: result.verdict })
    expect(typeof signed.verdict.signature).toBe('string')
    expect(signed.inputs).toEqual(proof.inputs)
    expect(r.err).toBe(`signed verdict ${result.verdict.verdict_id} · issuer fingerprint ${fp}\nthe fingerprint is published once, out of band; a replayer pins it with --trusted-key, and a fingerprint carried inside an envelope is never the pin\n`)
    expect(verifyEnvelope(signed.verdict).ok).toBe(true)
    const pinned = replayBundle(signed, 'p', { strict: true, isTrusted: (pem) => keyFingerprint(pem) === fp })
    expect(pinned).toMatchObject({ result: 'MATCH', signature_ok: true })
    expect(pinned.strict_problems ?? []).toEqual([])
    // another key pinned: the engine diverges at the signature
    expect(replayBundle(signed, 'p', { strict: true, isTrusted: (pem) => keyFingerprint(pem) === keyFingerprint(other.publicKeyPem) })).toMatchObject({ result: 'DIVERGED', first_difference: 'signature' })
  })

  it('signs a bare verdict into an envelope; the JSON on stdout is the envelope alone', () => {
    const r = ledgerCli(['sign', 'verdict.json', '--key', 'issuer.pem'], read)
    expect(r.code).toBe(0)
    const env = JSON.parse(r.out)
    expect(Object.keys(env)).toEqual(['verdict', 'alg', 'public_key', 'signature'])
    expect(env.verdict).toEqual(result.verdict)
    expect(verifyEnvelope(env).signature_ok).toBe(true)
    expect(r.err).toMatch(new RegExp(`^signed verdict ${result.verdict.verdict_id} · issuer fingerprint ${fp}\n`))
  })

  it('refuses: no key, a public key, a file that is not a verdict or bundle, an envelope already signed, a repeated key in the file', () => {
    expect(ledgerCli(['sign', 'proof.json'], read)).toMatchObject({ code: 3 })
    expect(ledgerCli(['sign', 'proof.json'], read).err).toMatch(/sign needs --key <private\.pem>/)
    const pub = ledgerCli(['sign', 'proof.json', '--key', 'issuer.pub.pem'], read)
    expect(pub.code).toBe(3)
    expect(pub.err).toMatch(/not a private key/)
    const nv = ledgerCli(['sign', 'not-a-verdict.json', '--key', 'issuer.pem'], read)
    expect(nv.code).toBe(3)
    expect(nv.err).toMatch(/not a verdict \(no verdict_id\) and not a replay bundle/)
    const once = JSON.parse(ledgerCli(['sign', 'verdict.json', '--key', 'issuer.pem'], read).out)
    const twice = ledgerCli(['sign', 'signed.json', '--key', 'other.pem'], withFile('signed.json', JSON.stringify(once)))
    expect(twice.code).toBe(3)
    expect(twice.err).toBe(`signed.json is already a signed envelope (issuer fingerprint ${fp}); a second signature is not a countersignature. Sign the verdict, not the envelope\n`)
    const dup = ledgerCli(['sign', 'twice.json', '--key', 'issuer.pem'], read)
    expect(dup.code).toBe(3)
    expect(dup.err).toMatch(/appears twice/)
    expect(ledgerCli(['sign', 'missing.json', '--key', 'issuer.pem'], read).code).toBe(3)
    expect(ledgerCli(['sign', 'proof.json', '--key', 'issuer.pem', '--out', 'x'], read).code).toBe(3)
  })
})

describe('riposte-ledger verify-signature', () => {
  const envelope = (): string => ledgerCli(['sign', 'verdict.json', '--key', 'issuer.pem'], read).out
  const bundle = (): string => ledgerCli(['sign', 'proof.json', '--key', 'issuer.pem'], read).out

  it('an envelope, or a bundle carrying one, verifies offline: exit 0, the issuer fingerprint on its own line', () => {
    for (const text of [envelope(), bundle()]) {
      const r = ledgerCli(['verify-signature', 'signed.json'], withFile('signed.json', text))
      expect(r.code).toBe(0)
      expect(JSON.parse(r.out)).toEqual({ ok: true, signature_ok: true, verdict_id: result.verdict.verdict_id, issuer_fingerprint: fp })
      expect(r.err).toBe(`OK: the signature verifies; issuer fingerprint ${fp}\nnote: this checks the signature, not the verdict: riposte-replay or verify replay re-performs it\n`)
    }
  })

  it('--trusted-key: a public key file or the 64-hex fingerprint; another issuer is exit 1 and says whose signature it is', () => {
    const t = withFile('signed.json', envelope())
    const ok = ledgerCli(['verify-signature', 'signed.json', '--trusted-key', 'issuer.pub.pem'], t)
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toEqual({ ok: true, signature_ok: true, verdict_id: result.verdict.verdict_id, issuer_fingerprint: fp, trusted: true })
    expect(ok.err).toMatch(/^OK: the signature verifies, by the trusted key; issuer fingerprint /)
    const hex = ledgerCli(['verify-signature', 'signed.json', '--trusted-key', fp], t)
    expect(hex.code).toBe(0)
    expect(JSON.parse(hex.out).trusted).toBe(true)
    const no = ledgerCli(['verify-signature', 'signed.json', '--trusted-key', 'other.pub.pem'], t)
    expect(no.code).toBe(1)
    expect(JSON.parse(no.out)).toMatchObject({ ok: false, signature_ok: true, issuer_fingerprint: fp, trusted: false })
    expect(no.err).toBe(`NOT VERIFIED: signed by ${fp}, which is not the trusted key (${keyFingerprint(other.publicKeyPem)}); the signature verifies, but it proves only that the holder of that other key issued the verdict\n`)
    expect(ledgerCli(['verify-signature', 'signed.json', '--trusted-key', 'issuer.pem'], t).code).toBe(3) // a private key is never a pin
    expect(ledgerCli(['verify-signature', 'signed.json', '--trusted-key', 'abc'], t).code).toBe(3)
  })

  it('one byte changed in the signed verdict: exit 1, the signature does not verify; an unsigned verdict or bundle is exit 1 too', () => {
    const text = envelope()
    const tampered = text.replace('"outcome": "PASS"', '"outcome": "FAIL"')
    expect(tampered).not.toBe(text)
    const r = ledgerCli(['verify-signature', 'signed.json'], withFile('signed.json', tampered))
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, signature_ok: false, issuer_fingerprint: fp })
    expect(r.err).toMatch(/^NOT VERIFIED: the signature does not verify: the verdict body was altered, or the key does not match\n/)
    // one byte in the signature itself
    const sig = JSON.parse(text).signature as string
    const flipped = text.replace(sig, (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1))
    expect(ledgerCli(['verify-signature', 'signed.json'], withFile('signed.json', flipped)).code).toBe(1)
    const un = ledgerCli(['verify-signature', 'proof.json'], read)
    expect(un.code).toBe(1)
    expect(un.err).toMatch(/^NOT VERIFIED: not signed: /)
    expect(ledgerCli(['verify-signature', 'twice.json'], read).code).toBe(3)
    expect(ledgerCli(['verify-signature', 'not-a-verdict.json'], read).code).toBe(3)
  })

  it('--help names both commands and the fingerprint\'s form', () => {
    const h = ledgerCli(['--help'], read)
    expect(h.err).toContain('riposte-ledger sign <verdict.json | proof.json> --key <private.pem>')
    expect(h.err).toContain('riposte-ledger verify-signature <envelope.json | proof.json> [--trusted-key <public.pem | 64-hex fingerprint>]')
    expect(h.err).toContain('published once')
  })
})
