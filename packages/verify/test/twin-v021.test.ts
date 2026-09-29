/**
 * Twin v0.2.1 (TWIN-V021): scope-variant concept families, the cash roll as the tie-break between disagreeing face lines,
 * the exact anchored SCALE check, and the strict presentation reading. SYNTHETIC inline-XBRL, presentation linkbases and
 * FilingSummaries only. CREDENCE-2's published misses are reproduced in miniature (Lodging Fund: the printed ending-cash
 * line is the …IncludingDisposalGroup… concept; Kinetic Seas: a ×1000 error on a value v0.2 routes to NOT_ON_STATEMENT;
 * Outdoor Holding: a self-closing presentationLink hides the next statement), and v0.2 is shown unchanged.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  parseTwinPresentation, verifyAgainstTwin, bindTwinFields, twinVerdictInput, twinFieldConcepts,
  FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021, SCOPE_VARIANT_SUFFIXES,
  type TwinJudgment, type TwinClaim,
} from '../src/twin/index'
import { verifyReplay } from '../src/protocol/replay'
import { doc, nf, link, linkbase, FS, CCERC, INCL, CHANGE, DG_CASH, OPTS, LODGING, LODGING_PRE, TAX2025, TAX2025_PRE, KINETIC, KINETIC_PRE } from './fixtures/twin-v021'

const strict = (pre: string, fs = FS) => parseTwinPresentation({ pre, filingSummary: fs }, { links: 'strict' })!
const legacy = (pre: string, fs = FS) => parseTwinPresentation({ pre, filingSummary: fs })!
const judge = (html: string, pre: string, field: string, value: number, v: '0.2' | '0.2.1' = '0.2.1'): TwinJudgment =>
  verifyAgainstTwin(html, [{ id: field, field, value }], v === '0.2.1' ? { ...OPTS, map: FS_CORE_TWIN_MAP_V021, presentation: strict(pre) } : { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: legacy(pre) }).judgments[0]!

describe('the v0.2.1 map', () => {
  it('is v0.2 plus scope variants, the roll, anchored scale and the strict reading; v0.2 and v0.1 are untouched', () => {
    expect(FS_CORE_TWIN_MAP_V021).toMatchObject({ id: 'twin-xbrl-fs-core', version: '0.2.1', binding: 'statement', matching: 'decimals', family: 'scope-variants', scale: 'anchored', links: 'strict' })
    expect(FS_CORE_TWIN_MAP_V021.fields.map((f) => [f.field, f.concepts, f.period, f.cell])).toEqual(FS_CORE_TWIN_MAP.fields.map((f) => [f.field, f.concepts, f.period, f.cell]))
    expect(FS_CORE_TWIN_MAP_V021.fields.filter((f) => f.roll).map((f) => [f.field, f.roll])).toEqual([['ending_cash', { position: 'end', change: 'net_change_in_cash' }], ['beginning_cash', { position: 'start', change: 'net_change_in_cash' }]])
    expect(FS_CORE_TWIN_MAP_V02).not.toHaveProperty('family')
    expect(FS_CORE_TWIN_MAP_V02).not.toHaveProperty('links')
    expect(FS_CORE_TWIN_MAP_V02.fields).toBe(FS_CORE_TWIN_MAP.fields)
  })
  it('a field\'s family is its listed concepts, then each one\'s scope variants (a naming rule, not a hand list)', () => {
    const ending = FS_CORE_TWIN_MAP_V021.fields.find((f) => f.field === 'ending_cash')!
    expect(twinFieldConcepts(FS_CORE_TWIN_MAP_V021, ending)).toEqual([CCERC, INCL, `${CCERC}IncludingDiscontinuedOperations`])
    expect(twinFieldConcepts(FS_CORE_TWIN_MAP_V02, ending)).toBe(ending.concepts)
    expect(SCOPE_VARIANT_SUFFIXES).toEqual(['IncludingDisposalGroupAndDiscontinuedOperations', 'IncludingDiscontinuedOperations'])
    // components (the disposal group's own share) and subset variants are not in any family
    const all = FS_CORE_TWIN_MAP_V021.fields.flatMap((f) => twinFieldConcepts(FS_CORE_TWIN_MAP_V021, f))
    expect(all.filter((c) => /DisposalGroupIncludingDiscontinuedOperation|ContinuingOperations$/.test(c) && !/Including(DisposalGroupAnd)?DiscontinuedOperations$/.test(c))).toEqual([])
  })
})

describe('strict presentation reading (the Outdoor Holding class)', () => {
  // an EMPTY, self-closing parenthetical link right before the statement of operations
  const PRE = linkbase([link('BalanceSheets', ['Assets']),
    '<link:presentationLink xlink:type="extended" xlink:role="http://x.example.com/role/OperationsParenthetical"/>',
    link('Operations', ['NetIncomeLoss', 'OperatingIncomeLoss']), link('CashDetails', ['CashAndCashEquivalentsAtCarryingValue'])])
  it('the v0.2 reading (default, frozen) lets the empty link swallow the next statement', () => {
    const p = legacy(PRE)
    expect(p.statementRoles).not.toContain('http://x.example.com/role/Operations')
    expect(p.statementConcepts).toEqual(['Assets'])
    expect(p).not.toHaveProperty('links')
  })
  it('the strict reading reads the empty link as a role with no concepts, and the statement after it', () => {
    const p = strict(PRE)
    expect(p.statementRoles).toEqual(['http://x.example.com/role/BalanceSheets', 'http://x.example.com/role/Operations'])
    expect(p.statementConcepts).toEqual(['Assets', 'NetIncomeLoss', 'OperatingIncomeLoss'])
    expect(p.roles.find((r) => r.role.endsWith('OperationsParenthetical'))).toMatchObject({ concepts: 0, parenthetical: true, statement: false })
    expect(p.links).toBe('strict')
    expect(p.sha256).not.toBe(legacy(PRE).sha256) // the reading enters the identity
  })
  it('both readings agree on a linkbase without self-closing links (only the identity differs)', () => {
    const a = legacy(LODGING_PRE), b = strict(LODGING_PRE)
    expect({ ...b, sha256: a.sha256, links: undefined }).toEqual({ ...a, links: undefined })
  })
  it('v0.2.1 refuses a v0.2 reading: every claim ABSTAINs, nothing binds', () => {
    const j = verifyAgainstTwin(LODGING, [{ id: 'e', field: 'ending_cash', value: 10_361_842 }], { ...OPTS, map: FS_CORE_TWIN_MAP_V021, presentation: legacy(LODGING_PRE) }).judgments[0]!
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'NO_PRESENTATION_LINKBASE' })
    expect(j.detail).toMatch(/strict reading/)
    expect(bindTwinFields(LODGING, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V021, presentation: legacy(LODGING_PRE) }).every((b) => !b.bound && b.reason === 'NO_PRESENTATION_LINKBASE')).toBe(true)
  })
})

describe('scope variants: the concept actually on the face statement\'s line binds', () => {
  it('a 2025-taxonomy cash roll (variant endpoints, plain concept only in a note): v0.2 abstains, v0.2.1 binds the printed line', () => {
    expect(judge(TAX2025, TAX2025_PRE, 'ending_cash', 80_000_000, '0.2')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(judge(TAX2025, TAX2025_PRE, 'ending_cash', 80_000_000)).toMatchObject({ outcome: 'PASS', reason: 'MATCH', binding: { concept: INCL, value: 80_000_000 } })
    expect(judge(TAX2025, TAX2025_PRE, 'beginning_cash', 70_000_000)).toMatchObject({ outcome: 'PASS', binding: { concept: INCL, period: '2023-12-31' } })
    expect(judge(TAX2025, TAX2025_PRE, 'ending_cash', 79_000_000)).toMatchObject({ outcome: 'FAIL' }) // the note's continuing figure is not the printed line
    expect(judge(TAX2025, TAX2025_PRE, 'ending_cash', 70_000_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'PERIOD' }) // the prior-year column
    expect(judge(TAX2025, TAX2025_PRE, 'ending_cash', 80_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SCALE' })
  })
  it('a listed concept on the face still outranks its variant for a field with no roll (v0.2\'s choice kept)', () => {
    const html = doc([`<td>Cash</td>${nf('CashAndCashEquivalentsAtCarryingValue', 'I24', '500')}`, `<td>Cash incl. discontinued</td>${nf('CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations', 'I24', '520')}`])
    const pre = linkbase([link('BalanceSheets', ['CashAndCashEquivalentsAtCarryingValue']), link('CashFlows', ['CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations'])])
    expect(judge(html, pre, 'cash', 500)).toMatchObject({ outcome: 'PASS', binding: { concept: 'CashAndCashEquivalentsAtCarryingValue' } })
    expect(judge(html, pre, 'cash', 520)).toMatchObject({ outcome: 'FAIL' })
    const only = linkbase([link('BalanceSheets', ['CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations'])])
    expect(judge(html, only, 'cash', 520)).toMatchObject({ outcome: 'PASS', binding: { concept: 'CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations' } })
  })
})

describe('the cash roll decides between disagreeing face lines (the Lodging Fund class)', () => {
  it('v0.2 FAILed the printed line; v0.2.1 binds the line that closes beginning + change = end', () => {
    expect(judge(LODGING, LODGING_PRE, 'ending_cash', 10_361_842, '0.2')).toMatchObject({ outcome: 'FAIL', binding: { concept: CCERC, value: 10_340_792 } })
    const j = judge(LODGING, LODGING_PRE, 'ending_cash', 10_361_842)
    expect(j).toMatchObject({ outcome: 'PASS', reason: 'MATCH', binding: { concept: INCL, value: 10_361_842, duplicates: 2 } })
  })
  it('the other face line (the continuing total in the reconciliation) is ABSTAIN AMBIGUOUS_LINE, never a FAIL or a PASS', () => {
    const j = judge(LODGING, LODGING_PRE, 'ending_cash', 10_340_792)
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_LINE', binding: { concept: INCL } })
    expect(j.candidates!.map((c) => [c.concept, c.value])).toEqual([[CCERC, 10_340_792]])
  })
  it('a value that is neither line still FAILs, with its diagnosis', () => {
    expect(judge(LODGING, LODGING_PRE, 'ending_cash', 12_944_329)).toMatchObject({ outcome: 'FAIL', diagnosis: 'PERIOD' })
    expect(judge(LODGING, LODGING_PRE, 'ending_cash', 10_000_000)).toMatchObject({ outcome: 'FAIL', diagnosis: 'UNLOCATED' })
  })
  it('equal family lines are no conflict: the listed concept binds, as in v0.2 (beginning cash)', () => {
    expect(judge(LODGING, LODGING_PRE, 'beginning_cash', 12_944_329)).toMatchObject({ outcome: 'PASS', binding: { concept: CCERC } })
    expect(judge(LODGING, LODGING_PRE, 'beginning_cash', 12_944_329, '0.2')).toMatchObject({ outcome: 'PASS', binding: { concept: CCERC } })
  })
  it('when the roll cannot decide (no net change on the face) the field ABSTAINs AMBIGUOUS_LINE on both lines', () => {
    const pre = linkbase([link('BalanceSheets', ['Assets']), link('CashFlows', [CCERC, INCL, DG_CASH])])
    for (const v of [10_361_842, 10_340_792]) expect(judge(LODGING, pre, 'ending_cash', v)).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_LINE' })
    const j = judge(LODGING, pre, 'ending_cash', 1)
    expect(j).toMatchObject({ outcome: 'ABSTAIN', reason: 'AMBIGUOUS_LINE' }) // not decidable, so not a FAIL
    expect(j.detail).toMatch(/net change \(net_change_in_cash\) does not bind/)
    expect(j.candidates!.map((c) => c.value)).toEqual([10_340_792, 10_361_842])
    const by = Object.fromEntries(bindTwinFields(LODGING, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V021, presentation: strict(pre) }).map((b) => [b.field, b]))
    expect(by.ending_cash).toMatchObject({ bound: false, reason: 'AMBIGUOUS_LINE' })
  })
  it('an exact power-of-ten error of either undecided line is still a SCALE FAIL (both lines are anchored)', () => {
    const pre = linkbase([link('BalanceSheets', ['Assets']), link('CashFlows', [CCERC, INCL, DG_CASH])])
    const j = judge(LODGING, pre, 'ending_cash', 10_361_842_000)
    expect(j).toMatchObject({ outcome: 'FAIL', reason: 'MISMATCH', diagnosis: 'SCALE', binding: { concept: INCL, value: 10_361_842 } })
    expect(j.candidates).toHaveLength(2)
  })
  it('bindTwinFields reports the roll\'s pick and the alternatives it passed over', () => {
    const by = Object.fromEntries(bindTwinFields(LODGING, { periodEnd: '2024-12-31', map: FS_CORE_TWIN_MAP_V021, presentation: strict(LODGING_PRE) }).map((b) => [b.field, b]))
    expect(by.ending_cash).toMatchObject({ bound: true, binding: { concept: INCL, value: 10_361_842 }, alternatives: [{ concept: CCERC, value: 10_340_792 }] })
    expect(by.net_change_in_cash).toMatchObject({ bound: true, binding: { concept: CHANGE, value: -2_582_487 } })
  })
})

describe('anchored SCALE (the Kinetic Seas class)', () => {
  it('v0.2 routes a ×1000 error to NOT_ON_STATEMENT; v0.2.1 FAILs it (SCALE) because the value is anchored', () => {
    expect(judge(KINETIC, KINETIC_PRE, 'cash', 4_947_000, '0.2')).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    const j = judge(KINETIC, KINETIC_PRE, 'cash', 4_947_000)
    expect(j).toMatchObject({ outcome: 'FAIL', reason: 'MISMATCH', diagnosis: 'SCALE', binding: { concept: 'CashAndCashEquivalentsAtCarryingValue', value: 4947 }, anchor: { concept: 'Cash', value: 4947 } })
    expect(j.detail).toMatch(/exactly 10\^3 × 4947.*value-anchored/)
    expect(judge(KINETIC, KINETIC_PRE, 'cash', 4.947)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SCALE' }) // ÷1000
  })
  it('the anchored value itself stays ABSTAIN (NOT_ON_STATEMENT): an unanchored-concept PASS is not evidence', () => {
    expect(judge(KINETIC, KINETIC_PRE, 'cash', 4_947)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
  })
  it('only an EXACT power of ten counts: a near miss is not a SCALE error', () => {
    expect(judge(KINETIC, KINETIC_PRE, 'cash', 4_951_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(judge(KINETIC, KINETIC_PRE, 'cash', 494_700)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' }) // ×100 is not a scale step
  })
  it('never applied to a value that is not anchored: the note\'s figure is printed nowhere on the face', () => {
    expect(judge(KINETIC, KINETIC_PRE, 'operating_expenses', 7_121_627_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(judge(KINETIC, KINETIC_PRE, 'operating_expenses', 105_109_040)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
  })
  it('accounts for the filing\'s scale and decimals: digits printed in thousands, reported without the multiplier', () => {
    const html = doc([`<td>Cash</td>${nf('Cash', 'I24', '4,947', { scale: '3', decimals: '-3' })}`, `<td>Cash (note)</td>${nf('CashAndCashEquivalentsAtCarryingValue', 'I24', '4,947,213')}`])
    expect(judge(html, KINETIC_PRE, 'cash', 4_947)).toMatchObject({ outcome: 'FAIL', diagnosis: 'SCALE', anchor: { concept: 'Cash', value: 4_947_000, decimals: -3 } })
    expect(judge(html, KINETIC_PRE, 'cash', 4_947_213)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' })
    expect(judge(html, KINETIC_PRE, 'cash', 4_947_000)).toMatchObject({ outcome: 'ABSTAIN', reason: 'NOT_ON_STATEMENT' }) // the face figure itself
  })
  it('the SCALE FAIL carries both facts as evidence', () => {
    const r = verifyAgainstTwin(KINETIC, [{ id: 'c', field: 'cash', value: 4_947_000 }], { ...OPTS, map: FS_CORE_TWIN_MAP_V021, presentation: strict(KINETIC_PRE) })
    const ev = r.verdict.claims[0]!.evidence
    expect(ev.map((e) => e.role)).toEqual(['REFERENCE', 'CONTEXT', 'CONTEXT'])
    expect(ev[0]!.normalizations).toContain('twin:value-anchored')
    const span = ev[2]!.locator as { kind: 'span'; start: number; end: number }
    expect(KINETIC.slice(span.start, span.end)).toContain('name="us-gaap:Cash"')
    expect(r.verdict.outcome).toBe('FAIL')
  })
})

describe('v0.2.1 verdicts', () => {
  const claims: TwinClaim[] = [{ id: 'e', field: 'ending_cash', value: 10_361_842 }, { id: 'x', field: 'ending_cash', value: 10_340_792 }]
  const opts = { ...OPTS, map: FS_CORE_TWIN_MAP_V021, presentation: strict(LODGING_PRE) }
  const r = verifyAgainstTwin(LODGING, claims, opts)
  it('names ruleset twin-xbrl-fs-core@0.2.1, reports the strict reading, and maps AMBIGUOUS_LINE to AMBIGUOUS_REFERENCE', () => {
    expect(r.verdict.ruleset).toEqual({ id: 'twin-xbrl-fs-core', version: '0.2.1', domain: 'financial-statements' })
    expect(r.twin.presentation).toMatchObject({ links: 'strict', statement_roles: 2 })
    expect(r.verdict.claims[1]!.insufficiency).toMatchObject({ reason: 'AMBIGUOUS_REFERENCE' })
    expect(r.verdict.claims[1]!.insufficiency!.detail).toMatch(/^AMBIGUOUS_LINE: /)
    expect(r.verdict.outcome).toBe('PASS')
  })
  it('is deterministic and replayable, and differs from v0.2\'s verdict_id', () => {
    expect(JSON.stringify(verifyAgainstTwin(LODGING, claims, opts))).toBe(JSON.stringify(r))
    expect(verifyReplay(r.verdict, twinVerdictInput(r.twin.sha256, claims, opts))).toMatchObject({ ok: true, id_ok: true, input_ok: true })
    const v2 = verifyAgainstTwin(LODGING, claims, { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: legacy(LODGING_PRE) })
    expect(v2.verdict.verdict_id).not.toBe(r.verdict.verdict_id)
    expect(v2.twin.presentation).not.toHaveProperty('links')
  })
})

describe('v0.1 and v0.2 stay frozen on these documents (hash pins, captured at v0.2.1\'s introduction)', () => {
  // The real-data identity (CREDENCE-1: 400 v0.1 results / 7,706 rows; CREDENCE-2: 96 v0.2 results / 1,915 rows, byte for
  // byte) is proven by the TWIN-V021 identity replay (2026-09-28); these pins guard the synthetic path.
  const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)
  const all = (html: string, pre: string, v: '0.1' | '0.2') => verifyAgainstTwin(html, FS_CORE_TWIN_MAP.fields.map((f, i) => ({ id: f.field, field: f.field, value: 1000 * (i + 1) })).concat([
    { id: 'e1', field: 'ending_cash', value: 10_361_842 }, { id: 'e2', field: 'ending_cash', value: 10_340_792 }, { id: 'c1', field: 'cash', value: 4_947_000 }, { id: 'c2', field: 'ending_cash', value: 80_000_000 }]),
  v === '0.2' ? { ...OPTS, map: FS_CORE_TWIN_MAP_V02, presentation: legacy(pre) } : OPTS)
  it('v0.2 and v0.1 results', () => {
    expect([sha(all(LODGING, LODGING_PRE, '0.2')), sha(all(TAX2025, TAX2025_PRE, '0.2')), sha(all(KINETIC, KINETIC_PRE, '0.2'))]).toMatchInlineSnapshot(`
      [
        "519471ea440b1f82",
        "e94fd4db06ee38ec",
        "72b9619f1f0cdd2d",
      ]
    `)
    expect([sha(all(LODGING, LODGING_PRE, '0.1')), sha(all(TAX2025, TAX2025_PRE, '0.1')), sha(all(KINETIC, KINETIC_PRE, '0.1'))]).toMatchInlineSnapshot(`
      [
        "ae2f4d0c99ccd186",
        "e83c323e3bcedc4b",
        "649f4bb6464f9dd5",
      ]
    `)
  })
})
