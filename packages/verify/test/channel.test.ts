/**
 * Typed channels (schema v0.1): VERDICT vs COUNSEL.
 *
 *  - ADDITIVE: verify() does not emit `channel`; stamping it leaves verdict_id, replay-binding and every other byte alone
 *    (the accuracy.ts pattern). The golden hashes are guarded by declarative-golden.test.ts; this file guards the stamp.
 *  - THE GUARD: COUNSEL can never be rendered or serialized as a VERDICT, however it is dressed.
 *  - COUNSEL carries provenance GENERATED and the judge results that justified surfacing it; miner candles map onto the
 *    mining gauntlet's three judges, re-checked against the report's own gates.
 */
import { describe, it, expect } from 'vitest'
// The book is issued under the retained invoice 0.0.1 so its workflow stays <tenant>/invoice@0.0.1 (pinned 2026-09-28, NUMERIC-HONESTY).
import { INVOICE_RULESET_V0_0_1 } from '../src/rulesets/index'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verify, verifyDeclarative, verifyReplay, replayView, createLedger, verifyInvoiceMatch, splitApLayout, parseJsonl,
  mine, apCasesToTable, AP_MINE_SCHEMA,
  channelOf, assertVerdict, stampVerdictChannel, serializeVerdict, renderVerdict, makeCounsel, isCounsel, counselFromCandle,
  counselFromReport, renderCounsel, renderChanneled, serializeChanneled, ChannelViolation, workflowCalibration,
  counselFromReasoned, advisoriesFromVerdict, actionNotice,
  type Verdict, type Counsel, type DistilApCase, type LedgerRecord,
} from '../src/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'
import { withLegacyRecord } from './fixtures/legacy-ledger'

const HERE = dirname(fileURLToPath(import.meta.url))
const AP_TEXT = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8')
const AP_ROWS = parseJsonl(AP_TEXT) as DistilApCase[]
const REPORT = mine(apCasesToTable(AP_ROWS), AP_MINE_SCHEMA)

const declRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=' as const, right: 'SUB + TAX', field: 'total' }],
}

const counsel = (): Counsel => makeCounsel({
  kind: 'SUGGESTION',
  title: 'You might also check the freight line',
  body: 'Freight appears on 3 of the last 5 invoices from this vendor but not on this one.',
  provenance: { type: 'GENERATED', generator: 'riposte-mine', generator_version: '0.1.0', source_hash: 'a'.repeat(64) },
  judges: [{ judge: 'GROUNDING', passed: true, detail: '3 of 5 prior invoices', stats: { k: 3, n: 5 } }],
})

describe('VERDICT channel: additive, verdict_id unchanged', () => {
  it('verify() emits no channel field by default (existing bytes untouched)', () => {
    const v = verify(clean, { now: FIXED_NOW })
    expect('channel' in v).toBe(false)
    expect(JSON.stringify(v)).not.toMatch(/"channel"/)
  })

  it('stamping adds channel VERDICT and changes nothing else: same verdict_id, same replay-binding, same other bytes', () => {
    for (const doc of [clean, broken]) {
      const v = verify(doc, { now: FIXED_NOW })
      const s = stampVerdictChannel(v)
      expect(s.channel).toBe('VERDICT')
      expect(s.verdict_id).toBe(v.verdict_id)
      expect(verifyReplay(s).ok).toBe(true)
      const { channel: _c, ...rest } = s
      expect(JSON.stringify(rest)).toBe(JSON.stringify(v))
      expect(replayView(v)).toEqual(replayView(verify(doc, { now: FIXED_NOW }))) // the unstamped path is still byte-identical
      expect(stampVerdictChannel(s)).toBe(s) // idempotent
    }
  })

  it('every verdict producer earns the VERDICT channel: invoice, declarative, AP three-way match', () => {
    const inv = verify(broken, { now: FIXED_NOW })
    const dec = verifyDeclarative({ subtotal: 100, tax: 10, total: 110 }, declRuleset, { now: FIXED_NOW })
    const docs = splitApLayout(AP_ROWS[0]!.input)
    expect(docs).not.toBeNull()
    const ap = verifyInvoiceMatch(docs!, { now: FIXED_NOW }).verdict
    for (const v of [inv, dec, ap]) {
      expect(channelOf(v)).toBe('VERDICT')
      expect(() => assertVerdict(v)).not.toThrow()
      expect(JSON.parse(serializeVerdict(v)).channel).toBe('VERDICT')
    }
  })

  it('renders a VERDICT card under its own label', () => {
    const md = renderVerdict(verify(broken, { now: FIXED_NOW }))
    expect(md).toMatch(/^\*\*VERDICT\*\* · \*\*FAIL\*\*/)
    expect(md).toMatch(/✗ `document\.SUM_INT`/)
  })

  it('refuses to stamp what has not earned it: an id not bound to its inputs, an unevidenced finding, a REASONED finding', () => {
    const v = verify(broken, { now: FIXED_NOW })
    expect(() => stampVerdictChannel({ ...v, verdict_id: '0'.repeat(32) })).toThrow(/not bound to its inputs/)
    const stripped = structuredClone(v)
    const failing = stripped.claims.find(c => c.outcome === 'FAIL')!
    failing.evidence = []
    expect(() => stampVerdictChannel(stripped)).toThrow(/without evidence/)
    const reasoned = structuredClone(v)
    reasoned.claims.find(c => c.outcome === 'FAIL')!.tier = 'REASONED'
    expect(() => stampVerdictChannel(reasoned)).toThrow(/REASONED/)
    expect(() => assertVerdict({ ...v, replayable: false })).toThrow(/replayable/)
    expect(() => assertVerdict({ hello: 'world' })).toThrow(ChannelViolation)
  })
})

describe('THE GUARD: COUNSEL can never be rendered or serialized as a VERDICT', () => {
  it('a COUNSEL item is refused by every VERDICT path', () => {
    const c = counsel()
    expect(channelOf(c)).toBe('COUNSEL')
    expect(() => assertVerdict(c)).toThrow(ChannelViolation)
    expect(() => serializeVerdict(c)).toThrow(/COUNSEL can never be presented as a VERDICT/)
    expect(() => renderVerdict(c)).toThrow(/COUNSEL can never be presented as a VERDICT/)
    expect(() => stampVerdictChannel(c as unknown as Verdict)).toThrow(ChannelViolation)
  })

  it('dressing generated material in verdict fields does not get it through', () => {
    const v = verify(clean, { now: FIXED_NOW })
    const disguised = [
      { ...v, provenance: { type: 'GENERATED', generator: 'x', generator_version: '1', source_hash: 'h' } }, // a real verdict body + a GENERATED label
      { ...v, channel: 'COUNSEL' },                                                                        // a real verdict body tagged COUNSEL
      { ...counsel(), verdict_id: v.verdict_id, outcome: 'PASS', claims: v.claims },                        // counsel wearing verdict fields
    ]
    for (const d of disguised) {
      expect(channelOf(d)).toBe('COUNSEL')
      expect(() => serializeVerdict(d)).toThrow(ChannelViolation)
      expect(() => renderVerdict(d)).toThrow(ChannelViolation)
    }
    expect(() => assertVerdict({ ...v, channel: 'SOMETHING' })).toThrow(/cannot carry channel/)
  })

  it('the channel-aware paths keep each item under its own label and never promote COUNSEL', () => {
    const c = counsel()
    const md = renderChanneled(c)
    expect(md).toMatch(/^\*\*COUNSEL\*\* · GENERATED by riposte-mine/)
    expect(md).toMatch(/dismissible/)
    expect(md).not.toMatch(/\*\*VERDICT\*\*/)
    const json = JSON.parse(serializeChanneled(c))
    expect(json.channel).toBe('COUNSEL')
    expect(json.verdict_id).toBeUndefined()
    expect(json.provenance.type).toBe('GENERATED')
    expect(json.dismissible).toBe(true)
    const v = verify(clean, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    expect(renderChanneled(v)).toMatch(/^\*\*VERDICT\*\*/)
    expect(JSON.parse(serializeChanneled(v)).channel).toBe('VERDICT')
  })

  it('COUNSEL smuggled onto the ledger is never counted as VERDICT evidence', () => {
    const led = createLedger({ now: () => new Date('2026-09-28T00:00:00Z') })
    const v = verify(clean, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    led.record(v, { tenant_id: 'acme' })
    led.review(v.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
    const smuggled = { ...v, verdict_id: 'f'.repeat(32), provenance: { type: 'GENERATED', generator: 'x', generator_version: '1', source_hash: 'h' } } as unknown as Verdict
    // The door (assertVerdict at ledger.record) refuses it; only a pre-door chain can still carry it, and it is excluded on read.
    expect(() => led.record(smuggled, { tenant_id: 'acme' })).toThrow(/COUNSEL can never be presented as a VERDICT/)
    const legacy = withLegacyRecord(led, smuggled, { tenant_id: 'acme', review: { reviewer_id: 'r', decision: 'UPHELD' } })
    const cal = workflowCalibration(legacy.all() as LedgerRecord[], 'acme/invoice@0.0.1')
    expect(cal.evidence.reviewed_pass).toEqual([v.verdict_id])
    expect(cal.excluded).toEqual([{ verdict_id: 'f'.repeat(32), why: expect.stringMatching(/COUNSEL on the ledger/) }])
  })
})

describe('COUNSEL: generated, judged, dismissible', () => {
  it('refuses to surface counsel without its justification', () => {
    const base = { kind: 'SUGGESTION' as const, title: 't', body: 'b', provenance: { type: 'GENERATED' as const, generator: 'g', generator_version: '1', source_hash: 'h' } }
    expect(() => makeCounsel({ ...base, judges: [] })).toThrow(/judge results/)
    expect(() => makeCounsel({ ...base, judges: [{ judge: 'GROUNDING', passed: false, detail: 'p too large' }] })).toThrow(/GROUNDING did not pass/)
    expect(() => makeCounsel({ ...base, provenance: { ...base.provenance, type: 'MEASURED' as unknown as 'GENERATED' }, judges: [{ judge: 'J', passed: true, detail: 'd' }] })).toThrow(/GENERATED/)
    expect(() => makeCounsel({ ...base, provenance: { ...base.provenance, source_hash: '' }, judges: [{ judge: 'J', passed: true, detail: 'd' }] })).toThrow(/source_hash/)
  })

  it('has a content-derived id: identical counsel, identical id; a tampered item no longer passes as counsel', () => {
    const a = counsel(), b = counsel()
    expect(a.counsel_id).toBe(b.counsel_id)
    expect(a.counsel_id).toMatch(/^[0-9a-f]{32}$/)
    expect(isCounsel(a)).toBe(true)
    const tampered = { ...a, body: 'Pay it.' }
    expect(isCounsel(tampered)).toBe(false)
    expect(() => renderCounsel(tampered)).toThrow(/counsel_id/)
  })

  it('every miner CANDLE (the real Distil AP mine) becomes COUNSEL carrying the three judges that justified it', () => {
    expect(REPORT.candles.length).toBe(4)
    const items = counselFromReport(REPORT)
    expect(items).toHaveLength(4)
    for (const [i, c] of items.entries()) {
      expect(c.channel).toBe('COUNSEL')
      expect(c.kind).toBe('CANDLE')
      expect(c.dismissible).toBe(true)
      expect(c.provenance).toEqual({ type: 'GENERATED', generator: 'riposte-mine', generator_version: REPORT.mine_version, source_hash: REPORT.data.table_hash })
      expect(c.judges.map(j => j.judge)).toEqual(['CONSISTENCY', 'GROUNDING', 'NOVELTY'])
      expect(c.judges.every(j => j.passed)).toBe(true)
      expect((c.subject as { candle_id: string }).candle_id).toBe(REPORT.candles[i]!.id)
      expect(() => serializeVerdict(c)).toThrow(ChannelViolation)
    }
    expect(counselFromReport(REPORT).map(c => c.counsel_id)).toEqual(items.map(c => c.counsel_id)) // deterministic
  })

  it('the morgue stays in the morgue, and a candle whose numbers miss the gates is refused', () => {
    const dead = REPORT.morgue[0]!
    expect(() => counselFromCandle(REPORT, dead)).toThrow(/only a CANDLE/)
    const doctored = { ...REPORT.candles[0]!, holds: 1 } // below minHoldViolators
    expect(() => counselFromCandle(REPORT, doctored)).toThrow(/GROUNDING did not pass/)
  })
})

describe('judgement-tier findings are COUNSEL advisories with a strength (the design ruling, 2026-09-28)', () => {
  /** A real verdict whose SUM_INT finding is judgement-tier (tier is not in verdict_id, so the id still re-derives). */
  function reasoned(doc = broken): Verdict {
    const v = structuredClone(verify(doc, { now: FIXED_NOW }))
    v.claims.find(c => c.claim_id === 'document.SUM_INT')!.tier = 'REASONED'
    return v
  }
  const layer = { generator: 'overreach-reasoner', generator_version: '0.0.1' }

  it('a judgement-tier finding is never a VERDICT: the verdict carrying it is refused the VERDICT channel', () => {
    const v = reasoned()
    expect(() => assertVerdict(v)).toThrow(/judgement-tier \(REASONED\) finding: judgement is COUNSEL/)
    expect(() => serializeVerdict(v)).toThrow(ChannelViolation)
  })

  it('a STRONG advisory is prominent, does not hold the action, and is always shown with its evidence and a dispute path', () => {
    const v = reasoned()
    const c = counselFromReasoned(v, 'document.SUM_INT', { strength: 'strong', ...layer })
    expect(c).toMatchObject({ channel: 'COUNSEL', kind: 'ADVISORY', strength: 'strong', dismissible: true, holds_action: false })
    expect(c.provenance).toEqual({ type: 'GENERATED', generator: 'overreach-reasoner', generator_version: '0.0.1', source_hash: v.input_hash })
    expect(c.evidence!.length).toBeGreaterThan(0)
    expect(c.evidence).toEqual(v.claims.find(x => x.claim_id === 'document.SUM_INT')!.evidence)
    expect(c.dispute).toEqual({ verdict_id: v.verdict_id, claim_id: 'document.SUM_INT', command: `verify opinion --ledger <chain.jsonl> --dispute ${v.verdict_id} --claim document.SUM_INT` })
    expect(c.judges.map(j => [j.judge, j.passed])).toEqual([['EVIDENCED', true], ['BOUND', true]])
    const md = renderCounsel(c)
    expect(md).toMatch(/^\*\*COUNSEL\*\* · \*\*STRONG ADVISORY\*\* · GENERATED by overreach-reasoner/)
    expect(md).toMatch(/### ⚠ Strong advisory: Law of Footing did not hold on `subtotal`/)
    expect(md).toMatch(/The evidence it rests on:\n(- .*\n)*- `invoice:totals\.subtotal` = 1750\.5 · confidence 100/)
    expect(md).toMatch(/Dispute it: `verify opinion --ledger <chain\.jsonl> --dispute /)
    expect(md).toMatch(/it does not hold the action/)
    expect(md).not.toMatch(/\*\*VERDICT\*\*/)
    expect(() => serializeVerdict(c)).toThrow(ChannelViolation)
  })

  it('an advisory never holds the action, at any rung: a judgement-tier FAIL on an otherwise clean verdict leaves the action to PROCEED', () => {
    const v = structuredClone(verify(clean, { now: FIXED_NOW }))
    const sum = v.claims.find(c => c.claim_id === 'document.SUM_INT')!
    sum.tier = 'REASONED'
    sum.outcome = 'FAIL'
    for (const level of ['record', 'advise', 'gate', 'autonomy'] as const) {
      const n = actionNotice(v, level)
      expect(n.action).toBe('PROCEED')
      expect(n.advisories).toBe(1)
      expect(n.findings.some(f => f.claim_id === 'document.SUM_INT')).toBe(false)
    }
  })

  it('strength is declared per finding; moderate and note advisories exist too, and only judgement-tier findings qualify', () => {
    const v = reasoned()
    const items = advisoriesFromVerdict(v, { ...layer, strengthOf: c => (c.outcome === 'FAIL' ? 'strong' : 'note') })
    expect(items).toHaveLength(1)
    expect(counselFromReasoned(v, 'document.SUM_INT', { strength: 'note', ...layer }).strength).toBe('note')
    expect(renderCounsel(counselFromReasoned(v, 'document.SUM_INT', { strength: 'moderate', ...layer }))).toMatch(/^\*\*COUNSEL\*\* · advisory ·/)
    expect(() => counselFromReasoned(v, 'document.TAX_INT', { strength: 'strong', ...layer })).toThrow(/DETERMINISTIC: it is a VERDICT finding/)
    const abst = v.claims.find(c => c.outcome === 'INSUFFICIENT_DATA')!
    abst.tier = 'REASONED'
    expect(() => counselFromReasoned(v, abst.claim_id, { strength: 'strong', ...layer })).toThrow(/abstained/)
    expect(() => counselFromReasoned(v, 'nope', { strength: 'strong', ...layer })).toThrow(/has no claim nope/)
  })

  it('makeCounsel refuses an advisory without a strength or a dispute path, and a strong advisory without evidence', () => {
    const base = {
      kind: 'ADVISORY' as const, title: 't', body: 'b',
      provenance: { type: 'GENERATED' as const, generator: 'g', generator_version: '1', source_hash: 'h' },
      judges: [{ judge: 'J', passed: true, detail: 'd' }],
      dispute: { verdict_id: 'v', claim_id: 'c', command: 'verify opinion --dispute v --claim c' },
    }
    expect(() => makeCounsel(base)).toThrow(/must declare its strength/)
    expect(() => makeCounsel({ ...base, strength: 'moderate', dispute: undefined })).toThrow(/dispute path/)
    expect(() => makeCounsel({ ...base, strength: 'strong' })).toThrow(/always shown with the evidence/)
    expect(() => makeCounsel({ ...base, strength: 'loud' as never })).toThrow(/strength must be one of/)
    expect(makeCounsel({ ...base, strength: 'note' }).holds_action).toBe(false)
  })

  it('the ledger calibration never counts a verdict carrying a judgement-tier finding as VERDICT evidence', () => {
    const led = createLedger({ now: () => new Date('2026-09-28T00:00:00Z') })
    const plain = verify(clean, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 })
    const judged = structuredClone(verify({ ...clean, invoice_number: 'J-1' }, { now: FIXED_NOW, ruleset: INVOICE_RULESET_V0_0_1 }))
    judged.claims.find(c => c.claim_id === 'document.SUM_INT')!.tier = 'REASONED'
    led.record(plain, { tenant_id: 'acme' }); led.review(plain.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
    // The door refuses a judgement-tier finding; only a pre-door chain can still carry one, and it is excluded on read.
    expect(() => led.record(judged, { tenant_id: 'acme' })).toThrow(/judgement-tier \(REASONED\) finding/)
    const legacy = withLegacyRecord(led, judged, { tenant_id: 'acme', review: { reviewer_id: 'r', decision: 'UPHELD' } })
    const cal = workflowCalibration(legacy.all() as LedgerRecord[], 'acme/invoice@0.0.1')
    expect(cal.evidence.reviewed_pass).toEqual([plain.verdict_id])
    expect(cal.excluded).toEqual([{ verdict_id: judged.verdict_id, why: expect.stringMatching(/judgement-tier \(REASONED\) findings/) }])
  })
})
