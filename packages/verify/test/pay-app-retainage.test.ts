/**
 * Retainage under engine 0.6.0 (2026-10-05) and the pay application's plain-English block.
 *
 * A cold reader in the controller's role (cold review round 3) lowered retainage to 5% on a completed line, kept every total consistent, and got FAIL G702_RATE; with
 * retainage_rate removed, the application went to a person instead (src/rulesets/pay-app/index.ts retainageV060). And a failed
 * pay application printed only "verify: FAIL: 1 of 44 checks failed" (src/rulesets/pay-app/report.ts).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../src/verify'
import { run } from '../src/cli'
import { formatPayAppReport } from '../src/rulesets/pay-app/report'
import type { ClaimVerdict, Verdict } from '../src/verdict/schema'
import { cleanScratch, scratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, '..', 'docs', 'examples')
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
type J = Record<string, any>
const sample = (): J => JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.json'), 'utf8'))
const previous = (): J => JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.previous.json'), 'utf8'))
const check = (x: J, engine?: string, prev: J | null = previous()): Verdict =>
  verify(x, { ruleset: 'pay-app', ...(prev ? { references: { history: [prev] } } : {}), now: NOW, ...(engine ? { engine } : {}) })
const rate = (v: Verdict): ClaimVerdict => v.claims.find((c) => c.claim_id === 'document.G702_RATE')!

/** The controller's p1: line 1 is complete and its retainage is reduced to 5% (600), every total made consistent. */
function p1(): J {
  const p = sample()
  p.schedule_of_values[0].retainage = 600; p.total_retainage = 26882.5; p.total_earned_less_retainage = 247942.5; p.current_payment_due = 130942.5; p.balance_to_finish_including_retainage = 182557.5
  return p
}
/** p4: p1 with retainage_rate removed. */
const p4 = (): J => { const p = p1(); delete p.retainage_rate; return p }
/**
 * 2026-10-05: with no rate on this application, the previous application's stated rate applies. A test of
 * "no rate stated anywhere" therefore passes a previous application with its rate removed.
 */
const previousNoRate = (): J => { const p = previous(); delete p.retainage_rate; return p }

// 2026-10-05: the ceiling reading let an application stating 10% and retaining 5% on every line pass. The
// stated rate now applies, and a line retains less only where the application says so (its own rate, a stated reduced rate, or a
// complete line's column I beside lines at the rate). The expectations below moved with it; test/pay-app-retainage-r4.test.ts
// holds the cases from cold review round 4.
describe('G702_RATE under engine 0.6.0: the stated rate applies; a lower rate only where the application states it', () => {
  it('the README sample still passes 44 of 44, its retainage at the stated rate', () => {
    const v = check(sample())
    expect([v.outcome, v.coverage.claims_pass, v.coverage.claims_total]).toEqual(['PASS', 44, 44])
    expect(rate(v).computation?.formula).toBe('line 5 = line 4 × rate')
  })

  it('p1, a reduction on a completed line that the lines carry (column I): PASS, naming the line and its rate', () => {
    const v = check(p1())
    expect([v.outcome, v.coverage.claims_pass, v.coverage.claims_total]).toEqual(['PASS', 44, 44])
    const c = rate(v)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toBe('The total retainage, 26,882.50, is 600 less than the stated 10% of 274,825 (27,482.50), and the application says where: line 1 is complete and retains 600 on 12,000 (5%): a reduction on completed work, stated by its column I; every other line with work retains at 10%.')
    expect(c.computation?.formula).toBe('line 5 = Σ column I, each line at the rate unless the application states a lower one for it')
    expect(c.evidence.some((e) => e.locator.kind === 'field' && e.locator.path === 'schedule_of_values[0].retainage')).toBe(true)
  })

  it('p4, the same with no retainage_rate: the previous application\'s 10% applies, and the completed line\'s reduction passes', () => {
    const v = check(p4())
    expect([v.outcome, v.coverage.claims_pass]).toEqual(['PASS', 44])
    expect(rate(v).explanation).toBe('The total retainage, 26,882.50, is 600 less than the 10% the previous application stated (this application states no rate) of 274,825 (27,482.50), and the application says where: line 1 is complete and retains 600 on 12,000 (5%): a reduction on completed work, stated by its column I; every other line with work retains at 10%.')
  })

  it('p4 with no rate stated anywhere (nor on the previous application): the lines\' own retainage is read and each line\'s rate listed', () => {
    const v = check(p4(), undefined, previousNoRate())
    expect([v.outcome, v.coverage.claims_pass]).toEqual(['PASS', 44])
    expect(rate(v).explanation).toBe('The total retainage is the lines\' own retainage (column I): no single retainage rate is stated, so no line was checked against one; the lines retain 5% on line 1; 10% on lines 2, 3, 4, 5, 7.')
    expect(rate(v).computation?.formula).toBe('line 5 = Σ column I (no rate stated: the lines\' own retainage)')
  })

  it('p2 and p3 (a line-math typo, a payment due off by 1,000) still FAIL, on their own checks', () => {
    const p2 = sample(); p2.schedule_of_values[2].this_period = 48100
    const p3 = sample(); p3.current_payment_due = 131342.5
    expect(check(p2).claims.filter((c) => c.outcome === 'FAIL').map((c) => c.claim_id)).toEqual(['line[2].G703_TOTAL'])
    expect(check(p3).claims.filter((c) => c.outcome === 'FAIL').map((c) => c.claim_id)).toEqual(['document.G702_DUE'])
  })

  it('retaining MORE than the stated rate still FAILs', () => {
    const p = sample(); p.retainage_rate = '5%'
    const c = rate(check(p))
    expect(c.outcome).toBe('FAIL')
    expect(c.explanation).toBe('the retainage rate applied to the total completed and stored gives 13,741.25, but the total retainage says 27,482.50')
  })

  it('every line at the full rate with only the total short (under-withheld) still FAILs', () => {
    const p = sample(); p.total_retainage = 26482.5
    expect(rate(check(p)).outcome).toBe('FAIL')
  })

  it('under the rate where the application\'s figures do not account for it: a person decides, with both figures and who may clear it', () => {
    const noColumnI = p1(); for (const l of noColumnI.schedule_of_values) delete l.retainage
    const v = check(noColumnI)
    const c = rate(v)
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toBe('600 less retained than the stated 10% of 274,825 completed (27,482.50 at 10%; the total retainage says 26,882.50), and the schedule lines do not all carry their retainage (column I) to say where a lower rate applies. A person confirms the retainage terms before it is paid')
    const who = (v.remedies ?? []).filter((m) => m.claims.includes('document.G702_RATE')).map((m) => m.authority ?? m.operand?.role)
    // 2026-10-05: the missing-operand remedy names where an application states a lower retainage (reduced_retainage_rate)
    expect(who).toEqual(['owner', 'RETAINAGE_RATE'])

    const lineOver = p1(); lineOver.schedule_of_values[1].retainage = 10840; lineOver.schedule_of_values[2].retainage = 6600 // line 2 over, total unchanged
    const o = rate(check(lineOver))
    expect(o.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(o.explanation).toContain('line 2 retains 10,840 on 102,400 completed (10.6%), more than the stated 10%')

    const notAdding = p1(); notAdding.schedule_of_values[0].retainage = 300
    expect(rate(check(notAdding)).explanation).toContain("the lines' retainage (column I) adds to 26,582.50, not 26,882.50")
  })

  it('no rate and no column I: a clerk\'s sentence naming the field to supply, never engine vocabulary', () => {
    const p = p4(); for (const l of p.schedule_of_values) delete l.retainage
    const c = rate(check(p, undefined, previousNoRate())) // no rate anywhere (2026-10-05: last month's rate would apply)
    expect(c.insufficiency?.reason).toBe('FIELD_MISSING')
    expect(c.explanation).toBe('the retainage against the retainage rate cannot be checked: the retainage rate (for example "10%") is not on the application. Supply retainage_rate, or each schedule line\'s retainage (column I), and the check runs')
    expect(c.insufficiency?.detail).toBe(c.explanation)
    expect(`${c.explanation} ${c.insufficiency?.detail}`).not.toMatch(/Cannot evaluate|missing bindings|EXPECTED_|RETAINAGE_RATE|Please supply/)
  })

  it('a check that needs last month says so in words', () => {
    const v = check(sample(), undefined, null)
    const prev = v.claims.find((c) => c.claim_id === 'document.G702_PREV')!
    expect(prev.explanation).toBe('the previous certificates against last month\'s application cannot be checked: last month\'s application was not supplied. Supply it as history (--history <last-month.json>), and the check runs')
  })

  it('the previous application\'s different rate is named', () => {
    const prev = previous(); prev.retainage_rate = '10%'
    const p = sample(); p.retainage_rate = '5%'; p.total_retainage = 13741.25
    for (const l of p.schedule_of_values) l.retainage = Math.round(l.completed_to_date * 5) / 100
    p.total_earned_less_retainage = 274825 - 13741.25; p.current_payment_due = p.total_earned_less_retainage - p.less_previous_certificates; p.balance_to_finish_including_retainage = 430500 - p.total_earned_less_retainage
    const c = rate(check(p, undefined, prev))
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toBe('The total retainage, 13,741.25, is the retainage rate applied to the total completed and stored; the previous application stated 10%.')
  })

  it('engines up to 0.5.0 are unchanged: p1 FAILs G702_RATE there, and the open check keeps its old words', () => {
    expect(rate(check(p1(), '0.5.0')).outcome).toBe('FAIL')
    expect(rate(check(p4(), '0.5.0')).explanation).toBe('Cannot evaluate: missing bindings for EXPECTED_RETAINAGE_TOTAL')
  })
})

describe('a pay application prints the plain-English block on stderr', () => {
  afterAll(() => cleanScratch())
  const p2 = (): J => { const p = sample(); p.schedule_of_values[2].this_period = 48100; return p }

  it('formatPayAppReport: the headline, each failed check with the fields it read and who may clear it', () => {
    const block = formatPayAppReport(check(p2()), { extraction: p2() })
    const lines = block.split('\n')
    expect(lines[0]).toBe('FAIL. Do not pay this application as it stands.')
    expect(lines[1]).toBe('Application 3 · period to 2026-09-30 · Example Mechanical Services · Riverside Clinic HVAC renovation (synthetic example)')
    expect(block).toContain('  - line 3: previous work plus this period plus stored materials adds to 72,100, but completed to date says 72,000')
    expect(block).toContain('schedule_of_values[2].this_period = 48100')
    expect(block).toContain('who may clear it: the person who certifies the application (the architect, on AIA G702) (certifier), for this application only')
    expect(block).toContain('Checks: 43 passed, 1 failed, 0 could not run.')
  })

  it('an open check reads as a clerk\'s sentence with what would settle it', () => {
    const p = p4(); for (const l of p.schedule_of_values) delete l.retainage
    const block = formatPayAppReport(check(p, undefined, previousNoRate()), { extraction: p }) // no rate anywhere (2026-10-05)
    // two open: the rate check, and the lines' retainage sum (no column I to add up, as before)
    expect(block.split('\n')[0]).toBe('A PERSON DECIDES. Every check that ran held, but 2 could not run. Do not pay this application automatically.')
    expect(block).toContain('Supply retainage_rate, or each schedule line\'s retainage (column I)')
    expect(block).toContain('what would settle it: The retainage rate (retainage_rate, for example "10%")')
    expect(block).not.toMatch(/Cannot evaluate|missing bindings/)
  })

  it('the CLI prints it after the headline; the JSON on stdout is the verdict, unchanged', () => {
    const d = scratch('payapp-')
    const f = join(d, 'p2.json'); writeFileSync(f, JSON.stringify(p2()))
    let out = '', err = ''
    const code = run([f, '--ruleset', 'pay-app', '--history', join(EX, 'payapp-g702-g703.previous.json')], { out: (s) => { out += s }, err: (s) => { err += s } })
    expect(code).toBe(1)
    expect(err.split('\n')[0]).toBe('verify: FAIL: 1 of 44 checks failed')
    expect(err).toContain('FAIL. Do not pay this application as it stands.')
    expect(err).toContain('line 3: previous work plus this period plus stored materials adds to 72,100')
    expect(JSON.parse(out).claims.length).toBe(44)
  })
})
