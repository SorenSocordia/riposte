/**
 * The export scan's allowance for the bench tables' verbatim preregs (riposte-export-scan.mjs, VERBATIM_BENCH; 2026-10-05):
 * a prereg or hash list under docs/bench/<id>/ may keep its lab file paths, because it ships byte for byte so its sha256 can
 * be checked. Everything else is still refused: a private word in that same prereg, a lab path in a results file or a
 * write-up beside it, a prereg-named file anywhere else. Every scanned term below is assembled, so this file stays clean
 * under the vocabulary guard that reads it.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'riposte-export-scan.mjs')
type Scan = { scanFile: (rel: string, buf: Buffer) => string[] }
const load = async (): Promise<Scan> => await import(pathToFileURL(SCAN).href) as Scan

const ws = ['work', 'space/'].join('')
const labPath = `(\`${ws}${['jev', 'spike'].join('-')}/serve.py\` lines 107-111)`
const spikePath = `local copy \`${ws}${['receipts', 'spike'].join('-')}/data/distil/\``
const shaLine = `3cc07eb0186bdb06596196fbb8e2c9f146b6f107a705d89abeaff826f7aba719 *harness/${['acqu', 'ire'].join('')}.py`
const privateWord = `The ${['kee', 'per'].join('')} ruled on the oracle.`
const privatePhrase = `This follows ${['the', ['hou', 'se'].join('')].join(' ')} oracle's philosophy.`
const B = 'packages/verify/docs/bench'
const scan = async (rel: string, text: string): Promise<string[]> => (await load()).scanFile(rel, Buffer.from(text))

describe.skipIf(!existsSync(SCAN))('the scan allowance for verbatim bench preregs, and what it still refuses', () => {
  it('a bench prereg or hash list may keep lab paths and a harness file name', async () => {
    expect(await scan(`${B}/x1-einvoice-pdf/PREREG.md`, labPath)).toEqual([])
    expect(await scan(`${B}/t3-closed-loop/PREREG.md`, spikePath)).toEqual([])
    expect(await scan(`${B}/sci-r3-inversions/PREREG.frozen.md`, spikePath)).toEqual([])
    expect(await scan(`${B}/s4-bpi2019/PREREG-HASHES.txt`, spikePath)).toEqual([])
    expect(await scan(`${B}/x2-legal-blind/PREREG.sha256`, shaLine)).toEqual([])
  })

  it('a private word in a bench prereg is still refused: only path-like terms are excused', async () => {
    expect(await scan(`${B}/x1-einvoice-pdf/PREREG.md`, privateWord)).toHaveLength(1)
    expect(await scan(`${B}/x1-einvoice-pdf/PREREG.md`, privatePhrase)).toHaveLength(1)
  })

  it('a lab path in a results file or a write-up beside the prereg is still refused', async () => {
    expect((await scan(`${B}/x1-einvoice-pdf/results/results.json`, labPath)).length).toBeGreaterThan(0)
    expect((await scan(`${B}/x1-einvoice-pdf/NOTES.md`, labPath)).length).toBeGreaterThan(0)
    expect((await scan(`${B}/ap-blind/PROVENANCE.md`, spikePath)).length).toBeGreaterThan(0)
    expect((await scan(`${B}/x1-einvoice-pdf/spec.json`, spikePath)).length).toBeGreaterThan(0)
  })

  it('a private word in a write-up is still refused', async () => {
    expect(await scan(`${B}/ap-blind/PROVENANCE.md`, privatePhrase)).toHaveLength(1)
    expect(await scan(`${B}/ap-blind/PROVENANCE.md`, privateWord)).toHaveLength(1)
  })

  it('a prereg-named file outside docs/bench/<id>/, or nested deeper, gets no allowance', async () => {
    expect((await scan('packages/verify/docs/PREREG.md', labPath)).length).toBeGreaterThan(0)
    expect((await scan(`${B}/PREREG.md`, labPath)).length).toBeGreaterThan(0)
    expect((await scan(`${B}/x1-einvoice-pdf/results/PREREG.md`, labPath)).length).toBeGreaterThan(0)
  })

  it('the harness file name is excused only as a hash-list entry, not in prose', async () => {
    expect(await scan(`${B}/ap-blind/PROVENANCE.md`, `We ${['acqu', 'ire'].join('')} the data from the vendor.`)).toHaveLength(1)
  })
})
