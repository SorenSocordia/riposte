/**
 * 2026-10-04, engine 0.4.0: claims over tables. sqrt(), median/min/max/count over line and list fields and over named row
 * sets, prev()/next() and doc. inside rows, line-computed roles that read document values, named algorithms as pinned procedures
 * (sparc.vflat@1), archive provenance (E1; checksum_verified only from bytes the engine hashed), and the demo ruleset. Every
 * fixture is synthetic and inline: no archive data ships with the product.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_VERSION, ENGINE_VERSIONS, verifyDeclarative, verifyReplay, verifyInputs, verifyInputHash, lintRuleset, rulesetIdentity,
  evalExpr, evalExprV040, operandRefs, ALGORITHMS, resolveAlgorithm, algorithmPin, pinProblem, sparcVflat, extractionSchema,
  validateContract, provenanceTier, archiveProvenanceProblems, gateLabel, replayBundle,
  type DeclarativeRuleset, type Verdict,
} from '../src/index'
import { run } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const EX = join(HERE, '..', 'docs', 'examples')
const NOW = (): Date => new Date('2026-10-04T00:00:00Z')
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)

const TAB: DeclarativeRuleset = {
  id: 'tab-test', version: '0.0.1', lineArrayKeys: ['rows'], tolerance: { rel: 0, absCap: 0 },
  fields: {
    R: { paths: ['r'], kind: 'quantity', line: true },
    V: { paths: ['v'], kind: 'quantity', line: true },
    REF: { paths: ['ref'], kind: 'quantity' },
  },
  row_sets: { OUT: [{ left: 'R', op: '>=', right: '3' }], NONE: [{ left: 'R', op: '>', right: '100' }], FROM2: [{ left: 'R', op: '>=', right: '2' }] },
  checks: [{ code: 'X', left: 'REF', op: '=', right: 'REF', tol: 0 }],
}
const MED = { computed: { MED: 'median(V, OUT)' } }
const rows = (vs: unknown[], rs: unknown[] = [1, 2, 3, 4, 5]): Record<string, unknown> => ({ ref: 30, rows: rs.map((r, i) => ({ r, v: vs[i] })) })
const ROWS = rows([10, 20, 30, 40, 52])
const withChecks = (checks: DeclarativeRuleset['checks'], extra: Partial<DeclarativeRuleset> = {}): DeclarativeRuleset => ({ ...TAB, ...extra, checks })
const one = (left: string, op: '=' | '<=' | '>=' | '!=', right: string, extra: Partial<DeclarativeRuleset['checks'][number]> = {}) => withChecks([{ code: 'C', left, op, right, tol: 0, exact_tolerance: true, ...extra }])

describe('engine 0.4.0', () => {
  it('is retained (0.5.0 became the default on 2026-10-04), and every earlier engine is still carried', () => {
    expect(ENGINE_VERSION).toBe('0.7.2') // 2026-10-05: 0.6.0 is current; the tests below that compare engines name 0.4.0
    expect([...ENGINE_VERSIONS]).toEqual(['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.7.1', '0.7.2'])
    // (package.json is kept equal to ENGINE_VERSION by test/version.test.ts)
  })
})

describe('the 0.4.0 grammar (expr.ts)', () => {
  it('keeps the old grammar byte for byte: sqrt, doc. and commas stay errors there', () => {
    const env = { vars: { X: 4 }, sum: () => undefined }
    expect(() => evalExpr('sqrt(X)', env)).toThrow("unknown function 'sqrt'")
    expect(() => evalExpr('median(X, S)', env)).toThrow("invalid character in expression: ','")
    expect(() => evalExpr('doc.X', env)).toThrow('trailing tokens in expression')
    expect(evalExprV040('sqrt(X)', env)).toBe(2)
  })
  it('sqrt is rounded to 9 decimals, and a negative argument has no value with a domain note', () => {
    const notes: string[] = []
    expect(evalExprV040('sqrt(2)', { vars: {}, sum: () => undefined })).toBe(1.414213562)
    expect(evalExprV040('sqrt(0 - 4)', { vars: {}, sum: () => undefined, domain: n => { notes.push(n) } })).toBeUndefined()
    expect(notes).toEqual(['sqrt of a negative value (-4)'])
  })
  it('names each operand by its form', () => {
    const refs = operandRefs('median(V, OUT) + count(R) + sum(V) + sum(V, OUT) + doc.REF + prev(V) + next(V) + W?')
    expect(refs.map(r => `${r.kind}:${r.name}`)).toEqual(['agg:median(V,OUT)', 'agg:count(R)', 'sum:V', 'agg:sum(V,OUT)', 'doc:doc.REF', 'prev:prev.V', 'next:next.V', 'role:W'])
    expect(refs[7]!.optional).toBe(true)
    expect(() => operandRefs('doc.X?')).toThrow("'?' cannot follow doc.X")
    expect(() => operandRefs('median(doc.X)')).toThrow('median() expects a role name')
  })
  it('never produces NaN or Infinity', () => {
    expect(evalExprV040('X * X * X * X', { vars: { X: 1e100 }, sum: () => undefined })).toBeUndefined()
  })
})

describe('aggregates over rows and row sets', () => {
  it('median (odd and even), min, max, count, sum over a set and over all rows', () => {
    const v = verifyDeclarative(ROWS, withChecks([
      { code: 'MED_OUT', left: 'median(V, OUT)', op: '=', right: '40', tol: 0 },
      { code: 'MED_ALL', left: 'median(V)', op: '=', right: '30', tol: 0 },
      { code: 'MED_EVEN', left: 'median(V, FROM2)', op: '=', right: '35', tol: 0 },
      { code: 'MIN', left: 'min(V, OUT)', op: '=', right: '30', tol: 0 },
      { code: 'MAX', left: 'max(V, OUT)', op: '=', right: '52', tol: 0 },
      { code: 'CNT', left: 'count(R, OUT)', op: '=', right: '3', tol: 0 },
      { code: 'SUM', left: 'sum(V, OUT)', op: '=', right: '122', tol: 0 },
      { code: 'COMP', left: 'MED', op: '=', right: '40', tol: 0 },
    ], MED), { now: NOW })
    for (const id of ['MED_OUT', 'MED_ALL', 'MED_EVEN', 'MIN', 'MAX', 'CNT', 'SUM', 'COMP']) expect(claim(v, `document.${id}`)?.outcome, id).toBe('PASS')
    expect(claim(v, 'document.MED_OUT')?.computation?.operands).toEqual({ left: 40, right: 40 })
    // the evidence is every row the aggregate read, at its absolute path
    expect(claim(v, 'document.MED_OUT')?.evidence.map(e => (e.locator as { path: string }).path)).toEqual(['rows[2].v', 'rows[3].v', 'rows[4].v'])
  })
  it('an empty selection: count is 0; median has no value', () => {
    const v = verifyDeclarative(ROWS, withChecks([
      { code: 'CNT', left: 'count(R, NONE)', op: '>=', right: '1', tol: 0 },
      { code: 'MED', left: 'median(V, NONE)', op: '=', right: '1', tol: 0 },
    ]), { now: NOW })
    expect(claim(v, 'document.CNT')).toMatchObject({ outcome: 'FAIL', computation: { operands: { left: 0, right: 1 } } })
    expect(claim(v, 'document.MED')?.insufficiency).toMatchObject({ reason: 'FIELD_MISSING' })
    expect(claim(v, 'document.MED')?.insufficiency?.detail).toContain('no row of NONE has a value to aggregate')
  })
  it('an unreadable value in the selection strikes the aggregate, naming the row; one outside the selection does not', () => {
    const v = verifyDeclarative(rows([10, 20, 30, '4O', 52]), one('median(V, OUT)', '=', '40'), { now: NOW })
    const c = claim(v, 'document.C')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'UNPARSEABLE', missing: ['V'] })
    expect(c.insufficiency?.detail).toContain('median(V, OUT): line 3:')
    expect(v.struck?.map(s => s.field)).toEqual(['V@line[3]'])
    expect(v.would_unlock).toEqual([{ field: 'V@line[3]', claims: ['document.C'] }])
    expect(gateLabel(v)).toBe('OPEN')
    const outside = verifyDeclarative(rows(['1O', 20, 30, 40, 52]), one('median(V, OUT)', '=', '40'), { now: NOW })
    expect(claim(outside, 'document.C')?.outcome).toBe('PASS')
  })
  it('a row whose membership cannot be decided makes the aggregate unknown', () => {
    const v = verifyDeclarative(rows([10, 20, 30, 40, 52], [1, 2, 'x3', 4, 5]), one('median(V, OUT)', '=', '40'), { now: NOW })
    const c = claim(v, 'document.C')!
    expect(c.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(c.insufficiency?.detail).toContain('membership in OUT is unknown')
    expect(v.struck?.map(s => s.field)).toEqual(['R@line[2]'])
  })
  it('over a list field (`each`), without a set', () => {
    const rs: DeclarativeRuleset = { id: 'list', version: '0.0.1', fields: { T: { paths: ['tax'], each: ['vat'], kind: 'amount' } }, checks: [{ code: 'C', left: 'max(T) + count(T)', op: '=', right: '32', tol: 0 }] }
    const v = verifyDeclarative({ vat: [{ tax: 10 }, { tax: 30 }] }, rs, { now: NOW })
    expect(claim(v, 'document.C')?.outcome).toBe('PASS')
  })
})

describe('sqrt in checks and line-computed roles', () => {
  it('a negative argument abstains with the domain note, never reads as an absent operand', () => {
    const v = verifyDeclarative({ ref: -4, rows: [] }, one('sqrt(REF)', '=', '2'), { now: NOW })
    expect(claim(v, 'document.C')?.insufficiency).toEqual({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'no value: sqrt of a negative value (-4) in "sqrt(REF)"' })
    const ok = verifyDeclarative({ ref: 16, rows: [] }, one('sqrt(REF)', '=', '4'), { now: NOW })
    expect(claim(ok, 'document.C')?.outcome).toBe('PASS')
  })
  it('a line-computed sqrt with no value on a row says so in the aggregate over it', () => {
    const rs = withChecks([{ code: 'C', left: 'min(S, OUT)', op: '>=', right: '0', tol: 0 }], { line_computed: { S: 'sqrt(V - 35)' } })
    const v = verifyDeclarative(ROWS, rs, { now: NOW })
    const c = claim(v, 'document.C')!
    expect(c.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    expect(c.insufficiency?.detail).toBe('min(S, OUT): S has no value on line 2: sqrt of a negative value (-5)')
  })
})

describe('prev(), next() and doc. inside rows', () => {
  it('prev() reads the row before; the first row abstains no_neighbour; the neighbour condition rules it out instead', () => {
    const v = verifyDeclarative(ROWS, one('V - prev(V)', '>=', '0', { scope: 'line' }), { now: NOW })
    expect(claim(v, 'line[0].C')?.insufficiency).toEqual({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'no_neighbour: line 0 has no previous row, so prev(V) has no value' })
    for (const i of [1, 2, 3, 4]) expect(claim(v, `line[${i}].C`)?.outcome).toBe('PASS')
    expect(claim(v, 'line[4].C')?.computation?.operands).toEqual({ left: 12, right: 0 })
    const n = verifyDeclarative(ROWS, one('V - prev(V)', '>=', '0', { scope: 'line', applies_if: [{ neighbour: 'prev' }] }), { now: NOW })
    expect(claim(n, 'line[0].C')).toBeUndefined()
    expect(n.not_applicable).toEqual([{ claim_id: 'line[0].C', rule_id: 'C', detail: 'applies_if: no_neighbour: this row has no previous row' }])
    expect(n.outcome).toBe('PASS')
    expect(gateLabel(n)).toBe('PASS')
  })
  it('next() reads the row after; the last row abstains no_neighbour', () => {
    const v = verifyDeclarative(ROWS, one('next(V)', '>=', 'V', { scope: 'line' }), { now: NOW })
    expect(claim(v, 'line[4].C')?.insufficiency?.detail).toBe('no_neighbour: line 4 has no next row, so next(V) has no value')
    expect(claim(v, 'line[0].C')?.outcome).toBe('PASS')
  })
  it('an unreadable neighbour is named on its own row', () => {
    const v = verifyDeclarative(rows([10, '2O', 30, 40, 52]), one('V - prev(V)', '>=', '0', { scope: 'line', applies_if: [{ neighbour: 'prev' }] }), { now: NOW })
    expect(claim(v, 'line[2].C')?.insufficiency?.reason).toBe('UNPARSEABLE')
    expect(claim(v, 'line[2].C')?.insufficiency?.detail).toContain('line 1:')
    // the struck field is the neighbour on line 1, waited on by its own claim and by line 2's
    expect(v.would_unlock).toEqual([{ field: 'V@line[1]', claims: ['line[1].C', 'line[2].C'] }])
  })
  it('doc.R reads a document field or a computed role inside a row check', () => {
    const v = verifyDeclarative(ROWS, withChecks([
      { code: 'NEAR', scope: 'line', left: 'abs(V - doc.REF)', op: '<=', right: '25', tol: 0 },
      { code: 'ABOVE_MED', scope: 'line', applies_if: [{ left: 'R', op: '>=', right: '3' }], left: 'V', op: '>=', right: 'doc.MED - 10', tol: 0 },
    ], MED), { now: NOW })
    expect(v.claims.filter(c => c.rule_id === 'NEAR').map(c => c.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    expect(v.claims.filter(c => c.rule_id === 'ABOVE_MED').map(c => c.outcome)).toEqual(['PASS', 'PASS', 'PASS'])
    expect(claim(v, 'line[0].NEAR')?.evidence.map(e => (e.locator as { path: string }).path)).toEqual(['v', 'ref'])
  })
  it('a line-computed role reading a computed role through doc. is evaluated after the computed roles', () => {
    const rs = withChecks([{ code: 'FLAT', left: 'max(DEV, OUT)', op: '<=', right: '12', tol: 0, exact_tolerance: true }], { ...MED, line_computed: { DEV: 'abs(V - doc.MED)' } })
    const v = verifyDeclarative(ROWS, rs, { now: NOW })
    expect(claim(v, 'document.FLAT')).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 12, right: 12 } } })
  })
  it('a line-computed role with prev() has no value on the first row, and a check on it says no_neighbour', () => {
    const rs = withChecks([{ code: 'STEP', scope: 'line', left: 'DV', op: '>=', right: '0', tol: 0 }], { line_computed: { DV: 'V - prev(V)' } })
    const v = verifyDeclarative(ROWS, rs, { now: NOW })
    expect(claim(v, 'line[0].STEP')?.insufficiency).toEqual({ reason: 'OUT_OF_RULESET_SCOPE', detail: 'no_neighbour: line 0 has no previous row, so prev(V) has no value (DV on line 0 reads it)' })
    expect(claim(v, 'line[1].STEP')?.outcome).toBe('PASS')
  })
})

describe('earlier engines never read the new forms', () => {
  it('under engine 0.3.0 a new form reads as that engine read it, and the new keys are not read', () => {
    const rs = withChecks([{ code: 'SQ', left: 'sqrt(REF)', op: '=', right: '4', tol: 0 }], { algorithms: { VF: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'V' } } } })
    const v = verifyDeclarative({ ...ROWS, ref: 16 }, rs, { now: NOW, engine: '0.3.0' })
    expect(v.engine_version).toBe('0.3.0')
    // 0.3.0 reads "sqrt" as a role it does not have, as it always did
    expect(claim(v, 'document.SQ')?.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['sqrt'] })
    expect(v.algorithms).toBeUndefined()
    // a comma was never part of 0.3.0's grammar: the evaluator throws on it, exactly as it did
    expect(() => verifyDeclarative(ROWS, one('median(V, OUT)', '=', '40'), { now: NOW, engine: '0.3.0' })).toThrow("invalid character in expression: ','")
    const v4 = verifyDeclarative({ ...ROWS, ref: 16 }, rs, { now: NOW })
    expect(claim(v4, 'document.SQ')?.outcome).toBe('PASS')
    expect(claim(verifyDeclarative(ROWS, one('median(V, OUT)', '=', '40'), { now: NOW }), 'document.C')?.outcome).toBe('PASS')
  })
  it('a ruleset that uses no new form gives under 0.4.0 the verdict 0.3.0 gives, apart from the engine and the id', () => {
    const V2 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.2.json'), 'utf8')) as DeclarativeRuleset
    const V3 = JSON.parse(readFileSync(join(EX, 'peppol-en16931.ruleset.v0.3.json'), 'utf8')) as DeclarativeRuleset
    const doc = {
      invoice_number: 'INV-1', issue_date: '2026-01-01', currency: 'EUR', amount_currency: 'EUR',
      lines: [{ line_extension_amount: 100, invoiced_quantity: 2, price_amount: 50 }, { line_extension_amount: '2OO.00', invoiced_quantity: 4, price_amount: 50 }],
      sum_of_line_net_amount: 300, tax_exclusive_amount: 300, tax_amount: 30, tax_inclusive_amount: 330, payable_amount: '4O0.00',
      vat_breakdown: [{ row: 1, tax_amount: 30 }],
    }
    const strip = (v: Verdict): string => { const { verdict_id: _i, engine_version: _e, scope, ...rest } = v as Verdict & { scope?: { engine_version?: string } }; return JSON.stringify({ ...rest, scope: { ...scope, engine_version: 'x' } }) }
    for (const rs of [V2, V3]) {
      const a = verifyDeclarative(doc, rs, { now: NOW, engine: '0.3.0' })
      const b = verifyDeclarative(doc, rs, { now: NOW, engine: '0.4.0' }) // names the engine it describes
      expect(b.engine_version).toBe('0.4.0')
      expect(strip(b)).toBe(strip(a))
      expect(b.verdict_id).not.toBe(a.verdict_id)
    }
  })
})

describe('named algorithms: sparc.vflat@1', () => {
  it('the outer-in mean, as the source and its reading state', () => {
    expect(sparcVflat({ rad: [1, 2, 3, 4, 5, 6], v: [50, 90, 100, 102, 101, 100] })).toEqual({ ok: true, outputs: { vflat: 100.75, n_used: 4, r_inner: 3 } })
    // every point within 5%: the mean of all
    expect(sparcVflat({ rad: [1, 2, 3], v: [100, 100, 100] })).toEqual({ ok: true, outputs: { vflat: 100, n_used: 3, r_inner: 1 } })
  })
  it('refuses a curve the source rejects, a short curve, and a radius that does not increase', () => {
    expect(sparcVflat({ rad: [1, 2, 3, 4], v: [10, 20, 40, 60] })).toMatchObject({ ok: false, reason: expect.stringContaining('the first test fails') })
    expect(sparcVflat({ rad: [1, 2], v: [100, 100] })).toMatchObject({ ok: false, reason: expect.stringContaining('at least three') })
    expect(sparcVflat({ rad: [1, 3, 3], v: [100, 100, 100] })).toMatchObject({ ok: false, reason: expect.stringContaining('not strictly increasing at row 2') })
  })
  it('the registry pins the implementation file by its bytes, and the quote by its own', () => {
    const e = ALGORITHMS['sparc.vflat@1']!
    const file = readFileSync(join(HERE, '..', e.implementation.file), 'utf8').replace(/\r\n/g, '\n')
    expect(createHash('sha256').update(file, 'utf8').digest('hex')).toBe(e.implementation.sha256)
    expect(createHash('sha256').update(e.source.quote, 'utf8').digest('hex')).toBe(e.source.quote_sha256)
    expect(e.source.quote).toContain('|VN−2 − V | ≤ 0.05.')
    expect(e.source.doi).toBe('10.3847/2041-8205/816/1/L14')
    expect(resolveAlgorithm('sparc.vflat@2')).toBeUndefined()
    expect(algorithmPin('nope@1')).toEqual({ ref: 'nope@1', carried: false })
    expect(pinProblem(algorithmPin('sparc.vflat@1'))).toBeUndefined()
    expect(pinProblem({ ...algorithmPin('sparc.vflat@1'), implementation_sha256: '0'.repeat(64) })).toContain('the implementation changed')
  })
  const ALG = withChecks([
    { code: 'VF', left: 'VF', op: '=', right: 'REF', tol: 1, exact_tolerance: true },
    { code: 'FLATROWS', scope: 'line', applies_if: [{ left: 'R', op: '>=', right: 'doc.RIN' }], left: 'abs(V - doc.VF)', op: '<=', right: '5', tol: 0 },
  ], { algorithms: { VF: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'V' } }, RIN: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'V' }, output: 'r_inner' } } })
  const CURVE = { ref: 100.25, rows: [1, 2, 3, 4, 5, 6].map((r, i) => ({ r, v: [50, 90, 100, 102, 101, 100][i] })) }
  it('an algorithm role computes, is read through doc., and the verdict pins it; the ruleset identity carries the pin', () => {
    const v = verifyDeclarative(CURVE, ALG, { now: NOW })
    expect(claim(v, 'document.VF')).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 100.75, right: 100.25 } } })
    expect(v.claims.filter(c => c.rule_id === 'FLATROWS').map(c => c.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
    expect(v.algorithms).toEqual([algorithmPin('sparc.vflat@1')])
    const id = rulesetIdentity(ALG) as unknown as { algorithms: Record<string, { pin: unknown }> }
    expect(id.algorithms.VF!.pin).toEqual(algorithmPin('sparc.vflat@1'))
    // the input hash binds the pin: the same ruleset with another pin is another input
    expect(verifyInputHash(CURVE, { ruleset: ALG })).toBe(v.input_hash)
    const r = verifyReplay(v, verifyInputs(CURVE, { ruleset: ALG }))
    expect(r.status).toBe('REPERFORMED')
  })
  it('replay refuses a verdict whose pin this build does not carry byte for byte', () => {
    const v = verifyDeclarative(CURVE, ALG, { now: NOW })
    const doctored = { ...v, algorithms: [{ ...algorithmPin('sparc.vflat@1'), implementation_sha256: 'f'.repeat(64) }] } as Verdict
    const r = verifyReplay(doctored, verifyInputs(CURVE, { ruleset: ALG }))
    expect(r.status).toBe('FAILED')
    expect(r.reason).toContain('replay refuses: the verdict pins sparc.vflat@1 with implementation sha256 ffff')
    // a bundle replay names the divergence as the algorithms
    expect(replayBundle({ verdict: doctored, inputs: verifyInputs(CURVE, { ruleset: ALG }) })).toMatchObject({ result: 'DIVERGED', first_difference: 'algorithms' })
    const unknown = verifyReplay({ ...v, algorithms: [{ ref: 'x@1', id: 'x', version: '1' }] } as unknown as Verdict)
    expect(unknown.status).toBe('FAILED')
    expect(unknown.reason).toContain('which this build\'s registry does not carry')
  })
  it('an unreadable input row makes the role unknown, naming the row; the procedure\'s refusal says why', () => {
    const bad = { ...CURVE, rows: CURVE.rows.map((x, i) => (i === 4 ? { ...x, v: '1O1' } : x)) }
    const v = verifyDeclarative(bad, ALG, { now: NOW })
    expect(claim(v, 'document.VF')?.insufficiency).toMatchObject({ reason: 'UNPARSEABLE', missing: ['V'] })
    expect(v.struck?.map(s => s.field)).toEqual(['V@line[4]'])
    const rising = { ref: 1, rows: [1, 2, 3, 4].map((r, i) => ({ r, v: [10, 20, 40, 60][i] })) }
    const w = verifyDeclarative(rising, ALG, { now: NOW })
    expect(claim(w, 'document.VF')?.insufficiency?.reason).toBe('OUT_OF_RULESET_SCOPE')
    expect(claim(w, 'document.VF')?.insufficiency?.detail).toContain('VF: sparc.vflat@1 returns no value: the first test fails')
  })
})

describe('archive provenance', () => {
  const RS: DeclarativeRuleset = {
    id: 'arch', version: '0.0.1', provenance_kinds: ['page', 'archive'],
    fields: { A: { paths: ['a'], kind: 'quantity' }, B: { paths: ['b'], kind: 'quantity' } },
    checks: [{ code: 'C', left: 'A', op: '=', right: 'B', tol: 0 }],
  }
  const BYTES = 'a,b\n7,7\n'
  const sha = createHash('sha256').update(BYTES).digest('hex')
  const md5 = createHash('md5').update(BYTES).digest('hex')
  const prov = (extra: Record<string, unknown> = {}) => ({ kind: 'archive', url: 'https://archive.example/t.csv', retrieved_at: '2026-10-04T00:00:00Z', sha256: sha, reader: 'csv', raw: '7', ...extra })
  const env = (p: Record<string, unknown>) => ({ extraction_contract: '0.1', ruleset: 'arch@0.0.1', fields: { A: { value: 7, provenance: p }, B: { value: 7, provenance: p } } })
  it('is E1 under engine 0.4.0, never E0; the old inference applies under 0.3.0', () => {
    expect(provenanceTier(prov(), { archive: true })).toEqual({ tier: 'E1' })
    expect(provenanceTier(prov({ tier: 'E0' }), { archive: true })).toEqual({ tier: 'E1', capped: { stated: 'E0', inferred: 'E1' } })
    expect(provenanceTier(prov({ tier: 'E3' }), { archive: true })).toEqual({ tier: 'E3' })
    expect(provenanceTier(prov({ sha256: 'x' }), { archive: true })).toEqual({ tier: 'E4' })
    expect(archiveProvenanceProblems(prov({ sha256: 'x' }))).toEqual(['no 64-hex sha256 of the content'])
    expect(provenanceTier(prov())).toEqual({ tier: 'E3' })
    const v = verifyDeclarative(env(prov()), RS, { now: NOW })
    expect(v.evidence_floor).toBe('E1')
    expect(verifyDeclarative(env(prov()), RS, { now: NOW, engine: '0.3.0' }).evidence_floor).toBe('E3')
  })
  it('checksum_verified only when the engine hashed the bytes and they match the checksum the archive publishes', () => {
    const published = prov({ archive_checksum: { algorithm: 'md5', value: md5, published_at: 'https://archive.example/MD5SUM' } })
    const yes = verifyDeclarative(env(published), RS, { now: NOW, source: { text: BYTES } })
    expect(yes.archives).toHaveLength(1)
    expect(yes.archives![0]).toMatchObject({ tier: 'E1', content_verified: true, checksum_verified: true, fields: 2 })
    const noBytes = verifyDeclarative(env(published), RS, { now: NOW })
    expect(noBytes.archives![0]).toMatchObject({ content_verified: false, checksum_verified: false })
    expect(noBytes.archives![0]!.detail).toContain('did not see the bytes')
    const unpublished = verifyDeclarative(env(prov()), RS, { now: NOW, source: { text: BYTES } })
    expect(unpublished.archives![0]).toMatchObject({ content_verified: true, checksum_verified: false })
    expect(unpublished.archives![0]!.detail).toContain('publishes no checksum')
    const wrong = verifyDeclarative(env(prov({ archive_checksum: { algorithm: 'md5', value: '0'.repeat(32) } })), RS, { now: NOW, source: { text: BYTES } })
    expect(wrong.archives![0]).toMatchObject({ content_verified: true, checksum_verified: false })
    const other = verifyDeclarative(env(published), RS, { now: NOW, source: { text: 'another file' } })
    expect(other.archives![0]).toMatchObject({ content_verified: false, checksum_verified: false })
    expect(other.evidence_floor).toBe('E1')
  })
  it('a malformed archive provenance is an assertion: struck', () => {
    const v = verifyDeclarative(env(prov({ url: '' })), RS, { now: NOW })
    expect(v.struck?.map(s => s.reason)).toEqual(['unsupported-assertion', 'unsupported-assertion'])
    expect(v.struck?.[0]?.detail).toContain('archive provenance is malformed (no url)')
  })
  it('the generated schema accepts archive provenance only when the ruleset lists it', () => {
    const { provenance_kinds: _p, ...plain } = RS
    expect(JSON.stringify(extractionSchema(plain as DeclarativeRuleset))).not.toContain('archive')
    expect(JSON.stringify(extractionSchema({ ...plain, provenance_kinds: ['page'] } as DeclarativeRuleset))).toBe(JSON.stringify(extractionSchema(plain as DeclarativeRuleset)))
    expect(validateContract(env(prov()), RS)).toEqual([])
    expect(validateContract(env(prov()), plain as DeclarativeRuleset).length).toBeGreaterThan(0)
    expect(validateContract(env(prov({ sha256: 'nope' })), RS)[0]?.code).toBe('contract.provenance')
  })
})

describe('lint', () => {
  const errs = (rs: Partial<DeclarativeRuleset>): string[] => lintRuleset({ ...TAB, ...rs }).errors
  it('places each new form where it can be read', () => {
    expect(errs({ checks: [{ code: 'A', scope: 'line', left: 'median(V)', op: '=', right: '1' }] })[0]).toContain('median(V) is not available per row')
    expect(errs({ checks: [{ code: 'A', left: 'doc.REF', op: '=', right: '1' }] })[0]).toContain('doc.REF is read on a row')
    expect(errs({ checks: [{ code: 'A', left: 'prev(V)', op: '=', right: '1' }] })[0]).toContain('prev(V) is read on a row')
    expect(errs({ checks: [{ code: 'A', left: 'median(V, NOPE)', op: '=', right: '1' }] })[0]).toContain('names the row set "NOPE"')
    expect(errs({ checks: [{ code: 'A', scope: 'line', left: 'doc.V', op: '=', right: '1' }] })[0]).toContain('"V" is not a document field')
    expect(errs({ checks: [{ code: 'A', left: 'REF', op: '=', right: '1', applies_if: [{ neighbour: 'prev' }] }] })[0]).toContain('a neighbour condition is read on a row')
    expect(errs({ line_computed: { D: 'V - doc.MED' }, computed: { MED: 'median(V, OUT)', M2: 'max(D)' } })).toContain('computed "M2": reads line-computed role "D", which reads a computed or algorithm role through doc. and is evaluated after the computed roles')
    expect(errs({ ...MED, row_sets: { ...TAB.row_sets, S: [{ left: 'V', op: '>=', right: 'doc.MED' }] } }).join(' | ')).toContain('a row-set condition reads document fields only')
    expect(errs({ line_computed: { A: 'prev(B)', B: 'V' } })[0]).toContain('reads line-computed role "B" before it is defined')
  })
  it('checks the algorithms block against the registry', () => {
    expect(errs({ algorithms: { X: { algorithm: 'nope@1', inputs: {} } } })[0]).toContain('"nope@1" is not an algorithm this build carries')
    expect(errs({ algorithms: { X: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R' } } } })[0]).toContain('input "v" (observed rotation velocity per row) is not mapped')
    expect(errs({ algorithms: { X: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'REF' } } } })[0]).toContain('names "REF", which is not a line field')
    expect(errs({ algorithms: { X: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'V' }, output: 'w' } } })[0]).toContain('"output" must be one of vflat, n_used, r_inner')
    expect(errs({ algorithms: { REF: { algorithm: 'sparc.vflat@1', inputs: { rad: 'R', v: 'V' } } } })[0]).toContain('names must be unique')
    expect(errs({ provenance_kinds: ['fax' as 'page'] })[0]).toContain('"provenance_kinds" must be')
  })
  it('the demo ruleset lints clean, from the library and the CLI', () => {
    const rs = JSON.parse(readFileSync(join(EX, 'rotation-curve.ruleset.json'), 'utf8')) as DeclarativeRuleset
    expect(lintRuleset(rs)).toEqual({ ok: true, errors: [], warnings: [] })
    let out = ''
    expect(run(['lint', '--ruleset', join(EX, 'rotation-curve.ruleset.json')], { out: s => { out += s }, err: () => {} })).toBe(0)
    expect(JSON.parse(out)).toEqual({ ok: true, errors: [], warnings: [] })
  })
})

describe('the demo ruleset on a synthetic flat curve', () => {
  const rs = JSON.parse(readFileSync(join(EX, 'rotation-curve.ruleset.json'), 'utf8')) as DeclarativeRuleset
  // a synthetic galaxy: 12 rows, flat near 120 km/s beyond 10 kpc, small baryonic terms (no archive data)
  const R = [1, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16]
  const V = [40, 70, 100, 112, 118, 120, 121, 119, 120, 122, 118, 120]
  const doc = {
    galaxy: 'SYN1', table1: { galaxy: 'SYN1', d_mpc: 10, vflat: 120.0 }, distance_mpc: 10,
    units: { rad: 'kpc', vobs: 'km/s', vgas_vdisk_vbul: 'km/s' },
    rows: R.map((r, i) => ({ rad: r, vobs: V[i], vgas: 10, vdisk: 40, vbul: 0 })),
  }
  it('every claim computes, and the three claims PASS', () => {
    const v = verifyDeclarative(doc, rs, { now: NOW })
    expect(v.outcome).toBe('PASS')
    expect(v.coverage.claims_insufficient).toBe(0)
    expect(claim(v, 'document.C1_FLAT')?.computation?.operands).toEqual({ left: 2, right: 10 })
    expect(claim(v, 'document.C2_EXCESS')?.outcome).toBe('PASS')
    expect(claim(v, 'document.C3_VFLAT_REPLAY')?.outcome).toBe('PASS')
    expect(claim(v, 'document.NMIN_BEYOND_R')?.computation?.operands).toEqual({ left: 7, right: 5 })
    expect(v.algorithms).toEqual([algorithmPin('sparc.vflat@1')])
    expect(verifyReplay(v, verifyInputs(doc, { ruleset: rs })).status).toBe('REPERFORMED')
  })
  it('a bent curve FAILS C1, and a row out of order FAILS the radius check', () => {
    const bent = { ...doc, rows: doc.rows.map((x, i) => (i === 9 ? { ...x, vobs: 140 } : x)) }
    expect(claim(verifyDeclarative(bent, rs, { now: NOW }), 'document.C1_FLAT')?.outcome).toBe('FAIL')
    const swapped = { ...doc, rows: doc.rows.map((x, i) => (i === 7 ? { ...x, rad: 10.5 } : x)) }
    const v = verifyDeclarative(swapped, rs, { now: NOW })
    expect(claim(v, 'line[7].RAD_INCREASING')?.outcome).toBe('FAIL')
    // the algorithm needs strictly increasing radius: it says so, and C3 abstains
    expect(claim(v, 'document.C3_VFLAT_REPLAY')?.insufficiency?.detail).toContain('not strictly increasing at row 7')
  })
})
