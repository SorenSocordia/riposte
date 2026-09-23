/**
 * The AP gate replayed over Distil Labs' PUBLISHED per-invoice decisions from seven AI configurations (Apache-2.0;
 * fixtures/distil-published-decisions.json keeps only id/prediction/gold). No model is called. Uses the production AP pack,
 * which includes the two disclosed test-set wording rules — so this is a regression floor. The blind headline audit
 * (with the frozen run-1 checker) is Result 2 of ../verify/docs/BENCHMARK-AP.md.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitApLayout } from 'riposte-verify'
import { apGate } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = new Map<string, string>(readFileSync(join(HERE, '..', '..', 'verify', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8')
  .trim().split('\n').map((l) => { const c = JSON.parse(l); return [c.id, c.input] }))
const published = JSON.parse(readFileSync(join(HERE, 'fixtures', 'distil-published-decisions.json'), 'utf8')) as { configs: Record<string, [string, string, string][]> }
const NOW = () => new Date('2026-09-23T00:00:00Z')

describe('apGate — model decides, checker recomputes, only agreement executes', () => {
  for (const [config, rows] of Object.entries(published.configs)) {
    it(`${config}: every wrong decision is routed to a person; zero wrong auto-executions`, () => {
      let wrong = 0, caught = 0, wrongExecuted = 0, executed = 0
      for (const [id, prediction, gold] of rows) {
        const g = apGate(prediction, splitApLayout(cases.get(id)!)!, { now: NOW })
        const isWrong = prediction !== gold
        if (isWrong) wrong++
        if (g.action === 'EXECUTE') { executed++; if (isWrong) wrongExecuted++ } else if (isWrong) caught++
      }
      expect(wrongExecuted).toBe(0)
      expect(caught).toBe(wrong)
      expect(executed).toBeGreaterThan(0)
    })
  }

  it('agreement on a hold executes the HOLD with the exact reason; disagreement goes to a person', () => {
    const t001 = splitApLayout(cases.get('T001')!)!
    const agree = apGate('hold_quantity', t001, { now: NOW })
    expect(agree).toMatchObject({ action: 'EXECUTE', effect: 'HOLD' })
    expect(agree.check.grounding).toMatchObject({ item: 'Machine grease cartridge 14 oz', invoiced: 10, expected: 7 })
    const disagree = apGate('approve', t001, { now: NOW })
    expect(disagree).toMatchObject({ action: 'REVIEW', effect: 'HUMAN_REVIEW', checker_decision: 'hold_quantity' })
    expect(disagree.reason).toMatch(/model says "approve" but the checker says "hold_quantity"/)
  })
})
