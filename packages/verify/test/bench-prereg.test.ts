/**
 * The prereg chain (src/bench/prereg.ts): every recording format runs use, and the three refusals. Fixtures are written to
 * a temporary folder; nothing outside this package is read.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { verifyPrereg, parseChainText, BenchRefused } from '../src/bench/prereg'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'bench-prereg-')); dirs.push(d); return d }
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const refusal = (f: () => unknown): string => { try { f(); return 'no refusal' } catch (e) { return e instanceof BenchRefused ? e.code : `other: ${(e as Error).message}` } }

describe('reading the chain the way runs record it', () => {
  it('a plain sidecar: one hash, the frozen one', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'bars\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('bars\n')} *PREREG.md\n`)
    const r = verifyPrereg('PREREG.md', { cwd: d })
    expect(r).toEqual({ path: 'PREREG.md', sha256: sha('bars\n'), frozen_sha256: sha('bars\n'), amendments: [] })
  })

  it('comments, other files, superseded first hash and "hashed <time>" lines', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'v2\n')
    writeFileSync(join(d, 'PREREG.sha256'), [
      '# first hash (superseded before any engine call)', `${sha('v1\n')} *PREREG.md`, `${sha('m')} *items/MANIFEST.json`, 'hashed 2026-10-03T10:49:49Z',
      "# second hash (the run's)", `${sha('v2\n')} *PREREG.md`, `${sha('h')} *harness/run.mjs`, 'hashed 2026-10-03T10:50:31Z', '',
    ].join('\n'))
    const r = verifyPrereg('PREREG.md', { cwd: d })
    expect(r.frozen_sha256).toBe(sha('v1\n'))
    expect(r.amendments).toEqual([{ sha256: sha('v2\n'), recorded_in: 'PREREG.sha256', at: '2026-10-03T10:50:31Z', note: "second hash (the run's)" }])
  })

  it('amendment rows with a hash and a time but no file name, and a bare timestamp line', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'a2\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('f\n')}  PREREG.md\n2026-10-04T03:40:51Z\namendment1  ${sha('a1\n')}  2026-10-04T03:48:50Z\namendment2  ${sha('a2\n')}  2026-10-04T03:53:56Z\n`)
    const r = verifyPrereg('PREREG.md', { cwd: d })
    expect(r.frozen_sha256).toBe(sha('f\n'))
    expect(r.amendments.map(a => [a.note, a.at])).toEqual([['amendment1', '2026-10-04T03:48:50Z'], ['amendment2', '2026-10-04T03:53:56Z']])
  })

  it('a trailing comment closes the last record; a record repeated under two path spellings is one', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'x\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('x\n')} *PREREG.md\n${sha('x\n')} *work/run/PREREG.md\n# frozen 2026-10-04T05:31:05Z, before any edit\n`)
    const r = verifyPrereg('PREREG.md', { cwd: d })
    expect(r.amendments).toEqual([])
    const recs = parseChainText(`${sha('x\n')} *PREREG.md\n# frozen 2026-10-04T05:31:05Z, before any edit\n`, { source: 's', dir: d, sidecar: true })
    expect(recs[0]).toMatchObject({ note: 'frozen 2026-10-04T05:31:05Z, before any edit', at: '2026-10-04T05:31:05Z' })
  })

  it('a hash list naming frozen snapshots, read for the documents the run names', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG-v0.frozen.md'), 'v0\n')
    writeFileSync(join(d, 'PREREG-final.frozen.md'), 'final\n')
    writeFileSync(join(d, 'PREREG.md'), 'final\n')
    writeFileSync(join(d, 'HASHES.txt'), [
      `v0  2026-10-03T06:19:45Z  sha256 ${sha('v0\n')}  PREREG-v0.frozen.md  (before any trace parsed)`,
      `A   2026-10-03T06:54:39Z  sha256 ${sha('final\n')}  PREREG-final.frozen.md  (v0 + Amendment A)`,
      `data  sha256 ${sha('data')}  md5 0123456789abcdef0123456789abcdef  data.xes`,
      `verify-snapshot  tree ${sha('tree')}  (engine 0.0.1)`, '',
    ].join('\n'))
    const r = verifyPrereg('PREREG.md', { cwd: d, chains: ['HASHES.txt'], docs: ['PREREG-v0.frozen.md', 'PREREG-final.frozen.md'] })
    expect(r.frozen_sha256).toBe(sha('v0\n'))
    expect(r.amendments).toEqual([{ sha256: sha('final\n'), recorded_in: 'HASHES.txt', doc: 'PREREG-final.frozen.md', at: '2026-10-03T06:54:39Z', note: 'A (v0 + Amendment A)' }])
  })

  it('a hash written on a line of the prereg, then a run output\'s prereg_sha256', () => {
    const d = tmp()
    const frozen = 'claims\n'
    const amended = `claims\n## amendment\nfrozen-at-writing sha256 of this file was\n  ${sha(frozen)}.\n`
    writeFileSync(join(d, 'PREREG.md'), amended)
    mkdirSync(join(d, 'scratch'))
    writeFileSync(join(d, 'scratch', 'result.json'), JSON.stringify({ prereg_sha256: sha(amended), other: sha('z') }))
    const r = verifyPrereg('PREREG.md', { cwd: d, chains: ['PREREG.md:4', 'scratch/result.json#prereg_sha256'] })
    expect(r.frozen_sha256).toBe(sha(frozen))
    expect(r.amendments).toEqual([{ sha256: sha(amended), recorded_in: 'scratch/result.json#prereg_sha256' }])
  })

  it('a frozen copy matching an earlier record lists the later records', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'v2\n')
    writeFileSync(join(d, 'PREREG.frozen.md'), 'v1\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('v1\n')} *PREREG.md\n${sha('v2\n')} *PREREG.md\n`)
    const r = verifyPrereg('PREREG.frozen.md', { cwd: d, chains: ['PREREG.sha256'], docs: ['PREREG.md'] })
    expect(r.sha256).toBe(sha('v1\n'))
    expect(r.later?.map(h => h.sha256)).toEqual([sha('v2\n')])
  })
})

describe('refusals: no number without a recorded prereg hash', () => {
  it('no-prereg and no-recorded-hash (no sidecar, a sidecar naming other files, an abbreviated hash)', () => {
    const d = tmp()
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('no-prereg')
    writeFileSync(join(d, 'PREREG.md'), 'bars\n')
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('no-recorded-hash')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('h')} *harness/run.mjs\n`)
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('no-recorded-hash')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('bars\n').slice(0, 8)}…${sha('bars\n').slice(-4)} *PREREG.md\n`)
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('no-recorded-hash')
  })

  it('prereg-changed: the file was edited after its last recorded hash', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.md'), 'bars\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('bars\n')} *PREREG.md\n`)
    writeFileSync(join(d, 'PREREG.md'), 'bars\n## amendment after the results\n')
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('prereg-changed')
  })

  it('snapshot-changed: a recorded document other than the prereg changed after its record', () => {
    const d = tmp()
    writeFileSync(join(d, 'PREREG.frozen.md'), 'v1\n')
    writeFileSync(join(d, 'PREREG.md'), 'v1\n## amendment, its hash never recorded\n')
    writeFileSync(join(d, 'PREREG.sha256'), `${sha('v1\n')} *PREREG.md\n`)
    expect(refusal(() => verifyPrereg('PREREG.frozen.md', { cwd: d, chains: ['PREREG.sha256'], docs: ['PREREG.md'] }))).toBe('snapshot-changed')
    expect(refusal(() => verifyPrereg('PREREG.md', { cwd: d }))).toBe('prereg-changed')
  })
})
