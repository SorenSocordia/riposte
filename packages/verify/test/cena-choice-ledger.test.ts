/**
 * 2026-10-04, engine 0.5.0: the choice ledger. Choice slots a ruleset declares, filled by the claim document (stated, with a
 * quoted span), by the judge (supplied_choices) or by the ruleset's default (supplied), or left unstated (the checks that depend on
 * them abstain); the ledger and the stated rate on every declarative verdict; model checks past their measured support as counsel;
 * per-value quality flags (the Argo scheme); archive bytes hashed for binary files; rar.fit@1. Every fixture is synthetic and inline:
 * no archive data ships with the product.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_VERSION, ENGINE_VERSIONS, verifyDeclarative, verifyReplay, verifyInputs, lintRuleset, choiceLedger, extractionSchema,
  validateContract, ALGORITHMS, algorithmPin, rarFit, rarLogF, QC_SCHEMES, ARGO_QC, qcFlagKey, flagsPolicyProblems, gateStatusOpen,
  type DeclarativeRuleset, type Verdict,
} from '../src/index'
import { run } from '../src/cli'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const EX = join(ROOT, 'docs', 'examples')
const NOW = (): Date => new Date('2026-10-04T06:00:00Z')
const claim = (v: Verdict, id: string) => v.claims.find(c => c.claim_id === id)
const entry = (v: Verdict, id: string) => v.choices?.find(c => c.id === id)

// A small table: a ratio slot read in a row through doc., a tolerance slot read at document scope, a governed selection slot.
const TAB: DeclarativeRuleset = {
  id: 'choice-test', version: '0.0.1', lineArrayKeys: ['rows'], tolerance: { rel: 0, absCap: 0 },
  choices: [
    { id: 'K', kind: 'ratio', load_bearing: true, default: { value: 2, source: 'the ruleset: K = 2' } },
    { id: 'TOL', kind: 'tolerance', load_bearing: true },
    { id: 'SEL', kind: 'selection', load_bearing: true, governs: ['SUM_REF'], default: { value: 'every row', source: 'the ruleset reads every row' } },
    { id: 'FLAGS', kind: 'flags', load_bearing: false, not_applicable: 'the table carries no per-value flag' },
  ],
  fields: {
    X: { paths: ['x'], kind: 'quantity', line: true },
    REF: { paths: ['ref'], kind: 'quantity' },
  },
  line_computed: { KX: 'doc.K * X' },
  checks: [
    { code: 'SUM_REF', left: 'sum(KX)', op: '=', right: 'REF', tol: 0, exact_tolerance: true },
    { code: 'WITHIN', left: 'abs(sum(X) - 6)', op: '<=', right: 'TOL', tol: 0, exact_tolerance: true },
    { code: 'PLAIN', left: 'REF', op: '>=', right: '0', tol: 0, exact_tolerance: true },
  ],
}
const DOC = { ref: 12, rows: [{ x: 1 }, { x: 2 }, { x: 3 }] }
const SPAN = { page: 3, quote: 'we adopt K = 2' }

describe('engine 0.5.0', () => {
  it('is the default engine, and every earlier engine is still carried', () => {
    expect(ENGINE_VERSION).toBe('0.7.2')
    expect([...ENGINE_VERSIONS]).toEqual(['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.7.1', '0.7.2'])
  })
})

describe('the choice ledger', () => {
  it('lists every slot: stated (with its span), supplied by the ruleset, unstated, not applicable; the rate is stated / load-bearing', () => {
    const v = verifyDeclarative({ ...DOC, choices: { K: { value: 2, stated: true, span: SPAN } } }, TAB, { now: NOW })
    expect(v.choices).toEqual([
      { id: 'K', kind: 'ratio', status: 'stated', value: 2, source: { span: SPAN }, load_bearing: true },
      { id: 'TOL', kind: 'tolerance', status: 'unstated', value: null, source: null, load_bearing: true },
      { id: 'SEL', kind: 'selection', status: 'supplied', value: 'every row', source: { default: 'the ruleset reads every row', by: 'ruleset' }, load_bearing: true },
      { id: 'FLAGS', kind: 'flags', status: 'not_applicable', value: null, source: { not_applicable: 'the table carries no per-value flag' }, load_bearing: false },
    ])
    expect(v.counts).toMatchObject({ choices_load_bearing: 3, choices_stated: 1, stated_rate: 0.3333, qc_held: 0, qc_struck: 0, beyond_data: 0 })
  })
  it('a ruleset without slots has an empty ledger and a stated rate of null, never 0; a load-bearing slot nobody states is 0', () => {
    const plain: DeclarativeRuleset = { ...TAB, choices: undefined, line_computed: undefined, checks: [TAB.checks[2]!] }
    const v = verifyDeclarative(DOC, plain, { now: NOW })
    expect(v.choices).toEqual([])
    expect(v.counts?.stated_rate).toBeNull()
    expect(verifyDeclarative(DOC, TAB, { now: NOW }).counts?.stated_rate).toBe(0)
  })
  it('a document marked silent, a malformed stated fill, and a judge value without a source are said, and the default is supplied', () => {
    const silent = verifyDeclarative({ ...DOC, choices: { K: { unstated: true } } }, TAB, { now: NOW })
    expect(entry(silent, 'K')).toMatchObject({ status: 'supplied', value: 2, source: { by: 'ruleset' }, detail: 'the document is marked silent on this choice' })
    const noSpan = verifyDeclarative({ ...DOC, choices: { K: { value: 3, stated: true, span: { quote: 'K = 3' } } } }, TAB, { now: NOW })
    expect(entry(noSpan, 'K')).toMatchObject({ status: 'supplied', value: 2 })
    expect(entry(noSpan, 'K')?.detail).toContain('carries no span with a quote and a page or a section')
    const badJudge = verifyDeclarative(DOC, TAB, { now: NOW, supplied_choices: { K: { value: 5 } as never } })
    expect(entry(badJudge, 'K')).toMatchObject({ status: 'supplied', value: 2, detail: 'the judge\'s value is not { value, source }, so it is not used' })
  })
  it('precedence: a stated fill, then the judge, then the ruleset default', () => {
    const judge = { K: { value: 3, source: 'the judge tries K = 3' } }
    expect(entry(verifyDeclarative(DOC, TAB, { now: NOW, supplied_choices: judge }), 'K')).toMatchObject({ status: 'supplied', value: 3, source: { default: 'the judge tries K = 3', by: 'judge' } })
    expect(entry(verifyDeclarative({ ...DOC, choices: { K: { value: 2, stated: true, span: SPAN } } }, TAB, { now: NOW, supplied_choices: judge }), 'K')).toMatchObject({ status: 'stated', value: 2 })
  })
  it('choiceLedger is the same resolution the verdict states', () => {
    const l = choiceLedger({ choices: { TOL: { value: 0.5, stated: true, span: { section: 'Sect. 2', quote: 'within 0.5' } } } }, TAB)
    expect(l.stated_rate).toBe(0.3333)
    expect(l.values.get('TOL')).toBe(0.5)
    expect(l.values.get('FLAGS')).toBeUndefined()
  })
})

describe('the gate: a check that depends on a choice with no value abstains', () => {
  it('names the slot; checks that do not depend on it compute; the remedy is to state it', () => {
    const v = verifyDeclarative(DOC, TAB, { now: NOW })
    const w = claim(v, 'document.WITHIN')!
    expect(w.outcome).toBe('INSUFFICIENT_DATA')
    expect(w.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['TOL'] })
    expect(w.insufficiency!.detail.startsWith('choice_unstated: this check depends on the choice TOL (tolerance)')).toBe(true)
    expect(claim(v, 'document.SUM_REF')?.outcome).toBe('PASS') // 2 × (1 + 2 + 3) = 12
    expect(claim(v, 'document.PLAIN')?.outcome).toBe('PASS')
    const rem = v.remedies!.find(r => r.claims.includes('document.WITHIN'))!
    expect(rem).toMatchObject({ kind: 'missing-operand', operand: { role: 'TOL', path: 'choices.TOL' } })
    expect(rem.detail).toContain('state the choice TOL (tolerance)')
    expect(gateStatusOpen(v)).toBe('PASS-WITH-OPEN')
  })
  it('a governed slot with no value holds the checks it governs', () => {
    const rs: DeclarativeRuleset = { ...TAB, choices: TAB.choices!.map(c => (c.id === 'SEL' ? { id: 'SEL', kind: 'selection' as const, load_bearing: true, governs: ['SUM_REF'] } : c)) }
    const v = verifyDeclarative(DOC, rs, { now: NOW })
    expect(claim(v, 'document.SUM_REF')?.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['SEL'] })
  })
  it('a stated value computes: a numeric choice is a document role (doc.K in a row)', () => {
    const v = verifyDeclarative({ ...DOC, ref: 18, choices: { K: { value: 3, stated: true, span: SPAN }, TOL: { value: 0, stated: true, span: SPAN } } }, TAB, { now: NOW })
    expect(claim(v, 'document.SUM_REF')).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 18, right: 18 } } })
    expect(claim(v, 'document.WITHIN')?.outcome).toBe('PASS')
    expect(claim(v, 'document.WITHIN')?.evidence.some(e => e.locator.kind === 'field' && e.locator.path === 'choices.TOL.value')).toBe(true)
  })
})

describe('choices enter the verdict identity', () => {
  it('another supplied value is another verdict; the judge\'s values are inputs, and a replay needs them', () => {
    const a = verifyDeclarative(DOC, TAB, { now: NOW })
    const judge = { K: { value: 3, source: 'the judge' } }
    const b = verifyDeclarative(DOC, TAB, { now: NOW, supplied_choices: judge })
    expect(b.verdict_id).not.toBe(a.verdict_id)
    expect(claim(b, 'document.SUM_REF')?.outcome).toBe('FAIL')
    expect(verifyReplay(b, verifyInputs(DOC, { ruleset: TAB, supplied_choices: judge })).status).toBe('REPERFORMED')
    expect(verifyReplay(b, verifyInputs(DOC, { ruleset: TAB })).status).toBe('FAILED')
    expect(verifyReplay(a, verifyInputs(DOC, { ruleset: TAB })).status).toBe('REPERFORMED')
  })
  it('another ruleset default is another verdict', () => {
    const rs: DeclarativeRuleset = { ...TAB, choices: TAB.choices!.map(c => (c.id === 'K' ? { ...c, default: { value: 2, source: 'another source' } } : c)) }
    expect(verifyDeclarative(DOC, rs, { now: NOW }).verdict_id).not.toBe(verifyDeclarative(DOC, TAB, { now: NOW }).verdict_id)
  })
  it('an earlier engine refuses the judge\'s values and archive files, and states no ledger', () => {
    expect(() => verifyDeclarative(DOC, TAB, { now: NOW, engine: '0.4.0', supplied_choices: {} })).toThrow('supplied_choices are read from engine 0.5.0 on')
    expect(() => verifyDeclarative(DOC, TAB, { now: NOW, engine: '0.4.0', archive_files: [] })).toThrow('archive_files are read from engine 0.5.0 on')
    const old = verifyDeclarative(DOC, TAB, { now: NOW, engine: '0.4.0' })
    expect(old.choices).toBeUndefined()
    expect(old.counts).not.toHaveProperty('stated_rate')
  })
})

describe('a ruleset without slots, under 0.5.0', () => {
  it('gives the 0.4.0 verdict apart from identity, an empty ledger and the new counts', () => {
    for (const f of ['peppol-en16931.ruleset.v0.2.json', 'peppol-en16931.ruleset.v0.3.json', 'rotation-curve.ruleset.json']) {
      const rs = JSON.parse(readFileSync(join(EX, f), 'utf8')) as DeclarativeRuleset
      const doc = f.startsWith('rotation') ? { galaxy: 'G', rows: [{ rad: 1, vobs: 10 }] } : { invoice_number: 'INV-1', payable_amount: '4O0.00', lines: [{ line_extension_amount: 100 }] }
      const a = verifyDeclarative(doc, rs, { now: NOW, engine: '0.4.0' })
      const b = verifyDeclarative(doc, rs, { now: NOW, engine: '0.5.0' }) // 2026-10-05: pinned, this test describes 0.5.0
      expect(b.engine_version).toBe('0.5.0')
      const strip = (v: Verdict): string => {
        const { verdict_id: _i, engine_version: _e, scope, choices: _c, counts, ...rest } = v as Verdict & { scope?: { engine_version?: string } }
        const { choices_load_bearing: _1, choices_stated: _2, stated_rate: _3, qc_held: _4, qc_struck: _5, beyond_data: _6, ...c } = counts ?? ({} as NonNullable<Verdict['counts']>)
        return JSON.stringify({ ...rest, counts: c, scope: { ...scope, engine_version: 'x' } })
      }
      expect(strip(b)).toBe(strip(a))
      expect(b.choices).toEqual([])
      expect(b.counts).toMatchObject({ stated_rate: null, choices_load_bearing: 0, choices_stated: 0, qc_held: 0, qc_struck: 0, beyond_data: 0 })
    }
  })
})

describe('algorithm choices and parameters', () => {
  const CURVE = { rows: [1, 2, 3, 4, 5, 6].map((r, i) => ({ rad: r, v: [50, 90, 100, 102, 101, 100][i] })) }
  const ALG: DeclarativeRuleset = {
    id: 'alg-choice', version: '0.0.1', lineArrayKeys: ['rows'], tolerance: { rel: 0, absCap: 0 },
    choices: [{ id: 'VF_ALGO', kind: 'algorithm', load_bearing: true, default: { value: 'sparc.vflat@1', source: 'the ruleset' } }],
    fields: { RAD: { paths: ['rad'], kind: 'quantity', line: true }, V: { paths: ['v'], kind: 'quantity', line: true } },
    algorithms: { VF: { algorithm: 'sparc.vflat@1', inputs: { rad: 'RAD', v: 'V' }, choice: 'VF_ALGO' } },
    checks: [{ code: 'VF_OK', left: 'VF', op: '=', right: '100.75', tol: 0, exact_tolerance: true }],
  }
  it('a stated algorithm is checked verbatim against the registry\'s pinned quote', () => {
    const yes = verifyDeclarative({ ...CURVE, choices: { VF_ALGO: { value: 'sparc.vflat@1', stated: true, span: { section: 'Sect. 2.2', quote: 'We estimate Vf using a simple automated algorithm.' } } } }, ALG, { now: NOW })
    expect(entry(yes, 'VF_ALGO')?.source).toMatchObject({ registry: { ref: 'sparc.vflat@1', verbatim: true } })
    expect(claim(yes, 'document.VF_OK')?.outcome).toBe('PASS')
    const no = verifyDeclarative({ ...CURVE, choices: { VF_ALGO: { value: 'sparc.vflat@1', stated: true, span: { section: 'Sect. 2.2', quote: 'We take the mean of all points.' } } } }, ALG, { now: NOW })
    expect(entry(no, 'VF_ALGO')?.source).toMatchObject({ registry: { verbatim: false } })
  })
  it('a document that states another procedure leaves the role without a value: choice_mismatch, never a substitute', () => {
    const v = verifyDeclarative({ ...CURVE, choices: { VF_ALGO: { value: 'sparc.vflat@2', stated: true, span: { section: 'Sect. 2', quote: 'our own V_f' } } } }, ALG, { now: NOW })
    const c = claim(v, 'document.VF_OK')!
    expect(c.outcome).toBe('INSUFFICIENT_DATA')
    expect(c.insufficiency).toMatchObject({ reason: 'OUT_OF_RULESET_SCOPE' })
    expect(c.insufficiency!.detail).toContain('choice_mismatch: the choice VF_ALGO names "sparc.vflat@2" (stated)')
  })
  it('an algorithm entry added at 0.5.0 is not carried by an earlier engine', () => {
    const rs: DeclarativeRuleset = { ...RAR_RS, choices: undefined, algorithms: { G: { algorithm: 'rar.fit@1', inputs: { x: 'X', y: 'Y', sx: 'SX', sy: 'SY' } } } }
    const v = verifyDeclarative(points(1.2), rs, { now: NOW, engine: '0.4.0' })
    expect(claim(v, 'document.A')?.insufficiency?.detail).toContain('rar.fit@1 is carried from engine 0.5.0 on')
  })
})

// rar.fit@1 on synthetic points that lie exactly on the relation at a known g†
const points = (g: number, n = 40): Record<string, unknown> => ({
  points: Array.from({ length: n }, (_, i) => { const x = -12 + (3.5 * i) / (n - 1); return { x, y: rarLogF(x, g), sx: 0.05 + 0.001 * i, sy: 0.1 } }),
})
const RAR_RS: DeclarativeRuleset = {
  id: 'rar-test', version: '0.0.1', lineArrayKeys: ['points'], tolerance: { rel: 0, absCap: 0 },
  choices: [{ id: 'W', kind: 'weights', load_bearing: true, default: { value: 'errors', source: 'the ruleset' } }],
  fields: { X: { paths: ['x'], kind: 'quantity', line: true }, Y: { paths: ['y'], kind: 'quantity', line: true }, SX: { paths: ['sx'], kind: 'quantity', line: true }, SY: { paths: ['sy'], kind: 'quantity', line: true } },
  algorithms: { G: { algorithm: 'rar.fit@1', inputs: { x: 'X', y: 'Y', sx: 'SX', sy: 'SY' }, params: { weighting: 'W' } } },
  checks: [{ code: 'A', left: 'G', op: '=', right: '1.2', tol: 0.000001, exact_tolerance: true }],
}

describe('rar.fit@1', () => {
  it('the registry pins the implementation file by its bytes, and the quote by its own', () => {
    const e = ALGORITHMS['rar.fit@1']!
    const file = readFileSync(join(ROOT, e.implementation.file), 'utf8').replace(/\r\n/g, '\n')
    expect(createHash('sha256').update(file, 'utf8').digest('hex')).toBe(e.implementation.sha256)
    expect(createHash('sha256').update(e.source.quote, 'utf8').digest('hex')).toBe(e.source.quote_sha256)
    expect(e.since).toBe('0.5.0')
    expect(algorithmPin('rar.fit@1')).toMatchObject({ source: { reference_sha256: 'c332cce0b57823c663ea1996e7c3a3ff591c6bc630daf0d78c8ed597798fc63d' } })
    expect(algorithmPin('sparc.vflat@1')).not.toHaveProperty('source.reference_sha256')
  })
  it('recovers g† from points on the relation, weighted and unweighted, deterministically', () => {
    const p = (points(1.2).points as { x: number; y: number; sx: number; sy: number }[])
    const inp = { x: p.map(r => r.x), y: p.map(r => r.y), sx: p.map(r => r.sx), sy: p.map(r => r.sy) }
    const a = rarFit(inp, 'errors'), b = rarFit(inp, 'unweighted')
    expect(a.ok && Math.abs(a.outputs.g_dagger - 1.2) < 1e-6).toBe(true)
    expect(b.ok && Math.abs(b.outputs.g_dagger - 1.2) < 1e-6).toBe(true)
    expect(rarFit(inp, 'errors')).toEqual(a)
    expect(rarFit({ ...inp, sx: inp.sx.map(() => 0) }, 'errors')).toMatchObject({ ok: false, reason: expect.stringContaining('σ that is not a positive finite number') })
    expect(rarFit({ x: [1], y: [1], sx: [1], sy: [1] }, 'errors')).toMatchObject({ ok: false, reason: expect.stringContaining('at least two rows') })
  })
  it('the weighting comes from a choice slot; the judge may supply another; an unknown value has no fit', () => {
    const v = verifyDeclarative(points(1.2), RAR_RS, { now: NOW })
    expect(claim(v, 'document.A')?.outcome).toBe('PASS')
    expect(entry(v, 'W')).toMatchObject({ status: 'supplied', value: 'errors' })
    const u = verifyDeclarative(points(1.2), RAR_RS, { now: NOW, supplied_choices: { W: { value: 'unweighted', source: 'the judge' } } })
    expect(claim(u, 'document.A')?.outcome).toBe('PASS')
    expect(u.verdict_id).not.toBe(v.verdict_id)
    const bad = verifyDeclarative(points(1.2), RAR_RS, { now: NOW, supplied_choices: { W: { value: 'robust', source: 'the judge' } } })
    expect(claim(bad, 'document.A')?.insufficiency?.detail).toContain('the choice W gives rar.fit@1 the parameter weighting = "robust"; rar.fit@1 takes "errors" or "unweighted"')
  })
  it('lint asks for every parameter from a slot', () => {
    const r = lintRuleset({ ...RAR_RS, algorithms: { G: { algorithm: 'rar.fit@1', inputs: { x: 'X', y: 'Y', sx: 'SX', sy: 'SY' } } } })
    expect(r.errors).toContain('algorithms "G": rar.fit@1 takes its parameter "weighting" (errors | unweighted) from a choice slot, and "params" names none')
  })
})

describe('beyond the measured support: counsel, never a verdict', () => {
  const RS: DeclarativeRuleset = {
    id: 'support-test', version: '0.0.1', lineArrayKeys: ['rows'], tolerance: { rel: 0, absCap: 0 },
    fields: { R: { paths: ['r'], kind: 'quantity', line: true }, V: { paths: ['v'], kind: 'quantity', line: true }, AT: { paths: ['at'], kind: 'quantity' } },
    computed: { RMAX: 'max(R)' },
    checks: [{ code: 'MODEL', left: '100 * AT', op: '>=', right: '50', tol: 0, exact_tolerance: true, support: { field: 'AT', max_of: 'R' } }],
  }
  const rows = [{ r: 1, v: 10 }, { r: 2, v: 20 }, { r: 4, v: 30 }]
  it('inside the support the check is a claim; past it, an advisory with beyond_data, the values and the two support numbers', () => {
    expect(claim(verifyDeclarative({ at: 4, rows }, RS, { now: NOW }), 'document.MODEL')?.outcome).toBe('PASS')
    const v = verifyDeclarative({ at: 8, rows }, RS, { now: NOW })
    expect(claim(v, 'document.MODEL')).toBeUndefined()
    expect(v.advisories).toEqual([expect.objectContaining({
      channel: 'COUNSEL', rule_id: 'MODEL', claim_id: 'document.MODEL', beyond_data: true,
      support: { field: 'AT', value: 8, max_of: 'R', last: 4 }, computation: expect.objectContaining({ operands: { left: 800, right: 50 } }),
    })])
    expect(v.advisories![0]!.detail).toContain('past the data')
    expect(v.counts?.beyond_data).toBe(1)
    expect(v.coverage.claims_total).toBe(0)
  })
  it('a support it cannot evaluate abstains: never decided on a guess', () => {
    const v = verifyDeclarative({ rows }, RS, { now: NOW })
    expect(claim(v, 'document.MODEL')?.insufficiency?.reason).toBe('FIELD_MISSING')
    const w = verifyDeclarative({ at: 2, rows: [...rows, { r: '4O', v: 1 }] }, RS, { now: NOW })
    expect(claim(w, 'document.MODEL')?.insufficiency?.detail).toContain('support: the measured support R has no largest value')
  })
  it('the rotation-curve demo (v0.2): the flat model inside the data is a claim; at twice the last radius it is counsel', () => {
    const rs = JSON.parse(readFileSync(join(EX, 'rotation-curve.v0.2.json'), 'utf8')) as DeclarativeRuleset
    expect(lintRuleset(rs)).toEqual({ ok: true, errors: [], warnings: [] })
    const vs = [60, 110, 140, 148, 150, 151, 150, 149, 150, 151, 150, 149]
    const doc = {
      galaxy: 'SYNTH-1', table1: { galaxy: 'SYNTH-1', d_mpc: 10, vflat: 150 }, distance_mpc: 10, units: { rad: 'kpc', vobs: 'km/s', vgas_vdisk_vbul: 'km/s' },
      rows: vs.map((v, i) => ({ rad: 2 * (i + 1), vobs: v, vgas: 10, vdisk: 60, vbul: 0 })),
    }
    const v = verifyDeclarative(doc, rs, { now: NOW })
    expect(v.claims.filter(c => c.rule_id === 'C4_FLAT_MODEL_AT_RLAST').map(c => [c.claim_id, c.outcome])).toEqual([['line[11].C4_FLAT_MODEL_AT_RLAST', 'PASS']])
    expect(v.advisories?.map(a => [a.rule_id, a.beyond_data, a.support])).toEqual([['C5_FLAT_MODEL_MASS_2RLAST', true, { field: 'R_TWICE', value: 48, max_of: 'RAD', last: 24 }]])
    expect(v.choices?.map(c => [c.id, c.status])).toEqual([['UPS_DISK', 'supplied'], ['UPS_BUL', 'supplied'], ['VF_ALGORITHM', 'supplied'], ['FLAT_MODEL', 'supplied'], ['G_KPC', 'supplied'], ['QC_FLAGS', 'not_applicable']])
    expect(v.counts?.stated_rate).toBe(0)
    // the same table under v0.1 keeps its claims: v0.2's V_bar reads the ratios as choices with the same values
    const v1 = verifyDeclarative(doc, JSON.parse(readFileSync(join(EX, 'rotation-curve.ruleset.json'), 'utf8')) as DeclarativeRuleset, { now: NOW })
    for (const id of ['document.C1_FLAT', 'document.C2_EXCESS', 'document.C3_VFLAT_REPLAY']) expect(claim(v, id)?.computation).toEqual(claim(v1, id)?.computation)
  })
})

describe('per-value quality flags (the Argo scheme)', () => {
  const POLICY = { scheme: 'argo', compute: [1], hold: [0, 2, 3, 5, 8], strike: [4], absent: [9] }
  const RS: DeclarativeRuleset = {
    id: 'argo-test', version: '0.0.1', lineArrayKeys: ['levels'], tolerance: { rel: 0, absCap: 0 }, provenance_kinds: ['page', 'archive'],
    choices: [{ id: 'QC', kind: 'flags', load_bearing: true, governs: ['TMAX'], default: { value: POLICY, source: 'the Argo FAQ for mixed-layer work: use QC = 1 only' } }],
    fields: { PRES: { paths: ['pres'], kind: 'quantity', line: true }, TEMP: { paths: ['temp'], kind: 'quantity', line: true } },
    checks: [
      { code: 'TMAX', left: 'max(TEMP)', op: '<=', right: '40', tol: 0, exact_tolerance: true },
      { code: 'TROW', scope: 'line', left: 'TEMP', op: '>=', right: '-2.5', tol: 0, exact_tolerance: true },
    ],
  }
  const prov = (raw: string, flag?: number | string) => ({ kind: 'archive', url: 'https://data-argo.example/R1.nc', retrieved_at: '2026-10-04T00:00:00Z', sha256: 'a'.repeat(64), reader: 'netcdf TEMP_ADJUSTED', raw, ...(flag !== undefined ? { qc: { scheme: 'argo', flag } } : {}) })
  const env = (temps: [number, number | string | undefined][], extra: Record<string, unknown> = {}) => ({
    extraction_contract: '0.1', ruleset: 'argo-test@0.0.1', fields: {}, ...extra,
    lines: temps.map(([t, f], i) => ({ fields: { PRES: { value: 5 * (i + 1), provenance: prov(String(5 * (i + 1)), 1) }, TEMP: { value: t, provenance: prov(String(t), f) } } })),
  })
  const LEVELS: [number, number][] = [[12.1, 1], [12.0, 1], [57.39, 4], [11.8, 1]]
  it('the scheme file and its copy in the build are the same, and every flag is defined', () => {
    const file = readFileSync(join(ROOT, 'src', 'schemes', 'argo-qc.json'), 'utf8')
    expect(JSON.parse(file)).toEqual(ARGO_QC)
    expect(createHash('sha256').update(file.replace(/\r\n/g, '\n'), 'utf8').digest('hex')).toBe(createHash('sha256').update(readFileSync(join(ROOT, 'src', 'schemes', 'argo-qc.json'), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex'))
    expect(Object.keys(QC_SCHEMES.argo!.flags)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' '])
    expect(ARGO_QC.flags['4']!.meaning).toBe('Bad data')
    expect(ARGO_QC.source.doi).toBe('10.13155/29825')
    expect([qcFlagKey(4), qcFlagKey('4'), qcFlagKey(10), qcFlagKey('44')]).toEqual(['4', '4', undefined, undefined])
  })
  it('honouring the flags: a struck value is left out of the aggregate and the rest compute; a direct read abstains', () => {
    const v = verifyDeclarative(env(LEVELS), RS, { now: NOW })
    expect(claim(v, 'document.TMAX')).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 12.1 } } })
    expect(claim(v, 'line[2].TROW')?.outcome).toBe('INSUFFICIENT_DATA')
    expect(v.struck).toEqual([expect.objectContaining({ field: 'TEMP@line[2]', reason: 'qc_struck' })])
    expect(v.struck![0]!.detail).toContain('argo flag 4 (Bad data): the flags choice QC strikes it')
    expect(v.qc).toEqual({ choice: 'QC', read: 8, computed: 7, held: 0, struck: 1, absent: 0, not_read: 0, values: [{ field: 'TEMP@line[2]', path: 'levels[2].temp', scheme: 'argo', flag: '4', meaning: 'Bad data', action: 'struck' }] })
    expect(v.counts).toMatchObject({ qc_struck: 1, qc_held: 0 })
    expect(v.evidence_floor).toBe('E1') // a flag grades the measurement, never the reading
  })
  it('ignoring the flags is a stated choice too: a policy that computes every flag reads 57.39 and FAILs', () => {
    const v = verifyDeclarative(env(LEVELS), RS, { now: NOW, supplied_choices: { QC: { value: { scheme: 'argo', compute: [0, 1, 2, 3, 4, 5, 8] }, source: 'the judge ignores the flags' } } })
    expect(claim(v, 'document.TMAX')).toMatchObject({ outcome: 'FAIL', computation: { operands: { left: 57.39 } } })
  })
  it('a held value makes the aggregate wait (OPEN); a missing value (flag 9) is left out; an unplaced flag holds', () => {
    const held = verifyDeclarative(env([[12.1, 1], [12.0, 2], [11.8, 1]]), RS, { now: NOW })
    expect(claim(held, 'document.TMAX')?.outcome).toBe('INSUFFICIENT_DATA')
    expect(held.struck?.map(s => [s.field, s.reason])).toEqual([['TEMP@line[1]', 'qc_held']])
    expect(gateStatusOpen(held)).toBe('OPEN')
    expect(held.remedies?.find(r => r.claims.includes('document.TMAX'))?.detail).toContain('is held by its quality flag')
    const absent = verifyDeclarative(env([[12.1, 1], [99999, 9], [11.8, 1]]), RS, { now: NOW })
    expect(claim(absent, 'document.TMAX')).toMatchObject({ outcome: 'PASS', computation: { operands: { left: 12.1 } } })
    expect(absent.qc?.values).toEqual([expect.objectContaining({ flag: '9', meaning: 'Missing value', action: 'absent' })])
    const unplaced = verifyDeclarative(env([[12.1, 1], [12.0, 7]]), RS, { now: NOW })
    expect(unplaced.struck?.[0]?.detail).toContain('argo flag 7 (Not used): the flags choice QC does not place this flag, so it holds the value')
    const undefinedFlag = verifyDeclarative(env([[12.1, 1], [12.0, 'X']]), RS, { now: NOW })
    expect(undefinedFlag.qc?.values[0]).toMatchObject({ flag: 'X', action: 'struck', meaning: 'not a flag the scheme defines' })
  })
  it('without a flags choice the flag is not read: computed as given and counted', () => {
    const rs: DeclarativeRuleset = { ...RS, choices: undefined }
    const v = verifyDeclarative(env(LEVELS), rs, { now: NOW })
    expect(claim(v, 'document.TMAX')?.outcome).toBe('FAIL')
    expect(v.qc).toMatchObject({ choice: null, read: 8, not_read: 8, values: [] })
  })
  it('an earlier engine does not read qc', () => {
    const v = verifyDeclarative(env(LEVELS), RS, { now: NOW, engine: '0.4.0' })
    expect(v.qc).toBeUndefined()
  })
  it('lint checks a flags policy against its scheme; the generated schema accepts qc only with a flags choice', () => {
    expect(flagsPolicyProblems(POLICY, 'p')).toEqual([])
    expect(flagsPolicyProblems({ scheme: 'argo', compute: [1, 10], hold: [1] }, 'p')).toEqual(['p.compute: 10 is not a flag the argo scheme defines', 'p: flag "1" is in both compute and hold'])
    expect(flagsPolicyProblems({ scheme: 'woce' }, 'p')[0]).toContain('"scheme" must name a scheme this build carries (argo)')
    expect(validateContract(env(LEVELS), RS)).toEqual([])
    expect(validateContract(env(LEVELS), { ...RS, choices: undefined }).length).toBeGreaterThan(0)
  })
})

describe('archive bytes: a binary file reaches checksum_verified', () => {
  const RS: DeclarativeRuleset = {
    id: 'fits-test', version: '0.0.1', provenance_kinds: ['page', 'archive'],
    fields: { INSTRUME: { paths: ['instrume'], kind: 'identifier' } },
    checks: [{ code: 'MIRI', compare: 'member', left: 'INSTRUME', op: '=', right: 'the instrument', in: ['MIRI'] }],
  }
  const header = 'SIMPLE  =                    T / conforms to FITS standard'.padEnd(80) + "INSTRUME= 'MIRI    '".padEnd(80) + 'END'.padEnd(80)
  const bytes = Buffer.concat([Buffer.from(header.padEnd(2880), 'ascii'), Buffer.from(Array.from({ length: 2880 }, (_, i) => (i * 37) % 256))])
  const sha = createHash('sha256').update(bytes).digest('hex')
  const md5 = createHash('md5').update(bytes).digest('hex')
  const env = { extraction_contract: '0.1', ruleset: 'fits-test@0.0.1', fields: { INSTRUME: { value: 'MIRI', provenance: { kind: 'archive', url: 'https://archive.example/jw_cal.fits', retrieved_at: '2026-10-04T00:00:00Z', sha256: sha, archive_checksum: { algorithm: 'md5', value: md5, published_at: 'the archive\'s product record' }, reader: 'FITS primary header card INSTRUME', raw: "'MIRI    '" } } } }
  it('hashes the bytes it is given: sha256 and the archive\'s own md5', () => {
    const v = verifyDeclarative(env, RS, { now: NOW, archive_files: [{ name: 'jw_cal.fits', base64: bytes.toString('base64') }] })
    expect(v.archives).toEqual([expect.objectContaining({ content_verified: true, checksum_verified: true, matched: 'archive_files[0] (jw_cal.fits)' })])
    expect(v.archives![0]!.detail).toContain(`the engine hashed archive_files[0] (jw_cal.fits) (${bytes.length} bytes)`)
    expect(v.evidence_floor).toBe('E1')
    const replay = verifyReplay(v, verifyInputs(env, { ruleset: RS, archive_files: [{ name: 'jw_cal.fits', base64: bytes.toString('base64') }] }))
    expect(replay.status).toBe('REPERFORMED')
  })
  it('one changed byte: neither verified; no bytes: the engine says it did not see them; malformed base64 is said', () => {
    const flipped = Buffer.from(bytes); flipped[3000] = (flipped[3000]! + 1) % 256
    const v = verifyDeclarative(env, RS, { now: NOW, archive_files: [{ base64: flipped.toString('base64') }] })
    expect(v.archives![0]).toMatchObject({ content_verified: false, checksum_verified: false })
    expect(v.archives![0]!.detail).toContain('none of the bytes supplied is')
    expect(verifyDeclarative(env, RS, { now: NOW }).archives![0]!.detail).toContain('no source text and no archive file was supplied')
    expect(verifyDeclarative(env, RS, { now: NOW, archive_files: [{ base64: '***' }] }).archives![0]!.detail).toContain('archive_files[0] is not base64, so it was not read')
  })
})

describe('lint: choice slots', () => {
  it('a clean ruleset lints clean; the demos lint clean; a load-bearing slot without a default warns that its checks may abstain', () => {
    expect(lintRuleset(TAB).errors).toEqual([])
    expect(lintRuleset(TAB).warnings).toContain('choice "TOL": load-bearing with no default: a document that does not state it, with no value from the judge, leaves WITHIN abstaining (choice_unstated)')
    for (const f of ['rotation-curve.v0.2.json', 'rar-sparc.ruleset.json']) expect(lintRuleset(JSON.parse(readFileSync(join(EX, f), 'utf8')))).toEqual({ ok: true, errors: [], warnings: [] })
  })
  it('refuses what cannot be a slot, and a slot a check reads that is not declared load-bearing', () => {
    const r = lintRuleset({
      ...TAB,
      choices: [
        { id: 'K', kind: 'ratio', load_bearing: false, default: { value: 'two', source: 's' } },
        { id: 'K', kind: 'ratio', load_bearing: true },
        { id: 'X', kind: 'colour', load_bearing: 'yes' },
        { id: 'NA', kind: 'flags', load_bearing: true, not_applicable: 'none', default: { value: 1, source: 's' } },
        { id: 'G', kind: 'selection', load_bearing: true, governs: ['NOPE'] },
        { id: 'TOL', kind: 'tolerance', load_bearing: true },
      ],
    })
    expect(r.errors).toEqual(expect.arrayContaining([
      'choices[1] (K): duplicate id "K"',
      'choices[2] (X): "X" is also a field, computed, line-computed or algorithm role, or a row set: names must be unique',
      'choices[2] (X): "kind" must be one of weights, flags, ratio, units, model_form, algorithm, tolerance, selection',
      'choices[2] (X): "load_bearing" must be true or false',
      'choices[3] (NA): a choice declared not applicable is never load-bearing',
      'choices[3] (NA): a choice declared not applicable has no default',
      'choices[4] (G): "governs" names "NOPE", which is not a check code',
      'choice "K": the checks SUM_REF depend on it, so it is load-bearing (declare "load_bearing": true)',
      'choice "K": an expression reads it, and its default is "two", not a number',
    ]))
  })
  it('a line check reads a choice through doc.; a load-bearing slot nothing depends on is a warning', () => {
    const r = lintRuleset({ ...TAB, checks: [...TAB.checks, { code: 'ROWK', scope: 'line', left: 'X * K', op: '>=', right: '0' }] })
    expect(r.errors).toContain('check[3] (ROWK): line-scope check references choice "K" directly (a choice is document-scope: read it as doc.K)')
    const w = lintRuleset({ ...TAB, choices: [...TAB.choices!, { id: 'IDLE', kind: 'units', load_bearing: true, default: { value: 1, source: 's' } }] })
    expect(w.warnings).toContain('choice "IDLE": declared load-bearing, and no check depends on it (name the checks it governs with "governs")')
  })
  it('support is { field, max_of } with a measured line field', () => {
    const r = lintRuleset({ ...TAB, checks: [{ code: 'M', left: 'REF', op: '>=', right: '0', support: { field: 'REF', max_of: 'REF' } }] })
    expect(r.errors).toContain('check[0] (M): support.max_of "REF" must be a line field or a line-computed role (the measured support)')
  })
})

describe('the extraction contract and the refused envelope state the ledger', () => {
  it('a ruleset with slots accepts the document\'s fills; every other schema is unchanged', () => {
    const rs = JSON.parse(readFileSync(join(EX, 'rotation-curve.v0.2.json'), 'utf8')) as DeclarativeRuleset
    const s = extractionSchema(rs) as { properties: Record<string, unknown> }
    expect(Object.keys((s.properties.choices as { properties: object }).properties)).toEqual(['UPS_DISK', 'UPS_BUL', 'VF_ALGORITHM', 'FLAT_MODEL', 'G_KPC', 'QC_FLAGS'])
    const v1 = extractionSchema(JSON.parse(readFileSync(join(EX, 'rotation-curve.ruleset.json'), 'utf8'))) as { properties: Record<string, unknown> }
    expect(v1.properties).not.toHaveProperty('choices')
  })
  it('an envelope the contract refuses still states the ledger under 0.5.0', () => {
    const rs: DeclarativeRuleset = { ...TAB, require_contract: true }
    const v = verifyDeclarative({ ref: 1, choices: { K: { value: 2, stated: true, span: SPAN } } }, rs, { now: NOW })
    expect(claim(v, 'contract.EXTRACTION_CONTRACT')?.outcome).toBe('INSUFFICIENT_DATA')
    expect(entry(v, 'K')?.status).toBe('stated')
    expect(v.counts).toMatchObject({ choices_load_bearing: 3, choices_stated: 1, stated_rate: 0.3333 })
  })
})

describe('the CLI', () => {
  const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (s: string) => { o.out += s }, err: (s: string) => { o.err += s } } } }
  it('--supplied-choices and --archive-file reach the verdict, and the bundle replays', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'cena-cli-'))
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(DOC))
    writeFileSync(join(dir, 'rs.json'), JSON.stringify(TAB))
    writeFileSync(join(dir, 'sup.json'), JSON.stringify({ TOL: { value: 0.5, source: 'the judge' } }))
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 255]))
    const a = io()
    const code = run([join(dir, 'doc.json'), '--ruleset', join(dir, 'rs.json'), '--supplied-choices', join(dir, 'sup.json'), '--archive-file', join(dir, 'blob.bin')], a.io)
    expect(code).toBe(0)
    const v = JSON.parse(a.o.out) as Verdict
    expect(entry(v, 'TOL')).toMatchObject({ status: 'supplied', value: 0.5, source: { by: 'judge' } })
    expect(claim(v, 'document.WITHIN')?.outcome).toBe('PASS')
    const inputs = verifyInputs(DOC, { ruleset: TAB, supplied_choices: { TOL: { value: 0.5, source: 'the judge' } }, archive_files: [{ name: 'blob.bin', base64: Buffer.from([0, 1, 2, 255]).toString('base64') }] })
    expect(v.input_hash).toBe(verifyReplay(v, inputs).expected_input_hash)
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ verdict: v, inputs }))
    const b = io()
    expect(run(['replay', join(dir, 'bundle.json')], b.io)).toBe(0)
  })
})
