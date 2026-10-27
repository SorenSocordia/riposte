/**
 * The book's door holds each action version to its own rules (src/action/door.ts, called by recordedVerdictProblem; the HTTP
 * door delegates, so both agree). Every forgery below is made self-consistent everywhere else (outcome and coverage recounted,
 * verdict_id re-derived after a relabel), so the refusal comes from the version's own rule. Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, type ActionSources, type ProposedAction, type Verdict } from '../src/index'
import { recordedVerdictProblem } from '../src/ledger/decisions'
import { verdictDoorProblem } from '../src/http/service'
import { verifyReplay, deriveVerdictId } from '../src/protocol/replay'
import { actionVersionProblem } from '../src/action/door'
import type { ClaimVerdict } from '../src/verdict/schema'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const A = { amount: 980.5, to_account: '220-000-1111', reference: 'INV-A-0001' }
const B = { amount: 1200, to_account: '330-000-2222', reference: 'INV-B-0002' }
const RECORDS: ActionSources = { records: [A, B] }
const pay = (args: Record<string, unknown>): ProposedAction => ({ tool: 'pay_invoice', arguments: args })
const doors = (v: unknown): [string | undefined, string | undefined] => { const x = JSON.parse(JSON.stringify(v)); return [recordedVerdictProblem(x), verdictDoorProblem(x)] }

/** Rewrite a verdict's claims, then make it self-consistent: coverage and outcome recounted, the id re-derived. */
function forge(v: Verdict, edit: (claims: ClaimVerdict[]) => ClaimVerdict[], relabel?: string): Verdict {
  const x = JSON.parse(JSON.stringify(v)) as Verdict
  x.claims = edit(x.claims)
  if (relabel) x.ruleset = { ...x.ruleset, version: relabel }
  const pass = x.claims.filter(c => c.outcome === 'PASS').length, fail = x.claims.filter(c => c.outcome === 'FAIL').length
  const ins = x.claims.length - pass - fail
  x.coverage = { claims_total: x.claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins }
  x.outcome = fail > 0 ? 'FAIL' : ins > 0 || pass + fail === 0 ? 'INSUFFICIENT_DATA' : 'PASS'
  x.verdict_id = deriveVerdictId(x.input_hash, x.ruleset, x.engine_version, x.remedy_table_hash)
  return x
}
const asPass = (c: ClaimVerdict): ClaimVerdict => ({ ...c, outcome: 'PASS', computation: { ...c.computation!, result: true } })

describe('genuine verdicts read', () => {
  it('every 0.2.0 verdict, and every earlier one, passes both doors (seeded mix of forms, records, lists, text)', () => {
    let seed = 7
    const r = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const versions = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const recs = [{ ...A, amount: r() < 0.5 ? 980.5 : '980.50' }, B]
      const amount = [980.5, '980.50', '980.500', 1200, '1200.00', '$980.50', 980.51, -980.5][Math.floor(r() * 8)]
      const to = r() < 0.8 ? A.to_account : B.to_account
      const args: Record<string, unknown> = { amount, to_account: to, ...(r() < 0.8 ? { reference: r() < 0.5 ? A.reference : 'inv-a-0001' } : {}) }
      const sources: ActionSources = r() < 0.7
        ? { records: recs, ...(r() < 0.4 ? { allowed: { amount: [980.5, 1200] } } : {}), ...(r() < 0.3 ? { text: 'memo' } : {}) }
        : { allowed: { amount: [980.5, 1200], to_account: [A.to_account] } }
      if (r() < 0.4) sources.fields = { amount: { type: 'amount', currency: 'USD' }, reference: { type: 'identifier', case_insensitive: true } }
      const v = verifyAction(pay(args), sources, NOW)
      versions.add(v.ruleset.version)
      expect(doors(v), JSON.stringify({ args, sources })).toEqual([undefined, undefined])
      expect(verifyReplay(v, { action: pay(args), sources })).toMatchObject({ ok: true, status: 'REPERFORMED' })
    }
    expect([...versions].sort()).toEqual(['0.0.1', '0.1.0', '0.2.0'])
  })
})

describe('a forged 0.2.0 verdict that hides a FAIL is refused', () => {
  // A's amount in the other form, B's account: a 0.2.0 mix-and-match FAIL (the closest record is counted under the typed comparison)
  const MIX = verifyAction(pay({ ...A, amount: '980.50', to_account: B.to_account }), RECORDS, NOW)
  // an allow-list call: the amount matches in another form (PASS), the account is on no list (FAIL)
  const LIST = verifyAction(pay({ amount: '980.50', to_account: '999-999-9999' }), { allowed: { amount: [980.5], to_account: [A.to_account] } }, NOW)
  const REPR = verifyAction(pay({ ...A, amount: '980.50' }), RECORDS, NOW)

  it('the fixtures are genuine 0.2.0 verdicts', () => {
    expect([MIX.outcome, LIST.outcome, REPR.outcome]).toEqual(['FAIL', 'FAIL', 'PASS'])
    for (const v of [MIX, LIST, REPR]) { expect(v.ruleset.version).toBe('0.2.0'); expect(doors(v)).toEqual([undefined, undefined]) }
  })
  it('one FAIL flipped to PASS: record claims never mix PASS with FAIL', () => {
    const x = forge(MIX, cs => cs.map(c => (c.field === 'amount' ? { ...asPass(c), computation: { ...c.computation!, result: true, operands: { ...c.computation!.operands, approved: 980.5, record: 0 } }, evidence: [{ ...c.evidence[0]!, locator: { kind: 'field', source: 'contract', path: 'records[0].amount' } }] } : c)))
    expect(doors(x)[0]).toMatch(/mix PASS with FAIL|a record is grounded only as a whole/)
    expect(doors(x)[1]).toBe(doors(x)[0])
  })
  it('every FAIL flipped to PASS: the account does not recompute as the approved one', () => {
    const x = forge(MIX, cs => cs.map(c => { const ev = c.evidence[0]!; return { ...asPass(c), computation: { ...c.computation!, result: true, operands: { ...c.computation!.operands, approved: ev.value as string | number, record: 0 } } } }))
    expect(x.outcome).toBe('PASS')
    expect(doors(x)[0]).toMatch(/claim arg\.to_account is PASS, but its approved value "220-000-1111" and the asserted "330-000-2222" are not the same value under undeclared/)
  })
  it('a FAIL claim deleted: one claim per consequential argument', () => {
    const x = forge(LIST, cs => cs.filter(c => c.outcome !== 'FAIL'))
    expect(x.outcome).toBe('PASS')
    expect(doors(x)[0]).toMatch(/exactly one claim per consequential argument \(arg\.amount, arg\.to_account\), in order; it has arg\.amount/)
  })
  it('a PASS whose comparison is swapped for one that does not recompute', () => {
    const x = forge(REPR, cs => cs.map(c => (c.field === 'amount' ? { ...c, computation: { ...c.computation!, operands: { ...c.computation!.operands, type: 'text' } } } : c)))
    expect(doors(x)[0]).toMatch(/not the same value under text/)
    const y = forge(REPR, cs => cs.map(c => (c.field === 'amount' ? { ...c, computation: { ...c.computation!, operands: { ...c.computation!.operands, type: 'money' } } } : c)))
    expect(doors(y)[0]).toMatch(/names no known comparison/)
  })
  it('a PASS whose computation says false, a PASS without its approved value, two records cited', () => {
    expect(doors(forge(REPR, cs => cs.map((c, i) => (i === 0 ? { ...c, computation: { ...c.computation!, result: false } } : c))))[0]).toMatch(/computation's result is false/)
    expect(doors(forge(REPR, cs => cs.map((c, i) => { if (i !== 0) return c; const { approved: _, ...ops } = c.computation!.operands; return { ...c, computation: { ...c.computation!, operands: ops } } })))[0]).toMatch(/does not carry the approved value/)
    const two = verifyAction(pay({ ...A, amount: '980.50' }), { records: [A, { ...A, reference: 'X' }, { ...A }] }, NOW)
    expect(doors(forge(two, cs => cs.map(c => (c.field === 'reference' ? { ...c, computation: { ...c.computation!, operands: { ...c.computation!.operands, record: 2 } }, evidence: [{ ...c.evidence[0]!, locator: { kind: 'field', source: 'contract', path: 'records[2].reference' } }] } : c))))[0]).toMatch(/cites records\[2\], but another record-named argument is grounded in records\[0\]/)
  })
  it('a 0.2.0 PASS in another written form relabelled to an earlier version (to dodge the recompute) is refused', () => {
    expect(doors(forge(REPR, cs => cs, '0.1.0'))[0]).toMatch(/claim arg\.amount is an action@0\.1\.0 PASS, which cites a value equal to the asserted one as written; it cites "980\.5" for "980\.50"/)
    const listPass = verifyAction(pay({ amount: '980.50' }), { allowed: { amount: [980.5] } }, NOW)
    expect(listPass.ruleset.version).toBe('0.2.0')
    expect(doors(forge(listPass, cs => cs, '0.0.1'))[0]).toMatch(/is an action@0\.0\.1 PASS, which cites a value equal to the asserted one as written/)
  })
})

describe('the honest boundary, pinned: what only the inputs can show', () => {
  const REPR = verifyAction(pay({ ...A, amount: '980.50' }), RECORDS, NOW)
  const MIX = verifyAction(pay({ ...A, amount: '980.50', to_account: B.to_account }), RECORDS, NOW)
  it('operands rewritten together with the outcome read at the door; replay with the inputs refuses them', () => {
    const x = forge(MIX, cs => cs.map(c => ({ ...asPass(c), computation: { ...c.computation!, result: true, operands: { ...c.computation!.operands, approved: c.asserted as string, record: 1 } }, evidence: [{ locator: { kind: 'field', source: 'contract', path: `records[1].${c.field}` }, value: c.asserted, confidence: 100, role: 'REFERENCE' }] })))
    expect(doors(x)).toEqual([undefined, undefined])
    expect(verifyReplay(x, { action: pay({ ...A, amount: '980.50', to_account: B.to_account }), sources: RECORDS })).toMatchObject({ ok: false, status: 'FAILED' })
  })
  it('a FAIL rewritten as can\'t-tell reads at the door (it still holds the action); replay refuses it', () => {
    const x = forge(MIX, cs => cs.map(c => ({ ...c, outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'FIELD_MISSING', detail: 'forged' }, computation: undefined, evidence: [] } as unknown as ClaimVerdict)))
    expect(doors(x)).toEqual([undefined, undefined])
    expect(verifyReplay(x, { action: pay({ ...A, amount: '980.50', to_account: B.to_account }), sources: RECORDS }).status).toBe('FAILED')
  })
  it('a genuine 0.2.0 PASS re-performs', () => {
    expect(verifyReplay(REPR, { action: pay({ ...A, amount: '980.50' }), sources: RECORDS })).toMatchObject({ ok: true, status: 'REPERFORMED' })
  })
  it('non-action verdicts and unknown action versions are not held here', () => {
    expect(actionVersionProblem({ ruleset: { id: 'invoice', version: '0.2.0' }, claims: [] })).toBeUndefined()
    expect(actionVersionProblem({ ruleset: { id: 'action', version: '0.9.0' }, claims: [{ outcome: 'PASS' }] })).toBeUndefined()
    expect(actionVersionProblem(null)).toBeUndefined()
  })
})
