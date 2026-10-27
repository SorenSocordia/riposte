/**
 * The hash contract at every entry point (2026-10-05). An outside engineer found three ways to make one verdict_id
 * name two different engine outputs, none of them through the CLI's own file reads:
 *
 *   - tolerance: `roundingCap.perLine: "TAX_INT"` (a string) and `["T","A","X","_","I","N","T"]` hashed alike, while the engine's
 *      `.includes()` read them differently (a PASS and a FAIL under one verdict_id), through the library and HTTP;
 *   - non-finite numbers: `total: null`, `Infinity`, `-Infinity` and `NaN` shared one input_hash and verdict_id through the
 *      library (verify() never scanned), HTTP and MCP (their bodies were plain JSON.parse);
 *   - duplicate keys: a signed envelope with `"outcome":"FAIL"` inserted before the real `"outcome":"PASS"` VERIFIED under
 *      `--trusted-key --strict`, because JSON.parse keeps the last key and the signature covers the parsed object.
 *
 * Each is now refused where it enters, and every input that issued a verdict before hashes exactly as it did (pinned below with
 * input_hash values recorded from the build before this change).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../src/cli'
import {
  verify, verifyReplay, signVerdict, generateSigningKeypair, verifyEnvelopeText, toleranceIdentity, toleranceProblem, CAPPED,
  duplicateKeyPath, parseJsonStrict, HashInputRefused, InputRefused, replayBundles, bundlesFromText, type Verdict,
} from '../src/index'
import { canonicalize } from '../src/verdict/canonical'
import { route } from '../src/http/router'
import { createHttpServer } from '../src/http/serve'
import { serve as serveMcp } from '../src/mcp/stdio'
import { handleRequest } from '../src/mcp/server'
import { scratch, cleanScratch } from './helpers/scratch'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
type J = Record<string, unknown>
afterAll(() => cleanScratch())

function go(argv: string[]): { code: number; out: string; err: string } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err }
}
/** The engineer's invoice (nonfinite-lib.mjs), with `total` as given. */
const invoice = (total: unknown): J => ({ invoice_number: 'INV-1001', line_items: [{ description: 'Consulting', quantity: 10, unit_price: 150, amount: 1500 }], totals: { subtotal: 1500, tax_rate: 0, tax: 0, total } })
/** The engineer's ten-line invoice (tolcollide.mjs), tax 8.34. */
const tenLines = (): J => ({
  invoice_number: 'INV-T',
  line_items: Array.from({ length: 10 }, (_, i) => ({ description: `L${i}`, quantity: 1, unit_price: 10.05, amount: 10.05 })),
  totals: { subtotal: 100.5, tax_rate: 0.0825, tax: 8.34, total: 108.84 },
})

describe('a key repeated in one JSON object is refused wherever JSON feeds a hash or a signature', () => {
  it('duplicateKeyPath names the first repeated key by its JSON path, at any depth, and only real repeats', () => {
    expect(duplicateKeyPath('{"a":1,"a":2}')).toEqual({ path: '$.a', key: 'a' })
    expect(duplicateKeyPath('{"verdict":{"outcome":"FAIL","outcome":"PASS"}}')).toEqual({ path: '$.verdict.outcome', key: 'outcome' })
    expect(duplicateKeyPath('[{"x":1},{"x":1,"y":[1,{"z":0,"z":0}]}]')).toEqual({ path: '$[1].y[1].z', key: 'z' })
    expect(duplicateKeyPath('{"a":1,"\\u0061":2}')).toEqual({ path: '$.a', key: 'a' }) // the same key, escaped
    expect(duplicateKeyPath('{"a b":1,"a b":2}')).toEqual({ path: '$["a b"]', key: 'a b' })
    expect(duplicateKeyPath('{"__proto__":1,"__proto__":2}')).toEqual({ path: '$.__proto__', key: '__proto__' })
    expect(duplicateKeyPath('{"s":"}{\\"s\\":1","t":"\\\\"}')).toBeUndefined() // braces and quotes inside strings
    expect(duplicateKeyPath('{"a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":2}]}')).toBeUndefined() // the same key in sibling objects
  })

  it('no false positive on 5,000 stringified documents; an inserted repeat is always found (fuzz)', () => {
    let seed = 11
    const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k }
    const keys = ['a', 'b', 'a b', 'é', '"q"', '\\', '}', '{', ',', ':', 'line\nbreak']
    const gen = (d: number): unknown => {
      const r = rnd(d > 3 ? 4 : 6)
      if (r === 0) return rnd(1000) - 500
      if (r === 1) return keys[rnd(keys.length)]
      if (r === 2) return null
      if (r === 3) return rnd(2) === 0
      if (r === 4) return Array.from({ length: rnd(4) }, () => gen(d + 1))
      const o: J = {}
      for (let k = rnd(5); k > 0; k--) o[keys[rnd(keys.length)]!] = gen(d + 1)
      return o
    }
    let inserted = 0
    for (let t = 0; t < 5000; t++) {
      const v = { root: gen(0) }
      const text = rnd(2) ? JSON.stringify(v) : JSON.stringify(v, null, 2)
      expect(duplicateKeyPath(text), text).toBeUndefined()
      const k = keys[rnd(keys.length)]!
      const withDup = `{${JSON.stringify(k)}:0,${JSON.stringify(k)}:1,"rest":${text}}`
      expect(duplicateKeyPath(withDup)?.key).toBe(k)
      inserted++
    }
    expect(inserted).toBe(5000)
  })

  it('parseJsonStrict refuses it with HashInputRefused, naming the file and the path', () => {
    expect(() => parseJsonStrict('{"a":1,"b":{"c":1,"c":2}}', 'x.json')).toThrow(HashInputRefused)
    expect(() => parseJsonStrict('{"a":1,"b":{"c":1,"c":2}}', 'x.json')).toThrow(/^x\.json: the key "c" appears twice in one object \(at \$\.b\.c\)/)
    expect(parseJsonStrict('{"a":1,"b":{"c":1}}', 'x.json')).toEqual({ a: 1, b: { c: 1 } })
  })

  it('the engineer\'s envelope: genuine VERIFIES under --trusted-key --strict; the one with "outcome":"FAIL" inserted is refused (exit 3)', () => {
    const d = scratch('dupkey-')
    const k = generateSigningKeypair()
    const ex = invoice(1500)
    const v = verify(ex, { now: NOW })
    const env = signVerdict(v, k.privateKeyPem)
    const pub = join(d, 'k.pub.pem'); writeFileSync(pub, k.publicKeyPem)
    const exPath = join(d, 'invoice.json'); writeFileSync(exPath, JSON.stringify(ex))
    const good = join(d, 'env.json'); writeFileSync(good, JSON.stringify(env))
    const text = JSON.stringify(env)
    expect(text).toContain(`"outcome":"${v.outcome}"`)
    const bad = join(d, 'env-dup.json'); writeFileSync(bad, text.replace(`"outcome":"${v.outcome}"`, `"outcome":"FAIL","outcome":"${v.outcome}"`))
    expect(go(['replay', good, '--extraction', exPath, '--trusted-key', pub, '--strict']).code).toBe(0)
    const r = go(['replay', bad, '--extraction', exPath, '--trusted-key', pub, '--strict'])
    expect(r.code).toBe(3)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/the key "outcome" appears twice in one object \(at \$\.verdict\.outcome\)/)
    // the library's text entry says the same; the parsed-object entry still verifies the last key (why the text entry exists)
    expect(verifyEnvelopeText(readFileSync(good, 'utf8')).signature_ok).toBe(true)
    expect(() => verifyEnvelopeText(readFileSync(bad, 'utf8'))).toThrow(HashInputRefused)
  })

  it('a bundle with a repeated key is a REFUSED case in a folder or .jsonl replay, never a MATCH', () => {
    const ex = invoice(1500)
    const bundle = { verdict: verify(ex, { now: NOW }), inputs: { extraction: ex, references: { contract: null, evidence: [], history: [] }, source: null } }
    const text = JSON.stringify(bundle).replace('"outcome":', '"outcome":"FAIL","outcome":')
    const items = bundlesFromText('b.json', text)
    expect(replayBundles(items).cases[0]).toMatchObject({ result: 'REFUSED', reason: expect.stringMatching(/the key "outcome" appears twice/) })
    expect(replayBundles(bundlesFromText('b.json', JSON.stringify(bundle))).cases[0]!.result).toBe('MATCH')
  })

  it('HTTP: a body with a repeated key, a number past the double range or bytes that are not UTF-8 is a 400 naming where', async () => {
    const server = createHttpServer(route, {}, { errorCodes: true })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port
    const post = (body: Buffer): Promise<{ status: number; json: J; headers: Record<string, unknown> }> => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/v1/verify', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } }, res => {
        let s = ''
        res.on('data', c => { s += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(s) as J, headers: res.headers }))
      })
      req.on('error', reject)
      req.end(body)
    })
    try {
      const good = JSON.stringify({ extraction: invoice(1500) })
      expect((await post(Buffer.from(good))).status).toBe(200)
      const dup = await post(Buffer.from(good.replace('"total":1500', '"total":1500,"total":0')))
      expect([dup.status, dup.json.code]).toEqual([400, 'body.duplicate_key'])
      expect(dup.json.error).toMatch(/the request body: the key "total" appears twice in one object \(at \$\.extraction\.totals\.total\)/)
      const inf = await post(Buffer.from(good.replace('"total":1500', '"total":1e999')))
      expect([inf.status, inf.json.code]).toEqual([400, 'body.non_finite_number'])
      expect(inf.json.error).toMatch(/the number at \$\.extraction\.totals\.total is not finite/)
      const bytes = Buffer.concat([Buffer.from(good.slice(0, 20)), Buffer.from([0xff]), Buffer.from(good.slice(20))])
      const utf = await post(bytes)
      expect([utf.status, utf.json.code]).toEqual([400, 'body.invalid_utf8'])
      expect(utf.json.error).toMatch(/not valid UTF-8: the bytes at offset 20 \(FF/)
      expect((await post(Buffer.from('{"extraction":'))).json.code).toBe('body.invalid_json')
    } finally {
      await new Promise<void>(r => server.close(() => r()))
    }
  })

  it('MCP stdio: the same three are a JSON-RPC parse error naming where; a CRLF line still reads', async () => {
    const input = new PassThrough(), output = new PassThrough()
    const lines: J[] = []
    output.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(JSON.parse(l) as J) })
    serveMcp(input, output)
    const call = (id: number, total: string): string => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"verify_document","arguments":{"extraction":{"invoice_number":"INV-1","totals":{"total":${total}}}}}}`
    input.write(`${call(1, '10')}\r\n`)
    input.write(`${call(2, '10,"total":11')}\n`)
    input.write(`${call(3, '1e999')}\n`)
    input.write(Buffer.concat([Buffer.from(call(4, '10').slice(0, 30)), Buffer.from([0xfe]), Buffer.from(`${call(4, '10').slice(30)}\n`)]))
    input.end()
    await new Promise(r => setTimeout(r, 50))
    expect(lines.find(l => l.id === 1)?.result).toBeDefined()
    const errors = lines.filter(l => l.error).map(l => (l.error as { message: string }).message)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/^parse error: the request line: the key "total" appears twice in one object \(at \$\.params\.arguments\.extraction\.totals\.total\)/)
    expect(errors[1]).toMatch(/^parse error: the request line: the number at \$\.params\.arguments\.extraction\.totals\.total is not finite/)
    expect(errors[2]).toMatch(/^parse error: the request line is not valid UTF-8: the bytes at offset 30 \(FE/)
  })
})

describe('a non-finite number is refused inside verify() itself, and a replay given one fails', () => {
  it('the engineer\'s four totals: null still issues (input_hash as before); Infinity, -Infinity and NaN are refused naming the path', () => {
    expect(verify(invoice(null), { now: NOW }).input_hash).toBe('d52dfe6221b8c1ab0b0473adadecaf84773a52a65dd890cf89389db4cc03206b')
    expect(verify(invoice(1500), { now: NOW }).input_hash).toBe('8793271c74f8043f224d9d49ea494782d5dc414adaa22820a62fca0cfd651045')
    for (const t of [Infinity, -Infinity, NaN]) {
      expect(() => verify(invoice(t), { now: NOW }), String(t)).toThrow(InputRefused)
      expect(() => verify(invoice(t), { now: NOW })).toThrow(/^verify: the extraction: the number at \$\.totals\.total is not finite/)
    }
  })

  it('every part input_hash covers is scanned: the references, the source, every engine version', () => {
    const ex = invoice(1500)
    expect(() => verify(ex, { references: { contract: { rates: [{ rate: Infinity }] } } })).toThrow(/references\.contract: the number at \$\.rates\[0\]\.rate is not finite/)
    expect(() => verify(ex, { references: { evidence: [{ qty: NaN }] } })).toThrow(/references\.evidence: the number at \$\[0\]\.qty is not finite/)
    expect(() => verify(ex, { references: { history: [{ total: -Infinity }] } })).toThrow(/references\.history/)
    expect(() => verify(ex, { source: { text: 'x', values: [{ id: 'v', value: Infinity, field: 'total' }] } })).toThrow(/source: the number at \$\.values\[0\]\.value/)
    for (const engine of ['0.0.1', '0.5.0', '0.6.0']) expect(() => verify(invoice(Infinity), { engine }), engine).toThrow(InputRefused)
  })

  it('a replay whose inputs hold a non-finite number FAILS (the hash cannot tell it from null), never VERIFIES', () => {
    const v = verify(invoice(null), { now: NOW })
    const inputs = (total: unknown): J => ({ extraction: invoice(total), references: { contract: null, evidence: [], history: [] }, source: null })
    expect(verifyReplay(v, inputs(null)).status).toBe('REPERFORMED')
    const r = verifyReplay(v, inputs(Infinity))
    expect([r.status, r.input_ok, r.outcome_verified]).toEqual(['FAILED', false, false])
    expect(r.reason).toMatch(/the supplied inputs hold a number that is not finite at \$\.extraction\.totals\.total/)
  })
})

describe('the tolerance shape is checked strictly, and its identity keeps each list\'s type', () => {
  it('the engineer\'s pair: the string form is refused, naming roundingCap.perLine; the character array issues under its old hash', () => {
    const A = { rel: 0.01, absCap: 0, roundingCap: { perLine: 'TAX_INT', cashStep: [] } }
    const B = { rel: 0.01, absCap: 0, roundingCap: { perLine: ['T', 'A', 'X', '_', 'I', 'N', 'T'], cashStep: [] } }
    expect(() => verify(tenLines(), { now: NOW, tolerance: A as never })).toThrow(/tolerance\.roundingCap\.perLine must be an array of rule-id strings, such as \["TAX_INT"\] \(got the string "TAX_INT"\)/)
    expect(verify(tenLines(), { now: NOW, tolerance: B }).input_hash).toBe('b44f4f9a7b00f10d938dab0005e0553bfc555bc881b2beb1707be9f0a6d12b0b')
    expect(canonicalize(toleranceIdentity(A as never))).not.toBe(canonicalize(toleranceIdentity(B)))
  })

  it('a valid override hashes exactly as before (pinned from the build before this change)', () => {
    expect(verify(tenLines(), { now: NOW, tolerance: CAPPED }).input_hash).toBe('fbbf5bbf08d0d99d3cbd99fb43c0859f97ac40f037226bf9df11e7f7bac591e3')
    expect(verify(tenLines(), { now: NOW, tolerance: { rel: 0.0005, absCap: 2, roundingCap: { perLine: ['TAX_INT'], cashStep: ['TOTAL_INT'] } } }).input_hash)
      .toBe('076ca59f48a52cc538aea57fa4d6056bfb2f528b409d108eafa29508830b097c')
  })

  it('toleranceProblem: each wrong shape is named; the shapes the engines read pass', () => {
    expect(toleranceProblem({ rel: 0.0003, absCap: 0 })).toBeUndefined()
    expect(toleranceProblem({ rel: 0.0003, absCap: 0, rounding: 'infer' })).toBeUndefined()
    expect(toleranceProblem(CAPPED)).toBeUndefined()
    expect(toleranceProblem(null)).toMatch(/^tolerance must be an object/)
    expect(toleranceProblem({ rel: -1, absCap: 0 })).toMatch(/^tolerance\.rel must be a finite number ≥ 0 \(got -1\)/)
    expect(toleranceProblem({ rel: Infinity, absCap: 0 })).toMatch(/^tolerance\.rel must be a finite number/)
    expect(toleranceProblem({ rel: '0.1', absCap: 0 })).toMatch(/^tolerance\.rel must be a finite number ≥ 0 \(got "0\.1"\)/)
    expect(toleranceProblem({ rel: 0, absCap: 0, materiality: 5 })).toMatch(/carries "materiality", which no engine reads/)
    expect(toleranceProblem({ rel: 0, absCap: 0, rounding: 'guess' })).toMatch(/^tolerance\.rounding must be "infer" or "none"/)
    expect(toleranceProblem({ rel: 0, absCap: 0, roundingCap: { perLine: ['TAX_INT', 7] } })).toMatch(/^tolerance\.roundingCap\.perLine\[1\] must be a rule-id string/)
    expect(toleranceProblem({ rel: 0, absCap: 0, roundingCap: { cashStep: 'TOTAL_INT' } })).toMatch(/^tolerance\.roundingCap\.cashStep must be an array/)
    expect(toleranceProblem({ rel: 0, absCap: 0, roundingCap: { perLine: [], extra: [] } })).toMatch(/roundingCap carries "extra"/)
  })

  it('the HTTP route answers the string form with a 400 naming the field (it used to issue the colliding verdict)', () => {
    const r = route({ method: 'POST', path: '/v1/verify', body: { extraction: tenLines(), tolerance: { rel: 0.01, absCap: 0, roundingCap: { perLine: 'TAX_INT' } } } })
    expect(r.status).toBe(400)
    expect((r.json as J).error).toMatch(/tolerance\.roundingCap\.perLine must be an array of rule-id strings/)
  })

  it('a replay restating a malformed override, or carrying one in its inputs, FAILS naming the field', () => {
    const v = verify(tenLines(), { now: NOW, tolerance: CAPPED })
    const inputs = { extraction: tenLines(), references: { contract: null, evidence: [], history: [] }, source: null }
    expect(verifyReplay(v, inputs, { tolerance: CAPPED }).status).toBe('REPERFORMED')
    const restated = verifyReplay(v, inputs, { tolerance: { ...CAPPED, roundingCap: { perLine: 'TAX_INT' } } as never })
    expect([restated.status, restated.reason]).toEqual(['FAILED', expect.stringMatching(/restated rounding-tolerance override .*roundingCap\.perLine must be an array/)])
    const carried = verifyReplay(v, { ...inputs, tolerance: { rel: 0.0003, absCap: 0, roundingCap: { perLine: 'TAX_INT', cashStep: [] } } })
    expect([carried.status, carried.reason]).toEqual(['FAILED', expect.stringMatching(/the inputs' rounding-tolerance override/)])
  })
})

describe('the MCP and HTTP verdict paths read the hash contract too', () => {
  it('MCP verify_document refuses a non-finite number an in-process caller passes (the stdio reader refuses 1e999 first)', () => {
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_document', arguments: { extraction: invoice(NaN) } } })!
    const result = res.result as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/the number at \$\.totals\.total is not finite/)
  })

  it('the shipped N18 bundle inputs still read (no key repeats in the files this package ships)', () => {
    for (const f of ['peppol-N18.json', 'peppol-N18.extraction.json']) expect(() => parseJsonStrict(readFileSync(join(HERE, 'replay-n18', f), 'utf8'), f)).not.toThrow()
    const v = JSON.parse(readFileSync(join(HERE, 'replay-n18', 'peppol-N18.json'), 'utf8')) as Verdict
    expect(typeof v.verdict_id).toBe('string')
  })
})
