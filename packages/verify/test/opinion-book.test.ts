/**
 * The opinion reads the book (opinion lane, 2026-09-28): a person's signed decisions on the chain are what an opinion argues
 * from, and what it cites.
 *   - the snapshot verifies the whole book with the ledger's own reader (header-aware; F2), and a REVIEW refreshes the
 *     verdict's reviewer as the ledger does (F1);
 *   - a promotion / demotion opinion cites the GRANT in force as the decision its ruling would amend (P8), and a declaration
 *     or proposal that disagrees with the signed book is WITHHELD (a flag never overrides a signed grant);
 *   - a person's standing DECLINE shows as DECLINED, not a fresh ask (P9), until the evidence it saw changes; then the
 *     proposal is raised again and the lapse is said;
 *   - with no decision for the workflow on the book, the rung is the caller's declaration, and P8 says so.
 */
import { describe, it, expect } from 'vitest'
import {
  createLedger, signDecision, verifyChainAgainst, parseChainJSONL, type Ledger,
} from '../src/ledger/index'
import {
  assessVoiceFromLedger, declineDecision, revisePolicy, type VoiceLevel,
} from '../src/verdict/voice'
import {
  promotionOpinion, renderOpinion, openSnapshot, snapshotOfLedger, snapshotFromChainJSONL, opinionIntact, type Opinion,
} from '../src/opinion/index'
import { buildLedger, freshClock, WF } from './fixtures/voice-ledger'
import { OWNER, TRUSTED, TINY, grant } from './fixtures/opinion-book'

const premise = (op: Opinion, id: string) => op.premises.find(p => p.id === id)!

/** A book whose evidence clears autonomy under TINY (12 clean PASSes, 8 clean FAILs), with a person's GRANT of `level`. */
function grantedBook(level: VoiceLevel, o: { passOverturned?: number } = {}): { ledger: Ledger; grantId: string; grantSeq: number; grantHash: string } {
  // D-ANCHOR (security fix): the ledger anchors its signer, or the grant has no effect (see the unanchored tests below).
  const ledger = createLedger({ now: freshClock(), trusted_keys: TRUSTED })
  buildLedger({ ledger, passes: 12, fails: 8, ...(o.passOverturned ? { passOverturned: o.passOverturned } : {}) })
  const e = ledger.decide(grant(WF(), level))
  return { ledger, grantId: e.decision_id, grantSeq: e.seq, grantHash: e.entry_hash }
}

describe('the snapshot reads the whole book (F1, F2)', () => {
  it('F2: a relabelled event header (not covered by entry_hash) used to pass the payload check; the opinion now WITHHOLDS', () => {
    const { ledger } = buildLedger({ passes: 3, fails: 3 })
    const { events, payloads } = parseChainJSONL(ledger.chainJSONL())
    const i = events.findIndex(e => e.type === 'REVIEW')
    const other = events.find(e => e.type === 'RECORD' && e.verdict_id !== events[i]!.verdict_id)!.verdict_id
    const relabelled = events.map((e, k) => (k === i ? { ...e, verdict_id: other } : e))
    // the gap was real: the payload-only check passes the relabelled chain
    expect(verifyChainAgainst(relabelled, ev => payloads[ev.seq]).ok).toBe(true)
    const view = openSnapshot({ events: relabelled, payloads })
    expect(view.content_verified).toBe(false)
    const op = promotionOpinion({ snapshot: { events: relabelled, payloads }, policy: TINY, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'record' } })
    expect(op.ruling.disposition).toBe('WITHHELD')
    expect(premise(op, 'P1').statement).toMatch(new RegExp(`FAILED its integrity check at event ${i}: event ${i}'s header \\(verdict_id, ts\\) does not match its hashed REVIEW payload`))
    expect(premise(op, 'P1').check).toMatch(/^readDecisionBook \(ledger\/decisions\)/)
  })

  it('F1: the rebuilt records equal the ledger\'s, reviewer included (a REVIEW refreshes verdict.ledger.reviewer)', () => {
    const { ledger } = buildLedger({ passes: 4, fails: 4, failOverturned: 1 })
    const rebuilt = openSnapshot(snapshotOfLedger(ledger)).records
    expect(rebuilt).toEqual(ledger.all())
    expect(rebuilt.find(r => r.review?.decision === 'OVERTURNED')!.verdict.ledger!.reviewer).toMatchObject({ id: 'ap-lead', decision: 'OVERTURNED' })
  })

  it('decision events are verified and exposed; REVIEW events alone are filed as reviews (D7)', () => {
    const { ledger, grantId } = grantedBook('gate')
    const view = openSnapshot(snapshotOfLedger(ledger), { trusted_keys: TRUSTED })
    expect(view.content_verified).toBe(true)
    expect(view.decisions.map(d => d.decision_id)).toEqual([grantId])
    expect(view.unanchored).toEqual([])
    // D-ANCHOR (security fix): was `openSnapshot(snapshotOfLedger(ledger)).unanchored` = ['owner']. A snapshot of a live
    // ledger now carries that ledger's own anchors; a bare chain export read without anchors still names the signer.
    expect(openSnapshot(snapshotOfLedger(ledger)).unanchored).toEqual([])
    expect(openSnapshot(snapshotFromChainJSONL(ledger.chainJSONL())).unanchored).toEqual(['owner'])
    expect(view.eventsFor(`workflow:${WF()}`)).toEqual({})
  })
})

describe('the GRANT in force: the decision a ruling would amend', () => {
  it('asked by workflow alone: the rung is read from the book, cited (P8), and the ruling names the grant it would supersede', () => {
    const { ledger, grantId, grantSeq, grantHash } = grantedBook('gate')
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF(), trusted_keys: TRUSTED })
    expect(op.verified).toBe(true)
    expect(op.ruling.disposition).toBe('PROPOSE_PROMOTION')
    expect(op.subject).toMatchObject({ kind: 'PROMOTION', granted: 'gate', focus: 'autonomy', rung_source: 'BOOK', amends: { decision_id: grantId, seq: grantSeq, entry_hash: grantHash } })
    const p8 = premise(op, 'P8')
    expect(p8.verified).toBe(true)
    expect(p8.refs).toEqual([{ kind: 'decision', decision_kind: 'GRANT', decision_id: grantId, seq: grantSeq, entry_hash: grantHash }])
    expect(p8.statement).toMatch(new RegExp(`GRANT \`${grantId}\` \\(seq ${grantSeq}\\) sets \`acme/invoice@0\\.0\\.1\` at \`gate\`, signed by owner at 2026-09-28T09:00:00Z, under policy tiny-test@1\\.0\\.0 at tier 'low'\\. A ruling here would amend that grant`))
    expect(p8.statement).not.toMatch(/not anchored/)
    expect(op.ruling.takes_effect).toMatch(new RegExp(`^only on a person's signature: a new signed GRANT of \`autonomy\` on the book, answering proposal \`[0-9a-f]{12}…\` and superseding GRANT \`${grantId.slice(0, 12)}…\` \\(seq ${grantSeq}\\)`))
    expect(op.ruling.note).toMatch(new RegExp(`\\(GRANT \`${grantId.slice(0, 12)}…\`, seq ${grantSeq} on the book of record\\)\\. A ruling here amends that grant`))
    const md = renderOpinion(op)
    expect(md).toMatch(new RegExp(`- \\*\\*Amends:\\*\\* GRANT \`${grantId.slice(0, 12)}…\` \\(seq ${grantSeq}\\)`))
    expect(md).toMatch(new RegExp(`GRANT \`${grantId.slice(0, 12)}…\` \\(#${grantSeq} `))
    expect(opinionIntact(op)).toBe(true)
  })

  // D-ANCHOR (security fix): this test used to show an unanchored grant still setting the rung, with its signer merely
  // "named unanchored" in P8. An unanchored grant now has NO effect: P8 names it, with the notice, and the rung is record.
  it('without anchors the grant is on the book but has no effect: P8 names it with the notice, and the rung is record', () => {
    const { ledger, grantId, grantSeq } = grantedBook('gate')
    const bare = snapshotFromChainJSONL(ledger.chainJSONL()) // a chain export carries no anchors
    expect(() => promotionOpinion({ snapshot: bare, policy: TINY, workflow_id: WF() })).toThrow(/no anchored GRANT .* is not anchored: it has no effect/)
    const op = promotionOpinion({ snapshot: bare, policy: TINY, workflow_id: WF(), consequence_tier: 'low' })
    expect(op.subject).toMatchObject({ granted: 'record', rung_source: 'BOOK' })
    expect(op.subject).not.toHaveProperty('amends')
    const notice = `GRANT \`${grantId.slice(0, 12)}\` by owner at 2026-09-28T09:00:00Z (seq ${grantSeq}) is not anchored: it has no effect (acme/invoice@0.0.1 is not moved to gate); anchor the signer with --trusted-keys / --root-keys`
    expect(premise(op, 'P8').statement).toContain(`No anchored GRANT for \`acme/invoice@0.0.1\` is on the book of record`)
    expect(premise(op, 'P8').statement).toContain(notice)
    // a declaration that says gate is argued as the caller's declaration (the grant is not the book's), and P8 still names it
    const asked = promotionOpinion({ snapshot: bare, policy: TINY, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } })
    expect(asked.subject).toMatchObject({ rung_source: 'DECLARED', granted: 'gate' })
    expect(premise(asked, 'P8').statement).toContain(notice)
  })

  it('a declaration or proposal that agrees with the book argues from it; one that disagrees is WITHHELD (a flag never overrides a signed grant)', () => {
    const { ledger } = grantedBook('gate')
    const snap = snapshotOfLedger(ledger)
    const agree = promotionOpinion({ snapshot: snap, policy: TINY, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } })
    expect(agree.verified).toBe(true)
    expect(agree.subject).toMatchObject({ rung_source: 'BOOK' })
    const proposal = assessVoiceFromLedger(ledger, WF(), TINY).proposal!
    const viaProposal = promotionOpinion({ snapshot: snap, policy: TINY, proposal })
    expect(viaProposal.verified).toBe(true)
    expect(premise(viaProposal, 'P7').detail).toMatch(/re-derived exactly/)
    const disagree = promotionOpinion({ snapshot: snap, policy: TINY, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'autonomy', bounds: 'all' } })
    expect(disagree.ruling.disposition).toBe('WITHHELD')
    expect(premise(disagree, 'P8').detail).toMatch(/the declaration says `autonomy`, but the book says `gate`/)
    expect(premise(disagree, 'P8').statement).toMatch(/A flag never overrides a person's signed grant/)
  })

  it('a grant made under one policy is not argued under another: WITHHELD, settings fixed at grant', () => {
    const { ledger } = grantedBook('gate')
    const v2 = revisePolicy(TINY, { version: '1.1.0', tiers: [{ ...TINY.tiers[0]!, autonomy: { min_n: 10, max_error: 0.25 } }] }, { revised_by: 'owner', revised_at: '2026-09-28T09:30:00Z', reason: 'tighter autonomy' })
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: v2, workflow_id: WF() })
    expect(op.ruling.disposition).toBe('WITHHELD')
    expect(premise(op, 'P8').detail).toMatch(/the grant was made under policy tiny-test@1\.0\.0 .* not tiny-test@1\.1\.0 .*settings are fixed at grant time/)
  })

  it('no decision for the workflow on the book: the rung is the caller\'s declaration, and P8 says so (the flag path, unchanged otherwise)', () => {
    const { ledger } = buildLedger({ passes: 12, fails: 8 })
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ rung_source: 'DECLARED' })
    expect(op.subject).not.toHaveProperty('amends')
    expect(premise(op, 'P8').statement).toMatch(/No signed GRANT or DECLINE for `acme\/invoice@0\.0\.1` is on the book of record: the rung `gate` is the caller's declaration/)
    expect(op.ruling.takes_effect).toBe('only on a person\'s signature. Declining costs nothing.')
  })

  it('asked by workflow alone with nothing granted: the rung is record, and the tier must be declared', () => {
    const { ledger } = buildLedger({ passes: 12, fails: 8 })
    const snap = snapshotOfLedger(ledger)
    expect(() => promotionOpinion({ snapshot: snap, policy: TINY, workflow_id: WF() })).toThrow(/no consequence_tier was declared/)
    ledger.decide(grant('acme/other@1', 'advise')) // a decision on the book, for another workflow
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF(), consequence_tier: 'low' })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ granted: 'record', rung_source: 'BOOK' })
    expect(premise(op, 'P8').statement).toMatch(/No GRANT for `acme\/invoice@0\.0\.1` is on the book of record: nothing is granted, so the rung is `record`/)
  })
})

describe('a person\'s standing DECLINE: shown as declined, never a fresh ask', () => {
  it('a declined DEMOTION ("keep it"): DECLINED, not urgent, quoted with who/when/why; a new failing case lapses it and the ask returns', () => {
    const { ledger } = grantedBook('autonomy', { passOverturned: 4 })
    const a = assessVoiceFromLedger(ledger, WF(), TINY)
    expect(a.proposal).toMatchObject({ kind: 'DEMOTION_PROPOSAL', from: 'autonomy', to: 'gate' })
    const urgent = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF() })
    expect(urgent.ruling).toMatchObject({ disposition: 'PROPOSE_DEMOTION', urgent: true })
    expect(urgent.ruling.takes_effect).toMatch(/a signed DECLINE \("keep it"\) is recorded and not asked again until a new failing case/)

    const d = ledger.decide(signDecision(declineDecision(a, { signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z', reason: 'keep it: quarter-end close, reviewing daily' }), OWNER.privateKeyPem))
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF(), trusted_keys: TRUSTED })
    expect(op.verified).toBe(true)
    expect(op.ruling.disposition).toBe('DECLINED')
    expect(op.ruling.urgent).toBeUndefined()
    expect(op.ruling.favors).toBe('A')
    expect(op.ruling.declined).toMatchObject({ decision_id: d.decision_id, seq: d.seq, signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z', reason: 'keep it: quarter-end close, reviewing daily', proposal_kind: 'DEMOTION_PROPOSAL' })
    expect(op.ruling.statement).toMatch(/^Kept on the record: owner kept `acme\/invoice@0\.0\.1` at `autonomy` at 2026-09-28T10:00:00Z \("keep it: quarter-end close, reviewing daily"\), declining the step down to `gate`\. The decline stands/)
    expect(op.ruling.takes_effect).toMatch(/^nothing changes: a person already answered this proposal\. The workflow stays at `autonomy`/)
    expect(op.subject).toMatchObject({ question_kind: 'DEMOTE', proposal_id: a.proposal!.proposal_id, declined: { decision_id: d.decision_id, seq: d.seq, entry_hash: d.entry_hash } })
    expect(op.title).toMatch(/^Kept at autonomy by a person/)
    expect(op.question).toMatch(/a person has already declined stepping it down to `gate` \(owner, 2026-09-28T10:00:00Z\)\. Does that decline still stand\?/)
    const p9 = premise(op, 'P9')
    expect(p9.verified).toBe(true)
    expect(p9.refs).toEqual([{ kind: 'decision', decision_kind: 'DECLINE', decision_id: d.decision_id, seq: d.seq, entry_hash: d.entry_hash }])
    expect(p9.statement).toMatch(/It stands until a new failing case .* so the demotion is shown as declined, not asked again/)
    expect(op.overturn[0]!.evidence).toMatch(/^a new failing case/)
    expect(op.overturn.some(c => /re-granting the workflow/.test(c.evidence))).toBe(true)
    const md = renderOpinion(op)
    expect(md).not.toMatch(/URGENT/)
    expect(md).toMatch(/disposition \*\*DECLINED\*\*/)
    expect(md).toMatch(/- \*\*Kept by:\*\* owner at 2026-09-28T10:00:00Z \(DECLINE `[0-9a-f]{12}…`, seq \d+\): "keep it: quarter-end close, reviewing daily"; stands until a new failing case/)
    // arguing the declined proposal itself is not a doctored proposal: it re-derives, and is DECLINED
    const viaProposal = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, proposal: a.proposal! })
    expect(viaProposal.verified).toBe(true)
    expect(viaProposal.ruling.disposition).toBe('DECLINED')

    // a new failing case (a PASS a person overturns): the case against the grant grew, so the decline lapses
    buildLedger({ ledger, passes: 1, fails: 0, passOverturned: 1, prefix: 'late' })
    const again = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF() })
    expect(again.ruling).toMatchObject({ disposition: 'PROPOSE_DEMOTION', urgent: true })
    expect(premise(again, 'P9').statement).toMatch(/It no longer stands: the evidence against the grant changed since the decline: 1 new failing case/)
    expect(again.ruling.note).toMatch(/A person declined an earlier proposal \(owner, 2026-09-28T10:00:00Z: "keep it: quarter-end close, reviewing daily"\); it lapsed/)
  })

  it('a declined PROMOTION: DECLINED (stay), until a fresh sample of the rung\'s own min_n accrues; then it is asked again', () => {
    const { ledger } = grantedBook('gate')
    const a = assessVoiceFromLedger(ledger, WF(), TINY)
    expect(a.proposal).toMatchObject({ kind: 'PROMOTION_PROPOSAL', to: 'autonomy' })
    ledger.decide(signDecision(declineDecision(a, { signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z', reason: 'not before the audit' }), OWNER.privateKeyPem))
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF() })
    expect(op.ruling).toMatchObject({ disposition: 'DECLINED', favors: 'B' })
    expect(op.title).toBe('Not now, by a person: promote `acme/invoice@0.0.1` from gate to autonomy')
    expect(op.ruling.statement).toMatch(/\("not before the audit"\)\. The decline stands until 8 more reviewed PASS verdict\(s\)/)
    buildLedger({ ledger, passes: 8, fails: 0, prefix: 'fresh' })
    const again = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF() })
    expect(again.ruling.disposition).toBe('PROPOSE_PROMOTION')
    expect(premise(again, 'P9').statement).toMatch(/It no longer stands: 8 fresh reviewed PASS verdict\(s\) since the decline/)
  })

  it('is deterministic: the same book gives the same opinion, byte for byte, through a chain export', () => {
    const { ledger } = grantedBook('autonomy', { passOverturned: 4 })
    const a = assessVoiceFromLedger(ledger, WF(), TINY)
    ledger.decide(signDecision(declineDecision(a, { signer_id: 'owner', signed_at: '2026-09-28T10:00:00Z', reason: 'keep it' }), OWNER.privateKeyPem))
    const x = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: TINY, workflow_id: WF() })
    // D-ANCHOR: a chain export carries no anchors, so it is read with the same keys the live ledger holds (x uses its own).
    const y = promotionOpinion({ snapshot: snapshotFromChainJSONL(ledger.chainJSONL()), policy: TINY, workflow_id: WF(), trusted_keys: TRUSTED })
    expect(JSON.stringify(y)).toBe(JSON.stringify(x))
  })
})
