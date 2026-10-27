/**
 * The 2026-09-28 e-invoice ruleset corrections (docs/RULESET-CORRECTIONS-2026-09-28.md): regression tests for each
 * field bug in the shipped 0.0.1 rulesets, the engine additions they needed (declared abstention, guard reasons, the
 * full-precision `price` kind, `sources`), and the pre-registered before/after measurement
 * (ruleset-corrections pre-registration, frozen 2026-09-28 09:35).
 *
 * BEFORE = the shipped 0.0.1 bytes (test/fixtures/golden-rulesets/*.v0.0.1.json). AFTER = docs/examples/*.ruleset.json.
 * All documents are CONSTRUCTED from the specs; none is field data.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeclarative, lintRuleset, measureRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'
import { PEPPOL_SET, ZATCA_SET, KSEF_SET, type SetCase } from './fixtures/einvoice-ruleset-corrections-set'

const HERE = dirname(fileURLToPath(import.meta.url))
const json = (...p: string[]): DeclarativeRuleset => JSON.parse(readFileSync(join(HERE, ...p), 'utf8')) as DeclarativeRuleset
const NOW = () => new Date('2026-09-28T00:00:00Z')
const AFTER = {
  peppol: json('..', 'docs', 'examples', 'peppol-en16931.ruleset.json'),
  zatca: json('..', 'docs', 'examples', 'zatca-ksa.ruleset.json'),
  // pinned to the frozen 0.1.0 bytes (pinned 2026-09-28): the live KSeF file moved on to 0.2.0 (DoZaplaty)
  ksef: json('fixtures', 'golden-rulesets', 'ksef-fa3.ruleset.v0.1.0.json'),
}
const BEFORE = {
  peppol: json('fixtures', 'golden-rulesets', 'peppol-en16931.ruleset.v0.0.1.json'),
  zatca: json('fixtures', 'golden-rulesets', 'zatca-ksa.ruleset.v0.0.1.json'),
  ksef: json('fixtures', 'golden-rulesets', 'ksef-fa3.ruleset.v0.0.1.json'),
}
const run = (x: Record<string, unknown>, rs: DeclarativeRuleset): Verdict => verifyDeclarative(x, rs, { now: NOW })
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}; have ${v.claims.map(x => x.claim_id).join(', ')}`); return c }
const setCase = (set: SetCase[], id: string): Record<string, unknown> => set.find(c => c.id === id)!.extraction

describe('the corrected rulesets are 0.1.0, lint clean, and cite their sources', () => {
  it('versions bumped, ids unchanged, every source a URL, every UBL check name carries its spec rule id', () => {
    expect([AFTER.peppol.version, AFTER.zatca.version, AFTER.ksef.version]).toEqual(['0.1.0', '0.1.0', '0.1.0'])
    expect([AFTER.peppol.id, AFTER.zatca.id, AFTER.ksef.id]).toEqual([BEFORE.peppol.id, BEFORE.zatca.id, BEFORE.ksef.id])
    for (const rs of Object.values(AFTER)) for (const url of Object.values(rs.sources ?? {})) expect(url).toMatch(/^https?:\/\//)
    const ids = (rs: DeclarativeRuleset) => rs.checks.map(c => /^(BR-[A-Z0-9-]+|PEPPOL-EN16931-R\d+)/.exec(c.name ?? '')?.[1])
    expect(ids(AFTER.peppol)).toEqual(['BR-CO-10', 'BR-CO-13', 'BR-CO-15', 'BR-CO-16', 'PEPPOL-EN16931-R120'])
    expect(ids(AFTER.zatca)).toEqual(['BR-CO-10', 'BR-CO-13', 'BR-CO-15', 'BR-CO-16', 'BR-KSA-EN16931-11'])
  })
  it('lints with no errors; the only warning is the declared KSeF abstention', () => {
    for (const rs of [AFTER.peppol, AFTER.zatca]) expect(lintRuleset(rs)).toEqual({ ok: true, errors: [], warnings: [] })
    const k = lintRuleset(AFTER.ksef)
    expect(k.errors).toEqual([])
    expect(k.warnings).toHaveLength(1)
    expect(k.warnings[0]).toMatch(/^check\[0\] \(GROSS_INT\): declared abstention/)
  })
  it('the UBL rulesets carry no relative band (the spec is exact to the cent)', () => {
    expect(AFTER.peppol.tolerance).toEqual({ rel: 0, absCap: 0 })
    expect(AFTER.zatca.tolerance).toEqual({ rel: 0, absCap: 0 })
    expect(BEFORE.peppol.tolerance).toBeUndefined() // the bug: the engine default { rel: 0.0003, absCap: 0 } applied
  })
})

describe('bug 1: KSeF FA(3) field names (P_13_6 / P_10_Dodatki do not exist; P_13_6_1..3 and P_13_8..P_13_11 do)', () => {
  const inv = { lines: [{ P_8B: 10, P_9A: 100, P_11: 1000 }, { P_8B: 1, P_9A: 500, P_11: 500 }, { P_8B: 1, P_9A: 250, P_11: 250 }, { P_8B: 6, P_9A: 100, P_11: 600 }, { P_8B: 1, P_9A: 350, P_11: 350 }],
    P_13_1: 1000, P_14_1: 230, P_13_8: 500, P_13_9: 250, P_13_10: 600, P_13_11: 350, P_15: 2930 }
  it('a valid FA(3) with P_13_8..P_13_11 PASSes (0.0.1 FAILed it: its sum omitted those buckets)', () => {
    const before = run(inv, BEFORE.ksef)
    expect(claim(before, 'document.GROSS_INT')).toMatchObject({ outcome: 'FAIL', variance: 1700 })
    const after = run(inv, AFTER.ksef)
    expect(after.outcome).toBe('PASS')
    for (let i = 0; i < 5; i++) expect(claim(after, `line[${i}].LINE_NET_INT`).outcome).toBe('PASS')
  })
  it('the corrected candidate formula itself sums every FA(3) bucket: with the abstention lifted, it foots the same invoice and 0%-rated buckets', () => {
    const lifted: DeclarativeRuleset = { ...AFTER.ksef, checks: AFTER.ksef.checks.map(c => { const { abstain: _drop, ...rest } = c; return rest }) }
    expect(claim(run(inv, lifted), 'document.GROSS_INT').outcome).toBe('PASS')
    const zero = { lines: [{ P_8B: 1, P_9A: 100, P_11: 100 }], P_13_1: 100, P_14_1: 23, P_13_6_1: 200, P_13_6_2: 300, P_13_6_3: 400, P_15: 1023 }
    expect(claim(run(zero, lifted), 'document.GROSS_INT').outcome).toBe('PASS')
    expect(claim(run(zero, BEFORE.ksef), 'document.GROSS_INT').outcome).toBe('FAIL') // 0.0.1 read a non-existent P_13_6
    expect(Object.keys(AFTER.ksef.fields)).not.toContain('P_13_6')
    expect(Object.keys(AFTER.ksef.fields)).not.toContain('P_10_Dodatki')
  })
  it('GROSS_INT is a declared abstention on every document: no primary source states P_15 = Σ P_13_x + Σ P_14_x', () => {
    const c = claim(run(inv, AFTER.ksef), 'document.GROSS_INT')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'OUT_OF_RULESET_SCOPE' })
    expect(c.insufficiency!.detail).toMatch(/^declared abstention: UNSOURCED\. Neither the FA\(3\) XSD nor the MF information sheet/)
    // the published cost: a wrong P_15 is no longer caught in JSON mode
    expect(run({ ...inv, P_15: 9999 }, AFTER.ksef).outcome).toBe('PASS')
  })
  it('LINE_NET_INT (P_11 = P_8B × P_9A) abstains, with its reason, when P_10, P_9B or P_11A is reported', () => {
    for (const extra of [{ P_10: 10 }, { discount: 10 }, { P_9B: 123 }, { P_11A: 1230 }]) {
      const c = claim(run({ lines: [{ P_8B: 10, P_9A: 100, P_11: 900, ...extra }], P_15: 1 }, AFTER.ksef), 'line[0].LINE_NET_INT')
      expect(c.outcome).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency!.detail).toMatch(/^guard abstain_if_present: P_(10|9B|11A) is reported .*\. Reason: P_10 \(discounts not already in the net unit price\) is not stated as per unit or per line/)
    }
    // 0.0.1 read P_10 as a per-unit discount (a guess): 10 × (100 − 10) = 900 PASSed; a per-line reading would disagree
    expect(claim(run({ lines: [{ P_8B: 10, P_9A: 100, P_11: 900, P_10: 10 }], P_15: 1 }, BEFORE.ksef), 'line[0].LINE_NET_INT').outcome).toBe('PASS')
  })
  it('a wrong line net value still FAILs; negative correction lines foot (MF Przykład 23)', () => {
    expect(claim(run({ lines: [{ P_8B: 10, P_9A: 100, P_11: 999 }], P_15: 1 }, AFTER.ksef), 'line[0].LINE_NET_INT')).toMatchObject({ outcome: 'FAIL', variance: -1 })
    expect(claim(run({ lines: [{ P_8B: -1, P_9A: 90, P_11: -90 }], P_15: -110.7 }, AFTER.ksef), 'line[0].LINE_NET_INT').outcome).toBe('PASS')
  })
})

describe('bug 2: Peppol / ZATCA were not exact to the cent (uncapped 0.03% band + a 0.01 floor)', () => {
  it('a one-cent BR-CO-15 error FAILs (0.0.1 PASSed it)', () => {
    for (const [name, set] of [['peppol', PEPPOL_SET], ['zatca', ZATCA_SET]] as const) {
      const x = setCase(set, 'E3-one-cent-BR-CO-15')
      expect(claim(run(x, BEFORE[name]), 'document.TAX_INCL_INT').outcome, name).toBe('PASS')
      const c = claim(run(x, AFTER[name]), 'document.TAX_INCL_INT')
      expect(c.outcome, name).toBe('FAIL')
      expect(c.variance, name).toBe(0.01)
      expect(c.computation!.tolerance).toEqual({ abs: 0.005 })
    }
  })
  it('a one-cent BR-CO-10 error FAILs; a 300.00 error on a 1M invoice FAILs (0.0.1 forgave both)', () => {
    expect(claim(run(setCase(PEPPOL_SET, 'E4-one-cent-BR-CO-10'), AFTER.peppol), 'document.LINES_SUM_INT').outcome).toBe('FAIL')
    const big = setCase(PEPPOL_SET, 'E5-band-hidden-300')
    expect(claim(run(big, BEFORE.peppol), 'document.TAX_INCL_INT').outcome).toBe('PASS')
    expect(claim(run(big, AFTER.peppol), 'document.TAX_INCL_INT')).toMatchObject({ outcome: 'FAIL', variance: 300 })
  })
  it('an exact 1,000,000.00 invoice still PASSes (floating point does not break exactness)', () => {
    expect(run(setCase(PEPPOL_SET, 'C7-large-exact'), AFTER.peppol).outcome).toBe('PASS')
    expect(run(setCase(ZATCA_SET, 'C7-large-exact'), AFTER.zatca).outcome).toBe('PASS')
  })
  it('BT-110 is required (BR-CO-15): an extraction without tax_amount abstains on BR-CO-15 instead of reading it as 0', () => {
    const x = setCase(PEPPOL_SET, 'C8-tax-not-extracted')
    expect(claim(run(x, BEFORE.peppol), 'document.TAX_INCL_INT').outcome).toBe('FAIL')
    const c = claim(run(x, AFTER.peppol), 'document.TAX_INCL_INT')
    expect(c).toMatchObject({ outcome: 'INSUFFICIENT_DATA', insufficiency: { reason: 'FIELD_MISSING' } })
    expect(run(x, AFTER.peppol).outcome).toBe('PASS')
  })
})

describe('bug 3: the line check ignored line allowances and charges (BT-136 / BT-141)', () => {
  it('a correct discounted Peppol line PASSes (0.0.1 FAILed it)', () => {
    const x = { lines: [{ invoiced_quantity: 10, price_amount: 100, line_allowance_amount: 50, line_extension_amount: 950 }],
      line_extension_amount: 950, tax_exclusive_amount: 950, tax_amount: 190, tax_inclusive_amount: 1140, payable_amount: 1140 }
    expect(claim(run(x, BEFORE.peppol), 'line[0].LINE_MATH_INT')).toMatchObject({ outcome: 'FAIL', variance: -50 })
    const after = run(x, AFTER.peppol)
    expect(claim(after, 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(after.outcome).toBe('PASS')
  })
  it('line charges, and an allowance plus a charge on one line, PASS on Peppol and ZATCA', () => {
    for (const [name, set] of [['peppol', PEPPOL_SET], ['zatca', ZATCA_SET]] as const) {
      for (const id of ['C4-line-charge', 'C5-line-allowance-and-charge']) expect(run(setCase(set, id), AFTER[name]).outcome, `${name} ${id}`).toBe('PASS')
    }
  })
  it('an allowance that was reported but not applied now FAILs (0.0.1 PASSed it)', () => {
    const x = setCase(PEPPOL_SET, 'E8-discount-not-applied')
    expect(claim(run(x, BEFORE.peppol), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(claim(run(x, AFTER.peppol), 'line[0].LINE_MATH_INT')).toMatchObject({ outcome: 'FAIL', variance: 50 })
  })
  it('allowances reported as an item list make the line abstain, with the reason (never a guessed 0)', () => {
    const c = claim(run(setCase(PEPPOL_SET, 'C9-allowance-as-list'), AFTER.peppol), 'line[0].LINE_MATH_INT')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency!.detail).toMatch(/^guard abstain_if_present: LINE_ALLOWANCE_CHARGE_LIST is reported \(allowance_charges\).*\. Reason: the line lists its allowances\/charges as items/)
  })
  it('the line slack is the spec\'s: Peppol R120 accepts 0.02; ZATCA only the half-up rounding of the product', () => {
    expect(claim(run(setCase(PEPPOL_SET, 'C10-r120-slack-edge'), AFTER.peppol), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    const over = { lines: [{ invoiced_quantity: 100, price_amount: 1.0003, line_extension_amount: 100 }] }
    expect(claim(run(over, AFTER.peppol), 'line[0].LINE_MATH_INT').outcome).toBe('FAIL') // 0.03 > R120's 0.02
    expect(claim(run(setCase(ZATCA_SET, 'C10-rounded-product'), AFTER.zatca), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(claim(run(setCase(ZATCA_SET, 'E9-line-one-cent'), BEFORE.zatca), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(claim(run(setCase(ZATCA_SET, 'E9-line-one-cent'), AFTER.zatca), 'line[0].LINE_MATH_INT').outcome).toBe('FAIL')
  })
})

describe('bug 6 (found by the measurement): unit prices were rounded to the cent before the line check', () => {
  it('a unit price with more than two decimals is read exactly (BT-146 has no decimal limit; FA(3) P_9A allows 8)', () => {
    const x = { lines: [{ invoiced_quantity: 1000, price_amount: 0.123, line_extension_amount: 123 }] }
    expect(claim(run(x, BEFORE.peppol), 'line[0].LINE_MATH_INT')).toMatchObject({ outcome: 'FAIL', variance: 3 }) // read as 0.12
    expect(claim(run(x, AFTER.peppol), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    expect(claim(run({ ...x, lines: [{ ...x.lines[0], price_amount: '0.123' }] }, AFTER.peppol), 'line[0].LINE_MATH_INT').outcome).toBe('PASS')
    const k = { lines: [{ P_8B: 1000, P_9A: 0.12345678, P_11: 123.46 }], P_15: 1 }
    expect(claim(run(k, AFTER.ksef), 'line[0].LINE_NET_INT').outcome).toBe('PASS')
  })
})

describe('engine additions (additive: rulesets that use none of them are byte-identical, pinned by the golden)', () => {
  const base: DeclarativeRuleset = {
    id: 't', version: '1', lineArrayKeys: ['items'],
    fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, P: { paths: ['p'], kind: 'price', line: true }, Q: { paths: ['q'], kind: 'quantity', line: true }, N: { paths: ['n'], line: true }, F: { paths: ['f'], line: true }, X: { paths: ['x'], kind: 'identifier' }, Y: { paths: ['y'], kind: 'identifier' } },
    checks: [{ code: 'AB', left: 'A', op: '=', right: 'B' }],
  }
  it('declared abstention: document, line and identifier checks never decide, whatever the data', () => {
    const rs: DeclarativeRuleset = { ...base, checks: [
      { code: 'AB', left: 'A', op: '=', right: 'B', abstain: 'no source' },
      { code: 'LN', scope: 'line', left: 'N', op: '=', right: 'Q * P', abstain: 'no source either' },
      { code: 'ID', compare: 'identifier', left: 'X', op: '=', right: 'Y', abstain: 'ids unsourced' },
    ] }
    const v = run({ a: 1, b: 2, x: 'A', y: 'A', items: [{ q: 1, p: 1, n: 5 }] }, rs)
    expect(v.claims.map(c => [c.claim_id, c.outcome, c.insufficiency?.reason, c.insufficiency?.detail])).toEqual([
      ['document.AB', 'INSUFFICIENT_DATA', 'OUT_OF_RULESET_SCOPE', 'declared abstention: no source'],
      ['document.ID', 'INSUFFICIENT_DATA', 'OUT_OF_RULESET_SCOPE', 'declared abstention: ids unsourced'],
      ['line[0].LN', 'INSUFFICIENT_DATA', 'OUT_OF_RULESET_SCOPE', 'declared abstention: no source either'],
    ])
    expect(v.outcome).toBe('INSUFFICIENT_DATA')
    expect(run({}, rs).claims[0]!.insufficiency!.detail).toBe('declared abstention: no source') // even with nothing reported
  })
  it('guard_reason is appended to whichever guard fires, and only then', () => {
    const rs: DeclarativeRuleset = { ...base, checks: [{ code: 'AB', left: 'A', op: '=', right: 'B', abstain_if_present: ['F'], abstain_if: [{ left: 'A', op: '<', right: '0' }], guard_reason: 'cited source' }] }
    expect(run({ a: -1, b: -1 }, rs).claims[0]!.insufficiency!.detail).toBe('guard abstain_if: A < 0 holds (-1 vs 0). Reason: cited source')
    expect(run({ a: 1, b: 1 }, rs).claims[0]!.outcome).toBe('PASS')
    const noReason: DeclarativeRuleset = { ...base, checks: [{ code: 'AB', left: 'A', op: '=', right: 'B', abstain_if: [{ left: 'A', op: '<', right: '0' }] }] }
    expect(run({ a: -1, b: -1 }, noReason).claims[0]!.insufficiency!.detail).toBe('guard abstain_if: A < 0 holds (-1 vs 0)')
  })
  it("kind 'price': numbers and plain decimal strings exact; formatted strings via the amount parser; never silently rounded", () => {
    const rs: DeclarativeRuleset = { ...base, checks: [{ code: 'LN', scope: 'line', left: 'N', op: '=', right: 'Q * P', tol: 0.000001 }] }
    const line = (p: unknown, n: number) => run({ items: [{ q: 1000, p, n }] }, rs).claims[0]!
    expect(line(0.12345, 123.45).outcome).toBe('PASS')
    expect(line('0.12345', 123.45).outcome).toBe('PASS')
    expect(line('€1,234.50', 1234500).outcome).toBe('PASS') // two decimals: the amount parser, exact
    // engine 0.1.0: would need rounding, so unparseable. Engine 0.2.0 reads a formatted string whole and exactly (fixv-redteam)
    expect(verifyDeclarative({ items: [{ q: 1000, p: '€1,234.567', n: 1234567 }] }, rs, { now: NOW, engine: '0.1.0' }).claims[0]!.insufficiency).toMatchObject({ reason: 'UNPARSEABLE' })
    const amt: DeclarativeRuleset = { ...rs, fields: { ...rs.fields, P: { paths: ['p'], line: true } } }
    expect(run({ items: [{ q: 1000, p: 0.12345, n: 123.45 }] }, amt).claims[0]!.outcome).toBe('FAIL') // 'amount' still rounds (0.12)
  })
  it('lint: validates abstain, guard_reason, sources and the price kind', () => {
    const lint = (patch: Partial<DeclarativeRuleset>, check: Record<string, unknown> = {}) => lintRuleset({ ...base, ...patch, checks: [{ code: 'AB', left: 'A', op: '=', right: 'B', ...check }] })
    expect(lint({}, { abstain: '' }).errors).toEqual(['check[0] (AB): "abstain" must be a non-empty string (the reason the check never decides)'])
    expect(lint({}, { abstain: 'why' }).warnings).toContain('check[0] (AB): declared abstention; the check never decides (why)')
    expect(lint({}, { guard_reason: 'why' }).warnings).toContain('check[0] (AB): "guard_reason" is set but the check has no abstain guard')
    expect(lint({}, { guard_reason: 7 as never }).errors).toEqual(['check[0] (AB): "guard_reason" must be a non-empty string'])
    expect(lint({ sources: { K: '' } }).errors).toEqual(['"sources" must be an object mapping each key to a non-empty string (a URL or a citation)'])
    expect(lint({ sources: { K: 'https://x' } }).errors).toEqual([])
    expect(lint({}).errors).toEqual([]) // the 'price' field P is a valid kind
  })
})

describe('the pre-registered before/after measurement (constructed set; prereg 2026-09-28-0935, run 2)', () => {
  const measure = (rs: DeclarativeRuleset, set: SetCase[]) => measureRuleset(rs, set.map(c => ({ extraction: c.extraction, label: c.label })))
  const counts = (m: ReturnType<typeof measure>) => { const { tp, tn, fp, fn, abstain, total } = m.metrics; return { tp, tn, fp, fn, abstain, total } }
  it('Peppol: fp 5/10 → 0/10, fn 5/8 → 0/8', () => {
    expect(counts(measure(BEFORE.peppol, PEPPOL_SET))).toEqual({ tp: 3, tn: 5, fp: 5, fn: 5, abstain: 0, total: 18 })
    const a = measure(AFTER.peppol, PEPPOL_SET)
    expect(counts(a)).toEqual({ tp: 8, tn: 10, fp: 0, fn: 0, abstain: 0, total: 18 })
    expect(a.accuracy).toMatchObject({ domain: 'e-invoice', ruleset_version: '0.1.0', fp_rate: 0, fn_rate: 0, abstain_rate: 0, measured_on: '1fce00447cbc9ed123f6689bce7e44ead1391c66f7986b88df0d6625465b1c17' })
  })
  it('ZATCA: fp 5/10 → 0/10, fn 6/9 → 0/9', () => {
    expect(counts(measure(BEFORE.zatca, ZATCA_SET))).toEqual({ tp: 3, tn: 5, fp: 5, fn: 6, abstain: 0, total: 19 })
    const a = measure(AFTER.zatca, ZATCA_SET)
    expect(counts(a)).toEqual({ tp: 9, tn: 10, fp: 0, fn: 0, abstain: 0, total: 19 })
    expect(a.accuracy.measured_on).toBe('81ce9e51a7c651bf599fffdc3a3abe2f38d9d8a0d12158b8a73212bfa47d9f51')
  })
  it('KSeF: fp 7/13 → 0/13, fn 0/4 → 2/4 (the published cost of not guessing the P_15 identity)', () => {
    expect(counts(measure(BEFORE.ksef, KSEF_SET))).toEqual({ tp: 4, tn: 6, fp: 7, fn: 0, abstain: 0, total: 17 })
    const a = measure(AFTER.ksef, KSEF_SET)
    expect(counts(a)).toEqual({ tp: 2, tn: 13, fp: 0, fn: 2, abstain: 0, total: 17 })
    expect(a.accuracy).toMatchObject({ fp_rate: 0, fn_rate: 0.5, measured_on: 'aa7d8000251e77c9947db43785ebc2a59c534babb44622acb0b9d3edd2ecd496' })
    expect(a.rows.map((r, i) => (r.label === 'ERROR' && r.judgment === 'PASS' ? KSEF_SET[i]!.id : null)).filter(Boolean)).toEqual(['E1-P_15-wrong', 'E3-P_15-wrong-with-P_13_8'])
  })
})
