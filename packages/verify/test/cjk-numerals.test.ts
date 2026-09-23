/**
 * CJK numeral-word amounts — Japanese/Chinese kanji numbers (万進 myriad system), including the Chinese FORMAL financial
 * numerals (大写: 壹貳參…), the anti-tamper forms used on invoices and checks. Deterministic; abstains (returns null / no
 * conversion) on anything malformed or out-of-order rather than guessing. Extends "numbers verify in any script" from
 * digits to number-WORDS — the multilingual TAM arm, for a top-5 economy (Japan) whose documents carry kanji amounts.
 */
import { describe, it, expect } from 'vitest'
import { parseCjkNumeral, normalizeAmount } from '../src/binding/forensic-normalizer'
import { verify, type DeclarativeRuleset } from '../src/index'

describe('parseCjkNumeral — well-formed', () => {
  const ok: [string, number][] = [
    ['一万', 10000],
    ['十五', 15],
    ['二十', 20],
    ['一百二十三', 123],
    ['一千零五', 1005],           // 零 as an internal placeholder
    ['一億二千三百四十五万六千七百八十九', 123456789],
    ['1億2000万', 120000000],     // mixed Arabic + kanji myriad
    ['1,234万', 12340000],        // comma stripped
    ['壹萬貳仟', 12000],           // formal financial (大写)
    ['〇', 0],
    ['三', 3],
    ['十万', 100000],
    ['壹億', 100000000],          // formal, with a digit before the myriad unit
  ]
  for (const [input, expected] of ok) {
    it(`${input} → ${expected}`, () => expect(parseCjkNumeral(input)).toBe(expected))
  }
})

describe('parseCjkNumeral — abstains (never guesses)', () => {
  const abstain = ['十百', '万億', '億万', 'abc', '1234', '', '一二三四円のうち', '百千', '万', '兆']
  for (const input of abstain) {
    it(`${input || '(empty)'} → null`, () => expect(parseCjkNumeral(input)).toBeNull())
  }
})

describe('normalizeAmount folds kanji amounts', () => {
  it('一万円 (10,000 yen) normalizes to 10000', () => {
    const n = normalizeAmount('一万円')
    expect(n?.success).toBe(true)
    expect(n?.normalized).toBe(10000)
    expect(n?.transformations).toContain('cjk_numerals_parsed')
  })
  it('formal 壹萬貳仟 normalizes to 12000', () => {
    expect(normalizeAmount('壹萬貳仟')?.normalized).toBe(12000)
  })
  it('a plain ASCII amount is untouched by the CJK path', () => {
    const n = normalizeAmount('1234.5')
    expect(n?.normalized).toBe(1234.5)
    expect(n?.transformations).not.toContain('cjk_numerals_parsed')
  })
})

describe('end-to-end: a kanji-written total foots', () => {
  // A minimal declarative ruleset: the stated grand total must equal subtotal + tax.
  const RS: DeclarativeRuleset = {
    id: 'jp-mini', version: '1', domain: 'e-invoice',
    fields: {
      SUBTOTAL: { paths: ['subtotal'] },
      TAX: { paths: ['tax'] },
      TOTAL: { paths: ['total'] },
    },
    checks: [{ code: 'FOOT', field: 'total', left: 'TOTAL', op: '=', right: 'SUBTOTAL + TAX' }],
  }
  it('a total written in kanji reconciles against Arabic operands', () => {
    // subtotal 100,000 + tax 10,000 = 110,000, the total stated as 十一万.
    const v = verify({ subtotal: 100000, tax: 10000, total: '十一万' }, { ruleset: RS, now: () => new Date('2026-09-22T00:00:00Z') })
    expect(v.outcome).toBe('PASS')
  })
  it('a wrong kanji total FAILs', () => {
    const v = verify({ subtotal: 100000, tax: 10000, total: '十二万' }, { ruleset: RS, now: () => new Date('2026-09-22T00:00:00Z') })
    expect(v.outcome).toBe('FAIL')
  })
})
