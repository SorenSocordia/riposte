/**
 * Ledger hardening:
 *   1. hydrate(): a reopened file ledger must rebuild exactly the state the live ledger had. A re-RECORD of a reviewed
 *      verdict keeps its review on the live ledger (record() carries it); the reopened ledger used to drop it.
 *   2. The door: `assertVerdict` at `ledger.record`. Only a well-formed VERDICT enters the book of record. COUNSEL can never
 *      be recorded as a VERDICT, nor can a judgement-tier finding, an unbound id, or an unevidenced finding. A refusal
 *      appends nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'
import { verify, verifyDeclarative, createLedger, openFileLedger, makeCounsel, ChannelViolation, stampVerdictChannel, type Verdict } from '../src/index'
import { MemoryLedger } from '../src/ledger/memory'
import { parseChainJSONL } from '../src/ledger/file'
import type { DeclarativeRuleset } from '../src/declarative/types'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const ruleset: DeclarativeRuleset = {
  id: 'test-total', version: '1.0.0', domain: 'test',
  fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
}
const paths: string[] = []
const tmpPath = (): string => { const p = join(tmpdir(), `verify-ledger-hard-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`); paths.push(p); return p }
afterEach(() => { for (const p of paths.splice(0)) if (existsSync(p)) rmSync(p) })

let t = Date.parse('2026-09-28T00:00:00Z')
const tick = (): Date => new Date((t += 60_000))

describe('hydrate(): a reopened ledger rebuilds exactly the live state', () => {
  it('REPRO: a re-RECORD of a reviewed verdict keeps its review after reopen (the live ledger keeps it)', () => {
    const path = tmpPath()
    const live = openFileLedger(path, { now: tick })
    const v = verifyDeclarative({ subtotal: 1, tax: 1, total: 9 }, ruleset, { now: () => new Date('2026-09-22T00:00:00Z') }) // FAIL
    live.record(v, { tenant_id: 't' })
    live.review(v.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED', note: 'credit note' })
    live.record(v, { tenant_id: 't' }) // re-RECORD: record() carries the review
    expect(live.get(v.verdict_id)?.review?.decision).toBe('OVERTURNED')

    const reopened = openFileLedger(path)
    expect(reopened.verifyContent().ok).toBe(true)
    expect(reopened.chainHead()).toBe(live.chainHead())
    expect(reopened.get(v.verdict_id)?.review).toEqual(live.get(v.verdict_id)?.review)
    expect(reopened.stats('t')).toEqual(live.stats('t'))
    expect(reopened.all()).toEqual(live.all())
  })

  it('PROPERTY: any interleaving of records, reviews and re-records reopens to the identical record set (memory seed and file)', () => {
    const pool: Verdict[] = []
    for (let i = 0; i < 6; i++) pool.push(verify({ ...(i % 2 ? broken : clean), invoice_number: `H-${i}` }, { now: FIXED_NOW }))
    let seed = 20260928
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    for (let trial = 0; trial < 25; trial++) {
      const path = tmpPath()
      const live = openFileLedger(path, { now: tick })
      const recorded: string[] = []
      for (let op = 0; op < 30; op++) {
        const v = pool[Math.floor(rnd() * pool.length)]!
        if (rnd() < 0.5 || recorded.length === 0) {
          live.record(v, { tenant_id: rnd() < 0.8 ? 'a' : 'b', retention_days: 30 + Math.floor(rnd() * 3) })
          if (!recorded.includes(v.verdict_id)) recorded.push(v.verdict_id)
        } else {
          const id = recorded[Math.floor(rnd() * recorded.length)]!
          live.review(id, { reviewer_id: `r${Math.floor(rnd() * 3)}`, decision: rnd() < 0.5 ? 'UPHELD' : 'OVERTURNED' })
        }
      }
      const fromFile = openFileLedger(path)
      const fromSeed = new MemoryLedger({ seed: parseChainJSONL(live.chainJSONL()) })
      for (const r of [fromFile, fromSeed]) {
        expect(r.all()).toEqual(live.all())
        expect(r.stats()).toEqual(live.stats())
        expect(r.chainHead()).toBe(live.chainHead())
        expect(r.verifyContent().ok).toBe(true)
      }
    }
  })
})

describe('the door: assertVerdict at ledger.record', () => {
  const v = verify(clean, { now: FIXED_NOW })
  const fresh = () => createLedger({ now: () => new Date('2026-09-28T00:00:00Z') })

  it('admits a well-formed VERDICT, stamped or not, and stores it byte-for-byte as before', () => {
    const led = fresh()
    const rec = led.record(v, { tenant_id: 'acme' })
    expect(rec.verdict).toEqual({ ...v, ledger: { tenant_id: 'acme', retention_until: rec.retention_until } })
    const stamped = stampVerdictChannel(verify({ ...clean, invoice_number: 'S-1' }, { now: FIXED_NOW }))
    expect(led.record(stamped, { tenant_id: 'acme' }).verdict.channel).toBe('VERDICT')
    expect(led.events()).toHaveLength(2)
  })

  it('COUNSEL can never be recorded as a VERDICT, disguised or not; the refusal appends nothing', () => {
    const led = fresh()
    led.record(v, { tenant_id: 'acme' })
    const head = led.chainHead()
    const counsel = makeCounsel({ kind: 'SUGGESTION', title: 't', body: 'b', provenance: { type: 'GENERATED', generator: 'g', generator_version: '1', source_hash: 'h' }, judges: [{ judge: 'J', passed: true, detail: 'd' }] })
    const disguisedByProvenance = { ...v, verdict_id: 'f'.repeat(32), provenance: { type: 'GENERATED', generator: 'x', generator_version: '1', source_hash: 'h' } }
    const disguisedByTag = { ...v, channel: 'COUNSEL' }
    for (const x of [counsel, disguisedByProvenance, disguisedByTag]) {
      expect(() => led.record(x as unknown as Verdict, { tenant_id: 'acme' })).toThrow(ChannelViolation)
      expect(() => led.record(x as unknown as Verdict, { tenant_id: 'acme' })).toThrow(/COUNSEL can never be presented as a VERDICT/)
    }
    expect(led.chainHead()).toBe(head)
    expect(led.events()).toHaveLength(1)
    expect(led.all()).toHaveLength(1)
  })

  it('refuses a judgement-tier finding, an unbound id, an unevidenced finding, a non-replayable or non-verdict object', () => {
    const led = fresh()
    const reasoned = structuredClone(v); reasoned.claims.find(c => c.claim_id === 'document.SUM_INT')!.tier = 'REASONED'
    const unbound = { ...structuredClone(v), verdict_id: '0'.repeat(32) }
    const fb = structuredClone(verify(broken, { now: FIXED_NOW })); fb.claims.find(c => c.outcome === 'FAIL')!.evidence = []
    const notReplayable = { ...structuredClone(v), replayable: false }
    const cases: [unknown, RegExp][] = [
      [reasoned, /judgement-tier \(REASONED\) finding/],
      [unbound, /not bound to its inputs/],
      [fb, /without evidence/],
      [notReplayable, /replayable: true/],
      [{ verdict_id: 'x' }, /not a verdict/],
      [null, /not a verdict/],
      ['PASS', /not a verdict/],
    ]
    for (const [x, why] of cases) expect(() => led.record(x as Verdict, { tenant_id: 'acme' })).toThrow(why)
    expect(led.events()).toHaveLength(0)
  })

  it('the door holds on a file ledger too: nothing refused reaches the disk', () => {
    const path = tmpPath()
    const led = openFileLedger(path, { now: tick })
    led.record(v, { tenant_id: 'acme' })
    const counsel = { ...v, channel: 'COUNSEL' }
    expect(() => led.record(counsel as unknown as Verdict, { tenant_id: 'acme' })).toThrow(ChannelViolation)
    expect(openFileLedger(path).events()).toHaveLength(1)
  })

  it('a legacy chain written before the door still opens (the past is immutable); a COUNSEL on it fails verification, named', () => {
    const led = fresh()
    led.record(v, { tenant_id: 'acme' })
    const { events, payloads } = parseChainJSONL(led.chainJSONL())
    const smuggled = { ...v, verdict_id: 'e'.repeat(32), channel: 'COUNSEL' }
    const legacy = new MemoryLedger({ seed: { events, payloads } })
    expect(legacy.verifyContent().ok).toBe(true)
    // Build a pre-door chain by hand: the same RECORD a pre-door ledger would have written for the smuggled item.
    const pre = new MemoryLedger({ now: () => new Date('2026-09-28T00:00:00Z') })
    ;(pre as unknown as { append: (t: string, id: string, p: unknown, ts: string) => void }).append('RECORD', smuggled.verdict_id, { type: 'RECORD', tenant_id: 'acme', recorded_at: '2026-09-28T00:00:00.000Z', retention_until: '2033-09-26T00:00:00.000Z', verdict: smuggled }, '2026-09-28T00:00:00.000Z')
    const reopened = new MemoryLedger({ seed: parseChainJSONL(pre.chainJSONL()) })
    // Security fix, 2026-09-28: was `verifyContent().ok === true`. The verdict door is re-applied on read, so a COUNSEL
    // on the book of record fails verification with a named reason. The chain still opens and keeps the record verbatim.
    expect(reopened.verifyContent()).toMatchObject({ ok: false, brokenAt: 0, reason: expect.stringMatching(/does not pass the verdict door \(COUNSEL/) })
    expect(reopened.get(smuggled.verdict_id)).toBeDefined() // retained verbatim (the past is immutable); the book says it is not a VERDICT
  })
})
