/**
 * Three additive declarative forms (T2, 2026-10-03), each read only when a ruleset uses it:
 *   1. compare: "member": a field's value(s) in a code list (=) or in none of it (!=); a schematron code list's comparison
 *   2. applies_if { field, present: true } and { any_present: [...] }: a rule over an optional element applies only when it is there
 *   3. alternatives on an identifier check: "A or B must be present", forms chosen by presence, never by outcome
 *   4. lint: the shapes are checked; a malformed one is an error
 * A ruleset without them keeps its bytes: the goldens (declarative-golden*.test.ts) still pass unchanged.
 */
import { describe, expect, it } from 'vitest'
import { verifyDeclarative, lintRuleset, type DeclarativeRuleset } from '../src/index'

const RS = (checks: DeclarativeRuleset['checks'], fields: DeclarativeRuleset['fields'] = {}): DeclarativeRuleset => ({
  id: 't2-forms', version: '0.0.1',
  fields: {
    CUR: { paths: ['currency'], kind: 'identifier' }, CODES: { paths: ['codes'], kind: 'identifier' },
    TAXCUR: { paths: ['tax_currency'], kind: 'identifier' }, TOTAL: { paths: ['total'] },
    A: { paths: ['a'], kind: 'identifier' }, B: { paths: ['b'], kind: 'identifier' }, C: { paths: ['c'], kind: 'identifier' },
    STREET: { paths: ['street'], kind: 'identifier' }, CITY: { paths: ['city'], kind: 'identifier' },
    LINE_CODE: { paths: ['unit'], kind: 'identifier', line: true },
    ...fields,
  },
  checks,
})
const claim = (rs: DeclarativeRuleset, x: Record<string, unknown>, id: string) => {
  const v = verifyDeclarative(x, rs)
  return { c: v.claims.find(c => c.claim_id === id), na: (v.not_applicable ?? []).find(n => n.claim_id === id), v }
}

describe('1. compare: "member"', () => {
  const rs = RS([{ code: 'CL', compare: 'member', left: 'CUR', op: '=', right: 'codes ISO 4217 (excerpt)', in: ['EUR', 'USD', 'GBP'] }])
  it('a listed code passes, an unlisted one fails naming it, absent abstains, unreadable abstains', () => {
    expect(claim(rs, { currency: 'EUR' }, 'document.CL').c).toMatchObject({ outcome: 'PASS', kind: 'CONSISTENCY', asserted: 'EUR' })
    const f = claim(rs, { currency: 'SEK' }, 'document.CL').c!
    expect(f.outcome).toBe('FAIL')
    expect(f.explanation).toMatch(/SEK is not one of the 3 listed codes \(SEK\)/)
    expect(claim(rs, {}, 'document.CL').c!.insufficiency!.reason).toBe('FIELD_MISSING')
    expect(claim(rs, { currency: 'UNREADABLE' }, 'document.CL').c!.insufficiency!.reason).toBe('UNPARSEABLE')
  })
  it('as a schematron code list compares: case kept, whitespace trimmed, an inner space never matches, format characters dropped', () => {
    expect(claim(rs, { currency: 'eur' }, 'document.CL').c!.outcome).toBe('FAIL')
    expect(claim(rs, { currency: '  EUR ' }, 'document.CL').c!.outcome).toBe('PASS')
    expect(claim(rs, { currency: 'E UR' }, 'document.CL').c!.outcome).toBe('FAIL')
    expect(claim(rs, { currency: 'EU​R' }, 'document.CL').c!.outcome).toBe('PASS')
  })
  it('a list of codes passes only when every one is listed; != passes when none is', () => {
    const many = RS([{ code: 'CL', compare: 'member', left: 'CODES', op: '=', right: 'x', in: ['EUR', 'USD'] }])
    expect(claim(many, { codes: ['EUR', 'USD'] }, 'document.CL').c!.outcome).toBe('PASS')
    expect(claim(many, { codes: ['EUR', 'SEK'] }, 'document.CL').c!.outcome).toBe('FAIL')
    const not = RS([{ code: 'NOT', compare: 'member', left: 'CUR', op: '!=', right: 'x', in: ['XXX'] }])
    expect(claim(not, { currency: 'EUR' }, 'document.NOT').c!.outcome).toBe('PASS')
    expect(claim(not, { currency: 'XXX' }, 'document.NOT').c!.outcome).toBe('FAIL')
  })
  it('per line', () => {
    const line = { ...RS([{ code: 'UNIT', scope: 'line', compare: 'member', left: 'LINE_CODE', op: '=', right: 'x', in: ['C62', 'H87'] }]), lineArrayKeys: ['lines'] }
    const v = verifyDeclarative({ lines: [{ unit: 'C62' }, { unit: 'ZZZ' }] }, line)
    expect(v.claims.map(c => [c.claim_id, c.outcome])).toEqual([['line[0].UNIT', 'PASS'], ['line[1].UNIT', 'FAIL']])
  })
})

describe('2. applicability by presence', () => {
  const rs = RS([{ code: 'R005', compare: 'identifier', left: 'TAXCUR', op: '!=', right: 'CUR', applies_if: [{ field: 'TAXCUR', present: true }] }])
  it('{ field, present: true }: absent → not applicable (no claim); present → the check runs; unreadable → abstains', () => {
    const a = claim(rs, { currency: 'EUR' }, 'document.R005')
    expect(a.c).toBeUndefined()
    expect(a.na!.detail).toBe('applies_if: TAXCUR is not reported')
    expect(claim(rs, { currency: 'EUR', tax_currency: 'SEK' }, 'document.R005').c!.outcome).toBe('PASS')
    expect(claim(rs, { currency: 'EUR', tax_currency: 'EUR' }, 'document.R005').c!.outcome).toBe('FAIL')
    expect(claim(rs, { currency: 'EUR', tax_currency: null }, 'document.R005').c!.insufficiency!.reason).toBe('UNPARSEABLE')
  })
  it('{ any_present }: an optional group applies when one of its fields is reported', () => {
    const g = RS([{ code: 'CITY', compare: 'identifier', left: 'CITY', op: '=', right: 'CITY', applies_if: [{ any_present: ['STREET', 'CITY'] }] }])
    expect(claim(g, {}, 'document.CITY').na!.detail).toBe('applies_if: none of STREET, CITY is reported')
    expect(claim(g, { street: 'Main St 1' }, 'document.CITY').c!.insufficiency!.reason).toBe('FIELD_MISSING')
    expect(claim(g, { street: 'Main St 1', city: 'Oslo' }, 'document.CITY').c!.outcome).toBe('PASS')
    expect(claim(g, { street: null }, 'document.CITY').c!.insufficiency!.reason).toBe('UNPARSEABLE')
  })
  it('a defaulted field is not reported', () => {
    const d = RS([{ code: 'T', left: 'TOTAL', op: '>=', right: '0', tol: 0, applies_if: [{ field: 'TOTAL', present: true }] }], { TOTAL: { paths: ['total'], default: 0 } })
    expect(claim(d, {}, 'document.T').na).toBeDefined()
    expect(claim(d, { total: 5 }, 'document.T').c!.outcome).toBe('PASS')
  })
})

describe('3. identifier checks with alternatives: one of several fields present', () => {
  const rs = RS([{ code: 'ANY', compare: 'identifier', left: 'A', op: '=', right: 'A', alternatives: [{ left: 'B', right: 'B' }, { left: 'C', right: 'C' }] }])
  it('the first form whose fields are reported decides; none reported abstains naming every form', () => {
    expect(claim(rs, { a: 'x' }, 'document.ANY').c!.outcome).toBe('PASS')
    const b = claim(rs, { c: 'z' }, 'document.ANY').c!
    expect(b.outcome).toBe('PASS')
    expect(b.explanation).toMatch(/Form 3 of 3/)
    const none = claim(rs, {}, 'document.ANY').c!
    expect(none.insufficiency).toMatchObject({ reason: 'FIELD_MISSING', missing: ['A', 'B', 'C'] })
    expect(none.insufficiency!.detail).toMatch(/form 1 lacks A; form 2 lacks B; form 3 lacks C/)
  })
  it('an unreadable field blocks only its own form; with no form left it abstains UNPARSEABLE', () => {
    expect(claim(rs, { a: null, b: 'y' }, 'document.ANY').c!.outcome).toBe('PASS')
    expect(claim(rs, { a: null }, 'document.ANY').c!.insufficiency!.reason).toBe('UNPARSEABLE')
  })
})

describe('4. lint', () => {
  it('accepts the forms and rejects malformed ones', () => {
    expect(lintRuleset(RS([{ code: 'CL', compare: 'member', left: 'CUR', op: '=', right: 'x', in: ['EUR'] }])).ok).toBe(true)
    const bad = (c: DeclarativeRuleset['checks'][number]) => lintRuleset(RS([c])).errors
    expect(bad({ code: 'CL', compare: 'member', left: 'TOTAL', op: '=', right: 'x', in: ['EUR'] })).toEqual(expect.arrayContaining([expect.stringMatching(/a member check must name an 'identifier' or 'string' field/)]))
    expect(bad({ code: 'CL', compare: 'member', left: 'CUR', op: '<=', right: 'x', in: ['EUR'] })).toEqual(expect.arrayContaining([expect.stringMatching(/only = and !=/)]))
    expect(bad({ code: 'CL', compare: 'member', left: 'CUR', op: '=', right: 'x', in: [] })).toEqual(expect.arrayContaining([expect.stringMatching(/"in" must be a non-empty array/)]))
    expect(bad({ code: 'X', left: 'TOTAL', op: '=', right: 'TOTAL', in: ['EUR'] })).toEqual(expect.arrayContaining([expect.stringMatching(/"in" belongs to a compare: "member" check/)]))
    expect(bad({ code: 'P', left: 'TOTAL', op: '=', right: 'TOTAL', applies_if: [{ field: 'NOPE', present: true }] })).toEqual(expect.arrayContaining([expect.stringMatching(/must name a field/)]))
    expect(bad({ code: 'P', left: 'TOTAL', op: '=', right: 'TOTAL', applies_if: [{ any_present: [] }] })).toEqual(expect.arrayContaining([expect.stringMatching(/"any_present" must be a non-empty array/)]))
    expect(bad({ code: 'P', left: 'TOTAL', op: '=', right: 'TOTAL', applies_if: [{ any_present: ['LINE_CODE'] }] })).toEqual(expect.arrayContaining([expect.stringMatching(/is a line field but the condition is document-scope/)]))
    expect(bad({ code: 'I', compare: 'identifier', left: 'A', op: '=', right: 'A', alternatives: [{ left: 'TOTAL', right: 'TOTAL' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/an identifier check must name an 'identifier' field \(got "TOTAL"\)/)]))
    expect(bad({ code: 'D', left: 'TOTAL', op: '=', right: 'TOTAL', narrowing: [''] })).toEqual(expect.arrayContaining([expect.stringMatching(/"narrowing" must be an array of non-empty strings/)]))
    expect(bad({ code: 'D', left: 'TOTAL', op: '=', right: 'TOTAL', source: { file: 'x.sch' } as never })).toEqual(expect.arrayContaining([expect.stringMatching(/"source" must be an object with file, sha256, line and assert_id/)]))
  })
})
