/**
 * The Verifiable-Verdict protocol seed: independent replay-binding (no engine) + Ed25519 signed envelope (verify a
 * verdict's outcome with only a public key). Together they make a verdict portable and tamper-evident to a counterparty.
 */
import { describe, it, expect } from 'vitest'
import { verifyDeclarative, verifyReplay, deriveVerdictId, generateSigningKeypair, signVerdict, verifyEnvelope } from '../src/index'
import type { DeclarativeRuleset } from '../src/declarative/types'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const NOW = () => new Date('2026-09-22T00:00:00Z')
const extraction = { subtotal: 100, tax: 10, total: 110 }
const mkVerdict = () => verifyDeclarative(extraction, ruleset, { now: NOW })
// declarative input_hash = hashOf({ extraction, ruleset }) — the inputs shape the replay check needs.
const inputs = { extraction, ruleset }

describe('verifyReplay — independent binding check (no engine)', () => {
  it('confirms a genuine verdict binds to its id, and to its inputs when supplied', () => {
    const v = mkVerdict()
    const r = verifyReplay(v)
    expect(r.id_ok).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.expected_verdict_id).toBe(v.verdict_id)

    const withInputs = verifyReplay(v, inputs)
    expect(withInputs.input_ok).toBe(true)
    expect(withInputs.ok).toBe(true)
  })

  it('deriveVerdictId reproduces the producer derivation exactly', () => {
    const v = mkVerdict()
    expect(deriveVerdictId(v.input_hash, v.ruleset, v.engine_version)).toBe(v.verdict_id)
  })

  it('catches a tampered verdict_id', () => {
    const v = { ...mkVerdict(), verdict_id: 'deadbeefdeadbeefdeadbeefdeadbeef' }
    const r = verifyReplay(v)
    expect(r.id_ok).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/does not derive/)
  })

  it('catches inputs that do not match the verdict', () => {
    const v = mkVerdict()
    const r = verifyReplay(v, { extraction: { subtotal: 1, tax: 1, total: 2 }, ruleset })
    expect(r.input_ok).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not for these inputs/)
  })
})

describe('signed envelope — portable, verifiable with only a public key', () => {
  it('round-trips: sign then verify with the embedded public key', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict(mkVerdict(), privateKeyPem)
    expect(env.alg).toBe('ed25519')
    const check = verifyEnvelope(env, inputs)
    expect(check.signature_ok).toBe(true)
    expect(check.replay?.ok).toBe(true)
    expect(check.ok).toBe(true)
  })

  it('catches an OUTCOME tamper the id-binding alone cannot', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict(mkVerdict(), privateKeyPem)
    // Flip the outcome after signing. The verdict_id still "derives" (replay.id_ok stays true) — but the signature breaks.
    const tampered = { ...env, verdict: { ...env.verdict, outcome: 'PASS' === env.verdict.outcome ? ('FAIL' as const) : ('PASS' as const) } }
    expect(verifyReplay(tampered.verdict).id_ok).toBe(true) // id-binding can't see the flip
    const check = verifyEnvelope(tampered)
    expect(check.signature_ok).toBe(false) // ...but the signature does
    expect(check.ok).toBe(false)
  })

  it('rejects a signature from the wrong key', () => {
    const a = generateSigningKeypair()
    const b = generateSigningKeypair()
    const env = signVerdict(mkVerdict(), a.privateKeyPem)
    const forged = { ...env, public_key: b.publicKeyPem } // claim a different signer
    expect(verifyEnvelope(forged).signature_ok).toBe(false)
  })
})
