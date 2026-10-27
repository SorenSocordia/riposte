/**
 * action@0.2.0's comparison, case by case (src/action/equivalence.ts). The right value written differently is the same value;
 * every equivalence is typed by the argument, none is global. The rule was frozen before any data (pre-registration sha256
 * eab18209…, docs/ACTION-REPRESENTATION-2026-09-29.md). Synthetic values only.
 */
import { describe, it, expect } from 'vitest'
import {
  compareValues, comparisonFor, comparisonCode, comparisonFromCode, fieldsProblem, sameAsWritten, CURRENCY_SYMBOLS, type Comparison,
} from '../src/action/equivalence'
import type { Scalar } from '../src/verdict/schema'

const UNDECLARED: Comparison = { type: 'undeclared' }
const same = (a: Scalar, b: Scalar, c: Comparison): boolean => compareValues(a, b, c).kind !== 'different' && compareValues(b, a, c).kind !== 'different'
const differ = (a: Scalar, b: Scalar, c: Comparison): boolean => compareValues(a, b, c).kind === 'different' && compareValues(b, a, c).kind === 'different'
const ALL: Comparison[] = [UNDECLARED, { type: 'text' }, { type: 'amount' }, { type: 'amount', currency: 'USD' }, { type: 'identifier' },
  { type: 'identifier', case_insensitive: true, whitespace_insensitive: true }, { type: 'date' }, { type: 'date', order: 'DMY' },
  { type: 'rate', unit: 'fraction' }, { type: 'rate', unit: 'percent' }]

describe('identity holds under every type, so 0.2.0 never fails a comparison 0.1.0 passed', () => {
  it('equal as written (String(a) === String(b)) is identical under every comparison', () => {
    for (const c of ALL) {
      for (const [a, b] of [[500, '500'], ['INV-A-0001', 'INV-A-0001'], ['0012345', '0012345'], ['03/04/2026', '03/04/2026'], ['abc', 'abc'], [true, 'true']] as [Scalar, Scalar][]) {
        expect(compareValues(a, b, c), `${JSON.stringify(a)} vs ${JSON.stringify(b)} under ${comparisonCode(c)}`).toEqual({ kind: 'identical' })
      }
    }
    expect(sameAsWritten(980.5, '980.50')).toEqual({ kind: 'different' })
  })
})

describe('undeclared: a JSON number equals the same number written as a plain numeral, and nothing else', () => {
  it('the representation class: 980.5 and "980.50", either way round', () => {
    expect(compareValues(980.5, '980.50', UNDECLARED)).toEqual({ kind: 'equivalent', canonical: '980.5', steps: ['number and numeral'] })
    expect(compareValues('980.50', 980.5, UNDECLARED)).toEqual({ kind: 'equivalent', canonical: '980.5', steps: ['number and numeral'] })
    for (const [n, s] of [[900, '900.00'], [900, '900.0'], [-12.5, '-12.50'], [0, '0.00'], [0.1, '0.10'], [1234567.8, '1234567.80']] as [number, string][]) expect(same(n, s, UNDECLARED), `${n} vs ${s}`).toBe(true)
  })
  it('two strings are never compared as numbers without a declaration', () => {
    expect(differ('980.5', '980.50', UNDECLARED)).toBe(true)
  })
  it('forms that are not the JSON number grammar do not read: leading zero, plus, spaces, separators, symbols, exponent, comma decimal', () => {
    for (const s of ['0980.50', '+980.50', ' 980.50', '980.50 ', '980.', '.5', '9.805e2', '980,50', '$980.50', '980.50 USD', '1e21']) expect(differ(980.5, s, UNDECLARED), s).toBe(true)
    expect(differ(12345, '0012345', UNDECLARED)).toBe(true)
  })
  it('exact decimals, no floating point: a longer string is another number, negative zero does not read, exponents do not read', () => {
    expect(differ(980.5, '980.5000000000000001', UNDECLARED)).toBe(true)
    expect(differ(0.1, '0.1000000000000000055511151231257827', UNDECLARED)).toBe(true)
    expect(differ(0, '-0.00', UNDECLARED)).toBe(true)
    expect(differ(1e21, '1000000000000000000000', UNDECLARED)).toBe(true)
  })
  it('scale and sign never read as the same number', () => {
    for (const s of ['9805.00', '98.05', '98050.00', '0.98', '-980.50']) expect(differ(980.5, s, UNDECLARED), s).toBe(true)
  })
})

describe('text: as written, only', () => {
  it('turns the numeral rule off', () => {
    expect(differ(980.5, '980.50', { type: 'text' })).toBe(true)
  })
})

describe('amount: the same signed value, exactly', () => {
  const AMT: Comparison = { type: 'amount' }
  const USD: Comparison = { type: 'amount', currency: 'USD' }
  it('thousands separators, trailing zeros, a number or a numeral, outer whitespace', () => {
    for (const s of ['4,250.00', '4,250', '4250.0', ' 4250 ', '4,250.000']) expect(same(4250, s, AMT), s).toBe(true)
    expect(same('1,234,567.89', 1234567.89, AMT)).toBe(true)
    expect(same('980.5', '980.50', AMT)).toBe(true) // two strings: the field says it is an amount
  })
  it('a currency symbol or ISO code reads only against the declared currency, and only one that can denote it', () => {
    for (const s of ['$4,250.00', 'US$4,250.00', 'USD 4,250.00', '4,250.00 USD', '$ 4250', '4250$', '4250 $']) expect(same(4250, s, USD), s).toBe(true)
    for (const s of ['-$4,250.00', '$-4,250.00', 'USD -4,250.00', '-4,250.00 USD', '-USD 4250']) expect(same(-4250, s, USD), s).toBe(true)
    expect(same('€4.250', 4.25, { type: 'amount', currency: 'EUR' })).toBe(true)
    expect(same('¥5000', 5000, { type: 'amount', currency: 'JPY' })).toBe(true)
    expect(same('C$10.00', 10, { type: 'amount', currency: 'CAD' })).toBe(true)
    expect(differ('$4,250.00', 4250, AMT)).toBe(true) // no declared currency: a marker does not read
    expect(differ('€4,250.00', 4250, USD)).toBe(true)
    expect(differ('GBP 4250', 4250, USD)).toBe(true)
    expect(differ('C$4250', 4250, USD)).toBe(true)
    expect(differ('usd 4250', 4250, USD)).toBe(true) // a code is three capital letters
    expect(differ('$€4250', 4250, USD)).toBe(true)
    expect(differ('USD 4250 USD', 4250, USD)).toBe(true)
  })
  it('a comma is never a decimal mark; groups are three digits; other separators and parentheses do not read', () => {
    for (const s of ['4.250,00', '4250,00', '42,50', '4,25', '1,23,456', '4 250.00', "4'250.00", '(4250.00)', '4,250.5.0', '04250', '4250.', '- 4250', '--4250', '-$-4250']) {
      expect(differ(4250, s, USD), s).toBe(true)
    }
    expect(differ(4.25, '4,25', AMT)).toBe(true)
    expect(differ(1.234, '1,234', AMT)).toBe(true) // read as 1234, never as 1.234
  })
  it('scale and sign are never the same amount', () => {
    for (const s of ['42,500.00', '425.00', '$425,000', '-4,250.00', '-$4,250.00', '4,250,000']) expect(differ(4250, s, USD), s).toBe(true)
    expect(differ(0, '-0.00', AMT)).toBe(true)
  })
})

describe('identifier: case and whitespace only where declared; never a leading zero, never punctuation, never a number', () => {
  it('case-insensitive and whitespace-insensitive when declared', () => {
    expect(compareValues('INV-A-0001', 'inv-a-0001', { type: 'identifier', case_insensitive: true })).toEqual({ kind: 'equivalent', canonical: 'inv-a-0001', steps: ['case'] })
    expect(compareValues('DE89 3704 0044 0532 0130 00', 'DE89370400440532013000', { type: 'identifier', whitespace_insensitive: true })).toEqual({ kind: 'equivalent', canonical: 'DE89370400440532013000', steps: ['whitespace'] })
    expect(compareValues('de89 3704', 'DE893704', { type: 'identifier', case_insensitive: true, whitespace_insensitive: true })).toEqual({ kind: 'equivalent', canonical: 'de893704', steps: ['case', 'whitespace'] })
    expect(differ('INV-A-0001', 'inv-a-0001', { type: 'identifier' })).toBe(true)
    expect(differ('INV-A-0001', 'inv-a-0001', { type: 'identifier', whitespace_insensitive: true })).toBe(true)
    expect(differ('INV-A-0001', 'inv-a-0001', UNDECLARED)).toBe(true)
  })
  it('leading zeros, punctuation and numerals are never folded', () => {
    const ID: Comparison = { type: 'identifier', case_insensitive: true, whitespace_insensitive: true }
    for (const [a, b] of [['0012345', '12345'], ['0012345', 12345], ['110-234-5678', '1102345678'], ['A.B', 'AB'], ['12.50', 12.5], ['INV/1', 'INV1']] as [Scalar, Scalar][]) {
      expect(differ(a, b, ID), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true)
    }
  })
})

describe('date: the same calendar date; a numeric day-month form reads only in a declared order', () => {
  it('ISO, year-first with slashes, and month-name forms always read', () => {
    for (const s of ['3 April 2026', '3 april 2026', '03 April 2026', '3rd April 2026', '3 Apr 2026', '3 Apr. 2026', '3 April, 2026', 'April 3, 2026', 'Apr 3 2026', 'april 3rd, 2026', '2026/04/03', ' 2026-04-03 ']) {
      expect(same('2026-04-03', s, { type: 'date' }), s).toBe(true)
    }
    expect(same('Sept 9, 2026', '2026-09-09', { type: 'date' })).toBe(true)
    expect(same('29 Feb 2028', '2028-02-29', { type: 'date' })).toBe(true)
  })
  it('03/04/2026 is ambiguous: it never reads without a declared order, and reads only one way with one', () => {
    expect(differ('2026-04-03', '03/04/2026', { type: 'date' })).toBe(true)
    expect(differ('2026-03-04', '03/04/2026', { type: 'date' })).toBe(true)
    expect(differ('2026-03-25', '25/03/2026', { type: 'date' })).toBe(true) // even when a value above 12 would settle it
    expect(same('2026-04-03', '03/04/2026', { type: 'date', order: 'DMY' })).toBe(true)
    expect(differ('2026-03-04', '03/04/2026', { type: 'date', order: 'DMY' })).toBe(true)
    expect(same('2026-03-04', '03/04/2026', { type: 'date', order: 'MDY' })).toBe(true)
    expect(same('2026-04-03', '3.4.2026', { type: 'date', order: 'DMY' })).toBe(true)
  })
  it('two-digit years, times, weekdays, invalid dates, numbers and a dot after a full month name do not read', () => {
    for (const s of ['3 April 26', '03/04/26', '2026-04-03T00:00:00Z', '2026-04-03 00:00', 'Friday, 3 April 2026', '2026-4-3', '3 April. 2026', '3 Aprl 2026']) {
      expect(differ('2026-04-03', s, { type: 'date', order: 'DMY' }), s).toBe(true)
    }
    expect(differ('31 April 2026', '2026-05-01', { type: 'date' })).toBe(true)
    expect(differ('29 Feb 2026', '2026-03-01', { type: 'date' })).toBe(true)
    expect(differ(20260403, '2026-04-03', { type: 'date' })).toBe(true)
  })
})

describe('rate: percent and fraction, only in a declared unit', () => {
  it('in unit fraction, 12.5% is 0.125; in unit percent, a bare 12.5 is 12.5%', () => {
    for (const s of ['12.5%', '12.5 %', '12.50%', '0.125', '0.1250']) expect(same(0.125, s, { type: 'rate', unit: 'fraction' }), s).toBe(true)
    for (const s of ['12.5%', '12.5 %', '12.5', '12.50']) expect(same(12.5, s, { type: 'rate', unit: 'percent' }), s).toBe(true)
    expect(compareValues(0.125, '12.5%', { type: 'rate', unit: 'fraction' })).toEqual({ kind: 'equivalent', canonical: '0.125', steps: ['percent and fraction'] })
  })
  it('the unit settles the scale: a bare number is never read in the other unit', () => {
    expect(differ(0.125, 12.5, { type: 'rate', unit: 'fraction' })).toBe(true)
    expect(differ(0.125, '12.5', { type: 'rate', unit: 'fraction' })).toBe(true)
    expect(differ(12.5, 0.125, { type: 'rate', unit: 'percent' })).toBe(true)
    expect(differ('12.5%', 0.125, { type: 'rate', unit: 'percent' })).toBe(true)
  })
  it('undeclared, and forms other than a numeral with %, never read as percent', () => {
    expect(differ(0.125, '12.5%', UNDECLARED)).toBe(true)
    for (const s of ['12.5 per cent', '12.5  %', '1250 bps', '125‰', '%12.5', '-0%']) expect(differ(0.125, s, { type: 'rate', unit: 'fraction' }), s).toBe(true)
  })
})

describe('declarations', () => {
  it('fieldsProblem accepts every valid type and names the first invalid one', () => {
    expect(fieldsProblem({ a: { type: 'text' }, b: { type: 'amount' }, c: { type: 'amount', currency: 'EUR' }, d: { type: 'identifier', case_insensitive: true, whitespace_insensitive: false }, e: { type: 'date', order: 'MDY' }, f: { type: 'rate', unit: 'percent' } })).toBeUndefined()
    const bad: [unknown, RegExp][] = [
      ['amount', /must be \{ <argument>/], [[], /must be \{ <argument>/], [{ a: 'amount' }, /^\.a must be an object/],
      [{ a: { type: 'money' } }, /^\.a type must be one of/], [{ a: { type: 'amount', currency: 'usd' } }, /currency must be an ISO 4217 code/],
      [{ a: { type: 'amount', currency: 'USD', scale: 100 } }, /unknown key "scale"/], [{ a: { type: 'identifier', case_insensitive: 'yes' } }, /case_insensitive must be true or false/],
      [{ a: { type: 'date', order: 'YMD' } }, /order must be "DMY" or "MDY"/], [{ a: { type: 'rate' } }, /unit must be "percent" or "fraction"/],
    ]
    for (const [f, why] of bad) expect(fieldsProblem(f), JSON.stringify(f)).toMatch(why)
  })
  it('an argument not declared is undeclared; an invalid declaration, or fields that are not an object, compare as text (can only fail)', () => {
    expect(comparisonFor(undefined, 'amount')).toEqual({ type: 'undeclared' })
    expect(comparisonFor({ other: { type: 'text' } }, 'amount')).toEqual({ type: 'undeclared' })
    expect(comparisonFor({ amount: { type: 'amount', currency: 'dollars' } }, 'amount')).toEqual({ type: 'text' })
    expect(comparisonFor('amount', 'amount')).toEqual({ type: 'text' })
    expect(comparisonFor({ amount: { type: 'rate', unit: 'fraction' } }, 'amount')).toEqual({ type: 'rate', unit: 'fraction' })
  })
  it('every comparison has a code that names it exactly, and unknown codes name nothing', () => {
    const all: Comparison[] = [...ALL, { type: 'identifier', case_insensitive: true }, { type: 'identifier', whitespace_insensitive: true }, { type: 'date', order: 'MDY' }]
    for (const c of all) expect(comparisonFromCode(comparisonCode(c)), comparisonCode(c)).toEqual(c)
    for (const code of ['amount:usd', 'identifier:whitespace,case', 'date:YMD', 'rate', 'money', 5, undefined]) expect(comparisonFromCode(code)).toBeUndefined()
  })
  it('the currency symbol table names only ISO codes', () => {
    for (const [sym, codes] of Object.entries(CURRENCY_SYMBOLS)) for (const c of codes) expect(c, sym).toMatch(/^[A-Z]{3}$/)
  })
})
