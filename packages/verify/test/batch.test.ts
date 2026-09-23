/**
 * Batch verification — verify a whole book of documents in one call, with a triage summary. The real-world AP path.
 */
import { describe, it, expect } from 'vitest'
import { verifyBatch } from '../src/index'
import { route } from '../src/http/router'
import { clean, broken, noSubtotal, FIXED_NOW } from './fixtures/invoices'

describe('verifyBatch', () => {
  it('verifies many documents and summarizes the outcomes', () => {
    const r = verifyBatch([{ extraction: clean }, { extraction: broken }, { extraction: clean }], { now: FIXED_NOW })
    expect(r.count).toBe(3)
    expect(r.summary).toEqual({ PASS: 2, FAIL: 1, INSUFFICIENT_DATA: 0 })
    expect(r.results).toHaveLength(3)
    expect(r.results.every(v => v.replayable)).toBe(true)
  })

  it('honors per-item options (ruleset)', () => {
    const r = verifyBatch([{ extraction: clean }, { extraction: noSubtotal }], { now: FIXED_NOW })
    expect(r.results[0]!.outcome).toBe('PASS')
    expect(r.results[1]!.outcome).toBe('PASS') // checks that could run passed; footing abstained
  })

  it('an empty batch is a valid empty result', () => {
    expect(verifyBatch([])).toEqual({ count: 0, summary: { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 }, results: [] })
  })
})

describe('POST /v1/verify/batch', () => {
  it('verifies a batch over HTTP and returns the summary', () => {
    const res = route({ method: 'POST', path: '/v1/verify/batch', body: { items: [{ extraction: clean }, { extraction: broken }] } })
    expect(res.status).toBe(200)
    expect((res.json as { summary: Record<string, number> }).summary).toMatchObject({ PASS: 1, FAIL: 1 })
  })
  it('missing items array → 400', () => {
    expect(route({ method: 'POST', path: '/v1/verify/batch', body: {} }).status).toBe(400)
  })
})
