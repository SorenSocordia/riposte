/**
 * 2026-10-03: the single-writer lock is the default on every append path (red-team finding F16: with no lock, 8
 * writers forked one ledger). The multi-process attack itself (8 processes through the library, both CLIs, MCP stdio, the
 * loop and HTTP) runs against the built package; these are the store's rules, in one process, with stand-in pids.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileStore, openLedger, ledgerCli, lockHolder, verifyChain, LedgerStoreError, UNLOCKED_ENV, type LedgerStore } from '../src/index.js'

const NOW = () => new Date('2026-10-03T00:00:00Z')
const dirs: string[] = []
const ledgerPath = (): string => { const d = mkdtempSync(join(tmpdir(), 'fixr-lock-')); dirs.push(d); return join(d, 'receipts.jsonl') }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const deadPid = (): number => spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid!
const bytesOf = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '<absent>')
const codeOf = (f: () => unknown): string | undefined => { try { f(); return undefined } catch (e) { return (e as LedgerStoreError).code } }
const appendLock = (p: string, o: { pid: number; host?: string; token?: string }) =>
  writeFileSync(`${p}.lock`, JSON.stringify({ pid: o.pid, host: o.host ?? hostname(), started_at: new Date().toISOString(), ledger: 'receipts.jsonl', mode: 'append', token: o.token ?? 'theirs' }) + '\n')

describe('the lock is the default', () => {
  it('a store opened with no options locks around each append: the lock exists inside the section, never between appends', () => {
    const p = ledgerPath()
    const s = fileStore(p)
    expect(s.lockMode).toBe('append')
    expect(fileStore(p, { lock: false }).lockMode).toBe('append') // false no longer turns it off
    expect(fileStore(p, { lock: true }).lockMode).toBe('hold')
    expect(fileStore(p, { lock: { breakStale: true } }).lockMode).toBe('hold') // callers that asked for the hold lock keep it
    const led = openLedger(s, { now: NOW })
    led.append('note', { n: 1 })
    expect(existsSync(`${p}.lock`)).toBe(false)
    const inside = s.exclusive(() => {
      const l = JSON.parse(readFileSync(`${p}.lock`, 'utf8'))
      led.append('note', { n: 2 }) // nested: the same lock, not a second writer
      return l
    })
    expect(inside).toMatchObject({ pid: process.pid, host: hostname(), mode: 'append', token: expect.any(String) })
    expect(existsSync(`${p}.lock`)).toBe(false)
    expect(lockHolder(p)).toBeUndefined()
    expect(verifyChain(led.entries())).toMatchObject({ ok: true, length: 2 })
  })

  it('reading a ledger whose folder does not exist creates nothing (no folder, no lock)', () => {
    const p = join(dirname(ledgerPath()), 'not-yet', 'receipts.jsonl')
    expect(openLedger(fileStore(p)).entries()).toEqual([])
    expect(existsSync(dirname(p))).toBe(false)
  })

  it('openLedger reads the head, builds and writes each entry inside ONE critical section of the store', () => {
    const calls: string[] = []
    let depth = 0
    const entries: Parameters<LedgerStore['append']>[0][] = []
    const store: LedgerStore = {
      load: () => { calls.push(`load@${depth}`); return [...entries] },
      append: (e) => { calls.push(`append@${depth}`); entries.push(e) },
      head: () => { calls.push(`head@${depth}`); return { count: entries.length, head: entries.length ? entries[entries.length - 1]!.hash : '0'.repeat(64) } },
      takeRepairs: () => { calls.push(`repairs@${depth}`); return [] },
      exclusive: (fn) => { depth++; try { return fn('write') } finally { depth-- } },
    }
    openLedger(store, { now: NOW }).append('note', {})
    expect(calls).toEqual(['repairs@1', 'head@1', 'append@1'])
  })

  it('two writers: the second waits while the first holds the section, then fails typed and writes nothing', () => {
    const p = ledgerPath()
    const a = openLedger(fileStore(p, { lock: { mode: 'append', pid: 1001, host: 'h', isAlive: () => true } }), { now: NOW })
    const bStore = fileStore(p, { lock: { mode: 'append', pid: 1002, host: 'h', isAlive: () => true, timeoutMs: 250 } })
    const b = openLedger(bStore, { now: NOW })
    a.append('note', { w: 'a', i: 0 })
    const before = bytesOf(p)
    let inner: string | undefined
    const t0 = Date.now()
    // the first writer holds the lock through its section; the second tries to append inside it
    fileStore(p, { lock: { mode: 'append', pid: 1001, host: 'h', isAlive: () => true } }).exclusive(() => { inner = codeOf(() => b.append('note', { w: 'b' })) })
    expect(inner).toBe('ledger.locked')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240)
    expect(bytesOf(p)).toBe(before) // nothing torn, nothing forked
    b.append('note', { w: 'b', i: 1 }) // once it is free, the second writer chains to the head on disk
    expect(verifyChain(openLedger(fileStore(p)).entries())).toMatchObject({ ok: true, length: 2 })
  })

  it('a lock that never clears: the append fails with ledger.locked after the timeout and the ledger is byte for byte unchanged', () => {
    const p = ledgerPath()
    openLedger(fileStore(p), { now: NOW }).append('note', { seed: true })
    const before = bytesOf(p)
    const sidecar = bytesOf(`${p}.head.json`)
    appendLock(p, { pid: process.ppid }) // a live process on this host, mid-append as far as anyone can tell
    let err: unknown
    try { openLedger(fileStore(p, { lock: { mode: 'append', timeoutMs: 300 } }), { now: NOW }).append('note', { lost: false }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(LedgerStoreError)
    expect((err as LedgerStoreError).code).toBe('ledger.locked')
    expect((err as Error).message).toMatch(/waited 300 ms.*nothing was written/)
    expect(bytesOf(p)).toBe(before)
    expect(bytesOf(`${p}.head.json`)).toBe(sidecar)
    expect(JSON.parse(readFileSync(`${p}.lock`, 'utf8')).token).toBe('theirs') // never broken: it is live and fresh
  })

  it('a running server\'s HOLD lock refuses a per-append writer at once (typed, nothing written); a reader reads without writing', () => {
    const p = ledgerPath()
    const seed = openLedger(fileStore(p), { now: NOW })
    seed.append('note', { n: 0 })
    seed.append('note', { n: 1 })
    rmSync(`${p}.head.json`) // a reader with the lock would rebuild it; without the lock it must not
    appendFileSync(p, '{"seq":2,"kind":"no') // and a line being written: left out, never quarantined
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), started_at: 'x', ledger: 'receipts.jsonl' }))
    const before = bytesOf(p)
    const t0 = Date.now()
    const led = openLedger(fileStore(p), { now: NOW })
    expect(codeOf(() => led.append('note', {}))).toBe('ledger.locked')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(led.entries().map((e) => e.seq)).toEqual([0, 1])
    expect(led.head()).toMatchObject({ count: 2 })
    expect(bytesOf(p)).toBe(before)
    expect(existsSync(`${p}.head.json`)).toBe(false)
    expect(readdirSync(dirname(p)).filter((f) => f.includes('.torn-'))).toEqual([])
  })

  it('a per-append lock whose process is gone is broken by the next writer: moved aside byte for byte, a signed note on the chain', () => {
    const p = ledgerPath()
    openLedger(fileStore(p), { now: NOW }).append('note', { n: 0 })
    appendLock(p, { pid: deadPid(), token: 'crashed' })
    const stale = readFileSync(`${p}.lock`)
    const led = openLedger(fileStore(p, { now: NOW }), { now: NOW })
    led.append('note', { n: 1 })
    const all = led.entries()
    expect(all.map((e) => e.kind)).toEqual(['note', 'note', 'note'])
    expect(all[1]!.body).toMatchObject({ event: 'ledger.lock_broken', bytes: stale.length, after_seq: 0, reason: expect.stringMatching(/no longer running/) })
    const aside = readdirSync(dirname(p)).find((f) => f.startsWith('receipts.jsonl.lock.broken-'))!
    expect(readFileSync(join(dirname(p), aside)).equals(stale)).toBe(true)
    expect(existsSync(`${p}.lock`)).toBe(false)
    expect(verifyChain(all).ok).toBe(true)
  })

  it('a per-append lock older than staleMs is broken even when its pid answers (a reused pid); another host\'s never is', () => {
    const p = ledgerPath()
    appendLock(p, { pid: process.ppid, token: 'old' })
    const old = (Date.now() - 60_000) / 1000
    utimesSync(`${p}.lock`, old, old)
    const led = openLedger(fileStore(p, { lock: { mode: 'append', staleMs: 30_000 } }), { now: NOW })
    led.append('note', {})
    expect(led.entries()[0]!.body).toMatchObject({ event: 'ledger.lock_broken', reason: expect.stringMatching(/s old/) })

    const q = ledgerPath()
    appendLock(q, { pid: 1, host: 'some-other-host', token: 'elsewhere' })
    utimesSync(`${q}.lock`, old, old)
    expect(codeOf(() => openLedger(fileStore(q, { lock: { mode: 'append', staleMs: 30_000, timeoutMs: 200 } })).append('note', {}))).toBe('ledger.locked')
    expect(JSON.parse(readFileSync(`${q}.lock`, 'utf8')).token).toBe('elsewhere')
    expect(existsSync(q)).toBe(false)
  })

  it('a writer whose lock was broken from under it writes nothing', () => {
    const p = ledgerPath()
    const s = fileStore(p)
    const led = openLedger(s, { now: NOW })
    led.append('note', { n: 0 })
    const before = bytesOf(p)
    const code = codeOf(() => s.exclusive(() => {
      writeFileSync(`${p}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), started_at: 'x', mode: 'append', token: 'someone-else' }))
      led.append('note', { n: 1 })
    }))
    expect(code).toBe('ledger.locked')
    expect(bytesOf(p)).toBe(before)
    expect(JSON.parse(readFileSync(`${p}.lock`, 'utf8')).token).toBe('someone-else') // their lock is left alone
    rmSync(`${p}.lock`)
  })

  it('a writer that stopped mid-line under the lock: the next writer breaks the lock and quarantines the line, both on the record', () => {
    const p = ledgerPath()
    const led = openLedger(fileStore(p, { now: NOW }), { now: NOW })
    led.append('note', { n: 0 }) // this store stays open: the line below is found by its refresh, not at open
    appendFileSync(p, '{"seq":1,"kind":"note","at":"2026') // the line another writer never finished
    appendLock(p, { pid: deadPid(), token: 'stopped' })
    led.append('note', { n: 1 })
    const kinds = led.entries().map((e) => (e.body as { event?: string }).event ?? e.kind)
    expect(kinds).toEqual(['note', 'ledger.lock_broken', 'ledger.torn_tail_quarantined', 'note'])
    expect(verifyChain(led.entries()).ok).toBe(true)
  })

  it(`${UNLOCKED_ENV}=1 (or unsafeUnlocked) turns the per-append lock off, says so on stderr every time, and never touches a HOLD lock`, () => {
    const p = ledgerPath()
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const prev = process.env[UNLOCKED_ENV]
    try {
      process.env[UNLOCKED_ENV] = '1'
      const off = fileStore(p)
      expect(off.lockMode).toBe('off')
      off.exclusive(() => { openLedger(off, { now: NOW }).append('note', {}); expect(existsSync(`${p}.lock`)).toBe(false) })
      const again = fileStore(p)
      openLedger(again, { now: NOW }).append('note', {})
      const warnings = err.mock.calls.map((c) => String(c[0])).filter((t) => t.includes(`${UNLOCKED_ENV}=1`))
      expect(warnings).toHaveLength(2) // one per store opened that way
      expect(warnings[0]).toMatch(/WITHOUT the single-writer lock/)
      const hold = fileStore(p, { lock: true })
      expect(hold.lockMode).toBe('hold')
      hold.head()
      expect(existsSync(`${p}.lock`)).toBe(true)
      hold.release()
    } finally {
      if (prev === undefined) delete process.env[UNLOCKED_ENV]; else process.env[UNLOCKED_ENV] = prev
      err.mockRestore()
    }
    expect(fileStore(p, { unsafeUnlocked: true }).lockMode).toBe('off')
    expect(fileStore(p).lockMode).toBe('append')
  })

  it('riposte-ledger rule appends through the locked store: inside a per-append writer\'s section it waits, then fails typed with nothing appended', () => {
    const p = ledgerPath()
    openLedger(fileStore(p), { now: NOW }).append('note', { seed: true })
    const before = bytesOf(p)
    const argv = ['rule', p, '--verdict', 'a'.repeat(32), '--by', 'buyer', '--decision', 'allow', '--note', 'ok', '--rules', 'R1']
    const io = { openStore: (f: string) => fileStore(f, { lock: { mode: 'append' as const, timeoutMs: 200 } }), lockHolder: (f: string) => lockHolder(f), now: NOW }
    appendLock(p, { pid: process.ppid })
    const r = ledgerCli(argv, (f) => readFileSync(f, 'utf8'), io)
    expect(r.code).toBe(3)
    expect(r.err).toMatch(/^refusing to append: .*ledger|waited 200 ms/)
    expect(bytesOf(p)).toBe(before)
    rmSync(`${p}.lock`)
    // a running server's lock: the hold lock's message, before any wait
    writeFileSync(`${p}.lock`, JSON.stringify({ pid: process.ppid, host: hostname(), started_at: 'x' }))
    expect(ledgerCli(argv, (f) => readFileSync(f, 'utf8'), io).err).toContain('held by a running server')
    rmSync(`${p}.lock`)
    const ok = ledgerCli(argv, (f) => readFileSync(f, 'utf8'), io)
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.out)).toMatchObject({ seq: 1 })
    expect(verifyChain(openLedger(fileStore(p)).entries())).toMatchObject({ ok: true, length: 2 })
    expect(JSON.parse(readFileSync(`${p}.head.json`, 'utf8')).count).toBe(2) // through the store: the sidecar is kept current
  })

  it('a torn tail under rule is quarantined and recorded by the store, not refused', () => {
    const p = ledgerPath()
    openLedger(fileStore(p), { now: NOW }).append('note', { seed: true })
    appendFileSync(p, '{"seq":1,"ki')
    const r = ledgerCli(['rule', p, '--verdict', 'b'.repeat(32), '--by', 'buyer', '--decision', 'deny', '--note', 'no', '--rules', 'R2'], (f) => readFileSync(f, 'utf8'), { openStore: (f) => fileStore(f), now: NOW })
    expect(r.code).toBe(0)
    const all = openLedger(fileStore(p)).entries()
    expect(all.map((e) => e.kind)).toEqual(['note', 'note', 'ruling'])
    expect(all[1]!.body).toMatchObject({ event: 'ledger.torn_tail_quarantined' })
    expect(statSync(p).size).toBeGreaterThan(0)
  })
})
