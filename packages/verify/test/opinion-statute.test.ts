/**
 * Precedent → statute, a first stone (opinion lane, 2026-09-28): the customer's own rulebook.
 *
 *   dispute opinion (UPHOLD / REFER)  →  a person's signed ruling on LAW (STANDS / SET_ASIDE)
 *     →  a case-table row `verify mine` consumes unchanged  →  the miner's candles  →  COUNSEL (GENERATED, judged,
 *        dismissible), never a VERDICT
 *
 * The book: acme's SUM_INT FAILs in two populations. People let the FAIL stand when the lines miss the subtotal by a lot,
 * and set it aside when the miss is small (their supplier rounds line totals). Nobody tells the miner why; it recovers the
 * cut from the rulings alone. Every row is a re-verified ruling: forged, altered, unanchored, off-book and other-tenant
 * rulings are excluded with the reason, and a statute altered after it was built surfaces nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, verify as edVerify } from 'node:crypto'
import { verify, serializeVerdict, isCounsel, renderCounsel, ChannelViolation, type Verdict } from '../src/index'
import { createLedger, DECISION_SIGNING_PREFIX, type Ledger } from '../src/ledger/index'
import { canonicalize } from '../src/verdict/canonical'
import {
  disputeOpinion, disputeRuling, signRuling, verifySignedRuling, rulingBookJSONL, parseRulingBook,
  statuteFromRulings, statuteCounsel, statuteIntact, statuteMineFiles, snapshotOfLedger, type SignedRuling, type Statute,
} from '../src/opinion/index'
import { mineFromJsonl, run } from '../src/cli'
import { FIXED_NOW } from './fixtures/invoices'
import { freshClock } from './fixtures/voice-ledger'
import { LEAD, AGENT, GLOBEX, TRUSTED } from './fixtures/opinion-book'

/** One line, no tax: SUM_INT FAILs by exactly `variance` (Σ lines − subtotal); every other check holds. */
function sumMiss(no: string, subtotal: number, variance: number): Record<string, unknown> {
  const amount = subtotal + variance
  return {
    invoice_number: no, currency: 'USD', invoice_date: '2026-09-15',
    line_items: [{ description: 'Consulting', quantity: 1, unit_price: amount, amount }],
    totals: { subtotal, tax_rate: 0, tax: 0, total: subtotal },
  }
}

const HELD = Array.from({ length: 8 }, (_, i) => ({ subtotal: 1000 + 100 * i, variance: 40 + 10 * i }))
const RELEASED = Array.from({ length: 8 }, (_, i) => ({ subtotal: 1050 + 100 * i, variance: 3 + 0.5 * i }))
const SCOPE = { tenant_id: 'acme' }
const CLAIM = 'document.SUM_INT'

interface World { ledger: Ledger; held: string[]; released: string[]; globex: string[]; rulings: SignedRuling[]; tamper: SignedRuling[] }

function rule(ledger: Ledger, id: string, stands: boolean, at: string, o: { tenant?: string; signer?: string; key?: string; claim?: string } = {}): SignedRuling {
  const op = disputeOpinion({ snapshot: snapshotOfLedger(ledger), verdict_id: id, claim_id: o.claim ?? CLAIM, scope: { tenant_id: o.tenant ?? 'acme' } })
  const r = disputeRuling(op, { ruling: stands ? 'STANDS' : 'SET_ASIDE', reason: stands ? 'the lines do not foot to the subtotal: hold' : 'the supplier rounds line totals: release', signer_id: o.signer ?? 'ap-lead', signed_at: at })
  return signRuling(r, o.key ?? LEAD.privateKeyPem)
}

/** The whole loop on one shared book, in three phases (rulings are made on growing books, UPHOLD first, then REFER). */
function world(): World {
  const ledger = createLedger({ now: freshClock() })
  const rec = (no: string, c: { subtotal: number; variance: number }, tenant: string): string => {
    const v = verify(sumMiss(no, c.subtotal, c.variance), { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    ledger.record(v, { tenant_id: tenant })
    return v.verdict_id
  }
  const held = HELD.map((c, i) => rec(`H-${i}`, c, 'acme'))
  const released = RELEASED.map((c, i) => rec(`R-${i}`, c, 'acme'))
  const globex = [0, 1, 2, 3].map(i => rec(`G-${i}`, { subtotal: 1200 + i, variance: 70 }, 'globex'))
  for (const id of globex) ledger.review(id, { reviewer_id: 'globex-controller', decision: 'OVERTURNED', note: 'GLOBEX-CONFIDENTIAL' })

  const rulings: SignedRuling[] = []
  // phase 1: acme has no reviews yet; its (scoped) precedent is empty → UPHOLD
  for (let i = 0; i < 4; i++) rulings.push(rule(ledger, held[i]!, true, `2026-09-28T10:0${i}:00Z`), rule(ledger, released[i]!, false, `2026-09-28T10:1${i}:00Z`))
  // phase 2: acme's people review all 16; the rule is now on acme's review queue → REFER
  held.forEach(id => ledger.review(id, { reviewer_id: 'ap-lead', decision: 'UPHELD' }))
  released.forEach(id => ledger.review(id, { reviewer_id: 'ap-lead', decision: 'OVERTURNED', note: 'supplier rounding' }))
  for (let i = 4; i < 8; i++) rulings.push(rule(ledger, held[i]!, true, `2026-09-28T11:0${i}:00Z`), rule(ledger, released[i]!, false, `2026-09-28T11:1${i}:00Z`))
  // a globex person's ruling on a globex verdict (the same rule): in the shared ruling book, never in acme's statute
  rulings.push(rule(ledger, globex[0]!, true, '2026-09-28T11:30:00Z', { tenant: 'globex', signer: 'globex-controller', key: GLOBEX.privateKeyPem }))
  // a ruling on another claim (a PASS): not this statute's
  rulings.push(rule(ledger, held[0]!, true, '2026-09-28T11:40:00Z', { claim: 'document.TOTAL_INT' }))
  // phase 3: the book grows; a later ruling on released[0] supersedes the first
  rec('G-4', { subtotal: 1300, variance: 70 }, 'globex')
  rulings.push(rule(ledger, released[0]!, false, '2026-09-28T12:00:00Z'))

  // tampered and forged rulings, appended to the same ruling book
  const altered = structuredClone(rulings[0]!); altered.ruling.ruling = 'SET_ASIDE'
  const forged = signRuling({ ...rulings[2]!.ruling, opinion_id: 'f'.repeat(32) }, LEAD.privateKeyPem)
  const agent = signRuling(rulings[4]!.ruling, AGENT.privateKeyPem)
  const offBook = signRuling({ ...rulings[6]!.ruling, book: { head: 'a'.repeat(64), length: rulings[6]!.ruling.book.length } }, LEAD.privateKeyPem)
  return { ledger, held, released, globex, rulings, tamper: [altered, forged, agent, offBook] }
}

const W = world()
const build = (rulings: readonly SignedRuling[] = [...W.rulings, ...W.tamper]): Statute =>
  statuteFromRulings({ snapshot: snapshotOfLedger(W.ledger), rulings, rule_id: 'SUM_INT', domain: 'invoice', scope: SCOPE, trusted_keys: TRUSTED })

describe('a signed ruling on LAW', () => {
  it('answers exactly one verified dispute opinion: UPHOLD before the reviews, REFER after; it verifies and is anchored', () => {
    expect(W.rulings.slice(0, 8).every(r => r.ruling.proposed === 'UPHOLD')).toBe(true)
    expect(W.rulings.slice(8, 16).every(r => r.ruling.proposed === 'REFER')).toBe(true)
    const r = W.rulings[0]!
    expect(r.ruling).toMatchObject({ kind: 'DISPUTE_RULING', tenant_id: 'acme', verdict_id: W.held[0], claim_id: CLAIM, rule_id: 'SUM_INT', outcome: 'FAIL', ruling: 'STANDS', ruleset: { id: 'invoice', version: '0.0.1', domain: 'invoice' } })
    expect(r.ruling.book.length).toBeLessThan(W.rulings[8]!.ruling.book.length)
    expect(verifySignedRuling(r, { trusted_keys: TRUSTED })).toEqual({ ok: true, anchored: true })
    expect(verifySignedRuling(r)).toEqual({ ok: true, anchored: false })
    expect(parseRulingBook(rulingBookJSONL(W.rulings))).toEqual(W.rulings)
  })

  it('is domain-separated: a ruling signature is not a decision signature over the same body', () => {
    const r = W.rulings[0]!
    const asDecision = Buffer.from(DECISION_SIGNING_PREFIX + canonicalize(r.ruling), 'utf8')
    expect(edVerify(null, asDecision, createPublicKey(r.public_key), Buffer.from(r.signature, 'base64'))).toBe(false)
  })

  it('refuses what is not LAW: a withheld opinion, an abstention, a judgement-free promotion question, an edited opinion', () => {
    const snap = snapshotOfLedger(W.ledger)
    const by = { ruling: 'STANDS' as const, reason: 'r', signer_id: 'ap-lead', signed_at: '2026-09-28T12:00:00Z' }
    const withheld = disputeOpinion({ snapshot: { records: W.ledger.all() }, verdict_id: W.held[0]!, claim_id: CLAIM })
    expect(() => disputeRuling(withheld, by)).toThrow(/is WITHHELD/)
    const v = W.ledger.get(W.held[0]!)!.verdict
    const abstained = v.claims.find(c => c.outcome === 'INSUFFICIENT_DATA')!
    expect(() => disputeRuling(disputeOpinion({ snapshot: snap, verdict_id: v.verdict_id, claim_id: abstained.claim_id }), by)).toThrow(/an abstention is not a question of LAW/)
    const op = disputeOpinion({ snapshot: snap, verdict_id: W.held[0]!, claim_id: CLAIM })
    expect(() => disputeRuling({ ...op, ruling: { ...op.ruling, statement: 'Upheld, obviously.' } }, by)).toThrow(/edited after it was generated/)
    expect(() => disputeRuling(op, { ...by, reason: ' ' })).toThrow(/needs a reason/)
  })
})

describe('the statute: every row a re-verified ruling', () => {
  const s = build()

  it('16 rows, all acme\'s, labelled by the ruling; every exclusion explained; the first ruling on released[0] superseded', () => {
    expect(s.rows).toHaveLength(16)
    expect(s.rows.filter(r => r.label === 'hold').map(r => r.verdict_id).sort()).toEqual([...W.held].sort())
    expect(s.rows.filter(r => r.label === 'approve').map(r => r.verdict_id).sort()).toEqual([...W.released].sort())
    expect(s.rows.every(r => r.anchored && r.signer_id === 'ap-lead')).toBe(true)
    expect(s.superseded).toEqual([{ ruling_id: W.rulings[1]!.ruling_id, by: W.rulings[W.rulings.length - 1]!.ruling_id }])
    const why = (r: SignedRuling) => s.excluded.find(e => e.ruling_id === r.ruling_id)?.why
    expect(s.excluded).toHaveLength(4)
    expect(why(W.rulings[16]!)).toBeUndefined() // another tenant's ruling: counted, never named
    expect(s.skipped.other_tenant_rulings).toBe(1)
    expect(s.excluded.find(e => /does not derive from the ruling \(altered after signing\)/.test(e.why))).toBeDefined()
    expect(why(W.tamper[1]!)).toMatch(/the opinion it answers does not re-derive from the book it names/)
    expect(why(W.tamper[2]!)).toMatch(/the signing key is not the one anchored to signer 'ap-lead'/)
    expect(why(W.tamper[3]!)).toMatch(/is not a prefix of this book of record/)
    expect(s.skipped.other_rulings).toBe(1)
    expect(JSON.stringify(s)).not.toMatch(/globex|GLOBEX/)
    for (const id of W.globex) expect(JSON.stringify(s)).not.toContain(id)
  })

  it('the rows carry the disputed claim\'s cells and the document cells the verdict cites, named by source and path', () => {
    expect(s.schema.approve).toBe('approve')
    expect(s.fields).toMatchObject({
      claim_variance: { claim: 'variance' }, claim_asserted: { claim: 'asserted' }, claim_expected: { claim: 'expected' },
      invoice_totals_subtotal: { source: 'invoice', path: 'totals.subtotal' }, invoice_totals_total: { source: 'invoice', path: 'totals.total' },
    })
    for (const f of Object.keys(s.schema.fields)) expect(s.schema.fields[f]!.type).toBe('qty')
    const r0 = s.table.cases.find(c => c.id === `${W.held[3]}/${CLAIM}`)!
    expect(r0).toMatchObject({ label: 'hold', fields: { claim_variance: 70, claim_expected: 1300, claim_asserted: 1370, invoice_totals_subtotal: 1300 } })
    expect(s.skipped.line_cells).toBeGreaterThan(0) // line_items[i] cells: not in the table yet (a first stone)
    expect(s.skipped.computed_cells).toBeGreaterThan(0)
    expect(statuteIntact(s)).toBe(true)
  })

  it('is deterministic: the order rulings arrive in changes nothing but supersession', () => {
    const shuffled = [...W.rulings.slice(0, -1)].reverse().concat(W.rulings.slice(-1), W.tamper)
    expect(build(shuffled).statute_hash).toBe(s.statute_hash)
    expect(build().statute_hash).toBe(s.statute_hash)
  })

  it('refuses a book that does not verify', () => {
    const lines = W.ledger.chainJSONL().split('\n')
    const ev = JSON.parse(lines[2]!); ev.payload.verdict.outcome = 'PASS'; lines[2] = JSON.stringify(ev)
    const { events, payloads } = { events: lines.map(l => { const { payload: _p, ...e } = JSON.parse(l); return e }), payloads: lines.map(l => JSON.parse(l).payload) }
    expect(() => statuteFromRulings({ snapshot: { events, payloads }, rulings: W.rulings, rule_id: 'SUM_INT', domain: 'invoice', scope: SCOPE })).toThrow(/does not verify at event 2/)
  })
})

describe('the statute\'s candles come back as COUNSEL: the customer\'s own rulebook', () => {
  const s = build()
  const { report, counsel } = statuteCounsel(s)

  it('the miner recovers the cut from the rulings alone: one candle, the claim\'s variance above 23.25, every hold explained', () => {
    expect(report.candles.map(c => c.id)).toEqual(['C claim_variance <= c'])
    const c = report.candles[0]!
    expect(c).toMatchObject({ c: 23.25, interval: { lo: 6.5, hi: 40 }, holds: 8, approved: 0 })
    expect(report.explained).toMatchObject({ holds: 8, of: 8, unexplained: [] })
  })

  it('is COUNSEL: generated, judged (the miner\'s three judges + PRECEDENT), dismissible, never holding an action', () => {
    expect(counsel).toHaveLength(1)
    const k = counsel[0]!
    expect(isCounsel(k)).toBe(true)
    expect(k).toMatchObject({ channel: 'COUNSEL', kind: 'CANDLE', dismissible: true, holds_action: false })
    expect(k.provenance).toEqual({ type: 'GENERATED', generator: 'riposte-statute', generator_version: '0.1.0', source_hash: s.statute_hash })
    expect(k.judges.map(j => j.judge)).toEqual(['CONSISTENCY', 'GROUNDING', 'NOVELTY', 'PRECEDENT'])
    expect(k.judges.every(j => j.passed)).toBe(true)
    expect(k.judges[3]!.stats).toEqual({ rulings: 16, anchored: 16, excluded: 4, superseded: 1 })
    expect(k.title).toBe('Consider a statute for `SUM_INT` in \'invoice\': its FAIL binds when the disputed claim\'s variance (asserted − expected) is above 23.25')
    expect(k.body).toMatch(/^From 16 signed ruling\(s\) on `SUM_INT`'s FAILs in 'invoice' \(tenant `acme`\): On every document whose the disputed claim's variance/)
    expect(k.body).toMatch(/nothing changes until a person writes it into the ruleset, as a new version\.$/)
    const subj = k.subject as { cells: unknown; rulings: string[]; violators: string[] }
    expect(subj.cells).toEqual({ claim_variance: { claim: 'variance' } })
    expect([...subj.rulings].sort()).toEqual(s.rows.filter(r => r.label === 'hold').map(r => r.ruling_id).sort())
    expect(renderCounsel(k)).toMatch(/^\*\*COUNSEL\*\* · GENERATED by riposte-statute 0\.1\.0 · dismissible/)
  })

  it('is never a VERDICT: it cannot be serialized as one, and the book of record refuses it at the door', () => {
    const k = counsel[0]!
    expect(() => serializeVerdict(k)).toThrow(ChannelViolation)
    const head = W.ledger.chainHead()
    expect(() => W.ledger.record(k as unknown as Verdict, { tenant_id: 'acme' })).toThrow(ChannelViolation)
    expect(W.ledger.chainHead()).toBe(head)
  })

  it('a statute altered after it was built surfaces nothing', () => {
    const doctored: Statute = structuredClone(s)
    doctored.table.cases[0]!.label = doctored.table.cases[0]!.label === 'hold' ? 'approve' : 'hold'
    expect(() => statuteCounsel(doctored)).toThrow(ChannelViolation)
  })

  it('thin precedent grounds nothing: with 3 + 3 rulings no candle clears the gates, and the morgue says why', () => {
    const thin = build([...W.rulings.slice(0, 3), ...W.rulings.slice(8, 11)])
    expect(thin.rows).toHaveLength(6)
    const t = statuteCounsel(thin)
    expect(t.counsel).toEqual([])
    expect(t.report.morgue.find(m => m.id === 'C claim_variance <= c')).toMatchObject({ fate: 'BASE_RATE' })
  })
})

describe('`verify mine` consumes the statute unchanged', () => {
  const paths: string[] = []
  afterEach(() => { for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p) })
  const s = build()

  it('the pure core of `verify mine` gives the same report, byte for byte', () => {
    const f = statuteMineFiles(s)
    const viaCli = mineFromJsonl(f.cases, { schema: JSON.parse(f.schema), thresholds: true })
    expect(JSON.stringify(viaCli.report)).toBe(JSON.stringify(statuteCounsel(s).report))
  })

  it('end to end: `verify mine rows.jsonl --schema schema.json --thresholds` prints the same candles', () => {
    const f = statuteMineFiles(s)
    const stamp = `${process.pid}-${Math.random().toString(36).slice(2)}`
    const rows = join(tmpdir(), `statute-rows-${stamp}.jsonl`), schema = join(tmpdir(), `statute-schema-${stamp}.json`)
    paths.push(rows, schema)
    writeFileSync(rows, f.cases); writeFileSync(schema, f.schema)
    let out = ''
    const code = run(['mine', rows, '--schema', schema, '--thresholds'], { out: x => { out += x }, err: () => {} })
    expect(code).toBe(0)
    const printed = JSON.parse(out) as { report: { candles: { id: string; c: number }[]; data: { table_hash: string } } }
    expect(printed.report.candles.map(c => [c.id, c.c])).toEqual([['C claim_variance <= c', 23.25]])
    expect(printed.report.data.table_hash).toBe(statuteCounsel(s).report.data.table_hash)
  })
})
