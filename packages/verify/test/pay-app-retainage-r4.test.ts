/**
 * Retainage under engine 0.6.0 (2026-10-05), and pay-app PASS explanations in a clerk's words.
 *
 * The case p2 of a cold reader in the controller's role (cold review round 4): the G702 states 10% and every line retains
 * 5%. Under the earlier ceiling reading it read PASS 44/44,
 * exit 0, console silent, paying 13,741.25 more. The stated rate now applies; a line retains less only where the application says
 * so (src/rulesets/pay-app/index.ts retainageV060). The case p1 from cold review round 3 (a reduction on one completed line, every other
 * line at 10%) still passes, and the console names the reduction.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../src/verify'
import { formatPayAppReport } from '../src/rulesets/pay-app/report'
import type { ClaimVerdict, Verdict } from '../src/verdict/schema'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, '..', 'docs', 'examples')
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
type J = Record<string, any>
const sample = (): J => JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.json'), 'utf8'))
const previous = (): J => JSON.parse(readFileSync(join(EX, 'payapp-g702-g703.previous.json'), 'utf8'))
const check = (x: J, engine?: string, prev: J | null = previous()): Verdict =>
  verify(x, { ruleset: 'pay-app', ...(prev ? { references: { history: [prev] } } : {}), now: NOW, ...(engine ? { engine } : {}) })
const rate = (v: Verdict): ClaimVerdict => v.claims.find((c) => c.claim_id === 'document.G702_RATE')!
const r2 = (x: number): number => Math.round(x * 100) / 100

/** The controller's generator: every line's retainage at `perLine(i)` of its completed work, and every total made consistent. */
function recompute(p: J, perLine: (i: number) => number): J {
  for (const [i, l] of (p.schedule_of_values as J[]).entries()) l.retainage = r2(l.completed_to_date * perLine(i))
  p.total_retainage = r2((p.schedule_of_values as J[]).reduce((s, l) => s + l.retainage, 0))
  p.total_earned_less_retainage = r2(p.total_completed_and_stored - p.total_retainage)
  p.current_payment_due = r2(p.total_earned_less_retainage - p.less_previous_certificates)
  p.balance_to_finish_including_retainage = r2(p.contract_sum_to_date - p.total_earned_less_retainage)
  return p
}
/** p2: 5% on every line, the G702 stating 10% (the controller's tmp case, byte for byte in its figures). */
const p2 = (): J => recompute(sample(), () => 0.05)

describe('retainage withheld below the stated rate goes to a person, naming the dollar difference', () => {
  it('p2, 5% on every line against a stated 10%: a person decides, and the sentence leads with 13,741.25', () => {
    const v = check(p2())
    const c = rate(v)
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation.startsWith('13,741.25 less retained than the stated 10% of 274,825 completed (27,482.50 at 10%; the total retainage says 13,741.25)')).toBe(true)
    expect(c.explanation).toContain('no line with work retains at 10% (lines 1, 2, 3, 4, 5 and 7 retain 5%; line 1 is complete)')
    expect(c.explanation).toContain('the application states no reduced rate and no line states a rate of its own')
    expect(v.gate_status ?? 'PASS_WITH_OPEN').toBe('PASS_WITH_OPEN')
    expect([v.coverage.claims_pass, v.coverage.claims_insufficient]).toEqual([43, 1])
  })

  it('the console prints it, under "A person decides", with who may clear it and what would settle it', () => {
    const p = p2()
    const block = formatPayAppReport(check(p), { extraction: p })
    const lines = block.split('\n')
    expect(lines[0]).toBe('A PERSON DECIDES. Every check that ran held, but 1 needs a person. Do not pay this application automatically.')
    expect(block).toContain('A person decides:\n  - 13,741.25 less retained than the stated 10%')
    expect(block).toContain("who may clear it: the payer's controller (ruling role: owner), for this application only")
    // 2026-10-06: the remedy names the G702's own split (lines 5a and 5b) first
    expect(block).toContain('what would settle it: Where the application states the lower retainage: the G702\'s own split, one rate on completed work and another on stored materials (retainage_rate as { "completed_work": "10%", "stored_materials": "0%" }, lines 5a and 5b); the reduced rate it states for the period (reduced_retainage_rate')
    expect(block).not.toContain('PASS. Every check ran and held.')
  })

  it('one line kept at the stated rate does not shield the others: lines that are not complete and retain less go to a person', () => {
    const p = recompute(sample(), (i) => (i === 1 ? 0.1 : 0.05)) // line 2 at 10%, the rest at 5%
    const c = rate(check(p))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('lines 3, 4, 5 and 7 retain 5%, lines that are not complete, and neither the lines nor the application state a lower rate for them')
  })

  it('every line complete and every line at 5% (a final application): still a person, never the whole application\'s rate by column I', () => {
    const p = sample()
    for (const l of p.schedule_of_values as J[]) { l.previous = l.scheduled_value; l.this_period = 0; l.materials_stored = 0; l.completed_to_date = l.scheduled_value; l.percent_complete = 100; l.balance_to_finish = 0 }
    p.total_completed_and_stored = (p.schedule_of_values as J[]).reduce((s, l) => s + l.completed_to_date, 0)
    recompute(p, () => 0.05)
    const c = rate(check(p, undefined, null))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('no line with work retains at 10%')
    expect(c.explanation).toContain('are complete')
  })
})

describe('a lower rate the application states is legitimate', () => {
  it('a line-level rate (retainage_rate on the schedule line) passes, naming the line and its own rate', () => {
    const p = recompute(sample(), (i) => (i === 2 ? 0.05 : 0.1))
    p.schedule_of_values[2].retainage_rate = '5%'
    const v = check(p)
    const c = rate(v)
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toContain('line 3 states its own rate of 5% and retains 3,600 on 72,000 completed')
    expect(c.evidence.some((e) => e.locator.kind === 'field' && e.locator.path === 'schedule_of_values[2].retainage_rate')).toBe(true)
  })

  it('a line that states its own rate but retains another: a person decides, naming both', () => {
    const p = recompute(sample(), (i) => (i === 2 ? 0.05 : 0.1))
    p.schedule_of_values[2].retainage_rate = '7%'
    const c = rate(check(p))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('line 3 states its own rate of 7% but retains 3,600 on 72,000 completed (5%)')
  })

  it('a reduced rate the application states for the period (reduced_retainage_rate) passes every line retaining it', () => {
    const p = p2(); p.reduced_retainage_rate = '5%'
    const c = rate(check(p))
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toContain('lines 1, 2, 3, 4, 5 and 7 retain the reduced rate the application states, 5%')
  })

  it('the reduced rate covers only the items it names (reduced_retainage_items): another line retaining it goes to a person', () => {
    const p = recompute(sample(), (i) => (i === 1 || i === 2 ? 0.05 : 0.1))
    p.reduced_retainage_rate = '5%'; p.reduced_retainage_items = ['2']
    const c = rate(check(p))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('line 3 retains 5%, a line that is not complete')
    p.reduced_retainage_items = ['2', '3']
    expect(rate(check(p)).outcome).toBe('PASS')
  })

  it('a stated rate that does not read as a rate is never guessed: a person decides, naming it', () => {
    const p = p2(); p.reduced_retainage_rate = 'half'
    const c = rate(check(p))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation).toContain('reduced_retainage_rate is "half", which does not read as a rate: not read, never guessed')
  })

  it('no rate on this application: the previous application\'s rate applies, so uniform under-withholding still goes to a person', () => {
    const p = p2(); delete p.retainage_rate
    const c = rate(check(p))
    expect(c.insufficiency?.reason).toBe('AMBIGUOUS_REFERENCE')
    expect(c.explanation.startsWith('13,741.25 less retained than the 10% the previous application stated (this application states no rate)')).toBe(true)
  })

  it('the legitimate p1 prints its reduction on the console, never only in the JSON', () => {
    const p = recompute(sample(), (i) => (i === 0 ? 0.05 : 0.1))
    const v = check(p)
    expect([v.outcome, v.coverage.claims_pass]).toEqual(['PASS', 44])
    const block = formatPayAppReport(v, { extraction: p })
    expect(block).toContain('PASS. Every check ran and held.\n')
    expect(block).toContain('Retainage: The total retainage, 26,882.50, is 600 less than the stated 10% of 274,825 (27,482.50), and the application says where: line 1 is complete and retains 600 on 12,000 (5%)')
  })
})

describe('every pay-app PASS reads in a clerk\'s words', () => {
  it('the README sample: 44 PASS claims, no "Law of", no "predicates", the retainage naming its rate and base', () => {
    const v = check(sample())
    expect(v.coverage.claims_pass).toBe(44)
    for (const c of v.claims) expect(c.explanation, c.claim_id).not.toMatch(/Law of|predicates|VIOLATED/)
    expect(rate(v).explanation).toBe('the total retainage, 27,482.50, is 10% of the total completed and stored, 274,825')
    expect(v.claims.find((c) => c.claim_id === 'document.G702_DUE')!.explanation).toBe('earned less retainage minus previous certificates is 130,342.50, as the current payment due says')
    expect(v.claims.find((c) => c.claim_id === 'line[2].G703_TOTAL')!.explanation).toBe('line 3: previous work plus this period plus stored materials adds to 72,000, as completed to date says')
    expect(formatPayAppReport(v, { extraction: sample() })).toContain('Retainage: the total retainage, 27,482.50, is 10% of the total completed and stored, 274,825')
  })
})

describe('earlier engines are unchanged', () => {
  it('under engine 0.5.0, p2 FAILs G702_RATE as it did, and a PASS keeps the kernel\'s words', () => {
    const v = check(p2(), '0.5.0')
    expect(rate(v).outcome).toBe('FAIL')
    expect(v.claims.find((c) => c.claim_id === 'document.G702_CSUM')!.explanation).toBe('Law of the Contract Sum: All predicates satisfied.')
  })
})
