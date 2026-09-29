/**
 * Shared fixtures for the book-aware opinion, tenant-scope and statute tests (opinion lane, 2026-09-28): deterministic
 * Ed25519 keys (a fixed seed → the same key every run), a tiny lint-clean policy so promotions and demotions happen within
 * a few dozen reviews (◇ illustrative only), and a signed GRANT helper.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { makeGrant, signDecision, type GrantDecision, type SignedDecision, type TrustedKeys } from '../../src/ledger/index'
import { policyRef, type PromotionPolicy, type VoiceLevel } from '../../src/verdict/voice'

export function keyFromSeed(seedHex: string): { privateKeyPem: string; publicKeyPem: string } {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')])
  const k = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return { privateKeyPem: k.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}

export const OWNER = keyFromSeed('11'.repeat(32))
export const LEAD = keyFromSeed('22'.repeat(32))
export const AGENT = keyFromSeed('33'.repeat(32))
export const GLOBEX = keyFromSeed('44'.repeat(32))
export const TRUSTED: TrustedKeys = { owner: OWNER.publicKeyPem, 'ap-lead': LEAD.publicKeyPem, 'globex-controller': GLOBEX.publicKeyPem }

/** ◇ illustrative: advise 3 / gate 5 / autonomy 8 reviews at 90%. */
export const TINY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'tiny-test', version: '1.0.0', method: 'wilson',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}

export function grant(workflow_id: string, level: VoiceLevel, o: { signer?: string; key?: string; policy?: PromotionPolicy; bounds?: string; at?: string } = {}): SignedDecision<GrantDecision> {
  const d = makeGrant({
    workflow_id, level, consequence_tier: 'low', policy: policyRef(o.policy ?? TINY),
    ...(level === 'autonomy' || o.bounds !== undefined ? { bounds: o.bounds ?? 'PO-matched invoices under $5,000' } : {}),
    signer_id: o.signer ?? 'owner', signed_at: o.at ?? '2026-09-28T09:00:00Z',
  })
  return signDecision(d, o.key ?? OWNER.privateKeyPem)
}
