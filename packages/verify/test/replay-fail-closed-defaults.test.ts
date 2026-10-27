/**
 * Fail closed by default (2026-10-19): three defaults a cold reader in an engineer's role found open the same day, ruled that
 * evening (a reader trusts nothing it did not re-derive, so a person decides what was not checked):
 *
 *   (a) a key a bundle or a signed envelope does not define is REFUSED by a replay (exit 3), named. It used to be named "carried,
 *       not checked" with the exit unchanged, failing only under --strict. `--allow-unknown-keys` keeps that reading, and the
 *       replay says it was given. `id` and `note` at a bundle's top level stay the two allowed caller keys, and the AP gate's
 *       fields beside an AP verdict whose inputs the gate reads stay compared, not refused.
 *   (b) a member an annotation's declared shape does not have (`action_context.approved`; the reader added
 *       `action_context: { approved: true, amount: "1894.92" }`) is REFUSED by a replay (exit 3), named. The annotation itself is
 *       still not compared, and a member of its declared shape still replays as before.
 *   (c) --allow-open (and `allow_open: true` over HTTP and MCP) gives exit 0 only when every check that could not run could not
 *       for want of a reference (REFERENCE_NOT_PROVIDED) or a field the document does not carry (FIELD_MISSING), and no
 *       load-bearing field is struck. An amount wrong by 100 behind one unreadable character ("1600.0O") exited 0 under it.
 *
 * Fixtures: fixtures/r10-defaults/data (the engineer's files, byte for byte; README there) and fixtures/core-cold-review-2026-10-12
 * (the earlier reader's bundle and envelope with a key beside the verdict).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type CliIO } from '../src/cli'
import { route } from '../src/http/router'
import { handleRequest } from '../src/mcp/server'
import { replayBundle, replayBundles } from '../src/protocol/replay-case'
import { verifyReplay } from '../src/protocol/replay'
import { verdictExit, exitHeaders } from '../src/verdict/exit'
import { verify } from '../src/verify'
import type { Verdict } from '../src/verdict/schema'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const R10 = join(HERE, 'fixtures', 'r10-defaults', 'data')
const COLD = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
const r10 = (n: string): string => join(R10, n)
const cold = (n: string): string => join(COLD, n)
const read = (p: string): any => JSON.parse(readFileSync(p, 'utf8'))
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
afterAll(() => cleanScratch())

type J = Record<string, any>
function go(argv: string[]): { code: number; out: string; err: string; lines: string[]; json: () => J } {
  let out = '', err = ''
  const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
  const code = run(argv, io)
  return { code, out, err, lines: err.split('\n').filter(Boolean), json: () => JSON.parse(out) as J }
}
const put = (d: string, name: string, x: unknown): string => { const f = join(d, name); writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x, null, 2)); return f }
const bundleOf = (v: unknown): J => ({ verdict: v, inputs: { extraction: read(r10('invoice.json')), references: { contract: null, evidence: [], history: [] }, source: null } })

describe('the fixtures are the reader\'s files, byte for byte', () => {
  it('sha256 of each', () => {
    expect(Object.fromEntries(['invoice.json', 'verdict.json', 'annotation-action_context.json', 'ev-wrong.json', 'ev-wrong-garbled.json', 'ev-amount-missing.json', 'ev-total-garbled.json'].map(n => [n, sha(r10(n)).slice(0, 16)]))).toEqual({
      'invoice.json': 'cf8ca968c26a0a57', 'verdict.json': 'f7dd4ff8d13aecd8', 'annotation-action_context.json': '1e0a4fa495a7a13d',
      'ev-wrong.json': '11776ccc8ab49bb8', 'ev-wrong-garbled.json': '33d31bab04129a60', 'ev-amount-missing.json': '8c935b14d18dfe3c', 'ev-total-garbled.json': '5fa29a38dbf73054',
    })
    expect(read(r10('annotation-action_context.json')).action_context).toEqual({ approved: true, amount: '1894.92' })
  })
})

// ── (a) keys a bundle or an envelope does not define ────────────────────────────────────────────────────────────────────
describe('(a) a key a bundle or envelope does not define is refused by default (exit 3), named', () => {
  it('one bundle (b-extra-top.json): exit 3, the key named on the first line and in the JSON; nothing re-performed', () => {
    const r = go(['replay', cold('b-extra-top.json')])
    expect(r.code).toBe(3)
    expect(r.lines[0]).toMatch(/^verify replay: input refused: the bundle carries a key its format does not define: extra \(/)
    expect(r.lines[0]).toContain('--allow-unknown-keys')
    expect(r.json()).toMatchObject({ status: 'REFUSED', refused: true, unknown_keys: ['extra'] })
    expect(r.err).not.toContain('VERIFIED')
  })
  it('--allow-unknown-keys keeps the old reading (exit 0, carried, not checked) and says it was given', () => {
    const r = go(['replay', cold('b-extra-top.json'), '--allow-unknown-keys'])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^verify replay: outcome VERIFIED: /)
    expect(r.lines[1]).toMatch(/^verify replay: carried, not checked: extra \(/)
    expect(r.lines[2]).toMatch(/^verify replay: --allow-unknown-keys was given: /)
    expect(r.json()).toMatchObject({ carried_not_checked: ['extra'], allow_unknown_keys: 'stated' })
    const strict = go(['replay', cold('b-extra-top.json'), '--allow-unknown-keys', '--strict'])
    expect(strict.code).toBe(1)
    expect(strict.err).toContain('outside keys under --strict: extra')
  })
  it('--strict alone: the refusal comes first (exit 3), as every refusal before hashing does', () => {
    expect(go(['replay', cold('b-extra-top.json'), '--strict']).code).toBe(3)
  })
  it('a signed envelope with a key beside its four members (env-extra-top-pinA.json): exit 3, named; the flag keeps the old reading', () => {
    const pinA = ['--extraction', cold('invoice.json'), '--trusted-key', cold('a.pub.pem')]
    const r = go(['replay', cold('env-extra-top-pinA.json'), ...pinA])
    expect(r.code).toBe(3)
    expect(r.lines[0]).toMatch(/^verify replay: input refused: the signed envelope carries a key its format does not define: issued_note \(/)
    const ok = go(['replay', cold('env-extra-top-pinA.json'), ...pinA, '--allow-unknown-keys'])
    expect(ok.code).toBe(0)
    expect(ok.lines[0]).toContain('by the trusted key')
    expect(ok.json().carried_not_checked).toEqual(['issued_note'])
    expect(go(['replay', cold('env-pinA.json'), ...pinA, '--strict']).code).toBe(0) // the genuine envelope, as before
  })
  it('a folder: the case is REFUSED with the key named, exit 3; with the flag it MATCHes and the summary says the flag was given', () => {
    const r = go(['replay', cold('folder')])
    expect(r.code).toBe(3)
    expect(r.json().cases[0]).toMatchObject({ name: 'b-extra-top.json', result: 'REFUSED', unknown_keys: ['extra'] })
    expect(r.err).toMatch(/REFUSED +b-extra-top\.json[^\n]*\n {4}the bundle carries a key its format does not define: extra \(/)
    expect(r.json()).not.toHaveProperty('carried_not_checked')
    const ok = go(['replay', cold('folder'), '--allow-unknown-keys'])
    expect(ok.code).toBe(0)
    expect(ok.json()).toMatchObject({ matched: 1, carried_not_checked: { 'b-extra-top.json': ['extra'] }, allow_unknown_keys: 'stated' })
    expect(ok.err).toContain('verify replay: --allow-unknown-keys was given: ')
  })
  it('the library: replayBundle refuses by default and reads as before with allowUnknownKeys', () => {
    const b = read(cold('b-extra-top.json'))
    expect(replayBundle(b, 'b')).toMatchObject({ result: 'REFUSED', unknown_keys: ['extra'] })
    expect(replayBundle(b, 'b', { allowUnknownKeys: true }).result).toBe('MATCH')
    const s = replayBundles([{ name: 'b', bundle: b }], { allowUnknownKeys: true })
    expect([s.matched, s.carried_not_checked, s.allow_unknown_keys]).toEqual([1, { b: ['extra'] }, 'stated'])
    expect(replayBundles([{ name: 'b', bundle: b }])).not.toHaveProperty('allow_unknown_keys')
  })
  it('POST /v1/replay: 422 with x-verify-exit 3, the case REFUSED and named (the route has no flag: it fails closed)', () => {
    const res = route({ method: 'POST', path: '/v1/replay', body: { bundle: read(cold('b-extra-top.json')) } })
    expect([res.status, res.headers?.['x-verify-exit']]).toEqual([422, '3'])
    expect((res.json as J).summary.cases[0]).toMatchObject({ result: 'REFUSED', unknown_keys: ['extra'] })
    expect((res.json as J).lines[0]).toContain('a key its format does not define: extra')
  })
  it('id and note at a bundle\'s top level are still allowed; a third key beside them is refused, named alone', () => {
    const d = scratch('fcd-allowed-')
    const legal = (read(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json')).bundles as J[]).find(b => b.id === 'legal-0.0.1')!
    const plain = go(['replay', put(d, 'legal.json', legal)])
    expect(plain.code).toBe(0)
    expect(plain.json().carried_allowed).toEqual(['id', 'note'])
    const third = go(['replay', put(d, 'legal-3.json', { ...legal, approved_by: 'CFO' })])
    expect(third.code).toBe(3)
    expect(third.json().unknown_keys).toEqual(['approved_by'])
  })
  it('an options key the replay does not read, and an envelope\'s extra key inside a bundle, are refused by their paths', () => {
    const d = scratch('fcd-paths-')
    const b = read(cold('b-extra-top.json')); delete b.extra
    expect(go(['replay', put(d, 'genuine.json', b), '--strict']).code).toBe(0)
    expect(go(['replay', put(d, 'opt.json', { ...b, options: { note: 'approved' } })]).json().unknown_keys).toEqual(['options.note'])
    const env = read(cold('env-extra-top-pinA.json'))
    const inputs = { extraction: read(cold('invoice.json')), references: { contract: null, evidence: [], history: [] }, source: null }
    mkdirSync(join(d, 'f'))
    put(join(d, 'f'), 'b.json', { verdict: env, inputs })
    const r = go(['replay', join(d, 'f'), '--trusted-key', cold('a.pub.pem')])
    expect(r.code).toBe(3)
    expect(r.json().cases[0].unknown_keys).toEqual(['verdict.issued_note'])
  })
  it('the AP gate\'s fields beside an AP verdict are compared, not refused: a forged decision in a bundle DIVERGES (exit 1)', () => {
    const out = read(join(HERE, 'fixtures', 'r10', 'E-dup-exact.out.json'))
    const c = replayBundle({ ...out.proof, decision: 'approve', payable: true }, 'ap')
    expect(c).toMatchObject({ result: 'DIVERGED', first_difference: 'decision' })
  })
})

// ── (b) members an annotation's declared shape does not have ──────────────────────────────────────────────────────────────
describe('(b) an annotation member its declared shape does not have is refused (exit 3), named', () => {
  const ex = ['--extraction', r10('invoice.json')]
  it('the reader\'s file, action_context: { approved: true, amount: "1894.92" }: exit 3, both members named, with or without --strict', () => {
    const r = go(['replay', r10('annotation-action_context.json'), ...ex])
    expect(r.code).toBe(3)
    expect(r.lines[0]).toMatch(/^verify replay: input refused: the verdict's action_context carries members its declared shape \{ tool_name, call_id, argument_path \} does not have: action_context\.approved, action_context\.amount/)
    expect(go(['replay', r10('annotation-action_context.json'), ...ex, '--strict']).code).toBe(3)
    expect(go(['replay', r10('annotation-action_context.json'), ...ex, '--allow-unknown-keys']).code).toBe(3) // the flag reaches bundle and envelope keys only
  })
  it('the genuine verdict replays VERIFIED (exit 0); a declared-shape action_context is named, not compared, and fails --strict, as before', () => {
    expect(go(['replay', r10('verdict.json'), ...ex]).code).toBe(0)
    const d = scratch('fcd-ac-')
    const v = read(r10('verdict.json'))
    const f = put(d, 'ac.json', { ...v, action_context: { tool_name: 'pay_invoice', call_id: 'c-1', argument_path: '$.amount' } })
    const r = go(['replay', f, ...ex])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toContain('Not re-performed (not the engine\'s output): action_context.')
    expect(go(['replay', f, ...ex, '--strict']).code).toBe(1)
  })
  it('every annotation with a declared object shape: ledger (and its reviewer), declared_accuracy, case', () => {
    const v = read(r10('verdict.json')) as Verdict
    const refused = (x: unknown) => verifyReplay(x as Verdict, bundleOf(v).inputs)
    const cases: [unknown, string][] = [
      [{ ...v, case: { ruling: 'CLEARED for payment' } }, 'case.ruling'],
      [{ ...v, ledger: { tenant_id: 'acme', retention_until: '2033-01-01T00:00:00.000Z', approved: true } }, 'ledger.approved'],
      [{ ...v, ledger: { tenant_id: 'acme', retention_until: '2033-01-01T00:00:00.000Z', reviewer: { id: 'r', decided_at: '2026-10-19T00:00:00.000Z', decision: 'UPHELD', signed_off: true } } }, 'ledger.reviewer.signed_off'],
      [{ ...v, declared_accuracy: { domain: 'invoice', ruleset_version: '0.1.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: 'x', audited_by: 'Big Four' } }, 'declared_accuracy.audited_by'],
    ]
    for (const [x, member] of cases) {
      const r = refused(x)
      expect(r.status, member).toBe('REFUSED')
      expect(r.reason, member).toContain(member)
    }
    // the shapes the engine's own writers produce replay as before (the book's ledger, arbitration's case link, a measured accuracy)
    const lawful: unknown[] = [
      { ...v, case: { case_id: 'c', prior_verdict_id: 'p', move_id: 'm' } },
      { ...v, ledger: { tenant_id: 'acme', retention_until: '2033-01-01T00:00:00.000Z', reviewer: { id: 'r', decided_at: '2026-10-19T00:00:00.000Z', decision: 'UPHELD', note: 'n' } } },
      { ...v, declared_accuracy: { domain: 'invoice', ruleset_version: '0.1.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: 'x' } },
      { ...v, channel: 'VERDICT' },
    ]
    for (const x of lawful) expect(refused(x).status).toBe('REPERFORMED')
  })
  it('in a bundle: REFUSED in a folder, and 422 over POST /v1/replay', () => {
    const b = bundleOf(read(r10('annotation-action_context.json')))
    expect(replayBundle(b, 'b')).toMatchObject({ result: 'REFUSED' })
    expect(replayBundle(b, 'b').reason).toContain('action_context.approved')
    const res = route({ method: 'POST', path: '/v1/replay', body: { bundle: b } })
    expect([res.status, res.headers?.['x-verify-exit']]).toEqual([422, '3'])
  })
})

// ── (c) --allow-open narrowed ────────────────────────────────────────────────────────────────────────────────────────────
describe('(c) --allow-open accepts only checks that could not run for want of a reference or a field the document does not carry', () => {
  const three: [string, string][] = [['ev-wrong-garbled.json', 'UNPARSEABLE'], ['ev-amount-missing.json', 'AMBIGUOUS_FIELD'], ['ev-total-garbled.json', 'UNPARSEABLE']]
  it.each(three)('the reader\'s %s: exit 2 under --allow-open (it was 0), the blocking checks named with their reason; the verdict is the same', (name, reason) => {
    const plain = go(['check', r10(name)])
    const a = go(['check', r10(name), '--allow-open'])
    expect(plain.code).toBe(2)
    expect(a.code).toBe(2)
    expect(a.lines[1]).toMatch(/^ {2}exit 2: fails closed: every check that ran held, but \d+ check\(s\) could not run: .*; --allow-open does not apply: it accepts only checks that could not run for want of a reference \(REFERENCE_NOT_PROVIDED\) or of a field the document does not carry \(FIELD_MISSING\), and /)
    expect(a.lines[1]).toContain(`(${reason})`)
    expect({ ...a.json(), issued_at: 0 }).toEqual({ ...plain.json(), issued_at: 0 })
  })
  it('the amount wrong by 100 with every character readable FAILs (exit 1), with or without --allow-open', () => {
    expect(go(['check', r10('ev-wrong.json')]).code).toBe(1)
    expect(go(['check', r10('ev-wrong.json'), '--allow-open']).code).toBe(1)
  })
  it('the door example (references not given, dates and prior ids absent): exit 0 under --allow-open, as before', () => {
    const a = go(['check', r10('invoice.json'), '--allow-open'])
    expect(a.code).toBe(0)
    expect(a.lines[1]).toMatch(/^ {2}exit 0 by --allow-open, the caller's stated choice: /)
  })
  it('one reading for every entry point: verdictExit, the HTTP headers and the MCP line', () => {
    const v = verify(read(r10('ev-wrong-garbled.json')))
    const e = verdictExit(v, true)
    expect(e.exit).toBe(2)
    expect(e.allow_open).toBeUndefined()
    expect(e.allow_open_refused?.map(c => c.claim_id)).toEqual(['document.SUM_INT', 'line[0].MATH_INT'])
    expect(exitHeaders(e)).toEqual({ 'x-verify-gate': 'PASS-WITH-OPEN', 'x-verify-exit': '2' })
    const http = route({ method: 'POST', path: '/v1/verify', body: { extraction: read(r10('ev-wrong-garbled.json')), allow_open: true } })
    expect(http.headers).toMatchObject({ 'x-verify-exit': '2' })
    expect(http.headers).not.toHaveProperty('x-verify-allow-open')
    const mcp = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_document', arguments: { extraction: read(r10('ev-wrong-garbled.json')), allow_open: true } } })!
    expect((mcp.result as { content: { text: string }[] }).content[0]!.text).toMatch(/^gate: PASS-WITH-OPEN · exit 2 \(do not act on it as passed\): .*allow-open does not apply/)
    const door = verdictExit(verify(read(r10('invoice.json'))), true)
    expect([door.exit, door.allow_open]).toEqual([0, true])
  })
  it('a struck load-bearing field (OPEN), or an open check with no stated reason, is never accepted', () => {
    const struck = { outcome: 'PASS', claims: [], struck: [{ field: 'total' }], would_unlock: [{ claims: ['document.TOTAL_INT'] }] } as unknown as Verdict
    expect(verdictExit(struck, true).exit).toBe(2)
    const unstated = { outcome: 'PASS', claims: [{ claim_id: 'x', outcome: 'INSUFFICIENT_DATA', tier: 'DETERMINISTIC' }] } as unknown as Verdict
    expect(verdictExit(unstated, true).exit).toBe(2)
    const refOnly = { outcome: 'PASS', claims: [{ claim_id: 'x', outcome: 'INSUFFICIENT_DATA', tier: 'DETERMINISTIC', insufficiency: { reason: 'REFERENCE_NOT_PROVIDED', detail: '' } }] } as unknown as Verdict
    expect(verdictExit(refOnly, true)).toMatchObject({ exit: 0, allow_open: true })
  })
})
