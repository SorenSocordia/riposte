/**
 * KSeF FA(3) ruleset 0.2.0 (E-INVOICE-2, 2026-09-28): the DoZaplaty identity, an ADDITION (not a correction) to the
 * 0.1.0 ruleset. It is stated by the FA(3) XSD (Rozliczenie/DoZaplaty, quoted in the ruleset's `sources`) and by the MF
 * information sheet (p.105). Pre-registered in "KSeF FA(3) DoZaplaty identity" (pre-registration, 2026-09-28). The set
 * (fixtures/ksef-dozaplaty-set.ts) and the XML documents below are CONSTRUCTED. The 0.1.0 content stays tested on its
 * frozen bytes (ksef.test.ts, ruleset-corrections.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative, lintRuleset, measureRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'
import { verifyEinvoiceTwin } from '../src/twin-einvoice/index'
import { KSEF_DOZAPLATY_SET } from './fixtures/ksef-dozaplaty-set'
import { KSEF_SET } from './fixtures/einvoice-ruleset-corrections-set'

const HERE = dirname(fileURLToPath(import.meta.url))
const json = (...p: string[]): DeclarativeRuleset => JSON.parse(readFileSync(join(HERE, ...p), 'utf8')) as DeclarativeRuleset
const LIVE = json('..', 'docs', 'examples', 'ksef-fa3.ruleset.json')
const V010 = json('fixtures', 'golden-rulesets', 'ksef-fa3.ruleset.v0.1.0.json')
const run = (x: Record<string, unknown>, rs: DeclarativeRuleset = LIVE): Verdict => verifyDeclarative(x, rs, { now: () => new Date(0) })
const dz = (x: Record<string, unknown>) => run(x).claims.find(c => c.claim_id === 'document.DOZAPLATY_INT')!
const item = (Kwota: number, Powod = 'x') => ({ Kwota, Powod })

describe('the live KSeF ruleset is 0.2.0 and carries the DoZaplaty identity with its raw source', () => {
  it('version, strict tolerance, the check, and the XSD documentation quoted in `sources`', () => {
    expect(LIVE).toMatchObject({ id: 'ksef-fa3-pl', version: '0.2.0', tolerance: { rel: 0, absCap: 0 } })
    expect(LIVE.sources!['FA3-XSD-DoZaplaty']).toContain("'Kwota należności do zapłaty równa polu P_15 powiększonemu o Obciazenia i pomniejszonemu o Odliczenia'")
    expect(LIVE.checks.find(c => c.code === 'DOZAPLATY_INT')).toMatchObject({ left: 'DO_ZAPLATY', right: 'P_15 + SUMA_OBCIAZEN? - SUMA_ODLICZEN?', tol: 0.005 })
    expect(LIVE.checks.find(c => c.code === 'LINE_NET_INT')!.tol).toBe(0.020001)
    const l = lintRuleset(LIVE)
    expect(l.errors).toEqual([])
    expect(l.warnings).toEqual([expect.stringMatching(/^check\[0\] \(GROSS_INT\): declared abstention/)])
  })
  it('it is an addition: apart from DoZaplaty and the strict tolerance, 0.1.0 is unchanged', () => {
    const strip = (rs: DeclarativeRuleset) => ({ ...rs, version: '-', tolerance: null, sources: { ...rs.sources, 'FA3-XSD-DoZaplaty': undefined },
      fields: Object.fromEntries(Object.entries(rs.fields).filter(([k]) => !['DO_ZAPLATY', 'SUMA_OBCIAZEN', 'SUMA_ODLICZEN', 'OBCIAZENIA', 'ODLICZENIA'].includes(k))),
      checks: rs.checks.filter(c => c.code !== 'DOZAPLATY_INT').map(c => ({ ...c, tol: c.code === 'LINE_NET_INT' ? 0.02 : c.tol })) })
    expect(JSON.parse(JSON.stringify(strip(LIVE)))).toEqual(JSON.parse(JSON.stringify(strip(V010))))
  })
})

describe('DOZAPLATY_INT = P_15 + SumaObciazen − SumaOdliczen, exact to the cent', () => {
  it('PASSes with Obciazenia and Odliczenia present (their stated sums read)', () => {
    expect(dz({ P_15: 500, Rozliczenie: { Obciazenia: [item(20)], SumaObciazen: 20, Odliczenia: [item(50), item(20)], SumaOdliczen: 70, DoZaplaty: 450 } }).outcome).toBe('PASS')
    expect(dz({ P_15: 31.5, Rozliczenie: { Obciazenia: [item(5)], SumaObciazen: 5, DoZaplaty: 36.5 } }).outcome).toBe('PASS')
  })
  it('PASSes with both absent (nothing added or deducted: DoZaplaty = P_15)', () => {
    const c = dz({ P_15: 100, Rozliczenie: { DoZaplaty: 100 } })
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/Optional terms not reported \(counted as 0\): SUMA_OBCIAZEN, SUMA_ODLICZEN/)
  })
  it('a cent-level miss FAILs, including 0.02 on a large invoice (the old capped band would have forgiven it)', () => {
    expect(dz({ P_15: 500, Rozliczenie: { SumaObciazen: 20, SumaOdliczen: 70, DoZaplaty: 450.01 } })).toMatchObject({ outcome: 'FAIL', variance: 0.01 })
    expect(dz({ P_15: 250000, Rozliczenie: { DoZaplaty: 250000.02 } })).toMatchObject({ outcome: 'FAIL', variance: 0.02 })
    expect(dz({ P_15: 1230, Rozliczenie: { Odliczenia: [item(200)], SumaOdliczen: 200, DoZaplaty: 1430 } })).toMatchObject({ outcome: 'FAIL', variance: 400 })
  })
  it('the guard abstains, with its reason, where the terms cannot be read', () => {
    const c = dz({ P_15: 40, Rozliczenie: { Obciazenia: [item(2.5)], DoZaplaty: 42.5 } })
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'OUT_OF_RULESET_SCOPE' })
    expect(c.insufficiency!.detail).toBe('guard abstain_if_present_without: OBCIAZENIA is reported (Rozliczenie.Obciazenia) without SUMA_OBCIAZEN; the identity reads SUMA_OBCIAZEN in its place. Reason: the MF sheet (p.105) defines SumaObciazen / SumaOdliczen as the sum of the items\' Kwota; this ruleset reads the stated sum and does not add up the items itself')
    expect(dz({ P_15: 40, Rozliczenie: { Odliczenia: [item(2.5)], DoZaplaty: 37.5 } }).insufficiency!.detail).toMatch(/ODLICZENIA is reported .* without SUMA_ODLICZEN/)
    expect(dz({ P_15: 40, Rozliczenie: { SumaObciazen: 'n/a', DoZaplaty: 42.5 } }).insufficiency).toMatchObject({ reason: 'UNPARSEABLE' })
    expect(dz({ P_15: 100, Rozliczenie: { SumaOdliczen: 150, DoRozliczenia: 50 } }).insufficiency).toMatchObject({ reason: 'FIELD_MISSING' }) // DoRozliczenia is not checked
  })
  it('the pre-registered constructed set: 12/12 as predicted; 0.1.0 never checked it', () => {
    for (const c of KSEF_DOZAPLATY_SET) {
      const o = dz(c.extraction).outcome
      expect(o === 'INSUFFICIENT_DATA' ? 'ABSTAIN' : o, c.id).toBe(c.expect)
      expect(run(c.extraction, V010).claims.some(x => x.claim_id === 'document.DOZAPLATY_INT'), c.id).toBe(false)
    }
  })
  it('the 0.1.0 corrections set measures the same under 0.2.0 (LINE_NET_INT unchanged)', () => {
    const counts = (rs: DeclarativeRuleset) => { const { tp, tn, fp, fn, abstain, total } = measureRuleset(rs, KSEF_SET.map(c => ({ extraction: c.extraction, label: c.label }))).metrics; return { tp, tn, fp, fn, abstain, total } }
    expect(counts(LIVE)).toEqual(counts(V010))
    const lines = (rs: DeclarativeRuleset) => KSEF_SET.map(c => run(c.extraction, rs).claims.filter(x => x.rule_id === 'LINE_NET_INT').map(x => x.outcome))
    expect(lines(LIVE)).toEqual(lines(V010))
    for (const [a, n] of [[0.05, 0.07], [0.07, 0.05], [1.1, 1.12]]) expect(run({ P_15: 1, lines: [{ P_8B: 1, P_9A: a, P_11: n }] }).claims.find(x => x.claim_id === 'line[0].LINE_NET_INT')!.outcome).toBe('PASS')
  })
})

describe('the e-invoice twin reports it from the XML as FA3-XSD:DoZaplaty (SPEC)', () => {
  const doc = (rozliczenie: string, p15 = '31.50') => `<?xml version="1.0" encoding="UTF-8"?><Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek><Fa><KodWaluty>PLN</KodWaluty><P_15>${p15}</P_15>${rozliczenie}</Fa></Faktura>`
  const rule = (xml: string) => verifyEinvoiceTwin(xml, [], { now: () => new Date(0) }).consistency.find(c => c.house_code === 'DOZAPLATY_INT')!
  it('PASSes and cites P_15 and the Rozliczenie amounts by span', () => {
    const k = rule(doc('<Rozliczenie><Obciazenia><Kwota>5</Kwota><Powod>Kaucja</Powod></Obciazenia><SumaObciazen>5</SumaObciazen><DoZaplaty>36.5</DoZaplaty></Rozliczenie>'))
    expect(k).toMatchObject({ rule_id: 'FA3-XSD:DoZaplaty', provenance: 'SPEC', outcome: 'PASS', claim_id: 'xml.document.FA3-XSD:DoZaplaty' })
    expect(k.operands.map(o => `${o.term}=${o.value}@${o.xpath}`)).toEqual(['P_15=31.5@/Faktura/Fa/P_15', 'DoZaplaty=36.5@/Faktura/Fa/Rozliczenie/DoZaplaty', 'SumaObciazen=5@/Faktura/Fa/Rozliczenie/SumaObciazen'])
  })
  it('FAILs an inconsistent DoZaplaty; abstains on items without their Suma, or with no Rozliczenie', () => {
    expect(rule(doc('<Rozliczenie><Odliczenia><Kwota>1000</Kwota><Powod>x</Powod></Odliczenia><SumaOdliczen>1000</SumaOdliczen><DoZaplaty>63279.93</DoZaplaty></Rozliczenie>', '64279.92'))).toMatchObject({ outcome: 'FAIL', claim: { variance: 0.01 } })
    expect(rule(doc('<Rozliczenie><Obciazenia><Kwota>5</Kwota><Powod>x</Powod></Obciazenia><DoZaplaty>36.5</DoZaplaty></Rozliczenie>')).detail).toMatch(/^guard abstain_if_present_without: OBCIAZENIA/)
    expect(rule(doc('')).outcome).toBe('ABSTAIN')
  })
})
