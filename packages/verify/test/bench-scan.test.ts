/**
 * The proposed export-scan check, stated as a tested reference (src/bench/marker.ts): a percentage or a k/n figure in an
 * exported page must sit inside a generated bench block. bare.md plants figures outside any block (every one is found);
 * blocked.md holds the same figures inside a block, plus ordinary text with dates, versions, paths and URLs (no hit).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blocksOf, findBareFigures, blockBegin, BLOCK_END } from '../src/bench/marker'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'bench-fixtures', 'scan')
const read = (f: string): string => readFileSync(join(FIX, f), 'utf8')

describe('bare figures outside generated blocks', () => {
  it('finds every planted figure in bare.md', () => {
    const hits = findBareFigures(read('bare.md'))
    expect(hits.map(h => h.figure)).toEqual(['17/20', '0.0%', '0.0%', '16.1%', '0 / 20', '60 %', '196/200'])
    expect(hits.map(h => h.line)).toEqual([3, 4, 4, 4, 4, 5, 6])
  })

  it('passes blocked.md: figures inside the block, ordinary numbers outside', () => {
    expect(findBareFigures(read('blocked.md'))).toEqual([])
    expect(blocksOf(read('blocked.md'))).toMatchObject({ problems: [], blocks: [{ kind: 'table', id: 'x1-einvoice-pdf', from: 6, to: 11 }] })
  })

  it('an allowance covers one file and one line context, nothing else', () => {
    const allow = [{ file: /^packages\/verify\/docs\/bare\.md$/, line: /Coverage on the noisy third/, why: 'a worked example' }]
    expect(findBareFigures(read('bare.md'), 'packages/verify/docs/bare.md', allow)).toHaveLength(6)
    expect(findBareFigures(read('bare.md'), 'packages/verify/docs/other.md', allow)).toHaveLength(7)
  })

  it('names malformed fencing: an unclosed block, a nested one, an end with nothing open', () => {
    const sha = '0'.repeat(64)
    const text = [blockBegin('table', 'a', sha), '1/2', blockBegin('table', 'b', sha), BLOCK_END, BLOCK_END, blockBegin('ledger', 'misses', sha), '<!-- bench:begin table=bad -->'].join('\n')
    expect(blocksOf(text).problems.map(p => p.problem)).toEqual([
      'a block opens inside the block opened at line 1', 'a block end with no block open', 'a malformed block marker', 'a block is never closed',
    ])
  })
})
