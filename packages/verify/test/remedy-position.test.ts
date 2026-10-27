/**
 * 2026-10-05: a remedy names a line the way its claim does.
 *
 * Under engine 0.6.0 a FAILed pay-app line claim says its line as a person counts it ("previous on line 4 is ...", for
 * line[3]), while its remedies said the array index ("Line 3 says ...", "correct column D of line 3"). The fix:
 *   1. a fact {position} (verdict/remedy.ts): the line's position counting from 1 (line[3] reads "4"); {line} stays the index,
 *      for paths;
 *   2. Ruleset.remedyByCodeFor (rulesets/types.ts, verify.ts): a ruleset may answer each engine from its own table, and the
 *      verdict_id binds the one used;
 *   3. pay-app answers engine 0.6.0 from PAY_APP_REMEDIES_V060, whose words say "line {position}" and whose paths keep {line}.
 * Engines up to 0.5.0 re-perform byte for byte (their pay-app claims name no line of their own, so "line 3" agrees with the
 * claim id line[3]). Invoice and Peppol were checked and left as they are: their claims name no line either, under any engine.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verify, remediesFor, type EngineVersion } from '../src/index'
import type { ClaimVerdict } from '../src/verdict/schema'
import { PAY_APP_REMEDIES, PAY_APP_REMEDIES_V060, PAY_APP_RULESET } from '../src/rulesets/pay-app/index'
import { INVOICE_RULESET } from '../src/rulesets/invoice/index'

const NOW = () => new Date('2026-10-05T00:00:00Z')
const ex = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'examples', f), 'utf8'))
const prev = ex('payapp-g702-g703.previous.json')
const clean = () => ex('payapp-g702-g703.json')
const planted = () => { const d = ex('payapp-g702-g703.json'); d.schedule_of_values[3].previous += 1000; return d } // line[3], item 4
const run = (doc: unknown, engine: EngineVersion) => verify(doc as never, { ruleset: 'pay-app', references: { history: [prev] }, engine, now: NOW })

describe('{position}: the line as a person counts it', () => {
  const claim = (claim_id: string): ClaimVerdict => ({ claim_id, kind: 'RECOMPUTE', tier: 'DETERMINISTIC', outcome: 'FAIL', field: 'x', asserted: 1,
    rule_id: 'R', rule_name: 'r', evidence: [], locked: true, explanation: 'e', computation: { formula: 'f', operands: {}, result: 2 } })
  const table = { R: { fail: [{ kind: 'recompute-with' as const, operand: { source: 'doc', path: 'lines[{line}].x' }, detail: 'line {position} (index {line})' }] } }
  it('reads index + 1 on a line claim, "?" on a document claim; {line} stays the index, in words and paths', () => {
    const r = remediesFor({ outcome: 'FAIL', claims: [claim('line[3].R')] }, { declared: (rule) => table[rule as 'R'] })!
    expect(r[0]).toMatchObject({ detail: 'line 4 (index 3)', operand: { path: 'lines[3].x' } })
    expect(remediesFor({ outcome: 'FAIL', claims: [claim('line[0].R')] }, { declared: (rule) => table[rule as 'R'] })![0]!.detail).toBe('line 1 (index 0)')
    expect(remediesFor({ outcome: 'FAIL', claims: [claim('document.R')] }, { declared: (rule) => table[rule as 'R'] })![0]!.detail).toBe('line ? (index ?)')
  })
})

describe('pay-app: the remedy names the line the claim names, under engine 0.6.0 only', () => {
  it('0.6.0: the claim says line 4, and so do its remedies; the paths keep the index', () => {
    const v = run(planted(), '0.6.0')
    const c = v.claims.find((x) => x.claim_id === 'line[3].G703_PREV')!
    expect(c.explanation).toMatch(/^previous on line 4 is 31,000/)
    const mine = (v.remedies ?? []).filter((m) => m.claims.includes('line[3].G703_PREV'))
    expect(mine.map((m) => m.detail)).toEqual([
      'Line 4 says 31000 from previous applications; the previous application shows 30000 completed to date. Supply the previous application as certified, if another one is the previous.',
      'Otherwise correct column D of line 4 to the previous application\'s completed to date.',
    ])
    expect(mine[1]!.operand?.path).toBe('line[3].previous')
    const total = (v.remedies ?? []).find((m) => m.claims.includes('line[3].G703_TOTAL') && m.kind === 'recompute-with')!
    expect(total.detail).toMatch(/^Line 4: previous \+ this period/)
    expect(total.operand?.path).toBe('line[3].completed_to_date')
  })
  it('0.5.0: unchanged ("Line 3", agreeing with the claim id line[3]; the claim names no line)', () => {
    const v = run(planted(), '0.5.0')
    expect(v.claims.find((x) => x.claim_id === 'line[3].G703_PREV')!.explanation).toMatch(/^Law of Continuity VIOLATED/)
    expect((v.remedies ?? []).filter((m) => m.claims.includes('line[3].G703_PREV')).map((m) => m.detail)[1]).toBe('Otherwise correct column D of line 3 to the previous application\'s completed to date.')
  })
  it('the 0.6.0 table differs from the earlier one only in the eight details that name a line, and the retainage rate\'s, which names the split; no path moves', () => {
    expect(PAY_APP_RULESET.remedyByCodeFor!('0.6.0')).toBe(PAY_APP_REMEDIES_V060)
    for (const e of ['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0'] as const) expect(PAY_APP_RULESET.remedyByCodeFor!(e)).toBe(PAY_APP_REMEDIES)
    let changed = 0
    for (const [rule, r] of Object.entries(PAY_APP_REMEDIES)) for (const k of ['fail', 'abstain'] as const) (r[k] ?? []).forEach((s, i) => {
      const t = PAY_APP_REMEDIES_V060[rule]![k]![i]!
      expect(t.operand, `${rule}.${k}[${i}]`).toEqual(s.operand)
      // 2026-10-06: G702_RATE's fail remedy names the G702's own split (lines 5a and 5b) and the reduced rate, by their fields
      if (rule === 'G702_RATE' && k === 'fail' && i === 0) { expect(t.detail).toContain('retainage_rate as { "completed_work": "10%", "stored_materials": "0%" }'); return }
      if (t.detail !== s.detail) { changed++; expect(t.detail).toBe(s.detail.replace(/\b([Ll]ine) \{line\}/g, '$1 {position}')) }
    })
    expect(changed).toBe(8)
    expect(JSON.stringify(PAY_APP_REMEDIES_V060)).not.toContain('ine {line}')
  })
  it('verdict ids: engines 0.0.1 to 0.5.0 byte-identical to before the change; 0.6.0 moves (its table hash moved)', () => {
    // golden ids of the shipped G702/G703 example, recorded 2026-10-05 before and after the change
    const before: Record<string, [string, string]> = {
      '0.0.1': ['41be3991ad38794e01e29c48bd8fd244', '15a6e273503a7b450f88249c2bbae5b1'],
      '0.1.0': ['3dad7c2a3a8b6f9702041468a57175d0', 'f6e93246c88c7cd0c28ec7d1ec7986bf'],
      '0.2.0': ['713f42a8835072a40c3d276c4210e691', '327605936f6957fad00b3586b8f4f370'],
      '0.3.0': ['d665062f4a222184db00f7eedaf08ab7', 'c9070b0e16d77c3aa3accc0a1a1ce299'],
      '0.4.0': ['4dc4a23c9a1fd6af9e65f2d95d494cac', 'dacd8691a1894513ff04b53ccb9da2f7'],
      '0.5.0': ['391b6bcff0a475f16ef6875dd8fbde76', '3d62429f4b4c6798c14b1bee9a77b8b1'],
    }
    for (const [e, [c, p]] of Object.entries(before)) {
      expect(run(clean(), e as EngineVersion).verdict_id, `clean ${e}`).toBe(c)
      expect(run(planted(), e as EngineVersion).verdict_id, `planted ${e}`).toBe(p)
    }
    // 0.6.0: was 3c7328d3… (clean) and a051563b… (planted) under the table that numbered from 0, then d9fd101d… and 17b8e6ec…
    // 2026-10-05 (retainage): G702_RATE gained can't-tell remedies in the 0.6.0 table (axioms.ts RATE_ABSTAIN_V060),
    // so its hash, and every 0.6.0 pay-app verdict id, moved again. 0.6.0 is unreleased; engines 0.0.1 to 0.5.0 are unchanged (above)
    // 2026-10-05: RATE_ABSTAIN_V060's AMBIGUOUS_REFERENCE missing-operand remedy now names where an application
    // states a lower retainage (reduced_retainage_rate, a line's own retainage_rate), so the 0.6.0 table hash and both ids moved
    // again: 72893cb8… → 742f0af5… (clean), 49f7c1bd… → f9bbd336… (planted). Repinned by hand; 0.0.1 to 0.5.0 unchanged (above)
    // 2026-10-06: G703_PREV and G702_PREV gained can't-tell remedies in the 0.6.0 table (axioms.ts
    // PREV_ABSTAIN_V060, PREV_DOC_ABSTAIN_V060: the owner, a stated change order, last month's application), so the 0.6.0 table
    // hash and both ids moved again: 742f0af5… → 1c847fc9… (clean), f9bbd336… → dfa46800… (planted). Repinned by hand; 0.0.1 to
    // 0.5.0 unchanged (above)
    // 2026-10-06: the 0.6.0 table's G702_RATE remedies name the G702's own split (lines 5a and 5b), and G703_PREV's owner remedy
    // names a change order the application marks pending (axioms.ts RATE_FAIL_V060, RATE_ABSTAIN_V060, PREV_ABSTAIN_V060), so
    // the 0.6.0 table hash and both ids moved again: 1c847fc9… → c0f59984… (clean), dfa46800… → 76ff0156… (planted). Repinned by
    // hand; no outcome moved on either; 0.0.1 to 0.5.0 unchanged (above)
    expect(run(clean(), '0.6.0').verdict_id).toBe('c0f599849b95cdf464131457a8222809')
    expect(run(planted(), '0.6.0').verdict_id).toBe('76ff0156ddc050161153bb856122a480')
  })
})

describe('invoice: checked and left as it is', () => {
  it('its line claims name no line under any engine, so "Line {line}" agrees with the claim id; one table for every engine', () => {
    expect(INVOICE_RULESET.remedyByCodeFor).toBeUndefined()
    const inv = { invoice_number: 'INV-1002', currency: 'USD', invoice_date: '2026-09-15',
      line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }, { description: 'Travel', quantity: 1, unit_price: 250.5, amount: 275 }],
      totals: { subtotal: 1775, tax_rate: 0.0825, tax: 146.44, total: 1921.44 } }
    const v = verify(inv as never, { now: NOW })
    const c = v.claims.find((x) => x.claim_id === 'line[1].MATH_INT')!
    expect(c.explanation).not.toMatch(/\bline \d/i)
  })
})
