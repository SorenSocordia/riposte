/**
 * Twin v0.2 (CREDENCE-2): statement-anchored binding through the filing's own presentation linkbase, and
 * decimals-aware matching. SYNTHETIC inline-XBRL, presentation linkbase and FilingSummary only. The CREDENCE-1 false-flag
 * mechanisms are reproduced in miniature (a higher-priority concept tagged only in a note or MD&A, often rounded, beating
 * the statement line), and v0.1 is shown unchanged on the same document.
 */
import { describe, it, expect } from 'vitest'
import {
  parseTwinPresentation, verifyAgainstTwin, bindTwinFields, twinVerdictInput, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02,
  type TwinClaim, type TwinJudgment, type TwinPresentation,
} from '../src/twin/index'
import { verifyReplay } from '../src/protocol/replay'

const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"', 'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"', 'xmlns:us-gaap="http://fasb.org/us-gaap/2024"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"', 'xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"', 'xmlns:abc="http://abc.example.com/20241231"',
].join(' ')
const ctxI = (id: string, d: string): string => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${d}</xbrli:instant></xbrli:period></xbrli:context>`
const ctxD = (id: string, s: string, e: string): string => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`
const nf = (name: string, ctx: string, text: string, a: Record<string, string> = {}): string => {
  const attrs = { unitRef: 'usd', decimals: '-3', scale: '3', format: 'ixt:num-dot-decimal', ...a }
  return `<td><ix:nonFraction name="${name}" contextRef="${ctx}" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${text}</ix:nonFraction></td>`
}
const CONTEXTS = [ctxI('I24', '2024-12-31'), ctxI('I23', '2023-12-31'), ctxD('D24', '2024-01-01', '2024-12-31')]
const UNIT = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'
const doc = (rows: string[]): string => `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
  + `<div style="display:none"><ix:header><ix:resources>${CONTEXTS.join('')}${UNIT}</ix:resources></ix:header></div>`
  + `<table>${rows.map((r) => `<tr>${r}</tr>`).join('')}</table></body></html>`

// The statements (BS, IS, CF) and the notes / MD&A of one filing.
const HTML = doc([
  // BALANCE SHEET: total assets in thousands; the note below repeats it to the dollar (a consistent, MORE precise duplicate)
  `<td>Total assets</td>${nf('us-gaap:Assets', 'I24', '1,234,567')}`,
  `<td>Cash</td>${nf('abc:Cash', 'I24', '4,558,160', { scale: '0', decimals: '0' })}`,
  `<td>Total current assets</td>${nf('us-gaap:AssetsCurrent', 'I24', '600,000')}`,
  // INCOME STATEMENT
  `<td>Revenue</td>${nf('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'D24', '128,133')}`,
  `<td>Operating income</td>${nf('us-gaap:OperatingIncomeLoss', 'D24', '12.3', { scale: '6', decimals: '-5' })}`,
  `<td>Net loss</td>${nf('us-gaap:NetIncomeLoss', 'D24', '35,041,673', { scale: '0', decimals: '0', sign: '-' })}`,
  // CASH FLOWS
  `<td>Cash, end of year</td>${nf('us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'I24', '80,000')}`,
  // NOTES / MD&A: higher-priority map concepts, off the statements, often rounded
  `<td>Assets (note, to the dollar)</td>${nf('us-gaap:Assets', 'I24', '1,234,567,123', { scale: '0', decimals: '0' })}`,
  `<td>Net loss (MD&amp;A)</td>${nf('us-gaap:ProfitLoss', 'D24', '35.0', { scale: '6', decimals: '-5', sign: '-' })}`,
  `<td>Segment revenue (note)</td>${nf('us-gaap:Revenues', 'D24', '14,371')}`,
  `<td>Cash (MD&amp;A)</td>${nf('us-gaap:CashAndCashEquivalentsAtCarryingValue', 'I24', '4.6', { scale: '6', decimals: '-5' })}`,
  `<td>Liabilities (parenthetical only)</td>${nf('us-gaap:Liabilities', 'I24', '700,000')}`,
])

const loc = (c: string): string => `<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2024/elts/us-gaap-2024.xsd#us-gaap_${c}" xlink:label="loc_${c}"/>`
const extLoc = (c: string): string => `<link:loc xlink:type="locator" xlink:href="abc-20241231.xsd#abc_${c}" xlink:label="loc_abc_${c}"/>`
const link = (role: string, locs: string[]): string => `<link:presentationLink xlink:type="extended" xlink:role="http://abc.example.com/role/${role}">${locs.join('')}</link:presentationLink>`
const PRE = `<?xml version="1.0" encoding="utf-8"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">`
  + link('BalanceSheets', [loc('Assets'), loc('AssetsCurrent'), extLoc('Cash')])
  + link('BalanceSheetsParenthetical', [loc('Liabilities')])
  + link('Operations', [loc('RevenueFromContractWithCustomerExcludingAssessedTax'), loc('OperatingIncomeLoss'), loc('NetIncomeLoss')])
  + link('CashFlows', [loc('NetIncomeLoss'), loc('CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents')])
  + link('SegmentsDetails', [loc('Revenues'), loc('ProfitLoss'), loc('Assets')])
  + link('LiquidityDetails', [loc('CashAndCashEquivalentsAtCarryingValue')])
  + '</link:linkbase>'
const report = (n: number, role: string, name: string, menu: string | null): string =>
  `<Report instance="abc-20241231.htm"><HtmlFileName>R${n}.htm</HtmlFileName><LongName>000000${n} - ${menu === 'Statements' ? 'Statement' : 'Disclosure'} - ${name}</LongName><ReportType>Sheet</ReportType><Role>http://abc.example.com/role/${role}</Role><ShortName>${name}</ShortName>${menu ? `<MenuCategory>${menu}</MenuCategory>` : ''}<Position>${n}</Position></Report>`
const FS = `<?xml version="1.0" encoding="utf-8"?><FilingSummary><MyReports>`
  + report(1, 'Cover', 'Cover', 'Cover')
  + report(2, 'BalanceSheets', 'Consolidated Balance Sheets', 'Statements')
  + report(3, 'BalanceSheetsParenthetical', 'Consolidated Balance Sheets (Parenthetical)', 'Statements')
  + report(4, 'Operations', 'Consolidated Statements of Operations', 'Statements')
  + report(5, 'CashFlows', 'Consolidated Statements of Cash Flows', 'Statements')
  + report(6, 'SegmentsDetails', 'Segments (Details)', 'Details')
  + report(7, 'LiquidityDetails', 'Liquidity (Details)', 'Details')
  + '</MyReports></FilingSummary>'

const P = parseTwinPresentation({ pre: PRE, filingSummary: FS })!
const OPTS = { periodEnd: '2024-12-31', now: () => new Date('2026-09-28T12:00:00Z') }
const V2 = { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: P }
const one = (field: string, value: number, opts: Parameters<typeof verifyAgainstTwin>[2] = V2, html = HTML): TwinJudgment =>
  verifyAgainstTwin(html, [{ id: field, field, value }], opts).judgments[0]!

describe('parseTwinPresentation: which concepts sit on the face statements', () => {
  it('takes statement roles from FilingSummary (MenuCategory "Statements"), excludes parenthetical roles, keeps us-gaap concepts only', () => {
    expect(P.source).toBe('filing-summary')
    expect(P.statementRoles).toEqual(['http://abc.example.com/role/BalanceSheets', 'http://abc.example.com/role/Operations', 'http://abc.example.com/role/CashFlows'])
    expect(P.statementConcepts).toEqual(['Assets', 'AssetsCurrent', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'NetIncomeLoss', 'OperatingIncomeLoss', 'RevenueFromContractWithCustomerExcludingAssessedTax'])
    expect(P.roles.find((r) => r.role.endsWith('BalanceSheetsParenthetical'))).toMatchObject({ statement: false, parenthetical: true, concepts: 1 })
    expect(P.stats).toEqual({ links: 6, locs: 13 })
    expect(P.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(P.inputs.schema).toBeNull()
  })
  it('falls back to roleType definitions ("- Statement -") in the schema, and reads links embedded in the schema', () => {
    const XSD = `<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><xsd:annotation><xsd:appinfo>`
      + '<link:roleType roleURI="http://abc.example.com/role/BalanceSheets" id="BS"><link:definition>0000002 - Statement - Consolidated Balance Sheets</link:definition></link:roleType>'
      + '<link:roleType roleURI="http://abc.example.com/role/BalanceSheetsParenthetical" id="BSP"><link:definition>0000003 - Statement - Consolidated Balance Sheets (Parenthetical)</link:definition></link:roleType>'
      + '<link:roleType roleURI="http://abc.example.com/role/SegmentsDetails" id="SD"><link:definition>0000009 - Disclosure - Segments (Details)</link:definition></link:roleType>'
      + `<link:linkbase>${link('BalanceSheets', [loc('Assets')])}${link('BalanceSheetsParenthetical', [loc('Liabilities')])}${link('SegmentsDetails', [loc('Revenues')])}</link:linkbase>`
      + '</xsd:appinfo></xsd:annotation></xsd:schema>'
    const p = parseTwinPresentation({ schema: XSD })!
    expect(p.source).toBe('role-definition')
    expect(p.statementRoles).toEqual(['http://abc.example.com/role/BalanceSheets'])
    expect(p.statementConcepts).toEqual(['Assets'])
  })
  it('returns null when there is no presentation link at all, and no statement role when nothing identifies one', () => {
    expect(parseTwinPresentation({ pre: '<link:linkbase/>', filingSummary: FS })).toBeNull()
    expect(parseTwinPresentation({})).toBeNull()
    const noSummary = parseTwinPresentation({ pre: PRE })!
    expect(noSummary.source).toBe('none')
    expect(noSummary.statementRoles).toEqual([])
  })
  it('is deterministic, and its identity changes with any input', () => {
    expect(parseTwinPresentation({ pre: PRE, filingSummary: FS })).toEqual(P)
    expect(parseTwinPresentation({ pre: PRE, filingSummary: FS.replace('R7.htm', 'R8.htm') })!.sha256).not.toBe(P.sha256)
  })
})

describe('v0.2 statement-anchored binding: the CREDENCE-1 false flags, in miniature', () => {
  it('a higher-priority concept tagged only in MD&A (rounded) no longer beats the statement line (net income)', () => {
    expect(one('net_income', -35_041_673, OPTS)).toMatchObject({ outcome: 'FAIL', binding: { concept: 'ProfitLoss', value: -35_000_000 } }) // v0.1
    expect(one('net_income', -35_041_673)).toMatchObject({ outcome: 'PASS', reason: 'MATCH', binding: { concept: 'NetIncomeLoss', value: -35_041_673 } })
  })
  it('a partial figure in a note under the first revenue concept no longer beats the statement\'s revenue', () => {
    expect(one('revenue', 128_133_000, OPTS)).toMatchObject({ outcome: 'FAIL', binding: { concept: 'Revenues', value: 14_371_000 } }) // v0.1
    expect(one('revenue', 128_133_000)).toMatchObject({ outcome: 'PASS', binding: { concept: 'RevenueFromContractWithCustomerExcludingAssessedTax' } })
  })
  it('NOT_ON_STATEMENT: the statement prints the line under another concept; the map\'s concept is only in MD&A', () => {
    expect(one('cash', 4_558_160, OPTS)).toMatchObject({ outcome: 'FAIL' }) // v0.1: "4.6" million in MD&A
    const j = one('cash', 4_558_160)
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(j.detail).toMatch(/CashAndCashEquivalentsAtCarryingValue is reported in the instant period/)
  })
  it('a concept presented only on a PARENTHETICAL statement does not bind', () => {
    expect(one('liabilities', 700_000_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(one('liabilities', 700_000_000, OPTS)).toMatchObject({ outcome: 'PASS' }) // v0.1 binds it anywhere
  })
  it('a concept on no statement and in no period fact is NO_BINDING_FACT, as before', () => {
    expect(one('gross_profit', 1)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_BINDING_FACT' })
  })
  it('still FAILs a wrong value on a statement line, with a diagnosis (a statement is not a softer judge)', () => {
    expect(one('current_assets', 600_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SCALE' })
    expect(one('ending_cash', 4_558_160)).toMatchObject({ outcome: 'FAIL', diagnosis: 'CONCEPT' }) // it is the balance sheet's own cash line (an extension concept)
    expect(one('ending_cash', 1)).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
    expect(one('net_income', -35_000_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'CONCEPT' }) // the MD&A rounding is not the statement's figure
  })
  it('sign is still not judged', () => {
    expect(one('net_income', 35_041_673)).toMatchObject({ outcome: 'PASS', sign_matches_xbrl: false })
  })
})

describe('v0.2 decimals-aware matching', () => {
  it('PASSes the statement\'s figure in thousands when a note repeats the same fact to the dollar (a consistent duplicate)', () => {
    expect(one('assets', 1_234_567_000, OPTS)).toMatchObject({ outcome: 'FAIL', binding: { value: 1_234_567_123, decimals: 0, duplicates: 2 } }) // v0.1
    const j = one('assets', 1_234_567_000)
    expect(j).toMatchObject({ outcome: 'PASS', reason: 'MATCH', binding: { value: 1_234_567_123, duplicates: 2 } })
    expect(j.detail).toMatch(/matched as reported to decimals -3 \("1,234,567" × 10\^3 = 1234567000\), a consistent duplicate/)
    expect(one('assets', 1_234_567_123)).toMatchObject({ outcome: 'PASS' })
  })
  it('the PASS evidence points at the figure that matched', () => {
    const r = verifyAgainstTwin(HTML, [{ id: 'a', field: 'assets', value: 1_234_567_000 }], V2)
    const span = r.verdict.claims[0]!.evidence[0]!.locator as { kind: 'span'; start: number; end: number }
    expect(HTML.slice(span.start, span.end)).toContain('>1,234,567<')
    expect(r.verdict.claims[0]!.evidence[0]!.normalizations).toEqual(['ix:scale=3', 'ix:format=num-dot-decimal', 'twin:statement-anchored'])
  })
  it('ROUNDED_BINDING: inside the binding fact\'s own rounding but equal to none of its figures is ABSTAIN, never FAIL or PASS', () => {
    expect(one('operating_income', 12_345_678, OPTS)).toMatchObject({ outcome: 'FAIL' }) // v0.1
    const j = one('operating_income', 12_345_678)
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'ROUNDED_BINDING', binding: { value: 12_300_000, decimals: -5 } })
    expect(one('operating_income', 12_300_000)).toMatchObject({ outcome: 'PASS' })
    expect(one('operating_income', 12_400_000)).toMatchObject({ outcome: 'FAIL' }) // outside ± 50,000
  })
})

describe('v0.2 ABSTAINs when its anchor is missing (never falls back to whole-document binding)', () => {
  it('NO_PRESENTATION_LINKBASE: no presentation supplied', () => {
    expect(one('assets', 1_234_567_000, { ...OPTS, map: FS_CORE_TWIN_MAP_V02 })).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_PRESENTATION_LINKBASE' })
    expect(one('assets', 1_234_567_000, { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: null })).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_PRESENTATION_LINKBASE' })
  })
  it('NO_STATEMENT_ROLES: a linkbase with no identifiable statement role', () => {
    const p = parseTwinPresentation({ pre: PRE })!
    expect(one('assets', 1_234_567_000, { ...V2, presentation: p })).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_STATEMENT_ROLES' })
  })
  it('the NO_TWIN gate and the claim checks come first, as in v0.1', () => {
    expect(one('assets', Number.NaN)).toMatchObject({ outcome: 'ABSTAIN', reason: 'VALUE_UNPARSEABLE' })
    expect(one('ebitda', 1)).toMatchObject({ outcome: 'ABSTAIN', reason: 'FIELD_NOT_MAPPED' })
    expect(one('assets', 1, { ...V2, periodEnd: '2021-12-31' })).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_TWIN' })
  })
  it('the abstentions map to standard insufficiency reasons, with the twin reason leading the detail', () => {
    const r = verifyAgainstTwin(HTML, [{ id: 'c', field: 'cash', value: 4_558_160 }, { id: 'o', field: 'operating_income', value: 12_345_678 }], V2)
    expect(r.verdict.claims.map((c) => c.insufficiency?.reason)).toEqual(['REFERENCE_NOT_PROVIDED', 'AMBIGUOUS_REFERENCE'])
    expect(r.verdict.claims[0]!.insufficiency!.detail).toMatch(/^NOT_ON_STATEMENT: /)
    expect(r.verdict.claims[1]!.insufficiency!.detail).toMatch(/^ROUNDED_BINDING: /)
    expect(r.verdict.outcome).toBe('INSUFFICIENT_DATA')
  })
})

describe('bindTwinFields with v0.2', () => {
  it('binds through the statements, and says why not', () => {
    const by = Object.fromEntries(bindTwinFields(HTML, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V02, presentation: P }).map((b) => [b.field, b]))
    expect(by.net_income).toMatchObject({ bound: true, binding: { concept: 'NetIncomeLoss' } })
    expect(by.revenue).toMatchObject({ bound: true, binding: { concept: 'RevenueFromContractWithCustomerExcludingAssessedTax' } })
    expect(by.cash).toMatchObject({ bound: false, reason: 'NOT_ON_STATEMENT' })
    const v1 = Object.fromEntries(bindTwinFields(HTML, { periodEnd: '2024-12-31' }).map((b) => [b.field, b]))
    expect(v1.net_income).toMatchObject({ bound: true, binding: { concept: 'ProfitLoss' } })
    expect(bindTwinFields(HTML, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V02 }).every((b) => !b.bound && b.reason === 'NO_PRESENTATION_LINKBASE')).toBe(true)
  })
})

describe('v0.2 verdicts: ruleset, determinism, replay', () => {
  const claims: TwinClaim[] = [{ id: 'x.assets', field: 'assets', value: 1_234_567_000 }, { id: 'x.net_income', field: 'net_income', value: -35_041_673 }]
  const r = verifyAgainstTwin(HTML, claims, V2)
  it('names ruleset twin-xbrl-fs-core@0.2.0 and reports the presentation it bound through', () => {
    expect(r.verdict.ruleset).toEqual({ id: 'twin-xbrl-fs-core', version: '0.2.0', domain: 'financial-statements' })
    expect(r.verdict.outcome).toBe('PASS')
    expect(r.twin.presentation).toEqual({ sha256: P.sha256, source: 'filing-summary', statement_roles: 3, statement_concepts: 6 })
    expect(r.verdict.references.evidence).toBe(2)
  })
  it('commits to the presentation: replay binds it, and another presentation gives another verdict_id', () => {
    expect(JSON.stringify(verifyAgainstTwin(HTML, claims, V2))).toBe(JSON.stringify(r))
    expect(verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, V2))).toMatchObject({ ok: true, id_ok: true, input_ok: true })
    const other: TwinPresentation = parseTwinPresentation({ pre: PRE, filingSummary: FS.replace('R7.htm', 'R8.htm') })!
    expect(verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, { ...V2, presentation: other })).ok).toBe(false)
    expect(verifyAgainstTwin(HTML, claims, { ...V2, presentation: other }).verdict.verdict_id).not.toBe(r.verdict.verdict_id)
  })
  it('leaves v0.1 exactly as it was: no presentation key in its input or result, and a different verdict_id from v0.2', () => {
    const v1 = verifyAgainstTwin(HTML, claims, { ...OPTS, presentation: P })
    expect(Object.keys(twinVerdictInput(v1.twin.sha256, claims, { ...OPTS, presentation: P }) as object)).not.toContain('presentation_sha256')
    expect(v1.twin).not.toHaveProperty('presentation')
    expect(v1.verdict.ruleset.version).toBe('0.1.0')
    expect(JSON.stringify(v1)).toBe(JSON.stringify(verifyAgainstTwin(HTML, claims, OPTS))) // presentation is ignored by v0.1
    expect(v1.verdict.verdict_id).not.toBe(r.verdict.verdict_id)
    expect(FS_CORE_TWIN_MAP.binding).toBeUndefined()
    expect(FS_CORE_TWIN_MAP_V02.fields).toBe(FS_CORE_TWIN_MAP.fields)
  })
})
