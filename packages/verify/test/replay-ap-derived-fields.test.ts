/**
 * The fields `verify ap` writes beside its verdict are re-derived and compared on replay (2026-10-19; a cold reader in a
 * controller's role, reproduced by the maintainer the same evening: fixtures/r10/README.md).
 *
 * The output of `verify ap` carries the decision a person acts on beside the verdict: `decision`, `payable`, `grounding`,
 * `reasons`, `not_checked` (and `exit`, `allow_open` when --allow-open was given). A replay re-performed the verdict and compared it
 * byte for byte, but it compared none of those fields, and it did not name them either (they are the command's own members), so
 * a hold rewritten to "approve, all checks passed" replayed "outcome VERIFIED", exit 0, under --strict, on the emailed-bill path and
 * the structured path alike. Now:
 *   1. every derived field is re-derived from the re-performed verdict's own inputs, under the verdict's engine and ruleset, and a
 *      field that differs FAILS the replay by name (exit 1), with or without --strict;
 *   2. a key `verify ap` never writes, beside its output, inside its `read` member or inside its `proof` member, FAILS the replay by
 *      name: an AP result is the command's own output, so a key it does not write means the file was changed;
 *   3. a bundle ({ verdict, inputs }) that states any of the derived fields beside an AP verdict has them compared too: a field
 *      that differs DIVERGES (folder mode, POST /v1/replay with status 409, MCP replay_proof with isError), and a field that
 *      matches is checked, so it is no longer named "carried, not checked";
 *   4. the pay-application and legal commands write a bare verdict (or a bundle of verdict and inputs): every field a person reads
 *      is inside the verdict and compared. Guards, from the same round's readers.
 * A genuine file replays exactly as before (exit 0, the same JSON and lines).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type CliIO } from '../src/cli'
import { route } from '../src/http/router'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { replayBundles } from '../src/protocol/replay-case'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'r10')
const fx = (name: string): string => join(FX, name)
/** The shipped example bill (docs/examples/ap-three-way.txt in the public tree); this copy is byte-identical to it. */
const BILL = join(HERE, 'fixtures', 'data', 'ap-three-way.txt')
afterAll(() => cleanScratch())

type J = Record<string, any>
function go(argv: string[]): { code: number; out: string; err: string; lines: string[]; json: () => J } {
  let out = '', err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err, lines: err.split('\n').filter(Boolean), json: () => JSON.parse(out) as J }
}
const read = (f: string): J => JSON.parse(readFileSync(f, 'utf8')) as J
const put = (dir: string, name: string, x: unknown): string => { const f = join(dir, name); writeFileSync(f, `${JSON.stringify(x, null, 2)}\n`); return f }
const diffOf = (r: { json: () => J }, field: string): J | undefined => (r.json().ap_result?.differences as J[] | undefined)?.find(d => d.field === field)

describe('the fixtures are the files the round wrote', () => {
  it('ap1.json was read from the shipped example bill, and the forged file differs from it only beside the verdict', () => {
    const ap1 = read(fx('data/ap1.json')), forged = read(fx('data/ap1-forged.json'))
    expect(createHash('sha256').update(readFileSync(BILL, 'utf8')).digest('hex')).toBe(ap1.read.text_sha256)
    expect(JSON.stringify(forged.verdict)).toBe(JSON.stringify(ap1.verdict))
    expect(JSON.stringify(forged.read)).toBe(JSON.stringify(ap1.read))
    expect([ap1.decision, forged.decision]).toEqual(['hold_quantity', 'approve'])
  })
})

describe('1. the emailed-bill path: the maintainer\'s reproduction (fixtures/r10/data/ap1-forged.json)', () => {
  it('the genuine result replays VERIFIED, exit 0, and carries no ap_result block', () => {
    const r = go(['replay', fx('data/ap1.json'), '--source', BILL])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^verify replay: outcome VERIFIED: /)
    expect(r.json()).not.toHaveProperty('ap_result')
    expect(r.json().status).toBe('REPERFORMED')
    expect(go(['replay', fx('data/ap1.json'), '--source', BILL, '--strict']).code).toBe(0)
  })
  for (const strict of [false, true]) {
    it(`the forged result FAILS, exit 1, naming decision: stated approve, re-derived hold_quantity${strict ? ' (--strict)' : ''}`, () => {
      const r = go(['replay', fx('data/ap1-forged.json'), '--source', BILL, ...(strict ? ['--strict'] : [])])
      expect(r.code).toBe(1)
      expect(r.lines[0]).toMatch(/^verify replay: FAILED: /)
      expect(r.lines[0]).toContain('decision, payable, reasons, not_checked')
      expect(r.err).toContain('decision: the file states "approve"; the verdict, re-performed, derives "hold_quantity"')
      expect(r.err).toContain('payable: the file states true; the verdict, re-performed, derives false')
      expect(r.err).not.toContain('outcome VERIFIED')
      const j = r.json()
      expect(j.status).toBe('FAILED')
      expect(j.ok).toBe(false)
      expect(j.ap_result.ok).toBe(false)
      expect(diffOf(r, 'decision')).toEqual({ field: 'decision', stated: 'approve', rederived: 'hold_quantity' })
      expect(diffOf(r, 'payable')).toEqual({ field: 'payable', stated: true, rederived: false })
      expect(diffOf(r, 'reasons')?.stated).toEqual(['all checks passed'])
      expect(diffOf(r, 'not_checked')?.stated).toEqual([])
      expect(diffOf(r, 'grounding')).toBeUndefined() // the forger left grounding alone, and it matches
    })
  }
  it('each derived field alone: changed, or deleted, fails by its name', () => {
    const d = scratch('ap-derived-one-')
    const ap1 = read(fx('data/ap1.json'))
    const cases: [string, (x: J) => void][] = [
      ['decision', x => { x.decision = 'hold_price' }],
      ['payable', x => { x.payable = null }],
      ['grounding', x => { x.grounding.expected = 10 }],
      ['reasons', x => { x.reasons[0] = 'Machine grease cartridge 14 oz: billed 10, received 10.' }],
      ['not_checked', x => { x.not_checked.pop() }],
      ['reasons', x => { delete x.reasons }],
    ]
    cases.forEach(([field, edit], i) => {
      const x = structuredClone(ap1)
      edit(x)
      const r = go(['replay', put(d, `one-${i}.json`, x), '--source', BILL])
      expect(r.code, `${field} #${i}`).toBe(1)
      expect(r.lines[0], `${field} #${i}`).toMatch(new RegExp(`^verify replay: FAILED: .*\\b${field}\\b`))
      expect(diffOf(r, field), `${field} #${i}`).toBeDefined()
    })
    // a deleted field is named as absent
    const gone = structuredClone(ap1); delete gone.reasons
    const r = go(['replay', put(d, 'gone.json', gone), '--source', BILL])
    expect(r.err).toContain('reasons: absent from the file; the verdict, re-performed, derives [')
    expect(diffOf(r, 'reasons')).not.toHaveProperty('stated')
  })
  it('the stated --allow-open choice is re-derived too: exit and allow_open', () => {
    const d = scratch('ap-derived-choice-')
    const made = go(['ap', BILL, '--allow-open'])
    const out = JSON.parse(made.out) as J
    expect(out.exit).toBe(1)
    expect(out.allow_open).toBe('stated, not applied')
    expect(go(['replay', put(d, 'choice.json', out), '--source', BILL]).code).toBe(0)
    const exit0 = go(['replay', put(d, 'exit0.json', { ...out, exit: 0 }), '--source', BILL])
    expect(exit0.code).toBe(1)
    expect(exit0.err).toContain('exit: the file states 0; the verdict, re-performed, derives 1')
    const applied = go(['replay', put(d, 'applied.json', { ...out, allow_open: 'stated' }), '--source', BILL])
    expect(applied.code).toBe(1)
    expect(diffOf(applied, 'allow_open')).toEqual({ field: 'allow_open', stated: 'stated', rederived: 'stated, not applied' })
    const { allow_open: _a, ...noChoice } = out
    const half = go(['replay', put(d, 'half.json', noChoice), '--source', BILL])
    expect(half.code).toBe(1)
    expect(half.err).toContain('allow_open: absent from the file; the verdict, re-performed, derives "stated, not applied"')
  })
})

describe('1. the structured path: the reader\'s own files (fixtures/r10/E-forged.json)', () => {
  it('the genuine output replays VERIFIED, exit 0, and carries no ap_result block', () => {
    const r = go(['replay', fx('E-dup-exact.out.json'), '--strict'])
    expect(r.code).toBe(0)
    expect(r.json()).not.toHaveProperty('ap_result')
  })
  for (const strict of [false, true]) {
    it(`the forged output FAILS, exit 1, naming decision: stated approve, re-derived hold_duplicate${strict ? ' (--strict)' : ''}`, () => {
      const r = go(['replay', fx('E-forged.json'), ...(strict ? ['--strict'] : [])])
      expect(r.code).toBe(1)
      expect(r.lines[0]).toMatch(/^verify replay: FAILED: .*decision, payable, reasons/)
      expect(r.err).toContain('decision: the file states "approve"; the verdict, re-performed, derives "hold_duplicate"')
      expect(diffOf(r, 'decision')).toEqual({ field: 'decision', stated: 'approve', rederived: 'hold_duplicate' })
      expect(diffOf(r, 'not_checked')).toBeUndefined() // [] in both
    })
  }
  it('with its top-level verdict deleted (the proof member is what replays), the fields are still re-derived', () => {
    const d = scratch('ap-derived-noverdict-')
    const { verdict: _v, ...rest } = read(fx('E-forged.json'))
    const r = go(['replay', put(d, 'nov.json', rest)])
    expect(r.code).toBe(1)
    expect(diffOf(r, 'decision')?.rederived).toBe('hold_duplicate')
  })
})

describe('2. a key `verify ap` never writes fails the replay by name (it is the command\'s own output)', () => {
  it('approved: true beside the emailed-bill result: exit 1, named, with or without --strict', () => {
    const d = scratch('ap-unknown-')
    const f = put(d, 'approved.json', { ...read(fx('data/ap1.json')), approved: true })
    for (const strict of [[], ['--strict']]) {
      const r = go(['replay', f, '--source', BILL, ...strict])
      expect(r.code).toBe(1)
      expect(r.lines[0]).toMatch(/^verify replay: FAILED: .*\bapproved\b/)
      expect(r.err).toContain('approved: the file states true; `ap` never writes this key')
      expect(diffOf(r, 'approved')).toEqual({ field: 'approved', stated: true, never_written: true })
      expect(r.err).not.toContain('carried, not checked')
    }
  })
  it('a key inside read, or inside the structured output\'s proof member, is named by its path', () => {
    const d = scratch('ap-unknown-path-')
    const ap1 = read(fx('data/ap1.json'))
    const inRead = go(['replay', put(d, 'read.json', { ...ap1, read: { ...ap1.read, reviewed_by: 'CFO' } }), '--source', BILL])
    expect(inRead.code).toBe(1)
    expect(diffOf(inRead, 'read.reviewed_by')).toEqual({ field: 'read.reviewed_by', stated: 'CFO', never_written: true })
    const e = read(fx('E-dup-exact.out.json'))
    const inProof = go(['replay', put(d, 'proof.json', { ...e, proof: { ...e.proof, approved: true } })])
    expect(inProof.code).toBe(1)
    expect(diffOf(inProof, 'proof.approved')).toBeDefined()
  })
  it('without the files the result was read from, nothing is re-performed: the key is named as carried, exit 3, as before', () => {
    const d = scratch('ap-unknown-nofiles-')
    const r = go(['replay', put(d, 'approved.json', { ...read(fx('data/ap1.json')), approved: true })])
    expect(r.code).toBe(3)
    expect(r.err).toContain('carried, not checked: approved, read (')
  })
})

describe('3. a bundle that states the derived fields beside an AP verdict has them compared', () => {
  const e = (): J => read(fx('E-dup-exact.out.json'))
  const bundleOf = (o: J, extra: J = {}): J => ({ verdict: o.proof.verdict, inputs: o.proof.inputs, ...extra })
  it('folder mode: a forged decision DIVERGES at decision; a true one MATCHes and is not named as carried', () => {
    const d = scratch('ap-bundle-')
    mkdirSync(join(d, 'f'))
    put(join(d, 'f'), 'forged.json', bundleOf(e(), { decision: 'approve', payable: true }))
    put(join(d, 'f'), 'true.json', bundleOf(e(), { decision: 'hold_duplicate', payable: false }))
    const r = go(['replay', join(d, 'f')])
    expect(r.code).toBe(1)
    const cases = r.json().cases as J[]
    const forged = cases.find(c => c.name === 'forged.json')!, truth = cases.find(c => c.name === 'true.json')!
    expect(forged.result).toBe('DIVERGED')
    expect(forged.first_difference).toBe('decision')
    expect(forged.reason).toContain('decision: the file states "approve"; the verdict, re-performed, derives "hold_duplicate"')
    expect(forged.reason).toContain('payable: the file states true; the verdict, re-performed, derives false')
    expect(truth.result).toBe('MATCH')
    expect(r.json().carried_not_checked ?? {}).not.toHaveProperty('true.json')
    expect(r.json().carried_not_checked ?? {}).not.toHaveProperty('forged.json')
  })
  it('a bundle whose verdict is not an AP verdict: decision is a key its format does not define, refused by default (422; 2026-10-19), carried, not checked, when allowed', () => {
    const legal = read(fx('legal-bundle1.json'))
    const res = route({ method: 'POST', path: '/v1/replay', body: { bundle: { ...legal, decision: 'approve' } } })
    expect(res.status).toBe(422)
    expect((res.json as J).summary.cases[0]).toMatchObject({ result: 'REFUSED', unknown_keys: ['decision'] })
    const allowed = replayBundles([{ name: 'bundle', bundle: { ...legal, decision: 'approve' } }], { allowUnknownKeys: true })
    expect(allowed.carried_not_checked).toEqual({ bundle: ['decision'] })
  })
  it('POST /v1/replay: the forged bundle is 409, x-verify-exit 1, the case DIVERGED at decision', () => {
    const res = route({ method: 'POST', path: '/v1/replay', body: { bundle: bundleOf(e(), { decision: 'approve' }) } })
    expect(res.status).toBe(409)
    expect(res.headers?.['x-verify-exit']).toBe('1')
    const j = res.json as J
    expect(j.summary.diverged).toBe(1)
    expect(j.summary.cases[0].first_difference).toBe('decision')
    expect(j.lines[0]).toContain('diverges at `decision`')
  })
  it('MCP replay_proof: the forged bundle is an error result, DIVERGED at decision', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'replay_proof', arguments: { bundle: bundleOf(e(), { decision: 'approve' }) } } } as JsonRpcRequest)!.result as { isError: boolean; structuredContent: J }
    expect(res.isError).toBe(true)
    expect(res.structuredContent.summary.cases[0].first_difference).toBe('decision')
  })
  it('one file: the same bundle FAILS at decision, exit 1, with or without --strict', () => {
    const d = scratch('ap-bundle-one-')
    const f = put(d, 'b.json', bundleOf(e(), { decision: 'approve' }))
    for (const strict of [[], ['--strict']]) {
      const r = go(['replay', f, ...strict])
      expect(r.code).toBe(1)
      expect(r.err).toContain('decision: the file states "approve"; the verdict, re-performed, derives "hold_duplicate"')
    }
    const ok = go(['replay', put(d, 'ok.json', bundleOf(e(), { decision: 'hold_duplicate' })), '--strict'])
    expect(ok.code).toBe(0)
    expect(ok.err).not.toContain('carried, not checked')
  })
})

describe('4. guards: the pay-application and legal commands carry no field outside the verdict', () => {
  it('pay-app: the reader\'s FAIL replays VERIFIED; with gate_status and outcome rewritten to PASS it FAILS at outcome', () => {
    const d = scratch('ap-guard-payapp-')
    const flags = ['--extraction', fx('payapp-P4.json'), '--ruleset', 'pay-app', '--history', join(HERE, '..', 'docs', 'examples', 'payapp-g702-g703.previous.json')]
    const v = read(fx('payapp-P4.verdict.json'))
    expect(Object.keys(v)).not.toContain('decision') // a bare verdict: nothing beside it
    expect(go(['replay', fx('payapp-P4.verdict.json'), ...flags]).code).toBe(0)
    const r = go(['replay', put(d, 'pass.json', { ...v, outcome: 'PASS', gate_status: 'PASS' }), ...flags])
    expect(r.code).toBe(1)
    expect(r.err).toContain('at `outcome`')
  })
  it('legal: the reader\'s own tampered bundle (outcome and gate_status FAIL to PASS) FAILS; the genuine one replays', () => {
    expect(Object.keys(read(fx('legal-bundle1.json')))).toEqual(['verdict', 'inputs'])
    expect(go(['replay', fx('legal-bundle1.json')]).code).toBe(0)
    const r = go(['replay', fx('legal-bundle-tamper-headline.json')])
    expect(r.code).toBe(1)
    expect(r.err).toContain('at `outcome`')
  })
})
