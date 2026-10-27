/**
 * Why the earned-autonomy book was re-pinned on 2026-10-02, proven rather than asserted. The demo records verdicts on its
 * book, and a non-PASS verdict now carries typed remedies (src/verdict/remedy.ts), so the book's bytes moved. With remedies
 * switched OFF (the one function that attaches them made a no-op, here only), the demo must produce the book pinned BEFORE
 * remedies existed, byte for byte: same head, same sha256. So remedies are the only thing that moved it.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/verdict/remedy', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/verdict/remedy')>()
  return { ...real, attachRemedies: <V>(v: V): V => v }
})

import { runDemo } from '../examples/earned-autonomy/demo'

/** The pins of test/e2e-earned-autonomy.test.ts before typed remedies (2026-09-29 → 2026-10-02). */
const PRE_REMEDY_BOOK_SHA256 = 'd227a3bbc863dbf699afca439fea642e8ba04bfa84b740e40beadb7fadb17dd3'
const PRE_REMEDY_HEAD = '0e91336fdfa56e1e142a7aa2fbc44abd145640c8257758cb5610ba320c9dd180'

describe('the earned-autonomy book, with remedies switched off', () => {
  it('is byte for byte the book pinned before remedies existed', () => {
    // Engine 0.0.1: the engine these pins were taken under (2026-10-03, moved the engine to 0.1.0).
    const r = runDemo({ log: () => {}, documents: true, engine: '0.0.1' })
    expect(r.replay).toEqual({ reperformed_from_fixture: 436, reperformed_from_filing: 15, total: 436 })
    expect(r.chain).toEqual({ ok: true, length: 754, head: PRE_REMEDY_HEAD, book_sha256: PRE_REMEDY_BOOK_SHA256 })
  })
})
