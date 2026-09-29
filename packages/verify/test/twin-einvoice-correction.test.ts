/**
 * The e-invoice twin's outcome correction (twin 0.3.0, PRODUCT-FIX-1, 2026-09-29; docs/EINVOICE-TWIN-CORRECTION-2026-09-29.md).
 *
 * Before 0.3.0, a passing footing alone made the verdict PASS: one extracted claim that abstained (ELEMENT_ABSENT) on the
 * public Peppol fixture, plus a footing that passed, read PASS. The footing proves the document agrees with itself; it says
 * nothing about the caller's extracted values. Now PASS needs at least one verified extracted value, and the two questions
 * are also answered apart (`outcomes`). The verdict names the rule it uses (aggregation ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES),
 * and the book's door and the dispute opinion recompute under it. Public fixtures only.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import { verifyEinvoiceTwin, einvoiceVerdictInput, EINVOICE_MAPS, EINVOICE_TWIN_VERSION, type EinvoiceClaim } from '../src/twin-einvoice/index'
import { recordedVerdictProblem } from '../src/ledger/decisions'
import { verdictDoorProblem } from '../src/http/service'
import { verifyReplay } from '../src/protocol/replay'
import { aggregateOutcome } from '../src/verdict/aggregation'
import { createLedger, disputeOpinion, snapshotOfLedger } from '../src/index'
import { deriveVerdictId } from '../src/protocol/verdict-id'
import type { Verdict } from '../src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEPPOL = readFileSync(join(HERE, 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml'), 'utf8')
const OPTS = { now: () => new Date('2026-09-29T12:00:00Z') }
const ABSENT: EinvoiceClaim = { id: 'x', field: 'tax_amount_accounting_currency', value: 244.91 } // BT-111: no BT-6 in this fixture
const MATCH: EinvoiceClaim = { id: 'p', field: 'payable_amount', value: 1034 }
const WRONG: EinvoiceClaim = { id: 'w', field: 'payable_amount', value: 1043.5 }
const UNBALANCED = PEPPOL.replace('<cbc:PayableAmount currencyID="EUR">1034.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="EUR">1044.00</cbc:PayableAmount>')

describe('the published miss: a passing footing never stands in for an unverified extraction', () => {
  it('reproduced on the public fixture: the only claim abstains, the footing passes → INSUFFICIENT_DATA (was PASS)', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [ABSENT], OPTS)
    expect(r.judgments.map((j) => [j.outcome, j.reason])).toEqual([['ABSTAIN', 'ELEMENT_ABSENT']])
    expect(r.consistency.every((k) => k.outcome === 'PASS')).toBe(true)
    expect(r.verdict.coverage).toMatchObject({ claims_pass: 7, claims_fail: 0, claims_insufficient: 1 })
    expect(r.verdict.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.outcomes).toEqual({ extraction: 'INSUFFICIENT_DATA', footing: 'PASS' })
  })
  it('no claims at all: nothing extracted was verified → INSUFFICIENT_DATA, the footing still reported', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [], OPTS)
    expect(r.verdict.outcome).toBe('INSUFFICIENT_DATA')
    expect(r.outcomes).toEqual({ extraction: 'INSUFFICIENT_DATA', footing: 'PASS' })
  })
  it('one verified value and one abstention → PASS (unchanged: the verdict needs a verified value, not every value)', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [MATCH, ABSENT], OPTS)
    expect(r.verdict.outcome).toBe('PASS')
    expect(r.outcomes).toEqual({ extraction: 'PASS', footing: 'PASS' })
  })
  it('FAIL is unchanged: a wrong extracted value, or an internally inconsistent invoice even with nothing extracted verified', () => {
    expect(verifyEinvoiceTwin(PEPPOL, [WRONG, ABSENT], OPTS).verdict.outcome).toBe('FAIL')
    const r = verifyEinvoiceTwin(UNBALANCED, [ABSENT], OPTS)
    expect(r.verdict.outcome).toBe('FAIL')
    expect(r.outcomes).toEqual({ extraction: 'INSUFFICIENT_DATA', footing: 'FAIL' })
  })
  it('footing off → outcomes.footing is null; no twin at all → both parts are answered by what ran', () => {
    expect(verifyEinvoiceTwin(PEPPOL, [MATCH], { ...OPTS, consistency: false }).outcomes).toEqual({ extraction: 'PASS', footing: null })
    const none = verifyEinvoiceTwin('%PDF-1.7', [MATCH], OPTS)
    expect([none.verdict.outcome, none.outcomes]).toEqual(['INSUFFICIENT_DATA', { extraction: 'INSUFFICIENT_DATA', footing: null }])
  })
})

describe('the rule changed, so the label changed: twin 0.3.0', () => {
  it('every map and the twin version are 0.3.0, and the new verdicts re-perform under replay', () => {
    expect(Object.values(EINVOICE_MAPS).map((m) => m.version)).toEqual(['0.3.0', '0.3.0', '0.3.0'])
    expect(EINVOICE_TWIN_VERSION).toBe('0.3.0')
    const r = verifyEinvoiceTwin(PEPPOL, [ABSENT], OPTS)
    const check = verifyReplay(r.verdict, einvoiceVerdictInput(r.twin.sha256, 'peppol-bis3', [ABSENT], OPTS), { document: PEPPOL })
    expect(check).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
  })
  it('a verdict under a pre-correction label is not re-performed by this build (STRUCTURE_ONLY), never re-judged as if it were 0.3.0', () => {
    const r = verifyEinvoiceTwin(PEPPOL, [ABSENT], OPTS)
    const ruleset = { ...r.verdict.ruleset, version: '0.2.0' }
    const legacy: Verdict = { ...r.verdict, outcome: 'PASS', ruleset, verdict_id: deriveVerdictId(r.verdict.input_hash, ruleset, r.verdict.engine_version) }
    expect(verifyReplay(legacy, einvoiceVerdictInput(r.twin.sha256, 'peppol-bis3', [ABSENT], OPTS), { document: PEPPOL })).toMatchObject({ ok: true, status: 'STRUCTURE_ONLY', outcome_verified: false })
  })
  it('the CLI: a passing footing with nothing extracted verified exits 2 (was 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-einvoice-correction-'))
    try {
      const claims = join(dir, 'claims.json')
      writeFileSync(claims, JSON.stringify([ABSENT]))
      let out = ''
      const code = run(['twin-einvoice', join(HERE, 'fixtures', 'einvoice', 'peppol-bis3-invoice.xml'), '--claims', claims], { out: (s) => { out += s }, err: () => {} })
      expect([code, JSON.parse(out).verdict.outcome]).toEqual([2, 'INSUFFICIENT_DATA'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('the verdict names the rule it uses: ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES', () => {
  const AGG = 'ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES'
  it('the rule, recomputed from outcomes and kinds, next to ANY_FAIL_FAILS', () => {
    const footingOnly = [{ outcome: 'PASS', kind: 'CONSISTENCY' }, { outcome: 'INSUFFICIENT_DATA', kind: 'CROSS_REFERENCE' }] as const
    expect([aggregateOutcome('ANY_FAIL_FAILS', footingOnly), aggregateOutcome(AGG, footingOnly)]).toEqual(['PASS', 'INSUFFICIENT_DATA'])
    const verified = [...footingOnly, { outcome: 'PASS', kind: 'CROSS_REFERENCE' }] as const
    expect([aggregateOutcome('ANY_FAIL_FAILS', verified), aggregateOutcome(AGG, verified)]).toEqual(['PASS', 'PASS'])
    const inconsistent = [{ outcome: 'FAIL', kind: 'CONSISTENCY' }, { outcome: 'PASS', kind: 'CROSS_REFERENCE' }] as const
    expect([aggregateOutcome('ANY_FAIL_FAILS', inconsistent), aggregateOutcome(AGG, inconsistent)]).toEqual(['FAIL', 'FAIL'])
    expect([aggregateOutcome('ANY_FAIL_FAILS', []), aggregateOutcome(AGG, [])]).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'])
  })
  it('every twin verdict names it, and its outcome is exactly what the rule gives its claims', () => {
    for (const [xml, claims] of [[PEPPOL, [ABSENT]], [PEPPOL, []], [PEPPOL, [MATCH, ABSENT]], [PEPPOL, [WRONG]], [UNBALANCED, [ABSENT]], ['%PDF-1.7', [MATCH]]] as const) {
      const v = verifyEinvoiceTwin(xml, [...claims], OPTS).verdict
      expect(v.aggregation).toBe(AGG)
      expect(v.outcome).toBe(aggregateOutcome(AGG, v.claims))
    }
  })
})

describe('the door holds the rule (book of record and HTTP)', () => {
  const held = verifyEinvoiceTwin(PEPPOL, [ABSENT], OPTS).verdict
  const passed = verifyEinvoiceTwin(PEPPOL, [MATCH, ABSENT], OPTS).verdict
  const inconsistent = verifyEinvoiceTwin(UNBALANCED, [ABSENT], OPTS).verdict
  const clone = (v: unknown): Verdict => JSON.parse(JSON.stringify(v)) as Verdict
  it('the legitimate new-rule verdicts pass both doors: held (footing only), PASS (a value verified), FAIL (the footing), no claims, no twin', () => {
    for (const v of [held, passed, inconsistent, verifyEinvoiceTwin(PEPPOL, [], OPTS).verdict, verifyEinvoiceTwin('%PDF-1.7', [MATCH], OPTS).verdict]) {
      expect([recordedVerdictProblem(clone(v)), verdictDoorProblem(clone(v))]).toEqual([undefined, undefined])
    }
  })
  it('the forged twins are refused by both doors', () => {
    const forged: [string, unknown, RegExp][] = [
      // the held verdict flipped to PASS: the recompute under the named rule gives INSUFFICIENT_DATA
      ['footing-only PASS', { ...held, outcome: 'PASS' }, /does not follow from its claims under ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES \(they give INSUFFICIENT_DATA: only CONSISTENCY claims PASSed/],
      // the same, relabelled ANY_FAIL_FAILS to dodge the recompute: a 0.3.0 twin verdict names its own rule
      ['relabelled footing-only PASS', { ...held, outcome: 'PASS', aggregation: 'ANY_FAIL_FAILS' }, /an e-invoice twin verdict from 0\.3\.0 names aggregation ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES/],
      // exact both ways: the new rule has no tolerated PASS / can't-tell edge
      ['a PASS demoted to INSUFFICIENT_DATA', { ...passed, outcome: 'INSUFFICIENT_DATA' }, /does not follow from its claims under ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES \(they give PASS\)/],
      ['an unnamed rule', { ...held, aggregation: 'EXTRACTION_ONLY' }, /aggregation must be one of ANY_FAIL_FAILS, ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES/],
    ]
    for (const [what, x, msg] of forged) {
      expect(recordedVerdictProblem(clone(x)), what).toMatch(msg)
      expect(verdictDoorProblem(clone(x)), what).toMatch(msg)
    }
  })
  it('a book holding a pre-correction (0.2.0) footing-only PASS stays valid: the engine issued exactly that before 0.3.0, under ANY_FAIL_FAILS', () => {
    const ruleset = { ...held.ruleset, version: '0.2.0' }
    const legacy: Verdict = { ...held, outcome: 'PASS', aggregation: 'ANY_FAIL_FAILS', ruleset, verdict_id: deriveVerdictId(held.input_hash, ruleset, held.engine_version) }
    expect(recordedVerdictProblem(legacy)).toBeUndefined()
  })
  it('a reader that recomputes (the dispute opinion) does it under the named rule, and the held verdict verifies', () => {
    const ledger = createLedger({ now: () => new Date('2026-09-29T12:00:00Z') })
    ledger.record(held, { tenant_id: 'acme' })
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: held.verdict_id })
    const p = op.premises.find((x) => /follows from its \d+ claim\(s\) under/.test(x.statement))!
    expect(p.statement).toMatch(/The document outcome INSUFFICIENT_DATA follows from its 8 claim\(s\) under ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES/)
    expect(p.verified).toBe(true)
  })
})
