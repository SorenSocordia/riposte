/**
 * Replay re-performs the action version a verdict names (protocol/replay.ts, with the action@0.2.0 one-line change): a 0.1.0
 * verdict on an input that 0.2.0 decides differently is re-performed under 0.1.0, not left STRUCTURE_ONLY; a 0.2.0 verdict
 * under 0.2.0; a relabelled one fails. Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest'
import { verifyAction, type ActionSources, type ProposedAction } from '../src/index'
import { verifyReplay, deriveVerdictId } from '../src/protocol/replay'

const NOW = { now: () => new Date('2026-09-29T12:00:00Z') }
const A = { amount: 980.5, to_account: '220-000-1111', reference: 'INV-A-0001' }
const B = { amount: 1200, to_account: '330-000-2222', reference: 'INV-B-0002' }
const pay = (args: Record<string, unknown>): ProposedAction => ({ tool: 'pay_invoice', arguments: args })

describe('replay picks the action version the verdict names', () => {
  const inputs: [ProposedAction, ActionSources][] = [
    [pay({ ...A, amount: '980.50' }), { records: [A, B] }],
    [pay({ amount: '1200.00' }), { allowed: { amount: [980.5, 1200] } }],
    [pay({ amount: '$1,200.00' }), { allowed: { amount: [1200] }, fields: { amount: { type: 'amount', currency: 'USD' } } }],
    [pay({ amount: '980.50', to_account: A.to_account }), { records: [A, B] }],
    [pay(A), { records: [A, B] }],
  ]
  it('every input, under each retained version: REPERFORMED', () => {
    for (const [action, sources] of inputs) {
      for (const ruleset of ['action@0.2.0', 'action@0.1.0', 'action@0.0.1']) {
        const v = verifyAction(action, sources, { ...NOW, ruleset })
        expect(verifyReplay(v, { action, sources }), `${ruleset} ${JSON.stringify(action.arguments)}`).toMatchObject({ ok: true, status: 'REPERFORMED' })
      }
    }
  })
  it('a 0.2.0 PASS relabelled 0.1.0 (its id re-derived) is re-performed under 0.1.0 and fails', () => {
    const [action, sources] = inputs[0]!
    const v = verifyAction(action, sources, NOW)
    expect(v.ruleset.version).toBe('0.2.0')
    const x = { ...v, ruleset: { ...v.ruleset, version: '0.1.0' } }
    x.verdict_id = deriveVerdictId(x.input_hash, x.ruleset, x.engine_version, x.remedy_table_hash)
    expect(verifyReplay(x, { action, sources })).toMatchObject({ ok: false, status: 'FAILED' })
  })
  it('an unknown action version is not re-performed (STRUCTURE_ONLY), never guessed', () => {
    const [action, sources] = inputs[0]!
    const v = verifyAction(action, sources, NOW)
    const x = { ...v, ruleset: { ...v.ruleset, version: '0.9.0' } }
    x.verdict_id = deriveVerdictId(x.input_hash, x.ruleset, x.engine_version, x.remedy_table_hash)
    const r = verifyReplay(x, { action, sources })
    expect(r.status).toBe('STRUCTURE_ONLY')
    expect(r.not_reperformed).toMatch(/unknown action ruleset "action@0\.9\.0"/)
  })
})
