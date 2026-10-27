/**
 * The order a replay says things in, and which exit a folder gives (2026-10-13; the mutation corpus's findings and a cold
 * reader's, 2026-10-12).
 *   1. A pinned key matched by the older fingerprint form: the first line says "by the trusted key", the note comes second.
 *   2. A verdict that fails two ways (remedies deleted and its outcome flipped) is named by the replay's own order: refusals
 *      before hashing, then the binding, then the outcome, then the remedies. Here the outcome comes first.
 *   3. A folder (or .jsonl) holding both a refused case and a diverged one exits 3: a case that cannot be read is never hidden
 *      by a sibling's exit 1. HTTP /v1/replay says the same in x-verify-exit.
 *   4. A number that cannot be represented exactly, met in a replay: the advice is the one that is true for a replay (re-issue
 *      the verdict; a replay of the existing verdict cannot change its input), never "write amounts as strings".
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type CliIO } from '../src/cli'
import { route } from '../src/http/router'
import { generateSigningKeypair, signVerdict, legacyKeyFingerprint, type Verdict } from '../src/index'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
const N18 = join(HERE, 'replay-n18')
afterAll(() => cleanScratch())

type J = Record<string, any>
function go(argv: string[]): { code: number; out: string; err: string; lines: string[]; json: () => J } {
  let out = '', err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err, lines: err.split('\n').filter(Boolean), json: () => JSON.parse(out) as J }
}

describe('1. "by the trusted key" first, the older-fingerprint note second', () => {
  const kp = generateSigningKeypair()
  const verdict = JSON.parse(readFileSync(join(FX, 'verdict.json'), 'utf8')) as Verdict
  const older = legacyKeyFingerprint(kp.publicKeyPem)!
  it('one verdict', () => {
    const d = scratch('order-key-')
    const f = join(d, 'env.json')
    writeFileSync(f, JSON.stringify(signVerdict(verdict, kp.privateKeyPem)))
    const r = go(['replay', f, '--extraction', join(FX, 'invoice.json'), '--trusted-key', older])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^verify replay: outcome VERIFIED: .*by the trusted key/)
    expect(r.lines[1]).toMatch(/^verify replay: note: --trusted-key matched this key by the older fingerprint form/)
  })
  it('a folder: the case line first, the note after the case lines', () => {
    const d = scratch('order-key-folder-')
    mkdirSync(join(d, 'f'))
    const inputs = { extraction: JSON.parse(readFileSync(join(FX, 'invoice.json'), 'utf8')), references: { contract: null, evidence: [], history: [] }, source: null }
    writeFileSync(join(d, 'f', 'b.json'), JSON.stringify({ verdict: signVerdict(verdict, kp.privateKeyPem), inputs }))
    const r = go(['replay', join(d, 'f'), '--trusted-key', older])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^MATCH +b\.json/)
    const note = r.lines.findIndex(l => l.includes('older fingerprint form'))
    expect(note).toBeGreaterThan(0)
    expect(r.lines.at(-1)).toMatch(/^verify replay: 1 case\(s\): 1 match/)
  })
})

describe('2. two failures in one verdict: the outcome is named before the deleted remedies', () => {
  it('invoice-builtin-garbled-tax with its remedies deleted and its outcome flipped', () => {
    const F = JSON.parse(readFileSync(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json'), 'utf8')) as { bundles: J[] }
    const b = structuredClone(F.bundles.find(x => x.id === 'invoice-builtin-garbled-tax')!)
    delete b.verdict.remedies
    b.verdict.outcome = b.verdict.outcome === 'PASS' ? 'FAIL' : 'PASS'
    const d = scratch('order-two-')
    const f = join(d, 'two.json')
    writeFileSync(f, JSON.stringify({ verdict: b.verdict, inputs: b.inputs }))
    for (const extra of [[], ['--strict'], ['--lenient-remedies']]) {
      const r = go(['replay', f, ...extra])
      expect(r.code, extra.join(' ')).toBe(1)
      expect(r.lines[0], extra.join(' ')).toContain('differs from the presented one at `outcome`')
    }
  })
})

describe('3. a folder with a refused case and a diverged one exits 3', () => {
  it('a folder: one diverged bundle (the reader\'s b-outcome-flip.json) and one file that is not JSON', () => {
    const d = scratch('prec-')
    writeFileSync(join(d, 'a-flip.json'), readFileSync(join(FX, 'b-outcome-flip.json')))
    writeFileSync(join(d, 'b-broken.json'), '{"verdict":')
    const r = go(['replay', d])
    expect(r.json()).toMatchObject({ diverged: 1, refused: 1 })
    expect(r.code).toBe(3)
  })
  it('a .jsonl: a diverged line and a refused line', () => {
    const d = scratch('prec-jsonl-')
    const f = join(d, 'cases.jsonl')
    writeFileSync(f, `${JSON.stringify(JSON.parse(readFileSync(join(FX, 'b-outcome-flip.json'), 'utf8')))}\nnot json\n`)
    expect(go(['replay', f]).code).toBe(3)
  })
  it('a diverged case alone still exits 1, a refused one alone 3', () => {
    const d = scratch('prec-alone-')
    mkdirSync(join(d, 'one')); mkdirSync(join(d, 'two'))
    writeFileSync(join(d, 'one', 'a.json'), readFileSync(join(FX, 'b-outcome-flip.json')))
    writeFileSync(join(d, 'two', 'a.json'), '42')
    expect(go(['replay', join(d, 'one')]).code).toBe(1)
    expect(go(['replay', join(d, 'two')]).code).toBe(3)
  })
  it('POST /v1/replay: x-verify-exit 3 for the same pair, 1 for the diverged bundle alone', () => {
    const flip = JSON.parse(readFileSync(join(FX, 'b-outcome-flip.json'), 'utf8')) as J
    expect(route({ method: 'POST', path: '/v1/replay', body: { bundles: [flip, 42] } }).headers?.['x-verify-exit']).toBe('3')
    expect(route({ method: 'POST', path: '/v1/replay', body: { bundles: [flip] } }).headers?.['x-verify-exit']).toBe('1')
  })
})

describe('4. a number that cannot be represented exactly, met in a replay', () => {
  const REPLAY_WORDS = 're-issue the verdict with the amount as a string; a replay of the existing verdict cannot change its input'
  it('one verdict: exit 3, the replay\'s advice, not "write amounts as strings"', () => {
    const r = go(['replay', join(N18, 'peppol-N18.json'), '--extraction', join(FX, 'x23-inexact-payable.json'), '--ruleset', 'peppol-en16931@0.2.0', '--source', join(N18, 'peppol-N18.txt')])
    expect(r.code).toBe(3)
    expect(r.err).toContain('$.payable_amount (9007199254740993) is a number that cannot be represented exactly')
    expect(r.err).toContain(REPLAY_WORDS)
    expect(r.err).not.toContain('write amounts as strings')
  })
  it('a folder: the refused case carries the replay\'s advice', () => {
    const d = scratch('inexact-folder-')
    writeFileSync(join(d, 'b.json'), '{"verdict":{"verdict_id":"x"},"inputs":{"amount":9007199254740993}}')
    const r = go(['replay', d])
    expect(r.code).toBe(3)
    expect(r.err).toContain(REPLAY_WORDS)
    expect(r.err).not.toContain('write amounts as strings')
  })
  it('outside a replay the advice stays: check still says write amounts as strings', () => {
    const r = go(['check', join(FX, 'x23-inexact-payable.json'), '--ruleset', 'peppol-en16931@0.2.0'])
    expect(r.code).toBe(3)
    expect(r.err).toContain('write amounts as strings with two decimals')
  })
})
