/**
 * Keys outside the verdict body (2026-10-13; a cold reader's finding, first filed on 2026-10-06 and filed again on 2026-10-12).
 * A key beside `verdict` and `inputs` in a bundle, or beside `verdict`, `alg`, `public_key` and `signature` in a signed envelope,
 * replayed VERIFIED with exit 0 under --strict, in folder mode, with --trusted-key and over POST /v1/replay, and nothing named it.
 *
 * Now every replay names such keys on the line under its first ("carried, not checked: <keys>"), the JSON lists them, and
 * --strict refuses them (exit 1, "outside keys under --strict: <keys>"). The fixtures are the reader's own files, copied byte for
 * byte (fixtures/core-cold-review-2026-10-12/README.md).
 *
 * 2026-10-19 (fail closed by default; test/replay-fail-closed-defaults.test.ts): such a key is now REFUSED by default (exit 3),
 * named, before anything is hashed. The reading this file pins is the one `--allow-unknown-keys` keeps, so each case below runs
 * with that flag and first checks the default refusal. `id` and `note`, and the output of `ap`, are unchanged.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type CliIO } from '../src/cli'
import { route } from '../src/http/router'
import { replayBundles } from '../src/protocol/replay-case'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
const fx = (name: string): string => join(FX, name)
afterAll(() => cleanScratch())

type J = Record<string, any>
function go(argv: string[]): { code: number; out: string; err: string; lines: string[]; json: () => J } {
  let out = '', err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err, lines: err.split('\n').filter(Boolean), json: () => JSON.parse(out) as J }
}

describe('a bundle with a key beside verdict and inputs (the reader\'s b-extra-top.json)', () => {
  it('one file: refused by default (exit 3); with --allow-unknown-keys exit 0, the line under the VERIFIED line names the key, and the JSON lists it', () => {
    const refused = go(['replay', fx('b-extra-top.json')])
    expect(refused.code).toBe(3)
    expect(refused.json().unknown_keys).toEqual(['extra'])
    const r = go(['replay', fx('b-extra-top.json'), '--allow-unknown-keys'])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^verify replay: outcome VERIFIED: /)
    expect(r.lines[1]).toMatch(/^verify replay: carried, not checked: extra \(/)
    expect(r.json().carried_not_checked).toEqual(['extra'])
  })
  it('--strict: exit 1, "outside keys under --strict: extra", in the strict block and the JSON', () => {
    expect(go(['replay', fx('b-extra-top.json'), '--strict']).code).toBe(3) // the refusal comes first
    const r = go(['replay', fx('b-extra-top.json'), '--strict', '--allow-unknown-keys'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('outside keys under --strict: extra')
    expect(r.json().strict.ok).toBe(false)
    expect(r.json().strict.problems.some((p: string) => p.startsWith('outside keys under --strict: extra'))).toBe(true)
  })
  it('a folder: the key is named under the case line and in the summary; --strict fails the case', () => {
    const refused = go(['replay', fx('folder')])
    expect(refused.code).toBe(3)
    expect(refused.json().cases[0]).toMatchObject({ result: 'REFUSED', unknown_keys: ['extra'] })
    const plain = go(['replay', fx('folder'), '--allow-unknown-keys'])
    expect(plain.code).toBe(0)
    expect(plain.err).toMatch(/MATCH +b-extra-top\.json[^\n]*\n(?: {4}[^\n]*\n)*? {4}carried, not checked: extra \(/)
    expect(plain.json().carried_not_checked).toEqual({ 'b-extra-top.json': ['extra'] })
    expect(plain.json().cases[0]).not.toHaveProperty('carried_not_checked') // each case reads as before
    const strict = go(['replay', fx('folder'), '--strict', '--allow-unknown-keys'])
    expect(strict.code).toBe(1)
    expect(strict.err).toContain('STRICT: outside keys under --strict: extra')
    expect(strict.json().strict_failed).toBe(1)
  })
  it('POST /v1/replay: the case is refused, the key named in it and on its line (422; the route has no flag), and the library\'s allowUnknownKeys keeps the old reading', () => {
    const bundle = JSON.parse(readFileSync(fx('b-extra-top.json'), 'utf8')) as J
    const res = route({ method: 'POST', path: '/v1/replay', body: { bundle } })
    expect(res.status).toBe(422)
    const j = res.json as J
    expect(j.summary.refused).toBe(1)
    expect(j.summary.cases[0].unknown_keys).toEqual(['extra'])
    expect(j.lines[0]).toContain('a key its format does not define: extra')
    const allowed = replayBundles([{ name: 'bundle', bundle }], { allowUnknownKeys: true })
    expect([allowed.matched, allowed.carried_not_checked]).toEqual([1, { bundle: ['extra'] }])
  })
  it('the same bundle without the key names nothing and passes --strict (exit 0)', () => {
    const d = scratch('carried-')
    const b = JSON.parse(readFileSync(fx('b-extra-top.json'), 'utf8')) as J
    delete b.extra
    const f = join(d, 'ct04.json')
    writeFileSync(f, JSON.stringify(b))
    const r = go(['replay', f, '--strict'])
    expect(r.code).toBe(0)
    expect(r.err).not.toContain('carried, not checked')
    expect(r.json()).not.toHaveProperty('carried_not_checked')
  })
  it('options: a key it does not read is named (options.note); an empty options object names nothing', () => {
    const d = scratch('carried-opt-')
    const b = JSON.parse(readFileSync(fx('b-extra-top.json'), 'utf8')) as J
    delete b.extra
    writeFileSync(join(d, 'with-note.json'), JSON.stringify({ ...b, options: { note: 'approved' } }))
    writeFileSync(join(d, 'empty.json'), JSON.stringify({ ...b, options: {} }))
    expect(go(['replay', join(d, 'with-note.json')]).json().unknown_keys).toEqual(['options.note'])
    expect(go(['replay', join(d, 'with-note.json'), '--allow-unknown-keys']).json().carried_not_checked).toEqual(['options.note'])
    const empty = go(['replay', join(d, 'empty.json'), '--strict'])
    expect(empty.code).toBe(0)
    expect(empty.err).not.toContain('carried, not checked')
  })
})

describe('a signed envelope with a key beside verdict (the reader\'s env-extra-top-pinA.json)', () => {
  const pinA = ['--extraction', fx('invoice.json'), '--trusted-key', fx('a.pub.pem')]
  it('--trusted-key: refused by default (exit 3); with --allow-unknown-keys exit 0, "by the trusted key" on the first line, the key named on the next', () => {
    expect(go(['replay', fx('env-extra-top-pinA.json'), ...pinA]).code).toBe(3)
    const r = go(['replay', fx('env-extra-top-pinA.json'), ...pinA, '--allow-unknown-keys'])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toContain('by the trusted key')
    expect(r.lines[1]).toMatch(/^verify replay: carried, not checked: issued_note \(/)
    expect(r.json().carried_not_checked).toEqual(['issued_note'])
  })
  it('--strict --trusted-key: exit 1, the key refused by name', () => {
    expect(go(['replay', fx('env-extra-top-pinA.json'), ...pinA, '--strict']).code).toBe(3)
    const r = go(['replay', fx('env-extra-top-pinA.json'), ...pinA, '--strict', '--allow-unknown-keys'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('outside keys under --strict: issued_note')
  })
  it('the genuine envelope names nothing and passes --strict --trusted-key (exit 0)', () => {
    const r = go(['replay', fx('env-pinA.json'), ...pinA, '--strict'])
    expect(r.code).toBe(0)
    expect(r.err).not.toContain('carried, not checked')
  })
  it('an envelope inside a bundle: its extra key is named by its path (verdict.issued_note)', () => {
    const d = scratch('carried-env-')
    const env = JSON.parse(readFileSync(fx('env-extra-top-pinA.json'), 'utf8')) as J
    const inputs = { extraction: JSON.parse(readFileSync(fx('invoice.json'), 'utf8')), references: { contract: null, evidence: [], history: [] }, source: null }
    mkdirSync(join(d, 'f'))
    writeFileSync(join(d, 'f', 'b.json'), JSON.stringify({ verdict: env, inputs }))
    expect(go(['replay', join(d, 'f'), '--trusted-key', fx('a.pub.pem')]).json().cases[0].unknown_keys).toEqual(['verdict.issued_note'])
    const r = go(['replay', join(d, 'f'), '--trusted-key', fx('a.pub.pem'), '--allow-unknown-keys'])
    expect(r.code).toBe(0)
    expect(r.json().carried_not_checked).toEqual({ 'b.json': ['verdict.issued_note'] })
  })
})

describe('the two allowed caller keys: id and note at a bundle\'s top level (the engine 0.0.1 pack carries both)', () => {
  const F = JSON.parse(readFileSync(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json'), 'utf8')) as { bundles: J[] }
  const legal = (): J => structuredClone(F.bundles.find(b => b.id === 'legal-0.0.1')!)
  it('named on every replay as "carried (allowed): id, note", and --strict passes (exit 0)', () => {
    const d = scratch('carried-pack-')
    const f = join(d, 'legal.json')
    writeFileSync(f, JSON.stringify(legal()))
    const plain = go(['replay', f])
    expect(plain.code).toBe(0)
    expect(plain.lines[1]).toMatch(/^verify replay: carried \(allowed\): id, note \(/)
    expect(plain.err).not.toContain('carried, not checked')
    expect(plain.json().carried_allowed).toEqual(['id', 'note'])
    expect(plain.json()).not.toHaveProperty('carried_not_checked')
    const strict = go(['replay', f, '--strict'])
    expect(strict.code).toBe(0)
    expect(strict.json().strict.problems).toEqual([])
  })
  it('a third key beside them is named as not checked and fails --strict, which names it alone', () => {
    const d = scratch('carried-pack-third-')
    const f = join(d, 'legal.json')
    writeFileSync(f, JSON.stringify({ ...legal(), approved_by: 'CFO' }))
    const refused = go(['replay', f])
    expect(refused.code).toBe(3)
    expect(refused.json().unknown_keys).toEqual(['approved_by']) // named alone: id and note are allowed
    const plain = go(['replay', f, '--allow-unknown-keys'])
    expect(plain.code).toBe(0)
    expect(plain.err).toContain('verify replay: carried, not checked: approved_by (')
    expect(plain.err).toContain('verify replay: carried (allowed): id, note (')
    const strict = go(['replay', f, '--strict', '--allow-unknown-keys'])
    expect(strict.code).toBe(1)
    const problem = strict.json().strict.problems.find((p: string) => p.startsWith('outside keys under --strict:'))
    expect(problem).toMatch(/^outside keys under --strict: approved_by \(/)
  })
  it('a folder: the allowed keys are listed apart, and --strict passes a case that carries only them', () => {
    const d = scratch('carried-pack-folder-')
    mkdirSync(join(d, 'f'))
    writeFileSync(join(d, 'f', 'legal.json'), JSON.stringify(legal()))
    const plain = go(['replay', join(d, 'f')])
    expect(plain.json().carried_allowed).toEqual({ 'legal.json': ['id', 'note'] })
    expect(plain.err).toContain('    carried (allowed): id, note (')
    expect(go(['replay', join(d, 'f'), '--strict']).code).toBe(0)
  })
  it('only at a bundle\'s top level: a note beside a signed envelope\'s members, or inside options, is not allowed', () => {
    const d = scratch('carried-pack-env-')
    const env = JSON.parse(readFileSync(fx('env-pinA.json'), 'utf8')) as J
    writeFileSync(join(d, 'env-note.json'), JSON.stringify({ ...env, note: 'approved' }))
    expect(go(['replay', join(d, 'env-note.json'), '--extraction', fx('invoice.json'), '--trusted-key', fx('a.pub.pem')]).json().unknown_keys).toEqual(['note'])
    const r = go(['replay', join(d, 'env-note.json'), '--extraction', fx('invoice.json'), '--trusted-key', fx('a.pub.pem'), '--strict', '--allow-unknown-keys'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('carried, not checked: note (')
    writeFileSync(join(d, 'opt-note.json'), JSON.stringify({ ...legal(), options: { note: 'x' } }))
    expect(go(['replay', join(d, 'opt-note.json')]).json().unknown_keys).toEqual(['options.note'])
    expect(go(['replay', join(d, 'opt-note.json'), '--strict', '--allow-unknown-keys']).code).toBe(1)
  })
})

describe('the read member of an emailed-bill result', () => {
  const bill = join(HERE, 'fixtures', 'ap-cold-review', 'ap-clean.txt')
  it('replayed without the files it records, the refusal names read as carried, not checked; with them, read is compared and not named', () => {
    const d = scratch('carried-read-')
    const made = go(['ap', bill])
    const f = join(d, 'result.json')
    writeFileSync(f, made.out)
    expect(JSON.parse(made.out)).toHaveProperty('read')
    const without = go(['replay', f])
    expect(without.code).toBe(3)
    expect(without.err).toContain('verify replay: carried, not checked: read (')
    const withFiles = go(['replay', f, '--source', bill])
    expect(withFiles.code).toBe(0)
    expect(withFiles.err).not.toContain('carried')
  })
})

// 2026-10-19 (a cold reader, controller's role): the output of `ap` is the command's own output, so a key it never writes means the
// file was changed after it was written. Such a key used to be named "carried, not checked" with the exit unchanged; once the
// verdict re-performs it now fails the replay by name (exit 1), with or without --strict (test/replay-ap-derived-fields.test.ts).
describe('the output of `ap --input`: the members ap writes are its own; anything added fails the replay, named', () => {
  it('an added approved_by fails the replay (exit 1) by name, and none of ap\'s own members are named', () => {
    const d = scratch('carried-ap-')
    const made = go(['ap', '--input', join(HERE, 'fixtures', 'ap-cold-review', 'L1-clean-exact.json')])
    const out = JSON.parse(made.out) as J
    writeFileSync(join(d, 'ap.json'), JSON.stringify(out))
    writeFileSync(join(d, 'ap-approved.json'), JSON.stringify({ ...out, approved_by: 'CFO' }))
    const own = go(['replay', join(d, 'ap.json')])
    expect(own.code).toBe(0)
    expect(own.err).not.toContain('carried, not checked')
    const added = go(['replay', join(d, 'ap-approved.json')])
    expect(added.code).toBe(1)
    expect(added.lines[0]).toMatch(/^verify replay: FAILED: .*: approved_by \(/)
    expect(added.err).toContain('approved_by: the file states "CFO"; `ap` never writes this key')
    expect(added.err).not.toContain('carried, not checked')
    expect(added.json().ap_result.differences).toEqual([{ field: 'approved_by', stated: 'CFO', never_written: true }])
  })
})
