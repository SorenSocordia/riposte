/**
 * Legal cite-check → demo-grade: the court-presentable citation audit report, and its pairing with the protocol envelope
 * to make a tamper-evident, independently-verifiable signed artifact a filer can attach.
 */
import { describe, it, expect } from 'vitest'
import { verifyCitations, renderCitationAudit, generateSigningKeypair, signVerdict, verifyEnvelope, type Citation, type OpinionSources } from '../src/index'

const NOW = () => new Date('2026-09-22T00:00:00Z')
const sources: OpinionSources = {
  Twombly: 'To survive a motion to dismiss, a complaint must state a claim to relief that is plausible on its face.',
}
const cites: Citation[] = [
  { id: '1', case_name: 'Twombly', quote: 'plausible on its face' },              // PASS — verbatim
  { id: '2', case_name: 'Twombly', quote: 'probable on its face' },               // FAIL — misquote (opinion says "plausible")
  { id: '3', case_name: 'Ghost', cite: '1 F.4th 1', quote: 'anything at all' },   // abstain — no opinion supplied
]

describe('renderCitationAudit', () => {
  const v = verifyCitations(cites, sources, { now: NOW })
  const audit = renderCitationAudit(v)

  it('summarizes the brief with per-citation verdicts and honest counts', () => {
    expect(v.outcome).toBe('FAIL') // one misquote fails the brief
    expect(audit).toMatch(/# Citation audit/)
    expect(audit).toMatch(/1 verified · 1 inaccurate · 1 could-not-verify/)
    expect(audit).toMatch(/✓/)
    expect(audit).toMatch(/✗/)
    expect(audit).toMatch(/⚠/)
  })

  it('carries the verdict id and states its own scope (does not decide propositions)', () => {
    expect(audit).toContain(v.verdict_id)
    expect(audit).toMatch(/does NOT decide whether an authority \*stands for\* a proposition/)
  })

  it('shows the opinion\'s actual words on the inaccurate citation', () => {
    expect(audit).toMatch(/plausible on its face/) // the FAIL entry surfaces what the opinion really says
  })
})

describe('signed, court-presentable artifact (legal verdict → protocol envelope)', () => {
  it('signs the citation verdict and verifies with only the public key', () => {
    const v = verifyCitations(cites, sources, { now: NOW })
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict(v, privateKeyPem)
    const check = verifyEnvelope(env)
    expect(check.signature_ok).toBe(true)
    expect(check.ok).toBe(true)
    // tamper the audited outcome after signing → the signature must break
    const tampered = { ...env, verdict: { ...env.verdict, outcome: 'PASS' as const } }
    expect(verifyEnvelope(tampered).signature_ok).toBe(false)
  })
})
