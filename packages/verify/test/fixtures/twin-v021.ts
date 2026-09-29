/**
 * Synthetic twin v0.2.1 fixtures (TWIN-V021): inline XBRL, presentation linkbases and a FilingSummary reproducing
 * CREDENCE-2's published misses in miniature. Shared by test/twin-v021.test.ts and the bench's pin cross-check.
 */
export const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"', 'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"', 'xmlns:us-gaap="http://fasb.org/us-gaap/2025"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"', 'xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"',
].join(' ')
export const ctxI = (id: string, d: string): string => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000002</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${d}</xbrli:instant></xbrli:period></xbrli:context>`
export const ctxD = (id: string, s: string, e: string): string => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000002</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`
/** a fact in whole dollars unless overridden */
export const nf = (name: string, ctx: string, text: string, a: Record<string, string> = {}): string => {
  const attrs = { unitRef: 'usd', decimals: '0', scale: '0', format: 'ixt:num-dot-decimal', ...a }
  return `<td><ix:nonFraction name="us-gaap:${name}" contextRef="${ctx}" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${text}</ix:nonFraction></td>`
}
export const doc = (rows: string[]): string => `<?xml version="1.0" encoding="utf-8"?><html ${NS}><head><title>10-K</title></head><body>`
  + `<div style="display:none"><ix:header><ix:resources>${[ctxI('I24', '2024-12-31'), ctxI('I23', '2023-12-31'), ctxD('D24', '2024-01-01', '2024-12-31')].join('')}`
  + '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit></ix:resources></ix:header></div>'
  + `<table>${rows.map((r) => `<tr>${r}</tr>`).join('')}</table></body></html>`

export const loc = (c: string): string => `<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2025/elts/us-gaap-2025.xsd#us-gaap_${c}" xlink:label="loc_${c}"/>`
export const link = (role: string, cs: string[]): string => `<link:presentationLink xlink:type="extended" xlink:role="http://x.example.com/role/${role}">${cs.map(loc).join('')}</link:presentationLink>`
export const linkbase = (links: string[]): string => `<?xml version="1.0" encoding="utf-8"?><link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">${links.join('')}</link:linkbase>`
export const summary = (reports: [string, string, 'Statements' | 'Details'][]): string => `<?xml version="1.0" encoding="utf-8"?><FilingSummary><MyReports>${reports.map(([role, name, menu], i) =>
  `<Report instance="x.htm"><LongName>000000${i + 2} - ${menu === 'Statements' ? 'Statement' : 'Disclosure'} - ${name}</LongName><Role>http://x.example.com/role/${role}</Role><ShortName>${name}</ShortName><MenuCategory>${menu}</MenuCategory></Report>`).join('')}</MyReports></FilingSummary>`
export const FS = summary([['BalanceSheets', 'Balance Sheets', 'Statements'], ['Operations', 'Statements of Operations', 'Statements'], ['OperationsParenthetical', 'Statements of Operations (Parenthetical)', 'Statements'], ['CashFlows', 'Statements of Cash Flows', 'Statements'], ['CashDetails', 'Cash (Details)', 'Details']])

export const CCERC = 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'
export const INCL = `${CCERC}IncludingDisposalGroupAndDiscontinuedOperations`
export const CHANGE = `${CCERC}PeriodIncreaseDecreaseIncludingExchangeRateEffect`
export const DG_CASH = 'DisposalGroupIncludingDiscontinuedOperationCashAndCashEquivalents'
export const OPTS = { periodEnd: '2024-12-31', now: () => new Date('2026-09-28T12:00:00Z') }

// ── Lodging Fund in miniature: two ending-cash lines on the cash-flow statement; the roll closes on the variant ──────
export const LODGING = doc([
  `<td>Assets</td>${nf('Assets', 'I24', '90,000,000')}`, `<td>Cash</td>${nf('CashAndCashEquivalentsAtCarryingValue', 'I24', '9,000,000')}`,
  `<td>Net change</td>${nf(CHANGE, 'D24', '2,582,487', { sign: '-' })}`,
  `<td>Beginning cash</td>${nf(CCERC, 'I23', '12,944,329')}`,
  `<td>Ending cash</td>${nf(INCL, 'I24', '10,361,842')}${nf(CCERC, 'I23', '12,944,329')}`,
  // the reconciliation to the balance sheet: continuing cash, the disposal group's cash, the total
  `<td>Cash, end of period</td>${nf(CCERC, 'I24', '10,340,792')}`, `<td>Held for sale</td>${nf(DG_CASH, 'I24', '21,050')}`,
  `<td>Including held for sale</td>${nf(INCL, 'I24', '10,361,842')}${nf(INCL, 'I23', '12,944,329')}`,
])
export const LODGING_PRE = linkbase([link('BalanceSheets', ['Assets', 'CashAndCashEquivalentsAtCarryingValue']), link('CashFlows', [CHANGE, CCERC, INCL, DG_CASH])])

// ── a 2025-taxonomy filer: the roll's endpoints are the variant; the plain concept sits only in a note ───────────────
export const TAX2025 = doc([
  `<td>Net change</td>${nf(CHANGE, 'D24', '10,000', { scale: '3', decimals: '-3' })}`,
  `<td>Beginning cash</td>${nf(INCL, 'I23', '70,000', { scale: '3', decimals: '-3' })}`,
  `<td>Ending cash</td>${nf(INCL, 'I24', '80,000', { scale: '3', decimals: '-3' })}`,
  `<td>Cash (note, continuing)</td>${nf(CCERC, 'I24', '79,000', { scale: '3', decimals: '-3' })}`,
])
export const TAX2025_PRE = linkbase([link('BalanceSheets', ['Assets']), link('CashFlows', [CHANGE, INCL]), link('CashDetails', [CCERC])])

// ── Kinetic Seas in miniature: the balance sheet prints cash under us-gaap:Cash; the map's concept is only in a note ──
export const KINETIC = doc([
  `<td>Cash</td>${nf('Cash', 'I24', '4,947')}`, `<td>Total costs and expenses</td>${nf('CostsAndExpenses', 'D24', '105,109,040')}`,
  `<td>Cash (note)</td>${nf('CashAndCashEquivalentsAtCarryingValue', 'I24', '4,947')}`,
  `<td>Operating expenses (narrative)</td>${nf('OperatingExpenses', 'D24', '7,121,627')}`,
])
export const KINETIC_PRE = linkbase([link('BalanceSheets', ['Cash']), link('Operations', ['CostsAndExpenses']), link('CashDetails', ['CashAndCashEquivalentsAtCarryingValue', 'OperatingExpenses'])])

