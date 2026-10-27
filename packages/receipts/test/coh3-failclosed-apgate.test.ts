/**
 * 2026-10-04: the AP gate paid whenever the checker's decision said approve,
 * comparing the verdict's status with one literal. A payment now executes ONLY on exactly PASS with no struck field; any other
 * reading holds, and the receipt names the status. An allowing ruling pays only a FAIL or PASS-WITH-OPEN verdict it covers.
 * The AP cases are Distil Labs' public AP benchmark (Apache-2.0), vendored in verify/data/real.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSigningKeypair, splitApLayout, verifyInvoiceMatch, type ApResult } from 'riposte-verify'
import { apGateOnCheck, hashesOnlyBody, makeRuling, signRuling, type Authorities } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-04T06:00:00.000Z')
const CASES = readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
// engine 0.6.0: history known and empty, so the duplicate check runs (without it, an approve reads PASS-WITH-OPEN)
const docsFor = (decision: string) => ({ ...splitApLayout(CASES.find((c) => c.decision === decision)!.input)!, history: [] })
const approveDocs = docsFor('approve')
const doctor = (check: ApResult, outcome: string, lastClaim?: string): ApResult => {
  const d = structuredClone(check)
  ;(d.verdict as { outcome: string }).outcome = outcome
  if (lastClaim) (d.verdict.claims[d.verdict.claims.length - 1] as { outcome: string }).outcome = lastClaim
  return d
}

describe('fail closed: the AP gate pays only on exactly PASS', () => {
  it('control: a real approve check pays, with no refusal key', () => {
    const g = apGateOnCheck('approve', verifyInvoiceMatch(approveDocs, { now: NOW }))
    expect(g).toMatchObject({ action: 'EXECUTE', effect: 'PAY', status: 'PASS' })
    expect('refusal' in g).toBe(false)
    expect('refusal' in hashesOnlyBody(g, approveDocs)).toBe(false)
  })

  it('a check whose decision says approve while its verdict FAILs is held, and the receipt names FAIL', () => {
    const g = apGateOnCheck('approve', doctor(verifyInvoiceMatch(approveDocs, { now: NOW }), 'FAIL', 'FAIL'))
    expect(g).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW', checker_decision: 'approve', status: 'FAIL', refusal: { code: 'status.unexpected', status: 'FAIL' } })
    expect(g.reason).toMatch(/^status\.unexpected: the checker says "approve" but the verdict reads FAIL; a payment executes only on PASS/)
    expect(hashesOnlyBody(g, approveDocs)).toMatchObject({ action: 'REVIEW', refusal: { code: 'status.unexpected', status: 'FAIL' } })
  })

  it('a status this build does not know, and INSUFFICIENT_DATA, are held the same way', () => {
    for (const outcome of ['MYSTERY', 'INSUFFICIENT_DATA']) {
      const g = apGateOnCheck('approve', doctor(verifyInvoiceMatch(approveDocs, { now: NOW }), outcome))
      expect(g.action, outcome).toBe('REVIEW')
      expect(g.refusal, outcome).toMatchObject({ code: 'status.unexpected', status: outcome })
    }
  })

  it('an allowing ruling still pays a FAIL it covers, and no longer pays a status outside FAIL / PASS-WITH-OPEN', () => {
    const buyer = generateSigningKeypair()
    const AUTH: Authorities = { buyer: buyer.publicKeyPem }
    const price = docsFor('hold_price')
    const check = verifyInvoiceMatch(price, { now: NOW })
    const ruling = signRuling(makeRuling({ verdict_id: check.verdict.verdict_id, rules: ['AP_PRICE_PO'], by: 'buyer', decision: 'allow', note: 'agreed with the vendor', now: NOW }), buyer.privateKeyPem)
    expect(apGateOnCheck('approve', check, { rulings: [ruling], authorities: AUTH })).toMatchObject({ action: 'EXECUTE', effect: 'PAY', status: 'FAIL' })
    const odd = apGateOnCheck('approve', doctor(check, 'MYSTERY'), { rulings: [ruling], authorities: AUTH })
    expect(odd).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW', status: 'MYSTERY' })
    expect(odd.reason).toMatch(/the verdict reads MYSTERY: an allowing ruling pays only a FAIL or PASS-WITH-OPEN verdict it covers/)
  })
})
