/**
 * Cell provenance (src/tables): SYNTHETIC tables only. The value and period checks, scale, signs, duplicate labels,
 * abstain vs strict, spans that point at the cited cell, and determinism.
 */
import { describe, it, expect } from 'vitest'
import { verifyCellCitations, parseTableText, parseCellNumber, tableScale, headerDate, type CellCitation } from '../src/index'

const DOC = [
  'TABLE: CONSOLIDATED BALANCE SHEETS - USD ($) $ in Thousands',
  'COLUMNS: Dec. 31, 2025 | Dec. 31, 2024',
  'Current assets: |  | ',
  'Cash and cash equivalents | $ 36,533 | $ 27,742',
  'Total current assets | 68,576 | 66,205',
  'Total assets | 190,120 | 181,004',
  'Other | 1,200 | 900',
  'Other | 3,400 | 2,100',
  'Total liabilities and stockholders\' equity | $ 190,120 | $ 181,004',
  '',
  'TABLE: CONSOLIDATED STATEMENTS OF OPERATIONS - USD ($) shares in Thousands, $ in Millions',
  'COLUMNS: 12 Months Ended Dec. 31, 2025 | 12 Months Ended Dec. 31, 2024',
  'Revenues | $ 191.4 | $ 198.9',
  'Income (loss) from operations | (9.3) | 3.8',
  'Net income | 1 | —',
  '',
  'TABLE: CASH FLOWS - USD ($)',
  'COLUMNS: 12 Months Ended Dec. 31, 2025',
  'Net cash provided by operating activities | $ 1,121,625,000',
].join('\n')

const BS = 'CONSOLIDATED BALANCE SHEETS - USD ($) $ in Thousands'
const IS = 'CONSOLIDATED STATEMENTS OF OPERATIONS - USD ($) shares in Thousands, $ in Millions'
const cite = (field: string, value: number, table: string, row: string, column: string): CellCitation => ({ id: field, field, value, table, row, column })
const out = (claims: { claim_id: string; outcome: string }[], id: string) => claims.find((c) => c.claim_id === id)?.outcome

describe('parsing', () => {
  it('tables, scale, columns, rows, and spans that point at the cells', () => {
    const t = parseTableText(DOC)
    expect(t.map((x) => [x.scale, x.columns.length, x.rows.length])).toEqual([[1e3, 2, 7], [1e6, 2, 3], [1, 1, 1]])
    const cash = t[0]!.rows[1]!
    expect(cash.label).toBe('Cash and cash equivalents')
    expect(DOC.slice(cash.cellSpans[0]!.start, cash.cellSpans[0]!.end)).toBe('$ 36,533')
    expect(DOC.slice(cash.cellSpans[1]!.start, cash.cellSpans[1]!.end)).toBe('$ 27,742')
  })
  it('cell numbers: $, commas, parentheses, decimals; blanks, dashes and text are null', () => {
    expect([parseCellNumber('$ 36,533'), parseCellNumber('(9.3)'), parseCellNumber('$ (1,234)'), parseCellNumber('12.5'), parseCellNumber('0')]).toEqual([36533, -9.3, -1234, 12.5, 0])
    expect([parseCellNumber(''), parseCellNumber('—'), parseCellNumber('n/a'), parseCellNumber('1,23')]).toEqual([null, null, null, null])
  })
  it('scale only from "$ in …" (not "shares in …"); dates from headers', () => {
    expect([tableScale('X - USD ($) shares in Thousands'), tableScale(IS), tableScale('Y $ in Billions')]).toEqual([1, 1e6, 1e9])
    expect(headerDate('12 Months Ended Dec. 31, 2025')?.toISOString().slice(0, 10)).toBe('2025-12-31')
    expect(headerDate('Sept. 28, 2024')?.toISOString().slice(0, 10)).toBe('2024-09-28')
    expect(headerDate('12 Months Ended')).toBeNull()
  })
})

describe('CELL_VALUE and CELL_PERIOD', () => {
  const opts = { periodEnd: '2025-12-31' }
  it('a correct citation PASSes both, scaled from thousands and millions, with the cell as evidence', () => {
    const r = verifyCellCitations(DOC, [cite('cash', 36_533_000, BS, 'Cash and cash equivalents', 'Dec. 31, 2025'), cite('revenue', 191_400_000, IS, 'Revenues', '12 Months Ended Dec. 31, 2025')], opts)
    expect(r.claims.map((c) => c.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
    const ev = r.claims[0]!.evidence[0]!
    expect(ev.locator).toMatchObject({ kind: 'span', source_hash: r.source_hash, line: 4 })
    expect(ev.value).toBe('$ 36,533')
  })
  it('the classic agent errors FAIL: misread digits, a dropped sign, a missed scale, the prior-year column', () => {
    const r = verifyCellCitations(DOC, [
      cite('cash', 36_353_000, BS, 'Cash and cash equivalents', 'Dec. 31, 2025'),                  // transposed
      cite('op', 9_300_000, IS, 'Income (loss) from operations', '12 Months Ended Dec. 31, 2025'),   // sign dropped
      cite('assets', 190_120, BS, 'Total assets', 'Dec. 31, 2025'),                                   // scale missed
      cite('assets_py', 181_004_000, BS, 'Total assets', 'Dec. 31, 2024'),                            // wrong column
    ], opts).claims
    expect(out(r, 'cash.value')).toBe('FAIL')
    expect(r.find((c) => c.claim_id === 'cash.value')!.variance).toBe(36_353_000 - 36_533_000)
    expect(out(r, 'op.value')).toBe('FAIL')
    expect(out(r, 'assets.value')).toBe('FAIL')
    expect(out(r, 'assets_py.value')).toBe('PASS')   // the cell holds it...
    expect(out(r, 'assets_py.period')).toBe('FAIL')  // ...but it is the wrong year
  })
  it('a real cell of the wrong concept is NOT caught here (that is the identities\' job)', () => {
    const r = verifyCellCitations(DOC, [cite('cash', 68_576_000, BS, 'Total current assets', 'Dec. 31, 2025')], opts)
    expect(r.claims.map((c) => c.outcome)).toEqual(['PASS', 'PASS'])
  })
  it('duplicate labels: the citation holds if any row with that label holds the value', () => {
    const r = verifyCellCitations(DOC, [cite('o1', 3_400_000, BS, 'Other', 'Dec. 31, 2025'), cite('o2', 5_000_000, BS, 'Other', 'Dec. 31, 2025')], opts).claims
    expect(out(r, 'o1.value')).toBe('PASS')
    expect(out(r, 'o2.value')).toBe('FAIL')
  })
  it('a citation that points at nothing abstains by default and FAILs in strict mode; so does a non-numeric cell', () => {
    const bad = [cite('a', 1, 'NO SUCH TABLE', 'x', 'y'), cite('b', 1, BS, 'No such row', 'Dec. 31, 2025'), cite('c', 1, BS, 'Total assets', 'Dec. 31, 2099'), cite('d', 1, IS, 'Net income', '12 Months Ended Dec. 31, 2024')]
    const soft = verifyCellCitations(DOC, bad).claims
    expect(soft.map((c) => c.outcome)).toEqual(['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'])
    expect(soft[0]!.insufficiency!.reason).toBe('SPAN_NOT_FOUND')
    const hard = verifyCellCitations(DOC, bad, { strict: true }).claims
    expect(hard.map((c) => c.outcome)).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL'])
  })
  it('matching is whitespace- and case-insensitive; the period check allows a 52/53-week year end', () => {
    const r = verifyCellCitations(DOC, [cite('cash', 36_533_000, BS.toLowerCase(), '  cash and  cash equivalents ', 'dec. 31, 2025')], { periodEnd: '2025-12-27' }).claims
    expect(r.map((c) => c.outcome)).toEqual(['PASS', 'PASS'])
    expect(verifyCellCitations(DOC, [cite('cash', 36_533_000, BS, 'Cash and cash equivalents', 'Dec. 31, 2025')], { periodEnd: '2025-12-20' }).claims[1]!.outcome).toBe('FAIL')
  })
  it('deterministic: same input, same claims, same source hash', () => {
    const c = [cite('cash', 36_533_000, BS, 'Cash and cash equivalents', 'Dec. 31, 2025')]
    expect(JSON.stringify(verifyCellCitations(DOC, c, opts))).toBe(JSON.stringify(verifyCellCitations(DOC, c, opts)))
  })
})

// ── v2 (EXTRACT-1's diagnosis): agents copy a label's words, not its glyphs, and shorten long titles ─────────────────
describe('v2 matching: typography, unique containment, date-only columns, sign convention, filer-heading scale', () => {
  const DOC2 = [
    'TABLE: Consolidated Balance Sheets - USD ($) $ in Thousands',
    'COLUMNS: 12 Months Ended Dec. 31, 2024 | Dec. 31, 2023',
    'Total stockholders’ equity | 9,924 | 8,100',
    'Total liabilities and stockholders’ equity | 50,000 | 41,000',
    '',
    'TABLE: Consolidated Statements of Operations - USD ($) $ in Thousands',
    'COLUMNS: 12 Months Ended Dec. 31, 2024 | 12 Months Ended Dec. 31, 2023',
    'Operating loss | 111,439 | 13,671',
    '',
    'TABLE: Consolidated Statements of Operations (Parenthetical) - USD ($)',
    'COLUMNS: 12 Months Ended Dec. 31, 2024',
    'Operating loss | 5 ',
  ].join('\n')
  const pe = { periodEnd: '2024-12-31', strict: true }
  it("a straight apostrophe matches a curly one; a shortened title and a date-only column resolve when unique", () => {
    const r = verifyCellCitations(DOC2, [{ id: 'eq', field: 'equity', value: 9_924_000, table: 'Consolidated Balance Sheets', row: "Total stockholders' equity", column: 'Dec. 31, 2024' }], pe).claims
    expect(r.map((c) => c.outcome)).toEqual(['PASS', 'PASS'])
  })
  it('an ambiguous shortened title is not a match (two tables contain it)', () => {
    const r = verifyCellCitations(DOC2, [{ id: 'op', field: 'operating_income', value: 111_439_000, table: 'Consolidated Statements of Operations', row: 'Operating loss', column: '12 Months Ended Dec. 31, 2024' }], pe).claims
    expect(r[0]!.outcome).toBe('FAIL')
    expect(r[0]!.explanation).toMatch(/cited table/)
  })
  it("signConvention 'either': the economic sign of a loss PASSes (noted); by default it FAILs", () => {
    const cite = [{ id: 'op', field: 'operating_income', value: -111_439_000, table: 'Consolidated Statements of Operations - USD ($) $ in Thousands', row: 'Operating loss', column: '12 Months Ended Dec. 31, 2024' }]
    expect(verifyCellCitations(DOC2, cite, pe).claims[0]!.outcome).toBe('FAIL')
    const either = verifyCellCitations(DOC2, cite, { ...pe, signConvention: 'either' }).claims[0]!
    expect(either.outcome).toBe('PASS')
    expect(either.explanation).toMatch(/sign reversed/)
    // a wrong magnitude still FAILs under 'either'
    expect(verifyCellCitations(DOC2, [{ ...cite[0]!, value: -111_493_000 }], { ...pe, signConvention: 'either' }).claims[0]!.outcome).toBe('FAIL')
  })
  it("the scale in a filer's own heading, never from 'shares in …'", () => {
    expect(tableScale('CONSOLIDATED BALANCE SHEETS (Amounts in thousands, except share and per share data)')).toBe(1e3)
    expect(tableScale('CONSOLIDATED STATEMENTS OF OPERATIONS (In millions, except per share amounts)')).toBe(1e6)
    expect(tableScale('STATEMENTS (shares in thousands)')).toBe(1)
    expect(tableScale('X - USD ($) shares in Thousands, $ in Millions')).toBe(1e6)
  })
})

describe('v2 period check on a year-only header (a filer\'s own layout: "Years Ended December 31," over "2024")', () => {
  const DOC3 = ['TABLE: STATEMENTS OF OPERATIONS (In thousands)', 'COLUMNS: 2024 | 2023', 'Revenues | $ 1,000 | $ 900'].join('\n')
  it('PASSes on the period year, FAILs on another year', () => {
    const c = (column: string, value: number) => [{ id: 'r', field: 'revenue', value, table: 'STATEMENTS OF OPERATIONS (In thousands)', row: 'Revenues', column }]
    expect(verifyCellCitations(DOC3, c('2024', 1_000_000), { periodEnd: '2024-12-31', strict: true }).claims.map((x) => x.outcome)).toEqual(['PASS', 'PASS'])
    expect(verifyCellCitations(DOC3, c('2023', 900_000), { periodEnd: '2024-12-31', strict: true }).claims.map((x) => x.outcome)).toEqual(['PASS', 'FAIL'])
  })
})

describe('v3: the unit printed in the column headers', () => {
  it('"December 31, 2024 (in thousands, except per share amount)" sets the scale when the title has none', () => {
    const doc = ['TABLE: TERADYNE, INC. CONSOLIDATED BALANCE SHEETS', 'COLUMNS: December 31, 2024 (in thousands, except per share amount) | December 31, 2023 (in thousands, except per share amount)', 'Total assets | $ 3,708,714 | $ 3,486,824'].join('\n')
    expect(parseTableText(doc)[0]!.scale).toBe(1e3)
    const r = verifyCellCitations(doc, [{ id: 'a', field: 'assets', value: 3_708_714_000, table: 'TERADYNE, INC. CONSOLIDATED BALANCE SHEETS', row: 'Total assets', column: 'December 31, 2024 (in thousands, except per share amount)' }], { periodEnd: '2024-12-31', strict: true }).claims
    expect(r.map((c) => c.outcome)).toEqual(['PASS', 'PASS'])
  })
  it('a title scale is not overridden by a header, and a header "shares in thousands" is not a dollar scale', () => {
    expect(parseTableText(['TABLE: X $ in Millions', 'COLUMNS: 2024 (in thousands)', 'a | 1'].join('\n'))[0]!.scale).toBe(1e6)
    expect(parseTableText(['TABLE: X', 'COLUMNS: 2024 (shares in thousands)', 'a | 1'].join('\n'))[0]!.scale).toBe(1)
  })
})
