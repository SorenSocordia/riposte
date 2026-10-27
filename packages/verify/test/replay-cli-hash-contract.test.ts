/**
 * 2026-10-05: the replay, CLI and hash-contract findings of cold review round 1 and of a first-time user.
 *
 *   gate_status  engine 0.6.0 verdicts record PASS / PASS_WITH_OPEN / FAIL / INSUFFICIENT_DATA beside `outcome`; earlier
 *                engines' verdicts carry none and replay byte for byte; every CLI headline says the gate word.
 *   hashing      text that is not UTF-8 and JSON numbers past the double range are refused before hashing (they used to
 *                collapse to U+FFFD and to null, so different inputs shared an input_hash); canonicalize is unchanged.
 *   exceptions   the exempt set is named in folder mode as in single-file mode; deleted remedies are said; --trusted-key
 *                pins the signer; --strict fails on what was not re-performed.
 *   messages     recorded/computed hashes, line endings, --version, per-command help, one-line usage errors, folders, BOMs;
 *                the first help screen fits in 40 lines.
 *
 * Export-safe (2026-10-05): nothing outside this package is read (the AP layout is a copy under test/fixtures/data), the
 * binary's name is read from package.json (`verify` here, `riposte-verify` in the public tree), and scratch folders live in the
 * package's own tmp/vitest (test/helpers/scratch.ts), never the system temp directory. A later change the same day also made the CLI fail closed: a
 * PASS-WITH-OPEN verdict exits 2 unless --allow-open is given, and --strict reports document.producer instead of failing on it.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import {
  verify, verifyDeclarative, verifyReplay, verifyCitations, verifyInvoiceMatch, splitApLayout, signVerdict, generateSigningKeypair, replayBundles,
  recordedGateStatus, gateHeadline, notReperformedFields, invalidUtf8Offset, decodeUtf8Strict, nonFinitePath, InputRefused,
  type DeclarativeRuleset, type Verdict,
} from '../src/index'
import { canonicalize, hashOf } from '../src/verdict/canonical'
import * as inv from './fixtures/invoices'
import { scratch as packageScratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const N18 = join(HERE, 'replay-n18')
const N18_VERDICT = join(N18, 'peppol-N18.json')
const N18_EXTRACTION = join(N18, 'peppol-N18.extraction.json')
const N18_SOURCE = join(N18, 'peppol-N18.txt')
const RS_V02 = join(HERE, '..', 'docs', 'examples', 'peppol-en16931.ruleset.v0.2.json')
const RS = JSON.parse(readFileSync(RS_V02, 'utf8')) as DeclarativeRuleset
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
/** The AP layout the README's first AP command reads (a copy: the public tree ships it as docs/examples/ap-three-way.txt). */
const AP_LAYOUT = join(HERE, 'fixtures', 'data', 'ap-three-way.txt')
/** The binary this package installs as, read from its package.json: `verify` here, `riposte-verify` in the public tree. */
const BIN = Object.entries((JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { bin: Record<string, string> }).bin).find(([, v]) => v === 'dist/cli.js')![0]
afterAll(() => cleanScratch())
type J = Record<string, unknown>

function go(argv: string[]): { code: number; out: string; err: string; json: () => any } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err, json: () => JSON.parse(out) }
}
const scratch = (): string => packageScratch('replay-cli-')
const put = (dir: string, name: string, body: unknown): string => {
  const p = join(dir, name)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body))
  return p
}
const bundleOf = (extraction: J, engine?: string): { verdict: Verdict; inputs: J } => ({
  verdict: verify(extraction, { now: NOW, ...(engine ? { engine } : {}) }),
  inputs: { extraction, references: { contract: null, evidence: [], history: [] }, source: null },
})

describe('gate_status is recorded from engine 0.6.0, and every headline says it', () => {
  it('a 0.6.0 verdict records gate_status right after outcome; it is the gate reading of its claims', () => {
    for (const ex of [inv.clean, inv.broken, inv.singleLine]) {
      const v = verify(ex, { now: NOW, engine: '0.6.0' })
      expect(v.engine_version).toBe('0.6.0')
      const keys = Object.keys(v)
      expect(keys[keys.indexOf('outcome') + 1]).toBe('gate_status')
      expect(v.gate_status).toBe(recordedGateStatus(v))
    }
  })

  it('the N18 e-invoice (totals unreadable) records PASS_WITH_OPEN under 0.6.0; outcome still says PASS', () => {
    const ex = JSON.parse(readFileSync(N18_EXTRACTION, 'utf8')) as J
    const v = verifyDeclarative(ex, RS, { now: NOW, source: { text: readFileSync(N18_SOURCE, 'utf8') } })
    expect([v.outcome, v.gate_status]).toEqual(['PASS', 'PASS_WITH_OPEN'])
  })

  it('a verdict made under 0.5.0 or earlier carries no gate_status, and its bytes are what that engine gave', () => {
    for (const engine of ['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0']) {
      const v = verify(inv.broken, { now: NOW, engine })
      expect(Object.prototype.hasOwnProperty.call(v, 'gate_status'), engine).toBe(false)
    }
  })

  it('every engine that closes with attachScope records it (AP shown); a replay re-derives it and catches a doctored one', () => {
    const ap = verifyInvoiceMatch(splitApLayout(readFileSync(AP_LAYOUT, 'utf8'))!, { now: NOW })
    expect(ap.verdict.gate_status).toBe('FAIL')
    const b = bundleOf(inv.clean)
    expect(verifyReplay(b.verdict, b.inputs).status).toBe('REPERFORMED')
    const doctored = { ...b.verdict, gate_status: b.verdict.gate_status === 'PASS' ? 'FAIL' : 'PASS' } as Verdict
    expect(verifyReplay(doctored, b.inputs)).toMatchObject({ status: 'FAILED', reperformed: { first_difference: 'gate_status' } })
  })

  it('the headline: never a bare PASS when a check was open (old verdicts read the same way, recomputed)', () => {
    const v = JSON.parse(readFileSync(N18_VERDICT, 'utf8')) as Verdict // engine 0.1.0: no gate_status recorded
    expect(v.gate_status).toBeUndefined()
    expect(gateHeadline(v)).toBe('PASS-WITH-OPEN: 3 of 13 checks could not run')
    expect(gateHeadline(verify(inv.broken, { now: NOW }))).toMatch(/^FAIL: \d+ of \d+ checks failed$/)
  })

  it('the CLI says it for check, replay and ap', () => {
    const d = scratch()
    const issue = go([N18_EXTRACTION, '--ruleset', RS_V02, '--source', N18_SOURCE])
    expect(issue.code).toBe(2) // fails closed; only a clean PASS exits 0
    expect(issue.err.split('\n')[0]).toBe('verify: PASS-WITH-OPEN: 3 of 13 checks could not run')
    expect(issue.err.split('\n')[1]).toMatch(/^ {2}exit 2: fails closed: every check that ran held, but 3 check\(s\) could not run: /)
    expect(issue.json().gate_status).toBe('PASS_WITH_OPEN')
    // 2026-10-19: N18's three open checks read UNPARSEABLE (a figure there but not readable), which --allow-open no longer
    // accepts: it accepts only checks that wait on a reference or a field the document does not carry. It exited 0 here.
    const allowed = go([N18_EXTRACTION, '--ruleset', RS_V02, '--source', N18_SOURCE, '--allow-open'])
    expect(allowed.code).toBe(2)
    expect(allowed.err.split('\n')[1]).toMatch(/^ {2}exit 2: fails closed: every check that ran held, but 3 check\(s\) could not run: .*; --allow-open does not apply: .*\(UNPARSEABLE\)/)
    expect({ ...allowed.json(), issued_at: 'x' }).toEqual({ ...issue.json(), issued_at: 'x' }) // the same verdict either way
    const rep = go(['replay', N18_VERDICT, '--extraction', N18_EXTRACTION, '--ruleset', RS_V02, '--source', N18_SOURCE])
    expect(rep.err.split('\n')[1]).toBe('verify replay: PASS-WITH-OPEN: 3 of 13 checks could not run')
    const layout = put(d, 'ap.txt', readFileSync(AP_LAYOUT, 'utf8'))
    const ap = go(['ap', layout])
    expect(ap.code).toBe(1)
    expect(ap.err).toMatch(/^verify ap: HOLD \(hold_quantity\) · verdict FAIL: 1 of \d+ checks failed\n/) // then the AP decision's readable report
    expect(ap.err).toContain('Machine grease cartridge 14 oz: billed 10, received 7')
  })
})

describe('the hash contract refuses what it cannot hash faithfully', () => {
  it('invalidUtf8Offset finds the first byte the WHATWG decoder rejects', () => {
    const b = (...x: number[]): Uint8Array => Uint8Array.from(x)
    expect(invalidUtf8Offset(b(0x41, 0xff))).toBe(1)
    expect(invalidUtf8Offset(b(0x41, 0xfe))).toBe(1)
    expect(invalidUtf8Offset(b(0xef, 0xbf, 0xbd))).toBe(-1) // U+FFFD itself is valid
    expect(invalidUtf8Offset(b(0xc0, 0x80))).toBe(0) // overlong
    expect(invalidUtf8Offset(b(0x41, 0xed, 0xa0, 0x80))).toBe(1) // an encoded surrogate
    expect(invalidUtf8Offset(b(0xe2, 0x82))).toBe(0) // truncated at the end
    expect(invalidUtf8Offset(b(0xf4, 0x90, 0x80, 0x80))).toBe(0) // above U+10FFFF
    expect(invalidUtf8Offset(b(0xf0, 0x9f, 0xa6, 0x8a, 0x80))).toBe(4) // a valid 4-byte character, then a stray continuation
    expect(invalidUtf8Offset(new TextEncoder().encode('Ünïcödé € 𝄞'))).toBe(-1)
  })

  it('fuzz: invalidUtf8Offset says -1 exactly when the platform\'s fatal decoder accepts the bytes (20,000 random strings)', () => {
    const fatal = new TextDecoder('utf-8', { fatal: true })
    let seed = 12345
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed }
    for (let n = 0; n < 20000; n++) {
      const len = rnd() % 9
      const bytes = Uint8Array.from({ length: len }, () => { const r = rnd() % 4; return r === 0 ? rnd() % 0x80 : r === 1 ? 0x80 + rnd() % 0x40 : 0xc0 + rnd() % 0x40 })
      let ok = true
      try { fatal.decode(bytes) } catch { ok = false }
      expect(invalidUtf8Offset(bytes) === -1, Array.from(bytes).join(',')).toBe(ok)
    }
  })

  it('decodeUtf8Strict keeps a byte-order mark (as readFileSync did), so every valid file hashes as before', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])
    expect(decodeUtf8Strict(bytes, 'x')).toBe(Buffer.from(bytes).toString('utf8'))
    expect(() => decodeUtf8Strict(Uint8Array.from([0x41, 0x42, 0xff]), 'a.txt')).toThrow(/a\.txt is not valid UTF-8: the bytes at offset 2 \(FF\)/)
  })

  it('three source files that differ in one byte no longer share an input_hash: 0xFF and 0xFE are refused (exit 3), EF BF BD issues', () => {
    const d = scratch()
    const text = readFileSync(N18_SOURCE)
    const at = text.indexOf('Snippet1') + 7
    const variant = (byte: number[]): string => put(d, `s-${byte.join('-')}.txt`, Buffer.concat([text.subarray(0, at), Buffer.from(byte), text.subarray(at + 1)]))
    for (const bad of [[0xff], [0xfe]]) {
      const r = go([N18_EXTRACTION, '--ruleset', RS_V02, '--source', variant(bad)])
      expect(r.code).toBe(3)
      expect(r.out).toBe('')
      expect(r.err).toMatch(new RegExp(`is not valid UTF-8: the bytes at offset ${at} \\(${bad[0]!.toString(16).toUpperCase()}`))
    }
    const ok = go([N18_EXTRACTION, '--ruleset', RS_V02, '--source', variant([0xef, 0xbf, 0xbd])])
    expect(ok.code).toBe(2) // issued (PASS-WITH-OPEN, exit 2 since the fail-closed change), not refused (3)
    expect(ok.json().gate_status).toBe('PASS_WITH_OPEN')
    // and a replay with an invalid source is refused too, never VERIFIED
    expect(go(['replay', N18_VERDICT, '--extraction', N18_EXTRACTION, '--ruleset', RS_V02, '--source', variant([0xff])]).code).toBe(3)
  })

  it('an extraction holding 1e999 or -1e999 is refused before hashing, naming the key; null still issues', () => {
    const d = scratch()
    const raw = readFileSync(N18_EXTRACTION, 'utf8')
    for (const lit of ['1e999', '-1e999']) {
      const p = put(d, `x${lit}.json`, raw.replace(/"payable_amount": [0-9.]+/, `"payable_amount": ${lit}`))
      const r = go([p, '--ruleset', RS_V02, '--source', N18_SOURCE])
      expect(r.code).toBe(3)
      expect(r.err).toMatch(/the number at \$\.payable_amount is not finite/)
    }
    // null still issues a verdict (exit 2, never the refusal's 3); 2026-10-19: its open checks read UNPARSEABLE, which
    // --allow-open no longer turns into 0 (it did)
    expect(go([put(d, 'xnull.json', raw.replace(/"payable_amount": [0-9.]+/, '"payable_amount": null')), '--ruleset', RS_V02, '--source', N18_SOURCE, '--allow-open']).code).toBe(2)
  })

  it('the library refuses a non-finite number under 0.6.0 (InputRefused), and reads it as before under 0.5.0', () => {
    const ex = { ...(JSON.parse(readFileSync(N18_EXTRACTION, 'utf8')) as J), payable_amount: Infinity }
    expect(nonFinitePath(ex)).toBe('$.payable_amount')
    expect(nonFinitePath({ lines: [{ a: 1 }, { 'b c': -Infinity }] })).toBe('$.lines[1]["b c"]')
    expect(() => verifyDeclarative(ex, RS, { now: NOW })).toThrow(InputRefused)
    expect(verifyDeclarative(ex, RS, { now: NOW, engine: '0.5.0' }).engine_version).toBe('0.5.0')
  })

  it('canonicalize is unchanged: integer-like keys first, ascending, then the rest in code-unit order (docs/REPLAY.md)', () => {
    expect(canonicalize({ b: 1, 10: 2, 9: 3, a: { z: 1, 2: 0 } })).toBe('{"9":3,"10":2,"a":{"2":0,"z":1},"b":1}')
    expect(canonicalize({ '01': 1, '1': 2, '-1': 3, '4294967295': 4, '4294967294': 5, B: 6, a: 7 })).toBe('{"1":2,"4294967294":5,"-1":3,"01":1,"4294967295":4,"B":6,"a":7}')
    expect(hashOf({ x: 6125.0 })).toBe(hashOf({ x: 6125 })) // numbers as parsed doubles
  })

  it('a JSON file that starts with a byte-order mark is refused with that sentence, single and folder', () => {
    const d = scratch()
    const b = bundleOf(inv.clean)
    const p = put(d, 'bom/b.json', `﻿${JSON.stringify(b)}`)
    const one = go(['replay', p])
    expect(one.code).toBe(3)
    expect(one.err).toMatch(/file starts with a UTF-8 byte-order mark; remove it/)
    const folder = go(['replay', dirname(p)])
    expect(folder.code).toBe(3)
    expect(folder.json().cases[0]).toMatchObject({ result: 'REFUSED', reason: expect.stringMatching(/^file starts with a UTF-8 byte-order mark; remove it/) })
  })
})

describe('what a replay does not re-perform is named, pinned or failed', () => {
  // 2026-10-19: the annotation is a case link in its declared shape ({ case_id, prior_verdict_id, move_id }). It was
  // `case: { ruling: 'CLEARED for payment' }`, a member the shape does not declare, which a replay now refuses (exit 3; the test below).
  const caseLink = (v: Verdict): J => ({ case_id: 'case-1', prior_verdict_id: v.verdict_id, move_id: 'move-1' })
  const annotated = (): { verdict: Verdict; inputs: J } => {
    const b = bundleOf(inv.clean, '0.5.0')
    return { ...b, verdict: { ...b.verdict, case: caseLink(b.verdict), document: { ...b.verdict.document, producer: 'Big Four' } } as Verdict }
  }

  it('an annotation member its declared shape does not have (case.ruling, "CLEARED for payment") is refused, exit 3, single and folder (2026-10-19)', () => {
    const d = scratch()
    const b = bundleOf(inv.clean, '0.5.0')
    const ruled = { ...b, verdict: { ...b.verdict, case: { ruling: 'CLEARED for payment' } } as Verdict }
    const one = go(['replay', put(d, 'ruled.json', ruled)])
    expect(one.code).toBe(3)
    expect(one.err.split('\n')[0]).toMatch(/^verify replay: input refused: the verdict's case carries a member its declared shape \{ case_id, prior_verdict_id, move_id \} does not have: case\.ruling/)
    put(d, 'rf/ruled.json', ruled)
    const folder = go(['replay', join(d, 'rf')])
    expect(folder.code).toBe(3)
    expect(folder.json().cases[0]).toMatchObject({ result: 'REFUSED', reason: expect.stringContaining('case.ruling') })
  })

  it('folder mode prints, per case, the fields a single replay names; the case JSON is unchanged (the drift bank digests it)', () => {
    const d = scratch()
    const b = annotated()
    put(d, 'f/a.json', b)
    const r = go(['replay', join(d, 'f')])
    expect(r.code).toBe(0)
    expect(r.err).toContain('    not re-performed (not the engine\'s output): case, document.producer')
    expect(notReperformedFields(b.verdict)).toEqual(['case', 'document.producer'])
    const s = r.json()
    expect(s.fields_not_reperformed).toEqual({ 'a.json': ['case', 'document.producer'] })
    expect(Object.keys(s.cases[0]).sort()).toEqual(['answer', 'checks', 'engine', 'name', 'remedies', 'result', 'unchecked', 'verdict_id'].filter(k => k in s.cases[0]).sort())
    expect(s.cases[0].strict_problems).toBeUndefined()
    const single = go(['replay', join(d, 'f', 'a.json')])
    expect(single.err.split('\n')[0]).toContain('Not re-performed (not the engine\'s output): case, document.producer.')
  })

  it('deleted remedies are refused by default (2026-10-05), single and folder; --lenient-remedies reads them as "remedies absent; re-derived"', () => {
    const d = scratch()
    const b = bundleOf(inv.broken, '0.1.0') // an engine that did not bind its remedies
    const { remedies: _r, ...bare } = b.verdict
    const p = put(d, 'nr/b.json', { verdict: bare, inputs: b.inputs })
    const folder = go(['replay', dirname(p)])
    expect(folder.code).toBe(1)
    expect(folder.json().cases[0]).toMatchObject({ result: 'DIVERGED', first_difference: 'remedies' })
    expect(folder.err).toContain('diverges at `remedies`: the verdict carries no remedies; the engine re-derives')
    const single = go(['replay', p])
    expect(single.code).toBe(1)
    expect(single.err.split('\n')[0]).toMatch(/^verify replay: FAILED: the verdict carries no remedies; the engine re-derives \d+ remed(y|ies) for it \(engine 0\.1\.0\); a replayed verdict must carry what it said/)
    // the stated opt-out, for a verdict issued before remedies existed
    const lenient = go(['replay', dirname(p), '--lenient-remedies'])
    expect(lenient.code).toBe(0)
    expect(lenient.err).toContain('remedies absent; re-derived')
    expect(lenient.json().cases[0].remedies_not_carried).toBe(true)
    const one = go(['replay', p, '--lenient-remedies'])
    expect(one.code).toBe(0)
    expect(one.err).toContain('remedies absent; re-derived')
    expect(go(['replay', p, '--lenient-remedies', '--strict']).code).toBe(1)
    expect(go(['replay', p, '--strict']).code).toBe(1)
  })

  it('--trusted-key: the trusted signer passes; another key or no signature FAILS (single and folder)', () => {
    const d = scratch()
    const mine = generateSigningKeypair(), theirs = generateSigningKeypair()
    const b = bundleOf(inv.clean)
    const pub = put(d, 'mine.pub.pem', mine.publicKeyPem)
    const good = put(d, 'good.json', { verdict: signVerdict(b.verdict, mine.privateKeyPem), inputs: b.inputs })
    const bad = put(d, 'bad.json', { verdict: signVerdict({ ...b.verdict, case: caseLink(b.verdict) } as Verdict, theirs.privateKeyPem), inputs: b.inputs })
    const unsigned = put(d, 'unsigned.json', b)
    expect(go(['replay', good, '--trusted-key', pub]).code).toBe(0)
    const r = go(['replay', bad, '--trusted-key', pub])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/FAILED: the envelope is signed by key [0-9a-f]{12}…, which is not the trusted key/)
    expect(go(['replay', bad]).code).toBe(0) // without the pin, a valid self-signed envelope still verifies (and says so)
    expect(go(['replay', unsigned, '--trusted-key', pub]).err).toMatch(/the verdict is not signed, and --trusted-key requires/)
    const f = join(d, 'folder')
    put(f, 'good.json', JSON.parse(readFileSync(good, 'utf8')))
    put(f, 'bad.json', JSON.parse(readFileSync(bad, 'utf8')))
    const fr = go(['replay', f, '--trusted-key', pub])
    expect(fr.code).toBe(1)
    expect(fr.json().cases.map((c: J) => [c.name, c.result, c.first_difference])).toEqual([['bad.json', 'DIVERGED', 'signature'], ['good.json', 'MATCH', undefined]])
    expect(go(['replay', good, '--trusted-key', put(d, 'priv2.pem', mine.privateKeyPem)]).err).toMatch(/holds a PRIVATE key/)
  })

  it('--strict: an unpinned envelope or an annotation fails it (exit 1); a producer is reported, not failed; a pinned, clean verdict passes', () => {
    const d = scratch()
    const k = generateSigningKeypair()
    const b = bundleOf(inv.clean)
    const pub = put(d, 'k.pub.pem', k.publicKeyPem)
    const env = put(d, 'env.json', { verdict: signVerdict(b.verdict, k.privateKeyPem), inputs: b.inputs })
    expect(go(['replay', env, '--strict']).code).toBe(1) // not pinned
    expect(go(['replay', env, '--strict', '--trusted-key', pub]).code).toBe(0)
    const ann = put(d, 'ann.json', annotated())
    const r = go(['replay', ann, '--strict'])
    expect(r.code).toBe(1)
    expect(r.json().strict).toMatchObject({ ok: false, problems: ['not re-performed (not the engine\'s output): case'] })
    expect(r.json().strict.notes[0]).toMatch(/^document\.producer "Big Four" is the issuer's label: compared as carried/)
    const s = replayBundles([{ name: 'x', bundle: annotated() }], { strict: true })
    expect([s.strict_failed, s.cases[0]!.strict_problems]).toEqual([1, ['not re-performed (not the engine\'s output): case']])
  })
})

describe('messages a stranger can act on', () => {
  it('a hash refusal says recorded and computed, names the input, and mentions line endings for page text', () => {
    const d = scratch()
    const crlf = put(d, 'crlf.txt', readFileSync(N18_SOURCE, 'utf8').replace(/\n/g, '\r\n'))
    const r = go(['replay', N18_VERDICT, '--extraction', N18_EXTRACTION, '--ruleset', RS_V02, '--source', crlf])
    expect(r.code).toBe(1)
    const lines = r.err.split('\n')
    expect(lines[0]).toBe('verify replay: FAILED: input_hash does not match the supplied inputs: this verdict is not for these inputs')
    expect(lines[1]).toMatch(/^ {2}recorded [0-9a-f]{64} \(in the verdict\)$/)
    expect(lines[2]).toMatch(/^ {2}computed [0-9a-f]{64} \(from the inputs given here\)$/)
    expect(r.err).toContain('check its line endings (CRLF or LF), a trailing newline and a byte-order mark')
    const j = r.json()
    expect(j.recorded_input_hash).toBe((JSON.parse(readFileSync(N18_VERDICT, 'utf8')) as Verdict).input_hash)
    expect(j.computed_input_hash).toBe(j.expected_input_hash)
  })

  it('a legal verdict replayed on a changed quotation names the citations; on a changed opinion, the sources', () => {
    const sources = { Carlisle: 'The opinion holds that the arbitration clause is unenforceable because it was procured by fraud.' }
    const citations = [{ id: '1', case_name: 'Carlisle', quote: 'the arbitration clause is unenforceable' }]
    const v = verifyCitations(citations, sources, { now: NOW, engine: '0.5.0' })
    expect(verifyReplay(v, { citations, sources }).status).toBe('REPERFORMED')
    const quote = verifyReplay(v, { citations: [{ ...citations[0]!, quote: 'the arbitration clause is enforceable' }], sources })
    expect(quote.reason).toMatch(/^input_hash does not match the supplied inputs: recorded [0-9a-f]{64}, computed [0-9a-f]{64} — this verdict is not for these inputs: the citations are not what it was issued on/)
    const opinion = verifyReplay(v, { citations, sources: { Carlisle: `${sources.Carlisle} ` } })
    expect(opinion.reason).toContain('the citations agree with the verdict\'s document.extraction_hash, so the difference is in what the verdict does not record: the opinion sources')
  })

  it('--version prints the version and exits 0; the first screen is 40 lines or fewer and leads with ap, check, replay', () => {
    const v = go(['--version'])
    expect([v.code, v.out]).toEqual([0, `${BIN} 0.7.2 (engine 0.7.2; replays verdicts of engines 0.0.1, 0.1.0, 0.2.0, 0.3.0, 0.4.0, 0.5.0, 0.6.0, 0.7.0, 0.7.1, 0.7.2)\n`])
    const h = go(['--help'])
    expect(h.code).toBe(0)
    const lines = h.err.trimEnd().split('\n')
    expect(lines.length).toBeLessThanOrEqual(40)
    const first = (s: string): number => lines.findIndex(l => l.startsWith(s))
    expect(first(`${BIN} ap `)).toBeGreaterThan(0)
    expect(first(`${BIN} ap `)).toBeLessThan(first(`${BIN} check `))
    expect(first(`${BIN} check `)).toBeLessThan(first(`${BIN} replay `))
    expect(h.err).toMatch(/exit 0 approve · 1 hold · 2 abstain/)
    expect(h.err).toMatch(/exit 0 verified · 1 failed/)
    expect(h.err).toContain(`${BIN} <command> --help`)
    expect(go([]).err).toBe(h.err) // no arguments: the same screen (exit 3)
  })

  it('per-command help is that command only; the reference carries no internal dialect', () => {
    const r = go(['replay', '--help'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('--trusted-key')
    expect(r.err).not.toContain(`${BIN} ap `)
    expect(r.err.split('\n').length).toBeLessThan(45)
    const a = go(['ap', '--help'])
    expect(a.err.startsWith(`${BIN} ap `)).toBe(true)
    expect(a.err.split('\n').length).toBeLessThan(15)
    expect(go(['--help', 'replay']).err).toBe(r.err)
    const all = go(['--help', 'all']).err
    for (const word of ['Salle', 'court', 'CREDENCE', 'the door', 'not to become 3']) expect(all, word).not.toContain(word)
    expect(all).toContain('GLOSSARY')
  })

  it('an unknown option is one line with its nearest flag, then a one-line pointer; --name=value reads as --name value', () => {
    const r = go(['replay', N18_VERDICT, '--extraction', N18_EXTRACTION, '--rulset', RS_V02])
    expect(r.code).toBe(3)
    expect(r.err).toBe(`verify replay: unknown option(s) --rulset (did you mean --ruleset?)\nsee: ${BIN} replay --help\n`)
    const c = go([N18_EXTRACTION, '--rulset', RS_V02])
    expect(c.code).toBe(3) // it used to check the document under the DEFAULT ruleset, silently
    expect(c.err).toBe(`verify: unknown option(s) --rulset (did you mean --ruleset?)\nsee: ${BIN} check --help\n`)
    expect(go(['replay', N18_VERDICT, `--extraction=${N18_EXTRACTION}`, `--ruleset=${RS_V02}`, `--source=${N18_SOURCE}`]).code).toBe(0)
  })

  it('a folder without the replay verb, and a folder holding a bare verdict, an extraction and a sub-folder, say what to type', () => {
    const d = scratch()
    put(d, 'pack/peppol-N18.json', readFileSync(N18_VERDICT, 'utf8'))
    put(d, 'pack/peppol-N18.extraction.json', readFileSync(N18_EXTRACTION, 'utf8'))
    put(d, 'pack/legal/x.json', bundleOf(inv.clean))
    const pack = join(d, 'pack')
    const noVerb = go([pack])
    expect(noVerb.code).toBe(3)
    expect(noVerb.err).toBe(`verify: ${pack} is a folder, not an extraction.\ndid you mean: ${BIN} replay ${pack}\n`)
    const r = go(['replay', pack])
    expect(r.code).toBe(3)
    expect(r.err).toContain(`this is a verdict without its inputs, not a bundle. Replay it on its own: ${BIN} replay ${join(pack, 'peppol-N18.json')} --extraction <file> --ruleset peppol-en16931@0.2.0 --source <file>`)
    expect(r.err).toContain(`this looks like an extraction, not a bundle: check it with ${BIN} check`)
    expect(r.err).toContain(`SKIPPED         legal/\n    a folder: a folder replay does not walk into folders. Replay it on its own: ${BIN} replay ${join(pack, 'legal')}`)
    expect(r.err.trimEnd().split('\n').at(-1)).toBe('verify replay: 2 case(s): 0 match · 0 diverged · 0 not re-performed · 2 refused') // the summary stays last
    expect(r.json().skipped_folders).toEqual(['legal'])
  })

  it('the placeholder for --source is <file>', () => {
    const r = go(['replay', N18_VERDICT, '--extraction', N18_EXTRACTION, '--ruleset', RS_V02])
    expect(r.code).toBe(3)
    expect(r.err).toContain('--source <file>; this call leaves out --source')
    expect(r.err).not.toContain('<text>')
  })
})
