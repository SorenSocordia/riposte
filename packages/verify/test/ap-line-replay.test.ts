/**
 * Replay picks the AP ruleset version the verdict names (protocol/replay.ts, with the LN1 one-line change): a verdict issued
 * under ap-threeway 0.1.0 is re-performed under 0.1.0, one issued under 0.2.0 under 0.2.0, and an unknown version is not
 * re-performed. Without the change, every 0.1.0 AP verdict replays as STRUCTURE_ONLY once 0.2.0 is current.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyInvoiceMatch, splitApLayout, verifyReplay } from '../src/index'

const HERE = dirname(fileURLToPath(import.meta.url))
const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const NOW = () => new Date('2026-09-24T00:00:00Z')
const policy = { price_tolerance: 0.02, total_tolerance: 0.005 }

describe('replay re-performs an AP verdict under the version it names', () => {
  it('0.1.0 and 0.2.0 verdicts of all 100 benchmark cases re-perform byte-identically, each under its own version', () => {
    for (const c of cases) {
      const ap = splitApLayout(c.input)!
      for (const ruleset of ['ap-threeway@0.1.0', 'ap-threeway@0.2.0']) {
        const v = verifyInvoiceMatch(ap, { now: NOW, ruleset }).verdict
        expect(verifyReplay(v, { ap, policy }), `${c.id} ${ruleset}`).toMatchObject({ ok: true, status: 'REPERFORMED', outcome_verified: true })
      }
    }
  })
  it('a 0.2.0 verdict relabelled 0.1.0 (id re-derived) with its line claims kept is refused: 0.1.0 re-performs without them', async () => {
    const { deriveVerdictId } = await import('../src/protocol/verdict-id')
    const ap = splitApLayout(cases[2]!.input)!
    const v = verifyInvoiceMatch(ap, { now: NOW }).verdict
    const relabelled = { ...v, ruleset: { ...v.ruleset, version: '0.1.0' } }
    relabelled.verdict_id = deriveVerdictId(relabelled.input_hash, relabelled.ruleset, relabelled.engine_version)
    expect(verifyReplay(relabelled, { ap, policy })).toMatchObject({ ok: false, status: 'FAILED' })
  })
})
