/**
 * Ruleset linter — reject a bad declarative ruleset with a clear reason before it ever runs (the safety net a ruleset
 * marketplace / user-authored rulesets need).
 */
import { describe, it, expect } from 'vitest'
import { lintRuleset } from '../src/declarative/lint'

const good = {
  id: 'po', version: '0.0.1', lineArrayKeys: ['items'],
  fields: { AMT: { paths: ['amount'], kind: 'amount', line: true }, SUB: { paths: ['subtotal'] }, TAX: { paths: ['tax'] }, TOTAL: { paths: ['total'] } },
  computed: { SUM: 'sum(AMT)', EXP: 'SUB + TAX' },
  checks: [
    { code: 'SUM_INT', left: 'SUM', op: '=', right: 'SUB' },
    { code: 'TOTAL_INT', left: 'TOTAL', op: '=', right: 'EXP' },
  ],
}

describe('a valid ruleset passes', () => {
  it('no errors, no warnings', () => {
    const r = lintRuleset(good)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe('structural errors', () => {
  it('flags missing id/version/fields/checks', () => {
    expect(lintRuleset({}).errors).toEqual(expect.arrayContaining([expect.stringMatching(/id/), expect.stringMatching(/version/), expect.stringMatching(/fields/), expect.stringMatching(/checks/)]))
  })
  it('flags an empty paths array and a bad kind', () => {
    const r = lintRuleset({ ...good, fields: { ...good.fields, BAD: { paths: [], kind: 'nonsense' } } })
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /BAD.*paths/.test(e))).toBe(true)
    expect(r.errors.some(e => /invalid kind/.test(e))).toBe(true)
  })
})

describe('formula + reference errors', () => {
  it('flags a formula that references an unknown role', () => {
    const r = lintRuleset({ ...good, computed: { SUM: 'sum(AMT)', EXP: 'SUB + GHOST' } })
    expect(r.errors.some(e => /unknown role "GHOST"/.test(e))).toBe(true)
  })
  it('flags a malformed expression', () => {
    const r = lintRuleset({ ...good, checks: [{ code: 'X', left: 'SUB + )', op: '=', right: 'TAX' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
  it('flags an invalid operator', () => {
    expect(lintRuleset({ ...good, checks: [{ code: 'X', left: 'SUB', op: '~', right: 'TAX' }] }).errors.some(e => /invalid op/.test(e))).toBe(true)
  })
})

describe('scope mismatches', () => {
  it('a document-scope check must wrap a per-line field in sum()', () => {
    const r = lintRuleset({ ...good, checks: [{ code: 'X', left: 'AMT', op: '=', right: 'SUB' }] })
    expect(r.errors.some(e => /wrap it as sum\(AMT\)/.test(e))).toBe(true)
  })
  it('a line-scope check cannot reference a document field', () => {
    const r = lintRuleset({ ...good, checks: [{ code: 'X', scope: 'line', left: 'AMT', op: '=', right: 'SUB' }] })
    expect(r.errors.some(e => /line-scope check references document field "SUB"/.test(e))).toBe(true)
  })
})

describe('warnings', () => {
  it('warns about a defined-but-unused role', () => {
    const r = lintRuleset({ ...good, fields: { ...good.fields, UNUSED: { paths: ['x'] } } })
    expect(r.ok).toBe(true)
    expect(r.warnings.some(w => /UNUSED.*never used/.test(w))).toBe(true)
  })
})
