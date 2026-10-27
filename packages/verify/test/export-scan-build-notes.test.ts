/**
 * The export scan's rule for build notes (riposte-export-scan.mjs, BUILD_BRANCH, BUILD_WORDS, BARE_HASH): in Markdown and in
 * code comments it refuses branch names of the private build, three process words and bare commit hashes, and it keeps the
 * hashes a reader needs (a sha256, an outside source's pinned commit) and the files whose purpose is to carry hashes. The
 * refused forms below are assembled from parts, so this file stays clean under the vocabulary guard that reads it.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'riposte-export-scan.mjs')
type Scan = { scanFile: (rel: string, buf: Buffer) => string[] }
const load = async (): Promise<Scan> => await import(pathToFileURL(SCAN).href) as Scan
const scan = async (rel: string, text: string): Promise<string[]> => (await load()).scanFile(rel, Buffer.from(text))

const g = ['gra', 'ft'].join('')
const branchSlash = `This sheet stacks on \`${g}/interchange\`.`
const branchDash = `See the ${g}-engine-py branch.`
const session = `Written by the ${['build', 'session'].join(' ')} before the code.`
const mid = `The first transcription, at the ${['mid', 'point'].join('')}, used two kinds.`
const answer = `As the ${['maintainer', "'s answer"].join('')} of 2026-10-12 says.`
const answerCurly = `As the ${['maintainer', '’s answers'].join('')} say.`
const short = ['14fc', '0f7'].join('')
const long = ['14fc0f70101898e9', '59f5e5ad2e0b1ef7e2fcc976'].join('')
const cutShort = `It was cut from main at \`${short}\`.`
const cutLong = `Merged at \`${long}\` with no fast-forward.`
const sha256 = 'c975c4b620e81d029badcdb7a22c487422f5ca530b4eb30e49199ac80871fef8'
const repo = ['Soren', 'Socordia'].join('')
const DOC = 'docs/x.md'

describe.skipIf(!existsSync(SCAN))('the scan rule for build notes: what it refuses, and what it keeps', () => {
  it('refuses each form in a Markdown file', async () => {
    for (const line of [branchSlash, branchDash, session, mid, answer, answerCurly, cutShort, cutLong]) {
      expect(await scan(DOC, line), line).toHaveLength(1)
    }
    expect((await scan(DOC, cutShort))[0]).toContain('(a build note)')
  })

  it('in code, reads only the comments', async () => {
    expect(await scan('packages/x/src/a.ts', `// ${branchSlash}`)).toHaveLength(1)
    expect(await scan('packages/x/src/a.ts', ` * ${session}`)).toHaveLength(1)
    expect(await scan('packages/x/src/a.mjs', `const n = 1 // ${cutShort}`)).toHaveLength(1)
    expect(await scan('packages/x/python/a.py', `# ${mid}`)).toHaveLength(1)
    expect(await scan('packages/x/src/a.ts', `const file = 'test/a-${g}-branch.test.ts'`)).toEqual([])
    expect(await scan('packages/x/src/a.ts', `const word = '${['mid', 'point'].join('')}'`)).toEqual([])
    expect(await scan('packages/x/python/a.py', `x = "${short}"`)).toEqual([])
    expect(await scan('packages/x/data.yml', `# ${branchSlash}`)).toEqual([]) // not a prose file
  })

  it('does not take a sha256, a prefix with an ellipsis, a key type, a number or a word for a commit hash', async () => {
    for (const line of [`sha256 \`${sha256}\``, 'pin `d24a1597…` holds', 'an ed25519 key', '`6.125e3` and `612500e-2`', 'invoice 1234567',
      'the page was defaced', 'order ABC1234']) {
      expect(await scan(DOC, line), line).toEqual([])
    }
  })

  it('keeps a hash on a line that pins an outside source, and refuses it on a link to this repository', async () => {
    expect(await scan(DOC, `| [owner/tool](https://github.com/owner/tool) | \`${long}\` | MIT |`)).toEqual([])
    expect(await scan(DOC, `- uses: actions/checkout@${long} # v6.1.0`)).toEqual([])
    expect(await scan(DOC, `OpenAPPA v0.31.1 (commit \`${short}\`), the released binary`)).toEqual([])
    expect(await scan(DOC, `the docs at tag v2.0.0, commit \`${long}\``)).toEqual([])
    expect(await scan(DOC, `https://github.com/${repo}/riposte/commit/${long}`)).toHaveLength(1)
  })

  it('does not check hashes in files that carry them, but still reads their words', async () => {
    for (const rel of ['docs/sources/SOURCES.md', 'examples/x/SOURCE.md', 'packages/x/test/fixtures/a.md', 'whetstone/HELDOUT.md']) {
      expect(await scan(rel, cutLong), rel).toEqual([])
    }
    expect(await scan('examples/x/SOURCE.md', session)).toHaveLength(1)
  })

  it('does not read frozen preregistrations', async () => {
    expect(await scan('bench/sec/PREREG-SEC-MINE.md', `The reported c is its ${['mid', 'point'].join('')}.`)).toEqual([])
    expect(await scan('packages/verify/docs/bench/x1/PREREG.md', `ETag "${['a91', '6684'].join('')}-54bb9989f2076"; ${cutShort}`)).toEqual([])
  })

  it('excuses the pinned lines in their own words only', async () => {
    const m = ['mid', 'point'].join('')
    expect(await scan('packages/verify/src/mine/threshold.ts', ` * c is the ${m} between the two adjacent observed values. Any c in that gap gives the same partition, and the gap`)).toEqual([])
    expect(await scan('packages/verify/src/mine/threshold.ts', ` * c is the ${m} of the run.`)).toHaveLength(1)
    expect(await scan('packages/verify/docs/RULESETS.md', 'Peppol schematrons at commit `261c458` (sha256 in the ruleset\'s `sources`).')).toEqual([])
    expect(await scan('packages/verify/docs/RULESETS.md', 'Our schematrons at commit `261c458`.')).toHaveLength(1)
  })
})
