/**
 * `riposte replay` (2026-10-02; src/protocol/replay-case.ts, `verify replay <bundle | cases.jsonl | folder>`): a bundle
 * ({ verdict, inputs, options? }) is re-performed with the deterministic engine and byte-compared with the presented verdict,
 * remedies included. MATCH prints the answer and the remedies; a divergence names the field.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { run, type CliIO } from '../src/cli'
import {
  verify, verifyDeclarative, verifyInvoiceMatch, splitApLayout, verifyCitations, signVerdict, generateSigningKeypair,
  replayBundle, replayBundles, bundlesFromText, isReplayBundle, withoutRemedies, verifyReplay,
  type Verdict, type DeclarativeRuleset,
} from '../src/index'
import * as inv from './fixtures/invoices'
import * as pay from './fixtures/pay-apps'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-02T00:00:00.000Z')
type J = Record<string, unknown>
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

const AP_CASES = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { id: string; input: string; decision: string })
const POLICY = { price_tolerance: 0.02, total_tolerance: 0.005 }

const verifyBundle = (extraction: J, refs: { contract?: J; evidence?: J[]; history?: J[] } = {}, ruleset: 'invoice' | 'pay-app' = 'invoice', engine?: string) => ({
  verdict: verify(extraction, { ruleset, references: refs, now: NOW, ...(engine ? { engine } : {}) }),
  inputs: { extraction, references: { contract: refs.contract ?? null, evidence: refs.evidence ?? [], history: refs.history ?? [] }, source: null },
})
const apBundle = (input: string) => {
  const docs = splitApLayout(input)!
  return { verdict: verifyInvoiceMatch(docs, { now: NOW }).verdict, inputs: { ap: docs, policy: POLICY } }
}
const OPINIONS = { Carlisle: 'The court holds that the arbitration clause is unenforceable because it was procured by fraud in the inducement.' }
const legalBundle = () => {
  const citations = [{ id: '2', case_name: 'Carlisle', quote: 'the arbitration clause is VALID because it was procured by fraud' }]
  // Engine 0.5.0: this opinion text names no caption, and engine 0.6.0 checks a quotation only against a text that names its cite
  // (test/legal-060.test.ts), so under 0.6.0 this misquote would abstain instead of FAILing.
  return { verdict: verifyCitations(citations, OPINIONS, { now: NOW, engine: '0.5.0' }), inputs: { citations, sources: OPINIONS } }
}
const RS: DeclarativeRuleset = {
  id: 'po-total', version: '1.0.0',
  fields: { TOTAL: { paths: ['total'] }, LINE: { paths: ['amount'], line: true } },
  checks: [{ code: 'FOOT', left: 'TOTAL', op: '=', right: 'sum(LINE)', remedy: { kind: 'recompute-with', operand: { source: 'po', path: 'total' }, detail: 'Total {asserted}; lines {expected}.' } }],
}
const declBundle = (rs: DeclarativeRuleset = RS, engine?: string) => {
  const extraction = { total: 120, line_items: [{ amount: 50 }, { amount: 60 }] }
  return { verdict: verifyDeclarative(extraction, rs, { now: NOW, ...(engine ? { engine } : {}) }), inputs: { extraction, ruleset: rs } }
}

describe('replayBundle: MATCH prints the answer and the verdict\'s own remedies', () => {
  const bundles: [string, { verdict: Verdict; inputs: unknown }][] = [
    ['invoice FAIL', verifyBundle(inv.broken)],
    ['invoice with a contract', verifyBundle(inv.singleLine, { contract: inv.contractOverRate })],
    ['pay-app FAIL with history', verifyBundle(pay.brokenApp, { history: [pay.prevApp] }, 'pay-app')],
    ['AP hold', apBundle(AP_CASES.find((c) => c.decision === 'hold_price')!.input)],
    ['legal misquote', legalBundle()],
    ['declarative with a declared remedy', declBundle()],
  ]
  for (const [name, b] of bundles) {
    it(name, () => {
      const r = replayBundle(clone(b), name)
      expect(r).toMatchObject({ result: 'MATCH', answer: 'FAIL', verdict_id: b.verdict.verdict_id })
      expect(r.remedies).toEqual(b.verdict.remedies)
      expect(r.remedies_not_carried).toBeUndefined()
    })
  }
  it('a PASS verdict: MATCH, the answer PASS; its remedies only name what the checks that could not run need', () => {
    const r = replayBundle(verifyBundle(inv.clean), 'clean')
    expect(r).toMatchObject({ result: 'MATCH', answer: 'PASS' })
    expect(r.remedies!.every((x) => x.kind === 'missing-operand')).toBe(true)
    const all = replayBundle({ verdict: verifyDeclarative({ total: 110, line_items: [{ amount: 50 }, { amount: 60 }] }, RS, { now: NOW }), inputs: { extraction: { total: 110, line_items: [{ amount: 50 }, { amount: 60 }] }, ruleset: RS } })
    expect(all).toMatchObject({ result: 'MATCH', answer: 'PASS' })
    expect(all.remedies).toBeUndefined() // every claim PASSed: nothing to answer
  })
  it('a can\'t-tell is said INSUFFICIENT_DATA, never ABSTAIN (2026-10-05)', () => {
    const citations = [{ id: '9', case_name: 'Nowhere', quote: 'x' }]
    const r = replayBundle({ verdict: verifyCitations(citations, {}, { now: NOW }), inputs: { citations, sources: {} } }, 'abstain')
    expect(r).toMatchObject({ result: 'MATCH', answer: 'INSUFFICIENT_DATA' })
    expect(r.remedies![0]).toMatchObject({ kind: 'missing-operand', operand: { source: 'opinion' } })
  })
})

describe('replayBundle: divergences are named', () => {
  it('an edited remedy diverges at that remedy\'s field (the id does not move: remedies sit outside the hashed core)', () => {
    const b = clone(verifyBundle(inv.broken))
    b.verdict.remedies![0]!.detail = 'Pay it.'
    expect(replayBundle(b)).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies[0].detail' })
    const c = clone(verifyBundle(inv.broken))
    c.verdict.remedies![1]!.authority = 'the-agent-itself'
    expect(replayBundle(c)).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies[1].authority' })
  })
  it('a flipped outcome diverges at outcome; inputs that are not the verdict\'s diverge at input_hash', () => {
    const b = clone(apBundle(AP_CASES.find((c) => c.decision === 'hold_quantity')!.input))
    b.verdict.outcome = 'PASS'
    expect(replayBundle(b)).toMatchObject({ result: 'DIVERGED', first_difference: 'outcome' })
    const w = clone(apBundle(AP_CASES[0]!.input))
    w.inputs = apBundle(AP_CASES[1]!.input).inputs
    expect(replayBundle(w)).toMatchObject({ result: 'DIVERGED', first_difference: 'input_hash' })
  })
  it('engine 0.1.0: a declarative ruleset whose remedy text changed: the same verdict_id, but the remedies diverge (named)', () => {
    const before = declBundle(RS, '0.1.0')
    const edited: DeclarativeRuleset = { ...RS, checks: [{ ...RS.checks[0]!, remedy: { kind: 'none', detail: 'nothing to do' } }] }
    const after = declBundle(edited, '0.1.0')
    expect(after.verdict.verdict_id).toBe(before.verdict.verdict_id)
    expect(replayBundle({ verdict: before.verdict, inputs: after.inputs })).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies[0].kind' })
  })
  it('engine 0.2.0 (F9): the remedy table is bound into the id, so a changed remedy text is another verdict_id, and replay diverges', () => {
    const before = declBundle()
    const edited: DeclarativeRuleset = { ...RS, checks: [{ ...RS.checks[0]!, remedy: { kind: 'none', detail: 'nothing to do' } }] }
    const after = declBundle(edited)
    expect(after.verdict.verdict_id).not.toBe(before.verdict.verdict_id)
    expect(after.verdict.input_hash).toBe(before.verdict.input_hash)
    expect(replayBundle({ verdict: before.verdict, inputs: after.inputs })).toMatchObject({ result: 'DIVERGED', first_difference: 'verdict_id' })
  })
})

describe('a verdict issued before remedies existed', () => {
  it('by default it DIVERGES at remedies (2026-10-05); with lenientRemedies it matches on its core, the remedies reported and marked not carried (engines 0.0.1 and 0.1.0)', () => {
    const b = verifyBundle(inv.broken, {}, 'invoice', '0.1.0')
    const pre = { verdict: withoutRemedies(b.verdict), inputs: b.inputs }
    // a bundle is a file its holder has whole: a missing list is an edit unless the caller says the verdict predates remedies
    const n = b.verdict.remedies!.length
    const byDefault = replayBundle(pre, 'pre')
    expect(byDefault).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies' })
    expect(byDefault.reason).toBe(`the verdict carries no remedies; the engine re-derives ${n} ${n === 1 ? 'remedy' : 'remedies'} for it (engine 0.1.0); a replayed verdict must carry what it said. For a verdict issued before remedies existed, \`verify replay --lenient-remedies\` compares its core and reports the re-derived remedies`)
    const r = replayBundle(pre, 'pre', { lenientRemedies: true })
    expect(r).toMatchObject({ result: 'MATCH', answer: 'FAIL', remedies_not_carried: true })
    expect(r.remedies).toEqual(b.verdict.remedies)
    // ...and its core is still held exactly: a pre-remedy verdict with a flipped claim diverges, lenient or not
    const forged = clone(pre)
    forged.verdict.claims[0]!.outcome = 'PASS'
    expect(replayBundle(forged, 'f', { lenientRemedies: true })).toMatchObject({ result: 'DIVERGED' })
    // the library says the same: FAILED at remedies by default, REPERFORMED (flagged) under the option
    expect(verifyReplay(pre.verdict, pre.inputs)).toMatchObject({ status: 'FAILED', reperformed: { first_difference: 'remedies', remedies_not_carried: true } })
    expect(verifyReplay(pre.verdict, pre.inputs, { lenientRemedies: true })).toMatchObject({ status: 'REPERFORMED', reperformed: { remedies_not_carried: true } })
  })
  it('engine 0.2.0 (F18): a non-PASS verdict without its remedies diverges at remedies; it is not read as issued before them', () => {
    const b = verifyBundle(inv.broken, {}, 'invoice', '0.2.0')
    expect(b.verdict.engine_version).toBe('0.2.0')
    expect(replayBundle({ verdict: withoutRemedies(b.verdict), inputs: b.inputs })).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies' })
    // Engine 0.3.0 binds its remedy table too, and so does the current one (0.4.0): the same holds for its verdicts
    const c = verifyBundle(inv.broken)
    expect(c.verdict.engine_version).toBe('0.7.2') // the current engine (2026-10-05: 0.6.0; 2026-10-13: 0.7.0, then 0.7.1; 2026-10-14: 0.7.2)
    expect(replayBundle({ verdict: withoutRemedies(c.verdict), inputs: c.inputs })).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies' })
  })
})

describe('envelopes, shapes and refusals', () => {
  it('a signed envelope inside a bundle: MATCH when the signature verifies; DIVERGED at `signature` when the body was altered', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const b = verifyBundle(inv.broken)
    const env = signVerdict(b.verdict, privateKeyPem)
    expect(replayBundle({ verdict: env, inputs: b.inputs })).toMatchObject({ result: 'MATCH', signature_ok: true })
    const altered = clone(env)
    altered.verdict.remedies![0]!.detail = 'Pay it.'
    expect(replayBundle({ verdict: altered, inputs: b.inputs })).toMatchObject({ result: 'DIVERGED', first_difference: 'signature', signature_ok: false })
  })
  it('no inputs: NOT_REPERFORMED (nothing is said about the outcome); not a bundle: REFUSED; never a throw', () => {
    expect(replayBundle({ verdict: verifyBundle(inv.broken).verdict })).toMatchObject({ result: 'NOT_REPERFORMED' })
    expect(replayBundle({ hello: 1 })).toMatchObject({ result: 'REFUSED' })
    expect(replayBundle(null)).toMatchObject({ result: 'REFUSED' })
    expect(replayBundle({ verdict: { not: 'a verdict' }, inputs: {} })).toMatchObject({ result: 'REFUSED' })
    expect(isReplayBundle(signVerdict(verifyBundle(inv.clean).verdict, generateSigningKeypair().privateKeyPem))).toBe(false)
  })
  it('bundlesFromText: one per .jsonl line, one or an array per .json; an unparseable line is a refused case', () => {
    const b = verifyBundle(inv.clean)
    expect(bundlesFromText('a.jsonl', `${JSON.stringify(b)}\n\n${JSON.stringify(b)}\n{oops\n`).map((x) => x.name)).toEqual(['a.jsonl#1', 'a.jsonl#3', 'a.jsonl#4'])
    expect(bundlesFromText('a.json', JSON.stringify([b, b])).map((x) => x.name)).toEqual(['a.json[0]', 'a.json[1]'])
    const s = replayBundles(bundlesFromText('a.jsonl', `${JSON.stringify(b)}\n{oops\n`))
    expect(s).toMatchObject({ total: 2, matched: 1, refused: 1, diverged: 0, not_reperformed: 0 })
  })
})

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), 'verify-replay-bundles-')); dirs.push(d); return d }
function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let o = '', e = ''
  const io: CliIO = { out: (s) => { o += s }, err: (s) => { e += s } }
  const code = run(argv, io)
  return { code, out: o, err: e, json: () => JSON.parse(o) }
}

describe('verify replay <bundle | cases.jsonl | folder>', () => {
  it('a folder of bundles (here, 12 of the frozen AP bench cases): every case MATCHes, exit 0; the remedies are printed', () => {
    const d = scratch()
    AP_CASES.slice(0, 12).forEach((c, i) => writeFileSync(join(d, `${String(i).padStart(3, '0')}.json`), JSON.stringify(apBundle(c.input))))
    const r = go(['replay', d])
    expect(r.code).toBe(0)
    expect(r.json()).toMatchObject({ total: 12, matched: 12, diverged: 0, not_reperformed: 0, refused: 0 })
    expect(r.err).toContain('verify replay: 12 case(s): 12 match')
    expect(r.err).toMatch(/remedy: (authority|missing-operand|recompute-with|transform)/)
  })
  it('one tampered case in the folder: exit 1, the case and the field named', () => {
    const d = scratch()
    writeFileSync(join(d, 'a.json'), JSON.stringify(apBundle(AP_CASES[0]!.input)))
    const t = clone(apBundle(AP_CASES[1]!.input))
    t.verdict.claims[0]!.explanation = 'all good'
    writeFileSync(join(d, 'b.json'), JSON.stringify(t))
    const r = go(['replay', d])
    expect(r.code).toBe(1)
    expect(r.json().cases[1]).toMatchObject({ name: 'b.json', result: 'DIVERGED', first_difference: 'claims[0].explanation' })
    expect(r.err).toContain('diverges at `claims[0].explanation`')
  })
  it('a .jsonl of bundles; a single bundle file (exit 0, the answer in the JSON); flags beside a bundle are refused', () => {
    const d = scratch()
    const lines = [verifyBundle(inv.broken), legalBundle(), declBundle()].map((b) => JSON.stringify(b)).join('\n')
    writeFileSync(join(d, 'cases.jsonl'), lines)
    expect(go(['replay', join(d, 'cases.jsonl')])).toMatchObject({ code: 0 })
    writeFileSync(join(d, 'one.json'), JSON.stringify(verifyBundle(inv.broken)))
    const one = go(['replay', join(d, 'one.json')])
    expect(one.code).toBe(0)
    expect(one.json()).toMatchObject({ answer: 'FAIL', status: 'REPERFORMED', reperformed: { identical: true } })
    expect(one.json().reperformed.remedies.length).toBeGreaterThan(0)
    expect(one.err).toContain('verify replay: FAIL: 3 of 13 checks failed\n  remedy: recompute-with invoice:SUBTOTAL (subtotal) → SUM_INT:') // 2026-10-05: the headline counts
    expect(go(['replay', join(d, 'one.json'), '--inputs', join(d, 'one.json')]).code).toBe(3)
  })
  it('an empty folder is a usage error (3), never a silent pass', () => {
    expect(go(['replay', scratch()]).code).toBe(3)
  })
})
