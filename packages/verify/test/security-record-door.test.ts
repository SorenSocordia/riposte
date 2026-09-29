/**
 * SECURITY FIX, R3 (2026-09-28). The red team (redteam/r3-book-content-not-revalidated.redteam.ts) showed that the content
 * check never re-applied the verdict door to a RECORD: a rewriter could splice a COUNSEL wearing a verdict_id (or a
 * malformed verdict) into a re-linked book and verifyContent() said OK. readDecisionBook now re-applies the door to every
 * RECORD payload (recordedVerdictProblem), with two tolerances so every book valid today stays valid: a judgement-tier
 * (REASONED) finding recorded before the ledger's door (R3-LEGACY), and the PASS / can't-tell edge, where the engines
 * legitimately differ (R3-OUTCOME: verifyAction holds a partially grounded action as INSUFFICIENT_DATA).
 *
 * HONEST BOUNDARY, pinned below: a SELF-CONSISTENT forged outcome (claims, outcome and coverage all rewritten) still reads.
 * verdict_id binds the inputs, not the result (R1): only re-execution, a signed envelope or an anchored head shows it.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, verifyAction, type Verdict } from '../src/index'
import { createLedger, openFileLedger, parseChainJSONL, MemoryLedger } from '../src/ledger/index'
import { recordedVerdictProblem, readDecisionBook } from '../src/ledger/decisions'
import { GENESIS, linkEvent, type LedgerEvent } from '../src/ledger/chain'
import { proofProblem } from '../src/verdict/channel'
import { verdictDoorProblem } from '../src/http/service'
import { workflowCalibration, defaultWorkflowOf } from '../src/verdict/voice'
import { ALL_STANDALONE, clean, broken, FIXED_NOW } from './fixtures/invoices'

const dir = mkdtempSync(join(tmpdir(), 'verify-security-r3-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A rewriter: re-link a doctored payload array into a valid chain (what anyone with file access produces). */
function relink(events: readonly LedgerEvent[], payloads: readonly unknown[]): { events: LedgerEvent[]; payloads: unknown[]; jsonl: string } {
  let prev = GENESIS
  const out: LedgerEvent[] = []
  for (let i = 0; i < payloads.length; i++) {
    const ev = linkEvent(i, prev, { ts: events[i]!.ts, type: events[i]!.type, verdict_id: events[i]!.verdict_id, payload: payloads[i] })
    prev = ev.entry_hash
    out.push(ev)
  }
  return { events: out, payloads: [...payloads], jsonl: out.map((e, i) => JSON.stringify({ ...e, payload: payloads[i] })).join('\n') + '\n' }
}

const now = () => new Date('2026-09-28T00:00:00Z')
const PASS = verifyAction({ tool: 'transfer', arguments: { amount: 500 } }, { allowed: { amount: [500] } })
const FAIL = verify({ ...broken, invoice_number: 'R3-F' }, { now: FIXED_NOW })
const HELD = verifyAction({ tool: 'pay', arguments: { amount: 999, vendor: 'x' } }, { allowed: { vendor: ['x'] } }) // F1: partially grounded

/** Record `v` on a fresh book, doctor its RECORD verdict with `edit`, re-link, write it to disk, reopen it. */
function doctored(v: Verdict, edit: (verdict: Record<string, unknown>) => Record<string, unknown>, name: string) {
  const led = createLedger({ now })
  led.record(v, { tenant_id: 't1' })
  const { events, payloads } = parseChainJSONL(led.chainJSONL())
  const p0 = payloads[0] as { verdict: Record<string, unknown> }
  p0.verdict = edit(structuredClone(p0.verdict))
  const path = join(dir, `${name}.jsonl`)
  writeFileSync(path, relink(events, payloads).jsonl)
  return openFileLedger(path)
}

describe('R3: the verdict door is re-applied to every RECORD on the book', () => {
  it('a COUNSEL wearing a verdict_id, spliced into a re-linked book, fails verification with a named reason (the PoC)', () => {
    const reopened = doctored(PASS, v => ({
      channel: 'COUNSEL', counsel_version: 'counsel-v0', counsel_id: 'deadbeef', dismissible: true, holds_action: false,
      provenance: { type: 'GENERATED', generator: 'attacker', generator_version: '1', source_hash: 'x' }, verdict_id: v.verdict_id, outcome: 'PASS',
    }), 'counsel')
    expect(reopened.verifyChain().ok).toBe(true) // the links are whole
    expect(reopened.verifyContent()).toMatchObject({ ok: false, brokenAt: 0, reason: expect.stringMatching(/event 0 records something that does not pass the verdict door \(COUNSEL \(channel COUNSEL\) is generated advice/) })
    expect(reopened.decisionBook().ok).toBe(false)
  })

  it('a forged outcome its claims do not support fails, named; so does every other malformed verdict', () => {
    const cases: [string, Verdict, (v: Record<string, unknown>) => Record<string, unknown>, RegExp][] = [
      ['pass-to-fail', PASS, v => ({ ...v, outcome: 'FAIL' }), /outcome FAIL does not follow from its claims/],
      ['fail-to-pass', FAIL, v => ({ ...v, outcome: 'PASS' }), /outcome PASS does not follow from its claims/],
      ['fail-to-abstain', FAIL, v => ({ ...v, outcome: 'INSUFFICIENT_DATA' }), /outcome INSUFFICIENT_DATA does not follow from its claims/],
      ['claims-not-coverage', PASS, v => ({ ...v, outcome: 'FAIL', claims: (v.claims as Record<string, unknown>[]).map(c => ({ ...c, outcome: 'FAIL' })) }), /coverage does not recount/],
      ['unbound', PASS, v => ({ ...v, input_hash: 'f'.repeat(64) }), /not bound to its inputs/],
      ['unevidenced', PASS, v => ({ ...v, claims: (v.claims as Record<string, unknown>[]).map(c => ({ ...c, evidence: [] })) }), /without evidence/],
      ['generated', PASS, v => ({ ...v, provenance: { type: 'GENERATED', generator: 'g', generator_version: '1', source_hash: 'x' } }), /provenance GENERATED/],
      ['marks', PASS, v => ({ ...v, holds_action: false }), /marks of COUNSEL/],
      ['schema', PASS, v => ({ ...v, schema_version: 'v9' }), /schema_version "v9" is not v0/],
    ]
    for (const [name, v, edit, why] of cases) {
      const check = doctored(v, edit, name).verifyContent()
      expect(check, name).toMatchObject({ ok: false, brokenAt: 0 })
      expect(check.reason, name).toMatch(why)
    }
  })

  it('HONEST BOUNDARY: a self-consistent forged outcome still reads (R1: verdict_id binds the inputs, not the result)', () => {
    // Only re-executing the engine, a signed envelope (verifyEnvelope), or an externally anchored head shows this one.
    const reopened = doctored(PASS, v => ({
      ...v, outcome: 'FAIL',
      claims: [{ claim_id: 'arg.amount', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'amount', asserted: 500, rule_id: 'GROUNDED', rule_name: 'grounded',
        evidence: [{ locator: { kind: 'field', source: 'contract', path: 'allowed.amount' }, value: 500, confidence: 100, role: 'REFERENCE' }], locked: true, explanation: 'FORGED' }],
      coverage: { claims_total: 1, claims_checked: 1, claims_pass: 0, claims_fail: 1, claims_insufficient: 0 },
    }), 'self-consistent')
    expect(reopened.verifyContent().ok).toBe(true)
  })
})

describe('R3: every book valid today stays valid', () => {
  it('every engine output reads, and a book of them verifies (documents, actions, a held action)', () => {
    const verdicts = [
      ...ALL_STANDALONE.map(([, doc]) => verify(doc, { now: FIXED_NOW })),
      verify(clean, { now: FIXED_NOW }), FAIL, PASS, HELD,
      verifyAction({ tool: 'pay', arguments: { amount: 999 } }, { allowed: { vendor: ['x'] } }),
      verifyAction({ tool: 'pay', arguments: { amount: 5 } }, { allowed: { amount: [4] } }),
    ]
    expect(new Set(verdicts.map(v => v.outcome))).toEqual(new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA']))
    const led = createLedger({ now })
    for (const v of verdicts) {
      expect(recordedVerdictProblem(v), v.verdict_id).toBeUndefined()
      if (!proofProblem(v)) led.record(v, { tenant_id: 't1' })
    }
    expect(led.events().length).toBeGreaterThan(10)
    expect(led.verifyContent().ok).toBe(true)
    expect(new MemoryLedger({ seed: parseChainJSONL(led.chainJSONL()) }).verifyContent().ok).toBe(true)
  })

  it('R3-OUTCOME: a held action (a PASS claim and an ungrounded one: INSUFFICIENT_DATA, since F1) is on the book and verifies', () => {
    expect(HELD.outcome).toBe('INSUFFICIENT_DATA')
    expect(HELD.claims.map(c => c.outcome).sort()).toEqual(['INSUFFICIENT_DATA', 'PASS'])
    const led = createLedger({ now })
    led.record(HELD, { tenant_id: 't1' })
    expect(led.verifyContent().ok).toBe(true)
  })

  it('a book written before F-A (a REVIEW without a tenant, a re-RECORD) still verifies', () => {
    const v = verify({ ...clean, invoice_number: 'R3-L' }, { now: FIXED_NOW })
    const rec = (ts: string) => ({ type: 'RECORD', tenant_id: 'acme', recorded_at: ts, retention_until: '2033-09-26T00:00:00.000Z', verdict: { ...v, ledger: { tenant_id: 'acme', retention_until: '2033-09-26T00:00:00.000Z' } } })
    const review = { type: 'REVIEW', verdict_id: v.verdict_id, review: { reviewer_id: 'ap-lead', decision: 'UPHELD', decided_at: '2026-09-20T00:01:00.000Z' } }
    const headers = [
      { ts: '2026-09-20T00:00:00.000Z', type: 'RECORD', verdict_id: v.verdict_id },
      { ts: '2026-09-20T00:01:00.000Z', type: 'REVIEW', verdict_id: v.verdict_id },
      { ts: '2026-09-20T00:02:00.000Z', type: 'RECORD', verdict_id: v.verdict_id },
    ] as LedgerEvent[]
    const legacy = relink(headers, [rec('2026-09-20T00:00:00.000Z'), review, rec('2026-09-20T00:02:00.000Z')])
    expect(readDecisionBook(legacy.events, legacy.payloads).ok).toBe(true)
  })

  it('R3-LEGACY: a judgement-tier (REASONED) finding recorded before the door still reads; voice never counts it', () => {
    const reasoned = { ...PASS, claims: PASS.claims.map(c => ({ ...c, tier: 'REASONED' as const })) }
    expect(proofProblem(reasoned)).toMatch(/judgement-tier/) // the live door refuses it today
    expect(recordedVerdictProblem(reasoned)).toBeUndefined() // the book it was written on before the door stays valid
    const legacy = relink([{ ts: '2026-09-20T00:00:00.000Z', type: 'RECORD', verdict_id: reasoned.verdict_id } as LedgerEvent], [
      { type: 'RECORD', tenant_id: 'acme', recorded_at: '2026-09-20T00:00:00.000Z', retention_until: '2033-09-26T00:00:00.000Z', verdict: reasoned },
    ])
    const led = new MemoryLedger({ seed: legacy })
    expect(led.verifyContent().ok).toBe(true)
    const rec = led.all()[0]!
    expect(workflowCalibration(led.all(), defaultWorkflowOf(rec)).excluded.map(e => e.why).join(' ')).toMatch(/judgement-tier \(REASONED\)/)
  })
})

describe('the book\'s door and the HTTP door agree', () => {
  it('on every real verdict and every mutation, except the two tolerances (REASONED; the PASS / can\'t-tell edge: FS1)', () => {
    const base = [PASS, FAIL, verify(clean, { now: FIXED_NOW }), ...ALL_STANDALONE.map(([, doc]) => verify(doc, { now: FIXED_NOW }))]
    const claimsOf = (v: Verdict) => v.claims as unknown as Record<string, unknown>[]
    const mutations: ((v: Verdict) => unknown)[] = [
      v => v,
      v => ({ ...v, channel: 'VERDICT' }),
      v => ({ ...v, channel: 'COUNSEL' }),
      v => ({ ...v, provenance: { type: 'GENERATED', generator: 'g', generator_version: '1', source_hash: 'x' } }),
      v => ({ ...v, dismissible: true }),
      v => ({ ...v, counsel_version: 'counsel-v0' }),
      v => ({ ...v, opinion_version: 'opinion-v0' }),
      v => ({ ...v, outcome: 'FAIL' }),
      v => ({ ...v, outcome: 'PASS' }),
      v => ({ ...v, outcome: 'MAYBE' }),
      v => ({ ...v, replayable: false }),
      v => ({ ...v, input_hash: 'f'.repeat(64) }),
      v => ({ ...v, schema_version: 'v1' }),
      v => ({ ...v, issued_at: undefined }),
      v => ({ ...v, aggregation: 'MAJORITY' }),
      v => ({ ...v, coverage: { ...v.coverage, claims_total: v.coverage.claims_total + 1 } }),
      v => ({ ...v, claims: claimsOf(v).map(c => ({ ...c, evidence: [] })) }),
      v => ({ ...v, claims: claimsOf(v).map(c => ({ ...c, rule_id: undefined })) }),
      v => ({ ...v, claims: claimsOf(v).map(c => ({ ...c, outcome: 'MAYBE' })) }),
      v => ({ ...v, claims: claimsOf(v).map(c => (c.outcome === 'INSUFFICIENT_DATA' ? { ...c, insufficiency: undefined } : { ...c, insufficiency: { reason: 'x' } })) }),
    ]
    let compared = 0
    for (const v of base) for (const m of mutations) {
      const x = JSON.parse(JSON.stringify(m(v)))
      expect(recordedVerdictProblem(x) === undefined, `${v.verdict_id} ${m.toString()}`).toBe(verdictDoorProblem(x) === undefined)
      compared++
    }
    for (const x of [null, 'PASS', {}, [], { verdict_id: 'x' }]) expect(recordedVerdictProblem(x)).toBeDefined()
    expect(compared).toBeGreaterThan(200)
    // The two tolerances, where the doors differ by design:
    const reasoned = { ...PASS, claims: PASS.claims.map(c => ({ ...c, tier: 'REASONED' })) }
    expect([recordedVerdictProblem(reasoned), verdictDoorProblem(reasoned)]).toEqual([undefined, expect.stringMatching(/judgement-tier/)])
    // FS1, fixed (2026-09-28): the HTTP door delegates to the book's door, so a legitimate held action is recorded by both...
    expect([recordedVerdictProblem(HELD), verdictDoorProblem(HELD)]).toEqual([undefined, undefined])
    // ...and its forged PASS twin (the same claims, outcome flipped to PASS) is refused by both: an action is PASS only when
    // every value is grounded (verifyAction's rule since 09-23).
    const forged = { ...HELD, outcome: 'PASS' }
    expect(recordedVerdictProblem(forged)).toMatch(/every value is grounded/)
    expect(verdictDoorProblem(forged)).toMatch(/every value is grounded/)
  })
})
