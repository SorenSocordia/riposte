/**
 * Byte identity for existing declarative rulesets. The hashes in fixtures/declarative-golden-hashes.json were produced by
 * the engine BEFORE the 2026-09-24 additions (rounding inference, optional `ROLE?` terms, abstain guards, check
 * alternatives). A ruleset that does not opt into them must produce exactly the same verdict JSON, lint result and
 * expression value as before. See fixtures/declarative-golden-cases.ts for the inputs.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify, verifyDeclarative, reconcile, lintRuleset, evalExpr } from '../src/index'
import { buildGoldenCases, hashOf, type GoldenApi } from './fixtures/declarative-golden-cases'
import { coreOf } from './fixtures/remedy-core'

const GOLDEN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'declarative-golden-hashes.json'), 'utf8')) as { cases: number; hashes: Record<string, string> }
// Engine 0.0.1 (2026-10-03): the golden guards the bytes of the engine it was frozen on. From engine 0.1.0 a ruleset that
// does not opt out reads strictly (absent vs unreadable, strict numbers); test/engine-defaults.test.ts measures what that moves.
type O = Record<string, unknown>
const E001 = { engine: '0.0.1' } as const
const api = {
  verify: (x: O, o: O) => verify(x, { ...o, ...E001 }),
  verifyDeclarative: (x: O, rs: never, o: O) => verifyDeclarative(x, rs, { ...o, ...E001 }),
  reconcile: (d: Record<string, O>, rs: never, o: O) => reconcile(d, rs, { ...o, ...E001 }),
  lintRuleset, evalExpr,
} as unknown as GoldenApi

describe('existing declarative rulesets are byte-identical to the pre-v0.2 engine', () => {
  const cases = buildGoldenCases()
  it('the case set is the one the golden was frozen on', () => {
    expect(cases.length).toBe(GOLDEN.cases)
    expect(cases.map(c => c.id).sort()).toEqual(Object.keys(GOLDEN.hashes).sort())
  })
  it(`all ${GOLDEN.cases} results hash exactly as before (real 10-K rows, every example ruleset, reconcile, lint, expressions)`, () => {
    // Compared on the core: typed remedies (2026-10-02) are additive and outside it (fixtures/remedy-core.ts). Not re-pinned.
    const mismatched = cases.filter(c => hashOf(coreOf(c.run(api))) !== GOLDEN.hashes[c.id]).map(c => c.id)
    expect(mismatched).toEqual([])
  })
})
