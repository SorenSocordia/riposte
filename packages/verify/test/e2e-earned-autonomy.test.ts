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
import { ENGINE_VERSION } from '../src/version'

// Re-pinned 2026-10-02 (typed remedies): the book records verdicts, and a non-PASS verdict now carries its remedies, so the
// book's bytes moved; nothing else did. Proven, not asserted: test/e2e-earned-autonomy-remedies.test.ts switches remedies off
// and gets the previous pins back byte for byte (book d227a3bb…, head 0e91336f…). Every other assertion here is unchanged.
const BOOK_SHA256 = '10d15faabf4ec81542989b69939d30c4f5048751181bdd82327d42f56802e544'
const HEAD = 'ab85fa8345a1729e1da422bd133c7ad25ed7d8dda139ebaf5ba93fd38a5eb06b'
const FIXTURE_SHA256 = 'b083277587eb39979e9300f0befc58706f411836a73bb43d8eaf36fbcc15b2b4'
// Engine 0.1.0 (2026-10-03). The pins above are the book engine 0.0.1 wrote, and the demo still writes it byte for byte
// when its verdicts are made under 0.0.1 (the describe below runs it so: not re-pinned). Under this build's engine the book
// moves in identity only, shown in the second describe: the same record, assessment, rungs, surveillance counts (the seeded
// draw picks its items by the book, so which items moves with the ids), decisions, attacks and replay, and a book that equals the 0.0.1 book once verdict ids, the engine stamp and the hashes, ids and signatures
// derived from them are set aside (checked line by line, 754 of 754, when these pins were taken). Pinned here so it cannot drift.
const BOOK_SHA256_E010 = '33b4da18cafe6899df8531b9982281426da79eeaa6967b4987919aa1ebb2a6a4'
const HEAD_E010 = '345a1f8b992d217a9ec9e3341c1de178f79b66d10ec7a67843d864d14dae9fc8'

describe('earned autonomy, end to end, on real data', () => {
  const lines: string[] = []
  // Engine 0.0.1: the engine these pins were taken under (see BOOK_SHA256_E010 for this build's).
  const r: DemoResult = runDemo({ log: l => lines.push(l), documents: true, engine: '0.0.1' })

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

describe('earned autonomy under engine 0.1.0: the same story, a new identity', () => {
  const old: DemoResult = runDemo({ log: () => {}, documents: true, engine: '0.0.1' })
  // 2026-10-03: the pins for the 0.1.0 book, taken under engine 0.1.0 and named so (the current engine is 0.2.0)
  const now: DemoResult = runDemo({ log: () => {}, documents: true, engine: '0.1.0' })
  /** Every hash, id and signature set aside: what is left is the story the book tells. */
  const story = (x: unknown): string => JSON.stringify(x).replace(/[0-9a-f]{12,}/g, 'H')
  it('names the current engine; everything else it pins is as under 0.0.1', () => {
    expect(now.versions).toEqual({ ...old.versions, engine: '0.1.0' })
    expect(ENGINE_VERSION).toBe('0.7.2') // 2026-10-04: 0.4.0, then 0.5.0; 2026-10-05: 0.6.0
  })
  it('the same record, assessment, rungs, surveillance, decisions, reconciliation, attacks and replay', () => {
    for (const k of ['record', 'assessment', 'ladder', 'demotion', 'after_decision', 'replay'] as const) expect(now[k], k).toEqual(old[k])
    for (const k of ['reconcile', 'attacks'] as const) expect(story(now[k]), k).toBe(story(old[k]))
    // The draw is seeded by the book, which carries the verdict ids, so WHICH verdicts are drawn moves with them (and so does
    // the drawn PASS the demo plants its synthetic miss on); the period, the population and the counts drawn do not.
    const { seed: _s1, synthetic_miss: m0, ...s0 } = old.surveillance
    const { seed: _s2, synthetic_miss: m1, ...s1 } = now.surveillance
    expect(s1).toEqual(s0)
    expect([typeof m0, typeof m1]).toEqual(['string', 'string'])
  })
  it('the whole book verifies and is byte-for-byte the one pinned for engine 0.1.0', () => {
    expect(now.chain).toEqual({ ok: true, length: 754, head: HEAD_E010, book_sha256: BOOK_SHA256_E010 })
  })
})
