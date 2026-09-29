/**
 * The courtroom opinion (src/opinion): the fixed format, over a real book of record (real verify() verdicts through
 * the real ledger), with every premise verified by Riposte's own checks.
 *
 *  - the headings, in the fixed order; readings with cited cells; the dissent's minimum topics; what would overturn it;
 *  - every factual premise cites replayable ids, and they replay (verdict ids re-derive; evidence-set hashes re-derive;
 *    ledger events exist on the chain);
 *  - SELF-VERIFYING: a doctored proposal, a tampered chain, or records without a chain → WITHHELD (proposes nothing);
 *  - an opinion is COUNSEL: it can never be serialized as a VERDICT; its id re-derives from its content;
 *  - disputes: UPHOLD, REFER (a rule on the review queue), abstentions upheld, input binding.
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  promotionOpinion, disputeOpinion, renderOpinion, opinionJSON, snapshotOfLedger, snapshotFromChainJSONL, opinionIntact,
  assessVoice, workflowCalibration, consecutiveErrorsToBreach, verifyReplay, hashOf, channelOf, serializeVerdict, policyRef,
  ChannelViolation, EXAMPLE_PROMOTION_POLICY, verify,
  type Opinion, type PromotionProposal,
} from '../src/index'
import { buildLedger, WF } from './fixtures/voice-ledger'
import { broken, clean, FIXED_NOW } from './fixtures/invoices'
import { withLegacyRecord } from './fixtures/legacy-ledger'

/**
 * A verdict whose SUM_INT PASS finding is judgement-tier (tier is not in verdict_id, so the id still re-derives). The door
 * (assertVerdict at ledger.record, 2026-09-28) refuses it, so it can only sit on a chain written before the door; the
 * opinion must still treat it as an advisory. Returns the reopened ledger carrying it.
 */
function recordReasoned(ledger: ReturnType<typeof buildLedger>['ledger']): { id: string; ledger: ReturnType<typeof buildLedger>['ledger'] } {
  const v = structuredClone(verify({ ...clean, invoice_number: 'REASONED-1' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))
  v.claims.find(c => c.claim_id === 'document.SUM_INT')!.tier = 'REASONED'
  expect(() => ledger.record(v, { tenant_id: 'judgement' })).toThrow(/judgement-tier \(REASONED\) finding/)
  return { id: v.verdict_id, ledger: withLegacyRecord(ledger, v, { tenant_id: 'judgement', review: { reviewer_id: 'ap-lead', decision: 'UPHELD' } }) }
}

const P = EXAMPLE_PROMOTION_POLICY
const HEADINGS = [
  '## The question', '## The candidate readings', '## The authorities', '## Precedent',
  '## The footing consequences of each reading', '## The ruling and its scope', '## The steelmanned dissent',
  '## What would overturn it', '## Premises, each verified by Riposte\'s own checks',
]

/** 130 clean PASSes (all upheld) and 60 FAILs (2 overturned as false alarms): earns autonomy at the 'low' tier. */
function strongBook() {
  return buildLedger({ passes: 130, fails: 60, failOverturned: 2 })
}

function proposalFor(ledger: ReturnType<typeof buildLedger>['ledger'], granted: 'record' | 'advise' | 'gate' = 'gate'): PromotionProposal {
  const a = assessVoice(workflowCalibration(ledger.all(), WF()), { workflow_id: WF(), consequence_tier: 'low', granted, bounds: 'PO-matched invoices under $1,000' }, P)
  expect(a.proposal).toBeDefined()
  return a.proposal!
}

function expectHeadingsInOrder(md: string): void {
  let at = -1
  for (const h of HEADINGS) {
    const i = md.indexOf(h)
    expect(i, h).toBeGreaterThan(at)
    at = i
  }
}

/** Every ref an opinion cites must replay against the ledger it came from. */
function expectRefsReplay(op: Opinion, ledger: ReturnType<typeof buildLedger>['ledger']): void {
  const events = ledger.events()
  for (const p of op.premises) {
    expect(p.refs.length, `${p.id} cites nothing`).toBeGreaterThan(0)
    for (const r of p.refs) {
      if (r.kind === 'verdict') {
        const rec = ledger.get(r.verdict_id)
        expect(rec, r.verdict_id).toBeDefined()
        expect(verifyReplay(rec!.verdict).id_ok).toBe(true)
        if (r.record_event) expect(events[r.record_event.seq]!.entry_hash).toBe(r.record_event.entry_hash)
        if (r.review_event) expect(events[r.review_event.seq]!.entry_hash).toBe(r.review_event.entry_hash)
      } else if (r.kind === 'evidence_set') {
        expect(hashOf([...r.verdict_ids].sort())).toBe(r.hash)
        expect(r.verdict_ids).toHaveLength(r.count)
        for (const id of r.verdict_ids) expect(verifyReplay(ledger.get(id)!.verdict).id_ok).toBe(true)
      } else if (r.kind === 'ledger_head') {
        expect(r.head).toBe(ledger.chainHead())
        expect(r.length).toBe(events.length)
      } else if (r.kind === 'policy') {
        expect(r.hash).toBe(hashOf(P))
      }
    }
  }
  const ids = new Set(op.premises.map(p => p.id))
  for (const rd of op.readings) for (const c of rd.cells) expect(ids.has(c.premise), `${c.cell} → ${c.premise}`).toBe(true)
}

describe('promotion opinion — the referee asking for a raise', () => {
  const { ledger } = strongBook()
  const proposal = proposalFor(ledger)
  const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, proposal })
  const md = renderOpinion(op)

  it('proposes the promotion, verified, under the fixed headings in order', () => {
    expect(op.verified).toBe(true)
    expect(op.ruling).toMatchObject({ disposition: 'PROPOSE_PROMOTION', favors: 'A', status: 'PROPOSED' })
    expect(op.ruling.takes_effect).toMatch(/only on a person's signature/)
    expect(op.subject).toMatchObject({ kind: 'PROMOTION', question_kind: 'PROMOTE', granted: 'gate', focus: 'autonomy', proposal_id: proposal.proposal_id })
    expectHeadingsInOrder(md)
    expect(md).toMatch(/Should workflow `acme\/invoice@0\.0\.1` \(consequence tier 'low'\) be promoted from `gate` to `autonomy` within "PO-matched invoices under \$1,000"\?/)
    expect(op.readings.map(r => r.id)).toEqual(['A', 'B'])
    expect(md).toMatch(/_Cites the same cells as Reading A, plus:_/)
  })

  it('every factual premise cites replayable ids, and every one replays', () => {
    expect(op.premises.every(p => p.verified)).toBe(true)
    expectRefsReplay(op, ledger)
  })

  it('the dissent is steelmanned on at least sample size, the interval, the counter-cases, and the consequence tier', () => {
    const topics = op.dissent.map(d => d.topic)
    for (const t of ['sample_size', 'confidence_interval', 'counter_cases', 'consequence_tier'] as const) expect(topics).toContain(t)
    const cc = op.dissent.find(d => d.topic === 'counter_cases')!.argument
    expect(cc).toMatch(/No counter-case bears directly on autonomy/)       // 0 PASS overturned
    expect(cc).toMatch(/2 FAIL verdict\(s\) a person overturned/)           // the false alarms beneath it, named as such
    expect(op.dissent.find(d => d.topic === 'consequence_tier')!.argument).toMatch(/tier 'moderate'.*does not/)
  })

  it('"what would overturn it" names the exact evidence that would demote, and the count is the assessment\'s own', () => {
    const r = proposal.rungs.find(x => x.rung === 'autonomy')!
    const j = consecutiveErrorsToBreach(r.errors, r.n, r.bar.max_error, r.confidence, r.method)
    expect(op.overturn.map(c => c.evidence)).toContain(`${j} more overturned PASS verdicts in a row (no clean review between)`)
    expect(op.overturn.find(c => c.evidence.startsWith(`${j} more overturned PASS`))!.effect).toMatch(/raises an urgent proposal to step down to `gate`, and a person decides/)
    expect(op.overturn.some(c => /a person declines to sign/.test(c.evidence))).toBe(true)
    expect(op.overturn.some(c => /new ruleset or engine version/.test(c.evidence))).toBe(true)
  })

  it('is COUNSEL: generated, dismissible, and never serializable as a VERDICT', () => {
    expect(channelOf(op)).toBe('COUNSEL')
    expect(op.provenance).toMatchObject({ type: 'GENERATED', generator: 'riposte-opinion', source_hash: ledger.chainHead() })
    expect(op.dismissible).toBe(true)
    expect(op.judges.every(j => j.passed)).toBe(true)
    expect(() => serializeVerdict(op)).toThrow(ChannelViolation)
  })

  it('is deterministic and self-identifying: same book, same opinion id; an edited opinion no longer matches its id', () => {
    const again = promotionOpinion({ snapshot: snapshotFromChainJSONL(ledger.chainJSONL()), policy: P, proposal })
    expect(again.opinion_id).toBe(op.opinion_id)
    expect(opinionJSON(again)).toBe(opinionJSON(op))
    expect(opinionIntact(op)).toBe(true)
    expect(opinionIntact({ ...op, ruling: { ...op.ruling, statement: 'Approved.' } })).toBe(false)
  })
})

describe('SELF-VERIFYING: a premise that fails its check withholds the ruling', () => {
  const { ledger } = strongBook()
  const proposal = proposalFor(ledger)

  it('a doctored proposal (a rung inflated, or a skipped rung) is WITHHELD', () => {
    const inflated: PromotionProposal = structuredClone(proposal)
    inflated.rungs[2]!.n = 5000
    const a = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, proposal: inflated })
    expect(a.verified).toBe(false)
    expect(a.ruling.disposition).toBe('WITHHELD')
    expect(a.ruling.favors).toBeNull()
    expect(a.premises.find(p => p.id === 'P6')!.verified).toBe(false)
    expect(a.premises.find(p => p.id === 'P7')!.detail).toMatch(/does not match its own id/)
    const skipped = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, proposal: { ...proposal, from: 'record' } })
    expect(skipped.ruling.disposition).toBe('WITHHELD') // the evidence produces record → advise, not this proposal
    expect(renderOpinion(skipped)).toMatch(/No ruling is proposed/)
  })

  it('a proposal computed under another policy is WITHHELD', () => {
    const other = { ...P, version: '0.3.0' } // E13: EXAMPLE is 0.2.0 now, so another version is 0.3.0
    const a = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: other, proposal })
    expect(a.ruling.disposition).toBe('WITHHELD')
    expect(a.premises.find(p => p.id === 'P5')!.detail).toMatch(/the proposal cites policy/)
  })

  it('a tampered chain (one payload altered on disk) is WITHHELD', () => {
    const lines = ledger.chainJSONL().split('\n')
    const ev = JSON.parse(lines[3]!)
    ev.payload.verdict.outcome = 'FAIL'
    lines[3] = JSON.stringify(ev)
    const a = promotionOpinion({ snapshot: snapshotFromChainJSONL(lines.join('\n')), policy: P, proposal })
    expect(a.premises[0]!.verified).toBe(false)
    expect(a.premises[0]!.statement).toMatch(/FAILED its integrity check at event 3/)
    expect(a.ruling.disposition).toBe('WITHHELD')
  })

  it('records without a chain cannot be shown to be the ledger\'s: WITHHELD', () => {
    const a = promotionOpinion({ snapshot: { records: ledger.all() }, policy: P, proposal })
    expect(a.premises[0]!.statement).toMatch(/No chain was supplied/)
    expect(a.ruling.disposition).toBe('WITHHELD')
  })
})

describe('promotion opinion — the other questions the evidence can pose', () => {
  it('NOT YET: thin evidence stays put, and the dissent argues the case for promotion', () => {
    const { ledger } = buildLedger({ passes: 40, fails: 60, failOverturned: 2 })
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } })
    expect(op.verified).toBe(true)
    expect(op.ruling).toMatchObject({ disposition: 'NOT_YET', favors: 'B' })
    expect(op.ruling.statement).toMatch(/40 reviewed PASS verdicts < minimum 100/)
    expect(op.dissent.find(d => d.topic === 'sample_size')!.argument).toMatch(/The shortfall is volume, not error.*60 more reviewed PASSes with no overturn would clear autonomy/)
    expect(op.overturn.map(c => c.evidence)).toContain('60 more reviewed PASS verdicts with no overturn')
    expectHeadingsInOrder(renderOpinion(op))
  })

  it('PROPOSE_DEMOTION (the ruling): misses under a granted autonomy raise an URGENT proposal in the same format; nothing moves until a person decides', () => {
    const { ledger } = buildLedger({ passes: 130, fails: 60, passOverturned: 6, failOverturned: 2 })
    const decl = { workflow_id: WF(), consequence_tier: 'low', granted: 'autonomy' as const }
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: decl })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ question_kind: 'DEMOTE', granted: 'autonomy', earned: 'gate', to: 'gate' })
    expect(op.ruling).toMatchObject({ disposition: 'PROPOSE_DEMOTION', urgent: true, favors: 'B', status: 'PROPOSED' })
    expect(op.ruling.takes_effect).toMatch(/^only on a person's decision\. Until then the workflow stays at `autonomy`: it lets PASSes proceed unreviewed within the declared bounds; each FAIL or ABSTAIN is still held until a person resolves it\. Every FAIL stays visible and disputable\./)
    expect(op.precedent.entries).toHaveLength(8) // 6 missed PASSes + 2 false-alarm FAILs, all adverse
    expect(op.precedent.entries.filter(e => e.outcome === 'PASS').every(e => e.note === 'paid twice: the agent matched the wrong PO')).toBe(true)
    for (const e of op.precedent.entries) expect(e.dispute).toBe(`verify opinion --ledger <chain.jsonl> --dispute ${e.verdict_id}`) // listed for dispute
    const md = renderOpinion(op)
    expect(md).toMatch(/^# Opinion: URGENT: step `acme\/invoice@0\.0\.1` down from autonomy to gate\?/)
    expect(md).toMatch(/· \*\*URGENT\*\* · disposition \*\*PROPOSE_DEMOTION\*\*/)
    expect(md).toMatch(/dispute: `verify opinion --ledger <chain\.jsonl> --dispute /)
    expect(op.readings[0]!.label).toBe('Keep autonomy')
    expect(op.overturn.some(c => /a person deciding to keep the rung/.test(c.evidence))).toBe(true)
    expect(op.overturn.some(c => /a successful dispute of a failing case/.test(c.evidence))).toBe(true)
    expectHeadingsInOrder(md)
    expectRefsReplay(op, ledger)
    // the demotion proposal itself, argued as a proposal: verified, and exactly what the evidence produces
    const a = assessVoice(workflowCalibration(ledger.all(), WF()), decl, P)
    expect(a.level).toBe('autonomy')
    const viaProposal = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, proposal: a.proposal! })
    expect(viaProposal.verified).toBe(true)
    expect(viaProposal.ruling.disposition).toBe('PROPOSE_DEMOTION')
  })

  it('RETAIN: a granted autonomy whose record still clears keeps it; a grant names its fixed settings', () => {
    const { ledger } = strongBook()
    const op = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'autonomy' } })
    expect(op.ruling).toMatchObject({ disposition: 'RETAIN', favors: 'A' })
    const grant = { level: 'gate' as const, signer_id: 'cfo', signed_at: '2026-09-28T09:00:00Z', policy: policyRef(P), consequence_tier: 'low' }
    const o = promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate', grant } })
    expect(o.ruling.note).toMatch(/`gate` was granted by cfo at 2026-09-28T09:00:00Z, under policy example-illustrative@0\.2\.0 at tier 'low'\. Those settings stay fixed/) // E13: the fixed body is 0.2.0
  })
})

describe('the authorities are quoted, not recalled', () => {
  it('every quote an opinion attributes to our own schema doc appears in it verbatim (each … fragment)', () => {
    const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'VERDICT-SCHEMA-v0.md'), 'utf8')
    const plain = doc.replace(/[`*]/g, '').replace(/\s+/g, ' ')
    const { ledger: built, failIds, passIds } = buildLedger({ passes: 130, fails: 60, failOverturned: 2, passOverturned: 6 })
    const { id: reasonedId, ledger } = recordReasoned(built)
    const ops = [
      promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'gate' } }),
      promotionOpinion({ snapshot: snapshotOfLedger(ledger), policy: P, declaration: { workflow_id: WF(), consequence_tier: 'low', granted: 'autonomy' } }),
      disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[0]! }),
      disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: passIds[0]!, claim_id: 'document.SUM_INT' }),
      disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: reasonedId, claim_id: 'document.SUM_INT' }),
    ]
    expect(ops[1]!.ruling.disposition).toBe('PROPOSE_DEMOTION')
    let checked = 0
    for (const op of ops) for (const a of op.authorities) {
      if (!/VERDICT-SCHEMA/.test(a.cite)) continue
      for (const frag of a.quote.split(' … ')) {
        expect(plain, `${a.cite}: "${frag}"`).toContain(frag.replace(/\s+/g, ' '))
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12)
  })
})

describe('dispute opinion — FACT replays; LAW is a person\'s', () => {
  it('UPHOLD: a FAIL on a rule the field trusts stands; the readings cite the operand cells', () => {
    const { ledger, failIds } = buildLedger({ passes: 5, fails: 30, failOverturned: 2 })
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[10]!, claim_id: 'document.SUM_INT' })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ kind: 'DISPUTE', claim_id: 'document.SUM_INT', rule_id: 'SUM_INT', outcome: 'FAIL' })
    expect(op.ruling).toMatchObject({ disposition: 'UPHOLD', favors: 'A' })
    const cells = op.readings[0]!.cells.map(c => c.cell)
    expect(cells).toContain('invoice:totals.subtotal (confidence 100)')
    expect(op.readings[0]!.statement).toMatch(/The two sides of `Σ line_items\[i\]\.amount = subtotal` disagree for `subtotal`: 1775 against 1750\.5/)
    expect(op.readings[1]!.consequence).toMatch(/would become FAIL \(other claims still FAIL it\)/)
    for (const t of ['sample_size', 'confidence_interval', 'counter_cases', 'consequence_tier', 'law'] as const) expect(op.dissent.map(d => d.topic)).toContain(t)
    expect(op.overturn.some(c => /more overturned review\(s\) of `SUM_INT`/.test(c.evidence))).toBe(true)
    expectHeadingsInOrder(renderOpinion(op))
    expectRefsReplay(op, ledger)
  })

  it('REFER: when people overturn a rule often enough to put it on the review queue, the LAW question goes to a person', () => {
    const { ledger, failIds } = buildLedger({ passes: 0, fails: 12, reviewedFails: 10, failOverturned: 4 })
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[11]!, claim_id: 'document.SUM_INT' })
    expect(op.ruling).toMatchObject({ disposition: 'REFER', favors: null })
    expect(op.ruling.statement).toMatch(/people overturned 4 of 10/)
    expect(op.precedent.entries.slice(0, 4).every(e => e.decision === 'OVERTURNED')).toBe(true) // adverse precedent first
    expect(op.overturn.some(c => /more upheld review\(s\)/.test(c.evidence))).toBe(true)
  })

  it('an abstention is upheld: a ruling cannot manufacture data', () => {
    const { ledger, failIds } = buildLedger({ passes: 0, fails: 3 })
    const v = ledger.get(failIds[0]!)!.verdict
    const abstained = v.claims.find(c => c.outcome === 'INSUFFICIENT_DATA')!
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: v.verdict_id, claim_id: abstained.claim_id })
    expect(op.ruling.disposition).toBe('UPHOLD')
    expect(op.ruling.statement).toMatch(/ruling cannot manufacture data/)
    expect(op.readings[1]!.consequence).toMatch(/Only a re-run, which is a new verdict with a new id, can/)
  })

  it('a disputed PASS: the dissent points at what a PASS does not cover', () => {
    const { ledger, passIds } = buildLedger({ passes: 3, fails: 0 })
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: passIds[0]!, claim_id: 'document.SUM_INT' })
    expect(op.subject).toMatchObject({ outcome: 'PASS' })
    expect(op.readings[0]!.label).toBe('The PASS stands')
    expect(op.dissent.map(d => d.topic)).toContain('coverage')
  })

  it('binds to the original inputs when they are supplied, and is withheld on the wrong ones', () => {
    const { ledger, failIds } = buildLedger({ passes: 0, fails: 2 })
    const doc = { ...broken, invoice_number: 'acme-F0' }
    expect(verify(doc, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }).verdict_id).toBe(failIds[0])
    const inputs = { extraction: doc, references: { contract: null, evidence: [], history: [] }, source: null }
    const ok = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[0]!, inputs })
    expect(ok.premises.find(p => /FOR the supplied inputs/.test(p.statement))!.verified).toBe(true)
    const wrong = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[0]!, inputs: { ...inputs, extraction: { ...doc, invoice_number: 'other' } } })
    expect(wrong.ruling.disposition).toBe('WITHHELD')
  })

  it('a judgement-tier (REASONED) finding is an advisory: its dispute is REFERRED to a person, and it never held the action', () => {
    const { ledger: built } = buildLedger({ passes: 0, fails: 0 })
    const { id, ledger } = recordReasoned(built)
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: id, claim_id: 'document.SUM_INT' })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ kind: 'DISPUTE', tier: 'REASONED' })
    expect(op.ruling).toMatchObject({ disposition: 'REFER', favors: null })
    expect(op.ruling.statement).toMatch(/judgement-tier finding, advice and never a VERDICT\. It did not hold the action/)
    expect(op.readings.map(r => r.label)).toEqual(['The advisory stands', 'Dismiss the advisory'])
    expect(op.premises.find(p => p.id === 'P2')!.statement).toMatch(/judgement-tier findings are advisories, not VERDICT/)
  })

  it('the default disputed claim is the one that drove the verdict (a FAIL on a FAIL verdict, a PASS on a PASS verdict)', () => {
    const { ledger, failIds, passIds } = buildLedger({ passes: 1, fails: 1 })
    expect(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[0]! }).subject).toMatchObject({ outcome: 'FAIL' })
    expect(disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: passIds[0]! }).subject).toMatchObject({ outcome: 'PASS' })
  })

  it('refuses to opine on a verdict that is not on the record, or a claim it does not have', () => {
    const { ledger, failIds } = buildLedger({ passes: 0, fails: 1 })
    expect(() => disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: 'nope' })).toThrow(/not on the supplied book of record/)
    expect(() => disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: failIds[0]!, claim_id: 'nope' })).toThrow(/has no claim nope/)
  })
})
