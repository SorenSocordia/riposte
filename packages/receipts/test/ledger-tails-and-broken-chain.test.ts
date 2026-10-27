/**
 * The receipt ledger's two tail shapes, and a broken chain whose signatures still verify (2026-10-13; a cold reader's ledger
 * attacks, 2026-10-12). The fixtures are the reader's own files (fixtures/core-cold-review-2026-10-12/README.md).
 *   1. A partial last line that ends in a newline used to be exit 3, "line 5 is not JSON", with no next step. It is a TORN TAIL,
 *      exit 1, and the words say what to do: truncate after the last whole entry and verify again, or restore from a copy that
 *      matches the head record.
 *   2. A file whose last entry is whole but has no newline after it used to be a TORN TAIL, exit 1. It verifies (exit 0), with
 *      a note that the last line has no newline.
 *   3. An entry whose body was edited reports signatures_ok: true beside chain_ok: false. The JSON's first key is ok: false, the
 *      first line is "BROKEN: chain", and the words say why signatures_ok alone is not the answer.
 *   4. `riposte-ledger --help` says what each exit means.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ledgerCli, LEDGER_HELP } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'core-cold-review-2026-10-12')
const fx = (n: string): string => join(FX, n)
const readFile = (p: string): string => readFileSync(p, 'utf8')
const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
type J = Record<string, any>
const verifyOf = (argv: string[]): { code: number; out: J; lines: string[]; err: string } => {
  const r = ledgerCli(['verify', ...argv], readFile)
  return { code: r.code, out: r.out ? JSON.parse(r.out) as J : {}, lines: r.err.split('\n').filter(Boolean), err: r.err }
}

describe('1. a partial last line that ends in a newline is a torn tail (the reader\'s torn.jsonl)', () => {
  it('without the head record: exit 1, "NOT VERIFIED: torn tail", and the next step', () => {
    const r = verifyOf([fx('torn.jsonl'), '--key', fx('k.pub.pem'), '--no-sidecar'])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^NOT VERIFIED: torn tail\./)
    expect(r.err).toContain('TORN TAIL:')
    expect(r.err).toContain('truncate the file after entry 3 and verify again, or restore it from a copy that matches its head record')
    expect(r.out.ok).toBe(false)
    expect(r.out.torn_tail).toMatchObject({ after_line: 4 })
  })
  it('with the head record (it says five entries): exit 1, the cut and the torn tail both named', () => {
    const r = verifyOf([fx('torn.jsonl'), '--key', fx('k.pub.pem')])
    expect(r.code).toBe(1)
    expect(r.err).toContain('TORN TAIL:')
    expect(r.err).not.toMatch(/is not JSON/)
  })
  it('summary still refuses it, exit 3, naming the torn tail', () => {
    const s = ledgerCli(['summary', fx('torn.jsonl')], readFile)
    expect(s.code).toBe(3)
    expect(s.err).toContain('a torn tail')
  })
  it('a line in the middle that is not JSON is still exit 3: that is not a tail', () => {
    const d = mkdtempSync(join(tmpdir(), 'riposte-tails-')); dirs.push(d)
    const lines = readFileSync(fx('receipts.jsonl'), 'utf8').split('\n').filter(Boolean)
    const f = join(d, 'mid.jsonl')
    writeFileSync(f, [lines[0], '{"seq":1,', lines[2], lines[3], lines[4]].join('\n') + '\n')
    const r = ledgerCli(['verify', f, '--no-sidecar'], readFile)
    expect(r.code).toBe(3)
    expect(r.err).toContain('line 2 is not JSON')
  })
})

describe('2. a whole last entry with no newline after it verifies, with a note', () => {
  it('the reader\'s nonl.jsonl (the genuine ledger, its final newline removed) beside its head record: exit 0 and the note (it used to be a torn tail, exit 1)', () => {
    const r = verifyOf([fx('nonl.jsonl'), '--key', fx('k.pub.pem')])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^OK: 5 entries/)
    expect(r.err).toContain('note: the last line has no newline')
    expect(r.err).not.toContain('TORN TAIL')
    expect(r.out.ok).toBe(true)
    expect(r.out.no_final_newline).toBe(true)
  })
  it('without its head record (--no-sidecar): exit 0 and the note', () => {
    const r = verifyOf([fx('nonl.jsonl'), '--key', fx('k.pub.pem'), '--no-sidecar'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('note: the last line has no newline')
  })
  it('a cut ledger with no final newline is still caught by its head record: exit 1, and no torn tail', () => {
    const d = mkdtempSync(join(tmpdir(), 'riposte-tails-')); dirs.push(d)
    const f = join(d, 'r.jsonl')
    writeFileSync(f, readFileSync(fx('receipts.jsonl'), 'utf8').split('\n').filter(Boolean).slice(0, 4).join('\n'))
    copyFileSync(fx('receipts.jsonl.head.json'), `${f}.head.json`)
    const r = verifyOf([f, '--key', fx('k.pub.pem')])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^BROKEN at the tail: the file has 4 entries/)
    expect(r.err).not.toContain('TORN TAIL')
  })
})

describe('3. an edited entry: signatures_ok true, chain_ok false (the reader\'s edit.jsonl)', () => {
  it('ok:false is the JSON\'s first key, the first line is "BROKEN: chain", and the words say what signatures_ok means here', () => {
    const r = verifyOf([fx('edit.jsonl'), '--key', fx('k.pub.pem')])
    expect(r.code).toBe(1)
    expect(Object.keys(r.out)[0]).toBe('ok')
    expect(r.out).toMatchObject({ ok: false, chain_ok: false, signatures_ok: true })
    expect(r.lines[0]).toBe('BROKEN: chain')
    expect(r.lines[1]).toBe('BROKEN at entry 2: entry 2 was altered after it was written')
    expect(r.err).toContain('signatures_ok is true because each signature covers the hash its entry records')
  })
})

describe('4. --help says what each exit means', () => {
  it('0, 1 and 3, with the tail shapes under the right one', () => {
    expect(LEDGER_HELP).toMatch(/Exit \(verify\):\s+0 {2}verified/)
    const h = LEDGER_HELP.replace(/\s+/g, ' ') // the help wraps at 120 columns
    expect(h).toContain('1 not verified: a broken chain')
    expect(h).toContain('a torn tail (a last line that is not a whole entry, with or without a newline after it')
    expect(h).toContain('0 verified. A last entry with no newline after it is not a failure')
    expect(h).toContain('3 a usage error, a file that cannot be read, or a line before the last that is not JSON')
    expect(ledgerCli(['--help'], readFile).err).toContain('BROKEN: chain')
  })
})
