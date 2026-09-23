/**
 * Signed Verdict envelope — the second half of the portable trust primitive, and the heart of the "Verifiable Verdict"
 * protocol. An Ed25519 signature over the canonical verdict lets ANY counterparty confirm, with only the signer's public
 * key (no rule engine, no shared secret), that:
 *   - the verdict BODY — including the outcome — is exactly what the signer issued (tamper-evident on the result itself,
 *     which the id-binding in ./replay.ts cannot catch on its own), and
 *   - (with the inputs) the verdict is bound to those inputs / ruleset / engine.
 *
 * Dependency-free: Ed25519 via node:crypto. HONEST BOUNDARY: verifying with the embedded public key proves the verdict
 * is untampered and signed by the holder of that key; binding that key to a real-world identity is the job of an
 * out-of-band anchor (a published key / a conformance registry — the trust mark). The protocol opens the format; the
 * registry + calibrated corpus stay owned (see docs/PROTOCOL-DIRECTION.md).
 */

import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from 'node:crypto'
import { canonicalize } from '../verdict/canonical.js'
import { verifyReplay, type ReplayCheck } from './replay.js'
import type { Verdict } from '../verdict/schema.js'

export interface SignedVerdict {
  verdict: Verdict
  alg: 'ed25519'
  /** SPKI PEM of the signer's public key. Anchor this to a real identity out of band. */
  public_key: string
  /** base64 Ed25519 signature over canonicalize(verdict). */
  signature: string
}

/** Generate an Ed25519 keypair (PEM). The private key signs verdicts; the public key travels in every envelope. */
export function generateSigningKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

export function signVerdict(verdict: Verdict, privateKeyPem: string): SignedVerdict {
  const key = createPrivateKey(privateKeyPem)
  const signature = edSign(null, Buffer.from(canonicalize(verdict), 'utf8'), key).toString('base64')
  const public_key = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString()
  return { verdict, alg: 'ed25519', public_key, signature }
}

export interface EnvelopeCheck {
  /** signature_ok AND (replay.ok when inputs were supplied). */
  ok: boolean
  /** The signature verifies against the embedded public key over the canonical verdict body. */
  signature_ok: boolean
  /** Present when inputs were supplied: the input-binding replay check (see ./replay.ts). */
  replay?: ReplayCheck
  reason?: string
}

export function verifyEnvelope(env: SignedVerdict, inputs?: unknown): EnvelopeCheck {
  if (env.alg !== 'ed25519') return { ok: false, signature_ok: false, reason: `unsupported alg: ${env.alg}` }
  let signature_ok = false
  try {
    const key = createPublicKey(env.public_key)
    signature_ok = edVerify(null, Buffer.from(canonicalize(env.verdict), 'utf8'), key, Buffer.from(env.signature, 'base64'))
  } catch (e) {
    return { ok: false, signature_ok: false, reason: `signature verification errored: ${(e as Error).message}` }
  }
  const out: EnvelopeCheck = { ok: signature_ok, signature_ok }
  if (!signature_ok) { out.reason = 'signature does not verify — the verdict body was altered, or the key does not match'; return out }
  if (inputs !== undefined) {
    const replay = verifyReplay(env.verdict, inputs)
    out.replay = replay
    out.ok = signature_ok && replay.ok
    if (!replay.ok) out.reason = replay.reason
  }
  return out
}
