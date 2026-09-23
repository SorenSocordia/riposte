/**
 * The Verification Index harness (leg 1.2): scoring, and the deterministic verifier's honest confusion over the labeled
 * corpus, against the trivial floors. Deterministic and $0 (the real llm-judge baseline is injected, not called here).
 */
import { describe, it, expect } from 'vitest'
import { score, bucket } from '../src/bench/score'
import { CORPUS } from '../src/bench/corpus'
import { runVerifier, runBaseline, buildReport, renderMarkdown, renderRealWorld } from '../src/bench/run'
import { createLedger, verify } from '../src/index'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'
import { ALWAYS_PASS, ALWAYS_FAIL, BEDROCK_AR_STUB, parseJudgment, llmJudge } from '../src/bench/baselines'

describe('scoring', () => {
  it('buckets each (label, judgment) pair correctly', () => {
    expect(bucket('ERROR', 'FAIL')).toBe('tp')
    expect(bucket('ERROR', 'PASS')).toBe('fn')
    expect(bucket('CLEAN', 'FAIL')).toBe('fp')
    expect(bucket('CLEAN', 'PASS')).toBe('tn')
    expect(bucket('ERROR', 'INSUFFICIENT_DATA')).toBe('abstain')
    expect(bucket('CLEAN', 'INSUFFICIENT_DATA')).toBe('abstain')
  })

  it('computes the headline rates, treating abstention as coverage loss (never a hit or miss)', () => {
    const m = score([
      { label: 'ERROR', judgment: 'FAIL' },            // tp
      { label: 'ERROR', judgment: 'PASS' },            // fn
      { label: 'CLEAN', judgment: 'PASS' },            // tn
      { label: 'CLEAN', judgment: 'FAIL' },            // fp
      { label: 'CLEAN', judgment: 'INSUFFICIENT_DATA' }, // abstain
    ])
    expect(m).toMatchObject({ tp: 1, fn: 1, tn: 1, fp: 1, abstain: 1, total: 5 })
    expect(m.fp_rate).toBeCloseTo(0.5, 5)   // fp / (fp + tn)
    expect(m.fn_rate).toBeCloseTo(0.5, 5)   // fn / (fn + tp)
    expect(m.abstain_rate).toBeCloseTo(0.2, 5)
    expect(m.coverage).toBeCloseTo(0.8, 5)
  })
})

describe('the deterministic verifier on the labeled corpus', () => {
  const v = runVerifier(CORPUS)
  it('has ZERO false alarms and ZERO missed errors on the v0 set, ruling on every case', () => {
    expect(v.metrics.fp_rate).toBe(0)
    expect(v.metrics.fn_rate).toBe(0)
    expect(v.metrics.coverage).toBe(1)
    expect(v.metrics.total).toBe(CORPUS.length)
  })
  it('every case\'s verdict matches its ground-truth label', () => {
    for (const r of v.rows) {
      const expected = CORPUS.find(c => c.name === r.name)!.label === 'ERROR' ? 'FAIL' : 'PASS'
      expect(r.judgment, r.name).toBe(expected)
    }
  })
})

describe('baselines frame the axis', () => {
  it('always-pass misses every error (fn_rate 100%); always-fail false-alarms on every clean doc (fp_rate 100%)', async () => {
    const pass = await runBaseline(ALWAYS_PASS, CORPUS)
    const fail = await runBaseline(ALWAYS_FAIL, CORPUS)
    expect(pass.metrics.fn_rate).toBe(1)
    expect(fail.metrics.fp_rate).toBe(1)
  })
  it('the bedrock-ar baseline is an explicit unconfigured stub, not a silent zero', () => {
    expect(() => BEDROCK_AR_STUB.judge(CORPUS[0]!)).toThrow(/not configured/)
  })
  it('parseJudgment reads an LLM answer conservatively (unclear → abstain)', () => {
    expect(parseJudgment('FAIL — the tax is wrong')).toBe('FAIL')
    expect(parseJudgment('PASS, looks consistent')).toBe('PASS')
    expect(parseJudgment('hmm, I think maybe')).toBe('INSUFFICIENT_DATA')
  })
  it('llmJudge uses the injected ask (no real model call in tests)', async () => {
    const stub = llmJudge(async () => 'FAIL: made up')
    expect(await stub.judge(CORPUS[0]!)).toBe('FAIL')
  })
})

describe('real-world Index section (the overturn rate from the ledger)', () => {
  it('renders the human-overturn rate from live ledger stats', () => {
    const led = createLedger({ now: () => new Date('2026-09-22T00:00:00Z') })
    const vC = verify(clean, { now: FIXED_NOW })
    const vB = verify(broken, { now: FIXED_NOW })
    led.record(vC, { tenant_id: 't' })
    led.record(vB, { tenant_id: 't' })
    led.review(vC.verdict_id, { reviewer_id: 'r', decision: 'OVERTURNED' })
    led.review(vB.verdict_id, { reviewer_id: 'r', decision: 'UPHELD' })
    const md = renderRealWorld(led.stats('t'))
    expect(md).toMatch(/Verdict Ledger/)
    expect(md).toMatch(/Human-overturn rate: 50\.0%/)
    expect(md).toMatch(/1 overturned of 2 reviewed/)
  })

  it('shows a dash when nothing has been reviewed (never fakes a number)', () => {
    const led = createLedger()
    led.record(verify(clean, { now: FIXED_NOW }), { tenant_id: 't' })
    expect(renderRealWorld(led.stats())).toMatch(/Human-overturn rate: —/)
  })
})

describe('report rendering', () => {
  it('builds a report with the verifier first and renders a Markdown Index', async () => {
    const report = await buildReport([ALWAYS_PASS, ALWAYS_FAIL], CORPUS)
    expect(report.systems[0]!.name).toMatch(/deterministic/)
    expect(report.systems).toHaveLength(3)
    const md = renderMarkdown(report)
    expect(md).toMatch(/# Verification Index/)
    expect(md).toMatch(/false-alarm/)
    expect(md).toMatch(/synthetic v0/)
  })
})
