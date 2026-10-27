/**
 * The tenant scope (2026-09-28). On a hosted book shared by several tenants, an opinion's precedent,
 * evidence, prior ruling and decisions are drawn ONLY from the requesting tenant's records. It never quotes another
 * tenant's reviews (their reviewer ids, notes or verdicts) as precedent. The chain is still verified whole.
 *
 * The unscoped opinion over the same shared book is the control: it does cite the other tenant (and even changes its ruling
 * because of them), so the scoped assertions are not vacuous. That leak is why hosted POST /v1/opinion answered a shared-book
 * dispute with 409; with the scope it can be served.
 */
import { describe, it, expect } from 'vitest'
import { verify } from '../src/index'
import { createLedger, parseChainJSONL, type Ledger } from '../src/ledger/index'
import {
  disputeOpinion, promotionOpinion, renderOpinion, openSnapshot, snapshotOfLedger, opinionIntact, type Opinion,
} from '../src/opinion/index'
import { broken, FIXED_NOW } from './fixtures/invoices'
import { buildLedger, freshClock, WF } from './fixtures/voice-ledger'
import { TINY, GLOBEX, TRUSTED, grant } from './fixtures/opinion-book'

const GLOBEX_REVIEWER = 'globex-controller'
const GLOBEX_NOTE = 'GLOBEX-CONFIDENTIAL: vendor dispute, see counsel memo'

/** acme: 10 FAILs, 9 reviewed UPHELD, the 10th unreviewed (the one disputed). globex: 10 FAILs, 6 of them OVERTURNED with a private note. */
function sharedBook(): { ledger: Ledger; acmeFails: string[]; globexFails: string[] } {
  const ledger = createLedger({ now: freshClock() })
  const acme = buildLedger({ ledger, tenant: 'acme', passes: 2, fails: 10, reviewedFails: 9 })
  const globexFails: string[] = []
  for (let i = 0; i < 10; i++) {
    const v = verify({ ...broken, invoice_number: `globex-F${i}` }, { now: FIXED_NOW })
    ledger.record(v, { tenant_id: 'globex' })
    ledger.review(v.verdict_id, { reviewer_id: GLOBEX_REVIEWER, decision: i < 6 ? 'OVERTURNED' : 'UPHELD', note: GLOBEX_NOTE })
    globexFails.push(v.verdict_id)
  }
  return { ledger, acmeFails: acme.failIds, globexFails }
}

const mentionsGlobex = (op: Opinion, globexIds: readonly string[]): boolean => {
  const s = JSON.stringify(op)
  return s.includes(GLOBEX_REVIEWER) || s.includes('GLOBEX-CONFIDENTIAL') || globexIds.some(id => s.includes(id))
}

describe('a dispute on a shared book: precedent is the tenant\'s own', () => {
  const { ledger, acmeFails, globexFails } = sharedBook()
  const target = acmeFails[9]!

  it('the control: unscoped, the opinion cites the other tenant\'s reviews, and they flip the ruling to REFER', () => {
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, claim_id: 'document.SUM_INT' })
    expect(op.ruling.disposition).toBe('REFER') // 6 of 19 overturned, all six globex's
    expect(mentionsGlobex(op, globexFails)).toBe(true)
  })

  it('scoped to acme: every precedent entry is acme\'s, nothing of globex is quoted, and the ruling is acme\'s own (UPHOLD)', () => {
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, claim_id: 'document.SUM_INT', scope: { tenant_id: 'acme' } })
    expect(op.verified).toBe(true)
    expect(op.ruling.disposition).toBe('UPHOLD')
    expect(op.precedent.entries).toHaveLength(9)
    for (const e of op.precedent.entries) {
      expect(ledger.get(e.verdict_id)!.tenant_id).toBe('acme')
      expect(e.reviewer_id).toBe('ap-lead')
    }
    expect(mentionsGlobex(op, globexFails)).toBe(false)
    expect(op.precedent.summary).toMatch(/^9 reviewed FAIL verdict\(s\) in 'invoice' \(tenant `acme`'s own record\)/)
    expect(op.subject).toMatchObject({ kind: 'DISPUTE', tenant_id: 'acme', ruleset: { id: 'invoice', version: '0.0.1', domain: 'invoice' } })
    expect(op.premises[0]!.statement).toMatch(/This opinion reads only tenant `acme`'s records and decisions; the chain is verified whole/)
    expect(op.ruling.scope).toMatch(/becomes precedent for `SUM_INT` in 'invoice' for tenant `acme`\./)
    expect(renderOpinion(op)).toMatch(/· tenant `acme` ·/)
    expect(opinionIntact(op)).toBe(true)
  })

  it('every event the scoped opinion cites is on the chain, and is acme\'s', () => {
    const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, claim_id: 'document.SUM_INT', scope: { tenant_id: 'acme' } })
    const { events, payloads } = parseChainJSONL(ledger.chainJSONL())
    let cited = 0
    const refs = [...op.premises.flatMap(p => p.refs), ...op.precedent.entries.map(e => e.ref)]
    for (const r of refs) {
      if (r.kind !== 'verdict') continue
      for (const ev of [r.record_event, r.review_event]) {
        if (!ev) continue
        expect(events[ev.seq]!.entry_hash).toBe(ev.entry_hash)
        const pl = payloads[ev.seq] as { type: string; tenant_id?: string; verdict_id?: string }
        if (pl.type === 'RECORD') expect(pl.tenant_id).toBe('acme')
        else expect(ledger.get(pl.verdict_id!)!.tenant_id).toBe('acme')
        cited++
      }
    }
    expect(cited).toBe(3 + 9 * 2) // the disputed verdict's RECORD in three premises; each precedent entry's RECORD and REVIEW
  })

  it('scoped to acme, a globex verdict is not on the book: the opinion refuses rather than opine on another tenant\'s record', () => {
    expect(() => disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: globexFails[0]!, scope: { tenant_id: 'acme' } })).toThrow(/not on tenant acme's book of record/)
  })

  it('is deterministic: the same shared book and scope give the same opinion, byte for byte', () => {
    const a = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, scope: { tenant_id: 'acme' } })
    const b = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: target, scope: { tenant_id: 'acme' } })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('one verdict id, two tenants (the same document verified by both)', () => {
  function collision() {
    const ledger = createLedger({ now: freshClock() })
    const v = verify({ ...broken, invoice_number: 'SHARED-1' }, { now: FIXED_NOW })
    ledger.record(v, { tenant_id: 'acme' })
    ledger.review(v.verdict_id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: 'ACME-PRIVATE: duplicate of PO 7' })
    ledger.record(v, { tenant_id: 'globex' })
    return { ledger, id: v.verdict_id }
  }

  // Flipped on 2026-09-28, when the ledger was fixed to keep each tenant's review apart: this test pinned the leak as
  // measured; it now pins the fix (records keyed by tenant and verdict id; a review never crosses tenants).
  it('fixed: the live ledger no longer hands acme\'s review to globex\'s re-record; each tenant keeps its own record', () => {
    const { ledger, id } = collision()
    expect(ledger.get(id)!.tenant_id).toBe('globex')
    expect(ledger.get(id)!.review).toBeUndefined()
    expect(ledger.get(id)!.verdict.ledger?.reviewer).toBeUndefined()
    expect(ledger.get(id, 'acme')!.review?.note).toBe('ACME-PRIVATE: duplicate of PO 7')
  })

  it('scoped, globex sees its own record with no review; acme keeps its own review; neither view carries the other\'s', () => {
    const { ledger, id } = collision()
    const snap = snapshotOfLedger(ledger)
    const g = openSnapshot(snap, { scope: { tenant_id: 'globex' } })
    expect(g.content_verified).toBe(true)
    expect(g.records).toHaveLength(1)
    expect(g.records[0]!.review).toBeUndefined()
    expect(JSON.stringify(g.records)).not.toMatch(/ACME-PRIVATE/)
    expect(g.eventsFor(id).review).toBeUndefined()
    const op = disputeOpinion({ snapshot: snap, verdict_id: id, scope: { tenant_id: 'globex' } })
    expect(op.premises.find(p => /ruled on this verdict/.test(p.statement))!.statement).toBe('No person has ruled on this verdict yet.')
    expect(JSON.stringify(op)).not.toMatch(/ACME-PRIVATE|ap-lead/)
    const a = disputeOpinion({ snapshot: snap, verdict_id: id, scope: { tenant_id: 'acme' } })
    expect(a.premises.find(p => /ruled on this verdict/.test(p.statement))!.statement).toMatch(/A person has already ruled on this verdict: OVERTURNED \(ap-lead,/)
    expect(a.verified).toBe(true)
  })
})

describe('a promotion opinion on a shared book: evidence and decisions are the tenant\'s own', () => {
  it('evidence sets are acme\'s only; globex\'s grant and signer never appear; another tenant\'s workflow is refused', () => {
    const ledger = createLedger({ now: freshClock(), trusted_keys: TRUSTED }) // D-ANCHOR: only anchored grants have effect
    buildLedger({ ledger, tenant: 'acme', passes: 12, fails: 8 })
    buildLedger({ ledger, tenant: 'globex', passes: 12, fails: 8, failOverturned: 3 })
    ledger.decide(grant(WF('acme'), 'gate'))
    ledger.decide(grant(WF('globex'), 'advise', { signer: GLOBEX_REVIEWER, key: GLOBEX.privateKeyPem }))
    const snap = snapshotOfLedger(ledger)
    const view = openSnapshot(snap, { scope: { tenant_id: 'acme' } })
    expect(view.decisions.map(d => d.signed.decision.signer_id)).toEqual(['owner'])
    expect(view.unanchored).toEqual([]) // D-ANCHOR (security fix): was ['owner']; the snapshot carries the ledger's own anchors
    const op = promotionOpinion({ snapshot: snap, policy: TINY, workflow_id: WF('acme'), scope: { tenant_id: 'acme' } })
    expect(op.verified).toBe(true)
    expect(op.subject).toMatchObject({ tenant_id: 'acme', granted: 'gate', rung_source: 'BOOK' })
    for (const p of op.premises) for (const r of p.refs) if (r.kind === 'evidence_set') for (const id of r.verdict_ids) expect(ledger.get(id)!.tenant_id).toBe('acme')
    expect(JSON.stringify(op)).not.toMatch(/globex/)
    expect(() => promotionOpinion({ snapshot: snap, policy: TINY, workflow_id: WF('globex'), scope: { tenant_id: 'acme' } })).toThrow(/is not tenant acme's/)
  })
})
