/**
 * Two costs of reading JSON under the hash contract (2026-10-06; src/protocol/hash-input.ts).
 *
 *  - Nesting. An outside engineer's 200,000-deep extraction printed "Maximum call stack size exceeded" on the command line (exit
 *    3), and the same shape over HTTP was a 400 "invalid JSON body" for valid JSON. Past MAX_JSON_DEPTH (256) levels the input is
 *    now refused before it is parsed: "nesting too deep, limit 256", naming the character where the deepest level opens.
 *  - Keys. The duplicate-key scan looked for an escape by searching back from each key's end to the start of the text, so its
 *    cost grew with the number of keys times the length of the text: a 20 MB body of 200,000 small objects took minutes. It now
 *    looks inside the key only.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJsonStrict, tooDeepOffset, duplicateKeyPath, HashInputRefused, MAX_JSON_DEPTH, TOO_DEEP_WORDS } from '../src/protocol/hash-input'
import { run, type CliIO } from '../src/cli'

const dir = mkdtempSync(join(tmpdir(), 'depth-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const nested = (levels: number): string => `{"invoice_number":"X","junk":${'['.repeat(levels - 1)}${']'.repeat(levels - 1)}}`

describe('nesting too deep, limit 256', () => {
  it('256 levels are read; 257 are refused before parsing, naming where; brackets inside strings do not count', () => {
    expect(MAX_JSON_DEPTH).toBe(256)
    expect(TOO_DEEP_WORDS).toBe('nesting too deep, limit 256')
    expect(() => parseJsonStrict(nested(256), 'x.json')).not.toThrow()
    let err: unknown
    try { parseJsonStrict(nested(257), 'x.json') } catch (e) { err = e }
    expect(err).toBeInstanceOf(HashInputRefused)
    expect((err as Error).message).toContain('x.json: nesting too deep, limit 256: an object or array opens more than 256 levels down (at character')
    expect(tooDeepOffset(`{"a":"${'['.repeat(1000)}"}`)).toBe(-1)
    expect(tooDeepOffset(`{"a":"\\"${'['.repeat(10)}"}`, 5)).toBe(-1)
    expect(tooDeepOffset('[[[', 2)).toBe(2)
  })

  it('a 200,000-deep extraction on the command line: the words, exit 3, no stack overflow', () => {
    const f = join(dir, 'deep.json')
    writeFileSync(f, nested(200_000))
    let out = '', err = ''
    const io: CliIO = { out: s => { out += s }, err: s => { err += s } }
    const code = run([f], io)
    expect(code).toBe(3)
    expect(err).toContain('nesting too deep, limit 256')
    expect(err).not.toContain('Maximum call stack size exceeded')
    expect(out).toBe('')
  })
})

describe('the duplicate-key scan is linear in the text', () => {
  it('200,000 small objects (about 20 MB) are read in seconds, not minutes; an escaped repeat is still found', () => {
    const items = Array.from({ length: 200_000 }, (_, i) => ({ description: `Item ${i} widget assembly`, quantity: (i % 7) + 1, unit_price: '12.50', amount: '25.00' }))
    const text = JSON.stringify({ extraction: { invoice_number: 'X', line_items: items } })
    const t0 = performance.now()
    expect(duplicateKeyPath(text)).toBeUndefined()
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(duplicateKeyPath('{"total":1,"t\\u006ftal":2}')).toEqual({ path: '$.total', key: 'total' })
  })
})
