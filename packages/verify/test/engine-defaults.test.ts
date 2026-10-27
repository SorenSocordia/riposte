/**
 * Engine 0.1.0 (2026-10-03): strict reading becomes the default, Peppol 0.2.0 becomes the default e-invoice ruleset, and
 * every verdict an earlier engine issued still replays byte for byte.
 *
 *   1. the engine versions: 0.1.0 is current, 0.0.1 is retained; anything else is refused
 *   2. verdicts issued by the engine before this change (engine 0.0.1, fixtures/engine-0.0.1-bundles.json) replay REPERFORMED,
 *      byte for byte, and the same calls made today under engine 0.0.1 give the same bytes
 *   3. the engines the 0.1.0 change did not touch move in identity only (engine_version, and the verdict_id derived from it)
 *   4. the new defaults on the stamped-scan shape: an unreadable total holds the gate, naming both operands
 *   5. a garbled amount is UNPARSEABLE, never coerced, and its remedy carries the raw string; what still reads as a number
 *   6. the flags restore the old reading (the 196 representations of 2026-10-03, compared with engine 0.0.1's verdicts)
 *   7. replay re-performs under the engine the verdict names
 *   8. ruleset names: peppol-en16931 → 0.3.0 under engine 0.6.0 (0.2.0 under engines 0.1.0 to 0.5.0),
 *      @0.1.0 → 0.1.0, e-invoice → the default; CLI, HTTP, MCP; verbatim copies
 *   9. what the new defaults move on the goldens, measured and pinned
 *  10. a succession replay is re-performed under the engine it names
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_VERSION, ENGINE_VERSIONS, engineFor, isRetainedEngine, declarativeReading, verify, verifyDeclarative, verifyReplay,
  verifyInvoiceMatch, splitApLayout, verifyCitations, verifyAction, reconcile, lintRuleset, evalExpr, gateStatus, holdsAtGate,
  deriveVerdictId, resolveDeclarativeRuleset, isDeclarativeRulesetName, DECLARATIVE_RULESETS, PEPPOL_EN16931_V0_2_0, HOUSE_PEPPOL_RULESET,
  createLedger, type DeclarativeRuleset, type Verdict,
} from '../src/index'
import { run } from '../src/cli'
import { route } from '../src/http/router'
import { handleRequest, type JsonRpcRequest } from '../src/mcp/server'
import { verifyAgainstTwin, FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, parseTwinPresentation } from '../src/twin/index'
import { successionReplay, checkSuccessionReplay } from '../src/ledger/succession'
import type { DecisionEntry, GrantDecision } from '../src/ledger/decisions'
import { buildGoldenCases, type GoldenApi } from './fixtures/declarative-golden-cases'
import { buildGoldenCasesV010, type GoldenApiV010 } from './fixtures/declarative-golden-einvoice-v010-cases'
import { FS, OPTS, LODGING, LODGING_PRE, TAX2025, TAX2025_PRE } from './fixtures/twin-v021'
import * as inv from './fixtures/invoices'
import * as pay from './fixtures/pay-apps'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, '..', 'docs', 'examples')
const V1_PATH = join(EX, 'peppol-en16931.ruleset.json')
const V2_PATH = join(EX, 'peppol-en16931.ruleset.v0.2.json')
const V1 = JSON.parse(readFileSync(V1_PATH, 'utf8')) as DeclarativeRuleset
const V2 = JSON.parse(readFileSync(V2_PATH, 'utf8')) as DeclarativeRuleset
const V3_PATH = join(EX, 'peppol-en16931.ruleset.v0.3.json')
const V3 = JSON.parse(readFileSync(V3_PATH, 'utf8')) as DeclarativeRuleset
const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
const NOW = () => new Date('2026-10-03T00:00:00Z')
type J = Record<string, unknown>
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)
/** A verdict with its identity set aside: what two engines must agree on when the behaviour did not change. */
const body = (v: Verdict): string => { const { verdict_id: _i, engine_version: _e, ...rest } = v; return JSON.stringify(rest) }

// The stamped-scan case (X1-N18), as test/peppol-v020.test.ts inlines it (OpenPEPPOL snippet 1; the page as the OCR read it).
const N18_TEXT = [
  'INVOICE', 'Invoice number: Snippet1', 'Issue date: 2017-11-13', 'Due date: 2017-12-01', 'Currency: EUR',
  'Seller: SupplierOfficialName Ltd', 'Buyer: Buyer Official Name', 'Line items',
  '# = =Item Qty Unit Price Per Allow. Charge Net VAT',
  '1 item name 10 XBX 410.00 1 101.00 1.00 4,000.00 S 25%', '2 item name 10 C62 200.00 2 - - 1,000.00 E0%',
  '3 item name 10 C62 100.00 - 101.00 1.00 900.00 S 25%',
  'Document allowances and charges', 'Charge Cleaning 200.00 S 25%', 'Allowance Discount 200.00 S 25%',
  'VAT breakdown', 'Category Rate Taxable amount VAT amount', 'S) 25% 4,900.00 1,225.00', 'E 0% 1,000.00 0.00',
  'Sum of line net amounts EUR 5,900.00', 'Document allowances EUR 20', 'Document charges EU 20 —E', 'Total without VAT E ten',
  'VAT total i °225.0', 'VAT total in accounting currency Ss 324.00', 'Total with VAT EUR 7,125.00', 'Paid amount EUR 1,000.00',
  'Amount due for payment EUR 6,125.00',
].join('\n')
const N18_BLIND: J = {
  invoice_number: 'Snippet1', issue_date: '2017-11-13', due_date: '2017-12-01', currency: 'EUR',
  seller_name: 'SupplierOfficialName Ltd', buyer_name: 'Buyer Official Name',
  line_extension_amount: 5900, tax_inclusive_amount: 7125, prepaid_amount: 1000, payable_amount: 6125, amount_currency: 'EUR',
  lines: [
    { id: '1', item_name: 'item name', invoiced_quantity: 10, price_amount: 410, line_extension_amount: 4000, base_quantity: 1, line_allowance_amount: 101, line_charge_amount: 1 },
    { id: '2', item_name: 'item name', invoiced_quantity: 10, price_amount: 200, line_extension_amount: 1000, base_quantity: 2 },
    { id: '3', item_name: 'item name', invoiced_quantity: 10, price_amount: 100, line_extension_amount: 900, line_allowance_amount: 101, line_charge_amount: 1 },
  ],
  vat_breakdown: [{ rate: 25, taxable_amount: 4900, tax_amount: 1225, row: 1 }, { category: 'E', rate: 0, taxable_amount: 1000, tax_amount: 0, row: 2 }],
}
const N18_SHAPE: J = { ...N18_BLIND, tax_exclusive_amount: 5900, tax_amount: 1225 }

// 2026-10-03: engine 0.2.0 was made current; the 0.1.0 statements below name engine 0.1.0 explicitly (they describe it).
// 2026-10-03: engine 0.3.0 is current; statements below that describe 0.2.0's wording name engine 0.2.0.
// 2026-10-04: engine 0.4.0 is current; 0.3.0 joins the retained engines.
// 2026-10-04: engine 0.5.0 is current; 0.4.0 joins the retained engines.
describe('1. engine versions: 0.5.0 is current, 0.4.0, 0.3.0, 0.2.0, 0.1.0 and 0.0.1 are retained', () => {
  it('this build is engine 0.5.0 and re-performs 0.0.1, 0.1.0, 0.2.0, 0.3.0, 0.4.0 and 0.5.0', () => {
    expect(ENGINE_VERSION).toBe('0.7.2')
    expect([...ENGINE_VERSIONS]).toEqual(['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.7.1', '0.7.2'])
    expect([engineFor(), engineFor('0.0.1'), engineFor('0.1.0')]).toEqual(['0.7.2', '0.0.1', '0.1.0'])
    expect([isRetainedEngine('0.0.1'), isRetainedEngine('0.0.0-old'), isRetainedEngine(1)]).toEqual([true, false, false])
  })
  it('a verdict names the engine it was made under; a version this build does not carry is refused, not guessed', () => {
    expect(verify(inv.clean, { now: NOW }).engine_version).toBe('0.7.2')
    expect(verify(inv.clean, { now: NOW, engine: '0.1.0' }).engine_version).toBe('0.1.0')
    expect(verify(inv.clean, { now: NOW, engine: '0.0.1' }).engine_version).toBe('0.0.1')
    expect(() => verify(inv.clean, { now: NOW, engine: '9.9.9' })).toThrow(/engine 9\.9\.9 is not one this build carries \(it carries 0\.0\.1, 0\.1\.0, 0\.2\.0, 0\.3\.0, 0\.4\.0, 0\.5\.0, 0\.6\.0, 0\.7\.0, 0\.7\.1, 0\.7\.2\)/)
    expect(() => verifyDeclarative(N18_SHAPE, V1, { now: NOW, engine: '0.0.2' })).toThrow(/not one this build carries/)
  })
  it('the declarative reading per engine: 0.0.1 opts in by flag; 0.1.0 is strict unless the ruleset turns it off', () => {
    expect(declarativeReading({}, '0.0.1')).toEqual({ unreadable: false, strictNumbers: false })
    expect(declarativeReading({ distinguish_unreadable: true }, '0.0.1')).toEqual({ unreadable: true, strictNumbers: true })
    expect(declarativeReading({ strict_numbers: true }, '0.0.1')).toEqual({ unreadable: false, strictNumbers: false }) // 0.0.1 never read it
    expect(declarativeReading({}, '0.1.0')).toEqual({ unreadable: true, strictNumbers: true })
    expect(declarativeReading({ distinguish_unreadable: false }, '0.1.0')).toEqual({ unreadable: false, strictNumbers: true })
    expect(declarativeReading({ strict_numbers: false }, '0.1.0')).toEqual({ unreadable: true, strictNumbers: false })
    expect(declarativeReading({ distinguish_unreadable: false, strict_numbers: false }, '0.1.0')).toEqual({ unreadable: false, strictNumbers: false })
    expect(declarativeReading({}, '0.2.0')).toEqual({ unreadable: true, strictNumbers: true }) // 0.2.0 reads as 0.1.0 here
  })
})

describe('2. verdicts issued by engine 0.0.1, before this change, replay byte for byte', () => {
  const F = JSON.parse(readFileSync(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json'), 'utf8')) as { engine_version: string; bundles: { id: string; verdict: Verdict; inputs: J }[] }
  it('the fixture is what the engine before this change issued (pinned by sha256)', () => {
    expect(F.engine_version).toBe('0.0.1')
    expect(F.bundles.map(b => b.id)).toEqual(['peppol-0.1.0-null-totals', 'peppol-0.1.0-garbled-totals', 'peppol-0.1.0-blind-with-source', 'peppol-0.2.0-blind-with-source', 'peppol-0.2.0-garbled-vat', 'invoice-builtin-clean', 'invoice-builtin-garbled-tax', 'legal-0.0.1'])
    expect(sha256(readFileSync(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json')))).toBe('5c8d6c1f9f1a50af6925017d84c1c45e471b41d514e9b17489aa2eaf37181453')
  })
  for (const b of JSON.parse(readFileSync(join(HERE, 'fixtures', 'engine-0.0.1-bundles.json'), 'utf8')).bundles as { id: string; verdict: Verdict; inputs: J }[]) {
    it(`${b.id}: REPERFORMED under engine 0.0.1, byte-identical (issued_at aside, as always)`, () => {
      const r = verifyReplay(b.verdict, b.inputs)
      expect([r.status, r.id_ok, r.input_ok, r.reperformed?.identical, r.reperformed?.first_difference]).toEqual(['REPERFORMED', true, true, true, undefined])
    })
  }
  it('the same calls made today with engine 0.0.1 give the very bytes engine 0.0.1 gave, issued_at included', () => {
    const [nul, gar, blind1, blind2, vat, clean, gtax, legal] = F.bundles
    const decl = (b: typeof nul, rs: DeclarativeRuleset, src?: string) => JSON.stringify(verifyDeclarative(b!.inputs.extraction as J, rs, { now: NOW, engine: '0.0.1', ...(src ? { source: { text: src } } : {}) }))
    expect(decl(nul, V1)).toBe(JSON.stringify(nul!.verdict))
    expect(decl(gar, V1)).toBe(JSON.stringify(gar!.verdict))
    expect(decl(blind1, V1, N18_TEXT)).toBe(JSON.stringify(blind1!.verdict))
    expect(decl(blind2, V2, N18_TEXT)).toBe(JSON.stringify(blind2!.verdict))
    expect(decl(vat, V2)).toBe(JSON.stringify(vat!.verdict))
    expect(JSON.stringify(verify(clean!.inputs.extraction as J, { now: NOW, engine: '0.0.1' }))).toBe(JSON.stringify(clean!.verdict))
    expect(JSON.stringify(verify(gtax!.inputs.extraction as J, { now: NOW, engine: '0.0.1' }))).toBe(JSON.stringify(gtax!.verdict))
    expect(JSON.stringify(verifyCitations(legal!.inputs.citations as never, legal!.inputs.sources as never, { now: NOW, engine: '0.0.1' }))).toBe(JSON.stringify(legal!.verdict))
  })
  it('and what engine 0.1.0 says of the two whose reading changed: both now hold BR-CO-13 open, naming both totals', () => {
    for (const b of F.bundles.slice(0, 2)) {
      const old = claim(b.verdict, 'document.TAX_EXCL_INT')!
      const now = claim(verifyDeclarative(b.inputs.extraction as J, V1, { now: NOW, engine: '0.1.0' }), 'document.TAX_EXCL_INT')!
      expect([old.outcome, now.outcome, now.insufficiency?.reason, now.insufficiency?.missing]).toEqual(['PASS', 'INSUFFICIENT_DATA', 'UNPARSEABLE', ['ALLOWANCE', 'CHARGE']])
    }
  })
})

describe('3. the engines the 0.1.0 change did not touch move in identity only', () => {
  const pair = (f: (engine?: string) => Verdict): [Verdict, Verdict] => [f('0.0.1'), f('0.1.0')]
  const eng = (engine?: string) => (engine ? { engine } : {})
  it('invoice and pay-app (every standalone fixture), legal, action', () => {
    const makers: [string, (e?: string) => Verdict][] = [
      ...inv.ALL_STANDALONE.map(([n, x]) => [`invoice:${n}`, (e?: string) => verify(x, { now: NOW, ...eng(e) })] as [string, (e?: string) => Verdict]),
      ...pay.ALL_PAY_APPS.map(([n, x]) => [`pay-app:${n}`, (e?: string) => verify(x, { ruleset: 'pay-app', now: NOW, ...eng(e) })] as [string, (e?: string) => Verdict]),
      ['legal', (e?: string) => verifyCitations([{ id: '1', case_name: 'A', quote: 'plausible on its face' }, { id: '2', case_name: 'A', quote: 'not in it' }], { A: 'a claim that is plausible on its face' }, { now: NOW, ...eng(e) })],
      ['action', (e?: string) => verifyAction({ tool: 'wire', arguments: { to: '8' } }, { allowed: { to: ['9'] } }, { now: NOW, ...eng(e) })],
    ]
    expect(makers.length).toBeGreaterThan(20)
    for (const [name, f] of makers) {
      const [a, b] = pair(f)
      expect([a.engine_version, b.engine_version], name).toEqual(['0.0.1', '0.1.0'])
      expect(b.verdict_id, name).toBe(deriveVerdictId(a.input_hash, a.ruleset, '0.1.0'))
      expect(body(b), name).toBe(body(a))
    }
  })
  it('the boundary, stated: the built-in invoice ruleset still reads numbers leniently ("°144.42" is 144.42) under both engines', () => {
    const x = { ...inv.clean, totals: { ...(inv.clean.totals as J), tax: '°144.42' } }
    const [a, b] = pair(e => verify(x, { now: NOW, ...eng(e) }))
    expect([a.outcome, b.outcome]).toEqual(['PASS', 'PASS'])
    expect(body(b)).toBe(body(a))
  })
  it('the AP three-way match on the 100 public benchmark cases', () => {
    const cases = readFileSync(join(HERE, '..', 'data', 'real', 'D-ap-distil', 'invoice_cases.jsonl'), 'utf8').trim().split('\n').slice(0, 100).map(l => JSON.parse(l) as { input: string })
    let same = 0
    for (const c of cases) {
      const [a, b] = pair(e => verifyInvoiceMatch(splitApLayout(c.input)!, { now: NOW, ...eng(e) }).verdict)
      if (body(a) === body(b) && a.engine_version === '0.0.1' && b.engine_version === '0.1.0') same++
    }
    expect(same).toBe(100)
  })
  it('the iXBRL twin (v0.1 and v0.2 maps) on the synthetic filings', () => {
    const claims = FS_CORE_TWIN_MAP.fields.map((f, i) => ({ id: f.field, field: f.field, value: 1000 * (i + 1) }))
    for (const [html, pre] of [[LODGING, LODGING_PRE], [TAX2025, TAX2025_PRE]] as const) {
      for (const v02 of [false, true]) {
        const o = v02 ? { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: parseTwinPresentation({ pre, filingSummary: FS })! } : OPTS
        const [a, b] = pair(e => verifyAgainstTwin(html, claims, { ...o, ...eng(e) }).verdict)
        expect(body(b)).toBe(body(a))
      }
    }
  })
  it('reconcile (the golden\'s reconciliation cases)', () => {
    const cases = buildGoldenCases().filter(c => c.id.startsWith('four-way/'))
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      const at = (engine: string) => c.run({ verify, verifyDeclarative, lintRuleset, evalExpr, reconcile: (d: never, rs: never, o: J) => reconcile(d, rs, { ...o, engine }) } as unknown as GoldenApi) as Verdict
      expect(body(at('0.1.0')), c.id).toBe(body(at('0.0.1')))
    }
  })
})

describe('4. the new defaults on the stamped-scan shape (ruleset 0.1.0, no flags): an unreadable total holds the gate', () => {
  const reps: [string, unknown][] = [['null', null], ['blank', ''], ['marker', 'UNREADABLE'], ['marker, lower case', ' unreadable '], ['garbled', '°20'], ['garbled, letter O', 'E 2O']]
  for (const [an, a] of reps) for (const [cn, c] of reps) {
    it(`allowance ${an}, charge ${cn} → BR-CO-13 abstains naming both; PASS-WITH-OPEN`, () => {
      const v = verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: a, charge_total_amount: c }, V1, { now: NOW, engine: '0.1.0' })
      expect(v.engine_version).toBe('0.1.0')
      expect(claim(v, 'document.TAX_EXCL_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['ALLOWANCE', 'CHARGE'] } })
      expect([v.outcome, gateStatus(v), holdsAtGate(gateStatus(v))]).toEqual(['PASS', 'PASS-WITH-OPEN', true])
    })
  }
  it('the boundary is unchanged: absent, with no label in the ruleset or no page text, is absent, and an optional total takes 0', () => {
    expect(claim(verifyDeclarative(N18_SHAPE, V1, { now: NOW }), 'document.TAX_EXCL_INT')?.outcome).toBe('PASS')
  })
  it('under the default e-invoice ruleset of engines 0.1.0 to 0.5.0 (peppol-en16931 → 0.2.0), the blind extraction with its page text: both totals named unreadable by their printed lines', () => {
    // 2026-10-05: under engine 0.6.0 the bare name resolves to peppol-en16931@0.3.0, the version MISSES F4 and F8 were fixed in; engines 0.1.0 to 0.5.0 resolve it to 0.2.0, and a replay re-performs under the version the verdict names.
    const v = verifyDeclarative(N18_SHAPE, resolveDeclarativeRuleset('peppol-en16931', '0.5.0')!, { now: NOW, source: { text: N18_TEXT } })
    expect(v.ruleset).toEqual({ id: 'peppol-en16931', version: '0.2.0', domain: 'e-invoice' })
    // issued under this build's engine (0.6.0), which says why the printed figure was not read (2026-10-05)
    expect(claim(v, 'document.TAX_EXCL_INT')!.insufficiency!.detail).toBe('ALLOWANCE is printed but no value was read: the label "Document allowances" heads line 21 of the source text: "Document allowances EUR 20"; the line prints "20": an amount needs two decimals, so "20" is read as not strict, never as 20.00; CHARGE is printed but no value was read: the label "Document charges" heads line 22 of the source text: "Document charges EU 20 —E"; the line prints "20": an amount needs two decimals, so "20" is read as not strict, never as 20.00')
    expect(gateStatus(v)).toBe('PASS-WITH-OPEN')
  })
})

describe('5. a garbled amount is UNPARSEABLE under the new default, never coerced; its remedy carries the raw string', () => {
  it('"°225.0" as the VAT total (ruleset 0.1.0, no flags): BR-CO-15 abstains, and the remedy names the field and the value as reported', () => {
    const v = verifyDeclarative({ ...N18_SHAPE, tax_amount: '°225.0' }, V1, { now: NOW, source: { text: N18_TEXT }, engine: '0.2.0' })
    expect(claim(v, 'document.TAX_INCL_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['TAX_AMT'] } })
    const r = v.remedies!.find(x => x.operand?.role === 'TAX_AMT')!
    expect(r.kind).toBe('missing-operand')
    expect(r.operand).toEqual({ source: 'e-invoice', role: 'TAX_AMT', path: 'tax_amount' })
    expect(r.detail).toBe('supply TAX_AMT (tax_amount): unreadable at line 24 of the source text: "VAT total i °225.0"; reported as "°225.0". Read it off the document and run the check again')
    // the same value under engine 0.0.1, as that engine read it: 225, so BR-CO-15 FAILs on 7125 vs 5900 + 225
    expect(claim(verifyDeclarative({ ...N18_SHAPE, tax_amount: '°225.0' }, V1, { now: NOW, engine: '0.0.1' }), 'document.TAX_INCL_INT')).toMatchObject({ outcome: 'FAIL', computation: { operands: { left: 7125, right: 6125 } } })
  })
  it('without page text the remedy still carries the value as reported; "1,2?5.00" and "E 2O" are unreadable too', () => {
    for (const raw of ['°225.0', '1,2?5.00', 'E 2O']) {
      const v = verifyDeclarative({ ...N18_SHAPE, tax_amount: raw }, V1, { now: NOW, engine: '0.2.0' })
      expect(claim(v, 'document.TAX_INCL_INT')?.insufficiency?.reason, raw).toBe('UNPARSEABLE')
      expect(v.remedies!.find(x => x.operand?.role === 'TAX_AMT')!.detail, raw).toBe(`supply TAX_AMT (tax_amount): unreadable; reported as ${JSON.stringify(raw)}. Read it off the document and run the check again`)
    }
  })
  it('what still reads as a number: plain and formatted amounts, a currency symbol or code, a sign or parentheses, and a whole CJK numeral', () => {
    for (const s of ['1225', '1225.00', '1,225.00', '1.225,00', 'EUR 1,225.00', '€ 1.225,00', '1 225,00', '(1225.00)']) {
      expect(claim(verifyDeclarative({ ...N18_SHAPE, tax_amount: s }, V1, { now: NOW, engine: '0.1.0' }), 'document.TAX_INCL_INT')?.outcome, s).not.toBe('INSUFFICIENT_DATA')
    }
    const RS: DeclarativeRuleset = { id: 'jp', version: '1', fields: { S: { paths: ['s'] }, T: { paths: ['t'] }, X: { paths: ['x'] } }, checks: [{ code: 'FOOT', left: 'X', op: '=', right: 'S + T' }] }
    expect(verifyDeclarative({ s: 100000, t: 10000, x: '十一万' }, RS, { now: NOW }).outcome).toBe('PASS')
    expect(verifyDeclarative({ s: 100000, t: 10000, x: '十二万' }, RS, { now: NOW }).outcome).toBe('FAIL')
    expect(claim(verifyDeclarative({ s: 100000, t: 10000, x: '十一万?' }, RS, { now: NOW }), 'document.FOOT')?.insufficiency?.reason).toBe('UNPARSEABLE')
    // engine 0.0.1's strict reading (under the flag) refused a CJK numeral, and still does for its verdicts
    expect(claim(verifyDeclarative({ s: 100000, t: 10000, x: '十一万' }, { ...RS, distinguish_unreadable: true }, { now: NOW, engine: '0.0.1' }), 'document.FOOT')?.insufficiency?.reason).toBe('UNPARSEABLE')
  })
  it('a line operand: the remedy names its own line and the value as reported', () => {
    const lines = (N18_SHAPE.lines as J[]).map((l, i) => (i === 2 ? { ...l, line_charge_amount: '1.0O' } : l))
    const v = verifyDeclarative({ ...N18_SHAPE, lines }, V1, { now: NOW, engine: '0.2.0' })
    expect(claim(v, 'line[2].LINE_MATH_INT')).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'UNPARSEABLE', missing: ['LINE_CHARGE'] } })
    expect(v.remedies!.find(x => x.claims.includes('line[2].LINE_MATH_INT'))!.detail).toBe('supply LINE_CHARGE (lines[2].line_charge_amount): unreadable; reported as "1.0O". Read it off the document and run the check again')
  })
})

describe('6. the flags restore the old reading: the 196 representations against engine 0.0.1\'s verdicts', () => {
  const reps = [undefined, null, '', 'UNREADABLE', ' unreadable ', '°20', 200]
  const docs: { d: J; src?: { text: string } }[] = []
  for (const a of reps) for (const c of reps) for (const src of [undefined, { text: N18_TEXT }]) for (const doc of [N18_BLIND, N18_SHAPE]) {
    docs.push({ d: { ...doc, ...(a === undefined ? {} : { allowance_total_amount: a }), ...(c === undefined ? {} : { charge_total_amount: c }) }, ...(src ? { src } : {}) })
  }
  /** Identity set aside: engine_version, verdict_id, and input_hash (a ruleset with the flags is a different input). */
  const reading = (v: Verdict): string => { const { verdict_id: _i, engine_version: _e, input_hash: _h, ...rest } = v; return JSON.stringify(rest) }
  it('both flags off under engine 0.1.0 = engine 0.0.1 on the 0.1.0 ruleset, 196 of 196', () => {
    expect(docs.length).toBe(196)
    const OLD = { ...V1, distinguish_unreadable: false, strict_numbers: false }
    let same = 0
    for (const { d, src } of docs) {
      const a = verifyDeclarative(d, V1, { now: NOW, engine: '0.0.1', ...(src ? { source: src } : {}) })
      const b = verifyDeclarative(d, OLD, { now: NOW, engine: '0.1.0', ...(src ? { source: src } : {}) })
      if (reading(a) === reading(b) && b.engine_version === '0.1.0') same++
    }
    expect(same).toBe(196)
  })
  it('the new default moves the verdicts where a total is seen but not read; elsewhere at most a remedy names its field path', () => {
    const seenNotRead = (x: unknown) => x === null || x === '' || x === 'UNREADABLE' || x === ' unreadable ' || x === '°20'
    let unread = 0, unreadMoved = 0, readable = 0, readableSame = 0, readableRemedyOnly = 0
    for (const { d, src } of docs) {
      const a = verifyDeclarative(d, V1, { now: NOW, engine: '0.0.1', ...(src ? { source: src } : {}) })
      const b = verifyDeclarative(d, V1, { now: NOW, engine: '0.1.0', ...(src ? { source: src } : {}) })
      if (seenNotRead(d.allowance_total_amount) || seenNotRead(d.charge_total_amount)) { unread++; if (body(a) !== body(b)) unreadMoved++; continue }
      readable++
      if (body(a) === body(b)) { readableSame++; continue }
      const core = (v: Verdict) => { const { remedies: _r, ...rest } = JSON.parse(body(v)) as J; return JSON.stringify(rest) }
      if (core(a) === core(b)) readableRemedyOnly++
    }
    // 5 of the 7 representations are seen-but-not-read: 49 − 4 = 45 pairs hold one, × 2 sources × 2 shapes = 180, every one moved.
    // The 16 others (absent or 200 on both sides): the read shape is unchanged; the blind shape's two missing totals' remedies now
    // name their field paths ("supply TAX_EXCL (tax_exclusive_amount)"), outside the hashed core. Nothing else moves.
    expect({ unread, unreadMoved, readable, readableSame, readableRemedyOnly }).toEqual({ unread: 180, unreadMoved: 180, readable: 16, readableSame: 8, readableRemedyOnly: 8 })
  })
  it('each flag alone: strict_numbers false reads "°20" as 20 but still refuses null; distinguish_unreadable false defaults null but still refuses "°20"', () => {
    const tex = (v: Verdict) => claim(v, 'document.TAX_EXCL_INT')!
    const lenient = { ...V1, strict_numbers: false }
    expect(tex(verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: '°20', charge_total_amount: '°20' }, lenient, { now: NOW }))).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 5900, right: 5900 } } })
    expect(tex(verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: null, charge_total_amount: null }, lenient, { now: NOW })).insufficiency?.missing).toEqual(['ALLOWANCE', 'CHARGE'])
    const zeros = { ...V1, distinguish_unreadable: false }
    expect(tex(verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: null, charge_total_amount: null }, zeros, { now: NOW })).outcome).toBe('PASS')
    // the old wording: the first unparseable operand only, and no value as reported
    expect(tex(verifyDeclarative({ ...N18_SHAPE, allowance_total_amount: '°20', charge_total_amount: '°20' }, zeros, { now: NOW })).insufficiency).toEqual({ reason: 'UNPARSEABLE', detail: 'ALLOWANCE is present but could not be parsed as a number', missing: ['ALLOWANCE'] })
  })
  it('lint: strict_numbers must be a boolean; both flags lint clean on the 0.1.0 ruleset', () => {
    expect(lintRuleset({ ...V1, strict_numbers: 'no' as never }).errors).toEqual(['"strict_numbers" must be true or false'])
    expect(lintRuleset({ ...V1, distinguish_unreadable: false, strict_numbers: false })).toMatchObject({ ok: true, errors: [] })
  })
})

describe('7. replay re-performs under the engine the verdict names', () => {
  const d = { ...N18_SHAPE, allowance_total_amount: null, charge_total_amount: null }
  const inputs = { extraction: d, ruleset: V1 }
  it('an engine 0.1.0 verdict replays REPERFORMED; so does the same document issued under 0.0.1, each under its own engine', () => {
    for (const engine of ['0.1.0', '0.0.1']) {
      const v = verifyDeclarative(d, V1, { now: NOW, engine })
      const r = verifyReplay(v, inputs)
      expect([engine, r.status, r.reperformed?.identical]).toEqual([engine, 'REPERFORMED', true])
    }
  })
  it('the switch is real: a 0.1.0 verdict relabelled 0.0.1 (id re-derived to match) is re-performed under 0.0.1, which reads it differently, and FAILS', () => {
    const v = verifyDeclarative(d, V1, { now: NOW, engine: '0.1.0' })
    const relabelled = { ...v, engine_version: '0.0.1', verdict_id: deriveVerdictId(v.input_hash, v.ruleset, '0.0.1') }
    const r = verifyReplay(relabelled, inputs)
    expect([r.id_ok, r.input_ok, r.status, r.reperformed?.identical]).toEqual([true, true, 'FAILED', false])
    expect(r.reason).toMatch(/engine 0\.0\.1/)
  })
  it('a version this build does not carry is not re-performed (structure only), and says which it carries', () => {
    const v = verifyDeclarative(d, V1, { now: NOW, engine: '0.1.0' })
    const foreign = { ...v, engine_version: '0.0.0-old', verdict_id: deriveVerdictId(v.input_hash, v.ruleset, '0.0.0-old') }
    const r = verifyReplay(foreign, inputs)
    expect(r.status).toBe('STRUCTURE_ONLY')
    expect(r.not_reperformed).toMatch(/issued by engine 0\.0\.0-old; this is engine 0\.7\.2, which re-performs engines 0\.0\.1 and 0\.1\.0 and 0\.2\.0 and 0\.3\.0 and 0\.4\.0 and 0\.5\.0 and 0\.6\.0 and 0\.7\.0 and 0\.7\.1 and 0\.7\.2 only/)
  })
})

describe('8. ruleset names: peppol-en16931 → 0.3.0 under engine 0.6.0 (the default e-invoice ruleset; 0.2.0 before), @0.1.0 kept', () => {
  // 2026-10-05: under engine 0.6.0 the bare name resolves to peppol-en16931@0.3.0, the version MISSES F4 and F8 were fixed in; engines 0.1.0 to 0.5.0 resolve it to 0.2.0, and a replay re-performs under the version the verdict names.
  it('the files are where the pins say, and the embedded copies are verbatim', () => {
    expect(sha256(readFileSync(V1_PATH))).toBe('0a3cd5a52e6a835a8649ac8fa831bce47906ae77e5be2bdb85a70d1a9a0cd81c')
    expect(sha256(readFileSync(V2_PATH))).toBe('c0e1ae6cc4c8bf6894caedc11c2cbfb9ea351169c09752a1cbd572603d66b66d')
    expect(PEPPOL_EN16931_V0_2_0).toEqual(V2)
    expect(HOUSE_PEPPOL_RULESET).toEqual(V1)
    // 2026-10-03: 0.3.0 is carried by name too (not the default)
    expect(DECLARATIVE_RULESETS.map(r => `${r.id}@${r.version}`)).toEqual(['peppol-en16931@0.1.0', 'peppol-en16931@0.2.0', 'peppol-en16931@0.3.0'])
  })
  it('resolution: no version → 0.3.0 (0.2.0 under engines 0.1.0 to 0.5.0); @0.1.0 → 0.1.0; e-invoice → the default; an uncarried version is refused; anything else is not a name', () => {
    expect(resolveDeclarativeRuleset('peppol-en16931')).toEqual(V3)
    expect(resolveDeclarativeRuleset('peppol-en16931', '0.6.0')).toEqual(V3)
    expect(resolveDeclarativeRuleset('peppol-en16931', '0.5.0')).toEqual(V2)
    expect(resolveDeclarativeRuleset('peppol-en16931', '0.1.0')).toEqual(V2)
    expect(resolveDeclarativeRuleset('peppol-en16931@0.2.0')).toEqual(V2)
    expect(resolveDeclarativeRuleset('peppol-en16931@0.2.0', '0.6.0')).toEqual(V2)
    expect(resolveDeclarativeRuleset('peppol-en16931@0.1.0')).toEqual(V1)
    expect(resolveDeclarativeRuleset('e-invoice')).toEqual(V3)
    expect(resolveDeclarativeRuleset('e-invoice', '0.5.0')).toEqual(V2)
    expect(() => resolveDeclarativeRuleset('peppol-en16931@9.9.9')).toThrow('ruleset peppol-en16931@9.9.9 is not one this build carries; it carries peppol-en16931@0.1.0, peppol-en16931@0.2.0, peppol-en16931@0.3.0')
    expect([resolveDeclarativeRuleset('peppol.json'), resolveDeclarativeRuleset('legal'), resolveDeclarativeRuleset('e-invoice@0.2.0')]).toEqual([undefined, undefined, undefined])
    expect([isDeclarativeRulesetName('peppol-en16931@0.1.0'), isDeclarativeRulesetName('./peppol-en16931')]).toEqual([true, false])
    // a fresh copy each time: a caller cannot change the carried ruleset
    const a = resolveDeclarativeRuleset('peppol-en16931')!; a.checks.length = 0
    expect(resolveDeclarativeRuleset('peppol-en16931')!.checks.length).toBe(V3.checks.length)
  })
  it('a verdict made under a resolved name is the verdict made under the file, byte for byte', () => {
    for (const [name, file] of [['peppol-en16931', V3], ['peppol-en16931@0.2.0', V2], ['peppol-en16931@0.1.0', V1]] as const) {
      expect(JSON.stringify(verifyDeclarative(N18_SHAPE, resolveDeclarativeRuleset(name)!, { now: NOW }))).toBe(JSON.stringify(verifyDeclarative(N18_SHAPE, file, { now: NOW })))
    }
  })
  it('CLI: --ruleset peppol-en16931 issues under 0.3.0, @0.1.0 under 0.1.0, e-invoice under 0.3.0; replay takes the name too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e1-names-'))
    const p = (n: string) => join(dir, n)
    writeFileSync(p('doc.json'), JSON.stringify(N18_SHAPE))
    const issue = (rs: string): { code: number; v: Verdict | undefined; err: string } => {
      let out = '', err = ''
      const code = run([p('doc.json'), '--ruleset', rs], { out: s => { out += s }, err: s => { err += s } })
      return { code, v: out ? JSON.parse(out) as Verdict : undefined, err }
    }
    const v2 = issue('peppol-en16931'), v1 = issue('peppol-en16931@0.1.0'), ve = issue('e-invoice'), vf = issue(V3_PATH)
    expect([v2.v!.ruleset.version, v1.v!.ruleset.version, ve.v!.ruleset.version]).toEqual(['0.3.0', '0.1.0', '0.3.0'])
    expect([v2.v!.engine_version, v1.v!.engine_version]).toEqual(['0.7.2', '0.7.2']) // the current engine (0.4.0, then 0.5.0; 2026-10-05: 0.6.0; 2026-10-13: 0.7.0, then 0.7.1; 2026-10-14: 0.7.2)
    expect(v2.v!.verdict_id).toBe(vf.v!.verdict_id)
    const bad = issue('peppol-en16931@9.9.9')
    expect([bad.code, bad.err]).toEqual([3, expect.stringContaining('it carries peppol-en16931@0.1.0, peppol-en16931@0.2.0, peppol-en16931@0.3.0')])
    writeFileSync(p('v1.json'), JSON.stringify(v1.v))
    let rOut = ''
    expect(run(['replay', p('v1.json'), '--extraction', p('doc.json'), '--ruleset', 'peppol-en16931@0.1.0'], { out: s => { rOut += s }, err: () => {} })).toBe(0)
    expect((JSON.parse(rOut) as { status: string }).status).toBe('REPERFORMED')
    let lintOut = ''
    expect(run(['lint', '--ruleset', 'peppol-en16931'], { out: s => { lintOut += s }, err: () => {} })).toBe(0)
    expect(JSON.parse(lintOut)).toMatchObject({ ok: true, errors: [] })
  })
  it('HTTP /v1/verify/declared and MCP verify_declared take the name; an unknown name is refused with the names carried', () => {
    const r = route({ method: 'POST', path: '/v1/verify/declared', body: { extraction: N18_SHAPE, ruleset: 'peppol-en16931' } })
    expect([r.status, (r.json as Verdict).ruleset.version]).toEqual([200, '0.3.0'])
    const r1 = route({ method: 'POST', path: '/v1/verify/declared', body: { extraction: N18_SHAPE, ruleset: 'peppol-en16931@0.1.0' } })
    expect((r1.json as Verdict).ruleset.version).toBe('0.1.0')
    const bad = route({ method: 'POST', path: '/v1/verify/declared', body: { extraction: N18_SHAPE, ruleset: 'peppol' } })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.json)).toContain('peppol-en16931@0.1.0')
    expect(route({ method: 'POST', path: '/v1/verify/declared', body: { extraction: N18_SHAPE, ruleset: 'peppol-en16931@9.9.9' } }).status).toBe(400)
    const m = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_declared', arguments: { extraction: N18_SHAPE, ruleset: 'e-invoice' } } } as JsonRpcRequest)!
    expect((m.result as { structuredContent: Verdict }).structuredContent.ruleset.version).toBe('0.3.0')
  })
  it('the legal default: legal@0.5.4 for a new verdict under this build (2026-10-14; legal@0.5.3 under engine 0.7.1), legal@0.5.2 under engine 0.6.0 (2026-10-06, after 0.5.1 earlier that day; 0.2.0, 0.3.0, 0.4.0, then 0.5.0 on 2026-10-05), legal@0.0.1 under earlier engines', () => {
    expect(verifyCitations([{ id: '1', case_name: 'A', quote: 'x' }], { A: 'x' }, { now: NOW }).ruleset).toMatchObject({ id: 'legal', version: '0.5.4' })
    expect(verifyCitations([{ id: '1', case_name: 'A', quote: 'x' }], { A: 'x' }, { now: NOW, engine: '0.6.0' }).ruleset).toMatchObject({ id: 'legal', version: '0.5.2' })
    expect(verifyCitations([{ id: '1', case_name: 'A', quote: 'x' }], { A: 'x' }, { now: NOW, engine: '0.5.0' }).ruleset).toMatchObject({ id: 'legal', version: '0.0.1' })
  })
})

describe('9. what the new defaults move on the goldens, measured (both goldens still pass byte for byte under engine 0.0.1)', () => {
  type O = Record<string, unknown>
  const at = (engine: string) => ({
    verify: (x: O, o: O) => verify(x, { ...o, engine }),
    verifyDeclarative: (x: O, rs: never, o: O) => verifyDeclarative(x, rs, { ...o, engine }),
    reconcile: (d: Record<string, O>, rs: never, o: O) => reconcile(d, rs, { ...o, engine }),
    lintRuleset, evalExpr,
  }) as unknown as GoldenApi & GoldenApiV010
  const measure = (cases: { id: string; run: (api: never) => unknown }[]) => {
    let moved = 0, remediesOnly = 0, verdictOutcomes = 0
    const claimOutcomes: string[] = []
    for (const c of cases) {
      const a = c.run(at('0.0.1') as never) as Verdict, b = c.run(at('0.1.0') as never) as Verdict
      if (!a || typeof a !== 'object' || !('claims' in a)) continue
      if (body(a) === body(b)) continue
      moved++
      if (a.outcome !== b.outcome) verdictOutcomes++
      const { remedies: _ra, ...ca } = JSON.parse(body(a)) as J, { remedies: _rb, ...cb } = JSON.parse(body(b)) as J
      if (JSON.stringify(ca) === JSON.stringify(cb)) { remediesOnly++; continue }
      a.claims.forEach((x, i) => { const y = b.claims[i]!; if (x.outcome !== y.outcome) claimOutcomes.push(`${c.id} ${x.claim_id} ${x.outcome}->${y.outcome}`) })
    }
    return { moved, remediesOnly, verdictOutcomes, claimOutcomes }
  }
  it('first golden (489): no verdict outcome and no claim outcome moves; 388 results move in wording (260 in their remedies only)', () => {
    expect(measure(buildGoldenCases() as never)).toEqual({ moved: 388, remediesOnly: 260, verdictOutcomes: 0, claimOutcomes: [] })
  })
  it('e-invoice golden (177): no verdict outcome moves; 8 line claims move FAIL → abstain, where a null allowance/charge list now reads as unreadable', () => {
    const m = measure(buildGoldenCasesV010() as never)
    expect([m.moved, m.remediesOnly, m.verdictOutcomes, m.claimOutcomes.length]).toEqual([98, 41, 0, 8])
    expect(m.claimOutcomes.every(s => / line\[\d+\]\.LINE_MATH_INT FAIL->INSUFFICIENT_DATA$/.test(s))).toBe(true)
  })
})

describe('10. a succession replay is re-performed under the engine it names', () => {
  const MINI = (version: string): DeclarativeRuleset => ({ id: 'mini', version, fields: { A: { paths: ['a'], default: 0 }, T: { paths: ['t'] }, S: { paths: ['s'] } }, checks: [{ code: 'C', left: 'T', op: '=', right: 'S - A' }] })
  const book = () => {
    let clock = Date.parse('2026-10-03T00:00:00Z')
    const led = createLedger({ now: () => new Date((clock += 60_000)) })
    const inputs = new Map<string, unknown>()
    for (const [i, a] of [null, 5, null].entries()) {
      const x = { s: 100, t: a === null ? 100 : 95, a, n: i }
      const v = verifyDeclarative(x, MINI('1.0.0'), { now: NOW, engine: '0.0.1' })
      led.record(v, { tenant_id: 'acme' })
      inputs.set(v.verdict_id, { extraction: x, ruleset: MINI('1.0.0') })
    }
    return { led, inputs }
  }
  it('engine 0.0.1 reads the null allowance as 0 and changes nothing; engine 0.1.0 holds the two null ones open; each replay names its engine', () => {
    const b = book()
    const o = { inputs: (v: Verdict) => b.inputs.get(v.verdict_id), ruleset: MINI('1.1.0') }
    const r001 = successionReplay(b.led, 'acme/mini@1.0.0', 'acme/mini@1.1.0', { ...o, engine: '0.0.1' }).replay
    const r010 = successionReplay(b.led, 'acme/mini@1.0.0', 'acme/mini@1.1.0', { ...o, engine: '0.1.0' }).replay // named (0.2.0 is current)
    expect([r001.engine_version, r001.reperformed, r001.changed.length]).toEqual(['0.0.1', 3, 0])
    expect([r010.engine_version, r010.reperformed, r010.changed.map(c => `${c.from}->${c.to}`)]).toEqual(['0.1.0', 3, ['PASS->INSUFFICIENT_DATA', 'PASS->INSUFFICIENT_DATA']])
    // a signed replay that names 0.0.1 is checked under 0.0.1: the same replay, byte for byte
    const grant = { signed: { decision: { workflow_id: 'acme/mini@1.1.0', succeeds: { from: 'acme/mini@1.0.0', replay: r001 } } } } as unknown as DecisionEntry<GrantDecision>
    const c = checkSuccessionReplay(b.led, grant, o)
    expect([c.ok, c.differences]).toEqual([true, []])
    const grant010 = { signed: { decision: { workflow_id: 'acme/mini@1.1.0', succeeds: { from: 'acme/mini@1.0.0', replay: r010 } } } } as unknown as DecisionEntry<GrantDecision>
    expect(checkSuccessionReplay(b.led, grant010, o).ok).toBe(true)
  })
})
