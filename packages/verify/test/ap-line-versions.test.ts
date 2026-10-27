/**
 * AP ruleset versions (ap-threeway 0.1.0 → 0.2.0, the line recompute) and the book's verdict door.
 *   - 0.1.0 stays selectable and re-performs byte for byte: the 100 public benchmark cases under 0.1.0 hash to the value
 *     pinned from the build BEFORE the line recompute existed (the pin below was taken from that build's output).
 *   - 0.2.0 only tightens and is confined: every 0.1.0 claim survives unchanged, the only new claims are the line amounts,
 *     and the decision moves only where 0.1.0 approved, held for the total, or abstained at the total.
 *   - The door accepts both versions' genuine verdicts and refuses a 0.2.0 verdict whose line FAIL was hidden.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, splitApLayout, resolveApRuleset, AP_RULESET, AP_RULESET_V0_1_0, AP_RULESET_V0_2_0, AP_RULESET_V0_3_0, type ApDocuments, type ApResult } from '../src/ap/index'
import { apLineMathProblem } from '../src/ap/line-math'
import { recordedVerdictProblem } from '../src/ledger/decisions'
import { verdictDoorProblem } from '../src/http/service'
import { createLedger, parseChainJSONL, MemoryLedger } from '../src/ledger/index'
import { GENESIS, linkEvent, type LedgerEvent } from '../src/ledger/chain'
import { verifyReplay } from '../src/protocol/replay'
import type { Verdict } from '../src/verdict/schema'
import { coreOf } from './fixtures/remedy-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl')
const cases = readFileSync(DATA, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const NOW = () => new Date('2026-09-23T00:00:00Z')
const V010 = 'ap-threeway@0.1.0'
const V020 = 'ap-threeway@0.2.0', V030 = 'ap-threeway@0.3.0'
const run = (d: ApDocuments, ruleset?: string, engine?: string): ApResult => verifyInvoiceMatch(d, { now: NOW, ...(ruleset ? { ruleset } : {}), ...(engine ? { engine } : {}) })

/** A planted line error (10 × 14.25 billed 172.50) whose total adds up: 0.1.0 approves it, 0.2.0 holds it. */
const PLANTED: ApDocuments = {
  invoice: `INVOICE MESSAGE
INVOICE NM-84665   DATE 2026-09-28
CUST PO: PO-48825
1   CORD EXT 50FT 12AWG | 5 | 47.30 | 236.50
2   Floor marking tape, yellow | 10 | 14.25 | 172.50
3   48 inch wire shelving unit | 24 | 96.50 | 2,316.00
TOTAL DUE USD | 2,725.00
Northfield Material Handling
`, // signed by its vendor (2026-10-05)
  purchase_order: `PURCHASE ORDER (ERP)
PO-48825 | Vendor: Northfield Material Handling | Freight: not allowed
1. Extension cord 50 ft, 12 AWG | qty 5 | unit USD 47.30
2. Floor marking tape, yellow | qty 10 | unit USD 14.25
3. Wire shelving unit 48 in | qty 24 | unit USD 96.50
`,
  goods_receipt: `GOODS RECEIPT (ERP) for PO-48825
1. Extension cord 50 ft, 12 AWG | received 5
2. Floor marking tape, yellow | received 10
3. Wire shelving unit 48 in | received 24
`,
}

describe('ruleset versions: 0.3.0 is current from engine 0.7.2; 0.2.0 and 0.1.0 are retained and selectable', () => {
  it('resolves the current version, any retained version, and refuses anything else', () => {
    expect(AP_RULESET.version).toBe('0.3.0')
    expect(AP_RULESET).toBe(AP_RULESET_V0_3_0)
    expect(resolveApRuleset()).toBe(AP_RULESET)
    expect(resolveApRuleset('ap-threeway')).toBe(AP_RULESET)
    expect(resolveApRuleset(V010)).toBe(AP_RULESET_V0_1_0)
    expect(resolveApRuleset({ id: 'ap-threeway', version: '0.2.0' })).toBe(AP_RULESET_V0_2_0)
    // the default follows the engine asked for: 0.2.0 under engines 0.6.0 to 0.7.1, 0.3.0 from 0.7.2
    expect(resolveApRuleset(undefined, '0.7.1')).toBe(AP_RULESET_V0_2_0)
    expect(resolveApRuleset('ap-threeway', '0.6.0')).toBe(AP_RULESET_V0_2_0)
    expect(resolveApRuleset(undefined, '0.7.2')).toBe(AP_RULESET_V0_3_0)
    // 2026-10-14: 0.3.0 exists and is selectable (test/ap-announced-change.test.ts); the next unminted version is refused
    // 2026-10-19: 0.4.0 is minted and selectable (test/ap-040.test.ts), so the next unminted version is 0.5.0
    for (const bad of ['ap-threeway@0.5.0', 'ap-threeway@', 'invoice', 'invoice@0.1.0']) expect(() => resolveApRuleset(bad), bad).toThrow(/unknown AP ruleset/)
    expect(() => run(PLANTED, 'ap-threeway@9.9.9')).toThrow(/unknown AP ruleset/)
  })

  it('0.1.0 re-performs byte for byte: the 100 benchmark cases hash to the pin taken from the build before 0.2.0 existed', () => {
    // Row shape and key order of the bench runner; the pin is sha256 of its first 100 rows on the pre-0.2.0 build.
    // Engine 0.0.1, the engine that build was (2026-10-03: the engine moved to 0.1.0, which changed no AP behaviour, only
    // the engine stamp and the verdict id derived from it; test/engine-defaults.test.ts shows that on these cases).
    const rows = cases.map((c) => {
      const r = run(splitApLayout(c.input)!, V010, '0.0.1')
      const gold_g = { invoice_number: c.invoice?.invoice_number ?? null, po_number: c.invoice?.po_number ?? null, item: c.grounding?.item ?? null, invoiced: c.grounding?.invoice_value ?? null, expected: c.grounding?.reference_value ?? null }
      // The verdict on its core: typed remedies (2026-10-02) are additive and outside it (fixtures/remedy-core.ts). Not re-pinned.
      return JSON.stringify({ set: 'S1', id: c.id, gold: c.decision, gold_g, decision: r.decision, payable: r.payable, grounding: r.grounding, reasons: r.reasons, not_checked: r.not_checked, verdict: coreOf(r.verdict) })
    })
    expect(createHash('sha256').update(rows.join('\n') + '\n').digest('hex')).toBe('95c91d016515f52fa56995814955de1d2ad10d1ec296a12baba4afc0217f67dc')
  })

  it('the two versions share the input identity and differ in the verdict id; 0.1.0 issues no line-amount claim', () => {
    const a = run(PLANTED, V010).verdict, b = run(PLANTED, V020).verdict
    expect(a.input_hash).toBe(b.input_hash)
    expect(a.verdict_id).not.toBe(b.verdict_id)
    expect([a.ruleset.version, b.ruleset.version]).toEqual(['0.1.0', '0.2.0'])
    expect(a.claims.some((c) => /\.amount$/.test(c.claim_id))).toBe(false)
  })

  it('0.2.0 only tightens and is confined, over the 100 benchmark cases and the planted case', () => {
    let changed = 0
    // engine 0.6.0: a bill is approved only against a known book, so both rulesets read a known, empty one here
    for (const d0 of [...cases.map((c) => splitApLayout(c.input)!), PLANTED]) {
      const d = { ...d0, history: [] }
      const a = run(d, V010), b = run(d)
      // every 0.1.0 claim survives unchanged, in order; the only new claims are the line amounts
      expect(b.verdict.claims.filter((c) => !/^ap\.line\[\d+\]\.amount$/.test(c.claim_id))).toEqual(a.verdict.claims)
      if (a.decision === b.decision) continue
      changed++
      expect(b.decision).not.toBe('approve') // never approves what 0.1.0 held
      expect(a.decision === 'approve' || a.decision === 'hold_total' || (a.decision === 'abstain' && /^cannot decide ap\.total/.test(a.reasons[0]!))).toBe(true)
      if (b.payable === true) expect(a.payable).toBe(true)
    }
    expect(changed).toBe(1) // the planted case; the benchmark's 100 decisions do not move
  })

  it('replay re-performs a 0.2.0 verdict from its inputs', () => {
    const v = run(PLANTED).verdict
    const check = verifyReplay(v, { ap: PLANTED, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } })
    expect(check).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
  })
})

// ---------------------------------------------------------------- the book's verdict door
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
type Claim = Verdict['claims'][number]
/** Rewrite a verdict self-consistently: outcome and coverage recomputed from the (edited) claims. */
function recount(v: Verdict, claims: Claim[]): Verdict {
  const pass = claims.filter((c) => c.outcome === 'PASS').length, fail = claims.filter((c) => c.outcome === 'FAIL').length
  const ins = claims.length - pass - fail
  return { ...v, claims, outcome: fail ? 'FAIL' : pass ? 'PASS' : 'INSUFFICIENT_DATA', coverage: { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins } }
}
const flipLine = (v: Verdict): Verdict => recount(v, clone(v.claims).map((c) => {
  if (c.claim_id !== 'ap.line[2].amount') return c
  const { variance: _v, ...rest } = c
  return { ...rest, outcome: 'PASS' as const, explanation: 'FORGED' }
}))

describe('the verdict door holds each version to its own rules', () => {
  // 2026-10-14: 0.3.0 (the default from engine 0.7.2) is held to the same line recompute as 0.2.0; until then the door let a 0.3.0 verdict through unchecked
  const genuine = [...cases.map((c) => splitApLayout(c.input)!), PLANTED].flatMap((d) => [run(d, V010).verdict, run(d, V020).verdict, run(d, V030).verdict])

  it('accepts every genuine verdict of every version (the book door and the HTTP door)', () => {
    expect(genuine.length).toBe(303)
    for (const v of genuine) {
      expect(recordedVerdictProblem(clone(v)), v.verdict_id).toBeUndefined()
      expect(verdictDoorProblem(clone(v)), v.verdict_id).toBeUndefined()
    }
  })

  it('refuses a 0.2.0 or 0.3.0 verdict whose line FAIL was flipped to PASS with outcome and coverage rewritten to match', () => {
    for (const rs of [V020, V030]) {
    const forged = flipLine(run(PLANTED, rs).verdict)
    expect(forged.outcome).toBe('PASS') // self-consistent: before 0.2.0's door this read as a valid PASS
    const why = /claim ap\.line\[2\]\.amount is PASS, but its own operands recompute to FAIL: 10 × 14\.25 = 142\.5 against 172\.5/
    expect(recordedVerdictProblem(forged)).toMatch(why)
    expect(verdictDoorProblem(forged)).toMatch(why)
    }
  })

  it('refuses a 0.2.0 or 0.3.0 verdict whose failing line claim was deleted, or whose tolerance was widened through its currency digits', () => {
    for (const rs of [V020, V030]) {
    const v = run(PLANTED, rs).verdict
    const deleted = recount(v, clone(v.claims).filter((c) => c.claim_id !== 'ap.line[2].amount'))
    expect(recordedVerdictProblem(deleted)).toMatch(/recomputes every line it prices, and claim ap\.line\[2\]\.amount is missing/)
    const widened = clone(v)
    const c = widened.claims.find((x) => x.claim_id === 'ap.line[1].amount')!
    c.computation!.operands.minor_unit_digits = 0
    expect(recordedVerdictProblem(widened)).toMatch(/minor_unit_digits 0 is not the minor unit of USD \(2\)/)
    const drifted = clone(v)
    drifted.claims.find((x) => x.claim_id === 'ap.line[2].amount')!.variance = 1
    expect(recordedVerdictProblem(drifted)).toMatch(/variance 1 does not recompute \(30\)/)
    }
  })

  it('on the book: a doctored RECORD with the hidden line FAIL breaks verification at that event, named', () => {
    const led = createLedger({ now: NOW })
    led.record(run(PLANTED).verdict, { tenant_id: 't1' }) // the default: ap-threeway@0.3.0 from engine 0.7.2
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const p0 = payloads[0] as { verdict: Verdict }
    p0.verdict = flipLine(p0.verdict)
    let prev = GENESIS
    const relinked: LedgerEvent[] = payloads.map((p, i) => {
      const ev = linkEvent(i, prev, { ts: events[i]!.ts, type: events[i]!.type, verdict_id: events[i]!.verdict_id, payload: p })
      prev = ev.entry_hash
      return ev
    })
    const book = new MemoryLedger({ seed: { events: relinked, payloads } })
    expect(book.verifyChain().ok).toBe(true) // the links are whole
    expect(book.verifyContent()).toMatchObject({ ok: false, brokenAt: 0, reason: expect.stringMatching(/does not pass the verdict door .*ap\.line\[2\]\.amount is PASS, but its own operands recompute to FAIL/) })
  })

  it('HONEST BOUNDARY: a FAIL rewritten as can\'t-tell, or operands rewritten with the outcome, need the documents (replay refuses it)', () => {
    const v = run(PLANTED).verdict
    const hidden = recount(v, clone(v.claims).map((c) => c.claim_id !== 'ap.line[2].amount' ? c
      : { claim_id: c.claim_id, kind: c.kind, tier: c.tier, outcome: 'INSUFFICIENT_DATA' as const, field: c.field, asserted: null, rule_id: c.rule_id, rule_name: c.rule_name, evidence: [], insufficiency: { reason: 'AMBIGUOUS_FIELD' as const, detail: 'FORGED' }, locked: false, explanation: 'FORGED' }))
    expect(apLineMathProblem(hidden)).toBeUndefined() // the door alone cannot tell this from a genuine abstention
    const check = verifyReplay(hidden, { ap: PLANTED, policy: { price_tolerance: 0.02, total_tolerance: 0.005 } })
    expect(check).toMatchObject({ ok: false, status: 'FAILED' }) // re-performed from the documents, it is refused
  })
})
