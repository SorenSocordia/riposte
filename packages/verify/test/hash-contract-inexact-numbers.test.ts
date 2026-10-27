/**
 * A number that cannot be represented exactly is refused before hashing (2026-10-05; an outside engineer's
 * invoice, recorded as a kill by REPLAYERS.md rule 3). `unit_price: 9007199254740993` with `amount: 9007199254740992` read the
 * line check PASS, because JSON parsing reads 9007199254740993 as 9007199254740992 before the engine sees it, and the verdict
 * recorded a figure the file does not hold.
 *
 * Now: a number token whose exact decimal is not the decimal of the double it parses to is refused at every text door (the CLI's
 * files, HTTP, MCP, a folder or .jsonl of bundles) with its JSON path; from engine 0.6.0 the library refuses a parsed number past
 * 2^53 − 1 in magnitude (it may already have been rounded); and a number written as text with more digits than a double holds is
 * unreadable, so every check that needs it says can't tell. Every input accepted before still hashes as it did.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { run } from '../src/cli'
import {
  verify, verifyDeclarative, numberTextIsExact, inexactNumberPath, parseJsonStrict, HashInputRefused, InputRefused,
  replayBundles, bundlesFromText, unsafeMagnitudePath, INEXACT_NUMBER_WORDS, type DeclarativeRuleset,
} from '../src/index'
import { route } from '../src/http/router'
import { createHttpServer } from '../src/http/serve'
import { serve as serveMcp } from '../src/mcp/stdio'
import { scratch, cleanScratch } from './helpers/scratch'

const NOW = (): Date => new Date('2026-10-05T00:00:00.000Z')
type J = Record<string, unknown>
afterAll(() => cleanScratch())

function go(argv: string[]): { code: number; out: string; err: string } {
  let out = '', err = ''
  const code = run(argv, { out: s => { out += s }, err: s => { err += s } }) as number
  return { code, out, err }
}

/** The engineer's file, byte for byte (mytests/big.json). */
const BIG = '{"invoice_number":"INV-9","line_items":[{"description":"X","quantity":1,"unit_price":9007199254740993,"amount":9007199254740992}],"totals":{"subtotal":9007199254740992,"tax_rate":0,"tax":0,"total":9007199254740992}}'
/** An ordinary bill whose unit price is written `price` (the text, as it appears in the file). */
const bill = (price: string, amount = '6125'): string =>
  `{"invoice_number":"INV-6","line_items":[{"description":"X","quantity":1,"unit_price":${price},"amount":${amount}}],"totals":{"subtotal":6125,"tax_rate":0,"tax":0,"total":6125}}`

describe('numberTextIsExact: the text names exactly the double it reads as', () => {
  it('exact: every spelling of one decimal, zero of either sign, exact integers past 2^53, the shortest round trip', () => {
    for (const t of ['6125', '6125.0', '6.125e3', '612500e-2', '0.1', '-0', '0', '0.0', '-0.0e5', '1e21', '1E+21', '9007199254740992', '9007199254740994',
      '0.30000000000000004', '0.12345678901234568', '5e-324', '-1.5', '100.10']) expect(numberTextIsExact(t), t).toBe(true)
  })
  it('not exact: an integer past 2^53 that rounds, a decimal that loses digits (17 significant), an underflow to zero', () => {
    for (const t of ['9007199254740993', '-9007199254740993', '123456789012345678901', '0.12345678901234567', '0.10000000000000001', '1.0000000000000001', '1e-400',
      '2.2250738585072011e-308']) expect(numberTextIsExact(t), t).toBe(false)
  })
  it('a number past the double range (1e999) and text that is not a number are left to their own readers', () => {
    for (const t of ['1e999', '-1e999', 'true', 'null', '"9007199254740993"']) expect(numberTextIsExact(t), t).toBe(true)
  })
})

describe('inexactNumberPath and parseJsonStrict', () => {
  it('names the JSON path of the first such number, in objects and arrays, and nothing for exact text', () => {
    expect(inexactNumberPath(BIG)).toEqual({ path: '$.line_items[0].unit_price', token: '9007199254740993' })
    expect(inexactNumberPath('[1, 2, 0.10000000000000001]')).toEqual({ path: '$[2]', token: '0.10000000000000001' })
    expect(inexactNumberPath('9007199254740993')).toEqual({ path: '$', token: '9007199254740993' })
    expect(inexactNumberPath('{"a b":{"c":[0, {"d": 1e-400}]}}')).toEqual({ path: '$["a b"].c[1].d', token: '1e-400' })
    expect(inexactNumberPath('{"s":"9007199254740993","n":-0,"x":6.125e3}')).toBeUndefined() // a string is text, hashed as written
    expect(inexactNumberPath(bill('6125.0'))).toBeUndefined()
  })
  it('parseJsonStrict refuses it with HashInputRefused, the path and the words; 1e999 keeps its own refusal', () => {
    expect(() => parseJsonStrict(BIG, 'big.json')).toThrow(HashInputRefused)
    expect(() => parseJsonStrict(BIG, 'big.json')).toThrow(`big.json: the number at $.line_items[0].unit_price (9007199254740993) is ${INEXACT_NUMBER_WORDS}.`)
    expect(() => parseJsonStrict(BIG, 'big.json')).toThrow(/this one reads as 9007199254740992/)
    expect(() => parseJsonStrict('{"total":1e999}', 'f')).toThrow(/the number at \$\.total is not finite/)
    expect(() => parseJsonStrict(`{"n":${'1'.repeat(60)}}`, 'f')).toThrow(/\(1{32}…\(60 characters\)\)/)
  })
  it('no false refusal on 5,000 stringified documents (JSON.stringify always writes the shortest round trip)', () => {
    let seed = 7
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let k = 0; k < 5000; k++) {
      const doc = { a: rnd() * 10 ** Math.floor(rnd() * 40 - 20), b: [Math.floor(rnd() * 1e6) / 100, -rnd(), Math.floor(rnd() * Number.MAX_SAFE_INTEGER)], c: { d: rnd() * 1e300, e: rnd() * 1e-300 } }
      expect(inexactNumberPath(JSON.stringify(doc))).toBeUndefined()
    }
  })
})

describe('the CLI: the engineer\'s big.json is refused before hashing (exit 3); equal spellings stay equal and accepted', () => {
  it('big.json: exit 3, the path and the words; it used to read the line check PASS', () => {
    const dir = scratch('inexact-cli')
    const f = join(dir, 'big.json')
    writeFileSync(f, BIG)
    const r = go(['check', f])
    expect(r.code).toBe(3)
    expect(r.out).toBe('')
    expect(r.err).toContain(`the number at $.line_items[0].unit_price (9007199254740993) is ${INEXACT_NUMBER_WORDS}`)
  })
  it('6125, 6125.0 and 6.125e3 issue one verdict with one input_hash; -0 is accepted', () => {
    const dir = scratch('inexact-cli-equal')
    const hashes = ['6125', '6125.0', '6.125e3'].map((p, i) => {
      const f = join(dir, `b${i}.json`)
      writeFileSync(f, bill(p))
      const r = go(['check', f, '--allow-open'])
      expect(r.code, p).toBe(0)
      return (JSON.parse(r.out) as J).input_hash
    })
    expect(new Set(hashes).size).toBe(1)
    const z = join(dir, 'zero.json')
    writeFileSync(z, bill('6125', '6125').replace('"tax":0', '"tax":-0'))
    expect(go(['check', z, '--allow-open']).code).toBe(0)
  })
  it('a 17-significant-digit decimal that does not round-trip is refused; one that does is accepted', () => {
    const dir = scratch('inexact-cli-17')
    const no = join(dir, 'no.json'), yes = join(dir, 'yes.json')
    writeFileSync(no, '{"invoice_number":"I","line_items":[{"description":"X","quantity":0.12345678901234567,"unit_price":1,"amount":0.12}]}')
    writeFileSync(yes, '{"invoice_number":"I","line_items":[{"description":"X","quantity":0.12345678901234568,"unit_price":1,"amount":0.12}]}')
    const r = go(['check', no])
    expect(r.code).toBe(3)
    expect(r.err).toContain('the number at $.line_items[0].quantity (0.12345678901234567) is a number that cannot be represented exactly')
    expect(go(['check', yes]).code).not.toBe(3)
  })
  it('an exact integer past 2^53 is refused by the engine itself (it may have been rounded): exit 3, the words', () => {
    const dir = scratch('inexact-cli-safe')
    const f = join(dir, 'big2.json')
    writeFileSync(f, BIG.replace('9007199254740993', '9007199254740994'))
    const r = go(['check', f])
    expect(r.code).toBe(3)
    expect(r.err).toMatch(/the number at \$\.line_items\[0\]\.unit_price \(9007199254740994\) is a number that cannot be represented exactly; write amounts as strings with two decimals\. Past 9007199254740991/)
  })
})

describe('the library: from engine 0.6.0 a number past 2^53 − 1 is refused; earlier engines read it as before', () => {
  const big = JSON.parse(BIG) as J
  it('verify() refuses the parsed big.json (both figures read as 2^53), naming the first path', () => {
    expect(unsafeMagnitudePath(big)).toBe('$.line_items[0].unit_price')
    expect(() => verify(big, { now: NOW })).toThrow(InputRefused)
    expect(() => verify(big, { now: NOW })).toThrow(/^verify: the extraction: the number at \$\.line_items\[0\]\.unit_price \(9007199254740992\) is a number that cannot be represented exactly/)
    expect(() => verify({ invoice_number: 'I' }, { now: NOW, references: { history: [{ total: -(2 ** 60) }] } })).toThrow(/references\.history: the number at \$\[0\]\.total/)
  })
  it('the largest safe integer is accepted; under engine 0.5.0 the parsed big.json issues exactly as before', () => {
    expect(() => verify({ invoice_number: 'I', totals: { total: Number.MAX_SAFE_INTEGER } }, { now: NOW })).not.toThrow()
    const v = verify(big, { now: NOW, engine: '0.5.0' })
    expect(v.engine_version).toBe('0.5.0')
  })
  const RS: DeclarativeRuleset = {
    id: 'test-total', version: '1.0.0', domain: 'test',
    fields: { SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
    checks: [{ code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'SUB + TAX', field: 'total' }],
  }
  it('verifyDeclarative refuses it under 0.6.0 too; 0.5.0 reads it as before', () => {
    expect(() => verifyDeclarative({ subtotal: 2 ** 53, tax: 0, total: 2 ** 53 }, RS, { now: NOW })).toThrow(/^verify: the extraction: the number at \$\.subtotal \(9007199254740992\) is a number that cannot be represented exactly/)
    expect(verifyDeclarative({ subtotal: 2 ** 53 - 1, tax: 0, total: 2 ** 53 - 1 }, RS, { now: NOW }).outcome).toBe('PASS')
    expect(verifyDeclarative({ subtotal: 2 ** 53, tax: 0, total: 2 ** 53 }, RS, { now: NOW, engine: '0.5.0' }).outcome).toBe('PASS')
  })
  it('declarative, under 0.6.0: a figure written as text with more digits than a double holds is unreadable, never PASS', () => {
    const v = verifyDeclarative({ subtotal: '9007199254740993.00', tax: '0.00', total: '9007199254740992.00' }, RS, { now: NOW })
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    expect(verifyDeclarative({ subtotal: '9007199254740993.00', tax: '0.00', total: '9007199254740992.00' }, RS, { now: NOW, engine: '0.5.0' }).outcome).toBe('PASS')
    expect(verifyDeclarative({ subtotal: '6125.00', tax: '0.00', total: '6125.00' }, RS, { now: NOW }).outcome).toBe('PASS')
  })
  it('built-in rulesets, under 0.6.0: such a figure is refused by the strict reading, and the line check says can\'t tell, never PASS', () => {
    const ex = JSON.parse(BIG.replace('9007199254740993', '"9007199254740993.00"').replace('"amount":9007199254740992', '"amount":"9007199254740992.00"')
      .replace(/"subtotal":9007199254740992/, '"subtotal":"1.00"').replace(/"total":9007199254740992/, '"total":"1.00"')) as J
    const math = verify(ex, { now: NOW }).claims.find(c => c.claim_id === 'line[0].MATH_INT')!
    expect(math.outcome).toBe('INSUFFICIENT_DATA')
    expect(math.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(math.evidence.find(e => e.locator.kind === 'field' && e.locator.path.endsWith('unit_price'))).toMatchObject({ value: '9007199254740993.00', normalizations: ['strict_reading_refused'] })
    // the same bill under engine 0.5.0 reads as it always did (its verdicts re-perform byte for byte)
    expect(verify(ex, { now: NOW, engine: '0.5.0' }).claims.find(c => c.claim_id === 'line[0].MATH_INT')!.outcome).toBe('PASS')
    // two decimals on an ordinary amount still read
    const ok = JSON.parse(bill('"6125.00"', '"6125.00"')) as J
    expect(verify(ok, { now: NOW }).claims.find(c => c.claim_id === 'line[0].MATH_INT')!.outcome).toBe('PASS')
  })
})

describe('HTTP, MCP and replay bundles refuse it too', () => {
  it('HTTP: a 400 naming the path, code body.inexact_number', async () => {
    const server = createHttpServer(route, {}, { errorCodes: true })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port
    const body = Buffer.from(`{"extraction":${BIG}}`)
    try {
      const res = await new Promise<{ status: number; json: J }>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/v1/verify', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } }, r => {
          let s = ''
          r.on('data', c => { s += c })
          r.on('end', () => resolve({ status: r.statusCode ?? 0, json: JSON.parse(s) as J }))
        })
        req.on('error', reject)
        req.end(body)
      })
      expect([res.status, res.json.code]).toEqual([400, 'body.inexact_number'])
      expect(res.json.error).toContain('the request body: the number at $.extraction.line_items[0].unit_price (9007199254740993) is a number that cannot be represented exactly')
    } finally {
      await new Promise<void>(r => server.close(() => r()))
    }
  })
  it('HTTP, in process (a body already parsed): the library refuses past 2^53 − 1 with a 400', () => {
    const r = route({ method: 'POST', path: '/v1/verify', body: { extraction: JSON.parse(BIG) } })
    expect(r.status).toBe(400)
    expect((r.json as J).error).toMatch(/cannot be represented exactly/)
  })
  it('MCP stdio: a JSON-RPC parse error naming the path', async () => {
    const input = new PassThrough(), output = new PassThrough()
    const lines: J[] = []
    output.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(JSON.parse(l) as J) })
    serveMcp(input, output)
    input.write(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_document","arguments":{"extraction":${BIG}}}}\n`)
    input.end()
    await new Promise(r => setTimeout(r, 50))
    expect((lines[0]!.error as { message: string }).message).toMatch(/^parse error: the request line: the number at \$\.params\.arguments\.extraction\.line_items\[0\]\.unit_price \(9007199254740993\) is a number that cannot be represented exactly/)
  })
  it('a bundle holding one is a REFUSED case in a folder or .jsonl replay, never a MATCH', () => {
    const ex = JSON.parse(bill('6125')) as J
    const bundle = { verdict: verify(ex, { now: NOW }), inputs: { extraction: ex, references: { contract: null, evidence: [], history: [] }, source: null } }
    const text = JSON.stringify(bundle).replace('"unit_price":6125', '"unit_price":6125.0000000000000001')
    expect(replayBundles(bundlesFromText('b.json', text)).cases[0]).toMatchObject({ result: 'REFUSED', reason: expect.stringMatching(/cannot be represented exactly/) })
    expect(replayBundles(bundlesFromText('b.json', JSON.stringify(bundle))).cases[0]!.result).toBe('MATCH')
  })
})
