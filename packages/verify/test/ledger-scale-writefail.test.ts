/**
 * The torn-tail rules from inside the process: a write that fails PART-WAY through a line (a full disk mid-append) leaves a torn tail on
 * disk. The file ledger must see it as one: the event never joins the in-memory book, every later append is refused with
 * TornTailError (appending after a torn line would bury it in the middle, which is corruption), and a reopen finds the torn
 * tail and opens read-only until repairTornTail. `node:fs` is wrapped so one chosen write stops half-way (two shapes, below).
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 'short': write(2) as POSIX does it, a short count and then an error on the next call. 'landed': a store that wrote the
// bytes and then reported a failure (caught by the file's size).
const fault = vi.hoisted(() => ({ mode: undefined as undefined | 'short' | 'landed', failNext: false }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const real = fs.writeSync as (...a: unknown[]) => number
  const writeSync = ((fd: number, buf: Buffer, off?: number, len?: number, pos?: number | null): number => {
    if (fault.failNext) {
      fault.failNext = false
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    }
    if (fault.mode && Buffer.isBuffer(buf)) {
      const mode = fault.mode
      fault.mode = undefined
      const half = Math.floor((len ?? buf.length) / 2)
      const n = real(fd, buf, off ?? 0, half, pos)
      if (mode === 'short') { fault.failNext = true; return n }
      throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' })
    }
    return real(fd, buf, off, len, pos)
  }) as typeof fs.writeSync
  return { ...fs, default: { ...fs, writeSync }, writeSync }
})

const { openFileLedger, repairTornTail, TornTailError } = await import('../src/ledger/index')
const { verify } = await import('../src/index')
const { clean, FIXED_NOW } = await import('./fixtures/invoices')

const dir = mkdtempSync(join(tmpdir(), 'verify-ledger-writefail-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('a write that fails part-way through a line', () => {
  for (const mode of ['short', 'landed'] as const) it(`(${mode}) is a torn tail: the event is not on the book, later appends are refused, a reopen is read-only, repair restores it`, () => {
    let t = Date.parse('2026-09-28T00:00:00Z')
    const now = (): Date => new Date((t += 60_000))
    const vs = Array.from({ length: 4 }, (_, i) => verify({ ...clean, invoice_number: `WF-${i}` }, { now: FIXED_NOW }))
    const path = join(dir, `book-${mode}.jsonl`)
    const led = openFileLedger(path, { now })
    led.record(vs[0]!, { tenant_id: 'acme' })
    led.record(vs[1]!, { tenant_id: 'acme' })
    const whole = readFileSync(path, 'utf8')
    const head = led.chainHead()

    fault.mode = mode
    expect(() => led.record(vs[2]!, { tenant_id: 'acme' })).toThrow(TornTailError)
    expect(led.chainHead()).toBe(head) // memory never ran ahead of the file
    expect(led.get(vs[2]!.verdict_id)).toBeUndefined()
    expect(led.torn).toMatchObject({ offset: Buffer.byteLength(whole), last_good_seq: 1 })
    expect(led.readOnly).toBe(true)
    expect(() => led.record(vs[3]!, { tenant_id: 'acme' })).toThrow(TornTailError) // never append after a torn line
    expect(readFileSync(path, 'utf8').startsWith(whole)).toBe(true)
    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(whole.length)
    led.close()

    const reopened = openFileLedger(path, { now })
    expect(reopened.torn).toBeDefined()
    expect(reopened.chainHead()).toBe(head)
    expect(reopened.verifyContent().ok).toBe(true)

    expect(repairTornTail(path)).toMatchObject({ repaired: true, truncated_to_bytes: Buffer.byteLength(whole), events_kept: 2 })
    const fixed = openFileLedger(path, { now })
    fixed.record(vs[2]!, { tenant_id: 'acme' })
    expect(openFileLedger(path).verifyContent().ok).toBe(true)
    expect(openFileLedger(path).events()).toHaveLength(3)
  })
})
