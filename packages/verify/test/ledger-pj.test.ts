/**
 * P-J (2026-09-29): the calibration facts kept in the disk index. A calibration over a whole book reads a handful of facts per
 * verdict; a disk-backed book now answers them from its index, so only a reviewed verdict is read in full. These pin:
 *   FACTS     every record's facts (`recordFacts`) and every RECORD position's (`recordFactsAt`) are the verdict's and the
 *             payload's own values; a book in the heap answers undefined (its readers read the verdict, in memory), and so do a
 *             record whose verdict a caller replaced and a position a view's holder edited.
 *   NO PARSE  a calibration of a disk-backed book reads in full only the reviewed verdicts (per rule); a voice read of one
 *             workflow, only that workflow's reviewed verdicts; a sampling frame, none.
 *   PARITY    a book carrying RECORDs the door refuses today (COUNSEL, a judgement-tier finding) and irregular ones (a fact
 *             that is not a plain string) calibrates byte-identically in both modes, with the same exclusions and versions.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, appendFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify, type Verdict } from '../src/index'
import { openFileLedger, linkEvent, chainPeriods, periodFrame, payloadViewOf, type FileLedger, type LedgerRecord } from '../src/ledger/index'
import { evidenceMark, recordFacts, recordFactsAt } from '../src/ledger/disk'
import { assessVoiceFromLedger, defaultWorkflowOf, workflowCalibration, workflowCalibrations, type PromotionPolicy } from '../src/verdict/voice'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const dir = mkdtempSync(join(tmpdir(), 'verify-ledger-pj-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const tmpPath = (): string => join(dir, `book-${n++}.jsonl`)

const PASSES: Verdict[] = Array.from({ length: 30 }, (_, i) => verify({ ...clean, invoice_number: `PJ-P${i}` }, { now: FIXED_NOW }))
const FAILS: Verdict[] = Array.from({ length: 10 }, (_, i) => verify({ ...broken, invoice_number: `PJ-F${i}` }, { now: FIXED_NOW }))
const WF = `acme/${PASSES[0]!.ruleset.id}@${PASSES[0]!.ruleset.version}`
const POLICY: PromotionPolicy = {
  policy_version: 'promotion-policy-v0', policy_id: 'pj', version: '1.0.0', method: 'wilson', sidedness: 'one-sided',
  tiers: [{ tier: 'low', description: 'test tier', confidence: 0.9, advise: { min_n: 3, max_error: 0.5 }, gate: { min_n: 5, max_error: 0.4 }, autonomy: { min_n: 8, max_error: 0.3 } }],
}
const J = (x: unknown): string => JSON.stringify(x)

/** Two tenants, reviews both ways, a re-record, a day boundary. Then legacy RECORD lines appended by hand (see `legacy`). */
function book(path: string, legacy: boolean): void {
  let c = Date.parse('2026-09-01T09:00:00Z')
  const led = openFileLedger(path, { now: () => new Date((c += 3_600_000)) })
  for (let i = 0; i < 24; i++) {
    const v = i % 4 === 3 ? FAILS[i % FAILS.length]! : PASSES[i]!
    led.record(v, { tenant_id: i % 3 === 0 ? 'globex' : 'acme' })
    if (i % 3 === 1 || i % 6 === 0) led.review(v.verdict_id, { reviewer_id: 'rev', decision: i % 2 ? 'UPHELD' : 'OVERTURNED' })
    if (i === 11) c += 86_400_000
  }
  led.record(PASSES[1]!, { tenant_id: 'acme' })
  let head = led.chainHead()
  let len = led.events().length
  led.close()
  if (!legacy) return
  // Written before the door refused them (or by another writer): the calibration must exclude and count them exactly as before.
  const counsel = { ...PASSES[25]!, channel: 'COUNSEL' }
  const reasoned = { ...PASSES[26]!, claims: PASSES[26]!.claims.map((cl, j) => (j === 0 ? { ...cl, tier: 'REASONED', outcome: 'FAIL' } : cl)) }
  const oddEngine = { ...PASSES[27]!, engine_version: 7 }
  const oddVersion = { ...PASSES[28]!, ruleset: { ...PASSES[28]!.ruleset, version: 2 } }
  const oddOutcome = { ...PASSES[29]!, outcome: 'MAYBE' }
  for (const v of [counsel, reasoned, oddEngine, oddVersion, oddOutcome] as unknown as Verdict[]) {
    const ts = new Date((c += 3_600_000)).toISOString()
    const retention_until = new Date(c + 2555 * 86_400_000).toISOString()
    const payload = { type: 'RECORD', tenant_id: 'acme', recorded_at: ts, retention_until, verdict: { ...v, ledger: { tenant_id: 'acme', retention_until } } }
    const ev = linkEvent(len++, head, { ts, type: 'RECORD', verdict_id: v.verdict_id, payload })
    head = ev.entry_hash
    appendFileSync(path, JSON.stringify({ ...ev, payload }) + '\n')
  }
}

function openBoth(legacy: boolean, cache?: number): { heap: FileLedger; disk: FileLedger } {
  const src = tmpPath()
  book(src, legacy)
  const dp = tmpPath()
  copyFileSync(src, dp)
  return { heap: openFileLedger(src, { readOnly: true }), disk: openFileLedger(dp, { readOnly: true, payloads: 'disk', ...(cache ? { cache } : {}) }) }
}

/** The disk store's count of lines read back and parsed. */
const readsOf = (l: FileLedger): number => (payloadViewOf(l.snapshot().payloads)!.store as unknown as { reads: number }).reads
/** Its count before a read, with its one cached verdict evicted (an unreviewed one's read now), so every counted read is a parse. */
const readsBefore = (l: FileLedger): number => {
  void l.query({ reviewed: false })[0]!.verdict
  return readsOf(l)
}

describe('P-J: the calibration facts in the disk index', () => {
  it('FACTS: every record and every RECORD position answers the verdict\'s and the payload\'s own values; the heap answers undefined', () => {
    const { heap, disk } = openBoth(true)
    const recs = disk.all()
    expect(recs.length).toBe(heap.all().length)
    let withFacts = 0
    for (const rec of recs) {
      const f = recordFacts(rec)
      const v = rec.verdict as unknown as Record<string, unknown> & { ruleset: Record<string, unknown> }
      const plain = typeof v.engine_version === 'string' && typeof v.ruleset.version === 'string' && ['PASS', 'FAIL', 'INSUFFICIENT_DATA'].includes(v.outcome as string)
      if (!plain) { expect(f).toBeUndefined(); continue }
      withFacts++
      expect(f).toBeDefined()
      expect(J({ id: f!.verdict_id, o: f!.outcome, r: [f!.ruleset.id, f!.ruleset.version], e: f!.engine_version })).toBe(J({ id: v.verdict_id, o: v.outcome, r: [v.ruleset.id, v.ruleset.version], e: v.engine_version }))
      expect(evidenceMark(f)).toBe(evidenceMark(rec.verdict))
      expect(defaultWorkflowOf(rec)).toBe(`${rec.tenant_id}/${v.ruleset.id}@${v.ruleset.version}`)
    }
    expect(withFacts).toBe(recs.length - 3) // the three irregular RECORDs have none
    expect(recs.map(r => evidenceMark(recordFacts(r) ?? r.verdict))).toContain('COUNSEL')
    expect(recs.map(r => evidenceMark(recordFacts(r) ?? r.verdict))).toContain('REASONED')

    const snap = disk.snapshot(), hsnap = heap.snapshot()
    for (let i = 0; i < snap.events.length; i++) {
      const f = recordFactsAt(snap.payloads, i)
      expect(recordFactsAt(hsnap.payloads, i)).toBeUndefined()
      const p = hsnap.payloads[i] as { type?: string; tenant_id?: string; recorded_at?: string; retention_until?: string; verdict?: Verdict }
      if (!f) continue
      expect(J([f.type, f.tenant_id, f.recorded_at, f.retention_until, f.verdict.verdict_id, f.verdict.outcome, f.verdict.ruleset, f.verdict.engine_version]))
        .toBe(J([p.type, p.tenant_id, p.recorded_at, p.retention_until, p.verdict!.verdict_id, p.verdict!.outcome, { id: p.verdict!.ruleset.id, version: p.verdict!.ruleset.version }, p.verdict!.engine_version]))
    }
    for (const rec of heap.all()) expect(recordFacts(rec)).toBeUndefined()
    heap.close(); disk.close()
  })

  it('FACTS: a replaced verdict, or a position a view\'s holder edited, answers undefined (read in full)', () => {
    const { heap, disk } = openBoth(false)
    const rec = disk.all()[0]!
    expect(recordFacts(rec)).toBeDefined()
    rec.verdict = { ...rec.verdict, outcome: 'FAIL' }
    expect(recordFacts(rec)).toBeUndefined()
    expect(recordFacts({ ...disk.all()[0]! })).toBeUndefined() // a spread copy carries the verdict, not the slot
    const snap = disk.snapshot()
    expect(recordFactsAt(snap.payloads, 0)).toBeDefined()
    ;(snap.payloads as unknown[])[2] = { type: 'RECORD' }
    expect(recordFactsAt(snap.payloads, 0)).toBeDefined()
    expect(recordFactsAt(snap.payloads, 2)).toBeUndefined()
    expect(recordFactsAt(snap.payloads, 3)).toBeUndefined() // past the first edit: the holder's copy, read as it is
    expect(recordFactsAt(snap.payloads, snap.events.length + 5)).toBeUndefined()
    heap.close(); disk.close()
  })

  it('PARITY: legacy COUNSEL / judgement-tier / irregular RECORDs calibrate byte-identically in both modes', () => {
    const { heap, disk } = openBoth(true)
    const all = J(workflowCalibrations(heap.all()))
    expect(J(workflowCalibrations(disk.all()))).toBe(all)
    expect(all).toContain('COUNSEL on the ledger')
    expect(all).toContain('judgement-tier (REASONED)')
    expect(all).toContain('engine 7')
    for (const opts of [{}, { since: '2026-09-02T00:00:00.000Z' }, { until: '2026-09-02T00:00:00.000Z' }, { workflowOf: (r: LedgerRecord) => (r.tenant_id === 'acme' ? defaultWorkflowOf(r) : undefined) }]) {
      expect(J(workflowCalibrations(disk.all(), opts))).toBe(J(workflowCalibrations(heap.all(), opts)))
      expect(J(workflowCalibration(disk.all(), WF, opts))).toBe(J(workflowCalibration(heap.all(), WF, opts)))
      expect(J(workflowCalibration(disk.all(), 'nobody/x@1', opts))).toBe(J(workflowCalibration(heap.all(), 'nobody/x@1', opts)))
    }
    // One workflow's calibration is the same whether computed alone or among every workflow.
    expect(J(workflowCalibration(heap.all(), WF))).toBe(J(workflowCalibrations(heap.all()).find(c => c.workflow_id === WF)))
    const ds = disk.snapshot(), hs = heap.snapshot()
    for (const day of chainPeriods(hs.events, 'day')) {
      expect(J(periodFrame(ds.events, ds.payloads, WF, day))).toBe(J(periodFrame(hs.events, hs.payloads, WF, day)))
    }
    heap.close(); disk.close()
  })

  it('NO PARSE: a calibration reads in full only the reviewed verdicts; one workflow\'s voice read, only its own; a frame, none', () => {
    const { heap, disk } = openBoth(false, 1)
    expect(disk.verifyContent().ok).toBe(true)
    expect(heap.verifyContent().ok).toBe(true)
    const reviewed = disk.query({ reviewed: true }).length
    const reviewedWf = disk.query({ reviewed: true }).filter(r => defaultWorkflowOf(r) === WF).length
    expect(reviewedWf).toBeGreaterThan(0)
    expect(reviewedWf).toBeLessThan(reviewed)

    let before = readsBefore(disk)
    const cals = workflowCalibrations(disk.all())
    expect(readsOf(disk) - before).toBe(reviewed)
    expect(J(cals)).toBe(J(workflowCalibrations(heap.all())))

    before = readsBefore(disk)
    const voice = assessVoiceFromLedger(disk, WF, POLICY, { consequence_tier: 'low' })
    expect(readsOf(disk) - before).toBe(reviewedWf)
    expect(J(voice)).toBe(J(assessVoiceFromLedger(heap, WF, POLICY, { consequence_tier: 'low' })))

    const s = disk.snapshot()
    before = readsOf(disk)
    for (const day of chainPeriods(s.events, 'day')) periodFrame(s.events, s.payloads, WF, day)
    expect(readsOf(disk) - before).toBe(0)
    heap.close(); disk.close()
  })
})
