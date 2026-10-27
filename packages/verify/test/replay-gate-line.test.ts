/**
 * 2026-10-03: a replay says what the gate decided. The AP verdict aggregates ANY_FAIL_FAILS, so an invoice the gate
 * sends to a person (a check could not run, nothing failed) has outcome PASS. A replay must never print that PASS bare: it
 * prints the gate's decision first, then the verdict with the checks that could not run. Rendering only: the verdict core,
 * its id and the exit codes are unchanged.
 * Cases: Distil Labs' public AP benchmark (Apache-2.0), vendored in data/real; the ABSTAIN case is T003 with one goods-receipt
 * line removed (a receipt not yet posted).
 * Engine 0.6.0 (2026-10-05): a run with no payment history states the duplicate check as a check that
 * could not run, so a bundle without history counts it among the checks unable to run; the clean case passes an empty payment
 * history (nothing booked yet), under which every check runs.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run, type CliIO } from '../src/cli'
import { renderAnswer, renderCaseReplay, replayBundle, replayBundles, splitApLayout, verifyInvoiceMatch, canonicalize } from '../src/index'

const CASES = readFileSync(join(__dirname, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n')
  .map(l => JSON.parse(l) as { id: string; input: string })
const POLICY = { price_tolerance: 0.02, total_tolerance: 0.005 }
const NOW = (): Date => new Date('2026-10-03T00:00:00.000Z')
const bundleOf = (layout: string) => {
  const ap = splitApLayout(layout)!
  return { verdict: verifyInvoiceMatch(ap, { policy: POLICY, now: NOW }).verdict, inputs: { ap, policy: POLICY } }
}
const T003 = CASES.find(c => c.id === 'T003')!.input
const NOT_RECEIVED = T003.replace('2. Ratchet strap 2 in x 27 ft | received 5\n', '')

const dir = mkdtempSync(join(tmpdir(), 'verify-gate-line-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const capture = (): { io: CliIO; out: string[]; err: string[] } => {
  const out: string[] = [], err: string[] = []
  return { out, err, io: { out: s => { out.push(s) }, err: s => { err.push(s) } } }
}

/** The lint: a head line that says PASS while a check could not run must carry the gate's decision or say so. */
const bareAnswer = (line: string, unchecked: number): boolean => / {2}PASS(?: |$)/.test(line) && unchecked > 0 && !/gate:|unable to run/.test(line)

describe('replay prints the decision a person acts on, never a bare PASS', () => {
  it('the invoice sent to a person: "A PERSON DECIDES (gate: a check could not decide) · verdict PASS with 1 of N checks unable to run"', () => {
    const b = bundleOf(NOT_RECEIVED)
    expect(b.verdict.outcome).toBe('PASS') // ANY_FAIL_FAILS: nothing failed; the core is untouched
    const c = replayBundle(b, 'not-received')
    // engine 0.6.0: every abstain is payable false (nothing is paid without a person); null under 0.5.0
    expect(c).toMatchObject({ result: 'MATCH', answer: 'PASS', unchecked: 2, gate: { decision: 'abstain', payable: false } })
    const head = renderCaseReplay(c).split('\n')[0]!
    expect(head).toContain(`A PERSON DECIDES (gate: a check could not decide) · verdict PASS with 2 of ${c.checks} checks unable to run`)
    expect(head).not.toContain('ABSTAIN') // 2026-10-05: the older word is never printed
    expect(bareAnswer(head, c.unchecked!)).toBe(false)
  })

  it('a clean PASS with nothing unchecked still says PASS (and the gate pays)', () => {
    const ap = { ...splitApLayout(T003)!, history: [] }
    const c = replayBundle({ verdict: verifyInvoiceMatch(ap, { policy: POLICY, now: NOW }).verdict, inputs: { ap, policy: POLICY } }, 'clean')
    expect(c).toMatchObject({ result: 'MATCH', answer: 'PASS', unchecked: 0, gate: { decision: 'approve', payable: true } })
    expect(renderCaseReplay(c).split('\n')[0]).toContain('APPROVE (gate: the check pays) · verdict PASS  verdict')
  })

  it('the 100 benchmark bundles all MATCH with exit codes unchanged; the lint finds no bare PASS; the core is not touched', () => {
    const items = CASES.map(c => ({ name: c.id, bundle: bundleOf(c.input) }))
    const s = replayBundles(items)
    expect([s.total, s.matched, s.diverged, s.not_reperformed, s.refused]).toEqual([100, 100, 0, 0, 0])
    for (const c of s.cases) {
      expect(c.gate, c.name).toBeDefined()
      expect(bareAnswer(renderCaseReplay(c).split('\n')[0]!, c.unchecked ?? 0), c.name).toBe(false)
    }
    // rendering reads the verdict, never writes it
    for (const it of items) expect(canonicalize(it.bundle.verdict)).toBe(canonicalize(bundleOf(CASES.find(c => c.id === it.name)!.input).verdict))
  })

  it('a verdict that is not AP: PASS says how many checks could not run', () => {
    expect(renderAnswer('PASS', { checks: 9, unchecked: 2 })).toBe('PASS with 2 of 9 checks unable to run')
    expect(renderAnswer('PASS', { checks: 9, unchecked: 0 })).toBe('PASS')
    expect(renderAnswer('PASS', { checks: 1, unchecked: 1 })).toBe('PASS with 1 of 1 check unable to run')
    expect(renderAnswer('FAIL', { checks: 10, unchecked: 4 })).toBe('FAIL') // a FAIL already says do not act
  })

  it('the CLI on one bundle says it the same way; its exit code is still 0', () => {
    const p = join(dir, 'not-received.json')
    writeFileSync(p, JSON.stringify(bundleOf(NOT_RECEIVED)))
    const io = capture()
    expect(run(['replay', p], io.io)).toBe(0)
    const err = io.err.join('')
    expect(err).toContain('verify replay: A PERSON DECIDES (gate: a check could not decide) · verdict PASS-WITH-OPEN: 2 of') // 2026-10-05: the AP decision word
    expect(err).not.toMatch(/verify replay: PASS(\n|$)/)
    expect(JSON.parse(io.out.join(''))).toMatchObject({ answer: 'PASS', unchecked: 2, gate: { decision: 'abstain' } })
  })
})
