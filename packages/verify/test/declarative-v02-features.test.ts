/**
 * The four declarative additions of 2026-09-24 (needed by financial-statement-core v0.2, generic by design):
 *   1. rounding-aware tolerance   (`tolerance.rounding: 'infer'`, per-check `rounding`)
 *   2. optional terms             (`ROLE?` in an expression — 0 when absent)
 *   3. abstain guards             (`abstain_if_present`, `abstain_unless_all_present`, `abstain_if`)
 *   4. check alternatives         (`alternatives: [{left, right}]` — ordered fallback forms, chosen by presence)
 * Byte identity of rulesets that use none of them is pinned separately (declarative-golden.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { verify, verifyDeclarative, evalExpr, lintRuleset, type DeclarativeRuleset, type Verdict } from '../src/index'
import { roleRefs } from '../src/declarative/expr'
import { inferReportingUnit, roundingTolerance } from '../src/declarative/evaluate'

const NOW = () => new Date('2026-09-24T00:00:00Z')
const claim = (v: Verdict, id: string) => { const c = v.claims.find(x => x.claim_id === id); if (!c) throw new Error(`no claim ${id}; have ${v.claims.map(x => x.claim_id).join(', ')}`); return c }
const doc = (v: Verdict, code: string) => claim(v, `document.${code}`)
const rs = (over: Partial<DeclarativeRuleset>): DeclarativeRuleset => ({ id: 't', version: '0.0.1', fields: {}, checks: [], ...over })

// ───────────────────────────────────────────── 1. rounding-aware tolerance ─────────────────────────────────────────────
describe('rounding inference: the reporting unit', () => {
  it('is the largest of {1, 1 000, 100 000, 1 000 000} dividing every operand', () => {
    expect(inferReportingUnit([10_000_000, 4_000_000, 7_000_000])).toBe(1_000_000)
    expect(inferReportingUnit([1_234_000, 600_000])).toBe(1_000)
    expect(inferReportingUnit([13_040_300_000, 11_140_800_000])).toBe(100_000)   // tenths of a million
    expect(inferReportingUnit([1_234, 1_000_000])).toBe(1)
    expect(inferReportingUnit([0, 0])).toBe(1_000_000)                            // zero is divisible by anything
    expect(inferReportingUnit([-3_000_000, 2_000_000])).toBe(1_000_000)          // sign does not matter
  })
  it('does not exist for amounts with cents, or for no operands', () => {
    expect(inferReportingUnit([12.5, 100])).toBeUndefined()
    expect(inferReportingUnit([])).toBeUndefined()
  })
  it('tolerance = max(floor, rel × largest |operand|, U × number of operands)', () => {
    expect(roundingTolerance([10_000_000, 4_000_000, 7_000_000], 0.0003, 0, 0.01).tol).toBe(3_000_000) // unit term wins
    expect(roundingTolerance([20e9, 10e9, 9_996_000_000], 0.0003, 0, 0.01).tol).toBe(6_000_000)       // relative term wins
    expect(roundingTolerance([12.5, 10.25], 0.0003, 0, 0.01).tol).toBe(0.01)                           // no unit: floor
    expect(roundingTolerance([20e9, 10e9, 9_996_000_000], 0.0003, 2, 0.01).tol).toBe(3_000_000)       // absCap caps the relative term only
  })
})

const ABC = (rounding?: 'infer' | 'none', checkRounding?: 'infer' | 'none'): DeclarativeRuleset => rs({
  tolerance: { rel: 0.0003, absCap: 0, ...(rounding ? { rounding } : {}) },
  fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, C: { paths: ['c'] }, D: { paths: ['d'] }, FX: { paths: ['fx'] }, R: { paths: ['r'], kind: 'rate' }, DEF: { paths: ['def'], default: 0 } },
  checks: [{ code: 'SUM', left: 'A', op: '=', right: 'B + C', ...(checkRounding ? { rounding: checkRounding } : {}) }],
})

describe('rounding inference in a check', () => {
  it('forgives a gap of up to U × operands in a statement reported in thousands, and not one unit more', () => {
    const at = (gap: number) => doc(verifyDeclarative({ a: 1_230_000 + gap, b: 600_000, c: 630_000 }, ABC('infer'), { now: NOW }), 'SUM')
    expect(at(3_000).outcome).toBe('PASS')   // 3 operands × 1 000
    expect(at(4_000).outcome).toBe('FAIL')
    expect(at(4_000).variance).toBe(4_000)
  })
  it('the same gap FAILs without inference (the old policy) — the feature is what changes the outcome', () => {
    expect(doc(verifyDeclarative({ a: 1_233_000, b: 600_000, c: 630_000 }, ABC(), { now: NOW }), 'SUM').outcome).toBe('FAIL')
    expect(doc(verifyDeclarative({ a: 1_233_000, b: 600_000, c: 630_000 }, ABC('none'), { now: NOW }), 'SUM').outcome).toBe('FAIL')
  })
  it('in millions: one-unit presentation rounding PASSes; the claim states the tolerance it used', () => {
    const c = doc(verifyDeclarative({ a: 11_000_000, b: 4_000_000, c: 6_000_000 }, ABC('infer'), { now: NOW }), 'SUM')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.tolerance).toEqual({ abs: 3_000_000, rel: 0.0003 })
    expect(c.explanation).toMatch(/Rounding-aware tolerance 3000000 = max\(0\.03% of the largest operand 11000000, unit 1000000 × 3 operands/)
    expect(c.explanation).toMatch(/treated as rounding, not error/)
  })
  it('a per-check `rounding` overrides the ruleset (both directions)', () => {
    const x = { a: 1_233_000, b: 600_000, c: 630_000 }
    expect(doc(verifyDeclarative(x, ABC(undefined, 'infer'), { now: NOW }), 'SUM').outcome).toBe('PASS')
    expect(doc(verifyDeclarative(x, ABC('infer', 'none'), { now: NOW }), 'SUM').outcome).toBe('FAIL')
  })
  it('an inferred claim is final: the relative band is NOT applied again on top (which would use |expected|, not the largest operand)', () => {
    // left = A + B, right = C + D: |expected| (≈10e9) is twice the largest single operand (≈5e9). The addendum's rule gives
    // 0.03% × 5.002e9 ≈ 1.5e6 < the 2e6 gap → FAIL; a second pass with 0.03% × |expected| (3e6) would wrongly PASS it.
    const r = rs({ tolerance: { rel: 0.0003, absCap: 0, rounding: 'infer' }, fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, C: { paths: ['c'] }, D: { paths: ['d'] } }, checks: [{ code: 'X', left: 'A + B', op: '=', right: 'C + D' }] })
    const c = doc(verifyDeclarative({ a: 5_000_000_001, b: 5_002_000_000, c: 5_000_000_000, d: 5_000_000_001 }, r, { now: NOW }), 'X')
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.tolerance?.abs).toBe(1_500_600)
  })
  it('operands are the REPORTED amounts the form uses: absent optional terms, defaults and rates do not count', () => {
    const r = rs({ tolerance: { rel: 0.0003, absCap: 0, rounding: 'infer' }, fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, C: { paths: ['c'] }, FX: { paths: ['fx'] }, DEF: { paths: ['def'], default: 0 }, R: { paths: ['r'], kind: 'rate' } }, checks: [{ code: 'X', left: 'A', op: '=', right: 'B + C + FX? + DEF + 0 * R' }] })
    // gap 4 000 in thousands: 3 reported operands → tol 3 000 → FAIL; a reported 4th (FX = 0) → tol 4 000 → PASS
    expect(doc(verifyDeclarative({ a: 1_004_000, b: 500_000, c: 500_000, r: 0.25 }, r, { now: NOW }), 'X').outcome).toBe('FAIL')
    expect(doc(verifyDeclarative({ a: 1_004_000, b: 500_000, c: 500_000, fx: 0, r: 0.25 }, r, { now: NOW }), 'X').outcome).toBe('PASS')
  })
  it('computed roles are expanded into their operands; sum(ROLE) contributes every line', () => {
    const r = rs({ tolerance: { rel: 0.0003, absCap: 0, rounding: 'infer' }, lineArrayKeys: ['items'], fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, C: { paths: ['c'] }, AMT: { paths: ['amt'], line: true } }, computed: { S: 'B + C' }, checks: [{ code: 'X', left: 'A', op: '=', right: 'S' }, { code: 'L', left: 'A', op: '=', right: 'sum(AMT)' }] })
    const v = verifyDeclarative({ a: 1_003_000, b: 500_000, c: 500_000, items: [{ amt: 250_000 }, { amt: 250_000 }, { amt: 250_000 }, { amt: 250_000 }] }, r, { now: NOW })
    expect(doc(v, 'X').computation?.tolerance?.abs).toBe(3_000)   // A, B, C
    expect(doc(v, 'L').computation?.tolerance?.abs).toBe(5_000)   // A + 4 lines
    expect(doc(v, 'L').outcome).toBe('PASS')
  })
  it('amounts with cents have no reporting unit: only the floor and the relative term apply', () => {
    // operands 100.05, 50.02, 50.02: no candidate unit divides 100.05 → unit term 0; tol = max(0.01, 0.0003 × 100.05) = 0.030015
    const c = doc(verifyDeclarative({ a: 100.05, b: 50.02, c: 50.02 }, ABC('infer'), { now: NOW }), 'SUM')
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/unit none × 3 operands/)
    expect(doc(verifyDeclarative({ a: 100.09, b: 50.02, c: 50.02 }, ABC('infer'), { now: NOW }), 'SUM').outcome).toBe('FAIL') // gap 0.05
  })
  it('verify() routes a ruleset that declares rounding inference', () => {
    const v = verify({ a: 11_000_000, b: 4_000_000, c: 6_000_000 }, { ruleset: ABC('infer'), now: NOW })
    expect(doc(v, 'SUM').outcome).toBe('PASS')
  })
})

// ───────────────────────────────────────────── 2. optional terms ──────────────────────────────────────────────────────
describe('optional terms in expressions', () => {
  const env = { vars: { A: 10, B: 4, C: undefined as number | undefined }, sum: () => undefined }
  it('`ROLE?` takes the value when present and 0 when absent', () => {
    expect(evalExpr('A + B?', env)).toBe(14)
    expect(evalExpr('A + C?', env)).toBe(10)
    expect(evalExpr('A + C', env)).toBeUndefined()           // without `?` an absent role still makes the whole unknown
    expect(evalExpr('-C? + A', env)).toBe(10)
  })
  it('`?` is only valid directly after a role name', () => {
    expect(() => evalExpr('A ?', env)).toThrow(/invalid character/)
    expect(() => evalExpr('?A', env)).toThrow(/invalid character/)
    expect(() => evalExpr('sum(A?)', env)).toThrow(/without '\?'/)
    expect(() => evalExpr('abs?(A)', env)).toThrow(/cannot follow the function name/)
  })
  it('roleRefs splits required from optional (a role written both ways is required)', () => {
    expect(roleRefs('A + B?', 'C? + D')).toEqual({ all: ['A', 'B', 'C', 'D'], required: ['A', 'D'], optional: ['B', 'C'] })
    expect(roleRefs('X + X?').required).toEqual(['X'])
  })
})

const CF = rs({
  fields: { NET: { paths: ['net'] }, CFO: { paths: ['cfo'] }, CFI: { paths: ['cfi'] }, FX: { paths: ['fx'] }, DISC: { paths: ['disc'] } },
  checks: [{ code: 'NET', left: 'NET', op: '=', right: 'CFO + CFI + FX? + DISC?' }],
})

describe('optional terms in a check', () => {
  it('an absent optional term counts as 0 and the check still decides', () => {
    const c = doc(verifyDeclarative({ net: 80, cfo: 100, cfi: -20 }, CF, { now: NOW }), 'NET')
    expect(c.outcome).toBe('PASS')
    expect(c.explanation).toMatch(/Optional terms not reported \(counted as 0\): FX, DISC/)
  })
  it('a reported optional term is used', () => {
    expect(doc(verifyDeclarative({ net: 85, cfo: 100, cfi: -20, fx: 5 }, CF, { now: NOW }), 'NET').outcome).toBe('PASS')
    const c = doc(verifyDeclarative({ net: 80, cfo: 100, cfi: -20, fx: 5 }, CF, { now: NOW }), 'NET')
    expect(c.outcome).toBe('FAIL')
    expect(c.variance).toBe(-5)
  })
  it('a REQUIRED operand absent abstains exactly as before', () => {
    const c = doc(verifyDeclarative({ net: 80, cfo: 100, fx: 5 }, CF, { now: NOW }), 'NET')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toEqual({ reason: 'FIELD_MISSING', detail: 'CFI not present on the document', missing: ['CFI'] })
  })
  it('an optional term present but unparseable abstains (UNPARSEABLE) — it is never read as 0', () => {
    const c = doc(verifyDeclarative({ net: 80, cfo: 100, cfi: -20, fx: 'n/a' }, CF, { now: NOW }), 'NET')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(c.insufficiency?.missing).toEqual(['FX'])
  })
  it('a form made only of optional terms abstains when none is reported, and decides when one is', () => {
    const r = rs({ fields: { A: { paths: ['a'] }, B: { paths: ['b'] } }, checks: [{ code: 'Z', left: 'A?', op: '=', right: 'B?' }] })
    expect(doc(verifyDeclarative({}, r, { now: NOW }), 'Z').outcome).toBe('INSUFFICIENT_DATA')
    expect(doc(verifyDeclarative({ a: 0 }, r, { now: NOW }), 'Z').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ a: 3 }, r, { now: NOW }), 'Z').outcome).toBe('FAIL')
  })
  it('works per line too', () => {
    const r = rs({ lineArrayKeys: ['items'], fields: { AMT: { paths: ['amt'], line: true }, Q: { paths: ['q'], line: true, kind: 'quantity' }, P: { paths: ['p'], line: true }, DISC: { paths: ['disc'], line: true } }, checks: [{ code: 'M', scope: 'line', left: 'AMT', op: '=', right: 'Q * P - DISC?' }] })
    const v = verifyDeclarative({ items: [{ amt: 100, q: 2, p: 50 }, { amt: 90, q: 2, p: 50, disc: 10 }] }, r, { now: NOW })
    expect(claim(v, 'line[0].M').outcome).toBe('PASS')
    expect(claim(v, 'line[1].M').outcome).toBe('PASS')
  })
})

// ───────────────────────────────────────────── 3. abstain guards ──────────────────────────────────────────────────────
const OI = (extra: Partial<DeclarativeRuleset['checks'][number]>): DeclarativeRuleset => rs({
  fields: { OI: { paths: ['oi'] }, GP: { paths: ['gp'] }, OPEX: { paths: ['opex'] }, OTHER: { paths: ['OtherOperatingIncome', 'OtherOperatingIncomeExpenseNet'] }, LAG: { paths: ['lag'], kind: 'quantity' }, R1: { paths: ['r1'] }, R2: { paths: ['r2'] }, DEF: { paths: ['def'], default: 0 } },
  checks: [{ code: 'OI', left: 'OI', op: '=', right: 'GP - OPEX', ...extra }],
})
const oiDoc = { oi: 150, gp: 400, opex: 250 }

describe('abstain_if_present', () => {
  it('abstains (OUT_OF_RULESET_SCOPE) when a listed role is reported, naming where it was found', () => {
    const c = doc(verifyDeclarative({ ...oiDoc, oi: 170, OtherOperatingIncomeExpenseNet: 20 }, OI({ abstain_if_present: ['OTHER'] }), { now: NOW }), 'OI')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    expect(c.insufficiency?.detail).toBe('guard abstain_if_present: OTHER is reported (OtherOperatingIncomeExpenseNet); the identity does not model it')
  })
  it('decides normally when none is reported', () => {
    expect(doc(verifyDeclarative(oiDoc, OI({ abstain_if_present: ['OTHER'] }), { now: NOW }), 'OI').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ ...oiDoc, oi: 170 }, OI({ abstain_if_present: ['OTHER'] }), { now: NOW }), 'OI').outcome).toBe('FAIL')
  })
  it('a field bound at its `default` is not "reported"; a present-but-unparseable one is', () => {
    expect(doc(verifyDeclarative(oiDoc, OI({ abstain_if_present: ['DEF'] }), { now: NOW }), 'OI').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ ...oiDoc, OtherOperatingIncome: 'n/a' }, OI({ abstain_if_present: ['OTHER'] }), { now: NOW }), 'OI').outcome).toBe('INSUFFICIENT_DATA')
  })
  it('a check that was already missing a required operand keeps its FIELD_MISSING reason (guards run after)', () => {
    const c = doc(verifyDeclarative({ gp: 400, opex: 250, OtherOperatingIncome: 5 }, OI({ abstain_if_present: ['OTHER'] }), { now: NOW }), 'OI')
    expect(c.insufficiency?.reason).toBe('FIELD_MISSING')
  })
})

describe('abstain_unless_all_present', () => {
  it('abstains (FIELD_MISSING, naming the absent roles) unless every listed role is reported', () => {
    const c = doc(verifyDeclarative(oiDoc, OI({ abstain_unless_all_present: ['LAG', 'R1'] }), { now: NOW }), 'OI')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toEqual({ reason: 'FIELD_MISSING', detail: 'guard abstain_unless_all_present: LAG, R1 not reported', missing: ['LAG', 'R1'] })
    expect(doc(verifyDeclarative({ ...oiDoc, lag: 365, r1: 1 }, OI({ abstain_unless_all_present: ['LAG', 'R1'] }), { now: NOW }), 'OI').outcome).toBe('PASS')
  })
})

describe('abstain_if (conditions)', () => {
  const window = OI({ abstain_unless_all_present: ['LAG'], abstain_if: [{ left: 'LAG', op: '<', right: '350' }, { left: 'LAG', op: '>', right: '380' }] })
  it('abstains when a condition holds (e.g. a beginning balance dated outside 350–380 days before the period end)', () => {
    for (const lag of [349, 381, 90, 730]) {
      const c = doc(verifyDeclarative({ ...oiDoc, lag }, window, { now: NOW }), 'OI')
      expect(c.outcome, String(lag)).toBe('INSUFFICIENT_DATA')
      expect(c.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
      expect(c.insufficiency?.detail).toMatch(/^guard abstain_if: LAG [<>] 3[58]0 holds/)
    }
    for (const lag of [350, 365, 380]) expect(doc(verifyDeclarative({ ...oiDoc, lag }, window, { now: NOW }), 'OI').outcome, String(lag)).toBe('PASS')
  })
  it('two values that disagree (exact unless tol), and a condition with an absent operand does not fire', () => {
    const disagree = OI({ abstain_if: [{ left: 'R1', op: '!=', right: 'R2' }] })
    expect(doc(verifyDeclarative({ ...oiDoc, r1: 100, r2: 101 }, disagree, { now: NOW }), 'OI').outcome).toBe('INSUFFICIENT_DATA')
    expect(doc(verifyDeclarative({ ...oiDoc, r1: 100, r2: 100 }, disagree, { now: NOW }), 'OI').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ ...oiDoc, r1: 100 }, disagree, { now: NOW }), 'OI').outcome).toBe('PASS')
    const loose = OI({ abstain_if: [{ left: 'R1', op: '!=', right: 'R2', tol: 5 }] })
    expect(doc(verifyDeclarative({ ...oiDoc, r1: 100, r2: 104 }, loose, { now: NOW }), 'OI').outcome).toBe('PASS')
  })
  it('a condition over a present-but-unparseable value abstains (UNPARSEABLE) rather than guess', () => {
    const c = doc(verifyDeclarative({ ...oiDoc, r1: 'x', r2: 100 }, OI({ abstain_if: [{ left: 'R1', op: '!=', right: 'R2' }] }), { now: NOW }), 'OI')
    expect(c.insufficiency?.reason).toBe('UNPARSEABLE')
  })
  it('guards apply to identifier checks too', () => {
    const r = rs({ fields: { A: { paths: ['a'], kind: 'identifier' }, B: { paths: ['b'], kind: 'identifier' }, X: { paths: ['x'] } }, checks: [{ code: 'ID', compare: 'identifier', left: 'A', op: '=', right: 'B', abstain_if_present: ['X'] }] })
    expect(doc(verifyDeclarative({ a: 'po-1', b: 'PO-1' }, r, { now: NOW }), 'ID').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ a: 'po-1', b: 'PO-1', x: 1 }, r, { now: NOW }), 'ID').outcome).toBe('INSUFFICIENT_DATA')
  })
})

// ───────────────────────────────────────────── 4. check alternatives ──────────────────────────────────────────────────
const CI = rs({
  fields: { CI_INCL: { paths: ['ci_incl'] }, PL: { paths: ['profit_loss'] }, OCI: { paths: ['oci'] }, CI_PARENT: { paths: ['ci_parent'] }, NI: { paths: ['ni_parent'] }, OCI_PARENT: { paths: ['oci_parent', 'oci'] } },
  checks: [{ code: 'CI', left: 'CI_INCL', op: '=', right: 'PL + OCI', alternatives: [{ left: 'CI_PARENT', right: 'NI + OCI_PARENT' }] }],
})

describe('check alternatives (consistent pairing)', () => {
  it('the primary form is used when its required operands are present', () => {
    const c = doc(verifyDeclarative({ ci_incl: 130, profit_loss: 120, oci: 10, ci_parent: 125, ni_parent: 115 }, CI, { now: NOW }), 'CI')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.formula).toBe('CI_INCL = PL + OCI')
    expect(c.explanation).toMatch(/Form 1 of 2\./)
  })
  it('falls back to the next form when the primary lacks a required operand (never mixing the pairs)', () => {
    // CI attributable to the parent with ProfitLoss reported: v0.1 paired these and raised a false alarm; here the
    // parent form pairs CI_PARENT with NetIncomeLoss.
    const c = doc(verifyDeclarative({ profit_loss: 120, oci: 10, ci_parent: 125, ni_parent: 115 }, CI, { now: NOW }), 'CI')
    expect(c.outcome).toBe('PASS')
    expect(c.computation?.formula).toBe('CI_PARENT = NI + OCI_PARENT')
    expect(c.explanation).toMatch(/Form 2 of 2\./)
  })
  it('is chosen by PRESENCE, never by outcome: a failing primary is not rescued by a passing alternative', () => {
    const c = doc(verifyDeclarative({ ci_incl: 999, profit_loss: 120, oci: 10, ci_parent: 125, ni_parent: 115 }, CI, { now: NOW }), 'CI')
    expect(c.outcome).toBe('FAIL')
    expect(c.computation?.formula).toBe('CI_INCL = PL + OCI')
  })
  it('abstains, naming what each form lacks, when no form is applicable', () => {
    const c = doc(verifyDeclarative({ ci_incl: 130, oci: 10 }, CI, { now: NOW }), 'CI')
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toEqual({ reason: 'FIELD_MISSING', detail: 'no form of CI has all its required operands (form 1 lacks PL; form 2 lacks CI_PARENT, NI)', missing: ['PL', 'CI_PARENT', 'NI'] })
  })
  it('an unparseable operand in a skipped form does not block a later applicable form, but is reported when nothing applies', () => {
    expect(doc(verifyDeclarative({ ci_incl: 'x', profit_loss: 120, oci: 10, ci_parent: 125, ni_parent: 115 }, CI, { now: NOW }), 'CI').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ ci_incl: 'x', profit_loss: 120, oci: 10 }, CI, { now: NOW }), 'CI').insufficiency?.reason).toBe('UNPARSEABLE')
  })
  it('a total is preferred over the sum of its parts (e.g. restricted cash): every form shares op, guards and rounding', () => {
    const r = rs({
      tolerance: { rel: 0.0003, absCap: 0, rounding: 'infer' },
      fields: { END: { paths: ['end'] }, CASH: { paths: ['cash'] }, RC_T: { paths: ['rc_total'] }, RC_C: { paths: ['rc_cur'] }, RC_N: { paths: ['rc_non'] } },
      checks: [{ code: 'X', left: 'END', op: '=', right: 'CASH + RC_T', alternatives: [{ left: 'END', right: 'CASH + RC_C + RC_N?' }, { left: 'END', right: 'CASH + RC_N' }] }],
    })
    expect(doc(verifyDeclarative({ end: 130_000, cash: 100_000, rc_total: 30_000, rc_cur: 20_000, rc_non: 10_000 }, r, { now: NOW }), 'X').computation?.formula).toBe('END = CASH + RC_T')
    expect(doc(verifyDeclarative({ end: 130_000, cash: 100_000, rc_cur: 20_000, rc_non: 10_000 }, r, { now: NOW }), 'X').outcome).toBe('PASS')
    expect(doc(verifyDeclarative({ end: 130_000, cash: 100_000, rc_non: 30_000 }, r, { now: NOW }), 'X').computation?.formula).toBe('END = CASH + RC_N')
    expect(doc(verifyDeclarative({ end: 130_000, cash: 130_000 }, r, { now: NOW }), 'X').outcome).toBe('INSUFFICIENT_DATA')
  })
})

// ───────────────────────────────────────────── lint understands all four ──────────────────────────────────────────────
describe('lint', () => {
  const base = { id: 'x', version: '1', fields: { A: { paths: ['a'] }, B: { paths: ['b'] }, C: { paths: ['c'] }, L: { paths: ['l'], line: true } } }
  it('accepts every new option when well-formed', () => {
    const r = lintRuleset({ ...base, tolerance: { rel: 0.0003, absCap: 0, rounding: 'infer' }, checks: [
      { code: 'X', left: 'A', op: '=', right: 'B + C?', rounding: 'none', alternatives: [{ left: 'A', right: 'B' }], abstain_if_present: ['C'], abstain_unless_all_present: ['B'], abstain_if: [{ left: 'A', op: '<', right: '0' }] },
      { code: 'Y', scope: 'line', left: 'L', op: '>=', right: '0', abstain_if_present: ['L'] },
    ] })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('flags unknown roles in optional terms, alternatives and guards', () => {
    const r = lintRuleset({ ...base, checks: [{ code: 'X', left: 'A', op: '=', right: 'GHOST?', alternatives: [{ left: 'A', right: 'SPOOK' }], abstain_if_present: ['PHANTOM'], abstain_if: [{ left: 'WRAITH', op: '=', right: '1' }] }] })
    for (const g of ['GHOST', 'SPOOK', 'PHANTOM', 'WRAITH']) expect(r.errors.some(e => e.includes(`"${g}"`)), g).toBe(true)
  })
  it('flags malformed options', () => {
    const r = lintRuleset({ ...base, tolerance: { rel: 0, absCap: 0, rounding: 'always' }, checks: [
      { code: 'X', left: 'A', op: '=', right: 'B', rounding: 'sometimes', alternatives: [], abstain_if_present: 'A', abstain_if: [{ left: 'A', op: '~', right: 'B', tol: -1 }] },
    ] })
    for (const pat of [/tolerance\.rounding: invalid value "always"/, /invalid rounding "sometimes"/, /"alternatives" must be a non-empty array/, /"abstain_if_present" must be a non-empty array/, /invalid op "~"/, /"tol" must be a number >= 0/]) expect(r.errors.some(e => pat.test(e)), String(pat)).toBe(true)
  })
  it('enforces scope in guards and alternatives, and rejects numeric-only options on identifier checks', () => {
    const r = lintRuleset({ ...base, fields: { ...base.fields, I: { paths: ['i'], kind: 'identifier' }, J: { paths: ['j'], kind: 'identifier' } }, checks: [
      { code: 'D', left: 'A', op: '=', right: 'B', abstain_if_present: ['L'], alternatives: [{ left: 'A', right: 'L' }] },
      { code: 'N', scope: 'line', left: 'L', op: '=', right: '0', abstain_unless_all_present: ['A'] },
      { code: 'ID', compare: 'identifier', left: 'I', op: '=', right: 'J', rounding: 'infer', alternatives: [{ left: 'I', right: 'J' }] },
    ] })
    for (const pat of [/cannot name the per-line field "L"/, /wrap it as sum\(L\)/, /can only name line fields \("A" is not one\)/, /"rounding" applies to numeric checks only/, /"alternatives" apply to numeric checks only/]) expect(r.errors.some(e => pat.test(e)), String(pat)).toBe(true)
  })
  it('warns about a form made only of optional terms; guard-only roles count as used', () => {
    const r = lintRuleset({ ...base, checks: [{ code: 'X', left: 'A?', op: '=', right: 'B?', abstain_if_present: ['C'] }, { code: 'Y', left: 'sum(L)', op: '>=', right: '0' }] })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['check[0] (X): every operand is optional (A, B); the form abstains when none of them is reported'])
  })
  it('reports a misplaced "?" (and any invalid character) as an error instead of throwing (fixes a pre-existing crash)', () => {
    const r = lintRuleset({ ...base, checks: [{ code: 'X', left: 'A ? B', op: '=', right: 'sum(L?)' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /invalid character in expression: '\?'/.test(e))).toBe(true)
    expect(r.errors.some(e => /sum\(\) takes a role name without '\?'/.test(e))).toBe(true)
  })
})
