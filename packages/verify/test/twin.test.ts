/**
 * Structured-twin mode (src/twin): SYNTHETIC inline-XBRL only. The reader (contexts, units, formats, scale, sign, nil,
 * nesting, namespaces), the four mapping layers (concept priority, period incl. 52/53-week and prior instant, scale,
 * sign-not-judged), every FAIL diagnosis and ABSTAIN reason, evidence spans into the twin, and determinism / replay.
 */
import { describe, it, expect } from 'vitest'
import {
  parseInlineXbrl, parseIxNumber, verifyAgainstTwin, bindTwinFields, twinGate, twinVerdictInput, FS_CORE_TWIN_MAP,
  type TwinClaim, type TwinJudgment,
} from '../src/twin/index'
import { verifyReplay } from '../src/protocol/replay'

const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"',
  'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"',
  'xmlns:us-gaap="http://fasb.org/us-gaap/2024"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
  'xmlns:xbrldi="http://xbrl.org/2006/xbrldi"',
  'xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"',
  'xmlns:ixt-sec="http://www.sec.gov/inlineXBRL/transformation/2015-08-31"',
  'xmlns:abc="http://abc.example.com/20241231"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
].join(' ')

const ctxI = (id: string, d: string, member?: string): string =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier>${member ? `<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">${member}</xbrldi:explicitMember></xbrli:segment>` : ''}</xbrli:entity><xbrli:period><xbrli:instant>${d}</xbrli:instant></xbrli:period></xbrli:context>`
const ctxD = (id: string, s: string, e: string): string =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`
const UNITS = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'
  + '<xbrli:unit id="eur"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>'
  + '<xbrli:unit id="usdPerShare"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>'

/** One tagged number: a td with the ix element (attributes as given) around the displayed text. */
const nf = (name: string, ctx: string, text: string, a: Record<string, string> = {}): string => {
  const attrs = { unitRef: 'usd', decimals: '-3', scale: '3', format: 'ixt:num-dot-decimal', ...a }
  return `<td>${a.sign === '-' ? '(' : ''}<ix:nonFraction name="${name}" contextRef="${ctx}" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${text}</ix:nonFraction>${a.sign === '-' ? ')' : ''}</td>`
}

function twinDoc(contexts: string[], body: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
    + `<div style="display:none"><ix:header><ix:resources>${contexts.join('')}${UNITS}</ix:resources></ix:header></div>`
    + `<table>${body.map((r) => `<tr>${r}</tr>`).join('')}</table></body></html>`
}

// A 52-week fiscal year ending Saturday 2024-12-28 (nominal period end 2024-12-31).
const CONTEXTS = [
  ctxI('c-I24', '2024-12-28'), ctxI('c-I23', '2023-12-30'),
  ctxD('c-D24', '2023-12-31', '2024-12-28'), ctxD('c-D23', '2023-01-01', '2023-12-30'),
  ctxI('c-I24-seg', '2024-12-28', 'abc:RetailMember'),
]
const BODY = [
  `<td>Total assets</td>${nf('us-gaap:Assets', 'c-I24', '<span style="font-weight:bold">1,234,567</span>')}${nf('us-gaap:Assets', 'c-I23', '1,100,000')}`,
  // the same total, rounded to millions in a note: a CONSISTENT duplicate
  `<td>Total assets (note)</td>${nf('us-gaap:Assets', 'c-I24', '1,235', { scale: '6', decimals: '-6' })}`,
  `<td>Total liabilities and equity</td>${nf('us-gaap:LiabilitiesAndStockholdersEquity', 'c-I24', '1,234,567')}`,
  `<td>Total stockholders’ deficit</td>${nf('us-gaap:StockholdersEquity', 'c-I24', '5,000', { sign: '-' })}`,
  `<td>Total current assets</td>${nf('us-gaap:AssetsCurrent', 'c-I24', '600,000')}${nf('us-gaap:AssetsCurrent', 'c-I24-seg', '100,000')}`,
  // two facts for one concept and period that DISAGREE
  `<td>Total current liabilities</td>${nf('us-gaap:LiabilitiesCurrent', 'c-I24', '300,000')}${nf('us-gaap:LiabilitiesCurrent', 'c-I24', '310,000')}`,
  `<td>Cash (euro)</td>${nf('us-gaap:CashAndCashEquivalentsAtCarryingValue', 'c-I24', '42,000', { unitRef: 'eur' })}`,
  `<td>Revenue</td>${nf('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'c-D24', '900,000')}${nf('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'c-D23', '800,000')}`,
  `<td>Total costs and expenses</td>${nf('abc:TotalCostsAndExpenses', 'c-D24', '850,000')}`,
  `<td>Operating loss</td>${nf('us-gaap:OperatingIncomeLoss', 'c-D24', '50,000', { sign: '-' })}`,
  `<td>Income tax</td>${nf('us-gaap:IncomeTaxExpenseBenefit', 'c-D24', '—', { format: 'ixt:fixed-zero' })}`,
  `<td>Net income</td>${nf('us-gaap:ProfitLoss', 'c-D24', '120,000')}`,
  `<td>Net income attributable to parent</td>${nf('us-gaap:NetIncomeLoss', 'c-D24', '110,000')}`,
  `<td>Cash, end</td>${nf('us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'c-I24', '80,000')}`,
  `<td>Cash, beginning</td>${nf('us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'c-I23', '70,000')}`,
  `<td>EPS</td>${nf('us-gaap:EarningsPerShareBasic', 'c-D24', '1.23', { unitRef: 'usdPerShare', decimals: '2', scale: '0' })}`,
  `<td>Gross profit</td><td><ix:nonFraction name="us-gaap:GrossProfit" contextRef="c-D24" unitRef="usd" decimals="-3" xsi:nil="true"/></td>`,
  `<td>Other assets</td>${nf('us-gaap:OtherAssetsNoncurrent', 'c-I24', 'n/a')}`,
  `<td>Other (comma decimal)</td>${nf('us-gaap:OtherAssetsCurrent', 'c-I24', '1.234,5', { format: 'ixt:num-comma-decimal', scale: '0', decimals: '1' })}`,
  `<td>Goodwill</td>${nf('us-gaap:Goodwill', 'c-I24', 'none', { format: 'ixt-sec:numwordsen', scale: '0', decimals: 'INF' })}`,
]
const HTML = twinDoc(CONTEXTS, BODY)
const OPTS = { periodEnd: '2024-12-31', now: () => new Date('2026-09-28T12:00:00Z') }

const judge = (claims: TwinClaim[], html = HTML): TwinJudgment[] => verifyAgainstTwin(html, claims, OPTS).judgments
const one = (field: string, value: number, html = HTML): TwinJudgment => judge([{ id: field, field, value }], html)[0]!

describe('parseInlineXbrl: reading the twin', () => {
  const tw = parseInlineXbrl(HTML)
  it('reads contexts (instant, duration, dimensional) and units (USD only when a single iso4217:USD measure)', () => {
    expect(tw.contexts.size).toBe(5)
    expect(tw.contexts.get('c-D24')).toMatchObject({ start: '2023-12-31', end: '2024-12-28', dimensional: false })
    expect(tw.contexts.get('c-I24-seg')).toMatchObject({ instant: '2024-12-28', dimensional: true, members: ['us-gaap:StatementBusinessSegmentsAxis=abc:RetailMember'] })
    expect(tw.units.get('usd')!.usd).toBe(true)
    expect(tw.units.get('eur')!.usd).toBe(false)
    expect(tw.units.get('usdPerShare')!.usd).toBe(false)
  })
  it('applies scale, sign and format; counts nil and unparseable facts instead of dropping them silently', () => {
    const v = (name: string, ctx: string): number[] => tw.facts.filter((f) => f.qname === name && f.contextRef === ctx).map((f) => f.value)
    expect(v('us-gaap:Assets', 'c-I24')).toEqual([1_234_567_000, 1_235_000_000])
    expect(v('us-gaap:StockholdersEquity', 'c-I24')).toEqual([-5_000_000])
    expect(v('us-gaap:IncomeTaxExpenseBenefit', 'c-D24')).toEqual([0])
    expect(v('us-gaap:OtherAssetsCurrent', 'c-I24')).toEqual([1234.5])
    expect(v('us-gaap:Goodwill', 'c-I24')).toEqual([0])
    expect(tw.facts.find((f) => f.qname === 'us-gaap:Goodwill')!.decimals).toBe(Infinity)
    expect(tw.stats.nil).toBe(1)
    expect(tw.stats.unparseable).toBe(1)
    expect(tw.stats.nonFraction).toBe(tw.facts.length + 2)
  })
  it('keeps what a reader sees (nested tags stripped) and a span onto the element', () => {
    const f = tw.facts.find((x) => x.qname === 'us-gaap:Assets')!
    expect(f.displayed).toBe('1,234,567')
    expect(HTML.slice(f.span.start, f.span.end)).toMatch(/^<ix:nonFraction name="us-gaap:Assets"[\s\S]*1,234,567<\/span><\/ix:nonFraction>$/)
  })
  it('resolves concepts by namespace, not by the prefix string', () => {
    const gaapAlias = HTML.replace('xmlns:us-gaap="http://fasb.org/us-gaap/2024"', 'xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:gaap="http://fasb.org/us-gaap/2024"')
      .replace('name="us-gaap:Assets" contextRef="c-I24"', 'name="gaap:Assets" contextRef="c-I24"')
    expect(one('assets', 1_234_567_000, gaapAlias).outcome).toBe('PASS')
    // "us-gaap:" bound to a non-FASB namespace is not US-GAAP
    const impostor = HTML.replace('xmlns:us-gaap="http://fasb.org/us-gaap/2024"', 'xmlns:us-gaap="http://impostor.example.com/2024"')
    expect(one('assets', 1_234_567_000, impostor)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_BINDING_FACT' })
  })
})

describe('parseIxNumber: formats', () => {
  it('reads the num-dot-decimal and num-comma-decimal families, zero formats and small number words', () => {
    expect(parseIxNumber('1,234.56', 'num-dot-decimal')).toBe(1234.56)
    expect(parseIxNumber('(1,234)', 'numdotdecimal')).toBe(1234)
    expect(parseIxNumber('1 234', '')).toBe(1234)
    expect(parseIxNumber('1.234.567,8', 'num-comma-decimal')).toBe(1234567.8)
    expect(parseIxNumber('—', 'fixed-zero')).toBe(0)
    expect(parseIxNumber('-', 'zerodash')).toBe(0)
    expect(parseIxNumber('three', 'numwordsen')).toBe(3)
  })
  it('refuses what the declared format cannot read', () => {
    expect(parseIxNumber('—', 'num-dot-decimal')).toBeNull()
    expect(parseIxNumber('n/a', 'num-dot-decimal')).toBeNull()
    expect(parseIxNumber('many', 'numwordsen')).toBeNull()
    expect(parseIxNumber('12 March 2024', 'date-day-monthname-year-en')).toBeNull()
  })
})

describe('verifyAgainstTwin: PASS', () => {
  it('matches the binding fact, choosing the most precise of consistent duplicates (52-week year within tolerance)', () => {
    const j = one('assets', 1_234_567_000)
    expect(j).toMatchObject({ outcome: 'PASS', reason: 'MATCH', cell: 'BS.totals', sign_matches_xbrl: true })
    expect(j.binding).toMatchObject({ concept: 'Assets', context: 'c-I24', period: '2024-12-28', value: 1_234_567_000, decimals: -3, scale: 3, duplicates: 2 })
  })
  it('does not judge sign: the displayed (parenthesised) figure and the economic one both PASS, with a note', () => {
    expect(one('equity', -5_000_000)).toMatchObject({ outcome: 'PASS', sign_matches_xbrl: true })
    expect(one('equity', 5_000_000)).toMatchObject({ outcome: 'PASS', sign_matches_xbrl: false })
    expect(one('operating_income', -50_000_000)).toMatchObject({ outcome: 'PASS', sign_matches_xbrl: true })
  })
  it('falls through the concept priority list (Revenues absent → RevenueFromContractWithCustomer…)', () => {
    expect(one('revenue', 900_000_000)).toMatchObject({ outcome: 'PASS', binding: { concept: 'RevenueFromContractWithCustomerExcludingAssessedTax', period: '2023-12-31..2024-12-28' } })
  })
  it('binds the prior instant for beginning cash and the period-end instant for ending cash', () => {
    expect(one('ending_cash', 80_000_000)).toMatchObject({ outcome: 'PASS', binding: { period: '2024-12-28' } })
    expect(one('beginning_cash', 70_000_000)).toMatchObject({ outcome: 'PASS', binding: { period: '2023-12-30' } })
  })
  it('reads a fixed-zero dash as zero', () => {
    expect(one('income_tax_expense', 0)).toMatchObject({ outcome: 'PASS', binding: { value: 0, displayed: '—' } })
  })
})

describe('verifyAgainstTwin: FAIL, with a diagnosis', () => {
  it('SCALE: reported in thousands instead of dollars', () => {
    expect(one('assets', 1_234_567)).toMatchObject({ outcome: 'FAIL', reason: 'MISMATCH', diagnosis: 'SCALE' })
  })
  it('PERIOD: the prior year\'s figure', () => {
    const j = one('assets', 1_100_000_000)
    expect(j).toMatchObject({ outcome: 'FAIL', diagnosis: 'PERIOD' })
    expect(j.matches![0]).toMatchObject({ concept: 'Assets', period: '2023-12-30' })
    expect(one('beginning_cash', 80_000_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'PERIOD' })
  })
  it('CONCEPT: a real fact of another concept (net income attributable to the parent; a custom extension line)', () => {
    const j = one('net_income', 110_000_000)
    expect(j).toMatchObject({ outcome: 'FAIL', diagnosis: 'CONCEPT', binding: { concept: 'ProfitLoss', value: 120_000_000 } })
    expect(j.matches!.map((m) => m.concept)).toEqual(['NetIncomeLoss'])
    expect(one('revenue', 850_000_000).matches!.map((m) => m.concept)).toEqual(['TotalCostsAndExpenses'])
  })
  it('DIMENSION: a segment member\'s figure, not the consolidated one', () => {
    expect(one('current_assets', 100_000_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'DIMENSION' })
  })
  it('UNLOCATED: a number the twin reports nowhere', () => {
    expect(one('assets', 999)).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
})

describe('verifyAgainstTwin: ABSTAIN, always with a reason (never a flag)', () => {
  it('NO_BINDING_FACT: the field\'s concepts are absent (a custom extension line is not guessed at)', () => {
    expect(one('operating_expenses', 850_000_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_BINDING_FACT' })
  })
  it('CONFLICTING_FACTS: two facts for one concept and period disagree', () => {
    expect(one('current_liabilities', 300_000_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'CONFLICTING_FACTS' })
  })
  it('NO_USD_FACT: the concept is reported only in another currency', () => {
    expect(one('cash', 42_000_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_USD_FACT' })
  })
  it('FIELD_NOT_MAPPED and VALUE_UNPARSEABLE', () => {
    expect(one('ebitda', 1)).toMatchObject({ outcome: 'ABSTAIN', reason: 'FIELD_NOT_MAPPED', cell: null })
    expect(one('assets', Number.NaN)).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
  })
  it('PERIOD_UNRESOLVED: no fiscal-year duration context at all', () => {
    const instantsOnly = twinDoc([ctxI('c-I24', '2024-12-28')], [`<td>Total assets</td>${nf('us-gaap:Assets', 'c-I24', '1,234,567')}`])
    expect(one('revenue', 900_000_000, instantsOnly)).toMatchObject({ outcome: 'ABSTAIN', reason: 'PERIOD_UNRESOLVED' })
    expect(one('assets', 1_234_567_000, instantsOnly).outcome).toBe('PASS')
  })
  it('NO_TWIN: a document with no facts for this period (or none at all)', () => {
    expect(one('assets', 1, '<html><body><table><tr><td>Total assets</td><td>1</td></tr></table></body></html>')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_TWIN' })
    expect(verifyAgainstTwin(HTML, [{ id: 'a', field: 'assets', value: 1_234_567_000 }], { ...OPTS, periodEnd: '2021-12-31' }).judgments[0]).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_TWIN' })
  })
})

describe('the verdict: a standard verify proof object', () => {
  const claims: TwinClaim[] = [
    { id: 'x.assets', field: 'assets', value: 1_234_567_000 },
    { id: 'x.net_income', field: 'net_income', value: 110_000_000 },
    { id: 'x.cash', field: 'cash', value: 42_000_000 },
  ]
  const r = verifyAgainstTwin(HTML, claims, OPTS)
  it('aggregates ANY_FAIL_FAILS, with coverage, and obeys the claim rules (evidence on PASS/FAIL, insufficiency on abstain)', () => {
    expect(r.verdict.outcome).toBe('FAIL')
    expect(r.verdict.coverage).toEqual({ claims_total: 3, claims_checked: 2, claims_pass: 1, claims_fail: 1, claims_insufficient: 1 })
    expect(r.verdict.ruleset).toEqual({ id: 'twin-xbrl-fs-core', version: '0.1.0', domain: 'financial-statements' })
    for (const c of r.verdict.claims) {
      if (c.outcome === 'INSUFFICIENT_DATA') { expect(c.evidence).toEqual([]); expect(c.insufficiency!.reason).toBe('AMBIGUOUS_UNIT'); expect(c.insufficiency!.detail).toMatch(/^NO_USD_FACT: /) }
      else { expect(c.evidence.length).toBeGreaterThan(0); expect(c.computation!.result).toBeTypeOf('number') }
    }
    const pass = r.verdict.claims.find((c) => c.outcome === 'PASS')!
    const span = pass.evidence[0]!.locator as { kind: 'span'; source_hash: string; start: number; end: number }
    expect(span.source_hash).toBe(r.twin.sha256)
    expect(HTML.slice(span.start, span.end)).toContain('1,234,567')
    expect(pass.evidence[0]!.normalizations).toEqual(['ix:scale=3', 'ix:format=num-dot-decimal'])
    expect(r.verdict.claims.find((c) => c.outcome === 'FAIL')!.variance).toBe(-10_000_000)
  })
  it('is deterministic: identical inputs give a byte-identical verdict; verdict_id ignores the clock; replay binds the inputs', () => {
    const again = verifyAgainstTwin(HTML, claims, OPTS)
    expect(JSON.stringify(again)).toBe(JSON.stringify(r))
    const later = verifyAgainstTwin(parseInlineXbrl(HTML), claims, { ...OPTS, now: () => new Date('2030-01-01T00:00:00Z') })
    expect(later.verdict.verdict_id).toBe(r.verdict.verdict_id)
    expect(later.verdict.issued_at).not.toBe(r.verdict.issued_at)
    const changed = verifyAgainstTwin(HTML, [{ ...claims[0]!, value: 1 }, ...claims.slice(1)], OPTS)
    expect(changed.verdict.verdict_id).not.toBe(r.verdict.verdict_id)
    const check = verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, OPTS))
    expect(check).toMatchObject({ ok: true, id_ok: true, input_ok: true })
    expect(verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, { ...OPTS, tolerance: 1 })).ok).toBe(false)
  })
})

describe('bindTwinFields and the twin gate (agent-independent)', () => {
  it('binds every mapped field or says why not', () => {
    const b = bindTwinFields(HTML, { periodEnd: '2024-12-31' })
    expect(b.map((x) => x.field)).toEqual(FS_CORE_TWIN_MAP.fields.map((f) => f.field))
    const by = Object.fromEntries(b.map((x) => [x.field, x]))
    expect(by.assets).toMatchObject({ bound: true, binding: { value: 1_234_567_000 } })
    expect(by.cash).toMatchObject({ bound: false, reason: 'NO_USD_FACT' })
    expect(by.current_liabilities).toMatchObject({ bound: false, reason: 'CONFLICTING_FACTS' })
    expect(by.gross_profit).toMatchObject({ bound: false, reason: 'NO_BINDING_FACT' }) // nil is not a value
    expect(FS_CORE_TWIN_MAP.fields).toHaveLength(25)
    expect(new Set(FS_CORE_TWIN_MAP.fields.map((f) => f.cell)).size).toBe(10)
  })
  it('the gate needs a non-dimensional USD fact dated near the period end', () => {
    const tw = parseInlineXbrl(HTML)
    expect(twinGate(tw, '2024-12-31')).toBe(true)
    expect(twinGate(tw, '2024-12-31', 1)).toBe(false) // 2024-12-28 is 3 days away
    expect(twinGate(tw, '2022-06-30')).toBe(false)
  })
  it('rejects a malformed period end loudly', () => {
    expect(() => verifyAgainstTwin(HTML, [], { periodEnd: 'Dec 31' })).toThrow(RangeError)
  })
})
