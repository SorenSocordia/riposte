/**
 * The ledger's tenancy and door findings folded in by the evidence-integrity lane (2026-09-28):
 *   F-A (opinion lane, ✓ measured): a second tenant's RECORD of the same verdict id inherited the first tenant's review, wrote
 *        that reviewer and note into its own payload on the chain, and replaced the first tenant's record. Records are now
 *        keyed by (tenant, verdict_id); a review never crosses tenants; legacy chains still open (the leaked payload bytes stay,
 *        immutable, but no record shows them).
 *   N1 (CLI lane): a file ledger appending onto a chain export with no final newline fused two events onto one line.
 *   N4 (CLI lane): declineOnBook re-derives the proposal from the book and refuses a stale or forged proposal id.
 *   N5 (CLI lane): decide() refuses on a book that does not verify.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { verify, type Verdict } from '../src/index'
import {
  createLedger, MemoryLedger, openFileLedger, parseChainJSONL, readDecisionBook, signDecision, makeGrant, DecisionRefused,
  linkEvent, GENESIS, type LedgerEvent, type Ledger,
} from '../src/ledger/index'
import { workflowCalibration, declineOnBook, declineDecision, assessVoiceFromLedger, policyRef, type PromotionPolicy } from '../src/verdict/voice'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

let clock = Date.parse('2026-09-28T09:00:00Z')
const tick = (): Date => new Date((clock += 60_000))
const iso = (): string => new Date(clock).toISOString()
const SHARED: Verdict = verify({ ...broken, invoice_number: 'SHARED-1' }, { now: FIXED_NOW })
const PASSES: Verdict[] = Array.from({ length: 20 }, (_, i) => verify({ ...clean, invoice_number: `TN-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 20 }, (_, i) => verify({ ...broken, invoice_number: `TN-F${i}` }, { now: FIXED_NOW }))
const wf = (tenant: string): string => `${tenant}/${SHARED.ruleset.id}@${SHARED.ruleset.version}`
const NOTE = 'ACME-PRIVATE: duplicate of PO 7'

const paths: string[] = []
const tmpPath = (): string => { const p = join(tmpdir(), `verify-tenancy-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`); paths.push(p); return p }
afterEach(() => { for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p) })

function collision(led: Ledger = createLedger({ now: tick })): Ledger {
  led.record(SHARED, { tenant_id: 'acme' })
  led.review(SHARED.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: NOTE })
  led.record(SHARED, { tenant_id: 'globex' })
  return led
}
const leaks = (x: unknown): boolean => JSON.stringify(x).includes('ACME-PRIVATE') || JSON.stringify(x).includes('ap-lead')

describe('F-A: one verdict id, two tenants: a review never crosses tenants', () => {
  it('globex\'s record, its RECORD payload on the chain, its stats and its calibration carry nothing of acme\'s review', () => {
    const led = collision()
    const id = SHARED.verdict_id
    const g = led.get(id)!
    expect(g.tenant_id).toBe('globex')                      // get(id) is the latest owner's record
    expect(g.review).toBeUndefined()
    expect(g.verdict.ledger?.reviewer).toBeUndefined()
    expect(leaks(g)).toBe(false)
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const gRecord = events.findIndex((e, i) => e.type === 'RECORD' && (payloads[i] as { tenant_id: string }).tenant_id === 'globex')
    expect(leaks(payloads[gRecord])).toBe(false)             // nothing of acme's is written into globex's payload
    expect(led.stats('globex')).toMatchObject({ total: 1, reviewed: 0, overturned: 0 })
    const cal = workflowCalibration(led.all(), wf('globex'))
    expect(cal).toMatchObject({ records: 1, reviewed: { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 } })
    expect(leaks(cal)).toBe(false)
    // acme keeps its own record and review (before the fix, globex's record REPLACED it)
    expect(led.get(id, 'acme')!.review).toMatchObject({ reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: NOTE })
    expect(led.stats('acme')).toMatchObject({ total: 1, reviewed: 1, overturned: 1 })
    expect(workflowCalibration(led.all(), wf('acme')).evidence.false_fail).toEqual([id])
    expect(led.all().map(r => r.tenant_id).sort()).toEqual(['acme', 'globex'])
    expect(led.verifyContent().ok).toBe(true)
  })

  it('a REVIEW names the tenant whose record it reviews; review(id, …, { tenant_id }) targets one; a reopened book agrees, file and memory', () => {
    const path = tmpPath()
    const led = collision(openFileLedger(path, { now: tick }))
    led.review(SHARED.verdict_id, { reviewer_id: 'globex-controller', decision: 'UPHELD' })            // the latest owner: globex
    led.review(SHARED.verdict_id, { reviewer_id: 'ap-lead', decision: 'UPHELD', note: 'second look' }, { tenant_id: 'acme' })
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const reviewTenants = events.map((e, i) => (e.type === 'REVIEW' ? (payloads[i] as { tenant_id: string }).tenant_id : null)).filter(Boolean)
    expect(reviewTenants).toEqual(['acme', 'globex', 'acme'])
    for (const reopened of [openFileLedger(path), new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()) })]) {
      expect(reopened.all()).toEqual(led.all())
      expect(reopened.get(SHARED.verdict_id)!.review!.reviewer_id).toBe('globex-controller')
      expect(reopened.get(SHARED.verdict_id, 'acme')!.review!.note).toBe('second look')
      expect(reopened.verifyContent().ok).toBe(true)
    }
    expect(() => led.review(SHARED.verdict_id, { reviewer_id: 'x', decision: 'UPHELD' }, { tenant_id: 'initech' })).toThrow(/for tenant initech: not recorded/)
  })

  it('a doctored REVIEW that names a tenant who never recorded the verdict breaks the book', () => {
    const led = collision()
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const ri = events.findIndex(e => e.type === 'REVIEW')
    ;(payloads[ri] as { tenant_id: string }).tenant_id = 'globex' // globex records it only later
    let prev = ri === 0 ? GENESIS : events[ri - 1]!.entry_hash
    for (let i = ri; i < events.length; i++) { const e = linkEvent(i, prev, { ts: events[i]!.ts, type: events[i]!.type, verdict_id: events[i]!.verdict_id, payload: payloads[i] }); events[i] = e; prev = e.entry_hash }
    expect(readDecisionBook(events, payloads).check.reason).toMatch(/reviews tenant globex's record .* never recorded it before/)
  })

  it('a LEGACY chain written with the leak still opens and verifies; the reopened records no longer show acme\'s review on globex', () => {
    // Build the chain exactly as the pre-fix ledger wrote it: globex's RECORD payload carries acme's reviewer; REVIEW has no tenant.
    const at = '2026-09-27T00:00:00.000Z', retention_until = '2033-09-26T00:00:00.000Z'
    const events: LedgerEvent[] = [], payloads: unknown[] = []
    const push = (type: 'RECORD' | 'REVIEW', payload: unknown): void => {
      const prev = events.length ? events[events.length - 1]!.entry_hash : GENESIS
      events.push(linkEvent(events.length, prev, { ts: at, type, verdict_id: SHARED.verdict_id, payload })); payloads.push(payload)
    }
    const reviewer = { id: 'ap-lead', decided_at: at, decision: 'OVERTURNED', note: NOTE }
    push('RECORD', { type: 'RECORD', tenant_id: 'acme', recorded_at: at, retention_until, verdict: { ...SHARED, ledger: { tenant_id: 'acme', retention_until } } })
    push('REVIEW', { type: 'REVIEW', verdict_id: SHARED.verdict_id, review: { reviewer_id: 'ap-lead', decided_at: at, decision: 'OVERTURNED', note: NOTE } })
    push('RECORD', { type: 'RECORD', tenant_id: 'globex', recorded_at: at, retention_until, verdict: { ...SHARED, ledger: { tenant_id: 'globex', retention_until, reviewer } } })
    const led = new MemoryLedger({ seed: { events, payloads } })
    expect(led.verifyContent().ok).toBe(true)                   // the past is immutable, and still reads
    expect(leaks(payloads[2])).toBe(true)                       // (the leaked bytes are on that old chain)
    expect(leaks(led.get(SHARED.verdict_id)!)).toBe(false)      // but globex's record never shows them
    expect(led.get(SHARED.verdict_id, 'acme')!.review!.note).toBe(NOTE)
    expect(led.stats('globex').reviewed).toBe(0)
  })
})

describe('N1: a file ledger appending onto a chain export with no final newline', () => {
  it('opening changes no byte; the first append writes the missing newline; the book keeps one event per line and verifies', () => {
    const src = createLedger({ now: tick })
    src.record(PASSES[0]!, { tenant_id: 'acme' })
    src.review(PASSES[0]!.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
    const path = tmpPath()
    const exported = src.chainJSONL()
    expect(exported.endsWith('\n')).toBe(false)
    writeFileSync(path, exported)
    const led = openFileLedger(path, { now: tick })
    expect(readFileSync(path, 'utf8')).toBe(exported) // opening alone never changes the book
    led.record(PASSES[1]!, { tenant_id: 'acme' })
    led.record(PASSES[2]!, { tenant_id: 'acme' })
    const text = readFileSync(path, 'utf8')
    expect(text.split('\n').filter(Boolean)).toHaveLength(4)
    const reopened = openFileLedger(path)
    expect(reopened.verifyContent().ok).toBe(true)
    expect(reopened.chainHead()).toBe(led.chainHead())
  })
})

// ── N4 / N5 need a small policy and a signed grant ───────────────────────────────────────────────────────────────
function key(seedHex: string): { priv: string; pub: string } {
  const k = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' })
  return { priv: k.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: createPublicKey(k).export({ type: 'spki', format: 'pem' }).toString() }
}
const OWNER = key('11'.repeat(32))
const TINY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'tiny-tenancy', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const WF = wf('acme')
const grantGate = () => signDecision(makeGrant({ workflow_id: WF, level: 'gate', consequence_tier: 'low', policy: policyRef(TINY), signer_id: 'owner', signed_at: iso() }), OWNER.priv)

describe('N4: declineOnBook re-derives the proposal from the book', () => {
  it('declines the live proposal; refuses a stale or forged proposal id, and a book with nothing to decline', () => {
    const led = createLedger({ now: tick, trusted_keys: { owner: OWNER.pub } }) // D-ANCHOR: only an anchored signer's grant has effect
    for (const v of FAILS.slice(0, 6)) { led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' }) }
    for (const v of FAILS.slice(6, 8)) { led.record(v, { tenant_id: 'acme' }); led.review(v.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' }) }
    led.decide(grantGate())
    const a = assessVoiceFromLedger(led, WF, TINY)
    const by = { signer_id: 'owner', signed_at: iso(), reason: 'keep it' }
    const d = declineOnBook(led, WF, TINY, a.proposal!.proposal_id, by)
    expect(d).toEqual(declineDecision(a, by))
    expect(() => declineOnBook(led, WF, TINY, 'f'.repeat(32), by)).toThrow(/the evidence has moved since it was read/)
    led.decide(signDecision(d, OWNER.priv))
    expect(() => declineOnBook(led, WF, TINY, a.proposal!.proposal_id, by)).toThrow(/no open proposal/)
  })
})

describe('N5: nothing is decided on a book that does not verify', () => {
  it('decide() refuses (appending nothing) when the chain it would extend is broken', () => {
    const led = createLedger({ now: tick })
    led.record(PASSES[0]!, { tenant_id: 'acme' })
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    ;(payloads[0] as { verdict: { outcome: string } }).verdict.outcome = 'FAIL' // altered after the fact, hash not updated
    const broken = new MemoryLedger({ seed: { events, payloads }, now: tick })
    const head = broken.chainHead()
    expect(() => broken.decide(grantGate())).toThrow(/the book does not verify at event 0 .*nothing is decided on a broken book/)
    expect(broken.chainHead()).toBe(head)
    expect(() => led.decide(grantGate())).not.toThrow()
  })
})
