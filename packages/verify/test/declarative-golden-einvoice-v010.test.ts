/**
 * The second byte-identity golden (E-INVOICE-2, 2026-09-28): the e-invoice rulesets at 0.1.0, pinned to their bytes.
 * It runs ALONGSIDE declarative-golden.test.ts (which pins the 0.0.1 bytes and guards engine identity); neither
 * replaces the other. The hashes were produced once, before any E-INVOICE-2 engine change, so every later engine
 * addition must leave them byte-identical. See fixtures/declarative-golden-einvoice-v010-cases.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { verifyDeclarative, lintRuleset } from '../src/index'
import { buildGoldenCasesV010, hashOfV010, V010_FILES, V010_SHA256, type GoldenApiV010 } from './fixtures/declarative-golden-einvoice-v010-cases'
import { coreOf } from './fixtures/remedy-core'

const GOLDEN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'declarative-golden-einvoice-v010-hashes.json'), 'utf8')) as { cases: number; hashes: Record<string, string> }
// Engine 0.0.1 (2026-10-03): the bytes this golden was frozen on; see test/declarative-golden.test.ts.
const api = {
  verifyDeclarative: (x: Record<string, unknown>, rs: never, o: Record<string, unknown>) => verifyDeclarative(x, rs, { ...o, engine: '0.0.1' }),
  lintRuleset,
} as unknown as GoldenApiV010

describe('the e-invoice rulesets at 0.1.0 are byte-identical to the frozen golden (second golden)', () => {
  const cases = buildGoldenCasesV010()
  it('the pinned inputs are the 0.1.0 bytes', () => {
    for (const [k, f] of Object.entries(V010_FILES)) expect(createHash('sha256').update(readFileSync(f)).digest('hex'), k).toBe(V010_SHA256[k as keyof typeof V010_SHA256])
  })
  it('the case set is the one the golden was frozen on', () => {
    expect(cases.length).toBe(GOLDEN.cases)
    expect(cases.map(c => c.id).sort()).toEqual(Object.keys(GOLDEN.hashes).sort())
  })
  it(`all ${GOLDEN.cases} results hash exactly as frozen (synthetic, the constructed corrections set, lint)`, () => {
    // Compared on the core: typed remedies (2026-10-02) are additive and outside it (fixtures/remedy-core.ts). Not re-pinned.
    const mismatched = cases.filter(c => hashOfV010(coreOf(c.run(api))) !== GOLDEN.hashes[c.id]).map(c => c.id)
    expect(mismatched).toEqual([])
  })
})
