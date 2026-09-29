/**
 * Population readers and declared value rules for completeness reconciliation. The population is read exactly (RFC 4180,
 * BOM, CRLF), bound to its bytes, and refused (with the row and line) rather than repaired or guessed at.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPopulation, readPopulationCSV, readPopulationJSONL, populationFromRows, populationRowsHash, PopulationRefused } from '../src/reconcile/completeness/index'
import {
  decToString, decAdd, decSub, readAmount, readDate, effectiveAmountFormat, effectiveKeyRules, normalizeKey, decFromNumber, readUtcOffset, localDateOf,
} from '../src/reconcile/completeness/values'

const sha = (b: Buffer | string): string => createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'utf8') : b).digest('hex')
const refusedWith = (f: () => unknown, re: RegExp, where: { row?: number; line?: number } = {}): void => {
  try { f(); expect.unreachable('should refuse') } catch (e) {
    expect(e).toBeInstanceOf(PopulationRefused)
    expect((e as Error).message).toMatch(re)
    if (where.row !== undefined) expect((e as PopulationRefused).row).toBe(where.row)
    if (where.line !== undefined) expect((e as PopulationRefused).line).toBe(where.line)
  }
}

describe('CSV: RFC 4180, read exactly', () => {
  it('quoted delimiters, doubled quotes, a line break inside a quoted field, CRLF', () => {
    const text = 'id,name,amount\r\n1,"Acme, Inc.","1,000.00"\r\n2,"He said ""pay""",5\r\n3,"two\r\nlines",7\r\n'
    const p = readPopulationCSV(text)
    expect(p.columns).toEqual(['id', 'name', 'amount'])
    expect(p.rows.map(r => r.values)).toEqual([
      { id: '1', name: 'Acme, Inc.', amount: '1,000.00' },
      { id: '2', name: 'He said "pay"', amount: '5' },
      { id: '3', name: 'two\r\nlines', amount: '7' },
    ])
    expect(p.rows.map(r => [r.row, r.line])).toEqual([[1, 2], [2, 3], [3, 4]])
    expect(p.sha256).toBe(sha(text))
    expect(p.bytes).toBe(Buffer.byteLength(text))
  })
  it('a record after a multi-line field reports its own physical line', () => {
    const p = readPopulationCSV('a,b\n"x\ny\nz",1\n2,3\n')
    expect(p.rows.map(r => [r.row, r.line])).toEqual([[1, 2], [2, 5]])
  })
  it('a UTF-8 BOM is accepted (bytes and text) and hashed as given', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('id,v\n1,é\n', 'utf8')])
    const p = readPopulationCSV(bytes)
    expect(p.columns).toEqual(['id', 'v'])
    expect(p.rows[0]!.values).toEqual({ id: '1', v: 'é' })
    expect(p.sha256).toBe(sha(bytes))
    const t = readPopulationCSV('﻿id,v\n1,é\n')
    expect(t.columns).toEqual(['id', 'v'])
    expect(t.sha256).toBe(sha(bytes))
  })
  it('LF line endings, no final newline, trailing blank lines at the end', () => {
    expect(readPopulationCSV('a,b\n1,2').rows).toHaveLength(1)
    expect(readPopulationCSV('a,b\r\n1,2\r\n\r\n\r\n').rows).toHaveLength(1)
  })
  it('empty fields, and spaces kept as data', () => {
    expect(readPopulationCSV('a,b,c\n, x ,""\n').rows[0]!.values).toEqual({ a: '', b: ' x ', c: '' })
  })
  it('declared delimiters: ; tab |', () => {
    expect(readPopulationCSV('a;b\n"1;2";3\n', { delimiter: ';' }).rows[0]!.values).toEqual({ a: '1;2', b: '3' })
    expect(readPopulationCSV('a\tb\n1\t2\n', { delimiter: '\t' }).rows[0]!.values).toEqual({ a: '1', b: '2' })
    expect(readPopulation('a|b\n1|2\n', 'csv', { delimiter: '|' }).rows[0]!.values).toEqual({ a: '1', b: '2' })
  })
})

describe('CSV: malformed rows are refused with where, never skipped or guessed', () => {
  it('an unterminated quote', () => refusedWith(() => readPopulationCSV('a,b\n1,2\n3,"open\n4,5\n'), /row 2 \(line 3\): a quoted field opened on line 3 is never closed/, { row: 2, line: 3 }))
  it('a character after a closing quote', () => refusedWith(() => readPopulationCSV('a,b\n1,"x"y\n'), /row 1 \(line 2\): unexpected "y" after a closing quote/, { row: 1 }))
  it('a quote inside an unquoted field', () => refusedWith(() => readPopulationCSV('a,b\n1,x"y\n'), /row 1 \(line 2\): a double quote inside an unquoted field/))
  it('the wrong number of fields', () => {
    refusedWith(() => readPopulationCSV('a,b,c\n1,2,3\n4,5\n'), /row 2 \(line 3\) has 2 fields; the header has 3/, { row: 2, line: 3 })
    refusedWith(() => readPopulationCSV('a,b\n1,2,3\n'), /row 1 \(line 2\) has 3 fields; the header has 2/)
  })
  it('a blank line inside the file', () => refusedWith(() => readPopulationCSV('a,b\n1,2\n\n3,4\n'), /row 2 \(line 3\): a blank line inside the file/, { line: 3 }))
  it('a bare carriage return', () => refusedWith(() => readPopulationCSV('a,b\r1,2\n'), /the header \(line 1\): a bare carriage return/))
  it('a duplicate or empty header name', () => {
    refusedWith(() => readPopulationCSV('a,a\n1,2\n'), /names column "a" twice/)
    refusedWith(() => readPopulationCSV('a,\n1,2\n'), /column 2 has no name/)
  })
  it('invalid UTF-8, and an empty file', () => {
    refusedWith(() => readPopulationCSV(Buffer.from([0x61, 0x0a, 0xff, 0x0a])), /not valid UTF-8/)
    refusedWith(() => readPopulationCSV(''), /empty: no header record/)
  })
})

describe('JSONL', () => {
  it('one object per line, CRLF tolerated, trailing blank lines', () => {
    const text = '{"a":1}\r\n{"a":"x","b":{"c":2}}\r\n\r\n'
    const p = readPopulationJSONL(text)
    expect(p.rows.map(r => [r.row, r.line, r.values])).toEqual([[1, 1, { a: 1 }], [2, 2, { a: 'x', b: { c: 2 } }]])
    expect(p.sha256).toBe(sha(text))
  })
  it('refused: not JSON, not an object, a blank line inside', () => {
    refusedWith(() => readPopulationJSONL('{"a":1}\n{oops}\n'), /row 2 \(line 2\) is not JSON/, { row: 2, line: 2 })
    refusedWith(() => readPopulationJSONL('{"a":1}\n[1,2]\n'), /row 2 \(line 2\) is not a JSON object/)
    refusedWith(() => readPopulationJSONL('{"a":1}\n\n{"a":2}\n'), /line 2: a blank line inside the file/)
  })
  it('rows built in memory are bound by rows_hash', () => {
    const a = populationFromRows([{ x: 1 }, { x: 2 }])
    expect(a.sha256).toBeUndefined()
    expect(populationRowsHash(a)).toBe(populationRowsHash(readPopulationJSONL('{"x":1}\n{"x":2}\n')))
    expect(populationRowsHash(a)).not.toBe(populationRowsHash(populationFromRows([{ x: 2 }, { x: 1 }])))
  })
})

describe('amounts: exact decimals, read only by the declared format', () => {
  const fmt = effectiveAmountFormat
  const read = (s: unknown, f = {}): string => { const d = readAmount(s, fmt(f)); return 'problem' in d ? `!${d.problem}` : decToString(d) }
  it('the strict default', () => {
    expect(read('1894.92')).toBe('1894.92')
    expect(read('-12.50')).toBe('-12.5')
    expect(read('+7')).toBe('7')
    expect(read('.5')).toBe('0.5')
    expect(read(' 42 ')).toBe('42')
    expect(read('1,894.92')).toMatch(/^!.*looks digit-grouped/)
    expect(read('$5')).toMatch(/^!/)
    expect(read('1e3')).toMatch(/^!/) // text is not scientific notation
  })
  it('declared grouping accepts only groups of three', () => {
    expect(read('1,894.92', { group: ',' })).toBe('1894.92')
    expect(read('12,345,678', { group: ',' })).toBe('12345678')
    expect(read('1,89,492', { group: ',' })).toMatch(/^!/)
    expect(read('1.894,92', { decimal: ',', group: '.' })).toBe('1894.92')
    expect(read("1'894.92", { group: "'" })).toBe('1894.92')
    expect(read('1 894,92', { decimal: ',', group: ' ' })).toBe('1894.92')
  })
  it('declared symbols, parentheses and trailing minus', () => {
    expect(read('$1,000.00', { group: ',', strip: ['$'] })).toBe('1000')
    expect(read('1.000,00 €', { decimal: ',', group: '.', strip: ['€'] })).toBe('1000')
    expect(read('(123.45)', { parens_negative: true })).toBe('-123.45')
    expect(read('(123.45)')).toMatch(/^!/)
    expect(read('123.45-', { trailing_minus: true })).toBe('-123.45')
  })
  it('numbers are read exactly as they print; a number too large to be exact is refused', () => {
    expect(read(1894.92)).toBe('1894.92')
    expect(read(0.1)).toBe('0.1')
    expect(read(1e-7)).toBe('0.0000001')
    expect(read(1e21)).toMatch(/^!.*too large/)
    expect(read(Number.NaN)).toMatch(/^!/)
    const d = decFromNumber(0.1)
    if ('problem' in d) throw new Error(d.problem)
    const e = decFromNumber(0.2)
    if ('problem' in e) throw new Error(e.problem)
    expect(decToString(decAdd(d, e))).toBe('0.3') // not 0.30000000000000004
    expect(decToString(decSub(e, d))).toBe('0.1')
  })
  it('a format that would be ambiguous is refused at declaration', () => {
    expect(() => fmt({ decimal: '.', group: '.' })).toThrow(/cannot both be/)
    expect(() => fmt({ strip: ['1'] })).toThrow(/without digits/)
  })
})

describe('dates: declared, never sniffed', () => {
  it('each format, and calendar validity', () => {
    expect(readDate('2026-09-15', 'YYYY-MM-DD')).toBe('2026-09-15')
    expect(readDate('2026-09-15T23:30:00-05:00', 'ISO')).toBe('2026-09-15')
    expect(readDate('2026-09-15T23:30:00-05:00', 'YYYY-MM-DD')).toMatchObject({ problem: expect.any(String) })
    expect(readDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04')
    expect(readDate('03/04/2026', 'DD/MM/YYYY')).toBe('2026-04-03')
    expect(readDate('15.09.2026', 'DD.MM.YYYY')).toBe('2026-09-15')
    expect(readDate(20260915, 'YYYYMMDD')).toBe('2026-09-15')
    expect(readDate('2026-02-29', 'YYYY-MM-DD')).toMatchObject({ problem: expect.stringMatching(/not a calendar date/) })
    expect(readDate('2028-02-29', 'YYYY-MM-DD')).toBe('2028-02-29')
    expect(readDate('2026-13-01', 'YYYY-MM-DD')).toMatchObject({ problem: expect.any(String) })
  })
  it('the payer\'s calendar day of a UTC instant', () => {
    expect(readUtcOffset('-05:00')).toBe(-300)
    expect(readUtcOffset('+0530')).toBe(330)
    expect(() => readUtcOffset('EST')).toThrow()
    expect(localDateOf('2026-09-16T03:00:00.000Z', -300)).toBe('2026-09-15')
    expect(localDateOf('2026-09-16T03:00:00.000Z', 0)).toBe('2026-09-16')
  })
})

describe('keys: normalized by declared rules, in a fixed order', () => {
  it('trim → remove → case → leading zeros', () => {
    const r = effectiveKeyRules({ remove: '-/', case: 'upper', strip_leading_zeros: true }, 'k')
    expect(normalizeKey('  inv-000/12 ', r)).toBe('INV00012') // "leading zeros" are the value's, not a segment's
    expect(normalizeKey(' 000-123 ', r)).toBe('123')
    expect(normalizeKey('0000', r)).toBe('0')
    expect(normalizeKey(' a ', effectiveKeyRules({ trim: false }, 'k'))).toBe(' a ')
    expect(() => effectiveKeyRules({ case: 'title' as 'upper' }, 'k')).toThrow(/case must be/)
  })
})

describe('the example fixtures are the files the CLI wiring notes point at', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reconcile')
  it('payments.csv reads, and mapping.invoice.json is a valid declared mapping', async () => {
    const p = readPopulationCSV(readFileSync(join(dir, 'payments.csv')))
    expect(p.rows.length).toBeGreaterThan(0)
    const { effectiveCompletenessMapping } = await import('../src/reconcile/completeness/index')
    const m = effectiveCompletenessMapping(JSON.parse(readFileSync(join(dir, 'mapping.invoice.json'), 'utf8')))
    for (const col of Object.values(m.population.columns)) expect(p.columns).toContain(col)
  })
})
