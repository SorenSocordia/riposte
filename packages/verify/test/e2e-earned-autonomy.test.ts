/**
 * The earned-autonomy demo (examples/earned-autonomy), run in-process, so it can never silently rot. It walks the whole loop
 * on real 10-K data: keys, verdicts on a file ledger, signed reviews, the assessment, the grants, surveillance under autonomy,
 * a failure-basis demotion, the report, a completeness reconciliation, three attacks, and the whole book verified.
 *
 * The final book hash is pinned. If an intended change moves it (an engine version, a decision format, the policy), re-run
 * the demo, read the narrative, and re-pin it here with the reason. Never re-pin without reading what changed.
 */
import { describe, it, expect } from 'vitest'
import { runDemo, type DemoResult } from '../examples/earned-autonomy/demo'

const BOOK_SHA256 = 'd227a3bbc863dbf699afca439fea642e8ba04bfa84b740e40beadb7fadb17dd3'
const HEAD = '0e91336fdfa56e1e142a7aa2fbc44abd145640c8257758cb5610ba320c9dd180'
const FIXTURE_SHA256 = 'b083277587eb39979e9300f0befc58706f411836a73bb43d8eaf36fbcc15b2b4'

describe('earned autonomy, end to end, on real data', () => {
  const lines: string[] = []
  const r: DemoResult = runDemo({ log: l => lines.push(l), documents: true })

  it('pins what it ran: engine, schema, twin map v0.2 (statement-anchored), policy, fixture', () => {
    expect(r.versions).toEqual({
      engine: '0.0.1', schema: 'v0', ruleset: 'twin-xbrl-fs-core@0.2.0', map: 'twin-xbrl-fs-core@0.2.0', opinion: 'opinion-v0',
      policy: 'demo-10k-face-values@1.0.0', fixture_sha256: FIXTURE_SHA256,
    })
  })

  it('(b)(c) the record: 327 real verdicts, 291 signed reviews, the one real false flag', () => {
    expect(r.record).toEqual({ verdicts: 327, by_outcome: { PASS: 264, FAIL: 27, INSUFFICIENT_DATA: 36 }, reviewed: 291, overturned: 1 })
  })

  it('(d) the evidence earns autonomy at the routine tier and only advise at the high tier', () => {
    expect(r.assessment.earned).toBe('autonomy')
    expect(r.assessment.high_tier_earned).toBe('advise')
    expect(r.assessment.rungs.map(x => [x.rung, x.errors, x.n, x.cleared])).toEqual([['advise', 1, 27, true], ['gate', 1, 27, true], ['autonomy', 0, 264, true]])
    expect(r.assessment.rungs[2]!.upper).toBeCloseTo(1 - 0.1 ** (1 / 264), 6) // exact one-sided 90% bound on 0/264
  })

  it('(e) only a person moves the rung, one signed grant at a time', () => {
    expect(r.ladder).toEqual(['advise', 'gate', 'autonomy'])
  })

  it('(f) surveillance: a verifiable draw, and a (synthetic) post-grant miss raises an urgent failure-basis proposal', () => {
    expect(r.surveillance).toMatchObject({ period: '2026-11-01T00:00:00.000Z', population: { PASS: 76, FAIL: 11 }, drawn: { PASS: 8, FAIL: 11 }, rederived: true })
    expect(r.demotion).toEqual({ kind: 'DEMOTION_PROPOSAL', basis: 'failure', urgent: true, from: 'autonomy', to: 'gate', opinion_disposition: 'PROPOSE_DEMOTION' })
  })

  it('(g) the controller accepts: the book reads gate', () => {
    expect(r.after_decision.level).toBe('gate')
    // D-NO-FLIPFLOP (2026-09-28): the same-day re-ask this demo surfaced is fixed. After a step down on a failure, a return
    // to autonomy is argued from the evidence recorded since, alone; there is none yet, so nothing is asked.
    expect(r.after_decision.report_reasks_promotion).toBe(false)
  })

  it('(i) completeness: the planted override and bypass are found, and nothing else', () => {
    expect(r.reconcile.by_class).toEqual({ MATCHED: 76, MISMATCHED: 0, PAID_DESPITE_HOLD: 1, CHECKED_AFTER_PAYMENT: 0, AMBIGUOUS: 0, BYPASSED: 1, UNREADABLE: 0 })
    expect(r.reconcile.paid_despite_hold).toEqual(['P-0077'])
    expect(r.reconcile.bypassed).toEqual(['P-0078'])
    expect(r.reconcile.coverage).toMatchObject({ rows: 78, on_book: 77 })
  })

  it('the attacks fail: a self-grant, a forged outcome, a torn tail', () => {
    expect(r.attacks.door_refused).toBe(true)
    expect(r.attacks.spliced).toMatch(/fails closed/)
    expect(r.attacks.forged_replay).toBe('FAILED')
    expect(r.attacks.forged_structure_only).toBe('STRUCTURE_ONLY')
    expect(r.attacks.torn).toMatch(/opens read-only .* content verifies: true; an append is refused \(TornTailError\)/)
  })

  it('(j) the whole book verifies, every verdict re-performs, and the book is byte-for-byte the pinned one', () => {
    expect(r.replay).toEqual({ reperformed_from_fixture: 436, reperformed_from_filing: 15, total: 436 })
    expect(r.chain).toEqual({ ok: true, length: 754, head: HEAD, book_sha256: BOOK_SHA256 })
  })

  it('labels every synthetic element, and says the reviewer is a stand-in', () => {
    const text = lines.join('\n')
    for (const label of ['SYNTHETIC demo keys', 'SYNTHETIC MISS', 'SYNTHETIC population', 'GOLD LABELS', 'Not a human']) expect(text).toContain(label)
  })
})
