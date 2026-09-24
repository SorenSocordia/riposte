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

const GOLDEN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'declarative-golden-hashes.json'), 'utf8')) as { cases: number; hashes: Record<string, string> }
const api = { verify, verifyDeclarative, reconcile, lintRuleset, evalExpr } as unknown as GoldenApi

describe('existing declarative rulesets are byte-identical to the pre-v0.2 engine', () => {
  const cases = buildGoldenCases()
  it('the case set is the one the golden was frozen on', () => {
    expect(cases.length).toBe(GOLDEN.cases)
    expect(cases.map(c => c.id).sort()).toEqual(Object.keys(GOLDEN.hashes).sort())
  })
  it(`all ${GOLDEN.cases} results hash exactly as before (real 10-K rows, every example ruleset, reconcile, lint, expressions)`, () => {
    const mismatched = cases.filter(c => hashOf(c.run(api)) !== GOLDEN.hashes[c.id]).map(c => c.id)
    expect(mismatched).toEqual([])
  })
})
