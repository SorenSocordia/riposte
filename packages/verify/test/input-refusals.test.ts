/**
 * Library refusals, not throws (2026-09-28).
 *   - verifyReplay(<not a verdict>) answers { ok: false, refused: true, reason } instead of throwing from inside the
 *     derivation; every verdict-shaped input gets the identical result it got before (held to the derivation itself).
 *   - assertExtraction(x) (src/protocol/input.ts) refuses, with a typed InputRefused, exactly what verify() cannot bind a
 *     verdict to: null / undefined (verify() crashed on both) and non-JSON values (whose hashes collide). Every JSON value
 *     passes, so the one line at the top of verify() changes nothing for any of them.
 *   - the CLI: `verify <null>` and `verify replay <not a verdict>` exit 3 with the reason (they used to reach run()'s net).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import {
  verify, verifyReplay, verifyAction, deriveVerdictId, hashOf, generateSigningKeypair, signVerdict, verifyEnvelope,
  type Verdict,
} from '../src/index'
import { replayInputProblem } from '../src/protocol/replay'
import { assertExtraction, extractionProblem, InputRefused } from '../src/protocol/input'
import { run, type CliIO } from '../src/cli'
import { clean, broken, FIXED_NOW } from './fixtures/invoices'

const JUNK: unknown[] = [null, undefined, [], 5, 'x', true, {}, { input_hash: 'a' }, { input_hash: 'a', ruleset: null }, { input_hash: 5, ruleset: { id: 'r', version: '1' }, engine_version: 'e', verdict_id: 'v' }, { input_hash: 'a', ruleset: { id: 'r', version: 1 }, engine_version: 'e', verdict_id: 'v' }]

describe('verifyReplay: a refusal for what is not a verdict, never a throw', () => {
  it('garbage is refused with a reason; nothing is derived, nothing verifies', () => {
    for (const j of JUNK) {
      let r: ReturnType<typeof verifyReplay> | undefined
      expect(() => { r = verifyReplay(j as Verdict) }, JSON.stringify(j)).not.toThrow()
      expect(r, JSON.stringify(j)).toMatchObject({ ok: false, id_ok: false, expected_verdict_id: '', refused: true })
      expect(r!.reason).toMatch(/^not a verdict: /)
      expect(verifyReplay(j as Verdict, { any: 'inputs' })).toMatchObject({ ok: false, refused: true })
    }
    expect(replayInputProblem(null)).toBe('not a verdict: null, not a verdict object')
    expect(replayInputProblem([])).toBe('not a verdict: an array, not a verdict object')
    expect(replayInputProblem({ input_hash: 'a' })).toBe('not a verdict: verdict_id, ruleset {id, version}, engine_version are missing or not a string, so no verdict_id can be derived')
  })

  it('every verdict-shaped input: the same answer as the derivation itself (valid, altered id, wrong inputs)', () => {
    const v = verify(clean, { now: FIXED_NOW })
    const derive = (x: Verdict): string => deriveVerdictId(x.input_hash, x.ruleset, x.engine_version, x.remedy_table_hash)
    // 2026-09-28: without inputs the binding is all that is checked, and the result says so (outcome NOT re-performed)
    expect(verifyReplay(v)).toEqual({
      ok: true, id_ok: true, expected_verdict_id: derive(v), outcome_verified: false, status: 'STRUCTURE_ONLY',
      not_reperformed: 'structure verified; outcome NOT re-performed: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)',
    })
    const altered = { ...v, verdict_id: '0'.repeat(32) }
    expect(verifyReplay(altered)).toEqual({ ok: false, id_ok: false, expected_verdict_id: derive(v), outcome_verified: false, status: 'FAILED', reason: `verdict_id does not derive from input_hash + ruleset@version + engine_version${v.remedy_table_hash !== undefined ? ' + remedy_table_hash' : ''} (expected ${derive(v)})` })
    const wrong = verifyReplay(v, { not: 'these' })
    // 2026-10-05: both hashes, labelled recorded (the verdict's) and computed (from the inputs given)
    expect(wrong).toEqual({ ok: false, id_ok: true, input_ok: false, expected_verdict_id: derive(v), expected_input_hash: hashOf({ not: 'these' }), recorded_input_hash: v.input_hash, computed_input_hash: hashOf({ not: 'these' }), outcome_verified: false, status: 'FAILED', reason: `input_hash does not match the supplied inputs: recorded ${v.input_hash}, computed ${hashOf({ not: 'these' })} — this verdict is not for these inputs` })
    expect(verifyReplay(v).refused).toBeUndefined()
    // another verdict family (verify_action), re-bound to its own inputs and re-performed
    const action = { tool: 'wire', arguments: { to: '9' } }, sources = { allowed: { to: ['9'] } }
    const a = verifyAction(action, sources, { now: FIXED_NOW })
    expect(verifyReplay(a, { action, sources })).toEqual({
      ok: true, id_ok: true, input_ok: true, expected_verdict_id: derive(a), expected_input_hash: a.input_hash, outcome_verified: true, status: 'REPERFORMED',
      reperformed: { engine: 'action', identical: true },
    })
  })

  it('inputs that cannot be canonicalized (a cycle): the binding does not verify, and nothing throws', () => {
    const v = verify(clean, { now: FIXED_NOW })
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    const r = verifyReplay(v, cyclic)
    expect(r).toMatchObject({ ok: false, id_ok: true, input_ok: false })
    expect(r.reason).toMatch(/cannot be canonicalized/)
  })

  it('a signed envelope around a non-verdict: verifyEnvelope says why, where it used to throw', () => {
    const { privateKeyPem } = generateSigningKeypair()
    const env = signVerdict({ hello: 'world' } as unknown as Verdict, privateKeyPem)
    const check = verifyEnvelope(env, { some: 'inputs' })
    expect(check).toMatchObject({ ok: false, signature_ok: true, replay: { refused: true } })
    expect(check.reason).toMatch(/^not a verdict: /)
  })
})

describe('assertExtraction: the one refusal verify() needs', () => {
  it('refuses null, undefined and non-JSON values with a typed InputRefused', () => {
    const refused: [unknown, RegExp][] = [
      [null, /the extraction is null: there is no document to verify/],
      [undefined, /the extraction is missing \(undefined\)/],
      [() => 1, /the extraction is a function, not JSON data/],
      [Symbol('s'), /the extraction is a symbol, not JSON data/],
      [5n, /the extraction is a bigint, not JSON data/],
    ]
    for (const [x, why] of refused) {
      let err: unknown
      try { assertExtraction(x) } catch (e) { err = e }
      expect(err, String(why)).toBeInstanceOf(InputRefused)
      expect(err).toBeInstanceOf(TypeError)
      expect((err as InputRefused).input).toBe('extraction')
      expect((err as InputRefused).name).toBe('InputRefused')
      expect((err as Error).message).toMatch(/^verify: /)
      expect((err as Error).message).toMatch(why)
      expect(extractionProblem(x)).toBeDefined()
    }
    // why the non-JSON cases: their hashes collide (a function and a symbol are the same input to the binding)
    expect(hashOf({ extraction: () => 1 })).toBe(hashOf({ extraction: Symbol('s') }))
    expect(hashOf({ extraction: 5n })).toBe(hashOf({ extraction: '5' }))
  })

  it('every JSON value passes; verify() answers each of these without throwing (the line at its top changes nothing for them)', () => {
    // Not in this list: `line_items` with 2+ entries where one is null. That is JSON, so it passes assertExtraction, and
    // verify() throws on it inside the kernel (src/binding/ontological-bridge.ts, measured 2026-09-28; finding F-BF1,
    // reported to the kernel's owner rather than masked here).
    const json: unknown[] = [{}, [], 5, 'x', true, false, 0, '', { line_items: 5 }, { line_items: null }, { line_items: [null] }, { line_items: [5, 'x'] }, { total: {} }, clean, broken, { nested: { deep: [1, { a: null }] } }]
    for (const x of json) {
      expect(() => assertExtraction(x), JSON.stringify(x)).not.toThrow()
      expect(extractionProblem(x)).toBeUndefined()
      const v = verify(x as never, { now: FIXED_NOW })
      expect(['PASS', 'FAIL', 'INSUFFICIENT_DATA']).toContain(v.outcome)
    }
  })

  it('what verify() does with null today (the throw assertExtraction replaces, once wired)', () => {
    // Measured 2026-09-28: a raw TypeError from inside a ruleset. With `assertExtraction(extraction)` at the top of verify()
    // this becomes InputRefused; either way it throws, so this test holds before and after the wiring.
    expect(() => verify(null as never)).toThrow()
  })
})

describe('the CLI: input refusals exit 3 with the reason', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  const cap = (): CliIO & { out_: () => string; err_: () => string } => {
    let o = '', e = ''
    return { out: s => { o += s }, err: s => { e += s }, out_: () => o, err_: () => e }
  }
  const file = (content: string): string => {
    const d = mkdtempSync(join(tmpdir(), 'verify-input-refusals-'))
    dirs.push(d)
    const p = join(d, 'x.json')
    writeFileSync(p, content)
    return p
  }

  it('verify <null> → 3 "input refused"; verify replay <not a verdict> → 3 with the refusal as JSON', () => {
    const io = cap()
    expect(run([file('null')], io)).toBe(3)
    expect(io.err_()).toMatch(/^verify: input refused: the extraction is null/)
    expect(io.err_()).not.toMatch(/internal error/)
    for (const junk of ['null', '[]', '5', '"x"', '{}']) {
      const r = cap()
      expect(run(['replay', file(junk)], r)).toBe(3)
      expect(JSON.parse(r.out_())).toMatchObject({ ok: false, refused: true })
      expect(r.err_()).toMatch(/^verify replay: input refused: not a verdict: /)
    }
  })

  it('a real verdict still replays: exit 2 without inputs (structure only), 0 re-performed; an altered one: exit 1', () => {
    const v = verify(clean, { now: FIXED_NOW })
    expect(run(['replay', file(JSON.stringify(v))], cap())).toBe(2)
    expect(run(['replay', file(JSON.stringify(v)), '--extraction', file(JSON.stringify(clean))], cap())).toBe(0)
    const io = cap()
    expect(run(['replay', file(JSON.stringify({ ...v, verdict_id: '0'.repeat(32) }))], io)).toBe(1)
    expect(JSON.parse(io.out_()).refused).toBeUndefined()
  })
})
